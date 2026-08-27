/*
 * EYEX 画面証跡キャプチャ（Playwright スクリプト / テストではない）。
 *
 * `SCREEN_INVENTORY.md` の screen_id ごとに、実装が実際に描画している画面を
 * 承認済みモック PNG と同じファイル名（`impl--` 接頭辞つき）で保存する。
 *
 * 実行（`services/glasses_management` を作業ディレクトリにする）:
 *   lsof -ti:4175 | xargs kill -9
 *   pnpm run build && pnpm exec vite preview --port 4175 --strictPort &
 *   node e2e/screens.capture.ts
 *
 * preview サーバーは呼び出し側が起動する。何度実行しても同じファイル名を
 * 上書きするだけなので冪等である。
 *
 * このファイルは `*.spec.ts` ではないので `playwright.config.ts` の
 * `testDir: './e2e'` からは収集されない（`playwright test` の既定 testMatch が
 * spec / test で終わるファイルだけを対象にするため）。
 */

import { type Browser, chromium, type Locator, type Page, type Route } from '@playwright/test'

/**
 * 出力先。`services/glasses_management` を作業ディレクトリとして実行する前提の
 * 相対パスにしてある（`e2e/tsconfig.json` は `types: []` なので node の型は
 * 使えず、`node:path` を引き込めない）。
 */
const OUT_DIR = '../../docs/frontend/screens'
/*
 * 既定は 4175 だが、他の作業と preview を共有するときのために環境変数で
 * 差し替えられるようにしておく（`e2e/gallery.diff.ts` の `GALLERY_BASE` と同じ流儀）。
 */
const BASE_URL = process.env.SCREENS_BASE ?? 'http://localhost:4175'

const IPAD = { width: 1180, height: 820 }
const SP = { width: 375, height: 812 }

/* ------------------------------------------------------------------ *
 * 出力
 * ------------------------------------------------------------------ */

const captured: string[] = []

async function shot(page: Page, id: string, state: string, viewport: 'ipad-landscape' | 'sp') {
  const name = `impl--${id}--${state}--${viewport}.png`
  // レイアウトと非同期描画が落ち着いてから撮る。
  await page.waitForLoadState('networkidle').catch(() => undefined)
  /*
   * 焦点を外してから撮る。`fill()` は欄に焦点を残すので、そのまま撮ると
   * `:focus-visible` の 3px の輪（`--color-focus` = #005fcc）が画に写る。
   * 基準の承認済みモックは焦点の当たっていない静止画なので、輪が写ると
   * 「実装に青が混ざっている」ように読めてしまう。輪そのものはモックの
   * `outline:3px solid var(--focus)` どおりで、直すべきは撮り方の側である。
   */
  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  })
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${OUT_DIR}/${name}`, fullPage: true })
  captured.push(name)
  console.log(`  captured ${name}`)
}

/** 画面が意図した状態に来ていることを確かめてから撮る。 */
function visible(locator: Locator) {
  return locator.first().waitFor({ state: 'visible', timeout: 15_000 })
}

/* ------------------------------------------------------------------ *
 * 共通フィクスチャ
 * ------------------------------------------------------------------ */

const ginzaId = '11111111-1111-4111-8111-111111111111'
const marunouchiId = '22222222-2222-4222-8222-222222222222'
const nihonbashiId = '33333333-3333-4333-8333-333333333333'

function storeRow(id: string, name: string, slug: string, isActive = true) {
  return {
    id,
    organizationId: 'org-eyex',
    name,
    slug,
    isActive,
    createdAt: '2026-08-01T00:00:00.000Z',
  }
}

const ginza = storeRow(ginzaId, '銀座店', 'ginza')
const marunouchi = storeRow(marunouchiId, '丸の内店', 'marunouchi')
const nihonbashi = storeRow(nihonbashiId, '日本橋店', 'nihonbashi', false)
const stores = [ginza, marunouchi]

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

function jstToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

function dayLabel(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  return `${at.getUTCMonth() + 1}月${at.getUTCDate()}日（${WEEKDAYS[at.getUTCDay()]}）`
}

async function refreshRoute(page: Page) {
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ json: { token: 'staff-e2e' } }),
  )
  await page.route('**/api/staff/stores', (route) => route.fulfill({ json: stores }))
  await page.route('**/api/staff/store-switches', (route) =>
    route.fulfill({ status: 201, json: {} }),
  )
}

async function openHome(page: Page, storeName = '銀座店') {
  await page.goto(`${BASE_URL}/`)
  await visible(page.getByRole('button', { name: new RegExp(`EYEX予約\\s*${storeName}`) }))
  await visible(page.getByRole('navigation', { name: '副操作' }))
}

function secondary(page: Page) {
  return page.getByRole('navigation', { name: '副操作' })
}

/**
 * 設定と運用の面は、緑帯 1 本のバーのタブと、各面の左サイドを辿って開く
 * （operations-approved.html は 2 本目の帯を持たない）。業務画面のバーには
 * 設定 が無いので、いったんホームへ戻ってから辿る。
 */
/*
 * 設定・運用の面の行き先。緑帯のタブは廃止され、全画面共通の左サイドバー
 * （`navigation[name="画面の一覧"]`）1 本に集約された。ここは「呼び出し側が使う
 * 名前」→「サイドバーの行き先の名前」の対応表だけを持つ。
 */
const ADMIN_ROUTES: Record<string, string> = {
  店舗設定: '設定ガイド',
  共有端末: '共有端末',
  録音運用: '録音運用',
  注意事項権限: '注意事項',
  '顧客の統合・訂正': '顧客の統合・訂正',
  監査ログ: '監査ログ',
  分析: '分析',
  お知らせ: 'お知らせ',
}

async function openAdmin(page: Page, label: string) {
  const destination = ADMIN_ROUTES[label]
  if (destination === undefined) throw new Error(`${label} への経路が未定義`)
  await page.goto(`${BASE_URL}/`)
  await visible(page.getByRole('navigation', { name: '副操作' }))
  // ホームには柱が無い。緑帯の「設定」で設定ガイドへ入ると柱が現れる。
  await page.getByRole('button', { name: '設定', exact: true }).click()
  const sidebar = page.getByRole('navigation', { name: '画面の一覧' })
  await sidebar.getByRole('button', { name: destination, exact: true }).click()
}

/* ------------------------------------------------------------------ *
 * 1. ホームと電話・店頭予約（e2e/staff-booking.spec.ts のフィクスチャ）
 * ------------------------------------------------------------------ */

const examPurposeId = '33333333-3333-4333-8333-333333333333'
const adjustPurposeId = '44444444-4444-4444-8444-444444444444'
const hanakoId = '55555555-5555-4555-8555-555555555555'
const taroId = '66666666-6666-4666-8666-666666666666'

const bookingPurposes = [
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

function availabilitySettings(storeId: string, purposes: unknown[]) {
  return {
    storeId,
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
}

function slotsFor(storeId: string, date: string, times: string[]) {
  return {
    storeId,
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
/* 承認済みモック BOOK-CUSTOMER の 2 件目（同じ店舗の別候補）。 */
const taro = {
  id: taroId,
  name: '田中一郎',
  kana: 'タナカイチロウ',
  phone: '090-1234-9912',
  email: null,
  primaryStoreId: ginzaId,
  visitCount: 1,
}

/** モックの脇の列（現在の度数 / 対応時に確認 / 最新メモ）を埋める顧客記録。 */
const hanakoDetail = {
  customerId: hanakoId,
  currentPrescription: {
    measuredOn: '2026-05-18',
    storeId: ginzaId,
    storeName: '銀座店',
    recordedBy: '佐藤 美咲',
    rightSphere: '-2.25',
    leftSphere: '-2.00',
    pupillaryDistance: '62.0',
    addPower: null,
  },
  pastPrescriptions: [],
  latestNote: {
    recordedOn: '2026-05-18',
    storeId: ginzaId,
    storeName: '銀座店',
    recordedBy: '佐藤 美咲',
    body: 'PC作業用。鼻パッドは低め。',
  },
  ownedGlasses: [],
  attentionNotes: [
    {
      body: '度数変更の理由を段階的に説明する。',
      basis: '接客記録',
      recordedBy: '佐藤 美咲',
      recordedOn: '2026-02-10',
    },
  ],
  visitHistory: [],
}

async function mockBookingApi(
  page: Page,
  options: { offered?: string[]; customers?: unknown[] } = {},
) {
  const offered = options.offered ?? ['10:00', '10:30', '11:00', '11:30', '12:00']
  await refreshRoute(page)
  await page.route('**/api/staff/stores/*/availability/settings', (route) =>
    route.fulfill({ json: availabilitySettings(ginzaId, bookingPurposes) }),
  )
  await page.route('**/api/staff/stores/*/availability/slots*', (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({
      json: slotsFor(ginzaId, url.searchParams.get('date') ?? jstToday(), offered),
    })
  })
  // `*` は `/` を跨がないので、一覧と個別の 2 本を登録する。
  await page.route(`**/api/staff/stores/*/customers/${hanakoId}`, (route) =>
    route.fulfill({ json: hanakoDetail }),
  )
  await page.route('**/api/staff/stores/*/customers*', (route) =>
    route.fulfill({ json: options.customers ?? [] }),
  )
  await page.route('**/api/staff/stores/*/ledger*', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/staff/stores/*/reception-history*', (route) =>
    route.fulfill({ json: [] }),
  )
  await page.route('**/api/staff/stores/*/reservations', (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ json: [] })
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, string>
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
        purposeIds: (body as unknown as { purposeIds: string[] }).purposeIds,
        customer: { ...(body as unknown as { customer: object }).customer, email: null },
        recital: body.recital,
        reservationMemo: body.reservationMemo ?? null,
        handoffNote: body.handoffNote ?? null,
        version: 1,
        createdAt: `${body.date}T00:00:00.000Z`,
      },
    })
  })
}

