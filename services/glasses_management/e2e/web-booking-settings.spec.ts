import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { completeSeededTerminalStart } from './support/terminal'

/**
 * お客様向け Web 予約（011-web-booking）のうち、**お店側**の 8 本。
 * 設定の「Web予約の公開」（SETTINGS-WEB）と、確認待ちで届いたご予約を確かめる筋書きである。
 *
 * このファイルは **ipad project（1194×834）**が拾う。お客様側の 28 本は
 * `web-booking.spec.ts`（iphone 390×844）にある。1 本の test の直前の行に
 * `// @e2e-covers <ID>` を置き、2 ファイルで 36 個をちょうど 1 回ずつ並べる。
 *
 * **盤面（D1）の扱い**: この面は公開の設定を書き換える。iphone project はこの面より
 * **あとに**走る（`playwright.config.ts` の project の並び）ので、変えた値は必ず元へ戻す。
 * 承認済みモックとの突き合わせ（mock / mock-phone）はこの面より先に済んでいる。
 */

const ORG = 'eye'
const SLUG = 'ginza'
/** seed.mjs が固定 id で入れる EYE 銀座店。 */
const GINZA = '11111111-1111-4111-8111-111111111111'
const VIEWER = `dev:${ORG}`
const MEMBERSHIP_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
const INTERNAL_KEY = 'dev-internal-key'

