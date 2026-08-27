import type { LedgerEntry } from '@app/contracts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, type Mock, test, vi } from 'vitest'
import { LedgerScreen } from './LedgerScreen'
import type { StaffApi } from './staff-screen'

const STORE_ID = '11111111-1111-4111-8111-111111111111'
const RESERVATION_ID = '22222222-2222-4222-8222-222222222222'
const WALKIN_ID = '33333333-3333-4333-8333-333333333333'
const STAFF_ID = '44444444-4444-4444-8444-444444444444'
const EQUIPMENT_ID = '55555555-5555-4555-8555-555555555555'
const CUSTOMER_ID = '66666666-6666-4666-8666-666666666666'
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
    customerId: CUSTOMER_ID,
    progress: 'waiting',
    waitStartedAt: '2026-08-27T01:50:00.000Z',
    assignedStaffId: STAFF_ID,
    assignedEquipmentIds: [EQUIPMENT_ID],
    nextGuidance: '測定機Aへご案内',
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
    waitStartedAt: '2026-08-27T02:30:00.000Z',
    assignedStaffId: null,
    assignedEquipmentIds: [],
    nextGuidance: null,
    warnings: [],
    version: 1,
    ...overrides,
  }
}

/**
 * The names the ledger's lanes are labelled with. The screen fetches these
 * itself: an operator must never be shown a raw id, and `StaffWorkspace` is
 * not the owner of this join.
 */
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

/**
 * A staff fetch double that answers the settings join from a fixture and the
 * ledger (and every write) from an ordered queue, so a test only has to spell
 * out the calls it cares about.
 */
function mockApi(...queue: (() => Response)[]): Mock<StaffApi> {
  const pending = [...queue]
  return vi.fn<StaffApi>(async (input) => {
    if (String(input).includes('/availability/settings')) return json(SETTINGS)
    const next = pending.length > 1 ? pending.shift() : pending[0]
    return next ? next() : json([])
  })
}

function renderLedger(api: Mock<StaffApi>, props: { date?: string; now?: string } = {}) {
  return render(
    <LedgerScreen
      storeId={STORE_ID}
      storeName="銀座店"
      api={api}
      navigate={vi.fn()}
      date={props.date ?? DATE}
      now={props.now ?? NOW}
    />,
  )
}

test('shows web, staff-taken and walk-in entries on one time axis with a text source label (UC-EYEX-043)', async () => {
  const api = mockApi(() => json([reservation({ source: 'staff' }), walkin()]))
  renderLedger(api)

  await screen.findByText('田中 花子')
  expect(api).toHaveBeenCalledWith(`/api/staff/stores/${STORE_ID}/ledger?date=${DATE}`)
  const ledger = screen.getByRole('table', { name: '予約台帳' })
  // Source is readable as text, never as colour alone.
  expect(within(ledger).getByText('店頭・電話')).toBeInTheDocument()
  expect(within(ledger).getByText('ウォークイン 3')).toBeInTheDocument()
  expect(within(ledger).getByRole('columnheader', { name: '10:00' })).toBeInTheDocument()
})

test('heads the time axis with the mock’s 30-minute columns (LEDGER-DAY)', async () => {
  const api = mockApi(() => json([reservation()]))
  renderLedger(api)

  const ledger = await screen.findByRole('table', { name: '予約台帳' })
  const headers = within(ledger).getAllByRole('columnheader')
  expect(headers[0]).toHaveTextContent('担当者')
  expect(headers.slice(1, 8).map((cell) => cell.textContent)).toEqual([
    '10:00',
    '10:30',
    '11:00',
    '11:30',
    '12:00',
    '12:30',
    '13:00',
  ])
})

test('labels each lane with the staff member’s name and gives walk-ins their own lane (LEDGER-DAY)', async () => {
  const api = mockApi(() => json([reservation(), walkin()]))
  renderLedger(api)

  const ledger = await screen.findByRole('table', { name: '予約台帳' })
  expect(within(ledger).getByRole('rowheader', { name: '佐藤 美咲' })).toBeInTheDocument()
  expect(within(ledger).getByRole('rowheader', { name: 'ウォークイン' })).toBeInTheDocument()
  // A raw id is never shown to an operator.
  expect(within(ledger).queryByText(new RegExp(STAFF_ID.slice(0, 8)))).not.toBeInTheDocument()
})

test('draws the now line at the current JST time on today, clear of the time header (AC-EYEX-13)', async () => {
  const api = mockApi(() => json([reservation()]))
  renderLedger(api)

  const chip = await screen.findByText('現在 11:08')
  // The chip belongs to the now line, not to the header row that it must not cover.
  expect(chip.closest('[data-now-line]')).not.toBeNull()
  expect(chip.closest('[role="columnheader"]')).toBeNull()
})

