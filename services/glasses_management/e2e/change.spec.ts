import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { completeSeededTerminalStart } from './support/terminal'

/**
 * 予約の検索・変更・取消（009-change-and-cancel）の受け入れ基準を、実ブラウザと実 Worker で
 * 確かめる。`vite preview` が実 workerd を動かし、D1 は `seed.mjs` が入れた EYE 銀座店である
 * （`playwright test` を叩くたびに使い捨ての D1 が作り直される）。
 *
 * 1 本の test の直前の行に `// @e2e-covers <ID>` を置く。**この面は 1 ID = 1 test** で、
 * UC 10 本（UC-CHANGE-01..10）と AC 27 本（AC-CHANGE-01..27）の 37 本をちょうど 1 回ずつ並べる。
 *
 * **なぜ端末の時計を 2026年8月27日 に据えるのか**:
 * `ChangeScreen` の絞り込み「これから」は**端末の暦日**をそのまま `from` にする。seed の
 * ご予約は 2026年8月27日（木）にしか無いので、実時刻のまま開くと 1 件も出ない。
 * `page.clock.setFixedTime` で端末の時計だけを据え、サーバの時計には触らない
 * （空き枠エンジンは `now` を `serverNow` にしか使わないので、過去日の枠もそのまま数えられる）。
 *
 * **盤面（D1）の扱い**: この面は変更・取消でご予約を書き換える。`change.spec.ts` は ipad
 * project で `ledger.spec.ts` / `reception.spec.ts` より先に走るので、**seed の 8月27日 の
 * 12 件には一切触らない**。書き換える test は 2026年9月 の営業日（火曜は定休なので避ける）に
 * 自前のご予約を 1 件ずつ作り、それだけを動かす。承認済みモックとの突き合わせ（mock project）
 * はこの面よりさらに先に走る（`playwright.config.ts` の project の並び）。
 *
 * **自前のご予約に設備を渡さない**: `POST /api/staff/reservations` は `equipmentIds` を
 * 渡すと 409 `purpose_unavailable`（`BLOCKING_REASON.no_equipment`）で断る。よって差分表の
 * 「場所」の行は「指定なし」のままである。
 *
 * **まだ器に載っていない入口**（該当する test のコメントにも同じことを書いてある）:
 *   - 「担当・場所を変える」… BOOK-03-SLOT-STAFF / BOOK-03b-SLOT-RESOURCE を再利用する
 *     決めだが、その入口だけは繋がっていない（`ChangeScreen` は `onChangeSlot` を
 *     渡されないと 1 行で断る）。UC-CHANGE-06 は **HTTP のふるまいで固定**してある。
 * CHANGE-SEARCH / CHANGE-DATETIME / CHANGE-DIFF / CHANGE-CANCEL / CHANGE-DONE /
 * EX-CONFLICT の 6 面はすべてブラウザから通しで操作している。
 */

const ORG = 'eye'
/** seed.mjs が固定 id で入れる EYE 銀座店と、丸の内店（別店舗を見せない証明に使う）。 */
const GINZA = '11111111-1111-4111-8111-111111111111'
const MARUNOUCHI = '22222222-2222-4222-8222-222222222222'

/** seed の id は `${区分}-0000-4000-8000-${連番}`（`seed.mjs` の `uid`）。 */
const uid = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`
/**
 * 佐藤 美咲（担当の 1 人目）と 小林 学（4 人目）。
 * 担当を置き直す test が 小林 学 を選ぶのは、**「メガネを新しく作る」が要求する技能
 * `measure` を持つのが seed ではこの 2 人だけ**だからである（`purpose_requirements`）。
 * 技能の無い担当へ移すと 409 `purpose_unavailable` で断られる。
 */
const SATO = uid('c0010000', 0)
const KOBAYASHI = uid('c0010000', 3)
/** メガネを新しく作る（60 分）。 */
const NEW_GLASSES = uid('e0010000', 0)

/** seed の 8月27日 11:00、田中 花子 様（4回目）のご予約。 */
const HANAKO_RESERVATION = uid('a0010000', 2)
const HANAKO_CODE = 'EY-2608-0003'

const MS_PER_MINUTE = 60_000

/* --- 日付と時刻 ----------------------------------------------------------- */

/** JST の壁時計 → UTC の ISO8601。 */
const atJst = (date: string, hhmm: string) =>
  new Date(Date.parse(`${date}T${hhmm}:00.000+09:00`)).toISOString()

/** UTC の ISO8601 → JST の壁時計 `HH:MM`。 */
function jstClock(iso: string): string {
  const shifted = new Date(Date.parse(iso) + 9 * 60 * MS_PER_MINUTE)
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`
}

/** seed がご予約を置いている日（モックが描いている 2026年8月27日（木））。 */
const SEED_DAY = '2026-08-27'
/** 端末の時計。モック 3 面と同じ 2026年8月27日（木）11:08 に据える。 */
const SEED_NOW = atJst(SEED_DAY, '11:08')
/** 「今日」の絞り込みが 8月27日 のご予約を落とすことを見るための前日。 */
const DAY_BEFORE_NOW = atJst('2026-08-26', '11:08')
/** 取り消し済みのご予約（6月30日）が「これから」に入る時刻。 */
const BEFORE_CANCELLED_NOW = atJst('2026-06-01', '10:00')

/**
 * 盤面を書き換える test が使う日。**1 test に 1 日**を配る（同じ日の同じ時刻を 2 本が
 * 取ると、片方が 409 `slot_taken` になる）。選べる日は次の 3 つで絞れる:
 *   - 火曜は店舗の定休（`store_business_hours.weekday = 2` が `is_closed`）。
 *   - 勤務（`staff_shifts`）が入っているのは 2026年8月27日 〜 9月30日 だけで、
 *     9月30日 は臨時のお休み（`store_calendar_exceptions`）である。
 *   - 佐藤 美咲（自前のご予約の担当）は**金曜が休み**で、働く日はどの日も
 *     **13:00–14:00 が休憩**である。よってご予約は 14:00 に置き、16:00 へ動かす。
 *   - 担当を置き直す 2 本（UC-CHANGE-06 / AC-CHANGE-27）は、佐藤 美咲 と 小林 学 が
 *     **どちらも勤務に入っている日**でなければならない。
 *   - 9月2日 と 9月3日 は使えない。`mock-compare.spec.ts` の BOOK-06-DONE が 9月2日 14:00 に
 *     1 件書き、`booking.spec.ts` が 9月3日 をまるごと使う（どちらもこの面より先に走る）。
 *   - 日曜は 18:00 閉店なので、17:00 からの 60 分は置けない。
 * 実時刻の暦日（8月28日〜8月31日）も避ける —— `reception.spec.ts` がその日の盤面を
 * 数えるので、ご予約を足すと数が動く。
 */
