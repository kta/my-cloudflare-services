import type {
  AlertRecord,
  AnalyticsBreakdown,
  AnalyticsFunnel,
  AnalyticsMetricValue,
  AnalyticsReport,
  AnalyticsStageDistribution,
} from '@app/contracts'
import { expect, test } from 'vitest'
import {
  alertConditionLabel,
  alertKindLabel,
  alertReadLabel,
  alertResolutionLabel,
  breakdownView,
  causeCandidatesForMetric,
  dimensionLabel,
  distributionView,
  formatJstDateTime,
  funnelView,
  granularityLabel,
  metricView,
  reportContext,
  statusGuidance,
} from './analytics-view'

const STORE_ID = '00000000-0000-4000-8000-000000000010'

function metric(overrides: Partial<AnalyticsMetricValue> = {}): AnalyticsMetricValue {
  return {
    metric: 'reservations',
    label: '予約',
    definition: '対象期間に開始予定だった予約の件数。',
    unit: 'count',
    value: 128,
    previousValue: 96,
    difference: 32,
    target: null,
    targetDifference: null,
    exceedsTarget: false,
    suppressed: false,
    suppressionReason: null,
    ...overrides,
  }
}

function breakdown(overrides: Partial<AnalyticsBreakdown> = {}): AnalyticsBreakdown {
  return {
    dimension: 'purpose',
    metric: 'reservations',
    suppressed: false,
    suppressionReason: null,
    items: [
      { key: 'a', label: '視力測定', value: 60, suppressed: false },
      { key: 'b', label: '受け取り', value: 30, suppressed: false },
    ],
    ...overrides,
  }
}

function distribution(
  overrides: Partial<AnalyticsStageDistribution> = {},
): AnalyticsStageDistribution {
  return {
    stage: 'reception_to_service_start',
    label: '受付から接客開始まで',
    definition: '受付から接客開始までの経過分数。',
    unit: 'minutes',
    sampleCount: 40,
    suppressed: false,
    suppressionReason: null,
    averageMinutes: 9.2,
    medianMinutes: 8,
    p90Minutes: 18,
    maxMinutes: 32,
    buckets: [
      { label: '0〜5分', fromMinutes: 0, toMinutes: 5, count: 10 },
      { label: '5〜10分', fromMinutes: 5, toMinutes: 10, count: 20 },
      { label: '30分以上', fromMinutes: 30, toMinutes: null, count: 2 },
    ],
    ...overrides,
  }
}

function funnel(overrides: Partial<AnalyticsFunnel> = {}): AnalyticsFunnel {
  return {
    sessionCount: 100,
    suppressed: false,
    suppressionReason: null,
    steps: [
      { stage: 'started', label: '開始', count: 100, droppedFromPrevious: null, suppressed: false },
      {
        stage: 'slot_selected',
        label: '枠選択',
        count: 70,
        droppedFromPrevious: 30,
        suppressed: false,
      },
      { stage: 'confirmed', label: '確認', count: 60, droppedFromPrevious: 10, suppressed: false },
      { stage: 'completed', label: '完了', count: 55, droppedFromPrevious: 5, suppressed: false },
    ],
    largestDropStage: 'slot_selected',
    ...overrides,
  }
}

function report(overrides: Partial<AnalyticsReport> = {}): AnalyticsReport {
  return {
    storeId: STORE_ID,
    storeName: '銀座店',
    timezone: 'Asia/Tokyo',
    period: {
      granularity: 'week',
      startDate: '2026-08-24',
      endDate: '2026-08-30',
      startAt: '2026-08-23T15:00:00.000Z',
      endAt: '2026-08-30T15:00:00.000Z',
    },
    previousPeriod: {
      granularity: 'week',
      startDate: '2026-08-17',
      endDate: '2026-08-23',
      startAt: '2026-08-16T15:00:00.000Z',
      endAt: '2026-08-23T15:00:00.000Z',
    },
    lastUpdatedAt: '2026-08-27T05:30:00.000Z',
    totalCount: 214,
    smallSampleThreshold: 5,
    status: 'ok',
    reason: null,
    nextAction: null,
    metrics: [metric()],
    breakdowns: [breakdown()],
    stageDistributions: [distribution()],
    funnel: funnel(),
    exclusions: [],
    qualityWarnings: [],
    causeCandidates: [],
    ...overrides,
  }
}

