import type {
  AnalyticsBreakdown,
  AnalyticsCauseCandidate,
  AnalyticsDurationBucket,
  AnalyticsFunnel,
  AnalyticsGranularity,
  AnalyticsMetricValue,
  AnalyticsPeriod,
  AnalyticsStage,
  AnalyticsStageDistribution,
} from '@app/contracts'

/*
 * Pure analytics arithmetic. Nothing here reads a clock, a database or an
 * environment: every JST boundary and every suppression decision is a function
 * of its arguments, so the boundaries can be tested exhaustively.
 *
 * Japan has no daylight saving, so a JST calendar date is plain arithmetic on
 * a UTC date shifted by nine hours — no timezone library is warranted.
 */

const DAY_MS = 24 * 60 * 60 * 1000

function toUtcMidnight(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

function toDateString(utcMidnight: number): string {
  return new Date(utcMidnight).toISOString().slice(0, 10)
}

/** The instant a JST calendar day begins, i.e. the previous day at 15:00 UTC. */
function jstDayStartInstant(date: string): string {
  return new Date(toUtcMidnight(date) - 9 * 60 * 60 * 1000).toISOString()
}

function period(
  granularity: AnalyticsGranularity,
  startDate: string,
  endDate: string,
): AnalyticsPeriod {
  return {
    granularity,
    startDate,
    endDate,
    startAt: jstDayStartInstant(startDate),
    // Exclusive: the instant the day *after* the last JST day begins.
    endAt: jstDayStartInstant(toDateString(toUtcMidnight(endDate) + DAY_MS)),
  }
}

/** Resolve the JST window containing `date` at the requested grain. */
export function jstPeriod(granularity: AnalyticsGranularity, date: string): AnalyticsPeriod {
  const anchor = toUtcMidnight(date)
  if (granularity === 'day') return period('day', date, date)
  if (granularity === 'week') {
    // ISO weeks start on Monday; getUTCDay() returns 0 for Sunday.
    const weekday = new Date(anchor).getUTCDay()
    const offsetDays = (weekday + 6) % 7
    const start = anchor - offsetDays * DAY_MS
    return period('week', toDateString(start), toDateString(start + 6 * DAY_MS))
  }
  const start = new Date(anchor)
  const firstOfMonth = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
  const firstOfNextMonth = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
  return period('month', toDateString(firstOfMonth), toDateString(firstOfNextMonth - DAY_MS))
}

/** The period immediately before `current`, at the same grain (AC-EYEX-52). */
export function previousJstPeriod(current: AnalyticsPeriod): AnalyticsPeriod {
  const start = toUtcMidnight(current.startDate)
  if (current.granularity === 'month') {
    const previousMonthEnd = start - DAY_MS
    return jstPeriod('month', toDateString(previousMonthEnd))
  }
  const span = current.granularity === 'week' ? 7 : 1
  return jstPeriod(current.granularity, toDateString(start - span * DAY_MS))
}

const STAGE_LABELS: Record<AnalyticsStage, { label: string; definition: string }> = {
  reception_to_service_start: {
    label: '受付から接客開始まで',
    definition: '受付（待機開始）から接客開始までの経過分数。接客が始まった来店のみを数える。',
  },
  service_duration: {
    label: '接客の所要時間',
    definition: '接客開始から接客完了までの経過分数。完了した接客のみを数える。',
  },
  service_end_to_departure: {
    label: '接客完了から退店まで',
    definition: '接客完了から退店記録までの経過分数。退店が記録された来店のみを数える。',
  },
}

const BUCKET_EDGES = [0, 5, 10, 20, 30] as const

function bucketLabel(from: number, to: number | null): string {
  return to === null ? `${from}分以上` : `${from}〜${to}分`
}

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null
  const rank = Math.max(1, Math.ceil(fraction * sorted.length))
  return sorted[rank - 1] ?? null
}

/**
 * Summarize one stage as a distribution. AC-EYEX-50 asks for the shape of the
 * wait, not its mean: an average hides the tail that operators actually feel.
 */
export function stageDistribution(
  stage: AnalyticsStage,
  samplesMinutes: readonly number[],
): AnalyticsStageDistribution {
  const sorted = [...samplesMinutes].sort((left, right) => left - right)
  const buckets: AnalyticsDurationBucket[] = BUCKET_EDGES.map((from, index) => {
    const to = BUCKET_EDGES[index + 1] ?? null
    return {
      label: bucketLabel(from, to),
      fromMinutes: from,
      toMinutes: to,
      count: sorted.filter((value) => value >= from && (to === null || value < to)).length,
    }
  })
  const sum = sorted.reduce((total, value) => total + value, 0)
  return {
    stage,
    label: STAGE_LABELS[stage].label,
    definition: STAGE_LABELS[stage].definition,
    unit: 'minutes',
    sampleCount: sorted.length,
    suppressed: false,
    suppressionReason: null,
    averageMinutes: sorted.length === 0 ? null : Math.round((sum / sorted.length) * 10) / 10,
    medianMinutes: percentile(sorted, 0.5),
    p90Minutes: percentile(sorted, 0.9),
    maxMinutes: sorted.at(-1) ?? null,
    buckets,
  }
}

