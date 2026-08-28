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
  const ledger = screen.getByRole('grid', { name: '予約台帳' })
  // 予約元は色ではなく文字で読める。セルはモックどおり「目的 · 予約元」の 1 行。
  expect(within(ledger).getByText('視力測定 · 電話')).toBeInTheDocument()
  expect(within(ledger).getByText('ウォークイン 3')).toBeInTheDocument()
  expect(within(ledger).getByRole('columnheader', { name: '10:00' })).toBeInTheDocument()
})

test('heads the time axis with the mock’s 30-minute columns (LEDGER-DAY)', async () => {
  const api = mockApi(() => json([reservation()]))
  renderLedger(api)

  const ledger = await screen.findByRole('grid', { name: '予約台帳' })
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

  const ledger = await screen.findByRole('grid', { name: '予約台帳' })
  expect(within(ledger).getByRole('rowheader', { name: '佐藤 美咲' })).toBeInTheDocument()
  expect(within(ledger).getByRole('rowheader', { name: 'ウォークイン' })).toBeInTheDocument()
  // A raw id is never shown to an operator.
  expect(within(ledger).queryByText(new RegExp(STAFF_ID.slice(0, 8)))).not.toBeInTheDocument()
})

test('draws the now line at the current JST time on today, clear of the time header (AC-EYEX-13)', async () => {
  const api = mockApi(() => json([reservation()]))
  renderLedger(api)

  await screen.findByText('田中 花子')
  /*
   * チップは「現在」(和文 sans) と時刻 (mono) の 2 ノードに分かれているので、
   * 文字列一致ではなく現在線そのものの textContent で見る。
   */
  const nowLine = document.querySelector('[data-now-line]')
  expect(nowLine?.textContent).toBe('現在 11:08')
  // 現在線は覆ってはいけない時刻見出しの外にある。
  expect(nowLine?.closest('[role="columnheader"]')).toBeNull()
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

  /*
   * 軸の切り替えはツールバーではなくレーン見出しのセル自身が担う（承認済みモック
   * には段が 1 つしかない）。ボタンは 1 個で、名前が現在の軸を名乗る。
   */
  const toggle = await screen.findByRole('button', { name: '担当者で見る（設備に切り替え）' })
  expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('rowheader', { name: '佐藤 美咲' })).toBeInTheDocument()

  fireEvent.click(toggle)

  expect(screen.getByRole('button', { name: '設備で見る（担当者に切り替え）' })).toBeInTheDocument()
  expect(screen.getByRole('rowheader', { name: '測定機A' })).toBeInTheDocument()
  expect(screen.queryByRole('rowheader', { name: '佐藤 美咲' })).not.toBeInTheDocument()
})

test('opens an entry detail beside the ledger without hiding it (UC-EYEX-046)', async () => {
  const api = mockApi(() => json([reservation()]))
  renderLedger(api)

  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))

  const detail = screen.getByRole('region', { name: '選択中の予約' })
  expect(within(detail).getByText('測定機Aへご案内')).toBeInTheDocument()
  expect(screen.getByRole('grid', { name: '予約台帳' })).toBeInTheDocument()
})

/*
 * 受付そのものは接客画面の主要動作へ移った（承認済みモック JOURNEY-DEFAULT）ので、
 * 台帳の責務は「受け付けた店頭客が未登録のまま並ぶ」ことに絞られる。工程はセルを
 * 2 行に保つため右パネルが受け持つ。
 */