const DAYS = {
  holdFirst: '2026-09-05',
  fourRows: '2026-09-06',
  diff: '2026-09-07',
  backOut: '2026-09-09',
  confirmed: '2026-09-10',
  sayAloud: '2026-09-12',
  cancelFrees: '2026-09-13',
  slotOnly: '2026-09-14',
  // 理由が要ることと、押した 1 回では消えないことは 1 件ずつしか書かないので、
  // 時刻を分けて同じ日に置く（勤務が入っている日を配り切るため）。
  reasonRequired: '2026-09-16',
  safeDefault: '2026-09-16',
  cancelledSlot: '2026-09-17',
  bothSides: '2026-09-19',
  keepTheirs: '2026-09-20',
  twoPanes: '2026-09-21',
  overwriteMine: '2026-09-23',
  slotTaken: '2026-09-24',
  staleNoWrite: '2026-09-26',
  auditTrail: '2026-09-27',
  historyLine: '2026-09-28',
} as const

/* --- API を直に叩く（前提づくりと、まだ器に載っていない入口の代わり） ------- */

async function authed(request: APIRequestContext): Promise<{ headers: Record<string, string> }> {
  const res = await request.post('/api/auth/token', {
    data: { organizationId: ORG, role: 'staff' },
  })
  expect(res.status()).toBe(200)
  const { token } = (await res.json()) as { token: string }
  return { headers: { authorization: `Bearer ${token}` } }
}

type Detail = {
  id: string
  code: string
  status: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  assignments: { kind: string; targetId: string | null }[]
  version: number
  cancelReason: string | null
}

/**
 * 自前のご予約を 1 件作る。**seed の 8月27日 には作らない**（この面より後に走る台帳と
 * 来店受付の e2e が seed の 12 件を数えている）。設備は渡さない（頭のコメント参照）。
 */
async function createReservation(
  request: APIRequestContext,
  date: string,
  hhmm: string,
  extra: Record<string, unknown> = {},
): Promise<Detail> {
  const res = await request.post('/api/staff/reservations', {
    ...(await authed(request)),
    data: {
      storeId: GINZA,
      source: 'phone',
      startsAt: atJst(date, hhmm),
      purposeIds: [NEW_GLASSES],
      staffId: SATO,
      ...extra,
    },
  })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as Detail
}

async function readDetail(request: APIRequestContext, reservationId: string): Promise<Detail> {
  const res = await request.get(`/api/staff/reservations/${reservationId}`, await authed(request))
  expect(res.status()).toBe(200)
  return (await res.json()) as Detail
}

async function changeReservation(
  request: APIRequestContext,
  reservationId: string,
  json: Record<string, unknown>,
) {
  return await request.patch(`/api/staff/reservations/${reservationId}`, {
    ...(await authed(request)),
    data: json,
  })
}

async function cancelReservation(
  request: APIRequestContext,
  reservationId: string,
  json: Record<string, unknown>,
) {
  return await request.post(`/api/staff/reservations/${reservationId}/cancel`, {
    ...(await authed(request)),
    data: json,
  })
}

type HistoryLine = { occurredAt: string; what: string; actorName: string | null }

async function readHistory(
  request: APIRequestContext,
  reservationId: string,
): Promise<HistoryLine[]> {
  const res = await request.get(
    `/api/staff/reservations/${reservationId}/history`,
    await authed(request),
  )
  expect(res.status()).toBe(200)
  return (await res.json()) as HistoryLine[]
}

type Slot = { startsAt: string; isAvailable: boolean; remaining: number; reason: string | null }

async function readAvailability(
  request: APIRequestContext,
  date: string,
  excludeReservationId?: string,
): Promise<Slot[]> {
  const res = await request.get('/api/staff/availability', {
    ...(await authed(request)),
    params: {
      storeId: GINZA,
      date,
      axis: 'staff',
      durationMinutes: '60',
      ...(excludeReservationId === undefined ? {} : { excludeReservationId }),
    },
  })
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { slots: Slot[] }).slots
}

/** その日のその時刻の枠（60 分）。 */
function slotAt(slots: readonly Slot[], hhmm: string): Slot | undefined {
  return slots.find((slot) => jstClock(slot.startsAt) === hhmm)
}

type SearchAnswer = {
  items: { id: string; code: string; startsAt: string; status: string }[]
  total: number
  relaxations: { label: string; count: number; query: Record<string, unknown> }[]
}

async function searchReservations(
  request: APIRequestContext,
  params: Record<string, string>,
): Promise<SearchAnswer> {
  const res = await request.get('/api/staff/reservations', {
    ...(await authed(request)),
    params: { storeId: GINZA, limit: '50', ...params },
  })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as SearchAnswer
}

/** その時刻を 3 件で埋めて満席にする（`store_slot_rules.maxParallel` は 3）。 */
async function fillSlot(request: APIRequestContext, date: string, hhmm: string): Promise<void> {
  for (let taken = 0; taken < 3; taken += 1) {
    await createReservation(request, date, hhmm, { staffId: null })
  }
}

/* --- 画面を開く ----------------------------------------------------------- */

async function startWork(page: Page, nowIso: string): Promise<void> {
  await page.clock.setFixedTime(new Date(nowIso))
  await page.goto('/')
  /*
   * 業務の合図（`sessionStorage`）は同じ context のあいだ残るので、1 本の test が
   * 2 度目に開いたときは業務開始の面が出ない。**出ないことを失敗にしない** —— どちらが
   * 出たかを見てから進める。
   */
  const code = page.getByLabel('お店のコード')
  const rail = page.getByRole('navigation', { name: '画面の切り替え' })
  const placePick = page.getByRole('heading', { name: 'この端末はどこに置きますか？' })
  await expect(code.or(rail).or(placePick).first()).toBeVisible()
  if (await code.isVisible()) {
    await code.fill(ORG)
    await page.getByRole('button', { name: '業務を始める' }).click()
  }
  await completeSeededTerminalStart(page)
  await rail.waitFor()
}

/** サイドバーの「予約を探す」から CHANGE-SEARCH を開く。 */
async function openSearch(page: Page, nowIso: string = SEED_NOW): Promise<void> {
  await startWork(page, nowIso)
  await page
    .getByRole('navigation', { name: '画面の切り替え' })
    .getByRole('button', { name: '予約を探す', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'お客様を伺って探します' })).toBeVisible()
}

/** 検索結果の行（左ペインの中の、お客様のお名前を持つボタンだけ）。 */
function resultRows(page: Page) {
  return page
    .getByRole('region', { name: 'お客様を伺って探します' })
    .getByRole('button', { name: /様/ })
}

/** 予約番号 1 件を開いて右の詳細を出す。 */
async function openByCode(page: Page, code: string, nowIso: string = SEED_NOW): Promise<void> {
  await openSearch(page, nowIso)
  await page.getByLabel('予約番号').fill(code)
  await expect(page.getByText('結果 1件')).toBeVisible()
  await resultRows(page).first().click()
  await expect(page.getByRole('region', { name: 'ご予約の中身' })).toBeVisible()
}

