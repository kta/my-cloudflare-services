import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makePoint, makeReport } from './fixtures'
import type { AnalyticsPanelProps } from './panel'
import { tabByKey } from './tabs'
import { VisitsTab } from './VisitsTab'

/*
 * 来店回数（P9 T-019。モックの無い 3 タブの 2 枚目）。
 * 4 階級は**件数 0 の階級も行として出す**（その階級が 0 だったことが情報である）。
 */

const NOW = '2026-08-27T02:08:00.000Z'

function report() {
  return makeReport({
    metric: 'visit_frequency',
    series: [
      {
        name: 'ご来店の回数',
        pattern: 'solid',
        points: [
          makePoint({ key: 'first', label: '初めて', value: 96 }),
          makePoint({ key: 'second', label: '2回目', value: 74 }),
          makePoint({ key: 'third_to_fifth', label: '3〜5回', value: 128 }),
          makePoint({ key: 'sixth_plus', label: '6回以上', value: 0 }),
        ],
      },
    ],
    summary: [
      { label: '合計', value: '298', unit: '件', isOverTarget: false },
      { label: '初めて', value: '96', unit: '件', isOverTarget: false },
      { label: '6回以上', value: '0', unit: '件', isOverTarget: false },
    ],
  })
}

function renderTab(over: Partial<AnalyticsPanelProps> = {}) {
  render(
    <VisitsTab
      tab={tabByKey('visits')}
      report={report()}
      targets={null}
      now={NOW}
      options={{ granularity: 'day', countBy: 'visit_date' }}
      onOptionsChange={vi.fn()}
      {...over}
    />,
  )
}

describe('来店回数', () => {
  it('グラフは 1 つだけ出る', () => {
    renderTab()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('4 階級が決まった順で並び、件数 0 の階級も行として出る', () => {
    renderTab()
    expect(screen.getAllByTestId('visits-class').map((node) => node.textContent)).toEqual([
      '初めて',
      '2回目',
      '3〜5回',
      '6回以上',
    ])
    expect(screen.getAllByTestId('visits-count').map((node) => node.textContent)).toEqual([
      '96',
      '74',
      '128',
      '0',
    ])
  })

  it('何を・いつを基準に・どれだけの母数で数えたかが 1 行で読める', () => {
    renderTab()
    const text = screen.getByTestId('definition').textContent ?? ''
    expect(text).toContain('ご来店の回数ごとの件数')
    expect(text).toContain('2026年8月')
    expect(text).toContain('母数298件')
  })

  it('まとめはサーバの 3 行をそのまま出す', () => {
    renderTab()
    expect(screen.getAllByTestId('summary-row')).toHaveLength(3)
    expect(screen.getAllByTestId('summary-value').map((node) => node.textContent)).toEqual([
      '298',
      '96',
      '0',
    ])
  })

  it('グラフの代替テキストが、最も多い階級と件数を文で読ませる', () => {
    renderTab()
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain(
      '最も多いのは3〜5回の128件',
    )
  })

  it('人数の「名」を 1 つも出さない', () => {
    renderTab()
    expect(document.body.textContent).not.toContain('名')
  })
})