test('omits the now line on another day (AC-EYEX-19)', async () => {
  const api = mockApi(() => json([reservation()]))
  renderLedger(api, { date: '2026-08-26' })

  await screen.findByText('田中 花子')
  expect(screen.queryByText(/^現在 /)).not.toBeInTheDocument()
})

test('switches between the staff view and the equipment view, both named (UC-EYEX-044)', async () => {
  const api = mockApi(() => json([reservation()]))
  renderLedger(api)

  const equipmentView = await screen.findByRole('button', { name: '設備で見る' })
  expect(screen.getByRole('button', { name: '担当者で見る' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByRole('rowheader', { name: '佐藤 美咲' })).toBeInTheDocument()

  fireEvent.click(equipmentView)

  expect(equipmentView).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('rowheader', { name: '測定機A' })).toBeInTheDocument()
  expect(screen.queryByRole('rowheader', { name: '佐藤 美咲' })).not.toBeInTheDocument()
})

test('opens an entry detail beside the ledger without hiding it (UC-EYEX-046)', async () => {
  const api = mockApi(() => json([reservation()]))
  renderLedger(api)

  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))

  const detail = screen.getByRole('region', { name: '選択中の予約' })
  expect(within(detail).getByText('測定機Aへご案内')).toBeInTheDocument()
  expect(screen.getByRole('table', { name: '予約台帳' })).toBeInTheDocument()
})

test('receives a walk-in with no customer record and shows it waiting (UC-EYEX-047, AC-EYEX-11)', async () => {
  const api = mockApi(
    () => json([]),
    () =>
      json(
        {
          id: WALKIN_ID,
          entryType: 'walkin',
          provisionalLabel: 'ウォークイン 3',
          customerId: null,
          progress: 'waiting',
          status: 'active',
          arrivedAt: '2026-08-27T02:30:00.000Z',
          version: 1,
        },
        201,
      ),
    () => json([walkin()]),
  )
  renderLedger(api)

  fireEvent.click(await screen.findByRole('button', { name: '店頭のお客様を受け付ける' }))

  await screen.findByText('ウォークイン 3')
  expect(api).toHaveBeenCalledWith(
    `/api/staff/stores/${STORE_ID}/walkins`,
    expect.objectContaining({ method: 'POST', body: '{}' }),
  )
  const ledger = screen.getByRole('table', { name: '予約台帳' })
  expect(within(ledger).getByText('顧客未登録')).toBeInTheDocument()
  expect(within(ledger).getByText('お待ち')).toBeInTheDocument()
})

test('links a walk-in to an existing customer found by name (UC-EYEX-048, AC-EYEX-12, AC-EYEX-17)', async () => {
  const api = mockApi(
    () => json([walkin()]),
    () =>
      json([
        {
          id: CUSTOMER_ID,
          name: '田中 花子',
          kana: 'タナカ ハナコ',
          phone: '090-1234-5678',
          email: null,
          primaryStoreId: STORE_ID,
          visitCount: 4,
        },
      ]),
    () =>
      json({
        id: WALKIN_ID,
        entryType: 'walkin',
        provisionalLabel: 'ウォークイン 3',
        customerId: CUSTOMER_ID,
        progress: 'waiting',
        status: 'active',
        arrivedAt: '2026-08-27T02:30:00.000Z',
        version: 2,
      }),
    () => json([walkin({ customerId: CUSTOMER_ID, customerName: '田中 花子' })]),
  )
  renderLedger(api)

  fireEvent.click(await screen.findByRole('button', { name: /ウォークイン 3/ }))
  fireEvent.change(screen.getByLabelText('氏名で顧客を探す'), { target: { value: '田中' } })
  fireEvent.click(screen.getByRole('button', { name: '顧客を検索する' }))

  fireEvent.click(await screen.findByRole('button', { name: /田中 花子 · 090-1234-5678/ }))

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/api/staff/stores/${STORE_ID}/walkins/${WALKIN_ID}/customer`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ version: 1, customerId: CUSTOMER_ID }),
      }),
    ),
  )
  expect(api).toHaveBeenCalledWith(
    `/api/staff/stores/${STORE_ID}/customers?name=${encodeURIComponent('田中')}`,
  )
})

test('creates a new customer from the walk-in and links it (UC-EYEX-049, AC-EYEX-17)', async () => {
  const api = mockApi(
    () => json([walkin()]),
    () =>
      json({
        id: WALKIN_ID,
        entryType: 'walkin',
        provisionalLabel: 'ウォークイン 3',
        customerId: CUSTOMER_ID,
        progress: 'waiting',
        status: 'active',
        arrivedAt: '2026-08-27T02:30:00.000Z',
        version: 2,
      }),
    () => json([walkin({ customerId: CUSTOMER_ID, customerName: '新規 太郎' })]),
  )
  renderLedger(api)

  fireEvent.click(await screen.findByRole('button', { name: /ウォークイン 3/ }))
  fireEvent.change(screen.getByLabelText('お名前'), { target: { value: '新規 太郎' } })
  fireEvent.change(screen.getByLabelText('フリガナ'), { target: { value: 'シンキ タロウ' } })
  fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '090-0000-1111' } })
  fireEvent.click(screen.getByRole('button', { name: '新規顧客として登録して関連付ける' }))

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/api/staff/stores/${STORE_ID}/walkins/${WALKIN_ID}/customer`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          version: 1,
          customer: { name: '新規 太郎', kana: 'シンキ タロウ', phone: '090-0000-1111' },
        }),
      }),
    ),
  )
})

