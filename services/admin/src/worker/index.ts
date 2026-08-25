import {
  AcceptInviteRequest,
  CreateOrganization,
  InviteRequest,
  IssueTokenRequest,
  LoginRequest,
  Organization,
  Plan,
} from '@app/contracts'
import {
  type AuthVariables,
  generateRefreshToken,
  hashToken,
  internalAuth,
  REFRESH_TTL_SECONDS,
  requireRole,
  signAccessToken,
  tenantAuth,
} from '@app/shared'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import { zValidator } from '@hono/zod-validator'
import { desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type MiddlewareHandler } from 'hono'
import { except } from 'hono/combine'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { type AuthDeps, acceptInvite, login, refresh, revokeOne } from './auth/service'
import { invitations, organizations, users } from './db/schema'

// The admin SPA is served by this same Worker (same origin) — no CORS.
export type Bindings = {
  DB: D1Database
  // Rate-limit / lockout counters for login.
  AUTH_RL: KVNamespace
  JWT_SECRET: string
  AUTH_PEPPER: string
  AUTH_DEV_GRANT?: string
  // 招待リンクの基底 URL の明示オーバーライド(プロキシ/カスタムドメイン用)。
  // 未設定ならリクエストの origin から導出する(/invite はこの SPA 自身が配信)。
  INVITE_BASE_URL?: string
}

const REFRESH_COOKIE = 'rt'
const INVITE_TTL_SECONDS = 72 * 60 * 60

const app = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>()

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse()
  console.error('unhandled', err)
  return c.json({ error: 'internal_error' }, 500)
})

function authDeps(c: { env: Bindings }): AuthDeps {
  return {
    db: drizzle(c.env.DB),
    kv: c.env.AUTH_RL,
    pepper: c.env.AUTH_PEPPER,
    jwtSecret: c.env.JWT_SECRET,
  }
}
function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'
}
function setRefreshCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: REFRESH_TTL_SECONDS,
  })
}
/** DB 行 → 契約 Organization。 */
function toOrganization(r: {
  id: string
  name: string
  plan: string
  isDisabled: string
  createdAt: string
}): Organization {
  return Organization.parse({
    id: r.id,
    name: r.name,
    plan: r.plan,
    isDisabled: r.isDisabled === '1',
    createdAt: r.createdAt,
  })
}

/**
 * 運営者(オペレーター)ゲート。この管理コンソールはプラットフォーム運営者の
 * ツールであり、招待で作られた**テナント**の admin には触らせない(触らせると
 * 他組織の一覧・plan 変更・無効化・招待までできるクロステナント権限昇格になる)。
 * `organizations.isOperator === '1'` の org に属するユーザーだけを通す。
 * tenantAuth の後段に置く(c.var.auth 前提)。
 */
function requireOperator(): MiddlewareHandler<{
  Bindings: Bindings
  Variables: AuthVariables
}> {
  return async (c, next) => {
    const orgId = c.get('auth')?.org
    if (!orgId) return c.json({ error: 'unauthorized' }, 401)
    const rows = await drizzle(c.env.DB)
      .select({ isOperator: organizations.isOperator })
      .from(organizations)
      .where(eq(organizations.id, orgId))
    if (rows[0]?.isOperator !== '1') return c.json({ error: 'operator_only' }, 403)
    await next()
  }
}

// Internal endpoints: shared-key guarded (other Workers → service binding).
app.use('/api/internal/*', internalAuth())

// Default-deny: EVERY /api/* route requires an operator-org admin JWT unless
// explicitly exempted (health / auth are public; internal has its own key
// guard above). 新ルートはミドルウェアを足し忘れても保護される。
app.use(
  '/api/*',
  except(
    ['/api/health', '/api/auth/*', '/api/internal/*'],
    tenantAuth(),
    requireRole('admin'),
    requireOperator(),
  ),
)

