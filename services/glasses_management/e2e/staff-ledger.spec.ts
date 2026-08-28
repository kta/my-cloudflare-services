import type { LedgerEntry, ReceptionHistoryEntry, Store } from '@app/contracts'
import { expect, type Page, test } from '@playwright/test'
import { choosePickerOption } from './picker'

/**
 * Staff-side journeys: the daily ledger, walk-in reception and the in-store
 * journey board.
 *
 * The built SPA reads the wall clock once at the root (`StaffWorkspace`'s
 * `today` / `now` defaults), so every scenario pins the browser clock with
 * `page.clock.setFixedTime` before `page.goto`. Without that pin the now line
 * (AC-EYEX-13 / AC-EYEX-19) and the ledger day would depend on the day the
 * suite happens to run on.
 */

// 台帳の時間軸は承認済みモックどおり 10:00–13:30 の 7 列なので、現在線が
// 軸の上に載る時刻を選ぶ。11:45 は軸のちょうど中点にあたる。
const NOW = '2026-09-01T02:45:00.000Z' // JST 2026-09-01 11:45
const TODAY = '2026-09-01'
const YESTERDAY = '2026-08-31'
const IPAD_LANDSCAPE = { width: 1180, height: 820 }

const storeId = '11111111-1111-4111-8111-111111111111'
const store: Store = {
  id: storeId,
  organizationId: 'org-eyex',
  name: '銀座店',
  slug: 'ginza',
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
}

const webReservationId = 'aaaaaaaa-0000-4000-8000-000000000001'
const phoneReservationId = 'aaaaaaaa-0000-4000-8000-000000000002'
const walkinId = 'bbbbbbbb-0000-4000-8000-000000000001'
const staffMemberId = 'cccccccc-0000-4000-8000-000000000001'
const equipmentId = 'dddddddd-0000-4000-8000-000000000001'
const customerId = 'eeeeeeee-0000-4000-8000-000000000001'

function webReservation(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: webReservationId,
    entryType: 'reservation',
    source: 'web',
    status: 'confirmed',
    startAt: '2026-09-01T01:00:00.000Z', // 10:00 JST
    endAt: '2026-09-01T02:00:00.000Z',
    customerName: '佐藤 陽子',
    customerId,
    progress: null,
    waitStartedAt: null,
    assignedStaffId: null,
    assignedEquipmentIds: [],
    nextGuidance: null,
    // 台帳のセルは「氏名 / 目的 · 予約元」を出すため、契約上 purposeNames は必須。
    purposeNames: ['視力測定'],
    warnings: [],
    version: 1,
    ...overrides,
  } as LedgerEntry
}

function phoneReservation(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: phoneReservationId,
    entryType: 'reservation',
    source: 'staff',
    status: 'confirmed',
    startAt: '2026-09-01T02:30:00.000Z', // 11:30 JST
    endAt: '2026-09-01T03:30:00.000Z',
    customerName: '鈴木 一郎',
    customerId: null,
    progress: null,
    waitStartedAt: null,
    assignedStaffId: staffMemberId,
    assignedEquipmentIds: [equipmentId],
    nextGuidance: null,
    purposeNames: ['レンズ相談'],
    warnings: [],
    version: 3,
    ...overrides,
  } as LedgerEntry
}

function walkin(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: walkinId,
    entryType: 'walkin',
    source: 'walkin',
    status: 'active',
    startAt: '2026-09-01T02:00:00.000Z', // 11:00 JST
    endAt: '2026-09-01T03:00:00.000Z',
    customerName: 'ウォークイン 11:00',
    customerId: null,
    progress: 'waiting',
    waitStartedAt: '2026-09-01T02:00:00.000Z',
    assignedStaffId: null,
    assignedEquipmentIds: [],
    nextGuidance: null,
    warnings: [],
    version: 1,
    ...overrides,
  } as LedgerEntry
}

/** レーンの見出しになる店舗の名簿。台帳は id ではなく必ず名前で並べる。 */
const availabilitySettings = {
  storeId,
  version: 3,
  receptionStatus: 'open',
  businessHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    periods: [{ startTime: '10:00', endTime: '19:00' }],
  })),
  exceptions: [],
  purposes: [],
  staff: [
    { id: staffMemberId, name: '高橋 健', skills: ['refraction'], canBook: true, isActive: true },
  ],
  shifts: [],
  equipment: [
    { id: equipmentId, name: '測定機A', capacity: 1, isActive: true, availablePeriods: [] },
  ],
  maintenance: [],
}

