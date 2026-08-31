import type { AnalyticsPoint } from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { cn } from '@app/ui'
import { BarChart } from './charts'
import { chartTicks, describeChart, describeTab, monthLabel } from './describe'
import type { AnalyticsPanelProps } from './panel'

/*
 * 分析トップ（P9 T-014。承認済みモック ANALYTICS-TOP.png）。
 *
 * 店長が朝礼の前に 1 枚だけ開いて、今日の入り具合と先週との差を読む面。
 * 主役は棒グラフ 1 つで、その下は「週の予約」の 3 行だけ。
 * **下 1/3 が空いているのは正しい状態**（mockups/eyex/README.md の引き算の表）。
 * 埋めるために要素を足さない。
 *
 * モックには「88名」「92名」の列があるが**写さない**（Q-11。人数を数える経路がまだ無い）。
 * 答えが来たら列を戻すが、決定ブリーフ §3 に無い列なのでそのとき人間の承認を取る。
 */

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const

const DAY = 86_400_000

/** `2026-08-27` を UTC の 0 時として読む（暦の足し算だけに使う）。 */
function atUtc(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year ?? 2000, (month ?? 1) - 1, day ?? 1)
}

/** `8月17日`。 */
function japaneseDay(time: number): string {
  const at = new Date(time)
  return `${at.getUTCMonth() + 1}月${at.getUTCDate()}日`
}

/**
 * 先週・今週・来週の日付の並び（**月曜始まり**）。
 * 数字はサーバのまとめをそのまま出し、ここでは期間の言葉だけを作る。
 */
function weekSpans(now: string): Record<string, string> {
  const monday = (() => {
    const today = atUtc(toJstDateString(new Date(now)))
    const weekday = (new Date(today).getUTCDay() + 6) % 7
    return today - weekday * DAY
  })()
  const span = (weeks: number): string =>
    `${japaneseDay(monday + weeks * 7 * DAY)}〜${japaneseDay(monday + (weeks * 7 + 6) * DAY)}`
  return { 先週: span(-1), 今週: span(0), 来週: span(1) }
}

/** 「・火曜は定休日です」。定休の点が 1 つも無ければ何も書かない。 */
function closedWeekdayNote(points: readonly AnalyticsPoint[]): string {
  const names = [
    ...new Set(
      points
        .filter((point) => point.isClosed)
        .map((point) => WEEKDAY_NAMES[new Date(atUtc(point.key)).getUTCDay()] ?? ''),
    ),
  ].filter((name) => name !== '')
  if (names.length === 0) return ''
  return `・${names.map((name) => `${name}曜`).join('と')}は定休日です`
}

export function TopTab({ tab, report, now }: AnalyticsPanelProps) {
  const points = report.series[0]?.points ?? []
  // 応答のラベルは「8/27 本日」。部品が「本日」を足すので、ここでは日付だけを渡す。
  const todayPoint = points.find((point) => point.label.endsWith(' 本日'))
  const shown = points.map((point) => ({ ...point, label: point.label.replace(' 本日', '') }))
  const { ticks, max } = chartTicks(shown.reduce((top, point) => Math.max(top, point.value), 0))
  const spans = weekSpans(now)

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-panel border border-line bg-surface px-5 py-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-3">
          <h3 className="m-0 text-title font-bold text-ink">予約の入り具合</h3>
          <span data-testid="top-caption" className="text-grid text-ink-muted">
            {todayPoint ? '本日を中心に前後7日' : monthLabel(report.from.slice(0, 7))}／件数
            {closedWeekdayNote(points)}
          </span>
        </div>
        <BarChart
          ariaLabel={describeChart({ points: shown, unit: '件', pendingDays: report.pendingDays })}
          points={shown}
          ticks={ticks}
          max={max}
          gap="normal"
          {...(todayPoint ? { todayKey: todayPoint.key } : {})}
        />
      </section>

      <p data-testid="definition" className="text-grid text-ink-muted">
        {describeTab(tab, report)}
      </p>

      <section className="flex flex-col">
        <h3 className="m-0 mb-2 text-title font-bold text-ink">週の予約</h3>
        <dl className="m-0 flex flex-col">
          {report.summary.map((row) => {
            const current = row.label === '今週'
            return (
              <div
                key={row.label}
                data-testid="week-row"
                data-week={row.label}
                data-current={current ? 'true' : 'false'}
                className="flex items-baseline gap-4 border-t border-line py-4 first:border-t-0"
              >
                <dt className={cn('w-22 text-lead font-bold', current ? 'text-pine' : 'text-ink')}>
                  {row.label}
                </dt>
                <span className="flex-1 text-grid text-ink-muted">{spans[row.label] ?? ''}</span>
                <dd className="m-0 w-33 text-right">
                  <span
                    data-testid="summary-value"
                    className="font-mono text-title font-bold text-ink"
                  >
                    {row.value}
                  </span>
                  <span className="ml-1 text-grid text-ink-muted">{row.unit}</span>
                </dd>
              </div>
            )
          })}
        </dl>
      </section>
    </div>
  )
}
