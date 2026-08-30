import { env, SELF } from 'cloudflare:test'
import { hashStretched } from '@app/shared'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { beforeEach, describe, expect, it } from 'vitest'
import { setUserPin, verifyUserPin } from '../src/worker/auth/pin'
import { authEvents, organizations, users } from '../src/worker/db/schema'

const PEPPER = 'dev-auth-pepper-change-me'
const now = new Date('2026-08-31T00:00:00.000Z')
const db = () => drizzle(env.DB)
const BASE = 'https://admin.test'

async function seedUser(role: 'admin' | 'staff' = 'admin') {
  const organizationId = `org-${crypto.randomUUID()}`
  const userId = `user-${crypto.randomUUID()}`
  const email = `${crypto.randomUUID()}@example.test`
  await db().insert(organizations).values({
    id: organizationId,
    name: 'PIN組織',
    plan: 'free',
    isDisabled: '0',
    isOperator: '0',
    syncRevision: 1,
    createdAt: now.toISOString(),
  })
  await db().insert(users).values({
    id: userId,
    organizationId,
    email,
    passwordHash: null,
    role,
    createdAt: now.toISOString(),
  })
  return { organizationId, userId, email }
}

beforeEach(async () => {
  await db().delete(authEvents)
})

describe('admin-owned personal PIN', () => {
  it('stores only the peppered PIN proof and verifies it within its user and organization', async () => {
    const user = await seedUser()
    const stretchedPin = 'pin-stretched-proof'

    await setUserPin(
      { db: db(), kv: env.AUTH_RL as never, pepper: PEPPER, now },
      {
        organizationId: user.organizationId,
        userId: user.userId,
        stretchedPin,
      },
    )

    const row = await db().select().from(users).where(eq(users.id, user.userId))
    expect(row[0]?.pinHash).toBe(await hashStretched(stretchedPin, PEPPER))
    expect(row[0]?.pinHash).not.toBe(stretchedPin)
    await expect(
      verifyUserPin(
        { db: db(), kv: env.AUTH_RL as never, pepper: PEPPER, now },
        {
          organizationId: user.organizationId,
          userId: user.userId,
          stretchedPin,
        },
      ),
    ).resolves.toEqual({ verified: true })
    await expect(
      verifyUserPin(
        { db: db(), kv: env.AUTH_RL as never, pepper: PEPPER, now },
        {
          organizationId: user.organizationId,
          userId: user.userId,
          stretchedPin: 'wrong-proof',
        },
      ),
    ).resolves.toEqual({ verified: false })
    const events = await db()
      .select()
      .from(authEvents)
      .where(eq(authEvents.organizationId, user.organizationId))
    expect(events.map((event) => event.kind)).toEqual([
      'pin_set',
      'pin_verified',
      'pin_verification_failed',
    ])
    expect(JSON.stringify(events)).not.toContain(stretchedPin)
    expect(JSON.stringify(events)).not.toContain(user.email)
  })

  it('verifies a PIN only through the internal service-binding boundary', async () => {
    const user = await seedUser()
    await setUserPin(
      { db: db(), kv: env.AUTH_RL as never, pepper: PEPPER, now },
      {
        organizationId: user.organizationId,
        userId: user.userId,
        stretchedPin: 'service-pin-proof',
      },
    )
    const missingKey = await SELF.fetch(`${BASE}/api/internal/domain-auth/pin/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: user.organizationId,
        userId: user.userId,
        stretchedPin: 'service-pin-proof',
      }),
    })
    expect(missingKey.status).toBe(401)
    const verified = await SELF.fetch(`${BASE}/api/internal/domain-auth/pin/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': 'dev-domain-auth-key' },
      body: JSON.stringify({
        organizationId: user.organizationId,
        userId: user.userId,
        stretchedPin: 'service-pin-proof',
      }),
    })
    expect(verified.status).toBe(200)
    await expect(verified.json()).resolves.toEqual({ verified: true })
    const crossOrganization = await SELF.fetch(`${BASE}/api/internal/domain-auth/pin/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': 'dev-domain-auth-key' },
      body: JSON.stringify({
        organizationId: `org-${crypto.randomUUID()}`,
        userId: user.userId,
        stretchedPin: 'service-pin-proof',
      }),
    })
    expect(crossOrganization.status).toBe(200)
    await expect(crossOrganization.json()).resolves.toEqual({ verified: false })
  })

  it('locks PIN verification after five failed proofs and does not unlock it with a correct proof', async () => {
    const user = await seedUser()
    await setUserPin(
      { db: db(), kv: env.AUTH_RL as never, pepper: PEPPER, now },
      {
        organizationId: user.organizationId,
        userId: user.userId,
        stretchedPin: 'correct-pin-proof',
      },
    )
    const verify = (stretchedPin: string) =>
      SELF.fetch(`${BASE}/api/internal/domain-auth/pin/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': 'dev-domain-auth-key' },
        body: JSON.stringify({
          organizationId: user.organizationId,
          userId: user.userId,
          stretchedPin,
        }),
      })
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect((await verify(`wrong-${attempt}`)).json()).resolves.toEqual({ verified: false })
    }
    await expect((await verify('correct-pin-proof')).json()).resolves.toEqual({ verified: false })
    const counter = await env.DB.prepare(
      'SELECT failures FROM pin_attempt_counters WHERE organization_id = ? AND user_id = ?',
    )
      .bind(user.organizationId, user.userId)
      .first<{ failures: number }>()
    expect(counter?.failures).toBe(5)
  })

  it('allows a correct proof after the persisted lockout deadline has elapsed', async () => {
    const user = await seedUser()
    await setUserPin(
      { db: db(), kv: env.AUTH_RL as never, pepper: PEPPER, now },
      {
        organizationId: user.organizationId,
        userId: user.userId,
        stretchedPin: 'correct-pin-proof',
      },
    )
    await env.DB.prepare(
      'INSERT INTO pin_attempt_counters (organization_id, user_id, failures, locked_until) VALUES (?, ?, ?, ?)',
    )
      .bind(user.organizationId, user.userId, 5, new Date(now.getTime() - 1).toISOString())
      .run()

    await expect(
      verifyUserPin(
        {
          db: db(),
          kv: env.AUTH_RL as never,
          pepper: PEPPER,
          now: new Date(now.getTime() + 1),
        },
        {
          organizationId: user.organizationId,
          userId: user.userId,
          stretchedPin: 'correct-pin-proof',
        },
      ),
    ).resolves.toEqual({ verified: true })
  })

  it('clears an old PIN lockout when an authorized caller replaces the PIN', async () => {
    const user = await seedUser()
    await setUserPin(
      { db: db(), kv: env.AUTH_RL as never, pepper: PEPPER, now },
      {
        organizationId: user.organizationId,
        userId: user.userId,
        stretchedPin: 'old-pin-proof',
      },
    )
    await env.DB.prepare(
      'INSERT INTO pin_attempt_counters (organization_id, user_id, failures, locked_until) VALUES (?, ?, ?, ?)',
    )
      .bind(
        user.organizationId,
        user.userId,
        5,
        new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      )
      .run()

    await setUserPin(
      { db: db(), kv: env.AUTH_RL as never, pepper: PEPPER, now },
      {
        organizationId: user.organizationId,
        userId: user.userId,
        stretchedPin: 'replacement-pin-proof',
      },
    )

    await expect(
      verifyUserPin(
        { db: db(), kv: env.AUTH_RL as never, pepper: PEPPER, now },
        {
          organizationId: user.organizationId,
          userId: user.userId,
          stretchedPin: 'replacement-pin-proof',
        },
      ),
    ).resolves.toEqual({ verified: true })
  })

  it('allows no more than five concurrent failed PIN proofs for the same user', async () => {
    const user = await seedUser()
    await setUserPin(
      { db: db(), kv: env.AUTH_RL as never, pepper: PEPPER, now },
      {
        organizationId: user.organizationId,
        userId: user.userId,
        stretchedPin: 'correct-pin-proof',
      },
    )

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, attempt) =>
        verifyUserPin(
          {
            db: db(),
            kv: env.AUTH_RL as never,
            pepper: PEPPER,
            now,
          },
          {
            organizationId: user.organizationId,
            userId: user.userId,
            stretchedPin: `wrong-${attempt}`,
          },
        ),
      ),
    )

    expect(results).toEqual(Array.from({ length: 8 }, () => ({ verified: false })))
    const counter = await env.DB.prepare(
      'SELECT failures FROM pin_attempt_counters WHERE organization_id = ? AND user_id = ?',
    )
      .bind(user.organizationId, user.userId)
      .first<{ failures: number }>()
    expect(counter?.failures).toBe(5)
    const audits = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM auth_events WHERE organization_id = ? AND kind = 'pin_verification_failed'",
    )
      .bind(user.organizationId)
      .first<{ count: number }>()
    expect(audits?.count).toBe(5)
  })

  it('rejects the generic internal key and a staff PIN for management reauthentication', async () => {
    const user = await seedUser('staff')
    await setUserPin(
      { db: db(), kv: env.AUTH_RL as never, pepper: PEPPER, now },
      {
        organizationId: user.organizationId,
        userId: user.userId,
        stretchedPin: 'staff-pin-proof',
      },
    )
    const body = JSON.stringify({
      organizationId: user.organizationId,
      userId: user.userId,
      stretchedPin: 'staff-pin-proof',
    })
    const generic = await SELF.fetch(`${BASE}/api/internal/domain-auth/pin/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': 'dev-internal-key' },
      body,
    })
    expect(generic.status).toBe(401)
    const staff = await SELF.fetch(`${BASE}/api/internal/domain-auth/pin/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': 'dev-domain-auth-key' },
      body,
    })
    expect(staff.status).toBe(200)
    await expect(staff.json()).resolves.toEqual({ verified: false })
  })
})
