import { expect, type Page, test } from '@playwright/test'

/*
 * EYEX スタッフ端末の「注意事項の権限設定」「監査イベント」「顧客の統合・誤関連解除」の E2E。
 *
 * どれも全画面共通の左サイドバー（注意事項 / 監査ログ / 顧客の統合・訂正）から開く。
 * API はすべて `page.route` で差し替え、SPA だけを実行する。
 *
 * 共有 iPad（横向き 1180×820）が既定の前提なので viewport をそれに合わせる。
 */

const VIEWPORT = { width: 1180, height: 820 }

const ginzaId = '11111111-1111-4111-8111-111111111111'
const marunouchiId = '22222222-2222-4222-8222-222222222222'
const hanakoId = '55555555-5555-4555-8555-555555555555'
const duplicateId = '66666666-6666-4666-8666-666666666666'
const reservationId = '77777777-7777-4777-8777-777777777777'

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
  'customer.read',
  'customer.write',
  'customer.history',
  'attention.read',
  'attention.write',
  'attention.publish',
  'settings.read',
  'settings.manage',
  'audit.read',
]

/** 新規組織の初期値 (UC-EYEX-148)。全スタッフが閲覧と確認待ち登録、以降は店舗管理者以上。 */
const defaultSettings = {
  storeId: ginzaId,
  reviewMode: 'review_required' as const,
  sharingScope: 'permitted_stores' as const,
  storeOverrideAllowed: true,
  origin: 'organization' as const,
  capabilities: [
    { capability: 'read' as const, minimumRole: 'staff' as const, origin: 'organization' as const },
    {
      capability: 'write' as const,
      minimumRole: 'staff' as const,
      origin: 'organization' as const,
    },
    {
      capability: 'publish' as const,
      minimumRole: 'store_manager' as const,
      origin: 'organization' as const,
    },
    {
      capability: 'revise' as const,
      minimumRole: 'store_manager' as const,
      // 店舗上書きが効いている 1 行。適用元が行ごとに違うことを見せる。
      origin: 'store' as const,
    },
    {
      capability: 'hide' as const,
      minimumRole: 'store_manager' as const,
      origin: 'organization' as const,
    },
  ],
  guidance: {
    record: ['発生した事実', '発生日時', '根拠', '推奨対応'],
    avoid: ['人格評価', '憶測', '差別につながる属性'],
  },
}

type Settings = typeof defaultSettings

type Request = { method: string; url: string; body: string }

type Mocks = {
  permissions: string[]
  settings: Settings
  requests: Request[]
  onSettingsPut?: (body: unknown) => { status: number; json: unknown } | undefined
  onAudit?: (url: URL) => { status: number; json: unknown }
  onMergePreview?: () => { status: number; json: unknown }
  onMerge?: () => { status: number; json: unknown }
  onRelease?: () => { status: number; json: unknown }
}

function auditEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    occurredAt: '2026-08-25T06:10:00.000Z',
    storeId: ginzaId,
    actorType: 'user',
    actorId: 'user-yamada',
    action: 'attention.publish',
    entityType: 'attention_note',
    entityId: 'note-1',
    correlationId: 'corr-abc-123',
    before: { status: 'pending_review', version: 1 },
    after: { status: 'published', version: 2 },
    ...overrides,
  }
}

/** 注意事項の 5 操作がすべて監査に載っていることを見せるための行 (UC-EYEX-147)。 */
const auditEvents = [
  auditEvent(),
  auditEvent({
    id: '10000000-0000-4000-8000-000000000002',
    action: 'attention.read',
    actorType: 'shared_terminal',
    actorId: 'terminal-ginza-01',
    correlationId: null,
    before: null,
    after: null,
  }),
  auditEvent({ id: '10000000-0000-4000-8000-000000000003', action: 'attention.write' }),
  auditEvent({ id: '10000000-0000-4000-8000-000000000004', action: 'attention.revise' }),
  auditEvent({ id: '10000000-0000-4000-8000-000000000005', action: 'attention.hide' }),
]

const mergeImpact = {
  reservations: 4,
  walkins: 1,
  prescriptions: 2,
  notes: 3,
  attentionNotes: 1,
  ownedGlasses: 2,
}

