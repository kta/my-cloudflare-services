/**
 * 保存の前に出す影響の試算。**読み取り専用**で、1 行も書き換えない。
 *
 * 3 面（設備と点検 / ご来店の目的 / 営業時間）が同じ器を使うので、判定の決めも 1 つに揃える。
 * - 重なりは半開区間 `[開始, 終わり)`。左端に始まるご予約は影響し、右端に始まるご予約は影響しない。
 * - 基準時刻（`now`）は必ず引数で受ける。このファイルは `Date.now()` を 1 度も呼ばない。
 * - JST の暦日は `@app/shared` の `toJstDateString` で解く（UTC 15:00 が JST の日境）。
 *
 * 保存しても割り当ては自動で付け替えない（AC-SET-13）。ここは「何件に響くか」を数えるだけである。
 */
import type { LocalDate, LocalTime, SettingsImpactItem } from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { and, asc, eq, gte, inArray, lt, notInArray } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import {
  reservationAssignments,
  reservationPurposes,
  reservations,
  visitPurposes,
} from '../db/schema'

/** 影響の試算が読む、ご予約 1 件の最小の形。 */
export type ImpactReservation = {
  id: string
  /** ISO8601（UTC）。 */
  startsAt: string
  /** ISO8601（UTC）。片付け時間は含まない。 */
  endsAt: string
  /** ウォークインは NULL のまま確定できるので null を取る。 */
  customerName: string | null
  /** 台帳の帯と同じ短い名前。目的が複数あるときは `・` で連結済み。 */
  purposeNameShort: string
  /** この予約が押さえている設備の id。 */
  equipmentIds: string[]
}

/** 受けられなくなるかを見る Web 枠 1 つ。 */
export type ImpactWebSlot = {
  purposeId: string
  /** ISO8601（UTC）。 */
  startsAt: string
  /** 次のご予約・閉店までに空いている分。この分に所要が収まらない枠が落ちる。 */
  availableMinutes: number
  /** 「視力測定機Aが空きません」の主語。 */
  equipmentName: string
}

/** 1 日ぶんの受付できる区間（`store-settings.ts` の `acceptableWindows` の結果）。 */
export type ImpactBusinessDay = {
  /** JST の暦日。 */
  date: LocalDate
  /** 区間 0 本は定休（その日のご予約はすべて外れる）。 */
  windows: { startsAt: LocalTime; endsAt: LocalTime }[]
}

const MS_PER_MINUTE = 60_000
const JST_OFFSET_MS = 9 * 60 * MS_PER_MINUTE

