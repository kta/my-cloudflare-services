/**
 * 空き枠エンジン。店の決まりをすべて掛けて「置ける時刻」を出す。
 *
 * ここに置くのは**純関数だけ**で、D1 も `Date.now()` も触らない。営業時間・受付を止める
 * 帯・勤務・技能・設備・点検・既存の押さえ・仮の押さえ・`now` は、ひとつ残らず引数で
 * 受け取る。閉店間際にお受けできるかどうかは店が一番静かに壊れるところなので、
 * 実行日と実行時刻に依存させない。`now` が効くのは応答の `serverNow` だけである。
 *
 * **8 条件をこの順に掛け、最初に落ちた条件を `AvailabilityReason` で必ず添える。**
 *
 * 1. 営業日か（`store_calendar_exceptions` → `store_business_hours` の順に解決）→ `closed`
 * 2. 営業時間の中か → `outside_hours` ／ 受付を止める帯の中でないか → `break`
 * 3. 刻み（`slot_minutes`）の格子に載っているか（格子の外は候補として作らない）
 * 4. 所要（＋片付け）が閉店までに収まるか → `outside_hours`
 * 5. 技能を持つ担当が勤務していて空いているか → `no_skill` / `staff_off` / `staff_busy`
 * 6. 要る種別の設備が点検中でなく空いているか → `maintenance` / `equipment_busy`
 * 7. 店舗の同時受付上限に達していないか → `max_parallel`
 * 8. Web 予約の公開条件（`web_window` / `lead_time`）は **P2 では掛けない**。公開面は P8。
 *
 * 決めのうち、文書に書いていないものは次のとおり（`docs/superpowers/plans` の判断記録と同じ）。
 * - **受付を止める帯は枠の開始時刻だけを塞ぐ。**ご予約の本体が帯をまたぐことは許す
 *   （BOOK-01 はお昼にまたがる 11:30 の 60 分を満席として出している）。
 * - **所要が収まるかは P1 の `lastAcceptableStart` を 1 日 1 回呼んで上限にする。**
 *   SETTINGS-HOURS の「最後にお受けできるのは 18:20 です」と押せる枠の式を 2 つ作らない。
 * - **同時受付上限は担当の割当行を全部数える**（担当が決まっている予約も含む。AC-LEDGER-17）。
 * - 占有の数え方は `reservation_slot_locks`（`03-data-model.md` §7.6）と同じ
 *   「刻みごとの行数」に揃える。確定時の上限判定と数え方を 1 つにするため、割当を枠へ
 *   展開する `expandToSlotStarts` をここに置いて共有する。
 *
 * 区間はすべて半開 `[開始, 終わり)`。12:00 に終わる帯は 12:00 を含まない。
 */
import type {
  AvailabilityReason,
  EquipmentKind,
  LocalDate,
  LocalTime,
  SkillCode,
} from '@app/contracts'
import { toJstDateString } from '@app/shared'
import {
  type BlackoutBand,
  type BusinessDay,
  type DayException,
  lastAcceptableStart,
  resolveBusinessDay,
  type WeeklyHours,
} from './store-settings'

/* --- 入力の形 ------------------------------------------------------------ */

/** 予約の刻み・片付け・同時受付上限（`store_slot_rules`。1 店舗 1 行）。 */
export type SlotRules = { slotMinutes: number; cleanupMinutes: number; maxParallel: number }

/** ご来店の目的 1 件（`visit_purposes` ＋ `purpose_requirements`）。 */
export type PurposeSpec = {
  id: string
  durationMinutes: number
  /** `kind='skill'` の値。1 目的 1 つまでだが、複数の目的を足すと積み上がる。 */
  requiredSkills?: readonly SkillCode[]
  /**
   * `kind='equipment_kind'` の値。
   *
   * **同じ種別を 2 つのご用件が求めても、押さえるのは 1 台にする。**1 予約の中の
   * ご用件は順に行うもので（所要は合算する。`03-data-model.md` §7.2）、相談カウンターを
   * 2 件のご用件で使うなら同じ 1 台を通しで押さえるのが正しい。2 台を同時に要求すると、
   * ご用件を足しただけで置ける枠が消える。
   */
  requiredEquipmentKinds?: readonly EquipmentKind[]
}

