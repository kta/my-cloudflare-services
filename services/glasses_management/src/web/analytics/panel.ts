import type { AnalyticsReport, AnalyticsTargets } from '@app/contracts'
import type { AnalyticsTab } from './tabs'

/*
 * タブ 1 枚の面が受け取るもの（P9 T-014〜T-019）。
 *
 * 面は**自分で集計しない**。器（AnalyticsScreen）が「適用」で取ってきた応答に
 * 名前を付けて並べるだけにする。切り口（集計の種類・かぞえる日）だけは面が持つ
 * 操作なので、下書きの値と変更の口をここから渡す（**変えた瞬間には集計しない**）。
 */

/** グラフの切り口。器のクエリにそのまま載る。 */
export type AnalyticsGranularity = 'day' | 'month' | 'hour' | 'weekday'

/** かぞえる日。ご来店日か、受け付けた日か。 */
export type AnalyticsCountBy = 'visit_date' | 'received_date'

export type AnalyticsPanelProps = {
  tab: AnalyticsTab
  report: AnalyticsReport
  targets: AnalyticsTargets | null
  /** いまの時刻（ISO8601）。**面は時計を読まない**ので、ここから注ぐ。 */
  now: string
  /** 下書きの切り口。「適用」を押すまで数字は動かない。 */
  options: { granularity: AnalyticsGranularity; countBy: AnalyticsCountBy }
  onOptionsChange: (next: Partial<AnalyticsPanelProps['options']>) => void
}
