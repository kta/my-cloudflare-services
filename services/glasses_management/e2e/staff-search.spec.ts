import { expect, type Page, type Route, test } from '@playwright/test'

/**
 * Staff reservation search / change / cancellation and same-day reception
 * history, driven through the real SPA with the staff API stubbed at the
 * network boundary.
 */

const STORE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_STORE_ID = '22222222-2222-4222-8222-222222222222'
const PURPOSE_ID = '33333333-3333-4333-8333-333333333333'
const TANAKA_ID = '44444444-4444-4444-8444-444444444444'
const IPAD = { width: 1180, height: 820 }

const stores = [
  {
    id: STORE_ID,
    organizationId: 'org-1',
    name: '銀座店',
    slug: 'ginza',
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: OTHER_STORE_ID,
    organizationId: 'org-1',
    name: '丸の内店',
    slug: 'marunouchi',
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
]

const tanaka = {
  id: TANAKA_ID,
  organizationId: 'org-1',
  storeId: STORE_ID,
  reservationNumber: 'EY-0827-1100',
  source: 'staff' as const,
  status: 'confirmed' as const,
  // 2026-08-27 11:00 JST
  startAt: '2026-08-27T02:00:00.000Z',
  endAt: '2026-08-27T03:00:00.000Z',
  purposeIds: [PURPOSE_ID],
  customer: {
    name: '田中 花子',
    kana: 'タナカ ハナコ',
    phone: '090-1234-5678',
    email: null,
  },
  recital: '8月27日11時にご来店ください。',
  reservationMemo: null,
  handoffNote: null,
  version: 3,
  createdAt: '2026-08-20T01:00:00.000Z',
}

function slotsPayload(times: { startTime: string; endTime: string; startAt: string }[]) {
  return {
    storeId: STORE_ID,
    date: '2026-08-28',
    timezone: 'Asia/Tokyo' as const,
    durationMinutes: 60,
    intervalMinutes: 30,
    slots: times.map((slot) => ({
      date: '2026-08-28',
      startTime: slot.startTime,
      endTime: slot.endTime,
      startAt: slot.startAt,
      endAt: slot.startAt,
    })),
  }
}

const morningSlot = {
  startTime: '10:00',
  endTime: '11:00',
  startAt: '2026-08-28T01:00:00.000Z',
}
const afternoonSlot = {
  startTime: '14:00',
  endTime: '15:00',
  startAt: '2026-08-28T05:00:00.000Z',
}

const historyEvents = {
  walkin: {
    id: '55555555-5555-4555-8555-000000000101',
    occurredAt: '2026-08-27T05:26:00.000Z', // 14:26 JST
    source: 'walkin' as const,
    action: 'walkin_created' as const,
    entityType: 'walkin' as const,
    entityId: '55555555-5555-4555-8555-000000000901',
    reservationId: null,
    customerName: null,
    customerPhone: null,
    reservationNumber: null,
    actorId: '山田',
    requiresAttention: false,
    recordingStatus: 'none' as const,
  },
  phoneBooking: {
    id: '55555555-5555-4555-8555-000000000102',
    occurredAt: '2026-08-27T05:18:00.000Z', // 14:18 JST
    source: 'staff' as const,
    action: 'created' as const,
    entityType: 'reservation' as const,
    entityId: '55555555-5555-4555-8555-000000000902',
    reservationId: '55555555-5555-4555-8555-000000000902',
    customerName: '田中 花子',
    customerPhone: '090-1234-5678',
    reservationNumber: 'EY-0828-1142',
    actorId: '鈴木',
    requiresAttention: true,
    recordingStatus: 'none' as const,
  },
  webBooking: {
    id: '55555555-5555-4555-8555-000000000103',
    occurredAt: '2026-08-27T04:54:00.000Z', // 13:54 JST
    source: 'web' as const,
    action: 'created' as const,
    entityType: 'reservation' as const,
    entityId: '55555555-5555-4555-8555-000000000903',
    reservationId: '55555555-5555-4555-8555-000000000903',
    customerName: '伊藤 健',
    customerPhone: '090-2222-3333',
    reservationNumber: 'EY-0829-1330',
    actorId: 'web',
    requiresAttention: false,
    recordingStatus: 'none' as const,
  },
  changed: {
    id: '55555555-5555-4555-8555-000000000104',
    occurredAt: '2026-08-27T04:32:00.000Z', // 13:32 JST
    source: 'staff' as const,
    action: 'changed' as const,
    entityType: 'reservation' as const,
    entityId: '55555555-5555-4555-8555-000000000904',
    reservationId: '55555555-5555-4555-8555-000000000904',
    customerName: '松本 一郎',
    customerPhone: '090-4444-5555',
    reservationNumber: 'EY-0827-1500',
    actorId: '山田',
    requiresAttention: false,
    recordingStatus: 'none' as const,
  },
  cancelled: {
    id: '55555555-5555-4555-8555-000000000105',
    occurredAt: '2026-08-27T04:00:00.000Z', // 13:00 JST
    source: 'staff' as const,
    action: 'cancelled' as const,
    entityType: 'reservation' as const,
    entityId: '55555555-5555-4555-8555-000000000905',
    reservationId: '55555555-5555-4555-8555-000000000905',
    customerName: '佐藤 実',
    customerPhone: '090-6666-7777',
    reservationNumber: 'EY-0827-1600',
    actorId: '鈴木',
    requiresAttention: false,
    recordingStatus: 'none' as const,
  },
}

type StaffRoute = { url: URL; route: Route; method: string }

/**
 * Sign the workspace in and route every staff API call through `handle`.
 * Requests the scenario does not care about get a benign empty payload so an
 * unrelated screen can never fail the assertion under test.
 */
async function signIn(page: Page, handle: (call: StaffRoute) => Promise<unknown> | unknown) {
  await page.setViewportSize(IPAD)
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname === '/api/auth/refresh') return route.fulfill({ json: { token: 'e2e-token' } })
    if (url.pathname === '/api/staff/stores') return route.fulfill({ json: stores })
    // Handlers return `false` to decline; anything else means they answered.
    if ((await handle({ url, route, method })) !== false) return undefined
    return route.fulfill({ json: [] })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
}