/* --- labels and JST framing (UC-EYEX-105, AC-EYEX-49) --------------------- */

test('granularity and dimension labels are Japanese operator words', () => {
  expect(granularityLabel('day')).toBe('日')
  expect(granularityLabel('week')).toBe('週')
  expect(granularityLabel('month')).toBe('月')
  expect(dimensionLabel('purpose')).toBe('来店目的')
  expect(dimensionLabel('source')).toBe('予約元')
  expect(dimensionLabel('hour')).toBe('時間帯')
  expect(dimensionLabel('staff')).toBe('担当者')
})

test('instants are rendered in JST without reading the clock', () => {
  // 05:30Z is 14:30 JST on the same day.
  expect(formatJstDateTime('2026-08-27T05:30:00.000Z')).toBe('2026-08-27 14:30 JST')
  // 15:00Z is 00:00 JST on the next day — the day must roll over.
  expect(formatJstDateTime('2026-08-30T15:00:00.000Z')).toBe('2026-08-31 00:00 JST')
})

test('every view states period, timezone, last update and the counted rows', () => {
  const context = reportContext(report())
  /*
   * 帯に出る字は承認済みモックの `8月1日〜8月25日 · JST · 10:15更新` と同じ語彙で
   * なければならない。生の `2026-08-24` を面に残さないのは製品全体の約束であり、
   * ここは操作者が読む字であって送信する値ではない。
   */
  /*
   * 粒度は帯の 日/週/月 の切り替えがすでに名乗っている。ここに `（週）` を足すと、
   * 単日のときの `（日）` が曜日の `（日）`（日曜）と同じ字になり、同じ行に並ぶ
   * 曜日つきの読み返しと食い違って見える。承認済みモックのピルも粒度を書かない。
   */
  expect(context.periodText).toBe('8月24日〜8月30日')
  expect(context.previousPeriodText).toBe('8月17日〜8月23日')
  expect(context.timezoneText).toBe('JST(Asia/Tokyo)')
  expect(context.lastUpdatedText).toBe('8月27日 14:30')
  expect(context.totalCountText).toBe('対象件数 214件')
})

test('a single-day period is named once, not as a range of one day', () => {
  const source = report()
  const context = reportContext({
    ...source,
    period: {
      ...source.period,
      granularity: 'day',
      startDate: '2026-08-27',
      endDate: '2026-08-27',
    },
  })
  // 単日は曜日で名乗る。`（日）` は粒度の「日」ではなく曜日として読まれる。
  expect(context.periodText).toBe('8月27日（木）')
})

/* --- comparison and target (AC-EYEX-52) ----------------------------------- */

test('a metric shows current value, previous-period difference and its unit', () => {
  const view = metricView(metric())
  expect(view.valueText).toBe('128件')
  expect(view.comparisonText).toBe('前期間 96件（+32件）')
})

test('minute metrics carry the minute unit in every one of the three numbers', () => {
  const view = metricView(
    metric({
      unit: 'minutes',
      value: 12,
      previousValue: 15,
      difference: -3,
      target: 10,
      targetDifference: 2,
      exceedsTarget: true,
    }),
  )
  expect(view.valueText).toBe('12分')
  expect(view.comparisonText).toBe('前期間 15分（-3分）')
  expect(view.targetText).toBe('店舗目標 10分（+2分）')
})

test('an unconfigured target is stated, never invented', () => {
  expect(metricView(metric({ target: null })).targetText).toBe('店舗目標は未設定です')
})

/* --- suppression (UC-EYEX-180, AC-EYEX-53, AC-EYEX-119) ------------------- */

