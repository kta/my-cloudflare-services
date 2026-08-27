import type {
  AnalyticsBreakdown,
  AnalyticsCauseCandidate,
  AnalyticsFunnel,
  AnalyticsMetricValue,
} from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  applySmallSampleSuppression,
  jstPeriod,
  previousJstPeriod,
  stageDistribution,
} from '../src/worker/domain/analytics'

function metric(value: number, name: AnalyticsMetricValue['metric']): AnalyticsMetricValue {
  return {
    metric: name,
    label: name,
    definition: `${name} の定義`,
    unit: 'count',
    value,
    previousValue: value,
    difference: 0,
    target: 3,
    targetDifference: value - 3,
    exceedsTarget: value > 3,
    suppressed: false,
    suppressionReason: null,
  }
}

function breakdown(
  dimension: AnalyticsBreakdown['dimension'],
  metricName: AnalyticsBreakdown['metric'],
  values: readonly number[],
): AnalyticsBreakdown {
  return {
    dimension,
    metric: metricName,
    suppressed: false,
    suppressionReason: null,
    items: values.map((value, index) => ({
      key: `k${index}`,
      label: `l${index}`,
      value,
      suppressed: false,
    })),
  }
}

const emptyFunnel: AnalyticsFunnel = {
  sessionCount: 0,
  suppressed: false,
  suppressionReason: null,
  steps: [],
  largestDropStage: null,
}

function funnel(sessionCount: number): AnalyticsFunnel {
  return {
    sessionCount,
    suppressed: false,
    suppressionReason: null,
    steps: [
      {
        stage: 'started',
        label: '開始',
        count: sessionCount,
        droppedFromPrevious: null,
        suppressed: false,
      },
      {
        stage: 'completed',
        label: '完了',
        count: 1,
        droppedFromPrevious: sessionCount - 1,
        suppressed: false,
      },
    ],
    largestDropStage: 'completed',
  }
}

const candidate: AnalyticsCauseCandidate = {
  metric: 'no_shows',
  code: 'web_source_concentration',
  hypothesis: 'Web予約に偏っている可能性があります',
  evidenceCount: 4,
  inspectionTarget: 'Web予約の確認メール',
}

function suppress(overrides: Partial<Parameters<typeof applySmallSampleSuppression>[0]>) {
  return applySmallSampleSuppression({
    threshold: 5,
    totalCount: 50,
    metrics: [],
    breakdowns: [],
    stageDistributions: [],
    funnel: emptyFunnel,
    causeCandidates: [],
    ...overrides,
  })
}

describe('jstPeriod', () => {
  it('resolves a JST day to its UTC 15:00 boundaries', () => {
    expect(jstPeriod('day', '2026-08-31')).toEqual({
      granularity: 'day',
      startDate: '2026-08-31',
      endDate: '2026-08-31',
      startAt: '2026-08-30T15:00:00.000Z',
      endAt: '2026-08-31T15:00:00.000Z',
    })
  })

  it('resolves a week to Monday..Sunday in JST', () => {
    // 2026-08-31 is a Monday.
    expect(jstPeriod('week', '2026-09-06')).toMatchObject({
      startDate: '2026-08-31',
      endDate: '2026-09-06',
    })
    expect(jstPeriod('week', '2026-08-31')).toMatchObject({
      startDate: '2026-08-31',
      endDate: '2026-09-06',
    })
  })

  it('treats Sunday as the last day of its week, not the first', () => {
    expect(jstPeriod('week', '2026-08-30')).toMatchObject({
      startDate: '2026-08-24',
      endDate: '2026-08-30',
    })
  })

  it('resolves a month to its first and last JST day', () => {
    expect(jstPeriod('month', '2026-08-15')).toMatchObject({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      startAt: '2026-07-31T15:00:00.000Z',
      endAt: '2026-08-31T15:00:00.000Z',
    })
  })

  it('resolves February in a leap year to 29 days', () => {
    expect(jstPeriod('month', '2028-02-10')).toMatchObject({
      startDate: '2028-02-01',
      endDate: '2028-02-29',
    })
  })

  it('resolves February in a non-leap year to 28 days', () => {
    expect(jstPeriod('month', '2026-02-10')).toMatchObject({
      startDate: '2026-02-01',
      endDate: '2026-02-28',
    })
  })
})

