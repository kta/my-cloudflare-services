/**
 * 台帳・空き枠・ご予約 1 件の**読み出し**。
 *
 * ドメイン層（`domain/ledger.ts` / `domain/availability.ts`）は純関数で、D1 も実時刻も
 * 触らない。その材料をここでまとめて読む。
 *
 * **1 日分は 1 回の `db.batch()` で読む**（`design/04-api.md` §3.6。16 文以内）。
 * 台帳は 1 分に何度も引かれる面なので、往復のたびに増える待ち時間が接客の手を止める。
 * 目的の短い名前・割当は `reservations` との JOIN で同じバッチに畳み、
 * 「予約を読んでから、その id で目的を読む」2 往復にしない。
 *
 * 全クエリを JWT の `org` と `storeId` で絞る。**query / body 由来の organizationId を
 * 認可の根拠にしない。**
 */

import type { EquipmentKind, SkillCode } from '@app/contracts'
import { and, asc, desc, eq, gt, gte, inArray, lt, notInArray } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import {
  type EquipmentUnit,
  jstDayRange,
  type MaintenanceBand,
  type OccupiedAssignment,
  type PurposeSpec,
  type SlotRules,
  type StaffMember,
  type StaffShiftBand,
} from '../../domain/availability'
import type {
  LedgerAssignmentRow,
  LedgerEquipmentRow,
  LedgerMaintenanceRow,
  LedgerPurposeRow,
  LedgerReservationRow,
  LedgerShiftRow,
  LedgerStaffRow,
} from '../../domain/ledger'
import {
  type BlackoutBand,
  type DayException,
  staffSubline,
  type WeeklyHours,
} from '../../domain/store-settings'
import {
  equipment,
  equipmentMaintenance,
  purposeRequirements,
  reservationAssignments,
  reservationPurposes,
  reservations,
  staff,
  staffShifts,
  staffSkills,
  storeBlackoutWindows,
  storeBusinessHours,
  storeCalendarExceptions,
  storeSlotRules,
  visitPurposes,
} from '../schema'

type Db = DrizzleD1Database

/** 真偽値は D1 では '0' / '1' の text。 */
const isOn = (value: string): boolean => value === '1'

/** 帯にしないご予約。取消の押さえは残っていることがあるので、読む側で外す。 */
const NOT_DRAWN: string[] = ['cancelled']
/** 枠を塞がないご予約。取消と ご来店なし は空き枠を即座に戻す。 */
const NOT_OCCUPYING: string[] = ['cancelled', 'no_show']

/**
 * 前日から続くご予約を拾うための、`reservations.starts_at` の下限（1 日）。
 *
 * 重なりの述語（`starts_at < ?to AND ends_at > ?from`）だけでは `starts_at` に下限が無く、
 * `reservations_org_store_start_idx` を**範囲で引けない**。SQLite は下限の無い範囲を
 * 「その組織・店舗のぜんぶ」として走査するので、rows read が**予約件数に比例して**伸びる
 * （3 店舗・1 日 20 予約・年 300 営業日なら 1 年で 1 日 291M 行。D1 無料枠は 5M 行/日で、
 * `admin` / `example_service` まで巻き添えで止まる。`07-nfr.md` §4.4 / §9.2）。
 * 予約の所要は最長 480 分＋片付け 60 分（契約 `DurationMinutes` と `store_slot_rules`）なので、
 * 1 日ぶん遡れば日跨ぎの押さえも 1 件残らず入る。
 */
const RESERVATION_LOOKBACK_MS = 86_400_000

/* --- 台帳 1 日分 ---------------------------------------------------------- */

export type LedgerDayRows = {
  hours: WeeklyHours[]
  exceptions: DayException[]
  slotRules: SlotRules | null
  staff: LedgerStaffRow[]
  shifts: LedgerShiftRow[]
  equipment: LedgerEquipmentRow[]
  maintenance: LedgerMaintenanceRow[]
  reservations: LedgerReservationRow[]
  assignments: LedgerAssignmentRow[]
  purposes: LedgerPurposeRow[]
}

/**
 * 台帳 1 日分を **1 回の `db.batch()`（11 文）** で読む。
 * `store_blackout_windows` は読まない —— 台帳の灰帯は担当ひとりの休憩であって、
 * 店舗の受付停止帯ではない（停止帯を読むのは空き枠エンジンだけ）。
 */
