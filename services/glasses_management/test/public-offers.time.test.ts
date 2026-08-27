import { describe, expect, it } from 'vitest'
import { isOfferableSlot, upcomingJstDates } from '../src/worker/domain/public-offers'

describe('候補枠の走査日', () => {
  it('月跨ぎでも JST 日付キーとして連続する', () => {
    expect(upcomingJstDates('2026-08-30', 4)).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ])
  })

  it('年跨ぎでも連続する', () => {
    expect(upcomingJstDates('2026-12-31', 2)).toEqual(['2026-12-31', '2027-01-01'])
  })

  it('うるう年の2月末を飛ばさない', () => {
    expect(upcomingJstDates('2028-02-28', 3)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01'])
  })

  it('1日ぶんは今日だけを返す', () => {
    expect(upcomingJstDates('2026-08-31', 1)).toEqual(['2026-08-31'])
  })

  it('日付キーでも日数でもない入力は静かに受け取らない', () => {
    expect(() => upcomingJstDates('2026-8-31', 3)).toThrow(RangeError)
    expect(() => upcomingJstDates('2026-08-31', 0)).toThrow(RangeError)
  })
})

describe('候補枠の可否は開始時刻ちょうどで切り替わる', () => {
  const slot = { startAt: '2026-08-31T01:00:00.000Z' }

  it.each([
    ['開始の1ms前', '2026-08-31T00:59:59.999Z', true],
    ['開始ちょうど', '2026-08-31T01:00:00.000Z', false],
    ['開始の1ms後', '2026-08-31T01:00:00.001Z', false],
  ] as const)('%s', (_name, now, expected) => {
    expect(isOfferableSlot(slot, new Date(now))).toBe(expected)
  })

  it('壊れた開始時刻は候補にしない', () => {
    expect(isOfferableSlot({ startAt: 'not-a-date' }, new Date('2026-08-31T00:00:00.000Z'))).toBe(
      false,
    )
  })
})
