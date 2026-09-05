import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { missingSetup, type SetupCounts, SetupProgress } from './SetupProgress'

const READY: SetupCounts = { stores: 1, staff: 3, terminals: 2, purposes: 3 }
const FRESH: SetupCounts = { stores: 1, staff: 0, terminals: 0, purposes: 3 }

function renderWith(counts: SetupCounts) {
  const handlers = {
    onOpenSettings: vi.fn(),
    onOpenTerminals: vi.fn(),
  }
  render(<SetupProgress counts={counts} {...handlers} />)
  return handlers
}

describe('SetupProgress', () => {
  it('揃っていれば何も出さない（毎日見る面を数字で埋めない）', () => {
    const { container } = render(
      <SetupProgress counts={READY} onOpenSettings={vi.fn()} onOpenTerminals={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('数がまだ分からない間は何も出さない（0 と言わない）', () => {
    const { container } = render(
      <SetupProgress counts={null} onOpenSettings={vi.fn()} onOpenTerminals={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('足りないものがある間だけ出し、消えることを予告する', () => {
    renderWith(FRESH)
    expect(screen.getByRole('region', { name: 'はじめの設定' })).toBeInTheDocument()
    expect(screen.getByText('あと2つです。揃うとこの案内は消えます。')).toBeInTheDocument()
  })

  it('足りないものへ、その場から行ける', () => {
    const handlers = renderWith(FRESH)

    fireEvent.click(screen.getByRole('button', { name: '店員 0　店員を登録する' }))
    expect(handlers.onOpenSettings).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '端末 0　端末を登録する' }))
    expect(handlers.onOpenTerminals).toHaveBeenCalled()
  })

  it('揃っているものは数え上げない（やることだけを出す）', () => {
    renderWith(FRESH)
    expect(screen.queryByText('お店')).toBeNull()
    expect(screen.queryByText('ご来店の目的')).toBeNull()
  })

  it('片方だけ足りなければ、その 1 枚だけを出す', () => {
    renderWith({ ...READY, terminals: 0 })
    expect(screen.getByText('あと1つです。揃うとこの案内は消えます。')).toBeInTheDocument()
    expect(screen.getByText('端末')).toBeInTheDocument()
    expect(screen.queryByText('店員')).toBeNull()
  })

  it('足りないものだけを挙げる', () => {
    expect(missingSetup(FRESH)).toEqual(['staff', 'terminals'])
    expect(missingSetup({ ...READY, staff: 0 })).toEqual(['staff'])
    expect(missingSetup(READY)).toEqual([])
  })
})
