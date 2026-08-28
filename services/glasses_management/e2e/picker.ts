import type { Locator, Page } from '@playwright/test'

/**
 * `PickerField` を「引き金を押して開き、候補を押して選ぶ」まで進める。
 *
 * ネイティブの `<select>` は捨てたので `selectOption` は使えない。値の決まり方
 * （選択肢の `value` がそのまま返る）は変わっていないため、各テストはこの 2 手を
 * 挟むだけで、送信内容の検証はそのまま残せる。
 */
export async function choosePickerOption(
  scope: Page | Locator,
  fieldLabel: string,
  optionLabel: string,
): Promise<void> {
  await scope.getByLabel(fieldLabel, { exact: true }).click()
  // 候補の板は引き金の隣に開く。同じ面の中で名前が一意なので、役割で名指す。
  await scope.getByRole('option', { name: optionLabel, exact: true }).click()
}
