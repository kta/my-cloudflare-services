import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
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

async function syncTenant() {
  const organizationId = uuid()
  const storeId = uuid()
  for (const [path, body] of [
    [
      '/api/internal/organizations/sync',
      {
        id: organizationId,
        name: '整合性組織',
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
        name: '整合性店舗',
        slug: `integrity-${uuid().slice(0, 8)}`,
        isActive: true,
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
  return { organizationId, storeId }
}

async function insertTerminal(input: {
  organizationId: string
  storeId: string
  idleTimeoutSeconds: number
}) {
  const id = uuid()
  const token = issueSharedTerminalToken()
  await env.DB.prepare(
    'INSERT INTO shared_terminals (id, organization_id, store_id, name, token_hash, status, idle_timeout_seconds, expires_at, last_seen_at, created_at, revoked_at, revocation_operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL)',
  )
    .bind(
      id,
      input.organizationId,
      input.storeId,
      '整合性iPad',
      await hashSharedTerminalToken(token),
      'active',
      input.idleTimeoutSeconds,
      '2099-01-01T00:00:00.000Z',
      '2026-08-31T00:00:00.000Z',
    )
    .run()
  return { id, token }
}

/*
 * `shared_terminals.idle_timeout_seconds` has no database-level CHECK, so a bad
 * write or a partial replication can leave a value the SharedTerminal contract
 * rejects. That row must not turn every terminal-authenticated request into an
 * unhandled parse error: on a security surface, corrupt state has to fail
 * closed and look exactly like an unknown terminal.
 */
describe('shared-terminal row integrity', () => {
  it('fails a session closed when the stored idle timeout violates the contract', async () => {
    const tenant = await syncTenant()
    const terminal = await insertTerminal({ ...tenant, idleTimeoutSeconds: 0 })

    const response = await SELF.fetch(`${BASE}/api/shared-terminals/${terminal.id}/session`, {
      headers: { 'x-shared-terminal-token': terminal.token },
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'terminal_unauthorized' })
  })

  it('fails a terminal-authenticated write closed for the same corrupt row', async () => {
    const tenant = await syncTenant()
    const terminal = await insertTerminal({ ...tenant, idleTimeoutSeconds: -1 })

    const response = await SELF.fetch(
      `${BASE}/api/shared-terminals/${terminal.id}/stores/${tenant.storeId}/walkins`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shared-terminal-token': terminal.token },
        body: '{}',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'terminal_unauthorized' })
  })

  it('still serves a session for a contract-valid idle timeout', async () => {
    const tenant = await syncTenant()
    const terminal = await insertTerminal({ ...tenant, idleTimeoutSeconds: 120 })

    const response = await SELF.fetch(`${BASE}/api/shared-terminals/${terminal.id}/session`, {
      headers: { 'x-shared-terminal-token': terminal.token },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: terminal.id,
      idleTimeoutSeconds: 120,
      status: 'active',
    })
  })
})
