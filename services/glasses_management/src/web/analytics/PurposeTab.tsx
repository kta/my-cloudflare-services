import { RowBars } from './charts'
import { describeChart, describeTab } from './describe'
import type { AnalyticsPanelProps } from './panel'
import { SummaryList } from './SummaryList'

/*
 * ご来店の目的（P9 T-019）。**モックの無い 3 タブ**の 3 枚目。
 *
 * 並びはサーバが決めた順（件数の多い順）をそのまま使う。削除されたご用件も、
 * その期間に予約があれば行として残す（消すと合計と行の和が食い違う）。
 */
export function PurposeTab({ tab, report }: AnalyticsPanelProps) {
  const rows = report.series[0]?.points ?? []

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-panel border border-line bg-surface px-4 py-5 sm:px-5">
        <div className="mb-2 flex flex-wrap items-baseline gap-3">
          <h3 className="m-0 text-title font-bold text-ink">ご来店の目的</h3>
          <span data-testid="purpose-caption" className="text-grid text-ink-muted">
            ご用件ごと／件数
          </span>
        </div>
        <RowBars
          ariaLabel={describeChart({ points: rows, unit: '件', pendingDays: report.pendingDays })}
          rows={rows}
          renderLabel={(row) => (
            <span data-testid="purpose-name" className="text-ink">
              {row.label}
            </span>
          )}
          renderTrailing={(row) => (
            <span className="w-27 text-right">
              <span data-testid="purpose-count" className="font-mono text-title font-bold text-ink">
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
