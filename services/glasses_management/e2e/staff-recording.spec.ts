import { expect, type Page, test } from '@playwright/test'

/*
 * EYEX スタッフ端末の「録音運用」の E2E。
 *
 * ヘッダーの管理メニュー「録音運用」から開く画面だけを扱う。API は
 * すべて `page.route` で差し替え、SPA だけを実行する。録音の保持期限は
 * 実時刻に対する相対値なので、テスト側でも同じ基準時刻から組み立てる。
 *
 * 共有 iPad（横向き 1180×820）が既定の前提なので viewport をそれに合わせる。
 */

const VIEWPORT = { width: 1180, height: 820 }

const ginzaId = '11111111-1111-4111-8111-111111111111'
const marunouchiId = '22222222-2222-4222-8222-222222222222'
const sessionId = '33333333-3333-4333-8333-333333333333'
const reservationId = '44444444-4444-4444-8444-444444444444'

const uploadingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const storedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const failedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const heldId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const pendingId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const deletedId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const discardedId = '99999999-9999-4999-8999-999999999999'
const expiredId = '88888888-8888-4888-8888-888888888888'

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

const ALL_PERMISSIONS = ['store.read', 'reservation.read', 'recording.read', 'recording.manage']
const READ_ONLY_PERMISSIONS = ['store.read', 'reservation.read', 'recording.read']

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** 保持期限は実時刻に対する相対値。基準は 1 回だけ読む。 */
const BASE = Date.now()
const shifted = (ms: number) => new Date(BASE + ms).toISOString()

type Recording = {
  id: string
  organizationId: string
  storeId: string
  receptionSessionId: string
  reservationId: string | null
  recorderType: 'personal' | 'shared_terminal'
  recorderId: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  endReason: 'completed' | 'discarded' | 'interrupted' | 'permission_denied'
  state:
    | 'permission_check'
    | 'recording'
    | 'stopped'
    | 'uploading'
    | 'stored'
    | 'failed'
    | 'held'
    | 'pending_deletion'
    | 'deleted'
  retentionUntil: string | null
  holdReason: string | null
  heldBy: string | null
  heldAt: string | null
  deletedAt: string | null
  failureReason: string | null
  version: number
}

function recording(overrides: Partial<Recording> & Pick<Recording, 'id' | 'state'>): Recording {
  return {
    organizationId: 'org-eyex',
    storeId: ginzaId,
    receptionSessionId: sessionId,
    reservationId,
    recorderType: 'personal',
    recorderId: '山田',
    startedAt: shifted(-3 * DAY),
    endedAt: shifted(-3 * DAY + 5 * 60 * 1000),
    durationSeconds: 305,
    endReason: 'completed',
    retentionUntil: shifted(27 * DAY),
    holdReason: null,
    heldBy: null,
    heldAt: null,
    deletedAt: null,
    failureReason: null,
    version: 1,
    ...overrides,
  }
}

/** 5 区分がすべて同時に並ぶ一覧。区別できることを 1 画面で確かめる。 */
const allRecordings: Recording[] = [
  recording({ id: uploadingId, state: 'uploading', retentionUntil: null }),
  recording({ id: storedId, state: 'stored' }),
  recording({
    id: failedId,
    state: 'failed',
    retentionUntil: null,
    failureReason: 'アップロードがタイムアウトしました',
  }),
  recording({
    id: heldId,
    state: 'held',
    // 保全中は期限を過ぎても削除経路に乗らない (AC-EYEX-78)。
    retentionUntil: shifted(-2 * DAY),
    holdReason: '弁護士からの保全通知',
    heldBy: '本部 佐藤',
    heldAt: shifted(-1 * DAY),
  }),
  recording({ id: pendingId, state: 'pending_deletion', retentionUntil: shifted(-1 * HOUR) }),
  recording({
    id: deletedId,
    state: 'deleted',
    retentionUntil: shifted(-5 * DAY),
    deletedAt: shifted(-4 * DAY),
  }),
  // 破棄された受付。予約に紐づかないまま同じ状態機械の上を進む。
  recording({
    id: discardedId,
    state: 'stored',
    reservationId: null,
    endReason: 'discarded',
    recorderId: '共有iPad-01',
    recorderType: 'shared_terminal',
    retentionUntil: shifted(6 * HOUR),
  }),
]

const retentionSettings = {
  confirmedRetentionDays: 45,
  discardedRetentionHours: 72,
  updatedAt: shifted(-10 * DAY),
}

type Mocks = {
  permissions: string[]
  rows: Recording[]
  /** 実際に飛んだリクエスト。「送っていない」ことも主張したいので全部拾う。 */
  requests: { method: string; url: string; body: string }[]
  /** DELETE の応答をテストごとに差し替える。 */
  onDelete?: (id: string) => { status: number; json: unknown }
  onRetentionPut?: () => { status: number; json: unknown }
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
  // 一覧を先に登録する。Playwright は後から登録した route を先に見るので、
  // 個別操作の route はこの下に並べる。
  await page.route('**/api/staff/stores/*/recordings*', (route) => {
    record(route)
    const state = new URL(route.request().url()).searchParams.get('state')
    const rows = state === null ? mocks.rows : mocks.rows.filter((row) => row.state === state)
    return route.fulfill({ json: rows })
  })
  await page.route('**/api/staff/stores/*/recording-retention', (route) => {
    record(route)
    if (route.request().method() === 'GET') return route.fulfill({ json: retentionSettings })
    const result = mocks.onRetentionPut?.() ?? { status: 200, json: retentionSettings }
    return route.fulfill(result)
  })
  await page.route('**/api/staff/stores/*/recordings/*/retry', (route) => {
    record(route)
    const id = route.request().url().split('/recordings/')[1]?.split('/')[0] ?? ''
    mocks.rows = mocks.rows.map((row) =>
      row.id === id ? { ...row, state: 'uploading', failureReason: null } : row,
    )
    return route.fulfill({ status: 202, json: {} })
  })
  await page.route('**/api/staff/stores/*/recordings/*/hold/release', (route) => {
    record(route)
    const id = route.request().url().split('/recordings/')[1]?.split('/')[0] ?? ''
    mocks.rows = mocks.rows.map((row) =>
      row.id === id
        ? { ...row, state: 'stored', holdReason: null, heldBy: null, version: row.version + 1 }
        : row,
    )
    return route.fulfill({ json: {} })
  })
  await page.route('**/api/staff/stores/*/recordings/*/hold', (route) => {
    record(route)
    const id = route.request().url().split('/recordings/')[1]?.split('/')[0] ?? ''
    mocks.rows = mocks.rows.map((row) =>
      row.id === id
        ? {
            ...row,
            state: 'held',
            holdReason: '弁護士からの保全通知',
            heldBy: '本部 佐藤',
            version: row.version + 1,
          }
        : row,
    )
    return route.fulfill({ json: {} })
  })
  await page.route('**/api/staff/stores/*/recordings/*/audio', (route) => {
    record(route)
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: '' })
  })
  await page.route('**/api/staff/stores/*/recordings/*', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    record(route)
    const id = route.request().url().split('/recordings/')[1]?.split('/')[0] ?? ''
    const result = mocks.onDelete?.(id)
    if (!result) {
      mocks.rows = mocks.rows.map((row) =>
        row.id === id ? { ...row, state: 'deleted', deletedAt: shifted(0) } : row,
      )
      return route.fulfill({ status: 204, body: '' })
    }
    return route.fulfill(result)
  })
}

