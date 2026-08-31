/**
 * `analytics_daily` の行 → タブ 1 枚ぶんの `AnalyticsReport`（**純関数**）。
 *
 * 生データを 1 行も読まない。読むのは日次集計の行だけである（`03-data-model.md` §11.4）。
 *
 * ここが守る 3 つ:
 * 1. **人数（「名」）を返さない。** ラベルにも単位にも「名」を書かない。
 * 2. **根拠にできない率を数字で返さない。** 分母が 20 件未満は `null`（画面の「—」）。
 *    担当未定は分母がいくらあっても常に `null`（誰の再来か言えないため）。
 * 3. **定休（`closed=1` の行がある）と欠測（行が無い）を混ぜない。**
 *    欠測の日は点を返さず `pendingDays` に数え、定休は value=0 の点を返す。
 */

import type { AnalyticsQuery, AnalyticsReport, AnalyticsTargets } from '@app/contracts'
import { toJstDateString } from '@app/shared'
import {
  businessDaysIn,
  datesInRange,
  formatSeconds,
  isOverCancellationTarget,
  isOverWaitTarget,
  jstWeekday,
  pendingDaysIn,
  rateOrNull,
  roundRate1,
  UNASSIGNED_KEY,
  weekBuckets,
  weightedMedian,
} from './analytics'

/** 読み出した `analytics_daily` の 1 行。 */
export type DailyRow = {
  date: string
  metric: string
  dimension: string
  dimensionKey: string
  value: number
}

export type ReportInput = {
  query: AnalyticsQuery
  rows: readonly DailyRow[]
  /** お待ち時間タブの「前の月の中央値」に使う、前月の行だけ。 */
  previousMonthRows: readonly DailyRow[]
  /** 件数 0 の担当も点として返すための名簿（並び順は `sort_order`）。 */
  staffList: readonly { id: string; name: string }[]
  /** 目的 id → 表示名（削除済みも引く）。 */
  purposeNames: ReadonlyMap<string, string>
  /** 「本日」の判定に使う基準時刻。**この関数は時計を読まない。** */
  now: string | Date
  targets: AnalyticsTargets
}

type Point = {
  key: string
  label: string
  value: number
  secondaryValue: number | null
  isClosed: boolean
  isOverTarget: boolean
}
type Series = { name: string; pattern: 'solid' | 'hatch' | 'dot'; points: Point[] }
type Summary = { label: string; value: string; unit: string; isOverTarget: boolean }

/** 点の `key` は 20 文字まで（契約）。uuid はそのまま入らないので頭を取る。 */
const shortKey = (id: string): string => id.slice(0, 20)

const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'] as const

/** 取り消しの 5 層。文字は CHANGE-CANCEL の 4 択と 1 字も違えない。 */
const CANCEL_LAYERS: readonly { key: string; name: string; pattern: Series['pattern'] }[] = [
  { key: 'customer', name: 'お客様のご都合', pattern: 'solid' },
  { key: 'store', name: '店舗の都合', pattern: 'hatch' },
  { key: 'duplicate', name: '予約の重複', pattern: 'dot' },
  { key: 'no_show', name: 'ご来店がなかった', pattern: 'hatch' },
  { key: 'web', name: 'Webからの取消', pattern: 'dot' },
]

/** ご予約の入口 4 つ。 */
const SOURCES: readonly { key: string; name: string; pattern: Series['pattern'] }[] = [
  { key: 'phone', name: 'お電話', pattern: 'solid' },
  { key: 'counter', name: '店頭', pattern: 'hatch' },
  { key: 'web', name: 'Web予約', pattern: 'dot' },
  { key: 'walkin', name: 'ウォークイン', pattern: 'solid' },
]

/** 来店回数の 4 階級。`dimension='visit_frequency'` の語彙と同じ順。 */
const VISIT_FREQUENCY_CLASSES: readonly { key: string; name: string }[] = [
  { key: 'first', name: '初めて' },
  { key: 'second', name: '2回目' },
  { key: 'third_to_fifth', name: '3〜5回' },
  { key: 'sixth_plus', name: '6回以上' },
]

