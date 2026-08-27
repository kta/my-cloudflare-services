import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'

describe('domain authentication proxy', () => {
  it('keeps the refresh credential in an EYEX HttpOnly cookie and sends only the access token to the browser', async () => {
    const login = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.44' },
      body: JSON.stringify({ email: 'staff@example.test', stretched: 'client-stretched-proof' }),
    })
    expect(login.status).toBe(200)
    await expect(login.json()).resolves.toEqual({
      token: 'access-token',
      user: { id: 'user-id', email: 'staff@example.test', role: 'staff' },
      organization: { id: 'org-id', name: '組織', plan: 'free', isDisabled: false },
    })
    expect(login.headers.get('set-cookie')).toMatch(/HttpOnly/)
    expect(login.headers.get('set-cookie')).toMatch(/SameSite=Strict/)
  })
})
