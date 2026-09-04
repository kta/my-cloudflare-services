import type { AppType } from '@app/glasses_management'
import { auth } from '@app/shared'
import { hc } from 'hono/client'

export const TERMINAL_ID_KEY = 'eye.active-terminal-id'
export const TERMINAL_SESSION_KEY = 'eye.active-terminal-session'

export function storeTerminalSession(terminalId: string, sessionToken: string): void {
  sessionStorage.setItem(TERMINAL_ID_KEY, terminalId)
  sessionStorage.setItem(TERMINAL_SESSION_KEY, sessionToken)
}

export function clearTerminalSession(): void {
  sessionStorage.removeItem(TERMINAL_ID_KEY)
  sessionStorage.removeItem(TERMINAL_SESSION_KEY)
}

// 型のついた Hono RPC クライアント。API は同じオリジンにある（1 つの Worker が
// SPA と API を配る）ので base は '/' でよい。`authFetch` が bearer を付ける。
export const domainFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers)
  const terminalId = sessionStorage.getItem(TERMINAL_ID_KEY)
  const terminalSession = sessionStorage.getItem(TERMINAL_SESSION_KEY)
  if (terminalId !== null && terminalSession !== null) {
    headers.set('x-terminal-id', terminalId)
    headers.set('x-terminal-session', terminalSession)
  }
  const response = await auth.authFetch(input, { ...init, headers })
  if (response.status === 403) {
    const failure = (await response
      .clone()
      .json()
      .catch(() => null)) as {
      error?: unknown
      subject?: unknown
    } | null
    if (
      failure?.error === 'personal_mode_required' &&
      typeof failure.subject === 'string' &&
      failure.subject !== '設定の変更'
    ) {
      window.dispatchEvent(
        new CustomEvent('eye:personal-mode-required', { detail: { subject: failure.subject } }),
      )
    }
  }
  return response
}

export const client = hc<AppType>('/', { fetch: domainFetch })

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
