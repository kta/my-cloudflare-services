import { expect, type Page, test } from '@playwright/test'
import { completeSeededTerminalStart, SEEDED_SITE_PATH } from './support/terminal'

/**
 * **押しても何も起きないボタンを 1 つも置かない。**
 *
 * 台帳の予約詳細では「ご来店を受け付ける」「変更する」「取り消す」の 3 つが、
 * `onClick={undefined}` のまま描かれていた。任意プロパティ（`onXxx?: () => void`）を
 * 親が渡し忘れても TypeScript は何も言わないので、型でも e2e でも誰も気づけなかった。
 * ここは**実行時に React の props を覗いて**、ハンドラの無いボタンを機械的に見つける面である。
 *
 * 見つけ方: React は DOM ノードに `__reactProps$<乱数>` という鍵で props を貼る。
 * その `onClick` / `onPointerDown` を見れば、押して何かが起きるボタンかどうかが分かる。
 */

const ORG = 'eye'
/** seed が予約を置いている暦日。台帳が最初に尋ねる日は端末の時計で決まる。 */
const SEEDED_NOW = '2026-08-27T02:08:00.000Z'

/*
 * ハンドラを持たない（＝押しても何も起きない）ボタンのラベルを返す。
 *
 * `page.evaluate` の中はブラウザ側で動くので、この面の tsconfig には DOM の型が無い。
 * ほかの e2e（`recording.spec.ts` のマイク差し替え）と同じく、文字列で渡す。
 */
const DEAD_CONTROLS = `(() => {
  const propsKey = (el) => Object.keys(el).find((key) => key.startsWith('__reactProps$'))
  const dead = []
  for (const button of Array.from(document.querySelectorAll('button'))) {
    if (button.getBoundingClientRect().width < 2) continue
    if (button.disabled || button.type === 'submit') continue
    const key = propsKey(button)
    const props = key === undefined ? null : button[key]
    const wired =
      typeof props?.onClick === 'function' || typeof props?.onPointerDown === 'function'
    if (!wired) {
      dead.push((button.getAttribute('aria-label') ?? button.innerText).replace(/s+/g, ' ').trim())
    }
  }
  return dead
})()`

async function deadControls(page: Page): Promise<string[]> {
  return page.evaluate(DEAD_CONTROLS)
}

async function startWork(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(SEEDED_NOW))
  await page.goto(SEEDED_SITE_PATH)
  await completeSeededTerminalStart(page, 'shared')
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: '画面の切り替え' })

// @e2e-covers AC-FOUND-10
test('どの画面にも、押しても何も起きないボタンが無い', async ({ page }) => {
  await startWork(page)
  expect(await deadControls(page), 'トップ').toEqual([])

  for (const screen of [
    '予約台帳',
    '来店受付',
    '予約を探す',
    '受付履歴',
    '顧客台帳',
    '分析',
    '設定',
    '予約を取る',
  ]) {
    await sidebar(page).getByRole('button', { name: screen, exact: true }).click()
    await page.waitForTimeout(600)
    expect(await deadControls(page), screen).toEqual([])
  }
})

test('予約台帳の詳細にある 3 つの操作は、どれも押すと次の画面へ進む', async ({ page }) => {
  await startWork(page)
  await sidebar(page).getByRole('button', { name: '予約台帳', exact: true }).click()
  const band = page.getByRole('gridcell', { name: /^11:00から12:00/ }).first()

  // 開いた詳細そのものにも、死んだボタンが無い。
  await band.click()
  await expect(page.getByRole('dialog', { name: '予約の詳細' })).toBeVisible()
  expect(await deadControls(page), '予約詳細').toEqual([])

  // 「変更する」は、押した予約をそのまま持って変更の面へ進む（白紙の検索に落とさない）。
  await page.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'お日にちはこのままでよろしいですか？' }),
  ).toBeVisible()
  await expect(page.getByText('田中 花子 様')).toBeVisible()

  // 「取り消す」は、その予約の取り消しの面へ直行する。
  await sidebar(page).getByRole('button', { name: '予約台帳', exact: true }).click()
  await band.click()
  await page.getByRole('button', { name: '取り消す', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'この予約を取り消します' })).toBeVisible()

  // 「ご来店を受け付ける」は来店受付の面へ進む。
  await sidebar(page).getByRole('button', { name: '予約台帳', exact: true }).click()
  await band.click()
  await page.getByRole('button', { name: 'ご来店を受け付ける' }).click()
  await expect(page.locator('header').first()).toContainText('来店受付')
})

/*
 * 上のバーの営業状態は、以前 `'営業中　10:00–19:00'` という文字列リテラルだった。
 * どの店舗でも、どの曜日でも、真夜中でも同じ 1 行を出していた。
 */
// @e2e-covers AC-FOUND-09
test('上のバーの営業状態は、その店舗の保存された営業時間から出す', async ({ page }) => {
  await startWork(page)
  const bar = page.locator('header').first()
  await expect(bar).toContainText('EYE 銀座店')
  // 銀座店の保存値は 10:00–19:00。定休の火曜には「本日は定休日」に変わる。
  await expect(bar).toContainText(/(営業中|営業時間外)　10:00–19:00|本日は定休日/)
})
