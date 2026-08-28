import {
  IssueTokenRequest,
  OrganizationSync,
  type Plan,
  Store,
  StoreMembership,
} from '@app/contracts'
import {
  type AuthVariables,
  internalAuth,
  type OrgResolver,
  requireActiveOrg,
  signAccessToken,
  tenantAuth,
} from '@app/shared'
import type { D1Database, Fetcher, KVNamespace, R2Bucket } from '@cloudflare/workers-types'
import { zValidator } from '@hono/zod-validator'
import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { except } from 'hono/combine'
import { HTTPException } from 'hono/http-exception'
import { organizations, storeMemberships, stores } from './db/schema'

// 明示的に import している（ambient global を使わない）ので、export した AppType は
// それ自体で完結し、web 側が Workers の型なしに読める。SPA も同じ Worker が静的資産
// として配る（同一オリジン）ため、このサービスに CORS は一行も無い。
export type Bindings = {
  DB: D1Database
  /** 短命な状態（冪等キー・受付中の下書き）だけを置く。正本は D1。 */
  SHORT_LIVED: KVNamespace
  /** 受付録音の本体。非公開のまま Worker が仲介し、ダウンロード URL を出さない。 */
  RECORDINGS: R2Bucket
  /** 予約確定メール等の同期送信先（notifier）。Queues は使わない。 */
  NOTIFIER: Fetcher
  /** /api/internal/* を守る共有鍵（admin からの service binding 呼び出し）。 */
  INTERNAL_KEY: string
  /** アクセス JWT の HS256 署名鍵。admin（認証の正本）と同じ値。 */
  JWT_SECRET: string
  /** credential 無しの dev トークングラントを開ける。本番では設定しない。 */
  AUTH_DEV_GRANT?: string
}

const app = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>()

// 予期しない throw だけを 500 に畳む。投げられた HTTPException は自分の応答を保つ。
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse()
  console.error('unhandled', err)
  return c.json({ error: 'internal_error' }, 500)
})

// 内部エンドポイントは共有鍵で守る（admin Worker → service binding）。
// 鍵が未設定なら全拒否（fail close）。
app.use('/api/internal/*', internalAuth())

/** 同期された組織行 → 契約の形。null は「列が無かった頃の行」なので free / 有効として読む。 */
function toOrgFields(r: typeof organizations.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    plan: (r.plan ?? 'free') as Plan,
    isDisabled: r.isDisabled === '1',
    createdAt: r.createdAt,
    revision: Number(r.revision ?? '0'),
  }
}

// 現在のテナントの組織行を解決する。行が無い = admin からまだ届いていない
// （→ 503 not_synced。再試行できる）。無効化されていれば 403。
const orgResolver: OrgResolver = async (orgId, c) => {
  const db = drizzle((c.env as Bindings).DB)
  const rows = await db.select().from(organizations).where(eq(organizations.id, orgId))
  const row = rows[0]
  if (!row) return null
  const { plan, isDisabled } = toOrgFields(row)
  return { plan, isDisabled }
}

// default-deny。/api/* は例外に挙げたもの以外すべてテナント JWT と有効な組織を要求する。
// ルートを足しただけで守られるので、個別にミドルウェアを足して回らない。
// 公開の Web 予約（/api/public/*）は店舗 slug から自分でテナントを解決する。
app.use(
  '/api/*',
  except(
    ['/api/health', '/api/auth/*', '/api/internal/*', '/api/public/*'],
    tenantAuth(),
    requireActiveOrg(orgResolver),
  ),
)

