/**
 * Access tokens are memory-only. The opaque refresh credential remains an
 * HttpOnly EYEX-origin cookie owned by the Worker auth proxy.
 */
let accessToken: string | null = null
let refreshInFlight: Promise<boolean> | undefined

async function refresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    try {
      const response = await fetch('/api/auth/refresh', { method: 'POST' })
      if (!response.ok) {
        accessToken = null
        return false
      }
      const value = (await response.json()) as unknown
      if (
        typeof value !== 'object' ||
        value === null ||
        !('token' in value) ||
        typeof value.token !== 'string'
      ) {
        accessToken = null
        return false
      }
      accessToken = value.token
      return true
    } catch {
      return false
    } finally {
      refreshInFlight = undefined
    }
  })()
  return refreshInFlight
}

export async function bootstrap(): Promise<boolean> {
  return accessToken !== null || refresh()
}

/** Authenticate through the EYEX Worker, never directly against admin. */
export async function login(email: string, password: string): Promise<boolean> {
  try {
    const stretched = await stretchPassword(password, email)
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, stretched }),
    })
    if (!response.ok) return false
    const value = (await response.json()) as unknown
    if (
      typeof value !== 'object' ||
      value === null ||
      !('token' in value) ||
      typeof value.token !== 'string'
    )
      return false
    accessToken = value.token
    return true
  } catch {
    return false
  }
}

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const send = () => {
    const headers = new Headers(init.headers)
    // The staff session token is a default, not an override. A caller that set
    // `authorization` itself is presenting a different, narrower proof — a
    // personal re-authentication grant — and replacing it would let a
    // management action run as ordinary staff work (AC-EYEX-82, 87, 101).
    if (accessToken && !headers.has('authorization'))
      headers.set('authorization', `Bearer ${accessToken}`)
    return fetch(input, { ...init, headers })
  }
  const response = await send()
  if (response.status !== 401 || !(await refresh())) return response
  return send()
}

/** Test-only reset; production exposes no token persistence or setter. */
export function resetSessionForTest() {
  accessToken = null
  refreshInFlight = undefined
}

import { stretchPassword } from '@app/shared'
