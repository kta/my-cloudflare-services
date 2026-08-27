import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

/**
 * Exception paths of the staff reservation lifecycle.
 *
 * The happy paths live in `reservations.integration.test.ts`; this fixture is
 * restricted to the rejection and projection-filter behaviour that decides
 * whether a mistake stays contained: idempotency claims that must be released
 * (or refused) before any lifecycle write happens, cross-store/cross-tenant
 * requests that must look like a plain `forbidden`, and reception-history rows
 * that must be filtered out instead of leaking a partial projection.
 */

const BASE = 'https://glasses-management.test'
/** The Worker clock is pinned in vitest config; never read the wall clock here. */
const TEST_CLOCK_NOW = '2026-08-31T00:00:00.000Z'
const JWT_SECRET = 'dev-jwt-secret-change-me'
const INTERNAL_HEADERS = {
  'content-type': 'application/json',
  'x-internal-key': 'dev-internal-key',
}
const uuid = () => crypto.randomUUID()

type Scope = { organizationId: string; storeId: string; subjectId: string; token: string }

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

async function syncOrganization(organizationId: string) {
  expect(
    (
      await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
        method: 'POST',
        headers: INTERNAL_HEADERS,
        body: JSON.stringify({
          id: organizationId,
          name: 'ライフサイクル例外組織',
          plan: 'free',
          isDisabled: false,
          createdAt: TEST_CLOCK_NOW,
        }),
      })
    ).status,
  ).toBe(200)
}

/** Adds a store to an existing organization, optionally without a membership. */
async function syncStore(
  organizationId: string,
  subjectId: string,
  options: { withMembership?: boolean } = {},
): Promise<string> {
  const storeId = uuid()
  expect(
    (
      await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
        method: 'POST',
        headers: INTERNAL_HEADERS,
        body: JSON.stringify({
          id: storeId,
          organizationId,
          name: 'ライフサイクル例外店舗',
          slug: `lifecycle-${uuid().slice(0, 8)}`,
          isActive: true,
          createdAt: TEST_CLOCK_NOW,
        }),
      })
    ).status,
  ).toBe(200)
  if (options.withMembership !== false) {
    expect(
      (
        await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
          method: 'POST',
          headers: INTERNAL_HEADERS,
          body: JSON.stringify({
            id: uuid(),
            organizationId,
            storeId,
            userId: subjectId,
            permissions: [
              'settings.manage',
              'reservation.read',
              'reservation.write',
              'customer.read',
            ],
            createdAt: TEST_CLOCK_NOW,
          }),
        })
      ).status,
    ).toBe(200)
  }
  return storeId
}

async function setupScope(): Promise<Scope> {
  const organizationId = uuid()
  const subjectId = uuid()
  await syncOrganization(organizationId)
  const storeId = await syncStore(organizationId, subjectId)
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

/** Minimal availability configuration that yields a bookable 10:00 slot on 2026-08-31. */
async function configure(scope: Scope, storeId: string = scope.storeId) {
  const purposeId = uuid()
  const staffId = uuid()
  const equipmentId = uuid()
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/availability/settings`,
    auth(scope.token, {
      method: 'PUT',
      body: JSON.stringify({
        version: 0,
        receptionStatus: 'open',
        businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '12:00' }] }],
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
            name: '担当者1',
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
            endTime: '12:00',
            breaks: [],
          },
        ],
        equipment: [
          {
            id: equipmentId,
            name: '視力測定機',
            capacity: 1,
            isActive: true,
            availablePeriods: [{ startTime: '10:00', endTime: '12:00' }],
          },
        ],
        maintenance: [],
      }),
    }),
  )
  expect(response.status).toBe(201)
  return { purposeId, staffId, equipmentId }
}

type CreatedReservation = { id: string; reservationNumber: string; version: number }

async function createReservation(
  scope: Scope,
  purposeId: string,
  options: { storeId?: string; startTime?: string; name?: string; phone?: string } = {},
): Promise<CreatedReservation> {
  const storeId = options.storeId ?? scope.storeId
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/reservations`,
    auth(scope.token, {
      method: 'POST',
      headers: { 'idempotency-key': `create-${uuid()}` },
      body: JSON.stringify({
        date: '2026-08-31',
        startTime: options.startTime ?? '10:00',
        purposeIds: [purposeId],
        customer: {
          name: options.name ?? '例外 花子',
          kana: 'レイガイ ハナコ',
          phone: options.phone ?? '090-1111-2222',
        },
        recital: '8月31日の視力測定です。',
      }),
    }),
  )
  expect(response.status).toBe(201)
  return (await response.json()) as CreatedReservation
}

