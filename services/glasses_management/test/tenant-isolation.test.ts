import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const JWT_SECRET = 'dev-jwt-secret-change-me'
const JSON_HEADERS = { 'content-type': 'application/json' }
const INTERNAL = { ...JSON_HEADERS, 'x-internal-key': 'dev-internal-key' }

const uuid = () => crypto.randomUUID()

async function tokenFor(org: string, role: 'admin' | 'staff' = 'staff') {
  return signAccessToken({ sub: uuid(), org, email: `${uuid()}@example.test`, role }, JWT_SECRET)
}

async function syncOrganization(id: string) {
  const organization = {
    id,
    name: `Organization ${id.slice(0, 8)}`,
    plan: 'free',
    isDisabled: false,
    createdAt: new Date('2026-08-26T00:00:00.000Z').toISOString(),
  }
  const response = await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify(organization),
  })
  expect(response.status).toBe(200)
}

async function syncStore(input: {
  id: string
  organizationId: string
  name: string
  slug: string
}) {
  const response = await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      ...input,
      isActive: true,
      createdAt: new Date('2026-08-26T00:00:00.000Z').toISOString(),
    }),
  })
  expect(response.status).toBe(200)
}

async function syncMembership(input: {
  id: string
  organizationId: string
  storeId: string
  userId: string
  permissions?: string[]
}) {
  const response = await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      ...input,
      permissions: input.permissions ?? ['store.read', 'store.manage'],
      createdAt: new Date('2026-08-26T00:00:00.000Z').toISOString(),
    }),
  })
  expect(response.status).toBe(200)
}

function auth(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
  }
}

