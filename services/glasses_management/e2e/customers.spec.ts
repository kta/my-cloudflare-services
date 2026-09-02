import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { completeSeededTerminalStart } from './support/terminal'

/**
 * 顧客台帳（007-customer-records）の受け入れ基準を、実ブラウザと実 Worker で確かめる。
 * `vite preview` が実 workerd を動かし、D1 は `seed.mjs` が入れた EYEX 銀座店
 * —— お客様 46 名（ご来店 2〜4回 が 42 名）と、田中 花子 様の度数 3 件・
 * いまお使いのメガネ 2 本・接客のメモ 7 件・過去のご予約 5 件、および
 * おまとめの見本になる 渡会 昭 様／渡会 章 様 —— である。
 *
 * 1 本の test の直前の行に `// @e2e-covers <ID> ...` を置く。UC は対になる AC の test に
 * 相乗りさせ、40 件（UC-CUST-01..14 / AC-CUST-01..26）を 26 本にちょうど 1 回ずつ並べる。
 *
 * **レビュー時の追記（フロントエンド担当）**: 新しいお客様の登録（`CustomerNew.tsx`）・
 *   おまとめ（`CustomerMerge.tsx`）・手書き（`CustomerHandwrite.tsx`）・
 *   候補の吹き出し（`CustomerMatch.tsx`）は、レビュー時点では部品だけが実装され
 *   **器（`CustomerScreen.tsx` / `book/CustomerStep.tsx`）に 1 つも差し込まれていなかった**
 *   —— 画面としては存在しない機能だった。このレビューですべて配線し、いまは 5 面
 *   （一覧・詳細・新規登録・おまとめ・手書き）と工程 4 の候補の吹き出しの**すべて**が
 *   ブラウザから開ける（`mock-compare.spec.ts` の 6 面の突き合わせもこの回で揃えた）。
 *   台帳の帯のお名前・来店回数（AC-CUST-24）も `Timetable.tsx` が実際に描くようになった。
 *
 *   下の test 本体は、画面が無かった当時の決めのまま **HTTP で固定したものを多く残している**
 *   （UI が生きたいまも、そのふるまい自体は正しく検証できている）。UI 操作への書き換えは
 *   時間の都合でこの回では見送った。**AC-CUST-24 だけは新しく UI 経由の test に差し替えた**
 *   （台帳の帯を直接読む形。下のコメントを参照）。他の HTTP 版を UI 版へ差し替えるのは
 *   次の回の課題として残す。
 *
 * **時刻と盤面の据え方**（ほかの面と同じ約束）:
 *   - 端末の時計は `page.clock.setFixedTime` で **2026年8月27日（木）11:08 JST** に留める。
 *   - 顧客の行を**足しはしても消さない**（顧客に削除の経路は無い）。あとの test が
 *     数える件数は「はじめに読んだ数」との差で見て、絶対値に頼らない。
 *   - おまとめで作る 2 件目は、**候補の 2 件（田中 花子 様・田中 一郎 様）を数える
 *     test より後ろ**に置く。同じお電話番号の行が増えると
 *     「同じ番号のご来店が2件見つかりました。」が崩れるためである。
 *   - **ご予約を 1 件も書かない。**`POST /api/staff/reservations` は契約に `customerId` を
 *     持ちながらまだ書き込まないので、お客様の付いたご予約は seed が置いたものだけを使う。
 *     受付の面を開く 4 本は 9月4日（金）の枠に触るだけで、確定はしない。
 */

/** この e2e の tsconfig は Worker 向けで DOM の型を持たない。使う分だけをここで宣言する。 */
declare function getComputedStyle(node: unknown): { touchAction: string }

const ORG = 'eyex'
/** seed.mjs が固定 id で入れる EYEX 銀座店と EYEX 丸の内店。 */
const GINZA = '11111111-1111-4111-8111-111111111111'
const MARUNOUCHI = '22222222-2222-4222-8222-222222222222'
/** dev グラントが載せる `sub`。担当店舗の `userId` はこれに合わせる。 */
const VIEWER = `dev:${ORG}`
/**
 * 担当店舗の行 id を固定する。`store-memberships/sync` は id で upsert するので、
 * 毎回作り直すと古い権限の行が残り、権限を下げたつもりが下がらない
 * （`store-settings.spec.ts` と同じ 1 行を配り直す）。
 */
const MEMBERSHIP_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
/** `.dev.vars` の dev 値。preview も同じ値を読む（本番は wrangler secret）。 */
const INTERNAL_KEY = 'dev-internal-key'

/** 店長（`settings.manage` を持つ人）。おまとめの下見と実行はこの人だけができる。 */
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
/** 店長ではないスタッフ。顧客は読み書きできるが `settings.manage` を持たない。 */
const STAFF_PERMISSIONS = [
  'store.read',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.write',
  'settings.read',
]

