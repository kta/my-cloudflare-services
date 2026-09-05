/**
 * `/s/:storeSlug` の判定と slug 取り出し。
 *
 * `react-router` は入れない。要るのは「前置きが `/s/` か」「slug は何か」の
 * 2 つだけで、`public/PublicBookingApp` も同じ流儀で `/w/` を捌いている。
 */
import { describe, expect, it } from 'vitest'
import { isSitePath, siteSlugOf } from './siteRoute'

describe('isSitePath', () => {
  it.each([
    ['/s/ginza', true],
    ['/s/ginza/', true],
    ['/s/ginza/anything', true],
    ['/s/', false],
    ['/s', false],
    ['/w/ginza', false],
    ['/', false],
    ['/settings', false],
    ['/start', false],
  ])('%s → %s', (path, expected) => {
    expect(isSitePath(path)).toBe(expected)
  })
})

describe('siteSlugOf', () => {
  it('末尾のスラッシュと後続の区間を落として slug を返す', () => {
    expect(siteSlugOf('/s/ginza')).toBe('ginza')
    expect(siteSlugOf('/s/ginza/')).toBe('ginza')
    expect(siteSlugOf('/s/ginza/place')).toBe('ginza')
  })

  it('slug が無ければ空文字（isSitePath が先に弾く）', () => {
    expect(siteSlugOf('/s/')).toBe('')
  })
})