export type SuppressionInput = {
  /** Organization-configured minimum group size (UC-EYEX-180). */
  threshold: number
  totalCount: number
  metrics: readonly AnalyticsMetricValue[]
  breakdowns: readonly AnalyticsBreakdown[]
  stageDistributions: readonly AnalyticsStageDistribution[]
  funnel: AnalyticsFunnel
  causeCandidates: readonly AnalyticsCauseCandidate[]
}

export type SuppressionOutput = {
  suppressedEverything: boolean
  metrics: AnalyticsMetricValue[]
  breakdowns: AnalyticsBreakdown[]
  stageDistributions: AnalyticsStageDistribution[]
  funnel: AnalyticsFunnel
  causeCandidates: AnalyticsCauseCandidate[]
}

/** A count that is neither empty nor large enough to hide an individual. */
function isSmall(value: number, threshold: number): boolean {
  return value > 0 && value < threshold
}

function suppressMetric(
  metric: AnalyticsMetricValue,
  reason: AnalyticsMetricValue['suppressionReason'],
): AnalyticsMetricValue {
  return {
    ...metric,
    value: null,
    previousValue: null,
    difference: null,
    // The configured target is not derived from anyone's data, so it stays.
    targetDifference: null,
    exceedsTarget: false,
    suppressed: true,
    suppressionReason: reason,
  }
}

function suppressBreakdown(
  breakdown: AnalyticsBreakdown,
  reason: AnalyticsBreakdown['suppressionReason'],
): AnalyticsBreakdown {
  return {
    ...breakdown,
    suppressed: true,
    suppressionReason: reason,
    items: breakdown.items.map((item) => ({ ...item, value: null, suppressed: true })),
  }
}

function suppressDistribution(
  distribution: AnalyticsStageDistribution,
): AnalyticsStageDistribution {
  return {
    ...distribution,
    suppressed: true,
    suppressionReason: 'small_sample',
    averageMinutes: null,
    medianMinutes: null,
    p90Minutes: null,
    maxMinutes: null,
    buckets: [],
  }
}

function suppressFunnel(funnel: AnalyticsFunnel): AnalyticsFunnel {
  return {
    ...funnel,
    suppressed: true,
    suppressionReason: 'small_sample',
    largestDropStage: null,
    steps: funnel.steps.map((step) => ({
      ...step,
      count: null,
      droppedFromPrevious: null,
      suppressed: true,
    })),
  }
}

/**
 * Hide small groups, and everything a hidden group could be re-derived from
 * (UC-EYEX-180, AC-EYEX-53 / AC-EYEX-119). The rules, in order:
 *
 * 1. Total below the threshold — the whole report is suppressed. A single
 *    surviving number in a tiny period is itself an individual.
 * 2. A metric whose own count is small is suppressed, together with *every*
 *    breakdown of that metric: the parts always sum back to the whole.
 * 3. A breakdown containing any small non-zero bucket suppresses the entire
 *    dimension, not just that bucket. Leaving the siblings visible would let
 *    `total − Σ(visible)` reconstruct exactly the bucket that was hidden.
 * 4. Distributions and the funnel are suppressed when their own sample count
 *    is small; a five-point distribution is a list of individuals.
 * 5. Cause candidates below the threshold are dropped entirely.
 *
 * A count of exactly zero is never suppressed: an empty bucket names nobody,
 * and hiding it would turn "no one" into "someone we will not tell you about".
 * A count exactly equal to the threshold is visible — the threshold is the
 * smallest group an organization has declared safe.
 */
export function applySmallSampleSuppression(input: SuppressionInput): SuppressionOutput {
  if (isSmall(input.totalCount, input.threshold)) {
    return {
      suppressedEverything: true,
      metrics: input.metrics.map((metric) => suppressMetric(metric, 'small_sample')),
      breakdowns: input.breakdowns.map((breakdown) =>
        suppressBreakdown(breakdown, 'derivable_from_small_sample'),
      ),
      stageDistributions: input.stageDistributions.map(suppressDistribution),
      funnel: suppressFunnel(input.funnel),
      causeCandidates: [],
    }
  }

  const suppressedMetrics = new Set(
    input.metrics
      .filter((metric) => metric.value !== null && isSmall(metric.value, input.threshold))
      .map((metric) => metric.metric),
  )

  return {
    suppressedEverything: false,
    metrics: input.metrics.map((metric) =>
      suppressedMetrics.has(metric.metric) ? suppressMetric(metric, 'small_sample') : metric,
    ),
    breakdowns: input.breakdowns.map((breakdown) => {
      if (suppressedMetrics.has(breakdown.metric))
        return suppressBreakdown(breakdown, 'derivable_from_small_sample')
      const hasSmallBucket = breakdown.items.some(
        (item) => item.value !== null && isSmall(item.value, input.threshold),
      )
      return hasSmallBucket
        ? suppressBreakdown(breakdown, 'derivable_from_small_sample')
        : breakdown
    }),
    stageDistributions: input.stageDistributions.map((distribution) =>
      isSmall(distribution.sampleCount, input.threshold)
        ? suppressDistribution(distribution)
        : distribution,
    ),
    funnel: isSmall(input.funnel.sessionCount, input.threshold)
      ? suppressFunnel(input.funnel)
      : input.funnel,
    causeCandidates: input.causeCandidates.filter(
      (candidate) => candidate.evidenceCount >= input.threshold,
    ),
  }
}
