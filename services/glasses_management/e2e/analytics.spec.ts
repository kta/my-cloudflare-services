import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { completeSeededTerminalStart } from './support/terminal'

/**
 * 012-analytics の受入れ。analytics_daily は seed.mjs の固定データを読む想定で、
 * テストごとに analytics.read membership を internal sync で決定的に配る。
 */
const ORG = 'eyex'
const GINZA = '11111111-1111-4111-8111-111111111111'
const MARUNOUCHI = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = 'org-analytics-other-seed'
const OTHER_STORE = '44444444-4444-4444-8444-444444444444'
const INTERNAL_KEY = 'dev-internal-key'
const NOW = '2026-08-27T02:08:00.000Z'

async function grantAnalytics(request: APIRequestContext): Promise<void> {
  for (const [id, storeId] of [
    ['0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f', GINZA],
    ['0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f10', MARUNOUCHI],
  ]) {
    const response = await request.post('/api/internal/store-memberships/sync', {
      headers: { 'x-internal-key': INTERNAL_KEY },
      data: {
        id,
        organizationId: ORG,
        storeId,
        userId: `dev:${ORG}`,
        permissions: ['analytics.read'],
        createdAt: NOW,
      },
    })
    expect(response.status()).toBe(200)
  }
}

async function openAnalytics(page: Page, request: APIRequestContext): Promise<void> {
  await grantAnalytics(request)
  await page.clock.setFixedTime(new Date(NOW))
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(ORG)
  const storesResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/staff/stores') && response.request().method() === 'GET',
  )
  await page.getByRole('button', { name: '業務を始める' }).click()
  await completeSeededTerminalStart(page)
  expect((await storesResponse).status()).toBe(200)
  // お店の切り替えは上のバーの店名が持つ（トップのチップは外した。foundation-09）。
  await expect(page.getByRole('button', { name: /お店を切り替える$/ })).toBeVisible()
  const reportRequest = page.waitForRequest(
    (request) => request.url().includes('/api/staff/analytics') && request.method() === 'GET',
  )
  await page.getByRole('button', { name: '分析' }).click()
  const reportResponse = await (await reportRequest).response()
  expect(reportResponse?.status()).toBe(200)
}

async function openOtherOrganizationAnalytics(
  page: Page,
  request: APIRequestContext,
): Promise<void> {
  const membership = await request.post('/api/internal/store-memberships/sync', {
    headers: { 'x-internal-key': INTERNAL_KEY },
    data: {
      id: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f21',
      organizationId: OTHER_ORG,
      storeId: OTHER_STORE,
      userId: `dev:${OTHER_ORG}`,
      permissions: ['analytics.read'],
      createdAt: NOW,
    },
  })
  expect(membership.status()).toBe(200)
  await page.clock.setFixedTime(new Date(NOW))
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(OTHER_ORG)
  const storesResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/staff/stores') && response.request().method() === 'GET',
  )
  await page.getByRole('button', { name: '業務を始める' }).click()
  await completeSeededTerminalStart(page)
  expect((await storesResponse).status()).toBe(200)
  await expect(page.locator('header').first()).toContainText('別組織店')
  const reportRequest = page.waitForRequest(
    (request) => request.url().includes('/api/staff/analytics') && request.method() === 'GET',
  )
  await page.getByRole('button', { name: '分析' }).click()
  const reportResponse = await (await reportRequest).response()
  expect(reportResponse?.status()).toBe(200)
}

// @e2e-covers UC-ANA-01 AC-ANA-01
test('トップは前後7日と本日の強調をグラフ1つで示す', async ({ page, request }) => {
  await openAnalytics(page, request)
  await expect(page.getByRole('heading', { name: '予約の入り具合' })).toBeVisible()
  await expect(page.getByText('本日を中心に前後7日／件数・火曜は定休日です')).toBeVisible()
  await expect(page.getByText('8/27 本日')).toBeVisible()
  await expect(page.getByRole('tabpanel').getByRole('img')).toHaveCount(1)
})

// @e2e-covers AC-ANA-02
test('トップは週の予約を件数だけで示し guests を出さない', async ({ page, request }) => {
  await openAnalytics(page, request)
  const weekly = page.getByRole('group', { name: '週の予約' })
  await expect(weekly.locator('dt')).toHaveText(['先週', '今週', '来週'])
  await expect(weekly.locator('dd')).toHaveText([
    '8月17日〜8月23日',
    '68件',
    '8月24日〜8月30日',
    '72件',
    '8月31日〜9月6日',
    '42件',
  ])
  await expect(page.getByText(/名/)).toHaveCount(0)
})

