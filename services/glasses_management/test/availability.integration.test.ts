import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const JWT_SECRET = 'dev-jwt-secret-change-me'
const INTERNAL = {
  'content-type': 'application/json',
  'x-internal-key': 'dev-internal-key',
}
const JSON_HEADERS = { 'content-type': 'application/json' }

const uuid = () => crypto.randomUUID()

type Scope = { organizationId: string; storeId: string; subjectId: string; token: string }

async function setupScope(
  permissions: string[] = ['settings.read', 'settings.manage'],
): Promise<Scope> {
  const organizationId = uuid()
  const storeId = uuid()
  const subjectId = uuid()
  const organizationResponse = await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: organizationId,
      name: 'Availability test organization',
      plan: 'free',
      isDisabled: false,
      createdAt: '2026-08-26T00:00:00.000Z',
    }),
  })
  expect(organizationResponse.status).toBe(200)
  const storeResponse = await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: storeId,
      organizationId,
      name: 'Availability test store',
      slug: `availability-${uuid().slice(0, 8)}`,
      isActive: true,
      createdAt: '2026-08-26T00:00:00.000Z',
    }),
  })
  expect(storeResponse.status).toBe(200)
  const membershipResponse = await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: uuid(),
      organizationId,
      storeId,
      userId: subjectId,
      permissions,
      createdAt: '2026-08-26T00:00:00.000Z',
    }),
  })
  expect(membershipResponse.status).toBe(200)
  return {
    organizationId,
    storeId,
    subjectId,
    token: await signAccessToken(
      { sub: subjectId, org: organizationId, email: `${uuid()}@example.test`, role: 'staff' },
      JWT_SECRET,
    ),
  }
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

