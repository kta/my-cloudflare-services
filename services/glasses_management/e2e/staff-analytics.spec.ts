import { expect, type Page, test } from '@playwright/test'

/*
 * EYEX スタッフ端末の「店舗運用の分析」と「お知らせとアラート」の E2E。
 *
 * どちらもヘッダーの管理メニュー（分析 / お知らせ）から開く。API はすべて
 * `page.route` で差し替え、SPA だけを実行する。
 *
 * この spec の主張の中心は否定形である。サーバが抑制した値は、数字・割合・
 * 棒の長さのどの形でも画面に残ってはならない。ひとつでも残れば「合計 − 見えて
 * いる兄弟」で隠したはずのバケットが復元できてしまう。
 *
 * 共有 iPad（横向き 1180×820）が既定の前提なので viewport をそれに合わせる。
 */

const VIEWPORT = { width: 1180, height: 820 }

const ginzaId = '11111111-1111-4111-8111-111111111111'
const marunouchiId = '22222222-2222-4222-8222-222222222222'

const noticeId = '33333333-3333-4333-8333-333333333333'
const alertId = '44444444-4444-4444-8444-444444444444'

/** 数字を一切含まないことを主張するための判定。全角数字も見る。 */
const DIGIT = /[0-9０-９]/

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

const ALL_PERMISSIONS = [
  'store.read',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.history',
  'attention.read',
  'settings.read',
  'settings.manage',
  'analytics.read',
]

type Request = { method: string; url: string; body: string }

type Report = Record<string, unknown>

type Mocks = {
  permissions: string[]
  requests: Request[]
  /** 分析レスポンス。URL の granularity / date / storeId を見て決める。 */
  report: (params: {
    storeId: string
    granularity: string
    date: string
  }) => { status: number; json: unknown } | undefined
  alerts: AlertRow[]
  alertSettings: AlertSettings
}

type AlertRow = {
  id: string
  storeId: string
  kind: 'notice' | 'alert'
  code: 'long_wait' | 'recording_save_failure' | 'settings_contradiction'
  title: string
  reason: string
  subject: string
  subjectType: 'reservation' | 'walkin' | 'recording' | 'visit_purpose'
  subjectId: string
  occurredAt: string
  nextAction: string
  readAt: string | null
  readBy: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  resolutionNote: string | null
}

type AlertSettings = {
  storeId: string
  conditions: {
    code: 'long_wait' | 'recording_save_failure' | 'settings_contradiction'
    enabled: boolean
    thresholdMinutes: number | null
  }[]
  notificationTargets: string[]
  updatedAt: string
}

const PERIODS: Record<string, { start: string; end: string; prevStart: string; prevEnd: string }> =
  {
    day: {
      start: '2026-08-27',
      end: '2026-08-27',
      prevStart: '2026-08-26',
      prevEnd: '2026-08-26',
    },
    week: {
      start: '2026-08-24',
      end: '2026-08-30',
      prevStart: '2026-08-17',
      prevEnd: '2026-08-23',
    },
    month: {
      start: '2026-08-01',
      end: '2026-08-31',
      prevStart: '2026-07-01',
      prevEnd: '2026-07-31',
    },
  }

function period(granularity: string, previous: boolean) {
  const window = PERIODS[granularity] ?? PERIODS.day
  if (window === undefined) throw new Error('unreachable')
  return {
    granularity,
    startDate: previous ? window.prevStart : window.start,
    endDate: previous ? window.prevEnd : window.end,
    startAt: `${previous ? window.prevStart : window.start}T00:00:00.000Z`,
    endAt: `${previous ? window.prevEnd : window.end}T15:00:00.000Z`,
  }
}

/**
 * 銀座店の「ふつうの一日」。抑制なし・目標あり・除外ありの完全な形で、
 * 個々の test が必要な部分だけ差し替える。
 */
