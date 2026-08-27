import { expect, type Page, test } from '@playwright/test'

/*
 * EYEX スタッフ端末の「複数店舗切替と店舗境界」の E2E。
 *
 * 店舗境界は「見えない」ことで守られるため、この spec の主張は肯定形より
 * 否定形が多い（他店舗の空き枠が出ない・他店舗のデータが混ざらない・
 * 切替元の条件が持ち越されない）。API はすべて `page.route` で差し替え、
 * 共有 iPad（横向き 1180×820）を既定の viewport とする。
 */

const VIEWPORT = { width: 1180, height: 820 }

const ginzaId = '11111111-1111-4111-8111-111111111111'
const marunouchiId = '22222222-2222-4222-8222-222222222222'
const nihonbashiId = '33333333-3333-4333-8333-333333333333'
const examPurposeId = '44444444-4444-4444-8444-444444444444'
const ginzaReservationId = '55555555-5555-4555-8555-555555555555'
const marunouchiReservationId = '66666666-6666-4666-8666-666666666666'

/** JST の当日。アプリと同じ規則で算出する。 */
function jstToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

function store(id: string, name: string, slug: string, isActive: boolean) {
  return {
    id,
    organizationId: 'org-eyex',
    name,
    slug,
    isActive,
    createdAt: '2026-08-01T00:00:00.000Z',
  }
}

const ginza = store(ginzaId, '銀座店', 'ginza', true)
const marunouchi = store(marunouchiId, '丸の内店', 'marunouchi', true)
/** 受付を止めている店舗。切替候補では運用警告として出る。 */
const nihonbashi = store(nihonbashiId, '日本橋店', 'nihonbashi', false)

const ALL_PERMISSIONS = [
  'store.read',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.history',
  'attention.read',
]

function settingsFor(storeId: string) {
  return {
    storeId,
    version: 3,
    receptionStatus: 'open',
    businessHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      periods: [{ startTime: '10:00', endTime: '19:00' }],
    })),
    exceptions: [],
    purposes: [
      {
        id: examPurposeId,
        staffName: '視力測定',
        customerLabel: 'メガネを新しく作りたい',
        durationMinutes: 60,
        slotIntervalMinutes: 30,
        isPublic: true,
        requiredSkills: [],
        requiredEquipment: [],
        maxConcurrent: 2,
      },
    ],
    staff: [],
    shifts: [],
    equipment: [],
    maintenance: [],
  }
}

/** 店舗ごとに別の時刻を返すので、混ざったら一目で分かる。 */
const slotTimes: Record<string, string[]> = {
  [ginzaId]: ['10:00', '10:30', '11:00'],
  [marunouchiId]: ['15:00', '15:30', '16:00'],
  [nihonbashiId]: ['18:00'],
}

/** 店舗ごとに別の顧客名を返すので、混ざったら一目で分かる。 */
const ledgerCustomer: Record<string, string> = {
  [ginzaId]: '銀座太郎',
  [marunouchiId]: '丸の内花子',
}

function storeIdFromUrl(url: string): string {
  return new URL(url).pathname.split('/')[4] ?? ''
}

function slotsFor(storeId: string, date: string) {
  return {
    storeId,
    date,
    timezone: 'Asia/Tokyo',
    durationMinutes: 60,
    intervalMinutes: 30,
    slots: (slotTimes[storeId] ?? []).map((startTime) => ({
      date,
      startTime,
      endTime: startTime,
      startAt: `${date}T00:00:00.000Z`,
      endAt: `${date}T01:00:00.000Z`,
    })),
  }
}

function ledgerFor(storeId: string, date: string) {
  const name = ledgerCustomer[storeId]
  if (!name) return []
  return [
    {
      id: storeId === ginzaId ? ginzaReservationId : marunouchiReservationId,
      entryType: 'reservation',
      source: 'staff',
      status: 'confirmed',
      startAt: `${date}T01:00:00.000Z`,
      endAt: `${date}T02:00:00.000Z`,
      customerName: name,
      customerId: null,
      progress: null,
      waitStartedAt: null,
      assignedStaffId: null,
      assignedEquipmentIds: [],
      nextGuidance: null,
      warnings: [],
      version: 1,
    },
  ]
}