function isSearch(call: StaffRoute): boolean {
  return call.url.pathname === `/api/staff/stores/${STORE_ID}/reservations`
}

async function openSearchAndSelectTanaka(page: Page) {
  await page.getByRole('button', { name: '予約を検索', exact: true }).click()
  await expect(page.getByRole('heading', { name: '予約を検索する' })).toBeVisible()
  await page.getByLabel('氏名・電話番号・予約番号').fill('田中 花子')
  await page.getByRole('button', { name: '検索する' }).click()
  await page.getByRole('button', { name: /田中 花子 様/ }).click()
  await expect(page.getByRole('region', { name: '予約詳細' })).toBeVisible()
}

// @e2e-covers UC-EYEX-055 UC-EYEX-056 UC-EYEX-057 AC-EYEX-14 AC-EYEX-90
test('searches the selected store by normalised term and shows list and detail together', async ({
  page,
}) => {
  const searched: string[] = []
  await signIn(page, async (call) => {
    if (isSearch(call)) {
      searched.push(call.url.search)
      return call.route.fulfill({ json: [tanaka] })
    }
    return false
  })

  await page.getByRole('button', { name: '予約を検索', exact: true }).click()
  await expect(page.getByRole('heading', { name: '予約を検索する' })).toBeVisible()

  // AC-EYEX-90: the store is fixed to the selected store. The search form has
  // exactly the 予約元 / 状態 selects, no store control and no 全店舗 option.
  await expect(page.getByText('銀座店 · 検索対象店舗')).toBeVisible()
  await expect(page.getByRole('combobox')).toHaveCount(2)
  await expect(page.getByRole('combobox').nth(0)).toHaveAccessibleName('予約元')
  await expect(page.getByRole('combobox').nth(1)).toHaveAccessibleName('状態')
  await expect(page.getByText('全店舗')).toHaveCount(0)
  await expect(page.getByLabel('店舗', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /丸の内店/ })).toHaveCount(0)

  // AC-EYEX-14: a formatted phone number is normalised into the contract field.
  await page.getByLabel('氏名・電話番号・予約番号').fill('０９０-１２３４ ５６７８')
  await page.getByRole('button', { name: '検索する' }).click()
  await expect(page.getByRole('button', { name: /田中 花子 様/ })).toBeVisible()
  expect(searched.at(-1)).toContain('phone=09012345678')
  expect(searched.at(-1)).not.toContain('storeId=')
  expect(searched.at(-1)).not.toContain('store=')

  // UC-EYEX-055: the same single box also carries a name.
  await page.getByLabel('氏名・電話番号・予約番号').fill('田中 花子')
  await page.getByRole('button', { name: '検索する' }).click()
  await expect.poll(() => new URLSearchParams(searched.at(-1) ?? '').get('name')).toBe('田中 花子')

  // UC-EYEX-057: picking a candidate keeps the result list beside the detail.
  await page.getByRole('button', { name: /田中 花子 様/ }).click()
  const detail = page.getByRole('region', { name: '予約詳細' })
  await expect(detail.getByText('EY-0827-1100')).toBeVisible()
  await expect(detail.getByText('2026年8月27日 11:00')).toBeVisible()
  await expect(detail.getByText('銀座店')).toBeVisible()
  await expect(
    page.getByRole('region', { name: '検索結果' }).getByRole('button', { name: /田中 花子 様/ }),
  ).toBeVisible()
})

