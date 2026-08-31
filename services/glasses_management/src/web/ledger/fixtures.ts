import type { LedgerEntry, LedgerLane, LedgerView, LocalDate } from '@app/contracts'

/*
 * 台帳の作り置き。承認済みモック docs/frontend/mockups/eyex/images/LEDGER-STAFF.png と
 * LEDGER-RESOURCE.png の 2026年8月27日（木）銀座店を、P2 が描ける範囲で写したもの。
 *
 * P2 が描けないもの（お客様のお名前・来店回数・お待ちの人数）は null と 0 のままにする。
 * 時刻はすべて JST の壁時計で書き、`at()` が UTC の ISO8601 へ直す。
 */

export const LEDGER_DATE: LocalDate = '2026-08-27'
/** JST 11:08。現在時刻の線は表示窓の左から 68分 ÷ 420分 ＝ 16.19% に来る。 */
export const SERVER_NOW = '2026-08-27T02:08:00.000Z'
export const STORE_ID = '11111111-2222-4333-8444-555555555555'

/** その日の JST の壁時計を UTC の ISO8601 に直す。10:00 は 01:00Z。 */
export function at(clock: string, date: LocalDate = LEDGER_DATE): string {
  return new Date(Date.parse(`${date}T${clock}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()
}

const RESERVATION = {
  sato1100: 'a0000000-0000-4000-8000-000000000003',
  sato1400: 'a0000000-0000-4000-8000-000000000008',
  takahashi1000: 'a0000000-0000-4000-8000-000000000001',
  takahashi1300: 'a0000000-0000-4000-8000-000000000007',
  nakamura1030: 'a0000000-0000-4000-8000-000000000002',
  nakamura1500: 'a0000000-0000-4000-8000-000000000009',
  watanabe1100: 'a0000000-0000-4000-8000-000000000004',
  unassigned1102: 'a0000000-0000-4000-8000-000000000005',
  unassigned1300: 'a0000000-0000-4000-8000-000000000006',
  unassigned1530: 'a0000000-0000-4000-8000-000000000010',
} as const

export const RESERVATION_IDS = RESERVATION

function entry(
  reservationId: string,
  start: string,
  end: string,
  purposeLabel: string,
  source: LedgerEntry['source'],
  status: LedgerEntry['status'] = 'confirmed',
  isUnassigned = false,
): LedgerEntry {
  return {
    reservationId,
    startsAt: at(start),
    endsAt: at(end),
    customerName: null,
    visitCount: null,
    purposeLabel,
    source,
    status,
    isUnassigned,
  }
}

const STAFF_LANES: LedgerLane[] = [
  {
    kind: 'staff',
    id: 'b0000000-0000-4000-8000-000000000001',
    name: '佐藤 美咲',
    subtitle: '視力測定・加工',
    entries: [
      entry(RESERVATION.sato1100, '11:00', '12:00', '新調相談・視力測定', 'phone'),
      entry(RESERVATION.sato1400, '14:00', '14:20', '受け取り', 'phone'),
    ],
    blocks: [{ kind: 'break', startsAt: at('13:00'), endsAt: at('14:00'), label: '休憩' }],
  },
  {
    kind: 'staff',
    id: 'b0000000-0000-4000-8000-000000000002',
    name: '高橋 健',
    subtitle: 'フィッティング',
    entries: [
      entry(RESERVATION.takahashi1000, '10:00', '10:30', '調整', 'phone', 'arrived'),
      entry(RESERVATION.takahashi1300, '13:00', '14:00', '調整', 'phone'),
    ],
    blocks: [],
  },
  {
    kind: 'staff',
    id: 'b0000000-0000-4000-8000-000000000003',
    name: '中村 彩',
    subtitle: '販売・受付',
    entries: [
      entry(RESERVATION.nakamura1030, '10:30', '11:30', '視力測定', 'web', 'arrived'),
      entry(RESERVATION.nakamura1500, '15:00', '16:00', '新調相談', 'counter'),
    ],
    blocks: [],
  },
  {
    kind: 'staff',
    id: 'b0000000-0000-4000-8000-000000000004',
    name: '渡辺 由紀',
    subtitle: '販売・受付',
    entries: [entry(RESERVATION.watanabe1100, '11:00', '11:30', '視力測定', 'walkin', 'arrived')],
    blocks: [],
  },
  {
    kind: 'unassigned',
    id: null,
    name: '担当が未定',
    subtitle: '',
    entries: [
      entry(RESERVATION.unassigned1102, '11:02', '12:02', '新調相談', 'walkin', 'confirmed', true),
      entry(RESERVATION.unassigned1300, '13:00', '13:20', '調整', 'web', 'confirmed', true),
      entry(RESERVATION.unassigned1530, '15:30', '16:30', '視力測定', 'phone', 'confirmed', true),
    ],
    blocks: [],
  },
  { kind: 'walkin', id: null, name: 'ご来店お待ち', subtitle: '0名', entries: [], blocks: [] },
]

const EQUIPMENT_LANES: LedgerLane[] = [
  {
    kind: 'equipment',
    id: 'c0000000-0000-4000-8000-000000000001',
    name: '視力測定機 A',
    subtitle: '視力測定',
    entries: [entry(RESERVATION.sato1100, '11:00', '12:00', '新調相談・視力測定', 'phone')],
    blocks: [],
  },
  {
    kind: 'equipment',
    id: 'c0000000-0000-4000-8000-000000000002',
    name: '視力測定機 B',
    subtitle: '視力測定',
    entries: [entry(RESERVATION.nakamura1030, '10:30', '11:30', '視力測定', 'web', 'arrived')],
    blocks: [{ kind: 'maintenance', startsAt: at('11:30'), endsAt: at('12:00'), label: '点検' }],
  },
  {
    kind: 'equipment',
    id: 'c0000000-0000-4000-8000-000000000003',
    name: '検査室 1',
    subtitle: '精密検査',
    entries: [],
    blocks: [],
  },
  {
    kind: 'equipment',
    id: 'c0000000-0000-4000-8000-000000000004',
    name: '相談カウンター 1',
    subtitle: '接客・ご相談',
    entries: [
      entry(RESERVATION.unassigned1300, '13:00', '13:20', '調整', 'web', 'confirmed', true),
    ],
    blocks: [],
  },
  {
    kind: 'equipment',
    id: 'c0000000-0000-4000-8000-000000000005',
    name: '相談カウンター 2',
    subtitle: '接客・ご相談',
    entries: [entry(RESERVATION.sato1100, '11:00', '12:00', '新調相談・視力測定', 'phone')],
    blocks: [],
  },
]

/** 担当者別のタイムテーブル 1 日分。営業時間は 10:00–17:00 で表示窓とちょうど同じ。 */
export function staffView(overrides: Partial<LedgerView> = {}): LedgerView {
  return {
    date: LEDGER_DATE,
    axis: 'staff',
    view: 'timetable',
    opensAt: '10:00',
    closesAt: '17:00',
    slotMinutes: 30,
    lanes: STAFF_LANES,
    counts: { all: 10, upcoming: 6, pendingReview: 1 },
    // 受付パネル（LEDGER-WALKIN）が props で受ける 3 欄。モックの
    // 「いまお待ち 2名」「ウォークイン 005」に合わせる。目安は空き枠エンジンの
    // 結果からしか出さないので、台帳の応答では null のまま置く。
    walkinWaitingCount: 2,
    estimatedWaitMinutes: null,
    nextTicketNo: 5,
    serverNow: SERVER_NOW,
    ...overrides,
  }
}

/** 設備・場所別。縦軸だけが入れ替わり、日付と表示のかたちは変わらない。 */
export function resourceView(overrides: Partial<LedgerView> = {}): LedgerView {
  return staffView({ axis: 'resource', lanes: EQUIPMENT_LANES, ...overrides })
}

/** 定休日。行を 1 本も持たず、営業時間が null になる。 */
export function closedView(date: LocalDate = '2026-09-01'): LedgerView {
  return staffView({
    date,
    opensAt: null,
    closesAt: null,
    lanes: [],
    counts: { all: 0, upcoming: 0, pendingReview: 0 },
  })
}
