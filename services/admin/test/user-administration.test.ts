import { env, SELF } from 'cloudflare:test'
import { STANDARD_ROLE_PERMISSIONS } from '@app/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authed, BASE, createTenantOrganization, inviteMember, storeId } from './helpers/actors'

/**
 * UC-EYEX-149: 本部管理者が利用者・標準ロール・担当店舗を一覧/検索し、権限差分を
 * 確認して変更する。変更は glasses_management へ membership として配られ、
 * 変更前後が監査に残る。
 */

type UserView = {
  id: string
  email: string
  role: 'admin' | 'staff'
  standardRole: string
  assignments: { storeId: string; permissions: string[] }[]
  permissionDifference: { missing: string[]; extra: string[] }
  hasPin: boolean
}

const INTERNAL_KEY = 'dev-internal-key'

function echoBinding() {
  return vi.spyOn(env.GLASSES_MANAGEMENT, 'fetch').mockImplementation(
    async (_input, init) =>
      new Response(init?.body ?? '{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
}

async function listUsers(token: string, query = ''): Promise<UserView[]> {
  const res = await SELF.fetch(`${BASE}/api/users${query}`, authed(token, 'GET'))
  expect(res.status).toBe(200)
  return (await res.json()) as UserView[]
}

afterEach(() => vi.restoreAllMocks())

describe('利用者一覧と検索', () => {
  it('自組織の利用者だけを、標準ロールと権限差分つきで返す', async () => {
    echoBinding()
    const org = await createTenantOrganization()
    const admin = await inviteMember(org, 'admin', 'honbu')
    const staff = await inviteMember(org, 'staff', 'tenin')

    const users = await listUsers(admin.token)
    const ids = users.map((u) => u.id)
    expect(ids).toContain(admin.userId)
    expect(ids).toContain(staff.userId)

    const staffView = users.find((u) => u.id === staff.userId)
    expect(staffView?.standardRole).toBe('staff')
    expect(staffView?.permissionDifference).toEqual({ missing: [], extra: [] })
    expect(staffView?.hasPin).toBe(false)
    expect(JSON.stringify(staffView)).not.toContain('passwordHash')
  })

  it('他テナントの利用者は一覧にも個別取得にも現れない', async () => {
    echoBinding()
    const orgA = await createTenantOrganization('Chain A')
    const orgB = await createTenantOrganization('Chain B')
    const adminA = await inviteMember(orgA, 'admin', 'a-admin')
    const staffB = await inviteMember(orgB, 'staff', 'b-staff')

    const users = await listUsers(adminA.token)
    expect(users.map((u) => u.id)).not.toContain(staffB.userId)

    const direct = await SELF.fetch(
      `${BASE}/api/users/${staffB.userId}`,
      authed(adminA.token, 'GET'),
    )
    expect(direct.status).toBe(404)
  })

  it('email・標準ロール・担当店舗で絞り込める', async () => {
    echoBinding()
    const org = await createTenantOrganization()
    const admin = await inviteMember(org, 'admin', 'honbu')
    const staff = await inviteMember(org, 'staff', 'tenin')
    const shop = storeId()

    const assigned = await SELF.fetch(
      `${BASE}/api/users/${staff.userId}`,
      authed(admin.token, 'PATCH', { standardRole: 'store_manager', storeIds: [shop] }),
    )
    expect(assigned.status).toBe(200)

    expect(
      (await listUsers(admin.token, `?q=${encodeURIComponent(staff.email)}`)).map((u) => u.id),
    ).toEqual([staff.userId])
    expect((await listUsers(admin.token, '?standardRole=store_manager')).map((u) => u.id)).toEqual([
      staff.userId,
    ])
    expect((await listUsers(admin.token, `?storeId=${shop}`)).map((u) => u.id)).toEqual([
      staff.userId,
    ])
    expect(await listUsers(admin.token, `?storeId=${storeId()}`)).toEqual([])
  })

  it('標準ロールから外れた実効権限を差分として示す', async () => {
    echoBinding()
    const org = await createTenantOrganization()
    const admin = await inviteMember(org, 'admin', 'honbu')
    const staff = await inviteMember(org, 'staff', 'tenin')
    const shop = storeId()

    const res = await SELF.fetch(
      `${BASE}/api/users/${staff.userId}`,
      authed(admin.token, 'PATCH', {
        standardRole: 'staff',
        storeIds: [shop],
        permissions: ['store.read', 'reservation.read', 'audit.read'],
      }),
    )
    expect(res.status).toBe(200)
    const view = (await res.json()) as UserView
    expect(view.permissionDifference.extra).toEqual(['audit.read'])
    expect(view.permissionDifference.missing).toEqual(
      STANDARD_ROLE_PERMISSIONS.staff
        .filter((p) => !['store.read', 'reservation.read'].includes(p))
        .slice()
        .sort(),
    )
  })
})

describe('ロールと担当店舗の変更', () => {
  it('標準ロール変更が認証ロールへ反映され、membership が domain へ配られる', async () => {
    const fetchSpy = echoBinding()
    const org = await createTenantOrganization()
    const admin = await inviteMember(org, 'admin', 'honbu')
    const staff = await inviteMember(org, 'staff', 'tenin')
    const shop = storeId()
    fetchSpy.mockClear()

    const res = await SELF.fetch(
      `${BASE}/api/users/${staff.userId}`,
      authed(admin.token, 'PATCH', { standardRole: 'store_manager', storeIds: [shop] }),
    )
    expect(res.status).toBe(200)
    const view = (await res.json()) as UserView
    expect(view.role).toBe('admin')
    expect(view.assignments).toEqual([
      { storeId: shop, permissions: [...STANDARD_ROLE_PERMISSIONS.store_manager] },
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [input, init] = fetchSpy.mock.calls[0] ?? []
    const request = new Request(input as RequestInfo, init as RequestInit)
    expect(request.url).toContain('/api/internal/store-memberships/sync')
    expect(request.headers.get('x-internal-key')).toBe(INTERNAL_KEY)
    await expect(request.json()).resolves.toMatchObject({
      organizationId: org,
      storeId: shop,
      userId: staff.userId,
      permissions: [...STANDARD_ROLE_PERMISSIONS.store_manager],
    })
  })

  it('担当店舗の解除は権限ゼロの membership として domain へ配られる', async () => {
    const fetchSpy = echoBinding()
    const org = await createTenantOrganization()
    const admin = await inviteMember(org, 'admin', 'honbu')
    const staff = await inviteMember(org, 'staff', 'tenin')
    const shopA = storeId()
    const shopB = storeId()

    await SELF.fetch(
      `${BASE}/api/users/${staff.userId}`,
      authed(admin.token, 'PATCH', { standardRole: 'staff', storeIds: [shopA, shopB] }),
    )
    fetchSpy.mockClear()

    const res = await SELF.fetch(
      `${BASE}/api/users/${staff.userId}`,
      authed(admin.token, 'PATCH', { storeIds: [shopA] }),
    )
    expect(res.status).toBe(200)
    const view = (await res.json()) as UserView
    expect(view.assignments.map((a) => a.storeId)).toEqual([shopA])

    const payloads = await Promise.all(
      fetchSpy.mock.calls.map(([input, init]) =>
        new Request(input as RequestInfo, init as RequestInit).json(),
      ),
    )
    expect(payloads).toContainEqual(
      expect.objectContaining({ storeId: shopB, userId: staff.userId, permissions: [] }),
    )
    // 解除済み店舗は一覧・検索の担当としては現れない。
    expect(await listUsers(admin.token, `?storeId=${shopB}`)).toEqual([])
  })

  it('同期に失敗しても admin 正本を保持し、再送で収束できる', async () => {
    const fetchSpy = echoBinding()
    const org = await createTenantOrganization()
    const admin = await inviteMember(org, 'admin', 'honbu')
    const staff = await inviteMember(org, 'staff', 'tenin')
    const shop = storeId()
    fetchSpy.mockResolvedValue(new Response('{}', { status: 503 }))

    const failed = await SELF.fetch(
      `${BASE}/api/users/${staff.userId}`,
      authed(admin.token, 'PATCH', { standardRole: 'store_manager', storeIds: [shop] }),
    )
    expect(failed.status).toBe(502)
    expect(await failed.json()).toMatchObject({
      error: 'store_membership_sync_failed',
      userId: staff.userId,
      retryable: true,
    })

    // canonical は保持されている。
    const kept = await listUsers(admin.token, `?storeId=${shop}`)
    expect(kept.map((u) => u.id)).toEqual([staff.userId])

    echoBinding()
    const resent = await SELF.fetch(
      `${BASE}/api/users/${staff.userId}/sync`,
      authed(admin.token, 'POST'),
    )
    expect(resent.status).toBe(200)
  })

  it('別テナントの利用者は変更できない', async () => {
    echoBinding()
    const orgA = await createTenantOrganization('Chain A')
    const orgB = await createTenantOrganization('Chain B')
    const adminA = await inviteMember(orgA, 'admin', 'a-admin')
    const staffB = await inviteMember(orgB, 'staff', 'b-staff')

    const res = await SELF.fetch(
      `${BASE}/api/users/${staffB.userId}`,
      authed(adminA.token, 'PATCH', { standardRole: 'store_manager' }),
    )
    expect(res.status).toBe(404)
    // 招待直後の利用者は標準ロール未設定のまま。越境した書き込みが無いことを示す。
    const rows = await env.DB.prepare('SELECT standard_role, role FROM users WHERE id = ?')
      .bind(staffB.userId)
      .all()
    expect(rows.results[0]).toMatchObject({ standard_role: null, role: 'staff' })
  })

  it('未知の権限や空の変更は 400 で拒否する', async () => {
    echoBinding()
    const org = await createTenantOrganization()
    const admin = await inviteMember(org, 'admin', 'honbu')
    const staff = await inviteMember(org, 'staff', 'tenin')

    for (const body of [{}, { permissions: ['not.a.permission'] }, { organizationId: 'other' }]) {
      const res = await SELF.fetch(
        `${BASE}/api/users/${staff.userId}`,
        authed(admin.token, 'PATCH', body),
      )
      expect(res.status).toBe(400)
    }
  })
})

describe('変更の監査', () => {
  it('誰が・いつ・変更前後を追記専用で残す', async () => {
    echoBinding()
    const org = await createTenantOrganization()
    const admin = await inviteMember(org, 'admin', 'honbu')
    const staff = await inviteMember(org, 'staff', 'tenin')
    const shop = storeId()

    await SELF.fetch(
      `${BASE}/api/users/${staff.userId}`,
      authed(admin.token, 'PATCH', { standardRole: 'store_manager', storeIds: [shop] }),
    )

    const res = await SELF.fetch(
      `${BASE}/api/users/${staff.userId}/audits`,
      authed(admin.token, 'GET'),
    )
    expect(res.status).toBe(200)
    const audits = (await res.json()) as {
      actorUserId: string
      targetUserId: string
      action: string
      before: string
      after: string
      createdAt: string
    }[]
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      actorUserId: admin.userId,
      targetUserId: staff.userId,
      action: 'user.assignment_changed',
    })
    expect(JSON.parse(audits[0]?.before ?? '{}')).toMatchObject({
      standardRole: 'staff',
      storeIds: [],
    })
    expect(JSON.parse(audits[0]?.after ?? '{}')).toMatchObject({
      standardRole: 'store_manager',
      storeIds: [shop],
    })
    expect(Date.parse(audits[0]?.createdAt ?? '')).not.toBeNaN()
  })

  it('他テナントの監査は読めない', async () => {
    echoBinding()
    const orgA = await createTenantOrganization('Chain A')
    const orgB = await createTenantOrganization('Chain B')
    const adminA = await inviteMember(orgA, 'admin', 'a-admin')
    const staffB = await inviteMember(orgB, 'staff', 'b-staff')

    const res = await SELF.fetch(
      `${BASE}/api/users/${staffB.userId}/audits`,
      authed(adminA.token, 'GET'),
    )
    expect(res.status).toBe(404)
  })
})

describe('利用者管理は本部管理者だけの操作である', () => {
  it('店舗管理者は自分を本部管理者へ昇格できない', async () => {
    // `store_manager` の JWT `role` は `admin` である(STANDARD_ROLE_BASE_ROLE)。
    // ロールだけで門を開けると、店舗管理者が利用者管理APIを通過して自分の
    // standardRole を書き換えられる。標準ロールで判定しなければならない。
    echoBinding()
    const org = await createTenantOrganization()
    const manager = await inviteMember(org, 'admin', 'store-manager')
    const head = await inviteMember(org, 'admin', 'head-office')

    // 本部管理者が manager を店舗管理者に落とす。
    expect(
      (
        await SELF.fetch(
          `${BASE}/api/users/${manager.userId}`,
          authed(head.token, 'PATCH', {
            standardRole: 'store_manager',
            storeIds: [storeId()],
          }),
        )
      ).status,
    ).toBe(200)

    const escalation = await SELF.fetch(
      `${BASE}/api/users/${manager.userId}`,
      authed(manager.token, 'PATCH', { standardRole: 'head_office_admin' }),
    )

    expect(escalation.status).toBe(403)
    const after = await listUsers(head.token)
    expect(after.find((user) => user.id === manager.userId)?.standardRole).toBe('store_manager')
  })

  it('店舗管理者は利用者一覧そのものを開けない', async () => {
    echoBinding()
    const org = await createTenantOrganization()
    const head = await inviteMember(org, 'admin', 'head-office')
    const manager = await inviteMember(org, 'admin', 'store-manager')
    await SELF.fetch(
      `${BASE}/api/users/${manager.userId}`,
      authed(head.token, 'PATCH', { standardRole: 'store_manager' }),
    )

    const listed = await SELF.fetch(`${BASE}/api/users`, authed(manager.token, 'GET'))

    expect(listed.status).toBe(403)
  })
})
