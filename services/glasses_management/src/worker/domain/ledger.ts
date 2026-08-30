/**
 * 予約台帳の行組み立て。読み出した行を、担当者別・設備別・時間順の 3 通りに並べ替える。
 *
 * ここに置くのは**純関数だけ**である。D1 も `Date.now()` も触らず、`serverNow` を
 * 含むすべての時刻を引数で受ける。現在時刻の線を端末の時計から引くと、iPad の時計が
 * ずれた日に台帳が黙って嘘をつく（`design/06-use-cases.md` IDX-LEDGER-06）。
 *
 * 時刻は 2 通りで持つ。表に入っている予約・点検は ISO8601（UTC）、勤務と営業時間は
 * `HH:MM`（JST の壁時計）である。混ぜないよう、壁時計は `jstIso()` で必ず ISO へ直してから
 * `LedgerBlock` に載せる。区間は半開 `[startsAt, endsAt)`。
 *
 * この面が描かないもの:
 * - お客様のお名前と来店回数（`customers` は `007-customer-records`。常に null）
 * - 「ご来店お待ち」の人数（`walk_ins` は `008-reception-and-walkin`。常に 0名 の器）
 * - 店舗の受付を止める帯（`store_blackout_windows` は空き枠エンジンだけが読む。
 *   台帳の灰帯は担当ひとりの休憩であって、店舗の停止帯ではない）
 */
import type {
  LedgerAxis,
  LedgerBlock,
  LedgerEntry,
  LedgerFilter,
  LedgerLane,
  LedgerView,
  LedgerViewMode,
  LocalDate,
  LocalTime,
  ReservationSource,
  ReservationStatus,
} from '@app/contracts'
import { toJstDateString } from '@app/shared'

/* --- 表示窓の決め --------------------------------------------------------- */

/**
 * 台帳の表示窓は 10:00 起点の 30分刻み 14 列（＝420分、10:00–17:00）。
 * 承認済みモック 3 面がいずれもこの 14 列で、営業時間が長い日は台帳の中だけを
 * 横スクロールさせる（AC-LEDGER-02）。画面側の寸法は `src/web/ledger/metrics.ts`
 * が持ち、**時間の割り付けはこの 4 つだけを正本にする**。
 */
export const LEDGER_WINDOW_START: LocalTime = '10:00'
export const LEDGER_SLOT_MINUTES = 30
export const LEDGER_WINDOW_SLOTS = 14
export const LEDGER_WINDOW_MINUTES = LEDGER_SLOT_MINUTES * LEDGER_WINDOW_SLOTS

/* --- 読み出した行の形 ----------------------------------------------------- */

/** ご予約 1 件。お名前と来店回数は `007-customer-records` が足すのでここに無い。 */
export type LedgerReservationRow = {
  id: string
  storeId: string
  source: ReservationSource
  status: ReservationStatus
  /** ISO8601（UTC）。 */
  startsAt: string
  /** ISO8601（UTC）。片付け時間は含まない。 */
  endsAt: string
}

/** ご用件 1 件（`reservation_purposes` × `visit_purposes`）。帯には短い名前を出す。 */
export type LedgerPurposeRow = {
  reservationId: string
  /** `visit_purposes.name_short`（1〜5 文字）。 */
  nameShort: string
  sortOrder: number
}

/** 担当・設備の押さえ 1 行。`targetId` が null の行も枠を消費する（I-05）。 */
export type LedgerAssignmentRow = {
  reservationId: string
  kind: 'staff' | 'equipment'
  targetId: string | null
  /** ISO8601（UTC）。 */
  startsAt: string
  /** ISO8601（UTC）。 */
  endsAt: string
}

/** 担当 1 人（`staff`）。並び順がそのまま台帳の行順になる。 */
export type LedgerStaffRow = {
  id: string
  displayName: string
  /** 行見出しの下に出る小さい文字（「店長」）。 */
  jobLabel: string | null
  sortOrder: number
}

/** その日の勤務・休憩 1 本（`staff_shifts`）。時刻は `HH:MM`（JST の壁時計）。 */
export type LedgerShiftRow = {
  staffId: string
  kind: 'work' | 'break'
  startsAt: string
  endsAt: string
}

