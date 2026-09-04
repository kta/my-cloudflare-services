import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { completeSeededTerminalStart } from './support/terminal'

/**
 * 電話・店頭からの予約受付（006-booking-flow）の受け入れ基準を、実ブラウザと実 Worker で
 * 確かめる。`vite preview` が実 workerd を動かし、D1 は `seed.mjs` が入れた EYE 銀座店
 * （2026年8月27日（木）のご予約 12 件）である。
 *
 * 1 本の test の直前の行に `// @e2e-covers <ID> ...` を置く。UC は対になる AC の test に
 * 相乗りさせ、37 件（UC-BOOK-01..15 / AC-BOOK-01..22）を 22 本にちょうど 1 回ずつ並べる。
 *
 * **時刻と盤面の据え方**（この面だけの決め）:
 *   - 端末の時計は `page.clock.setFixedTime` で **2026年8月27日（木）11:08 JST** に留める。
 *     ほかの面（`ledger.spec.ts` / `mock-compare.spec.ts`）と同じ瞬間である。暦は本日を含む
 *     週の月曜から 2 週ぶん（8月24日〜9月6日）を描くので、この時計のまま 9月3日 が押せる。
 *   - **ご予約を書くのは 2026年9月3日（木）だけ**にする。seed のご予約と台帳の e2e が見る
 *     8月27日・28日 の盤面に指を触れないためで、勤務（`staff_shifts`）は seed が
 *     8月27日 から 35 日ぶん展開しているので 9月3日 も同じ木曜の顔になる
 *     （佐藤 美咲 / 高橋 健 / 中村 彩 の 3 名が 10:00–19:00）。
 *   - 設備は 1 つも付けない（`equipmentIds` は空のまま）。設定の e2e が
 *     「視力測定機 B を止めても影響するご予約は 0 件」を固定しているので、
 *     この面が設備を押さえるとその前提を崩す。設備軸を確かめる 1 本だけが
 *     視力測定機 A を先約で塞ぐ（止める対象ではない 1 台）。
 *   - 時刻は test ごとに分ける。台帳と同じく **workers: 1** で 1 本ずつ順に走るので、
 *     前の test が書いた行が次の test の盤面に混ざらない。
 *
 * 仮の押さえ（KV）の期限はサーバの実時刻で切れるが、端末の時計は 8月27日 に据えてあるので
 * 「残り時間」は常に十分に残って見える。この面は残り時間そのものを見ない
 * （境界値は `test/booking.time.test.ts` が持つ）。
 */

/**
 * この e2e の tsconfig は Worker 向けで DOM の型を持たない（`tsconfig.base.json` の
 * `lib: ["ESNext"]`）。ブラウザの中だけで動くものは、使う分だけをここで宣言する。
 */
declare function getComputedStyle(node: unknown): { touchAction: string; inputMode: string }
declare const CompositionEvent: new (
  type: string,
  init?: { bubbles?: boolean; data?: string },
) => unknown

const ORG = 'eye'
/** seed.mjs が固定 id で入れる EYE 銀座店。 */
const GINZA = '11111111-1111-4111-8111-111111111111'

