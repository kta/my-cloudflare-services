import type { AnalyticsMetric, AnalyticsPoint, AnalyticsReport } from '@app/contracts'

/*
 * テストだけが使う応答の型紙。**製品のコードから読まない**（面は必ずサーバの応答で描く）。
 * 既定値をここに 1 つ置くことで、どのタブのテストも「その面が主張したいことだけ」を書ける。
 */

export function makePoint(over: Partial<AnalyticsPoint> & { key: string }): AnalyticsPoint {
  return {
    label: over.key,
    value: 0,
    secondaryValue: null,
    isClosed: false,
    isOverTarget: false,
    ...over,
  }
}

export function makeReport(
  over: Partial<AnalyticsReport> & { metric: AnalyticsMetric },
): AnalyticsReport {
  return {
    from: '2026-08-01',
    to: '2026-08-31',
    granularity: 'day',
    countBy: 'visit_date',
    series: [],
    summary: [],
    target: null,
    suppressed: false,
    businessDays: 27,
    pendingDays: 0,
    ...over,
  }
}
