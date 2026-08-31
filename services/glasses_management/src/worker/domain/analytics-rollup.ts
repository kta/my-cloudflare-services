/**
 * 1 店舗 1 日分の生データを `analytics_daily` の行へ畳む**純関数**。
 * DB に触らない（読み書きは呼び出し側の仕事）。日付は必ず `toJstDateString()` を
 * 通し、UTC の暦日で数えない。
 *
 * 人数（「名」）は 1 行も書かない。数える経路がまだ無いので、件数だけを保存する。
 * `closed` の行は**必ず 1 行書く** — 定休日の 0 件（行がある）と欠測（行が無い）を
 * 区別する印を兼ねるためである。
 */

import type { AnalyticsDailyMetric, AnalyticsDimension } from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { ANALYTICS_TARGETS, isRevisitWithinWindow, medianOf, UNASSIGNED_KEY } from './analytics'

/** `analytics_daily` に書く 1 行（id と時刻は呼び出し側が付ける）。 */
export type AnalyticsRow = {
  organizationId: string
  storeId: string
  date: string
  metric: AnalyticsDailyMetric
  dimension: AnalyticsDimension
  dimensionKey: string
  value: number
}

export type RollupInput = {
  organizationId: string
  storeId: string
  /** 集計する JST の暦日 `YYYY-MM-DD`。 */
  date: string
  businessHours: readonly { weekday: number; isClosed: string }[]
  calendarExceptions: readonly { date: string; kind: string }[]
  reservations: readonly {
    id: string
    source: string
    status: string
    startsAt: string
    createdAt: string
    cancelReason: string | null
    customerId: string | null
  }[]
  reservationAssignments: readonly {
    reservationId: string
    kind: string
    targetId: string | null
  }[]
  reservationPurposes: readonly { reservationId: string; purposeId: string }[]
  walkIns: readonly { id: string; reservationId: string; arrivedAt: string }[]
  visitEvents: readonly {
    subjectType: string
    subjectId: string
    stage: string
    occurredAt: string
    staffId: string | null
  }[]
  /** その日の来店客の、**その日より後**の来店日。再来の判定にだけ使う。 */
  laterVisits: readonly { customerId: string; date: string }[]
  /** その日の来店客の来店回数（`customers.visit_count`）。来店回数タブの 4 階級に使う。 */
  customerVisitCounts?: readonly { customerId: string; visitCount: number }[]
}

export type RollupResult = {
  rows: AnalyticsRow[]
  /** どの取消層にも当てられなかった行の数。**黙って `customer` に丸めない。** */
  dropped: number
}

/** 予約の生存（取消・無断を含まない）。 */
const LIVE_STATUSES = new Set(['confirmed', 'arrived', 'serving', 'done'])

/**
 * 来店回数の 4 階級。**その日より前に何回いらしていたか**で分けるので、
 * 書き戻し済みの `visit_count`（その日を含む）から 1 を引いて数える。
 */
function visitFrequencyClass(visitCount: number): string {
  const before = Math.max(0, visitCount - 1)
  if (before === 0) return 'first'
  if (before === 1) return 'second'
  if (before <= 4) return 'third_to_fifth'
  return 'sixth_plus'
}

/** JST の「時」。`'14'` のようにゼロ埋めしない。 */
function jstHour(at: string): string {
  const shifted = new Date(Date.parse(at) + 9 * 3_600_000)
  return String(shifted.getUTCHours())
}

/** 取消 1 件をどの層に当てるか。当たらなければ `null`（落として数える）。 */
function cancelLayerOf(row: {
  status: string
  source: string
  cancelReason: string | null
}): string | null {
  if (row.status === 'no_show') return 'no_show'
  if (row.status !== 'cancelled') return null
  if (row.source === 'web') return 'web'
  if (
    row.cancelReason === 'customer' ||
    row.cancelReason === 'store' ||
    row.cancelReason === 'duplicate'
  ) {
    return row.cancelReason
  }
  return null
}

/** 数え上げの入れ物。`add` した鍵だけが行になる（0 の行を無限に作らない）。 */
class Tally {
  private readonly counts = new Map<string, Map<string, number>>()

  add(dimension: AnalyticsDimension, key: string, amount = 1): void {
    const bucket = this.counts.get(dimension) ?? new Map<string, number>()
    bucket.set(key, (bucket.get(key) ?? 0) + amount)
    this.counts.set(dimension, bucket)
  }

  /** 数えた鍵ぶんだけ行にする。0 を明示して足した鍵は 0 の行として残る。 */
  rows(
    metric: AnalyticsDailyMetric,
    base: Pick<RollupInput, 'organizationId' | 'storeId' | 'date'>,
  ): AnalyticsRow[] {
    const out: AnalyticsRow[] = []
    for (const [dimension, bucket] of this.counts) {
      for (const [dimensionKey, value] of bucket) {
        out.push({
          ...base,
          metric,
          dimension: dimension as AnalyticsDimension,
          dimensionKey,
          value,
        })
      }
    }
    return out
  }
}