/** 接客する担当 1 名（`staff` ＋ `staff_skills`）。 */
export type StaffMember = {
  id: string
  displayName: string
  skills: readonly SkillCode[]
  maxParallelReservations: number
  /** 省略は有効。`is_active='0'` の担当は新規の担当候補に出さない。 */
  isActive?: boolean
  sortOrder?: number
  /** 台帳の行名の下に出す小さい文字（「視力測定・加工」）。技能の語はここで作らない。 */
  subtitle?: string
}

/** 日ごとの勤務帯・休憩帯（`staff_shifts`）。時刻は `HH:MM`（JST の壁時計）。 */
export type StaffShiftBand = {
  staffId: string
  date: LocalDate
  startsAt: string
  endsAt: string
  kind: 'work' | 'break'
}

/** 設備・場所 1 台（`equipment`）。 */
export type EquipmentUnit = {
  id: string
  name: string
  kind: EquipmentKind
  capacity: number
  /** 省略は有効。`is_active='0'` を要求する目的は枠を 1 件も返さない。 */
  isActive?: boolean
  sortOrder?: number
  /** LEDGER-RESOURCE の行名の下に出る小さい文字（「視力測定」）。 */
  roleLabel?: string | null
}

/** 設備の点検予定（`equipment_maintenance`）。時刻は ISO8601（UTC）。 */
export type MaintenanceBand = { equipmentId: string; startsAt: string; endsAt: string }

/** 確定済みの押さえ 1 行（`reservation_assignments`）。`targetId` の NULL は「あとで決める」。 */
export type OccupiedAssignment = {
  reservationId: string
  kind: 'staff' | 'equipment'
  targetId: string | null
  startsAt: string
  endsAt: string
}

/** 仮の押さえ 1 件（KV `hold:{org}:{store}:{holdId}` の metadata と同じ形）。 */
export type HoldOccupancy = {
  holdId: string
  receptionSessionId: string | null
  kind: 'staff' | 'equipment'
  targetId: string | null
  startsAt: string
  endsAt: string
}

/** 空き枠を出すのに要るものすべて。DB も実時刻もここから先へは持ち込まない。 */
export type AvailabilityInput = {
  /** JST の暦日。 */
  date: LocalDate
  /** 応答の `serverNow` になる。**枠の判定には使わない。** */
  now: Date
  /** 行が無い店舗（設定未完）は枠を 0 件にする。暗黙の既定値を作らない。 */
  slotRules: SlotRules | null
  weeklyHours: readonly WeeklyHours[]
  exceptions?: readonly DayException[]
  blackouts?: readonly BlackoutBand[]
  /** 店舗まるごとの受付を止めているか（`stores.is_active='0'`）。止めた日は閉じる。 */
  isSuspended?: boolean
  purposes?: readonly PurposeSpec[]
  /** 省略時は目的の合計。目的も無ければ刻みを所要とみなす。 */
  durationMinutes?: number
  staff?: readonly StaffMember[]
  shifts?: readonly StaffShiftBand[]
  equipment?: readonly EquipmentUnit[]
  maintenances?: readonly MaintenanceBand[]
  occupied?: readonly OccupiedAssignment[]
  holds?: readonly HoldOccupancy[]
  axis?: 'staff' | 'resource'
  /** 担当を 1 名に絞る。技能を持たない担当を渡すと枠は 0 件になる。 */
  staffId?: string | null
  /** 設備を絞る。 */
  equipmentIds?: readonly string[]
  /** 変更のとき、自分自身を塞がりに数えない。 */
  excludeReservationId?: string | null
  /** 自分の受付が置いた仮の押さえを塞がりに数えない。 */
  excludeReceptionSessionId?: string | null
  /** 代わりの時刻（`alternatives`）を選ぶときの基準。省略時は最初の置ける枠。 */
  preferredStartsAt?: string | null
}

