import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSnippet, type Corpus, escapeLike, openCorpus } from '../src/corpus'

/*
 * レビューで実際に再現された欠陥の回帰テスト。
 * どれも「161 件 green・カバレッジ 95%」の下を素通りしていたので、ここで塞ぐ。
 */

let dir: string
let corpus: Corpus
const fixedNow = () => new Date('2026-03-01T04:05:06.000Z')

function pub(pubNumber: string, over: Record<string, unknown> = {}) {
  return {
    pubNumber,
    country: 'JP',
    kind: 'A',
    appNumber: null,
    filingDate: null,
    pubDate: '2018-08-30',
    regDate: null,
    title: '視線検出装置',
    applicants: ['株式会社ニコン'],
    inventors: [],
    ipc: ['G06F3/01'],
    fi: [],
    fterm: [],
    abstract: null,
    pdfPath: null,
    ...over,
  } as Parameters<Corpus['putPublication']>[0]
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tenkyo-reg-'))
  corpus = openCorpus(join(dir, 'corpus.db'), { now: fixedNow })
})
afterEach(() => {
  corpus.close()
  rmSync(dir, { recursive: true, force: true })
})

// --- F-17 -----------------------------------------------------------------
describe('時刻は注入できる（実時計に依存させない）', () => {
  it('取り込みと検索の時刻が注入した値になる', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'm', sourcePath: dir, productName: 'p' })
    corpus.putPublication(pub('特開2018-1'), batch)
    corpus.putParagraphs('特開2018-1', [
      { paraNo: '0001', section: 'desc', text: '瞳孔の中心座標を算出する装置である。' },
    ])
    expect(corpus.batches()[0]?.startedAt).toBe('2026-03-01T04:05:06.000Z')
    expect(corpus.search({ terms: ['瞳孔'] }).executedAt).toBe('2026-03-01T04:05:06.000Z')
    expect(corpus.getPublication('特開2018-1')?.importedAt).toBe('2026-03-01T04:05:06.000Z')
  })
})

// --- F-2 ------------------------------------------------------------------
describe('トークン化の版が食い違う索引', () => {
  it('版を刻んでおり、統計に出る', () => {
    expect(corpus.stats().tokenizerVersion).toBeGreaterThan(0)
    expect(corpus.stats().indexStale).toBe(false)
  })

  it('版が違う DB への書き込みは拒否される（索引を静かに壊さない）', () => {
    const path = join(dir, 'corpus.db')
    corpus.raw().prepare('UPDATE meta SET value = ? WHERE key = ?').run('0', 'tokenizer_version')
    corpus.close()
    corpus = openCorpus(path, { now: fixedNow })
    expect(corpus.indexStale()).toBe(true)
    expect(() => corpus.beginBatch({ mediaLabel: 'm', sourcePath: dir, productName: 'p' })).toThrow(
      /rebuild-index/,
    )
  })

  it('rebuild-index で索引を作り直せば、また書き込める', () => {
    const path = join(dir, 'corpus.db')
    const batch = corpus.beginBatch({ mediaLabel: 'm', sourcePath: dir, productName: 'p' })
    corpus.putPublication(pub('特開2018-1'), batch)
    corpus.putParagraphs('特開2018-1', [
      { paraNo: '0001', section: 'desc', text: '瞳孔の中心座標を算出する装置である。' },
    ])
    corpus.raw().prepare('UPDATE meta SET value = ? WHERE key = ?').run('0', 'tokenizer_version')
    corpus.close()

    corpus = openCorpus(path, { now: fixedNow })
    expect(corpus.rebuildIndex().paragraphs).toBe(1)
    expect(corpus.indexStale()).toBe(false)
    expect(corpus.search({ terms: ['瞳孔'] }).hitCount).toBe(1)
    expect(() =>
      corpus.beginBatch({ mediaLabel: 'm2', sourcePath: dir, productName: 'p' }),
    ).not.toThrow()
  })
})