/** ホーム → ヘッダー管理メニュー「録音運用」まで進める。 */
async function openRecordingOps(page: Page) {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
  await page
    .getByRole('navigation', { name: '管理メニュー' })
    .getByRole('button', { name: '録音運用' })
    .click()
  const screen = page.getByRole('region', { name: '録音運用' })
  await expect(screen).toBeVisible()
  return screen
}

function row(page: Page, id: string) {
  return page.getByTestId(`recording-${id}`)
}

// @e2e-covers UC-EYEX-154 UC-EYEX-062 UC-EYEX-129 UC-EYEX-176 AC-EYEX-100 AC-EYEX-115 AC-EYEX-79
test('録音運用は保存中・失敗・保全中・削除予定・削除済みを語で区別し、失敗だけを再試行でき、ダウンロード手段をどこにも置かない', async ({
  page,
}) => {
  const mocks: Mocks = { permissions: [...ALL_PERMISSIONS], rows: [...allRecordings], requests: [] }
  await mockStaffApi(page, mocks)
  const screen = await openRecordingOps(page)

  // 5 区分が同時に並び、それぞれ色ではなく語で示される (AC-EYEX-100)。
  await expect(row(page, uploadingId)).toContainText('送信中')
  await expect(row(page, storedId)).toContainText('保存済み')
  await expect(row(page, failedId)).toContainText('失敗')
  await expect(row(page, failedId)).toContainText('失敗理由: アップロードがタイムアウトしました')
  await expect(row(page, heldId)).toContainText('保全中')
  await expect(row(page, pendingId)).toContainText('削除予定')
  await expect(row(page, deletedId)).toContainText('削除済み')

  // 再試行できるのは失敗した録音だけ (UC-EYEX-154 / AC-EYEX-100)。
  for (const id of [uploadingId, storedId, heldId, pendingId, deletedId, discardedId])
    await expect(row(page, id).getByRole('button', { name: '再試行' })).toHaveCount(0)
  await expect(row(page, failedId).getByRole('button', { name: '再試行' })).toHaveCount(1)

  // 録音の状態は予約の状態から独立している (UC-EYEX-176 / AC-EYEX-115)。
  // 予約に紐づかない破棄受付の録音も、同じ語彙の状態と保持期限を持つ。
  await expect(row(page, discardedId)).toContainText('保存済み')
  await expect(row(page, discardedId)).toContainText('録音者 共有iPad-01')
  await expect(row(page, discardedId)).toContainText('まで保持')
  await expect(row(page, storedId)).toContainText('まで保持')
  await expect(row(page, uploadingId)).toContainText('保持期限未設定')

  // 区分で絞り込むと、その状態だけがサーバへ問い合わされる (UC-EYEX-062)。
  await screen.getByRole('button', { name: '失敗' }).click()
  await expect(row(page, failedId)).toBeVisible()
  await expect(row(page, storedId)).toHaveCount(0)
  await expect(row(page, deletedId)).toHaveCount(0)
  expect(mocks.requests.at(-1)?.url).toContain('state=failed')
  await screen.getByRole('button', { name: '削除済み' }).click()
  await expect(row(page, deletedId)).toBeVisible()
  await expect(row(page, failedId)).toHaveCount(0)
  await screen.getByRole('button', { name: 'すべて' }).click()
  await expect(row(page, storedId)).toBeVisible()

  // 失敗の再試行だけがアップロードをやり直す。
  await row(page, failedId).getByRole('button', { name: '再試行' }).click()
  await expect(row(page, failedId)).toContainText('送信中')
  expect(mocks.requests.some((entry) => entry.url.endsWith(`/recordings/${failedId}/retry`))).toBe(
    true,
  )

  // 音声の持ち出し手段は画面のどこにも無い (UC-EYEX-129 / AC-EYEX-79)。
  await row(page, storedId).getByRole('button', { name: '再生する' }).click()
  await expect(page.getByRole('region', { name: '録音の再生' })).toBeVisible()
  await expect(page.getByText(/ダウンロード/)).toHaveCount(0)
  await expect(page.locator('a[download]')).toHaveCount(0)
  await expect(page.locator('a[href]')).toHaveCount(0)
  await expect(page.locator('audio')).toHaveAttribute('controlsList', 'nodownload')
  await expect(page.locator('audio')).not.toHaveAttribute('controls', /.*/)
})

// @e2e-covers UC-EYEX-123 UC-EYEX-124 UC-EYEX-125 UC-EYEX-039 AC-EYEX-75 AC-EYEX-76 AC-EYEX-77
test('最低保持期限より前の削除は成立予約でも破棄受付でも拒否され、期限を過ぎた録音だけが削除済みになる', async ({
  page,
}) => {
  const confirmedDeadline = shifted(27 * DAY)
  const discardedDeadline = shifted(6 * HOUR)
  const mocks: Mocks = {
    permissions: [...ALL_PERMISSIONS],
    rows: [
      recording({ id: storedId, state: 'stored', retentionUntil: confirmedDeadline }),
      recording({
        id: discardedId,
        state: 'stored',
        reservationId: null,
        endReason: 'discarded',
        retentionUntil: discardedDeadline,
      }),
      recording({
        id: expiredId,
        state: 'stored',
        retentionUntil: shifted(-1 * HOUR),
      }),
    ],
    requests: [],
    onDelete: (id) =>
      id === storedId
        ? {
            status: 409,
            json: { error: 'retention_active', minimumRetentionUntil: confirmedDeadline },
          }
        : id === discardedId
          ? {
              status: 409,
              json: { error: 'retention_active', minimumRetentionUntil: discardedDeadline },
            }
          : { status: 0, json: null },
  }
  await mockStaffApi(page, mocks)
  const screen = await openRecordingOps(page)

  // 成立予約の録音は最低30日。期限前の手動削除は拒否され、期限そのものが出る
  // (UC-EYEX-123 / UC-EYEX-125 / AC-EYEX-75)。
  await expect(screen).toContainText('成立した予約の録音は、録音完了から最低30日間保持します。')
  await row(page, storedId).getByRole('button', { name: '削除する' }).click()
  const refusal = screen.getByText(/保持期間中のため削除できません。/)
  await expect(refusal).toBeVisible()
  const confirmedLabel = new Date(confirmedDeadline).toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  await expect(refusal).toContainText(confirmedLabel)
  await expect(row(page, storedId)).toContainText('保存済み')

  // 破棄した受付の録音は最低24時間。こちらも同じく拒否される
  // (UC-EYEX-124 / AC-EYEX-76)。
  await expect(screen).toContainText('破棄した受付の録音は、録音終了から最低24時間保持します。')
  await row(page, discardedId).getByRole('button', { name: '削除する' }).click()
  await expect(screen.getByText(/保持期間中のため削除できません。/)).toBeVisible()
  await expect(row(page, discardedId)).toContainText('保存済み')

  // 最低保持期限を過ぎた録音だけが削除でき、結果は一覧で追える
  // (UC-EYEX-039 / AC-EYEX-77)。
  mocks.onDelete = undefined
  await expect(row(page, expiredId)).toContainText('保持期限は経過しています')
  await row(page, expiredId).getByRole('button', { name: '削除する' }).click()
  await expect(row(page, expiredId)).toContainText('削除済み')
  await expect(row(page, expiredId).getByRole('button', { name: '削除する' })).toHaveCount(0)
  expect(
    mocks.requests.filter(
      (entry) => entry.method === 'DELETE' && entry.url.endsWith(`/recordings/${expiredId}`),
    ),
  ).toHaveLength(1)
})

