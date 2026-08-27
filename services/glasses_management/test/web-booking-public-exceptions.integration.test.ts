import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const INTERNAL = { 'content-type': 'application/json', 'x-internal-key': 'dev-internal-key' }
const uuid = () => crypto.randomUUID()

/**
 * A published store whose only bookable window is 10:00-12:00 JST on 2026-08-31,
 * i.e. immediately after the injected TEST_CLOCK_NOW. Every exception below is
 * driven through the real public HTTP surface of that store.
 */
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
      name: '例外組織',
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
      name: '例外店舗',
      slug: `exception-${uuid().slice(0, 8)}`,
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
      permissions: ['settings.manage', 'reservation.write'],
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
    businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '12:00' }] }],
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
      { id: uuid(), staffId, date: '2026-08-31', startTime: '10:00', endTime: '12:00', breaks: [] },
    ],
    equipment: [
      {
        id: equipmentId,
        name: 'machine',
        capacity: 1,
        isActive: true,
        availablePeriods: [{ startTime: '10:00', endTime: '12:00' }],
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
  const slug = `exception-booking-${uuid().slice(0, 8)}`
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
  return { organizationId, storeId, slug, purposeId, token }
}

type Scope = Awaited<ReturnType<typeof publishedScope>>

function bookingBody(
  scope: Scope,
  overrides: { startTime?: string; email?: string; name?: string; phone?: string } = {},
) {
  return {
    date: '2026-08-31',
    startTime: overrides.startTime ?? '10:00',
    purposeIds: [scope.purposeId],
    customer: {
      name: overrides.name ?? '例外 花子',
      kana: 'レイガイ ハナコ',
      phone: overrides.phone ?? '09012345678',
      email: overrides.email ?? 'exception@example.test',
    },
    consentVersion: 'consent-v1',
  }
}

function book(scope: Scope, idempotencyKey: string | null, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (idempotencyKey !== null) headers['idempotency-key'] = idempotencyKey
  return SELF.fetch(`${BASE}/api/public/stores/${scope.slug}/reservations`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

async function reserve(scope: Scope, key = `exception-${uuid()}`, startTime = '10:00') {
  const response = await book(scope, key, bookingBody(scope, { startTime }))
  expect(response.status).toBe(201)
  return response.json() as Promise<{ reservationNumber: string; managementCode: string }>
}

async function verify(reservation: { reservationNumber: string; managementCode: string }) {
  const response = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      reservationNumber: reservation.reservationNumber,
      managementCode: reservation.managementCode,
    }),
  })
  expect(response.status).toBe(201)
  return response.json() as Promise<{ reservationId: string; verificationToken: string }>
}

const verifiedHeaders = (token: string, idempotencyKey: string | null) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-reservation-verification-token': token,
  }
  if (idempotencyKey !== null) headers['idempotency-key'] = idempotencyKey
  return headers
}

describe('public booking request preconditions', () => {
  it.each([
    ['a missing idempotency key', null],
    [
      'an oversized idempotency key that could not be stored as a confirmation key',
      'x'.repeat(257),
    ],
  ])(
    'refuses to confirm a public reservation with %s, because retries could not be deduplicated',
    async (_case, key) => {
      const scope = await publishedScope()

      const response = await book(scope, key, bookingBody(scope))

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'idempotency_key_required' })
      const stored = await env.DB.prepare(
        'SELECT count(*) AS count FROM reservations WHERE organization_id = ?',
      )
        .bind(scope.organizationId)
        .first<{ count: number }>()
      expect(stored?.count).toBe(0)
    },
  )

  it('rejects a phone number that normalizes below seven digits, because the store cannot call back', async () => {
    const scope = await publishedScope()

    // Passes the contract's raw length check but carries only six real digits.
    const response = await book(
      scope,
      'short-phone-0001',
      bookingBody(scope, { phone: '03-45-67' }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_customer_phone' })
    const customers = await env.DB.prepare(
      'SELECT count(*) AS count FROM customers WHERE organization_id = ?',
    )
      .bind(scope.organizationId)
      .first<{ count: number }>()
    expect(customers?.count).toBe(0)
  })

  it('reports the slot as unavailable when the requested time is outside published hours', async () => {
    const scope = await publishedScope()

    const response = await book(
      scope,
      'outside-hours-0001',
      bookingBody(scope, { startTime: '15:00' }),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'slot_unavailable' })
  })
})

