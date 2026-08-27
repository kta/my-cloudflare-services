import { toJstDateString, toJstMonthKey } from '@app/shared'

/**
 * Clock is the only source of time allowed in domain services. Production
 * callers can provide a system clock, while tests and replay jobs inject a
 * deterministic one.
 */
export type Clock = Readonly<{
  now: () => Date
}>

/** Construct a clock from a function without taking ownership of its state. */
export function createClock(now: () => Date): Clock {
  return Object.freeze({
    now: () => {
      const value = now()
      if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        throw new RangeError('clock returned an invalid date')
      }
      return new Date(value.getTime())
    },
  })
}

/** A clock that always returns a defensive copy of the supplied instant. */
export function fixedClock(at: string | Date | number): Clock {
  const value = new Date(at)
  if (Number.isNaN(value.getTime())) throw new RangeError('invalid fixed clock date')
  const timestamp = value.getTime()
  return createClock(() => new Date(timestamp))
}

/** Explicit system clock for the few production entry points that need it. */
export function systemClock(): Clock {
  return createClock(() => new Date())
}

export function nowIso(clock: Clock): string {
  return clock.now().toISOString()
}

export function jstDateKey(clock: Clock): string {
  return toJstDateString(clock.now())
}

export function jstMonthKey(clock: Clock): string {
  return toJstMonthKey(clock.now())
}