// @e2e-covers UC-EYEX-128 UC-EYEX-040 AC-EYEX-78
test('保全と解除は理由を必須にし、保全中の録音は期限を過ぎても通常削除の対象にならない', async ({
  page,
}) => {
  const mocks: Mocks = {
    permissions: [...ALL_PERMISSIONS],
    rows: [
      recording({ id: storedId, state: 'stored', version: 3 }),
      recording({
        id: heldId,
        state: 'held',
        retentionUntil: shifted(-2 * DAY),
        holdReason: '弁護士からの保全通知',
        heldBy: '本部 佐藤',
        version: 5,
      }),
    ],
    requests: [],
    onDelete: (id) =>
      id === heldId
        ? { status: 409, json: { error: 'recording_held', holdReason: '弁護士からの保全通知' } }
        : { status: 204, json: null },
  }
  await mockStaffApi(page, mocks)
  const screen = await openRecordingOps(page)

  // 保全は理由なしでは進まない (UC-EYEX-128)。
  await row(page, storedId).getByRole('button', { name: '保全する' }).click()
  const dialog = page.getByRole('dialog', { name: '録音を保全する' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '保全を実行' }).click()
  await expect(dialog.getByText('保全の理由を入力してください。')).toBeVisible()
  expect(mocks.requests.some((entry) => entry.url.includes('/hold'))).toBe(false)

  await dialog.getByLabel('保全の理由').fill('弁護士からの保全通知')
  await dialog.getByRole('button', { name: '保全を実行' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(row(page, storedId)).toContainText('保全中')
  const hold = mocks.requests.find((entry) => entry.url.endsWith(`/recordings/${storedId}/hold`))
  expect(hold).toBeDefined()
  expect(JSON.parse(hold?.body ?? '{}')).toEqual({ version: 3, reason: '弁護士からの保全通知' })

  // 保全中は期限を過ぎていても本体が消えず、理由と指定者が読める
  // (UC-EYEX-040 / AC-EYEX-78)。
  await expect(row(page, heldId)).toContainText('保持期限は経過しています')
  await expect(row(page, heldId)).toContainText('保全理由: 弁護士からの保全通知')
  await expect(row(page, heldId)).toContainText('指定者 本部 佐藤')
  await row(page, heldId).getByRole('button', { name: '削除する' }).click()
  await expect(screen.getByText(/保全中の録音は削除できません。/)).toBeVisible()
  await expect(screen.getByText(/保全理由: 弁護士からの保全通知/).first()).toBeVisible()
  await expect(row(page, heldId)).toContainText('保全中')

  // 解除も同じだけ説明責任を負う (UC-EYEX-128)。
  await row(page, heldId).getByRole('button', { name: '保全を解除する' }).click()
  const release = page.getByRole('dialog', { name: '録音の保全を解除する' })
  await release.getByRole('button', { name: '解除を実行' }).click()
  await expect(release.getByText('解除の理由を入力してください。')).toBeVisible()
  expect(mocks.requests.some((entry) => entry.url.includes('/hold/release'))).toBe(false)
  await release.getByLabel('解除の理由').fill('保全通知が取り下げられたため')
  await release.getByRole('button', { name: '解除を実行' }).click()
  await expect(release).toHaveCount(0)
  await expect(row(page, heldId)).toContainText('保存済み')
  const released = mocks.requests.find((entry) => entry.url.endsWith('/hold/release'))
  expect(JSON.parse(released?.body ?? '{}')).toEqual({
    version: 5,
    reason: '保全通知が取り下げられたため',
  })
})

// @e2e-covers UC-EYEX-153 UC-EYEX-126 AC-EYEX-99
test('保存期間は最低保証未満を理由つきで拒否し、最低保証以上の運用値だけを保存する', async ({
  page,
}) => {
  const mocks: Mocks = {
    permissions: [...ALL_PERMISSIONS],
    rows: [recording({ id: storedId, state: 'stored' })],
    requests: [],
  }
  await mockStaffApi(page, mocks)
  const screen = await openRecordingOps(page)

  // いま効いている運用値は最低保証以上で、そのまま読める (UC-EYEX-126)。
  await expect(screen.getByLabel('成立予約の保存日数')).toHaveValue('45')
  await expect(screen.getByLabel('破棄受付の保存時間')).toHaveValue('72')

  // 30日未満は保存されず、最低値と理由がその場で出る (UC-EYEX-153 / AC-EYEX-99)。
  await screen.getByLabel('成立予約の保存日数').fill('29')
  await screen.getByRole('button', { name: '保存期間を更新' }).click()
  await expect(
    screen.getByText('成立した予約の録音は、録音完了から最低30日間保持します。').last(),
  ).toBeVisible()
  expect(
    mocks.requests.some(
      (entry) => entry.method === 'PUT' && entry.url.endsWith('/recording-retention'),
    ),
  ).toBe(false)

  // 破棄受付の24時間未満も同じく拒否される。
  await screen.getByLabel('成立予約の保存日数').fill('60')
  await screen.getByLabel('破棄受付の保存時間').fill('23')
  await screen.getByRole('button', { name: '保存期間を更新' }).click()
  await expect(
    screen.getByText('破棄した受付の録音は、録音終了から最低24時間保持します。').last(),
  ).toBeVisible()
  expect(
    mocks.requests.some(
      (entry) => entry.method === 'PUT' && entry.url.endsWith('/recording-retention'),
    ),
  ).toBe(false)

  // 最低保証以上なら、運用設定として引き上げられる (UC-EYEX-126)。
  await screen.getByLabel('破棄受付の保存時間').fill('48')
  await screen.getByRole('button', { name: '保存期間を更新' }).click()
  await expect
    .poll(
      () =>
        mocks.requests.filter(
          (entry) => entry.method === 'PUT' && entry.url.endsWith('/recording-retention'),
        ).length,
    )
    .toBe(1)
  const saved = mocks.requests.find((entry) => entry.method === 'PUT')
  expect(JSON.parse(saved?.body ?? '{}')).toEqual({
    confirmedRetentionDays: 60,
    discardedRetentionHours: 48,
  })
})

// @e2e-covers UC-EYEX-037 UC-EYEX-127 UC-EYEX-042
test('録音を扱える店舗スタッフは再生・一時停止・シークまでで、運用操作と保存期間には触れられず、権限外店舗では一覧を取りにいかない', async ({
  page,
}) => {
  const mocks: Mocks = {
    permissions: [...READ_ONLY_PERMISSIONS],
    rows: [recording({ id: storedId, state: 'stored', recorderId: '山田', durationSeconds: 305 })],
    requests: [],
  }
  await mockStaffApi(page, mocks)
  const screen = await openRecordingOps(page)

  // 選択中店舗のスタッフは、管理権限が無くても再生できる (UC-EYEX-127)。
  const entry = row(page, storedId)
  await expect(entry.getByRole('button', { name: '再生する' })).toBeVisible()
  await expect(entry.getByRole('button', { name: '保全する' })).toHaveCount(0)
  await expect(entry.getByRole('button', { name: '削除する' })).toHaveCount(0)
  await expect(screen.getByLabel('成立予約の保存日数')).toHaveCount(0)

  // 再生面は録音日時・録音者・長さを添え、再生・一時停止・シークが揃う
  // (UC-EYEX-037)。
  await entry.getByRole('button', { name: '再生する' }).click()
  const player = page.getByRole('region', { name: '録音の再生' })
  await expect(player).toContainText('山田')
  await expect(player).toContainText('05:05')
  await expect(player.getByRole('button', { name: '再生', exact: true })).toBeVisible()
  await expect(player.getByRole('button', { name: '一時停止' })).toBeVisible()
  await expect(player.locator('audio')).toHaveAttribute(
    'src',
    new RegExp(`/recordings/${storedId}/audio$`),
  )
  await player.getByRole('button', { name: '再生', exact: true }).click()
  await expect
    .poll(() => mocks.requests.some((request) => request.url.endsWith('/audio')))
    .toBe(true)
  await player.getByRole('button', { name: '一時停止' }).click()
  const seek = player.getByLabel('再生位置')
  await expect(seek).toHaveValue('0')
  await seek.press('ArrowRight')
  await seek.press('ArrowRight')
  await expect(seek).toHaveValue('2')

  // 録音を扱う権限が無い店舗では、一覧を取りにいかず存在も示さない
  // (UC-EYEX-042)。
  mocks.permissions = ['store.read', 'reservation.read']
  mocks.requests.length = 0
  await openRecordingOps(page)
  await expect(page.getByText('この店舗で録音を扱う権限がありません。')).toBeVisible()
  await expect(row(page, storedId)).toHaveCount(0)
  expect(mocks.requests.some((request) => request.url.includes('/recordings'))).toBe(false)
})

/* ------------------------------------------------------------------ *
 * 予約受付中の録音面と、受付履歴からの再生。
 *
 * ここから下は「録音運用」ではなく、電話・店頭予約のフロー（`BookingFlow` の
 * aside に出る `RecordingIndicator`）と、受付履歴の iPad録音 パネルを扱う。
 * ブラウザのマイク権限は `navigator.mediaDevices.getUserMedia` を
 * `addInitScript` で差し替えて駆動する。SPA 側は `requestMicrophonePermission`
 * 経由でしかマイクへ触れないので、この 1 点が実機と同じ唯一の境界になる。
 * ------------------------------------------------------------------ */

const bookingPurposeId = '77777777-7777-4777-8777-777777777777'
const createdReservationId = '12121212-1212-4121-8121-121212121212'
const walkinSessionId = '13131313-1313-4131-8131-131313131313'
const historyReservationId = '14141414-1414-4141-8141-141414141414'

const BOOKING_PERMISSIONS = ['store.read', 'reservation.read', 'recording.read']

/** JST の当日。アプリと同じ規則で算出する（アプリは注入された today を使う）。 */
function jstToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

function dayLabel(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  return `${at.getUTCMonth() + 1}月${at.getUTCDate()}日（${WEEKDAYS[at.getUTCDay()]}）`
}

const jstDay = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})
const jstTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** 画面と同じ `2026年8月27日 11:00`。 */
function jstInstantLabel(iso: string): string {
  const at = new Date(iso)
  return `${jstDay.format(at)} ${jstTime.format(at)}`
}