describe('public booking idempotency replay', () => {
  it('rejects reuse of one idempotency key for a different booking, because the retry is not the same request', async () => {
    const scope = await publishedScope()
    const key = 'reused-key-0001'
    expect((await book(scope, key, bookingBody(scope))).status).toBe(201)

    const different = await book(scope, key, bookingBody(scope, { name: '別人 太郎' }))

    expect(different.status).toBe(409)
    await expect(different.json()).resolves.toEqual({ error: 'idempotency_conflict' })
    const reservations = await env.DB.prepare(
      'SELECT count(*) AS count FROM reservations WHERE organization_id = ?',
    )
      .bind(scope.organizationId)
      .first<{ count: number }>()
    expect(reservations?.count).toBe(1)
  })

  it('refuses a retry while another request still owns the same booking claim', async () => {
    const scope = await publishedScope()
    const key = 'in-progress-key-0001'
    expect((await book(scope, key, bookingBody(scope))).status).toBe(201)
    // Simulate a concurrent request that has claimed the key but not completed.
    await env.DB.prepare(
      "UPDATE idempotency_records SET status = 'in_progress', result_json = NULL WHERE organization_id = ? AND operation = ?",
    )
      .bind(scope.organizationId, `public_reservation_create:${scope.storeId}`)
      .run()

    const retry = await book(scope, key, bookingBody(scope))

    expect(retry.status).toBe(409)
    await expect(retry.json()).resolves.toEqual({ error: 'idempotency_in_progress' })
  })

  it('replays the stored booking without the code and reports the last known delivery outcome', async () => {
    const scope = await publishedScope()
    const key = 'replay-delivery-0001'
    const first = await book(
      scope,
      key,
      bookingBody(scope, { email: 'notify-failed@example.test' }),
    )
    expect(first.status).toBe(201)
    const issued = await first.json<{ reservationNumber: string; managementCode: string }>()

    const replay = await book(
      scope,
      key,
      bookingBody(scope, { email: 'notify-failed@example.test' }),
    )

    expect(replay.status).toBe(201)
    // The code is issued exactly once; a retry must only re-state the outcome.
    await expect(replay.json()).resolves.toEqual({
      reservationNumber: issued.reservationNumber,
      managementCode: null,
      emailStatus: 'failed',
    })
  })

  it('falls back to a pending delivery state on replay when no attempt evidence survives', async () => {
    const scope = await publishedScope()
    const key = 'replay-no-evidence-0001'
    expect((await book(scope, key, bookingBody(scope))).status).toBe(201)
    await env.DB.prepare('DELETE FROM web_booking_notification_attempts WHERE organization_id = ?')
      .bind(scope.organizationId)
      .run()

    const replay = await book(scope, key, bookingBody(scope))

    expect(replay.status).toBe(201)
    await expect(replay.json()).resolves.toMatchObject({
      managementCode: null,
      emailStatus: 'pending',
    })
  })
})