async function captureBookingScreens(browser: Browser) {
  // HOME-DEFAULT / BOOK-TIME / BOOK-REPEAT
  {
    const page = await newPage(browser, IPAD)
    await mockBookingApi(page)
    await openHome(page)
    await shot(page, 'HOME-DEFAULT', 'default', 'ipad-landscape')

    await page.getByRole('button', { name: /新しい予約を取る/ }).click()
    await visible(page.getByRole('heading', { name: 'ご来店予定の日を伺えますか？' }))
    await page.getByRole('button', { name: dayLabel(jstToday()) }).click()
    await visible(page.getByRole('heading', { name: 'ご来店予定の時刻を伺えますか？' }))
    /* 希望時刻は `desiredTimes` が営業時間から間引いた候補だけ。11:00 は出ない。 */
    await page.getByRole('button', { name: '11:30', exact: true }).click()
    await visible(page.getByRole('heading', { name: '今回のご来店目的を伺えますか？' }))
    // 「時間」工程は選択済みの状態を残したいので、目的工程へ移る前に戻って撮る。
    await page.getByRole('button', { name: '戻る' }).click()
    await visible(page.getByRole('heading', { name: 'ご来店予定の時刻を伺えますか？' }))
    await shot(page, 'BOOK-TIME', 'selected', 'ipad-landscape')

    await page.getByRole('button', { name: '11:30', exact: true }).click()
    await page.getByRole('button', { name: /メガネを新しく作りたい/ }).click()
    await page.getByRole('button', { name: /かけ具合を調整したい/ }).click()
    await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
    await visible(page.getByRole('heading', { name: 'お電話番号を伺えますか？' }))
    await page.getByLabel('お電話番号').fill('09012345678')
    await page.getByRole('button', { name: '新しいお客様として登録する' }).click()
    await visible(page.getByLabel('お名前', { exact: true }))
    await page.getByLabel('お名前', { exact: true }).fill('田中花子')
    await page.getByLabel('フリガナ').fill('タナカハナコ')
    await page.getByLabel('予約メモ').fill('遠近両用を検討中')
    await page.getByLabel('店内引き継ぎ事項').fill('担当は鈴木を希望')
    await page.getByRole('button', { name: '復唱へ進む' }).click()
    await visible(page.getByRole('heading', { name: /次の内容を、お客様へそのままお伝えください/ }))
    await shot(page, 'BOOK-REPEAT', 'default', 'ipad-landscape')
    await page.context().close()
  }

  // BOOK-PURPOSE-CONFLICT: 希望した 13:30 が所要時間つき再検証で落ちる。
  {
    const page = await newPage(browser, IPAD)
    await mockBookingApi(page, { offered: ['10:00', '10:30', '11:30', '12:00'] })
    await openHome(page)
    await page.getByRole('button', { name: /新しい予約を取る/ }).click()
    await page.getByRole('button', { name: dayLabel(jstToday()) }).click()
    await page.getByRole('button', { name: '13:30', exact: true }).click()
    await page.getByRole('button', { name: /メガネを新しく作りたい/ }).click()
    await page.getByRole('button', { name: /かけ具合を調整したい/ }).click()
    await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
    await page.getByText('13:30は90分の受付ができません').waitFor({ state: 'visible' })
    await shot(page, 'BOOK-PURPOSE-CONFLICT', 'resource-conflict', 'ipad-landscape')
    await page.context().close()
  }

  // BOOK-CUSTOMER: 候補が複数出て 1 件を選んだ状態。
  {
    const page = await newPage(browser, IPAD)
    await mockBookingApi(page, { customers: [hanako, taro] })
    await openHome(page)
    await page.getByRole('button', { name: /新しい予約を取る/ }).click()
    await page.getByRole('button', { name: dayLabel(jstToday()) }).click()
    await page.getByRole('button', { name: '11:30', exact: true }).click()
    await page.getByRole('button', { name: /メガネを新しく作りたい/ }).click()
    await page.getByRole('button', { name: /かけ具合を調整したい/ }).click()
    await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
    await page.getByLabel('お電話番号').fill('０９０-1234')
    const options = page.getByRole('list', { name: '顧客候補' }).getByRole('button')
    await options.first().waitFor({ state: 'visible' })
    await options.nth(0).click()
    // 候補を選ぶと氏名・メモの面へ進むので、モックの状態（選択中の候補が
    // 見えている特定の面）へ戻ってから撮る。
    await page.getByRole('button', { name: '戻る' }).click()
    await visible(page.getByRole('heading', { name: 'お電話番号を伺えますか？' }))
    await shot(page, 'BOOK-CUSTOMER', 'multiple-selected', 'ipad-landscape')
    await page.context().close()
  }
}

/* ------------------------------------------------------------------ *
 * 2. 録音（e2e/staff-recording.spec.ts のフィクスチャ）
 * ------------------------------------------------------------------ */

const sessionId = '33333333-3333-4333-8333-333333333333'
const reservationId = '44444444-4444-4444-8444-444444444444'
const uploadingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const storedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const failedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const heldId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const pendingId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const deletedId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const discardedId = '99999999-9999-4999-8999-999999999999'
const bookingPurposeId = '77777777-7777-4777-8777-777777777777'
const createdReservationId = '12121212-1212-4121-8121-121212121212'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const BASE = Date.now()
const shifted = (ms: number) => new Date(BASE + ms).toISOString()

type Recording = Record<string, unknown> & { id: string; state: string }

