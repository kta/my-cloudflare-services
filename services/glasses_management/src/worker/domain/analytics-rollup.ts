import { jstDaysBetween, toJstDateString } from '@app/shared'

const ANALYTICS_SOURCES = ['phone', 'counter', 'web', 'walkin'] as const
const ANALYTICS_VISIT_FREQUENCIES = ['first', 'second', 'third_to_fifth', 'sixth_or_more'] as const

type AnalyticsSource = (typeof ANALYTICS_SOURCES)[number]
type AnalyticsVisitFrequency = (typeof ANALYTICS_VISIT_FREQUENCIES)[number]
type ReservationStatus = 'confirmed' | 'arrived' | 'serving' | 'done' | 'cancelled' | 'no_show'
type CancellationReason = 'customer' | 'store' | 'duplicate' | 'no_show'

type AnalyticsMetric =
  | 'closed'
  | 'reservations'
  | 'scheduled_reservations'
  | 'reservations_received'
  | 'receptions'
  | 'cancellations'
  | 'wait_seconds_histogram'
  | 'revisit_eligible'
  | 'revisit_returning_90d'

type AnalyticsDimension =
  | 'total'
  | 'staff'
  | 'purpose'
  | 'hour'
  | 'source'
  | 'cancellation_category'
  | 'wait_seconds'
  | 'visit_frequency'

export interface AnalyticsDailyRow {
  organizationId: string
  storeId: string
  date: string
  metric: AnalyticsMetric
  dimension: AnalyticsDimension
  dimensionKey: string
  dimensionLabel: string
  value: number
}

interface AnalyticsStaff {
  id: string
  label: string
  isActive: boolean
}

const SOURCE_LABELS: Record<AnalyticsSource, string> = {
  phone: 'お電話',
  counter: '店頭',
  web: 'Web予約',
  walkin: 'ウォークイン',
}

const VISIT_FREQUENCY_LABELS: Record<AnalyticsVisitFrequency, string> = {
  first: '初めて',
  second: '2回目',
  third_to_fifth: '3〜5回',
  sixth_or_more: '6回以上',
}

const CANCELLATION_LABELS = {
  customer: 'お客様のご都合',
  store: '店舗の都合',
  duplicate: '予約の重複',
  no_show: 'ご来店がなかった',
  web: 'Webからの取消',
} as const

/** DB の join 後にロールアップ関数へ渡す予約の最小射影。 */
export interface AnalyticsReservation {
  id: string
  organizationId: string
  storeId: string
  source: AnalyticsSource
  status: ReservationStatus
  startsAt: string
  createdAt: string
  customerId: string | null
  /** 接客担当。未定は受付実績だけ analytics_daily の unassigned に分ける。 */
  staffId: string | null
  purposeIds: readonly string[]
  purposeLabels?: Readonly<Record<string, string>>
  /** 完了前の累計来店回数。未紐付けの walkin は null。 */
  visitCountBefore?: number | null
  cancelReason?: CancellationReason | null
}

export interface AnalyticsVisitEvent {
  organizationId: string
  storeId: string
  subjectId: string
  stage:
    | 'received'
    | 'waiting'
    | 'consulting'
    | 'fitting'
    | 'measuring'
    | 'checkout'
    | 'handover'
    | 'left'
  occurredAt: string
}

export interface AnalyticsRollupInput {
  organizationId: string
  storeId: string
  /** JST YYYY-MM-DD */
  date: string
  /** 呼出し元の Cron / backfill が注入する基準時刻。 */
  now: Date
  /** このJST日付までを確定済みとして扱う。省略時は基準時刻のJST当日。 */
  completedThrough?: string
  isClosed: boolean
  reservations: readonly AnalyticsReservation[]
  visitEvents: readonly AnalyticsVisitEvent[]
  /** 現行staffの表示名。activeなら受付0件も行を残す。 */
  staff?: readonly AnalyticsStaff[]
}

export interface AnalyticsRollupResult {
  rows: AnalyticsDailyRow[]
  dropped: { cancellationReservationIds: string[] }
}