describe('public reservation status lookup', () => {
  it('returns not_found for an unknown confirmation key instead of leaking existence', async () => {
    const response = await SELF.fetch(
      `${BASE}/api/public/reservations/status?confirmationKey=never-issued-0001`,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'not_found' })
  })

  it('reports a non-confirmed reservation as pending without disclosing that it was cancelled', async () => {
    const scope = await publishedScope()
    const key = 'status-pending-0001'
    const reservation = await reserve(scope, key)
    const access = await verify(reservation)
    expect(
      (
        await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}/cancel`, {
          method: 'POST',
          headers: verifiedHeaders(access.verificationToken, 'status-pending-cancel-0001'),
          body: JSON.stringify({ version: 1 }),
        })
      ).status,
    ).toBe(200)

    const status = await SELF.fetch(`${BASE}/api/public/reservations/status?confirmationKey=${key}`)

    await expect(status.json()).resolves.toEqual({ status: 'pending' })
  })
})

describe('public management-code verification disclosure', () => {
  it('returns only reservation-scoped non-PII fields on a successful verification', async () => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)

    const response = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })

    expect(response.status).toBe(201)
    const body = await response.json<Record<string, unknown>>()
    // The verified session must be usable without ever echoing customer data.
    expect(Object.keys(body).sort()).toEqual([
      'expiresAt',
      'purposeIds',
      'reservationId',
      'startAt',
      'storeSlug',
      'verificationToken',
      'version',
    ])
    expect(JSON.stringify(body)).not.toContain('例外 花子')
    expect(JSON.stringify(body)).not.toContain('09012345678')
    expect(JSON.stringify(body)).not.toContain('exception@example.test')
    expect(body).toMatchObject({ version: 1, storeSlug: scope.slug })
  })
})

describe('public cancellation exceptions', () => {
  it('requires an idempotency key even from an already verified caller', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))

    const response = await SELF.fetch(
      `${BASE}/api/public/reservations/${access.reservationId}/cancel`,
      {
        method: 'POST',
        headers: verifiedHeaders(access.verificationToken, null),
        body: JSON.stringify({ version: 1 }),
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'idempotency_key_required' })
  })

  it('reports the current version when the caller cancels against a stale one', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))

    const response = await SELF.fetch(
      `${BASE}/api/public/reservations/${access.reservationId}/cancel`,
      {
        method: 'POST',
        headers: verifiedHeaders(access.verificationToken, 'stale-cancel-0001'),
        body: JSON.stringify({ version: 2 }),
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'version_conflict', currentVersion: 1 })
    // A rejected attempt must not keep its claim, so a corrected retry can proceed.
    const claims = await env.DB.prepare(
      'SELECT count(*) AS count FROM idempotency_records WHERE organization_id = ? AND operation = ?',
    )
      .bind(scope.organizationId, `public_reservation_cancel:${scope.storeId}`)
      .first<{ count: number }>()
    expect(claims?.count).toBe(0)
  })

  it('refuses to cancel a reservation that is no longer confirmed', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))
    expect(
      (
        await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}/cancel`, {
          method: 'POST',
          headers: verifiedHeaders(access.verificationToken, 'first-cancel-0001'),
          body: JSON.stringify({ version: 1 }),
        })
      ).status,
    ).toBe(200)

    const again = await SELF.fetch(
      `${BASE}/api/public/reservations/${access.reservationId}/cancel`,
      {
        method: 'POST',
        headers: verifiedHeaders(access.verificationToken, 'second-cancel-0001'),
        body: JSON.stringify({ version: 2 }),
      },
    )

    expect(again.status).toBe(409)
    await expect(again.json()).resolves.toEqual({
      error: 'invalid_cancellation_transition',
      currentStatus: 'cancelled',
    })
  })

  it('rejects a cancellation key reused for a different cancellation request', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))
    const key = 'cancel-key-reuse-0001'
    expect(
      (
        await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}/cancel`, {
          method: 'POST',
          headers: verifiedHeaders(access.verificationToken, key),
          body: JSON.stringify({ version: 1 }),
        })
      ).status,
    ).toBe(200)

    const different = await SELF.fetch(
      `${BASE}/api/public/reservations/${access.reservationId}/cancel`,
      {
        method: 'POST',
        headers: verifiedHeaders(access.verificationToken, key),
        body: JSON.stringify({ version: 2 }),
      },
    )

    expect(different.status).toBe(409)
    await expect(different.json()).resolves.toEqual({ error: 'idempotency_conflict' })
  })

  it('refuses a cancellation retry while another request still owns the claim', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))
    const key = 'cancel-in-progress-0001'
    const body = JSON.stringify({ version: 1 })
    expect(
      (
        await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}/cancel`, {
          method: 'POST',
          headers: verifiedHeaders(access.verificationToken, key),
          body,
        })
      ).status,
    ).toBe(200)
    await env.DB.prepare(
      "UPDATE idempotency_records SET status = 'in_progress', result_json = NULL WHERE organization_id = ? AND operation = ?",
    )
      .bind(scope.organizationId, `public_reservation_cancel:${scope.storeId}`)
      .run()

    const retry = await SELF.fetch(
      `${BASE}/api/public/reservations/${access.reservationId}/cancel`,
      { method: 'POST', headers: verifiedHeaders(access.verificationToken, key), body },
    )

    expect(retry.status).toBe(409)
    await expect(retry.json()).resolves.toEqual({ error: 'idempotency_in_progress' })
  })
})

