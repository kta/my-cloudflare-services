/**
 * 分析の暦と数え方（純関数）。
 *
 * ここには **DB も時計も無い**。基準時刻はすべて引数で受け取る（`Date.now()` を
 * 1 度も呼ばない）ので、月跨ぎ・年跨ぎ・うるう年を固定時刻で試験できる。
 * JST の変換は `@app/shared` の `toJstDateString` / `jstDaysBetween` を通し、
 * ここで +9 時間の暗算を書き直さない。
 *
 * 「根拠にできない数字を数字として出さない」がこのモジュールの主張である。
 * 標本が薄い率は 0 ではなく `null`（画面の「—」）で返す。
 */

import type { AnalyticsTargets } from '@app/contracts'
import { jstDaysBetween, toJstDateString } from '@app/shared'

/**
 * 目安の 3 つ。**全店共通の固定値**で、店舗ごとの上書きを受け取る引数を作らない
 * （設定画面が無いことと矛盾するため）。
 */
export const ANALYTICS_TARGETS: AnalyticsTargets = {
  waitMinutes: 8,
  cancellationRatePercent: 10,
  revisitWindowDays: 90,
}

/** 率を伏せる分母の下限。20 件ちょうどは出し、19 件は「—」。 */
export const SMALL_SAMPLE_THRESHOLD = 20

/** 担当が未定の行のキー。並びの最後に置き、率は常に伏せる。 */
export const UNASSIGNED_KEY = 'unassigned'

/** 一度に見られる期間の上限（暦日）。 */
export const MAX_RANGE_DAYS = 400

const DAY_MS = 24 * 60 * 60 * 1000

/** `YYYY-MM-DD` を UTC 正午の epoch に直す（日付の足し算だけに使う）。 */
function epochOf(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`)
}

/** `YYYY-MM-DD` に日数を足す。 */
export function addDays(date: string, days: number): string {
  return new Date(epochOf(date) + days * DAY_MS).toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` の曜日（0=日 … 6=土）。JST の暦日として読む。 */
export function jstWeekday(date: string): number {
  return new Date(epochOf(date)).getUTCDay()
}

/** 両端を含む日数。同じ日は 1。 */
export function spanDays(from: string, to: string): number {
  return Math.round((epochOf(to) - epochOf(from)) / DAY_MS) + 1
}

/** 期間の暦日をすべて並べる（両端を含む）。 */
export function datesInRange(from: string, to: string): string[] {
  const dates: string[] = []
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) dates.push(cursor)
  return dates
}

/** 上限（既定 400 日）を越える期間を後ろで切る。 */
export function clampRange(from: string, to: string, max = MAX_RANGE_DAYS): Range {
  return spanDays(from, to) <= max ? { from, to } : { from, to: addDays(from, max - 1) }
}

/** 期間 1 つ。両端を含む JST の暦日。 */
export type Range = { from: string; to: string }

/** 月末日（うるう年を含む）。 */
function endOfMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  // 翌月 1 日の前日。月ごとの日数表を持たないのでうるう年が自動で正しくなる。
  const next =
    (m as number) === 12
      ? `${(y as number) + 1}-01-01`
      : `${y}-${String((m as number) + 1).padStart(2, '0')}-01`
  return addDays(next, -1)
}

/**
 * 期間の解決。`month` は 1 か月、`range` は開始月の 1 日〜終了月の末日、
 * `around` は `now` の JST 暦日を中心に前後 7 日（15 日）。
 */
export function resolveRange(
  kind: 'month' | 'range' | 'around',
  anchor: { from?: string; to?: string },
  now: string | Date,
): Range {
  if (kind === 'around') {
    const center = toJstDateString(now)
    return { from: addDays(center, -7), to: addDays(center, 7) }
  }
  const fromMonth = anchor.from ?? toJstDateString(now).slice(0, 7)
  const toMonth = kind === 'month' ? fromMonth : (anchor.to ?? fromMonth)
  return { from: `${fromMonth}-01`, to: endOfMonth(toMonth) }
}

