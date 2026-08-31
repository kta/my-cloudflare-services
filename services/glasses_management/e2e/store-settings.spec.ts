import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * 店舗の受付条件（004-store-settings）の受け入れ基準を、実ブラウザと実 Worker で確かめる。
 * `vite preview` が実 workerd を動かし、D1 は `seed.mjs` が入れた EYEX 銀座店の盤面である。
 *
 * 1 本の test の直前の行に `// @e2e-covers <ID> ...` を置く。UC は対になる AC の test に
 * 相乗りさせ、36 件（UC-SET-01..14 / AC-SET-01..22）をちょうど 1 回ずつ並べる。
 *
 * **この面の e2e は D1 を書き換える。** 消す経路を持たない 3 本（スタッフ・設備・目的を足す）を
 * 最後に置き、それ以外は必ず元の値へ戻す。承認済みモックとの突き合わせ（mock project）は
 * この面より先に走る（playwright.config.ts の project の並び）。
 */

const ORG = 'org-eyex-seed'
/** seed.mjs が固定 id で入れる EYEX 銀座店。 */
const GINZA = '11111111-1111-4111-8111-111111111111'
/** dev グラントが載せる `sub`。担当店舗の `userId` はこれに合わせる。 */
const VIEWER = `dev:${ORG}`
/**
 * 担当店舗の行 id を固定する。`store-memberships/sync` は id で upsert するので、
 * 毎回作り直すと古い権限の行が残り、権限を下げたつもりが下がらない。
 */
const MEMBERSHIP_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
/** `.dev.vars` の dev 値。preview も同じ値を読む（本番は wrangler secret）。 */
const INTERNAL_KEY = 'dev-internal-key'

/** 店長（設定を保存できる）。 */
const MANAGER_PERMISSIONS = [
  'store.read',
  'store.manage',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.write',
  'settings.read',
  // 分析は seed の盤面をそのまま読むので、配り直しでも `analytics.read` を落とさない。
  'analytics.read',
  'settings.manage',
]
/** スタッフ（設定は見るだけ）。AC-SET-17 が使う。 */
const STAFF_PERMISSIONS = ['store.read', 'reservation.read', 'customer.read', 'settings.read']

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']

/* --- 前提データ ---------------------------------------------------------- */

async function tokenFor(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/token', {
    data: { organizationId: ORG, role: 'staff' },
  })
  expect(res.status()).toBe(200)
  return ((await res.json()) as { token: string }).token
}

/** JWT を載せた要求の頭。API を直に叩くのは前提づくりと突き合わせだけに使う。 */
async function authed(request: APIRequestContext): Promise<{ headers: Record<string, string> }> {
  return { headers: { authorization: `Bearer ${await tokenFor(request)}` } }
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

test.beforeEach(async ({ request }) => {
  // 既定は店長。権限を下げる 1 本だけが自分で配り直し、終わりにここへ戻す。
  await grant(request, MANAGER_PERMISSIONS)
})

/* --- 画面を開く ---------------------------------------------------------- */

async function startWork(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(ORG)
  await page.getByRole('button', { name: '業務を始める' }).click()
  await expect(page.locator('header').first()).toContainText('EYEX 銀座店')
}

function sectionNav(page: Page) {
  return page.getByRole('navigation', { name: '設定の項目' })
}

/** 第2サイドバーで面を切り替える。保存バーの見出しがその名前になるまで待つ。 */
async function goToSection(page: Page, section: string): Promise<void> {
  await sectionNav(page).getByRole('button', { name: section, exact: true }).click()
  await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible()
}

async function openSettings(page: Page, section: string): Promise<void> {
  await startWork(page)
  await page
    .getByRole('navigation', { name: '画面の切り替え' })
    .getByRole('button', { name: '設定', exact: true })
    .click()
  await goToSection(page, section)
}

/** 面を開き直す（保存したものが本当に残っているかを見る）。 */
async function reopenSection(page: Page, section: string, via = '店舗の情報'): Promise<void> {
  await goToSection(page, via === section ? '営業日' : via)
  await goToSection(page, section)
}

/* --- 保存バー ------------------------------------------------------------ */

const saveButton = (page: Page) => page.getByRole('button', { name: '保存', exact: true })
const discardButton = (page: Page) => page.getByRole('button', { name: '変更を捨てる' })
const unsavedBadge = (page: Page) => page.getByText(/^未保存の変更 \d+件$/)

async function save(page: Page): Promise<void> {
  await saveButton(page).click()
  await expect(page.getByText('保存しました')).toBeVisible()
  await expect(unsavedBadge(page)).toHaveCount(0)
}

/* --- 日付（JST の壁掛けカレンダー） -------------------------------------- */

function jstWeekday(at: Date = new Date()): number {
  const label = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  }).format(at)
  return WEEKDAY_NAMES.indexOf(label)
}

