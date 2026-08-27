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
        name: '再認証組織',
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
        name: '再認証店舗',
        slug: `reauth-${uuid().slice(0, 8)}`,
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
    auth(managerToken, { method: 'POST', body: JSON.stringify({ name: '受付iPad' }) }),
  )
  expect(created.status).toBe(201)
  const issued = (await created.json()) as { terminal: { id: string }; token: string }
  return { organizationId, storeId, managerId, ...issued }
}

describe('shared-terminal personal reauthentication', () => {
  it('issues a terminal-bound opaque reauthentication token after admin verifies the PIN proof', async () => {
    const terminal = await setupTerminal()

    const response = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthenticate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shared-terminal-token': terminal.token },
        body: JSON.stringify({
          userId: terminal.managerId,
          stretchedPin: 'pin-proof-from-browser',
        }),
      },
    )

    expect(response.status).toBe(201)
    const issued = (await response.json()) as { token: string; expiresAt: string }
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(issued.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    const persisted = await env.DB.prepare(
      'SELECT token_hash, organization_id, store_id, terminal_id, user_id FROM shared_terminal_reauth_sessions WHERE terminal_id = ?',
    )
      .bind(terminal.terminal.id)
      .first<{
        token_hash: string
        organization_id: string
        store_id: string
        terminal_id: string
        user_id: string
      }>()
    expect(persisted).toMatchObject({
      organization_id: terminal.organizationId,
      store_id: terminal.storeId,
      terminal_id: terminal.terminal.id,
      user_id: terminal.managerId,
    })
    expect(persisted?.token_hash).not.toBe(issued.token)
    expect(persisted?.token_hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('requires a valid, current terminal and matching reauthentication grant on every privileged shared-terminal check', async () => {
    const terminal = await setupTerminal()
    const reauthenticated = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthenticate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shared-terminal-token': terminal.token },
        body: JSON.stringify({
          userId: terminal.managerId,
          stretchedPin: 'pin-proof-from-browser',
        }),
      },
    )
    const grant = (await reauthenticated.json()) as { token: string }

    const accepted = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthentication`,
      {
        headers: {
          'x-shared-terminal-token': terminal.token,
          'x-shared-terminal-reauth-token': grant.token,
        },
      },
    )
    expect(accepted.status).toBe(200)
    await expect(accepted.json()).resolves.toEqual({ authorized: true })

    const managerToken = await signAccessToken(
      {
        sub: terminal.managerId,
        org: terminal.organizationId,
        email: `${uuid()}@example.test`,
        role: 'staff',
      },
      'dev-jwt-secret-change-me',
    )
    await SELF.fetch(
      `${BASE}/api/staff/stores/${terminal.storeId}/shared-terminals/${terminal.terminal.id}/revoke`,
      auth(managerToken, { method: 'POST' }),
    )
    const revoked = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthentication`,
      {
        headers: {
          'x-shared-terminal-token': terminal.token,
          'x-shared-terminal-reauth-token': grant.token,
        },
      },
    )
    expect(revoked.status).toBe(401)
    await expect(revoked.json()).resolves.toEqual({ error: 'terminal_revoked' })
  })

  it('permits a terminal manager to revoke the current shared terminal only after PIN reauthentication and audits both actors', async () => {
    const terminal = await setupTerminal()
    const reauthenticated = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthenticate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shared-terminal-token': terminal.token },
        body: JSON.stringify({
          userId: terminal.managerId,
          stretchedPin: 'pin-proof-from-browser',
        }),
      },
    )
    const grant = (await reauthenticated.json()) as { token: string }

    const rejectedWithoutGrant = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/revoke`,
      { method: 'POST', headers: { 'x-shared-terminal-token': terminal.token } },
    )
    expect(rejectedWithoutGrant.status).toBe(401)

    const revoked = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/revoke`,
      {
        method: 'POST',
        headers: {
          'x-shared-terminal-token': terminal.token,
          'x-shared-terminal-reauth-token': grant.token,
        },
      },
    )
    expect(revoked.status).toBe(200)
    await expect(revoked.json()).resolves.toMatchObject({
      id: terminal.terminal.id,
      status: 'revoked',
    })
    const audit = await env.DB.prepare(
      "SELECT actor_type, actor_id, metadata FROM audit_events WHERE entity_id = ? AND action = 'shared_terminal.revoked' ORDER BY occurred_at DESC LIMIT 1",
    )
      .bind(terminal.terminal.id)
      .first<{ actor_type: string; actor_id: string; metadata: string }>()
    expect(audit).toMatchObject({ actor_type: 'shared_terminal', actor_id: terminal.terminal.id })
    expect(JSON.parse(audit?.metadata ?? '{}')).toEqual({
      reauthenticatedUserId: terminal.managerId,
    })
  })

  it('rejects a reauthentication grant when used from another terminal in the same store', async () => {
    const terminal = await setupTerminal()
    const managerToken = await signAccessToken(
      {
        sub: terminal.managerId,
        org: terminal.organizationId,
        email: `${uuid()}@example.test`,
        role: 'staff',
      },
      'dev-jwt-secret-change-me',
    )
    const otherCreated = await SELF.fetch(
      `${BASE}/api/staff/stores/${terminal.storeId}/shared-terminals`,
      auth(managerToken, { method: 'POST', body: JSON.stringify({ name: '別の受付iPad' }) }),
    )
    const other = (await otherCreated.json()) as { terminal: { id: string }; token: string }
    const reauthenticated = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthenticate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shared-terminal-token': terminal.token },
        body: JSON.stringify({
          userId: terminal.managerId,
          stretchedPin: 'pin-proof-from-browser',
        }),
      },
    )
    const grant = (await reauthenticated.json()) as { token: string }
    const mismatched = await SELF.fetch(
      `${BASE}/api/shared-terminals/${other.terminal.id}/reauthentication`,
      {
        headers: {
          'x-shared-terminal-token': other.token,
          'x-shared-terminal-reauth-token': grant.token,
        },
      },
    )
    expect(mismatched.status).toBe(403)
    await expect(mismatched.json()).resolves.toEqual({ error: 'reauth_scope_mismatch' })
  })
})

