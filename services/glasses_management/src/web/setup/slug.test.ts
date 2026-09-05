/**
 * 合い言葉の導出。
 *
 * ここが崩れると、会社のコードから作った既定がそのまま**他社と衝突する形**や
 * **サーバが弾く形**になり、最初の 1 手で必ずつまずく。境界を固定する。
 */
import { describe, expect, it } from 'vitest'
import { defaultSlug, nextSlug } from './StoreForm'

describe('defaultSlug', () => {
  it('1 店目は会社のコードをそのまま使う', () => {
    expect(defaultSlug('eyex', 0)).toBe('eyex')
  })

  it('2 店目以降は連番を足す', () => {
    expect(defaultSlug('eyex', 1)).toBe('eyex-2')
    expect(defaultSlug('eyex', 4)).toBe('eyex-5')
  })

  it('大文字は畳む（サーバは小文字しか受けない）', () => {
    expect(defaultSlug('EYEX', 0)).toBe('eyex')
  })

  it('使えない文字はハイフンに寄せ、連続と前後は落とす', () => {
    expect(defaultSlug('eye_x', 0)).toBe('eye-x')
    expect(defaultSlug('eye__x', 0)).toBe('eye-x')
    expect(defaultSlug('_eyex_', 0)).toBe('eyex')
    expect(defaultSlug('眼鏡eyex', 0)).toBe('eyex')
  })

  it('残りが短すぎるときは、弾かれない形に逃がす', () => {
    // サーバの規則は 2 文字以上。1 文字や空を既定にすると初手で 400 になる。
    expect(defaultSlug('銀', 0)).toBe('store')
    expect(defaultSlug('a', 0)).toBe('store')
    expect(defaultSlug('', 1)).toBe('store-2')
  })

  it('作った既定は、サーバと同じ規則を満たす', () => {
    const pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    for (const source of ['eyex', 'EYE_X', '眼鏡', 'a', '--', 'eye--x']) {
      for (const count of [0, 1, 9]) {
        const slug = defaultSlug(source, count)
        expect(slug.length).toBeGreaterThanOrEqual(2)
        expect(slug).toMatch(pattern)
      }
    }
  })
})

describe('nextSlug', () => {
  it('連番が無ければ 2 を足す', () => {
    expect(nextSlug('eyex')).toBe('eyex-2')
  })

  it('連番があれば 1 つ進める', () => {
    expect(nextSlug('eyex-2')).toBe('eyex-3')
    expect(nextSlug('eyex-9')).toBe('eyex-10')
    expect(nextSlug('eyex-10')).toBe('eyex-11')
  })

  it('末尾が数字でないハイフンは連番と読まない', () => {
    expect(nextSlug('eye-x')).toBe('eye-x-2')
  })

  it('進めた先も、サーバと同じ規則を満たす', () => {
    const pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    let slug = 'eyex'
    for (let i = 0; i < 5; i++) {
      slug = nextSlug(slug)
      expect(slug).toMatch(pattern)
    }
    expect(slug).toBe('eyex-6')
  })
})