const availabilitySettings = {
  storeId: ginzaId,
  version: 3,
  receptionStatus: 'open',
  businessHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    periods: [{ startTime: '10:00', endTime: '19:00' }],
  })),
  exceptions: [],
  purposes: [
    {
      id: bookingPurposeId,
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

function slotsFor(date: string) {
  return {
    storeId: ginzaId,
    date,
    timezone: 'Asia/Tokyo',
    durationMinutes: 60,
    intervalMinutes: 30,
    slots: ['10:00', '10:30', '11:00', '11:30'].map((startTime) => ({
      date,
      startTime,
      endTime: startTime,
      startAt: `${date}T00:00:00.000Z`,
      endAt: `${date}T01:00:00.000Z`,
    })),
  }
}

type BookingMocks = {
  requests: { method: string; url: string; body: string }[]
  /** 録音本体の PUT。本文はバイナリなので長さと content-type だけを控える。 */
  uploads?: { method: string; url: string; contentType: string; size: number }[]
  /** 録音メタデータ POST の応答。既定は 保存済み。 */
  onRecordingPost?: (body: Record<string, unknown>) => Promise<{ status: number; json: unknown }>
}

/** 予約受付フローに必要な API だけを差し替える。 */
async function mockBookingApi(page: Page, mocks: BookingMocks) {
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ json: { token: 'staff-e2e' } }),
  )
  await page.route('**/api/staff/stores', (route) => route.fulfill({ json: stores }))
  await page.route('**/api/staff/store-switches', (route) =>
    route.fulfill({ status: 201, json: {} }),
  )
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({ json: BOOKING_PERMISSIONS }),
  )
  await page.route('**/api/staff/stores/*/ledger*', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/staff/stores/*/reception-history*', (route) =>
    route.fulfill({ json: [] }),
  )
  await page.route('**/api/staff/stores/*/customers*', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/staff/stores/*/availability/settings', (route) =>
    route.fulfill({ json: availabilitySettings }),
  )
  await page.route('**/api/staff/stores/*/availability/slots*', (route) =>
    route.fulfill({
      json: slotsFor(new URL(route.request().url()).searchParams.get('date') ?? jstToday()),
    }),
  )
  // 録音本体は別パスの PUT。R2 の代わりにここで受け取り、保存済みを返す。
  await page.route('**/api/staff/stores/*/recordings/*/audio', (route) => {
    const request = route.request()
    mocks.uploads?.push({
      method: request.method(),
      url: request.url(),
      contentType: request.headers()['content-type'] ?? '',
      size: request.postDataBuffer()?.length ?? 0,
    })
    return route.fulfill({
      status: 200,
      json: recording({ id: storedId, state: 'stored', reservationId: createdReservationId }),
    })
  })
  // 一覧 GET と メタデータ POST は同じパス。method で振り分ける。
  await page.route('**/api/staff/stores/*/recordings', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ json: [] })
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>
    mocks.requests.push({ method: 'POST', url: request.url(), body: request.postData() ?? '' })
    if (mocks.onRecordingPost) return route.fulfill(await mocks.onRecordingPost(body))
    return route.fulfill({
      status: 201,
      json: recording({
        id: storedId,
        state: 'stored',
        receptionSessionId: String(body.receptionSessionId),
        reservationId: (body.reservationId as string | null) ?? null,
        recorderId: String(body.recorderId),
        startedAt: String(body.startedAt),
        endedAt: String(body.endedAt),
        durationSeconds: Number(body.durationSeconds),
        endReason: body.endReason as Recording['endReason'],
      }),
    })
  })
  await page.route('**/api/staff/stores/*/reservations', (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ json: [] })
    mocks.requests.push({ method: 'POST', url: request.url(), body: request.postData() ?? '' })
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, string>
    return route.fulfill({
      status: 201,
      json: {
        id: createdReservationId,
        organizationId: 'org-eyex',
        storeId: ginzaId,
        reservationNumber: 'EY-2001',
        source: 'staff',
        status: 'confirmed',
        startAt: `${body.date}T01:00:00.000Z`,
        endAt: `${body.date}T02:00:00.000Z`,
        purposeIds: [bookingPurposeId],
        customer: { name: '田中花子', kana: 'タナカハナコ', phone: '09012345678', email: null },
        recital: body.recital ?? '復唱',
        reservationMemo: null,
        handoffNote: null,
        version: 1,
        createdAt: `${body.date}T00:00:00.000Z`,
      },
    })
  })
}

