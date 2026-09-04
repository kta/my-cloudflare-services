import {
  AcceptInviteRequest,
  AdminUserQuery,
  CreateOrganization,
  InviteRequest,
  IssueTokenRequest,
  LoginRequest,
  Organization,
  PinResetStartRequest,
  PinVerificationRequest,
  Plan,
  RefreshRequest,
  SetOwnPinRequest,
  UserAssignmentUpdate,
} from '@app/contracts'
import {
  type AuthVariables,
  generateRefreshToken,
  hashToken,
  internalAuth,
  internalAuthFor,
  REFRESH_TTL_SECONDS,
  requireRole,
  signAccessToken,
  tenantAuth,
} from '@app/shared'
import type { D1Database, Fetcher, KVNamespace } from '@cloudflare/workers-types'
import { zValidator } from '@hono/zod-validator'
import { desc, eq, type SQL, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { except } from 'hono/combine'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { type AuthDeps, acceptInvite, login, refresh, revokeOne } from './auth/service'
import { invitations, organizations, users } from './db/schema'
import { proxyLogin, proxyRefresh, proxyVerifyPin } from './domain-auth'
import { syncOrganization, syncStoreMemberships } from './sync'
import {
  getUser,
  hasPin,
  listAudits,
  listUsers,
  membershipsFor,
  setOwnPin,
  startPinReset,
  type UserAdminDeps,
  updateAssignment,
} from './users/service'

// The admin SPA is served by this same Worker (same origin) — no CORS.
export type Bindings = {
  DB: D1Database
  // Rate-limit / lockout counters for login.
  AUTH_RL: KVNamespace
  JWT_SECRET: string
  AUTH_PEPPER: string
  AUTH_DEV_GRANT?: string
  // Domain service binding. The binding is the only route to the domain
  // Worker; its internal API still requires the shared INTERNAL_KEY.
  GLASSES_MANAGEMENT: Fetcher
  // 招待リンクの基底 URL の明示オーバーライド(プロキシ/カスタムドメイン用)。
  // 未設定ならリクエストの origin から導出する(/invite はこの SPA 自身が配信)。
  INVITE_BASE_URL?: string
  // Secret used by all service-binding internal endpoints. Missing key is a
  // fail-closed configuration error (see internalAuth()).
  INTERNAL_KEY: string
  DOMAIN_AUTH_KEY: string
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
/**
 * 利用者管理・PIN の依存。時刻はここで 1 度だけ注入し、ハンドラやサービス層で
 * `new Date()` を呼ばない。組織 ID は必ず JWT 由来(引数で受け取る)。
 */
function userAdminDeps(c: AdminContext): UserAdminDeps {
  return { db: drizzle(c.env.DB), pepper: c.env.AUTH_PEPPER, now: new Date() }
}
/** 操作主体(JWT の sub)。監査の actor はリクエスト入力から取らない。 */
function actor(c: AdminContext): { organizationId: string; userId: string } {
  const auth = c.get('auth')
  return { organizationId: auth.org, userId: auth.sub }
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

type AdminContext = Context<{ Bindings: Bindings; Variables: AuthVariables }>

/**
 * Propagate the canonical snapshot after the admin D1 write. The source of
 * truth is intentionally retained when the domain is unavailable; callers get
 * a retryable 502 instead of a false success or a rolled-back admin record.
 */
async function syncOrganizationOrError(
  c: AdminContext,
  organization: Organization,
  revision: number,
): Promise<Response | null> {
  const outcome = await syncOrganization(
    c.env.GLASSES_MANAGEMENT,
    c.env.INTERNAL_KEY,
    organization,
    revision,
  )
  if (outcome.ok) return null
  return c.json(
    {
      error: 'organization_sync_failed' as const,
      organizationId: organization.id,
      retryable: outcome.retryable,
    },
    502,
  )
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
app.use('/api/internal/*', async (c, next) => {
  if (c.req.path.startsWith('/api/internal/domain-auth/pin/')) return next()
  return (
    internalAuth() as unknown as MiddlewareHandler<{ Bindings: Bindings; Variables: AuthVariables }>
  )(c, next)
})
app.use(
  '/api/internal/domain-auth/pin/*',
  internalAuthFor('DOMAIN_AUTH_KEY') as unknown as MiddlewareHandler<{
    Bindings: Bindings
    Variables: AuthVariables
  }>,
)

// Default-deny: EVERY /api/* route requires an operator-org admin JWT unless
// explicitly exempted (health / auth are public; internal has its own key
// guard above). 新ルートはミドルウェアを足し忘れても保護される。
app.use(
  '/api/*',
  except(
    [
      '/api/health',
      '/api/auth/*',
      '/api/internal/*',
      // テナントの本部管理者が使う利用者管理と、本人の PIN。運営限定ゲートの
      // 対象外だが、下の専用ミドルウェアで認証・ロールを必ず要求する。
      '/api/users',
      '/api/users/*',
      '/api/me/*',
    ],
    tenantAuth(),
    requireRole('admin'),
    requireOperator(),
  ),
)

/*
 * 利用者管理(UC-EYE-149) は本部管理者だけの操作である。
 *
 * JWT の `role` では判定できない: `STANDARD_ROLE_BASE_ROLE` は店舗管理者にも
 * `admin` を与えるので、ロールだけを門にすると店舗管理者がここを通過し、
 * 自分の標準ロールを本部管理者へ書き換えられてしまう。標準ロールはサーバが
 * D1 から引き直して判定する。
 */
function requireHeadOfficeAdmin(): MiddlewareHandler<{
  Bindings: Bindings
  Variables: AuthVariables
}> {
  return async (c, next) => {
    const { organizationId, userId } = actor(c as AdminContext)
    const self = await getUser(userAdminDeps(c as AdminContext), organizationId, userId)
    if (self?.standardRole !== 'head_office_admin') return c.json({ error: 'forbidden' }, 403)
    await next()
  }
}

app.use('/api/users', tenantAuth(), requireRole('admin'), requireHeadOfficeAdmin())
app.use('/api/users/*', tenantAuth(), requireRole('admin'), requireHeadOfficeAdmin())
// 個人 PIN(UC-EYE-151): 本人であればロールを問わない。対象は常に JWT の sub。
app.use('/api/me/*', tenantAuth())

const routes = app
  .get('/api/health', (c) => c.json({ status: 'ok' as const }))

  // ---- Internal domain authentication proxy ----
  // The internal-key middleware above is the sole guard. These handlers return
  // the opaque refresh token to the calling domain Worker; no cookie is set on
  // this Worker because the browser is connected to the domain origin.
  .post('/api/internal/domain-auth/login', zValidator('json', LoginRequest), async (c) =>
    proxyLogin(c, c.req.valid('json')),
  )
  .post('/api/internal/domain-auth/refresh', zValidator('json', RefreshRequest), async (c) =>
    proxyRefresh(c, c.req.valid('json')),
  )
  .post(
    '/api/internal/domain-auth/pin/verify',
    zValidator('json', PinVerificationRequest),
    async (c) => proxyVerifyPin(c, c.req.valid('json')),
  )

  // ---- Public auth API (admin SPA, same origin) ----
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
        syncRevision: 1,
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
        syncRevision: 1,
        createdAt: new Date().toISOString(),
      }
      await db.insert(organizations).values(org)
      const organization = toOrganization(org)
      const syncFailure = await syncOrganizationOrError(c, organization, org.syncRevision)
      if (syncFailure) return syncFailure
      return c.json(organization, 201)
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
      const set: Record<string, string | SQL> = {}
      if (patch.plan !== undefined) set.plan = patch.plan
      if (patch.isDisabled !== undefined) set.isDisabled = patch.isDisabled ? '1' : '0'
      if (Object.keys(set).length === 0) {
        const rows = await db.select().from(organizations).where(eq(organizations.id, id))
        return rows[0] ? c.json(toOrganization(rows[0])) : c.json({ error: 'not_found' }, 404)
      }
      set.syncRevision = sql`${organizations.syncRevision} + 1`
      const updated = await db
        .update(organizations)
        .set(set)
        .where(eq(organizations.id, id))
        .returning()
      const row = updated[0]
      if (!row) return c.json({ error: 'not_found' }, 404)
      const organization = toOrganization(row)
      const syncFailure = await syncOrganizationOrError(c, organization, row.syncRevision)
      if (syncFailure) return syncFailure
      return c.json(organization)
    },
  )
  // Delete an organization: disable it while keeping the canonical row as an audit trail.
  .delete('/api/organizations/:id', async (c) => {
    const db = drizzle(c.env.DB)
    const id = c.req.param('id')
    const updated = await db
      .update(organizations)
      .set({ isDisabled: '1', syncRevision: sql`${organizations.syncRevision} + 1` })
      .where(eq(organizations.id, id))
      .returning()
    const row = updated[0]
    if (!row) return c.json({ error: 'not_found' }, 404)
    const organization = toOrganization(row)
    const syncFailure = await syncOrganizationOrError(c, organization, row.syncRevision)
    if (syncFailure) return syncFailure
    return c.json({ id, isDisabled: true as const })
  })
  // Explicit recovery path for a downstream sync outage. This only reads the
  // canonical row and retries the exact same snapshot; it never creates a new
  // revision or lets a tenant admin choose another organization's payload.
  .post('/api/organizations/:id/sync', async (c) => {
    const db = drizzle(c.env.DB)
    const id = c.req.param('id')
    const rows = await db.select().from(organizations).where(eq(organizations.id, id))
    const row = rows[0]
    if (!row) return c.json({ error: 'not_found' }, 404)
    const organization = toOrganization(row)
    const syncFailure = await syncOrganizationOrError(c, organization, row.syncRevision)
    if (syncFailure) return syncFailure
    return c.json({ ...organization, revision: row.syncRevision }, 200)
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

  // ---- User / role / store assignment administration (UC-EYE-149) ----
  .get('/api/users', zValidator('query', AdminUserQuery), async (c) => {
    const { organizationId } = actor(c)
    return c.json(await listUsers(userAdminDeps(c), organizationId, c.req.valid('query')))
  })
  .get('/api/users/:id', async (c) => {
    const { organizationId } = actor(c)
    const view = await getUser(userAdminDeps(c), organizationId, c.req.param('id'))
    return view ? c.json(view) : c.json({ error: 'not_found' as const }, 404)
  })
  .patch('/api/users/:id', zValidator('json', UserAssignmentUpdate), async (c) => {
    const { organizationId, userId } = actor(c)
    const deps = userAdminDeps(c)
    const changed = await updateAssignment(deps, {
      organizationId,
      actorUserId: userId,
      userId: c.req.param('id'),
      update: c.req.valid('json'),
    })
    if (!changed) return c.json({ error: 'not_found' as const }, 404)
    const outcome = await syncStoreMemberships(
      c.env.GLASSES_MANAGEMENT,
      c.env.INTERNAL_KEY,
      changed.memberships,
    )
    if (!outcome.ok) {
      return c.json(
        {
          error: 'store_membership_sync_failed' as const,
          userId: changed.view.id,
          retryable: outcome.retryable,
        },
        502,
      )
    }
    return c.json(changed.view)
  })
  // 同期障害からの明示的な回復。正本を読み直して同じ snapshot を再送するだけで、
  // 新しい変更も他組織の payload も作らない。
  .post('/api/users/:id/sync', async (c) => {
    const { organizationId } = actor(c)
    const memberships = await membershipsFor(userAdminDeps(c), organizationId, c.req.param('id'))
    if (!memberships) return c.json({ error: 'not_found' as const }, 404)
    const outcome = await syncStoreMemberships(
      c.env.GLASSES_MANAGEMENT,
      c.env.INTERNAL_KEY,
      memberships,
    )
    if (!outcome.ok) {
      return c.json(
        {
          error: 'store_membership_sync_failed' as const,
          userId: c.req.param('id'),
          retryable: outcome.retryable,
        },
        502,
      )
    }
    return c.json({ userId: c.req.param('id'), synced: memberships.length })
  })
  .get('/api/users/:id/audits', async (c) => {
    const { organizationId } = actor(c)
    const audits = await listAudits(userAdminDeps(c), organizationId, c.req.param('id'))
    return audits ? c.json(audits) : c.json({ error: 'not_found' as const }, 404)
  })
  // ---- Personal PIN (UC-EYE-151) ----
  // 管理者は本人確認の記録つきで再設定を開始できるだけで、PIN は読めず設定もできない。
  .post('/api/users/:id/pin-reset', zValidator('json', PinResetStartRequest), async (c) => {
    const { organizationId, userId } = actor(c)
    const outcome = await startPinReset(userAdminDeps(c), {
      organizationId,
      actorUserId: userId,
      userId: c.req.param('id'),
      input: c.req.valid('json'),
    })
    if (!outcome.ok) return c.json({ error: 'not_found' as const }, 404)
    return c.json(outcome.ticket, 201)
  })
  .get('/api/me/pin', async (c) => {
    const { organizationId, userId } = actor(c)
    const present = await hasPin(userAdminDeps(c), organizationId, userId)
    if (present === null) return c.json({ error: 'not_found' as const }, 404)
    return c.json({ hasPin: present })
  })
  .post('/api/me/pin', zValidator('json', SetOwnPinRequest), async (c) => {
    const { organizationId, userId } = actor(c)
    const outcome = await setOwnPin(userAdminDeps(c), {
      organizationId,
      userId,
      input: c.req.valid('json'),
    })
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status)
    return c.json({ ok: true as const, hasPin: true as const })
  })

export type AppType = typeof routes

export default { fetch: app.fetch }
