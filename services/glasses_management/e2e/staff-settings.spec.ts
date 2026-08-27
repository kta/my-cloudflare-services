import { expect, type Page, test } from '@playwright/test'

/*
 * EYEX スタッフ端末の「店舗設定ガイド」と「共有iPad（端末とセキュリティ）」の E2E。
 *
 * どちらもヘッダーの管理メニュー（店舗設定 / 共有端末）から開く。API は
 * すべて `page.route` で差し替え、SPA だけを実行する。
 *
 * 共有 iPad（横向き 1180×820）が既定の前提なので viewport をそれに合わせ、
 * SP 幅の主張だけ 375px に切り替える。
 */

const VIEWPORT = { width: 1180, height: 820 }
const SP_VIEWPORT = { width: 375, height: 812 }

const ginzaId = '11111111-1111-4111-8111-111111111111'
const marunouchiId = '22222222-2222-4222-8222-222222222222'

const examPurposeId = '33333333-3333-4333-8333-333333333333'
const adjustPurposeId = '44444444-4444-4444-8444-444444444444'
const staffId = '55555555-5555-4555-8555-555555555555'
const shiftId = '66666666-6666-4666-8666-666666666666'
const equipmentId = '77777777-7777-4777-8777-777777777777'
const maintenanceId = '88888888-8888-4888-8888-888888888888'
const terminalId = '99999999-9999-4999-8999-999999999999'
const secondTerminalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/** 40 文字以上（`SharedTerminalIssue` の下限）で、DOM から探しやすい形にする。 */
const ISSUED_TOKEN = 'eyex-shared-terminal-token-0123456789abcdefghij'

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

type Settings = {
  storeId: string
  version: number
  receptionStatus: 'open' | 'paused'
  businessHours: { dayOfWeek: number; periods: { startTime: string; endTime: string }[] }[]
  exceptions: {
    date: string
    mode: 'closed' | 'open' | 'paused'
    periods: { startTime: string; endTime: string }[]
    reason?: string
  }[]
  purposes: {
    id: string
    staffName: string
    customerLabel: string
    durationMinutes: number
    slotIntervalMinutes: number
    isPublic: boolean
    requiredSkills: string[]
    requiredEquipment: string[]
    maxConcurrent: number
  }[]
  staff: { id: string; name: string; skills: string[]; canBook: boolean; isActive: boolean }[]
  shifts: {
    id: string
    staffId: string
    date: string
    startTime: string
    endTime: string
    breaks: { startTime: string; endTime: string }[]
  }[]
  equipment: {
    id: string
    name: string
    capacity: number
    isActive: boolean
    availablePeriods: { startTime: string; endTime: string }[]
  }[]
  maintenance: {
    id: string
    equipmentId: string
    date: string
    startTime: string
    endTime: string
    reason: string
  }[]
}

/**
 * 既存予約・履歴に紐づく行（shifts / maintenance / exceptions）を必ず含む設定。
 * 保存時にそれらが落ちないことを主張するための土台でもある（UC-EYEX-122, AC-EYEX-70）。
 */
function settingsFixture(overrides: Partial<Settings> = {}): Settings {
  return {
    storeId: ginzaId,
    version: 3,
    receptionStatus: 'open',
    businessHours: [
      { dayOfWeek: 0, periods: [{ startTime: '10:00', endTime: '18:00' }] },
      { dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] },
      { dayOfWeek: 2, periods: [] },
      { dayOfWeek: 3, periods: [{ startTime: '10:00', endTime: '19:00' }] },
      { dayOfWeek: 4, periods: [{ startTime: '10:00', endTime: '19:00' }] },
      { dayOfWeek: 5, periods: [{ startTime: '10:00', endTime: '19:00' }] },
      { dayOfWeek: 6, periods: [{ startTime: '10:00', endTime: '19:00' }] },
    ],
    exceptions: [{ date: '2026-09-23', mode: 'closed', periods: [], reason: '棚卸し' }],
    purposes: [
      {
        id: examPurposeId,
        staffName: '視力測定',
        customerLabel: 'メガネを新しく作りたい',
        durationMinutes: 60,
        slotIntervalMinutes: 30,
        isPublic: true,
        requiredSkills: ['眼鏡作製技能'],
        requiredEquipment: ['視力測定機'],
        maxConcurrent: 1,
      },
      {
        id: adjustPurposeId,
        staffName: 'フィッティング調整',
        customerLabel: 'かけ心地を調整したい',
        durationMinutes: 20,
        slotIntervalMinutes: 10,
        isPublic: true,
        requiredSkills: ['調整'],
        requiredEquipment: ['調整台'],
        maxConcurrent: 2,
      },
    ],
    staff: [
      { id: staffId, name: '山田検査員', skills: ['眼鏡作製技能'], canBook: true, isActive: true },
    ],
    shifts: [
      {
        id: shiftId,
        staffId,
        date: '2026-08-27',
        startTime: '10:00',
        endTime: '19:00',
        breaks: [{ startTime: '13:00', endTime: '14:00' }],
      },
    ],
    equipment: [
      {
        id: equipmentId,
        name: '視力測定機',
        capacity: 2,
        isActive: true,
        availablePeriods: [{ startTime: '10:00', endTime: '19:00' }],
      },
    ],
    maintenance: [
      {
        id: maintenanceId,
        equipmentId,
        date: '2026-09-01',
        startTime: '09:00',
        endTime: '10:00',
        reason: '定期点検',
      },
    ],
    ...overrides,
  }
}