/* --- 出力の形 ------------------------------------------------------------ */

/** 枠 1 つ。`remaining` は「あと N枠」で、0 は「満席」と描く。 */
export type SlotResult = {
  startsAt: string
  endsAt: string
  isAvailable: boolean
  remaining: number
  reason: AvailabilityReason | null
  staffIds: string[]
  equipmentIds: string[]
}

/** 担当軸・設備軸の 1 行。担当が未定のレーンは `id` を持たない。 */
export type LaneResult = {
  kind: 'staff' | 'equipment' | 'unassigned'
  id: string | null
  name: string
  subtitle: string
  slots: SlotResult[]
}

/**
 * 空き枠の答え。定休日は `slots` を空にして `reason='closed'` を返す（409 にしない）。
 * `slotRules` が null で返るのは「設定未完」で、ルートは設定画面へ誘導する。
 */
export type AvailabilityResult = {
  date: LocalDate
  isClosed: boolean
  slotRules: SlotRules | null
  opensAt: LocalTime | null
  closesAt: LocalTime | null
  durationMinutes: number
  slots: SlotResult[]
  lanes: LaneResult[]
  alternatives: SlotResult[]
  /** その日ぜんぶが同じ理由で落ちているときだけ、その理由を添える。 */
  reason: AvailabilityReason | null
  serverNow: string
}

/* --- 時刻の道具 ---------------------------------------------------------- */

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000
const JST_OFFSET_MS = 9 * 60 * MS_PER_MINUTE
/** 代わりの時刻は 3 件までに閉じる（4 つ目を出しても画面に置き場が無い）。 */
const ALTERNATIVES_MAX = 3
/** 担当が未定のレーンの鍵。NULL を使わない（`reservation_slot_locks.target_key` と同じ決め）。 */
const UNASSIGNED = 'unassigned'

/** `HH:MM` → 0 時からの分。 */
function toMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

/** JST の暦日の 0:00 を UTC のミリ秒で。 */
function jstMidnightMs(date: LocalDate): number {
  return Date.parse(`${date}T00:00:00.000Z`) - JST_OFFSET_MS
}

/**
 * JST の暦日 1 日ぶんの UTC の窓 `[fromIso, toIso)`。
 * 1 日は UTC 15:00 に始まって翌 UTC 15:00 に終わる。自前で +9 時間しない。
 */
export function jstDayRange(date: LocalDate): { fromIso: string; toIso: string } {
  const from = jstMidnightMs(date)
  return {
    fromIso: new Date(from).toISOString(),
    toIso: new Date(from + MS_PER_DAY).toISOString(),
  }
}

/** 区間 `[startsAt, endsAt)` が JST のその暦日に 1 分でも掛かるか。 */
export function overlapsJstDay(startsAt: string, endsAt: string, date: LocalDate): boolean {
  const from = jstMidnightMs(date)
  return Date.parse(startsAt) < from + MS_PER_DAY && Date.parse(endsAt) > from
}

/**
 * 押さえ 1 行を刻みの格子へ展開する。`reservation_slot_locks` に入る行の
 * `slot_start` と同じ並びを返す（確定時の上限判定と数え方を 1 つにするため）。
 *
 * **片付けは予約の後ろにだけ付く。**`endsAt` には含めず、ここで足して後ろへ伸ばす。
 * 格子は JST の 0:00 を原点にする。
 */
export function expandToSlotStarts(input: {
  startsAt: string
  endsAt: string
  cleanupMinutes: number
  slotMinutes: number
}): string[] {
  const step = input.slotMinutes * MS_PER_MINUTE
  if (step <= 0) return []
  const startMs = Date.parse(input.startsAt)
  const endMs = Date.parse(input.endsAt) + input.cleanupMinutes * MS_PER_MINUTE
  if (!(endMs > startMs)) return []
  const anchor = jstMidnightMs(toJstDateString(input.startsAt))
  const first = anchor + Math.floor((startMs - anchor) / step) * step
  const starts: string[] = []
  for (let ms = first; ms < endMs; ms += step) starts.push(new Date(ms).toISOString())
  return starts
}