/** Mirrors the Worker's `requestHash` so an in-progress claim can be pre-planted. */
async function requestHash(payload: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(payload)),
  )
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function idempotencyRecord(organizationId: string, operation: string, key: string) {
  return await env.DB.prepare(
    'SELECT id, status FROM idempotency_records WHERE organization_id = ? AND operation = ? AND key = ?',
  )
    .bind(organizationId, operation, key)
    .first<{ id: string; status: string }>()
}

async function reservationRow(organizationId: string, reservationId: string) {
  return await env.DB.prepare(
    'SELECT status, version FROM reservations WHERE organization_id = ? AND id = ?',
  )
    .bind(organizationId, reservationId)
    .first<{ status: string; version: number }>()
}

async function insertAuditEvent(input: {
  organizationId: string
  storeId: string
  action: string
  entityType: string
  entityId: string
  occurredAt: string
}) {
  await env.DB.prepare(
    `INSERT INTO audit_events (
      id, organization_id, store_id, actor_type, actor_id, action, entity_type, entity_id, request_id, metadata, occurred_at
    ) VALUES (?, ?, ?, 'user', ?, ?, ?, ?, NULL, '{}', ?)`,
  )
    .bind(
      uuid(),
      input.organizationId,
      input.storeId,
      uuid(),
      input.action,
      input.entityType,
      input.entityId,
      input.occurredAt,
    )
    .run()
}

