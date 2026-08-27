import type { AlertRecord, AlertSettings } from '@app/contracts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AlertsScreen } from './AlertsScreen'

const STORE_ID = '00000000-0000-4000-8000-000000000010'
const ALERT_ID = '00000000-0000-4000-8000-0000000000a1'
const NOTICE_ID = '00000000-0000-4000-8000-0000000000a2'
const TODAY = '2026-08-27'
const NOW = '2026-08-27T05:30:00.000Z'

const MANAGER_PERMISSIONS = [
  'reservation.read',
  'reservation.write',
  'settings.read',
  'settings.manage',
] as const

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

function alert(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id: ALERT_ID,
    storeId: STORE_ID,
    kind: 'alert',
    code: 'long_wait',
    title: '待ち時間が閾値を超えています',
    reason: '受付から接客開始まで 25 分が経過しています。',
    subject: '受付 14:05 の来店',
    subjectType: 'walkin',
    subjectId: 'w1',
    occurredAt: NOW,
    nextAction: '担当者を割り当ててください。',
    readAt: null,
    readBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    ...overrides,
  }
}

const notice: AlertRecord = alert({
  id: NOTICE_ID,
  kind: 'notice',
  code: 'settings_contradiction',
  title: '営業時間と予約枠の設定が矛盾しています',
  reason: '営業時間外に公開中の予約枠があります。',
  subject: '土曜の予約枠',
  subjectType: 'reservation',
  subjectId: 'r1',
  nextAction: '設定画面で公開枠を見直してください。',
})

