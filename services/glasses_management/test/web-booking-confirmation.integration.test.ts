import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const INTERNAL = { 'content-type': 'application/json', 'x-internal-key': 'dev-internal-key' }
const uuid = () => crypto.randomUUID()

async function publicScope() {
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
      name: 'Web booking org',
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
      name: 'Web booking store',
      slug: `web-${uuid().slice(0, 8)}`,
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
        staffName: '視力測定',
        customerLabel: '新調相談',
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
  const saved = await SELF.fetch(`${BASE}/api/staff/stores/${storeId}/availability/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(settings),
  })
  expect(saved.status).toBe(201)
  const slug = `web-booking-${uuid().slice(0, 8)}`
  await env.DB.prepare(
    `INSERT INTO web_booking_publications (id, organization_id, store_id, public_slug, status, starts_at, ends_at, contact_phone, access_text, notice, region, nearest_station, latitude, longitude, public_purpose_ids_json, version, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

describe('public booking availability', () => {
  it('returns only published-purpose slots from the resolved public store', async () => {
    const scope = await publicScope()
    const response = await SELF.fetch(
      `${BASE}/api/public/stores/${scope.slug}/slots?date=2026-08-31&purposeIds=${scope.purposeId}`,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      timezone: 'Asia/Tokyo',
      slots: [{ startTime: '10:00', endTime: '11:00' }],
    })
  })

  it('creates one web reservation with consent evidence and returns the issued code only once', async () => {
    const scope = await publicScope()
    const request = {
      date: '2026-08-31',
      startTime: '10:00',
      purposeIds: [scope.purposeId],
      customer: {
        name: '公開 花子',
        kana: 'コウカイ ハナコ',
        phone: '090-1111-2222',
        email: 'hanako@example.test',
      },
      consentVersion: 'web-consent-2026-08',
    }
    const reserve = () =>
      SELF.fetch(`${BASE}/api/public/stores/${scope.slug}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'public-confirmation-1' },
        body: JSON.stringify(request),
      })

    const first = await reserve()
    expect(first.status).toBe(201)
    const issued = await first.json<{
      reservationNumber: string
      managementCode: string
      emailStatus: string
    }>()
    expect(issued).toMatchObject({ emailStatus: 'sent' })
    expect(issued.managementCode).toHaveLength(12)

    const retry = await reserve()
    expect(retry.status).toBe(201)
    await expect(retry.json()).resolves.toEqual({ ...issued, managementCode: null })
    const records = await env.DB.prepare(
      'SELECT management_code_hash, confirmation_key_hash, consent_version, input_history_json FROM web_booking_records WHERE organization_id = ? AND store_id = ?',
    )
      .bind(scope.organizationId, scope.storeId)
      .all<{
        management_code_hash: string
        confirmation_key_hash: string
        consent_version: string
        input_history_json: string
      }>()
    expect(records.results).toHaveLength(1)
    expect(records.results[0]).toMatchObject({ consent_version: request.consentVersion })
    expect(records.results[0]?.management_code_hash).not.toBe(issued.managementCode)
    expect(records.results[0]?.confirmation_key_hash).not.toBe('public-confirmation-1')
    expect(records.results[0]?.input_history_json).toContain(request.customer.email)
    const reservations = await env.DB.prepare(
      'SELECT source, reservation_memo FROM reservations WHERE organization_id = ? AND store_id = ?',
    )
      .bind(scope.organizationId, scope.storeId)
      .all<{ source: string; reservation_memo: string | null }>()
    expect(reservations.results).toEqual([{ source: 'web', reservation_memo: null }])
  })

  it('rejects a concurrent confirmation for the same public slot without leaving partial evidence', async () => {
    const scope = await publicScope()
    const body = {
      date: '2026-08-31',
      startTime: '10:00',
      purposeIds: [scope.purposeId],
      customer: {
        name: '競合 花子',
        kana: 'キョウゴウ ハナコ',
        phone: '090-3333-4444',
        email: 'conflict@example.test',
      },
      consentVersion: 'web-consent-2026-08',
    }
    const confirm = (key: string) =>
      SELF.fetch(`${BASE}/api/public/stores/${scope.slug}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify(body),
      })
    const responses = await Promise.all([confirm('public-race-a'), confirm('public-race-b')])

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    const evidence = await env.DB.prepare(
      'SELECT reservation_id FROM web_booking_records WHERE organization_id = ? AND store_id = ?',
    )
      .bind(scope.organizationId, scope.storeId)
      .all()
    expect(evidence.results).toHaveLength(1)
  })

  it('derives the tenant and store from the public slug and rejects a foreign purpose or spoofed scope', async () => {
    const selected = await publicScope()
    const foreign = await publicScope()
    const response = await SELF.fetch(`${BASE}/api/public/stores/${selected.slug}/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'public-foreign-scope' },
      body: JSON.stringify({
        date: '2026-08-31',
        startTime: '10:00',
        purposeIds: [foreign.purposeId],
        customer: {
          name: '越境 花子',
          kana: 'エッキョウ ハナコ',
          phone: '090-5555-6666',
          email: 'isolation@example.test',
        },
        consentVersion: 'web-consent-2026-08',
        organizationId: foreign.organizationId,
        storeId: foreign.storeId,
      }),
    })

    expect(response.status).toBe(400)
    const selectedCount = await env.DB.prepare(
      'SELECT count(*) AS count FROM reservations WHERE organization_id = ? AND store_id = ?',
    )
      .bind(selected.organizationId, selected.storeId)
      .first<{ count: number }>()
    const foreignCount = await env.DB.prepare(
      'SELECT count(*) AS count FROM reservations WHERE organization_id = ? AND store_id = ?',
    )
      .bind(foreign.organizationId, foreign.storeId)
      .first<{ count: number }>()
    expect(selectedCount?.count).toBe(0)
    expect(foreignCount?.count).toBe(0)
  })
})
