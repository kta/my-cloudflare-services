import { SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { expect } from 'vitest'

const BASE = 'https://glasses-management.test'
const JWT_SECRET = 'dev-jwt-secret-change-me'
const INTERNAL = { 'content-type': 'application/json', 'x-internal-key': 'dev-internal-key' }
const JSON_HEADERS = { 'content-type': 'application/json' }

const uuid = () => crypto.randomUUID()

type Scope = {
  organizationId: string
  storeId: string
  otherStoreId: string
  subjectId: string
  token: string
}

export async function syncStore(organizationId: string, storeId: string, isActive = true) {
  const response = await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: storeId,
      organizationId,
      name: 'Settings test store',
      slug: `settings-${storeId.slice(0, 8)}`,
      isActive,
      createdAt: '2026-08-26T00:00:00.000Z',
    }),
  })
  expect(response.status).toBe(200)
}

async function syncMembership(
  organizationId: string,
  storeId: string,
  userId: string,
  permissions: string[],
) {
  const response = await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: uuid(),
      organizationId,
      storeId,
      userId,
      permissions,
      createdAt: '2026-08-26T00:00:00.000Z',
    }),
  })
  expect(response.status).toBe(200)
}

export async function setupScope(
  permissions: string[] = ['settings.read', 'settings.manage', 'reservation.write'],
  options: { otherStoreActive?: boolean } = {},
): Promise<Scope> {
  const organizationId = uuid()
  const storeId = uuid()
  const otherStoreId = uuid()
  const subjectId = uuid()
  const organizationResponse = await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: organizationId,
      name: 'Settings publication organization',
      plan: 'free',
      isDisabled: false,
      createdAt: '2026-08-26T00:00:00.000Z',
    }),
  })
  expect(organizationResponse.status).toBe(200)
  await syncStore(organizationId, storeId)
  await syncStore(organizationId, otherStoreId, options.otherStoreActive ?? true)
  await syncMembership(organizationId, storeId, subjectId, permissions)
  await syncMembership(organizationId, otherStoreId, subjectId, permissions)
  return {
    organizationId,
    storeId,
    otherStoreId,
    subjectId,
    token: await signAccessToken(
      { sub: subjectId, org: organizationId, email: `${uuid()}@example.test`, role: 'staff' },
      JWT_SECRET,
    ),
  }
}

export function auth(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  }
}

export function settingsPayload(overrides: Record<string, unknown> = {}) {
  const purposeId = uuid()
  const staffId = uuid()
  const equipmentId = uuid()
  return {
    version: 0,
    receptionStatus: 'open',
    // 2026-08-31 (the pinned test clock day) is a Monday in JST.
    businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
    exceptions: [],
    purposes: [
      {
        id: purposeId,
        staffName: '視力測定',
        customerLabel: 'メガネを新しく作りたい',
        durationMinutes: 60,
        slotIntervalMinutes: 30,
        isPublic: true,
        requiredSkills: ['眼鏡作製技能'],
        requiredEquipment: ['視力測定機'],
        maxConcurrent: 1,
      },
    ],
    staff: [
      { id: staffId, name: '担当者', skills: ['眼鏡作製技能'], canBook: true, isActive: true },
    ],
    shifts: [
      {
        id: uuid(),
        staffId,
        date: '2026-08-31',
        startTime: '10:00',
        endTime: '19:00',
        breaks: [],
      },
    ],
    equipment: [
      {
        id: equipmentId,
        name: '視力測定機',
        capacity: 1,
        isActive: true,
        availablePeriods: [{ startTime: '10:00', endTime: '19:00' }],
      },
    ],
    maintenance: [],
    ...overrides,
  }
}

export async function putSettings(scope: Scope, storeId: string, payload: unknown) {
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/availability/settings`,
    auth(scope.token, { method: 'PUT', body: JSON.stringify(payload) }),
  )
  expect(response.status).toBe(201)
  return (await response.json()) as { version: number }
}

export async function saveDraft(
  scope: Scope,
  storeId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/availability/draft`,
    auth(scope.token, { method: 'PUT', body: JSON.stringify(body) }),
  )
}

export async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}
