import type { Page } from '@playwright/test'
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
 *
 * 盤面は `seed.mjs` が入れる EYEX 銀座店。この project は業務の e2e より先に走る
 * （playwright.config.ts の project の並び）ので、撮るのは必ず seed のままの姿である。
 */

const ORG = 'org-eyex-seed'

async function startWork(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(ORG)
  await page.getByRole('button', { name: '業務を始める' }).click()
  await page.getByRole('navigation', { name: '画面の切り替え' }).waitFor()
}

/** 設定の 1 面を開く。中身が届くまで待ってから撮る（読み込み中の姿を基準と比べない）。 */
async function openSection(page: Page, section: string): Promise<void> {
  await startWork(page)
  await page
    .getByRole('navigation', { name: '画面の切り替え' })
    .getByRole('button', { name: '設定', exact: true })
    .click()
  await page
    .getByRole('navigation', { name: '設定の項目' })
    .getByRole('button', { name: section, exact: true })
    .click()
  await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible()
}

test.describe('承認済みモックとの突き合わせ', () => {
  test('HOME — トップ（共有端末）', async ({ page }) => {
    await startWork(page)
    await expect(page.locator('header').first()).toContainText('EYEX 銀座店')
    /*
     * いま残っている差（2026-08-28）:
     *   - 下辺の日付の帯（2026年 8月 24〜30 とカレンダー）… まだ無い（台帳の P2 が持ち込む）
     *   - 上のバーの「お知らせ 3」… P10 で足す（いまは「業務を終える」を置いている）
     * 店名は seed が入ったので「EYEX 銀座店」に揃い、実測は 3.2253%（P0 は 5% を許していた）。
     * 器（上のバー・サイドバー・主操作の 2 枚）は画素まで合っている。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('HOME.png', { scale: 'device', maxDiffPixelRatio: 0.0323 })
  })

  test('SETTINGS-STORE — 設定・店舗の情報', async ({ page }) => {
    await openSection(page, '店舗の情報')
    await expect(page.getByLabel('店名', { exact: true })).toHaveValue('EYEX 銀座店')
    /*
     * いま許している差:
     *   - 第2サイドバー: モックの 14 項目に対して 6 項目しか出さない（P1 の決め #1）。
     *     残る 8 項目は行き先が無く、押せて何も起きない行を置かないため。
     *   - 保存バー左の「キャンセル」→「変更を捨てる」（決め #2。予約の取り消しと取り違えない）。
     *   - 上のバーの「お知らせ 3」… P10。
     *   - 各行の `›`（別の面へ行く印）を出さない。その場で直せる欄だからである。
     *   - 紹介文のカードの「未保存」の札を出さない。未保存は上のバーが 1 か所で言う
     *     （状態の札を 2 か所に置かない）。
     * 実測 3.7969%（2026-08-28）。**この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('SETTINGS-STORE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0381,
    })
  })

  test('SETTINGS-CALENDAR — 設定・営業日', async ({ page }) => {
    await openSection(page, '営業日')
    await expect(page.getByTestId('closed-days')).toBeVisible()
    /*
     * いま許している差:
     *   - 第2サイドバーの 6 項目・「変更を捨てる」・「お知らせ 3」（上と同じ 3 つ）。
     *   - 本日の輪は実行日に付く。基準画像は 2026-08-27 に付いている。
     *   - 「この店舗で予約を受け付ける」は読み取りだけ（保存する経路がまだ無い）。
     * 実測 4.5068%（2026-08-28）。**この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('SETTINGS-CALENDAR.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0451,
    })
  })

  test('SETTINGS-HOURS — 設定・営業時間', async ({ page }) => {
    await openSection(page, '営業時間')
    await expect(page.getByLabel('閉店')).toHaveValue('19:00')
    /*
     * いま許している差:
     *   - 第2サイドバーの 6 項目・「変更を捨てる」・「お知らせ 3」。
     *   - お昼の帯は 12:00–13:00（モックの 13:00–14:00 は誤記。決め #6）。
     *   - 「通常の営業時間」に「お昼の休憩」の行を持たない（帯は右の 1 か所で直す）。
     *   - 最後の 1 行は実行日の曜日で書き変わる（基準画像は木曜の 18:20）。
     * 実測 4.0400%（2026-08-28）。**この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('SETTINGS-HOURS.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0405,
    })
  })

  test('SETTINGS-PURPOSE — 設定・ご来店の目的', async ({ page }) => {
    await openSection(page, 'ご来店の目的')
    await expect(page.getByText('ご来店の目的　6件')).toBeVisible()
    /*
     * いま許している差:
     *   - 第2サイドバーの 6 項目・「変更を捨てる」・「お知らせ 3」。
     *   - 行を選ぶまで下半分（編集の箱と影響のカード）が出ない。モックは
     *     「メガネを新しく作る」を選んだ姿を描いている。
     *   - 「台帳に出す短い名前」の 1 行を足している（台帳の帯に収める唯一の追加）。
     * 実測 4.9303%（2026-08-28）。**この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('SETTINGS-PURPOSE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0494,
    })
  })

  test('SETTINGS-STAFF — 設定・スタッフと技能', async ({ page }) => {
    await openSection(page, 'スタッフと技能')
    await expect(page.getByText('スタッフ　6名')).toBeVisible()
    /*
     * いま許している差:
     *   - 第2サイドバーの 6 項目・「変更を捨てる」・「お知らせ 3」。
     *   - 勤務時間の 7 列が空（お休み）。seed は曜日テンプレート（staff_weekly_shifts）だけを
     *     持ち、日付への展開（staff_shifts）は保存と日次 Cron が作るためである。
     *   - PIN の「作り直す」を出さない（再設定は P10）。
     *   - 勤務は読み取りの札ではなく直せる欄にしてある（AC-SET-12 が直して保存し直すため）。
     *     「お休み」の印は字ごと label で包んで 44pt にしたので、7 列が縦に伸びる（決め #14）。
     * 実測 5.2689%（2026-08-28）。**この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('SETTINGS-STAFF.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0527,
    })
  })

  test('SETTINGS-EQUIPMENT — 設定・設備と点検', async ({ page }) => {
    await openSection(page, '設備と点検')
    await expect(page.getByText('設備と場所　6件')).toBeVisible()
    /*
     * いま許している差:
     *   - 第2サイドバーの 6 項目・「変更を捨てる」・「お知らせ 3」。
     *   - 行を選ぶまで下半分（編集の箱と赤いカード）が出ない。モックは「視力測定機 B」を
     *     選び、「いま使える」を切った未保存の姿を描いている。
     *   - 影響するご予約の件数はご予約の行が入る P3 まで 0 件のままである。
     * 実測 4.5129%（2026-08-28）。**この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('SETTINGS-EQUIPMENT.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0452,
    })
  })
})
