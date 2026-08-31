import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { CHECKOUT_IPAD, enterPin, enterSharedWorkspace } from './terminal-start'

/*
 * 端末の使い分けと監査（`013-terminals-and-audit`）の受け入れ基準を、実ブラウザと
 * 実 Worker で確かめる。
 *
 * **URL を直に叩かない。**業務開始の 6 面（`/start` `/login/**` `/mode/personal`）は
 * `App.tsx` の状態で出し分けるだけで URL を持たないので、どの test も `/` を開いて
 * 操作でたどる（P0 の `e2e/foundation.spec.ts` と同じ形）。
 *
 * **120 秒を実時間で待たない。**自動ロックと個人モードの寿命は `page.clock` で進める。
 * 「2分間さわらなかったので伏せました。」は固定文なので、文言の test と時間の test を
 * 分けても食い違わない。
 *
 * **盤面（D1）の扱い**: ipad project の中で `store-settings.spec.ts` の後に走る。
 * ご予約を書くのは **2026年9月17日（木）だけ**にして、seed の 8月27日・28日 と
 * `booking.spec.ts`（9月3日）・`mock-compare.spec.ts`（9月2日）・`change.spec.ts`（9月5日以降）・
 * `recording.spec.ts`（9月11日）の盤面に指を触れない。
 */

const ORG = 'org-eyex-seed'
/** seed.mjs が固定 id で入れる EYEX 銀座店。 */
const GINZA = '11111111-1111-4111-8111-111111111111'
const VIEWER = `dev:${ORG}`
const INTERNAL_KEY = 'dev-internal-key'
const MEMBERSHIP_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'

