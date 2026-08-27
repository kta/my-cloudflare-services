import { expect, type Page, test } from '@playwright/test'

/*
 * EYEX スタッフ端末「店舗設定ガイド」第6工程（影響確認と公開）の E2E。
 *
 * 下書き → 影響確認 → 公開 → 版履歴 は一本の閉ループで、途中を飛ばせないこと
 * 自体が仕様である。ここでは API をすべて `page.route` で差し替え、SPA が
 * その閉ループをブラウザ上で本当に守っているかだけを見る。
 *
 * 共有 iPad（横向き 1180×820）が既定の前提なので viewport をそれに合わせる。
 */

const VIEWPORT = { width: 1180, height: 820 }

const ginzaId = '11111111-1111-4111-8111-111111111111'
const marunouchiId = '22222222-2222-4222-8222-222222222222'

const draftId = '00000000-0000-4000-8000-0000000000d1'
const restoredDraftId = '00000000-0000-4000-8000-0000000000d2'
const chainDraftId = '00000000-0000-4000-8000-0000000000d3'
const publicationId = '00000000-0000-4000-8000-0000000000f1'
const versionId = '00000000-0000-4000-8000-0000000000e1'
const pastVersionId = '00000000-0000-4000-8000-0000000000e2'
const conflictAId = '00000000-0000-4000-8000-0000000000a1'
const conflictBId = '00000000-0000-4000-8000-0000000000a2'
const conflictCId = '00000000-0000-4000-8000-0000000000a3'

const ALL_SETTINGS_PERMISSIONS = [
  'store.read',
  'reservation.read',
  'settings.read',
  'settings.manage',
]

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

/** `AvailabilityStoreSettings` を満たす最小構成。この工程は中身を編集しない。 */
const settings = {
  storeId: ginzaId,
  version: 3,
  receptionStatus: 'open' as 'open' | 'paused' | 'closed',
  businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
  exceptions: [{ date: '2026-09-23', mode: 'closed' as const, periods: [], reason: '棚卸し' }],
  purposes: [],
  staff: [],
  shifts: [],
  equipment: [],
  maintenance: [],
}

type Draft = {
  id: string
  storeId: string
  draftVersion: number
  baseVersion: number
  status: 'draft' | 'review' | 'scheduled' | 'published' | 'cancelled'
  origin: 'chain' | 'store_override'
  restoredFromVersionId: string | null
  savedAt: string
  savedBy: string
  settings: typeof settings
}

function draftFixture(overrides: Partial<Draft> = {}): Draft {
  return {
    id: draftId,
    storeId: ginzaId,
    draftVersion: 4,
    baseVersion: 3,
    status: 'draft',
    origin: 'store_override',
    restoredFromVersionId: null,
    savedAt: '2026-08-26T09:05:00.000Z',
    savedBy: '山田 太郎',
    settings,
    ...overrides,
  }
}

type ImpactItem = {
  kind:
    | 'reservation_conflict'
    | 'missing_staff_skill'
    | 'missing_equipment'
    | 'out_of_hours'
    | 'web_slot_change'
  severity: 'blocking' | 'warning' | 'info'
  reservationId: string | null
  message: string
  resolution: 'alternative_resource' | 'keep_exception' | 'customer_contacted' | null
}

type Impact = {
  draftId: string
  storeId: string
  evaluatedAt: string
  blockingCount: number
  warningCount: number
  canPublish: boolean
  ledgerEntriesAffected: number
  publicSlots: { date: string; publishedCount: number; draftCount: number }
  items: ImpactItem[]
}

/** 競合3件（未解消）+ 技能不足 + 設備不足 + 営業時間外 + Web枠変化。 */
function blockedImpact(): Impact {
  return {
    draftId,
    storeId: ginzaId,
    evaluatedAt: '2026-08-26T09:06:00.000Z',
    blockingCount: 3,
    warningCount: 2,
    canPublish: false,
    ledgerEntriesAffected: 18,
    publicSlots: { date: '2026-08-27', publishedCount: 42, draftCount: 38 },
    items: [
      {
        kind: 'reservation_conflict',
        severity: 'blocking',
        reservationId: conflictAId,
        message: '9/1 10:00 検査の予約が営業時間外になります',
        resolution: null,
      },
      {
        kind: 'reservation_conflict',
        severity: 'blocking',
        reservationId: conflictBId,
        message: '9/2 15:00 の予約で使う視力測定機が停止します',
        resolution: null,
      },
      {
        kind: 'reservation_conflict',
        severity: 'blocking',
        reservationId: conflictCId,
        message: '9/23 の臨時休業と既存予約が重なります',
        resolution: null,
      },
      {
        kind: 'missing_staff_skill',
        severity: 'warning',
        reservationId: null,
        message: '眼鏡作製技能を持つスタッフが勤務していません',
        resolution: null,
      },
      {
        kind: 'missing_equipment',
        severity: 'warning',
        reservationId: null,
        message: '視力測定機が1台不足します',
        resolution: null,
      },
      {
        kind: 'out_of_hours',
        severity: 'info',
        reservationId: null,
        message: '9/23 は営業時間外の設定です',
        resolution: null,
      },
      {
        kind: 'web_slot_change',
        severity: 'info',
        reservationId: null,
        message: 'Web公開枠が4件減ります',
        resolution: null,
      },
    ],
  }
}

