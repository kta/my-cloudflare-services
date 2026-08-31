import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makePoint, makeReport } from './fixtures'
import { PurposeTab } from './PurposeTab'
import type { AnalyticsPanelProps } from './panel'
import { tabByKey } from './tabs'

/*
 * ご来店の目的（P9 T-019。モックの無い 3 タブの 3 枚目）。
 * 並びはサーバが決めた順（件数の多い順）をそのまま使い、画面で並べ替えない。
 */

const NOW = '2026-08-27T02:08:00.000Z'

function report() {
  return makeReport({
    metric: 'purpose',
    series: [
      {
        name: 'ご来店の目的',
        pattern: 'solid',
        points: [
          makePoint({ key: 'p-exam', label: '視力測定', value: 142 }),
          makePoint({ key: 'p-repair', label: '修理', value: 61 }),
          makePoint({ key: 'p-gone', label: '（削除されたご用件）', value: 0 }),
        ],
      },
    ],
    summary: [
      { label: '合計', value: '203', unit: '件', isOverTarget: false },
      { label: '最も多いご用件', value: '視力測定', unit: '', isOverTarget: false },
      { label: 'ご用件の数', value: '3', unit: '件', isOverTarget: false },
    ],
  })
}

function renderTab(over: Partial<AnalyticsPanelProps> = {}) {
  render(
    <PurposeTab
      tab={tabByKey('purpose')}
      report={report()}
      targets={null}
      now={NOW}
      options={{ granularity: 'day', countBy: 'visit_date' }}
      onOptionsChange={vi.fn()}
      {...over}
    />,
  )
}

describe('ご来店の目的', () => {
  it('グラフは 1 つだけ出る', () => {
    renderTab()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('サーバの順のまま並び、件数 0 のご用件も行として出る', () => {
    renderTab()
    expect(screen.getAllByTestId('purpose-name').map((node) => node.textContent)).toEqual([
      '視力測定',
      '修理',
      '（削除されたご用件）',
    ])
    expect(screen.getAllByTestId('purpose-count').map((node) => node.textContent)).toEqual([
      '142',
      '61',
      '0',
    ])
  })

  it('何を・いつを基準に・どれだけの母数で数えたかが 1 行で読める', () => {
    renderTab()
    const text = screen.getByTestId('definition').textContent ?? ''
    expect(text).toContain('ご来店の目的ごとの件数')
    expect(text).toContain('ご来店日')
    expect(text).toContain('母数203件')
  })

  it('まとめはサーバの 3 行をそのまま出す', () => {
    renderTab()
    expect(screen.getAllByTestId('summary-row')).toHaveLength(3)
    expect(screen.getAllByTestId('summary-value').map((node) => node.textContent)).toEqual([
      '203',
      '視力測定',
      '3',
    ])
  })

  it('グラフの代替テキストが、最も多いご用件と件数を文で読ませる', () => {
    renderTab()
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain(
      '最も多いのは視力測定の142件',
    )
  })

  it('人数の「名」を 1 つも出さない', () => {
    renderTab()
    expect(document.body.textContent).not.toContain('名')
  })
})
