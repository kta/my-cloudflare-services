/*
 * 受領媒体に「実物を見て答えさせる」道具。
 *
 * バルクデータの中身（ディレクトリ構成・列名・タグ名・PDF にテキストレイヤがあるか）は
 * 一次情報で確認できなかった。特許庁のサイトは機械的な取得を拒否し、提供データ一覧の
 * xlsx も本文が取れなかった。
 *
 * この状況で正しい振る舞いは「仕様書を推測で埋めてインポータを書く」ではなく、
 * **実物のディレクトリを走査して事実を報告する**ことである。probe の出力を見てから
 * マッピング（tsv.ts / xml.ts）を確定させる。
 */

import { spawnSync } from 'node:child_process'
import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

export interface ProbeOptions {
  /** ヘッダやタグを覗くために中身を読むファイル数の上限。0 なら覗かない。 */
  sampleLimit: number
  pdftotextPath?: string
  /** 走査を打ち切るファイル数の上限（16TB を全部歩かないため）。 */
  maxFiles?: number
}

export interface ExtensionSummary {
  count: number
  bytes: number
}

export interface ProbeResult {
  root: string
  totalFiles: number
  totalBytes: number
  /** 直下を 0 とした、ファイルを含むディレクトリの最大の入れ子の深さ。 */
  maxDepth: number
  truncated: boolean
  byExtension: Record<string, ExtensionSummary>
  samples: string[]
  tsvHeaders: Record<string, string[]>
  xmlRoots: Record<string, string>
  xmlElements: Record<string, Record<string, number>>
  pdfTextLayer: {
    checked: number
    withText: number
    withoutText: number
    note: string | null
  }
}

const DEFAULT_MAX_FILES = 200_000
const SAMPLE_BYTES = 64 * 1024
const XML_ELEMENT_TOP = 12

interface Found {
  path: string
  size: number
  depth: number
}

async function walk(
  root: string,
  maxFiles: number,
): Promise<{ files: Found[]; truncated: boolean }> {
  const files: Found[] = []
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  let truncated = false
  while (queue.length > 0) {
    const head = queue.shift()
    if (!head) break
    let entries: Dirent[]
    try {
      entries = await readdir(head.dir, { withFileTypes: true })
    } catch {
      // 読めないディレクトリ（権限・破損）は飛ばす。走査全体を落とさない。
      continue
    }
    for (const entry of entries) {
      const full = join(head.dir, entry.name)
      if (entry.isDirectory()) {
        queue.push({ dir: full, depth: head.depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      if (files.length >= maxFiles) {
        truncated = true
        return { files, truncated }
      }
      try {
        const s = await stat(full)
        files.push({ path: full, size: s.size, depth: head.depth })
      } catch {}
    }
  }
  return { files, truncated }
}

function hasTextLayer(pdfPath: string, pdftotextPath: string): boolean | null {
  const r = spawnSync(pdftotextPath, ['-l', '1', '-q', pdfPath, '-'], {
    encoding: 'utf8',
    timeout: 15_000,
  })
  if (r.error || r.status !== 0) return null
  return (r.stdout ?? '').replace(/\s/g, '').length > 20
}

export async function probeMedia(root: string, options: ProbeOptions): Promise<ProbeResult> {
  const { files, truncated } = await walk(root, options.maxFiles ?? DEFAULT_MAX_FILES)

  const byExtension: Record<string, ExtensionSummary> = {}
  let totalBytes = 0
  let maxDepth = 0
  for (const f of files) {
    const ext = extname(f.path).toLowerCase() || '(none)'
    const bucket = byExtension[ext] ?? { count: 0, bytes: 0 }
    bucket.count++
    bucket.bytes += f.size
    byExtension[ext] = bucket
    totalBytes += f.size
    if (f.depth > maxDepth) maxDepth = f.depth
  }

  const samples = files.slice(0, options.sampleLimit).map((f) => f.path)
  const tsvHeaders: Record<string, string[]> = {}
  const xmlRoots: Record<string, string> = {}
  const xmlElements: Record<string, Record<string, number>> = {}

  for (const f of files.slice(0, options.sampleLimit)) {
    const ext = extname(f.path).toLowerCase()
    const key = relative(root, f.path)
    if (ext === '.tsv' || ext === '.csv' || ext === '.txt') {
      try {
        const head = (await readFile(f.path)).subarray(0, SAMPLE_BYTES).toString('utf8')
        const first = head.split(/\r?\n/)[0]
        if (first) {
          const delimiter = ext === '.csv' ? ',' : '\t'
          tsvHeaders[key] = first.split(delimiter).map((h) => h.trim())
        }
      } catch {
        // 読めなければ報告しない。probe は失敗で止まる道具ではない。
      }
    }
    if (ext === '.xml' || ext === '.sgml') {
      try {
        const head = (await readFile(f.path)).subarray(0, SAMPLE_BYTES).toString('utf8')
        const rootTag = /<([A-Za-z_][\w.:-]*)/.exec(head.replace(/<\?[\s\S]*?\?>/g, ''))
        if (rootTag?.[1]) xmlRoots[key] = rootTag[1]
        const counts: Record<string, number> = {}
        for (const m of head.matchAll(/<([A-Za-z_][\w.:-]*)/g)) {
          const tag = m[1] as string
          counts[tag] = (counts[tag] ?? 0) + 1
        }
        xmlElements[key] = Object.fromEntries(
          Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, XML_ELEMENT_TOP),
        )
      } catch {
        // 同上
      }
    }
  }

  const pdfs = files.filter((f) => extname(f.path).toLowerCase() === '.pdf')
  const pdftotextPath = options.pdftotextPath ?? 'pdftotext'
  let checked = 0
  let withText = 0
  let withoutText = 0
  let note: string | null = null
  for (const f of pdfs.slice(0, options.sampleLimit)) {
    const r = hasTextLayer(f.path, pdftotextPath)
    if (r === null) {
      note = `${pdftotextPath} を実行できなかったため、PDF のテキストレイヤの有無は未判定。macOS では \`brew install poppler\` で入る。`
      break
    }
    checked++
    if (r) withText++
    else withoutText++
  }
  if (pdfs.length > 0 && checked === 0 && note === null) {
    note = 'PDF は見つかったが、sampleLimit が 0 のため中身を確認していない。'
  }

  return {
    root,
    totalFiles: files.length,
    totalBytes,
    maxDepth,
    truncated,
    byExtension,
    samples,
    tsvHeaders,
    xmlRoots,
    xmlElements,
    pdfTextLayer: { checked, withText, withoutText, note },
  }
}
