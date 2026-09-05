/**
 * 空き枠エンジン（`src/worker/domain/availability.ts`）の 8 条件と境界を固定する。
 *
 * この面の関数は D1 も実時刻も触らない。営業時間・受付を止める帯・勤務・技能・設備・
 * 点検・既存の押さえ・仮の押さえ・`now` を**すべて引数で組み立てる**。`Date.now()` を
 * 1 度も呼ばないのは、閉店間際にお受けできるかどうかという一番静かに壊れる判定を、
 * テストを回した日と時刻に依存させないためである。
 *
 * 盤面は銀座店（`design/03-data-model.md` §4.2 / §4.5 / §5 / §6 の seed）。
 * 月・水・木・土 10:00–19:00 ／ 火 定休 ／ 金 11:00–20:00 ／ 日 10:00–18:00。
 * 基準日は 2026-08-27（木）で、これは承認済みモックが描いている日である。
 *
 * T-003（8 条件を表で縛る）19 本と T-004（境界値）17 本をこの 1 ファイルに置く。
 */
import { AvailabilityReason, type EquipmentKind, type SkillCode } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  type AvailabilityInput,
  computeAvailability,
  type EquipmentUnit,
  evaluateSlot,
  expandToSlotStarts,
  type HoldOccupancy,
  jstDayRange,
  type LaneResult,
  type MaintenanceBand,
  type OccupiedAssignment,
  overlapsJstDay,
  type PurposeSpec,
  type SlotResult,
  type SlotRules,
  type StaffMember,
  type StaffShiftBand,
} from '../src/worker/domain/availability'
import type { BlackoutBand, WeeklyHours } from '../src/worker/domain/store-settings'

/* --- 盤面 ---------------------------------------------------------------- */

const THURSDAY = '2026-08-27'
/** JST 11:08。モックの statusbar と同じ時刻。応答の `serverNow` にだけ効く。 */
const NOW = new Date('2026-08-27T02:08:00.000Z')

