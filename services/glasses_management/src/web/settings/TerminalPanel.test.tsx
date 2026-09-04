import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsScreen } from './SettingsScreen'

const STORE_ID = '11111111-1111-4111-8111-111111111111'
const terminal = {
  id: '22222222-2222-4222-8222-222222222222',
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
  createdAt: '2026-08-27T02:08:00.000Z',
}

beforeEach(() => {
  sessionStorage.setItem('eye.active-terminal-id', terminal.id)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      if (url.endsWith('/staff')) return new Response(JSON.stringify([]))
      if (url.includes('/api/staff/terminals')) {
        if (init.method === 'POST') {
          return new Response(
            JSON.stringify({
              ...terminal,
              id: '33333333-3333-4333-8333-333333333333',
              name: '銀座店 相談席iPad',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(
          JSON.stringify(
            (init.method ?? 'GET') === 'PATCH'
              ? { ...terminal, autoLockSeconds: 300, version: 2 }
              : [terminal],
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    }),
  )
})

afterEach(() => {
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

describe('設定 › 端末', () => {
  it('headerless保存では選択中terminal idを資格headerとして捏造しない', async () => {
    sessionStorage.clear()
    render(<SettingsScreen storeId={STORE_ID} initialSection="terminals" />)
    await userEvent.selectOptions(await screen.findByLabelText('自動で伏せるまで'), '300')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('保存しました')).toBeInTheDocument()

    const call = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) =>
          String(url).endsWith(`/api/staff/terminals/${terminal.id}`) && init?.method === 'PATCH',
      )
    const headers = new Headers(call?.[1]?.headers)
    expect(headers.has('x-terminal-id')).toBe(false)
    expect(headers.has('x-terminal-session')).toBe(false)
  })

  it('有効なsessionStorage pairはdomainFetchから設定保存へ両方送る', async () => {
    sessionStorage.setItem('eye.active-terminal-session', 'a'.repeat(64))
    render(<SettingsScreen storeId={STORE_ID} initialSection="terminals" />)
    await userEvent.selectOptions(await screen.findByLabelText('自動で伏せるまで'), '300')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('保存しました')).toBeInTheDocument()

    const call = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) =>
          String(url).endsWith(`/api/staff/terminals/${terminal.id}`) && init?.method === 'PATCH',
      )
    const headers = new Headers(call?.[1]?.headers)
    expect(headers.get('x-terminal-id')).toBe(terminal.id)
    expect(headers.get('x-terminal-session')).toBe('a'.repeat(64))
  })

  it('端末を選び、使い方・自動で伏せる時間・PINを同じ面で直せる', async () => {
    render(<SettingsScreen storeId={STORE_ID} initialSection="terminals" />)
    expect(await screen.findByRole('button', { name: /銀座店 レジ横iPad/ })).toBeInTheDocument()
    expect(screen.getByLabelText('置き場所')).toHaveValue('レジの右側')
    expect(screen.getByLabelText('使い方')).toHaveValue('shared')
    expect(screen.getByLabelText('自動で伏せるまで')).toHaveValue('120')
    expect(screen.getByLabelText('新しい暗証番号')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('新しい暗証番号')).toHaveAttribute('type', 'password')
    await userEvent.clear(screen.getByLabelText('置き場所'))
    await userEvent.type(screen.getByLabelText('置き場所'), '入口の相談席')
    await userEvent.selectOptions(screen.getByLabelText('自動で伏せるまで'), '1800')
    expect(screen.getByText('未保存の変更 2件')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('保存しました')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      `/api/staff/terminals/${terminal.id}`,
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"placeNote":"入口の相談席"'),
      }),
    )
    expect(fetch).toHaveBeenCalledWith(
      `/api/staff/terminals/${terminal.id}`,
      expect.objectContaining({ body: expect.stringContaining('"autoLockSeconds":1800') }),
    )
  })

  it('同じ面から端末を登録し、登録した端末を選択中にする', async () => {
    render(<SettingsScreen storeId={STORE_ID} initialSection="terminals" />)
    await userEvent.click(await screen.findByRole('button', { name: '端末を追加' }))
    await userEvent.type(screen.getByLabelText('端末名'), '銀座店 相談席iPad')
    await userEvent.type(screen.getByLabelText('新しい暗証番号'), '2580')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('保存しました')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /銀座店 相談席iPad/ })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      `/api/staff/terminals?storeId=${STORE_ID}`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('保存した端末を、業務中の端末状態へ通知する', async () => {
    const updated = vi.fn()
    window.addEventListener('eye:terminal-updated', updated)
    try {
      render(<SettingsScreen storeId={STORE_ID} initialSection="terminals" />)
      await userEvent.selectOptions(await screen.findByLabelText('自動で伏せるまで'), '300')
      await userEvent.click(screen.getByRole('button', { name: '保存' }))

      expect(updated).toHaveBeenCalledTimes(1)
      const event = updated.mock.calls[0]?.[0] as CustomEvent | undefined
      expect(event).toBeDefined()
      expect(event?.detail).toMatchObject({
        id: terminal.id,
        autoLockSeconds: 300,
      })
    } finally {
      window.removeEventListener('eye:terminal-updated', updated)
    }
  })
})
