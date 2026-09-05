import { describe, expect, it } from 'vitest'
import { needsMatter, parsePath, routeToPath } from './nav'

/*
 * 画面の切り替え。`react-router` を入れずに `history.pushState` で足りる、という
 * 判断の裏付け。URL が案件の文脈を持つので、ブラウザの戻るが素直に効く。
 */

describe('parsePath', () => {
  it('案件つきの経路を読む', () => {
    expect(parsePath('/m/abc-123/chart')).toEqual({ screen: 'chart', matterId: 'abc-123' })
  })

  it('案件つきで画面が省かれていればクレームチャートに落ちる', () => {
    expect(parsePath('/m/abc-123')).toEqual({ screen: 'chart', matterId: 'abc-123' })
  })

  it('案件つきの経路に案件不要の画面を書いてもクレームチャートに落ちる', () => {
    expect(parsePath('/m/abc-123/corpus')).toEqual({ screen: 'chart', matterId: 'abc-123' })
  })

  it('案件なしの経路を読む', () => {
    expect(parsePath('/jobs')).toEqual({ screen: 'jobs', matterId: null })
    expect(parsePath('/corpus')).toEqual({ screen: 'corpus', matterId: null })
  })

  it('根は案件一覧', () => {
    expect(parsePath('/')).toEqual({ screen: 'matters', matterId: null })
  })

  it('知らない経路は案件一覧に落ちる（404 の画面を作らない）', () => {
    expect(parsePath('/nope')).toEqual({ screen: 'matters', matterId: null })
  })

  it('末尾の / があっても同じに読む', () => {
    expect(parsePath('/jobs/')).toEqual({ screen: 'jobs', matterId: null })
  })
})

describe('routeToPath', () => {
  it('案件が要る画面は案件つきの経路になる', () => {
    expect(routeToPath({ screen: 'chart', matterId: 'x' })).toBe('/m/x/chart')
  })

  it('案件が要らない画面は案件を経路に入れない', () => {
    expect(routeToPath({ screen: 'jobs', matterId: 'x' })).toBe('/jobs')
  })

  it('案件が無ければ案件つきの経路にしない', () => {
    expect(routeToPath({ screen: 'chart', matterId: null })).toBe('/chart')
  })

  it('往復して同じ経路になる', () => {
    for (const path of ['/m/x/chart', '/m/x/search', '/jobs', '/corpus', '/matters']) {
      expect(routeToPath(parsePath(path))).toBe(path)
    }
  })
})

describe('needsMatter', () => {
  it('案件の中の画面だけが案件を要る', () => {
    for (const s of [
      'intake',
      'elements',
      'search',
      'chart',
      'assessment',
      'graph',
      'draft',
    ] as const) {
      expect(needsMatter(s)).toBe(true)
    }
    for (const s of ['matters', 'jobs', 'corpus'] as const) {
      expect(needsMatter(s)).toBe(false)
    }
  })
})
