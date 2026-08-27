import { ATTENTION_INPUT_GUIDANCE } from '@app/contracts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AttentionSettingsScreen } from './AttentionSettingsScreen'
import { screenSections } from './app-chrome'

const STORE_ID = '00000000-0000-4000-8000-000000000010'
const TODAY = '2026-08-27'
const NOW = '2026-08-27T05:30:00.000Z'

const MANAGER_PERMISSIONS = ['attention.read', 'settings.read', 'settings.manage'] as const

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

const settings = {
  storeId: STORE_ID,
  reviewMode: 'review_required' as const,
  sharingScope: 'permitted_stores' as const,
  storeOverrideAllowed: true,
  origin: 'organization' as const,
  capabilities: [
    { capability: 'read', minimumRole: 'staff', origin: 'organization' },
    { capability: 'write', minimumRole: 'staff', origin: 'organization' },
    { capability: 'publish', minimumRole: 'store_manager', origin: 'store' },
    { capability: 'revise', minimumRole: 'store_manager', origin: 'store' },
    { capability: 'hide', minimumRole: 'store_manager', origin: 'organization' },
  ],
  guidance: ATTENTION_INPUT_GUIDANCE,
}

type Route = { url: string; init?: RequestInit }

function createApi(handler: (route: Route) => Response | Promise<Response>) {
  const calls: Route[] = []
  const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const route = { url: String(input), init }
    calls.push(route)
    return handler(route)
  })
  return { api, calls }
}

function renderScreen(
  api: ReturnType<typeof createApi>['api'],
  permissions: readonly string[] = MANAGER_PERMISSIONS,
) {
  render(
    <AttentionSettingsScreen
      storeId={STORE_ID}
      storeName="銀座店"
      api={api as never}
      navigate={vi.fn()}
      permissions={permissions as never}
      today={TODAY}
      now={NOW}
    />,
  )
}

function bodyOf(route: Route): unknown {
  return JSON.parse(String(route.init?.body))
}

afterEach(() => {
  vi.restoreAllMocks()
})

/** 承認済みモック `ATTENTION-PERMISSIONS--default--ipad-landscape.png` の権限表 */
test('ロール×操作の許可表をモックどおりに出す (UC-EYEX-140, AC-EYEX-84)', async () => {
  const { api } = createApi(() => jsonResponse(settings))
  renderScreen(api)

  const table = await screen.findByRole('table', { name: '注意事項の権限' })
  const headers = within(table)
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent)
  expect(headers).toEqual(['ロール', '閲覧', '登録', '公開', '改訂', '非表示'])

  const staff = within(table).getByRole('row', { name: /^スタッフ 許可/ })
  expect(
    within(staff)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['許可', '確認待ち', '不可', '不可', '不可'])
  const manager = within(table).getByRole('row', { name: /^店舗管理者 許可/ })
  expect(
    within(manager)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['許可', '許可', '許可', '許可', '許可'])
  expect(within(table).getByRole('row', { name: /^本部管理者 許可/ })).toBeInTheDocument()

  // いま効いている値の適用元は表と一緒に読める (AC-EYEX-84)。
  const origins = screen.getByRole('row', { name: /適用元/ })
  expect(origins).toHaveTextContent('組織共通')
  expect(origins).toHaveTextContent('店舗上書き')

  expect(screen.getByLabelText('公開に必要なロール')).toHaveValue('store_manager')
  expect(screen.getByLabelText('公開方式')).toHaveValue('review_required')
  expect(screen.getByLabelText('共有範囲')).toHaveValue('permitted_stores')
})

/** 承認済みモックの副タブ・節・3 カード */
test('注意事項の節と3枚のカードを出す', async () => {
  const { api } = createApi(() => jsonResponse(settings))
  renderScreen(api)

  /* 節は面が描かず、全画面共通の柱へ渡す。面の側では渡した中身で確かめる。 */
  await screen.findByRole('region', { name: '登録方式' })
  expect(screenSections.snapshot().map((section) => section.label)).toEqual([
    '権限',
    '確認待ち',
    '共有範囲',
    '入力ルール',
  ])
  expect(screen.queryByRole('navigation')).toBeNull()

  expect(screen.getByRole('region', { name: '登録方式' })).toHaveTextContent('管理者確認後に公開')
  expect(screen.getByRole('region', { name: '共有範囲の設定' })).toHaveTextContent('権限のある店舗')
  expect(screen.getByRole('region', { name: '店舗上書き' })).toBeInTheDocument()
})