/* --- 盤面を組み立てる ---------------------------------------------------- */

/** 枠ごとの占有。鍵は `staff:<id|unassigned>` / `equipment:<id|unassigned>`。 */
type Occupancy = {
  byLane: Map<string, Map<string, number>>
  /** その枠を使っているご予約の件数（担当の行は 1 予約 1 行なので、これが件数になる）。 */
  totals: Map<string, number>
}

type Prepared = {
  date: LocalDate
  day: BusinessDay
  bands: readonly BlackoutBand[]
  rules: SlotRules
  durationMinutes: number
  skilled: StaffMember[]
  shifts: readonly StaffShiftBand[]
  equipment: EquipmentUnit[]
  requiredKinds: EquipmentKind[]
  maintenances: readonly MaintenanceBand[]
  lastStartMinutes: number | null
  occupancy: Occupancy
}

/** レーン 1 本の指定。空き枠を「この担当で」「この設備で」と絞って解く。 */
type LaneTarget =
  | { kind: 'staff'; id: string }
  | { kind: 'equipment'; id: string }
  | { kind: 'unassigned' }

function laneKey(kind: 'staff' | 'equipment', targetId: string | null): string {
  return `${kind}:${targetId ?? UNASSIGNED}`
}

/** 有効かどうか。列を省いた入力は有効として読む（`is_active` の既定は `'1'`）。 */
function isActive(row: { isActive?: boolean }): boolean {
  return row.isActive !== false
}

function bySortOrder(a: { sortOrder?: number }, b: { sortOrder?: number }): number {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
}

function buildOccupancy(input: AvailabilityInput, rules: SlotRules): Occupancy {
  const byLane = new Map<string, Map<string, number>>()
  const totals = new Map<string, number>()

  const add = (
    kind: 'staff' | 'equipment',
    targetId: string | null,
    startsAt: string,
    endsAt: string,
  ): void => {
    // その日に掛からない行は数えない（呼び出し側の窓が広くても暦日を汚さない）。
    if (!overlapsJstDay(startsAt, endsAt, input.date)) return
    const key = laneKey(kind, targetId)
    for (const slot of expandToSlotStarts({
      startsAt,
      endsAt,
      cleanupMinutes: rules.cleanupMinutes,
      slotMinutes: rules.slotMinutes,
    })) {
      const lanes = byLane.get(slot) ?? new Map<string, number>()
      byLane.set(slot, lanes)
      lanes.set(key, (lanes.get(key) ?? 0) + 1)
      if (kind === 'staff') totals.set(slot, (totals.get(slot) ?? 0) + 1)
    }
  }

  for (const row of input.occupied ?? []) {
    if (input.excludeReservationId && row.reservationId === input.excludeReservationId) continue
    add(row.kind, row.targetId, row.startsAt, row.endsAt)
  }
  for (const hold of input.holds ?? []) {
    // 自分の受付が置いた押さえに自分が当たると、置き直しのたびに 7 分ずつ枠が死ぬ。
    if (
      input.excludeReceptionSessionId &&
      hold.receptionSessionId === input.excludeReceptionSessionId
    ) {
      continue
    }
    add(hold.kind, hold.targetId, hold.startsAt, hold.endsAt)
  }
  return { byLane, totals }
}

