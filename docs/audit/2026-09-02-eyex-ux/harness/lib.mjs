import pw from '/Users/spmini/Documents/workspace/myspace/my-cloudflare-services/node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/index.js'

const { chromium } = pw

export const SHOTS =
  '/private/tmp/claude-501/-Users-spmini-Documents-workspace-myspace-my-cloudflare-services/b82f5abe-c433-4875-b8e7-02d07ff95280/scratchpad/shots'

export const NOW = new Date('2026-08-27T02:08:00.000Z') // JST 11:08
export const ORG = 'eyex'
const GINZA = '11111111-1111-4111-8111-111111111111'
const MEMBERSHIP_ID = '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d'
const PERMISSIONS = [
  'store.read',
  'store.manage',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.write',
  'recording.read',
  'recording.manage',
  'settings.read',
  'settings.manage',
  'terminal.manage',
  'audit.read',
  'analytics.read',
  'customer.history',
  'attention.read',
  'attention.write',
  'attention.publish',
  'attention.revise',
  'attention.hide',
]

export async function launch(
  port = 4300,
  { viewport = { width: 1194, height: 834 }, permissions = [] } = {},
) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport,
    baseURL: `http://localhost:${port}`,
    permissions,
  })
  const page = await ctx.newPage()
  const logs = []
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
  page.on('requestfailed', (r) =>
    logs.push(`[reqfail] ${r.method()} ${r.url()} ${r.failure()?.errorText}`),
  )
  page.on('response', (r) => {
    if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}`)
  })
  return { browser, ctx, page, logs }
}

/** admin から届くはずの店舗メンバーシップを流し込む（e2e と同じ前提） */
export async function syncMembership(ctx, port = 4300) {
  const res = await ctx.request.post(
    `http://localhost:${port}/api/internal/store-memberships/sync`,
    {
      headers: { 'x-internal-key': 'dev-internal-key' },
      data: {
        id: MEMBERSHIP_ID,
        organizationId: ORG,
        storeId: GINZA,
        userId: `dev:${ORG}`,
        permissions: PERMISSIONS,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    },
  )
  return res.status()
}

/** お店のコード → 端末モード → 置き場所 → 共有PIN 000000 を通して業務画面へ入る */
export async function start(page, mode = 'shared') {
  await page.clock.install({ time: NOW })
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(ORG)
  await page.getByRole('button', { name: '業務を始める' }).click()
  const nav = page.getByRole('navigation', { name: '画面の切り替え' })
  const deviceMode = page.getByRole('heading', { name: 'この iPad の使い方を決めてください' })
  const placePick = page.getByRole('heading', { name: 'この端末はどこに置きますか？' })
  const staffPick = page.getByRole('heading', { name: '業務を始めるスタッフを選んでください' })
  await nav.or(deviceMode).or(placePick).or(staffPick).waitFor({ timeout: 20000 })
  if (await nav.isVisible()) return
  if (await deviceMode.isVisible()) {
    await page
      .getByRole('button', {
        name: mode === 'shared' ? 'みんなで使う端末にする' : '個人の端末にする',
      })
      .click()
  }
  if (mode === 'shared') {
    await page.getByRole('button', { name: /銀座店 レジ横iPad/ }).click()
    await page.getByRole('button', { name: 'この置き場所で始める' }).click()
  } else {
    await page.getByRole('button', { name: /佐藤 美咲/ }).click()
  }
  for (const d of ['0', '0', '0', '0', '0', '0'])
    await page.getByRole('button', { name: d, exact: true }).click()
  await page.getByRole('button', { name: /^確定/ }).click()
  await nav.waitFor({ timeout: 20000 })
}

/** 左ナビから画面を開く */
export async function go(page, name) {
  await page
    .getByRole('navigation', { name: '画面の切り替え' })
    .getByRole('button', { name })
    .click()
  await page.waitForTimeout(1200)
}

export async function shot(page, name) {
  const path = `${SHOTS}/${name}.png`
  await page.screenshot({ path })
  return path
}

export async function text(page) {
  return await page.locator('body').innerText()
}
