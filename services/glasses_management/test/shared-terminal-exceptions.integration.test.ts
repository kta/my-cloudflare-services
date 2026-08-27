import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it, vi } from 'vitest'
import {
  hashSharedTerminalToken,
  issueSharedTerminalToken,
} from '../src/worker/domain/shared-terminal'

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

async function syncOrganization(organizationId: string) {
  expect(
    (
      await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
        method: 'POST',
        headers: INTERNAL_HEADERS,
        body: JSON.stringify({
          id: organizationId,
          name: '例外系組織',
          plan: 'free',
          isDisabled: false,
          createdAt: '2026-08-31T00:00:00.000Z',
        }),
      })
    ).status,
  ).toBe(200)
}

async function syncStore(organizationId: string, storeId: string) {
  expect(
    (
      await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
        method: 'POST',
        headers: INTERNAL_HEADERS,
        body: JSON.stringify({
          id: storeId,
          organizationId,
          name: '例外系店舗',
          slug: `terminal-exception-${uuid().slice(0, 8)}`,
          isActive: true,
          createdAt: '2026-08-31T00:00:00.000Z',
        }),
      })
    ).status,
  ).toBe(200)
}

async function syncMembership(
  organizationId: string,
  storeId: string,
  userId: string,
  permissions: readonly string[],
) {
  expect(
    (
      await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
        method: 'POST',
        headers: INTERNAL_HEADERS,
        body: JSON.stringify({
          id: uuid(),
          organizationId,
          storeId,
          userId,
          permissions,
          createdAt: '2026-08-31T00:00:00.000Z',
        }),
      })
    ).status,
  ).toBe(200)
}

/**
 * A tenant with one store, one terminal manager and one registered terminal.
 * Terminals are always issued through the staff API so the exception tests
 * exercise exactly the state a real iPad would carry.
 */
async function setupTerminal() {
  const organizationId = uuid()
  const storeId = uuid()
  const managerId = uuid()
  await syncOrganization(organizationId)
  await syncStore(organizationId, storeId)
  await syncMembership(organizationId, storeId, managerId, ['terminal.manage'])
  const managerToken = await signAccessToken(
    { sub: managerId, org: organizationId, email: `${uuid()}@example.test`, role: 'staff' },
    'dev-jwt-secret-change-me',
  )
  const created = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/shared-terminals`,
    auth(managerToken, { method: 'POST', body: JSON.stringify({ name: '例外系受付iPad' }) }),
  )
  expect(created.status).toBe(201)
  const issued = (await created.json()) as { terminal: { id: string }; token: string }
  return { organizationId, storeId, managerId, managerToken, ...issued }
}

/**
 * Insert a terminal row directly so the tenant rows it points at can be made
 * absent. Sync endpoints intentionally cannot produce that state, but D1 can
 * reach it through partial replication, so the worker must still fail closed.
 */
async function insertOrphanTerminal(input: {
  organizationId: string
  storeId: string
}): Promise<{ id: string; token: string }> {
  const id = uuid()
  const token = issueSharedTerminalToken()
  await env.DB.prepare(
    'INSERT INTO shared_terminals (id, organization_id, store_id, name, token_hash, status, idle_timeout_seconds, expires_at, last_seen_at, created_at, revoked_at, revocation_operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL)',
  )
    .bind(
      id,
      input.organizationId,
      input.storeId,
      '孤立iPad',
      await hashSharedTerminalToken(token),
      'active',
      120,
      '2099-01-01T00:00:00.000Z',
      '2026-08-31T00:00:00.000Z',
    )
    .run()
  return { id, token }
}

async function issueReauthGrant(terminal: {
  terminal: { id: string }
  token: string
  managerId: string
}): Promise<{ token: string; expiresAt: string }> {
  const response = await SELF.fetch(
    `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthenticate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shared-terminal-token': terminal.token },
      body: JSON.stringify({ userId: terminal.managerId, stretchedPin: 'pin-proof-from-browser' }),
    },
  )
  expect(response.status).toBe(201)
  return (await response.json()) as { token: string; expiresAt: string }
}