function prepare(input: AvailabilityInput, rules: SlotRules): Prepared {
  const day = resolveBusinessDay({
    date: input.date,
    weeklyRows: input.weeklyHours,
    exceptions: input.exceptions,
    blackouts: input.blackouts,
    isSuspended: input.isSuspended,
  })
  const purposes = input.purposes ?? []
  const durationMinutes =
    input.durationMinutes ??
    (purposes.length > 0
      ? purposes.reduce((sum, purpose) => sum + purpose.durationMinutes, 0)
      : rules.slotMinutes)

  const requiredSkills = new Set<SkillCode>()
  // 種別は重複を畳む（`PurposeSpec.requiredEquipmentKinds` の決め）。同じ種別を 2 つの
  // ご用件が求めても押さえるのは 1 台で、その 1 台をご予約まるごとの区間で押さえる。
  const requiredKinds: EquipmentKind[] = []
  for (const purpose of purposes) {
    for (const skill of purpose.requiredSkills ?? []) requiredSkills.add(skill)
    for (const kind of purpose.requiredEquipmentKinds ?? []) {
      if (!requiredKinds.includes(kind)) requiredKinds.push(kind)
    }
  }

  const skilled = (input.staff ?? [])
    .filter(isActive)
    .filter((member) => !input.staffId || member.id === input.staffId)
    .filter((member) => [...requiredSkills].every((skill) => member.skills.includes(skill)))
    .sort(bySortOrder)

  const equipment = (input.equipment ?? [])
    .filter(isActive)
    .filter((unit) => !input.equipmentIds || input.equipmentIds.includes(unit.id))
    .sort(bySortOrder)

  const last = lastAcceptableStart({
    windows: day.windows,
    shortestDurationMinutes: durationMinutes,
    cleanupMinutes: rules.cleanupMinutes,
    closesAt: day.closesAt,
  })

  return {
    date: input.date,
    day,
    bands: (input.blackouts ?? []).filter((band) => band.weekday === day.weekday),
    rules,
    durationMinutes,
    skilled,
    shifts: input.shifts ?? [],
    equipment,
    requiredKinds,
    maintenances: input.maintenances ?? [],
    lastStartMinutes: last === null ? null : toMinutes(last),
    occupancy: buildOccupancy(input, rules),
  }
}

/* --- 1 枠を判定する ------------------------------------------------------ */

/** 担当がその区間ぜんぶを勤務していて、休憩に掛かっていないか。 */
function isOnShift(p: Prepared, member: StaffMember, fromMinutes: number, toM: number): boolean {
  const rows = p.shifts.filter((row) => row.staffId === member.id && row.date === p.date)
  const working = rows.some(
    (row) =>
      row.kind === 'work' && toMinutes(row.startsAt) <= fromMinutes && toMinutes(row.endsAt) >= toM,
  )
  if (!working) return false
  return !rows.some(
    (row) =>
      row.kind === 'break' && toMinutes(row.startsAt) < toM && toMinutes(row.endsAt) > fromMinutes,
  )
}

/** その日に 1 本でも勤務帯があるか（レーンを出すかどうかの判定）。 */
function hasWorkShift(p: Prepared, member: StaffMember): boolean {
  return p.shifts.some(
    (row) => row.staffId === member.id && row.date === p.date && row.kind === 'work',
  )
}

function countAt(p: Prepared, slot: string, key: string): number {
  return p.occupancy.byLane.get(slot)?.get(key) ?? 0
}

function underMaintenance(p: Prepared, unitId: string, fromMs: number, toMs: number): boolean {
  return p.maintenances.some(
    (band) =>
      band.equipmentId === unitId &&
      Date.parse(band.startsAt) < toMs &&
      Date.parse(band.endsAt) > fromMs,
  )
}

/**
 * 1 枠を 8 条件に掛ける。`lane` を渡すとその担当・設備に絞って解く
 * （台帳軸のレーンは同じ判定を対象を固定して呼ぶ。式を 2 つ作らない）。
 */