/** 検索・詳細用の `Reservation`。台帳の行とは別の契約なので別に組み立てる。 */
function reservationsFor(storeId: string, date: string) {
  const name = ledgerCustomer[storeId]
  if (!name) return []
  return [
    {
      id: storeId === ginzaId ? ginzaReservationId : marunouchiReservationId,
      organizationId: 'org-eyex',
      storeId,
      reservationNumber: storeId === ginzaId ? 'EY-1001' : 'EY-2001',
      source: 'staff',
      status: 'confirmed',
      startAt: `${date}T01:00:00.000Z`,
      endAt: `${date}T02:00:00.000Z`,
      purposeIds: [examPurposeId],
      customer: { name, kana: 'テスト', phone: '09000000000', email: null },
      recital: '',
      reservationMemo: null,
      handoffNote: null,
      version: 1,
      createdAt: `${date}T00:00:00.000Z`,
    },
  ]
}

type Options = {
  /** `GET /api/staff/stores` が返す店舗。組織設定による可視性をここで駆動する。 */
  stores?: unknown[]
  /** `POST /api/staff/store-switches` の応答を、呼び出し回数ごとに指定する。 */
  switchStatuses?: number[]
  /** `POST /api/auth/refresh` を失敗させ、個人アカウントのログイン画面から始める。 */
  unauthenticated?: boolean
}

type Recorded = { url: string; method: string; headers: Record<string, string>; body: string }

async function mockStaffApi(page: Page, options: Options = {}) {
  const recorded: Recorded[] = []
  const statuses = [...(options.switchStatuses ?? [])]
  let signedIn = !options.unauthenticated

  const record = (url: string, method: string, headers: Record<string, string>, body = '') => {
    recorded.push({ url, method, headers, body })
  }

  // Playwright は後から登録した route を先に照合するため、総当たりを最初に置く。
  await page.route('**/api/staff/stores/*/**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/auth/refresh', (route) =>
    signedIn
      ? route.fulfill({ json: { token: 'staff-e2e' } })
      : route.fulfill({ status: 401, json: { error: 'unauthenticated' } }),
  )
  await page.route('**/api/auth/login', (route) => {
    record(
      route.request().url(),
      'POST',
      route.request().headers(),
      route.request().postData() ?? '',
    )
    signedIn = true
    return route.fulfill({ json: { token: 'staff-personal-e2e' } })
  })
  await page.route('**/api/staff/stores', (route) => {
    record(route.request().url(), route.request().method(), route.request().headers())
    return route.fulfill({ json: options.stores ?? [ginza, marunouchi, nihonbashi] })
  })
  await page.route('**/api/staff/store-switches', (route) => {
    const request = route.request()
    record(request.url(), 'POST', request.headers(), request.postData() ?? '')
    const status = statuses.shift() ?? 201
    return status === 201
      ? route.fulfill({ status: 201, json: {} })
      : route.fulfill({ status, json: { error: 'audit_failed' } })
  })
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({ json: ALL_PERMISSIONS }),
  )
  await page.route('**/api/staff/stores/*/availability/settings', (route) => {
    record(route.request().url(), 'GET', route.request().headers())
    return route.fulfill({ json: settingsFor(storeIdFromUrl(route.request().url())) })
  })
  await page.route('**/api/staff/stores/*/availability/slots*', (route) => {
    const url = route.request().url()
    record(url, 'GET', route.request().headers())
    return route.fulfill({
      json: slotsFor(storeIdFromUrl(url), new URL(url).searchParams.get('date') ?? jstToday()),
    })
  })
  await page.route('**/api/staff/stores/*/ledger*', (route) => {
    const url = route.request().url()
    record(url, 'GET', route.request().headers())
    return route.fulfill({
      json: ledgerFor(storeIdFromUrl(url), new URL(url).searchParams.get('date') ?? jstToday()),
    })
  })
  await page.route('**/api/staff/stores/*/reservations*', (route) => {
    const url = route.request().url()
    if (route.request().method() !== 'GET') return route.fulfill({ status: 201, json: {} })
    record(url, 'GET', route.request().headers())
    if (url.includes('/reservations/')) {
      const [first] = reservationsFor(storeIdFromUrl(url), jstToday())
      return first ? route.fulfill({ json: first }) : route.fulfill({ json: [] })
    }
    return route.fulfill({ json: reservationsFor(storeIdFromUrl(url), jstToday()) })
  })
  await page.route('**/api/staff/stores/*/customers*', (route) => {
    record(route.request().url(), 'GET', route.request().headers())
    return route.fulfill({ json: [] })
  })
  await page.route('**/api/staff/stores/*/reception-history*', (route) => {
    record(route.request().url(), 'GET', route.request().headers())
    return route.fulfill({ json: [] })
  })
  return recorded
}