/** seed の id は `${区分}-0000-4000-8000-${連番}`（`seed.mjs` の `uid`）。 */
const uid = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`
const SATO = uid('c0010000', 0)
/** 今のメガネを調整したい（20 分）。60 分の目的より枠が取りやすい。 */
const ADJUST = uid('e0010000', 1)
const ADJUST_LABEL = '今のメガネを調整したい'
/** seed が入れている置き場所 3 台。 */
const RECEPTION_IPAD = '銀座店 受付iPad'
const EXAM_IPAD = '銀座店 検査室iPad'
/** seed がスタッフ全員に入れている暗証番号と、絶対に合わない番号。 */
const STAFF_PIN = '4821'
const WRONG_PIN = '9911'

/*
 * ご予約を書く日は **本日（JST）**である。受付履歴が読むのは「その日にご来店予定の
 * ご予約」で、窓は必ず本日までなので、先の日に置いた予約は一覧に出ない
 * （`GET /api/staff/reception-sessions` の `to` は本日で頭打ちになる）。
 *
 * 時刻は**いまより先の 30 分刻み**を数えて決める。固定の時刻を焼き込むと、走らせた
 * 時間帯によって「過ぎた枠は取れない」で落ちるからである。閉店（19:00）までに
 * 走らせる前提で、いちばん早い枠から順に配る。
 */
const TODAY = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

/** いまより先の 30 分刻み（0 番目が最初の枠）。 */
function slot(index: number): string {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const minutes = jstNow.getUTCHours() * 60 + jstNow.getUTCMinutes()
  const first = Math.ceil((minutes + 30) / 30) * 30
  const total = Math.max(first, 10 * 60) + index * 30
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const at = (hhmm: string): string =>
  new Date(Date.parse(`${TODAY}T${hhmm}:00.000+09:00`)).toISOString()

const ALL_PERMISSIONS = [
  'store.read',
  'store.manage',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.write',
  'settings.read',
  'analytics.read',
  'settings.manage',
  'terminal.manage',
  'recording.read',
  'recording.manage',
  'audit.read',
]

/** 設定を店長の権限では保存できない配り方（EX-PERMISSION を出すための前提）。 */
const STAFF_PERMISSIONS = ALL_PERMISSIONS.filter((perm) => perm !== 'settings.manage')

/* --- API を直に叩く（前提づくり） ---------------------------------------- */

async function authed(request: APIRequestContext): Promise<{ headers: Record<string, string> }> {
  const res = await request.post('/api/auth/token', {
    data: { organizationId: ORG, role: 'staff' },
  })
  expect(res.status()).toBe(200)
  const { token } = (await res.json()) as { token: string }
  return { headers: { authorization: `Bearer ${token}` } }
}

/** 担当店舗の行を配り直す。**id はほかの e2e と同じ 1 本**（一意制約があるため）。 */
async function grant(request: APIRequestContext, permissions: string[]): Promise<void> {
  const res = await request.post('/api/internal/store-memberships/sync', {
    headers: { 'x-internal-key': INTERNAL_KEY },
    data: {
      id: MEMBERSHIP_ID,
      organizationId: ORG,
      storeId: GINZA,
      userId: VIEWER,
      permissions,
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  })
  expect(res.status()).toBe(200)
}

type Recording = {
  id: string
  code: string
  receptionSessionId: string
  reservationId: string | null
  state: string
  legalHold: boolean
  uploadAttempts: number
}

/** 中身が 12 バイトの `audio/mp4`（本体は R2 へ入るだけで、画面には出ない）。 */
const AUDIO = Buffer.from([0, 0, 0, 32, 102, 116, 121, 112, 77, 52, 65, 32])

async function startReception(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/staff/reception-sessions', {
    ...(await authed(request)),
    data: { storeId: GINZA },
  })
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { id: string }).id
}

async function bookFrom(
  request: APIRequestContext,
  sessionId: string,
  hhmm: string,
): Promise<{ id: string; code: string; version: number }> {
  const res = await request.post('/api/staff/reservations', {
    ...(await authed(request)),
    data: {
      storeId: GINZA,
      source: 'phone',
      startsAt: at(hhmm),
      purposeIds: [ADJUST],
      staffId: null,
      equipmentIds: [],
      receptionSessionId: sessionId,
    },
  })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as { id: string; code: string; version: number }
}

/** 受付 → 録音 → 保管庫。保全（UC-TERM-09）の前提を 1 本ぶん作る。 */
async function storedRecording(request: APIRequestContext, hhmm: string): Promise<Recording> {
  const sessionId = await startReception(request)
  await bookFrom(request, sessionId, hhmm)
  const created = await request.post('/api/staff/recordings', {
    ...(await authed(request)),
    data: { receptionSessionId: sessionId, storeId: GINZA, startedAt: new Date().toISOString() },
  })
  expect(created.status(), await created.text()).toBe(200)
  const recording = (await created.json()) as Recording
  const stored = await request.put(
    `/api/staff/recordings/${recording.id}/content?durationSeconds=192`,
    {
      headers: { ...(await authed(request)).headers, 'content-type': 'audio/mp4' },
      data: AUDIO,
    },
  )
  expect(stored.status(), await stored.text()).toBe(200)
  return (await stored.json()) as Recording
}

async function recordingState(request: APIRequestContext, id: string): Promise<string | null> {
  const res = await request.get('/api/staff/recordings', {
    ...(await authed(request)),
    params: { storeId: GINZA, limit: 200 },
  })
  expect(res.status()).toBe(200)
  const items = ((await res.json()) as { items: Recording[] }).items
  return items.find((row) => row.id === id)?.state ?? null
}

async function alertCounts(
  request: APIRequestContext,
  kind: 'all' | 'action' | 'info' | 'resolved',
): Promise<number> {
  const res = await request.get('/api/staff/alerts', {
    ...(await authed(request)),
    params: { storeId: GINZA, kind, limit: 200 },
  })
  expect(res.status()).toBe(200)
  return ((await res.json()) as { counts: Record<string, number> }).counts[kind] ?? 0
}

/** 3 回続けて送れなかった録音を作る（`recording.upload_failed` が 1 件立つ）。 */
async function failedRecording(request: APIRequestContext, hhmm: string): Promise<Recording> {
  const sessionId = await startReception(request)
  await bookFrom(request, sessionId, hhmm)
  const created = await request.post('/api/staff/recordings', {
    ...(await authed(request)),
    data: { receptionSessionId: sessionId, storeId: GINZA, startedAt: new Date().toISOString() },
  })
  expect(created.status(), await created.text()).toBe(200)
  let recording = (await created.json()) as Recording
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const state of ['uploading', 'failed']) {
      const res = await request.patch(`/api/staff/recordings/${recording.id}`, {
        ...(await authed(request)),
        data: { state },
      })
      expect(res.status(), await res.text()).toBe(200)
      recording = (await res.json()) as Recording
    }
  }
  return recording
}

/* --- 画面を開く ---------------------------------------------------------- */

/** 業務開始の入口（START-DEVICE-MODE）まで開く。 */
async function openStart(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(ORG)
  await page.getByRole('button', { name: '業務を始める' }).click()
  await expect(
    page.getByRole('heading', { name: 'この iPad の使い方を決めてください' }),
  ).toBeVisible()
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: '画面の切り替え' })

/** seed のご予約が並ぶ日（2026年8月27日（木）11:08）。台帳を空で開かないために据える。 */
const LEDGER_NOW = '2026-08-27T02:08:00.000Z'

/** 予約台帳を「予約リスト」の形で開く。 */
async function openReservationList(page: Page) {
  await goTo(page, '予約台帳')
  await expect(page.getByRole('grid', { name: '予約台帳' })).toBeVisible()
  await page
    .getByRole('group', { name: '表示のかたち' })
    .getByRole('button', { name: '予約リスト' })
    .click()
  const table = page.getByRole('table', { name: '本日のご予約' })
  await expect(table).toBeVisible()
  return table
}

/**
 * 受付履歴を開き、**目印が出た 1 件**で止める。一覧の先頭が探している 1 件とは
 * 限らない（同じ日にほかの spec が置いた受付も並ぶ）ので、上から順に開いて確かめる。
 */
async function openEntryUntil(page: Page, marker: Locator, what: string): Promise<void> {
  await goTo(page, '受付履歴')
  await expect(page.getByRole('main', { name: '受付履歴' })).toBeVisible()
  const rows = page.getByRole('group', { name: '受付の一覧' }).getByRole('button')
  // 一覧が届く前に数えない（0 件のまま先へ進むと、探す前に諦めてしまう）。
  await expect(rows.first()).toBeVisible()
  const total = Math.min(await rows.count(), 20)
  for (let index = 0; index < total; index += 1) {
    await rows.nth(index).click()
    await expect(page.getByRole('heading', { name: 'そのあとの変更' })).toBeVisible()
    if ((await marker.count()) > 0) return
  }
  throw new Error(`${what} が受付履歴の先頭 ${total} 件に無い`)
}

/** 受付履歴を開き、録音が付いている 1 件を選ぶ。 */
async function openRecordedEntry(page: Page): Promise<void> {
  await openEntryUntil(
    page,
    page.getByRole('button', { name: 'この録音を保全する' }),
    '録音が付いた受付',
  )
}

/** 上のバーのお知らせの入口（左の柱の行は、この面を開いているときだけ出る）。 */
async function openAlerts(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^お知らせ \d+件$/ }).click()
}

async function goTo(page: Page, label: string): Promise<void> {
  await sidebar(page).getByRole('button', { name: label, exact: true }).click()
}

/**
 * 工程 1 で、**押せる最初のお日にちと最初のお時間**を選ぶ。日付を焼き込まないのは、
 * 走らせた日が定休（火曜）だとその日のボタンが押せないからである。
 */
async function pickFirstOpenSlot(page: Page): Promise<void> {
  const openDay = page
    .getByRole('button', { name: /^\d+月\d+日（.）$/ })
    .and(page.locator('button:not([disabled])'))
    .first()
  await expect(openDay).toBeVisible()
  await openDay.click()
  const times = page
    .getByRole('button', { name: /^\d{2}:\d{2} / })
    .and(page.locator('button:not([disabled])'))
  await expect(times.first()).toBeVisible()
  await times.first().click()
}

/** 工程 3。既定の置き場所が先約と重なっていたら、重なりが消えるまで置き直す。 */
async function clearClash(page: Page): Promise<void> {
  const board = page.getByRole('table', { name: 'ご予約を置く盤' })
  if ((await board.getByText('重なっています').count()) === 0) return
  const sameTime = page.getByRole('button', { name: /\d{2}:\d{2}–\d{2}:\d{2} が空いています$/ })
  if ((await sameTime.count()) > 0) await sameTime.first().click()
  else await page.getByRole('button', { name: '担当はあとで決める' }).click()
  await expect(board.getByText('重なっています')).toHaveCount(0)
}

/** 共有モードで業務画面まで入る。 */
async function startShared(page: Page, place: string = CHECKOUT_IPAD): Promise<void> {
  await openStart(page)
  await enterSharedWorkspace(page, place)
}

/** 個人モードの暗証番号の面まで進む（スタッフを選んだところで止める）。 */
async function openStaffPin(page: Page, name: string): Promise<void> {
  await openStart(page)
  await page.getByRole('button', { name: '個人の端末にする' }).click()
  await expect(
    page.getByRole('heading', { name: '業務を始めるスタッフを選んでください' }),
  ).toBeVisible()
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await expect(page.getByRole('button', { name: '確定' })).toBeVisible()
}

/** いまの端末が名乗っている業務の id（`x-terminal-session` と同じ値）。 */
async function terminalSessionId(page: Page): Promise<string> {
  const raw = (await page.evaluate('sessionStorage.getItem("eyex.terminal.session")')) as
    | string
    | null
  expect(raw).not.toBeNull()
  return (JSON.parse(String(raw)) as { sessionId: string }).sessionId
}

/** 置き場所の 3 つの状態を、走らせた時刻に左右されない形で作る。 */
async function stubPlaces(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === '/api/staff/terminals',
    async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as {
        items: { name: string; lastSeenAt: string | null; isOnline: boolean }[]
      }
      // 3 台の状態を全部こちらで決める（前の spec が業務を始めていると実物は動く）。
      const items = body.items.map((item) =>
        item.name === RECEPTION_IPAD
          ? { ...item, lastSeenAt: new Date().toISOString(), isOnline: true }
          : item.name === CHECKOUT_IPAD
            ? { ...item, lastSeenAt: null, isOnline: false }
            : { ...item, lastSeenAt: '2026-08-26T09:42:00.000Z', isOnline: false },
      )
      await route.fulfill({ response, json: { ...body, items } })
    },
  )
}

/* ========================================================================= */

// @e2e-covers UC-TERM-01 AC-TERM-01
test('端末の使い方をまだ決めていないときは、個人と共有の違いを 3 行で読める', async ({ page }) => {
  await openStart(page)
  await expect(page.getByText('はじめの1回だけの設定です。')).toBeVisible()
  for (const card of ['個人の端末として使う', 'みんなで使う端末として置く']) {
    const section = page.getByRole('region', { name: card })
    for (const row of ['記録される名前', 'お客様の情報', '暗証番号']) {
      await expect(section.getByText(row, { exact: true })).toBeVisible()
    }
  }
  await expect(page.getByText('端末の名前：EYEX-iPad-07')).toBeVisible()
})

// @e2e-covers UC-TERM-02 AC-TERM-02
test('個人の端末では、本日休みのスタッフは押せず文字でも「本日休み」と出る', async ({ page }) => {
  // 誰が休みかを走らせた曜日に委ねない。本日の勤務を 佐藤 美咲 の 1 本だけにする。
  await page.route(
    (url) => url.pathname.endsWith('/staff-shifts'),
    async (route) => {
      const response = await route.fetch()
      const shifts = (await response.json()) as { staffId: string }[]
      await route.fulfill({
        response,
        json: shifts.filter((shift) => shift.staffId === SATO),
      })
    },
  )
  await openStart(page)
  await page.getByRole('button', { name: '個人の端末にする' }).click()
  await expect(
    page.getByRole('heading', { name: '業務を始めるスタッフを選んでください' }),
  ).toBeVisible()
  const off = page.getByRole('button', { name: /高橋 健/ })
  await expect(off).toBeDisabled()
  await expect(off).toContainText('本日休み')
  await expect(page.getByRole('button', { name: /佐藤 美咲/ })).toBeEnabled()
})

// @e2e-covers UC-TERM-03 AC-TERM-03
test('個人の端末は 4 桁を入れると確定でき、左の柱に「佐藤 美咲の iPad」が出る', async ({
  page,
}) => {
  await openStaffPin(page, '佐藤 美咲')
  const submit = page.getByRole('button', { name: '確定' })
  for (const digit of STAFF_PIN.slice(0, 3)) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await expect(submit).toBeDisabled()
  await page.getByRole('button', { name: STAFF_PIN[3] as string, exact: true }).click()
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(sidebar(page)).toContainText('佐藤 美咲の iPad')
  await expect(sidebar(page)).toContainText('個人で使っています')
})

// @e2e-covers UC-TERM-05 AC-TERM-04
test('置き場所には状態が文字で添えられ、選ぶと線引きが読める', async ({ page }) => {
  await stubPlaces(page)
  await openStart(page)
  await page.getByRole('button', { name: 'みんなで使う端末にする' }).click()
  await expect(page.getByRole('heading', { name: 'この端末はどこに置きますか？' })).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(RECEPTION_IPAD) })).toContainText(
    '業務中',
  )
  await expect(page.getByRole('button', { name: new RegExp(EXAM_IPAD) })).toContainText(
    'つながっていません',
  )
  await page.getByRole('button', { name: new RegExp(CHECKOUT_IPAD) }).click()
  await expect(page.getByRole('button', { name: new RegExp(CHECKOUT_IPAD) })).toContainText(
    'まだ誰も使っていません',
  )
  await page.getByRole('button', { name: 'この置き場所で始める' }).click()
  await expect(page.getByRole('list', { name: '個人を選ばずにできる' })).toContainText(
    '予約を受ける',
  )
  await expect(page.getByRole('list', { name: 'ご本人の確認が必要' })).toContainText('録音の保全')
})

// @e2e-covers UC-TERM-06 AC-TERM-05
test('共有端末は店舗の暗証番号で始まり、左の柱に置き場所と「共有で使っています」が出る', async ({
  page,
}) => {
  await startShared(page)
  await expect(sidebar(page)).toContainText(CHECKOUT_IPAD)
  await expect(sidebar(page)).toContainText('共有で使っています')
})

// @e2e-covers UC-TERM-04 AC-TERM-06
test('暗証番号を 1 回間違えると、残りの回数と続けたときに起きることと直し方が同じ画面に出る', async ({
  page,
}) => {
  await openStaffPin(page, '高橋 健')
  await enterPin(page, WRONG_PIN)
  await expect(
    page.getByRole('heading', { name: '暗証番号が違います。あと2回お試しいただけます' }),
  ).toBeVisible()
  await expect(page.getByText('3回続くと、30秒お待ちいただきます。')).toBeVisible()
  // 入力欄は空になる（「はじめから打ち直してください」が 6 枠の見出しになる）。
  await expect(page.getByText('暗証番号　はじめから打ち直してください')).toBeVisible()
  await expect(page.getByRole('button', { name: '店長に暗証番号の再設定を頼む' })).toBeVisible()
})

// @e2e-covers AC-TERM-07
test('3 回続けて間違えると 30 秒待つことが文字で出て、そのあいだは確定できない', async ({
  page,
}) => {
  await openStaffPin(page, '小林 学')
  for (let attempt = 0; attempt < 3; attempt += 1) await enterPin(page, WRONG_PIN)
  await expect(page.getByRole('heading', { name: '暗証番号を3回続けて間違えました' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('秒お待ちください')
  for (const digit of STAFF_PIN) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await expect(page.getByRole('button', { name: '確定' })).toBeDisabled()
  await expect(sidebar(page)).toHaveCount(0)
})

// @e2e-covers UC-TERM-07 AC-TERM-08
test('共有モードのまま予約を確定でき、その受付履歴に端末の名前が残る', async ({
  page,
  request,
}) => {
  test.slow()
  await grant(request, ALL_PERMISSIONS)
  await startShared(page)
  await page.getByRole('button', { name: /新しい予約を取る/ }).click()

  await pickFirstOpenSlot(page)
  const next = page.locator('[data-booking-stepbar]').getByRole('button', { name: /^次へ進む/ })
  await next.click()
  await page.getByRole('button', { name: new RegExp(`^${ADJUST_LABEL}`) }).click()
  await next.click()
  await expect(page.getByRole('table', { name: 'ご予約を置く盤' })).toBeVisible()
  await clearClash(page)
  await next.click()
  await page.getByLabel('お名前').fill('保科 千尋')
  await page.getByLabel('ふりがな').fill('ほしな ちひろ')
  await next.click()
  // ここまで 1 度も個人ログインを求められない。
  await expect(page.getByRole('heading', { name: 'この文をそのまま読み上げます' })).toBeVisible()
  // 確定の応答をそのまま受け取る（この 1 件の id を、あとで経緯に突き合わせる）。
  const [created] = await Promise.all([
    page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname === '/api/staff/reservations' &&
        res.request().method() === 'POST',
    ),
    page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click(),
  ])
  const reservationId = ((await created.json()) as { id: string }).id
  await expect(page.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()

  /*
   * 受け付けた人（＝この端末）を、受付履歴が描くのと同じ 1 本
   * （`GET /api/staff/reservations/:id/history`）で確かめる。**一覧の面では見ない** ——
   * 受付履歴が読む窓は本日までで、工程 1 のカレンダーは走らせた日が定休だと
   * その日を押させないので、いま取れる枠は先の日になることがある
   * （その日の受付履歴の面から読み返せることは AC-TERM-15 が実データで見ている）。
   */
  const history = await request.get(
    `/api/staff/reservations/${reservationId}/history`,
    await authed(request),
  )
  expect(history.status()).toBe(200)
  const rows = (await history.json()) as { what: string; actorName: string | null }[]
  expect(rows.map((row) => row.what)).toContain('新しく受け付けました')
  expect(rows.map((row) => row.actorName)).toContain(CHECKOUT_IPAD)
})

// @e2e-covers UC-TERM-08 AC-TERM-09
test('共有モードで 2 分さわらないと、お名前と電話番号だけを伏せて覆う', async ({ page }) => {
  // seed のご予約が並ぶ日（2026年8月27日 11:08）へ端末の時計を据える。
  await page.clock.install({ time: new Date(LEDGER_NOW) })
  let apiCalls = 0
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.startsWith('/api/')) apiCalls += 1
  })
  await startShared(page)
  await goTo(page, '予約台帳')
  const board = page.getByRole('grid', { name: '予約台帳' })
  await expect(board).toBeVisible()
  await expect(board).toContainText('田中 花子')

  await page.clock.fastForward(121_000)
  await expect(page.getByRole('heading', { name: 'お客様の情報を隠しています' })).toBeVisible()
  await expect(
    page.getByText('2分間さわらなかったので伏せました。さわると元に戻ります。'),
  ).toBeVisible()
  // 伏せるのはお名前とお電話番号だけ。時刻は読めたまま。
  await expect(board).toContainText('●●●●')
  await expect(board).not.toContainText('田中 花子')
  await expect(board).toContainText('11:00')

  /*
   * **伏せているあいだは API を 1 本も叩かない**（決めごと）。時計をさらに進めても
   * 台帳の読み直しが起きないことを、実際に飛んだ要求の数で見る。
   */
  const whileLocked = apiCalls
  await page.clock.fastForward(60_000)
  await page.waitForTimeout(500)
  expect(apiCalls).toBe(whileLocked)

  await page.getByRole('button', { name: '画面にさわって続ける' }).click()
  await expect(page.getByRole('heading', { name: 'お客様の情報を隠しています' })).toHaveCount(0)
  // 表に戻った時点で読み直す（伏せていた間に止めた読み込みを取り戻す）。
  await expect(async () => expect(apiCalls).toBeGreaterThan(whileLocked)).toPass()
})

// @e2e-covers UC-TERM-09 AC-TERM-10
test('共有モードで録音の保全を始めると、ご本人の確認を求め、録音は消さない', async ({
  page,
  request,
}) => {
  await grant(request, ALL_PERMISSIONS)
  const recording = await storedRecording(request, slot(2))
  await startShared(page)
  await openRecordedEntry(page)
  await page.getByRole('button', { name: 'この録音を保全する' }).click()

  await expect(
    page.getByRole('heading', { name: '録音の保全にはご本人の確認が必要です' }),
  ).toBeVisible()
  await expect(page.getByText('操作するスタッフを選んでください。')).toBeVisible()
  await expect(page.getByRole('button', { name: /佐藤 美咲/ })).toBeVisible()
  expect(await recordingState(request, recording.id)).toBe('stored')
})

// @e2e-covers AC-TERM-11
test('暗証番号が通ると元の操作へ戻り、「いまは共有モード」が消えてその操作ができる', async ({
  page,
  request,
}) => {
  await grant(request, ALL_PERMISSIONS)
  const recording = await storedRecording(request, slot(3))
  await startShared(page)
  await openRecordedEntry(page)
  await page.getByRole('button', { name: 'この録音を保全する' }).click()
  await expect(page.getByText('いまは共有モード')).toBeVisible()

  await page.getByRole('button', { name: /佐藤 美咲/ }).click()
  await enterPin(page, STAFF_PIN)

  await expect(page.getByText('いまは共有モード')).toHaveCount(0)
  await expect(page.getByRole('main', { name: '受付履歴' })).toBeVisible()
  await expect(page.getByText('この録音を保全しました。期限が来ても消えません。')).toBeVisible()
  await expect(async () => {
    const res = await request.get('/api/staff/recordings', {
      ...(await authed(request)),
      params: { storeId: GINZA, limit: 200 },
    })
    const items = ((await res.json()) as { items: Recording[] }).items
    expect(items.find((row) => row.id === recording.id)?.legalHold).toBe(true)
  }).toPass()
})

// @e2e-covers UC-TERM-10 AC-TERM-12
test('個人モードは 2 分で共有モードへ戻り、同じ操作でもう一度確認を求める', async ({
  page,
  request,
}) => {
  await grant(request, ALL_PERMISSIONS)
  await storedRecording(request, slot(4))
  await storedRecording(request, slot(5))
  await page.clock.install()
  await startShared(page)
  await goTo(page, '受付履歴')
  await openRecordedEntry(page)
  await page.getByRole('button', { name: 'この録音を保全する' }).click()
  await page.getByRole('button', { name: /佐藤 美咲/ }).click()
  await enterPin(page, STAFF_PIN)
  await expect(page.getByText('この録音を保全しました。期限が来ても消えません。')).toBeVisible()

  // 個人モードの寿命（120 秒）を +1 秒だけ越える。同じだけ離席したことになるので、
  // 画面も伏せられる（AC-TERM-09）。さわって元に戻してから、同じ操作をもう一度始める。
  await page.clock.fastForward(121_000)
  await page.getByRole('button', { name: '画面にさわって続ける' }).click()
  await openRecordedEntry(page)
  await page.getByRole('button', { name: 'この録音を保全する' }).click()
  await expect(
    page.getByRole('heading', { name: '録音の保全にはご本人の確認が必要です' }),
  ).toBeVisible()
})

// @e2e-covers UC-TERM-11 AC-TERM-13
test('スタッフの権限で設定を保存すると、足りない権限と下書きと店長の暗証番号が同じ画面に出る', async ({
  page,
  request,
}) => {
  await grant(request, STAFF_PERMISSIONS)
  try {
    await startShared(page)
    await goTo(page, '設定')
    await page
      .getByRole('navigation', { name: '設定の項目' })
      .getByRole('button', { name: '営業時間', exact: true })
      .click()
    await page.getByLabel('開店').fill('09:00')
    await page.getByLabel('閉店').fill('20:00')
    await page.getByRole('button', { name: '保存', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'この操作は店長だけができます' })).toBeVisible()
    await expect(page.getByText('設定はまだ何も変わっていません。')).toBeVisible()
    // 「足りない権限」の見出しだけでなく、**足りている/足りないを言い分ける名前**まで読める。
    await expect(page.getByText('足りない権限')).toBeVisible()
    await expect(page.getByText('設定の変更', { exact: true })).toBeVisible()
    const draft = page.getByRole('list', { name: '下書きは残っています' })
    await expect(draft).toContainText('開店を 10:00 から 09:00 に変える')
    await expect(draft).toContainText('閉店を 19:00 から 20:00 に変える')
    await expect(page.getByRole('heading', { name: '店長の暗証番号で続ける' })).toBeVisible()
    // 依頼の受け取り先が決まるまで、押せて何も起きないボタンを置かない（Q-10）。
    await expect(page.getByRole('button', { name: /店長に依頼/ })).toHaveCount(0)
  } finally {
    await grant(request, ALL_PERMISSIONS)
  }
})

// @e2e-covers UC-TERM-12 AC-TERM-14
test('通信が切れても台帳は読めたままで、打ちかけの入力は消えない', async ({ page }) => {
  await page.clock.setFixedTime(new Date(LEDGER_NOW))
  await startShared(page)
  await openReservationList(page)

  await page.route(
    (url) => url.pathname === '/api/staff/ledger',
    async (route) => await route.abort('failed'),
  )
  await page.getByRole('button', { name: '次の日' }).click()
  const band = page.getByRole('status').filter({ hasText: '通信が切れています' })
  await expect(band.getByRole('heading', { name: '通信が切れています' })).toBeVisible()
  // 「いつ時点の内容か」と「次に自動で試す時刻」の 2 つが、帯の中で読める。
  await expect(band).toContainText(/\d{1,2}:\d{2} 現在/)
  await expect(band).toContainText(/\d{1,2}:\d{2} に自動でも試します/)
  // 止まるのは書くほうだけ、と文字で言い切る。
  await expect(band).toContainText('予約の確定・変更・ご来店の受付は、つながってからになります。')
  /*
   * 台帳は**中身まで**読めたまま（表の器だけ残って空にならない）。
   * お名前の欄は `007-customer-records` が入るまで「—」なので、
   * 最後に読めた 8月27日（木）のご予約が**行として**並んでいることで見る。
   */
  const table = page.getByRole('table', { name: '本日のご予約' })
  await expect(table).toBeVisible()
  const rows = table.locator('tbody tr')
  expect(await rows.count()).toBeGreaterThan(0)
  await expect(rows.first()).toContainText(/\d{1,2}:\d{2}/)
})

// @e2e-covers UC-TERM-13 AC-TERM-15
test('日時を変えた 1 件は、受付履歴の「そのあとの変更」から時系列で読み返せる', async ({
  page,
  request,
}) => {
  await grant(request, ALL_PERMISSIONS)
  const sessionId = await startReception(request)
  const before = slot(7)
  const after = slot(6)
  const reservation = await bookFrom(request, sessionId, before)
  await startShared(page)
  /*
   * 変更そのものは API で起こす（面の手順は `change.spec.ts` が見ている）。
   * ただし**端末の名乗りだけは実物と同じ**にする —— 監査の主体はこの名乗りで決まる。
   */
  const terminalSession = await terminalSessionId(page)
  const changed = await request.patch(`/api/staff/reservations/${reservation.id}`, {
    headers: {
      ...(await authed(request)).headers,
      'x-terminal-session': terminalSession,
    },
    data: { version: reservation.version, startsAt: at(after) },
  })
  expect(changed.status(), await changed.text()).toBe(200)

  const moved = page.getByText(`ご来店時刻を ${before} から ${after} へ`)
  await openEntryUntil(page, moved, '日時を変えたご予約')
  const changes = page.getByRole('list', { name: 'そのあとの変更' })
  await expect(changes).toContainText(`ご来店時刻を ${before} から ${after} へ`)
  await expect(changes).toContainText(CHECKOUT_IPAD)
  // 追記専用。書き直す操作も消す操作もこの面に無い。
  await expect(changes.getByRole('button')).toHaveCount(0)
})

// @e2e-covers UC-TERM-14 AC-TERM-16
test('お知らせは対応が必要とお知らせに分かれ、未読には札が付き、まとめて既読にできる', async ({
  page,
}) => {
  await stubAlerts(page)
  await startShared(page)
  await openAlerts(page)
  const rows = page.getByRole('list', { name: 'お知らせ' }).getByRole('listitem')
  await expect(rows).toHaveCount(3)
  // 対応が必要な 1 件が先頭に出る。
  await expect(rows.first()).toContainText('録音の保存に3回失敗しました')
  await expect(page.getByRole('button', { name: 'アラート（対応が必要） 1件' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'お知らせ 2件' })).toBeVisible()
  // 未読は左の赤い縦罫だけでなく「未読」の札でも示す。
  await expect(page.getByText('未読', { exact: true })).toHaveCount(3)

  await page.getByRole('button', { name: 'すべて既読にする' }).click()
  await expect(page.getByText('未読', { exact: true })).toHaveCount(0)
})

// @e2e-covers AC-TERM-17
test('裏に回ったまま 2 分を越えて表へ戻ると、戻った時点でもう伏せられている', async ({ page }) => {
  await page.clock.install()
  await startShared(page)
  await expect(sidebar(page)).toBeVisible()
  /*
   * **経過を数えるタイマーには頼らない。**`setSystemTime` は時計だけを進めて
   * タイマーを 1 つも起こさないので、伏せたのが `visibilitychange` の判定である
   * ことがこの 1 本で分かる（裏タブでは時間の進みが絞られる）。
   */
  // まず**本当に裏へ回す**（`document.hidden` を立てて `visibilitychange` を出す）。
  await page.evaluate(
    `Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
     Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
     document.dispatchEvent(new Event('visibilitychange'))`,
  )
  const veil = page.getByRole('heading', { name: 'お客様の情報を隠しています' })
  await expect(veil).toHaveCount(0)

  await page.clock.setSystemTime(new Date(Date.now() + 121_000))
  // 時計だけが進んだ状態。タイマーは 1 つも起きていないので、まだ伏せられていない。
  await expect(veil).toHaveCount(0)

  // 表に戻す。**戻った時点で**もう伏せられている。
  await page.evaluate(
    `Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
     Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
     document.dispatchEvent(new Event('visibilitychange'))`,
  )
  await expect(veil).toBeVisible()
})

// @e2e-covers AC-TERM-18
test('お知らせの入口は「お知らせ 3件」と読まれ、柱をたたんでも変わらない', async ({ page }) => {
  await stubAlerts(page)
  await startShared(page)
  await expect(page.getByRole('button', { name: 'お知らせ 3件' })).toBeVisible()
  await openAlerts(page)
  await expect(sidebar(page).getByRole('button', { name: 'お知らせ 3件' })).toBeVisible()
  await page.getByRole('button', { name: 'サイドバーをたたむ' }).click()
  await expect(sidebar(page).getByRole('button', { name: 'お知らせ 3件' })).toBeVisible()
})

// @e2e-covers AC-TERM-19
test('3 桁しか入れていない「確定」は、押せない理由を一緒に読み上げる', async ({ page }) => {
  await openStaffPin(page, '佐藤 美咲')
  for (const digit of STAFF_PIN.slice(0, 3)) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  const submit = page.getByRole('button', { name: '確定' })
  await expect(submit).toBeDisabled()
  const hintId = await submit.getAttribute('aria-describedby')
  expect(hintId).not.toBeNull()
  await expect(page.locator(`#${hintId}`)).toHaveText('あと1桁で「確定」を押せます')
})

