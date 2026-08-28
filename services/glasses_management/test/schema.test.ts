/**
 * スキーマの形（列と index）を固定する。index は「実際に投げるクエリの形」に
 * 合わせて張る決めなので、名前と対象列がずれたら気づけるようにしておく。
 * FK は宣言しない（アプリ層で整合を守る）ことも、ここで確かめる。
 */
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import { organizations, storeMemberships, stores } from '../src/worker/db/schema'

describe('organizations', () => {
  const table = getTableConfig(organizations)

  it('組織 id を主キーにし、外部キーを持たない', () => {
    expect(table.name).toBe('organizations')
    expect(table.columns.filter((c) => c.primary).map((c) => c.name)).toEqual(['id'])
    expect(table.foreignKeys).toHaveLength(0)
  })

  it('毎リクエストで読む列（plan / is_disabled / revision）を持つ', () => {
    const names = table.columns.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining(['name', 'plan', 'is_disabled', 'created_at', 'revision']),
    )
  })
})

describe('stores', () => {
  const table = getTableConfig(stores)

  it('組織で絞って作成順に並べる index を持つ', () => {
    const idx = table.indexes.find((i) => i.config.name === 'stores_org_created_idx')
    expect(idx?.config.columns.map((c) => ('name' in c ? c.name : ''))).toEqual([
      'organization_id',
      'created_at',
    ])
    expect(idx?.config.unique).toBe(false)
  })

  it('slug は組織の中で一意（お客様向け URL の解決に使う）', () => {
    const idx = table.indexes.find((i) => i.config.name === 'stores_org_slug_unique_idx')
    expect(idx?.config.unique).toBe(true)
    expect(idx?.config.columns.map((c) => ('name' in c ? c.name : ''))).toEqual([
      'organization_id',
      'slug',
    ])
  })

  it('外部キーを宣言しない', () => {
    expect(table.foreignKeys).toHaveLength(0)
  })
})

describe('store_memberships', () => {
  const table = getTableConfig(storeMemberships)

  it('「この利用者はこの店舗で何ができるか」を 1 行で引ける', () => {
    const idx = table.indexes.find(
      (i) => i.config.name === 'store_memberships_org_user_store_unique_idx',
    )
    expect(idx?.config.unique).toBe(true)
    expect(idx?.config.columns.map((c) => ('name' in c ? c.name : ''))).toEqual([
      'organization_id',
      'user_id',
      'store_id',
    ])
  })

  it('店舗から引く index も持つ', () => {
    expect(table.indexes.map((i) => i.config.name)).toContain('store_memberships_org_store_idx')
  })

  it('外部キーを宣言しない', () => {
    expect(table.foreignKeys).toHaveLength(0)
  })
})
