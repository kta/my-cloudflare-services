import {
  AlertCondition,
  AlertListQuery,
  AlertRecord,
  AlertSettingsInput,
  AnalyticsBreakdown,
  AnalyticsCauseCandidate,
  AnalyticsExclusion,
  AnalyticsFunnel,
  AnalyticsFunnelEventInput,
  AnalyticsMetricValue,
  AnalyticsQuery,
  AnalyticsReport,
  AnalyticsSettingsInput,
  AnalyticsStageDistribution,
  StorePermission,
} from '@app/contracts'
import { describe, expect, it } from 'vitest'

const period = {
  granularity: 'day' as const,
  startDate: '2026-08-31',
  endDate: '2026-08-31',
  startAt: '2026-08-30T15:00:00.000Z',
  endAt: '2026-08-31T15:00:00.000Z',
}

const metric = {
  metric: 'reservations' as const,
  label: '予約件数',
  definition: '対象期間にJST開始時刻を持つ予約の件数',
  unit: 'count' as const,
  value: 12,
  previousValue: 10,
  difference: 2,
  target: 15,
  targetDifference: -3,
  exceedsTarget: false,
  suppressed: false,
  suppressionReason: null,
}

const funnel = {
  sessionCount: 4,
  suppressed: false,
  suppressionReason: null,
  steps: [
    {
      stage: 'started' as const,
      label: '開始',
      count: 4,
      droppedFromPrevious: null,
      suppressed: false,
    },
  ],
  largestDropStage: null,
}

const report = {
  storeId: '11111111-1111-4111-8111-111111111111',
  storeName: '新宿店',
  timezone: 'Asia/Tokyo' as const,
  period,
  previousPeriod: { ...period, startDate: '2026-08-30', endDate: '2026-08-30' },
  lastUpdatedAt: '2026-08-31T00:00:00.000Z',
  totalCount: 12,
  smallSampleThreshold: 5,
  status: 'ok' as const,
  reason: null,
  nextAction: null,
  metrics: [metric],
  breakdowns: [],
  stageDistributions: [],
  funnel,
  exclusions: [],
  qualityWarnings: [],
  causeCandidates: [],
}

describe('analytics query', () => {
  it('accepts each granularity with a JST anchor date', () => {
    for (const granularity of ['day', 'week', 'month'] as const) {
      expect(AnalyticsQuery.parse({ granularity, date: '2028-02-29' }).granularity).toBe(
        granularity,
      )
    }
  })

  it('rejects a granularity finer than a day', () => {
    expect(AnalyticsQuery.safeParse({ granularity: 'hour', date: '2026-08-31' }).success).toBe(
      false,
    )
  })

  it('rejects an impossible calendar date', () => {
    expect(AnalyticsQuery.safeParse({ granularity: 'day', date: '2025-02-29' }).success).toBe(false)
  })

  it('rejects unknown query keys', () => {
    expect(
      AnalyticsQuery.safeParse({ granularity: 'day', date: '2026-08-31', storeId: 'x' }).success,
    ).toBe(false)
  })
})

describe('analytics report', () => {
  it('parses a complete report', () => {
    expect(AnalyticsReport.parse(report).timezone).toBe('Asia/Tokyo')
  })

  it('requires the timezone to be JST so a reader never assumes UTC', () => {
    expect(AnalyticsReport.safeParse({ ...report, timezone: 'UTC' }).success).toBe(false)
  })

  it('rejects a report without a last-updated instant', () => {
    const { lastUpdatedAt: _omitted, ...withoutUpdatedAt } = report
    expect(AnalyticsReport.safeParse(withoutUpdatedAt).success).toBe(false)
  })

  it('allows a suppressed metric to carry a null value with a reason', () => {
    const suppressed = AnalyticsMetricValue.parse({
      ...metric,
      value: null,
      previousValue: null,
      difference: null,
      targetDifference: null,
      suppressed: true,
      suppressionReason: 'small_sample',
    })
    expect(suppressed.value).toBeNull()
    expect(suppressed.suppressionReason).toBe('small_sample')
  })

  it('allows an unconfigured target to be stated as null rather than invented', () => {
    expect(
      AnalyticsMetricValue.parse({ ...metric, target: null, targetDifference: null }).target,
    ).toBeNull()
  })

  it('allows a negative difference but never a negative count', () => {
    expect(AnalyticsMetricValue.parse({ ...metric, difference: -4 }).difference).toBe(-4)
    expect(AnalyticsMetricValue.safeParse({ ...metric, value: -1 }).success).toBe(false)
  })
})

