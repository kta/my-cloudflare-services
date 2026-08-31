import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * お客様向け Web 予約（011-web-booking）の受け入れ基準を、実ブラウザと実 Worker で確かめる。
 * `vite preview` が実 workerd を動かし、D1 は `seed.mjs` が入れた EYEX 銀座店である
 * （`playwright test` を叩くたびに使い捨ての D1 が作り直される）。
 *
 * このファイルは **iphone project（390×844）だけ**が拾う（`playwright.config.ts` の
 * `testMatch` が `/web-booking\.spec\.ts$/`）。店長側の 8 本は
 * `web-booking-settings.spec.ts`（ipad）にある。
 *
 * 1 本の test の直前の行に `// @e2e-covers <ID>` を置く。**1 ID = 1 test** で、
 * この 2 ファイルで UC-WEB-01..13 と AC-WEB-01..23 の 36 個をちょうど 1 回ずつ並べる。
 *
 * **時刻と日付をベタ書きしない。** ご予約は「いま」から先にしか取れないので、
 * 盤面（seed の 2026年8月27日）ではなく、走らせた日から数えた営業日を毎回引き当てる
 * （`openSlot`）。取った枠は `taken` に控えて二度使わない —— 1 本の e2e が埋めた枠を
 * 次の 1 本が「空いている」と思って押すと、走らせた順で結果が変わる。
 *
 * **盤面（D1）の扱い**: この面はご予約を作る。iphone project は project の並びで最後に
 * 走る（mock → mock-phone → ipad → iphone）ので、承認済みモックとの突き合わせと
 * 業務の e2e はこの面より先に済んでいる。作るのはすべて 2 週間以上先の日で、
 * seed の 8月27日 の 12 件には 1 度も触れない。
 */

/**
 * この e2e の tsconfig は Worker 向けで DOM の型を持たない（`tsconfig.base.json` の
 * `lib: ["ESNext"]`）。ブラウザの中だけで動くものは、使う分だけをここで宣言する
 * （`booking.spec.ts` と同じ作法）。
 */
declare const CompositionEvent: new (
  type: string,
  init?: { bubbles?: boolean; data?: string },
) => unknown

const ORG = 'eyex'
/** seed.mjs が固定 id で入れる EYEX 銀座店。公開しているのはこの 1 店だけである。 */
const SLUG = 'ginza'
const GINZA = '11111111-1111-4111-8111-111111111111'
/** seed の id は `${区分}-0000-4000-8000-${連番}`（`seed.mjs` の `uid`）。 */
const uid = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`
/** 新しいメガネを作る（60 分）。技能 `measure` を持つ担当が要る。 */
const NEW_GLASSES = uid('e0010000', 0)
/** かけ具合の調整（20 分）。必要資源を持たないので、枠を埋めずに 1 件だけ取りたいとき用。 */
const ADJUST = uid('e0010000', 1)
/** `.dev.vars` の dev 値。preview も同じ値を読む。 */
const INTERNAL_KEY = 'dev-internal-key'

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

/** お客様の 4 欄。承認済みモック WEB-04-FORM と同じ値を使う。 */
const CONTACT = {
  name: '山口 真央',
  kana: 'やまぐち まお',
  phone: '080-2345-6789',
  email: 'm.yamaguchi@example.jp',
} as const

/* --- 日付と時刻 ----------------------------------------------------------- */

/** JST の暦日（YYYY-MM-DD）。 */
function jstDay(at: Date | string = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date(at))
}

/** JST の暦日を日数ぶんずらす。 */
function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10)
}

/** 「11:30」。JST の時刻だけを読む。 */
function clock(at: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(at))
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** 日の札の読み上げ（「9月25日（金）」）。DateTimeStep の `longDay` と同じ形。 */
function dayLabel(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`)
  return `${day.getUTCMonth() + 1}月${day.getUTCDate()}日（${WEEKDAYS[day.getUTCDay()]}）`
}

/* --- 公開面を直に叩く ------------------------------------------------------ */

type PublicDay = {
  date: string
  isClosed: boolean
  isFull: boolean
  slots: { startsAt: string; isAvailable: boolean }[]
}

async function availability(
  request: APIRequestContext,
  input: { purposeId: string; from: string; to: string },
): Promise<PublicDay[]> {
  const res = await request.get(`/api/public/stores/${SLUG}/availability`, { params: input })
  expect(res.status()).toBe(200)
  return ((await res.json()) as { days: PublicDay[] }).days
}

/**
 * この走りで既に押さえた枠。**1 本の e2e が取った枠を次の 1 本に渡さない。**
 * 走らせる順が変わっても同じ結果になるようにするための控えである。
 */
const taken = new Set<string>()

/**
 * いまから `fromDays` 日より先で、まだ誰も取っていない枠を 1 つ引き当てる。
 * 受付は 30 日先までなので、見つからないまま 30 日を越えたら投げる（黙って古い日を返さない）。
 */
async function openSlot(
  request: APIRequestContext,
  input: { purposeId: string; fromDays: number },
): Promise<{ date: string; startsAt: string }> {
  const today = jstDay()
  for (let offset = input.fromDays; offset <= 30; offset += 7) {
    const from = shiftDay(today, offset)
    const days = await availability(request, {
      purposeId: input.purposeId,
      from,
      to: shiftDay(from, Math.min(6, 30 - offset)),
    })
    for (const day of days) {
      for (const slot of day.slots) {
        if (!slot.isAvailable || taken.has(slot.startsAt)) continue
        taken.add(slot.startsAt)
        return { date: day.date, startsAt: slot.startsAt }
      }
    }
  }
  throw new Error(`${input.fromDays} 日先から 30 日先までに空いている枠がない`)
}

