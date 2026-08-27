/**
 * Time-grid arithmetic for the daily ledger.
 *
 * Pure and instant-injected on purpose: the now line is the one piece of the
 * ledger whose correctness is only visible at boundaries (AC-EYEX-13 / 19), so
 * neither `Date.now()` nor the runtime timezone may take part. Japan has no
 * daylight saving, so a fixed +09:00 offset is exact.
 */

const JST_OFFSET_MINUTES = 9 * 60
const MINUTES_PER_DAY = 24 * 60

export type TimeGrid = {
  /** Minutes from JST midnight where the grid begins, inclusive. */
  startMinutes: number
  /** Minutes from JST midnight where the grid ends, inclusive for the now line. */
  endMinutes: number
  /** Width of one column in minutes. */
  stepMinutes: number
}

/**
 * 承認済みモックの時間軸。10:00 から 30 分刻みで 7 列、右端は 13:30。
 *
 * 「1 日が 1 画面」がこの画面の主題なので、列数は iPad の幅に収まる数でなければ
 * ならない。横スクロールで軸を伸ばすと、台帳を一目で読むという目的そのものが
 * 消える。軸に載らない受付は営業時間外の受付として軸の下に並べる。
 */
export const LEDGER_GRID: TimeGrid = {
  startMinutes: 10 * 60,
  endMinutes: 13 * 60 + 30,
  stepMinutes: 30,
}

function jstShifted(instant: string): Date {
  const parsed = new Date(instant)
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`not an instant: ${instant}`)
  return new Date(parsed.getTime() + JST_OFFSET_MINUTES * 60_000)
}

/** The Asia/Tokyo calendar day (`YYYY-MM-DD`) an instant falls on. */
export function jstDayOf(instant: string): string {
  return jstShifted(instant).toISOString().slice(0, 10)
}

/** Minutes elapsed since Asia/Tokyo midnight of the instant's own day. */
export function jstMinutesOf(instant: string): number {
  const shifted = jstShifted(instant)
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

/** `HH:mm` wall time for minutes since JST midnight. */
export function formatJstMinutes(minutes: number): string {
  const wrapped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const hours = String(Math.floor(wrapped / 60)).padStart(2, '0')
  return `${hours}:${String(wrapped % 60).padStart(2, '0')}`
}

function columnCount(grid: TimeGrid): number {
  return Math.ceil((grid.endMinutes - grid.startMinutes) / grid.stepMinutes)
}

/** Header labels, one per column, left to right. */
export function gridColumnLabels(grid: TimeGrid): string[] {
  return Array.from({ length: columnCount(grid) }, (_, index) =>
    formatJstMinutes(grid.startMinutes + index * grid.stepMinutes),
  )
}

export type NowLine = {
  /** 支援技術と自動テストが読む一語。 */
  label: string
  /** `HH:mm` 単体。和文と数字で書体を分けて描くために label とは別に持つ。 */
  time: string
  ratio: number
}

/**
 * Where the `現在 HH:mm` line belongs, or `null` when it must not be drawn —
 * on any day other than the injected instant's JST day, and outside the grid.
 */
export function nowLine(input: { now: string; date: string; grid: TimeGrid }): NowLine | null {
  if (jstDayOf(input.now) !== input.date) return null
  const minutes = jstMinutesOf(input.now)
  const { startMinutes, endMinutes } = input.grid
  if (minutes < startMinutes || minutes > endMinutes) return null
  const time = formatJstMinutes(minutes)
  return {
    label: `現在 ${time}`,
    time,
    ratio: (minutes - startMinutes) / (endMinutes - startMinutes),
  }
}

export type EntryPlacement = { startColumn: number; spanColumns: number }

/**
 * The 1-based column range an entry occupies. Entries that overhang the grid
 * are clamped so an early or late booking is still visible; entries entirely
 * outside it have no placement and are listed outside the grid instead.
 */
export function entryPlacement(input: {
  startAt: string
  endAt: string
  grid: TimeGrid
}): EntryPlacement | null {
  const { grid } = input
  const dayShift = (jstDayOf(input.endAt) === jstDayOf(input.startAt) ? 0 : 1) * MINUTES_PER_DAY
  const startMinutes = jstMinutesOf(input.startAt)
  const endMinutes = jstMinutesOf(input.endAt) + dayShift
  if (startMinutes >= grid.endMinutes) return null
  if (endMinutes <= grid.startMinutes) return null
  const columns = columnCount(grid)
  const rawStart = Math.floor((startMinutes - grid.startMinutes) / grid.stepMinutes) + 1
  const rawEnd = Math.ceil((endMinutes - grid.startMinutes) / grid.stepMinutes)
  const startColumn = Math.min(Math.max(rawStart, 1), columns)
  const endColumn = Math.min(Math.max(rawEnd, startColumn), columns)
  return { startColumn, spanColumns: endColumn - startColumn + 1 }
}