// dev 専用のトークン発行（RPC のルートには載せない）。credential を検査せずに
// 任意の organizationId のアクセス JWT を作る。AUTH_DEV_GRANT === 'true' の
// ときだけ開く（fail close）。実運用では admin の認証へ差し替える。
app.post('/api/auth/token', zValidator('json', IssueTokenRequest), async (c) => {
  if (c.env.AUTH_DEV_GRANT !== 'true') return c.json({ error: 'not_found' }, 404)
  const { organizationId, role, email } = c.req.valid('json')
  // dev の便宜: 同期行を作っておかないと業務 API が 503 になる。
  // 実際の経路では admin が service binding で押し込む。
  const db = drizzle(c.env.DB)
  await db
    .insert(organizations)
    .values({
      id: organizationId,
      name: organizationId,
      plan: 'free',
      isDisabled: '0',
      createdAt: new Date().toISOString(),
      revision: '0',
    })
    .onConflictDoNothing({ target: organizations.id })
  const token = await signAccessToken(
    { sub: `dev:${organizationId}`, org: organizationId, email, role },
    c.env.JWT_SECRET,
  )
  return c.json({ token })
})

// ルートはチェーンする。`typeof routes` が RPC クライアントの型になる。
const routes = app
  .get('/api/health', (c) => c.json({ status: 'ok' as const }))

  // admin からの組織スナップショット。revision は単調増加なので、自分が持つ
  // revision より小さい配信は無視して現在値を返す（古い配信で巻き戻さない）。
  .post('/api/internal/organizations/sync', zValidator('json', OrganizationSync), async (c) => {
    const db = drizzle(c.env.DB)
    const incoming = c.req.valid('json')
    const existing = (
      await db.select().from(organizations).where(eq(organizations.id, incoming.id))
    )[0]
    if (existing && Number(existing.revision ?? '0') > incoming.revision) {
      return c.json(OrganizationSync.parse(toOrgFields(existing)), 200)
    }
    const row = {
      id: incoming.id,
      name: incoming.name,
      plan: incoming.plan,
      isDisabled: incoming.isDisabled ? ('1' as const) : ('0' as const),
      createdAt: incoming.createdAt,
      revision: String(incoming.revision),
    }
    await db
      .insert(organizations)
      .values(row)
      .onConflictDoUpdate({
        target: organizations.id,
        set: {
          name: row.name,
          plan: row.plan,
          isDisabled: row.isDisabled,
          revision: row.revision,
        },
      })
    return c.json(OrganizationSync.parse(incoming), 200)
  })

  // admin の日次照合が読む。admin↔ドメインのずれを検出するための一覧。
  .get('/api/internal/organizations', async (c) => {
    const db = drizzle(c.env.DB)
    const rows = await db.select().from(organizations).orderBy(asc(organizations.createdAt))
    return c.json(OrganizationSync.array().parse(rows.map(toOrgFields)))
  })

  // admin からの担当店舗。担当解除は permissions が空の配信として届くので、
  // 削除の経路を持たずに収束する。
  .post('/api/internal/store-memberships/sync', zValidator('json', StoreMembership), async (c) => {
    const db = drizzle(c.env.DB)
    const membership = c.req.valid('json')
    const row = {
      id: membership.id,
      organizationId: membership.organizationId,
      storeId: membership.storeId,
      userId: membership.userId,
      permissions: membership.permissions.join(' '),
      createdAt: membership.createdAt,
    }
    await db
      .insert(storeMemberships)
      .values(row)
      .onConflictDoUpdate({
        target: storeMemberships.id,
        set: { storeId: row.storeId, userId: row.userId, permissions: row.permissions },
      })
    return c.json(membership, 200)
  })

  // 選択できる店舗の一覧。テナントの org でだけ絞る（店舗の選択はこの後の画面で行う）。
  .get('/api/staff/stores', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const rows = await db
      .select()
      .from(stores)
      .where(eq(stores.organizationId, org))
      .orderBy(asc(stores.createdAt))
    return c.json(
      Store.array().parse(
        rows.map((r) => ({
          id: r.id,
          organizationId: r.organizationId,
          name: r.name,
          slug: r.slug,
          phone: r.phone,
          address: r.address,
          accessNote: r.accessNote,
          isActive: r.isActive === '1',
          createdAt: r.createdAt,
        })),
      ),
    )
  })

// web 側はこの型だけを（type-only で）読み、`hc<AppType>` のクライアントを作る。
export type AppType = typeof routes

export default app
