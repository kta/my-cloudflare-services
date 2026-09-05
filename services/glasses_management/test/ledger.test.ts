/**
 * 台帳の行組み立て（`src/worker/domain/ledger.ts`）の振る舞いを固定する。
 *
 * ここで見るのは**純関数だけ**である。D1 にも実時刻にも触れず、読み出した行と
 * `serverNow` をすべて引数で渡す。台帳は「いまお店がどこまで埋まっているか」を
 * 読む唯一の面なので、実行日や端末の時計で並びが変わってはならない。
 *
 * 盤面は銀座店の 2026年8月27日（木）10:00–19:00。時刻は JST の壁時計で書き、
 * 表に入れるときだけ UTC の ISO8601 へ直す（`jst()`）。
 * `serverNow` は JST 11:08（`2026-08-27T02:08:00.000Z`）に固定する。
 *
 * お客様のお名前と来店回数は `007-customer-records`、「ご来店お待ち」の人数は
 * `008-reception-and-walkin` が足す。この段階の台帳は名前を描かず、人数は 0 である。
 */
import { type LedgerLane, LedgerView } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  bandSourceLabel,
  bandTone,
  buildLedgerRows,
  buildLedgerView,
  filterLedgerRows,
  LEDGER_SLOT_MINUTES,
  LEDGER_WINDOW_MINUTES,
  LEDGER_WINDOW_SLOTS,
  LEDGER_WINDOW_START,
  type LedgerAssignmentRow,
  type LedgerInput,
  nowMarker,
  placeOnLedgerWindow,
  SOURCE_LABELS,
} from '../src/worker/domain/ledger'

const id = () => crypto.randomUUID()

/** JST の壁時計を UTC の ISO8601 に直す。`10:00` は `2026-08-27T01:00:00.000Z`。 */
function jst(time: string, date = '2026-08-27'): string {
  return new Date(Date.parse(`${date}T${time}:00.000Z`) - 9 * 60 * 60_000).toISOString()
}

/** 応答の `serverNow`。JST 11:08。端末の時計は 1 度も読まない。 */
const SERVER_NOW = new Date('2026-08-27T02:08:00.000Z')

const STORE = id()
const OTHER_STORE = id()

const STAFF = { sato: id(), takahashi: id(), nakamura: id(), kobayashi: id() }
const EQUIPMENT = {
  measureA: id(),
  measureB: id(),
  room1: id(),
  counter1: id(),
  counter2: id(),
}
const RES = {
  r1: id(),
  r2: id(),
  r3: id(),
  r4: id(),
  r5: id(),
  r6: id(),
  r7: id(),
  r8: id(),
  cancelled: id(),
  noShow: id(),
  otherStore: id(),
}

/** 担当の割当 1 行。`targetId` が null の行も枠を消費する（I-05）。 */
function staffOf(reservationId: string, targetId: string | null, from: string, to: string) {
  return { reservationId, kind: 'staff' as const, targetId, startsAt: jst(from), endsAt: jst(to) }
}

/** 設備の割当 1 行。1 予約が 2 台を別々の時間で押さえることがある。 */
function equipmentOf(reservationId: string, targetId: string, from: string, to: string) {
  return {
    reservationId,
    kind: 'equipment' as const,
    targetId,
    startsAt: jst(from),
    endsAt: jst(to),
  }
}

/**
 * 銀座店 1 日分の素材。
 * 12 件のうち、この面で必要な 11 件（取消 1 件・他店舗 1 件を含む）を置く。
 */