// @e2e-covers UC-EYEX-058 UC-EYEX-059 AC-EYEX-22
test('keeps the original reservation while the destination slot is searched and lost', async ({
  page,
}) => {
  let slotCalls = 0
  let patchCalls = 0
  const patched: unknown[] = []
  const moved = {
    ...tanaka,
    // 2026-08-28 14:00 JST
    startAt: '2026-08-28T05:00:00.000Z',
    endAt: '2026-08-28T06:00:00.000Z',
    version: 4,
  }
  await signIn(page, async (call) => {
    if (isSearch(call)) return call.route.fulfill({ json: [tanaka] })
    if (call.url.pathname.endsWith('/availability/slots')) {
      slotCalls += 1
      // The first search offers both; after the conflict only the survivor is
      // still free, which is the alternative the screen must offer.
      return call.route.fulfill({
        json: slotsPayload(slotCalls === 1 ? [morningSlot, afternoonSlot] : [afternoonSlot]),
      })
    }
    if (call.method === 'PATCH' && call.url.pathname.endsWith(`/reservations/${TANAKA_ID}`)) {
      patchCalls += 1
      patched.push(call.route.request().postDataJSON())
      if (patchCalls === 1)
        return call.route.fulfill({ status: 409, json: { error: 'slot_unavailable' } })
      return call.route.fulfill({ json: moved })
    }
    return false
  })

  await openSearchAndSelectTanaka(page)
  await page.getByRole('button', { name: '日時・内容を変更する' }).click()

  // UC-EYEX-058: the original reservation is untouched while slots are browsed.
  await page.getByLabel('変更先の日').fill('2026-08-28')
  await page.getByRole('button', { name: '空き枠を探す' }).click()
  await expect(page.getByRole('button', { name: '10:00〜11:00' })).toBeVisible()
  const detail = page.getByRole('region', { name: '予約詳細' })
  await expect(detail.getByText('2026年8月27日 11:00')).toBeVisible()
  await expect(detail.getByText('予約済み')).toBeVisible()

  // UC-EYEX-059: the switch is attempted only after a destination is chosen.
  await expect(page.getByRole('button', { name: 'この枠に切り替える' })).toBeDisabled()
  await page.getByRole('button', { name: '10:00〜11:00' }).click()
  await page.getByLabel('変更理由').fill('お客様都合で翌日へ')
  await page.getByRole('button', { name: 'この枠に切り替える' }).click()

  // AC-EYEX-22: the conflict aborts the change, keeps the original and offers
  // the remaining alternative.
  await expect(
    page.getByText('選択した枠を確保できませんでした。元の予約はそのままです。'),
  ).toBeVisible()
  await expect(detail.getByText('2026年8月27日 11:00')).toBeVisible()
  await expect(detail.getByText('予約済み')).toBeVisible()
  await expect(page.getByRole('button', { name: '10:00〜11:00' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '14:00〜15:00' })).toBeVisible()

  await page.getByRole('button', { name: '14:00〜15:00' }).click()
  await page.getByRole('button', { name: 'この枠に切り替える' }).click()
  await expect(detail.getByText('2026年8月28日 14:00')).toBeVisible()
  expect(patched).toHaveLength(2)
  expect(patched[1]).toMatchObject({ version: 3, date: '2026-08-28', startTime: '14:00' })
})

