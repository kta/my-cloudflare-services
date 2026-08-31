import type { AnalyticsPoint, AnalyticsSeries } from '@app/contracts'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BarChart, Legend, RowBars, StackedBarChart, TargetLine } from './charts'
import { describeChart } from './describe'

/*
 * グラフの部品（P9 T-013）。承認済みモック ANALYTICS-TOP / ANALYTICS-CANCEL /
 * ANALYTICS-STAFF / ANALYTICS-WAIT の 4 枚が持つ 4 種類の描き方を 1 組で組む。
 *
 * ここが守るのは「色以外でも読める」こと —— 系列は 塗り・地模様・文字の 3 つを持ち、
 * 定休日は 0 件の棒として描かれ、欠測は棒を描かない。
 */

function point(over: Partial<AnalyticsPoint> & { key: string; label: string }): AnalyticsPoint {
  return {
    value: 0,
    secondaryValue: null,
    isClosed: false,
    isOverTarget: false,
    ...over,
  }
}

const TICKS = [0, 6, 12, 18, 24]

describe('縦棒', () => {
  it('点の数だけ棒が出て、値 0 の棒も軸の位置を保つ', () => {
    render(
      <BarChart
        ariaLabel="予約の入り具合"
        max={24}
        ticks={TICKS}
        points={[
          point({ key: '2026-08-20', label: '8/20', value: 9 }),
          point({ key: '2026-08-21', label: '8/21', value: 0 }),
          point({ key: '2026-08-22', label: '8/22', value: 16 }),
        ]}
      />,
    )
    const bars = screen.getAllByTestId('bar')
    expect(bars).toHaveLength(3)
    expect(bars[1]?.style.height).toBe('0%')
    // 0 の棒でも列そのものは残るので、軸の位置（ラベル）はずれない。
    expect(screen.getAllByTestId('column-label').map((el) => el.textContent)).toEqual([
      '8/20',
      '8/21',
      '8/22',
    ])
  })

  it('定休日の棒は 0 の高さで描かれ、ラベルに「定休」が付く', () => {
    render(
      <BarChart
        ariaLabel="予約の入り具合"
        max={24}
        ticks={TICKS}
        points={[
          point({ key: '2026-08-24', label: '8/24', value: 8 }),
          point({ key: '2026-08-25', label: '8/25', value: 0, isClosed: true }),
        ]}
      />,
    )
    const bars = screen.getAllByTestId('bar')
    expect(bars[1]?.style.height).toBe('0%')
    expect(bars[1]?.dataset.closed).toBe('true')
    expect(screen.getByText('8/25 定休')).toBeInTheDocument()
  })

  it('本日の列だけ地色が変わり、ラベルが太字になる', () => {
    render(
      <BarChart
        ariaLabel="予約の入り具合"
        max={24}
        ticks={TICKS}
        todayKey="2026-08-27"
        points={[
          point({ key: '2026-08-26', label: '8/26', value: 10 }),
          point({ key: '2026-08-27', label: '8/27', value: 12 }),
        ]}
      />,
    )
    const columns = screen.getAllByTestId('column')
    expect(columns[0]?.dataset.today).toBe('false')
    expect(columns[1]?.dataset.today).toBe('true')
    expect(columns[1]?.className).toContain('bg-pine-soft')
    const label = screen.getByText('8/27 本日')
    expect(label.className).toContain('font-bold')
  })
})

describe('積み上げ', () => {
  const series: AnalyticsSeries[] = [
    {
      name: 'お客様のご都合',
      pattern: 'solid',
      points: [point({ key: '2026-07', label: '7月', value: 20 })],
    },
    {
      name: '店舗の都合',
      pattern: 'hatch',
      points: [point({ key: '2026-07', label: '7月', value: 0 })],
    },
    {
      name: '予約の重複',
      pattern: 'dot',
      points: [point({ key: '2026-07', label: '7月', value: 5 })],
    },
  ]

  it('層の順が凡例の順と一致し、0 件の層を描かない', () => {
    render(
      <StackedBarChart
        ariaLabel="取り消しの内訳"
        max={40}
        ticks={[0, 10, 20, 30, 40]}
        columns={[{ key: '2026-07', label: '7月　25件・11.9%' }]}
        series={series}
      />,
    )
    // DOM の並びは下の層から。0 件の「店舗の都合」は 1 つも描かれない。
    expect(screen.getAllByTestId('segment').map((el) => el.dataset.series)).toEqual([
      'お客様のご都合',
      '予約の重複',
    ])
    render(<Legend items={series} />)
    expect(screen.getAllByTestId('legend-name').map((el) => el.textContent)).toEqual([
      'お客様のご都合',
      '店舗の都合',
      '予約の重複',
    ])
    // 列の見出しは呼び出し側が組んだ 1 行をそのまま出す（全角の空白も落とさない）。
    expect(screen.getByTestId('column-label').textContent).toBe('7月　25件・11.9%')
  })
})