describe('analytics detail shapes', () => {
  it('parses a breakdown whose items are individually suppressed', () => {
    const breakdown = AnalyticsBreakdown.parse({
      dimension: 'staff',
      metric: 'visits',
      suppressed: true,
      suppressionReason: 'derivable_from_small_sample',
      items: [{ key: 'staff-1', label: '担当A', value: null, suppressed: true }],
    })
    expect(breakdown.items[0]?.value).toBeNull()
  })

  it('parses a stage distribution with an open-ended top bucket', () => {
    const distribution = AnalyticsStageDistribution.parse({
      stage: 'reception_to_service_start',
      label: '受付から接客開始まで',
      definition: '受付完了から接客開始までの経過分数',
      unit: 'minutes',
      sampleCount: 3,
      suppressed: false,
      suppressionReason: null,
      averageMinutes: 8.5,
      medianMinutes: 8,
      p90Minutes: 20,
      maxMinutes: 22,
      buckets: [
        { label: '0-5分', fromMinutes: 0, toMinutes: 5, count: 1 },
        { label: '30分以上', fromMinutes: 30, toMinutes: null, count: 2 },
      ],
    })
    expect(distribution.buckets.at(-1)?.toMinutes).toBeNull()
  })

  it('rejects a distribution measured in anything but minutes', () => {
    expect(
      AnalyticsStageDistribution.safeParse({
        stage: 'service_duration',
        label: 'x',
        definition: 'y',
        unit: 'count',
        sampleCount: 0,
        suppressed: false,
        suppressionReason: null,
        averageMinutes: null,
        medianMinutes: null,
        p90Minutes: null,
        maxMinutes: null,
        buckets: [],
      }).success,
    ).toBe(false)
  })

  it('parses a funnel that names the largest drop-off', () => {
    expect(
      AnalyticsFunnel.parse({ ...funnel, largestDropStage: 'confirmed' }).largestDropStage,
    ).toBe('confirmed')
  })

  it('requires an exclusion to carry a count, a reason and a caveat', () => {
    const exclusion = AnalyticsExclusion.parse({
      reason: 'invalid_timestamp',
      count: 2,
      description: '開始時刻が解釈できない予約',
      caveat: '除外分だけ実績より少なく表示されます',
    })
    expect(exclusion.count).toBe(2)
    expect(AnalyticsExclusion.safeParse({ ...exclusion, count: 0 }).success).toBe(false)
  })

  it('requires a cause candidate to carry evidence and an inspection target', () => {
    const candidate = AnalyticsCauseCandidate.parse({
      metric: 'no_shows',
      code: 'web_source_concentration',
      hypothesis: 'Web予約に無断キャンセルが偏っている可能性があります',
      evidenceCount: 3,
      inspectionTarget: 'Web予約の確認メール到達状況',
    })
    expect(candidate.evidenceCount).toBe(3)
    expect(AnalyticsCauseCandidate.safeParse({ ...candidate, evidenceCount: 0 }).success).toBe(
      false,
    )
  })
})