// @e2e-covers UC-ANA-02 AC-ANA-03
test('期間は適用を押すまで表示済み集計を変えない', async ({ page, request }) => {
  await openAnalytics(page, request)
  const weekly = page.getByRole('group', { name: '週の予約' })
  const chart = page.getByRole('tabpanel').getByRole('img')
  const beforeValues = await weekly.locator('dd').allTextContents()
  const beforeChart = await chart.getAttribute('aria-label')
  expect(beforeValues).toEqual([
    '8月17日〜8月23日',
    '68件',
    '8月24日〜8月30日',
    '72件',
    '8月31日〜9月6日',
    '42件',
  ])
  await page.getByLabel('対象の期間').selectOption('2026-07')
  await expect(weekly.locator('dd')).toHaveText(beforeValues)
  await expect(chart).toHaveAttribute('aria-label', beforeChart ?? '')
  await page.getByRole('button', { name: '適用' }).click()
  await expect(weekly.locator('dd')).toHaveText([
    '7月20日〜7月26日',
    '0件',
    '7月27日〜8月2日',
    '26件',
    '8月3日〜8月9日',
    '56件',
  ])
  await expect.poll(() => chart.getAttribute('aria-label')).not.toBe(beforeChart)
})

// @e2e-covers AC-ANA-04
test('店舗を替えて適用すると担当者と合計が店舗ごとの値になる', async ({ page, request }) => {
  await openAnalytics(page, request)
  await page.getByRole('tab', { name: '担当者' }).click()
  const store = page.getByLabel('店舗')
  await expect(store.getByRole('option', { name: '丸の内店' })).toBeEnabled()
  const before = await page.getByRole('main').textContent()
  await store.selectOption(MARUNOUCHI)
  await page.getByRole('button', { name: '適用' }).click()
  await expect(store).toHaveValue(MARUNOUCHI)
  await expect.poll(() => page.getByRole('main').textContent()).not.toBe(before)
  await expect(page.getByText(/合計 111件/)).toBeVisible()
  await expect(page.getByRole('row', { name: /丸の内 担当.*111 件/ })).toBeVisible()
  await expect(page.getByText('銀座店だけの担当')).toHaveCount(0)
})

// @e2e-covers UC-ANA-03 AC-ANA-05
test('予約数は受付日への切替後だけ合計を切り替える', async ({ page, request }) => {
  await openAnalytics(page, request)
  await page.getByRole('tab', { name: '予約数' }).click()
  const total = page.getByRole('list', { name: '予約数のまとめ' }).getByRole('listitem').first()
  const before = await total.textContent()
  await page.getByText('受付日', { exact: true }).click()
  await page.getByRole('button', { name: '適用' }).click()
  await expect(page.getByRole('radio', { name: '受付日' })).toBeChecked()
  await expect.poll(() => total.textContent()).not.toBe(before)
})

// @e2e-covers AC-ANA-06
test('予約数は時間帯別で時間帯の横軸へ替わる', async ({ page, request }) => {
  await openAnalytics(page, request)
  await page.getByRole('tab', { name: '予約数' }).click()
  await page.getByText('時間帯別', { exact: true }).click()
  await page.getByRole('button', { name: '適用' }).click()
  await expect(page.getByText('10時台')).toBeVisible()
})

// @e2e-covers AC-ANA-07
test('予約数のまとめは3項目だけである', async ({ page, request }) => {
  await openAnalytics(page, request)
  await page.getByRole('tab', { name: '予約数' }).click()
  await expect(page.getByText('8月の合計')).toBeVisible()
  await expect(page.getByText('1日あたり')).toBeVisible()
  await expect(page.getByText('最も多い日')).toBeVisible()
  await expect(
    page.getByRole('list', { name: '予約数のまとめ' }).getByRole('listitem'),
  ).toHaveCount(3)
})

// @e2e-covers UC-ANA-04 AC-ANA-08
test('担当者は数える基準と90日以内の再来を同じ並びで読む', async ({ page, request }) => {
  await openAnalytics(page, request)
  await page.getByRole('tab', { name: '担当者' }).click()
  await expect(page.getByText('90日以内の再来')).toBeVisible()
  await expect(page.getByText(/2026年8月／ご来店日でかぞえます/)).toBeVisible()
})

// @e2e-covers AC-ANA-09
test('担当未定は最後の行で件数だけを出す', async ({ page, request }) => {
  await openAnalytics(page, request)
  await page.getByRole('tab', { name: '担当者' }).click()
  const rows = page.getByRole('table', { name: '担当者の集計' }).getByRole('row')
  const unassigned = rows.filter({ hasText: '担当が未定' })
  await expect(unassigned).toHaveCount(1)
  await expect(unassigned).toContainText(/\d+\s*件/)
  await expect(unassigned).toContainText('—')
  await expect(rows.last()).toContainText('担当が未定')
})

