import { describe, expect, it } from 'vitest'
import {
  ATTENTION_CAPABILITIES,
  ATTENTION_INPUT_GUIDANCE,
  AttentionCapability,
  AttentionHideInput,
  AttentionNoteInput,
  AttentionNoteRecord,
  AttentionNoteRevisionInput,
  AttentionNoteStatus,
  AttentionReviewInput,
  AttentionRole,
  AttentionSettings,
  AttentionSettingsInput,
  AttentionSharingScopeImpact,
  AttentionSharingScopeImpactRequest,
  AttentionVersionConflict,
  AuditEventView,
  AuditSearchQuery,
  CustomerLinkReleaseInput,
  CustomerLinkReleaseResult,
  CustomerMergeInput,
  CustomerMergePreview,
  CustomerMergePreviewRequest,
  CustomerMergeResult,
  StorePermission,
} from '../src/index'

const storeId = '79a59f06-5bd1-4fb4-8574-14b7a79bd48b'
const customerId = 'c6a2a900-9c85-4f4d-b9d4-c9d8c55c20cb'
const duplicateId = '2d1c1f4a-4dc6-4f57-8f1d-6d3a4a2b91c2'
const noteId = 'a1d1c8f9-4a35-4d9e-8bb2-0a1b39cc9f52'

const capabilityRules = ATTENTION_CAPABILITIES.map((capability) => ({
  capability,
  minimumRole: capability === 'read' || capability === 'write' ? 'staff' : 'store_manager',
  origin: 'organization' as const,
}))

describe('attention capability vocabulary', () => {
  it('names exactly the five configurable capabilities', () => {
    expect(ATTENTION_CAPABILITIES).toEqual(['read', 'write', 'publish', 'revise', 'hide'])
    expect(AttentionCapability.options).toEqual([...ATTENTION_CAPABILITIES])
  })

  it('keeps one store permission per capability', () => {
    for (const capability of ATTENTION_CAPABILITIES) {
      expect(StorePermission.options).toContain(`attention.${capability}`)
    }
  })

  it('ranks roles from staff to organization admin', () => {
    expect(AttentionRole.options).toEqual(['staff', 'store_manager', 'organization_admin'])
  })

  it('carries the input guidance as contract data, not screen text', () => {
    expect(ATTENTION_INPUT_GUIDANCE.record.length).toBeGreaterThan(0)
    expect(ATTENTION_INPUT_GUIDANCE.avoid).toEqual(
      expect.arrayContaining(['人格評価', '憶測', '差別につながる属性']),
    )
  })
})

describe('AttentionSettings', () => {
  const settings = {
    storeId,
    reviewMode: 'review_required',
    sharingScope: 'permitted_stores',
    storeOverrideAllowed: true,
    origin: 'organization',
    capabilities: capabilityRules,
    guidance: ATTENTION_INPUT_GUIDANCE,
  }

  it('accepts a resolved configuration carrying the applied origin', () => {
    const parsed = AttentionSettings.parse(settings)
    expect(parsed.capabilities).toHaveLength(5)
    expect(parsed.origin).toBe('organization')
  })

  it('rejects a configuration that omits a capability', () => {
    expect(() =>
      AttentionSettings.parse({ ...settings, capabilities: capabilityRules.slice(1) }),
    ).toThrow()
  })

  it('rejects unknown keys', () => {
    expect(() => AttentionSettings.parse({ ...settings, extra: true })).toThrow()
  })
})

describe('AttentionSettingsInput', () => {
  const input = {
    scope: 'store',
    reviewMode: 'immediate',
    sharingScope: 'chain',
    storeOverrideAllowed: true,
    capabilities: capabilityRules.map(({ capability, minimumRole }) => ({
      capability,
      minimumRole,
    })),
  }

  it('accepts one rule per capability', () => {
    expect(AttentionSettingsInput.parse(input).capabilities).toHaveLength(5)
  })

  it('rejects a duplicated capability', () => {
    expect(() =>
      AttentionSettingsInput.parse({
        ...input,
        capabilities: [input.capabilities[0], ...input.capabilities.slice(0, 4)],
      }),
    ).toThrow()
  })

  it('accepts an acknowledged sharing-scope impact count', () => {
    expect(AttentionSettingsInput.parse({ ...input, acknowledgedAffectedNoteCount: 3 })).toEqual(
      expect.objectContaining({ acknowledgedAffectedNoteCount: 3 }),
    )
  })

  it('rejects a negative acknowledged count', () => {
    expect(() =>
      AttentionSettingsInput.parse({ ...input, acknowledgedAffectedNoteCount: -1 }),
    ).toThrow()
  })
})

