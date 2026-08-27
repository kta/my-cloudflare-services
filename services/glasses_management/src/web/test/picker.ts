import { fireEvent, within } from '@testing-library/react'

/**
 * `PickerField` を「押して開き、候補を押して選ぶ」まで進める。
 *
 * ネイティブの `<select>` を捨てたので `fireEvent.change` は使えない。値の
 * 決まり方（選択肢の `value` がそのまま返る）は変わっていないため、各画面の
 * テストはこの 2 手を挟むだけで、送信内容の検証はそのまま残せる。
 */
export function choosePickerOption(combobox: HTMLElement, optionLabel: string): void {
  fireEvent.click(combobox)
  const listId = combobox.getAttribute('aria-controls')
  const listbox = listId === null ? null : combobox.ownerDocument.getElementById(listId)
  if (listbox === null) throw new Error(`候補が開いていません: ${optionLabel}`)
  fireEvent.click(within(listbox).getByRole('option', { name: optionLabel }))
}
