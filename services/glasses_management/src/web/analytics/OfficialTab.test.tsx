import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VerticalBars } from './OfficialTab'

/*
 * 棒は軸の上に立ち、日付は軸の外に出す。
 *
 * 以前は日付のラベルが棒と同じ箱の中にあり、棒はその高さぶん軸から浮いていた
 * （実測: 軸 y=523 に対して棒の底が y=488。**35px の隙間**）。
 * 承認済みモック ANALYTICS-TOP.png は棒を軸に接地させ、日付を軸線の下へ置き、
 * 値のラベルを 1 つも書かない（UX 監査 UI-08）。
 */

const POINTS = [
  { label: '8/24', value: 0, secondaryValue: null },
  { label: '8/25', value: 0, secondaryValue: null, isClosed: true },
  { label: '8/26', value: 10, secondaryValue: null },
  { label: '8/27', value: 12, secondaryValue: null },
]

function chart() {
  render(
    <VerticalBars
      points={POINTS}
      ariaLabel="予約の入り具合"
      todayLabel="8/27"
      ticks={[24, 18, 12, 6, 0]}
      target={24}
    />,
  )
  return screen.getByRole('img', { name: '予約の入り具合' })
}

describe('予約の入り具合のグラフ', () => {
  it('棒を置く箱には棒しか入れない（日付を入れると棒が軸から浮く）', () => {
    const plot = chart().querySelector('[data-chart-plot]')
    expect(plot).not.toBeNull()
    expect(plot?.textContent).not.toMatch(/8\/2\d/)
  })

  it('棒の上に値のラベルを書かない（数字は目盛だけ）', () => {
    const plot = chart().querySelector('[data-chart-plot]')
    const gridlines = plot?.querySelector('[data-testid="chart-gridlines"]')
    // 目盛の外に残る数字は 0 個。10 や 12 のような値のラベルを出さない。
    const numbers = Array.from(plot?.querySelectorAll('span') ?? [])
      .filter((node) => gridlines === null || !gridlines?.contains(node))
      .filter((node) => /^\d+$/.test(node.textContent?.trim() ?? ''))
    expect(numbers.map((n) => n.textContent)).toEqual([])
  })

  it('日付は軸線の下に、点の数だけ並ぶ', () => {
    chart()
    for (const label of ['8/24', '8/26']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('本日は日付に「本日」を添える', () => {
    chart()
    expect(screen.getByText('8/27 本日')).toBeInTheDocument()
  })

  it('定休日は軸の下のラベルで「定休」と言う', () => {
    chart()
    expect(screen.getByText('8/25 定休')).toBeInTheDocument()
  })

  it('本日の帯はグラフの高さいっぱいに通す', () => {
    const band = chart().querySelector('[data-chart-today]')
    expect(band?.className).toContain('h-full')
  })

  it('0 件の日は棒の高さが 0 になる（軸の上に浮かせない）', () => {
    const plot = chart().querySelector('[data-chart-plot]')
    const bars = Array.from(plot?.querySelectorAll('span[aria-hidden="true"]') ?? [])
    expect((bars[0] as HTMLElement).style.height).toBe('0%')
  })
})

/*
 * 目盛の線は棒の背面に敷く。手前に描くと、1 本の棒が線の数だけ分断されて見える
 * （実測: 72 の棒が 20/40/60 の線で 4 本に割れていた。UX 監査 UI-08）。
 */
describe('目盛の線と棒の前後', () => {
  it('目盛は背面（z-0）に敷く', () => {
    const grid = chart().querySelector('[data-testid="chart-gridlines"]')
    expect(grid?.className).toContain('z-0')
  })

  it('棒の列は目盛より手前（z-10）に置く', () => {
    const plot = chart().querySelector('[data-chart-plot]')
    const column = plot?.querySelector('[data-chart-today]')
    expect(column?.className).toContain('z-10')
  })
})

describe('目盛より多い日', () => {
  /*
   * 決め打ちの目盛（モックの 0/6/12/18/24）をそのまま当てていたころ、25 件以上の日は
   * 棒が天井を突き抜けて枠の外へ出ていた（実装不足の洗い出し analytics-02）。
   * 越えた日は目盛のほうを取り直す —— 棒を切るより、軸を伸ばすほうが読み違えない。
   */
  function tallChart() {
    render(
      <VerticalBars
        points={[
          { label: '8/26', value: 10, secondaryValue: null },
          { label: '8/27', value: 30, secondaryValue: null },
        ]}
        ariaLabel="予約の入り具合"
        ticks={[24, 18, 12, 6, 0]}
        target={24}
      />,
    )
    return screen.getByRole('img', { name: '予約の入り具合' })
  }

  it('目盛の天井が 24 より上へ伸びる', () => {
    const view = tallChart()
    expect(within(view).queryByText('24')).toBeNull()
    // 30 を収める目盛（`niceTicks`）に取り替わる。
    expect(within(view).getByText('40')).toBeVisible()
  })

  it('どの棒も枠の外へ出ない', () => {
    const view = tallChart()
    for (const bar of view.querySelectorAll('[data-chart-bar]')) {
      const height = Number.parseFloat((bar as HTMLElement).style.height)
      expect(height).toBeLessThanOrEqual(100)
    }
  })
})
