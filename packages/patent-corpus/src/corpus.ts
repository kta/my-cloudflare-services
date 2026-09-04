/*
 * コーパス（公報の書誌と全文）を持つローカル SQLite。
 *
 * ドライバは Node 26 内蔵の `node:sqlite`（SQLite 3.53.4）だけを使う。better-sqlite3 も
 * sqlite-vec も要らないことを実測で確認した（FTS5・bm25・json1 が揃っている）。
 * ネイティブモジュールのビルドが無いので、依存追加ゼロで動く。
 *
 * このファイルが持つのは「派生物」である。壊れたら受領媒体から作り直せる（実測 1,714 公報/秒）。
 * だからマイグレーション履歴を持たず、スキーマはこのファイルの DDL が単一ソースである。
 * 作り直せないのは案件データ（D1 側の典拠・ドラフト）であって、こちらではない。
 */

import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { CorpusParagraph, CorpusPublication, Section } from './synth.ts'
import { buildQuery, indexTokens, TOKENIZER_VERSION, tokenRuns } from './tokenize.ts'

export type { CorpusParagraph, CorpusPublication, Section } from './synth.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  id                TEXT PRIMARY KEY,
  media_label       TEXT NOT NULL,
  source_path       TEXT NOT NULL,
  product_name      TEXT NOT NULL,
  format            TEXT,
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  publication_count INTEGER NOT NULL,
  notes             TEXT
);