/** 設備・場所 1 台（`equipment`）。 */
export type LedgerEquipmentRow = {
  id: string
  name: string
  /** 行見出しの下に出る小さい文字（「測定」）。 */
  roleLabel: string | null
  sortOrder: number
  isActive: boolean
  /** 止めている設備を台帳に残すか消すか。効くのは止めている設備だけ。 */
  ledgerDisplay: 'grey' | 'hide'
}

/** 設備の点検 1 本（`equipment_maintenance`）。時刻は ISO8601（UTC）。 */
export type LedgerMaintenanceRow = {
  equipmentId: string
  startsAt: string
  endsAt: string
  note: string | null
}

/**
 * 台帳 1 日分の材料。**すべて呼び出し側が読んで渡す**（この関数は D1 を触らない）。
 * `axis` と `view` は別の指定で、4 通りすべてが有効な組み合わせである。
 */
export type LedgerInput = {
  /** JST の暦日。 */
  date: LocalDate
  axis: LedgerAxis
  view: LedgerViewMode
  storeId: string
  /** 定休日・臨時休業は null。行を 1 本も返さない合図でもある。 */
  opensAt: LocalTime | null
  closesAt: LocalTime | null
  slotMinutes: number
  reservations: LedgerReservationRow[]
  purposes: LedgerPurposeRow[]
  assignments: LedgerAssignmentRow[]
  staff: LedgerStaffRow[]
  shifts: LedgerShiftRow[]
  equipment: LedgerEquipmentRow[]
  maintenance: LedgerMaintenanceRow[]
  /** 当日（JST）の `walk_ins.status='waiting'` の件数。`walk_ins` は P5 なので既定 0。 */
  waitingCount?: number
  /** 応答の `serverNow`。**この関数は `Date.now()` を 1 度も呼ばない。** */
  serverNow: Date
}

/** 予約リストの 1 行。`staffName` が null の行は「決めてください」と描く。 */
export type LedgerListRow = {
  reservationId: string
  startsAt: string
  endsAt: string
  purposeLabel: string
  source: ReservationSource
  status: ReservationStatus
  staffName: string | null
  isUnassigned: boolean
}

/* --- 出どころ ------------------------------------------------------------- */

/** 出どころの表示語は 4 語。予約リストと詳細でこの語をそのまま出す。 */
export const SOURCE_LABELS: Record<ReservationSource, string> = {
  phone: 'お電話',
  counter: '店頭',
  web: 'Web予約',
  walkin: 'ウォークイン',
}

/** 帯の色は 3 系統（緑＝お電話・店頭／青＝Web／茶＝ウォークイン）。 */
export type LedgerBandTone = 'pine' | 'web' | 'walkin'

/** 4 値の出どころを 3 系統の色にまとめる。色は `theme.css` のトークン名に対応する。 */
export function bandTone(source: ReservationSource): LedgerBandTone {
  if (source === 'web') return 'web'
  if (source === 'walkin') return 'walkin'
  return 'pine'
}

/**
 * 帯の中に書く出どころの語。**緑の帯は語を持たない**（既定なので色に意味が乗らない）。
 * お電話と店頭の別は予約リストと詳細で `SOURCE_LABELS` として文字にする（AC-LEDGER-05）。
 */
export function bandSourceLabel(source: ReservationSource): string | null {
  const tone = bandTone(source)
  return tone === 'pine' ? null : SOURCE_LABELS[source]
}

/* --- 表示窓への割り付け --------------------------------------------------- */

/** 帯 1 本の置き場所。列は 0 = 10:00 で、負の値と 14 以上は表示窓の外を指す。 */
export type LedgerPlacement = {
  columnIndex: number
  /** またぐ列数。1 以上。 */
  columnSpan: number
  /** 表示窓（420分）に対する左端の比。1 は窓の右端。 */
  offsetRatio: number
  /** 同じ比で測った幅。 */
  widthRatio: number
  /** 表示窓に少しでも掛かるか。false の帯は横スクロールしないと見えない。 */
  isWithinWindow: boolean
}