export async function readLedgerDay(
  db: Db,
  input: { organizationId: string; storeId: string; date: string },
): Promise<LedgerDayRows> {
  const { organizationId: org, storeId, date } = input
  const { fromIso, toIso } = jstDayRange(date)
  // **台帳の帯はその日に「始まる」ご予約だけで作る。**`03-data-model.md` §7.1 の SQL は
  // 重なり（`starts_at < ?4 AND ends_at > ?3`）で引いているが、台帳は 10:00 起点の
  // 表示窓に帯を割り付ける面で、前日から続く帯を置く列を持たない（`domain/ledger.ts` も
  // `toJstDateString(startsAt) === date` で同じ日に閉じている）。営業時間が日を跨ぐ店を
  // 受けるときは、窓の作り方（`LEDGER_WINDOW_START`）ごと決め直す必要がある。
  const ofDay = and(
    eq(reservations.organizationId, org),
    eq(reservations.storeId, storeId),
    gte(reservations.startsAt, fromIso),
    lt(reservations.startsAt, toIso),
    notInArray(reservations.status, NOT_DRAWN),
  )

  const [
    hours,
    exceptions,
    rules,
    staffRows,
    shiftRows,
    equipmentRows,
    maintenanceRows,
    reservationRows,
    assignmentRows,
    purposeRows,
    purposeNameRows,
  ] = await db.batch([
    db
      .select()
      .from(storeBusinessHours)
      .where(
        and(eq(storeBusinessHours.organizationId, org), eq(storeBusinessHours.storeId, storeId)),
      ),
    db
      .select()
      .from(storeCalendarExceptions)
      .where(
        and(
          eq(storeCalendarExceptions.organizationId, org),
          eq(storeCalendarExceptions.storeId, storeId),
          eq(storeCalendarExceptions.date, date),
        ),
      ),
    db
      .select()
      .from(storeSlotRules)
      .where(and(eq(storeSlotRules.organizationId, org), eq(storeSlotRules.storeId, storeId))),
    db
      .select()
      .from(staff)
      .where(and(eq(staff.organizationId, org), eq(staff.storeId, storeId)))
      .orderBy(asc(staff.sortOrder), asc(staff.createdAt)),
    db
      .select()
      .from(staffShifts)
      .where(
        and(
          eq(staffShifts.organizationId, org),
          eq(staffShifts.storeId, storeId),
          eq(staffShifts.date, date),
        ),
      ),
    db
      .select()
      .from(equipment)
      .where(and(eq(equipment.organizationId, org), eq(equipment.storeId, storeId)))
      .orderBy(asc(equipment.sortOrder), asc(equipment.createdAt)),
    db
      .select()
      .from(equipmentMaintenance)
      .where(
        and(
          eq(equipmentMaintenance.organizationId, org),
          eq(equipmentMaintenance.storeId, storeId),
          lt(equipmentMaintenance.startsAt, toIso),
          gt(equipmentMaintenance.endsAt, fromIso),
        ),
      ),
    db.select().from(reservations).where(ofDay).orderBy(asc(reservations.startsAt)),
    // **子表は `reservations` を外側の輪にして引く。**
    // `reservation_assignments` / `reservation_purposes` は `store_id` も日付も持たない
    // ので、素直に JOIN すると、統計の有無で実行計画がひっくり返り、
    // 「`organization_id = ?` だけを頼りに子表を組織まるごと走査する」形になる（実測）。
    // `IN (SELECT ...)` でも SQLite は走査＋ブルームフィルタを選ぶ。
    // **SQLite の `CROSS JOIN` は並べ替えを止める**ので、外側が必ず
    // `reservations_org_store_start_idx`（その日だけ）、内側が `..._org_reservation_idx`
    // になる。読む行数が予約件数ではなく**その日の件数**に比例する形はこれだけである。
    db
      .select({
        reservationId: reservationAssignments.reservationId,
        kind: reservationAssignments.kind,
        targetId: reservationAssignments.targetId,
        startsAt: reservationAssignments.startsAt,
        endsAt: reservationAssignments.endsAt,
      })
      .from(reservations)
      .crossJoin(reservationAssignments)
      .where(
        and(
          eq(reservationAssignments.reservationId, reservations.id),
          eq(reservationAssignments.organizationId, reservations.organizationId),
          ofDay,
        ),
      )
      .orderBy(asc(reservationAssignments.startsAt)),
    db
      .select({
        reservationId: reservationPurposes.reservationId,
        purposeId: reservationPurposes.purposeId,
        sortOrder: reservationPurposes.sortOrder,
      })
      .from(reservations)
      .crossJoin(reservationPurposes)
      .where(
        and(
          eq(reservationPurposes.reservationId, reservations.id),
          eq(reservationPurposes.organizationId, reservations.organizationId),
          ofDay,
        ),
      )
      .orderBy(asc(reservationPurposes.sortOrder)),
    // ご用件の短い名前は**別の 1 文**で読む。上の文へ `visit_purposes` を継ぐと、
    // 帯 1 本ごとにご用件の一覧を引き直すことになる（設定の表は小さいが、
    // 1 日 5,400 回の面で行数を掛け算しない）。この表は組織あたり数件〜数十件である。
    db
      .select({
        id: visitPurposes.id,
        nameShort: visitPurposes.nameShort,
        kind: purposeRequirements.kind,
        value: purposeRequirements.value,
      })
      .from(visitPurposes)
      .leftJoin(
        purposeRequirements,
        and(
          eq(purposeRequirements.organizationId, visitPurposes.organizationId),
          eq(purposeRequirements.purposeId, visitPurposes.id),
        ),
      )
      .where(eq(visitPurposes.organizationId, org)),
  ])

  const nameShortById = new Map(purposeNameRows.map((row) => [row.id, row.nameShort]))
  const ledgerRequirements = new Map<
    string,
    { skills: SkillCode[]; equipmentKinds: EquipmentKind[] }
  >()
  for (const row of purposeNameRows) {
    if (row.kind === null || row.value === null) continue
    const entry = ledgerRequirements.get(row.id) ?? { skills: [], equipmentKinds: [] }
    if (row.kind === 'skill') entry.skills.push(row.value as SkillCode)
    if (row.kind === 'equipment_kind') entry.equipmentKinds.push(row.value as EquipmentKind)
    ledgerRequirements.set(row.id, entry)
  }

  return {
    hours: hours.map(toWeeklyHours),
    exceptions: exceptions.map(toDayException),
    slotRules: toSlotRules(rules[0]),
    staff: staffRows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      jobLabel: row.jobLabel,
      sortOrder: row.sortOrder,
    })),
    shifts: shiftRows.map((row) => ({
      staffId: row.staffId,
      kind: row.kind === 'break' ? ('break' as const) : ('work' as const),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    })),
    equipment: equipmentRows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind as EquipmentKind,
      roleLabel: row.roleLabel,
      sortOrder: row.sortOrder,
      isActive: isOn(row.isActive),
      ledgerDisplay: row.ledgerDisplay === 'hide' ? ('hide' as const) : ('grey' as const),
    })),
    maintenance: maintenanceRows.map((row) => ({
      equipmentId: row.equipmentId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      note: row.note,
    })),
    reservations: reservationRows.map(toLedgerReservation),
    assignments: assignmentRows.map(toAssignment),
    // 消したご用件を指した行は帯に出せる名前が無い。行ごと落とす（JOIN と同じ結果）。
    purposes: purposeRows.flatMap((row) => {
      const nameShort = nameShortById.get(row.purposeId)
      return nameShort === undefined
        ? []
        : [
            {
              reservationId: row.reservationId,
              nameShort,
              sortOrder: row.sortOrder,
              requiredSkills: ledgerRequirements.get(row.purposeId)?.skills ?? [],
              requiredEquipmentKinds: ledgerRequirements.get(row.purposeId)?.equipmentKinds ?? [],
            },
          ]
    }),
  }
}