function cleanImpact(): Impact {
  return {
    ...blockedImpact(),
    blockingCount: 0,
    warningCount: 0,
    canPublish: true,
    items: [
      {
        kind: 'web_slot_change',
        severity: 'info',
        reservationId: null,
        message: 'Web公開枠が4件減ります',
        resolution: null,
      },
    ],
  }
}

type Target = {
  storeId: string
  status: 'pending' | 'applied' | 'failed'
  appliedVersion: number | null
  failureReason: string | null
  appliedAt: string | null
}

type Publication = {
  id: string
  versionId: string
  draftId: string
  status: 'scheduled' | 'completed' | 'partially_failed' | 'cancelled'
  scheduledForJst: string | null
  scheduledAt: string | null
  executedAt: string | null
  appliedCount: number
  failedCount: number
  ledgerEntriesAffected: number
  webSlotEffect: { date: string; previousSlotCount: number; publishedSlotCount: number }
  targets: Target[]
}

const versionSummary = {
  versionId: pastVersionId,
  storeId: ginzaId,
  version: 3,
  origin: 'store_override' as const,
  publishedAt: '2026-08-20T09:00:00.000Z',
  publishedBy: '佐藤 美咲',
  changedFields: ['receptionStatus', 'purposes'],
}

const versionDetail = {
  ...versionSummary,
  settings,
  diff: [
    { field: 'receptionStatus', before: '"open"', after: '"paused"' },
    { field: 'purposes', before: '[{"id":"a"},{"id":"b"}]', after: '[{"id":"a"}]' },
  ],
}

type Call = { url: string; method: string; body: unknown; postData: string | null }

type Mock = {
  permissions: string[]
  draft: Draft
  impact: Impact
  override: {
    storeId: string
    origin: 'chain' | 'store_override'
    chainVersion: number
    overriddenFields: string[]
  }
  versions: (typeof versionSummary)[]
  publication?: Publication
  /** 復元・上書き解除の後に返す影響。閉ループを飛ばせないことを見るために差し替える。 */
  nextImpact?: Impact
  onPublish?: (body: Record<string, unknown>) => Publication
  onRetry?: (current: Publication) => Publication
  calls: Call[]
  impactRequests: number
}

function callsTo(mock: Mock, suffix: string, method: string): Call[] {
  return mock.calls.filter((call) => call.method === method && call.url.includes(suffix))
}

function publicationFixture(overrides: Partial<Publication> = {}): Publication {
  return {
    id: publicationId,
    versionId,
    draftId,
    status: 'completed',
    scheduledForJst: null,
    scheduledAt: null,
    executedAt: '2026-08-26T10:30:00.000Z',
    appliedCount: 2,
    failedCount: 0,
    ledgerEntriesAffected: 18,
    webSlotEffect: { date: '2026-08-27', previousSlotCount: 428, publishedSlotCount: 402 },
    targets: [
      {
        storeId: ginzaId,
        status: 'applied',
        appliedVersion: 4,
        failureReason: null,
        appliedAt: '2026-08-26T10:30:00.000Z',
      },
      {
        storeId: marunouchiId,
        status: 'applied',
        appliedVersion: 4,
        failureReason: null,
        appliedAt: '2026-08-26T10:30:00.000Z',
      },
    ],
    ...overrides,
  }
}

