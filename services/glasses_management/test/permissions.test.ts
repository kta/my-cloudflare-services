import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const JWT_SECRET = 'dev-jwt-secret-change-me'
const INTERNAL_KEY = 'dev-internal-key'
const JSON_HEADERS = { 'content-type': 'application/json' }

const uuid = () => crypto.randomUUID()

async function tokenFor(
  org: string,
  role: 'admin' | 'staff' = 'staff',
  secret = JWT_SECRET,
  ttlSeconds?: number,
) {
  return signAccessToken(
    { sub: uuid(), org, email: `${uuid()}@example.test`, role },
    secret,
    ttlSeconds,
  )
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {}
}

function internalHeaders(): Record<string, string> {
  return { ...JSON_HEADERS, 'x-internal-key': INTERNAL_KEY }
}

async function syncOrganization(
  id = uuid(),
  overrides: Partial<{ name: string; plan: 'free' | 'contracted'; isDisabled: boolean }> = {},
) {
  const organization = {
    id,
    name: overrides.name ?? 'EYEX test organization',
    plan: overrides.plan ?? 'free',
    isDisabled: overrides.isDisabled ?? false,
    createdAt: new Date('2026-08-26T00:00:00.000Z').toISOString(),
  }
  const response = await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
    method: 'POST',
    headers: internalHeaders(),
    body: JSON.stringify(organization),
  })
  expect(response.status).toBe(200)
  return organization
}

describe('glasses_management permission boundary', () => {
  it.each([
    ['no token', undefined, 401],
    ['expired token', 'expired', 401],
    ['wrong secret', 'wrong-secret', 401],
  ] as const)('%s is rejected with %i', async (_name, tokenKind, status) => {
    const org = uuid()
    await syncOrganization(org)
    const token =
      tokenKind === undefined
        ? undefined
        : tokenKind === 'expired'
          ? await tokenFor(org, 'staff', JWT_SECRET, -1)
          : await tokenFor(org, 'staff', 'foreign-secret')
    const response = await SELF.fetch(`${BASE}/api/staff/stores`, {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(status)
  })

  it('returns 503 for an authenticated organization that has not been synchronized', async () => {
    const token = await tokenFor(uuid())
    const response = await SELF.fetch(`${BASE}/api/staff/stores`, {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'not_synced' })
  })

  it('returns 403 for a synchronized but disabled organization', async () => {
    const org = uuid()
    await syncOrganization(org, { isDisabled: true })
    const token = await tokenFor(org)
    const response = await SELF.fetch(`${BASE}/api/staff/stores`, {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'org_disabled' })
  })

  it('keeps the unknown API route behind default-deny authentication', async () => {
    const org = await syncOrganization()
    const token = await tokenFor(org.id)
    const unauthenticated = await SELF.fetch(`${BASE}/api/not-a-route`)
    expect(unauthenticated.status).toBe(401)

    const response = await SELF.fetch(`${BASE}/api/not-a-route`, {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(404)
  })

  it('does not allow a tenant JWT to call internal organization sync', async () => {
    const org = await syncOrganization()
    const token = await tokenFor(org.id)
    const response = await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...authHeaders(token) },
      body: JSON.stringify({
        id: uuid(),
        name: 'spoofed organization',
        plan: 'free',
        isDisabled: false,
        createdAt: new Date('2026-08-26T00:00:00.000Z').toISOString(),
      }),
    })
    expect(response.status).toBe(401)
  })

  it('requires the internal key and rejects an incorrect key', async () => {
    const body = JSON.stringify({
      id: uuid(),
      name: 'internal organization',
      plan: 'free',
      isDisabled: false,
      createdAt: new Date('2026-08-26T00:00:00.000Z').toISOString(),
    })
    const noKey = await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body,
    })
    expect(noKey.status).toBe(401)

    const wrongKey = await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'x-internal-key': 'wrong-key' },
      body,
    })
    expect(wrongKey.status).toBe(401)
  })

  it('accepts the foundation compatibility sync paths', async () => {
    const organization = await syncOrganization()
    const organizationAlias = await SELF.fetch(`${BASE}/api/internal/organizations`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({
        ...organization,
        name: 'Updated through alias',
        revision: 1,
      }),
    })
    expect(organizationAlias.status).toBe(200)

    const store = {
      id: uuid(),
      organizationId: organization.id,
      name: 'Alias store',
      slug: `alias-${uuid().slice(0, 8)}`,
      isActive: true,
      createdAt: new Date('2026-08-26T00:00:00.000Z').toISOString(),
    }
    const storeAlias = await SELF.fetch(`${BASE}/api/internal/stores`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify(store),
    })
    expect(storeAlias.status).toBe(200)
    const token = await tokenFor(organization.id, 'admin')
    const stores = await SELF.fetch(`${BASE}/api/staff/stores`, {
      headers: authHeaders(token),
    })
    await expect(stores.json()).resolves.toEqual([expect.objectContaining({ id: store.id })])
  })

  it('fails closed when a synchronized organization row has invalid state', async () => {
    const organization = await syncOrganization()
    await env.DB.prepare("UPDATE organizations SET is_disabled = 'unknown' WHERE id = ?")
      .bind(organization.id)
      .run()
    const token = await tokenFor(organization.id)
    const response = await SELF.fetch(`${BASE}/api/staff/stores`, {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'not_synced' })

    const invalidPlan = await syncOrganization()
    await env.DB.prepare("UPDATE organizations SET plan = 'unknown' WHERE id = ?")
      .bind(invalidPlan.id)
      .run()
    const invalidPlanResponse = await SELF.fetch(`${BASE}/api/staff/stores`, {
      headers: authHeaders(await tokenFor(invalidPlan.id)),
    })
    expect(invalidPlanResponse.status).toBe(503)
  })

  it('converts an unexpected domain row error into the shared internal error', async () => {
    const organization = await syncOrganization()
    const store = {
      id: uuid(),
      organizationId: organization.id,
      name: 'Corrupt store',
      slug: `corrupt-${uuid().slice(0, 8)}`,
      isActive: true,
      createdAt: new Date('2026-08-26T00:00:00.000Z').toISOString(),
    }
    const synced = await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify(store),
    })
    expect(synced.status).toBe(200)
    await env.DB.prepare("UPDATE stores SET slug = 'not a slug' WHERE id = ?").bind(store.id).run()

    const token = await tokenFor(organization.id, 'admin')
    const response = await SELF.fetch(`${BASE}/api/staff/stores/${store.id}`, {
      headers: authHeaders(token),
    })
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'internal_error' })
  })
})