/** 月曜始まりの 先週・今週・来週。 */
export function weekBuckets(now: string | Date): { last: Range; current: Range; next: Range } {
  const today = toJstDateString(now)
  // getUTCDay() は 0=日。月曜始まりへ寄せる（日曜は 6 日戻す）。
  const offset = (jstWeekday(today) + 6) % 7
  const monday = addDays(today, -offset)
  return {
    last: { from: addDays(monday, -7), to: addDays(monday, -1) },
    current: { from: monday, to: addDays(monday, 6) },
    next: { from: addDays(monday, 7), to: addDays(monday, 13) },
  }
}

/**
 * 営業日数。`closed=0` の行がある日だけを数える。
 * **未集計の日（行が無い日）を営業日に数えない** — 数えると「1日あたり」が薄まる。
 */
export function businessDaysIn(
  dates: readonly string[],
  closedByDate: ReadonlyMap<string, boolean>,
): number {
  return dates.filter((date) => closedByDate.get(date) === false).length
}

/** まだ集計していない日数（`closed` の行が無い暦日）。 */
export function pendingDaysIn(dates: readonly string[], seenDates: ReadonlySet<string>): number {
  return dates.filter((date) => !seenDates.has(date)).length
}

/** 中央値。偶数個は中央 2 つの平均。空配列は `null`（0 と区別する）。 */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

/**
 * 加重中央値。重みの累計が総重みの半分**以上**になった最初の標本の値を返す。
 *
 * 月の中央値はこれで出す（日ごとの中央値を、その日の受付件数で重み付けする）。
 * 生の受付 1 件ずつを走査しないので**厳密な中央値と一致しないことがある** —
 * 画面から生データを走査しないという不変条件（`03-data-model.md` §11.4）を
 * 優先した結果である。
 */
export function weightedMedian(
  samples: readonly { value: number; weight: number }[],
): number | null {
  const usable = samples.filter((s) => s.weight > 0)
  if (usable.length === 0) return null
  const sorted = [...usable].sort((a, b) => a.value - b.value)
  const total = sorted.reduce((sum, s) => sum + s.weight, 0)
  let cumulative = 0
  for (const sample of sorted) {
    cumulative += sample.weight
    if (cumulative >= total / 2) return sample.value
  }
  return (sorted[sorted.length - 1] as { value: number }).value
}

/** 分母が薄ければ率を出さない（`null` = 画面の「—」）。分母 0 も `null`。 */
export function rateOrNull(
  numerator: number,
  denominator: number,
  threshold = SMALL_SAMPLE_THRESHOLD,
): number | null {
  if (denominator < threshold || denominator === 0) return null
  return numerator / denominator
}

/** 率（0..1）を％の小数第 1 位へ丸める。丸めはこの 1 か所に統一する。 */
export function roundRate1(rate: number): number {
  return Math.round(rate * 1000) / 10
}

/** お待ち時間の目安超過。8分ちょうど（480 秒）は超過にしない。 */
export function isOverWaitTarget(seconds: number, targets: AnalyticsTargets): boolean {
  return seconds > targets.waitMinutes * 60
}

/** 取消率の目安超過。**画面に出す丸めた値**で判定する（10.0% は超過にしない）。 */
export function isOverCancellationTarget(rate: number, targets: AnalyticsTargets): boolean {
  return roundRate1(rate) > targets.cancellationRatePercent
}

/** 再来の窓。90 日ちょうどは数え、91 日目は数えない。同じ日の 2 度目は再来にしない。 */
export function isRevisitWithinWindow(
  visitedAt: string | Date,
  revisitedAt: string | Date,
  targets: AnalyticsTargets,
): boolean {
  const days = jstDaysBetween(visitedAt, revisitedAt)
  return days > 0 && days <= targets.revisitWindowDays
}

/** 秒を `8分40秒` の形にする。60 秒未満でも「分」を落とさない。 */
export function formatSeconds(seconds: number): string {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}分${whole % 60}秒`
}
