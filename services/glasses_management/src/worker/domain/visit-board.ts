/**
 * 来店受付ボードの組み立て（RECEPTION-JOURNEY）。
 *
 * ここに置くのは**純関数だけ**である。D1 も `Date.now()` も触らず、読み出した行と
 * `now` をすべて引数で受ける。盤面は `visit_events` の**追記だけ**の並びから毎回組み立てる
 * （「いまの工程」を 1 列で上書きすると経緯が消え、分析の元にならない）。
 *
 * 盤面の位置は **`BOARD_STAGES` の添字**で決める。`VisitStage` の宣言順
 * （`received` / `waiting` / `measuring` / `consulting` / …）から作ると、視力測定 が ご相談 の
 * 左に来る。`waiting` と `left` は列を持たない — 前者はセルの状態「お待たせ中」、
 * 後者はご来店中から降ろすための記録である。
 *
 * 「済みました」に出す時刻は**その工程が始まった時刻**である。承認済みモックの 伊藤 健 様
 * （受付 10:42 / ご相談 10:52 / レンズ・お会計 11:01 / お渡し 対応中 11:04〜）は
 * 終了時刻（＝次の工程の開始時刻）では 1 つも再現できず、開始時刻でちょうど一致する。
 */

import type {
  LocalDate,
  VisitBoard,
  VisitBoardCell,
  VisitBoardRow,
  VisitStage,
} from '@app/contracts'
import type { MaintenanceBand, StaffShiftBand } from './availability'
import { subjectDisplayName, WAITING_TOO_LONG_MINUTES, waitedMinutes } from './walkin'

/* --- 列の並び ------------------------------------------------------------- */

/**
 * 盤面の 6 列。**画面の左から右の順**（受付 → ご相談 → フレーム選び → 視力測定 →
 * レンズ・お会計 → お渡し）で、UI（`src/web/reception/stages.ts`）と共有する正本である。
 */
export const BOARD_STAGES = [
  'received',
  'consulting',
  'fitting',
  'measuring',
  'checkout',
  'handover',
] as const satisfies readonly VisitStage[]

/** 盤面に列を持つ工程。 */
type BoardStage = (typeof BOARD_STAGES)[number]

/** 列の添字。列を持たない工程（`waiting` / `left`）は −1。 */
function stageIndex(stage: VisitStage): number {
  return (BOARD_STAGES as readonly VisitStage[]).indexOf(stage)
}

/* --- 読み出した行の形 ----------------------------------------------------- */

/** 次にやること 1 件（`reservation_assignments` から出す）。`BoardSubjectRow['next']` で読む。 */
type BoardNextStep = {
  stage: BoardStage
  /** 「視力測定機 A」。設備がまだ決まっていなければ空。 */
  label: string
  staffId: string | null
  equipmentId: string | null
}

/** 盤面の 1 行の材料（ご予約 1 件、またはウォークイン 1 件）。 */
export type BoardSubjectRow = {
  subjectType: 'reservation' | 'walkin'
  subjectId: string
  /** お客様が特定できていなければ null（そのときは整理番号で並ぶ）。 */
  customerName: string | null
  ticketNo: number | null
  visitCount: number | null
  purposeLabel: string
  next: BoardNextStep | null
  /**
   * 店にお着きになった時刻（`walk_ins.arrived_at`）。まだお着きでないご予約は null。
   *
   * **これが「受付」の記録の代わりになる。**`POST /api/staff/walkins` は
   * `visit_events` を 1 行も書かないので、受付パネルから受け付けたお客様は
   * 記録が 0 行のまま盤面に載る。この時刻を受付の記録として補わないと、
   * 受付の欄が空のままで（AC-RECEP-02）、お待たせ中の起点も無く赤地にならない
   * （AC-RECEP-13）。
   */
  arrivedAt?: string | null
}

/** 工程の記録 1 行（`visit_events`）。 */
export type BoardVisitEvent = {
  subjectType: 'reservation' | 'walkin'
  subjectId: string
  stage: VisitStage
  occurredAt: string
}

/** 盤面を描くのに要るもの。DB も実時刻もここから先へは持ち込まない。 */
export type BuildBoardOptions = {
  /** 表示中の JST の暦日。`now` から導くと前日の盤面を開けない。 */
  date: LocalDate
  /** 応答の `serverNow`。端末の時計を読まない。 */
  now: Date
  /** 既定は `active`（ご来店中のみ）。 */
  scope?: 'active' | 'all'
  shifts?: readonly StaffShiftBand[]
  maintenances?: readonly MaintenanceBand[]
}

/* --- 契約の上限で切る ------------------------------------------------------ */

const DISPLAY_NAME_MAX = 40
const PURPOSE_LABEL_MAX = 30
const CELL_LABEL_MAX = 30

/** 契約の上限で切る。1 列の食い違いで盤面がまるごと 500 になる形を作らない。 */
function clamp(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max)
}

/* --- 注意の文 ------------------------------------------------------------- */

