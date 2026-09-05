/**
 * 運営が会社のお店の一覧を引く（`GET /api/organizations/:id/stores`）。
 *
 * これが無い間、担当店舗の割り当ては店舗 id を手で打つしかなく、打ち間違いに
 * 気づけなかった。admin は店舗を持たないので、ドメインへ service binding で
 * 尋ねて返す。**内部キーは応答にも記録にも出さない。**
 */
import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

const BASE = 'https://admin.test'
const JSON_HEADERS = { 'content-type': 'application/json' }

async function operatorToken(): Promise<string> {
  const response = await SELF.fetch(`${BASE}/api/auth/token`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      organizationId: `operator-${crypto.randomUUID()}`,
      role: 'admin',
      email: `operator-${crypto.randomUUID()}@example.test`,
    }),
  })
  return ((await response.json()) as { token: string }).token
}

async function createOrganization(token: string): Promise<string> {
  const response = await SELF.fetch(`${BASE}/api/organizations`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'EYE tenant', plan: 'contracted' }),
  })
  return ((await response.json()) as { id: string }).id
}

const STORE = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: 'placeholder',
  name: '銀座店',
  slug: 'ginza',
  phone: '',
  address: '',
  accessNote: '',
  isActive: true,
  createdAt: '2026-09-05T00:00:00.000Z',
}

afterEach(() => vi.restoreAllMocks())

describe('GET /api/organizations/:id/stores', () => {
  it('ドメインに会社を指定して尋ね、返ってきた店舗を返す', async () => {
    const token = await operatorToken()
    const orgId = await createOrganization(token)
    // Response は**呼ばれたその場で**作る。テスト側の request context で作った body は
    // Worker のハンドラから読めない（Workers の I/O 分離）。
    const spy = vi.spyOn(env.GLASSES_MANAGEMENT, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify([{ ...STORE, organizationId: orgId }]), {
          status: 200,
          headers: JSON_HEADERS,
        }) as unknown as never,
    )

    const response = await SELF.fetch(`${BASE}/api/organizations/${orgId}/stores`, {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ ...STORE, organizationId: orgId }])

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).searchParams.get('organizationId')).toBe(orgId)
    expect((init.headers as Record<string, string>)['x-internal-key']).toBe('dev-internal-key')
  })

  it('お店がまだ 1 つも無ければ空の配列を返す', async () => {
    const token = await operatorToken()
    const orgId = await createOrganization(token)
    vi.spyOn(env.GLASSES_MANAGEMENT, 'fetch').mockImplementation(
      async () => new Response('[]', { status: 200, headers: JSON_HEADERS }) as unknown as never,
    )

    const response = await SELF.fetch(`${BASE}/api/organizations/${orgId}/stores`, {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  it('知らない会社は 404（ドメインには尋ねない）', async () => {
    const token = await operatorToken()
    const spy = vi.spyOn(env.GLASSES_MANAGEMENT, 'fetch')

    const response = await SELF.fetch(`${BASE}/api/organizations/does-not-exist/stores`, {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(404)
    expect(spy).not.toHaveBeenCalled()
  })

  it('ドメインが落ちていたら 502 を返し、内部の様子は漏らさない', async () => {
    const token = await operatorToken()
    const orgId = await createOrganization(token)
    vi.spyOn(env.GLASSES_MANAGEMENT, 'fetch').mockRejectedValue(new Error('boom'))

    const response = await SELF.fetch(`${BASE}/api/organizations/${orgId}/stores`, {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toContain('boom')
  })

  it('ドメインが壊れた形を返したら 502 にする（そのまま流さない）', async () => {
    const token = await operatorToken()
    const orgId = await createOrganization(token)
    vi.spyOn(env.GLASSES_MANAGEMENT, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify([{ id: 'not-a-uuid' }]), {
          status: 200,
          headers: JSON_HEADERS,
        }) as unknown as never,
    )

    const response = await SELF.fetch(`${BASE}/api/organizations/${orgId}/stores`, {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(502)
  })

  it('未認証では引けない', async () => {
    const token = await operatorToken()
    const orgId = await createOrganization(token)

    const response = await SELF.fetch(`${BASE}/api/organizations/${orgId}/stores`)
    expect(response.status).toBe(401)
  })

  it('自分の会社なら、運営でない本部管理者でも引ける', async () => {
    // dev グラントは運営 org を作るので、テナントの org 行を別に用意して騙る。
    const tenantOrg = `tenant-${crypto.randomUUID()}`
    await env.DB.prepare(
      "INSERT INTO organizations (id, name, plan, is_disabled, is_operator, sync_revision, created_at) VALUES (?,?,'free','0','0',1,?)",
    )
      .bind(tenantOrg, 'テナント', '2026-09-05T00:00:00.000Z')
      .run()
    const token = await signAccessToken(
      { sub: `dev:${tenantOrg}`, org: tenantOrg, email: 'ho@tenant.test', role: 'admin' },
      'dev-jwt-secret-change-me',
    )
    vi.spyOn(env.GLASSES_MANAGEMENT, 'fetch').mockImplementation(
      async () => new Response('[]', { status: 200, headers: JSON_HEADERS }) as unknown as never,
    )

    const response = await SELF.fetch(`${BASE}/api/organizations/${tenantOrg}/stores`, {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
  })

  it('他社のお店は、運営でなければ引けない', async () => {
    const tenantOrg = `tenant-${crypto.randomUUID()}`
    const otherOrg = `tenant-${crypto.randomUUID()}`
    for (const id of [tenantOrg, otherOrg]) {
      await env.DB.prepare(
        "INSERT INTO organizations (id, name, plan, is_disabled, is_operator, sync_revision, created_at) VALUES (?,?,'free','0','0',1,?)",
      )
        .bind(id, 'テナント', '2026-09-05T00:00:00.000Z')
        .run()
    }
    const token = await signAccessToken(
      { sub: `dev:${tenantOrg}`, org: tenantOrg, email: 'ho@tenant.test', role: 'admin' },
      'dev-jwt-secret-change-me',
    )
    const spy = vi.spyOn(env.GLASSES_MANAGEMENT, 'fetch')

    const response = await SELF.fetch(`${BASE}/api/organizations/${otherOrg}/stores`, {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(403)
    expect(spy).not.toHaveBeenCalled()
  })
})