function board(overrides: Partial<LedgerInput> = {}): LedgerInput {
  const assignments: LedgerAssignmentRow[] = [
    staffOf(RES.r1, STAFF.takahashi, '10:00', '10:30'),
    staffOf(RES.r2, STAFF.nakamura, '10:30', '11:30'),
    equipmentOf(RES.r2, EQUIPMENT.measureB, '10:30', '11:30'),
    staffOf(RES.r3, STAFF.sato, '11:00', '12:00'),
    equipmentOf(RES.r3, EQUIPMENT.measureA, '11:00', '11:30'),
    equipmentOf(RES.r3, EQUIPMENT.counter2, '11:30', '12:00'),
    staffOf(RES.r4, STAFF.takahashi, '11:00', '11:30'),
    staffOf(RES.r5, null, '11:02', '12:02'),
    staffOf(RES.r6, null, '13:00', '13:20'),
    equipmentOf(RES.r6, EQUIPMENT.counter1, '13:00', '13:20'),
    staffOf(RES.r7, STAFF.nakamura, '15:00', '16:00'),
    staffOf(RES.r8, STAFF.sato, '17:00', '17:30'),
    staffOf(RES.cancelled, STAFF.sato, '11:00', '11:30'),
    // 取り消したご予約の押さえの行は残る。台帳の帯にしてはいけない。
    equipmentOf(RES.cancelled, EQUIPMENT.measureA, '11:00', '11:30'),
    staffOf(RES.noShow, STAFF.sato, '14:00', '14:20'),
    staffOf(RES.otherStore, null, '11:00', '12:00'),
  ]

  return {
    date: '2026-08-27',
    axis: 'staff',
    view: 'timetable',
    storeId: STORE,
    opensAt: '10:00',
    closesAt: '19:00',
    slotMinutes: 30,
    serverNow: SERVER_NOW,
    staff: [
      { id: STAFF.sato, displayName: '佐藤 美咲', jobLabel: '店長', sortOrder: 1 },
      { id: STAFF.takahashi, displayName: '高橋 健', jobLabel: null, sortOrder: 2 },
      { id: STAFF.nakamura, displayName: '中村 彩', jobLabel: null, sortOrder: 3 },
      { id: STAFF.kobayashi, displayName: '小林 誠', jobLabel: null, sortOrder: 4 },
    ],
    // 小林 誠は本日の勤務が 1 行も無いので台帳の行にならない。
    shifts: [
      { staffId: STAFF.sato, kind: 'work', startsAt: '10:00', endsAt: '19:00' },
      { staffId: STAFF.sato, kind: 'break', startsAt: '13:00', endsAt: '14:00' },
      { staffId: STAFF.takahashi, kind: 'work', startsAt: '10:00', endsAt: '19:00' },
      { staffId: STAFF.nakamura, kind: 'work', startsAt: '10:00', endsAt: '19:00' },
    ],
    equipment: [
      {
        id: EQUIPMENT.measureA,
        name: '視力測定機 A',
        roleLabel: '測定',
        sortOrder: 1,
        isActive: true,
        ledgerDisplay: 'grey',
      },
      {
        id: EQUIPMENT.measureB,
        name: '視力測定機 B',
        roleLabel: '測定',
        sortOrder: 2,
        isActive: true,
        ledgerDisplay: 'grey',
      },
      {
        id: EQUIPMENT.room1,
        name: '検査室 1',
        roleLabel: null,
        sortOrder: 3,
        isActive: true,
        ledgerDisplay: 'grey',
      },
      {
        id: EQUIPMENT.counter1,
        name: '相談カウンター 1',
        roleLabel: '相談',
        sortOrder: 4,
        isActive: true,
        ledgerDisplay: 'grey',
      },
      {
        id: EQUIPMENT.counter2,
        name: '相談カウンター 2',
        roleLabel: '相談',
        sortOrder: 5,
        isActive: true,
        ledgerDisplay: 'grey',
      },
    ],
    maintenance: [
      {
        equipmentId: EQUIPMENT.measureB,
        startsAt: jst('11:30'),
        endsAt: jst('12:00'),
        note: '定期点検',
      },
    ],
    reservations: [
      {
        id: RES.r1,
        storeId: STORE,
        source: 'phone',
        status: 'arrived',
        startsAt: jst('10:00'),
        endsAt: jst('10:30'),
      },
      {
        id: RES.r2,
        storeId: STORE,
        source: 'web',
        status: 'arrived',
        startsAt: jst('10:30'),
        endsAt: jst('11:30'),
      },
      {
        id: RES.r3,
        storeId: STORE,
        source: 'phone',
        status: 'confirmed',
        startsAt: jst('11:00'),
        endsAt: jst('12:00'),
      },
      {
        id: RES.r4,
        storeId: STORE,
        source: 'walkin',
        status: 'arrived',
        startsAt: jst('11:00'),
        endsAt: jst('11:30'),
      },
      {
        id: RES.r5,
        storeId: STORE,
        source: 'walkin',
        status: 'confirmed',
        startsAt: jst('11:02'),
        endsAt: jst('12:02'),
      },
      {
        id: RES.r6,
        storeId: STORE,
        source: 'web',
        status: 'confirmed',
        startsAt: jst('13:00'),
        endsAt: jst('13:20'),
      },
      {
        id: RES.r7,
        storeId: STORE,
        source: 'counter',
        status: 'confirmed',
        startsAt: jst('15:00'),
        endsAt: jst('16:00'),
      },
      {
        id: RES.r8,
        storeId: STORE,
        source: 'phone',
        status: 'confirmed',
        startsAt: jst('17:00'),
        endsAt: jst('17:30'),
      },
      {
        id: RES.cancelled,
        storeId: STORE,
        source: 'phone',
        status: 'cancelled',
        startsAt: jst('11:00'),
        endsAt: jst('11:30'),
      },
      {
        id: RES.noShow,
        storeId: STORE,
        source: 'phone',
        status: 'no_show',
        startsAt: jst('14:00'),
        endsAt: jst('14:20'),
      },
      {
        id: RES.otherStore,
        storeId: OTHER_STORE,
        source: 'phone',
        status: 'confirmed',
        startsAt: jst('11:00'),
        endsAt: jst('12:00'),
      },
    ],
    // r3 は並び順を入れ替えて渡す。連ねる順は配列の順ではなく sortOrder で決める。
    purposes: [
      { reservationId: RES.r1, nameShort: '調整', sortOrder: 0 },
      { reservationId: RES.r2, nameShort: '視力測定', sortOrder: 0 },
      { reservationId: RES.r3, nameShort: '視力測定', sortOrder: 1 },
      { reservationId: RES.r3, nameShort: '新調相談', sortOrder: 0 },
      { reservationId: RES.r4, nameShort: '視力測定', sortOrder: 0 },
      { reservationId: RES.r5, nameShort: '新調相談', sortOrder: 0 },
      { reservationId: RES.r6, nameShort: '調整', sortOrder: 0 },
      { reservationId: RES.r7, nameShort: '新調相談', sortOrder: 0 },
      { reservationId: RES.r8, nameShort: '調整', sortOrder: 0 },
      { reservationId: RES.cancelled, nameShort: '調整', sortOrder: 0 },
      { reservationId: RES.noShow, nameShort: '受け取り', sortOrder: 0 },
      { reservationId: RES.otherStore, nameShort: '新調相談', sortOrder: 0 },
    ],
    assignments,
    ...overrides,
  }
}

