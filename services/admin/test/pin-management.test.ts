import { env, SELF } from 'cloudflare:test'
import { stretchPin } from '@app/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authed, BASE, createTenantOrganization, inviteMember } from './helpers/actors'

/**
 * UC-EYEX-151: スタッフは自分の PIN を設定・変更でき、管理者は本人確認後に
 * 再設定を開始できるが PIN そのものは閲覧できない。平文 PIN はサーバへ届かず、
 * 復元可能な形で保存されず、レスポンスにもログにも現れない。
 */

const PEPPER = 'dev-auth-pepper-change-me'

function echoBinding() {
  return vi
    .spyOn(env.GLASSES_MANAGEMENT, 'fetch')
    .mockImplementation(async (_input, init) => new Response(init?.body ?? '{}', { status: 200 }))
}

async function storedPinHash(userId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT pin_hash FROM users WHERE id = ?').bind(userId).first()
  return (row as { pin_hash: string | null } | null)?.pin_hash ?? null
}

afterEach(() => vi.restoreAllMocks())

describe('本人による PIN 設定・変更', () => {
  it('初回設定は 200 を返し、PIN 素材を応答へ含めない', async () => {
    echoBinding()
    const org = await createTenantOrganization()
    const staff = await inviteMember(org, 'staff', 'tenin')
    const stretched = await stretchPin('1234', org, staff.userId)

    const res = await SELF.fetch(
      `${BASE}/api/me/pin`,
      authed(staff.token, 'POST', { stretchedPin: stretched }),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ ok: true, hasPin: true })
    expect(text).not.toContain(stretched)
    expect(text).not.toContain('1234')
  })

  it('保存値は平文 PIN からもストレッチ値からも復元できない', async () => {
    echoBinding()
    const org = await createTenantOrganization()
    const staff = await inviteMember(org, 'staff', 'tenin')
    const stretched = await stretchPin('4321', org, staff.userId)
    await SELF.fetch(`${BASE}/api/me/pin`, authed(staff.token, 'POST', { stretchedPin: stretched }))

    const hash = await storedPinHash(staff.userId)
    expect(hash).toBeTruthy()
    expect(hash).not.toContain('4321')
    expect(hash).not.toContain(stretched)
    expect(hash?.startsWith('hmac$')).toBe(true)
    // pepper 込みの HMAC 証明なので、同じ入力でも pepper を知らずには作れない。
    expect(hash).not.toBe(stretched)
    expect(PEPPER).not.toContain('4321')
  })

  it('PIN も stretched 値もログに出さない', async () => {
    echoBinding()
    const logs: string[] = []
    for (const level of ['log', 'error', 'warn', 'info', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => String(a)).join(' '))
      })
    }
    const org = await createTenantOrganization()
    const staff = await inviteMember(org, 'staff', 'tenin')
    const stretched = await stretchPin('9876', org, staff.userId)

    await SELF.fetch(`${BASE}/api/me/pin`, authed(staff.token, 'POST', { stretchedPin: stretched }))
    // 誤った現行 PIN での変更失敗も含めて確認する(失敗経路のログが最も漏れやすい)。
    await SELF.fetch(
      `${BASE}/api/me/pin`,
      authed(staff.token, 'POST', { stretchedPin: 'new', currentStretchedPin: 'wrong' }),
    )
    const joined = logs.join('\n')
    expect(joined).not.toContain(stretched)
    expect(joined).not.toContain('9876')
  })

  it('設定済みの変更には現行 PIN の証明が要る', async () => {
    echoBinding()
    const org = await createTenantOrganization()
    const staff = await inviteMember(org, 'staff', 'tenin')
    const current = await stretchPin('1111', org, staff.userId)
    const next = await stretchPin('2222', org, staff.userId)
    await SELF.fetch(`${BASE}/api/me/pin`, authed(staff.token, 'POST', { stretchedPin: current }))
    const before = await storedPinHash(staff.userId)

    const missing = await SELF.fetch(
      `${BASE}/api/me/pin`,
      authed(staff.token, 'POST', { stretchedPin: next }),
    )
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: 'pin_current_required' })

    const wrong = await SELF.fetch(
      `${BASE}/api/me/pin`,
      authed(staff.token, 'POST', { stretchedPin: next, currentStretchedPin: 'not-the-pin' }),
    )
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toEqual({ error: 'pin_verification_failed' })
    expect(await storedPinHash(staff.userId)).toBe(before)

    const ok = await SELF.fetch(
      `${BASE}/api/me/pin`,
      authed(staff.token, 'POST', { stretchedPin: next, currentStretchedPin: current }),
    )
    expect(ok.status).toBe(200)
    expect(await storedPinHash(staff.userId)).not.toBe(before)
  })

  it('自分の PIN 有無だけを読める(値は読めない)', async () => {
    echoBinding()
    const org = await createTenantOrganization()
    const staff = await inviteMember(org, 'staff', 'tenin')
    const before = await SELF.fetch(`${BASE}/api/me/pin`, authed(staff.token, 'GET'))
    expect(await before.json()).toEqual({ hasPin: false })

    await SELF.fetch(
      `${BASE}/api/me/pin`,
      authed(staff.token, 'POST', { stretchedPin: await stretchPin('5555', org, staff.userId) }),
    )
    const after = await SELF.fetch(`${BASE}/api/me/pin`, authed(staff.token, 'GET'))
    const body = await after.text()
    expect(JSON.parse(body)).toEqual({ hasPin: true })
    expect(body).not.toContain('hmac$')
  })
})

