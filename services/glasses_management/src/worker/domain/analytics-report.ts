import type { AnalyticsMetric } from '@app/contracts'
import {
  businessDaysFromClosedRows,
  histogramMedian,
  isOverCancellationTarget,
  isOverWaitTarget,
  weekRange,
} from './analytics'

export interface AnalyticsReportDailyRow {
  date: string
  metric: string
  dimension: string
  dimensionKey: string
  dimensionLabel: string
  value: number
}

export interface BuildAnalyticsReportInput {
  metric: AnalyticsMetric
  from: string
  to: string
  granularity: 'day' | 'month' | 'hour' | 'weekday'
  countBy: 'visit_date' | 'received_date'
  rows: readonly AnalyticsReportDailyRow[]
  comparisonRows?: readonly AnalyticsReportDailyRow[]
  /** トップの3週まとめ専用。15日グラフの表示範囲外（月〜日）を補う。 */
  overviewRows?: readonly AnalyticsReportDailyRow[]
}

type Point = {
  key: string
  label: string
  value: number
  secondaryValue: number | null
  isClosed: boolean
  isOverTarget: boolean
}
type Series = { name: string; points: Point[]; pattern: 'solid' | 'hatch' | 'dot' }
type Summary = { label: string; value: string; unit: string; isOverTarget: boolean }

const weekdays = ['日', '月', '火', '水', '木', '金', '土']
const cancellationCategories = [
  ['customer', 'お客様のご都合'],
  ['store', '店舗の都合'],
  ['duplicate', '予約の重複'],
  ['no_show', 'ご来店がなかった'],
  ['web', 'Webからの取消'],
] as const
const fallbackLabels: Record<string, string> = {
  phone: 'お電話',
  counter: '店頭',
  web: 'Web予約',
  walkin: 'ウォークイン',
  customer: 'お客様のご都合',
  store: '店舗の都合',
  duplicate: '予約の重複',
  no_show: 'ご来店がなかった',
  first: '初めて',
  second: '2回目',
  third_to_fifth: '3〜5回',
  sixth_or_more: '6回以上',
  unassigned: '担当が未定',
}

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = []
  for (let day = new Date(`${from}T00:00:00.000Z`); day <= new Date(`${to}T00:00:00.000Z`); ) {
    dates.push(day.toISOString().slice(0, 10))
    day.setUTCDate(day.getUTCDate() + 1)
  }
  return dates
}
function monthsBetween(from: string, to: string): string[] {
  const months: string[] = []
  const end = new Date(`${to.slice(0, 7)}-01T00:00:00.000Z`)
  for (let month = new Date(`${from.slice(0, 7)}-01T00:00:00.000Z`); month <= end; ) {
    months.push(month.toISOString().slice(0, 7))
    month.setUTCMonth(month.getUTCMonth() + 1)
  }
  return months
}
function groupedKey(date: string, granularity: BuildAnalyticsReportInput['granularity']): string {
  if (granularity === 'month') return date.slice(0, 7)
  if (granularity === 'weekday') return String(new Date(`${date}T00:00:00.000Z`).getUTCDay())
  return date
}
function timeLabel(key: string, granularity: BuildAnalyticsReportInput['granularity']): string {
  return granularity === 'weekday' ? (weekdays[Number(key)] ?? key) : key
}
function rowLabel(row: AnalyticsReportDailyRow): string {
  if (row.dimensionLabel) return row.dimensionLabel
  if (row.dimension === 'hour') return `${row.dimensionKey}時`
  if (row.dimension === 'wait_seconds')
    return row.dimensionKey.replace(/^hour:(\d+):(\d+)$/, '$1時 $2秒')
  return fallbackLabels[row.dimensionKey] ?? (row.dimensionKey || '合計')
}
function rawMetric(input: BuildAnalyticsReportInput): 'reservations' | 'reservations_received' {
  return input.countBy === 'received_date' ? 'reservations_received' : 'reservations'
}
function rowsFor(rows: readonly AnalyticsReportDailyRow[], metric: string, dimension: string) {
  return rows.filter((row) => row.metric === metric && row.dimension === dimension)
}
function total(rows: readonly AnalyticsReportDailyRow[]) {
  return rows.reduce((value, row) => value + row.value, 0)
}
function grouped(
  rows: readonly AnalyticsReportDailyRow[],
  granularity: BuildAnalyticsReportInput['granularity'],
) {
  const values = new Map<string, number>()
  for (const row of rows) {
    const key = groupedKey(row.date, granularity)
    values.set(key, (values.get(key) ?? 0) + row.value)
  }
  return values
}
function pattern(index: number): Series['pattern'] {
  return index === 0 ? 'solid' : index === 1 ? 'hatch' : 'dot'
}