// @e2e-covers UC-EYEX-060 UC-EYEX-061 AC-EYEX-23
test('demands a reason and a deliberate confirmation before cancelling, then records the audit', async ({
  page,
}) => {
  let cancelled = false
  let cancelBody: unknown
  const cancelledReservation = { ...tanaka, status: 'cancelled' as const, version: 4 }
  const auditEntry = {
    id: '66666666-6666-4666-8666-000000000001',
    reservationId: TANAKA_ID,
    action: 'cancelled' as const,
    reason: '体調不良のため',
    before: {
      status: 'confirmed' as const,
      startAt: tanaka.startAt,
      endAt: tanaka.endAt,
      purposeIds: tanaka.purposeIds,
      version: 3,
    },
    after: {
      status: 'cancelled' as const,
      startAt: tanaka.startAt,
      endAt: tanaka.endAt,
      purposeIds: tanaka.purposeIds,
      version: 4,
    },
    actorId: '鈴木',
    occurredAt: '2026-08-27T01:30:00.000Z', // 10:30 JST
  }
  await signIn(page, async (call) => {
    if (isSearch(call)) return call.route.fulfill({ json: [tanaka] })
    if (call.url.pathname.endsWith('/history'))
      return call.route.fulfill({ json: cancelled ? [auditEntry] : [] })
    if (call.method === 'POST' && call.url.pathname.endsWith('/cancel')) {
      cancelBody = call.route.request().postDataJSON()
      cancelled = true
      return call.route.fulfill({ json: cancelledReservation })
    }
    return false
  })

  await openSearchAndSelectTanaka(page)
  await expect(page.getByRole('region', { name: '変更履歴' })).toContainText(
    '変更履歴はありません。',
  )
  await page.getByRole('button', { name: '予約を取り消す' }).click()

  // AC-EYEX-23: a reason is mandatory.
  await page.getByRole('button', { name: '取消を実行する' }).click()
  await expect(page.getByText('取消理由を入力してください。')).toBeVisible()

  // AC-EYEX-23: and so is the deliberate confirmation.
  await page.getByLabel('取消理由').fill('体調不良のため')
  await page.getByRole('button', { name: '取消を実行する' }).click()
  await expect(
    page.getByText('確認のため「取消」と入力してください。', { exact: true }),
  ).toBeVisible()
  await page.getByLabel('確認入力').fill('とりけし')
  await page.getByRole('button', { name: '取消を実行する' }).click()
  await expect(
    page.getByText('確認のため「取消」と入力してください。', { exact: true }),
  ).toBeVisible()

  await page.getByLabel('確認入力').fill('取消')
  await page.getByRole('button', { name: '取消を実行する' }).click()

  // UC-EYEX-060: the reservation is cancelled with reason and confirmation.
  const detail = page.getByRole('region', { name: '予約詳細' })
  await expect(detail.getByText('取消済み')).toBeVisible()
  expect(cancelBody).toMatchObject({ version: 3, reason: '体調不良のため', confirmation: '取消' })

  // UC-EYEX-061: 実行者・日時・変更前内容 are visible in the audit history.
  const history = page.getByRole('region', { name: '変更履歴' })
  await expect(history).toContainText('予約を取消')
  await expect(history).toContainText('実行者 鈴木')
  await expect(history).toContainText('2026年8月27日 10:30')
  await expect(history).toContainText('変更前 予約済み · 2026年8月27日 11:00')
  await expect(history).toContainText('理由 体調不良のため')
})