/** `2026-08-27` → `8/27`。 */
function monthDay(date: string): string {
  const [, m, d] = date.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 期間の集計軸。日・月・曜日・時間帯の 4 つ。 */
type Bucket = { key: string; label: string; dates: string[]; isClosed: boolean }

function bucketsOf(
  granularity: AnalyticsQuery['granularity'],
  dates: readonly string[],
  closedByDate: ReadonlyMap<string, boolean>,
  today: string,
): Bucket[] {
  // 集計できていない日（`closed` の行が無い日）は点にしない。数字にすると 0 件に見える。
  const known = dates.filter((date) => closedByDate.has(date))
  if (granularity === 'day') {
    return known.map((date) => ({
      key: date,
      label: date === today ? `${monthDay(date)} 本日` : monthDay(date),
      dates: [date],
      isClosed: closedByDate.get(date) === true,
    }))
  }
  if (granularity === 'month') {
    const months = [...new Set(known.map((date) => date.slice(0, 7)))]
    return months.map((month) => ({
      key: month,
      label: `${Number(month.slice(5))}月`,
      dates: known.filter((date) => date.startsWith(month)),
      isClosed: false,
    }))
  }
  if (granularity === 'weekday') {
    return WEEKDAY_LABELS.map((label, index) => ({
      key: `w${index}`,
      label,
      // `jstWeekday` は 0=日。月曜始まりへ寄せる。
      dates: known.filter((date) => (jstWeekday(date) + 6) % 7 === index),
      isClosed: false,
    }))
  }
  return []
}

/** 行を「次元の鍵 → 日付 → 値」に畳む。 */
function indexRows(
  rows: readonly DailyRow[],
  metric: string,
  dimension: string,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const row of rows) {
    if (row.metric !== metric || row.dimension !== dimension) continue
    const byDate = out.get(row.dimensionKey) ?? new Map<string, number>()
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.value)
    out.set(row.dimensionKey, byDate)
  }
  return out
}

const sumOver = (byDate: Map<string, number> | undefined, dates: readonly string[]): number =>
  dates.reduce((total, date) => total + (byDate?.get(date) ?? 0), 0)

const sumAll = (byDate: Map<string, number> | undefined): number =>
  [...(byDate?.values() ?? [])].reduce((total, value) => total + value, 0)

const point = (over: Partial<Point> & Pick<Point, 'key' | 'label' | 'value'>): Point => ({
  secondaryValue: null,
  isClosed: false,
  isOverTarget: false,
  ...over,
})

/** 1 日あたり。分母は**営業日数**で、暦日数では割らない。 */
function perDay(total: number, businessDays: number): string {
  if (businessDays === 0) return '—'
  return String(Math.round((total / businessDays) * 10) / 10)
}

/** 時間帯の鍵を数として並べる（`'9'` が `'10'` より前に来るようにする）。 */
const byHour = (a: string, b: string): number => Number(a) - Number(b)

