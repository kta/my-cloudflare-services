import type { AnalyticsReport } from '@app/contracts'
import { cn } from '@app/ui'

/*
 * まとめの 3 行（P9 T-019）。**箱に入れず罫線 1 本で区切る**（引き算の表）。
 *
 * 数字はサーバの `summary` をそのまま出す。画面で割り直すと分母がずれるので、
 * ここには計算を 1 つも置かない。目安の超過は色に加えて必ず文字を添える。
 */
export function SummaryList({ rows }: { rows: AnalyticsReport['summary'] }) {
  if (rows.length === 0) return null
  return (
    <dl className="m-0 flex flex-col">
      {rows.map((row) => (
        <div
          key={row.label}
          data-testid="summary-row"
          className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line py-4 first:border-t-0"
        >
          <dt className="text-grid text-ink-muted">{row.label}</dt>
          <dd className="m-0 flex items-baseline gap-1">
            <span
              data-testid="summary-value"
              className={cn(
                'font-mono text-title font-bold',
                row.isOverTarget ? 'text-danger' : 'text-ink',
              )}
            >
              {row.value}
            </span>
            <span className="text-grid text-ink-muted">{row.unit}</span>
            {row.isOverTarget ? (
              <span className="text-note font-bold text-danger">目安を超過</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}