/* ─────────────────────────────────────────────────────────────────────────── */

// @e2e-covers UC-SET-01 AC-SET-01
test('設定を開くと店舗の情報が出て、お店の基本と行き方のご案内が並ぶ', async ({ page }) => {
  await openSettings(page, '店舗の情報')

  await expect(sectionNav(page).getByRole('button', { name: '店舗の情報' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByText('お店の基本')).toBeVisible()
  await expect(page.getByText('行き方のご案内')).toBeVisible()
  await expect(page.getByLabel('店名', { exact: true })).toHaveValue('EYEX 銀座店')
  await expect(page.getByLabel('お客様に見せる店名')).toHaveValue('EYEX 銀座店（銀座4丁目）')
  await expect(page.getByLabel('電話番号')).toHaveValue('03-3571-0001')
  await expect(page.getByLabel('最寄り駅')).toHaveValue('東京メトロ 銀座駅')
  await expect(page.getByLabel('出口と所要時間')).toHaveValue('A1出口から徒歩3分')
  await expect(page.getByLabel('駐車場')).toHaveValue('提携駐車場はありません')
  // 第2サイドバーはモックの 14 項目ではなく 7 項目だけを出す（P1 の決め #1）。
  // 6 項目だったところへ P8 が「Web予約の公開」を足して 7 項目になった。
  await expect(sectionNav(page).getByRole('button')).toHaveCount(7)
})

// @e2e-covers AC-SET-02
test('店名と住所を直すと未保存の変更 2件になり、保存すると保存しましたが 1 度だけ伝わる', async ({
  page,
}) => {
  await openSettings(page, '店舗の情報')
  const name = page.getByLabel('店名', { exact: true })
  const address = page.getByLabel('住所', { exact: true })
  const before = { name: await name.inputValue(), address: await address.inputValue() }

  await expect(saveButton(page)).toBeDisabled()
  await name.fill('EYEX 銀座本店')
  await address.fill('東京都中央区銀座4-1-2')

  await expect(unsavedBadge(page)).toHaveText('未保存の変更 2件')
  await expect(saveButton(page)).toBeEnabled()
  await save(page)
  await expect(page.getByText('保存しました')).toHaveCount(1)

  await reopenSection(page, '店舗の情報', '営業日')
  await expect(page.getByLabel('店名', { exact: true })).toHaveValue('EYEX 銀座本店')

  // 盤面を seed のままへ戻す。
  await page.getByLabel('店名', { exact: true }).fill(before.name)
  await page.getByLabel('住所', { exact: true }).fill(before.address)
  await save(page)
})

// @e2e-covers AC-SET-03
test('変更を捨てると値が編集前へ戻り、未保存の札が消える', async ({ page }) => {
  await openSettings(page, '店舗の情報')
  const name = page.getByLabel('店名', { exact: true })
  const before = await name.inputValue()

  await name.fill('打ち間違えた店名')
  await page.getByLabel('駐車場').fill('打ち間違えた駐車場')
  await expect(unsavedBadge(page)).toHaveText('未保存の変更 2件')

  await discardButton(page).click()

  await expect(name).toHaveValue(before)
  await expect(page.getByLabel('駐車場')).toHaveValue('提携駐車場はありません')
  await expect(unsavedBadge(page)).toHaveCount(0)
  await expect(saveButton(page)).toBeDisabled()
})

// @e2e-covers UC-SET-02 AC-SET-04
test('紹介文は 200 文字ちょうどなら保存でき、201 文字は 2 文で拒む', async ({ page }) => {
  await openSettings(page, '店舗の情報')
  await page.getByRole('button', { name: '書き直す' }).click()
  const intro = page.getByLabel('お客様に見せる紹介文')
  const before = await intro.inputValue()

  await intro.fill('あ'.repeat(200))
  await expect(page.getByText('200文字／200文字まで')).toBeVisible()
  await expect(saveButton(page)).toBeEnabled()
  await save(page)

  await page.getByRole('button', { name: '書き直す' }).click()
  await page.getByLabel('お客様に見せる紹介文').fill('あ'.repeat(201))
  await expect(page.getByText('201文字／200文字まで')).toBeVisible()
  await expect(
    page.getByText('紹介文が 200 文字を超えているため保存できません。文字数を減らしてください。'),
  ).toBeVisible()
  await expect(saveButton(page)).toBeDisabled()

  // 盤面を seed のままへ戻す。
  await page.getByLabel('お客様に見せる紹介文').fill(before)
  await save(page)
})

// @e2e-covers UC-SET-03 AC-SET-05
test('閉店を開店と同じ時刻にすると 2 文で拒み、営業時間は元のままである', async ({ page }) => {
  await openSettings(page, '営業時間')
  const opens = page.getByLabel('開店')
  const closes = page.getByLabel('閉店')
  await expect(opens).toHaveValue('10:00')
  await expect(closes).toHaveValue('19:00')

  await closes.fill('10:00')
  await expect(
    page.getByText('閉店が開店より前のため保存できません。閉店の時刻を直してください。'),
  ).toBeVisible()
  await expect(saveButton(page)).toBeDisabled()

  // 受付を止める時間帯が営業時間の外へ出たときも同じ型で拒む。
  await closes.fill('12:00')
  await expect(
    page.getByText(
      '受付を止める時間帯が営業時間の外にあるため保存できません。時間を直してください。',
    ),
  ).toBeVisible()
  await expect(saveButton(page)).toBeDisabled()

  await discardButton(page).click()
  await reopenSection(page, '営業時間')
  await expect(page.getByLabel('閉店')).toHaveValue('19:00')
})

// @e2e-covers UC-SET-04 AC-SET-06
test('止める時間帯を足すと行が 1 つ増える', async ({ page }) => {
  await openSettings(page, '営業時間')
  const bands = page.getByRole('group', { name: /^受付を止める時間帯 \d+$/ })
  await expect(bands).toHaveCount(3)
  await expect(
    page.getByRole('group', { name: '受付を止める時間帯 2' }).getByLabel('名前'),
  ).toHaveValue('お昼')

  await page.getByRole('button', { name: '＋ 止める時間帯を足す' }).click()
  await page.getByLabel('足す時間帯の名前').fill('棚卸し')
  await page.getByLabel('足す時間帯の開始').fill('15:00')
  await page.getByLabel('足す時間帯の終了').fill('15:30')
  await page.getByRole('button', { name: '足す' }).click()

  await expect(bands).toHaveCount(4)
  await save(page)
  await reopenSection(page, '営業時間')
  await expect(page.getByRole('group', { name: /^受付を止める時間帯 \d+$/ })).toHaveCount(4)

  // 盤面を seed のままへ戻す（足した帯だけを消す）。
  const added = page.getByRole('group', { name: '受付を止める時間帯 3' })
  await expect(added.getByLabel('名前')).toHaveValue('棚卸し')
  await added.getByRole('button', { name: '消す' }).click()
  await save(page)
  await expect(page.getByRole('group', { name: /^受付を止める時間帯 \d+$/ })).toHaveCount(3)
})

// @e2e-covers UC-SET-05 AC-SET-07
test('予約の間隔を見ると、最後にお受けできる時刻が空き枠と同じ式で出る', async ({
  page,
  request,
}) => {
  const rules = (await (
    await request.get(`/api/staff/stores/${GINZA}/slot-rules`, await authed(request))
  ).json()) as { lastAcceptableAt: Record<string, string | null> }
  const weekday = jstWeekday()
  const expected = rules.lastAcceptableAt[String(weekday)]

  await openSettings(page, '営業時間')
  await expect(page.getByLabel('1件あたりの片付け時間')).toHaveValue('10')
  await expect(page.getByLabel('予約をお受けする刻み')).toHaveValue('30')
  await expect(page.getByLabel('同じ時刻に受けられる件数')).toHaveValue('3')

  const line = page.getByText(/曜日に最後にお受けできるのは/)
  if (expected === null) {
    // 定休の曜日は最後の時刻を持たない。押せない時刻を案内しないので 1 行も出さない。
    await expect(line).toHaveCount(0)
  } else {
    // 画面で計算し直さず、空き枠エンジンが返す最後の開始時刻そのものを出す。
    await expect(line).toHaveText(
      `${WEEKDAY_NAMES[weekday]}曜日に最後にお受けできるのは ${expected} です。`,
    )
  }
})

// @e2e-covers UC-SET-06 AC-SET-08
test('営業日の丸を押して保存すると、その日が休みになり臨時のお休みに入る', async ({ page }) => {
  await openSettings(page, '営業日')
  // seed の 9月30日は最初から臨時のお休みなので、同じ移り変わりを別の平日で見る。
  const day = page.locator('[data-date="2026-09-28"]')
  await expect(day).toHaveAttribute('data-state', 'open')

  await day.click()
  await save(page)

  await expect(page.locator('[data-date="2026-09-28"]')).toHaveAttribute(
    'data-state',
    'exception-closed',
  )
  await expect(page.locator('[data-date="2026-09-28"]')).toHaveAttribute(
    'aria-label',
    /9月28日（月） 臨時のお休み/,
  )
  await expect(page.getByTestId('closed-days')).toContainText('9月28日（月）')

  // 盤面を seed のままへ戻す。
  await page.locator('[data-date="2026-09-28"]').click()
  await save(page)
  await expect(page.locator('[data-date="2026-09-28"]')).toHaveAttribute('data-state', 'open')
})

// @e2e-covers AC-SET-09
test('臨時のお休みをもう一度押して保存すると営業日へ戻り、一覧から消える', async ({ page }) => {
  await openSettings(page, '営業日')
  const day = page.locator('[data-date="2026-09-30"]')
  await expect(day).toHaveAttribute('data-state', 'exception-closed')
  await expect(page.getByTestId('closed-days')).toContainText('9月30日（水）')

  await day.click()
  await save(page)

  await expect(page.locator('[data-date="2026-09-30"]')).toHaveAttribute('data-state', 'open')
  await expect(page.getByTestId('closed-days')).not.toContainText('9月30日（水）')

  // 盤面を seed のままへ戻す（棚卸しの但し書きは書き戻せないので日付だけ戻す）。
  await page.locator('[data-date="2026-09-30"]').click()
  await save(page)
  await expect(page.locator('[data-date="2026-09-30"]')).toHaveAttribute(
    'data-state',
    'exception-closed',
  )
})

// @e2e-covers UC-SET-07 AC-SET-10
test('スタッフを選ぶと右がその人の設定になり、持っている技能に ✓ が付く', async ({ page }) => {
  await openSettings(page, 'スタッフと技能')
  await expect(page.getByText('スタッフ　6名')).toBeVisible()

  const list = page.getByRole('list', { name: 'スタッフ' })
  await expect(list.getByRole('listitem').nth(5)).toContainText('山田 大輔')
  await expect(list.getByRole('listitem').nth(5)).toContainText('店長')

  await list.getByRole('button', { name: /佐藤 美咲/ }).click()
  await expect(page.getByRole('heading', { name: '佐藤 美咲 の設定' })).toBeVisible()

  for (const skill of ['視力測定', '加工', '販売・受付']) {
    await expect(page.getByRole('button', { name: skill, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }
  await expect(page.getByRole('button', { name: 'フィッティング', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

// @e2e-covers AC-SET-11
test('技能を押して保存すると、一覧のその人の技能に加わる', async ({ page }) => {
  await openSettings(page, 'スタッフと技能')
  const list = page.getByRole('list', { name: 'スタッフ' })
  const row = list.getByRole('listitem').filter({ hasText: '佐藤 美咲' })
  await row.getByRole('button').first().click()

  await page.getByRole('button', { name: 'フィッティング', exact: true }).click()
  await expect(unsavedBadge(page)).toHaveText('未保存の変更 1件')
  await save(page)

  await expect(row).toContainText('フィッティング')

  // 盤面を seed のままへ戻す。
  await page.getByRole('button', { name: 'フィッティング', exact: true }).click()
  await save(page)
  await expect(row).not.toContainText('フィッティング')
})

// @e2e-covers UC-SET-08 AC-SET-12
test('日曜の勤務を直して保存すると残り、営業時間の外へ出ても警告だけで保存できる', async ({
  page,
}) => {
  await openSettings(page, 'スタッフと技能')
  await page
    .getByRole('list', { name: 'スタッフ' })
    .getByRole('button', { name: /佐藤 美咲/ })
    .click()

  // seed は台帳のために当日の勤務（`staff_shifts`）まで展開してあるので、日曜は
  // 12:00–19:00 で入っている（005-availability-and-ledger の seed）。ここから直す。
  await expect(page.getByLabel('日曜日の勤務の開始')).toHaveValue('12:00')
  await expect(page.getByLabel('日曜日の勤務の終了')).toHaveValue('19:00')

  await page.getByLabel('日曜日の勤務の開始').fill('10:00')
  // 日曜の営業時間は 10:00–18:00。はみ出しても保存は拒まず、起きることだけを知らせる。
  await expect(
    page.getByText('日曜日の勤務が営業時間（10:00–18:00）の外にはみ出しています。'),
  ).toBeVisible()
  await expect(saveButton(page)).toBeEnabled()
  await save(page)

  await reopenSection(page, 'スタッフと技能')
  await page
    .getByRole('list', { name: 'スタッフ' })
    .getByRole('button', { name: /佐藤 美咲/ })
    .click()
  await expect(page.getByLabel('日曜日の勤務の開始')).toHaveValue('10:00')
  await expect(page.getByLabel('日曜日の勤務の終了')).toHaveValue('19:00')
})

// @e2e-covers UC-SET-09 AC-SET-13
test('設備を止めると、保存の前に影響するご予約を数えて見せる', async ({ page }) => {
  await openSettings(page, '設備と点検')
  await expect(page.getByText('設備と場所　6件')).toBeVisible()
  // 1 台 1 行の 7 行のうち、相談カウンター 1・2 だけを表示側で 1 行にまとめる。
  const table = page.getByRole('table', { name: '設備と場所' })
  await expect(table.getByRole('button', { name: '相談カウンター 1・2' })).toBeVisible()

  await table.getByRole('button', { name: '視力測定機 B' }).click()
  await expect(page.getByText('編集中：視力測定機 B')).toBeVisible()

  const asked = page.waitForResponse(
    (res) => res.url().includes('/api/staff/settings/impact') && res.request().method() === 'POST',
  )
  await page.getByRole('switch').click()
  const report = (await (await asked).json()) as {
    severity: string
    affectedReservations: unknown[]
  }

  // 「いま使える」を切った瞬間に、保存の前へ読み取り専用の試算を投げる。
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await expect(unsavedBadge(page)).toHaveText('未保存の変更 1件')
  // P1 の D1 はご予約の行を 1 件も持たない（書き込む経路は P3 が足す）。
  // モックの「3件」は予約の行があってはじめて出るので、ここでは 0 件のままを固定し、
  // 件数そのものは test/settings-impact.time.test.ts が境界値まで押さえる。
  expect(report.affectedReservations).toHaveLength(0)
  expect(report.severity).toBe('info')
  await expect(page.getByRole('heading', { name: /止めると影響するご予約/ })).toHaveCount(0)

  await discardButton(page).click()
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
})

// @e2e-covers AC-SET-14
test('影響するご予約が 0 件の設備を止めても、影響の一覧は出ず札も赤くならない', async ({
  page,
}) => {
  await openSettings(page, '設備と点検')
  await page
    .getByRole('table', { name: '設備と場所' })
    .getByRole('button', { name: '検査室 1' })
    .click()
  await page.getByRole('switch').click()

  await expect(unsavedBadge(page)).toHaveText('未保存の変更 1件')
  await expect(page.getByRole('heading', { name: /止めると影響するご予約/ })).toHaveCount(0)
  // 赤くする理由は必ず字でも出す。その字が無いことを見れば、色を見ずに赤くないと分かる。
  await expect(page.getByText(/止めると影響するご予約が \d+件 あります/)).toHaveCount(0)
  await expect(unsavedBadge(page)).not.toHaveClass(/text-danger/)

  await discardButton(page).click()
})

// @e2e-covers UC-SET-10 AC-SET-15
test('目的の所要時間を延ばすと、変更の札と受けられなくなる Web 枠が出る', async ({ page }) => {
  await openSettings(page, 'ご来店の目的')
  await expect(page.getByText('ご来店の目的　6件')).toBeVisible()
  const table = page.getByRole('table', { name: 'ご来店の目的' })
  await table.getByRole('button', { name: 'メガネを新しく作る', exact: true }).click()
  await expect(page.getByText('編集中：メガネを新しく作る')).toBeVisible()

  const minutes = page.getByLabel('所要時間（分）')
  await expect(minutes).toHaveValue('60')

  // AC の「50分から」を作るため、まず 50 分を保存する（seed は 60 分のまま）。
  await minutes.fill('50')
  await expect(page.getByText('60分から変更')).toBeVisible()
  await save(page)

  // 短くする変更は 1 枠も落とさないので、影響のカードを出さない。
  await page.getByLabel('所要時間（分）').fill('40')
  await expect(page.getByText('50分から変更')).toBeVisible()
  await expect(page.getByRole('heading', { name: /受けられなくなるWeb枠/ })).toHaveCount(0)

  /*
   * 延ばす側。AC は 60 分を挙げているが、seed の刻み 30 分・片付け 10 分では
   * 空きが 30 分刻みでしか現れず、50→60 で落ちる枠が 1 つも無い（件数は
   * ご予約の行があってはじめて動く）。落ちる枠が確かに出る 70 分で型を固定し、
   * 「60分／2件」という数そのものは PurposePanel.test.tsx が押さえる。
   */
  await page.getByLabel('所要時間（分）').fill('70')
  await expect(page.getByText('50分から変更')).toBeVisible()
  // 読み上げ名は空白が正規化されるので、全角空白を \s で受ける。
  const card = page.getByRole('heading', { name: /70分に延ばすと受けられなくなるWeb枠\s+\d+件/ })
  await expect(card).toBeVisible()
  await expect(page.getByText(/受けられなくなるWeb枠が \d+件 あります/)).toBeVisible()
  await expect(
    page
      .getByRole('list', { name: /受けられなくなるWeb枠/ })
      .getByRole('listitem')
      .first(),
  ).toContainText('が空きません')

  // 盤面を seed のままへ戻す。
  await page.getByLabel('所要時間（分）').fill('60')
  await save(page)
  await expect(page.getByLabel('所要時間（分）')).toHaveValue('60')
})

// @e2e-covers AC-SET-16
test('Web予約に出すを切ると、一覧のその行がお店で受けるだけになる', async ({ page }) => {
  await openSettings(page, 'ご来店の目的')
  const table = page.getByRole('table', { name: 'ご来店の目的' })
  await table.getByRole('button', { name: '修理・部品交換', exact: true }).click()

  // seed は既に「お店で受けるだけ」なので、まず 6 件すべてを公開している状態を作る。
  await page.getByRole('switch').click()
  await save(page)
  await expect(table.getByText('公開しています')).toHaveCount(6)

  await page.getByRole('switch').click()
  await expect(unsavedBadge(page)).toHaveText('未保存の変更 1件')
  await save(page)

  const row = table.getByRole('row').filter({ hasText: '修理・部品交換' })
  await expect(row).toContainText('お店で受けるだけ')
  await expect(table.getByText('公開しています')).toHaveCount(5)
})

// @e2e-covers AC-SET-17
test('スタッフの権限で保存すると、店長だけができると断られ下書きは残る', async ({
  page,
  request,
}) => {
  const headers = await authed(request)
  const staff = (await (await request.get(`/api/staff/stores/${GINZA}/staff`, headers)).json()) as {
    id: string
    displayName: string
  }[]
  const nakamura = staff.find((member) => member.displayName === '中村 彩')
  expect(nakamura).toBeDefined()
  const versionOf = async () =>
    (
      (await (await request.get(`/api/staff/stores/${GINZA}`, headers)).json()) as {
        settingsVersion: number
      }
    ).settingsVersion

  // いま画面を見ているのが 中村 彩 だと分かるようにしてから、権限だけを下げる。
  const patch = async (adminUserId: string | null) => {
    const res = await request.patch(`/api/staff/stores/${GINZA}/staff/${nakamura?.id}`, {
      ...headers,
      data: { adminUserId, version: await versionOf() },
    })
    expect(res.status()).toBe(200)
  }
  await patch(VIEWER)
  await grant(request, STAFF_PERMISSIONS)

  try {
    await openSettings(page, '営業時間')
    // 帯（10:00–10:15 / 18:40–19:00）が営業時間の内側に収まる値にする。
    // はみ出すと保存そのものが拒まれ、権限で断られる面まで行き着かない。
    await page.getByLabel('開店').fill('09:00')
    await page.getByLabel('閉店').fill('20:00')
    await expect(unsavedBadge(page)).toHaveText('未保存の変更 2件')
    await saveButton(page).click()

    await expect(page.getByRole('heading', { name: 'この操作は店長だけができます' })).toBeVisible()
    await expect(
      page.getByText(
        '営業時間を変えられるのは 店長 だけです。中村 彩（スタッフ）の権限では保存できません。営業時間はまだ何も変わっていません。',
      ),
    ).toBeVisible()
    await expect(page.getByText('下書きは残っています')).toBeVisible()
    await expect(page.getByText('開店を 10:00 から 09:00 に変える')).toBeVisible()
    await expect(page.getByText('閉店を 19:00 から 20:00 に変える')).toBeVisible()
    // 打ち込んだ値は消さない。押せて何も起きない「店長に依頼する」も出さない（Q-10）。
    await expect(page.getByLabel('開店')).toHaveValue('09:00')
    await expect(page.getByLabel('閉店')).toHaveValue('20:00')
    await expect(page.getByRole('button', { name: /店長に依頼/ })).toHaveCount(0)
  } finally {
    await grant(request, MANAGER_PERMISSIONS)
    await patch('user-eyex-nakamura')
  }
})

// @e2e-covers UC-SET-11 AC-SET-18
test('いま使えるの切り替えは入切を持つ操作で、状態が字でも読めて 44pt 以上ある', async ({
  page,
}) => {
  await openSettings(page, '設備と点検')
  await page
    .getByRole('table', { name: '設備と場所' })
    .getByRole('button', { name: '視力測定機 B' })
    .click()

  const toggle = page.getByRole('switch')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(toggle).toContainText('使えます')
  const box = await toggle.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(toggle).toContainText('止めています')

  await discardButton(page).click()
  await expect(page.getByRole('switch')).toContainText('使えます')
})

// @e2e-covers AC-SET-19
test('件数の変化は割り込まない知らせとして伝わり、警告にはしない', async ({ page }) => {
  await openSettings(page, '店舗の情報')
  await page.getByLabel('店名', { exact: true }).fill('EYEX 銀座店（下書き）')

  await expect(page.getByRole('status').filter({ hasText: '未保存の変更 1件' })).toBeVisible()
  // 接客中の読み上げを断ち切る警告（role="alert"）にはしない。
  await expect(page.getByRole('alert')).toHaveCount(0)

  await discardButton(page).click()
  await expect(unsavedBadge(page)).toHaveCount(0)
})

/*
 * ここから下の 3 本は行を足す。足した行を消す経路はまだ無い（P1 は「いま使える」を
 * 切って残す）ので、盤面を seed へ戻せない。最後に置く。
 */

// @e2e-covers UC-SET-12 AC-SET-20
test('スタッフを足すと 7名になり、いま使えるを切っても行は消えない', async ({ page }) => {
  await openSettings(page, 'スタッフと技能')
  await expect(page.getByText('スタッフ　6名')).toBeVisible()

  await page.getByRole('button', { name: '＋ スタッフを足す' }).click()
  const form = page.getByRole('form', { name: 'スタッフを足す' })
  await form.getByLabel('お名前').fill('木村 涼')
  await form.getByLabel('ふりがな').fill('きむら りょう')
  await form.getByLabel('できる役割').selectOption('staff')
  await form.getByRole('button', { name: '販売・受付', exact: true }).click()
  await form.getByRole('button', { name: 'このスタッフを足す' }).click()

  await expect(page.getByText('スタッフ　7名')).toBeVisible()
  const list = page.getByRole('list', { name: 'スタッフ' })
  const row = list.getByRole('listitem').filter({ hasText: '木村 涼' })
  await expect(row).toContainText('販売・受付')

  await row.getByRole('button').first().click()
  await page.getByRole('switch', { name: /いま使える/ }).click()
  await save(page)
  // 退職した人の行は消さずに残す。過去のご予約から名前が消えないため。
  await expect(page.getByText('スタッフ　7名')).toBeVisible()
  await expect(row).toBeVisible()
})

// @e2e-covers UC-SET-13 AC-SET-21
test('設備を足すと一覧に 1 行増える', async ({ page }) => {
  await openSettings(page, '設備と点検')
  await expect(page.getByText('設備と場所　6件')).toBeVisible()

  await page.getByRole('button', { name: '＋ 設備を足す' }).click()
  await page.getByLabel('設備・場所の名前').fill('予備の測定機')
  await page.getByLabel('種別').selectOption('measure')
  await page.getByRole('button', { name: 'この設備を足す' }).click()

  await expect(page.getByText('設備と場所　7件')).toBeVisible()
  await expect(
    page.getByRole('table', { name: '設備と場所' }).getByRole('button', { name: '予備の測定機' }),
  ).toBeVisible()
})

// @e2e-covers UC-SET-14 AC-SET-22
test('目的を足すと 7件になり、並べ替えた順のまま残る', async ({ page }) => {
  await openSettings(page, 'ご来店の目的')
  await expect(page.getByText('ご来店の目的　6件')).toBeVisible()

  await page.getByRole('button', { name: '＋ 目的を足す' }).click()
  const form = page.getByRole('group', { name: '目的を足す' })
  await form.getByLabel('目的の名前（店内）').fill('補聴器のご相談')
  await form.getByLabel('お客様に見せる名前').fill('補聴器のご相談')
  await form.getByLabel('台帳に出す短い名前').fill('補聴器')
  await form.getByLabel('所要時間（分）').fill('45')
  await form.getByRole('radio', { name: '販売・受付' }).check()
  await form.getByRole('checkbox', { name: '相談カウンター' }).check()
  await form.getByRole('button', { name: 'この目的を足す' }).click()

  await expect(page.getByText('ご来店の目的　7件')).toBeVisible()
  const table = page.getByRole('table', { name: 'ご来店の目的' })
  await expect(table.getByRole('row').nth(7)).toContainText('補聴器のご相談')

  // 並べ替えはその場で保存され、お客様への提示順になる。
  await table.getByRole('button', { name: '「補聴器のご相談」を上へ' }).click()
  await expect(table.getByRole('row').nth(6)).toContainText('補聴器のご相談')
  await reopenSection(page, 'ご来店の目的')
  await expect(
    page.getByRole('table', { name: 'ご来店の目的' }).getByRole('row').nth(6),
  ).toContainText('補聴器のご相談')
})
