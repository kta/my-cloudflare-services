import { BarChart, type ChartSeries, niceTicks, RowBars } from './charts'
import type { AnalyticsTabKey } from './tabs'

export type AnalyticsSummaryItem = {
  label: string
  value: string
  unit: string
  isOverTarget: boolean
}

export function SimpleTab({
  tab,
  definition,
  series,
  summary,
}: {
  tab: Extract<AnalyticsTabKey, 'source' | 'visits' | 'purpose'>
  definition: string
  series: readonly ChartSeries[]
  summary: readonly AnalyticsSummaryItem[]
}) {
  const title =
    tab === 'source'
      ? '入口ごとの予約数'
      : tab === 'visits'
        ? '来店回数ごとの受付'
        : '目的ごとの予約数'
  const summaryLabel = `${tab === 'source' ? '予約の入口' : tab === 'visits' ? '来店回数' : 'ご来店の目的'}のまとめ`
  const isEmpty = series.flatMap((entry) => entry.points).every((point) => point.value === 0)
  const emptyMessage =
    tab === 'source'
      ? 'この期間に予約の入口の件数はありません。'
      : tab === 'visits'
        ? 'この期間に来店回数ごとの受付はありません。'
        : 'この期間にご来店の目的ごとの件数はありません。'
  const ariaLabel = `${title}。${series
    .flatMap((entry) => entry.points.map((point) => `${point.label} ${point.value}件`))
    .join('、')}。`
  const maximum = Math.max(
    tab === 'source' ? 160 : tab === 'visits' ? 120 : 1,
    ...series.flatMap((entry) => entry.points.map((point) => point.value)),
  )
  const ticks = tab === 'purpose' ? undefined : niceTicks(maximum)
  return (
    <div className="grid min-w-0 max-w-full gap-8 px-10 py-8">
      <section className="min-w-0 max-w-full rounded-panel border border-line bg-surface px-5.5 py-5">
        <h3 className="text-title font-bold text-ink">
          {title}
          <small className="mt-1 block text-grid font-normal text-ink-muted">{definition}</small>
        </h3>
        <div className="min-w-0 max-w-full overflow-x-auto pb-1">
          {tab === 'purpose' ? (
            <RowBars series={series} ariaLabel={ariaLabel} />
          ) : (
            <BarChart series={series} ariaLabel={ariaLabel} ticks={ticks} />
          )}
        </div>
        {isEmpty ? <p className="mt-3 text-body text-ink-muted">{emptyMessage}</p> : null}
      </section>
      <ul aria-label={summaryLabel} className="grid list-none grid-cols-1 gap-6 sm:grid-cols-3">
        {summary.map((item) => (
          <li key={item.label}>
            <p className="text-grid text-ink-muted">{item.label}</p>
            <p
              className={
                item.isOverTarget ? 'mt-1 text-body text-danger' : 'mt-1 text-body text-ink'
              }
            >
              <b className="font-mono text-title">{item.value}</b>
              {item.unit && ` ${item.unit}`}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
