import type { AnalyticsPoint } from '@app/contracts'
import { cn } from '@app/ui'
import { Legend, StackedBarChart } from './charts'
import { chartTicks, describeChart, describeTab, monthLabel } from './describe'
import type { AnalyticsPanelProps } from './panel'

/*
 * 取り消し（P9 T-018。承認済みモック ANALYTICS-CANCEL.png）。
 *
 * 5 分類の名前は **CHANGE-CANCEL の 4 択と 1 字も違えない**（お客様のご都合／
 * 店舗の都合／予約の重複／ご来店がなかった）。5 つ目の「Webからの取消」だけが
 * お客様ご自身の操作である。層の順は凡例の順と同じ（違うと読めない）。
 *
 * 塗りは 3 系統（緑・赤・青）しか使わないので、**同じ色の層は地模様で分ける**。
 * 塗りを外しても地模様と文字だけで見分けられる。
 *
 * 取消率の分母は「その期間に来店予定だった予約の総数（取消・無断を含む）」で、
 * 予約数タブの母数とは別物である。10% を超えた数字には必ず「目安を超過」を添える。
 */

/** 層ごとの塗り。凡例と同じ並びで渡す（緑 3・赤 1・青 1）。 */
const TONES = ['pine', 'pine', 'pine', 'danger', 'web'] as const

/** 0.119 → 「11.9」。％の小数第 1 位までで、サーバの丸め方と揃える。 */
const percent = (rate: number): string => String(Math.round(rate * 1000) / 10)

export function CancelTab({ tab, report, targets }: AnalyticsPanelProps) {
  const layers = report.series
  const first = layers[0]?.points ?? []
  const columns = first.map((point) => ({
    key: point.key,
    label: columnLabel(point, layers),
  }))
  const tallest = first.reduce((top, point) => Math.max(top, totalOf(point.key, layers)), 0)
  const { ticks, max } = chartTicks(tallest)

  const rate = report.summary.find((row) => row.label === '取消率')
  const cancelled = report.summary.find((row) => row.label === '取消件数')
  const months = monthsBetween(report.from, report.to)
  const peak = [...first]
    .filter((point) => point.secondaryValue !== null)
    .sort((a, b) => (b.secondaryValue ?? 0) - (a.secondaryValue ?? 0))[0]
  const limit = targets?.cancellationRatePercent ?? 10

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-panel border border-line bg-surface px-5 py-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-4">
          <h3 className="m-0 text-title font-bold text-ink">月ごとの取り消し</h3>
          <Legend
            items={layers.map((layer) => ({ name: layer.name, pattern: layer.pattern }))}
            tones={TONES.slice(0, layers.length)}
          />
        </div>
        <StackedBarChart
          ariaLabel={
            `月ごとの取り消し。${columns.map((column) => column.label).join('、')}。` +
            // 最も多い月と件数・定休日の 0 件・未集計の日を、文として読ませる（T-020）。
            describeChart({
              points: first.map((point) => ({ ...point, value: totalOf(point.key, layers) })),
              unit: '件',
              pendingDays: report.pendingDays,
            })
          }
          columns={columns}
          series={layers}
          ticks={ticks}
          max={max}
          tones={TONES.slice(0, layers.length)}
        />
      </section>

      <p data-testid="definition" className="text-grid text-ink-muted">
        {describeTab(tab, report)}
      </p>

      <section className="flex flex-col">
        <h3 className="m-0 mb-2 text-title font-bold text-ink">{months}か月のまとめ</h3>
        <dl className="m-0 flex flex-col">
          <SummaryRow
            label="取消率"
            value={rate?.value ?? '—'}
            unit="%"
            note={`目安 ${limit}%以内`}
            over={rate?.isOverTarget === true}
          />
          <SummaryRow
            label="最も高い月"
            value={peak?.secondaryValue === undefined ? '—' : percent(peak.secondaryValue ?? 0)}
            unit="%"
            note={
              peak === undefined
                ? '—'
                : `${monthLabel(peak.key)}${peak.isOverTarget ? '・目安を超過' : ''}`
            }
            over={peak?.isOverTarget === true}
          />
          <SummaryRow
            label="取消件数"
            value={cancelled?.value ?? '—'}
            unit="件"
            note={`来店予定だった総数のうち`}
            over={false}
          />
        </dl>
      </section>
    </div>
  )
}

function SummaryRow({
  label,
  value,
  unit,
  note,
  over,
}: {
  label: string
  value: string
  unit: string
  note: string
  over: boolean
}) {
  return (
    <div
      data-testid={`summary-${label}`}
      className="flex items-baseline gap-5 border-t border-line py-4 first:border-t-0"
    >
      <dt className="w-60 text-lead font-bold text-ink">{label}</dt>
      <dd className="m-0 flex flex-1 items-baseline gap-2">
        <span
          data-testid="summary-value"
          className={cn('font-mono text-title font-bold', over ? 'text-danger' : 'text-ink')}
        >
          {value}
        </span>
        <span className="text-grid text-ink-muted">{unit}</span>
        <span className="text-lead text-ink-muted">{note}</span>
      </dd>
    </div>
  )
}

/** その月の 5 層の合計。 */
function totalOf(key: string, layers: AnalyticsPanelProps['report']['series']): number {
  return layers.reduce(
    (sum, layer) => sum + (layer.points.find((point) => point.key === key)?.value ?? 0),
    0,
  )
}

/** 「7月　37件・11.9%」。率が伏せてあるときは件数だけ書く。 */
function columnLabel(
  point: AnalyticsPoint,
  layers: AnalyticsPanelProps['report']['series'],
): string {
  const count = totalOf(point.key, layers)
  if (point.secondaryValue === null) return `${point.label}　${count}件`
  return `${point.label}　${count}件・${percent(point.secondaryValue)}%`
}

/** 期間の月数（暦を正とする）。 */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return ((ty ?? 0) - (fy ?? 0)) * 12 + ((tm ?? 0) - (fm ?? 0)) + 1
}
