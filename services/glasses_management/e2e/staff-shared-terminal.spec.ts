import { expect, type Page, test } from '@playwright/test'

/*
 * EYEX「完全共有 iPad」のライフサイクル E2E。
 *
 * 共有 iPad は `/terminal/<terminalId>/<token>` を開いて始まる。端末 id と
 * デバイストークンは URL から 1 度だけ読まれ、メモリにしか残らない。API は
 * すべて `page.route` で差し替え、SPA だけを実行する。
 *
 * 端末そのものが横向き iPad なので viewport は 1180×820 に固定する。
 */

const VIEWPORT = { width: 1180, height: 820 }

const ginzaId = '11111111-1111-4111-8111-111111111111'
const terminalId = '22222222-2222-4222-8222-222222222222'
const sessionUuid = '33333333-3333-4333-8333-333333333333'
const storedRecordingId = '44444444-4444-4444-8444-444444444444'
const heldRecordingId = '55555555-5555-4555-8555-555555555555'
const createdReservationId = '66666666-6666-4666-8666-666666666666'
const purposeId = '77777777-7777-4777-8777-777777777777'
const hanakoId = '88888888-8888-4888-8888-888888888888'
const publishedNoteId = '99999999-9999-4999-8999-999999999999'
const pendingNoteId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/** `SharedTerminalIssue` と同じ下限（40 文字）を満たし、DOM から探しやすい形。 */
const DEVICE_TOKEN = 'eyex-shared-terminal-device-token-0123456789ab'
/** 個人再認証で発行される短命グラント。こちらも 40 文字以上。 */
const GRANT_TOKEN = 'eyex-shared-terminal-reauth-grant-0123456789ab'

const ORGANIZATION_ID = 'org-eyex'

/** 共有 iPad の入口 URL。両セグメントは 1 度だけデコードされる。 */
const ENTRY = `/terminal/${terminalId}/${DEVICE_TOKEN}`

const stores = [
  {
    id: ginzaId,
    organizationId: ORGANIZATION_ID,
    name: '銀座店',
    slug: 'ginza',
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
]

const ALL_PERMISSIONS = [
  'store.read',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'recording.read',
  'recording.manage',
]

/** JST の当日。アプリと同じ規則で算出する。 */
function jstToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

function dayLabel(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  return `${at.getUTCMonth() + 1}月${at.getUTCDate()}日（${WEEKDAYS[at.getUTCDay()]}）`
}

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
  state: 'stored' | 'held' | 'failed' | 'uploading' | 'pending_deletion' | 'deleted'
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
    organizationId: ORGANIZATION_ID,
    storeId: ginzaId,
    receptionSessionId: sessionUuid,
    reservationId: null,
    recorderType: 'shared_terminal',
    recorderId: terminalId,
    startedAt: '2026-08-25T01:00:00.000Z',
    endedAt: '2026-08-25T01:05:00.000Z',
    durationSeconds: 300,
    endReason: 'completed',
    retentionUntil: '2026-09-25T01:00:00.000Z',
    holdReason: null,
    heldBy: null,
    heldAt: null,
    deletedAt: null,
    failureReason: null,
    version: 1,
    ...overrides,
  }
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
      id: purposeId,
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

/** 台帳に載る顧客。ロック後に「消えたこと」を主張するための目印。 */
const LEDGER_CUSTOMER = '銀座太郎'
const LEDGER_PHONE = '09011112222'