function fullReport(
  options: { storeId?: string; storeName?: string; granularity?: string; overrides?: Report } = {},
): Report {
  const storeId = options.storeId ?? ginzaId
  const storeName = options.storeName ?? '銀座店'
  const granularity = options.granularity ?? 'day'
  return {
    storeId,
    storeName,
    timezone: 'Asia/Tokyo',
    period: period(granularity, false),
    previousPeriod: period(granularity, true),
    lastUpdatedAt: '2026-08-27T05:30:00.000Z',
    totalCount: 214,
    smallSampleThreshold: 5,
    status: 'ok',
    reason: null,
    nextAction: null,
    metrics: [
      {
        metric: 'reservations',
        label: '予約',
        definition: '対象期間に開始予定だった予約の件数。',
        unit: 'count',
        value: 128,
        previousValue: 96,
        difference: 32,
        target: null,
        targetDifference: null,
        exceedsTarget: false,
        suppressed: false,
        suppressionReason: null,
      },
      {
        metric: 'visits',
        label: '来店',
        definition: '受付が完了した来店の件数。',
        unit: 'count',
        value: 120,
        previousValue: 90,
        difference: 30,
        target: 110,
        targetDifference: 10,
        exceedsTarget: false,
        suppressed: false,
        suppressionReason: null,
      },
      {
        metric: 'cancellations',
        label: '取消',
        definition: '来店前に取り消された予約の件数。',
        unit: 'count',
        value: 8,
        previousValue: 6,
        difference: 2,
        target: null,
        targetDifference: null,
        exceedsTarget: false,
        suppressed: false,
        suppressionReason: null,
      },
      {
        metric: 'no_shows',
        label: '無断キャンセル',
        definition: '来店予定日を過ぎても受付されなかった予約の件数。',
        unit: 'count',
        value: 14,
        previousValue: 9,
        difference: 5,
        target: 8,
        targetDifference: 6,
        exceedsTarget: true,
        suppressed: false,
        suppressionReason: null,
      },
    ],
    breakdowns: [
      {
        dimension: 'purpose',
        metric: 'reservations',
        suppressed: false,
        suppressionReason: null,
        items: [
          { key: 'p1', label: '視力測定', value: 60, suppressed: false },
          { key: 'p2', label: '受け取り', value: 30, suppressed: false },
        ],
      },
      {
        dimension: 'source',
        metric: 'reservations',
        suppressed: false,
        suppressionReason: null,
        items: [
          { key: 'web', label: 'Web予約', value: 80, suppressed: false },
          { key: 'staff', label: '店頭・電話', value: 48, suppressed: false },
        ],
      },
      {
        dimension: 'hour',
        metric: 'reservations',
        suppressed: false,
        suppressionReason: null,
        items: [
          { key: '10', label: '10時台', value: 40, suppressed: false },
          { key: '14', label: '14時台', value: 88, suppressed: false },
        ],
      },
      {
        dimension: 'staff',
        metric: 'reservations',
        suppressed: false,
        suppressionReason: null,
        items: [
          { key: 's1', label: '山田', value: 70, suppressed: false },
          { key: 's2', label: '佐藤', value: 58, suppressed: false },
        ],
      },
    ],
    stageDistributions: [
      {
        stage: 'reception_to_service_start',
        label: '受付から接客開始まで',
        definition: '受付から接客開始までの経過分数。',
        unit: 'minutes',
        sampleCount: 40,
        suppressed: false,
        suppressionReason: null,
        averageMinutes: 9,
        medianMinutes: 8,
        p90Minutes: 18,
        maxMinutes: 32,
        buckets: [
          { label: '0〜5分', fromMinutes: 0, toMinutes: 5, count: 10 },
          { label: '5〜10分', fromMinutes: 5, toMinutes: 10, count: 20 },
          { label: '10分以上', fromMinutes: 10, toMinutes: null, count: 10 },
        ],
      },
      {
        stage: 'service_duration',
        label: '接客の所要時間',
        definition: '接客開始から接客終了までの経過分数。',
        unit: 'minutes',
        sampleCount: 40,
        suppressed: false,
        suppressionReason: null,
        averageMinutes: 45,
        medianMinutes: 42,
        p90Minutes: 70,
        maxMinutes: 96,
        buckets: [
          { label: '0〜30分', fromMinutes: 0, toMinutes: 30, count: 12 },
          { label: '30分以上', fromMinutes: 30, toMinutes: null, count: 28 },
        ],
      },
    ],
    funnel: {
      sessionCount: 100,
      suppressed: false,
      suppressionReason: null,
      steps: [
        {
          stage: 'started',
          label: '開始',
          count: 100,
          droppedFromPrevious: null,
          suppressed: false,
        },
        {
          stage: 'slot_selected',
          label: '枠選択',
          count: 70,
          droppedFromPrevious: 30,
          suppressed: false,
        },
        {
          stage: 'confirmed',
          label: '確認',
          count: 60,
          droppedFromPrevious: 10,
          suppressed: false,
        },
        { stage: 'completed', label: '完了', count: 55, droppedFromPrevious: 5, suppressed: false },
      ],
      largestDropStage: 'slot_selected',
    },
    exclusions: [
      {
        reason: 'missing_stage_timestamp',
        count: 3,
        description: '工程の時刻が欠けている来店を除外しました。',
        caveat: '待ち時間の分布は実際よりも短く見える可能性があります。',
      },
      {
        reason: 'unassigned_staff',
        count: 2,
        description: '担当者が割り当てられていない来店を除外しました。',
        caveat: '担当者別の内訳は実際の件数より少なく見えます。',
      },
    ],
    qualityWarnings: [
      {
        code: 'recording_save_failure',
        count: 2,
        message: '録音の保存に失敗した接客があります。',
        nextAction: '録音運用画面で保存状況を確認してください。',
      },
      {
        code: 'settings_contradiction',
        count: 1,
        message: '営業時間と枠設定が矛盾している曜日があります。',
        nextAction: '店舗設定で営業時間と枠の長さを見直してください。',
      },
    ],
    causeCandidates: [
      {
        metric: 'no_shows',
        code: 'web_source_concentration',
        hypothesis: 'Web予約に無断キャンセルが集中している可能性があります。',
        evidenceCount: 12,
        inspectionTarget: 'Web予約の確認メール到達状況',
      },
      {
        metric: 'no_shows',
        code: 'peak_hour_concentration',
        hypothesis: '特定の時間帯に無断キャンセルが偏っている可能性があります。',
        evidenceCount: 7,
        inspectionTarget: '14時台の予約枠',
      },
    ],
    ...options.overrides,
  }
}

