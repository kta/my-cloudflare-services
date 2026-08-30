import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * UC-EYEX-149 の画面。一覧・検索・権限差分の提示と、標準ロール/担当店舗の変更、
 * PIN 再設定の開始(PIN 自体は決して表示しない)。
 */

const api = vi.hoisted(() => ({
  getUsers: vi.fn<(request?: unknown) => Promise<Response>>(),
  patchUser: vi.fn<(request: unknown) => Promise<Response>>(),
  getAudits: vi.fn<(request: unknown) => Promise<Response>>(),
  startPinReset: vi.fn<(request: unknown) => Promise<Response>>(),
}))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return {
    ...actual,
    client: {
      api: {
        users: {
          $get: api.getUsers,
          ':id': {
            $patch: api.patchUser,
            audits: { $get: api.getAudits },
            'pin-reset': { $post: api.startPinReset },
          },
        },
      },
    },
  }
})

import { Users } from './Users'

const dialogPrototype = HTMLDialogElement.prototype
const showModalDescriptor = Object.getOwnPropertyDescriptor(dialogPrototype, 'showModal')
const closeDescriptor = Object.getOwnPropertyDescriptor(dialogPrototype, 'close')

function installDialogShim(): void {
  Object.defineProperty(dialogPrototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    },
  })
  Object.defineProperty(dialogPrototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    },
  })
}

function restoreDialogShim(): void {
  if (showModalDescriptor) Object.defineProperty(dialogPrototype, 'showModal', showModalDescriptor)
  else Reflect.deleteProperty(dialogPrototype, 'showModal')
  if (closeDescriptor) Object.defineProperty(dialogPrototype, 'close', closeDescriptor)
  else Reflect.deleteProperty(dialogPrototype, 'close')
}

const STORE = '11111111-1111-4111-8111-111111111111'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const staffUser = {
  id: 'u-staff',
  email: 'tenin@tenant.test',
  role: 'staff' as const,
  standardRole: 'staff' as const,
  assignments: [{ storeId: STORE, permissions: ['store.read', 'audit.read'] }],
  permissionDifference: { missing: ['reservation.write'], extra: ['audit.read'] },
  hasPin: true,
  createdAt: '2026-08-01T00:00:00.000Z',
}

beforeEach(() => {
  installDialogShim()
  // Response は 1 度しか読めないため、呼び出しごとに新しく作る。
  api.getUsers.mockImplementation(async () => json([staffUser]))
  api.getAudits.mockImplementation(async () => json([]))
  api.patchUser.mockImplementation(async () =>
    json({ ...staffUser, standardRole: 'store_manager', role: 'admin' }),
  )
  api.startPinReset.mockImplementation(async () =>
    json({ id: 't-1', userId: 'u-staff', status: 'pending', expiresAt: 'x', createdAt: 'y' }, 201),
  )
})

afterEach(() => {
  restoreDialogShim()
  vi.clearAllMocks()
})

describe('Users', () => {
  it('利用者を一覧し、標準ロールとの権限差分を明示する', async () => {
    render(<Users />)
    const row = await screen.findByRole('listitem')
    expect(within(row).getByText('tenin@tenant.test')).toBeInTheDocument()
    expect(within(row).getByText(/超過/)).toHaveTextContent('audit.read')
    expect(within(row).getByText(/不足/)).toHaveTextContent('reservation.write')
  })

  it('検索条件をサーバへ渡す(組織はサーバが JWT から決める)', async () => {
    const user = userEvent.setup()
    render(<Users />)
    await screen.findByRole('listitem')
    await user.type(screen.getByLabelText('氏名・メールで検索'), 'tenin')
    await user.selectOptions(screen.getByLabelText('標準ロール'), 'staff')
    await user.type(screen.getByLabelText('担当店舗 ID'), STORE)
    await user.click(screen.getByRole('button', { name: '検索' }))

    expect(api.getUsers).toHaveBeenLastCalledWith({
      query: { q: 'tenin', standardRole: 'staff', storeId: STORE },
    })
    expect(JSON.stringify(api.getUsers.mock.lastCall)).not.toContain('organizationId')
  })

  it('標準ロールと担当店舗の変更を送る', async () => {
    const user = userEvent.setup()
    render(<Users />)
    const row = await screen.findByRole('listitem')
    await user.click(within(row).getByRole('button', { name: '権限を変更' }))
    const dialog = await screen.findByRole('dialog', { name: /権限と担当店舗/ })
    await user.selectOptions(within(dialog).getByLabelText('標準ロール'), 'store_manager')
    const stores = within(dialog).getByLabelText('担当店舗 ID(改行区切り)')
    await user.clear(stores)
    await user.type(stores, STORE)
    await user.click(within(dialog).getByRole('button', { name: '変更を保存' }))

    expect(api.patchUser).toHaveBeenCalledWith({
      param: { id: 'u-staff' },
      json: { standardRole: 'store_manager', storeIds: [STORE] },
    })
  })

  it('同期失敗は再送できる案内として示し、変更自体は保持されたと伝える', async () => {
    const user = userEvent.setup()
    api.patchUser.mockImplementation(async () =>
      json({ error: 'store_membership_sync_failed', userId: 'u-staff', retryable: true }, 502),
    )
    render(<Users />)
    const row = await screen.findByRole('listitem')
    await user.click(within(row).getByRole('button', { name: '権限を変更' }))
    const dialog = await screen.findByRole('dialog', { name: /権限と担当店舗/ })
    await user.click(within(dialog).getByRole('button', { name: '変更を保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('同期')
  })

  it('PIN 再設定は本人確認の記録を必須にし、PIN を表示しない', async () => {
    const user = userEvent.setup()
    render(<Users />)
    const row = await screen.findByRole('listitem')
    await user.click(within(row).getByRole('button', { name: 'PIN 再設定' }))
    const dialog = await screen.findByRole('dialog', { name: /PIN 再設定/ })

    const submit = within(dialog).getByRole('button', { name: '再設定を開始' })
    expect(submit).toBeDisabled()
    await user.type(within(dialog).getByLabelText('本人確認の記録'), '店頭で社員証を確認')
    await user.click(submit)

    expect(api.startPinReset).toHaveBeenCalledWith({
      param: { id: 'u-staff' },
      json: { verificationMethod: 'in_person', verificationNote: '店頭で社員証を確認' },
    })
    expect(document.body.textContent).not.toMatch(/PIN は\s*\d/)
    expect(document.body.textContent).not.toContain('hmac$')
  })

  it('読み込み失敗を通知する', async () => {
    api.getUsers.mockImplementation(async () => json({ error: 'internal_error' }, 500))
    render(<Users />)
    expect(await screen.findByRole('alert')).toHaveTextContent('利用者')
  })
})
