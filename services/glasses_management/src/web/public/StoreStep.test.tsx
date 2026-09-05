import type { PublicStoreSummary } from '@app/contracts'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StoreStep } from './StoreStep'

/*
 * 工程 1「店舗を選ぶ」（承認済みモック docs/frontend/mockups/eye/images/WEB-01-STORE.png）。
 *
 * 実測（screens/WEB-01-STORE.html の <style>）:
 *   店舗の並び 間 12px・上 28px、1 件は最小高 76px・padding 16px・角 12px・縁 1px --line-strong
 *   選択中は縁 3px --brand + 地 --brand-tint + padding 14px（外形を保つ）
 *   店名 16px/700（gap 8px）／道順 13px --ink-2（上 4px）、「選択中」の札は最小高 22px・padding 1px 8px
 *
 * **モックの「近い順に3店舗を表示しています。」は採らない**（位置情報を使わない。
 * 並びは stores.sort_order。TODO 0.2 の #1）。
 */

const STORES: PublicStoreSummary[] = [
  { slug: 'ginza', name: 'EYE 銀座店', accessNote: '銀座駅 A2出口から徒歩3分' },
  { slug: 'marunouchi', name: 'EYE 丸の内店', accessNote: '東京駅 丸の内南口から徒歩5分' },
  { slug: 'shinjuku', name: 'EYE 新宿店', accessNote: '新宿駅 東口から徒歩4分' },
]

describe('店舗を選ぶ', () => {
  it('見出しは「ご希望の店舗をお選びください」で、補足は「3店舗を表示しています。」', () => {
    render(<StoreStep stores={STORES} selectedSlug={null} onSelect={vi.fn()} onNext={vi.fn()} />)

    expect(
      screen.getByRole('heading', { name: 'ご希望の店舗をお選びください' }),
    ).toBeInTheDocument()
    expect(screen.getByText('3店舗を表示しています。')).toBeInTheDocument()
    expect(screen.queryByText(/近い順/)).toBeNull()
  })

  it('店舗は登録順に並び、選ぶと「選択中」の札が付く', async () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <StoreStep stores={STORES} selectedSlug={null} onSelect={onSelect} onNext={vi.fn()} />,
    )

    const options = screen.getAllByRole('radio')
    expect(options.map((option) => option.getAttribute('value'))).toEqual([
      'ginza',
      'marunouchi',
      'shinjuku',
    ])
    expect(screen.queryByText('選択中')).toBeNull()

    await userEvent.click(screen.getByRole('radio', { name: /EYE 丸の内店/ }))
    expect(onSelect).toHaveBeenCalledWith(STORES[1])

    rerender(
      <StoreStep stores={STORES} selectedSlug="marunouchi" onSelect={onSelect} onNext={vi.fn()} />,
    )
    expect(screen.getAllByText('選択中')).toHaveLength(1)
    expect(screen.getByRole('radio', { name: /EYE 丸の内店/ })).toBeChecked()
  })

  it('slug 付きの URL で開くとその店舗が選ばれている', () => {
    // 器（PublicBookingApp）は `/w/ginza` の slug をそのまま `selectedSlug` に渡す。
    render(<StoreStep stores={STORES} selectedSlug="ginza" onSelect={vi.fn()} onNext={vi.fn()} />)

    expect(screen.getByRole('radio', { name: /EYE 銀座店/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /EYE 新宿店/ })).not.toBeChecked()
  })

  it('主操作は「銀座店で予約を進める」で、選ばれた店名がそのまま入る', async () => {
    const onNext = vi.fn()
    render(<StoreStep stores={STORES} selectedSlug="ginza" onSelect={vi.fn()} onNext={onNext} />)

    const action = screen.getByRole('button', { name: '銀座店で予約を進める' })
    expect(action).toHaveAttribute('aria-disabled', 'false')

    await userEvent.click(action)
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('公開している店舗が 0 件なら、電話番号の案内を出して工程へ進ませない', () => {
    render(<StoreStep stores={[]} selectedSlug={null} onSelect={vi.fn()} onNext={vi.fn()} />)

    expect(screen.getByText('いまはWebでご予約を承れません')).toBeInTheDocument()
    expect(screen.getByText('ご予約を受け付けている店舗がありません。')).toBeInTheDocument()
    expect(
      screen.getByText('お電話でご予約を承ります。お近くの店舗までお問い合わせください。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('button', { name: /予約を進める/ })).toBeNull()
  })
})
