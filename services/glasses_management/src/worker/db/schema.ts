import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/*
 * D1 は SQLite。このリポジトリの決め:
 * - 外部キーを宣言しない。整合性はアプリ層で守る。
 * - id はアプリ生成（`crypto.randomUUID()`）。DB 側の自動採番を使わない。
 * - ドメインの全行が `organization_id` を持ち、全クエリで JWT の `org` により絞る。
 * - 真偽値は text の '0' / '1'。日時は ISO8601 文字列。日付は 'YYYY-MM-DD'、時刻は 'HH:MM'。
 * - DDL の DEFAULT に意味を持たせない（時刻・状態・フラグはアプリ層で入れる）。
 * - 時間順の並びは created_at で取る（UUID v4 は並び替えに使えない）。
 *
 * テーブルはフェーズごとに増える（specs/glasses_management/design/03-data-model.md）。
 * ここにあるのは P0（基盤）の 3 つ。
 */

/**
 * 組織の写し。正本は admin ドメインにあり、service binding で押し込まれる。
 * D1 はデータベースをまたいで JOIN できないので、ここに写しを持ってアプリ層で突き合わせる。
 * plan / is_disabled はテナントの毎リクエストで読む（admin 側の変更が即座に効く）。
 * revision は admin 側で単調増加し、古い配信を無視するために使う。
 */
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  plan: text('plan'), // 'free' | 'contracted'（null は 'free' 扱い）
  isDisabled: text('is_disabled'), // '0' | '1'（null は '0' 扱い）
  createdAt: text('created_at').notNull(),
  revision: text('revision'), // 整数の文字列。null は 0 扱い
})

/**
 * 店舗。予約・台帳・受付条件・Web 予約公開のすべてがこの単位に属する。
 * slug はお客様向け Web 予約の URL（/w/:storeSlug）に出るので、組織の中で一意。
 */
export const stores = sqliteTable(
  'stores',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    phone: text('phone').notNull().default(''),
    address: text('address').notNull().default(''),
    accessNote: text('access_note').notNull().default(''),
    isActive: text('is_active').notNull(), // '0' | '1'
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 一覧は組織で絞って並べる
    index('stores_org_created_idx').on(t.organizationId, t.createdAt),
    // 公開 URL の解決（/w/:storeSlug）と、組織内での一意性
    uniqueIndex('stores_org_slug_unique_idx').on(t.organizationId, t.slug),
  ],
)

/**
 * 担当店舗の写し。admin が利用者・標準ロール・担当店舗の源泉で、結果の membership
 * だけがここへ届く。担当解除は行を消さず permissions を空文字にして配るので、
 * 削除専用の経路を持たずに収束する。permissions は空白区切りの許可リスト。
 */
export const storeMemberships = sqliteTable(
  'store_memberships',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    userId: text('user_id').notNull(),
    permissions: text('permissions').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 「この利用者はこの店舗で何ができるか」を 1 行で引く
    uniqueIndex('store_memberships_org_user_store_unique_idx').on(
      t.organizationId,
      t.userId,
      t.storeId,
    ),
    index('store_memberships_org_store_idx').on(t.organizationId, t.storeId),
  ],
)