// @e2e-covers AC-TERM-20
test('共有端末の入力欄はすべて autocomplete="off" で、前のお客様の値を候補に出さない', async ({
  page,
}) => {
  await startShared(page)
  await page.getByRole('button', { name: /新しい予約を取る/ }).click()
  await pickFirstOpenSlot(page)
  const next = page.locator('[data-booking-stepbar]').getByRole('button', { name: /^次へ進む/ })
  await next.click()
  await page.getByRole('button', { name: new RegExp(`^${ADJUST_LABEL}`) }).click()
  await next.click()
  await expect(page.getByRole('table', { name: 'ご予約を置く盤' })).toBeVisible()
  await clearClash(page)
  await next.click()
  await expect(page.getByRole('heading', { name: 'お電話番号を伺えますか？' })).toBeVisible()

  const inputs = page.locator('input')
  const total = await inputs.count()
  expect(total).toBeGreaterThan(0)
  for (let index = 0; index < total; index += 1) {
    expect(await inputs.nth(index).getAttribute('autocomplete')).toBe('off')
  }
})

// @e2e-covers AC-TERM-21
test('共有端末の「使い方を変える」から、個人の端末として選び直せる', async ({ page }) => {
  await openStart(page)
  await page.getByRole('button', { name: 'みんなで使う端末にする' }).click()
  await expect(page.getByRole('heading', { name: 'この端末はどこに置きますか？' })).toBeVisible()
  await page.getByRole('button', { name: '使い方を変える' }).click()
  await expect(
    page.getByRole('heading', { name: 'この iPad の使い方を決めてください' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '個人の端末にする' }).click()
  await expect(
    page.getByRole('heading', { name: '業務を始めるスタッフを選んでください' }),
  ).toBeVisible()
})

// @e2e-covers UC-TERM-15 AC-TERM-22
test('「もう一度送る」が通ったお知らせは、その場で対応済みになって一覧から外れる', async ({
  page,
  request,
}) => {
  await grant(request, ALL_PERMISSIONS)
  const failed = await failedRecording(request, slot(8))
  const resolvedBefore = await alertCounts(request, 'resolved')
  await startShared(page)
  await openAlerts(page)
  const row = page
    .getByRole('list', { name: 'お知らせ' })
    .getByRole('listitem')
    .filter({ hasText: '録音の保存に3回失敗しました' })
    .first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'もう一度送る' }).click()

  /*
   * この盤面には `recording.spec.ts` が立てたお知らせも残っているので、
   * 「0 件になる」ではなく**この 1 件が外れて対応済みが 1 増える**ことを見る。
   */
  await expect(
    page
      .getByRole('list', { name: 'お知らせ' })
      .getByRole('listitem')
      .filter({ hasText: failed.code }),
  ).toHaveCount(0)
  await expect(async () => {
    expect(await alertCounts(request, 'resolved')).toBe(resolvedBefore + 1)
  }).toPass()
})