describe('no-show idempotency claim handling', () => {
  it('refuses an oversized idempotency key before it can claim a lifecycle transition', async () => {
    // A key longer than the stored column budget must be rejected outright: silently
    // truncating it would let two different requests share one claim.
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const reservation = await createReservation(scope, purposeId)

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/no-show`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'k'.repeat(257) },
        body: JSON.stringify({ version: reservation.version }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_idempotency_key' })
    // The reservation must be untouched, and no claim may have been persisted.
    expect(await reservationRow(scope.organizationId, reservation.id)).toEqual({
      status: 'confirmed',
      version: reservation.version,
    })
    const claims = await env.DB.prepare(
      'SELECT count(*) as total FROM idempotency_records WHERE organization_id = ? AND operation = ?',
    )
      .bind(scope.organizationId, `reservation_no_show:${scope.storeId}`)
      .first<{ total: number }>()
    expect(claims).toEqual({ total: 0 })
  })

  it('releases its no-show claim when the reservation belongs to another store', async () => {
    // Acting across stores must look like a plain forbidden and must not strand the
    // key, otherwise a mistyped store id would permanently block a legitimate retry.
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const reservation = await createReservation(scope, purposeId)
    const otherStoreId = await syncStore(scope.organizationId, scope.subjectId)

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${otherStoreId}/reservations/${reservation.id}/no-show`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'no-show-wrong-store' },
        body: JSON.stringify({ version: reservation.version }),
      }),
    )

    expect(response.status).toBe(403)
    // Existence must not leak: the answer is identical to an unknown reservation id.
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
    expect(
      await idempotencyRecord(
        scope.organizationId,
        `reservation_no_show:${otherStoreId}`,
        'no-show-wrong-store',
      ),
    ).toBeNull()
    expect(await reservationRow(scope.organizationId, reservation.id)).toEqual({
      status: 'confirmed',
      version: reservation.version,
    })
  })

  it('releases its no-show claim on a stale version and reports the latest version', async () => {
    // The caller needs the current version to re-render before retrying, and the
    // released key must let that corrected retry through.
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const reservation = await createReservation(scope, purposeId)
    const checkedIn = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: reservation.version, progress: 'waiting' }),
      }),
    )
    expect(checkedIn.status).toBe(200)

    const stale = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/no-show`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'no-show-stale-version' },
        body: JSON.stringify({ version: reservation.version }),
      }),
    )

    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toEqual({
      error: 'version_conflict',
      currentVersion: reservation.version + 1,
    })
    expect(
      await idempotencyRecord(
        scope.organizationId,
        `reservation_no_show:${scope.storeId}`,
        'no-show-stale-version',
      ),
    ).toBeNull()

    // Checked-in is not a confirmed reservation, so the corrected version is still
    // refused - but as a transition error, which names the blocking status.
    const checkedInNoShow = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/no-show`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'no-show-checked-in' },
        body: JSON.stringify({ version: reservation.version + 1 }),
      }),
    )
    expect(checkedInNoShow.status).toBe(409)
    await expect(checkedInNoShow.json()).resolves.toEqual({
      error: 'invalid_no_show_transition',
      currentStatus: 'checked_in',
      currentVersion: reservation.version + 1,
    })
    expect(
      await idempotencyRecord(
        scope.organizationId,
        `reservation_no_show:${scope.storeId}`,
        'no-show-checked-in',
      ),
    ).toBeNull()
  })

  it('releases its no-show claim for an already-cancelled reservation', async () => {
    // Cancelled is a terminal state; the no-show attempt must report the blocking
    // status rather than overwrite the cancellation record.
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const reservation = await createReservation(scope, purposeId)
    const cancelled = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          version: reservation.version,
          reason: '来店できなくなったため',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )
    expect(cancelled.status).toBe(200)

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/no-show`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'no-show-after-cancel' },
        body: JSON.stringify({ version: reservation.version + 1 }),
      }),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_no_show_transition',
      currentStatus: 'cancelled',
      currentVersion: reservation.version + 1,
    })
    expect(await reservationRow(scope.organizationId, reservation.id)).toEqual({
      status: 'cancelled',
      version: reservation.version + 1,
    })
    expect(
      await idempotencyRecord(
        scope.organizationId,
        `reservation_no_show:${scope.storeId}`,
        'no-show-after-cancel',
      ),
    ).toBeNull()
  })

  it('fails closed for an in-progress no-show key and for a key reused with different input', async () => {
    // An owned-but-unfinished claim must never be taken over, and reusing a key for
    // a different reservation must be refused instead of replaying a wrong result.
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const reservation = await createReservation(scope, purposeId)
    const input = { version: reservation.version }
    await env.DB.prepare(
      `INSERT INTO idempotency_records
       (id, organization_id, operation, key, request_hash, status, result_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'in_progress', NULL, ?, ?)`,
    )
      .bind(
        uuid(),
        scope.organizationId,
        `reservation_no_show:${scope.storeId}`,
        'no-show-owned',
        await requestHash({ reservationId: reservation.id, input }),
        TEST_CLOCK_NOW,
        '2026-09-01T00:00:00.000Z',
      )
      .run()

    const inProgress = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/no-show`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'no-show-owned' },
        body: JSON.stringify(input),
      }),
    )
    expect(inProgress.status).toBe(409)
    await expect(inProgress.json()).resolves.toEqual({ error: 'idempotency_in_progress' })
    expect(await reservationRow(scope.organizationId, reservation.id)).toEqual({
      status: 'confirmed',
      version: reservation.version,
    })

    // Same key, different reservation id => different request hash => conflict.
    const conflicting = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${uuid()}/no-show`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'no-show-owned' },
        body: JSON.stringify(input),
      }),
    )
    expect(conflicting.status).toBe(409)
    await expect(conflicting.json()).resolves.toEqual({ error: 'idempotency_conflict' })
  })

  it('replays the stored no-show result for a repeated key instead of transitioning twice', async () => {
    // A retried request (flaky network) must observe the exact stored reservation
    // snapshot, not a second transition or a version conflict.
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const reservation = await createReservation(scope, purposeId)
    const body = JSON.stringify({ version: reservation.version })
    const first = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/no-show`,
      auth(scope.token, { method: 'POST', headers: { 'idempotency-key': 'no-show-replay' }, body }),
    )
    expect(first.status).toBe(200)
    const firstBody = await first.json()

    const replay = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/no-show`,
      auth(scope.token, { method: 'POST', headers: { 'idempotency-key': 'no-show-replay' }, body }),
    )

    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toEqual(firstBody)
    expect(await reservationRow(scope.organizationId, reservation.id)).toEqual({
      status: 'no_show',
      version: reservation.version + 1,
    })
  })
})

describe('reservation lifecycle tenant and store isolation', () => {
  it('answers a cross-tenant reservation request with a plain forbidden on every route', async () => {
    // A reservation of another organization must be indistinguishable from one that
    // does not exist, on read as well as on every mutating lifecycle route.
    const owner = await setupScope()
    const { purposeId } = await configure(owner)
    const reservation = await createReservation(owner, purposeId)
    // The intruder holds a valid membership for its own store in another tenant.
    const intruder = await setupScope()

    const read = await SELF.fetch(
      `${BASE}/api/staff/stores/${intruder.storeId}/reservations/${reservation.id}`,
      auth(intruder.token),
    )
    expect(read.status).toBe(403)
    await expect(read.json()).resolves.toEqual({ error: 'forbidden' })

    const progress = await SELF.fetch(
      `${BASE}/api/staff/stores/${intruder.storeId}/reservations/${reservation.id}/progress`,
      auth(intruder.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: reservation.version, progress: 'waiting' }),
      }),
    )
    expect(progress.status).toBe(403)
    await expect(progress.json()).resolves.toEqual({ error: 'forbidden' })

    const change = await SELF.fetch(
      `${BASE}/api/staff/stores/${intruder.storeId}/reservations/${reservation.id}`,
      auth(intruder.token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: reservation.version,
          date: '2026-08-31',
          startTime: '11:00',
          purposeIds: [purposeId],
          reason: '越境変更',
        }),
      }),
    )
    expect(change.status).toBe(403)
    await expect(change.json()).resolves.toEqual({ error: 'forbidden' })

    const cancel = await SELF.fetch(
      `${BASE}/api/staff/stores/${intruder.storeId}/reservations/${reservation.id}/cancel`,
      auth(intruder.token, {
        method: 'POST',
        body: JSON.stringify({
          version: reservation.version,
          reason: '越境取消',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )
    expect(cancel.status).toBe(403)
    await expect(cancel.json()).resolves.toEqual({ error: 'forbidden' })

    const noShow = await SELF.fetch(
      `${BASE}/api/staff/stores/${intruder.storeId}/reservations/${reservation.id}/no-show`,
      auth(intruder.token, {
        method: 'POST',
        body: JSON.stringify({ version: reservation.version }),
      }),
    )
    expect(noShow.status).toBe(403)
    await expect(noShow.json()).resolves.toEqual({ error: 'forbidden' })

    // None of the attempts may have moved the owner's reservation.
    expect(await reservationRow(owner.organizationId, reservation.id)).toEqual({
      status: 'confirmed',
      version: reservation.version,
    })
  })

  it('denies reservation detail for a store in the same organization without a membership', async () => {
    // The detail route carries its own permission guard; a same-tenant staff user
    // must still be scoped to the stores they actually belong to.
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const reservation = await createReservation(scope, purposeId)
    const unmemberedStoreId = await syncStore(scope.organizationId, scope.subjectId, {
      withMembership: false,
    })

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${unmemberedStoreId}/reservations/${reservation.id}`,
      auth(scope.token),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('does not expose a sibling store reservation through detail, search, or ledger', async () => {
    // Store scoping must hold even when the caller is a member of both stores, so a
    // reservation is never readable through the wrong store's projection.
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const reservation = await createReservation(scope, purposeId, { name: '同一組織 花子' })
    const siblingStoreId = await syncStore(scope.organizationId, scope.subjectId)

    const detail = await SELF.fetch(
      `${BASE}/api/staff/stores/${siblingStoreId}/reservations/${reservation.id}`,
      auth(scope.token),
    )
    expect(detail.status).toBe(403)
    await expect(detail.json()).resolves.toEqual({ error: 'forbidden' })

    const search = await SELF.fetch(
      `${BASE}/api/staff/stores/${siblingStoreId}/reservations?name=${encodeURIComponent('同一組織')}`,
      auth(scope.token),
    )
    expect(search.status).toBe(200)
    await expect(search.json()).resolves.toEqual([])

    const ledger = await SELF.fetch(
      `${BASE}/api/staff/stores/${siblingStoreId}/ledger?date=2026-08-31`,
      auth(scope.token),
    )
    expect(ledger.status).toBe(200)
    await expect(ledger.json()).resolves.toEqual([])

    const history = await SELF.fetch(
      `${BASE}/api/staff/stores/${siblingStoreId}/reception-history?date=2026-08-31`,
      auth(scope.token),
    )
    expect(history.status).toBe(200)
    await expect(history.json()).resolves.toEqual([])
  })
})

