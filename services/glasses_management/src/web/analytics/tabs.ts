import type { AnalyticsMetric } from '@app/contracts'

/*
 * 分析の 8 タブ（P9）。並びは承認済みモック ANALYTICS-TOP.png のタブ帯そのままで、
 * URL の `?tab=` に載る短い名前と、サーバへ渡す `metric` をここで 1 対 1 に結ぶ。
 *
 * **タブを増やすときはこの表に 1 行足すだけ**にする（器の側に条件を書かない）。
 */

export type AnalyticsTabKey =
  | 'top'
  | 'count'
  | 'source'
  | 'cancel'
  | 'visits'
  | 'staff'
  | 'purpose'
  | 'wait'

export type AnalyticsTab = {
  key: AnalyticsTabKey
  /** タブ帯とツールバーの見出しに出る言葉（同じ語を使う）。 */
  label: string
  metric: AnalyticsMetric
  granularity: 'day' | 'month' | 'hour' | 'weekday'
  /** 期間の札を 2 つ並べるか（取り消しだけ月をまたいで見る）。 */
  range: boolean
  /** 定義の 1 行の主語。「何を」数えたか。 */
  subject: string
  /** グラフの単位。**「名」は決して置かない**（Q-11）。 */
  unit: string
}

export const ANALYTICS_TABS: readonly AnalyticsTab[] = [
  {
    key: 'top',
    label: 'トップ',
    metric: 'overview',
    granularity: 'day',
    range: false,
    subject: 'ご予約の件数',
    unit: '件',
  },
  {
    key: 'count',
    label: '予約数',
    metric: 'reservation_count',
    granularity: 'day',
    range: false,
    subject: 'ご予約の件数',
    unit: '件',
  },
  {
    key: 'source',
    label: '予約の入口',
    metric: 'reservation_source',
    granularity: 'day',
    range: false,
    subject: 'ご予約の入口ごとの件数',
    unit: '件',
  },
  {
    key: 'cancel',
    label: '取り消し',
    metric: 'cancellation',
    granularity: 'month',
    range: true,
    subject: '取り消しの件数',
    unit: '件',
  },
  {
    key: 'visits',
    label: '来店回数',
    metric: 'visit_frequency',
    granularity: 'day',
    range: false,
    subject: 'ご来店の回数ごとの件数',
    unit: '件',
  },
  {
    key: 'staff',
    label: '担当者',
    metric: 'staff',
    granularity: 'day',
    range: false,
    subject: '担当者ごとの件数',
    unit: '件',
  },
  {
    key: 'purpose',
    label: 'ご来店の目的',
    metric: 'purpose',
    granularity: 'day',
    range: false,
    subject: 'ご来店の目的ごとの件数',
    unit: '件',
  },
  {
    key: 'wait',
    label: 'お待ち時間',
    metric: 'wait_time',
    granularity: 'hour',
    range: false,
    subject: '受付からご相談開始までのお待ち時間（中央値）',
    unit: '',
  },
]

/** `?tab=` の値からタブを引く。知らない値のときはトップに戻す。 */
export function tabByKey(key: string | null | undefined): AnalyticsTab {
  const found = ANALYTICS_TABS.find((tab) => tab.key === key)
  return found ?? (ANALYTICS_TABS[0] as AnalyticsTab)
}