// @e2e-covers UC-TERM-16
test('店長は「設定 › 端末の設定」で、端末の一覧と直す欄を開ける', async ({ page, request }) => {
  await grant(request, ALL_PERMISSIONS)
  await startShared(page)
  await goTo(page, '設定')
  await page
    .getByRole('navigation', { name: '設定の項目' })
    .getByRole('button', { name: '端末の設定', exact: true })
    .click()
  const list = page.getByRole('list', { name: '端末' })
  await expect(list).toContainText(CHECKOUT_IPAD)
  await expect(list).toContainText('120秒でふせる')
  await page.getByRole('button', { name: `${CHECKOUT_IPAD} を直す` }).click()
  const form = page.getByRole('region', { name: `${CHECKOUT_IPAD} を直す` })
  await expect(form.getByLabel('自動で伏せるまで（秒）')).toHaveValue('120')
  await expect(form.getByLabel('新しい暗証番号（4〜6桁）')).toHaveValue('')
})

/* --- お知らせ 3 件（モックが描いている盤面） ------------------------------- */

/**
 * ALERTS の 3 行を、走らせた順に左右されない形で置く。**盤面には触らない** ——
 * ここで見るのは分け方・並び・未読の示し方で、立て方は `010-recording` /
 * `011-web-booking` の e2e が実データで見ている。
 */
