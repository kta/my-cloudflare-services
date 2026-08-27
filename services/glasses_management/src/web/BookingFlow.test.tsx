import type { AvailabilityStoreSettings } from '@app/contracts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useContext } from 'react'
import { expect, test, vi } from 'vitest'
import { BookingFlow } from './BookingFlow'
import { BookingCustomerStepContext } from './CustomerPanel'

const STORE_ID = '11111111-1111-4111-8111-111111111111'
const NEW_GLASSES = '0b4b58a5-0ea8-4ad8-8dc5-44f3db3f67d1'
const ADJUST = '22222222-2222-4222-8222-222222222222'
const STAFF_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_STAFF_ID = '77777777-7777-4777-8777-777777777777'
const TODAY = '2026-08-27' // Thursday
const NOW = '2026-08-27T01:00:00.000Z'
const SESSION_ID = '55555555-5555-4555-8555-555555555555'

const purpose = (
  id: string,
  customerLabel: string,
  staffName: string,
  durationMinutes: number,
) => ({
  id,
  staffName,
  customerLabel,
  durationMinutes,
  slotIntervalMinutes: 30,
  isPublic: true,
  requiredSkills: [] as string[],
  requiredEquipment: [] as string[],
  maxConcurrent: 1,
})

const settings = (
  overrides: Partial<AvailabilityStoreSettings> = {},
): AvailabilityStoreSettings => ({
  storeId: STORE_ID,
  version: 1,
  receptionStatus: 'open',
  desiredTimeCandidateCount: 6,
  businessHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    periods: dayOfWeek === 0 ? [] : [{ startTime: '10:00', endTime: '12:00' }],
  })),
  exceptions: [],
  purposes: [
    purpose(NEW_GLASSES, 'メガネを新しく作りたい', '視力測定・新調相談', 60),
    purpose(ADJUST, '今のメガネを調整したい', '調整', 20),
  ],
  staff: [],
  shifts: [],
  equipment: [],
  maintenance: [],
  ...overrides,
})

const slot = (startTime: string, endTime: string, date = TODAY) => ({
  date,
  startTime,
  endTime,
  startAt: `${date}T${startTime}:00.000Z`,
  endAt: `${date}T${endTime}:00.000Z`,
})

const slotsResponse = (slots: ReturnType<typeof slot>[]) => ({
  storeId: STORE_ID,
  date: TODAY,
  timezone: 'Asia/Tokyo' as const,
  durationMinutes: 60,
  intervalMinutes: 30,
  slots,
})

const reservation = () => ({
  id: '33333333-3333-4333-8333-333333333333',
  organizationId: 'org',
  storeId: STORE_ID,
  reservationNumber: 'R-0001',
  source: 'staff' as const,
  status: 'confirmed' as const,
  startAt: `${TODAY}T01:30:00.000Z`,
  endAt: `${TODAY}T02:30:00.000Z`,
  purposeIds: [NEW_GLASSES],
  customer: { name: '田中 花子', kana: 'タナカ ハナコ', phone: '090-1234-5678', email: null },
  recital: '復唱',
  reservationMemo: null,
  handoffNote: null,
  version: 1,
  createdAt: `${TODAY}T00:00:00.000Z`,
})

type Handlers = {
  settings?: AvailabilityStoreSettings
  slots?: () => Promise<Response> | Response
  create?: () => Promise<Response> | Response
  recording?: (url: string, init?: RequestInit) => Promise<Response> | Response
}

const RECORDING_ID = '44444444-4444-4444-8444-444444444444'

const recordingResponse = (state = 'stored') =>
  new Response(
    JSON.stringify({
      id: RECORDING_ID,
      organizationId: 'org',
      storeId: STORE_ID,
      receptionSessionId: SESSION_ID,
      reservationId: null,
      recorderType: 'personal',
      recorderId: 'unknown',
      startedAt: NOW,
      endedAt: NOW,
      durationSeconds: 0,
      endReason: 'completed',
      state,
      retentionUntil: null,
      holdReason: null,
      heldBy: null,
      heldAt: null,
      deletedAt: null,
      failureReason: null,
      version: 1,
    }),
    { status: 201 },
  )

