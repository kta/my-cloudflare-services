import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UndoBar } from './undo-bar'

/*
 * 取り消しの付いた 1 行（UX 監査 NEW-04）。
 * 見るのは「押させてから数秒だけ戻せる」という約束そのもの —— 出ている間に押せば戻り、
 * 放っておけば黙って消える。
 */

afterEach(() => vi.useRealTimers())

function show(overrides: Partial<Parameters<typeof UndoBar>[0]> = {}) {
  const props = {
    message: '田中 花子 様を「視力測定」へ進めました。',
    onUndo: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  }
  render(<UndoBar {...props} />)
  return props
}

describe('取り消しの付いた知らせ', () => {
  it('何が起きたかを読み上げる（割り込みの alert ではなく status で）', () => {
    show()
    expect(screen.getByRole('status')).toHaveTextContent('「視力測定」へ進めました。')
  })

  it('「元に戻す」を押すと親へ伝える', async () => {
    const onUndo = vi.fn()
    show({ onUndo })
    await userEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('×で閉じられる', async () => {
    const onDismiss = vi.fn()
    show({ onDismiss })
    await userEvent.click(screen.getByRole('button', { name: 'この知らせを閉じる' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('放っておくと、決めた時間で自分から消える', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<UndoBar message="記録しました。" onUndo={() => {}} onDismiss={onDismiss} />)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(8000)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('出しておく長さは外から決められる', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(
      <UndoBar message="記録しました。" onUndo={() => {}} onDismiss={onDismiss} timeoutMs={2000} />,
    )
    vi.advanceTimersByTime(2000)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
