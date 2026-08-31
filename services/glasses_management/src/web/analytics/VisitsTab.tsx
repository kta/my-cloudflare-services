import { RowBars } from './charts'
import { describeChart, describeTab } from './describe'
import type { AnalyticsPanelProps } from './panel'
import { SummaryList } from './SummaryList'

/*
 * 来店回数（P9 T-019）。**モックの無い 3 タブ**の 2 枚目。
 *
 * 4 階級（初めて・2回目・3〜5回・6回以上）は順番そのものが意味を持つので、
 * サーバが返した並びを画面で並べ替えない。**件数 0 の階級も行として出す**
 * （その階級が 0 だったことが情報である）。
 */
export function VisitsTab({ tab, report }: AnalyticsPanelProps) {
  const rows = report.series[0]?.points ?? []

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-panel border border-line bg-surface px-4 py-5 sm:px-5">
        <div className="mb-2 flex flex-wrap items-baseline gap-3">
          <h3 className="m-0 text-title font-bold text-ink">来店回数</h3>
          <span data-testid="visits-caption" className="text-grid text-ink-muted">
            ご来店の回数ごと／件数
          </span>
        </div>
        <RowBars
          ariaLabel={describeChart({ points: rows, unit: '件', pendingDays: report.pendingDays })}
          rows={rows}
          renderLabel={(row) => (
            <span data-testid="visits-class" className="text-ink">
              {row.label}
            </span>
          )}
          renderTrailing={(row) => (
            <span className="w-27 text-right">
              <span data-testid="visits-count" className="font-mono text-title font-bold text-ink">
                {row.value}
              </span>
              <span className="ml-1 text-grid text-ink-muted">件</span>
            </span>
          )}
        />
      </section>

      <p data-testid="definition" className="text-grid text-ink-muted">
        {describeTab(tab, report)}
      </p>

      <SummaryList rows={report.summary} />
    </div>
  )
}