// @e2e-covers UC-EYEX-054 AC-EYEX-56 AC-EYEX-57 AC-EYEX-58 AC-EYEX-59 AC-EYEX-61 AC-EYEX-62
test('follows the day of reception events, filters them and restores what a filter hid', async ({
  page,
}) => {
  const all = [
    historyEvents.webBooking,
    historyEvents.changed,
    historyEvents.walkin,
    historyEvents.phoneBooking,
    historyEvents.cancelled,
  ]
  const requested: string[] = []
  await signIn(page, async (call) => {
    if (call.url.pathname === `/api/staff/stores/${STORE_ID}/reception-history`) {
      requested.push(call.url.search)
      const params = call.url.searchParams
      let entries = all
      if (params.get('requiresAttention') === 'true')
        entries = entries.filter((entry) => entry.requiresAttention)
      const source = params.get('source')
      if (source) entries = entries.filter((entry) => entry.source === source)
      const action = params.get('action')
      if (action) entries = entries.filter((entry) => entry.action === action)
      const phone = params.get('phone')
      if (phone)
        entries = entries.filter((entry) => entry.customerPhone?.replace(/-/g, '') === phone)
      return call.route.fulfill({ json: entries })
    }
    return false
  })

  await page.getByRole('button', { name: '受付履歴', exact: true }).click()
  await expect(page.getByRole('heading', { name: '受付履歴' })).toBeVisible()
  const list = page.getByRole('region', { name: '受付履歴' })

  // AC-EYEX-56 / UC-EYEX-054: every kind of same-day event, newest first.
  await expect(list.getByRole('button')).toHaveCount(5)
  await expect(list.getByRole('button').nth(0)).toContainText('14:26')
  await expect(list.getByRole('button').nth(1)).toContainText('14:18')
  await expect(list.getByRole('button').nth(2)).toContainText('13:54')
  await expect(list.getByRole('button').nth(3)).toContainText('13:32')
  await expect(list.getByRole('button').nth(4)).toContainText('13:00')
  await expect(list).toContainText('ウォークイン受付')
  await expect(list).toContainText('予約受付')
  await expect(list).toContainText('変更')
  await expect(list).toContainText('取消')

  // AC-EYEX-62: the store lives in the path, so no other store can be asked for.
  expect(requested[0]).not.toContain('storeId=')
  await expect(page.getByText('銀座店 · 当日の受付記録')).toBeVisible()
  await expect(list).not.toContainText('丸の内店')

  // AC-EYEX-57: a formatted phone number finds its event.
  await page.getByLabel('氏名・電話番号・予約番号').fill('０９０-１２３４ ５６７８')
  await page.getByRole('button', { name: '絞り込む' }).click()
  await expect(list.getByRole('button')).toHaveCount(1)
  await expect(list.getByRole('button').first()).toContainText('田中 花子')
  expect(requested.at(-1)).toContain('phone=09012345678')

  // AC-EYEX-58: source and action narrow the same list.
  await page.getByLabel('氏名・電話番号・予約番号').fill('')
  await page.getByLabel('受付経路').selectOption('web')
  await page.getByRole('button', { name: '絞り込む' }).click()
  await expect(list.getByRole('button')).toHaveCount(1)
  await expect(list.getByRole('button').first()).toContainText('伊藤 健')

  await page.getByLabel('受付経路').selectOption('')
  await page.getByLabel('操作種別').selectOption('cancelled')
  await page.getByRole('button', { name: '絞り込む' }).click()
  await expect(list.getByRole('button')).toHaveCount(1)
  await expect(list.getByRole('button').first()).toContainText('佐藤 実')

  // AC-EYEX-58: 要確認 hides the events that need no attention.
  await page.getByLabel('操作種別').selectOption('')
  await page.getByRole('button', { name: '要確認', exact: true }).click()
  await page.getByRole('button', { name: '絞り込む' }).click()
  await expect(list.getByRole('button')).toHaveCount(1)
  await expect(list.getByRole('button').first()).toContainText('田中 花子')
  expect(requested.at(-1)).toContain('requiresAttention=true')

  // AC-EYEX-61: clearing it brings the hidden events back.
  await page.getByRole('button', { name: '要確認', exact: true }).click()
  await page.getByRole('button', { name: '絞り込む' }).click()
  await expect(list.getByRole('button')).toHaveCount(5)
  await expect(list).toContainText('伊藤 健')
  await expect(list).toContainText('松本 一郎')
  expect(requested.at(-1)).not.toContain('requiresAttention')

  // AC-EYEX-59: selecting an event details it without losing the list.
  await list.getByRole('button', { name: /田中 花子/ }).click()
  const detail = page.getByRole('region', { name: '受付イベント詳細' })
  await expect(detail.getByText('090-1234-5678')).toBeVisible()
  await expect(detail.getByText('EY-0828-1142')).toBeVisible()
  await expect(detail.getByText('鈴木')).toBeVisible()
  await expect(detail.getByText('2026年8月27日 14:18')).toBeVisible()
  await expect(list.getByRole('button')).toHaveCount(5)
})