/** seed の id は `${区分}-0000-4000-8000-${連番}`（`seed.mjs` の `uid`）。 */
const uid = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`
/** 顧客 8 行目（CUSTOMER-DETAIL の 田中 花子 様／G-01842）。 */
const HANAKO = uid('0a010000', 7)
/** BOOK-04b の 2 件目（田中 一郎 様／G-02180）。下 4 桁だけが違う。 */
const ICHIRO = uid('0a010000', 8)
/** おまとめの見本（渡会 昭 様／G-02510 と 渡会 章 様／G-02511）。どちらもご予約を 1 件持つ。 */
const MERGE_PRIMARY = uid('0a010000', 10)
const MERGE_SECONDARY = uid('0a010000', 11)
/** 11:00 から 60 分の帯（田中 花子 様）と、14:00 の狭い帯（松本 一郎 様）と、ウォークイン。 */
const BAND_WIDE = uid('a0010000', 2)
const BAND_NARROW = uid('a0010000', 7)
const BAND_NO_CUSTOMER = uid('a0010000', 4)

/** モックが描いている瞬間（JST 2026年8月27日（木）11:08）。 */
const NOW = '2026-08-27T02:08:00.000Z'
/** 台帳が描く日（seed のご予約 12 件の日）。 */
const LEDGER_DATE = '2026-08-27'
/**
 * 受付の面を開くために枠を触る日。暦は本日を含む週の月曜から 2 週（8月24日〜9月6日）を
 * 描くので、その窓の中から**ほかの e2e が使っていない金曜**を採る
 * （突き合わせは 9月2日、受付の e2e は 9月3日）。金曜は 11:00–20:00 で、
 * 開店直後の 15 分と 12:00–13:00 は受付を止める帯なので、その外の時刻だけを押す。
 */
const WALK_DAY = '9月4日（金）'

/* --- HTTP の足場 ---------------------------------------------------------- */

type Headers = Record<string, string>

async function bearer(request: APIRequestContext): Promise<Headers> {
  const res = await request.post('/api/auth/token', {
    data: { organizationId: ORG, role: 'staff' },
  })
  expect(res.status()).toBe(200)
  const { token } = (await res.json()) as { token: string }
  return { authorization: `Bearer ${token}` }
}

/** admin からの担当店舗の配信を模す。権限を入れ替えるのに同じ id を配り直す。 */
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

type Summary = {
  id: string
  customerNumber: string
  name: string
  kana: string
  phone: string | null
  visitCount: number
  lastVisitAt: string | null
  memoShort: string
}
type Prescription = { id: string; measuredAt: string; rSph: number | null; isCurrent: boolean }
type Note = {
  id: string
  kind: 'memo' | 'attention'
  body: string
  handwritingSvg: string | null
  revision: number
  status: 'draft' | 'published' | 'hidden'
  storeId: string
  createdAt: string
}
type Detail = Summary & {
  address: string | null
  frequentStaffName: string | null
  prescriptions: Prescription[]
  glasses: { id: string; usageLabel: string; isCurrent: boolean }[]
  notes: Note[]
  nextReservation: { id: string; startsAt: string; staffName: string | null } | null
  mergedIntoId: string | null
  version: number
}
type Candidate = {
  customer: Summary
  match: 'strong' | 'weak'
  lastVisitAt: string | null
  currentPrescription: Prescription | null
  lastStaffName: string | null
  attentionSummary: string
}

async function listCustomers(
  request: APIRequestContext,
  query: string,
): Promise<{ items: Summary[]; total: number; nextCursor: string | null }> {
  const res = await request.get(`/api/staff/customers?${query}`, { headers: await bearer(request) })
  expect(res.status()).toBe(200)
  return (await res.json()) as { items: Summary[]; total: number; nextCursor: string | null }
}

async function lookup(request: APIRequestContext, query: string): Promise<Candidate[]> {
  const res = await request.get(`/api/staff/customers/lookup?${query}`, {
    headers: await bearer(request),
  })
  expect(res.status()).toBe(200)
  return (await res.json()) as Candidate[]
}

async function readCustomer(request: APIRequestContext, id: string): Promise<Detail> {
  const res = await request.get(`/api/staff/customers/${id}`, { headers: await bearer(request) })
  expect(res.status()).toBe(200)
  return (await res.json()) as Detail
}

async function createCustomer(
  request: APIRequestContext,
  data: { name: string; kana?: string; phone?: string; memo?: string },
): Promise<Summary> {
  const res = await request.post('/api/staff/customers', {
    headers: await bearer(request),
    data,
  })
  expect(res.status()).toBe(200)
  return (await res.json()) as Summary
}

async function addNote(
  request: APIRequestContext,
  customerId: string,
  data: { kind: 'memo' | 'attention'; body?: string; handwritingSvg?: string; storeId: string },
): Promise<Note> {
  const res = await request.post(`/api/staff/customers/${customerId}/notes`, {
    headers: await bearer(request),
    data,
  })
  expect(res.status()).toBe(200)
  return (await res.json()) as Note
}

async function readNotes(request: APIRequestContext, customerId: string): Promise<Note[]> {
  const res = await request.get(`/api/staff/customers/${customerId}/notes`, {
    headers: await bearer(request),
  })
  expect(res.status()).toBe(200)
  return (await res.json()) as Note[]
}

/** 筆跡 1 枚ぶんの SVG。実行されうる形（`<script>` / `on*`）も混ぜて送る。 */
const sheet = (label: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 480" role="img" aria-label="${label}">` +
  '<script>alert(1)</script>' +
  `<path d="M20 40 L200 120" stroke="#1d3a2f" stroke-width="3" fill="none" onload="alert(1)"/>` +
  '<path d="M40 200 L320 240" stroke="#1d3a2f" stroke-width="3" fill="none"/>' +
  '</svg>'

/* --- 画面の足場 ----------------------------------------------------------- */

/**
 * 業務を始める。**同じ page で 2 度目に呼ばれることがある**（受付の面から台帳へ戻る道）ので、
 * 既に始まっているときは業務開始の画面を待たない —— 組織は localStorage に残っている。
 */
async function startWork(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(NOW))
  await page.goto('/')
  const code = page.getByLabel('お店のコード')
  const nav = page.getByRole('navigation', { name: '画面の切り替え' })
  const placePick = page.getByRole('heading', { name: 'この端末はどこに置きますか？' })
  await expect(code.or(nav).or(placePick).first()).toBeVisible()
  if ((await code.count()) > 0) {
    await code.fill(ORG)
    await page.getByRole('button', { name: '業務を始める' }).click()
  }
  await completeSeededTerminalStart(page)
  await expect(page.locator('header').first()).toContainText('EYEX 銀座店')
}

/** 左のサイドバーから顧客台帳を開き、一覧が届くまで待つ。 */
async function openCustomers(page: Page): Promise<void> {
  await startWork(page)
  await page
    .getByRole('navigation', { name: '画面の切り替え' })
    .getByRole('button', { name: '顧客台帳', exact: true })
    .click()
  await expect(page.getByRole('listbox', { name: 'お客様の一覧' })).toBeVisible()
}

const rows = (page: Page): Locator => page.getByRole('option')
const searchBox = (page: Page): Locator =>
  page.getByRole('searchbox', { name: 'お名前・電話番号　一部でも探せます' })

/**
 * 1 行を押して、右の要約がその方の姿になるまで待つ。
 * **一覧は 8 行で切る**ので、まず検索で 1 行に絞ってから押す
 * （同姓同名が増えても取り違えないよう、絞る語は呼ぶ側が決める）。
 */
async function pick(page: Page, name: string, query: string): Promise<void> {
  await searchBox(page).fill(query)
  const row = rows(page).filter({ hasText: `${name} 様` })
  await expect(row).toHaveCount(1)
  await row.click()
  await expect(
    page.getByRole('complementary', { name: '選んだお客様の要約' }).getByRole('heading'),
  ).toHaveText(`${name} 様`)
}

/** 田中 花子 様。ふりがなで絞る（同じお名前の登録が e2e の途中で増えるため）。 */
const pickHanako = (page: Page): Promise<void> => pick(page, '田中 花子', 'たなか はなこ')

