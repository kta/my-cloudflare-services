import type { BusinessHoursRow } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import { openStateLabel } from './hours'

/** JST の日時から UTC の `Date` を作る（テストの読みやすさのため）。 */
const jst = (iso: string) => new Date(`${iso}+09:00`)

const WEEK: BusinessHoursRow[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday: weekday as BusinessHoursRow['weekday'],
  isClosed: weekday === 2,
  opensAt: weekday === 2 ? null : '10:00',
  closesAt: weekday === 2 ? null : '19:00',
  breakStart: null,
  breakEnd: null,
}))

describe('上のバーの営業状態', () => {
  it('営業時間の中なら「営業中」と、その日の時間帯を出す', () => {
    // 2026-08-27 は木曜。
    expect(openStateLabel(WEEK, jst('2026-08-27T11:08'))).toBe('営業中　10:00–19:00')
  })

  it('開店前は「営業時間外」と出す（同じ時間帯を添える）', () => {
    expect(openStateLabel(WEEK, jst('2026-08-27T09:59'))).toBe('営業時間外　10:00–19:00')
  })

  it('閉店の時刻ちょうどは、もう営業時間外', () => {
    expect(openStateLabel(WEEK, jst('2026-08-27T19:00'))).toBe('営業時間外　10:00–19:00')
  })

  it('開店の時刻ちょうどは営業中', () => {
    expect(openStateLabel(WEEK, jst('2026-08-27T10:00'))).toBe('営業中　10:00–19:00')
  })

  it('定休の曜日は「本日は定休日」と出し、時間帯を書かない', () => {
    // 2026-09-01 は火曜。
    expect(openStateLabel(WEEK, jst('2026-09-01T11:08'))).toBe('本日は定休日')
  })

  it('曜日ごとに違う時間帯を、その日のぶんで出す', () => {
    const rows = WEEK.map((row) => (row.weekday === 5 ? { ...row, closesAt: '20:00' } : row))
    // 2026-08-28 は金曜。
    expect(openStateLabel(rows, jst('2026-08-28T19:30'))).toBe('営業中　10:00–20:00')
  })

  it('営業時間が分からないうちは何も言わない（憶測で時刻を書かない）', () => {
    expect(openStateLabel(null, jst('2026-08-27T11:08'))).toBeNull()
    expect(openStateLabel([], jst('2026-08-27T11:08'))).toBeNull()
  })
})