CREATE TABLE IF NOT EXISTS publications (
  pub_number   TEXT PRIMARY KEY,
  country      TEXT NOT NULL,
  kind         TEXT NOT NULL,
  app_number   TEXT,
  filing_date  TEXT,
  pub_date     TEXT,
  reg_date     TEXT,
  title        TEXT NOT NULL,
  applicants   TEXT NOT NULL,
  inventors    TEXT NOT NULL,
  ipc          TEXT NOT NULL,
  fi           TEXT NOT NULL,
  fterm        TEXT NOT NULL,
  abstract     TEXT,
  claim_count  INTEGER NOT NULL,
  has_fulltext INTEGER NOT NULL,
  -- 実際に取り込めた部分（claim / desc / abstract）を JSON 配列で持つ。
  -- 「請求項しか取れなかった公報への明細書段落の引用」を、原文に無い（却下）ではなく
  -- 照合不能（保留）と正しく言うために要る。
  sections_ingested TEXT NOT NULL,
  pdf_path     TEXT,
  batch_id     TEXT NOT NULL,
  imported_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS publications_pub_date_idx ON publications(pub_date);

-- 分類コードは前方一致で引くので、JSON ではなく行に開いて索引を張る。
CREATE TABLE IF NOT EXISTS publication_codes (
  pub_number TEXT NOT NULL,
  scheme     TEXT NOT NULL,
  code       TEXT NOT NULL,
  PRIMARY KEY (pub_number, scheme, code)
);
CREATE INDEX IF NOT EXISTS publication_codes_code_idx ON publication_codes(scheme, code);

-- 引用の最小単位。para_no は desc が 4 桁ゼロ埋め、claim が C 始まり。
--
-- id を AUTOINCREMENT にしているのは、FTS5 の rowid と 1:1 で対応させる必要があり、かつ
-- **rowid を絶対に再利用してはならない**ためである（再利用すると、削除し損ねた索引の
-- posting が別の段落に化け、検索語を含まない段落がヒットする）。リポジトリの DB 規約が
-- 禁じているのは D1 のドメイン表の話であり、こちらは作り直せる派生物である。
CREATE TABLE IF NOT EXISTS paragraphs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pub_number TEXT NOT NULL,
  para_no    TEXT NOT NULL,
  section    TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  text       TEXT NOT NULL,
  -- 本文が変わったことを検知してベクトルを作り直すために持つ。
  text_hash  TEXT NOT NULL,
  char_len   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS paragraphs_key_idx ON paragraphs(pub_number, para_no);
CREATE INDEX IF NOT EXISTS paragraphs_pub_idx ON paragraphs(pub_number, seq);

-- contentless FTS5。索引だけを持ち、bigram に開いた文字列は保存しない
-- （保存すると原文の 2.3 倍を無駄に食う）。snippet は原文から自分で作る。
--
-- contentless_delete=1 は使わない。使うと FTS5 が内部で 2^53 を超える int64 の
-- トゥームストーン値を last_insert_rowid に残し、その後に走る **無関係な文** の
-- run() が node:sqlite の数値変換で落ちる（実測で確認）。代わりに、削除は
-- FTS5 の 'delete' コマンドに元の ng 文字列を渡す正攻法で行う。
--
-- その ng は原文から作り直すので、**トークン化の実装が変わると削除が壊れる**。
-- だから meta.tokenizer_version に版を刻み、食い違う DB への書き込みを拒む（openCorpus 参照）。
CREATE VIRTUAL TABLE IF NOT EXISTS paragraphs_ngram
  USING fts5(ng, tokenize='unicode61', content='');

CREATE TABLE IF NOT EXISTS citations (
  pub_number       TEXT NOT NULL,
  cited_pub_number TEXT NOT NULL,
  source           TEXT NOT NULL,
  PRIMARY KEY (pub_number, cited_pub_number)
);
CREATE INDEX IF NOT EXISTS citations_cited_idx ON citations(cited_pub_number);

CREATE TABLE IF NOT EXISTS extract_failures (
  id          TEXT PRIMARY KEY,
  pdf_path    TEXT NOT NULL,
  pub_number  TEXT,
  reason      TEXT NOT NULL,
  detected_at TEXT NOT NULL
);

-- どの部分集合を意味ベクトルまで昇格したか。検索結果に「見た範囲」を添えるために使う。
CREATE TABLE IF NOT EXISTS promotion_sets (
  id                TEXT PRIMARY KEY,
  predicate         TEXT NOT NULL,
  model             TEXT NOT NULL,
  dim               INTEGER NOT NULL,
  semantic          INTEGER NOT NULL,
  publication_count INTEGER NOT NULL,
  chunk_count       INTEGER NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id           TEXT PRIMARY KEY,
  pub_number   TEXT NOT NULL,
  para_no      TEXT NOT NULL,
  chunk_seq    INTEGER NOT NULL,
  text_hash    TEXT NOT NULL,
  model        TEXT NOT NULL,
  dim          INTEGER NOT NULL,
  scale        REAL NOT NULL,
  vec          BLOB NOT NULL,
  vec_bin      BLOB NOT NULL,
  promotion_id TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_para_idx ON chunks(pub_number, para_no);
CREATE INDEX IF NOT EXISTS chunks_promotion_idx ON chunks(promotion_id);
`

export interface BatchInput {
  mediaLabel: string
  sourcePath: string
  productName: string
  format?: string
  notes?: string
}

export interface BatchRecord {
  id: string
  mediaLabel: string
  sourcePath: string
  productName: string
  format: string | null
  startedAt: string
  finishedAt: string | null
  publicationCount: number
  notes: string | null
}

export interface StoredPublication extends CorpusPublication {
  claimCount: number
  hasFulltext: boolean
  sectionsIngested: Section[]
  batchId: string
  importedAt: string
}

export interface StoredParagraph {
  pubNumber: string
  paraNo: string
  section: Section
  seq: number
  text: string
  charLen: number
}

export interface SearchQuery {
  terms: string[]
  op?: 'AND' | 'OR'
  ipcPrefix?: string
  pubDateFrom?: string
  pubDateTo?: string
  sections?: Section[]
  limit?: number
  offset?: number
}

export interface SearchHit {
  pubNumber: string
  paraNo: string
  section: Section
  text: string
  snippet: string
  score: number
  title: string
  applicants: string[]
  pubDate: string | null
}

export interface SearchResult {
  hits: SearchHit[]
  /** 総ヒット件数（頁の長さではない。調査報告書に書く数字）。 */
  hitCount: number
  /** そのうち公開日が不明な公報の件数。日付で絞ったときも必ずヒットさせ、件数で告げる。 */
  undatedCount: number
  /** 実行した MATCH 式。実質空の検索語なら null。 */
  matchExpression: string | null
  /** 区切りを含んでいたため連続性を諦めて AND に落とした語。黙って落とさない。 */
  splitTerms: string[]
  /** トークンが作れず検索から外れた語。 */
  droppedTerms: string[]
  /** 実行した SQL。再現性と監査のために保存する。 */
  compiledSql: string | null
  parameters: (string | number)[]
  executedAt: string
  /** コーパスの状態を指す。取り込みが進むと結果が変わることを記録するため。 */
  corpusBatchCount: number
}

export interface ExtractFailureInput {
  pdfPath: string
  pubNumber?: string
  reason: string
}

export interface ExtractFailure {
  id: string
  pdfPath: string
  pubNumber: string | null
  reason: string
  detectedAt: string
}

export interface CorpusStats {
  publications: number
  withFulltext: number
  paragraphs: number
  chunks: number
  batches: number
  extractFailures: number
  byIpcSubclass: Record<string, number>
  tokenizerVersion: number
  indexStale: boolean
}

export interface CorpusOptions {
  /** 時刻の注入口。テストは実時計に依存させない（TEST_RULE）。 */
  now?: () => Date
  /** 他プロセスが書いているときに待つミリ秒。 */
  busyTimeoutMs?: number
}

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000
const SNIPPET_RADIUS = 40
/** IPC のサブクラスは先頭 4 文字（例 G06F3/01 → G06F）。 */
const SUBCLASS_LENGTH = 4
const DEFAULT_BUSY_TIMEOUT_MS = 10_000
const META_TOKENIZER_VERSION = 'tokenizer_version'

type Row = Record<string, string | number | bigint | Uint8Array | null>
// noUncheckedIndexedAccess の下では row.x は undefined を含む。取り出しの入口を 1 か所にする。
type Cell = string | number | bigint | Uint8Array | null | undefined

function json(values: string[]): string {
  return JSON.stringify(values)
}

function parseJsonArray(value: Cell): string[] {
  if (typeof value !== 'string') return []
  const parsed: unknown = JSON.parse(value)
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
}

function str(value: Cell): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function nullableStr(value: Cell): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: Cell): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

/**
 * LIKE のワイルドカードを無効化する。エスケープしないと `ipcPrefix: '%'` で
 * 分類コードの絞り込みが丸ごと無効になる（実測で確認）。
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}

/**
 * NFKC + 小文字化した文字列と、その各文字が原文のどこから来たかの対応表を作る。
 * snippet の位置合わせに使う（`G06F` や `CMOS` は正規化で形が変わるので、
 * 原文への `indexOf` だけでは当たらない）。
 */
function normalizeWithOffsets(text: string): { normalized: string; offsets: number[] } {
  const chars = Array.from(text)
  let normalized = ''
  const offsets: number[] = []
  let original = 0
  for (const ch of chars) {
    const folded = ch.normalize('NFKC').toLowerCase()
    for (const f of folded) {
      normalized += f
      offsets.push(original)
    }
    original += ch.length
  }
  return { normalized, offsets }
}

/**
 * 検索語が原文のどこに現れるかを探し、その周りを切り出す。
 * FTS5 の snippet() は contentless テーブルでは使えないので自分で作る
 * （原文を FTS に二重で持たないという選択の代償であり、正しい代償である）。
 */
export function buildSnippet(text: string, terms: string[]): string {
  const candidates = terms.flatMap((t) => tokenRuns(t).map((r) => r.text))
  const { normalized, offsets } = normalizeWithOffsets(text)
  let at = -1
  for (const c of candidates) {
    if (c.length === 0) continue
    const raw = text.indexOf(c)
    if (raw >= 0 && (at < 0 || raw < at)) at = raw
    const folded = normalized.indexOf(c.normalize('NFKC').toLowerCase())
    if (folded >= 0) {
      const mapped = offsets[folded]
      if (mapped !== undefined && (at < 0 || mapped < at)) at = mapped
    }
  }
  if (at < 0) return text.slice(0, SNIPPET_RADIUS * 2)
  const start = Math.max(0, at - SNIPPET_RADIUS)
  const end = Math.min(text.length, at + SNIPPET_RADIUS * 2)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

export interface Corpus {
  beginBatch(input: BatchInput): string
  finishBatch(batchId: string): void
  batches(): BatchRecord[]
  putPublication(pub: CorpusPublication, batchId: string): void
  getPublication(pubNumber: string): StoredPublication | null
  putParagraphs(pubNumber: string, paragraphs: CorpusParagraph[]): void
  getParagraph(pubNumber: string, paraNo: string): StoredParagraph | null
  listParagraphs(pubNumber: string): StoredParagraph[]
  search(query: SearchQuery): SearchResult
  stats(): CorpusStats
  recordExtractFailure(input: ExtractFailureInput): void
  extractFailures(): ExtractFailure[]
  /** FTS5 索引を圧縮する。取り込みの締めに 1 回呼ぶ。 */
  optimize(): void
  /** トークン化の版が変わったあと、全文索引を原文から作り直す。 */
  rebuildIndex(): { paragraphs: number }
  /** 索引がこのコード版と食い違っているか（true なら書き込みは拒まれる）。 */
  indexStale(): boolean
  /** 低水準の逃げ口。CLI の統計やサイドカーの拡張で使う。 */
  raw(): DatabaseSync
  close(): void
}

export function openCorpus(path: string, options: CorpusOptions = {}): Corpus {
  const now = options.now ?? (() => new Date())
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA temp_store = MEMORY')
  // 128MB。特許コーパスは読みが支配的なので、ページキャッシュに投資する価値がある。
  db.exec('PRAGMA cache_size = -131072')
  db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`)
  db.exec(SCHEMA)

  // 索引の版。食い違ったまま差分取り込みを行うと FTS5 の削除が静かに壊れるので、
  // 書き込みを拒み、rebuildIndex() を促す。
  const storedVersion = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get(META_TOKENIZER_VERSION) as Row | undefined
  let stale = false
  if (storedVersion === undefined) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
      META_TOKENIZER_VERSION,
      String(TOKENIZER_VERSION),
    )
  } else if (num(storedVersion.value) !== TOKENIZER_VERSION) {
    stale = true
  }

  function assertWritable(): void {
    if (stale) {
      throw new Error(
        `この corpus.db はトークン化 v${str(storedVersion?.value)} で作られており、` +
          `現在のコードは v${TOKENIZER_VERSION} である。全文索引の削除が壊れるため書き込みを拒否した。` +
          '`corpus rebuild-index --db <file>` で索引を作り直す。',
      )
    }
  }

  const insertBatch = db.prepare(
    `INSERT INTO import_batches (id, media_label, source_path, product_name, format, started_at, finished_at, publication_count, notes)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
  )
  // 日付は後から入った不正な TSV で正しい値を潰さない（COALESCE で既存を守る）。
  const upsertPublication = db.prepare(
    `INSERT INTO publications (pub_number, country, kind, app_number, filing_date, pub_date, reg_date,
       title, applicants, inventors, ipc, fi, fterm, abstract, claim_count, has_fulltext, sections_ingested, pdf_path, batch_id, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, '[]', ?, ?, ?)
     ON CONFLICT(pub_number) DO UPDATE SET
       country = excluded.country, kind = excluded.kind,
       app_number = coalesce(excluded.app_number, app_number),
       filing_date = coalesce(excluded.filing_date, filing_date),
       pub_date = coalesce(excluded.pub_date, pub_date),
       reg_date = coalesce(excluded.reg_date, reg_date),
       title = excluded.title, applicants = excluded.applicants, inventors = excluded.inventors,
       ipc = excluded.ipc, fi = excluded.fi, fterm = excluded.fterm,
       abstract = coalesce(excluded.abstract, abstract),
       pdf_path = coalesce(excluded.pdf_path, pdf_path),
       batch_id = excluded.batch_id, imported_at = excluded.imported_at`,
  )
  const deleteCodes = db.prepare('DELETE FROM publication_codes WHERE pub_number = ?')
  const insertCode = db.prepare(
    'INSERT OR IGNORE INTO publication_codes (pub_number, scheme, code) VALUES (?, ?, ?)',
  )
  const selectPublication = db.prepare('SELECT * FROM publications WHERE pub_number = ?')
  const selectExistingParagraphs = db.prepare(
    'SELECT id, para_no, text, text_hash FROM paragraphs WHERE pub_number = ?',
  )
  // contentless FTS5 からの削除は 'delete' コマンドに元の値を渡す（FTS5 の正攻法）。
  const deleteNgram = db.prepare(
    "INSERT INTO paragraphs_ngram (paragraphs_ngram, rowid, ng) VALUES ('delete', ?, ?)",
  )
  const deleteParagraphs = db.prepare('DELETE FROM paragraphs WHERE pub_number = ?')
  const insertParagraph = db.prepare(
    'INSERT INTO paragraphs (pub_number, para_no, section, seq, text, text_hash, char_len) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const insertNgram = db.prepare('INSERT INTO paragraphs_ngram (rowid, ng) VALUES (?, ?)')
  const markFulltext = db.prepare(
    'UPDATE publications SET has_fulltext = ?, claim_count = ?, sections_ingested = ? WHERE pub_number = ?',
  )
  // 不変条件: すべての chunk は「実在し、かつ本文が変わっていない」段落を指す。
  // 段落が消えても本文が差し替わっても、そのベクトルは無効である。残すと
  // 「存在しない本文のスコア」で順位が決まる（実測で確認）。
  const deleteInvalidChunks = db.prepare(
    `DELETE FROM chunks WHERE pub_number = ?
       AND NOT EXISTS (
         SELECT 1 FROM paragraphs p
         WHERE p.pub_number = chunks.pub_number
           AND p.para_no = chunks.para_no
           AND p.text_hash = chunks.text_hash
       )`,
  )
  const selectParagraph = db.prepare(
    'SELECT * FROM paragraphs WHERE pub_number = ? AND para_no = ?',
  )
  const selectParagraphsOfPub = db.prepare(
    'SELECT * FROM paragraphs WHERE pub_number = ? ORDER BY seq',
  )
  const bumpBatchCount = db.prepare(
    'UPDATE import_batches SET publication_count = (SELECT count(*) FROM publications WHERE batch_id = ?), finished_at = ? WHERE id = ?',
  )
  const insertFailure = db.prepare(
    'INSERT INTO extract_failures (id, pdf_path, pub_number, reason, detected_at) VALUES (?, ?, ?, ?, ?)',
  )

  function toStoredPublication(row: Row): StoredPublication {
    return {
      pubNumber: str(row.pub_number),
      country: str(row.country),
      kind: str(row.kind),
      appNumber: nullableStr(row.app_number),
      filingDate: nullableStr(row.filing_date),
      pubDate: nullableStr(row.pub_date),
      regDate: nullableStr(row.reg_date),
      title: str(row.title),
      applicants: parseJsonArray(row.applicants),
      inventors: parseJsonArray(row.inventors),
      ipc: parseJsonArray(row.ipc),
      fi: parseJsonArray(row.fi),
      fterm: parseJsonArray(row.fterm),
      abstract: nullableStr(row.abstract),
      pdfPath: nullableStr(row.pdf_path),
      claimCount: num(row.claim_count),
      hasFulltext: num(row.has_fulltext) === 1,
      sectionsIngested: parseJsonArray(row.sections_ingested) as Section[],
      batchId: str(row.batch_id),
      importedAt: str(row.imported_at),
    }
  }

  function toStoredParagraph(row: Row): StoredParagraph {
    return {
      pubNumber: str(row.pub_number),
      paraNo: str(row.para_no),
      section: str(row.section) as Section,
      seq: num(row.seq),
      text: str(row.text),
      charLen: num(row.char_len),
    }
  }

  /** 書き込みを 1 つの取引にまとめる。途中で失敗したら何も残さない。 */
  function transaction<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  return {
    beginBatch(input) {
      assertWritable()
      const id = randomUUID()
      insertBatch.run(
        id,
        input.mediaLabel,
        input.sourcePath,
        input.productName,
        input.format ?? null,
        now().toISOString(),
        input.notes ?? null,
      )
      return id
    },

    finishBatch(batchId) {
      bumpBatchCount.run(batchId, now().toISOString(), batchId)
    },

    batches() {
      const rows = db
        .prepare('SELECT * FROM import_batches ORDER BY started_at')
        .all() as unknown as Row[]
      return rows.map((r) => ({
        id: str(r.id),
        mediaLabel: str(r.media_label),
        sourcePath: str(r.source_path),
        productName: str(r.product_name),
        format: nullableStr(r.format),
        startedAt: str(r.started_at),
        finishedAt: nullableStr(r.finished_at),
        publicationCount: num(r.publication_count),
        notes: nullableStr(r.notes),
      }))
    },

    putPublication(pub, batchId) {
      assertWritable()
      transaction(() => {
        upsertPublication.run(
          pub.pubNumber,
          pub.country,
          pub.kind,
          pub.appNumber,
          pub.filingDate,
          pub.pubDate,
          pub.regDate,
          pub.title,
          json(pub.applicants),
          json(pub.inventors),
          json(pub.ipc),
          json(pub.fi),
          json(pub.fterm),
          pub.abstract,
          pub.pdfPath,
          batchId,
          now().toISOString(),
        )
        deleteCodes.run(pub.pubNumber)
        for (const code of pub.ipc) insertCode.run(pub.pubNumber, 'ipc', code)
        for (const code of pub.fi) insertCode.run(pub.pubNumber, 'fi', code)
        for (const code of pub.fterm) insertCode.run(pub.pubNumber, 'fterm', code)
      })
    },

    getPublication(pubNumber) {
      const row = selectPublication.get(pubNumber) as Row | undefined
      return row ? toStoredPublication(row) : null
    },

    putParagraphs(pubNumber, paragraphs) {
      assertWritable()
      // 段落番号の重複は、どの段落を引用したのかが言えなくなるので受け付けない。
      const seen = new Set<string>()
      for (const p of paragraphs) {
        if (seen.has(p.paraNo)) {
          throw new Error(`段落番号が重複している: ${pubNumber} ${p.paraNo}`)
        }
        seen.add(p.paraNo)
      }

      transaction(() => {
        // 入れ直しでは古い段落と索引を必ず落とす。残すと「原文に無い段落」が
        // 典拠として照合を通ってしまう（幽霊段落）。
        const existing = selectExistingParagraphs.all(pubNumber) as unknown as Row[]
        for (const row of existing) deleteNgram.run(num(row.id), indexTokens(str(row.text)))
        deleteParagraphs.run(pubNumber)

        let seq = 0
        let claims = 0
        const sections = new Set<Section>()
        for (const p of paragraphs) {
          const result = insertParagraph.run(
            pubNumber,
            p.paraNo,
            p.section,
            seq,
            p.text,
            hashText(p.text),
            Array.from(p.text).length,
          )
          insertNgram.run(Number(result.lastInsertRowid), indexTokens(p.text))
          if (p.section === 'claim') claims++
          sections.add(p.section)
          seq++
        }
        markFulltext.run(
          paragraphs.length > 0 ? 1 : 0,
          claims,
          json([...sections].sort()),
          pubNumber,
        )
        deleteInvalidChunks.run(pubNumber)
      })
    },

    getParagraph(pubNumber, paraNo) {
      const row = selectParagraph.get(pubNumber, paraNo) as Row | undefined
      return row ? toStoredParagraph(row) : null
    },

    listParagraphs(pubNumber) {
      const rows = selectParagraphsOfPub.all(pubNumber) as unknown as Row[]
      return rows.map(toStoredParagraph)
    },

    search(query) {
      const executedAt = now().toISOString()
      const batchRow = db.prepare('SELECT count(*) AS c FROM import_batches').get() as Row
      const corpusBatchCount = num(batchRow.c)
      const built = buildQuery(query.terms, query.op ?? 'AND')
      const empty = {
        hitCount: 0,
        undatedCount: 0,
        matchExpression: built.match,
        splitTerms: built.splitTerms,
        droppedTerms: built.droppedTerms,
        compiledSql: null,
        parameters: [],
        executedAt,
        corpusBatchCount,
      }
      if (built.match === null) return { ...empty, hits: [] }

      const where: string[] = ['paragraphs_ngram MATCH ?']
      const params: (string | number)[] = [built.match]
      if (query.sections && query.sections.length > 0) {
        where.push(`p.section IN (${query.sections.map(() => '?').join(', ')})`)
        params.push(...query.sections)
      }
      // 公開日が不明な公報を日付の絞り込みで消さない。出願日より前に公開されたかが
      // 判断の全てである製品で、「日付が読めなかった文献が黙って消える」のは危険である。
      // 代わりに undatedCount で「日付不明 N 件を含む」と告げる。
      if (query.pubDateFrom) {
        where.push('(pub.pub_date >= ? OR pub.pub_date IS NULL)')
        params.push(query.pubDateFrom)
      }
      if (query.pubDateTo) {
        where.push('(pub.pub_date <= ? OR pub.pub_date IS NULL)')
        params.push(query.pubDateTo)
      }
      if (query.ipcPrefix) {
        where.push(
          "EXISTS (SELECT 1 FROM publication_codes c WHERE c.pub_number = p.pub_number AND c.scheme = 'ipc' AND c.code LIKE ? ESCAPE '\\')",
        )
        params.push(`${escapeLike(query.ipcPrefix)}%`)
      }

      const from = `FROM paragraphs_ngram
        JOIN paragraphs p ON p.id = paragraphs_ngram.rowid
        JOIN publications pub ON pub.pub_number = p.pub_number
        WHERE ${where.join(' AND ')}`

      const counts = db
        .prepare(
          `SELECT count(*) AS c, sum(CASE WHEN pub.pub_date IS NULL THEN 1 ELSE 0 END) AS undated ${from}`,
        )
        .get(...params) as Row

      // 順序は bm25 → 公報番号 → 段落番号。同点の並びを固定して再現性を保証する。
      const sql = `SELECT p.pub_number, p.para_no, p.section, p.text,
          bm25(paragraphs_ngram) AS score,
          pub.title, pub.applicants, pub.pub_date
        ${from}
        ORDER BY score ASC, p.pub_number ASC, p.para_no ASC
        LIMIT ? OFFSET ?`
      const limit = Math.min(Math.max(1, Math.trunc(query.limit ?? DEFAULT_LIMIT)), MAX_LIMIT)
      const offset = Math.max(0, Math.trunc(query.offset ?? 0))
      const rows = db.prepare(sql).all(...params, limit, offset) as unknown as Row[]

      return {
        hits: rows.map((r) => {
          const text = str(r.text)
          return {
            pubNumber: str(r.pub_number),
            paraNo: str(r.para_no),
            section: str(r.section) as Section,
            text,
            snippet: buildSnippet(text, query.terms),
            score: num(r.score),
            title: str(r.title),
            applicants: parseJsonArray(r.applicants),
            pubDate: nullableStr(r.pub_date),
          }
        }),
        hitCount: num(counts.c),
        undatedCount: num(counts.undated),
        matchExpression: built.match,
        splitTerms: built.splitTerms,
        droppedTerms: built.droppedTerms,
        compiledSql: sql,
        parameters: [...params, limit, offset],
        executedAt,
        corpusBatchCount,
      }
    },

    stats() {
      const one = (sql: string): number => num((db.prepare(sql).get() as Row).c)
      const codes = db
        .prepare(
          `SELECT substr(code, 1, ${SUBCLASS_LENGTH}) AS sub, count(DISTINCT pub_number) AS c
           FROM publication_codes WHERE scheme = 'ipc' GROUP BY sub ORDER BY c DESC`,
        )
        .all() as unknown as Row[]
      const byIpcSubclass: Record<string, number> = {}
      for (const row of codes) byIpcSubclass[str(row.sub)] = num(row.c)
      return {
        publications: one('SELECT count(*) AS c FROM publications'),
        withFulltext: one('SELECT count(*) AS c FROM publications WHERE has_fulltext = 1'),
        paragraphs: one('SELECT count(*) AS c FROM paragraphs'),
        chunks: one('SELECT count(*) AS c FROM chunks'),
        batches: one('SELECT count(*) AS c FROM import_batches'),
        extractFailures: one('SELECT count(*) AS c FROM extract_failures'),
        byIpcSubclass,
        tokenizerVersion: TOKENIZER_VERSION,
        indexStale: stale,
      }
    },

    recordExtractFailure(input) {
      insertFailure.run(
        randomUUID(),
        input.pdfPath,
        input.pubNumber ?? null,
        input.reason,
        now().toISOString(),
      )
    },

    extractFailures() {
      const rows = db
        .prepare('SELECT * FROM extract_failures ORDER BY detected_at DESC')
        .all() as unknown as Row[]
      return rows.map((r) => ({
        id: str(r.id),
        pdfPath: str(r.pdf_path),
        pubNumber: nullableStr(r.pub_number),
        reason: str(r.reason),
        detectedAt: str(r.detected_at),
      }))
    },

    optimize() {
      db.exec("INSERT INTO paragraphs_ngram (paragraphs_ngram) VALUES ('optimize')")
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    },

    rebuildIndex() {
      // 索引を捨てて原文から作り直す。トークン化の版が変わったときの唯一の正しい復旧手段。
      const count = transaction(() => {
        db.exec("INSERT INTO paragraphs_ngram (paragraphs_ngram) VALUES ('delete-all')")
        const rows = db
          .prepare('SELECT id, text FROM paragraphs ORDER BY id')
          .all() as unknown as Row[]
        for (const row of rows) insertNgram.run(num(row.id), indexTokens(str(row.text)))
        db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
          META_TOKENIZER_VERSION,
          String(TOKENIZER_VERSION),
        )
        return rows.length
      })
      stale = false
      db.exec("INSERT INTO paragraphs_ngram (paragraphs_ngram) VALUES ('optimize')")
      return { paragraphs: count }
    },

    indexStale() {
      return stale
    },

    raw() {
      return db
    },

    close() {
      db.close()
    },
  }
}
