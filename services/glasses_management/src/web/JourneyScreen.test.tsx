import type { LedgerEntry } from '@app/contracts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, type Mock, test, vi } from 'vitest'
import { JourneyScreen } from './JourneyScreen'
import type { StaffApi } from './staff-screen'

const STORE_ID = '11111111-1111-4111-8111-111111111111'
const RESERVATION_ID = '22222222-2222-4222-8222-222222222222'
const WALKIN_ID = '33333333-3333-4333-8333-333333333333'
const STAFF_ID = '44444444-4444-4444-8444-444444444444'
const EQUIPMENT_ID = '55555555-5555-4555-8555-555555555555'
const DATE = '2026-08-27'
const NOW = '2026-08-27T02:08:00.000Z' // 11:08 JST

function reservation(overrides: Partial<Extract<LedgerEntry, { entryType: 'reservation' }>> = {}) {
  return {
    id: RESERVATION_ID,
    entryType: 'reservation',
    source: 'web',
    status: 'confirmed',
    startAt: '2026-08-27T02:00:00.000Z',
    endAt: '2026-08-27T03:00:00.000Z',
    customerName: '田中 花子',
    customerId: '66666666-6666-4666-8666-666666666666',
    progress: 'waiting',
    waitStartedAt: '2026-08-27T01:50:00.000Z', // 18 minutes before NOW
    assignedStaffId: null,
    assignedEquipmentIds: [],
    nextGuidance: null,
    purposeNames: ['視力測定'],
    warnings: [],
    version: 3,
    ...overrides,
  }
}

function walkin(overrides: Partial<Extract<LedgerEntry, { entryType: 'walkin' }>> = {}) {
  return {
    id: WALKIN_ID,
    entryType: 'walkin',
    source: 'walkin',
    status: 'active',
    startAt: '2026-08-27T02:30:00.000Z',
    endAt: '2026-08-27T03:00:00.000Z',
    customerName: 'ウォークイン 3',
    customerId: null,
    progress: 'waiting',
    waitStartedAt: '2026-08-27T02:00:00.000Z',
    assignedStaffId: null,
    assignedEquipmentIds: [],
    nextGuidance: null,
    warnings: [],
    version: 1,
    ...overrides,
  }
}

