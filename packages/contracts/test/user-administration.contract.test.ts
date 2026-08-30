import { describe, expect, it } from 'vitest'
import {
  AdministrablePermission,
  AdminUserQuery,
  AdminUserView,
  PinResetStartRequest,
  PinResetTicket,
  permissionDifference,
  SetOwnPinRequest,
  STANDARD_ROLE_BASE_ROLE,
  STANDARD_ROLE_PERMISSIONS,
  StandardRole,
  StorePermission,
  UserAdministrationAudit,
  UserAssignmentUpdate,
} from '../src/index'

/**
 * UC-EYEX-149 / UC-EYEX-151 の契約。標準ロールのカタログは
 * glasses_management の StorePermission を唯一の語彙とするため、循環 import を
 * 避けたうえで**テストで**部分集合であることを固定する。
 */
describe('standard role catalogue', () => {
  it('mirrors the domain StorePermission vocabulary exactly', () => {
    expect([...AdministrablePermission.options].sort()).toEqual([...StorePermission.options].sort())
  })

  it('grants only permissions that exist in the domain StorePermission vocabulary', () => {
    for (const role of StandardRole.options) {
      expect(() => StorePermission.array().parse(STANDARD_ROLE_PERMISSIONS[role])).not.toThrow()
    }
  })

  it('maps every standard role onto an authentication role', () => {
    expect(STANDARD_ROLE_BASE_ROLE).toEqual({
      head_office_admin: 'admin',
      store_manager: 'admin',
      staff: 'staff',
    })
  })

  it('orders the catalogue from the widest to the narrowest reach', () => {
    const head = new Set<string>(STANDARD_ROLE_PERMISSIONS.head_office_admin)
    const manager = new Set<string>(STANDARD_ROLE_PERMISSIONS.store_manager)
    for (const p of STANDARD_ROLE_PERMISSIONS.staff) expect(manager.has(p)).toBe(true)
    for (const p of manager) expect(head.has(p)).toBe(true)
    expect(head.size).toBeGreaterThan(manager.size)
    expect(manager.size).toBeGreaterThan(STANDARD_ROLE_PERMISSIONS.staff.length)
  })

  it('never grants a plain staff member management or audit reach', () => {
    for (const forbidden of ['store.manage', 'settings.manage', 'audit.read', 'terminal.manage']) {
      expect(STANDARD_ROLE_PERMISSIONS.staff).not.toContain(forbidden)
    }
  })
})

describe('permissionDifference', () => {
  it('reports nothing when the effective permissions equal the standard role', () => {
    expect(permissionDifference('staff', [...STANDARD_ROLE_PERMISSIONS.staff])).toEqual({
      missing: [],
      extra: [],
    })
  })

  it('reports both directions of the drift, sorted and de-duplicated', () => {
    const effective = [
      ...STANDARD_ROLE_PERMISSIONS.staff.filter((p) => p !== 'reservation.write'),
      'audit.read',
      'audit.read',
    ]
    expect(permissionDifference('staff', effective)).toEqual({
      missing: ['reservation.write'],
      extra: ['audit.read'],
    })
  })
})

describe('user administration request contracts', () => {
  it('rejects unknown keys on the assignment update', () => {
    expect(() =>
      UserAssignmentUpdate.parse({ standardRole: 'staff', organizationId: 'other-org' }),
    ).toThrow()
  })

  it('requires at least one changed field', () => {
    expect(UserAssignmentUpdate.safeParse({}).success).toBe(false)
    expect(UserAssignmentUpdate.safeParse({ standardRole: 'store_manager' }).success).toBe(true)
    expect(UserAssignmentUpdate.safeParse({ storeIds: [] }).success).toBe(true)
  })

  it('rejects permissions outside the domain vocabulary', () => {
    expect(
      UserAssignmentUpdate.safeParse({ standardRole: 'staff', permissions: ['not.a.permission'] })
        .success,
    ).toBe(false)
  })

  it('accepts an empty search query and normalises the trimmed term', () => {
    expect(AdminUserQuery.parse({})).toEqual({})
    expect(AdminUserQuery.parse({ q: '  hanako ' })).toEqual({ q: 'hanako' })
    expect(AdminUserQuery.safeParse({ standardRole: 'nope' }).success).toBe(false)
  })

  it('describes a user with its permission difference and PIN presence only', () => {
    const view = AdminUserView.parse({
      id: 'u1',
      email: 'a@example.test',
      role: 'staff',
      standardRole: 'staff',
      assignments: [{ storeId: '11111111-1111-4111-8111-111111111111', permissions: [] }],
      permissionDifference: { missing: [], extra: [] },
      hasPin: true,
      createdAt: '2026-08-27T00:00:00.000Z',
    })
    expect(Object.keys(view)).not.toContain('pinHash')
    expect(() => AdminUserView.parse({ ...view, pinHash: 'x' })).toThrow()
  })

  it('keeps every audit entry attributable with a before and after snapshot', () => {
    const audit = UserAdministrationAudit.parse({
      id: 'a1',
      organizationId: 'org1',
      actorUserId: 'admin1',
      targetUserId: 'u1',
      action: 'user.assignment_changed',
      before: '{"standardRole":"staff"}',
      after: '{"standardRole":"store_manager"}',
      createdAt: '2026-08-27T00:00:00.000Z',
    })
    expect(audit.actorUserId).toBe('admin1')
    expect(UserAdministrationAudit.safeParse({ ...audit, actorUserId: '' }).success).toBe(false)
  })
})

describe('personal PIN contracts', () => {
  it('carries only stretched PIN material, never a raw PIN', () => {
    const parsed = SetOwnPinRequest.parse({ stretchedPin: 'c3RyZXRjaGVk' })
    expect(parsed).toEqual({ stretchedPin: 'c3RyZXRjaGVk' })
    expect(SetOwnPinRequest.safeParse({ pin: '1234' }).success).toBe(false)
    expect(SetOwnPinRequest.safeParse({ stretchedPin: 'x', pin: '1234' }).success).toBe(false)
  })

  it('accepts a current-PIN proof or a reset ticket as the change authority', () => {
    expect(
      SetOwnPinRequest.safeParse({ stretchedPin: 'new', currentStretchedPin: 'old' }).success,
    ).toBe(true)
    expect(SetOwnPinRequest.safeParse({ stretchedPin: 'new', resetTicketId: 't1' }).success).toBe(
      true,
    )
  })

  it('requires a recorded identity verification before an administrator reset', () => {
    expect(
      PinResetStartRequest.safeParse({ verificationMethod: 'in_person', verificationNote: '' })
        .success,
    ).toBe(false)
    expect(
      PinResetStartRequest.parse({
        verificationMethod: 'in_person',
        verificationNote: '  店頭で社員証を確認 ',
      }),
    ).toEqual({ verificationMethod: 'in_person', verificationNote: '店頭で社員証を確認' })
  })

  it('never exposes PIN material in the reset ticket', () => {
    const ticket = PinResetTicket.parse({
      id: 't1',
      userId: 'u1',
      status: 'pending',
      expiresAt: '2026-08-27T01:00:00.000Z',
      createdAt: '2026-08-27T00:00:00.000Z',
    })
    expect(JSON.stringify(ticket)).not.toMatch(/pin[^a-z]/i)
    expect(PinResetTicket.safeParse({ ...ticket, stretchedPin: 'x' }).success).toBe(false)
  })
})