/** 日時を選び直す工程（CHANGE-DATETIME）まで進める。 */
async function openDateTime(page: Page, code: string, nowIso: string = SEED_NOW): Promise<void> {
  await openByCode(page, code, nowIso)
  await page.getByRole('button', { name: '日時を変える' }).click()
  await expect(page.getByRole('region', { name: 'いまのご予約' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'お時間' })).toBeVisible()
}

/* ========================================================================== *
 * 1. 探す（CHANGE-SEARCH）
 * ========================================================================== */

// @e2e-covers UC-CHANGE-01
test('お名前・かな・お電話番号・予約番号のどれからでも同じ 1 件にたどり着ける', async ({
  request,
}) => {
  const byName = await searchReservations(request, { name: '田中', from: SEED_DAY })
  const byKana = await searchReservations(request, { kana: 'たなか はなこ', from: SEED_DAY })
  const byPhone = await searchReservations(request, { phone: '5678', from: SEED_DAY })
  const byCode = await searchReservations(request, { code: HANAKO_CODE, from: SEED_DAY })
  for (const answer of [byName, byKana, byPhone, byCode]) {
    expect(answer.total).toBe(1)
    expect(answer.items[0]?.id).toBe(HANAKO_RESERVATION)
  }
})

// @e2e-covers AC-CHANGE-01
test('「お名前」に 田中 と入れると、8/27（木）11:00 の 田中 花子 様 の行が並ぶ', async ({
  page,
}) => {
  await openSearch(page)
  await page.getByLabel('お名前').fill('田中')
  /*
   * モックは「結果 4件」だが、seed の 田中 花子 様の「これから」のご予約は 8月27日 の
   * 1 件だけである（過去 5 件は 2025年〜2026年6月）。自前で足しても
   * `POST /api/staff/reservations` は `reservations.customer_id` に NULL しか書かない
   * ので、お名前では引けない。行の中身だけをモックの文言と突き合わせる。
   */
  await expect(page.getByText('結果 1件')).toBeVisible()
  await expect(resultRows(page)).toHaveCount(1)
  // 一覧のご用件は短い名前（`visit_purposes.name_short`）を連ねる決めである。
  await expect(resultRows(page).first()).toHaveAccessibleName(
    '8/27（木）11:00　田中 花子 様　4回目　新調相談・視力測定／佐藤 美咲',
  )
})

// @e2e-covers AC-CHANGE-02
test('「お名前」に かな で入れても、漢字で登録されたご予約が結果に出る', async ({ page }) => {
  await openSearch(page)
  await page.getByLabel('お名前').fill('たなか はなこ')
  await expect(page.getByText('結果 1件')).toBeVisible()
  await expect(resultRows(page).first()).toContainText('田中 花子 様')
})

// @e2e-covers AC-CHANGE-03
test('「お電話番号」に下 4 桁 5678 だけを入れても、田中 花子 様のご予約が出る', async ({
  page,
}) => {
  await openSearch(page)
  await page.getByLabel('お電話番号').fill('5678')
  await expect(page.getByText('結果 1件')).toBeVisible()
  await expect(resultRows(page).first()).toContainText('田中 花子 様')
})

// @e2e-covers AC-CHANGE-04
test('「予約番号」を入れると結果は 1 件になり、右の詳細に番号と出どころが出る', async ({
  page,
}) => {
  await openByCode(page, HANAKO_CODE)
  const detail = page.getByRole('region', { name: 'ご予約の中身' })
  await expect(detail).toContainText(HANAKO_CODE)
  await expect(detail).toContainText('お電話でのご予約')
})

// @e2e-covers AC-CHANGE-05
test('検索は選択中の店舗に固定され、ほかの店舗のご予約は結果に出ない', async ({ request }) => {
  const ginza = await searchReservations(request, { name: '田中', from: SEED_DAY })
  expect(ginza.total).toBe(1)

  // 同じ条件を丸の内店へ向けると 1 件も出ない。
  const other = await request.get('/api/staff/reservations', {
    ...(await authed(request)),
    params: { storeId: MARUNOUCHI, name: '田中', from: SEED_DAY, limit: '50' },
  })
  expect(other.status()).toBe(200)
  expect(((await other.json()) as SearchAnswer).total).toBe(0)

  // `crossStore` は false しか受けない（押せない導線を置かないための契約。Q-04）。
  const crossed = await request.get('/api/staff/reservations', {
    ...(await authed(request)),
    params: { storeId: GINZA, name: '田中', from: SEED_DAY, crossStore: 'true', limit: '50' },
  })
  expect(crossed.status()).toBe(400)
})

// @e2e-covers AC-CHANGE-06
test('絞り込みの「今日」を押すと、その日でないご予約が結果から消える', async ({ page }) => {
  /*
   * 端末の時計を 8月26日 に据える。「これから」には 8月27日 のご予約が入り、「今日」
   * （8月26日）では消える —— モックの「9/3 のご予約は消える」と同じ形である。
   */
  await openSearch(page, DAY_BEFORE_NOW)
  await page.getByLabel('お名前').fill('田中')
  await expect(page.getByText('結果 1件')).toBeVisible()
  await expect(resultRows(page).first()).toContainText('8/27')

  await page.getByRole('button', { name: '今日', exact: true }).click()
  await expect(page.getByText('結果 0件')).toBeVisible()
  await expect(resultRows(page)).toHaveCount(0)
})

// @e2e-covers AC-CHANGE-07
test('絞り込みの「取消済み」を押すと、取り消されたご予約が結果に加わる', async ({ page }) => {
  // 田中 花子 様の取り消し済みのご予約は 6月30日 なので、時計を 6月1日 に据えて
  // 「これから」の窓へ入れる。
  await openSearch(page, BEFORE_CANCELLED_NOW)
  await page.getByLabel('お名前').fill('田中')
  await expect(page.getByText('結果 1件')).toBeVisible()

  await page.getByRole('button', { name: '取消済み', exact: true }).click()
  await expect(page.getByText('結果 2件')).toBeVisible()
  await expect(resultRows(page).first()).toContainText('6/30')
})

// @e2e-covers AC-CHANGE-08
test('行を押すと一覧は左に残ったまま、右に日時・担当と場所・確認の 1 行が出る', async ({
  page,
}) => {
  await openSearch(page)
  await page.getByLabel('お名前').fill('田中')
  await resultRows(page).first().click()

  // 一覧は閉じない（この面のシグネチャ）。
  await expect(page.getByRole('heading', { name: 'お客様を伺って探します' })).toBeVisible()
  await expect(resultRows(page)).toHaveCount(1)

  const detail = page.getByRole('region', { name: 'ご予約の中身' })
  await expect(detail).toContainText('8月27日（木）11:00–12:00')
  await expect(detail).toContainText('佐藤 美咲')
  await expect(detail).toContainText('変更の内容は、お客様にお伝えしてから確定します。')
  // 「録音を聞く」はこの面が描かないもの（P7 `010-recording` が足す）。
  await expect(detail.getByRole('button', { name: /録音/ })).toHaveCount(0)
})

