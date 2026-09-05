import { SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  api,
  makeMatterWithElement,
  resetCorpus,
  SAMPLE_CORPUS,
  seedCorpus,
  signIn,
} from './helpers'

/*
 * 権限の表駆動テスト。
 *
 * default-deny（`app.use('/api/*', except(...))`）が生きていることの証明であり、
 * **新しいルートを足したときのゲート漏れを自動で検知する仕掛け**でもある。
 * ルートを足したらこの表に 1 行足す。未知パスも表に入れる。
 *
 * 401（未認証・期限切れ）と 403（権限不足）を取り違えないことも固定する。
 * クライアントの再ログイン判定がこの区別に依存している。
 */

const SECRET = 'dev-jwt-secret-change-me'
const ORG = 'org_permissions'

let matterId: string
let elementId: string
let evidenceId: string
let adminToken: string

beforeAll(async () => {
  adminToken = await signIn(ORG)
  await resetCorpus()
  await seedCorpus(SAMPLE_CORPUS)
  const made = await makeMatterWithElement(adminToken)
  matterId = made.matterId
  elementId = made.elements[1]?.id as string
  const ev = await api<{ id: string }>(adminToken, `/api/matters/${matterId}/evidence`, {
    method: 'POST',
    body: JSON.stringify({
      elementId,
      pubNumber: '特開2018-134274',
      paraNo: '0032',
      quotedText: '瞳孔の中心座標を算出する',
      relation: 'discloses',
    }),
  })
  evidenceId = ev.body.id
})

interface Actor {
  name: string
  token: () => Promise<string | null>
}

const actors: Actor[] = [
  { name: '未認証', token: async () => null },
  { name: 'staff', token: () => signIn(ORG, 'staff') },
  { name: 'admin', token: () => signIn(ORG, 'admin') },
  {
    name: '期限切れトークン',
    token: () =>
      signAccessToken(
        { sub: 'dev:x', org: ORG, email: 'x@example.test', role: 'admin' },
        SECRET,
        -1,
      ),
  },
  {
    name: '別 secret で署名',
    token: () =>
      signAccessToken(
        { sub: 'dev:x', org: ORG, email: 'x@example.test', role: 'admin' },
        'another-secret',
      ),
  },
]

function routes() {
  return [
    { method: 'GET', path: '/api/health', open: true },
    { method: 'GET', path: '/api/corpus/status', open: false },
    { method: 'GET', path: '/api/matters', open: false },
    { method: 'GET', path: `/api/matters/${matterId}`, open: false },
    { method: 'GET', path: `/api/matters/${matterId}/disclosure`, open: false },
    { method: 'GET', path: `/api/matters/${matterId}/messages`, open: false },
    { method: 'GET', path: `/api/matters/${matterId}/elements`, open: false },
    { method: 'GET', path: `/api/matters/${matterId}/searches`, open: false },
    { method: 'GET', path: `/api/matters/${matterId}/evidence`, open: false },
    { method: 'GET', path: `/api/matters/${matterId}/assessments`, open: false },
    { method: 'GET', path: `/api/matters/${matterId}/drafts`, open: false },
    { method: 'GET', path: `/api/matters/${matterId}/checks`, open: false },
    { method: 'GET', path: `/api/matters/${matterId}/graph`, open: false },
    { method: 'GET', path: `/api/matters/${matterId}/claims`, open: false },
    { method: 'GET', path: '/api/jobs', open: false },
    // default-deny の証明。ルートを足し忘れてもここが守る。
    { method: 'GET', path: '/api/not-a-route', open: false },
    { method: 'POST', path: '/api/internal/organizations', open: false, internal: true },
  ]
}

describe('認証のゲート', () => {
  for (const actor of actors) {
    for (const route of routes()) {
      it(`${actor.name} → ${route.method} ${route.path}`, async () => {
        const token = await actor.token()
        const res = await SELF.fetch(`https://x${route.path}`, {
          method: route.method,
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          ...(route.method === 'POST' ? { body: '{}' } : {}),
        })

        if (route.open) {
          expect(res.status).toBe(200)
          return
        }
        if (route.internal) {
          // 内部 API はテナントの JWT では越えられない。共有鍵が要る。
          expect(res.status).toBe(401)
          return
        }
        const authenticated = actor.name === 'staff' || actor.name === 'admin'
        if (!authenticated) {
          // 未認証・期限切れ・別 secret は **すべて 401**（403 と取り違えない）
          expect(res.status).toBe(401)
          return
        }
        // 認証が通れば、あとはルートの有無だけ（未知パスは 404）
        expect([200, 404]).toContain(res.status)
      })
    }
  }
})

describe('内部 API の鍵', () => {
  it('正しい鍵があれば通る', async () => {
    const res = await SELF.fetch('https://x/api/internal/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': 'dev-internal-key' },
      body: JSON.stringify({
        id: 'org_synced',
        name: 'synced',
        plan: 'free',
        isDisabled: false,
        createdAt: new Date().toISOString(),
      }),
    })
    expect(res.status).toBe(200)
  })

  it('鍵が違えば 401', async () => {
    const res = await SELF.fetch('https://x/api/internal/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': 'wrong' },
      body: '{}',
    })
    expect(res.status).toBe(401)
  })
})

describe('書き込みも同じゲートを通る', () => {
  const writes = () => [
    { method: 'POST', path: '/api/matters', body: { title: 'x' } },
    { method: 'PATCH', path: `/api/matters/${matterId}`, body: { title: 'y' } },
    { method: 'PUT', path: `/api/matters/${matterId}/disclosure`, body: {} },
    { method: 'PUT', path: `/api/matters/${matterId}/elements`, body: { elements: [] } },
    { method: 'POST', path: `/api/matters/${matterId}/searches`, body: { terms: ['瞳孔'] } },
    {
      method: 'POST',
      path: `/api/matters/${matterId}/evidence`,
      body: { elementId, pubNumber: 'x', paraNo: '0001', quotedText: 'あ', relation: 'discloses' },
    },
    { method: 'POST', path: `/api/evidence/${evidenceId}/review`, body: { review: 'confirmed' } },
    { method: 'POST', path: `/api/matters/${matterId}/assessments`, body: { kind: 'novelty' } },
    {
      method: 'PUT',
      path: `/api/matters/${matterId}/drafts`,
      body: { section: 'title', markdown: 'x' },
    },
    { method: 'POST', path: `/api/matters/${matterId}/jobs`, body: { kind: 'search' } },
    {
      method: 'POST',
      path: `/api/matters/${matterId}/messages`,
      body: { role: 'user', content: 'x' },
    },
    { method: 'PUT', path: `/api/matters/${matterId}/claims`, body: { claims: [] } },
    { method: 'POST', path: `/api/matters/${matterId}/evidence/recheck`, body: {} },
    { method: 'DELETE', path: `/api/matters/${matterId}/evidence/all`, body: {} },
    { method: 'POST', path: '/api/jobs/some-id/claim', body: { runner: 'x' } },
    { method: 'POST', path: '/api/jobs/some-id/complete', body: { status: 'done' } },
  ]

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])(
    '未認証の書き込み #%i は 401',
    async (i) => {
      const route = writes()[i]
      if (!route) return
      const res = await SELF.fetch(`https://x${route.path}`, {
        method: route.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(route.body),
      })
      expect(res.status).toBe(401)
    },
  )
})
