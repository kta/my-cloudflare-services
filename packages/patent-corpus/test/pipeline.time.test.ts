import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Corpus, openCorpus } from '../src/corpus'
import { createEmbedder } from '../src/embed'
import { embedCorpus, vectorSearch } from '../src/embed-pipeline'

/*
 * 時刻は必ず引数で注入する（TEST_RULE）。実時計に依存させると、
 * 「いつ昇格したか」「いつ検索したか」という調査報告書の記載を検証できない。
 */

let dir: string
let corpus: Corpus
const embedder = createEmbedder({ provider: 'deterministic', dim: 32 })
const AT = '2026-03-01T04:05:06.000Z'
const now = () => new Date(AT)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tenkyo-time-'))
  corpus = openCorpus(join(dir, 'corpus.db'), { now })
  const batch = corpus.beginBatch({ mediaLabel: 'm', sourcePath: dir, productName: 'p' })
  corpus.putPublication(
    {
      pubNumber: '特開2018-1',
      country: 'JP',
      kind: 'A',
      appNumber: null,
      filingDate: null,
      pubDate: '2018-08-30',
      regDate: null,
      title: '視線検出装置',
      applicants: [],
      inventors: [],
      ipc: ['G06F3/01'],
      fi: [],
      fterm: [],
      abstract: null,
      pdfPath: null,
    },
    batch,
  )
  corpus.putParagraphs('特開2018-1', [
    { paraNo: '0001', section: 'desc', text: '瞳孔の中心座標を算出する装置である。' },
  ])
  corpus.finishBatch(batch)
})
afterEach(() => {
  corpus.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('時刻の注入', () => {
  it('昇格セットの作成時刻が注入した値になる', async () => {
    const r = await embedCorpus(corpus, embedder, { now })
    const row = corpus
      .raw()
      .prepare('SELECT created_at FROM promotion_sets WHERE id = ?')
      .get(r.promotionId) as { created_at: string }
    expect(row.created_at).toBe(AT)
  })

  it('チャンクの作成時刻も同じ値になる', async () => {
    await embedCorpus(corpus, embedder, { now })
    const row = corpus.raw().prepare('SELECT created_at FROM chunks LIMIT 1').get() as {
      created_at: string
    }
    expect(row.created_at).toBe(AT)
  })

  it('ベクトル検索の実行時刻が注入した値になる', async () => {
    await embedCorpus(corpus, embedder, { now })
    const r = await vectorSearch(corpus, embedder, { text: '瞳孔の中心', now })
    expect(r.executedAt).toBe(AT)
  })

  it('取り込みと検索の時刻が一致する（同じ注入源を使っている証明）', () => {
    expect(corpus.batches()[0]?.startedAt).toBe(AT)
    expect(corpus.search({ terms: ['瞳孔'] }).executedAt).toBe(AT)
  })
})
