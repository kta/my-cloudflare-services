/**
 * テスト共通の入口。D1 と KV はテストファイル内で共有されるので、
 * 組織 id・店舗 slug は必ず `crypto.randomUUID()` から作って衝突させない。
 */
import { SELF } from 'cloudflare:test'

export const BASE = 'https://glasses-management.test'
export const JSON_HEADERS = { 'content-type': 'application/json' }
export const INTERNAL_HEADERS = { ...JSON_HEADERS, 'x-internal-key': 'dev-internal-key' }
export const JWT_SECRET = 'dev-jwt-secret-change-me'

export const orgId = () => `org-${crypto.randomUUID()}`

export function authed(token: string) {
  return { ...JSON_HEADERS, authorization: `Bearer ${token}` }
}

/** dev グラントでテナントのトークンを取る（組織の同期行も同時に作られる）。 */
export async function tokenFor(org: string, role: 'admin' | 'staff' = 'staff'): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/token`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ organizationId: org, role }),
  })
  return ((await res.json()) as { token: string }).token
}

/** admin からの組織スナップショット配信を模す。 */
export async function syncOrganization(input: {
  id: string
  name?: string
  plan?: 'free' | 'contracted'
  isDisabled?: boolean
  createdAt?: string
  revision?: number
}) {
  const res = await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify({
      id: input.id,
      name: input.name ?? 'EYEX',
      plan: input.plan ?? 'free',
      isDisabled: input.isDisabled ?? false,
      createdAt: input.createdAt ?? '2026-08-27T02:08:00.000Z',
      revision: input.revision ?? 0,
    }),
  })
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<string, unknown> | null,
  }
}