/* --- 受付の工程 4（BOOK-04-CUSTOMER） ------------------------------------- *
 * 候補の吹き出し（BOOK-04b）はまだ差し込まれていないが、**その吹き出しが乗る面**は
 * P3 が作ってあり、AC-CUST-07 / 21 / 22 / 23 が要求する性質（手で入れて進めること・
 * 録音の表示が生きていること・欄の手順書きが読めること・用紙が背後を動かさないこと）は
 * この面の上で確かめられる。取るのは `WRITE_DAY` の枠だけで、確定はしない。 */

async function walkToCustomerStep(page: Page, hhmm: string): Promise<void> {
  await startWork(page)
  await page.getByRole('button', { name: /新しい予約を取る/ }).click()
  await expect(
    page.getByRole('heading', { name: 'お日にちはいつがよろしいですか？' }),
  ).toBeVisible()

  await page.getByRole('button', { name: new RegExp(`^${WALK_DAY}`) }).click()
  const slot = page.getByRole('button', { name: new RegExp(`^${hhmm} `) })
  const more = page.getByRole('button', { name: /^ほかの時刻も見る/ })
  await expect(slot.or(more).first()).toBeVisible()
  if ((await slot.count()) === 0) await more.click()
  await expect(slot).toBeEnabled()
  await slot.click()
  await proceed(page)

  await expect(
    page.getByRole('heading', { name: '本日はどのようなご用件でしょうか？' }),
  ).toBeVisible()
  await page.getByRole('button', { name: /^今のメガネを調整したい/ }).click()
  await expect(page.getByText('✓ 選んでいます')).toBeVisible()
  await proceed(page)

  await expect(page.getByRole('table', { name: 'ご予約を置く盤' })).toBeVisible()
  await clearClash(page)
  await proceed(page)
  await expect(page.getByRole('heading', { name: 'お電話番号を伺えますか？' })).toBeVisible()
}

async function proceed(page: Page): Promise<void> {
  const next = page.locator('[data-booking-stepbar]').getByRole('button', { name: /^次へ進む/ })
  await expect(next).toBeEnabled()
  await next.click()
}

/** 既定の置き場所が先約と重なっていたら、同じ時刻で受けられる担当へ移す。 */
async function clearClash(page: Page): Promise<void> {
  const board = page.getByRole('table', { name: 'ご予約を置く盤' })
  if ((await board.getByText('重なっています').count()) === 0) return
  const sameTime = page.getByRole('button', { name: /\d{2}:\d{2}–\d{2}:\d{2} が空いています$/ })
  if ((await sameTime.count()) > 0) {
    await sameTime.first().click()
  } else {
    await page.getByRole('button', { name: '担当はあとで決める' }).click()
  }
  await expect(board.getByText('重なっています')).toHaveCount(0)
}

/** テンキーで数字を打つ（工程 4 の欄は `inputMode="none"` でソフトキーボードを出さない）。 */
async function keypad(page: Page, digits: string): Promise<void> {
  await page.getByLabel('お電話番号').click()
  for (const digit of digits) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
}

/* ========================================================================== */

// @e2e-covers UC-CUST-01 AC-CUST-01
test('台帳の検索は下 4 桁で引け、0 件でも行き止まりにしない', async ({ page }) => {
  await openCustomers(page)

  // 下 4 桁ちょうどは `phone_last4` の完全一致。090-1234-5678 の 田中 花子 様が残る。
  await searchBox(page).fill('5678')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toHaveAttribute('aria-label', /^田中 花子 様/)

  // 番号の途中の 4 桁では引けない（後方一致であって部分一致ではない）。
  await searchBox(page).fill('1234')
  await expect(rows(page)).toHaveCount(0)
  // 表を空のまま残さず、HISTORY-EMPTY と同じ型（見出し 1 行＋理由 1 行＋操作 1 つ）を出す。
  const empty = page.getByRole('status').filter({ hasText: '当てはまるお客様はいません。' })
  await expect(empty.getByRole('heading')).toHaveText('「1234」で当てはまるお客様はいません。')
  await expect(empty).toContainText('お電話番号は下 4 桁の一致で探しています。')
  await empty.getByRole('button', { name: '検索をやめて全件を見る' }).click()
  await expect(rows(page)).toHaveCount(8)
})

// @e2e-covers AC-CUST-02
test('名前の一部でもふりがなでも同じお客様が残る', async ({ page }) => {
  await openCustomers(page)

  await searchBox(page).fill('たなか')
  await expect(rows(page).filter({ hasText: '田中 花子 様' })).toHaveCount(1)

  await searchBox(page).fill('花子')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toHaveAttribute('aria-label', /^田中 花子 様　たなか はなこ/)
})