describe('shared-terminal session exception paths', () => {
  it('does not reveal whether an unknown terminal id exists', async () => {
    // A stolen iPad probing terminal ids must get the same opaque answer as a
    // wrong token, so enumeration cannot distinguish the two.
    const response = await SELF.fetch(`${BASE}/api/shared-terminals/${uuid()}/session`, {
      headers: { 'x-shared-terminal-token': issueSharedTerminalToken() },
    })
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'terminal_unauthorized' })
  })

  it('rejects a terminal whose organization row is absent as if the tenant were disabled', async () => {
    // Absent tenant state must never be read as "nothing forbids this"; the
    // terminal is treated exactly like a disabled organization.
    const storeId = uuid()
    const organizationId = uuid()
    await syncOrganization(organizationId)
    await syncStore(organizationId, storeId)
    const orphan = await insertOrphanTerminal({ organizationId: uuid(), storeId })

    const response = await SELF.fetch(`${BASE}/api/shared-terminals/${orphan.id}/session`, {
      headers: { 'x-shared-terminal-token': orphan.token },
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'org_disabled' })
  })

  it('rejects a terminal whose store row is absent as an inactive store', async () => {
    // The store is the terminal's only scope. Without it there is no scope to
    // honour, so the request must fail rather than fall back to tenant-wide access.
    const organizationId = uuid()
    await syncOrganization(organizationId)
    const orphan = await insertOrphanTerminal({ organizationId, storeId: uuid() })

    const response = await SELF.fetch(`${BASE}/api/shared-terminals/${orphan.id}/session`, {
      headers: { 'x-shared-terminal-token': orphan.token },
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'terminal_store_inactive' })
  })

  it('fails closed when the stored expiry cannot be evaluated by the atomic guard', async () => {
    // The in-statement re-check is the authority. If it cannot evaluate the
    // expiry (corrupt value), the heartbeat must not silently succeed.
    const terminal = await setupTerminal()
    await env.DB.prepare('UPDATE shared_terminals SET expires_at = ? WHERE id = ?')
      .bind('not-an-instant', terminal.terminal.id)
      .run()

    const response = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/session`,
      { headers: { 'x-shared-terminal-token': terminal.token } },
    )
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'terminal_revoked' })
    const persisted = await env.DB.prepare('SELECT last_seen_at FROM shared_terminals WHERE id = ?')
      .bind(terminal.terminal.id)
      .first<{ last_seen_at: string | null }>()
    expect(persisted?.last_seen_at).toBeNull()
  })
})

describe('shared-terminal daily-route scope exceptions', () => {
  it('refuses a daily route for another store of the same organization', async () => {
    // A terminal is bound to the store it was registered in. Sharing a tenant
    // must never widen its scope to a sibling store's ledger.
    const terminal = await setupTerminal()
    const siblingStoreId = uuid()
    await syncStore(terminal.organizationId, siblingStoreId)

    const response = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${siblingStoreId}/ledger?date=2026-08-31`,
      { headers: { 'x-shared-terminal-token': terminal.token } },
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('refuses a daily route for a store in another organization without leaking its existence', async () => {
    // Cross-tenant probing must be indistinguishable from the sibling-store case.
    const terminal = await setupTerminal()
    const otherOrganizationId = uuid()
    const otherStoreId = uuid()
    await syncOrganization(otherOrganizationId)
    await syncStore(otherOrganizationId, otherStoreId)

    const response = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${otherStoreId}/ledger?date=2026-08-31`,
      { headers: { 'x-shared-terminal-token': terminal.token } },
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('propagates the terminal session error from a daily write route after remote revocation', async () => {
    // Revocation from the back office must stop in-flight iPad operations,
    // reporting the terminal state rather than a generic permission error.
    const terminal = await setupTerminal()
    await SELF.fetch(
      `${BASE}/api/staff/stores/${terminal.storeId}/shared-terminals/${terminal.terminal.id}/revoke`,
      auth(terminal.managerToken, { method: 'POST' }),
    )

    const response = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${terminal.storeId}/walkins`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shared-terminal-token': terminal.token },
        body: '{}',
      },
    )
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'terminal_revoked' })
  })

  it('reports a version conflict as such when the terminal itself is still valid', async () => {
    // The guarded write recovery must distinguish an ordinary optimistic
    // conflict from a device problem, otherwise staff would be told to
    // re-authenticate a perfectly healthy iPad.
    const terminal = await setupTerminal()
    const headers = {
      'content-type': 'application/json',
      'x-shared-terminal-token': terminal.token,
    }
    const created = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${terminal.storeId}/walkins`,
      { method: 'POST', headers, body: '{}' },
    )
    expect(created.status).toBe(201)
    const walkin = (await created.json()) as {
      id: string
      provisionalLabel: string
      version: number
    }
    // The shared surface identifies a walk-in by a sequence label, never by
    // customer PII.
    expect(walkin.provisionalLabel).toMatch(/^ウォークイン \d+$/)

    const stale = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/stores/${terminal.storeId}/walkins/${walkin.id}/progress`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          progress: 'service_in_progress',
          version: walkin.version + 5,
        }),
      },
    )
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toEqual({
      error: 'version_conflict',
      currentVersion: walkin.version,
    })
  })
})