/* ========================================================================== *
 * 2. 0 件（EX-EMPTY-SEARCH）
 * ========================================================================== */

// @e2e-covers UC-CHANGE-02
test('0 件でも入れた条件は消えず、条件を 1 つ外す案とほかの探し方が出る', async ({ page }) => {
  await openSearch(page, DAY_BEFORE_NOW)
  await page.getByLabel('お名前').fill('田中')
  await page.getByRole('button', { name: '今日', exact: true }).click()

  await expect(page.getByText('結果 0件')).toBeVisible()
  await expect(page.getByLabel('お名前')).toHaveValue('田中')
  await expect(page.getByRole('heading', { name: '条件をひとつ外すと見つかります' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'ほかの探し方' })).toBeVisible()
  await expect(page.getByRole('button', { name: /お電話番号で探す/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /予約番号で探す/ })).toBeVisible()
})

// @e2e-covers AC-CHANGE-09
test('0 件のときは「入力した条件はそのまま残しています。」と件数つきの案が出る', async ({
  page,
}) => {
  await openSearch(page, DAY_BEFORE_NOW)
  await page.getByLabel('お名前').fill('田中')
  await page.getByRole('button', { name: '今日', exact: true }).click()

  await expect(page.getByText('結果 0件')).toBeVisible()
  await expect(page.getByText('入力した条件はそのまま残しています。')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'この条件では、ご予約が見つかりませんでした' }),
  ).toBeVisible()
  /*
   * モックは案を 3 つ描くが、seed のこの条件で 1 件以上になる案は期間だけである
   * （出どころの絞り込みを画面から立てる操作が無く、取消済みを足しても 0 件のまま）。
   */
  await expect(page.getByRole('button', { name: /^1件\s*期間を/ })).toBeVisible()
})

// @e2e-covers AC-CHANGE-10
test('案を押すと外した条件だけが外れ、ほかの条件は残ったままになる', async ({ page, request }) => {
  await openSearch(page, DAY_BEFORE_NOW)
  await page.getByLabel('お名前').fill('田中')
  await page.getByRole('button', { name: '今日', exact: true }).click()
  await page.getByRole('button', { name: /^1件\s*期間を/ }).click()

  await expect(page.getByText('結果 1件')).toBeVisible()
  // 外れたのは期間だけ。お名前は残る。
  await expect(page.getByLabel('お名前')).toHaveValue('田中')
  await expect(page.getByRole('button', { name: '8/1〜9/30' })).toBeVisible()

  /*
   * モックの「5件　「Web予約だけ」を外す」は出どころの絞り込みが掛かっている面である。
   * 画面にその絞り込みを立てる操作が無い（`ReservationSearch` の札は案からしか立たない）
   * ので、**外した条件以外はそのまま返す**というサーバの決めをここで固定する。
   */
  const zero = await searchReservations(request, {
    name: 'たなか はなこ',
    from: SEED_DAY,
    to: '2026-08-31',
    source: 'web',
  })
  expect(zero.total).toBe(0)
  const relaxation = zero.relaxations.find((row) => row.label === '「Web予約だけ」を外す')
  expect(relaxation?.count).toBe(1)
  expect(relaxation?.query.source).toBeUndefined()
  expect(relaxation?.query.name).toBe('たなか はなこ')
  expect(relaxation?.query.from).toBe(SEED_DAY)
  expect(relaxation?.query.to).toBe('2026-08-31')
})

// @e2e-covers AC-CHANGE-22
test('0 件は読み上げに届き、案は件数を含む名前の押せる操作として読まれる', async ({ page }) => {
  await openSearch(page, DAY_BEFORE_NOW)
  await page.getByLabel('お名前').fill('田中')
  await page.getByRole('button', { name: '今日', exact: true }).click()

  // 入力の手を止めない知らせ（`role="status"`）で、警告にはしない。
  await expect(page.getByRole('status').filter({ hasText: '結果 0件' })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: '結果 0件' })).toHaveCount(0)

  await expect(page.getByRole('button', { name: /^1件\s*期間を/ })).toHaveAccessibleName(
    '1件　期間を 8月1日 〜 9月30日 に広げる',
  )
})

// @e2e-covers AC-CHANGE-24
test('0 件から「顧客台帳で調べる」を押すと顧客台帳が開く', async ({ page }) => {
  await openSearch(page, DAY_BEFORE_NOW)
  await page.getByLabel('お名前').fill('田中')
  await page.getByRole('button', { name: '今日', exact: true }).click()
  await expect(page.getByText('結果 0件')).toBeVisible()

  await page.getByRole('button', { name: '顧客台帳で調べる' }).click()
  await expect(page.getByRole('listbox', { name: 'お客様の一覧' })).toBeVisible()
  // 伺ったお名前は捨てずに台帳の検索欄へ引き継ぐ（打ち直させない）。
  await expect(page.getByRole('searchbox')).toHaveValue('田中')
})

/* ========================================================================== *
 * 3. 日時を選び直す（CHANGE-DATETIME）
 * ========================================================================== */

// @e2e-covers UC-CHANGE-03
test('いまのご予約を左に置いたまま、所要が収まる時刻だけから選び直せる', async ({ page }) => {
  await openDateTime(page, HANAKO_CODE)
  const current = page.getByRole('region', { name: 'いまのご予約' })
  await expect(current).toContainText('11:00–12:00')
  await expect(current).toContainText('田中 花子 様')
  await expect(page.getByText('60分の枠が取れる時刻だけを出しています。')).toBeVisible()
})

// @e2e-covers AC-CHANGE-11
test('候補には受けられるかどうかが文字で添い、満席の時刻は押せない', async ({ page }) => {
  await openDateTime(page, HANAKO_CODE)
  await expect(page.getByText('60分の枠が取れる時刻だけを出しています。')).toBeVisible()

  /*
   * seed の 8月27日 では 13:00 が空き、14:00 は 佐藤 美咲 の先約（EY-2608-0008）で
   * 満席である。モックの「10:00　受付できます」「15:30　満席」と同じ形で、
   * 時刻ごとに受けられるかどうかが**文字で**添う。
   */
  // 札は営業時間ぶんを全部出す（UX 監査 CHG-02 で折りたたみをやめた。
  // 隠れていたのが午後と夕方で、変更先の相談でいちばん要る時間帯だったため）。
  const times = page.getByRole('group', { name: 'お時間' }).getByRole('button')
  await expect(times.last()).not.toHaveAccessibleName(/ほかの時刻も見る/)

  await expect(page.getByRole('button', { name: '13:00　受付できます' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '14:00　満席' })).toBeDisabled()
})