function judge(p: Prepared, startMs: number, lane?: LaneTarget): SlotResult {
  const endMs = startMs + p.durationMinutes * MS_PER_MINUTE
  const startsAt = new Date(startMs).toISOString()
  const endsAt = new Date(endMs).toISOString()
  const covered = expandToSlotStarts({
    startsAt,
    endsAt,
    cleanupMinutes: p.rules.cleanupMinutes,
    slotMinutes: p.rules.slotMinutes,
  })
  // 「あと N枠」は**このご予約が使う枠すべて**の残りのうち、一番小さい数にする。
  // 数えるのは店舗の同時受付上限だけで、担当の空き・設備の空きは引かない（⑤ と ⑥ が
  // 別に判定して `isAvailable` を落とす。数え方を 2 か所に散らさないため）。
  // 先頭の枠だけを見ると、13:30 が満席の日に 13:00 の 60 分を「あと 3枠」と描きながら
  // 置けない枠として返すことになり、札の数字と押せるかどうかが食い違う。
  const remaining = covered.reduce(
    (least, slot) =>
      Math.min(least, Math.max(0, p.rules.maxParallel - (p.occupancy.totals.get(slot) ?? 0))),
    p.rules.maxParallel,
  )
  // 置けない枠の残りは 0 にする。理由が何であれ、その時刻にこのご予約は入らない
  // （画面は `remaining === 0` を「満席」と描く。空きが残っていると読ませない）。
  const reject = (reason: AvailabilityReason): SlotResult => ({
    startsAt,
    endsAt,
    isAvailable: false,
    remaining: 0,
    reason,
    staffIds: [],
    equipmentIds: [],
  })

  // ① 営業日か。
  if (p.day.isClosed || p.day.opensAt === null || p.day.closesAt === null) return reject('closed')

  const startMinutes = Math.floor((startMs - jstMidnightMs(p.date)) / MS_PER_MINUTE)

  // ② 営業時間の中か。
  if (startMinutes < toMinutes(p.day.opensAt) || startMinutes >= toMinutes(p.day.closesAt)) {
    return reject('outside_hours')
  }
  // ② 受付を止める帯の中でないか。帯は**開始時刻だけ**を塞ぐ（本体は帯をまたいでよい）。
  if (
    p.bands.some(
      (band) => startMinutes >= toMinutes(band.startsAt) && startMinutes < toMinutes(band.endsAt),
    )
  ) {
    return reject('break')
  }
  // ④ 所要（＋片付け）が閉店までに収まるか。式は P1 の `lastAcceptableStart` に揃える。
  if (p.lastStartMinutes === null || startMinutes > p.lastStartMinutes) {
    return reject('outside_hours')
  }

  // ⑤ 技能を持つ担当が勤務していて空いているか。
  //
  // **担当が未定のご予約は、ここでは数えない。**未定の押さえ（`staff:unassigned`）が
  // 消費するのは店舗の同時受付上限（⑦）で、担当ひとりの空きではない
  // （`02-domain-model.md` I-05「`target_id IS NULL` の割り当ても `store_slot_rules.max_parallel`
  // に数える」）。この決めのぶんだけ、技能持ちの延べ枠が未定のご予約で先に尽きる日には
  // 「接客できる人が居ない時刻」を置ける枠として返しうる。どちらの数え方を正にするかは
  // I-05 と AC-LEDGER-17 に跨る決めなので、変えるときは spec を先に直す。
  // いまの決めは `担当が未定のご予約は ⑤ ではなく ⑦ で数える` のテストで固定してある。
  if (p.skilled.length === 0) return reject('no_skill')
  const candidates = lane?.kind === 'staff' ? p.skilled.filter((s) => s.id === lane.id) : p.skilled
  if (candidates.length === 0) return reject('no_skill')
  const onShift = candidates.filter((member) =>
    isOnShift(p, member, startMinutes, startMinutes + p.durationMinutes),
  )
  if (onShift.length === 0) return reject('staff_off')
  const freeStaff = onShift.filter(
    (member) =>
      !covered.some(
        (slot) => countAt(p, slot, laneKey('staff', member.id)) >= member.maxParallelReservations,
      ),
  )
  if (freeStaff.length === 0) return reject('staff_busy')

  // ⑥ 要る種別の設備が点検中でなく空いているか。
  const equipmentIds: string[] = []
  const kinds = [...p.requiredKinds]
  if (lane?.kind === 'equipment') {
    const unit = p.equipment.find((candidate) => candidate.id === lane.id)
    // 止めた設備・絞り込みで外れた設備の行は「埋まっている」ではなく「使える台が無い」。
    if (!unit) return reject('no_equipment')
    if (underMaintenance(p, unit.id, startMs, endMs)) return reject('maintenance')
    if (covered.some((slot) => countAt(p, slot, laneKey('equipment', unit.id)) >= unit.capacity)) {
      return reject('equipment_busy')
    }
    equipmentIds.push(unit.id)
    const index = kinds.indexOf(unit.kind)
    if (index >= 0) kinds.splice(index, 1)
  }
  for (const kind of kinds) {
    const pool = p.equipment.filter((unit) => unit.kind === kind)
    // その種別の台が 1 台も無い（未登録・全台停止・絞り込みで全部外れた）ときは
    // 「すべて埋まっています」ではない。時間をずらしても取れないので語を分ける。
    if (pool.length === 0) return reject('no_equipment')
    const usable = pool.filter((unit) => !underMaintenance(p, unit.id, startMs, endMs))
    const free = usable.filter(
      (unit) =>
        !covered.some((slot) => countAt(p, slot, laneKey('equipment', unit.id)) >= unit.capacity),
    )
    const chosen = free[0]
    if (!chosen) {
      // 点検で使えない台が 1 つでもあれば、点検を名指しする（BOOK-02b の文言のため）。
      return reject(usable.length < pool.length ? 'maintenance' : 'equipment_busy')
    }
    equipmentIds.push(chosen.id)
  }

  // ⑦ 店舗の同時受付上限。担当が未定のご予約も数に入る。
  if (covered.some((slot) => (p.occupancy.totals.get(slot) ?? 0) >= p.rules.maxParallel)) {
    return reject('max_parallel')
  }

  return {
    startsAt,
    endsAt,
    isAvailable: true,
    remaining,
    reason: null,
    staffIds: freeStaff.map((member) => member.id),
    equipmentIds,
  }
}

