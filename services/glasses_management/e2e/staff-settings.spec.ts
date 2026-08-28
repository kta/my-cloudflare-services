import { expect, type Page, test } from '@playwright/test'
import { choosePickerOption } from './picker'

/*
 * EYEX スタッフ端末の「店舗設定ガイド」と「共有iPad（端末とセキュリティ）」の E2E。
 *
 * どちらも緑帯の「設定」から入り、共有端末は左サイドバー（画面の一覧）で開く。API は
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

/** 全画面共通の左サイドバー。面の行き来はここ 1 本に集約された。 */
function sidebar(page: Page) {
  return page.getByRole('navigation', { name: '画面の一覧' })
}

/**
 * ホーム → 緑帯の「設定」で設定ガイドの面に入る。緑帯は 1 本でタブを持たず、
 * 設定の面への入口はここしかない。ホーム以外の面へ移るとサイドバーが出る。
 * 権限が無いときは本文が全画面の告知に替わるので、到達の合図はサイドバー側で取る。
 */
async function openSettings(page: Page, viewport = VIEWPORT) {
  await page.setViewportSize(viewport)
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: '主操作' })).toBeVisible()
  await page.getByRole('banner').getByRole('button', { name: '設定', exact: true }).click()
  /*
   * 到達の合図は幅で変わる。iPad 幅は柱の行き先が現在地（`page`）として光る。
   * SP 幅では柱を畳むので柱そのものが出ておらず、代わりに工程レールが出る。
   * どちらも「設定の面に着いた」ことを、本文の中身に依らずに言える印である。
   */
  if (viewport.width < 768) await expect(stepRail(page).getByRole('button').first()).toBeVisible()
  else
    await expect(
      sidebar(page).getByRole('button', { name: '設定ガイド', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
  return page.getByRole('region', { name: '店舗設定' })
}

/** 入力欄は「編集」を押した先にある。読み取りカードが既定の面である。 */
async function startEditing(screen: ReturnType<Page['getByRole']>) {
  await screen.getByRole('button', { name: '編集', exact: true }).click()
}

/**
 * 工程の並び。
 *
 * iPad 幅では全画面共通の柱（`画面の一覧`）の中、設定ガイドの下に節として入る。
 * SP 幅では柱を畳むので、本文先頭の専用レールが代わりを務める。どちらの幅でも
 * 走るテストなので、出ている方を返す。
 */
/** SP 幅の専用レール。柱を畳む幅では、これが工程の並びを持つ。 */
function stepRail(page: Page) {
  return page.getByRole('navigation', { name: '設定の工程' })
}

/** 工程のボタンだけを取る（柱では行き先が混ざるので、工程名で絞る）。 */
function stepButtons(page: Page) {
  return page
    .getByRole('navigation')
    .getByRole('button')
    .filter({ hasText: /店舗と営業時間|来店目的|スタッフと技能|設備と点検|Web予約|影響確認と公開/ })
}

async function goToStep(page: Page, pattern: RegExp) {
  // 工程は読み上げ名（`工程4 設備と点検 未完了`）で名指す。字面は `4　設備と点検`
  // なので、`hasText` では状態語まで含む名前と噛み合わない。
  await page.getByRole('navigation').getByRole('button', { name: pattern }).first().click()
}

// @e2e-covers AC-EYEX-40 AC-EYEX-41 AC-EYEX-47
test('設定ガイドは6工程を決まった順で並べ、状態を語で示し、任意の工程へ直接移動できる', async ({
  page,
}) => {
  await mockSettingsApi(page)
  const screen = await openSettings(page)
  // 面の名乗りは緑帯の副題（`銀座店 · 設定ガイド`）が持ち、本文の見出しは工程名になった。
  await expect(page.getByRole('banner')).toContainText('銀座店 · 設定ガイド')
  await expect(screen.getByRole('heading', { name: '店舗と営業時間', level: 1 })).toBeVisible()

  // AC-EYEX-40: 店舗と営業時間 → 来店目的 → スタッフと技能 → 設備と点検 → Web予約 → 影響確認と公開。
  const steps = stepButtons(page)
  await expect(steps).toHaveCount(6)
  // 設定が届く前は全工程が未完了なので、届いたことを待ってから状態の語を読む。
  await expect(steps.nth(1)).toHaveAttribute('aria-label', '工程2 来店目的 完了')
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
  // レールに描かれる字は番号か ✓ と工程名だけで、状態の語は読み上げの名前が運ぶ。
  // 色に頼らず 3 つの状態が語で区別できることを、その名前の上で確かめる。
  expect(names.some((name) => name.endsWith(' 編集中'))).toBe(true)
  expect(names.some((name) => name.endsWith(' 完了'))).toBe(true)
  expect(names.some((name) => name.endsWith(' 未完了'))).toBe(true)
  await expect(steps.first()).toHaveAttribute('aria-current', 'step')

  // AC-EYEX-47: ガイドを頭から進めず、工程4へ直接飛べる。
  await goToStep(page, /^工程4 設備と点検/)
  await expect(screen.getByRole('heading', { name: '設備と点検', level: 1 })).toBeVisible()
  // 設備の読み取りカードは設備名で名乗る（フィクスチャは視力測定機 1 台）。
  await expect(screen.getByText('視力測定機', { exact: true })).toBeVisible()
  await expect(steps.nth(3)).toHaveAttribute('aria-current', 'step')
  await expect(steps.first()).not.toHaveAttribute('aria-current', 'step')

  // 直接飛んだ先からさらに工程2へ戻れる（順路に縛られない）。工程2の見出しは
  // 選んでいる来店目的の名前になる。
  await goToStep(page, /^工程2 来店目的/)
  await expect(screen.getByRole('heading', { name: '視力測定', level: 1 })).toBeVisible()
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
  // 固定表示は position ではなく「高さの決まった列」で実現されている。緑帯の
  // 真下に始まり、本文をどれだけ送っても 6 工程がその位置から動かないことで見る。
  const barBox = await page.getByRole('banner').boundingBox()
  const railTop = async () => (await rail.boundingBox())?.y
  expect(await railTop()).toBe(barBox?.height)
  await page.mouse.move(SP_VIEWPORT.width / 2, SP_VIEWPORT.height / 2)
  await page.mouse.wheel(0, 2000)
  expect(await railTop()).toBe(barBox?.height)
  for (let index = 0; index < 6; index += 1) await expect(steps.nth(index)).toBeVisible()

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
  await expect(screen.getByRole('heading', { name: 'Web予約', level: 1 })).toBeVisible()
  // レールの 1 行は `5　Web予約` の 1 つのテキストなので、行の字で確かめる。
  await expect(steps.nth(4)).toContainText('Web予約')
  // 略語の `Web` 単体は出さない（`Web予約` の一部としてしか現れない）。
  const railText = (await rail.textContent()) ?? ''
  expect(/Web(?!予約)/.test(railText)).toBe(false)
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

  // 読み取りカードが既定の面。火曜は休業日として保持されている。
  await expect(screen.getByText('月–土 10:00–19:00')).toBeVisible()
  await expect(screen.getByText('毎週火曜日・9月23日')).toBeVisible()

  // UC-EYEX-087: 通常営業時間は「編集」の先の欄で変える。
  await startEditing(screen)
  const hours = screen.getByRole('region', { name: '営業時間の編集' })
  await expect(hours.getByLabel('月曜を営業日にする')).toBeChecked()
  await expect(hours.getByLabel('火曜を営業日にする')).not.toBeChecked()
  await expect(hours.getByLabel('月曜の営業開始')).toHaveValue('10:00')
  await hours.getByLabel('月曜の営業開始').fill('11:00')
  await hours.getByLabel('火曜を営業日にする').check()
  await expect(hours.getByLabel('火曜の営業開始')).toHaveValue('10:00')

  // UC-EYEX-087: 臨時営業・休業日。既存の休業日に臨時営業を足せる。
  const exceptionRows = hours.getByRole('list', { name: '臨時営業・休業日' }).getByRole('listitem')
  await expect(exceptionRows.first()).toContainText('2026-09-23')
  await expect(exceptionRows.first()).toContainText('休業')
  await hours.getByLabel('日付').fill('2026-10-12')
  await choosePickerOption(hours, '区分', '臨時営業')
  await hours.getByLabel('理由').fill('祝日営業')
  await hours.getByRole('button', { name: '臨時設定を追加' }).click()
  await expect(exceptionRows).toHaveCount(2)
  await expect(exceptionRows.nth(1)).toContainText('2026-10-12')
  await expect(exceptionRows.nth(1)).toContainText('臨時営業')
  await expect(exceptionRows.nth(1)).toContainText('10:00–17:00')

  // UC-EYEX-087 / AC-EYEX-65 / UC-EYEX-116: 受付停止と、その効き目の説明。
  await expect(hours).toContainText(
    '受付停止は新しいWeb予約だけを止めます。既存予約は取り消されません。',
  )
  await choosePickerOption(hours, '受付状態', '受付停止')

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
  // 読み込んだ 4 つは、どれを編集中かを選ぶ絞り込みとして並ぶ。
  for (const name of [
    '視力測定・新調相談',
    'フィッティング調整',
    '修理・部品交換受付',
    'コンタクトレンズ相談',
  ])
    await expect(screen.getByRole('button', { name, exact: true })).toBeVisible()

  // UC-EYEX-118: スタッフ向け名称と顧客向け表示名は別々の入力。
  await startEditing(screen)
  const editor = screen.getByRole('region', { name: '来店目的の編集' })
  const preview = screen.getByRole('region', { name: 'Web予約プレビュー' })
  await expect(editor.getByLabel('スタッフ向け名称')).toHaveValue('視力測定・新調相談')
  await expect(editor.getByLabel('顧客向け表示名')).toHaveValue('メガネを新しく作りたい')
  await editor.getByLabel('スタッフ向け名称').fill('視力測定（新規）')
  await expect(screen.getByRole('button', { name: '視力測定（新規）', exact: true })).toBeVisible()
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
  // 読み取りは 1 人 1 枚のカード。編集欄はその先にある。
  await expect(screen).toContainText('山田検査員')
  await startEditing(screen)
  const staff = screen.getByRole('region', { name: 'スタッフと技能の編集' })
  await expect(staff.getByLabel('山田検査員は予約を受け付ける')).toBeChecked()
  await staff.getByLabel('山田検査員の技能').fill('眼鏡作製技能, 調整')
  await staff.getByLabel('山田検査員の勤務開始').fill('09:30')
  await staff.getByLabel('山田検査員の勤務終了').fill('18:30')
  await staff.getByLabel('山田検査員の休憩開始').fill('12:30')
  await staff.getByLabel('山田検査員の休憩終了').fill('13:30')
  await staff.getByLabel('山田検査員は予約を受け付ける').uncheck()

  // UC-EYEX-091
  await goToStep(page, /^工程4 設備と点検/)
  // 点検停止は設備と同じ 1 枚のカードに並ぶ（日付は行に収まる `9/1` 表記）。
  await expect(screen).toContainText('視力測定機 · 9/1 09:00–10:00')
  await expect(screen).toContainText('定期点検')
  await startEditing(screen)
  const equipment = screen.getByRole('region', { name: '設備の編集' })
  await equipment.getByLabel('視力測定機の台数').fill('3')
  await equipment.getByLabel('視力測定機の利用可能開始').fill('11:00')
  await equipment.getByLabel('視力測定機の利用可能終了').fill('18:00')

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

  await startEditing(screen)
  const editor = screen.getByRole('region', { name: '来店目的の編集' })
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

  // 非公開のあとも来店目的の一覧（絞り込み）から消えない。
  await expect(screen.getByRole('button', { name: '視力測定', exact: true })).toBeVisible()
  await expect(
    screen.getByRole('button', { name: 'フィッティング調整', exact: true }),
  ).toBeVisible()
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
  /*
   * 値が取れている欄だけが並ぶ。Web予約の公開設定・受付条件の API はまだ無いので、
   * それに依る欄（公開状態・受付終了・公開する来店目的・予約可能期間・
   * 直前受付期限・変更・取消期限・期限後の案内）はこの時点では出ない。
   * 出るのは営業時間から導ける受付時間だけである。
   */
  await expect(panel).toContainText('受付時間')
  for (const term of ['予約可能期間', '直前受付期限', '変更・取消期限', '期限後の案内']) {
    await expect(panel).not.toContainText(term)
  }
  // UC-EYEX-112: 受付曜日と時間帯は営業時間から実際に導出される（火曜は休業日なので
  // 月–土 でひとまとまりに読め、日曜だけ別の時間帯として並ぶ）。
  await expect(panel).toContainText('月–土 10:00–19:00')
  await expect(panel).toContainText('日 10:00–18:00')
  // 公開状態・公開期間・公開する来店目的・受付条件は API 未提供。推測も
  // 「未取得」の書き足しもせず、欄ごと出さないうえで、取れていないことを
  // 1 か所で言う。
  await expect(panel).not.toContainText('未取得')
  await expect(panel).not.toContainText('公開状態')
  await expect(panel).toContainText('Web予約の公開設定はまだ取得できていません。')

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

  // 閲覧権限なし: 中身も、その存在も出さない。工程レールごと出さない。
  let screen = await openSettings(page)
  await expect(
    page.getByRole('region', { name: 'この設定を表示する権限がありません' }),
  ).toContainText('権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。')
  await expect(screen).toHaveCount(0)
  await expect(stepButtons(page)).toHaveCount(0)
  await expect(page.getByText('10:00–19:00')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '設定を保存' })).toHaveCount(0)

  // 閲覧のみ: 値は読めるが、編集手段は提供されない。
  state.permissions = ['store.read', 'settings.read']
  screen = await openSettings(page)
  await expect(screen).toContainText('月–土 10:00–19:00')
  await expect(screen).toContainText('設定を変更する権限がありません。')
  await expect(screen.getByRole('button', { name: '設定を保存' })).toHaveCount(0)
  await expect(screen.getByRole('button', { name: '編集', exact: true })).toHaveCount(0)
  await expect(screen.getByLabel('月曜を営業日にする')).toHaveCount(0)
  await expect(screen.getByLabel('受付状態')).toHaveCount(0)
  await goToStep(page, /^工程2 来店目的/)
  await expect(screen.getByLabel('顧客向け表示名')).toHaveCount(0)
  // 読み取りカードは残る（見えないのは編集手段だけ）。
  await expect(screen).toContainText('視力測定')
  expect(state.savedBodies).toHaveLength(0)
})

