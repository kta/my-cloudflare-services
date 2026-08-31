import type { AnalyticsReport } from '@app/contracts'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsScreen } from './AnalyticsScreen'
import { CountTab } from './CountTab'
import { makePoint, makeReport } from './fixtures'
import { tabByKey } from './tabs'

/*
 * 予約数（P9 T-015。承認済みモック ANALYTICS-COUNT.png）。
 * 切り口の 2 群はキーボードだけで切り替えられ、**「適用」を押すまで数字は動かない**。
 * グラフの下は 3 つだけで、4 つ目を置かない。
 */

const NOW = '2026-08-27T02:08:00.000Z'
const GINZA = '11111111-2222-4333-8444-555555555555'

const REPORT = makeReport({
  metric: 'reservation_count',
  series: [
    {
      name: 'ご予約の件数',
      pattern: 'solid',
      points: [
        makePoint({ key: '2026-08-03', label: '8/3', value: 16 }),
        makePoint({ key: '2026-08-04', label: '8/4', value: 0, isClosed: true }),
        makePoint({ key: '2026-08-11', label: '8/11', value: 0, isClosed: true }),
      ],
    },
  ],
  summary: [
    { label: '合計', value: '320', unit: '件', isOverTarget: false },
    { label: '1日あたり', value: '12.3', unit: '件', isOverTarget: false },
    { label: '最も多い日', value: '8/15', unit: '', isOverTarget: false },
  ],
})

function renderCount(report: AnalyticsReport = REPORT, onOptionsChange = vi.fn()) {
  render(
    <CountTab
      tab={tabByKey('count')}
      report={report}
      targets={null}
      now={NOW}
      options={{ granularity: report.granularity, countBy: report.countBy }}
      onOptionsChange={onOptionsChange}
    />,
  )
  return onOptionsChange
}

/** 器ごと立てて「適用」の作法まで確かめる。合計は切り口で変わる。 */
function mockApi() {
  const calls: URLSearchParams[] = []
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
      calls.push(url.searchParams)
      const countBy =
        url.searchParams.get('countBy') === 'received_date' ? 'received_date' : 'visit_date'
      const granularity = url.searchParams.get('granularity') ?? 'day'
      const body = makeReport({
        metric: 'reservation_count',
        granularity: granularity as AnalyticsReport['granularity'],
        countBy,
        series: [
          {
            name: 'ご予約の件数',
            pattern: 'solid',
            points:
              granularity === 'hour'
                ? [makePoint({ key: '10', label: '10時', value: 20 })]
                : [makePoint({ key: '2026-08-03', label: '8/3', value: 16 })],
          },
        ],
        summary: [
          {
            label: '合計',
            value: countBy === 'received_date' ? '311' : '320',
            unit: '件',
            isOverTarget: false,
          },
          { label: '1日あたり', value: '12.3', unit: '件', isOverTarget: false },
          { label: '最も多い日', value: '8/15', unit: '', isOverTarget: false },
        ],
      })
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
  return calls
}

async function openCountTab() {
  const calls = mockApi()
  render(<AnalyticsScreen storeId={GINZA} stores={[{ id: GINZA, name: '銀座店' }]} now={NOW} />)
  await userEvent.click(await screen.findByRole('tab', { name: '予約数' }))
  await waitFor(() =>
    expect(screen.getByRole('radiogroup', { name: '集計の種類' })).toBeInTheDocument(),
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('切り口', () => {
  it('集計の種類は 日別・月別・時間帯別・曜日別 の 4 択で、いま選ばれている 1 つが読み上げで分かる', () => {
    renderCount()
    const group = screen.getByRole('radiogroup', { name: '集計の種類' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['日別', '月別', '時間帯別', '曜日別'])
    expect(within(group).getByRole('radio', { name: '日別' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('かぞえる日は ご来店日・受付日 の 2 択で、群に「かぞえる日」の名前が付く', () => {
    renderCount()
    const group = screen.getByRole('radiogroup', { name: 'かぞえる日' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['ご来店日', '受付日'])
  })

  it('矢印キーだけで選び替えられ、Tab では群を 1 つ飛び越す（roving tabindex）', async () => {
    const onOptionsChange = renderCount()
    const group = screen.getByRole('radiogroup', { name: '集計の種類' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1, -1])
    radios[0]?.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onOptionsChange).toHaveBeenCalledWith({ granularity: 'month' })
  })
})

describe('適用', () => {
  it('かぞえる日を 受付日 に変えて適用すると、同じ月でも合計が変わる', async () => {
    const calls = await openCountTab()
    expect(screen.getByTestId('summary-合計')).toHaveTextContent('320')
    await userEvent.click(screen.getByRole('radio', { name: '受付日' }))
    expect(screen.getByTestId('summary-合計')).toHaveTextContent('320')
    await userEvent.click(screen.getByRole('button', { name: '適用' }))
    await waitFor(() => expect(screen.getByTestId('summary-合計')).toHaveTextContent('311'))
    expect(calls.at(-1)?.get('countBy')).toBe('received_date')
  })

  it('集計の種類を 時間帯別 に変えて適用すると、横軸が「10時台」「11時台」に変わる', async () => {
    await openCountTab()
    await userEvent.click(screen.getByRole('radio', { name: '時間帯別' }))
    await userEvent.click(screen.getByRole('button', { name: '適用' }))
    await waitFor(() => expect(screen.getByTestId('column-label')).toHaveTextContent('10時台'))
  })
})

describe('まとめ', () => {
  it('グラフの下は 8月の合計・1日あたり・最も多い日 の 3 つだけで、4 つ目を置かない', () => {
    renderCount()
    expect(screen.getAllByTestId('summary-label').map((row) => row.textContent)).toEqual([
      '8月の合計',
      '1日あたり',
      '最も多い日',
    ])
  })

  it('1日あたりは 合計 ÷ 営業日数 で、営業日数が定義文から読める', () => {
    renderCount()
    expect(screen.getByTestId('summary-1日あたり')).toHaveTextContent('12.3')
    expect(screen.getByTestId('definition')).toHaveTextContent('営業日数27日')
    expect(screen.getByTestId('definition')).toHaveTextContent(
      '「1日あたり」の分母はこの営業日数です',
    )
  })

  it('合計に「名」を添えない', () => {
    renderCount()
    expect(document.body.textContent).not.toContain('名')
  })
})