function ledgerFor(date: string) {
  return [
    {
      id: createdReservationId,
      entryType: 'reservation',
      source: 'staff',
      status: 'confirmed',
      startAt: `${date}T01:00:00.000Z`,
      endAt: `${date}T02:00:00.000Z`,
      customerName: LEDGER_CUSTOMER,
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

/** 注意事項の閲覧・登録・公開・改訂・非表示化まで一通り持つ権限（AC-EYEX-87 用）。 */
const ATTENTION_PERMISSIONS = [
  'customer.history',
  'attention.read',
  'attention.write',
  'attention.publish',
  'attention.revise',
  'attention.hide',
]

const hanako = {
  id: hanakoId,
  name: '田中花子',
  kana: 'タナカハナコ',
  phone: '090-1234-5678',
  email: null,
  primaryStoreId: ginzaId,
  visitCount: 4,
}

const customerDetail = {
  customerId: hanakoId,
  currentPrescription: null,
  pastPrescriptions: [],
  latestNote: null,
  ownedGlasses: [],
  attentionNotes: [],
  visitHistory: [],
}

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
    { capability: 'revise', minimumRole: 'store_manager', origin: 'organization' },
    { capability: 'hide', minimumRole: 'store_manager', origin: 'organization' },
  ],
  guidance: {
    record: ['発生した事実', '発生日時', '根拠', '推奨対応'],
    avoid: ['人格評価', '憶測', '差別につながる属性'],
  },
}

type Note = {
  id: string
  noteId: string
  customerId: string
  storeId: string
  status: 'pending_review' | 'published' | 'hidden' | 'returned' | 'rejected'
  version: number
  body: string
  occurredAt: string
  basis: string
  recommendedAction: string
  sharingScope: 'own_store' | 'permitted_stores' | 'all_stores'
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
    customerId: hanakoId,
    storeId: ginzaId,
    version: 1,
    body: '鼻あての金属で肌が荒れやすい。',
    occurredAt: '2026-08-20T01:00:00.000Z',
    basis: 'ご本人の申告',
    recommendedAction: '樹脂パッドを提案する',
    sharingScope: 'permitted_stores',
    // 共有 iPad から確認待ちで登録した行は、個人ではなく端末が主体になる。
    recordedBy: '受付カウンターiPad',
    recordedOn: '2026-08-20',
    publishedAt: null,
    hiddenAt: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewReason: null,
    ...overrides,
  }
}

/** 画面に最初から出ている公開済みの 1 件。改訂・非表示化の対象になる。 */
const PUBLISHED_NOTE = note({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  noteId: publishedNoteId,
  status: 'published',
  body: '強い遠近両用は合わないと申告あり。',
  publishedAt: '2026-08-21T01:00:00.000Z',
  recordedBy: '本部 佐藤',
})

type Sent = { method: string; url: string; headers: Record<string, string>; body: string }

type Options = {
  /** `GET /api/shared-terminals/:id/session` が返す無操作ロック秒数。 */
  idleTimeoutSeconds?: number
  /** 一覧に載せる録音。 */
  rows?: Recording[]
  /** 個人再認証グラントの有効性確認（GET .../reauthentication）の応答。 */
  reauthCheck?: () => { status: number; json: unknown }
  /**
   * 注意事項（顧客台帳 → 注意事項）の API を足す。既定の共有端末シナリオでは
   * 顧客検索も注意事項権限も出てこないので、必要なときだけ有効にする。
   */
  attention?: boolean
}

type Mocks = { sent: Sent[]; rows: Recording[] }