const uid = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`
/** かけ具合の調整（20 分）。必要資源を持たないので 1 件取っても枠を締めない。 */
const ADJUST = uid('e0010000', 1)
const MANAGER_PERMISSIONS = [
  'store.read',
  'store.manage',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.write',
  'settings.read',
  'settings.manage',
]

const MS_PER_DAY = 24 * 60 * 60 * 1000

/* --- 前提 ------------------------------------------------------------------ */

async function authed(request: APIRequestContext): Promise<{ headers: Record<string, string> }> {
  const res = await request.post('/api/auth/token', {
    data: { organizationId: ORG, role: 'staff' },
  })
  expect(res.status()).toBe(200)
  return { headers: { authorization: `Bearer ${((await res.json()) as { token: string }).token}` } }
}

async function grant(request: APIRequestContext, permissions: readonly string[]): Promise<void> {
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

type WebSettings = {
  isPublished: boolean
  landingPath: string
  opensAt: string
  closesAt: string
  acceptFromHours: number
  acceptUntilDays: number
  changeDeadlineDays: number
  requiresApproval: boolean
  message: string
  publishedPurposeIds: string[]
  version: number
}

/**
 * 読んだ設定を、そのまま保存へ返せる形にする。`PUT` の契約は `strictObject` で、
 * サーバが決める `storeId` / `landingPath` / `updatedAt` を混ぜると 400 になる。
 */
function toInput(settings: WebSettings): Record<string, unknown> {
  return {
    isPublished: settings.isPublished,
    opensAt: settings.opensAt,
    closesAt: settings.closesAt,
    acceptFromHours: settings.acceptFromHours,
    acceptUntilDays: settings.acceptUntilDays,
    changeDeadlineDays: settings.changeDeadlineDays,
    requiresApproval: settings.requiresApproval,
    message: settings.message,
    publishedPurposeIds: settings.publishedPurposeIds,
    version: settings.version,
  }
}

async function readSettings(request: APIRequestContext): Promise<WebSettings> {
  const res = await request.get(`/api/staff/web-booking-settings/${GINZA}`, await authed(request))
  expect(res.status()).toBe(200)
  return (await res.json()) as WebSettings
}

/**
 * この面が触る前の設定 1 行。**iphone project はこの面のあとに走る**ので、
 * 1 本ごとに必ずここへ戻す（公開を切ったまま渡すと、お客様側の 28 本が丸ごと落ちる）。
 */
let original: Record<string, unknown> | null = null

test.beforeEach(async ({ request }) => {
  await grant(request, MANAGER_PERMISSIONS)
  original ??= toInput(await readSettings(request))
})

test.afterEach(async ({ request }) => {
  if (original === null) return
  const current = await readSettings(request)
  const res = await request.put(`/api/staff/web-booking-settings/${GINZA}`, {
    ...(await authed(request)),
    data: { ...original, version: current.version },
  })
  expect(res.status()).toBe(200)
})

/* --- 日付 ------------------------------------------------------------------ */

function jstDay(at: Date | string = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date(at))
}

function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10)
}

type PublicDay = {
  date: string
  isClosed: boolean
  slots: { startsAt: string; isAvailable: boolean }[]
}

/** いまから `fromDays` 日より先の、まだ空いている枠を 1 つ引き当てる。 */
async function openSlot(
  request: APIRequestContext,
  fromDays: number,
): Promise<{ date: string; startsAt: string }> {
  const today = jstDay()
  for (let offset = fromDays; offset <= 30; offset += 7) {
    const from = shiftDay(today, offset)
    const res = await request.get(`/api/public/stores/${SLUG}/availability`, {
      params: { purposeId: ADJUST, from, to: shiftDay(from, Math.min(6, 30 - offset)) },
    })
    expect(res.status()).toBe(200)
    for (const day of ((await res.json()) as { days: PublicDay[] }).days) {
      const slot = day.slots.find((row) => row.isAvailable)
      if (slot !== undefined) return { date: day.date, startsAt: slot.startsAt }
    }
  }
  throw new Error('空いている枠がない')
}

async function bookAsCustomer(
  request: APIRequestContext,
  startsAt: string,
): Promise<{ code: string; managementCode: string }> {
  const res = await request.post(`/api/public/stores/${SLUG}/bookings`, {
    data: {
      purposeId: ADJUST,
      startsAt,
      contactName: '山口 真央',
      contactKana: 'やまぐち まお',
      contactPhone: '080-2345-6789',
      contactEmail: 'm.yamaguchi@example.jp',
    },
  })
  expect(res.status()).toBe(200)
  return (await res.json()) as { code: string; managementCode: string }
}

/**
 * その枠に付けられる担当を 1 人引く。**誰でもよいわけではない** —— 銀座店の 7 名は
 * 曜日ごとに勤務が違い、その日休みの担当へ移すと 409 `purpose_unavailable` で断られる。
 * 誰が空いているかは業務側の空き枠エンジンが知っているので、それを読む。
 */
async function freeStaffAt(
  request: APIRequestContext,
  input: { date: string; startsAt: string; reservationId: string },
): Promise<string> {
  const res = await request.get('/api/staff/availability', {
    ...(await authed(request)),
    params: {
      storeId: GINZA,
      date: input.date,
      purposeIds: ADJUST,
      excludeReservationId: input.reservationId,
    },
  })
  expect(res.status()).toBe(200)
  const slots = ((await res.json()) as { slots: { startsAt: string; staffIds: string[] }[] }).slots
  const staffId = slots.find((slot) => slot.startsAt === input.startsAt)?.staffIds[0]
  expect(staffId).toBeDefined()
  return staffId as string
}

/* --- 画面を開く ------------------------------------------------------------ */

async function startWork(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(ORG)
  await page.getByRole('button', { name: '業務を始める' }).click()
  await completeSeededTerminalStart(page)
  await expect(page.locator('header').first()).toContainText('EYE 銀座店')
}

async function openWebSettings(page: Page): Promise<void> {
  await startWork(page)
  await page
    .getByRole('navigation', { name: '画面の切り替え' })
    .getByRole('button', { name: '設定', exact: true })
    .click()
  await page
    .getByRole('navigation', { name: '設定の項目' })
    .getByRole('button', { name: 'Web予約の公開', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Web予約の公開', exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Web予約を公開する' })).toBeVisible()
}

const preview = (page: Page) => page.getByRole('region', { name: 'お客様の画面の見え方' })
const saveButton = (page: Page) => page.getByRole('button', { name: '保存', exact: true })

/* ========================================================================== *
 * 1. 出す・出さない（SETTINGS-WEB）
 * ========================================================================== */

// @e2e-covers UC-WEB-01
test('店長は Web 予約を公開するかどうかと、お客様へのお知らせ文を決められる', async ({
  page,
  request,
}) => {
  await openWebSettings(page)

  const toggle = page.getByRole('switch', { name: 'Web予約を公開する' })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  // ご案内のページは `stores.slug` から組み立てる（表に持たない）。
  await expect(page.getByText(`eye.jp/${SLUG}`)).toBeVisible()

  await page.getByRole('button', { name: '書き直す' }).click()
  const notice = '棚卸しのため、9月30日はお休みをいただきます。'
  await page.getByLabel('お客様へのお知らせ文').fill(notice)
  // 上限は符号位置で数える（絵文字を 2 文字にしない）。
  await expect(page.getByText(`${[...notice].length}文字／120文字まで`)).toBeVisible()
  await saveButton(page).click()

  const saved = await readSettings(request)
  expect(saved.isPublished).toBe(true)
  expect(saved.message).toBe(notice)

  // お客様の面にもその文がそのまま出る（対客の文は 1 か所しか持たない）。
  const detail = await request.get(`/api/public/stores/${SLUG}`)
  expect((await detail.json()) as { message: string }).toMatchObject({ message: notice })
})

// @e2e-covers UC-WEB-02
test('保存する前に「お客様の画面の見え方」で、社内の言葉が漏れていないかを確かめられる', async ({
  page,
}) => {
  await openWebSettings(page)

  const seen = preview(page)
  await expect(seen).toContainText('EYE 銀座店（銀座4丁目）　ご予約')
  for (const publicName of [
    '新しいメガネを作る',
    'かけ具合の調整',
    'できあがりの受け取り',
    'コンタクトのご相談',
    '視力測定',
  ]) {
    await expect(seen.getByText(publicName, { exact: true })).toHaveCount(1)
  }
  // 店内名（`name_internal`）と、Web に出さない目的はプレビューに 1 つも出ない。
  for (const internalName of [
    'メガネを新しく作る',
    '今のメガネを調整したい',
    'できあがりを受け取る',
    '視力測定だけ',
    '修理・部品の交換',
  ]) {
    await expect(seen.getByText(internalName, { exact: true })).toHaveCount(0)
  }

  // 左のお知らせ文を書き換えると、保存しなくても右の注記がその場で変わる。
  await page.getByRole('button', { name: '書き直す' }).click()
  await page.getByLabel('お客様へのお知らせ文').fill('本日は 17 時までの受付です。')
  await expect(seen.getByText('本日は 17 時までの受付です。')).toBeVisible()
})

// @e2e-covers AC-WEB-01
test('「Web予約を公開する」を切って保存すると、その店舗のご予約ページは手順に入れない', async ({
  page,
  request,
}) => {
  await openWebSettings(page)

  await page.getByRole('switch', { name: 'Web予約を公開する' }).click()
  await expect(page.getByText('公開していません')).toBeVisible()
  await saveButton(page).click()
  await expect(page.getByText(/^未保存の変更 \d+件$/)).toHaveCount(0)

  expect((await readSettings(request)).isPublished).toBe(false)

  // 公開していない店舗は「無い」と同じ答えになり、ご予約ページは手順に入れない。
  expect((await request.get(`/api/public/stores/${SLUG}`)).status()).toBe(404)
  expect(
    ((await (await request.get('/api/public/stores')).json()) as { slug: string }[]).length,
  ).toBe(0)

  await page.goto(`/w/${SLUG}`)
  await expect(page.getByRole('heading', { name: 'いまはWebでご予約を承れません' })).toBeVisible()
  await expect(page.getByRole('button', { name: /で予約を進める$/ })).toHaveCount(0)
})

// @e2e-covers AC-WEB-02
test('「公開する目的」から 1 件外すと 4件になり、プレビューからもその 1 件が消える', async ({
  page,
}) => {
  await openWebSettings(page)

  const purposes = page.getByRole('group', { name: '公開する目的' })
  /*
   * **件数をベタ書きしない。**`store-settings.spec.ts` は目的を足す経路を通り、消す経路を
   * 持たない（あちらの決め）。seed のままなら 5 件だが、いくつ出ていても
   * 「1 件外すと 1 件減り、その 1 件がプレビューからも消える」ことは変わらない。
   */
  const before = await preview(page).getByRole('listitem').count()
  expect(before).toBeGreaterThanOrEqual(5)
  await expect(page.getByText(`${before}件`, { exact: true })).toBeVisible()
  await expect(preview(page).getByText('できあがりの受け取り', { exact: true })).toHaveCount(1)

  await purposes.getByRole('checkbox', { name: /できあがりの受け取り/ }).uncheck()

  await expect(page.getByText(`${before - 1}件`, { exact: true })).toBeVisible()
  await expect(preview(page).getByText('できあがりの受け取り', { exact: true })).toHaveCount(0)
  await expect(preview(page).getByRole('listitem')).toHaveCount(before - 1)
})

// @e2e-covers UC-WEB-10
test('店長は受付を開始する何時間先からと、何日先まで受けるかを決められる', async ({
  page,
  request,
}) => {
  await openWebSettings(page)

  await expect(page.getByLabel('何時間先から受ける')).toHaveValue('2')
  await expect(page.getByLabel('何日先まで受ける')).toHaveValue('30')

  await page.getByLabel('何時間先から受ける').fill('6')
  await page.getByLabel('何日先まで受ける').fill('10')
  await saveButton(page).click()

  const saved = await readSettings(request)
  expect(saved.acceptFromHours).toBe(6)
  expect(saved.acceptUntilDays).toBe(10)

  /*
   * 10 日先までは枠が返り、11 日先からは 1 つも選べない。
   * E2Eは注入した実行日から45日分の勤務を使い捨てD1に展開する。
   * 受付窓の境目だけを見るため、窓を10日へ縮めて11日目と比べる。
   */
  const today = jstDay()
  const inside = await request.get(`/api/public/stores/${SLUG}/availability`, {
    params: { purposeId: ADJUST, from: shiftDay(today, 8), to: shiftDay(today, 10) },
  })
  const outside = await request.get(`/api/public/stores/${SLUG}/availability`, {
    params: { purposeId: ADJUST, from: shiftDay(today, 11), to: shiftDay(today, 13) },
  })
  expect(inside.status()).toBe(200)
  expect(outside.status()).toBe(200)
  const insideDays = ((await inside.json()) as { days: PublicDay[] }).days
  const outsideDays = ((await outside.json()) as { days: PublicDay[] }).days
  expect(insideDays.some((day) => day.slots.some((slot) => slot.isAvailable))).toBe(true)
  expect(outsideDays.some((day) => day.slots.some((slot) => slot.isAvailable))).toBe(false)
})

/* ========================================================================== *
 * 2. 確認待ちのご予約（LEDGER-LIST の「確認待ち」）
 * ========================================================================== */

// @e2e-covers AC-WEB-07
test('「お店が確かめてから確定する」なら、送られた予約は確認待ちとして数えられる', async ({
  request,
}) => {
  expect((await readSettings(request)).requiresApproval).toBe(true)

  const slot = await openSlot(request, 24)
  const created = await bookAsCustomer(request, slot.startsAt)

  // お客様の面では「承りました」（`pending`）で、確定ではない。
  const mine = await request.get(`/api/public/reservations/${created.code}`, {
    headers: { 'X-Management-Code': created.managementCode },
  })
  expect((await mine.json()) as { status: string }).toMatchObject({ status: 'pending' })

  // お店の台帳では「確認待ち」に 1 件として数えられる（Web から入って担当が未定）。
  const ledger = await request.get('/api/staff/ledger', {
    ...(await authed(request)),
    params: { storeId: GINZA, date: slot.date, axis: 'staff' },
  })
  expect(ledger.status()).toBe(200)
  const view = (await ledger.json()) as { counts: { pendingReview: number } }
  expect(view.counts.pendingReview).toBeGreaterThanOrEqual(1)
})

// @e2e-covers UC-WEB-09
test('受付スタッフは、確認待ちで届いた Web 予約を確かめて確定できる', async ({ request }) => {
  const slot = await openSlot(request, 25)
  const created = await bookAsCustomer(request, slot.startsAt)

  // 届いたご予約は台帳に載り、担当が決まっていない（＝確認待ち）。
  const listed = await request.get('/api/staff/reservations', {
    ...(await authed(request)),
    params: { storeId: GINZA, from: slot.date, to: slot.date, limit: '50' },
  })
  expect(listed.status()).toBe(200)
  const items = ((await listed.json()) as { items: { id: string; startsAt: string }[] }).items
  const mine = items.find((row) => row.startsAt === slot.startsAt)
  expect(mine).toBeDefined()

  const detail = await request.get(`/api/staff/reservations/${(mine as { id: string }).id}`, {
    ...(await authed(request)),
  })
  expect(detail.status()).toBe(200)
  const before = (await detail.json()) as {
    version: number
    assignments: { targetId: string | null }[]
  }
  expect(before.assignments.every((row) => row.targetId === null)).toBe(true)

  // 確かめて担当を決めると、台帳の確定したご予約になる。
  const staffId = await freeStaffAt(request, {
    date: slot.date,
    startsAt: slot.startsAt,
    reservationId: (mine as { id: string }).id,
  })
  const confirmed = await request.patch(`/api/staff/reservations/${(mine as { id: string }).id}`, {
    ...(await authed(request)),
    data: { version: before.version, staffId },
  })
  expect(confirmed.status()).toBe(200)
  const after = (await confirmed.json()) as {
    assignments: { kind: string; targetId: string | null }[]
  }
  expect(after.assignments.some((row) => row.kind === 'staff' && row.targetId === staffId)).toBe(
    true,
  )

  /*
   * Web 予約そのものを承認する経路（`POST /api/staff/web-bookings/:id/review`）は
   * **店長だけ**が通れる。`web_bookings.id` を外へ出す一覧の経路はまだ無いので、
   * ここは門（権限と、無い id の断り方）を HTTP のふるまいで固定する
   * （`change.spec.ts` の UC-CHANGE-06 と同じ扱い）。
   */
  const unknown = await request.post(
    '/api/staff/web-bookings/00000000-0000-4000-8000-000000000000/review',
    { ...(await authed(request)), data: { decision: 'approve', reason: '' } },
  )
  expect(unknown.status()).toBe(404)

  await grant(request, ['store.read', 'reservation.read', 'customer.read', 'settings.read'])
  const refused = await request.post(
    '/api/staff/web-bookings/00000000-0000-4000-8000-000000000000/review',
    { ...(await authed(request)), data: { decision: 'approve', reason: '' } },
  )
  expect(refused.status()).toBe(403)
  await grant(request, MANAGER_PERMISSIONS)

  // お客様の面では、承認が下りるまで「承りました」のままである。
  const asCustomer = await request.get(`/api/public/reservations/${created.code}`, {
    headers: { 'X-Management-Code': created.managementCode },
  })
  expect((await asCustomer.json()) as { status: string }).toMatchObject({ status: 'pending' })
})

// @e2e-covers AC-WEB-22
test('台帳の「確認待ち」からその 1 件を確定すると、確認待ちの件数が 0 件になる', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, 26)
  await bookAsCustomer(request, slot.startsAt)

  // 端末の時計をその日の朝へ据える。台帳はその暦日を開く。
  await page.clock.setFixedTime(new Date(`${slot.date}T01:00:00.000Z`))
  await startWork(page)
  await page
    .getByRole('navigation', { name: '画面の切り替え' })
    .getByRole('button', { name: '予約台帳', exact: true })
    .click()
  await page
    .getByRole('group', { name: '表示のかたち' })
    .getByRole('button', { name: '予約リスト' })
    .click()

  const pending = page.getByRole('button', { name: '確認待ち 1件' })
  await expect(pending).toBeVisible()
  await pending.click()
  await expect(page.getByRole('button', { name: '内容を確認' })).toHaveCount(1)

  /*
   * 「確定する」は担当を決めることである —— 台帳の「確認待ち」は「Web から入って担当が
   * 未定」で数えるので、担当が決まった時点でその 1 件は確定したご予約に変わる。
   * 台帳の行の「内容を確認」からこの経路へ繋ぐ配線はまだ無いので、ここは
   * HTTP のふるまいで固定する（`change.spec.ts` の UC-CHANGE-06 と同じ扱い）。
   *
   * **お知らせ（ALERTS）の「Web予約がN件、確認待ちです」はまだ立たない** ——
   * `alerts` に `web_booking.pending` を積む経路が無いので、ここでは数えない。
   */
  const listed = await request.get('/api/staff/reservations', {
    ...(await authed(request)),
    params: { storeId: GINZA, from: slot.date, to: slot.date, limit: '50' },
  })
  const items = ((await listed.json()) as { items: { id: string; startsAt: string }[] }).items
  const mine = items.find((row) => row.startsAt === slot.startsAt)
  const detail = await request.get(`/api/staff/reservations/${(mine as { id: string }).id}`, {
    ...(await authed(request)),
  })
  const version = ((await detail.json()) as { version: number }).version
  const staffId = await freeStaffAt(request, {
    date: slot.date,
    startsAt: slot.startsAt,
    reservationId: (mine as { id: string }).id,
  })
  const assigned = await request.patch(`/api/staff/reservations/${(mine as { id: string }).id}`, {
    ...(await authed(request)),
    data: { version, staffId },
  })
  expect(assigned.status()).toBe(200)

  // 読み込み直すと器はトップへ戻るので、台帳をもう一度開いてから数え直す。
  await page.reload()
  await completeSeededTerminalStart(page)
  await page
    .getByRole('navigation', { name: '画面の切り替え' })
    .getByRole('button', { name: '予約台帳', exact: true })
    .click()
  await page
    .getByRole('group', { name: '表示のかたち' })
    .getByRole('button', { name: '予約リスト' })
    .click()
  await expect(page.getByRole('button', { name: '確認待ち 0件' })).toBeVisible()
  await expect(page.getByRole('button', { name: '内容を確認' })).toHaveCount(0)
})
