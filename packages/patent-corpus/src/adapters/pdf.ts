/*
 * PDF からのテキスト抽出。**第3の経路（フォールバック）である。**
 *
 * 一次情報の確認では、公報は XML から自動組版されており、元 XML が併存する。つまり
 * 正しい順序は「TSV（書誌）→ XML（全文）→ PDF（どちらも無い場合だけ）」である。
 * PDF を主経路にする設計にはしない。
 *
 * テキストレイヤが無い PDF（OCR が必要）は、握りつぶさず extract_failures に記録する。
 * 16TB 全件の OCR は現実的でないため、OCR は個別公報の必要時にだけ行う運用にする。
 */

import { spawnSync } from 'node:child_process'

export interface PdfExtractResult {
  ok: boolean
  text: string
  reason: 'ok' | 'no_text_layer' | 'tool_missing' | 'failed'
  detail: string | null
}

/** これ未満の文字数しか取れなければ、テキストレイヤが無い（画像 PDF）と見なす。 */
const MIN_TEXT_CHARS = 40

export function extractPdfText(pdfPath: string, pdftotextPath = 'pdftotext'): PdfExtractResult {
  const r = spawnSync(pdftotextPath, ['-layout', '-enc', 'UTF-8', '-q', pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  })
  if (r.error) {
    const missing = (r.error as NodeJS.ErrnoException).code === 'ENOENT'
    return {
      ok: false,
      text: '',
      reason: missing ? 'tool_missing' : 'failed',
      detail: missing
        ? `${pdftotextPath} が見つからない。macOS では \`brew install poppler\` で入る。`
        : r.error.message,
    }
  }
  if (r.status !== 0) {
    return { ok: false, text: '', reason: 'failed', detail: r.stderr?.trim() || `exit ${r.status}` }
  }
  const text = r.stdout ?? ''
  if (text.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
    return {
      ok: false,
      text: '',
      reason: 'no_text_layer',
      detail: 'テキストレイヤが無い（画像 PDF）と判断した。OCR が必要。',
    }
  }
  return { ok: true, text, reason: 'ok', detail: null }
}

/**
 * pdftotext の出力から段落番号つきの段落を切り出す。
 * 公報の本文は【0001】のような隅付き括弧つきの段落番号で始まる。
 */
export function splitPdfParagraphs(text: string): { paraNo: string; text: string }[] {
  const out: { paraNo: string; text: string }[] = []
  const re = /【(\d{4})】([\s\S]*?)(?=【\d{4}】|$)/g
  for (const m of text.matchAll(re)) {
    const body = (m[2] ?? '').replace(/\s+/g, '').trim()
    if (body.length === 0) continue
    out.push({ paraNo: m[1] as string, text: body })
  }
  return out
}

/**
 * ファイル名から公報番号を推定する。
 *
 * **ファイル名だけを見る。** 以前はフルパス全体に正規表現をかけていたため、
 * `/media/20240101/scan.pdf` の日付ディレクトリや `/backup/2019-0001234/...` の
 * ディレクトリ名を公報番号として拾っていた（実測で確認）。存在しない公報番号の下に
 * 本物の本文が入ると、以後その本文への引用が照合を通ってしまう。
 *
 * 候補が 2 通り以上あるファイル名は**推定しない**（null を返して失敗として記録させる）。
 * 実データの命名規則は未確認なので、迷ったら止まるほうが正しい。
 */
export function guessPubNumberFromFilename(fileName: string): string | null {
  const base = fileName.replace(/^.*[/\\]/, '').replace(/\.[^.]*$/, '')
  const matches = [...base.matchAll(/[A-Z]{0,2}\d{4}[-_]?\d{4,7}/g)].map((m) => m[0])
  const unique = [...new Set(matches)]
  return unique.length === 1 ? (unique[0] as string) : null
}