async function mockSharedTerminalApi(page: Page, options: Options = {}): Promise<Mocks> {
  const mocks: Mocks = { sent: [], rows: options.rows ?? [] }
  const record = (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const request = route.request()
    mocks.sent.push({
      method: request.method(),
      url: request.url(),
      headers: request.headers(),
      body: request.postData() ?? '',
    })
  }

  // Playwright は後から登録した route を先に照合するため、総当たりを最初に置く。
  await page.route('**/api/staff/stores/*/**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ json: { token: 'staff-e2e' } }),
  )
  await page.route('**/api/staff/stores', (route) => route.fulfill({ json: stores }))
  await page.route('**/api/staff/store-switches', (route) =>
    route.fulfill({ status: 201, json: {} }),
  )
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({
      json: options.attention ? [...ALL_PERMISSIONS, ...ATTENTION_PERMISSIONS] : ALL_PERMISSIONS,
    }),
  )
  await page.route('**/api/staff/stores/*/availability/settings', (route) =>
    route.fulfill({ json: availabilitySettings }),
  )
  await page.route('**/api/staff/stores/*/availability/slots*', (route) =>
    route.fulfill({
      json: slotsFor(new URL(route.request().url()).searchParams.get('date') ?? jstToday()),
    }),
  )
  await page.route('**/api/staff/stores/*/ledger*', (route) =>
    route.fulfill({
      json: ledgerFor(new URL(route.request().url()).searchParams.get('date') ?? jstToday()),
    }),
  )
  await page.route('**/api/staff/stores/*/recording-retention', (route) =>
    route.fulfill({
      json: {
        confirmedRetentionDays: 45,
        discardedRetentionHours: 72,
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    }),
  )
  await page.route('**/api/staff/stores/*/recordings', (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ json: mocks.rows })
    record(route)
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>
    return route.fulfill({
      status: 201,
      json: recording({
        id: storedRecordingId,
        state: 'stored',
        receptionSessionId: String(body.receptionSessionId),
        reservationId: (body.reservationId as string | null) ?? null,
        recorderType: body.recorderType as Recording['recorderType'],
        recorderId: String(body.recorderId),
        startedAt: String(body.startedAt),
        endedAt: String(body.endedAt),
        durationSeconds: Number(body.durationSeconds),
        endReason: body.endReason as Recording['endReason'],
      }),
    })
  })
  await page.route('**/api/staff/stores/*/recordings/*/audio', (route) => {
    record(route)
    return route.fulfill({ json: recording({ id: storedRecordingId, state: 'stored' }) })
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
  await page.route('**/api/staff/stores/*/reservations', (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ json: [] })
    record(route)
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, string>
    return route.fulfill({
      status: 201,
      json: {
        id: createdReservationId,
        organizationId: ORGANIZATION_ID,
        storeId: ginzaId,
        reservationNumber: 'EY-3001',
        source: 'staff',
        status: 'confirmed',
        startAt: `${body.date}T01:00:00.000Z`,
        endAt: `${body.date}T02:00:00.000Z`,
        purposeIds: [purposeId],
        customer: { name: '田中花子', kana: 'タナカハナコ', phone: '09012345678', email: null },
        recital: body.recital ?? '復唱',
        reservationMemo: null,
        handoffNote: null,
        version: 1,
        createdAt: `${body.date}T00:00:00.000Z`,
      },
    })
  })
  await page.route('**/api/shared-terminals/*/session', (route) => {
    record(route)
    return route.fulfill({
      json: {
        id: terminalId,
        organizationId: ORGANIZATION_ID,
        storeId: ginzaId,
        name: '受付カウンターiPad',
        status: 'active',
        idleTimeoutSeconds: options.idleTimeoutSeconds ?? 600,
        expiresAt: '2027-08-27T00:00:00.000Z',
        lastSeenAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        revokedAt: null,
      },
    })
  })
  await page.route('**/api/shared-terminals/*/reauthenticate', (route) => {
    record(route)
    return route.fulfill({
      status: 201,
      json: { token: GRANT_TOKEN, expiresAt: '2026-08-27T03:05:00.000Z' },
    })
  })
  await page.route('**/api/shared-terminals/*/reauthentication', (route) => {
    record(route)
    return route.fulfill(options.reauthCheck?.() ?? { status: 200, json: {} })
  })
  if (options.attention) {
    // 顧客台帳（検索 → 1 件取得）。注意事項はここからしか開けない。
    await page.route('**/api/staff/stores/*/customers**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/attention-notes')) return route.fulfill({ json: [PUBLISHED_NOTE] })
      return path.endsWith('/customers')
        ? route.fulfill({ json: [hanako] })
        : route.fulfill({ json: customerDetail })
    })
    await page.route('**/api/staff/stores/*/attention-settings', (route) =>
      route.fulfill({ json: attentionSettings }),
    )
    // 共有端末を主体にした注意事項の経路。登録・公開・改訂・非表示化が同じ形で載る。
    await page.route('**/api/shared-terminals/*/stores/**', (route) => {
      record(route)
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/review'))
        return route.fulfill({
          json: {
            ...note({ id: PUBLISHED_NOTE.id, noteId: pendingNoteId, status: 'published' }),
            version: 2,
            publishedAt: '2026-08-27T02:00:00.000Z',
            reviewedBy: 'manager@eyex.example',
            reviewedAt: '2026-08-27T02:00:00.000Z',
            reviewReason: '内容を確認しました',
          },
        })
      if (path.endsWith('/revisions'))
        return route.fulfill({ json: { ...PUBLISHED_NOTE, version: 2 } })
      if (path.endsWith('/hide'))
        return route.fulfill({
          json: {
            ...PUBLISHED_NOTE,
            status: 'hidden',
            version: 2,
            hiddenAt: '2026-08-27T02:00:00.000Z',
          },
        })
      // 確認待ちの新規登録。共有端末が記録者として保存される。
      return route.fulfill({
        status: 201,
        json: note({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          noteId: pendingNoteId,
          status: 'pending_review',
          body: '受付時に強い頭痛の訴えあり。',
          basis: 'ご本人の申告',
          recommendedAction: '休憩を挟んで測定する',
        }),
      })
    })
  }
  return mocks
}