type MicrophoneProbe = { calls: number }

/**
 * ブラウザのマイク権限そのものを差し替える。`getUserMedia` の呼び出し回数を
 * 数えるので、「スタッフの明示操作より前にプロンプトが開かない」ことを
 * 主張できる (AC-EYEX-113)。
 */
async function stubMicrophone(page: Page, decision: 'granted' | 'denied') {
  await page.addInitScript(
    ({ outcome }) => {
      const probe = { calls: 0 }
      Object.defineProperty(window, '__microphone', { configurable: true, value: probe })
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => {
            probe.calls += 1
            if (outcome === 'denied') throw new DOMException('denied', 'NotAllowedError')
            return { getTracks: () => [{ stop: () => {} }] }
          },
        },
      })
      /*
       * `MediaRecorder` そのものを差し替える。実機の webm エンコーダは
       * headless では動かないが、SPA が触るのは start / stop / dataavailable /
       * stop イベントだけなので、この 4 点だけを本物と同じ順序で再現すれば
       * 「録った音が本文として送られる」ところまで実行できる。
       */
      class FakeMediaRecorder {
        mimeType: string
        private readonly listeners: Record<string, ((event: unknown) => void)[]> = {}
        constructor(_stream: unknown, init?: { mimeType?: string }) {
          this.mimeType = init?.mimeType ?? 'audio/webm'
        }
        addEventListener(type: string, listener: (event: unknown) => void) {
          const bucket = this.listeners[type] ?? []
          bucket.push(listener)
          this.listeners[type] = bucket
        }
        start() {}
        stop() {
          const data = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: this.mimeType })
          for (const listener of this.listeners.dataavailable ?? []) listener({ data })
          for (const listener of this.listeners.stop ?? []) listener({})
        }
      }
      Object.defineProperty(window, 'MediaRecorder', {
        configurable: true,
        value: FakeMediaRecorder,
      })
    },
    { outcome: decision },
  )
}

function microphoneCalls(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __microphone: MicrophoneProbe }).__microphone.calls,
  )
}

/** ホーム → 主操作「新しい予約を取る」まで進め、録音面を返す。 */
async function openBooking(page: Page) {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
  await page.getByRole('button', { name: '新しい予約を取る' }).click()
  await expect(page.getByRole('heading', { name: 'ご来店予定の日を伺えますか？' })).toBeVisible()
  return page.getByRole('region', { name: 'iPad録音' })
}

/** 日 → 時刻 → 来店目的 → お客様情報 → 復唱 まで進める。 */
async function reachRecital(page: Page) {
  await page.getByRole('button', { name: dayLabel(jstToday()) }).click()
  await page.getByRole('button', { name: '11:00', exact: true }).click()
  await page.getByRole('button', { name: /メガネを新しく作りたい/ }).click()
  await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
  await page.getByLabel('お電話番号').fill('09012345678')
  await page.getByLabel('お名前', { exact: true }).fill('田中花子')
  await page.getByLabel('フリガナ').fill('タナカハナコ')
  await page.getByRole('button', { name: '復唱へ進む' }).click()
}

// @e2e-covers UC-EYEX-033 UC-EYEX-031 AC-EYEX-113 AC-EYEX-05
test('録音は取得目的・閲覧者・最低保持期間を説明してからスタッフの明示操作でだけ権限を求め、受付開始から復唱終了まで脇の列で状態だけを示す', async ({
  page,
}) => {
  const mocks: BookingMocks = { requests: [] }
  await stubMicrophone(page, 'granted')
  await mockBookingApi(page, mocks)
  const indicator = await openBooking(page)

  // 最初の要求より前に、何のために録り・誰が聞き・最低どれだけ残すかを言う
  // (UC-EYEX-033 / AC-EYEX-113)。
  await expect(indicator.getByTestId('recording-state')).toHaveText('権限確認')
  await expect(indicator).toContainText('予約内容の復唱を、聞き間違いの確認のために記録します。')
  await expect(indicator).toContainText(
    '再生できるのは選択中の店舗で録音を扱えるスタッフだけです。',
  )
  await expect(indicator).toContainText('成立した予約の録音は録音完了から最低30日')
  await expect(indicator).toContainText('破棄した受付の録音は録音終了から最低24時間保持します。')
  // 画面を開いただけではブラウザの権限プロンプトは開かない (AC-EYEX-113)。
  expect(await microphoneCalls(page)).toBe(0)

  await indicator.getByRole('button', { name: '録音を開始する' }).click()
  await expect(indicator.getByTestId('recording-state')).toHaveText('録音中')
  expect(await microphoneCalls(page)).toBe(1)

  // 録音中は状態だけが残り、説明も操作も畳まれる (AC-EYEX-05)。
  await expect(indicator).not.toContainText(
    '予約内容の復唱を、聞き間違いの確認のために記録します。',
  )
  await expect(indicator.getByRole('button')).toHaveCount(0)

  // 録音面は脇の列にあり、予約入力の列を取らない (AC-EYEX-05)。
  expect(await indicator.evaluate((node) => node.closest('aside') !== null)).toBe(true)
  expect(await indicator.evaluate((node) => node.closest('main > section') !== null)).toBe(false)
  const dates = page.getByRole('group', { name: '来店予定日' })
  const inputBox = await dates.boundingBox()
  const asideBox = await indicator.boundingBox()
  if (!inputBox || !asideBox) throw new Error('予約入力と録音面の両方が配置されているはず')
  expect(asideBox.x).toBeGreaterThanOrEqual(inputBox.x + inputBox.width)

  // 受付開始から復唱終了まで録れている (UC-EYEX-031)。
  await reachRecital(page)
  await expect(indicator.getByTestId('recording-state')).toHaveText('録音中')
  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  await expect(indicator.getByTestId('recording-state')).toHaveText('保存済み')
  await expect(indicator).toContainText('保存済みです。予約詳細または受付履歴から再生できます。')
})