function notice(): AlertRow {
  return {
    id: noticeId,
    storeId: ginzaId,
    kind: 'notice',
    code: 'settings_contradiction',
    title: '営業時間の設定が矛盾しています',
    reason: '木曜の営業時間より長い枠が設定されています。',
    subject: '木曜の来店目的「視力測定」',
    subjectType: 'visit_purpose',
    subjectId: 'purpose-exam',
    occurredAt: '2026-08-27T00:10:00.000Z',
    nextAction: '店舗設定で枠の長さを営業時間内に収めてください。',
    readAt: null,
    readBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  }
}

function alert(): AlertRow {
  return {
    id: alertId,
    storeId: ginzaId,
    kind: 'alert',
    code: 'recording_save_failure',
    title: '録音の保存に失敗しました',
    reason: '接客記録の音声を保存できませんでした。',
    subject: '銀座店 14時台の接客',
    subjectType: 'recording',
    subjectId: 'recording-1',
    occurredAt: '2026-08-27T05:00:00.000Z',
    nextAction: '録音運用画面で再保存するか、要点を手入力してください。',
    readAt: null,
    readBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  }
}

function defaultAlertSettings(): AlertSettings {
  return {
    storeId: ginzaId,
    conditions: [
      { code: 'long_wait', enabled: true, thresholdMinutes: 30 },
      { code: 'recording_save_failure', enabled: true, thresholdMinutes: null },
      { code: 'settings_contradiction', enabled: false, thresholdMinutes: null },
    ],
    notificationTargets: ['ginza-manager@example.com'],
    updatedAt: '2026-08-20T02:00:00.000Z',
  }
}

function newMocks(overrides: Partial<Mocks> = {}): Mocks {
  return {
    permissions: [...ALL_PERMISSIONS],
    requests: [],
    report: ({ storeId, granularity }) => ({
      status: 200,
      json: fullReport({
        storeId,
        storeName: storeId === marunouchiId ? '丸の内店' : '銀座店',
        granularity,
      }),
    }),
    alerts: [notice(), alert()],
    alertSettings: defaultAlertSettings(),
    ...overrides,
  }
}

async function mockStaffApi(page: Page, mocks: Mocks) {
  const record = (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const request = route.request()
    mocks.requests.push({
      method: request.method(),
      url: request.url(),
      body: request.postData() ?? '',
    })
  }
  // 先に総当たりを置く。あとから登録したものが優先されるので、以降の
  // 個別 route がこれを上書きする。分析へ一度も出ていないことを言うために、
  // ここでもすべて記録する。
  await page.route('**/api/**', (route) => {
    record(route)
    return route.fulfill({ json: [] })
  })
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ json: { token: 'staff-e2e' } }),
  )
  await page.route('**/api/staff/stores', (route) => route.fulfill({ json: stores }))
  await page.route('**/api/staff/store-switches', (route) =>
    route.fulfill({ status: 201, json: {} }),
  )
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({ json: mocks.permissions }),
  )

  await page.route('**/api/staff/stores/*/analytics*', (route) => {
    record(route)
    const url = new URL(route.request().url())
    const storeId = url.pathname.split('/')[4] ?? ''
    const response = mocks.report({
      storeId,
      granularity: url.searchParams.get('granularity') ?? 'day',
      date: url.searchParams.get('date') ?? '',
    })
    return route.fulfill(response ?? { status: 500, json: { message: 'failed' } })
  })

  await page.route('**/api/staff/stores/*/alerts*', (route) => {
    record(route)
    const url = new URL(route.request().url())
    const kind = url.searchParams.get('kind')
    const status = url.searchParams.get('status')
    const rows = mocks.alerts.filter(
      (row) =>
        (kind === null || row.kind === kind) &&
        (status === null ||
          status === 'all' ||
          (status === 'unread' ? row.readAt === null : row.resolvedAt === null)),
    )
    return route.fulfill({ json: rows })
  })
  await page.route('**/api/staff/stores/*/alerts/*', (route) => {
    record(route)
    const id = new URL(route.request().url()).pathname.split('/').at(-1) ?? ''
    const row = mocks.alerts.find((entry) => entry.id === id)
    return row
      ? route.fulfill({ json: row })
      : route.fulfill({ status: 404, json: { message: 'not found' } })
  })
  await page.route('**/api/staff/stores/*/alerts/*/read', (route) => {
    record(route)
    const id = new URL(route.request().url()).pathname.split('/').at(-2) ?? ''
    const row = mocks.alerts.find((entry) => entry.id === id)
    if (!row) return route.fulfill({ status: 404, json: { message: 'not found' } })
    // 既読だけを進める。対応済みには一切触れない (AC-EYEX-120)。
    row.readAt = '2026-08-27T06:00:00.000Z'
    row.readBy = '山田'
    return route.fulfill({ json: row })
  })
  await page.route('**/api/staff/stores/*/alerts/*/resolve', (route) => {
    record(route)
    const id = new URL(route.request().url()).pathname.split('/').at(-2) ?? ''
    const row = mocks.alerts.find((entry) => entry.id === id)
    if (!row) return route.fulfill({ status: 404, json: { message: 'not found' } })
    const body = JSON.parse(route.request().postData() ?? '{}') as { note?: string }
    // 対応済みだけを進める。既読には一切触れない (AC-EYEX-120)。
    row.resolvedAt = '2026-08-27T06:05:00.000Z'
    row.resolvedBy = '佐藤'
    row.resolutionNote = body.note ?? null
    return route.fulfill({ json: row })
  })

  await page.route('**/api/staff/stores/*/alert-settings', (route) => {
    record(route)
    if (route.request().method() === 'GET') return route.fulfill({ json: mocks.alertSettings })
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      conditions: AlertSettings['conditions']
      notificationTargets: string[]
    }
    mocks.alertSettings = {
      ...mocks.alertSettings,
      conditions: body.conditions,
      notificationTargets: body.notificationTargets,
      updatedAt: '2026-08-27T06:10:00.000Z',
    }
    return route.fulfill({ json: mocks.alertSettings })
  })
}

