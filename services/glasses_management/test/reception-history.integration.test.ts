import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const uuid = () => crypto.randomUUID()

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

async function setupScope() {
  const organizationId = uuid()
  const storeId = uuid()
  const subjectId = uuid()
  const internalHeaders = {
    'content-type': 'application/json',
    'x-internal-key': 'dev-internal-key',
  }
  for (const [path, body] of [
    [
      '/api/internal/organizations/sync',
      {
        id: organizationId,
        name: '受付履歴組織',
        plan: 'free',
        isDisabled: false,
        createdAt: '2026-08-31T00:00:00.000Z',
      },
    ],
    [
      '/api/internal/stores/sync',
      {
        id: storeId,
        organizationId,
        name: '受付履歴店舗',
        slug: `history-${uuid().slice(0, 8)}`,
        isActive: true,
        createdAt: '2026-08-31T00:00:00.000Z',
      },
    ],
    [
      '/api/internal/store-memberships/sync',
      {
        id: uuid(),
        organizationId,
        storeId,
        userId: subjectId,
        permissions: ['reservation.read', 'reservation.write', 'customer.read', 'customer.write'],
        createdAt: '2026-08-31T00:00:00.000Z',
      },
    ],
  ] as const) {
    expect(
      (
        await SELF.fetch(`${BASE}${path}`, {
          method: 'POST',
          headers: internalHeaders,
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

describe('reception history', () => {
  it('lists an empty selected-store reception history', async () => {
    const scope = await setupScope()

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history`,
      auth(scope.token),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
  })

  // The lifecycle routes are covered in reservations/walkins integration tests.
  // This fixture isolates the history projection's chronological/filter behavior.
  it('projects created, changed, cancelled, no-show, and walk-in events in reverse chronology with filters', async () => {
    const scope = await setupScope()
    const reservationId = uuid()
    const walkinId = uuid()
    const actorId = uuid()
    await env.DB.prepare(
      `INSERT INTO reservations (
        id, organization_id, store_id, reservation_number, source, status, start_at, end_at,
        purpose_ids_json, customer_id, customer_name, customer_kana, customer_phone,
        customer_phone_normalized, customer_email, recital, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'staff', 'cancelled', ?, ?, '[]', NULL, ?, ?, ?, ?, NULL, ?, 2, ?, ?)`,
    )
      .bind(
        reservationId,
        scope.organizationId,
        scope.storeId,
        'EYEX-HISTORY-001',
        '2026-08-31T01:00:00.000Z',
        '2026-08-31T01:30:00.000Z',
        '履歴 花子',
        'リレキ ハナコ',
        '090-1234-5678',
        '09012345678',
        '復唱内容',
        '2026-08-31T00:00:00.000Z',
        '2026-08-31T00:00:00.000Z',
      )
      .run()
    await env.DB.prepare(
      `INSERT INTO walkins (
        id, organization_id, store_id, service_date, sequence, customer_id, status, progress,
        arrived_at, version, created_at, updated_at
      ) VALUES (?, ?, ?, '2026-08-31', 4, NULL, 'active', 'waiting', ?, 1, ?, ?)`,
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
    for (const [id, action, entityType, entityId, occurredAt] of [
      [uuid(), 'reservation.created', 'reservation', reservationId, '2026-08-31T00:00:00.000Z'],
      [uuid(), 'reservation.changed', 'reservation', reservationId, '2026-08-31T01:00:00.000Z'],
      [uuid(), 'reservation.cancelled', 'reservation', reservationId, '2026-08-31T02:00:00.000Z'],
      [uuid(), 'reservation.no_show', 'reservation', reservationId, '2026-08-31T02:30:00.000Z'],
      [uuid(), 'walkin.created', 'walkin', walkinId, '2026-08-31T03:00:00.000Z'],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO audit_events (
          id, organization_id, store_id, actor_type, actor_id, action, entity_type, entity_id, request_id, metadata, occurred_at
        ) VALUES (?, ?, ?, 'user', ?, ?, ?, ?, NULL, '{}', ?)`,
      )
        .bind(
          id,
          scope.organizationId,
          scope.storeId,
          actorId,
          action,
          entityType,
          entityId,
          occurredAt,
        )
        .run()
    }

    const history = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history?date=2026-08-31`,
      auth(scope.token),
    )
    expect(history.status).toBe(200)
    await expect(history.json()).resolves.toEqual([
      expect.objectContaining({
        action: 'walkin_created',
        source: 'walkin',
        recordingStatus: 'none',
        requiresAttention: false,
      }),
      expect.objectContaining({ action: 'no_show', source: 'staff', requiresAttention: true }),
      expect.objectContaining({
        action: 'cancelled',
        source: 'staff',
        customerName: '履歴 花子',
        requiresAttention: true,
      }),
      expect.objectContaining({
        action: 'changed',
        source: 'staff',
        reservationNumber: 'EYEX-HISTORY-001',
      }),
      expect.objectContaining({
        action: 'created',
        source: 'staff',
        customerPhone: '090-1234-5678',
      }),
    ])
    const attention = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history?requiresAttention=true`,
      auth(scope.token),
    )
    await expect(attention.json()).resolves.toEqual([
      expect.objectContaining({ action: 'no_show' }),
      expect.objectContaining({ action: 'cancelled' }),
    ])
    const phone = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history?phone=09012345678`,
      auth(scope.token),
    )
    await expect(phone.json()).resolves.toHaveLength(4)

    const invalidPhone = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history?phone=090123`,
      auth(scope.token),
    )
    expect(invalidPhone.status).toBe(400)
    await expect(invalidPhone.json()).resolves.toEqual({ error: 'invalid_reservation_phone' })

    const noNameMatch = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history?name=該当なし`,
      auth(scope.token),
    )
    expect(noNameMatch.status).toBe(200)
    await expect(noNameMatch.json()).resolves.toEqual([])
  })
})