test('a suppressed metric yields no number at all, not even a comparison', () => {
  const view = metricView(
    metric({
      value: null,
      previousValue: null,
      difference: null,
      target: 120,
      targetDifference: null,
      suppressed: true,
      suppressionReason: 'small_sample',
    }),
  )
  expect(view.suppressed).toBe(true)
  expect(view.valueText).toBe('非表示')
  expect(view.comparisonText).toBe('非表示')
  // The configured target is not derived from anybody's rows, so it stays —
  // but its difference from the hidden value must not.
  expect(view.targetText).toBe('店舗目標 120件')
  expect(view.suppressionNote).toContain('抑制閾値')
})

test('a suppressed breakdown hides every bucket, so nothing can be subtracted back', () => {
  const view = breakdownView(
    breakdown({
      suppressed: true,
      suppressionReason: 'derivable_from_small_sample',
      items: [
        { key: 'a', label: '視力測定', value: null, suppressed: true },
        { key: 'b', label: '受け取り', value: null, suppressed: true },
      ],
    }),
  )
  expect(view.suppressed).toBe(true)
  expect(view.suppressionNote).toContain('逆算')
  expect(view.rows.map((row) => row.valueText)).toEqual(['非表示', '非表示'])
  expect(view.rows.every((row) => row.percent === 0)).toBe(true)
  expect(view.rows.some((row) => /\d/.test(row.valueText))).toBe(false)
})

test('a visible breakdown scales its bars against the largest visible bucket', () => {
  const view = breakdownView(breakdown())
  expect(view.label).toBe('来店目的')
  expect(view.rows).toEqual([
    { key: 'a', label: '視力測定', valueText: '60件', percent: 100 },
    { key: 'b', label: '受け取り', valueText: '30件', percent: 50 },
  ])
})

test('a suppressed distribution drops its summary statistics and its buckets', () => {
  const view = distributionView(
    distribution({
      sampleCount: 3,
      suppressed: true,
      suppressionReason: 'small_sample',
      averageMinutes: null,
      medianMinutes: null,
      p90Minutes: null,
      maxMinutes: null,
      buckets: [],
    }),
  )
  expect(view.summaryText).toBe('非表示')
  expect(view.rows).toEqual([])
  expect(view.sampleCountText).toBe('非表示')
})

test('a suppressed funnel hides both the counts and the drop-offs', () => {
  const view = funnelView(
    funnel({
      sessionCount: 3,
      suppressed: true,
      suppressionReason: 'small_sample',
      largestDropStage: null,
      steps: funnel().steps.map((step) => ({
        ...step,
        count: null,
        droppedFromPrevious: null,
        suppressed: true,
      })),
    }),
  )
  expect(view.sessionCountText).toBe('非表示')
  expect(view.largestDropText).toBe('非表示')
  for (const step of view.steps) {
    expect(step.countText).toBe('非表示')
    expect(step.dropText).toBe('非表示')
    expect(step.percent).toBe(0)
  }
})

/* --- distributions, not averages (UC-EYEX-101, AC-EYEX-50) ---------------- */

test('a distribution reports median, average, p90 and max together with buckets', () => {
  const view = distributionView(distribution())
  expect(view.sampleCountText).toBe('対象40件')
  expect(view.summaryText).toBe('中央値 8分 / 平均 9.2分 / 90パーセンタイル 18分 / 最大 32分')
  expect(view.rows).toEqual([
    { label: '0〜5分', valueText: '10件', percent: 50 },
    { label: '5〜10分', valueText: '20件', percent: 100 },
    { label: '30分以上', valueText: '2件', percent: 10 },
  ])
})

/* --- funnel (UC-EYEX-103) ------------------------------------------------- */

test('the funnel shows each step against the first and names the largest drop', () => {
  const view = funnelView(funnel())
  expect(view.sessionCountText).toBe('対象100件')
  expect(
    view.steps.map((step) => [step.label, step.countText, step.dropText, step.percent]),
  ).toEqual([
    ['開始', '100件', '—', 100],
    ['枠選択', '70件', '-30件', 70],
    ['確認', '60件', '-10件', 60],
    ['完了', '55件', '-5件', 55],
  ])
  expect(view.largestDropText).toBe('最大の離脱は「枠選択」')
})