describe('organization and store tenant isolation', () => {
  it('lists only stores belonging to the JWT organization across three tenants', async () => {
    const organizations = [uuid(), uuid(), uuid()]
    await Promise.all(organizations.map(syncOrganization))
    const stores = organizations.map((organizationId, index) => ({
      id: uuid(),
      organizationId,
      name: `Store ${index + 1}`,
      slug: `store-${index + 1}-${uuid().slice(0, 8)}`,
    }))
    await Promise.all(stores.map(syncStore))

    const tokens = await Promise.all(organizations.map((id) => tokenFor(id, 'admin')))
    const responses = await Promise.all(
      tokens.map((token) => SELF.fetch(`${BASE}/api/staff/stores`, auth(token))),
    )
    const bodies = await Promise.all(
      responses.map(
        (response) => response.json() as Promise<Array<{ id: string; organizationId: string }>>,
      ),
    )

    for (let i = 0; i < organizations.length; i += 1) {
      expect(bodies[i]).toHaveLength(1)
      expect(bodies[i]?.[0]?.organizationId).toBe(organizations[i])
      expect(bodies[i]?.[0]?.id).toBe(stores[i]?.id)
    }

    const detail = await SELF.fetch(
      `${BASE}/api/staff/stores/${stores[0]?.id}`,
      auth(tokens[0] as string),
    )
    expect(detail.status).toBe(200)
    await expect(detail.json()).resolves.toMatchObject({ id: stores[0]?.id })
    await env.DB.prepare("UPDATE stores SET is_active = '0' WHERE id = ?").bind(stores[0]?.id).run()
    const inactiveDetail = await SELF.fetch(
      `${BASE}/api/staff/stores/${stores[0]?.id}`,
      auth(tokens[0] as string),
    )
    expect(inactiveDetail.status).toBe(403)
  })

  it('uses the JWT organization for writes even when the request body is spoofed', async () => {
    const owner = uuid()
    const victim = uuid()
    await Promise.all([syncOrganization(owner), syncOrganization(victim)])
    const ownerStore = {
      id: uuid(),
      organizationId: owner,
      name: 'Owner store',
      slug: `owner-${uuid()}`,
    }
    const victimStore = {
      id: uuid(),
      organizationId: victim,
      name: 'Victim store',
      slug: `victim-${uuid()}`,
    }
    await Promise.all([syncStore(ownerStore), syncStore(victimStore)])

    const ownerSubject = uuid()
    const ownerToken = await signAccessToken(
      { sub: ownerSubject, org: owner, email: `${uuid()}@example.test`, role: 'staff' },
      JWT_SECRET,
    )
    await syncMembership({
      id: uuid(),
      organizationId: owner,
      storeId: ownerStore.id,
      userId: ownerSubject,
    })

    const crossTenantRead = await SELF.fetch(
      `${BASE}/api/staff/stores/${victimStore.id}`,
      auth(ownerToken),
    )
    expect(crossTenantRead.status).toBe(403)

    // Reservation read/history routes must derive their organization and
    // selected-store scope solely from the JWT and membership.
    const crossTenantReservations = await SELF.fetch(
      `${BASE}/api/staff/stores/${victimStore.id}/reservations`,
      auth(ownerToken),
    )
    expect(crossTenantReservations.status).toBe(403)
    const crossTenantHistory = await SELF.fetch(
      `${BASE}/api/staff/stores/${victimStore.id}/reservations/${uuid()}/history`,
      auth(ownerToken),
    )
    expect(crossTenantHistory.status).toBe(403)
    const crossTenantNoShow = await SELF.fetch(
      `${BASE}/api/staff/stores/${victimStore.id}/reservations/${uuid()}/no-show`,
      auth(ownerToken, { method: 'POST', body: JSON.stringify({ version: 1 }) }),
    )
    expect(crossTenantNoShow.status).toBe(403)

    const spoofedUpdate = await SELF.fetch(
      `${BASE}/api/staff/stores/${ownerStore.id}`,
      auth(ownerToken, {
        method: 'PATCH',
        body: JSON.stringify({ organizationId: victim, name: 'Updated owner store' }),
      }),
    )
    // StorePatch is strict: an organizationId supplied by the caller is
    // rejected before the write, rather than being used as an authorization
    // input. Either behavior prevents tenant crossing; 400 is the API's
    // documented unknown-key response.
    expect(spoofedUpdate.status).toBe(400)
    const unchanged = await SELF.fetch(
      `${BASE}/api/staff/stores/${ownerStore.id}`,
      auth(ownerToken),
    )
    await expect(unchanged.json()).resolves.toMatchObject({
      organizationId: owner,
      name: ownerStore.name,
    })

    const update = await SELF.fetch(
      `${BASE}/api/staff/stores/${ownerStore.id}`,
      auth(ownerToken, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated owner store' }),
      }),
    )
    expect(update.status).toBe(200)
    await expect(update.json()).resolves.toMatchObject({
      organizationId: owner,
      name: 'Updated owner store',
    })
    const keepActive = await SELF.fetch(
      `${BASE}/api/staff/stores/${ownerStore.id}`,
      auth(ownerToken, { method: 'PATCH', body: JSON.stringify({ isActive: true }) }),
    )
    expect(keepActive.status).toBe(200)
    const deactivate = await SELF.fetch(
      `${BASE}/api/staff/stores/${ownerStore.id}`,
      auth(ownerToken, { method: 'PATCH', body: JSON.stringify({ isActive: false }) }),
    )
    expect(deactivate.status).toBe(200)
    await expect(deactivate.json()).resolves.toMatchObject({ isActive: false })

    const victimToken = await tokenFor(victim, 'admin')
    const victimStores = await SELF.fetch(`${BASE}/api/staff/stores`, auth(victimToken))
    await expect(victimStores.json()).resolves.toEqual([
      expect.objectContaining({ id: victimStore.id, organizationId: victim }),
    ])
  })

  it('requires a membership permission for staff and does not leak a forbidden store', async () => {
    const org = uuid()
    await syncOrganization(org)
    const store = {
      id: uuid(),
      organizationId: org,
      name: 'Restricted store',
      slug: `restricted-${uuid()}`,
    }
    await syncStore(store)
    const subject = uuid()
    const token = await signAccessToken(
      { sub: subject, org, email: `${uuid()}@example.test`, role: 'staff' },
      JWT_SECRET,
    )
    await syncMembership({
      id: uuid(),
      organizationId: org,
      storeId: store.id,
      userId: subject,
      permissions: [],
    })

    const list = await SELF.fetch(`${BASE}/api/staff/stores`, auth(token))
    expect(list.status).toBe(200)
    await expect(list.json()).resolves.toEqual([])

    const detail = await SELF.fetch(`${BASE}/api/staff/stores/${store.id}`, auth(token))
    expect(detail.status).toBe(403)

    const forbiddenUpdate = await SELF.fetch(
      `${BASE}/api/staff/stores/${store.id}`,
      auth(token, { method: 'PATCH', body: JSON.stringify({ name: 'must not update' }) }),
    )
    expect(forbiddenUpdate.status).toBe(403)

    await env.DB.prepare("UPDATE store_memberships SET permissions = '{not-json' WHERE user_id = ?")
      .bind(subject)
      .run()
    const malformed = await SELF.fetch(`${BASE}/api/staff/stores`, auth(token))
    expect(malformed.status).toBe(200)
    await expect(malformed.json()).resolves.toEqual([])

    await env.DB.prepare(
      'UPDATE store_memberships SET permissions = \'["unknown.permission"]\' WHERE user_id = ?',
    )
      .bind(subject)
      .run()
    const unknownPermission = await SELF.fetch(`${BASE}/api/staff/stores`, auth(token))
    expect(unknownPermission.status).toBe(200)
    await expect(unknownPermission.json()).resolves.toEqual([])
  })

  it('upserts a membership by organization, store, and user instead of duplicating it when its source id changes', async () => {
    const organizationId = uuid()
    await syncOrganization(organizationId)
    const store = {
      id: uuid(),
      organizationId,
      name: 'Membership store',
      slug: `membership-${uuid()}`,
    }
    await syncStore(store)
    const userId = uuid()

    await syncMembership({
      id: uuid(),
      organizationId,
      storeId: store.id,
      userId,
      permissions: ['store.read'],
    })
    await syncMembership({
      id: uuid(),
      organizationId,
      storeId: store.id,
      userId,
      permissions: ['store.manage'],
    })

    const rows = await env.DB.prepare(
      `SELECT id, permissions
       FROM store_memberships
       WHERE organization_id = ? AND store_id = ? AND user_id = ?`,
    )
      .bind(organizationId, store.id, userId)
      .all<{ id: string; permissions: string }>()
    expect(rows.results).toHaveLength(1)
    expect(rows.results[0]?.permissions).toBe('["store.manage"]')
  })
})