function isScoped(
  item: Pick<AnalyticsReservation | AnalyticsVisitEvent, 'organizationId' | 'storeId'>,
  input: AnalyticsRollupInput,
): boolean {
  return item.organizationId === input.organizationId && item.storeId === input.storeId
}

function hourOf(input: string): string {
  const shifted = new Date(new Date(input).getTime() + 9 * 60 * 60_000)
  return String(shifted.getUTCHours())
}

function visitFrequency(countBefore: number | null | undefined): AnalyticsVisitFrequency | null {
  if (countBefore === null || countBefore === undefined || countBefore < 0) return null
  if (countBefore === 0) return 'first'
  if (countBefore === 1) return 'second'
  if (countBefore <= 4) return 'third_to_fifth'
  return 'sixth_or_more'
}

function cancellationCategory(
  reservation: AnalyticsReservation,
): 'customer' | 'store' | 'duplicate' | 'no_show' | 'web' | null {
  if (reservation.status === 'no_show') return 'no_show'
  if (reservation.status !== 'cancelled') return null
  if (reservation.source === 'web') return 'web'
  if (
    reservation.cancelReason === 'customer' ||
    reservation.cancelReason === 'store' ||
    reservation.cancelReason === 'duplicate'
  ) {
    return reservation.cancelReason
  }
  return null
}

/**
 * 1 店舗・1 JST 日を analytics_daily の加算行へ変換する純関数。
 * 未確定日は予約系だけを先に作り、`closed` と来店後に確定する指標を推測しない。
 */