/** Names for the ids the board would otherwise have to show raw. */
const SETTINGS = {
  storeId: STORE_ID,
  version: 3,
  receptionStatus: 'open',
  businessHours: [],
  exceptions: [],
  purposes: [],
  staff: [
    { id: STAFF_ID, name: '佐藤 美咲', skills: ['refraction'], canBook: true, isActive: true },
  ],
  shifts: [],
  equipment: [
    { id: EQUIPMENT_ID, name: '測定機A', capacity: 1, isActive: true, availablePeriods: [] },
  ],
  maintenance: [],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

/** Answers the settings join from a fixture and everything else from a queue. */
function mockApi(...queue: (() => Response)[]): Mock<StaffApi> {
  const pending = [...queue]
  return vi.fn<StaffApi>(async (input) => {
    if (String(input).includes('/availability/settings')) return json(SETTINGS)
    const next = pending.length > 1 ? pending.shift() : pending[0]
    return next ? next() : json([])
  })
}

function renderJourney(api: Mock<StaffApi>) {
  return render(
    <JourneyScreen
      storeId={STORE_ID}
      storeName="銀座店"
      api={api}
      navigate={vi.fn()}
      date={DATE}
      now={NOW}
    />,
  )
}

/*
 * 工程盤は `display:grid` の帯組みそのものがモックの見た目なので、行を要素で
 * 包めない（包むと格子が崩れる）。行は `aria-rowindex` が持つので、1 人目の
 * 工程セルはそれで取り出す。1 列目はお客様の名乗り（行見出し）なので外す。
 */
function stageCellsOfFirstRow(board: HTMLElement): HTMLElement[] {
  return within(board)
    .getAllByRole('gridcell')
    .filter((cell) => cell.getAttribute('aria-rowindex') === '2')
}

test('heads the board with the approved service stages (JOURNEY-DEFAULT)', async () => {
  const api = mockApi(() => json([reservation()]))
  renderJourney(api)

  expect(await screen.findByRole('heading', { name: '接客の進み具合' })).toBeInTheDocument()
  const board = screen.getByRole('grid', { name: '接客の進み具合' })
  expect(
    within(board)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['お客様', '受付・相談', 'フレーム', '視力測定', 'レンズ・調整'])
})

test('lists in-store customers by stage with their waiting time (UC-EYEX-052)', async () => {
  const api = mockApi(() => json([reservation(), walkin()]))
  renderJourney(api)

  const board = await screen.findByRole('grid', { name: '接客の進み具合' })
  expect(api).toHaveBeenCalledWith(`/api/staff/stores/${STORE_ID}/ledger?date=${DATE}`)
  expect(within(board).getByText('田中 花子')).toBeInTheDocument()
  expect(within(board).getByText('待ち18分')).toBeInTheDocument()
  expect(within(board).getByText('ウォークイン 3')).toBeInTheDocument()
  expect(within(board).getByText('顧客未登録')).toBeInTheDocument()
})

test('marks the stage already passed, the stage in hand and the one to go next (JOURNEY-DEFAULT)', async () => {
  const api = mockApi(() =>
    json([
      reservation({
        progress: 'service_in_progress',
        assignedStaffId: STAFF_ID,
        nextGuidance: '測定機A 10:30',
      }),
    ]),
  )
  renderJourney(api)

  const board = await screen.findByRole('grid', { name: '接客の進み具合' })
  const cells = stageCellsOfFirstRow(board)
  expect(cells[0]).toHaveTextContent('受付済み')
  expect(cells[1]).toHaveTextContent('相談中')
  expect(cells[1]).toHaveTextContent('佐藤 美咲')
  expect(cells[2]).toHaveTextContent('次にご案内')
  expect(cells[2]).toHaveTextContent('測定機A 10:30')
  // The next step is named, not merely tinted.
  expect(cells[2]).toHaveAttribute('data-next', 'true')
  // まだ手を付けていない工程は、空白ではなく「未着手」と読み上げる（画素は変えない）。
  expect(cells[3]).toHaveTextContent('未着手')
  expect(cells[3]).not.toHaveAttribute('data-next')
})

test('marks a customer who has not been started as ready to begin (JOURNEY-DEFAULT)', async () => {
  const api = mockApi(() => json([walkin()]))
  renderJourney(api)

  const board = await screen.findByRole('grid', { name: '接客の進み具合' })
  const cells = stageCellsOfFirstRow(board)
  expect(cells[0]).toHaveTextContent('相談待ち')
  expect(cells[0]).toHaveTextContent('このまま開始可能')
  expect(cells[0]).toHaveAttribute('data-next', 'true')
})

test('carries the next handover instruction in its own panel (JOURNEY-DEFAULT, AC-EYEX-25)', async () => {
  const api = mockApi(() =>
    json([reservation({ progress: 'service_in_progress', nextGuidance: '測定機Aへご案内' })]),
  )
  renderJourney(api)

  const handover = await screen.findByRole('region', { name: '次の引き継ぎ' })
  expect(handover).toHaveTextContent('田中 花子')
  expect(handover).toHaveTextContent('測定機Aへご案内')
})

test('receives a customer standing in the shop as the primary action (UC-EYEX-047)', async () => {
  const api = mockApi(
    () => json([]),
    () => json({ id: WALKIN_ID }, 201),
    () => json([walkin()]),
  )
  renderJourney(api)

  fireEvent.click(await screen.findByRole('button', { name: '＋ 店頭のお客様を受付' }))

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/api/staff/stores/${STORE_ID}/walkins`,
      expect.objectContaining({ method: 'POST', body: '{}' }),
    ),
  )
})

test('records an arrival for a confirmed reservation (UC-EYEX-051)', async () => {
  const api = mockApi(
    () => json([reservation({ progress: null, waitStartedAt: null })]),
    () => json(reservation({ progress: 'waiting' })),
    () => json([reservation({ progress: 'waiting' })]),
  )
  renderJourney(api)

  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  fireEvent.click(screen.getByRole('button', { name: '来店済みとして記録する' }))

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/api/staff/stores/${STORE_ID}/reservations/${RESERVATION_ID}/progress`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ version: 3, progress: 'waiting' }),
      }),
    ),
  )
})

test('records a cancellation with its reason (UC-EYEX-051)', async () => {
  const api = mockApi(
    () => json([reservation()]),
    () => json({}, 200),
    () => json([reservation({ status: 'cancelled' })]),
  )
  renderJourney(api)

  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  fireEvent.change(screen.getByLabelText('取消の理由'), { target: { value: 'お客様都合' } })
  fireEvent.click(screen.getByRole('button', { name: '予約を取り消す' }))

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/api/staff/stores/${STORE_ID}/reservations/${RESERVATION_ID}/cancel`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ version: 3, reason: 'お客様都合', confirmation: '取り消す' }),
      }),
    ),
  )
})

test('records a no-show (UC-EYEX-051)', async () => {
  const api = mockApi(
    () => json([reservation()]),
    () => json({}, 200),
    () => json([reservation({ status: 'no_show' })]),
  )
  renderJourney(api)

  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  fireEvent.click(screen.getByRole('button', { name: '無断キャンセルとして記録する' }))

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/api/staff/stores/${STORE_ID}/reservations/${RESERVATION_ID}/no-show`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 3 }) }),
    ),
  )
})