/* --- 空き枠 1 日分 -------------------------------------------------------- */

export type AvailabilityDayRows = {
  hours: WeeklyHours[]
  exceptions: DayException[]
  blackouts: BlackoutBand[]
  slotRules: SlotRules | null
  purposes: PurposeSpec[]
  /** 求められた目的のうち、この組織・店舗で受けられなかった数。1 つでもあれば枠を出さない。 */
  missingPurposes: number
  staff: StaffMember[]
  shifts: StaffShiftBand[]
  equipment: EquipmentUnit[]
  maintenances: MaintenanceBand[]
  occupied: OccupiedAssignment[]
}

/**
 * 空き枠 1 日分を **1 回の `db.batch()`（12 文）** で読む。
 * 塞がりは `reservation_assignments` の**区間の重なり**で引く（前日から続く押さえも拾う）。
 * ただし駆動は `reservations` 側に固定する（`RESERVATION_LOOKBACK_MS` の理由）。
 */
export async function readAvailabilityDay(
  db: Db,
  input: {
    organizationId: string
    storeId: string
    date: string
    purposeIds: readonly string[]
  },
): Promise<AvailabilityDayRows> {
  const { organizationId: org, storeId, date } = input
  const { fromIso, toIso } = jstDayRange(date)
  // 目的が 0 件のときも文の数を変えない（`IN ()` は書けないので当たらない id を渡す）。
  const purposeIds = input.purposeIds.length > 0 ? [...input.purposeIds] : ['']
  // その日に 1 分でも掛かるご予約。`starts_at` に下限を置いて index の範囲で引ける形にする。
  const overlapsDay = and(
    eq(reservations.organizationId, org),
    eq(reservations.storeId, storeId),
    notInArray(reservations.status, NOT_OCCUPYING),
    gte(
      reservations.startsAt,
      new Date(Date.parse(fromIso) - RESERVATION_LOOKBACK_MS).toISOString(),
    ),
    lt(reservations.startsAt, toIso),
    gt(reservations.endsAt, fromIso),
  )

  const [
    hours,
    exceptions,
    blackouts,
    rules,
    purposeRows,
    requirementRows,
    staffRows,
    skillRows,
    shiftRows,
    equipmentRows,
    maintenanceRows,
    occupiedRows,
  ] = await db.batch([
    db
      .select()
      .from(storeBusinessHours)
      .where(
        and(eq(storeBusinessHours.organizationId, org), eq(storeBusinessHours.storeId, storeId)),
      ),
    db
      .select()
      .from(storeCalendarExceptions)
      .where(
        and(
          eq(storeCalendarExceptions.organizationId, org),
          eq(storeCalendarExceptions.storeId, storeId),
          eq(storeCalendarExceptions.date, date),
        ),
      ),
    db
      .select()
      .from(storeBlackoutWindows)
      .where(
        and(
          eq(storeBlackoutWindows.organizationId, org),
          eq(storeBlackoutWindows.storeId, storeId),
        ),
      ),
    db
      .select()
      .from(storeSlotRules)
      .where(and(eq(storeSlotRules.organizationId, org), eq(storeSlotRules.storeId, storeId))),
    db
      .select()
      .from(visitPurposes)
      .where(
        and(
          eq(visitPurposes.organizationId, org),
          eq(visitPurposes.isActive, '1'),
          inArray(visitPurposes.id, purposeIds),
        ),
      ),
    db
      .select()
      .from(purposeRequirements)
      .where(
        and(
          eq(purposeRequirements.organizationId, org),
          inArray(purposeRequirements.purposeId, purposeIds),
        ),
      ),
    db
      .select()
      .from(staff)
      .where(and(eq(staff.organizationId, org), eq(staff.storeId, storeId)))
      .orderBy(asc(staff.sortOrder), asc(staff.createdAt)),
    db
      .select()
      .from(staffSkills)
      .where(and(eq(staffSkills.organizationId, org), eq(staffSkills.storeId, storeId))),
    db
      .select()
      .from(staffShifts)
      .where(
        and(
          eq(staffShifts.organizationId, org),
          eq(staffShifts.storeId, storeId),
          eq(staffShifts.date, date),
        ),
      ),
    db
      .select()
      .from(equipment)
      .where(and(eq(equipment.organizationId, org), eq(equipment.storeId, storeId)))
      .orderBy(asc(equipment.sortOrder), asc(equipment.createdAt)),
    db
      .select()
      .from(equipmentMaintenance)
      .where(
        and(
          eq(equipmentMaintenance.organizationId, org),
          eq(equipmentMaintenance.storeId, storeId),
          lt(equipmentMaintenance.startsAt, toIso),
          gt(equipmentMaintenance.endsAt, fromIso),
        ),
      ),
    db
      .select({
        reservationId: reservationAssignments.reservationId,
        kind: reservationAssignments.kind,
        targetId: reservationAssignments.targetId,
        startsAt: reservationAssignments.startsAt,
        endsAt: reservationAssignments.endsAt,
      })
      // 台帳と同じく `reservations` を外側の輪に固定する（`CROSS JOIN`）。
      .from(reservations)
      .crossJoin(reservationAssignments)
      .where(
        and(
          eq(reservationAssignments.reservationId, reservations.id),
          eq(reservationAssignments.organizationId, reservations.organizationId),
          overlapsDay,
          lt(reservationAssignments.startsAt, toIso),
          gt(reservationAssignments.endsAt, fromIso),
        ),
      ),
  ])

  const held = new Map<string, SkillCode[]>()
  for (const row of skillRows) {
    const list = held.get(row.staffId) ?? []
    list.push(row.skillCode as SkillCode)
    held.set(row.staffId, list)
  }
  const requirements = new Map<string, { skills: SkillCode[]; kinds: EquipmentKind[] }>()
  for (const row of requirementRows) {
    const entry = requirements.get(row.purposeId) ?? { skills: [], kinds: [] }
    if (row.kind === 'skill') entry.skills.push(row.value as SkillCode)
    else entry.kinds.push(row.value as EquipmentKind)
    requirements.set(row.purposeId, entry)
  }

  // チェーン共通（`store_id` が NULL）とこの店舗の目的だけを受ける。
  const usable = purposeRows.filter((row) => row.storeId === null || row.storeId === storeId)
  const found = new Set(usable.map((row) => row.id))

  return {
    hours: hours.map(toWeeklyHours),
    exceptions: exceptions.map(toDayException),
    blackouts: blackouts.map((row) => ({
      weekday: row.weekday,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    })),
    slotRules: toSlotRules(rules[0]),
    purposes: usable.map((row) => ({
      id: row.id,
      durationMinutes: row.durationMinutes,
      requiredSkills: requirements.get(row.id)?.skills ?? [],
      requiredEquipmentKinds: requirements.get(row.id)?.kinds ?? [],
    })),
    // **求めた id の重複を数に入れない。**同じご用件を 2 度渡しただけで
    // 「お受けできないご用件」になると、枠が 1 つも出ない理由が誰にも分からない。
    missingPurposes: new Set(input.purposeIds).size - found.size,
    staff: staffRows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      skills: held.get(row.id) ?? [],
      maxParallelReservations: row.maxParallelReservations,
      isActive: isOn(row.isActive),
      sortOrder: row.sortOrder,
      // 行名の下は**肩書きと技能**（BOOK-03 の「視力測定・加工」）。肩書きだけを写すと、
      // 肩書きを持たない担当の行が全部空になり、盤で「誰に何ができるか」が読めない。
      subtitle: staffSubline(row.jobLabel, held.get(row.id) ?? []),
    })),
    shifts: shiftRows.map((row) => ({
      staffId: row.staffId,
      date: row.date,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      kind: row.kind === 'break' ? ('break' as const) : ('work' as const),
    })),
    equipment: equipmentRows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind as EquipmentKind,
      capacity: row.capacity,
      isActive: isOn(row.isActive),
      sortOrder: row.sortOrder,
      roleLabel: row.roleLabel,
    })),
    maintenances: maintenanceRows.map((row) => ({
      equipmentId: row.equipmentId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    })),
    occupied: occupiedRows.map(toAssignment),
  }
}