/**
 * ブラウザのマイク権限を差し替える。共有 iPad の受付では録音が既定なので、
 * 権限プロンプトを実機に依存させない。
 */
async function stubMicrophone(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        // 本物の `MediaStream` を返す。`MediaRecorder` は偽物を受け取らない。
        getUserMedia: async () => new AudioContext().createMediaStreamDestination().stream,
      },
    })
  })
}

/**
 * 端末のタイマーを Playwright の時計へ差し替える。無操作期限を確定的に
 * 進めるためであり、共有端末はどのシナリオでも同じ時計の上で動かす。
 *
 * NOTE: 2026-08 時点の `StaffWorkspace` は `createSharedTerminalController`
 * へ素の `setTimeout` / `clearTimeout` を渡しており、ブラウザではレシーバが
 * 外れて `Illegal invocation` になる（セッション開始が catch され、端末が
 * 「利用は停止されています」になる）。`page.clock.install()` は関数を素の
 * JS 実装へ置き換えるため、この不具合を迂回する。実機の共有 iPad を直す
 * には `StaffWorkspace` 側で `window` に束縛して渡す必要がある。
 */
async function installTerminalClock(page: Page) {
  await page.clock.install()
}

/** 共有 iPad の入口 URL を開き、店舗の業務開始画面まで到達する。 */
async function openSharedTerminal(page: Page) {
  await page.setViewportSize(VIEWPORT)
  await page.goto(ENTRY)
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
}

/** ヘッダー管理メニュー「録音運用」まで進める。 */
async function openRecordingOps(page: Page) {
  await page
    .getByRole('navigation', { name: '管理メニュー' })
    .getByRole('button', { name: '録音運用' })
    .click()
  const screen = page.getByRole('region', { name: '録音運用' })
  await expect(screen).toBeVisible()
  return screen
}

function holdRequests(mocks: Mocks) {
  return mocks.sent.filter((entry) => entry.url.includes('/hold'))
}

