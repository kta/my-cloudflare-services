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

it('never replaces an authorization the caller set deliberately', async () => {
  // A personal re-authentication grant travels in `authorization`. Overwriting
  // it with the staff session token silently downgrades a management action to
  // an ordinary one, so the worker would run it without the personal proof it
  // demanded (UC-EYEX-138, AC-EYEX-87, 101).
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'staff-token' }), { status: 200 }))
    .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    .mockResolvedValueOnce(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  await bootstrap()

  await authFetch('/api/shared-terminals/t/stores/s/attention-notes/n/review', {
    method: 'POST',
    headers: { authorization: 'Bearer reauth-grant' },
  })
  await authFetch('/api/staff/stores')

  expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
    'Bearer reauth-grant',
  )
  // The ordinary call still gets the staff session token.
  expect(new Headers(fetch.mock.calls[2]?.[1]?.headers).get('authorization')).toBe(
    'Bearer staff-token',
  )
})
