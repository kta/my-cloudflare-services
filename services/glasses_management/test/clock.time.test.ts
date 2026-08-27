import { describe, expect, it } from 'vitest'
import {
  type Clock,
  createClock,
  fixedClock,
  jstDateKey,
  jstMonthKey,
  nowIso,
  systemClock,
} from '../src/worker/domain/clock'

const JST_BOUNDARIES = [
  {
    name: '日跨ぎ直前',
    at: '2026-01-31T14:59:59.999Z',
    date: '2026-01-31',
    month: '2026-01',
  },
  {
    name: '日跨ぎちょうど',
    at: '2026-01-31T15:00:00.000Z',
    date: '2026-02-01',
    month: '2026-02',
  },
  {
    name: '年跨ぎ直前',
    at: '2025-12-31T14:59:59.999Z',
    date: '2025-12-31',
    month: '2025-12',
  },
  {
    name: '年跨ぎちょうど',
    at: '2025-12-31T15:00:00.000Z',
    date: '2026-01-01',
    month: '2026-01',
  },
  {
    name: 'うるう日直前',
    at: '2024-02-29T14:59:59.999Z',
    date: '2024-02-29',
    month: '2024-02',
  },
  {
    name: 'うるう日の日跨ぎ',
    at: '2024-02-29T15:00:00.000Z',
    date: '2024-03-01',
    month: '2024-03',
  },
] as const

describe('Clock', () => {
  it.each(JST_BOUNDARIES)('$name を固定時刻として JST に変換する', (boundary) => {
    const clock = fixedClock(boundary.at)

    expect(nowIso(clock)).toBe(boundary.at)
    expect(jstDateKey(clock)).toBe(boundary.date)
    expect(jstMonthKey(clock)).toBe(boundary.month)
  })

  it('同じ時刻を返すが Date インスタンスは呼び出しごとに分離される', () => {
    const clock = fixedClock(new Date('2026-08-26T00:00:00.000Z'))

    const first = clock.now()
    first.setUTCFullYear(2000)

    expect(clock.now().toISOString()).toBe('2026-08-26T00:00:00.000Z')
  })

  it('注入した時計の値を変更せずに読み取る', () => {
    const values = [new Date('2026-08-26T14:59:59.999Z'), new Date('2026-08-26T15:00:00.000Z')]
    const fallback = new Date('2026-08-26T15:00:00.000Z')
    let index = 0
    const clock: Clock = createClock(() => values[index++] ?? fallback)

    expect(nowIso(clock)).toBe('2026-08-26T14:59:59.999Z')
    expect(nowIso(clock)).toBe('2026-08-26T15:00:00.000Z')
  })

  it('不正な時刻を返す時計と不正な固定値を拒否する', () => {
    expect(() => fixedClock('not-a-date')).toThrow(RangeError)
    expect(() => createClock(() => new Date(Number.NaN)).now()).toThrow(RangeError)
  })

  it('明示的なシステム時計も Clock 契約を満たす', () => {
    expect(systemClock().now()).toBeInstanceOf(Date)
  })
})