async function openWorkspace(page: Page, storeName = '銀座店') {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: `${storeName}のホーム` })).toBeVisible()
}

function headerStoreButton(page: Page) {
  return page.locator('header button').first()
}

function picker(page: Page) {
  return page.getByRole('region', { name: '作業する店舗を切り替える' })
}

async function openPicker(page: Page) {
  await headerStoreButton(page).click()
  await expect(picker(page)).toBeVisible()
  return picker(page)
}

async function switchToGinza(page: Page) {
  await openPicker(page)
  await page.getByRole('button', { name: /銀座店/ }).click()
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
}

async function switchToMarunouchi(page: Page) {
  await openPicker(page)
  await page.getByRole('button', { name: /丸の内店/ }).click()
  // 未保存入力があるときだけ破棄確認が挟まる（UC-EYEX-065 / AC-EYEX-29）。
  const discard = page.getByRole('button', { name: '破棄して切り替える' })
  if (await discard.isVisible()) await discard.click()
  await expect(page.getByRole('heading', { name: '丸の内店のホーム' })).toBeVisible()
}

// @e2e-covers UC-EYEX-064 AC-EYEX-27
test('lists every switch candidate with its name, trading state and warning, and never another store の空き枠', async ({
  page,
}) => {
  const recorded = await mockStaffApi(page)
  await openWorkspace(page)

  const list = await openPicker(page)

  // 店舗名・営業状態・運用警告（受付停止）が候補ごとに読める（AC-EYEX-27 / UC-EYEX-064）。
  const candidates = list.getByRole('button')
  await expect(candidates).toHaveText([
    /銀座店\s*選択中/,
    /丸の内店\s*営業中/,
    /日本橋店\s*受付停止/,
  ])

  // 他店舗の空き枠は「数」も「時刻」も出さない。混ざっていれば別店舗の枠時刻が見える。
  await expect(list).toContainText('他店舗の空き枠はここに表示しません。')
  await expect(list).not.toContainText('15:00')
  await expect(list).not.toContainText('18:00')
  for (const text of await candidates.allInnerTexts()) {
    expect(text).not.toMatch(/\d{1,2}:\d{2}/)
    expect(text).not.toMatch(/空き|残り|\d+\s*枠/)
  }

  // 候補を開いただけで他店舗の空き枠を取りにいかない（一覧比較の下地を作らない）。
  const foreignSlots = recorded.filter(
    (entry) => entry.url.includes('/availability/slots') && !entry.url.includes(ginzaId),
  )
  expect(foreignSlots).toEqual([])
})

