import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const INTERNAL_HEADERS = {
  'content-type': 'application/json',
  'x-internal-key': 'dev-internal-key',
}
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

async function setupTerminal() {
  const organizationId = uuid()
  const storeId = uuid()
  const managerId = uuid()
  for (const [path, body] of [
    [
      '/api/internal/organizations/sync',
      {
        id: organizationId,
        name: '共有日常業務組織',
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
        name: '共有日常業務店舗',
        slug: `shared-daily-${uuid().slice(0, 8)}`,
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
        userId: managerId,
        permissions: ['terminal.manage'],
        createdAt: '2026-08-31T00:00:00.000Z',
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
  const managerToken = await signAccessToken(
    { sub: managerId, org: organizationId, email: `${uuid()}@example.test`, role: 'staff' },
    'dev-jwt-secret-change-me',
  )
  const created = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/shared-terminals`,
    auth(managerToken, {
      method: 'POST',
      body: JSON.stringify({ name: '共有受付iPad' }),
    }),
  )
  expect(created.status).toBe(201)
  const issued = (await created.json()) as { terminal: { id: string }; token: string }
  return { organizationId, storeId, managerId, ...issued }
}

describe('shared-terminal daily-operation boundary', () => {
  it('permits only selected-store ledger reads and rejects settings access', async () => {
    const terminal = await setupTerminal()
    const headers = { 'x-shared-terminal-token': terminal.token }
    const ledger = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${terminal.storeId}/ledger?date=2026-08-31`,
      { headers },
    )
    expect(ledger.status).toBe(200)
    await expect(ledger.json()).resolves.toEqual([])

    const settings = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${terminal.storeId}/availability/settings`,
      { headers },
    )
    expect(settings.status).toBe(403)
    await expect(settings.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('records a walk-in as a shared-terminal action in its selected store', async () => {
    const terminal = await setupTerminal()
    const created = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${terminal.storeId}/walkins`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shared-terminal-token': terminal.token },
        body: '{}',
      },
    )
    expect(created.status).toBe(201)
    const walkin = (await created.json()) as { id: string }
    const audit = await env.DB.prepare(
      "SELECT actor_type, actor_id FROM audit_events WHERE entity_type = 'walkin' AND entity_id = ?",
    )
      .bind(walkin.id)
      .first<{ actor_type: string; actor_id: string }>()
    expect(audit).toEqual({ actor_type: 'shared_terminal', actor_id: terminal.terminal.id })
  })

  it('allows a shared terminal to update its walk-in reception progress and audits the terminal actor', async () => {
    const terminal = await setupTerminal()
    const headers = {
      'content-type': 'application/json',
      'x-shared-terminal-token': terminal.token,
    }
    const created = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${terminal.storeId}/walkins`,
      { method: 'POST', headers, body: '{}' },
    )
    const walkin = (await created.json()) as { id: string; version: number }

    const progressed = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${terminal.storeId}/walkins/${walkin.id}/progress`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ version: walkin.version, progress: 'service_in_progress' }),
      },
    )

    expect(progressed.status).toBe(200)
    const audit = await env.DB.prepare(
      "SELECT actor_type, actor_id FROM audit_events WHERE action = 'walkin.progress_updated' AND entity_id = ?",
    )
      .bind(walkin.id)
      .first<{ actor_type: string; actor_id: string }>()
    expect(audit).toEqual({ actor_type: 'shared_terminal', actor_id: terminal.terminal.id })
  })

  it('allows a shared terminal to update selected-store reservation reception progress and audits the terminal actor', async () => {
    const terminal = await setupTerminal()
    const reservationId = uuid()
    await env.DB.prepare(
      `INSERT INTO reservations (
        id, organization_id, store_id, reservation_number, source, status, start_at, end_at, purpose_ids_json,
        customer_id, customer_name, customer_kana, customer_phone, customer_phone_normalized, customer_email,
        recital, reservation_memo, handoff_note, progress, wait_started_at, assigned_staff_id,
        assigned_equipment_ids_json, next_guidance, progress_operation_id, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        reservationId,
        terminal.organizationId,
        terminal.storeId,
        `EYEX-${uuid().slice(0, 8)}`,
        'staff',
        'confirmed',
        '2026-08-31T01:00:00.000Z',
        '2026-08-31T02:00:00.000Z',
        '[]',
        null,
        '予約 顧客',
        'ヨヤク コキャク',
        '09012345678',
        '09012345678',
        null,
        '受付用',
        null,
        null,
        null,
        null,
        null,
        '[]',
        null,
        null,
        1,
        '2026-08-31T00:00:00.000Z',
        '2026-08-31T00:00:00.000Z',
      )
      .run()
    const progressed = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${terminal.storeId}/reservations/${reservationId}/progress`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-shared-terminal-token': terminal.token },
        body: JSON.stringify({ version: 1, progress: 'waiting' }),
      },
    )
    expect(progressed.status).toBe(200)
    const audit = await env.DB.prepare(
      "SELECT actor_type, actor_id FROM audit_events WHERE action = 'reservation.progress_updated' AND entity_id = ?",
    )
      .bind(reservationId)
      .first<{ actor_type: string; actor_id: string }>()
    expect(audit).toEqual({ actor_type: 'shared_terminal', actor_id: terminal.terminal.id })
  })

  it('links a walk-in customer through the shared-only route and audits the terminal actor', async () => {
    const terminal = await setupTerminal()
    const headers = {
      'content-type': 'application/json',
      'x-shared-terminal-token': terminal.token,
    }
    const customerId = uuid()
    await env.DB.prepare(
      'INSERT INTO customers (id, organization_id, primary_store_id, name, kana, phone_normalized, email, visit_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        customerId,
        terminal.organizationId,
        terminal.storeId,
        '顧客',
        'コキャク',
        '09012345678',
        null,
        0,
        '2026-08-31T00:00:00.000Z',
        '2026-08-31T00:00:00.000Z',
      )
      .run()
    const created = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${terminal.storeId}/walkins`,
      { method: 'POST', headers, body: '{}' },
    )
    const walkin = (await created.json()) as { id: string; version: number }

    const linked = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${terminal.storeId}/walkins/${walkin.id}/customer`,
      { method: 'PATCH', headers, body: JSON.stringify({ version: walkin.version, customerId }) },
    )

    expect(linked.status).toBe(200)
    const audit = await env.DB.prepare(
      "SELECT actor_type, actor_id FROM audit_events WHERE action = 'walkin.customer_linked' AND entity_id = ?",
    )
      .bind(walkin.id)
      .first<{ actor_type: string; actor_id: string }>()
    expect(audit).toEqual({ actor_type: 'shared_terminal', actor_id: terminal.terminal.id })
  })

  it('creates and links a new customer through the shared-only route with a terminal audit actor', async () => {
    const terminal = await setupTerminal()
    const headers = {
      'content-type': 'application/json',
      'x-shared-terminal-token': terminal.token,
    }
    const created = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${terminal.storeId}/walkins`,
      { method: 'POST', headers, body: '{}' },
    )
    const walkin = (await created.json()) as { id: string; version: number }

    const linked = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${terminal.storeId}/walkins/${walkin.id}/customer`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          version: walkin.version,
          customer: { name: '新規顧客', kana: 'シンキコキャク', phone: '090-9876-5432' },
        }),
      },
    )

    expect(linked.status).toBe(200)
    const audit = await env.DB.prepare(
      "SELECT actor_type, actor_id FROM audit_events WHERE action = 'walkin.customer_created_and_linked' AND entity_id = ?",
    )
      .bind(walkin.id)
      .first<{ actor_type: string; actor_id: string }>()
    expect(audit).toEqual({ actor_type: 'shared_terminal', actor_id: terminal.terminal.id })
  })
})
