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

/** 選択した記録がぶら下がる予約。来店日時と目的はここからしか取れない。 */
const reservation = {
  id: '00000000-0000-4000-8000-000000000902',
  organizationId: 'org-1',
  storeId: STORE_ID,
  reservationNumber: 'EY-0828-1142',
  source: 'staff' as const,
  status: 'confirmed' as const,
  startAt: '2026-08-28T02:00:00.000Z', // 8月28日（金）11:00 JST
  endAt: '2026-08-28T03:00:00.000Z',
  purposeIds: ['00000000-0000-4000-8000-000000000020'],
  customer: { name: '田中 花子', kana: 'タナカ ハナコ', phone: '090-1234-5678', email: null },
  recital: '8月28日11時にご来店ください。',
  reservationMemo: null,
  handoffNote: null,
  version: 1,
  createdAt: '2026-08-26T05:18:00.000Z',
}

const availabilitySettings = {
  version: 3,
  receptionStatus: 'open' as const,
  businessHours: [],
  exceptions: [],
  staff: [],
  shifts: [],
  equipment: [],
  maintenance: [],
  purposes: [
    {
      id: '00000000-0000-4000-8000-000000000020',
      staffName: '視力測定・新調相談',
      customerLabel: '視力測定・新調相談',
      durationMinutes: 60,
      slotIntervalMinutes: 30,
      isPublic: true,
      requiredSkills: [],
      requiredEquipment: [],
      maxConcurrent: 1,
    },
  ],
}

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
    const url = String(input)
    calls.push({ url, init })
    if (url.includes('/availability/settings')) return jsonResponse(availabilitySettings)
    if (url.endsWith('/history')) return jsonResponse([])
    if (url.includes('/reservations/')) return jsonResponse(reservation)
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
  // 何が起きたかは行の本文が言い、右肩のチップは経路だけを名乗る。
  expect(text).toContain('予約を登録')
  expect(text).toContain('日時を変更')
  expect(text).toContain('予約を取消')
  expect(text).toContain('を受付')
  expect(text).toContain('店頭')
  expect(text).toContain('電話')
  expect(text).toContain('Web')
  expect(text).toContain('変更')
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

/*
 * 承認済みモックの `.tools` は検索欄とチップだけで、送信ボタンを持たない。
 * 確定は欄そのものの submit（Enter）で起こる。
 */
function submitSearch() {
  const field = screen.getByLabelText('氏名・電話番号・予約番号')
  fireEvent.submit(field.closest('form') as HTMLFormElement)
}

// AC-EYEX-57: search by name, phone or reservation number.
test('filters by name, phone and reservation number', async () => {
  const { calls } = renderScreen(allEntries)
  await screen.findByRole('region', { name: '受付履歴' })
  const term = screen.getByLabelText('氏名・電話番号・予約番号')

  fireEvent.change(term, { target: { value: '田中' } })
  submitSearch()
  await waitFor(() => {
    expect(calls.at(-1)?.url).toContain('name=')
  })

  fireEvent.change(term, { target: { value: '０９０-１２３４ ５６７８' } })
  submitSearch()
  await waitFor(() => {
    expect(calls.at(-1)?.url).toContain('phone=09012345678')
  })

  fireEvent.change(term, { target: { value: 'EY-0828-1142' } })
  submitSearch()
  await waitFor(() => {
    expect(calls.at(-1)?.url).toContain('reservationNumber=EY-0828-1142')
  })
})

/*
 * AC-EYEX-58: 経路・操作・要確認で絞り込む。ネイティブの `<select>` は使わない
 * ので、モックが記録の右肩で使っている狭い語（店頭 / 電話 / Web / 変更）を
 * そのままチップにする。押されているかどうかは `aria-pressed` が言う。
 */