/** JST の 0:00 から数えた分。日を跨ぐご予約は 1440 を超える値になる（どの区間にも収まらない）。 */
function toJstClockMinutes(iso: string): number {
  const shifted = new Date(Date.parse(iso) + JST_OFFSET_MS)
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

/** `HH:MM` を JST の 0:00 から数えた分に直す。 */
function clockToMinutes(time: LocalTime): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

/** 影響カードの 1 行の文。お名前が無いご予約（ウォークイン）でも `null 様` と書かない。 */
function labelOf(reservation: ImpactReservation): string {
  const who =
    reservation.customerName === null ? 'ウォークインのお客様' : `${reservation.customerName} 様`
  return `${who}　${reservation.purposeNameShort}`
}

/** ご予約 1 件を影響カードの 1 行に直す。 */
function toItem(reservation: ImpactReservation): SettingsImpactItem {
  return {
    at: reservation.startsAt,
    label: labelOf(reservation),
    targetType: 'reservation',
    targetId: reservation.id,
  }
}

/** 基準時刻より前に終わったご予約は、もう手の打ちようが無いので数えない。 */
function isOver(reservation: ImpactReservation, now: string): boolean {
  return Date.parse(reservation.endsAt) <= Date.parse(now)
}

/** 開始の早い順に並べる。件数だけでなく並びも画面と揃える。 */
function byStart(a: SettingsImpactItem, b: SettingsImpactItem): number {
  return Date.parse(a.at) - Date.parse(b.at)
}

/**
 * 設備を止めると影響するご予約（AC-SET-13 / AC-SET-14）。
 * 重なりは半開区間で見る（`予約の開始 < 止める終わり && 予約の終わり > 止める開始`）。
 */
export function impactOfEquipmentStop(input: {
  reservations: ImpactReservation[]
  equipmentId: string
  /** ISO8601（UTC）。 */
  startsAt: string
  /** ISO8601（UTC）。 */
  endsAt: string
  /** ISO8601（UTC）。 */
  now: string
}): SettingsImpactItem[] {
  const stopStart = Date.parse(input.startsAt)
  const stopEnd = Date.parse(input.endsAt)

  return input.reservations
    .filter((r) => !isOver(r, input.now))
    .filter((r) => r.equipmentIds.includes(input.equipmentId))
    .filter((r) => Date.parse(r.startsAt) < stopEnd && Date.parse(r.endsAt) > stopStart)
    .map(toItem)
    .sort(byStart)
}

/**
 * 所要時間を延ばすと受けられなくなる Web 枠（AC-SET-15）。
 * **短くする変更は 1 件も落とさない** — 空きが増えるだけで、いま出している枠は全部残るからである。
 */
export function impactOfPurposeDuration(input: {
  webSlots: ImpactWebSlot[]
  purposeId: string
  /** JST の暦日。この日を含む。 */
  from: LocalDate
  /** JST の暦日。この日を含む。 */
  to: LocalDate
  /** いま保存されている所要（分）。 */
  currentDurationMinutes: number
  /** 保存しようとしている所要（分）。 */
  durationMinutes: number
}): SettingsImpactItem[] {
  if (input.durationMinutes <= input.currentDurationMinutes) return []

  return input.webSlots
    .filter((slot) => slot.purposeId === input.purposeId)
    .filter((slot) => {
      const date = toJstDateString(slot.startsAt)
      return date >= input.from && date <= input.to
    })
    .filter((slot) => slot.availableMinutes < input.durationMinutes)
    .map((slot) => ({
      at: slot.startsAt,
      label: `${slot.equipmentName}が空きません`,
      targetType: 'web_slot' as const,
      // Web 枠は行として存在しない（その場で計算した候補）ので id を持たない。
      targetId: null,
    }))
    .sort(byStart)
}

/**
 * 営業時間・止める帯を変えると受付できる区間から外れるご予約。
 * `days` に無い日は試算の範囲の外なので数えない。定休は `windows: []` で明示的に渡す。
 */
export function impactOfBusinessHours(input: {
  reservations: ImpactReservation[]
  days: ImpactBusinessDay[]
  /** ISO8601（UTC）。 */
  now: string
}): SettingsImpactItem[] {
  const byDate = new Map(input.days.map((day) => [day.date, day.windows]))

  return input.reservations
    .filter((r) => !isOver(r, input.now))
    .filter((r) => {
      const windows = byDate.get(toJstDateString(r.startsAt))
      if (!windows) return false

      const startMinutes = toJstClockMinutes(r.startsAt)
      // 終わりは開始からの差で数える。日を跨ぐご予約が翌日の 0:30 に化けないようにする。
      const endMinutes =
        startMinutes + (Date.parse(r.endsAt) - Date.parse(r.startsAt)) / MS_PER_MINUTE
      return !windows.some(
        (w) => startMinutes >= clockToMinutes(w.startsAt) && endMinutes <= clockToMinutes(w.endsAt),
      )
    })
    .map(toItem)
    .sort(byStart)
}

/**
 * 札を赤くするかどうか（AC-SET-14）。合計 0 件なら `info`、1 件以上なら `action`。
 * `SettingsImpactReport` の refine と同じ式にする（数えた件数と札の色を食い違わせない）。
 */
export function severityOf(report: {
  affectedReservations: SettingsImpactItem[]
  affectedWebSlots: SettingsImpactItem[]
}): 'info' | 'action' {
  return report.affectedReservations.length + report.affectedWebSlots.length === 0
    ? 'info'
    : 'action'
}

/**
 * 試算が読むご予約の唯一の入口。**この関数の外で `reservations` を SELECT しない**
 * （P2 が読み口を広げるときに触る場所を 1 か所に閉じる）。
 * 期間は ISO8601（UTC）の半開区間 `[from, to)`。取り消し済みと無断キャンセルは読まない。
 */
export async function readAffectedReservations(
  db: DrizzleD1Database,
  input: { organizationId: string; storeId: string; from: string; to: string },
): Promise<ImpactReservation[]> {
  const rows = await db
    .select({
      id: reservations.id,
      startsAt: reservations.startsAt,
      endsAt: reservations.endsAt,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.organizationId, input.organizationId),
        eq(reservations.storeId, input.storeId),
        gte(reservations.startsAt, input.from),
        lt(reservations.startsAt, input.to),
        notInArray(reservations.status, ['cancelled', 'no_show']),
      ),
    )
    .orderBy(asc(reservations.startsAt))

  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)

  const assignments = await db
    .select({
      reservationId: reservationAssignments.reservationId,
      targetId: reservationAssignments.targetId,
    })
    .from(reservationAssignments)
    .where(
      and(
        eq(reservationAssignments.organizationId, input.organizationId),
        eq(reservationAssignments.kind, 'equipment'),
        inArray(reservationAssignments.reservationId, ids),
      ),
    )

  const purposeRows = await db
    .select({
      reservationId: reservationPurposes.reservationId,
      nameShort: visitPurposes.nameShort,
    })
    .from(reservationPurposes)
    .innerJoin(
      visitPurposes,
      and(
        eq(reservationPurposes.purposeId, visitPurposes.id),
        eq(visitPurposes.organizationId, input.organizationId),
      ),
    )
    .where(
      and(
        eq(reservationPurposes.organizationId, input.organizationId),
        inArray(reservationPurposes.reservationId, ids),
      ),
    )
    .orderBy(asc(reservationPurposes.sortOrder))

  const equipmentByReservation = new Map<string, string[]>()
  for (const row of assignments) {
    if (row.targetId === null) continue // 「あとで決める」は設備を押さえていない
    const list = equipmentByReservation.get(row.reservationId) ?? []
    list.push(row.targetId)
    equipmentByReservation.set(row.reservationId, list)
  }

  const namesByReservation = new Map<string, string[]>()
  for (const row of purposeRows) {
    const list = namesByReservation.get(row.reservationId) ?? []
    list.push(row.nameShort)
    namesByReservation.set(row.reservationId, list)
  }

  return rows.map((row) => ({
    id: row.id,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    // customers 表は P4 で入る。お名前を読めるようになるのはそのときで、JOIN を足すのはここ 1 か所である。
    customerName: null,
    purposeNameShort: (namesByReservation.get(row.id) ?? []).join('・'),
    equipmentIds: equipmentByReservation.get(row.id) ?? [],
  }))
}