type Booking = {
  code: string
  status: 'pending' | 'confirmed'
  startsAt: string
  endsAt: string
  storeName: string
  purposeName: string
  contactName: string
  managementCode: string
  emailed: boolean
}

/** ご予約を 1 件作る。前提づくりと突き合わせにだけ使う（画面の筋書きは UI から通す）。 */
async function book(
  request: APIRequestContext,
  input: { purposeId: string; startsAt: string; idempotencyKey?: string },
): Promise<Booking> {
  const res = await request.post(`/api/public/stores/${SLUG}/bookings`, {
    headers: input.idempotencyKey === undefined ? {} : { 'Idempotency-Key': input.idempotencyKey },
    data: {
      purposeId: input.purposeId,
      startsAt: input.startsAt,
      contactName: CONTACT.name,
      contactKana: CONTACT.kana,
      contactPhone: CONTACT.phone,
      contactEmail: CONTACT.email,
    },
  })
  expect(res.status()).toBe(200)
  return (await res.json()) as Booking
}

/** 業務側の JWT。台帳へ本当に移ったかを確かめるときだけ使う。 */
async function authed(request: APIRequestContext): Promise<{ headers: Record<string, string> }> {
  const res = await request.post('/api/auth/token', {
    data: { organizationId: ORG, role: 'staff' },
  })
  expect(res.status()).toBe(200)
  return { headers: { authorization: `Bearer ${((await res.json()) as { token: string }).token}` } }
}