function sharedTerminal(overrides: Record<string, unknown> = {}) {
  return {
    id: terminalId,
    organizationId: 'org-eyex',
    storeId: ginzaId,
    name: '受付カウンターiPad',
    status: 'active',
    idleTimeoutSeconds: 300,
    expiresAt: '2026-12-01T00:00:00.000Z',
    lastSeenAt: '2026-08-27T02:58:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    revokedAt: null,
    ...overrides,
  }
}

const ALL_SETTINGS_PERMISSIONS = [
  'store.read',
  'reservation.read',
  'settings.read',
  'settings.manage',
]

type SettingsMock = {
  permissions: string[]
  settings: Settings
  /** 保存要求ごとの本文。保存が何も落としていないことを後から主張する。 */
  savedBodies: unknown[]
}

/** スタッフ API をすべて差し替える。戻り値の mutable な状態でテストごとに振る舞いを変える。 */
async function mockSettingsApi(page: Page, initial?: Partial<SettingsMock>): Promise<SettingsMock> {
  const state: SettingsMock = {
    permissions: [...ALL_SETTINGS_PERMISSIONS],
    settings: settingsFixture(),
    savedBodies: [],
    ...initial,
  }
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ json: { token: 'staff-e2e' } }),
  )
  await page.route('**/api/staff/stores', (route) => route.fulfill({ json: stores }))
  await page.route('**/api/staff/store-switches', (route) =>
    route.fulfill({ status: 201, json: {} }),
  )
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({ json: state.permissions }),
  )
  await page.route('**/api/staff/stores/*/availability/settings', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fulfill({ json: state.settings })
      return
    }
    const body = route.request().postDataJSON() as Record<string, unknown>
    state.savedBodies.push(body)
    // Worker と同じく storeId を戻す。SPA は返却値を新しい下書きとして採用する。
    await route.fulfill({ json: { ...body, storeId: ginzaId } })
  })
  return state
}

/** ホーム → ヘッダーの管理メニュー「店舗設定」。 */
async function openSettings(page: Page, viewport = VIEWPORT) {
  await page.setViewportSize(viewport)
  await page.goto('/')
  await page
    .getByRole('navigation', { name: '管理メニュー' })
    .getByRole('button', { name: '店舗設定' })
    .click()
  const screen = page.getByRole('region', { name: '店舗設定' })
  await expect(screen).toBeVisible()
  return screen
}

function stepRail(page: Page) {
  return page.getByRole('navigation', { name: '設定工程' })
}

async function goToStep(page: Page, pattern: RegExp) {
  await stepRail(page).getByRole('button', { name: pattern }).click()
}

