import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

const BASE = 'https://admin.test'
const INTERNAL_KEY = 'dev-internal-key'
const JWT_SECRET = 'dev-jwt-secret-change-me'
const JSON_HEADERS = { 'content-type': 'application/json' }

type JsonRecord = Record<string, unknown>

function internalHeaders(): Record<string, string> {
  return { ...JSON_HEADERS, 'x-internal-key': INTERNAL_KEY }
}

async function devOperatorToken(): Promise<string> {
  const response = await SELF.fetch(`${BASE}/api/auth/token`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      organizationId: `operator-${crypto.randomUUID()}`,
      role: 'admin',
      email: `operator-${crypto.randomUUID()}@example.test`,
    }),
  })
  expect(response.status).toBe(200)
  return ((await response.json()) as { token: string }).token
}

function operatorJson(token: string, body?: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

function organizationInput(name = 'EYE tenant'): JsonRecord {
  return { name, plan: 'contracted' }
}

afterEach(() => vi.restoreAllMocks())

describe('admin → glasses-management organization synchronization', () => {
  it('sends a complete organization record with the internal key after creation', async () => {
    const fetchSpy = vi.spyOn(env.GLASSES_MANAGEMENT, 'fetch')
    const token = await devOperatorToken()

    const response = await SELF.fetch(
      `${BASE}/api/organizations`,
      operatorJson(token, organizationInput()),
    )

    expect(response.status).toBe(201)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [input, init] = fetchSpy.mock.calls[0] ?? []
    const request = new Request(input as RequestInfo, init as RequestInit)
    expect(request.method).toBe('POST')
    expect(request.headers.get('x-internal-key')).toBe(INTERNAL_KEY)
    expect(request.url).toContain('/api/internal/organizations/sync')
    await expect(request.json()).resolves.toMatchObject({
      name: 'EYE tenant',
      plan: 'contracted',
      isDisabled: false,
      revision: 1,
    })
  })

  it('resynchronizes an existing seeded organization id without requiring a UUID', async () => {
    const fetchSpy = vi
      .spyOn(env.GLASSES_MANAGEMENT, 'fetch')
      .mockImplementation(async (_input, init) => new Response(init?.body, { status: 200 }))
    const token = await devOperatorToken()
    await env.DB.prepare(
      `INSERT INTO organizations
        (id, name, plan, is_disabled, is_operator, sync_revision, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'org-admin-seed',
        'Platform Admin',
        'contracted',
        '0',
        '0',
        1,
        new Date('2026-08-26T00:00:00.000Z').toISOString(),
      )
      .run()

    const response = await SELF.fetch(`${BASE}/api/organizations/org-admin-seed/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0] ?? []
    await expect(
      new Request('https://glasses-management.internal', init as RequestInit).json(),
    ).resolves.toMatchObject({ id: 'org-admin-seed', revision: 1 })
  })

  it('returns an explicit sync failure while retaining the canonical organization', async () => {
    const fetchSpy = vi
      .spyOn(env.GLASSES_MANAGEMENT, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }))
    const token = await devOperatorToken()

    const response = await SELF.fetch(
      `${BASE}/api/organizations`,
      operatorJson(token, organizationInput('sync failure tenant')),
    )
    expect(response.status).toBe(502)
    const failure = (await response.json()) as { organizationId: string }
    expect(failure).toMatchObject({
      error: 'organization_sync_failed',
      retryable: true,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const list = await SELF.fetch(`${BASE}/api/organizations`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const rows = (await list.json()) as Array<{ name: string }>
    expect(rows.some((row) => row.name === 'sync failure tenant')).toBe(true)

    // The canonical row remains available for an explicit operator recovery.
    fetchSpy.mockImplementation(async (_input, init) => new Response(init?.body, { status: 200 }))
    const recovered = await SELF.fetch(`${BASE}/api/organizations/${failure.organizationId}/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(recovered.status).toBe(200)
    await expect(recovered.json()).resolves.toMatchObject({
      id: failure.organizationId,
      revision: 1,
      isDisabled: false,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('treats a domain rate-limit response as retryable while retaining the canonical organization', async () => {
    const fetchSpy = vi
      .spyOn(env.GLASSES_MANAGEMENT, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 }))
    const token = await devOperatorToken()

    const response = await SELF.fetch(
      `${BASE}/api/organizations`,
      operatorJson(token, organizationInput('rate-limited sync tenant')),
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      error: 'organization_sync_failed',
      retryable: true,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects a successful HTTP status whose domain sync result is malformed', async () => {
    const fetchSpy = vi
      .spyOn(env.GLASSES_MANAGEMENT, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ status: 'unexpected' }), { status: 200 }))
    const token = await devOperatorToken()

    const response = await SELF.fetch(
      `${BASE}/api/organizations`,
      operatorJson(token, organizationInput('malformed sync response tenant')),
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ error: 'organization_sync_failed' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects a successful sync response that changes canonical fields', async () => {
    const fetchSpy = vi
      .spyOn(env.GLASSES_MANAGEMENT, 'fetch')
      .mockImplementation(async (_input, init) => {
        const sent = JSON.parse(init?.body as string) as Record<string, unknown>
        return new Response(
          JSON.stringify({ ...sent, name: 'domain changed the canonical name' }),
          { status: 200 },
        )
      })
    const token = await devOperatorToken()

    const response = await SELF.fetch(
      `${BASE}/api/organizations`,
      operatorJson(token, organizationInput('canonical response tenant')),
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ error: 'organization_sync_failed' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('increments the canonical revision for concurrent patch/delete operations', async () => {
    const fetchSpy = vi
      .spyOn(env.GLASSES_MANAGEMENT, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }))
    const token = await devOperatorToken()
    const created = await SELF.fetch(
      `${BASE}/api/organizations`,
      operatorJson(token, organizationInput('concurrent mutation tenant')),
    )
    expect(created.status).toBe(502)
    const { organizationId } = (await created.json()) as { organizationId: string }
    fetchSpy.mockClear()

    const [patched, disabled] = await Promise.all([
      SELF.fetch(`${BASE}/api/organizations/${organizationId}`, {
        method: 'PATCH',
        headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: 'free' }),
      }),
      SELF.fetch(`${BASE}/api/organizations/${organizationId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }),
    ])
    expect(patched.status).toBe(502)
    expect(disabled.status).toBe(502)

    const revisions = fetchSpy.mock.calls.map(([, init]) => {
      return (JSON.parse((init as RequestInit).body as string) as { revision: number }).revision
    })
    expect(revisions.sort((a, b) => a - b)).toEqual([2, 3])
    const row = await env.DB.prepare(
      'SELECT plan, is_disabled, sync_revision FROM organizations WHERE id = ?',
    )
      .bind(organizationId)
      .first<{ plan: string; is_disabled: string; sync_revision: number }>()
    expect(row).toMatchObject({ plan: 'free', is_disabled: '1', sync_revision: 3 })
  })

  it('allows only an operator admin to recover a canonical organization', async () => {
    const fetchSpy = vi
      .spyOn(env.GLASSES_MANAGEMENT, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }))
    const operator = await devOperatorToken()
    const created = await SELF.fetch(
      `${BASE}/api/organizations`,
      operatorJson(operator, organizationInput('operator boundary tenant')),
    )
    expect(created.status).toBe(502)
    const { organizationId } = (await created.json()) as { organizationId: string }

    const missing = await SELF.fetch(`${BASE}/api/organizations/${organizationId}/sync`, {
      method: 'POST',
    })
    expect(missing.status).toBe(401)

    const tenantOrgId = `tenant-${crypto.randomUUID()}`
    await env.DB.prepare(
      `INSERT INTO organizations
        (id, name, plan, is_disabled, is_operator, sync_revision, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        tenantOrgId,
        'Tenant operator boundary',
        'free',
        '0',
        '0',
        1,
        new Date('2026-08-26T00:00:00.000Z').toISOString(),
      )
      .run()
    const tenantToken = await signAccessToken(
      {
        sub: `tenant-user-${crypto.randomUUID()}`,
        org: tenantOrgId,
        email: `${crypto.randomUUID()}@example.test`,
        role: 'admin',
      },
      JWT_SECRET,
    )
    const tenant = await SELF.fetch(`${BASE}/api/organizations/${organizationId}/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tenantToken}` },
    })
    expect(tenant.status).toBe(403)
    await expect(tenant.json()).resolves.toEqual({ error: 'operator_only' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockImplementation(async (_input, init) => new Response(init?.body, { status: 200 }))
    const recovered = await SELF.fetch(`${BASE}/api/organizations/${organizationId}/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${operator}` },
    })
    expect(recovered.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('synchronizes organization updates and disable transitions', async () => {
    const fetchSpy = vi.spyOn(env.GLASSES_MANAGEMENT, 'fetch')
    const token = await devOperatorToken()
    const created = await SELF.fetch(
      `${BASE}/api/organizations`,
      operatorJson(token, organizationInput('before update')),
    )
    const organization = (await created.json()) as { id: string }
    fetchSpy.mockClear()

    const patched = await SELF.fetch(`${BASE}/api/organizations/${organization.id}`, {
      method: 'PATCH',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan: 'free' }),
    })
    expect(patched.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [patchInput, patchInit] = fetchSpy.mock.calls[0] ?? []
    await expect(
      new Request(patchInput as RequestInfo, patchInit as RequestInit).json(),
    ).resolves.toMatchObject({
      id: organization.id,
      plan: 'free',
      isDisabled: false,
    })

    fetchSpy.mockClear()
    const disabled = await SELF.fetch(`${BASE}/api/organizations/${organization.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(disabled.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [disableInput, disableInit] = fetchSpy.mock.calls[0] ?? []
    await expect(
      new Request(disableInput as RequestInfo, disableInit as RequestInit).json(),
    ).resolves.toMatchObject({
      id: organization.id,
      isDisabled: true,
    })
  })
})