async function stubAlerts(page: Page): Promise<void> {
  const occurredAt = (clock: string) =>
    new Date(Date.parse(`2026-08-27T${clock}:00.000+09:00`)).toISOString()
  const items = [
    {
      id: '99990000-0000-4000-8000-000000000001',
      code: 'recording.upload_failed',
      severity: 'action',
      audience: 'store',
      title: '録音の保存に3回失敗しました',
      body: 'RC-260827-0001　ご予約は成立しています。',
      targetType: 'recording',
      targetId: null,
      occurredAt: occurredAt('11:02'),
      readAt: null,
      resolvedAt: null,
      resolvedBy: null,
    },
    {
      id: '99990000-0000-4000-8000-000000000002',
      code: 'web_booking.pending',
      severity: 'info',
      audience: 'store',
      title: 'Web予約が 1 件届いています',
      body: '9月18日（金）14:00　中井 さくら 様',
      targetType: 'reservation',
      targetId: null,
      occurredAt: occurredAt('10:41'),
      readAt: null,
      resolvedAt: null,
      resolvedBy: null,
    },
    {
      id: '99990000-0000-4000-8000-000000000003',
      code: 'equipment.maintenance_scheduled',
      severity: 'info',
      audience: 'store',
      title: '視力測定機 A の点検が近づいています',
      body: '9月1日（火）10:00–12:00',
      targetType: 'equipment',
      targetId: null,
      occurredAt: occurredAt('09:15'),
      readAt: null,
      resolvedAt: null,
      resolvedBy: null,
    },
  ]
  await page.route(
    (url) => url.pathname === '/api/staff/alerts',
    async (route) => {
      const kind = new URL(route.request().url()).searchParams.get('kind') ?? 'all'
      const shown =
        kind === 'action'
          ? items.filter((item) => item.severity === 'action')
          : kind === 'info'
            ? items.filter((item) => item.severity === 'info')
            : kind === 'resolved'
              ? []
              : items
      await route.fulfill({
        json: {
          items: shown,
          nextCursor: null,
          total: shown.length,
          counts: { all: 3, action: 1, info: 2, resolved: 0 },
        },
      })
    },
  )
}
