import type { AnalyticsPoint } from '@app/contracts'
import { Legend, StackedBarChart } from './charts'
import { chartTicks, describeChart, describeTab } from './describe'
import type { AnalyticsPanelProps } from './panel'
import { SummaryList } from './SummaryList'

/*
 * 予約の入口（P9 T-019）。**モックの無い 3 タブ**の 1 枚目。
 *
 * 承認済みモックが 1 枚も無いので、既存 5 枚と同じ型で組む —
 * グラフ 1 つ＋「何を、いつを基準に、どれだけの母数で数えたか」の 1 行＋まとめ 3 行。
 * 空いた場所を埋めるために要素を足さない。
 *
 * 入口は 4 つ（お電話・店頭・Web予約・ウォークイン）でサーバが層を組んで返す。
 * **層は色だけで伝えない**ので、凡例に地模様と系列名の文字を必ず添える。
 */

/** 層をまたいだ列の合計。読み上げ文はこの合計で作る（1 本の棒として読ませる）。 */
function columnTotals(series: AnalyticsPanelProps['report']['series']): AnalyticsPoint[] {
  const first = series[0]?.points ?? []
  return first.map((point) => ({
    ...point,
    value: series.reduce(
      (sum, layer) =>
        sum + (layer.points.find((candidate) => candidate.key === point.key)?.value ?? 0),
      0,
    ),
  }))
}

export function SourceTab({ tab, report }: AnalyticsPanelProps) {
  const totals = columnTotals(report.series)
  const { ticks, max } = chartTicks(totals.reduce((top, point) => Math.max(top, point.value), 0))
  const columns = totals.map((point) => ({ key: point.key, label: point.label }))
  const legend = report.series.map((series) => ({ name: series.name, pattern: series.pattern }))

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-panel border border-line bg-surface px-4 py-5 sm:px-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-3">
          <h3 className="m-0 text-title font-bold text-ink">予約の入口</h3>
          <span data-testid="source-caption" className="text-grid text-ink-muted">
            入口ごとの積み上げ／件数
          </span>
        </div>
        <StackedBarChart
          ariaLabel={describeChart({
            points: totals,
            unit: '件',
            pendingDays: report.pendingDays,
          })}
          columns={columns}
          series={report.series}
          ticks={ticks}
          max={max}
          tones={['pine', 'pine', 'web', 'danger']}
        />
        <div className="mt-4">
          <Legend items={legend} tones={['pine', 'pine', 'web', 'danger']} />
        </div>
      </section>

      <p data-testid="definition" className="text-grid text-ink-muted">
        {describeTab(tab, report)}
      </p>

      <SummaryList rows={report.summary} />
    </div>
  )
}
