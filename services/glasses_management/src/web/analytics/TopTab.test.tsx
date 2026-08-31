import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AnalyticsScreen } from './AnalyticsScreen'
import { makePoint, makeReport } from './fixtures'
import { TopTab } from './TopTab'
import { tabByKey } from './tabs'

/*
 * 分析トップ（P9 T-014。承認済みモック ANALYTICS-TOP.png）。
 * 朝礼で最初に開く 1 枚。前後 7 日の入り具合と週の 3 行だけを出し、
 * **「名」を 1 か所も出さない**（Q-11）。
 */

/** JST 2026-08-27（木）11:08。モックの時刻。 */
const NOW = '2026-08-27T02:08:00.000Z'

const POINTS = [
  makePoint({ key: '2026-08-24', label: '8/24', value: 8 }),
  makePoint({ key: '2026-08-25', label: '8/25', value: 0, isClosed: true }),
  makePoint({ key: '2026-08-26', label: '8/26', value: 10 }),
  makePoint({ key: '2026-08-27', label: '8/27 本日', value: 12 }),
  makePoint({ key: '2026-08-28', label: '8/28', value: 11 }),
]

const REPORT = makeReport({
  metric: 'overview',
  series: [{ name: 'ご予約', pattern: 'solid', points: POINTS }],
  summary: [
    { label: '先週', value: '68', unit: '件', isOverTarget: false },
    { label: '今週', value: '72', unit: '件', isOverTarget: false },
    { label: '来週', value: '42', unit: '件', isOverTarget: false },
  ],
})

function renderTop(report = REPORT) {
  render(
    <TopTab
      tab={tabByKey('top')}
      report={report}
      targets={null}
      now={NOW}
      options={{ granularity: 'day', countBy: 'visit_date' }}
      onOptionsChange={() => undefined}
    />,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

it('グラフが 1 つだけ出る（白い箱は 1 枚）', () => {
  renderTop()
  expect(screen.getAllByRole('img')).toHaveLength(1)
})

it('見出しに「予約の入り具合」と「本日を中心に前後7日／件数・火曜は定休日です」が出る', () => {
  renderTop()
  expect(screen.getByRole('heading', { name: '予約の入り具合' })).toBeInTheDocument()
  expect(screen.getByTestId('top-caption')).toHaveTextContent(
    '本日を中心に前後7日／件数・火曜は定休日です',
  )
})

it('過ぎた月を適用したときは、見出しが「本日を中心に前後7日」と言わずその月を名のる', () => {
  // 本日を含まない期間で「本日を中心に前後7日」と書くのは嘘になる。
  renderTop(
    makeReport({
      metric: 'overview',
      from: '2026-02-01',
      to: '2026-02-28',
      series: [
        {
          name: 'ご予約',
          pattern: 'solid',
          points: [
            makePoint({ key: '2026-02-02', label: '2/2', value: 9 }),
            makePoint({ key: '2026-02-03', label: '2/3', value: 0, isClosed: true }),
          ],
        },
      ],
      summary: [],
    }),
  )
  expect(screen.getByTestId('top-caption')).toHaveTextContent('2026年2月／件数・火曜は定休日です')
})

it('本日の棒だけが「8/27 本日」の見出しで強調される', () => {
  renderTop()
  const today = screen.getAllByTestId('column').filter((column) => column.dataset.today === 'true')
  expect(today).toHaveLength(1)
  expect(today[0]).toHaveTextContent('8/27 本日')
  // 「本日」を 2 度書かない（応答のラベルと部品の印を重ねない）。
  expect(today[0]?.textContent?.match(/本日/g)).toHaveLength(1)
})

it('週の予約は 先週・今週・来週 の 3 行で、今週の行だけ色が変わる', () => {
  renderTop()
  const rows = screen.getAllByTestId('week-row')
  expect(rows.map((row) => row.dataset.week)).toEqual(['先週', '今週', '来週'])
  expect(rows[0]).toHaveTextContent('8月17日〜8月23日')
  expect(rows[1]).toHaveTextContent('8月24日〜8月30日')
  expect(rows[2]).toHaveTextContent('8月31日〜9月6日')
  expect(rows[1]?.dataset.current).toBe('true')
  expect(rows[0]?.dataset.current).toBe('false')
})

it('どの行にも「名」の数字が出ない', () => {
  renderTop()
  for (const row of screen.getAllByTestId('week-row')) {
    expect(row.textContent).not.toContain('名')
  }
  expect(document.body.textContent).not.toContain('名')
})

it('定休日は 0 件の棒として描かれ、未集計の日は棒を描かない', () => {
  renderTop()
  const closed = screen.getAllByTestId('bar').filter((bar) => bar.dataset.closed === 'true')
  expect(closed).toHaveLength(1)
  expect(closed[0]).toHaveStyle({ height: '0%' })
  // 応答に無い日（8/29 以降）は列そのものを作らない。
  expect(screen.getAllByTestId('column')).toHaveLength(POINTS.length)
})

it('未集計の日があると「2日ぶんはまだ集計中です」が 1 行だけ出る', async () => {
  const body = makeReport({
    metric: 'overview',
    series: REPORT.series,
    summary: REPORT.summary,
    pendingDays: 2,
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      const json = url.pathname.endsWith('/targets')
        ? { waitMinutes: 8, cancellationRatePercent: 10, revisitWindowDays: 90 }
        : body
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
  render(
    <AnalyticsScreen
      storeId="11111111-2222-4333-8444-555555555555"
      stores={[{ id: '11111111-2222-4333-8444-555555555555', name: '銀座店' }]}
      now={NOW}
    />,
  )
  await waitFor(() => expect(screen.getAllByText('2日ぶんはまだ集計中です')).toHaveLength(1))
})

it('読み上げの文に 最も多い日と件数・定休日が 0 件であること・未集計の日があることが入る', () => {
  renderTop(
    makeReport({
      metric: 'overview',
      series: REPORT.series,
      summary: REPORT.summary,
      pendingDays: 2,
    }),
  )
  const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
  expect(label).toContain('最も多いのは8/27の12件')
  expect(label).toContain('8/25は定休日で0件')
  expect(label).toContain('2日ぶんはまだ集計中')
})
