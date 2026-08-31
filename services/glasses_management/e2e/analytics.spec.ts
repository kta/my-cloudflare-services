import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * 分析（012-analytics）の受け入れ基準を、実ブラウザと実 Worker で確かめる。
 * `vite preview` が実 workerd を動かし、D1 は `seed.mjs` が入れた盤面である。
 *
 * **この面は D1 を 1 行も書き換えない。**画面がするのは `analytics_daily` を読むことだけで、
 * 集計そのものは seed が済ませてある（Cron を待たない）。
 *
 * 1 本の test の直前の行に `// @e2e-covers <ID> ...` を置き、31 件
 * （UC-ANA-01..10 / AC-ANA-01..21）をちょうど 1 回ずつ並べる。
 *
 * 盤面の要点（`seed.mjs` の「分析の日次集計」）:
 *   - 2026年8月は暦 31 日 − 火曜 4 日 ＝ **営業日 27 日**、ご予約 320 件、受付 328 件。
 *     「1日あたり」は 320 ÷ 27 ＝ 11.9 件になる。
 *   - 今週（8/24 月〜8/30 日）は 72 件。8/27 の 14 件がその月で最も多い。
 *   - 7月は 30・31 日の行が無い（＝まだ集計中の 2 日）。
 *   - トップが見るのは月ではなく**前後 7 日**（8/20〜9/3）なので、9/1〜9/6 の行も置いてある。
 *   - 渡辺 由紀は 19 件で小標本の閾値 20 に 1 件足りず、率が「—」になる。
 */

const ORG = 'org-eyex-seed'
/** テナント分離の見本。EYEX とは組織も店舗も担当も重ならない。 */
const RIVAL_ORG = 'org-rival-seed'
/**
 * モックが描いている瞬間（JST 2026年8月27日（木）11:08）。分析は端末の時計から
 * 「対象の期間」の選択肢と本日を決め、同じ値をサーバへ渡すので、据えるのは 1 か所でよい。
 */
const NOW = '2026-08-27T02:08:00.000Z'

async function startWork(page: Page, org = ORG): Promise<void> {
  await page.clock.setFixedTime(new Date(NOW))
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(org)
  await page.getByRole('button', { name: '業務を始める' }).click()
  await page.getByRole('navigation', { name: '画面の切り替え' }).waitFor()
}

/** 分析を開き、指定のタブへ移る（既定はトップ）。数字が届くまで待つ。 */
async function openAnalytics(page: Page, tab = 'トップ', org = ORG): Promise<void> {
  await startWork(page, org)
  await page
    .getByRole('navigation', { name: '画面の切り替え' })
    .getByRole('button', { name: '分析', exact: true })
    .click()
  if (tab !== 'トップ') await page.getByRole('tab', { name: tab, exact: true }).click()
  await expect(page.getByTestId('definition')).toBeVisible()
}

/** 「対象の期間」を選び直して「適用」を押す（押すまで数字は動かない）。 */
async function applyMonth(page: Page, label: string): Promise<void> {
  await page.getByLabel('対象の期間', { exact: true }).selectOption({ label })
  await page.getByRole('button', { name: '適用' }).click()
  await expect(page.getByTestId('definition')).toContainText(label)
}

// @e2e-covers UC-ANA-01 AC-ANA-01
test('分析トップは前後7日の入り具合を 1 つのグラフで出し、本日の棒だけを強調する', async ({
  page,
}) => {
  await openAnalytics(page)
  await expect(page.getByRole('heading', { name: '予約の入り具合' })).toBeVisible()
  await expect(page.getByTestId('top-caption')).toHaveText(
    '本日を中心に前後7日／件数・火曜は定休日です',
  )
  // グラフは 1 つだけ（この面に 2 つ目のグラフを置かない）。
  await expect(page.getByRole('img')).toHaveCount(1)
  // 前後 7 日ちょうどの 15 本。月で切ると 8/1〜8/31 の 31 本になってしまう。
  await expect(page.getByTestId('column')).toHaveCount(15)
  await expect(page.getByTestId('column-label').first()).toHaveText('8/20')
  await expect(page.getByTestId('column-label').last()).toHaveText('9/3')
  const today = page.locator('[data-testid="column"][data-today="true"]')
  await expect(today).toHaveCount(1)
  await expect(today.getByTestId('column-label')).toHaveText('8/27 本日')
})

