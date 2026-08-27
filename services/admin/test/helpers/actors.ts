import { SELF } from 'cloudflare:test'

/**
 * UC-EYEX-149 / UC-EYEX-151 のテスト用アクター生成。テナント org と、その org の
 * admin / staff を招待経由で実在させる(dev グラントは users 行を作らないため、
 * 監査の actor / 対象として使えない)。
 */

export const BASE = 'https://admin.test'
export const JSON_HEADERS = { 'content-type': 'application/json' }

export type TenantActor = { token: string; userId: string; email: string }

async function operatorToken(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/token`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ organizationId: `operator-${crypto.randomUUID()}`, role: 'admin' }),
  })
  return ((await res.json()) as { token: string }).token
}

export async function createTenantOrganization(name = 'EYEX Chain'): Promise<string> {
  const op = await operatorToken()
  const res = await SELF.fetch(`${BASE}/api/organizations`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, authorization: `Bearer ${op}` },
    body: JSON.stringify({ name }),
  })
  if (res.status !== 201) throw new Error(`organization creation failed: ${res.status}`)
  return ((await res.json()) as { id: string }).id
}

/** 招待 → 受諾で実在ユーザーを作り、その access token と users.id を返す。 */
export async function inviteMember(
  organizationId: string,
  role: 'admin' | 'staff',
  label = 'member',
): Promise<TenantActor> {
  const op = await operatorToken()
  const email = `${label}-${crypto.randomUUID()}@tenant.test`
  const invited = await SELF.fetch(`${BASE}/api/organizations/${organizationId}/invitations`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, authorization: `Bearer ${op}` },
    body: JSON.stringify({ email, role }),
  })
  const { acceptUrl } = (await invited.json()) as { acceptUrl?: string }
  if (!acceptUrl) throw new Error('invite did not return an acceptUrl')
  const token = new URL(acceptUrl).searchParams.get('token') ?? ''
  const accepted = await SELF.fetch(`${BASE}/api/auth/accept-invite`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ token, email, stretched: `stretched-${crypto.randomUUID()}` }),
  })
  const body = (await accepted.json()) as { token: string; user: { id: string } }
  return { token: body.token, userId: body.user.id, email }
}

export function authed(token: string, method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

export function storeId(): string {
  return crypto.randomUUID()
}