describe('analytics settings', () => {
  it('accepts one target per metric', () => {
    expect(
      AnalyticsSettingsInput.parse({
        smallSampleThreshold: 5,
        targets: [
          { metric: 'no_shows', target: 2 },
          { metric: 'visits', target: 40 },
        ],
      }).targets,
    ).toHaveLength(2)
  })

  it('rejects two targets for the same metric', () => {
    expect(
      AnalyticsSettingsInput.safeParse({
        smallSampleThreshold: 5,
        targets: [
          { metric: 'no_shows', target: 2 },
          { metric: 'no_shows', target: 3 },
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects a suppression threshold below one', () => {
    expect(AnalyticsSettingsInput.safeParse({ smallSampleThreshold: 0, targets: [] }).success).toBe(
      false,
    )
  })
})

describe('funnel events', () => {
  it('requires an anonymous session uuid and a known stage', () => {
    expect(
      AnalyticsFunnelEventInput.parse({
        sessionId: '22222222-2222-4222-8222-222222222222',
        stage: 'slot_selected',
      }).stage,
    ).toBe('slot_selected')
  })

  it('rejects a session identifier that is not a uuid', () => {
    expect(
      AnalyticsFunnelEventInput.safeParse({ sessionId: 'customer@example.test', stage: 'started' })
        .success,
    ).toBe(false)
  })
})

describe('alerts', () => {
  const record = {
    id: '33333333-3333-4333-8333-333333333333',
    storeId: '11111111-1111-4111-8111-111111111111',
    kind: 'alert' as const,
    code: 'long_wait' as const,
    title: '待ち時間が閾値を超えました',
    reason: '受付から15分経過しても接客が開始されていません',
    subject: '来店番号 12',
    subjectType: 'walkin' as const,
    subjectId: '44444444-4444-4444-8444-444444444444',
    occurredAt: '2026-08-31T00:00:00.000Z',
    nextAction: '受付台帳で担当者を割り当ててください',
    readAt: null,
    readBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  }

  it('records 既読 and 対応済み independently', () => {
    const readOnly = AlertRecord.parse({
      ...record,
      readAt: '2026-08-31T00:05:00.000Z',
      readBy: 'user-1',
    })
    expect(readOnly.readAt).not.toBeNull()
    expect(readOnly.resolvedAt).toBeNull()

    const resolvedUnread = AlertRecord.parse({
      ...record,
      resolvedAt: '2026-08-31T00:06:00.000Z',
      resolvedBy: 'user-2',
      resolutionNote: '担当を割り当てた',
    })
    expect(resolvedUnread.readAt).toBeNull()
    expect(resolvedUnread.resolvedAt).not.toBeNull()
  })

  it('always carries 発生理由・対象・発生時刻・次の操作', () => {
    for (const key of ['reason', 'subject', 'occurredAt', 'nextAction'] as const) {
      const { [key]: _omitted, ...withoutKey } = record
      expect(AlertRecord.safeParse(withoutKey).success).toBe(false)
    }
  })

  it('filters by kind and read/resolved status', () => {
    expect(AlertListQuery.parse({ kind: 'notice', status: 'unread' }).status).toBe('unread')
    expect(AlertListQuery.safeParse({ status: 'handled' }).success).toBe(false)
  })
})

describe('alert settings', () => {
  const longWait = { code: 'long_wait' as const, enabled: true, thresholdMinutes: 15 }
  const recording = {
    code: 'recording_save_failure' as const,
    enabled: true,
    thresholdMinutes: null,
  }

  it('accepts a wait threshold only on the wait condition', () => {
    expect(
      AlertSettingsInput.parse({
        conditions: [longWait, recording],
        notificationTargets: ['manager@example.test'],
      }).conditions,
    ).toHaveLength(2)
  })

  it('rejects a minute threshold on a non-wait condition', () => {
    expect(
      AlertSettingsInput.safeParse({
        conditions: [{ ...recording, thresholdMinutes: 5 }],
        notificationTargets: [],
      }).success,
    ).toBe(false)
  })

  it('rejects a wait condition without a threshold', () => {
    expect(
      AlertSettingsInput.safeParse({
        conditions: [{ ...longWait, thresholdMinutes: null }],
        notificationTargets: [],
      }).success,
    ).toBe(false)
  })

  it('rejects the same condition twice', () => {
    expect(
      AlertSettingsInput.safeParse({
        conditions: [longWait, longWait],
        notificationTargets: [],
      }).success,
    ).toBe(false)
  })

  it('rejects a notification target that is not an address', () => {
    expect(
      AlertSettingsInput.safeParse({
        conditions: [longWait],
        notificationTargets: ['not-an-email'],
      }).success,
    ).toBe(false)
  })

  it('accepts a disabled condition so it is reported rather than removed', () => {
    expect(AlertCondition.parse({ ...longWait, enabled: false }).enabled).toBe(false)
  })
})

describe('store permissions', () => {
  it('carries a dedicated analytics read grant', () => {
    expect(StorePermission.options).toContain('analytics.read')
  })

  it('has no analytics write grant — analytics is read-only', () => {
    expect(StorePermission.options.some((option) => option.startsWith('analytics.write'))).toBe(
      false,
    )
  })
})
