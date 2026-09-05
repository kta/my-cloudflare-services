import { describe, expect, it } from 'vitest'
import {
  cosineFloat,
  cosineInt8,
  hammingDistance,
  packBinary,
  quantizeInt8,
  topK,
} from '../src/vector'

function unit(values: number[]): Float32Array {
  const v = new Float32Array(values)
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n)
  for (let i = 0; i < v.length; i++) v[i] = (v[i] as number) / n
  return v
}

describe('quantizeInt8 / cosineInt8', () => {
  it('自分自身とのコサイン類似度は 1 に十分近い', () => {
    const a = quantizeInt8(unit([0.1, -0.5, 0.7, 0.2, -0.3, 0.9, -0.8, 0.4]))
    expect(cosineInt8(a, a)).toBeGreaterThan(0.999)
  })

  it('int8 量子化しても float32 の類似度を 0.01 以内で再現する', () => {
    const x = unit([0.2, -0.4, 0.6, 0.1, -0.9, 0.3, 0.5, -0.2])
    const y = unit([0.25, -0.35, 0.55, 0.15, -0.85, 0.35, 0.45, -0.15])
    const exact = cosineFloat(x, y)
    const approx = cosineInt8(quantizeInt8(x), quantizeInt8(y))
    expect(Math.abs(exact - approx)).toBeLessThan(0.01)
  })

  it('直交するベクトルの類似度は 0 付近', () => {
    const a = quantizeInt8(unit([1, 0, 0, 0]))
    const b = quantizeInt8(unit([0, 1, 0, 0]))
    expect(Math.abs(cosineInt8(a, b))).toBeLessThan(0.02)
  })

  it('全要素 0 のベクトルでも例外を投げず 0 を返す', () => {
    const z = quantizeInt8(new Float32Array(4))
    expect(cosineInt8(z, z)).toBe(0)
  })

  it('次元数が違うベクトルの比較は拒否する', () => {
    const a = quantizeInt8(unit([1, 0]))
    const b = quantizeInt8(unit([1, 0, 0, 0]))
    expect(() => cosineInt8(a, b)).toThrow(/dimension/)
  })
})

describe('packBinary / hammingDistance', () => {
  it('符号で 1bit に量子化する（正が 1、0 以下が 0）', () => {
    const p = packBinary(new Float32Array([1, -1, 1, -1, 1, -1, 1, -1]))
    expect(p.length).toBe(1)
    expect(p[0]).toBe(0b01010101)
  })

  it('次元が 8 の倍数でなくても収まる長さになる', () => {
    expect(packBinary(new Float32Array(9)).length).toBe(2)
  })

  it('同一ベクトルのハミング距離は 0', () => {
    const p = packBinary(new Float32Array([1, -1, 1, 1]))
    expect(hammingDistance(p, p)).toBe(0)
  })

  it('全ビット反転のハミング距離は次元数（端の余りを数えない）', () => {
    const a = packBinary(new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]))
    const b = packBinary(new Float32Array([-1, -1, -1, -1, -1, -1, -1, -1]))
    expect(hammingDistance(a, b)).toBe(8)
  })
})

describe('topK', () => {
  it('スコアの高い順に k 件返す', () => {
    const got = topK(
      [
        { id: 'a', score: 0.1 },
        { id: 'b', score: 0.9 },
        { id: 'c', score: 0.5 },
      ],
      2,
    )
    expect(got.map((r) => r.id)).toEqual(['b', 'c'])
  })

  it('k が件数を超えても落ちない', () => {
    expect(topK([{ id: 'a', score: 1 }], 5)).toHaveLength(1)
  })

  it('k が 0 以下なら空を返す', () => {
    expect(topK([{ id: 'a', score: 1 }], 0)).toEqual([])
  })

  it('同点は入力順を保つ（結果の再現性のため）', () => {
    const got = topK(
      [
        { id: 'a', score: 1 },
        { id: 'b', score: 1 },
      ],
      2,
    )
    expect(got.map((r) => r.id)).toEqual(['a', 'b'])
  })
})
