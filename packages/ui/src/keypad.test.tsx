import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Keypad, type KeypadProps, PinField, TryMeter } from './keypad'

/*
 * 暗証番号のテンキー（LOGIN-STAFF-PIN / LOGIN-PIN-ERROR / LOGIN-SHARED-PIN / EX-PERMISSION）。
 * 見た目の寸法は e2e の突き合わせで見るので、ここでは
 * 「何が読めて、何が押せるか」と「入力した値が DOM に漏れないか」を見る。
 */

/** 値を持つ器。テンキーは値を持たない（打ちかけを画面の側に残すため）。 */
function Harness({ onSubmit, ...props }: Partial<KeypadProps> & { onSubmit?: () => void } = {}) {
  const [value, setValue] = useState('')
  return (
    <>
      <PinField label="暗証番号" filled={value.length} />
      <Keypad
        value={value}
        onChange={setValue}
        onSubmit={onSubmit ?? (() => undefined)}
        {...props}
      />
    </>
  )
}

const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

async function type(text: string) {
  for (const ch of text) await userEvent.click(screen.getByRole('button', { name: ch }))
}

describe('Keypad', () => {
  it('0〜9 と 削除 と 確定 の 12 個を持つ', () => {
    render(<Harness />)
    for (const name of [...digits, '削除', '確定']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('button')).toHaveLength(12)
  })

  it('キーは 1 つずつ名前を持ち、押すと 1 文字ずつ増える', async () => {
    render(<Harness />)
    await type('102')
    expect(screen.getByRole('group', { name: /3桁まで入力しました/ })).toBeInTheDocument()
  })

  it('削除は末尾を 1 文字だけ消し、空のときは何もしない', async () => {
    const onChange = vi.fn()
    render(<Keypad value="" onChange={onChange} onSubmit={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(onChange).not.toHaveBeenCalled()
    render(<Keypad value="123" onChange={onChange} onSubmit={() => undefined} />)
    await userEvent.click(screen.getAllByRole('button', { name: '削除' })[1] as HTMLElement)
    expect(onChange).toHaveBeenCalledWith('12')
  })

  it('3 桁では確定を押せず、押せない理由が読み上げに乗る', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await type('123')
    const confirm = screen.getByRole('button', { name: '確定' })
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAccessibleDescription('あと1桁で「確定」を押せます')
    await userEvent.click(confirm)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('4 桁で確定を押せるようになる', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await type('1234')
    const confirm = screen.getByRole('button', { name: '確定' })
    expect(confirm).toBeEnabled()
    expect(confirm).toHaveAccessibleDescription('「確定」で業務が始まります')
    await userEvent.click(confirm)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('外から止められているあいだは、桁が足りていても押せず理由が読める', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} blockedReason="30秒お待ちください" />)
    await type('1234')
    const confirm = screen.getByRole('button', { name: '確定' })
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAccessibleDescription('30秒お待ちください')
  })

  it('6 桁を超えて入力できない', async () => {
    render(<Harness />)
    await type('1234567')
    expect(screen.getByRole('group', { name: /6桁まで入力しました/ })).toBeInTheDocument()
  })

  it('物理キーボードの数字・Backspace・Enter が画面のキーと同じ結果になる', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.keyboard('12345')
    expect(screen.getByRole('group', { name: /5桁まで入力しました/ })).toBeInTheDocument()
    await userEvent.keyboard('{Backspace}')
    expect(screen.getByRole('group', { name: /4桁まで入力しました/ })).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('a')
    expect(screen.getByRole('group', { name: /4桁まで入力しました/ })).toBeInTheDocument()
  })
})

describe('PinField', () => {
  it('常に 6 枠で、何桁入力したかを文字でも伝える', () => {
    const { container } = render(<PinField label="暗証番号" filled={3} />)
    expect(screen.getByText(/暗証番号\s+3桁まで入力しました/)).toBeInTheDocument()
    expect(container.querySelectorAll('fieldset > span')).toHaveLength(6)
  })

  it('入力値そのものを DOM に出さない（value は ● だけ）', () => {
    const { container } = render(<PinField label="暗証番号" filled={4} />)
    expect(container.querySelector('input')).toBeNull()
    expect(container.textContent).not.toMatch(/\d(?!桁)/)
  })

  it('違っていたときは、色ではなく文字で打ち直しを伝える', () => {
    render(<PinField label="暗証番号" filled={0} invalid />)
    expect(screen.getByText(/暗証番号\s+はじめから打ち直してください/)).toBeInTheDocument()
  })
})

describe('TryMeter', () => {
  it('残り回数を role="img" と aria-label の両方で伝える', () => {
    render(<TryMeter used={1} />)
    const meter = screen.getByRole('img', { name: '残り2回お試しいただけます' })
    expect(meter.childElementCount).toBe(3)
  })
})