const candidate = {
  id: customerId,
  name: '田中 花子',
  kana: 'タナカ ハナコ',
  phone: '09012345678',
  email: null,
  primaryStoreId: storeId,
  visitCount: 4,
}

type ServerState = {
  /** Ledger rows per JST day, mutated by the mocked write endpoints. */
  ledger: Record<string, LedgerEntry[]>
  history: ReceptionHistoryEntry[]
  /** When set, the next matching write answers 409 once. */
  conflictOn?: { path: string; currentVersion: number }
  requests: { method: string; url: string; body: unknown }[]
}

async function mockStaffApi(page: Page, state: ServerState) {
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    let body: unknown
    try {
      body = request.postData() ? JSON.parse(request.postData() ?? '') : undefined
    } catch {
      body = request.postData()
    }
    state.requests.push({ method, url: request.url(), body })

    if (path === '/api/auth/refresh') return route.fulfill({ json: { token: 'e2e-access-token' } })
    if (path === '/api/staff/stores') return route.fulfill({ json: [store] })
    if (path === '/api/staff/store-switches') return route.fulfill({ status: 201, json: {} })
    if (path.endsWith('/ledger')) {
      const date = url.searchParams.get('date') ?? ''
      return route.fulfill({ json: state.ledger[date] ?? [] })
    }
    if (path.endsWith('/customers')) return route.fulfill({ json: [candidate] })
    // 台帳のレーンは担当者・設備の「名前」で組まれる。名簿を返さないと
    // どちらの軸も名称未取得になり、軸の切り替えを確かめられない。
    if (path.endsWith('/availability/settings'))
      return route.fulfill({ json: availabilitySettings })
    if (path.endsWith('/reception-history')) return route.fulfill({ json: state.history })

    // Writes below are the compare-and-swap surface the screens drive.
    if (state.conflictOn && path === state.conflictOn.path) {
      const currentVersion = state.conflictOn.currentVersion
      state.conflictOn = undefined
      return route.fulfill({ status: 409, json: { error: 'version_conflict', currentVersion } })
    }
    const today = state.ledger[TODAY] ?? []
    const patchEntry = (id: string, changes: Partial<LedgerEntry>) => {
      state.ledger[TODAY] = today.map((entry) =>
        entry.id === id
          ? ({ ...entry, ...changes, version: entry.version + 1 } as LedgerEntry)
          : entry,
      )
    }
    const walkinMatch = /\/walkins\/([^/]+)\/(progress|customer)$/.exec(path)
    if (method === 'POST' && path.endsWith('/walkins')) {
      state.ledger[TODAY] = [...today, walkin()]
      return route.fulfill({ status: 201, json: { id: walkinId } })
    }
    if (walkinMatch && method === 'PATCH') {
      const payload = (body ?? {}) as Record<string, unknown>
      if (walkinMatch[2] === 'progress')
        patchEntry(walkinMatch[1] ?? '', {
          progress: payload.progress as LedgerEntry['progress'],
          status: payload.progress === 'departed' ? 'departed' : 'active',
        } as Partial<LedgerEntry>)
      else
        patchEntry(walkinMatch[1] ?? '', {
          customerId: candidate.id,
          customerName:
            typeof payload.customerId === 'string'
              ? candidate.name
              : String((payload.customer as Record<string, unknown>)?.name ?? candidate.name),
        } as Partial<LedgerEntry>)
      return route.fulfill({ json: { ok: true } })
    }
    const reservationMatch = /\/reservations\/([^/]+)\/(progress|no-show|cancel)$/.exec(path)
    if (reservationMatch) {
      const id = reservationMatch[1] ?? ''
      const payload = (body ?? {}) as Record<string, unknown>
      if (reservationMatch[2] === 'progress')
        patchEntry(id, {
          progress: payload.progress as LedgerEntry['progress'],
          status: 'checked_in',
          assignedStaffId: (payload.assignedStaffId as string | null) ?? null,
          assignedEquipmentIds: (payload.assignedEquipmentIds as string[]) ?? [],
          nextGuidance: (payload.nextGuidance as string | null) ?? null,
          waitStartedAt: '2026-09-01T05:00:00.000Z',
        } as Partial<LedgerEntry>)
      else
        patchEntry(id, {
          status: reservationMatch[2] === 'no-show' ? 'no_show' : 'cancelled',
        } as Partial<LedgerEntry>)
      return route.fulfill({ json: { ok: true } })
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } })
  })
}