// @e2e-covers AC-EYEX-40 AC-EYEX-41 AC-EYEX-47
test('設定ガイドは6工程を決まった順で並べ、状態を語で示し、任意の工程へ直接移動できる', async ({
  page,
}) => {
  await mockSettingsApi(page)
  const screen = await openSettings(page)
  await expect(screen.getByRole('heading', { name: '銀座店 · 設定ガイド' })).toBeVisible()

  // AC-EYEX-40: 店舗と営業時間 → 来店目的 → スタッフと技能 → 設備と点検 → Web予約 → 影響確認と公開。
  const steps = stepRail(page).getByRole('button')
  await expect(steps).toHaveCount(6)
  const names = await steps.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''),
  )
  expect(names.map((name) => name.split(' ')[1])).toEqual([
    '店舗と営業時間',
    '来店目的',
    'スタッフと技能',
    '設備と点検',
    'Web予約',
    '影響確認と公開',
  ])
  expect(names.map((name) => name.split(' ')[0])).toEqual([
    '工程1',
    '工程2',
    '工程3',
    '工程4',
    '工程5',
    '工程6',
  ])

  // AC-EYEX-41: 完了 / 編集中 / 未完了 は色ではなく語で、工程一覧の位置に出る。
  expect(names.map((name) => name.split(' ')[2])).toEqual([
    '編集中',
    '完了',
    '完了',
    '完了',
    '未完了',
    '未完了',
  ])
  const rail = stepRail(page)
  await expect(rail).toContainText('編集中')
  await expect(rail).toContainText('完了')
  await expect(rail).toContainText('未完了')
  await expect(steps.first()).toHaveAttribute('aria-current', 'step')

  // AC-EYEX-47: ガイドを頭から進めず、工程4へ直接飛べる。
  await goToStep(page, /^工程4 設備と点検/)
  await expect(screen.getByRole('heading', { name: '設備と点検', level: 2 })).toBeVisible()
  await expect(screen.getByRole('region', { name: '設備' })).toBeVisible()
  await expect(steps.nth(3)).toHaveAttribute('aria-current', 'step')
  await expect(steps.first()).not.toHaveAttribute('aria-current', 'step')

  // 直接飛んだ先からさらに工程2へ戻れる（順路に縛られない）。
  await goToStep(page, /^工程2 来店目的/)
  await expect(screen.getByRole('heading', { name: '来店目的', level: 2 })).toBeVisible()
})

// @e2e-covers AC-EYEX-72 AC-EYEX-73 AC-EYEX-74
test('SP幅では6工程がヘッダー直下に固定表示され、横スクロールなしで現在位置と残り工程が読める', async ({
  page,
}) => {
  await mockSettingsApi(page)
  const screen = await openSettings(page, SP_VIEWPORT)
  const rail = stepRail(page)

  // AC-EYEX-72: 6工程すべてがヘッダー直下に固定表示される。
  const steps = rail.getByRole('button')
  await expect(steps).toHaveCount(6)
  for (let index = 0; index < 6; index += 1) await expect(steps.nth(index)).toBeVisible()
  await expect(rail).toHaveCSS('position', 'sticky')

  // AC-EYEX-72: 横スクロールを必要としない。
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)

  // AC-EYEX-73: 現在工程番号 / 全6工程 / 残り工程数 / 状態が色に依らず読める。
  await expect(rail).toContainText('1 / 6 店舗と営業時間')
  await expect(rail).toContainText('残り5工程')
  await expect(rail).toContainText('現在の状態: 編集中')
  await goToStep(page, /^工程3 スタッフと技能/)
  await expect(rail).toContainText('3 / 6 スタッフと技能')
  await expect(rail).toContainText('残り3工程')

  // AC-EYEX-74: 5番目は SP 幅でも `Web予約`。略語の `Web` は出さない。
  await goToStep(page, /^工程5 Web予約/)
  await expect(screen.getByRole('heading', { name: 'Web予約', level: 2 })).toBeVisible()
  await expect(rail.getByText('Web予約', { exact: true }).first()).toBeVisible()
  await expect(rail.getByText('Web', { exact: true })).toHaveCount(0)
  const overflowAtWebStep = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
  expect(overflowAtWebStep).toBe(true)
})

