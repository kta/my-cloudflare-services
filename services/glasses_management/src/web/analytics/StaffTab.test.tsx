import type { AnalyticsReport } from '@app/contracts'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsScreen } from './AnalyticsScreen'
import { makePoint, makeReport } from './fixtures'
import { StaffTab } from './StaffTab'
import { tabByKey } from './tabs'

/*
 * 担当者（P9 T-016。承認済みモック ANALYTICS-STAFF.png）。
 * 標本が足りない再来率は **0% ではなく「—」**。担当が未定は並びの最後で、
 * 件数は数字で読めるが再来は常に「—」になる。
 */

const NOW = '2026-08-27T02:08:00.000Z'
const GINZA = '11111111-2222-4333-8444-555555555555'
const MARUNOUCHI = '11111111-2222-4333-8444-666666666666'

const POINTS = [
  makePoint({ key: 'staff-misaki', label: '佐藤 美咲', value: 78, secondaryValue: 0.68 }),
  makePoint({ key: 'staff-aya', label: '中村 彩', value: 71, secondaryValue: 0.61 }),
  makePoint({ key: 'staff-daisuke', label: '山田 大輔', value: 18, secondaryValue: null }),
  makePoint({ key: 'staff-manabu', label: '小林 学', value: 0, secondaryValue: null }),
  makePoint({ key: 'unassigned', label: '担当未定', value: 9, secondaryValue: null }),
]

const REPORT = makeReport({
  metric: 'staff',
  series: [{ name: 'ご来店の受付', pattern: 'solid', points: POINTS }],
  summary: [
    { label: '合計', value: '176', unit: '件', isOverTarget: false },
    { label: '最も多い担当', value: '佐藤 美咲', unit: '', isOverTarget: false },
    { label: '担当未定', value: '9', unit: '件', isOverTarget: false },
  ],
  target: 90,
})

function renderStaff(report: AnalyticsReport = REPORT) {
  render(
    <StaffTab
      tab={tabByKey('staff')}
      report={report}
      targets={{ waitMinutes: 8, cancellationRatePercent: 10, revisitWindowDays: 90 }}
      now={NOW}
      options={{ granularity: 'day', countBy: 'visit_date' }}
      onOptionsChange={() => undefined}
    />,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('担当者ごとの件数', () => {
  it('見出しに「担当者ごとの件数」と「2026年8月／ご来店日でかぞえます　合計 176件」が出る', () => {
    renderStaff()
    expect(screen.getByRole('heading', { name: '担当者ごとの件数' })).toBeInTheDocument()
    expect(screen.getByTestId('staff-caption').textContent).toBe(
      '2026年8月／ご来店日でかぞえます　合計 176件',
    )
  })

  it('列見出しに「件数」と「90日以内の再来」が出る', () => {
    renderStaff()
    expect(screen.getByTestId('staff-columns')).toHaveTextContent('件数')
    expect(screen.getByTestId('staff-columns')).toHaveTextContent('90日以内の再来')
  })

  it('各行の件数の合計が見出しの合計と一致する', () => {
    renderStaff()
    const counts = screen.getAllByTestId('staff-count').map((cell) => Number(cell.textContent))
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(176)
  })

  it('最大件数の担当の棒が 100% になる', () => {
    renderStaff()
    expect(screen.getAllByTestId('row-bar')[0]).toHaveStyle({ width: '100%' })
  })

  it('件数 0 の担当も行として出て、棒の長さが 0 になる', () => {
    renderStaff()
    expect(screen.getByText('小林 学')).toBeInTheDocument()
    expect(screen.getAllByTestId('row-bar')[3]).toHaveStyle({ width: '0%' })
  })

  it('担当が未定の行は並びの最後に出て、件数は数字・再来は「—」になる', () => {
    renderStaff()
    const names = screen.getAllByTestId('staff-name').map((cell) => cell.textContent)
    expect(names.at(-1)).toBe('担当が未定')
    expect(screen.getAllByTestId('staff-count').at(-1)).toHaveTextContent('9')
    expect(screen.getAllByTestId('staff-revisit').at(-1)).toHaveTextContent('—')
  })

  it('標本が 20 件に満たない担当は再来が「—」になり、件数はそのまま読める', () => {
    renderStaff()
    const revisits = screen.getAllByTestId('staff-revisit').map((cell) => cell.textContent)
    expect(revisits).toEqual(['68%', '61%', '—', '—', '—'])
    expect(screen.getAllByTestId('staff-count')[2]).toHaveTextContent('18')
  })

  it('「担当が未定」は色だけでなく「担当が未定」の文字で見分けられる', () => {
    renderStaff()
    const last = screen.getAllByTestId('staff-name').at(-1)
    expect(last).toHaveTextContent('担当が未定')
    expect(last?.className).toContain('text-danger')
  })
})

describe('店舗', () => {
  it('店舗を丸の内店に変えて適用すると、銀座店だけにいる担当の行が消える', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost')
        if (url.pathname.endsWith('/targets')) {
          return new Response(
            JSON.stringify({ waitMinutes: 8, cancellationRatePercent: 10, revisitWindowDays: 90 }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        const ginza = url.searchParams.get('storeId') === GINZA
        const body = makeReport({
          metric: 'staff',
          series: [
            {
              name: 'ご来店の受付',
              pattern: 'solid',
              points: ginza
                ? POINTS
                : [
                    makePoint({
                      key: 'staff-ken',
                      label: '高橋 健',
                      value: 40,
                      secondaryValue: 0.5,
                    }),
                  ],
            },
          ],
          summary: [
            { label: '合計', value: ginza ? '176' : '40', unit: '件', isOverTarget: false },
          ],
        })
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    render(
      <AnalyticsScreen
        storeId={GINZA}
        stores={[
          { id: GINZA, name: '銀座店' },
          { id: MARUNOUCHI, name: '丸の内店' },
        ]}
        now={NOW}
        initialTab="staff"
      />,
    )
    expect(await screen.findByText('佐藤 美咲')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('店舗'), MARUNOUCHI)
    await userEvent.click(screen.getByRole('button', { name: '適用' }))
    await waitFor(() => expect(screen.queryByText('佐藤 美咲')).not.toBeInTheDocument())
    expect(screen.getByText('高橋 健')).toBeInTheDocument()
  })
})