test('updates stage, staff, equipment and the next guidance together (UC-EYEX-052, AC-EYEX-25)', async () => {
  const api = mockApi(
    () => json([reservation()]),
    () => json(reservation({ progress: 'service_in_progress' })),
    () => json([reservation({ progress: 'service_in_progress' })]),
  )
  renderJourney(api)

  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  fireEvent.change(screen.getByLabelText('店内工程'), { target: { value: 'service_in_progress' } })
  fireEvent.change(screen.getByLabelText('担当者ID'), { target: { value: STAFF_ID } })
  fireEvent.change(screen.getByLabelText('設備ID'), { target: { value: EQUIPMENT_ID } })
  fireEvent.change(screen.getByLabelText('次のご案内'), {
    target: { value: '測定機Aへご案内してください' },
  })
  fireEvent.click(screen.getByRole('button', { name: '接客の状況を保存する' }))

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/api/staff/stores/${STORE_ID}/reservations/${RESERVATION_ID}/progress`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          version: 3,
          progress: 'service_in_progress',
          assignedStaffId: STAFF_ID,
          assignedEquipmentIds: [EQUIPMENT_ID],
          nextGuidance: '測定機Aへご案内してください',
        }),
      }),
    ),
  )
})

test('updates a walk-in stage through the walk-in endpoint (UC-EYEX-052)', async () => {
  const api = mockApi(
    () => json([walkin()]),
    () => json({ id: WALKIN_ID, version: 2 }),
    () => json([walkin({ progress: 'service_in_progress', version: 2 })]),
  )
  renderJourney(api)

  fireEvent.click(await screen.findByRole('button', { name: /ウォークイン 3/ }))
  fireEvent.change(screen.getByLabelText('店内工程'), { target: { value: 'service_in_progress' } })
  fireEvent.click(screen.getByRole('button', { name: '接客の状況を保存する' }))

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/api/staff/stores/${STORE_ID}/walkins/${WALKIN_ID}/progress`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ version: 1, progress: 'service_in_progress' }),
      }),
    ),
  )
})

test('states each warning in words, never by colour alone (UC-EYEX-053, AC-EYEX-26)', async () => {
  const api = mockApi(() =>
    json([
      reservation({
        warnings: [
          {
            code: 'long_wait',
            message: '待機時間が12分を超えています。次のご案内を確認してください。',
          },
          { code: 'staff_unassigned', message: '担当者が割り当てられていません。' },
          {
            code: 'equipment_unavailable',
            message: '設備が停止中です。別の設備をご用意ください。',
          },
        ],
      }),
    ]),
  )
  renderJourney(api)

  const warnings = await screen.findByRole('region', { name: '注意が必要なお客様' })
  expect(within(warnings).getByText('長時間待機')).toBeInTheDocument()
  expect(within(warnings).getByText('担当不在')).toBeInTheDocument()
  expect(within(warnings).getByText('設備停止')).toBeInTheDocument()
  expect(
    within(warnings).getByText('待機時間が12分を超えています。次のご案内を確認してください。'),
  ).toBeInTheDocument()
  expect(within(warnings).getAllByText('田中 花子')).not.toHaveLength(0)
})

test('refuses a stale save and compares the latest content with this terminal’s input (UC-EYEX-172, UC-EYEX-173, AC-EYEX-110)', async () => {
  const api = mockApi(
    () => json([reservation()]),
    () => json({ error: 'version_conflict', currentVersion: 7 }, 409),
    () => json([reservation({ version: 7 })]),
    () => json(reservation({ version: 8, progress: 'service_completed' })),
    () => json([reservation({ version: 8, progress: 'service_completed' })]),
  )
  renderJourney(api)

  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  fireEvent.change(screen.getByLabelText('店内工程'), { target: { value: 'service_completed' } })
  fireEvent.click(screen.getByRole('button', { name: '接客の状況を保存する' }))

  const conflict = await screen.findByRole('region', { name: '別の端末で先に更新されています' })
  expect(within(conflict).getByText('最新の内容')).toBeInTheDocument()
  expect(within(conflict).getByText('この端末の入力')).toBeInTheDocument()
  expect(within(conflict).getByText(/版 7/)).toBeInTheDocument()

  fireEvent.click(within(conflict).getByRole('button', { name: '最新内容へ再適用' }))

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/api/staff/stores/${STORE_ID}/reservations/${RESERVATION_ID}/progress`,
      expect.objectContaining({
        body: JSON.stringify({
          version: 7,
          progress: 'service_completed',
          assignedStaffId: null,
          assignedEquipmentIds: [],
          nextGuidance: null,
        }),
      }),
    ),
  )
})

test('reports a failed load with a recovery instruction', async () => {
  const api = mockApi(() => new Response('', { status: 500 }))
  renderJourney(api)

  expect(await screen.findByRole('alert')).toHaveTextContent(
    '来店状況を読み込めませんでした。通信を確認してもう一度お試しください。',
  )
})
