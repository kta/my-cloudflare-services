import type { SearchRecord, SearchResponse } from '@app/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StubPublication } from './corpus-stub'
import { api, makeMatterWithElement, resetCorpus, seedCorpus, signIn } from './helpers'

/*
 * ヒットが多い検索の回帰。
 *
 * `search_hits` は 12 列あるので、D1 のバインド上限（1 文 100 個）に当たって
 * **9 行目から文ごと落ちていた**。実データの検索は数万件ヒットするので、
 * 分割しなければ最初の検索から必ず落ちる。しかも落ち方が最悪で、コーパスは実際に
 * 検索されたのに 500 が返り、記録が 1 件も残らない（コーパス不達の 503 と区別が付かない）。
 *
 * E2E が緑だったのは、合成コーパスでたまたま 7 件しか当たらなかったからである。
 * テスト用のコーパスが小さすぎると、この種の欠陥は構造的に検出できない。
 */

/** 段落数を指定して、確実に大量ヒットするコーパスを作る。 */
function bigCorpus(publications: number, paragraphsEach: number): Record<string, StubPublication> {
  const out: Record<string, StubPublication> = {}
  for (let p = 0; p < publications; p++) {
    const paragraphs: StubPublication['paragraphs'] = {}
    for (let i = 0; i < paragraphsEach; i++) {
      paragraphs[String(i + 1).padStart(4, '0')] = {
        section: 'desc',
        text: `前記瞳孔検出部は、中心座標に基づいて視線ベクトルを算出する（第${p}-${i}例）。`,
      }
    }
    out[`特開2018-${String(100000 + p).padStart(6, '0')}`] = {
      title: `視線検出装置 その${p}`,
      applicants: ['株式会社テスト'],
      pubDate: '2018-08-30',
      hasFulltext: true,
      sectionsIngested: ['desc'],
      paragraphs,
    }
  }
  return out
}

let token: string
let matterId: string

beforeEach(async () => {
  token = await signIn(`org_${crypto.randomUUID()}`)
  await resetCorpus()
  const made = await makeMatterWithElement(token)
  matterId = made.matterId
})

describe('ヒットが多い検索', () => {
  it.each([1, 8, 9, 20, 50])('%i 件のヒットでも 201 で返り、記録が残る', async (n) => {
    await seedCorpus(bigCorpus(n, 1))
    const r = await api<SearchResponse>(token, `/api/matters/${matterId}/searches`, {
      method: 'POST',
      body: JSON.stringify({ terms: ['瞳孔', '中心'], limit: 100 }),
    })
    expect(r.status).toBe(201)
    expect(r.body.record.hitCount).toBe(n)
    expect(r.body.hits).toHaveLength(n)

    const history = await api<SearchRecord[]>(token, `/api/matters/${matterId}/searches`)
    expect(history.body).toHaveLength(1)
    expect(history.body[0]?.hitCount).toBe(n)
  })

  it('上限いっぱい（500 件）でも落ちない', async () => {
    await seedCorpus(bigCorpus(50, 10))
    const r = await api<SearchResponse>(token, `/api/matters/${matterId}/searches`, {
      method: 'POST',
      body: JSON.stringify({ terms: ['瞳孔'], limit: 500 }),
    })
    expect(r.status).toBe(201)
    expect(r.body.hits).toHaveLength(500)
    expect(
      (await api<SearchRecord[]>(token, `/api/matters/${matterId}/searches`)).body,
    ).toHaveLength(1)
  })

  it('ヒットが 0 件でも記録は残る（探したという事実が要る）', async () => {
    await seedCorpus(bigCorpus(3, 1))
    const r = await api<SearchResponse>(token, `/api/matters/${matterId}/searches`, {
      method: 'POST',
      body: JSON.stringify({ terms: ['存在しない用語'] }),
    })
    expect(r.status).toBe(201)
    expect(r.body.record.hitCount).toBe(0)
    expect(
      (await api<SearchRecord[]>(token, `/api/matters/${matterId}/searches`)).body,
    ).toHaveLength(1)
  })
})
