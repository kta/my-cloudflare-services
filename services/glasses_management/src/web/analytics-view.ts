/**
 * 分析とお知らせ・アラートの画面が共有する「言葉と数え方」だけを持つ層。
 *
 * ここに DOM も React も無い。分析で静かに壊れるのは表示ロジック（単位の取り違え、
 * 目標未設定を 0 と描く、抑制された値を割合や差分から逆算できてしまう）なので、
 * その判断を画面から剥がしてここで直接テストする。
 *
 * 時刻は必ず引数で受け取る。`Date.now()` も実行時タイムゾーンもここには無い。
 * 日本に夏時間は無いので JST は固定 +09:00 として扱ってよい。
 */

import type {
  AlertCode,
  AlertKind,
  AlertRecord,
  AnalyticsBreakdown,
  AnalyticsCauseCandidate,
  AnalyticsDimension,
  AnalyticsFunnel,
  AnalyticsGranularity,
  AnalyticsMetric,
  AnalyticsMetricValue,
  AnalyticsPeriod,
  AnalyticsReport,
  AnalyticsStageDistribution,
} from '@app/contracts'

/** 抑制された値の代わりに置く唯一の文字列。数字は決して混ぜない。 */
const HIDDEN = '非表示'

const GRANULARITY_LABEL: Record<AnalyticsGranularity, string> = {
  day: '日',
  week: '週',
  month: '月',
}

export function granularityLabel(granularity: AnalyticsGranularity): string {
  return GRANULARITY_LABEL[granularity]
}

const DIMENSION_LABEL: Record<AnalyticsDimension, string> = {
  purpose: '来店目的',
  source: '予約元',
  hour: '時間帯',
  staff: '担当者',
}

export function dimensionLabel(dimension: AnalyticsDimension): string {
  return DIMENSION_LABEL[dimension]
}

/** JST の壁時計。日本に夏時間は無いので +09:00 の固定加算で足りる。 */
export function formatJstDateTime(instant: string): string {
  const shifted = new Date(new Date(instant).getTime() + 9 * 60 * 60 * 1000)
  const date = shifted.toISOString().slice(0, 10)
  const time = shifted.toISOString().slice(11, 16)
  return `${date} ${time} JST`
}

function periodText(period: AnalyticsPeriod): string {
  return `${period.startDate}〜${period.endDate}`
}

export type ReportContext = {
  periodText: string
  previousPeriodText: string
  timezoneText: string
  lastUpdatedText: string
  totalCountText: string
}

/**
 * UC-EYEX-105 / AC-EYEX-49: 対象期間・タイムゾーン・最終更新時刻・対象件数は
 * どの指標を見ていても同じ場所に出る。数字だけを渡すと読み手が推測する。
 */
export function reportContext(report: AnalyticsReport): ReportContext {
  return {
    periodText: `${periodText(report.period)}（${granularityLabel(report.period.granularity)}）`,
    previousPeriodText: periodText(report.previousPeriod),
    timezoneText: `JST(${report.timezone})`,
    lastUpdatedText: formatJstDateTime(report.lastUpdatedAt),
    totalCountText: `対象件数 ${report.totalCount}件`,
  }
}

const UNIT_SUFFIX: Record<AnalyticsMetricValue['unit'], string> = {
  count: '件',
  minutes: '分',
}

