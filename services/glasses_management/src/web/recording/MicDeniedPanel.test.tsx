import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MicDeniedPanel } from './MicDeniedPanel'

/*
 * マイクが使えない面（承認済みモック docs/frontend/mockups/eyex/images/EX-MIC-DENIED.png）。
 *
 * この面の仕事は「できないことを 1 つに絞って言い切り、次の一手をボタンで出す」こと。
 * お客様を待たせたまま読む面なので、失われていないものを先に言う。
 *
 * 実測（screens/EX-MIC-DENIED.html の <style>）:
 *   `.wrap` は `1fr 400px`。左 padding 40px 44px、右は左辺 1px 罫 + 地 --surface + padding 40px 32px。
 *   `.lead` は左に 6px の --alert、見出し 23px --alert（句点を打たない）、本文 16px/1.6。
 *   `.st .n` は 30px の円・地 --brand・文字 700 15px。段の間は `.stack.lg` の 28px。
 *   ボタンは `.btn.big`（min-height 56px / 18px）が 2 つと `.btn.quiet` が 1 つ。
 *   補足は 13px の --ink-2。
 */

function props(overrides: Partial<Parameters<typeof MicDeniedPanel>[0]> = {}) {
  return {
    onContinueWithoutRecording: vi.fn(),
    onRecheck: vi.fn(),
    onAbandon: vi.fn(),
    ...overrides,
  }
}

describe('MicDeniedPanel', () => {
  it('できないのは録音だけだと先に言い切る', () => {
    render(<MicDeniedPanel {...props()} />)

    const lead = screen.getByRole('alert')
    expect(
      within(lead).getByRole('heading', { name: 'マイクが使えないため、録音できません' }),
    ).toBeInTheDocument()
    expect(lead).toHaveTextContent('ご予約の受付は、このまま最後まで続けられます。')
    expect(
      screen.getByText('できないのは録音だけです。この受付をあとから聞き直すことはできません。'),
    ).toBeInTheDocument()
  })

  it('いまも使えることを 3 行で出す', () => {
    render(<MicDeniedPanel {...props()} />)

    const still = screen.getByRole('list', { name: 'いまも使えます' })
    const rows = within(still).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.textContent)).toEqual([
      '予約を取る・変える・取り消す',
      'ここまで伺った内容（お日にち・お時間・お客様）',
      '手書きメモ',
    ])
  })

  it('直し方が番号つきの 3 手順で並ぶ', () => {
    render(<MicDeniedPanel {...props()} />)

    const how = screen.getByRole('list', { name: '直し方　この iPad の「設定」で' })
    const steps = within(how).getAllByRole('listitem')
    expect(steps).toHaveLength(3)
    // 丸番号は装飾（aria-hidden）で、読み上げには並びの順序だけが届く。
    expect(steps.map((step) => step.textContent)).toEqual([
      '1ホーム画面の「設定」を開く',
      '2一覧から「EYEX予約」を選ぶ',
      '3「マイク」をオンにする',
    ])
  })

  it('「録音せずに続ける」で同じ受付の続きへ戻る', async () => {
    const bag = props()
    render(<MicDeniedPanel {...bag} />)

    await userEvent.click(screen.getByRole('button', { name: '録音せずに続ける' }))

    expect(bag.onContinueWithoutRecording).toHaveBeenCalledTimes(1)
    // 許可を説明するだけの別画面を挟まない（この面は同じ受付の続きへ戻すだけ）。
    expect(bag.onRecheck).not.toHaveBeenCalled()
    expect(bag.onAbandon).not.toHaveBeenCalled()
  })

  it('「直したので、もう一度確かめる」で読み込み直し、下書きを失わない', async () => {
    const bag = props()
    render(<MicDeniedPanel {...bag} />)

    await userEvent.click(screen.getByRole('button', { name: '直したので、もう一度確かめる' }))

    expect(bag.onRecheck).toHaveBeenCalledTimes(1)
    expect(bag.onContinueWithoutRecording).not.toHaveBeenCalled()
    expect(
      screen.getByText('伺った日時・お客様・手書きメモは、読み込み直しても残ります。'),
    ).toBeInTheDocument()
  })

  it('まだ使えないときは同じ面に留まって理由が読める', () => {
    render(<MicDeniedPanel {...props({ recheck: 'still-denied' })} />)

    expect(
      screen.getByRole('heading', { name: 'マイクが使えないため、録音できません' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'まだマイクが使えません。上の 3 つの手順をもう一度お確かめください。',
    )
  })

  it('確かめている間は「確かめています…」を読み上げに届け、二度押しをさせない', async () => {
    const bag = props({ recheck: 'checking' })
    render(<MicDeniedPanel {...bag} />)

    expect(screen.getByRole('status')).toHaveTextContent('マイクの許可を確かめています…')
    /*
     * `disabled` にすると、立てた瞬間にフォーカスが body へ落ちて押した指の
     * 居場所が消える。押せる姿のまま押下だけを握り潰す。
     */
    const button = screen.getByRole('button', { name: '直したので、もう一度確かめる' })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(button)
    expect(bag.onRecheck).not.toHaveBeenCalled()
  })

  it('「受付をやめる」は器の確認へ渡すだけで、この面で確認を作らない', async () => {
    const bag = props()
    render(<MicDeniedPanel {...bag} />)

    await userEvent.click(screen.getByRole('button', { name: '受付をやめる' }))

    expect(bag.onAbandon).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('右下の常駐表示は器から受けた 1 つだけを置く', () => {
    const { rerender } = render(<MicDeniedPanel {...props()} />)
    expect(screen.queryByTestId('recording-indicator-slot')).not.toBeInTheDocument()

    rerender(
      <MicDeniedPanel {...props()} indicator={<span data-testid="badge">録音していません</span>} />,
    )
    const slot = screen.getByTestId('recording-indicator-slot')
    expect(within(slot).getByTestId('badge')).toBeInTheDocument()
    expect(screen.getAllByTestId('badge')).toHaveLength(1)
  })

  it('触れるものはすべて 44pt 以上の高さを持つ', () => {
    render(<MicDeniedPanel {...props()} />)

    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toMatch(/min-h-(11|12|13|14)\b/)
    }
  })
})