/** 現在時刻の線と札。線は `ratio` が非 null のときだけ引く。 */
export type LedgerNowMarker = {
  /** 札に出す JST の壁時計（「現在 11:08」）。 */
  clock: LocalTime
  /** 表示窓に対する位置（0〜1）。窓の外・本日でない日は null で、線を引かない。 */
  ratio: number | null
  /** 表示中の日付が本日か。 */
  isToday: boolean
  /** 窓のどちら側に外れているか。中に居るときは null。 */
  outside: 'before' | 'after' | null
}

const MS_PER_MINUTE = 60_000
const JST_OFFSET_MS = 9 * 60 * MS_PER_MINUTE

/* --- 契約の上限で切る ------------------------------------------------------ */

/**
 * `LedgerEntry.purposeLabel`（30 文字）。`visit_purposes.name_short` は 1〜5 文字と
 * 決めてあるので 5 件で 29 文字に収まる**はず**だが、D1 に CHECK は無い。
 * 上限を越えた文字列をそのまま契約へ通すと `LedgerView.parse` が例外を投げ、
 * **帯 1 本の綻びでその店のその日の台帳がまるごと 500 になる**（受付は原因も分からない）。
 */
const PURPOSE_LABEL_MAX = 30
/** `LedgerLane.name` / `LedgerLane.subtitle`（40 文字）。 */
const LANE_TEXT_MAX = 40
/** 契約の上限で切る。切るのは描くためで、元の値は詳細（`ReservationDetail`）が持つ。 */
function clamp(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max)
}

/** JST の暦日と壁時計を UTC の ISO8601 に直す。`2026-08-27` の `10:00` は `01:00Z`。 */
function jstIso(date: LocalDate, time: string): string {
  return new Date(Date.parse(`${date}T${time}:00.000Z`) - JST_OFFSET_MS).toISOString()
}

/** その日の表示窓が始まる瞬間（JST 10:00）。 */
function windowStartMs(date: LocalDate): number {
  return Date.parse(`${date}T${LEDGER_WINDOW_START}:00.000Z`) - JST_OFFSET_MS
}

