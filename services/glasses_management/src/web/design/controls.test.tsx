import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Action } from './controls'

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