async function mockPublicationApi(page: Page, initial: Partial<Mock> = {}): Promise<Mock> {
  const mock: Mock = {
    permissions: [...ALL_SETTINGS_PERMISSIONS],
    draft: draftFixture(),
    impact: blockedImpact(),
    override: {
      storeId: ginzaId,
      origin: 'store_override',
      chainVersion: 7,
      overriddenFields: ['businessHours', 'purposes'],
    },
    versions: [versionSummary],
    calls: [],
    impactRequests: 0,
    ...initial,
  }

  const record = (page_url: string, method: string, postData: string | null) => {
    mock.calls.push({
      url: page_url,
      method,
      postData,
      body: postData === null || postData === '' ? undefined : (JSON.parse(postData) as unknown),
    })
  }

  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ json: { token: 'staff-e2e' } }),
  )
  await page.route('**/api/staff/stores', (route) => route.fulfill({ json: stores }))
  await page.route('**/api/staff/store-switches', (route) =>
    route.fulfill({ status: 201, json: {} }),
  )
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({ json: mock.permissions }),
  )
  // 工程1〜5 が読む公開中の設定。第6工程は下書き側だけを見る。
  await page.route('**/api/staff/stores/*/availability/settings', async (route) => {
    record(route.request().url(), route.request().method(), route.request().postData())
    await route.fulfill({ json: { ...mock.draft.settings, storeId: ginzaId } })
  })

  await page.route('**/availability/draft', async (route) => {
    const request = route.request()
    record(request.url(), request.method(), request.postData())
    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as { status: 'draft' | 'review' }
      mock.draft = { ...mock.draft, status: body.status, savedAt: '2026-08-26T09:40:00.000Z' }
    }
    await route.fulfill({ json: mock.draft })
  })

  await page.route('**/availability/draft/impact', async (route) => {
    mock.impactRequests += 1
    record(route.request().url(), route.request().method(), route.request().postData())
    await route.fulfill({ json: mock.impact })
  })

  await page.route('**/availability/draft/conflicts/*', async (route) => {
    const request = route.request()
    record(request.url(), request.method(), request.postData())
    const reservationId = request.url().split('/').pop() ?? ''
    const body = request.postDataJSON() as { resolution: ImpactItem['resolution']; note: string }
    // サーバと同じく、記録したぶんだけブロッキングが減る。
    mock.impact = {
      ...mock.impact,
      items: mock.impact.items.map((item) =>
        item.reservationId === reservationId ? { ...item, resolution: body.resolution } : item,
      ),
    }
    const remaining = mock.impact.items.filter(
      (item) => item.severity === 'blocking' && item.resolution === null,
    ).length
    mock.impact = { ...mock.impact, blockingCount: remaining, canPublish: remaining === 0 }
    await route.fulfill({
      json: {
        draftId: mock.draft.id,
        reservationId,
        resolution: body.resolution,
        note: body.note,
        resolvedBy: '山田 太郎',
        resolvedAt: '2026-08-26T09:30:00.000Z',
      },
    })
  })

  await page.route('**/availability/publications', async (route) => {
    const request = route.request()
    record(request.url(), request.method(), request.postData())
    const body = request.postDataJSON() as Record<string, unknown>
    mock.publication =
      mock.onPublish === undefined
        ? publicationFixture(
            body.scheduledForJst === undefined
              ? {}
              : {
                  status: 'scheduled',
                  scheduledForJst: String(body.scheduledForJst),
                  scheduledAt: '2026-08-26T09:00:00.000Z',
                  executedAt: null,
                  appliedCount: 0,
                  ledgerEntriesAffected: 0,
                  targets: [
                    {
                      storeId: ginzaId,
                      status: 'pending',
                      appliedVersion: null,
                      failureReason: null,
                      appliedAt: null,
                    },
                  ],
                },
          )
        : mock.onPublish(body)
    await route.fulfill({ status: 201, json: mock.publication })
  })

  await page.route('**/availability/publications/*', async (route) => {
    const request = route.request()
    record(request.url(), request.method(), request.postData())
    const body = request.postDataJSON() as { scheduledForJst?: string; status?: 'cancelled' }
    const current = mock.publication
    if (current === undefined) {
      await route.fulfill({ status: 404, json: { error: 'not_found' } })
      return
    }
    mock.publication =
      body.status === 'cancelled'
        ? { ...current, status: 'cancelled', scheduledForJst: null }
        : { ...current, scheduledForJst: body.scheduledForJst ?? current.scheduledForJst }
    await route.fulfill({ json: mock.publication })
  })

  await page.route('**/availability/publications/*/run', async (route) => {
    const request = route.request()
    record(request.url(), request.method(), request.postData())
    const current = mock.publication
    if (current === undefined) {
      await route.fulfill({ status: 404, json: { error: 'not_found' } })
      return
    }
    mock.publication = { ...current, status: 'completed', executedAt: '2026-08-26T10:30:00.000Z' }
    await route.fulfill({ json: mock.publication })
  })

  await page.route('**/availability/publications/*/retry', async (route) => {
    const request = route.request()
    record(request.url(), request.method(), request.postData())
    const current = mock.publication
    if (current === undefined) {
      await route.fulfill({ status: 404, json: { error: 'not_found' } })
      return
    }
    mock.publication = mock.onRetry === undefined ? current : mock.onRetry(current)
    await route.fulfill({ json: mock.publication })
  })

  await page.route('**/availability/versions', async (route) => {
    record(route.request().url(), route.request().method(), route.request().postData())
    await route.fulfill({ json: mock.versions })
  })

  await page.route('**/availability/versions/*', async (route) => {
    record(route.request().url(), route.request().method(), route.request().postData())
    await route.fulfill({ json: versionDetail })
  })

  await page.route('**/availability/versions/*/restore', async (route) => {
    record(route.request().url(), route.request().method(), route.request().postData())
    mock.draft = draftFixture({
      id: restoredDraftId,
      draftVersion: 5,
      status: 'draft',
      restoredFromVersionId: pastVersionId,
      savedAt: '2026-08-26T11:00:00.000Z',
      savedBy: '山田 太郎',
    })
    if (mock.nextImpact !== undefined) mock.impact = mock.nextImpact
    await route.fulfill({ status: 201, json: mock.draft })
  })

  await page.route('**/availability/override', async (route) => {
    record(route.request().url(), route.request().method(), route.request().postData())
    await route.fulfill({ json: mock.override })
  })

  await page.route('**/availability/override/release', async (route) => {
    record(route.request().url(), route.request().method(), route.request().postData())
    mock.draft = draftFixture({
      id: chainDraftId,
      draftVersion: 6,
      origin: 'chain',
      savedAt: '2026-08-26T12:00:00.000Z',
    })
    if (mock.nextImpact !== undefined) mock.impact = mock.nextImpact
    await route.fulfill({
      status: 201,
      json: { chainVersion: mock.override.chainVersion, draft: mock.draft, impact: mock.impact },
    })
  })

  return mock
}

