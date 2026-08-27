import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ReceptionHistoryScreen } from './ReceptionHistoryScreen'
import type { RecordingView } from './ReservationSearchScreen'

const STORE_ID = '00000000-0000-4000-8000-000000000010'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

const walkin = {
  id: '00000000-0000-4000-8000-000000000101',
  occurredAt: '2026-08-27T05:26:00.000Z', // 14:26 JST
  source: 'walkin' as const,
  action: 'walkin_created' as const,
  entityType: 'walkin' as const,
  entityId: '00000000-0000-4000-8000-000000000901',
  reservationId: null,
  customerName: null,
  customerPhone: null,
  reservationNumber: null,
  actorId: '山田',
  requiresAttention: false,
  recordingStatus: 'none' as const,
}

const phoneBooking = {
  id: '00000000-0000-4000-8000-000000000102',
  occurredAt: '2026-08-27T05:18:00.000Z', // 14:18 JST
  source: 'staff' as const,
  action: 'created' as const,
  entityType: 'reservation' as const,
  entityId: '00000000-0000-4000-8000-000000000902',
  reservationId: '00000000-0000-4000-8000-000000000902',
  customerName: '田中 花子',
  customerPhone: '090-1234-5678',
  reservationNumber: 'EY-0828-1142',
  actorId: '鈴木',
  requiresAttention: true,
  recordingStatus: 'none' as const,
}

const webBooking = {
  id: '00000000-0000-4000-8000-000000000103',
  occurredAt: '2026-08-27T04:54:00.000Z', // 13:54 JST
  source: 'web' as const,
  action: 'created' as const,
  entityType: 'reservation' as const,
  entityId: '00000000-0000-4000-8000-000000000903',
  reservationId: '00000000-0000-4000-8000-000000000903',
  customerName: '伊藤 健',
  customerPhone: '090-2222-3333',
  reservationNumber: 'EY-0829-1330',
  actorId: 'web',
  requiresAttention: false,
  recordingStatus: 'none' as const,
}

const changed = {
  id: '00000000-0000-4000-8000-000000000104',
  occurredAt: '2026-08-27T04:32:00.000Z', // 13:32 JST
  source: 'staff' as const,
  action: 'changed' as const,
  entityType: 'reservation' as const,
  entityId: '00000000-0000-4000-8000-000000000904',
  reservationId: '00000000-0000-4000-8000-000000000904',
  customerName: '松本 一郎',
  customerPhone: '090-4444-5555',
  reservationNumber: 'EY-0827-1500',
  actorId: '山田',
  requiresAttention: false,
  recordingStatus: 'none' as const,
}

type Route = { url: string; init?: RequestInit }

function renderScreen(
  entries: unknown[],
  extra: {
    recording?: RecordingView
    permissions?: { playRecording: boolean }
    resolveRecording?: (entry: { id: string }) => RecordingView | undefined
  } = {},
) {
  const calls: Route[] = []
  const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return jsonResponse(entries)
  })
  render(
    <ReceptionHistoryScreen
      storeId={STORE_ID}
      storeName="銀座店"
      api={api}
      navigate={vi.fn()}
      today="2026-08-27"
      {...extra}
    />,
  )
  return { calls, api }
}

const allEntries = [webBooking, changed, walkin, phoneBooking]

// AC-EYEX-56: same-day events in descending occurrence order.
test("lists today's reception events in descending occurrence order", async () => {
  const { calls } = renderScreen(allEntries)
  const list = await screen.findByRole('region', { name: '受付履歴' })
  const rows = await within(list).findAllByRole('button')
  const labels = rows.map((row) => row.textContent ?? '')
  expect(labels[0]).toContain('14:26')
  expect(labels[1]).toContain('14:18')
  expect(labels[2]).toContain('13:54')
  expect(labels[3]).toContain('13:32')
  expect(calls[0]?.url).toContain('date=2026-08-27')
})

// AC-EYEX-56: reservation, change, cancel and walk-in reception all appear.
test('shows reservation reception, change, cancellation and walk-in reception', async () => {
  const cancelled = {
    ...changed,
    id: '00000000-0000-4000-8000-000000000105',
    action: 'cancelled' as const,
    occurredAt: '2026-08-27T04:00:00.000Z',
  }
  renderScreen([...allEntries, cancelled])
  const list = await screen.findByRole('region', { name: '受付履歴' })
  await within(list).findAllByRole('button')
  const text = list.textContent ?? ''
  expect(text).toContain('予約受付')
  expect(text).toContain('変更')
  expect(text).toContain('取消')
  expect(text).toContain('ウォークイン受付')
})

