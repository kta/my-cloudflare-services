import { SELF } from 'cloudflare:test'
import type { AnalyticsReport } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  analyticsUrl,
  auth,
  BASE,
  insertReservation,
  seedStore,
  tokenFor,
} from './analytics.fixtures'

/*
 * JST boundaries end to end. A JST calendar day starts at 15:00 UTC the day
 * before, so every one of these cases would silently shift by nine hours if a
 * handler ever aggregated in UTC.
 */

async function seed() {
  const store = await seedStore()
  const adminToken = await tokenFor(store.organizationId, 'admin')
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${store.storeId}/analytics/settings`,
    auth(adminToken, {
      method: 'PUT',
      body: JSON.stringify({ smallSampleThreshold: 1, targets: [] }),
    }),
  )
  expect(response.status).toBe(200)
  return store
}

async function reservationsIn(
  store: { storeId: string; token: string },
  granularity: string,
  date: string,
): Promise<AnalyticsReport> {
  const response = await SELF.fetch(
    analyticsUrl(store.storeId, granularity, date),
    auth(store.token),
  )
  expect(response.status).toBe(200)
  return (await response.json()) as AnalyticsReport
}

function count(report: AnalyticsReport): number | null {
  return report.metrics.find((metric) => metric.metric === 'reservations')?.value ?? null
}

describe('JST day boundary', () => {
  it('puts 14:59:59.999Z in the previous JST day and 15:00:00.000Z in the next', async () => {
    const store = await seed()
    await insertReservation({ ...store, startAt: '2026-08-30T14:59:59.999Z' })
    await insertReservation({ ...store, startAt: '2026-08-30T15:00:00.000Z' })

    expect(count(await reservationsIn(store, 'day', '2026-08-30'))).toBe(1)
    expect(count(await reservationsIn(store, 'day', '2026-08-31'))).toBe(1)
  })

  it('resolves each JST day to the UTC 15:00 window', async () => {
    const store = await seed()
    const report = await reservationsIn(store, 'day', '2026-08-31')
    expect(report.period.startAt).toBe('2026-08-30T15:00:00.000Z')
    expect(report.period.endAt).toBe('2026-08-31T15:00:00.000Z')
    expect(report.previousPeriod.startAt).toBe('2026-08-29T15:00:00.000Z')
    expect(report.previousPeriod.endAt).toBe('2026-08-30T15:00:00.000Z')
  })
})

describe('JST month boundary', () => {
  it('splits the last JST day of August from the first of September', async () => {
    const store = await seed()
    // JST 2026-08-31 23:59 and JST 2026-09-01 00:00.
    await insertReservation({ ...store, startAt: '2026-08-31T14:59:00.000Z' })
    await insertReservation({ ...store, startAt: '2026-08-31T15:00:00.000Z' })

    expect(count(await reservationsIn(store, 'month', '2026-08-15'))).toBe(1)
    expect(count(await reservationsIn(store, 'month', '2026-09-15'))).toBe(1)
  })

  it('compares September against the whole of August', async () => {
    const store = await seed()
    const report = await reservationsIn(store, 'month', '2026-09-15')
    expect(report.period).toMatchObject({ startDate: '2026-09-01', endDate: '2026-09-30' })
    expect(report.previousPeriod).toMatchObject({ startDate: '2026-08-01', endDate: '2026-08-31' })
  })
})

describe('JST year boundary', () => {
  it('splits JST New Year Eve from New Year Day', async () => {
    const store = await seed()
    // JST 2026-12-31 23:59 and JST 2027-01-01 00:00.
    await insertReservation({ ...store, startAt: '2026-12-31T14:59:00.000Z' })
    await insertReservation({ ...store, startAt: '2026-12-31T15:00:00.000Z' })

    expect(count(await reservationsIn(store, 'day', '2026-12-31'))).toBe(1)
    expect(count(await reservationsIn(store, 'day', '2027-01-01'))).toBe(1)
    expect(count(await reservationsIn(store, 'month', '2026-12-01'))).toBe(1)
    expect(count(await reservationsIn(store, 'month', '2027-01-01'))).toBe(1)
  })

  it('compares January against the previous December', async () => {
    const store = await seed()
    const report = await reservationsIn(store, 'month', '2027-01-15')
    expect(report.previousPeriod).toMatchObject({ startDate: '2026-12-01', endDate: '2026-12-31' })
  })
})

describe('leap year', () => {
  it('counts the JST leap day inside February 2028', async () => {
    const store = await seed()
    // JST 2028-02-29 09:00.
    await insertReservation({ ...store, startAt: '2028-02-29T00:00:00.000Z' })
    // JST 2028-03-01 00:00.
    await insertReservation({ ...store, startAt: '2028-02-29T15:00:00.000Z' })

    expect(count(await reservationsIn(store, 'day', '2028-02-29'))).toBe(1)
    expect(count(await reservationsIn(store, 'month', '2028-02-01'))).toBe(1)
    const february = await reservationsIn(store, 'month', '2028-02-10')
    expect(february.period.endDate).toBe('2028-02-29')
    expect(count(await reservationsIn(store, 'day', '2028-03-01'))).toBe(1)
  })

  it('compares March 2028 against a 29-day February', async () => {
    const store = await seed()
    const report = await reservationsIn(store, 'month', '2028-03-10')
    expect(report.previousPeriod).toMatchObject({ startDate: '2028-02-01', endDate: '2028-02-29' })
  })

  it('rejects a leap day that does not exist', async () => {
    const store = await seed()
    const response = await SELF.fetch(
      analyticsUrl(store.storeId, 'day', '2026-02-29'),
      auth(store.token),
    )
    expect(response.status).toBe(400)
  })
})

describe('JST week boundary', () => {
  it('runs Monday to Sunday and steps back a whole week', async () => {
    const store = await seed()
    // JST Sunday 2026-08-30 23:59 and JST Monday 2026-08-31 00:00.
    await insertReservation({ ...store, startAt: '2026-08-30T14:59:00.000Z' })
    await insertReservation({ ...store, startAt: '2026-08-30T15:00:00.000Z' })

    const previousWeek = await reservationsIn(store, 'week', '2026-08-30')
    expect(previousWeek.period).toMatchObject({ startDate: '2026-08-24', endDate: '2026-08-30' })
    expect(count(previousWeek)).toBe(1)

    const currentWeek = await reservationsIn(store, 'week', '2026-08-31')
    expect(currentWeek.period).toMatchObject({ startDate: '2026-08-31', endDate: '2026-09-06' })
    expect(currentWeek.previousPeriod).toMatchObject({
      startDate: '2026-08-24',
      endDate: '2026-08-30',
    })
    expect(count(currentWeek)).toBe(1)
  })
})
