import { expect, test } from '@playwright/test'

/*
 * 実装した画面を、承認済みモックの基準画像（docs/frontend/mockups/eyex/reference/<画面ID>.png）と
 * 1 枚ずつ重ねて、違う画素の割合を測る。
 *
 *   pnpm --filter @app/glasses_management exec playwright test --project=mock
 *
 * 不一致のときは test-results/ に `-diff.png` が残るので、そこを見て直す。
 * モックは Retina 相当（deviceScaleFactor 2）で撮ってあるので、`scale: 'device'` を必ず付ける
 * （既定の `'css'` だと CSS ピクセルまで縮められて寸法が合わない）。
 * 基準画像は端末のステータスバーを外した reference/ 側を使う
 * （`node docs/frontend/mockups/eyex/reference.mjs` で作り直せる）。
 * `maxDiffPixelRatio` はその画面の「いま許している差」であり、
 * **フェーズが進むたびに下げる**。上げてはいけない。
 *
 * この突き合わせは合否の主役ではない。文言・並び・押せるかは各画面の e2e で見る。
 * ここが見るのは「承認された見た目からどれだけ離れているか」だけである。
 */

test.describe('承認済みモックとの突き合わせ', () => {
  test('HOME — トップ（共有端末）', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('お店のコード').fill('mock-compare')
    await page.getByRole('button', { name: '業務を始める' }).click()
    await page.getByRole('navigation', { name: '画面の切り替え' }).waitFor()
    /*
     * いま残っている 4%（2026-08-28）は、P0 にまだ無いものだけ:
     *   - 下辺の日付の帯（2026年 8月 24〜30 とカレンダー）… P1 で足す
     *   - 上のバーの「お知らせ 3」… P10 で足す（いまは「業務を終える」を置いている）
     *   - 店名「EYEX 銀座店」… 店舗が 1 件も無いので「EYEX」と出ている。P1 で足す
     * 器（上のバー・サイドバー・主操作の 2 枚）は画素まで合っている。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('HOME.png', { scale: 'device', maxDiffPixelRatio: 0.05 })
  })
})
