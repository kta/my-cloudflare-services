import { describe, expect, it } from 'vitest'
import {
  CustomerSearchQuery,
  LocalDate,
  PublicReservationChange,
  PublicStoreSearchQuery,
  ReservationChangeInput,
  ReservationSearchQuery,
  StaffReservationCreate,
  StoreSwitchInput,
} from '../src/index'

const storeA = '79a59f06-5bd1-4fb4-8574-14b7a79bd48b'
const storeB = '2d16f9a5-2f4d-4a51-9dbd-6a2b8a9d5cb1'
const purposeA = 'b6b4a83b-0ec9-4ea7-8d1c-4b0d1de49a41'
const purposeB = 'f0f70f0f-8f5c-4a2b-9a92-1f0d3a2b7c55'

/*
 * These contracts carry rules that a plain object schema cannot express:
 * cross-field agreement, ordering, and set uniqueness. A regression here is
 * silent — the Worker would accept a payload the domain cannot honour — so each
 * refinement is asserted in both directions.
 */
describe('glasses_management contract refinements', () => {
  describe('StoreSwitchInput', () => {
    it('accepts a switch between two different stores', () => {
      expect(StoreSwitchInput.parse({ fromStoreId: storeA, toStoreId: storeB })).toEqual({
        fromStoreId: storeA,
        toStoreId: storeB,
      })
    })

    it('rejects a switch whose destination equals its source', () => {
      const result = StoreSwitchInput.safeParse({ fromStoreId: storeA, toStoreId: storeA })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('destination must differ from source')
    })
  })

  describe('PublicStoreSearchQuery', () => {
    it('accepts a text-only search with no coordinates', () => {
      expect(PublicStoreSearchQuery.parse({ q: '銀座' })).toEqual({ q: '銀座' })
    })

    it('accepts a coordinate pair supplied together', () => {
      expect(PublicStoreSearchQuery.parse({ latitude: '35.67', longitude: '139.76' })).toEqual({
        latitude: 35.67,
        longitude: 139.76,
      })
    })

    it('rejects a latitude without a longitude', () => {
      const result = PublicStoreSearchQuery.safeParse({ latitude: 35.67 })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.path).toEqual(['longitude'])
    })

    it('rejects a longitude without a latitude', () => {
      expect(PublicStoreSearchQuery.safeParse({ longitude: 139.76 }).success).toBe(false)
    })
  })

  describe('LocalDate', () => {
    it('accepts a real calendar date including a leap day', () => {
      expect(LocalDate.parse('2028-02-29')).toBe('2028-02-29')
    })

    it('rejects a value that is not shaped like YYYY-MM-DD at all', () => {
      expect(LocalDate.safeParse('2026/08/27').success).toBe(false)
      expect(LocalDate.safeParse('').success).toBe(false)
    })

    it('rejects a well-shaped but non-existent date', () => {
      expect(LocalDate.safeParse('2027-02-29').success).toBe(false)
      expect(LocalDate.safeParse('2026-13-01').success).toBe(false)
    })
  })

  describe('purposeIds uniqueness', () => {
    const publicChange = {
      version: 1,
      date: '2026-09-01',
      startTime: '10:00',
      purposeIds: [purposeA, purposeB],
    }

    it('accepts distinct purposes on a public change', () => {
      expect(PublicReservationChange.parse(publicChange).purposeIds).toEqual([purposeA, purposeB])
    })

    it('rejects duplicated purposes on a public change', () => {
      const result = PublicReservationChange.safeParse({
        ...publicChange,
        purposeIds: [purposeA, purposeA],
      })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('purposeIds must be unique')
    })

    const staffCreate = {
      date: '2026-09-01',
      startTime: '10:00',
      purposeIds: [purposeA, purposeB],
      customer: { name: '山田 太郎', kana: 'ヤマダ タロウ', phone: '09012345678' },
      recital: '9月1日10時、銀座店でお待ちしております。',
    }

    it('accepts distinct purposes on a staff reservation', () => {
      expect(StaffReservationCreate.parse(staffCreate).purposeIds).toEqual([purposeA, purposeB])
    })

    it('rejects duplicated purposes on a staff reservation', () => {
      const result = StaffReservationCreate.safeParse({
        ...staffCreate,
        purposeIds: [purposeB, purposeB],
      })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('purposeIds must be unique')
    })

    const staffChange = {
      version: 3,
      date: '2026-09-01',
      startTime: '10:00',
      purposeIds: [purposeA, purposeB],
      reason: '顧客都合により変更',
    }

    it('accepts distinct purposes on a staff change', () => {
      expect(ReservationChangeInput.parse(staffChange).purposeIds).toEqual([purposeA, purposeB])
    })

    it('rejects duplicated purposes on a staff change', () => {
      const result = ReservationChangeInput.safeParse({
        ...staffChange,
        purposeIds: [purposeA, purposeA],
      })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('purposeIds must be unique')
    })
  })

  describe('ReservationSearchQuery date range', () => {
    it('accepts a range with no dates at all', () => {
      expect(ReservationSearchQuery.parse({ phone: '09012345678' })).toEqual({
        phone: '09012345678',
      })
    })

    it('accepts an open-ended range in either direction', () => {
      expect(ReservationSearchQuery.parse({ dateFrom: '2026-09-01' }).dateFrom).toBe('2026-09-01')
      expect(ReservationSearchQuery.parse({ dateTo: '2026-09-01' }).dateTo).toBe('2026-09-01')
    })

    it('accepts a single-day range where the bounds are equal', () => {
      expect(
        ReservationSearchQuery.parse({ dateFrom: '2026-09-01', dateTo: '2026-09-01' }).dateTo,
      ).toBe('2026-09-01')
    })

    it('rejects a range whose start is after its end', () => {
      const result = ReservationSearchQuery.safeParse({
        dateFrom: '2026-09-02',
        dateTo: '2026-09-01',
      })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.path).toEqual(['dateTo'])
      expect(result.error?.issues[0]?.message).toBe('dateFrom must not be after dateTo')
    })
  })

  describe('CustomerSearchQuery', () => {
    it.each([
      ['phone', { phone: '09012345678' }],
      ['name', { name: '山田 太郎' }],
      ['kana', { kana: 'ヤマダ タロウ' }],
    ])('accepts exactly one %s term', (_label, query) => {
      expect(CustomerSearchQuery.parse(query)).toEqual(query)
    })

    it('rejects a query with no search term', () => {
      const result = CustomerSearchQuery.safeParse({})
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('exactly one customer search term is required')
    })

    it('rejects a query that combines several search terms', () => {
      expect(
        CustomerSearchQuery.safeParse({ phone: '09012345678', name: '山田 太郎' }).success,
      ).toBe(false)
    })
  })
})
