import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** UC-EYE-151: 本人による PIN 設定・変更。平文 PIN はブラウザから出さない。 */

const api = vi.hoisted(() => ({
  getPin: vi.fn<() => Promise<Response>>(),
  setPin: vi.fn<(request: unknown) => Promise<Response>>(),
}))
const session = vi.hoisted(() => ({
  currentClaims: vi.fn<() => { sub: string; org: string } | null>(),
}))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return {
    ...actual,
    client: { api: { me: { pin: { $get: api.getPin, $post: api.setPin } } } },
  }
})
vi.mock('../auth/session', async () => {
  const actual = await vi.importActual<typeof import('../auth/session')>('../auth/session')
  return { ...actual, currentClaims: session.currentClaims }
})

import { Pin } from './Pin'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  session.currentClaims.mockReturnValue({ sub: 'u-staff', org: 'org-1' })
  api.getPin.mockImplementation(async () => json({ hasPin: false }))
  api.setPin.mockImplementation(async () => json({ ok: true, hasPin: true }))
})

afterEach(() => vi.clearAllMocks())

describe('Pin', () => {
  it('平文 PIN を送らず、ストレッチ済みの値だけを送る', async () => {
    const user = userEvent.setup()
    render(<Pin />)
    await screen.findByText('未設定')
    await user.type(screen.getByLabelText('新しい PIN(4〜6 桁)'), '1234')
    await user.click(screen.getByRole('button', { name: 'PIN を設定' }))

    await waitFor(() => expect(api.setPin).toHaveBeenCalledTimes(1))
    const payload = JSON.stringify(api.setPin.mock.lastCall)
    expect(payload).not.toContain('1234')
    expect(payload).toContain('stretchedPin')
    expect(await screen.findByText('設定済み')).toBeInTheDocument()
  })

  it('設定済みなら現行 PIN を要求する', async () => {
    const user = userEvent.setup()
    api.getPin.mockImplementation(async () => json({ hasPin: true }))
    render(<Pin />)
    await screen.findByText('設定済み')
    await user.type(screen.getByLabelText('新しい PIN(4〜6 桁)'), '4321')
    await user.type(screen.getByLabelText('現在の PIN'), '1234')
    await user.click(screen.getByRole('button', { name: 'PIN を変更' }))

    await waitFor(() => expect(api.setPin).toHaveBeenCalledTimes(1))
    const payload = JSON.stringify(api.setPin.mock.lastCall)
    expect(payload).toContain('currentStretchedPin')
    expect(payload).not.toContain('1234')
    expect(payload).not.toContain('4321')
  })

  it('管理者が発行した再設定チケットで現行 PIN 無しに変更できる', async () => {
    const user = userEvent.setup()
    api.getPin.mockImplementation(async () => json({ hasPin: true }))
    render(<Pin />)
    await screen.findByText('設定済み')
    await user.type(screen.getByLabelText('新しい PIN(4〜6 桁)'), '5678')
    await user.type(screen.getByLabelText('再設定チケット ID'), 't-1')
    await user.click(screen.getByRole('button', { name: 'PIN を変更' }))

    await waitFor(() => expect(api.setPin).toHaveBeenCalledTimes(1))
    expect(JSON.stringify(api.setPin.mock.lastCall)).toContain('"resetTicketId":"t-1"')
  })

  it('4 桁未満は送信しない', async () => {
    const user = userEvent.setup()
    render(<Pin />)
    await screen.findByText('未設定')
    await user.type(screen.getByLabelText('新しい PIN(4〜6 桁)'), '12')
    expect(screen.getByRole('button', { name: 'PIN を設定' })).toBeDisabled()
    expect(api.setPin).not.toHaveBeenCalled()
  })

  it('失敗理由を PIN を明かさずに伝える', async () => {
    const user = userEvent.setup()
    api.getPin.mockImplementation(async () => json({ hasPin: true }))
    api.setPin.mockImplementation(async () => json({ error: 'pin_verification_failed' }, 401))
    render(<Pin />)
    await screen.findByText('設定済み')
    await user.type(screen.getByLabelText('新しい PIN(4〜6 桁)'), '4321')
    await user.type(screen.getByLabelText('現在の PIN'), '0000')
    await user.click(screen.getByRole('button', { name: 'PIN を変更' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('PIN')
    expect(alert.textContent).not.toContain('4321')
    expect(alert.textContent).not.toContain('0000')
  })
})
