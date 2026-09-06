import { auth } from '@app/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSiteContext,
  clearTerminalSession,
  domainFetch,
  setSiteContext,
  storeTerminalSession,
  TERMINAL_ID_KEY,
  TERMINAL_SESSION_KEY,
} from './client'

beforeEach(() => {
  sessionStorage.clear()
  sessionStorage.setItem('app.auth.token', 'header.payload.signature')
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('端末session credential', () => {
  it('sessionStorageのID/token pairだけを業務API headerへ送る', async () => {
    storeTerminalSession('11111111-1111-4111-8111-111111111111', 't'.repeat(64))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('x-terminal-id')).toBe('11111111-1111-4111-8111-111111111111')
      expect(headers.get('x-terminal-session')).toBe('t'.repeat(64))
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    expect((await domainFetch('/api/staff/alerts')).status).toBe(200)
  })

  it('pairの片方しか無い壊れた状態ではterminal headerを送らない', async () => {
    sessionStorage.setItem(TERMINAL_ID_KEY, '11111111-1111-4111-8111-111111111111')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.has('x-terminal-id')).toBe(false)
      expect(headers.has('x-terminal-session')).toBe(false)
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await domainFetch('/api/staff/stores')
  })

  it('rotationは両方を置き換え、clearは平文tokenもIDも消す', () => {
    storeTerminalSession('11111111-1111-4111-8111-111111111111', 'a'.repeat(64))
    storeTerminalSession('22222222-2222-4222-8222-222222222222', 'b'.repeat(64))
    expect(sessionStorage.getItem(TERMINAL_ID_KEY)).toBe('22222222-2222-4222-8222-222222222222')
    expect(sessionStorage.getItem(TERMINAL_SESSION_KEY)).toBe('b'.repeat(64))
    clearTerminalSession()
    expect(sessionStorage.getItem(TERMINAL_ID_KEY)).toBeNull()
    expect(sessionStorage.getItem(TERMINAL_SESSION_KEY)).toBeNull()
  })
})

/**
 * 15 分で切れる access トークンを、端末の資格情報から黙って取り直す。
 *
 * これが無いと業務中に暗証番号を打ち直すことになる。**パスワードは決して
 * 求めない** —— 取り直せないときだけ入口へ戻す。
 */
describe('黙った更新', () => {
  beforeEach(() => {
    sessionStorage.clear()
    auth.clearSession()
    setSiteContext('ginza', 't1')
  })

  it('401 を受けたら更新を 1 回試し、成功したら元の要求をやり直す', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        calls.push(url)
        if (url.includes('/sessions/refresh')) {
          return new Response(JSON.stringify({ token: 'fresh' }), { status: 200 })
        }
        // 1 回目は 401、更新後の 2 回目は 200。
        const business = calls.filter((c) => c.includes('/api/staff/stores')).length
        return new Response('{}', { status: business === 1 ? 401 : 200 })
      }),
    )
    const res = await domainFetch('/api/staff/stores')
    expect(res.status).toBe(200)
    expect(calls.filter((c) => c.includes('/sessions/refresh'))).toHaveLength(1)
    expect(auth.getToken()).toBe('fresh')
  })

  it('更新も 401 なら、元の 401 をそのまま返す（パスワードは求めない）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/sessions/refresh')
          ? new Response('{}', { status: 401 })
          : new Response('{}', { status: 401 }),
      ),
    )
    const res = await domainFetch('/api/staff/stores')
    expect(res.status).toBe(401)
  })

  it('入口を通っていない（slug も端末も無い）ときは更新を試さない', async () => {
    clearSiteContext()
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(String(input))
        return new Response('{}', { status: 401 })
      }),
    )
    const res = await domainFetch('/api/staff/stores')
    expect(res.status).toBe(401)
    expect(seen.some((url) => url.includes('/refresh'))).toBe(false)
  })

  it('同時に走った 2 本の 401 で更新は 1 回しか走らない', async () => {
    let refreshes = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/sessions/refresh')) {
          refreshes += 1
          return new Response(JSON.stringify({ token: 'fresh' }), { status: 200 })
        }
        return new Response('{}', { status: auth.getToken() === 'fresh' ? 200 : 401 })
      }),
    )
    await Promise.all([domainFetch('/api/staff/stores'), domainFetch('/api/staff/staff')])
    expect(refreshes).toBe(1)
  })
})
