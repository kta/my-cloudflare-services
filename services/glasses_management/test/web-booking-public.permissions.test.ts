import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'

describe('public web-booking routes', () => {
  it('allows the public store portal to be read without a staff JWT', async () => {
    const response = await SELF.fetch(`${BASE}/api/public/stores`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
  })
})
