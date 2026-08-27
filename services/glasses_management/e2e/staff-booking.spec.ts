import { expect, type Page, test } from '@playwright/test'

/*
 * EYEX スタッフ端末（ホーム / 電話・店頭予約 / 顧客の同定）の E2E。
 *
 * 対象画面は共有 iPad（横向き 1180×820）を前提にしているため、既定の viewport を
 * それに合わせる。API はすべて `page.route` で差し替え、SPA だけを実行する。
 */

const VIEWPORT = { width: 1180, height: 820 }

const ginzaId = '11111111-1111-4111-8111-111111111111'
const marunouchiId = '22222222-2222-4222-8222-222222222222'
const examPurposeId = '33333333-3333-4333-8333-333333333333'
const adjustPurposeId = '44444444-4444-4444-8444-444444444444'
const hanakoId = '55555555-5555-4555-8555-555555555555'
const taroId = '66666666-6666-4666-8666-666666666666'

/** JST の当日。アプリと同じ規則で算出する（アプリは注入された today を使う）。 */
function jstToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

function addDays(date: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

function dayLabel(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  return `${at.getUTCMonth() + 1}月${at.getUTCDate()}日（${WEEKDAYS[at.getUTCDay()]}）`
}

const stores = [
  {
    id: ginzaId,
    organizationId: 'org-eyex',
    name: '銀座店',
    slug: 'ginza',
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: marunouchiId,
    organizationId: 'org-eyex',
    name: '丸の内店',
    slug: 'marunouchi',
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
]

const purposes = [
  {
    id: examPurposeId,
    staffName: '視力測定',
    customerLabel: 'メガネを新しく作りたい',
    durationMinutes: 60,
    slotIntervalMinutes: 30,
    isPublic: true,
    requiredSkills: ['refraction'],
    requiredEquipment: ['autoref'],
    maxConcurrent: 2,
  },
  {
    id: adjustPurposeId,
    staffName: 'フィッティング',
    customerLabel: 'かけ具合を調整したい',
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    isPublic: true,
    requiredSkills: [],
    requiredEquipment: [],
    maxConcurrent: 2,
  },
]

const settings = {
  storeId: ginzaId,
  version: 3,
  receptionStatus: 'open',
  businessHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    periods: [{ startTime: '10:00', endTime: '19:00' }],
  })),
  exceptions: [],
  purposes,
  staff: [],
  shifts: [],
  equipment: [],
  maintenance: [],
}

function slotsFor(date: string, times: string[]) {
  return {
    storeId: ginzaId,
    date,
    timezone: 'Asia/Tokyo',
    durationMinutes: 90,
    intervalMinutes: 30,
    slots: times.map((startTime) => ({
      date,
      startTime,
      endTime: startTime,
      startAt: `${date}T00:00:00.000Z`,
      endAt: `${date}T01:00:00.000Z`,
    })),
  }
}

const hanako = {
  id: hanakoId,
  name: '田中花子',
  kana: 'タナカハナコ',
  phone: '090-1234-5678',
  email: null,
  primaryStoreId: ginzaId,
  visitCount: 4,
}
const taro = {
  id: taroId,
  name: '田中太郎',
  kana: 'タナカタロウ',
  phone: '09012345678',
  email: null,
  primaryStoreId: marunouchiId,
  visitCount: 1,
}

type Recorded = { url: string; method: string; headers: Record<string, string>; body: string }

type Options = {
  /** `startTime` が空き枠に含まれるか。false なら代替枠だけを返す。 */
  offered?: string[]
  /** 予約 POST の応答を、呼び出し回数ごとに指定する。 */
  reservationStatuses?: number[]
  customers?: unknown[]
}

