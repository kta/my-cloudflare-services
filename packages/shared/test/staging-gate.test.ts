/**
 * staging ゲート。`*.workers.dev` は URL を知る誰でも叩けるため、staging だけ
 * トークンを要求する。production は `STAGING_ACCESS_TOKEN` を設定しないので
 * この分岐は死ぬ — その「素通り」こそ最も壊してはいけない性質なので先に固定する。
 */
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { STAGING_GATE_COOKIE, stagingGate } from '../src/staging-gate'

const TOKEN = 'staging-token-0123456789abcdef'

function app() {
  const a = new Hono<{ Bindings: { STAGING_ACCESS_TOKEN?: string } }>()
  a.use('*', stagingGate())
  a.get('/', (c) => c.text('home'))
  a.get('/api/internal/ping', (c) => c.text('internal'))
  a.get('/api/items', (c) => c.text('items'))
  return a
}

describe('stagingGate', () => {
  it('STAGING_ACCESS_TOKEN 未設定なら素通りする(production の挙動)', async () => {
    const res = await app().request('/', {}, {})
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('home')
  })

  it('設定済みで資格が無ければ 401', async () => {
    const res = await app().request('/', {}, { STAGING_ACCESS_TOKEN: TOKEN })
    expect(res.status).toBe(401)
  })

  it('未知のパスも 401(default-deny)', async () => {
    const res = await app().request('/no/such/path', {}, { STAGING_ACCESS_TOKEN: TOKEN })
    expect(res.status).toBe(401)
  })

  it('/api/internal/* はゲートの対象外(x-internal-key が守る)', async () => {
    const res = await app().request('/api/internal/ping', {}, { STAGING_ACCESS_TOKEN: TOKEN })
    expect(res.status).toBe(200)
  })

  it('?gate=<token> が一致したら Cookie を発行してクエリを落としたパスへ 302', async () => {
    const res = await app().request(`/api/items?gate=${TOKEN}`, {}, { STAGING_ACCESS_TOKEN: TOKEN })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/api/items')
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${STAGING_GATE_COOKIE}=${TOKEN}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('gate 以外のクエリは残す', async () => {
    const res = await app().request(
      `/api/items?a=1&gate=${TOKEN}&b=2`,
      {},
      { STAGING_ACCESS_TOKEN: TOKEN },
    )
    expect(res.headers.get('location')).toBe('/api/items?a=1&b=2')
  })

  it('誤った ?gate= は 401(リダイレクトしない)', async () => {
    const res = await app().request('/api/items?gate=wrong', {}, { STAGING_ACCESS_TOKEN: TOKEN })
    expect(res.status).toBe(401)
  })

  it('正しい Cookie があれば通す', async () => {
    const res = await app().request(
      '/api/items',
      { headers: { cookie: `${STAGING_GATE_COOKIE}=${TOKEN}` } },
      { STAGING_ACCESS_TOKEN: TOKEN },
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('items')
  })

  it('誤った Cookie は 401', async () => {
    const res = await app().request(
      '/api/items',
      { headers: { cookie: `${STAGING_GATE_COOKIE}=wrong-token` } },
      { STAGING_ACCESS_TOKEN: TOKEN },
    )
    expect(res.status).toBe(401)
  })

  it('401 の本文はトークンの手掛かりを含まない', async () => {
    const res = await app().request('/', {}, { STAGING_ACCESS_TOKEN: TOKEN })
    expect(await res.text()).not.toContain(TOKEN)
  })
})