/** JST の壁時計 `HH:MM`。時は必ず 2 桁にする（`9:42` を作らない）。 */
function jstClock(at: Date): LocalTime {
  const shifted = new Date(at.getTime() + JST_OFFSET_MS)
  const hours = String(shifted.getUTCHours()).padStart(2, '0')
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * 帯 1 本を表示窓の格子に載せる。**窓の外へ出る帯も位置を返す**
 * （営業時間が 14 列より長い日は台帳の中だけを横スクロールさせるので、
 * 窓に入らないという理由で帯を捨てると、17:00 のご予約が台帳から消える）。
 */
export function placeOnLedgerWindow(
  date: LocalDate,
  startsAt: string,
  endsAt: string,
): LedgerPlacement {
  const origin = windowStartMs(date)
  const from = (Date.parse(startsAt) - origin) / MS_PER_MINUTE
  const to = (Date.parse(endsAt) - origin) / MS_PER_MINUTE
  const columnIndex = Math.floor(from / LEDGER_SLOT_MINUTES)

  return {
    columnIndex,
    columnSpan: Math.max(1, Math.ceil(to / LEDGER_SLOT_MINUTES) - columnIndex),
    offsetRatio: from / LEDGER_WINDOW_MINUTES,
    widthRatio: (to - from) / LEDGER_WINDOW_MINUTES,
    isWithinWindow: from < LEDGER_WINDOW_MINUTES && to > 0,
  }
}

/**
 * 現在時刻の線と札を `serverNow` から出す。**端末の時計を読まない。**
 * 表示中の日付が本日でなければ線も札も出さず、窓の外なら線を引かずに札だけを出す
 * （「現在 09:42（営業時間の外）」。AC-LEDGER-03）。
 */
export function nowMarker(date: LocalDate, serverNow: Date): LedgerNowMarker {
  const clock = jstClock(serverNow)
  if (toJstDateString(serverNow) !== date) {
    return { clock, ratio: null, isToday: false, outside: null }
  }

  const minutes = (serverNow.getTime() - windowStartMs(date)) / MS_PER_MINUTE
  if (minutes < 0) return { clock, ratio: null, isToday: true, outside: 'before' }
  if (minutes >= LEDGER_WINDOW_MINUTES) {
    return { clock, ratio: null, isToday: true, outside: 'after' }
  }
  return { clock, ratio: minutes / LEDGER_WINDOW_MINUTES, isToday: true, outside: null }
}

/* --- 台帳の行 ------------------------------------------------------------- */

/** 帯にできるご予約 1 件。読み出した行を 1 か所で突き合わせた結果。 */
type DrawnReservation = {
  row: LedgerReservationRow
  purposeLabel: string
  /** 担当の割当先。null は「担当が未定」。 */
  staffId: string | null
  isUnassigned: boolean
}

/** 開始の早い順。同じ時刻は終わりの早い順にして、並びを実行ごとに揺らさない。 */
function byStart<T extends { startsAt: string; endsAt: string }>(a: T, b: T): number {
  return a.startsAt === b.startsAt
    ? a.endsAt.localeCompare(b.endsAt)
    : a.startsAt < b.startsAt
      ? -1
      : 1
}

/**
 * 帯にするご予約を選び、目的と担当を突き合わせる。
 * - 他店舗・他の日のご予約は 1 件も混ぜない（読み出し側の絞り込みを信用しない）。
 * - `cancelled` は帯にしない。`no_show` は**帯にする**（その日に起きた事実だから）。
 */
function drawnReservations(input: LedgerInput): DrawnReservation[] {
  const labels = new Map<string, LedgerPurposeRow[]>()
  for (const purpose of input.purposes) {
    const lines = labels.get(purpose.reservationId) ?? []
    lines.push(purpose)
    labels.set(purpose.reservationId, lines)
  }

  const staffAssignments = new Map<string, LedgerAssignmentRow>()
  for (const assignment of input.assignments) {
    if (assignment.kind === 'staff') staffAssignments.set(assignment.reservationId, assignment)
  }
  // この店舗のこの日に行を出せる担当。ここに居ない担当を指した押さえは、
  // 行が無いので帯を置く先が「担当が未定」しか無い。
  const known = new Set(input.staff.map((member) => member.id))

  return (
    input.reservations
      .filter((row) => row.storeId === input.storeId)
      .filter((row) => row.status !== 'cancelled')
      .filter((row) => toJstDateString(row.startsAt) === input.date)
      // 区間が潰れているご予約（`ends_at <= starts_at`）は帯として描けない。D1 に CHECK は
      // 無いので、1 件の綻びで台帳がまるごと 500 にならないよう、その 1 本だけを落とす。
      .filter((row) => Date.parse(row.endsAt) > Date.parse(row.startsAt))
      .sort(byStart)
      .map((row) => {
        const assignment = staffAssignments.get(row.id)
        const targetId = assignment?.targetId ?? null
        // `kind='staff'` の行を持たないご予約は作れない（I-05）が、万一欠けていても
        // 台帳から消さず「担当が未定」として拾う。行を出せない担当（消えた・別店舗）を
        // 指した押さえも同じ扱いにする。**「担当が未定」の行に置く帯は必ず印を持つ** ——
        // 印が無いと赤い帯だけが理由で、色にしか意味が乗らない（AC-LEDGER-07）。
        const isUnassigned = targetId === null || !known.has(targetId)
        return {
          row,
          purposeLabel: clamp(
            (labels.get(row.id) ?? [])
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((line) => line.nameShort)
              .join('・'),
            PURPOSE_LABEL_MAX,
          ),
          staffId: isUnassigned ? null : targetId,
          isUnassigned,
        }
      })
  )
}

/** 帯 1 本。時刻はその行が押さえている区間で、お名前と来店回数はまだ描かない。 */
function toEntry(drawn: DrawnReservation, startsAt: string, endsAt: string): LedgerEntry {
  return {
    reservationId: drawn.row.id,
    startsAt,
    endsAt,
    customerName: null,
    visitCount: null,
    purposeLabel: drawn.purposeLabel,
    source: drawn.row.source,
    status: drawn.row.status,
    isUnassigned: drawn.isUnassigned,
  }
}

/**
 * 担当軸の行。当日 `staff_shifts` に `kind='work'` を持つ担当を並び順に並べ、
 * 勤務が無くてもその日のご予約を持つ担当は行を出す（帯を台帳から消さないため）。
 */
function staffLanes(input: LedgerInput, drawn: DrawnReservation[]): LedgerLane[] {
  const working = new Set(
    input.shifts.filter((shift) => shift.kind === 'work').map((shift) => shift.staffId),
  )
  const assigned = new Set(drawn.map((item) => item.staffId).filter((id) => id !== null))

  const lanes: LedgerLane[] = input.staff
    .filter((member) => working.has(member.id) || assigned.has(member.id))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((member) => ({
      kind: 'staff' as const,
      id: member.id,
      name: clamp(member.displayName, LANE_TEXT_MAX),
      subtitle: clamp(member.jobLabel ?? '', LANE_TEXT_MAX),
      // 担当の行の帯はご予約まるごとの区間で描く（担当は最初から最後まで付く）。
      entries: drawn
        .filter((item) => item.staffId === member.id)
        .map((item) => toEntry(item, item.row.startsAt, item.row.endsAt)),
      blocks: input.shifts
        .filter((shift) => shift.staffId === member.id && shift.kind === 'break')
        .filter((shift) => shift.endsAt > shift.startsAt)
        .map(
          (shift): LedgerBlock => ({
            kind: 'break',
            startsAt: jstIso(input.date, shift.startsAt),
            endsAt: jstIso(input.date, shift.endsAt),
            label: '休憩',
          }),
        )
        .sort(byStart),
    }))

  const placed = new Set(lanes.map((lane) => lane.id))

  return [
    ...lanes,
    // 「担当が未定」は担当の行より後ろに置く。担当の行に載せられなかった帯もここで拾う
    // （行を出せない担当を指した押さえは `drawnReservations` が既に未定へ倒している）。
    {
      kind: 'unassigned',
      id: null,
      name: '担当が未定',
      subtitle: '',
      entries: drawn
        .filter((item) => item.staffId === null || !placed.has(item.staffId))
        .map((item) => toEntry(item, item.row.startsAt, item.row.endsAt)),
      blocks: [],
    },
    // 「ご来店お待ち」は時間軸に載せない全幅の帯なので、帯も塞がりも持たない。
    {
      kind: 'walkin',
      id: null,
      name: 'ご来店お待ち',
      subtitle: `${input.waitingCount ?? 0}名`,
      entries: [],
      blocks: [],
    },
  ]
}

/**
 * 設備軸の行。**1 予約が 2 台を押さえていれば同じ `reservationId` の帯が 2 行に出る**
 * （AC-LEDGER-10）。帯の区間はその設備を押さえている時間で、ご予約まるごとではない
 * （15:30–16:00 は測定機、16:00–16:30 は相談カウンターという押さえ方があるため）。
 */
function equipmentLanes(input: LedgerInput, drawn: DrawnReservation[]): LedgerLane[] {
  const byId = new Map(drawn.map((item) => [item.row.id, item]))

  return input.equipment
    .filter((unit) => unit.isActive || unit.ledgerDisplay !== 'hide')
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((unit) => ({
      kind: 'equipment' as const,
      id: unit.id,
      name: clamp(unit.name, LANE_TEXT_MAX),
      subtitle: clamp(unit.roleLabel ?? '', LANE_TEXT_MAX),
      entries: input.assignments
        .filter((assignment) => assignment.kind === 'equipment' && assignment.targetId === unit.id)
        // 潰れた押さえは帯にできない（`drawnReservations` と同じ理由で 1 本だけ落とす）。
        .filter((assignment) => Date.parse(assignment.endsAt) > Date.parse(assignment.startsAt))
        .sort(byStart)
        // 取り消したご予約の押さえは行が残っていることがある。帯にはしない。
        .flatMap((assignment) => {
          const item = byId.get(assignment.reservationId)
          return item === undefined ? [] : [toEntry(item, assignment.startsAt, assignment.endsAt)]
        }),
      blocks: input.maintenance
        .filter((row) => row.equipmentId === unit.id)
        .filter((row) => Date.parse(row.endsAt) > Date.parse(row.startsAt))
        .sort(byStart)
        .map(
          (row): LedgerBlock => ({
            kind: 'maintenance',
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            // `equipment_maintenance.note` は 60 文字あり、30 文字の label に入らない。
            // 帯に出すのは種別の 1 語だけにして、注記は詳細で読ませる。
            label: '点検',
          }),
        ),
    }))
}

/**
 * 台帳 1 日分を組み立てる。
 *
 * `view='list'` のときは **`axis` によらず担当軸の行を返す**。予約リストの「担当」欄と
 * 「決めてください」は担当の割当からしか出せないので、設備の行を平坦化しても列が埋まらない。
 * `axis` は応答にそのまま載せ、タイムテーブルへ戻ったときに同じ軸へ復帰させる。
 */
export function buildLedgerView(input: LedgerInput): LedgerView {
  const serverNowMs = input.serverNow.getTime()
  const laneAxis: LedgerAxis = input.view === 'list' ? 'staff' : input.axis
  // 受け付けを止めた日（定休日・臨時休業・店舗まるごとの停止）は行を 1 本も出さない
  // ので、**札の件数も 0 にする**（AC-LEDGER-22）。行が 0 本なのに「すべて 5件」と
  // 出すと、札の数字と行数が食い違い、どちらが正しいのか画面から判断できない。
  const isOpen = input.opensAt !== null && input.closesAt !== null
  const drawn = isOpen ? drawnReservations(input) : []

  return {
    date: input.date,
    axis: input.axis,
    view: input.view,
    opensAt: input.opensAt,
    closesAt: input.closesAt,
    slotMinutes: input.slotMinutes,
    // 定休日・臨時休業は目盛りだけの空の格子を出さない（AC-LEDGER-22）。
    lanes: !isOpen
      ? []
      : laneAxis === 'resource'
        ? equipmentLanes(input, drawn)
        : staffLanes(input, drawn),
    counts: {
      all: drawn.length,
      upcoming: drawn.filter((item) => Date.parse(item.row.startsAt) > serverNowMs).length,
      pendingReview: drawn.filter(isPendingReview).length,
    },
    serverNow: input.serverNow.toISOString(),
  }
}

/**
 * 予約リストの行。担当軸の行を時刻順に平坦化し、同じ時刻は担当の並び順で並べる。
 * 「ご来店お待ち」は時間軸に載らないので入らない。
 */
export function buildLedgerRows(input: LedgerInput): LedgerListRow[] {
  const lanes = staffLanes(input, drawnReservations(input)).filter((lane) => lane.kind !== 'walkin')

  return lanes
    .flatMap((lane, laneIndex) =>
      lane.entries.map((entry) => ({
        laneIndex,
        row: {
          reservationId: entry.reservationId,
          startsAt: entry.startsAt,
          endsAt: entry.endsAt,
          purposeLabel: entry.purposeLabel,
          source: entry.source,
          status: entry.status,
          staffName: lane.kind === 'staff' ? lane.name : null,
          isUnassigned: entry.isUnassigned,
        },
      })),
    )
    .sort((a, b) =>
      a.row.startsAt === b.row.startsAt
        ? a.laneIndex - b.laneIndex
        : a.row.startsAt < b.row.startsAt
          ? -1
          : 1,
    )
    .map((item) => item.row)
}

/** Web から入って、まだ担当が決まっていないご予約が「確認待ち」の中身になる。 */
function isPendingReview(item: {
  row: { source: ReservationSource; status: ReservationStatus }
  isUnassigned: boolean
}): boolean {
  return item.row.source === 'web' && item.row.status === 'confirmed' && item.isUnassigned
}

/**
 * 予約リストの絞り込み。件数は応答の `counts` と同じ数え方にする
 * （札の数字と行数が食い違うと、どちらが正しいのか画面から判断できない）。
 * `pending` の中身は `web_bookings` を作る `011-web-booking` まで、
 * 「Web から入って担当が未定」を器として数える。
 */
export function filterLedgerRows(
  rows: LedgerListRow[],
  filter: LedgerFilter,
  serverNow: Date,
): LedgerListRow[] {
  if (filter === 'upcoming') {
    const nowMs = serverNow.getTime()
    return rows.filter((row) => Date.parse(row.startsAt) > nowMs)
  }
  if (filter === 'pending') {
    return rows.filter((row) => isPendingReview({ row, isUnassigned: row.isUnassigned }))
  }
  return rows
}
