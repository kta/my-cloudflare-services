import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Corpus, openCorpus } from '../src/corpus'
import { synthesizePublications } from '../src/synth'

let dir: string
let corpus: Corpus

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tenkyo-'))
  corpus = openCorpus(join(dir, 'corpus.db'))
})
afterEach(() => {
  corpus.close()
  rmSync(dir, { recursive: true, force: true })
})

const PUB = {
  pubNumber: '特開2018-134274',
  country: 'JP',
  kind: 'A' as const,
  appNumber: '特願2017-021234',
  filingDate: '2017-02-08',
  pubDate: '2018-08-30',
  regDate: null,
  title: '視線検出装置および眼鏡レンズ設計方法',
  applicants: ['株式会社ニコン・エシロール'],
  inventors: ['田中一郎'],
  ipc: ['G06F3/01', 'G02C13/00'],
  fi: ['G06F3/01,310A'],
  fterm: ['5B087AA00'],
  abstract: '眼部画像から瞳孔中心を検出し、視線方向を算出する。',
  pdfPath: '/Volumes/JPO/2018/JP2018134274A.pdf',
}

const PARAS = [
  {
    paraNo: 'C001',
    section: 'claim' as const,
    text: '撮像部が利用者の眼部を撮像する視線検出装置。',
  },
  {
    paraNo: '0032',
    section: 'desc' as const,
    text: '撮像部12により取得された眼部画像に対して、輝度勾配に基づく円形状検出を適用し、瞳孔の中心座標を算出する。',
  },
  {
    paraNo: '0033',
    section: 'desc' as const,
    text: '前記瞳孔検出部は、赤外光照射下で撮像された画像から、暗瞳孔法により瞳孔領域を抽出する。',
  },
]

describe('openCorpus', () => {
  it('同じパスを開き直しても、取り込んだデータが残っている（永続化）', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'HDD-01', sourcePath: dir, productName: 'test' })
    corpus.putPublication(PUB, batch)
    corpus.close()
    corpus = openCorpus(join(dir, 'corpus.db'))
    expect(corpus.getPublication(PUB.pubNumber)?.title).toBe(PUB.title)
  })

  it('スキーマを二度作っても壊れない（冪等な初期化）', () => {
    corpus.close()
    corpus = openCorpus(join(dir, 'corpus.db'))
    expect(corpus.stats().publications).toBe(0)
  })
})

describe('putPublication', () => {
  it('同じ公報番号を二度入れると上書きされ、件数は増えない', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'HDD-01', sourcePath: dir, productName: 'test' })
    corpus.putPublication(PUB, batch)
    corpus.putPublication({ ...PUB, title: '改訂された名称' }, batch)
    expect(corpus.stats().publications).toBe(1)
    expect(corpus.getPublication(PUB.pubNumber)?.title).toBe('改訂された名称')
  })

  it('配列のフィールドは往復して同じ配列に戻る', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'HDD-01', sourcePath: dir, productName: 'test' })
    corpus.putPublication(PUB, batch)
    expect(corpus.getPublication(PUB.pubNumber)?.ipc).toEqual(['G06F3/01', 'G02C13/00'])
  })
})

describe('putParagraphs', () => {
  it('段落を入れると has_fulltext が立つ', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'HDD-01', sourcePath: dir, productName: 'test' })
    corpus.putPublication(PUB, batch)
    expect(corpus.getPublication(PUB.pubNumber)?.hasFulltext).toBe(false)
    corpus.putParagraphs(PUB.pubNumber, PARAS)
    expect(corpus.getPublication(PUB.pubNumber)?.hasFulltext).toBe(true)
  })

  it('段落番号で原文を引ける（典拠の照合がこれに依存する）', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'HDD-01', sourcePath: dir, productName: 'test' })
    corpus.putPublication(PUB, batch)
    corpus.putParagraphs(PUB.pubNumber, PARAS)
    expect(corpus.getParagraph(PUB.pubNumber, '0032')?.text).toContain('円形状検出')
  })

  it('無い段落番号は null を返す', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'HDD-01', sourcePath: dir, productName: 'test' })
    corpus.putPublication(PUB, batch)
    corpus.putParagraphs(PUB.pubNumber, PARAS)
    expect(corpus.getParagraph(PUB.pubNumber, '9999')).toBeNull()
  })

  it('入れ直すと古い段落は消える（差分取り込みで幽霊段落を残さない）', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'HDD-01', sourcePath: dir, productName: 'test' })
    corpus.putPublication(PUB, batch)
    corpus.putParagraphs(PUB.pubNumber, PARAS)
    corpus.putParagraphs(PUB.pubNumber, [PARAS[0] as (typeof PARAS)[number]])
    expect(corpus.getParagraph(PUB.pubNumber, '0032')).toBeNull()
    expect(corpus.getParagraph(PUB.pubNumber, 'C001')).not.toBeNull()
  })
})