function recordingRow(overrides: Partial<Recording> & Pick<Recording, 'id' | 'state'>): Recording {
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

const allRecordings: Recording[] = [
  recordingRow({ id: uploadingId, state: 'uploading', retentionUntil: null }),
  recordingRow({ id: storedId, state: 'stored' }),
  recordingRow({
    id: failedId,
    state: 'failed',
    retentionUntil: null,
    failureReason: 'アップロードがタイムアウトしました',
  }),
  recordingRow({
    id: heldId,
    state: 'held',
    retentionUntil: shifted(-2 * DAY),
    holdReason: '弁護士からの保全通知',
    heldBy: '本部 佐藤',
    heldAt: shifted(-1 * DAY),
  }),
  recordingRow({ id: pendingId, state: 'pending_deletion', retentionUntil: shifted(-1 * HOUR) }),
  recordingRow({
    id: deletedId,
    state: 'deleted',
    retentionUntil: shifted(-5 * DAY),
    deletedAt: shifted(-4 * DAY),
  }),
  recordingRow({
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

async function mockRecordingOpsApi(page: Page, permissions: string[], rows: Recording[]) {
  await refreshRoute(page)
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({ json: permissions }),
  )
  await page.route('**/api/staff/stores/*/ledger*', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/staff/stores/*/recordings*', (route) => {
    const state = new URL(route.request().url()).searchParams.get('state')
    return route.fulfill({
      json: state === null ? rows : rows.filter((row) => row.state === state),
    })
  })
  await page.route('**/api/staff/stores/*/recording-retention', (route) =>
    route.fulfill({ json: retentionSettings }),
  )
}

async function openRecordingOps(page: Page) {
  await openHome(page)
  await openAdmin(page, '録音運用')
  // 権限が無い店舗では画面ごと「権限がありません」に置き換わる
  // (`exception-states-approved.html#permission-denied`)。どちらかが出るまで待つ。
  await visible(
    page
      .getByRole('region', { name: '録音運用' })
      .or(page.getByRole('region', { name: '権限がありません' })),
  )
}

/** マイク権限と MediaRecorder をブラウザごと差し替える。 */
async function stubMicrophone(page: Page, decision: 'granted' | 'denied') {
  await page.addInitScript(
    ({ outcome }) => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => {
            if (outcome === 'denied') throw new DOMException('denied', 'NotAllowedError')
            return { getTracks: () => [{ stop: () => undefined }] }
          },
        },
      })
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
        start() {
          return undefined
        }
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

async function mockBookingRecordingApi(page: Page, options: { recordingPostStatus?: number } = {}) {
  await refreshRoute(page)
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({ json: ['store.read', 'reservation.read', 'recording.read'] }),
  )
  await page.route('**/api/staff/stores/*/ledger*', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/staff/stores/*/reception-history*', (route) =>
    route.fulfill({ json: [] }),
  )
  await page.route('**/api/staff/stores/*/customers*', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/staff/stores/*/availability/settings', (route) =>
    route.fulfill({
      json: availabilitySettings(ginzaId, [
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
      ]),
    }),
  )
  await page.route('**/api/staff/stores/*/availability/slots*', (route) =>
    route.fulfill({
      json: slotsFor(
        ginzaId,
        new URL(route.request().url()).searchParams.get('date') ?? jstToday(),
        ['10:00', '10:30', '11:00', '11:30'],
      ),
    }),
  )
  await page.route('**/api/staff/stores/*/recordings/*/audio', (route) =>
    route.fulfill({ json: recordingRow({ id: storedId, state: 'stored' }) }),
  )
  await page.route('**/api/staff/stores/*/recordings', (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ json: [] })
    if (options.recordingPostStatus !== undefined)
      return route.fulfill({
        status: options.recordingPostStatus,
        json: { error: 'storage_unavailable' },
      })
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>
    return route.fulfill({
      status: 201,
      json: recordingRow({
        id: storedId,
        state: 'stored',
        receptionSessionId: String(body.receptionSessionId),
        reservationId: (body.reservationId as string | null) ?? null,
      }),
    })
  })
  await page.route('**/api/staff/stores/*/reservations', (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ json: [] })
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

async function openBooking(page: Page) {
  await openHome(page)
  await page.getByRole('button', { name: /新しい予約を取る/ }).click()
  await visible(page.getByRole('heading', { name: 'ご来店予定の日を伺えますか？' }))
  return page.getByTestId('recording-state')
}

async function reachRecital(page: Page) {
  await page.getByRole('button', { name: dayLabel(jstToday()) }).click()
  /* 希望時刻は `desiredTimes` が間引いた候補だけ。11:00 は出ない。 */
  await page.getByRole('button', { name: '11:30', exact: true }).click()
  await page.getByRole('button', { name: /メガネを新しく作りたい/ }).click()
  await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
  // 顧客の工程は「電話で見つける」→「氏名を確かめる」の 2 面に分かれる。
  await page.getByRole('heading', { name: 'お電話番号を伺えますか？' }).waitFor()
  await page.getByRole('button', { name: '新しいお客様として登録する' }).click()
  await page.getByLabel('お名前', { exact: true }).fill('田中花子')
  await page.getByLabel('フリガナ').fill('タナカハナコ')
  await page.locator('#booking-phone').fill('090-1234-5678')
  await page.getByRole('button', { name: '復唱へ進む' }).click()
}

async function captureRecordingScreens(browser: Browser) {
  // EX-UPLOAD-FAILED: 予約は成立し、録音の保存だけが失敗した状態。
  {
    const page = await newPage(browser, IPAD)
    await stubMicrophone(page, 'granted')
    await mockBookingRecordingApi(page, { recordingPostStatus: 503 })
    const indicator = await openBooking(page)
    await indicator.filter({ hasText: '録音中' }).waitFor()
    await reachRecital(page)
    await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
    // 保存失敗は下部バーではなく全画面へ遷移する。
    await page
      .getByRole('heading', { name: '予約は成立しました' })
      .waitFor({ state: 'visible', timeout: 20_000 })
    await shot(page, 'EX-UPLOAD-FAILED', 'retry', 'ipad-landscape')
    await page.context().close()
  }

  // RECORDING-OPS: 5 区分・失敗・保全がひとつの一覧に並ぶ。
  {
    const page = await newPage(browser, IPAD)
    await mockRecordingOpsApi(
      page,
      ['store.read', 'reservation.read', 'recording.read', 'recording.manage'],
      allRecordings,
    )
    await openRecordingOps(page)
    await page.getByTestId(`recording-${failedId}`).waitFor({ state: 'visible' })
    await shot(page, 'RECORDING-OPS', 'failure-hold', 'ipad-landscape')
    await page.context().close()
  }

  // EX-403: 録音を扱う権限が無い店舗。
  {
    const page = await newPage(browser, IPAD)
    await mockRecordingOpsApi(page, ['store.read', 'reservation.read'], [])
    await openRecordingOps(page)
    await visible(page.getByRole('region', { name: '権限がありません' }))
    await shot(page, 'EX-403', 'default', 'ipad-landscape')
    await page.context().close()
  }
}

/* ------------------------------------------------------------------ *
 * 3. 台帳・来店受付・同時編集（e2e/staff-ledger.spec.ts のフィクスチャ）
 * ------------------------------------------------------------------ */

const LEDGER_NOW = '2026-09-01T05:30:00.000Z' // JST 14:30
const LEDGER_TODAY = '2026-09-01'
const webReservationId = 'aaaaaaaa-0000-4000-8000-000000000001'
const phoneReservationId = 'aaaaaaaa-0000-4000-8000-000000000002'
const walkinId = 'bbbbbbbb-0000-4000-8000-000000000001'
const ledgerStaffId = 'cccccccc-0000-4000-8000-000000000001'
const ledgerEquipmentId = 'dddddddd-0000-4000-8000-000000000001'
const ledgerCustomerId = 'eeeeeeee-0000-4000-8000-000000000001'

type LedgerRow = Record<string, unknown> & { id: string; version: number }

function ledgerBase(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: webReservationId,
    entryType: 'reservation',
    source: 'web',
    status: 'confirmed',
    startAt: '2026-09-01T01:00:00.000Z',
    endAt: '2026-09-01T02:00:00.000Z',
    customerName: '佐藤 陽子',
    customerId: ledgerCustomerId,
    progress: null,
    waitStartedAt: null,
    assignedStaffId: null,
    assignedEquipmentIds: [],
    nextGuidance: null,
    // 予約行は purposeNames 必須（台帳セルの「目的 · 予約元」表示のため）。
    purposeNames: ['視力測定'],
    warnings: [],
    version: 1,
    ...overrides,
  }
}

function phoneRow(): LedgerRow {
  return ledgerBase({
    id: phoneReservationId,
    source: 'staff',
    startAt: '2026-09-01T02:30:00.000Z',
    endAt: '2026-09-01T03:30:00.000Z',
    customerName: '鈴木 一郎',
    customerId: null,
    assignedStaffId: ledgerStaffId,
    assignedEquipmentIds: [ledgerEquipmentId],
    version: 3,
  })
}

function walkinRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  // ウォークイン行の契約には purposeNames が無い（strictObject なので余計なキーは弾かれる）。
  const { purposeNames: _reservationOnly, ...row } = ledgerBase({
    id: walkinId,
    entryType: 'walkin',
    source: 'walkin',
    status: 'active',
    startAt: '2026-09-01T05:00:00.000Z',
    endAt: '2026-09-01T06:00:00.000Z',
    customerName: 'ウォークイン 14:00',
    customerId: null,
    progress: 'waiting',
    waitStartedAt: '2026-09-01T05:00:00.000Z',
    ...overrides,
  })
  return row as LedgerRow
}

type LedgerState = {
  rows: LedgerRow[]
  conflictOn?: { path: string; currentVersion: number }
}

async function mockLedgerApi(page: Page, state: LedgerState) {
  await page.route('**/api/**', (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path === '/api/auth/refresh') return route.fulfill({ json: { token: 'e2e-access-token' } })
    if (path === '/api/staff/stores') return route.fulfill({ json: [ginza] })
    if (path === '/api/staff/store-switches') return route.fulfill({ status: 201, json: {} })
    if (path.endsWith('/ledger'))
      return route.fulfill({
        json: url.searchParams.get('date') === LEDGER_TODAY ? state.rows : [],
      })
    if (path.endsWith('/customers')) return route.fulfill({ json: [hanako] })
    if (path.endsWith('/reception-history')) return route.fulfill({ json: [] })
    if (path.endsWith('/availability/settings'))
      return route.fulfill({
        json: {
          ...availabilitySettings(ginzaId, bookingPurposes),
          staff: [
            {
              id: ledgerStaffId,
              name: '高橋 健',
              skills: ['refraction'],
              canBook: true,
              isActive: true,
            },
          ],
          equipment: [
            {
              id: ledgerEquipmentId,
              name: '測定機A',
              capacity: 1,
              isActive: true,
              availablePeriods: [],
            },
          ],
        },
      })
    if (state.conflictOn && path === state.conflictOn.path) {
      const currentVersion = state.conflictOn.currentVersion
      state.conflictOn = undefined
      return route.fulfill({ status: 409, json: { error: 'version_conflict', currentVersion } })
    }
    return route.fulfill({ json: { ok: true } })
  })
}

async function openLedger(page: Page) {
  await page.clock.setFixedTime(new Date(LEDGER_NOW))
  await openHome(page)
  await page.getByRole('button', { name: /^9月1日（.）の予約台帳/ }).click()
  await visible(page.getByRole('heading', { name: '銀座店の予約台帳' }))
}

async function captureLedgerScreens(browser: Browser) {
  // LEDGER-DAY / JOURNEY-DEFAULT
  {
    const page = await newPage(browser, IPAD)
    const state: LedgerState = {
      rows: [
        ledgerBase(),
        phoneRow(),
        walkinRow({
          warnings: [
            {
              code: 'long_wait',
              message: '30分以上お待ちです。担当者を割り当ててご案内してください。',
            },
            { code: 'staff_unassigned', message: '担当者が割り当てられていません。' },
          ],
        }),
      ],
    }
    await mockLedgerApi(page, state)
    await openLedger(page)
    await shot(page, 'LEDGER-DAY', 'walkin-now', 'ipad-landscape')

    /* 面の行き来は緑帯のタブではなく、全画面共通の左サイドバー 1 本に集約された。 */
    await page
      .getByRole('navigation', { name: '画面の一覧' })
      .getByRole('button', { name: '来店受付', exact: true })
      .click()
    await visible(page.getByRole('heading', { name: '銀座店の来店受付' }))
    await shot(page, 'JOURNEY-DEFAULT', 'default', 'ipad-landscape')
    await page.context().close()
  }

  // EX-CONFLICT: 別端末が先に更新した（版の衝突）。
  {
    const page = await newPage(browser, IPAD)
    const state: LedgerState = { rows: [walkinRow()] }
    await mockLedgerApi(page, state)
    await openLedger(page)
    state.conflictOn = {
      path: `/api/staff/stores/${ginzaId}/walkins/${walkinId}/progress`,
      currentVersion: 7,
    }
    state.rows = [walkinRow({ version: 7, nextGuidance: '他端末が更新しました' })]
    await page.getByRole('button', { name: /ウォークイン 14:00/ }).click()
    await page.getByRole('button', { name: '退店として記録する' }).click()
    await visible(page.getByRole('region', { name: '別の端末で先に更新されています' }))
    await shot(page, 'EX-CONFLICT', 'stale', 'ipad-landscape')
    await page.context().close()
  }
}