/** 公開の設定。`PUT` は `storeId` / `landingPath` / `updatedAt` を受け取らない。 */
type WebSettings = {
  isPublished: boolean
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

/** 読んだ設定を、そのまま保存へ返せる形にする（サーバが決める列を落とす）。 */
function toInput(settings: WebSettings): WebSettings {
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

/** admin からの担当店舗の配信を模す。台帳を読む 2 本だけが要る。 */
async function grantManager(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/internal/store-memberships/sync', {
    headers: { 'x-internal-key': INTERNAL_KEY },
    data: {
      id: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f',
      organizationId: ORG,
      storeId: GINZA,
      userId: `dev:${ORG}`,
      permissions: [
        'store.read',
        'store.manage',
        'reservation.read',
        'reservation.write',
        'customer.read',
        'customer.write',
        'settings.read',
        'settings.manage',
      ],
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  })
  expect(res.status()).toBe(200)
}

/* --- 画面を通す ------------------------------------------------------------ */

/** 工程 3（日時）まで。`/w/ginza` は店舗を選んだ状態で開く。 */
async function toDateTime(page: Page, purposeName = '新しいメガネを作る'): Promise<void> {
  await page.goto(`/w/${SLUG}`)
  await expect(page.getByRole('heading', { name: 'ご希望の店舗をお選びください' })).toBeVisible()
  await page.getByRole('button', { name: /で予約を進める$/ }).click()
  // 押すのは `sr-only` の radio ではなく、それを包む札そのもの（お客様が触るのはここ）。
  await page.getByText(purposeName, { exact: true }).click()
  await expect(page.getByRole('radio', { name: new RegExp(purposeName) })).toBeChecked()
  await page.getByRole('button', { name: '日時を選ぶ' }).click()
  await expect(page.getByRole('heading', { name: 'ご希望の日時をお選びください' })).toBeVisible()
}

/**
 * 週を送って目当ての日を出す。
 *
 * **「札が出ていないから次の週へ」と数えない。**週を読み込んでいる間は札が 1 枚も無いので、
 * それを「この週に無い」と読むと読み込みの速さで送る回数が変わる。週の頭は必ず今日で、
 * 送りは 7 日ずつなので、送る回数は日付から先に決まる。
 */
async function revealDay(page: Page, date: string): Promise<void> {
  const hops = Math.floor(
    (Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${jstDay()}T00:00:00.000Z`)) /
      MS_PER_DAY /
      7,
  )
  for (let hop = 0; hop < hops; hop += 1) {
    await page.getByRole('button', { name: '次の週' }).click()
  }
  // 定休の日は札の名前が「9月30日（水）　定休」になるので、頭だけで当てる。
  await expect(
    page.getByRole('button', { name: new RegExp(`^${escaped(dayLabel(date))}`) }),
  ).toHaveCount(1)
}
/** 正規表現に入れる前に記号を逃がす。 */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 工程 4（お客様の情報）まで。 */
async function toForm(page: Page, slot: { date: string; startsAt: string }): Promise<void> {
  await revealDay(page, slot.date)
  await page.getByRole('button', { name: dayLabel(slot.date), exact: true }).click()
  await page.getByRole('button', { name: clock(slot.startsAt), exact: true }).click()
  await page.getByRole('button', { name: 'お客様の情報を入力する' }).click()
  await expect(page.getByRole('heading', { name: 'お客様のことを教えてください' })).toBeVisible()
}

/** 4 欄を埋めて工程 5（ご確認）へ。 */
async function toConfirm(page: Page): Promise<void> {
  await page.getByLabel('お名前').fill(CONTACT.name)
  await page.getByLabel('ふりがな').fill(CONTACT.kana)
  await page.getByLabel('お電話番号').fill(CONTACT.phone)
  await page.getByLabel('メールアドレス').fill(CONTACT.email)
  await page.getByRole('button', { name: '入力内容を確認する' }).click()
  await expect(page.getByRole('heading', { name: 'この内容でお間違いないですか' })).toBeVisible()
}

/** 工程 6（完了）まで通す。返すのは画面に出たご予約番号と確認番号である。 */
async function toDone(
  page: Page,
  slot: { date: string; startsAt: string },
  purposeName = '新しいメガネを作る',
): Promise<{ code: string; managementCode: string }> {
  await toDateTime(page, purposeName)
  await toForm(page, slot)
  await toConfirm(page)
  await page.getByRole('button', { name: 'この内容で予約する' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()
  return {
    code: await lastLine(page.getByRole('group', { name: 'ご予約番号' })),
    managementCode: await lastLine(page.getByRole('group', { name: '確認番号' })),
  }
}

/** 番号の箱は「見出し＋値」の 2 行。値だけを読む。 */
async function lastLine(box: Locator): Promise<string> {
  const lines = (await box.innerText()).split('\n').map((line) => line.trim())
  return lines[lines.length - 1] ?? ''
}

/** WEB-CANCEL の本人確認を通し、明細を出す。 */
async function openManage(
  page: Page,
  keys: { code: string; managementCode: string },
): Promise<void> {
  await page.goto(`/w/${SLUG}/manage`)
  await expect(page.getByRole('heading', { name: 'ご予約をお調べします' })).toBeVisible()
  await page.getByLabel('ご予約番号').fill(keys.code)
  await page.getByLabel('確認番号').fill(keys.managementCode)
  await page.getByRole('button', { name: 'ご予約をお調べする' }).click()
}

/* ========================================================================== *
 * 1. 選ぶ（WEB-01-STORE / WEB-02-PURPOSE）
 * ========================================================================== */

// @e2e-covers UC-WEB-03
test('公開している店舗だけが並び、公開していない店舗の slug は存在ごと出ない', async ({
  request,
}) => {
  const res = await request.get('/api/public/stores')
  expect(res.status()).toBe(200)
  const stores = (await res.json()) as { slug: string; name: string; accessNote: string }[]
  expect(stores.map((store) => store.slug)).toEqual([SLUG])

  /*
   * 丸の内店は seed に実在するが、Web 予約の設定を持たない。**「無い」と同じ答え**を
   * 返すこと（status も body も）が、slug の実在を外に漏らさない証明である。
   */
  const hidden = await request.get('/api/public/stores/marunouchi')
  const missing = await request.get('/api/public/stores/no-such-store')
  expect(hidden.status()).toBe(404)
  expect(missing.status()).toBe(404)
  expect(await hidden.json()).toEqual(await missing.json())
})

// @e2e-covers UC-WEB-04
test('ご用件は対客名と目安の分数だけを持ち、技能も設備も担当も返さない', async ({ request }) => {
  const res = await request.get(`/api/public/stores/${SLUG}/purposes`)
  expect(res.status()).toBe(200)
  const purposes = (await res.json()) as { id: string; name: string; durationMinutes: number }[]

  /*
   * **件数をベタ書きしない。**ipad project の `store-settings.spec.ts` は目的を足す経路を
   * 通り、消す経路を持たない（あちらの決め）。数えるのはやめて、形と中身だけを見る。
   */
  for (const purpose of purposes) {
    expect(Object.keys(purpose).sort()).toEqual(['durationMinutes', 'id', 'name'])
  }
  expect(purposes.map((purpose) => purpose.name)).toEqual(
    expect.arrayContaining([
      '新しいメガネを作る',
      'かけ具合の調整',
      'できあがりの受け取り',
      'コンタクトのご相談',
      '視力測定',
    ]),
  )
  // Web に出さない目的（`is_web_published='0'`）は 1 件も混じらない。
  expect(purposes.map((purpose) => purpose.name)).not.toContain('修理・部品の交換')
  expect(purposes.find((purpose) => purpose.name === '新しいメガネを作る')).toMatchObject({
    durationMinutes: 60,
  })
})

// @e2e-covers AC-WEB-03
test('ご用件には対客名だけが並び、業務の中での呼び方は 1 つも出ない', async ({ page }) => {
  await page.goto(`/w/${SLUG}`)
  await page.getByRole('button', { name: /で予約を進める$/ }).click()
  await expect(page.getByRole('heading', { name: 'ご用件をお選びください' })).toBeVisible()

  const main = page.getByRole('main')
  for (const publicName of [
    '新しいメガネを作る',
    'かけ具合の調整',
    'できあがりの受け取り',
    'コンタクトのご相談',
    '視力測定',
  ]) {
    await expect(main.getByRole('radio', { name: new RegExp(publicName) })).toHaveCount(1)
  }
  // 店内名（`visit_purposes.name_internal`）と、Web に出さない目的は 1 つも出ない。
  for (const internalName of [
    'メガネを新しく作る',
    '今のメガネを調整したい',
    'できあがりを受け取る',
    '視力測定だけ',
    '修理・部品の交換',
  ]) {
    await expect(main.getByText(internalName, { exact: true })).toHaveCount(0)
  }
})

/* ========================================================================== *
 * 2. 日時（WEB-03-DATETIME）
 * ========================================================================== */

// @e2e-covers UC-WEB-05
test('一週間ぶんの日と、選んだ日の時刻が同じ画面で読める', async ({ page, request }) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 3 })
  await toDateTime(page, 'かけ具合の調整')

  await revealDay(page, slot.date)
  // 7 日ぶんの札が一度に出る（週の送りは「‹」「›」の 2 つだけ）。
  await expect(page.getByRole('button', { name: /^\d+月\d+日（.）/ })).toHaveCount(7)
  await page.getByRole('button', { name: dayLabel(slot.date), exact: true }).click()

  await expect(page.getByRole('heading', { name: `${dayLabel(slot.date)}のお時間` })).toBeVisible()
  await expect(page.getByRole('button', { name: clock(slot.startsAt), exact: true })).toBeVisible()
})

// @e2e-covers AC-WEB-04
test('受け付ける時間が 10:30–18:00 なので、10:30 より前と 18:00 以降の時刻は候補に出ない', async ({
  request,
}) => {
  const today = jstDay()
  const days = await availability(request, {
    purposeId: ADJUST,
    from: shiftDay(today, 3),
    to: shiftDay(today, 9),
  })
  const open = days.filter((day) => !day.isClosed && day.slots.length > 0)
  expect(open.length).toBeGreaterThan(0)

  for (const day of open) {
    for (const slot of day.slots) {
      expect(clock(slot.startsAt) >= '10:30').toBe(true)
      expect(clock(slot.startsAt) < '18:00').toBe(true)
    }
  }
})

// @e2e-covers AC-WEB-05
test('30 日先ちょうどの日は選べ、その先の週へは送れない', async ({ page, request }) => {
  const today = jstDay()
  const last = shiftDay(today, 30)

  /*
   * 30 日先までは選べる時刻があり、31 日先からは 1 つも選べない。
   * **暦日をベタ書きしない** —— 走らせた日によっては 30 日先ちょうどが定休（火曜）や
   * 臨時のお休みに当たるので、最後の週（24〜30 日先）に 1 つでも空きがあること、
   * その先の週（31〜34 日先）には時刻が 1 つも無いことで境目を押さえる。
   */
  const inside = await availability(request, {
    purposeId: ADJUST,
    from: shiftDay(today, 24),
    to: last,
  })
  const outside = await availability(request, {
    purposeId: ADJUST,
    from: shiftDay(today, 31),
    to: shiftDay(today, 34),
  })
  expect(inside.some((day) => day.slots.some((slot) => slot.isAvailable))).toBe(true)
  expect(outside.some((day) => day.slots.some((slot) => slot.isAvailable))).toBe(false)

  await toDateTime(page, 'かけ具合の調整')
  await revealDay(page, last)
  // 30 日先を含む週が最後の週。ここから先へは送れない。
  await expect(page.getByRole('button', { name: '次の週' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await expect(
    page.getByRole('button', { name: new RegExp(`^${escaped(dayLabel(last))}`) }),
  ).toBeVisible()
})

// @e2e-covers AC-WEB-06
test('受付を開始するのが N 時間先からなら、その手前の時刻は 1 つも出ず、境目の時刻は出る', async ({
  request,
}) => {
  await grantManager(request)
  const headers = (await authed(request)).headers
  const before = await request.get(`/api/staff/web-booking-settings/${GINZA}`, { headers })
  expect(before.status()).toBe(200)
  const saved = toInput((await before.json()) as WebSettings)

  const today = jstDay()
  const window = { from: today, to: shiftDay(today, 6) }
  const put = async (acceptFromHours: number, version: number): Promise<number> => {
    const res = await request.put(`/api/staff/web-booking-settings/${GINZA}`, {
      headers,
      data: { ...saved, acceptFromHours, version },
    })
    expect(res.status()).toBe(200)
    return ((await res.json()) as { version: number }).version
  }

  try {
    // 受付開始を 0 時間先にしたときの全枠が「あとは何時間先かだけで決まる」土台になる。
    const openedVersion = await put(0, saved.version)
    const all = (await availability(request, { purposeId: ADJUST, ...window })).flatMap(
      (day) => day.slots,
    )

    const hours = 30
    await put(hours, openedVersion)
    const limited = (await availability(request, { purposeId: ADJUST, ...window })).flatMap(
      (day) => day.slots,
    )

    const threshold = Date.now() + hours * MS_PER_HOUR
    // ちょうど境目の時刻は残り、1 分でも手前の時刻は 1 つも残らない。
    expect(limited.map((slot) => slot.startsAt)).toEqual(
      all.filter((slot) => Date.parse(slot.startsAt) >= threshold).map((slot) => slot.startsAt),
    )
    expect(limited.every((slot) => Date.parse(slot.startsAt) >= threshold)).toBe(true)
  } finally {
    const now = await request.get(`/api/staff/web-booking-settings/${GINZA}`, { headers })
    const current = (await now.json()) as WebSettings
    await request.put(`/api/staff/web-booking-settings/${GINZA}`, {
      headers,
      data: { ...saved, version: current.version },
    })
  }
})

// @e2e-covers AC-WEB-09
test('埋まった時刻は「満」と出て押せず、定休の日は「定休」と出て押せない', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: NEW_GLASSES, fromDays: 17 })
  // 同時に受けられるのは 3 件（`store_slot_rules.max_parallel`）。3 件で埋まる。
  for (let n = 0; n < 3; n += 1) {
    await book(request, { purposeId: NEW_GLASSES, startsAt: slot.startsAt })
  }

  await toDateTime(page)
  await revealDay(page, slot.date)
  await page.getByRole('button', { name: dayLabel(slot.date), exact: true }).click()

  const full = page.getByRole('button', { name: `${clock(slot.startsAt)}　満` })
  await expect(full).toHaveAttribute('aria-disabled', 'true')
  // `disabled` 属性にしないので指は当たる。当たっても選ばれないことを見る。
  await full.click({ force: true })
  await expect(full).toHaveAttribute('aria-pressed', 'false')

  /*
   * 定休の札。**「火曜」と決め打ちしない** —— 営業日は設定の e2e が触りうるので、
   * いま出している週のどの日が休みかはサーバに聞く。
   */
  const weekStart = shiftDay(
    jstDay(),
    Math.floor(
      (Date.parse(`${slot.date}T00:00:00.000Z`) - Date.parse(`${jstDay()}T00:00:00.000Z`)) /
        MS_PER_DAY /
        7,
    ) * 7,
  )
  const week = await availability(request, {
    purposeId: NEW_GLASSES,
    from: weekStart,
    to: shiftDay(weekStart, 6),
  })
  const closedDate = week.find((day) => day.isClosed)?.date
  expect(closedDate).toBeDefined()

  const closed = page.getByRole('button', { name: `${dayLabel(closedDate as string)}　定休` })
  await expect(closed).toHaveAttribute('aria-disabled', 'true')
  await closed.click({ force: true })
  // 押しても時刻の一覧は開いた日のまま（定休の日の時刻は 1 つも出ない）。
  await expect(page.getByRole('heading', { name: `${dayLabel(slot.date)}のお時間` })).toBeVisible()
})

/* ========================================================================== *
 * 3. 伺う・読み返す・送る（WEB-04〜WEB-06）
 * ========================================================================== */

// @e2e-covers UC-WEB-06
test('お名前・ふりがな・お電話番号・メールアドレスを入れ、ご確認の 5 行で読み返せる', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 4 })
  await toDateTime(page, 'かけ具合の調整')
  await toForm(page, slot)
  await toConfirm(page)

  for (const [term, value] of [
    ['ご来店', clock(slot.startsAt)],
    ['店舗', 'EYEX 銀座店（銀座4丁目）'],
    ['ご用件', 'かけ具合の調整'],
    ['お名前', `${CONTACT.name} 様`],
    ['ご連絡先', CONTACT.phone],
  ] as const) {
    await expect(page.getByRole('group', { name: term })).toContainText(value)
  }
  // 「変更」でその工程へ戻れ、伺った内容は消えない。
  await page.getByRole('button', { name: 'お名前を変更する' }).click()
  await expect(page.getByLabel('お名前')).toHaveValue(CONTACT.name)
})

// @e2e-covers AC-WEB-08
test('6 歩の見出しが順に変わり、上の帯の読み上げが 1 つ目から 5 つ目まで進む', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 5 })
  await page.goto(`/w/${SLUG}`)

  await expect(page.getByRole('heading', { name: 'ご希望の店舗をお選びください' })).toBeVisible()
  await expect(page.getByRole('img', { name: '全6ステップのうち1つ目です' })).toBeVisible()

  await page.getByRole('button', { name: /で予約を進める$/ }).click()
  await expect(page.getByRole('heading', { name: 'ご用件をお選びください' })).toBeVisible()
  await expect(page.getByRole('img', { name: '全6ステップのうち2つ目です' })).toBeVisible()

  await page.getByText('かけ具合の調整', { exact: true }).click()
  await page.getByRole('button', { name: '日時を選ぶ' }).click()
  await expect(page.getByRole('heading', { name: 'ご希望の日時をお選びください' })).toBeVisible()
  await expect(page.getByRole('img', { name: '全6ステップのうち3つ目です' })).toBeVisible()

  await toForm(page, slot)
  await expect(page.getByRole('img', { name: '全6ステップのうち4つ目です' })).toBeVisible()

  await toConfirm(page)
  await expect(page.getByRole('img', { name: '全6ステップのうち5つ目です' })).toBeVisible()
})

// @e2e-covers AC-WEB-19
test('お電話番号は数字のキーボード、メールアドレスはメール用が出て、端末の記憶から入れられる', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 6 })
  await toDateTime(page, 'かけ具合の調整')
  await toForm(page, slot)

  const phone = page.getByLabel('お電話番号')
  await expect(phone).toHaveAttribute('type', 'tel')
  await expect(phone).toHaveAttribute('inputmode', 'numeric')
  await expect(phone).toHaveAttribute('autocomplete', 'tel')

  const email = page.getByLabel('メールアドレス')
  await expect(email).toHaveAttribute('type', 'email')
  await expect(email).toHaveAttribute('inputmode', 'email')
  await expect(email).toHaveAttribute('autocomplete', 'email')

  await expect(page.getByLabel('お名前')).toHaveAttribute('autocomplete', 'name')
  // ふりがなは端末が覚える枠を持たないので、`autocomplete` そのものを置かない。
  await expect(page.getByLabel('ふりがな')).not.toHaveAttribute('autocomplete', /.*/)
})

// @e2e-covers AC-WEB-20
test('お名前の変換を確定するとふりがなが一度だけ入り、自分で直した値は上書きされない', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 7 })
  await toDateTime(page, 'かけ具合の調整')
  await toForm(page, slot)

  const name = page.getByLabel('お名前')
  const kana = page.getByLabel('ふりがな')

  /*
   * 日本語入力の変換を、ブラウザが出すのと同じ順で起こす（`booking.spec.ts` と同じ作法）。
   * 変換の**途中**（compositionupdate）では入らず、確定（compositionend）で 1 度だけ入る。
   */
  await name.click()
  await name.evaluate((node) =>
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
  )
  await name.fill('やまぐ')
  await name.evaluate((node) =>
    node.dispatchEvent(
      new CompositionEvent('compositionupdate', { bubbles: true, data: 'やまぐ' }),
    ),
  )
  await expect(kana).toHaveValue('')

  await name.fill('やまぐち まお')
  await name.evaluate((node) =>
    node.dispatchEvent(
      new CompositionEvent('compositionupdate', { bubbles: true, data: 'やまぐち まお' }),
    ),
  )
  await name.fill('山口 真央')
  await name.evaluate((node) =>
    node.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '山口 真央' }),
    ),
  )

  await expect(name).toHaveValue(CONTACT.name)
  await expect(kana).toHaveValue(CONTACT.kana)
  await expect(page.getByText('自動で入れました')).toBeVisible()

  // お客様が自分で直したら、そのあとは自動で埋め直さない。
  await kana.fill('やまぐち まさお')
  await expect(page.getByText('自動で入れました')).toHaveCount(0)
  await name.click()
  await name.evaluate((node) =>
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
  )
  await name.fill('やまぐち まお')
  await name.evaluate((node) =>
    node.dispatchEvent(
      new CompositionEvent('compositionupdate', { bubbles: true, data: 'やまぐち まお' }),
    ),
  )
  await name.fill('山口 真央')
  await name.evaluate((node) =>
    node.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '山口 真央' }),
    ),
  )
  await expect(kana).toHaveValue('やまぐち まさお')
})

// @e2e-covers AC-WEB-21
test('お電話番号に焦点があっても、主操作と入力中の欄はどちらも画面の中に見えている', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 8 })
  await toDateTime(page, 'かけ具合の調整')
  await toForm(page, slot)

  const phone = page.getByLabel('お電話番号')
  await phone.click()
  await expect(phone).toBeFocused()

  const action = page.getByRole('button', { name: '入力内容を確認する' })
  await expect(action).toBeInViewport()
  await expect(phone).toBeInViewport()

  /*
   * ソフトキーボードは Chromium に無いので、出た高さは `visualViewport` の縮みで表す。
   * 下の固定はその縮みぶんだけ持ち上がる（`FormStep` の `useKeyboardInset`）。
   */
  const bottom = await action.evaluate((node) => node.parentElement?.getAttribute('style') ?? '')
  expect(bottom).toContain('env(safe-area-inset-bottom)')
})

// @e2e-covers AC-WEB-18
test('送信している間はボタンが送信中だと言い、二度押しても 2 本目を投げない', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 9 })
  let sent = 0
  let opened = false
  // 送信の途中で止めておく。`route` の中で「まだ通すな」を読み続ける。
  const held = new Promise<void>((resolve) => {
    const wait = setInterval(() => {
      if (!opened) return
      clearInterval(wait)
      resolve()
    }, 50)
  })
  await page.route(
    (url) => url.pathname === `/api/public/stores/${SLUG}/bookings`,
    async (route) => {
      sent += 1
      await held
      await route.continue()
    },
  )

  await toDateTime(page, 'かけ具合の調整')
  await toForm(page, slot)
  await toConfirm(page)

  const submit = page.getByRole('button', { name: 'この内容で予約する' })
  await submit.click()

  const busy = page.getByRole('button', { name: '送信しています…' })
  await expect(busy).toBeVisible()
  await expect(busy).toHaveAttribute('aria-busy', 'true')
  await expect(busy).toHaveAttribute('aria-disabled', 'true')
  // `disabled` 属性にしないので、焦点はボタンに残ったままである。
  await expect(busy).toBeFocused()

  await busy.click({ force: true })
  await busy.click({ force: true })
  expect(sent).toBe(1)

  opened = true
  await expect(page.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()
})

// @e2e-covers UC-WEB-07
test('送るとご予約番号と確認番号を受け取り、確認番号は保存されずハッシュだけが残る', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 10 })
  const keys = await toDone(page, slot, 'かけ具合の調整')

  expect(keys.code).toMatch(/^EY-W-\d{4}-\d{4,5}$/)
  expect(keys.managementCode).toMatch(/^[0-9A-Z]{8,}$/)

  // 確認番号は照会の応答に 1 度も出ない（平文が出るのは作った 1 回だけである）。
  const res = await request.get(`/api/public/reservations/${keys.code}`, {
    headers: { 'X-Management-Code': keys.managementCode },
  })
  expect(res.status()).toBe(200)
  expect(JSON.stringify(await res.json())).not.toContain(keys.managementCode)
})

// @e2e-covers AC-WEB-10
test('ご確認に「まだ確定していません。」が出て、送ると番号 2 つが出て「‹」が消える', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 11 })
  await toDateTime(page, 'かけ具合の調整')
  await toForm(page, slot)
  await toConfirm(page)

  await expect(page.getByText('まだ確定していません。')).toBeVisible()
  await expect(page.getByRole('button', { name: '前の画面へ戻る' })).toBeVisible()

  await page.getByRole('button', { name: 'この内容で予約する' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()

  await expect(page.getByRole('group', { name: 'ご予約番号' })).toContainText(/EY-W-\d{4}-\d{4,5}/)
  await expect(page.getByRole('group', { name: '確認番号' })).toBeVisible()
  await expect(page.getByText('ご変更・お取り消しのときにお使いください。')).toBeVisible()
  await expect(page.getByRole('button', { name: '前の画面へ戻る' })).toHaveCount(0)
})

// @e2e-covers AC-WEB-17
test('確認のメールを送れなくても予約は成立し、送れなかったことをその場で伝える', async ({
  page,
  request,
}) => {
  /*
   * preview には通知サービス（notifier）が繋がっていないので、確認のメールは必ず落ちる。
   * **予約はそれでも成立する**（`04-api.md` §7.2）という筋書きがそのまま出る。
   */
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 12 })
  const keys = await toDone(page, slot, 'かけ具合の調整')

  await expect(page.getByText('確認のメールをお送りしました。')).toHaveCount(0)
  await expect(
    page.getByText(
      'この画面のご予約番号と確認番号をお控えください。メールはお送りできませんでした。',
    ),
  ).toBeVisible()

  // 送れなかったことはお店側にも残る（`emailed: false`）。予約そのものは残っている。
  const res = await request.get(`/api/public/reservations/${keys.code}`, {
    headers: { 'X-Management-Code': keys.managementCode },
  })
  expect(res.status()).toBe(200)
  expect((await res.json()) as { code: string }).toMatchObject({ code: keys.code })
})

// @e2e-covers UC-WEB-12
test('確認のメールが落ちても予約は巻き戻らず、送れなかった事実が応答に残る', async ({
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 13 })
  const created = await book(request, { purposeId: ADJUST, startsAt: slot.startsAt })

  expect(created.emailed).toBe(false)
  // 台帳には残っている（メールの成否を予約の成否に混ぜない）。
  const res = await request.get(`/api/public/reservations/${created.code}`, {
    headers: { 'X-Management-Code': created.managementCode },
  })
  expect(res.status()).toBe(200)
  expect((await res.json()) as { startsAt: string }).toMatchObject({ startsAt: slot.startsAt })
})

// @e2e-covers UC-WEB-11
test('同じ Idempotency-Key で二度送っても、返る番号は同じで予約は 1 件しかできない', async ({
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 14 })
  const key = `e2e-${slot.startsAt}`
  const first = await book(request, {
    purposeId: ADJUST,
    startsAt: slot.startsAt,
    idempotencyKey: key,
  })
  const again = await book(request, {
    purposeId: ADJUST,
    startsAt: slot.startsAt,
    idempotencyKey: key,
  })

  expect(again.code).toBe(first.code)
  expect(again.managementCode).toBe(first.managementCode)

  await grantManager(request)
  const ledger = await request.get('/api/staff/reservations', {
    ...(await authed(request)),
    params: { storeId: GINZA, from: slot.date, to: slot.date, limit: '50' },
  })
  expect(ledger.status()).toBe(200)
  const items = ((await ledger.json()) as { items: { startsAt: string; source: string }[] }).items
  expect(
    items.filter((row) => row.startsAt === slot.startsAt && row.source === 'web'),
  ).toHaveLength(1)
})

// @e2e-covers AC-WEB-11
test('回線が切れて同じ内容がもう一度送られても、台帳の予約は 1 件のままである', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 15 })
  let sent = 0
  await page.route(
    (url) => url.pathname === `/api/public/stores/${SLUG}/bookings`,
    async (route) => {
      sent += 1
      // 1 本目は返事が届かなかったことにする（回線が切れた）。予約そのものは通っている。
      if (sent === 1) {
        await route.fetch()
        await route.abort('connectionreset')
        return
      }
      await route.continue()
    },
  )

  await toDateTime(page, 'かけ具合の調整')
  await toForm(page, slot)
  await toConfirm(page)
  await page.getByRole('button', { name: 'この内容で予約する' }).click()
  // 1 本目が落ちても入力は残り、同じ鍵のままもう一度押せる。
  await expect(page.getByRole('button', { name: 'この内容で予約する' })).toBeVisible()
  await page.getByRole('button', { name: 'この内容で予約する' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()

  expect(sent).toBe(2)
  await grantManager(request)
  const ledger = await request.get('/api/staff/reservations', {
    ...(await authed(request)),
    params: { storeId: GINZA, from: slot.date, to: slot.date, limit: '50' },
  })
  const items = ((await ledger.json()) as { items: { startsAt: string; source: string }[] }).items
  expect(
    items.filter((row) => row.startsAt === slot.startsAt && row.source === 'web'),
  ).toHaveLength(1)
})

// @e2e-covers AC-WEB-23
test('「地図・道順を見る」で店舗の住所を持った地図が開き、戻ると番号が読める完了の画面が残る', async ({
  page,
  context,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 16 })
  const keys = await toDone(page, slot, 'かけ具合の調整')

  // 外の地図そのものは開かない（走らせる場所に外向きの回線があるとは限らない）。
  await context.route('https://www.google.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>地図</title>' }),
  )
  const map = page.getByRole('link', { name: '地図・道順を見る' })
  await expect(map).toHaveAttribute('target', '_blank')
  await expect(map).toHaveAttribute(
    'href',
    new RegExp(encodeURIComponent('東京都中央区銀座4-5-6').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  )

  const opened = context.waitForEvent('page')
  await map.click()
  const external = await opened
  expect(external.url()).toContain('google.com/maps')
  await external.close()

  await expect(page.getByRole('group', { name: 'ご予約番号' })).toContainText(keys.code)
  await expect(page.getByRole('group', { name: '確認番号' })).toContainText(keys.managementCode)
})

/* ========================================================================== *
 * 4. 確かめる・変える・取り消す（WEB-CANCEL）
 * ========================================================================== */

// @e2e-covers UC-WEB-08
test('ご予約番号と確認番号だけで自分の予約に戻れ、番号が 1 つでも違えば戻れない', async ({
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 17 })
  const created = await book(request, { purposeId: ADJUST, startsAt: slot.startsAt })

  const ok = await request.get(`/api/public/reservations/${created.code}`, {
    headers: { 'X-Management-Code': created.managementCode },
  })
  expect(ok.status()).toBe(200)

  const wrongCode = await request.get('/api/public/reservations/EY-W-2601-9999', {
    headers: { 'X-Management-Code': created.managementCode },
  })
  const wrongManagement = await request.get(`/api/public/reservations/${created.code}`, {
    headers: { 'X-Management-Code': 'ZZZZZZZZ' },
  })
  // 無い番号と番号違いを**同じ status・同じ body**にする（予約の有無を漏らさない）。
  expect(wrongCode.status()).toBe(401)
  expect(wrongManagement.status()).toBe(401)
  expect(await wrongCode.json()).toEqual(await wrongManagement.json())
})

// @e2e-covers AC-WEB-12
test('完了の番号 2 つで照会すると「ご予約をお調べしました」と 5 行が出る', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 18 })
  const keys = await toDone(page, slot, 'かけ具合の調整')

  await page.getByRole('button', { name: '予約を変更・取り消す' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約をお調べします' })).toBeVisible()
  await page.getByLabel('ご予約番号').fill(keys.code)
  await page.getByLabel('確認番号').fill(keys.managementCode)
  await page.getByRole('button', { name: 'ご予約をお調べする' }).click()

  await expect(page.getByRole('heading', { name: 'ご予約をお調べしました' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'ご来店' })).toContainText(clock(slot.startsAt))
  await expect(page.getByRole('group', { name: '店舗' })).toContainText('EYEX 銀座店（銀座4丁目）')
  await expect(page.getByRole('group', { name: 'ご用件' })).toContainText('かけ具合の調整')
  await expect(page.getByRole('group', { name: 'お名前' })).toContainText(`${CONTACT.name} 様`)
  await expect(page.getByRole('group', { name: 'ご予約番号' })).toContainText(keys.code)
})

// @e2e-covers AC-WEB-13
test('日時を変更すると「ご来店」が新しい時刻になり、お店の台帳でも同じ時刻に移る', async ({
  page,
  request,
}) => {
  const from = await openSlot(request, { purposeId: ADJUST, fromDays: 19 })
  const to = await openSlot(request, { purposeId: ADJUST, fromDays: 20 })
  const created = await book(request, { purposeId: ADJUST, startsAt: from.startsAt })

  await openManage(page, created)
  await expect(page.getByRole('group', { name: 'ご来店' })).toContainText(clock(from.startsAt))

  await page.getByRole('button', { name: '日時を変更する' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約の変更' })).toBeVisible()
  await revealDay(page, to.date)
  await page.getByRole('button', { name: dayLabel(to.date), exact: true }).click()
  await page.getByRole('button', { name: clock(to.startsAt), exact: true }).click()
  await page.getByRole('button', { name: 'お客様の情報を入力する' }).click()

  await expect(page.getByRole('heading', { name: 'ご予約をお調べしました' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'ご来店' })).toContainText(clock(to.startsAt))

  await grantManager(request)
  const ledger = await request.get('/api/staff/reservations', {
    ...(await authed(request)),
    params: { storeId: GINZA, from: to.date, to: to.date, limit: '50' },
  })
  const items = ((await ledger.json()) as { items: { startsAt: string }[] }).items
  expect(items.some((row) => row.startsAt === to.startsAt)).toBe(true)
})

// @e2e-covers AC-WEB-14
test('取り消すと「ご予約を取り消しました」が出て、同じ番号ではもう一度取り消せない', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 21 })
  const created = await book(request, { purposeId: ADJUST, startsAt: slot.startsAt })

  await openManage(page, created)
  await page.getByRole('button', { name: 'この予約を取り消す' }).click()
  // 取り消しの確認だけ `role="alertdialog"` で問い直す。
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'この予約を取り消す（確定）' }).click()

  await expect(page.getByRole('heading', { name: 'ご予約を取り消しました' })).toBeVisible()
  await expect(page.getByText('またのご来店をお待ちしております。')).toBeVisible()
  await expect(page.getByRole('button', { name: '日時を変更する' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'この予約を取り消す' })).toHaveCount(0)

  const twice = await request.post(`/api/public/reservations/${created.code}/cancel`, {
    headers: { 'X-Management-Code': created.managementCode },
    data: { reason: '' },
  })
  expect(twice.status()).toBe(409)
})

// @e2e-covers AC-WEB-15
test('前日の終わりを過ぎていると、変更も取消も押せず、お電話でのご連絡をお願いする', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 22 })
  const created = await book(request, { purposeId: ADJUST, startsAt: slot.startsAt })

  // 端末の時計だけを来店日の朝へ進める（サーバの時計には触らない）。
  await page.clock.setFixedTime(new Date(`${slot.date}T00:30:00.000Z`))
  await openManage(page, created)

  await expect(page.getByRole('heading', { name: 'ご予約をお調べしました' })).toBeVisible()
  await expect(page.getByRole('button', { name: '日時を変更する' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'この予約を取り消す' })).toHaveCount(0)
  await expect(page.getByText(/03-3571-0001 までお電話でお願いいたします。$/)).toBeVisible()

  // 日時も状態も変わっていない。
  const res = await request.get(`/api/public/reservations/${created.code}`, {
    headers: { 'X-Management-Code': created.managementCode },
  })
  expect((await res.json()) as { startsAt: string; status: string }).toMatchObject({
    startsAt: slot.startsAt,
    status: 'pending',
  })
})

// @e2e-covers AC-WEB-16
test('確認番号が違うと明細は 1 行も出ず、どちらの番号が違うかも言わない', async ({
  page,
  request,
}) => {
  const slot = await openSlot(request, { purposeId: ADJUST, fromDays: 23 })
  const created = await book(request, { purposeId: ADJUST, startsAt: slot.startsAt })

  await openManage(page, { code: created.code, managementCode: 'ZZZZZZZZ' })
  await expect(
    page.getByText('ご予約番号か確認番号が違います。お送りしたメールの番号をお確かめください。'),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'ご予約をお調べしました' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'ご来店' })).toHaveCount(0)
  // 入力は残る（打ち直させない）。
  await expect(page.getByLabel('ご予約番号')).toHaveValue(created.code)

  // 正しい確認番号でだけ明細が出る。
  await page.getByLabel('確認番号').fill(created.managementCode)
  await page.getByRole('button', { name: 'ご予約をお調べする' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約をお調べしました' })).toBeVisible()
})

/* ========================================================================== *
 * 5. 行き止まりにしない（WEB-01〜WEB-03 の 4 状態）
 * ========================================================================== */

// @e2e-covers UC-WEB-13
test('読み込みに失敗しても回線が切れても、見出し 1 行と理由 1 行と次の一手 1 つが出る', async ({
  page,
}) => {
  let broken = true
  await page.route(
    (url) => url.pathname === '/api/public/stores',
    async (route) => {
      if (!broken) return route.continue()
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    },
  )
  await page.goto(`/w/${SLUG}`)

  await expect(page.getByRole('heading', { name: '読み込めませんでした' })).toBeVisible()
  await expect(page.getByText('通信が混み合っているようです。')).toBeVisible()
  const retry = page.getByRole('button', { name: 'もう一度読み込む' })
  await expect(retry).toHaveCount(1)

  // 次の一手を押せば戻れる（行き止まりにしない）。
  broken = false
  await retry.click()
  await expect(page.getByRole('heading', { name: 'ご希望の店舗をお選びください' })).toBeVisible()
})
