import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LoadFailed } from './LoadFailed'

/*
 * 「読み込めませんでした」と言う面には、必ずその場でやり直す手立てを置く。
 * この製品は画面ごとの URL を持たないので、「画面を開き直してください」は
 * 実行できない指示になる（開き直すと暗証番号からやり直しになる）。
 */
describe('読み込みに失敗した面', () => {
  it('何が読めなかったかを名指しする', () => {
    render(<LoadFailed what="営業日" onRetry={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('営業日を読み込めませんでした。')
  })

  it('その場でやり直せる', async () => {
    const onRetry = vi.fn()
    render(<LoadFailed what="分析" onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('「画面を開き直してください」と言わない（開き直すと暗証番号からやり直しになる）', () => {
    render(<LoadFailed what="設備と点検" onRetry={() => {}} />)
    expect(screen.getByRole('alert')).not.toHaveTextContent('開き直')
  })

  it('添える一言を出せる', () => {
    render(
      <LoadFailed what="受付履歴" onRetry={() => {}} hint="通信が切れているかもしれません。" />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('通信が切れているかもしれません。')
  })

  it('やり直すボタンはタップ標的の下限（44pt）を満たす', () => {
    render(<LoadFailed what="分析" onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: 'もう一度読み込む' }).className).toContain('min-h-12')
  })
})