/** その日が定休・臨時休業か。暦（例外）が曜日より強い。 */
function isClosedOn(input: RollupInput): boolean {
  const exception = input.calendarExceptions.find((row) => row.date === input.date)
  if (exception !== undefined) return exception.kind === 'closed'
  const weekday = new Date(`${input.date}T00:00:00.000Z`).getUTCDay()
  const hours = input.businessHours.find((row) => row.weekday === weekday)
  // 曜日の行が無い店舗は「設定未完」なので休みとして扱う（暗黙の営業日を作らない）。
  return hours === undefined || hours.isClosed === '1'
}

/**
 * 1 日分を畳む。返る行は `analytics_daily` の 6 列一意鍵で重複しない。
 */
export function rollupDay(input: RollupInput): RollupResult {
  const base = { organizationId: input.organizationId, storeId: input.storeId, date: input.date }
  const rows: AnalyticsRow[] = []

  // 「その日を集計した」印。定休は 1、営業日は 0。
  rows.push({
    ...base,
    metric: 'closed',
    dimension: 'total',
    dimensionKey: '',
    value: isClosedOn(input) ? 1 : 0,
  })

  const staffOf = new Map<string, string>()
  for (const assignment of input.reservationAssignments) {
    if (assignment.kind === 'staff' && assignment.targetId !== null) {
      staffOf.set(assignment.reservationId, assignment.targetId)
    }
  }
  const purposesOf = new Map<string, string[]>()
  for (const row of input.reservationPurposes) {
    purposesOf.set(row.reservationId, [...(purposesOf.get(row.reservationId) ?? []), row.purposeId])
  }

  /* --- 予約（来店日 / 受付日） ------------------------------------------- */

  const reservationsTally = new Tally()
  reservationsTally.add('total', '', 0)
  const receivedTally = new Tally()
  const cancelTally = new Tally()
  const noShowTally = new Tally()
  let dropped = 0

  for (const row of input.reservations) {
    const visitDate = toJstDateString(row.startsAt)
    const isLive = LIVE_STATUSES.has(row.status)
    // 「かぞえる日」を受付日にしても、予約数は取消・無断を数えない（来店日と同じ数え方）。
    // 取消は `cancellations` が来店予定日で持っているので、ここで数えると二重になる。
    if (isLive && toJstDateString(row.createdAt) === input.date) {
      receivedTally.add('total', '')
      receivedTally.add('source', row.source)
      for (const purposeId of purposesOf.get(row.id) ?? []) receivedTally.add('purpose', purposeId)
    }
    if (visitDate !== input.date) continue

    if (isLive) {
      reservationsTally.add('total', '')
      reservationsTally.add('staff', staffOf.get(row.id) ?? UNASSIGNED_KEY)
      reservationsTally.add('hour', jstHour(row.startsAt))
      reservationsTally.add('source', row.source)
      for (const purposeId of purposesOf.get(row.id) ?? [])
        reservationsTally.add('purpose', purposeId)
      continue
    }
    const layer = cancelLayerOf(row)
    if (layer === null) {
      // データの壊れを黙って丸めない。`other` の層も作らない。
      dropped += 1
      continue
    }
    cancelTally.add('cancel_reason', layer)
    cancelTally.add('total', '')
    if (layer === 'no_show') noShowTally.add('total', '')
  }

  rows.push(...reservationsTally.rows('reservations', base))
  rows.push(...receivedTally.rows('reservations_received', base))
  rows.push(...cancelTally.rows('cancellations', base))
  rows.push(...noShowTally.rows('no_shows', base))

  // 定休日はここで終える（受付も待ち時間も起こらない）。
  if (isClosedOn(input) && input.visitEvents.length === 0 && input.walkIns.length === 0) {
    return { rows, dropped }
  }

  /* --- ご来店の受付（ウォークインを含む） -------------------------------- */

  const walkInIds = new Set(input.walkIns.map((row) => row.id))
  // ウォークインが起こす予約は「予約の受付」として二重に数えない。
  const walkInReservationIds = new Set(input.walkIns.map((row) => row.reservationId))
  const customerOf = new Map(input.reservations.map((row) => [row.id, row.customerId]))

  type Reception = { key: string; at: string; staffId: string | null; customerId: string | null }
  const receptions = new Map<string, Reception>()

  for (const event of input.visitEvents) {
    if (event.stage !== 'received') continue
    if (toJstDateString(event.occurredAt) !== input.date) continue
    if (event.subjectType === 'reservation' && walkInReservationIds.has(event.subjectId)) continue
    const key = `${event.subjectType}:${event.subjectId}`
    if (receptions.has(key)) continue
    receptions.set(key, {
      key,
      at: event.occurredAt,
      staffId:
        event.subjectType === 'reservation'
          ? (staffOf.get(event.subjectId) ?? event.staffId)
          : event.staffId,
      customerId:
        event.subjectType === 'reservation' ? (customerOf.get(event.subjectId) ?? null) : null,
    })
  }
  // 工程を 1 つも刻めていないウォークインも受付として数える（到着が事実である）。
  for (const walkIn of input.walkIns) {
    const key = `walkin:${walkIn.id}`
    if (receptions.has(key)) continue
    if (toJstDateString(walkIn.arrivedAt) !== input.date) continue
    receptions.set(key, { key, at: walkIn.arrivedAt, staffId: null, customerId: null })
  }

  const visitCountOf = new Map(
    (input.customerVisitCounts ?? []).map((row) => [row.customerId, row.visitCount]),
  )
  const receptionTally = new Tally()
  for (const reception of receptions.values()) {
    receptionTally.add('total', '')
    receptionTally.add('staff', reception.staffId ?? UNASSIGNED_KEY)
    receptionTally.add('hour', jstHour(reception.at))
    // お客様の行が無い受付（ウォークインの飛び込み）は階級に入れない。
    // 何回目か分からないものを「初めて」に寄せると、初回の件数が水増しされる。
    const visitCount =
      reception.customerId === null ? undefined : visitCountOf.get(reception.customerId)
    if (visitCount !== undefined) {
      receptionTally.add('visit_frequency', visitFrequencyClass(visitCount))
    }
  }
  rows.push(...receptionTally.rows('receptions', base))

  /* --- お待ち時間（received → 最初の consulting） ------------------------ */

  const firstConsulting = new Map<string, string>()
  for (const event of input.visitEvents) {
    if (event.stage !== 'consulting') continue
    const key = `${event.subjectType}:${event.subjectId}`
    const seen = firstConsulting.get(key)
    if (seen === undefined || event.occurredAt < seen) firstConsulting.set(key, event.occurredAt)
  }

  const waitAll: number[] = []
  const waitByHour = new Map<string, number[]>()
  for (const event of input.visitEvents) {
    if (event.stage !== 'received') continue
    if (toJstDateString(event.occurredAt) !== input.date) continue
    const key = `${event.subjectType}:${event.subjectId}`
    if (event.subjectType === 'walkin' && !walkInIds.has(event.subjectId)) continue
    const consultingAt = firstConsulting.get(key)
    // consulting へ進んでいない方は標本に入れない（まだ待っている途中である）。
    if (consultingAt === undefined) continue
    const seconds = Math.max(
      0,
      Math.round((Date.parse(consultingAt) - Date.parse(event.occurredAt)) / 1000),
    )
    waitAll.push(seconds)
    const hour = jstHour(event.occurredAt)
    waitByHour.set(hour, [...(waitByHour.get(hour) ?? []), seconds])
  }
  const waitMedian = medianOf(waitAll)
  if (waitMedian !== null) {
    rows.push({
      ...base,
      metric: 'wait_seconds_median',
      dimension: 'total',
      dimensionKey: '',
      value: waitMedian,
    })
  }
  for (const [hour, samples] of waitByHour) {
    const median = medianOf(samples)
    if (median === null) continue
    rows.push({
      ...base,
      metric: 'wait_seconds_median',
      dimension: 'hour',
      dimensionKey: hour,
      value: median,
    })
  }

  /* --- 90 日以内の再来（分子だけを保存し、率は読み出し時に割る） ---------- */

  const revisitTally = new Tally()
  let revisitTotal = 0
  const laterByCustomer = new Map<string, string[]>()
  for (const visit of input.laterVisits) {
    laterByCustomer.set(visit.customerId, [
      ...(laterByCustomer.get(visit.customerId) ?? []),
      visit.date,
    ])
  }
  const countedCustomers = new Set<string>()
  for (const reception of receptions.values()) {
    if (reception.customerId === null || countedCustomers.has(reception.customerId)) continue
    countedCustomers.add(reception.customerId)
    const revisited = (laterByCustomer.get(reception.customerId) ?? []).some((date) =>
      isRevisitWithinWindow(input.date, date, ANALYTICS_TARGETS),
    )
    if (!revisited) continue
    revisitTally.add('staff', reception.staffId ?? UNASSIGNED_KEY)
    revisitTotal += 1
  }
  if (revisitTotal > 0) revisitTally.add('total', '', revisitTotal)
  rows.push(...revisitTally.rows('revisits_90d', base))

  return { rows, dropped }
}
