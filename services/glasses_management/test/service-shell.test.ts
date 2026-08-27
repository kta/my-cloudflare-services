import { SELF } from 'cloudflare:test'
import { expect, test } from 'vitest'

test('returns the glasses-management health response', async () => {
  const response = await SELF.fetch('https://example.test/api/health')

  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({ status: 'ok' })
})
