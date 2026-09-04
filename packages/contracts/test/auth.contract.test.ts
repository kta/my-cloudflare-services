import { describe, expect, it } from 'vitest'
import {
  AuthTokenPayload,
  AuthUser,
  CreateItem,
  InviteRequest,
  IssueTokenRequest,
  LoginRequest,
  Organization,
  OrganizationSyncFailed,
} from '../src/index'

describe('Zod 4 migration semantics', () => {
  it.each([
    ['AuthUser.id', AuthUser, { email: 'a@example.com', role: 'staff' }],
    ['CreateItem.title', CreateItem, { body: '' }],
  ])('%s は省略できない', (_name, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false)
  })

  it('default と optionality を適用した出力キーを固定する', () => {
    expect(CreateItem.parse({ title: 'Item' })).toEqual({ title: 'Item', body: '' })
  })
})

describe('AuthTokenPayload(旧クレームとの互換)', () => {
  it('新形クレームをパースできる', () => {
    const parsed = AuthTokenPayload.safeParse({
      sub: 'u1',
      org: 'o1',
      email: 'a@example.com',
      role: 'staff',
      exp: 1234567890,
    })
    expect(parsed.success).toBe(true)
  })
  it('passthrough: 未知クレームを落とさない(前方互換)', () => {
    const parsed = AuthTokenPayload.parse({
      sub: 'u1',
      org: 'o1',
      email: 'a@example.com',
      role: 'admin',
      exp: 1,
      extra: 'kept',
    })
    expect((parsed as Record<string, unknown>).extra).toBe('kept')
  })
  it('role 不正は弾く', () => {
    expect(
      AuthTokenPayload.safeParse({
        sub: 'u1',
        org: 'o1',
        email: 'a@example.com',
        role: 'root',
        exp: 1,
      }).success,
    ).toBe(false)
  })
})

describe('LoginRequest / InviteRequest(strict)', () => {
  it('余分なフィールドは弾く(strict)', () => {
    expect(
      LoginRequest.safeParse({ email: 'a@example.com', stretched: 'x', extra: 1 }).success,
    ).toBe(false)
  })
  it('InviteRequest は role を staff に default する', () => {
    const parsed = InviteRequest.parse({ email: 'a@example.com' })
    expect(parsed.role).toBe('staff')
  })
  it('InviteRequest は余分なフィールドを弾く(strict)', () => {
    expect(InviteRequest.safeParse({ email: 'a@example.com', orgName: 'Org' }).success).toBe(false)
  })
})

describe('IssueTokenRequest(dev グラント)', () => {
  it('role/email を default する(旧テンプレ呼び出しの上位互換)', () => {
    const parsed = IssueTokenRequest.parse({ organizationId: 'o1' })
    expect(parsed.role).toBe('staff')
    expect(parsed.email).toBe('dev@example.com')
  })
})

describe('Organization(同期 upsert 契約)', () => {
  it('plan/isDisabled を default し、旧形データもパースできる', () => {
    const parsed = Organization.parse({
      id: 'o1',
      name: 'Org',
      createdAt: new Date().toISOString(),
    })
    expect(parsed.plan).toBe('free')
    expect(parsed.isDisabled).toBe(false)
  })

  it('admin正本とdomain同期で同じ組織名のtrim規則を使う', () => {
    const parsed = Organization.parse({
      id: 'o1',
      name: '  EYE Organization  ',
      createdAt: new Date().toISOString(),
    })
    expect(parsed.name).toBe('EYE Organization')
  })
})

describe('OrganizationSyncFailed(復旧可能な同期失敗)', () => {
  it('再同期対象を含む厳格な失敗応答だけを受け入れる', () => {
    expect(
      OrganizationSyncFailed.safeParse({
        error: 'organization_sync_failed',
        organizationId: 'org-1',
        retryable: true,
      }).success,
    ).toBe(true)
    expect(
      OrganizationSyncFailed.safeParse({
        error: 'organization_sync_failed',
        organizationId: '',
        retryable: true,
        extra: 'untrusted',
      }).success,
    ).toBe(false)
  })
})