const mergePreview = {
  primary: {
    customerId: hanakoId,
    name: '田中花子',
    kana: 'タナカハナコ',
    phone: '090-1234-5678',
    primaryStoreId: ginzaId,
    visitCount: 6,
  },
  duplicate: {
    customerId: duplicateId,
    name: '田中 花子',
    kana: 'タナカハナコ',
    phone: '09012345678',
    primaryStoreId: marunouchiId,
    visitCount: 2,
  },
  impact: mergeImpact,
  alreadyMerged: false,
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
  await page.route('**/api/staff/stores/*/ledger*', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/staff/stores/*/attention-settings', (route) => {
    record(route)
    if (route.request().method() === 'GET') return route.fulfill({ json: mocks.settings })
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
    const override = mocks.onSettingsPut?.(body)
    if (override) return route.fulfill(override)
    mocks.settings = {
      ...mocks.settings,
      reviewMode: body.reviewMode as Settings['reviewMode'],
      sharingScope: body.sharingScope as Settings['sharingScope'],
      storeOverrideAllowed: Boolean(body.storeOverrideAllowed),
      origin: body.scope as Settings['origin'],
      capabilities: (body.capabilities as { capability: string; minimumRole: string }[]).map(
        (rule) => ({
          ...rule,
          origin: body.scope,
        }),
      ) as Settings['capabilities'],
    }
    return route.fulfill({ json: mocks.settings })
  })
  await page.route('**/api/staff/stores/*/attention-settings/sharing-scope-impact', (route) => {
    record(route)
    const body = JSON.parse(route.request().postData() ?? '{}') as { requestedScope: string }
    return route.fulfill({
      json: {
        currentScope: mocks.settings.sharingScope,
        requestedScope: body.requestedScope,
        affectedNoteCount: 12,
        affectedCustomerCount: 9,
        affectedStoreCount: 3,
      },
    })
  })
  await page.route('**/api/staff/stores/*/audit-events*', (route) => {
    record(route)
    const url = new URL(route.request().url())
    const override = mocks.onAudit?.(url)
    if (override) return route.fulfill(override)
    const action = url.searchParams.get('action')
    const actorType = url.searchParams.get('actorType')
    const rows = auditEvents.filter(
      (event) =>
        (action === null || event.action === action) &&
        (actorType === null || event.actorType === actorType),
    )
    return route.fulfill({ json: rows })
  })
  await page.route('**/api/staff/stores/*/customer-merges/preview', (route) => {
    record(route)
    return route.fulfill(mocks.onMergePreview?.() ?? { status: 200, json: mergePreview })
  })
  await page.route('**/api/staff/stores/*/customer-merges', (route) => {
    record(route)
    return route.fulfill(
      mocks.onMerge?.() ?? {
        status: 200,
        json: {
          primaryCustomerId: hanakoId,
          mergedCustomerId: duplicateId,
          impact: mergeImpact,
          mergedAt: '2026-08-27T02:00:00.000Z',
        },
      },
    )
  })
  await page.route('**/api/staff/stores/*/customer-links/release', (route) => {
    record(route)
    return route.fulfill(
      mocks.onRelease?.() ?? {
        status: 200,
        json: {
          entryType: 'reservation',
          entryId: reservationId,
          previousCustomerId: hanakoId,
          releasedAt: '2026-08-27T02:05:00.000Z',
        },
      },
    )
  })
}

/*
 * 面の行き来は全画面共通の左サイドバー 1 本に集約された。ホームには柱が出ない
 * ので、まず業務の面（予約台帳）へ入ってから柱で行き先を選ぶ。
 */
async function openAdmin(page: Page, label: string) {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: '主操作' })).toBeVisible()
  await page
    .getByRole('navigation', { name: '副操作' })
    .getByRole('button', { name: '予約台帳' })
    .click()
  await page
    .getByRole('navigation', { name: '画面の一覧' })
    .getByRole('button', { name: label, exact: true })
    .click()
}

async function openAttentionSettings(page: Page) {
  await openAdmin(page, '注意事項')
  await expect(page.getByRole('heading', { name: '注意事項の権限' })).toBeVisible()
}

function newMocks(overrides: Partial<Mocks> = {}): Mocks {
  return {
    permissions: [...ALL_PERMISSIONS],
    settings: JSON.parse(JSON.stringify(defaultSettings)) as Settings,
    requests: [],
    ...overrides,
  }
}

// @e2e-covers UC-EYEX-139 UC-EYEX-140 UC-EYEX-141 UC-EYEX-144 UC-EYEX-148 AC-EYEX-84
test('注意事項の権限は5操作それぞれのロールと適用元を出し、組織共通と店舗上書き・公開方式を選び直せる', async ({
  page,
}) => {
  const mocks = newMocks()
  await mockStaffApi(page, mocks)
  await openAttentionSettings(page)

  /*
   * 表はロール×操作の許可表になった。5 操作それぞれのロールは操作ごとの
   * 選択が持ち、適用元は表の最終行が操作ごとに持つ (AC-EYEX-84)。
   */
  const table = page.getByRole('table', { name: '注意事項の権限' })
  const rows = table.getByRole('row')
  // 見出し + ロール 3 段 + 適用元。
  await expect(rows).toHaveCount(5)
  const originRow = rows.nth(4)
  await expect(originRow.getByRole('rowheader')).toHaveText('適用元')
  const expected = [
    ['閲覧', 'staff', '組織共通'],
    ['登録', 'staff', '組織共通'],
    ['公開', 'store_manager', '組織共通'],
    ['改訂', 'store_manager', '店舗上書き'],
    ['非表示化', 'store_manager', '組織共通'],
  ]
  for (const [index, row] of expected.entries()) {
    const [label = '', role = '', origin = ''] = row
    await expect(page.getByLabel(`${label}に必要なロール`)).toHaveValue(role)
    // 適用元は行ごとに違う。列の並びは契約の順序（閲覧・登録・公開・改訂・非表示化）。
    await expect(originRow.getByRole('cell').nth(index)).toHaveText(origin)
  }
  // 新規組織の初期値はこの並びそのもの (UC-EYEX-148)。
  await expect(page.getByLabel('設定範囲')).toHaveValue('organization')

  // 入力時の案内は契約データとして届き、記録する/記録しないの両方が出る (UC-EYEX-144)。
  const guidance = page.getByRole('region', { name: '入力時の案内' })
  await expect(guidance).toContainText('記録する: 発生した事実・発生日時・根拠・推奨対応')
  await expect(guidance).toContainText('記録しない: 人格評価・憶測・差別につながる属性')

  // 組織共通と店舗上書きのどちらを書くかを選べる (UC-EYEX-139)。
  await page.getByLabel('設定範囲').selectOption('store')
  await expect(page.getByLabel('店舗ごとの上書きを許可する')).toBeChecked()

  // 公開方式は即時公開と管理者確認後の 2 択 (UC-EYEX-141)。
  await expect(page.getByLabel('公開方式')).toHaveValue('review_required')
  await page.getByLabel('公開方式').selectOption('immediate')

  // ロールを操作ごとに変えて保存できる (UC-EYEX-140)。
  await page.getByLabel('公開に必要なロール').selectOption('organization_admin')
  await page.getByRole('button', { name: '設定を保存する' }).click()
  await expect(page.getByText('設定を保存しました。')).toBeVisible()

  const put = mocks.requests.find(
    (entry) => entry.method === 'PUT' && entry.url.endsWith('/attention-settings'),
  )
  expect(put).toBeDefined()
  const sent = JSON.parse(put?.body ?? '{}') as {
    scope: string
    reviewMode: string
    capabilities: { capability: string; minimumRole: string }[]
  }
  expect(sent.scope).toBe('store')
  expect(sent.reviewMode).toBe('immediate')
  expect(sent.capabilities).toEqual([
    { capability: 'read', minimumRole: 'staff' },
    { capability: 'write', minimumRole: 'staff' },
    { capability: 'publish', minimumRole: 'organization_admin' },
    { capability: 'revise', minimumRole: 'store_manager' },
    { capability: 'hide', minimumRole: 'store_manager' },
  ])
  // 保存後は適用元が店舗上書きへ移ったことが、操作ごとにそのまま読める (UC-EYEX-139)。
  for (const index of [0, 1, 2, 3, 4])
    await expect(originRow.getByRole('cell').nth(index)).toHaveText('店舗上書き')
})

