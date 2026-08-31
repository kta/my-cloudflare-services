import { cn } from '@app/ui'
import { useState } from 'react'
import { ChartGridlines, type ChartSeries, Legend, niceTicks } from './charts'

type Point = {
  label: string
  value: number
  secondaryValue: number | null
  isClosed?: boolean
}

type Summary = { label: string; value: string; unit: string; isOverTarget?: boolean }

type TopReport = {
  tab: 'top'
  title: string
  definition: string
  points: readonly Point[]
  todayLabel: string
  pendingDays?: number
  weeks: readonly {
    label: '先週' | '今週' | '来週'
    period: string
    reservations: string
  }[]
}

type CountReport = {
  tab: 'count'
  title: string
  definition: string
  selectedGranularity: 'day' | 'month' | 'hour' | 'weekday'
  selectedCountBy: 'visit' | 'received'
  points: readonly Point[]
  summary: readonly Summary[]
  pendingDays?: number
}

type StaffReport = {
  tab: 'staff'
  title: string
  definition: string
  staff: readonly {
    name: string
    role: string
    value: number
    returnRate: string
    unassigned?: boolean
  }[]
  pendingDays?: number
}

type WaitReport = {
  tab: 'wait'
  median: string
  previousMedian: string
  sample: string
  target: string
  targetSeconds: number
  isOverTarget?: boolean
  hourly: readonly { label: string; value: number; display: string; isOverTarget: boolean }[]
  pendingDays?: number
}

type CancelReport = {
  tab: 'cancel'
  title: string
  definition: string
  series: readonly ChartSeries[]
  target: string
  summary: readonly Summary[]
  pendingDays?: number
}

export type OfficialAnalyticsReport =
  | TopReport
  | CountReport
  | StaffReport
  | WaitReport
  | CancelReport

