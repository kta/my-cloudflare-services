import { describe, expect, it } from 'vitest'
import {
  changedSettingsFields,
  deriveStoreScopedSettings,
  evaluateSettingsImpact,
  settingsDiff,
} from '../src/worker/domain/settings-publication'

const ids = {
  draft: '0b4b58a5-0ea8-4ad8-8dc5-44f3db3f67d1',
  store: 'bcd9f197-22a3-45e5-a36b-4de4e99bfcd7',
  purpose: 'd268c2d1-77ca-4385-a2bc-3e6b8a3b9f20',
  staff: 'ed343e14-d190-45e0-8b8a-7c4d73a0da41',
  equipment: 'f03de5c4-8fb7-4974-b4bd-0e4f72c5ce43',
  reservation: 'a2c3f4d5-6e7f-4a8b-9c0d-1e2f3a4b5c6d',
}

function settings(overrides: Record<string, unknown> = {}) {
  return {
    storeId: ids.store,
    version: 1,
    receptionStatus: 'open' as const,
    // 2026-08-31 (JST) is a Monday.
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
    ...overrides,
  }
}

const booking = {
  id: ids.reservation,
  // 2026-08-31 11:00 JST
  startAt: '2026-08-31T02:00:00.000Z',
  endAt: '2026-08-31T03:00:00.000Z',
  purposeIds: [ids.purpose],
  staffId: ids.staff,
  status: 'confirmed' as const,
}

function evaluate(overrides: Partial<Parameters<typeof evaluateSettingsImpact>[0]> = {}) {
  return evaluateSettingsImpact({
    draftId: ids.draft,
    storeId: ids.store,
    evaluatedAt: '2026-08-31T00:00:00.000Z',
    published: settings(),
    draft: settings(),
    bookings: [booking],
    resolutions: [],
    publicSlots: { date: '2026-08-31', publishedCount: 8, draftCount: 8 },
    ...overrides,
  })
}

describe('settings impact evaluation (AC-EYEX-46, 66, 109)', () => {
  it('reports nothing blocking when the draft still fits every reservation', () => {
    const report = evaluate()
    expect(report.blockingCount).toBe(0)
    expect(report.canPublish).toBe(true)
    expect(report.items).toEqual([])
    expect(report.ledgerEntriesAffected).toBe(0)
  })

  it('blocks when a draft removes the purpose a future reservation uses', () => {
    const report = evaluate({ draft: settings({ purposes: [] }) })
    const item = report.items.find((entry) => entry.kind === 'reservation_conflict')
    expect(item?.severity).toBe('blocking')
    expect(item?.reservationId).toBe(ids.reservation)
    expect(report.canPublish).toBe(false)
    expect(report.ledgerEntriesAffected).toBe(1)
  })

  it('blocks on a missing staff skill and on missing equipment', () => {
    const noSkill = evaluate({
      draft: settings({
        staff: [{ id: ids.staff, name: '担当者', skills: [], canBook: true, isActive: true }],
      }),
    })
    expect(noSkill.items.some((item) => item.kind === 'missing_staff_skill')).toBe(true)
    expect(noSkill.canPublish).toBe(false)

    const noEquipment = evaluate({ draft: settings({ equipment: [] }) })
    expect(noEquipment.items.some((item) => item.kind === 'missing_equipment')).toBe(true)
    expect(noEquipment.canPublish).toBe(false)
  })

  it('warns without blocking when a reservation falls outside the drafted hours', () => {
    const report = evaluate({
      draft: settings({
        businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '14:00', endTime: '19:00' }] }],
      }),
    })
    const item = report.items.find((entry) => entry.kind === 'out_of_hours')
    expect(item?.severity).toBe('warning')
    expect(item?.reservationId).toBe(ids.reservation)
    expect(report.warningCount).toBeGreaterThan(0)
    expect(report.canPublish).toBe(true)
  })

  it('reports the public web slots the draft would change', () => {
    const report = evaluate({
      publicSlots: { date: '2026-08-31', publishedCount: 8, draftCount: 4 },
    })
    const item = report.items.find((entry) => entry.kind === 'web_slot_change')
    expect(item?.severity).toBe('info')
    expect(report.publicSlots.draftCount).toBe(4)
    expect(report.canPublish).toBe(true)
  })

  it('ignores cancelled and already-past reservations', () => {
    const report = evaluate({
      draft: settings({ purposes: [] }),
      bookings: [
        { ...booking, status: 'cancelled' as const },
        {
          ...booking,
          id: ids.staff,
          startAt: '2026-08-30T02:00:00.000Z',
          endAt: '2026-08-30T03:00:00.000Z',
        },
      ],
    })
    expect(report.items.filter((item) => item.reservationId !== null)).toEqual([])
  })

  it('unblocks a conflicting reservation once a resolution is recorded (AC-EYEX-109)', () => {
    const report = evaluate({
      draft: settings({ purposes: [] }),
      resolutions: [{ reservationId: ids.reservation, resolution: 'alternative_resource' }],
    })
    const item = report.items.find((entry) => entry.kind === 'reservation_conflict')
    expect(item?.severity).toBe('warning')
    expect(item?.resolution).toBe('alternative_resource')
    expect(report.blockingCount).toBe(0)
    expect(report.canPublish).toBe(true)
  })
})

