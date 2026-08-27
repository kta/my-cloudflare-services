import { SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const INTERNAL_HEADERS = {
  'content-type': 'application/json',
  'x-internal-key': 'dev-internal-key',
}
const uuid = () => crypto.randomUUID()

async function post(path: string, body: unknown) {
  const response = await SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(200)
}

async function scope(permissions: string[], role: 'admin' | 'staff' = 'staff') {
  const organizationId = uuid()
  const storeId = uuid()
  const userId = uuid()
  await post('/api/internal/organizations/sync', {
    id: organizationId,
    name: '権限確認組織',
    plan: 'free',
    isDisabled: false,
    createdAt: '2026-08-31T00:00:00.000Z',
  })
  await post('/api/internal/stores/sync', {
    id: storeId,
    organizationId,
    name: '権限確認店舗',
    slug: `perm-${uuid().slice(0, 8)}`,
    isActive: true,
    createdAt: '2026-08-31T00:00:00.000Z',
  })
  if (permissions.length > 0)
    await post('/api/internal/store-memberships/sync', {
      id: uuid(),
      organizationId,
      storeId,
      userId,
      permissions,
      createdAt: '2026-08-31T00:00:00.000Z',
    })
  return {
    organizationId,
    storeId,
    token: await signAccessToken(
      { sub: userId, org: organizationId, email: `${uuid()}@example.test`, role },
      'dev-jwt-secret-change-me',
    ),
  }
}

function read(storeId: string, token: string) {
  return SELF.fetch(`${BASE}/api/staff/stores/${storeId}/permissions`, {
    headers: { authorization: `Bearer ${token}` },
  })
}

/*
 * The staff UI must decide what to show — cross-store history, attention notes,
 * recording playback — from the caller's real permissions, not from a guess.
 * Without this endpoint the client either over-exposes restricted information
 * or permanently hides information the operator is entitled to see.
 */
describe('selected-store permissions for the current actor', () => {
  it('answers with the permissions the caller actually holds for the store', async () => {
    const context = await scope(['store.read', 'customer.read', 'customer.history'])

    const response = await read(context.storeId, context.token)

    expect(response.status).toBe(200)
    const permissions = (await response.json()) as string[]
    expect([...permissions].sort()).toEqual(['customer.history', 'customer.read', 'store.read'])
  })

  it('refuses a caller with no membership for the store without revealing it exists', async () => {
    const context = await scope([])

    const response = await read(context.storeId, context.token)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('answers the same 403 for a store in another organization', async () => {
    const mine = await scope(['store.read'])
    const theirs = await scope(['store.read'])

    const response = await read(theirs.storeId, mine.token)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('rejects an unauthenticated request', async () => {
    const context = await scope(['store.read'])

    const response = await SELF.fetch(`${BASE}/api/staff/stores/${context.storeId}/permissions`)

    expect(response.status).toBe(401)
  })
})