/* --- 外へ出す 2 本 ------------------------------------------------------- */

/**
 * ひとつの開始時刻を 8 条件に掛ける。格子の外の時刻でも判定するので、
 * 「この時刻は置けるか」を確定の直前に確かめる経路（P3）もここを呼ぶ。
 * `store_slot_rules` が無い店舗は、置けないことだけを返す（既定値を作らない）。
 */
export function evaluateSlot(input: AvailabilityInput, startsAt: string): SlotResult {
  if (!input.slotRules) {
    // 刻みが無い店舗でも `endsAt` は所要ぶん後ろにする。開始と同じ値を返すと
    // `AvailabilitySlot` の `startsBeforeEnds` に落ちて、この値を契約へ通せない。
    const minutes =
      input.durationMinutes ??
      (input.purposes ?? []).reduce((sum, purpose) => sum + purpose.durationMinutes, 0)
    return {
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + Math.max(minutes, 1) * MS_PER_MINUTE).toISOString(),
      isAvailable: false,
      remaining: 0,
      reason: null,
      staffIds: [],
      equipmentIds: [],
    }
  }
  return judge(prepare(input, input.slotRules), Date.parse(startsAt))
}

/** その日の格子を 1 本ずつ判定して並べる。 */
function gridOf(p: Prepared): number[] {
  if (p.day.opensAt === null || p.day.closesAt === null) return []
  const anchor = jstMidnightMs(p.date)
  const step = p.rules.slotMinutes * MS_PER_MINUTE
  const opensMs = anchor + toMinutes(p.day.opensAt) * MS_PER_MINUTE
  const closesMs = anchor + toMinutes(p.day.closesAt) * MS_PER_MINUTE
  const starts: number[] = []
  for (let ms = anchor + Math.ceil((opensMs - anchor) / step) * step; ms < closesMs; ms += step) {
    starts.push(ms)
  }
  return starts
}