/** 担当軸の台帳。 */
const staffView = (overrides: Partial<LedgerInput> = {}) =>
  buildLedgerView(board({ axis: 'staff', ...overrides }))

/** 設備軸の台帳。 */
const resourceView = (overrides: Partial<LedgerInput> = {}) =>
  buildLedgerView(board({ axis: 'resource', ...overrides }))

/** ある行の帯を予約 id で 1 本引く。行そのものが無ければ undefined。 */
const entryOf = (lane: LedgerLane | undefined, reservationId: string) =>
  lane?.entries.find((entry) => entry.reservationId === reservationId)

describe('担当者別', () => {
  it('当日勤務している担当の行を並び順で並べる', () => {
    const lanes = staffView().lanes.filter((lane) => lane.kind === 'staff')

    expect(lanes.map((lane) => lane.name)).toEqual(['佐藤 美咲', '高橋 健', '中村 彩'])
    // 小林 誠は本日の勤務が無い。並び順を持っていても行にしない。
    expect(lanes.map((lane) => lane.id)).not.toContain(STAFF.kobayashi)
  })

  it('担当が未定の予約は「担当が未定」の擬似行に置く', () => {
    const lane = staffView().lanes.find((l) => l.kind === 'unassigned')

    expect(lane?.name).toBe('担当が未定')
    expect(lane?.id).toBeNull()
    expect(lane?.entries.map((entry) => entry.reservationId)).toEqual([RES.r5, RES.r6])
    expect(lane?.entries.every((entry) => entry.isUnassigned)).toBe(true)
  })

  it('行を出せない担当を指した押さえも「担当が未定」の帯にし、必ず印を付ける', () => {
    // 担当の行に出せない id（消えた担当・別店舗の担当）を指した押さえ。
    const ghost = id()
    const view = buildLedgerView(
      board({
        assignments: [staffOf(RES.r1, ghost, '10:00', '10:30')],
        reservations: [
          {
            id: RES.r1,
            storeId: STORE,
            source: 'phone',
            status: 'confirmed',
            startsAt: jst('10:00'),
            endsAt: jst('10:30'),
          },
        ],
      }),
    )
    const lane = view.lanes.find((l) => l.kind === 'unassigned')

    // 帯を台帳から消さない。かつ**色だけで伝えない** —— 印が無いと画面は
    // 「担当が未定」の文字を書けず、赤い帯だけが理由になる（AC-LEDGER-07）。
    expect(lane?.entries.map((entry) => entry.reservationId)).toEqual([RES.r1])
    expect(lane?.entries[0]?.isUnassigned).toBe(true)
    expect(view.lanes.filter((l) => l.kind === 'staff').flatMap((l) => l.entries)).toEqual([])
  })

  it('「担当が未定」の行は担当の行より後ろに来る', () => {
    const kinds = staffView().lanes.map((lane) => lane.kind)
    const unassigned = kinds.indexOf('unassigned')

    expect(unassigned).toBeGreaterThan(kinds.lastIndexOf('staff'))
  })

  it('「ご来店お待ち」の行を最下段に 1 行だけ置き、時間軸に載せない', () => {
    const lanes = staffView().lanes
    const walkin = lanes.filter((lane) => lane.kind === 'walkin')

    expect(walkin).toHaveLength(1)
    expect(lanes.at(-1)?.kind).toBe('walkin')
    expect(walkin[0]?.name).toBe('ご来店お待ち')
    // 時間軸に載らない全幅の帯なので、帯も塞がりも持たない。
    expect(walkin[0]?.entries).toEqual([])
    expect(walkin[0]?.blocks).toEqual([])
  })

  it('walk_ins がまだ無いので「ご来店お待ち」の人数は 0 になる', () => {
    const walkin = staffView().lanes.find((lane) => lane.kind === 'walkin')

    expect(walkin?.subtitle).toBe('0名')
  })

  it('staff_shifts の kind=break は「休憩」の LedgerBlock になる', () => {
    const lane = staffView().lanes.find((l) => l.id === STAFF.sato)

    expect(lane?.blocks).toEqual([
      { kind: 'break', startsAt: jst('13:00'), endsAt: jst('14:00'), label: '休憩' },
    ])
    // 休憩は担当ひとりのもの。同じ時刻に働いている担当の行には出さない。
    expect(staffView().lanes.find((l) => l.id === STAFF.takahashi)?.blocks).toEqual([])
  })
})

