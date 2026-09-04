import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Keypad, PinField, TryMeter } from './index'

function PinControls({ onConfirm = vi.fn() }: { onConfirm?: () => void }) {
  const [value, setValue] = useState('')
  return (
    <>
      <PinField value={value} onChange={setValue} onConfirm={onConfirm} />
      <Keypad value={value} onChange={setValue} onConfirm={onConfirm} />
    </>
  )
}

describe('Keypad', () => {
  it('has 12 keys: digits 0 through 9, delete, and confirm', () => {
    render(<PinControls />)

    for (const name of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '削除', '確定']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('button')).toHaveLength(12)
  })

  it('names every digit key and adds one character per press', async () => {
    const user = userEvent.setup()
    render(<PinControls />)

    await user.click(screen.getByRole('button', { name: '2' }))
    await user.click(screen.getByRole('button', { name: '5' }))

    expect(screen.getByRole('textbox', { name: '暗証番号 6桁のうち2桁を入力済み' })).toHaveValue(
      '●●',
    )
  })

  it('accepts zero and ignores non-PIN physical keys', async () => {
    const user = userEvent.setup()
    render(<PinControls />)

    await user.click(screen.getByRole('button', { name: '0' }))
    await user.click(screen.getByRole('textbox'))
    await user.keyboard('x')

    expect(screen.getByRole('textbox')).toHaveValue('●')
  })

  it('removes only the last digit and does nothing when empty', async () => {
    const user = userEvent.setup()
    render(<PinControls />)

    await user.click(screen.getByRole('button', { name: '削除' }))
    expect(screen.getByRole('textbox')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '2' }))
    await user.click(screen.getByRole('button', { name: '削除' }))

    expect(screen.getByRole('textbox', { name: '暗証番号 6桁のうち1桁を入力済み' })).toHaveValue(
      '●',
    )
  })

  it('disables confirmation after three digits and describes why', async () => {
    const user = userEvent.setup()
    render(<PinControls />)

    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '2' }))
    await user.click(screen.getByRole('button', { name: '3' }))

    const confirm = screen.getByRole('button', { name: '確定' })
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAccessibleDescription('あと1桁で「確定」を押せます。')
  })

  it('enables confirmation at four digits', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<PinControls onConfirm={onConfirm} />)

    for (const digit of ['1', '2', '3', '4'])
      await user.click(screen.getByRole('button', { name: digit }))
    await user.click(screen.getByRole('button', { name: '確定' }))

    expect(screen.getByRole('button', { name: '確定' })).toBeEnabled()
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('does not accept more than six digits', async () => {
    const user = userEvent.setup()
    render(<PinControls />)

    for (const digit of ['1', '2', '3', '4', '5', '6', '7'])
      await user.click(screen.getByRole('button', { name: digit }))

    expect(screen.getByRole('textbox', { name: '暗証番号 6桁のうち6桁を入力済み' })).toHaveValue(
      '●●●●●●',
    )
  })

  it('treats physical digit, Backspace, and Enter keys like the visible keys', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<PinControls onConfirm={onConfirm} />)

    const input = screen.getByRole('textbox')
    await user.click(input)
    await user.keyboard('1234{Backspace}4{Enter}')

    expect(input).toHaveValue('●●●●')
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})

describe('PinField', () => {
  it('always renders six slots and says how many digits have been entered', () => {
    render(<PinField value="12" onChange={vi.fn()} />)

    expect(screen.getAllByTestId('pin-slot')).toHaveLength(6)
    expect(screen.getByText('6桁のうち2桁を入力済み')).toBeInTheDocument()
  })

  it('never places the entered PIN in the DOM and displays only bullets', () => {
    const { container } = render(<PinField value="2580" onChange={vi.fn()} />)

    expect(container).not.toHaveTextContent('2580')
    expect(screen.getByRole('textbox')).toHaveValue('●●●●')
    expect(screen.getAllByText('●')).toHaveLength(4)
  })

  it('keeps a rejected PIN visibly invalid without requiring a confirmation callback', async () => {
    const user = userEvent.setup()
    render(<PinField value="2580" onChange={vi.fn()} invalid />)

    await user.click(screen.getByRole('textbox'))
    await user.keyboard('{Enter}')

    expect(screen.getAllByTestId('pin-slot')[0]).toHaveClass('border-danger')
  })

  it('keeps a visible token-based focus indicator for the transparent keyboard input', () => {
    render(<PinField value="" onChange={vi.fn()} />)

    expect(screen.getByRole('textbox').parentElement).toHaveClass('focus-within:outline-focus')
  })
})

describe('TryMeter', () => {
  it('exposes the remaining attempts with both role img and an accessible name', () => {
    render(<TryMeter remainingAttempts={2} />)

    expect(screen.getByRole('img', { name: 'あと2回お試しいただけます' })).toBeInTheDocument()
  })

  it('clamps the visual meter to its three attempts', () => {
    const { rerender } = render(<TryMeter remainingAttempts={9} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('あと3回お試しいただけます')

    rerender(<TryMeter remainingAttempts={-1} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('あと0回お試しいただけます')
  })
})

/*
 * `cn()` は tailwind-merge を持たない単純な結合なので、
 * 同じ種類のユーティリティを 2 つ載せると、勝つのはクラス列の順ではなく
 * Tailwind が CSS を書き出す順になる。
 *
 * 実際に「確定」キーは `bg-surface`（白）と `bg-pine`（緑）の両方を載せており、
 * 計算後の背景は白、文字色は `text-on-pine`（白）—— **白地に白文字でラベルが見えず、
 * 空のボタンに見えていた**（UX 監査で「確定のラベルが消える」と観測されたものの正体）。
 * 打ち消しに頼らず、地の色は 1 つだけ載せる。
 */
describe('確定キーの見た目', () => {
  function confirmKey(): HTMLElement {
    render(<Keypad value="2580" onChange={() => {}} onConfirm={() => {}} />)
    return screen.getByRole('button', { name: '確定' })
  }

  it('地の色のユーティリティを 1 つしか載せない', () => {
    const classes = confirmKey().className.split(/\s+/)
    expect(classes.filter((name) => /^bg-/.test(name))).toEqual(['bg-pine'])
  })

  it('文字色のユーティリティも 1 つしか載せない', () => {
    const classes = confirmKey().className.split(/\s+/)
    expect(classes.filter((name) => /^text-(on-pine|ink)/.test(name))).toEqual(['text-on-pine'])
  })

  it('数字キーは白地・地の文字色のまま', () => {
    render(<Keypad value="" onChange={() => {}} onConfirm={() => {}} />)
    const classes = screen.getByRole('button', { name: '7' }).className.split(/\s+/)
    expect(classes.filter((name) => /^bg-/.test(name))).toEqual(['bg-surface'])
    expect(classes).toContain('text-ink')
  })
})
