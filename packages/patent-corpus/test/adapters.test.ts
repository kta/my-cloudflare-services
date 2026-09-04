import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { probeMedia } from '../src/adapters/probe'
import { DEFAULT_TSV_MAPPING, parseTsv, type TsvMapping } from '../src/adapters/tsv'
import { DEFAULT_XML_MAPPING, decodeEntities, parseGazetteXml } from '../src/adapters/xml'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tenkyo-media-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// 受領媒体の実物の形は未確認である。だから仕様書を読む前に **実物に聞く** 道具を先に作る。
describe('probeMedia', () => {
  it('拡張子ごとの件数と合計サイズを数える', async () => {
    mkdirSync(join(dir, '2018'), { recursive: true })
    writeFileSync(join(dir, '2018', 'a.pdf'), 'x'.repeat(100))
    writeFileSync(join(dir, '2018', 'b.pdf'), 'x'.repeat(200))
    writeFileSync(join(dir, 'index.tsv'), 'a\tb\n')
    const r = await probeMedia(dir, { sampleLimit: 0 })
    expect(r.byExtension['.pdf']?.count).toBe(2)
    expect(r.byExtension['.pdf']?.bytes).toBe(300)
    expect(r.byExtension['.tsv']?.count).toBe(1)
    expect(r.totalFiles).toBe(3)
  })

  it('ディレクトリ構成の深さと代表パスを報告する', async () => {
    mkdirSync(join(dir, 'A', 'B', 'C'), { recursive: true })
    writeFileSync(join(dir, 'A', 'B', 'C', 'deep.xml'), '<a/>')
    const r = await probeMedia(dir, { sampleLimit: 5 })
    expect(r.maxDepth).toBe(3)
    expect(r.samples.some((s) => s.endsWith('deep.xml'))).toBe(true)
  })

  it('TSV の 1 行目をヘッダ候補として拾う（列名が未知なので実物から取る）', async () => {
    writeFileSync(
      join(dir, 'x.tsv'),
      '公報番号\t出願番号\t発明の名称\n特開2018-1\t特願2017-1\tなにか\n',
    )
    const r = await probeMedia(dir, { sampleLimit: 5 })
    expect(r.tsvHeaders['x.tsv']).toEqual(['公報番号', '出願番号', '発明の名称'])
  })

  it('XML のルート要素名と出現する要素名の上位を拾う', async () => {
    writeFileSync(
      join(dir, 'y.xml'),
      '<jp-official-gazette><p num="0001">あ</p><p num="0002">い</p><claim>う</claim></jp-official-gazette>',
    )
    const r = await probeMedia(dir, { sampleLimit: 5 })
    expect(r.xmlRoots['y.xml']).toBe('jp-official-gazette')
    expect(r.xmlElements['y.xml']?.p).toBe(2)
  })

  it('PDF のテキストレイヤの有無を判定できないときは「未判定」と正直に返す', async () => {
    writeFileSync(join(dir, 'z.pdf'), '%PDF-1.4 dummy')
    const r = await probeMedia(dir, { sampleLimit: 5, pdftotextPath: '/nonexistent/pdftotext' })
    expect(r.pdfTextLayer.checked).toBe(0)
    expect(r.pdfTextLayer.note).toMatch(/pdftotext/)
  })

  it('空のディレクトリでも落ちない', async () => {
    const r = await probeMedia(dir, { sampleLimit: 5 })
    expect(r.totalFiles).toBe(0)
    expect(r.maxDepth).toBe(0)
  })
})

