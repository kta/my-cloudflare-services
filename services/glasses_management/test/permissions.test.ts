/**
 * 業務 API の**権限マトリクス**を表駆動で固定する。
 *
 * ゲートは default-deny（`/api/*` に一括適用）なので、ルートを足しただけで
 * 守られる。その性質が壊れていないことを、未知パスへのアクセスでも確かめる。
 * 期限切れは「権限なし(403)」ではなく「未認証(401)」に写像されなければならない
 * — クライアントの再ログイン判定がこの区別に依存している。
 *
 * 新しいルートを足したら、この表に 1 行足す。
 */
import { SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import { BASE, INTERNAL_HEADERS, JSON_HEADERS, JWT_SECRET, orgId, tokenFor } from './helpers'

type ActorName = 'none' | 'staff' | 'admin' | 'expired' | 'wrong-secret'

const ORG = orgId()
const tokens: Record<Exclude<ActorName, 'none'>, string> = {
  staff: '',
  admin: '',
  expired: '',
  'wrong-secret': '',
}

beforeAll(async () => {
  tokens.staff = await tokenFor(ORG, 'staff')
  tokens.admin = await tokenFor(ORG, 'admin')
  // 期限切れは固定の過去時刻から作る（`now` を引数で注入するので実時刻に依存しない）。
  const issuedAt = Math.floor(Date.parse('2020-01-01T00:00:00.000Z') / 1000)
  tokens.expired = await signAccessToken(
    { sub: 'dev:expired', org: ORG, email: 'a@example.test', role: 'staff' },
    JWT_SECRET,
    1,
    issuedAt,
  )
  tokens['wrong-secret'] = await signAccessToken(
    { sub: 'dev:other', org: ORG, email: 'a@example.test', role: 'staff' },
    'another-secret-entirely',
  )
})

function headersFor(actor: ActorName): HeadersInit {
  if (actor === 'none') return JSON_HEADERS
  return { ...JSON_HEADERS, authorization: `Bearer ${tokens[actor]}` }
}

type Row = {
  name: string
  method: 'GET' | 'POST'
  path: string
  body?: unknown
  expected: Partial<Record<ActorName, number>>
}

/**
 * 期待値は「その主体がそのパスを叩いたときの status」。
 * 200 系は経路が通ったこと、401 は未認証、403 は権限不足、404 は存在しないこと。
 */
const TABLE: Row[] = [
  {
    name: 'ヘルスチェックは誰でも通る',
    method: 'GET',
    path: '/api/health',
    expected: { none: 200, staff: 200, admin: 200, expired: 200, 'wrong-secret': 200 },
  },
  {
    name: '店舗一覧はテナントの JWT を要求する',
    method: 'GET',
    path: '/api/staff/stores',
    expected: { none: 401, staff: 200, admin: 200, expired: 401, 'wrong-secret': 401 },
  },
  {
    name: '未知パスも default-deny の対象（ルートを足し忘れても漏れない）',
    method: 'GET',
    path: '/api/staff/not-a-route',
    expected: { none: 401, staff: 404, admin: 404, expired: 401, 'wrong-secret': 401 },
  },
  {
    name: '内部 API はテナント JWT では越えられない（共有鍵が要る）',
    method: 'GET',
    path: '/api/internal/organizations',
    expected: { none: 401, staff: 401, admin: 401, expired: 401, 'wrong-secret': 401 },
  },
]

describe('権限マトリクス', () => {
  for (const row of TABLE) {
    for (const [actor, expected] of Object.entries(row.expected) as [ActorName, number][]) {
      it(`${row.name} — ${actor} は ${expected}`, async () => {
        const res = await SELF.fetch(`${BASE}${row.path}`, {
          method: row.method,
          headers: headersFor(actor),
          ...(row.body ? { body: JSON.stringify(row.body) } : {}),
        })
        expect(res.status).toBe(expected)
      })
    }
  }
})

describe('内部 API の共有鍵', () => {
  it('正しい鍵なら通る', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/organizations`, {
      headers: INTERNAL_HEADERS,
    })
    expect(res.status).toBe(200)
  })

  it('鍵が違えば 401', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/organizations`, {
      headers: { ...JSON_HEADERS, 'x-internal-key': 'not-the-key' },
    })
    expect(res.status).toBe(401)
  })

  it('鍵が無ければ 401', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/organizations`, { headers: JSON_HEADERS })
    expect(res.status).toBe(401)
  })
})

describe('dev トークングラント', () => {
  it('組織 id が空なら 400', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/token`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ organizationId: '', role: 'staff' }),
    })
    expect(res.status).toBe(400)
  })
})