describe('設備別', () => {
  it('設備を並び順で並べる', () => {
    expect(resourceView().lanes.map((lane) => lane.name)).toEqual([
      '視力測定機 A',
      '視力測定機 B',
      '検査室 1',
      '相談カウンター 1',
      '相談カウンター 2',
    ])
  })

  it('1 予約が 2 つの設備を押さえていると、同じ reservationId の帯が 2 行に出る', () => {
    const lanes = resourceView().lanes
    const measureA = lanes.find((lane) => lane.id === EQUIPMENT.measureA)
    const counter2 = lanes.find((lane) => lane.id === EQUIPMENT.counter2)

    expect(entryOf(measureA, RES.r3)).toBeDefined()
    expect(entryOf(counter2, RES.r3)).toBeDefined()
    // 帯の幅はその設備を押さえている時間。予約まるごとの 11:00–12:00 ではない。
    expect(entryOf(measureA, RES.r3)?.endsAt).toBe(jst('11:30'))
    expect(entryOf(counter2, RES.r3)?.startsAt).toBe(jst('11:30'))
  })

  it('equipment_maintenance は「点検」の LedgerBlock になる', () => {
    const lane = resourceView().lanes.find((l) => l.id === EQUIPMENT.measureB)

    expect(lane?.blocks).toEqual([
      { kind: 'maintenance', startsAt: jst('11:30'), endsAt: jst('12:00'), label: '点検' },
    ])
  })

  it('予約も点検も無い設備の行は entries も blocks も空になる', () => {
    const lane = resourceView().lanes.find((l) => l.id === EQUIPMENT.room1)

    expect(lane?.entries).toEqual([])
    expect(lane?.blocks).toEqual([])
  })

  it('台帳に出さないと決めた設備は行にしない', () => {
    const equipment = board().equipment.map((row) =>
      row.id === EQUIPMENT.room1
        ? { ...row, isActive: false, ledgerDisplay: 'hide' as const }
        : row,
    )
    const lanes = buildLedgerView(board({ axis: 'resource', equipment })).lanes

    expect(lanes.map((lane) => lane.id)).not.toContain(EQUIPMENT.room1)
  })
})

