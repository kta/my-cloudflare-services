import type { AnalyticsReport, AnalyticsSeries } from '@app/contracts'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsScreen } from './AnalyticsScreen'
import { CancelTab } from './CancelTab'
import { makePoint, makeReport } from './fixtures'
import { tabByKey } from './tabs'

/*
 * 取り消し（P9 T-018。承認済みモック ANALYTICS-CANCEL.png）。
 * 5 分類の名前は CHANGE-CANCEL の 4 択と 1 字も違えない。
 * 取消率の分母は「その期間に来店予定だった予約の総数（取消・無断を含む）」である。
 */

const NOW = '2026-08-27T02:08:00.000Z'
const GINZA = '11111111-2222-4333-8444-555555555555'
const TARGETS = { waitMinutes: 8, cancellationRatePercent: 10, revisitWindowDays: 90 } as const

/** 7月 = 19+4+4+3+7 = 37件（11.9%）／8月 = 16+3+3+3+6 = 31件（9.5%）。 */
const MONTHS = [
  { key: '2026-07', label: '7月', rate: 0.119 },
  { key: '2026-08', label: '8月', rate: 0.095 },
]

const LAYERS: readonly {
  name: string
  pattern: AnalyticsSeries['pattern']
  values: readonly number[]
}[] = [
  { name: 'お客様のご都合', pattern: 'solid', values: [19, 16] },
  { name: '店舗の都合', pattern: 'hatch', values: [4, 3] },
  { name: '予約の重複', pattern: 'dot', values: [4, 3] },
  { name: 'ご来店がなかった', pattern: 'hatch', values: [3, 3] },
  { name: 'Webからの取消', pattern: 'dot', values: [7, 6] },
]

function cancelReport(): AnalyticsReport {
  return makeReport({
    metric: 'cancellation',
    from: '2026-03-01',
    to: '2026-08-31',
    granularity: 'month',
    series: LAYERS.map((layer) => ({
      name: layer.name,
      pattern: layer.pattern,
      points: MONTHS.map((month, index) =>
        makePoint({
          key: month.key,
          label: month.label,
          value: layer.values[index] ?? 0,
          secondaryValue: month.rate,
          isOverTarget: month.rate > 0.1,
        }),
      ),
    })),
    summary: [
      { label: '取消率', value: '9.8', unit: '%', isOverTarget: false },
      { label: '取消件数', value: '186', unit: '件', isOverTarget: false },
      { label: '来店予定だった総数', value: '1898', unit: '件', isOverTarget: false },
    ],
    target: 10,
  })
}

function renderCancel(report = cancelReport()) {
  render(
    <CancelTab
      tab={tabByKey('cancel')}
      report={report}
      targets={TARGETS}
      now={NOW}
      options={{ granularity: 'month', countBy: 'visit_date' }}
      onOptionsChange={() => undefined}
    />,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('期間', () => {
  it('期間をレンジで指定でき、開始月より前の終了月を選べない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost')
        const body = url.pathname.endsWith('/targets') ? TARGETS : cancelReport()
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    render(
      <AnalyticsScreen
        storeId={GINZA}
        stores={[{ id: GINZA, name: '銀座店' }]}
        now={NOW}
        initialTab="cancel"
      />,
    )
    const start = await screen.findByLabelText('対象の期間（開始）')
    await userEvent.selectOptions(start, '2026-06')
    const end = screen.getByLabelText('対象の期間（終了）')
    const options = [...end.querySelectorAll('option')].map((option) => option.value)
    expect(options.every((value) => value >= '2026-06')).toBe(true)
  })

  it('2026年3月から2026年8月を適用すると積み上げが 6 本並ぶ', async () => {
    const six = makeReport({
      metric: 'cancellation',
      from: '2026-03-01',
      to: '2026-08-31',
      granularity: 'month',
      series: [
        {
          name: 'お客様のご都合',
          pattern: 'solid',
          points: ['3月', '4月', '5月', '6月', '7月', '8月'].map((label, index) =>
            makePoint({ key: `2026-0${index + 3}`, label, value: 10 + index }),
          ),
        },
      ],
      summary: [{ label: '取消率', value: '9.8', unit: '%', isOverTarget: false }],
      target: 10,
    })
    renderCancel(six)
    await waitFor(() => expect(screen.getAllByTestId('column-label')).toHaveLength(6))
  })
})

describe('凡例', () => {
  it('凡例は「お客様のご都合」「店舗の都合」「予約の重複」「ご来店がなかった」「Webからの取消」の 5 つになる', () => {
    renderCancel()
    expect(screen.getAllByTestId('legend-name').map((item) => item.textContent)).toEqual([
      'お客様のご都合',
      '店舗の都合',
      '予約の重複',
      'ご来店がなかった',
      'Webからの取消',
    ])
  })

  it('凡例のどれも 塗り・地模様・文字の 3 つを持ち、塗りを外しても見分けられる', () => {
    renderCancel()
    const swatches = screen.getAllByTestId('legend-swatch')
    expect(swatches).toHaveLength(5)
    expect(swatches.map((swatch) => swatch.dataset.pattern)).toEqual([
      'solid',
      'hatch',
      'dot',
      'hatch',
      'dot',
    ])
    // 同じ塗りの 2 層が同じ地模様にならない（塗りを外しても見分けられる）。
    const seen = swatches.map((swatch) => `${swatch.className}`)
    expect(new Set(seen).size).toBe(5)
  })
})

describe('棒とまとめ', () => {
  it('棒の下に「7月　37件・11.9%」のように件数と率が添う', () => {
    renderCancel()
    // 全角の空きまで見たいので textContent をそのまま比べる。
    expect(screen.getAllByTestId('column-label')[0]?.textContent).toBe('7月　37件・11.9%')
  })

  it('取消が 0 件の月は棒を描かない', () => {
    renderCancel()
    // 応答が点を返さない月は列そのものが無い（0 の棒を積み上げない）。
    expect(screen.getAllByTestId('column-label')).toHaveLength(2)
    expect(screen.getAllByTestId('segment').length).toBeGreaterThan(0)
  })

  it('まとめの取消率の行に「目安 10%以内」が併記される', () => {
    renderCancel()
    expect(screen.getByRole('heading', { name: '6か月のまとめ' })).toBeInTheDocument()
    expect(screen.getByTestId('summary-取消率')).toHaveTextContent('9.8')
    expect(screen.getByTestId('summary-取消率')).toHaveTextContent('目安 10%以内')
  })

  it('最も高い月の行にその月と「目安を超過」が添う', () => {
    renderCancel()
    const row = screen.getByTestId('summary-最も高い月')
    expect(row).toHaveTextContent('11.9')
    expect(row).toHaveTextContent('2026年7月')
    expect(row).toHaveTextContent('目安を超過')
  })

  it('取消率の分母が来店予定だった予約の総数であることが定義文から読める', () => {
    renderCancel()
    expect(screen.getByTestId('definition')).toHaveTextContent(
      '取消率の分母は、その期間に来店予定だった予約の総数（取消・無断を含む）です。',
    )
  })
})
