import type { AppType } from '@app/glasses_management'
import { auth } from '@app/shared'
import { hc } from 'hono/client'

export const TERMINAL_ID_KEY = 'eye.active-terminal-id'
export const TERMINAL_SESSION_KEY = 'eye.active-terminal-session'
/** 入口の住所（`/s/:slug`）。更新の宛先を組むのに要る。 */
const SITE_SLUG_KEY = 'eye.site-slug'

export function setSiteContext(slug: string, terminalId: string): void {
  sessionStorage.setItem(SITE_SLUG_KEY, slug)
  sessionStorage.setItem(TERMINAL_ID_KEY, terminalId)
}

export function clearSiteContext(): void {
  sessionStorage.removeItem(SITE_SLUG_KEY)
}

/*
 * 15 分で切れる access トークンを、端末の資格情報（HttpOnly Cookie）から
 * 黙って取り直す。
 *
 * これが無いと業務中に暗証番号を打ち直すことになる。**パスワードは決して
 * 求めない** —— 取り直せないときだけ、呼出元が入口へ戻す。
 *
 * 更新は 1 本に束ねる。画面は同時に複数の API を叩くので、束ねないと 401 の数だけ
 * 更新が走り、ローテーションが互いの資格情報を失効させ合う。
 */
let refreshing: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  const slug = sessionStorage.getItem(SITE_SLUG_KEY)
  const terminalId = sessionStorage.getItem(TERMINAL_ID_KEY)
  // 入口を通っていない（他サービス由来の経路）なら、更新すべきものが無い。
  if (slug === null || terminalId === null) return false

  refreshing ??= (async () => {
    try {
      const res = await fetch(
        `/api/public/sites/${encodeURIComponent(slug)}/terminals/${terminalId}/sessions/refresh`,
        { method: 'POST' },
      )
      if (!res.ok) return false
      const body = (await res.json()) as { token: string }
      auth.setSession(body.token, organizationOfToken(body.token) ?? '')
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

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
  let response = await auth.authFetch(input, { ...init, headers })
  if (response.status === 401 && (await refreshAccessToken())) {
    response = await auth.authFetch(input, { ...init, headers })
  }
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

/** JWT の本文を読むだけ（署名はサーバが確かめる）。読めなければ null。 */
function claimsOf(token: string | null): Record<string, unknown> | null {
  const payload = token?.split('.')[1]
  if (!payload) return null
  try {
    const decoded: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof decoded === 'object' && decoded !== null
      ? (decoded as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * いま業務をしている人の `sub`（JWT の本文から読むだけ。署名はサーバが確かめる）。
 * 断られたときの名乗り・「最後に直したのは」・手書きの記入者に使う。
 */
export function subjectFromToken(): string | null {
  const sub = claimsOf(auth.getToken())?.sub
  return typeof sub === 'string' ? sub : null
}

/** トークンが名乗る組織。業務端末は入口でこれを読んでセッションを立てる。 */
export function organizationOfToken(token: string): string | null {
  const org = claimsOf(token)?.org
  return typeof org === 'string' ? org : null
}