describe('parseTsv', () => {
  const mapping: TsvMapping = {
    pubNumber: '公報番号',
    appNumber: '出願番号',
    filingDate: '出願日',
    pubDate: '公開日',
    title: '発明の名称',
    applicants: '出願人',
    ipc: 'IPC',
    abstract: '要約',
  }

  it('ヘッダ名でマッピングして公報を組み立てる', () => {
    const tsv = [
      '公報番号\t出願番号\t出願日\t公開日\t発明の名称\t出願人\tIPC\t要約',
      '特開2018-134274\t特願2017-021234\t20170208\t20180830\t視線検出装置\t株式会社ニコン\tG06F3/01\t要約文',
    ].join('\n')
    const rows = parseTsv(tsv, mapping)
    expect(rows).toHaveLength(1)
    const p = rows[0]
    expect(p?.pubNumber).toBe('特開2018-134274')
    expect(p?.filingDate).toBe('2017-02-08')
    expect(p?.pubDate).toBe('2018-08-30')
    expect(p?.applicants).toEqual(['株式会社ニコン'])
    expect(p?.ipc).toEqual(['G06F3/01'])
  })

  it('複数値の列は区切りで分割する', () => {
    const tsv = ['公報番号\t出願人\tIPC', '特開2018-1\tA社;B社\tG06F3/01;G02C13/00'].join('\n')
    const rows = parseTsv(tsv, { pubNumber: '公報番号', applicants: '出願人', ipc: 'IPC' })
    expect(rows[0]?.applicants).toEqual(['A社', 'B社'])
    expect(rows[0]?.ipc).toEqual(['G06F3/01', 'G02C13/00'])
  })

  it('すでに区切り済みの日付はそのまま通す', () => {
    const rows = parseTsv(['公報番号\t公開日', '特開2018-1\t2018-08-30'].join('\n'), {
      pubNumber: '公報番号',
      pubDate: '公開日',
    })
    expect(rows[0]?.pubDate).toBe('2018-08-30')
  })

  it('日付として解釈できない値は null にして落とさない', () => {
    const rows = parseTsv(['公報番号\t公開日', '特開2018-1\t不明'].join('\n'), {
      pubNumber: '公報番号',
      pubDate: '公開日',
    })
    expect(rows[0]?.pubDate).toBeNull()
  })

  it('公報番号が空の行は捨てる（主キーの無い行を入れない）', () => {
    const rows = parseTsv(['公報番号\t発明の名称', '\tなにか', '特開2018-1\tあり'].join('\n'), {
      pubNumber: '公報番号',
      title: '発明の名称',
    })
    expect(rows).toHaveLength(1)
  })

  it('マッピングに無いヘッダは無視する', () => {
    const rows = parseTsv(['公報番号\t謎の列', '特開2018-1\t値'].join('\n'), {
      pubNumber: '公報番号',
    })
    expect(rows).toHaveLength(1)
  })

  it('必須のヘッダが無ければ、黙って空を返さずに投げる', () => {
    expect(() => parseTsv('別の列\n値', { pubNumber: '公報番号' })).toThrow(/公報番号/)
  })

  it('CRLF と末尾の空行を扱える', () => {
    const rows = parseTsv('公報番号\r\n特開2018-1\r\n\r\n', { pubNumber: '公報番号' })
    expect(rows).toHaveLength(1)
  })

  it('既定のマッピングは特許情報標準データの列名を仮置きしており、要確認の目印を持つ', () => {
    expect(DEFAULT_TSV_MAPPING.unverified).toBe(true)
  })
})

