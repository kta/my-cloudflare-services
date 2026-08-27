import { describe, expect, it } from 'vitest'
import {
  Actor,
  AvailabilityException,
  AvailabilitySlotsQuery,
  OrganizationSync,
  PublicBookingCreate,
  Store,
  StoreMembership,
  StorePatch,
  StorePermission,
  WebBookingPublication,
} from '../src/index'

const organizationId = '5f73d9dd-0e4f-4ac5-b6d9-1bd9e4d70c75'
const canonicalOrganizationId = 'org-admin-seed'
const storeId = '79a59f06-5bd1-4fb4-8574-14b7a79bd48b'
const userId = 'c6a2a900-9c85-4f4d-b9d4-c9d8c55c20cb'
const timestamp = '2026-08-26T00:00:00.000Z'

describe('glasses_management contracts', () => {
  it('parses an organization synchronization payload strictly', () => {
    expect(
      OrganizationSync.parse({
        id: canonicalOrganizationId,
        name: 'EYEX organization',
        plan: 'contracted',
        isDisabled: false,
        createdAt: timestamp,
        revision: 1,
      }),
    ).toMatchObject({
      id: canonicalOrganizationId,
      plan: 'contracted',
      isDisabled: false,
      revision: 1,
    })
    expect(
      OrganizationSync.safeParse({
        id: canonicalOrganizationId,
        name: 'EYEX organization',
        plan: 'free',
        isDisabled: false,
        createdAt: timestamp,
        revision: 1,
        organizationId: 'spoofed',
      }).success,
    ).toBe(false)
  })

  it('accepts canonical non-UUID organization ids while keeping revision monotonic', () => {
    expect(
      OrganizationSync.safeParse({
        id: 'org-sample-free-seed',
        name: 'Sample Org',
        plan: 'free',
        isDisabled: false,
        createdAt: timestamp,
        revision: 7,
      }).success,
    ).toBe(true)
    expect(
      Actor.safeParse({
        subjectId: userId,
        organizationId: 'org-sample-free-seed',
        role: 'staff',
        permissions: ['store.read'],
      }).success,
    ).toBe(true)
    expect(
      OrganizationSync.safeParse({
        id: 'org-sample-free-seed',
        name: 'Sample Org',
        plan: 'free',
        isDisabled: false,
        createdAt: timestamp,
        revision: 0,
      }).success,
    ).toBe(true)
  })

  it('parses a store and rejects an invalid slug', () => {
    expect(
      Store.parse({
        id: storeId,
        organizationId,
        name: '銀座店',
        slug: 'ginza',
        isActive: true,
        createdAt: timestamp,
      }).slug,
    ).toBe('ginza')
    expect(
      Store.safeParse({
        id: storeId,
        organizationId,
        name: '銀座店',
        slug: 'Ginza Store',
        isActive: true,
        createdAt: timestamp,
      }).success,
    ).toBe(false)
    expect(
      Store.parse({
        id: storeId,
        organizationId: canonicalOrganizationId,
        name: '銀座店',
        slug: 'ginza',
        isActive: true,
        createdAt: timestamp,
      }).organizationId,
    ).toBe(canonicalOrganizationId)
  })

  it('keeps membership permissions as a typed allow-list', () => {
    const membership = StoreMembership.parse({
      id: '955fcb60-67f7-4f6e-9ce5-5ad136ec4e38',
      organizationId,
      storeId,
      userId,
      permissions: ['store.read', 'store.manage'],
      createdAt: timestamp,
    })
    expect(membership.permissions).toEqual(['store.read', 'store.manage'])
    expect(StorePermission.safeParse('root.all').success).toBe(false)
  })

  it('describes the authenticated actor without accepting organization spoofing', () => {
    expect(
      Actor.parse({
        subjectId: userId,
        organizationId,
        role: 'staff',
        permissions: ['store.read'],
      }),
    ).toMatchObject({ subjectId: userId, organizationId, role: 'staff' })
  })

  it('requires at least one field in a store patch', () => {
    expect(StorePatch.safeParse({ name: '新しい店名' }).success).toBe(true)
    expect(StorePatch.safeParse({}).success).toBe(false)
    expect(StorePatch.safeParse({ name: '', organizationId: 'spoofed' }).success).toBe(false)
  })

  it('requires a period only for an exceptional opening', () => {
    expect(
      AvailabilityException.safeParse({ date: '2026-12-31', mode: 'open', periods: [] }).success,
    ).toBe(false)
    expect(
      AvailabilityException.safeParse({ date: '2026-12-31', mode: 'closed', periods: [] }).success,
    ).toBe(true)
  })

  it('accepts only UTC-normalized publication windows and a fixed public-purpose snapshot', () => {
    const publication = WebBookingPublication.parse({
      id: storeId,
      organizationId: canonicalOrganizationId,
      storeId,
      publicSlug: 'eyex-ginza',
      status: 'published',
      startsAt: timestamp,
      endsAt: '2026-08-27T00:00:00.000Z',
      contactPhone: '03-0000-0000',
      accessText: '銀座駅',
      notice: '',
      region: '東京都中央区',
      nearestStation: '銀座駅',
      latitude: 35.6717,
      longitude: 139.765,
      publicPurposeIds: ['af1d3c4c-913c-43e9-a2f6-78a111d2d947'],
      version: 1,
      publishedAt: timestamp,
      updatedAt: timestamp,
    })
    expect(publication.publicSlug).toBe('eyex-ginza')
    expect(
      WebBookingPublication.safeParse({ ...publication, startsAt: '2026-08-26T09:00:00+09:00' })
        .success,
    ).toBe(false)
  })

  it('keeps public booking input separate from staff-only memos and requires consent', () => {
    expect(
      AvailabilitySlotsQuery.parse({
        date: '2026-08-31',
        purposeIds: 'af1d3c4c-913c-43e9-a2f6-78a111d2d947',
      }).purposeIds,
    ).toHaveLength(1)
    expect(
      PublicBookingCreate.safeParse({
        date: '2026-08-31',
        startTime: '10:00',
        purposeIds: ['af1d3c4c-913c-43e9-a2f6-78a111d2d947'],
        customer: {
          name: '田中花子',
          kana: 'タナカハナコ',
          phone: '09012345678',
          email: 'tanaka@example.test',
        },
        consentVersion: '2026-08-27',
        reservationMemo: 'internal-only',
      }).success,
    ).toBe(false)
  })
})