function newState(entries: LedgerEntry[], yesterday: LedgerEntry[] = []): ServerState {
  return {
    ledger: { [TODAY]: entries, [YESTERDAY]: yesterday },
    history: [],
    requests: [],
  }
}

/** Sign in through the session bootstrap and land on the selected store's home. */
async function openWorkspace(page: Page) {
  await page.setViewportSize(IPAD_LANDSCAPE)
  await page.clock.setFixedTime(new Date(NOW))
  await page.goto('/')
  // ホームは見出しを持たない面なので、主操作のナビゲーションで到達を待つ。
  await expect(page.getByRole('navigation', { name: '主操作' })).toBeVisible()
}

async function openLedgerFor(page: Page, monthDay: string) {
  await page.getByRole('button', { name: new RegExp(`^${monthDay}（.）の予約台帳`) }).click()
  await expect(page.getByRole('heading', { name: '銀座店の予約台帳' })).toBeVisible()
}

// @e2e-covers UC-EYEX-043 UC-EYEX-044 UC-EYEX-045 UC-EYEX-046 AC-EYEX-13 AC-EYEX-19
test('shows every channel on one axis with the now line, both lane views and an inline detail', async ({
  page,
}) => {
  const state = newState([
    webReservation(),
    phoneReservation(),
    walkin({ customerId, customerName: '高橋 実' }),
  ])
  await mockStaffApi(page, state)
  await openWorkspace(page)
  await openLedgerFor(page, '9月1日')

  const grid = page.getByRole('grid', { name: '予約台帳' })
  // UC-EYEX-043: web, phone/counter and walk-in share one time axis.
  await expect(grid.getByText('Web予約')).toBeVisible()
  await expect(grid.getByText('店頭・電話')).toBeVisible()
  await expect(grid.getByText('ウォークイン')).toBeVisible()
  // 軸は承認済みモックの 7 列（10:00〜13:00）。両端が同じ軸の上にある。
  await expect(grid.getByText('10:00', { exact: true })).toBeVisible()
  await expect(grid.getByText('13:00', { exact: true })).toBeVisible()

  // AC-EYEX-13 / UC-EYEX-045: `現在 HH:mm` drawn at the matching grid position.
  const nowLine = grid.getByText('現在 11:45')
  await expect(nowLine).toBeVisible()
  const gridBox = await grid.boundingBox()
  const nowBox = await nowLine.boundingBox()
  if (!gridBox || !nowBox) throw new Error('expected both the grid and the now line to be laid out')
  // 11:45 is the exact midpoint of the 10:00–13:30 grid, right of the 180px lane column.
  const laneColumn = 180
  const axisLeft = gridBox.x + laneColumn
  const expected = axisLeft + (gridBox.width - laneColumn) * 0.5
  expect(nowBox.x).toBeGreaterThan(axisLeft)
  expect(Math.abs(nowBox.x - expected)).toBeLessThan(24)

  // UC-EYEX-044: the same entries regroup by assignee and by equipment.
  await expect(grid.getByText('担当者未定')).toBeVisible()
  await expect(grid.getByText('高橋 健')).toBeVisible()
  // 軸の切り替えは列見出しのセル自身が兼ねる（帯を 1 段も増やさないため）。
  await page.getByRole('button', { name: '担当者で見る（設備に切り替え）' }).click()
  await expect(grid.getByText('設備未定')).toBeVisible()
  await expect(grid.getByText('測定機A')).toBeVisible()
  await expect(grid.getByText('担当者未定')).toHaveCount(0)

  // UC-EYEX-046: the detail opens beside the ledger, never on top of it.
  await page
    .getByRole('button', { name: /佐藤 陽子/ })
    .first()
    .click()
  const detail = page.getByRole('region', { name: '選択中の予約' })
  await expect(detail.getByText('佐藤 陽子')).toBeVisible()
  await expect(detail.getByText('10:00–11:00')).toBeVisible()
  await expect(detail.getByText('予約済み')).toBeVisible()
  await expect(grid.getByText('現在 11:45')).toBeVisible()

  // AC-EYEX-19: another day never shows a now line. 面は日付を描かないので、
  // 「前日の台帳を開いた」ことは前日ぶんの読み込み要求で確かめる。
  await page.goto('/')
  await openLedgerFor(page, '8月31日')
  await expect
    .poll(() => state.requests.some((entry) => entry.url.includes(`date=${YESTERDAY}`)))
    .toBe(true)
  await expect(page.getByText(/^現在 /)).toHaveCount(0)
})

