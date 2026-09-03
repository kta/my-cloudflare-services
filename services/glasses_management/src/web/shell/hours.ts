import type { BusinessHoursRow } from '@app/contracts'

/*
 * 上のバーに出す営業の状態。
 *
 * 以前ここは `'営業中　10:00–19:00'` という**文字列リテラル**だった。
 * 店舗が変わっても、曜日が変わっても、定休日でも、真夜中でも同じ 1 行を出し続けていた
 * （UX 監査 BOOK-07 の「営業時間の正本が 2 つある」の正体はこれで、
 * 正本が 2 つあったのではなく、片方が事実を見ていなかった）。
 *
 * **端末の時計は読まない。** 判定に使う時刻は必ず引数で注ぐ（`AGENTS.md` のテスト規約）。
 */

/** JST の曜日（0=日 … 6=土）。 */
function jstWeekday(now: Date): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCDay()
}

/** JST の `HH:MM`。 */
function jstClock(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`
}

/**
 * 「営業中　10:00–19:00」「本日は定休日」「営業時間外　10:00–19:00」のいずれか。
 * 営業時間が分からないときは `null` を返し、**憶測で時刻を書かない**。
 */
export function openStateLabel(rows: readonly BusinessHoursRow[] | null, now: Date): string | null {
  if (rows === null || rows.length === 0) return null
  const today = rows.find((row) => row.weekday === jstWeekday(now))
  if (today === undefined) return null
  if (today.isClosed) return '本日は定休日'
  if (today.opensAt === null || today.closesAt === null) return null
  const span = `${today.opensAt}–${today.closesAt}`
  const clock = jstClock(now)
  const open = clock >= today.opensAt && clock < today.closesAt
  return `${open ? '営業中' : '営業時間外'}　${span}`
}
