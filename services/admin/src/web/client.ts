import type { AppType } from '@app/admin'
import { hc } from 'hono/client'
import { authFetch } from './auth/session'

/**
 * 型付き Hono RPC クライアント。API は同一オリジン(1 Worker が SPA + API を配信)
 * なので base は '/'。`authFetch` が bearer 付与と 401→refresh を担う。
 */
export const client = hc<AppType>('/', { fetch: authFetch })

async function parseJsonBody(res: Response): Promise<unknown | undefined> {
  const text = await res.text()
  return text === '' ? undefined : JSON.parse(text)
}

/** unwrap ヘルパ: 非 2xx を例外化し、JSON を型付きで返す。 */
export async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let code = `http_${res.status}`
    let body: unknown | undefined
    try {
      body = await parseJsonBody(res)
      if (
        body !== null &&
        typeof body === 'object' &&
        'error' in body &&
        typeof body.error === 'string'
      ) {
        code = body.error
      }
    } catch {
      // ignore
    }
    throw new ApiError(res.status, code, body)
  }
  const body = await parseJsonBody(res)
  return body as T
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    /** Recovery UIs may use a documented structured error payload. */
    public body: unknown | undefined,
  ) {
    super(code)
    this.name = 'ApiError'
  }
}