/** ホーム → ヘッダー「店舗設定」→ 工程6「影響確認と公開」。 */
async function openImpactStep(page: Page) {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')
  await page
    .getByRole('navigation', { name: '管理メニュー' })
    .getByRole('button', { name: '店舗設定' })
    .click()
  await expect(page.getByRole('region', { name: '店舗設定' })).toBeVisible()
  await page
    .getByRole('navigation', { name: '設定工程' })
    .getByRole('button', { name: /^工程6 影響確認と公開/ })
    .click()
  const region = page.getByRole('region', { name: '影響確認と公開' })
  await expect(region.getByRole('heading', { name: '影響を確認して公開' })).toBeVisible()
  return region
}

// @e2e-covers UC-EYEX-095 UC-EYEX-096 UC-EYEX-159 AC-EYEX-45
test('下書きの保存状態・最終保存時刻・変更者が読め、状態と警告が別の区画に分かれている', async ({
  page,
}) => {
  const mock = await mockPublicationApi(page)
  const region = await openImpactStep(page)

  const state = region.getByRole('group', { name: '設定の状態' })
  // AC-EYEX-45: 画面を離れる前に、保存されているのか・いつの保存なのかが読める。
  await expect(state.getByText('未保存', { exact: true })).toBeVisible()
  // UC-EYEX-096: 保存済み UTC は JST の壁時計として読み返される（09:05Z → 18:05）。
  await expect(state.getByText('最終保存 2026年8月26日 18:05')).toBeVisible()
  await expect(state.getByText('変更者 山田 太郎')).toBeVisible()

  // UC-EYEX-095: 下書きのまま保存でき、権限者の確認へ回せる。
  await region.getByRole('button', { name: '確認へ回す' }).click()
  await expect(region.getByText('確認へ回しました。')).toBeVisible()
  const saved = callsTo(mock, '/availability/draft', 'PUT')
  expect(saved).toHaveLength(1)
  expect((saved[0]?.body as { status?: string } | undefined)?.status).toBe('review')
  await expect(state.getByText('確認待ち', { exact: true })).toBeVisible()
  await expect(state.getByText('最終保存 2026年8月26日 18:40')).toBeVisible()

  // ガイド全体を保存すると未保存が解消する。
  await page.getByRole('button', { name: '設定を保存' }).click()
  await expect(state.getByText('保存済み', { exact: true })).toBeVisible()

  // UC-EYEX-159: 競合は「状態」ではなく別区画の「警告」。
  const warnings = region.getByRole('group', { name: '警告' })
  await expect(warnings.getByText('影響予約3件が未解消です')).toBeVisible()
  await expect(warnings.getByText('警告2件')).toBeVisible()
  await expect(state).not.toContainText('未解消')
  await expect(warnings).not.toContainText('最終保存')

  // UC-EYEX-159: 状態は 下書き / 確認待ち / 公開予約 / 公開中 / 受付停止 の5つ。
  const cases: { draft: Partial<Draft>; label: string }[] = [
    { draft: { status: 'draft' }, label: '下書き' },
    { draft: { status: 'review' }, label: '確認待ち' },
    { draft: { status: 'scheduled' }, label: '公開予約' },
    { draft: { status: 'published' }, label: '公開中' },
    {
      draft: {
        status: 'published',
        settings: { ...settings, receptionStatus: 'paused' as const },
      },
      label: '受付停止',
    },
  ]
  for (const item of cases) {
    mock.draft = draftFixture(item.draft)
    const reopened = await openImpactStep(page)
    await expect(
      reopened.getByRole('group', { name: '設定の状態' }).getByText(item.label, { exact: true }),
    ).toBeVisible()
  }
})

