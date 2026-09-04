import type { LedgerBlock, LedgerEntry, LedgerLane, LocalDate, LocalTime } from '@app/contracts'
import { visitLabel } from '../../worker/domain/customers'
import {
  bandSourceLabel,
  bandTone,
  LEDGER_SLOT_MINUTES,
  LEDGER_WINDOW_SLOTS,
  LEDGER_WINDOW_START,
  type LedgerBandTone,
  nowMarker,
  placeOnLedgerWindow,
} from '../../worker/domain/ledger'

/*
 * 台帳の位置と幅の計算と、画面が使う寸法。
 *
 * ここは**純関数だけ**で、`Date.now()` を 1 度も呼ばない。現在時刻はすべて応答の
 * `serverNow` を引数で受ける（端末の時計を読むと、iPad の時計がずれた日に台帳が黙って嘘をつく）。
 *
 * 時間の割り付けの正本は `worker/domain/ledger.ts` の 4 定数と `placeOnLedgerWindow` /
 * `nowMarker` である。同じ計算を画面側でもう一度書かない。
 *
 * 実測（docs/frontend/mockups/eye/screens/LEDGER-STAFF.html の <style> と
 * assets/eye.css の `.tt-*` / `.appt` / `.nowline`）:
 *   名前列 170px 固定 ＋ 時間 14 列 1fr、行は 34px / 1fr ×4 / 88px
 *   `.tt-head` min-height 34px、`.tt-name` min-height 64px、`.appt` min-height 54px
 *   `.nowline` 幅 2px・左位置 `170px + (100% − 170px) × 0.1619`（11:08 ＝ 68分 ÷ 420分）
 */

/** 1rem。Tailwind の `--spacing`（0.25rem）4 つぶん。px の実測値を rem へ直すのに使う。 */
const REM_PX = 16

/** 名前列。モックの `grid-template-columns: 170px repeat(14, 1fr)`。 */
export const LABEL_WIDTH_PX = 170
/**
 * 1 列の最小幅。iPad 1194px からサイドバー 76px と名前列 170px を引いた 948px を
 * 14 列で割った実測値（67.7px）を `--spacing` の刻みへ丸めたもの。
 * 表示窓と同じ 14 列の日はちょうど画面に収まり、営業時間が長い日だけが横に流れる。
 */
const SLOT_MIN_WIDTH_PX = 68
/** 列見出しの高さ（`.tt-head`）。 */
const HEAD_HEIGHT_PX = 34
/** 「ご来店お待ち」の行の高さ（モックの最終行 88px）。 */
const WALKIN_ROW_PX = 88

/** 表示窓（10:00–16:30 の 30分刻み 14 列）。契約の値をこの面の名前で受ける。 */
const WINDOW_SLOTS = LEDGER_WINDOW_SLOTS
const SLOT_MINUTES = LEDGER_SLOT_MINUTES

const MS_PER_MINUTE = 60_000
const JST_OFFSET_MS = 9 * 60 * MS_PER_MINUTE
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** `HH:MM` を 0 時からの分に直す。 */
function toMinutes(time: LocalTime): number {
  const [hours, minutes] = time.split(':')
  return Number(hours) * 60 + Number(minutes)
}