// @e2e-covers AC-ANA-02
test('週の予約は 3 行とも件数だけで、「名」を 1 つも出さない', async ({ page }) => {
  await openAnalytics(page)
  const rows = page.getByTestId('week-row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('先週')
  await expect(rows.nth(2)).toContainText('来週')
  const thisWeek = page.locator('[data-testid="week-row"][data-week="今週"]')
  await expect(thisWeek.getByTestId('summary-value')).toHaveText('72')
  await expect(thisWeek).toContainText('件')
  // 「88名」のような人数はどこにも出さない（Q-11 が解けるまで数える経路が無い）。
  await expect(page.getByRole('tabpanel')).not.toContainText(/[0-9]名/)
})

// @e2e-covers UC-ANA-02 AC-ANA-03
test('対象の期間を変えただけでは数字が変わらず、「適用」を押してはじめて変わる', async ({
  page,
}) => {
  await openAnalytics(page)
  // 当月のトップは本日を中心に前後 7 日（8/20〜9/3）を描く。
  await expect(page.getByTestId('definition')).toContainText('2026年8月')
  await expect(page.getByTestId('column-label').first()).toHaveText('8/20')
  await page.getByLabel('対象の期間', { exact: true }).selectOption({ label: '2026年7月' })
  // 選び替えただけ。集計はやり直さない —— グラフも「週の予約」も 1 つも動かない。
  await expect(page.getByTestId('definition')).toContainText('2026年8月')
  await expect(page.getByTestId('column-label').first()).toHaveText('8/20')
  await expect(page.locator('[data-testid="week-row"][data-week="今週"]')).toContainText('72')

  await page.getByRole('button', { name: '適用' }).click()

  // 押してはじめて 7 月へ入れ替わる（暦の 31 日ぶんが並ぶ）。
  await expect(page.getByTestId('definition')).toContainText('2026年7月')
  await expect(page.getByTestId('top-caption')).toHaveText('2026年7月／件数・火曜は定休日です')
  await expect(page.getByTestId('column-label').first()).toHaveText('7/1')
  await expect(page.getByTestId('column-label')).toHaveCount(31)
})

// @e2e-covers AC-ANA-04
test('店舗を丸の内店に変えて適用すると、合計も担当の行も入れ替わる', async ({ page }) => {
  await openAnalytics(page, '担当者')
  await expect(page.getByTestId('staff-caption')).toContainText('合計 328件')
  await expect(page.getByText('佐藤 美咲')).toBeVisible()

  await page.getByLabel('店舗').selectOption({ label: '店舗：EYEX 丸の内店' })
  await page.getByRole('button', { name: '適用' }).click()

  await expect(page.getByTestId('staff-caption')).toContainText('合計 142件')
  await expect(page.getByText('井上 彩香')).toBeVisible()
  await expect(page.getByText('佐藤 美咲')).toHaveCount(0)
})

// @e2e-covers UC-ANA-03 AC-ANA-05
test('かぞえる日をご来店日から受付日に変えて適用すると、同じ月でも合計が変わる', async ({
  page,
}) => {
  await openAnalytics(page, '予約数')
  await expect(page.getByTestId('summary-合計').getByTestId('summary-value')).toHaveText('320')
  await page.getByRole('radio', { name: '受付日' }).click()
  await page.getByRole('button', { name: '適用' }).click()
  await expect(page.getByTestId('summary-合計').getByTestId('summary-value')).toHaveText('331')
  await expect(page.getByTestId('definition')).toContainText('受付日でかぞえます')
})

// @e2e-covers AC-ANA-06
test('集計の種類を時間帯別に変えて適用すると、横軸が日付から時間帯に変わる', async ({ page }) => {
  await openAnalytics(page, '予約数')
  await expect(page.getByTestId('column-label').first()).toHaveText('8/1')
  await page.getByRole('radio', { name: '時間帯別' }).click()
  await page.getByRole('button', { name: '適用' }).click()
  await expect(page.getByRole('heading', { name: '時間帯別の予約数' })).toBeVisible()
  await expect(page.getByTestId('column-label').first()).toHaveText('10時台')
  await expect(page.getByTestId('column-label').nth(1)).toHaveText('11時台')
})

// @e2e-covers AC-ANA-07
test('予約数のまとめは 合計・1日あたり・最も多い日 の 3 つだけになる', async ({ page }) => {
  await openAnalytics(page, '予約数')
  await expect(page.getByTestId('summary-label')).toHaveText([
    '8月の合計',
    '1日あたり',
    '最も多い日',
  ])
})

// @e2e-covers UC-ANA-04 AC-ANA-08
test('担当者の見出しと列見出しで、何をいつ基準に数えたかが画面だけで分かる', async ({ page }) => {
  await openAnalytics(page, '担当者')
  await expect(page.getByTestId('staff-caption')).toHaveText(
    '2026年8月／ご来店日でかぞえます　合計 328件',
  )
  await expect(page.getByTestId('staff-columns')).toContainText('90日以内の再来')
})

// @e2e-covers AC-ANA-09
test('担当が未定の行は並びの最後に出て、件数は数字・再来は「—」になる', async ({ page }) => {
  await openAnalytics(page, '担当者')
  await expect(page.getByTestId('staff-name').last()).toHaveText('担当が未定')
  await expect(page.getByTestId('staff-count').last()).toHaveText('36')
  await expect(page.getByTestId('staff-revisit').last()).toHaveText('—')
})

// @e2e-covers UC-ANA-05 AC-ANA-10
test('お待ち時間は中央値が大きく出て、前の月と母数が添う', async ({ page }) => {
  await openAnalytics(page, 'お待ち時間')
  await expect(page.getByText('受付からご相談開始まで（中央値）')).toBeVisible()
  await expect(page.getByTestId('wait-median')).toHaveText('8分40秒')
  await expect(page.getByTestId('wait-note')).toHaveText('前の月は 7分20秒／2026年8月・受付 328件')
})

// @e2e-covers AC-ANA-11
test('8分ちょうどでは目安の札が出ず、8分1秒では出る', async ({ page }) => {
  await openAnalytics(page, 'お待ち時間')
  const badge = page.getByText('目安 8分を超えています')

  await applyMonth(page, '2026年6月')
  await expect(page.getByTestId('wait-median')).toHaveText('8分0秒')
  await expect(badge).toHaveCount(0)

  await applyMonth(page, '2026年5月')
  await expect(page.getByTestId('wait-median')).toHaveText('8分1秒')
  await expect(badge).toBeVisible()
})

// @e2e-covers UC-ANA-06 AC-ANA-12
test('取り消しは 5 分類の積み上げで並び、棒の下に件数と率が添う', async ({ page }) => {
  await openAnalytics(page, '取り消し')
  await page.getByLabel('対象の期間（開始）').selectOption({ label: '2026年3月' })
  await page.getByLabel('対象の期間（終了）').selectOption({ label: '2026年8月' })
  await page.getByRole('button', { name: '適用' }).click()

  await expect(page.getByTestId('legend-name')).toHaveText([
    'お客様のご都合',
    '店舗の都合',
    '予約の重複',
    'ご来店がなかった',
    'Webからの取消',
  ])
  await expect(page.getByTestId('column-label')).toHaveCount(6)
  await expect(page.getByTestId('column-label').nth(4)).toHaveText('7月　37件・11.9%')
})

// @e2e-covers AC-ANA-13
test('6か月のまとめには目安が併記され、最も高い月に超過が添う', async ({ page }) => {
  await openAnalytics(page, '取り消し')
  await expect(page.getByRole('heading', { name: '6か月のまとめ' })).toBeVisible()
  await expect(page.getByTestId('summary-取消率')).toContainText('目安 10%以内')
  await expect(page.getByTestId('summary-最も高い月')).toContainText('11.9')
  await expect(page.getByTestId('summary-最も高い月')).toContainText('2026年7月・目安を超過')
})

// @e2e-covers UC-ANA-07 AC-ANA-14
test('標本が 20 件に満たない担当は率が「—」になり、件数はそのまま読める', async ({ page }) => {
  await openAnalytics(page, '担当者')
  const watanabe = page
    .getByRole('img', { name: /担当者ごとの件数/ })
    .locator('div')
    .filter({ hasText: '渡辺 由紀' })
    .first()
  await expect(watanabe.getByTestId('staff-count')).toHaveText('19')
  await expect(watanabe.getByTestId('staff-revisit')).toHaveText('—')
  const sato = page
    .getByRole('img', { name: /担当者ごとの件数/ })
    .locator('div')
    .filter({ hasText: '佐藤 美咲' })
    .first()
  await expect(sato.getByTestId('staff-count')).toHaveText('84')
  await expect(sato.getByTestId('staff-revisit')).toHaveText('65%')
})

// @e2e-covers UC-ANA-08 AC-ANA-15
test('定休日は 0 件の棒として描き、まだ集計できていない日は棒を描かず 1 行で知らせる', async ({
  page,
}) => {
  await openAnalytics(page)
  await applyMonth(page, '2026年2月')
  await expect(page.getByText('2日ぶんはまだ集計中です')).toBeVisible()

  const labels = page.getByTestId('column-label')
  // 2月の定休日（火曜 3・10・17・24 日）は 0 件の棒として並ぶ。
  await expect(labels.filter({ hasText: '2/3 定休' })).toHaveCount(1)
  const closed = page.locator('[data-testid="bar"][data-closed="true"]')
  await expect(closed).toHaveCount(4)
  // 集計できていない 2/27・2/28 は棒を持たない（0 件として描かない）。
  await expect(labels).toHaveCount(26)
  await expect(labels.filter({ hasText: '2/27' })).toHaveCount(0)
})

// @e2e-covers UC-ANA-09 AC-ANA-16
test('別の組織のスタッフには、他組織の担当も件数も 1 件も出ない', async ({ page }) => {
  await openAnalytics(page, '担当者', RIVAL_ORG)
  await expect(page.getByTestId('staff-caption')).toContainText('合計 9件')
  await expect(page.getByText('相馬 直樹')).toBeVisible()
  for (const name of ['佐藤 美咲', '高橋 健', '中村 彩', '小林 学', '渡辺 由紀', '山田 大輔']) {
    await expect(page.getByText(name)).toHaveCount(0)
  }
  await expect(page.getByRole('tabpanel')).not.toContainText('328')
})

// @e2e-covers AC-ANA-17
test('凡例は塗りのほかに地模様と系列名の文字を持ち、色を無効にしても見分けられる', async ({
  page,
}) => {
  await openAnalytics(page, 'お待ち時間')
  await expect(page.getByTestId('legend-name')).toHaveText(['目安の内', '目安を超えた時間帯'])
  await expect(page.getByTestId('legend-swatch').nth(0)).toHaveAttribute('data-pattern', 'solid')
  await expect(page.getByTestId('legend-swatch').nth(1)).toHaveAttribute('data-pattern', 'hatch')

  await page.getByRole('tab', { name: '取り消し', exact: true }).click()
  await expect(page.getByTestId('legend-name')).toHaveCount(5)
  const patterns = await page
    .getByTestId('legend-swatch')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-pattern')))
  expect(patterns).toEqual(['solid', 'hatch', 'dot', 'hatch', 'dot'])
})

// @e2e-covers AC-ANA-18
test('切り口はキーボードだけで、群の名前とともに選び替えられる', async ({ page }) => {
  await openAnalytics(page, '予約数')
  await expect(page.getByRole('radiogroup', { name: '集計の種類' })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'かぞえる日' })).toBeVisible()

  await page.getByRole('radio', { name: '日別', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: '月別', exact: true })).toBeChecked()
  await page.getByRole('radio', { name: '月別', exact: true }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('radio', { name: '日別', exact: true })).toBeChecked()

  await page.getByRole('radio', { name: 'ご来店日' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: '受付日' })).toBeChecked()
})

