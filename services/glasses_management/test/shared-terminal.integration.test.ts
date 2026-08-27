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

async function setupManager() {
  const organizationId = uuid()
  const storeId = uuid()
  const subjectId = uuid()
  for (const [path, body] of [
    [
      '/api/internal/organizations/sync',
      {
        id: organizationId,
        name: '共有端末組織',
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
        name: '共有端末店舗',
        slug: `terminal-${uuid().slice(0, 8)}`,
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
  return {
    organizationId,
    storeId,
    token: await signAccessToken(
      { sub: subjectId, org: organizationId, email: `${uuid()}@example.test`, role: 'staff' },
      'dev-jwt-secret-change-me',
    ),
  }
}

describe('shared terminals', () => {
  it('registers a selected-store terminal and only persists a token hash', async () => {
    const scope = await setupManager()

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/shared-terminals`,
      auth(scope.token, { method: 'POST', body: JSON.stringify({ name: '銀座店 レジ横iPad' }) }),
    )

    expect(response.status).toBe(201)
    const issued = (await response.json()) as {
      terminal: { id: string; storeId: string; name: string; status: string }
      token: string
    }
    expect(issued).toMatchObject({
      terminal: { storeId: scope.storeId, name: '銀座店 レジ横iPad', status: 'active' },
    })
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{40,}$/)

    const persisted = await env.DB.prepare(
      'SELECT token_hash FROM shared_terminals WHERE organization_id = ? AND store_id = ? AND id = ?',
    )
      .bind(scope.organizationId, scope.storeId, issued.terminal.id)
      .first<{ token_hash: string }>()
    expect(persisted?.token_hash).not.toBe(issued.token)
    expect(persisted?.token_hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('lists and remotely revokes only a selected-store terminal with an audit trail', async () => {
    const scope = await setupManager()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/shared-terminals`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({ name: '銀座店 バックヤードiPad' }),
      }),
    )
    const issued = (await created.json()) as { terminal: { id: string; status: string } }

    const listed = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/shared-terminals`,
      auth(scope.token),
    )
    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toEqual([
      expect.objectContaining({ id: issued.terminal.id, status: 'active' }),
    ])

    const revoked = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/shared-terminals/${issued.terminal.id}/revoke`,
      auth(scope.token, { method: 'POST' }),
    )
    expect(revoked.status).toBe(200)
    await expect(revoked.json()).resolves.toMatchObject({
      id: issued.terminal.id,
      status: 'revoked',
    })
    const repeatedRevoke = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/shared-terminals/${issued.terminal.id}/revoke`,
      auth(scope.token, { method: 'POST' }),
    )
    expect(repeatedRevoke.status).toBe(200)
    await expect(repeatedRevoke.json()).resolves.toMatchObject({
      id: issued.terminal.id,
      status: 'revoked',
    })
    const audit = await env.DB.prepare(
      "SELECT action FROM audit_events WHERE organization_id = ? AND store_id = ? AND entity_id = ? AND action = 'shared_terminal.revoked'",
    )
      .bind(scope.organizationId, scope.storeId, issued.terminal.id)
      .all<{ action: string }>()
    expect(audit.results).toEqual([{ action: 'shared_terminal.revoked' }])
  })

  it('accepts only an active terminal token and rejects it immediately after revocation', async () => {
    const scope = await setupManager()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/shared-terminals`,
      auth(scope.token, { method: 'POST', body: JSON.stringify({ name: '銀座店 受付iPad' }) }),
    )
    const issued = (await created.json()) as { terminal: { id: string }; token: string }
    const session = await SELF.fetch(`${BASE}/api/shared-terminals/${issued.terminal.id}/session`, {
      headers: { 'x-shared-terminal-token': issued.token },
    })
    expect(session.status).toBe(200)
    await expect(session.json()).resolves.toMatchObject({
      id: issued.terminal.id,
      storeId: scope.storeId,
      status: 'active',
    })

    await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/shared-terminals/${issued.terminal.id}/revoke`,
      auth(scope.token, { method: 'POST' }),
    )
    const revokedSession = await SELF.fetch(
      `${BASE}/api/shared-terminals/${issued.terminal.id}/session`,
      {
        headers: { 'x-shared-terminal-token': issued.token },
      },
    )
    expect(revokedSession.status).toBe(401)
    await expect(revokedSession.json()).resolves.toEqual({ error: 'terminal_revoked' })
  })

  it('fails closed for absent, invalid, and expired terminal tokens', async () => {
    const scope = await setupManager()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/shared-terminals`,
      auth(scope.token, { method: 'POST', body: JSON.stringify({ name: '銀座店 検証iPad' }) }),
    )
    const issued = (await created.json()) as { terminal: { id: string }; token: string }
    const path = `${BASE}/api/shared-terminals/${issued.terminal.id}/session`
    const absent = await SELF.fetch(path)
    expect(absent.status).toBe(401)
    await expect(absent.json()).resolves.toEqual({ error: 'terminal_unauthorized' })
    const invalid = await SELF.fetch(path, {
      headers: { 'x-shared-terminal-token': `${issued.token}tampered` },
    })
    expect(invalid.status).toBe(401)
    await expect(invalid.json()).resolves.toEqual({ error: 'terminal_unauthorized' })

    await env.DB.prepare('UPDATE shared_terminals SET expires_at = ? WHERE id = ?')
      .bind('2000-01-01T00:00:00.000Z', issued.terminal.id)
      .run()
    const expired = await SELF.fetch(path, { headers: { 'x-shared-terminal-token': issued.token } })
    expect(expired.status).toBe(401)
    await expect(expired.json()).resolves.toEqual({ error: 'terminal_expired' })
  })

  it('does not expose terminal registration, listing, or revocation without terminal.manage', async () => {
    const scope = await setupManager()
    const outsider = await signAccessToken(
      { sub: uuid(), org: scope.organizationId, email: `${uuid()}@example.test`, role: 'staff' },
      'dev-jwt-secret-change-me',
    )
    const base = `${BASE}/api/staff/stores/${scope.storeId}/shared-terminals`
    const create = await SELF.fetch(
      base,
      auth(outsider, { method: 'POST', body: JSON.stringify({}) }),
    )
    expect(create.status).toBe(403)
    const list = await SELF.fetch(base, auth(outsider))
    expect(list.status).toBe(403)
    const revoke = await SELF.fetch(`${base}/${uuid()}/revoke`, auth(outsider, { method: 'POST' }))
    expect(revoke.status).toBe(403)
  })

  it('rejects a terminal when its organization is disabled or store is inactive', async () => {
    const scope = await setupManager()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/shared-terminals`,
      auth(scope.token, { method: 'POST', body: JSON.stringify({ name: '銀座店 境界iPad' }) }),
    )
    const issued = (await created.json()) as { terminal: { id: string }; token: string }
    const path = `${BASE}/api/shared-terminals/${issued.terminal.id}/session`
    await env.DB.prepare("UPDATE organizations SET is_disabled = '1' WHERE id = ?")
      .bind(scope.organizationId)
      .run()
    const disabled = await SELF.fetch(path, {
      headers: { 'x-shared-terminal-token': issued.token },
    })
    expect(disabled.status).toBe(403)
    await expect(disabled.json()).resolves.toEqual({ error: 'org_disabled' })

    await env.DB.prepare("UPDATE organizations SET is_disabled = '0' WHERE id = ?")
      .bind(scope.organizationId)
      .run()
    await env.DB.prepare("UPDATE stores SET is_active = '0' WHERE id = ?").bind(scope.storeId).run()
    const inactive = await SELF.fetch(path, {
      headers: { 'x-shared-terminal-token': issued.token },
    })
    expect(inactive.status).toBe(403)
    await expect(inactive.json()).resolves.toEqual({ error: 'terminal_store_inactive' })
  })
})