// @e2e-covers UC-EYEX-063 UC-EYEX-066 UC-EYEX-071 AC-EYEX-28
test('switches to another store in the area only after the audit record is accepted, then names it on every screen', async ({
  page,
}) => {
  // 1 回目の監査記録は失敗させ、2 回目は成功させる。
  const recorded = await mockStaffApi(page, { switchStatuses: [500, 201] })
  await openWorkspace(page)

  await openPicker(page)
  await page.getByRole('button', { name: /丸の内店/ }).click()

  // 監査記録が失敗する間は、ローカルの選択店舗は動かない（UC-EYEX-071）。
  await expect(
    page.getByText('店舗を切り替えられませんでした。通信を確認してもう一度お試しください。'),
  ).toBeVisible()
  await expect(headerStoreButton(page)).toContainText('銀座店')
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()

  // 監査記録には実行者の切替元・切替先が載る（UC-EYEX-071）。
  const firstAudit = recorded.find((entry) => entry.url.includes('/store-switches'))
  if (!firstAudit) throw new Error('no store switch was recorded')
  expect(JSON.parse(firstAudit.body)).toEqual({ fromStoreId: ginzaId, toStoreId: marunouchiId })
  expect(firstAudit.headers.authorization).toBe('Bearer staff-e2e')

  // 記録が通れば切替が成立し、切替先のホームへ移る（UC-EYEX-063 / AC-EYEX-28）。
  await page.getByRole('button', { name: /丸の内店/ }).click()
  await expect(page.getByRole('heading', { name: '丸の内店のホーム' })).toBeVisible()
  await expect(picker(page)).toHaveCount(0)
  const audits = recorded.filter((entry) => entry.url.includes('/store-switches'))
  expect(audits).toHaveLength(2)
  expect(JSON.parse(audits[1]?.body ?? '{}')).toEqual({
    fromStoreId: ginzaId,
    toStoreId: marunouchiId,
  })

  // 選択店舗名は、どの業務画面でもヘッダーに出続ける（UC-EYEX-066 / AC-EYEX-28）。
  const destinations: [string, RegExp][] = [
    ['予約台帳', /^丸の内店の予約台帳$/],
    ['来店進捗', /^丸の内店の来店受付$/],
    ['受付履歴', /^受付履歴$/],
    ['顧客台帳', /^お客様を探す$/],
  ]
  for (const [label, heading] of destinations) {
    await page
      .getByRole('navigation', { name: '副操作' })
      .getByRole('button', { name: label })
      .click()
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await expect(headerStoreButton(page)).toContainText('丸の内店')
    await expect(headerStoreButton(page)).not.toContainText('銀座店')
    // 選択は端末メモリだけにあるので、次の画面は切替をやり直してから開く。
    await openWorkspace(page)
    await switchToMarunouchi(page)
  }

  // ヘッダーの管理メニューから開く画面でも同じ（AC-EYEX-28）。
  await page
    .getByRole('navigation', { name: '管理メニュー' })
    .getByRole('button', { name: '店舗設定' })
    .click()
  await expect(headerStoreButton(page)).toContainText('丸の内店')
})

// @e2e-covers UC-EYEX-070 AC-EYEX-30
test('carries no search term, no selected reservation and no entered input across the store boundary', async ({
  page,
}) => {
  await mockStaffApi(page)
  await openWorkspace(page)

  // 銀座店で予約入力を途中まで進める（日と時刻まで選んだ状態）。
  await page.getByRole('button', { name: '新しい予約を取る' }).click()
  await page.getByRole('group', { name: '来店予定日' }).getByRole('button').first().click()
  await page.getByRole('button', { name: '10:30', exact: true }).click()
  await expect(page.getByRole('heading', { name: '今回のご来店目的を伺えますか？' })).toBeVisible()
  await page.getByRole('button', { name: /メガネを新しく作りたい/ }).click()

  // 切替後は切替先のホームから始まり、入力も空き枠も持ち越されない（AC-EYEX-30）。
  await switchToMarunouchi(page)
  await expect(page.getByRole('heading', { name: '今回のご来店目的を伺えますか？' })).toHaveCount(0)
  await page.getByRole('button', { name: '新しい予約を取る' }).click()
  // 入力は最初の工程からやり直しになり、選択済みの日も来店目的も残っていない。
  await expect(page.getByRole('heading', { name: 'ご来店予定の日を伺えますか？' })).toBeVisible()
  await expect(
    page.getByRole('group', { name: '来店予定日' }).getByRole('button', { pressed: true }),
  ).toHaveCount(0)

  // 丸の内店で検索条件を入れ、予約を 1 件選ぶ（＝画面パラメータを持った状態）。
  await switchToGinza(page)
  await switchToMarunouchi(page)
  await page.getByRole('button', { name: '予約を変更する' }).click()
  await expect(page.getByRole('heading', { name: '予約を検索する' })).toBeVisible()
  await page.getByLabel('氏名・電話番号・予約番号').fill('丸の内花子')
  await page.getByLabel('予約元').selectOption('staff')
  await page.getByRole('button', { name: '検索する' }).click()
  const results = page.getByRole('region', { name: '検索結果' })
  await expect(results).toContainText('丸の内花子')
  await results.getByRole('button').first().click()
  await expect(page.getByText('EY-2001').first()).toBeVisible()

  // 銀座店へ切り替えると、検索条件も選択中の予約も残らない（UC-EYEX-070 / AC-EYEX-30）。
  await switchToGinza(page)
  await expect(page.getByRole('heading', { name: '予約を検索する' })).toHaveCount(0)
  await expect(page.getByText('EY-2001')).toHaveCount(0)
  await expect(page.getByText('丸の内花子')).toHaveCount(0)

  await page.getByRole('button', { name: '予約を変更する' }).click()
  await expect(page.getByLabel('氏名・電話番号・予約番号')).toHaveValue('')
  await expect(page.getByLabel('予約元')).toHaveValue('')
  await expect(results).toContainText('検索条件を入力してください。')
  await expect(page.getByText('丸の内花子')).toHaveCount(0)
})

