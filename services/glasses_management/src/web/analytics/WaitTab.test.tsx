import type { AnalyticsReport } from '@app/contracts'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makePoint, makeReport } from './fixtures'
import { tabByKey } from './tabs'
import { WaitTab } from './WaitTab'

/*
 * お待ち時間（P9 T-017。承認済みモック ANALYTICS-WAIT.png）。
 * 主役は**中央値**（平均は出さない）。目安 8 分の超過は色と文字の両方で示し、
 * **8 分ちょうどでは超過にしない**（8 分 1 秒で超過にする）。
 */

const NOW = '2026-08-27T02:08:00.000Z'
const TARGETS = { waitMinutes: 8, cancellationRatePercent: 10, revisitWindowDays: 90 } as const

function reportWith(median: string, over: boolean, points = POINTS): AnalyticsReport {
  return makeReport({
    metric: 'wait_time',
    granularity: 'hour',
    series: [{ name: 'お待ち時間の中央値', pattern: 'solid', points }],
    summary: [
      { label: '中央値', value: median, unit: '', isOverTarget: over },
      { label: '前の月の中央値', value: '7分20秒', unit: '', isOverTarget: false },
      { label: '受付', value: '328', unit: '件', isOverTarget: false },
    ],
    target: 480,
  })
}

const POINTS = [
  makePoint({ key: '10', label: '10時', value: 310 }),
  makePoint({ key: '11', label: '11時', value: 460 }),
  makePoint({ key: '13', label: '13時', value: 530, isOverTarget: true }),
]

function renderWait(report: AnalyticsReport) {
  render(
    <WaitTab
      tab={tabByKey('wait')}
      report={report}
      targets={TARGETS}
      now={NOW}
      options={{ granularity: 'hour', countBy: 'visit_date' }}
      onOptionsChange={() => undefined}
    />,
  )
}

describe('中央値', () => {
  it('見出し「受付からご相談開始まで（中央値）」の下に中央値が大きく出る', () => {
    renderWait(reportWith('8分40秒', true))
    expect(screen.getByText('受付からご相談開始まで（中央値）')).toBeInTheDocument()
    expect(screen.getByTestId('wait-median')).toHaveTextContent('8分40秒')
  })

  it('前の月の中央値と「2026年8月・受付 328件」の母数が添えられる', () => {
    renderWait(reportWith('8分40秒', true))
    expect(screen.getByTestId('wait-note')).toHaveTextContent(
      '前の月は 7分20秒／2026年8月・受付 328件',
    )
  })

  it('中央値が 8分ちょうどの月では「目安 8分を超えています」の札が出ない', () => {
    renderWait(reportWith('8分0秒', false))
    expect(screen.queryByText('目安 8分を超えています')).not.toBeInTheDocument()
    expect(screen.getByTestId('wait-median').className).not.toContain('text-danger')
  })

  it('中央値が 8分1秒の月では札が出る', () => {
    renderWait(reportWith('8分1秒', true))
    expect(screen.getByText('目安 8分を超えています')).toBeInTheDocument()
    expect(screen.getByTestId('wait-median').className).toContain('text-danger')
  })
})

describe('グラフ', () => {
  it('目安 8分の破線と「目安 8分」の札がグラフに出る', () => {
    renderWait(reportWith('8分40秒', true))
    expect(screen.getByTestId('target-line')).toBeInTheDocument()
    expect(screen.getByText('目安 8分')).toBeInTheDocument()
  })

  it('目安を超えた時間帯は 色と文字の両方で示される', () => {
    renderWait(reportWith('8分40秒', true))
    const labels = screen.getAllByTestId('column-label').map((label) => label.textContent)
    expect(labels).toContain('13時台 目安超過')
    const bars = screen.getAllByTestId('bar')
    expect(bars.at(-1)?.className).toContain('text-danger')
  })

  it('凡例は「目安の内」「目安を超えた時間帯」の 2 つで、塗り・地模様・文字の 3 つを持つ', () => {
    renderWait(reportWith('8分40秒', true))
    expect(screen.getAllByTestId('legend-name').map((item) => item.textContent)).toEqual([
      '目安の内',
      '目安を超えた時間帯',
    ])
    const swatches = screen.getAllByTestId('legend-swatch')
    expect(swatches.map((swatch) => swatch.dataset.pattern)).toEqual(['solid', 'hatch'])
  })

  it('受付 0 件の時間帯は棒を描かず、横軸の見出しだけ残して「0件」を添える', () => {
    renderWait(reportWith('8分40秒', true))
    const labels = screen.getAllByTestId('column-label').map((label) => label.textContent)
    expect(labels).toEqual(['10時台', '11時台', '12時台 0件', '13時台 目安超過'])
    const bars = screen.getAllByTestId('bar')
    expect(bars[2]).toHaveStyle({ height: '0%' })
  })

  it('読み上げの文に 最も長い時間帯とその値・目安を超えていることが入る', () => {
    renderWait(reportWith('8分40秒', true))
    const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
    expect(label).toContain('最も長いのは13時台の8分50秒')
    expect(label).toContain('目安 8分を超えています')
  })
})

describe('棒の上の値', () => {
  it('時間帯ごとの中央値が「5:10」の形で棒の上に乗る（モックの実測）', () => {
    renderWait(reportWith('8分40秒', true))
    expect(screen.getAllByTestId('bar-value').map((el) => el.textContent)).toEqual([
      '5:10',
      '7:40',
      '8:50',
    ])
  })

  it('受付 0 件の時間帯には値を書かない（0:00 と読ませない）', () => {
    renderWait(reportWith('8分40秒', true))
    expect(screen.queryByText('0:00')).not.toBeInTheDocument()
  })
})