describe('共通', () => {
  it('status が cancelled の予約は帯にしない', () => {
    const all = staffView().lanes.flatMap((lane) => lane.entries)
    const onEquipment = resourceView().lanes.flatMap((lane) => lane.entries)

    expect(all.map((entry) => entry.reservationId)).not.toContain(RES.cancelled)
    // 押さえの行が残っていても、設備の行に帯を出さない。
    expect(onEquipment.map((entry) => entry.reservationId)).not.toContain(RES.cancelled)
  })

  it('status が no_show の予約は帯にする（その日に起きた事実だから）', () => {
    const lane = staffView().lanes.find((l) => l.id === STAFF.sato)

    expect(entryOf(lane, RES.noShow)?.status).toBe('no_show')
  })

  it('帯の purposeLabel は visit_purposes.name_short を「・」で連ねる', () => {
    const lane = staffView().lanes.find((l) => l.id === STAFF.sato)

    expect(entryOf(lane, RES.r3)?.purposeLabel).toBe('新調相談・視力測定')
  })

  it('source が phone と counter の帯は出どころの語を持たない', () => {
    expect(bandSourceLabel('phone')).toBeNull()
    expect(bandSourceLabel('counter')).toBeNull()
    // 語は無くても、予約リストと詳細で出す 4 語は持っている。
    expect(SOURCE_LABELS.phone).toBe('お電話')
    expect(SOURCE_LABELS.counter).toBe('店頭')
  })

  it('source が web の帯は「Web予約」、walkin の帯は「ウォークイン」を持つ', () => {
    expect(bandSourceLabel('web')).toBe('Web予約')
    expect(bandSourceLabel('walkin')).toBe('ウォークイン')
    expect(SOURCE_LABELS.web).toBe('Web予約')
    expect(SOURCE_LABELS.walkin).toBe('ウォークイン')
  })

  it('他店舗の予約は 1 件も混ざらない', () => {
    const ids = staffView().lanes.flatMap((lane) => lane.entries.map((e) => e.reservationId))

    expect(ids).not.toContain(RES.otherStore)
    expect(resourceView().lanes.flatMap((lane) => lane.entries)).not.toContainEqual(
      expect.objectContaining({ reservationId: RES.otherStore }),
    )
  })

  it('この段階の台帳はお客様のお名前と来店回数を描かない', () => {
    const all = staffView().lanes.flatMap((lane) => lane.entries)

    expect(all).not.toHaveLength(0)
    expect(all.every((entry) => entry.customerName === null)).toBe(true)
    expect(all.every((entry) => entry.visitCount === null)).toBe(true)
  })

  it('定休日は行を 1 本も返さない（目盛りだけの空の格子を出させない）', () => {
    const view = staffView({ opensAt: null, closesAt: null, reservations: [] })

    expect(view.lanes).toEqual([])
    expect(view.opensAt).toBeNull()
  })

  it('組み立てた台帳は LedgerView の形をそのまま満たす', () => {
    expect(() => LedgerView.parse(staffView())).not.toThrow()
    expect(() => LedgerView.parse(resourceView())).not.toThrow()
  })
})