describe('shared-terminal reauthentication exception paths', () => {
  it('refuses to issue a grant for a user without terminal.manage in the bound store', async () => {
    // PIN knowledge alone must not confer management rights; membership in the
    // terminal's own store is checked before the PIN is even sent to admin.
    const terminal = await setupTerminal()
    const receptionistId = uuid()
    await syncMembership(terminal.organizationId, terminal.storeId, receptionistId, [
      'reservation.read',
      'reservation.write',
    ])

    const response = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthenticate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shared-terminal-token': terminal.token },
        body: JSON.stringify({
          userId: receptionistId,
          stretchedPin: 'pin-proof-from-browser',
        }),
      },
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'reauth_forbidden' })
    const sessions = await env.DB.prepare(
      'SELECT count(*) as count FROM shared_terminal_reauth_sessions WHERE terminal_id = ?',
    )
      .bind(terminal.terminal.id)
      .first<{ count: number }>()
    expect(sessions?.count).toBe(0)
  })

  it('refuses to issue a grant for a user of another store in the same organization', async () => {
    // A manager of a sibling store is a legitimate user of the tenant but has
    // no authority over this device.
    const terminal = await setupTerminal()
    const siblingStoreId = uuid()
    const siblingManagerId = uuid()
    await syncStore(terminal.organizationId, siblingStoreId)
    await syncMembership(terminal.organizationId, siblingStoreId, siblingManagerId, [
      'terminal.manage',
    ])

    const response = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthenticate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shared-terminal-token': terminal.token },
        body: JSON.stringify({
          userId: siblingManagerId,
          stretchedPin: 'pin-proof-from-browser',
        }),
      },
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'reauth_forbidden' })
  })

  it('rejects a reauthentication attempt from a revoked terminal before touching the PIN', async () => {
    // Grants inherit the device's trust, so a revoked device cannot mint one.
    const terminal = await setupTerminal()
    await SELF.fetch(
      `${BASE}/api/staff/stores/${terminal.storeId}/shared-terminals/${terminal.terminal.id}/revoke`,
      auth(terminal.managerToken, { method: 'POST' }),
    )

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
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'terminal_revoked' })
  })

  it('surfaces an audit append failure as its own error instead of a silent grant', async () => {
    // The grant and its audit event are one batch. If the batch cannot be
    // written, no usable grant may be returned to the device.
    const terminal = await setupTerminal()
    const first = await issueReauthGrant(terminal)

    // Force the second issuance to collide with the first grant's unique token
    // hash, which makes D1 roll the whole audit batch back.
    const collidingUuid = uuid()
    const randomUUID = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue(collidingUuid as `${string}-${string}-${string}-${string}-${string}`)
    try {
      await env.DB.prepare('UPDATE shared_terminal_reauth_sessions SET token_hash = ? WHERE id = ?')
        .bind(
          await hashSharedTerminalToken(`${collidingUuid}${collidingUuid}`),
          (
            await env.DB.prepare(
              'SELECT id FROM shared_terminal_reauth_sessions WHERE terminal_id = ?',
            )
              .bind(terminal.terminal.id)
              .first<{ id: string }>()
          )?.id ?? '',
        )
        .run()
      const response = await SELF.fetch(
        `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthenticate`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-shared-terminal-token': terminal.token,
          },
          body: JSON.stringify({
            userId: terminal.managerId,
            stretchedPin: 'pin-proof-from-browser',
          }),
        },
      )
      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({ error: 'audit_append_failed' })
    } finally {
      randomUUID.mockRestore()
    }
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    const sessions = await env.DB.prepare(
      'SELECT count(*) as count FROM shared_terminal_reauth_sessions WHERE terminal_id = ?',
    )
      .bind(terminal.terminal.id)
      .first<{ count: number }>()
    expect(sessions?.count).toBe(1)
  })

  it('reports the admin service as unavailable instead of granting on a non-ok PIN response', async () => {
    // The PIN authority lives in admin. If it cannot answer, the terminal must
    // stay locked rather than fall back to a local decision.
    const terminal = await setupTerminal()
    const original = env.ADMIN
    let received: { url: string; internalKey: string | null; body: unknown } | undefined
    ;(env as { ADMIN: unknown }).ADMIN = {
      fetch: async (input: RequestInfo, init?: RequestInit) => {
        received = {
          url: typeof input === 'string' ? input : input.url,
          internalKey: new Headers(init?.headers).get('x-internal-key'),
          body: JSON.parse(String(init?.body)),
        }
        return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })
      },
    }
    try {
      const response = await SELF.fetch(
        `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthenticate`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-shared-terminal-token': terminal.token,
          },
          body: JSON.stringify({
            userId: terminal.managerId,
            stretchedPin: 'pin-proof-from-browser',
          }),
        },
      )
      expect(response.status).toBe(502)
      await expect(response.json()).resolves.toEqual({ error: 'admin_auth_unavailable' })
    } finally {
      ;(env as { ADMIN: unknown }).ADMIN = original
    }
    // Only the stretched proof crosses the service binding, never a raw PIN
    // holder's personal data, and the internal key is always attached.
    expect(received?.internalKey).toBe('dev-domain-auth-key')
    expect(received?.body).toEqual({
      organizationId: terminal.organizationId,
      userId: terminal.managerId,
      stretchedPin: 'pin-proof-from-browser',
    })
    const sessions = await env.DB.prepare(
      'SELECT count(*) as count FROM shared_terminal_reauth_sessions WHERE terminal_id = ?',
    )
      .bind(terminal.terminal.id)
      .first<{ count: number }>()
    expect(sessions?.count).toBe(0)
  })

  it('reports the admin service as unavailable when the binding call itself fails', async () => {
    // A transport failure is indistinguishable from a rejection for the device,
    // and must not be swallowed into a 500 or a grant.
    const terminal = await setupTerminal()
    const original = env.ADMIN
    ;(env as { ADMIN: unknown }).ADMIN = {
      fetch: async () => {
        throw new Error('service binding unreachable')
      },
    }
    try {
      const response = await SELF.fetch(
        `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthenticate`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-shared-terminal-token': terminal.token,
          },
          body: JSON.stringify({
            userId: terminal.managerId,
            stretchedPin: 'pin-proof-from-browser',
          }),
        },
      )
      expect(response.status).toBe(502)
      await expect(response.json()).resolves.toEqual({ error: 'admin_auth_unavailable' })
    } finally {
      ;(env as { ADMIN: unknown }).ADMIN = original
    }
  })

  it('rejects a wrong PIN with an unauthenticated answer and stores no grant', async () => {
    // A negative verdict from admin is an authentication failure, distinct from
    // an outage, so the UI can prompt again instead of showing a system error.
    const terminal = await setupTerminal()
    const original = env.ADMIN
    ;(env as { ADMIN: unknown }).ADMIN = {
      fetch: async () =>
        new Response(JSON.stringify({ verified: false }), {
          headers: { 'content-type': 'application/json' },
        }),
    }
    try {
      const response = await SELF.fetch(
        `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthenticate`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-shared-terminal-token': terminal.token,
          },
          body: JSON.stringify({ userId: terminal.managerId, stretchedPin: 'wrong-pin-proof' }),
        },
      )
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({ error: 'pin_invalid' })
    } finally {
      ;(env as { ADMIN: unknown }).ADMIN = original
    }
    const sessions = await env.DB.prepare(
      'SELECT count(*) as count FROM shared_terminal_reauth_sessions WHERE terminal_id = ?',
    )
      .bind(terminal.terminal.id)
      .first<{ count: number }>()
    expect(sessions?.count).toBe(0)
  })

  it('rejects an unknown reauthentication grant token', async () => {
    // Guessed grant tokens must be rejected before any privileged branch runs.
    const terminal = await setupTerminal()

    const response = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthentication`,
      {
        headers: {
          'x-shared-terminal-token': terminal.token,
          'x-shared-terminal-reauth-token': issueSharedTerminalToken(),
        },
      },
    )
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'reauth_unauthorized' })
  })

  it('rejects an expired grant while an unexpired one is still accepted', async () => {
    // The grant is a short-lived stand-in for a person standing at the iPad;
    // once its deadline has passed it must stop working immediately.
    const terminal = await setupTerminal()
    const grant = await issueReauthGrant(terminal)
    const headers = {
      'x-shared-terminal-token': terminal.token,
      'x-shared-terminal-reauth-token': grant.token,
    }

    await env.DB.prepare(
      'UPDATE shared_terminal_reauth_sessions SET expires_at = ? WHERE terminal_id = ?',
    )
      .bind('2000-01-01T00:00:00.000Z', terminal.terminal.id)
      .run()
    const expired = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthentication`,
      { headers },
    )
    expect(expired.status).toBe(401)
    await expect(expired.json()).resolves.toEqual({ error: 'reauth_expired' })

    await env.DB.prepare(
      'UPDATE shared_terminal_reauth_sessions SET expires_at = ? WHERE terminal_id = ?',
    )
      .bind('2099-01-01T00:00:00.000Z', terminal.terminal.id)
      .run()
    const accepted = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/reauthentication`,
      { headers },
    )
    expect(accepted.status).toBe(200)
    await expect(accepted.json()).resolves.toEqual({ authorized: true })
  })

  it('refuses self-revocation when the reauthenticated user lost terminal.manage', async () => {
    // Authorization is re-read at the moment of the action, so a permission
    // removed after the PIN prompt takes effect on an outstanding grant.
    const terminal = await setupTerminal()
    const grant = await issueReauthGrant(terminal)
    await syncMembership(terminal.organizationId, terminal.storeId, terminal.managerId, [
      'reservation.read',
    ])

    const response = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.terminal.id}/revoke`,
      {
        method: 'POST',
        headers: {
          'x-shared-terminal-token': terminal.token,
          'x-shared-terminal-reauth-token': grant.token,
        },
      },
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'reauth_forbidden' })
    const persisted = await env.DB.prepare('SELECT status FROM shared_terminals WHERE id = ?')
      .bind(terminal.terminal.id)
      .first<{ status: string }>()
    expect(persisted?.status).toBe('active')
  })
})