// @e2e-covers UC-EYEX-047 UC-EYEX-048 AC-EYEX-11 AC-EYEX-12 AC-EYEX-17
test('receives a walk-in without customer details and links it to an existing customer afterwards', async ({
  page,
}) => {
  const state = newState([webReservation()])
  await mockStaffApi(page, state)
  await openWorkspace(page)
  await openLedgerFor(page, '9月1日')

  // AC-EYEX-11 / UC-EYEX-047: reception succeeds with a provisional label only.
  // 面の行き来は全画面共通の左サイドバー 1 本に集約されたので、そこから来店受付へ。
  const sidebar = page.getByRole('navigation', { name: '画面の一覧' })
  await sidebar.getByRole('button', { name: '来店受付', exact: true }).click()
  // 受付の主操作は緑帯へ移った（面の主操作は帯が持つ）。
  await page.getByRole('banner').getByRole('button', { name: '＋ 店頭のお客様を受付' }).click()
  await sidebar.getByRole('button', { name: '予約台帳', exact: true }).click()
  const card = page.getByRole('button', { name: /ウォークイン 11:00/ })
  await expect(card).toBeVisible()
  await expect(card).toContainText('顧客未登録')
  await card.click()

  // AC-EYEX-12: search an existing customer or register a new one, from here.
  const detail = page.getByRole('region', { name: '選択中の予約' })
  // 仮の名乗りのまま受付が成立し、待ちの状態として台帳に載っている。
  await expect(detail).toContainText('お待ち')
  await expect(detail.getByLabel('氏名で顧客を探す')).toBeVisible()
  await expect(
    detail.getByRole('button', { name: '新規顧客として登録して関連付ける' }),
  ).toBeVisible()
  await detail.getByLabel('氏名で顧客を探す').fill('田中')
  await detail.getByRole('button', { name: '顧客を検索する' }).click()

  // UC-EYEX-048 / AC-EYEX-17: the link is a versioned, attributable write and
  // the visit is thereafter shown under the linked customer.
  await detail.getByRole('button', { name: /田中 花子 · 09012345678/ }).click()
  await expect(page.getByRole('button', { name: /田中 花子/ }).first()).toBeVisible()
  await expect(page.getByText('顧客未登録')).toHaveCount(0)
  const link = state.requests.find(
    (entry) => entry.method === 'PATCH' && entry.url.includes(`/walkins/${walkinId}/customer`),
  )
  expect(link?.body).toEqual({ version: 1, customerId })
})

