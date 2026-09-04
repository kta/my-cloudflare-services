import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Corpus, openCorpus } from '../src/corpus'
import { createEmbedder } from '../src/embed'
import { embedCorpus, vectorSearch } from '../src/embed-pipeline'
import { synthesizePublications } from '../src/synth'

let dir: string
let corpus: Corpus
const embedder = createEmbedder({ provider: 'deterministic', dim: 64 })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tenkyo-vec-'))
  corpus = openCorpus(join(dir, 'corpus.db'))
  const batch = corpus.beginBatch({
    mediaLabel: 'synth',
    sourcePath: dir,
    productName: 'synthetic',
  })
  for (const p of synthesizePublications({ count: 12, seed: 4, ipc: ['G06F3/01'] })) {
    corpus.putPublication(p.publication, batch)
    corpus.putParagraphs(p.publication.pubNumber, p.paragraphs)
  }
  for (const p of synthesizePublications({ count: 8, seed: 5, ipc: ['H01L21/02'] })) {
    corpus.putPublication({ ...p.publication, pubNumber: `${p.publication.pubNumber}B` }, batch)
    corpus.putParagraphs(`${p.publication.pubNumber}B`, p.paragraphs)
  }
  corpus.finishBatch(batch)
})
afterEach(() => {
  corpus.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('embedCorpus', () => {
  it('昇格セットを作り、対象段落の数だけチャンクを作る', async () => {
    const r = await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    expect(r.publicationCount).toBe(12)
    expect(r.chunkCount).toBeGreaterThan(12)
    expect(corpus.stats().chunks).toBe(r.chunkCount)
  })

  it('昇格していない公報のチャンクは作らない（見た範囲を偽らないため）', async () => {
    await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    const rows = corpus
      .raw()
      .prepare("SELECT count(*) AS c FROM chunks WHERE pub_number LIKE '%B'")
      .get() as { c: number }
    expect(rows.c).toBe(0)
  })

  it('モデル名と次元と semantic を昇格セットに記録する', async () => {
    const r = await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    const row = corpus
      .raw()
      .prepare('SELECT * FROM promotion_sets WHERE id = ?')
      .get(r.promotionId) as {
      model: string
      dim: number
      semantic: number
    }
    expect(row.model).toBe('deterministic:64')
    expect(row.dim).toBe(64)
    expect(row.semantic).toBe(0)
  })

  it('二度実行しても同じ段落のチャンクは重複しない', async () => {
    const a = await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    const b = await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    expect(b.chunkCount).toBe(a.chunkCount)
    expect(corpus.stats().chunks).toBe(a.chunkCount)
  })

  it('本文が変わった段落は作り直される', async () => {
    const first = await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    const target = synthesizePublications({ count: 12, seed: 4, ipc: ['G06F3/01'] })[0]
    const pubNumber = target?.publication.pubNumber as string
    corpus.putParagraphs(pubNumber, [
      { paraNo: '0001', section: 'desc', text: '差し替えられた本文である。' },
    ])
    const second = await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    expect(second.chunkCount).toBeLessThan(first.chunkCount)
    const stale = corpus
      .raw()
      .prepare('SELECT count(*) AS c FROM chunks WHERE pub_number = ?')
      .get(pubNumber) as { c: number }
    expect(stale.c).toBe(1)
  })

  it('長い段落は段落境界を跨がずに分割する（どの段落からの引用かを言えるようにするため）', async () => {
    const solo = openCorpus(join(dir, 'solo.db'))
    const b = solo.beginBatch({ mediaLabel: 'x', sourcePath: dir, productName: 'p' })
    const [p] = synthesizePublications({ count: 1, seed: 1 })
    solo.putPublication(p?.publication as never, b)
    solo.putParagraphs(p?.publication.pubNumber as string, [
      { paraNo: '0001', section: 'desc', text: 'あ'.repeat(1200) },
    ])
    const r = await embedCorpus(solo, embedder, {})
    const rows = solo
      .raw()
      .prepare('SELECT para_no, chunk_seq FROM chunks ORDER BY chunk_seq')
      .all() as { para_no: string; chunk_seq: number }[]
    expect(r.chunkCount).toBeGreaterThan(1)
    expect(rows.every((x) => x.para_no === '0001')).toBe(true)
    expect(rows.map((x) => x.chunk_seq)).toEqual(rows.map((_, i) => i))
    solo.close()
  })
})

describe('vectorSearch', () => {
  it('意味的に近い段落を返す（自分自身が最上位に来る）', async () => {
    await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    const para = corpus
      .raw()
      .prepare("SELECT pub_number, para_no, text FROM paragraphs WHERE section = 'desc' LIMIT 1")
      .get() as { pub_number: string; para_no: string; text: string }
    const r = await vectorSearch(corpus, embedder, { text: para.text, limit: 5 })
    expect(r.hits[0]?.pubNumber).toBe(para.pub_number)
    expect(r.hits[0]?.paraNo).toBe(para.para_no)
  })

  it('チャンクが無ければ空を返し、その事実を告げる', async () => {
    const r = await vectorSearch(corpus, embedder, { text: '瞳孔', limit: 5 })
    expect(r.hits).toEqual([])
    expect(r.candidateChunks).toBe(0)
  })

  it('候補集合（公報番号の指定）の中だけで探す', async () => {
    await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    const two = corpus.raw().prepare('SELECT DISTINCT pub_number FROM chunks LIMIT 2').all() as {
      pub_number: string
    }[]
    const only = two.map((r) => r.pub_number)
    const r = await vectorSearch(corpus, embedder, {
      text: '瞳孔の中心',
      limit: 50,
      pubNumbers: only,
    })
    expect(r.hits.every((h) => only.includes(h.pubNumber))).toBe(true)
    expect(r.hits.length).toBeGreaterThan(0)
  })

  it('モデルが違うチャンクは混ぜない（次元の違うベクトルを比較しない）', async () => {
    await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    const other = createEmbedder({ provider: 'deterministic', dim: 32 })
    const r = await vectorSearch(corpus, other, { text: '瞳孔', limit: 5 })
    expect(r.hits).toEqual([])
    expect(r.candidateChunks).toBe(0)
  })

  it('検索に使ったモデル名と走査したチャンク数を返す（見た範囲を示すため）', async () => {
    await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    const r = await vectorSearch(corpus, embedder, { text: '瞳孔', limit: 3 })
    expect(r.model).toBe('deterministic:64')
    expect(r.semantic).toBe(false)
    expect(r.candidateChunks).toBeGreaterThan(0)
    expect(r.hits.length).toBeLessThanOrEqual(3)
  })

  // --- F-8 の顛末 --------------------------------------------------------
  // 1bit 量子化で粗く絞る経路は、実測で recall@10 が 27〜40%（真の上位の 6〜7 割を落とす）
  // だったので削除した。二段検索が前提なので総当たりで速度も足りる。
  // 「見た範囲」の申告が常に正しいことを、ここで固定する。
  it('候補集合を必ず総当たりする（見た範囲の申告が嘘にならない）', async () => {
    await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    const r = await vectorSearch(corpus, embedder, { text: '瞳孔の中心座標', limit: 5 })
    expect(r.rescoredChunks).toBe(r.candidateChunks)
    expect(r.candidateChunks).toBe(corpus.stats().chunks)
  })

  it('候補を絞ったときも、その候補の中は総当たりする', async () => {
    await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    const two = corpus.raw().prepare('SELECT DISTINCT pub_number FROM chunks LIMIT 2').all() as {
      pub_number: string
    }[]
    const r = await vectorSearch(corpus, embedder, {
      text: '瞳孔の中心座標',
      limit: 5,
      pubNumbers: two.map((x) => x.pub_number),
    })
    expect(r.rescoredChunks).toBe(r.candidateChunks)
    expect(r.candidateChunks).toBeLessThan(corpus.stats().chunks)
  })
})

// --- F-7 の回帰 -----------------------------------------------------------
// 次元だけ変えて埋め込み直したとき、以前は「昇格済み」と誤判定し、実際には走査できない
// チャンク数を promotion_sets に記録していた（= 見ていない範囲を見たと申告していた）。
describe('次元を変えて埋め込み直す', () => {
  it('別の次元で昇格したら、その次元で実際に検索できる', async () => {
    const small = createEmbedder({ provider: 'deterministic', dim: 32 })
    await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    const second = await embedCorpus(corpus, small, { ipcPrefix: 'G06F3' })
    const found = await vectorSearch(corpus, small, { text: '瞳孔の中心', limit: 3 })
    expect(second.chunkCount).toBeGreaterThan(0)
    expect(found.candidateChunks).toBe(second.chunkCount)
    expect(found.hits.length).toBeGreaterThan(0)
  })

  it('元の次元のチャンクは消えない（両方で検索できる）', async () => {
    const small = createEmbedder({ provider: 'deterministic', dim: 32 })
    const first = await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    await embedCorpus(corpus, small, { ipcPrefix: 'G06F3' })
    const original = await vectorSearch(corpus, embedder, { text: '瞳孔の中心', limit: 3 })
    expect(original.candidateChunks).toBe(first.chunkCount)
  })
})

describe('不変条件: chunk は実在する段落を指す', () => {
  it('段落を消しただけでベクトルが孤立しない', async () => {
    await embedCorpus(corpus, embedder, {})
    const before = corpus.stats().chunks
    expect(before).toBeGreaterThan(0)
    const pub = corpus.raw().prepare('SELECT pub_number FROM publications LIMIT 1').get() as {
      pub_number: string
    }
    corpus.putParagraphs(pub.pub_number, [])
    const orphans = corpus
      .raw()
      .prepare(
        `SELECT count(*) AS c FROM chunks c
         WHERE NOT EXISTS (SELECT 1 FROM paragraphs p WHERE p.pub_number = c.pub_number AND p.para_no = c.para_no)`,
      )
      .get() as { c: number }
    expect(orphans.c).toBe(0)
    expect(corpus.stats().chunks).toBeLessThan(before)
  })
})

// --- F-7 の回帰 -----------------------------------------------------------
// 次元だけ変えて埋め込み直したとき、以前は「昇格済み」と誤判定し、実際には走査できない
// チャンク数を promotion_sets に記録していた（= 見ていない範囲を見たと申告していた）。
describe('次元を変えて埋め込み直す', () => {
  it('別の次元で昇格したら、その次元で実際に検索できる', async () => {
    const small = createEmbedder({ provider: 'deterministic', dim: 32 })
    await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    const second = await embedCorpus(corpus, small, { ipcPrefix: 'G06F3' })
    const found = await vectorSearch(corpus, small, { text: '瞳孔の中心', limit: 3 })
    expect(second.chunkCount).toBeGreaterThan(0)
    expect(found.candidateChunks).toBe(second.chunkCount)
    expect(found.hits.length).toBeGreaterThan(0)
  })

  it('元の次元のチャンクは消えない（両方で検索できる）', async () => {
    const small = createEmbedder({ provider: 'deterministic', dim: 32 })
    const first = await embedCorpus(corpus, embedder, { ipcPrefix: 'G06F3' })
    await embedCorpus(corpus, small, { ipcPrefix: 'G06F3' })
    const original = await vectorSearch(corpus, embedder, { text: '瞳孔の中心', limit: 3 })
    expect(original.candidateChunks).toBe(first.chunkCount)
  })
})