/** UTC の ISO8601 を JST の壁時計 `HH:MM` にする。時は必ず 2 桁にする。 */
export function jstClock(at: string): LocalTime {
  const shifted = new Date(Date.parse(at) + JST_OFFSET_MS)
  const hours = String(shifted.getUTCHours()).padStart(2, '0')
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * その日に描く列数。表示窓は 14 列（10:00–16:30）で、営業時間がそれより長い日だけ
 * 列を伸ばして台帳の中を横スクロールさせる（AC-LEDGER-02）。
 */
export function columnCount(closesAt: LocalTime | null): number {
  if (closesAt === null) return WINDOW_SLOTS
  const span = toMinutes(closesAt) - toMinutes(LEDGER_WINDOW_START)
  return Math.max(WINDOW_SLOTS, Math.ceil(span / SLOT_MINUTES))
}

/** 列 1 つの見出し。0 列目は 10:00。 */
export function slotLabel(index: number): LocalTime {
  const minutes = toMinutes(LEDGER_WINDOW_START) + index * SLOT_MINUTES
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** 列見出しをすべて。 */
export function columnLabels(columns: number): LocalTime[] {
  return Array.from({ length: columns }, (_, index) => slotLabel(index))
}

/* --- 日付 ----------------------------------------------------------------- */

/** `YYYY-MM-DD` を暦日として読む。時差の影響を受けないよう UTC で持つ。 */
function calendarDay(date: LocalDate): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

/** 「2026年8月27日（木）」。 */
export function dateLabel(date: LocalDate): string {
  const day = calendarDay(date)
  return `${day.getUTCFullYear()}年${day.getUTCMonth() + 1}月${day.getUTCDate()}日（${WEEKDAYS[day.getUTCDay()]}）`
}

/** 「9月1日（火）」。年をまたぐ知らせは出さないので年を落とす。 */
function shortDateLabel(date: LocalDate): string {
  const day = calendarDay(date)
  return `${day.getUTCMonth() + 1}月${day.getUTCDate()}日（${WEEKDAYS[day.getUTCDay()]}）`
}

/**
 * 定休日・臨時休業・受付を止めた日の知らせ。応答はこの 3 つを区別しない
 * （どれも `opensAt` が null）ので、AC-LEDGER-22 の型に合わせて 1 文だけを出す。
 */
export function closedNotice(date: LocalDate): string {
  return `${shortDateLabel(date)}は定休日です。`
}

/** JST の暦日で ±N 日。端末の時計を読まない。 */
export function shiftDate(date: LocalDate, days: number): LocalDate {
  const moved = new Date(calendarDay(date).getTime() + days * 24 * 60 * MS_PER_MINUTE)
  return moved.toISOString().slice(0, 10)
}

/* --- 現在時刻 ------------------------------------------------------------- */

/** 札に出す時刻。先頭の 0 は落とす（「現在 9:42」）。 */
export function clockLabel(time: LocalTime): string {
  return time.replace(/^0/, '')
}

/**
 * ツールバーの札の文言。表示中の日付が本日でなければ出さない。
 * 表示窓の外は線を引かず、札だけを「現在 9:42（営業時間の外）」の型で出す（AC-LEDGER-03）。
 */
export function nowChipLabel(date: LocalDate, serverNow: string): string | null {
  const marker = nowMarker(date, new Date(serverNow))
  if (!marker.isToday) return null
  const clock = clockLabel(marker.clock)
  return marker.outside === null ? `現在 ${clock}` : `現在 ${clock}（営業時間の外）`
}

/**
 * 現在時刻の線の位置。時間軸（名前列を除いた部分）の左からの割合を返す。
 * 表示窓を越えて列が伸びた日は、伸びたぶんだけ割合が縮む。
 */
export function nowLineLeft(date: LocalDate, serverNow: string, columns: number): string | null {
  const { ratio } = nowMarker(date, new Date(serverNow))
  if (ratio === null) return null
  return `${((ratio * WINDOW_SLOTS * 100) / columns).toFixed(2)}%`
}

/* --- 帯 ------------------------------------------------------------------- */

/**
 * 帯の色。出どころは 3 系統だが、**担当が未定は出どころより先に赤になる**
 * （モック LEDGER-STAFF の 相川 みどり 様 はウォークイン由来だが赤で描かれている）。
 * 色だけに意味を持たせないので、帯の中には必ず文字を添える。
 */
export function bandToneOf(entry: LedgerEntry): LedgerBandTone | 'alert' {
  return entry.isUnassigned ? 'alert' : bandTone(entry.source)
}

/**
 * 帯 1 本のひと続きの名前（AC-LEDGER-20）。型は「時刻　ご用件　行の名前」で、
 * そのうしろに**帯の中に文字で見えている語**を見えている順で足す。
 *
 * `aria-label` は中の要素の読み上げをまるごと覆い隠すので、この名前に入れないかぎり
 * 「Web予約」「ウォークイン」「担当が未定」「ご来店なし」は読み上げに現れない。
 * AC-LEDGER-05 / 07 の「色だけに意味を持たせず必ず文字を添える」が目で見る人にしか
 * 効かなくなるため、名前の末尾へ回す（先頭の 3 つは AC-LEDGER-20 の型のまま動かさない）。
 * 「担当が未定」の行では行の名前がすでにその語なので重ねない。
 */
export function bandName(
  entry: LedgerEntry,
  laneName: string,
  laneKind?: LedgerLane['kind'],
): string {
  // お名前と来店回数は帯の見た目では姓だけ・印だけに縮めることがあるが（AC-CUST-24）、
  // 読み上げ名では省略しない（狭い帯でも聞こえる情報を画面表示の文字数で削らない）。
  const customer =
    entry.customerName === null
      ? ''
      : `${entry.customerName} 様${
          entry.visitCount === null ? '' : `　${visitLabel(entry.visitCount, 'badge')}`
        }　`
  const head = `${jstClock(entry.startsAt)}から${jstClock(entry.endsAt)}　${customer}${entry.purposeLabel}　${laneName}`
  const extras = [
    bandSourceLabel(entry.source),
    entry.isUnassigned && laneKind !== 'unassigned' ? '担当が未定' : null,
    entry.status === 'no_show' ? 'ご来店なし' : null,
  ].filter((word): word is string => word !== null)
  return extras.length === 0 ? head : `${head}　${extras.join('　')}`
}

/** 休憩・点検の帯の名前。帯と同じ型で読ませる。 */
export function blockName(block: LedgerBlock, laneName: string): string {
  return `${jstClock(block.startsAt)}から${jstClock(block.endsAt)}　${block.label}　${laneName}`
}

/** 空いている枠の名前（「10:30　佐藤 美咲　空いています」）。 */
export function emptyCellName(slot: LocalTime, laneName: string): string {
  return `${slot}　${laneName}　空いています`
}

/* --- 行の割り付け --------------------------------------------------------- */

export type LaneSegment =
  | { key: string; columnIndex: number; columnSpan: number; kind: 'empty' }
  | { key: string; columnIndex: number; columnSpan: number; kind: 'entry'; entries: LedgerEntry[] }
  | { key: string; columnIndex: number; columnSpan: number; kind: 'block'; block: LedgerBlock }

type Placed = { columnIndex: number; columnSpan: number; segment: LaneSegment }

/** 表示窓の外へはみ出す帯を、描ける列の中へ収める。 */
function clampToColumns(
  date: LocalDate,
  startsAt: string,
  endsAt: string,
  columns: number,
): { columnIndex: number; columnSpan: number } {
  const place = placeOnLedgerWindow(date, startsAt, endsAt)
  const columnIndex = Math.min(Math.max(place.columnIndex, 0), columns - 1)
  const end = Math.min(columns, Math.max(place.columnIndex + place.columnSpan, columnIndex + 1))
  return { columnIndex, columnSpan: end - columnIndex }
}

/**
 * 1 行を列へ割り付ける。**またぐ帯は先頭の列にだけ置き**、残りの列は 1 枠ずつの
 * 空いた枠にする（AC-LEDGER-20。同じ帯を 2 度読ませない）。
 * 「ご来店お待ち」の行だけは時間軸に載せず、列いっぱいの 1 枠にする（AC-LEDGER-08）。
 */
export function laneSegments(lane: LedgerLane, date: LocalDate, columns: number): LaneSegment[] {
  if (lane.kind === 'walkin') {
    return [{ key: 'walkin', columnIndex: 0, columnSpan: columns, kind: 'empty' }]
  }
  // 予約も点検も無い設備の行も、列を割らずに 1 枠にする（AC-LEDGER-11 の「いま空いています」）。
  // 14 枠に割ると、その行へ矢印で降りたとき焦点を持てる枠が 1 つも無くなり
  //（画面は 1 枠しか描かないので 2 枠目以降の tabindex が誰にも当たらない）、
  // 台帳から Tab で入り直せなくなる。
  if (lane.kind === 'equipment' && lane.entries.length === 0 && lane.blocks.length === 0) {
    return [{ key: 'free', columnIndex: 0, columnSpan: columns, kind: 'empty' }]
  }

  const placed: Placed[] = [
    ...lane.entries.map((entry): Placed => {
      const box = clampToColumns(date, entry.startsAt, entry.endsAt, columns)
      return {
        ...box,
        segment: {
          ...box,
          key: `entry:${entry.reservationId}:${entry.startsAt}`,
          kind: 'entry',
          entries: [entry],
        },
      }
    }),
    ...lane.blocks.map((block): Placed => {
      const box = clampToColumns(date, block.startsAt, block.endsAt, columns)
      return {
        ...box,
        segment: { ...box, key: `block:${block.kind}:${block.startsAt}`, kind: 'block', block },
      }
    }),
  ].sort((a, b) => a.columnIndex - b.columnIndex || b.columnSpan - a.columnSpan)

  const segments: LaneSegment[] = []
  let cursor = 0
  for (const item of placed) {
    if (item.columnIndex < cursor) {
      // 同じ列で重なった帯は、先に置いた枠の中へ重ねる（列を割らない）。
      const last = segments[segments.length - 1]
      if (last?.kind === 'entry' && item.segment.kind === 'entry') {
        last.entries.push(...item.segment.entries)
      }
      continue
    }
    while (cursor < item.columnIndex) {
      segments.push({ key: `empty:${cursor}`, columnIndex: cursor, columnSpan: 1, kind: 'empty' })
      cursor += 1
    }
    segments.push(item.segment)
    cursor = item.columnIndex + item.columnSpan
  }
  while (cursor < columns) {
    segments.push({ key: `empty:${cursor}`, columnIndex: cursor, columnSpan: 1, kind: 'empty' })
    cursor += 1
  }
  return segments
}

/* --- 格子の寸法 ----------------------------------------------------------- */

/** 名前列は固定、時間は等分。任意値（`grid-cols-[170px_1fr]`）を書かないための計算。 */
export function gridTemplateColumns(columns: number): string {
  return `${LABEL_WIDTH_PX / REM_PX}rem repeat(${columns}, minmax(0, 1fr))`
}

/** 列見出しと「ご来店お待ち」だけ高さを固定し、担当・設備の行は等分に伸ばす。 */
export function gridTemplateRows(lanes: readonly LedgerLane[]): string {
  const rows = lanes.map((lane) =>
    lane.kind === 'walkin' ? `${WALKIN_ROW_PX / REM_PX}rem` : 'minmax(0, 1fr)',
  )
  return [`${HEAD_HEIGHT_PX / REM_PX}rem`, ...rows].join(' ')
}

/**
 * 列が表示窓より増えた日に、台帳の中だけを横へ流すための最小幅。
 *
 * **表示窓と同じ 14 列の日はちょうど画面の幅にする**（`100%`）。固定の幅を与えると
 * 1 列が 68px に丸まり、モックの 1fr（(幅 − 170) ÷ 14 ＝ 67.7px）と 1 列につき 0.3px ずれて、
 * 右端の 16:30 では 4px の食い違いになる。伸ばすのは表示窓を越えたぶんだけにする。
 */
export function gridMinWidth(columns: number): string {
  const extra = Math.max(0, columns - WINDOW_SLOTS)
  if (extra === 0) return '100%'
  return `calc(100% + ${(extra * SLOT_MIN_WIDTH_PX) / REM_PX}rem)`
}