// @e2e-covers UC-EYEX-049 UC-EYEX-050 AC-EYEX-18
test('registers a new customer from a walk-in and keeps a departed unregistered walk-in searchable', async ({
  page,
}) => {
  const state = newState([walkin()])
  await mockStaffApi(page, state)
  await openWorkspace(page)
  await openLedgerFor(page, '9月1日')

  // UC-EYEX-049: create the customer from the walk-in and link in one action.
  await page.getByRole('button', { name: /ウォークイン 11:00/ }).click()
  const detail = page.getByRole('region', { name: '選択中の予約' })
  await detail.getByLabel('お名前').fill('山本 千夏')
  await detail.getByLabel('フリガナ').fill('ヤマモト チナツ')
  await detail.getByLabel('電話番号').fill('08099998888')
  await detail.getByRole('button', { name: '新規顧客として登録して関連付ける' }).click()
  await expect(page.getByRole('button', { name: /山本 千夏/ }).first()).toBeVisible()
  const created = state.requests.find(
    (entry) => entry.method === 'PATCH' && entry.url.includes(`/walkins/${walkinId}/customer`),
  )
  expect(created?.body).toEqual({
    version: 1,
    customer: { name: '山本 千夏', kana: 'ヤマモト チナツ', phone: '08099998888' },
  })

  // AC-EYEX-18 / UC-EYEX-050: an unregistered walk-in departs and the record
  // survives, findable later as 顧客未登録.
  state.ledger[TODAY] = [walkin()]
  state.history = [
    {
      id: 'ffffffff-0000-4000-8000-000000000001',
      occurredAt: '2026-09-01T05:00:00.000Z',
      source: 'walkin',
      action: 'walkin_created',
      entityType: 'walkin',
      entityId: walkinId,
      reservationId: null,
      customerName: null,
      customerPhone: null,
      reservationNumber: null,
      actorId: 'staff-1',
      requiresAttention: false,
      recordingStatus: 'none',
    },
  ]
  await page.reload()
  await openLedgerFor(page, '9月1日')
  await page.getByRole('button', { name: /ウォークイン 11:00/ }).click()
  await page.getByRole('button', { name: '退店として記録する' }).click()
  // 台帳のコマは 2 行しか持たないので、状態は選択中の 1 件の面が名乗る。
  await expect(page.getByRole('region', { name: '選択中の予約' })).toContainText('退店')

  await page.goto('/')
  await page.getByRole('button', { name: '受付履歴', exact: true }).click()
  await page.getByRole('button', { name: '店頭', exact: true }).click()
  const historyList = page.getByRole('region', { name: '受付履歴' })
  await expect(historyList.getByText('顧客未登録')).toBeVisible()
  await expect(historyList.getByText(/を受付/)).toBeVisible()
  expect(
    state.requests.some(
      (entry) => entry.url.includes('/reception-history?') && entry.url.includes('source=walkin'),
    ),
  ).toBe(true)
})

// @e2e-covers UC-EYEX-051 UC-EYEX-052 UC-EYEX-053 AC-EYEX-25 AC-EYEX-26
test('runs the in-store journey: arrival, stage handover and colour-free waiting warnings', async ({
  page,
}) => {
  const state = newState([
    webReservation(),
    phoneReservation(),
    walkin({
      warnings: [
        {
          code: 'long_wait',
          message: '30分以上お待ちです。担当者を割り当ててご案内してください。',
        },
        { code: 'staff_unassigned', message: '担当者が割り当てられていません。' },
      ],
    }),
  ])
  await mockStaffApi(page, state)
  await openWorkspace(page)
  await openLedgerFor(page, '9月1日')
  // 来店受付の面へは左サイドバー（全画面共通）から移る。
  await page
    .getByRole('navigation', { name: '画面の一覧' })
    .getByRole('button', { name: '来店受付', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: '銀座店の来店受付' })).toBeVisible()

  /*
   * UC-EYEX-053 / AC-EYEX-26: 注意は色ではなく言葉で読める。並びの中では短い語
   * （`長時間待機` / `担当不在`）が客の行に付き、理由の全文は選んだ 1 件の面が
   * 受け持つ（専用の一覧を別に持たず、注意はその客の居る場所に出る）。
   */
  const board = page.getByRole('grid', { name: '接客の進み具合' })
  const waitingCustomer = board.getByRole('button', { name: /ウォークイン/ })
  await expect(waitingCustomer).toContainText('長時間待機')
  await expect(waitingCustomer).toContainText('担当不在')
  await waitingCustomer.click()
  const waitingPanel = page.getByRole('region', { name: '選択中のお客様' })
  await expect(waitingPanel).toContainText(
    '30分以上お待ちです。担当者を割り当ててご案内してください。',
  )
  await expect(waitingPanel).toContainText('担当者が割り当てられていません。')

  // UC-EYEX-051: record an arrival, then a no-show and a cancellation.
  await board.getByRole('button', { name: /佐藤 陽子/ }).click()
  const panel = page.getByRole('region', { name: '選択中のお客様' })
  await panel.getByRole('button', { name: '来店済みとして記録する' }).click()
  await expect(board.getByRole('button', { name: /佐藤 陽子/ })).toBeVisible()

  // UC-EYEX-052 / AC-EYEX-25: stage, assignee, equipment and handover note are
  // saved together and reappear on the board.
  await board.getByRole('button', { name: /佐藤 陽子/ }).click()
  await choosePickerOption(panel, '店内工程', '接客中')
  await panel.getByLabel('担当者ID').fill(staffMemberId)
  await panel.getByLabel('設備ID').fill(equipmentId)
  await panel.getByLabel('次のご案内').fill('レンズ度数の確認へご案内')
  await panel.getByRole('button', { name: '接客の状況を保存する' }).click()
  // 引き継ぎは次の工程のコマに出る（名乗りのコマではない）。
  await expect(board).toContainText('次にご案内')
  await expect(board).toContainText('レンズ度数の確認へご案内')
  const saved = state.requests.filter(
    (entry) =>
      entry.method === 'PATCH' && entry.url.includes(`/reservations/${webReservationId}/progress`),
  )
  expect(saved.at(-1)?.body).toEqual({
    version: 2,
    progress: 'service_in_progress',
    assignedStaffId: staffMemberId,
    assignedEquipmentIds: [equipmentId],
    nextGuidance: 'レンズ度数の確認へご案内',
  })

  await board.getByRole('button', { name: /鈴木 一郎/ }).click()
  await panel.getByRole('button', { name: '無断キャンセルとして記録する' }).click()
  await expect
    .poll(() =>
      state.requests.some((entry) =>
        entry.url.includes(`/reservations/${phoneReservationId}/no-show`),
      ),
    )
    .toBe(true)
  await board.getByRole('button', { name: /鈴木 一郎/ }).click()
  await expect(panel.getByRole('button', { name: '予約を取り消す' })).toBeDisabled()
  await panel.getByLabel('取消の理由').fill('お客様都合')
  await panel.getByRole('button', { name: '予約を取り消す' }).click()
  const cancelled = state.requests.find((entry) =>
    entry.url.includes(`/reservations/${phoneReservationId}/cancel`),
  )
  expect(cancelled?.body).toEqual({ version: 4, reason: 'お客様都合', confirmation: '取り消す' })
})