/* ------------------------------------------------------------------ *
 * 4. 予約検索・受付履歴（e2e/staff-search.spec.ts のフィクスチャ）
 * ------------------------------------------------------------------ */

const tanakaId = '44444444-4444-4444-8444-444444444444'

const tanakaReservation = {
  id: tanakaId,
  organizationId: 'org-1',
  storeId: ginzaId,
  reservationNumber: 'EY-0827-1100',
  source: 'staff',
  status: 'confirmed',
  startAt: '2026-08-27T02:00:00.000Z',
  endAt: '2026-08-27T03:00:00.000Z',
  purposeIds: [examPurposeId],
  customer: { name: '田中 花子', kana: 'タナカ ハナコ', phone: '090-1234-5678', email: null },
  recital: '8月27日11時にご来店ください。',
  reservationMemo: null,
  handoffNote: null,
  version: 3,
  createdAt: '2026-08-20T01:00:00.000Z',
}

const historyEvents = [
  {
    id: '55555555-5555-4555-8555-000000000101',
    occurredAt: '2026-08-27T05:26:00.000Z',
    source: 'walkin',
    action: 'walkin_created',
    entityType: 'walkin',
    entityId: '55555555-5555-4555-8555-000000000901',
    reservationId: null,
    customerName: null,
    customerPhone: null,
    reservationNumber: null,
    actorId: '山田',
    requiresAttention: false,
    recordingStatus: 'none',
  },
  {
    id: '55555555-5555-4555-8555-000000000102',
    occurredAt: '2026-08-27T05:18:00.000Z',
    source: 'staff',
    action: 'created',
    entityType: 'reservation',
    entityId: '55555555-5555-4555-8555-000000000902',
    reservationId: '55555555-5555-4555-8555-000000000902',
    customerName: '田中 花子',
    customerPhone: '090-1234-5678',
    reservationNumber: 'EY-0828-1142',
    actorId: '鈴木',
    requiresAttention: true,
    recordingStatus: 'none',
  },
  {
    id: '55555555-5555-4555-8555-000000000103',
    occurredAt: '2026-08-27T04:54:00.000Z',
    source: 'web',
    action: 'created',
    entityType: 'reservation',
    entityId: '55555555-5555-4555-8555-000000000903',
    reservationId: '55555555-5555-4555-8555-000000000903',
    customerName: '伊藤 健',
    customerPhone: '090-2222-3333',
    reservationNumber: 'EY-0829-1330',
    actorId: 'web',
    requiresAttention: false,
    recordingStatus: 'none',
  },
]

async function mockSearchApi(
  page: Page,
  options: { reservations?: unknown[]; history?: unknown[] } = {},
) {
  await page.route('**/api/**', (route: Route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/auth/refresh') return route.fulfill({ json: { token: 'e2e-token' } })
    if (url.pathname === '/api/staff/stores') return route.fulfill({ json: stores })
    if (url.pathname === `/api/staff/stores/${ginzaId}/reservations`)
      return route.fulfill({ json: options.reservations ?? [] })
    if (url.pathname === `/api/staff/stores/${ginzaId}/reception-history`)
      return route.fulfill({ json: options.history ?? [] })
    return route.fulfill({ json: [] })
  })
}

async function captureSearchScreens(browser: Browser) {
  // RES-SEARCH: 選択店舗固定の検索結果と詳細。
  {
    const page = await newPage(browser, IPAD)
    await mockSearchApi(page, { reservations: [tanakaReservation] })
    await openHome(page)
    await page.getByRole('button', { name: '予約を検索', exact: true }).click()
    await visible(page.getByRole('heading', { name: '予約を検索する' }))
    await page.getByLabel('氏名・電話番号・予約番号').fill('田中 花子')
    /* 検索ボタンは廃止され、Enter で走るようになった。 */
    await page.getByLabel('氏名・電話番号・予約番号').press('Enter')
    await page.getByRole('button', { name: /田中 花子 様/ }).click()
    await visible(page.getByRole('region', { name: '予約詳細' }))
    await shot(page, 'RES-SEARCH', 'store-fixed', 'ipad-landscape')
    await page.context().close()
  }

  // RECEPTION-HISTORY: 当日の受付イベントと詳細。
  {
    const page = await newPage(browser, IPAD)
    await mockSearchApi(page, { history: historyEvents })
    await openHome(page)
    await secondary(page).getByRole('button', { name: '受付履歴' }).click()
    await visible(page.getByRole('heading', { name: '受付履歴' }))
    await page
      .getByRole('region', { name: '受付履歴' })
      .getByRole('button', { name: /田中 花子/ })
      .click()
    await visible(page.getByRole('region', { name: '受付イベント詳細' }))
    await shot(page, 'RECEPTION-HISTORY', 'default', 'ipad-landscape')
    await page.context().close()
  }

  // EX-EMPTY: 検索結果 0 件。
  {
    const page = await newPage(browser, IPAD)
    await mockSearchApi(page, { reservations: [] })
    await openHome(page)
    await page.getByRole('button', { name: '予約を検索', exact: true }).click()
    await visible(page.getByRole('heading', { name: '予約を検索する' }))
    await page.getByLabel('氏名・電話番号・予約番号').fill('該当なし')
    await page.getByLabel('氏名・電話番号・予約番号').press('Enter')
    await page.waitForTimeout(500)
    await shot(page, 'EX-EMPTY', 'default', 'ipad-landscape')
    await page.context().close()
  }
}

/* ------------------------------------------------------------------ *
 * 5. 顧客台帳（e2e/staff-customer.spec.ts のフィクスチャ）
 * ------------------------------------------------------------------ */

const customerDetail = {
  customerId: hanakoId,
  currentPrescription: {
    measuredOn: '2026-06-01',
    storeId: ginzaId,
    storeName: '銀座店',
    recordedBy: '山田検査員',
    rightSphere: '-3.25',
    leftSphere: '-3.00',
    pupillaryDistance: '62.0',
    addPower: null,
  },
  pastPrescriptions: [
    {
      measuredOn: '2024-05-10',
      storeId: ginzaId,
      storeName: '銀座店',
      recordedBy: '佐藤検査員',
      rightSphere: '-2.75',
      leftSphere: '-2.50',
      pupillaryDistance: '61.5',
      addPower: null,
    },
    {
      measuredOn: '2023-04-02',
      storeId: marunouchiId,
      storeName: '丸の内店',
      recordedBy: '高橋検査員',
      rightSphere: '-2.25',
      leftSphere: '-2.00',
      pupillaryDistance: '61.0',
      addPower: '+1.00',
    },
  ],
  latestNote: {
    recordedOn: '2026-06-01',
    storeId: ginzaId,
    storeName: '銀座店',
    recordedBy: '鈴木',
    body: '遠近両用を検討中。手元の見え方を気にされている。',
  },
  ownedGlasses: [
    {
      label: 'メタルフレーム(黒)',
      purchasedOn: '2024-05-10',
      storeId: ginzaId,
      storeName: '銀座店',
      lensType: '単焦点',
    },
    {
      label: 'セルフレーム(べっ甲)',
      purchasedOn: '2023-04-02',
      storeId: marunouchiId,
      storeName: '丸の内店',
      lensType: '遠近両用',
    },
  ],
  attentionNotes: [
    {
      body: '鼻あての金属で肌が荒れやすい。',
      basis: '2025-02-10のご本人申告',
      recordedBy: '鈴木',
      recordedOn: '2025-02-12',
    },
  ],
  visitHistory: [
    { visitedOn: '2026-06-01', storeId: ginzaId, storeName: '銀座店', summary: '視力測定' },
    {
      visitedOn: '2025-12-20',
      storeId: marunouchiId,
      storeName: '丸の内店',
      summary: 'フィッティング調整',
    },
  ],
}

async function captureCustomerScreen(browser: Browser) {
  const page = await newPage(browser, IPAD)
  await refreshRoute(page)
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({
      json: [
        'store.read',
        'reservation.read',
        'customer.read',
        'customer.history',
        'attention.read',
      ],
    }),
  )
  await page.route('**/api/staff/stores/*/ledger*', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/staff/stores/*/customers**', (route) =>
    new URL(route.request().url()).pathname.endsWith('/customers')
      ? route.fulfill({ json: [hanako] })
      : route.fulfill({ json: customerDetail }),
  )
  await openHome(page)
  await secondary(page).getByRole('button', { name: '顧客台帳' }).click()
  /* 探す欄は左の脇柱（complementary）に移り、入力そのものが候補を出す。 */
  const list = page.getByRole('complementary', { name: 'お客様を探す' })
  await visible(list)
  await list.getByLabel('顧客を検索').fill('09012345678')
  // 候補 1 件は article のまとまりで、押せるのはその内側の button。
  const candidate = list.getByRole('article', { name: '田中花子' })
  await candidate.getByRole('button').click()
  await visible(page.getByRole('region', { name: '現在の度数' }))
  await shot(page, 'CUSTOMER-CURRENT', 'default', 'ipad-landscape')
  await page.context().close()
}

