import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ImpactCard } from './ImpactCard'

/*
 * 影響カードは 3 面（設備と点検・ご来店の目的・営業時間）が同じ位置・同じ言い方で
 * 使う 1 枚。ここでは「何が読めるか」と「0 件のときに何も言わないこと」を見る。
 */

const items = [
  {
    at: '2026-08-28T01:00:00.000Z',
    label: '山口 真央 様　視力測定',
    targetType: 'reservation' as const,
    targetId: null,
  },
  {
    at: '2026-08-28T01:30:00.000Z',
    label: '川上 恵 様　新しく作る',
    targetType: 'reservation' as const,
    targetId: null,
  },
  {
    at: '2026-08-28T02:30:00.000Z',
    label: '佐々木 亮 様　視力測定',
    targetType: 'reservation' as const,
    targetId: null,
  },
]

describe('影響カード', () => {
  it('件数が 0 のとき出さず、札も赤くならない', () => {
    render(<ImpactCard title="止めると影響するご予約" items={[]} tone="danger" />)
    expect(screen.queryByText(/止めると影響するご予約/)).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('件数が 1 以上のとき見出しに件数を出し、札を赤くする', () => {
    render(<ImpactCard title="止めると影響するご予約" items={items} tone="danger" />)
    const heading = screen.getByRole('heading', { name: /止めると影響するご予約/ })
    expect(heading.textContent).toBe('止めると影響するご予約　3件')
    const card = heading.closest('section')
    expect(card?.className).toContain('bg-danger-soft')
  })

  it('1 件 1 行で日時・お客様・目的を出す', () => {
    render(<ImpactCard title="止めると影響するご予約" items={items} tone="danger" />)
    const rows = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.textContent)).toEqual([
      '8月28日（金）10:00山口 真央 様　視力測定',
      '8月28日（金）10:30川上 恵 様　新しく作る',
      '8月28日（金）11:30佐々木 亮 様　視力測定',
    ])
  })

  it('件数の変化は割り込まない知らせとして伝わる', () => {
    const { rerender } = render(
      <ImpactCard title="止めると影響するご予約" items={[]} tone="danger" />,
    )
    const live = screen.getByRole('status')
    expect(live).toBeEmptyDOMElement()
    rerender(<ImpactCard title="止めると影響するご予約" items={items} tone="danger" />)
    expect(within(screen.getByRole('status')).getByRole('heading').textContent).toBe(
      '止めると影響するご予約　3件',
    )
  })

  it('目的の面では茶色のカードになる（赤は止める操作にだけ使う）', () => {
    render(
      <ImpactCard
        title="60分に延ばすと受けられなくなるWeb枠"
        items={[
          {
            at: '2026-08-28T02:00:00.000Z',
            label: '視力測定機Aが空きません',
            targetType: 'web_slot',
            targetId: null,
          },
        ]}
        tone="note"
      />,
    )
    const card = screen.getByRole('heading').closest('section')
    expect(card?.className).toContain('bg-walkin-soft')
    expect(screen.getByRole('heading').textContent).toBe('60分に延ばすと受けられなくなるWeb枠　1件')
  })
})