// @e2e-covers UC-EYEX-177 AC-EYEX-114
test('マイク権限を拒否されると Safari の回復手順と録音なし継続の可否を示し、録音なしでも受付を続けられる', async ({
  page,
}) => {
  const mocks: BookingMocks = { requests: [] }
  await stubMicrophone(page, 'denied')
  await mockBookingApi(page, mocks)
  const indicator = await openBooking(page)

  await indicator.getByRole('button', { name: '録音を開始する' }).click()

  // どこで許可し直すかを、機種と手順で言い切る (AC-EYEX-114)。
  await expect(indicator).toContainText(
    'Safariでマイクが許可されていません。iPadの「設定」→「Safari」→「マイク」でEYEX予約へのアクセスを許可してから、もう一度お試しください。',
  )
  // 録音なしで続けてよいかどうかも同じ面で答える (UC-EYEX-177)。
  await expect(indicator).toContainText('この店舗では録音なしで予約受付を続けられます。')
  await expect(indicator.getByRole('button', { name: '権限を再確認する' })).toBeVisible()
  expect(await microphoneCalls(page)).toBe(1)

  // 再確認はもう一度ブラウザへ問い合わせる。拒否のままなら手順が残る。
  await indicator.getByRole('button', { name: '権限を再確認する' }).click()
  await expect.poll(() => microphoneCalls(page)).toBe(2)
  await expect(indicator).toContainText('Safariでマイクが許可されていません。')

  // 録音なしを選ぶと録音面ごと畳まれ、受付はそのまま続く (UC-EYEX-177)。
  await indicator.getByRole('button', { name: '録音なしで続ける' }).click()
  await expect(page.getByRole('region', { name: 'iPad録音' })).toHaveCount(0)
  await reachRecital(page)
  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  await expect(page.getByRole('heading', { name: '予約を確定しました' })).toBeVisible()
  // 録音していないのだから、録音メタデータも送らない。
  expect(mocks.requests.some((entry) => entry.url.endsWith('/recordings'))).toBe(false)
})

// @e2e-covers UC-EYEX-036 AC-EYEX-89
test('録音メタデータは受付セッション・店舗・録音主体・時刻を必ず運び、予約に紐づくのは成立したときだけで、破棄した受付は終了理由だけを持つ', async ({
  page,
}) => {
  const mocks: BookingMocks = { requests: [] }
  await stubMicrophone(page, 'granted')
  await mockBookingApi(page, mocks)
  const indicator = await openBooking(page)
  await indicator.getByRole('button', { name: '録音を開始する' }).click()
  await expect(indicator.getByTestId('recording-state')).toHaveText('録音中')
  await reachRecital(page)
  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  await expect(indicator.getByTestId('recording-state')).toHaveText('保存済み')

  // 成立した予約の録音だけが予約 ID を持つ (UC-EYEX-036)。
  const confirmed = mocks.requests.find((entry) => entry.url.endsWith('/recordings'))
  expect(confirmed).toBeDefined()
  // 店舗はパスが運ぶ。他店舗の録音として登録する余地を作らない。
  expect(confirmed?.url).toContain(`/stores/${ginzaId}/recordings`)
  const confirmedBody = JSON.parse(confirmed?.body ?? '{}') as Record<string, unknown>
  expect(confirmedBody.reservationId).toBe(createdReservationId)
  expect(confirmedBody.endReason).toBe('completed')
  expect(confirmedBody.recorderType).toBe('personal')
  expect(typeof confirmedBody.recorderId).toBe('string')
  expect(String(confirmedBody.receptionSessionId)).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  )
  // 冪等キーは受付セッションそのもの。再送しても録音が増えない。
  expect(confirmedBody.idempotencyKey).toBe(confirmedBody.receptionSessionId)
  expect(Number.isNaN(Date.parse(String(confirmedBody.startedAt)))).toBe(false)
  expect(Number.isNaN(Date.parse(String(confirmedBody.endedAt)))).toBe(false)
  expect(Date.parse(String(confirmedBody.endedAt))).toBeGreaterThanOrEqual(
    Date.parse(String(confirmedBody.startedAt)),
  )
  expect(typeof confirmedBody.durationSeconds).toBe('number')

  // 破棄した受付でも録音は保存される。予約 ID は持たず、終了理由と
  // 受付セッション ID を持つ (AC-EYEX-89)。
  mocks.requests.length = 0
  const second = await openBooking(page)
  await second.getByRole('button', { name: '録音を開始する' }).click()
  await expect(second.getByTestId('recording-state')).toHaveText('録音中')
  await page.getByRole('button', { name: dayLabel(jstToday()) }).click()
  await page.getByRole('button', { name: '入力を破棄する' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '破棄する' }).click()
  await expect(second.getByTestId('recording-state')).toHaveText('保存済み')

  const discarded = mocks.requests.find((entry) => entry.url.endsWith('/recordings'))
  const discardedBody = JSON.parse(discarded?.body ?? '{}') as Record<string, unknown>
  expect(discardedBody.reservationId).toBeNull()
  expect(discardedBody.endReason).toBe('discarded')
  expect(String(discardedBody.receptionSessionId)).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  )
  // 破棄した受付の受付セッションは、成立した受付のものと同じではない。
  expect(discardedBody.receptionSessionId).not.toBe(confirmedBody.receptionSessionId)
  expect(mocks.requests.some((entry) => entry.url.endsWith('/reservations'))).toBe(false)
})

// @e2e-covers UC-EYEX-034
test('録音の保存失敗は予約が確定していない段階で見え、予約入力への影響が無いことまで言う', async ({
  page,
}) => {
  const mocks: BookingMocks = {
    requests: [],
    onRecordingPost: async () => ({ status: 503, json: { error: 'storage_unavailable' } }),
  }
  await stubMicrophone(page, 'granted')
  await mockBookingApi(page, mocks)
  const indicator = await openBooking(page)
  await indicator.getByRole('button', { name: '録音を開始する' }).click()
  await expect(indicator.getByTestId('recording-state')).toHaveText('録音中')

  // 復唱の前に受付を打ち切ると、録音はそこで終わる。
  await page.getByRole('button', { name: dayLabel(jstToday()) }).click()
  await page.getByRole('button', { name: '入力を破棄する' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '破棄する' }).click()

  // 予約はまだ 1 件も確定していないのに、保存できなかった事実は見えている
  // (UC-EYEX-034)。
  await expect(indicator.getByTestId('recording-state')).toHaveText('失敗')
  await expect(indicator).toContainText('録音を保存できていません。予約内容には影響しません。')
  await expect(indicator.getByRole('button', { name: '今すぐ再試行' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '予約を確定しました' })).toHaveCount(0)
  await expect(indicator.getByTestId('booking-result')).toHaveCount(0)
  expect(mocks.requests.some((entry) => entry.url.endsWith('/reservations'))).toBe(false)
})

