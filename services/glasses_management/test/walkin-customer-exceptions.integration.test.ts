import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const JWT_SECRET = 'dev-jwt-secret-change-me'
const INTERNAL_HEADERS = {
  'content-type': 'application/json',
  'x-internal-key': 'dev-internal-key',
}
/** The suite is bound to a fixed clock so no assertion depends on the real wall time. */
const TEST_CLOCK_NOW = '2026-08-31T00:00:00.000Z'
const ALL_PERMISSIONS = [
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.write',
  'terminal.manage',
] as const

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

async function sync(path: string, body: unknown) {
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

/**
 * One organization + one store + one staff membership. Permissions are explicit so a
 * test can prove a single missing permission is what produces the 403.
 */
async function setupScope(
  input: { organizationId?: string; permissions?: readonly string[] } = {},
) {
  const organizationId = input.organizationId ?? uuid()
  const storeId = uuid()
  const subjectId = uuid()
  await sync('/api/internal/organizations/sync', {
    id: organizationId,
    name: 'ウォークイン例外組織',
    plan: 'free',
    isDisabled: false,
    createdAt: TEST_CLOCK_NOW,
  })
  await sync('/api/internal/stores/sync', {
    id: storeId,
    organizationId,
    name: 'ウォークイン例外店舗',
    slug: `walkin-exc-${uuid().slice(0, 8)}`,
    isActive: true,
    createdAt: TEST_CLOCK_NOW,
  })
  await sync('/api/internal/store-memberships/sync', {
    id: uuid(),
    organizationId,
    storeId,
    userId: subjectId,
    permissions: [...(input.permissions ?? ALL_PERMISSIONS)],
    createdAt: TEST_CLOCK_NOW,
  })
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

async function createWalkin(scope: { storeId: string; token: string }) {
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
    auth(scope.token, { method: 'POST', body: '{}' }),
  )
  expect(response.status).toBe(201)
  return (await response.json()) as { id: string; version: number; arrivedAt: string }
}

async function issueTerminal(scope: { storeId: string; token: string }) {
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${scope.storeId}/shared-terminals`,
    auth(scope.token, { method: 'POST', body: JSON.stringify({ name: '例外検証iPad' }) }),
  )
  expect(response.status).toBe(201)
  return (await response.json()) as { terminal: { id: string }; token: string }
}

function terminalHeaders(token: string): RequestInit {
  return { headers: { 'content-type': 'application/json', 'x-shared-terminal-token': token } }
}

function jstDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

describe('walk-in customer linking exceptions', () => {
  it('hides another store walk-in behind the same forbidden response on every mutation', async () => {
    // A leaked walk-in id from a sibling store must be indistinguishable from a non-existent
    // one, otherwise the 403/404 difference alone would confirm the record exists.
    const owner = await setupScope()
    const outsider = await setupScope({ organizationId: owner.organizationId })
    const walkin = await createWalkin(owner)
    const target = `${BASE}/api/staff/stores/${outsider.storeId}/walkins/${walkin.id}`
    const unknown = `${BASE}/api/staff/stores/${outsider.storeId}/walkins/${uuid()}`

    const responses = await Promise.all([
      SELF.fetch(
        `${target}/progress`,
        auth(outsider.token, {
          method: 'PATCH',
          body: JSON.stringify({ version: walkin.version, progress: 'departed' }),
        }),
      ),
      SELF.fetch(
        `${target}/customer`,
        auth(outsider.token, {
          method: 'PATCH',
          body: JSON.stringify({ version: walkin.version, customerId: uuid() }),
        }),
      ),
      SELF.fetch(
        `${target}/customer`,
        auth(outsider.token, {
          method: 'PATCH',
          body: JSON.stringify({
            version: walkin.version,
            customer: { name: '越境 太郎', kana: 'エッキョウ タロウ', phone: '090-1111-0001' },
          }),
        }),
      ),
      SELF.fetch(
        `${unknown}/progress`,
        auth(outsider.token, {
          method: 'PATCH',
          body: JSON.stringify({ version: 1, progress: 'departed' }),
        }),
      ),
    ])

    for (const response of responses) {
      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
    }
    // The owning store's record must be untouched by the rejected cross-store attempts.
    const stored = await env.DB.prepare(
      'SELECT version, progress, customer_id FROM walkins WHERE id = ?',
    )
      .bind(walkin.id)
      .first<{ version: number; progress: string; customer_id: string | null }>()
    expect(stored).toEqual({ version: walkin.version, progress: 'waiting', customer_id: null })
  })

  it('hides a walk-in owned by another organization behind the same forbidden response', async () => {
    // Tenant isolation: the JWT org scopes every query, so a foreign-tenant id resolves to
    // nothing rather than to a cross-tenant write.
    const owner = await setupScope()
    const otherTenant = await setupScope()
    const walkin = await createWalkin(owner)

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${otherTenant.storeId}/walkins/${walkin.id}/customer`,
      auth(otherTenant.token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: walkin.version,
          customer: { name: '他社 花子', kana: 'タシャ ハナコ', phone: '090-1111-0002' },
        }),
      }),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
    const created = await env.DB.prepare(
      'SELECT count(*) AS total FROM customers WHERE phone_normalized = ?',
    )
      .bind('09011110002')
      .first<{ total: number }>()
    expect(created).toEqual({ total: 0 })
  })

  it('requires the selected-store customer permission for walk-in customer linking', async () => {
    // customer.write is checked separately from reservation.write: a reception-only member
    // may move a walk-in along but must not attach or create customer records.
    const scope = await setupScope({ permissions: ['reservation.read', 'reservation.write'] })
    const walkin = await createWalkin(scope)

    const link = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: walkin.version, customerId: uuid() }),
      }),
    )
    const search = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/customers?name=検索`,
      auth(scope.token),
    )

    expect(link.status).toBe(403)
    await expect(link.json()).resolves.toEqual({ error: 'forbidden' })
    expect(search.status).toBe(403)
    await expect(search.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('requires the selected-store reservation permission for walk-in progress updates', async () => {
    // A customer-desk member without reservation.write must not advance the reception queue.
    const owner = await setupScope()
    const walkin = await createWalkin(owner)
    await env.DB.prepare(
      'UPDATE store_memberships SET permissions = ? WHERE organization_id = ? AND store_id = ? AND user_id = ?',
    )
      .bind(
        '["customer.read","customer.write"]',
        owner.organizationId,
        owner.storeId,
        owner.subjectId,
      )
      .run()

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${owner.storeId}/walkins/${walkin.id}/progress`,
      auth(owner.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: walkin.version, progress: 'service_in_progress' }),
      }),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('reports the current version when a new-customer submission carries a stale walk-in version', async () => {
    // Two receptionists on one walk-in: the loser must learn the version to retry with instead
    // of silently creating a duplicate customer.
    const scope = await setupScope()
    const walkin = await createWalkin(scope)
    const advanced = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: walkin.version, progress: 'service_in_progress' }),
      }),
    )
    expect(advanced.status).toBe(200)

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: walkin.version,
          customer: { name: '陳腐 版', kana: 'チンプ バン', phone: '090-1111-0003' },
        }),
      }),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'version_conflict',
      currentVersion: walkin.version + 1,
    })
    const created = await env.DB.prepare(
      'SELECT count(*) AS total FROM customers WHERE phone_normalized = ?',
    )
      .bind('09011110003')
      .first<{ total: number }>()
    expect(created).toEqual({ total: 0 })
  })

  it('rejects a customer phone with fewer than seven digits before touching the walk-in', async () => {
    // The contract only bounds the raw string length, so a punctuation-padded short number
    // reaches the handler and must be refused on its normalized digits.
    const scope = await setupScope()
    const walkin = await createWalkin(scope)

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: walkin.version,
          customer: { name: '短い 番号', kana: 'ミジカイ バンゴウ', phone: '03-1234' },
        }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_customer_phone' })
    const stored = await env.DB.prepare('SELECT version, customer_id FROM walkins WHERE id = ?')
      .bind(walkin.id)
      .first<{ version: number; customer_id: string | null }>()
    expect(stored).toEqual({ version: walkin.version, customer_id: null })
  })

  it('returns an empty candidate list when a phone search normalizes to no digits', async () => {
    // A receptionist typing only separators must get a clean empty result, not a prefix
    // search on the empty string that would dump the whole store customer book.
    const scope = await setupScope()
    const customerId = uuid()
    await env.DB.prepare(
      `INSERT INTO customers (id, organization_id, primary_store_id, name, kana, phone_normalized, email, visit_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        customerId,
        scope.organizationId,
        scope.storeId,
        '空 検索',
        'カラ ケンサク',
        '09011110004',
        null,
        1,
        TEST_CLOCK_NOW,
        TEST_CLOCK_NOW,
      )
      .run()

    const blank = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/customers?phone=${encodeURIComponent('--(-)')}`,
      auth(scope.token),
    )
    const real = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/customers?phone=0901111`,
      auth(scope.token),
    )

    expect(blank.status).toBe(200)
    await expect(blank.json()).resolves.toEqual([])
    expect(real.status).toBe(200)
    await expect(real.json()).resolves.toEqual([expect.objectContaining({ id: customerId })])
  })

  it('stops counting wait time once a walk-in leaves the waiting queue', async () => {
    // waitStartedAt drives the long-wait warning; a walk-in already being served must not
    // keep accruing wait time on the ledger.
    const scope = await setupScope()
    const walkin = await createWalkin(scope)
    const advanced = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: walkin.version, progress: 'service_in_progress' }),
      }),
    )
    expect(advanced.status).toBe(200)

    const ledger = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/ledger?date=${jstDate(walkin.arrivedAt)}`,
      auth(scope.token),
    )

    expect(ledger.status).toBe(200)
    await expect(ledger.json()).resolves.toEqual([
      expect.objectContaining({
        id: walkin.id,
        entryType: 'walkin',
        progress: 'service_in_progress',
        waitStartedAt: null,
      }),
    ])
  })

  it('recovers a version conflict, not a terminal error, when two terminal reception updates race', async () => {
    // A shared terminal re-proves itself inside the mutation CAS. When that CAS writes no rows
    // the handler must first rule out a device problem and only then report the real cause,
    // so a healthy terminal losing a race still gets an actionable version to retry with.
    const scope = await setupScope()
    const issued = await issueTerminal(scope)
    const created = await SELF.fetch(
      `${BASE}/api/shared-terminals/${issued.terminal.id}/stores/${scope.storeId}/walkins`,
      { method: 'POST', body: '{}', ...terminalHeaders(issued.token) },
    )
    expect(created.status).toBe(201)
    const walkin = (await created.json()) as { id: string; version: number }
    const patch = (progress: string) =>
      SELF.fetch(
        `${BASE}/api/shared-terminals/${issued.terminal.id}/stores/${scope.storeId}/walkins/${walkin.id}/progress`,
        {
          method: 'PATCH',
          body: JSON.stringify({ version: walkin.version, progress }),
          ...terminalHeaders(issued.token),
        },
      )

    const responses = await Promise.all([patch('service_in_progress'), patch('service_completed')])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const conflict = responses.find((response) => response.status === 409)
    await expect(conflict?.json()).resolves.toEqual({
      error: 'version_conflict',
      currentVersion: walkin.version + 1,
    })
    // Exactly one update may commit, and the terminal must be recorded as its actor.
    const stored = await env.DB.prepare('SELECT version FROM walkins WHERE id = ?')
      .bind(walkin.id)
      .first<{ version: number }>()
    expect(stored).toEqual({ version: walkin.version + 1 })
    const actors = await env.DB.prepare(
      "SELECT actor_type, actor_id FROM audit_events WHERE organization_id = ? AND entity_id = ? AND action = 'walkin.progress_updated'",
    )
      .bind(scope.organizationId, walkin.id)
      .all<{ actor_type: string; actor_id: string }>()
    expect(actors.results).toEqual([
      { actor_type: 'shared_terminal', actor_id: issued.terminal.id },
    ])
  })

  it('links an existing customer from a shared terminal and rejects a stale retry', async () => {
    // The terminal write guard rides along with the customer-link CAS; a stale retry from the
    // same device must not double-count the customer visit.
    const scope = await setupScope()
    const issued = await issueTerminal(scope)
    const walkin = await createWalkin(scope)
    const customerId = uuid()
    await env.DB.prepare(
      `INSERT INTO customers (id, organization_id, primary_store_id, name, kana, phone_normalized, email, visit_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        customerId,
        scope.organizationId,
        scope.storeId,
        '端末 顧客',
        'タンマツ コキャク',
        '09011110005',
        null,
        1,
        TEST_CLOCK_NOW,
        TEST_CLOCK_NOW,
      )
      .run()
    const path = `${BASE}/api/shared-terminals/${issued.terminal.id}/stores/${scope.storeId}/walkins/${walkin.id}/customer`

    const linked = await SELF.fetch(path, {
      method: 'PATCH',
      body: JSON.stringify({ version: walkin.version, customerId }),
      ...terminalHeaders(issued.token),
    })
    const staleRetry = await SELF.fetch(path, {
      method: 'PATCH',
      body: JSON.stringify({ version: walkin.version, customerId }),
      ...terminalHeaders(issued.token),
    })

    expect(linked.status).toBe(200)
    await expect(linked.json()).resolves.toMatchObject({
      id: walkin.id,
      customerId,
      version: walkin.version + 1,
    })
    expect(staleRetry.status).toBe(409)
    await expect(staleRetry.json()).resolves.toEqual({
      error: 'walkin_customer_already_linked',
      currentVersion: walkin.version + 1,
    })
    const visits = await env.DB.prepare('SELECT visit_count FROM customers WHERE id = ?')
      .bind(customerId)
      .first<{ visit_count: number }>()
    expect(visits).toEqual({ visit_count: 2 })
  })
})
