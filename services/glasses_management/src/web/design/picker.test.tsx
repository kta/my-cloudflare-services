import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { PickerField } from './forms'

/*
 * 選択の欄。
 *
 * ブラウザ既定の `<select>` は、地域設定の書体・既定の三角・既定の選択色を
 * 面に持ち込む。承認済みモックにその姿は 1 つも無い（同じ役割はすべて押し
 * ボタンで描かれている）ので、トークンだけで組んだ選択部品に置き換える。
 *
 * ここで押さえるのは 2 つ。**選ばれた値は今までどおり選択肢の `value` のまま**
 * であること（送信・検証の経路を一切動かさない）と、**ネイティブの要素を
 * 一切描かない**ことである。
 */

const OPTIONS = [
  { value: 'organization', label: '組織共通値' },
  { value: 'store', label: '店舗上書き' },
]

test('ネイティブの select も option も描かない', () => {
  const { container } = render(
    <PickerField id="scope" label="設定範囲" value="organization" options={OPTIONS} />,
  )
  expect(container.querySelector('select')).toBeNull()
  expect(container.querySelector('option')).toBeNull()
})

test('畳んだ姿で今の選択肢の言葉を名乗る', () => {
  render(<PickerField id="scope" label="設定範囲" value="store" options={OPTIONS} />)
  const trigger = screen.getByRole('combobox', { name: '設定範囲' })
  expect(trigger).toHaveTextContent('店舗上書き')
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('listbox')).toBeNull()
})

test('押すと候補が開き、選ぶと value が返って閉じる', () => {
  const onChange = vi.fn()
  render(
    <PickerField
      id="scope"
      label="設定範囲"
      value="organization"
      options={OPTIONS}
      onChange={onChange}
    />,
  )
  const trigger = screen.getByRole('combobox', { name: '設定範囲' })
  fireEvent.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const listbox = screen.getByRole('listbox', { name: '設定範囲' })
  const options = within_options(listbox)
  expect(options.map((option) => option.textContent)).toEqual(['組織共通値', '店舗上書き'])
  expect(options[0]).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(options[1] as HTMLElement)
  expect(onChange).toHaveBeenCalledWith('store')
  expect(screen.queryByRole('listbox')).toBeNull()
})

function within_options(listbox: HTMLElement): HTMLElement[] {
  return Array.from(listbox.querySelectorAll('[role="option"]')) as HTMLElement[]
}

test('キーボードだけで開閉と選択ができる', () => {
  const onChange = vi.fn()
  render(
    <PickerField
      id="scope"
      label="設定範囲"
      value="organization"
      options={OPTIONS}
      onChange={onChange}
    />,
  )
  const trigger = screen.getByRole('combobox', { name: '設定範囲' })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  fireEvent.keyDown(trigger, { key: 'Enter' })
  expect(onChange).toHaveBeenCalledWith('store')
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(trigger).toHaveFocus()
})

test('Escape は選ばずに閉じる', () => {
  const onChange = vi.fn()
  render(
    <PickerField
      id="scope"
      label="設定範囲"
      value="organization"
      options={OPTIONS}
      onChange={onChange}
    />,
  )
  const trigger = screen.getByRole('combobox', { name: '設定範囲' })
  fireEvent.click(trigger)
  fireEvent.keyDown(trigger, { key: 'Escape' })
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(onChange).not.toHaveBeenCalled()
})

test('可視ラベルを出す形でも、名前は 1 つだけ持つ', () => {
  render(<PickerField id="scope" label="設定範囲" value="store" options={OPTIONS} />)
  expect(screen.getAllByRole('combobox', { name: '設定範囲' })).toHaveLength(1)
})

test('44px 以上のタップ目標を保つ', () => {
  render(<PickerField id="scope" label="設定範囲" value="store" options={OPTIONS} />)
  const trigger = screen.getByRole('combobox', { name: '設定範囲' })
  fireEvent.click(trigger)
  // 畳んだ姿は入力と同じ 52px、候補の 1 行は 44px 以上（`min-h-11`）。
  expect(trigger.className).toContain('min-h-13')
  for (const option of within_options(screen.getByRole('listbox')))
    expect(option.className).toContain('min-h-11')
})
