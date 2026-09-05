import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UploadFailedPanel } from './UploadFailedPanel'

/*
 * 録音の保存に失敗した面（承認済みモック docs/frontend/mockups/eye/images/EX-UPLOAD-FAILED.png）。
 *
 * この面の仕事は「失われていないものを先に言う」こと。成功が上、失敗が下、次の一手が最後。
 *
 * 実測（screens/EX-UPLOAD-FAILED.html の <style>）:
 *   `.wrap` は `1fr 372px`。左 padding 40px 44px、右は左辺 1px 罫 + 地 --surface + padding 40px 32px。
 *   `.head .mark` は 60px の円・地 --brand。見出し 23px、予約番号は mono 700 16px。
 *   `.lead` は左に 6px の --alert、見出し 16px --alert、本文 16px/1.6。
 *   `.sum dt` 13px --ink-2（上に 22px）／`.sum dd` 16px 600。
 */

const JST = 9 * 60 * 60 * 1000

function iso(date: string, hhmm: string): string {
  return new Date(Date.parse(`${date}T${hhmm}:00.000Z`) - JST).toISOString()
}

function props(overrides: Partial<Parameters<typeof UploadFailedPanel>[0]> = {}) {
  return {
    reservation: {
      code: 'EY-2608-0187',
      startsAt: iso('2026-08-27', '14:00'),
      endsAt: iso('2026-08-27', '15:00'),
      purposeLabel: 'メガネを新しく作る',
      customerName: '中井 さくら',
      staffName: '佐藤 美咲',
      equipmentNames: ['視力測定機 A'],
    },
    durationSeconds: 204,
    nextAttemptAt: iso('2026-08-27', '11:20'),
    onContinue: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  }
}

describe('UploadFailedPanel', () => {
  it('先に「ご予約は確定しています」と予約番号が出る', () => {
    render(<UploadFailedPanel {...props()} />)

    expect(screen.getByRole('heading', { name: 'ご予約は確定しています' })).toBeInTheDocument()
    expect(screen.getByText('EY-2608-0187')).toBeInTheDocument()
    expect(screen.getByText('台帳にも入っています')).toBeInTheDocument()
  })

  it('そのあとに「保存できなかったのは、この受付の録音だけです」が出る', () => {
    const { container } = render(<UploadFailedPanel {...props()} />)

    const settled = screen.getByRole('heading', { name: 'ご予約は確定しています' })
    const failed = screen.getByRole('heading', {
      name: '保存できなかったのは、この受付の録音だけです',
    })
    expect(container).toContainElement(failed)
    // 成功が上、失敗が下。DOM の順序でも成功が先に来る。
    expect(settled.compareDocumentPosition(failed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('alert')).toHaveTextContent(
      '店内の通信が弱く、録音（03:24）をお店の保管庫へ送れませんでした。録音は、この iPad の中に残っています。',
    )
  })

  it('読み上げも成功から始まる（失われていないものを先に言う）', () => {
    render(<UploadFailedPanel {...props()} />)

    // `role="alert"` は 1 つきり。その 1 つの中で、成立が失敗より先に来る。
    const spoken = screen.getByRole('alert')
    const settled = spoken.textContent?.indexOf('ご予約は確定しています') ?? -1
    const failed = spoken.textContent?.indexOf('保存できなかったのは') ?? -1
    expect(settled).toBeGreaterThanOrEqual(0)
    expect(settled).toBeLessThan(failed)
  })

  it('次に自動で送り直す時刻が出る', () => {
    render(<UploadFailedPanel {...props()} />)

    expect(
      screen.getByText('11:20 に自動でもう一度送ります。操作は要りません。'),
    ).toBeInTheDocument()
  })

  it('自動で送り直す時刻が分からないときは、その一句を出さない', () => {
    render(<UploadFailedPanel {...props({ nextAttemptAt: null })} />)

    expect(screen.queryByText(/自動でもう一度送ります/)).not.toBeInTheDocument()
  })

  it('「このまま続ける」で予約台帳へ戻る', async () => {
    const bag = props()
    render(<UploadFailedPanel {...bag} />)

    await userEvent.click(screen.getByRole('button', { name: 'このまま続ける' }))

    expect(bag.onContinue).toHaveBeenCalledTimes(1)
    expect(bag.onRetry).not.toHaveBeenCalled()
  })

  it('「もう一度送る」が押せる', async () => {
    const bag = props()
    render(<UploadFailedPanel {...bag} />)

    const retry = screen.getByRole('button', { name: 'もう一度送る' })
    expect(retry).toBeEnabled()
    await userEvent.click(retry)

    expect(bag.onRetry).toHaveBeenCalledTimes(1)
  })

  it('送っている間は二度押しをさせず、読み上げにも届く', async () => {
    const bag = props({ retry: 'sending' })
    render(<UploadFailedPanel {...bag} />)

    // `disabled` にせず `aria-busy` にしてフォーカスを保つ（押下だけを握り潰す）。
    const button = screen.getByRole('button', { name: 'もう一度送る' })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(button)
    expect(bag.onRetry).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('録音を送っています…')
  })

  it('もう一度送っても駄目だったときは、端末に残っていることを繰り返す', () => {
    render(<UploadFailedPanel {...props({ retry: 'failed' })} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      '送れませんでした。録音はこの iPad に残っています。',
    )
    expect(screen.getByRole('button', { name: 'もう一度送る' })).toBeEnabled()
  })

  it('右に「確定したご予約」の 4 項目が出る', () => {
    render(<UploadFailedPanel {...props()} />)

    const side = screen.getByRole('complementary', { name: '確定したご予約' })
    expect(within(side).getByText('ご来店日時')).toBeInTheDocument()
    expect(within(side).getByText('8月27日（木）14:00 〜 15:00')).toBeInTheDocument()
    expect(within(side).getByText('メガネを新しく作る')).toBeInTheDocument()
    expect(within(side).getByText('中井 さくら 様')).toBeInTheDocument()
    expect(within(side).getByText('佐藤 美咲／視力測定機 A')).toBeInTheDocument()
  })

  it('担当も場所も決まっていないご予約でも 4 項目の形を崩さない', () => {
    render(
      <UploadFailedPanel
        {...props({
          reservation: {
            ...props().reservation,
            customerName: null,
            staffName: null,
            equipmentNames: [],
          },
        })}
      />,
    )

    const side = screen.getByRole('complementary', { name: '確定したご予約' })
    expect(within(side).getByText('お客様のお名前は伺っていません')).toBeInTheDocument()
    expect(within(side).getByText('担当が未定')).toBeInTheDocument()
  })

  it('右下の常駐表示は器から受けた 1 つだけを置く', () => {
    render(
      <UploadFailedPanel
        {...props()}
        indicator={<span data-testid="badge">録音は端末に保管中</span>}
      />,
    )

    const slot = screen.getByTestId('recording-indicator-slot')
    expect(within(slot).getByTestId('badge')).toBeInTheDocument()
    expect(screen.getAllByTestId('badge')).toHaveLength(1)
  })
})
