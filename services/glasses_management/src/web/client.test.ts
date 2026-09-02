import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearTerminalSession,
  domainFetch,
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
