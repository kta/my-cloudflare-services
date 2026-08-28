import { stretchPin } from '@app/shared'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ReauthPrompt, requiresPersonalReauthentication } from './ReauthPrompt'

const STORE_ID = '00000000-0000-4000-8000-000000000010'
const TERMINAL_ID = '00000000-0000-4000-8000-000000000201'
const ORGANIZATION_ID = 'org-eyex'
const NOW = '2026-08-27T05:30:00.000Z'
const GRANT = 'g'.repeat(48)

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

function renderPrompt(
  api: ReturnType<typeof vi.fn>,
  overrides: {
    administrative?: boolean
    onGranted?: (token: string) => void
    onCancelled?: () => void
    terminalName?: string
  } = {},
) {
  const onGranted = overrides.onGranted ?? vi.fn()
  const onCancelled = overrides.onCancelled ?? vi.fn()
  render(
    <ReauthPrompt
      storeId={STORE_ID}
      storeName="銀座店"
      api={api as never}
      navigate={vi.fn()}
      now={NOW}
      terminalId={TERMINAL_ID}
      organizationId={ORGANIZATION_ID}
      actionLabel="録音の保全指定"
      terminalName={overrides.terminalName}
      administrative={overrides.administrative ?? true}
      onGranted={onGranted}
      onCancelled={onCancelled}
    />,
  )
  return { onGranted, onCancelled }
}

function submitPin(pin = '123456', userId = 'manager-1') {
  fireEvent.change(screen.getByLabelText('個人ログインID'), { target: { value: userId } })
  fireEvent.change(screen.getByLabelText('個人PIN'), { target: { value: pin } })
  fireEvent.click(screen.getByRole('button', { name: '確認して続ける' }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('日常業務では管理再認証を求めない (UC-EYEX-132, AC-EYEX-81)', () => {
  const api = vi.fn()
  const { onGranted } = renderPrompt(api, { administrative: false })

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('個人PIN')).not.toBeInTheDocument()
  expect(api).not.toHaveBeenCalled()
  expect(onGranted).not.toHaveBeenCalled()
})

test('管理操作は個人PINを要求し、成功するまで実行しない (UC-EYEX-138, AC-EYEX-82)', async () => {
  const api = vi.fn(async (_input: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return jsonResponse({ token: GRANT, expiresAt: '2026-08-27T05:32:00.000Z' }, 201)
    return jsonResponse({ valid: true })
  })
  const { onGranted } = renderPrompt(api as never)

  const dialog = screen.getByRole('dialog', { name: /管理者として確認してください/ })
  // 承認済みモック `operations-approved.html#reauth` の文言そのまま。
  expect(
    within(dialog).getByText(
      '録音の保全指定は個人認証が必要です。共有端末と認証した個人の両方を監査記録に残します。',
    ),
  ).toBeInTheDocument()
  // Nothing runs on mount.
  expect(onGranted).not.toHaveBeenCalled()

  submitPin('123456')
  await waitFor(() => {
    expect(onGranted).toHaveBeenCalledWith(GRANT)
  })

  const post = api.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
  )
  if (post === undefined) throw new Error('reauthenticate was never called')
  expect(post[0]).toBe(`/api/shared-terminals/${TERMINAL_ID}/reauthenticate`)
  const sent = String((post[1] as RequestInit).body)
  const body = JSON.parse(sent) as Record<string, unknown>
  expect(body).toEqual({
    userId: 'manager-1',
    stretchedPin: await stretchPin('123456', ORGANIZATION_ID, 'manager-1'),
  })
  // The raw PIN never leaves the browser.
  expect(sent).not.toContain('123456')
  expect(api).toHaveBeenCalledWith(
    `/api/shared-terminals/${TERMINAL_ID}/reauthentication`,
    expect.anything(),
  )
})

test('個人PINが誤りのときは漏らさない文言で再入力を促す (AC-EYEX-82)', async () => {
  const api = vi.fn(async () => jsonResponse({ error: 'pin_invalid' }, 401))
  const { onGranted } = renderPrompt(api)

  submitPin('123456')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '個人PINを確認できませんでした。もう一度入力してください。',
  )
  expect(onGranted).not.toHaveBeenCalled()
  expect(screen.getByLabelText('個人PIN')).toHaveValue('')
})

test('端末の共有セッションが無効なときは再登録を案内する (AC-EYEX-98)', async () => {
  const api = vi.fn(async () => jsonResponse({ error: 'terminal_unauthorized' }, 401))
  const { onGranted } = renderPrompt(api)

  submitPin()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'この端末の共有セッションは無効です。端末の再登録が必要です。',
  )
  expect(onGranted).not.toHaveBeenCalled()
})

test('権限が無いときは操作を実行せず理由を示す (AC-EYEX-101, UC-EYEX-137)', async () => {
  const api = vi.fn(async () => jsonResponse({ error: 'reauth_forbidden' }, 403))
  const { onGranted } = renderPrompt(api)

  submitPin()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'この操作を行う権限がありません。店舗管理者にご確認ください。',
  )
  expect(onGranted).not.toHaveBeenCalled()
})

test('認証基盤に接続できないときは実行せず再試行を案内する (AC-EYEX-82)', async () => {
  const api = vi.fn(async () => jsonResponse({ error: 'admin_auth_unavailable' }, 502))
  const { onGranted } = renderPrompt(api)

  submitPin()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '認証サービスに接続できませんでした。時間をおいてもう一度お試しください。',
  )
  expect(onGranted).not.toHaveBeenCalled()
})