describe('settings version diff (AC-EYEX-108)', () => {
  it('lists only the fields that actually changed', () => {
    const before = settings()
    const after = settings({ receptionStatus: 'paused' as const, purposes: [] })
    expect(changedSettingsFields(before, after).sort()).toEqual(['purposes', 'receptionStatus'])
    const diff = settingsDiff(before, after)
    expect(diff.map((entry) => entry.field).sort()).toEqual(['purposes', 'receptionStatus'])
    expect(diff.find((entry) => entry.field === 'receptionStatus')).toEqual({
      field: 'receptionStatus',
      before: '"open"',
      after: '"paused"',
    })
  })

  it('reports no diff between identical settings regardless of the version number', () => {
    expect(settingsDiff(settings(), settings({ version: 9 }))).toEqual([])
  })
})

describe('distributing one draft to another store (UC-EYEX-092)', () => {
  it('derives stable store-local resource ids so two stores can hold the same setting', async () => {
    const source = settings()
    const first = await deriveStoreScopedSettings(source, 'store-a')
    const again = await deriveStoreScopedSettings(source, 'store-a')
    const other = await deriveStoreScopedSettings(source, 'store-b')

    expect(first.purposes[0]?.id).not.toBe(source.purposes[0]?.id)
    // Deterministic: republishing the same value keeps the same rows.
    expect(again.purposes[0]?.id).toBe(first.purposes[0]?.id)
    // Store-local: another store never collides with the first one's ids.
    expect(other.purposes[0]?.id).not.toBe(first.purposes[0]?.id)
    expect(first.storeId).toBe('store-a')
  })

  it('keeps every internal reference pointing at the remapped resource', async () => {
    const source = settings({
      shifts: [
        {
          id: 'a4f0c9d7-1111-4a2b-9c3d-1e2f3a4b5c6d',
          staffId: ids.staff,
          date: '2026-08-31',
          startTime: '10:00',
          endTime: '19:00',
          breaks: [],
        },
      ],
      maintenance: [
        {
          id: 'b4f0c9d7-2222-4a2b-9c3d-1e2f3a4b5c6d',
          equipmentId: ids.equipment,
          date: '2026-08-31',
          startTime: '12:00',
          endTime: '13:00',
          reason: '点検',
        },
      ],
    })
    const derived = await deriveStoreScopedSettings(source, 'store-a')
    expect(derived.shifts[0]?.staffId).toBe(derived.staff[0]?.id)
    expect(derived.maintenance[0]?.equipmentId).toBe(derived.equipment[0]?.id)
  })
})
