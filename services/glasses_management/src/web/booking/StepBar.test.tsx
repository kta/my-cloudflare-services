import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RecordingBadge } from '../recording/RecordingBadge'
import { StepBar } from './StepBar'
import type { BookingStepKey } from './steps'

/*
 * 下端の工程の帯（承認済みモック docs/frontend/mockups/eye/images/BOOK-01-DATETIME.png ほか）。
 *
 * 実測（screens/BOOK-0*.html と assets/eye.css）:
 *   .stepbar = 高さ 76px・左右 18px・要素の間 14px・上に 1px の罫
 *   .back    = 48×48px の丸・--line-strong の 1px 罫
 *   .step    = 最小高 36px・左右 14px・角 999px・14px/600
 *   .step-sep = --ink-3 の 12px
 *   .fab     = 64×64px の丸。押せないときの地は --busy
 *
 * ここで見るのは「何が読めて、何が押せるか」。寸法は e2e の突き合わせが見る。
 */

function open(current: BookingStepKey, canProceed = true, onBack = vi.fn(), onNext = vi.fn()) {
  render(
    <StepBar
      current={current}
      guard={
        canProceed
          ? { canProceed: true, blockedReason: '' }
          : { canProceed: false, blockedReason: 'お客様が決まると進めます' }
      }
      onBack={onBack}
      onNext={onNext}
      recording={<RecordingBadge state="off" elapsedSeconds={null} placement="bar" />}
    />,
  )
  return { onBack, onNext }
}

describe('工程の帯', () => {
  it('5 つの工程を順番に持ち、いまの工程に aria-current="step" が付く', () => {
    open('purpose')
    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('日時'),
      expect.stringContaining('ご来店の目的'),
      expect.stringContaining('担当と場所'),
      expect.stringContaining('お客様'),
      expect.stringContaining('ご確認'),
    ])
    expect(items[1]).toHaveAttribute('aria-current', 'step')
    expect(items[0]).not.toHaveAttribute('aria-current')
  })

  it('済んだ工程には ✓ が付き、押せる操作としては現れない', () => {
    open('slot')
    const list = screen.getByRole('list')
    const items = within(list).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('✓')
    expect(items[1]).toHaveTextContent('✓')
    expect(items[2]).not.toHaveTextContent('✓')
    expect(within(list).queryAllByRole('button')).toHaveLength(0)
  })

  it('ol の aria-label が「予約の工程　全5工程」で、読み上げで順番が分かる', () => {
    open('datetime')
    const list = screen.getByRole('list', { name: '予約の工程　全5工程' })
    expect(list.tagName).toBe('OL')
    // いまの工程は順番も読ませる（AC-BOOK-19）。
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('全5工程のうち1つ目')
  })

  it('戻るのは左端の ‹ だけで、押すと 1 つ前の工程へ戻る', async () => {
    const { onBack } = open('purpose')
    const bar = screen.getByRole('contentinfo')
    // 帯の中で押せるのは「前へ戻る」と「次へ進む」の 2 つだけ。
    expect(within(bar).getAllByRole('button')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: '前へ戻る' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('最初の工程では ‹ が押せず、その理由が読み上げで分かる', () => {
    open('datetime')
    expect(screen.getByRole('button', { name: '前へ戻る　最初の工程です' })).toBeDisabled()
  })
})

describe('次へ進む', () => {
  it('押せるときは「次へ進む」だけを名前に持つ', async () => {
    const { onNext } = open('datetime')
    const next = screen.getByRole('button', { name: '次へ進む' })
    expect(next).toBeEnabled()
    await userEvent.click(next)
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('押せないときは理由を名前に持ち、色だけで伝えない', () => {
    open('customer', false)
    const next = screen.getByRole('button', {
      name: '次へ進む　お客様が決まると進めます',
    })
    expect(next).toBeDisabled()
  })
})

describe('録音の表示', () => {
  it('帯の中に置かれ、録音していないことを文字でも伝える', () => {
    open('datetime')
    const badge = within(screen.getByRole('contentinfo')).getByRole('status')
    expect(badge).toHaveTextContent('録音していません')
    // 数えていないのに時計の枠だけ置くと、壊れているように読まれる（UX 監査 REC-04）。
    expect(badge).not.toHaveTextContent('--:--')
  })
})
