import type { AvailabilityReason } from '@app/contracts'

/*
 * 置いたご予約を指で運ぶための計算（BOOK-03c-DRAG）。
 *
 * ここは**純関数だけ**で、DOM も `Date.now()` も触らない。盤の実寸は呼ぶ側が
 * `getBoundingClientRect()` で測って渡す（実機でもテストでも同じ式を通すため）。
 *
 * **座標そのままの自由配置にしない。** 指の位置は必ず「担当の行」と「30分の刻み」へ
 * 吸着させる。1px 単位で置けてしまうと、盤が読める位置と実際に押さえる時刻がずれ、
 * 復唱の文と台帳の帯が食い違う。
 *
 * 実測（docs/frontend/mockups/eye/screens/BOOK-03c-DRAG.html の <style> と
 * assets/eye.css）: 名前列 170px、見出し行 34px、時間は 30分刻みの 1fr。
 */

/** 盤の実寸。左上の座標と、名前列・見出し行を除いた格子の割り付け。 */
export type BoardGeometry = {
  left: number
  top: number
  width: number
  height: number
  /** 名前列の幅（px）。ここより左は枠ではない。 */
  labelWidth: number
  /** 見出し行の高さ（px）。ここより上は枠ではない。 */
  headHeight: number
  columns: number
  rows: number
}

/** 盤の枠 1 つ。行は担当（設備）、列は 30分の刻み。 */
export type BoardCell = { row: number; column: number }

/**
 * 指の座標を枠へ吸着させる。名前列・見出し行の上や盤の外は「枠ではない」ので
 * null を返す（いちばん端の枠へ丸めると、盤の外で指を離したときに意図しない
 * 時刻で確保してしまう）。
 */
export function snapToCell(
  point: { x: number; y: number },
  geometry: BoardGeometry,
): BoardCell | null {
  if (geometry.columns <= 0 || geometry.rows <= 0) return null
  const gridWidth = geometry.width - geometry.labelWidth
  const gridHeight = geometry.height - geometry.headHeight
  if (gridWidth <= 0 || gridHeight <= 0) return null

  const x = point.x - geometry.left - geometry.labelWidth
  const y = point.y - geometry.top - geometry.headHeight
  if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return null

  const column = Math.floor(x / (gridWidth / geometry.columns))
  const row = Math.floor(y / (gridHeight / geometry.rows))
  if (column < 0 || column >= geometry.columns) return null
  if (row < 0 || row >= geometry.rows) return null
  return { row, column }
}

/** 所要が何列ぶんか。刻みに満たない端数は切り上げる（0 幅の帯を描かない）。 */
export function columnSpan(durationMinutes: number, slotMinutes: number): number {
  if (slotMinutes <= 0) return 1
  return Math.max(1, Math.ceil(durationMinutes / slotMinutes))
}

/**
 * 置けない理由を 1 文にする。**3 事由を 1 文に束ねない**ので、渡ってきた 1 つだけを言う。
 * 理由が分からないときも「置けません」だけは必ず言う（黙って何も起きない面を作らない）。
 */
export function blockedText(laneName: string, reason: AvailabilityReason | null): string {
  return `ここには置けません（${blockedReason(laneName, reason)}）`
}

function blockedReason(laneName: string, reason: AvailabilityReason | null): string {
  switch (reason) {
    case 'closed':
      return 'この日はお店を開けていません'
    case 'outside_hours':
      return '営業時間の外です'
    case 'break':
      return `${laneName} は休憩の時間です`
    case 'maintenance':
      return `${laneName} は点検中です`
    case 'staff_busy':
      return `${laneName} に先約があります`
    case 'staff_off':
      return `${laneName} の勤務の外です`
    case 'equipment_busy':
      return `${laneName} は先約で埋まっています`
    case 'no_equipment':
      return '使える設備・場所がありません'
    case 'no_skill':
      return `${laneName} はこの用件を承れません`
    case 'max_parallel':
      return '同時にお受けできる数を超えます'
    case 'web_window':
      return 'Web予約でお受けする時間の外です'
    case 'lead_time':
      return '直前すぎてお受けできません'
    default:
      return 'この枠は空いていません'
  }
}