// @e2e-covers UC-EYEX-133
test('共有iPadは店舗と端末として名乗り、個人を推測しないまま日常業務の記録を残す', async ({
  page,
}) => {
  await installTerminalClock(page)
  const mocks = await mockSharedTerminalApi(page)
  await stubMicrophone(page)
  await openSharedTerminal(page)

  // 端末は自分の id とデバイストークンだけで名乗る。個人の bearer は載せない。
  const session = mocks.sent.find((entry) => entry.url.includes('/session'))
  if (!session) throw new Error('共有端末セッションを要求していない')
  expect(session.url).toContain(`/api/shared-terminals/${terminalId}/session`)
  expect(session.headers['x-shared-terminal-token']).toBe(DEVICE_TOKEN)
  expect(session.headers.authorization).toBeUndefined()

  // 日常業務の入口でスタッフを選ばせない・PIN も求めない（個人を推測しない）。
  await expect(page.getByRole('textbox', { name: /PIN/ })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: /スタッフ/ })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // 受付を 1 件通す。録音の主体は端末であり、担当者名を当て推量しない。
  await page.getByRole('button', { name: '新しい予約を取る' }).click()
  const indicator = page.getByRole('region', { name: 'iPad録音' })
  await indicator.getByRole('button', { name: '録音を開始する' }).click()
  await expect(indicator.getByTestId('recording-state')).toHaveText('録音中')
  await page.getByRole('button', { name: dayLabel(jstToday()) }).click()
  await page.getByRole('button', { name: '11:00', exact: true }).click()
  await page.getByRole('button', { name: /メガネを新しく作りたい/ }).click()
  await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
  await page.getByLabel('お電話番号').fill('09012345678')
  await page.getByLabel('お名前', { exact: true }).fill('田中花子')
  await page.getByLabel('フリガナ').fill('タナカハナコ')
  await page.getByRole('button', { name: '復唱へ進む' }).click()
  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  await expect(page.getByRole('heading', { name: '予約を確定しました' })).toBeVisible()

  const posted = mocks.sent.find(
    (entry) => entry.method === 'POST' && entry.url.endsWith('/recordings'),
  )
  if (!posted) throw new Error('録音メタデータを送っていない')
  const body = JSON.parse(posted.body) as Record<string, unknown>
  // 店舗はパスで、端末は本文で名指しされる。個人 id は入らない。
  expect(posted.url).toContain(`/api/staff/stores/${ginzaId}/recordings`)
  expect(body.recorderType).toBe('shared_terminal')
  expect(body.recorderId).toBe(terminalId)
  expect(body).not.toHaveProperty('staffId')
  expect(body).not.toHaveProperty('userId')
})

// @e2e-covers UC-EYEX-135 UC-EYEX-157 AC-EYEX-97
test('共有iPadは画面非表示・バックグラウンド・無操作期限のいずれでも顧客情報を隠し、業務開始画面へ戻す', async ({
  page,
}) => {
  // 無操作期限は `page.clock` で確定的に到達させる。秒数は端末の設定から来る。
  await installTerminalClock(page)
  await mockSharedTerminalApi(page, { idleTimeoutSeconds: 60 })

  const showCustomer = async () => {
    await page
      .getByRole('navigation', { name: '副操作' })
      .getByRole('button', { name: '予約台帳' })
      .click()
    await expect(page.getByRole('heading', { name: '銀座店の予約台帳' })).toBeVisible()
    await expect(page.getByText(LEDGER_CUSTOMER).first()).toBeVisible()
  }
  const expectHidden = async () => {
    const locked = page.getByRole('heading', { name: '顧客情報を隠しました' })
    await expect(locked).toBeVisible()
    await expect(
      page.getByText('画面非表示または無操作のため、端末をロックしました。'),
    ).toBeVisible()
    // 氏名・電話番号は画面のどこにも残らない（AC-EYEX-97）。
    await expect(page.locator('body')).not.toContainText(LEDGER_CUSTOMER)
    await expect(page.locator('body')).not.toContainText(LEDGER_PHONE)
    await expect(page.getByRole('heading', { name: '銀座店の予約台帳' })).toHaveCount(0)
    // 戻り先は店舗の業務開始画面であり、再開の導線だけが残る（UC-EYEX-135）。
    await expect(page.getByRole('button', { name: '業務を再開する' })).toBeVisible()
  }

  // 1. ページ離脱（バックグラウンド移行）。
  await openSharedTerminal(page)
  await showCustomer()
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'))
  })
  await expectHidden()

  // 2. 画面非表示（visibilitychange → hidden）。
  await openSharedTerminal(page)
  await showCustomer()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expectHidden()

  // 3. 無操作期限の到来（端末の idleTimeoutSeconds = 60）。
  await openSharedTerminal(page)
  await showCustomer()
  // 期限の手前ではまだ顧客情報を出したままでよい。
  await page.clock.fastForward(50_000)
  await expect(page.getByText(LEDGER_CUSTOMER).first()).toBeVisible()
  await page.clock.fastForward(15_000)
  await expectHidden()
})