async function openAdmin(page: Page, label: string) {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
  await page
    .getByRole('navigation', { name: '管理メニュー' })
    .getByRole('button', { name: label })
    .click()
}

async function openAnalytics(page: Page) {
  await openAdmin(page, '分析')
  await expect(page.getByRole('heading', { name: '店舗運用の分析' })).toBeVisible()
  // 対象日は端末の当日に依存させない。集計の窓は必ずこちらから指定する。
  await page.getByLabel('対象日').fill('2026-08-27')
  await expect(page.getByText('対象件数 214件')).toBeVisible()
}

async function openAlerts(page: Page) {
  await openAdmin(page, 'お知らせ')
  await expect(page.getByRole('heading', { name: 'お知らせとアラート' })).toBeVisible()
}

/** 領域内に数字が一つも残っていないこと。割合も差分も、棒の長さもだめ。 */
async function expectNoDigits(page: Page, label: string) {
  const region = page.getByRole('region', { name: label })
  await expect(region).toBeVisible()
  const text = await region.innerText()
  expect(text).not.toMatch(DIGIT)
  const widths = await region
    .locator('[data-bar]')
    .evaluateAll((bars) => bars.map((bar) => (bar as HTMLElement).style.width))
  for (const width of widths) expect(width).toBe('0%')
}

// @e2e-covers UC-EYEX-099 UC-EYEX-105 AC-EYEX-49 AC-EYEX-52
test('分析は日・週・月の予約・来店・取消・無断キャンセルを、対象期間・JST・最終更新・対象件数・指標定義と現在値/前期間差/店舗目標つきで出す', async ({
  page,
}) => {
  const mocks = newMocks()
  await mockStaffApi(page, mocks)
  await openAnalytics(page)

  // 数字は必ず「いつの・どの時間帯の・いつ時点の・何件の」と一緒に出る (AC-EYEX-49 / UC-EYEX-105)。
  await expect(page.getByText('2026-08-27〜2026-08-27（日）')).toBeVisible()
  await expect(page.getByText('JST(Asia/Tokyo)')).toBeVisible()
  await expect(page.getByText('最終更新 2026-08-27 14:30 JST')).toBeVisible()
  await expect(page.getByText('対象件数 214件')).toBeVisible()
  await expect(page.getByText('比較対象 2026-08-26〜2026-08-26')).toBeVisible()

  // 予約・来店・取消・無断キャンセルの四つが揃う (UC-EYEX-099)。
  for (const [label, value] of [
    ['予約', '128件'],
    ['来店', '120件'],
    ['取消', '8件'],
    ['無断キャンセル', '14件'],
  ] as const) {
    const section = page.getByRole('region', { name: label, exact: true })
    await expect(section).toContainText(value)
    // 指標定義が指標ごとに読める (AC-EYEX-49)。
    await expect(section.getByText('件数。')).toBeVisible()
  }

  // 現在値・前期間差・店舗目標が同じ単位（件）で並ぶ (AC-EYEX-52)。
  const noShows = page.getByRole('region', { name: '無断キャンセル', exact: true })
  await expect(noShows).toContainText('前期間 9件（+5件）')
  await expect(noShows).toContainText('店舗目標 8件（+6件）')
  await expect(noShows.getByText('目標超過')).toBeVisible()
  // 目標が未設定の指標は、0 をでっち上げずに未設定と言う (AC-EYEX-52)。
  await expect(page.getByRole('region', { name: '予約', exact: true })).toContainText(
    '店舗目標は未設定です',
  )

  // 粒度を替えると期間そのものが替わる (UC-EYEX-099)。
  await page.getByLabel('集計粒度').selectOption('week')
  await expect(page.getByText('2026-08-24〜2026-08-30（週）')).toBeVisible()
  await expect(page.getByText('比較対象 2026-08-17〜2026-08-23')).toBeVisible()
  await page.getByLabel('集計粒度').selectOption('month')
  await expect(page.getByText('2026-08-01〜2026-08-31（月）')).toBeVisible()
  await expect(page.getByText('比較対象 2026-07-01〜2026-07-31')).toBeVisible()

  const analytics = mocks.requests.filter((entry) => entry.url.includes('/analytics'))
  expect(analytics.at(-1)?.url).toContain('granularity=month')
  expect(analytics.at(-1)?.url).toContain('date=2026-08-27')
})