async function mockStaffApi(page: Page, options: Options = {}) {
  const recorded: Recorded[] = []
  const offered = options.offered ?? ['10:00', '10:30', '11:00', '11:30', '12:00']
  const statuses = [...(options.reservationStatuses ?? [201])]

  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ json: { token: 'staff-e2e' } }),
  )
  await page.route('**/api/staff/stores', (route) => route.fulfill({ json: stores }))
  await page.route('**/api/staff/store-switches', (route) =>
    route.fulfill({ status: 201, json: {} }),
  )
  await page.route('**/api/staff/stores/*/availability/settings', (route) =>
    route.fulfill({ json: settings }),
  )
  await page.route('**/api/staff/stores/*/availability/slots*', (route) => {
    const url = new URL(route.request().url())
    recorded.push({
      url: route.request().url(),
      method: 'GET',
      headers: route.request().headers(),
      body: '',
    })
    return route.fulfill({ json: slotsFor(url.searchParams.get('date') ?? jstToday(), offered) })
  })
  await page.route('**/api/staff/stores/*/customers*', (route) => {
    recorded.push({
      url: route.request().url(),
      method: 'GET',
      headers: route.request().headers(),
      body: '',
    })
    return route.fulfill({ json: options.customers ?? [] })
  })
  await page.route('**/api/staff/stores/*/ledger*', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/staff/stores/*/reception-history*', (route) =>
    route.fulfill({ json: [] }),
  )
  await page.route('**/api/staff/stores/*/reservations', (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ json: [] })
    recorded.push({
      url: request.url(),
      method: 'POST',
      headers: request.headers(),
      body: request.postData() ?? '',
    })
    const status = statuses.shift() ?? 201
    if (status !== 201) return route.fulfill({ status, json: { error: 'failed' } })
    const body = JSON.parse(request.postData() ?? '{}')
    return route.fulfill({
      status: 201,
      json: {
        id: '77777777-7777-4777-8777-777777777777',
        organizationId: 'org-eyex',
        storeId: ginzaId,
        reservationNumber: 'EY-2001',
        source: 'staff',
        status: 'confirmed',
        startAt: `${body.date}T01:00:00.000Z`,
        endAt: `${body.date}T02:30:00.000Z`,
        purposeIds: body.purposeIds,
        customer: { ...body.customer, email: body.customer.email ?? null },
        recital: body.recital,
        reservationMemo: body.reservationMemo ?? null,
        handoffNote: body.handoffNote ?? null,
        version: 1,
        createdAt: `${body.date}T00:00:00.000Z`,
      },
    })
  })
  return recorded
}

async function openHome(page: Page) {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
}

/** 日 → 時間 → 来店目的（2件）→ 受付可否確認 まで進める。 */
async function reachCustomerStep(page: Page, startTime = '11:00') {
  await page.getByRole('button', { name: '新しい予約を取る' }).click()
  await expect(page.getByRole('heading', { name: 'ご来店予定の日を伺えますか？' })).toBeVisible()
  await page.getByRole('button', { name: dayLabel(jstToday()) }).click()
  await page.getByRole('button', { name: startTime, exact: true }).click()
  await page.getByRole('button', { name: /メガネを新しく作りたい/ }).click()
  await page.getByRole('button', { name: /かけ具合を調整したい/ }).click()
  await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
}

async function fillCustomer(page: Page) {
  await page.getByLabel('お電話番号').fill('09012345678')
  await page.getByLabel('お名前', { exact: true }).fill('田中花子')
  await page.getByLabel('フリガナ').fill('タナカハナコ')
  await page.getByLabel('予約メモ').fill('遠近両用を検討中')
  await page.getByLabel('店内引き継ぎ事項').fill('担当は鈴木を希望')
  await page.getByRole('button', { name: '復唱へ進む' }).click()
}

/** 要素の実効背景色を祖先までたどって求め、前景とのコントラスト比を返す。 */
function contrastRatio(selector: string): number | null {
  const parse = (value: string) => {
    const parts = value.match(/[\d.]+/g)
    if (!parts) return null
    const [r = 0, g = 0, b = 0, a] = parts.map(Number)
    return { r, g, b, a: a === undefined ? 1 : a }
  }
  const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
    const channel = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }
  const element = document.querySelector(selector)
  if (!element) return null
  const foreground = parse(getComputedStyle(element).color)
  let node: Element | null = element
  let background: { r: number; g: number; b: number; a: number } | null = null
  while (node) {
    const candidate = parse(getComputedStyle(node).backgroundColor)
    if (candidate && candidate.a > 0.99) {
      background = candidate
      break
    }
    node = node.parentElement
  }
  if (!foreground || !background) return null
  const [light = 0, dark = 0] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

// @e2e-covers UC-EYEX-002 UC-EYEX-003 UC-EYEX-004 UC-EYEX-005 UC-EYEX-007 AC-EYEX-09
test('opens every staff destination from the landscape iPad home screen', async ({ page }) => {
  await mockStaffApi(page)
  await openHome(page)

  // 選択中店舗と営業状態が常に見える（UC-EYEX-005）。
  await expect(page.getByLabel('選択中の店舗と営業状態')).toHaveText(
    '選択中の店舗: 銀座店 · 営業中',
  )
  await expect(page.getByRole('button', { name: /銀座店/ }).first()).toContainText('営業中')

  // お知らせとアラートは決して合算されない別領域（UC-EYEX-007）。
  const announcements = page.getByLabel('お知らせ（未読）')
  const alerts = page.getByLabel('アラート（要対応）')
  await expect(announcements).toBeVisible()
  await expect(alerts).toBeVisible()
  await expect(announcements).not.toContainText('アラート')
  await expect(alerts).not.toContainText('お知らせ')

  // 主操作 2 件・副操作 5 件・日付ストリップの順に縦に並ぶ（AC-EYEX-09）。
  const primary = page.getByRole('navigation', { name: '主操作' })
  const secondary = page.getByRole('navigation', { name: '副操作' })
  const strip = page.getByRole('navigation', { name: '日付' })
  await expect(primary.getByRole('button')).toHaveText([/新しい予約を取る/, /予約を変更する/])
  await expect(secondary.getByRole('button')).toHaveCount(5)
  const primaryBox = await primary.getByRole('button').first().boundingBox()
  const secondaryBox = await secondary.getByRole('button').first().boundingBox()
  const stripBox = await strip.boundingBox()
  if (!primaryBox || !secondaryBox || !stripBox) throw new Error('home layout not measurable')
  // 主操作は副操作より広い面積を占め、日付ストリップは両者より下にある。
  expect(primaryBox.width * primaryBox.height).toBeGreaterThan(
    secondaryBox.width * secondaryBox.height,
  )
  expect(stripBox.y).toBeGreaterThan(primaryBox.y + primaryBox.height)

  // 日付ストリップから選択日の予約台帳を開く（UC-EYEX-004）。
  const tomorrow = addDays(jstToday(), 1)
  const [ledgerRequest] = await Promise.all([
    page.waitForRequest((request) => request.url().includes('/ledger?date=')),
    strip
      .getByRole('button', { name: new RegExp(`^${dayLabel(tomorrow).replace(/[（）]/g, '.')}`) })
      .click(),
  ])
  expect(ledgerRequest.url()).toContain(`date=${tomorrow}`)
  await expect(page.getByRole('heading', { name: '銀座店の予約台帳' })).toBeVisible()

  // 予約変更はホームの主操作から始まる（UC-EYEX-002）。
  await openHome(page)
  await page.getByRole('button', { name: '予約を変更する' }).click()
  await expect(page.getByRole('heading', { name: '予約を検索する' })).toBeVisible()

  // 副操作から 4 つの業務画面へ移動できる（UC-EYEX-003）。
  const destinations: [string, RegExp][] = [
    ['受付履歴', /^受付履歴$/],
    ['顧客台帳', /^お客様を探す$/],
    ['来店進捗', /^銀座店の来店受付$/],
    ['予約台帳', /^銀座店の予約台帳$/],
  ]
  for (const [label, heading] of destinations) {
    await openHome(page)
    await secondary.getByRole('button', { name: label }).click()
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  }
})

// @e2e-covers UC-EYEX-001 UC-EYEX-009 UC-EYEX-010 UC-EYEX-012 UC-EYEX-013 UC-EYEX-015 UC-EYEX-016 UC-EYEX-020 AC-EYEX-01 AC-EYEX-02 AC-EYEX-06
test('takes a telephone booking through the five fixed steps and the spoken recital', async ({
  page,
}) => {
  const recorded = await mockStaffApi(page)
  await openHome(page)

  // ホームの主操作から予約入力が始まる（UC-EYEX-001 / AC-EYEX-01）。
  await page.getByRole('button', { name: '新しい予約を取る' }).click()
  const steps = page.getByRole('list', { name: '予約入力の工程' }).getByRole('listitem')
  await expect(steps).toHaveText([
    /1\s*日/,
    /2\s*時間/,
    /3\s*来店目的/,
    /4\s*お客様情報/,
    /5\s*復唱する/,
  ])
  await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step')

  // 各工程の主見出しは、そのまま電話口で読み上げられる質問文（UC-EYEX-010 / AC-EYEX-02）。
  await expect(page.getByRole('heading', { name: 'ご来店予定の日を伺えますか？' })).toBeVisible()

  // 受付可能日は今日以降だけ（UC-EYEX-012）。
  const dates = page.getByRole('group', { name: '来店予定日' }).getByRole('button')
  const today = jstToday()
  await expect(dates.first()).toHaveText(dayLabel(today))
  await expect(dates.nth(1)).toHaveText(dayLabel(addDays(today, 1)))
  await expect(
    page.getByRole('button', { name: dayLabel(addDays(today, -1)), exact: true }),
  ).toHaveCount(0)

  await dates.first().click()
  await expect(page.getByRole('heading', { name: 'ご来店予定の時刻を伺えますか？' })).toBeVisible()
  await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step')
  const times = page.getByRole('group', { name: '来店予定時刻' }).getByRole('button')
  await expect(times.first()).toHaveText('10:00')
  await page.getByRole('button', { name: '11:00', exact: true }).click()

  // 複数の来店目的と合計所要時間（UC-EYEX-015）。
  await expect(page.getByRole('heading', { name: '今回のご来店目的を伺えますか？' })).toBeVisible()
  await page.getByRole('button', { name: /メガネを新しく作りたい/ }).click()
  await expect(page.getByText('合計 約60分')).toBeVisible()
  await page.getByRole('button', { name: /かけ具合を調整したい/ }).click()
  await expect(page.getByText('合計 約90分')).toBeVisible()

  // 来店目的の確定後に、所要時間つきで受付可否を再検証する（UC-EYEX-013）。
  const [slotsRequest] = await Promise.all([
    page.waitForRequest((request) => request.url().includes('/availability/slots')),
    page.getByRole('button', { name: 'お客様情報へ進む' }).click(),
  ])
  expect(slotsRequest.url()).toContain(`date=${today}`)
  expect(slotsRequest.url()).toContain(`purposeIds=${examPurposeId},${adjustPurposeId}`)

  await expect(page.getByRole('heading', { name: 'お電話番号を伺えますか？' })).toBeVisible()
  await fillCustomer(page)

  // 復唱文には日時・店舗・来店目的・所要時間・氏名・電話番号が揃う（UC-EYEX-020 / AC-EYEX-06）。
  await expect(
    page.getByRole('heading', { name: /次の内容を、お客様へそのままお伝えください/ }),
  ).toBeVisible()
  const recital = page.getByText(/^「.*」$/)
  await expect(recital).toContainText('銀座店で')
  await expect(recital).toContainText('午前11時')
  await expect(recital).toContainText('視力測定とフィッティング')
  await expect(recital).toContainText('約90分')
  await expect(recital).toContainText('田中花子様')
  await expect(recital).toContainText('09012345678')

  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  await expect(page.getByRole('heading', { name: '予約を確定しました' })).toBeVisible()
  await expect(page.getByText('EY-2001')).toBeVisible()

  // 予約メモと店内引き継ぎ事項は別のフィールドとして送られる（UC-EYEX-016）。
  const created = recorded.find((entry) => entry.method === 'POST')
  if (!created) throw new Error('no reservation was posted')
  const payload = JSON.parse(created.body)
  expect(payload.reservationMemo).toBe('遠近両用を検討中')
  expect(payload.handoffNote).toBe('担当は鈴木を希望')
  expect(payload.purposeIds).toEqual([examPurposeId, adjustPurposeId])
})

// @e2e-covers UC-EYEX-006 UC-EYEX-011 UC-EYEX-014 UC-EYEX-017 UC-EYEX-019 AC-EYEX-08 AC-EYEX-88
test('keeps every entered value when the wished slot is lost, when going back, and when a switch is started', async ({
  page,
}) => {
  const today = jstToday()
  // 希望した 11:00 は提供されず、前後の枠だけが返る。
  await mockStaffApi(page, { offered: ['10:00', '10:30', '11:30', '12:00'] })
  await openHome(page)

  await page.getByRole('button', { name: '新しい予約を取る' }).click()
  await page.getByRole('button', { name: dayLabel(today) }).click()
  await page.getByRole('button', { name: '11:00', exact: true }).click()
  await page.getByRole('button', { name: /メガネを新しく作りたい/ }).click()
  await page.getByRole('button', { name: /かけ具合を調整したい/ }).click()
  await page.getByRole('button', { name: 'お客様情報へ進む' }).click()

  // 所要時間つきの再検証に落ちたら、入力を保持したまま代替時刻を出す（AC-EYEX-88 / UC-EYEX-014）。
  await expect(page.getByText('11:00は約90分の受付ができません')).toBeVisible()
  await expect(page.getByText(/入力内容は保持しています/)).toBeVisible()
  const alternatives = page.getByRole('group', { name: '代替時刻' }).getByRole('button')
  await expect(alternatives).toHaveText(['10:00', '10:30', '11:30'])
  await expect(page.getByRole('button', { name: /メガネを新しく作りたい/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // 前工程へ戻っても選択済みの日・時刻は失われない（UC-EYEX-011）。
  await page.getByRole('button', { name: '戻る' }).click()
  await expect(page.getByRole('button', { name: '11:00', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '戻る' }).click()
  await expect(page.getByRole('button', { name: dayLabel(today) })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: dayLabel(today) }).click()
  await expect(page.getByRole('button', { name: '11:00', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // 受け付けられる時刻を選び直して入力を続ける。
  await page.getByRole('button', { name: '11:30', exact: true }).click()
  // 来店目的の選択も戻り操作をまたいで残っている（UC-EYEX-011）。
  await expect(page.getByRole('button', { name: /かけ具合を調整したい/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
  await fillCustomer(page)

  // 破棄には必ず確認が入り、取り消せば入力は残る（UC-EYEX-017）。
  await page.getByRole('button', { name: '入力を破棄する' }).click()
  const dialog = page.getByRole('alertdialog', { name: '入力を破棄しますか？' })
  await expect(dialog).toContainText('日、時間、来店目的、お客様情報がすべて失われます。')
  await dialog.getByRole('button', { name: '入力に戻る' }).click()
  await expect(page.getByText(/^「.*」$/)).toContainText('田中花子様')

  // 確定直前の競合では予約を作らず、入力を保持して代替時間を提示する
  // （UC-EYEX-019 / AC-EYEX-08）。
  await page.route('**/api/staff/stores/*/reservations', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 409, json: { error: 'slot_unavailable' } })
      : route.fulfill({ json: [] }),
  )
  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  await expect(page.getByText('11:30は約90分の受付ができません')).toBeVisible()
  await expect(page.getByRole('heading', { name: '予約を確定しました' })).toHaveCount(0)
  await page.getByRole('group', { name: '代替時刻' }).getByRole('button', { name: '12:00' }).click()
  await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
  await expect(page.getByLabel('お名前', { exact: true })).toHaveValue('田中花子')
  await expect(page.getByLabel('予約メモ')).toHaveValue('遠近両用を検討中')

  // 権限のあるスタッフは、入力を失わずに店舗切替を始められる（UC-EYEX-006）。
  await page
    .getByRole('button', { name: /銀座店/ })
    .first()
    .click()
  const picker = page.getByRole('region', { name: '作業する店舗を切り替える' })
  await expect(picker.getByRole('button')).toHaveText([/銀座店\s*選択中/, /丸の内店\s*営業中/])
  await expect(picker).toContainText('他店舗の空き枠はここに表示しません。')
  // 切替候補を開いただけでは入力は失われない。
  await expect(page.getByLabel('お名前', { exact: true })).toHaveValue('田中花子')
  await expect(page.getByLabel('店内引き継ぎ事項')).toHaveValue('担当は鈴木を希望')
})

// @e2e-covers UC-EYEX-021 UC-EYEX-022 UC-EYEX-023 UC-EYEX-024 UC-EYEX-028 UC-EYEX-029 AC-EYEX-03 AC-EYEX-20 AC-EYEX-21 AC-EYEX-91
test('identifies the customer from a partial phone number without ever deciding for the staff', async ({
  page,
}) => {
  const recorded = await mockStaffApi(page, { customers: [hanako, taro] })
  await openHome(page)
  await reachCustomerStep(page)

  const panel = page.getByRole('heading', { name: 'お客様を探す' }).locator('..')
  await expect(panel).toBeVisible()

  // 全角・ハイフン混じりの部分入力でも正規化して検索する（UC-EYEX-021 / AC-EYEX-20）。
  await page.getByLabel('電話番号', { exact: true }).fill('０９０-1234')
  await page.getByRole('button', { name: '候補を探す' }).click()
  const phoneSearch = recorded.filter((entry) => entry.url.includes('/customers?'))
  await expect.poll(() => recorded.filter((e) => e.url.includes('/customers?')).length).toBe(1)
  expect(recorded.filter((e) => e.url.includes('/customers?'))[0]?.url).toContain('phone=0901234')
  expect(phoneSearch.length).toBeLessThanOrEqual(1)

  // 候補は氏名・かな・電話番号・主利用店舗・来店回数つきで並ぶ（AC-EYEX-03）。
  const options = page.getByRole('listbox', { name: '顧客候補' }).getByRole('option')
  await expect(options).toHaveCount(2)
  await expect(options.nth(0)).toContainText('田中花子')
  await expect(options.nth(0)).toContainText('タナカハナコ')
  await expect(options.nth(0)).toContainText('090-1234-5678')
  await expect(options.nth(0)).toContainText('主利用店舗 銀座店・来店4回')
  await expect(options.nth(1)).toContainText('主利用店舗 他店舗・来店1回')

  // 正規化後に同じ番号でも自動統合しない（UC-EYEX-028）。
  await expect(page.getByText('同じ電話番号の候補があります。統合はされません。')).toBeVisible()

  // 候補が出ただけでは確定しない（UC-EYEX-023 / AC-EYEX-21）。
  await expect(page.getByRole('region', { name: '選択中のお客様' })).toContainText(
    'お客様は未確定です',
  )
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false')

  // 氏名かなでも候補を探せる（UC-EYEX-022）。
  await page.getByLabel('電話番号', { exact: true }).fill('')
  await page.getByLabel('氏名かな').fill('タナカ')
  await page.getByRole('button', { name: '候補を探す' }).click()
  await expect
    .poll(() => recorded.filter((e) => e.url.includes('/customers?')).length)
    .toBeGreaterThan(1)
  const kanaSearch = recorded.filter((e) => e.url.includes('/customers?')).at(-1)
  expect(kanaSearch?.url).toContain('kana=%E3%82%BF%E3%83%8A%E3%82%AB')
  expect(kanaSearch?.url).not.toContain('phone=')

  // スタッフが自分で選んで初めて確定する（UC-EYEX-023）。
  await options.nth(0).click()
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: '選択中のお客様' })).toContainText('田中花子 様')

  // 権限が無い情報は、本文も件数も存在の標識も出さない（UC-EYEX-029 / AC-EYEX-91）。
  const selected = page.getByRole('region', { name: '選択中のお客様' })
  await expect(selected.getByRole('region', { name: '注意事項' })).toHaveCount(0)
  await expect(selected.getByRole('region', { name: '来店履歴' })).toHaveCount(0)
  await expect(selected.getByRole('region', { name: '過去の度数' })).toHaveCount(0)
  // ヘッダーの管理メニューは顧客情報とは無関係なので、判定は予約入力の本文だけで行う。
  await expect(
    page.getByRole('main').getByText(/注意事項|非表示|閲覧できません|件あります/),
  ).toHaveCount(0)

  // 該当が無ければ新規顧客として進める（UC-EYEX-024）。
  await page.getByRole('button', { name: '新しいお客様として進む' }).click()
  await expect(selected).toContainText('新規のお客様として進みます')
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false')
})

// @e2e-covers UC-EYEX-018 UC-EYEX-174 UC-EYEX-175 AC-EYEX-111
test('resends the failed reservation under the very same idempotency key and keeps the draft in memory only', async ({
  page,
}) => {
  const recorded = await mockStaffApi(page, { reservationStatuses: [503, 201] })
  await openHome(page)
  await reachCustomerStep(page)
  await fillCustomer(page)

  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()

  // 通信が落ちても入力は画面に残る（UC-EYEX-018）。
  await expect(
    page.getByText(
      '送信できませんでした。入力内容はそのまま残っています。もう一度お試しください。',
    ),
  ).toBeVisible()
  await expect(page.getByText(/^「.*」$/)).toContainText('田中花子様')

  // 再送は最初の試行と同じ冪等キーで送られる（UC-EYEX-174 / AC-EYEX-111）。
  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  await expect(page.getByRole('heading', { name: '予約を確定しました' })).toBeVisible()
  const posts = recorded.filter((entry) => entry.method === 'POST')
  expect(posts).toHaveLength(2)
  const keys = posts.map((entry) => entry.headers['idempotency-key'])
  expect(keys[0]).toBeTruthy()
  expect(keys[1]).toBe(keys[0])
  expect(posts[1]?.body).toBe(posts[0]?.body)

  // 入力は端末・店舗・受付セッションの中だけに存在する（UC-EYEX-175）。
  const stored = await page.evaluate(() => ({
    local: Object.entries({ ...localStorage }),
    session: Object.entries({ ...sessionStorage }),
  }))
  expect(stored.local).toEqual([])
  expect(stored.session).toEqual([])
  await page.reload()
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
  await expect(page.getByText('田中花子')).toHaveCount(0)
})

// @e2e-covers UC-EYEX-008 AC-EYEX-122 AC-EYEX-123 AC-EYEX-124 AC-EYEX-125
test('keeps staff screens operable by keyboard, at 200% text, with 44px targets and non-colour state', async ({
  page,
}) => {
  await mockStaffApi(page, { customers: [hanako] })
  await openHome(page)

  // 主要操作は 44×44 CSS px 以上（AC-EYEX-122）。
  const homeTargets = page.getByRole('navigation').getByRole('button')
  const homeCount = await homeTargets.count()
  expect(homeCount).toBeGreaterThan(10)
  for (let index = 0; index < homeCount; index += 1) {
    const box = await homeTargets.nth(index).boundingBox()
    if (!box) throw new Error('home target not measurable')
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
  }

  // 通常文字と背景は WCAG AA（4.5:1）以上（AC-EYEX-125）。
  for (const selector of [
    'h1',
    'nav[aria-label="主操作"] button',
    'nav[aria-label="副操作"] button',
  ]) {
    const ratio = await page.evaluate(contrastRatio, selector)
    expect(ratio ?? 0).toBeGreaterThanOrEqual(4.5)
  }

  // 論理順のフォーカス移動・可視フォーカス・Enter で実行（UC-EYEX-008 / AC-EYEX-123）。
  const order: string[] = []
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
    order.push(focused)
    if (focused.includes('新しい予約を取る')) break
  }
  expect(order.at(-1)).toContain('新しい予約を取る')
  expect(order[0]).toContain('銀座店')
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element)
    return { width: style.outlineWidth, style: style.outlineStyle }
  })
  expect(outline.style).not.toBe('none')
  expect(Number.parseFloat(outline.width)).toBeGreaterThan(0)
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.textContent ?? '')).toContain(
    '予約を変更する',
  )
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'ご来店予定の日を伺えますか？' })).toBeVisible()

  // Space でも同等に実行できる（AC-EYEX-123）。
  const todayChip = page.getByRole('button', { name: dayLabel(jstToday()) })
  await todayChip.focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('heading', { name: 'ご来店予定の時刻を伺えますか？' })).toBeVisible()

  // 状態は色だけで伝えない（AC-EYEX-125）: 工程は文字、選択は aria-pressed。
  const steps = page.getByRole('list', { name: '予約入力の工程' }).getByRole('listitem')
  await expect(steps.nth(0)).toContainText('完了')
  await expect(steps.nth(1)).toContainText('現在')
  await expect(steps.nth(2)).toContainText('未完了')
  await page.getByRole('button', { name: '11:00', exact: true }).click()
  await expect(page.getByRole('button', { name: /メガネを新しく作りたい/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  )

  // 文字表示 200% 相当（横向き iPad の半分の CSS ピクセル）でも内容と操作が欠けない（AC-EYEX-124）。
  await page.setViewportSize({ width: VIEWPORT.width / 2, height: VIEWPORT.height / 2 })
  await expect(page.getByRole('heading', { name: '今回のご来店目的を伺えますか？' })).toBeVisible()
  const purposeChip = page.getByRole('button', { name: /メガネを新しく作りたい/ })
  await purposeChip.scrollIntoViewIfNeeded()
  await purposeChip.click()
  await expect(purposeChip).toHaveAttribute('aria-pressed', 'true')
  const next = page.getByRole('button', { name: 'お客様情報へ進む' })
  await next.scrollIntoViewIfNeeded()
  await expect(next).toBeVisible()
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
})

/*
 * AC-EYEX-124 の追跡は 200% 拡大を直接確かめている上の 1 本が担う。ここは
 * 等倍の横向きでも脇の列が潰れないことを別途押さえる補助で、追跡の分母には
 * 数えない（1 つの AC に 2 本を対応させない）。
 */
test('横向きiPadの予約入力で、入力列も脇の情報列も読める幅を保つ', async ({ page }) => {
  // 脇の列が縮むと「お客様を探す」が 1 文字ずつ縦に折り返り、顧客情報が
  // 事実上読めなくなる。文字が欠けないことは幅で確かめるしかない。
  await mockStaffApi(page, { customers: [hanako, taro] })
  await openHome(page)
  await reachCustomerStep(page)

  const rail = page.getByRole('complementary').filter({ hasText: 'お客様の特定' })
  const railBox = await rail.boundingBox()
  expect(railBox?.width ?? 0).toBeGreaterThanOrEqual(280)

  const input = page.getByLabel('お電話番号')
  const inputBox = await input.boundingBox()
  expect(inputBox?.width ?? 0).toBeGreaterThanOrEqual(280)

  // 横スクロールを起こさずに収まっている。
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
