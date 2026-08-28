import { expect, type Locator, type Page } from '@playwright/test'

/**
 * 注意事項の面は master-detail になり、本文には柱で選んだ 1 件だけが出る
 * （全件を縦に連ねると、柱の並びと本文の並びが対応しなくなる）。柱の注意事項の
 * 行を順に開き、目当ての 1 件が本文に出た時点で止める。
 */
async function openFrom(page: Page, target: Locator, customerName: string): Promise<Locator> {
  const rows = page
    .getByRole('navigation', { name: '画面の一覧' })
    .getByRole('button')
    .filter({ hasText: customerName })
  // 一覧が届く前に数えると行が足りない。本文に 1 件出たら届いている。
  await expect(page.getByRole('article').first()).toBeVisible()
  const count = await rows.count()
  for (let index = 0; index < count; index += 1) {
    if ((await target.count()) > 0) return target
    const row = rows.nth(index)
    await row.click()
    // 押した行が現在地になるまで待つ。待たずに次を押すと選び直しが一つ飛ぶ。
    await expect(row).toHaveAttribute('aria-current', 'step')
  }
  return target
}

/** 名乗り（`注意事項 公開済み 版1`）で選ぶ。 */
export function openNote(page: Page, name: RegExp | string, customerName = '田中花子') {
  return openFrom(page, page.getByRole('article', { name }), customerName)
}

/** 載っている文で選ぶ。同じ状態の注意事項が複数あるときはこちらを使う。 */
export function openNoteWithText(page: Page, text: string, customerName = '田中花子') {
  return openFrom(page, page.getByRole('article').filter({ hasText: text }), customerName)
}
