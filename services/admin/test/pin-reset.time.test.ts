import { env, SELF } from 'cloudflare:test'
import { stretchPin } from '@app/shared'
import { drizzle } from 'drizzle-orm/d1'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PIN_RESET_TTL_SECONDS, setOwnPin, startPinReset } from '../src/worker/users/service'
import { BASE, createTenantOrganization, inviteMember, JSON_HEADERS } from './helpers/actors'

/**
 * UC-EYE-151 の期限境界。時刻は必ず注入し、ちょうど・±1 秒を固定する
 * (実時刻に依存させない)。
 */

const PEPPER = 'dev-auth-pepper-change-me'
const ISSUED_AT = new Date('2026-08-27T09:00:00.000Z')

function deps(now: Date) {
  return { db: drizzle(env.DB), pepper: PEPPER, now }
}

async function subject() {
  vi.spyOn(env.GLASSES_MANAGEMENT, 'fetch').mockImplementation(
    async (_input, init) => new Response(init?.body ?? '{}', { status: 200 }),
  )
  const organizationId = await createTenantOrganization()
  const admin = await inviteMember(organizationId, 'admin', 'honbu')
  const staff = await inviteMember(organizationId, 'staff', 'tenin')
  await SELF.fetch(`${BASE}/api/me/pin`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, authorization: `Bearer ${staff.token}` },
    body: JSON.stringify({ stretchedPin: await stretchPin('1234', organizationId, staff.userId) }),
  })
  return { organizationId, admin, staff }
}

async function issueTicket(organizationId: string, actorUserId: string, userId: string) {
  const outcome = await startPinReset(deps(ISSUED_AT), {
    organizationId,
    actorUserId,
    userId,
    input: { verificationMethod: 'in_person', verificationNote: '店頭で確認' },
  })
  if (!outcome.ok) throw new Error(`ticket issue failed: ${outcome.error}`)
  return outcome.ticket
}

afterEach(() => vi.restoreAllMocks())

describe('PIN 再設定チケットの期限境界', () => {
  it('有効期限は発行時刻 + TTL ちょうどである', async () => {
    const { organizationId, admin, staff } = await subject()
    const ticket = await issueTicket(organizationId, admin.userId, staff.userId)
    expect(ticket.expiresAt).toBe(
      new Date(ISSUED_AT.getTime() + PIN_RESET_TTL_SECONDS * 1000).toISOString(),
    )
    expect(ticket.createdAt).toBe(ISSUED_AT.toISOString())
  })

  it('期限の 1 秒前は使える', async () => {
    const { organizationId, admin, staff } = await subject()
    const ticket = await issueTicket(organizationId, admin.userId, staff.userId)
    const at = new Date(Date.parse(ticket.expiresAt) - 1000)
    const outcome = await setOwnPin(deps(at), {
      organizationId,
      userId: staff.userId,
      input: {
        stretchedPin: await stretchPin('2222', organizationId, staff.userId),
        resetTicketId: ticket.id,
      },
    })
    expect(outcome).toEqual({ ok: true })
  })

  it('期限ちょうどは失効している', async () => {
    const { organizationId, admin, staff } = await subject()
    const ticket = await issueTicket(organizationId, admin.userId, staff.userId)
    const outcome = await setOwnPin(deps(new Date(ticket.expiresAt)), {
      organizationId,
      userId: staff.userId,
      input: {
        stretchedPin: await stretchPin('3333', organizationId, staff.userId),
        resetTicketId: ticket.id,
      },
    })
    expect(outcome).toEqual({ ok: false, error: 'reset_ticket_invalid', status: 401 })
  })

  it('期限の 1 秒後も失効している', async () => {
    const { organizationId, admin, staff } = await subject()
    const ticket = await issueTicket(organizationId, admin.userId, staff.userId)
    const at = new Date(Date.parse(ticket.expiresAt) + 1000)
    const outcome = await setOwnPin(deps(at), {
      organizationId,
      userId: staff.userId,
      input: {
        stretchedPin: await stretchPin('4444', organizationId, staff.userId),
        resetTicketId: ticket.id,
      },
    })
    expect(outcome).toEqual({ ok: false, error: 'reset_ticket_invalid', status: 401 })
  })

  it('失効したチケットでは PIN が置き換わらない', async () => {
    const { organizationId, admin, staff } = await subject()
    const ticket = await issueTicket(organizationId, admin.userId, staff.userId)
    const before = (await env.DB.prepare('SELECT pin_hash FROM users WHERE id = ?')
      .bind(staff.userId)
      .first()) as { pin_hash: string } | null
    await setOwnPin(deps(new Date(Date.parse(ticket.expiresAt) + 1000)), {
      organizationId,
      userId: staff.userId,
      input: {
        stretchedPin: await stretchPin('5555', organizationId, staff.userId),
        resetTicketId: ticket.id,
      },
    })
    const after = (await env.DB.prepare('SELECT pin_hash FROM users WHERE id = ?')
      .bind(staff.userId)
      .first()) as { pin_hash: string } | null
    expect(after?.pin_hash).toBe(before?.pin_hash)
  })
})