describe('リスト', () => {
  it('時刻順に平坦化し、同じ時刻は担当の並び順で並べる', () => {
    const rows = buildLedgerRows(board({ view: 'list' }))

    expect(rows.map((row) => row.reservationId)).toEqual([
      RES.r1,
      RES.r2,
      RES.r3,
      RES.r4,
      RES.r5,
      RES.r6,
      RES.noShow,
      RES.r7,
      RES.r8,
    ])
  })

  it('counts は all・upcoming・pendingReview の 3 つを返す', () => {
    expect(staffView().counts).toEqual({ all: 9, upcoming: 4, pendingReview: 1 })
  })

  it('upcoming は serverNow までに始まった行を落とす', () => {
    const rows = buildLedgerRows(board())
    const upcoming = filterLedgerRows(rows, 'upcoming', SERVER_NOW)

    // 11:08 ちょうどまでに始まった 5 件（10:00 / 10:30 / 11:00 の 2 件 / 11:02）が落ちる。
    expect(upcoming.map((row) => row.reservationId)).toEqual([RES.r6, RES.noShow, RES.r7, RES.r8])
    expect(upcoming).toHaveLength(staffView().counts.upcoming)
  })

  it('担当が未定の行は staffName を null にする', () => {
    const rows = buildLedgerRows(board())

    expect(rows.find((row) => row.reservationId === RES.r5)?.staffName).toBeNull()
    expect(rows.find((row) => row.reservationId === RES.r5)?.isUnassigned).toBe(true)
    expect(rows.find((row) => row.reservationId === RES.r3)?.staffName).toBe('佐藤 美咲')
  })

  it('確認待ちは Web 由来で担当が決まっていない行だけを残す', () => {
    const rows = filterLedgerRows(buildLedgerRows(board()), 'pending', SERVER_NOW)

    expect(rows.map((row) => row.reservationId)).toEqual([RES.r6])
    expect(rows).toHaveLength(staffView().counts.pendingReview)
  })

  it('すべては 1 行も落とさない', () => {
    const rows = buildLedgerRows(board())

    expect(filterLedgerRows(rows, 'all', SERVER_NOW)).toEqual(rows)
  })

  it('設備・場所別を選んでいてもリストの行は担当の名前を持つ', () => {
    // 並べ方は「タイムテーブルへ戻ったときの軸」として保つだけで、
    // 行の担当欄は設備名に化けない。
    const rows = buildLedgerRows(board({ axis: 'resource', view: 'list' }))

    expect(rows.find((row) => row.reservationId === RES.r3)?.staffName).toBe('佐藤 美咲')
    expect(rows).toHaveLength(9)
  })
})

