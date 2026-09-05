import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { authHeadersFor } from './support/auth'
import { completeSeededTerminalStart } from './support/terminal'

/**
 * 空き枠と予約台帳（005-availability-and-ledger）の受け入れ基準を、実ブラウザと
 * 実 Worker で確かめる。`vite preview` が実 workerd を動かし、D1 は `seed.mjs` が入れた
 * EYE 銀座店（2026年8月27日（木）のご予約 12 件）である。
 *
 * 1 本の test の直前の行に `// @e2e-covers <ID> ...` を置く。UC は対になる AC の test に
 * 相乗りさせ、33 件（UC-LEDGER-01..11 / AC-LEDGER-01..22）をちょうど 1 回ずつ並べる。
 *
 * **時刻の据え方**（この面だけの決め）:
 * seed のご予約は 2026年8月27日 に固定してあるが、サーバの時計は実時刻で進む。
 * 台帳は「最初にどの日を尋ねるか」だけを端末の時計から、線と札と件数は**応答の
 * `serverNow`** から出すので、この 2 つをそれぞれ 2026年8月27日 11:08（JST）に留める:
 *   - `page.clock.setFixedTime` … 端末の時計（＝最初に尋ねる日）
 *   - `/api/staff/ledger` の応答の `serverNow` を差し替え … 線・札・「これから」の件数
 * どちらか一方だけを動かせるので、AC-LEDGER-03 の「端末の時計を 1 時間進めても
 * 線は動かない」がそのまま確かめられる。**盤面（D1）には手を触れない。**
 *
 * この面の e2e が D1 を書き換えるのは AC-LEDGER-21 の 1 本だけで、必ず元へ戻す。
 * 承認済みモックとの突き合わせ（mock project）はこの面より先に走る
 * （playwright.config.ts の project の並び）。
 */

/**
 * この e2e の tsconfig は Worker 向けで DOM の型を持たない（`tsconfig.base.json` の
 * `lib: ["ESNext"]`）。ブラウザの中だけで動く関数は、使う分だけをここで宣言する。
 */
declare function getComputedStyle(node: unknown): {
  color: string
  backgroundColor: string
  borderLeftWidth: string
  borderRightWidth: string
  outlineColor: string
  outlineWidth: string
}

const ORG = 'eye'
/** seed.mjs が固定 id で入れる EYE 銀座店。 */
const GINZA = '11111111-1111-4111-8111-111111111111'
/** dev グラントが載せる `sub`。 */
const VIEWER = `dev:${ORG}`
/** `.dev.vars` の dev 値。preview も同じ値を読む（本番は wrangler secret）。 */
const INTERNAL_KEY = 'dev-internal-key'
/** 担当店舗の行 id。store-settings の e2e と同じ id を配り直す。 */
const MEMBERSHIP_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
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

