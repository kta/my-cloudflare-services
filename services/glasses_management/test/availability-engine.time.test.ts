import { describe, expect, it } from 'vitest'
import {
  type AvailabilityBooking,
  calculateAvailability,
  selectAvailabilityAllocation,
} from '../src/worker/domain/availability'

const purpose = (overrides: Record<string, unknown> = {}) => ({
  id: '0b4b58a5-0ea8-4ad8-8dc5-44f3db3f67d1',
  staffName: '視力測定・新調相談',
  customerLabel: 'メガネを新しく作りたい',
  durationMinutes: 60,
  slotIntervalMinutes: 30,
  isPublic: true,
  requiredSkills: ['眼鏡作製技能'],
  requiredEquipment: ['視力測定機'],
  maxConcurrent: 1,
  ...overrides,
})

const staff = (overrides: Record<string, unknown> = {}) => ({
  id: 'bcd9f197-22a3-45e5-a36b-4de4e99bfcd7',
  name: '担当者',
  skills: ['眼鏡作製技能'],
  canBook: true,
  isActive: true,
  ...overrides,
})

const equipment = (overrides: Record<string, unknown> = {}) => ({
  id: 'd268c2d1-77ca-4385-a2bc-3e6b8a3b9f20',
  name: '視力測定機',
  capacity: 1,
  isActive: true,
  availablePeriods: [{ startTime: '10:00', endTime: '19:00' }],
  ...overrides,
})

const baseInput = (overrides: Record<string, unknown> = {}) => ({
  date: '2026-08-31',
  store: {
    receptionStatus: 'open' as const,
    businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
    exceptions: [],
  },
  purposes: [purpose()],
  staff: [staff()],
  shifts: [
    {
      id: 'ed343e14-d190-45e0-8b8a-7c4d73a0da41',
      staffId: 'bcd9f197-22a3-45e5-a36b-4de4e99bfcd7',
      date: '2026-08-31',
      startTime: '10:00',
      endTime: '19:00',
      breaks: [{ startTime: '13:00', endTime: '14:00' }],
    },
  ],
  equipment: [equipment()],
  maintenance: [
    {
      id: 'f03de5c4-8fb7-4974-b4bd-0e4f72c5ce43',
      equipmentId: 'd268c2d1-77ca-4385-a2bc-3e6b8a3b9f20',
      date: '2026-08-31',
      startTime: '15:00',
      endTime: '16:00',
      reason: '定期点検',
    },
  ],
  bookings: [] as AvailabilityBooking[],
  ...overrides,
})

