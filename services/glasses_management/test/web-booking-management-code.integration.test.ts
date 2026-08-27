import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it, vi } from 'vitest'

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
      name: '管理コード組織',
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
      name: '管理コード店舗',
      slug: `code-${uuid().slice(0, 8)}`,
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
  const slug = `manage-booking-${uuid().slice(0, 8)}`
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

async function reserve(scope: Awaited<ReturnType<typeof publishedScope>>) {
  const response = await SELF.fetch(`${BASE}/api/public/stores/${scope.slug}/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `manage-${uuid()}` },
    body: JSON.stringify({
      date: '2026-08-31',
      startTime: '10:00',
      purposeIds: [scope.purposeId],
      customer: {
        name: '管理 花子',
        kana: 'カンリ ハナコ',
        phone: '09012345678',
        email: 'manage@example.test',
      },
      consentVersion: 'consent-v1',
    }),
  })
  expect(response.status).toBe(201)
  return response.json() as Promise<{ reservationNumber: string; managementCode: string }>
}

describe('public management-code verification', () => {
  it('does not disclose PII before verification and issues a scoped short-lived session only for the correct code', async () => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)

    const denied = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: 'WRONG-CODE',
      }),
    })
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toEqual({ error: 'invalid_management_code' })

    const verified = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })
    expect(verified.status).toBe(201)
    await expect(verified.json()).resolves.toMatchObject({
      reservationId: expect.any(String),
      verificationToken: expect.any(String),
      version: 1,
      startAt: '2026-08-31T01:00:00.000Z',
      purposeIds: [scope.purposeId],
      storeSlug: scope.slug,
    })
  })

  it('requires the reservation-scoped verification token before allowing a cancellation', async () => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)
    const verified = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })
    const access = (await verified.json()) as { reservationId: string; verificationToken: string }

    const unverified = await SELF.fetch(
      `${BASE}/api/public/reservations/${access.reservationId}/cancel`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1 }),
      },
    )
    expect(unverified.status).toBe(401)
    await expect(unverified.json()).resolves.toEqual({ error: 'verification_required' })

    const cancelHeaders = {
      'content-type': 'application/json',
      'x-reservation-verification-token': access.verificationToken,
      'idempotency-key': 'public-cancel-0001',
    }
    const cancelled = await SELF.fetch(
      `${BASE}/api/public/reservations/${access.reservationId}/cancel`,
      { method: 'POST', headers: cancelHeaders, body: JSON.stringify({ version: 1 }) },
    )
    expect(cancelled.status).toBe(200)
    await expect(cancelled.json()).resolves.toEqual({ status: 'cancelled', version: 2 })

    const replay = await SELF.fetch(
      `${BASE}/api/public/reservations/${access.reservationId}/cancel`,
      { method: 'POST', headers: cancelHeaders, body: JSON.stringify({ version: 1 }) },
    )
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toEqual({ status: 'cancelled', version: 2 })

    const revoked = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })
    expect(revoked.status).toBe(401)
    await expect(revoked.json()).resolves.toEqual({ error: 'management_code_revoked' })
  })

  it('rejects a verified token when its reservation URL is substituted', async () => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)
    const verified = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })
    const access = (await verified.json()) as { verificationToken: string }

    const substituted = await SELF.fetch(`${BASE}/api/public/reservations/${uuid()}/cancel`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-reservation-verification-token': access.verificationToken,
        'idempotency-key': 'substituted-reservation-0001',
      },
      body: JSON.stringify({ version: 1 }),
    })

    expect(substituted.status).toBe(401)
    await expect(substituted.json()).resolves.toEqual({ error: 'verification_scope_mismatch' })
  })

  it('rejects cancellation exactly at the injected reservation-start deadline', async () => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)
    const verified = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })
    const access = (await verified.json()) as { reservationId: string; verificationToken: string }
    await env.DB.prepare('UPDATE reservations SET start_at = ? WHERE id = ?')
      .bind('2026-08-31T00:00:00.000Z', access.reservationId)
      .run()

    const cancelled = await SELF.fetch(
      `${BASE}/api/public/reservations/${access.reservationId}/cancel`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-reservation-verification-token': access.verificationToken,
          'idempotency-key': 'deadline-cancel-0001',
        },
        body: JSON.stringify({ version: 1 }),
      },
    )

    expect(cancelled.status).toBe(409)
    await expect(cancelled.json()).resolves.toEqual({ error: 'cancellation_deadline_passed' })
  })

  it('releases a public change idempotency claim after a proven pre-commit rejection', async () => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)
    const verified = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })
    const access = (await verified.json()) as { reservationId: string; verificationToken: string }
    const headers = {
      'content-type': 'application/json',
      'x-reservation-verification-token': access.verificationToken,
      'idempotency-key': 'rejected-public-change-0001',
    }
    const body = JSON.stringify({
      version: 1,
      date: '2026-08-31',
      startTime: '11:00',
      purposeIds: [uuid()],
    })

    const first = await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}`, {
      method: 'PATCH',
      headers,
      body,
    })
    const retry = await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}`, {
      method: 'PATCH',
      headers,
      body,
    })

    expect(first.status).toBe(400)
    expect(retry.status).toBe(400)
    await expect(retry.json()).resolves.toEqual({ error: 'invalid_public_purpose_selection' })
  })

  it('does not mutate either tenant when a legacy duplicate reservation number makes a wrong-code target ambiguous', async () => {
    const first = await publishedScope()
    const second = await publishedScope()
    const firstReservation = await reserve(first)
    const secondReservation = await reserve(second)
    await env.DB.prepare(
      'UPDATE reservations SET reservation_number = ? WHERE organization_id = ? AND reservation_number = ?',
    )
      .bind(
        firstReservation.reservationNumber,
        second.organizationId,
        secondReservation.reservationNumber,
      )
      .run()

    const response = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: firstReservation.reservationNumber,
        managementCode: 'WRONG-CODE',
      }),
    })
    const attempts = await env.DB.prepare(
      'SELECT failed_attempts FROM web_booking_management_code_issues WHERE organization_id IN (?, ?)',
    )
      .bind(first.organizationId, second.organizationId)
      .all<{ failed_attempts: number }>()

    expect(response.status).toBe(401)
    expect(attempts.results.map((row) => row.failed_attempts)).toEqual([0, 0])
  })

  it('changes a verified web reservation through the same versioned public scope', async () => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)
    const verified = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })
    const access = (await verified.json()) as { reservationId: string; verificationToken: string }

    const changeHeaders = {
      'content-type': 'application/json',
      'x-reservation-verification-token': access.verificationToken,
      'idempotency-key': 'public-change-0001',
    }
    const changeBody = JSON.stringify({
      version: 1,
      date: '2026-08-31',
      startTime: '11:00',
      purposeIds: [scope.purposeId],
    })
    const changed = await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}`, {
      method: 'PATCH',
      headers: changeHeaders,
      body: changeBody,
    })

    expect(changed.status).toBe(200)
    await expect(changed.json()).resolves.toMatchObject({
      status: 'confirmed',
      version: 2,
      purposeIds: [scope.purposeId],
    })

    const replay = await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}`, {
      method: 'PATCH',
      headers: changeHeaders,
      body: changeBody,
    })
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toMatchObject({
      status: 'confirmed',
      version: 2,
      purposeIds: [scope.purposeId],
    })
    const issue = await env.DB.prepare(
      'SELECT expires_at FROM web_booking_management_code_issues WHERE organization_id = ? AND revoked_at IS NULL',
    )
      .bind(scope.organizationId)
      .first<{ expires_at: string }>()
    expect(issue?.expires_at).toBe('2026-08-31T03:00:00.000Z')
  })

  it('locks a code after five incorrect attempts without disclosing reservation information', async () => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)
    for (const attempt of [1, 2, 3, 4, 5]) {
      const response = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reservationNumber: reservation.reservationNumber,
          managementCode: `WRONG-CODE-${attempt}`,
        }),
      })
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({ error: 'invalid_management_code' })
    }
    const locked = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })
    expect(locked.status).toBe(401)
    await expect(locked.json()).resolves.toEqual({
      error: 'management_code_attempt_limit',
      contactPhone: '03-0000-0000',
      reissueRequired: true,
    })
  })

  it('returns only the public store contact when an otherwise correct code has expired', async () => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)
    await env.DB.prepare(
      'UPDATE web_booking_management_code_issues SET expires_at = ? WHERE organization_id = ?',
    )
      .bind('2026-08-01T00:00:00.000Z', scope.organizationId)
      .run()

    const expired = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })

    expect(expired.status).toBe(401)
    await expect(expired.json()).resolves.toEqual({
      error: 'management_code_expired',
      contactPhone: '03-0000-0000',
      reissueRequired: true,
    })
  })

  it('rejects a code exactly at its injected API expiry time', async () => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)
    await env.DB.prepare(
      'UPDATE web_booking_management_code_issues SET expires_at = ? WHERE organization_id = ?',
    )
      .bind('2026-08-31T00:00:00.000Z', scope.organizationId)
      .run()

    const expired = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })

    expect(expired.status).toBe(401)
    await expect(expired.json()).resolves.toMatchObject({ error: 'management_code_expired' })
  })

  it.each([
    ['one millisecond before expiry', '2026-08-30T23:59:59.999Z', 401],
    ['one millisecond after expiry', '2026-08-31T00:00:00.001Z', 201],
  ] as const)('applies API management-code expiry %s', async (_case, expiresAt, expectedStatus) => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)
    await env.DB.prepare(
      'UPDATE web_booking_management_code_issues SET expires_at = ? WHERE organization_id = ?',
    )
      .bind(expiresAt, scope.organizationId)
      .run()

    const response = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })

    expect(response.status).toBe(expectedStatus)
  })

  it('allows a reservation-writing staff member to reissue a code, revoking the previous issue', async () => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)
    const verified = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })
    const { reservationId } = (await verified.json()) as { reservationId: string }
    const notifier = vi.spyOn(env.NOTIFIER, 'fetch')

    const reissueHeaders = {
      'content-type': 'application/json',
      authorization: `Bearer ${scope.token}`,
      'idempotency-key': 'management-code-reissue-0001',
    }
    const reissued = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservationId}/management-code/reissue`,
      { method: 'POST', headers: reissueHeaders, body: JSON.stringify({}) },
    )

    expect(reissued.status).toBe(201)
    await expect(reissued.json()).resolves.toEqual({ emailStatus: 'sent' })
    const replay = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservationId}/management-code/reissue`,
      { method: 'POST', headers: reissueHeaders, body: JSON.stringify({}) },
    )
    expect(replay.status).toBe(201)
    await expect(replay.json()).resolves.toEqual({ emailStatus: 'sent' })
    const issues = await env.DB.prepare(
      'SELECT revoked_at FROM web_booking_management_code_issues WHERE organization_id = ? ORDER BY issued_at',
    )
      .bind(scope.organizationId)
      .all<{ revoked_at: string | null }>()
    expect(issues.results).toHaveLength(2)
    expect(issues.results.filter((issue) => issue.revoked_at !== null)).toHaveLength(1)

    const reissueClaim = await env.DB.prepare(
      'SELECT created_at, expires_at FROM idempotency_records WHERE organization_id = ? AND operation = ? AND key IS NOT NULL',
    )
      .bind(scope.organizationId, `management_code_reissue:${scope.storeId}`)
      .first<{ created_at: string; expires_at: string }>()
    expect(reissueClaim).toEqual({
      created_at: '2026-08-31T00:00:00.000Z',
      expires_at: '2026-09-01T00:00:00.000Z',
    })
    const reissueDeliveryAttempts = await env.DB.prepare(
      'SELECT attempted_at FROM web_booking_notification_attempts WHERE organization_id = ? AND notification_type = ? ORDER BY attempted_at',
    )
      .bind(scope.organizationId, 'reservation.management_code_reissued')
      .all<{ attempted_at: string }>()
    expect(reissueDeliveryAttempts.results).toEqual([
      { attempted_at: '2026-08-31T00:00:00.000Z' },
      { attempted_at: '2026-08-31T00:00:00.000Z' },
    ])

    const oldCode = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })
    expect(oldCode.status).toBe(401)
    await expect(oldCode.json()).resolves.toEqual({ error: 'management_code_revoked' })
    const payload = JSON.parse(String(notifier.mock.calls[0]?.[1]?.body)) as {
      payload: { appointmentAt: string }
    }
    expect(payload.payload.appointmentAt).toBe('2026-08-31T01:00:00.000Z')
  })

  it('rejects management-code reissue without tenant staff authentication', async () => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)
    const verified = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })
    const { reservationId } = (await verified.json()) as { reservationId: string }

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservationId}/management-code/reissue`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'unauthenticated-reissue-0001',
        },
        body: JSON.stringify({}),
      },
    )

    expect(response.status).toBe(401)
  })

  it('rejects company reissue after the web reservation has been cancelled', async () => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)
    const verified = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })
    const access = (await verified.json()) as { reservationId: string; verificationToken: string }
    expect(
      (
        await SELF.fetch(`${BASE}/api/public/reservations/${access.reservationId}/cancel`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-reservation-verification-token': access.verificationToken,
            'idempotency-key': 'cancel-before-reissue-0001',
          },
          body: JSON.stringify({ version: 1 }),
        })
      ).status,
    ).toBe(200)

    const reissue = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${access.reservationId}/management-code/reissue`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${scope.token}`,
          'idempotency-key': 'cancelled-reissue-0001',
        },
        body: JSON.stringify({}),
      },
    )

    expect(reissue.status).toBe(409)
    await expect(reissue.json()).resolves.toEqual({ error: 'reservation_not_confirmed' })
  })

  it('revokes a web management code when staff cancels its reservation', async () => {
    const scope = await publishedScope()
    const reservation = await reserve(scope)
    const verified = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })
    const { reservationId } = (await verified.json()) as { reservationId: string }

    const cancelled = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservationId}/cancel`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${scope.token}`,
          'idempotency-key': 'staff-cancel-web-code-0001',
        },
        body: JSON.stringify({
          version: 1,
          reason: 'お客様都合',
          confirmation: reservation.reservationNumber,
        }),
      },
    )
    expect(cancelled.status).toBe(200)

    const oldCode = await SELF.fetch(`${BASE}/api/public/reservations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservationNumber: reservation.reservationNumber,
        managementCode: reservation.managementCode,
      }),
    })
    expect(oldCode.status).toBe(401)
    await expect(oldCode.json()).resolves.toEqual({ error: 'management_code_revoked' })
  })
})
