/**
 * PIN の階段状ロック。
 *
 * PIN は公開の入口（`/s/:slug`）における唯一の資格情報になるので、既存の
 * 「3 回で 30 秒」だけでは足りない —— 4 桁は 10,000 通りしかなく、30 秒待ちを
 * 挟んでも約 3.5 日で尽きる。いっぽう永久ロックは店を止めるので上限を置く。
 *
 * 純粋関数なので Worker を起こさない。境界は「ちょうど」と「±1」を必ず押さえる。
 */
import { describe, expect, it } from 'vitest'
import { lockSecondsFor, parsePinStreak, pinStreakKey } from '../src/worker/domain/pin'

describe('lockSecondsFor', () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 30],
    [4, 30],
    [9, 30],
    [10, 15 * 60],
    [11, 15 * 60],
    [19, 15 * 60],
    [20, 60 * 60],
    [21, 2 * 60 * 60],
    [22, 4 * 60 * 60],
  ])('%i 回の失敗で %i 秒待たせる', (failures, seconds) => {
    expect(lockSecondsFor(failures)).toBe(seconds)
  })

  it('24 時間で頭打ちにする（永久ロックで店を止めない）', () => {
    expect(lockSecondsFor(25)).toBe(24 * 60 * 60)
    expect(lockSecondsFor(1000)).toBe(24 * 60 * 60)
  })

  it('負の値と小数は切り下げて扱う（KV の値を信用しない）', () => {
    expect(lockSecondsFor(-5)).toBe(0)
    expect(lockSecondsFor(3.9)).toBe(30)
  })
})

describe('parsePinStreak', () => {
  it('読めない値は 0 として扱う（KV は正本ではない）', () => {
    expect(parsePinStreak(null)).toBe(0)
    expect(parsePinStreak('{')).toBe(0)
    expect(parsePinStreak('')).toBe(0)
    expect(parsePinStreak('-3')).toBe(0)
    expect(parsePinStreak('abc')).toBe(0)
  })

  it('数字の文字列を読む', () => {
    expect(parsePinStreak('0')).toBe(0)
    expect(parsePinStreak('7')).toBe(7)
  })
})

describe('pinStreakKey', () => {
  it('組織と端末で分ける（別テナントの失敗が混ざらない）', () => {
    expect(pinStreakKey('o1', 't1')).not.toBe(pinStreakKey('o2', 't1'))
    expect(pinStreakKey('o1', 't1')).not.toBe(pinStreakKey('o1', 't2'))
  })

  it('短い窓の失敗キーとぶつからない', async () => {
    const { pinFailureKey } = await import('../src/worker/domain/pin')
    expect(pinStreakKey('o1', 't1')).not.toBe(pinFailureKey('o1', 't1', null))
  })
})
