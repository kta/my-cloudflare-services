import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const INTERNAL_HEADERS = {
  'content-type': 'application/json',
  'x-internal-key': 'dev-internal-key',
}
const uuid = () => crypto.randomUUID()

async function setupScope(input: { organizationId?: string } = {}) {
  const organizationId = input.organizationId ?? uuid()
  const storeId = uuid()
  const subjectId = uuid()
  for (const [path, body] of [
    [
      '/api/internal/organizations/sync',
      {
        id: organizationId,
        name: 'ウォークイン組織',
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
        name: 'ウォークイン店舗',
        slug: `walkin-${uuid().slice(0, 8)}`,
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
        permissions: ['reservation.read', 'reservation.write', 'customer.read', 'customer.write'],
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
    subjectId,
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

describe('walk-in reception', () => {
  it('starts an anonymous walk-in with a daily provisional identifier and waiting progress', async () => {
    const scope = await setupScope()

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: JSON.stringify({}) }),
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      entryType: 'walkin',
      provisionalLabel: 'ウォークイン 1',
      customerId: null,
      progress: 'waiting',
    })
  })

  it('projects a walk-in onto the selected-store ledger for the same JST day', async () => {
    const scope = await setupScope()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: '{}' }),
    )
    const walkin = (await created.json()) as { id: string; arrivedAt: string }
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(walkin.arrivedAt))
    const ledger = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/ledger?date=${date}`,
      auth(scope.token),
    )
    expect(ledger.status).toBe(200)
    await expect(ledger.json()).resolves.toEqual([
      expect.objectContaining({
        id: walkin.id,
        entryType: 'walkin',
        customerId: null,
        progress: 'waiting',
      }),
    ])
  })

  it('uses the linked customer name in the ledger instead of the provisional label', async () => {
    const scope = await setupScope()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: '{}' }),
    )
    const walkin = (await created.json()) as { id: string; version: number; arrivedAt: string }
    const customerId = uuid()
    await env.DB.prepare(
      `INSERT INTO customers (id, organization_id, primary_store_id, name, kana, phone_normalized, email, visit_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        customerId,
        scope.organizationId,
        scope.storeId,
        '台帳 顧客',
        'ダイチョウ コキャク',
        '09012344321',
        null,
        0,
        '2026-08-26T00:00:00.000Z',
        '2026-08-26T00:00:00.000Z',
      )
      .run()
    const linked = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: walkin.version, customerId }),
      }),
    )
    expect(linked.status).toBe(200)
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(walkin.arrivedAt))
    const ledger = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/ledger?date=${date}`,
      auth(scope.token),
    )
    await expect(ledger.json()).resolves.toEqual([
      expect.objectContaining({ id: walkin.id, customerId, customerName: '台帳 顧客' }),
    ])
  })

  it('has an append-only event history for walk-in customer and progress changes', async () => {
    const table = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'walkin_events'",
    ).first<{ name: string }>()
    expect(table).toEqual({ name: 'walkin_events' })
  })

  it('links an anonymous walk-in to an existing customer in the selected store', async () => {
    const scope = await setupScope()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: JSON.stringify({}) }),
    )
    const walkin = (await created.json()) as { id: string; version: number }
    const customerId = uuid()
    await env.DB.prepare(
      `INSERT INTO customers (id, organization_id, primary_store_id, name, kana, phone_normalized, email, visit_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        customerId,
        scope.organizationId,
        scope.storeId,
        '既存 顧客',
        'キソン コキャク',
        '09011112222',
        null,
        1,
        '2026-08-26T00:00:00.000Z',
        '2026-08-26T00:00:00.000Z',
      )
      .run()

    const linked = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: walkin.version, customerId }),
      }),
    )

    expect(linked.status).toBe(200)
    await expect(linked.json()).resolves.toMatchObject({
      id: walkin.id,
      customerId,
      version: walkin.version + 1,
    })
    const customerAfterLink = await env.DB.prepare('SELECT visit_count FROM customers WHERE id = ?')
      .bind(customerId)
      .first<{ visit_count: number }>()
    expect(customerAfterLink).toEqual({ visit_count: 2 })
    const relink = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: walkin.version + 1, customerId }),
      }),
    )
    expect(relink.status).toBe(409)
    await expect(relink.json()).resolves.toEqual({
      error: 'walkin_customer_already_linked',
      currentVersion: walkin.version + 1,
    })
    const customerAfterRelink = await env.DB.prepare(
      'SELECT visit_count FROM customers WHERE id = ?',
    )
      .bind(customerId)
      .first<{ visit_count: number }>()
    expect(customerAfterRelink).toEqual({ visit_count: 2 })
    const stale = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: walkin.version, customerId }),
      }),
    )
    expect(stale.status).toBe(409)
    const events = await env.DB.prepare(
      'SELECT event_type, from_customer_id, to_customer_id, version FROM walkin_events WHERE organization_id = ? AND walkin_id = ? ORDER BY occurred_at',
    )
      .bind(scope.organizationId, walkin.id)
      .all<{
        event_type: string
        from_customer_id: string | null
        to_customer_id: string | null
        version: number
      }>()
    expect(events.results).toContainEqual({
      event_type: 'customer_linked',
      from_customer_id: null,
      to_customer_id: customerId,
      version: 2,
    })
  })

  it('creates and links a new customer after walk-in reception', async () => {
    const scope = await setupScope()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: JSON.stringify({}) }),
    )
    const walkin = (await created.json()) as { id: string; version: number }

    const linked = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: walkin.version,
          customer: {
            name: '新規 顧客',
            kana: 'シンキ コキャク',
            phone: '090-3333-4444',
            email: 'new@example.test',
          },
        }),
      }),
    )

    expect(linked.status).toBe(200)
    const body = (await linked.json()) as { customerId: string; version: number }
    expect(body.customerId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.version).toBe(walkin.version + 1)
    const customer = await env.DB.prepare(
      'SELECT name, phone_normalized, visit_count FROM customers WHERE id = ?',
    )
      .bind(body.customerId)
      .first<{ name: string; phone_normalized: string; visit_count: number }>()
    expect(customer).toEqual({ name: '新規 顧客', phone_normalized: '09033334444', visit_count: 1 })
    const audit = await env.DB.prepare(
      "SELECT metadata FROM audit_events WHERE organization_id = ? AND entity_id = ? AND action = 'walkin.customer_created_and_linked'",
    )
      .bind(scope.organizationId, walkin.id)
      .first<{ metadata: string }>()
    expect(audit).toEqual({
      metadata: JSON.stringify({ customerId: body.customerId, version: walkin.version + 1 }),
    })
  })

  it('does not link a same-organization customer from another store by submitted phone', async () => {
    const scope = await setupScope()
    const otherStoreId = uuid()
    await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({
        id: otherStoreId,
        organizationId: scope.organizationId,
        name: '別店舗',
        slug: `other-${uuid().slice(0, 8)}`,
        isActive: true,
        createdAt: '2026-08-26T00:00:00.000Z',
      }),
    })
    const customerId = uuid()
    await env.DB.prepare(
      `INSERT INTO customers (id, organization_id, primary_store_id, name, kana, phone_normalized, email, visit_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        customerId,
        scope.organizationId,
        otherStoreId,
        '他店 顧客',
        'タテン コキャク',
        '09077778888',
        null,
        4,
        '2026-08-26T00:00:00.000Z',
        '2026-08-26T00:00:00.000Z',
      )
      .run()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: '{}' }),
    )
    const walkin = (await created.json()) as { id: string; version: number }

    const linked = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: walkin.version,
          customer: { name: '入力名は採用しない', kana: 'ニュウリョク', phone: '090-7777-8888' },
        }),
      }),
    )

    expect(linked.status).toBe(403)
    const customer = await env.DB.prepare('SELECT name, visit_count FROM customers WHERE id = ?')
      .bind(customerId)
      .first<{ name: string; visit_count: number }>()
    expect(customer).toEqual({ name: '他店 顧客', visit_count: 4 })
  })

  it('retains an unregistered departed walk-in in the selected-store list', async () => {
    const scope = await setupScope()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: JSON.stringify({}) }),
    )
    const walkin = (await created.json()) as { id: string; version: number }
    const departed = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: walkin.version, progress: 'departed' }),
      }),
    )

    expect(departed.status).toBe(200)
    const list = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins?status=departed`,
      auth(scope.token),
    )
    expect(list.status).toBe(200)
    await expect(list.json()).resolves.toEqual([
      expect.objectContaining({
        id: walkin.id,
        customerId: null,
        progress: 'departed',
        status: 'departed',
      }),
    ])
    const restored = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: walkin.version + 1, progress: 'waiting' }),
      }),
    )
    expect(restored.status).toBe(409)
  })

  it('rejects invalid customer association and stale walk-in versions without changing the record', async () => {
    const scope = await setupScope()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: '{}' }),
    )
    const walkin = (await created.json()) as { id: string; version: number }
    const foreign = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: walkin.version, customerId: uuid() }),
      }),
    )
    expect(foreign.status).toBe(403)
    const invalidPhone = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: walkin.version,
          customer: { name: '不正', kana: 'フセイ', phone: 'abc' },
        }),
      }),
    )
    expect(invalidPhone.status).toBe(400)
    const stale = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/progress`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ version: walkin.version + 1, progress: 'departed' }),
      }),
    )
    expect(stale.status).toBe(409)
    const active = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins?status=active`,
      auth(scope.token),
    )
    await expect(active.json()).resolves.toEqual([
      expect.objectContaining({ id: walkin.id, version: walkin.version }),
    ])
    const all = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token),
    )
    await expect(all.json()).resolves.toEqual([expect.objectContaining({ id: walkin.id })])
  })

  it('creates a new customer without an optional email address', async () => {
    const scope = await setupScope()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: '{}' }),
    )
    const walkin = (await created.json()) as { id: string; version: number }
    const linked = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: walkin.version,
          customer: { name: 'メールなし', kana: 'メールナシ', phone: '09055556666' },
        }),
      }),
    )
    expect(linked.status).toBe(200)
  })

  it('finds a selected-store customer by a partial name or kana for later walk-in association', async () => {
    const scope = await setupScope()
    const customerId = uuid()
    await env.DB.prepare(
      'INSERT INTO customers (id, organization_id, primary_store_id, name, kana, phone_normalized, email, visit_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        customerId,
        scope.organizationId,
        scope.storeId,
        '山田 花子',
        'ヤマダ ハナコ',
        '09044445555',
        null,
        1,
        '2026-08-26T00:00:00.000Z',
        '2026-08-26T00:00:00.000Z',
      )
      .run()
    const byName = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/customers?name=花`,
      auth(scope.token),
    )
    const byKana = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/customers?kana=ヤマ`,
      auth(scope.token),
    )
    expect(byName.status).toBe(200)
    expect(byKana.status).toBe(200)
    await expect(byName.json()).resolves.toEqual([expect.objectContaining({ id: customerId })])
    await expect(byKana.json()).resolves.toEqual([expect.objectContaining({ id: customerId })])
  })

  it('requires the selected-store reservation permissions for walk-in reads and writes', async () => {
    const scope = await setupScope()
    await env.DB.prepare(
      'UPDATE store_memberships SET permissions = ? WHERE organization_id = ? AND store_id = ? AND user_id = ?',
    )
      .bind('[]', scope.organizationId, scope.storeId, scope.subjectId)
      .run()
    const read = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token),
    )
    expect(read.status).toBe(403)
    const write = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: '{}' }),
    )
    expect(write.status).toBe(403)
  })

  it('assigns distinct provisional identifiers to simultaneous walk-ins', async () => {
    const scope = await setupScope()
    const create = () =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
        auth(scope.token, { method: 'POST', body: '{}' }),
      )
    const responses = await Promise.all([create(), create()])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 201])
    const labels = await Promise.all(
      responses.map(
        async (response) =>
          ((await response.json()) as { provisionalLabel: string }).provisionalLabel,
      ),
    )
    expect(labels.sort()).toEqual(['ウォークイン 1', 'ウォークイン 2'])
  })

  it('accepts ten simultaneous walk-ins with distinct daily identifiers', async () => {
    const scope = await setupScope()
    const create = () =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
        auth(scope.token, { method: 'POST', body: '{}' }),
      )

    const responses = await Promise.all(Array.from({ length: 10 }, create))

    expect(responses.map((response) => response.status)).toEqual(
      Array.from({ length: 10 }, () => 201),
    )
    const labels = await Promise.all(
      responses.map(
        async (response) =>
          ((await response.json()) as { provisionalLabel: string }).provisionalLabel,
      ),
    )
    expect(new Set(labels)).toHaveLength(10)
  })

  it('continues a legacy daily sequence when no allocator row exists yet', async () => {
    const scope = await setupScope()
    const serviceDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    await env.DB.prepare(
      `INSERT INTO walkins (
        id, organization_id, store_id, service_date, sequence, customer_id, status, progress,
        arrived_at, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        uuid(),
        scope.organizationId,
        scope.storeId,
        serviceDate,
        9,
        null,
        'active',
        'waiting',
        '2026-08-31T01:00:00.000Z',
        1,
        '2026-08-31T01:00:00.000Z',
        '2026-08-31T01:00:00.000Z',
      )
      .run()

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: '{}' }),
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ provisionalLabel: 'ウォークイン 10' })
  })

  it('does not create a customer when a concurrent new-customer link loses its walk-in CAS', async () => {
    const scope = await setupScope()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
      auth(scope.token, { method: 'POST', body: '{}' }),
    )
    const walkin = (await created.json()) as { id: string; version: number }
    const link = (phone: string) =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
        auth(scope.token, {
          method: 'PATCH',
          body: JSON.stringify({
            version: walkin.version,
            customer: { name: phone, kana: 'ドウジ', phone },
          }),
        }),
      )
    const responses = await Promise.all([link('09070000001'), link('09070000002')])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const conflict = responses.find((response) => response.status === 409)
    expect(conflict).toBeDefined()
    await expect(conflict?.json()).resolves.toEqual({
      error: 'version_conflict',
      currentVersion: walkin.version + 1,
    })
    const customers = await env.DB.prepare(
      'SELECT phone_normalized FROM customers WHERE organization_id = ? AND phone_normalized IN (?, ?)',
    )
      .bind(scope.organizationId, '09070000001', '09070000002')
      .all<{ phone_normalized: string }>()
    expect(customers.results).toHaveLength(1)
  })

  it('links both walk-ins when simultaneous new-customer submissions use the same phone', async () => {
    const scope = await setupScope()
    const createWalkin = () =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/walkins`,
        auth(scope.token, { method: 'POST', body: '{}' }),
      )
    const created = await Promise.all([createWalkin(), createWalkin()])
    const walkins = await Promise.all(
      created.map(async (response) => response.json() as Promise<{ id: string; version: number }>),
    )
    const link = (walkin: { id: string; version: number }) =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
        auth(scope.token, {
          method: 'PATCH',
          body: JSON.stringify({
            version: walkin.version,
            customer: { name: '同一 電話', kana: 'ドウイツ デンワ', phone: '090-8888-9999' },
          }),
        }),
      )

    const responses = await Promise.all(walkins.map(link))

    expect(responses.map((response) => response.status).sort()).toEqual([200, 200])
    const customers = await env.DB.prepare(
      'SELECT id, visit_count FROM customers WHERE organization_id = ? AND phone_normalized = ?',
    )
      .bind(scope.organizationId, '09088889999')
      .all<{ id: string; visit_count: number }>()
    expect(customers.results).toHaveLength(1)
    expect(customers.results[0]?.visit_count).toBe(2)
  })

  it('returns forbidden instead of leaking a server error for simultaneous other-store new-customer input', async () => {
    const firstStore = await setupScope()
    const secondStore = await setupScope({ organizationId: firstStore.organizationId })
    const create = (storeId: string, token: string) =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${storeId}/walkins`,
        auth(token, { method: 'POST', body: '{}' }),
      )
    const [firstCreated, secondCreated] = await Promise.all([
      create(firstStore.storeId, firstStore.token),
      create(secondStore.storeId, secondStore.token),
    ])
    const firstWalkin = (await firstCreated.json()) as { id: string; version: number }
    const secondWalkin = (await secondCreated.json()) as { id: string; version: number }
    const link = (
      scope: Awaited<ReturnType<typeof setupScope>>,
      walkin: { id: string; version: number },
    ) =>
      SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/walkins/${walkin.id}/customer`,
        auth(scope.token, {
          method: 'PATCH',
          body: JSON.stringify({
            version: walkin.version,
            customer: { name: '店舗競合', kana: 'テンポキョウゴウ', phone: '090-7777-8888' },
          }),
        }),
      )

    const responses = await Promise.all([
      link(firstStore, firstWalkin),
      link(secondStore, secondWalkin),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 403])
  })
})