function stubApi(handlers: Handlers = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.includes('/recordings'))
      return handlers.recording ? await handlers.recording(url, init) : recordingResponse()
    if (url.includes('/availability/settings'))
      return new Response(JSON.stringify(handlers.settings ?? settings()), { status: 200 })
    if (url.includes('/availability/slots'))
      return handlers.slots
        ? await handlers.slots()
        : new Response(JSON.stringify(slotsResponse([slot('10:30', '11:30')])), { status: 200 })
    if (url.includes('/reservations'))
      return handlers.create
        ? await handlers.create()
        : new Response(JSON.stringify(reservation()), { status: 201 })
    throw new Error(`unexpected request: ${url}`)
  })
  return { api, calls }
}

function renderFlow(handlers: Handlers = {}, extra: Record<string, unknown> = {}) {
  const { api, calls } = stubApi(handlers)
  const navigate = vi.fn()
  render(
    <BookingFlow
      storeId={STORE_ID}
      storeName="銀座店"
      api={api}
      navigate={navigate}
      today={TODAY}
      now={NOW}
      newRecordingSessionId={() => SESSION_ID}
      customerSlot={<CustomerSlotStub />}
      {...extra}
    />,
  )
  return { api, calls, navigate }
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

/*
 * お客様の特定は別部品（`CustomerPanel`）が受け持つので、ここでは context を
 * 読むだけの stub を挿す。モックどおり、この面には氏名やメモの欄は無い。
 */
const CANDIDATE = {
  id: '99999999-9999-4999-8999-999999999999',
  name: '田中 花子',
  kana: 'タナカ ハナコ',
  phone: '090-1234-5678',
  email: null,
  primaryStoreId: STORE_ID,
  visitCount: 4,
}

function CustomerSlotStub() {
  const step = useContext(BookingCustomerStepContext)
  if (!step) return null
  return (
    <div>
      {step.header}
      <button type="button" onClick={() => step.onConfirm(CANDIDATE, CANDIDATE.phone)}>
        田中 花子 様
      </button>
      <button type="button" onClick={() => step.onConfirm(undefined, '090-0000-0000')}>
        新しいお客様として登録する
      </button>
    </div>
  )
}

async function pickDayAndTime() {
  click('8月27日（木）')
  await screen.findByRole('heading', { name: 'ご来店予定の時刻を伺えますか？' })
  click('10:30')
  await screen.findByRole('heading', { name: '今回のご来店目的を伺えますか？' })
}

/** 候補を選ぶと 4 工程目の後半（氏名・メモの面）に入る。 */
async function pickCustomer() {
  await screen.findByRole('heading', { name: 'お電話番号を伺えますか？' })
  click('田中 花子 様')
  await screen.findByLabelText('お名前')
}

async function fillCustomer() {
  await pickCustomer()
  fireEvent.change(screen.getByLabelText('お名前'), { target: { value: '田中 花子' } })
  fireEvent.change(screen.getByLabelText('フリガナ'), { target: { value: 'タナカ ハナコ' } })
  fireEvent.change(screen.getByLabelText('お電話番号'), { target: { value: '090-1234-5678' } })
}

// AC-EYEX-01 / AC-EYEX-02 / UC-EYEX-009 / UC-EYEX-010
test('starts on the day step and shows the spoken question as the main heading', async () => {
  renderFlow()
  expect(await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })).toBeVisible()
  // モックの主列は工程ラベルと問いかけだけ。店舗名はアプリのヘッダーが持つ。
  expect(screen.getByText(/1 \/ 5\s*日/)).toBeVisible()
})

// UC-EYEX-012
test('offers today and later receivable days only, and never a closed day', async () => {
  renderFlow()
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  const days = within(screen.getByRole('group', { name: '来店予定日' })).getAllByRole('button')
  expect(days.at(0)).toHaveAccessibleName('8月27日（木）')
  expect(screen.queryByRole('button', { name: '8月26日（水）' })).not.toBeInTheDocument()
  // 2026-08-30 is a Sunday, and the store has no Sunday hours.
  expect(screen.queryByRole('button', { name: '8月30日（日）' })).not.toBeInTheDocument()
})