test('filters by reception source, operation type and attention state', async () => {
  const { calls } = renderScreen(allEntries)
  await screen.findByRole('region', { name: '受付履歴' })
  expect(screen.queryAllByRole('combobox')).toHaveLength(0)

  fireEvent.click(screen.getByRole('button', { name: 'Web' }))
  await waitFor(() => {
    expect(calls.at(-1)?.url).toContain('source=web')
  })
  fireEvent.click(screen.getByRole('button', { name: '変更' }))
  await waitFor(() => {
    const url = calls.at(-1)?.url ?? ''
    expect(url).toContain('action=changed')
    expect(url).not.toContain('source=')
  })
  fireEvent.click(screen.getByRole('button', { name: '要確認' }))
  await waitFor(() => {
    expect(calls.at(-1)?.url).toContain('requiresAttention=true')
  })
})

// AC-EYEX-61: clearing the attention filter shows every event again.
test('shows every event again once the attention filter is cleared', async () => {
  const { calls } = renderScreen(allEntries)
  await screen.findByRole('region', { name: '受付履歴' })
  const attention = screen.getByRole('button', { name: '要確認' })
  fireEvent.click(attention)
  await waitFor(() => {
    expect(calls.at(-1)?.url).toContain('requiresAttention=true')
  })

  fireEvent.click(attention)
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
  expect(within(detail).getByText('2026年8月27日 14:18 · 受付者 鈴木')).toBeInTheDocument()
  expect(within(list).getByRole('button', { name: /伊藤 健/ })).toBeInTheDocument()
})

/*
 * 承認済みモックの `.detailgrid` は「来店 / 目的 / 予約番号 / 受付経路」と
 * 「顧客照合 / 変更履歴」。発生日時と操作は見出しの下がすでに言っているので、
 * カードは「いつ来るのか・何をしに来るのか」を持つ。
 */
test('names the detail rows as the approved mock does', async () => {
  renderScreen(allEntries)
  const list = await screen.findByRole('region', { name: '受付履歴' })
  fireEvent.click(within(list).getByRole('button', { name: /田中 花子/ }))
  const detail = await screen.findByRole('region', { name: '受付イベント詳細' })
  expect(within(detail).getByText('来店')).toBeInTheDocument()
  expect(await within(detail).findByText('2026年8月28日 11:00')).toBeInTheDocument()
  expect(within(detail).getByText('目的')).toBeInTheDocument()
  expect(within(detail).getByText('視力測定・新調相談')).toBeInTheDocument()
  expect(within(detail).getByText('受付経路')).toBeInTheDocument()
  expect(within(detail).getByText('顧客照合')).toBeInTheDocument()
  expect(within(detail).getByText('変更履歴')).toBeInTheDocument()
  // 実装が持っていた「発生日時 / 操作」はモックに無い。
  expect(within(detail).queryByText('発生日時')).not.toBeInTheDocument()
  expect(within(detail).queryByText('操作')).not.toBeInTheDocument()
})

/*
 * 右肩のバッジは状態そのもの。通常の状態を失敗の色（danger）で出すと、
 * 「予約が取れている」ことが赤で伝わってしまう。通常は緑、注意は琥珀。
 */
test('shows the state badge in the role colour, not in danger red', async () => {
  renderScreen(allEntries)
  const list = await screen.findByRole('region', { name: '受付履歴' })
  fireEvent.click(within(list).getByRole('button', { name: /伊藤 健/ }))
  const detail = await screen.findByRole('region', { name: '受付イベント詳細' })
  const normal = within(detail).getByText('予約済み')
  expect(normal.className).toContain('bg-pine-soft')
  expect(normal.className).not.toContain('danger')

  fireEvent.click(within(list).getByRole('button', { name: /田中 花子/ }))
  const attention = await within(
    await screen.findByRole('region', { name: '受付イベント詳細' }),
  ).findByText('要確認')
  expect(attention.className).toContain('bg-amber-soft')
})

/*
 * 記録の右肩は経路だけを名乗る狭いチップ（店頭 / 電話 / Web / 変更）。
 * 「ウォークイン受付」「予約受付」のような長い操作名はモックに無い。
 */