describe('parseGazetteXml', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<jp-official-gazette>
  <publication-reference><doc-number>2018134274</doc-number></publication-reference>
  <invention-title>視線検出装置および眼鏡レンズ設計方法</invention-title>
  <claims>
    <claim num="1"><claim-text>撮像部が利用者の眼部を撮像する視線検出装置。</claim-text></claim>
    <claim num="2"><claim-text>請求項1に記載の装置であって、瞳孔検出部を備える装置。</claim-text></claim>
  </claims>
  <description>
    <p num="0001">本発明は、視線検出装置に関する。</p>
    <p num="0032">撮像部12により取得された眼部画像に対して、瞳孔の中心座標を算出する。</p>
  </description>
</jp-official-gazette>`

  it('請求項を C 始まりの段落番号で取り出す', () => {
    const r = parseGazetteXml(xml, DEFAULT_XML_MAPPING)
    const claims = r.paragraphs.filter((p) => p.section === 'claim')
    expect(claims.map((c) => c.paraNo)).toEqual(['C001', 'C002'])
    expect(claims[0]?.text).toContain('撮像部が利用者の眼部を撮像する')
  })

  it('明細書の段落を 4 桁ゼロ埋めの番号で取り出す', () => {
    const r = parseGazetteXml(xml, DEFAULT_XML_MAPPING)
    const descs = r.paragraphs.filter((p) => p.section === 'desc')
    expect(descs.map((d) => d.paraNo)).toEqual(['0001', '0032'])
    expect(descs[1]?.text).toContain('瞳孔の中心座標')
  })

  it('発明の名称と公報番号を取り出す', () => {
    const r = parseGazetteXml(xml, DEFAULT_XML_MAPPING)
    expect(r.title).toContain('視線検出装置')
    expect(r.docNumber).toBe('2018134274')
  })

  it('入れ子のタグを含む段落は、テキストだけを連結して取り出す', () => {
    const nested =
      '<description><p num="0005">前記<b>撮像部</b>は、<i>赤外光</i>を照射する。</p></description>'
    const r = parseGazetteXml(nested, DEFAULT_XML_MAPPING)
    expect(r.paragraphs[0]?.text).toBe('前記撮像部は、赤外光を照射する。')
  })

  it('実体参照を復元する', () => {
    const ent = '<description><p num="0001">A&amp;B&lt;C&gt;&quot;D&quot;&#65;</p></description>'
    const r = parseGazetteXml(ent, DEFAULT_XML_MAPPING)
    expect(r.paragraphs[0]?.text).toBe('A&B<C>"D"A')
  })

  it('num 属性が無い段落には出現順の番号を振る', () => {
    const noNum = '<description><p>あ</p><p>い</p></description>'
    const r = parseGazetteXml(noNum, DEFAULT_XML_MAPPING)
    expect(r.paragraphs.map((p) => p.paraNo)).toEqual(['0001', '0002'])
  })

  it('空の段落は捨てる', () => {
    const r = parseGazetteXml(
      '<description><p num="0001">  </p><p num="0002">あ</p></description>',
      DEFAULT_XML_MAPPING,
    )
    expect(r.paragraphs).toHaveLength(1)
  })

  it('要素が 1 つも見つからなければ空を返す（例外にしない — 別形式の可能性があるため）', () => {
    const r = parseGazetteXml('<other><thing>x</thing></other>', DEFAULT_XML_MAPPING)
    expect(r.paragraphs).toEqual([])
    expect(r.title).toBeNull()
  })

  it('既定のマッピングは要確認の目印を持つ', () => {
    expect(DEFAULT_XML_MAPPING.unverified).toBe(true)
  })
})

// --- F-12 の回帰 ------------------------------------------------------------
describe('parseGazetteXml の欠陥回帰', () => {
  it('属性名の部分一致で番号を拾わない（data-num を num と取り違えない）', () => {
    const xml = '<description><p data-num="9999" num="0001">段落C</p></description>'
    expect(parseGazetteXml(xml, DEFAULT_XML_MAPPING).paragraphs[0]?.paraNo).toBe('0001')
  })

  it('段落番号が重複したら、黙って通さず問題として報告する', () => {
    const xml = '<description><p num="0001">あ</p><p num="0001">い</p></description>'
    const r = parseGazetteXml(xml, DEFAULT_XML_MAPPING)
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0]).toContain('0001')
    expect(r.paragraphs).toHaveLength(1)
  })

  it('番号が抜けた段落には直前の番号の次を振る（出現順に振り直さない）', () => {
    const xml = '<description><p num="0002">段落A</p><p>段落B</p></description>'
    const r = parseGazetteXml(xml, DEFAULT_XML_MAPPING)
    expect(r.paragraphs.map((p) => p.paraNo)).toEqual(['0002', '0003'])
    expect(r.issues).toEqual([])
  })

  it('番号が抜けた請求項も直前の番号の次になる', () => {
    const xml = '<claims><claim num="3">請求項3</claim><claim>番号なし</claim></claims>'
    const r = parseGazetteXml(xml, DEFAULT_XML_MAPPING)
    expect(r.paragraphs.map((p) => p.paraNo)).toEqual(['C003', 'C004'])
  })

  it('Unicode の範囲外の実体参照で落ちない（取り込み全体を止めない）', () => {
    expect(decodeEntities('&#x110000;')).toBe('&#x110000;')
    expect(decodeEntities('&#99999999;')).toBe('&#99999999;')
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;')
    expect(decodeEntities('&#65;')).toBe('A')
  })
})