function buildLanes(
  p: Prepared,
  grid: readonly number[],
  axis: 'staff' | 'resource',
): LaneResult[] {
  if (axis === 'resource') {
    const units =
      p.requiredKinds.length === 0
        ? p.equipment
        : p.equipment.filter((unit) => p.requiredKinds.includes(unit.kind))
    return units.map((unit) => ({
      kind: 'equipment' as const,
      id: unit.id,
      name: unit.name,
      subtitle: unit.roleLabel ?? '',
      slots: grid.map((ms) => judge(p, ms, { kind: 'equipment', id: unit.id })),
    }))
  }
  // その日に勤務が 1 本も無い担当の行は、置ける枠を 1 つも持たないので出さない。
  const lanes: LaneResult[] = p.skilled
    .filter((member) => hasWorkShift(p, member))
    .map((member) => ({
      kind: 'staff' as const,
      id: member.id,
      name: member.displayName,
      subtitle: member.subtitle ?? '',
      slots: grid.map((ms) => judge(p, ms, { kind: 'staff', id: member.id })),
    }))
  lanes.push({
    kind: 'unassigned',
    id: null,
    name: '担当が未定',
    subtitle: '',
    slots: grid.map((ms) => judge(p, ms, { kind: 'unassigned' })),
  })
  return lanes
}

/** 代わりの時刻。基準に近い順に 3 件まで。基準が無ければ最初の置ける枠に寄せる。 */
function pickAlternatives(slots: readonly SlotResult[], preferred: string | null): SlotResult[] {
  const available = slots.filter((slot) => slot.isAvailable)
  const first = available[0]
  if (!first) return []
  const pivot = Date.parse(preferred ?? first.startsAt)
  return [...available]
    .sort((a, b) => {
      const byDistance =
        Math.abs(Date.parse(a.startsAt) - pivot) - Math.abs(Date.parse(b.startsAt) - pivot)
      return byDistance !== 0 ? byDistance : Date.parse(a.startsAt) - Date.parse(b.startsAt)
    })
    .slice(0, ALTERNATIVES_MAX)
}

/**
 * その日の空き枠をまとめて出す。`GET /api/staff/availability` の中身。
 * 定休日は `slots` を空にして `reason='closed'` を返す（409 にしない）。
 */
export function computeAvailability(input: AvailabilityInput): AvailabilityResult {
  const serverNow = input.now.toISOString()
  const rules = input.slotRules
  if (!rules) {
    // 設定未完。暗黙の既定値を作らず、枠を 0 件にして設定画面へ誘導する。
    return {
      date: input.date,
      isClosed: false,
      slotRules: null,
      opensAt: null,
      closesAt: null,
      durationMinutes: input.durationMinutes ?? 0,
      slots: [],
      lanes: [],
      alternatives: [],
      reason: null,
      serverNow,
    }
  }

  const p = prepare(input, rules)
  const base = {
    date: input.date,
    slotRules: rules,
    opensAt: p.day.opensAt,
    closesAt: p.day.closesAt,
    durationMinutes: p.durationMinutes,
    serverNow,
  }
  if (p.day.isClosed) {
    return {
      ...base,
      isClosed: true,
      slots: [],
      lanes: [],
      alternatives: [],
      reason: 'closed',
    }
  }

  const grid = gridOf(p)
  const slots = grid.map((ms) => judge(p, ms))
  const first = slots[0]
  // その日ぜんぶが同じ理由で落ちているときだけ、まとめの理由を添える。
  const shared =
    first && slots.every((slot) => !slot.isAvailable && slot.reason === first.reason)
      ? first.reason
      : null
  return {
    ...base,
    isClosed: false,
    slots,
    lanes: buildLanes(p, grid, input.axis ?? 'staff'),
    alternatives: pickAlternatives(slots, input.preferredStartsAt ?? null),
    reason: shared,
  }
}
