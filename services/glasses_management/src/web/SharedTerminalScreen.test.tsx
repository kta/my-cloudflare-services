import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { SharedTerminalScreen } from './SharedTerminalScreen'

const STORE_ID = '00000000-0000-4000-8000-000000000010'
const NOW = '2026-08-27T05:30:00.000Z' // 14:30 JST

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

const registerDesk = {
  id: '00000000-0000-4000-8000-000000000201',
  organizationId: 'org-eyex',
  storeId: STORE_ID,
  name: 'レジ横iPad',
  status: 'active' as const,
  idleTimeoutSeconds: 120,
  expiresAt: '2026-09-27T05:00:00.000Z',
  lastSeenAt: '2026-08-27T05:29:00.000Z', // 1 minute before NOW
  createdAt: '2026-08-01T01:00:00.000Z',
  revokedAt: null,
}

const receptionDesk = {
  ...registerDesk,
  id: '00000000-0000-4000-8000-000000000202',
  name: '受付iPad',
  status: 'revoked' as const,
  lastSeenAt: null,
  revokedAt: '2026-08-20T02:00:00.000Z',
}

function renderScreen(
  api: ReturnType<typeof vi.fn>,
  extra: { idleLockSeconds?: { organizationDefault: number; storeOverride: number | null } } = {},
) {
  return render(
    <SharedTerminalScreen
      storeId={STORE_ID}
      storeName="銀座店"
      api={api as never}
      navigate={vi.fn()}
      now={NOW}
      {...extra}
    />,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('承認済みモックの共有iPadの節を出す (DEVICE-LIST)', async () => {
  const api = vi.fn(async () => jsonResponse([registerDesk]))
  renderScreen(api)

  const sections = await screen.findByRole('navigation', { name: '端末とセキュリティの節' })
  // 管理タブは 76px の緑バーが持つ。面が 2 本目の緑帯を持つのはモックに無い。
  expect(screen.queryByRole('navigation', { name: '設定タブ' })).toBeNull()
  for (const label of ['共有iPad', '無操作ロック', '個人PIN', '共有セッション'])
    expect(within(sections).getByRole('button', { name: label })).toBeInTheDocument()
  expect(within(sections).getByRole('button', { name: '共有iPad' })).toHaveAttribute(
    'aria-current',
    'page',
  )

  expect(screen.getByText('店舗へ登録された端末と共有セッション')).toBeInTheDocument()
})

test('端末名・最終通信・状態を文字で読み取れる (UC-EYEX-150, AC-EYEX-96)', async () => {
  const api = vi.fn(async () => jsonResponse([registerDesk, receptionDesk]))
  renderScreen(api)

  const active = await screen.findByRole('article', { name: /レジ横iPad/ })
  expect(within(active).getByText(/最終通信 1分前/)).toBeInTheDocument()
  // State is carried by text, never by colour alone.
  expect(within(active).getByText('利用中')).toBeInTheDocument()

  const revoked = screen.getByRole('article', { name: /受付iPad/ })
  expect(within(revoked).getByText(/最終通信 未通信/)).toBeInTheDocument()
  expect(within(revoked).getByText('停止中')).toBeInTheDocument()
  expect(within(revoked).getByRole('button', { name: '削除確認' })).toBeInTheDocument()
  expect(api).toHaveBeenCalledWith(`/api/staff/stores/${STORE_ID}/shared-terminals`)
})

test('モックの3枚のカードを同じ文言で出す (DEVICE-LIST)', async () => {
  const api = vi.fn(async () => jsonResponse([registerDesk]))
  renderScreen(api, { idleLockSeconds: { organizationDefault: 120, storeOverride: null } })

  expect(await screen.findByRole('region', { name: '無操作ロック' })).toHaveTextContent('既定 2分')
  expect(screen.getByRole('region', { name: '画面非表示時' })).toHaveTextContent(
    '直ちに顧客情報を隠す',
  )
  expect(screen.getByRole('region', { name: '個人モード' })).toHaveTextContent(
    'スタッフ選択＋4〜6桁PIN',
  )
})

test('共有iPadを登録するとトークンを一度だけ警告付きで表示し、保存しない (UC-EYEX-131, UC-EYEX-150)', async () => {
  const token = 'x'.repeat(48)
  const api = vi.fn(async (_input: string, init?: RequestInit) => {
    if (init?.method === 'POST') return jsonResponse({ terminal: registerDesk, token }, 201)
    return jsonResponse([])
  })
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  renderScreen(api as never)

  fireEvent.click(await screen.findByRole('button', { name: '共有iPadを登録' }))
  fireEvent.change(screen.getByLabelText('端末名'), { target: { value: 'レジ横iPad' } })
  fireEvent.click(screen.getByRole('button', { name: '登録する' }))

  const issued = await screen.findByRole('dialog', { name: /登録しました/ })
  expect(within(issued).getByText(token)).toBeInTheDocument()
  expect(within(issued).getByText(/二度と表示できません/)).toBeInTheDocument()
  expect(api).toHaveBeenCalledWith(
    `/api/staff/stores/${STORE_ID}/shared-terminals`,
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'レジ横iPad' }) }),
  )

  fireEvent.click(within(issued).getByRole('button', { name: '控えたので閉じる' }))
  await waitFor(() => {
    expect(screen.queryByText(token)).not.toBeInTheDocument()
  })
  // Shown once, never re-openable, and never written anywhere.
  expect(screen.queryByRole('button', { name: /トークンを再表示/ })).not.toBeInTheDocument()
  expect(setItem).not.toHaveBeenCalled()
})

