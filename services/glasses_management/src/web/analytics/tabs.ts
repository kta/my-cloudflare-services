export const ANALYTICS_TABS = [
  { key: 'top', label: 'トップ' },
  { key: 'count', label: '予約数' },
  { key: 'source', label: '予約の入口' },
  { key: 'cancel', label: '取り消し' },
  { key: 'visits', label: '来店回数' },
  { key: 'staff', label: '担当者' },
  { key: 'purpose', label: 'ご来店の目的' },
  { key: 'wait', label: 'お待ち時間' },
] as const

export type AnalyticsTabKey = (typeof ANALYTICS_TABS)[number]['key']

export function tabFor(key: AnalyticsTabKey) {
  return ANALYTICS_TABS.find((tab) => tab.key === key) ?? ANALYTICS_TABS[0]
}