// @e2e-covers UC-EYEX-087 UC-EYEX-116 AC-EYEX-65
test('営業時間・臨時営業・受付停止を設定でき、受付停止は新規Web予約だけを止めると読める', async ({
  page,
}) => {
  const state = await mockSettingsApi(page)
  const screen = await openSettings(page)
  const hours = screen.getByRole('region', { name: '営業時間' })

  // UC-EYEX-087: 通常営業時間。火曜は休業日として保持されている。
  await expect(hours.getByLabel('月曜を営業日にする')).toBeChecked()
  await expect(hours.getByLabel('火曜を営業日にする')).not.toBeChecked()
  await expect(hours.getByLabel('月曜の営業開始')).toHaveValue('10:00')
  await hours.getByLabel('月曜の営業開始').fill('11:00')
  await hours.getByLabel('火曜を営業日にする').check()
  await expect(hours.getByLabel('火曜の営業開始')).toHaveValue('10:00')

  // UC-EYEX-087: 臨時営業・休業日。既存の休業日に臨時営業を足せる。
  const exceptions = screen.getByRole('region', { name: '臨時営業・休業日' })
  await expect(exceptions.getByRole('list', { name: '臨時営業・休業日' })).toContainText(
    '2026-09-23',
  )
  await expect(exceptions.getByRole('list', { name: '臨時営業・休業日' })).toContainText('休業')
  await exceptions.getByLabel('日付').fill('2026-10-12')
  await exceptions.getByLabel('区分').selectOption('open')
  await exceptions.getByLabel('理由').fill('祝日営業')
  await exceptions.getByRole('button', { name: '臨時設定を追加' }).click()
  const exceptionRows = exceptions
    .getByRole('list', { name: '臨時営業・休業日' })
    .getByRole('listitem')
  await expect(exceptionRows).toHaveCount(2)
  await expect(exceptionRows.nth(1)).toContainText('2026-10-12')
  await expect(exceptionRows.nth(1)).toContainText('臨時営業')
  await expect(exceptionRows.nth(1)).toContainText('10:00–17:00')

  // UC-EYEX-087 / AC-EYEX-65 / UC-EYEX-116: 受付停止と、その効き目の説明。
  const reception = screen.getByRole('region', { name: '受付停止' })
  await expect(reception).toContainText(
    '受付停止は新しいWeb予約だけを止めます。既存予約は取り消されません。',
  )
  await reception.getByLabel('受付状態').selectOption('paused')

  await screen.getByRole('button', { name: '設定を保存' }).click()
  await expect(screen.getByText('設定を保存しました。')).toBeVisible()

  const saved = state.savedBodies.at(-1) as Settings
  expect(saved.receptionStatus).toBe('paused')
  expect(saved.businessHours.find((day) => day.dayOfWeek === 1)?.periods[0]?.startTime).toBe(
    '11:00',
  )
  expect(saved.exceptions).toHaveLength(2)
  // UC-EYEX-116: 受付停止しても既存の予約資源（勤務・点検）は一件も消えない。
  expect(saved.shifts).toHaveLength(1)
  expect(saved.maintenance).toHaveLength(1)
})

// @e2e-covers UC-EYEX-088 UC-EYEX-089 UC-EYEX-117 UC-EYEX-118 UC-EYEX-119 AC-EYEX-42 AC-EYEX-67 AC-EYEX-68
test('新規店舗は標準テンプレートから来店目的を作り、顧客向け文言と所要時間の変更が同じ画面のWeb予約プレビューへ反映される', async ({
  page,
}) => {
  await mockSettingsApi(page, { settings: settingsFixture({ purposes: [] }) })
  const screen = await openSettings(page)
  await goToStep(page, /^工程2 来店目的/)

  // UC-EYEX-117 / AC-EYEX-68: 名称・文言・所要時間・必要技能・設備・Web公開初期値が並ぶ。
  const template = screen.getByRole('region', { name: '標準テンプレート' })
  await expect(template).toContainText('視力測定・新調相談')
  await expect(template).toContainText('メガネを新しく作りたい')
  await expect(template).toContainText('60分 · 15分単位 · 同時1件')
  await expect(template).toContainText('技能: 眼鏡作製技能')
  await expect(template).toContainText('設備: 視力測定機、相談席')
  await expect(template).toContainText('Web公開')
  await expect(template).toContainText('Web非公開')

  await template.getByRole('button', { name: '標準テンプレートを読み込む' }).click()
  const purposeList = screen.getByRole('region', { name: '来店目的' })
  await expect(purposeList.getByRole('button')).toHaveCount(4)

  // UC-EYEX-118: スタッフ向け名称と顧客向け表示名は別々の入力。
  const editor = screen.getByRole('region', { name: '来店目的の設定' })
  const preview = screen.getByRole('region', { name: 'Web予約プレビュー' })
  await expect(editor.getByLabel('スタッフ向け名称')).toHaveValue('視力測定・新調相談')
  await expect(editor.getByLabel('顧客向け表示名')).toHaveValue('メガネを新しく作りたい')
  await editor.getByLabel('スタッフ向け名称').fill('視力測定（新規）')
  await expect(purposeList.getByRole('button', { name: '視力測定（新規）' })).toBeVisible()
  await expect(preview).toContainText('メガネを新しく作りたい')
  await expect(preview).not.toContainText('視力測定（新規）')

  // AC-EYEX-42 / AC-EYEX-67: 顧客向け文言と所要時間の編集が同じ画面のプレビューへ効く。
  await editor.getByLabel('顧客向け表示名').fill('新しいメガネを相談したい')
  await expect(preview).toContainText('新しいメガネを相談したい')
  await editor.getByLabel('標準所要時間（分）').fill('45')
  await expect(preview).toContainText('約45分')
  await expect(preview).toContainText('この目的はWeb予約の選択肢に表示されます。')

  // UC-EYEX-088: 受付可否（Web予約への公開）も同じ編集面から切り替わり、プレビューが変わる。
  await editor.getByLabel('Web予約に公開する').uncheck()
  await expect(preview).toContainText('この目的はWeb予約の選択肢に表示されません。')

  // UC-EYEX-089 / UC-EYEX-119: 時間調整単位・同時受付数・必要技能・必要設備。
  await editor.getByLabel('時間調整単位（分）').fill('20')
  await editor.getByLabel('同時受付数').fill('3')
  await editor.getByLabel('必要技能').fill('眼鏡作製技能, 検査')
  await editor.getByLabel('必要設備').fill('視力測定機, 相談席')
  await expect(editor.getByLabel('必要技能')).toHaveValue('眼鏡作製技能, 検査')
  await expect(editor.getByLabel('必要設備')).toHaveValue('視力測定機, 相談席')
  await expect(editor.getByLabel('同時受付数')).toHaveValue('3')
  await expect(editor.getByLabel('時間調整単位（分）')).toHaveValue('20')
})