// @e2e-covers UC-EYEX-172 UC-EYEX-173 AC-EYEX-110
test('refuses a stale write, shows the latest version and lets the operator re-apply or discard', async ({
  page,
}) => {
  const state = newState([walkin()])
  await mockStaffApi(page, state)
  await openWorkspace(page)
  await openLedgerFor(page, '9月1日')

  // UC-EYEX-172 / AC-EYEX-110: another terminal got there first; the stale
  // version is rejected and the freshly loaded version is named.
  state.conflictOn = {
    path: `/api/staff/stores/${storeId}/walkins/${walkinId}/progress`,
    currentVersion: 7,
  }
  state.ledger[TODAY] = [walkin({ version: 7, nextGuidance: '他端末が更新しました' })]
  await page.getByRole('button', { name: /ウォークイン 11:00/ }).click()
  await page.getByRole('button', { name: '退店として記録する' }).click()
  await expect(page.getByText('この画面は最新の状態に更新済みです（版 7）。')).toBeVisible()
  expect(state.requests.filter((entry) => entry.url.includes('/progress')).at(-1)?.body).toEqual({
    version: 1,
    progress: 'departed',
  })

  // UC-EYEX-173: re-apply the same intent against the latest state.
  await page.getByRole('button', { name: '最新内容へ再適用' }).click()
  await expect(page.getByText(/この画面は最新の状態に更新済みです/)).toHaveCount(0)
  expect(state.requests.filter((entry) => entry.url.includes('/progress')).at(-1)?.body).toEqual({
    version: 7,
    progress: 'departed',
  })
  await expect(page.getByRole('region', { name: '選択中の予約' })).toContainText('退店')

  // UC-EYEX-173: or discard the pending input instead, leaving the latest state.
  state.ledger[TODAY] = [walkin({ version: 9 })]
  await page.reload()
  await openLedgerFor(page, '9月1日')
  state.conflictOn = {
    path: `/api/staff/stores/${storeId}/walkins/${walkinId}/progress`,
    currentVersion: 11,
  }
  state.ledger[TODAY] = [walkin({ version: 11 })]
  await page.getByRole('button', { name: /ウォークイン 11:00/ }).click()
  await page.getByRole('button', { name: '退店として記録する' }).click()
  await expect(page.getByText('この画面は最新の状態に更新済みです（版 11）。')).toBeVisible()
  await page.getByRole('button', { name: 'この入力を破棄' }).click()
  await expect(page.getByText(/この画面は最新の状態に更新済みです/)).toHaveCount(0)
  await expect(page.getByRole('region', { name: '選択中の予約' })).toContainText('お待ち')
})
