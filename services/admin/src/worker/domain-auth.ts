/**
 * Domain authentication proxy handlers.
 *
 * `admin` remains the only owner of credentials, refresh-token rotation, and
 * lockout state. A domain Worker calls these handlers over a service binding
 * protected by `x-internal-key`; the refresh token is returned in the response
 * body so the domain Worker can place it in its own HttpOnly cookie boundary.
 * This module deliberately never reads or writes cookies.
 */
import type {
  LoginRequest as LoginInput,
  PinVerificationRequest as PinVerificationInput,
  RefreshRequest as RefreshInput,
} from '@app/contracts'
import type { AuthVariables } from '@app/shared'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { verifyUserPin } from './auth/pin'
import { type AuthDeps, login, refresh } from './auth/service'
import { users } from './db/schema'

/** Bindings required by the proxy handlers. Extra bindings are allowed by the
 * admin Worker's concrete environment (for example GLASSES_MANAGEMENT). */
export type DomainAuthBindings = {
  DB: D1Database
  AUTH_RL: KVNamespace
  JWT_SECRET: string
  AUTH_PEPPER: string
  INTERNAL_KEY: string
}

export type DomainAuthContext<T extends DomainAuthBindings = DomainAuthBindings> = Context<{
  Bindings: T
  Variables: AuthVariables
}>

function authDeps<T extends DomainAuthBindings>(c: DomainAuthContext<T>): AuthDeps {
  return {
    db: drizzle(c.env.DB),
    kv: c.env.AUTH_RL,
    pepper: c.env.AUTH_PEPPER,
    jwtSecret: c.env.JWT_SECRET,
  }
}

function clientIp<T extends DomainAuthBindings>(c: DomainAuthContext<T>): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'
}

/**
 * Handle an internal login request. The response intentionally retains the
 * opaque refresh token: only the receiving domain Worker sees this response,
 * and it must establish its own HttpOnly cookie on behalf of the browser.
 */
export async function proxyLogin<T extends DomainAuthBindings>(
  c: DomainAuthContext<T>,
  input: LoginInput,
): Promise<Response> {
  const outcome = await login(authDeps(c), { ...input, ip: clientIp(c) })
  if (!outcome.ok) {
    if (outcome.retryAfter !== undefined) c.header('Retry-After', String(outcome.retryAfter))
    return c.json({ error: outcome.error }, outcome.status)
  }
  return c.json(outcome.response, 200)
}

/** Handle an internal refresh rotation request without creating cookies here. */
export async function proxyRefresh<T extends DomainAuthBindings>(
  c: DomainAuthContext<T>,
  input: RefreshInput,
): Promise<Response> {
  const outcome = await refresh(authDeps(c), input)
  if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status)
  return c.json(outcome.response, 200)
}

/** Verify a personal PIN without exposing a credential hash beyond admin. */
export async function proxyVerifyPin<T extends DomainAuthBindings>(
  c: DomainAuthContext<T>,
  input: PinVerificationInput,
): Promise<Response> {
  const result = await verifyUserPin(
    {
      db: drizzle(c.env.DB),
      kv: c.env.AUTH_RL,
      pepper: c.env.AUTH_PEPPER,
      now: new Date(),
    },
    input,
  )
  if (!result.verified) return c.json(result)
  const user = (
    await drizzle(c.env.DB)
      .select({ role: users.role })
      .from(users)
      .where(and(eq(users.organizationId, input.organizationId), eq(users.id, input.userId)))
  )[0]
  return c.json({ verified: user?.role === 'admin' })
}
