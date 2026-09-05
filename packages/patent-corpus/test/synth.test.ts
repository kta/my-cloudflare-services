import { describe, expect, it } from 'vitest'
import { synthesizePublications } from '../src/synth'

// 実データ未着でも全機能を作り切るための合成コーパス。
// 決定的であること（seed が同じなら同じ結果）が回帰テストの前提になる。
describe('synthesizePublications', () => {
  it('件数どおりに作る', () => {
    expect(synthesizePublications({ count: 5, seed: 1 })).toHaveLength(5)
  })

  it('同じ seed なら完全に同じ結果になる', () => {
    const a = synthesizePublications({ count: 3, seed: 42 })
    const b = synthesizePublications({ count: 3, seed: 42 })
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })

  it('違う seed なら違う結果になる', () => {
    const a = synthesizePublications({ count: 3, seed: 1 })
    const b = synthesizePublications({ count: 3, seed: 2 })
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a))
  })

  it('公報番号が重複しない', () => {
    const all = synthesizePublications({ count: 50, seed: 3 })
    expect(new Set(all.map((p) => p.publication.pubNumber)).size).toBe(50)
  })

  it('請求項が 1 件以上あり、段落番号は claim と desc で衝突しない', () => {
    const [p] = synthesizePublications({ count: 1, seed: 9 })
    const claims = p?.paragraphs.filter((x) => x.section === 'claim') ?? []
    const descs = p?.paragraphs.filter((x) => x.section === 'desc') ?? []
    expect(claims.length).toBeGreaterThan(0)
    expect(descs.length).toBeGreaterThan(0)
    const nos = (p?.paragraphs ?? []).map((x) => x.paraNo)
    expect(new Set(nos).size).toBe(nos.length)
  })

  it('desc の段落番号は 4 桁ゼロ埋め、claim は C 始まり', () => {
    const [p] = synthesizePublications({ count: 1, seed: 11 })
    for (const para of p?.paragraphs ?? []) {
      if (para.section === 'claim') expect(para.paraNo).toMatch(/^C\d{3}$/)
      else expect(para.paraNo).toMatch(/^\d{4}$/)
    }
  })

  it('IPC を指定すると、その分類だけを持つ公報を作る', () => {
    const all = synthesizePublications({ count: 10, seed: 5, ipc: ['G06F3/01'] })
    expect(all.every((p) => p.publication.ipc.includes('G06F3/01'))).toBe(true)
  })

  it('公開日が指定範囲に収まる', () => {
    const all = synthesizePublications({
      count: 20,
      seed: 6,
      pubDateFrom: '2015-01-01',
      pubDateTo: '2016-12-31',
    })
    for (const p of all) {
      const d = p.publication.pubDate as string
      expect(d >= '2015-01-01').toBe(true)
      expect(d <= '2016-12-31').toBe(true)
    }
  })
})