describe('search', () => {
  beforeEach(() => {
    const batch = corpus.beginBatch({ mediaLabel: 'HDD-01', sourcePath: dir, productName: 'test' })
    corpus.putPublication(PUB, batch)
    corpus.putParagraphs(PUB.pubNumber, PARAS)
    const other = {
      ...PUB,
      pubNumber: '特開2020-000001',
      title: '半導体装置',
      ipc: ['H01L21/02'],
      pubDate: '2020-01-07',
    }
    corpus.putPublication(other, batch)
    corpus.putParagraphs(other.pubNumber, [
      { paraNo: '0010', section: 'desc', text: '半導体基板上に形成された電極を樹脂層で覆う。' },
    ])
  })

  it('2 文字の技術用語で引ける（trigram では引けなかった要件）', () => {
    const r = corpus.search({ terms: ['瞳孔'] })
    expect(r.hits.length).toBeGreaterThan(0)
    expect(r.hits.every((h) => h.text.includes('瞳孔'))).toBe(true)
  })

  it('原文に連続して存在しない文字並びはヒットしない（偽陽性を出さない）', () => {
    expect(corpus.search({ terms: ['瞳基'] }).hits).toHaveLength(0)
  })

  it('複数語は AND で効く', () => {
    expect(corpus.search({ terms: ['瞳孔', '電極'] }).hits).toHaveLength(0)
    expect(corpus.search({ terms: ['瞳孔', '中心'] }).hits.length).toBeGreaterThan(0)
  })

  it('IPC の前方一致で絞れる', () => {
    expect(corpus.search({ terms: ['撮像'], ipcPrefix: 'G06F3' }).hits.length).toBeGreaterThan(0)
    expect(corpus.search({ terms: ['電極'], ipcPrefix: 'G06F3' }).hits).toHaveLength(0)
  })

  it('公開日の範囲で絞れる', () => {
    expect(corpus.search({ terms: ['電極'], pubDateTo: '2019-12-31' }).hits).toHaveLength(0)
    expect(corpus.search({ terms: ['電極'], pubDateFrom: '2020-01-01' }).hits.length).toBe(1)
  })

  it('請求項だけに絞れる', () => {
    const r = corpus.search({ terms: ['撮像'], sections: ['claim'] })
    expect(r.hits.every((h) => h.section === 'claim')).toBe(true)
  })

  it('検索式・ヒット件数・実行時刻を記録として返す（調査報告書と再現性のため）', () => {
    const r = corpus.search({ terms: ['瞳孔'] })
    expect(r.matchExpression).toBe('"瞳孔"')
    expect(r.compiledSql).toContain('paragraphs_ngram')
    expect(r.hitCount).toBe(r.hits.length)
    expect(r.executedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('同じ検索を二度実行すると、同じ順序・同じ件数になる（再現性）', () => {
    const a = corpus.search({ terms: ['瞳孔'] })
    const b = corpus.search({ terms: ['瞳孔'] })
    expect(b.hits.map((h) => [h.pubNumber, h.paraNo])).toEqual(
      a.hits.map((h) => [h.pubNumber, h.paraNo]),
    )
  })

  it('検索語が実質空なら、全件を返さずに 0 件と理由を返す', () => {
    const r = corpus.search({ terms: ['、'] })
    expect(r.hits).toHaveLength(0)
    expect(r.matchExpression).toBeNull()
  })

  it('limit と offset で頁送りできる', () => {
    const all = corpus.search({ terms: ['瞳孔'], limit: 100 })
    const first = corpus.search({ terms: ['瞳孔'], limit: 1, offset: 0 })
    const second = corpus.search({ terms: ['瞳孔'], limit: 1, offset: 1 })
    expect(first.hits[0]?.paraNo).toBe(all.hits[0]?.paraNo)
    expect(second.hits[0]?.paraNo).toBe(all.hits[1]?.paraNo)
  })

  it('検索語を含む位置を snippet の範囲として返す', () => {
    const r = corpus.search({ terms: ['円形状検出'] })
    const hit = r.hits[0]
    expect(hit).toBeDefined()
    expect(hit?.snippet).toContain('円形状検出')
  })
})

describe('stats', () => {
  it('取り込み件数・全文あり件数・IPC 別件数を返す', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'HDD-01', sourcePath: dir, productName: 'test' })
    for (const p of synthesizePublications({ count: 20, seed: 7 })) {
      corpus.putPublication(p.publication, batch)
      corpus.putParagraphs(p.publication.pubNumber, p.paragraphs)
    }
    const s = corpus.stats()
    expect(s.publications).toBe(20)
    expect(s.withFulltext).toBe(20)
    expect(s.paragraphs).toBeGreaterThan(20)
    expect(Object.keys(s.byIpcSubclass).length).toBeGreaterThan(0)
  })

  it('バッチを閉じると件数と終了時刻が記録される', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'HDD-01', sourcePath: dir, productName: 'test' })
    corpus.putPublication(PUB, batch)
    corpus.finishBatch(batch)
    const b = corpus.batches()[0]
    expect(b?.publicationCount).toBe(1)
    expect(b?.finishedAt).not.toBeNull()
  })
})

describe('extract failures', () => {
  it('抽出に失敗した公報は握りつぶさず記録される', () => {
    corpus.recordExtractFailure({
      pdfPath: '/Volumes/JPO/broken.pdf',
      pubNumber: '特開2019-999999',
      reason: 'no_text_layer',
    })
    const f = corpus.extractFailures()
    expect(f).toHaveLength(1)
    expect(f[0]?.reason).toBe('no_text_layer')
  })
})