test('labels each event with the approved narrow route chip', async () => {
  renderScreen(allEntries)
  const list = await screen.findByRole('region', { name: '受付履歴' })
  const chip = (name: RegExp) =>
    within(within(list).getByRole('button', { name })).getByText(/^(店頭|電話|Web|変更|取消|無断)$/)
      .textContent
  expect(chip(/ウォークイン/)).toBe('店頭')
  expect(chip(/田中 花子/)).toBe('電話')
  expect(chip(/伊藤 健/)).toBe('Web')
  expect(chip(/松本 一郎/)).toBe('変更')
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
  // モックの `.wave` — 録音があることだけを示す装飾。読み上げには出さない。
  expect(region.querySelector('[data-wave]')).not.toBeNull()
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
  // 列幅 390px は 4 の倍数でない実測値なので、配置としてインラインで持つ。
  const workspace = pane.parentElement as HTMLElement
  expect(workspace.style.gridTemplateColumns).toBe('390px 1fr')
  expect(workspace.className).toContain('flex-1')
})

// `.tools`: 2px pine の検索欄と、その隣に並ぶ `.filter` チップ。
test('renders the approved tools row: a 2px pine search box beside filter chips', async () => {
  renderScreen(allEntries)
  await screen.findByRole('region', { name: '受付履歴' })
  const field = screen.getByLabelText('氏名・電話番号・予約番号')
  // `.search{min-height:48px}` — 絞り込みの 44px より 1 段高い。
  expect(field.className).toContain('min-h-12')
  expect(field.className).toContain('border-2')
  expect(field.className).toContain('border-pine')
  expect(field.className).toContain('bg-surface')
  expect(field.className).toContain('rounded-ctl')
  for (const label of ['要確認', '店頭', '電話', 'Web', '変更']) {
    const control = screen.getAllByRole('button', { name: label })[0] as HTMLElement
    expect(control.className).toContain('min-h-11')
    expect(control.className).toContain('border-line')
    expect(control.className).toContain('rounded-ctl')
  }
  // フィルターは一覧のリージョンの外。リージョンには受付イベントだけが並ぶ。
  const list = screen.getByRole('region', { name: '受付履歴' })
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
  // 選択は罫と `aria-pressed` が言う。モックに「選択中」の行は無い。
  expect(within(open).queryByText('選択中')).not.toBeInTheDocument()
  expect(open).toHaveAttribute('aria-pressed', 'true')
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
  expect(grid.style.gridTemplateColumns).toBe('1.15fr .85fr')
})

// exception-states-approved.html `#empty`: 空表示は回復操作を必ず連れてくる。
test('offers the approved recovery action when no event matches', async () => {
  const { calls } = renderScreen([])
  expect(await screen.findByText('条件に一致する受付履歴はありません。')).toBeInTheDocument()
  expect(
    screen.getByText('検索語またはフィルターを変更してください。履歴自体は削除されていません。'),
  ).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Web' }))
  await waitFor(() => {
    expect(calls.at(-1)?.url).toContain('source=web')
  })
  fireEvent.click(screen.getByRole('button', { name: 'フィルターをすべて解除' }))
  await waitFor(() => {
    expect(calls.at(-1)?.url).not.toContain('source=web')
  })
  expect(screen.getByRole('button', { name: 'Web' })).toHaveAttribute('aria-pressed', 'false')
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

/*
 * AC-EYEX-60: 権限が無いときは録音の面ごと出さない。見出し「iPad録音」だけが
 * 残ると、何も無い見出しが宙に浮いたうえ「録音がある」ことを漏らしてしまう。
 */
test('does not leave the iPad録音 heading behind when playback is not permitted', async () => {
  renderScreen(allEntries, {
    recording: { state: 'processing' },
    permissions: { playRecording: false },
  })
  const list = await screen.findByRole('region', { name: '受付履歴' })
  fireEvent.click(within(list).getByRole('button', { name: /田中 花子/ }))
  const detail = await screen.findByRole('region', { name: '受付イベント詳細' })
  expect(within(detail).queryByText('iPad録音')).not.toBeInTheDocument()
})