function settings(overrides: Record<string, unknown> = {}) {
  const purposeId = uuid()
  const staffId = uuid()
  const equipmentId = uuid()
  return {
    version: 0,
    receptionStatus: 'open',
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
      {
        id: staffId,
        name: '担当者',
        skills: ['眼鏡作製技能'],
        canBook: true,
        isActive: true,
      },
    ],
    shifts: [
      {
        id: uuid(),
        staffId,
        date: '2026-08-31',
        startTime: '10:00',
        endTime: '19:00',
        breaks: [{ startTime: '13:00', endTime: '14:00' }],
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

async function putSettings(scope: Scope, input: Record<string, unknown>) {
  return putSettingsAt(scope.token, scope.storeId, input)
}

async function putSettingsAt(token: string, storeId: string, input: Record<string, unknown>) {
  return SELF.fetch(`${BASE}/api/staff/stores/${storeId}/availability/settings`, {
    ...auth(token, { method: 'PUT', body: JSON.stringify(input) }),
  })
}

describe('availability settings and candidate slots', () => {
  it('stores and reads a tenant-scoped configuration, then returns JST candidates', async () => {
    const scope = await setupScope()
    const input = settings()
    const save = await putSettings(scope, input)
    expect(save.status).toBe(201)
    const saved = (await save.json()) as { version: number; storeId: string }
    expect(saved).toMatchObject({ version: 1, storeId: scope.storeId })

    const read = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/settings`,
      auth(scope.token),
    )
    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toMatchObject({
      version: 1,
      storeId: scope.storeId,
      receptionStatus: 'open',
    })

    const purposeId = (input.purposes as Array<{ id: string }>)[0]?.id
    const slots = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/slots?date=2026-08-31&purposeIds=${purposeId}`,
      auth(scope.token),
    )
    expect(slots.status).toBe(200)
    const body = (await slots.json()) as {
      timezone: string
      slots: Array<{ startTime: string; endTime: string; startAt: string }>
    }
    expect(body.timezone).toBe('Asia/Tokyo')
    expect(body.slots[0]).toMatchObject({
      startTime: '10:00',
      endTime: '11:00',
      startAt: '2026-08-31T01:00:00.000Z',
    })
    expect(body.slots.map((slot) => slot.startTime)).not.toContain('13:00')
  })

  it('returns 409 for a stale settings version and preserves the current configuration', async () => {
    const scope = await setupScope()
    const input = settings()
    expect((await putSettings(scope, input)).status).toBe(201)
    const stale = await putSettings(scope, { ...input, version: 0, receptionStatus: 'paused' })
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toMatchObject({
      error: 'version_conflict',
      expectedVersion: 0,
      currentVersion: 1,
    })
    const read = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/settings`,
      auth(scope.token),
    )
    await expect(read.json()).resolves.toMatchObject({ version: 1, receptionStatus: 'open' })
  })

  it('honors reception stop, closed days, equipment maintenance, and capacity competition', async () => {
    const scope = await setupScope()
    const input = settings()
    const purposeId = (input.purposes as Array<{ id: string }>)[0]?.id as string
    const equipmentId = (input.equipment as Array<{ id: string }>)[0]?.id as string
    expect((await putSettings(scope, input)).status).toBe(201)

    await env.DB.prepare(
      `INSERT INTO availability_bookings
        (id, organization_id, store_id, start_at, end_at, purpose_ids_json, staff_id, equipment_ids_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        uuid(),
        scope.organizationId,
        scope.storeId,
        '2026-08-31T01:00:00.000Z',
        '2026-08-31T02:00:00.000Z',
        JSON.stringify([purposeId]),
        (input.staff as Array<{ id: string }>)[0]?.id,
        JSON.stringify([equipmentId]),
        'confirmed',
      )
      .run()
    await env.DB.prepare(
      `INSERT INTO availability_maintenances
        (id, organization_id, store_id, equipment_id, date, start_time, end_time, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        uuid(),
        scope.organizationId,
        scope.storeId,
        equipmentId,
        '2026-08-31',
        '16:00',
        '17:00',
        '点検',
      )
      .run()

    const slots = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/slots?date=2026-08-31&purposeIds=${purposeId}`,
      auth(scope.token),
    )
    const body = (await slots.json()) as { slots: Array<{ startTime: string }> }
    expect(body.slots.map((slot) => slot.startTime)).not.toContain('10:00')
    expect(body.slots.map((slot) => slot.startTime)).not.toContain('15:30')
    expect(body.slots.map((slot) => slot.startTime)).toContain('11:00')

    const paused = await putSettings(scope, { ...input, version: 1, receptionStatus: 'paused' })
    expect(paused.status).toBe(201)
    const stopped = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/slots?date=2026-08-31&purposeIds=${purposeId}`,
      auth(scope.token),
    )
    await expect(stopped.json()).resolves.toMatchObject({ slots: [] })
  })

  it('does not allow a staff member or another tenant to read or change settings without scope', async () => {
    const manager = await setupScope()
    const readOnly = await setupScope(['settings.read'])
    const otherTenant = await setupScope(['settings.read', 'settings.manage'])
    const input = settings()
    expect((await putSettings(manager, input)).status).toBe(201)

    const read = await SELF.fetch(
      `${BASE}/api/staff/stores/${manager.storeId}/availability/settings`,
      auth(readOnly.token),
    )
    expect(read.status).toBe(403)
    const crossRead = await SELF.fetch(
      `${BASE}/api/staff/stores/${manager.storeId}/availability/settings`,
      auth(otherTenant.token),
    )
    expect(crossRead.status).toBe(403)
    const crossWrite = await putSettingsAt(otherTenant.token, manager.storeId, input)
    expect(crossWrite.status).toBe(403)
  })

  it('rejects invalid dates and body scope spoofing before persisting anything', async () => {
    const scope = await setupScope()
    const input = settings()
    const invalid = await putSettings(scope, {
      ...input,
      organizationId: scope.organizationId,
      shifts: [{ ...(input.shifts as Array<Record<string, unknown>>)[0], date: '2026-02-30' }],
    })
    expect(invalid.status).toBe(400)
    const get = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/settings`,
      auth(scope.token),
    )
    await expect(get.json()).resolves.toMatchObject({ version: 0 })
  })

  it('allows an intentionally empty draft configuration and rejects an unknown purpose query', async () => {
    const scope = await setupScope()
    const empty = settings({
      businessHours: [],
      exceptions: [],
      purposes: [],
      staff: [],
      shifts: [],
      equipment: [],
      maintenance: [],
    })
    expect((await putSettings(scope, empty)).status).toBe(201)

    const unavailable = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/slots?date=2026-08-31&purposeIds=${uuid()}`,
      auth(scope.token),
    )
    expect(unavailable.status).toBe(400)
    await expect(unavailable.json()).resolves.toEqual({ error: 'invalid_purpose_selection' })
  })
})