// AC-EYEX-01: the five-step indicator distinguishes done / current / upcoming by wording.
test('shows the five steps with position and wording, not colour alone', async () => {
  renderFlow()
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  const steps = within(screen.getByRole('list', { name: '予約入力の工程' })).getAllByRole(
    'listitem',
  )
  expect(steps).toHaveLength(5)
  // モックの下部バーは番号つきの枠ではなく、ラベルと下線だけを持つ。
  expect(steps.map((item) => item.textContent)).toEqual([
    '日（現在）',
    '時間（未完了）',
    '来店目的（未完了）',
    'お客様情報（未完了）',
    '復唱する（未完了）',
  ])

  await pickDayAndTime()
  const advanced = within(screen.getByRole('list', { name: '予約入力の工程' })).getAllByRole(
    'listitem',
  )
  expect(advanced.at(0)).toHaveTextContent('完了')
  expect(advanced.at(1)).toHaveTextContent('完了')
  expect(advanced.at(2)).toHaveTextContent('現在')
  expect(advanced.at(2)).toHaveAttribute('aria-current', 'step')
})

// UC-EYEX-015
test('takes several purposes and shows the combined duration', async () => {
  renderFlow()
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  await pickDayAndTime()
  click(/メガネを新しく作りたい/)
  click(/今のメガネを調整したい/)
  expect(screen.getByText('合計 約80分')).toBeVisible()
})

// UC-EYEX-009 / UC-EYEX-016 / UC-EYEX-020 / AC-EYEX-06 / AC-EYEX-07 / AC-EYEX-111
test('walks the five steps and sends the reservation with a recital, notes and an idempotency key', async () => {
  const { calls } = renderFlow({}, { newIdempotencyKey: () => 'key-1' })
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  await pickDayAndTime()
  click(/メガネを新しく作りたい/)
  click('お客様情報へ進む')

  await fillCustomer()
  fireEvent.change(screen.getByLabelText('予約メモ'), { target: { value: 'PC作業用' } })
  fireEvent.change(screen.getByLabelText('店内引き継ぎ事項'), { target: { value: '担当は佐藤' } })
  click('復唱へ進む')

  await screen.findByRole('heading', { name: '次の内容を、お客様へそのままお伝えください' })
  expect(
    screen.getByText(
      '「8月27日、木曜日の午前10時30分に、EYEX予約 銀座店で、視力測定・新調相談を承りました。所要時間は約60分です。田中 花子様、お電話番号は090-1234-5678でお間違いないでしょうか？」',
    ),
  ).toBeVisible()

  click('復唱を終えて予約を確定する')
  await screen.findByText('R-0001')

  const create = calls.find((entry) => entry.init?.method === 'POST')
  expect(create).toBeDefined()
  expect(new Headers(create?.init?.headers).get('idempotency-key')).toBe('key-1')
  expect(JSON.parse(String(create?.init?.body))).toMatchObject({
    date: TODAY,
    startTime: '10:30',
    purposeIds: [NEW_GLASSES],
    customer: { name: '田中 花子', kana: 'タナカ ハナコ', phone: '090-1234-5678' },
    reservationMemo: 'PC作業用',
    handoffNote: '担当は佐藤',
  })
  expect(String(JSON.parse(String(create?.init?.body)).recital)).toContain('090-1234-5678')
})

/*
 * 復唱の脇の列は「確保する接客資源」。来店目的の再掲ではなく、この予約が押さえる
 * 担当者と設備を出す（承認済みモック BOOK-REPEAT）。
 */