/** seed の id は `${区分}-0000-4000-8000-${連番}`（`seed.mjs` の `uid`）。 */
const uid = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`
const SATO = uid('c0010000', 0)
const TAKAHASHI = uid('c0010000', 1)
const PURPOSE_ADJUST = uid('e0010000', 1)

const LEDGER_DATE = '2026-08-27'
const DATE_LABEL = '2026年8月27日（木）'
const NEXT_DATE_LABEL = '2026年8月28日（金）'
/** JST 2026年8月27日（木）11:08。モック 3 面が描いている瞬間。 */
const SERVER_NOW = '2026-08-27T02:08:00.000Z'
/** 木曜は 10:00–19:00 なので、表示窓 14 列より 4 列長い 18 列になる。 */
const COLUMNS = 18

/* --- 時刻を据える -------------------------------------------------------- */

/** 端末の時計。台帳が「最初にどの日を尋ねるか」だけがこれを読む。 */
async function pinDeviceClock(page: Page, at = SERVER_NOW): Promise<void> {
  await page.clock.setFixedTime(new Date(at))
}

type LedgerBody = {
  serverNow: string
  counts: { all: number; upcoming: number; pendingReview: number }
  lanes: { kind: string; entries: { reservationId: string; startsAt: string }[] }[]
}

/**
 * 応答の `serverNow`。現在時刻の線・札・「これから」の件数はこれだけを読む。
 *
 * 「これから」の件数はサーバが `serverNow` から数えた結果なので、時刻を据えるときは
 * **同じ数え方で数え直す**（札の数字と行数が食い違うと、どちらが正しいか読めなくなる）。
 * 数え直すのは担当軸の行（1 予約 1 帯）があるときだけで、盤面には手を触れない。
 *
 * **なぜ数え直しを外せないか**: seed の 12 件は 2026年8月27日 に固定してあり、
 * `GET /api/staff/ledger` は `const serverNow = new Date()`（`src/worker/index.ts`）で
 * 実時刻を使う。時刻を渡す口が無いので、応答の `counts.upcoming` は seed の日を
 * 過ぎたあと常に 0 になり、11:08 の姿を実ブラウザで見る手立てが無くなる。
 * **サーバ自身の数え方**は AC-LEDGER-13 の test が据えない応答で別に確かめており
 * （`counts` の 3 つを応答の帯から検算する）、境界値は
 * `test/ledger.integration.test.ts` と `test/availability.time.test.ts` が持つ。
 */
async function pinServerNow(page: Page, at = SERVER_NOW): Promise<void> {
  await page.route(
    (url) => url.pathname === '/api/staff/ledger',
    async (route) => {
      const response = await route.fetch()
      if (!response.ok()) {
        await route.fulfill({ response })
        return
      }
      const body = (await response.json()) as LedgerBody
      const drawn = new Map(
        body.lanes
          .filter((lane) => lane.kind === 'staff' || lane.kind === 'unassigned')
          .flatMap((lane) => lane.entries)
          .map((entry) => [entry.reservationId, entry]),
      )
      const counts =
        drawn.size === 0
          ? body.counts
          : {
              ...body.counts,
              upcoming: [...drawn.values()].filter(
                (entry) => Date.parse(entry.startsAt) > Date.parse(at),
              ).length,
            }
      await route.fulfill({ response, json: { ...body, counts, serverNow: at } })
    },
  )
}

/* --- 画面を開く ---------------------------------------------------------- */

async function startWork(
  page: Page,
  at = SERVER_NOW,
  mode: 'shared' | 'personal' = 'shared',
): Promise<void> {
  await pinDeviceClock(page, at)
  await pinServerNow(page)
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(ORG)
  await page.getByRole('button', { name: '業務を始める' }).click()
  await completeSeededTerminalStart(page, mode)
  await expect(page.locator('header').first()).toContainText('EYE 銀座店')
}

/** 同じ端末で画面を開き直す。すでに業務を始めているので名乗り直さない。 */
async function reopen(page: Page, mode: 'shared' | 'personal' = 'shared'): Promise<void> {
  await page.goto('/')
  await completeSeededTerminalStart(page, mode)
  await expect(page.locator('header').first()).toContainText('EYE 銀座店')
}

async function openLedger(page: Page): Promise<void> {
  await startWork(page)
  await page
    .getByRole('navigation', { name: '画面の切り替え' })
    .getByRole('button', { name: '予約台帳', exact: true })
    .click()
  await expect(page.getByText(DATE_LABEL)).toBeVisible()
  await expect(page.getByRole('grid', { name: '予約台帳' })).toBeVisible()
}

const grid = (page: Page) => page.getByRole('grid', { name: '予約台帳' })
const axisButton = (page: Page, label: string) =>
  page.getByRole('group', { name: '台帳の並べ方' }).getByRole('button', { name: label })
const modeButton = (page: Page, label: string) =>
  page.getByRole('group', { name: '表示のかたち' }).getByRole('button', { name: label })
const nowLine = (page: Page) => page.locator('[data-ledger-nowline]')

/**
 * その場所を指で 1 回押す。台帳の上に覆いが敷かれているときは覆いに当たる
 * （`locator.click()` は覆いを「邪魔者」とみなして待ち続けてしまう）。
 */
async function tap(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  )
}

/** 台帳の帯 1 本。読み上げ名は `metrics.ts` の `bandName` が作る。 */
const band = (page: Page, name: string) => page.getByRole('gridcell', { name, exact: true })

/* --- API を直に叩く（前提づくりと空き枠の確認） --------------------------- */

async function authed(request: APIRequestContext): Promise<{ headers: Record<string, string> }> {
  // 実際の入口と同じ道で取る（dev グラントは撤去した）。
  return { headers: await authHeadersFor(request) }
}

type Slot = {
  startsAt: string
  isAvailable: boolean
  remaining: number
  reason: string | null
}

async function availability(
  request: APIRequestContext,
  params: Record<string, string | number>,
): Promise<{ cleanupMinutes: number; slots: Slot[] }> {
  const res = await request.get('/api/staff/availability', {
    ...(await authed(request)),
    params: { storeId: GINZA, date: LEDGER_DATE, ...params },
  })
  expect(res.status()).toBe(200)
  return (await res.json()) as { cleanupMinutes: number; slots: Slot[] }
}

const slotAt = (slots: Slot[], startsAt: string): Slot => {
  const found = slots.find((slot) => slot.startsAt === startsAt)
  expect(found, `${startsAt} の枠が返っていない`).toBeDefined()
  return found as Slot
}

/* ========================================================================= */

// @e2e-covers UC-LEDGER-01 AC-LEDGER-01
test('予約台帳を開くと本日の担当者別タイムテーブルが出る', async ({ page }) => {
  await openLedger(page)

  await expect(page.getByText(DATE_LABEL)).toBeVisible()
  await expect(axisButton(page, '担当者')).toHaveAttribute('aria-pressed', 'true')
  await expect(modeButton(page, 'タイムテーブル')).toHaveAttribute('aria-pressed', 'true')

  const names = await grid(page).getByRole('rowheader').allInnerTexts()
  expect(names.slice(0, 3).map((text) => text.split('\n')[0])).toEqual([
    '佐藤 美咲',
    '高橋 健',
    '中村 彩',
  ])
})

// @e2e-covers AC-LEDGER-02
test('目盛りは 10:00 から 16:30 までの 14 列を表示窓にし、長い日は台帳の中だけが横に流れる', async ({
  page,
}) => {
  await openLedger(page)

  const headers = await grid(page).getByRole('columnheader').allInnerTexts()
  // 先頭は縦軸の見出し。そのあとが 30分刻みの時刻。
  expect(headers[0]).toBe('担当者')
  expect(headers.slice(1, 15)).toEqual([
    '10:00',
    '10:30',
    '11:00',
    '11:30',
    '12:00',
    '12:30',
    '13:00',
    '13:30',
    '14:00',
    '14:30',
    '15:00',
    '15:30',
    '16:00',
    '16:30',
  ])
  // 木曜は 19:00 まで営業するので、表示窓より 4 列長い。
  expect(headers).toHaveLength(COLUMNS + 1)

  // 横に流れるのは台帳の中だけで、ページそのものは横スクロールしない。
  const scrolls = await grid(page).evaluate((node) => {
    let box = node.parentElement
    while (box !== null) {
      if (box.scrollWidth > box.clientWidth + 1) return true
      box = box.parentElement
    }
    return false
  })
  expect(scrolls).toBe(true)
  const pageScrolls = await page
    .locator('body')
    .evaluate((node) => node.scrollWidth > node.clientWidth + 1)
  expect(pageScrolls).toBe(false)

  // 目盛りは格子の裏に敷いた 1 枚（列数ぶんの線）で、セルの罫線ではない。
  // セルに縦罫を引くと、帯が乗ったところで線が途切れる。
  await expect(page.locator('div[aria-hidden="true"] > div.border-l')).toHaveCount(COLUMNS)
  const cellBorder = await grid(page)
    .getByRole('gridcell')
    .first()
    .evaluate((node) => {
      const style = getComputedStyle(node)
      return [style.borderLeftWidth, style.borderRightWidth]
    })
  expect(cellBorder).toEqual(['0px', '0px'])
})

// @e2e-covers UC-LEDGER-06 AC-LEDGER-03
test('本日は現在時刻の線と札が出て、端末の時計を 1 時間進めても動かない', async ({ page }) => {
  await openLedger(page)

  // 11:08 は 10:00 から 68分。木曜は 18 列（540分）なので 12.59%。
  await expect(nowLine(page)).toHaveAttribute('style', /left:\s*12\.59%/)
  await expect(nowLine(page)).toHaveAttribute('aria-hidden', 'true')
  // 線は読み上げず、時刻は札が文字で持つ。
  await expect(page.getByRole('status')).toHaveText('現在 11:08')

  // 端末の時計だけを 1 時間進める。線も札も応答の `serverNow` から出しているので動かない。
  await pinDeviceClock(page, '2026-08-27T03:08:00.000Z')
  await expect(page.getByRole('status')).toHaveText('現在 11:08')
  await expect(nowLine(page)).toHaveAttribute('style', /left:\s*12\.59%/)
})

// @e2e-covers UC-LEDGER-05 AC-LEDGER-04
test('日付を前後に移すと線と札が消え、並べ方と表示のかたちは保たれる', async ({ page }) => {
  await openLedger(page)

  await page.getByRole('button', { name: '次の日' }).click()
  await expect(page.getByText(NEXT_DATE_LABEL)).toBeVisible()
  await expect(nowLine(page)).toHaveCount(0)
  await expect(page.getByText('現在 11:08')).toHaveCount(0)
  await expect(axisButton(page, '担当者')).toHaveAttribute('aria-pressed', 'true')
  await expect(modeButton(page, 'タイムテーブル')).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: '本日' }).click()
  await expect(page.getByText(DATE_LABEL)).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('現在 11:08')
  await expect(nowLine(page)).toHaveCount(1)
})

// @e2e-covers AC-LEDGER-05
test('出どころは色だけでなく文字で分かり、緑の帯は語を持たない', async ({ page }) => {
  await openLedger(page)

  await expect(band(page, '10:30から11:30　視力測定　中村 彩　Web予約')).toContainText('Web予約')
  const walkin = band(page, '11:00から11:30　視力測定　渡辺 由紀　ウォークイン')
  await expect(walkin).toContainText('ウォークイン')
  // お電話（緑）は既定なので語を持たない。語を持つのは Web予約 と ウォークイン だけ。
  const phone = band(page, '10:00から10:30　伊藤 健 様　2回目　調整　高橋 健')
  await expect(phone).not.toContainText('お電話')
  await expect(phone).not.toContainText('店頭')

  // 30分 1 列の帯は中身がおよそ 48px しか無い。語を切って出すと、いちばん色に頼りたい
  // 狭い帯で「ウォークイ」「担当が未」になり、色だけに意味を持たせない決めが崩れる。
  for (const narrow of [walkin, band(page, '13:00から13:20　調整　担当が未定　Web予約')]) {
    const overflow = await narrow
      .locator('span')
      .first()
      .evaluate((node) => ({
        x: node.scrollWidth - node.clientWidth,
        y: node.scrollHeight - node.clientHeight,
      }))
    expect(overflow.x).toBeLessThanOrEqual(1)
    expect(overflow.y).toBeLessThanOrEqual(1)
  }
})

// @e2e-covers AC-LEDGER-06
test('60分の帯にはご用件の短い名前が出て、30分の狭い帯には入らない', async ({ page }) => {
  await openLedger(page)

  await expect(
    band(page, '11:00から12:00　田中 花子 様　4回目　新調相談・視力測定　佐藤 美咲'),
  ).toContainText('新調相談・視力測定')
  /*
   * 30分 1 列の文字予算はおよそ 6 字（13px で 1 行 3.0 字 × 2 行）しかない。
   * そこへ入れるのは**誰の予約か**であって、ご用件でも時刻でもない
   * —— 時刻は帯の置かれた列そのものが持ち、読み上げには aria-label が持たせてある。
   */
  const narrow = band(page, '10:00から10:30　伊藤 健 様　2回目　調整　高橋 健')
  await expect(narrow).toContainText('伊藤')
  await expect(narrow).not.toContainText('調整')
})

// @e2e-covers UC-LEDGER-08 AC-LEDGER-07
test('担当が未定の予約は担当の行の下の専用の行に置かれ、帯にも文字で書かれる', async ({ page }) => {
  await openLedger(page)

  const names = (await grid(page).getByRole('rowheader').allInnerTexts()).map(
    (text) => text.split('\n')[0],
  )
  expect(names.indexOf('担当が未定')).toBeGreaterThan(names.indexOf('中村 彩'))
  expect(names.at(-1)).toBe('ご来店お待ち')
  // 赤い帯は「担当が未定」以外の意味を持たないので、帯の中にも文字で書く。
  await expect(band(page, '11:02から12:02　新調相談　担当が未定　ウォークイン')).toContainText(
    '担当が未定',
  )
})

// @e2e-covers AC-LEDGER-08
test('「ご来店お待ち」は最下段の全幅の帯で、行見出しに人数が出る', async ({ page }) => {
  await openLedger(page)

  const waiting = grid(page).getByRole('rowheader').last()
  await expect(waiting).toContainText('ご来店お待ち')
  // `walk_ins` は 008-reception-and-walkin で足すので、いまは 0名 の器である。
  await expect(waiting).toContainText('0名')

  const cell = grid(page).getByRole('gridcell', { name: 'いまお待ちのお客様はいません。' })
  await expect(cell).toHaveAttribute('aria-colspan', String(COLUMNS))
})

// @e2e-covers UC-LEDGER-02 AC-LEDGER-09
test('並べ方を「設備・場所」にすると縦軸が設備の行に入れ替わる', async ({ page }) => {
  await openLedger(page)

  await axisButton(page, '設備・場所').click()
  await expect(grid(page).getByRole('columnheader').first()).toHaveText('設備・場所')
  const names = (await grid(page).getByRole('rowheader').allInnerTexts()).map(
    (text) => text.split('\n')[0],
  )
  expect(names.slice(0, 5)).toEqual([
    '視力測定機 A',
    '視力測定機 B',
    '検査室 1',
    '相談カウンター 1',
    '相談カウンター 2',
  ])
  // 日付と表示のかたちは保たれる。
  await expect(page.getByText(DATE_LABEL)).toBeVisible()
  await expect(modeButton(page, 'タイムテーブル')).toHaveAttribute('aria-pressed', 'true')
})

// @e2e-covers AC-LEDGER-10
test('場所を 2 つ押さえた 1 件の予約は 2 行に出て、片方を押すともう片方にも印が付く', async ({
  page,
}) => {
  await openLedger(page)
  await axisButton(page, '設備・場所').click()

  // AC の Given は「**同時に**押さえている」なので、持ち替え（15:30 測定機 → 16:00 相談）
  // ではなく、11:00–12:00 を 視力測定機 A と 相談カウンター 2 で同時に押さえた 1 件を見る。
  const measuring = band(
    page,
    '11:00から12:00　田中 花子 様　4回目　新調相談・視力測定　視力測定機 A',
  )
  const counter = band(
    page,
    '11:00から12:00　田中 花子 様　4回目　新調相談・視力測定　相談カウンター 2',
  )
  await expect(measuring).toBeVisible()
  await expect(counter).toBeVisible()

  await measuring.click()
  await expect(measuring).toHaveAttribute('aria-selected', 'true')
  await expect(counter).toHaveAttribute('aria-selected', 'true')
})

// @e2e-covers AC-LEDGER-11
test('点検の時間帯は「点検」で埋まり、予約の無い設備は「いま空いています」と出る', async ({
  page,
}) => {
  await openLedger(page)
  await axisButton(page, '設備・場所').click()
  // 点検（視力測定機 B・10:00–12:00）が入っているのは 2026年8月28日（金）である。
  await page.getByRole('button', { name: '次の日' }).click()
  await expect(page.getByText(NEXT_DATE_LABEL)).toBeVisible()

  const maintenance = band(page, '10:00から12:00　点検　視力測定機 B')
  await expect(maintenance).toBeVisible()
  await expect(band(page, '検査室 1　いま空いています')).toBeVisible()

  // 埋まった枠の文字は地との差を 4.5:1 以上に保つ（地を明るくする側で解く）。
  const ratio = await maintenance
    .locator('span')
    .first()
    .evaluate((node) => {
      const luminance = (color: string) => {
        const parts = (color.match(/[\d.]+/g) ?? []).map(Number)
        const channel = (index: number) => {
          const s = (parts[index] ?? 0) / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
      }
      const style = getComputedStyle(node)
      const ink = luminance(style.color)
      const paper = luminance(style.backgroundColor)
      return (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05)
    })
  expect(ratio).toBeGreaterThanOrEqual(4.5)
})

// @e2e-covers UC-LEDGER-03 AC-LEDGER-12
test('表示のかたちを「予約リスト」にすると時間順の行になり、出どころの 4 語がそのまま出る', async ({
  page,
}) => {
  await openLedger(page)
  await modeButton(page, '予約リスト').click()

  const table = page.getByRole('table', { name: '本日のご予約' })
  await expect(table).toBeVisible()
  expect(await table.getByRole('columnheader').allInnerTexts()).toEqual([
    '受け付け',
    '時間',
    'お客様',
    'ご用件',
    '担当',
  ])

  await expect(page.getByRole('button', { name: 'すべて 12件' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'これから 7件' })).toBeVisible()
  await expect(page.getByRole('button', { name: '確認待ち 1件' })).toBeVisible()

  await expect(table).toContainText('お電話')
  await expect(table).toContainText('Web予約')
  await expect(table).toContainText('ウォークイン')
  // 店頭（＝店頭で先の日時を伺ったご予約）は 15:00 の 1 件で、一覧の 9 行目にあたる。
  await page.getByRole('button', { name: 'これから 7件' }).click()
  await expect(table).toContainText('店頭')
})

// @e2e-covers AC-LEDGER-13
test('「これから」を押すと現在時刻までに始まった行が消え、0 件の絞り込みは行き止まりにしない', async ({
  page,
  request,
}) => {
  /*
   * 札の数字はサーバが `counts` として数える。画面で見る 11:08 の姿は応答を据えないと
   * 作れない（seed の日は過ぎており、サーバに時刻を渡す口が無い）ので、**据えない応答を
   * 1 本だけ直に取り、サーバ自身の数え方をその応答の中で検算しておく**。
   * こうしておけば、`counts` が帯の数と無関係な値を返すようになれば必ず落ちる。
   */
  const res = await request.get('/api/staff/ledger', {
    ...(await authed(request)),
    params: { storeId: GINZA, date: LEDGER_DATE, axis: 'staff', view: 'list', filter: 'all' },
  })
  expect(res.status()).toBe(200)
  const raw = (await res.json()) as {
    serverNow: string
    counts: { all: number; upcoming: number; pendingReview: number }
    lanes: {
      kind: string
      entries: { startsAt: string; source: string; isUnassigned: boolean }[]
    }[]
  }
  const drawn = raw.lanes.filter((lane) => lane.kind !== 'walkin').flatMap((lane) => lane.entries)
  expect(raw.counts.all).toBe(drawn.length)
  expect(raw.counts.upcoming).toBe(
    drawn.filter((entry) => Date.parse(entry.startsAt) > Date.parse(raw.serverNow)).length,
  )
  expect(raw.counts.pendingReview).toBe(
    drawn.filter((entry) => entry.source === 'web' && entry.isUnassigned).length,
  )

  await openLedger(page)
  await modeButton(page, '予約リスト').click()

  const rows = page.getByRole('table', { name: '本日のご予約' }).locator('tbody tr')
  // 一覧に出す行は 8 つまでで、超えたぶんは末尾の 1 行にまとめる。
  await expect(rows).toHaveCount(8)
  await expect(rows.first()).toContainText('10:00')
  await expect(page.getByText('このあと 15:00 ほか 4件。')).toBeVisible()

  // モックの行は 62px。「受け付け」欄の語を縦に積むと 90px 近くになり、8 行目と
  // 末尾のまとめが iPad の高さに収まらず、スクロールしないと読めなくなる。
  const heights = await rows.evaluateAll((nodes) => nodes.map((node) => node.clientHeight))
  expect(Math.max(...heights)).toBeLessThanOrEqual(66)
  const scrolls = await page.getByText('このあと 15:00 ほか 4件。').evaluate((node) => {
    let box = node.parentElement
    while (box !== null) {
      if (box.scrollHeight > box.clientHeight + 1) return true
      box = box.parentElement
    }
    return false
  })
  expect(scrolls).toBe(false)

  await page.getByRole('button', { name: 'これから 7件' }).click()
  // 11:08 までに始まった 5 行（10:00・10:30・11:00 の 2 行・11:02）が消える。
  // 頭打ちが 8 行なので「12 → 7」の引き算は行数だけでは見えない。消えたことは
  // 先頭が 13:00 に変わることと、末尾のまとめが消えることで読む。
  await expect(rows).toHaveCount(7)
  await expect(rows.first()).toContainText('13:00')
  await expect(page.getByText('このあと', { exact: false })).toHaveCount(0)

  // 当てはまる行が 0 件になる絞り込みは、表を空のまま残さない。
  await page.getByRole('button', { name: '確認待ち 1件' }).click()
  await page.getByRole('button', { name: '次の日' }).click()
  await expect(page.getByText(NEXT_DATE_LABEL)).toBeVisible()
  await expect(page.getByText('「確認待ち」のご予約はありません。')).toBeVisible()
  await expect(
    page.getByText('Webから入って、担当がまだ決まっていないご予約だけを出しています。'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'すべてを見る' }).click()
  await expect(page.getByRole('button', { name: 'すべて 0件' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

// @e2e-covers AC-LEDGER-14
test('担当が未定の行は担当の欄が「決めてください」になる', async ({ page }) => {
  await openLedger(page)
  await modeButton(page, '予約リスト').click()

  // 担当が未定は 11:02（ウォークイン）・13:00（Web予約）・15:30 の 3 件で、
  // 一覧に出る 8 行の中に前の 2 件がある。
  const rows = page
    .getByRole('table', { name: '本日のご予約' })
    .getByRole('row')
    .filter({ hasText: '決めてください' })
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('11:02')
  await expect(rows.nth(1)).toContainText('13:00')
  await expect(rows.nth(1)).toContainText('Web予約')
})

// @e2e-covers UC-LEDGER-04 AC-LEDGER-15
test('帯を押すと台帳を隠さずに詳細が開き、次の操作が 3 つだけ並ぶ', async ({ page }) => {
  await openLedger(page)
  await band(page, '11:00から12:00　田中 花子 様　4回目　新調相談・視力測定　佐藤 美咲').click()

  const detail = page.getByRole('dialog', { name: '予約の詳細' })
  await expect(detail).toBeVisible()
  // 台帳は隠れない（モーダルにしない）。
  await expect(grid(page)).toBeVisible()

  await expect(detail.getByRole('heading', { name: '11:00–12:00' })).toBeVisible()
  await expect(detail).toContainText('60分')
  // 出どころの札は「お電話」に揃える（モックの「電話予約」は直さず実装だけを揃える）。
  await expect(detail).toContainText('お電話')
  await expect(detail).toContainText('メガネを新しく作る')
  await expect(detail).toContainText('佐藤 美咲')
  await expect(detail).toContainText('視力測定機 A ／ 相談カウンター 2')
  await expect(detail).toContainText('度数変更の理由は、段階的に説明してください。')

  const actions = detail.getByRole('group', { name: 'このご予約への操作' })
  expect(await actions.getByRole('button').allInnerTexts()).toEqual([
    'ご来店を受け付ける',
    '変更する',
    '取り消す',
  ])

  /*
   * すでに受け付けが済んだご予約は、押し直す導線を出さず事実だけを出す。
   *
   * AC-LEDGER-15 は「受付済み 11:02」と時刻まで書いているが、**受付時刻の出どころが
   * P2 にはまだ無い** —— `reservations` に受付時刻の列が無く、それを入れる経路
   * （ご来店の受け付け）は `008-reception-and-walkin` である。時刻を捏造しないので、
   * ここで見るのは事実の語だけにする。時刻は 008 が列と一緒に足す。
   */
  await page.keyboard.press('Escape')
  await band(page, '10:00から10:30　伊藤 健 様　2回目　調整　高橋 健').click()
  const arrived = page.getByRole('dialog', { name: '予約の詳細' })
  await expect(arrived).toContainText('受付済み')
  await expect(arrived.getByRole('button', { name: 'ご来店を受け付ける' })).toHaveCount(0)
})

// @e2e-covers UC-LEDGER-07 AC-LEDGER-16
test('12:00 に終わる予約の後ろには片付けの 10分が付き、次の刻みから置ける', async ({ request }) => {
  // 13:00–14:00 の 1 件（高橋 健）を使う。8月27日の 12:00 台は店舗の受付停止帯
  // （お昼 12:00–13:00）なので、片付けだけを見るには帯の外の時刻で確かめる。
  const answer = await availability(request, {
    purposeIds: PURPOSE_ADJUST,
    durationMinutes: 60,
    staffId: TAKAHASHI,
  })
  expect(answer.cleanupMinutes).toBe(10)

  // 14:00 に終わる予約の「終わりちょうど」は、片付け 10分ぶんまだ置けない。
  const atEnd = slotAt(answer.slots, '2026-08-27T05:00:00.000Z')
  expect(atEnd.isAvailable).toBe(false)
  expect(atEnd.reason).toBe('staff_busy')
  // 次の刻み（14:30）は置ける。
  expect(slotAt(answer.slots, '2026-08-27T05:30:00.000Z').isAvailable).toBe(true)
})

// @e2e-covers AC-LEDGER-17
test('担当が未定の予約も同時受付の上限に数えられ、上限に達した時刻は満席になる', async ({
  request,
}) => {
  const answer = await availability(request, { purposeIds: PURPOSE_ADJUST })

  /*
   * 「担当が未定も数える」を見分ける枠は、未定の 1 件で残りが 1 つ減るところである。
   * 13:00 台は 2 件（13:00–13:20 の担当が未定の Web 予約と、13:00–14:00 の高橋 健）で
   * 残り 1。13:30 は高橋 健の 1 件だけなので残り 2。**この差そのものが未定の 1 件**で、
   * 未定を数えない実装なら 13:00 も 2 になる。
   */
  const afternoon = slotAt(answer.slots, '2026-08-27T04:00:00.000Z')
  expect(afternoon.isAvailable).toBe(true)
  expect(afternoon.remaining).toBe(1)
  expect(slotAt(answer.slots, '2026-08-27T04:30:00.000Z').remaining).toBe(2)

  /*
   * 満席になるのは 11:00 だけである（4 件。うち 1 件が担当未定）。seed には
   * 「未定を含めてちょうど 3 件」の枠が無いので、この 1 本は上限に触れたときの
   * 応答の形（`max_parallel` と残り 0）を見るためのものであり、数え方の見分けは
   * 上の 13:00 と 13:30 の差と `test/availability.time.test.ts` が持つ。
   */
  const full = slotAt(answer.slots, '2026-08-27T02:00:00.000Z')
  expect(full.isAvailable).toBe(false)
  expect(full.remaining).toBe(0)
  expect(full.reason).toBe('max_parallel')
})

// @e2e-covers UC-LEDGER-09 AC-LEDGER-18
test('通信が切れても台帳は読めたまま残り、書き込みの操作を受け付けない', async ({ page }) => {
  // **タイムテーブルを開いたまま**切る。先に予約リストへ切り替えてしまうと、
  // 切れた台帳が「時間順のリストとして読める状態」になるかを誰も見ないまま通る。
  await openLedger(page)
  await expect(grid(page)).toBeVisible()

  // 台帳の取り直しだけを落とす（あとから足した route が先に効く）。
  await page.route(
    (url) => url.pathname === '/api/staff/ledger',
    async (route) => await route.abort('failed'),
  )
  await page.getByRole('button', { name: '次の日' }).click()

  const banner = page.getByText('通信が切れています').locator('..').locator('..')
  await expect(banner).toHaveAttribute('role', 'status')
  await expect(banner).toContainText('11:08 現在')
  await expect(banner.getByRole('button', { name: '再接続を試す' })).toBeVisible()
  // 次に自動で試す時刻を 1 行添える（IDX-LEDGER-09 主フロー 3。60 秒あと）。
  await expect(banner).toContainText('11:09 に自動でも試します')

  // 読むことは続けられる。書き込みの入口（「受け付け」の列）は列ごと出さない。
  const table = page.getByRole('table', { name: '本日のご予約' })
  await expect(table).toBeVisible()
  expect(await table.getByRole('columnheader').allInnerTexts()).toEqual([
    '時間',
    'お客様',
    'ご用件',
    '担当',
  ])
  await expect(page.getByText(DATE_LABEL)).toBeVisible()
  // いま何時かは届いていない。「現在 11:08」の札を残すと、帯の「11:08 現在」と
  // 同じ時刻が 2 つの意味で並ぶ。
  await expect(page.getByText('現在 11:08')).toHaveCount(0)
})

// @e2e-covers UC-LEDGER-10 AC-LEDGER-19
test('開いた詳細は 3 つのどの道でも閉じ、閉じるその 1 回は新しい予約を起こさない', async ({
  page,
}) => {
  await openLedger(page)
  const target = band(page, '11:00から12:00　田中 花子 様　4回目　新調相談・視力測定　佐藤 美咲')
  const detail = page.getByRole('dialog', { name: '予約の詳細' })

  // ① Esc
  await target.click()
  await expect(detail).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)
  // 閉じたらフォーカスは元の帯へ戻る。
  await expect(target).toBeFocused()

  // ② 開いた帯をもう一度押す。詳細は台帳いっぱいの覆いを敷いているので、
  //    その 1 回は覆いに当たって閉じるだけになり、台帳へは届かない。
  await target.click()
  await expect(detail).toBeVisible()
  await tap(page, target)
  await expect(detail).toHaveCount(0)

  // ③ 台帳の空いているところを 1 回押す。その 1 回は新しい予約を起こさない。
  await target.click()
  await expect(detail).toBeVisible()
  await tap(page, grid(page).getByRole('gridcell', { name: '10:30　佐藤 美咲　空いています' }))
  await expect(detail).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // 日付・並べ方・表示のかたちは変わらない。
  await expect(page.getByText(DATE_LABEL)).toBeVisible()
  await expect(axisButton(page, '担当者')).toHaveAttribute('aria-pressed', 'true')
  await expect(modeButton(page, 'タイムテーブル')).toHaveAttribute('aria-pressed', 'true')
})

// @e2e-covers AC-LEDGER-20
test('台帳は矢印キーで枠を移れる格子で、またぐ帯を 2 度読ませない', async ({ page }) => {
  await openLedger(page)

  await expect(grid(page)).toHaveAttribute('aria-colcount', String(COLUMNS + 1))
  // 2 列にまたがる帯は先頭のセルにだけ置き、幅は aria-colspan で伝える。
  const wide = band(page, '11:00から12:00　田中 花子 様　4回目　新調相談・視力測定　佐藤 美咲')
  await expect(wide).toHaveCount(1)
  await expect(wide).toHaveAttribute('aria-colspan', '2')

  // 焦点を持てるセルは台帳ぜんぶで 1 つ（roving tabindex）。
  const roving = page.locator('[data-ledger-cell][tabindex="0"]')
  await expect(roving).toHaveCount(1)
  await roving.focus()
  const first = await roving.getAttribute('aria-label')
  await page.keyboard.press('ArrowRight')
  const moved = await page.locator('[data-ledger-cell][tabindex="0"]').getAttribute('aria-label')
  expect(moved).not.toBe(first)

  // 焦点の輪は白い枠の上でも緑の帯の上でも見える（非テキストの 3:1）。
  await wide.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  const ring = await wide.evaluate((node) => {
    // 輪が実際に描かれていること（`focus-visible` が当たっていること）まで見る。
    // 当たっていなければ `outline-color` は currentColor に落ちて、比だけなら素通りする。
    const luminance = (color: string) => {
      const parts = (color.match(/[\d.]+/g) ?? []).map(Number)
      const channel = (index: number) => {
        const s = (parts[index] ?? 0) / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
    }
    const style = getComputedStyle(node)
    const outline = luminance(style.outlineColor)
    const band = node.firstElementChild
    const paper = luminance(getComputedStyle(band ?? node).backgroundColor)
    return {
      width: style.outlineWidth,
      ratio: (Math.max(outline, paper) + 0.05) / (Math.min(outline, paper) + 0.05),
    }
  })
  expect(ring.width).toBe('3px')
  expect(ring.ratio).toBeGreaterThanOrEqual(3)

  // Tab 1 回で台帳を通り抜ける（14 列ぶんの移動を要さない）。
  await page.locator('[data-ledger-cell][tabindex="0"]').focus()
  await page.keyboard.press('Tab')
  await expect(page.locator('[role="grid"] :focus')).toHaveCount(0)
})

// @e2e-covers UC-LEDGER-11 AC-LEDGER-21
test('トップに本日わたしが担当するご予約が時間順に並び、1 行から台帳の詳細へ行ける', async ({
  page,
  request,
}) => {
  const headers = await authed(request)
  const versionOf = async () =>
    (
      (await (await request.get(`/api/staff/stores/${GINZA}`, headers)).json()) as {
        settingsVersion: number
      }
    ).settingsVersion
  const beMe = async (adminUserId: string | null) => {
    const res = await request.patch(`/api/staff/stores/${GINZA}/staff/${SATO}`, {
      ...headers,
      data: { adminUserId, version: await versionOf() },
    })
    expect(res.status()).toBe(200)
  }
  const membership = async () => {
    const res = await request.post('/api/internal/store-memberships/sync', {
      headers: { 'x-internal-key': INTERNAL_KEY },
      data: {
        id: MEMBERSHIP_ID,
        organizationId: ORG,
        storeId: GINZA,
        userId: VIEWER,
        permissions: MANAGER_PERMISSIONS,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    })
    expect(res.status()).toBe(200)
  }

  await membership()
  await beMe(VIEWER)
  try {
    // 佐藤 美咲が勤務していて担当予約が0件の土曜も、行き止まりにしない。
    await startWork(page, '2026-08-29T02:08:00.000Z', 'personal')
    await expect(page.getByText('本日ご担当のご予約はありません。')).toBeVisible()
    await expect(page.getByRole('button', { name: '店全体の台帳を見る' })).toBeVisible()

    await pinDeviceClock(page)
    await reopen(page, 'personal')
    const mine = page.getByRole('region', { name: '本日わたしが担当するご予約' })
    await expect(mine).toContainText('4件')
    const rows = mine.getByRole('listitem')
    await expect(rows).toHaveCount(4)
    expect((await rows.allInnerTexts()).map((text) => text.split(/\s+/)[0])).toEqual([
      '11:00',
      '14:00',
      '17:00',
      '17:30',
    ])

    // 1 行を押すと、台帳のその帯の詳細が開く。
    await rows.first().getByRole('button').click()
    await expect(page.getByRole('dialog', { name: '予約の詳細' })).toContainText('11:00–12:00')
  } finally {
    await beMe(null)
  }
})

// @e2e-covers AC-LEDGER-22
test('定休日は目盛りだけの空の格子を出さず、事実と「本日」だけを出す', async ({ page }) => {
  // 来店受付の実日付E2Eが定休日には臨時営業をseedする。固定の次の火曜と実行日が
  // 重なったときだけ、その次の火曜を開いて定休そのものを観測する。
  const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const addDays = (date: string, days: number) =>
    new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10)
  const steps = addDays(LEDGER_DATE, 5) === jstToday ? 12 : 5
  const closed = addDays(LEDGER_DATE, steps)
  const month = Number(closed.slice(5, 7))
  const day = Number(closed.slice(8, 10))

  await openLedger(page)
  for (let i = 0; i < steps; i += 1) {
    await page.getByRole('button', { name: '次の日' }).click()
  }
  await expect(page.getByText(`${closed.slice(0, 4)}年${month}月${day}日（火）`)).toBeVisible()

  await expect(page.getByText(`${month}月${day}日（火）は定休日です。`)).toBeVisible()
  await expect(page.getByRole('grid', { name: '予約台帳' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '本日' })).toBeVisible()
})

test('確認待ちの「内容を確認」から、担当を決める面へそのまま入れる', async ({ page }) => {
  /*
   * Web から入って担当が空のご予約は、受信日の 24:00 JST を越えると日次 Cron が
   * 黙って取り消す（お客様へメールは送らない）。この札は長いあいだ押しても何も
   * 起きず、店が気づく手立てがどこにも無かった（UX 監査 NEW-05）。
   */
  await openLedger(page)
  await modeButton(page, '予約リスト').click()

  const review = page.getByRole('button', { name: '内容を確認' }).first()
  await expect(review).toBeVisible()
  await review.click()

  await expect(page.getByRole('table', { name: 'ご予約を置く盤' })).toBeVisible()
  await expect(page.getByRole('list', { name: /予約の変更の工程/ })).toContainText(
    '担当と場所を変える',
  )
})
