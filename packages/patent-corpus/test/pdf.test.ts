import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractPdfText, guessPubNumberFromFilename, splitPdfParagraphs } from '../src/adapters/pdf'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tenkyo-pdf-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('extractPdfText', () => {
  it('pdftotext が無ければ tool_missing を返し、入れ方を告げる', () => {
    const r = extractPdfText(join(dir, 'x.pdf'), '/nonexistent/pdftotext')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('tool_missing')
    expect(r.detail).toMatch(/brew install poppler/)
  })

  it('コマンドが異常終了したら failed を返す（成功を装わない）', () => {
    // /usr/bin/false は必ず非 0 で終わる。
    const r = extractPdfText(join(dir, 'x.pdf'), '/usr/bin/false')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('failed')
  })

  it('取れた文字が少なすぎれば no_text_layer と判断する（OCR が必要な PDF）', () => {
    // /usr/bin/true は成功して何も出力しない = テキストレイヤ無しと同じ状況。
    const r = extractPdfText(join(dir, 'x.pdf'), '/usr/bin/true')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no_text_layer')
    expect(r.detail).toMatch(/OCR/)
  })

  it('十分な文字が取れれば ok を返す', () => {
    const fake = join(dir, 'fake-pdftotext')
    writeFileSync(
      fake,
      '#!/bin/sh\necho "【0001】本発明は視線検出装置に関するものであって、瞳孔の中心座標を算出する。"\n',
      {
        mode: 0o755,
      },
    )
    const r = extractPdfText(join(dir, 'x.pdf'), fake)
    expect(r.ok).toBe(true)
    expect(r.reason).toBe('ok')
    expect(r.text).toContain('瞳孔')
  })
})

describe('splitPdfParagraphs', () => {
  it('隅付き括弧の段落番号で区切る', () => {
    const text = '【0001】本発明は視線検出装置に関する。\n【0002】従来技術では瞳孔を検出する。\n'
    expect(splitPdfParagraphs(text)).toEqual([
      { paraNo: '0001', text: '本発明は視線検出装置に関する。' },
      { paraNo: '0002', text: '従来技術では瞳孔を検出する。' },
    ])
  })

  it('段落番号より前の前置き（表紙など）は捨てる', () => {
    const text = '特開2018-134274\n(19)日本国特許庁\n【0001】本発明は…。'
    const out = splitPdfParagraphs(text)
    expect(out).toHaveLength(1)
    expect(out[0]?.paraNo).toBe('0001')
  })

  it('組版で入った改行と空白を畳む', () => {
    const text = '【0001】本発明は、\n  視線検出\n装置に関する。'
    expect(splitPdfParagraphs(text)[0]?.text).toBe('本発明は、視線検出装置に関する。')
  })

  it('中身が空の段落は捨てる', () => {
    expect(splitPdfParagraphs('【0001】   \n【0002】あり')).toEqual([
      { paraNo: '0002', text: 'あり' },
    ])
  })

  it('段落番号が 1 つも無ければ空を返す', () => {
    expect(splitPdfParagraphs('段落番号のない文書')).toEqual([])
  })

  it('4 桁でない番号は段落番号として扱わない', () => {
    expect(splitPdfParagraphs('【12】これは段落番号ではない')).toEqual([])
  })
})

// --- F-13 の回帰 ------------------------------------------------------------
// 以前はフルパス全体に正規表現をかけていたため、日付ディレクトリやバックアップ用の
// ディレクトリ名を公報番号として拾っていた。
describe('guessPubNumberFromFilename', () => {
  it('ファイル名から公報番号を取る', () => {
    expect(guessPubNumberFromFilename('/Volumes/JPO/2018/JP2018134274A.pdf')).toBe('JP2018134274')
  })

  it('ディレクトリ名は見ない', () => {
    expect(guessPubNumberFromFilename('/media/20240101/scan.pdf')).toBeNull()
    expect(guessPubNumberFromFilename('/backup/2019-0001234/JP2018134274A.pdf')).toBe(
      'JP2018134274',
    )
    expect(guessPubNumberFromFilename('/x/公報_20200401/a.pdf')).toBeNull()
  })

  it('候補が 2 通り以上あるファイル名は推定しない（迷ったら止まる）', () => {
    expect(guessPubNumberFromFilename('/x/JP2018134274_vs_JP2019000001.pdf')).toBeNull()
  })

  it('同じ番号が 2 回出てくるだけなら推定できる', () => {
    expect(guessPubNumberFromFilename('/x/JP2018134274_JP2018134274.pdf')).toBe('JP2018134274')
  })

  it('番号らしきものが無ければ null', () => {
    expect(guessPubNumberFromFilename('/x/scan.pdf')).toBeNull()
  })
})