describe('progress update rejections', () => {
  it('refuses progress on a reservation outside the addressed store without leaking it', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const reservation = await createReservation(scope, purposeId)
    const siblingStoreId = await syncStore(scope.organizationId, scope.subjectId)

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${siblingStoreId}/reservations/${reservation.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: reservation.version, progress: 'waiting' }),
      }),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
    expect(await reservationRow(scope.organizationId, reservation.id)).toEqual({
      status: 'confirmed',
      version: reservation.version,
    })
  })

  it('rejects a stale progress version and a duplicated equipment assignment', async () => {
    // Both rejections must happen before any write: the operator's screen is stale,
    // so applying it would silently discard someone else's concurrent update.
    const scope = await setupScope()
    const { purposeId, equipmentId } = await configure(scope)
    const reservation = await createReservation(scope, purposeId)
    const applied = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: reservation.version, progress: 'waiting' }),
      }),
    )
    expect(applied.status).toBe(200)

    const stale = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: reservation.version, progress: 'service_in_progress' }),
      }),
    )
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toEqual({
      error: 'version_conflict',
      currentVersion: reservation.version + 1,
    })

    const duplicated = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: reservation.version + 1,
          progress: 'service_in_progress',
          assignedEquipmentIds: [equipmentId, equipmentId],
        }),
      }),
    )
    expect(duplicated.status).toBe(400)
    await expect(duplicated.json()).resolves.toEqual({ error: 'invalid_equipment_assignment' })
    // The rejected assignment must not have advanced the version.
    expect(await reservationRow(scope.organizationId, reservation.id)).toEqual({
      status: 'checked_in',
      version: reservation.version + 1,
    })
  })
})