describe('public change exceptions', () => {
  const changeBody = (scope: Scope, version: number, startTime = '11:00') =>
    JSON.stringify({ version, date: '2026-08-31', startTime, purposeIds: [scope.purposeId] })

  it('requires an idempotency key before applying a change', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))

    const response = await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}`, {
      method: 'PATCH',
      headers: verifiedHeaders(access.verificationToken, null),
      body: changeBody(scope, 1),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'idempotency_key_required' })
  })

  it('reports the current version when a change targets a stale one', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))

    const response = await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}`, {
      method: 'PATCH',
      headers: verifiedHeaders(access.verificationToken, 'stale-change-0001'),
      body: changeBody(scope, 3),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'version_conflict', currentVersion: 1 })
  })

  it('refuses to change a reservation that is no longer confirmed', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))
    expect(
      (
        await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}/cancel`, {
          method: 'POST',
          headers: verifiedHeaders(access.verificationToken, 'cancel-before-change-0001'),
          body: JSON.stringify({ version: 1 }),
        })
      ).status,
    ).toBe(200)

    const response = await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}`, {
      method: 'PATCH',
      headers: verifiedHeaders(access.verificationToken, 'change-after-cancel-0001'),
      body: changeBody(scope, 2),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_change_transition',
      currentStatus: 'cancelled',
    })
  })

  it('rejects a change once the reservation start time has been reached', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))
    // Move the reservation onto the injected clock instant: the deadline has passed.
    await env.DB.prepare('UPDATE reservations SET start_at = ? WHERE id = ?')
      .bind('2026-08-31T00:00:00.000Z', access.reservationId)
      .run()

    const response = await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}`, {
      method: 'PATCH',
      headers: verifiedHeaders(access.verificationToken, 'late-change-0001'),
      body: changeBody(scope, 1),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'change_deadline_passed' })
  })

  it('reports an unavailable slot when the requested new time is outside published hours', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))

    const response = await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}`, {
      method: 'PATCH',
      headers: verifiedHeaders(access.verificationToken, 'unavailable-change-0001'),
      body: changeBody(scope, 1, '15:00'),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'slot_unavailable' })
    const unchanged = await env.DB.prepare(
      'SELECT version, start_at FROM reservations WHERE id = ?',
    )
      .bind(access.reservationId)
      .first<{ version: number; start_at: string }>()
    expect(unchanged).toEqual({ version: 1, start_at: '2026-08-31T01:00:00.000Z' })
  })

  it('rejects a change key reused for a different change request', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))
    const key = 'change-key-reuse-0001'
    expect(
      (
        await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}`, {
          method: 'PATCH',
          headers: verifiedHeaders(access.verificationToken, key),
          body: changeBody(scope, 1),
        })
      ).status,
    ).toBe(200)

    const different = await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}`, {
      method: 'PATCH',
      headers: verifiedHeaders(access.verificationToken, key),
      body: changeBody(scope, 2, '10:00'),
    })

    expect(different.status).toBe(409)
    await expect(different.json()).resolves.toEqual({ error: 'idempotency_conflict' })
  })

  it('refuses a change retry while another request still owns the claim', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))
    const key = 'change-in-progress-0001'
    expect(
      (
        await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}`, {
          method: 'PATCH',
          headers: verifiedHeaders(access.verificationToken, key),
          body: changeBody(scope, 1),
        })
      ).status,
    ).toBe(200)
    await env.DB.prepare(
      "UPDATE idempotency_records SET status = 'in_progress', result_json = NULL WHERE organization_id = ? AND operation = ?",
    )
      .bind(scope.organizationId, `public_reservation_change:${scope.storeId}`)
      .run()

    const retry = await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}`, {
      method: 'PATCH',
      headers: verifiedHeaders(access.verificationToken, key),
      body: changeBody(scope, 1),
    })

    expect(retry.status).toBe(409)
    await expect(retry.json()).resolves.toEqual({ error: 'idempotency_in_progress' })
  })
})

