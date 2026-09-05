import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authFetch,
  clearSession,
  getOrganization,
  getToken,
  login,
  logout,
  setSession,
} from '../src/auth'

// node 環境に sessionStorage は無いので Map で代替する(挙動は Storage 互換の範囲)。
function stubSessionStorage() {
  const store = new Map<string, string>()
  const stub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  vi.stubGlobal('sessionStorage', stub)
}

beforeEach(stubSessionStorage)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('dev token grant client', () => {
  it('login 成功で token/org を保存し、logout で消す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ token: 't1' }), { status: 200 })),
    )
    await login('org-1')
    expect(getToken()).toBe('t1')
    expect(getOrganization()).toBe('org-1')
    logout()
    expect(getToken()).toBeNull()
    expect(getOrganization()).toBeNull()
  })

  it('login 失敗(非 2xx)は throw し、何も保存しない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    )
    await expect(login('org-1')).rejects.toThrow('login failed: 404')
    expect(getToken()).toBeNull()
  })

  it('authFetch は token があるときだけ bearer を付ける', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    await authFetch('/api/items')
    let headers = fetchSpy.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get('authorization')).toBeNull()

    sessionStorage.setItem('app.auth.token', 't2')
    await authFetch('/api/items')
    headers = fetchSpy.mock.calls[1]?.[1]?.headers as Headers
    expect(headers.get('authorization')).toBe('Bearer t2')
  })
})

/**
 * メモリ保持のトークン。
 *
 * 業務端末は 15 分の access トークンを **sessionStorage に置かない**。置くと、
 * タブを閉じても残った古いトークンで動こうとして 401 を踏む。端末の資格情報
 * (HttpOnly Cookie) から黙って取り直すのが正しい経路なので、access は
 * メモリだけに持つ。
 *
 * 他サービス(example_service 等)は従来どおり sessionStorage の login() を使うので、
 * メモリが空のときは sessionStorage を読む。
 */
describe('setSession（メモリ保持）', () => {
  beforeEach(clearSession)
  afterEach(clearSession)

  it('メモリのトークンと組織を返し、sessionStorage には書かない', () => {
    setSession('tok', 'eye')
    expect(getToken()).toBe('tok')
    expect(getOrganization()).toBe('eye')
    expect(sessionStorage.getItem('app.auth.token')).toBeNull()
    expect(sessionStorage.getItem('app.auth.org')).toBeNull()
  })

  it('メモリが空なら sessionStorage を読む（既存サービスの経路）', () => {
    sessionStorage.setItem('app.auth.token', 'stored')
    sessionStorage.setItem('app.auth.org', 'other')
    expect(getToken()).toBe('stored')
    expect(getOrganization()).toBe('other')
  })

  it('メモリは sessionStorage より優先される', () => {
    sessionStorage.setItem('app.auth.token', 'stored')
    setSession('tok', 'eye')
    expect(getToken()).toBe('tok')
  })

  it('logout はメモリと sessionStorage の両方を消す', () => {
    sessionStorage.setItem('app.auth.token', 'stored')
    setSession('tok', 'eye')
    logout()
    expect(getToken()).toBeNull()
    expect(getOrganization()).toBeNull()
  })

  it('authFetch はメモリのトークンを bearer に載せる', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    setSession('tok', 'eye')
    await authFetch('/api/staff/stores')
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok')
  })
})