/** ホーム → 緑帯の「設定」→ サイドバーの「共有端末」（共有iPad の面はその先）。 */
async function openSharedTerminals(page: Page) {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: '主操作' })).toBeVisible()
  await page.getByRole('banner').getByRole('button', { name: '設定', exact: true }).click()
  await sidebar(page).getByRole('button', { name: '共有端末', exact: true }).click()
  await expect(page.getByRole('heading', { name: '共有iPad', level: 1 })).toBeVisible()
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
  // 名前を入れずに登録しようとしても発行はされない。
  await page.getByRole('button', { name: '登録する' }).click()
  await expect(page.getByText('端末名を入力してください。')).toBeVisible()
  expect(state.createAuth).toEqual([])
  await page.getByLabel('端末名').fill('検査室iPad')
  await page.getByRole('button', { name: '登録する' }).click()

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
  await expect(page.getByRole('article', { name: '銀座店 検査室iPad' })).toBeVisible()
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
  // 最終通信は「今から何分前か」で読ませるので、時計を固定してから開く。
  await page.clock.setFixedTime(new Date('2026-08-27T03:00:00.000Z'))
  await openSharedTerminals(page)

  // UC-EYEX-150 / AC-EYEX-96: 端末名、店舗、最終通信、状態。
  const row = page.getByRole('article', { name: '銀座店 受付カウンターiPad' })
  await expect(row).toContainText('銀座店')
  await expect(row).toContainText('最終通信 2分前')
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
  await expect(row).toContainText('停止中')
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
  // ホームには見出しが無い。主操作の並びが出ていることをホーム到達の合図にする。
  await expect(page.getByRole('navigation', { name: '主操作' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /PIN/ })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('banner').getByRole('button', { name: '設定', exact: true }).click()
  await expect(page.getByRole('region', { name: '店舗設定' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /PIN/ })).toHaveCount(0)
  await sidebar(page).getByRole('button', { name: '共有端末', exact: true }).click()
  await expect(page.getByRole('heading', { name: '共有iPad', level: 1 })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /PIN/ })).toHaveCount(0)

  // AC-EYEX-82: 管理操作は個人PINまたは個人ログインを要求し、この場では実行しない。
  const pin = page.getByRole('region', { name: '個人モード' })
  await expect(pin).toContainText('スタッフ選択＋4〜6桁PIN')
  await pin.getByRole('button', { name: '個人PINを設定・変更' }).click()
  await expect(pin).toContainText(
    '個人PINの設定と変更は本人のみが行えます。この操作は管理コンソールで行います。',
  )
  await pin.getByRole('button', { name: '個人PINの再設定を開始' }).click()
  await expect(pin).toContainText(
    '本人確認後にPIN再設定を開始できます。PINそのものは管理者にも表示されません。この操作は管理コンソールで行います。',
  )

  // UC-EYEX-152: 無操作ロック時間はこの画面の管轄外。値が来ていないあいだは
  // 既定値を推測せず何も名乗らず（「未取得」もモックに無い失敗文言なので書かない）、
  // 変更もこの面では実行しない。
  const idle = page.getByRole('region', { name: '無操作ロック' })
  await expect(idle).not.toContainText('未取得')
  // 推測した時間（`既定 2分` のような分の表記）を一切描かない。
  await expect(idle).not.toContainText('分')
  await idle.getByRole('button', { name: '変更' }).click()
  await expect(idle).toContainText('無操作ロック時間の変更はこの操作は管理コンソールで行います。')
})