function dimensionTotals(
  input: BuildAnalyticsReportInput,
  metric: string,
  dimension: string,
): Series[] {
  const dimensions = new Map<string, { label: string; rows: AnalyticsReportDailyRow[] }>()
  for (const row of rowsFor(input.rows, metric, dimension)) {
    const entry = dimensions.get(row.dimensionKey) ?? { label: rowLabel(row), rows: [] }
    entry.rows.push(row)
    dimensions.set(row.dimensionKey, entry)
  }
  return [...dimensions.values()].map((entry, index) => ({
    name: entry.label,
    pattern: pattern(index),
    points: [
      {
        key: entry.rows[0]?.dimensionKey ?? entry.label,
        label: entry.label,
        value: total(entry.rows),
        secondaryValue: null,
        isClosed: false,
        isOverTarget: false,
      },
    ],
  }))
}
function cancellationSeries(
  input: BuildAnalyticsReportInput,
  denominators: ReadonlyMap<string, number>,
  cancellations: ReadonlyMap<string, number>,
): Series[] {
  const cancellationRows = rowsFor(input.rows, 'cancellations', 'cancellation_category')
  const months = monthsBetween(input.from, input.to)
  return cancellationCategories.map(([category, label], index) => ({
    name: label,
    pattern: pattern(index),
    points: months.map((month) => {
      const denominator = denominators.get(month) ?? 0
      return {
        key: month,
        label: `${Number(month.slice(5))}月`,
        value: total(
          cancellationRows.filter(
            (row) => row.dimensionKey === category && row.date.slice(0, 7) === month,
          ),
        ),
        secondaryValue: denominator >= 20 ? (cancellations.get(month) ?? 0) / denominator : null,
        isClosed: false,
        isOverTarget: false,
      }
    }),
  }))
}

export function analyticsStoredMetrics(
  metric: AnalyticsMetric,
  countBy: BuildAnalyticsReportInput['countBy'],
): string[] {
  const baseline = ['closed', 'scheduled_reservations']
  const reservationMetric = countBy === 'received_date' ? 'reservations_received' : 'reservations'
  if (metric === 'overview' || metric === 'reservation_count')
    return [...baseline, reservationMetric]
  if (metric === 'reservation_source' || metric === 'purpose')
    return [...baseline, reservationMetric]
  if (metric === 'visit_frequency') return [...baseline, 'receptions']
  if (metric === 'staff')
    return [...baseline, 'receptions', 'revisit_eligible', 'revisit_returning_90d']
  if (metric === 'wait_time') return [...baseline, 'wait_seconds_histogram', 'receptions']
  return [...baseline, 'cancellations']
}
function breakdownSummary(rows: readonly AnalyticsReportDailyRow[]): Summary[] {
  const amount = total(rows)
  const byKey = new Map<string, { label: string; value: number }>()
  for (const row of rows) {
    const item = byKey.get(row.dimensionKey) ?? { label: rowLabel(row), value: 0 }
    item.value += row.value
    byKey.set(row.dimensionKey, item)
  }
  const top = [...byKey.values()].sort((left, right) => right.value - left.value)[0]
  return [
    { label: '合計', value: String(amount), unit: '件', isOverTarget: false },
    { label: '最多', value: top?.label ?? '—', unit: '', isOverTarget: false },
    {
      label: '割合',
      value:
        top === undefined || amount === 0 ? '—' : `${((top.value / amount) * 100).toFixed(1)}%`,
      unit: '',
      isOverTarget: false,
    },
  ]
}