// @e2e-covers UC-EYEX-041 AC-EYEX-07
test('予約成立と録音送信中は別々の事実として並び、確定後に録音の保存状態を受付履歴で追える', async ({
  page,
}) => {
  let release = () => {}
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const mocks: BookingMocks = {
    requests: [],
    onRecordingPost: async (body) => {
      await pending
      return {
        status: 201,
        json: recording({
          id: storedId,
          state: 'stored',
          receptionSessionId: String(body.receptionSessionId),
          reservationId: createdReservationId,
        }),
      }
    },
  }
  await stubMicrophone(page, 'granted')
  await mockBookingApi(page, mocks)
  const indicator = await openBooking(page)
  await indicator.getByRole('button', { name: '録音を開始する' }).click()
  await reachRecital(page)
  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()

  // 予約は成立している。録音はまだ送信中。2 つは別の行として読める
  // (UC-EYEX-041 / AC-EYEX-07)。
  await expect(page.getByRole('heading', { name: '予約を確定しました' })).toBeVisible()
  await expect(page.getByText('EY-2001')).toBeVisible()
  await expect(indicator.getByTestId('booking-result')).toHaveText('予約は成立しました')
  await expect(indicator.getByTestId('recording-state')).toHaveText('送信中')
  await expect(indicator).toContainText('再試行 1/5')

  // 確定後の案内は「どこで保存状態を追えるか」を名指しする (AC-EYEX-07)。
  await expect(page.getByText('録音の保存状態は予約詳細と受付履歴で確認できます。')).toBeVisible()

  release()
  await expect(indicator.getByTestId('recording-state')).toHaveText('保存済み')
  await expect(indicator.getByTestId('booking-result')).toHaveText('予約は成立しました')

  await page.getByRole('button', { name: '受付履歴を開く' }).click()
  await expect(page.getByRole('heading', { name: '受付履歴' })).toBeVisible()
})

const historyEntries = [
  {
    id: '15151515-1515-4151-8151-151515151515',
    occurredAt: '2026-08-27T05:18:00.000Z',
    source: 'staff' as const,
    action: 'created' as const,
    entityType: 'reservation' as const,
    entityId: historyReservationId,
    reservationId: historyReservationId,
    customerName: '田中 花子',
    customerPhone: '090-1234-5678',
    reservationNumber: 'EY-0827-1100',
    actorId: '山田',
    requiresAttention: false,
    recordingStatus: 'none' as const,
  },
  {
    id: '16161616-1616-4161-8161-161616161616',
    occurredAt: '2026-08-27T05:02:00.000Z',
    source: 'walkin' as const,
    action: 'walkin_created' as const,
    entityType: 'walkin' as const,
    entityId: walkinSessionId,
    reservationId: null,
    customerName: null,
    customerPhone: null,
    reservationNumber: null,
    actorId: '鈴木',
    requiresAttention: false,
    recordingStatus: 'none' as const,
  },
]

async function mockHistoryApi(page: Page, permissions: string[], rows: Recording[]) {
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ json: { token: 'staff-e2e' } }),
  )
  await page.route('**/api/staff/stores', (route) => route.fulfill({ json: stores }))
  await page.route('**/api/staff/store-switches', (route) =>
    route.fulfill({ status: 201, json: {} }),
  )
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({ json: permissions }),
  )
  await page.route('**/api/staff/stores/*/ledger*', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/staff/stores/*/reception-history*', (route) =>
    route.fulfill({ json: historyEntries }),
  )
  await page.route('**/api/staff/stores/*/recordings*', (route) => route.fulfill({ json: rows }))
  await page.route('**/api/staff/stores/*/recordings/*/audio', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: '' }),
  )
}

// @e2e-covers UC-EYEX-032 AC-EYEX-60
test('受付履歴の各イベントは録音日時・録音者・長さを添えて再生でき、破棄受付の録音も受付セッションで結び直される', async ({
  page,
}) => {
  const endedAt = '2026-08-27T05:23:05.000Z'
  await mockHistoryApi(
    page,
    [...READ_ONLY_PERMISSIONS],
    [
      recording({
        id: storedId,
        state: 'stored',
        reservationId: historyReservationId,
        recorderId: '山田',
        endedAt,
        durationSeconds: 305,
      }),
      recording({
        id: discardedId,
        state: 'stored',
        reservationId: null,
        receptionSessionId: walkinSessionId,
        endReason: 'discarded',
        recorderId: '共有iPad-01',
        recorderType: 'shared_terminal',
        endedAt,
        durationSeconds: 62,
      }),
    ],
  )
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
  await page
    .getByRole('navigation', { name: '副操作' })
    .getByRole('button', { name: '受付履歴' })
    .click()
  await expect(page.getByRole('heading', { name: '受付履歴' })).toBeVisible()

  // 予約に紐づく受付イベントは、その予約の録音を連れてくる (UC-EYEX-032)。
  const list = page.getByRole('region', { name: '受付履歴' })
  await list.getByRole('button', { name: /田中 花子/ }).click()
  const panel = page.getByRole('region', { name: 'iPad録音' })
  await expect(panel).toContainText('保存済み')
  await expect(panel).toContainText(jstInstantLabel(endedAt))
  await expect(panel).toContainText('山田')
  await expect(panel).toContainText('05:05')

  // 許可されたスタッフには再生・一時停止・シークが揃う (AC-EYEX-60)。
  await expect(panel.getByRole('button', { name: '再生', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: '一時停止' })).toBeVisible()
  await expect(panel.locator('audio')).toHaveAttribute(
    'src',
    new RegExp(`/recordings/${storedId}/audio$`),
  )
  const seek = panel.getByLabel('再生位置')
  await expect(seek).toHaveValue('0')
  await seek.press('ArrowRight')
  await expect(seek).toHaveValue('1')
  // 持ち出しはここでも許さない。
  await expect(panel).toContainText('ダウンロードはできません。再生操作は監査されます。')

  // 予約の無いウォークイン受付は、受付セッションで自分の録音と結ばれる。
  await list.getByRole('button', { name: /顧客未登録/ }).click()
  await expect(panel).toContainText('共有iPad-01')
  await expect(panel).toContainText('01:02')

  // 録音を聞けない店舗では、パネルごと出さない。
  await mockHistoryApi(page, ['store.read', 'reservation.read'], [])
  await page.goto('/')
  await page
    .getByRole('navigation', { name: '副操作' })
    .getByRole('button', { name: '受付履歴' })
    .click()
  await page
    .getByRole('region', { name: '受付履歴' })
    .getByRole('button', { name: /田中 花子/ })
    .click()
  await expect(page.getByRole('region', { name: 'iPad録音' })).toHaveCount(0)
})

