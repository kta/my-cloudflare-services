import { hashStretched, verifyStretched } from '@app/shared'
import type { KVNamespace } from '@cloudflare/workers-types'
import { and, eq, sql } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { authEvents, pinAttemptCounters, users } from '../db/schema'

type Db = DrizzleD1Database<Record<string, never>>

export type PinDeps = {
  db: Db
  /** Legacy injection retained while PIN limiting is D1-atomic. */
  kv?: KVNamespace
  pepper: string
  now: Date
}

export const MAX_PIN_FAILURES = 5
export const PIN_LOCKOUT_WINDOW_SECONDS = 15 * 60

type PinIdentity = {
  organizationId: string
  userId: string
  stretchedPin: string
}

async function loadUser(deps: PinDeps, identity: Pick<PinIdentity, 'organizationId' | 'userId'>) {
  return (
    await deps.db
      .select()
      .from(users)
      .where(and(eq(users.organizationId, identity.organizationId), eq(users.id, identity.userId)))
  )[0]
}

/** Store a PIN proof atomically with its non-sensitive security audit event. */
export async function setUserPin(deps: PinDeps, identity: PinIdentity): Promise<void> {
  const user = await loadUser(deps, identity)
  if (!user) throw new Error('pin identity not found')
  const pinHash = await hashStretched(identity.stretchedPin, deps.pepper)
  await deps.db.batch([
    deps.db
      .update(users)
      .set({ pinHash })
      .where(and(eq(users.organizationId, identity.organizationId), eq(users.id, identity.userId))),
    // PIN replacement is an authenticated credential reset. Clear only this
    // exact subject's persisted limiter in the same transaction as the hash.
    deps.db
      .delete(pinAttemptCounters)
      .where(
        and(
          eq(pinAttemptCounters.organizationId, identity.organizationId),
          eq(pinAttemptCounters.userId, identity.userId),
        ),
      ),
    deps.db.insert(authEvents).values({
      id: crypto.randomUUID(),
      organizationId: identity.organizationId,
      // auth_events predates PIN support and has a non-null email column.
      // Store a non-PII subject surrogate for PIN events, never the email.
      email: `user:${user.id}`,
      kind: 'pin_set',
      ip: null,
      createdAt: deps.now.toISOString(),
    }),
  ])
}

/** Verify a PIN proof without exposing credential state or the stored proof. */
export async function verifyUserPin(
  deps: PinDeps,
  identity: PinIdentity,
): Promise<{ verified: boolean }> {
  // Claim one of the five attempts atomically before performing the HMAC
  // comparison. Concurrent callers that cannot increment never test a PIN.
  const currentTime = deps.now.toISOString()
  const lockUntil = new Date(deps.now.getTime() + PIN_LOCKOUT_WINDOW_SECONDS * 1000).toISOString()
  const claimed = await deps.db.all(sql`
    INSERT INTO pin_attempt_counters (organization_id, user_id, failures, locked_until)
    VALUES (${identity.organizationId}, ${identity.userId}, 1, NULL)
    ON CONFLICT(organization_id, user_id) DO UPDATE SET
      failures = CASE
        WHEN locked_until IS NOT NULL AND locked_until <= ${currentTime} THEN 1
        ELSE failures + 1
      END,
      locked_until = CASE
        WHEN locked_until IS NOT NULL AND locked_until <= ${currentTime} THEN NULL
        WHEN failures + 1 >= ${MAX_PIN_FAILURES} THEN ${lockUntil}
        ELSE locked_until
      END
    WHERE locked_until IS NULL OR locked_until <= ${currentTime} OR failures < ${MAX_PIN_FAILURES}
    RETURNING failures
  `)
  if (claimed.length === 0) return { verified: false }
  const user = await loadUser(deps, identity)
  const verified =
    user?.pinHash === undefined || user.pinHash === null
      ? false
      : await verifyStretched(identity.stretchedPin, deps.pepper, user.pinHash)
  if (user) {
    if (verified)
      await deps.db
        .delete(pinAttemptCounters)
        .where(
          and(
            eq(pinAttemptCounters.organizationId, identity.organizationId),
            eq(pinAttemptCounters.userId, identity.userId),
          ),
        )
    await deps.db.insert(authEvents).values({
      id: crypto.randomUUID(),
      organizationId: identity.organizationId,
      email: `user:${user.id}`,
      kind: verified ? 'pin_verified' : 'pin_verification_failed',
      ip: null,
      createdAt: deps.now.toISOString(),
    })
  }
  return { verified }
}