/* ------------------------------------------------------------------ *
 * 6. 店舗切替（e2e/staff-store-switch.spec.ts のフィクスチャ）
 * ------------------------------------------------------------------ */

const switchSlotTimes: Record<string, string[]> = {
  [ginzaId]: ['10:00', '10:30', '11:00'],
  [marunouchiId]: ['15:00', '15:30', '16:00'],
  [nihonbashiId]: ['18:00'],
}

async function mockStoreSwitchApi(page: Page) {
  await page.route('**/api/staff/stores/*/**', (route) => route.fulfill({ json: [] }))
  await refreshRoute(page)
  await page.route('**/api/staff/stores', (route) =>
    route.fulfill({ json: [ginza, marunouchi, nihonbashi] }),
  )
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({
      json: [
        'store.read',
        'reservation.read',
        'reservation.write',
        'customer.read',
        'customer.history',
        'attention.read',
      ],
    }),
  )
  await page.route('**/api/staff/stores/*/availability/settings', (route) => {
    const storeId = new URL(route.request().url()).pathname.split('/')[4] ?? ginzaId
    return route.fulfill({
      json: availabilitySettings(storeId, [
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
      ]),
    })
  })
  await page.route('**/api/staff/stores/*/availability/slots*', (route) => {
    const url = new URL(route.request().url())
    const storeId = url.pathname.split('/')[4] ?? ginzaId
    return route.fulfill({
      json: slotsFor(
        storeId,
        url.searchParams.get('date') ?? jstToday(),
        switchSlotTimes[storeId] ?? [],
      ),
    })
  })
  await page.route('**/api/staff/stores/*/ledger*', (route) => route.fulfill({ json: [] }))
}

async function captureStoreSwitchScreens(browser: Browser) {
  // STORE-SWITCH: 切替候補の一覧。
  {
    const page = await newPage(browser, IPAD)
    await mockStoreSwitchApi(page)
    await openHome(page)
    await page.locator('header button').first().click()
    await visible(page.getByRole('dialog', { name: '作業する店舗を切り替える' }))
    await shot(page, 'STORE-SWITCH', 'default', 'ipad-landscape')
    await page.context().close()
  }

  // EX-STORE-UNSAVED: 未保存入力があるまま切り替えようとしたときの確認。
  {
    const page = await newPage(browser, IPAD)
    await mockStoreSwitchApi(page)
    await openHome(page)
    await page.getByRole('button', { name: /新しい予約を取る/ }).click()
    await page.getByRole('group', { name: '来店予定日' }).getByRole('button').first().click()
    await visible(page.getByRole('heading', { name: 'ご来店予定の時刻を伺えますか？' }))
    await page.locator('header button').first().click()
    await page.getByRole('button', { name: /丸の内店/ }).click()
    await visible(page.getByRole('dialog'))
    await shot(page, 'EX-STORE-UNSAVED', 'confirm', 'ipad-landscape')
    await page.context().close()
  }
}

/* ------------------------------------------------------------------ *
 * 7. 店舗設定ガイド・共有端末一覧（e2e/staff-settings.spec.ts のフィクスチャ）
 * ------------------------------------------------------------------ */

const settingsStaffId = '55555555-5555-4555-8555-555555555555'
const settingsShiftId = '66666666-6666-4666-8666-666666666666'
const settingsEquipmentId = '77777777-7777-4777-8777-777777777777'
const settingsMaintenanceId = '88888888-8888-4888-8888-888888888888'
const terminalId = '99999999-9999-4999-8999-999999999999'

const SETTINGS_PERMISSIONS = ['store.read', 'reservation.read', 'settings.read', 'settings.manage']

function settingsFixture() {
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
      {
        id: settingsStaffId,
        name: '山田検査員',
        skills: ['眼鏡作製技能'],
        canBook: true,
        isActive: true,
      },
    ],
    shifts: [
      {
        id: settingsShiftId,
        staffId: settingsStaffId,
        date: '2026-08-27',
        startTime: '10:00',
        endTime: '19:00',
        breaks: [{ startTime: '13:00', endTime: '14:00' }],
      },
    ],
    equipment: [
      {
        id: settingsEquipmentId,
        name: '視力測定機',
        capacity: 2,
        isActive: true,
        availablePeriods: [{ startTime: '10:00', endTime: '19:00' }],
      },
    ],
    maintenance: [
      {
        id: settingsMaintenanceId,
        equipmentId: settingsEquipmentId,
        date: '2026-09-01',
        startTime: '09:00',
        endTime: '10:00',
        reason: '定期点検',
      },
    ],
  }
}

async function mockSettingsApi(page: Page) {
  await refreshRoute(page)
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({ json: SETTINGS_PERMISSIONS }),
  )
  await page.route('**/api/staff/stores/*/availability/settings', (route) =>
    route.fulfill({ json: settingsFixture() }),
  )
}

async function openSettings(page: Page) {
  await openHome(page)
  await openAdmin(page, '店舗設定')
  const screen = page.getByRole('region', { name: '店舗設定' })
  await screen.waitFor({ state: 'visible' })
  return screen
}

async function goToStep(page: Page, pattern: RegExp) {
  await page
    .getByRole('navigation', { name: '設定の工程' })
    .getByRole('button', { name: pattern })
    .click()
  await page.waitForTimeout(200)
}

/* 入力欄は「編集」を押した先にある。読み取りカードが既定の面になった。 */
async function startEditing(screen: Locator) {
  await screen.getByRole('button', { name: '編集', exact: true }).click()
}

async function captureSettingsScreens(browser: Browser) {
  {
    const page = await newPage(browser, IPAD)
    await mockSettingsApi(page)
    const screen = await openSettings(page)
    // 各工程の画は「編集」を開いた下書きの姿。読み取りカードのままでは撮らない。
    await startEditing(screen)
    await visible(page.getByRole('region', { name: '営業時間の編集' }))
    await shot(page, 'SETTINGS-STORE-HOURS', 'draft', 'ipad-landscape')

    await goToStep(page, /^工程2 来店目的/)
    await startEditing(screen)
    await visible(page.getByRole('region', { name: 'Web予約プレビュー' }))
    await shot(page, 'SETTINGS-PURPOSES', 'draft', 'ipad-landscape')

    await goToStep(page, /^工程3 スタッフと技能/)
    await startEditing(screen)
    await visible(page.getByRole('region', { name: 'スタッフと技能の編集' }))
    await shot(page, 'SETTINGS-STAFF-SKILLS', 'impact', 'ipad-landscape')

    await goToStep(page, /^工程4 設備と点検/)
    await startEditing(screen)
    await visible(page.getByRole('region', { name: '設備の編集' }))
    await shot(page, 'SETTINGS-EQUIPMENT', 'maintenance', 'ipad-landscape')

    await goToStep(page, /^工程5 Web予約/)
    await startEditing(screen)
    await visible(page.getByRole('region', { name: 'Web予約設定' }))
    await shot(page, 'SETTINGS-WEB', 'scheduled', 'ipad-landscape')
    await page.context().close()
  }

  // SETTINGS-SP: SP 幅の固定ステッパー。
  {
    const page = await newPage(browser, SP)
    await mockSettingsApi(page)
    await openSettings(page)
    await visible(page.getByRole('navigation', { name: '設定の工程' }))
    await shot(page, 'SETTINGS-SP', 'default', 'sp')
    await page.context().close()
  }

  // DEVICE-LIST: 共有 iPad の一覧。
  {
    const page = await newPage(browser, IPAD)
    await refreshRoute(page)
    await page.route('**/api/staff/stores/*/permissions', (route) =>
      route.fulfill({ json: SETTINGS_PERMISSIONS }),
    )
    await page.route('**/api/staff/stores/*/shared-terminals', (route) =>
      route.fulfill({
        json: [
          {
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
          },
        ],
      }),
    )
    await openHome(page)
    await openAdmin(page, '共有端末')
    await visible(page.getByRole('heading', { name: '共有iPad', level: 1 }))
    await shot(page, 'DEVICE-LIST', 'default', 'ipad-landscape')
    await page.context().close()
  }
}

/* ------------------------------------------------------------------ *
 * 8. 影響確認と公開（e2e/staff-settings-publication.spec.ts のフィクスチャ）
 * ------------------------------------------------------------------ */

const draftId = '00000000-0000-4000-8000-0000000000d1'
const publicationId = '00000000-0000-4000-8000-0000000000f1'
const versionId = '00000000-0000-4000-8000-0000000000e1'
const pastVersionId = '00000000-0000-4000-8000-0000000000e2'
const conflictAId = '00000000-0000-4000-8000-0000000000a1'
const conflictBId = '00000000-0000-4000-8000-0000000000a2'
const conflictCId = '00000000-0000-4000-8000-0000000000a3'

const publicationSettings = {
  storeId: ginzaId,
  version: 3,
  receptionStatus: 'open',
  businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
  exceptions: [{ date: '2026-09-23', mode: 'closed', periods: [], reason: '棚卸し' }],
  purposes: [],
  staff: [],
  shifts: [],
  equipment: [],
  maintenance: [],
}

function draftFixture() {
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
    settings: publicationSettings,
  }
}

