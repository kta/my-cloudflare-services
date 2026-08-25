import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { internalAuth } from '../src/internal'

const KEY = 'secret-internal-key'

function makeApp() {
  const app = new Hono<{ Bindings: { INTERNAL_KEY: string } }>()
  app.use('/api/internal/*', internalAuth())
  app.get('/api/internal/x', (c) => c.json({ ok: true }))
  return app
}

describe('internalAuth', () => {
  it('正しい x-internal-key で通す', async () => {
    const res = await makeApp().request(
      '/api/internal/x',
      { headers: { 'x-internal-key': KEY } },
      { INTERNAL_KEY: KEY },
    )
    expect(res.status).toBe(200)
  })

  it('ヘッダ無し / 不一致 / 長さ違いは 401', async () => {
    const app = makeApp()
    const none = await app.request('/api/internal/x', {}, { INTERNAL_KEY: KEY })
    expect(none.status).toBe(401)
    const wrong = await app.request(
      '/api/internal/x',
      { headers: { 'x-internal-key': 'secret-internal-kex' } },
      { INTERNAL_KEY: KEY },
    )
    expect(wrong.status).toBe(401)
    const short = await app.request(
      '/api/internal/x',
      { headers: { 'x-internal-key': 'k' } },
      { INTERNAL_KEY: KEY },
    )
    expect(short.status).toBe(401)
  })

  it('fail close: secret 未設定なら正解相当のヘッダでも全拒否', async () => {
    // 未設定 env と欠落ヘッダが undefined 同士で一致して素通りする事故の回帰テスト
    const res = await makeApp().request(
      '/api/internal/x',
      { headers: { 'x-internal-key': '' } },
      { INTERNAL_KEY: '' },
    )
    expect(res.status).toBe(401)
  })
})
