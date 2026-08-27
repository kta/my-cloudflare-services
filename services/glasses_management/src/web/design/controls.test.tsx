import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Action, FilterGroup } from './controls'

/*
 * `Action` は既定では素の button である（突き合わせ台の画素を動かさないため）。
 * ただしログイン等、form の submit で確定させたい面がある。Enter で送信できないと
 * キーボードだけの利用者が確定に辿り着けないので、`type` を選べる必要がある。
 */

test('既定では form を送信しない button である', () => {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
  render(
    <form onSubmit={onSubmit}>
      <Action>押す</Action>
    </form>,
  )
  fireEvent.click(screen.getByRole('button', { name: '押す' }))
  expect(onSubmit).not.toHaveBeenCalled()
})

test('type="submit" を渡すと form の送信になる', () => {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
  render(
    <form onSubmit={onSubmit}>
      <Action type="submit">送信</Action>
    </form>,
  )
  fireEvent.click(screen.getByRole('button', { name: '送信' }))
  expect(onSubmit).toHaveBeenCalledOnce()
})

test('押せない状態では submit も起こさない', () => {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
  render(
    <form onSubmit={onSubmit}>
      <Action type="submit" disabled>
        送信
      </Action>
    </form>,
  )
  fireEvent.click(screen.getByRole('button', { name: '送信' }))
  expect(onSubmit).not.toHaveBeenCalled()
})

/*
 * 絞り込みの選択（`FilterGroup`）。
 *
 * ネイティブの `<select>` は既定の三角と既定の選択色を絞り込みの列に持ち込む。
 * モックの `.filter` は押しボタンの並びなので、押した時点で効く絞り込みは
 * ピルを 1 つずつ並べる形にする。値は今までと同じ文字列を返す。
 */
test('絞り込みの選択はピルの並びで、ネイティブの select を描かない', () => {
  const onChange = vi.fn()
  const { container } = render(
    <FilterGroup
      label="種別"
      value="all"
      options={[
        { value: 'all', label: 'すべての種別' },
        { value: 'notice', label: 'お知らせのみ' },
      ]}
      onChange={onChange}
    />,
  )
  expect(container.querySelector('select')).toBeNull()
  const group = screen.getByRole('group', { name: '種別' })
  const pills = within(group).getAllByRole('button')
  expect(pills[0]).toHaveAttribute('aria-pressed', 'true')
  expect(pills[1]).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(pills[1] as HTMLElement)
  expect(onChange).toHaveBeenCalledWith('notice')
})
