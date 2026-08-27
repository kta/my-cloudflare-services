import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const INTERNAL_HEADERS = {
  'content-type': 'application/json',
  'x-internal-key': 'dev-internal-key',
}
const uuid = () => crypto.randomUUID()

type Scope = { organizationId: string; storeId: string; token: string }

async function setupScope(input: Partial<Pick<Scope, 'organizationId'>> = {}): Promise<Scope> {
  const organizationId = input.organizationId ?? uuid()
  const storeId = uuid()
  const subjectId = uuid()
  for (const [path, body] of [
    [
      '/api/internal/organizations/sync',
      {
        id: organizationId,
        name: '予約テスト組織',
        plan: 'free',
        isDisabled: false,
        createdAt: '2026-08-26T00:00:00.000Z',
      },
    ],
    [
      '/api/internal/stores/sync',
      {
        id: storeId,
        organizationId,
        name: '予約テスト店舗',
        slug: `reservation-${uuid().slice(0, 8)}`,
        isActive: true,
        createdAt: '2026-08-26T00:00:00.000Z',
      },
    ],
    [
      '/api/internal/store-memberships/sync',
      {
        id: uuid(),
        organizationId,
        storeId,
        userId: subjectId,
        permissions: ['settings.manage', 'reservation.read', 'reservation.write', 'customer.read'],
        createdAt: '2026-08-26T00:00:00.000Z',
      },
    ],
  ] as const) {
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
  return {
    organizationId,
    storeId,
    token: await signAccessToken(
      { sub: subjectId, org: organizationId, email: `${uuid()}@example.test`, role: 'staff' },
      'dev-jwt-secret-change-me',
    ),
  }
}

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

async function configure(
  scope: Scope,
  options: { equipmentCapacity?: number; purposeCapacity?: number; staffCount?: number } = {},
) {
  const purposeId = uuid()
  const staffIds = Array.from({ length: options.staffCount ?? 1 }, () => uuid())
  const staffId = staffIds[0]!
  const equipmentId = uuid()
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${scope.storeId}/availability/settings`,
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
            maxConcurrent: options.purposeCapacity ?? 1,
          },
        ],
        staff: staffIds.map((id, index) => ({
          id,
          name: `担当者${index + 1}`,
          skills: ['眼鏡作製技能'],
          canBook: true,
          isActive: true,
        })),
        shifts: staffIds.map((id) => ({
          id: uuid(),
          staffId: id,
          date: '2026-08-31',
          startTime: '10:00',
          endTime: '12:00',
          breaks: [],
        })),
        equipment: [
          {
            id: equipmentId,
            name: '視力測定機',
            capacity: options.equipmentCapacity ?? 1,
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

describe('staff reservation confirmation', () => {
  it('shows the selected store ledger and atomically records a versioned check-in progress update', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'ledger-progress-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '台帳 花子', kana: 'ダイチョウ ハナコ', phone: '09088889999' },
          recital: '8月31日10時から視力測定です。',
        }),
      }),
    )
    expect(created.status).toBe(201)
    const reservation = (await created.json()) as { id: string; version: number }

    const ledger = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/ledger?date=2026-08-31`,
      auth(scope.token),
    )
    expect(ledger.status).toBe(200)
    await expect(ledger.json()).resolves.toEqual([
      expect.objectContaining({
        id: reservation.id,
        entryType: 'reservation',
        status: 'confirmed',
        progress: null,
        version: reservation.version,
      }),
    ])

    const updated = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: reservation.version,
          progress: 'waiting',
          nextGuidance: '受付でお待ちください',
        }),
      }),
    )
    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({
      id: reservation.id,
      status: 'checked_in',
      progress: 'waiting',
      version: reservation.version + 1,
    })
    const audit = await env.DB.prepare(
      "SELECT action, metadata FROM audit_events WHERE organization_id = ? AND entity_id = ? AND action = 'reservation.progress_updated'",
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ action: string; metadata: string }>()
    expect(audit.results).toEqual([
      expect.objectContaining({ action: 'reservation.progress_updated' }),
    ])
    expect(audit.results[0]?.metadata).not.toContain('受付でお待ちください')
    const progressEvents = await env.DB.prepare(
      `SELECT from_progress, to_progress, assigned_staff_id, assigned_equipment_ids_json, next_guidance, version
       FROM reservation_progress_events WHERE organization_id = ? AND reservation_id = ?`,
    )
      .bind(scope.organizationId, reservation.id)
      .all<{
        from_progress: string | null
        to_progress: string
        assigned_staff_id: string | null
        assigned_equipment_ids_json: string
        next_guidance: string | null
        version: number
      }>()
    expect(progressEvents.results).toEqual([
      {
        from_progress: null,
        to_progress: 'waiting',
        assigned_staff_id: null,
        assigned_equipment_ids_json: '[]',
        next_guidance: '受付でお待ちください',
        version: reservation.version + 1,
      },
    ])

    const stale = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: reservation.version, progress: 'service_completed' }),
      }),
    )
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toEqual({
      error: 'version_conflict',
      currentVersion: reservation.version + 1,
    })
  })

  it('allows only one simultaneous progress update for the same reservation version', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'concurrent-progress-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '競合 台帳', kana: 'キョウゴウ ダイチョウ', phone: '09077779999' },
          recital: '8月31日10時から視力測定です。',
        }),
      }),
    )
    const reservation = (await created.json()) as { id: string; version: number }
    const update = (progress: 'waiting' | 'service_in_progress') =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/progress`,
        auth(scope.token, {
          method: 'PATCH',
          body: JSON.stringify({ version: reservation.version, progress }),
        }),
      )

    const responses = await Promise.all([update('waiting'), update('service_in_progress')])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const audits = await env.DB.prepare(
      "SELECT action FROM audit_events WHERE organization_id = ? AND entity_id = ? AND action = 'reservation.progress_updated'",
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ action: string }>()
    expect(audits.results).toHaveLength(1)
  })

  it('rejects a progress assignment to staff or equipment outside the reservation store', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const foreignScope = await setupScope({ organizationId: scope.organizationId })
    const foreign = await configure(foreignScope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'foreign-progress-assignee' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '割当 境界', kana: 'ワリアテ キョウカイ', phone: '09066667777' },
          recital: '8月31日10時から視力測定です。',
        }),
      }),
    )
    const reservation = (await created.json()) as { id: string; version: number }

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: reservation.version,
          progress: 'waiting',
          assignedStaffId: foreign.staffId,
          assignedEquipmentIds: [foreign.equipmentId],
        }),
      }),
    )

    expect(response.status).toBe(403)
    const persisted = await env.DB.prepare(
      'SELECT version, assigned_staff_id, assigned_equipment_ids_json FROM reservations WHERE id = ?',
    )
      .bind(reservation.id)
      .first<{
        version: number
        assigned_staff_id: string | null
        assigned_equipment_ids_json: string | null
      }>()
    expect(persisted).toEqual({
      version: reservation.version,
      assigned_staff_id: null,
      assigned_equipment_ids_json: null,
    })
  })

  it('allows explicit null to clear operational assignment and guidance fields', async () => {
    const scope = await setupScope()
    const { purposeId, staffId, equipmentId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'clear-progress-assignment' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '割当 解除', kana: 'ワリアテ カイジョ', phone: '09055557777' },
          recital: '8月31日10時から視力測定です。',
        }),
      }),
    )
    const reservation = (await created.json()) as { id: string; version: number }
    const assigned = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: reservation.version,
          progress: 'waiting',
          assignedStaffId: staffId,
          assignedEquipmentIds: [equipmentId],
          nextGuidance: '検査室へご案内します',
        }),
      }),
    )
    const afterAssignment = (await assigned.json()) as { version: number }
    const cleared = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: afterAssignment.version,
          progress: 'service_in_progress',
          assignedStaffId: null,
          nextGuidance: null,
        }),
      }),
    )

    expect(cleared.status).toBe(200)
    await expect(cleared.json()).resolves.toMatchObject({
      assignedStaffId: null,
      nextGuidance: null,
      assignedEquipmentIds: [equipmentId],
    })
  })

  it('records each successful operational change in an append-only progress history', async () => {
    const historyTable = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reservation_progress_events'",
    ).first<{ name: string }>()

    expect(historyTable).toEqual({ name: 'reservation_progress_events' })
  })

  it('scopes an idempotency key to its organization and store', async () => {
    const firstScope = await setupScope()
    const secondScope = await setupScope()
    const first = await configure(firstScope)
    const second = await configure(secondScope)
    const create = (scope: Scope, purposeId: string) =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
        auth(scope.token, {
          method: 'POST',
          headers: { 'idempotency-key': 'same-key-isolated-scope' },
          body: JSON.stringify({
            date: '2026-08-31',
            startTime: '10:00',
            purposeIds: [purposeId],
            customer: { name: '組織分離', kana: 'ソシキブンリ', phone: '09044445555' },
            recital: '8月31日10時から視力測定です。',
          }),
        }),
      )

    const [firstResponse, secondResponse] = await Promise.all([
      create(firstScope, first.purposeId),
      create(secondScope, second.purposeId),
    ])

    expect(firstResponse.status).toBe(201)
    expect(secondResponse.status).toBe(201)
  })

  it('does not replay an idempotent reservation into another store of the same organization', async () => {
    const organizationId = uuid()
    const firstScope = await setupScope({ organizationId })
    const secondScope = await setupScope({ organizationId })
    const first = await configure(firstScope)
    const second = await configure(secondScope)
    const create = (scope: Scope, purposeId: string) =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
        auth(scope.token, {
          method: 'POST',
          headers: { 'idempotency-key': 'same-key-different-store' },
          body: JSON.stringify({
            date: '2026-08-31',
            startTime: '10:00',
            purposeIds: [purposeId],
            customer: { name: '店舗分離', kana: 'テンポブンリ', phone: '09055556666' },
            recital: '8月31日10時から視力測定です。',
          }),
        }),
      )

    const [firstResponse, secondResponse] = await Promise.all([
      create(firstScope, first.purposeId),
      create(secondScope, second.purposeId),
    ])

    expect(firstResponse.status).toBe(201)
    expect(secondResponse.status).toBe(201)
    const rows = await env.DB.prepare(
      'SELECT store_id FROM reservations WHERE organization_id = ? ORDER BY store_id',
    )
      .bind(organizationId)
      .all<{ store_id: string }>()
    expect(rows.results).toEqual(
      [{ store_id: firstScope.storeId }, { store_id: secondScope.storeId }].sort((left, right) =>
        left.store_id.localeCompare(right.store_id),
      ),
    )
  })

  it('rejects a reservation write for a store the JWT user cannot access', async () => {
    const scope = await setupScope()
    const foreignStoreId = uuid()
    const synced = await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({
        id: foreignStoreId,
        organizationId: scope.organizationId,
        name: '権限外店舗',
        slug: `forbidden-${uuid().slice(0, 8)}`,
        isActive: true,
        createdAt: '2026-08-26T00:00:00.000Z',
      }),
    })
    expect(synced.status).toBe(200)

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${foreignStoreId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'forbidden-store-write' },
        body: JSON.stringify({}),
      }),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('rechecks the selected slot and atomically creates one confirmed reservation with an audit event', async () => {
    const scope = await setupScope()
    const { purposeId, staffId, equipmentId } = await configure(scope)
    const body = {
      date: '2026-08-31',
      startTime: '10:00',
      purposeIds: [purposeId],
      customer: { name: '山田 花子', kana: 'ヤマダ ハナコ', phone: '090-1234-5678' },
      recital: '8月31日10時から視力測定で、山田花子様のお電話番号は090-1234-5678です。',
    }
    const create = () =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
        auth(scope.token, {
          method: 'POST',
          headers: { 'idempotency-key': 'staff-reservation-1' },
          body: JSON.stringify(body),
        }),
      )

    const first = await create()
    expect(first.status).toBe(201)
    const reservation = (await first.json()) as {
      id: string
      source: string
      status: string
      startAt: string
      endAt: string
    }
    expect(reservation).toMatchObject({
      source: 'staff',
      status: 'confirmed',
      startAt: '2026-08-31T01:00:00.000Z',
      endAt: '2026-08-31T02:00:00.000Z',
    })

    const retry = await create()
    expect(retry.status).toBe(201)
    await expect(retry.json()).resolves.toMatchObject({ id: reservation.id })

    const conflict = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'staff-reservation-2' },
        body: JSON.stringify(body),
      }),
    )
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toEqual({ error: 'slot_unavailable' })

    const audits = await env.DB.prepare(
      'SELECT action, entity_id FROM audit_events WHERE organization_id = ? AND entity_id = ?',
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ action: string; entity_id: string }>()
    expect(audits.results).toEqual([{ action: 'reservation.created', entity_id: reservation.id }])

    const allocations = await env.DB.prepare(
      `SELECT resource_kind, resource_id FROM reservation_resource_allocations
       WHERE organization_id = ? AND reservation_id = ? ORDER BY resource_kind, resource_id`,
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ resource_kind: string; resource_id: string }>()
    expect(allocations.results).toHaveLength(180)
    expect(allocations.results.filter((row) => row.resource_kind === 'equipment')).toHaveLength(60)
    expect(allocations.results.filter((row) => row.resource_kind === 'purpose')).toHaveLength(60)
    expect(allocations.results.filter((row) => row.resource_kind === 'staff')).toHaveLength(60)
    expect(
      new Set(allocations.results.map((row) => `${row.resource_kind}:${row.resource_id}`)),
    ).toEqual(new Set([`equipment:${equipmentId}:0`, `purpose:${purposeId}:0`, `staff:${staffId}`]))
  })

  it('registers a new customer from a confirmed staff reservation and finds it by normalized phone', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const create = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'staff-reservation-customer' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: {
            name: '山田 花子',
            kana: 'ヤマダ ハナコ',
            phone: '０９０−１２３４−５６７８',
            email: 'hanako@example.test',
          },
          recital: '8月31日10時から視力測定です。',
        }),
      }),
    )
    expect(create.status).toBe(201)

    const second = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'staff-reservation-customer-second' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '11:00',
          purposeIds: [purposeId],
          customer: {
            name: '山田 花子',
            kana: 'ヤマダ ハナコ',
            phone: '090 1234 5678',
            email: 'hanako@example.test',
          },
          recital: '8月31日11時から視力測定です。',
        }),
      }),
    )
    expect(second.status).toBe(201)

    const candidates = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/customers?phone=090-1234`,
      auth(scope.token),
    )
    expect(candidates.status).toBe(200)
    await expect(candidates.json()).resolves.toMatchObject([
      {
        name: '山田 花子',
        phone: '09012345678',
        email: 'hanako@example.test',
        primaryStoreId: scope.storeId,
        visitCount: 2,
      },
    ])
  })

  it('rolls back the whole reservation confirmation when its idempotency completion cannot be written', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    await env.DB.prepare(`
      CREATE TRIGGER reservation_reject_idempotency_completion
      BEFORE UPDATE OF status ON idempotency_records
      WHEN NEW.status = 'completed'
      BEGIN
        SELECT RAISE(ABORT, 'simulated completion persistence failure');
      END;
    `).run()
    try {
      const response = await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
        auth(scope.token, {
          method: 'POST',
          headers: { 'idempotency-key': 'completion-atomicity' },
          body: JSON.stringify({
            date: '2026-08-31',
            startTime: '10:00',
            purposeIds: [purposeId],
            customer: { name: '原子性 確認', kana: 'ゲンシセイ カクニン', phone: '09077778888' },
            recital: '予約です。',
          }),
        }),
      )
      expect(response.status).toBe(500)
      const count = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM reservations WHERE organization_id = ? AND store_id = ?',
      )
        .bind(scope.organizationId, scope.storeId)
        .first<{ count: number }>()
      expect(count).toEqual({ count: 0 })
    } finally {
      await env.DB.prepare('DROP TRIGGER reservation_reject_idempotency_completion').run()
    }
  })

  it('atomically rejects one of two concurrent confirmations for the same resource claims', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const body = JSON.stringify({
      date: '2026-08-31',
      startTime: '10:00',
      purposeIds: [purposeId],
      customer: { name: '競合 太郎', kana: 'キョウゴウ タロウ', phone: '09012345678' },
      recital: '8月31日10時です。',
    })
    const responses = await Promise.all(
      ['concurrent-a', 'concurrent-b'].map((key) =>
        SELF.fetch(
          `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
          auth(scope.token, { method: 'POST', headers: { 'idempotency-key': key }, body }),
        ),
      ),
    )
    const statuses = responses.map((response) => response.status).sort()
    expect(statuses).toEqual([201, 409])
    const reservations = await env.DB.prepare(
      'SELECT id FROM reservations WHERE organization_id = ? AND store_id = ?',
    )
      .bind(scope.organizationId, scope.storeId)
      .all()
    expect(reservations.results).toHaveLength(1)
  })

  it('releases an idempotency key after a pre-commit unavailable-slot response', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const body = JSON.stringify({
      date: '2026-08-31',
      startTime: '10:00',
      purposeIds: [purposeId],
      customer: { name: '再試行 太郎', kana: 'サイシコウ タロウ', phone: '09099990000' },
      recital: '予約です。',
    })
    const create = (key: string) =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
        auth(scope.token, { method: 'POST', headers: { 'idempotency-key': key }, body }),
      )
    expect((await create('existing-slot')).status).toBe(201)
    expect((await create('retry-after-unavailable')).status).toBe(409)

    await env.DB.prepare(
      'DELETE FROM reservation_resource_allocations WHERE organization_id = ? AND store_id = ?',
    )
      .bind(scope.organizationId, scope.storeId)
      .run()
    await env.DB.prepare(
      'DELETE FROM availability_bookings WHERE organization_id = ? AND store_id = ?',
    )
      .bind(scope.organizationId, scope.storeId)
      .run()
    await env.DB.prepare('DELETE FROM reservations WHERE organization_id = ? AND store_id = ?')
      .bind(scope.organizationId, scope.storeId)
      .run()

    expect((await create('retry-after-unavailable')).status).toBe(201)
  })

  it('rejects a phone number that cannot be normalized before it creates an idempotency claim', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'invalid-phone' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '山田 花子', kana: 'ヤマダ ハナコ', phone: 'あいうえおかき' },
          recital: '8月31日10時から視力測定です。',
        }),
      }),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_customer_phone' })
  })

  it('requires an idempotency key and rejects reuse with changed reservation input', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const body = {
      date: '2026-08-31',
      startTime: '10:00',
      purposeIds: [purposeId],
      customer: { name: '山田 花子', kana: 'ヤマダ ハナコ', phone: '09012345678' },
      recital: '8月31日10時です。',
    }
    const missingKey = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, { method: 'POST', body: JSON.stringify(body) }),
    )
    expect(missingKey.status).toBe(400)
    expect(
      (
        await SELF.fetch(
          `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
          auth(scope.token, {
            method: 'POST',
            headers: { 'idempotency-key': 'changed-input' },
            body: JSON.stringify(body),
          }),
        )
      ).status,
    ).toBe(201)
    const changed = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'changed-input' },
        body: JSON.stringify({ ...body, recital: '別の復唱です。' }),
      }),
    )
    expect(changed.status).toBe(409)
    await expect(changed.json()).resolves.toEqual({ error: 'idempotency_conflict' })
  })

  it('treats semantically identical JSON with a different property order as the same idempotent request', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const ordered = {
      date: '2026-08-31',
      startTime: '10:00',
      purposeIds: [purposeId],
      customer: { name: '順序 同一', kana: 'ジュンジョ ドウイツ', phone: '09055556666' },
      recital: '予約です。',
    }
    const reordered = {
      recital: '予約です。',
      customer: { phone: '09055556666', kana: 'ジュンジョ ドウイツ', name: '順序 同一' },
      purposeIds: [purposeId],
      startTime: '10:00',
      date: '2026-08-31',
    }
    const create = (body: unknown) =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
        auth(scope.token, {
          method: 'POST',
          headers: { 'idempotency-key': 'stable-json' },
          body: JSON.stringify(body),
        }),
      )

    const first = await create(ordered)
    expect(first.status).toBe(201)
    const reservation = (await first.json()) as { id: string }
    const retry = await create(reordered)
    expect(retry.status).toBe(201)
    await expect(retry.json()).resolves.toMatchObject({ id: reservation.id })
  })

  it('treats a syntactically valid unknown purpose as an unavailable slot and returns no candidate for a non-numeric phone query', async () => {
    const scope = await setupScope()
    await configure(scope)
    const unavailable = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'unknown-purpose' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [uuid()],
          customer: { name: '山田 花子', kana: 'ヤマダ ハナコ', phone: '09012345678' },
          recital: '8月31日10時です。',
        }),
      }),
    )
    expect(unavailable.status).toBe(409)
    const candidates = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/customers?phone=あ`,
      auth(scope.token),
    )
    await expect(candidates.json()).resolves.toEqual([])
  })

  it('does not disclose customer candidates without customer.read for the selected store', async () => {
    const scope = await setupScope()
    const token = await signAccessToken(
      { sub: uuid(), org: scope.organizationId, email: `${uuid()}@example.test`, role: 'staff' },
      'dev-jwt-secret-change-me',
    )
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/customers?phone=090`,
      auth(token),
    )
    expect(response.status).toBe(403)
  })

  it('atomically upserts one customer when separate reservation times arrive concurrently', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const create = (key: string, startTime: string) =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
        auth(scope.token, {
          method: 'POST',
          headers: { 'idempotency-key': key },
          body: JSON.stringify({
            date: '2026-08-31',
            startTime,
            purposeIds: [purposeId],
            customer: { name: '同時 顧客', kana: 'ドウジ コキャク', phone: '090-9876-5432' },
            recital: '予約です。',
          }),
        }),
      )
    expect(
      (await Promise.all([create('customer-a', '10:00'), create('customer-b', '11:00')])).map(
        (response) => response.status,
      ),
    ).toEqual([201, 201])
    const customers = await env.DB.prepare(
      'SELECT visit_count FROM customers WHERE organization_id = ? AND phone_normalized = ?',
    )
      .bind(scope.organizationId, '09098765432')
      .all<{ visit_count: number }>()
    expect(customers.results).toEqual([{ visit_count: 2 }])
  })

  it('allocates distinct capacity units when a purpose and equipment allow two simultaneous reservations', async () => {
    const scope = await setupScope()
    const { purposeId, equipmentId } = await configure(scope, {
      equipmentCapacity: 2,
      purposeCapacity: 2,
      staffCount: 2,
    })
    const create = (key: string, phone: string) =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
        auth(scope.token, {
          method: 'POST',
          headers: { 'idempotency-key': key },
          body: JSON.stringify({
            date: '2026-08-31',
            startTime: '10:00',
            purposeIds: [purposeId],
            customer: { name: key, kana: 'テスト', phone },
            recital: '予約です。',
          }),
        }),
      )

    expect((await create('capacity-one', '09011112222')).status).toBe(201)
    expect((await create('capacity-two', '09033334444')).status).toBe(201)

    const allocations = await env.DB.prepare(
      `SELECT resource_kind, resource_id FROM reservation_resource_allocations
       WHERE organization_id = ? AND store_id = ? AND resource_kind IN ('equipment', 'purpose')
       GROUP BY resource_kind, resource_id ORDER BY resource_kind, resource_id`,
    )
      .bind(scope.organizationId, scope.storeId)
      .all<{ resource_kind: string; resource_id: string }>()
    expect(allocations.results).toEqual([
      { resource_kind: 'equipment', resource_id: `${equipmentId}:0` },
      { resource_kind: 'equipment', resource_id: `${equipmentId}:1` },
      { resource_kind: 'purpose', resource_id: `${purposeId}:0` },
      { resource_kind: 'purpose', resource_id: `${purposeId}:1` },
    ])
  })

  it('searches and reads only reservations in the selected store by customer name and normalized phone', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'searchable-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '検索 花子', kana: 'ケンサク ハナコ', phone: '090-1212-3434' },
          recital: '8月31日10時から視力測定です。',
        }),
      }),
    )
    expect(created.status).toBe(201)
    const reservation = (await created.json()) as { id: string; reservationNumber: string }

    const byName = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations?name=${encodeURIComponent('花子')}`,
      auth(scope.token),
    )
    expect(byName.status).toBe(200)
    await expect(byName.json()).resolves.toEqual([expect.objectContaining({ id: reservation.id })])
    const byPhone = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations?phone=09012123434`,
      auth(scope.token),
    )
    await expect(byPhone.json()).resolves.toEqual([
      expect.objectContaining({ reservationNumber: reservation.reservationNumber }),
    ])
    const invalidPhone = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations?phone=---`,
      auth(scope.token),
    )
    expect(invalidPhone.status).toBe(400)
    await expect(invalidPhone.json()).resolves.toEqual({ error: 'invalid_reservation_phone' })

    const allFilters = new URLSearchParams({
      kana: 'ケンサク',
      reservationNumber: reservation.reservationNumber,
      dateFrom: '2026-08-31',
      dateTo: '2026-08-31',
      source: 'staff',
      status: 'confirmed',
    })
    const filtered = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations?${allFilters}`,
      auth(scope.token),
    )
    await expect(filtered.json()).resolves.toEqual([
      expect.objectContaining({ id: reservation.id }),
    ])
    const unfiltered = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token),
    )
    await expect(unfiltered.json()).resolves.toEqual([
      expect.objectContaining({ id: reservation.id }),
    ])

    const detail = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}`,
      auth(scope.token),
    )
    expect(detail.status).toBe(200)
    await expect(detail.json()).resolves.toMatchObject({
      id: reservation.id,
      customer: { name: '検索 花子' },
    })
    const missingDetail = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${uuid()}`,
      auth(scope.token),
    )
    expect(missingDetail.status).toBe(403)
    const unauthorizedToken = await signAccessToken(
      { sub: uuid(), org: scope.organizationId, email: `${uuid()}@example.test`, role: 'staff' },
      'dev-jwt-secret-change-me',
    )
    const unauthorizedSearch = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations?name=${encodeURIComponent('花子')}`,
      auth(unauthorizedToken),
    )
    expect(unauthorizedSearch.status).toBe(403)
  })

  it('cancels a selected-store reservation only with a reason and reservation-number confirmation', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'cancel-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '取消 花子', kana: 'トリケシ ハナコ', phone: '090-5555-6666' },
          recital: '8月31日10時から視力測定です。',
        }),
      }),
    )
    expect(created.status).toBe(201)
    const reservation = (await created.json()) as {
      id: string
      reservationNumber: string
      version: number
    }

    const incorrectConfirmation = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          version: reservation.version,
          reason: 'お客様都合',
          confirmation: '確認不一致',
        }),
      }),
    )
    expect(incorrectConfirmation.status).toBe(400)
    const stale = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          version: reservation.version + 1,
          reason: 'お客様都合',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )
    expect(stale.status).toBe(409)
    const missing = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${uuid()}/cancel`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          version: 1,
          reason: 'お客様都合',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )
    expect(missing.status).toBe(403)

    const cancelled = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'cancel-reservation-result-retry' },
        body: JSON.stringify({
          version: reservation.version,
          reason: 'お客様都合',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )

    expect(cancelled.status).toBe(200)
    await expect(cancelled.json()).resolves.toMatchObject({
      id: reservation.id,
      status: 'cancelled',
      version: reservation.version + 1,
    })
    const retriedCancellation = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'cancel-reservation-result-retry' },
        body: JSON.stringify({
          version: reservation.version,
          reason: 'お客様都合',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )
    expect(retriedCancellation.status).toBe(200)
    await expect(retriedCancellation.json()).resolves.toMatchObject({
      id: reservation.id,
      status: 'cancelled',
      version: reservation.version + 1,
    })
    const conflictingRetry = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'cancel-reservation-result-retry' },
        body: JSON.stringify({
          version: reservation.version,
          reason: '異なる取消理由',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )
    expect(conflictingRetry.status).toBe(409)
    await expect(conflictingRetry.json()).resolves.toEqual({ error: 'idempotency_conflict' })
    const alreadyCancelledWithNewKey = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'cancel-already-cancelled' },
        body: JSON.stringify({
          version: reservation.version + 1,
          reason: '再送',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )
    expect(alreadyCancelledWithNewKey.status).toBe(409)
    await expect(alreadyCancelledWithNewKey.json()).resolves.toEqual({
      error: 'reservation_already_cancelled',
      currentVersion: reservation.version + 1,
    })
    const tooLongKey = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'x'.repeat(257) },
        body: JSON.stringify({
          version: reservation.version + 1,
          reason: '再送',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )
    expect(tooLongKey.status).toBe(400)
    await expect(tooLongKey.json()).resolves.toEqual({ error: 'invalid_idempotency_key' })
    const claims = await env.DB.prepare(
      'SELECT id FROM reservation_resource_allocations WHERE organization_id = ? AND reservation_id = ?',
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ id: string }>()
    expect(claims.results).toEqual([])
    const audit = await env.DB.prepare(
      "SELECT action, request_id FROM audit_events WHERE organization_id = ? AND entity_id = ? AND action = 'reservation.cancelled'",
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ action: string; request_id: string | null }>()
    expect(audit.results).toEqual([
      expect.objectContaining({
        action: 'reservation.cancelled',
        request_id: expect.any(String),
      }),
    ])
    const booking = await env.DB.prepare(
      'SELECT status FROM availability_bookings WHERE organization_id = ? AND store_id = ? AND id = ?',
    )
      .bind(scope.organizationId, scope.storeId, reservation.id)
      .first<{ status: string }>()
    expect(booking).toEqual({ status: 'cancelled' })
    const releasedClaims = await env.DB.prepare(
      'SELECT id FROM reservation_resource_allocations WHERE organization_id = ? AND store_id = ? AND reservation_id = ?',
    )
      .bind(scope.organizationId, scope.storeId, reservation.id)
      .all<{ id: string }>()
    expect(releasedClaims.results).toEqual([])
    const cancellationChange = await env.DB.prepare(
      "SELECT before_json, after_json FROM reservation_changes WHERE organization_id = ? AND reservation_id = ? AND action = 'cancelled'",
    )
      .bind(scope.organizationId, reservation.id)
      .first<{ before_json: string; after_json: string }>()
    expect(JSON.parse(cancellationChange?.before_json ?? '')).toMatchObject({
      status: 'confirmed',
      version: reservation.version,
    })
    expect(JSON.parse(cancellationChange?.after_json ?? '')).toMatchObject({
      status: 'cancelled',
      version: reservation.version + 1,
    })
    const repeat = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          version: reservation.version + 1,
          reason: '再送',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )
    expect(repeat.status).toBe(409)
    await expect(repeat.json()).resolves.toEqual({
      error: 'reservation_already_cancelled',
      currentVersion: reservation.version + 1,
    })
  })

  it('records a confirmed reservation as no-show and atomically releases its booking', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'no-show-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '無断 花子', kana: 'ムダン ハナコ', phone: '090-2222-3333' },
          recital: '8月31日10時から視力測定です。',
        }),
      }),
    )
    expect(created.status).toBe(201)
    const reservation = (await created.json()) as { id: string; version: number }

    const marked = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/no-show`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'no-show-transition' },
        body: JSON.stringify({ version: reservation.version }),
      }),
    )

    expect(marked.status).toBe(200)
    await expect(marked.json()).resolves.toMatchObject({
      id: reservation.id,
      status: 'no_show',
      version: reservation.version + 1,
    })
    const replayed = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/no-show`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'no-show-transition' },
        body: JSON.stringify({ version: reservation.version }),
      }),
    )
    expect(replayed.status).toBe(200)
    await expect(replayed.json()).resolves.toMatchObject({
      id: reservation.id,
      status: 'no_show',
      version: reservation.version + 1,
    })

    const persisted = await env.DB.prepare(
      'SELECT status, version FROM reservations WHERE organization_id = ? AND store_id = ? AND id = ?',
    )
      .bind(scope.organizationId, scope.storeId, reservation.id)
      .first<{ status: string; version: number }>()
    expect(persisted).toEqual({ status: 'no_show', version: reservation.version + 1 })
    const booking = await env.DB.prepare(
      'SELECT status FROM availability_bookings WHERE organization_id = ? AND store_id = ? AND id = ?',
    )
      .bind(scope.organizationId, scope.storeId, reservation.id)
      .first<{ status: string }>()
    expect(booking).toEqual({ status: 'cancelled' })
    const change = await env.DB.prepare(
      'SELECT action, before_json, after_json FROM reservation_changes WHERE organization_id = ? AND store_id = ? AND reservation_id = ? AND action = ?',
    )
      .bind(scope.organizationId, scope.storeId, reservation.id, 'no_show')
      .first<{ action: string; before_json: string; after_json: string }>()
    expect(change?.action).toBe('no_show')
    expect(JSON.parse(change?.before_json ?? '')).toMatchObject({
      status: 'confirmed',
      version: reservation.version,
    })
    expect(JSON.parse(change?.after_json ?? '')).toMatchObject({
      status: 'no_show',
      version: reservation.version + 1,
    })
    const audit = await env.DB.prepare(
      "SELECT action FROM audit_events WHERE organization_id = ? AND store_id = ? AND entity_id = ? AND action = 'reservation.no_show'",
    )
      .bind(scope.organizationId, scope.storeId, reservation.id)
      .all<{ action: string }>()
    expect(audit.results).toEqual([{ action: 'reservation.no_show' }])
    const history = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/history`,
      auth(scope.token),
    )
    expect(history.status).toBe(200)
    await expect(history.json()).resolves.toEqual([
      expect.objectContaining({ action: 'no_show', reservationId: reservation.id }),
    ])
    const receptionHistory = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history`,
      auth(scope.token),
    )
    expect(receptionHistory.status).toBe(200)
    await expect(receptionHistory.json()).resolves.toContainEqual(
      expect.objectContaining({
        action: 'no_show',
        entityId: reservation.id,
        reservationId: reservation.id,
        requiresAttention: true,
      }),
    )

    const progress = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: reservation.version + 1, progress: 'waiting' }),
      }),
    )
    expect(progress.status).toBe(409)
    await expect(progress.json()).resolves.toEqual({
      error: 'invalid_progress_transition',
      currentVersion: reservation.version + 1,
    })

    const changedAfterNoShow = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: reservation.version + 1,
          date: '2026-08-31',
          startTime: '11:00',
          purposeIds: [purposeId],
          reason: '無断キャンセル済みのため変更不可',
        }),
      }),
    )
    expect(changedAfterNoShow.status).toBe(409)
    await expect(changedAfterNoShow.json()).resolves.toEqual({
      error: 'reservation_no_show',
      currentVersion: reservation.version + 1,
    })
    const cancelledAfterNoShow = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          version: reservation.version + 1,
          reason: '無断キャンセル済みのため取消不可',
          confirmation: (
            (await (
              await SELF.fetch(
                `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}`,
                auth(scope.token),
              )
            ).json()) as { reservationNumber: string }
          ).reservationNumber,
        }),
      }),
    )
    expect(cancelledAfterNoShow.status).toBe(409)
    await expect(cancelledAfterNoShow.json()).resolves.toEqual({
      error: 'reservation_no_show',
      currentVersion: reservation.version + 1,
    })

    // Coverage-only: exercise the already-implemented lifecycle conflict
    // branches so the atomic no-show operation remains regression-proof.
    const repeated = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/no-show`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({ version: reservation.version + 1 }),
      }),
    )
    expect(repeated.status).toBe(409)
    await expect(repeated.json()).resolves.toEqual({
      error: 'invalid_no_show_transition',
      currentStatus: 'no_show',
      currentVersion: reservation.version + 1,
    })
    const stale = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/no-show`,
      auth(scope.token, { method: 'POST', body: JSON.stringify({ version: reservation.version }) }),
    )
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toEqual({
      error: 'version_conflict',
      currentVersion: reservation.version + 1,
    })
  })

  it('checks store permission before validating reservation search and lifecycle input', async () => {
    const scope = await setupScope()
    const outsiderToken = await signAccessToken(
      { sub: uuid(), org: scope.organizationId, email: `${uuid()}@example.test`, role: 'staff' },
      'dev-jwt-secret-change-me',
    )
    const search = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations?dateFrom=not-a-date`,
      auth(outsiderToken),
    )
    expect(search.status).toBe(403)
    const change = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${uuid()}`,
      auth(outsiderToken, { method: 'PATCH', body: JSON.stringify({}) }),
    )
    expect(change.status).toBe(403)
    const cancellation = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${uuid()}/cancel`,
      auth(outsiderToken, { method: 'POST', body: JSON.stringify({}) }),
    )
    expect(cancellation.status).toBe(403)
    const noShow = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${uuid()}/no-show`,
      auth(outsiderToken, { method: 'POST', body: JSON.stringify({}) }),
    )
    expect(noShow.status).toBe(403)
    const ledger = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/ledger?date=invalid`,
      auth(outsiderToken),
    )
    expect(ledger.status).toBe(403)
    const history = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history?requiresAttention=invalid`,
      auth(outsiderToken),
    )
    expect(history.status).toBe(403)
    const progress = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${uuid()}/progress`,
      auth(outsiderToken, { method: 'PATCH', body: JSON.stringify({}) }),
    )
    expect(progress.status).toBe(403)
  })

  it('shows immutable selected-store change and cancellation history', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'history-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '履歴 花子', kana: 'リレキ ハナコ', phone: '090-4444-5555' },
          recital: '履歴確認です。',
        }),
      }),
    )
    const reservation = (await created.json()) as {
      id: string
      version: number
      reservationNumber: string
    }
    const changed = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}`,
      auth(scope.token, {
        method: 'PATCH',
        headers: { 'idempotency-key': 'history-change' },
        body: JSON.stringify({
          version: reservation.version,
          date: '2026-08-31',
          startTime: '11:00',
          purposeIds: [purposeId],
          reason: '時間変更',
        }),
      }),
    )
    expect(changed.status).toBe(200)
    const cancelled = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'history-cancel' },
        body: JSON.stringify({
          version: reservation.version + 1,
          reason: 'お客様都合',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )
    expect(cancelled.status).toBe(200)
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/history`,
      auth(scope.token),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        action: 'changed',
        reason: '時間変更',
        reservationId: reservation.id,
      }),
      expect.objectContaining({
        action: 'cancelled',
        reason: 'お客様都合',
        reservationId: reservation.id,
      }),
    ])
  })

  it('cancels only resource claims from the reservation store and preserves immutable change history', async () => {
    const scope = await setupScope()
    const foreignScope = await setupScope({ organizationId: scope.organizationId })
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'cancel-store-scoped-claims' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '取消 境界', kana: 'トリケシ キョウカイ', phone: '090-3333-4444' },
          recital: '予約内容です。',
        }),
      }),
    )
    const reservation = (await created.json()) as {
      id: string
      reservationNumber: string
      version: number
    }
    await env.DB.prepare(
      `INSERT INTO reservation_resource_allocations
       (id, organization_id, store_id, reservation_id, resource_kind, resource_id, slot_start_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        uuid(),
        scope.organizationId,
        foreignScope.storeId,
        reservation.id,
        'purpose',
        'foreign:0',
        '2026-08-31T01:00:00.000Z',
      )
      .run()

    const cancelled = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          version: reservation.version,
          reason: '都合',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )

    expect(cancelled.status).toBe(200)
    const foreignClaim = await env.DB.prepare(
      'SELECT id FROM reservation_resource_allocations WHERE organization_id = ? AND store_id = ? AND reservation_id = ?',
    )
      .bind(scope.organizationId, foreignScope.storeId, reservation.id)
      .first<{ id: string }>()
    expect(foreignClaim).toEqual(expect.objectContaining({ id: expect.any(String) }))
    const change = await env.DB.prepare(
      "SELECT id FROM reservation_changes WHERE organization_id = ? AND reservation_id = ? AND action = 'cancelled'",
    )
      .bind(scope.organizationId, reservation.id)
      .first<{ id: string }>()
    expect(change).toEqual(expect.objectContaining({ id: expect.any(String) }))
    await expect(
      env.DB.prepare('DELETE FROM reservation_changes WHERE id = ?').bind(change?.id).run(),
    ).rejects.toThrow('append-only')
  })

  it('releases a failed cancellation idempotency claim so the corrected request can proceed', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'release-cancel-claim-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '取消再試行', kana: 'トリケシサイシコウ', phone: '090-4444-5555' },
          recital: '予約内容です。',
        }),
      }),
    )
    const reservation = (await created.json()) as {
      id: string
      reservationNumber: string
      version: number
    }
    const request = (confirmation: string) =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
        auth(scope.token, {
          method: 'POST',
          headers: { 'idempotency-key': 'release-cancel-claim' },
          body: JSON.stringify({ version: reservation.version, reason: '都合', confirmation }),
        }),
      )

    expect((await request('不一致')).status).toBe(400)
    expect((await request(reservation.reservationNumber)).status).toBe(200)
  })

  it('does not persist a completed idempotency result for the cancellation CAS loser', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'cancel-cas-race-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '取消競合', kana: 'トリケシキョウゴウ', phone: '090-5555-6666' },
          recital: '予約内容です。',
        }),
      }),
    )
    const reservation = (await created.json()) as {
      id: string
      reservationNumber: string
      version: number
    }
    const cancel = (key: string) =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
        auth(scope.token, {
          method: 'POST',
          headers: { 'idempotency-key': key },
          body: JSON.stringify({
            version: reservation.version,
            reason: '都合',
            confirmation: reservation.reservationNumber,
          }),
        }),
      )
    const keys = ['cancel-cas-race-a', 'cancel-cas-race-b']
    const responses = await Promise.all(keys.map(cancel))
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const loserKey = keys[responses.findIndex((response) => response.status === 409)]!

    const retry = await cancel(loserKey)

    expect(retry.status).toBe(409)
    await expect(retry.json()).resolves.toMatchObject({ currentVersion: reservation.version + 1 })
    const loserRecord = await env.DB.prepare(
      'SELECT status FROM idempotency_records WHERE organization_id = ? AND operation = ? AND key = ?',
    )
      .bind(scope.organizationId, `reservation_cancel:${scope.storeId}`, loserKey)
      .first<{ status: string }>()
    expect(loserRecord?.status).not.toBe('completed')
  })

  it('moves a reservation only after the replacement slot and its resources are secured', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'move-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '変更 花子', kana: 'ヘンコウ ハナコ', phone: '090-6666-7777' },
          recital: '8月31日10時から視力測定です。',
        }),
      }),
    )
    const reservation = (await created.json()) as { id: string; version: number }

    const changed = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}`,
      auth(scope.token, {
        method: 'PATCH',
        headers: { 'idempotency-key': 'move-reservation-result-retry' },
        body: JSON.stringify({
          version: reservation.version,
          date: '2026-08-31',
          startTime: '11:00',
          purposeIds: [purposeId],
          reason: '時間変更',
        }),
      }),
    )

    expect(changed.status).toBe(200)
    await expect(changed.json()).resolves.toMatchObject({
      id: reservation.id,
      startAt: '2026-08-31T02:00:00.000Z',
      version: reservation.version + 1,
    })
    const claims = await env.DB.prepare(
      'SELECT slot_start_at FROM reservation_resource_allocations WHERE organization_id = ? AND reservation_id = ? ORDER BY slot_start_at',
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ slot_start_at: string }>()
    expect(claims.results).toHaveLength(180)
    expect(claims.results[0]?.slot_start_at).toBe('2026-08-31T02:00:00.000Z')
    const booking = await env.DB.prepare(
      'SELECT start_at, end_at FROM availability_bookings WHERE organization_id = ? AND store_id = ? AND id = ?',
    )
      .bind(scope.organizationId, scope.storeId, reservation.id)
      .first<{ start_at: string; end_at: string }>()
    expect(booking).toEqual({
      start_at: '2026-08-31T02:00:00.000Z',
      end_at: '2026-08-31T03:00:00.000Z',
    })
    const changedHistory = await env.DB.prepare(
      'SELECT action, before_json, after_json FROM reservation_changes WHERE organization_id = ? AND reservation_id = ?',
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ action: string; before_json: string; after_json: string }>()
    expect(changedHistory.results).toEqual([expect.objectContaining({ action: 'changed' })])
    expect(JSON.parse(changedHistory.results[0]?.before_json ?? '')).toMatchObject({
      startAt: '2026-08-31T01:00:00.000Z',
    })
    expect(JSON.parse(changedHistory.results[0]?.after_json ?? '')).toMatchObject({
      startAt: '2026-08-31T02:00:00.000Z',
    })
    const changeAudit = await env.DB.prepare(
      "SELECT request_id FROM audit_events WHERE organization_id = ? AND entity_id = ? AND action = 'reservation.changed'",
    )
      .bind(scope.organizationId, reservation.id)
      .first<{ request_id: string | null }>()
    expect(changeAudit).toEqual({ request_id: expect.any(String) })
    const retried = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}`,
      auth(scope.token, {
        method: 'PATCH',
        headers: { 'idempotency-key': 'move-reservation-result-retry' },
        body: JSON.stringify({
          version: reservation.version,
          date: '2026-08-31',
          startTime: '11:00',
          purposeIds: [purposeId],
          reason: '時間変更',
        }),
      }),
    )
    expect(retried.status).toBe(200)
    await expect(retried.json()).resolves.toMatchObject({
      id: reservation.id,
      startAt: '2026-08-31T02:00:00.000Z',
      version: reservation.version + 1,
    })
    const conflictingRetry = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}`,
      auth(scope.token, {
        method: 'PATCH',
        headers: { 'idempotency-key': 'move-reservation-result-retry' },
        body: JSON.stringify({
          version: reservation.version,
          date: '2026-08-31',
          startTime: '11:00',
          purposeIds: [purposeId],
          reason: '別理由',
        }),
      }),
    )
    expect(conflictingRetry.status).toBe(409)
    await expect(conflictingRetry.json()).resolves.toEqual({ error: 'idempotency_conflict' })
    const staleWithNewKey = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}`,
      auth(scope.token, {
        method: 'PATCH',
        headers: { 'idempotency-key': 'move-reservation-stale' },
        body: JSON.stringify({
          version: reservation.version,
          date: '2026-08-31',
          startTime: '11:00',
          purposeIds: [purposeId],
          reason: '時間変更',
        }),
      }),
    )
    expect(staleWithNewKey.status).toBe(409)
    await expect(staleWithNewKey.json()).resolves.toEqual({
      error: 'version_conflict',
      currentVersion: reservation.version + 1,
    })
  })

  it('keeps the original reservation and its claims when the replacement slot is unavailable', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const create = (key: string, startTime: string) =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
        auth(scope.token, {
          method: 'POST',
          headers: { 'idempotency-key': key },
          body: JSON.stringify({
            date: '2026-08-31',
            startTime,
            purposeIds: [purposeId],
            customer: {
              name: key,
              kana: 'ヘンコウ',
              phone: key === 'move-original' ? '090-1111-2222' : '090-2222-3333',
            },
            recital: '予約内容です。',
          }),
        }),
      )
    const original = (await (await create('move-original', '10:00')).json()) as {
      id: string
      version: number
    }
    expect((await create('move-blocker', '11:00')).status).toBe(201)

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${original.id}`,
      auth(scope.token, {
        method: 'PATCH',
        headers: { 'idempotency-key': 'move-unavailable-retry' },
        body: JSON.stringify({
          version: original.version,
          date: '2026-08-31',
          startTime: '11:00',
          purposeIds: [purposeId],
          reason: '時間変更',
        }),
      }),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'slot_unavailable' })
    const persisted = await env.DB.prepare(
      'SELECT start_at, version FROM reservations WHERE organization_id = ? AND id = ?',
    )
      .bind(scope.organizationId, original.id)
      .first<{ start_at: string; version: number }>()
    expect(persisted).toEqual({ start_at: '2026-08-31T01:00:00.000Z', version: original.version })
    const originalClaims = await env.DB.prepare(
      'SELECT id FROM reservation_resource_allocations WHERE organization_id = ? AND reservation_id = ?',
    )
      .bind(scope.organizationId, original.id)
      .all<{ id: string }>()
    expect(originalClaims.results).toHaveLength(180)
    const failedMoveRecord = await env.DB.prepare(
      'SELECT status FROM idempotency_records WHERE organization_id = ? AND operation = ? AND key = ?',
    )
      .bind(scope.organizationId, `reservation_change:${scope.storeId}`, 'move-unavailable-retry')
      .first<{ status: string }>()
    expect(failedMoveRecord).toBeNull()
  })

  it('fails closed for an in-progress change key and releases a missing-reservation key', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const reservationId = uuid()
    const input = {
      version: 1,
      date: '2026-08-31',
      startTime: '10:00',
      purposeIds: [purposeId],
      reason: '時間変更',
    }
    const requestHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify({ reservationId, input })),
    )
    const hash = [...new Uint8Array(requestHash)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    const createdAt = '2026-08-31T00:00:00.000Z'
    await env.DB.prepare(
      `INSERT INTO idempotency_records
       (id, organization_id, operation, key, request_hash, status, result_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        uuid(),
        scope.organizationId,
        `reservation_change:${scope.storeId}`,
        'change-in-progress',
        hash,
        'in_progress',
        null,
        createdAt,
        '2026-09-01T00:00:00.000Z',
      )
      .run()

    const inProgress = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservationId}`,
      auth(scope.token, {
        method: 'PATCH',
        headers: { 'idempotency-key': 'change-in-progress' },
        body: JSON.stringify(input),
      }),
    )
    expect(inProgress.status).toBe(409)
    await expect(inProgress.json()).resolves.toEqual({ error: 'idempotency_in_progress' })
    const missing = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${uuid()}`,
      auth(scope.token, {
        method: 'PATCH',
        headers: { 'idempotency-key': 'change-missing' },
        body: JSON.stringify(input),
      }),
    )
    expect(missing.status).toBe(403)
    const released = await env.DB.prepare(
      'SELECT id FROM idempotency_records WHERE organization_id = ? AND operation = ? AND key = ?',
    )
      .bind(scope.organizationId, `reservation_change:${scope.storeId}`, 'change-missing')
      .first<{ id: string }>()
    expect(released).toBeNull()
  })

  it('rejects an oversized change key and releases a key for an already-cancelled reservation', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'change-cancelled-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '変更取消済', kana: 'ヘンコウトリケシズミ', phone: '090-6666-7777' },
          recital: '予約内容です。',
        }),
      }),
    )
    const reservation = (await created.json()) as {
      id: string
      reservationNumber: string
      version: number
    }
    const cancellation = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          version: reservation.version,
          reason: '都合',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )
    expect(cancellation.status).toBe(200)
    const changeInput = {
      version: reservation.version + 1,
      date: '2026-08-31',
      startTime: '11:00',
      purposeIds: [purposeId],
      reason: '時間変更',
    }
    const oversized = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}`,
      auth(scope.token, {
        method: 'PATCH',
        headers: { 'idempotency-key': 'x'.repeat(257) },
        body: JSON.stringify(changeInput),
      }),
    )
    expect(oversized.status).toBe(400)
    const cancelled = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}`,
      auth(scope.token, {
        method: 'PATCH',
        headers: { 'idempotency-key': 'change-cancelled' },
        body: JSON.stringify(changeInput),
      }),
    )
    expect(cancelled.status).toBe(409)
    await expect(cancelled.json()).resolves.toEqual({
      error: 'reservation_already_cancelled',
      currentVersion: reservation.version + 1,
    })
    const released = await env.DB.prepare(
      'SELECT id FROM idempotency_records WHERE organization_id = ? AND operation = ? AND key = ?',
    )
      .bind(scope.organizationId, `reservation_change:${scope.storeId}`, 'change-cancelled')
      .first<{ id: string }>()
    expect(released).toBeNull()
  })

  it('fails closed for an in-progress cancellation key and releases a missing-reservation key', async () => {
    const scope = await setupScope()
    const reservationId = uuid()
    const input = { version: 1, reason: '都合', confirmation: 'EYEX-UNKNOWN' }
    const requestHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify({ reservationId, input })),
    )
    const hash = [...new Uint8Array(requestHash)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    await env.DB.prepare(
      `INSERT INTO idempotency_records
       (id, organization_id, operation, key, request_hash, status, result_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        uuid(),
        scope.organizationId,
        `reservation_cancel:${scope.storeId}`,
        'cancel-in-progress',
        hash,
        'in_progress',
        null,
        '2026-08-31T00:00:00.000Z',
        '2026-09-01T00:00:00.000Z',
      )
      .run()
    const inProgress = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservationId}/cancel`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'cancel-in-progress' },
        body: JSON.stringify(input),
      }),
    )
    expect(inProgress.status).toBe(409)
    await expect(inProgress.json()).resolves.toEqual({ error: 'idempotency_in_progress' })
    const missing = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${uuid()}/cancel`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'cancel-missing' },
        body: JSON.stringify(input),
      }),
    )
    expect(missing.status).toBe(403)
    const released = await env.DB.prepare(
      'SELECT id FROM idempotency_records WHERE organization_id = ? AND operation = ? AND key = ?',
    )
      .bind(scope.organizationId, `reservation_cancel:${scope.storeId}`, 'cancel-missing')
      .first<{ id: string }>()
    expect(released).toBeNull()
  })

  it('releases a cancellation key after a stale version and rejects an oversized cancellation key', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'cancel-stale-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '取消版競合', kana: 'トリケシバンキョウゴウ', phone: '090-7777-8888' },
          recital: '予約内容です。',
        }),
      }),
    )
    const reservation = (await created.json()) as {
      id: string
      reservationNumber: string
      version: number
    }
    const body = JSON.stringify({
      version: reservation.version + 1,
      reason: '都合',
      confirmation: reservation.reservationNumber,
    })
    const stale = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, { method: 'POST', headers: { 'idempotency-key': 'cancel-stale' }, body }),
    )
    expect(stale.status).toBe(409)
    const released = await env.DB.prepare(
      'SELECT id FROM idempotency_records WHERE organization_id = ? AND operation = ? AND key = ?',
    )
      .bind(scope.organizationId, `reservation_cancel:${scope.storeId}`, 'cancel-stale')
      .first<{ id: string }>()
    expect(released).toBeNull()
    const oversized = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, { method: 'POST', headers: { 'idempotency-key': 'x'.repeat(257) }, body }),
    )
    expect(oversized.status).toBe(400)
  })

  it('rolls back cancellation when its availability projection is missing', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'cancel-missing-projection-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: { name: '投影欠落', kana: 'トウエイケツラク', phone: '090-8888-9999' },
          recital: '予約内容です。',
        }),
      }),
    )
    const reservation = (await created.json()) as {
      id: string
      reservationNumber: string
      version: number
    }
    await env.DB.prepare(
      'DELETE FROM availability_bookings WHERE organization_id = ? AND store_id = ? AND id = ?',
    )
      .bind(scope.organizationId, scope.storeId, reservation.id)
      .run()

    const cancelled = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'cancel-missing-projection' },
        body: JSON.stringify({
          version: reservation.version,
          reason: '都合',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )

    expect(cancelled.status).toBe(409)
    await expect(cancelled.json()).resolves.toEqual({ error: 'reservation_projection_missing' })
    const persisted = await env.DB.prepare(
      'SELECT status, version FROM reservations WHERE organization_id = ? AND id = ?',
    )
      .bind(scope.organizationId, reservation.id)
      .first<{ status: string; version: number }>()
    expect(persisted).toEqual({ status: 'confirmed', version: reservation.version })
    const claims = await env.DB.prepare(
      'SELECT id FROM reservation_resource_allocations WHERE organization_id = ? AND reservation_id = ?',
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ id: string }>()
    expect(claims.results).toHaveLength(180)
    const history = await env.DB.prepare(
      'SELECT id FROM reservation_changes WHERE organization_id = ? AND reservation_id = ?',
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ id: string }>()
    expect(history.results).toEqual([])
  })

  it('rolls back a change when its availability projection is missing', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'change-missing-projection-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: {
            name: '変更投影欠落',
            kana: 'ヘンコウトウエイケツラク',
            phone: '090-9999-0000',
          },
          recital: '予約内容です。',
        }),
      }),
    )
    const reservation = (await created.json()) as { id: string; version: number }
    await env.DB.prepare(
      'DELETE FROM availability_bookings WHERE organization_id = ? AND store_id = ? AND id = ?',
    )
      .bind(scope.organizationId, scope.storeId, reservation.id)
      .run()

    const changed = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}`,
      auth(scope.token, {
        method: 'PATCH',
        headers: { 'idempotency-key': 'change-missing-projection' },
        body: JSON.stringify({
          version: reservation.version,
          date: '2026-08-31',
          startTime: '11:00',
          purposeIds: [purposeId],
          reason: '時間変更',
        }),
      }),
    )

    expect(changed.status).toBe(409)
    await expect(changed.json()).resolves.toEqual({ error: 'reservation_projection_missing' })
    const persisted = await env.DB.prepare(
      'SELECT start_at, version FROM reservations WHERE organization_id = ? AND id = ?',
    )
      .bind(scope.organizationId, reservation.id)
      .first<{ start_at: string; version: number }>()
    expect(persisted).toEqual({
      start_at: '2026-08-31T01:00:00.000Z',
      version: reservation.version,
    })
    const claims = await env.DB.prepare(
      'SELECT id FROM reservation_resource_allocations WHERE organization_id = ? AND reservation_id = ?',
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ id: string }>()
    expect(claims.results).toHaveLength(180)
  })

  it('keeps a cancellation idempotency claim when batch completion is indeterminate', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'cancel-audit-failure-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: {
            name: '取消監査失敗',
            kana: 'トリケシカンサシッパイ',
            phone: '090-0000-1111',
          },
          recital: '予約内容です。',
        }),
      }),
    )
    const reservation = (await created.json()) as {
      id: string
      reservationNumber: string
      version: number
    }
    await env.DB.prepare(
      `CREATE TRIGGER fail_cancel_audit
       BEFORE INSERT ON audit_events
       WHEN NEW.action = 'reservation.cancelled'
       BEGIN SELECT RAISE(ABORT, 'test audit failure'); END`,
    ).run()
    try {
      const response = await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
        auth(scope.token, {
          method: 'POST',
          headers: { 'idempotency-key': 'cancel-audit-failure' },
          body: JSON.stringify({
            version: reservation.version,
            reason: '都合',
            confirmation: reservation.reservationNumber,
          }),
        }),
      )
      expect(response.status).toBe(500)
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_cancel_audit').run()
    }
    const reservationAfterFailure = await env.DB.prepare(
      'SELECT status, version FROM reservations WHERE organization_id = ? AND id = ?',
    )
      .bind(scope.organizationId, reservation.id)
      .first<{ status: string; version: number }>()
    expect(reservationAfterFailure).toEqual({ status: 'confirmed', version: reservation.version })
    const booking = await env.DB.prepare(
      'SELECT status FROM availability_bookings WHERE organization_id = ? AND store_id = ? AND id = ?',
    )
      .bind(scope.organizationId, scope.storeId, reservation.id)
      .first<{ status: string }>()
    expect(booking).toEqual({ status: 'confirmed' })
    const claims = await env.DB.prepare(
      'SELECT id FROM reservation_resource_allocations WHERE organization_id = ? AND reservation_id = ?',
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ id: string }>()
    expect(claims.results).toHaveLength(180)
    const history = await env.DB.prepare(
      'SELECT id FROM reservation_changes WHERE organization_id = ? AND reservation_id = ?',
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ id: string }>()
    expect(history.results).toEqual([])
    const idempotency = await env.DB.prepare(
      'SELECT status FROM idempotency_records WHERE organization_id = ? AND operation = ? AND key = ?',
    )
      .bind(scope.organizationId, `reservation_cancel:${scope.storeId}`, 'cancel-audit-failure')
      .first<{ status: string }>()
    expect(idempotency).toEqual({ status: 'in_progress' })
    const retry = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}/cancel`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'cancel-audit-failure' },
        body: JSON.stringify({
          version: reservation.version,
          reason: '都合',
          confirmation: reservation.reservationNumber,
        }),
      }),
    )
    expect(retry.status).toBe(409)
    await expect(retry.json()).resolves.toEqual({ error: 'idempotency_in_progress' })
  })

  it('keeps a change idempotency claim when batch completion is indeterminate', async () => {
    const scope = await setupScope()
    const { purposeId } = await configure(scope)
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': 'change-audit-failure-reservation' },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '10:00',
          purposeIds: [purposeId],
          customer: {
            name: '変更監査失敗',
            kana: 'ヘンコウカンサシッパイ',
            phone: '090-1111-0000',
          },
          recital: '予約内容です。',
        }),
      }),
    )
    const reservation = (await created.json()) as { id: string; version: number }
    await env.DB.prepare(
      `CREATE TRIGGER fail_change_audit
       BEFORE INSERT ON audit_events
       WHEN NEW.action = 'reservation.changed'
       BEGIN SELECT RAISE(ABORT, 'test audit failure'); END`,
    ).run()
    try {
      const response = await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}`,
        auth(scope.token, {
          method: 'PATCH',
          headers: { 'idempotency-key': 'change-audit-failure' },
          body: JSON.stringify({
            version: reservation.version,
            date: '2026-08-31',
            startTime: '11:00',
            purposeIds: [purposeId],
            reason: '時間変更',
          }),
        }),
      )
      expect(response.status).toBe(500)
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_change_audit').run()
    }
    const reservationAfterFailure = await env.DB.prepare(
      'SELECT start_at, version FROM reservations WHERE organization_id = ? AND id = ?',
    )
      .bind(scope.organizationId, reservation.id)
      .first<{ start_at: string; version: number }>()
    expect(reservationAfterFailure).toEqual({
      start_at: '2026-08-31T01:00:00.000Z',
      version: reservation.version,
    })
    const booking = await env.DB.prepare(
      'SELECT start_at FROM availability_bookings WHERE organization_id = ? AND store_id = ? AND id = ?',
    )
      .bind(scope.organizationId, scope.storeId, reservation.id)
      .first<{ start_at: string }>()
    expect(booking).toEqual({ start_at: '2026-08-31T01:00:00.000Z' })
    const claims = await env.DB.prepare(
      'SELECT id FROM reservation_resource_allocations WHERE organization_id = ? AND reservation_id = ?',
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ id: string }>()
    expect(claims.results).toHaveLength(180)
    const history = await env.DB.prepare(
      'SELECT id FROM reservation_changes WHERE organization_id = ? AND reservation_id = ?',
    )
      .bind(scope.organizationId, reservation.id)
      .all<{ id: string }>()
    expect(history.results).toEqual([])
    const idempotency = await env.DB.prepare(
      'SELECT status FROM idempotency_records WHERE organization_id = ? AND operation = ? AND key = ?',
    )
      .bind(scope.organizationId, `reservation_change:${scope.storeId}`, 'change-audit-failure')
      .first<{ status: string }>()
    expect(idempotency).toEqual({ status: 'in_progress' })
    const retry = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations/${reservation.id}`,
      auth(scope.token, {
        method: 'PATCH',
        headers: { 'idempotency-key': 'change-audit-failure' },
        body: JSON.stringify({
          version: reservation.version,
          date: '2026-08-31',
          startTime: '11:00',
          purposeIds: [purposeId],
          reason: '時間変更',
        }),
      }),
    )
    expect(retry.status).toBe(409)
    await expect(retry.json()).resolves.toEqual({ error: 'idempotency_in_progress' })
  })
})