// @e2e-covers UC-EYEX-100 UC-EYEX-101 AC-EYEX-50
test('来店目的・予約元・時間帯・担当者の内訳と、受付から接客開始までの分布が平均だけでなく裾まで読める', async ({
  page,
}) => {
  const mocks = newMocks()
  await mockStaffApi(page, mocks)
  await openAnalytics(page)

  // 四つの軸で比較できる (UC-EYEX-100)。
  for (const [label, rows] of [
    [
      '来店目的',
      [
        ['視力測定', '60件'],
        ['受け取り', '30件'],
      ],
    ],
    [
      '予約元',
      [
        ['Web予約', '80件'],
        ['店頭・電話', '48件'],
      ],
    ],
    [
      '時間帯',
      [
        ['10時台', '40件'],
        ['14時台', '88件'],
      ],
    ],
    [
      '担当者',
      [
        ['山田', '70件'],
        ['佐藤', '58件'],
      ],
    ],
  ] as const) {
    const section = page.getByRole('region', { name: `${label}の内訳` })
    for (const [name, value] of rows) {
      await expect(section).toContainText(name)
      await expect(section).toContainText(value)
    }
  }

  // 待ち時間は平均一つではなく分布で読む (AC-EYEX-50 / UC-EYEX-101)。
  const wait = page.getByRole('region', { name: '受付から接客開始まで の分布' })
  await expect(wait).toContainText('中央値 8分 / 平均 9分 / 90パーセンタイル 18分 / 最大 32分')
  await expect(wait).toContainText('対象40件')
  await expect(wait).toContainText('0〜5分')
  await expect(wait).toContainText('5〜10分')
  await expect(wait).toContainText('10分以上')
  // 平均だけでは見えない裾が、件数つきで残っている。
  await expect(wait).toContainText('10件')
  await expect(wait).toContainText('20件')

  // 関連工程（接客の所要時間）も同じ形で並ぶ (UC-EYEX-101)。
  const duration = page.getByRole('region', { name: '接客の所要時間 の分布' })
  await expect(duration).toContainText(
    '中央値 42分 / 平均 45分 / 90パーセンタイル 70分 / 最大 96分',
  )
})

// @e2e-covers UC-EYEX-103 UC-EYEX-104 AC-EYEX-51 AC-EYEX-54
test('Web予約の離脱と運用品質の警告、除外行、断定しない原因候補が根拠件数つきで読める', async ({
  page,
}) => {
  const mocks = newMocks()
  await mockStaffApi(page, mocks)
  await openAnalytics(page)

  // 開始→枠選択→確認→完了 と、その間で失われた数 (UC-EYEX-103)。
  const funnel = page.getByRole('region', { name: 'Web予約の離脱' })
  await expect(funnel).toContainText('対象100件')
  await expect(funnel).toContainText('最大の離脱は「枠選択」')
  for (const [label, count, drop] of [
    ['開始', '100件', '—'],
    ['枠選択', '70件', '-30件'],
    ['確認', '60件', '-10件'],
    ['完了', '55件', '-5件'],
  ] as const) {
    await expect(funnel).toContainText(label)
    await expect(funnel).toContainText(count)
    await expect(funnel).toContainText(drop)
  }

  // 録音保存失敗と設定矛盾が、件数と次の操作つきで並ぶ (UC-EYEX-104)。
  const quality = page.getByRole('region', { name: '運用品質の警告' })
  await expect(quality).toContainText('録音の保存に失敗した接客があります。')
  await expect(quality).toContainText('録音運用画面で保存状況を確認してください。')
  await expect(quality).toContainText('営業時間と枠設定が矛盾している曜日があります。')
  await expect(quality).toContainText('店舗設定で営業時間と枠の長さを見直してください。')

  // 除外は件数・理由・解釈上の注意の三点セット (AC-EYEX-54)。
  const exclusions = page.getByRole('region', { name: '除外したデータ' })
  await expect(exclusions).toContainText('3件')
  await expect(exclusions).toContainText('工程の時刻が欠けている来店を除外しました。')
  await expect(exclusions).toContainText('待ち時間の分布は実際よりも短く見える可能性があります。')
  await expect(exclusions).toContainText('2件')
  await expect(exclusions).toContainText('担当者が割り当てられていない来店を除外しました。')
  await expect(exclusions).toContainText('担当者別の内訳は実際の件数より少なく見えます。')

  // 原因候補は断定せず、根拠件数と確認対象を持つ (AC-EYEX-51)。
  const causes = page.getByRole('region', { name: '無断キャンセルの原因候補' })
  await expect(causes).toContainText(
    '原因を断定するものではありません。根拠件数とあわせて確認してください。',
  )
  await expect(causes).toContainText('Web予約に無断キャンセルが集中している可能性があります。')
  await expect(causes).toContainText('根拠件数 12件')
  await expect(causes).toContainText('確認対象: Web予約の確認メール到達状況')
  await expect(causes).toContainText('特定の時間帯に無断キャンセルが偏っている可能性があります。')
  await expect(causes).toContainText('根拠件数 7件')
})