// @e2e-covers UC-EYEX-065 AC-EYEX-29
test('interrupts a store switch that would destroy unsaved booking input and lets the operator stay', async ({
  page,
}) => {
  await mockStaffApi(page)
  await openWorkspace(page)

  // まだ何も入力していなければ、切替は黙って通る。警告を出す価値のある状態ではない。
  await page.getByRole('button', { name: '新しい予約を取る' }).click()
  await expect(page.getByRole('heading', { name: 'ご来店予定の日を伺えますか？' })).toBeVisible()
  await openPicker(page)
  await page.getByRole('button', { name: /丸の内店/ }).click()
  await expect(page.getByRole('heading', { name: '丸の内店のホーム' })).toBeVisible()

  // 日を選んだ時点で失うものが生まれる。ここからの切替は必ず確認を挟む。
  await page.getByRole('button', { name: '新しい予約を取る' }).click()
  await page.getByRole('group', { name: '来店予定日' }).getByRole('button').first().click()
  await expect(page.getByRole('heading', { name: 'ご来店予定の時刻を伺えますか？' })).toBeVisible()

  await openPicker(page)
  await page.getByRole('button', { name: /銀座店/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('未保存の入力を破棄して銀座店へ切り替えますか')

  // 「現在の店舗で続ける」を選べば切り替わらず、入力もそのまま残る。
  await dialog.getByRole('button', { name: '現在の店舗で続ける' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'ご来店予定の時刻を伺えますか？' })).toBeVisible()
  // 切替は起きていない。選択中の店舗は丸の内店のままである。
  await expect(
    page.getByRole('region', { name: '作業する店舗を切り替える' }).getByRole('button'),
  ).toHaveText([/銀座店\s*営業中/, /丸の内店\s*選択中/, /日本橋店\s*受付停止/])

  // 破棄を選んだときだけ切り替わる。切替候補は開いたままなので選び直すだけでよい。
  await picker(page)
    .getByRole('button', { name: /銀座店/ })
    .click()
  await page.getByRole('button', { name: '破棄して切り替える' }).click()
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
})

// @e2e-covers UC-EYEX-067 UC-EYEX-068 UC-EYEX-069 AC-EYEX-31
test('scopes every availability and ledger request to the selected store and offers no cross-store affordance', async ({
  page,
}) => {
  const recorded = await mockStaffApi(page)
  await openWorkspace(page)

  // 予約台帳は選択中店舗のものだけ（UC-EYEX-067）。
  await page
    .getByRole('navigation', { name: '副操作' })
    .getByRole('button', { name: '予約台帳' })
    .click()
  await expect(page.getByRole('heading', { name: '銀座店の予約台帳' })).toBeVisible()
  await expect(page.getByText('銀座太郎').first()).toBeVisible()
  await expect(page.getByText('丸の内花子')).toHaveCount(0)

  // 予約入力の空き枠も選択中店舗のものだけで、店舗Bの枠は混ざらない（UC-EYEX-069 / AC-EYEX-31）。
  await openWorkspace(page)
  await page.getByRole('button', { name: '新しい予約を取る' }).click()
  await page.getByRole('group', { name: '来店予定日' }).getByRole('button').first().click()
  // 営業時間内だが銀座店では受け付けられない 13:00 を選ぶと、代替として提示されるのは
  // 銀座店の空き枠だけで、丸の内店の枠（15:00 台）は決して混ざらない。
  await page.getByRole('button', { name: '13:00', exact: true }).click()
  await page.getByRole('button', { name: /メガネを新しく作りたい/ }).click()
  await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
  const alternatives = page.getByRole('group', { name: '代替時刻' }).getByRole('button')
  await expect(alternatives.first()).toBeVisible()
  for (const text of await alternatives.allInnerTexts()) {
    expect(slotTimes[ginzaId]).toContain(text.trim())
    expect(slotTimes[marunouchiId]).not.toContain(text.trim())
  }

  // 他店舗の予約を作る・変える導線は無く、切替はヘッダーだけ（UC-EYEX-068）。
  const bookingBody = page.getByRole('main')
  await expect(bookingBody.getByRole('button', { name: /丸の内店/ })).toHaveCount(0)
  await expect(bookingBody.getByRole('combobox', { name: /店舗/ })).toHaveCount(0)
  await openWorkspace(page)
  await page.getByRole('button', { name: '予約を変更する' }).click()
  await expect(
    page.getByText('銀座店の予約だけを表示します。他店舗はヘッダーの店舗切替で変更してください。'),
  ).toBeVisible()
  await expect(page.getByRole('combobox', { name: /店舗/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /丸の内店/ })).toHaveCount(0)

  // 傍受した URL の全てが店舗Aに閉じている（AC-EYEX-31 / UC-EYEX-067）。
  const scoped = recorded.filter((entry) => entry.url.includes('/api/staff/stores/'))
  expect(scoped.some((entry) => entry.url.includes('/ledger?'))).toBe(true)
  expect(scoped.some((entry) => entry.url.includes('/availability/slots'))).toBe(true)
  expect(scoped.length).toBeGreaterThanOrEqual(3)
  for (const entry of scoped) expect(storeIdFromUrl(entry.url)).toBe(ginzaId)
  expect(recorded.some((entry) => entry.url.includes(marunouchiId))).toBe(false)
})

// @e2e-covers UC-EYEX-072
test('shows stores the operator has no permission for only as the organization setting allows', async ({
  page,
}) => {
  // 設定「一切表示しない」: 権限外店舗はサーバー応答に含まれず、候補にも出ない。
  await mockStaffApi(page, { stores: [ginza, marunouchi] })
  await openWorkspace(page)
  let list = await openPicker(page)
  await expect(list.getByRole('button')).toHaveText([/銀座店/, /丸の内店/])
  await expect(list).not.toContainText('日本橋店')
  // 存在の標識も出さない。ヘッダーの管理メニューは店舗一覧とは無関係なので、
  // 判定は切替候補の中だけで行う。
  await expect(list.getByText(/権限|表示できません|他\d+店舗/)).toHaveCount(0)

  // 設定「概要のみ」: 権限外店舗は名前と営業状態だけを持つ行として現れ、
  // 予約台帳・空き枠といった中身は伴わない。
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await mockStaffApi(page, { stores: [ginza, marunouchi, nihonbashi] })
  await page.reload()
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
  list = await openPicker(page)
  const summarised = list.getByRole('button', { name: /日本橋店/ })
  await expect(summarised).toHaveText(/日本橋店\s*受付停止/)
  await expect(summarised).not.toContainText('予約')
  await expect(summarised).not.toContainText('18:00')
})

// @e2e-covers UC-EYEX-130 AC-EYEX-81
test('signs in with a personal account as the acting subject, without a staff picker or a PIN', async ({
  page,
}) => {
  const recorded = await mockStaffApi(page, { unauthenticated: true })
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')

  // 日常業務の入口は個人アカウントのログインで、スタッフ選択も PIN も求めない（AC-EYEX-81）。
  await expect(page.getByRole('heading', { name: 'スタッフログイン' })).toBeVisible()
  await expect(
    page.getByText('担当店舗の予約・受付を開くには個人アカウントでログインしてください。'),
  ).toBeVisible()
  await expect(page.getByLabel(/PIN/i)).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: /スタッフ/ })).toHaveCount(0)
  await expect(page.getByRole('listbox', { name: /スタッフ/ })).toHaveCount(0)

  await page.getByLabel('メールアドレス').fill('staff@eyex.example')
  await page.getByLabel('パスワード').fill('personal-password')
  await page.getByRole('button', { name: 'ログインする' }).click()

  // ログイン後は個人アカウントのトークンが操作主体として全リクエストに載る（UC-EYEX-130）。
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
  const login = recorded.find((entry) => entry.url.includes('/api/auth/login'))
  if (!login) throw new Error('no personal login was sent')
  expect(JSON.parse(login.body).email).toBe('staff@eyex.example')
  const afterLogin = recorded.filter((entry) => entry.headers.authorization !== undefined)
  expect(afterLogin.length).toBeGreaterThan(0)
  for (const entry of afterLogin)
    expect(entry.headers.authorization).toBe('Bearer staff-personal-e2e')
})
