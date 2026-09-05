import { expect, test } from '@playwright/test'
import { completeSeededTerminalStart } from './support/terminal'

/**
 * 土台の受け入れ基準（AC-FOUND-01..05）を、実際のブラウザと実 Worker で確かめる。
 * `vite preview` が実 workerd を動かすので、/api も本物である。
 */

const ORG = 'eye'

/** お店のコードから、共有端末で業務画面まで入る。 */
async function startWork(
  page: import('@playwright/test').Page,
  mode: 'shared' | 'personal' = 'shared',
) {
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(ORG)
  await page.getByRole('button', { name: '業務を始める' }).click()
  await completeSeededTerminalStart(page, mode)
}

// @e2e-covers AC-FOUND-01
test('お店のコードを入れて業務を始めると、上のバーに店名と営業状態が出る', async ({ page }) => {
  await startWork(page)
  const bar = page.locator('header').first()
  await expect(bar).toContainText('EYE 銀座店')
  // 営業状態は保存された営業時間から出す（AC-FOUND-09）。
  await expect(bar).toContainText(/営業中|営業時間外|本日は定休日/)
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

/*
 * 店舗が 1 つも無いコードでも器に入れてしまい、上のバーが実在しない屋号と固定の
 * 営業時間を出していた（UX 監査 SHELL-03）。かといって入口で止めると、まだ 1 店舗も
 * 登録していない新しい会社が永久に入れない（014-store-provisioning）。
 * 通したうえで、最初のお店を登録する面を立てる。
 */
// @e2e-covers AC-FOUND-03
test('店舗が見つからないコードでは、器へ入れず登録の面を立てる', async ({ page }) => {
  const code = 'e2e-foundation-unknown'
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(code)
  await page.getByRole('button', { name: '業務を始める' }).click()

  await expect(
    page.getByRole('heading', { name: '最初のお店を登録します', level: 1 }),
  ).toBeVisible()
  // 実在しない屋号も、営業状態も、行き先の柱も出さない。
  await expect(page.getByRole('navigation', { name: '画面の切り替え' })).toHaveCount(0)
  await expect(page.getByText('EYE 銀座店')).toBeHidden()
  await expect(page.getByText(/営業中/)).toBeHidden()
  // どの会社に入ったかは名乗る（打ち間違いに気づける）。
  await expect(page.getByRole('banner')).toContainText(code)
})

// @e2e-covers AC-FOUND-04
test('業務を終えると業務開始の画面へ戻る', async ({ page }) => {
  // 「業務を終える」を上のバーに持つのは個人端末（AC-FOUND-04）。
  await startWork(page, 'personal')
  await page.getByRole('button', { name: '業務を終える' }).click()
  // 端末の設定はそのまま残り、業務開始の画面（スタッフ選び）へ戻る。
  await expect(
    page.getByRole('heading', { name: '業務を始めるスタッフを選んでください' }),
  ).toBeVisible()
  await expect(page.locator('header').first()).toContainText('業務を始める')
  // 業務画面の器は畳まれている。
  await expect(page.getByRole('navigation', { name: '画面の切り替え' })).toHaveCount(0)
})

// @e2e-covers AC-FOUND-05
test('ヘルスチェックは認証なしで ok を返す', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ status: 'ok' })
})