export function buildReport(input: ReportInput): AnalyticsReport {
  const { query, rows, targets } = input
  const dates = datesInRange(query.from, query.to)
  const today = toJstDateString(input.now)

  const closedByDate = new Map<string, boolean>()
  for (const row of rows) {
    if (row.metric === 'closed' && row.dimension === 'total') {
      closedByDate.set(row.date, row.value === 1)
    }
  }
  const businessDays = businessDaysIn(dates, closedByDate)
  const pendingDays = pendingDaysIn(dates, new Set(closedByDate.keys()))
  const buckets = bucketsOf(query.granularity, dates, closedByDate, today)

  const base = {
    metric: query.metric,
    from: query.from,
    to: query.to,
    granularity: query.granularity,
    countBy: query.countBy,
    businessDays,
    pendingDays,
  }

  /** 予約の metric は「かぞえる日」で入れ替える（同じ予約が別の日に落ちる）。 */
  const reservationMetric =
    query.countBy === 'received_date' ? 'reservations_received' : 'reservations'

  const finish = (
    series: Series[],
    summary: Summary[],
    extra: { target: number | null; suppressed: boolean },
  ): AnalyticsReport =>
    ({
      ...base,
      series,
      summary,
      ...extra,
    }) satisfies AnalyticsReport

  if (query.metric === 'overview' || query.metric === 'reservation_count') {
    const totals = indexRows(rows, reservationMetric, 'total').get('') ?? new Map()
    const isHour = query.granularity === 'hour'
    const hourly = indexRows(rows, reservationMetric, 'hour')
    const points: Point[] = isHour
      ? [...hourly.keys()].sort(byHour).map((hour) =>
          point({
            key: hour,
            label: `${hour}時`,
            value: sumOver(hourly.get(hour), dates),
          }),
        )
      : buckets.map((bucket) =>
          point({
            key: bucket.key,
            label: bucket.label,
            value: sumOver(totals, bucket.dates),
            isClosed: bucket.isClosed,
          }),
        )

    const total = points.reduce((sum, p) => sum + p.value, 0)
    const top = [...points].sort((a, b) => b.value - a.value)[0]
    const summary: Summary[] =
      query.metric === 'overview'
        ? weekSummary(totals, input.now)
        : [
            { label: '合計', value: String(total), unit: '件', isOverTarget: false },
            {
              label: '1日あたり',
              value: perDay(total, businessDays),
              unit: '件',
              isOverTarget: false,
            },
            {
              label: '最も多い日',
              value: top === undefined ? '—' : top.label,
              unit: '',
              isOverTarget: false,
            },
          ]
    return finish(
      [{ name: query.metric === 'overview' ? 'ご予約' : 'ご予約の件数', pattern: 'solid', points }],
      summary,
      { target: null, suppressed: false },
    )
  }

  if (query.metric === 'reservation_source') {
    const bySource = indexRows(rows, reservationMetric, 'source')
    const series: Series[] = SOURCES.map((source) => ({
      name: source.name,
      pattern: source.pattern,
      points: buckets.map((bucket) =>
        point({
          key: bucket.key,
          label: bucket.label,
          value: sumOver(bySource.get(source.key), bucket.dates),
          isClosed: bucket.isClosed,
        }),
      ),
    }))
    const totals = SOURCES.map((source) => sumAll(bySource.get(source.key)))
    const total = totals.reduce((sum, value) => sum + value, 0)
    const topIndex = totals.indexOf(Math.max(...totals))
    return finish(
      series,
      [
        { label: '合計', value: String(total), unit: '件', isOverTarget: false },
        {
          label: '最も多い入口',
          value: total === 0 ? '—' : (SOURCES[topIndex]?.name ?? '—'),
          unit: '',
          isOverTarget: false,
        },
        { label: '1日あたり', value: perDay(total, businessDays), unit: '件', isOverTarget: false },
      ],
      { target: null, suppressed: false },
    )
  }

  if (query.metric === 'cancellation') {
    const byLayer = indexRows(rows, 'cancellations', 'cancel_reason')
    const cancelledIn = (bucketDates: readonly string[]): number =>
      CANCEL_LAYERS.reduce((sum, layer) => sum + sumOver(byLayer.get(layer.key), bucketDates), 0)
    const keptByDate = indexRows(rows, 'reservations', 'total').get('')
    /**
     * 区間ごとの取消率。分母は「来店予定だった予約の総数」（取消・無断を**含む**）。
     * 画面は棒の下の「7月　37件・11.9%」と「最も高い月」をこの率から出すので、
     * **率をここで 1 度だけ出し、画面で割り直させない**（分母がずれる）。
     */
    const rateOfBucket = (bucketDates: readonly string[]): number | null => {
      const taken = cancelledIn(bucketDates)
      return rateOrNull(taken, sumOver(keptByDate, bucketDates) + taken)
    }
    // 取消が 1 件も無い区間は点を返さない（0 の棒を積み上げても読めない）。
    const live = buckets.filter((bucket) => cancelledIn(bucket.dates) > 0)
    const series: Series[] = CANCEL_LAYERS.map((layer) => ({
      name: layer.name,
      pattern: layer.pattern,
      points: live.map((bucket) => {
        const bucketRate = rateOfBucket(bucket.dates)
        return point({
          key: bucket.key,
          label: bucket.label,
          value: sumOver(byLayer.get(layer.key), bucket.dates),
          secondaryValue: bucketRate,
          isClosed: bucket.isClosed,
          isOverTarget: bucketRate !== null && isOverCancellationTarget(bucketRate, targets),
        })
      }),
    }))

    const cancelled = cancelledIn(dates)
    const kept = sumOver(keptByDate, dates)
    // 分母は「その期間に来店予定だった予約の総数」。取消・無断を**含む**。
    const denominator = kept + cancelled
    const rate = rateOrNull(cancelled, denominator)
    return finish(
      series,
      [
        {
          label: '取消率',
          value: rate === null ? '—' : String(roundRate1(rate)),
          unit: '%',
          isOverTarget: rate !== null && isOverCancellationTarget(rate, targets),
        },
        { label: '取消件数', value: String(cancelled), unit: '件', isOverTarget: false },
        {
          label: '来店予定だった総数',
          value: String(denominator),
          unit: '件',
          isOverTarget: false,
        },
      ],
      { target: targets.cancellationRatePercent, suppressed: rate === null },
    )
  }

  if (query.metric === 'visit_frequency') {
    const byClass = indexRows(rows, 'receptions', 'visit_frequency')
    const points = VISIT_FREQUENCY_CLASSES.map((klass) =>
      point({
        key: klass.key,
        label: klass.name,
        value: sumOver(byClass.get(klass.key), dates),
      }),
    )
    const total = points.reduce((sum, p) => sum + p.value, 0)
    return finish(
      [{ name: 'ご来店の回数', pattern: 'solid', points }],
      [
        { label: '合計', value: String(total), unit: '件', isOverTarget: false },
        {
          label: '初めて',
          value: String(points[0]?.value ?? 0),
          unit: '件',
          isOverTarget: false,
        },
        {
          label: '6回以上',
          value: String(points[3]?.value ?? 0),
          unit: '件',
          isOverTarget: false,
        },
      ],
      { target: null, suppressed: false },
    )
  }

  if (query.metric === 'staff') {
    const receptions = indexRows(rows, 'receptions', 'staff')
    const revisits = indexRows(rows, 'revisits_90d', 'staff')
    const keys = [
      ...new Set([
        ...input.staffList.map((row) => row.id),
        ...receptions.keys(),
        ...revisits.keys(),
      ]),
    ].filter((key) => key !== UNASSIGNED_KEY)
    const nameOf = new Map(input.staffList.map((row) => [row.id, row.name]))

    const points = keys
      .map((key) =>
        point({
          key: shortKey(key),
          label: nameOf.get(key) ?? '（退職された担当）',
          value: sumOver(receptions.get(key), dates),
          // 分母 20 件ちょうどは率を出し、19 件は伏せる。
          secondaryValue: rateOrNull(
            sumOver(revisits.get(key), dates),
            sumOver(receptions.get(key), dates),
          ),
        }),
      )
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))

    const unassigned = sumOver(receptions.get(UNASSIGNED_KEY), dates)
    // 担当が未定は並びの最後。**誰の再来か言えない**ので率は常に伏せる。
    points.push(
      point({
        key: UNASSIGNED_KEY,
        label: '担当未定',
        value: unassigned,
        secondaryValue: null,
      }),
    )

    const total = points.reduce((sum, p) => sum + p.value, 0)
    const top = points.filter((p) => p.key !== UNASSIGNED_KEY).sort((a, b) => b.value - a.value)[0]
    return finish(
      [{ name: 'ご来店の受付', pattern: 'solid', points }],
      [
        { label: '合計', value: String(total), unit: '件', isOverTarget: false },
        {
          label: '最も多い担当',
          value: top === undefined || top.value === 0 ? '—' : top.label,
          unit: '',
          isOverTarget: false,
        },
        { label: '担当未定', value: String(unassigned), unit: '件', isOverTarget: false },
      ],
      { target: targets.revisitWindowDays, suppressed: false },
    )
  }

  if (query.metric === 'purpose') {
    const byPurpose = indexRows(rows, reservationMetric, 'purpose')
    const points = [...byPurpose.keys()]
      .map((key) =>
        point({
          key: shortKey(key),
          // 削除された目的も、期間に予約があれば名前のまま残す。
          label: input.purposeNames.get(key) ?? '（削除されたご用件）',
          value: sumOver(byPurpose.get(key), dates),
        }),
      )
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    const total = points.reduce((sum, p) => sum + p.value, 0)
    return finish(
      [{ name: 'ご来店の目的', pattern: 'solid', points }],
      [
        { label: '合計', value: String(total), unit: '件', isOverTarget: false },
        {
          label: '最も多いご用件',
          value: points[0]?.label ?? '—',
          unit: '',
          isOverTarget: false,
        },
        { label: 'ご用件の数', value: String(points.length), unit: '件', isOverTarget: false },
      ],
      { target: null, suppressed: false },
    )
  }

  /* --- お待ち時間 -------------------------------------------------------- */

  const waitByHour = indexRows(rows, 'wait_seconds_median', 'hour')
  const receptionsByHour = indexRows(rows, 'receptions', 'hour')
  const points = [...waitByHour.keys()]
    .sort(byHour)
    .map((hour) => {
      const daily = waitByHour.get(hour) ?? new Map<string, number>()
      const weights = receptionsByHour.get(hour) ?? new Map<string, number>()
      const median = weightedMedian(
        [...daily].map(([date, value]) => ({ value, weight: weights.get(date) ?? 0 })),
      )
      return median === null
        ? null
        : point({
            key: hour,
            label: `${hour}時`,
            value: median,
            isOverTarget: isOverWaitTarget(median, targets),
          })
    })
    // 受付が 1 件も無い時間帯は点を返さない（軸だけ残すのは画面の仕事）。
    .filter((p): p is Point => p !== null)

  const waitTotal = indexRows(rows, 'wait_seconds_median', 'total').get('') ?? new Map()
  const receptionTotal = indexRows(rows, 'receptions', 'total').get('') ?? new Map()
  const overall = weightedMedian(
    [...waitTotal].map(([date, value]) => ({ value, weight: receptionTotal.get(date) ?? 0 })),
  )
  const previousWait = indexRows(input.previousMonthRows, 'wait_seconds_median', 'total').get('')
  const previousReceptions = indexRows(input.previousMonthRows, 'receptions', 'total').get('')
  const previous = weightedMedian(
    [...(previousWait ?? [])].map(([date, value]) => ({
      value,
      weight: previousReceptions?.get(date) ?? 0,
    })),
  )
  const receptions = sumOver(receptionTotal, dates)

  return finish(
    [{ name: 'お待ち時間の中央値', pattern: 'solid', points }],
    [
      {
        label: '中央値',
        value: overall === null ? '—' : formatSeconds(overall),
        unit: '',
        isOverTarget: overall !== null && isOverWaitTarget(overall, targets),
      },
      {
        label: '前の月の中央値',
        value: previous === null ? '—' : formatSeconds(previous),
        unit: '',
        isOverTarget: false,
      },
      { label: '受付', value: String(receptions), unit: '件', isOverTarget: false },
    ],
    { target: targets.waitMinutes * 60, suppressed: false },
  )
}

/** トップのまとめ 3 行（先週・今週・来週）。単位は「件」だけで、人数を書かない。 */
function weekSummary(totals: Map<string, number>, now: string | Date): Summary[] {
  // 週の区切りは月曜始まり。`weekBuckets` と同じ数え方をここで書き直さない。
  const { last, current, next } = weekBuckets(now)
  return [
    {
      label: '先週',
      value: String(sumOver(totals, datesOf(last))),
      unit: '件',
      isOverTarget: false,
    },
    {
      label: '今週',
      value: String(sumOver(totals, datesOf(current))),
      unit: '件',
      isOverTarget: false,
    },
    {
      label: '来週',
      value: String(sumOver(totals, datesOf(next))),
      unit: '件',
      isOverTarget: false,
    },
  ]
}

const datesOf = (range: { from: string; to: string }): string[] =>
  datesInRange(range.from, range.to)
