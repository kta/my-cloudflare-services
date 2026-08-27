import { afterEach, describe, expect, it, vi } from 'vitest'
import { authFetch, bootstrap, resetSessionForTest } from './staff-session'

afterEach(() => {
  resetSessionForTest()
  vi.unstubAllGlobals()
})

describe('EYEX staff session', () => {
  it('restores the access token from the same-origin refresh endpoint and attaches it to staff APIs', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'restored-token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await expect(bootstrap()).resolves.toBe(true)
    await authFetch('/api/staff/stores')

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/auth/refresh', { method: 'POST' })
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
      'Bearer restored-token',
    )
  })
})