describe('shared-terminal revocation exceptions', () => {
  it('refuses to revoke a terminal of another organization without leaking its existence', async () => {
    // A cross-tenant revoke must answer exactly like a revoke of an id that
    // does not exist at all.
    const terminal = await setupTerminal()
    const victim = await setupTerminal()

    const foreign = await SELF.fetch(
      `${BASE}/api/staff/stores/${terminal.storeId}/shared-terminals/${victim.terminal.id}/revoke`,
      auth(terminal.managerToken, { method: 'POST' }),
    )
    const unknown = await SELF.fetch(
      `${BASE}/api/staff/stores/${terminal.storeId}/shared-terminals/${uuid()}/revoke`,
      auth(terminal.managerToken, { method: 'POST' }),
    )
    expect(foreign.status).toBe(403)
    expect(unknown.status).toBe(403)
    await expect(foreign.json()).resolves.toEqual({ error: 'forbidden' })
    await expect(unknown.json()).resolves.toEqual({ error: 'forbidden' })
    const persisted = await env.DB.prepare('SELECT status FROM shared_terminals WHERE id = ?')
      .bind(victim.terminal.id)
      .first<{ status: string }>()
    expect(persisted?.status).toBe('active')
  })

  it('refuses to revoke a terminal registered in another store of the same organization', async () => {
    // Store scope, not only tenant scope, decides who may retire a device.
    const terminal = await setupTerminal()
    const siblingStoreId = uuid()
    await syncStore(terminal.organizationId, siblingStoreId)
    await syncMembership(terminal.organizationId, siblingStoreId, terminal.managerId, [
      'terminal.manage',
    ])

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${siblingStoreId}/shared-terminals/${terminal.terminal.id}/revoke`,
      auth(terminal.managerToken, { method: 'POST' }),
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
    const persisted = await env.DB.prepare('SELECT status FROM shared_terminals WHERE id = ?')
      .bind(terminal.terminal.id)
      .first<{ status: string }>()
    expect(persisted?.status).toBe('active')
  })
})
