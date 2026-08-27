import { describe, expect, it } from 'vitest'
import {
  SettingsConflictResolutionInput,
  SettingsDraft,
  SettingsDraftInput,
  SettingsImpactReport,
  SettingsPublication,
  SettingsPublicationPatch,
  SettingsPublicationRequest,
  SettingsVersionDetail,
  SettingsVersionSummary,
} from '../src/index'

const ids = {
  draft: '0b4b58a5-0ea8-4ad8-8dc5-44f3db3f67d1',
  store: 'bcd9f197-22a3-45e5-a36b-4de4e99bfcd7',
  purpose: 'd268c2d1-77ca-4385-a2bc-3e6b8a3b9f20',
  staff: 'ed343e14-d190-45e0-8b8a-7c4d73a0da41',
  equipment: 'f03de5c4-8fb7-4974-b4bd-0e4f72c5ce43',
  version: '5f6df1a1-6ac1-4a9b-9a3f-19f39a1b6f2c',
  publication: '9cba0d38-4a55-4a2a-8f6a-3d0f7cf5c9de',
  reservation: 'a2c3f4d5-6e7f-4a8b-9c0d-1e2f3a4b5c6d',
}

const settings = {
  version: 3,
  receptionStatus: 'open' as const,
  businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
  exceptions: [],
  purposes: [
    {
      id: ids.purpose,
      staffName: '視力測定',
      customerLabel: 'メガネを新しく作りたい',
      durationMinutes: 60,
      slotIntervalMinutes: 30,
      isPublic: true,
      requiredSkills: ['眼鏡作製技能'],
      requiredEquipment: ['視力測定機'],
      maxConcurrent: 1,
    },
  ],
  staff: [
    { id: ids.staff, name: '担当者', skills: ['眼鏡作製技能'], canBook: true, isActive: true },
  ],
  shifts: [],
  equipment: [
    {
      id: ids.equipment,
      name: '視力測定機',
      capacity: 1,
      isActive: true,
      availablePeriods: [{ startTime: '10:00', endTime: '19:00' }],
    },
  ],
  maintenance: [],
}

const storeSettings = { ...settings, storeId: ids.store }

const draft = {
  id: ids.draft,
  storeId: ids.store,
  draftVersion: 2,
  baseVersion: 3,
  status: 'draft' as const,
  origin: 'store_override' as const,
  restoredFromVersionId: null,
  savedAt: '2026-08-31T00:00:00.000Z',
  savedBy: 'user-1',
  settings: storeSettings,
}

describe('settings draft contract', () => {
  it('defaults a saved draft to the draft state', () => {
    const parsed = SettingsDraftInput.parse({ settings })
    expect(parsed.status).toBe('draft')
  })

  it('accepts the review state and rejects publishing through the draft input', () => {
    expect(SettingsDraftInput.parse({ status: 'review', settings }).status).toBe('review')
    expect(SettingsDraftInput.safeParse({ status: 'published', settings }).success).toBe(false)
  })

  it('rejects unknown draft input keys', () => {
    expect(SettingsDraftInput.safeParse({ settings, publish: true }).success).toBe(false)
  })

  it('carries the save state and the last saved instant', () => {
    const parsed = SettingsDraft.parse(draft)
    expect(parsed.savedAt).toBe('2026-08-31T00:00:00.000Z')
    expect(parsed.origin).toBe('store_override')
    expect(SettingsDraft.safeParse({ ...draft, savedAt: '2026-08-31' }).success).toBe(false)
  })

  it('records the version a restored draft came from', () => {
    const parsed = SettingsDraft.parse({
      ...draft,
      origin: 'chain',
      restoredFromVersionId: ids.version,
    })
    expect(parsed.restoredFromVersionId).toBe(ids.version)
  })
})

describe('settings impact contract', () => {
  const report = {
    draftId: ids.draft,
    storeId: ids.store,
    evaluatedAt: '2026-08-31T00:00:00.000Z',
    blockingCount: 1,
    warningCount: 1,
    canPublish: false,
    ledgerEntriesAffected: 1,
    publicSlots: { date: '2026-08-31', publishedCount: 8, draftCount: 4 },
    items: [
      {
        kind: 'reservation_conflict' as const,
        severity: 'blocking' as const,
        reservationId: ids.reservation,
        message: '担当者の技能が不足しています',
        resolution: null,
      },
      {
        kind: 'out_of_hours' as const,
        severity: 'warning' as const,
        reservationId: null,
        message: '営業時間外の設定です',
        resolution: null,
      },
    ],
  }

  it('reports conflicts, public slots, skills, equipment and out-of-hours settings', () => {
    const parsed = SettingsImpactReport.parse(report)
    expect(parsed.items.map((item) => item.kind)).toEqual(['reservation_conflict', 'out_of_hours'])
    expect(parsed.canPublish).toBe(false)
    expect(parsed.publicSlots.draftCount).toBe(4)
  })

  it('accepts every impact kind the impact step must surface', () => {
    for (const kind of [
      'reservation_conflict',
      'missing_staff_skill',
      'missing_equipment',
      'out_of_hours',
      'web_slot_change',
    ] as const) {
      const parsed = SettingsImpactReport.parse({
        ...report,
        items: [{ ...report.items[0], kind }],
      })
      expect(parsed.items[0]?.kind).toBe(kind)
    }
    expect(
      SettingsImpactReport.safeParse({ ...report, items: [{ ...report.items[0], kind: 'other' }] })
        .success,
    ).toBe(false)
  })

  it('records how a conflicting reservation was resolved', () => {
    for (const resolution of ['alternative_resource', 'keep_exception', 'customer_contacted']) {
      expect(SettingsConflictResolutionInput.parse({ resolution }).note).toBe('')
    }
    expect(SettingsConflictResolutionInput.safeParse({ resolution: 'ignored' }).success).toBe(false)
  })
})

