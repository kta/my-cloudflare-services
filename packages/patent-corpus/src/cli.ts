#!/usr/bin/env node
/*
 * コーパスエンジンの CLI。
 *
 * 実データが未着なので `synth` で合成コーパスを作れるようにしてある。実データが届いたら
 * まず `probe` で **実物に形を聞く**（仕様書を推測で埋めない）。その出力を見てから
 * `import-tsv` / `import-xml` のマッピングを確定させる。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { extractPdfText, guessPubNumberFromFilename, splitPdfParagraphs } from './adapters/pdf.ts'
import { probeMedia } from './adapters/probe.ts'
import { DEFAULT_TSV_MAPPING, parseTsv, type TsvMapping } from './adapters/tsv.ts'
import { DEFAULT_XML_MAPPING, parseGazetteXml, type XmlMapping } from './adapters/xml.ts'
import { type Corpus, openCorpus } from './corpus.ts'
import { createEmbedder, type EmbedProvider } from './embed.ts'
import { embedCorpus } from './embed-pipeline.ts'
import { createSidecar } from './server.ts'
import { synthesizePublications } from './synth.ts'

const USAGE = `典拠（Tenkyo）コーパスエンジン

  corpus probe <path> [--sample 20] [--max-files 200000]
      受領媒体の実物を走査し、拡張子の分布・ディレクトリの深さ・TSV のヘッダ・
      XML のタグ・PDF のテキストレイヤの有無を報告する。**最初にこれを実行する。**

  corpus synth --db <file> [--count 200] [--seed 1] [--ipc G06F3/01]
               [--paragraphs 60] [--sentences 4]
      合成コーパスを作る（実データ未着でも全機能を動かすため）。

  corpus import-tsv --db <file> --file <tsv> --media <label> [--mapping <json>]
      TSV から書誌（層1）を取り込む。

  corpus import-xml --db <file> --dir <dir> --media <label> [--mapping <json>]
      公報 XML から全文（層2）を取り込む。

  corpus import-pdf --db <file> --dir <dir> --media <label>
      PDF から全文を取り込む（XML が無い場合のフォールバック）。

  corpus embed --db <file> [--ipc P] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
               [--provider deterministic|ollama|openai-compatible] [--model m] [--dim 1024]
      意味ベクトル（層3）へ昇格する。既定の deterministic は追加インストール不要だが
      意味は捉えない（UI に model 名が出る）。

  corpus search --db <file> <語> [<語>...] [--ipc P] [--from d] [--to d] [--limit 20]
  corpus stats --db <file>
  corpus optimize --db <file>
  corpus rebuild-index --db <file>
      トークン化の実装が変わったあと、全文索引を原文から作り直す。

  corpus serve --db <file> [--port 8899] [--provider p] [--model m] [--dim d]
      共有鍵は環境変数 INTERNAL_KEY からのみ受け取る（引数は ps で見えるため）。
`

interface Parsed {
  command: string | undefined
  rest: string[]
  flags: Record<string, string | boolean | undefined>
}

function parse(argv: string[]): Parsed {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      db: { type: 'string' },
      file: { type: 'string' },
      dir: { type: 'string' },
      media: { type: 'string' },
      mapping: { type: 'string' },
      ipc: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      count: { type: 'string' },
      seed: { type: 'string' },
      paragraphs: { type: 'string' },
      sentences: { type: 'string' },
      sample: { type: 'string' },
      'max-files': { type: 'string' },
      limit: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      dim: { type: 'string' },
      port: { type: 'string' },
      json: { type: 'boolean' },
    },
  })
  return {
    command: positionals[0],
    rest: positionals.slice(1),
    flags: values as Record<string, string | boolean | undefined>,
  }
}

function need(flags: Parsed['flags'], name: string): string {
  const v = flags[name]
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`--${name} が必要である`)
  }
  return v
}

function optional(flags: Parsed['flags'], name: string): string | undefined {
  const v = flags[name]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function int(flags: Parsed['flags'], name: string, fallback: number): number {
  const v = optional(flags, name)
  if (v === undefined) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`--${name} は数値である必要がある: ${v}`)
  return Math.trunc(n)
}

function loadMapping<T>(path: string | undefined, fallback: T): T {
  if (!path) return fallback
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function walkFiles(dir: string, extensions: string[]): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (extensions.includes(extname(full).toLowerCase())) out.push(full)
    }
  }
  return out.sort()
}

function withCorpus<T>(flags: Parsed['flags'], fn: (corpus: Corpus) => T): T {
  const corpus = openCorpus(need(flags, 'db'))
  try {
    return fn(corpus)
  } finally {
    corpus.close()
  }
}

function makeEmbedder(flags: Parsed['flags']) {
  const provider = (optional(flags, 'provider') ?? 'deterministic') as EmbedProvider
  const dim = int(flags, 'dim', provider === 'deterministic' ? 256 : 1024)
  return createEmbedder({ provider, dim, model: optional(flags, 'model') })
}

function out(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

async function main(): Promise<number> {
  const { command, rest, flags } = parse(process.argv.slice(2))

  if (command === undefined || command === 'help') {
    console.log(USAGE)
    return 0
  }

  if (command === 'probe') {
    const target = rest[0]
    if (!target) throw new Error('走査するパスを指定する')
    out(
      await probeMedia(target, {
        sampleLimit: int(flags, 'sample', 20),
        maxFiles: int(flags, 'max-files', 200_000),
      }),
    )
    return 0
  }

  if (command === 'synth') {
    return withCorpus(flags, (corpus) => {
      const batch = corpus.beginBatch({
        mediaLabel: 'synthetic',
        sourcePath: '(synthetic)',
        productName: 'synthetic',
        notes: '合成コーパス。実データではない。',
      })
      const ipcFlag = optional(flags, 'ipc')
      const items = synthesizePublications({
        count: int(flags, 'count', 200),
        seed: int(flags, 'seed', 1),
        ipc: ipcFlag ? [ipcFlag] : undefined,
        descParagraphs: int(flags, 'paragraphs', 60),
        sentencesPerParagraph: int(flags, 'sentences', 4),
      })
      for (const item of items) {
        corpus.putPublication(item.publication, batch)
        corpus.putParagraphs(item.publication.pubNumber, item.paragraphs)
      }
      corpus.finishBatch(batch)
      corpus.optimize()
      out({ created: items.length, stats: corpus.stats() })
      return 0
    })
  }

  if (command === 'import-tsv') {
    const mapping = loadMapping<TsvMapping>(optional(flags, 'mapping'), DEFAULT_TSV_MAPPING)
    if (mapping.unverified) {
      console.error(
        '警告: 列名のマッピングが一次情報で未確認の仮置きである。`corpus probe` の出力と突き合わせて確定させること。',
      )
    }
    const file = need(flags, 'file')
    return withCorpus(flags, (corpus) => {
      const batch = corpus.beginBatch({
        mediaLabel: need(flags, 'media'),
        sourcePath: file,
        productName: 'tsv',
        format: 'tsv',
      })
      const rows = parseTsv(readFileSync(file, 'utf8'), mapping)
      for (const row of rows) corpus.putPublication(row, batch)
      corpus.finishBatch(batch)
      out({ imported: rows.length, stats: corpus.stats() })
      return 0
    })
  }

  if (command === 'import-xml') {
    const mapping = loadMapping<XmlMapping>(optional(flags, 'mapping'), DEFAULT_XML_MAPPING)
    if (mapping.unverified) {
      console.error(
        '警告: タグ名のマッピングが一次情報で未確認の仮置きである。`corpus probe` の出力と突き合わせて確定させること。',
      )
    }
    const dir = need(flags, 'dir')
    return withCorpus(flags, (corpus) => {
      const batch = corpus.beginBatch({
        mediaLabel: need(flags, 'media'),
        sourcePath: dir,
        productName: 'gazette-xml',
        format: 'xml',
      })
      let imported = 0
      let skipped = 0
      for (const file of walkFiles(dir, ['.xml'])) {
        const parsed = parseGazetteXml(readFileSync(file, 'utf8'), mapping)
        // 段落番号の重複など、番号がずれる可能性のある公報は取り込まない。
        // 番号がずれた典拠は、機械が「原文に無い」と正しく言っても人間が反証してしまう。
        if (parsed.issues.length > 0) {
          corpus.recordExtractFailure({
            pdfPath: file,
            pubNumber: parsed.docNumber ?? undefined,
            reason: `paragraph_number_issue: ${parsed.issues.join('; ')}`,
          })
          skipped++
          continue
        }
        if (!parsed.docNumber || parsed.paragraphs.length === 0) {
          corpus.recordExtractFailure({
            pdfPath: file,
            pubNumber: parsed.docNumber ?? undefined,
            reason: parsed.docNumber ? 'no_paragraphs' : 'no_doc_number',
          })
          skipped++
          continue
        }
        // 書誌が層1に無ければ、XML から取れる最小限で行を作る（後で TSV が上書きする）。
        if (!corpus.getPublication(parsed.docNumber)) {
          corpus.putPublication(
            {
              pubNumber: parsed.docNumber,
              country: 'JP',
              kind: 'A',
              appNumber: null,
              filingDate: null,
              pubDate: null,
              regDate: null,
              title: parsed.title ?? '',
              applicants: [],
              inventors: [],
              ipc: [],
              fi: [],
              fterm: [],
              abstract: null,
              pdfPath: null,
            },
            batch,
          )
        }
        corpus.putParagraphs(parsed.docNumber, parsed.paragraphs)
        imported++
      }
      corpus.finishBatch(batch)
      corpus.optimize()
      out({ imported, skipped, stats: corpus.stats() })
      return 0
    })
  }

  if (command === 'import-pdf') {
    const dir = need(flags, 'dir')
    return withCorpus(flags, (corpus) => {
      const batch = corpus.beginBatch({
        mediaLabel: need(flags, 'media'),
        sourcePath: dir,
        productName: 'gazette-pdf',
        format: 'pdf',
      })
      let imported = 0
      let failed = 0
      for (const file of walkFiles(dir, ['.pdf'])) {
        const extracted = extractPdfText(file)
        if (!extracted.ok) {
          corpus.recordExtractFailure({ pdfPath: file, reason: extracted.reason })
          failed++
          if (extracted.reason === 'tool_missing') {
            console.error(extracted.detail)
            break
          }
          continue
        }
        // 公報番号はファイル名から取る。実データの命名規則は未確認なので、
        // 取れなければ失敗として記録し、握りつぶさない。
        const guess = guessPubNumberFromFilename(file)
        if (!guess) {
          corpus.recordExtractFailure({ pdfPath: file, reason: 'unparsable_filename' })
          failed++
          continue
        }
        const paragraphs = splitPdfParagraphs(extracted.text).map((p) => ({
          paraNo: p.paraNo,
          section: 'desc' as const,
          text: p.text,
        }))
        if (paragraphs.length === 0) {
          corpus.recordExtractFailure({ pdfPath: file, pubNumber: guess, reason: 'no_paragraphs' })
          failed++
          continue
        }
        if (!corpus.getPublication(guess)) {
          corpus.putPublication(
            {
              pubNumber: guess,
              country: 'JP',
              kind: 'A',
              appNumber: null,
              filingDate: null,
              pubDate: null,
              regDate: null,
              title: '',
              applicants: [],
              inventors: [],
              ipc: [],
              fi: [],
              fterm: [],
              abstract: null,
              pdfPath: file,
            },
            batch,
          )
        }
        corpus.putParagraphs(guess, paragraphs)
        imported++
      }
      corpus.finishBatch(batch)
      corpus.optimize()
      out({ imported, failed, stats: corpus.stats() })
      return 0
    })
  }

  if (command === 'embed') {
    const embedder = makeEmbedder(flags)
    const corpus = openCorpus(need(flags, 'db'))
    try {
      const result = await embedCorpus(corpus, embedder, {
        ipcPrefix: optional(flags, 'ipc'),
        pubDateFrom: optional(flags, 'from'),
        pubDateTo: optional(flags, 'to'),
      })
      if (!result.semantic) {
        console.error(
          '注意: deterministic は語の重なりを測るだけで意味ベクトルではない。意味検索が要るなら --provider ollama --model bge-m3 を使う。',
        )
      }
      out(result)
    } finally {
      corpus.close()
    }
    return 0
  }

  if (command === 'search') {
    if (rest.length === 0) throw new Error('検索語を 1 つ以上指定する')
    return withCorpus(flags, (corpus) => {
      out(
        corpus.search({
          terms: rest,
          ipcPrefix: optional(flags, 'ipc'),
          pubDateFrom: optional(flags, 'from'),
          pubDateTo: optional(flags, 'to'),
          limit: int(flags, 'limit', 20),
        }),
      )
      return 0
    })
  }

  if (command === 'stats') {
    return withCorpus(flags, (corpus) => {
      out({ ...corpus.stats(), batches: corpus.batches(), failures: corpus.extractFailures() })
      return 0
    })
  }

  if (command === 'rebuild-index') {
    return withCorpus(flags, (corpus) => {
      out(corpus.rebuildIndex())
      return 0
    })
  }

  if (command === 'optimize') {
    return withCorpus(flags, (corpus) => {
      corpus.optimize()
      out({ optimized: true })
      return 0
    })
  }

  if (command === 'serve') {
    const dbPath = need(flags, 'db')
    // 存在しない DB を黙って作ると「0 件ヒット」を「該当なし」と誤読させる。
    statSync(dbPath)
    const corpus = openCorpus(dbPath)
    // 鍵は環境変数からのみ受け取る。コマンドライン引数は `ps` で他プロセスから見えるので、
    // secrets を引数に置かないというリポジトリ規約に反する。
    const sidecar = createSidecar({
      corpus,
      embedder: makeEmbedder(flags),
      internalKey: process.env.INTERNAL_KEY,
      port: int(flags, 'port', 8899),
    })
    const port = await sidecar.listen()
    console.error(`corpus sidecar listening on http://127.0.0.1:${port} (db: ${dbPath})`)
    if (!process.env.INTERNAL_KEY) {
      console.error('警告: INTERNAL_KEY が未設定なので、全問い合わせを 503 で拒否する。')
    }
    // Ctrl-C まで待つ。
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve)
      process.once('SIGTERM', resolve)
    })
    await sidecar.close()
    corpus.close()
    return 0
  }

  console.error(`不明なコマンド: ${command}\n`)
  console.log(USAGE)
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