// @e2e-covers UC-EYEX-142 AC-EYEX-118
test('共有範囲の変更は影響件数を見せ、承認するまで適用されない', async ({ page }) => {
  const mocks = newMocks()
  await mockStaffApi(page, mocks)
  await openAttentionSettings(page)

  await expect(page.getByLabel('共有範囲', { exact: true })).toHaveValue('permitted_stores')
  await page.getByLabel('共有範囲', { exact: true }).selectOption('chain')
  await page.getByRole('button', { name: '設定を保存する' }).click()

  // 既存情報がどこからどこへ何件動くかを、変更の前に言い切る (AC-EYEX-118)。
  const dialog = page.getByRole('dialog', { name: '共有範囲の変更を確認' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(
    '既存の注意事項 12件（顧客 9人・店舗 3店舗）が「権限のある店舗」から「チェーン全体」へ変わります。',
  )
  await expect(dialog).toContainText('12件')
  await expect(dialog).toContainText('9人')
  await expect(dialog).toContainText('3店舗')
  // 確認の前に書き込みは起きない。
  expect(
    mocks.requests.some(
      (entry) => entry.method === 'PUT' && entry.url.endsWith('/attention-settings'),
    ),
  ).toBe(false)

  // キャンセルすると設定は元のまま（UC-EYEX-142）。
  await dialog.getByRole('button', { name: 'キャンセル' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByLabel('共有範囲', { exact: true })).toHaveValue('permitted_stores')
  expect(
    mocks.requests.some(
      (entry) => entry.method === 'PUT' && entry.url.endsWith('/attention-settings'),
    ),
  ).toBe(false)

  // 承認して初めて、見た件数を添えて適用される。
  await page.getByLabel('共有範囲', { exact: true }).selectOption('chain')
  await page.getByRole('button', { name: '設定を保存する' }).click()
  await page
    .getByRole('dialog', { name: '共有範囲の変更を確認' })
    .getByRole('button', { name: '影響を確認して変更する' })
    .click()
  await expect(page.getByText('設定を保存しました。')).toBeVisible()
  const put = mocks.requests.find(
    (entry) => entry.method === 'PUT' && entry.url.endsWith('/attention-settings'),
  )
  const sent = JSON.parse(put?.body ?? '{}') as Record<string, unknown>
  expect(sent.sharingScope).toBe('chain')
  expect(sent.acknowledgedAffectedNoteCount).toBe(12)
  await expect(page.getByLabel('共有範囲', { exact: true })).toHaveValue('chain')
})

// @e2e-covers UC-EYEX-156 AC-EYEX-103
test('監査記録に残せなかった管理操作は成立させず、入力を保持したまま再試行を差し出す', async ({
  page,
}) => {
  let failNext = true
  const mocks = newMocks({
    onSettingsPut: () =>
      failNext ? { status: 503, json: { error: 'audit_append_failed' } } : undefined,
  })
  await mockStaffApi(page, mocks)
  await openAttentionSettings(page)

  await page.getByLabel('公開方式').selectOption('immediate')
  await page.getByLabel('公開に必要なロール').selectOption('organization_admin')
  await page.getByRole('button', { name: '設定を保存する' }).click()

  // 成立していないことを言い切り、入力はそのまま残す (AC-EYEX-103)。
  await expect(
    page.getByText(
      '監査記録に残せなかったため、この変更は成立していません。入力はそのまま保持しています。',
    ),
  ).toBeVisible()
  await expect(page.getByText('設定を保存しました。')).toHaveCount(0)
  await expect(page.getByLabel('公開方式')).toHaveValue('immediate')
  await expect(page.getByLabel('公開に必要なロール')).toHaveValue('organization_admin')

  // 再試行の手段がその場にある。監査が書けるようになれば同じ入力で成立する。
  failNext = false
  await page.getByRole('button', { name: '再試行する' }).click()
  await expect(page.getByText('設定を保存しました。')).toBeVisible()
  const puts = mocks.requests.filter(
    (entry) => entry.method === 'PUT' && entry.url.endsWith('/attention-settings'),
  )
  expect(puts).toHaveLength(2)
  expect(JSON.parse(puts[1]?.body ?? '{}')).toMatchObject({ reviewMode: 'immediate' })
})

// @e2e-covers UC-EYEX-155 UC-EYEX-147 AC-EYEX-102
test('監査イベントは期間・操作・主体種別・対象で絞り込め、変更前後と相関IDまで読め、権限の外へは広がらない', async ({
  page,
}) => {
  const mocks = newMocks()
  await mockStaffApi(page, mocks)
  await openAdmin(page, '監査ログ')
  // 既定は直近 1 件の詳細ビュー。一覧と絞り込みはそこから開く同じ面の別の姿。
  await expect(page.getByRole('heading', { name: '監査イベント詳細' })).toBeVisible()
  await expect(page.getByRole('region', { name: '監査イベントの記録' })).toContainText(
    'store: 銀座店',
  )
  await page.getByRole('button', { name: '監査を検索', exact: true }).click()

  // 閲覧・登録・公開・改訂・非表示化がいずれも監査に載っている (UC-EYEX-147)。
  const table = page.getByRole('table', { name: '監査イベント' })
  await expect(table.getByRole('row')).toHaveCount(auditEvents.length + 1)
  for (const action of [
    'attention.read',
    'attention.write',
    'attention.publish',
    'attention.revise',
    'attention.hide',
  ])
    await expect(table.getByText(action, { exact: true })).toHaveCount(1)

  // 主体種別は個人と共有端末を語で見分ける (AC-EYEX-102)。
  await expect(table).toContainText('共有端末')
  await expect(table).toContainText('terminal-ginza-01')
  await expect(table).toContainText('attention_note · note-1')

  // 期間・操作・主体種別・対象を条件としてサーバへ渡す (UC-EYEX-155)。
  await page.getByLabel('開始日時').fill('2026-08-25T00:00')
  await page.getByLabel('終了日時').fill('2026-08-26T00:00')
  await page.getByLabel('操作').fill('attention.publish')
  // 主体種別は 3 択の押しボタンになった（既定の `<select>` は使わない）。
  await page.getByRole('group', { name: '主体種別' }).getByRole('button', { name: '個人' }).click()
  await page.getByLabel('対象種別').fill('attention_note')
  await page.getByLabel('対象ID').fill('note-1')
  await page.getByRole('button', { name: '監査を検索する' }).click()
  await expect(table.getByRole('row')).toHaveCount(2)
  const query = new URL(mocks.requests.at(-1)?.url ?? 'http://x/').searchParams
  expect(query.get('action')).toBe('attention.publish')
  expect(query.get('actorType')).toBe('user')
  expect(query.get('entityType')).toBe('attention_note')
  expect(query.get('entityId')).toBe('note-1')
  expect(query.get('from')).toBe('2026-08-24T15:00:00.000Z')
  expect(query.get('to')).toBe('2026-08-25T15:00:00.000Z')

  // 変更前後と相関IDは詳細で突き合わせて読む (AC-EYEX-102)。
  await table.getByRole('button', { name: '詳細' }).first().click()
  const detail = page.getByRole('region', { name: '監査イベント詳細' })
  await expect(detail).toContainText('correlation_id: corr-abc-123')
  await expect(detail).toContainText('actor_type: user')
  await expect(detail).toContainText('actor: user-yamada')
  // 変更前後は同じ鍵で並べて突き合わせる。
  await expect(detail.getByRole('region', { name: '変更前' })).toContainText(
    'status pending_review',
  )
  await expect(detail.getByRole('region', { name: '変更後' })).toContainText('status published')

  // 権限の外は検索できず、その旨だけが返る。
  await page.getByRole('button', { name: '監査を検索', exact: true }).click()
  mocks.onAudit = () => ({ status: 403, json: { error: 'forbidden' } })
  await page.getByRole('button', { name: '監査を検索する' }).click()
  await expect(page.getByText('権限のある範囲の監査イベントだけを表示できます。')).toBeVisible()
  await expect(page.getByRole('table', { name: '監査イベント' })).toHaveCount(0)
})

// @e2e-covers UC-EYEX-181 AC-EYEX-121
test('顧客の統合と誤関連解除は比較だけでは何も動かさず、理由を添えた明示操作でしか実行されない', async ({
  page,
}) => {
  const mocks = newMocks()
  await mockStaffApi(page, mocks)
  await openAdmin(page, '顧客の統合・訂正')
  await expect(page.getByRole('heading', { name: '顧客の重複と誤関連' })).toBeVisible()

  // 比較は何も変えない (UC-EYEX-181)。
  await page.getByLabel('残す顧客ID').fill(hanakoId)
  await page.getByLabel('重複している顧客ID').fill(duplicateId)
  await page.getByRole('button', { name: '重複候補を比較する' }).click()
  const comparison = page.getByRole('region', { name: '重複候補の比較' })
  await expect(comparison).toContainText('田中花子')
  await expect(comparison).toContainText('田中 花子')
  await expect(comparison).toContainText('来店 6回')
  await expect(comparison).toContainText('来店 2回')
  expect(mocks.requests.filter((entry) => entry.url.endsWith('/customer-merges'))).toHaveLength(0)

  // 動く履歴は実行前に項目ごとと合計で出る (AC-EYEX-121)。
  const impact = page.getByRole('region', { name: '統合の影響' })
  await expect(impact).toContainText('予約')
  await expect(impact).toContainText('4件')
  await expect(impact).toContainText('合計 13件')

  // 理由が無ければ統合は始まらない。
  await impact.getByRole('button', { name: '統合する' }).click()
  const mergeDialog = page.getByRole('alertdialog', { name: '顧客の統合を確認' })
  await expect(mergeDialog).toContainText('13件の履歴が残す顧客へ移ります。')
  await mergeDialog.getByRole('button', { name: '統合を実行する' }).click()
  await expect(mergeDialog.getByText('理由を入力してください。')).toBeVisible()
  expect(mocks.requests.filter((entry) => entry.url.endsWith('/customer-merges'))).toHaveLength(0)

  await mergeDialog.getByLabel('統合する理由').fill('同一人物であることを電話番号と来店履歴で確認')
  await mergeDialog.getByRole('button', { name: '統合を実行する' }).click()
  await expect(
    page.getByText('統合しました。実行者・日時・変更前後を監査記録に残しました。'),
  ).toBeVisible()
  const merges = mocks.requests.filter((entry) => entry.url.endsWith('/customer-merges'))
  expect(merges).toHaveLength(1)
  expect(JSON.parse(merges[0]?.body ?? '{}')).toEqual({
    primaryCustomerId: hanakoId,
    duplicateCustomerId: duplicateId,
    reason: '同一人物であることを電話番号と来店履歴で確認',
    acknowledgedImpactTotal: 13,
  })

  // 誤関連解除も同じ形。理由なしでは受付から顧客を外さない。
  await page.getByLabel('受付ID').fill(reservationId)
  await page.getByRole('button', { name: '誤関連を解除する' }).click()
  const releaseDialog = page.getByRole('alertdialog', { name: '誤った顧客関連の解除を確認' })
  await releaseDialog.getByRole('button', { name: '解除を実行する' }).click()
  await expect(releaseDialog.getByText('理由を入力してください。')).toBeVisible()
  expect(
    mocks.requests.filter((entry) => entry.url.endsWith('/customer-links/release')),
  ).toHaveLength(0)
  await releaseDialog.getByLabel('解除する理由').fill('別のお客様の受付に誤って紐づけたため')
  await releaseDialog.getByRole('button', { name: '解除を実行する' }).click()
  await expect(
    page.getByText('顧客との関連を解除しました。実行者・日時・変更前後を監査記録に残しました。'),
  ).toBeVisible()
  const releases = mocks.requests.filter((entry) => entry.url.endsWith('/customer-links/release'))
  expect(releases).toHaveLength(1)
  expect(JSON.parse(releases[0]?.body ?? '{}')).toEqual({
    entryType: 'reservation',
    entryId: reservationId,
    reason: '別のお客様の受付に誤って紐づけたため',
  })
})

/* ------------------------------------------------------------------ *
 * 注意事項そのものの登録・確認・改訂・非表示化。
 *
 * 入口は顧客台帳。顧客を選ぶと「注意事項を確認・登録する」が出て、
 * `attention-review` 画面へ移る。何が見えるかは
 * `GET /api/staff/stores/:storeId/permissions` の応答だけで決まるので、
 * 公開権限の有無はその payload を差し替えて駆動する。
 * ------------------------------------------------------------------ */

const noteCustomerId = '88888888-8888-4888-8888-888888888888'
const publishedNoteId = '20000000-0000-4000-8000-000000000001'
const pendingNoteId = '20000000-0000-4000-8000-000000000002'

/** 公開権限を持たない店舗スタッフ。閲覧と登録まではできる。 */
const STAFF_PERMISSIONS = [
  'store.read',
  'reservation.read',
  'customer.read',
  'attention.read',
  'attention.write',
]

/** 公開・改訂・非表示化まで許された権限者。 */
const REVIEWER_PERMISSIONS = [
  ...STAFF_PERMISSIONS,
  'attention.publish',
  'attention.revise',
  'attention.hide',
]

const hanakoCandidate = {
  id: noteCustomerId,
  name: '田中花子',
  kana: 'タナカハナコ',
  phone: '090-1234-5678',
  email: null,
  primaryStoreId: ginzaId,
  visitCount: 4,
}

const hanakoDetail = {
  customerId: noteCustomerId,
  currentPrescription: null,
  pastPrescriptions: [],
  latestNote: null,
  ownedGlasses: [],
  attentionNotes: [],
  visitHistory: [],
}

type Note = {
  id: string
  noteId: string
  customerId: string
  storeId: string
  status: 'pending_review' | 'published' | 'returned' | 'rejected' | 'superseded' | 'hidden'
  version: number
  body: string
  occurredAt: string
  basis: string
  recommendedAction: string
  sharingScope: 'permitted_stores' | 'chain'
  recordedBy: string
  recordedOn: string
  publishedAt: string | null
  hiddenAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  reviewReason: string | null
}

function note(overrides: Partial<Note> & Pick<Note, 'id' | 'noteId' | 'status'>): Note {
  return {
    customerId: noteCustomerId,
    storeId: ginzaId,
    version: 1,
    body: '鼻あての金属で肌が荒れやすい。',
    occurredAt: '2026-02-10T01:00:00.000Z',
    basis: '2026-02-10のご本人申告',
    recommendedAction: '樹脂パッドへの交換を提案する',
    sharingScope: 'permitted_stores',
    recordedBy: '鈴木',
    recordedOn: '2026-02-12',
    publishedAt: null,
    hiddenAt: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewReason: null,
    ...overrides,
  }
}

const publishedNote = note({
  id: '21000000-0000-4000-8000-000000000001',
  noteId: publishedNoteId,
  status: 'published',
  publishedAt: '2026-02-12T02:00:00.000Z',
})

const pendingNote = note({
  id: '21000000-0000-4000-8000-000000000002',
  noteId: pendingNoteId,
  status: 'pending_review',
  body: '来店時に強い日差しで頭痛を訴えられた。',
  occurredAt: '2026-08-20T05:30:00.000Z',
  basis: '2026-08-20の来店時のご申告',
  recommendedAction: '調光レンズを案内する',
})

type NoteMocks = {
  permissions: string[]
  notes: Note[]
  versions: Note[]
  requests: Request[]
  onReview?: () => { status: number; json: unknown }
  onRevision?: () => { status: number; json: unknown }
}

async function mockNoteApi(page: Page, mocks: NoteMocks) {
  const record = (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const request = route.request()
    mocks.requests.push({
      method: request.method(),
      url: request.url(),
      body: request.postData() ?? '',
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
    route.fulfill({ json: mocks.permissions }),
  )
  await page.route('**/api/staff/stores/*/ledger*', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/staff/stores/*/attention-settings', (route) =>
    route.fulfill({ json: defaultSettings }),
  )
  // 顧客候補と顧客記録。注意事項の route は後から登録して優先させる。
  await page.route('**/api/staff/stores/*/customers**', (route) =>
    new URL(route.request().url()).pathname.endsWith('/customers')
      ? route.fulfill({ json: [hanakoCandidate] })
      : route.fulfill({ json: hanakoDetail }),
  )
  await page.route('**/api/staff/stores/*/customers/*/attention-notes', (route) => {
    record(route)
    if (route.request().method() === 'GET') return route.fulfill({ json: mocks.notes })
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, string>
    const created = note({
      id: '21000000-0000-4000-8000-000000000009',
      noteId: '20000000-0000-4000-8000-000000000009',
      status: 'pending_review',
      body: body.body ?? '',
      occurredAt: body.occurredAt ?? '',
      basis: body.basis ?? '',
      recommendedAction: body.recommendedAction ?? '',
    })
    mocks.notes = [created, ...mocks.notes]
    return route.fulfill({ status: 201, json: created })
  })
  await page.route('**/api/staff/stores/*/attention-notes/*/versions', (route) => {
    record(route)
    return route.fulfill({ json: mocks.versions })
  })
  await page.route('**/api/staff/stores/*/attention-notes/*/review', (route) => {
    record(route)
    const override = mocks.onReview?.()
    if (override) return route.fulfill(override)
    const body = JSON.parse(route.request().postData() ?? '{}') as { decision: string }
    const target = mocks.notes.find((row) => row.status === 'pending_review') ?? pendingNote
    const status =
      body.decision === 'publish'
        ? 'published'
        : body.decision === 'return'
          ? 'returned'
          : 'rejected'
    const next: Note = { ...target, status, version: target.version + 1 }
    mocks.notes = mocks.notes.map((row) => (row.noteId === next.noteId ? next : row))
    return route.fulfill({ json: next })
  })
  await page.route('**/api/staff/stores/*/attention-notes/*/revisions', (route) => {
    record(route)
    const override = mocks.onRevision?.()
    if (override) return route.fulfill(override)
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, string>
    const next = note({
      id: '21000000-0000-4000-8000-000000000011',
      noteId: publishedNoteId,
      status: 'published',
      version: 2,
      body: body.body ?? '',
      occurredAt: body.occurredAt ?? '',
      basis: body.basis ?? '',
      recommendedAction: body.recommendedAction ?? '',
      publishedAt: '2026-08-27T02:00:00.000Z',
    })
    mocks.notes = mocks.notes.map((row) => (row.noteId === publishedNoteId ? next : row))
    mocks.versions = [next, { ...publishedNote, status: 'superseded' }]
    return route.fulfill({ json: next })
  })
  await page.route('**/api/staff/stores/*/attention-notes/*/hide', (route) => {
    record(route)
    const body = JSON.parse(route.request().postData() ?? '{}') as { reason: string }
    const next: Note = {
      ...publishedNote,
      status: 'hidden',
      version: publishedNote.version + 1,
      hiddenAt: '2026-08-27T02:10:00.000Z',
      reviewReason: body.reason,
    }
    mocks.notes = mocks.notes.map((row) => (row.noteId === publishedNoteId ? next : row))
    return route.fulfill({ json: next })
  })
}

function newNoteMocks(overrides: Partial<NoteMocks> = {}): NoteMocks {
  return {
    permissions: [...REVIEWER_PERMISSIONS],
    notes: [publishedNote, pendingNote],
    versions: [publishedNote],
    requests: [],
    ...overrides,
  }
}

/** ホーム → 顧客台帳 → 候補を選ぶ → 注意事項画面 まで進める。 */
async function openAttentionReview(page: Page) {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: '主操作' })).toBeVisible()
  await page
    .getByRole('navigation', { name: '副操作' })
    .getByRole('button', { name: '顧客台帳' })
    .click()
  // 探す列は見出しではなく列自身が名乗る。検索欄は 1 本で、Enter で候補を出す。
  const search = page.getByRole('complementary', { name: 'お客様を探す' })
  await expect(search).toBeVisible()
  await search.getByLabel('顧客を検索').fill('09012345678')
  await search.getByLabel('顧客を検索').press('Enter')
  await search.getByRole('article', { name: '田中花子' }).getByRole('button').click()
  await page.getByRole('button', { name: '注意事項を確認・登録する' }).click()
  await expect(page.getByRole('heading', { name: '注意事項を確認' })).toBeVisible()
}

// @e2e-covers UC-EYEX-143 AC-EYEX-85
test('確認待ちで登録された注意事項は公開権限の無いスタッフには存在ごと見えず、権限者には発生した事実・発生日時・根拠・推奨対応が揃って見える', async ({
  page,
}) => {
  const mocks = newNoteMocks({ permissions: [...STAFF_PERMISSIONS] })
  await mockNoteApi(page, mocks)
  await openAttentionReview(page)

  // 公開済みは読めるが、確認待ちは行そのものが無い (AC-EYEX-85)。
  await expect(page.getByText('鼻あての金属で肌が荒れやすい。')).toBeVisible()
  await expect(page.getByText('来店時に強い日差しで頭痛を訴えられた。')).toHaveCount(0)
  await expect(page.getByText('確認待ち')).toHaveCount(0)

  // 4 項目が揃って初めて注意事項になる (UC-EYEX-143)。欠けたままでは送らない。
  await page
    .getByLabel('発生した事実', { exact: true })
    .fill('レンズ交換の際に強い薬品臭で咳き込まれた。')
  await page.getByRole('button', { name: '注意事項を登録する' }).click()
  await expect(
    page.getByText('発生した事実・発生日時・根拠・推奨対応をすべて入力してください。'),
  ).toBeVisible()
  expect(
    mocks.requests.filter(
      (entry) => entry.method === 'POST' && entry.url.endsWith('/attention-notes'),
    ),
  ).toHaveLength(0)

  await page.getByLabel('発生日時', { exact: true }).fill('2026-08-21T14:30')
  await page.getByLabel('根拠', { exact: true }).fill('2026-08-21の来店時のご申告')
  await page.getByLabel('推奨対応', { exact: true }).fill('作業前に換気し、待合でお待ちいただく')
  await page.getByRole('button', { name: '注意事項を登録する' }).click()

  // 登録した本人にも、公開されるまでは一覧へ出ない (AC-EYEX-85)。
  await expect(
    page.getByText(
      '確認待ちとして登録しました。権限者が公開するまで通常のスタッフには表示されません。',
    ),
  ).toBeVisible()
  await expect(page.getByText('レンズ交換の際に強い薬品臭で咳き込まれた。')).toHaveCount(0)
  const posted = mocks.requests.filter(
    (entry) => entry.method === 'POST' && entry.url.endsWith('/attention-notes'),
  )
  expect(posted).toHaveLength(1)
  expect(JSON.parse(posted[0]?.body ?? '{}')).toEqual({
    body: 'レンズ交換の際に強い薬品臭で咳き込まれた。',
    occurredAt: '2026-08-21T05:30:00.000Z',
    basis: '2026-08-21の来店時のご申告',
    recommendedAction: '作業前に換気し、待合でお待ちいただく',
  })

  // 同じ API 応答でも、公開権限を持つ権限者には確認待ちが 4 項目つきで見える。
  mocks.permissions = [...REVIEWER_PERMISSIONS]
  await openAttentionReview(page)
  const waiting = page
    .getByRole('article')
    .filter({ hasText: '来店時に強い日差しで頭痛を訴えられた。' })
  await expect(waiting).toHaveAttribute('aria-label', /注意事項 確認待ち 版1/)
  await expect(waiting).toContainText('発生日時')
  await expect(waiting).toContainText('2026年8月20日 14:30')
  await expect(waiting).toContainText('根拠')
  await expect(waiting).toContainText('2026-08-20の来店時のご申告')
  await expect(waiting).toContainText('推奨対応')
  await expect(waiting).toContainText('調光レンズを案内する')
})

// @e2e-covers AC-EYEX-116
test('公開・差戻し・却下はいずれも理由を求め、理由が無いうちは登録者にも監査にも結果を残さない', async ({
  page,
}) => {
  const mocks = newNoteMocks()
  await mockNoteApi(page, mocks)
  await openAttentionReview(page)

  const waiting = page.getByRole('article', { name: /注意事項 確認待ち 版1/ })
  const reviews = () => mocks.requests.filter((entry) => entry.url.endsWith('/review'))

  // 判断の 3 つはモックの文言（公開する / 差戻し / 却下）。
  for (const label of ['公開する', '差戻し', '却下']) {
    await waiting.getByRole('button', { name: label }).click()
    await expect(page.getByText('理由を入力してください。')).toBeVisible()
    expect(reviews()).toHaveLength(0)
  }

  // 理由を添えて初めて判断が成立し、その理由が判断ごと送られる (AC-EYEX-116)。
  await waiting.getByLabel('確認の理由').fill('本人申告と当日の受付記録で裏が取れたため')
  await waiting.getByRole('button', { name: '公開する' }).click()
  await expect(page.getByText('公開しました。登録者と監査記録へ結果を残しました。')).toBeVisible()
  expect(reviews()).toHaveLength(1)
  expect(JSON.parse(reviews()[0]?.body ?? '{}')).toEqual({
    decision: 'publish',
    reason: '本人申告と当日の受付記録で裏が取れたため',
    expectedVersion: 1,
  })
})

// @e2e-covers UC-EYEX-145 AC-EYEX-86
test('改訂は公開済みの版を上書きせず新しい版を公開し、前の版は過去版として読み続けられる', async ({
  page,
}) => {
  const mocks = newNoteMocks()
  await mockNoteApi(page, mocks)
  await openAttentionReview(page)

  const published = page.getByRole('article', { name: /注意事項 公開済み 版1/ })
  await published.getByRole('button', { name: '改訂する' }).click()
  const dialog = page.getByRole('dialog', { name: '注意事項を改訂' })
  // 上書きしないことを、改訂する前に言い切る (UC-EYEX-145)。
  await expect(dialog).toContainText('公開済みの版は上書きされません。')
  await expect(dialog).toContainText('版1は過去版として残ります。')
  await dialog
    .getByLabel('発生した事実', { exact: true })
    .fill('鼻あての金属で肌が荒れやすい。樹脂パッドへ交換済み。')
  await dialog.getByRole('button', { name: '改訂版を公開する' }).click()

  await expect(page.getByText('改訂版を公開しました。過去の版は残っています。')).toBeVisible()
  const revision = mocks.requests.find((entry) => entry.url.endsWith('/revisions'))
  expect(JSON.parse(revision?.body ?? '{}')).toMatchObject({
    body: '鼻あての金属で肌が荒れやすい。樹脂パッドへ交換済み。',
    expectedVersion: 1,
  })

  // 新しい版が公開され、行は増えず版が上がる (AC-EYEX-86)。
  const revised = page.getByRole('article', { name: /注意事項 公開済み 版2/ })
  await expect(revised).toContainText('鼻あての金属で肌が荒れやすい。樹脂パッドへ交換済み。')
  await expect(page.getByRole('article', { name: /注意事項 公開済み 版1/ })).toHaveCount(0)

  // 前の版はそのまま読める (UC-EYEX-145)。
  await revised.getByRole('button', { name: '過去の版を見る' }).click()
  const versions = page.getByRole('dialog', { name: '注意事項の版履歴' })
  await expect(versions).toContainText('版2 · 公開済み')
  await expect(versions).toContainText('版1 · 旧版')
  await expect(versions).toContainText('鼻あての金属で肌が荒れやすい。')
  await expect(versions).toContainText('記録者 鈴木')
})

// @e2e-covers AC-EYEX-117
test('別の権限者が改訂した後に古い版から公開しようとすると拒否され、新旧の差分がその場に出る', async ({
  page,
}) => {
  const mocks = newNoteMocks({
    onReview: () => ({
      status: 409,
      json: {
        error: 'attention_version_conflict',
        currentVersion: 3,
        expectedVersion: 1,
        differences: [
          {
            field: 'body',
            before: '来店時に強い日差しで頭痛を訴えられた。',
            after: '来店時に強い日差しで頭痛を訴えられた。調光レンズ試着済み。',
          },
          { field: 'recommendedAction', before: '調光レンズを案内する', after: '' },
        ],
      },
    }),
  })
  await mockNoteApi(page, mocks)
  await openAttentionReview(page)

  const waiting = page.getByRole('article', { name: /注意事項 確認待ち 版1/ })
  await waiting.getByLabel('確認の理由').fill('本人申告で裏が取れたため')
  await waiting.getByRole('button', { name: '公開する' }).click()

  // 公開は成立せず、どの版から見ているかを名指しして断る (AC-EYEX-117)。
  const conflict = page.getByRole('dialog', { name: '別の端末で先に更新されています' })
  await expect(conflict).toContainText('この画面は版1です。現在の版は版3です。')
  await expect(conflict).toContainText('古い版からは公開できません。')
  await expect(page.getByText('公開しました。登録者と監査記録へ結果を残しました。')).toHaveCount(0)

  // 何が変わったのかを、最新と手元の 2 面に項目ごとで並べて突き合わせる。
  const latest = conflict.getByRole('region', { name: '最新の内容' })
  await expect(latest).toContainText('発生した事実')
  await expect(latest).toContainText('来店時に強い日差しで頭痛を訴えられた。調光レンズ試着済み。')
  await expect(latest).toContainText('推奨対応')
  // 最新では推奨対応が消えている。空欄ではなく「未記録」と言い切る。
  await expect(latest).toContainText('（未記録）')
  const mine = conflict.getByRole('region', { name: 'この端末の入力' })
  await expect(mine).toContainText('来店時に強い日差しで頭痛を訴えられた。')
  await expect(mine).toContainText('調光レンズを案内する')

  await conflict.getByRole('button', { name: '最新内容へ再適用' }).click()
  await expect(conflict).toHaveCount(0)
})

// @e2e-covers UC-EYEX-146
test('注意事項に削除の手段は無く、非表示化だけが理由つきで用意され、記録そのものは残る', async ({
  page,
}) => {
  const mocks = newNoteMocks()
  await mockNoteApi(page, mocks)
  await openAttentionReview(page)

  // 削除は画面のどこにも無い (UC-EYEX-146)。
  await expect(page.getByRole('button', { name: /削除/ })).toHaveCount(0)

  const published = page.getByRole('article', { name: /注意事項 公開済み 版1/ })
  await published.getByRole('button', { name: '非表示にする' }).click()
  const dialog = page.getByRole('dialog', { name: '注意事項を非表示にする' })
  await expect(dialog).toContainText('記録は削除されません。')

  // 理由が無ければ非表示にもしない。
  await dialog.getByRole('button', { name: '非表示にする' }).click()
  await expect(page.getByText('理由を入力してください。')).toBeVisible()
  expect(mocks.requests.filter((entry) => entry.url.endsWith('/hide'))).toHaveLength(0)

  await dialog.getByLabel('非表示にする理由').fill('お客様のご要望により掲示を取りやめるため')
  await dialog.getByRole('button', { name: '非表示にする' }).click()
  await expect(page.getByText('非表示にしました。記録自体は削除されていません。')).toBeVisible()
  const hides = mocks.requests.filter((entry) => entry.url.endsWith('/hide'))
  expect(hides).toHaveLength(1)
  expect(JSON.parse(hides[0]?.body ?? '{}')).toEqual({
    reason: 'お客様のご要望により掲示を取りやめるため',
    expectedVersion: 1,
  })

  // 行は消えず、状態が変わるだけ。過去の版もそのまま辿れる。
  const hidden = page.getByRole('article', { name: /注意事項 非表示 版2/ })
  await expect(hidden).toContainText('鼻あての金属で肌が荒れやすい。')
  await expect(hidden.getByRole('button', { name: '過去の版を見る' })).toBeVisible()
  await expect(page.getByRole('button', { name: /削除/ })).toHaveCount(0)
})

// @e2e-covers UC-EYEX-038
test('録音を再生した事実は、再生者・日時・対象予約とともに監査ログから追える', async ({ page }) => {
  // 再生そのものはサーバ側で追記される。ブラウザから確かめられるのは、再生が
  // 実際にサーバへ届き、その結果が監査ログに載って読めることである。
  // 録音運用と監査ログの両方を開くので、再生権限まで持つ担当者で入る。
  const mocks = newMocks({ permissions: [...ALL_PERMISSIONS, 'recording.read'] })
  const played: string[] = []
  const recordingId = '20000000-0000-4000-8000-000000000001'
  const reservationId = '30000000-0000-4000-8000-000000000001'

  await mockStaffApi(page, mocks)
  await page.route('**/api/staff/stores/*/recordings*', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/recordings'))
      return route.fulfill({
        json: [
          {
            id: recordingId,
            organizationId: 'org',
            storeId: ginzaId,
            receptionSessionId: '40000000-0000-4000-8000-000000000001',
            reservationId,
            recorderType: 'personal',
            recorderId: 'user-yamada',
            startedAt: '2026-08-25T06:00:00.000Z',
            endedAt: '2026-08-25T06:05:00.000Z',
            durationSeconds: 300,
            endReason: 'completed',
            state: 'stored',
            retentionUntil: '2026-09-24T06:05:00.000Z',
            holdReason: null,
            heldBy: null,
            heldAt: null,
            deletedAt: null,
            failureReason: null,
            version: 1,
          },
        ],
      })
    return route.fulfill({ json: [] })
  })
  await page.route(`**/api/staff/stores/*/recordings/${recordingId}/audio`, (route) => {
    played.push(route.request().url())
    // 再生されたので、以降の監査検索にはその事実が載る。
    mocks.onAudit = () => ({
      status: 200,
      json: [
        auditEvent({
          id: '10000000-0000-4000-8000-000000000009',
          action: 'recording.played',
          entityType: 'recording',
          entityId: recordingId,
          before: null,
          after: { reservationId },
        }),
      ],
    })
    return route.fulfill({ body: 'audio', headers: { 'content-type': 'audio/webm' } })
  })

  await openAdmin(page, '録音運用')
  await page.getByRole('button', { name: '再生する' }).first().click()
  await page
    .getByRole('region', { name: '録音の再生' })
    .getByRole('button', { name: '再生' })
    .click()
  await expect.poll(() => played.length).toBeGreaterThan(0)

  await page
    .getByRole('navigation', { name: '画面の一覧' })
    .getByRole('button', { name: '監査ログ', exact: true })
    .click()
  // 監査は詳細ビューが既定。一覧はそこから開く。
  await page.getByRole('button', { name: '監査を検索', exact: true }).click()
  await page.getByRole('button', { name: '監査を検索する' }).click()

  const row = page.getByRole('row', { name: /recording\.played/ }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '詳細' }).click()
  const detail = page.getByRole('region', { name: '監査イベント詳細' })
  await expect(detail).toContainText('user-yamada')
  await expect(detail).toContainText('2026年8月25日')
  await expect(detail).toContainText(reservationId)
})