describe('reception history projection filters', () => {
  it('drops audit rows whose action is unknown or whose entity no longer resolves', async () => {
    // The history is a projection over audit rows; a row it cannot fully resolve must
    // disappear rather than surface as a half-populated entry.
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const reservation = await createReservation(scope, purposeId)
    // An action outside the reception vocabulary, plus a reservation-typed row whose
    // entity does not exist in this store. No date filter is applied because the
    // lifecycle writers stamp audit rows from the system clock, not the pinned one.
    await insertAuditEvent({
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      action: 'reservation.progress_updated',
      entityType: 'reservation',
      entityId: reservation.id,
      occurredAt: '2026-08-31T04:00:00.000Z',
    })
    await insertAuditEvent({
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      action: 'reservation.cancelled',
      entityType: 'reservation',
      entityId: uuid(),
      occurredAt: '2026-08-31T05:00:00.000Z',
    })

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history`,
      auth(scope.token),
    )

    expect(response.status).toBe(200)
    const entries = (await response.json()) as { action: string; entityId: string }[]
    expect(entries).toEqual([
      expect.objectContaining({ action: 'created', entityId: reservation.id }),
    ])
  })

  it('renders a walk-in entry by its sequence label and filters it out by source', async () => {
    // Walk-ins have no customer record of their own, so the projection must fall back
    // to the provisional sequence label instead of emitting a null name.
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const reservation = await createReservation(scope, purposeId)
    const walkinId = uuid()
    await env.DB.prepare(
      `INSERT INTO walkins (
        id, organization_id, store_id, service_date, sequence, customer_id, status, progress,
        arrived_at, version, created_at, updated_at
      ) VALUES (?, ?, ?, '2026-08-31', 7, NULL, 'active', 'waiting', ?, 1, ?, ?)`,
    )
      .bind(
        walkinId,
        scope.organizationId,
        scope.storeId,
        '2026-08-31T03:00:00.000Z',
        '2026-08-31T03:00:00.000Z',
        '2026-08-31T03:00:00.000Z',
      )
      .run()
    await insertAuditEvent({
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      action: 'walkin.created',
      entityType: 'walkin',
      entityId: walkinId,
      occurredAt: '2026-08-31T03:00:00.000Z',
    })

    const walkinOnly = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history?source=walkin`,
      auth(scope.token),
    )
    expect(walkinOnly.status).toBe(200)
    await expect(walkinOnly.json()).resolves.toEqual([
      expect.objectContaining({
        action: 'walkin_created',
        source: 'walkin',
        entityType: 'walkin',
        entityId: walkinId,
        reservationId: null,
        customerName: 'ウォークイン 7',
        customerPhone: null,
        reservationNumber: null,
      }),
    ])

    // The staff reservation is excluded by the same filter, and the walk-in is
    // excluded by the opposite one - a walk-in has no reservation source.
    const staffOnly = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history?source=staff`,
      auth(scope.token),
    )
    await expect(staffOnly.json()).resolves.toEqual([
      expect.objectContaining({ action: 'created', entityId: reservation.id, source: 'staff' }),
    ])

    // A web-sourced filter matches neither entry.
    const webOnly = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history?source=web`,
      auth(scope.token),
    )
    await expect(webOnly.json()).resolves.toEqual([])
  })

  it('excludes entries by action and by reservation number', async () => {
    // These two filters are what an operator uses to find one specific case; a filter
    // that quietly matches everything would be worse than no filter at all.
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const reservation = await createReservation(scope, purposeId)
    const cancelled = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          version: reservation.version,
          reason: '来店できなくなったため',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )
    expect(cancelled.status).toBe(200)

    const byAction = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history?action=cancelled`,
      auth(scope.token),
    )
    expect(byAction.status).toBe(200)
    await expect(byAction.json()).resolves.toEqual([
      expect.objectContaining({
        action: 'cancelled',
        reservationNumber: reservation.reservationNumber,
        requiresAttention: true,
      }),
    ])

    // `changed` never happened for this reservation, so the filter must empty the list.
    const byMissingAction = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history?action=changed`,
      auth(scope.token),
    )
    await expect(byMissingAction.json()).resolves.toEqual([])

    const byNumber = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history?reservationNumber=${reservation.reservationNumber}`,
      auth(scope.token),
    )
    await expect(byNumber.json()).resolves.toHaveLength(2)

    const byOtherNumber = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history?reservationNumber=EYEX-NOT-A-NUMBER`,
      auth(scope.token),
    )
    expect(byOtherNumber.status).toBe(200)
    await expect(byOtherNumber.json()).resolves.toEqual([])
  })
})