/* --- ご予約 1 件 ---------------------------------------------------------- */

export type ReservationDetailRows = {
  reservation: typeof reservations.$inferSelect
  purposes: {
    purposeId: string
    nameInternal: string
    nameShort: string
    durationMinutes: number
    sortOrder: number
  }[]
  assignments: OccupiedAssignment[]
} | null

/**
 * ご予約 1 件を **1 回の `db.batch()`（3 文）** で読む。他テナントの id は null になる。
 *
 * **絞りは `organization_id` だけである。**`07-nfr.md` §6.1 は「店舗を持つ表は
 * 選択中の `store_id` でも絞る」と決めているが、この経路は URL に店舗を持たない
 * （`GET /api/staff/reservations/:reservationId`。`04-api.md` §3.6）。同じ組織の
 * 他店舗のご予約 id を直に叩けば 200 で返るので、**画面は応答の `storeId` を見て
 * 開くかどうかを決める**。店舗まで DB 側で絞るなら URL に店舗を足す API の変更が要る。
 */
export async function readReservationDetail(
  db: Db,
  input: { organizationId: string; reservationId: string },
): Promise<ReservationDetailRows> {
  const { organizationId: org, reservationId } = input
  const [found, purposeRows, assignmentRows] = await db.batch([
    db
      .select()
      .from(reservations)
      .where(and(eq(reservations.organizationId, org), eq(reservations.id, reservationId))),
    db
      .select({
        purposeId: reservationPurposes.purposeId,
        nameInternal: visitPurposes.nameInternal,
        nameShort: visitPurposes.nameShort,
        durationMinutes: reservationPurposes.durationMinutes,
        sortOrder: reservationPurposes.sortOrder,
      })
      .from(reservationPurposes)
      .innerJoin(
        visitPurposes,
        and(
          eq(visitPurposes.id, reservationPurposes.purposeId),
          eq(visitPurposes.organizationId, reservationPurposes.organizationId),
        ),
      )
      .where(
        and(
          eq(reservationPurposes.organizationId, org),
          eq(reservationPurposes.reservationId, reservationId),
        ),
      )
      .orderBy(asc(reservationPurposes.sortOrder)),
    db
      .select({
        reservationId: reservationAssignments.reservationId,
        kind: reservationAssignments.kind,
        targetId: reservationAssignments.targetId,
        startsAt: reservationAssignments.startsAt,
        endsAt: reservationAssignments.endsAt,
      })
      .from(reservationAssignments)
      .where(
        and(
          eq(reservationAssignments.organizationId, org),
          eq(reservationAssignments.reservationId, reservationId),
        ),
      )
      // 担当（`kind='staff'`）を先に、そのあとを押さえた時刻の順に並べる。
      // 同じ時刻の設備が 2 台あるときの並びは id で決める（実行のたびに揺らさない）。
      .orderBy(
        desc(reservationAssignments.kind),
        asc(reservationAssignments.startsAt),
        asc(reservationAssignments.id),
      ),
  ])

  const reservation = found[0]
  if (!reservation) return null
  return { reservation, purposes: purposeRows, assignments: assignmentRows.map(toAssignment) }
}

