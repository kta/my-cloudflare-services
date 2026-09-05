import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState, LoadingState } from './EmptyState'

/*
 * 空・読み込み中・失敗の 3 状態は、**文字を読まなくても形で見分けられる**こと。
 * 以前はどれも白い面に灰色の文字が浮くだけで、読むまで区別が付かなかった
 * （UX 監査 UI-10）。
 */
describe('何も無い面', () => {
  it('何が無いかを見出しで言い、横中央に置く', () => {
    render(<EmptyState title="ご来店中のお客様はいません" />)
    const box = screen.getByRole('status')
    expect(box).toHaveTextContent('ご来店中のお客様はいません')
    expect(box.className).toContain('justify-items-center')
    expect(box.className).toContain('text-center')
  })

  it('見出しは本文より 1 段大きい', () => {
    render(
      <EmptyState title="ご来店中のお客様はいません" note="まだどなたもお着きになっていません。" />,
    )
    expect(screen.getByRole('heading', { level: 2 }).className).toContain('text-title')
  })

  it('いまの条件を添えられる', () => {
    render(<EmptyState title="ありません" note="8月25日 〜 8月26日 で 0件でした。" />)
    expect(screen.getByRole('status')).toHaveTextContent('8月25日 〜 8月26日 で 0件でした。')
  })

  it('復帰の手段を置ける（行き止まりを作らない）', () => {
    render(
      <EmptyState title="ありません">
        <button type="button">絞り込みをすべて外す</button>
      </EmptyState>,
    )
    expect(screen.getByRole('button', { name: '絞り込みをすべて外す' })).toBeInTheDocument()
  })
})

describe('読み込み中の面', () => {
  it('中身の形をした板を並べる（空の面と形で見分ける）', () => {
    const { container } = render(<LoadingState label="受付履歴を読み込んでいます…" />)
    expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(4)
    expect(container.querySelector('[data-empty-state]')).toBeNull()
  })

  it('読み上げには何を読み込んでいるかを伝える', () => {
    render(<LoadingState label="受付履歴を読み込んでいます…" />)
    expect(screen.getByRole('status')).toHaveTextContent('受付履歴を読み込んでいます…')
  })

  it('板そのものは読み上げに出さない（飾りである）', () => {
    const { container } = render(<LoadingState label="読み込んでいます…" />)
    for (const row of Array.from(container.querySelectorAll('[data-skeleton-row]'))) {
      expect(row.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('行の数を変えられる', () => {
    const { container } = render(<LoadingState label="読み込んでいます…" rows={7} />)
    expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(7)
  })
})