function signed(value: number, suffix: string): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value)}${suffix}`
}

export type MetricView = {
  metric: AnalyticsMetric
  label: string
  definition: string
  suppressed: boolean
  suppressionNote: string | undefined
  valueText: string
  comparisonText: string
  targetText: string
  exceedsTarget: boolean
}

function suppressionNote(reason: AnalyticsMetricValue['suppressionReason']): string | undefined {
  if (reason === 'small_sample')
    return '対象件数が組織の抑制閾値を下回るため、個人が特定されないよう非表示にしています。'
  if (reason === 'derivable_from_small_sample')
    return '非表示にした値から逆算できるため、あわせて非表示にしています。'
  return undefined
}

/**
 * AC-EYEX-52 と AC-EYEX-53 を同時に満たす。現在値・前期間差・店舗目標は同じ単位で
 * 並ぶが、抑制された指標では現在値と差分をどちらも文字列 `非表示` に潰す。
 * 目標だけは誰のデータからも導かれないので残す（ただし差は残さない）。
 */
export function metricView(metric: AnalyticsMetricValue): MetricView {
  const suffix = UNIT_SUFFIX[metric.unit]
  const hidden = metric.suppressed
  const valueText = hidden || metric.value === null ? HIDDEN : `${metric.value}${suffix}`
  const comparisonText =
    hidden || metric.previousValue === null || metric.difference === null
      ? HIDDEN
      : `前期間 ${metric.previousValue}${suffix}（${signed(metric.difference, suffix)}）`
  const targetText =
    metric.target === null
      ? '店舗目標は未設定です'
      : hidden || metric.targetDifference === null
        ? `店舗目標 ${metric.target}${suffix}`
        : `店舗目標 ${metric.target}${suffix}（${signed(metric.targetDifference, suffix)}）`
  return {
    metric: metric.metric,
    label: metric.label,
    definition: metric.definition,
    suppressed: hidden,
    suppressionNote: suppressionNote(metric.suppressionReason),
    valueText,
    comparisonText,
    targetText,
    exceedsTarget: metric.exceedsTarget,
  }
}

type BarRow = {
  key: string
  label: string
  valueText: string
  percent: number
}

export type BreakdownView = {
  dimension: AnalyticsDimension
  label: string
  suppressed: boolean
  suppressionNote: string | undefined
  rows: BarRow[]
}

function percentOf(value: number, largest: number): number {
  return largest > 0 ? Math.round((value / largest) * 100) : 0
}

/**
 * UC-EYEX-100 / AC-EYEX-119: 内訳は次元まるごと表示されるか、まるごと隠れるかの
 * どちらかしかない。バケットを一つだけ隠して兄弟を残すと `合計 − 見えている値` で
 * 隠したはずの一件が復元できるため、抑制時は棒の長さも 0 に落とす。
 */
export function breakdownView(breakdown: AnalyticsBreakdown): BreakdownView {
  const values = breakdown.suppressed
    ? []
    : breakdown.items.map((item) => (item.suppressed ? 0 : (item.value ?? 0)))
  const largest = values.reduce((max, value) => Math.max(max, value), 0)
  return {
    dimension: breakdown.dimension,
    label: dimensionLabel(breakdown.dimension),
    suppressed: breakdown.suppressed,
    suppressionNote: suppressionNote(breakdown.suppressionReason),
    rows: breakdown.items.map((item) => {
      const hidden = breakdown.suppressed || item.suppressed || item.value === null
      return {
        key: item.key,
        label: item.label,
        valueText: hidden ? HIDDEN : `${item.value}件`,
        percent: hidden ? 0 : percentOf(item.value ?? 0, largest),
      }
    }),
  }
}

type DistributionRow = {
  label: string
  valueText: string
  percent: number
}

export type DistributionView = {
  stage: AnalyticsStageDistribution['stage']
  label: string
  definition: string
  suppressed: boolean
  suppressionNote: string | undefined
  sampleCountText: string
  summaryText: string
  rows: DistributionRow[]
}

/**
 * AC-EYEX-50: 待ち時間は平均一つではなく分布で読む。平均だけを出すと運用者が
 * 実際に痛みを感じている裾が消える。
 */
export function distributionView(distribution: AnalyticsStageDistribution): DistributionView {
  const hidden = distribution.suppressed
  const largest = distribution.buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0)
  const summaryText =
    hidden ||
    distribution.medianMinutes === null ||
    distribution.averageMinutes === null ||
    distribution.p90Minutes === null ||
    distribution.maxMinutes === null
      ? HIDDEN
      : `中央値 ${distribution.medianMinutes}分 / 平均 ${distribution.averageMinutes}分 / 90パーセンタイル ${distribution.p90Minutes}分 / 最大 ${distribution.maxMinutes}分`
  return {
    stage: distribution.stage,
    label: distribution.label,
    definition: distribution.definition,
    suppressed: hidden,
    suppressionNote: suppressionNote(distribution.suppressionReason),
    sampleCountText: hidden ? HIDDEN : `対象${distribution.sampleCount}件`,
    summaryText,
    rows: hidden
      ? []
      : distribution.buckets.map((bucket) => ({
          label: bucket.label,
          valueText: `${bucket.count}件`,
          percent: percentOf(bucket.count, largest),
        })),
  }
}

type FunnelStepView = {
  stage: AnalyticsFunnel['steps'][number]['stage']
  label: string
  countText: string
  dropText: string
  percent: number
}

export type FunnelView = {
  suppressed: boolean
  suppressionNote: string | undefined
  sessionCountText: string
  largestDropText: string
  steps: FunnelStepView[]
}

/** UC-EYEX-103: 開始→枠選択→確認→完了 と、その間で失われた数。 */
export function funnelView(funnel: AnalyticsFunnel): FunnelView {
  const hidden = funnel.suppressed
  const first = funnel.steps[0]?.count ?? 0
  const largestDropLabel = funnel.steps.find(
    (step) => step.stage === funnel.largestDropStage,
  )?.label
  return {
    suppressed: hidden,
    suppressionNote: suppressionNote(funnel.suppressionReason),
    sessionCountText: hidden ? HIDDEN : `対象${funnel.sessionCount}件`,
    largestDropText: hidden
      ? HIDDEN
      : largestDropLabel === undefined
        ? '離脱はありません'
        : `最大の離脱は「${largestDropLabel}」`,
    steps: funnel.steps.map((step) => {
      const stepHidden = hidden || step.suppressed || step.count === null
      return {
        stage: step.stage,
        label: step.label,
        countText: stepHidden ? HIDDEN : `${step.count}件`,
        dropText: stepHidden
          ? HIDDEN
          : step.droppedFromPrevious === null
            ? '—'
            : `-${step.droppedFromPrevious}件`,
        percent: stepHidden ? 0 : percentOf(step.count ?? 0, first),
      }
    }),
  }
}

/** AC-EYEX-51: 原因は断定せず、根拠件数つきの候補として指標ごとに並べる。 */
export function causeCandidatesForMetric(
  report: AnalyticsReport,
  metric: AnalyticsMetric,
): AnalyticsCauseCandidate[] {
  return report.causeCandidates.filter((candidate) => candidate.metric === metric)
}

/** UC-EYEX-108: 空・抑制・失敗は理由と次の操作を持ち、素の 0 にはならない。 */
export function statusGuidance(
  report: AnalyticsReport,
): { reason: string; nextAction: string } | undefined {
  if (report.status === 'ok' || report.reason === null || report.nextAction === null)
    return undefined
  return { reason: report.reason, nextAction: report.nextAction }
}

/* --- お知らせ・アラート (UC-EYEX-178, 179, AC-EYEX-120) -------------------- */

const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  notice: 'お知らせ',
  alert: 'アラート',
}

export function alertKindLabel(kind: AlertKind): string {
  return ALERT_KIND_LABEL[kind]
}

/** 既読と対応済みは別の事実。片方を見て他方を推測しない (AC-EYEX-120)。 */
export function alertReadLabel(alert: AlertRecord): string {
  return alert.readAt === null ? '未読' : '既読'
}

export function alertResolutionLabel(alert: AlertRecord): string {
  return alert.resolvedAt === null ? '未対応' : '対応済み'
}

const ALERT_CONDITION_LABEL: Record<AlertCode, string> = {
  long_wait: '待ち時間の超過',
  recording_save_failure: '録音の保存失敗',
  settings_contradiction: '設定の矛盾',
}

export function alertConditionLabel(code: AlertCode): string {
  return ALERT_CONDITION_LABEL[code]
}