describe('calculateAvailability', () => {
  it('generates JST candidates and treats business closing as an exclusive end boundary', () => {
    const result = calculateAvailability(baseInput())

    expect(result.timezone).toBe('Asia/Tokyo')
    expect(result.durationMinutes).toBe(60)
    expect(result.intervalMinutes).toBe(30)
    expect(result.slots[0]).toMatchObject({
      date: '2026-08-31',
      startTime: '10:00',
      endTime: '11:00',
      startAt: '2026-08-31T01:00:00.000Z',
      endAt: '2026-08-31T02:00:00.000Z',
    })
    expect(result.slots.some((slot) => slot.startTime === '18:00')).toBe(true)
    expect(result.slots.some((slot) => slot.startTime === '18:30')).toBe(false)
  })

  it('excludes staff breaks and equipment maintenance while retaining the other periods', () => {
    const result = calculateAvailability(baseInput())
    const starts = result.slots.map((slot) => slot.startTime)

    expect(starts).not.toContain('12:30')
    expect(starts).not.toContain('14:30')
    expect(starts).not.toContain('15:00')
    expect(starts).not.toContain('15:30')
    expect(starts).toContain('14:00')
    expect(starts).toContain('16:00')
  })

  it.each([
    ['closed exception', { mode: 'closed' as const, date: '2026-08-31', periods: [] }],
    ['paused exception', { mode: 'paused' as const, date: '2026-08-31', periods: [] }],
  ])('%s makes the date unavailable', (_name, exception) => {
    const result = calculateAvailability(
      baseInput({ store: { ...baseInput().store, exceptions: [exception] } }),
    )
    expect(result.slots).toEqual([])
  })

  it('uses an exceptional opening period instead of the weekly hours', () => {
    const result = calculateAvailability(
      baseInput({
        store: {
          ...baseInput().store,
          businessHours: [],
          exceptions: [
            {
              mode: 'open' as const,
              date: '2026-08-31',
              periods: [{ startTime: '11:00', endTime: '13:00' }],
            },
          ],
        },
      }),
    )
    expect(result.slots.map((slot) => slot.startTime)).toEqual(['11:00', '11:30', '12:00'])
  })

  it('requires one bookable staff member to own every selected skill', () => {
    const result = calculateAvailability(
      baseInput({
        purposes: [purpose({ requiredSkills: ['眼鏡作製技能', '接客'] })],
        staff: [staff({ skills: ['眼鏡作製技能'] })],
      }),
    )
    expect(result.slots).toEqual([])

    const withSkill = calculateAvailability(
      baseInput({
        purposes: [purpose({ requiredSkills: ['眼鏡作製技能', '接客'] })],
        staff: [staff({ skills: ['眼鏡作製技能', '接客'] })],
      }),
    )
    expect(withSkill.slots.length).toBeGreaterThan(0)
  })

  it('honors staff booking eligibility and existing competition with half-open intervals', () => {
    const booking: AvailabilityBooking = {
      id: 'a90e83e2-d3bb-437c-a8d2-1f799f65e1b5',
      startAt: '2026-08-31T01:00:00.000Z',
      endAt: '2026-08-31T02:00:00.000Z',
      purposeIds: ['0b4b58a5-0ea8-4ad8-8dc5-44f3db3f67d1'],
      staffId: 'bcd9f197-22a3-45e5-a36b-4de4e99bfcd7',
      equipmentIds: ['d268c2d1-77ca-4385-a2bc-3e6b8a3b9f20'],
      status: 'confirmed',
    }
    const result = calculateAvailability(baseInput({ bookings: [booking] }))
    expect(result.slots.some((slot) => slot.startTime === '10:00')).toBe(false)
    expect(result.slots.some((slot) => slot.startTime === '11:00')).toBe(true)

    const ineligible = calculateAvailability(
      baseInput({ staff: [staff({ canBook: false })], bookings: [] }),
    )
    expect(ineligible.slots).toEqual([])
  })

  it('combines multiple purposes by summing duration, taking the LCM interval, and unioning resources', () => {
    const result = calculateAvailability(
      baseInput({
        purposes: [
          purpose({
            id: '0b4b58a5-0ea8-4ad8-8dc5-44f3db3f67d1',
            durationMinutes: 30,
            slotIntervalMinutes: 20,
            requiredSkills: ['眼鏡作製技能'],
            requiredEquipment: ['視力測定機'],
          }),
          purpose({
            id: 'a5c14a06-3e33-4e5f-850b-789db0fae621',
            durationMinutes: 20,
            slotIntervalMinutes: 30,
            requiredSkills: ['接客'],
            requiredEquipment: ['相談席'],
          }),
        ],
        staff: [staff({ skills: ['眼鏡作製技能', '接客'] })],
        equipment: [
          equipment(),
          equipment({ id: 'f8ef02d1-9c3b-46b1-81bf-15dd187fb9bf', name: '相談席' }),
        ],
      }),
      ['0b4b58a5-0ea8-4ad8-8dc5-44f3db3f67d1', 'a5c14a06-3e33-4e5f-850b-789db0fae621'],
    )
    expect(result.durationMinutes).toBe(50)
    expect(result.intervalMinutes).toBe(60)
    expect(result.slots[0]).toMatchObject({ startTime: '10:00', endTime: '10:50' })
    expect(result.slots.map((slot) => slot.startTime)).toContain('14:00')
  })

  it('enforces simultaneous capacity independently for each selected purpose', () => {
    const first: AvailabilityBooking = {
      id: 'a90e83e2-d3bb-437c-a8d2-1f799f65e1b5',
      startAt: '2026-08-31T01:00:00.000Z',
      endAt: '2026-08-31T02:00:00.000Z',
      purposeIds: ['0b4b58a5-0ea8-4ad8-8dc5-44f3db3f67d1'],
      status: 'confirmed',
    }
    const second = { ...first, id: 'c6cb9a82-7b28-4a86-bd58-17a9fcb3dbd4' }
    expect(
      calculateAvailability(baseInput({ bookings: [first] })).slots.some(
        (slot) => slot.startTime === '10:00',
      ),
    ).toBe(false)
    expect(
      calculateAvailability(
        baseInput({ purposes: [purpose({ maxConcurrent: 2 })], bookings: [first] }),
      ).slots.some((slot) => slot.startTime === '10:00'),
    ).toBe(true)
    expect(
      calculateAvailability(
        baseInput({ purposes: [purpose({ maxConcurrent: 2 })], bookings: [first, second] }),
      ).slots.some((slot) => slot.startTime === '10:00'),
    ).toBe(false)
  })

  it('selects concrete staff and equipment for a candidate and rejects missing resources', () => {
    const input = baseInput({ maintenance: [] })
    const slot = calculateAvailability(input).slots[0]
    expect(slot).toBeDefined()
    expect(selectAvailabilityAllocation(input, [purpose().id], slot!)).toEqual({
      staffId: staff().id,
      equipmentIds: [equipment().id],
    })
    expect(() =>
      selectAvailabilityAllocation(
        baseInput({ staff: [staff({ canBook: false })], maintenance: [] }),
        [purpose().id],
        slot!,
      ),
    ).toThrow('no staff can be allocated')
    expect(() =>
      selectAvailabilityAllocation(
        baseInput({ equipment: [], maintenance: [] }),
        [purpose().id],
        slot!,
      ),
    ).toThrow('no equipment can be allocated')
  })

  it('rejects an invalid calendar date before calculating JST candidates', () => {
    expect(() => calculateAvailability(baseInput({ date: '2026-02-29' }))).toThrow(RangeError)
  })
})