describe('帯の位置', () => {
  it('表示窓は 10:00 起点の 30分刻み 14 列（420分）である', () => {
    expect(LEDGER_WINDOW_START).toBe('10:00')
    expect(LEDGER_SLOT_MINUTES).toBe(30)
    expect(LEDGER_WINDOW_SLOTS).toBe(14)
    expect(LEDGER_WINDOW_MINUTES).toBe(420)
  })

  it('10:00 の 30分の帯は先頭の 1 列を占める', () => {
    const place = placeOnLedgerWindow('2026-08-27', jst('10:00'), jst('10:30'))

    expect(place).toEqual({
      columnIndex: 0,
      columnSpan: 1,
      offsetRatio: 0,
      widthRatio: 30 / 420,
      isWithinWindow: true,
    })
  })

  it('11:00 の 60分の帯は 3 列目から 2 列にまたがる', () => {
    const place = placeOnLedgerWindow('2026-08-27', jst('11:00'), jst('12:00'))

    expect(place.columnIndex).toBe(2)
    expect(place.columnSpan).toBe(2)
    expect(place.offsetRatio).toBeCloseTo(60 / 420, 6)
  })

  it('刻みに載らない 11:02 の帯は、掛かっている列をすべて覆う', () => {
    const place = placeOnLedgerWindow('2026-08-27', jst('11:02'), jst('12:02'))

    expect(place.columnIndex).toBe(2)
    expect(place.columnSpan).toBe(3)
  })

  it('表示窓より後ろに始まる 17:00 の帯は窓の外だと分かる', () => {
    const place = placeOnLedgerWindow('2026-08-27', jst('17:00'), jst('17:30'))

    expect(place.isWithinWindow).toBe(false)
    expect(place.columnIndex).toBe(14)
    expect(place.offsetRatio).toBe(1)
  })

  it('開店が早い日の 9:30 の帯は窓の左へはみ出す', () => {
    const place = placeOnLedgerWindow('2026-08-27', jst('09:30'), jst('10:30'))

    expect(place.columnIndex).toBe(-1)
    expect(place.offsetRatio).toBeCloseTo(-30 / 420, 6)
    // 10:00 以降に掛かっているので窓の中に描く分がある。
    expect(place.isWithinWindow).toBe(true)
  })
})

describe('現在時刻の線', () => {
  it('serverNow が JST 11:08 のとき、線は表示窓の左から 16.19% に立つ', () => {
    const marker = nowMarker('2026-08-27', SERVER_NOW)

    expect(marker.clock).toBe('11:08')
    expect(marker.isToday).toBe(true)
    expect(marker.ratio).toBeCloseTo(0.1619, 4)
    expect(marker.outside).toBeNull()
  })

  it('表示中の日付が本日でないときは線も札も出さない', () => {
    const marker = nowMarker('2026-08-28', SERVER_NOW)

    expect(marker.isToday).toBe(false)
    expect(marker.ratio).toBeNull()
  })

  it('開店前は線を引かず、窓の前にいることを添える', () => {
    const marker = nowMarker('2026-08-27', new Date('2026-08-27T00:42:00.000Z'))

    expect(marker.clock).toBe('09:42')
    expect(marker.ratio).toBeNull()
    expect(marker.outside).toBe('before')
  })

  it('表示窓の終わり 17:00 ちょうどは、もう窓の後ろである', () => {
    const marker = nowMarker('2026-08-27', new Date('2026-08-27T08:00:00.000Z'))

    expect(marker.clock).toBe('17:00')
    expect(marker.ratio).toBeNull()
    expect(marker.outside).toBe('after')
  })

  it('端末の時計を 1 時間進めても、渡した serverNow の位置しか返さない', () => {
    const before = nowMarker('2026-08-27', SERVER_NOW)
    const shifted = new Date(SERVER_NOW.getTime() + 60 * 60_000)

    expect(nowMarker('2026-08-27', SERVER_NOW)).toEqual(before)
    expect(nowMarker('2026-08-27', shifted).clock).toBe('12:08')
  })
})

describe('出どころの色', () => {
  it('4 値を 3 系統の色にまとめる', () => {
    expect(bandTone('phone')).toBe('pine')
    expect(bandTone('counter')).toBe('pine')
    expect(bandTone('web')).toBe('web')
    expect(bandTone('walkin')).toBe('walkin')
  })
})
