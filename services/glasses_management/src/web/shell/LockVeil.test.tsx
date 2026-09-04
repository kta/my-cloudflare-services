import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LockVeil } from './LockVeil'

describe('LockVeil', () => {
  it('モックの説明を modal dialog として読み上げ、見出しへ focus を移す', () => {
    render(<LockVeil onContinue={() => {}} onEndSession={() => {}} />)

    const dialog = screen.getByRole('dialog', { name: 'お客様の情報を隠しています' })
    const heading = screen.getByRole('heading', { name: 'お客様の情報を隠しています' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(heading).toHaveFocus()
    expect(dialog).toHaveTextContent('2分間さわらなかったので伏せました。さわると元に戻ります。')
  })

  it('Escでは解除せず、明示した続行または業務終了だけを外へ渡す', () => {
    const onContinue = vi.fn()
    const onEndSession = vi.fn()
    render(<LockVeil onContinue={onContinue} onEndSession={onEndSession} />)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onContinue).not.toHaveBeenCalled()
    expect(onEndSession).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '画面にさわって続ける' }))
    const endSession = screen.getByRole('button', { name: '業務を終える' })
    expect(endSession).toBeDefined()
    if (endSession) fireEvent.click(endSession)
    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(onEndSession).toHaveBeenCalledTimes(1)
  })

  it('dialog の操作だけを残し、Tab はその中を巡回する', () => {
    render(<LockVeil onContinue={() => {}} onEndSession={() => {}} fullScreen />)

    const dialog = screen.getByRole('dialog')
    const controls = Array.from(dialog.querySelectorAll('button'))
    expect(controls).toHaveLength(2)

    const last = controls.at(-1)
    if (last === undefined) throw new Error('ロック解除の操作がありません')
    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(controls[0]).toHaveFocus()

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  it('ロック専用snapshotは伏せ字・時刻・件数だけを表示し、生のPIIを出さない', () => {
    render(
      <LockVeil
        onContinue={() => {}}
        onEndSession={() => {}}
        snapshot={{
          customerName: '●●●● 様',
          customerPhone: '090-●●●●-●●●●',
          time: '11:00',
          count: 12,
        }}
      />,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('●●●● 様')
    expect(dialog).toHaveTextContent('090-●●●●-●●●●')
    expect(dialog).toHaveTextContent('11:00')
    expect(dialog).toHaveTextContent('本日のご予約 12件')
    expect(dialog).not.toHaveTextContent('田中 花子')
    expect(dialog).not.toHaveTextContent('090-1234-5678')
  })
})