function impactFixture(blocked: boolean) {
  const items = [
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
  ]
  return {
    draftId,
    storeId: ginzaId,
    evaluatedAt: '2026-08-26T09:06:00.000Z',
    blockingCount: blocked ? 3 : 0,
    warningCount: blocked ? 2 : 0,
    canPublish: !blocked,
    ledgerEntriesAffected: 18,
    publicSlots: { date: '2026-08-27', publishedCount: 42, draftCount: 38 },
    items: blocked ? items : [items[6]],
  }
}

function publicationFixture(partialFailure: boolean) {
  return {
    id: publicationId,
    versionId,
    draftId,
    status: partialFailure ? 'partially_failed' : 'completed',
    scheduledForJst: null,
    scheduledAt: null,
    executedAt: '2026-08-26T10:30:00.000Z',
    appliedCount: 1,
    failedCount: partialFailure ? 1 : 0,
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
        status: partialFailure ? 'failed' : 'applied',
        appliedVersion: partialFailure ? null : 4,
        failureReason: partialFailure ? '公開先の設定が競合しました' : null,
        appliedAt: partialFailure ? null : '2026-08-26T10:30:00.000Z',
      },
    ],
  }
}

const versionSummary = {
  versionId: pastVersionId,
  storeId: ginzaId,
  version: 3,
  origin: 'store_override',
  publishedAt: '2026-08-20T09:00:00.000Z',
  publishedBy: '佐藤 美咲',
  changedFields: ['receptionStatus', 'purposes'],
}

async function mockPublicationApi(page: Page, blocked: boolean, partialFailure = false) {
  await refreshRoute(page)
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({ json: SETTINGS_PERMISSIONS }),
  )
  await page.route('**/api/staff/stores/*/availability/settings', (route) =>
    route.fulfill({ json: publicationSettings }),
  )
  await page.route('**/availability/draft', (route) => route.fulfill({ json: draftFixture() }))
  await page.route('**/availability/draft/impact', (route) =>
    route.fulfill({ json: impactFixture(blocked) }),
  )
  await page.route('**/availability/publications', (route) =>
    route.fulfill({ status: 201, json: publicationFixture(partialFailure) }),
  )
  await page.route('**/availability/publications/*', (route) =>
    route.fulfill({ json: publicationFixture(partialFailure) }),
  )
  await page.route('**/availability/versions', (route) => route.fulfill({ json: [versionSummary] }))
  await page.route('**/availability/override', (route) =>
    route.fulfill({
      json: {
        storeId: ginzaId,
        origin: 'store_override',
        chainVersion: 7,
        overriddenFields: ['businessHours', 'purposes'],
      },
    }),
  )
}

async function openImpactStep(page: Page) {
  await openHome(page)
  await openAdmin(page, '店舗設定')
  await visible(page.getByRole('region', { name: '店舗設定' }))
  await goToStep(page, /^工程6 影響確認と公開/)
  /* 第6工程は自分の見出しを持つだけで、区画名はガイド全体の「店舗設定」のまま。 */
  const region = page.getByRole('region', { name: '店舗設定' })
  await region.getByRole('heading', { name: '影響を確認して公開' }).waitFor({ state: 'visible' })
  return region
}

async function capturePublicationScreens(browser: Browser) {
  // SETTINGS-IMPACT: 未解消の競合があり公開できない状態。
  {
    const page = await newPage(browser, IPAD)
    await mockPublicationApi(page, true)
    const region = await openImpactStep(page)
    await region.getByRole('region', { name: '影響確認' }).waitFor({ state: 'visible' })
    await shot(page, 'SETTINGS-IMPACT', 'blocked', 'ipad-landscape')
    await page.context().close()
  }

  // SETTINGS-RESULT: 公開後、1 店舗だけ失敗した結果。
  {
    const page = await newPage(browser, IPAD)
    await mockPublicationApi(page, false, true)
    const region = await openImpactStep(page)
    await region.getByRole('button', { name: '公開する', exact: true }).click()
    await region.getByRole('region', { name: '公開結果' }).waitFor({ state: 'visible' })
    await shot(page, 'SETTINGS-RESULT', 'partial-failure', 'ipad-landscape')
    await page.context().close()
  }
}

/* ------------------------------------------------------------------ *
 * 9. 注意事項と監査（e2e/staff-attention.spec.ts のフィクスチャ）
 * ------------------------------------------------------------------ */

const noteCustomerId = '88888888-8888-4888-8888-888888888888'
const publishedNoteId = '20000000-0000-4000-8000-000000000001'
const pendingNoteId = '20000000-0000-4000-8000-000000000002'

const attentionSettings = {
  storeId: ginzaId,
  reviewMode: 'review_required',
  sharingScope: 'permitted_stores',
  storeOverrideAllowed: true,
  origin: 'organization',
  capabilities: [
    { capability: 'read', minimumRole: 'staff', origin: 'organization' },
    { capability: 'write', minimumRole: 'staff', origin: 'organization' },
    { capability: 'publish', minimumRole: 'store_manager', origin: 'organization' },
    { capability: 'revise', minimumRole: 'store_manager', origin: 'store' },
    { capability: 'hide', minimumRole: 'store_manager', origin: 'organization' },
  ],
  guidance: {
    record: ['発生した事実', '発生日時', '根拠', '推奨対応'],
    avoid: ['人格評価', '憶測', '差別につながる属性'],
  },
}