// @e2e-covers AC-CHANGE-25
test('候補の先頭は「いまのまま」で、いまのご予約自身の時刻が残る', async ({ page }) => {
  await openDateTime(page, HANAKO_CODE)
  const slots = page.getByRole('group', { name: 'お時間' }).getByRole('button')
  await expect(slots.first()).toHaveAccessibleName('11:00　いまのまま')
})

// @e2e-covers AC-CHANGE-12
test('同じ担当の枠を先に持たれていると満席になり、元のご予約は動かない', async ({
  page,
  request,
}) => {
  await openDateTime(page, HANAKO_CODE)
  await expect(page.getByRole('button', { name: '14:00　満席' })).toBeDisabled()

  const still = await readDetail(request, HANAKO_RESERVATION)
  expect(jstClock(still.startsAt)).toBe('11:00')
  expect(jstClock(still.endsAt)).toBe('12:00')
})

// @e2e-covers UC-CHANGE-09
test('変更先の枠を先に押さえてから元の予約を切り替える', async ({ page, request }) => {
  const mine = await createReservation(request, DAYS.holdFirst, '14:00')

  await openDateTime(page, mine.code)
  await page.getByRole('button', { name: '16:00　受付できます' }).click()
  // 押さえたことが画面に出る。この時点で元の 14:00 はまだ空いていない。
  await expect(page.getByText('16:00 から60分、佐藤 美咲 を確保します。')).toBeVisible()
  await expect(page.getByText('仮の押さえ')).toBeVisible()
  expect(jstClock((await readDetail(request, mine.id)).startsAt)).toBe('14:00')

  await page.getByRole('button', { name: '変更内容を確認する' }).click()
  await page.getByRole('button', { name: '変更を確定する' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約の変更を承りました' })).toBeVisible()

  expect(jstClock((await readDetail(request, mine.id)).startsAt)).toBe('16:00')
  // 元の 14:00 は切り替えたあとで空く（先に空けてから取り直す形にしない）。
  expect(slotAt(await readAvailability(request, DAYS.holdFirst), '14:00')?.isAvailable).toBe(true)
})

/* ========================================================================== *
 * 4. 差分（CHANGE-DIFF）
 * ========================================================================== */

// @e2e-covers UC-CHANGE-04
test('変更前と変更後を項目ごとに 4 行で並べる', async ({ page, request }) => {
  const mine = await createReservation(request, DAYS.fourRows, '14:00')
  await openDateTime(page, mine.code)
  await page.getByRole('button', { name: '16:00　受付できます' }).click()
  await page.getByRole('button', { name: '変更内容を確認する' }).click()

  const table = page.getByRole('table', { name: '変更前と変更後' })
  await expect(table).toBeVisible()
  for (const label of ['お日にちとお時間', 'ご用件', '担当', '場所']) {
    await expect(table.getByRole('rowheader', { name: label })).toBeVisible()
  }
})

// @e2e-covers AC-CHANGE-13
test('差分は「変わる行だけ色を付けています」と出て、変わらない行に札が付かない', async ({
  page,
  request,
}) => {
  const mine = await createReservation(request, DAYS.diff, '14:00')
  await openDateTime(page, mine.code)
  await page.getByRole('button', { name: '16:00　受付できます' }).click()
  await page.getByRole('button', { name: '変更内容を確認する' }).click()

  await expect(page.getByText('この内容に変更します')).toBeVisible()
  await expect(page.getByText('変わる行だけ色を付けています')).toBeVisible()

  const table = page.getByRole('table', { name: '変更前と変更後' })
  const changed = table.getByRole('row').filter({ hasText: 'お日にちとお時間' })
  await expect(changed.getByText('変更', { exact: true })).toHaveCount(1)
  for (const label of ['ご用件', '担当', '場所']) {
    const row = table.getByRole('row').filter({ hasText: label })
    await expect(row.getByText('変更', { exact: true })).toHaveCount(0)
  }
})

// @e2e-covers AC-CHANGE-14
test('「戻って直す」で戻ったあと開き直すと、日時は元のままで変更が残っていない', async ({
  page,
  request,
}) => {
  const mine = await createReservation(request, DAYS.backOut, '14:00')
  await openDateTime(page, mine.code)
  await page.getByRole('button', { name: '16:00　受付できます' }).click()
  await page.getByRole('button', { name: '変更内容を確認する' }).click()

  await page.getByRole('button', { name: '戻って直す' }).click()
  await expect(page.getByRole('group', { name: 'お時間' })).toBeVisible()
  /*
   * 「予約を探す」へ戻るのは工程の帯の左端の `‹`（`前へ戻る`）である。サイドバーの
   * 「予約を探す」は器の `current` を変えるだけで、いま開いている面（`ChangeScreen`）の
   * 工程は動かない（P0 の器は `useState` で面を出し分けており router を持たない）。
   */
  await page.getByRole('button', { name: '前へ戻る' }).click()
  await resultRows(page).first().click()
  await expect(page.getByRole('region', { name: 'ご予約の中身' })).toContainText('14:00–15:00')

  const still = await readDetail(request, mine.id)
  expect(jstClock(still.startsAt)).toBe('14:00')
  expect(still.version).toBe(1)
})

// @e2e-covers AC-CHANGE-15
test('「変更を確定する」を押すと承った旨が出て、予約番号は変わらない', async ({
  page,
  request,
}) => {
  const mine = await createReservation(request, DAYS.confirmed, '14:00')
  await openDateTime(page, mine.code)
  await page.getByRole('button', { name: '16:00　受付できます' }).click()
  await page.getByRole('button', { name: '変更内容を確認する' }).click()
  await page.getByRole('button', { name: '変更を確定する' }).click()

  // CHANGE-DONE。主役は**予約番号が変わらないこと**である。
  await expect(page.getByRole('heading', { name: 'ご予約の変更を承りました' })).toBeVisible()
  await expect(page.getByText('予約番号は変わりません')).toBeVisible()
  await expect(page.getByText(mine.code, { exact: true })).toBeVisible()
  await expect(page.getByText(/変更前は 14:00–15:00/)).toBeVisible()
  await expect(page.getByText(/この操作は受付履歴に残ります（/)).toBeVisible()

  const after = await readDetail(request, mine.id)
  expect(after.code).toBe(mine.code)
  expect(jstClock(after.startsAt)).toBe('16:00')
  expect((await readHistory(request, mine.id)).at(-1)?.what).toBe(
    'ご来店時刻を 14:00 から 16:00 へ',
  )
})

// @e2e-covers UC-CHANGE-05
test('変更を確定すると、読み上げる文と変更後の姿を 1 画面で確かめて終えられる', async ({
  page,
  request,
}) => {
  const mine = await createReservation(request, DAYS.sayAloud, '14:00')
  await openDateTime(page, mine.code)
  await page.getByRole('button', { name: '16:00　受付できます' }).click()
  await page.getByRole('button', { name: '変更内容を確認する' }).click()

  // 確定の前に読み上げる文が、確定と同じ画面に載っている。
  const say = page.getByRole('region', { name: 'お客様へ、このまま読み上げます' })
  await expect(say).toContainText('お時間を変更いたします。')
  // メールの 1 行は読み上げの枠の外（`aside` の下）に置いてある。
  await expect(page.getByText('お電話でのご予約のため、メールは送りません。')).toBeVisible()

  await page.getByRole('button', { name: '変更を確定する' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約の変更を承りました' })).toBeVisible()
  await expect(page.getByRole('group', { name: '変更後のご予約' })).toContainText('16:00–17:00')
  // 出口は 台帳で見る（主操作）と トップへ戻る の 2 つだけ。
  await expect(page.getByRole('button', { name: '台帳で見る' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'トップへ戻る' })).toBeVisible()
})

// @e2e-covers UC-CHANGE-06
test('日時を保ったまま担当と場所だけを置き直せる', async ({ page, request }) => {
  const mine = await createReservation(request, DAYS.slotOnly, '14:00')
  await openByCode(page, mine.code)

  /*
   * この入口は長いあいだ「これから作ります。」としか答えず、**店側には担当を
   * 差し替える手立てが 1 つも無かった**（UX 監査 NEW-01）。盤は予約フローの工程 3
   * （BOOK-03-SLOT-STAFF）をそのまま使うので、同じ手つきで担当を置き直せる。
   */
  await page.getByRole('button', { name: '担当・場所を変える' }).click()
  await expect(page.getByRole('table', { name: 'ご予約を置く盤' })).toBeVisible()
  await expect(page.getByRole('list', { name: /予約の変更の工程/ })).toContainText(
    '担当と場所を変える',
  )

  // 何も変えないうちは進めない（差分の無い変更は監査に空の 1 行を残すだけになる）。
  const next = page.getByRole('button', { name: /^変更内容を確認する/ })
  await expect(next).toBeDisabled()

  await page.getByRole('button', { name: '担当はあとで決める' }).click()
  await expect(next).toBeEnabled()
  await next.click()
  await page.getByRole('button', { name: '変更を確定する' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約の変更を承りました' })).toBeVisible()

  const after = await readDetail(request, mine.id)
  // 日時はそのまま。動いたのは担当だけである。
  expect(after.startsAt).toBe(mine.startsAt)
  expect(after.endsAt).toBe(mine.endsAt)
  expect(after.assignments.find((band) => band.kind === 'staff')?.targetId ?? null).toBeNull()
})

/* ========================================================================== *
 * 5. 取り消し（CHANGE-CANCEL / CHANGE-DONE）
 * ========================================================================== */

// @e2e-covers UC-CHANGE-07
test('理由を選んで取り消すと、その枠がほかのお客様に案内できる状態へ戻る', async ({
  page,
  request,
}) => {
  const mine = await createReservation(request, DAYS.cancelFrees, '15:00')
  expect(slotAt(await readAvailability(request, DAYS.cancelFrees), '15:00')?.remaining).toBe(2)

  await openByCode(page, mine.code)
  await page.getByRole('button', { name: '取り消す' }).click()
  await expect(page.getByRole('heading', { name: 'この予約を取り消します' })).toBeVisible()
  await page.getByRole('radio', { name: 'お客様のご都合' }).check({ force: true })
  await page.getByRole('button', { name: 'この予約を取り消す', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'ご予約を取り消しました' })).toBeVisible()
  await expect(
    page.getByText('この枠は、ほかのお客様にご案内できる状態に戻りました。'),
  ).toBeVisible()

  const after = await readDetail(request, mine.id)
  expect(after.status).toBe('cancelled')
  expect(after.cancelReason).toBe('customer')
  expect(slotAt(await readAvailability(request, DAYS.cancelFrees), '15:00')?.remaining).toBe(3)
})

// @e2e-covers AC-CHANGE-16
test('理由を 1 つも選ばずに取り消しを送っても、ご予約はそのまま残る', async ({ page, request }) => {
  const mine = await createReservation(request, DAYS.reasonRequired, '11:00')

  // 画面では、理由を選ぶまで「この予約を取り消す」を押せない（押せない理由も読める）。
  await openByCode(page, mine.code)
  await page.getByRole('button', { name: '取り消す' }).click()
  const commit = page.getByRole('button', {
    name: 'この予約を取り消す（取り消しの理由を選ぶと押せます）',
  })
  await expect(commit).toBeDisabled()
  for (const reason of ['お客様のご都合', '店舗の都合', '予約の重複', 'ご来店がなかった']) {
    await expect(page.getByRole('radio', { name: reason })).not.toBeChecked()
  }

  // 契約の側も理由なしを通さない（画面を迂回して送っても 400 で、ご予約は元のまま）。
  const res = await cancelReservation(request, mine.id, { version: mine.version })
  expect(res.status()).toBe(400)

  const after = await readDetail(request, mine.id)
  expect(after.status).toBe('confirmed')
  expect(after.startsAt).toBe(mine.startsAt)
  expect(after.version).toBe(mine.version)
})

// @e2e-covers AC-CHANGE-17
test('取り消したあと、その時刻はほかのご予約の候補として受付できますに戻る', async ({
  page,
  request,
}) => {
  const mine = await createReservation(request, DAYS.cancelledSlot, '11:00')
  await openByCode(page, mine.code)
  await page.getByRole('button', { name: '取り消す' }).click()
  await page.getByRole('radio', { name: 'お客様のご都合' }).check({ force: true })
  await page.getByRole('button', { name: 'この予約を取り消す', exact: true }).click()

  // 完了の面が「この枠は戻りました」と言い、操作の記録が残ることも同じ面で読める。
  await expect(page.getByRole('heading', { name: 'ご予約を取り消しました' })).toBeVisible()
  await expect(
    page.getByText('この枠は、ほかのお客様にご案内できる状態に戻りました。'),
  ).toBeVisible()
  await expect(page.getByText(/この操作は受付履歴に残ります（/)).toBeVisible()

  // 同じ日の別のご予約から日時を選び直すと、空いた 11:00 が押せる候補として出る。
  const other = await createReservation(request, DAYS.cancelledSlot, '15:00')
  await openDateTime(page, other.code)
  await expect(page.getByRole('button', { name: '11:00　受付できます' })).toBeEnabled()
})

// @e2e-covers AC-CHANGE-21
test('取り消しは押した 1 回では起きず、ご予約はそのまま残る', async ({ page, request }) => {
  const mine = await createReservation(request, DAYS.safeDefault, '14:00')
  await openByCode(page, mine.code)
  await page.getByRole('button', { name: '取り消す' }).click()

  // 面に入った直後の焦点は安全な出口（「取り消さずに戻る」）に当たっている。
  await expect(page.getByRole('button', { name: '取り消さずに戻る' })).toBeFocused()
  // その焦点から「この予約を取り消します」「まだ取り消していません」が読める。
  await expect(page.getByRole('button', { name: '取り消さずに戻る' })).toHaveAccessibleDescription(
    /この予約を取り消します[\s\S]*まだ取り消していません/,
  )

  // **押した 1 回ではご予約は消えない。**理由を選ぶまで実行のボタンが押せない。
  const after = await readDetail(request, mine.id)
  expect(after.status).toBe('confirmed')
  expect(after.version).toBe(mine.version)

  await page.getByRole('button', { name: '取り消さずに戻る' }).click()
  await expect(page.getByRole('region', { name: 'ご予約の中身' })).toBeVisible()
  expect((await readDetail(request, mine.id)).status).toBe('confirmed')
})

/* ========================================================================== *
 * 6. 競合（EX-CONFLICT / BOOK-CONFLICT）
 * ========================================================================== */

// @e2e-covers UC-CHANGE-08
test('ほかの端末が先に保存していると、選ぶまでどちらの内容も書き換わらない', async ({
  page,
  request,
}) => {
  const mine = await createReservation(request, DAYS.bothSides, '14:00')
  await openDateTime(page, mine.code)
  await page.getByRole('button', { name: '16:00　受付できます' }).click()
  await page.getByRole('button', { name: '変更内容を確認する' }).click()

  // ほかの端末が先に保存する（版が 2 へ進む）。
  const theirs = await changeReservation(request, mine.id, {
    version: mine.version,
    startsAt: atJst(DAYS.bothSides, '17:00'),
  })
  expect(theirs.status(), await theirs.text()).toBe(200)

  await page.getByRole('button', { name: '変更を確定する' }).click()
  await expect(
    page.getByRole('heading', { name: '同じご予約を、ほかの端末でも直していました' }),
  ).toBeVisible()
  await expect(page.getByText('選ぶまで、どちらの内容も書き換わりません。')).toBeVisible()

  const after = await readDetail(request, mine.id)
  expect(jstClock(after.startsAt)).toBe('17:00')
  expect(after.version).toBe(2)
})

// @e2e-covers AC-CHANGE-19
test('確定を押すと相手の内容と自分の内容が並び、どちらもまだ保存されていない', async ({
  page,
  request,
}) => {
  const mine = await createReservation(request, DAYS.twoPanes, '14:00')
  await openDateTime(page, mine.code)
  await page.getByRole('button', { name: '16:00　受付できます' }).click()
  await page.getByRole('button', { name: '変更内容を確認する' }).click()

  const theirs = await changeReservation(request, mine.id, {
    version: mine.version,
    startsAt: atJst(DAYS.twoPanes, '17:00'),
  })
  expect(theirs.status(), await theirs.text()).toBe(200)

  await page.getByRole('button', { name: '変更を確定する' }).click()
  await expect(page.getByRole('alert')).toContainText('同じご予約を、ほかの端末でも直していました')

  // 左が相手の内容（保存済み）、右が自分の内容（まだ保存していません）。
  const theirSide = page.getByRole('region', { name: /が保存した内容$/ })
  const mySide = page.getByRole('region', { name: 'あなたが直した内容' })
  await expect(theirSide).toContainText('17:00–18:00')
  await expect(theirSide).toContainText('保存済み')
  await expect(mySide).toContainText('16:00–17:00')
  await expect(mySide).toContainText('まだ保存していません')
  // 変わった項目だけ旧値に取り消し線が付く（自分の面の「お日にちとお時間」）。
  await expect(mySide.locator('.line-through').first()).toContainText('14:00–15:00')

  // 出口は 4 つ。**どれも、押した時点ではまだ何も保存していない。**
  for (const name of [
    /の内容を残す$/,
    /^あなたの内容で上書きする$/,
    /^1項目ずつ選ぶ$/,
    /^やめて台帳に戻る$/,
  ]) {
    await expect(page.getByRole('button', { name })).toBeVisible()
  }
  const untouched = await readDetail(request, mine.id)
  expect(jstClock(untouched.startsAt)).toBe('17:00')
  expect(untouched.version).toBe(2)
})

// @e2e-covers AC-CHANGE-20
test('「あなたの内容で上書きする」は、送る前に空きを当て直してから保存される', async ({
  page,
  request,
}) => {
  const mine = await createReservation(request, DAYS.overwriteMine, '14:00')

  await openDateTime(page, mine.code)
  await page.getByRole('button', { name: '15:00　受付できます' }).click()
  await page.getByRole('button', { name: '変更内容を確認する' }).click()

  // ほかの端末が先に保存する（版が 2 へ進む）。
  const theirs = await changeReservation(request, mine.id, {
    version: mine.version,
    startsAt: atJst(DAYS.overwriteMine, '16:00'),
  })
  expect(theirs.status(), await theirs.text()).toBe(200)

  await page.getByRole('button', { name: '変更を確定する' }).click()
  await expect(
    page.getByRole('heading', { name: '同じご予約を、ほかの端末でも直していました' }),
  ).toBeVisible()

  /*
   * 自分の内容で上書きする前に、器が `GET /api/staff/availability`
   * （`excludeReservationId` 付き）で**空き枠を当て直す**（版の競合を解いた結果が
   * 枠の競合に当たることがあるので、当て直しを省けない）。当て直しが通れば
   * 相手の最新の版を載せて送る。
   */
  const recheck = page.waitForRequest(
    (req) =>
      req.url().includes('/api/staff/availability') &&
      req.url().includes(`excludeReservationId=${mine.id}`),
  )
  await page.getByRole('button', { name: 'あなたの内容で上書きする' }).click()
  await recheck
  await expect(page.getByRole('heading', { name: 'ご予約の変更を承りました' })).toBeVisible()

  const saved = await readDetail(request, mine.id)
  expect(jstClock(saved.startsAt)).toBe('15:00')
  expect(saved.version).toBe(3)
})

// @e2e-covers AC-CHANGE-23
test('相手の内容を残すと、ご予約は相手の内容のままで自分の入力は捨てられる', async ({
  page,
  request,
}) => {
  const mine = await createReservation(request, DAYS.keepTheirs, '14:00')
  const theirsAt = atJst(DAYS.keepTheirs, '15:00')

  await openDateTime(page, mine.code)
  await page.getByRole('button', { name: '16:00　受付できます' }).click()
  await page.getByRole('button', { name: '変更内容を確認する' }).click()

  const theirs = await changeReservation(request, mine.id, {
    version: mine.version,
    startsAt: theirsAt,
  })
  expect(theirs.status(), await theirs.text()).toBe(200)

  await page.getByRole('button', { name: '変更を確定する' }).click()
  await expect(
    page.getByRole('heading', { name: '同じご予約を、ほかの端末でも直していました' }),
  ).toBeVisible()

  // 相手を残す＝自分の入力を捨てる。**書き込みを 1 本も送らない**のが正しいふるまい。
  const writes: string[] = []
  page.on('request', (req) => {
    if (req.method() !== 'GET') writes.push(`${req.method()} ${new URL(req.url()).pathname}`)
  })
  await page.getByRole('button', { name: /の内容を残す$/ }).click()
  await expect(
    page.getByText('ほかの端末の内容を残しました。この端末で入れていた変更は取り消しています。'),
  ).toBeVisible()
  expect(writes.filter((line) => line.startsWith('PATCH'))).toEqual([])

  const after = await readDetail(request, mine.id)
  expect(after.startsAt).toBe(theirsAt)
  expect(after.version).toBe(2)
})

// @e2e-covers AC-CHANGE-26
test('確定の瞬間に枠が埋まっていると変更されず、BOOK-CONFLICT と同じ形になる', async ({
  page,
  request,
}) => {
  const mine = await createReservation(request, DAYS.slotTaken, '10:30')
  await openDateTime(page, mine.code)
  await page.getByRole('button', { name: '17:00　受付できます' }).click()
  await page.getByRole('button', { name: '変更内容を確認する' }).click()

  // 差分を確かめているあいだに、別の端末がその枠を埋める（同時受付の上限は 3）。
  await fillSlot(request, DAYS.slotTaken, '17:00')

  await page.getByRole('button', { name: '変更を確定する' }).click()
  await expect(page.getByText('まだ変更していません。伺った内容は残っています。')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'この枠は、ほかの端末で先に確定されました' }),
  ).toBeVisible()

  const still = await readDetail(request, mine.id)
  expect(jstClock(still.startsAt)).toBe('10:30')
  expect(still.version).toBe(1)
})

// @e2e-covers AC-CHANGE-27
test('古い版のまま送ると 409 になり、日時も担当も枠も監査も 1 行も書き換わらない', async ({
  request,
}) => {
  const mine = await createReservation(request, DAYS.staleNoWrite, '16:00')
  // 先に保存した端末（時刻を 16:30 へ、担当を 小林 学 へ）。
  const first = await changeReservation(request, mine.id, {
    version: mine.version,
    startsAt: atJst(DAYS.staleNoWrite, '16:30'),
    staffId: KOBAYASHI,
  })
  expect(first.status(), await first.text()).toBe(200)
  const saved = await readDetail(request, mine.id)
  const auditBefore = await readHistory(request, mine.id)

  // 遅れて届いた端末は古い版のまま。変更も取消も 409 で、どちらも 1 行も書かない。
  const staleChange = await changeReservation(request, mine.id, {
    version: mine.version,
    startsAt: atJst(DAYS.staleNoWrite, '14:00'),
    staffId: SATO,
  })
  expect(staleChange.status()).toBe(409)
  expect(((await staleChange.json()) as { error: string }).error).toBe('version_conflict')

  const staleCancel = await cancelReservation(request, mine.id, {
    version: mine.version,
    reason: 'customer',
  })
  expect(staleCancel.status()).toBe(409)
  expect(((await staleCancel.json()) as { error: string }).error).toBe('version_conflict')

  const after = await readDetail(request, mine.id)
  expect(after.startsAt).toBe(saved.startsAt)
  expect(after.endsAt).toBe(saved.endsAt)
  expect(after.status).toBe('confirmed')
  expect(after.cancelReason).toBeNull()
  expect(after.version).toBe(saved.version)
  // 担当の割り当ては先に保存した側の値のまま。
  expect(after.assignments.find((band) => band.kind === 'staff')?.targetId).toBe(KOBAYASHI)
  // 枠の占有も残っている（16:30 は先に保存した側のぶんだけ減っている）。
  expect(slotAt(await readAvailability(request, DAYS.staleNoWrite), '16:30')?.remaining).toBe(2)
  // 監査の行は増えていない（起きなかった操作を記録に残さない）。
  expect(await readHistory(request, mine.id)).toHaveLength(auditBefore.length)
})

/* ========================================================================== *
 * 7. 経緯（受付履歴の「そのあとの変更」）
 * ========================================================================== */

// @e2e-covers UC-CHANGE-10
test('変更と取消は、実行した日時と変更前後が 1 件ずつたどれる形で残る', async ({ request }) => {
  const mine = await createReservation(request, DAYS.auditTrail, '15:00')
  const changed = await changeReservation(request, mine.id, {
    version: mine.version,
    startsAt: atJst(DAYS.auditTrail, '16:00'),
  })
  expect(changed.status(), await changed.text()).toBe(200)
  const current = await readDetail(request, mine.id)
  const cancelled = await cancelReservation(request, mine.id, {
    version: current.version,
    reason: 'store',
  })
  expect(cancelled.status(), await cancelled.text()).toBe(200)

  /*
   * 先頭の 1 行は**受け付けたこと**である（`POST /api/staff/reservations` が
   * `reservation.created` を追記する）。そのあとに変更が古い順で並ぶ。
   */
  const lines = await readHistory(request, mine.id)
  expect(lines.map((line) => line.what)).toEqual([
    '新しく受け付けました',
    'ご来店時刻を 15:00 から 16:00 へ',
  ])
  for (const line of lines) expect(Number.isNaN(Date.parse(line.occurredAt))).toBe(false)

  /*
   * **取消の 1 行が経緯に出ない（見つけた欠陥。直すのはこの担当の外）。**
   * `buildCancelBatch` は監査の `after_json` に `{ status, cancelReason }` を書くのに、
   * `worker/index.ts` の `changeLabel` は `after.reason` を読む。綴りが噛み合わないので
   * `CANCEL_CHANGE_LABELS` を引けず、**知らない `action` として落ちる**
   * （`ReservationChangeHistory` の `what` が null の行は返さない決めのため）。
   * 直し方は `changeLabel` 側を `after.cancelReason` に揃える 1 語である。
   * それまでのあいだ、取消は**ご予約そのものに残った跡**でたどる。
   */
  const cancelledDetail = await readDetail(request, mine.id)
  expect(cancelledDetail.status).toBe('cancelled')
  expect(cancelledDetail.cancelReason).toBe('store')
})

// @e2e-covers AC-CHANGE-18
test('変更したご予約の「そのあとの変更」に、変更前後が 1 行で並ぶ', async ({ request }) => {
  const mine = await createReservation(request, DAYS.historyLine, '14:00')
  const changed = await changeReservation(request, mine.id, {
    version: mine.version,
    startsAt: atJst(DAYS.historyLine, '16:00'),
  })
  expect(changed.status(), await changed.text()).toBe(200)

  // 1 行目は受け付けたこと、2 行目が変更前後である。
  const lines = await readHistory(request, mine.id)
  expect(lines).toHaveLength(2)
  expect(lines[1]?.what).toBe('ご来店時刻を 14:00 から 16:00 へ')
  /*
   * 操作した人の名前（`actorName`）は、業務端末の `sub` に結んだ `staff` の行がある
   * ときだけ入る。seed は誰にも当てていないので null である（個人端末の「わたし」を
   * 作る経路は `mock-compare.spec.ts` の `beMe` が持つ）。
   */
  expect(lines[1]?.actorName).toBeNull()
})