// AC-EYEX-62 / UC-EYEX-056: only the selected store's events, no store filter.
test('shows only the selected store events and offers no store filter', async () => {
  const { calls } = renderScreen(allEntries)
  const region = await screen.findByRole('region', { name: '受付履歴' })
  await within(region).findAllByRole('button')
  expect(screen.getAllByText(/銀座店/).length).toBeGreaterThan(0)
  expect(screen.queryByText('全店舗')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('店舗')).not.toBeInTheDocument()
  expect(calls[0]?.url.startsWith(`/api/staff/stores/${STORE_ID}/reception-history?`)).toBe(true)
  expect(calls[0]?.url).not.toContain('storeId=')
})

// AC-EYEX-57: search by name, phone or reservation number.
test('filters by name, phone and reservation number', async () => {
  const { calls } = renderScreen(allEntries)
  await screen.findByRole('region', { name: '受付履歴' })
  const term = screen.getByLabelText('氏名・電話番号・予約番号')

  fireEvent.change(term, { target: { value: '田中' } })
  fireEvent.click(screen.getByRole('button', { name: '絞り込む' }))
  await waitFor(() => {
    expect(calls.at(-1)?.url).toContain('name=')
  })

  fireEvent.change(term, { target: { value: '０９０-１２３４ ５６７８' } })
  fireEvent.click(screen.getByRole('button', { name: '絞り込む' }))
  await waitFor(() => {
    expect(calls.at(-1)?.url).toContain('phone=09012345678')
  })

  fireEvent.change(term, { target: { value: 'EY-0828-1142' } })
  fireEvent.click(screen.getByRole('button', { name: '絞り込む' }))
  await waitFor(() => {
    expect(calls.at(-1)?.url).toContain('reservationNumber=EY-0828-1142')
  })
})

// AC-EYEX-58: narrow by source, action and attention state.
test('filters by reception source, operation type and attention state', async () => {
  const { calls } = renderScreen(allEntries)
  await screen.findByRole('region', { name: '受付履歴' })
  fireEvent.change(screen.getByLabelText('受付経路'), { target: { value: 'web' } })
  fireEvent.change(screen.getByLabelText('操作種別'), { target: { value: 'changed' } })
  fireEvent.click(screen.getByRole('button', { name: '要確認' }))
  fireEvent.click(screen.getByRole('button', { name: '絞り込む' }))
  await waitFor(() => {
    const url = calls.at(-1)?.url ?? ''
    expect(url).toContain('source=web')
    expect(url).toContain('action=changed')
    expect(url).toContain('requiresAttention=true')
  })
})

// AC-EYEX-61: clearing the attention filter shows every event again.
test('shows every event again once the attention filter is cleared', async () => {
  const { calls } = renderScreen(allEntries)
  await screen.findByRole('region', { name: '受付履歴' })
  const attention = screen.getByRole('button', { name: '要確認' })
  fireEvent.click(attention)
  fireEvent.click(screen.getByRole('button', { name: '絞り込む' }))
  await waitFor(() => {
    expect(calls.at(-1)?.url).toContain('requiresAttention=true')
  })

  fireEvent.click(attention)
  fireEvent.click(screen.getByRole('button', { name: '絞り込む' }))
  await waitFor(() => {
    expect(calls.at(-1)?.url).not.toContain('requiresAttention')
  })
  expect(await screen.findByText(/伊藤 健/)).toBeInTheDocument()
  expect(screen.getByText(/松本 一郎/)).toBeInTheDocument()
})

// AC-EYEX-59: selecting an event shows its detail while the list stays visible.
test('shows the selected event detail while the list stays visible', async () => {
  renderScreen(allEntries)
  const list = await screen.findByRole('region', { name: '受付履歴' })
  fireEvent.click(within(list).getByRole('button', { name: /田中 花子/ }))
  const detail = await screen.findByRole('region', { name: '受付イベント詳細' })
  expect(within(detail).getAllByText(/田中 花子/).length).toBeGreaterThan(0)
  expect(within(detail).getByText('090-1234-5678')).toBeInTheDocument()
  expect(within(detail).getByText('EY-0828-1142')).toBeInTheDocument()
  expect(within(detail).getByText('鈴木')).toBeInTheDocument()
  expect(within(detail).getByText('2026年8月27日 14:18')).toBeInTheDocument()
  expect(within(list).getByRole('button', { name: /伊藤 健/ })).toBeInTheDocument()
})

