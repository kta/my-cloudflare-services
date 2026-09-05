/**
 * 業務端末の入口（未認証）。
 *
 * `stores.slug` は全組織横断で一意（`db/schema.ts` の `stores_slug_idx`）で、
 * まさに「`/api/public/**` は未認証で organization_id を持たないので slug 単独で
 * 引く」ためにそう設計されている。その性質にそのまま乗る。
 *
 * 既存の `/api/public/stores/:storeSlug` は流用しない。あちらは `isPublished` で
 * 404 を返す（お客様向け Web 予約の公開状態）。Web 予約を公開していない店でも
 * 店内の iPad は動かなければならない。
 */
import { PublicSite } from '@app/contracts'
import type { D1Database } from '@cloudflare/workers-types'

type SiteTerminalRow = {
  id: string
  name: string
  placeNote: string | null
  kind: 'shared' | 'personal'
}

/**
 * 入口の一覧に出せる端末の条件。**押しても入れない行き先を出さない**ので、
 * ここで落とすものが 3 つある。
 *
 * - 無効な端末（`is_active='0'`）
 * - PIN 未設定の共有端末 —— 照合するものが無い
 * - 持ち主が決まっていない個人端末 —— 誰の PIN を照合するのか決まらない
 *   （店長が端末一覧から割り当てるまで、その端末は使えない状態である）
 */
const SITE_TERMINALS_SQL = `SELECT t.id AS id, t.name AS name, t.place_note AS placeNote, t.kind AS kind
     FROM terminals t
     LEFT JOIN staff s
       ON s.organization_id = t.organization_id AND s.id = t.staff_id AND s.is_active = '1'
    WHERE t.organization_id = ? AND t.store_id = ? AND t.is_active = '1'
      AND ( (t.kind = 'shared'   AND t.pin_hash IS NOT NULL)
         OR (t.kind = 'personal' AND t.staff_id IS NOT NULL AND s.pin_hash IS NOT NULL) )
    ORDER BY t.created_at`

export async function readPublicSite(db: D1Database, slug: string): Promise<PublicSite | null> {
  const store = await db
    .prepare(
      "SELECT id, organization_id AS organizationId, slug, name FROM stores WHERE slug = ? AND is_active = '1'",
    )
    .bind(slug)
    .first<{ id: string; organizationId: string; slug: string; name: string }>()
  if (store === null) return null

  const rows = await db
    .prepare(SITE_TERMINALS_SQL)
    .bind(store.organizationId, store.id)
    .all<SiteTerminalRow>()

  return PublicSite.parse({
    store: { slug: store.slug, name: store.name },
    terminals: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      placeNote: row.placeNote,
      kind: row.kind,
    })),
  })
}

/**
 * slug と terminalId の**両方**で引く。片方だけ正しくても通さない。
 *
 * 存在しない slug・別テナントの端末・無効な端末を呼び出し側が同じ 404 に畳めるよう、
 * ここでは区別せず `null` を返す。区別して返すと、slug の総当たりで
 * 「その店は在る」ことが読み取れてしまう。
 */
export async function resolveSiteTerminal(
  db: D1Database,
  slug: string,
  terminalId: string,
): Promise<{
  organizationId: string
  storeId: string
  kind: 'shared' | 'personal'
  staffId: string | null
} | null> {
  return db
    .prepare(
      `SELECT t.organization_id AS organizationId, t.store_id AS storeId, t.kind AS kind, t.staff_id AS staffId
         FROM terminals t
         JOIN stores s ON s.id = t.store_id AND s.organization_id = t.organization_id
        WHERE s.slug = ? AND t.id = ? AND t.is_active = '1' AND s.is_active = '1'`,
    )
    .bind(slug, terminalId)
    .first<{
      organizationId: string
      storeId: string
      kind: 'shared' | 'personal'
      staffId: string | null
    }>()
}