test('失効は確認を挟み、意味を先に示してから実行する (UC-EYEX-136, AC-EYEX-83, AC-EYEX-98)', async () => {
  const api = vi.fn(async (_input: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return jsonResponse({ ...registerDesk, status: 'revoked', revokedAt: NOW }, 200)
    return jsonResponse([registerDesk])
  })
  renderScreen(api as never)

  const row = await screen.findByRole('article', { name: /レジ横iPad/ })
  fireEvent.click(within(row).getByRole('button', { name: '失効' }))

  // Nothing is revoked until the operator confirms.
  expect(api).toHaveBeenCalledTimes(1)
  const confirm = await screen.findByRole('alertdialog', { name: /失効しますか/ })
  expect(
    within(confirm).getByText(/顧客情報と業務画面へアクセスできなくなります/),
  ).toBeInTheDocument()
  expect(within(confirm).getByText(/未送信の操作は実行されません/)).toBeInTheDocument()

  fireEvent.click(within(confirm).getByRole('button', { name: '失効する' }))
  await waitFor(() => {
    expect(
      within(screen.getByRole('article', { name: /レジ横iPad/ })).getByText('停止中'),
    ).toBeInTheDocument()
  })
  expect(api).toHaveBeenCalledWith(
    `/api/staff/stores/${STORE_ID}/shared-terminals/${registerDesk.id}/revoke`,
    expect.objectContaining({ method: 'POST' }),
  )
})

test('確認を取り消すと失効は行われない (UC-EYEX-136)', async () => {
  const api = vi.fn(async () => jsonResponse([registerDesk]))
  renderScreen(api)

  const row = await screen.findByRole('article', { name: /レジ横iPad/ })
  fireEvent.click(within(row).getByRole('button', { name: '失効' }))
  const confirm = await screen.findByRole('alertdialog', { name: /失効しますか/ })
  fireEvent.click(within(confirm).getByRole('button', { name: 'やめる' }))

  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
  expect(api).toHaveBeenCalledTimes(1)
  expect(
    within(screen.getByRole('article', { name: /レジ横iPad/ })).getByText('利用中'),
  ).toBeInTheDocument()
})

