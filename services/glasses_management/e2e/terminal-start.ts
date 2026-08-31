import { expect, type Page } from '@playwright/test'

/*
 * 業務開始 6 面（P10 `013-terminals-and-audit`）を通り抜ける道具。
 *
 * P10 より前の e2e は「お店のコード → 業務画面」の 2 手で着いていたが、いまはその間に
 * 「この iPad の使い方を決める」→「置き場所を選ぶ」→「店舗の暗証番号」の 3 面がある。
 * どの spec も同じ手で通り抜けるので、ここに 1 か所だけ置く。
 *
 * **平文の暗証番号を画面から読み取らない。**打つのはテンキーのキーで、値は seed が
 * 入れたハッシュと突き合わされる（`seed.mjs` の `SHARED_PIN` / `STAFF_PIN`）。
 */

/** seed が銀座店の 3 台に入れている店舗共通の暗証番号。 */
const SHARED_PIN = '2580'

/** seed の置き場所 3 台のうち、既定で使う 1 台。 */
export const CHECKOUT_IPAD = '銀座店 レジ横iPad'

/** テンキーで 1 桁ずつ打ち、「確定」を押す。 */
export async function enterPin(page: Page, pin: string): Promise<void> {
  for (const digit of pin) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '確定' }).click()
}

/**
 * 「みんなで使う端末」として業務を始める。すでに業務画面が出ているときは何もしない
 * （同じ context で 2 度目に開いた spec がある）。
 */
export async function enterSharedWorkspace(
  page: Page,
  place: string = CHECKOUT_IPAD,
): Promise<void> {
  const nav = page.getByRole('navigation', { name: '画面の切り替え' })
  const choose = page.getByRole('button', { name: 'みんなで使う端末にする' })
  await expect(nav.or(choose).first()).toBeVisible()
  if (!(await choose.isVisible())) return
  await choose.click()
  await page.getByRole('button', { name: new RegExp(place) }).click()
  await page.getByRole('button', { name: 'この置き場所で始める' }).click()
  await enterPin(page, SHARED_PIN)
  await nav.waitFor()
}
