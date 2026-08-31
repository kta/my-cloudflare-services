import type { AnalyticsPoint } from '@app/contracts'
import { cn } from '@app/ui'
import type { ReactNode } from 'react'
import './patterns.css'

/*
 * 分析のグラフ部品（P9 T-013）。承認済みモック ANALYTICS-TOP / ANALYTICS-COUNT /
 * ANALYTICS-STAFF / ANALYTICS-WAIT / ANALYTICS-CANCEL の 5 枚が持つ描き方を、
 * 縦棒・積み上げ・横棒・凡例・目安線の 5 つだけで組む。
 *
 * ここが引き受ける約束:
 *  - **系列は色だけで伝えない。** 塗り・地模様・系列名の文字を必ず 3 つ揃える。
 *  - 定休日は 0 件の棒として描き（`isClosed`）、欠測は点が来ないので棒を描かない。
 *  - 目安の超過は `isOverTarget` で受け、色に加えて呼び出し側が文字を添える。
 *  - データで決まる寸法（棒の高さ・横棒の幅・目盛りの位置）だけ `style` に置き、
 *    色・角・余白はトークンのユーティリティで書く（任意値を 1 つも書かない）。
 */

/** 塗りの色。トークンの 3 色だけで、地模様と組み合わせて系列を見分ける。 */
type ChartTone = 'pine' | 'danger' | 'web'

type Pattern = 'solid' | 'hatch' | 'dot'

const TONE_TEXT: Record<ChartTone, string> = {
  pine: 'text-pine',
  danger: 'text-danger',
  web: 'text-web',
}

const PATTERN_CLASS: Record<Pattern, string> = {
  solid: 'pattern-solid',
  hatch: 'pattern-hatch',
  dot: 'pattern-dot',
}

/** 0 除算を避けつつ、目盛りの上限に対する割合（%）を出す。 */
function percentOf(value: number, max: number): string {
  if (max <= 0 || value <= 0) return '0%'
  return `${Math.min(100, (value / max) * 100)}%`
}

function Gridlines({ ticks, max }: { ticks: readonly number[]; max: number }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-50">
      {ticks.map((tick) => (
        <div
          key={tick}
          className={cn(
            'absolute inset-x-0 border-t',
            tick === 0 ? 'border-line-strong' : 'border-line',
          )}
          style={{ bottom: percentOf(tick, max) }}
        />
      ))}
    </div>
  )
}

function TickLabels({
  ticks,
  max,
  format,
}: {
  ticks: readonly number[]
  max: number
  format?: (tick: number) => string
}) {
  return (
    <div aria-hidden="true" className="relative h-50 w-10 shrink-0">
      {ticks.map((tick) => (
        <span
          key={tick}
          className="absolute right-0 -translate-y-1/2 text-fine text-ink-muted"
          style={{ bottom: percentOf(tick, max) }}
        >
          {format ? format(tick) : tick}
        </span>
      ))}
    </div>
  )
}

export type BarChartProps = {
  ariaLabel: string
  points: readonly AnalyticsPoint[]
  ticks: readonly number[]
  max: number
  /** 「本日」の列。`AnalyticsPoint.key` と突き合わせる（時計を読まない）。 */
  todayKey?: string
  /** 列の間。モックの実測（トップ 12px / 予約数 6px / お待ち時間 16px）。 */
  gap?: 'tight' | 'normal' | 'wide'
  /** 棒の太さ。予約数だけ太い。 */
  bar?: 'normal' | 'thick'
  tone?: ChartTone
  /** 目安線。値は目盛りと同じ単位で受ける。 */
  target?: { value: number; label: string }
  /** 目盛りの文字（お待ち時間は「5分」）。 */
  formatTick?: (tick: number) => string
  /** 棒の上に添える値の文字（お待ち時間の「5:10」）。空文字を返すと出さない。 */
  formatValue?: (point: AnalyticsPoint) => string
}