// @e2e-covers UC-EYEX-093 UC-EYEX-097 UC-EYEX-115 AC-EYEX-43 AC-EYEX-44 AC-EYEX-46 AC-EYEX-66
test('影響確認は競合予約・Web公開枠・技能不足・設備不足・営業時間外を一覧し、重大度を色ではなく語で示す', async ({
  page,
}) => {
  await mockPublicationApi(page)
  const region = await openImpactStep(page)
  const impact = region.getByRole('group', { name: '影響確認' })

  // AC-EYEX-66 / UC-EYEX-115: 公開予定枠数と台帳件数。
  await expect(impact.getByText('公開枠 42件 → 38件（-4件）')).toBeVisible()
  await expect(impact.getByText('影響する台帳 18件')).toBeVisible()
  await expect(impact.getByText('確認日時 2026年8月26日 18:06')).toBeVisible()

  // AC-EYEX-46: 既存予約の競合が予約単位で並ぶ。
  const conflicts = impact.getByRole('group', { name: '既存予約との競合' })
  await expect(conflicts.getByRole('listitem')).toHaveCount(3)
  await expect(conflicts.getByText('9/1 10:00 検査の予約が営業時間外になります')).toBeVisible()

  // AC-EYEX-43 / AC-EYEX-44 / UC-EYEX-097: 技能不足・設備不足・営業時間外設定。
  await expect(
    impact
      .getByRole('group', { name: '技能不足' })
      .getByText('眼鏡作製技能を持つスタッフが勤務していません'),
  ).toBeVisible()
  await expect(
    impact.getByRole('group', { name: '設備不足' }).getByText('視力測定機が1台不足します'),
  ).toBeVisible()
  await expect(
    impact.getByRole('group', { name: '営業時間外設定' }).getByText('9/23 は営業時間外の設定です'),
  ).toBeVisible()
  await expect(
    impact.getByRole('group', { name: 'Web公開枠の変化' }).getByText('Web公開枠が4件減ります'),
  ).toBeVisible()

  // 重大度は語で読める。色に頼らない（重い順に並ぶ）。
  const groupNames = await impact
    .getByRole('group')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''))
  expect(groupNames).toEqual([
    '既存予約との競合',
    '技能不足',
    '設備不足',
    '営業時間外設定',
    'Web公開枠の変化',
  ])
  await expect(conflicts.getByText('要対応')).toBeVisible()
  await expect(impact.getByRole('group', { name: '技能不足' }).getByText('警告')).toBeVisible()
  await expect(
    impact.getByRole('group', { name: '営業時間外設定' }).getByText('情報'),
  ).toBeVisible()

  // UC-EYEX-093: 公開前に何度でも確認し直せる。
  await impact.getByRole('button', { name: '影響を再確認' }).click()
  await expect(impact.getByText('確認日時 2026年8月26日 18:06')).toBeVisible()
})

// @e2e-covers UC-EYEX-165 AC-EYEX-109
test('未解消の競合予約がある間は公開できず、代替資源割当・例外維持・顧客連絡を記録してはじめて公開できる', async ({
  page,
}) => {
  const mock = await mockPublicationApi(page)
  const region = await openImpactStep(page)
  const impact = region.getByRole('group', { name: '影響確認' })
  const publishPanel = region.getByRole('group', { name: '公開' })

  // AC-EYEX-109: ブロッキング項目が残る間は公開しない。
  await expect(publishPanel.getByRole('button', { name: '今すぐ公開する' })).toBeDisabled()
  await expect(publishPanel.getByRole('button', { name: '公開を予約する' })).toBeDisabled()
  await expect(
    impact.getByText(
      '影響予約ごとに代替資源割当・例外維持・顧客連絡のいずれかを記録してください。',
    ),
  ).toBeVisible()

  const kinds: { label: string; value: string; note: string }[] = [
    { label: '代替資源割当', value: 'alternative_resource', note: '第2診察室へ移動' },
    { label: '例外維持', value: 'keep_exception', note: 'この日は例外のまま' },
    { label: '顧客連絡', value: 'customer_contacted', note: '電話で日程変更を合意' },
  ]
  const conflicts = impact.getByRole('group', { name: '既存予約との競合' })
  for (const kind of kinds) {
    await conflicts.getByRole('button', { name: '解消を記録' }).first().click()
    const dialog = page.getByRole('dialog', { name: '影響予約の解消を記録' })
    await dialog.getByLabel('対応').selectOption(kind.value)
    await dialog.getByLabel('メモ').fill(kind.note)
    await dialog.getByRole('button', { name: '記録する' }).click()
    await expect(dialog).toBeHidden()
    await expect(conflicts.getByText(kind.label)).toBeVisible()
  }

  // 記録は予約単位で、対応と本文がそのまま送られる。
  const recorded = mock.calls.filter(
    (call) => call.method === 'POST' && call.url.includes('/availability/draft/conflicts/'),
  )
  expect(recorded.map((call) => call.url.split('/').pop())).toEqual([
    conflictAId,
    conflictBId,
    conflictCId,
  ])
  expect(recorded.map((call) => call.body)).toEqual([
    { resolution: 'alternative_resource', note: '第2診察室へ移動' },
    { resolution: 'keep_exception', note: 'この日は例外のまま' },
    { resolution: 'customer_contacted', note: '電話で日程変更を合意' },
  ])

  // 記録し終えてはじめて公開できる。警告区画からも未解消の表示が消える。
  await expect(publishPanel.getByRole('button', { name: '今すぐ公開する' })).toBeEnabled()
  await expect(region.getByText('影響予約3件が未解消です')).toBeHidden()
})