/** seed の id は `${区分}-0000-4000-8000-${連番}`（`seed.mjs` の `uid`）。 */
const uid = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`
const SATO = uid('c0010000', 0)
const TAKAHASHI = uid('c0010000', 1)
const MEASURE_A = uid('d0010000', 0)
/** ご来店の目的（`seed.mjs` の並び順）。 */
const PURPOSE_ADJUST = uid('e0010000', 1)

/** 担当のお名前 → id。確定の面が出したお名前から、同じ枠を先に取るために引く。 */
const STAFF_BY_NAME: Record<string, string> = {
  '佐藤 美咲': uid('c0010000', 0),
  '高橋 健': uid('c0010000', 1),
  '中村 彩': uid('c0010000', 2),
  '小林 学': uid('c0010000', 3),
  '渡辺 由紀': uid('c0010000', 4),
  '山田 大輔': uid('c0010000', 5),
}

/** モック 13 面が描いている瞬間（JST 2026年8月27日（木）11:08）。 */
const NOW = '2026-08-27T02:08:00.000Z'
/*
 * ご予約を書く日。台帳の e2e が見る 8月27日・28日 を避ける（同じ木曜の顔）。
 *
 * **先へずらせない。**この面は工程 1 で日付の札を押して歩くが、札に出るのは
 * 当日を含む近い日だけで、1 週先の 9月10日 にすると押す札がどこにも無く、
 * ファイルのほぼ全部が落ちる（実測: 2026-09-10 で 1 本を残して全滅）。
 */
const DAY = '2026-09-03'
const DAY_LABEL = '9月3日（木）'
/** 店舗の刻みは 30 分、片付けは 10 分、同時受付の上限は 3 件（`seed.mjs`）。 */
const MAX_PARALLEL = 3

/** JST の壁時計 → UTC の ISO8601。 */
const at = (hhmm: string): string =>
  new Date(Date.parse(`${DAY}T${hhmm}:00.000+09:00`)).toISOString()

/* --- 画面を開く ---------------------------------------------------------- */

async function startWork(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(NOW))
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(ORG)
  await page.getByRole('button', { name: '業務を始める' }).click()
  await completeSeededTerminalStart(page)
  await expect(page.locator('header').first()).toContainText('EYE 銀座店')
}

/** 「新しい予約を取る」を押して工程 1 に着く。 */
async function startBooking(page: Page): Promise<void> {
  await startWork(page)
  await page.getByRole('button', { name: /新しい予約を取る/ }).click()
  await expect(
    page.getByRole('heading', { name: 'お日にちはいつがよろしいですか？' }),
  ).toBeVisible()
}

/* --- 工程の帯 ------------------------------------------------------------ */

const stepBar = (page: Page): Locator => page.locator('[data-booking-stepbar]')
const stepList = (page: Page): Locator => page.getByRole('list', { name: '予約の工程 全5工程' })
const barNext = (page: Page): Locator => stepBar(page).getByRole('button', { name: /^次へ進む/ })
const barBack = (page: Page): Locator => stepBar(page).getByRole('button', { name: /^前へ戻る/ })

/**
 * 「次へ進む」を押す。**丸は 5 工程を通して帯の 1 つきり**なので、押せない理由が
 * 名前に入っていても同じ locator で掴める（押せないときは `aria-label` が
 * 「次へ進む　〜すると進めます」になる）。
 */
async function proceed(page: Page): Promise<void> {
  await expect(barNext(page)).toBeEnabled()
  await barNext(page).click()
}

/**
 * 工程 3 の既定の置き場所（盤のいちばん上の行）が先約と重なっていたら、
 * 同じ時刻で受けられる担当へ移して重なりを解く（AC-BOOK-06 が確かめる道と同じ手）。
 * 候補が 1 人もいなければ「担当はあとで決める」で進む（AC-BOOK-09 の道）。
 * 重なりそのものを見る test は `walkToSlot` で止めるので、ここは通らない。
 */
async function clearClash(page: Page): Promise<void> {
  if ((await board(page).getByText('重なっています').count()) === 0) return
  const sameTime = page.getByRole('button', { name: /\d{2}:\d{2}–\d{2}:\d{2} が空いています$/ })
  if ((await sameTime.count()) > 0) {
    await sameTime.first().click()
  } else {
    await page.getByRole('button', { name: '担当はあとで決める' }).click()
  }
  await expect(board(page).getByText('重なっています')).toHaveCount(0)
}

/* --- 盤の座標 ------------------------------------------------------------ */

const board = (page: Page): Locator => page.getByRole('table', { name: 'ご予約を置く盤' })

/**
 * 盤の枠 1 つの中ほど。`slot-drag.ts` の `snapToCell` は盤の実寸を等分するので、
 * 見出しの列と行の中心がそのまま枠の中心になる（列を数え直さずに済む）。
 */
async function boardPoint(
  page: Page,
  hhmm: string,
  row: number,
): Promise<{ x: number; y: number }> {
  const head = board(page).getByRole('columnheader', { name: hhmm, exact: true })
  const lane = board(page).getByRole('rowheader').nth(row)
  const column = await head.boundingBox()
  const line = await lane.boundingBox()
  expect(column, `${hhmm} の列がありません`).not.toBeNull()
  expect(line, `${row} 行目がありません`).not.toBeNull()
  return {
    x: (column?.x ?? 0) + (column?.width ?? 0) / 2,
    y: (line?.y ?? 0) + (line?.height ?? 0) / 2,
  }
}

/** いま帯が乗っている行。つまみの縦位置がいちばん近い行見出しを探す。 */
async function placedRow(page: Page): Promise<number> {
  const grip = await page.getByRole('button', { name: /^ご予約をつかんで動かす/ }).boundingBox()
  const lanes = board(page).getByRole('rowheader')
  const total = await lanes.count()
  let best = 0
  let nearest = Number.POSITIVE_INFINITY
  for (let index = 0; index < total; index += 1) {
    const line = await lanes.nth(index).boundingBox()
    const distance = Math.abs((line?.y ?? 0) + (line?.height ?? 0) / 2 - ((grip?.y ?? 0) + 12))
    if (distance < nearest) {
      nearest = distance
      best = index
    }
  }
  return best
}

/* --- 工程を歩く ---------------------------------------------------------- */

const dayButton = (page: Page, label: string): Locator =>
  page.getByRole('button', { name: new RegExp(`^${label}`) })
const timeButton = (page: Page, hhmm: string): Locator =>
  page.getByRole('button', { name: new RegExp(`^${hhmm} `) })

/** 工程 1。お日にちとお時間を選ぶ。時刻の札は営業時間ぶんが全部出る（UX 監査 BOOK-05）。 */
async function pickDateTime(page: Page, hhmm: string): Promise<void> {
  await dayButton(page, DAY_LABEL).click()
  await expect(timeButton(page, hhmm)).toBeEnabled()
  await timeButton(page, hhmm).click()
  await expect(timeButton(page, hhmm)).toHaveAttribute('aria-pressed', 'true')
}

/** 工程 2。ご用件を選び、収まるまで待つ。 */
async function pickPurpose(page: Page, name: string): Promise<void> {
  await expect(
    page.getByRole('heading', { name: '本日はどのようなご用件でしょうか？' }),
  ).toBeVisible()
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click()
  await expect(page.getByText('✓ 選んでいます')).toBeVisible()
}

/** 工程 1 → 工程 3 の入口まで歩く。 */
async function walkToSlot(page: Page, hhmm: string, purpose: string): Promise<void> {
  await startBooking(page)
  await pickDateTime(page, hhmm)
  await proceed(page)
  await pickPurpose(page, purpose)
  await proceed(page)
  await expect(page.getByRole('table', { name: 'ご予約を置く盤' })).toBeVisible()
}

/** 工程 3 → 工程 4 まで歩く。 */
async function walkToCustomer(page: Page, hhmm: string, purpose: string): Promise<void> {
  await walkToSlot(page, hhmm, purpose)
  await clearClash(page)
  await proceed(page)
  await expect(page.getByRole('heading', { name: 'お電話番号を伺えますか？' })).toBeVisible()
}

/** 工程 4 でお名前だけ伺い、工程 5 まで歩く。 */
async function walkToConfirm(page: Page, hhmm: string, purpose: string): Promise<void> {
  await walkToCustomer(page, hhmm, purpose)
  await page.getByLabel('お名前').fill('田中 花子')
  await page.getByLabel('ふりがな').fill('たなか はなこ')
  await proceed(page)
  await expect(page.getByRole('heading', { name: 'この文をそのまま読み上げます' })).toBeVisible()
}

/* --- API を直に叩く（前提づくりと検算） ---------------------------------- */

async function authed(request: APIRequestContext): Promise<{ headers: Record<string, string> }> {
  const res = await request.post('/api/auth/token', {
    data: { organizationId: ORG, role: 'staff' },
  })
  expect(res.status()).toBe(200)
  const { token } = (await res.json()) as { token: string }
  return { headers: { authorization: `Bearer ${token}` } }
}

type CreateInput = {
  startsAt: string
  purposeId?: string
  durationMinutes?: number
  staffId?: string | null
  equipmentIds?: string[]
}

/** ほかの端末が 1 件確定したことにする。応答（201 でなく 200／409）をそのまま返す。 */
async function createReservation(
  request: APIRequestContext,
  input: CreateInput,
): Promise<{ status: number; body: { code?: string; error?: string } }> {
  const res = await request.post('/api/staff/reservations', {
    ...(await authed(request)),
    data: {
      storeId: GINZA,
      startsAt: input.startsAt,
      purposeIds: [input.purposeId ?? PURPOSE_ADJUST],
      durationMinutes: input.durationMinutes ?? 60,
      staffId: input.staffId === undefined ? null : input.staffId,
      equipmentIds: input.equipmentIds ?? [],
      source: 'phone',
    },
  })
  return { status: res.status(), body: (await res.json()) as { code?: string; error?: string } }
}

/**
 * その担当のその時刻を、まだ空いていれば 1 件で塞ぐ。**何度走らせても 1 件のまま**に
 * なるので、test を retry しても盤面が積み上がらない。
 */
async function occupyStaff(
  request: APIRequestContext,
  hhmm: string,
  staffId: string,
  equipmentIds: string[] = [],
): Promise<void> {
  const created = await createReservation(request, { startsAt: at(hhmm), staffId, equipmentIds })
  /*
   * **空き枠を先に見て諦めない。**仮の押さえ（KV）は排他ではないので、画面が復唱の
   * あいだ持っている押さえで `isAvailable` が false になっていても、ご予約そのものは
   * 取れる。2 度目以降は D1 の占有行が 409 `slot_taken` を返すだけで、盤面は 1 件のまま。
   */
  const already = created.status === 409 && created.body.error === 'slot_taken'
  expect(created.status === 200 || already, JSON.stringify(created.body)).toBe(true)
}

/** その日その時刻に始まるご予約の件数。確定が 1 件だけであることの検算に使う。 */
async function reservationsAt(request: APIRequestContext, hhmm: string): Promise<number> {
  const res = await request.get('/api/staff/ledger', {
    ...(await authed(request)),
    params: { storeId: GINZA, date: DAY, axis: 'staff', view: 'list' },
  })
  expect(res.status()).toBe(200)
  const body = (await res.json()) as {
    lanes: { kind: string; entries: { reservationId: string; startsAt: string }[] }[]
  }
  const ids = new Set(
    body.lanes
      .filter((lane) => lane.kind === 'staff' || lane.kind === 'unassigned')
      .flatMap((lane) => lane.entries)
      .filter((entry) => entry.startsAt === at(hhmm))
      .map((entry) => entry.reservationId),
  )
  return ids.size
}

/* ========================================================================= */

// @e2e-covers UC-BOOK-01 AC-BOOK-01
test('工程 1 はお時間を選ぶまで進めず、定休と休憩は押せない', async ({ page }) => {
  await startBooking(page)

  /*
   * 開いた時点で本日が選ばれている（UX 監査 UI-06。以前は何も選ばれずに開き、
   * 時刻の札が 1 枚も出ていなかった）。だから足りないのはお時間だけである。
   */
  await expect(barNext(page)).toBeDisabled()
  await expect(barNext(page)).toHaveAttribute(
    'aria-label',
    '次へ進む　お時間をお選びになると進めます',
  )

  // 火曜は定休。札に「定休」と書いてあり、押せない。
  const closed = page.getByRole('button', { name: '9月1日（火） 定休' })
  await expect(closed).toBeDisabled()
  await expect(closed).toContainText('定休')

  await dayButton(page, DAY_LABEL).click()
  await expect(timeButton(page, '11:00')).toBeEnabled()
  // 日付だけでは進めない。理由も日付ぶんだけ短くなる。
  await expect(barNext(page)).toBeDisabled()
  await expect(barNext(page)).toHaveAttribute(
    'aria-label',
    '次へ進む　お時間をお選びになると進めます',
  )

  /*
   * お昼（12:00–13:00）は受付を止める帯。**「満席」とは書かない**（UX 監査 BOOK-06。
   * 満席だと「あと少し粘れば空くかもしれない」と読めるが、休憩はそもそも受けない）。
   */
  const noon = timeButton(page, '12:00')
  await expect(noon).toBeDisabled()
  await expect(noon).toContainText('休憩')
  await expect(noon).not.toContainText('満席')
  // 空いている札には残りの枠数が出る。
  await expect(timeButton(page, '11:00')).toContainText(/^11:00\s*あと\d枠$/)

  await timeButton(page, '11:00').click()
  await expect(barNext(page)).toBeEnabled()
  await expect(barNext(page)).toHaveAttribute('aria-label', '次へ進む')
})

// @e2e-covers UC-BOOK-02 AC-BOOK-02
test('工程 2 でご用件を押すと所要が決まり、収まる時刻なら進める', async ({ page }) => {
  await startBooking(page)
  await pickDateTime(page, '11:00')
  await proceed(page)

  await pickPurpose(page, 'メガネを新しく作る')
  // 60 分の目的は「60分 標準」に載る。
  await expect(page.getByRole('button', { name: '60分 標準' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText('11:00–12:00 で受け付けられます。')).toBeVisible()
  await expect(barNext(page)).toBeEnabled()
})

// @e2e-covers UC-BOOK-03 AC-BOOK-03
test('収まらない時刻には理由が 1 文で出て、代わりの時刻が 3 つまで並ぶ', async ({ page }) => {
  await startBooking(page)
  // 18:00 は 30 分なら受けられるが、閉店前の片付け（18:40–19:00）があるので 60 分は入らない。
  await pickDateTime(page, '18:00')
  await proceed(page)
  await pickPurpose(page, 'メガネを新しく作る')

  const notice = page.getByRole('group', { name: '受付できない時刻のご案内' })
  await expect(notice.getByRole('heading')).toHaveText('18:00 から60分の受付ができません')
  const alternatives = notice.getByRole('button')
  await expect(alternatives.first()).toBeVisible()
  expect(await alternatives.count()).toBeLessThanOrEqual(3)
  // 右のまとめは「受付できません」の札を付け、「次へ進む」は押せない。
  await expect(page.getByText('受付できません')).toBeVisible()
  await expect(barNext(page)).toBeDisabled()
  await expect(barNext(page)).toHaveAttribute('aria-label', '次へ進む　お時間を選び直すと進めます')
})

// @e2e-covers AC-BOOK-04
test('代わりの時刻を押しても目的と所要はそのまま残る', async ({ page }) => {
  await startBooking(page)
  await pickDateTime(page, '18:00')
  await proceed(page)
  await pickPurpose(page, 'メガネを新しく作る')

  const notice = page.getByRole('group', { name: '受付できない時刻のご案内' })
  const first = notice.getByRole('button').first()
  const label = (await first.innerText()).trim()
  await first.click()

  // 目的と所要はそのまま、時刻だけが差し替わる。
  await expect(page.getByText('✓ 選んでいます')).toBeVisible()
  await expect(page.getByRole('button', { name: '60分 標準' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText(`${label.split('–')[0]}`, { exact: false }).first()).toBeVisible()
  await expect(page.getByText('受付できません')).toHaveCount(0)
  await expect(barNext(page)).toBeEnabled()
})

// @e2e-covers UC-BOOK-04 AC-BOOK-05
test('工程 3 で先約に重なると帯が重なり、右に先約のお名前が出て進めない', async ({
  page,
  request,
}) => {
  test.slow()
  await occupyStaff(request, '15:00', SATO)

  await walkToSlot(page, '15:00', '今のメガネを調整したい')

  await expect(page.getByText('重なっています').first()).toBeVisible()
  // 塞いだ相手が分かっているので、名前まで照らす（名前が空でも通る正規表現にしない）。
  await expect(page.getByText('佐藤 美咲 に 15:00 の先約があります')).toBeVisible()
  const next = page.getByRole('button', { name: /^次へ進む/ }).last()
  await expect(next).toBeDisabled()
  await expect(next).toHaveAttribute('aria-label', '次へ進む　重なりを解くと進めます')

  /*
   * 重なりを解くのがこの面の仕事なので、**解く対象が画面に映っていること**。
   * 盤は 1 日ぶんの列を持ち、窓に入るのは 8 列だけなので、放っておくと
   * 15:00 は流れた先にある（UX 監査 J-05。それでも右の柱は「15:00 の先約があります」
   * 「指でつかんで動かせます」と言うので、言われたものが 1 つも見えない）。
   */
  const board = page.getByRole('table', { name: 'ご予約を置く盤' })
  const scroller = board.locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]')
  const window = await scroller.boundingBox()
  const placed = await page.getByText('重なっています').first().boundingBox()
  expect(placed).not.toBeNull()
  expect(placed?.x ?? 0).toBeGreaterThanOrEqual(window?.x ?? 0)
  expect((placed?.x ?? 0) + (placed?.width ?? 0)).toBeLessThanOrEqual(
    (window?.x ?? 0) + (window?.width ?? 0),
  )
  // 流したあとも、誰の行なのかが分かる（名前の列は左に貼り付く）。
  await expect(page.getByRole('rowheader', { name: /佐藤 美咲/ })).toBeVisible()
})

// @e2e-covers AC-BOOK-06
test('同じ時刻で受けられる担当の候補を押すと重なりが消えて進める', async ({ page, request }) => {
  test.slow()
  await occupyStaff(request, '15:00', SATO)

  await walkToSlot(page, '15:00', '今のメガネを調整したい')
  await expect(page.getByRole('heading', { name: '同じ 15:00 で受けられる担当' })).toBeVisible()

  const candidate = page
    .getByRole('heading', { name: '同じ 15:00 で受けられる担当' })
    .locator('xpath=following-sibling::ul[1]')
    .getByRole('button')
    .first()
  const name = (await candidate.innerText()).split('\n')[0]?.trim() ?? ''
  await candidate.click()

  await expect(page.getByText('重なっています')).toHaveCount(0)
  await expect(page.getByText('この時刻で確保できます')).toBeVisible()
  await expect(
    page.getByRole('cell', { name: new RegExp(`いま置いているご予約.*${name}`) }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /^次へ進む/ }).last()).toBeEnabled()
})

// @e2e-covers UC-BOOK-05 AC-BOOK-07
test('縦軸を設備・場所へ入れ替えても、担当者へ戻すと選んでいた担当が残る', async ({
  page,
  request,
}) => {
  test.slow()
  await occupyStaff(request, '16:30', SATO, [MEASURE_A])

  await walkToSlot(page, '16:30', '今のメガネを調整したい')
  // まず担当を選び直して、軸を往復しても残ることを確かめられる形にする。
  const candidate = page
    .getByRole('heading', { name: '同じ 16:30 で受けられる担当' })
    .locator('xpath=following-sibling::ul[1]')
    .getByRole('button')
    .first()
  const name = (await candidate.innerText()).split('\n')[0]?.trim() ?? ''
  await candidate.click()
  await expect(page.getByText('この時刻で確保できます')).toBeVisible()

  await page.getByRole('button', { name: '設備・場所', exact: true }).click()
  await expect(
    page.getByRole('table', { name: 'ご予約を置く盤' }).getByRole('columnheader').first(),
  ).toHaveText('設備・場所')
  await expect(page.getByRole('heading', { name: '同じ 16:30 で使える設備' })).toBeVisible()

  await page.getByRole('button', { name: '担当者', exact: true }).click()
  await expect(
    page.getByRole('cell', { name: new RegExp(`いま置いているご予約.*${name}`) }),
  ).toBeVisible()
})

// @e2e-covers UC-BOOK-06 AC-BOOK-08
test('帯をつかんで別の担当・時刻へ運べ、置けない場所には理由が添えられる', async ({ page }) => {
  test.slow()
  await walkToSlot(page, '11:00', '今のメガネを調整したい')

  const grip = page.getByRole('button', { name: /^ご予約をつかんで動かす/ })
  await expect(grip).toBeVisible()
  const row = await placedRow(page)
  const from = await grip.boundingBox()
  // 別の担当の 13:00 の枠。担当ごと変わることまでこの 1 本で見る。
  const other = row + 1 < (await board(page).getByRole('rowheader').count()) ? row + 1 : row
  const otherName = (
    (await board(page).getByRole('rowheader').nth(other).innerText()).split('\n')[0] ?? ''
  ).trim()
  const target = await boardPoint(page, '13:00', other)

  await page.mouse.move((from?.x ?? 0) + 12, (from?.y ?? 0) + 12)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 8 })
  // もとの場所は薄く残り、置く先には破線と行き先の時刻が出る。
  await expect(page.getByText('もとの場所')).toBeVisible()
  await expect(page.getByText('13:00–13:45 へ')).toBeVisible()
  await expect(page.getByText('指を離すと、この時刻で確保します')).toBeVisible()
  // 運んでいる間は進めない。
  const next = page.getByRole('button', { name: /^次へ進む/ }).last()
  await expect(next).toBeDisabled()
  await expect(next).toHaveAttribute('aria-label', '次へ進む　指を離すと進めます')

  await page.mouse.up()
  await expect(page.getByText('この時刻で確保できます')).toBeVisible()
  await expect(page.getByText(/13:00–13:45\s+先約との重なりはありません。/)).toBeVisible()
  await expect(
    board(page).getByRole('cell', { name: new RegExp(`いま置いているご予約.*${otherName}`) }),
  ).toBeVisible()

  // 置けない場所（受付を止めるお昼の帯）へ運ぶと、破線を出さず理由を添える。
  const grip2 = page.getByRole('button', { name: /^ご予約をつかんで動かす/ })
  const start = await grip2.boundingBox()
  const noon = await boardPoint(page, '12:00', other)
  await page.mouse.move((start?.x ?? 0) + 12, (start?.y ?? 0) + 12)
  await page.mouse.down()
  await page.mouse.move(noon.x, noon.y, { steps: 8 })
  await expect(page.getByText(/^ここには置けません（/).first()).toBeVisible()
  await expect(page.getByText('12:00–12:45 へ')).toHaveCount(0)
  await page.mouse.up()
  // 指を離すと元の位置（13:00）へ戻る。
  await expect(page.getByText(/13:00–13:45\s+先約との重なりはありません。/)).toBeVisible()

  // 「もとの 11:00 に戻す」で最初の位置と最初の担当へ戻る。
  await page.getByRole('button', { name: 'もとの 11:00 に戻す' }).click()
  await expect(page.getByText(/11:00–11:45\s+先約との重なりはありません。/)).toBeVisible()
  expect(await placedRow(page)).toBe(row)
})

// @e2e-covers UC-BOOK-07 AC-BOOK-09
test('担当も設備もあとで決めたまま確定でき、予約は「決めてください」と出る', async ({
  page,
  request,
}) => {
  test.slow()
  await walkToSlot(page, '10:30', '今のメガネを調整したい')

  await page.getByRole('button', { name: '担当はあとで決める' }).click()
  await page.getByRole('button', { name: '設備・場所', exact: true }).click()
  await page.getByRole('button', { name: '設備はあとで決める' }).click()
  await page.getByRole('button', { name: '担当者', exact: true }).click()
  await proceed(page)

  await expect(page.getByRole('heading', { name: 'お電話番号を伺えますか？' })).toBeVisible()
  await page.getByLabel('お名前').fill('鈴木 一郎')
  await proceed(page)
  await expect(page.getByRole('heading', { name: 'この文をそのまま読み上げます' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: '確保する内容' })).toContainText(
    '担当はあとで決める',
  )

  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()
  const done = page.getByRole('region', { name: 'ご予約の内容' })
  await expect(done).toContainText('決めてください')
  await expect(done).toContainText('あとで決める')
  // 未定でも枠は消費する（同じ時刻に 1 件だけ入っている）。
  expect(await reservationsAt(request, '10:30')).toBe(1)
})

// @e2e-covers UC-BOOK-08 AC-BOOK-10
test('工程 4 はテンキーで番号を打ち切るまで「完了」も「次へ進む」も押せない', async ({ page }) => {
  test.slow()
  await walkToCustomer(page, '11:00', '今のメガネを調整したい')

  await expect(barNext(page)).toBeDisabled()
  await page.getByLabel('お電話番号').click()
  const keypad = page.getByRole('group', { name: '電話番号のテンキー' })
  await expect(keypad).toBeVisible()

  for (const digit of '0901234'.split('')) {
    await keypad.getByRole('button', { name: digit, exact: true }).click()
  }
  await keypad.getByRole('button', { name: '5', exact: true }).click()
  await expect(page.getByText('あと3桁', { exact: true })).toBeVisible()
  await expect(keypad.getByRole('button', { name: /^完了/ })).toBeDisabled()
  await expect(keypad.getByRole('button', { name: '完了 あと3桁で押せます' })).toBeVisible()
  await expect(barNext(page)).toBeDisabled()

  for (const digit of '678'.split('')) {
    await keypad.getByRole('button', { name: digit, exact: true }).click()
  }
  await expect(keypad.getByRole('button', { name: '完了', exact: true })).toBeEnabled()
  await keypad.getByRole('button', { name: '完了', exact: true }).click()
  // 090-1234-5678 は同じ番号の登録が 2 件ある番号なので、候補の吹き出しが開く
  // （AC-CUST-04）。候補が開いている間はフォーカスをお電話番号の欄に残す
  // （AC-CUST-21）ので、お名前の欄は候補を退けたあとで手で入れられる。
  await expect(page.getByRole('dialog', { name: 'お客様の候補' })).toBeVisible()
  await expect(page.getByLabel('お電話番号')).toBeFocused()
  await page.getByRole('button', { name: 'どちらでもありません' }).click()
  await expect(page.getByRole('dialog', { name: 'お客様の候補' })).toHaveCount(0)
  await page.getByLabel('お名前').click()
  await expect(page.getByLabel('お名前')).toBeFocused()
})

// @e2e-covers UC-BOOK-09 AC-BOOK-11
test('お電話番号を伺えなくても、お名前とふりがなだけで工程 5 まで進める', async ({ page }) => {
  test.slow()
  await walkToCustomer(page, '11:30', '今のメガネを調整したい')

  await expect(barNext(page)).toBeDisabled()
  await expect(barNext(page)).toHaveAttribute('aria-label', /^次へ進む　/)
  await page.getByLabel('お名前').fill('田中 花子')
  await page.getByLabel('ふりがな').fill('たなか はなこ')
  await expect(barNext(page)).toBeEnabled()

  await proceed(page)
  await expect(page.getByRole('complementary', { name: '確保する内容' })).toContainText(
    '田中 花子 様',
  )
})

// @e2e-covers UC-BOOK-10 AC-BOOK-12
test('ご要望を手書きのまま残し、文字に変換するボタンは出さない', async ({ page }) => {
  test.slow()
  await walkToCustomer(page, '14:00', '今のメガネを調整したい')

  await page.getByRole('button', { name: '手書きで書く' }).click()
  await expect(page.getByRole('heading', { name: 'ご要望をそのまま書き留めます' })).toBeVisible()
  // 「文字に変換する」は 1 つも出さない（押しても何も起きないボタンを置かない）。
  await expect(page.getByRole('button', { name: /文字に変換/ })).toHaveCount(0)

  const paper = page.getByTestId('handwriting-paper')
  // 用紙の上をなぞっている間、背後の画面は動かない。
  await expect(paper).toHaveCSS('touch-action', 'none')
  const box = await paper.boundingBox()
  await page.mouse.move((box?.x ?? 0) + 60, (box?.y ?? 0) + 60)
  await page.mouse.down()
  await page.mouse.move((box?.x ?? 0) + 220, (box?.y ?? 0) + 130, { steps: 10 })
  // まだ離していない。離すまで用紙が白いままだと「書けていない」と思って二度なぞることになる。
  await expect(page.getByTestId('handwriting-live')).toBeVisible()
  await page.mouse.up()
  await expect(page.getByTestId('handwriting-live')).toHaveCount(0)
  await expect(page.getByTestId('handwriting-stroke')).toHaveCount(1)

  // 消しゴムは「なぞったところを消す」道具。触れていない線は残る。
  await page.mouse.move((box?.x ?? 0) + 60, (box?.y ?? 0) + 260)
  await page.mouse.down()
  await page.mouse.move((box?.x ?? 0) + 220, (box?.y ?? 0) + 260, { steps: 10 })
  await page.mouse.up()
  await expect(page.getByTestId('handwriting-stroke')).toHaveCount(2)
  await page.getByRole('button', { name: '消しゴム' }).click()
  await page.mouse.move((box?.x ?? 0) + 140, (box?.y ?? 0) + 260)
  await page.mouse.down()
  await page.mouse.move((box?.x ?? 0) + 160, (box?.y ?? 0) + 260, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByTestId('handwriting-stroke')).toHaveCount(1)
  await page.getByRole('button', { name: 'ペン' }).click()

  await page.getByRole('button', { name: '手書きのまま残す' }).click()
  const kept = page.getByRole('group', { name: '残したご要望' })
  await expect(kept.getByRole('img')).toHaveAttribute(
    'aria-label',
    /^手書きのご要望\s文字にしていません\s記入\s.+\s\d{2}:\d{2}$/,
  )
  await expect(kept.locator('figcaption')).toHaveText(/^記入\s.+\s\d{2}:\d{2}$/)
  // 手書きが使えない人の代替は同じ画面の「キーボードで入力」。
  await expect(page.getByRole('button', { name: 'キーボードで入力' })).toBeVisible()
})

// @e2e-covers UC-BOOK-11 AC-BOOK-13
test('復唱の文を読み上げて確定すると、予約番号と控えのお願いが出る', async ({ page }) => {
  test.slow()
  await walkToConfirm(page, '14:30', '今のメガネを調整したい')

  const script = page.getByRole('region', { name: '復唱する文' })
  await expect(script).toContainText('9月3日')
  // 復唱は声に出す形（「午後2時30分」）で読む。時計の表記は右の要約が持つ。
  await expect(script).toContainText('午後2時30分')
  await expect(script).toContainText('EYE 銀座店')
  // 目的は工程 2 で押した札と同じ店内の名前（`name_internal`）で読み上げる。
  await expect(script).toContainText('今のメガネを調整したい')
  await expect(script).toContainText('田中 花子')

  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()
  await expect(page.getByText(/^EY-\d{4}-\d{4,5}$/)).toBeVisible()
  const code = await page.getByText(/^EY-\d{4}-\d{4,5}$/).innerText()
  // 控えは送らない（notifier はメールだけ）。番号をお伝えいただく道を残す。
  await expect(page.getByText(/控えは .* へお送りしました/)).toHaveCount(0)
  await expect(page.getByText(`予約番号 ${code} をお控えいただくようお伝えください`)).toBeVisible()
  await expect(
    page.getByRole('list', { name: 'お客様にお伝えすること' }).getByRole('listitem'),
  ).toHaveCount(3)
  // 完了の面は工程の帯を出さない。
  await expect(stepBar(page)).toHaveCount(0)
})

// @e2e-covers AC-BOOK-14
test('確定を続けて 2 度押しても、予約は 1 件で同じ予約番号が返る', async ({ page, request }) => {
  test.slow()
  await walkToConfirm(page, '15:30', '今のメガネを調整したい')

  const confirm = page.getByRole('button', { name: '復唱を終えて予約を確定する' })
  await confirm.click()
  /* 2 度目は成立と競走する。成立していればボタンごと消えているので、待たずに諦める。 */
  await confirm.click({ force: true, noWaitAfter: true, timeout: 2_000 }).catch(() => undefined)

  await expect(page.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()
  const code = await page.getByText(/^EY-\d{4}-\d{4,5}$/).innerText()
  expect(code).toMatch(/^EY-\d{4}-\d{4,5}$/)
  expect(await reservationsAt(request, '15:30')).toBe(1)
})

// @e2e-covers UC-BOOK-12 AC-BOOK-15
test('確定の瞬間に枠が埋まっていたら、伺った内容を残したまま選び直せる', async ({
  page,
  request,
}) => {
  test.slow()
  await walkToConfirm(page, '17:00', '今のメガネを調整したい')

  // 工程 5 が確保しようとしている担当を、ほかの端末が先に取る。
  const holding = await page.getByRole('complementary', { name: '確保する内容' }).innerText()
  const staffId = Object.entries(STAFF_BY_NAME).find(([staff]) => holding.includes(staff))?.[1]
  expect(staffId, `確保する内容から担当を読み取れません: ${holding}`).toBeDefined()
  await occupyStaff(request, '17:00', staffId ?? SATO)

  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()

  await expect(
    page.getByRole('heading', { name: 'この枠は、ほかの端末で先に確定されました' }),
  ).toBeVisible()
  // 伺った内容は残っている。埋まった時刻だけに取り消し線と「埋まりました」の札が付く。
  await expect(page.getByText('埋まりました', { exact: true })).toBeVisible()
  await expect(page.getByText('今のメガネを調整したい', { exact: false }).first()).toBeVisible()
  const next = page.getByRole('button', { name: /^次へ進む/ }).last()
  await expect(next).toBeDisabled()
  await expect(next).toHaveAttribute('aria-label', '次へ進む　時刻か担当を選ぶと進めます')

  /*
   * 時刻を変えたくないお客様のために、**同じ時刻で受けられる担当の入れ替え案**が並ぶ。
   * サーバの 409 は時刻しか返さないので、この案を組み立てるのは画面である。
   */
  await expect(page.getByText('時刻を変えたくない場合')).toBeVisible()
  // 技能が分かる担当は「担当を 高橋 健（フィッティング・販売・受付）に変える」になる。
  await expect(page.getByRole('button', { name: /担当を .+に変える/ })).toBeVisible()

  // 代わりの時刻を選ぶと、その場で押さえ直して工程 5 へ戻る。
  await page
    .getByRole('button', { name: /^\d{2}:\d{2}/ })
    .first()
    .click()
  await expect(next).toBeEnabled()
  await next.click()
  await expect(page.getByRole('heading', { name: 'この文をそのまま読み上げます' })).toBeVisible()
})

// @e2e-covers UC-BOOK-13 AC-BOOK-16
test('工程 4 から工程 3 へ戻ってももう一度進めば、打ち込んだ内容が残っている', async ({ page }) => {
  test.slow()
  await walkToCustomer(page, '11:00', '今のメガネを調整したい')
  // 工程 4 の要約が言っている担当が、戻ったときにも同じ行でなければならない。
  const soFar = await page.getByRole('complementary').first().innerText()
  const staffName =
    Object.keys(STAFF_BY_NAME).find((name) => soFar.includes(name)) ?? '担当はあとで決める'

  await page.getByLabel('お名前').fill('田中 花子')
  await page.getByLabel('ふりがな').fill('たなか はなこ')

  await barBack(page).click()
  const board = page.getByRole('table', { name: 'ご予約を置く盤' })
  await expect(board).toBeVisible()
  await expect(page.getByText('この時刻で確保できます')).toBeVisible()
  // 「重なりが無い」だけでは、同じ担当の行に戻ったことにならない。
  await expect(
    board.getByRole('cell', {
      name: new RegExp(`^いま置いているご予約.*${staffName}`),
    }),
  ).toBeVisible()

  await proceed(page)
  await expect(page.getByLabel('お名前')).toHaveValue('田中 花子')
  await expect(page.getByLabel('ふりがな')).toHaveValue('たなか はなこ')
})

// @e2e-covers UC-BOOK-14 AC-BOOK-17
test('「やめる」は 2 択の確認を出し、続ければ工程に留まり、やめればトップへ戻る', async ({
  page,
}) => {
  await startBooking(page)
  await pickDateTime(page, '11:00')

  await page.getByRole('button', { name: 'やめる' }).click()
  const dialog = page.getByRole('alertdialog', { name: '入力をやめますか' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button')).toHaveCount(2)

  await dialog.getByRole('button', { name: '続ける' }).click()
  await expect(dialog).toHaveCount(0)
  // その工程に留まり、入力は残っている。
  await expect(timeButton(page, '11:00')).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'やめる' }).click()
  await page.getByRole('button', { name: '入力をやめる' }).click()
  await expect(page.getByRole('button', { name: /新しい予約を取る/ })).toBeVisible()
})

// @e2e-covers AC-BOOK-18
test('録音の置き場所は工程 1 から 4 まで動かず、工程 5 では右下へ移る', async ({ page }) => {
  test.slow()
  await startBooking(page)
  const badge = page.locator('[data-booking-recording="bar"]')
  await expect(stepBar(page).locator('[data-booking-recording="bar"]')).toBeVisible()
  const first = await badge.boundingBox()
  expect(first).not.toBeNull()
  // 録音状態の文言は「許可を確かめています」→「録音していません」と縮み得る。
  // そのため幅・左端ではなく、帯の右端に留まることを工程ごとに測る。
  const rightEdge = (box: { x: number; width: number } | null) => (box?.x ?? 0) + (box?.width ?? 0)
  const firstRight = rightEdge(first)

  await pickDateTime(page, '11:00')
  await proceed(page)
  await pickPurpose(page, '今のメガネを調整したい')
  expect(rightEdge(await badge.boundingBox())).toBe(firstRight)

  await proceed(page)
  await expect(page.getByRole('table', { name: 'ご予約を置く盤' })).toBeVisible()
  expect(rightEdge(await badge.boundingBox())).toBe(firstRight)

  await clearClash(page)
  await proceed(page)
  await page.getByLabel('お名前').fill('田中 花子')
  expect(rightEdge(await badge.boundingBox())).toBe(firstRight)

  await proceed(page)
  await expect(page.getByRole('heading', { name: 'この文をそのまま読み上げます' })).toBeVisible()
  const floating = page.locator('[data-booking-recording="floating"]')
  await expect(floating).toBeVisible()
  const floatingBox = await floating.boundingBox()
  const viewport = page.viewportSize()
  expect(floatingBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect((viewport?.width ?? 0) - ((floatingBox?.x ?? 0) + (floatingBox?.width ?? 0))).toBeCloseTo(
    20,
    0,
  )
  // 確認画面のフローティング表示は、画面下端ではなく固定工程帯の直上に置く。
  const footer = await stepBar(page).boundingBox()
  expect(footer).not.toBeNull()
  expect((footer?.y ?? 0) - ((floatingBox?.y ?? 0) + (floatingBox?.height ?? 0))).toBeCloseTo(20, 0)
  await expect(badge).toHaveCount(0)
})

// @e2e-covers UC-BOOK-15 AC-BOOK-19
test('工程の帯は順番といまの位置を読み上げに渡し、押せる操作にはしない', async ({ page }) => {
  test.slow()
  await walkToCustomer(page, '11:00', '今のメガネを調整したい')

  const steps = stepList(page)
  await expect(steps).toBeVisible()
  const items = steps.getByRole('listitem')
  await expect(items).toHaveCount(5)
  await expect(items.nth(3)).toHaveAttribute('aria-current', 'step')
  await expect(items.nth(3)).toContainText('全5工程のうち4つ目')
  // 済んだ工程の札は押せる操作として現れない。戻るのは左端の「‹」だけ。
  await expect(steps.getByRole('button')).toHaveCount(0)
  await expect(barBack(page)).toBeEnabled()

  // 進めないときは理由が読み上げの名前に入る。
  await expect(barNext(page)).toBeDisabled()
  await expect(barNext(page)).toHaveAttribute('aria-label', /^次へ進む　.+/)
})

// @e2e-covers AC-BOOK-20
test('テンキーを使っている間も iPadOS のソフトキーボードは出ず、帯は見えている', async ({
  page,
}) => {
  test.slow()
  await walkToCustomer(page, '11:00', '今のメガネを調整したい')

  const field = page.getByLabel('お電話番号')
  await expect(field).toHaveAttribute('inputmode', 'none')
  await field.click()
  const keypad = page.getByRole('group', { name: '電話番号のテンキー' })
  await expect(keypad).toBeVisible()

  await keypad.getByRole('button', { name: '0', exact: true }).click()
  await keypad.getByRole('button', { name: '9', exact: true }).click()
  await expect(field).toHaveValue('09')
  // 帯と録音の表示はテンキーに覆われないまま見えている。
  await expect(stepBar(page)).toBeVisible()
  await expect(stepBar(page).locator('[data-booking-recording="bar"]')).toBeVisible()
})

// @e2e-covers AC-BOOK-21
test('変換が確定するまでふりがなは入らず、人が直したふりがなは上書きされない', async ({ page }) => {
  test.slow()
  await walkToCustomer(page, '11:00', '今のメガネを調整したい')

  const name = page.getByLabel('お名前')
  const kana = page.getByLabel('ふりがな')
  await name.click()
  await name.evaluate((node) =>
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
  )
  await name.fill('たなか')
  await name.evaluate((node) =>
    node.dispatchEvent(
      new CompositionEvent('compositionupdate', { bubbles: true, data: 'たなか' }),
    ),
  )
  // 変換の確定前はふりがなに未確定の文字が入らない。
  await expect(kana).toHaveValue('')

  await name.fill('田中')
  await name.evaluate((node) =>
    node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '田中' })),
  )
  await expect(kana).toHaveValue('たなか')
  await expect(page.getByText('自動で入れました')).toBeVisible()

  // 人が直したら、そのあとの変換では上書きしない。
  await kana.fill('たなか はなこ')
  await expect(page.getByText('自動で入れました')).toHaveCount(0)
  await name.click()
  await name.evaluate((node) =>
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
  )
  await name.fill('すずき')
  await name.evaluate((node) =>
    node.dispatchEvent(
      new CompositionEvent('compositionupdate', { bubbles: true, data: 'すずき' }),
    ),
  )
  await name.fill('鈴木')
  await name.evaluate((node) =>
    node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '鈴木' })),
  )
  await expect(kana).toHaveValue('たなか はなこ')
})

// @e2e-covers AC-BOOK-22
test('2 台が同じ枠を同時に確定すると一方だけが成立し、もう一方に行は増えない', async ({
  request,
}) => {
  const startsAt = at('13:30')
  /*
   * 30 分で取る。60 分にすると片付けまで 14:40 に伸び、画面から通した e2e が
   * 14:30 に取ったご予約と担当がぶつかって、**どちらも** 409 になる（この test が
   * 見たいのは同時の 1 本きりであって、先約の有無ではない）。
   */
  const [a, b] = await Promise.all([
    createReservation(request, { startsAt, staffId: TAKAHASHI, durationMinutes: 30 }),
    createReservation(request, { startsAt, staffId: TAKAHASHI, durationMinutes: 30 }),
  ])
  const statuses = [a.status, b.status].sort((x, y) => x - y)
  expect(statuses, JSON.stringify([a.body, b.body])).toEqual([200, 409])
  const lost = a.status === 409 ? a : b
  expect(lost.body.error).toBe('slot_taken')
  // 落ちた側では 1 行も増えていない（同じ時刻のご予約は 1 件だけ）。
  expect(await reservationsAt(request, '13:30')).toBe(1)

  /*
   * 同時受付の上限が 3 件の店では、担当を未定にしたまま同じ時刻へ 2 件目・3 件目を
   * 確定できる（**枠 1 本 = 1 件では止めない**）。上限は担当の割当行を**全部**数えるので、
   * いま成立した 高橋 健 の 1 件が 1 件目にあたる。2 件目・3 件目は通り、4 件目で止まる。
   */
  const later: number[] = []
  for (let index = 1; index < MAX_PARALLEL; index += 1) {
    const one = await createReservation(request, { startsAt, staffId: null, durationMinutes: 30 })
    later.push(one.status)
  }
  expect(later).toEqual([200, 200])
  const over = await createReservation(request, { startsAt, staffId: null, durationMinutes: 30 })
  expect(over.status, JSON.stringify(over.body)).toBe(409)
  expect(over.body.error).toBe('slot_taken')
  expect(await reservationsAt(request, '13:30')).toBe(MAX_PARALLEL)
})