test('lists the staff and equipment this booking holds, not the purposes again', async () => {
  renderFlow({
    settings: settings({
      staff: [
        { id: STAFF_ID, name: '佐藤 美咲', skills: ['refraction'], canBook: true, isActive: true },
        { id: OTHER_STAFF_ID, name: '高橋 健', skills: [], canBook: true, isActive: true },
      ],
      purposes: [
        {
          ...purpose(NEW_GLASSES, 'メガネを新しく作りたい', '視力測定・新調相談', 60),
          requiredSkills: ['refraction'],
          requiredEquipment: ['視力測定機 A'],
        },
        purpose(ADJUST, '今のメガネを調整したい', '調整', 20),
      ],
    }),
  })
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  await pickDayAndTime()
  click(/メガネを新しく作りたい/)
  click('お客様情報へ進む')
  await fillCustomer()
  click('復唱へ進む')

  const rail = await screen.findByRole('complementary', { name: '確保する接客資源' })
  expect(within(rail).getByText('佐藤 美咲')).toBeVisible()
  expect(within(rail).getByText('視力測定機 A')).toBeVisible()
  expect(within(rail).getByText('所要時間 約60分')).toBeVisible()
  // 目的の再掲は資源ではない。
  expect(within(rail).queryByText('視力測定・新調相談')).toBeNull()
  expect(within(rail).queryByText('高橋 健')).toBeNull()
})

