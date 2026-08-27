import { SELF } from 'cloudflare:test'
import type { AlertEvaluationResult, AlertRecord, AnalyticsReport } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  analyticsUrl,
  auth,
  BASE,
  insertFailedRecording,
  insertReservation,
  required,
  seedStore,
  syncMembership,
  tokenFor,
  uuid,
} from './analytics.fixtures'

const MORNING = '2026-08-31T01:00:00.000Z'

async function withThreshold(organizationId: string, storeId: string) {
  const adminToken = await tokenFor(organizationId, 'admin')
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/analytics/settings`,
    auth(adminToken, {
      method: 'PUT',
      body: JSON.stringify({ smallSampleThreshold: 1, targets: [] }),
    }),
  )
  expect(response.status).toBe(200)
}

describe('analytics tenant isolation', () => {
  it('never counts another tenant rows and never exposes another tenant store', async () => {
    const alpha = await seedStore('アルファ新宿')
    const bravo = await seedStore('ブラボー渋谷')
    const charlie = await seedStore('チャーリー池袋')
    for (const store of [alpha, bravo, charlie]) {
      await withThreshold(store.organizationId, store.storeId)
    }
    await insertReservation({ ...alpha, startAt: MORNING })
    await insertReservation({ ...bravo, startAt: MORNING })
    await insertReservation({ ...bravo, startAt: MORNING })
    await insertReservation({ ...charlie, startAt: MORNING })
    await insertReservation({ ...charlie, startAt: MORNING })
    await insertReservation({ ...charlie, startAt: MORNING })

    const reports = await Promise.all(
      [alpha, bravo, charlie].map(async (store) => {
        const response = await SELF.fetch(
          analyticsUrl(store.storeId, 'day', '2026-08-31'),
          auth(store.token),
        )
        expect(response.status).toBe(200)
        return (await response.json()) as AnalyticsReport
      }),
    )
    expect(reports.map((report) => report.totalCount)).toEqual([1, 2, 3])
    expect(reports.map((report) => report.storeName)).toEqual([
      'アルファ新宿',
      'ブラボー渋谷',
      'チャーリー池袋',
    ])

    // A token from one tenant cannot address another tenant store id.
    const crossed = await SELF.fetch(
      analyticsUrl(bravo.storeId, 'day', '2026-08-31'),
      auth(alpha.token),
    )
    expect(crossed.status).toBe(403)
  })

  it('keeps one tenant suppression threshold out of another tenant report', async () => {
    const alpha = await seedStore()
    const bravo = await seedStore()
    await withThreshold(alpha.organizationId, alpha.storeId)
    const bravoAdmin = await tokenFor(bravo.organizationId, 'admin')
    await SELF.fetch(
      `${BASE}/api/staff/stores/${bravo.storeId}/analytics/settings`,
      auth(bravoAdmin, {
        method: 'PUT',
        body: JSON.stringify({ smallSampleThreshold: 50, targets: [] }),
      }),
    )
    await insertReservation({ ...alpha, startAt: MORNING })
    await insertReservation({ ...bravo, startAt: MORNING })

    const alphaReport = (await (
      await SELF.fetch(analyticsUrl(alpha.storeId, 'day', '2026-08-31'), auth(alpha.token))
    ).json()) as AnalyticsReport
    const bravoReport = (await (
      await SELF.fetch(analyticsUrl(bravo.storeId, 'day', '2026-08-31'), auth(bravo.token))
    ).json()) as AnalyticsReport
    expect(alphaReport.smallSampleThreshold).toBe(1)
    expect(alphaReport.status).toBe('ok')
    expect(bravoReport.smallSampleThreshold).toBe(50)
    expect(bravoReport.status).toBe('suppressed')
  })
})

describe('alert tenant isolation', () => {
  it('never lists, reads or resolves another tenant alert', async () => {
    const alpha = await seedStore()
    const bravo = await seedStore()
    const operators = await Promise.all(
      [alpha, bravo].map(async (store) => {
        const userId = uuid()
        await syncMembership({
          organizationId: store.organizationId,
          storeId: store.storeId,
          userId,
          permissions: ['store.read', 'reservation.read', 'reservation.write'],
        })
        return { ...store, token: await tokenFor(store.organizationId, 'staff', userId) }
      }),
    )
    const [alphaOperator, bravoOperator] = operators as [
      (typeof operators)[number],
      (typeof operators)[number],
    ]
    await insertFailedRecording({
      organizationId: alphaOperator.organizationId,
      storeId: alphaOperator.storeId,
      updatedAt: '2026-08-30T23:00:00.000Z',
    })
    const evaluated = (await (
      await SELF.fetch(
        `${BASE}/api/staff/stores/${alphaOperator.storeId}/alerts/evaluate`,
        auth(alphaOperator.token, { method: 'POST' }),
      )
    ).json()) as AlertEvaluationResult
    const alertId = required(evaluated.alerts[0], 'raised alert').id

    const bravoList = (await (
      await SELF.fetch(
        `${BASE}/api/staff/stores/${bravoOperator.storeId}/alerts`,
        auth(bravoOperator.token),
      )
    ).json()) as AlertRecord[]
    expect(bravoList).toHaveLength(0)

    // Guessing the id inside one's own store must not reach across tenants.
    expect(
      (
        await SELF.fetch(
          `${BASE}/api/staff/stores/${bravoOperator.storeId}/alerts/${alertId}`,
          auth(bravoOperator.token),
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await SELF.fetch(
          `${BASE}/api/staff/stores/${bravoOperator.storeId}/alerts/${alertId}/resolve`,
          auth(bravoOperator.token, { method: 'POST', body: JSON.stringify({ note: 'x' }) }),
        )
      ).status,
    ).toBe(404)
    // And the owning tenant still sees it untouched.
    const stillOpen = (await (
      await SELF.fetch(
        `${BASE}/api/staff/stores/${alphaOperator.storeId}/alerts/${alertId}`,
        auth(alphaOperator.token),
      )
    ).json()) as AlertRecord
    expect(stillOpen.resolvedAt).toBeNull()
  })
})