// @e2e-covers UC-EYEX-090 UC-EYEX-091
test('スタッフの技能・勤務・休憩・受付可否と、設備の台数・利用可能時間・点検停止を設定できる', async ({
  page,
}) => {
  const state = await mockSettingsApi(page)
  const screen = await openSettings(page)

  // UC-EYEX-090
  await goToStep(page, /^工程3 スタッフと技能/)
  const staff = screen.getByRole('region', { name: 'スタッフ' })
  await expect(staff).toContainText('山田検査員')
  await expect(staff.getByLabel('山田検査員は予約を受け付ける')).toBeChecked()
  await staff.getByLabel('山田検査員の技能').fill('眼鏡作製技能, 調整')
  await staff.getByLabel('山田検査員の勤務開始').fill('09:30')
  await staff.getByLabel('山田検査員の勤務終了').fill('18:30')
  await staff.getByLabel('山田検査員の休憩開始').fill('12:30')
  await staff.getByLabel('山田検査員の休憩終了').fill('13:30')
  await staff.getByLabel('山田検査員は予約を受け付ける').uncheck()

  // UC-EYEX-091
  await goToStep(page, /^工程4 設備と点検/)
  const equipment = screen.getByRole('region', { name: '設備' })
  await equipment.getByLabel('視力測定機の台数').fill('3')
  await equipment.getByLabel('視力測定機の利用可能開始').fill('11:00')
  await equipment.getByLabel('視力測定機の利用可能終了').fill('18:00')
  const maintenance = screen.getByRole('region', { name: '点検停止' })
  await expect(maintenance.getByRole('list', { name: '点検停止' })).toContainText('視力測定機')
  await expect(maintenance.getByRole('list', { name: '点検停止' })).toContainText('2026-09-01')
  await expect(maintenance.getByRole('list', { name: '点検停止' })).toContainText('09:00–10:00')
  await expect(maintenance.getByRole('list', { name: '点検停止' })).toContainText('定期点検')

  await screen.getByRole('button', { name: '設定を保存' }).click()
  await expect(screen.getByText('設定を保存しました。')).toBeVisible()
  const saved = state.savedBodies.at(-1) as Settings
  expect(saved.staff[0]?.skills).toEqual(['眼鏡作製技能', '調整'])
  expect(saved.staff[0]?.canBook).toBe(false)
  expect(saved.shifts[0]).toMatchObject({
    startTime: '09:30',
    endTime: '18:30',
    breaks: [{ startTime: '12:30', endTime: '13:30' }],
  })
  expect(saved.equipment[0]).toMatchObject({
    capacity: 3,
    availablePeriods: [{ startTime: '11:00', endTime: '18:00' }],
  })
  expect(saved.maintenance).toHaveLength(1)
})

