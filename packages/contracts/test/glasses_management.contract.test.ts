import { Actor, OrganizationSync, Store, StoreMembership, StorePermission } from '@app/contracts'
import { describe, expect, it } from 'vitest'

const ORG = 'org-eyex'
const UUID = '11111111-2222-4333-8444-555555555555'
const UUID2 = '99999999-8888-4777-8666-555555555555'
const NOW = '2026-08-27T02:08:00.000Z'

describe('OrganizationSync', () => {
  it('accepts a canonical snapshot from admin', () => {
    const parsed = OrganizationSync.parse({
      id: ORG,
      name: 'EYEX',
      plan: 'contracted',
      isDisabled: false,
      createdAt: NOW,
      revision: 7,
    })
    expect(parsed.revision).toBe(7)
  })

  it('defaults revision to 0 so a pre-revision snapshot still applies', () => {
    expect(
      OrganizationSync.parse({
        id: ORG,
        name: 'EYEX',
        plan: 'free',
        isDisabled: false,
        createdAt: NOW,
      }).revision,
    ).toBe(0)
  })

  it('rejects a negative or fractional revision', () => {
    for (const revision of [-1, 1.5]) {
      expect(() =>
        OrganizationSync.parse({
          id: ORG,
          name: 'EYEX',
          plan: 'free',
          isDisabled: false,
          createdAt: NOW,
          revision,
        }),
      ).toThrow()
    }
  })

  it('rejects an unknown key so a stale admin field never lands silently', () => {
    expect(() =>
      OrganizationSync.parse({
        id: ORG,
        name: 'EYEX',
        plan: 'free',
        isDisabled: false,
        createdAt: NOW,
        revision: 0,
        legacyFlag: true,
      }),
    ).toThrow()
  })

  it('rejects an empty id and a non-datetime createdAt', () => {
    expect(() =>
      OrganizationSync.parse({
        id: '  ',
        name: 'EYEX',
        plan: 'free',
        isDisabled: false,
        createdAt: NOW,
      }),
    ).toThrow()
    expect(() =>
      OrganizationSync.parse({
        id: ORG,
        name: 'EYEX',
        plan: 'free',
        isDisabled: false,
        createdAt: '2026-08-27',
      }),
    ).toThrow()
  })
})

describe('StorePermission', () => {
  it('is an allow-list: an unknown permission fails closed', () => {
    expect(() => StorePermission.parse('reservation.delete')).toThrow()
  })

  it('keeps the separation that lets a viewer stay a viewer', () => {
    for (const permission of ['attention.read', 'attention.publish', 'analytics.read']) {
      expect(StorePermission.parse(permission)).toBe(permission)
    }
  })
})

describe('StoreMembership', () => {
  const base = {
    id: UUID,
    organizationId: ORG,
    storeId: UUID2,
    userId: 'user-1',
    permissions: ['store.read', 'reservation.read'],
    createdAt: NOW,
  }

  it('accepts a membership carrying allow-listed permissions', () => {
    expect(StoreMembership.parse(base).permissions).toEqual(['store.read', 'reservation.read'])
  })

  it('accepts an empty permission list — that is how admin revokes an assignment', () => {
    expect(StoreMembership.parse({ ...base, permissions: [] }).permissions).toEqual([])
  })

  it('rejects an unknown permission inside the list', () => {
    expect(() =>
      StoreMembership.parse({ ...base, permissions: ['store.read', 'store.destroy'] }),
    ).toThrow()
  })

  it('requires UUIDs for domain-owned ids but not for the admin organization id', () => {
    expect(() => StoreMembership.parse({ ...base, storeId: 'store-1' })).toThrow()
    expect(
      StoreMembership.parse({ ...base, organizationId: 'org-admin-seed' }).organizationId,
    ).toBe('org-admin-seed')
  })
})

describe('Store', () => {
  const base = {
    id: UUID,
    organizationId: ORG,
    name: 'EYEX 銀座店',
    slug: 'ginza',
    isActive: true,
    createdAt: NOW,
  }

  it('fills the optional contact fields with empty strings', () => {
    const parsed = Store.parse(base)
    expect([parsed.phone, parsed.address, parsed.accessNote]).toEqual(['', '', ''])
  })

  it('accepts a hyphenated lowercase slug and rejects anything else', () => {
    expect(Store.parse({ ...base, slug: 'ginza-main' }).slug).toBe('ginza-main')
    for (const slug of ['Ginza', 'ginza_main', '-ginza', 'ginza-', 'ぎんざ', '']) {
      expect(() => Store.parse({ ...base, slug })).toThrow()
    }
  })

  it('trims and bounds the display name', () => {
    expect(Store.parse({ ...base, name: '  EYEX 銀座店  ' }).name).toBe('EYEX 銀座店')
    expect(() => Store.parse({ ...base, name: 'あ'.repeat(201) })).toThrow()
  })
})

describe('Actor', () => {
  it('defaults terminalId to null so a personal device carries no terminal', () => {
    expect(
      Actor.parse({ subjectId: 'user-1', organizationId: ORG, kind: 'staff' }).terminalId,
    ).toBeNull()
  })

  it('carries the terminal when the shared iPad is the audited subject', () => {
    const parsed = Actor.parse({
      subjectId: UUID,
      organizationId: ORG,
      kind: 'terminal',
      terminalId: UUID,
    })
    expect(parsed.kind).toBe('terminal')
  })

  it('rejects an actor kind outside the closed set', () => {
    expect(() => Actor.parse({ subjectId: 'x', organizationId: ORG, kind: 'robot' })).toThrow()
  })
})
