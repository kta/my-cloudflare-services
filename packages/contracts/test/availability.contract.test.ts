import { describe, expect, it } from 'vitest'
import {
  AvailabilitySettingsInput,
  AvailabilitySlotsQuery,
  AvailabilityStoreSettings,
} from '../src/index'

const ids = {
  purpose: '0b4b58a5-0ea8-4ad8-8dc5-44f3db3f67d1',
  staff: 'bcd9f197-22a3-45e5-a36b-4de4e99bfcd7',
  equipment: 'd268c2d1-77ca-4385-a2bc-3e6b8a3b9f20',
  shift: 'ed343e14-d190-45e0-8b8a-7c4d73a0da41',
  maintenance: 'f03de5c4-8fb7-4974-b4bd-0e4f72c5ce43',
}

const baseSettings = {
  version: 0,
  receptionStatus: 'open' as const,
  businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
  exceptions: [],
  purposes: [
    {
      id: ids.purpose,
      staffName: '視力測定・新調相談',
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
    {
      id: ids.staff,
      name: '担当者',
      skills: ['眼鏡作製技能'],
      canBook: true,
      isActive: true,
    },
  ],
  shifts: [
    {
      id: ids.shift,
      staffId: ids.staff,
      date: '2026-08-31',
      startTime: '10:00',
      endTime: '19:00',
      breaks: [{ startTime: '13:00', endTime: '14:00' }],
    },
  ],
  equipment: [
    {
      id: ids.equipment,
      name: '視力測定機',
      capacity: 1,
      isActive: true,
      availablePeriods: [{ startTime: '10:00', endTime: '19:00' }],
    },
  ],
  maintenance: [
    {
      id: ids.maintenance,
      equipmentId: ids.equipment,
      date: '2026-08-31',
      startTime: '15:00',
      endTime: '16:00',
      reason: '定期点検',
    },
  ],
}

describe('availability contracts', () => {
  it('accepts a strict settings payload and keeps server-owned scope out of input', () => {
    const parsed = AvailabilitySettingsInput.parse(baseSettings)
    expect(parsed.version).toBe(0)
    expect(
      AvailabilitySettingsInput.safeParse({ ...baseSettings, organizationId: 'spoof' }).success,
    ).toBe(false)
    expect(
      AvailabilityStoreSettings.parse({
        ...baseSettings,
        storeId: '54fb6f4a-5e83-4260-8dd5-fc37d99a46d0',
      }).storeId,
    ).toBe('54fb6f4a-5e83-4260-8dd5-fc37d99a46d0')
  })

  it('rejects invalid local dates, reversed periods, and unknown purpose keys', () => {
    expect(
      AvailabilitySettingsInput.safeParse({
        ...baseSettings,
        businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '19:00', endTime: '10:00' }] }],
      }).success,
    ).toBe(false)
    expect(
      AvailabilitySettingsInput.safeParse({
        ...baseSettings,
        shifts: [{ ...baseSettings.shifts[0], date: '2026-02-30' }],
      }).success,
    ).toBe(false)
    expect(
      AvailabilitySettingsInput.safeParse({
        ...baseSettings,
        purposes: [{ ...baseSettings.purposes[0], unsupported: true }],
      }).success,
    ).toBe(false)
  })

  it('normalizes a comma-separated purpose query without allowing an empty selection', () => {
    expect(
      AvailabilitySlotsQuery.parse({
        date: '2026-08-31',
        purposeIds: `${ids.purpose},${ids.purpose}`,
      }).purposeIds,
    ).toEqual([ids.purpose])
    expect(AvailabilitySlotsQuery.safeParse({ date: '2026-08-31', purposeIds: '' }).success).toBe(
      false,
    )
  })
})