/** 縦棒。定休日は 0 の高さで描き、欠測（点が無い日）は列そのものを作らない。 */
export function BarChart({
  ariaLabel,
  points,
  ticks,
  max,
  todayKey,
  gap = 'normal',
  bar = 'normal',
  tone = 'pine',
  target,
  formatTick,
  formatValue,
}: BarChartProps) {
  return (
    /*
     * 375px でもグラフだけが横に動き、**ページ全体は横に動かない**（T-020）。
     * 列は `min-w-0` を持たない —— 横軸のラベルより狭くつぶれないので、
     * 狭い画面では列が縮まずにこの枠の中を横へ送られる。
     */
    <div data-testid="chart-scroll" className="overflow-x-auto">
      <figure role="img" aria-label={ariaLabel} className="m-0 flex min-w-fit">
        <TickLabels ticks={ticks} max={max} {...(formatTick ? { format: formatTick } : {})} />
        <div className="relative flex-1 pl-2">
          <Gridlines ticks={ticks} max={max} />
          {target ? (
            <TargetLine label={target.label} bottomPercent={(target.value / max) * 100} />
          ) : null}
          <div
            className={cn(
              'relative flex items-end',
              gap === 'tight' && 'gap-1.5',
              gap === 'normal' && 'gap-3',
              gap === 'wide' && 'gap-4',
            )}
          >
            {points.map((point) => {
              const today = todayKey !== undefined && point.key === todayKey
              const valueLabel = formatValue ? formatValue(point) : ''
              return (
                <div
                  key={point.key}
                  data-testid="column"
                  data-today={today ? 'true' : 'false'}
                  className={cn(
                    'flex min-w-6 flex-1 flex-col items-center rounded-t-sm',
                    today && 'bg-pine-soft',
                  )}
                >
                  {/* 棒は下端から伸びる。値の文字は棒のすぐ上に乗る（モックの実測）。 */}
                  <div className="flex h-50 w-full flex-col items-center justify-end">
                    {valueLabel === '' ? null : (
                      <span
                        data-testid="bar-value"
                        className={cn(
                          'mb-1 whitespace-nowrap text-grid',
                          point.isOverTarget ? 'font-bold text-danger' : 'text-ink-muted',
                        )}
                      >
                        {valueLabel}
                      </span>
                    )}
                    <div
                      data-testid="bar"
                      data-closed={point.isClosed ? 'true' : 'false'}
                      /*
                       * 目安を超えた棒は**色だけで伝えない**。凡例が「目安を超えた時間帯＝
                       * 斜線」と言うので、棒も同じ地模様で描く（凡例と棒がずれると読めない）。
                       */
                      className={cn(
                        'rounded-t-sm',
                        bar === 'thick' ? 'w-3/4' : 'w-3/5',
                        point.isOverTarget ? PATTERN_CLASS.hatch : PATTERN_CLASS.solid,
                        TONE_TEXT[point.isOverTarget ? 'danger' : tone],
                      )}
                      style={{ height: percentOf(point.value, max) }}
                    />
                  </div>
                  <span
                    data-testid="column-label"
                    className={cn(
                      'mt-2 whitespace-nowrap text-grid',
                      today ? 'font-bold text-pine-deep' : 'text-ink-muted',
                    )}
                  >
                    {point.label}
                    {point.isClosed ? ' 定休' : ''}
                    {today ? ' 本日' : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </figure>
    </div>
  )
}

type StackedSeries = {
  name: string
  pattern: Pattern
  points: readonly AnalyticsPoint[]
}

export type StackedBarChartProps = {
  ariaLabel: string
  columns: readonly { key: string; label: string }[]
  series: readonly StackedSeries[]
  ticks: readonly number[]
  max: number
  /** 層ごとの塗り。凡例と同じ並びで渡す。 */
  tones?: readonly ChartTone[]
}

/** 積み上げ。層の順（下から上）は `series` の順で、0 件の層は描かない。 */
export function StackedBarChart({
  ariaLabel,
  columns,
  series,
  ticks,
  max,
  tones,
}: StackedBarChartProps) {
  return (
    // 375px でも積み上げだけが横に動き、ページ全体は横に動かない（T-020）。
    <div data-testid="chart-scroll" className="overflow-x-auto">
      <figure role="img" aria-label={ariaLabel} className="m-0 flex min-w-fit">
        <TickLabels ticks={ticks} max={max} />
        <div className="relative flex-1 pl-2">
          <Gridlines ticks={ticks} max={max} />
          <div className="relative flex items-end gap-6">
            {columns.map((column) => (
              <div key={column.key} className="flex min-w-26 flex-1 flex-col items-center">
                <div className="flex h-50 w-full flex-col-reverse items-center justify-start">
                  {series.map((layer, index) => {
                    const point = layer.points.find((candidate) => candidate.key === column.key)
                    if (!point || point.value <= 0) return null
                    return (
                      <div
                        key={layer.name}
                        data-testid="segment"
                        data-series={layer.name}
                        className={cn(
                          'w-3/5',
                          PATTERN_CLASS[layer.pattern],
                          TONE_TEXT[tones?.[index] ?? 'pine'],
                        )}
                        style={{ height: percentOf(point.value, max) }}
                      />
                    )
                  })}
                </div>
                <span
                  data-testid="column-label"
                  className="mt-2 whitespace-nowrap text-grid text-ink-muted"
                >
                  {column.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </figure>
    </div>
  )
}

export type RowBarsProps = {
  ariaLabel: string
  rows: readonly AnalyticsPoint[]
  /** 赤で描く行（担当が未定）。色だけで伝えないので、文字は呼び出し側が添える。 */
  dangerKey?: string
  /** 行の名前の描き方。添える言葉（担当が未定）を呼び出し側が決める。 */
  renderLabel?: (row: AnalyticsPoint) => ReactNode
  /** 行の右に添える言葉（件数・再来）。 */
  renderTrailing?: (row: AnalyticsPoint) => ReactNode
}

/** 横棒。最大件数の行を 100% とし、0 件の行は長さ 0 で描く。 */
export function RowBars({ ariaLabel, rows, dangerKey, renderLabel, renderTrailing }: RowBarsProps) {
  const max = rows.reduce((top, row) => Math.max(top, row.value), 0)
  return (
    <figure role="img" aria-label={ariaLabel} className="m-0 flex flex-col">
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line py-4 first:border-t-0"
        >
          <span className="w-40 shrink-0 text-lead font-bold text-ink sm:w-72">
            {renderLabel ? renderLabel(row) : row.label}
          </span>
          <span className="h-4.5 flex-1 overflow-hidden rounded-sm bg-surface-2">
            <span
              data-testid="row-bar"
              className={cn(
                'block h-full rounded-sm',
                PATTERN_CLASS.solid,
                TONE_TEXT[row.key === dangerKey ? 'danger' : 'pine'],
              )}
              style={{ width: percentOf(row.value, max) }}
            />
          </span>
          {renderTrailing ? renderTrailing(row) : null}
        </div>
      ))}
    </figure>
  )
}

export type LegendProps = {
  items: readonly { name: string; pattern: Pattern }[]
  tones?: readonly ChartTone[]
}

/** 凡例。どの系列も 塗り・地模様・系列名の文字 の 3 つを持つ。 */
export function Legend({ items, tones }: LegendProps) {
  return (
    <ul className="flex flex-wrap items-center gap-4">
      {items.map((item, index) => (
        <li key={item.name} className="flex items-center gap-2">
          <span
            data-testid="legend-swatch"
            data-pattern={item.pattern}
            aria-hidden="true"
            className={cn(
              'inline-block size-3 rounded-xs',
              PATTERN_CLASS[item.pattern],
              TONE_TEXT[tones?.[index] ?? 'pine'],
            )}
          />
          <span data-testid="legend-name" className="text-note text-ink-muted">
            {item.name}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** 目安の破線と札。プロットの高さに対する割合で置く。 */
export function TargetLine({ label, bottomPercent }: { label: string; bottomPercent: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-50">
      <div
        data-testid="target-line"
        className="absolute inset-x-0 border-t-2 border-pine border-dashed"
        style={{ bottom: `${bottomPercent}%` }}
      />
      <span
        className="absolute left-0 rounded-ctl bg-pine px-2 py-px text-note font-bold text-on-pine"
        style={{ bottom: `${bottomPercent}%` }}
      >
        {label}
      </span>
    </div>
  )
}