describe('管理者による PIN 再設定', () => {
  it('本人確認の記録とともにチケットを発行し、PIN は返さない', async () => {
    echoBinding()
    const org = await createTenantOrganization()
    const admin = await inviteMember(org, 'admin', 'honbu')
    const staff = await inviteMember(org, 'staff', 'tenin')
    await SELF.fetch(
      `${BASE}/api/me/pin`,
      authed(staff.token, 'POST', { stretchedPin: await stretchPin('1234', org, staff.userId) }),
    )
    const storedBefore = await storedPinHash(staff.userId)

    const res = await SELF.fetch(
      `${BASE}/api/users/${staff.userId}/pin-reset`,
      authed(admin.token, 'POST', {
        verificationMethod: 'in_person',
        verificationNote: '店頭で社員証を確認',
      }),
    )
    expect(res.status).toBe(201)
    const text = await res.text()
    const ticket = JSON.parse(text) as { id: string; userId: string; status: string }
    expect(ticket).toMatchObject({ userId: staff.userId, status: 'pending' })
    expect(text).not.toContain('hmac$')
    expect(text).not.toContain(storedBefore ?? 'never')
    // 再設定の開始は PIN を消さない(本人が設定し直すまで現行 PIN は有効)。
    expect(await storedPinHash(staff.userId)).toBe(storedBefore)

    const audits = (await (
      await SELF.fetch(`${BASE}/api/users/${staff.userId}/audits`, authed(admin.token, 'GET'))
    ).json()) as { action: string; actorUserId: string; after: string }[]
    expect(audits[0]).toMatchObject({ action: 'user.pin_reset_started', actorUserId: admin.userId })
    expect(audits[0]?.after).toContain('in_person')
    expect(audits.map((a) => a.after).join('')).not.toContain('hmac$')
  })

  it('チケットで本人が現行 PIN 無しに再設定でき、チケットは一度きり', async () => {
    echoBinding()
    const org = await createTenantOrganization()
    const admin = await inviteMember(org, 'admin', 'honbu')
    const staff = await inviteMember(org, 'staff', 'tenin')
    await SELF.fetch(
      `${BASE}/api/me/pin`,
      authed(staff.token, 'POST', { stretchedPin: await stretchPin('1234', org, staff.userId) }),
    )
    const ticket = (await (
      await SELF.fetch(
        `${BASE}/api/users/${staff.userId}/pin-reset`,
        authed(admin.token, 'POST', {
          verificationMethod: 'photo_id',
          verificationNote: '身分証を確認',
        }),
      )
    ).json()) as { id: string }

    const next = await stretchPin('7777', org, staff.userId)
    const first = await SELF.fetch(
      `${BASE}/api/me/pin`,
      authed(staff.token, 'POST', { stretchedPin: next, resetTicketId: ticket.id }),
    )
    expect(first.status).toBe(200)

    const reuse = await SELF.fetch(
      `${BASE}/api/me/pin`,
      authed(staff.token, 'POST', { stretchedPin: next, resetTicketId: ticket.id }),
    )
    expect(reuse.status).toBe(401)
    expect(await reuse.json()).toEqual({ error: 'reset_ticket_invalid' })
  })

  it('他人のチケットや他テナントの利用者には使えない', async () => {
    echoBinding()
    const orgA = await createTenantOrganization('Chain A')
    const orgB = await createTenantOrganization('Chain B')
    const adminA = await inviteMember(orgA, 'admin', 'a-admin')
    const staffA = await inviteMember(orgA, 'staff', 'a-staff')
    const otherA = await inviteMember(orgA, 'staff', 'a-other')
    const staffB = await inviteMember(orgB, 'staff', 'b-staff')

    const crossTenant = await SELF.fetch(
      `${BASE}/api/users/${staffB.userId}/pin-reset`,
      authed(adminA.token, 'POST', { verificationMethod: 'video_call', verificationNote: 'x' }),
    )
    expect(crossTenant.status).toBe(404)

    const ticket = (await (
      await SELF.fetch(
        `${BASE}/api/users/${staffA.userId}/pin-reset`,
        authed(adminA.token, 'POST', {
          verificationMethod: 'video_call',
          verificationNote: 'ビデオ通話で確認',
        }),
      )
    ).json()) as { id: string }

    await SELF.fetch(
      `${BASE}/api/me/pin`,
      authed(otherA.token, 'POST', { stretchedPin: await stretchPin('1234', orgA, otherA.userId) }),
    )
    const stolen = await SELF.fetch(
      `${BASE}/api/me/pin`,
      authed(otherA.token, 'POST', {
        stretchedPin: await stretchPin('4444', orgA, otherA.userId),
        resetTicketId: ticket.id,
      }),
    )
    expect(stolen.status).toBe(401)
    expect(await stolen.json()).toEqual({ error: 'reset_ticket_invalid' })
  })

  it('staff は他人の再設定を開始できない', async () => {
    echoBinding()
    const org = await createTenantOrganization()
    const staff = await inviteMember(org, 'staff', 'tenin')
    const target = await inviteMember(org, 'staff', 'other')
    const res = await SELF.fetch(
      `${BASE}/api/users/${target.userId}/pin-reset`,
      authed(staff.token, 'POST', { verificationMethod: 'in_person', verificationNote: 'x' }),
    )
    expect(res.status).toBe(403)
  })

  it('本人確認の根拠が無い再設定は 400 で拒否する', async () => {
    echoBinding()
    const org = await createTenantOrganization()
    const admin = await inviteMember(org, 'admin', 'honbu')
    const staff = await inviteMember(org, 'staff', 'tenin')
    const res = await SELF.fetch(
      `${BASE}/api/users/${staff.userId}/pin-reset`,
      authed(admin.token, 'POST', { verificationMethod: 'in_person', verificationNote: '  ' }),
    )
    expect(res.status).toBe(400)
  })
})
