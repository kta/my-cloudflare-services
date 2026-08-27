import { ATTENTION_INPUT_GUIDANCE } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  ATTENTION_ORGANIZATION_SCOPE,
  attentionRoleFor,
  DEFAULT_ATTENTION_CAPABILITIES,
  mayUseAttentionCapability,
  noteDifferences,
  resolveAttentionSettings,
  serializeAttentionCapabilities,
} from '../src/worker/domain/attention'

const storeId = '79a59f06-5bd1-4fb4-8574-14b7a79bd48b'

function row(overrides: Partial<Parameters<typeof resolveAttentionSettings>[0]['store']> = {}) {
  return {
    reviewMode: 'review_required',
    sharingScope: 'permitted_stores',
    storeOverrideAllowed: '1',
    capabilitiesJson: serializeAttentionCapabilities(DEFAULT_ATTENTION_CAPABILITIES),
    ...overrides,
  }
}

describe('the new-organization default (UC-EYEX-148)', () => {
  it('lets every staff member read and register for review, and only a store manager publish, revise or hide', () => {
    const settings = resolveAttentionSettings({ storeId, organization: null, store: null })
    expect(
      Object.fromEntries(
        settings.capabilities.map((rule) => [rule.capability, rule.minimumRole] as const),
      ),
    ).toEqual({
      read: 'staff',
      write: 'staff',
      publish: 'store_manager',
      revise: 'store_manager',
      hide: 'store_manager',
    })
    expect(settings.reviewMode).toBe('review_required')
    expect(settings.sharingScope).toBe('permitted_stores')
    expect(settings.origin).toBe('organization')
    expect(settings.guidance).toEqual(ATTENTION_INPUT_GUIDANCE)
  })

  it('keeps the organization default row under a store sentinel that cannot collide with a store id', () => {
    expect(ATTENTION_ORGANIZATION_SCOPE).toBe('*')
  })
})

describe('resolveAttentionSettings origin (UC-EYEX-139, AC-EYEX-84)', () => {
  it('applies a store override and reports the store as the applied origin', () => {
    const settings = resolveAttentionSettings({
      storeId,
      organization: row(),
      store: row({ reviewMode: 'immediate', sharingScope: 'chain' }),
    })
    expect(settings.reviewMode).toBe('immediate')
    expect(settings.sharingScope).toBe('chain')
    expect(settings.origin).toBe('store')
    expect(settings.capabilities.every((rule) => rule.origin === 'store')).toBe(true)
  })

  it('ignores a store override the organization does not allow', () => {
    const settings = resolveAttentionSettings({
      storeId,
      organization: row({ storeOverrideAllowed: '0', reviewMode: 'review_required' }),
      store: row({ reviewMode: 'immediate' }),
    })
    expect(settings.reviewMode).toBe('review_required')
    expect(settings.origin).toBe('organization')
    expect(settings.storeOverrideAllowed).toBe(false)
  })

  it('fails closed to the default matrix when a configuration row is corrupt', () => {
    const settings = resolveAttentionSettings({
      storeId,
      organization: row({ capabilitiesJson: 'not json', reviewMode: 'nonsense' }),
      store: null,
    })
    expect(settings.reviewMode).toBe('review_required')
    expect(settings.capabilities.find((rule) => rule.capability === 'publish')?.minimumRole).toBe(
      'store_manager',
    )
  })

  it('fails closed when a configuration row omits a capability', () => {
    const settings = resolveAttentionSettings({
      storeId,
      organization: row({
        capabilitiesJson: JSON.stringify([{ capability: 'publish', minimumRole: 'staff' }]),
      }),
      store: null,
    })
    expect(settings.capabilities).toHaveLength(5)
    expect(settings.capabilities.find((rule) => rule.capability === 'publish')?.minimumRole).toBe(
      'store_manager',
    )
  })
})

describe('attentionRoleFor', () => {
  it('derives the role from the JWT role and the store membership, never from input', () => {
    expect(attentionRoleFor('admin', [])).toBe('organization_admin')
    expect(attentionRoleFor('staff', ['store.manage'])).toBe('store_manager')
    expect(attentionRoleFor('staff', ['attention.publish'])).toBe('staff')
  })
})

describe('mayUseAttentionCapability', () => {
  const settings = resolveAttentionSettings({ storeId, organization: null, store: null })

  it('allows a capability only when the actor role reaches the configured minimum', () => {
    expect(mayUseAttentionCapability(settings, 'write', 'staff')).toBe(true)
    expect(mayUseAttentionCapability(settings, 'publish', 'staff')).toBe(false)
    expect(mayUseAttentionCapability(settings, 'publish', 'store_manager')).toBe(true)
    expect(mayUseAttentionCapability(settings, 'hide', 'organization_admin')).toBe(true)
  })
})

describe('noteDifferences (AC-EYEX-117)', () => {
  const before = {
    body: '旧本文',
    occurredAt: '2026-08-30T02:00:00.000Z',
    basis: '旧根拠',
    recommendedAction: '旧対応',
  }

  it('reports only the changed fields, old value first', () => {
    expect(noteDifferences(before, { ...before, body: '新本文' })).toEqual([
      { field: 'body', before: '旧本文', after: '新本文' },
    ])
  })

  it('reports nothing when the versions are identical', () => {
    expect(noteDifferences(before, { ...before })).toEqual([])
  })
})