// @e2e-covers UC-EYEX-107 UC-EYEX-180 AC-EYEX-53 AC-EYEX-119
test('抑制された指標と逆算できる内訳は、数字も割合も棒の長さも残さずに同時に消える', async ({
  page,
}) => {
  const mocks = newMocks({
    report: ({ storeId, granularity }) => ({
      status: 200,
      json: fullReport({
        storeId,
        granularity,
        overrides: {
          totalCount: 3,
          status: 'suppressed',
          reason: '対象件数が組織の抑制閾値を下回るため、一部の値を非表示にしています。',
          nextAction: '期間を広げてもう一度集計してください。',
          metrics: [
            {
              metric: 'no_shows',
              label: '無断キャンセル',
              definition: '来店予定日を過ぎても受付されなかった予約の件数。',
              unit: 'count',
              // サーバが隠した値。画面には数字として一切現れてはならない。
              value: null,
              previousValue: null,
              difference: null,
              target: null,
              targetDifference: null,
              exceedsTarget: false,
              suppressed: true,
              suppressionReason: 'small_sample',
            },
          ],
          breakdowns: [
            {
              dimension: 'staff',
              metric: 'no_shows',
              // 抑制された指標の内訳。ひとつでも兄弟が残ると引き算で復元できる。
              suppressed: true,
              suppressionReason: 'derivable_from_small_sample',
              items: [
                { key: 's1', label: '山田', value: null, suppressed: true },
                { key: 's2', label: '佐藤', value: null, suppressed: true },
              ],
            },
          ],
          stageDistributions: [
            {
              stage: 'reception_to_service_start',
              label: '受付から接客開始まで',
              definition: '受付から接客開始までの経過分数。',
              unit: 'minutes',
              sampleCount: 3,
              suppressed: true,
              suppressionReason: 'small_sample',
              averageMinutes: null,
              medianMinutes: null,
              p90Minutes: null,
              maxMinutes: null,
              buckets: [],
            },
          ],
          funnel: {
            sessionCount: 3,
            suppressed: true,
            suppressionReason: 'small_sample',
            steps: [
              {
                stage: 'started',
                label: '開始',
                count: null,
                droppedFromPrevious: null,
                suppressed: true,
              },
              {
                stage: 'slot_selected',
                label: '枠選択',
                count: null,
                droppedFromPrevious: null,
                suppressed: true,
              },
            ],
            largestDropStage: null,
          },
          exclusions: [],
          qualityWarnings: [],
          causeCandidates: [],
        },
      }),
    }),
  })
  await mockStaffApi(page, mocks)
  await openAdmin(page, '分析')
  await page.getByLabel('対象日').fill('2026-08-27')
  await expect(page.getByText('対象件数 3件')).toBeVisible()

  // 小標本であることは言う。値は言わない (AC-EYEX-53)。
  await expect(
    page.getByText('対象件数が組織の抑制閾値を下回るため、一部の値を非表示にしています。'),
  ).toBeVisible()
  await expect(page.getByText('期間を広げてもう一度集計してください。')).toBeVisible()

  // 指標そのもの: 現在値も前期間差も残らない (UC-EYEX-107 / AC-EYEX-53)。
  const metric = page.getByRole('region', { name: '無断キャンセル', exact: true })
  await expect(metric.getByText('非表示').first()).toBeVisible()
  await expect(metric).toContainText(
    '対象件数が組織の抑制閾値を下回るため、個人が特定されないよう非表示にしています。',
  )
  await expectNoDigits(page, '無断キャンセル')

  // 逆算できる関連内訳も同時に消える。合計から引ける兄弟を一つも残さない (AC-EYEX-119 / UC-EYEX-180)。
  const breakdown = page.getByRole('region', { name: '担当者の内訳' })
  await expect(breakdown).toContainText(
    '非表示にした値から逆算できるため、あわせて非表示にしています。',
  )
  await expect(breakdown).toContainText('山田')
  await expect(breakdown).toContainText('佐藤')
  await expectNoDigits(page, '担当者の内訳')

  // 分布と離脱も同じ扱い (UC-EYEX-180)。
  await expectNoDigits(page, '受付から接客開始まで の分布')
  await expectNoDigits(page, 'Web予約の離脱')

  // 画面全体としても、抑制された領域の外にしか数字は無い。
  const main = page.getByRole('main')
  await expect(main).toContainText('非表示')
})

