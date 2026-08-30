import type { AppType } from '@app/glasses_management'
import { auth } from '@app/shared'
import { hc } from 'hono/client'

// 型のついた Hono RPC クライアント。API は同じオリジンにある（1 つの Worker が
// SPA と API を配る）ので base は '/' でよい。`authFetch` が bearer を付ける。
export const client = hc<AppType>('/', { fetch: auth.authFetch })

/**
 * いま業務をしている人の `sub`（JWT の本文から読むだけ。署名はサーバが確かめる）。
 * 断られたときの名乗り・「最後に直したのは」・手書きの記入者に使う。
 */
export function subjectFromToken(): string | null {
  const token = auth.getToken()
  const payload = token?.split('.')[1]
  if (!payload) return null
  try {
    const decoded: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    const sub = (decoded as { sub?: unknown }).sub
    return typeof sub === 'string' ? sub : null
  } catch {
    return null
  }
}
