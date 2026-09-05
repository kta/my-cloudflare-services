import { SELF } from 'cloudflare:test'
import type { Evidence, Matter, MatterSummary } from '@app/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { api, resetCorpus, SAMPLE_CORPUS, seedCorpus, signIn } from './helpers'

/*
 * テナント分離。3 テナントを同時に動かし、他テナントのデータが
 * **見えない・書き換えられない・偽装入力で越境できない** ことを確認する。
 *
 * この製品では特に重い。案件には未出願の発明が入っており、漏れたら取り返しがつかない。
 */

let alpha: string
let beta: string
let gamma: string
let alphaMatter: string
let betaMatter: string
let betaElement: string

beforeEach(async () => {
  await resetCorpus()
  await seedCorpus(SAMPLE_CORPUS)
  alpha = await signIn(`org_a_${crypto.randomUUID()}`)
  beta = await signIn(`org_b_${crypto.randomUUID()}`)
  gamma = await signIn(`org_c_${crypto.randomUUID()}`)

  const a = await api<Matter>(alpha, '/api/matters', {
    method: 'POST',
    body: JSON.stringify({ title: 'アルファの発明' }),
  })
  alphaMatter = a.body.id
  const b = await api<Matter>(beta, '/api/matters', {
    method: 'POST',
    body: JSON.stringify({ title: 'ベータの発明' }),
  })
  betaMatter = b.body.id
  const els = await api<{ id: string }[]>(beta, `/api/matters/${betaMatter}/elements`, {
    method: 'PUT',
    body: JSON.stringify({
      elements: [{ claimNo: 1, elementKey: 'A', text: 'ベータの構成要件', sortOrder: 0 }],
    }),
  })
  betaElement = els.body[0]?.id as string
})

describe('読み取りの分離', () => {
  it('一覧には自分の案件しか出ない', async () => {
    const a = await api<MatterSummary[]>(alpha, '/api/matters')
    expect(a.body.map((m) => m.title)).toEqual(['アルファの発明'])
    const c = await api<MatterSummary[]>(gamma, '/api/matters')
    expect(c.body).toEqual([])
  })

  it('他テナントの案件は id を知っていても 404（存在を推測させない）', async () => {
    expect((await api(alpha, `/api/matters/${betaMatter}`)).status).toBe(404)
  })

  it('他テナントの案件の子リソースも 404', async () => {
    for (const path of [
      'disclosure',
      'messages',
      'elements',
      'searches',
      'evidence',
      'assessments',
      'drafts',
      'checks',
      'graph',
    ]) {
      expect((await api(alpha, `/api/matters/${betaMatter}/${path}`)).status).toBe(404)
    }
  })
})

describe('書き込みの分離', () => {
  it('他テナントの案件は更新できない', async () => {
    const r = await api(alpha, `/api/matters/${betaMatter}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: '乗っ取り' }),
    })
    expect(r.status).toBe(404)
    const still = await api<Matter>(beta, `/api/matters/${betaMatter}`)
    expect(still.body.title).toBe('ベータの発明')
  })

  it('他テナントの案件に典拠を積めない', async () => {
    const r = await api(alpha, `/api/matters/${betaMatter}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        elementId: betaElement,
        pubNumber: '特開2018-134274',
        paraNo: '0032',
        quotedText: '瞳孔の中心座標を算出する',
        relation: 'discloses',
      }),
    })
    expect(r.status).toBe(404)
  })

  it('自分の案件に、他テナントの構成要件を紐づけられない', async () => {
    const r = await api(alpha, `/api/matters/${alphaMatter}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        elementId: betaElement,
        pubNumber: '特開2018-134274',
        paraNo: '0032',
        quotedText: '瞳孔の中心座標を算出する',
        relation: 'discloses',
      }),
    })
    expect(r.status).toBe(404)
  })

  it('他テナントの典拠はレビューできない', async () => {
    const ev = await api<Evidence>(beta, `/api/matters/${betaMatter}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        elementId: betaElement,
        pubNumber: '特開2018-134274',
        paraNo: '0032',
        quotedText: '瞳孔の中心座標を算出する',
        relation: 'discloses',
      }),
    })
    expect(ev.body.quoteCheck).toBe('verified')
    const r = await api(alpha, `/api/evidence/${ev.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ review: 'confirmed' }),
    })
    expect(r.status).toBe(404)
  })
})

describe('入力による偽装', () => {
  it('body に organizationId を混ぜても、自分のテナントに入る', async () => {
    const r = await api<Matter>(alpha, '/api/matters', {
      method: 'POST',
      body: JSON.stringify({ title: '偽装', organizationId: 'org_victim' }),
    })
    expect(r.body.organizationId).not.toBe('org_victim')
    const victim = await api<MatterSummary[]>(gamma, '/api/matters')
    expect(victim.body).toEqual([])
  })

  it('body に matterId を混ぜても、URL の案件が使われる', async () => {
    const r = await api<{ matterId: string }>(alpha, `/api/matters/${alphaMatter}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'search', matterId: betaMatter }),
    })
    expect(r.body.matterId).toBe(alphaMatter)
  })

  it('ジョブの一覧に他テナントのジョブは出ない', async () => {
    await api(alpha, `/api/matters/${alphaMatter}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'search' }),
    })
    const b = await api<unknown[]>(beta, '/api/jobs')
    expect(b.body).toEqual([])
  })
})

describe('org の状態', () => {
  it('同期されていない org は 503（無効化の 403 と区別する）', async () => {
    const { signAccessToken } = await import('@app/shared')
    const token = await signAccessToken(
      { sub: 'dev:x', org: 'org_never_synced', email: 'x@example.test', role: 'admin' },
      'dev-jwt-secret-change-me',
    )
    const r = await api<{ error: string }>(token, '/api/matters')
    expect(r.status).toBe(503)
  })

  it('無効化された org は 403、再同期すれば 200 に戻る（毎リクエスト判定である証明）', async () => {
    const org = `org_toggle_${crypto.randomUUID()}`
    const token = await signIn(org)
    expect((await api(token, '/api/matters')).status).toBe(200)

    const sync = (isDisabled: boolean) =>
      SELF.fetch('https://x/api/internal/organizations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': 'dev-internal-key' },
        body: JSON.stringify({
          id: org,
          name: org,
          plan: 'free',
          isDisabled,
          createdAt: new Date().toISOString(),
        }),
      })

    await sync(true)
    expect((await api(token, '/api/matters')).status).toBe(403)
    await sync(false)
    expect((await api(token, '/api/matters')).status).toBe(200)
  })
})