// @e2e-covers UC-EYEX-134 UC-EYEX-138 AC-EYEX-101
test('共有iPadの管理操作は個人PINで本人を確かめてから走り、期限切れのグラントは実行せず問い直す', async ({
  page,
}) => {
  await installTerminalClock(page)
  let grantValid = false
  const mocks = await mockSharedTerminalApi(page, {
    rows: [recording({ id: storedRecordingId, state: 'stored' })],
    reauthCheck: () =>
      grantValid ? { status: 200, json: {} } : { status: 401, json: { error: 'reauth_expired' } },
  })
  await openSharedTerminal(page)
  const screen = await openRecordingOps(page)

  // 保全は管理操作。まず個人を特定し、その前に要求は飛ばない（UC-EYEX-138）。
  await screen.getByRole('button', { name: '保全する' }).click()
  const prompt = page.getByRole('dialog', { name: '管理者として確認してください' })
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText(
    '録音の保全には個人認証が必要です。共有端末と認証した個人の両方を監査記録に残します。',
  )
  await expect(page.getByRole('dialog', { name: '録音を保全する' })).toHaveCount(0)
  expect(holdRequests(mocks)).toEqual([])

  // 短命グラントが使う前に切れていれば、保留中の操作は走らずに問い直す（UC-EYEX-134）。
  await prompt.getByLabel('個人ログインID').fill('manager@eyex.example')
  await prompt.getByLabel('個人PIN').fill('482913')
  await prompt.getByRole('button', { name: '確認して続ける' }).click()
  await expect(prompt).toContainText(
    '個人認証の有効期限が切れました。もう一度個人PINを入力してください。',
  )
  await expect(page.getByRole('dialog', { name: '録音を保全する' })).toHaveCount(0)
  expect(holdRequests(mocks)).toEqual([])
  // PIN は消され、入力し直しになる。
  await expect(prompt.getByLabel('個人PIN')).toHaveValue('')

  // 本人が確認できて初めて操作の面が開く。理由は必須（AC-EYEX-101）。
  grantValid = true
  await prompt.getByLabel('個人PIN').fill('482913')
  await prompt.getByRole('button', { name: '確認して続ける' }).click()
  const action = page.getByRole('dialog', { name: '録音を保全する' })
  await expect(action).toBeVisible()
  await action.getByRole('button', { name: '保全を実行' }).click()
  await expect(action.getByText('保全の理由を入力してください。')).toBeVisible()
  expect(holdRequests(mocks)).toEqual([])

  await action.getByLabel('保全の理由').fill('弁護士からの保全通知')
  await action.getByRole('button', { name: '保全を実行' }).click()
  await expect(page.getByRole('dialog', { name: '録音を保全する' })).toHaveCount(0)

  // 実行時には、端末ではなく「認証された個人」のグラントが添えられる。
  const holds = holdRequests(mocks)
  expect(holds).toHaveLength(1)
  expect(holds[0]?.url).toContain(`/recordings/${storedRecordingId}/hold`)
  expect(holds[0]?.headers['x-shared-terminal-reauth-token']).toBe(GRANT_TOKEN)
  expect(JSON.parse(holds[0]?.body ?? '{}')).toEqual({ version: 1, reason: '弁護士からの保全通知' })

  // 個人認証そのものは端末 id を宛先にし、PIN の生値は送らない。
  const issued = mocks.sent.find((entry) => entry.url.endsWith('/reauthenticate'))
  if (!issued) throw new Error('個人再認証を要求していない')
  expect(issued.url).toContain(`/api/shared-terminals/${terminalId}/reauthenticate`)
  const issuedBody = JSON.parse(issued.body) as { userId: string; stretchedPin: string }
  expect(issuedBody.userId).toBe('manager@eyex.example')
  expect(issuedBody.stretchedPin).not.toBe('482913')
})