// @e2e-covers UC-EYEX-094 UC-EYEX-161 UC-EYEX-166 AC-EYEX-64 AC-EYEX-105
test('JSTで指定した公開予約は、実行前に再検証・日時変更・取消ができる', async ({ page }) => {
  const mock = await mockPublicationApi(page, { impact: cleanImpact() })
  const region = await openImpactStep(page)
  const publishPanel = region.getByRole('group', { name: '公開' })

  // UC-EYEX-166: 過去の日時は境界で拒否され、要求は送られない。
  await publishPanel.getByLabel('公開日時（JST）').fill('2020-01-01T09:00')
  await publishPanel.getByRole('button', { name: '公開を予約する' }).click()
  await expect(publishPanel.getByText('過去の日時は指定できません。')).toBeVisible()
  expect(callsTo(mock, '/availability/publications', 'POST')).toHaveLength(0)

  // AC-EYEX-64 / UC-EYEX-094: 指定日時までは適用されず、公開予約として記録される。
  await publishPanel.getByLabel('公開日時（JST）').fill('2099-01-01T00:00')
  await publishPanel.getByRole('button', { name: '公開を予約する' }).click()
  const requested = callsTo(mock, '/availability/publications', 'POST')
  expect(requested).toHaveLength(1)
  const body = (requested[0]?.body ?? {}) as Record<string, unknown>
  expect(body.draftId).toBe(draftId)
  expect(body.targetStoreIds).toEqual([ginzaId])
  expect(body.scheduledForJst).toBe('2099-01-01T00:00')

  // AC-EYEX-105: 予定日時・対象店舗・版が読める。JSTの 00:00 が UTC 往復でずれない。
  const result = region.getByRole('group', { name: '公開結果' })
  await expect(result.getByText('公開予約')).toBeVisible()
  await expect(result.getByText(`版 ${versionId}`)).toBeVisible()
  await expect(result.getByText('公開予定 2099年1月1日 00:00')).toBeVisible()
  await expect(result.getByText('実行日時 未実行')).toBeVisible()

  // UC-EYEX-161: 実行前の再検証。
  const before = mock.impactRequests
  await region
    .getByRole('group', { name: '影響確認' })
    .getByRole('button', { name: '影響を再確認' })
    .click()
  await expect.poll(() => mock.impactRequests).toBe(before + 1)

  // UC-EYEX-161: 公開予定の変更。
  await result.getByRole('button', { name: '公開予定を変更' }).click()
  const dialog = page.getByRole('dialog', { name: '公開予定の変更' })
  await dialog.getByLabel('新しい公開日時（JST）').fill('2099-01-02T09:30')
  await dialog.getByRole('button', { name: 'この日時に変更' }).click()
  await expect(dialog).toBeHidden()
  await expect(result.getByText('公開予定 2099年1月2日 09:30')).toBeVisible()

  // UC-EYEX-161: 公開予定の取消。取消後は変更手段も消える。
  await result.getByRole('button', { name: '公開予定を取消' }).click()
  await expect(result.getByText('取消')).toBeVisible()
  const patched = callsTo(mock, `/availability/publications/${publicationId}`, 'PATCH')
  expect(patched.map((call) => call.body)).toEqual([
    { scheduledForJst: '2099-01-02T09:30' },
    { status: 'cancelled' },
  ])
  await expect(result.getByRole('button', { name: '公開予定を取消' })).toBeHidden()
  await expect(result.getByRole('button', { name: '公開予定を変更' })).toBeHidden()
})