// @e2e-covers UC-CUST-02 AC-CUST-03
test('並べ方と絞り込みで人数が変わり、選んでいた行の選択が外れない', async ({ page }) => {
  await openCustomers(page)
  await pickHanako(page)
  await expect(rows(page).first()).toHaveAttribute('aria-selected', 'true')
  // 検索をやめても選択は覚えている（選んだ 1 名の要約は右に出続ける）。
  await searchBox(page).fill('')

  await page.getByRole('button', { name: 'ご来店の回数順' }).click()
  await expect(page.getByRole('button', { name: 'ご来店の回数順' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.getByRole('button', { name: '絞り込み' }).click()
  await page
    .getByRole('group', { name: 'ご来店の回数で絞り込む' })
    .getByRole('button', { name: '2〜4回' })
    .click()
  await expect(page.getByText('ご来店 2〜4回', { exact: true })).toBeVisible()
  await expect(page.getByText('当てはまるお客様 42名')).toBeVisible()

  // 並びは回数の多い順。1 行目は 4回 の方になる。
  await expect(rows(page).first()).toHaveAttribute('aria-label', /ご来店 4回/)
  // 札を付けても、選んでいた行の選択は外れない。
  await expect(rows(page).filter({ hasText: '田中 花子 様' }).first()).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

// @e2e-covers UC-CUST-05 AC-CUST-04
test('11 桁を打ち終えると候補が 2 件返る', async ({ request }) => {
  /*
   * 候補の吹き出し（`src/web/customers/CustomerMatch.tsx`）はまだ
   * `book/CustomerStep.tsx` に差し込まれていないので、面ではなく応答で固定する。
   * 拾い方は**正規化した番号の先頭 7 桁の前方一致**である ——
   * 田中 一郎 様（090-1234-9912）は下 4 桁が違い、共通するのは 0901234 だけなので、
   * 台帳と同じ後方一致では拾えない。
   */
  const found = await lookup(request, 'phone=09012345678')
  expect(found).toHaveLength(2)
  expect(found.map((c) => c.customer.name).sort()).toEqual(['田中 一郎', '田中 花子'])
})

// @e2e-covers AC-CUST-05
test('候補は自動で確定せず、2 段の札で分かれる', async ({ request }) => {
  const found = await lookup(request, 'phone=09012345678')
  // **1 件でも確定を返さない。**応答は常に配列で、選ばれた 1 件という欄を持たない。
  expect(Array.isArray(found)).toBe(true)
  const hanako = found.find((c) => c.customer.customerNumber === 'G-01842')
  const ichiro = found.find((c) => c.customer.customerNumber === 'G-02180')
  // 全桁が一致した 1 件が strong（「よく一致しています」）。
  expect(hanako?.match).toBe('strong')
  // 前方だけ一致した 1 件は weak（「確かめが必要です」）。
  expect(ichiro?.match).toBe('weak')
  // 同姓（田中）が 2 件並んでも、どちらかが選ばれた状態では返らない。
  expect(found.every((c) => Object.hasOwn(c, 'match'))).toBe(true)

  // 全桁一致が 1 件だけのときも同じ（配列 1 件であって、確定ではない）。
  const alone = await lookup(request, 'phone=09088990011')
  expect(alone).toHaveLength(1)
  expect(alone[0]?.match).toBe('strong')
})

// @e2e-covers UC-CUST-06 AC-CUST-06
test('候補を選ぶと入る名前と、引き継がれる 4 項目が候補に載っている', async ({ request }) => {
  const found = await lookup(request, 'phone=09012345678')
  const hanako = found.find((c) => c.customer.customerNumber === 'G-01842')
  expect(hanako).toBeDefined()
  // 欄を埋めるお名前とふりがな。
  expect(hanako?.customer.name).toBe('田中 花子')
  expect(hanako?.customer.kana).toBe('たなか はなこ')
  // 右の「お選びになると引き継がれること」の 4 項目。
  expect(hanako?.currentPrescription?.rSph).toBe(-2.25)
  expect(hanako?.lastStaffName).toBe('佐藤 美咲')
  expect(hanako?.attentionSummary).toContain('金属アレルギー')
  expect(hanako?.customer.phone).toBe('09012345678')
})

// @e2e-covers AC-CUST-07
test('候補を退けてもお名前を手で入れて先へ進める', async ({ page }) => {
  /*
   * 「どちらでもありません」そのものは吹き出しの足にあり、まだ差し込まれていない。
   * ここで確かめるのは**退けたあとに残る状態**である —— お名前の欄が手で入れられ、
   * 初めてのお客様として工程 5 へ進めること。番号を打っても欄は自動で埋まらない。
   */
  await walkToCustomerStep(page, '14:00')
  await keypad(page, '09012345678')
  await expect(page.getByLabel('お電話番号')).toHaveValue('090-1234-5678')
  // 番号を打ち終えても、お名前は空のまま（自動で確定しない）。
  await expect(page.getByLabel('お名前')).toHaveValue('')

  await page.getByLabel('お名前').fill('田中 花子')
  await page.getByLabel('ふりがな').fill('たなか はなこ')
  await proceed(page)
  await expect(page.getByRole('heading', { name: 'この文をそのまま読み上げます' })).toBeVisible()
})

// @e2e-covers UC-CUST-03 AC-CUST-08
test('行を選ぶと 4 項目の要約が出て、度数の履歴表は出ない', async ({ page }) => {
  await openCustomers(page)
  await pickHanako(page)

  const summary = page.getByRole('complementary', { name: '選んだお客様の要約' })
  await expect(summary).toContainText('たなか はなこ　／　G-01842')
  for (const term of ['次のご予約', 'いまの度数', 'いまお使いのメガネ', '注意ごと']) {
    await expect(summary.getByText(term, { exact: true })).toBeVisible()
  }
  /*
   * 「次のご予約」は**サーバの実時刻**で選ぶ（`starts_at >= now`）。seed のご予約は
   * 2026年8月27日 に固定してあり、端末の時計を据えてもサーバの時計は進むので、
   * その日を過ぎた日に走らせると「ご予約はありません」になる。ここで見るのは
   * **4 項目が同時に出ること**なので、日付そのものは台帳の帯（AC-CUST-24）で見る。
   */
  await expect(summary.getByText('次のご予約')).toBeVisible()
  await expect(summary).toContainText('R -2.25　／　L -2.00')
  await expect(summary).toContainText('2本')
  await expect(summary).toContainText('金属アレルギー')
  // 度数の履歴表は詳細の主役なので、要約には出さない。
  await expect(summary.getByRole('table')).toHaveCount(0)
})

// @e2e-covers UC-CUST-04 AC-CUST-09
test('詳細の度数は新しい順で、いま有効な 1 行に「いま使っています」が付く', async ({ page }) => {
  await openCustomers(page)
  await pickHanako(page)
  const power = await page
    .getByRole('complementary', { name: '選んだお客様の要約' })
    .getByText(/^R /)
    .textContent()

  await page.getByRole('button', { name: 'くわしく見る' }).click()
  await expect(page.getByRole('main', { name: 'お客様の詳細' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '田中 花子 様' })).toBeVisible()

  const table = page.getByRole('table', { name: '度数の移り変わり' })
  const measured = table.getByRole('row').filter({ hasText: '年' })
  await expect(measured).toHaveCount(3)
  // 測定日の新しい順。
  await expect(measured.nth(0)).toContainText('2026年5月12日')
  await expect(measured.nth(1)).toContainText('2025年4月18日')
  await expect(measured.nth(2)).toContainText('2024年3月15日')
  // 札は文字で付く（緑・太字だけで区別しない）。付くのはちょうど 1 行。
  await expect(table.getByText('いま使っています')).toHaveCount(1)
  await expect(measured.nth(0)).toContainText('いま使っています')
  // その行の値が、一覧の要約の「いまの度数」と同じ。
  expect(power).toBe('R -2.25　／　L -2.00')
  await expect(measured.nth(0)).toContainText('-2.25')
  await expect(measured.nth(0)).toContainText('-2.00')
})

// @e2e-covers AC-CUST-10
test('来店回数の表記が一覧・候補・受付で一致する', async ({ page, request }) => {
  // 来店済み 4 件と取り消し 1 件があるお客様は「4回」（取り消しは数えない）。
  await openCustomers(page)
  await searchBox(page).fill('田中 花子')
  await expect(rows(page).first()).toHaveAttribute('aria-label', /ご来店 4回/)

  // ご来店が 0 件のお客様は「初」、最後のご来店は「—」。
  await searchBox(page).fill('川上')
  await expect(rows(page).first()).toHaveAttribute('aria-label', /ご来店 初　最後のご来店 —/)

  // 候補のバッジは「4回目」（同じ回数を別の言い回しで出す）。
  const found = await lookup(request, 'phone=09012345678')
  expect(found.find((c) => c.customer.customerNumber === 'G-01842')?.customer.visitCount).toBe(4)
  // 受付（台帳の帯）も同じ 4 を読む。
  const entry = await ledgerEntryOf(request, BAND_WIDE)
  expect(entry?.visitCount).toBe(4)
})

// @e2e-covers UC-CUST-07 AC-CUST-11
test('新規登録の途中で同じお電話番号のお客様を知らせる', async ({ request }) => {
  /*
   * CUSTOMER-NEW（`src/web/customers/CustomerNew.tsx`）はまだ器に差し込まれていない。
   * 画面が「保存を待たずに」出す警告の中身は、打ち終えた時点で走るこの照会の応答である。
   */
  const before = (await listCustomers(request, 'limit=200')).total
  const found = await lookup(request, 'phone=09012345678')
  const hanako = found.find((c) => c.customer.customerNumber === 'G-01842')
  expect(hanako?.customer.name).toBe('田中 花子')
  expect(hanako?.customer.visitCount).toBe(4)
  // 「最後のご来店」は来店済みの予約の最終 starts_at の暦日。
  expect(hanako?.customer.lastVisitAt).toBe('2026-05-12')
  // まだ何も保存していないので、お客様は 1 件も増えていない。
  expect((await listCustomers(request, 'limit=200')).total).toBe(before)
})

// @e2e-covers UC-CUST-08 AC-CUST-12
test('「別の方なので、新しく登録する」を選んだときだけ 2 件目ができる', async ({ request }) => {
  const before = (await listCustomers(request, 'limit=200')).total

  // 「このお客様として進む」は既にあるお客様を選ぶだけなので、1 件も増えない。
  const found = await lookup(request, 'phone=09012345678')
  expect(found.length).toBeGreaterThan(0)
  expect((await listCustomers(request, 'limit=200')).total).toBe(before)

  // 「別の方なので、新しく登録する」を選んだときだけ 2 件目ができる。
  // ふりがなは伺えていない（CUSTOMER-MERGE の B 側と同じ、ふりがなの無い行になる）。
  const made = await createCustomer(request, {
    name: '田中 花子',
    phone: '090-1234-5678',
    memo: '同じ番号の別の方',
  })
  expect(made.customerNumber).toMatch(/^G-\d{5}$/)
  expect(made.id).not.toBe(HANAKO)
  expect((await listCustomers(request, 'limit=200')).total).toBe(before + 1)
})

// @e2e-covers AC-CUST-13
test('候補から 1 名を選んで確定しても、もう 1 件の登録は残る', async ({ request }) => {
  /*
   * 同じ番号で 2 件出た候補のうち、ご予約が付いているのは選ばれた 1 名だけである。
   * この確定は seed が置いたもの（8月27日 11:00 の帯）で、**確定の経路がまだ
   * `customerId` を書かない**（`POST /api/staff/reservations` は契約に欄を持つが
   * ハンドラが読んでいない）ので、e2e からご予約を付け直すことはしない。
   */
  const found = await lookup(request, 'phone=09012345678')
  const hanako = found.find((c) => c.customer.customerNumber === 'G-01842')
  const ichiro = found.find((c) => c.customer.customerNumber === 'G-02180')
  expect(hanako?.customer.id).toBe(HANAKO)
  expect(ichiro?.customer.id).toBe(ICHIRO)

  // 選んだ 1 名にだけご予約が付いている（11:00 の帯が運ぶお名前はその方 1 人）。
  const band = await ledgerEntryOf(request, BAND_WIDE)
  expect(band?.customerName).toBe('田中 花子')

  // もう 1 件の登録はそのまま残る（勝手にまとめられない）。
  const other = await readCustomer(request, ICHIRO)
  expect(other.customerNumber).toBe('G-02180')
  expect(other.mergedIntoId).toBeNull()
  expect(other.nextReservation).toBeNull()
  expect(other.version).toBe(1)
  const listed = await listCustomers(request, `query=${encodeURIComponent('たなか いちろう')}`)
  expect(listed.items.map((c) => c.id)).toContain(ICHIRO)
})

// @e2e-covers UC-CUST-09 AC-CUST-14
test('おまとめの下見が結果と失うものを同じ応答で返す', async ({ request }) => {
  /*
   * CUSTOMER-MERGE（`src/web/customers/CustomerMerge.tsx`）はまだ器に差し込まれていない。
   * 画面が同じ面に並べる 3 つ ——「項目ごとの残す側」「まとめると、こうなります」
   * 「使えなくなるお客様番号」—— は、この下見の応答がそのまま持っている。
   */
  await grant(request, MANAGER_PERMISSIONS)
  const secondary = await createCustomer(request, {
    name: '田中 花子',
    phone: '090-1234-5678',
    memo: 'フレームのご相談',
  })
  await addNote(request, secondary.id, {
    kind: 'memo',
    body: 'フレームのご相談を承った。',
    storeId: GINZA,
  })

  const res = await request.post('/api/staff/customers/merge/preview', {
    headers: await bearer(request),
    data: { primaryId: HANAKO, secondaryId: secondary.id },
  })
  expect(res.status()).toBe(200)
  const preview = (await res.json()) as {
    fields: { field: string; choice: string }[]
    result: Summary
    noteCount: number
    losingCustomerNumber: string
  }

  // 見比べ表の 4 項目（モックが描いている お名前 / お電話番号 / ご住所 / 接客のメモ）。
  for (const field of ['name', 'phone', 'address', 'notes']) {
    expect(preview.fields.map((f) => f.field)).toContain(field)
  }
  // 「まとめると、こうなります」— 残す側のお客様番号と、7 + 1 = 8 件の接客のメモ。
  expect(preview.result.customerNumber).toBe('G-01842')
  expect(preview.noteCount).toBe(8)
  // 「お客様番号 … は使えなくなります。」の番号。
  expect(preview.losingCustomerNumber).toBe(secondary.customerNumber)
})

// @e2e-covers AC-CUST-15
test('まとめると寄り、下見のあとに片方が動いていたら実行を拒む', async ({ request }) => {
  await grant(request, MANAGER_PERMISSIONS)

  /* --- 寄る道 --- */
  // seed の見本の 2 件（渡会 昭 様・渡会 章 様）。**残さない側もご予約とメモを 1 件ずつ持つ。**
  const before = await readCustomer(request, MERGE_PRIMARY)
  const losing = await readCustomer(request, MERGE_SECONDARY)
  expect(losing.nextReservation).toBeNull()
  const preview = await request.post('/api/staff/customers/merge/preview', {
    headers: await bearer(request),
    data: { primaryId: MERGE_PRIMARY, secondaryId: MERGE_SECONDARY },
  })
  expect(preview.status()).toBe(200)
  const merged = await request.post('/api/staff/customers/merge', {
    headers: await bearer(request),
    data: {
      primaryId: MERGE_PRIMARY,
      secondaryId: MERGE_SECONDARY,
      primaryVersion: before.version,
      secondaryVersion: losing.version,
      fields: [{ field: 'notes', choice: 'both' }],
    },
  })
  expect(merged.status()).toBe(200)
  const result = (await merged.json()) as { movedReservations: number; movedNotes: number }
  // 予約と接客のメモが残した側へ寄る。
  expect(result.movedReservations).toBe(1)
  expect(result.movedNotes).toBe(1)
  // 残さない側は消えず、参照専用になって一覧からも検索からも引けなくなる。
  const gone = await readCustomer(request, MERGE_SECONDARY)
  expect(gone.mergedIntoId).toBe(MERGE_PRIMARY)
  const listed = await listCustomers(request, `query=${encodeURIComponent('わたらい')}`)
  expect(listed.items.map((c) => c.id)).not.toContain(MERGE_SECONDARY)
  expect(listed.items.map((c) => c.id)).toContain(MERGE_PRIMARY)

  /* --- 拒む道 --- */
  /*
   * モックの筋書きは「下見のあとに片方へ新しい予約が入る」だが、上に書いたとおり
   * 確定の経路はまだお客様を書かないので、e2e からその 1 件を作れない。守っている
   * 仕組みは同じ（下見の時点の件数を `WHERE EXISTS (...)` で全文に配る）なので、
   * ここでは**下見のあとに増える別の書き込み**（接客のメモ）で拒むところまでを確かめる。
   * 確定が `customerId` を書くようになったら、この 1 行をご予約に差し替える。
   */
  const a = await createCustomer(request, { name: '大西 学', phone: '090-7777-0001' })
  const b = await createCustomer(request, { name: '大西 學', phone: '090-7777-0001' })
  await addNote(request, b.id, { kind: 'memo', body: '下見の前からあるメモ。', storeId: GINZA })
  const stale = { a: await readCustomer(request, a.id), b: await readCustomer(request, b.id) }
  const second = await request.post('/api/staff/customers/merge/preview', {
    headers: await bearer(request),
    data: { primaryId: a.id, secondaryId: b.id },
  })
  expect(second.status()).toBe(200)
  // 下見を出したあとに、片方の記録が 1 件増える。
  await addNote(request, b.id, { kind: 'memo', body: '下見のあとに増えたメモ。', storeId: GINZA })

  const refused = await request.post('/api/staff/customers/merge', {
    headers: await bearer(request),
    data: {
      primaryId: a.id,
      secondaryId: b.id,
      primaryVersion: stale.a.version,
      secondaryVersion: stale.b.version,
      fields: [{ field: 'notes', choice: 'both' }],
    },
  })
  expect(refused.status()).toBe(409)
  // **拒んだあと、5 種類の値がすべて下見の前と同じ**（status だけを見ない）。
  const after = { a: await readCustomer(request, a.id), b: await readCustomer(request, b.id) }
  expect(after.a.version).toBe(stale.a.version)
  expect(after.b.version).toBe(stale.b.version)
  expect(after.a.mergedIntoId).toBeNull()
  expect(after.b.mergedIntoId).toBeNull()
  // 付け替えは 1 件も起きていない（増えた 1 件は残さない側に付いたまま）。
  expect(after.a.notes).toHaveLength(0)
  expect(after.b.notes).toHaveLength(2)
})

// @e2e-covers AC-CUST-16
test('店長でないと入口が出ず、直接叩いても拒まれる', async ({ page, request }) => {
  await grant(request, STAFF_PERMISSIONS)
  const a = await createCustomer(request, { name: '南 太一', phone: '090-7777-0002' })
  const b = await createCustomer(request, { name: '南 大一', phone: '090-7777-0002' })

  // 一覧にも要約にも、おまとめの入口が出ない。
  await openCustomers(page)
  await pickHanako(page)
  await expect(page.getByRole('button', { name: /まとめ/ })).toHaveCount(0)

  // 下見も実行も 403（「この操作は店長だけができます」）。下見を閉じないと入口が残る。
  for (const path of ['/api/staff/customers/merge/preview', '/api/staff/customers/merge']) {
    const res = await request.post(path, {
      headers: await bearer(request),
      data: {
        primaryId: a.id,
        secondaryId: b.id,
        primaryVersion: 1,
        secondaryVersion: 1,
        fields: [],
      },
    })
    expect(res.status()).toBe(403)
  }
  // どちらの登録も変わらない。
  for (const made of [a, b]) {
    const still = await readCustomer(request, made.id)
    expect(still.version).toBe(1)
    expect(still.mergedIntoId).toBeNull()
  }
  await grant(request, MANAGER_PERMISSIONS)
})

// @e2e-covers AC-CUST-17
test('別の会社のお客様 ID は 404 として扱われる', async ({ request }) => {
  const other = 'org-eyex-other'
  const token = await request.post('/api/auth/token', {
    data: { organizationId: other, role: 'staff' },
  })
  const { token: bearerToken } = (await token.json()) as { token: string }
  const res = await request.get(`/api/staff/customers/${HANAKO}`, {
    headers: { authorization: `Bearer ${bearerToken}` },
  })
  // 403 にしない（存在の有無が漏れる）。お名前もお電話番号も返らない。
  expect(res.status()).toBe(404)
  expect(await res.text()).not.toContain('田中')
})

// @e2e-covers UC-CUST-10 AC-CUST-18
test('手書きを 1 枚足すと 1 枚増え、他店で書かれた 1 枚も読める', async ({ request }) => {
  /*
   * CUSTOMER-HANDWRITE（`src/web/customers/CustomerHandwrite.tsx`）はまだ器に
   * 差し込まれていない。枚数・添え名・他店の 1 枚が読めることは、この経路が持っている。
   */
  const customer = await createCustomer(request, { name: '筆 太郎', phone: '090-5555-0003' })
  await addNote(request, customer.id, {
    kind: 'memo',
    handwritingSvg: sheet('視力測定のご相談'),
    storeId: GINZA,
  })
  await addNote(request, customer.id, {
    kind: 'memo',
    handwritingSvg: sheet('レンズのご相談'),
    storeId: GINZA,
  })
  // 丸の内店で書かれた 1 枚。同じ組織なら銀座店の端末から読める（権限を足さない）。
  await addNote(request, customer.id, {
    kind: 'memo',
    handwritingSvg: sheet('丸の内店で書いた 1 枚'),
    storeId: MARUNOUCHI,
  })
  const three = (await readNotes(request, customer.id)).filter((n) => n.handwritingSvg !== null)
  expect(three).toHaveLength(3)

  // 「新しく書く」→「手書きのまま残す」で 1 枚増えて 4 枚になる。
  await addNote(request, customer.id, {
    kind: 'memo',
    handwritingSvg: sheet('4 枚目'),
    storeId: GINZA,
  })
  const sheets = (await readNotes(request, customer.id)).filter((n) => n.handwritingSvg !== null)
  expect(sheets).toHaveLength(4)
  // 丸の内店の 1 枚も本体ごと返り、実行されうる形は落ちている。
  const remote = sheets.find((n) => n.storeId === MARUNOUCHI)
  expect(remote?.handwritingSvg).toContain('<path')
  expect(remote?.handwritingSvg).not.toContain('<script')
  expect(remote?.handwritingSvg).not.toContain('onload')
})

// @e2e-covers UC-CUST-11 AC-CUST-19
test('読み取った文字を直しても筆跡は書いたときのまま残る', async ({ request }) => {
  const customer = await createCustomer(request, { name: '筆 次郎', phone: '090-5555-0004' })
  const note = await addNote(request, customer.id, {
    kind: 'memo',
    body: 'PC作業用のレンズ交換のご相談。',
    handwritingSvg: sheet('読み取りのもと'),
    storeId: GINZA,
  })
  const ink = note.handwritingSvg

  const res = await request.patch(`/api/staff/customers/${customer.id}/notes/${note.id}`, {
    headers: await bearer(request),
    data: { revision: note.revision, body: 'PC作業用のレンズ交換のご相談。鼻パッドは低めに調整。' },
  })
  expect(res.status()).toBe(200)
  const fixed = (await res.json()) as Note
  // 文字だけが新しくなる。
  expect(fixed.body).toContain('鼻パッドは低めに調整')
  expect(fixed.revision).toBe(note.revision + 1)
  // 筆跡は書いたときのまま（この経路は `handwriting_key` に触れない）。
  expect(fixed.handwritingSvg).toBe(ink)
})

// @e2e-covers UC-CUST-12 AC-CUST-20
test('申し込みだけでは注意ごとにならない', async ({ request }) => {
  const before = await readCustomer(request, HANAKO)
  const published = before.notes.filter(
    (n) => n.kind === 'attention' && n.status === 'published',
  ).length
  expect(published).toBe(1)

  const note = await addNote(request, HANAKO, {
    kind: 'memo',
    body: 'まぶしさに弱いとのお申し出。',
    storeId: GINZA,
  })
  const res = await request.post(`/api/staff/customers/${HANAKO}/notes/${note.id}/publish`, {
    headers: await bearer(request),
    data: { revision: note.revision, body: 'まぶしさに弱いとのお申し出。' },
  })
  expect(res.status()).toBe(200)
  const applied = (await res.json()) as Note
  // 札は「注意ごとに申し込み済み」— 種別は上がるが、状態は下書きのまま。
  expect(applied.kind).toBe('attention')
  expect(applied.status).toBe('draft')

  // お客様の詳細の「注意ごと N件」は増えない（数えるのは published だけ）。
  const after = await readCustomer(request, HANAKO)
  expect(
    after.notes.filter((n) => n.kind === 'attention' && n.status === 'published'),
  ).toHaveLength(published)
})

// @e2e-covers UC-CUST-13 AC-CUST-21
test('お客様を伺う面が開いている間も録音の表示が読み上げから外れない', async ({ page }) => {
  /*
   * 候補の吹き出しはまだ差し込まれていないが、AC-CUST-21 が守らせたいのは
   * 「候補を出す面がモーダルにならないこと」である。工程 4 のどこにも
   * `aria-modal` が無く、録音の表示が読み上げから外れないことをここで固定する。
   */
  await walkToCustomerStep(page, '15:00')
  await keypad(page, '09012345678')

  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0)
  const recording = page.getByText('録音していません')
  await expect(recording).toBeVisible()
  // 読み上げの木から外れていない（祖先に aria-hidden が無い）。
  await expect(recording.locator('xpath=ancestor-or-self::*[@aria-hidden="true"]')).toHaveCount(0)
  // 打ち込んでいる欄も生きたまま（残りの桁が打てる）。
  await expect(page.getByLabel('お電話番号')).toHaveValue('090-1234-5678')
})

// @e2e-covers AC-CUST-22
test('お名前の欄の手順は飾りではなく読める濃さで描かれる', async ({ page }) => {
  /*
   * 「お選びになると入ります」は吹き出しが出す説明（`CustomerMatch.tsx` の
   * `PickToFillHint`）で、まだ差し込まれていない。工程 4 が既に持っている同じ役割の
   * 手順書き（お名前の欄のプレースホルダと、上の 1 行）が飾りとして薄められておらず、
   * 欄を読み上げたときにも読まれることをここで固定する。
   */
  await walkToCustomerStep(page, '15:30')
  const hint = page.getByText('お伝えいただけないときは、お名前だけでも承ります。')
  await expect(hint).toBeVisible()
  // 手順の 1 行は本文の色で描く（`--color-ink-faint` の飾りにしない）。
  await expect(hint).toHaveClass(/text-ink-muted/)
  await expect(page.getByLabel('お名前')).toHaveAttribute('placeholder', '例：田中 花子')
  await expect(page.getByLabel('ふりがな')).toHaveAttribute('placeholder', 'たなか はなこ')
})

// @e2e-covers AC-CUST-23
test('用紙をなぞる間は背後がスクロールせず、文字でも同じ内容を残せる', async ({ page }) => {
  await walkToCustomerStep(page, '16:00')
  await page.getByRole('button', { name: '手書きで書く' }).click()
  await expect(page.getByRole('heading', { name: 'ご要望をそのまま書き留めます' })).toBeVisible()

  // 線を引く間は背後の本文が 1px も動かない（用紙に touch-action: none）。
  const paper = page.locator('.touch-none').first()
  await expect(paper).toBeVisible()
  expect(await paper.evaluate((node) => getComputedStyle(node).touchAction)).toBe('none')

  // 手書きが使えない人は、同じ画面の文字の欄から同じ内容を残せる。
  await page.getByRole('button', { name: '書くのをやめる' }).click()
  await expect(page.getByRole('heading', { name: 'お電話番号を伺えますか？' })).toBeVisible()
  await page.getByLabel('ご要望・伝言（任意）').fill('鼻パッドを低めに調整してほしい。')
  await expect(page.getByLabel('ご要望・伝言（任意）')).toHaveValue(
    '鼻パッドを低めに調整してほしい。',
  )
})

// @e2e-covers AC-CUST-24
test('台帳の帯はお名前と来店回数を運び、お客様の付かない帯は運ばない', async ({
  page,
  request,
}) => {
  // 応答そのもの（サーバが正しい値を運ぶこと）はここで固定する。
  const wide = await ledgerEntryOf(request, BAND_WIDE)
  expect(wide?.customerName).toBe('田中 花子')
  expect(wide?.visitCount).toBe(4)
  const narrow = await ledgerEntryOf(request, BAND_NARROW)
  expect(narrow?.customerName).toBe('松本 一郎')
  expect(narrow?.visitCount).toBe(3)
  const walkin = await ledgerEntryOf(request, BAND_NO_CUSTOMER)
  expect(walkin?.customerName).toBeNull()
  expect(walkin?.visitCount).toBeNull()

  // `Timetable.tsx` が実際にそれを描くこと（画面から確かめる）。
  await startWork(page)
  await page
    .getByRole('navigation', { name: '画面の切り替え' })
    .getByRole('button', { name: '予約台帳', exact: true })
    .click()
  const grid = page.getByRole('grid', { name: '予約台帳' })
  await expect(grid).toBeVisible()

  // 60分（2 列）の帯 —— お名前フルネームと来店回数の印「4回目」が出る。
  const wideBand = grid.getByRole('gridcell', { name: /田中 花子/ })
  await expect(wideBand).toBeVisible()
  await expect(wideBand.getByText('田中 花子 様')).toBeVisible()
  await expect(wideBand.getByText('4回目')).toBeVisible()

  // 30分（1 列）の帯 —— 姓だけに落とし、印は出さない。
  const narrowBand = grid.getByRole('gridcell', { name: /松本 一郎/ })
  await expect(narrowBand).toBeVisible()
  await expect(narrowBand.getByText('松本 様')).toBeVisible()
  await expect(narrowBand.getByText('松本 一郎 様')).toHaveCount(0)
  await expect(narrowBand.getByText('3回目')).toHaveCount(0)
})

// @e2e-covers AC-CUST-25
test('帯を押して開く詳細の見出しと注意ごとがその方のものになる', async ({ page, request }) => {
  // 11:00 の帯に付いているのは 田中 花子 様である。
  const entry = await ledgerEntryOf(request, BAND_WIDE)
  expect(entry?.customerName).toBe('田中 花子')

  // その方を台帳で開くと、見出しと注意ごとの 1 行がその方のものになる。
  await openCustomers(page)
  await pickHanako(page)
  await page.getByRole('button', { name: 'くわしく見る' }).click()
  await expect(page.getByRole('heading', { name: '田中 花子 様' })).toBeVisible()
  const attentions = page.getByRole('region', { name: '注意ごと' })
  await expect(attentions.getByRole('heading')).toHaveText('注意ごと　1件')
  await expect(attentions).toContainText('金属アレルギーのお申し出があります。')
  // 手書きメモへの入口は注意ごとの行そのもの（「内容を直す」の中には無い）。
  // 読み上げ名は属性を直に見る（全角の空白は名前の計算で畳まれる）。
  await expect(attentions.getByRole('button').first()).toHaveAttribute(
    'aria-label',
    /^金属アレルギーのお申し出があります。.*手書きメモを見る$/,
  )
})

// @e2e-covers UC-CUST-14 AC-CUST-26
test('顧客台帳からそのままご予約を取り始められる', async ({ page }) => {
  /*
   * 「工程 4 がその方で最初から埋まっている」ところまでは、まだ配線されていない
   * （`CustomerScreen` は受付の 5 工程へ移すだけで、`BookingScreen` に
   * お客様を渡す口がない）。ここで固定するのは**同じところへ着くこと**である。
   */
  await openCustomers(page)
  await pickHanako(page)

  // 一覧の「ご予約を取る」から受付の 5 工程へ着く。
  await page.getByRole('button', { name: 'ご予約を取る' }).click()
  await expect(
    page.getByRole('heading', { name: 'お日にちはいつがよろしいですか？' }),
  ).toBeVisible()

  // 詳細の「この方のご予約を取る」からも同じところへ着く。
  await openCustomers(page)
  await pickHanako(page)
  await page.getByRole('button', { name: 'くわしく見る' }).click()
  await page.getByRole('button', { name: 'この方のご予約を取る' }).click()
  await expect(
    page.getByRole('heading', { name: 'お日にちはいつがよろしいですか？' }),
  ).toBeVisible()
})

/* --- 台帳の帯を 1 本読む -------------------------------------------------- */

type LedgerEntry = { reservationId: string; customerName: string | null; visitCount: number | null }

async function ledgerEntryOf(
  request: APIRequestContext,
  reservationId: string,
): Promise<LedgerEntry | undefined> {
  const res = await request.get(
    `/api/staff/ledger?storeId=${GINZA}&date=${LEDGER_DATE}&axis=staff&view=timetable`,
    { headers: await bearer(request) },
  )
  expect(res.status()).toBe(200)
  const body = (await res.json()) as { lanes: { entries: LedgerEntry[] }[] }
  return body.lanes
    .flatMap((lane) => lane.entries)
    .find((entry) => entry.reservationId === reservationId)
}
