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
      name: 'Settings exception organization',
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
      name: 'Settings exception store',
      slug: `settings-exception-${uuid().slice(0, 8)}`,
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

function purpose(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    staffName: '視力測定',
    customerLabel: 'メガネを新しく作りたい',
    durationMinutes: 60,
    slotIntervalMinutes: 30,
    isPublic: true,
    requiredSkills: ['眼鏡作製技能'],
    requiredEquipment: ['視力測定機'],
    maxConcurrent: 1,
    ...overrides,
  }
}

function staffMember(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    name: '担当者',
    skills: ['眼鏡作製技能'],
    canBook: true,
    isActive: true,
    ...overrides,
  }
}

function equipmentItem(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    name: '視力測定機',
    capacity: 1,
    isActive: true,
    availablePeriods: [{ startTime: '10:00', endTime: '19:00' }],
    ...overrides,
  }
}

function settings(overrides: Record<string, unknown> = {}) {
  const basePurpose = purpose()
  const baseStaff = staffMember()
  const baseEquipment = equipmentItem()
  return {
    version: 0,
    receptionStatus: 'open',
    businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
    exceptions: [],
    purposes: [basePurpose],
    staff: [baseStaff],
    shifts: [
      {
        id: uuid(),
        staffId: baseStaff.id,
        date: '2026-08-31',
        startTime: '10:00',
        endTime: '19:00',
        breaks: [],
      },
    ],
    equipment: [baseEquipment],
    maintenance: [],
    ...overrides,
  }
}

async function putSettings(scope: Scope, input: Record<string, unknown>) {
  return SELF.fetch(`${BASE}/api/staff/stores/${scope.storeId}/availability/settings`, {
    ...auth(scope.token, { method: 'PUT', body: JSON.stringify(input) }),
  })
}

async function readSettings(scope: Scope) {
  return SELF.fetch(
    `${BASE}/api/staff/stores/${scope.storeId}/availability/settings`,
    auth(scope.token),
  )
}