describe('横棒', () => {
  it('最大件数の行を 100% とし、0 件の行は長さ 0 で描く', () => {
    render(
      <RowBars
        ariaLabel="担当者ごとの件数"
        rows={[
          point({ key: 'a', label: '田中', value: 96 }),
          point({ key: 'b', label: '佐藤', value: 48 }),
          point({ key: 'c', label: '新人', value: 0 }),
        ]}
      />,
    )
    const bars = screen.getAllByTestId('row-bar')
    expect(bars[0]?.style.width).toBe('100%')
    expect(bars[1]?.style.width).toBe('50%')
    expect(bars[2]?.style.width).toBe('0%')
  })
})

describe('目安線', () => {
  it('目安の値に破線が引かれ、「目安 8分」の札が線の上に出る', () => {
    render(<TargetLine label="目安 8分" bottomPercent={53.5} />)
    const line = screen.getByTestId('target-line')
    expect(line.style.bottom).toBe('53.5%')
    expect(line.className).toContain('border-dashed')
    expect(screen.getByText('目安 8分')).toBeInTheDocument()
  })
})

describe('凡例', () => {
  const items: AnalyticsSeries[] = [
    { name: '目安の内', pattern: 'solid', points: [] },
    { name: '目安を超えた時間帯', pattern: 'hatch', points: [] },
  ]

  it('どの系列も 塗り・地模様・系列名の文字 の 3 つを持つ', () => {
    render(<Legend items={items} />)
    const swatches = screen.getAllByTestId('legend-swatch')
    expect(swatches).toHaveLength(2)
    for (const swatch of swatches) {
      expect(swatch.dataset.pattern).toBeTruthy()
      expect(swatch.className).toMatch(/pattern-(solid|hatch|dot)/)
    }
    expect(screen.getByText('目安の内')).toBeInTheDocument()
    expect(screen.getByText('目安を超えた時間帯')).toBeInTheDocument()
  })

  it('塗りを外しても地模様と文字だけで系列を見分けられる', () => {
    render(<Legend items={items} />)
    const swatches = screen.getAllByTestId('legend-swatch')
    const names = screen.getAllByTestId('legend-name').map((el) => el.textContent)
    const pairs = swatches.map((swatch, i) => `${swatch.dataset.pattern}/${names[i]}`)
    expect(new Set(pairs).size).toBe(pairs.length)
  })
})

describe('代替テキスト', () => {
  it('最も多い点とその値、定休日が 0 件であること、未集計の日があることが 1 文で読める', () => {
    const text = describeChart({
      points: [
        point({ key: '2026-08-25', label: '8/25', value: 0, isClosed: true }),
        point({ key: '2026-08-29', label: '8/29', value: 17 }),
        point({ key: '2026-09-01', label: '9/1', value: 0, isClosed: true }),
      ],
      unit: '件',
      pendingDays: 2,
    })
    expect(text).toBe('最も多いのは8/29の17件、8/25と9/1は定休日で0件、2日ぶんはまだ集計中です。')
  })
})

describe('目安を超えた棒', () => {
  it('凡例が言うとおり地模様で描かれ、塗りを外しても目安の内と見分けられる', () => {
    render(
      <BarChart
        ariaLabel="時間帯ごとのお待ち時間"
        max={900}
        ticks={[0, 300, 600, 900]}
        points={[
          point({ key: '10', label: '10時台', value: 310 }),
          point({ key: '13', label: '13時台', value: 530, isOverTarget: true }),
        ]}
      />,
    )
    const bars = screen.getAllByTestId('bar')
    expect(bars[0]?.className).toContain('pattern-solid')
    expect(bars[1]?.className).toContain('pattern-hatch')
    expect(bars[1]?.className).toContain('text-danger')
  })

  it('棒の上の値は超過の列だけ太字になり、0 の列には出ない', () => {
    render(
      <BarChart
        ariaLabel="時間帯ごとのお待ち時間"
        max={900}
        ticks={[0, 300, 600, 900]}
        formatValue={(item) => (item.value > 0 ? String(item.value) : '')}
        points={[
          point({ key: '10', label: '10時台', value: 310 }),
          point({ key: '12', label: '12時台', value: 0 }),
          point({ key: '13', label: '13時台', value: 530, isOverTarget: true }),
        ]}
      />,
    )
    const values = screen.getAllByTestId('bar-value')
    expect(values.map((el) => el.textContent)).toEqual(['310', '530'])
    expect(values[0]?.className).not.toContain('font-bold')
    expect(values[1]?.className).toContain('font-bold')
  })
})
