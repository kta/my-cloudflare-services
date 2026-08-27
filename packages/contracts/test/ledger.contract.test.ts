import { describe, expect, it } from 'vitest'
import { LedgerEntry, ReservationProgressPatch } from '../src/glasses_management'

describe('EYEX ledger contracts', () => {
  it('accepts a reservation ledger entry with its current progress', () => {
    expect(
      LedgerEntry.parse({
        id: '67ea3d05-249f-4e4d-b33b-9bfb0a863ec6',
        entryType: 'reservation',
        source: 'staff',
        status: 'checked_in',
        startAt: '2026-08-31T01:00:00.000Z',
        endAt: '2026-08-31T02:00:00.000Z',
        customerName: '山田 花子',
        customerId: '34a573e0-21f7-47e6-9894-7a1d9f3b9f2b',
        progress: 'waiting',
        waitStartedAt: '2026-08-31T01:00:00.000Z',
        assignedStaffId: null,
        assignedEquipmentIds: [],
        nextGuidance: null,
        purposeNames: ['視力測定・新調相談'],
        warnings: [
          {
            code: 'long_wait',
            message: '待機時間が12分を超えています。次のご案内を確認してください。',
          },
        ],
        version: 2,
      }),
    ).toMatchObject({ entryType: 'reservation', progress: 'waiting' })
  })

  it('requires a version and a concrete progress state when updating a reservation', () => {
    expect(
      ReservationProgressPatch.safeParse({
        version: 2,
        progress: 'service_in_progress',
        nextGuidance: '視力測定へご案内',
      }).success,
    ).toBe(true)
    expect(ReservationProgressPatch.safeParse({ progress: 'service_in_progress' }).success).toBe(
      false,
    )
  })
})