test('付与が期限切れなら操作を実行せずもう一度PINを求める (UC-EYEX-134)', async () => {
  const api = vi.fn(async (_input: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return jsonResponse({ token: GRANT, expiresAt: '2026-08-27T05:31:00.000Z' }, 201)
    return jsonResponse({ error: 'reauth_expired' }, 401)
  })
  const { onGranted } = renderPrompt(api as never)

  submitPin()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '個人認証の有効期限が切れました。もう一度個人PINを入力してください。',
  )
  expect(onGranted).not.toHaveBeenCalled()
  expect(screen.getByLabelText('個人PIN')).toHaveValue('')
})

test('契約に合わない付与応答は成功として扱わない', async () => {
  const api = vi.fn(async (_input: string, init?: RequestInit) => {
    if (init?.method === 'POST') return jsonResponse({ token: 'too-short' }, 201)
    return jsonResponse({ valid: true })
  })
  const { onGranted } = renderPrompt(api as never)

  submitPin()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '個人認証を完了できませんでした。もう一度お試しください。',
  )
  expect(onGranted).not.toHaveBeenCalled()
})

test('PINの桁数が不正なら送信しない', async () => {
  const api = vi.fn()
  renderPrompt(api)

  submitPin('12')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '個人PINは4〜6桁の数字で入力してください。',
  )
  expect(api).not.toHaveBeenCalled()
})

test('個人PINとトークンは端末に保存しない (AC-EYEX-112)', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  const api = vi.fn(async (_input: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return jsonResponse({ token: GRANT, expiresAt: '2026-08-27T05:32:00.000Z' }, 201)
    return jsonResponse({ valid: true })
  })
  const { onGranted } = renderPrompt(api as never)

  submitPin()
  await waitFor(() => {
    expect(onGranted).toHaveBeenCalledWith(GRANT)
  })
  expect(setItem).not.toHaveBeenCalled()
})

test('Escapeで中止でき、操作は実行されない (AC-EYEX-82)', () => {
  const api = vi.fn()
  const { onCancelled, onGranted } = renderPrompt(api)

  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(onCancelled).toHaveBeenCalledTimes(1)
  expect(onGranted).not.toHaveBeenCalled()
  expect(api).not.toHaveBeenCalled()
})

test('キャンセルボタンでも操作は実行されない', () => {
  const api = vi.fn()
  const { onCancelled, onGranted } = renderPrompt(api)

  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(onCancelled).toHaveBeenCalledTimes(1)
  expect(onGranted).not.toHaveBeenCalled()
})

test('フォーカスは先頭に入り、ダイアログ内で循環する', () => {
  const api = vi.fn()
  renderPrompt(api)

  const userId = screen.getByLabelText('個人ログインID')
  expect(userId).toHaveFocus()

  const submit = screen.getByRole('button', { name: '確認して続ける' })
  submit.focus()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
  expect(userId).toHaveFocus()

  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
  expect(submit).toHaveFocus()
})

test('管理操作だけが個人再認証を必要とする (UC-EYEX-137, AC-EYEX-81, AC-EYEX-87)', () => {
  expect(requiresPersonalReauthentication('attention_publish')).toBe(true)
  expect(requiresPersonalReauthentication('attention_revise')).toBe(true)
  expect(requiresPersonalReauthentication('attention_hide')).toBe(true)
  expect(requiresPersonalReauthentication('recording_hold')).toBe(true)
  expect(requiresPersonalReauthentication('recording_release')).toBe(true)
  expect(requiresPersonalReauthentication('permission_settings')).toBe(true)
  expect(requiresPersonalReauthentication('shared_terminal_revoke')).toBe(true)
  // Everyday work, including registering an attention note for review.
  expect(requiresPersonalReauthentication('reservation_create')).toBe(false)
  expect(requiresPersonalReauthentication('attention_register')).toBe(false)
  expect(requiresPersonalReauthentication('customer_search')).toBe(false)
})

/*
 * 承認済みモック `operations-approved.html#reauth` は、共有 iPad のクロムの上に
 * 素の板を 1 枚置くだけの独立した面である。暗い幕は無く、バーは「どの店舗の、
 * どの端末で」を名乗る。手前の運用面が透けて見えると、いま何の上で個人を
 * 名乗り直しているのかが読めなくなる。
 */
test('共有iPadのクロムを持つ独立した面として出る（暗い幕もモーダルも重ねない）', () => {
  const api = vi.fn()
  renderPrompt(api, { terminalName: 'レジ横iPad' })

  expect(screen.getByText('銀座店 レジ横iPad · 完全共有')).toBeInTheDocument()
  const dialog = screen.getByRole('dialog', { name: /管理者として確認してください/ })
  // 幕（`bg-ink/40` の全面）は置かない。
  expect(document.querySelector('.bg-ink\\/40')).toBeNull()
  expect(dialog.closest('[class*="fixed"]')).not.toBeNull()
})

/*
 * モックの板は 個人PIN の 1 欄だけだが、実アプリは個人ログインIDも要る。
 * PIN の伸長塩が `app:pin:<組織>:<個人>` で、誰の PIN かが決まらないと
 * ブラウザ側で伸長値を作れないためで、サーバ側では解決できない（完全共有の
 * iPad には個人セッションが無い）。契約 `SharedTerminalReauthenticationInput`
 * も `userId` を必須にしている。欄はモックに寄せて 2 本までに留め、その 2 本が
 * 増えていないことをここで縛る。逸脱の理由は `docs/frontend/REBUILD.md`。
 */
test('個人ログインIDと個人PINの 2 欄だけを持ち、欄を増やさない', () => {
  renderPrompt(vi.fn())
  expect(screen.getByLabelText('個人ログインID')).toBeInTheDocument()
  expect(screen.getByLabelText('個人PIN')).toBeInTheDocument()
  // PIN は password 欄なので role では数えられない。欄そのものを数える。
  expect(document.querySelectorAll('input')).toHaveLength(2)
})