function VerticalBars({
  points,
  ariaLabel,
  todayLabel,
  target,
  ticks,
  showValues = true,
}: {
  points: readonly Point[]
  ariaLabel: string
  todayLabel?: string
  target?: number
  ticks?: readonly number[]
  showValues?: boolean
}) {
  const maximum = Math.max(1, target ?? 0, ...points.map((point) => point.value))
  const gridTicks = ticks ?? niceTicks(maximum)
  const scaleMaximum = gridTicks[0] ?? maximum
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="relative min-w-150 border-line-strong border-b"
    >
      <div
        className={cn(
          'relative flex h-50 items-end border-line border-y pl-10 pr-2',
          points.length > 20 ? 'gap-1' : 'gap-2',
        )}
      >
        <ChartGridlines ticks={gridTicks} />
        {points.map((point) => {
          const isToday = point.label === todayLabel
          return (
            <div
              key={point.label}
              className={cn(
                'flex h-full min-w-0 flex-1 flex-col justify-end',
                isToday && 'rounded-t-ctl bg-pine-soft',
              )}
            >
              <span className="min-h-7 text-center text-grid text-ink-muted">
                {showValues ? (point.isClosed ? '定休' : point.value) : ''}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'mx-auto block w-3/4 rounded-t-ctl bg-pine',
                  point.isClosed && 'analytics-pattern-hatch text-pine',
                  isToday && 'bg-pine-deep',
                )}
                style={{ height: `${(point.value / scaleMaximum) * 100}%` }}
              />
              <span
                className={cn(
                  'mt-1.5 min-h-7 text-center text-grid text-ink-muted',
                  isToday && 'font-semibold text-pine-deep',
                )}
              >
                {isToday ? `${point.label} 本日` : point.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SummaryFigures({ summary, label }: { summary: readonly Summary[]; label: string }) {
  return (
    <ul aria-label={label} className="grid list-none grid-cols-1 gap-6 sm:grid-cols-3">
      {summary.map((item) => (
        <li key={item.label}>
          <p className="text-grid text-ink-muted">{item.label}</p>
          <p className={cn('mt-1 text-body', item.isOverTarget ? 'text-danger' : 'text-ink')}>
            <b className="font-mono text-title">{item.value}</b>
            {item.unit && ` ${item.unit}`}
          </p>
        </li>
      ))}
    </ul>
  )
}

function TopTab({ report }: { report: TopReport }) {
  const todayPoint = report.points.find((point) => report.todayLabel.startsWith(point.label))
  const maximum = report.points.reduce<(typeof report.points)[number] | undefined>(
    (best, point) => (!best || point.value > best.value ? point : best),
    undefined,
  )
  const closed = report.points.filter((point) => point.isClosed).length
  return (
    <div className="grid min-w-0 max-w-full gap-8 px-10 py-8">
      <section className="min-w-0 max-w-full rounded-panel border border-line bg-surface px-5.5 py-5">
        <h3 className="text-title font-bold text-ink">{report.title}</h3>
        <p className="mt-1 text-grid text-ink-muted">{report.definition}</p>
        <div className="mt-4 min-w-0 max-w-full overflow-x-auto pb-1">
          <VerticalBars
            points={report.points}
            todayLabel={report.todayLabel.replace(' 本日', '')}
            ariaLabel={`本日を中心に前後7日、15日分の予約件数。最も多い日は${maximum?.label ?? '—'}の${maximum?.value ?? 0}件、定休${closed}日は0件${report.pendingDays ? `、${report.pendingDays}日ぶんはまだ集計中` : ''}。${report.todayLabel}は${todayPoint?.value ?? 0}件です。`}
          />
        </div>
      </section>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="text-title font-bold text-ink">週の予約</legend>
        <dl className="mt-2 max-w-190 divide-y divide-line border-line border-y">
          {report.weeks.map((week) => (
            <div
              key={week.label}
              className={cn(
                'grid grid-cols-1 gap-2 py-3 sm:grid-cols-3',
                week.label === '今週' && 'text-pine-deep',
              )}
            >
              <dt className="font-semibold">{week.label}</dt>
              <dd className="text-grid text-ink-muted">{week.period}</dd>
              <dd className="text-right font-mono text-lead font-semibold">{week.reservations}</dd>
            </div>
          ))}
        </dl>
      </fieldset>
    </div>
  )
}

function CountTab({
  report,
  onDraftChange,
}: {
  report: CountReport
  onDraftChange?: (next: {
    granularity?: CountReport['selectedGranularity']
    countBy?: CountReport['selectedCountBy']
  }) => void
}) {
  const [granularity, setGranularity] = useState(report.selectedGranularity)
  const [countBy, setCountBy] = useState(report.selectedCountBy)
  const labels: Record<typeof granularity, string> = {
    day: '日別',
    month: '月別',
    hour: '時間帯別',
    weekday: '曜日別',
  }
  const appliedLabels: Record<CountReport['selectedGranularity'], string> = {
    day: '日別',
    month: '月別',
    hour: '時間帯別',
    weekday: '曜日別',
  }
  const maximum = report.points.reduce<(typeof report.points)[number] | undefined>(
    (best, point) => (!best || point.value > best.value ? point : best),
    undefined,
  )
  const closed = report.points.filter((point) => point.isClosed).length
  const countByLabel = report.selectedCountBy === 'visit' ? 'ご来店日' : '受付日'
  return (
    <div className="grid min-w-0 max-w-full gap-7 px-10 py-7">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          aria-label="集計の種類"
          className="flex flex-wrap items-center gap-2"
        >
          <p className="mr-1 text-grid text-ink-muted">集計の種類</p>
          {(Object.entries(labels) as [typeof granularity, string][]).map(([key, label]) => (
            <label
              key={key}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-body',
                granularity === key
                  ? 'border-2 border-pine bg-pine-soft font-semibold text-pine-deep'
                  : 'border-line-strong text-ink-muted',
                'focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus',
              )}
            >
              <input
                type="radio"
                name="analytics-granularity"
                value={key}
                checked={granularity === key}
                onChange={() => {
                  setGranularity(key)
                  onDraftChange?.({ granularity: key })
                }}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'size-4 rounded-circle border-2',
                  granularity === key ? 'border-pine bg-pine' : 'border-line-strong bg-surface',
                )}
              />
              {label}
            </label>
          ))}
        </div>
        <span className="mx-2 hidden h-7 w-px bg-line sm:block" aria-hidden="true" />
        <div
          role="radiogroup"
          aria-label="かぞえる日"
          className="flex flex-wrap items-center gap-2"
        >
          <p className="mr-1 text-grid text-ink-muted">かぞえる日</p>
          {(['visit', 'received'] as const).map((key) => (
            <label
              key={key}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-body',
                countBy === key
                  ? 'border-2 border-pine bg-pine-soft font-semibold text-pine-deep'
                  : 'border-line-strong text-ink-muted',
                'focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus',
              )}
            >
              <input
                type="radio"
                name="analytics-count-by"
                value={key}
                checked={countBy === key}
                onChange={() => {
                  setCountBy(key)
                  onDraftChange?.({ countBy: key })
                }}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'size-4 rounded-circle border-2',
                  countBy === key ? 'border-pine bg-pine' : 'border-line-strong bg-surface',
                )}
              />
              {key === 'visit' ? 'ご来店日' : '受付日'}
            </label>
          ))}
        </div>
      </div>
      <section className="min-w-0 max-w-full rounded-panel border border-line bg-surface px-5.5 py-5">
        <h3 className="text-title font-bold text-ink">
          {appliedLabels[report.selectedGranularity]}の予約数
        </h3>
        <p className="mt-1 text-grid text-ink-muted">{report.definition}</p>
        <div className="mt-4 min-w-0 max-w-full overflow-x-auto pb-1">
          <VerticalBars
            points={report.points}
            target={report.selectedGranularity === 'day' ? 24 : undefined}
            ticks={report.selectedGranularity === 'day' ? [24, 18, 12, 6, 0] : undefined}
            showValues={false}
            ariaLabel={`${appliedLabels[report.selectedGranularity]}の予約数。${countByLabel}で数えます。最も多いのは${maximum?.label ?? '—'}の${maximum?.value ?? 0}件${closed > 0 ? `、定休${closed}日は0件` : ''}${report.pendingDays ? `、${report.pendingDays}日ぶんはまだ集計中` : ''}。`}
          />
        </div>
      </section>
      <SummaryFigures summary={report.summary} label="予約数のまとめ" />
    </div>
  )
}

