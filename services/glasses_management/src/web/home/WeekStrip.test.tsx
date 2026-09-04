import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mondayOf, monthLabel, WeekStrip, weekOf } from './WeekStrip'

/*
 * トップの下辺の 1 週間の帯（承認済みモック docs/frontend/mockups/eyex/images/HOME.png）。
 *
 * この帯が無いあいだ、共有端末のトップは主操作 2 枚だけで、今日について何も言って
 * いなかった（UX 監査 J-01）。台帳へ入るには左の柱から「予約台帳」を押し、
 * 開いた先で日付を選び直すことになっていた。
 *
 * 実測値（screens/HOME.html）: 8 列・すき間 12px、1 枚は最小 76px・角 12px、
 * 数字 22px・曜日 12px。本日は 3px の緑の枠と淡い緑の地、日曜は赤い文字。
 */

const THURSDAY = '2026-08-27'

function strip(today = THURSDAY) {
  const onPickDate = vi.fn()
  const onOpenCalendar = vi.fn()
  render(<WeekStrip today={today} onPickDate={onPickDate} onOpenCalendar={onOpenCalendar} />)
  return { onPickDate, onOpenCalendar }
}

function dayButton(name: string | RegExp): HTMLElement {
  return within(screen.getByRole('region', { name: '日付から台帳を開く' })).getByRole('button', {
    name,
  })
}

describe('週の並び', () => {
  it('週は月曜から始まる', () => {
    expect(mondayOf('2026-08-27')).toBe('2026-08-24')
    // 月曜そのものは動かさない。
    expect(mondayOf('2026-08-24')).toBe('2026-08-24')
    // 日曜は「その週の終わり」なので 6 日戻す（次の週の頭に飛ばさない）。
    expect(mondayOf('2026-08-30')).toBe('2026-08-24')
  })

  it('7 日ぶんを並べる', () => {
    expect(weekOf(THURSDAY)).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ])
  })

  it('月をまたぐ週は両方の月を言う', () => {
    expect(monthLabel(weekOf('2026-08-27'))).toBe('2026年 8月')
    // 8/31（月）から始まる週は 9/6（日）まで。
    expect(monthLabel(weekOf('2026-09-02'))).toBe('2026年 8月・9月')
  })

  it('月をまたいでも 7 枚とも押せる（日付が飛ばない）', () => {
    strip('2026-09-02')
    expect(weekOf('2026-09-02')).toHaveLength(7)
    expect(weekOf('2026-09-02')[0]).toBe('2026-08-31')
    expect(weekOf('2026-09-02')[6]).toBe('2026-09-06')
  })

  it('年をまたぐ週も割れない', () => {
    expect(weekOf('2027-01-01')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ])
    expect(monthLabel(weekOf('2027-01-01'))).toBe('2026年 12月・1月')
  })
})

describe('帯の見た目', () => {
  it('本日は 3px の緑の枠と淡い緑の地で、そこだけが今日だと分かる', () => {
    strip()
    const today = dayButton(/木\s*27/)
    expect(today.className).toContain('border-3')
    expect(today.className).toContain('border-pine')
    expect(today.className).toContain('bg-pine-soft')
    expect(today).toHaveAttribute('aria-current', 'date')
    // ほかの日は 1px の枠。今日が 2 つあるように見せない。
    const other = dayButton(/金\s*28/)
    expect(other.className).not.toContain('border-3')
    expect(other).not.toHaveAttribute('aria-current')
  })

  it('日曜は数字も曜日も赤い', () => {
    strip()
    const sunday = dayButton(/日\s*30/)
    expect(sunday.className).toContain('text-danger')
    // 数字だけ黒く残らない（同じ要素に text-ink と text-danger を重ねない）。
    expect(sunday.className).not.toContain('text-ink')
  })

  it('本日が日曜でも、赤ではなく本日の見た目が勝つ', () => {
    strip('2026-08-30')
    const today = dayButton(/日\s*30/)
    expect(today.className).toContain('text-pine-deep')
    expect(today.className).not.toContain('text-danger')
  })
})

describe('帯から台帳へ', () => {
  it('日を押すと、その日を連れて台帳を開く', async () => {
    const { onPickDate } = strip()
    await userEvent.click(dayButton(/金\s*28/))
    expect(onPickDate).toHaveBeenCalledWith('2026-08-28')
  })

  it('「カレンダーから選ぶ」は台帳へ渡す（週の外の日はそこで選ぶ）', async () => {
    const { onOpenCalendar, onPickDate } = strip()
    await userEvent.click(dayButton('カレンダーから選ぶ'))
    expect(onOpenCalendar).toHaveBeenCalledTimes(1)
    expect(onPickDate).not.toHaveBeenCalled()
  })
})