// AC-EYEX-60: a recorded phone reception shows the recording and playback for permitted staff.
test('shows recording information and playback for permitted staff', async () => {
  renderScreen(allEntries, {
    recording: {
      state: 'available',
      recordedAt: '2026-08-27T05:18:00.000Z',
      recordedBy: '鈴木',
      durationSeconds: 192,
      src: '/api/staff/recordings/stream',
    },
    permissions: { playRecording: true },
  })
  const list = await screen.findByRole('region', { name: '受付履歴' })
  fireEvent.click(within(list).getByRole('button', { name: /田中 花子/ }))
  const region = await screen.findByRole('region', { name: 'iPad録音' })
  expect(within(region).getByText('2026年8月27日 14:18')).toBeInTheDocument()
  expect(within(region).getAllByText('03:12').length).toBeGreaterThan(0)
  expect(within(region).getByText('予約受付時の録音')).toBeInTheDocument()
  expect(within(region).getByRole('button', { name: '再生' })).toBeInTheDocument()
  expect(within(region).getByRole('button', { name: '一時停止' })).toBeInTheDocument()
  expect(within(region).queryByRole('button', { name: /ダウンロード/ })).not.toBeInTheDocument()
})

// AC-EYEX-60: staff without permission never see the recording.
test('hides the recording from staff without playback permission', async () => {
  renderScreen(allEntries, {
    recording: { state: 'processing' },
    permissions: { playRecording: false },
  })
  const list = await screen.findByRole('region', { name: '受付履歴' })
  fireEvent.click(within(list).getByRole('button', { name: /田中 花子/ }))
  await screen.findByRole('region', { name: '受付イベント詳細' })
  expect(screen.queryByRole('region', { name: 'iPad録音' })).not.toBeInTheDocument()
})

// AC-EYEX-56: an empty day says so rather than showing an empty panel.
test('says so when there is no reception history for the day', async () => {
  renderScreen([])
  expect(await screen.findByText('条件に一致する受付履歴はありません。')).toBeInTheDocument()
})

// AC-EYEX-60 / UC-EYEX-032: the recording shown belongs to the selected event,
// not to the screen as a whole.
test('選択した受付イベントの録音だけを表示する', async () => {
  const resolveRecording = vi.fn((entry: { id: string }) =>
    entry.id === phoneBooking.id
      ? ({
          state: 'available',
          recordedAt: '2026-08-27T05:18:00.000Z',
          recordedBy: '共有iPad',
          durationSeconds: 60,
          src: `/api/staff/stores/${STORE_ID}/recordings/r1/audio`,
        } as const)
      : ({ state: 'none' } as const),
  )
  renderScreen(allEntries, { permissions: { playRecording: true }, resolveRecording })
  const list = await screen.findByRole('region', { name: '受付履歴' })

  fireEvent.click(within(list).getByRole('button', { name: /伊藤 健/ }))
  expect(
    within(await screen.findByRole('region', { name: 'iPad録音' })).getByText(
      'この予約に紐づく録音はありません。',
    ),
  ).toBeInTheDocument()

  fireEvent.click(within(list).getByRole('button', { name: /田中 花子/ }))
  const region = await screen.findByRole('region', { name: 'iPad録音' })
  expect(within(region).getByText('共有iPad')).toBeInTheDocument()
})

/* ------------------------------------------------------------------ *
 * 承認済みモックの構造（reception-history-approved.html）
 * ------------------------------------------------------------------ */

// `.history{grid-template-columns:390px 1fr}` / `.list` は panel 面 + 右ヘアライン。
test('lays the reception history out as the approved two-pane 390px + 1fr grid', async () => {
  renderScreen(allEntries)
  const list = await screen.findByRole('region', { name: '受付履歴' })
  const pane = list.closest('aside') as HTMLElement
  expect(pane.className).toContain('bg-panel')
  expect(pane.className).toContain('border-line')
  expect(pane.className).toContain('border-r')
  expect(pane.className).toContain('overflow-auto')
  const workspace = pane.parentElement as HTMLElement
  expect(workspace.className).toContain('grid-cols-[390px_1fr]')
  expect(workspace.className).toContain('h-full')
})

