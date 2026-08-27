import { describe, expect, it } from 'vitest'
import { fixedClock } from '../src/worker/domain/clock'
import {
  instantToJstDateTime,
  isPublicationDue,
  jstDateTimeToInstant,
} from '../src/worker/domain/settings-publication'

describe('JST publication window (UC-EYEX-166)', () => {
  it('converts a JST wall-clock instant to UTC across the day boundary', () => {
    expect(jstDateTimeToInstant('2026-08-31T09:00')).toBe('2026-08-31T00:00:00.000Z')
    // 00:00 JST is the previous UTC day; the boundary must stay unambiguous.
    expect(jstDateTimeToInstant('2026-09-01T00:00')).toBe('2026-08-31T15:00:00.000Z')
    expect(jstDateTimeToInstant('2026-12-31T23:59')).toBe('2026-12-31T14:59:00.000Z')
    // Leap day.
    expect(jstDateTimeToInstant('2028-02-29T09:00')).toBe('2028-02-29T00:00:00.000Z')
  })

  it('rejects a malformed JST instant instead of guessing', () => {
    expect(() => jstDateTimeToInstant('2026-08-31')).toThrow(RangeError)
    expect(() => jstDateTimeToInstant('2026-02-30T09:00')).toThrow(RangeError)
    expect(() => jstDateTimeToInstant('2026-08-31T24:00')).toThrow(RangeError)
  })

  it('round-trips an instant back into its JST wall clock', () => {
    expect(instantToJstDateTime('2026-08-31T00:00:00.000Z')).toBe('2026-08-31T09:00')
    expect(instantToJstDateTime('2026-08-31T15:00:00.000Z')).toBe('2026-09-01T00:00')
  })

  it('treats the scheduled instant itself as due, and one second earlier as not due', () => {
    const scheduledAt = jstDateTimeToInstant('2026-08-31T09:00')
    expect(isPublicationDue(scheduledAt, fixedClock('2026-08-30T23:59:59.000Z').now())).toBe(false)
    // Exactly the boundary.
    expect(isPublicationDue(scheduledAt, fixedClock('2026-08-31T00:00:00.000Z').now())).toBe(true)
    expect(isPublicationDue(scheduledAt, fixedClock('2026-08-31T00:00:01.000Z').now())).toBe(true)
  })

  it('decides the JST midnight boundary by the instant, not the calendar date', () => {
    const scheduledAt = jstDateTimeToInstant('2026-09-01T00:00')
    expect(isPublicationDue(scheduledAt, fixedClock('2026-08-31T14:59:59.999Z').now())).toBe(false)
    expect(isPublicationDue(scheduledAt, fixedClock('2026-08-31T15:00:00.000Z').now())).toBe(true)
  })

  it('rejects an invalid scheduled instant rather than silently running', () => {
    expect(() => isPublicationDue('not-an-instant', new Date('2026-08-31T00:00:00.000Z'))).toThrow(
      RangeError,
    )
  })
})
