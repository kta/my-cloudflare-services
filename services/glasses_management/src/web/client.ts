import type { AppType } from '@app/glasses_management'
import { auth } from '@app/shared'
import { hc } from 'hono/client'
import { loadTerminal } from './terminal/terminalState'

/*
 * 型のついた Hono RPC クライアント。API は同じオリジンにある（1 つの Worker が
 * SPA と API を配る）ので base は '/' でよい。`authFetch` が bearer を付ける。
 *
 * それに加えて、この端末が開いている業務を `x-terminal-session` で名乗る（P10）。
 * 監査の主体（共有モードなら端末そのもの・個人モードならその本人）はサーバがこの
 * 名乗りだけから決める —— **担当 id を本文で送らせない**（送れると誰でも他人の名前で
 * 残せる）。まだ業務が始まっていない画面は名乗るものが無いので、何も付けない。
 */
const terminalFetch: typeof fetch = (input, init) => {
  const sessionId = loadTerminal()?.sessionId ?? null
  if (sessionId === null) return auth.authFetch(input, init)
  const headers = new Headers(init?.headers)
  headers.set('x-terminal-session', sessionId)
  return auth.authFetch(input, { ...init, headers })
}

export const client = hc<AppType>('/', { fetch: terminalFetch })

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