test('公開方式と能力ロールを組織共通として保存する (UC-EYEX-139, UC-EYEX-141)', async () => {
  const { api, calls } = createApi((route) =>
    route.init?.method === 'PUT'
      ? jsonResponse({ ...settings, reviewMode: 'immediate' })
      : jsonResponse(settings),
  )
  renderScreen(api)

  fireEvent.change(await screen.findByLabelText('公開方式'), { target: { value: 'immediate' } })
  fireEvent.change(screen.getByLabelText('非表示化に必要なロール'), {
    target: { value: 'organization_admin' },
  })
  fireEvent.click(screen.getByRole('button', { name: '設定を保存する' }))

  await screen.findByText('設定を保存しました。')
  const put = calls.find((route) => route.init?.method === 'PUT')
  expect(put?.url).toBe(`/api/staff/stores/${STORE_ID}/attention-settings`)
  expect(bodyOf(put as Route)).toEqual({
    scope: 'organization',
    reviewMode: 'immediate',
    sharingScope: 'permitted_stores',
    storeOverrideAllowed: true,
    capabilities: [
      { capability: 'read', minimumRole: 'staff' },
      { capability: 'write', minimumRole: 'staff' },
      { capability: 'publish', minimumRole: 'store_manager' },
      { capability: 'revise', minimumRole: 'store_manager' },
      { capability: 'hide', minimumRole: 'organization_admin' },
    ],
  })
  // 共有範囲は変えていないので、影響照会は起こらない。
  expect(calls.some((route) => route.url.includes('sharing-scope-impact'))).toBe(false)
})

test('店舗上書きとして保存できる (UC-EYEX-139)', async () => {
  const { api, calls } = createApi((route) =>
    route.init?.method === 'PUT'
      ? jsonResponse({ ...settings, origin: 'store' })
      : jsonResponse(settings),
  )
  renderScreen(api)

  fireEvent.change(await screen.findByLabelText('設定範囲'), { target: { value: 'store' } })
  fireEvent.click(screen.getByRole('button', { name: '設定を保存する' }))

  await screen.findByText('設定を保存しました。')
  expect(bodyOf(calls.find((route) => route.init?.method === 'PUT') as Route)).toMatchObject({
    scope: 'store',
  })
})

test('共有範囲の変更は影響件数を確認するまで適用しない (UC-EYEX-142, AC-EYEX-118)', async () => {
  const impact = {
    currentScope: 'permitted_stores',
    requestedScope: 'chain',
    affectedNoteCount: 12,
    affectedCustomerCount: 5,
    affectedStoreCount: 3,
  }
  const { api, calls } = createApi((route) => {
    if (route.url.includes('sharing-scope-impact')) return jsonResponse(impact)
    if (route.init?.method === 'PUT') return jsonResponse({ ...settings, sharingScope: 'chain' })
    return jsonResponse(settings)
  })
  renderScreen(api)

  fireEvent.change(await screen.findByLabelText('共有範囲'), { target: { value: 'chain' } })
  fireEvent.click(screen.getByRole('button', { name: '設定を保存する' }))

  const dialog = await screen.findByRole('dialog', { name: '共有範囲の変更を確認' })
  expect(
    within(dialog).getByText(
      '既存の注意事項 12件（顧客 5人・店舗 3店舗）が「権限のある店舗」から「チェーン全体」へ変わります。',
    ),
  ).toBeInTheDocument()
  // 確認する前に書き込みが起きてはいけない。
  expect(calls.some((route) => route.init?.method === 'PUT')).toBe(false)
  expect(
    bodyOf(calls.find((route) => route.url.includes('sharing-scope-impact')) as Route),
  ).toEqual({ requestedScope: 'chain' })

  fireEvent.click(within(dialog).getByRole('button', { name: '影響を確認して変更する' }))

  await screen.findByText('設定を保存しました。')
  expect(bodyOf(calls.find((route) => route.init?.method === 'PUT') as Route)).toMatchObject({
    sharingScope: 'chain',
    acknowledgedAffectedNoteCount: 12,
  })
})