describe('AttentionSharingScopeImpact', () => {
  it('asks about one requested scope and nothing else', () => {
    expect(AttentionSharingScopeImpactRequest.parse({ requestedScope: 'chain' })).toEqual({
      requestedScope: 'chain',
    })
    expect(() =>
      AttentionSharingScopeImpactRequest.parse({ requestedScope: 'chain', scope: 'store' }),
    ).toThrow()
  })

  it('reports how many existing notes a scope change would affect', () => {
    expect(
      AttentionSharingScopeImpact.parse({
        currentScope: 'permitted_stores',
        requestedScope: 'chain',
        affectedNoteCount: 4,
        affectedCustomerCount: 2,
        affectedStoreCount: 3,
      }).affectedNoteCount,
    ).toBe(4)
  })

  it('rejects a fractional count', () => {
    expect(() =>
      AttentionSharingScopeImpact.parse({
        currentScope: 'chain',
        requestedScope: 'permitted_stores',
        affectedNoteCount: 1.5,
        affectedCustomerCount: 1,
        affectedStoreCount: 1,
      }),
    ).toThrow()
  })
})

describe('AttentionNoteInput', () => {
  const input = {
    body: '来店中に他の顧客へ大声で抗議した',
    occurredAt: '2026-08-30T02:00:00.000Z',
    basis: '店内カメラ映像と担当者2名の報告',
    recommendedAction: '複数名で対応し、必要なら店長へ引き継ぐ',
  }

  it('records fact, instant, basis and recommended action', () => {
    expect(AttentionNoteInput.parse(input)).toEqual(input)
  })

  it.each(['body', 'occurredAt', 'basis', 'recommendedAction'] as const)(
    'rejects a note without %s',
    (field) => {
      const { [field]: _omitted, ...rest } = input
      expect(() => AttentionNoteInput.parse(rest)).toThrow()
    },
  )

  it('rejects an occurrence that is not an instant', () => {
    expect(() => AttentionNoteInput.parse({ ...input, occurredAt: '2026-08-30' })).toThrow()
  })

  it('requires an expected version on a revision', () => {
    expect(AttentionNoteRevisionInput.parse({ ...input, expectedVersion: 2 }).expectedVersion).toBe(
      2,
    )
    expect(() => AttentionNoteRevisionInput.parse(input)).toThrow()
    expect(() => AttentionNoteRevisionInput.parse({ ...input, expectedVersion: 0 })).toThrow()
  })
})

describe('review, hide and version conflict', () => {
  it('requires a reason for every review outcome', () => {
    for (const decision of ['publish', 'return', 'reject'] as const) {
      expect(
        AttentionReviewInput.parse({ decision, reason: '事実と根拠を確認した', expectedVersion: 1 })
          .decision,
      ).toBe(decision)
    }
    expect(() =>
      AttentionReviewInput.parse({ decision: 'publish', reason: '', expectedVersion: 1 }),
    ).toThrow()
    expect(() =>
      AttentionReviewInput.parse({ decision: 'archive', reason: '理由', expectedVersion: 1 }),
    ).toThrow()
  })

  it('requires a reason to hide rather than delete', () => {
    expect(AttentionHideInput.parse({ reason: '本人からの申し出', expectedVersion: 3 })).toEqual({
      reason: '本人からの申し出',
      expectedVersion: 3,
    })
    expect(() => AttentionHideInput.parse({ expectedVersion: 3 })).toThrow()
  })

  it('returns the old and new difference when publishing from a stale version', () => {
    const conflict = AttentionVersionConflict.parse({
      error: 'attention_version_conflict',
      currentVersion: 3,
      expectedVersion: 2,
      differences: [{ field: 'body', before: '旧本文', after: '新本文' }],
    })
    expect(conflict.differences[0]?.field).toBe('body')
    expect(() =>
      AttentionVersionConflict.parse({
        error: 'version_conflict',
        currentVersion: 3,
        expectedVersion: 2,
        differences: [],
      }),
    ).toThrow()
  })
})

describe('AttentionNoteRecord', () => {
  const record = {
    id: '5c7d3a5c-8f0b-4f8d-92a3-8a17f0e6d111',
    noteId,
    customerId,
    storeId,
    status: 'published',
    version: 2,
    body: '事実',
    occurredAt: '2026-08-30T02:00:00.000Z',
    basis: '根拠',
    recommendedAction: '推奨対応',
    sharingScope: 'permitted_stores',
    recordedBy: 'staff-1',
    recordedOn: '2026-08-30',
    publishedAt: '2026-08-31T00:00:00.000Z',
    hiddenAt: null,
    reviewedBy: 'manager-1',
    reviewedAt: '2026-08-31T00:00:00.000Z',
    reviewReason: '確認済み',
  }

  it('accepts a published version and every workflow status', () => {
    expect(AttentionNoteRecord.parse(record).version).toBe(2)
    expect(AttentionNoteStatus.options).toEqual([
      'pending_review',
      'published',
      'returned',
      'rejected',
      'superseded',
      'hidden',
    ])
  })

  it('rejects a version below one', () => {
    expect(() => AttentionNoteRecord.parse({ ...record, version: 0 })).toThrow()
  })

  it('accepts an unreviewed pending record', () => {
    const pending = AttentionNoteRecord.parse({
      ...record,
      status: 'pending_review',
      version: 1,
      publishedAt: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewReason: null,
    })
    expect(pending.publishedAt).toBeNull()
  })
})

