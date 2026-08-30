import type { AppType } from '@app/glasses_management'
import { auth } from '@app/shared'
import { hc } from 'hono/client'

// 型のついた Hono RPC クライアント。API は同じオリジンにある（1 つの Worker が
// SPA と API を配る）ので base は '/' でよい。`authFetch` が bearer を付ける。
export const client = hc<AppType>('/', { fetch: auth.authFetch })
