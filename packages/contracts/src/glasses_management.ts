/**
 * EYEX予約（`glasses_management`）の Zod 単一ソース。
 *
 * このファイルだけが API の入出力の形を持つ。Worker は `zValidator` で受け、
 * 返すときも必ずここのスキーマで `parse` してから `c.json` する。
 * フロントは `hc<AppType>` から型を受け取るので、手書きの型を作らない。
 *
 * 追加はフェーズごとに行う（`specs/glasses_management/features/*`）。
 * P0（基盤）の範囲は、admin から届く組織・店舗権限の同期と、店舗そのものだけ。
 */
import { z } from 'zod'
import { Plan } from './auth'

/* ------------------------------------------------------------------------- *
 * admin → glasses_management の同期
 *
 * admin が組織と利用者の正であり、このドメインはその写しだけを持つ。
 * cross-D1 JOIN ができないので、service binding 経由の push で収束させる。
 * ------------------------------------------------------------------------- */

/**
 * 組織スナップショット。`revision` は admin 側で単調増加し、受け取る側は
 * 自分が持つ revision 未満の配信を無視する（古い配信で巻き戻さない）。
 */
export const OrganizationSync = z.strictObject({
  // admin の正本 id はこのドメインより古く、UUID とは限らない（seed の
  // `org-admin-seed` など）。テナントキーとしては非空であればよい。
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  plan: Plan,
  isDisabled: z.boolean(),
  createdAt: z.string().datetime(),
  revision: z.number().int().nonnegative().default(0),
})
export type OrganizationSync = z.infer<typeof OrganizationSync>

/**
 * 店舗スコープ権限の語彙。許可リストであり、知らない値は落ちる（fail close）。
 * `packages/contracts/src/auth.ts` の `AdministrablePermission` と**同一集合**で
 * あることをテストで固定する（相互 import は循環になるため値で持つ）。
 */
export const StorePermission = z.enum([
  'store.read',
  'store.manage',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.write',
  // 店舗をまたぐ来店・購入・調整履歴。無い場合は選択中店舗の行だけが見え、
  // 他店に行があるという標識も出さない。
  'customer.history',
  // 注意事項（制限情報）。閲覧と、版を伴う公開・改訂・非表示化を分けておき、
  // 見る権限が書く権限に化けないようにする。
  'attention.read',
  'attention.write',
  'attention.publish',
  'attention.revise',
  'attention.hide',
  'settings.read',
  'settings.manage',
  'recording.read',
  'recording.manage',
  'audit.read',
  'terminal.manage',
  // 分析。読み取り専用。予約の行を見せずに数字だけを渡せるように分けてある。
  'analytics.read',
])
export type StorePermission = z.infer<typeof StorePermission>

/**
 * 担当店舗。admin が利用者・標準ロール・担当店舗の源泉で、結果の membership
 * だけがここへ届く。担当解除は行を消さず `permissions` を空にして配る
 * （削除専用の経路を持たずに収束させるため）。
 */
export const StoreMembership = z.strictObject({
  id: z.string().uuid(),
  organizationId: z.string().trim().min(1).max(200),
  storeId: z.string().uuid(),
  userId: z.string().min(1).max(200),
  permissions: StorePermission.array(),
  createdAt: z.string().datetime(),
})
export type StoreMembership = z.infer<typeof StoreMembership>

/* ------------------------------------------------------------------------- *
 * 店舗
 * ------------------------------------------------------------------------- */

/** このドメインが持つ店舗。1 つの組織の下に複数ある。 */
export const Store = z.strictObject({
  id: z.string().uuid(),
  // 正本の組織 id を指す。組織 id は UUID とは限らないが、店舗自身の id は UUID。
  organizationId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  // お客様向け Web 予約の URL（`/w/:storeSlug`）に出る。組織の中で一意。
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  phone: z.string().trim().max(30).default(''),
  address: z.string().trim().max(200).default(''),
  accessNote: z.string().trim().max(200).default(''),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
})
export type Store = z.infer<typeof Store>

/* ------------------------------------------------------------------------- *
 * 操作主体
 * ------------------------------------------------------------------------- */

/**
 * 認可で使う解決済みの操作主体。**リクエスト入力から作らない**（JWT と
 * 端末セッションから組み立てる）。共有端末では個人を推測せず端末を主体にする。
 */
export const Actor = z.strictObject({
  subjectId: z.string().min(1).max(200),
  organizationId: z.string().trim().min(1).max(200),
  kind: z.enum(['staff', 'terminal', 'system', 'customer']),
  terminalId: z.string().uuid().nullable().default(null),
})
export type Actor = z.infer<typeof Actor>
