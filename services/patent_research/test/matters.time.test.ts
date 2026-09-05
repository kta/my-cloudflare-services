import type {
  Disclosure,
  Draft,
  Evidence,
  Matter,
  SearchRecord,
  SearchResponse,
} from '@app/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  api,
  makeMatterWithElement,
  resetCorpus,
  SAMPLE_CORPUS,
  seedCorpus,
  signIn,
} from './helpers'

/*
 * 時刻は注入する（TEST_RULE）。`TEST_NOW` を miniflare の binding で渡している。
 *
 * この製品で時刻が効くのは「いつ検索したか」「いつ人が確認したか」「どの版が最新か」の 3 つで、
 * どれも調査報告書と、外部送信の可否判断の根拠になる。実時計に任せると検証できない。
 */

const AT = '2026-03-01T04:05:06.000Z'
let token: string
let matterId: string
let elementId: string

beforeEach(async () => {
  token = await signIn(`org_${crypto.randomUUID()}`)
  await resetCorpus()
  await seedCorpus(SAMPLE_CORPUS)
  const made = await makeMatterWithElement(token)
  matterId = made.matterId
  elementId = made.elements[1]?.id as string
})

describe('注入した時刻が記録に刻まれる', () => {
  it('案件の作成と更新', async () => {
    const m = await api<Matter>(token, `/api/matters/${matterId}`)
    expect(m.body.createdAt).toBe(AT)
    expect(m.body.updatedAt).toBe(AT)
  })

  it('発明開示の版', async () => {
    const d = await api<Disclosure>(token, `/api/matters/${matterId}/disclosure`, {
      method: 'PUT',
      body: JSON.stringify({ problem: '課題' }),
    })
    expect(d.body.createdAt).toBe(AT)
  })

  it('典拠と、人が確認した時刻', async () => {
    const ev = await api<Evidence>(token, `/api/matters/${matterId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        elementId,
        pubNumber: '特開2018-134274',
        paraNo: '0032',
        quotedText: '瞳孔の中心座標を算出する',
        relation: 'discloses',
      }),
    })
    expect(ev.body.createdAt).toBe(AT)
    expect(ev.body.reviewedAt).toBeNull()
    const reviewed = await api<Evidence>(token, `/api/evidence/${ev.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ review: 'confirmed' }),
    })
    expect(reviewed.body.reviewedAt).toBe(AT)
  })

  it('ドラフトの版', async () => {
    const d = await api<Draft>(token, `/api/matters/${matterId}/drafts`, {
      method: 'PUT',
      body: JSON.stringify({ section: 'technical_field', markdown: 'あ' }),
    })
    expect(d.body.createdAt).toBe(AT)
  })

  it('検索の実行時刻はコーパスが返した値を使う（Worker の時計ではない）', async () => {
    const r = await api<SearchResponse>(token, `/api/matters/${matterId}/searches`, {
      method: 'POST',
      body: JSON.stringify({ terms: ['瞳孔'] }),
    })
    // 検索を実行したのはコーパスなので、その時刻が記録に残る
    expect(r.body.record.executedAt).toBe('2026-03-01T00:00:00.000Z')
    const history = await api<SearchRecord[]>(token, `/api/matters/${matterId}/searches`)
    expect(history.body[0]?.executedAt).toBe('2026-03-01T00:00:00.000Z')
  })
})

describe('改訂の「最新」は版番号で決める', () => {
  it('10 版を超えても、最新が正しく返る（文字列比較で 10 < 9 にならない）', async () => {
    for (let i = 1; i <= 11; i++) {
      await api(token, `/api/matters/${matterId}/disclosure`, {
        method: 'PUT',
        body: JSON.stringify({ problem: `第${i}版` }),
      })
    }
    const latest = await api<Disclosure>(token, `/api/matters/${matterId}/disclosure`)
    expect(latest.body.revision).toBe(11)
    expect(latest.body.problem).toBe('第11版')
  })

  it('外部 LLM の可否も最新の版で判断する', async () => {
    // 1 版目で許可 → 2 版目で取り消す。最新（2 版目）に従うのが正しい。
    await api(token, `/api/matters/${matterId}/disclosure`, {
      method: 'PUT',
      body: JSON.stringify({ problem: '許可した版', externalLlmAllowed: true }),
    })
    await api(token, `/api/matters/${matterId}/disclosure`, {
      method: 'PUT',
      body: JSON.stringify({ problem: '取り消した版', externalLlmAllowed: false }),
    })
    const r = await api<{ error: string }>(token, `/api/matters/${matterId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role: 'assistant', content: 'x', provider: 'gemini' }),
    })
    expect(r.status).toBe(403)
    expect(r.body.error).toBe('external_llm_not_allowed')
  })
})
