// Minimal frontend auth: stores a JWT and attaches it to requests. The token
// is issued by the same-origin /api/auth/token endpoint (dev grant in this
// template — replace with a real credential/IdP flow before production).
const TOKEN_KEY = 'app.auth.token'
const ORG_KEY = 'app.auth.org'

/*
 * メモリ保持の資格情報。
 *
 * 業務端末（glasses_management の `/s/:slug`）は 15 分の access トークンを
 * **sessionStorage に置かない**。置くと、タブを閉じて開き直したとき、残った古い
 * トークンで動こうとして 401 を踏む。正しい経路は端末の資格情報（HttpOnly
 * Cookie）から黙って取り直すことなので、access はメモリだけに持つ。
 *
 * 他サービスは従来どおり `login()` が sessionStorage に書く。メモリが空のときは
 * そちらを読むので、既存の経路は何も変わらない。
 */
let memoryToken: string | null = null
let memoryOrg: string | null = null

/** メモリに資格情報を置く（sessionStorage には書かない）。 */
export function setSession(token: string, organizationId: string): void {
  memoryToken = token
  memoryOrg = organizationId
}

/** メモリだけを空にする（sessionStorage は触らない）。テストと再ログインで使う。 */
export function clearSession(): void {
  memoryToken = null
  memoryOrg = null
}

export function getToken(): string | null {
  return memoryToken ?? sessionStorage.getItem(TOKEN_KEY)
}

export function getOrganization(): string | null {
  return memoryOrg ?? sessionStorage.getItem(ORG_KEY)
}

export function logout(): void {
  clearSession()
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(ORG_KEY)
}

// Dev login: exchanges an organization id for a JWT (same origin — the SPA is
// served by the same Worker as the API).
export async function login(organizationId: string): Promise<void> {
  const res = await fetch('/api/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  })
  if (!res.ok) throw new Error(`login failed: ${res.status}`)
  const data = (await res.json()) as { token: string }
  sessionStorage.setItem(TOKEN_KEY, data.token)
  sessionStorage.setItem(ORG_KEY, organizationId)
}

// fetch wrapper that adds the bearer token. Pass as hc's `fetch` option.
// NOTE (template limitation): no token refresh — callers should treat a 401 as
// "session expired" and send the user back to sign-in (see example_service App).
export function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}