// @e2e-covers UC-EYEX-102 AC-EYEX-55
test('店舗を切り替えると分析はその店舗だけに切り替わり、切替前の店舗の明細を混ぜない', async ({
  page,
}) => {
  const mocks = newMocks({
    report: ({ storeId, granularity }) =>
      storeId === marunouchiId
        ? {
            status: 200,
            json: fullReport({
              storeId,
              storeName: '丸の内店',
              granularity,
              overrides: {
                totalCount: 87,
                metrics: [
                  {
                    metric: 'reservations',
                    label: '予約',
                    definition: '対象期間に開始予定だった予約の件数。',
                    unit: 'count',
                    value: 41,
                    previousValue: 39,
                    difference: 2,
                    target: null,
                    targetDifference: null,
                    exceedsTarget: false,
                    suppressed: false,
                    suppressionReason: null,
                  },
                ],
                breakdowns: [
                  {
                    dimension: 'staff',
                    metric: 'reservations',
                    suppressed: false,
                    suppressionReason: null,
                    items: [{ key: 's9', label: '丸の内の鈴木', value: 41, suppressed: false }],
                  },
                ],
                stageDistributions: [],
                causeCandidates: [],
                exclusions: [],
                qualityWarnings: [],
              },
            }),
          }
        : { status: 200, json: fullReport({ storeId, granularity }) },
  })
  await mockStaffApi(page, mocks)
  await openAnalytics(page)

  // 銀座店の明細（担当者「山田」「佐藤」）が見えている。
  await expect(page.getByRole('region', { name: '担当者の内訳' })).toContainText('山田')

  await page.locator('header button').first().click()
  await expect(page.getByRole('region', { name: '作業する店舗を切り替える' })).toBeVisible()
  await page.getByRole('button', { name: /丸の内店/ }).click()
  await expect(page.getByRole('heading', { name: '丸の内店のホーム' })).toBeVisible()

  await page
    .getByRole('navigation', { name: '管理メニュー' })
    .getByRole('button', { name: '分析' })
    .click()
  await page.getByLabel('対象日').fill('2026-08-27')

  // 選択店舗だけの集計に替わる (UC-EYEX-102 / AC-EYEX-55)。
  await expect(page.getByText('対象件数 87件')).toBeVisible()
  await expect(page.getByRole('region', { name: '予約', exact: true })).toContainText('41件')
  await expect(page.getByRole('region', { name: '担当者の内訳' })).toContainText('丸の内の鈴木')

  // 銀座店の明細は一片も残らない (AC-EYEX-55)。
  const main = page.getByRole('main')
  await expect(main).not.toContainText('山田')
  await expect(main).not.toContainText('佐藤')
  await expect(main).not.toContainText('214件')
  await expect(main).not.toContainText('128件')

  // 集計要求そのものが切替後の店舗宛てに出ている。
  const analytics = mocks.requests.filter((entry) => entry.url.includes('/analytics'))
  expect(analytics.at(-1)?.url).toContain(marunouchiId)
  expect(analytics.at(-1)?.url).not.toContain(ginzaId)
})

// @e2e-covers UC-EYEX-106
test('分析の権限が無ければ数値も要求も出ない', async ({ page }) => {
  const mocks = newMocks({
    permissions: ALL_PERMISSIONS.filter((permission) => permission !== 'analytics.read'),
  })
  await mockStaffApi(page, mocks)
  await openAdmin(page, '分析')

  await expect(page.getByText('分析を閲覧する権限がありません。')).toBeVisible()
  await expect(page.getByLabel('集計粒度')).toHaveCount(0)
  const main = page.getByRole('main')
  await expect(main).not.toContainText('対象件数')
  await expect(main).not.toContainText('件')

  // 画面が空なのではなく、そもそもサーバへ聞いていない (UC-EYEX-106)。
  expect(mocks.requests.filter((entry) => entry.url.includes('/analytics'))).toEqual([])
})

// @e2e-covers UC-EYEX-108
test('データがない期間と集計失敗は、素の0ではなく理由と次の操作を出す', async ({ page }) => {
  let failing = true
  const mocks = newMocks({
    report: ({ storeId, granularity }) => {
      if (failing) return { status: 500, json: { message: 'aggregation failed' } }
      return {
        status: 200,
        json: fullReport({
          storeId,
          granularity,
          overrides: {
            totalCount: 0,
            status: 'empty',
            reason: '対象期間に集計できる来店がありませんでした。',
            nextAction: '対象日を変えるか、集計粒度を広げてください。',
            metrics: [],
            breakdowns: [],
            stageDistributions: [],
            funnel: {
              sessionCount: 0,
              suppressed: false,
              suppressionReason: null,
              steps: [],
              largestDropStage: null,
            },
            exclusions: [],
            qualityWarnings: [],
            causeCandidates: [],
          },
        }),
      }
    },
  })
  await mockStaffApi(page, mocks)
  await openAdmin(page, '分析')

  // 集計失敗: 数値を出さないことまで言い切り、次の操作を渡す (UC-EYEX-108)。
  await expect(
    page.getByText(
      '集計を読み込めませんでした。通信を確認してもう一度お試しください。数値は表示していません。',
    ),
  ).toBeVisible()
  await expect(page.getByRole('main')).not.toContainText('対象件数')

  failing = false
  await page.getByRole('button', { name: '再試行する' }).click()

  // 空の期間: 0 を並べずに、理由と次の操作を出す (UC-EYEX-108)。
  await expect(page.getByText('対象期間に集計できる来店がありませんでした。')).toBeVisible()
  await expect(page.getByText('対象日を変えるか、集計粒度を広げてください。')).toBeVisible()
  await expect(page.getByRole('region', { name: '予約', exact: true })).toHaveCount(0)
  await expect(page.getByText('対象件数 0件')).toBeVisible()
})