describe('settings publication contract', () => {
  it('accepts a JST scheduling instant and rejects a malformed one', () => {
    const request = {
      draftId: ids.draft,
      targetStoreIds: [ids.store],
      idempotencyKey: 'publish-1',
      scheduledForJst: '2026-08-31T09:00',
    }
    expect(SettingsPublicationRequest.parse(request).scheduledForJst).toBe('2026-08-31T09:00')
    expect(
      SettingsPublicationRequest.safeParse({ ...request, scheduledForJst: '2026-08-31' }).success,
    ).toBe(false)
    expect(
      SettingsPublicationRequest.safeParse({ ...request, scheduledForJst: '2026-02-30T09:00' })
        .success,
    ).toBe(false)
    expect(SettingsPublicationRequest.safeParse({ ...request, targetStoreIds: [] }).success).toBe(
      false,
    )
    // A well-shaped string with an impossible wall-clock time is still refused.
    for (const scheduledForJst of ['2026-08-31T24:00', '2026-08-31T10:99']) {
      expect(SettingsPublicationRequest.safeParse({ ...request, scheduledForJst }).success).toBe(
        false,
      )
    }
  })

  it('publishes immediately when no schedule is supplied', () => {
    const parsed = SettingsPublicationRequest.parse({
      draftId: ids.draft,
      targetStoreIds: [ids.store],
      idempotencyKey: 'publish-1',
    })
    expect(parsed.scheduledForJst).toBeUndefined()
  })

  it('exposes the version id, targets, applied and failed counts and the effects', () => {
    const parsed = SettingsPublication.parse({
      id: ids.publication,
      versionId: ids.version,
      draftId: ids.draft,
      status: 'partially_failed',
      scheduledForJst: null,
      scheduledAt: null,
      executedAt: '2026-08-31T00:00:00.000Z',
      appliedCount: 1,
      failedCount: 1,
      ledgerEntriesAffected: 2,
      webSlotEffect: { date: '2026-08-31', previousSlotCount: 8, publishedSlotCount: 4 },
      targets: [
        {
          storeId: ids.store,
          status: 'applied',
          appliedVersion: 4,
          failureReason: null,
          appliedAt: '2026-08-31T00:00:00.000Z',
        },
      ],
    })
    expect(parsed.status).toBe('partially_failed')
    expect(parsed.targets[0]?.appliedVersion).toBe(4)
  })

  it('allows a scheduled publication to be rescheduled or cancelled but not left empty', () => {
    expect(SettingsPublicationPatch.parse({ scheduledForJst: '2026-09-01T10:00' }).status).toBe(
      undefined,
    )
    expect(SettingsPublicationPatch.parse({ status: 'cancelled' }).status).toBe('cancelled')
    expect(SettingsPublicationPatch.safeParse({}).success).toBe(false)
    expect(SettingsPublicationPatch.safeParse({ status: 'completed' }).success).toBe(false)
  })
})

describe('settings version history contract', () => {
  const summary = {
    versionId: ids.version,
    storeId: ids.store,
    version: 3,
    origin: 'store_override' as const,
    publishedAt: '2026-08-30T00:00:00.000Z',
    publishedBy: 'user-1',
    changedFields: ['purposes'],
  }

  it('lists a past version with the fields it changed', () => {
    expect(SettingsVersionSummary.parse(summary).changedFields).toEqual(['purposes'])
  })

  it('exposes the stored settings and a serialized diff for a past version', () => {
    const parsed = SettingsVersionDetail.parse({
      ...summary,
      settings: storeSettings,
      diff: [{ field: 'purposes', before: '[]', after: '[{"id":"x"}]' }],
    })
    expect(parsed.diff[0]?.field).toBe('purposes')
    expect(parsed.settings.storeId).toBe(ids.store)
  })
})
