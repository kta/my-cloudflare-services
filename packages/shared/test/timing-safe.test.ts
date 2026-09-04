import { describe, expect, it } from 'vitest'
import { timingSafeEqualStr } from '../src/timing-safe'

describe('timingSafeEqualStr', () => {
  it('同一の文字列を一致と判定する', () => {
    expect(timingSafeEqualStr('secret-value', 'secret-value')).toBe(true)
  })

  it('1 文字違えば不一致', () => {
    expect(timingSafeEqualStr('secret-value', 'secret-valuf')).toBe(false)
  })

  it('長さが違えば不一致', () => {
    expect(timingSafeEqualStr('short', 'short-and-longer')).toBe(false)
  })

  it('空文字同士は一致する(呼び出し側が未設定を弾く責務を持つ)', () => {
    expect(timingSafeEqualStr('', '')).toBe(true)
  })

  it('マルチバイト文字を byte 単位で比較する', () => {
    expect(timingSafeEqualStr('鍵', '鍵')).toBe(true)
    expect(timingSafeEqualStr('鍵', '錠')).toBe(false)
  })
})