// @e2e-covers UC-EYEX-178 AC-EYEX-120
test('お知らせとアラートは詳細で発生理由・対象・発生時刻・次の操作を出し、既読と対応済みを別々に記録する', async ({
  page,
}) => {
  const mocks = newMocks()
  await mockStaffApi(page, mocks)
  await openAlerts(page)

  // 一覧では種別と、既読・対応の二つの状態が別々に並ぶ (UC-EYEX-178)。
  await expect(page.getByRole('button', { name: /営業時間の設定が矛盾しています/ })).toBeVisible()
  const row = page.getByRole('button', { name: /録音の保存に失敗しました/ })
  await expect(row).toContainText('未読')
  await expect(row).toContainText('未対応')

  // 種別で絞り込める。
  await page.getByLabel('種別').selectOption('alert')
  await expect(page.getByRole('button', { name: /営業時間の設定が矛盾しています/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /録音の保存に失敗しました/ })).toBeVisible()

  await page.getByRole('button', { name: /録音の保存に失敗しました/ }).click()
  const dialog = page.getByRole('dialog', { name: '録音の保存に失敗しました' })
  await expect(dialog).toBeVisible()

  // 発生理由・対象・発生時刻・次の操作 (AC-EYEX-120)。
  await expect(dialog).toContainText('接客記録の音声を保存できませんでした。')
  await expect(dialog).toContainText('銀座店 14時台の接客')
  await expect(dialog).toContainText('2026-08-27 14:00 JST')
  await expect(dialog).toContainText('録音運用画面で再保存するか、要点を手入力してください。')
  await expect(dialog).toContainText('未読')
  await expect(dialog).toContainText('未対応')

  // 既読にする。対応済みは進まない (AC-EYEX-120)。
  await dialog.getByRole('button', { name: '既読にする' }).click()
  await expect(dialog).toContainText('既読')
  await expect(dialog).toContainText('未対応')
  await expect(dialog.getByRole('button', { name: '対応済みにする' })).toBeEnabled()
  expect(mocks.alerts.find((entry) => entry.id === alertId)?.resolvedAt).toBeNull()

  // 対応内容が無いまま対応済みにはできない。
  await dialog.getByRole('button', { name: '対応済みにする' }).click()
  await expect(dialog.getByText('対応内容を入力してください。')).toBeVisible()
  expect(mocks.requests.filter((entry) => entry.url.endsWith('/resolve'))).toEqual([])

  await dialog.getByLabel('対応内容').fill('録音を再保存し、要点を手入力した')
  await dialog.getByRole('button', { name: '対応済みにする' }).click()
  await expect(dialog).toContainText('対応済み')
  await expect(dialog).toContainText('録音を再保存し、要点を手入力した')

  // 二つの事実は別々の要求として記録されている。
  const read = mocks.requests.filter((entry) => entry.url.endsWith('/read'))
  const resolve = mocks.requests.filter((entry) => entry.url.endsWith('/resolve'))
  expect(read).toHaveLength(1)
  expect(resolve).toHaveLength(1)
  expect(JSON.parse(resolve[0]?.body ?? '{}')).toEqual({
    note: '録音を再保存し、要点を手入力した',
  })

  // 一覧に戻っても既読と対応済みは別々に見える。
  await dialog.getByRole('button', { name: '閉じる' }).click()
  const updated = page.getByRole('button', { name: /録音の保存に失敗しました/ })
  await expect(updated).toContainText('既読')
  await expect(updated).toContainText('対応済み')

  // 触っていないお知らせは未読・未対応のまま。
  const untouched = mocks.alerts.find((entry) => entry.id === noticeId)
  expect(untouched?.readAt).toBeNull()
  expect(untouched?.resolvedAt).toBeNull()
})

// @e2e-covers UC-EYEX-179
test('管理者は待ち時間・録音保存失敗・設定矛盾の警告条件と通知先を設定できる', async ({ page }) => {
  const mocks = newMocks()
  await mockStaffApi(page, mocks)
  await openAlerts(page)

  const settings = page.getByRole('region', { name: '警告条件と通知先' })
  await expect(settings).toBeVisible()
  await expect(settings.getByLabel('待ち時間の超過')).toBeChecked()
  await expect(settings.getByLabel('録音の保存失敗')).toBeChecked()
  await expect(settings.getByLabel('設定の矛盾')).not.toBeChecked()
  await expect(page.getByLabel('待ち時間の閾値（分）')).toHaveValue('30')
  await expect(page.getByLabel('通知先メールアドレス')).toHaveValue('ginza-manager@example.com')

  // 条件を入れ替え、閾値と通知先を変える (UC-EYEX-179)。
  await settings.getByLabel('設定の矛盾').check()
  await settings.getByLabel('録音の保存失敗').uncheck()
  await page.getByLabel('待ち時間の閾値（分）').fill('20')
  await page
    .getByLabel('通知先メールアドレス')
    .fill('ginza-manager@example.com, area-manager@example.com')
  await page.getByRole('button', { name: '警告条件を保存する' }).click()
  await expect(page.getByText('警告条件を保存しました。')).toBeVisible()

  const put = mocks.requests.find(
    (entry) => entry.method === 'PUT' && entry.url.endsWith('/alert-settings'),
  )
  expect(put).toBeDefined()
  expect(JSON.parse(put?.body ?? '{}')).toEqual({
    conditions: [
      { code: 'long_wait', enabled: true, thresholdMinutes: 20 },
      { code: 'recording_save_failure', enabled: false, thresholdMinutes: null },
      { code: 'settings_contradiction', enabled: true, thresholdMinutes: null },
    ],
    notificationTargets: ['ginza-manager@example.com', 'area-manager@example.com'],
  })

  // 保存後の値はサーバの応答から描き直される。
  await expect(page.getByLabel('待ち時間の閾値（分）')).toHaveValue('20')
  await expect(settings.getByLabel('設定の矛盾')).toBeChecked()
})