async function insertBooking(scope: Scope, row: Record<string, unknown>) {
  await env.DB.prepare(
    `INSERT INTO availability_bookings
      (id, organization_id, store_id, start_at, end_at, purpose_ids_json, staff_id, equipment_ids_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      uuid(),
      scope.organizationId,
      scope.storeId,
      row.startAt ?? '2026-08-31T01:00:00.000Z',
      row.endAt ?? '2026-08-31T02:00:00.000Z',
      row.purposeIdsJson ?? JSON.stringify([uuid()]),
      null,
      row.equipmentIdsJson ?? JSON.stringify([uuid()]),
      row.status ?? 'confirmed',
    )
    .run()
}

async function readSlots(scope: Scope, purposeId: string) {
  return SELF.fetch(
    `${BASE}/api/staff/stores/${scope.storeId}/availability/slots?date=2026-08-31&purposeIds=${purposeId}`,
    auth(scope.token),
  )
}

// Reference integrity is enforced before anything is written, because a saved
// configuration with duplicate or dangling ids would silently corrupt every
// later slot computation instead of failing loudly at the boundary.
describe('availability settings reference validation', () => {
  const rejections: Array<{ name: string; why: string; build: () => Record<string, unknown> }> = [
    {
      name: 'duplicate purpose ids',
      why: 'purpose ids key the booking snapshot, so a duplicate makes a reservation ambiguous',
      build: () => {
        const duplicated = purpose()
        return settings({ purposes: [duplicated, { ...purpose(), id: duplicated.id }] })
      },
    },
    {
      name: 'duplicate staff ids',
      why: 'shifts are attached by staff id, so a duplicate would double-book one person',
      build: () => {
        const base = settings()
        const first = (base.staff as Array<{ id: string }>)[0] as Record<string, unknown>
        return { ...base, staff: [first, { ...staffMember(), id: first.id }] }
      },
    },
    {
      name: 'duplicate equipment ids',
      why: 'equipment capacity is summed per id, so a duplicate would inflate real capacity',
      build: () => {
        const base = settings()
        const first = (base.equipment as Array<{ id: string }>)[0] as Record<string, unknown>
        return { ...base, equipment: [first, { ...equipmentItem(), id: first.id }] }
      },
    },
    {
      name: 'duplicate business hours day',
      why: 'one weekday must resolve to exactly one opening pattern',
      build: () =>
        settings({
          businessHours: [
            { dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] },
            { dayOfWeek: 1, periods: [{ startTime: '11:00', endTime: '18:00' }] },
          ],
        }),
    },
    {
      name: 'duplicate exception date',
      why: 'a calendar date must resolve to exactly one exception mode',
      build: () =>
        settings({
          exceptions: [
            { date: '2026-09-01', mode: 'closed', periods: [] },
            { date: '2026-09-01', mode: 'paused', periods: [] },
          ],
        }),
    },
    {
      name: 'shift referencing an unknown staff member',
      why: 'a shift for a non-existent staff member can never be honoured at booking time',
      build: () =>
        settings({
          shifts: [
            {
              id: uuid(),
              staffId: uuid(),
              date: '2026-08-31',
              startTime: '10:00',
              endTime: '19:00',
              breaks: [],
            },
          ],
        }),
    },
    {
      name: 'maintenance referencing unknown equipment',
      why: 'maintenance blocks capacity, so a dangling reference would block nothing at all',
      build: () =>
        settings({
          maintenance: [
            {
              id: uuid(),
              equipmentId: uuid(),
              date: '2026-08-31',
              startTime: '16:00',
              endTime: '17:00',
              reason: '点検',
            },
          ],
        }),
    },
  ]

  it.each(rejections)('rejects $name because $why', async ({ build }) => {
    const scope = await setupScope()
    const response = await putSettings(scope, build())
    expect(response.status).toBe(400)
    expect(await response.text()).toMatch(/duplicate|unknown/)

    // A rejected save must leave the store untouched, not half-applied.
    const read = await readSettings(scope)
    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toMatchObject({ version: 0, purposes: [] })
  })
})

describe('availability settings persistence of optional collections', () => {
  it('round-trips exceptions with and without a reason, hidden purposes, blocked staff, inactive equipment and maintenance', async () => {
    const scope = await setupScope()
    const hiddenPurpose = purpose({ isPublic: false, customerLabel: '社内調整' })
    const blockedStaff = staffMember({ name: '見習い', canBook: false, isActive: false })
    const retiredEquipment = equipmentItem({ name: '旧測定機', isActive: false })
    const input = settings({
      exceptions: [
        { date: '2026-09-01', mode: 'closed', periods: [], reason: '棚卸し' },
        // No reason at all: the column is nullable and must read back as absent,
        // never as an empty string, or the contract parse would drift.
        { date: '2026-09-02', mode: 'open', periods: [{ startTime: '12:00', endTime: '15:00' }] },
      ],
      purposes: [hiddenPurpose],
      staff: [blockedStaff],
      shifts: [],
      equipment: [retiredEquipment],
      maintenance: [
        {
          id: uuid(),
          equipmentId: retiredEquipment.id,
          date: '2026-08-31',
          startTime: '16:00',
          endTime: '17:00',
          reason: '定期点検',
        },
      ],
    })

    const save = await putSettings(scope, input)
    expect(save.status).toBe(201)

    const read = await readSettings(scope)
    expect(read.status).toBe(200)
    const body = (await read.json()) as {
      version: number
      exceptions: Array<Record<string, unknown>>
      purposes: Array<Record<string, unknown>>
      staff: Array<Record<string, unknown>>
      equipment: Array<Record<string, unknown>>
      maintenance: Array<Record<string, unknown>>
    }
    expect(body.version).toBe(1)
    expect(
      [...body.exceptions].sort((a, b) => String(a.date).localeCompare(String(b.date))),
    ).toEqual([
      { date: '2026-09-01', mode: 'closed', periods: [], reason: '棚卸し' },
      { date: '2026-09-02', mode: 'open', periods: [{ startTime: '12:00', endTime: '15:00' }] },
    ])
    expect(body.exceptions.some((exception) => 'reason' in exception === false)).toBe(true)
    expect(body.purposes).toEqual([hiddenPurpose])
    expect(body.staff).toEqual([blockedStaff])
    expect(body.equipment).toEqual([retiredEquipment])
    expect(body.maintenance).toEqual(input.maintenance)
  })
})

// Booking rows are read back into the slot engine. A row that does not match the
// stored contract must fail loudly: silently skipping it would hand a customer a
// slot that is in fact already taken.
describe('availability booking row integrity', () => {
  const corruptRows: Array<{ name: string; why: string; row: Record<string, unknown> }> = [
    {
      name: 'purpose ids that are not a string array',
      why: 'the purpose snapshot drives capacity competition',
      row: { purposeIdsJson: JSON.stringify('not-an-array') },
    },
    {
      name: 'equipment ids that are not a string array',
      why: 'the equipment snapshot drives resource competition',
      row: { equipmentIdsJson: JSON.stringify([42]) },
    },
    {
      name: 'a status outside the booking lifecycle',
      why: 'an unknown status cannot be classified as occupying or freeing a slot',
      row: { status: 'archived' },
    },
  ]

  it.each(corruptRows)('refuses to serve slots for $name because $why', async ({ row }) => {
    const scope = await setupScope()
    const input = settings()
    expect((await putSettings(scope, input)).status).toBe(201)
    const purposeId = (input.purposes as Array<{ id: string }>)[0]?.id as string
    await insertBooking(scope, row)

    const slots = await readSlots(scope, purposeId)
    expect(slots.status).toBe(500)
    await expect(slots.json()).resolves.toEqual({ error: 'internal_error' })
  })

  it('serves slots normally once every booking row matches the contract', async () => {
    const scope = await setupScope()
    const input = settings()
    expect((await putSettings(scope, input)).status).toBe(201)
    const purposeId = (input.purposes as Array<{ id: string }>)[0]?.id as string
    await insertBooking(scope, { status: 'cancelled' })

    const slots = await readSlots(scope, purposeId)
    expect(slots.status).toBe(200)
    const body = (await slots.json()) as { timezone: string; slots: Array<{ startTime: string }> }
    expect(body.timezone).toBe('Asia/Tokyo')
    expect(body.slots.length).toBeGreaterThan(0)
  })
})

describe('domain authentication proxy failure paths', () => {
  it('refuses to refresh without the EYEX cookie so a stolen access token alone cannot be renewed', async () => {
    const response = await SELF.fetch(`${BASE}/api/auth/refresh`, { method: 'POST' })
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'no_session' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('rotates the refresh cookie and returns only the access token on a successful refresh', async () => {
    const response = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { cookie: 'eyex_rt=refresh-token' },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ token: 'refreshed-access-token' })
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('eyex_rt=rotated-refresh-token')
    expect(cookie).toMatch(/HttpOnly/)
    // The rotated refresh credential must never reach the SPA payload itself.
    expect(cookie).toMatch(/SameSite=Strict/)
  })

  it('passes an upstream login rejection through unchanged instead of masking it as a local failure', async () => {
    // The admin service rejects a login whose client IP was not forwarded; the
    // proxy must surface that verdict so rate limiting stays admin-owned.
    const response = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'staff@example.test', stretched: 'client-stretched-proof' }),
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'missing_client_ip' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('prefers cf-connecting-ip over x-forwarded-for when identifying the client for admin', async () => {
    const response = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        'cf-connecting-ip': '203.0.113.44',
        'x-forwarded-for': '198.51.100.7, 203.0.113.44',
      },
      body: JSON.stringify({ email: 'staff@example.test', stretched: 'client-stretched-proof' }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ token: 'access-token' })
  })
})
