/**
 * 新しいお店を登録したときに一緒に置く既定値。
 *
 * ここが空だと「作ったのに何も出ない」お店ができる。値そのものを固定して、
 * あとから既定が黙って変わらないようにする。時刻と id は引数で受け取る
 * （実時刻に依存させない — AGENTS.md のテストの厚み §1）。
 */
import { describe, expect, it } from 'vitest'
import {
  buildNewStore,
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_PURPOSES,
  DEFAULT_SLOT_RULE,
  FOUNDER_PERMISSIONS,
} from '../src/worker/store-provisioning'

const NOW = '2026-09-05T01:00:00.000Z'
const ORG = 'eyex'
const USER = 'user-1'
const STORE_ID = '22222222-2222-4222-8222-222222222222'

function build() {
  let n = 0
  return buildNewStore({
    storeId: STORE_ID,
    organizationId: ORG,
    userId: USER,
    input: { name: '銀座店', slug: 'ginza', phone: '', address: '', accessNote: '' },
    now: NOW,
    nextId: () => `id-${++n}`,
  })
}

describe('buildNewStore', () => {
  it('店舗の行を作り、いま使える状態にする', () => {
    const { store } = build()
    expect(store).toEqual({
      id: STORE_ID,
      organizationId: ORG,
      name: '銀座店',
      slug: 'ginza',
      phone: '',
      address: '',
      accessNote: '',
      isActive: '1',
      createdAt: NOW,
    })
  })

  it('営業時間は 7 曜日ぶん揃え、日曜だけ定休にする', () => {
    const { businessHours } = build()
    expect(businessHours).toHaveLength(7)
    expect(businessHours.map((h) => h.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6])
    const sunday = businessHours.find((h) => h.weekday === 0)
    expect(sunday).toMatchObject({ isClosed: '1', opensAt: null, closesAt: null })
    for (const weekday of [1, 2, 3, 4, 5, 6]) {
      expect(businessHours.find((h) => h.weekday === weekday)).toMatchObject({
        isClosed: '0',
        opensAt: '10:00',
        closesAt: '19:00',
      })
    }
  })

  it('営業時間は受付を止める帯の 2 列を使わない(正本は別表)', () => {
    for (const hour of build().businessHours) {
      expect(hour.breakStart).toBeNull()
      expect(hour.breakEnd).toBeNull()
    }
  })

  it('予約の間隔は刻み 30 分・片付け 10 分・同時 3 件', () => {
    const { slotRule } = build()
    expect(slotRule).toMatchObject({
      organizationId: ORG,
      storeId: STORE_ID,
      slotMinutes: 30,
      cleanupMinutes: 10,
      maxParallel: 3,
      version: 1,
    })
  })

  it('ご来店の目的を 3 件置き、並び順を 0 から振る', () => {
    const { purposes } = build()
    expect(purposes).toHaveLength(3)
    expect(purposes.map((p) => p.sortOrder)).toEqual([0, 1, 2])
    expect(purposes.map((p) => p.nameInternal)).toEqual(DEFAULT_PURPOSES.map((p) => p.nameInternal))
    for (const purpose of purposes) {
      expect(purpose.isActive).toBe('1')
      expect(purpose.isWebPublished).toBe('1')
      expect(purpose.storeId).toBe(STORE_ID)
      expect(purpose.version).toBe(1)
    }
  })

  it('目的の短い名前は台帳の帯に収まる 5 文字以内', () => {
    for (const purpose of DEFAULT_PURPOSES) {
      expect(purpose.nameShort.length).toBeLessThanOrEqual(5)
      expect(purpose.nameShort.length).toBeGreaterThan(0)
    }
  })

  it('設定の版を 1 で置く(保存の楽観ロックが引く行)', () => {
    const { settingsRevision } = build()
    expect(settingsRevision).toMatchObject({
      organizationId: ORG,
      storeId: STORE_ID,
      version: 1,
      updatedAt: NOW,
      createdAt: NOW,
    })
  })

  it('作った人にそのお店の全権限を渡す(登録したのに入れない状態を作らない)', () => {
    const { membership } = build()
    expect(membership.organizationId).toBe(ORG)
    expect(membership.storeId).toBe(STORE_ID)
    expect(membership.userId).toBe(USER)
    expect(membership.permissions.split(' ')).toEqual([...FOUNDER_PERMISSIONS])
    expect(membership.permissions.split(' ')).toContain('settings.manage')
    expect(membership.permissions.split(' ')).toContain('store.manage')
  })

  it('渡す権限に、そのお店の外へ及ぶものを混ぜない', () => {
    // すべて店舗の権限（StorePermission）である。会社を跨ぐ語をここに入れない。
    for (const permission of FOUNDER_PERMISSIONS) {
      expect(permission).toMatch(
        /^(store|reservation|customer|attention|settings|recording|audit|terminal)\./,
      )
    }
  })

  it('id は渡された採番だけを使う(実行のたびに変わらない)', () => {
    const first = build()
    const second = build()
    expect(first.slotRule.id).toBe(second.slotRule.id)
    expect(first.purposes.map((p) => p.id)).toEqual(second.purposes.map((p) => p.id))
  })

  it('すべての行が同じ会社に属する(他社へこぼれない)', () => {
    const built = build()
    const rows = [
      built.store,
      built.slotRule,
      built.settingsRevision,
      built.membership,
      ...built.businessHours,
      ...built.purposes,
    ]
    for (const row of rows) expect(row.organizationId).toBe(ORG)
  })

  it('既定の営業時間と予約の間隔は定数として読める', () => {
    expect(DEFAULT_BUSINESS_HOURS).toHaveLength(7)
    expect(DEFAULT_SLOT_RULE).toEqual({ slotMinutes: 30, cleanupMinutes: 10, maxParallel: 3 })
  })
})