// --- F-4 ------------------------------------------------------------------
describe('段落の入れ替えは 1 つの取引で行う', () => {
  it('段落番号が重複した入力は拒否し、既存の段落を壊さない', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'm', sourcePath: dir, productName: 'p' })
    corpus.putPublication(pub('特開2018-1'), batch)
    corpus.putParagraphs('特開2018-1', [
      { paraNo: '0001', section: 'desc', text: '瞳孔の中心座標を算出する装置である。' },
      { paraNo: '0002', section: 'desc', text: '赤外光を照射して眼部を撮像する。' },
    ])
    expect(() =>
      corpus.putParagraphs('特開2018-1', [
        { paraNo: '0001', section: 'desc', text: 'あ' },
        { paraNo: '0001', section: 'desc', text: 'い' },
      ]),
    ).toThrow(/重複/)
    // 既存の段落が消えていないこと（照合できるはずの典拠が却下に化けない）
    expect(corpus.listParagraphs('特開2018-1')).toHaveLength(2)
    expect(corpus.getParagraph('特開2018-1', '0002')).not.toBeNull()
  })

  it('段落の id は再利用されない（索引の posting が別の段落に化けない）', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'm', sourcePath: dir, productName: 'p' })
    corpus.putPublication(pub('特開2018-1'), batch)
    corpus.putParagraphs('特開2018-1', [
      { paraNo: '0001', section: 'desc', text: '瞳孔の中心座標を算出する装置である。' },
    ])
    const first = corpus.raw().prepare('SELECT id FROM paragraphs').get() as { id: number }
    corpus.putParagraphs('特開2018-1', [])
    corpus.putParagraphs('特開2018-1', [
      { paraNo: '0001', section: 'desc', text: '半導体基板上に電極を形成する方法である。' },
    ])
    const second = corpus.raw().prepare('SELECT id FROM paragraphs').get() as { id: number }
    expect(second.id).toBeGreaterThan(first.id)
  })

  it('入れ直したあと、古い本文は検索で引けない（索引に幽霊が残らない）', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'm', sourcePath: dir, productName: 'p' })
    corpus.putPublication(pub('特開2018-1'), batch)
    corpus.putParagraphs('特開2018-1', [
      { paraNo: '0001', section: 'desc', text: '瞳孔の中心座標を算出する装置である。' },
    ])
    expect(corpus.search({ terms: ['瞳孔'] }).hitCount).toBe(1)
    corpus.putParagraphs('特開2018-1', [
      { paraNo: '0001', section: 'desc', text: '半導体基板上に電極を形成する方法である。' },
    ])
    expect(corpus.search({ terms: ['瞳孔'] }).hitCount).toBe(0)
    expect(corpus.search({ terms: ['電極'] }).hitCount).toBe(1)
  })
})

// --- F-5 ------------------------------------------------------------------
describe('取り込めた部分を記録する', () => {
  it('請求項だけ取り込んだ公報は sectionsIngested が claim だけになる', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'm', sourcePath: dir, productName: 'p' })
    corpus.putPublication(pub('特開2018-1'), batch)
    corpus.putParagraphs('特開2018-1', [
      { paraNo: 'C001', section: 'claim', text: '撮像部を備える視線検出装置である。' },
    ])
    expect(corpus.getPublication('特開2018-1')?.sectionsIngested).toEqual(['claim'])
  })

  it('請求項と明細書を取り込めば両方が記録される', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'm', sourcePath: dir, productName: 'p' })
    corpus.putPublication(pub('特開2018-1'), batch)
    corpus.putParagraphs('特開2018-1', [
      { paraNo: 'C001', section: 'claim', text: '撮像部を備える視線検出装置である。' },
      { paraNo: '0001', section: 'desc', text: '瞳孔の中心座標を算出する装置である。' },
    ])
    expect(corpus.getPublication('特開2018-1')?.sectionsIngested).toEqual(['claim', 'desc'])
  })
})