// @e2e-covers UC-EYEX-162 AC-EYEX-106
test('公開結果は版ID・対象店舗・成功件数・失敗件数とWeb枠および台帳への反映を示す', async ({
  page,
}) => {
  await mockPublicationApi(page, { impact: cleanImpact() })
  const region = await openImpactStep(page)
  await region
    .getByRole('group', { name: '公開' })
    .getByRole('button', { name: '今すぐ公開する' })
    .click()

  const result = region.getByRole('group', { name: '公開結果' })
  await expect(result.getByText('完了')).toBeVisible()
  await expect(result.getByText(`版 ${versionId}`)).toBeVisible()
  await expect(result.getByText('成功 2店舗')).toBeVisible()
  await expect(result.getByText('失敗 0店舗')).toBeVisible()
  await expect(result.getByText('Web公開枠 428件 → 402件（-26件）')).toBeVisible()
  await expect(result.getByText('予約台帳 18件反映')).toBeVisible()
  await expect(result.getByText('実行日時 2026年8月26日 19:30')).toBeVisible()

  const applied = result.getByRole('group', { name: '反映済みの店舗' })
  await expect(applied.getByRole('listitem')).toHaveCount(2)
  await expect(applied.getByRole('listitem').first()).toContainText(ginzaId)
  await expect(applied.getByRole('listitem').first()).toContainText('第4版')
  await expect(applied.getByRole('listitem').nth(1)).toContainText(marunouchiId)
  await expect(result.getByRole('group', { name: '失敗した店舗' })).toBeHidden()
})

// @e2e-covers UC-EYEX-163 AC-EYEX-107
test('部分失敗の再試行は失敗店舗だけを対象とし、成功済み店舗へ同じ版を重複適用しない', async ({
  page,
}) => {
  const partiallyFailed = publicationFixture({
    status: 'partially_failed',
    appliedCount: 1,
    failedCount: 1,
    targets: [
      {
        storeId: ginzaId,
        status: 'applied',
        appliedVersion: 4,
        failureReason: null,
        appliedAt: '2026-08-26T10:30:00.000Z',
      },
      {
        storeId: marunouchiId,
        status: 'failed',
        appliedVersion: null,
        failureReason: '視力測定機が停止中',
        appliedAt: null,
      },
    ],
  })
  const mock = await mockPublicationApi(page, {
    impact: cleanImpact(),
    onPublish: () => partiallyFailed,
    onRetry: (current) => ({
      ...current,
      status: 'completed',
      appliedCount: 2,
      failedCount: 0,
      targets: current.targets.map((target) =>
        target.status === 'failed'
          ? {
              ...target,
              status: 'applied' as const,
              appliedVersion: 4,
              failureReason: null,
              appliedAt: '2026-08-26T10:45:00.000Z',
            }
          : target,
      ),
    }),
  })

  const region = await openImpactStep(page)
  await region
    .getByRole('group', { name: '公開' })
    .getByRole('button', { name: '今すぐ公開する' })
    .click()

  const result = region.getByRole('group', { name: '公開結果' })
  await expect(result.getByText('一部失敗')).toBeVisible()
  await expect(
    region.getByRole('group', { name: '警告' }).getByText('1店舗で公開が失敗しました'),
  ).toBeVisible()

  // AC-EYEX-107: 再試行対象は失敗店舗だけで、成功済み店舗は入らない。
  const failedGroup = result.getByRole('group', { name: '失敗した店舗' })
  await expect(failedGroup.getByText('再試行対象 1店舗')).toBeVisible()
  await expect(failedGroup.getByRole('listitem')).toHaveCount(1)
  await expect(failedGroup).toContainText(marunouchiId)
  await expect(failedGroup).toContainText('視力測定機が停止中')
  await expect(failedGroup).not.toContainText(ginzaId)

  await failedGroup.getByRole('button', { name: '失敗した店舗だけ再試行' }).click()
  await expect(result.getByText('完了')).toBeVisible()

  const retried = callsTo(mock, `/availability/publications/${publicationId}/retry`, 'POST')
  expect(retried).toHaveLength(1)
  // 成功済み店舗を要求に含めない（本文そのものを持たない）。
  expect(retried[0]?.postData ?? '').toBe('')
  expect(retried[0]?.postData ?? '').not.toContain(ginzaId)

  // 成功済みの銀座店は第4版のまま。同じ版を二度当てていない。
  const applied = result.getByRole('group', { name: '反映済みの店舗' })
  await expect(applied.getByRole('listitem').filter({ hasText: ginzaId })).toContainText('第4版')
  await expect(result.getByText('成功 2店舗')).toBeVisible()
  await expect(result.getByText('失敗 0店舗')).toBeVisible()
})

