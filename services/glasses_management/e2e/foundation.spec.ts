import { expect, test } from '@playwright/test'
import { enterSharedWorkspace } from './terminal-start'

/**
 * 土台の受け入れ基準（AC-FOUND-01..05）を、実際のブラウザと実 Worker で確かめる。
 * `vite preview` が実 workerd を動かすので、/api も本物である。
 */

/** 店舗が 1 つも届いていない組織（AC-FOUND-03 の盤面）。 */
const EMPTY_ORG = 'e2e-foundation'
/*
 * 業務画面まで入る 3 本は seed の組織で始める。P10 から業務開始のあとに端末の面が
 * 挟まり、置き場所を 1 台も持たない組織では業務画面へ入れないためである
 * （店舗が届いていないこと自体は AC-FOUND-03 が引き続き `EMPTY_ORG` で見る）。
 */
const ORG = 'org-eyex-seed'

async function startWork(page: import('@playwright/test').Page, org = ORG) {
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(org)
  await page.getByRole('button', { name: '業務を始める' }).click()
  if (org === ORG) await enterSharedWorkspace(page)
}

// @e2e-covers AC-FOUND-01
test('お店のコードを入れて業務を始めると、上のバーに店名と営業状態が出る', async ({ page }) => {
  await startWork(page)
  const bar = page.locator('header').first()
  await expect(bar).toContainText('EYEX')
  await expect(bar).toContainText('営業中')
  await expect(page.getByRole('button', { name: 'トップへ' })).toBeVisible()
})

// @e2e-covers AC-FOUND-02
test('サイドバーはつまみで細い柱にたため、もう一度押すと元に戻る', async ({ page }) => {
  await startWork(page)
  const nav = page.getByRole('navigation', { name: '画面の切り替え' })
  const ledger = nav.getByRole('button', { name: '予約台帳' })
  await expect(ledger).toBeVisible()
  const wide = await nav.boundingBox()

  await page.getByRole('button', { name: 'サイドバーをたたむ' }).click()
  await expect(page.getByRole('button', { name: 'サイドバーをひらく' })).toBeVisible()
  const rail = await nav.boundingBox()
  expect(rail?.width).toBeLessThan(wide?.width ?? 0)
  // 文字は見えなくなるが、名前は残る（アイコンだけのボタンに名前が無いのは欠陥）
  await expect(ledger).toBeVisible()
  await expect(nav.getByText('予約台帳', { exact: true })).not.toBeInViewport()

  await page.getByRole('button', { name: 'サイドバーをひらく' }).click()
  await expect(nav.getByText('予約台帳', { exact: true })).toBeInViewport()
})

// @e2e-covers AC-FOUND-03
test('店舗がまだ届いていないときは、その事実だけを出す', async ({ page }) => {
  await startWork(page, EMPTY_ORG)
  await expect(page.getByText('お店がまだ登録されていません。')).toBeVisible()
})

// @e2e-covers AC-FOUND-04
test('業務を終えると業務開始の画面へ戻る', async ({ page }) => {
  await startWork(page)
  await page.getByRole('button', { name: '業務を終える' }).click()
  await expect(page.getByLabel('お店のコード')).toBeVisible()
  await expect(page.getByRole('button', { name: '業務を始める' })).toBeVisible()
})

// @e2e-covers AC-FOUND-05
test('ヘルスチェックは認証なしで ok を返す', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ status: 'ok' })
})
