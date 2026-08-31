import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makePoint, makeReport } from './fixtures'
import type { AnalyticsPanelProps } from './panel'
import { SourceTab } from './SourceTab'
import { tabByKey } from './tabs'

/*
 * 予約の入口（P9 T-019。モックの無い 3 タブの 1 枚目）。
 * 既存 5 枚と同じ型 —— グラフ 1 つ＋定義の 1 行＋まとめ 3 行 —— で組めていることを固定する。
 */

const NOW = '2026-08-27T02:08:00.000Z'

function day(key: string, label: string, value: number, isClosed = false) {
  return makePoint({ key, label, value, isClosed })
}

function report() {
  return makeReport({
    metric: 'reservation_source',
    series: [
      {
        name: 'お電話',
        pattern: 'solid',
        points: [day('2026-08-03', '8/3', 6), day('2026-08-04', '8/4', 0, true)],
      },
      {
        name: '店頭',
        pattern: 'hatch',
        points: [day('2026-08-03', '8/3', 3), day('2026-08-04', '8/4', 0, true)],
      },
      {
        name: 'Web予約',
        pattern: 'dot',
        points: [day('2026-08-03', '8/3', 2), day('2026-08-04', '8/4', 0, true)],
      },
      {
        name: 'ウォークイン',
        pattern: 'solid',
        points: [day('2026-08-03', '8/3', 1), day('2026-08-04', '8/4', 0, true)],
      },
    ],
    summary: [
      { label: '合計', value: '412', unit: '件', isOverTarget: false },
      { label: '最も多い入口', value: 'お電話', unit: '', isOverTarget: false },
      { label: '1日あたり', value: '15.8', unit: '件', isOverTarget: false },
    ],
    pendingDays: 2,
  })
}

function renderTab(over: Partial<AnalyticsPanelProps> = {}) {
  render(
    <SourceTab
      tab={tabByKey('source')}
      report={report()}
      targets={null}
      now={NOW}
      options={{ granularity: 'day', countBy: 'visit_date' }}
      onOptionsChange={vi.fn()}
      {...over}
    />,
  )
}

describe('予約の入口', () => {
  it('グラフは 1 つだけ出る', () => {
    renderTab()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('入口の 4 つが積み上げの層として、サーバの順で描かれる', () => {
    renderTab()
    const names = screen
      .getAllByTestId('segment')
      .map((node) => node.getAttribute('data-series'))
      .filter((name, index, all) => all.indexOf(name) === index)
    expect(names).toEqual(['お電話', '店頭', 'Web予約', 'ウォークイン'])
  })

  it('凡例は色だけに頼らず、地模様と系列名の文字を必ず持つ', () => {
    renderTab()
    expect(screen.getAllByTestId('legend-name').map((node) => node.textContent)).toEqual([
      'お電話',
      '店頭',
      'Web予約',
      'ウォークイン',
    ])
    expect(
      screen.getAllByTestId('legend-swatch').map((node) => node.getAttribute('data-pattern')),
    ).toEqual(['solid', 'hatch', 'dot', 'solid'])
  })

  it('何を・いつを基準に・どれだけの母数で数えたかが 1 行で読める', () => {
    renderTab()
    const text = screen.getByTestId('definition').textContent ?? ''
    expect(text).toContain('ご予約の入口ごとの件数')
    expect(text).toContain('2026年8月')
    expect(text).toContain('ご来店日')
    expect(text).toContain('営業日数27日')
  })

  it('まとめはサーバの 3 行をそのまま出し、画面で割り直さない', () => {
    renderTab()
    expect(screen.getAllByTestId('summary-row')).toHaveLength(3)
    expect(screen.getAllByTestId('summary-value').map((node) => node.textContent)).toEqual([
      '412',
      'お電話',
      '15.8',
    ])
  })

  it('グラフの代替テキストが、最も多い日・定休日の 0 件・未集計を文で読ませる', () => {
    renderTab()
    const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
    expect(label).toContain('最も多いのは8/3の12件')
    expect(label).toContain('8/4は定休日で0件')
    expect(label).toContain('2日ぶんはまだ集計中')
  })

  it('人数の「名」を 1 つも出さない', () => {
    renderTab()
    expect(document.body.textContent).not.toContain('名')
  })
})