function auditEvent(overrides: Record<string, unknown> = {}) {
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

function attentionNote(overrides: Record<string, unknown>) {
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

async function captureAttentionScreens(browser: Browser) {
  // ATTENTION-PERMISSIONS / AUDIT-DETAIL
  {
    const page = await newPage(browser, IPAD)
    await refreshRoute(page)
    await page.route('**/api/staff/stores/*/permissions', (route) =>
      route.fulfill({
        json: [
          'store.read',
          'reservation.read',
          'customer.read',
          'attention.read',
          'attention.write',
          'attention.publish',
          'settings.read',
          'settings.manage',
          'audit.read',
        ],
      }),
    )
    await page.route('**/api/staff/stores/*/ledger*', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/staff/stores/*/attention-settings', (route) =>
      route.fulfill({ json: attentionSettings }),
    )
    await page.route('**/api/staff/stores/*/audit-events*', (route) =>
      route.fulfill({ json: auditEvents }),
    )

    await openHome(page)
    await openAdmin(page, '注意事項権限')
    await visible(page.getByRole('heading', { name: '注意事項の権限', level: 1 }))
    await shot(page, 'ATTENTION-PERMISSIONS', 'default', 'ipad-landscape')

    await openHome(page)
    await openAdmin(page, '監査ログ')
    /* 監査は「直近 1 件の詳細」が既定の姿。一覧はそこから開く同じ面の別の姿。 */
    await visible(page.getByRole('heading', { name: '監査イベント詳細' }))
    await page.getByRole('button', { name: '監査を検索', exact: true }).click()
    await page.getByRole('button', { name: '監査を検索する' }).click()
    await page
      .getByRole('table', { name: '監査イベント' })
      .getByRole('button', { name: '詳細' })
      .first()
      .click()
    await visible(page.getByRole('region', { name: '監査イベント詳細' }))
    await shot(page, 'AUDIT-DETAIL', 'default', 'ipad-landscape')
    await page.context().close()
  }

  // ATTENTION-REVIEW: 確認待ちと公開済みが並ぶ権限者の画面。
  {
    const page = await newPage(browser, IPAD)
    await refreshRoute(page)
    await page.route('**/api/staff/stores/*/permissions', (route) =>
      route.fulfill({
        json: [
          'store.read',
          'reservation.read',
          'customer.read',
          'attention.read',
          'attention.write',
          'attention.publish',
          'attention.revise',
          'attention.hide',
        ],
      }),
    )
    await page.route('**/api/staff/stores/*/ledger*', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/staff/stores/*/attention-settings', (route) =>
      route.fulfill({ json: attentionSettings }),
    )
    await page.route('**/api/staff/stores/*/customers**', (route) =>
      new URL(route.request().url()).pathname.endsWith('/customers')
        ? route.fulfill({
            json: [
              {
                id: noteCustomerId,
                name: '田中花子',
                kana: 'タナカハナコ',
                phone: '090-1234-5678',
                email: null,
                primaryStoreId: ginzaId,
                visitCount: 4,
              },
            ],
          })
        : route.fulfill({
            json: {
              customerId: noteCustomerId,
              currentPrescription: null,
              pastPrescriptions: [],
              latestNote: null,
              ownedGlasses: [],
              attentionNotes: [],
              visitHistory: [],
            },
          }),
    )
    await page.route('**/api/staff/stores/*/customers/*/attention-notes', (route) =>
      route.fulfill({
        json: [
          attentionNote({
            id: '21000000-0000-4000-8000-000000000001',
            noteId: publishedNoteId,
            status: 'published',
            publishedAt: '2026-02-12T02:00:00.000Z',
          }),
          attentionNote({
            id: '21000000-0000-4000-8000-000000000002',
            noteId: pendingNoteId,
            status: 'pending_review',
            body: '来店時に強い日差しで頭痛を訴えられた。',
            occurredAt: '2026-08-20T05:30:00.000Z',
            basis: '2026-08-20の来店時のご申告',
            recommendedAction: '調光レンズを案内する',
          }),
        ],
      }),
    )

    await openHome(page)
    await secondary(page).getByRole('button', { name: '顧客台帳' }).click()
    /* 探す列は見出しではなく列自身が名乗る。検索欄は 1 本で、Enter で候補を出す。 */
    const search = page.getByRole('complementary', { name: 'お客様を探す' })
    await visible(search)
    await search.getByLabel('顧客を検索').fill('09012345678')
    await search.getByLabel('顧客を検索').press('Enter')
    await search.getByRole('article', { name: '田中花子' }).getByRole('button').click()
    await page.getByRole('button', { name: '注意事項を確認・登録する' }).click()
    await visible(page.getByRole('heading', { name: '注意事項を確認', exact: true }))
    await shot(page, 'ATTENTION-REVIEW', 'pending', 'ipad-landscape')
    await page.context().close()
  }
}

/* ------------------------------------------------------------------ *
 * 10. 共有 iPad（e2e/staff-shared-terminal.spec.ts のフィクスチャ）
 * ------------------------------------------------------------------ */

const sharedTerminalId = '22222222-2222-4222-8222-222222222222'
const DEVICE_TOKEN = 'eyex-shared-terminal-device-token-0123456789ab'
const GRANT_TOKEN = 'eyex-shared-terminal-reauth-grant-0123456789ab'
const sharedReservationId = '66666666-6666-4666-8666-666666666666'
const sharedPurposeId = '77777777-7777-4777-8777-777777777777'

function sharedLedger(date: string) {
  return [
    {
      id: sharedReservationId,
      entryType: 'reservation',
      source: 'staff',
      status: 'confirmed',
      startAt: `${date}T01:00:00.000Z`,
      endAt: `${date}T02:00:00.000Z`,
      customerName: '銀座太郎',
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

async function mockSharedTerminalApi(page: Page, rows: Recording[]) {
  await page.route('**/api/staff/stores/*/**', (route) => route.fulfill({ json: [] }))
  await refreshRoute(page)
  await page.route('**/api/staff/stores', (route) => route.fulfill({ json: [ginza] }))
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({
      json: [
        'store.read',
        'reservation.read',
        'reservation.write',
        'customer.read',
        'recording.read',
        'recording.manage',
      ],
    }),
  )
  await page.route('**/api/staff/stores/*/availability/settings', (route) =>
    route.fulfill({
      json: availabilitySettings(ginzaId, [
        {
          id: sharedPurposeId,
          staffName: '視力測定',
          customerLabel: 'メガネを新しく作りたい',
          durationMinutes: 60,
          slotIntervalMinutes: 30,
          isPublic: true,
          requiredSkills: [],
          requiredEquipment: [],
          maxConcurrent: 2,
        },
      ]),
    }),
  )
  await page.route('**/api/staff/stores/*/ledger*', (route) =>
    route.fulfill({
      json: sharedLedger(new URL(route.request().url()).searchParams.get('date') ?? jstToday()),
    }),
  )
  await page.route('**/api/staff/stores/*/recording-retention', (route) =>
    route.fulfill({ json: retentionSettings }),
  )
  await page.route('**/api/staff/stores/*/recordings*', (route) => route.fulfill({ json: rows }))
  await page.route('**/api/shared-terminals/*/session', (route) =>
    route.fulfill({
      json: {
        id: sharedTerminalId,
        organizationId: 'org-eyex',
        storeId: ginzaId,
        name: '受付カウンターiPad',
        status: 'active',
        idleTimeoutSeconds: 600,
        expiresAt: '2027-08-27T00:00:00.000Z',
        lastSeenAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        revokedAt: null,
      },
    }),
  )
  await page.route('**/api/shared-terminals/*/reauthenticate', (route) =>
    route.fulfill({
      status: 201,
      json: { token: GRANT_TOKEN, expiresAt: '2026-08-27T03:05:00.000Z' },
    }),
  )
  await page.route('**/api/shared-terminals/*/reauthentication', (route) =>
    route.fulfill({ status: 200, json: {} }),
  )
}

async function openSharedTerminal(page: Page) {
  await page.goto(`${BASE_URL}/terminal/${sharedTerminalId}/${DEVICE_TOKEN}`)
  await visible(page.getByRole('navigation', { name: '副操作' }))
}

async function captureSharedTerminalScreens(browser: Browser) {
  // EX-SHARED-LOCK: 画面非表示で顧客情報を隠した状態。
  {
    const page = await newPage(browser, IPAD)
    await page.clock.install()
    await mockSharedTerminalApi(page, [])
    await openSharedTerminal(page)
    await secondary(page).getByRole('button', { name: '予約台帳' }).click()
    await visible(page.getByRole('heading', { name: '銀座店の予約台帳' }))
    await page.evaluate(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await visible(page.getByRole('heading', { name: '顧客情報を隠しました' }))
    await shot(page, 'EX-SHARED-LOCK', 'masked', 'ipad-landscape')
    await page.context().close()
  }

  // REAUTH: 共有端末で管理操作を始めたときの個人再認証。
  {
    const page = await newPage(browser, IPAD)
    await page.clock.install()
    await mockSharedTerminalApi(page, [recordingRow({ id: storedId, state: 'stored' })])
    await openSharedTerminal(page)
    // 共有端末セッションは URL に紐づく。`openAdmin` は一度ホームへ goto するので
    // ここでは使わない（goto するとこの端末の共有セッションが切れてしまう）。
    await page.getByRole('button', { name: '設定', exact: true }).click()
    await page
      .getByRole('navigation', { name: '画面の一覧' })
      .getByRole('button', { name: '録音運用', exact: true })
      .click()
    const screen = page.getByRole('region', { name: '録音運用' })
    await screen.first().waitFor({ state: 'visible' })
    await screen.getByRole('button', { name: '保全する' }).first().click()
    await visible(page.getByRole('dialog', { name: '管理者として確認してください' }))
    await shot(page, 'REAUTH', 'manager-pin', 'ipad-landscape')
    await page.context().close()
  }

  // EX-SESSION-REVOKED: 遠隔失効された端末。
  {
    const page = await newPage(browser, IPAD)
    await page.route('**/api/**', (route: Route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/auth/refresh')
        return route.fulfill({ status: 401, json: { error: 'unauthenticated' } })
      if (url.pathname.endsWith('/session'))
        return route.fulfill({ status: 401, json: { error: 'terminal_revoked' } })
      return route.fulfill({ json: [] })
    })
    await page.goto(`${BASE_URL}/terminal/${sharedTerminalId}/${DEVICE_TOKEN}`)
    await visible(page.getByRole('heading', { name: 'この端末の利用は停止されています' }))
    await shot(page, 'EX-SESSION-REVOKED', 'default', 'ipad-landscape')
    await page.context().close()
  }
}

/* ------------------------------------------------------------------ *
 * 11. 運用分析（e2e/staff-analytics.spec.ts のフィクスチャ）
 * ------------------------------------------------------------------ */

const ANALYTICS_PERIOD = {
  granularity: 'day',
  startDate: '2026-08-27',
  endDate: '2026-08-27',
  startAt: '2026-08-27T00:00:00.000Z',
  endAt: '2026-08-27T15:00:00.000Z',
}
const ANALYTICS_PREVIOUS = {
  granularity: 'day',
  startDate: '2026-08-26',
  endDate: '2026-08-26',
  startAt: '2026-08-26T00:00:00.000Z',
  endAt: '2026-08-26T15:00:00.000Z',
}

function metric(
  name: string,
  label: string,
  definition: string,
  value: number,
  previousValue: number,
  target: number | null,
  targetDifference: number | null,
  exceedsTarget = false,
) {
  return {
    metric: name,
    label,
    definition,
    unit: 'count',
    value,
    previousValue,
    difference: value - previousValue,
    target,
    targetDifference,
    exceedsTarget,
    suppressed: false,
    suppressionReason: null,
  }
}

function breakdown(dimension: string, items: { key: string; label: string; value: number }[]) {
  return {
    dimension,
    metric: 'reservations',
    suppressed: false,
    suppressionReason: null,
    items: items.map((item) => ({ ...item, suppressed: false })),
  }
}

const analyticsReport = {
  storeId: ginzaId,
  storeName: '銀座店',
  timezone: 'Asia/Tokyo',
  period: ANALYTICS_PERIOD,
  previousPeriod: ANALYTICS_PREVIOUS,
  lastUpdatedAt: '2026-08-27T05:30:00.000Z',
  totalCount: 214,
  smallSampleThreshold: 5,
  status: 'ok',
  reason: null,
  nextAction: null,
  metrics: [
    metric('reservations', '予約', '対象期間に開始予定だった予約の件数。', 128, 96, null, null),
    metric('visits', '来店', '受付が完了した来店の件数。', 120, 90, 110, 10),
    metric('cancellations', '取消', '来店前に取り消された予約の件数。', 8, 6, null, null),
    metric(
      'no_shows',
      '無断キャンセル',
      '来店予定日を過ぎても受付されなかった予約の件数。',
      14,
      9,
      8,
      6,
      true,
    ),
  ],
  breakdowns: [
    breakdown('purpose', [
      { key: 'p1', label: '視力測定', value: 60 },
      { key: 'p2', label: '受け取り', value: 30 },
    ]),
    breakdown('source', [
      { key: 'web', label: 'Web予約', value: 80 },
      { key: 'staff', label: '店頭・電話', value: 48 },
    ]),
    breakdown('hour', [
      { key: '10', label: '10時台', value: 40 },
      { key: '14', label: '14時台', value: 88 },
    ]),
    breakdown('staff', [
      { key: 's1', label: '山田', value: 70 },
      { key: 's2', label: '佐藤', value: 58 },
    ]),
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
      { stage: 'started', label: '開始', count: 100, droppedFromPrevious: null, suppressed: false },
      {
        stage: 'slot_selected',
        label: '枠選択',
        count: 70,
        droppedFromPrevious: 30,
        suppressed: false,
      },
      { stage: 'confirmed', label: '確認', count: 60, droppedFromPrevious: 10, suppressed: false },
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
}

async function captureAnalyticsScreen(browser: Browser) {
  const page = await newPage(browser, IPAD)
  await page.route('**/api/**', (route) => route.fulfill({ json: [] }))
  await refreshRoute(page)
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({
      json: ['store.read', 'reservation.read', 'customer.read', 'analytics.read'],
    }),
  )
  await page.route('**/api/staff/stores/*/analytics*', (route) =>
    route.fulfill({ json: analyticsReport }),
  )
  await openHome(page)
  await openAdmin(page, '分析')
  await visible(page.getByRole('heading', { name: '店舗運用の分析' }))
  await page.getByLabel('対象日').fill('2026-08-27')
  await page.getByText('対象件数 214件').waitFor({ state: 'visible' })
  await shot(page, 'ANALYTICS', 'default', 'ipad-landscape')
  await page.context().close()
}

/* ------------------------------------------------------------------ *
 * 12. 顧客向け Web 予約（e2e/web-booking.spec.ts のフィクスチャ）
 * ------------------------------------------------------------------ */

const webPurposeId = '00000000-0000-4000-8000-000000000001'
const webReservationRecordId = '00000000-0000-4000-8000-000000000002'
const webToken = 'a'.repeat(32)

const webStore = {
  slug: 'ginza',
  name: '銀座店',
  contactPhone: '03-0000-0000',
  region: '東京都',
  nearestStation: '銀座駅',
}

const webStoreDetail = {
  ...webStore,
  accessText: '銀座駅 A3出口から徒歩2分',
  notice: 'ご来店前に確認してください。',
  businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
  purposes: [{ id: webPurposeId, label: 'メガネを新しく作りたい', durationMinutes: 60 }],
}

const webSlots = {
  date: '2026-09-01',
  timezone: 'Asia/Tokyo',
  durationMinutes: 60,
  intervalMinutes: 30,
  slots: [
    {
      date: '2026-09-01',
      startTime: '10:00',
      endTime: '11:00',
      startAt: '2026-09-01T01:00:00.000Z',
      endAt: '2026-09-01T02:00:00.000Z',
    },
  ],
}

async function mockPublicApi(page: Page, booking: 'success' | 'unknown') {
  await page.route('**/api/public/stores', (route) => route.fulfill({ json: [webStore] }))
  await page.route('**/api/public/stores/ginza/slots?*', (route) =>
    route.fulfill({ json: webSlots }),
  )
  await page.route('**/api/public/stores/ginza', (route) => route.fulfill({ json: webStoreDetail }))
  await page.route('**/api/public/stores/ginza/reservations', (route) => {
    if (booking === 'unknown') return route.abort('failed')
    return route.fulfill({
      status: 201,
      json: { reservationNumber: 'EY-0001', managementCode: 'ABCD-1234', emailStatus: 'sent' },
    })
  })
  await page.route('**/api/public/reservations/status?*', (route) =>
    route.fulfill({ json: { status: 'confirmed' } }),
  )
  await page.route('**/api/public/reservations/verify', (route) =>
    route.fulfill({
      status: 201,
      json: {
        reservationId: webReservationRecordId,
        verificationToken: webToken,
        expiresAt: '2026-09-01T00:15:00.000Z',
        version: 1,
        startAt: '2026-09-01T01:00:00.000Z',
        purposeIds: [webPurposeId],
        storeSlug: 'ginza',
      },
    }),
  )
  await page.route(`**/api/public/reservations/${webReservationRecordId}`, (route) =>
    route.fulfill({
      json: {
        status: 'confirmed',
        version: 2,
        startAt: '2026-09-01T02:00:00.000Z',
        endAt: '2026-09-01T03:00:00.000Z',
        purposeIds: [webPurposeId],
      },
    }),
  )
}

async function captureWebScreens(browser: Browser) {
  {
    const page = await newPage(browser, SP)
    await mockPublicApi(page, 'success')
    await page.goto(`${BASE_URL}/book`)
    await visible(page.getByRole('heading', { name: '予約する店舗を探す' }))
    await page.getByLabel('店舗を検索').fill('銀座')
    await shot(page, 'WEB-STORE-SEARCH', 'default', 'sp')

    await page.getByRole('button', { name: /銀座店.*店舗情報を見る/ }).click()
    await page.getByRole('button', { name: '銀座店で予約を始める' }).waitFor({ state: 'visible' })
    await shot(page, 'WEB-STORE-DETAIL', 'default', 'sp')

    await page.getByRole('button', { name: '銀座店で予約を始める' }).click()
    await page
      .getByRole('button', { name: /メガネを新しく作りたい.*約60分/ })
      .waitFor({ state: 'visible' })
    await page.getByRole('button', { name: /メガネを新しく作りたい.*約60分/ }).click()
    await shot(page, 'WEB-PURPOSE', 'selected', 'sp')

    await page.getByRole('button', { name: '日時へ進む' }).click()
    await page.getByLabel('ご希望の日').fill('2026-09-01')
    /* 枠の名前は曜日込み（`japaneseSlotLabel`）。 */
    await page.getByRole('button', { name: '9月1日（火）10:00' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: '9月1日（火）10:00' }).click()
    await shot(page, 'WEB-DATETIME', 'selected', 'sp')

    await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
    await page.getByLabel('お名前', { exact: true }).fill('田中花子')
    await page.getByLabel('お名前（かな）').fill('タナカハナコ')
    await page.getByLabel('電話番号').fill('09012345678')
    await page.getByLabel('メールアドレス').fill('hanako@example.test')
    await shot(page, 'WEB-CUSTOMER', 'filled', 'sp')

    await page.getByRole('button', { name: '確認へ進む' }).click()
    await page.getByText('ご来店前に確認してください。').waitFor({ state: 'visible' })
    await shot(page, 'WEB-CONFIRM', 'default', 'sp')

    await page.getByRole('button', { name: 'この内容で予約する' }).click()
    await visible(page.getByRole('heading', { name: '予約を承りました' }))
    await shot(page, 'WEB-COMPLETE', 'default', 'sp')

    await page.getByRole('button', { name: '予約を変更・取り消す' }).click()
    await page.getByLabel('会社発行の管理コード').waitFor({ state: 'visible' })
    await page.getByLabel('会社発行の管理コード').fill('ABCD-1234')
    await shot(page, 'WEB-IDENTITY', 'code', 'sp')
    await page.context().close()
  }

  // WEB-UNKNOWN: 応答が失われ、成立を照会している状態。
  {
    const page = await newPage(browser, SP)
    await mockPublicApi(page, 'unknown')
    await page.goto(`${BASE_URL}/book`)
    await visible(page.getByRole('heading', { name: '予約する店舗を探す' }))
    await page.getByRole('button', { name: /銀座店.*店舗情報を見る/ }).click()
    await page.getByRole('button', { name: '銀座店で予約を始める' }).click()
    await page.getByRole('button', { name: /メガネを新しく作りたい.*約60分/ }).click()
    await page.getByRole('button', { name: '日時へ進む' }).click()
    await page.getByLabel('ご希望の日').fill('2026-09-01')
    await page.getByRole('button', { name: '9月1日（火）10:00' }).click()
    await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
    await page.getByLabel('お名前', { exact: true }).fill('田中花子')
    await page.getByLabel('お名前（かな）').fill('タナカハナコ')
    await page.getByLabel('電話番号').fill('09012345678')
    await page.getByLabel('メールアドレス').fill('hanako@example.test')
    await page.getByRole('button', { name: '確認へ進む' }).click()
    await page.getByRole('button', { name: 'この内容で予約する' }).click()
    await visible(page.getByRole('heading', { name: '予約結果を確認しています' }))
    await shot(page, 'WEB-UNKNOWN', 'checking', 'sp')
    await page.context().close()
  }
}

/* ------------------------------------------------------------------ *
 * 実行
 * ------------------------------------------------------------------ */

async function newPage(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  return context.newPage()
}

async function waitForServer(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // preview サーバーがまだ立ち上がっていない。
    }
    await new Promise((settle) => setTimeout(settle, 500))
  }
  throw new Error(
    `preview server did not answer at ${url}. Start it first: pnpm run build && pnpm exec vite preview --port 4175 --strictPort`,
  )
}

async function main() {
  await waitForServer(BASE_URL)
  const browser = await chromium.launch()
  try {
    await captureBookingScreens(browser)
    await captureRecordingScreens(browser)
    await captureLedgerScreens(browser)
    await captureSearchScreens(browser)
    await captureCustomerScreen(browser)
    await captureStoreSwitchScreens(browser)
    await captureSettingsScreens(browser)
    await capturePublicationScreens(browser)
    await captureAttentionScreens(browser)
    await captureSharedTerminalScreens(browser)
    await captureAnalyticsScreen(browser)
    await captureWebScreens(browser)
  } finally {
    await browser.close()
  }
  console.log(`\n${captured.length} screens captured into ${OUT_DIR}`)
}

await main()
