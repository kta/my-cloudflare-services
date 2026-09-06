/*
 * 業務開始で送るのは「伸ばした暗証番号」であって、平文ではない。
 *
 * デプロイ先の workerd は PBKDF2 の iterations が 10 万回までなので、サーバ側で
 * 既定の 60 万回を回すと実機でだけ落ちる（ローカルの workerd はこの上限を課さない）。
 * ストレッチングがブラウザ側にあることを、送信の中身で固定する。
 */
import { stretchPin } from '@app/shared'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'

const STORE_ID = '11111111-2222-4333-8444-555555555555'
const TERMINAL_ID = '22222222-2222-4222-8222-222222222222'

const store = {
  id: STORE_ID,
  organizationId: 'eye',
  name: 'EYE 銀座店',
  slug: 'ginza',
  phone: '',
  address: '',
  accessNote: '',
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
}

const terminal = {
  id: TERMINAL_ID,
  storeId: STORE_ID,
  name: '銀座店 レジ横iPad',
  kind: 'shared',
  placeNote: 'レジの右側',
  deviceLabel: 'EYE-iPad-07',
  autoLockSeconds: 120,
  isActive: true,
  hasPin: true,
  lastSeenAt: null,
  isOnline: false,
  version: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  sessionStorage.clear()
  window.localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      if (url.includes('/api/auth/token')) return json({ token: 'test-token' })
      if (url.includes('/sessions') && init.method === 'POST') {
        return json({
          id: '33333333-3333-4333-8333-333333333333',
          terminalId: TERMINAL_ID,
          staffId: null,
          mode: 'shared',
          startedAt: '2026-08-27T02:08:00.000Z',
          expiresAt: '2026-08-27T12:00:00.000Z',
          sessionToken: 'a'.repeat(64),
        })
      }
      if (url.includes('/api/staff/terminals')) return json([terminal])
      if (url.includes('/api/staff/alerts'))
        return json({ items: [], counts: { all: 0, alert: 0, info: 0, done: 0 } })
      if (url.includes('/business-hours')) return json({ rows: [] })
      if (url.includes('/staff-shifts')) return json([])
      if (url.includes('/api/staff/stores')) return json([store])
      if (url.includes('/staff')) return json([])
      return new Response('not found', { status: 404 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('業務開始で送る暗証番号', () => {
  it('平文ではなく、伸ばした値を送る', async () => {
    render(<App />)
    await userEvent.type(screen.getByLabelText('お店のコード'), 'eye')
    await userEvent.click(screen.getByRole('button', { name: '業務を始める' }))

    await userEvent.click(await screen.findByRole('button', { name: 'みんなで使う端末にする' }))
    await userEvent.click(await screen.findByRole('button', { name: /銀座店 レジ横iPad/ }))
    await userEvent.click(screen.getByRole('button', { name: 'この置き場所で始める' }))

    for (const digit of ['2', '5', '8', '0']) {
      await userEvent.click(await screen.findByRole('button', { name: digit }))
    }
    await userEvent.click(screen.getByRole('button', { name: /確定/ }))

    const call = await waitFor(() => {
      const found = vi
        .mocked(fetch)
        .mock.calls.find(
          ([url, init]) => String(url).includes('/sessions') && init?.method === 'POST',
        )
      if (!found) throw new Error('セッション開始が送られていない')
      return found
    })
    const body = JSON.parse(String(call[1]?.body)) as Record<string, unknown>

    expect(body).not.toHaveProperty('pin')
    expect(JSON.stringify(body)).not.toContain('2580')
    // salt は共有モードなら端末 id（seed と worker が同じ組み立てをする）。
    expect(body.stretchedPin).toBe(await stretchPin('2580', 'eye', TERMINAL_ID))
  })
})