const settings: AlertSettings = {
  storeId: STORE_ID,
  conditions: [
    { code: 'long_wait', enabled: true, thresholdMinutes: 20 },
    { code: 'recording_save_failure', enabled: true, thresholdMinutes: null },
    { code: 'settings_contradiction', enabled: false, thresholdMinutes: null },
  ],
  notificationTargets: ['manager@example.com'],
  updatedAt: NOW,
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

/** The happy-path server: a two-row inbox plus the store's alert settings. */
function defaultApi(overrides: { alerts?: AlertRecord[] } = {}) {
  const rows = overrides.alerts ?? [alert(), notice]
  return createApi((route) => {
    if (route.url.includes('/alert-settings')) return jsonResponse(settings)
    if (/\/alerts\/[^/]+$/.test(route.url))
      return jsonResponse(rows.find((row) => route.url.endsWith(row.id)) ?? rows[0])
    return jsonResponse(rows)
  })
}

function renderScreen(
  api: ReturnType<typeof createApi>['api'],
  permissions: readonly string[] = MANAGER_PERMISSIONS,
) {
  render(
    <AlertsScreen
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

afterEach(() => {
  vi.restoreAllMocks()
})

/* --- list and detail (UC-EYEX-178, AC-EYEX-120) --------------------------- */

test('お知らせ and アラート are listed together and labelled by kind', async () => {
  const { api } = defaultApi()
  renderScreen(api)
  expect(await screen.findByText('待ち時間が閾値を超えています')).toBeTruthy()
  expect(screen.getByText('営業時間と予約枠の設定が矛盾しています')).toBeTruthy()
  expect(screen.getByText('アラート')).toBeTruthy()
  expect(screen.getByText('お知らせ')).toBeTruthy()
})

test('the detail states 発生理由・対象・発生時刻・次の操作', async () => {
  const { api } = defaultApi()
  renderScreen(api)
  fireEvent.click(await screen.findByRole('button', { name: /待ち時間が閾値を超えています/ }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('受付から接客開始まで 25 分が経過しています。')).toBeTruthy()
  expect(within(dialog).getByText('受付 14:05 の来店')).toBeTruthy()
  expect(within(dialog).getByText('2026-08-27 14:30 JST')).toBeTruthy()
  expect(within(dialog).getByText('担当者を割り当ててください。')).toBeTruthy()
})

test('marking 既読 does not mark 対応済み', async () => {
  const rows = [alert()]
  const { api, calls } = createApi((route) => {
    if (route.url.includes('/alert-settings')) return jsonResponse(settings)
    if (route.url.endsWith('/read')) return jsonResponse(alert({ readAt: NOW, readBy: 'u1' }))
    if (/\/alerts\/[^/]+$/.test(route.url)) return jsonResponse(rows[0])
    return jsonResponse(rows)
  })
  renderScreen(api)
  fireEvent.click(await screen.findByRole('button', { name: /待ち時間が閾値を超えています/ }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('未読')).toBeTruthy()
  expect(within(dialog).getByText('未対応')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: '既読にする' }))
  await waitFor(() => {
    expect(within(dialog).getByText('既読')).toBeTruthy()
  })
  // The two facts are recorded separately: reading is not handling.
  expect(within(dialog).getByText('未対応')).toBeTruthy()
  expect(calls.some((call) => call.url.endsWith('/resolve'))).toBe(false)
})

test('対応済み requires a note and does not mark the alert 既読', async () => {
  const rows = [alert()]
  const { api, calls } = createApi((route) => {
    if (route.url.includes('/alert-settings')) return jsonResponse(settings)
    if (route.url.endsWith('/resolve'))
      return jsonResponse(
        alert({ resolvedAt: NOW, resolvedBy: 'u1', resolutionNote: '担当者を割り当てました。' }),
      )
    if (/\/alerts\/[^/]+$/.test(route.url)) return jsonResponse(rows[0])
    return jsonResponse(rows)
  })
  renderScreen(api)
  fireEvent.click(await screen.findByRole('button', { name: /待ち時間が閾値を超えています/ }))
  const dialog = await screen.findByRole('dialog')
  const resolve = within(dialog).getByRole('button', { name: '対応済みにする' })
  fireEvent.click(resolve)
  expect(within(dialog).getByText('対応内容を入力してください。')).toBeTruthy()
  expect(calls.some((call) => call.url.endsWith('/resolve'))).toBe(false)
  fireEvent.change(within(dialog).getByLabelText('対応内容'), {
    target: { value: '担当者を割り当てました。' },
  })
  fireEvent.click(resolve)
  await waitFor(() => {
    expect(within(dialog).getByText('対応済み')).toBeTruthy()
  })
  expect(within(dialog).getByText('未読')).toBeTruthy()
  const call = calls.find((entry) => entry.url.endsWith('/resolve'))
  expect(JSON.parse(String(call?.init?.body))).toEqual({ note: '担当者を割り当てました。' })
})

test('the inbox can be filtered by kind and by status', async () => {
  const { api, calls } = defaultApi()
  renderScreen(api)
  await screen.findByText('待ち時間が閾値を超えています')
  fireEvent.change(screen.getByLabelText('種別'), { target: { value: 'alert' } })
  await waitFor(() => {
    expect(calls.some((call) => call.url.includes('kind=alert'))).toBe(true)
  })
  fireEvent.change(screen.getByLabelText('状態'), { target: { value: 'unresolved' } })
  await waitFor(() => {
    expect(calls.some((call) => call.url.includes('status=unresolved'))).toBe(true)
  })
})

test('a failed load says so instead of showing an empty inbox', async () => {
  const { api } = createApi((route) =>
    route.url.includes('/alert-settings')
      ? jsonResponse(settings)
      : jsonResponse({ error: 'internal' }, 500),
  )
  renderScreen(api)
  expect(await screen.findByText(/お知らせとアラートを読み込めませんでした/)).toBeTruthy()
})

/* --- alert conditions (UC-EYEX-179) --------------------------------------- */

test('an administrator configures the conditions and their notification targets', async () => {
  const { api, calls } = defaultApi()
  renderScreen(api)
  const form = await screen.findByRole('region', { name: '警告条件と通知先' })
  expect(within(form).getByLabelText('待ち時間の超過')).toBeTruthy()
  fireEvent.change(within(form).getByLabelText('待ち時間の閾値（分）'), {
    target: { value: '15' },
  })
  fireEvent.click(within(form).getByLabelText('設定の矛盾'))
  fireEvent.change(within(form).getByLabelText('通知先メールアドレス'), {
    target: { value: 'manager@example.com, area@example.com' },
  })
  fireEvent.click(within(form).getByRole('button', { name: '警告条件を保存する' }))
  await waitFor(() => {
    expect(calls.some((call) => call.init?.method === 'PUT')).toBe(true)
  })
  const call = calls.find((entry) => entry.init?.method === 'PUT')
  expect(JSON.parse(String(call?.init?.body))).toEqual({
    conditions: [
      { code: 'long_wait', enabled: true, thresholdMinutes: 15 },
      { code: 'recording_save_failure', enabled: true, thresholdMinutes: null },
      { code: 'settings_contradiction', enabled: true, thresholdMinutes: null },
    ],
    notificationTargets: ['manager@example.com', 'area@example.com'],
  })
  expect(await screen.findByText('警告条件を保存しました。')).toBeTruthy()
})

/* --- permissions ---------------------------------------------------------- */

test('without reservation.read nothing is loaded and nothing is shown', async () => {
  const { api, calls } = defaultApi()
  renderScreen(api, ['analytics.read'])
  const denied = await screen.findByRole('region', { name: '権限がありません' })
  expect(denied).toHaveTextContent(
    '権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。',
  )
  expect(within(denied).getByRole('button', { name: '業務開始画面へ戻る' })).toBeTruthy()
  expect(calls).toHaveLength(0)
})

test('a reader without reservation.write cannot record 既読 or 対応済み', async () => {
  const { api } = defaultApi()
  renderScreen(api, ['reservation.read'])
  fireEvent.click(await screen.findByRole('button', { name: /待ち時間が閾値を超えています/ }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).queryByRole('button', { name: '既読にする' })).toBeNull()
  expect(within(dialog).queryByRole('button', { name: '対応済みにする' })).toBeNull()
})

test('without settings.manage the condition form is not offered', async () => {
  const { api, calls } = defaultApi()
  renderScreen(api, ['reservation.read'])
  await screen.findByText('待ち時間が閾値を超えています')
  expect(screen.queryByRole('region', { name: '警告条件と通知先' })).toBeNull()
  expect(calls.some((call) => call.url.includes('/alert-settings'))).toBe(false)
})

/* --- shared iPad hygiene -------------------------------------------------- */

test('nothing is written to browser storage', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  const { api } = defaultApi()
  renderScreen(api)
  await screen.findByText('待ち時間が閾値を超えています')
  fireEvent.click(screen.getByRole('button', { name: /待ち時間が閾値を超えています/ }))
  await waitFor(() => {
    expect(setItem).not.toHaveBeenCalled()
  })
})

test('該当が無ければ理由と回復操作を出す (UC-EYEX-178)', async () => {
  // `exception-states-approved.html#empty` — 消えたのではなく、条件に合わないだけ。
  const { api } = createApi(() => jsonResponse([]))
  renderScreen(api)

  const empty = await screen.findByRole('region', { name: '該当なし' })
  expect(empty).toHaveTextContent('条件に一致するお知らせ・アラートはありません')
  expect(empty).toHaveTextContent(
    '検索語またはフィルターを変更してください。履歴自体は削除されていません。',
  )

  fireEvent.change(screen.getByLabelText('状態'), { target: { value: 'unread' } })
  fireEvent.click(await screen.findByRole('button', { name: 'フィルターをすべて解除' }))
  await waitFor(() => {
    expect(screen.getByLabelText('状態')).toHaveValue('all')
  })
})

/** 和文グリフを持たない `--font-mono` で本文の書式を作らない。 */
test('発生時刻は等幅ではなく本文書体で描く', async () => {
  const { api } = defaultApi()
  renderScreen(api)
  fireEvent.click(await screen.findByRole('button', { name: /待ち時間が閾値を超えています/ }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('2026-08-27 14:30 JST')).not.toHaveClass('font-mono')
})
