import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

const BASE = 'https://glasses-management.test'
const INTERNAL = { 'content-type': 'application/json', 'x-internal-key': 'dev-internal-key' }
const uuid = () => crypto.randomUUID()

async function publishedScope() {
  const organizationId = uuid()
  const storeId = uuid()
  const userId = uuid()
  const purposeId = uuid()
  const staffId = uuid()
  const equipmentId = uuid()
  await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: organizationId,
      name: '通知組織',
      plan: 'free',
      isDisabled: false,
      createdAt: '2026-08-27T00:00:00.000Z',
    }),
  })
  await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: storeId,
      organizationId,
      name: '通知店舗',
      slug: `notify-${uuid().slice(0, 8)}`,
      isActive: true,
      createdAt: '2026-08-27T00:00:00.000Z',
    }),
  })
  await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: uuid(),
      organizationId,
      storeId,
      userId,
      permissions: ['settings.manage'],
      createdAt: '2026-08-27T00:00:00.000Z',
    }),
  })
  const token = await signAccessToken(
    { sub: userId, org: organizationId, email: 'staff@example.test', role: 'staff' },
    'dev-jwt-secret-change-me',
  )
  const settings = {
    version: 0,
    receptionStatus: 'open',
    businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '11:00' }] }],
    exceptions: [],
    purposes: [
      {
        id: purposeId,
        staffName: '検査',
        customerLabel: '相談',
        durationMinutes: 60,
        slotIntervalMinutes: 30,
        isPublic: true,
        requiredSkills: ['skill'],
        requiredEquipment: ['machine'],
        maxConcurrent: 1,
      },
    ],
    staff: [{ id: staffId, name: '担当', skills: ['skill'], canBook: true, isActive: true }],
    shifts: [
      { id: uuid(), staffId, date: '2026-08-31', startTime: '10:00', endTime: '11:00', breaks: [] },
    ],
    equipment: [
      {
        id: equipmentId,
        name: 'machine',
        capacity: 1,
        isActive: true,
        availablePeriods: [{ startTime: '10:00', endTime: '11:00' }],
      },
    ],
    maintenance: [],
  }
  expect(
    (
      await SELF.fetch(`${BASE}/api/staff/stores/${storeId}/availability/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(settings),
      })
    ).status,
  ).toBe(201)
  const slug = `notify-booking-${uuid().slice(0, 8)}`
  await env.DB.prepare(
    'INSERT INTO web_booking_publications (id, organization_id, store_id, public_slug, status, starts_at, ends_at, contact_phone, access_text, notice, region, nearest_station, latitude, longitude, public_purpose_ids_json, version, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      uuid(),
      organizationId,
      storeId,
      slug,
      'published',
      null,
      null,
      '03-0000-0000',
      '駅前',
      '',
      '東京都',
      '東京駅',
      null,
      null,
      JSON.stringify([purposeId]),
      1,
      '2026-08-27T00:00:00.000Z',
      '2026-08-27T00:00:00.000Z',
    )
    .run()
  return { organizationId, storeId, slug, purposeId }
}

async function reserve(
  scope: Awaited<ReturnType<typeof publishedScope>>,
  key: string,
  email = 'notify@example.test',
) {
  return SELF.fetch(`${BASE}/api/public/stores/${scope.slug}/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({
      date: '2026-08-31',
      startTime: '10:00',
      purposeIds: [scope.purposeId],
      customer: {
        name: '通知 花子',
        kana: 'ツウチ ハナコ',
        phone: `090${key.slice(-8).padStart(8, '0')}`,
        email,
      },
      consentVersion: 'consent-v1',
    }),
  })
}

afterEach(() => vi.restoreAllMocks())

describe('public booking notification', () => {
  it('persists a sent confirmation attempt after a confirmed reservation', async () => {
    const scope = await publishedScope()
    const notifier = vi.spyOn(env.NOTIFIER, 'fetch')

    const response = await reserve(scope, 'notify-success-0001')

    expect(response.status).toBe(201)
    expect(notifier).toHaveBeenCalledTimes(2)
    await expect(response.json()).resolves.toMatchObject({ emailStatus: 'sent' })
    const attempts = await env.DB.prepare(
      'SELECT notification_type, status FROM web_booking_notification_attempts WHERE organization_id = ? AND store_id = ? ORDER BY notification_type, status',
    )
      .bind(scope.organizationId, scope.storeId)
      .all<{ notification_type: string; status: string }>()
    expect(attempts.results).toEqual([
      { notification_type: 'reservation.confirmed', status: 'pending' },
      { notification_type: 'reservation.confirmed', status: 'sent' },
      { notification_type: 'reservation.management_code_issued', status: 'pending' },
      { notification_type: 'reservation.management_code_issued', status: 'sent' },
    ])
  })

  it('keeps the reservation confirmed and records failed email delivery on notifier 502', async () => {
    const scope = await publishedScope()
    const response = await reserve(scope, 'notify-failed-0002', 'notify-failed@example.test')

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ emailStatus: 'failed' })
    const rows = await env.DB.prepare(
      'SELECT r.status AS reservation_status, n.notification_type, n.status AS notification_status FROM reservations r INNER JOIN web_booking_notification_attempts n ON n.reservation_id = r.id WHERE r.organization_id = ? AND r.store_id = ? ORDER BY n.notification_type, n.status',
    )
      .bind(scope.organizationId, scope.storeId)
      .all<{ reservation_status: string; notification_type: string; notification_status: string }>()
    expect(rows.results).toEqual([
      {
        reservation_status: 'confirmed',
        notification_type: 'reservation.confirmed',
        notification_status: 'failed',
      },
      {
        reservation_status: 'confirmed',
        notification_type: 'reservation.confirmed',
        notification_status: 'pending',
      },
      {
        reservation_status: 'confirmed',
        notification_type: 'reservation.management_code_issued',
        notification_status: 'failed',
      },
      {
        reservation_status: 'confirmed',
        notification_type: 'reservation.management_code_issued',
        notification_status: 'pending',
      },
    ])
  })

  it('treats notifier idempotent duplicate as a delivered confirmation', async () => {
    const scope = await publishedScope()

    const response = await reserve(scope, 'notify-duplicate-0003', 'notify-duplicate@example.test')

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ emailStatus: 'sent' })
  })

  it('returns only the confirmed state when a caller checks the original confirmation key', async () => {
    const scope = await publishedScope()
    const key = 'notify-status-0004'
    expect((await reserve(scope, key)).status).toBe(201)

    const status = await SELF.fetch(`${BASE}/api/public/reservations/status?confirmationKey=${key}`)

    expect(status.status).toBe(200)
    await expect(status.json()).resolves.toEqual({ status: 'confirmed' })
  })

  it('prevents one confirmation key from becoming ambiguous across public stores', async () => {
    const first = await publishedScope()
    const second = await publishedScope()
    const key = 'globally-unique-confirmation-0001'
    expect((await reserve(first, key)).status).toBe(201)

    const collision = await reserve(second, key)
    const status = await SELF.fetch(`${BASE}/api/public/reservations/status?confirmationKey=${key}`)

    expect(collision.status).toBe(409)
    await expect(status.json()).resolves.toEqual({ status: 'confirmed' })
  })
})