describe('previousJstPeriod', () => {
  it('steps back one day across a month boundary', () => {
    expect(previousJstPeriod(jstPeriod('day', '2026-09-01'))).toMatchObject({
      startDate: '2026-08-31',
      endDate: '2026-08-31',
    })
  })

  it('steps back one day across a year boundary', () => {
    expect(previousJstPeriod(jstPeriod('day', '2027-01-01'))).toMatchObject({
      startDate: '2026-12-31',
      endDate: '2026-12-31',
      startAt: '2026-12-30T15:00:00.000Z',
      endAt: '2026-12-31T15:00:00.000Z',
    })
  })

  it('steps back one day onto a leap day', () => {
    expect(previousJstPeriod(jstPeriod('day', '2028-03-01'))).toMatchObject({
      startDate: '2028-02-29',
    })
  })

  it('steps back one whole week', () => {
    expect(previousJstPeriod(jstPeriod('week', '2026-08-31'))).toMatchObject({
      startDate: '2026-08-24',
      endDate: '2026-08-30',
    })
  })

  it('steps back one whole month across a year boundary', () => {
    expect(previousJstPeriod(jstPeriod('month', '2027-01-20'))).toMatchObject({
      startDate: '2026-12-01',
      endDate: '2026-12-31',
    })
  })

  it('steps back from March onto a 29-day February', () => {
    expect(previousJstPeriod(jstPeriod('month', '2028-03-20'))).toMatchObject({
      startDate: '2028-02-01',
      endDate: '2028-02-29',
    })
  })
})

describe('applySmallSampleSuppression — the whole-report boundary', () => {
  it('keeps everything when the total sits exactly on the threshold', () => {
    const result = suppress({
      totalCount: 5,
      metrics: [metric(5, 'visits')],
      breakdowns: [breakdown('source', 'visits', [5])],
      funnel: funnel(5),
      causeCandidates: [{ ...candidate, evidenceCount: 5 }],
    })
    expect(result.suppressedEverything).toBe(false)
    expect(result.metrics[0]?.value).toBe(5)
    expect(result.causeCandidates).toHaveLength(1)
  })

  it('suppresses everything one row below the threshold', () => {
    const result = suppress({
      totalCount: 4,
      metrics: [metric(4, 'visits')],
      breakdowns: [breakdown('source', 'visits', [4])],
      funnel: funnel(4),
      causeCandidates: [candidate],
    })
    expect(result.suppressedEverything).toBe(true)
    expect(result.metrics[0]).toMatchObject({
      value: null,
      previousValue: null,
      difference: null,
      targetDifference: null,
      suppressed: true,
      suppressionReason: 'small_sample',
    })
    expect(result.metrics[0]?.target).toBe(3)
    expect(result.breakdowns[0]?.suppressed).toBe(true)
    expect(result.breakdowns[0]?.items.every((item) => item.value === null)).toBe(true)
    expect(result.funnel.suppressed).toBe(true)
    expect(result.funnel.steps.every((step) => step.count === null)).toBe(true)
    expect(result.causeCandidates).toHaveLength(0)
  })

  it('never suppresses an empty period — a zero identifies nobody', () => {
    const result = suppress({ totalCount: 0, metrics: [metric(0, 'visits')] })
    expect(result.suppressedEverything).toBe(false)
    expect(result.metrics[0]?.value).toBe(0)
  })
})

describe('applySmallSampleSuppression — per-metric re-derivation', () => {
  it('suppresses a small metric and every breakdown of that metric', () => {
    const result = suppress({
      metrics: [metric(4, 'no_shows'), metric(30, 'visits')],
      breakdowns: [
        breakdown('source', 'no_shows', [30]),
        breakdown('hour', 'no_shows', [30]),
        breakdown('source', 'visits', [30]),
      ],
    })
    expect(result.metrics[0]).toMatchObject({ value: null, suppressionReason: 'small_sample' })
    expect(result.metrics[1]?.value).toBe(30)
    const noShowBreakdowns = result.breakdowns.filter((b) => b.metric === 'no_shows')
    expect(noShowBreakdowns).toHaveLength(2)
    expect(
      noShowBreakdowns.every((b) => b.suppressionReason === 'derivable_from_small_sample'),
    ).toBe(true)
    expect(result.breakdowns.find((b) => b.metric === 'visits')?.suppressed).toBe(false)
  })

  it('keeps a metric sitting exactly on the threshold', () => {
    const result = suppress({ metrics: [metric(5, 'no_shows')] })
    expect(result.metrics[0]?.value).toBe(5)
  })

  it('keeps a metric of exactly zero', () => {
    const result = suppress({
      metrics: [metric(0, 'no_shows')],
      breakdowns: [breakdown('source', 'no_shows', [0])],
    })
    expect(result.metrics[0]?.value).toBe(0)
    expect(result.breakdowns[0]?.suppressed).toBe(false)
  })
})