test('keeps a departed, still unlinked walk-in on the ledger (UC-EYEX-050, AC-EYEX-18)', async () => {
  const api = mockApi(
    () => json([walkin()]),
    () =>
      json({
        id: WALKIN_ID,
        entryType: 'walkin',
        provisionalLabel: 'ウォークイン 3',
        customerId: null,
        progress: 'departed',
        status: 'departed',
        arrivedAt: '2026-08-27T02:30:00.000Z',
        version: 2,
      }),
    () => json([walkin({ progress: 'departed', status: 'departed', version: 2 })]),
  )
  renderLedger(api)

  fireEvent.click(await screen.findByRole('button', { name: /ウォークイン 3/ }))
  fireEvent.click(screen.getByRole('button', { name: '退店として記録する' }))

  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/api/staff/stores/${STORE_ID}/walkins/${WALKIN_ID}/progress`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ version: 1, progress: 'departed' }),
      }),
    ),
  )
  const ledger = await screen.findByRole('table', { name: '予約台帳' })
  expect(within(ledger).getByText('ウォークイン 3')).toBeInTheDocument()
  expect(within(ledger).getByText('顧客未登録')).toBeInTheDocument()
  expect(within(ledger).getByText('退店')).toBeInTheDocument()
})

test('refuses a stale save and compares the latest content with this terminal’s input (UC-EYEX-172, UC-EYEX-173, AC-EYEX-110)', async () => {
  const api = mockApi(
    () => json([walkin()]),
    () => json({ error: 'version_conflict', currentVersion: 4 }, 409),
    () => json([walkin({ version: 4 })]),
    () =>
      json({
        id: WALKIN_ID,
        entryType: 'walkin',
        provisionalLabel: 'ウォークイン 3',
        customerId: null,
        progress: 'departed',
        status: 'departed',
        arrivedAt: '2026-08-27T02:30:00.000Z',
        version: 5,
      }),
    () => json([walkin({ progress: 'departed', status: 'departed', version: 5 })]),
  )
  renderLedger(api)

  fireEvent.click(await screen.findByRole('button', { name: /ウォークイン 3/ }))
  fireEvent.click(screen.getByRole('button', { name: '退店として記録する' }))

  const conflict = await screen.findByRole('region', { name: '別の端末で先に更新されています' })
  expect(within(conflict).getByText('最新の内容')).toBeInTheDocument()
  expect(within(conflict).getByText('この端末の入力')).toBeInTheDocument()
  expect(within(conflict).getByText(/版 4/)).toBeInTheDocument()

  fireEvent.click(within(conflict).getByRole('button', { name: '最新内容へ再適用' }))

  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith(`/api/staff/stores/${STORE_ID}/ledger?date=${DATE}`),
  )
  expect(api).toHaveBeenCalledWith(
    `/api/staff/stores/${STORE_ID}/walkins/${WALKIN_ID}/progress`,
    expect.objectContaining({ body: JSON.stringify({ version: 4, progress: 'departed' }) }),
  )
})

test('discarding a conflicted edit leaves the latest state on screen (UC-EYEX-173)', async () => {
  const api = mockApi(
    () => json([walkin()]),
    () => json({ error: 'version_conflict', currentVersion: 4 }, 409),
    () => json([walkin({ version: 4 })]),
  )
  renderLedger(api)

  fireEvent.click(await screen.findByRole('button', { name: /ウォークイン 3/ }))
  fireEvent.click(screen.getByRole('button', { name: '退店として記録する' }))
  fireEvent.click(await screen.findByRole('button', { name: 'この入力を破棄' }))

  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: '別の端末で先に更新されています' }),
    ).not.toBeInTheDocument(),
  )
})

test('reports a failed ledger load with a recovery instruction', async () => {
  const api = mockApi(() => new Response('', { status: 500 }))
  renderLedger(api)

  expect(await screen.findByRole('alert')).toHaveTextContent(
    '台帳を読み込めませんでした。通信を確認してもう一度お試しください。',
  )
})