/** 担当が今日の勤務に入っていない（休憩に掛かっている時間帯も含む）。 */
const OFF_DUTY_NOTE = '本日はお休みです。担当を決め直してください。'

/** 設備が点検で止まっている。名前を差し込む。 */
function underMaintenanceNote(equipmentName: string): string {
  return `${equipmentName} は点検で止まっています。`
}

/** JST の壁時計 `HH:MM`。時は必ず 2 桁にする（`9:42` を作らない）。 */
function jstClock(at: Date): string {
  const shifted = new Date(at.getTime() + 9 * 60 * 60_000)
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`
}

/**
 * その担当が `now` の 1 点で店に立っているか。
 *
 * `availability.ts` の `isOnShift` は「区間ぜんぶを勤務しているか」を見る非公開の関数で、
 * 盤面が要るのは 1 点だけなのでここに小さく置く。休憩帯に掛かっていれば勤務外として扱う
 * （呼びに行っても席にいない担当を「次にやること」に残さない）。
 */
function isOnDutyAt(
  shifts: readonly StaffShiftBand[],
  staffId: string,
  date: LocalDate,
  clock: string,
): boolean {
  const mine = shifts.filter((row) => row.staffId === staffId && row.date === date)
  const working = mine.some(
    (row) => row.kind === 'work' && row.startsAt <= clock && row.endsAt > clock,
  )
  if (!working) return false
  return !mine.some((row) => row.kind === 'break' && row.startsAt <= clock && row.endsAt > clock)
}

/** その設備が `now` の 1 点で点検に入っているか。区間は半開 `[startsAt, endsAt)`。 */
function isUnderMaintenanceAt(
  maintenances: readonly MaintenanceBand[],
  equipmentId: string,
  now: Date,
): boolean {
  const at = now.getTime()
  return maintenances.some(
    (row) =>
      row.equipmentId === equipmentId &&
      Date.parse(row.startsAt) <= at &&
      Date.parse(row.endsAt) > at,
  )
}

/* --- 1 行を組み立てる ------------------------------------------------------ */

/** 空の欄。**空いた欄を文字で埋めない**（下や右が空いているのは正しい状態である）。 */
function emptyCell(stage: BoardStage): VisitBoardCell {
  return { stage, state: 'empty', at: null, label: '', note: null, needsAttention: false }
}

/**
 * 1 行ぶんの工程を発生順に並べる。同じ時刻の行は読み出した順のままにする。
 *
 * 受付時刻（`arrivedAt`）を持ちながら `received` の記録が無い行には、その時刻の
 * `received` を**補う**。補った行は D1 に書かない — 書くと受付の記録が 2 つになり、
 * 「そのあとの変更」に「ご来店を受け付けました」が二度並ぶ。
 */
function timelineOf(
  events: readonly BoardVisitEvent[],
  row: BoardSubjectRow,
): readonly BoardVisitEvent[] {
  const mine = events.filter(
    (event) => event.subjectType === row.subjectType && event.subjectId === row.subjectId,
  )
  const arrivedAt = row.arrivedAt ?? null
  if (arrivedAt !== null && !mine.some((event) => event.stage === 'received')) {
    mine.push({
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      stage: 'received',
      occurredAt: arrivedAt,
    })
  }
  // 同じ時刻の行は読み出した順のままにする（sort は安定である）。
  return [...mine].sort((a, b) =>
    a.occurredAt === b.occurredAt ? 0 : a.occurredAt < b.occurredAt ? -1 : 1,
  )
}

type RowCells = { cells: VisitBoardCell[]; isWaitingTooLong: boolean }

/**
 * 1 行の 6 欄。
 *
 * いまの工程より**右**にある工程は、記録があっても `empty` に戻す。これが「打ち消しの行を
 * 足すと状態が戻る」を、`visit_events` に列を 1 つも足さずに（追記だけで）表せる唯一の形である。
 */
function buildCells(
  row: BoardSubjectRow,
  timeline: readonly BoardVisitEvent[],
  options: BuildBoardOptions,
): RowCells {
  const last = timeline[timeline.length - 1]
  const board = timeline.filter((event) => stageIndex(event.stage) >= 0)
  const current = board[board.length - 1]
  const currentIndex = current === undefined ? -1 : stageIndex(current.stage)
  const hasLeft = timeline.some((event) => event.stage === 'left')

  // 「受付」は点の記録なので対応中にしない（モックの ウォークイン 003 は受付が最後の記録で
  // ありながら「済みました 10:50」であり、ご相談が「お待たせ中 18分」になっている）。
  const doing =
    current !== undefined && current.stage !== 'received' && last === current ? current : undefined

  // お待たせ中は「対応中の工程が無いとき」だけ立てる（接客中の 40 分をお待たせと呼ばない）。
  const waitingFrom =
    doing === undefined && !hasLeft && last !== undefined ? last.occurredAt : undefined
  const waitingMinutes =
    waitingFrom !== undefined &&
    options.now.getTime() - Date.parse(waitingFrom) > WAITING_TOO_LONG_MINUTES * 60_000
      ? waitedMinutes(waitingFrom, options.now)
      : null

  const planned = row.next !== null && stageIndex(row.next.stage) > currentIndex ? row.next : null
  const waitingStage =
    waitingMinutes === null
      ? null
      : (planned?.stage ??
        BOARD_STAGES.find(
          (stage, index) => index > currentIndex && !board.some((event) => event.stage === stage),
        ) ??
        null)

  const cells = BOARD_STAGES.map((stage): VisitBoardCell => {
    const index = stageIndex(stage)
    if (doing !== undefined && stage === doing.stage) {
      return {
        stage,
        state: 'doing',
        at: doing.occurredAt,
        label: '',
        note: null,
        needsAttention: false,
      }
    }
    if (stage === waitingStage) {
      return {
        stage,
        state: 'waiting',
        at: null,
        label: `${waitingMinutes ?? 0}分`,
        note: null,
        needsAttention: false,
      }
    }
    if (index > currentIndex) {
      return planned?.stage === stage ? nextCell(stage, planned, options) : emptyCell(stage)
    }
    const started = board.findLast((event) => event.stage === stage)
    return started === undefined
      ? emptyCell(stage)
      : {
          stage,
          state: 'done',
          at: started.occurredAt,
          label: '',
          note: null,
          needsAttention: false,
        }
  })

  return { cells, isWaitingTooLong: waitingMinutes !== null }
}

/**
 * 「次にやること」の欄。担当が勤務外・設備が点検中なら注意を添える。
 * **注意はこの欄にだけ出す**（済みました・対応中に出しても打つ手が無い）。
 * 担当不在と設備停止が同時なら**担当不在を優先する** — 担当を決め直さないと
 * 設備の手当ても決まらないからである。
 */
function nextCell(
  stage: BoardStage,
  planned: BoardNextStep,
  options: BuildBoardOptions,
): VisitBoardCell {
  const label = clamp(planned.label, CELL_LABEL_MAX)
  const shifts = options.shifts ?? []
  const maintenances = options.maintenances ?? []

  let note: string | null = null
  if (
    planned.staffId !== null &&
    !isOnDutyAt(shifts, planned.staffId, options.date, jstClock(options.now))
  ) {
    note = OFF_DUTY_NOTE
  } else if (
    planned.equipmentId !== null &&
    isUnderMaintenanceAt(maintenances, planned.equipmentId, options.now)
  ) {
    note = underMaintenanceNote(label === '' ? '設備' : label)
  }

  return { stage, state: 'next', at: null, label, note, needsAttention: note !== null }
}

/* --- 盤面を組み立てる ------------------------------------------------------ */

/**
 * 来店受付ボード 1 枚。
 *
 * `activeCount` は**最新の工程が `left` でない行の数**で、`scope` を切り替えても変わらない
 * （「本日すべて」に切り替えた瞬間に右上の人数が跳ね上がらない）。「お渡し」に居る方も数える。
 */
export function buildBoard(
  rows: readonly BoardSubjectRow[],
  events: readonly BoardVisitEvent[],
  options: BuildBoardOptions,
): VisitBoard {
  const built = rows.map((row) => {
    const timeline = timelineOf(events, row)
    const { cells, isWaitingTooLong } = buildCells(row, timeline, options)
    const name = row.customerName?.trim() ?? ''
    const entry: VisitBoardRow = {
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      displayName: clamp(subjectDisplayName(row.customerName, row.ticketNo), DISPLAY_NAME_MAX),
      // お客様が特定できていない行には来店回数の札を出さない。
      visitCount: name === '' ? null : row.visitCount,
      purposeLabel: clamp(row.purposeLabel, PURPOSE_LABEL_MAX),
      cells,
      isWaitingTooLong,
    }
    /*
     * **まだお着きでない行は盤面に出さない。**盤面の元は「その日のご予約 ＋ その日の
     * ウォークイン」なので、絞らないと 16:00 のご予約が 11:08 の「ご来店中 N名」に
     * 混ざる（AC-RECEP-11 の人数が来店の数でなくなり、AC-RECEP-27 の「まだどなたも
     * お着きになっていません」は当日にご予約が 1 件でもあれば二度と出ない）。
     * お着きになった証拠は工程の記録 1 行であり、ウォークインはそれを `arrivedAt`
     * から補うので、ここでは「記録が 1 行でもあるか」だけを見れば足りる。
     */
    const isPresent = timeline.length > 0
    const isActive = isPresent && timeline[timeline.length - 1]?.stage !== 'left'
    return { entry, isPresent, isActive }
  })

  return {
    date: options.date,
    activeCount: built.filter((row) => row.isActive).length,
    rows: built
      .filter((row) => row.isPresent && ((options.scope ?? 'active') === 'all' || row.isActive))
      .map((row) => row.entry),
    serverNow: options.now.toISOString(),
  }
}