// @e2e-covers UC-EYEX-122 AC-EYEX-70
test('来店目的を非公開にしても既存予約と履歴は削除されず、保存要求は何も落とさない', async ({
  page,
}) => {
  const state = await mockSettingsApi(page)
  const screen = await openSettings(page)
  await goToStep(page, /^工程2 来店目的/)

  const editor = screen.getByRole('region', { name: '来店目的の設定' })
  await expect(editor.getByLabel('Web予約に公開する')).toBeChecked()
  await expect(editor).toContainText(
    '非公開にすると新規の選択肢から外れます。既存予約と履歴は削除されません。',
  )
  await editor.getByLabel('Web予約に公開する').uncheck()
  await expect(screen.getByRole('region', { name: 'Web予約プレビュー' })).toContainText(
    'この目的はWeb予約の選択肢に表示されません。',
  )

  await screen.getByRole('button', { name: '設定を保存' }).click()
  await expect(screen.getByText('設定を保存しました。')).toBeVisible()

  const saved = state.savedBodies.at(-1) as Settings
  // 非公開になるのはこの目的だけ。目的そのものは残る。
  expect(saved.purposes.map((purpose) => purpose.id)).toEqual([examPurposeId, adjustPurposeId])
  expect(saved.purposes[0]?.isPublic).toBe(false)
  expect(saved.purposes[1]?.isPublic).toBe(true)
  // 既存予約・履歴に紐づく行は一件も削られていない。
  expect(saved.shifts).toHaveLength(1)
  expect(saved.maintenance).toHaveLength(1)
  expect(saved.exceptions).toHaveLength(1)
  expect(saved.staff).toHaveLength(1)
  expect(saved.equipment).toHaveLength(1)

  // 非公開のあとも来店目的の一覧から消えない。
  await expect(screen.getByRole('region', { name: '来店目的' }).getByRole('button')).toHaveCount(2)
})

// @e2e-covers UC-EYEX-109 UC-EYEX-110 UC-EYEX-111 UC-EYEX-112 UC-EYEX-113 UC-EYEX-114 AC-EYEX-63 AC-EYEX-71
test('Web予約工程は公開状態から期限後の案内までを一覧し、未取得の値を推測せず店舗ページをプレビューする', async ({
  page,
}) => {
  await mockSettingsApi(page)
  const screen = await openSettings(page)
  await goToStep(page, /^工程5 Web予約/)

  // AC-EYEX-63 / UC-EYEX-109〜113: 公開状態、公開期間、公開する来店目的、受付時間、
  // 予約可能日数、直前受付期限、変更・取消期限、期限後の案内が一枚に並ぶ。
  const panel = screen.getByRole('region', { name: 'Web予約設定' })
  for (const term of [
    '公開状態',
    '公開期間',
    '公開する来店目的',
    '受付時間',
    '予約可能日数',
    '直前受付期限',
    '変更・取消期限',
    '期限後の案内',
  ]) {
    await expect(panel).toContainText(term)
  }
  // UC-EYEX-112: 受付曜日と時間帯は営業時間から実際に導出される（火曜は休業日）。
  await expect(panel).toContainText('月 10:00–19:00')
  await expect(panel).toContainText('火 休業日')
  // 公開状態・公開期間・公開する来店目的・日数・期限は API 未提供なので推測せず 未取得。
  await expect(panel).toContainText('未取得')
  await expect(panel).toContainText('Web予約の公開設定はまだ取得できていません。')
  await expect(panel).toContainText(
    '受付停止は新しいWeb予約だけを止めます。既存予約は取り消されません。',
  )

  // UC-EYEX-114 / AC-EYEX-71: 同じ画面で顧客向けページをプレビューする。
  const preview = screen.getByRole('region', { name: '店舗ページプレビュー' })
  await expect(preview).toContainText('店舗名')
  await expect(preview).toContainText('銀座店')
  await expect(preview).toContainText('アクセス')
  await expect(preview).toContainText('電話番号')
  await expect(preview).toContainText('注意事項')
})