// `.tools`: 2px pine の検索欄と、その隣に並ぶ `.filter` チップ。
test('renders the approved tools row: a 2px pine search box beside filter chips', async () => {
  renderScreen(allEntries)
  await screen.findByRole('region', { name: '受付履歴' })
  const field = screen.getByLabelText('氏名・電話番号・予約番号')
  expect(field.className).toContain('min-h-11')
  expect(field.className).toContain('border-2')
  expect(field.className).toContain('border-pine')
  expect(field.className).toContain('bg-surface')
  expect(field.className).toContain('rounded-ctl')
  for (const label of ['受付経路', '操作種別']) {
    const control = screen.getByLabelText(label)
    expect(control.className).toContain('min-h-11')
    expect(control.className).toContain('border-line')
    expect(control.className).toContain('rounded-ctl')
  }
  // フィルターは一覧のリージョンの外。リージョンには受付イベントだけが並ぶ。
  const list = screen.getByRole('region', { name: '受付履歴' })
  expect(within(list).queryByLabelText('受付経路')).not.toBeInTheDocument()
  expect(within(list).getAllByRole('button')).toHaveLength(allEntries.length)
})

// `.day` の日付見出しと、`.event` / `.event.on` の行。
test('groups the events under the approved day heading and marks the open one', async () => {
  renderScreen(allEntries)
  const list = await screen.findByRole('region', { name: '受付履歴' })
  expect(screen.getByText('8月27日（木）')).toBeInTheDocument()
  const row = within(list).getByRole('button', { name: /田中 花子/ })
  expect(row.className).toContain('rounded-card')
  expect(row.className).toContain('border-line')
  expect(row.className).toContain('bg-surface')

  fireEvent.click(row)
  await screen.findByRole('region', { name: '受付イベント詳細' })
  const open = within(list).getByRole('button', { name: /田中 花子/ })
  expect(open.className).toContain('border-2')
  expect(open.className).toContain('border-pine')
  expect(open.className).toContain('bg-pine-soft')
  expect(within(open).getByText('選択中')).toBeInTheDocument()
})

// 詳細ペインは `.detailhead` + `.detailgrid`（1.15fr .85fr）の 2 枚組。
test('renders the detail head and the approved 1.15fr / .85fr card grid', async () => {
  renderScreen(allEntries)
  const list = await screen.findByRole('region', { name: '受付履歴' })
  fireEvent.click(within(list).getByRole('button', { name: /田中 花子/ }))
  const detail = await screen.findByRole('region', { name: '受付イベント詳細' })
  expect(
    within(detail).getByRole('heading', { name: '田中 花子様の予約を登録' }),
  ).toBeInTheDocument()
  expect(within(detail).getByText('2026年8月27日 14:18 · 受付者 鈴木')).toBeInTheDocument()
  expect(within(detail).getByText('予約内容')).toBeInTheDocument()
  expect(within(detail).getByText('お客様')).toBeInTheDocument()
  const grid = within(detail).getByText('予約内容').closest('div')?.parentElement as HTMLElement
  expect(grid.className).toContain('grid-cols-[1.15fr_0.85fr]')
})

// exception-states-approved.html `#empty`: 空表示は回復操作を必ず連れてくる。
test('offers the approved recovery action when no event matches', async () => {
  const { calls } = renderScreen([])
  expect(await screen.findByText('条件に一致する受付履歴はありません。')).toBeInTheDocument()
  expect(
    screen.getByText('検索語またはフィルターを変更してください。履歴自体は削除されていません。'),
  ).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('受付経路'), { target: { value: 'web' } })
  fireEvent.click(screen.getByRole('button', { name: '絞り込む' }))
  await waitFor(() => {
    expect(calls.at(-1)?.url).toContain('source=web')
  })
  fireEvent.click(screen.getByRole('button', { name: 'フィルターをすべて解除' }))
  await waitFor(() => {
    expect(calls.at(-1)?.url).not.toContain('source=web')
  })
  expect(screen.getByLabelText('受付経路')).toHaveValue('')
})

// exception-states-approved.html `#permission-denied`。
test('shows the approved permission-denied state with a way back', async () => {
  const navigate = vi.fn()
  const api = vi.fn(async () => jsonResponse({ error: 'forbidden' }, 403))
  render(
    <ReceptionHistoryScreen
      storeId={STORE_ID}
      storeName="銀座店"
      api={api}
      navigate={navigate}
      today="2026-08-27"
    />,
  )
  expect(await screen.findByText('この設定を表示する権限がありません')).toBeInTheDocument()
  expect(
    screen.getByText(
      '権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。',
    ),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '業務開始画面へ戻る' }))
  expect(navigate).toHaveBeenCalledWith({ screen: 'home' })
})