// @e2e-covers UC-EYEX-164 AC-EYEX-108
test('過去版は差分を確認できるが直接は再公開できず、復元は新しい下書きになり影響確認をやり直す', async ({
  page,
}) => {
  const mock = await mockPublicationApi(page, {
    impact: cleanImpact(),
    nextImpact: blockedImpact(),
  })
  const region = await openImpactStep(page)
  const history = region.getByRole('group', { name: '版履歴' })
  await expect(history.getByText('第3版')).toBeVisible()
  await expect(history.getByText('2026年8月20日 18:00')).toBeVisible()
  await expect(history.getByText('佐藤 美咲')).toBeVisible()

  // UC-EYEX-164: 版履歴の差分。
  await history.getByRole('button', { name: '差分を見る' }).click()
  const diff = history.getByRole('group', { name: '第3版の差分' })
  await expect(diff.getByRole('row')).toHaveCount(3)
  await expect(diff.getByRole('row').nth(1)).toContainText('受付状態')
  await expect(diff.getByRole('row').nth(1)).toContainText('open')
  await expect(diff.getByRole('row').nth(1)).toContainText('paused')
  await expect(diff.getByRole('row').nth(2)).toContainText('来店目的')
  await expect(diff.getByRole('row').nth(2)).toContainText('2件')
  await expect(diff.getByRole('row').nth(2)).toContainText('1件')

  // AC-EYEX-108: 直接の再公開経路が無い。
  await expect(
    diff.getByText('過去版は直接公開できません。復元すると新しい下書きになります。'),
  ).toBeVisible()
  await expect(history.getByRole('button', { name: /再公開|この版を公開|版を適用/ })).toHaveCount(0)

  // 復元前は公開できていた（= 復元そのものがブロックしたと言える）。
  const publishPanel = region.getByRole('group', { name: '公開' })
  await expect(publishPanel.getByRole('button', { name: '今すぐ公開する' })).toBeEnabled()

  await history.getByRole('button', { name: '新しい下書きとして復元' }).click()
  expect(callsTo(mock, `/availability/versions/${pastVersionId}/restore`, 'POST')).toHaveLength(1)
  await expect(
    region.getByText('過去版を新しい下書きにしました。公開する前に影響確認を行ってください。'),
  ).toBeVisible()

  // AC-EYEX-108: 復元後は影響確認をやり直すまで公開できない。
  await expect(publishPanel.getByRole('button', { name: '今すぐ公開する' })).toBeDisabled()
  await expect(
    region
      .getByRole('group', { name: '影響確認' })
      .getByRole('group', { name: '既存予約との競合' }),
  ).toBeVisible()
})

// @e2e-covers UC-EYEX-092 UC-EYEX-120 UC-EYEX-121 UC-EYEX-160 AC-EYEX-48 AC-EYEX-69 AC-EYEX-104
test('適用元は全店共通と店舗上書きを区別して示し、上書き解除は新しい共通値と影響を先に見せる', async ({
  page,
}) => {
  const mock = await mockPublicationApi(page, {
    impact: cleanImpact(),
    nextImpact: blockedImpact(),
  })
  const region = await openImpactStep(page)
  const origin = region.getByRole('group', { name: '適用元' })

  // AC-EYEX-48 / AC-EYEX-69 / UC-EYEX-120 / UC-EYEX-121: 適用元と上書き項目。
  await expect(origin.getByText('店舗上書き', { exact: true })).toBeVisible()
  await expect(origin.getByText('全店共通 第7版')).toBeVisible()
  await expect(origin.getByText('店舗で上書きしている項目')).toBeVisible()
  const fields = origin.getByRole('listitem')
  await expect(fields).toHaveCount(2)
  await expect(fields.nth(0)).toHaveText('営業時間')
  await expect(fields.nth(1)).toHaveText('来店目的')

  // UC-EYEX-160 / AC-EYEX-104: 解除は共通値へ即戻さず、新しい下書きと影響を先に出す。
  await origin.getByRole('button', { name: '店舗上書きを解除' }).click()
  expect(callsTo(mock, '/availability/override/release', 'POST')).toHaveLength(1)
  await expect(origin.getByText('全店共通値 第7版を新しい下書きにしました')).toBeVisible()
  await expect(origin.getByText('公開する前に影響確認を行ってください。')).toBeVisible()

  // UC-EYEX-092: 解除後は全店共通が適用元になり、上書き項目も解除手段も残らない。
  await expect(origin.getByText('全店共通', { exact: true })).toBeVisible()
  await expect(origin.getByText('店舗上書き', { exact: true })).toBeHidden()
  await expect(origin.getByRole('listitem')).toHaveCount(0)
  await expect(origin.getByRole('button', { name: '店舗上書きを解除' })).toBeHidden()

  // 影響を確認するまでは公開できない。
  await expect(
    region.getByRole('group', { name: '公開' }).getByRole('button', { name: '今すぐ公開する' }),
  ).toBeDisabled()
  await expect(
    region
      .getByRole('group', { name: '影響確認' })
      .getByRole('group', { name: '既存予約との競合' }),
  ).toBeVisible()
})
