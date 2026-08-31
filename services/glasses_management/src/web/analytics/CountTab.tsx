import type { AnalyticsPoint } from '@app/contracts'
import { BarChart } from './charts'
import { chartTicks, describeChart, describeTab, monthLabel } from './describe'
import type { AnalyticsCountBy, AnalyticsGranularity, AnalyticsPanelProps } from './panel'
import { SegmentedRadio } from './SegmentedRadio'

/*
 * 予約数（P9 T-015。承認済みモック ANALYTICS-COUNT.png）。
 *
 * 切り口の帯 → カード → まとめ 3 つ。まとめに 4 つ目を置かない。
 * **切り口を変えただけでは数字が動かない。**「適用」を押したときだけ集計し直す
 * （帯は下書きを変えるだけで、集計はツールバーの「適用」が起こす）。
 *
 * 「1日あたり」はサーバのまとめをそのまま出す。**画面で割り直さない**（分母がずれる）。
 */

const GRANULARITIES: readonly { value: AnalyticsGranularity; label: string }[] = [
  { value: 'day', label: '日別' },
  { value: 'month', label: '月別' },
  { value: 'hour', label: '時間帯別' },
  { value: 'weekday', label: '曜日別' },
]

const COUNT_BY: readonly { value: AnalyticsCountBy; label: string }[] = [
  { value: 'visit_date', label: 'ご来店日' },
  { value: 'received_date', label: '受付日' },
]

const HEADINGS: Record<AnalyticsGranularity, string> = {
  day: '日別の予約数',
  month: '月別の予約数',
  hour: '時間帯別の予約数',
  weekday: '曜日別の予約数',
}

/** 「火曜（4・11・18・25日）は定休日です」。定休の点が無ければ書かない。 */
function closedNote(points: readonly AnalyticsPoint[]): string {
  const closed = points.filter((point) => point.isClosed)
  if (closed.length === 0) return ''
  const days = closed.map((point) => Number(point.key.slice(8)))
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][
    new Date(`${closed[0]?.key}T00:00:00.000Z`).getUTCDay()
  ]
  return `／${weekday}曜（${days.join('・')}日）は定休日です`
}

/** 時間帯は「10時台」と読む（台帳の言い方に合わせる）。 */
function labelOf(point: AnalyticsPoint, granularity: AnalyticsGranularity): string {
  if (granularity !== 'hour') return point.label
  return `${point.key}時台`
}

export function CountTab({ tab, report, options, onOptionsChange }: AnalyticsPanelProps) {
  const points = (report.series[0]?.points ?? []).map((point) => ({
    ...point,
    label: labelOf(point, report.granularity),
  }))
  const { ticks, max } = chartTicks(points.reduce((top, point) => Math.max(top, point.value), 0))
  const month = monthLabel(report.from.slice(0, 7))

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center gap-3.5">
        <SegmentedRadio
          label="集計の種類"
          value={options.granularity}
          options={GRANULARITIES}
          onChange={(granularity) => onOptionsChange({ granularity })}
        />
        <span aria-hidden="true" className="h-7 w-px bg-line-strong" />
        <SegmentedRadio
          label="かぞえる日"
          value={options.countBy}
          options={COUNT_BY}
          onChange={(countBy) => onOptionsChange({ countBy })}
        />
      </div>

      <section className="rounded-panel border border-line bg-surface px-5 py-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-3">
          <h3 className="m-0 text-title font-bold text-ink">{HEADINGS[report.granularity]}</h3>
          <span data-testid="count-caption" className="text-grid text-ink-muted">
            {month}
            {closedNote(points)}
          </span>
        </div>
        <BarChart
          ariaLabel={describeChart({ points, unit: '件', pendingDays: report.pendingDays })}
          points={points}
          ticks={ticks}
          max={max}
          gap="tight"
          bar="thick"
        />
      </section>

      <p data-testid="definition" className="text-grid text-ink-muted">
        {describeTab(tab, report)}
      </p>

      <dl className="m-0 flex flex-wrap gap-10">
        {report.summary.map((row) => (
          <div
            key={row.label}
            data-testid={`summary-${row.label}`}
            className="flex flex-1 flex-col gap-1"
          >
            <dt data-testid="summary-label" className="text-grid text-ink-muted">
              {row.label === '合計' ? `${Number(report.from.slice(5, 7))}月の合計` : row.label}
            </dt>
            <dd className="m-0 flex items-baseline gap-1">
              <span data-testid="summary-value" className="font-mono text-hero font-bold text-ink">
                {row.value}
              </span>
              <span className="text-grid text-ink-muted">{row.unit}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