describe('applySmallSampleSuppression — per-breakdown re-derivation', () => {
  it('suppresses the whole dimension when one bucket is small', () => {
    const result = suppress({
      metrics: [metric(31, 'visits')],
      breakdowns: [breakdown('staff', 'visits', [30, 1])],
    })
    expect(result.breakdowns[0]).toMatchObject({
      suppressed: true,
      suppressionReason: 'derivable_from_small_sample',
    })
    // The large bucket goes too: 31 - 30 would re-derive the small one.
    expect(result.breakdowns[0]?.items.map((item) => item.value)).toEqual([null, null])
    expect(result.breakdowns[0]?.items.every((item) => item.suppressed)).toBe(true)
  })

  it('keeps a dimension whose smallest non-zero bucket equals the threshold', () => {
    const result = suppress({
      metrics: [metric(35, 'visits')],
      breakdowns: [breakdown('staff', 'visits', [30, 5])],
    })
    expect(result.breakdowns[0]?.suppressed).toBe(false)
    expect(result.breakdowns[0]?.items.map((item) => item.value)).toEqual([30, 5])
  })

  it('suppresses one bucket below the threshold even when every other bucket is large', () => {
    const result = suppress({
      metrics: [metric(94, 'visits')],
      breakdowns: [breakdown('hour', 'visits', [30, 30, 30, 4])],
    })
    expect(result.breakdowns[0]?.suppressed).toBe(true)
  })

  it('keeps zero buckets visible alongside large ones', () => {
    const result = suppress({
      metrics: [metric(30, 'visits')],
      breakdowns: [breakdown('hour', 'visits', [30, 0, 0])],
    })
    expect(result.breakdowns[0]?.suppressed).toBe(false)
    expect(result.breakdowns[0]?.items.map((item) => item.value)).toEqual([30, 0, 0])
  })

  it('suppresses one dimension without touching a sibling dimension of the same metric', () => {
    const result = suppress({
      metrics: [metric(31, 'visits')],
      breakdowns: [breakdown('staff', 'visits', [30, 1]), breakdown('hour', 'visits', [31])],
    })
    expect(result.breakdowns[0]?.suppressed).toBe(true)
    expect(result.breakdowns[1]?.suppressed).toBe(false)
  })
})

describe('applySmallSampleSuppression — distributions, funnel and causes', () => {
  it('suppresses a distribution below the threshold but keeps one on it', () => {
    const distributions = [
      stageDistribution('reception_to_service_start', [1, 2, 3, 40]),
      stageDistribution('service_duration', [1, 2, 3, 4, 5]),
    ]
    const result = suppress({ stageDistributions: distributions })
    expect(result.stageDistributions[0]).toMatchObject({
      suppressed: true,
      suppressionReason: 'small_sample',
      medianMinutes: null,
      averageMinutes: null,
      p90Minutes: null,
      maxMinutes: null,
    })
    expect(result.stageDistributions[0]?.buckets).toHaveLength(0)
    expect(result.stageDistributions[1]?.suppressed).toBe(false)
  })

  it('suppresses a funnel below the threshold', () => {
    const result = suppress({ funnel: funnel(4) })
    expect(result.funnel).toMatchObject({
      suppressed: true,
      suppressionReason: 'small_sample',
      largestDropStage: null,
    })
    expect(result.funnel.steps.every((step) => step.droppedFromPrevious === null)).toBe(true)
  })

  it('keeps a funnel sitting exactly on the threshold', () => {
    expect(suppress({ funnel: funnel(5) }).funnel.suppressed).toBe(false)
  })

  it('drops a cause candidate whose evidence would identify individuals', () => {
    const result = suppress({
      causeCandidates: [
        { ...candidate, evidenceCount: 4 },
        { ...candidate, code: 'staff_unassigned', evidenceCount: 5 },
      ],
    })
    expect(result.causeCandidates.map((c) => c.code)).toEqual(['staff_unassigned'])
  })
})

describe('stageDistribution', () => {
  it('reports a distribution rather than a single average', () => {
    const distribution = stageDistribution('reception_to_service_start', [2, 7, 12, 25, 40])
    expect(distribution.sampleCount).toBe(5)
    expect(distribution.averageMinutes).toBe(17.2)
    expect(distribution.medianMinutes).toBe(12)
    expect(distribution.p90Minutes).toBe(40)
    expect(distribution.maxMinutes).toBe(40)
    expect(distribution.buckets.map((bucket) => bucket.count)).toEqual([1, 1, 1, 1, 1])
    expect(distribution.buckets.at(-1)?.toMinutes).toBeNull()
  })

  it('reports an empty stage without inventing a zero average', () => {
    const distribution = stageDistribution('service_duration', [])
    expect(distribution.sampleCount).toBe(0)
    expect(distribution.averageMinutes).toBeNull()
    expect(distribution.medianMinutes).toBeNull()
  })

  it('places a boundary sample in the upper bucket', () => {
    const distribution = stageDistribution('service_duration', [5, 10, 20, 30])
    expect(distribution.buckets.map((bucket) => bucket.count)).toEqual([0, 1, 1, 1, 1])
  })
})