describe('AuditSearchQuery and AuditEventView', () => {
  it('defaults the limit and coerces it from a query string', () => {
    expect(AuditSearchQuery.parse({}).limit).toBe(50)
    expect(AuditSearchQuery.parse({ limit: '10' }).limit).toBe(10)
  })

  it('accepts every documented search axis', () => {
    const parsed = AuditSearchQuery.parse({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T00:00:00.000Z',
      storeId,
      action: 'attention_note.published',
      actorType: 'shared_terminal',
      entityType: 'attention_note',
      entityId: noteId,
    })
    expect(parsed.actorType).toBe('shared_terminal')
  })

  it('rejects an out-of-range limit and an unknown actor type', () => {
    expect(() => AuditSearchQuery.parse({ limit: '0' })).toThrow()
    expect(() => AuditSearchQuery.parse({ limit: '201' })).toThrow()
    expect(() => AuditSearchQuery.parse({ actorType: 'robot' })).toThrow()
  })

  it('exposes before/after and the correlation id', () => {
    const view = AuditEventView.parse({
      id: '0f4b2d1f-2f0c-4dcb-9d4e-2f0f1f8f9a11',
      occurredAt: '2026-08-31T00:00:00.000Z',
      storeId,
      actorType: 'user',
      actorId: 'user-1',
      action: 'attention_note.revised',
      entityType: 'attention_note',
      entityId: noteId,
      correlationId: 'req-1',
      before: { body: '旧本文' },
      after: { body: '新本文' },
    })
    expect(view.before).toEqual({ body: '旧本文' })
    expect(
      AuditEventView.parse({
        id: '0f4b2d1f-2f0c-4dcb-9d4e-2f0f1f8f9a11',
        occurredAt: '2026-08-31T00:00:00.000Z',
        storeId: null,
        actorType: 'user',
        actorId: 'user-1',
        action: 'attention_note.read',
        entityType: 'customer',
        entityId: customerId,
        correlationId: null,
        before: null,
        after: null,
      }).before,
    ).toBeNull()
  })
})

describe('customer merge and mis-link release', () => {
  const summary = {
    customerId,
    name: '山田 太郎',
    kana: 'ヤマダ タロウ',
    phone: '09011112222',
    primaryStoreId: storeId,
    visitCount: 3,
  }
  const impact = {
    reservations: 2,
    walkins: 1,
    prescriptions: 1,
    notes: 0,
    attentionNotes: 0,
    ownedGlasses: 1,
  }

  it('compares two distinct candidates', () => {
    expect(
      CustomerMergePreviewRequest.parse({
        primaryCustomerId: customerId,
        duplicateCustomerId: duplicateId,
      }).duplicateCustomerId,
    ).toBe(duplicateId)
    expect(() =>
      CustomerMergePreviewRequest.parse({
        primaryCustomerId: customerId,
        duplicateCustomerId: customerId,
      }),
    ).toThrow()
  })

  it('previews both records and the affected history', () => {
    const preview = CustomerMergePreview.parse({
      primary: summary,
      duplicate: { ...summary, customerId: duplicateId, visitCount: 1 },
      impact,
      alreadyMerged: false,
    })
    expect(preview.impact.reservations).toBe(2)
  })

  it('requires an acknowledged impact and a reason, never an automatic merge', () => {
    const input = {
      primaryCustomerId: customerId,
      duplicateCustomerId: duplicateId,
      reason: '同一人物と確認',
      acknowledgedImpactTotal: 5,
    }
    expect(CustomerMergeInput.parse(input).acknowledgedImpactTotal).toBe(5)
    expect(() => CustomerMergeInput.parse({ ...input, duplicateCustomerId: customerId })).toThrow()
    expect(() => CustomerMergeInput.parse({ ...input, reason: '' })).toThrow()
    const { acknowledgedImpactTotal: _omitted, ...withoutAcknowledgement } = input
    expect(() => CustomerMergeInput.parse(withoutAcknowledgement)).toThrow()
  })

  it('describes the merge result and the released mis-link', () => {
    expect(
      CustomerMergeResult.parse({
        primaryCustomerId: customerId,
        mergedCustomerId: duplicateId,
        impact,
        mergedAt: '2026-08-31T00:00:00.000Z',
      }).mergedCustomerId,
    ).toBe(duplicateId)

    expect(
      CustomerLinkReleaseInput.parse({
        entryType: 'reservation',
        entryId: '3f6d2c07-9a52-4a53-9f9a-3c9b3d0f7a10',
        reason: '別人の来店だった',
      }).entryType,
    ).toBe('reservation')
    expect(() =>
      CustomerLinkReleaseInput.parse({
        entryType: 'recording',
        entryId: '3f6d2c07-9a52-4a53-9f9a-3c9b3d0f7a10',
        reason: '別人の来店だった',
      }),
    ).toThrow()
    expect(
      CustomerLinkReleaseResult.parse({
        entryType: 'walkin',
        entryId: '3f6d2c07-9a52-4a53-9f9a-3c9b3d0f7a10',
        previousCustomerId: customerId,
        releasedAt: '2026-08-31T00:00:00.000Z',
      }).previousCustomerId,
    ).toBe(customerId)
  })
})