// @e2e-covers UC-EYEX-098
test('settings.read がなければ設定は何も見えず、settings.manage がなければ編集手段が出ない', async ({
  page,
}) => {
  const state = await mockSettingsApi(page, { permissions: ['store.read'] })

  // 閲覧権限なし: 中身も、その存在も出さない。
  let screen = await openSettings(page)
  await expect(screen).toContainText('設定を閲覧する権限がありません。')
  await expect(stepRail(page)).toHaveCount(0)
  await expect(screen.getByRole('region', { name: '営業時間' })).toHaveCount(0)
  await expect(screen.getByRole('button', { name: '設定を保存' })).toHaveCount(0)

  // 閲覧のみ: 値は読めるが、編集手段は提供されない。
  state.permissions = ['store.read', 'settings.read']
  screen = await openSettings(page)
  await expect(screen.getByRole('region', { name: '営業時間' })).toContainText('10:00–19:00')
  await expect(screen).toContainText('設定を変更する権限がありません。')
  await expect(screen.getByRole('button', { name: '設定を保存' })).toHaveCount(0)
  await expect(screen.getByLabel('月曜を営業日にする')).toHaveCount(0)
  await expect(screen.getByLabel('受付状態')).toHaveCount(0)
  await goToStep(page, /^工程2 来店目的/)
  await expect(screen.getByLabel('顧客向け表示名')).toHaveCount(0)
  await expect(screen.getByRole('region', { name: '来店目的の設定' })).toContainText('視力測定')
  expect(state.savedBodies).toHaveLength(0)
})

/** ホーム → ヘッダーの管理メニュー「共有端末」。 */
async function openSharedTerminals(page: Page) {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')
  await page
    .getByRole('navigation', { name: '管理メニュー' })
    .getByRole('button', { name: '共有端末' })
    .click()
  await expect(page.getByRole('heading', { name: '共有iPad', level: 2 })).toBeVisible()
}

type TerminalMock = { terminals: Record<string, unknown>[]; createAuth: string[] }

async function mockSharedTerminalApi(page: Page, terminals: Record<string, unknown>[]) {
  const state: TerminalMock = { terminals, createAuth: [] }
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ json: { token: 'staff-e2e' } }),
  )
  await page.route('**/api/staff/stores', (route) => route.fulfill({ json: stores }))
  await page.route('**/api/staff/store-switches', (route) =>
    route.fulfill({ status: 201, json: {} }),
  )
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({ json: [...ALL_SETTINGS_PERMISSIONS] }),
  )
  await page.route('**/api/staff/stores/*/shared-terminals', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ json: state.terminals })
      return
    }
    state.createAuth.push(route.request().headers().authorization ?? '')
    const body = route.request().postDataJSON() as { name: string }
    const terminal = sharedTerminal({ id: secondTerminalId, name: body.name, lastSeenAt: null })
    await route.fulfill({ status: 201, json: { terminal, token: ISSUED_TOKEN } })
  })
  await page.route('**/api/staff/stores/*/shared-terminals/*/revoke', async (route) => {
    const [existing] = state.terminals
    await route.fulfill({
      json: { ...existing, status: 'revoked', revokedAt: '2026-08-27T03:00:00.000Z' },
    })
  })
  return state
}

// @e2e-covers UC-EYEX-131 AC-EYEX-80 AC-EYEX-112
test('共有iPadの登録トークンは一度だけ警告付きで表示され、端末側には一切残らない', async ({
  page,
}) => {
  const state = await mockSharedTerminalApi(page, [])
  await openSharedTerminals(page)
  await expect(page.getByText('登録された共有iPadはまだありません。')).toBeVisible()

  // UC-EYEX-131: 端末名を付けて登録する。名前は必須。
  await page.getByRole('button', { name: '共有iPadを登録' }).click()
  await expect(page.getByText('端末名を入力してください。')).toBeVisible()
  await page.getByLabel('端末名').fill('検査室iPad')
  await page.getByRole('button', { name: '共有iPadを登録' }).click()

  const issued = page.getByRole('dialog', { name: '検査室iPadを登録しました' })
  await expect(issued).toBeVisible()
  await expect(issued).toContainText(
    'このトークンは今だけ表示されます。画面を閉じると二度と表示できません。端末に入力してから閉じてください。',
  )
  await expect(issued).toContainText(ISSUED_TOKEN)

  // AC-EYEX-80: 発行という操作の主体は端末ではなく、個人ログインで得た個人アカウント。
  expect(state.createAuth).toEqual(['Bearer staff-e2e'])

  // AC-EYEX-112: 端末保持分を作らない。トークンは storage のどこにも書かない。
  const stored = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }))
  expect(stored.local).toEqual([])
  expect(stored.session).toEqual([])

  // 閉じたら破棄され、再表示できない。
  await issued.getByRole('button', { name: '控えたので閉じる' }).click()
  await expect(issued).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(ISSUED_TOKEN)
  await expect(page.getByRole('cell', { name: '検査室iPad' })).toBeVisible()
  const afterClose = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }))
  expect(afterClose.local).toEqual([])
  expect(afterClose.session).toEqual([])
})