// @e2e-covers UC-EYEX-035
test('録音本体はメタデータとは別に非公開の保管先へ送られ、持ち出せる URL はどこにも生まれない', async ({
  page,
}) => {
  const mocks: BookingMocks = { requests: [], uploads: [] }
  await stubMicrophone(page, 'granted')
  await mockBookingApi(page, mocks)
  const indicator = await openBooking(page)
  await indicator.getByRole('button', { name: '録音を開始する' }).click()
  await expect(indicator.getByTestId('recording-state')).toHaveText('録音中')
  await reachRecital(page)
  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  await expect(indicator.getByTestId('recording-state')).toHaveText('保存済み')

  // メタデータの登録で作られた録音 ID 宛に、本体だけが別途送られる
  // (UC-EYEX-035)。
  const created = mocks.requests.find((entry) => entry.url.endsWith('/recordings'))
  const createdBody = JSON.parse(created?.body ?? '{}') as Record<string, unknown>
  expect(createdBody.contentType).toBe('audio/webm')
  const upload = mocks.uploads?.find((entry) => entry.url.endsWith('/audio'))
  expect(upload).toBeDefined()
  expect(upload?.method).toBe('PUT')
  expect(upload?.url).toContain(`/api/staff/stores/${ginzaId}/recordings/${storedId}/audio`)
  // 実際に録れた音が本文として載っている。空の PUT では保管したことにならない。
  expect(upload?.size ?? 0).toBeGreaterThan(0)
  expect(upload?.contentType).toMatch(/^audio\//)
  expect(mocks.uploads).toHaveLength(1)

  // 保管先は非公開。ブラウザ側に取り出せる URL は一切現れない。
  await expect(page.locator('a[download]')).toHaveCount(0)
  await expect(page.locator('audio')).toHaveCount(0)
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')].map((node) => node.getAttribute('href') ?? ''),
    ),
  ).toEqual([])
  await expect(page.getByText(/ダウンロード/)).toHaveCount(0)
})

/* ------------------------------------------------------------------ *
 * 予約検索から開いた予約の録音面。
 * ------------------------------------------------------------------ */

const searchReservation = {
  id: historyReservationId,
  organizationId: 'org-eyex',
  storeId: ginzaId,
  reservationNumber: 'EY-0827-1100',
  source: 'staff' as const,
  status: 'confirmed' as const,
  startAt: '2026-08-27T02:00:00.000Z',
  endAt: '2026-08-27T03:00:00.000Z',
  purposeIds: [bookingPurposeId],
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

/** 予約検索に必要な API だけを差し替える。それ以外は空で答える。 */
async function mockSearchApi(page: Page, permissions: string[], rows: Recording[]) {
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/auth/refresh') return route.fulfill({ json: { token: 'staff-e2e' } })
    if (path === '/api/staff/stores') return route.fulfill({ json: stores })
    if (path.endsWith('/permissions')) return route.fulfill({ json: permissions })
    if (path.endsWith('/recordings')) return route.fulfill({ json: rows })
    if (path.endsWith('/reservations')) return route.fulfill({ json: [searchReservation] })
    return route.fulfill({ json: [] })
  })
}

// @e2e-covers AC-EYEX-15
test('予約検索から開いた予約は、許可されたスタッフに録音日時・録音者・長さと再生・一時停止・シークを出す', async ({
  page,
}) => {
  const endedAt = '2026-08-27T05:23:05.000Z'
  await mockSearchApi(
    page,
    [...READ_ONLY_PERMISSIONS],
    [
      recording({
        id: storedId,
        state: 'stored',
        reservationId: historyReservationId,
        recorderId: '山田',
        endedAt,
        durationSeconds: 305,
      }),
    ],
  )
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
  await page.getByRole('button', { name: '予約を検索', exact: true }).click()
  await expect(page.getByRole('heading', { name: '予約を検索する' })).toBeVisible()
  await page.getByLabel('氏名・電話番号・予約番号').fill('田中 花子')
  await page.getByRole('button', { name: '検索する' }).click()

  // 検索結果を開くまでは、その予約の録音面は出ない。
  await expect(page.getByRole('region', { name: 'iPad録音' })).toHaveCount(0)
  await page.getByRole('button', { name: /田中 花子 様/ }).click()
  await expect(page.getByRole('region', { name: '予約詳細' })).toBeVisible()

  // 開いた予約の録音が、いつ・誰が・どれだけ の 3 点を添えて並ぶ (AC-EYEX-15)。
  const panel = page.getByRole('region', { name: 'iPad録音' })
  await expect(panel).toContainText('録音日時')
  await expect(panel).toContainText(jstInstantLabel(endedAt))
  await expect(panel).toContainText('録音者')
  await expect(panel).toContainText('山田')
  await expect(panel).toContainText('長さ')
  await expect(panel).toContainText('05:05')

  // 再生・一時停止・シークの 3 つが揃う (AC-EYEX-15)。
  await expect(panel.getByRole('button', { name: '再生', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: '一時停止' })).toBeVisible()
  await expect(panel.locator('audio')).toHaveAttribute(
    'src',
    new RegExp(`/recordings/${storedId}/audio$`),
  )
  await panel.getByRole('button', { name: '再生', exact: true }).click()
  await panel.getByRole('button', { name: '一時停止' }).click()
  const seek = panel.getByLabel('再生位置')
  await expect(seek).toHaveValue('0')
  await seek.press('ArrowRight')
  await seek.press('ArrowRight')
  await expect(seek).toHaveValue('2')

  // 聞けることと持ち出せることは別。持ち出す手段はここにも無い。
  await expect(panel).toContainText('ダウンロードはできません。再生操作は監査されます。')
  await expect(page.locator('a[download]')).toHaveCount(0)
})

/* ------------------------------------------------------------------ *
 * 遠隔失効された共有 iPad。
 * ------------------------------------------------------------------ */

const revokedTerminalId = '55555555-5555-4555-8555-555555555555'
const deviceToken = 'eyex-shared-terminal-device-token-0123456789ab'

// @e2e-covers UC-EYEX-158 AC-EYEX-98
test('遠隔失効された共有iPadは次の通信で再登録画面だけを出し、未送信の業務操作を実行しない', async ({
  page,
}) => {
  const seen: { method: string; url: string }[] = []
  await page.route('**/api/**', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    seen.push({ method: request.method(), url: url.pathname })
    // 個人セッションは持たない端末。名乗れるのはデバイストークンだけ。
    if (url.pathname === '/api/auth/refresh')
      return route.fulfill({ status: 401, json: { error: 'unauthenticated' } })
    if (url.pathname.endsWith('/session'))
      return route.fulfill({ status: 401, json: { error: 'terminal_revoked' } })
    return route.fulfill({ json: [] })
  })

  await page.setViewportSize(VIEWPORT)
  await page.goto(`/terminal/${revokedTerminalId}/${deviceToken}`)

  // 端末が次に通信した時点で、出るのは再登録画面だけ (UC-EYEX-158 / AC-EYEX-98)。
  await expect(
    page.getByRole('heading', { name: 'この端末の利用は停止されています' }),
  ).toBeVisible()
  await expect(
    page.getByText('共有セッションが失効しました。端末を再登録してください。'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '端末を再登録する' })).toBeVisible()

  // 業務画面へは戻らない。ホームもその導線も無い。
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新しい予約を取る' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '副操作' })).toHaveCount(0)

  // 失効を知ったあとは、店舗スコープの業務要求を 1 つも出さない。
  expect(
    seen.filter((entry) => entry.url.startsWith('/api/staff/stores/')).map((entry) => entry.url),
  ).toEqual([])
  expect(seen.some((entry) => entry.url.endsWith('/session'))).toBe(true)
  // 端末が名乗り直す前に、勝手に別の書き込みを試みることもない。
  expect(seen.filter((entry) => entry.method !== 'GET' && entry.method !== 'POST')).toEqual([])
  expect(seen.filter((entry) => entry.method === 'POST').map((entry) => entry.url)).toEqual([
    '/api/auth/refresh',
  ])
})
