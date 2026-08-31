import { cn } from '@app/ui'
import './patterns.css'

export type ChartTone = 'pine' | 'web' | 'walkin' | 'danger'
export type ChartPattern = 'solid' | 'hatch' | 'dot'

type ChartPoint = {
  key?: string
  label: string
  value: number
  secondaryValue: number | null
  isClosed?: boolean
  isOverTarget?: boolean
}

export type ChartSeries = {
  name: string
  points: readonly ChartPoint[]
  pattern: ChartPattern
  tone: ChartTone
}

const TONE_CLASS: Record<ChartTone, string> = {
  pine: 'text-pine',
  web: 'text-web',
  walkin: 'text-walkin',
  danger: 'text-danger',
}

const PATTERN_CLASS: Record<ChartPattern, string> = {
  solid: '',
  hatch: 'analytics-pattern-hatch',
  dot: 'analytics-pattern-dot',
}

export function niceTicks(maximum: number) {
  const rawStep = Math.max(1, maximum / 4)
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const multiplier = [1, 2, 2.5, 3, 4, 5, 10].find((value) => value >= normalized) ?? 10
  const step = multiplier * magnitude
  const ceiling = step * 4
  return Array.from({ length: 5 }, (_, index) => ceiling - step * index)
}

export function ChartGridlines({
  ticks,
  formatTick = String,
}: {
  ticks: readonly number[]
  formatTick?: (value: number) => string
}) {
  return (
    <div
      aria-hidden="true"
      data-testid="chart-gridlines"
      className="pointer-events-none absolute inset-y-0 left-10 right-0 flex flex-col justify-between"
    >
      {ticks.map((value) => {
        return (
          <div key={value} className="relative border-line border-t">
            <span className="absolute right-full mr-2 -translate-y-1/2 text-grid text-ink-muted">
              {formatTick(value)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function flatten(series: readonly ChartSeries[]) {
  return series.flatMap((entry) => entry.points.map((point) => ({ ...point, series: entry })))
}

export function Legend({ series }: { series: readonly ChartSeries[] }) {
  return (
    <ul
      aria-label="グラフの系列"
      className="flex flex-wrap gap-x-3 gap-y-1 text-grid text-ink-muted"
    >
      {series.map((entry) => (
        <li key={entry.name} className="flex items-center gap-1.5">
          <i
            aria-hidden="true"
            data-pattern={entry.pattern}
            className={cn(
              'size-3.5 rounded-ctl bg-current',
              TONE_CLASS[entry.tone],
              PATTERN_CLASS[entry.pattern],
            )}
          />
          <span>{entry.name}</span>
        </li>
      ))}
    </ul>
  )
}

export function BarChart({
  series,
  ariaLabel,
  max,
  ticks,
}: {
  series: readonly ChartSeries[]
  ariaLabel: string
  max?: number
  ticks?: readonly number[]
}) {
  const points = flatten(series)
  const maximum = max ?? Math.max(1, ...points.map((point) => point.value))
  const gridTicks = ticks ?? niceTicks(maximum)
  const ceiling = gridTicks[0] ?? maximum
  return (
    <div>
      <div
        role="img"
        aria-label={ariaLabel}
        className="relative mt-3 min-w-150 border-line-strong border-b"
      >
        <div className="relative flex h-50 items-end gap-6 border-line border-y pl-10">
          <ChartGridlines ticks={gridTicks} />
          {points.map((point) => (
            <div
              key={`${point.series.name}-${point.label}`}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mx-auto block w-3/4 rounded-t-ctl bg-current',
                  TONE_CLASS[point.series.tone],
                  PATTERN_CLASS[point.series.pattern],
                )}
                style={{ height: `${Math.max(0, (point.value / ceiling) * 100)}%` }}
              />
              <span className="mt-1.5 min-h-7 text-center text-grid text-ink-muted">
                {point.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function RowBars({
  series,
  ariaLabel,
}: {
  series: readonly ChartSeries[]
  ariaLabel: string
}) {
  const points = flatten(series)
  const ceiling = Math.max(1, ...points.map((point) => point.value))
  return (
    <div role="img" aria-label={ariaLabel} className="min-w-150 border-line border-t">
      {points.map((point) => (
        <div
          key={`${point.series.name}-${point.label}`}
          className="flex min-h-14 items-center gap-5 border-line border-b"
        >
          <span className="w-72 shrink-0 text-body font-semibold text-ink">{point.label}</span>
          <span className="h-4.5 min-w-72 flex-1 overflow-hidden rounded-ctl bg-surface-2">
            <i
              aria-hidden="true"
              className={cn(
                'block h-full rounded-ctl bg-current',
                TONE_CLASS[point.series.tone],
                PATTERN_CLASS[point.series.pattern],
              )}
              style={{ width: `${Math.max(0, (point.value / ceiling) * 100)}%` }}
            />
          </span>
          <span className="w-28 shrink-0 text-right font-mono text-lead font-semibold text-ink">
            {point.value} 件
          </span>
        </div>
      ))}
    </div>
  )
}