describe('a personal reauthentication grant is spent by the action it authorises', () => {
  it('refuses a second management action on the same grant', async () => {
    // The grant proves that a manager stood at the iPad and typed their PIN for
    // one action. Leaving it valid for the rest of its five minutes turns it
    // into a bearer capability over every management action on that terminal —
    // one PIN entry, unbounded authority (UC-EYEX-138, AC-EYEX-82).
    const terminal = await setupTerminal()
    const issued = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthenticate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shared-terminal-token': terminal.token },
        body: JSON.stringify({
          userId: terminal.managerId,
          stretchedPin: 'pin-proof-from-browser',
        }),
      },
    )
    expect(issued.status).toBe(201)
    const grant = ((await issued.json()) as { token: string }).token

    // 端末の失効そのものを二度は使えないので、同じグラントで別の管理操作を試す。
    const reauthentication = () =>
      SELF.fetch(`${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthentication`, {
        headers: {
          'x-shared-terminal-token': terminal.token,
          'x-shared-terminal-reauth-token': grant,
        },
      })

    const first = await reauthentication()
    expect(first.status).toBe(200)

    const second = await reauthentication()
    expect(second.status).toBe(401)
    await expect(second.json()).resolves.toEqual({ error: 'reauth_unauthorized' })

    const rows = await env.DB.prepare(
      'SELECT consumed_at FROM shared_terminal_reauth_sessions WHERE terminal_id = ?',
    )
      .bind(terminal.terminal.id)
      .all<{ consumed_at: string | null }>()
    for (const row of rows.results) expect(row.consumed_at).not.toBeNull()
  })
})