/* --- 行 → ドメインの形 ---------------------------------------------------- */

function toWeeklyHours(row: typeof storeBusinessHours.$inferSelect): WeeklyHours {
  return {
    weekday: row.weekday,
    isClosed: isOn(row.isClosed),
    opensAt: row.opensAt,
    closesAt: row.closesAt,
  }
}

function toDayException(row: typeof storeCalendarExceptions.$inferSelect): DayException {
  return {
    date: row.date,
    kind: row.kind === 'special' ? 'special' : 'closed',
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    note: row.note,
  }
}

function toSlotRules(row: typeof storeSlotRules.$inferSelect | undefined): SlotRules | null {
  // 行が無い店舗は「設定未完」。暗黙の既定値を作らない。
  return row === undefined
    ? null
    : {
        slotMinutes: row.slotMinutes,
        cleanupMinutes: row.cleanupMinutes,
        maxParallel: row.maxParallel,
      }
}

function toLedgerReservation(row: typeof reservations.$inferSelect): LedgerReservationRow {
  return {
    id: row.id,
    storeId: row.storeId,
    source: row.source as LedgerReservationRow['source'],
    status: row.status as LedgerReservationRow['status'],
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  }
}

function toAssignment(row: {
  reservationId: string
  kind: string
  targetId: string | null
  startsAt: string
  endsAt: string
}): OccupiedAssignment {
  return {
    reservationId: row.reservationId,
    kind: row.kind === 'equipment' ? 'equipment' : 'staff',
    targetId: row.targetId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  }
}
