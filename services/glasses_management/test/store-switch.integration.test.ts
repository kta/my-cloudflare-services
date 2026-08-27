import { SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const INTERNAL_HEADERS = {
  'content-type': 'application/json',
  'x-internal-key': 'dev-internal-key',
}
const uuid = () => crypto.randomUUID()

function auth(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  }
}

async function setupStores() {
  const organizationId = uuid()
  const userId = uuid()
  const firstStoreId = uuid()
  const secondStoreId = uuid()
  const hiddenStoreId = uuid()
  const sync = async (path: string, body: unknown) => {
    expect(
      (
        await SELF.fetch(`${BASE}${path}`, {
          method: 'POST',
          headers: INTERNAL_HEADERS,
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(200)
  }
  await sync('/api/internal/organizations/sync', {
    id: organizationId,
    name: '切替組織',
    plan: 'free',
    isDisabled: false,
    createdAt: '2026-08-31T00:00:00.000Z',
  })
  for (const [id, name] of [
    [firstStoreId, '銀座店'],
    [secondStoreId, '丸の内店'],
    [hiddenStoreId, '権限外店'],
  ] as const) {
    await sync('/api/internal/stores/sync', {
      id,
      organizationId,
      name,
      slug: `store-${id.slice(0, 8)}`,
      isActive: true,
      createdAt: '2026-08-31T00:00:00.000Z',
    })
  }
  for (const storeId of [firstStoreId, secondStoreId]) {
    await sync('/api/internal/store-memberships/sync', {
      id: uuid(),
      organizationId,
      storeId,
      userId,
      permissions: ['store.read'],
      createdAt: '2026-08-31T00:00:00.000Z',
    })
  }
  return {
    organizationId,
    firstStoreId,
    secondStoreId,
    hiddenStoreId,
    token: await signAccessToken(
      { sub: userId, org: organizationId, email: `${uuid()}@example.test`, role: 'staff' },
      'dev-jwt-secret-change-me',
    ),
  }
}

describe('selected store switch audit', () => {
  it('records a switch only when the staff member can read both the source and destination stores', async () => {
    const scope = await setupStores()
    const switched = await SELF.fetch(
      `${BASE}/api/staff/store-switches`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({ fromStoreId: scope.firstStoreId, toStoreId: scope.secondStoreId }),
      }),
    )
    expect(switched.status).toBe(201)
    await expect(switched.json()).resolves.toEqual({ storeId: scope.secondStoreId })

    const denied = await SELF.fetch(
      `${BASE}/api/staff/store-switches`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({ fromStoreId: scope.firstStoreId, toStoreId: scope.hiddenStoreId }),
      }),
    )
    expect(denied.status).toBe(403)
  })
})