test('shows a received walk-in with no customer record, waiting (UC-EYEX-047, AC-EYEX-11)', async () => {
  const api = mockApi(() => json([walkin()]))
  renderLedger(api)

  const ledger = await screen.findByRole('grid', { name: '予約台帳' })
  expect(within(ledger).getByText('ウォークイン 3')).toBeInTheDocument()
  expect(within(ledger).getByText('顧客未登録')).toBeInTheDocument()

  fireEvent.click(within(ledger).getByRole('button', { name: /ウォークイン 3/ }))

  expect(
    within(screen.getByRole('region', { name: '選択中の予約' })).getByText('お待ち'),
  ).toBeInTheDocument()
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
  const ledger = await screen.findByRole('grid', { name: '予約台帳' })
  expect(within(ledger).getByText('ウォークイン 3')).toBeInTheDocument()
  expect(within(ledger).getByText('顧客未登録')).toBeInTheDocument()
  // 退店したことは、セルではなく選択中の右パネルが名乗る。
  const detail = within(screen.getByRole('region', { name: '選択中の予約' }))
  expect(detail.getAllByText('退店').length).toBeGreaterThan(0)
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
  // 版番号ではなく、いま保存されている値そのものを並べる（AC-EYEX-110）。
  expect(within(conflict).queryByText(/版 4/)).not.toBeInTheDocument()

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

/*
 * 承認済みモック `#conflict` の「最新の内容」は、版番号ではなく **いま保存されて
 * いる値** と **誰がいつ更新したか** を並べる。版番号だけでは「何が違うのか」を
 * 読めないので、409 が運んでくる `latest` / `updatedBy` / `updatedAt`
 * （契約 `VersionConflict`）をそのまま出す。
 */
test('the conflict shows the stored values and who updated them, not a version number (AC-EYEX-110)', async () => {
  const api = mockApi(
    () => json([walkin()]),
    () =>
      json(
        {
          error: 'version_conflict',
          currentVersion: 4,
          latest: [
            { label: '状態', value: '接客中' },
            { label: 'お客様', value: '顧客未登録' },
          ],
          updatedBy: '銀座店 受付iPad',
          updatedAt: '2026-08-27T05:31:00.000Z',
        },
        409,
      ),
    () => json([walkin({ version: 4 })]),
  )
  renderLedger(api)

  fireEvent.click(await screen.findByRole('button', { name: /ウォークイン 3/ }))
  fireEvent.click(screen.getByRole('button', { name: '退店として記録する' }))

  const conflict = await screen.findByRole('region', { name: '別の端末で先に更新されています' })
  expect(within(conflict).getByText('状態 接客中')).toBeInTheDocument()
  expect(within(conflict).getByText('お客様 顧客未登録')).toBeInTheDocument()
  expect(within(conflict).getByText('更新者: 銀座店 受付iPad 14:31')).toBeInTheDocument()
  // 版番号は操作者の判断材料ではないので、面には出さない。
  expect(within(conflict).queryByText(/版 4/)).not.toBeInTheDocument()
})

/*
 * 版の衝突は、台帳の上に足す帯ではなく面そのものである。
 *
 * 承認済みモック（`exception-states-approved.html#conflict`）は、バーの下を
 * 見出し・2 枚の突き合わせ・2 つの操作だけにしている。後ろに台帳を残すと、
 * どちらの値が今の台帳なのかが読めないまま「破棄」か「再適用」かを選ばせる
 * ことになる。選び終わるまでは、選ぶための材料だけを出す。
 */
test('版の衝突が解けるまで、台帳は出さない', async () => {
  const api = mockApi(
    () => json([walkin()]),
    () => json({ error: 'version_conflict', currentVersion: 4 }, 409),
    () => json([walkin({ version: 4 })]),
  )
  renderLedger(api)

  fireEvent.click(await screen.findByRole('button', { name: /ウォークイン 3/ }))
  fireEvent.click(screen.getByRole('button', { name: '退店として記録する' }))
  await screen.findByRole('region', { name: '別の端末で先に更新されています' })
  expect(screen.queryByRole('grid', { name: '予約台帳' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'この入力を破棄' }))
  await waitFor(() => expect(screen.getByRole('grid', { name: '予約台帳' })).toBeInTheDocument())
})

/*
 * 予約元の語は、台帳も受付履歴も同じにする。台帳だけ `店頭・電話` と長い語で
 * 名乗ると、同じ予約が面によって違うものに見えるうえ、モックのセル
 * （`新調相談・電話`）より 3 文字長くなって目的の名を押し出す。
 */
test('予約元は受付履歴と同じ語で名乗る', async () => {
  renderLedger(mockApi(() => json([walkin()])))
  await screen.findByRole('grid', { name: '予約台帳' })
  expect(screen.queryByText(/店頭・電話/)).toBeNull()
})
