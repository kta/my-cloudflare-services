import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Corpus, openCorpus } from '../src/corpus'
import { createEmbedder } from '../src/embed'
import { embedCorpus } from '../src/embed-pipeline'
import { createSidecar, type Sidecar } from '../src/server'
import { synthesizePublications } from '../src/synth'

// サイドカーの応答は JSON。各テストが必要とする形だけを明示して読む（any を使わない）。
async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

const KEY = 'dev-internal-key'
const embedder = createEmbedder({ provider: 'deterministic', dim: 64 })

let dir: string
let corpus: Corpus
let sidecar: Sidecar
let base: string

async function start(internalKey: string | undefined): Promise<void> {
  sidecar = createSidecar({ corpus, embedder, internalKey, port: 0 })
  const port = await sidecar.listen()
  base = `http://127.0.0.1:${port}`
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tenkyo-srv-'))
  corpus = openCorpus(join(dir, 'corpus.db'))
  const batch = corpus.beginBatch({
    mediaLabel: 'synth',
    sourcePath: dir,
    productName: 'synthetic',
  })
  for (const p of synthesizePublications({ count: 6, seed: 21, ipc: ['G06F3/01'] })) {
    corpus.putPublication(p.publication, batch)
    corpus.putParagraphs(p.publication.pubNumber, p.paragraphs)
  }
  corpus.finishBatch(batch)
})
afterEach(async () => {
  await sidecar.close()
  corpus.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('鍵が未設定のとき', () => {
  beforeEach(() => start(undefined))

  it('health だけは答える（落ちているかは秘密ではない）', async () => {
    const r = await fetch(`${base}/health`)
    expect(r.status).toBe(200)
    // 鍵が設定済みかどうかは漏らさない（鍵未設定の窓を外から探せてしまう）
    expect(await body(r)).toEqual({ status: 'ok' })
  })

  it('それ以外は 503 で拒む（fail close）', async () => {
    const r = await fetch(`${base}/stats`, { headers: { 'x-internal-key': KEY } })
    expect(r.status).toBe(503)
    expect((await body<{ error: string }>(r)).error).toBe('internal_key_unset')
  })
})

describe('鍵が設定されているとき', () => {
  beforeEach(() => start(KEY))

  it('鍵が無いリクエストは 401', async () => {
    expect((await fetch(`${base}/stats`)).status).toBe(401)
  })

  it('鍵が違うリクエストは 401', async () => {
    const r = await fetch(`${base}/stats`, { headers: { 'x-internal-key': 'wrong' } })
    expect(r.status).toBe(401)
  })

  it('/stats は件数を返す', async () => {
    const r = await fetch(`${base}/stats`, { headers: { 'x-internal-key': KEY } })
    expect((await body<{ publications: number }>(r)).publications).toBe(6)
  })

  it('/batches は取り込み履歴と抽出失敗を返す', async () => {
    corpus.recordExtractFailure({ pdfPath: '/x.pdf', reason: 'no_text_layer' })
    const r = await fetch(`${base}/batches`, { headers: { 'x-internal-key': KEY } })
    const payload = await body<{ batches: unknown[]; failures: { reason: string }[] }>(r)
    expect(payload.batches).toHaveLength(1)
    expect(payload.failures[0]?.reason).toBe('no_text_layer')
  })

  it('/publication は書誌と全段落を返す', async () => {
    const first = synthesizePublications({ count: 6, seed: 21, ipc: ['G06F3/01'] })[0]
    const r = await fetch(
      `${base}/publication?pubNumber=${encodeURIComponent(first?.publication.pubNumber as string)}`,
      { headers: { 'x-internal-key': KEY } },
    )
    const payload = await body<{ publication: { pubNumber: string }; paragraphs: unknown[] }>(r)
    expect(payload.publication.pubNumber).toBe(first?.publication.pubNumber)
    expect(payload.paragraphs.length).toBeGreaterThan(0)
  })

  it('/publication は pubNumber が無ければ 400', async () => {
    const r = await fetch(`${base}/publication`, { headers: { 'x-internal-key': KEY } })
    expect(r.status).toBe(400)
  })

  it('/publication は無い公報なら 404', async () => {
    const r = await fetch(`${base}/publication?pubNumber=%E7%89%B9%E9%96%8B9999-1`, {
      headers: { 'x-internal-key': KEY },
    })
    expect(r.status).toBe(404)
  })

  it('/paragraphs は段落原文と、公報の有無・全文の有無を並べて返す', async () => {
    const first = synthesizePublications({ count: 6, seed: 21, ipc: ['G06F3/01'] })[0]
    const pubNumber = first?.publication.pubNumber as string
    const r = await fetch(`${base}/paragraphs`, {
      method: 'POST',
      headers: { 'x-internal-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        keys: [
          { pubNumber, paraNo: '0001' },
          { pubNumber, paraNo: '9999' },
          { pubNumber: '特開9999-1', paraNo: '0001' },
        ],
      }),
    })
    interface ParaRow {
      text: string | null
      publicationExists: boolean
      fulltextAvailable: boolean
    }
    const [ok, noPara, noPub] = (await body<{ paragraphs: ParaRow[] }>(r)).paragraphs as [
      ParaRow,
      ParaRow,
      ParaRow,
    ]
    expect(ok.text).toBeTypeOf('string')
    expect(ok.publicationExists).toBe(true)
    expect(ok.fulltextAvailable).toBe(true)
    expect(noPara.text).toBeNull()
    expect(noPara.publicationExists).toBe(true)
    expect(noPub.publicationExists).toBe(false)
  })

  it('/paragraphs は keys が無ければ空配列を返す', async () => {
    const r = await fetch(`${base}/paragraphs`, {
      method: 'POST',
      headers: { 'x-internal-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect((await body<{ paragraphs: unknown[] }>(r)).paragraphs).toEqual([])
  })

  it('/search は検索式とヒット件数を含めて返す', async () => {
    const r = await fetch(`${base}/search`, {
      method: 'POST',
      headers: { 'x-internal-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ terms: ['瞳孔'], ipcPrefix: 'G06F3', limit: 5 }),
    })
    const payload = await body<{ matchExpression: string; hitCount: number; hits: unknown[] }>(r)
    expect(payload.matchExpression).toBe('"瞳孔"')
    expect(payload.hitCount).toBeGreaterThan(0)
    expect(payload.hits.length).toBeLessThanOrEqual(5)
  })

  it('/vector-search は text が無ければ 400', async () => {
    const r = await fetch(`${base}/vector-search`, {
      method: 'POST',
      headers: { 'x-internal-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(r.status).toBe(400)
  })

  it('/vector-search は走査したチャンク数とモデル名を返す', async () => {
    await embedCorpus(corpus, embedder, {})
    const r = await fetch(`${base}/vector-search`, {
      method: 'POST',
      headers: { 'x-internal-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ text: '瞳孔の中心', limit: 3 }),
    })
    const payload = await body<{
      model: string
      semantic: boolean
      candidateChunks: number
      rescoredChunks: number
    }>(r)
    expect(payload.model).toBe('deterministic:64')
    expect(payload.semantic).toBe(false)
    expect(payload.candidateChunks).toBeGreaterThan(0)
    expect(payload.rescoredChunks).toBe(payload.candidateChunks)
  })

  it('知らない経路は 404', async () => {
    const r = await fetch(`${base}/nope`, { headers: { 'x-internal-key': KEY } })
    expect(r.status).toBe(404)
  })

  it('壊れた JSON は 400（500 にしない）', async () => {
    const r = await fetch(`${base}/search`, {
      method: 'POST',
      headers: { 'x-internal-key': KEY, 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(r.status).toBe(400)
    expect((await body<{ error: string }>(r)).error).toBe('invalid_json')
  })
})

// --- F-11 の回帰 ------------------------------------------------------------
// 入力検証が無いと、利用者の入力がそのまま SQL のバインドに流れて 500 になり、
// `limit: -1` は SQLite の「無制限」になって頁送りが無効化される（実測で確認）。
describe('入力の検証（F-11 の回帰）', () => {
  beforeEach(() => start(KEY))

  async function post(path: string, payload: unknown): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'x-internal-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  it.each([
    ['limit が負', { terms: ['瞳孔'], limit: -1 }],
    ['limit が巨大', { terms: ['瞳孔'], limit: 1e9 }],
    ['limit が小数', { terms: ['瞳孔'], limit: 2.5 }],
    ['offset が負', { terms: ['瞳孔'], offset: -5 }],
    ['terms が空', { terms: [] }],
    ['terms に文字列以外', { terms: [123, '瞳孔'] }],
    ['sections が enum 外', { terms: ['瞳孔'], sections: ['DESC'] }],
    ['日付の形式違い', { terms: ['瞳孔'], pubDateFrom: '2018/01/01' }],
  ])('/search は %s を 400 で拒む', async (_name, payload) => {
    const r = await post('/search', payload)
    expect(r.status).toBe(400)
    expect((await body<{ error: string }>(r)).error).toBe('invalid_request')
  })

  it('検索語を黙って捨てない（捨てると 0 件が「該当なし」に見える）', async () => {
    const r = await post('/search', { terms: [123, '瞳孔'] })
    expect(r.status).toBe(400)
  })

  it.each([
    ['keys に null', { keys: [null] }],
    ['keys の要素が壊れている', { keys: [{ pubNumber: { a: 1 }, paraNo: '0001' }] }],
    [
      'keys が多すぎる',
      { keys: Array.from({ length: 1001 }, () => ({ pubNumber: 'a', paraNo: '1' })) },
    ],
  ])('/paragraphs は %s を 400 で拒む', async (_name, payload) => {
    expect((await post('/paragraphs', payload)).status).toBe(400)
  })

  it('/vector-search は text が空なら 400', async () => {
    expect((await post('/vector-search', { text: '' })).status).toBe(400)
  })

  it('大きすぎるボディは 413（500 にしない）', async () => {
    const r = await fetch(`${base}/search`, {
      method: 'POST',
      headers: { 'x-internal-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ terms: ['瞳孔'], pad: 'x'.repeat(2 * 1024 * 1024) }),
    })
    expect(r.status).toBe(413)
  })
})