// --- F-6 ------------------------------------------------------------------
describe('本文が変われば、その段落のベクトルは無効になる', () => {
  it('本文を差し替えると、その段落の chunk が消える', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'm', sourcePath: dir, productName: 'p' })
    corpus.putPublication(pub('特開2018-1'), batch)
    corpus.putParagraphs('特開2018-1', [
      { paraNo: '0001', section: 'desc', text: '瞳孔の中心座標を算出する装置である。' },
    ])
    const hash = (
      corpus.raw().prepare('SELECT text_hash FROM paragraphs').get() as { text_hash: string }
    ).text_hash
    corpus
      .raw()
      .prepare(
        `INSERT INTO chunks (id, pub_number, para_no, chunk_seq, text_hash, model, dim, scale, vec, vec_bin, promotion_id, created_at)
         VALUES ('c1', '特開2018-1', '0001', 0, ?, 'm', 8, 1.0, x'00', x'00', 'p1', '2026-01-01T00:00:00.000Z')`,
      )
      .run(hash)
    expect(corpus.stats().chunks).toBe(1)

    corpus.putParagraphs('特開2018-1', [
      { paraNo: '0001', section: 'desc', text: 'コンクリートの養生方法に関する発明である。' },
    ])
    expect(corpus.stats().chunks).toBe(0)
  })
})

// --- F-9 ------------------------------------------------------------------
describe('IPC の前方一致でワイルドカードを効かせない', () => {
  beforeEach(() => {
    const batch = corpus.beginBatch({ mediaLabel: 'm', sourcePath: dir, productName: 'p' })
    for (const [no, ipc] of [
      ['特開2018-1', 'G06F3/01'],
      ['特開2018-2', 'H01L21/02'],
    ] as const) {
      corpus.putPublication(pub(no, { ipc: [ipc] }), batch)
      corpus.putParagraphs(no, [
        { paraNo: '0001', section: 'desc', text: '瞳孔の中心座標を算出する装置である。' },
      ])
    }
  })

  it('% は絞り込みを無効化しない', () => {
    expect(corpus.search({ terms: ['瞳孔'] }).hitCount).toBe(2)
    expect(corpus.search({ terms: ['瞳孔'], ipcPrefix: '%' }).hitCount).toBe(0)
  })

  it('_ は任意の 1 文字にならない', () => {
    expect(corpus.search({ terms: ['瞳孔'], ipcPrefix: 'G_6F' }).hitCount).toBe(0)
    expect(corpus.search({ terms: ['瞳孔'], ipcPrefix: 'G06F' }).hitCount).toBe(1)
  })

  it('escapeLike はワイルドカードとエスケープ記号を無効化する', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d')
  })
})

// --- F-10 -----------------------------------------------------------------
describe('公開日が不明な公報を日付の絞り込みで消さない', () => {
  beforeEach(() => {
    const batch = corpus.beginBatch({ mediaLabel: 'm', sourcePath: dir, productName: 'p' })
    corpus.putPublication(pub('特開2018-1', { pubDate: '2018-08-30' }), batch)
    corpus.putPublication(pub('特開0000-0', { pubDate: null }), batch)
    for (const no of ['特開2018-1', '特開0000-0']) {
      corpus.putParagraphs(no, [
        { paraNo: '0001', section: 'desc', text: '瞳孔の中心座標を算出する装置である。' },
      ])
    }
  })

  it('日付で絞っても、日付不明の公報はヒットに残る', () => {
    const r = corpus.search({ terms: ['瞳孔'], pubDateTo: '2010-01-01' })
    expect(r.hitCount).toBe(1)
    expect(r.hits[0]?.pubNumber).toBe('特開0000-0')
  })

  it('日付不明の件数を告げる（黙って混ぜない）', () => {
    expect(corpus.search({ terms: ['瞳孔'] }).undatedCount).toBe(1)
  })

  it('後から来た不正な日付が、既に入っている正しい日付を潰さない', () => {
    const batch = corpus.beginBatch({ mediaLabel: 'm2', sourcePath: dir, productName: 'p' })
    corpus.putPublication(pub('特開2018-1', { pubDate: null, title: '再取り込み' }), batch)
    const stored = corpus.getPublication('特開2018-1')
    expect(stored?.pubDate).toBe('2018-08-30')
    expect(stored?.title).toBe('再取り込み')
  })
})