// @e2e-covers UC-EYEX-137
test('共有モードでは録音の保全・解除を端末の権限だけでは実行できず、日常業務はPINを求めない', async ({
  page,
}) => {
  await installTerminalClock(page)
  const mocks = await mockSharedTerminalApi(page, {
    rows: [
      recording({ id: storedRecordingId, state: 'stored' }),
      recording({
        id: heldRecordingId,
        state: 'held',
        holdReason: '弁護士からの保全通知',
        heldBy: '本部 佐藤',
      }),
    ],
  })
  await openSharedTerminal(page)

  // 日常業務（ホーム → 予約台帳 → 予約受付）は PIN も本人確認も挟まない。
  await expect(page.getByRole('textbox', { name: /PIN/ })).toHaveCount(0)
  await page
    .getByRole('navigation', { name: '副操作' })
    .getByRole('button', { name: '予約台帳' })
    .click()
  await expect(page.getByRole('heading', { name: '銀座店の予約台帳' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /PIN/ })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await openSharedTerminal(page)
  const screen = await openRecordingOps(page)

  // 保全は端末の権限だけでは走らない。取りやめれば何も起きない。
  await screen.getByRole('button', { name: '保全する' }).click()
  const prompt = page.getByRole('dialog', { name: '管理者として確認してください' })
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'キャンセル' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(holdRequests(mocks)).toEqual([])

  // 保全解除も同じ扱いで、共有端末のままでは実行できない。
  await screen.getByRole('button', { name: '保全を解除する' }).click()
  await expect(page.getByRole('dialog', { name: '管理者として確認してください' })).toContainText(
    '録音の保全解除には個人認証が必要です。',
  )
  await expect(page.getByRole('dialog', { name: '録音の保全を解除する' })).toHaveCount(0)
  expect(holdRequests(mocks)).toEqual([])
})

/** 共有 iPad のホーム → 顧客台帳 → 候補を選ぶ → 注意事項、まで進める。 */
async function openAttentionReview(page: Page) {
  await page
    .getByRole('navigation', { name: '副操作' })
    .getByRole('button', { name: '顧客台帳' })
    .click()
  await expect(page.getByRole('heading', { name: 'お客様を探す' })).toBeVisible()
  await page.getByLabel('電話番号', { exact: true }).fill('09012345678')
  await page.getByRole('button', { name: '候補を探す' }).click()
  const option = page.getByRole('listbox', { name: '顧客候補' }).getByRole('option')
  await expect(option).toHaveCount(1)
  await option.click()
  await page.getByRole('button', { name: '注意事項を確認・登録する' }).click()
  await expect(page.getByRole('heading', { name: '注意事項', exact: true })).toBeVisible()
}

/**
 * 個人再認証が「先に完了した」ことを、送信ログの並びで確かめる。
 *
 * NOTE: 2026-08 時点の `authFetch` は `authorization` を店舗セッションの
 * access token で必ず上書きするため、`AttentionReviewScreen` が付ける
 * `authorization: Bearer <grant>` はネットワークに出てこない（録音の保全は
 * `x-shared-terminal-reauth-token` を使うので影響を受けない）。ブラウザから
 * 観測できるのはこの順序だけなので、ここではそれを主張する。実機を直すには
 * 注意事項側もヘッダー名を分けるか、`authFetch` が明示指定を尊重する必要がある。
 */
function grantedBefore(mocks: Mocks, index: number) {
  const issued = mocks.sent.findIndex((entry) => entry.url.endsWith('/reauthenticate'))
  const confirmed = mocks.sent.findIndex((entry) => entry.url.endsWith('/reauthentication'))
  return issued !== -1 && confirmed !== -1 && issued < index && confirmed < index
}

/** 公開・改訂・非表示化。日常業務（登録）はここに入らない。 */
function managementRequests(mocks: Mocks) {
  return mocks.sent.filter((entry) =>
    /\/(review|revisions|hide)$/.test(new URL(entry.url).pathname),
  )
}

// @e2e-covers AC-EYEX-87
test('共有iPadは注意事項を確認待ちで登録できるが、公開・改訂・非表示化には管理者の個人認証を求める', async ({
  page,
}) => {
  await installTerminalClock(page)
  const mocks = await mockSharedTerminalApi(page, { attention: true })
  await openSharedTerminal(page)
  await openAttentionReview(page)

  // 1. 確認待ちの登録は日常業務。PIN も本人確認も挟まない。
  await page.getByLabel('発生した事実').fill('受付時に強い頭痛の訴えあり。')
  await page.getByLabel('発生日時').fill('2026-08-27T10:30')
  await page.getByLabel('根拠').fill('ご本人の申告')
  await page.getByLabel('推奨対応').fill('休憩を挟んで測定する')
  await page.getByRole('button', { name: '注意事項を登録する' }).click()
  await expect(
    page.getByText(
      '確認待ちとして登録しました。権限者が公開するまで通常のスタッフには表示されません。',
    ),
  ).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // 登録主体は共有端末。宛先が端末の経路であり、個人の bearer は載らない。
  const registered = mocks.sent.find(
    (entry) => entry.method === 'POST' && entry.url.endsWith('/attention-notes'),
  )
  if (!registered) throw new Error('注意事項の登録要求を送っていない')
  expect(new URL(registered.url).pathname).toBe(
    `/api/shared-terminals/${terminalId}/stores/${ginzaId}/customers/${hanakoId}/attention-notes`,
  )
  // 端末の共有セッション以外は載らない。個人再認証のグラントは要求すらしていない。
  expect(registered.headers['x-shared-terminal-token']).toBe(DEVICE_TOKEN)
  expect(registered.headers.authorization).not.toBe(`Bearer ${GRANT_TOKEN}`)
  expect(mocks.sent.filter((entry) => entry.url.endsWith('/reauthenticate'))).toEqual([])
  expect(managementRequests(mocks)).toEqual([])

  // 2. 公開は管理操作。PIN の前に要求は 1 本も飛ばない。
  const pending = page.getByRole('article', { name: '注意事項 確認待ち 版1' })
  await expect(pending).toBeVisible()
  await pending.getByLabel('確認の理由').fill('内容を確認しました')
  await pending.getByRole('button', { name: '公開する' }).click()
  const prompt = page.getByRole('dialog', { name: '管理者として確認してください' })
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('注意事項の公開には個人認証が必要です。')
  expect(managementRequests(mocks)).toEqual([])

  await prompt.getByLabel('個人ログインID').fill('manager@eyex.example')
  await prompt.getByLabel('個人PIN').fill('482913')
  await prompt.getByRole('button', { name: '確認して続ける' }).click()
  await expect(page.getByText('公開しました。登録者と監査記録へ結果を残しました。')).toBeVisible()

  // 実行された公開は、端末ではなく認証した個人のグラントを添えて飛ぶ。
  const published = managementRequests(mocks)
  expect(published).toHaveLength(1)
  expect(new URL(published[0]?.url ?? '').pathname).toBe(
    `/api/shared-terminals/${terminalId}/stores/${ginzaId}/attention-notes/${pendingNoteId}/review`,
  )
  expect(grantedBefore(mocks, mocks.sent.indexOf(published[0] as Sent))).toBe(true)

  // 3. 改訂も同じ扱い。PIN が通るまで改訂要求は送られない。
  const publishedNote = page.getByRole('article', { name: '注意事項 公開済み 版1' })
  await publishedNote.getByRole('button', { name: '改訂する' }).click()
  const revision = page.getByRole('dialog', { name: '注意事項を改訂' })
  await revision.getByLabel('発生した事実').fill('強い遠近両用は合わないと申告あり（再確認）。')
  await revision.getByRole('button', { name: '改訂版を公開する' }).click()
  const revisePrompt = page.getByRole('dialog', { name: '管理者として確認してください' })
  await expect(revisePrompt).toBeVisible()
  await expect(revisePrompt).toContainText('注意事項の改訂には個人認証が必要です。')
  expect(managementRequests(mocks)).toHaveLength(1)

  await revisePrompt.getByLabel('個人ログインID').fill('manager@eyex.example')
  await revisePrompt.getByLabel('個人PIN').fill('482913')
  await revisePrompt.getByRole('button', { name: '確認して続ける' }).click()
  await expect(page.getByText('改訂版を公開しました。過去の版は残っています。')).toBeVisible()

  const revised = managementRequests(mocks)
  expect(revised).toHaveLength(2)
  expect(new URL(revised[1]?.url ?? '').pathname).toBe(
    `/api/shared-terminals/${terminalId}/stores/${ginzaId}/attention-notes/${publishedNoteId}/revisions`,
  )
  expect(grantedBefore(mocks, mocks.sent.indexOf(revised[1] as Sent))).toBe(true)
})
