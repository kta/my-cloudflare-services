import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const INJECTED_NOW = '2026-08-31T00:00:00.000Z'
const INJECTED_JST_DATE = '2026-08-31'
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
        name: '時刻注入組織',
        plan: 'free',
        isDisabled: false,
        createdAt: INJECTED_NOW,
      },
    ],
    [
      '/api/internal/stores/sync',
      {
        id: storeId,
        organizationId,
        name: '時刻注入店舗',
        slug: `clock-${uuid().slice(0, 8)}`,
        isActive: true,
        createdAt: INJECTED_NOW,
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
        createdAt: INJECTED_NOW,
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
    subjectId,
    token: await signAccessToken(
      { sub: subjectId, org: organizationId, email: `${uuid()}@example.test`, role: 'staff' },
      'dev-jwt-secret-change-me',
    ),
  }
}

/*
 * The repository rule is that time is always injected, never read from the wall
 * clock, because JST day boundaries decide which ledger and which reception
 * history a record belongs to. `TEST_CLOCK_NOW` is the injection point, and a
 * handler that reaches for the system clock instead silently writes rows onto
 * whatever day the machine happens to be on — which is invisible in production
 * and only surfaces as a flaky date filter. These tests pin that contract at
 * the HTTP boundary, where the regression would actually occur.
 */
describe('request clock injection', () => {
  it('stamps a walk-in with the injected instant rather than the wall clock', async () => {
    const scope = await setupScope()

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: '{}' }),
    )

    expect(response.status).toBe(201)
    const walkin = (await response.json()) as { id: string; arrivedAt: string }
    expect(walkin.arrivedAt).toBe(INJECTED_NOW)
  })

  it('places a freshly created walk-in on the injected JST day ledger', async () => {
    const scope = await setupScope()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: '{}' }),
    )
    const walkin = (await created.json()) as { id: string }

    const ledger = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/ledger?date=${INJECTED_JST_DATE}`,
      auth(scope.token),
    )

    expect(ledger.status).toBe(200)
    await expect(ledger.json()).resolves.toEqual([expect.objectContaining({ id: walkin.id })])
  })

  it('records the audit trail of a walk-in at the injected instant', async () => {
    const scope = await setupScope()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: '{}' }),
    )
    const walkin = (await created.json()) as { id: string }

    const audit = await env.DB.prepare(
      'SELECT occurred_at FROM audit_events WHERE entity_id = ? ORDER BY occurred_at',
    )
      .bind(walkin.id)
      .all<{ occurred_at: string }>()

    expect(audit.results.length).toBeGreaterThan(0)
    for (const row of audit.results) expect(row.occurred_at).toBe(INJECTED_NOW)
  })

  it('answers the reception history for the injected day with the events just written', async () => {
    const scope = await setupScope()
    await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: '{}' }),
    )

    const history = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reception-history?date=${INJECTED_JST_DATE}`,
      auth(scope.token),
    )

    expect(history.status).toBe(200)
    const entries = (await history.json()) as unknown[]
    expect(entries.length).toBeGreaterThan(0)
  })
})