// --- F-14 -----------------------------------------------------------------
describe('buildSnippet は英数語でも位置を当てる', () => {
  const text =
    '本発明は視線検出に関する。制御部はG06Fに準拠したCMOSセンサを用いて、瞳孔の中心座標を算出する。'

  it.each(['G06F', 'CMOS', 'g06f', 'Ｇ０６Ｆ'])('%s を含む位置を切り出す', (term) => {
    expect(buildSnippet(text, [term]).toUpperCase()).toContain(term.normalize('NFKC').toUpperCase())
  })

  it('和文語も従来どおり当たる', () => {
    expect(buildSnippet(text, ['中心座標'])).toContain('中心座標')
  })

  it('一致しなければ冒頭を返す（空にしない）', () => {
    expect(buildSnippet(text, ['存在しない語'])).toContain('本発明は')
  })
})

// --- 検索の再現性（設計書 §8-2）--------------------------------------------
describe('検索の再現性', () => {
  beforeEach(() => {
    const batch = corpus.beginBatch({ mediaLabel: 'm', sourcePath: dir, productName: 'p' })
    for (let i = 0; i < 12; i++) {
      const no = `特開2018-${i}`
      corpus.putPublication(pub(no), batch)
      corpus.putParagraphs(no, [
        { paraNo: '0001', section: 'desc', text: '瞳孔の中心座標を算出する装置である。' },
        { paraNo: '0002', section: 'desc', text: '瞳孔の中心座標を輝度勾配から求める。' },
      ])
    }
    corpus.finishBatch(batch)
  })

  it('総件数と頁の長さは別物である', () => {
    const r = corpus.search({ terms: ['瞳孔'], limit: 5 })
    expect(r.hitCount).toBe(24)
    expect(r.hits).toHaveLength(5)
  })

  it('頁を送っても総件数は変わらない', () => {
    expect(corpus.search({ terms: ['瞳孔'], limit: 5, offset: 20 }).hitCount).toBe(24)
  })

  it('同じ検索は何度実行しても同じ順序になる', () => {
    const key = (r: ReturnType<Corpus['search']>) => r.hits.map((h) => `${h.pubNumber}/${h.paraNo}`)
    expect(key(corpus.search({ terms: ['瞳孔'], limit: 24 }))).toEqual(
      key(corpus.search({ terms: ['瞳孔'], limit: 24 })),
    )
  })

  it('コーパスが増えたことを検索記録から見分けられる', () => {
    const before = corpus.search({ terms: ['瞳孔'] }).corpusBatchCount
    corpus.beginBatch({ mediaLabel: 'm2', sourcePath: dir, productName: 'p' })
    expect(corpus.search({ terms: ['瞳孔'] }).corpusBatchCount).toBe(before + 1)
  })

  it('負の limit や巨大な limit を渡しても頁が壊れない', () => {
    expect(corpus.search({ terms: ['瞳孔'], limit: -1 }).hits).toHaveLength(1)
    expect(corpus.search({ terms: ['瞳孔'], limit: 1e9 }).hits).toHaveLength(24)
    expect(corpus.search({ terms: ['瞳孔'], limit: 2.5 }).hits).toHaveLength(2)
    expect(corpus.search({ terms: ['瞳孔'], offset: -5, limit: 3 }).hits).toHaveLength(3)
  })

  it('分割した語・落とした語を検索結果に添える', () => {
    const r = corpus.search({ terms: ['瞳孔、中心', '、'] })
    expect(r.splitTerms).toEqual(['瞳孔、中心'])
    expect(r.droppedTerms).toEqual(['、'])
  })
})