function StaffTab({ report }: { report: StaffReport }) {
  const sorted = [...report.staff].sort(
    (left, right) => Number(Boolean(left.unassigned)) - Number(Boolean(right.unassigned)),
  )
  const maximum = Math.max(1, ...sorted.map((staff) => staff.value))
  return (
    <div className="grid min-w-0 max-w-full gap-7 px-4 py-8 sm:px-10">
      <section className="min-w-0 max-w-full rounded-panel border border-line bg-surface px-5.5 py-5">
        <h3 className="text-title font-bold text-ink">{report.title}</h3>
        <p className="mt-1 text-grid text-ink-muted">{report.definition}</p>
        <div className="mt-4 overflow-x-auto">
          <table
            aria-label="担当者の集計"
            className="min-w-150 border-collapse border-line border-t"
          >
            <thead>
              <tr className="min-h-11 border-line border-b text-grid text-ink-muted">
                <th scope="col" className="w-72 px-2 py-3 text-left font-normal">
                  担当者
                </th>
                <th scope="col" className="min-w-72 px-2 py-3 text-left font-normal">
                  件数の棒
                </th>
                <th scope="col" className="w-28 px-2 py-3 text-right font-normal">
                  件数
                </th>
                <th scope="col" className="w-36 px-2 py-3 text-right font-normal">
                  90日以内の再来
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((staff) => (
                <tr
                  key={staff.name}
                  data-testid="staff-row"
                  className={cn(
                    'min-h-14 border-line border-b',
                    staff.unassigned && 'bg-surface-2',
                  )}
                >
                  <td className="w-72 px-2 py-3 text-body font-semibold text-ink">
                    {staff.name}
                    <small className="ml-2 text-grid font-normal text-ink-muted">
                      {staff.role}
                    </small>
                  </td>
                  <td className="min-w-72 px-2 py-3">
                    <span className="block h-4.5 overflow-hidden rounded-ctl bg-surface-2">
                      <i
                        aria-hidden="true"
                        className={cn(
                          'block h-full rounded-ctl bg-pine',
                          staff.unassigned && 'analytics-pattern-hatch',
                        )}
                        style={{ width: `${(staff.value / maximum) * 100}%` }}
                      />
                    </span>
                  </td>
                  <td className="w-28 px-2 py-3 text-right font-mono text-lead font-semibold text-ink">
                    {staff.value} 件
                  </td>
                  <td className="w-36 px-2 py-3 text-right text-body text-ink-muted">
                    {staff.returnRate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function WaitTab({ report }: { report: WaitReport }) {
  const emptyHours = [
    '10時台',
    '11時台',
    '12時台',
    '13時台',
    '14時台',
    '15時台',
    '16時台',
    '17時台',
    '18時台',
  ]
  const hourly =
    report.hourly.length === 0
      ? emptyHours.map((label) => ({ label, value: 0, display: '—', isOverTarget: false }))
      : report.hourly
  const rawMaximum = Math.max(1, report.targetSeconds, ...report.hourly.map((item) => item.value))
  const maximum = Math.max(900, Math.ceil(rawMaximum / 300) * 300)
  const ticks = Array.from({ length: maximum / 300 + 1 }, (_, index) => maximum - index * 300)
  const isOver = report.isOverTarget ?? report.hourly.some((item) => item.isOverTarget)
  const longest = report.hourly.reduce<(typeof report.hourly)[number] | undefined>(
    (best, item) => (!best || item.value > best.value ? item : best),
    undefined,
  )
  const label =
    report.hourly.length === 0
      ? '時間帯ごとのお待ち時間。データはありません。'
      : `時間帯ごとのお待ち時間の中央値。${longest?.label ?? '—'}が${longest?.display ?? '—'}でもっとも長く、店舗の目安${report.target}を${longest?.isOverTarget ? '超えています' : '超えていません'}。`
  return (
    <div className="grid min-w-0 max-w-full gap-8 px-10 py-8">
      <section>
        <p className="text-grid text-ink-muted">受付からご相談開始まで（中央値）</p>
        <p
          className={cn(
            'mt-1 font-mono text-hero font-semibold',
            isOver ? 'text-danger' : 'text-ink',
          )}
        >
          {report.median}
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-3 text-grid text-ink-muted">
          {isOver ? (
            <span className="rounded-ctl border border-danger bg-danger-soft px-2 py-1 font-semibold text-danger">
              目安 {report.target}を超えています
            </span>
          ) : (
            <span>目安 {report.target}以内です</span>
          )}
          <span>
            前の月は {report.previousMedian}／{report.sample}
          </span>
        </p>
      </section>
      <section className="min-w-0 max-w-full rounded-panel border border-line bg-surface px-5.5 py-5">
        <h3 className="text-title font-bold text-ink">
          時間帯ごとのお待ち時間{' '}
          <small className="text-grid font-normal text-ink-muted">中央値</small>
        </h3>
        <p className="mt-1 text-grid text-ink-muted">目安 {report.target}</p>
        <ul
          aria-label="お待ち時間の凡例"
          className="mt-2 flex flex-wrap gap-3 text-grid text-ink-muted"
        >
          <li className="flex items-center gap-1.5">
            <i
              aria-hidden="true"
              data-pattern="solid"
              className="size-3.5 rounded-ctl bg-current text-pine"
            />
            <span>目安の内</span>
          </li>
          <li className="flex items-center gap-1.5">
            <i
              aria-hidden="true"
              data-pattern="hatch"
              className="size-3.5 rounded-ctl bg-current text-danger analytics-pattern-hatch"
            />
            <span>目安を超えた時間帯</span>
          </li>
        </ul>
        <div
          data-testid="wait-chart-scroll"
          className="mt-4 min-w-0 max-w-full overflow-x-auto pb-1"
        >
          <div role="img" aria-label={label} className="min-w-150 border-line-strong border-b">
            <div className="relative flex h-50 items-end gap-4 border-line border-y pl-10 pr-3">
              <ChartGridlines ticks={ticks} formatTick={(value) => `${value / 60}分`} />
              <span
                aria-hidden="true"
                data-testid="wait-target-line"
                className="pointer-events-none absolute right-1/3 left-1/3 z-10 border-pine border-t-2 border-dashed text-right text-grid font-semibold text-pine"
                style={{ bottom: `${(report.targetSeconds / maximum) * 100}%` }}
              />
              {hourly.map((item) => (
                <div key={item.label} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                  <span
                    className={cn(
                      'min-h-7 text-center text-grid',
                      item.isOverTarget ? 'font-semibold text-danger' : 'text-ink-muted',
                    )}
                  >
                    {item.display}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mx-auto block w-3/4 rounded-t-ctl',
                      item.isOverTarget ? 'bg-danger analytics-pattern-hatch' : 'bg-pine',
                    )}
                    style={{ height: `${(item.value / maximum) * 100}%` }}
                  />
                  <span className="mt-1.5 min-h-7 text-center text-grid text-ink-muted">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
            {report.hourly.length === 0 ? (
              <p className="px-5 py-3 text-body text-ink-muted">
                この期間に時間帯別のお待ち時間はありません。
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}

function CancelTab({ report }: { report: CancelReport }) {
  const months = [
    ...new Set(report.series.flatMap((series) => series.points.map((point) => point.label))),
  ]
  const maximum = Math.max(
    1,
    ...months.map((month) =>
      report.series.reduce(
        (sum, series) => sum + (series.points.find((point) => point.label === month)?.value ?? 0),
        0,
      ),
    ),
  )
  const ticks = niceTicks(maximum)
  const scaleMaximum = ticks[0] ?? maximum
  const monthDetails = months.map((month) => {
    const details = report.series.map((series) => ({
      name: series.name,
      value: series.points.find((point) => point.label === month)?.value ?? 0,
    }))
    const total = details.reduce((sum, item) => sum + item.value, 0)
    const rate =
      report.series
        .flatMap((entry) => entry.points)
        .find((point) => point.label === month && point.secondaryValue !== null)?.secondaryValue ??
      null
    return {
      month,
      details,
      total,
      rate,
      rateLabel: total === 0 || rate === null ? '—' : `${(rate * 100).toFixed(1)}%`,
    }
  })
  const highestMonth = monthDetails.reduce<(typeof monthDetails)[number] | undefined>(
    (best, item) => {
      if (!best) return item
      const itemRate = item.rate ?? -1
      const bestRate = best.rate ?? -1
      return itemRate > bestRate || (itemRate === bestRate && item.total > best.total) ? item : best
    },
    undefined,
  )
  return (
    <div className="grid min-w-0 max-w-full gap-8 px-10 py-8">
      <section className="min-w-0 max-w-full rounded-panel border border-line bg-surface px-5.5 py-5">
        <h3 className="text-title font-bold text-ink">{report.title}</h3>
        <p className="mt-1 text-grid text-ink-muted">{report.definition}</p>
        <Legend series={report.series} />
        <div
          data-testid="cancel-chart-scroll"
          className="mt-4 min-w-0 max-w-full overflow-x-auto pb-1"
        >
          <div
            role="img"
            aria-label={`月ごとの取り消し。${report.definition}。${highestMonth?.month ?? '—'}が${highestMonth?.total ?? 0}件${highestMonth?.rateLabel === '—' || highestMonth === undefined ? '' : `・${highestMonth.rateLabel}`}で最も高い。${report.target}`}
            className="relative flex h-50 min-w-150 items-end gap-6 overflow-hidden border-line-strong border-b pl-10"
          >
            <ChartGridlines ticks={ticks} />
            {monthDetails.map(({ month, total, rateLabel }) => {
              return (
                <div key={month} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                  <div
                    className="mx-auto flex w-3/4 flex-col-reverse"
                    style={{ height: `${(total / scaleMaximum) * 100}%` }}
                  >
                    {report.series.map((series) => {
                      const point = series.points.find((entry) => entry.label === month)
                      if (!point) return null
                      return (
                        <span
                          key={series.name}
                          className={cn(
                            'block w-full bg-current',
                            series.tone === 'danger'
                              ? 'text-danger'
                              : series.tone === 'web'
                                ? 'text-web'
                                : series.tone === 'walkin'
                                  ? 'text-walkin'
                                  : 'text-pine',
                            series.pattern === 'hatch'
                              ? 'analytics-pattern-hatch'
                              : series.pattern === 'dot'
                                ? 'analytics-pattern-dot'
                                : undefined,
                          )}
                          style={{ height: `${(point.value / Math.max(1, total)) * 100}%` }}
                        >
                          <span className="sr-only">
                            {series.name} {point.value}件
                          </span>
                        </span>
                      )
                    })}
                  </div>
                  <span className="mt-1.5 min-h-7 text-center text-grid text-ink-muted">
                    {month}　{total}件・{rateLabel}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <table className="sr-only" aria-label="月別の取り消し内訳">
          <thead>
            <tr>
              <th scope="col">月</th>
              <th scope="col">件数</th>
              <th scope="col">率</th>
              <th scope="col">内訳</th>
            </tr>
          </thead>
          <tbody>
            {monthDetails.map(({ month, total, rateLabel, details }) => (
              <tr key={month}>
                <th scope="row">{month}</th>
                <td>{total}件</td>
                <td>{rateLabel}</td>
                <td>{details.map((item) => `${item.name} ${item.value}件`).join('、')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-grid font-semibold text-ink-muted">{report.target}</p>
      </section>
      <section>
        <h3 className="text-title font-bold text-ink">6か月のまとめ</h3>
        <ul
          aria-label="取り消しのまとめ"
          className="mt-2 list-none divide-y divide-line border-line border-y"
        >
          {report.summary.map((item) => (
            <li key={item.label} className="flex flex-wrap gap-2 py-3">
              <span className="w-60 shrink-0 font-semibold text-ink">{item.label}</span>
              <span
                className={cn('text-body', item.isOverTarget ? 'text-danger' : 'text-ink-muted')}
              >
                <b className="font-mono text-title">{item.value}</b>
                {item.unit && ` ${item.unit}`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export function OfficialTab({
  report,
  onCountDraftChange,
}: {
  report: OfficialAnalyticsReport
  onCountDraftChange?: (next: {
    granularity?: CountReport['selectedGranularity']
    countBy?: CountReport['selectedCountBy']
  }) => void
}) {
  if (report.tab === 'top') return <TopTab report={report} />
  if (report.tab === 'count') return <CountTab report={report} onDraftChange={onCountDraftChange} />
  if (report.tab === 'staff') return <StaffTab report={report} />
  if (report.tab === 'wait') return <WaitTab report={report} />
  return <CancelTab report={report} />
}