test('無操作ロック時間は組織既定と店舗上書きを示す (UC-EYEX-152)', async () => {
  const api = vi.fn(async () => jsonResponse([registerDesk]))
  renderScreen(api, { idleLockSeconds: { organizationDefault: 120, storeOverride: 60 } })

  const section = await screen.findByRole('region', { name: '無操作ロック' })
  expect(section).toHaveTextContent('既定 2分')
  expect(section).toHaveTextContent('店舗上書き 1分')
})

test('店舗上書きが無い場合は組織既定を適用中と示す (UC-EYEX-152)', async () => {
  const api = vi.fn(async () => jsonResponse([registerDesk]))
  renderScreen(api, { idleLockSeconds: { organizationDefault: 300, storeOverride: null } })

  const section = await screen.findByRole('region', { name: '無操作ロック' })
  expect(section).toHaveTextContent('既定 5分')
  expect(section).toHaveTextContent('店舗上書きなし')
})

test('無操作ロック時間が渡されないときは未取得と明示する (UC-EYEX-152)', async () => {
  const api = vi.fn(async () => jsonResponse([registerDesk]))
  renderScreen(api)

  const section = await screen.findByRole('region', { name: '無操作ロック' })
  expect(section).toHaveTextContent('未取得')
  fireEvent.click(within(section).getByRole('button', { name: '変更' }))
  expect(within(section).getByRole('status')).toHaveTextContent(/管理コンソールで行います/)
})

test('個人PINの設定・再設定は管理コンソールへ案内し、APIを呼ばない (UC-EYEX-151)', async () => {
  const api = vi.fn(async () => jsonResponse([registerDesk]))
  renderScreen(api)

  await screen.findByRole('article', { name: /レジ横iPad/ })
  const section = screen.getByRole('region', { name: '個人モード' })
  fireEvent.click(within(section).getByRole('button', { name: '個人PINを設定・変更' }))
  expect(within(section).getByRole('status')).toHaveTextContent(
    /この操作は管理コンソールで行います/,
  )

  fireEvent.click(within(section).getByRole('button', { name: '個人PINの再設定を開始' }))
  expect(within(section).getByRole('status')).toHaveTextContent(
    /PINそのものは管理者にも表示されません/,
  )
  expect(api).toHaveBeenCalledTimes(1)
})

test('一覧を取得できないときは理由を伝える', async () => {
  const api = vi.fn(async () => jsonResponse({ error: 'boom' }, 500))
  renderScreen(api)

  expect(await screen.findByRole('alert')).toHaveTextContent(/共有iPadの一覧を取得できませんでした/)
})

test('契約に合わない応答は一覧として扱わない', async () => {
  const api = vi.fn(async () => jsonResponse([{ id: 'not-a-uuid' }]))
  renderScreen(api)

  expect(await screen.findByRole('alert')).toHaveTextContent(/共有iPadの一覧を取得できませんでした/)
})

test('端末名が空のままでは登録できない (UC-EYEX-131)', async () => {
  const api = vi.fn(async () => jsonResponse([]))
  renderScreen(api)

  await waitFor(() => {
    expect(api).toHaveBeenCalledTimes(1)
  })
  fireEvent.click(screen.getByRole('button', { name: '共有iPadを登録' }))
  fireEvent.click(screen.getByRole('button', { name: '登録する' }))
  expect(await screen.findByText('端末名を入力してください。')).toBeInTheDocument()
  expect(api).toHaveBeenCalledTimes(1)
})

test('登録に失敗したときはトークンを表示しない (UC-EYEX-131)', async () => {
  const api = vi.fn(async (_input: string, init?: RequestInit) => {
    if (init?.method === 'POST') return jsonResponse({ error: 'forbidden' }, 403)
    return jsonResponse([])
  })
  renderScreen(api as never)

  await waitFor(() => {
    expect(api).toHaveBeenCalledTimes(1)
  })
  fireEvent.click(screen.getByRole('button', { name: '共有iPadを登録' }))
  fireEvent.change(screen.getByLabelText('端末名'), { target: { value: 'レジ横iPad' } })
  fireEvent.click(screen.getByRole('button', { name: '登録する' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(/共有iPadを登録できませんでした/)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
