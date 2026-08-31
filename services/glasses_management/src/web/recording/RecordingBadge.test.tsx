import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RecordingBadge, type RecordingBadgeState } from './RecordingBadge'

/*
 * 受付中の録音の印（承認済みモック docs/frontend/mockups/eyex）。
 *
 * 実測（assets/eyex.css と screens/*.html）:
 *   BOOK-01-DATETIME `.rec`       = 最小高 48px・左右 14px・間 10px・角 pill・
 *                                   1px `--alert` の罫・地 `--alert-tint`・600 14px・
 *                                   点 12px・時間はモノスペース 15px
 *   BOOK-05-CONFIRM `.rec-float`  = 右下 20/20・内側 12px 16px・間 12px・角 16px・
 *                                   地 白・**2px** `--alert` の罫・影・点 14px・
 *                                   文字 15px `--alert`・時間はモノスペースで左に 10px
 *   EX-MIC-DENIED / EX-UPLOAD-FAILED `.float`
 *                                 = 右下 20/20・内側 12px 18px・間 14px・角 16px・
 *                                   地 白・**1px** `--line-strong` の罫・**影なし**・
 *                                   点 12px `--ink-3`・文言は地の色・時間だけ薄い
 *
 * ここで見るのは「何が読めるか」。寸法は e2e の突き合わせが見る。
 */

const STATES: readonly RecordingBadgeState[] = ['recording', 'asking', 'off', 'buffered']

describe('RecordingBadge', () => {
  it('録音中は「録音中」と経過時間を出す', () => {
    render(<RecordingBadge state="recording" elapsedSeconds={68} placement="bar" />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveTextContent('録音中')
    expect(badge).toHaveTextContent('01:08')
  })

  it('止まっているときは「録音していません」と「--:--」を出す', () => {
    render(<RecordingBadge state="off" elapsedSeconds={null} placement="bar" />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveTextContent('録音していません')
    expect(badge).toHaveTextContent('--:--')
    // 止まっているのに時間だけ残っていると「まだ録れている」に見える。
    expect(badge).not.toHaveTextContent('録音中')
  })

  it('許可を尋ねている間は「マイクの許可を確かめています」を出す', () => {
    render(<RecordingBadge state="asking" elapsedSeconds={null} placement="bar" />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveTextContent('マイクの許可を確かめています')
    expect(badge).toHaveTextContent('--:--')
  })

  it('端末に保管中は「録音は端末に保管中」と経過時間を出す', () => {
    render(<RecordingBadge state="buffered" elapsedSeconds={204} placement="floating" />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveTextContent('録音は端末に保管中')
    expect(badge).toHaveTextContent('03:24')
  })

  it('role="status" を持ち、状態が変わると読み上げに届く', () => {
    const { rerender } = render(
      <RecordingBadge state="recording" elapsedSeconds={12} placement="floating" />,
    )
    const badge = screen.getByRole('status')
    // 同じ入れ物のまま中身が変わる（差し替えると読み上げに届かない）。
    rerender(<RecordingBadge state="off" elapsedSeconds={null} placement="floating" />)
    expect(screen.getByRole('status')).toBe(badge)
    expect(badge).toHaveTextContent('録音していません')
    expect(badge).toHaveTextContent('--:--')
  })

  it('色だけで状態を伝えない（どの状態でも文字が 1 つ以上ある）', () => {
    for (const state of STATES) {
      const view = render(<RecordingBadge state={state} elapsedSeconds={7} placement="bar" />)
      const badge = screen.getByRole('status')
      expect((badge.textContent ?? '').trim().length).toBeGreaterThan(0)
      // 音の大きさの棒は飾りなので読み上げから外す。
      for (const meter of badge.querySelectorAll('[data-recording-meter]')) {
        expect(meter).toHaveAttribute('aria-hidden', 'true')
      }
      view.unmount()
    }
  })

  it('帯の形と右下の形を placement で切り替える', () => {
    const bar = render(<RecordingBadge state="recording" elapsedSeconds={68} placement="bar" />)
    const inBar = screen.getByRole('status')
    expect(inBar).toHaveAttribute('data-booking-recording', 'bar')
    expect(inBar.className).toContain('min-h-12')
    expect(inBar.className).toContain('rounded-full')
    expect(inBar.className).not.toContain('right-5')
    bar.unmount()

    render(<RecordingBadge state="recording" elapsedSeconds={192} placement="floating" />)
    const floating = screen.getByRole('status')
    expect(floating).toHaveAttribute('data-booking-recording', 'floating')
    expect(floating.className).toContain('right-5')
    expect(floating.className).toContain('bottom-5')
    expect(floating.className).toContain('rounded-panel')
  })

  it('右下で録っていないときは紙から浮かせず、文言も薄めない', () => {
    render(<RecordingBadge state="off" elapsedSeconds={null} placement="floating" />)

    const badge = screen.getByRole('status')
    const classes = badge.className.split(/\s+/)
    // モックの `.float` は 1px の罫だけを持ち、影は録音中の `.rec-float` だけが持つ。
    expect(classes.some((name) => name.startsWith('shadow'))).toBe(false)
    // 文言は地の色のまま。薄めるのは経過時間だけである（`.float b` は色を継ぐ）。
    expect(classes).toContain('text-ink')
    expect(classes).not.toContain('text-ink-muted')
    expect(badge.querySelector('.font-mono')?.className).toContain('text-ink-muted')
  })

  it('右下で録っている間だけ影を落とす', () => {
    render(<RecordingBadge state="recording" elapsedSeconds={12} placement="floating" />)

    expect(screen.getByRole('status').className).toContain('shadow-lg')
  })

  it('重なる操作ボタンがある面では下端を 84px へ上げる', () => {
    render(<RecordingBadge state="recording" elapsedSeconds={0} placement="floating" raised />)

    const floating = screen.getByRole('status')
    // 84px = bottom-21。押せるものの上に印がかぶって、押せなくならないようにする。
    expect(floating.className).toContain('bottom-21')
    expect(floating.className).not.toContain('bottom-5')
  })
})