// @e2e-covers UC-ANA-05 AC-ANA-10
test('待ち時間は中央値と前月と母数を出す', async ({ page, request }) => {
  await openAnalytics(page, request)
  await page.getByRole('tab', { name: 'お待ち時間' }).click()
  await expect(page.getByText('受付からご相談開始まで（中央値）')).toBeVisible()
  await expect(page.getByText(/前の月は/)).toBeVisible()
})

// @e2e-covers AC-ANA-11
test('待ち時間は8分を超過にせず8分1秒を超過にする', async ({ page, request }) => {
  await openAnalytics(page, request)
  await page.getByRole('tab', { name: 'お待ち時間' }).click()
  await page.getByLabel('対象の期間').selectOption('2026-07')
  await page.getByRole('button', { name: '適用' }).click()
  await expect(page.getByText('8分', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('目安 8分を超えています')).toHaveCount(0)
  await page.getByLabel('対象の期間').selectOption('2026-08')
  await page.getByRole('button', { name: '適用' }).click()
  await expect(page.getByText('8分1秒')).toBeVisible()
  await expect(page.getByText('目安 8分を超えています')).toHaveCount(1)
})

// @e2e-covers UC-ANA-06 AC-ANA-12
test('取り消しは月別5分類と率を積み上げで示す', async ({ page, request }) => {
  await openAnalytics(page, request)
  await page.getByRole('tab', { name: '取り消し' }).click()
  await page.getByLabel('開始月').selectOption('2026-03')
  await page.getByLabel('終了月').selectOption('2026-08')
  await page.getByRole('button', { name: '適用' }).click()
  const chart = page.getByRole('img', { name: /月ごとの取り消し/ })
  for (const month of ['3月', '4月', '5月', '6月', '7月', '8月']) {
    await expect(chart).toContainText(new RegExp(`${month}\\s+\\d+件`))
  }
  for (const label of [
    'お客様のご都合',
    '店舗の都合',
    '予約の重複',
    'ご来店がなかった',
    'Webからの取消',
  ]) {
    await expect(
      page.getByRole('list', { name: 'グラフの系列' }).getByText(label, { exact: true }),
    ).toBeVisible()
  }
  await expect(page.getByText('7月　37件・11.9%')).toBeVisible()
})

// @e2e-covers AC-ANA-13
test('取り消しのまとめは取消率と目安超過を併記する', async ({ page, request }) => {
  await openAnalytics(page, request)
  await page.getByRole('tab', { name: '取り消し' }).click()
  await expect(page.getByText('取消率')).toBeVisible()
  await expect(page.getByText('目安 10%以内', { exact: true }).first()).toBeVisible()
  await expect(
    page
      .getByRole('list', { name: '取り消しのまとめ' })
      .getByRole('listitem')
      .filter({ hasText: '最も高い月' }),
  ).toContainText(/11\.9.*2026年7月.*目安を超過/)
})

// @e2e-covers UC-ANA-07 AC-ANA-14
test('小標本の再来率は伏せて件数を残す', async ({ page, request }) => {
  await openAnalytics(page, request)
  await page.getByRole('tab', { name: '担当者' }).click()
  const small = page.getByRole('row', { name: /渡辺 由紀/ })
  await expect(small).toContainText(/\d+\s*件/)
  await expect(small).toContainText('—')
})

// @e2e-covers UC-ANA-08 AC-ANA-15
test('定休の0件と集計中の欠測を分ける', async ({ page, request }) => {
  await openAnalytics(page, request)
  // 軸の札は 1 つの文字列。UI-08 で値ラベルを捨てて「定休」を軸へ添えた形に合わせる。
  await expect(page.getByText('8/25 定休', { exact: true })).toBeVisible()
  await expect(page.getByText('9/2 定休', { exact: true })).toHaveCount(0)
  await expect(page.getByText('2日ぶんはまだ集計中です')).toBeVisible()
})

// @e2e-covers UC-ANA-09 AC-ANA-16
test('別組織の分析値と担当者は出さない', async ({ page, request }) => {
  await openOtherOrganizationAnalytics(page, request)
  await page.getByRole('tab', { name: '担当者' }).click()
  await expect(page.getByText('別組織の担当')).toBeVisible()
  await expect(page.getByText('999件')).toBeVisible()
  await expect(page.getByText('銀座店だけの担当')).toHaveCount(0)
})

// @e2e-covers AC-ANA-17
test('待ち時間と取り消しの凡例は地模様と文字で識別できる', async ({ page, request }) => {
  await openAnalytics(page, request)
  await page.getByRole('tab', { name: 'お待ち時間' }).click()
  await expect(page.getByText('目安の内')).toBeVisible()
  await expect(page.getByText('目安を超えた時間帯')).toBeVisible()
  expect(
    await page
      .locator('[data-pattern]')
      .evaluateAll((nodes) => new Set(nodes.map((node) => node.getAttribute('data-pattern'))).size),
  ).toBeGreaterThanOrEqual(2)
  await page.getByRole('tab', { name: '取り消し' }).click()
  for (const name of [
    'お客様のご都合',
    '店舗の都合',
    '予約の重複',
    'ご来店がなかった',
    'Webからの取消',
  ]) {
    await expect(
      page.getByRole('list', { name: 'グラフの系列' }).getByText(name, { exact: true }),
    ).toBeVisible()
  }
  expect(
    await page
      .locator('[data-pattern]')
      .evaluateAll((nodes) => new Set(nodes.map((node) => node.getAttribute('data-pattern'))).size),
  ).toBeGreaterThanOrEqual(3)
})

// @e2e-covers AC-ANA-18
test('予約数の二つの切替はキーボードで読めて選べる', async ({ page, request }) => {
  await openAnalytics(page, request)
  // 端末の業務開始は iPad 専用。分析面を開いてから、ここで確認したい狭幅へ切り替える。
  await page.setViewportSize({ width: 375, height: 812 })
  const tabs = [
    'トップ',
    '予約数',
    '予約の入口',
    '取り消し',
    '来店回数',
    '担当者',
    'ご来店の目的',
    'お待ち時間',
  ]
  const tablist = page.getByRole('tablist', { name: '分析の内訳を選ぶ' })
  expect(
    await page.evaluate(
      'document.documentElement.scrollWidth <= document.documentElement.clientWidth',
    ),
  ).toBe(true)
  expect(await tablist.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)

  // 8 タブは横にはみ出すが、どのタブも実際に開ける。各タブのグラフまで待つことで
  // 見出しだけが切り替わった読み込み中を成功扱いにしない。
  for (const tab of tabs) {
    await page.getByRole('tab', { name: tab, exact: true }).click()
    await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const completed =
      tab === '担当者'
        ? page.getByRole('tabpanel').getByRole('table', { name: '担当者の集計' })
        : page.getByRole('tabpanel').getByRole('img')
    await expect(completed).toHaveCount(1)
  }

  for (const [tab, testId] of [
    ['お待ち時間', 'wait-chart-scroll'],
    ['取り消し', 'cancel-chart-scroll'],
    ['ご来店の目的', undefined],
  ] as const) {
    await page.getByRole('tab', { name: tab, exact: true }).click()
    const viewport =
      testId === undefined
        ? page.getByRole('tabpanel').getByRole('img').locator('..')
        : page.getByTestId(testId)
    const scrollable = await viewport.evaluate((node) => ({
      overflowX: node.ownerDocument.defaultView?.getComputedStyle(node).overflowX,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }))
    expect(scrollable.overflowX).toBe('auto')
    expect(scrollable.scrollWidth).toBeGreaterThan(scrollable.clientWidth)
  }

  await page.getByRole('tab', { name: 'トップ' }).click()
  const chartViewport = await page
    .getByRole('tabpanel')
    .getByRole('img')
    .evaluate((node) => {
      const container = node.parentElement
      return {
        overflowX: container
          ? (node.ownerDocument.defaultView?.getComputedStyle(container).overflowX ?? '')
          : '',
        scrollWidth: container?.scrollWidth ?? 0,
        clientWidth: container?.clientWidth ?? 0,
      }
    })
  expect(chartViewport.overflowX).toBe('auto')
  expect(chartViewport.scrollWidth).toBeGreaterThan(chartViewport.clientWidth)

  await page.evaluate("document.documentElement.style.fontSize = '200%'")
  await page.getByRole('tab', { name: '予約数' }).click()
  const granularity = page.getByRole('radiogroup', { name: '集計の種類' })
  const countBy = page.getByRole('radiogroup', { name: 'かぞえる日' })
  await expect(granularity.getByRole('radio', { name: '日別', exact: true })).toBeChecked()
  await granularity.getByRole('radio', { name: '日別', exact: true }).focus()
  await granularity.getByRole('radio', { name: '日別', exact: true }).press('ArrowRight')
  await expect(granularity.getByRole('radio', { name: '月別', exact: true })).toBeChecked()
  await expect(countBy.getByRole('radio', { name: 'ご来店日', exact: true })).toBeChecked()
  await countBy.getByRole('radio', { name: 'ご来店日', exact: true }).focus()
  await countBy.getByRole('radio', { name: 'ご来店日', exact: true }).press('ArrowRight')
  await expect(countBy.getByRole('radio', { name: '受付日', exact: true })).toBeChecked()

  const toolbarItems = [
    page.getByRole('heading', { name: '予約数', level: 2 }),
    page.getByLabel('対象の期間'),
    page.getByRole('button', { name: '適用' }),
    page.getByLabel('店舗'),
  ]
  const boxes = await Promise.all(toolbarItems.map((item) => item.boundingBox()))
  for (const [index, box] of boxes.entries()) {
    expect(box, `toolbar item ${index} must have a box`).not.toBeNull()
    for (const other of boxes.slice(index + 1)) {
      expect(other, 'toolbar item must have a box').not.toBeNull()
      if (box === null || other === null) continue
      const overlap =
        Math.max(box.x, other.x) < Math.min(box.x + box.width, other.x + other.width) &&
        Math.max(box.y, other.y) < Math.min(box.y + box.height, other.y + other.height)
      expect(overlap).toBe(false)
    }
  }
  await page.getByLabel('対象の期間').selectOption('2026-07')
  await expect(page.getByLabel('対象の期間')).toHaveValue('2026-07')
  await page.getByLabel('店舗').selectOption(MARUNOUCHI)
  await expect(page.getByLabel('店舗')).toHaveValue(MARUNOUCHI)
  await page.getByRole('button', { name: '適用' }).click()
  await expect(page.getByRole('tabpanel').getByRole('img')).toHaveCount(1)
  await page.getByLabel('店舗').selectOption(GINZA)
  await page.getByLabel('対象の期間').selectOption('2026-08')
  await page.getByRole('button', { name: '適用' }).click()
  await expect(page.getByRole('tabpanel').getByRole('img')).toHaveCount(1)

  await page.getByRole('tab', { name: '担当者' }).click()
  const tableViewport = await page.getByRole('table', { name: '担当者の集計' }).evaluate((node) => {
    const container = node.parentElement
    const bounds = container?.getBoundingClientRect()
    return {
      overflowX:
        container === null
          ? ''
          : (node.ownerDocument.defaultView?.getComputedStyle(container).overflowX ?? ''),
      left: bounds?.left ?? -1,
      right: bounds?.right ?? Number.POSITIVE_INFINITY,
      viewportWidth: node.ownerDocument.documentElement.clientWidth,
    }
  })
  expect(tableViewport.overflowX).toBe('auto')
  expect(tableViewport.left).toBeGreaterThanOrEqual(0)
  expect(tableViewport.right).toBeLessThanOrEqual(tableViewport.viewportWidth)
})

// @e2e-covers AC-ANA-19
test('トップのグラフ代替文は最大日と定休と欠測を読む', async ({ page, request }) => {
  await openAnalytics(page, request)
  await expect(
    page.getByRole('img', { name: /最も多い日.*72件.*定休.*0件.*2日ぶんはまだ集計中/ }),
  ).toBeVisible()
})

// @e2e-covers UC-ANA-10 AC-ANA-20
test('入口・来店回数・目的の3タブはすべて同じ1枚の型で開く', async ({ page, request }) => {
  await openAnalytics(page, request)
  for (const [tab, definition] of [
    ['予約の入口', /ご来店日.*320件/],
    ['来店回数', /ご来店日.*328件/],
    ['ご来店の目的', /ご来店日.*320件/],
  ] as const) {
    await page.getByRole('tab', { name: tab }).click()
    const main = page.getByRole('main')
    await expect(main.getByRole('img')).toHaveCount(1)
    await expect(main.getByText(definition)).toHaveCount(1)
    await expect(
      main.getByRole('list', { name: `${tab}のまとめ` }).getByRole('listitem'),
    ).toHaveCount(3)
  }
})

// @e2e-covers AC-ANA-21
test('8月320件の1日あたりは営業27日で11.9件になる', async ({ page, request }) => {
  await openAnalytics(page, request)
  await page.getByRole('tab', { name: '予約数' }).click()
  const perDay = page
    .getByRole('list', { name: '予約数のまとめ' })
    .getByRole('listitem')
    .filter({ hasText: '1日あたり' })
  await expect(page.getByRole('list', { name: '予約数のまとめ' })).toContainText(
    /8月の合計.*320\s*件/,
  )
  await expect(page.getByRole('main')).toContainText(/火曜.*4日.*27日/)
  await expect(perDay).toHaveText(/1日あたり.*11\.9\s*件/)
})