/** 表示側は入力された analytics_daily 行だけを読む。 */
export function buildAnalyticsReport(input: BuildAnalyticsReportInput) {
  const closedRows = rowsFor(input.rows, 'closed', 'total')
  const closedByDate = new Map(closedRows.map((row) => [row.date, row.value]))
  const scheduledDates = new Set(
    rowsFor(input.rows, 'scheduled_reservations', 'total').map((row) => row.date),
  )
  const businessDays = businessDaysFromClosedRows(closedRows)
  const pendingDays = datesBetween(input.from, input.to).filter(
    (date) => !closedByDate.has(date) && !scheduledDates.has(date),
  ).length
  const countMetric = rawMetric(input)
  let series: Series[] = []
  let summary: Summary[] = []
  let target: number | null = null
  let suppressed = false

  if (input.metric === 'reservation_source') {
    const rows = rowsFor(input.rows, countMetric, 'source')
    series = dimensionTotals(input, countMetric, 'source')
    summary = breakdownSummary(rows)
  } else if (input.metric === 'visit_frequency') {
    const rows = rowsFor(input.rows, 'receptions', 'visit_frequency')
    series = dimensionTotals(input, 'receptions', 'visit_frequency')
    summary = breakdownSummary(rows)
  } else if (input.metric === 'purpose') {
    const rows = rowsFor(input.rows, countMetric, 'purpose')
    series = dimensionTotals(input, countMetric, 'purpose')
    summary = breakdownSummary(rows)
  } else if (input.metric === 'staff') {
    const receptions = rowsFor(input.rows, 'receptions', 'staff')
    const labels = new Map(receptions.map((row) => [row.dimensionKey, rowLabel(row)]))
    const eligible = new Map<string, number>()
    const returning = new Map<string, number>()
    for (const row of input.rows) {
      if (row.dimension !== 'staff') continue
      if (row.metric === 'revisit_eligible')
        eligible.set(row.dimensionKey, (eligible.get(row.dimensionKey) ?? 0) + row.value)
      if (row.metric === 'revisit_returning_90d')
        returning.set(row.dimensionKey, (returning.get(row.dimensionKey) ?? 0) + row.value)
    }
    const ids = [
      ...new Set([
        ...receptions.map((row) => row.dimensionKey),
        ...eligible.keys(),
        ...returning.keys(),
      ]),
    ].sort((left, right) => {
      if (left === 'unassigned') return 1
      if (right === 'unassigned') return -1
      const leftLabel = labels.get(left) ?? fallbackLabels[left] ?? left
      const rightLabel = labels.get(right) ?? fallbackLabels[right] ?? right
      if (leftLabel < rightLabel) return -1
      if (leftLabel > rightLabel) return 1
      return left.localeCompare(right)
    })
    series = ids.map((id, index) => {
      const value = total(receptions.filter((row) => row.dimensionKey === id))
      const denominator = eligible.get(id) ?? 0
      const secondaryValue =
        id === 'unassigned' || denominator < 20 ? null : (returning.get(id) ?? 0) / denominator
      return {
        name: labels.get(id) ?? fallbackLabels[id] ?? '担当者',
        pattern: pattern(index),
        points: [
          {
            key: id,
            label: labels.get(id) ?? fallbackLabels[id] ?? '担当者',
            value,
            secondaryValue,
            isClosed: false,
            isOverTarget: false,
          },
        ],
      }
    })
    suppressed = [...eligible.entries()].some(([id, count]) => id !== 'unassigned' && count < 20)
    summary = [{ label: '合計', value: String(total(receptions)), unit: '件', isOverTarget: false }]
  } else if (input.metric === 'wait_time') {
    const buckets = rowsFor(input.rows, 'wait_seconds_histogram', 'wait_seconds')
    const median = histogramMedian(
      buckets.map((row) => ({ key: row.dimensionKey, value: row.value })),
    )
    const byHour = new Map<string, AnalyticsReportDailyRow[]>()
    for (const row of buckets) {
      const hour = /^hour:(\d+):/.exec(row.dimensionKey)?.[1]
      if (hour !== undefined) byHour.set(hour, [...(byHour.get(hour) ?? []), row])
    }
    series =
      median === null
        ? []
        : [
            {
              name: '中央値',
              pattern: 'solid',
              points: [...byHour.entries()]
                .sort(([left], [right]) => Number(left) - Number(right))
                .map(([hour, rows]) => {
                  const value =
                    histogramMedian(
                      rows.map((row) => ({ key: row.dimensionKey, value: row.value })),
                    ) ?? 0
                  return {
                    key: hour,
                    label: `${hour}時台`,
                    value,
                    secondaryValue: null,
                    isClosed: false,
                    isOverTarget: isOverWaitTarget(value),
                  }
                }),
            },
          ]
    const priorMedian = histogramMedian(
      rowsFor(input.comparisonRows ?? [], 'wait_seconds_histogram', 'wait_seconds').map((row) => ({
        key: row.dimensionKey,
        value: row.value,
      })),
    )
    target = 480
    summary = [
      {
        label: '待ち時間中央値',
        value: median === null ? '—' : String(median),
        unit: '秒',
        isOverTarget: median !== null && isOverWaitTarget(median),
      },
      {
        label: '前の月',
        value: priorMedian === null ? '—' : String(priorMedian),
        unit: '秒',
        isOverTarget: priorMedian !== null && isOverWaitTarget(priorMedian),
      },
      {
        label: '受付',
        value: String(total(rowsFor(input.rows, 'receptions', 'total'))),
        unit: '件',
        isOverTarget: false,
      },
    ]
  } else if (input.metric === 'cancellation') {
    const denominators = grouped(rowsFor(input.rows, 'scheduled_reservations', 'total'), 'month')
    const cancellations = grouped(
      rowsFor(input.rows, 'cancellations', 'cancellation_category'),
      'month',
    )
    const denominator = total(rowsFor(input.rows, 'scheduled_reservations', 'total'))
    const cancelled = total(rowsFor(input.rows, 'cancellations', 'cancellation_category'))
    const rate = denominator >= 20 ? (cancelled / denominator) * 100 : null
    series = cancellationSeries(input, denominators, cancellations)
    const highest = [...denominators.keys()]
      .filter((month) => (denominators.get(month) ?? 0) >= 20)
      .map((month) => ({
        month,
        rate: (cancellations.get(month) ?? 0) / (denominators.get(month) ?? 1),
      }))
      .sort((left, right) => right.rate - left.rate)[0]
    target = 10
    suppressed = denominator > 0 && denominator < 20
    summary = [
      {
        label: '取消率',
        value: rate === null ? '—' : `${rate.toFixed(1)}%`,
        unit: '',
        isOverTarget: rate !== null && isOverCancellationTarget(rate),
      },
      {
        label: '最も高い月',
        value: highest?.month ?? '—',
        unit: '',
        isOverTarget: highest !== undefined && isOverCancellationTarget(highest.rate * 100),
      },
      { label: '該当内訳', value: String(cancelled), unit: '件', isOverTarget: false },
    ]
  } else {
    const rows = rowsFor(input.rows, countMetric, 'total')
    const values = grouped(rows, input.granularity)
    const hours = new Map<string, { label: string; value: number }>()
    if (input.metric === 'reservation_count' && input.granularity === 'hour') {
      for (const row of rowsFor(input.rows, countMetric, 'hour')) {
        const item = hours.get(row.dimensionKey) ?? {
          label: `${row.dimensionKey}時台`,
          value: 0,
        }
        item.value += row.value
        hours.set(row.dimensionKey, item)
      }
    }
    if (input.granularity === 'day')
      for (const date of closedByDate.keys()) if (!values.has(date)) values.set(date, 0)
    series = [
      {
        name: input.metric === 'overview' ? '予約数' : '件数',
        pattern: 'solid',
        points: [...values.entries()].map(([key, value]) => ({
          key,
          label: timeLabel(key, input.granularity),
          value,
          secondaryValue: null,
          isClosed: input.granularity === 'day' && closedByDate.get(key) === 1,
          isOverTarget: false,
        })),
      },
    ]
    if (input.metric === 'reservation_count') {
      const maximum = Math.max(
        0,
        ...(input.granularity === 'hour'
          ? [...hours.values()].map((hour) => hour.value)
          : values.values()),
      )
      const completedRows = rows.filter((row) => closedByDate.has(row.date))
      summary = [
        { label: '合計', value: String(total(rows)), unit: '件', isOverTarget: false },
        {
          label: '1日あたり',
          value: businessDays === 0 ? '—' : (total(completedRows) / businessDays).toFixed(1),
          unit: '件',
          isOverTarget: false,
        },
        { label: '最大', value: String(maximum), unit: '件', isOverTarget: false },
      ]
    } else if (input.metric === 'overview') {
      const dates = datesBetween(input.from, input.to)
      const current = weekRange(dates[Math.floor(dates.length / 2)] ?? input.from)
      const overviewRows = rowsFor(input.overviewRows ?? input.rows, countMetric, 'total')
      const start = new Date(`${current.from}T00:00:00.000Z`)
      const previous = new Date(start)
      previous.setUTCDate(previous.getUTCDate() - 7)
      const previousEnd = new Date(start)
      previousEnd.setUTCDate(previousEnd.getUTCDate() - 1)
      const next = new Date(start)
      next.setUTCDate(next.getUTCDate() + 7)
      const ranges = [
        {
          label: '先週',
          from: previous.toISOString().slice(0, 10),
          to: previousEnd.toISOString().slice(0, 10),
        },
        { label: '今週', from: current.from, to: current.to },
        {
          label: '来週',
          from: next.toISOString().slice(0, 10),
          to: new Date(next.getTime() + 6 * 86_400_000).toISOString().slice(0, 10),
        },
      ]
      summary = ranges.map((range) => ({
        label: range.label,
        value: String(
          total(overviewRows.filter((row) => row.date >= range.from && row.date <= range.to)),
        ),
        unit: '件',
        isOverTarget: false,
      }))
    }
    if (input.metric === 'reservation_count' && input.granularity === 'hour') {
      series = [
        {
          name: '件数',
          pattern: 'solid',
          points: [...hours.entries()]
            .sort(([left], [right]) => Number(left) - Number(right))
            .map(([key, item]) => ({
              key,
              label: item.label,
              value: item.value,
              secondaryValue: null,
              isClosed: false,
              isOverTarget: false,
            })),
        },
      ]
    }
  }
  return {
    metric: input.metric,
    from: input.from,
    to: input.to,
    granularity: input.granularity,
    countBy: input.countBy,
    series,
    summary,
    target,
    suppressed,
    businessDays,
    pendingDays,
  }
}
