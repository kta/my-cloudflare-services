import { render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { VizColumnChart } from './analytics'

/*
 * 柱のグラフで「色だけが意味を持つ」ことを禁じるためのテスト。
 *
 * 承認済みモックは目標を超えた 2 本を橙と赤で塗り分けているが、色は補強でしか
 * ない。色を見分けられない読み手にも、超過した柱がどれで、目標がどこにあるかが
 * 読めなければならない。柱の上に白文字を乗せるのはコントラスト比が 2.05〜3.18 で
 * 足りないので、値は必ず柱の外へ本文色で置く。
 */

const ROWS = [
  { label: '10時', valueText: '38件', percent: 38, tone: 'plain' as const },
  { label: '14時', valueText: '93件', percent: 93, tone: 'critical' as const, exceedsTarget: true },
]

test('柱の値は柱の外へ本文色で置き、白文字を柱に乗せない', () => {
  render(<VizColumnChart label="時間帯" rows={ROWS} />)

  const chart = screen.getByRole('figure', { name: '時間帯' })
  for (const row of ROWS) {
    const value = within(chart).getByText(row.valueText)
    // 柱そのもの（`data-bar`）の中には字を置かない。
    expect(value.closest('[data-bar]')).toBeNull()
    expect(value.className).not.toContain('text-on-pine')
  }
})

test('目標線は線だけでなく語でも名乗る', () => {
  render(
    <VizColumnChart
      label="時間帯"
      rows={ROWS}
      target={{ percent: 70, label: '店舗目標 8分以内' }}
    />,
  )

  const chart = screen.getByRole('figure', { name: '時間帯' })
  expect(within(chart).getByText('店舗目標 8分以内')).toBeInTheDocument()
})

test('目標を超えた柱は色以外の符号でも超過を名乗る', () => {
  render(
    <VizColumnChart
      label="時間帯"
      rows={ROWS}
      target={{ percent: 70, label: '店舗目標 8分以内' }}
    />,
  )

  const chart = screen.getByRole('figure', { name: '時間帯' })
  // 超過した柱だけが「目標超過」を名乗り、目でも `▲` で分かる。塗りを外しても読める。
  expect(within(chart).getByLabelText('14時 93件 目標超過')).toBeInTheDocument()
  expect(within(chart).getByLabelText('10時 38件')).toBeInTheDocument()
  expect(within(chart).getAllByText('▲')).toHaveLength(1)
})

test('抑制された柱は幅も高さも残さない', () => {
  render(
    <VizColumnChart
      label="時間帯"
      rows={[{ label: '10時', valueText: '非表示', percent: 0, tone: 'plain' }]}
    />,
  )

  const bar = screen.getByRole('figure', { name: '時間帯' }).querySelector('[data-bar]')
  expect((bar as HTMLElement).style.height).toBe('0%')
  expect((bar as HTMLElement).style.width).toBe('0%')
})
