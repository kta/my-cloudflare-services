import { describe, expect, it } from 'vitest'
import {
  managementCodeAccessError,
  reservationModificationAccessError,
  verifiedReservationSessionAccessError,
} from '../src/worker/domain/management-code'

describe('management-code time and scope access', () => {
  it.each([
    ['one millisecond before expiry', '2026-08-31T00:14:59.999Z', null],
    ['at expiry', '2026-08-31T00:15:00.000Z', 'management_code_expired'],
    ['after expiry', '2026-08-31T00:15:00.001Z', 'management_code_expired'],
  ] as const)('%s', (_name, now, expected) => {
    expect(
      managementCodeAccessError(
        { expiresAt: '2026-08-31T00:15:00.000Z', revokedAt: null, failedAttempts: 0 },
        new Date(now),
      ),
    ).toBe(expected)
  })

  it('locks exactly at the fifth failed management-code attempt', () => {
    expect(
      managementCodeAccessError(
        { expiresAt: '2026-08-31T00:15:00.000Z', revokedAt: null, failedAttempts: 4 },
        new Date('2026-08-31T00:00:00.000Z'),
      ),
    ).toBeNull()
    expect(
      managementCodeAccessError(
        { expiresAt: '2026-08-31T00:15:00.000Z', revokedAt: null, failedAttempts: 5 },
        new Date('2026-08-31T00:00:00.000Z'),
      ),
    ).toBe('management_code_attempt_limit')
  })

  it('fails closed when persisted expiry timestamps are malformed', () => {
    expect(
      managementCodeAccessError(
        { expiresAt: 'not-a-date', revokedAt: null, failedAttempts: 0 },
        new Date('2026-08-31T00:00:00.000Z'),
      ),
    ).toBe('management_code_expired')
    expect(
      verifiedReservationSessionAccessError(
        {
          organizationId: 'org-a',
          storeId: 'store-a',
          reservationId: 'reservation-a',
          expiresAt: 'not-a-date',
        },
        { organizationId: 'org-a', storeId: 'store-a', reservationId: 'reservation-a' },
        new Date('2026-08-31T00:00:00.000Z'),
      ),
    ).toBe('verification_expired')
  })

  it('rejects a verified session at expiry and for a different reservation', () => {
    const session = {
      organizationId: 'org-a',
      storeId: 'store-a',
      reservationId: 'reservation-a',
      expiresAt: '2026-08-31T00:15:00.000Z',
    }
    expect(
      verifiedReservationSessionAccessError(
        session,
        { organizationId: 'org-a', storeId: 'store-a', reservationId: 'reservation-a' },
        new Date('2026-08-31T00:14:59.999Z'),
      ),
    ).toBeNull()
    expect(
      verifiedReservationSessionAccessError(
        session,
        { organizationId: 'org-a', storeId: 'store-a', reservationId: 'reservation-a' },
        new Date('2026-08-31T00:15:00.000Z'),
      ),
    ).toBe('verification_expired')
    expect(
      verifiedReservationSessionAccessError(
        session,
        { organizationId: 'org-a', storeId: 'store-a', reservationId: 'reservation-b' },
        new Date('2026-08-31T00:00:00.000Z'),
      ),
    ).toBe('verification_scope_mismatch')
  })

  it.each([
    ['one millisecond before the reservation starts', '2026-08-31T00:59:59.999Z', null],
    [
      'exactly at the reservation start',
      '2026-08-31T01:00:00.000Z',
      'reservation_modification_deadline_passed',
    ],
    [
      'one millisecond after the reservation starts',
      '2026-08-31T01:00:00.001Z',
      'reservation_modification_deadline_passed',
    ],
  ] as const)('applies the customer cancellation deadline %s', (_case, now, expected) => {
    expect(reservationModificationAccessError('2026-08-31T01:00:00.000Z', new Date(now))).toBe(
      expected,
    )
  })

  it('fails closed when a persisted reservation start timestamp is malformed', () => {
    expect(
      reservationModificationAccessError('not-a-date', new Date('2026-08-31T00:00:00.000Z')),
    ).toBe('reservation_modification_deadline_passed')
  })
})
