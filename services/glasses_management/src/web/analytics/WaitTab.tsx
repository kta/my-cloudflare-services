import type { AnalyticsPoint } from '@app/contracts'
import { cn } from '@app/ui'
import { BarChart, Legend } from './charts'
import { describeTab, monthLabel } from './describe'
import type { AnalyticsPanelProps } from './panel'

/*
 * お待ち時間（P9 T-017。承認済みモック ANALYTICS-WAIT.png）。
 *
 * 主役は**中央値**。平均は出さない（1 人の長い待ち時間で動いてしまう）。
 * 目安 8 分は「ちょうど」で倒れない —— 8分0秒は超過にせず、8分1秒で超過にする
 * （その判定はサーバの `isOverTarget` に従い、画面で数え直さない）。
 * 超過は色だけで伝えないので、必ず「目安 8分を超えています」の札と文字を添える。
 *
 * この面の「受付 328件」は**ご来店の受付**（ウォークインを含む）で、予約の件数ではない。
 */

/** 5 分刻みの目盛りを 5 本（0 を含む）。お待ち時間は分で読む。 */
function waitTicks(maxSeconds: number): { ticks: number[]; max: number } {
  const step = Math.max(300, Math.ceil(maxSeconds / 4 / 300) * 300)
  return { ticks: [0, step, step * 2, step * 3, step * 4], max: step * 4 }
}

/** 520 → 「8分40秒」。サーバと同じ言い方をする。 */
function formatSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`
}

/** 520 → 「8:40」。棒の上に乗る短い言い方（モックの実測）。0 件の時間帯は書かない。 */
function formatClock(seconds: number): string {
  if (seconds <= 0) return ''
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * 受付が 1 件も無い時間帯は応答に点が来ない。**軸だけ残す**ので、
 * 抜けた時間帯を 0 件の列として補い、「0件」の文字を添える（棒は描かれない）。
 */
function withEmptyHours(points: readonly AnalyticsPoint[]): AnalyticsPoint[] {
  const numeric = points.every((point) => /^\d+$/.test(point.key))
  if (!numeric || points.length === 0) return [...points]
  const hours = points.map((point) => Number(point.key))
  const filled: AnalyticsPoint[] = []
  for (let hour = Math.min(...hours); hour <= Math.max(...hours); hour += 1) {
    const found = points.find((point) => Number(point.key) === hour)
    filled.push(
      found
        ? {
            ...found,
            label: `${hour}時台${found.isOverTarget ? ' 目安超過' : ''}`,
          }
        : {
            key: String(hour),
            label: `${hour}時台 0件`,
            value: 0,
            secondaryValue: null,
            isClosed: false,
            isOverTarget: false,
          },
    )
  }
  return filled
}

export function WaitTab({ tab, report, targets }: AnalyticsPanelProps) {
  const points = withEmptyHours(report.series[0]?.points ?? [])
  const { ticks, max } = waitTicks(
    Math.max(report.target ?? 0, ...points.map((point) => point.value)),
  )
  const median = report.summary.find((row) => row.label === '中央値')
  const previous = report.summary.find((row) => row.label === '前の月の中央値')
  const receptions = report.summary.find((row) => row.label === '受付')
  const minutes = targets?.waitMinutes ?? 8
  const over = median?.isOverTarget === true
  const longest = [...points].sort((a, b) => b.value - a.value)[0]

  const ariaLabel = [
    longest
      ? `最も長いのは${longest.label.replace(' 目安超過', '')}の${formatSeconds(longest.value)}`
      : '',
    over ? `目安 ${minutes}分を超えています` : `目安 ${minutes}分の内`,
  ]
    .filter((part) => part !== '')
    .join('、')
    .concat('。')

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <span className="text-grid text-ink-muted">受付からご相談開始まで（中央値）</span>
        <p
          data-testid="wait-median"
          className={cn('m-0 font-mono text-hero font-bold', over ? 'text-danger' : 'text-ink')}
        >
          {median?.value ?? '—'}
        </p>
        <div className="flex flex-wrap items-center gap-3.5">
          {over ? (
            <span className="rounded-ctl border border-danger bg-danger-soft px-2 py-0.5 text-note font-bold text-danger">
              目安 {minutes}分を超えています
            </span>
          ) : null}
          <span data-testid="wait-note" className="text-grid text-ink-muted">
            前の月は {previous?.value ?? '—'}／{monthLabel(report.from.slice(0, 7))}・受付{' '}
            {receptions?.value ?? '—'}件
          </span>
        </div>
      </section>

      <section className="rounded-panel border border-line bg-surface px-5 py-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-3">
          <h3 className="m-0 text-title font-bold text-ink">時間帯ごとのお待ち時間</h3>
          <span className="text-grid text-ink-muted">中央値</span>
          <span className="ml-auto">
            <Legend
              items={[
                { name: '目安の内', pattern: 'solid' },
                { name: '目安を超えた時間帯', pattern: 'hatch' },
              ]}
              tones={['pine', 'danger']}
            />
          </span>
        </div>
        <BarChart
          ariaLabel={ariaLabel}
          points={points}
          ticks={ticks}
          max={max}
          gap="wide"
          formatTick={(tick) => `${tick / 60}分`}
          formatValue={(point) => formatClock(point.value)}
          {...(report.target === null
            ? {}
            : { target: { value: report.target, label: `目安 ${minutes}分` } })}
        />
      </section>

      <p data-testid="definition" className="text-grid text-ink-muted">
        {describeTab(tab, report)}
      </p>
    </div>
  )
}