describe('company management-code reissue exceptions', () => {
  const reissue = (scope: Scope, reservationId: string, key: string | null) => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${scope.token}`,
    }
    if (key !== null) headers['idempotency-key'] = key
    return SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservationId}/management-code/reissue`,
      { method: 'POST', headers, body: JSON.stringify({}) },
    )
  }

  it('reports an unknown reservation as ineligible rather than confirming it exists', async () => {
    const scope = await publishedScope()

    const response = await reissue(scope, uuid(), 'unknown-reissue-0001')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'reservation_not_eligible_for_management_code_reissue',
    })
  })

  it('refuses to reissue for a web reservation that has no email destination', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))
    await env.DB.prepare('UPDATE reservations SET customer_email = NULL WHERE id = ?')
      .bind(access.reservationId)
      .run()

    const response = await reissue(scope, access.reservationId, 'no-email-reissue-0001')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'reservation_not_eligible_for_management_code_reissue',
    })
    const issues = await env.DB.prepare(
      'SELECT count(*) AS count FROM web_booking_management_code_issues WHERE reservation_id = ?',
    )
      .bind(access.reservationId)
      .first<{ count: number }>()
    expect(issues?.count).toBe(1)
  })

  it('requires an idempotency key so a retried reissue cannot mint a second code', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))

    const response = await reissue(scope, access.reservationId, null)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'idempotency_key_required' })
  })

  it('rejects a reissue key reused for a different reservation', async () => {
    const scope = await publishedScope()
    const first = await verify(await reserve(scope, `reissue-a-${uuid()}`, '10:00'))
    const second = await verify(await reserve(scope, `reissue-b-${uuid()}`, '11:00'))
    const key = 'reissue-key-reuse-0001'
    expect((await reissue(scope, first.reservationId, key)).status).toBe(201)

    const different = await reissue(scope, second.reservationId, key)

    expect(different.status).toBe(409)
    await expect(different.json()).resolves.toEqual({ error: 'idempotency_conflict' })
    const secondIssues = await env.DB.prepare(
      'SELECT count(*) AS count FROM web_booking_management_code_issues WHERE reservation_id = ?',
    )
      .bind(second.reservationId)
      .first<{ count: number }>()
    expect(secondIssues?.count).toBe(1)
  })

  it('refuses a reissue retry while another request still owns the claim', async () => {
    const scope = await publishedScope()
    const access = await verify(await reserve(scope))
    const key = 'reissue-in-progress-0001'
    expect((await reissue(scope, access.reservationId, key)).status).toBe(201)
    await env.DB.prepare(
      "UPDATE idempotency_records SET status = 'in_progress', result_json = NULL WHERE organization_id = ? AND operation = ?",
    )
      .bind(scope.organizationId, `management_code_reissue:${scope.storeId}`)
      .run()

    const retry = await reissue(scope, access.reservationId, key)

    expect(retry.status).toBe(409)
    await expect(retry.json()).resolves.toEqual({ error: 'idempotency_in_progress' })
  })
})
