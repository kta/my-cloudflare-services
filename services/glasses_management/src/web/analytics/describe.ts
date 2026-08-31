import type { AnalyticsPoint, AnalyticsReport } from '@app/contracts'
import { toJstDateString } from '@app/shared'
import type { AnalyticsTab } from './tabs'

/*
 * 分析の言葉づかい（純関数だけ）。画面の側で数え直さず、**サーバが返した数字に
 * 名前を付けるだけ**にする（画面で割り直すと分母がずれる）。
 *
 * 「名」は 1 か所も書かない（Q-11。人数を数える経路がまだ無い）。
 */

/** 「2026-08」→「2026年8月」。 */
export function monthLabel(month: string): string {
  const [year, mm] = month.split('-')
  return `${year}年${Number(mm)}月`
}

/** 月の初日。 */
export function monthStart(month: string): string {
  return `${month}-01`
}

/** 月の末日（うるう年も暦で数える）。 */
export function monthEnd(month: string): string {
  const [year, mm] = month.split('-').map(Number)
  const last = new Date(Date.UTC(year ?? 2000, mm ?? 1, 0)).getUTCDate()
  return `${month}-${String(last).padStart(2, '0')}`
}

/**
 * 期間の札の選択肢。`analytics_daily` の保持が 25 か月なので、
 * **当月から 24 か月遡るところまで**しか選ばせない。
 */
export function monthOptions(now: string | Date, count = 24): readonly string[] {
  const today = toJstDateString(new Date(now))
  const [year, mm] = today.split('-').map(Number)
  const months: string[] = []
  for (let back = 0; back < count; back += 1) {
    const at = new Date(Date.UTC(year ?? 2000, (mm ?? 1) - 1 - back, 1))
    months.push(`${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

/** 「2026年8月」または「2026年3月〜2026年8月」。 */
function periodLabel(from: string, to: string): string {
  const start = from.slice(0, 7)
  const end = to.slice(0, 7)
  return start === end ? monthLabel(start) : `${monthLabel(start)}〜${monthLabel(end)}`
}

/** 期間の点の合計（母数）。系列をまたいで足す。 */
function totalOf(report: AnalyticsReport): number {
  return report.series.reduce(
    (sum, series) => sum + series.points.reduce((inner, point) => inner + point.value, 0),
    0,
  )
}

/**
 * 定義の 1 行。**何を・いつを基準に・どれだけの母数で**数えたかを 1 行で書く。
 * 「1日あたり」の分母が営業日数であることも、ここで読める形にする。
 */
export function describeTab(tab: AnalyticsTab, report: AnalyticsReport): string {
  const countBy = report.countBy === 'received_date' ? '受付日' : 'ご来店日'
  const head =
    `${tab.subject}を、${periodLabel(report.from, report.to)}／${countBy}でかぞえます。` +
    `営業日数${report.businessDays}日・母数${totalOf(report)}件。` +
    '「1日あたり」の分母はこの営業日数です。'
  if (tab.key !== 'cancel') return head
  return `${head}取消率の分母は、その期間に来店予定だった予約の総数（取消・無断を含む）です。`
}

/**
 * グラフの読み上げ文。最も多い点とその値・定休日が 0 件であること・
 * 未集計の日があることを 1 文にまとめる。
 */
export function describeChart(input: {
  points: readonly AnalyticsPoint[]
  unit: string
  pendingDays: number
}): string {
  const parts: string[] = []
  const top = input.points.reduce<AnalyticsPoint | null>(
    (best, point) => (best === null || point.value > best.value ? point : best),
    null,
  )
  if (top) parts.push(`最も多いのは${top.label}の${top.value}${input.unit}`)
  const closed = input.points.filter((point) => point.isClosed)
  if (closed.length > 0) {
    parts.push(`${closed.map((point) => point.label).join('と')}は定休日で0${input.unit}`)
  }
  if (input.pendingDays > 0) parts.push(`${input.pendingDays}日ぶんはまだ集計中`)
  if (parts.length === 0) return 'この期間に数えられるご予約はありません。'
  return `${parts.join('、')}です。`
}

/** 目盛り 5 本（0 を含む）と上限。棒の高さはこの上限に対する割合で描く。 */
export function chartTicks(maxValue: number): { ticks: readonly number[]; max: number } {
  const steps = [1, 2, 3, 4, 5, 6, 8, 10]
  const rough = Math.max(1, Math.ceil(maxValue / 4))
  const scale = 10 ** Math.max(0, String(Math.trunc(rough)).length - 1)
  const step = (steps.find((candidate) => candidate * scale >= rough) ?? 10) * scale
  return { ticks: [0, step, step * 2, step * 3, step * 4], max: step * 4 }
}