// @e2e-covers UC-EYEX-136 UC-EYEX-150 AC-EYEX-83 AC-EYEX-96
test('共有iPad一覧は端末名・店舗・最終通信・状態を示し、失効は結果を説明する確認を経てから送信される', async ({
  page,
}) => {
  const state = await mockSharedTerminalApi(page, [sharedTerminal()])
  let revokeRequests = 0
  page.on('request', (request) => {
    if (request.url().includes('/revoke')) revokeRequests += 1
  })
  await openSharedTerminals(page)

  // UC-EYEX-150 / AC-EYEX-96: 端末名、店舗、最終通信、状態。
  const row = page.getByRole('row').filter({ hasText: '受付カウンターiPad' })
  await expect(row).toContainText('銀座店')
  await expect(row).toContainText('2026年8月27日 11:58')
  await expect(row).toContainText('利用中')

  // AC-EYEX-83 / UC-EYEX-136: 失効は確認を挟み、その前に要求は飛ばない。
  await row.getByRole('button', { name: '失効' }).click()
  const confirm = page.getByRole('alertdialog', { name: '受付カウンターiPadを失効しますか？' })
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText(
    '失効するとこの端末は次の通信で顧客情報と業務画面へアクセスできなくなります。',
  )
  // 失効の結果そのもの（次の通信で再登録画面だけを出す）は端末側の
  // staff-recording.spec.ts が AC-EYEX-98 として担う。ここでは失効を送る側が
  // その結果を事前に説明することだけを確かめる。
  await expect(confirm).toContainText(
    '端末に残っている未送信の操作は実行されません。再び使うには登録し直します。',
  )
  expect(revokeRequests).toBe(0)

  // やめれば何も起きない。
  await confirm.getByRole('button', { name: 'やめる' }).click()
  await expect(confirm).toHaveCount(0)
  expect(revokeRequests).toBe(0)
  await expect(row).toContainText('利用中')

  // 確認したうえで失効する。
  await row.getByRole('button', { name: '失効' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '失効する' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(row).toContainText('失効済み')
  await expect(row.getByRole('button', { name: '失効' })).toHaveCount(0)
  expect(revokeRequests).toBe(1)
  expect(state.terminals).toHaveLength(1)
})

// @e2e-covers UC-EYEX-132 UC-EYEX-152 AC-EYEX-82
test('日常業務はPINを求めず、管理操作は本人確認を要求して実行せず、無操作ロックは推測しない', async ({
  page,
}) => {
  await mockSharedTerminalApi(page, [sharedTerminal()])

  // UC-EYEX-132: 共有端末での日常業務（ホーム → 予約台帳 → 共有端末）はスタッフ選択も
  // PIN 入力も求めない。
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /PIN/ })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page
    .getByRole('navigation', { name: '管理メニュー' })
    .getByRole('button', { name: '店舗設定' })
    .click()
  await expect(page.getByRole('region', { name: '店舗設定' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /PIN/ })).toHaveCount(0)
  await page
    .getByRole('navigation', { name: '管理メニュー' })
    .getByRole('button', { name: '共有端末' })
    .click()
  await expect(page.getByRole('heading', { name: '共有iPad', level: 2 })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /PIN/ })).toHaveCount(0)

  // AC-EYEX-82: 管理操作は個人PINまたは個人ログインを要求し、この場では実行しない。
  const pin = page.getByRole('region', { name: '個人PIN' })
  await expect(pin).toContainText('個人モードの切替と管理再認証に使う4〜6桁のPINです。')
  await pin.getByRole('button', { name: '個人PINを設定・変更' }).click()
  await expect(pin).toContainText(
    '個人PINの設定と変更は本人のみが行えます。この操作は管理コンソールで行います。',
  )
  await pin.getByRole('button', { name: '個人PINの再設定を開始' }).click()
  await expect(pin).toContainText(
    '本人確認後にPIN再設定を開始できます。PINそのものは管理者にも表示されません。この操作は管理コンソールで行います。',
  )

  // UC-EYEX-152: 無操作ロック時間はこの画面の管轄外。既定値を推測せず 未取得 と言う。
  const idle = page.getByRole('region', { name: '無操作ロック' })
  await expect(idle).toContainText('未取得')
  await expect(idle).toContainText(
    '無操作ロック時間はこの画面から取得できません。確認と変更はこの操作は管理コンソールで行います。',
  )
})
