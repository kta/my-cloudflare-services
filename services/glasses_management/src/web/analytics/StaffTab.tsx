import type { AnalyticsPoint } from '@app/contracts'
import { cn } from '@app/ui'
import { RowBars } from './charts'
import { describeChart, describeTab, monthLabel } from './describe'
import type { AnalyticsPanelProps } from './panel'

/*
 * 担当者（P9 T-016。承認済みモック ANALYTICS-STAFF.png）。
 *
 * 横棒 1 本＝担当 1 人。**件数 0 の担当も行として出す**（居ないことと 0 件は別）。
 * 再来率は標本が 20 件に満たないと `secondaryValue` が `null` で届く。
 * これを **0% と取り違えず「—」**で出す。担当が未定は分母がいくらあっても常に「—」で、
 * 誰の再来か言えないことをそのまま示す。
 *
 * 「担当が未定」の行は赤いが、**色だけで伝えない**ので必ず「担当が未定」の文字を添える。
 */

const UNASSIGNED_KEY = 'unassigned'

/** 0.68 → 「68%」。伏せた率（null）は「—」。 */
function revisitOf(point: AnalyticsPoint): string {
  if (point.secondaryValue === null) return '—'
  return `${Math.round(point.secondaryValue * 100)}%`
}

export function StaffTab({ tab, report, targets }: AnalyticsPanelProps) {
  const rows = report.series[0]?.points ?? []
  const total = report.summary.find((row) => row.label === '合計')?.value ?? '—'
  const countBy = report.countBy === 'received_date' ? '受付日' : 'ご来店日'
  const window = targets?.revisitWindowDays ?? 90

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-panel border border-line bg-surface px-5 py-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="m-0 text-title font-bold text-ink">担当者ごとの件数</h3>
          <span data-testid="staff-caption" className="text-grid text-ink-muted">
            {monthLabel(report.from.slice(0, 7))}／{countBy}でかぞえます　合計 {total}件
          </span>
        </div>

        <div
          data-testid="staff-columns"
          className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 pb-2.5 text-grid text-ink-muted"
        >
          <span className="w-40 shrink-0 sm:w-72">担当者</span>
          <span className="flex-1" />
          <span className="w-27 text-right">件数</span>
          <span className="w-35 text-right">{window}日以内の再来</span>
        </div>

        <RowBars
          ariaLabel={
            `担当者ごとの件数。合計 ${total}件。` +
            // 最も多い担当と件数・未集計の日を、文として読ませる（T-020）。
            describeChart({ points: rows, unit: '件', pendingDays: report.pendingDays })
          }
          rows={rows}
          dangerKey={UNASSIGNED_KEY}
          renderLabel={(row) => (
            <span
              data-testid="staff-name"
              className={row.key === UNASSIGNED_KEY ? 'text-danger' : 'text-ink'}
            >
              {row.key === UNASSIGNED_KEY ? '担当が未定' : row.label}
            </span>
          )}
          renderTrailing={(row) => (
            <>
              <span className="w-27 text-right">
                <span
                  data-testid="staff-count"
                  className={cn(
                    'font-mono text-title font-bold',
                    row.key === UNASSIGNED_KEY ? 'text-danger' : 'text-ink',
                  )}
                >
                  {row.value}
                </span>
                <span className="ml-1 text-grid text-ink-muted">件</span>
              </span>
              <span
                data-testid="staff-revisit"
                className="w-35 text-right text-lead text-ink-muted"
              >
                {revisitOf(row)}
              </span>
            </>
          )}
        />
      </section>

      <p data-testid="definition" className="text-grid text-ink-muted">
        {describeTab(tab, report)}
      </p>
    </div>
  )
}