// @e2e-covers AC-ANA-19
test('グラフの読み上げで、最も多い日・定休日の 0 件・まだ集計できていない日が分かる', async ({
  page,
}) => {
  await openAnalytics(page)
  await expect(page.getByRole('img')).toHaveAttribute('aria-label', /最も多いのは8\/27の14件/)
  await applyMonth(page, '2026年2月')
  const label = await page.getByRole('img').getAttribute('aria-label')
  expect(label).toContain('は定休日で0件')
  expect(label).toContain('2日ぶんはまだ集計中')
})

// @e2e-covers UC-ANA-10 AC-ANA-20
test('予約の入口・来店回数・ご来店の目的も、同じ型の 1 枚として読める', async ({ page }) => {
  await openAnalytics(page)
  for (const [tab, heading] of [
    ['予約の入口', '予約の入口'],
    ['来店回数', '来店回数'],
    ['ご来店の目的', 'ご来店の目的'],
  ]) {
    await page.getByRole('tab', { name: tab, exact: true }).click()
    await expect(
      page.getByRole('tabpanel').getByRole('heading', { name: heading, exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('img')).toHaveCount(1)
    await expect(page.getByTestId('definition')).toContainText('2026年8月')
    await expect(page.getByTestId('definition')).toContainText('でかぞえます')
  }
})

// @e2e-covers AC-ANA-21
test('「1日あたり」の分母は暦日数ではなく営業日数である', async ({ page }) => {
  await openAnalytics(page, '予約数')
  await expect(page.getByTestId('summary-合計').getByTestId('summary-value')).toHaveText('320')
  // 2026年8月は暦 31 日 − 火曜 4 日 ＝ 営業日 27 日。320 ÷ 27 ＝ 11.9（暦日 31 なら 10.3）。
  await expect(page.getByTestId('definition')).toContainText('営業日数27日')
  await expect(page.getByTestId('summary-1日あたり').getByTestId('summary-value')).toHaveText(
    '11.9',
  )
})
