import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * UC-EYE-149 の画面。一覧・検索・権限差分の提示と、標準ロール/担当店舗の変更、
 * PIN 再設定の開始(PIN 自体は決して表示しない)。
 */

const api = vi.hoisted(() => ({
  getUsers: vi.fn<(request?: unknown) => Promise<Response>>(),
  patchUser: vi.fn<(request: unknown) => Promise<Response>>(),
  getAudits: vi.fn<(request: unknown) => Promise<Response>>(),
  startPinReset: vi.fn<(request: unknown) => Promise<Response>>(),
  getStores: vi.fn<(request: unknown) => Promise<Response>>(),
}))

/** 担当店舗の一覧は JWT の会社で引く。画面はこの会社しか知らない。 */
const session = vi.hoisted(() => ({ currentClaims: vi.fn() }))

vi.mock('../auth/session', async () => {
  const actual = await vi.importActual<typeof import('../auth/session')>('../auth/session')
  return { ...actual, currentClaims: session.currentClaims }
})

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return {
    ...actual,
    client: {
      api: {
        organizations: { ':id': { stores: { $get: api.getStores } } },
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
const OTHER_STORE = '22222222-2222-4222-8222-222222222222'
const STORE_ROW = {
  organizationId: 'eyex',
  phone: '',
  address: '',
  accessNote: '',
  isActive: true,
  createdAt: '2026-09-05T00:00:00.000Z',
}

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
  api.getStores.mockImplementation(async () =>
    json([
      { ...STORE_ROW, id: STORE, name: '銀座店', slug: 'ginza' },
      { ...STORE_ROW, id: OTHER_STORE, name: '丸の内店', slug: 'marunouchi' },
    ]),
  )
  session.currentClaims.mockReturnValue({ sub: 'op-1', org: 'eyex' })
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
    // 店舗 id は手で打たない。会社のお店を一覧から選ぶ（014-store-provisioning）。
    // 銀座店は既に担当なので、丸の内店を足して 2 店になる。
    await user.click(within(dialog).getByRole('checkbox', { name: '丸の内店' }))
    await user.click(within(dialog).getByRole('button', { name: '変更を保存' }))

    expect(api.patchUser).toHaveBeenCalledWith({
      param: { id: 'u-staff' },
      json: { standardRole: 'store_manager', storeIds: [STORE, OTHER_STORE] },
    })
  })

  it('担当店舗は会社のお店の一覧から選ぶ', async () => {
    const user = userEvent.setup()
    render(<Users />)
    const row = await screen.findByRole('listitem')
    await user.click(within(row).getByRole('button', { name: '権限を変更' }))
    const dialog = await screen.findByRole('dialog', { name: /権限と担当店舗/ })

    expect(api.getStores).toHaveBeenCalledWith({ param: { id: 'eyex' } })
    expect(within(dialog).getByRole('checkbox', { name: '銀座店' })).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: '丸の内店' })).toBeInTheDocument()
  })

  it('いま担当しているお店には最初から印が付く', async () => {
    const user = userEvent.setup()
    render(<Users />)
    const row = await screen.findByRole('listitem')
    await user.click(within(row).getByRole('button', { name: '権限を変更' }))
    const dialog = await screen.findByRole('dialog', { name: /権限と担当店舗/ })

    expect(within(dialog).getByRole('checkbox', { name: '銀座店' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: '丸の内店' })).not.toBeChecked()
  })

  it('お店が 1 つも無ければ、先に登録が要ると伝える', async () => {
    api.getStores.mockImplementation(async () => json([]))
    const user = userEvent.setup()
    render(<Users />)
    const row = await screen.findByRole('listitem')
    await user.click(within(row).getByRole('button', { name: '権限を変更' }))
    const dialog = await screen.findByRole('dialog', { name: /権限と担当店舗/ })

    expect(
      within(dialog).getByText('この会社にはまだお店がありません。先にお店を登録してください。'),
    ).toBeInTheDocument()
  })

  it('お店の一覧を引けなくても、権限の変更まで止めない', async () => {
    api.getStores.mockImplementation(async () => json({ error: 'domain_unavailable' }, 502))
    const user = userEvent.setup()
    render(<Users />)
    const row = await screen.findByRole('listitem')
    await user.click(within(row).getByRole('button', { name: '権限を変更' }))
    const dialog = await screen.findByRole('dialog', { name: /権限と担当店舗/ })

    expect(
      within(dialog).getByText('お店の一覧を読み込めませんでした。担当店舗はそのままにします。'),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '変更を保存' })).toBeEnabled()
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