const routes = app
  .get('/api/health', (c) => c.json({ status: 'ok' as const }))

  // ---- Public auth API (admin SPA, same origin) ----
  // NOTE: このテンプレには「ドメイン Worker が admin へ認証をプロキシする」
  // internal auth API は置いていない(呼び出し元が無いコードは腐る)。その構成に
  // する fork は、この public ルート群と同じ auth/service.ts の関数を
  // /api/internal/auth/* として薄く公開すればよい(cookie 化を境界側で行う)。
  .post('/api/auth/login', zValidator('json', LoginRequest), async (c) => {
    const out = await login(authDeps(c), { ...c.req.valid('json'), ip: clientIp(c) })
    if (!out.ok) {
      if (out.retryAfter) c.header('Retry-After', String(out.retryAfter))
      return c.json({ error: out.error }, out.status)
    }
    setRefreshCookie(c, out.response.refreshToken)
    const { refreshToken: _omit, ...body } = out.response
    return c.json(body, 200)
  })
  .post('/api/auth/refresh', async (c) => {
    const rt = getCookie(c, REFRESH_COOKIE)
    if (!rt) return c.json({ error: 'no_session' }, 401)
    const out = await refresh(authDeps(c), { refreshToken: rt })
    if (!out.ok) {
      // keepCookie(マルチタブ競合の負け側)では削除しない — ブラウザには勝者の
      // 新 cookie が既に載っており、削除応答はそれを巻き添えで消す。
      if (!out.keepCookie) deleteCookie(c, REFRESH_COOKIE, { path: '/' })
      return c.json({ error: out.error }, out.status)
    }
    setRefreshCookie(c, out.response.refreshToken)
    return c.json({ token: out.response.token }, 200)
  })
  .post('/api/auth/logout', async (c) => {
    const rt = getCookie(c, REFRESH_COOKIE)
    if (rt) await revokeOne(authDeps(c), rt)
    deleteCookie(c, REFRESH_COOKIE, { path: '/' })
    return c.json({ ok: true as const })
  })
  // Public invite acceptance (the admin SPA hosts the /invite route). Sets the
  // refresh cookie like login and returns the same body (without refreshToken).
  .post('/api/auth/accept-invite', zValidator('json', AcceptInviteRequest), async (c) => {
    const out = await acceptInvite(authDeps(c), c.req.valid('json'))
    if (!out.ok) return c.json({ error: out.error }, out.status)
    setRefreshCookie(c, out.response.refreshToken)
    const { refreshToken: _omit, ...body } = out.response
    return c.json(body, 200)
  })
  // DEV-ONLY grant: mints an admin JWT with no credential check. Fail-closed
  // unless AUTH_DEV_GRANT === 'true'. Never enable in prod (docs/howto/deploy.md).
  .post('/api/auth/token', zValidator('json', IssueTokenRequest), async (c) => {
    if (c.env.AUTH_DEV_GRANT !== 'true') return c.json({ error: 'not_found' }, 404)
    const { organizationId, role, email } = c.req.valid('json')
    // Dev convenience: ensure the org exists as an OPERATOR org so the minted
    // JWT can use the management API(requireOperator)。dev グラント自体が
    // AUTH_DEV_GRANT でゲートされているので本番には存在しない経路。
    await drizzle(c.env.DB)
      .insert(organizations)
      .values({
        id: organizationId,
        name: organizationId,
        plan: 'free',
        isDisabled: '0',
        isOperator: '1',
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing({ target: organizations.id })
    const token = await signAccessToken(
      { sub: `dev:${organizationId}`, org: organizationId, email, role },
      c.env.JWT_SECRET,
    )
    return c.json({ token })
  })

  // ---- Organizations (operator-admin only, via the default-deny gate) ----
  .get('/api/organizations', async (c) => {
    const db = drizzle(c.env.DB)
    const rows = await db.select().from(organizations).orderBy(desc(organizations.createdAt))
    return c.json(rows.map(toOrganization))
  })
  .post(
    '/api/organizations',
    zValidator('json', CreateOrganization.extend({ plan: Plan.optional() })),
    async (c) => {
      const db = drizzle(c.env.DB)
      const input = c.req.valid('json')
      const org = {
        id: crypto.randomUUID(),
        name: input.name,
        plan: input.plan ?? 'free',
        isDisabled: '0',
        isOperator: '0',
        createdAt: new Date().toISOString(),
      }
      await db.insert(organizations).values(org)
      return c.json(toOrganization(org), 201)
    },
  )
  .patch(
    '/api/organizations/:id',
    zValidator(
      'json',
      z.object({ plan: Plan.optional(), isDisabled: z.boolean().optional() }).strict(),
    ),
    async (c) => {
      const db = drizzle(c.env.DB)
      const id = c.req.param('id')
      const patch = c.req.valid('json')
      // 1 クエリで更新 + 更新後行の取得(SELECT→UPDATE の 2 往復と読み書き競合を防ぐ)。
      const set: Record<string, string> = {}
      if (patch.plan !== undefined) set.plan = patch.plan
      if (patch.isDisabled !== undefined) set.isDisabled = patch.isDisabled ? '1' : '0'
      if (Object.keys(set).length === 0) {
        const rows = await db.select().from(organizations).where(eq(organizations.id, id))
        return rows[0] ? c.json(toOrganization(rows[0])) : c.json({ error: 'not_found' }, 404)
      }
      const updated = await db
        .update(organizations)
        .set(set)
        .where(eq(organizations.id, id))
        .returning()
      const row = updated[0]
      if (!row) return c.json({ error: 'not_found' }, 404)
      return c.json(toOrganization(row))
    },
  )
  // Delete an organization: disable it while keeping the canonical row as an audit trail.
  .delete('/api/organizations/:id', async (c) => {
    const db = drizzle(c.env.DB)
    const id = c.req.param('id')
    const updated = await db
      .update(organizations)
      .set({ isDisabled: '1' })
      .where(eq(organizations.id, id))
      .returning()
    const row = updated[0]
    if (!row) return c.json({ error: 'not_found' }, 404)
    return c.json({ id, isDisabled: true as const })
  })
  // Invite a user (staff by default) to an org and return a manual-share link.
  .post(
    '/api/organizations/:id/invitations',
    // 契約は Zod 単一ソース(@app/contracts の InviteRequest)— インラインで
    // 二重定義しない。
    zValidator('json', InviteRequest),
    async (c) => {
      const db = drizzle(c.env.DB)
      const orgId = c.req.param('id')
      const { email, role } = c.req.valid('json')
      const orgRows = await db.select().from(organizations).where(eq(organizations.id, orgId))
      if (!orgRows[0]) return c.json({ error: 'not_found' }, 404)

      const now = new Date()
      const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase()))
      // クロステナント防御: 別 org に既存の email は招待できない(受諾時に他 org
      // ユーザーのパスワードを上書きする乗っ取り経路になるため)。同 org は再招待扱い。
      if (existing[0] && existing[0].organizationId !== orgId) {
        return c.json({ error: 'email_taken' }, 409)
      }

      const token = generateRefreshToken()
      const inviteStmt = db.insert(invitations).values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        email: email.toLowerCase(),
        tokenHash: await hashToken(token),
        expiresAt: new Date(now.getTime() + INVITE_TTL_SECONDS * 1000).toISOString(),
        consumedAt: null,
        createdAt: now.toISOString(),
      })
      // Create the pending user only if this email is new (re-invite reuses it).
      const userStmt = existing[0]
        ? undefined
        : db.insert(users).values({
            id: crypto.randomUUID(),
            organizationId: orgId,
            email: email.toLowerCase(),
            passwordHash: null,
            role,
            createdAt: now.toISOString(),
          })
      await db.batch(userStmt ? [inviteStmt, userStmt] : [inviteStmt])

      // The acceptance page (/invite) is hosted by this admin SPA, so the
      // request origin is always a correct base. INVITE_BASE_URL is an explicit
      // override for proxy/custom-domain setups(localhost へのフォールバックは
      // 本番でデッドリンクを配る事故になるので置かない)。
      const base = c.env.INVITE_BASE_URL || new URL(c.req.url).origin
      const acceptUrl = `${base}/invite?token=${token}`
      return c.json({ emailed: false as const, acceptUrl }, 201)
    },
  )

export type AppType = typeof routes

export default { fetch: app.fetch }