// UC-EYEX-011
test('keeps everything entered when the staff member walks back', async () => {
  renderFlow()
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  await pickDayAndTime()
  click(/メガネを新しく作りたい/)
  click('お客様情報へ進む')
  await fillCustomer()

  // 4 工程目は「特定」と「氏名・メモ」の二面。戻るはまず特定の面へ返る。
  click('戻る')
  await screen.findByRole('button', { name: '田中 花子 様' })
  click('戻る')
  await screen.findByRole('heading', { name: '今回のご来店目的を伺えますか？' })
  expect(screen.getByRole('button', { name: /メガネを新しく作りたい/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  click('戻る')
  await screen.findByRole('heading', { name: 'ご来店予定の時刻を伺えますか？' })
  expect(screen.getByRole('button', { name: '10:30' })).toHaveAttribute('aria-pressed', 'true')

  click('10:30')
  await screen.findByRole('heading', { name: '今回のご来店目的を伺えますか？' })
  click('お客様情報へ進む')
  await pickCustomer()
  expect(screen.getByLabelText('お名前')).toHaveValue('田中 花子')
})

// UC-EYEX-013 / UC-EYEX-014 / UC-EYEX-019 / AC-EYEX-88
test('re-validates after the purposes and offers same-store alternatives without losing input', async () => {
  renderFlow({
    slots: () =>
      new Response(
        JSON.stringify(slotsResponse([slot('10:00', '11:00'), slot('11:00', '12:00')])),
        { status: 200 },
      ),
  })
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  await pickDayAndTime()
  click(/メガネを新しく作りたい/)
  click('お客様情報へ進む')

  expect(await screen.findByText('10:30は60分の受付ができません')).toBeVisible()
  expect(screen.getByText(/入力内容は保持しています/)).toBeVisible()
  expect(screen.getByRole('heading', { name: '今回のご来店目的を伺えますか？' })).toBeVisible()
  const alternatives = within(screen.getByRole('group', { name: '代替時刻' }))
  expect(alternatives.getAllByRole('button').map((button) => button.textContent)).toEqual([
    '10:00　受付可能',
    '11:00　受付可能',
  ])

  fireEvent.click(alternatives.getByRole('button', { name: /11:00/ }))
  await waitFor(() =>
    expect(screen.queryByText('10:30は60分の受付ができません')).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('button', { name: /メガネを新しく作りたい/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

// AC-EYEX-08
test('keeps every input and offers alternatives when the slot is lost at confirmation time', async () => {
  let slotCall = 0
  renderFlow({
    slots: () => {
      slotCall += 1
      return new Response(
        JSON.stringify(
          slotCall === 1
            ? slotsResponse([slot('10:30', '11:30')])
            : slotsResponse([slot('11:00', '12:00')]),
        ),
        { status: 200 },
      )
    },
    create: () => new Response(JSON.stringify({ error: 'slot_unavailable' }), { status: 409 }),
  })
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  await pickDayAndTime()
  click(/メガネを新しく作りたい/)
  click('お客様情報へ進む')
  await fillCustomer()
  click('復唱へ進む')
  await screen.findByRole('heading', { name: '次の内容を、お客様へそのままお伝えください' })
  click('復唱を終えて予約を確定する')

  await screen.findByRole('heading', { name: '今回のご来店目的を伺えますか？' })
  expect(screen.getByText('10:30は60分の受付ができません')).toBeVisible()
  const alternatives = within(screen.getByRole('group', { name: '代替時刻' }))
  expect(alternatives.getAllByRole('button').map((button) => button.textContent)).toEqual([
    '11:00　受付可能',
  ])

  fireEvent.click(alternatives.getByRole('button', { name: /11:00/ }))
  click('お客様情報へ進む')
  await pickCustomer()
  expect(screen.getByLabelText('お名前')).toHaveValue('田中 花子')
})

// UC-EYEX-018 / UC-EYEX-174 / AC-EYEX-111
test('keeps the input on a transient network failure and resends with the same key', async () => {
  let attempt = 0
  const { calls } = renderFlow(
    {
      create: () => {
        attempt += 1
        if (attempt === 1) throw new TypeError('Failed to fetch')
        return new Response(JSON.stringify(reservation()), { status: 201 })
      },
    },
    { newIdempotencyKey: vi.fn().mockReturnValueOnce('key-1').mockReturnValue('key-2') },
  )
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  await pickDayAndTime()
  click(/メガネを新しく作りたい/)
  click('お客様情報へ進む')
  await fillCustomer()
  click('復唱へ進む')
  await screen.findByRole('heading', { name: '次の内容を、お客様へそのままお伝えください' })
  click('復唱を終えて予約を確定する')

  expect(
    await screen.findByText(
      '送信できませんでした。入力内容はそのまま残っています。もう一度お試しください。',
    ),
  ).toBeVisible()
  expect(screen.getByText(/田中 花子様/)).toBeVisible()

  click('復唱を終えて予約を確定する')
  await screen.findByText('R-0001')
  const keys = calls
    .filter((entry) => entry.init?.method === 'POST')
    .map((entry) => new Headers(entry.init?.headers).get('idempotency-key'))
  expect(keys).toEqual(['key-1', 'key-1'])
})

// UC-EYEX-017
test('asks before discarding the input and keeps it when the staff member cancels', async () => {
  renderFlow()
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  await pickDayAndTime()
  // モックの下部バーは 戻る しか持たない。最初の工程から更に戻ることが
  // 「受付をやめる」であり、そこで必ず一度尋ねる。
  expect(screen.queryByRole('button', { name: '入力を破棄する' })).toBeNull()
  click('戻る')
  await screen.findByRole('heading', { name: 'ご来店予定の時刻を伺えますか？' })
  click('戻る')
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  click('戻る')

  const confirm = await screen.findByRole('alertdialog', { name: '入力を破棄しますか？' })
  fireEvent.click(within(confirm).getByRole('button', { name: '入力に戻る' }))
  expect(screen.getByRole('button', { name: '8月27日（木）' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  click('戻る')
  fireEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: '破棄する' }),
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '8月27日（木）' })).toHaveAttribute(
      'aria-pressed',
      'false',
    ),
  )
})

// UC-EYEX-009: customer identification is a separate component, rendered in the customer step.
test('renders the injected customer identification slot on the customer step', async () => {
  renderFlow({}, { customerSlot: <p>顧客候補プレースホルダ</p> })
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  await pickDayAndTime()
  click(/メガネを新しく作りたい/)
  click('お客様情報へ進む')
  expect(await screen.findByText('顧客候補プレースホルダ')).toBeVisible()
})

// Quality floor: the settings request can fail, and the screen has to say so.
test('reports a failure to load the store settings', async () => {
  const api = vi.fn(async () => new Response('{}', { status: 500 }))
  render(
    <BookingFlow
      storeId={STORE_ID}
      storeName="銀座店"
      api={api}
      navigate={vi.fn()}
      today={TODAY}
    />,
  )
  expect(
    await screen.findByText(
      '受付設定を読み込めませんでした。通信を確認してもう一度お試しください。',
    ),
  ).toBeVisible()
})

test('tells the workspace when the draft holds work a store switch would destroy', async () => {
  // The store-switch controller can only offer the discard confirmation if
  // something reports the unsaved input to it (UC-EYEX-065, AC-EYEX-29).
  const onUnsavedInputChange = vi.fn()
  renderFlow({}, { onUnsavedInputChange })

  await screen.findByRole('button', { name: '8月27日（木）' })
  expect(onUnsavedInputChange).toHaveBeenLastCalledWith(false)

  click('8月27日（木）')

  await waitFor(() => expect(onUnsavedInputChange).toHaveBeenLastCalledWith(true))
})

/*
 * 録音の配線 (UC-EYEX-031 / 033 / 034 / 041 / 177)。
 *
 * モックでは、権限の説明と拒否は「全画面の状態」であり、録音中の表示は下部
 * 進捗バーの右端の `● mm:ss` だけである。脇の列に録音カードは無い。
 */
const RECORDING_PERMISSIONS = ['recording.read'] as const

function renderRecordingFlow(
  handlers: Handlers = {},
  extra: Record<string, unknown> = {},
  permission: 'granted' | 'denied' = 'granted',
) {
  const requestMicrophonePermission = vi.fn(async () => permission)
  const result = renderFlow(handlers, {
    permissions: [...RECORDING_PERMISSIONS],
    requestMicrophonePermission,
    clock: () => NOW,
    ...extra,
  })
  return { ...result, requestMicrophonePermission }
}

/** 権限説明の全画面を通り抜けて、1 工程目に立つ。 */
async function grantMicrophone() {
  // 許可は入力の裏で自動的に求めるので、待つのは入力の先頭が出ることだけ。
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  await waitFor(() => {
    expect(screen.getByTestId('recording-state')).toHaveTextContent('録音中')
  })
}

// AC-EYEX-05: 録音は入力列を取らず、下部バーの右端にだけ出る
test('録音状態は下部の進捗バーの右端に出る', async () => {
  renderRecordingFlow()
  await grantMicrophone()
  const status = screen.getByRole('status', { name: 'iPad録音' })
  expect(status.closest('footer')).not.toBeNull()
  expect(
    within(status.closest('footer') as HTMLElement).getByRole('list', { name: '予約入力の工程' }),
  ).toBeVisible()
  expect(screen.queryByRole('region', { name: 'iPad録音' })).toBeNull()
})

// BOOK-MIC-PERMISSION: 録音の確認で受付を止めない
test('録音の許可は入力を止めずに裏で求める', async () => {
  renderRecordingFlow()
  expect(await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: '予約内容の復唱を記録します' })).toBeNull()
})

// UC-EYEX-033 / AC-EYEX-113: navigator には触れず、注入された権限要求だけを使う
test('マイク権限は注入された関数だけで要求し、許可されると録音中になる', async () => {
  const { requestMicrophonePermission } = renderRecordingFlow()
  await grantMicrophone()
  await waitFor(() => {
    expect(screen.getByTestId('recording-state')).toHaveTextContent('録音中')
  })
  expect(requestMicrophonePermission).toHaveBeenCalledTimes(1)
})

// UC-EYEX-177 / EX-MIC-DENIED: 拒否されても録音状態は権限確認のまま
test('権限が拒否されても入力は進み、録音状態は進めない', async () => {
  renderRecordingFlow({}, {}, 'denied')
  expect(await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })).toBeVisible()
  await waitFor(() => {
    expect(screen.getByTestId('recording-state')).toHaveTextContent('録音なし')
  })
})

// UC-EYEX-177: 録音できないときも下部バーは 録音なし のまま入力を続けられる
test('録音なしのまま復唱まで進める', async () => {
  renderRecordingFlow({}, {}, 'denied')
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  expect(screen.getByTestId('recording-state')).toHaveTextContent('録音なし')
  await pickDayAndTime()
  click(/メガネを新しく作りたい/)
  expect(screen.getByRole('button', { name: 'お客様情報へ進む' })).toBeEnabled()
})

// EX-MIC-DENIED: 破棄は通常どおり入力画面から行える
test('権限拒否でも入力画面から予約入力を破棄できる', async () => {
  renderRecordingFlow({}, {}, 'denied')
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  click('戻る')
  expect(await screen.findByRole('alertdialog', { name: '入力を破棄しますか？' })).toBeVisible()
})

async function walkToConfirmation() {
  await grantMicrophone()
  await waitFor(() => {
    expect(screen.getByTestId('recording-state')).toHaveTextContent('録音中')
  })
  await pickDayAndTime()
  click(/メガネを新しく作りたい/)
  click('お客様情報へ進む')
  await fillCustomer()
  click('復唱へ進む')
  await screen.findByRole('heading', { name: '次の内容を、お客様へそのままお伝えください' })
  click('復唱を終えて予約を確定する')
}

// UC-EYEX-041 / AC-EYEX-07: 予約成立と録音保存状態を同時に、別々に読める
test('予約確定後も録音状態は下部バーに残り、予約成立と別々に読める', async () => {
  const { calls } = renderRecordingFlow()
  await walkToConfirmation()

  expect(await screen.findByText('予約を確定しました')).toBeVisible()
  await waitFor(() => {
    expect(screen.getByTestId('recording-state')).toHaveTextContent('保存済み')
  })

  const posted = calls.find((call) => call.url.endsWith('/recordings'))
  const body = JSON.parse(String(posted?.init?.body)) as Record<string, unknown>
  expect(body.receptionSessionId).toBe(SESSION_ID)
  expect(body.reservationId).toBe('33333333-3333-4333-8333-333333333333')
  expect(body.endReason).toBe('completed')
})

// AC-EYEX-89: 破棄した受付の録音は受付セッションIDと終了理由を持ち、予約IDを持たない
test('受付を破棄した録音は受付セッションIDと終了理由だけを持つ', async () => {
  const { calls } = renderRecordingFlow()
  await grantMicrophone()
  await waitFor(() => {
    expect(screen.getByTestId('recording-state')).toHaveTextContent('録音中')
  })
  click('8月27日（木）')
  await screen.findByRole('heading', { name: 'ご来店予定の時刻を伺えますか？' })
  click('戻る')
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  click('戻る')
  click('破棄する')

  await waitFor(() => {
    expect(calls.some((call) => call.url.endsWith('/recordings'))).toBe(true)
  })
  const posted = calls.find((call) => call.url.endsWith('/recordings'))
  const body = JSON.parse(String(posted?.init?.body)) as Record<string, unknown>
  expect(body.reservationId).toBeNull()
  expect(body.receptionSessionId).toBe(SESSION_ID)
  expect(body.endReason).toBe('discarded')
})

// UC-EYEX-034 / EX-UPLOAD-FAILED: 保存失敗は全画面で、予約の成立を先に伝える
test('録音の保存に失敗したら予約は成立しましたと再試行を全画面で出す', async () => {
  const { calls } = renderRecordingFlow({
    recording: (url) => {
      if (url.endsWith('/retry')) return recordingResponse('stored')
      return new Response('{}', { status: 503 })
    },
  })
  await walkToConfirmation()

  expect(await screen.findByRole('heading', { name: '予約は成立しました' })).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('録音を保存できていません')

  click('今すぐ再試行')
  await waitFor(() => {
    expect(calls.some((call) => call.url.endsWith('/recordings'))).toBe(true)
  })
})

// AC-EYEX-115: 許されない遷移はクライアントから送らない
test('録音を開始していなければ確定しても録音メタデータを送らない', async () => {
  const { calls } = renderRecordingFlow({}, {}, 'denied')
  await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' })
  await pickDayAndTime()
  click(/メガネを新しく作りたい/)
  click('お客様情報へ進む')
  await fillCustomer()
  click('復唱へ進む')
  await screen.findByRole('heading', { name: '次の内容を、お客様へそのままお伝えください' })
  click('復唱を終えて予約を確定する')

  expect(await screen.findByText('予約を確定しました')).toBeVisible()
  expect(calls.some((call) => call.url.endsWith('/recordings'))).toBe(false)
})

test('予約入力は録音の確認画面で塞がれず、最初の工程から始まる', async () => {
  // 電話を受けた直後に開く画面なので、録音の可否を先に問う全画面が挟まると
  // 受付そのものが止まる。録音状態は下部バーの表示だけで足りる。
  renderFlow({}, { permissions: ['reservation.write', 'recording.read'] })

  expect(
    await screen.findByRole('heading', { name: 'ご来店予定の日を伺えますか？' }),
  ).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /予約内容の復唱を記録します/ })).toBeNull()
  expect(screen.queryByRole('button', { name: '録音を開始する' })).toBeNull()
})