test('a funnel that loses nobody says so rather than naming a step', () => {
  expect(funnelView(funnel({ largestDropStage: null })).largestDropText).toBe('離脱はありません')
})

/* --- cause candidates (AC-EYEX-51) ---------------------------------------- */

test('cause candidates are filtered to the metric and keep their evidence counts', () => {
  const candidates = causeCandidatesForMetric(
    report({
      causeCandidates: [
        {
          metric: 'no_shows',
          code: 'web_source_concentration',
          hypothesis: 'Web予約に無断キャンセルが集中している可能性があります。',
          evidenceCount: 12,
          inspectionTarget: 'Web予約の確認メール到達状況',
        },
        {
          metric: 'visits',
          code: 'peak_hour_concentration',
          hypothesis: '来店が特定の時間帯に集中している可能性があります。',
          evidenceCount: 8,
          inspectionTarget: '14時台の受付記録',
        },
      ],
    }),
    'no_shows',
  )
  expect(candidates).toHaveLength(1)
  expect(candidates[0]?.evidenceCount).toBe(12)
})

/* --- empty / failed reports (UC-EYEX-108) --------------------------------- */

test('a non-ok report exposes its reason and next action instead of a bare zero', () => {
  const guidance = statusGuidance(
    report({
      status: 'failed',
      reason: '集計に必要な設定または記録を読み取れませんでした。',
      nextAction: '分析設定を保存し直してから再表示してください。',
      metrics: [],
    }),
  )
  expect(guidance).toEqual({
    reason: '集計に必要な設定または記録を読み取れませんでした。',
    nextAction: '分析設定を保存し直してから再表示してください。',
  })
  expect(statusGuidance(report())).toBeUndefined()
})

/* --- alerts (UC-EYEX-178, AC-EYEX-120) ------------------------------------ */

function alert(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    storeId: STORE_ID,
    kind: 'alert',
    code: 'long_wait',
    title: '待ち時間が閾値を超えています',
    reason: '受付から接客開始まで 25 分が経過しています。',
    subject: '受付 14:05 の来店',
    subjectType: 'walkin',
    subjectId: 'w1',
    occurredAt: '2026-08-27T05:30:00.000Z',
    nextAction: '担当者を割り当ててください。',
    readAt: null,
    readBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    ...overrides,
  }
}

test('既読 and 対応済み are labelled as two independent facts', () => {
  expect(alertKindLabel('notice')).toBe('お知らせ')
  expect(alertKindLabel('alert')).toBe('アラート')
  expect(alertReadLabel(alert())).toBe('未読')
  expect(alertResolutionLabel(alert())).toBe('未対応')
  // Read without resolved, and resolved without read, are both real states.
  expect(alertReadLabel(alert({ readAt: '2026-08-27T05:31:00.000Z' }))).toBe('既読')
  expect(alertResolutionLabel(alert({ readAt: '2026-08-27T05:31:00.000Z' }))).toBe('未対応')
  expect(alertResolutionLabel(alert({ resolvedAt: '2026-08-27T05:40:00.000Z' }))).toBe('対応済み')
  expect(alertReadLabel(alert({ resolvedAt: '2026-08-27T05:40:00.000Z' }))).toBe('未読')
})

test('alert conditions are named for the administrator who configures them', () => {
  expect(alertConditionLabel('long_wait')).toBe('待ち時間の超過')
  expect(alertConditionLabel('recording_save_failure')).toBe('録音の保存失敗')
  expect(alertConditionLabel('settings_contradiction')).toBe('設定の矛盾')
})

/*
 * 承認済みモックの待ち時間は `中央値  8分40秒` を大きく立て、平均・90 パーセン
 * タイル・最大はその下に小さく添える。4 つを同じ大きさで `/` 繋ぎにすると、
 * どれを先に読めばよいかが決まらず、分布の代表値が文字列に埋もれる。
 */
test('分布は中央値を見出しに立て、残りを下へ添える', () => {
  const view = distributionView(distribution())
  expect(view.medianText).toBe('中央値 8分')
  expect(view.spreadText).toBe('平均 9.2分 · 90パーセンタイル 18分 · 最大 32分')
})