test('影響確認をやめれば共有範囲は変わらない (AC-EYEX-118)', async () => {
  const { api, calls } = createApi((route) =>
    route.url.includes('sharing-scope-impact')
      ? jsonResponse({
          currentScope: 'permitted_stores',
          requestedScope: 'chain',
          affectedNoteCount: 0,
          affectedCustomerCount: 0,
          affectedStoreCount: 0,
        })
      : jsonResponse(settings),
  )
  renderScreen(api)

  fireEvent.change(await screen.findByLabelText('共有範囲'), { target: { value: 'chain' } })
  fireEvent.click(screen.getByRole('button', { name: '設定を保存する' }))
  const dialog = await screen.findByRole('dialog', { name: '共有範囲の変更を確認' })
  expect(
    within(dialog).getByText(
      '過去の注意事項に影響はありません。今後の登録から「チェーン全体」で共有されます。',
    ),
  ).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))

  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  expect(calls.some((route) => route.init?.method === 'PUT')).toBe(false)
})

test('監査に残せない変更は成立させず、入力を保持して再試行を出す (UC-EYEX-156, AC-EYEX-103)', async () => {
  let attempts = 0
  const { api, calls } = createApi((route) => {
    if (route.init?.method !== 'PUT') return jsonResponse(settings)
    attempts += 1
    return attempts === 1
      ? jsonResponse({ error: 'audit_append_failed' }, 500)
      : jsonResponse({ ...settings, reviewMode: 'immediate' })
  })
  renderScreen(api)

  fireEvent.change(await screen.findByLabelText('公開方式'), { target: { value: 'immediate' } })
  fireEvent.click(screen.getByRole('button', { name: '設定を保存する' }))

  await screen.findByText(
    '監査記録に残せなかったため、この変更は成立していません。入力はそのまま保持しています。',
  )
  // 入力は失われない。
  expect(screen.getByLabelText('公開方式')).toHaveValue('immediate')

  fireEvent.click(screen.getByRole('button', { name: '再試行する' }))
  await screen.findByText('設定を保存しました。')
  expect(calls.filter((route) => route.init?.method === 'PUT')).toHaveLength(2)
})

test('設定変更の権限が無ければ読み取り専用になる (UC-EYEX-139)', async () => {
  const { api } = createApi(() => jsonResponse(settings))
  renderScreen(api, ['attention.read', 'settings.read'])

  await screen.findByRole('table', { name: '注意事項の権限' })
  expect(screen.queryByRole('button', { name: '設定を保存する' })).not.toBeInTheDocument()
  expect(screen.getByText('この店舗の設定を変更する権限がありません。')).toBeInTheDocument()
})

test('閲覧権限が無ければ注意事項の存在を示さず取得もしない (AC-EYEX-85)', () => {
  const { api } = createApi(() => jsonResponse(settings))
  renderScreen(api, ['settings.read'])

  expect(api).not.toHaveBeenCalled()
  expect(screen.getByText('この設定を表示する権限がありません')).toBeInTheDocument()
  expect(
    screen.getByText(
      '権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。',
    ),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '業務開始画面へ戻る' })).toBeInTheDocument()
  expect(screen.queryByText(/注意事項/)).not.toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

test('端末に設定内容を残さない (完全共有iPad)', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  const { api } = createApi(() => jsonResponse(settings))
  renderScreen(api)

  await screen.findByRole('table', { name: '注意事項の権限' })
  fireEvent.change(screen.getByLabelText('公開方式'), { target: { value: 'immediate' } })
  expect(setItem).not.toHaveBeenCalled()
})
