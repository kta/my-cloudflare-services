/**
 * P9 分析の時刻・率・中央値の純関数。D1 と時計は呼び出し側から渡す。
 */
import { toJstDateString } from '@app/shared'

const MS_PER_DAY = 24 * 60 * 60 * 1000

type ClosedRow = { date: string; value: number }
type HistogramBucket = { key: string; value: number }

function localDateMs(date: string): number {
  const ms = Date.parse(`${date}T00:00:00.000Z`)
  if (Number.isNaN(ms)) throw new Error(`invalid local date: ${date}`)
  return ms
}

function addDays(date: string, days: number): string {
  return new Date(localDateMs(date) + days * MS_PER_DAY).toISOString().slice(0, 10)
}

/** UTC の瞬間を JST 業務日へ落とす。 */
export function analyticsJstDate(instant: string | Date): string {
  return toJstDateString(instant)
}

/** 中心日の前後 7 日を含む 15 日間。 */
export function aroundRange(date: string): { from: string; to: string } {
  return { from: addDays(date, -7), to: addDays(date, 7) }
}

/** JST 月の最初と最後の日。 */
export function monthRange(month: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`invalid month: ${month}`)
  const from = `${month}-01`
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10)
  return { from, to: addDays(nextMonth, -1) }
}

/** 月曜始まりで、指定日を含む週の 7 日間。 */
export function weekRange(date: string): { from: string; to: string } {
  const weekday = new Date(localDateMs(date)).getUTCDay()
  const daysSinceMonday = (weekday + 6) % 7
  const from = addDays(date, -daysSinceMonday)
  return { from, to: addDays(from, 6) }
}

/** closed=0 の明示行だけを営業日として数える。欠測は 0 件営業日にしない。 */
export function businessDaysFromClosedRows(rows: readonly ClosedRow[]): number {
  return rows.filter((row) => row.value === 0).length
}

/** 表示値は小数第 1 位へ丸め、その表示値で取消率の札を判定する。 */
export function isOverCancellationTarget(percent: number): boolean {
  const displayed = Math.round((percent + Number.EPSILON) * 10) / 10
  return displayed > 10
}

/** 8 分ちょうどは内、8 分 1 秒から超過。 */
export function isOverWaitTarget(seconds: number): boolean {
  return seconds > 8 * 60
}

function histogramSeconds(key: string): number {
  const matched = /^hour:(?:[0-9]|1[0-9]|2[0-3]):(\d+)$/.exec(key)
  if (!matched) throw new Error(`invalid wait histogram key: ${key}`)
  return Number(matched[1])
}

/**
 * 日別中央値を平均せず、期間内の度数を合算して exact median を返す。
 * 空の度数は中央値を定義できないので null。
 */
export function histogramMedian(buckets: readonly HistogramBucket[]): number | null {
  const sorted = buckets
    .map((bucket) => {
      if (!Number.isInteger(bucket.value) || bucket.value < 0) {
        throw new Error(`invalid wait histogram count: ${bucket.value}`)
      }
      return { seconds: histogramSeconds(bucket.key), count: bucket.value }
    })
    .filter((bucket) => bucket.count > 0)
    .sort((a, b) => a.seconds - b.seconds)
  const total = sorted.reduce((sum, bucket) => sum + bucket.count, 0)
  if (total === 0) return null

  const valueAt = (position: number): number => {
    let cumulative = 0
    for (const bucket of sorted) {
      cumulative += bucket.count
      if (position < cumulative) return bucket.seconds
    }
    throw new Error('histogram position out of range')
  }
  return (valueAt(Math.floor((total - 1) / 2)) + valueAt(Math.floor(total / 2))) / 2
}

/** 現在来店より JST で 1〜90 日前の完了来店だけを再来根拠にする。 */
export function hasBackwardRevisit(
  currentDate: string,
  priorDoneDates: readonly string[],
): boolean {
  const current = localDateMs(currentDate)
  return priorDoneDates.some((priorDate) => {
    const days = (current - localDateMs(priorDate)) / MS_PER_DAY
    return Number.isInteger(days) && days >= 1 && days <= 90
  })
}
