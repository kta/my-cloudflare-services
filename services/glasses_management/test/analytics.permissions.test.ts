import { SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'
import {
  auth,
  BASE,
  syncMembership,
  syncOrganization,
  syncStore,
  tokenFor,
  uuid,
} from './analytics.fixtures'

const JWT_SECRET = 'dev-jwt-secret-change-me'

type Row = {
  name: string
  method: 'GET' | 'POST' | 'PUT'
  path: (storeId: string, alertId: string) => string
  body?: unknown
  /** The exact permission set a staff member needs. */
  granted: readonly string[]
}

const analyticsSettingsBody = { smallSampleThreshold: 5, targets: [] }
const alertSettingsBody = {
  conditions: [{ code: 'long_wait', enabled: true, thresholdMinutes: 15 }],
  notificationTargets: [],
}

const rows: readonly Row[] = [
  {
    name: 'GET analytics report',
    method: 'GET',
    path: (storeId) => `/api/staff/stores/${storeId}/analytics?granularity=day&date=2026-08-31`,
    granted: ['store.read', 'analytics.read'],
  },
  {
    name: 'GET analytics settings',
    method: 'GET',
    path: (storeId) => `/api/staff/stores/${storeId}/analytics/settings`,
    granted: ['store.read', 'settings.read'],
  },
  {
    name: 'PUT analytics settings',
    method: 'PUT',
    path: (storeId) => `/api/staff/stores/${storeId}/analytics/settings`,
    body: analyticsSettingsBody,
    granted: ['store.read', 'settings.manage'],
  },
  {
    name: 'GET alert settings',
    method: 'GET',
    path: (storeId) => `/api/staff/stores/${storeId}/alert-settings`,
    granted: ['store.read', 'settings.read'],
  },
  {
    name: 'PUT alert settings',
    method: 'PUT',
    path: (storeId) => `/api/staff/stores/${storeId}/alert-settings`,
    body: alertSettingsBody,
    granted: ['store.read', 'settings.manage'],
  },
  {
    name: 'GET alerts',
    method: 'GET',
    path: (storeId) => `/api/staff/stores/${storeId}/alerts`,
    granted: ['store.read', 'reservation.read'],
  },
  {
    name: 'POST evaluate alerts',
    method: 'POST',
    path: (storeId) => `/api/staff/stores/${storeId}/alerts/evaluate`,
    granted: ['store.read', 'reservation.write'],
  },
  {
    name: 'POST mark alert read',
    method: 'POST',
    path: (storeId, alertId) => `/api/staff/stores/${storeId}/alerts/${alertId}/read`,
    granted: ['store.read', 'reservation.write'],
  },
  {
    name: 'POST resolve alert',
    method: 'POST',
    path: (storeId, alertId) => `/api/staff/stores/${storeId}/alerts/${alertId}/resolve`,
    body: { note: '対応済み' },
    granted: ['store.read', 'reservation.write'],
  },
]

/** Every permission the domain knows, minus the ones a row grants. */
const ALL_OTHER_PERMISSIONS = [
  'customer.read',
  'customer.write',
  'recording.read',
  'audit.read',
] as const

async function seed(permissions: readonly string[], role: 'admin' | 'staff' = 'staff') {
  const organizationId = uuid()
  await syncOrganization(organizationId)
  const storeId = await syncStore({ organizationId, name: '権限テスト店' })
  const userId = uuid()
  await syncMembership({ organizationId, storeId, userId, permissions })
  return { organizationId, storeId, token: await tokenFor(organizationId, role, userId) }
}

function request(row: Row, storeId: string, alertId: string, token?: string) {
  const init: RequestInit = {
    method: row.method,
    ...(row.body === undefined ? {} : { body: JSON.stringify(row.body) }),
  }
  return SELF.fetch(
    `${BASE}${row.path(storeId, alertId)}`,
    token === undefined
      ? { ...init, headers: { 'content-type': 'application/json' } }
      : auth(token, init),
  )
}

describe('analytics and alert permission matrix', () => {
  it.each(rows)('$name rejects an unauthenticated caller with 401', async (row) => {
    const { storeId } = await seed([])
    expect((await request(row, storeId, uuid())).status).toBe(401)
  })

  it.each(rows)('$name rejects an expired token with 401, not 403', async (row) => {
    const { organizationId, storeId } = await seed([...row.granted])
    const expired = await signAccessToken(
      { sub: uuid(), org: organizationId, email: 'a@example.test', role: 'staff' },
      JWT_SECRET,
      -1,
    )
    expect((await request(row, storeId, uuid(), expired)).status).toBe(401)
  })

  it.each(rows)('$name rejects a token signed with another secret with 401', async (row) => {
    const { organizationId, storeId } = await seed([...row.granted])
    const foreign = await signAccessToken(
      { sub: uuid(), org: organizationId, email: 'a@example.test', role: 'staff' },
      'foreign-secret',
    )
    expect((await request(row, storeId, uuid(), foreign)).status).toBe(401)
  })

  it.each(rows)('$name rejects a staff member without the grant with 403', async (row) => {
    const { storeId, token } = await seed([...ALL_OTHER_PERMISSIONS])
    expect((await request(row, storeId, uuid(), token)).status).toBe(403)
  })

  it.each(rows)('$name admits a staff member holding exactly the grant', async (row) => {
    const { storeId, token } = await seed([...row.granted])
    const response = await request(row, storeId, uuid(), token)
    // 404 means the grant passed and only the alert id was unknown.
    expect([200, 404]).toContain(response.status)
  })

  it.each(rows)('$name admits the tenant administrator', async (row) => {
    const { storeId, token } = await seed([], 'admin')
    const response = await request(row, storeId, uuid(), token)
    expect([200, 404]).toContain(response.status)
  })

  it('keeps default-deny for an unknown analytics path', async () => {
    const { storeId, token } = await seed(['store.read', 'analytics.read'], 'admin')
    expect(
      (await SELF.fetch(`${BASE}/api/staff/stores/${storeId}/analytics/not-a-route`)).status,
    ).toBe(401)
    expect(
      (await SELF.fetch(`${BASE}/api/staff/stores/${storeId}/analytics/not-a-route`, auth(token)))
        .status,
    ).toBe(404)
  })
})