/** JST の壁時計を UTC の ISO へ。盤面はすべて JST で読む。 */
function jst(date: string, time: string): string {
  return new Date(Date.parse(`${date}T${time}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()
}

/** 銀座店の曜日 7 行。0=日 … 6=土。 */
const GINZA_WEEK: WeeklyHours[] = [
  { weekday: 0, isClosed: false, opensAt: '10:00', closesAt: '18:00' },
  { weekday: 1, isClosed: false, opensAt: '10:00', closesAt: '19:00' },
  { weekday: 2, isClosed: true, opensAt: null, closesAt: null },
  { weekday: 3, isClosed: false, opensAt: '10:00', closesAt: '19:00' },
  { weekday: 4, isClosed: false, opensAt: '10:00', closesAt: '19:00' },
  { weekday: 5, isClosed: false, opensAt: '11:00', closesAt: '20:00' },
  { weekday: 6, isClosed: false, opensAt: '10:00', closesAt: '19:00' },
]

/** 7 曜日とも 10:00–19:00。曜日の当たり外れを消したい日付の試験に使う。 */
const OPEN_EVERY_DAY: WeeklyHours[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  isClosed: false,
  opensAt: '10:00',
  closesAt: '19:00',
}))

/** 木曜の受付を止める帯 3 本（朝の支度・お昼・閉店前の片付け）。 */
const THURSDAY_BANDS: BlackoutBand[] = [
  { weekday: 4, startsAt: '10:00', endsAt: '10:15' },
  { weekday: 4, startsAt: '12:00', endsAt: '13:00' },
  { weekday: 4, startsAt: '18:40', endsAt: '19:00' },
]

/** お昼の帯だけ。ほかの条件を混ぜずに帯そのものを見る。 */
const LUNCH_ONLY: BlackoutBand[] = [{ weekday: 4, startsAt: '12:00', endsAt: '13:00' }]

const SLOT_RULES: SlotRules = { slotMinutes: 30, cleanupMinutes: 10, maxParallel: 3 }

/** 銀座店の担当 3 名（`03-data-model.md` §5.1 / LEDGER-STAFF の行順）。 */
const MISAKI: StaffMember = {
  id: 'staff-misaki',
  displayName: '佐藤 美咲',
  skills: ['measure', 'sales_reception'],
  maxParallelReservations: 1,
  sortOrder: 0,
}
const KEN: StaffMember = {
  id: 'staff-ken',
  displayName: '高橋 健',
  skills: ['measure', 'fitting'],
  maxParallelReservations: 1,
  sortOrder: 1,
}
const AYA: StaffMember = {
  id: 'staff-aya',
  displayName: '中村 彩',
  skills: ['sales_reception'],
  maxParallelReservations: 1,
  sortOrder: 2,
}

/** 木曜は 3 名とも 10:00–19:00。佐藤 美咲だけ 13:00–14:00 が休憩（LEDGER-STAFF の灰帯）。 */
const THURSDAY_SHIFTS: StaffShiftBand[] = [
  { staffId: MISAKI.id, date: THURSDAY, startsAt: '10:00', endsAt: '19:00', kind: 'work' },
  { staffId: MISAKI.id, date: THURSDAY, startsAt: '13:00', endsAt: '14:00', kind: 'break' },
  { staffId: KEN.id, date: THURSDAY, startsAt: '10:00', endsAt: '19:00', kind: 'work' },
  { staffId: AYA.id, date: THURSDAY, startsAt: '10:00', endsAt: '19:00', kind: 'work' },
]

/** 銀座店の設備 7 台（`03-data-model.md` §5.4 の表そのまま）。 */
const EQUIPMENT: EquipmentUnit[] = [
  { id: 'eq-measure-a', name: '視力測定機 A', kind: 'measure', capacity: 1, sortOrder: 0 },
  { id: 'eq-measure-b', name: '視力測定機 B', kind: 'measure', capacity: 1, sortOrder: 1 },
  { id: 'eq-exam-1', name: '検査室 1', kind: 'measure', capacity: 1, sortOrder: 2 },
  { id: 'eq-counter-1', name: '相談カウンター 1', kind: 'counter', capacity: 1, sortOrder: 3 },
  { id: 'eq-counter-2', name: '相談カウンター 2', kind: 'counter', capacity: 1, sortOrder: 4 },
  { id: 'eq-fitting', name: 'フィッティング台', kind: 'counter', capacity: 1, sortOrder: 5 },
  { id: 'eq-workbench', name: '加工室', kind: 'workbench', capacity: 1, sortOrder: 6 },
]

/** 視力測定機 B の点検（SETTINGS-EQUIPMENT「8月28日（金）10:00–12:00」と同じ形）。 */
const MEASURE_B_MAINTENANCE: MaintenanceBand[] = [
  {
    equipmentId: 'eq-measure-b',
    startsAt: '2026-08-27T02:30:00.000Z',
    endsAt: '2026-08-27T03:00:00.000Z',
  },
]

/** 「メガネを新しく作る」60分（技能: 視力測定 ／ 設備: 視力測定機・相談カウンター）。 */
const NEW_GLASSES: PurposeSpec = {
  id: 'purpose-new',
  durationMinutes: 60,
  requiredSkills: ['measure'],
  requiredEquipmentKinds: ['measure', 'counter'],
}

/** 技能も設備も要らない 30分のご用件。担当と枠の条件だけを見たいときに使う。 */
const PLAIN_30: PurposeSpec = { id: 'purpose-plain', durationMinutes: 30 }

/** 銀座店の木曜 1 日ぶん。上書きしたいところだけ差し替えて使う。 */
function board(patch: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    date: THURSDAY,
    now: NOW,
    slotRules: SLOT_RULES,
    weeklyHours: GINZA_WEEK,
    blackouts: THURSDAY_BANDS,
    purposes: [NEW_GLASSES],
    staff: [MISAKI, KEN, AYA],
    shifts: THURSDAY_SHIFTS,
    equipment: EQUIPMENT,
    ...patch,
  }
}

/** 1 予約ぶんの担当の押さえ（`reservation_assignments` の `kind='staff'` 1 行）。 */
function staffHold(
  reservationId: string,
  targetId: string | null,
  from: string,
  to: string,
): OccupiedAssignment {
  return {
    reservationId,
    kind: 'staff',
    targetId,
    startsAt: jst(THURSDAY, from),
    endsAt: jst(THURSDAY, to),
  }
}

/** 1 予約ぶんの設備の押さえ。 */
function equipmentHold(
  reservationId: string,
  targetId: string,
  from: string,
  to: string,
): OccupiedAssignment {
  return {
    reservationId,
    kind: 'equipment',
    targetId,
    startsAt: jst(THURSDAY, from),
    endsAt: jst(THURSDAY, to),
  }
}

/** その日の枠のうち、指定した JST の時刻の 1 枠を取る。無ければテストを落とす。 */
function slotAt(slots: readonly SlotResult[], time: string, date = THURSDAY): SlotResult {
  const found = slots.find((slot) => slot.startsAt === jst(date, time))
  if (!found) throw new Error(`${time} の枠が返っていない`)
  return found
}

/* --- 条件 ①〜③ 営業日・営業時間・受付を止める帯 --------------------------- */

describe('営業日と営業時間', () => {
  it('定休日（火曜）はどの時刻も枠にならず、理由は closed になる', () => {
    // 2026-09-01 は火曜。銀座店の定休日である。
    const result = computeAvailability(board({ date: '2026-09-01', blackouts: [] }))
    expect(result.isClosed).toBe(true)
    expect(result.reason).toBe('closed')
    expect(result.slots).toEqual([])
    expect(result.lanes).toEqual([])
  })

  it('営業時間（10:00–19:00）の外の 9:30 は枠にならず、理由は outside_hours になる', () => {
    const slot = evaluateSlot(board({ blackouts: [] }), jst(THURSDAY, '09:30'))
    expect(slot.isAvailable).toBe(false)
    expect(slot.reason).toBe('outside_hours')
  })

  it('受付を止める帯（お昼 12:00–13:00）の中の 12:00 と 12:30 は枠にならず、理由は break になる', () => {
    const { slots } = computeAvailability(board({ blackouts: LUNCH_ONLY }))
    expect(slotAt(slots, '12:00').reason).toBe('break')
    expect(slotAt(slots, '12:00').isAvailable).toBe(false)
    expect(slotAt(slots, '12:30').reason).toBe('break')
    expect(slotAt(slots, '12:30').isAvailable).toBe(false)
  })

  it('刻み 30 分の格子に載らない 11:15 は候補として出さない', () => {
    const { slots } = computeAvailability(board({ blackouts: LUNCH_ONLY }))
    expect(slots.some((slot) => slot.startsAt === jst(THURSDAY, '11:15'))).toBe(false)
    // 格子そのものは 10:00 / 10:30 … で並んでいる。
    expect(slots[0]?.startsAt).toBe(jst(THURSDAY, '10:00'))
    expect(slots[1]?.startsAt).toBe(jst(THURSDAY, '10:30'))
  })

  it('所要 60 分が閉店 19:00 までに収まらない 18:30 は枠にならない', () => {
    const { slots } = computeAvailability(board({ blackouts: [] }))
    expect(slotAt(slots, '18:30').isAvailable).toBe(false)
    expect(slotAt(slots, '18:30').reason).toBe('outside_hours')
  })
})

/* --- 条件 ⑤ 技能と勤務 ---------------------------------------------------- */

describe('技能を持つ担当', () => {
  it('技能を持つ担当が誰も勤務していない時刻は枠にならず、理由は staff_off になる', () => {
    // 視力測定ができる 2 名を午前だけの勤務にする。中村 彩は技能を持たない。
    const morningOnly: StaffShiftBand[] = [
      { staffId: MISAKI.id, date: THURSDAY, startsAt: '10:00', endsAt: '12:00', kind: 'work' },
      { staffId: KEN.id, date: THURSDAY, startsAt: '10:00', endsAt: '12:00', kind: 'work' },
      { staffId: AYA.id, date: THURSDAY, startsAt: '10:00', endsAt: '19:00', kind: 'work' },
    ]
    const { slots } = computeAvailability(board({ blackouts: [], shifts: morningOnly }))
    expect(slotAt(slots, '14:00').isAvailable).toBe(false)
    expect(slotAt(slots, '14:00').reason).toBe('staff_off')
  })

  it('技能を持つ担当が全員ふさがっている時刻は枠にならず、理由は staff_busy になる', () => {
    const occupied = [
      staffHold('r-1', MISAKI.id, '11:00', '12:00'),
      staffHold('r-2', KEN.id, '11:00', '12:00'),
    ]
    const { slots } = computeAvailability(board({ blackouts: [], occupied }))
    expect(slotAt(slots, '11:00').isAvailable).toBe(false)
    expect(slotAt(slots, '11:00').reason).toBe('staff_busy')
  })

  it('目的が要求する技能を持つ担当が 1 人も居ない日は、全時刻が枠にならず理由は no_skill になる', () => {
    // 「コンタクトの相談」は contact_lens が要る。銀座店の 3 名は誰も持っていない。
    const contact: PurposeSpec = {
      id: 'purpose-contact',
      durationMinutes: 40,
      requiredSkills: ['contact_lens'],
    }
    const { slots } = computeAvailability(board({ blackouts: [], purposes: [contact] }))
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.every((slot) => slot.isAvailable === false)).toBe(true)
    expect(slotAt(slots, '10:00').reason).toBe('no_skill')
    expect(slotAt(slots, '15:00').reason).toBe('no_skill')
  })
})

/* --- 条件 ⑥ 設備 ---------------------------------------------------------- */

describe('設備', () => {
  it('設備が点検中（11:30–12:00）の時刻は枠にならず、理由は maintenance になる', () => {
    // 視力測定機を 1 台だけにして、その 1 台を点検に入れる。
    const singleMeasure = EQUIPMENT.filter(
      (unit) => unit.kind !== 'measure' || unit.id === 'eq-measure-b',
    )
    const result = computeAvailability(
      board({
        blackouts: [],
        equipment: singleMeasure,
        purposes: [{ ...NEW_GLASSES, durationMinutes: 30 }],
        maintenances: MEASURE_B_MAINTENANCE,
      }),
    )
    expect(slotAt(result.slots, '11:30').isAvailable).toBe(false)
    expect(slotAt(result.slots, '11:30').reason).toBe('maintenance')
    // 点検が明けた 12:00 は置ける。
    expect(slotAt(result.slots, '12:00').isAvailable).toBe(true)
  })

  it('設備が capacity まで埋まっている時刻は枠にならず、理由は equipment_busy になる', () => {
    const singleMeasure = EQUIPMENT.filter(
      (unit) => unit.kind !== 'measure' || unit.id === 'eq-measure-a',
    )
    const occupied = [equipmentHold('r-9', 'eq-measure-a', '11:00', '12:00')]
    const { slots } = computeAvailability(
      board({
        blackouts: [],
        equipment: singleMeasure,
        purposes: [{ ...NEW_GLASSES, durationMinutes: 30 }],
        occupied,
      }),
    )
    expect(slotAt(slots, '11:00').isAvailable).toBe(false)
    expect(slotAt(slots, '11:00').reason).toBe('equipment_busy')
  })
})

/* --- 条件 ⑦ 同時受付上限 -------------------------------------------------- */

describe('同時受付上限', () => {
  it('同時受付上限に達した時刻は枠にならず、理由は max_parallel になる', () => {
    // 技能も設備も要らないご用件にして、上限だけが効く形にする。
    const spare: StaffMember = {
      id: 'staff-spare',
      displayName: '予備 太郎',
      skills: [],
      maxParallelReservations: 1,
      sortOrder: 3,
    }
    const occupied = [
      staffHold('r-1', MISAKI.id, '13:00', '13:30'),
      staffHold('r-2', KEN.id, '13:00', '13:30'),
      staffHold('r-3', AYA.id, '13:00', '13:30'),
    ]
    const { slots } = computeAvailability(
      board({
        blackouts: [],
        purposes: [PLAIN_30],
        staff: [MISAKI, KEN, AYA, spare],
        shifts: [
          ...THURSDAY_SHIFTS,
          { staffId: spare.id, date: THURSDAY, startsAt: '10:00', endsAt: '19:00', kind: 'work' },
        ],
        occupied,
      }),
    )
    expect(slotAt(slots, '13:00').isAvailable).toBe(false)
    expect(slotAt(slots, '13:00').reason).toBe('max_parallel')
    expect(slotAt(slots, '13:00').remaining).toBe(0)
  })

  it('担当が未定の予約も枠を消費する（target_id が NULL でも数に入る）', () => {
    const occupied = [staffHold('r-unassigned', null, '11:00', '12:00')]
    const { slots } = computeAvailability(
      board({
        blackouts: [],
        purposes: [PLAIN_30],
        slotRules: { ...SLOT_RULES, maxParallel: 1 },
        occupied,
      }),
    )
    expect(slotAt(slots, '11:00').isAvailable).toBe(false)
    expect(slotAt(slots, '11:00').reason).toBe('max_parallel')
    expect(slotAt(slots, '11:00').remaining).toBe(0)
  })
})

/* --- 8 条件をすべて満たす枠と、材料が足りない店舗 ------------------------- */

describe('置ける枠', () => {
  it('8 条件をすべて満たす時刻は isAvailable が true で、remaining と staffIds と equipmentIds を持つ', () => {
    const { slots } = computeAvailability(board({ blackouts: LUNCH_ONLY }))
    const slot = slotAt(slots, '11:00')
    expect(slot.isAvailable).toBe(true)
    expect(slot.reason).toBeNull()
    expect(slot.remaining).toBe(3)
    expect(slot.staffIds).toContain(MISAKI.id)
    // 視力測定機と相談カウンターを 1 台ずつ押さえる（`purpose_requirements` は AND）。
    expect(slot.equipmentIds).toHaveLength(2)
    expect(slot.endsAt).toBe(jst(THURSDAY, '12:00'))
  })

  it('store_slot_rules の行が無い店舗は枠を 0 件にする（暗黙の既定値を作らない）', () => {
    const result = computeAvailability(board({ blackouts: [], slotRules: null }))
    expect(result.slots).toEqual([])
    expect(result.lanes).toEqual([])
    expect(result.slotRules).toBeNull()
  })
})

/* --- 変更と仮の押さえの除外 ----------------------------------------------- */

describe('塞がりから外すもの', () => {
  it('excludeReservationId を渡すと、その予約は塞がりに数えない', () => {
    const occupied = [
      staffHold('r-1', MISAKI.id, '11:00', '12:00'),
      staffHold('r-2', KEN.id, '11:00', '12:00'),
    ]
    const before = computeAvailability(board({ blackouts: [], occupied }))
    expect(slotAt(before.slots, '11:00').isAvailable).toBe(false)

    const after = computeAvailability(
      board({ blackouts: [], occupied, excludeReservationId: 'r-2' }),
    )
    expect(slotAt(after.slots, '11:00').isAvailable).toBe(true)
    expect(slotAt(after.slots, '11:00').staffIds).toEqual([KEN.id])
  })

  it('excludeReceptionSessionId と同じ受付が置いた仮の押さえは塞がりに数えない', () => {
    const holds: HoldOccupancy[] = [
      {
        holdId: 'hold-1',
        receptionSessionId: 'session-mine',
        kind: 'staff',
        targetId: MISAKI.id,
        startsAt: jst(THURSDAY, '11:00'),
        endsAt: jst(THURSDAY, '12:00'),
      },
      {
        holdId: 'hold-2',
        receptionSessionId: 'session-mine',
        kind: 'staff',
        targetId: KEN.id,
        startsAt: jst(THURSDAY, '11:00'),
        endsAt: jst(THURSDAY, '12:00'),
      },
    ]
    const { slots } = computeAvailability(
      board({ blackouts: [], holds, excludeReceptionSessionId: 'session-mine' }),
    )
    expect(slotAt(slots, '11:00').isAvailable).toBe(true)
  })

  it('仮の押さえは 1 件でも枠を塞ぐ（受付セッションが違えば数える）', () => {
    const holds: HoldOccupancy[] = [
      {
        holdId: 'hold-1',
        receptionSessionId: 'session-other',
        kind: 'staff',
        targetId: MISAKI.id,
        startsAt: jst(THURSDAY, '11:00'),
        endsAt: jst(THURSDAY, '12:00'),
      },
      {
        holdId: 'hold-2',
        receptionSessionId: 'session-other',
        kind: 'staff',
        targetId: KEN.id,
        startsAt: jst(THURSDAY, '11:00'),
        endsAt: jst(THURSDAY, '12:00'),
      },
    ]
    const { slots } = computeAvailability(
      board({ blackouts: [], holds, excludeReceptionSessionId: 'session-mine' }),
    )
    expect(slotAt(slots, '11:00').isAvailable).toBe(false)
    expect(slotAt(slots, '11:00').reason).toBe('staff_busy')
  })
})

/* --- 軸と、実時刻に依存しないこと ----------------------------------------- */

describe('軸と時刻の注入', () => {
  it('axis=resource では設備ごとのレーンを返し、axis=staff では担当ごとのレーンを返す', () => {
    const byStaff = computeAvailability(board({ blackouts: LUNCH_ONLY, axis: 'staff' }))
    const staffLanes: LaneResult[] = byStaff.lanes
    expect(staffLanes.map((lane) => lane.kind)).toEqual(['staff', 'staff', 'unassigned'])
    expect(byStaff.lanes.map((lane) => lane.name)).toEqual(['佐藤 美咲', '高橋 健', '担当が未定'])

    const byResource = computeAvailability(board({ blackouts: LUNCH_ONLY, axis: 'resource' }))
    expect(byResource.lanes.every((lane) => lane.kind === 'equipment')).toBe(true)
    // ご用件が要るのは視力測定機（3 台）と相談カウンター（3 台）で、加工室は要らない。
    expect(byResource.lanes.map((lane) => lane.name)).toEqual([
      '視力測定機 A',
      '視力測定機 B',
      '検査室 1',
      '相談カウンター 1',
      '相談カウンター 2',
      'フィッティング台',
    ])
    expect(byResource.lanes[0]?.slots.length).toBe(byStaff.slots.length)
  })

  it('関数の中で Date.now() を呼ばない（now を 1 時間進めても返る枠が変わらない）', () => {
    const early = computeAvailability(board({ blackouts: LUNCH_ONLY }))
    const later = computeAvailability(
      board({ blackouts: LUNCH_ONLY, now: new Date('2026-08-27T03:08:00.000Z') }),
    )
    expect(later.slots).toEqual(early.slots)
    expect(later.lanes).toEqual(early.lanes)
    // 動くのは応答の `serverNow` だけである（現在時刻の線はここから引く）。
    expect(early.serverNow).toBe('2026-08-27T02:08:00.000Z')
    expect(later.serverNow).toBe('2026-08-27T03:08:00.000Z')
  })
})

/* --- 境界値: 片付け時間 --------------------------------------------------- */

describe('片付け時間', () => {
  /** 担当 1 名・技能も設備も要らない 60 分。片付けだけが効く盤面にする。 */
  function cleanupBoard(cleanupMinutes: number, occupied: OccupiedAssignment[]): AvailabilityInput {
    return board({
      blackouts: [],
      purposes: [{ id: 'purpose-60', durationMinutes: 60 }],
      staff: [MISAKI],
      shifts: [
        { staffId: MISAKI.id, date: THURSDAY, startsAt: '10:00', endsAt: '19:00', kind: 'work' },
      ],
      slotRules: { ...SLOT_RULES, cleanupMinutes },
      occupied,
    })
  }

  const noon = [staffHold('r-noon', MISAKI.id, '11:00', '12:00')]

  it('12:00 に終わる予約があり片付け 10 分のとき、12:00 から始まる枠は置けない', () => {
    const { slots } = computeAvailability(cleanupBoard(10, noon))
    expect(slotAt(slots, '12:00').isAvailable).toBe(false)
    expect(slotAt(slots, '12:00').reason).toBe('staff_busy')
  })

  it('同じ条件で 12:30 から始まる枠は置ける', () => {
    const { slots } = computeAvailability(cleanupBoard(10, noon))
    expect(slotAt(slots, '12:30').isAvailable).toBe(true)
  })

  it('片付け 0 分なら 12:00 から始まる枠は置ける', () => {
    const { slots } = computeAvailability(cleanupBoard(0, noon))
    expect(slotAt(slots, '12:00').isAvailable).toBe(true)
  })

  it('片付けは予約の後ろにだけ付き、ends_at には含めない', () => {
    const withCleanup = expandToSlotStarts({
      startsAt: jst(THURSDAY, '11:00'),
      endsAt: jst(THURSDAY, '12:00'),
      cleanupMinutes: 10,
      slotMinutes: 30,
    })
    // 前へは伸びない。後ろへ 1 枠だけ伸びる（60分 + 10分 → 3 枠）。
    expect(withCleanup).toEqual([
      jst(THURSDAY, '11:00'),
      jst(THURSDAY, '11:30'),
      jst(THURSDAY, '12:00'),
    ])
    const withoutCleanup = expandToSlotStarts({
      startsAt: jst(THURSDAY, '11:00'),
      endsAt: jst(THURSDAY, '12:00'),
      cleanupMinutes: 0,
      slotMinutes: 30,
    })
    expect(withoutCleanup).toEqual([jst(THURSDAY, '11:00'), jst(THURSDAY, '11:30')])
  })
})

/* --- 境界値: 受付を止める帯 ----------------------------------------------- */

describe('受付を止める帯の境界', () => {
  it('帯が 12:00–13:00 のとき 12:00 は枠にならない', () => {
    const { slots } = computeAvailability(board({ blackouts: LUNCH_ONLY }))
    expect(slotAt(slots, '12:00').isAvailable).toBe(false)
    expect(slotAt(slots, '12:00').reason).toBe('break')
  })

  it('帯が 12:00–13:00 のとき 13:00 は枠になる（終わりは含めない）', () => {
    const { slots } = computeAvailability(board({ blackouts: LUNCH_ONLY }))
    expect(slotAt(slots, '13:00').isAvailable).toBe(true)
    expect(slotAt(slots, '13:00').reason).toBeNull()
  })

  it('帯を 12:01–13:00 へ 1 分ずらすと 12:00 の枠が戻る', () => {
    const shifted: BlackoutBand[] = [{ weekday: 4, startsAt: '12:01', endsAt: '13:00' }]
    const { slots } = computeAvailability(board({ blackouts: shifted }))
    expect(slotAt(slots, '12:00').isAvailable).toBe(true)
    expect(slotAt(slots, '12:00').reason).toBeNull()
  })
})

/* --- 境界値: 同時受付上限 ------------------------------------------------- */

describe('同時受付上限の境界', () => {
  /** 技能も設備も要らない 30 分。上限だけが効く盤面にする。 */
  function parallelBoard(occupied: OccupiedAssignment[]): AvailabilityInput {
    const bench: StaffMember[] = [0, 1, 2, 3].map((n) => ({
      id: `staff-${n}`,
      displayName: `担当 ${n}`,
      skills: [],
      maxParallelReservations: 1,
      sortOrder: n,
    }))
    return board({
      blackouts: [],
      purposes: [PLAIN_30],
      staff: bench,
      shifts: bench.map((member) => ({
        staffId: member.id,
        date: THURSDAY,
        startsAt: '10:00',
        endsAt: '19:00',
        kind: 'work' as const,
      })),
      occupied,
    })
  }

  it('上限 3 件の店で 2 件入っている時刻は remaining が 1 になる', () => {
    const { slots } = computeAvailability(
      parallelBoard([
        staffHold('r-1', 'staff-0', '13:00', '13:30'),
        staffHold('r-2', 'staff-1', '13:00', '13:30'),
      ]),
    )
    expect(slotAt(slots, '13:00').remaining).toBe(1)
    expect(slotAt(slots, '13:00').isAvailable).toBe(true)
  })

  it('上限 3 件の店で 3 件入っている時刻は満席（remaining 0・isAvailable false）になる', () => {
    const { slots } = computeAvailability(
      parallelBoard([
        staffHold('r-1', 'staff-0', '13:00', '13:30'),
        staffHold('r-2', 'staff-1', '13:00', '13:30'),
        staffHold('r-3', 'staff-2', '13:00', '13:30'),
      ]),
    )
    expect(slotAt(slots, '13:00').remaining).toBe(0)
    expect(slotAt(slots, '13:00').isAvailable).toBe(false)
    expect(slotAt(slots, '13:00').reason).toBe('max_parallel')
  })

  it('3 件のうち 1 件が担当未定でも数に入って満席になる', () => {
    const { slots } = computeAvailability(
      parallelBoard([
        staffHold('r-1', 'staff-0', '13:00', '13:30'),
        staffHold('r-2', 'staff-1', '13:00', '13:30'),
        staffHold('r-3', null, '13:00', '13:30'),
      ]),
    )
    expect(slotAt(slots, '13:00').remaining).toBe(0)
    expect(slotAt(slots, '13:00').reason).toBe('max_parallel')
  })

  /** 60 分のご用件。上限だけが効く盤面で、枠を 2 つ使う形にする。 */
  const PLAIN_60: PurposeSpec = { id: 'purpose-60', durationMinutes: 60 }

  it('60分の枠は、使う枠のうち一番少ない残りを返す（先頭の枠だけを見ない）', () => {
    // 13:00 は 1 件も入っていないが、13:30 が 3 件で満席。13:00 の 60 分は 13:30 を使う。
    const { slots } = computeAvailability({
      ...parallelBoard([
        staffHold('r-1', 'staff-0', '13:30', '14:00'),
        staffHold('r-2', 'staff-1', '13:30', '14:00'),
        staffHold('r-3', 'staff-2', '13:30', '14:00'),
      ]),
      purposes: [PLAIN_60],
    })
    const slot = slotAt(slots, '13:00')
    expect(slot.isAvailable).toBe(false)
    expect(slot.reason).toBe('max_parallel')
    // 先頭の枠だけを見ると「あと 3枠」と描きながら置けない枠になる。
    expect(slot.remaining).toBe(0)
  })

  it('60分の枠の残りは、後ろの枠が 1 件埋まっていればその数まで下がる', () => {
    const { slots } = computeAvailability({
      ...parallelBoard([staffHold('r-1', 'staff-0', '13:30', '14:00')]),
      purposes: [PLAIN_60],
    })
    const slot = slotAt(slots, '13:00')
    expect(slot.isAvailable).toBe(true)
    expect(slot.remaining).toBe(2)
  })
})

/* --- 境界値: JST の日跨ぎ ------------------------------------------------- */

describe('JST の日跨ぎ', () => {
  it('date=2026-08-27 の窓は UTC 2026-08-26T15:00:00.000Z 以上 2026-08-27T15:00:00.000Z 未満である', () => {
    expect(jstDayRange('2026-08-27')).toEqual({
      fromIso: '2026-08-26T15:00:00.000Z',
      toIso: '2026-08-27T15:00:00.000Z',
    })
  })

  it('UTC 2026-08-27T14:59:59.999Z に始まる予約は 8月27日の計算に入る', () => {
    expect(
      overlapsJstDay('2026-08-27T14:59:59.999Z', '2026-08-27T15:30:00.000Z', '2026-08-27'),
    ).toBe(true)
  })

  it('UTC 2026-08-27T15:00:00.000Z に始まる予約は 8月27日の計算に入らない', () => {
    expect(
      overlapsJstDay('2026-08-27T15:00:00.000Z', '2026-08-27T16:00:00.000Z', '2026-08-27'),
    ).toBe(false)
    // 同じ予約は翌日（8月28日）の計算には入る。
    expect(
      overlapsJstDay('2026-08-27T15:00:00.000Z', '2026-08-27T16:00:00.000Z', '2026-08-28'),
    ).toBe(true)
  })

  it('月をまたぐ 2026-08-31 と 2026-09-01 が別の日として扱われる', () => {
    expect(jstDayRange('2026-08-31').toIso).toBe(jstDayRange('2026-09-01').fromIso)
    // 8月31日 13:00 の予約は 9月1日の枠を 1 つも塞がない。
    const occupied: OccupiedAssignment[] = [
      {
        reservationId: 'r-aug',
        kind: 'staff',
        targetId: MISAKI.id,
        startsAt: new Date(Date.parse('2026-08-31T13:00:00.000Z') - 9 * 3_600_000).toISOString(),
        endsAt: new Date(Date.parse('2026-08-31T14:00:00.000Z') - 9 * 3_600_000).toISOString(),
      },
    ]
    const september = computeAvailability(
      board({
        date: '2026-09-01',
        weeklyHours: OPEN_EVERY_DAY,
        blackouts: [],
        purposes: [PLAIN_30],
        staff: [MISAKI],
        shifts: [
          {
            staffId: MISAKI.id,
            date: '2026-09-01',
            startsAt: '10:00',
            endsAt: '19:00',
            kind: 'work',
          },
        ],
        occupied,
      }),
    )
    expect(slotAt(september.slots, '13:00', '2026-09-01').isAvailable).toBe(true)
  })

  it('うるう年の 2028-02-29 が営業日として扱われる', () => {
    const result = computeAvailability(
      board({
        date: '2028-02-29',
        weeklyHours: OPEN_EVERY_DAY,
        blackouts: [],
        purposes: [PLAIN_30],
        staff: [MISAKI],
        shifts: [
          {
            staffId: MISAKI.id,
            date: '2028-02-29',
            startsAt: '10:00',
            endsAt: '19:00',
            kind: 'work',
          },
        ],
      }),
    )
    expect(result.isClosed).toBe(false)
    expect(jstDayRange('2028-02-29')).toEqual({
      fromIso: '2028-02-28T15:00:00.000Z',
      toIso: '2028-02-29T15:00:00.000Z',
    })
    expect(slotAt(result.slots, '10:00', '2028-02-29').isAvailable).toBe(true)
  })
})

/* --- 境界値: 勤務帯 ------------------------------------------------------- */

describe('勤務帯の境界', () => {
  it('勤務が 10:00–19:00 のとき 10:00 は枠になり、9:59 台の格子は候補にならない', () => {
    const { slots } = computeAvailability(board({ blackouts: [] }))
    expect(slots[0]?.startsAt).toBe(jst(THURSDAY, '10:00'))
    expect(slotAt(slots, '10:00').isAvailable).toBe(true)
    expect(slots.some((slot) => slot.startsAt < jst(THURSDAY, '10:00'))).toBe(false)
  })

  it('勤務が 18:00 に終わるとき、所要 60 分の 17:30 は枠にならない', () => {
    const { slots } = computeAvailability(
      board({
        blackouts: [],
        purposes: [{ id: 'purpose-60', durationMinutes: 60 }],
        staff: [MISAKI],
        shifts: [
          { staffId: MISAKI.id, date: THURSDAY, startsAt: '10:00', endsAt: '18:00', kind: 'work' },
        ],
      }),
    )
    expect(slotAt(slots, '17:30').isAvailable).toBe(false)
    expect(slotAt(slots, '17:30').reason).toBe('staff_off')
    // 17:00 に始まれば 18:00 に終わるので置ける。
    expect(slotAt(slots, '17:00').isAvailable).toBe(true)
  })
})

/* --- 設備の語彙と、同じ種別を 2 度求めたとき ------------------------------ */

describe('設備が 1 台も使えない日', () => {
  /** 相談カウンターだけを要るご用件。設備の条件だけを見る盤面にする。 */
  const COUNTER_ONLY: PurposeSpec = {
    id: 'purpose-counter',
    durationMinutes: 30,
    requiredEquipmentKinds: ['counter'],
  }

  it('求める種別の設備が 1 台も登録されていない店舗は、理由が no_equipment になる', () => {
    const { slots } = computeAvailability(
      board({
        blackouts: [],
        purposes: [COUNTER_ONLY],
        // 相談カウンターが 1 台も無い店舗。
        equipment: EQUIPMENT.filter((unit) => unit.kind !== 'counter'),
      }),
    )
    expect(slotAt(slots, '11:00').isAvailable).toBe(false)
    expect(slotAt(slots, '11:00').reason).toBe('no_equipment')
  })

  it('相談カウンターを全台止めた店舗も no_equipment になる（equipment_busy と分ける）', () => {
    const stopped = EQUIPMENT.map((unit) =>
      unit.kind === 'counter' ? { ...unit, isActive: false } : unit,
    )
    const { slots } = computeAvailability(
      board({ blackouts: [], purposes: [COUNTER_ONLY], equipment: stopped }),
    )
    // 「すべて埋まっています」ではない。時間をずらしても取れない（BOOK-02b の文言）。
    expect(slotAt(slots, '11:00').reason).toBe('no_equipment')
  })

  it('1 台だけの相談カウンターが埋まっている時刻は equipment_busy のままである', () => {
    const single = EQUIPMENT.filter((unit) => unit.kind !== 'counter' || unit.id === 'eq-counter-1')
    const { slots } = computeAvailability(
      board({
        blackouts: [],
        purposes: [COUNTER_ONLY],
        equipment: single,
        occupied: [equipmentHold('r-c', 'eq-counter-1', '11:00', '11:30')],
      }),
    )
    expect(slotAt(slots, '11:00').reason).toBe('equipment_busy')
  })

  it('同じ種別を 2 つのご用件が求めても、押さえるのは 1 台にする', () => {
    // ご用件は 1 予約の中で順に行う（所要は合算）。相談カウンターを 2 台同時に
    // 押さえると、ご用件を足しただけで置ける枠が消える。
    const { slots } = computeAvailability(
      board({
        blackouts: [],
        purposes: [COUNTER_ONLY, { ...COUNTER_ONLY, id: 'purpose-counter-2' }],
        equipment: EQUIPMENT.filter((unit) => unit.id === 'eq-counter-1'),
      }),
    )
    const slot = slotAt(slots, '11:00')
    expect(slot.isAvailable).toBe(true)
    expect(slot.equipmentIds).toEqual(['eq-counter-1'])
    // 所要は 2 件ぶん（30 + 30）合算される。
    expect(slot.endsAt).toBe(jst(THURSDAY, '12:00'))
  })
})

/* --- 店舗まるごとの受付停止（AC-LEDGER-22） -------------------------------- */

describe('店舗まるごとの受付停止', () => {
  it('受付を止めた店舗は、営業日でも枠を 1 つも返さず理由は closed になる', () => {
    const answer = computeAvailability(board({ blackouts: [], isSuspended: true }))
    expect(answer.isClosed).toBe(true)
    expect(answer.opensAt).toBeNull()
    expect(answer.closesAt).toBeNull()
    expect(answer.slots).toEqual([])
    expect(answer.lanes).toEqual([])
    expect(answer.reason).toBe('closed')
  })
})

/* --- 担当が未定のご予約をどこで数えるか ------------------------------------ */

describe('担当が未定のご予約の数え方', () => {
  it('未定のご予約は ⑦（店舗の同時受付上限）で数え、⑤（担当の空き）では数えない', () => {
    // `02-domain-model.md` I-05 の決め —— `target_id IS NULL` の押さえが消費するのは
    // `store_slot_rules.max_parallel` であって、担当ひとりの空きではない。
    // **この決めの帰結として**、技能持ちの延べ枠が未定のご予約で尽きていても、
    // 上限に余りがある限り枠は置けるものとして返る。数え方を変えるなら
    // I-05 と AC-LEDGER-17 を先に直す（reason が max_parallel から staff_busy へ動く）。
    const twoStaff = [MISAKI, KEN]
    const { slots } = computeAvailability(
      board({
        blackouts: [],
        purposes: [PLAIN_30],
        staff: twoStaff,
        shifts: twoStaff.map((member) => ({
          staffId: member.id,
          date: THURSDAY,
          startsAt: '10:00',
          endsAt: '19:00',
          kind: 'work' as const,
        })),
        // 技能持ち 2 名（各 1 件まで）に対し、担当が未定のご予約が 2 件。
        occupied: [
          staffHold('r-u1', null, '11:00', '11:30'),
          staffHold('r-u2', null, '11:00', '11:30'),
        ],
      }),
    )
    const slot = slotAt(slots, '11:00')
    expect(slot.isAvailable).toBe(true)
    // 上限 3 件のうち 2 件が埋まっているので、残りは 1。
    expect(slot.remaining).toBe(1)
    expect(slot.staffIds).toEqual([MISAKI.id, KEN.id])
  })

  it('未定のご予約が上限に届けば ⑦ で満席になる', () => {
    const { slots } = computeAvailability(
      board({
        blackouts: [],
        purposes: [PLAIN_30],
        occupied: [
          staffHold('r-u1', null, '11:00', '11:30'),
          staffHold('r-u2', null, '11:00', '11:30'),
          staffHold('r-u3', null, '11:00', '11:30'),
        ],
      }),
    )
    expect(slotAt(slots, '11:00').isAvailable).toBe(false)
    expect(slotAt(slots, '11:00').reason).toBe('max_parallel')
  })
})

/* --- 語彙が仕様の外へ出ていないこと --------------------------------------- */

describe('語彙', () => {
  it('返る理由は AvailabilityReason の値の中に収まる', () => {
    const known: readonly (string | null)[] = [null, ...AvailabilityReason.options]
    const { slots, lanes } = computeAvailability(board({ blackouts: THURSDAY_BANDS }))
    for (const slot of [...slots, ...lanes.flatMap((lane) => lane.slots)]) {
      expect(known).toContain(slot.reason)
    }
    // 技能と設備の語彙は契約の型からしか作らない（別名を作らない）。
    const skills: readonly SkillCode[] = MISAKI.skills
    const kinds: readonly EquipmentKind[] = EQUIPMENT.map((unit) => unit.kind)
    expect(skills).toContain('measure')
    expect(kinds).toContain('workbench')
  })
})