describe('admin domain-auth proxy', () => {
  it('rejects missing or tenant JWT credentials at the internal boundary', async () => {
    const missing = await SELF.fetch(`${BASE}/api/internal/domain-auth/login`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'unknown@example.test', stretched: 'x' }),
    })
    expect(missing.status).toBe(401)

    const tenantJwt = await devOperatorToken()
    const tenant = await SELF.fetch(`${BASE}/api/internal/domain-auth/login`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${tenantJwt}` },
      body: JSON.stringify({ email: 'unknown@example.test', stretched: 'x' }),
    })
    expect(tenant.status).toBe(401)

    const wrongKey = await SELF.fetch(`${BASE}/api/internal/domain-auth/login`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'x-internal-key': 'wrong-key' },
      body: JSON.stringify({ email: 'unknown@example.test', stretched: 'x' }),
    })
    expect(wrongKey.status).toBe(401)
  })

  it('proxies login and refresh outcomes without leaking the refresh cookie boundary', async () => {
    const fetchSpy = vi.spyOn(env.GLASSES_MANAGEMENT, 'fetch')
    const operator = await devOperatorToken()
    const create = await SELF.fetch(
      `${BASE}/api/organizations`,
      operatorJson(operator, organizationInput('proxy tenant')),
    )
    const organization = (await create.json()) as { id: string }
    const invite = await SELF.fetch(`${BASE}/api/organizations/${organization.id}/invitations`, {
      ...operatorJson(operator, { email: 'proxy-user@example.test', role: 'staff' }),
    })
    const inviteBody = (await invite.json()) as { acceptUrl: string }
    const inviteToken = new URL(inviteBody.acceptUrl).searchParams.get('token')
    const accepted = await SELF.fetch(`${BASE}/api/auth/accept-invite`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        token: inviteToken,
        email: 'proxy-user@example.test',
        stretched: 'proxy-password',
      }),
    })
    expect(accepted.status).toBe(200)
    fetchSpy.mockClear()

    const login = await SELF.fetch(`${BASE}/api/internal/domain-auth/login`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({ email: 'proxy-user@example.test', stretched: 'proxy-password' }),
    })
    expect(login.status).toBe(200)
    const loginBody = (await login.json()) as { token: string; refreshToken: string }
    expect(loginBody.token).toBeTruthy()
    expect(loginBody.refreshToken).toBeTruthy()
    expect(login.headers.get('set-cookie')).toBeNull()

    const refresh = await SELF.fetch(`${BASE}/api/internal/domain-auth/refresh`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({ refreshToken: loginBody.refreshToken }),
    })
    expect(refresh.status).toBe(200)
    await expect(refresh.json()).resolves.toMatchObject({ token: expect.any(String) })
    expect(refresh.headers.get('set-cookie')).toBeNull()
  })
})