export function rollupAnalyticsDay(input: AnalyticsRollupInput): AnalyticsRollupResult {
  const completedThrough = input.completedThrough ?? toJstDateString(input.now)
  const isForecast = input.date > completedThrough

  const values = new Map<string, AnalyticsDailyRow>()
  const dropped = { cancellationReservationIds: [] as string[] }
  const add = (
    metric: AnalyticsMetric,
    dimension: AnalyticsDimension = 'total',
    dimensionKey = '',
    amount = 1,
    dimensionLabel = dimensionKey || '合計',
  ) => {
    const key = `${metric}\u0000${dimension}\u0000${dimensionKey}`
    const row = values.get(key)
    if (row) {
      row.value += amount
      return
    }
    values.set(key, {
      organizationId: input.organizationId,
      storeId: input.storeId,
      date: input.date,
      metric,
      dimension,
      dimensionKey,
      dimensionLabel,
      value: amount,
    })
  }
  const addSources = (metric: AnalyticsMetric, counts: ReadonlyMap<AnalyticsSource, number>) => {
    for (const source of ANALYTICS_SOURCES)
      add(metric, 'source', source, counts.get(source) ?? 0, SOURCE_LABELS[source])
  }
  const addFrequencies = (
    metric: AnalyticsMetric,
    counts: ReadonlyMap<AnalyticsVisitFrequency, number>,
  ) => {
    for (const frequency of ANALYTICS_VISIT_FREQUENCIES) {
      add(
        metric,
        'visit_frequency',
        frequency,
        counts.get(frequency) ?? 0,
        VISIT_FREQUENCY_LABELS[frequency],
      )
    }
  }

  if (!isForecast)
    add('closed', 'total', '', input.isClosed ? 1 : 0, input.isClosed ? '定休日' : '営業日')

  const scopedReservations = input.reservations.filter((reservation) =>
    isScoped(reservation, input),
  )
  const scheduled = scopedReservations.filter(
    (reservation) => toJstDateString(reservation.startsAt) === input.date,
  )
  const received = scopedReservations.filter(
    (reservation) => toJstDateString(reservation.createdAt) === input.date,
  )
  const active = scheduled.filter(
    (reservation) => reservation.status !== 'cancelled' && reservation.status !== 'no_show',
  )
  const receivedActive = received.filter(
    (reservation) => reservation.status !== 'cancelled' && reservation.status !== 'no_show',
  )

  add('scheduled_reservations', 'total', '', scheduled.length)
  add('reservations', 'total', '', active.length)
  add('reservations_received', 'total', '', receivedActive.length)

  for (const [metric, reservations] of [
    ['reservations', active],
    ['reservations_received', receivedActive],
  ] as const) {
    const sourceCounts = new Map<AnalyticsSource, number>()
    for (const reservation of reservations) {
      sourceCounts.set(reservation.source, (sourceCounts.get(reservation.source) ?? 0) + 1)
      add(
        metric,
        'hour',
        hourOf(metric === 'reservations' ? reservation.startsAt : reservation.createdAt),
        1,
        `${hourOf(metric === 'reservations' ? reservation.startsAt : reservation.createdAt)}時台`,
      )
      for (const purposeId of reservation.purposeIds)
        add(metric, 'purpose', purposeId, 1, reservation.purposeLabels?.[purposeId] ?? 'ご来店')
    }
    addSources(metric, sourceCounts)
  }

  for (const reservation of scheduled) {
    if (reservation.status !== 'cancelled' && reservation.status !== 'no_show') continue
    const category = cancellationCategory(reservation)
    if (category)
      add('cancellations', 'cancellation_category', category, 1, CANCELLATION_LABELS[category])
    else dropped.cancellationReservationIds.push(reservation.id)
  }

  // 休業日は予約・取消の履歴を残すが、来店後にだけ確定する実績を推測しない。
  if (isForecast || input.isClosed) return { rows: [...values.values()], dropped }

  const completed = scheduled.filter((reservation) => reservation.status === 'done')
  add('receptions', 'total', '', completed.length)
  const receptionSources = new Map<AnalyticsSource, number>()
  const receptionFrequencies = new Map<AnalyticsVisitFrequency, number>()
  for (const reservation of completed) {
    const staff = reservation.staffId ?? 'unassigned'
    add(
      'receptions',
      'staff',
      staff,
      1,
      staff === 'unassigned'
        ? '担当が未定'
        : (input.staff?.find((candidate) => candidate.id === staff)?.label ?? '担当者'),
    )
    receptionSources.set(reservation.source, (receptionSources.get(reservation.source) ?? 0) + 1)
    const frequency = visitFrequency(reservation.visitCountBefore)
    if (frequency)
      receptionFrequencies.set(frequency, (receptionFrequencies.get(frequency) ?? 0) + 1)
  }
  addSources('receptions', receptionSources)
  addFrequencies('receptions', receptionFrequencies)
  for (const staff of input.staff?.filter((candidate) => candidate.isActive) ?? []) {
    add('receptions', 'staff', staff.id, 0, staff.label)
  }

  const events = input.visitEvents.filter((event) => isScoped(event, input))
  for (const receivedEvent of events) {
    if (
      receivedEvent.stage !== 'received' ||
      toJstDateString(receivedEvent.occurredAt) !== input.date
    )
      continue
    const firstConsulting = events
      .filter(
        (event) =>
          event.subjectId === receivedEvent.subjectId &&
          event.stage === 'consulting' &&
          event.occurredAt > receivedEvent.occurredAt,
      )
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))[0]
    if (!firstConsulting) continue
    const waitSeconds =
      (Date.parse(firstConsulting.occurredAt) - Date.parse(receivedEvent.occurredAt)) / 1000
    if (Number.isInteger(waitSeconds) && waitSeconds >= 0) {
      add(
        'wait_seconds_histogram',
        'wait_seconds',
        `hour:${hourOf(receivedEvent.occurredAt)}:${waitSeconds}`,
        1,
        `${hourOf(receivedEvent.occurredAt)}時 ${waitSeconds}秒`,
      )
    }
  }

  for (const current of completed) {
    const staff = current.staffId
    if (staff === null) continue
    const staffLabel = input.staff?.find((candidate) => candidate.id === staff)?.label ?? '担当者'
    const hasPrior =
      current.customerId !== null &&
      input.reservations.some((candidate) => {
        if (
          candidate.id === current.id ||
          candidate.organizationId !== input.organizationId ||
          candidate.customerId !== current.customerId ||
          candidate.status !== 'done'
        ) {
          return false
        }
        const days = jstDaysBetween(candidate.startsAt, current.startsAt)
        return days >= 1 && days <= 90
      })
    add('revisit_eligible', 'staff', staff, 1, staffLabel)
    add('revisit_returning_90d', 'staff', staff, hasPrior ? 1 : 0, staffLabel)
  }

  return { rows: [...values.values()], dropped }
}
