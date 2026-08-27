import { env, SELF } from 'cloudflare:test'
import type { AnalyticsReport, AnalyticsSettings } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  analyticsUrl,
  auth,
  BASE,
  insertFailedRecording,
  insertFunnelEvent,
  insertProgressEvent,
  insertPurpose,
  insertReservation,
  insertWalkin,
  insertWalkinEvent,
  required,
  seedStore,
  tokenFor,
  uuid,
} from './analytics.fixtures'

/** JST 2026-08-31 runs from 2026-08-30T15:00Z (inclusive) to 2026-08-31T15:00Z. */
const DATE = '2026-08-31'
const MORNING = '2026-08-31T01:00:00.000Z' // JST 10:00
const NOON = '2026-08-31T03:00:00.000Z' // JST 12:00
const PREVIOUS_DAY = '2026-08-30T01:00:00.000Z' // JST 2026-08-30 10:00

async function setThreshold(organizationId: string, storeId: string, threshold: number) {
  const adminToken = await tokenFor(organizationId, 'admin')
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/analytics/settings`,
    auth(adminToken, {
      method: 'PUT',
      body: JSON.stringify({ smallSampleThreshold: threshold, targets: [] }),
    }),
  )
  expect(response.status).toBe(200)
}

async function setSettings(
  organizationId: string,
  storeId: string,
  body: { smallSampleThreshold: number; targets: { metric: string; target: number }[] },
) {
  const adminToken = await tokenFor(organizationId, 'admin')
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/analytics/settings`,
    auth(adminToken, { method: 'PUT', body: JSON.stringify(body) }),
  )
  expect(response.status).toBe(200)
  return (await response.json()) as AnalyticsSettings
}

async function report(
  storeId: string,
  token: string,
  granularity = 'day',
  date = DATE,
): Promise<AnalyticsReport> {
  const response = await SELF.fetch(analyticsUrl(storeId, granularity, date), auth(token))
  expect(response.status).toBe(200)
  return (await response.json()) as AnalyticsReport
}

function metric(result: AnalyticsReport, name: string) {
  return required(
    result.metrics.find((entry) => entry.metric === name),
    `metric ${name}`,
  )
}

describe('store analytics counts (UC-EYEX-099)', () => {
  it('counts 予約・来店・取消・無断キャンセル for the selected JST day', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 1)
    await insertReservation({ ...store, startAt: MORNING, status: 'checked_in' })
    await insertReservation({ ...store, startAt: NOON, status: 'confirmed' })
    await insertReservation({ ...store, startAt: NOON, status: 'cancelled' })
    await insertReservation({ ...store, startAt: NOON, status: 'no_show' })
    await insertWalkin({ ...store, arrivedAt: MORNING })

    const result = await report(store.storeId, store.token)
    expect(metric(result, 'reservations').value).toBe(4)
    expect(metric(result, 'visits').value).toBe(2)
    expect(metric(result, 'cancellations').value).toBe(1)
    expect(metric(result, 'no_shows').value).toBe(1)
    expect(result.totalCount).toBe(5)
    expect(result.status).toBe('ok')
  })

  it('excludes rows that fall outside the JST day boundary', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 1)
    // 2026-08-30T14:59:59Z is still JST 2026-08-30; one second later is 08-31.
    await insertReservation({ ...store, startAt: '2026-08-30T14:59:59.000Z' })
    await insertReservation({ ...store, startAt: '2026-08-30T15:00:00.000Z' })
    await insertReservation({ ...store, startAt: '2026-08-31T14:59:59.000Z' })
    await insertReservation({ ...store, startAt: '2026-08-31T15:00:00.000Z' })

    const result = await report(store.storeId, store.token)
    expect(metric(result, 'reservations').value).toBe(2)
  })

  it('aggregates a whole JST week and a whole JST month', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 1)
    await insertReservation({ ...store, startAt: MORNING })
    await insertReservation({ ...store, startAt: PREVIOUS_DAY })
    await insertReservation({ ...store, startAt: '2026-08-05T01:00:00.000Z' })

    const week = await report(store.storeId, store.token, 'week', DATE)
    expect(week.period).toMatchObject({ startDate: '2026-08-31', endDate: '2026-09-06' })
    expect(metric(week, 'reservations').value).toBe(1)

    const month = await report(store.storeId, store.token, 'month', DATE)
    expect(month.period).toMatchObject({ startDate: '2026-08-01', endDate: '2026-08-31' })
    expect(metric(month, 'reservations').value).toBe(3)
  })
})

describe('breakdowns (UC-EYEX-100)', () => {
  it('compares 来店目的・予約元・時間帯・担当者', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 1)
    const purposeId = await insertPurpose(store)
    await insertReservation({
      ...store,
      startAt: MORNING,
      source: 'web',
      purposeIds: [purposeId],
      assignedStaffId: 'staff-a',
    })
    await insertReservation({
      ...store,
      startAt: NOON,
      source: 'staff',
      purposeIds: [purposeId],
      assignedStaffId: 'staff-a',
    })
    await insertWalkin({ ...store, arrivedAt: NOON })

    const result = await report(store.storeId, store.token)
    const dimensions = result.breakdowns.map((entry) => entry.dimension)
    expect(dimensions).toEqual(expect.arrayContaining(['purpose', 'source', 'hour', 'staff']))
    const source = required(
      result.breakdowns.find((entry) => entry.dimension === 'source'),
      'source breakdown',
    )
    expect(source.items.find((item) => item.key === 'web')?.value).toBe(1)
    expect(source.items.find((item) => item.key === 'staff')?.value).toBe(1)
    expect(source.items.find((item) => item.key === 'walkin')?.value).toBe(1)
    const purpose = required(
      result.breakdowns.find((entry) => entry.dimension === 'purpose'),
      'purpose breakdown',
    )
    expect(purpose.items.find((item) => item.key === purposeId)?.value).toBe(2)
    expect(purpose.items.find((item) => item.key === purposeId)?.label).toBe('視力測定')
    const hour = required(
      result.breakdowns.find((entry) => entry.dimension === 'hour'),
      'hour breakdown',
    )
    // JST hours, not UTC ones.
    expect(hour.items.find((item) => item.key === '10')?.value).toBe(1)
    expect(hour.items.find((item) => item.key === '12')?.value).toBe(2)
    const staff = required(
      result.breakdowns.find((entry) => entry.dimension === 'staff'),
      'staff breakdown',
    )
    expect(staff.items.find((item) => item.key === 'staff-a')?.value).toBe(2)
  })
})

describe('wait time and stage durations (UC-EYEX-101, AC-EYEX-50)', () => {
  it('reports a distribution, not only an average', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 1)
    const first = await insertReservation({
      ...store,
      startAt: MORNING,
      waitStartedAt: '2026-08-31T01:00:00.000Z',
    })
    await insertProgressEvent({
      ...store,
      reservationId: first,
      toProgress: 'service_in_progress',
      createdAt: '2026-08-31T01:07:00.000Z',
    })
    await insertProgressEvent({
      ...store,
      reservationId: first,
      toProgress: 'service_completed',
      createdAt: '2026-08-31T01:40:00.000Z',
    })
    await insertProgressEvent({
      ...store,
      reservationId: first,
      toProgress: 'departed',
      createdAt: '2026-08-31T01:45:00.000Z',
    })
    const walkinId = await insertWalkin({ ...store, arrivedAt: '2026-08-31T02:00:00.000Z' })
    await insertWalkinEvent({
      ...store,
      walkinId,
      toProgress: 'service_in_progress',
      occurredAt: '2026-08-31T02:35:00.000Z',
    })

    const result = await report(store.storeId, store.token)
    const wait = required(
      result.stageDistributions.find((entry) => entry.stage === 'reception_to_service_start'),
      'wait distribution',
    )
    expect(wait.sampleCount).toBe(2)
    expect(wait.buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(2)
    expect(wait.medianMinutes).not.toBeNull()
    expect(wait.maxMinutes).toBe(35)
    expect(wait.unit).toBe('minutes')
    const service = required(
      result.stageDistributions.find((entry) => entry.stage === 'service_duration'),
      'service distribution',
    )
    expect(service.sampleCount).toBe(1)
    expect(service.maxMinutes).toBe(33)
    const departure = required(
      result.stageDistributions.find((entry) => entry.stage === 'service_end_to_departure'),
      'departure distribution',
    )
    expect(departure.maxMinutes).toBe(5)
  })

  it('reports the stage rows it could not measure as an exclusion with a caveat', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 1)
    const reservationId = await insertReservation({ ...store, startAt: MORNING })
    await insertProgressEvent({
      ...store,
      reservationId,
      toProgress: 'service_in_progress',
      createdAt: '2026-08-31T01:07:00.000Z',
    })

    const result = await report(store.storeId, store.token)
    const exclusion = required(
      result.exclusions.find((entry) => entry.reason === 'missing_stage_timestamp'),
      'stage exclusion',
    )
    expect(exclusion.count).toBeGreaterThan(0)
    expect(exclusion.caveat.length).toBeGreaterThan(0)
    expect(exclusion.description.length).toBeGreaterThan(0)
  })
})

describe('store switching (UC-EYEX-102, AC-EYEX-55)', () => {
  it('never mixes another store of the same organization into the report', async () => {
    const store = await seedStore('新宿店')
    await setThreshold(store.organizationId, store.storeId, 1)
    const other = await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': 'dev-internal-key' },
      body: JSON.stringify({
        id: uuid(),
        organizationId: store.organizationId,
        name: '渋谷店',
        slug: `store-${uuid().slice(0, 8)}`,
        isActive: true,
        createdAt: '2026-08-26T00:00:00.000Z',
      }),
    })
    expect(other.status).toBe(200)

    const otherStoreId = uuid()
    await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': 'dev-internal-key' },
      body: JSON.stringify({
        id: otherStoreId,
        organizationId: store.organizationId,
        name: '池袋店',
        slug: `store-${uuid().slice(0, 8)}`,
        isActive: true,
        createdAt: '2026-08-26T00:00:00.000Z',
      }),
    })
    await insertReservation({
      organizationId: store.organizationId,
      storeId: store.storeId,
      startAt: MORNING,
      assignedStaffId: 'staff-selected',
    })
    await insertReservation({
      organizationId: store.organizationId,
      storeId: otherStoreId,
      startAt: MORNING,
      assignedStaffId: 'staff-other',
    })

    const result = await report(store.storeId, store.token)
    expect(metric(result, 'reservations').value).toBe(1)
    expect(result.storeName).toBe('新宿店')
    const staff = required(
      result.breakdowns.find((entry) => entry.dimension === 'staff'),
      'staff breakdown',
    )
    expect(staff.items.map((item) => item.key)).toEqual(['staff-selected'])
  })
})

describe('web booking funnel (UC-EYEX-103)', () => {
  it('counts each step and names where customers drop out', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 1)
    const sessions = [uuid(), uuid(), uuid(), uuid()]
    for (const sessionId of sessions) {
      await insertFunnelEvent({ ...store, sessionId, stage: 'started', occurredAt: MORNING })
    }
    for (const sessionId of sessions.slice(0, 3)) {
      await insertFunnelEvent({ ...store, sessionId, stage: 'slot_selected', occurredAt: MORNING })
    }
    await insertFunnelEvent({
      ...store,
      sessionId: required(sessions[0], 'session'),
      stage: 'confirmed',
      occurredAt: MORNING,
    })
    await insertFunnelEvent({
      ...store,
      sessionId: required(sessions[0], 'session'),
      stage: 'completed',
      occurredAt: MORNING,
    })

    const result = await report(store.storeId, store.token)
    expect(result.funnel.sessionCount).toBe(4)
    expect(result.funnel.steps.map((step) => step.count)).toEqual([4, 3, 1, 1])
    expect(result.funnel.steps.map((step) => step.droppedFromPrevious)).toEqual([null, 1, 2, 0])
    expect(result.funnel.largestDropStage).toBe('confirmed')
  })

  it('records a step from the public portal and never double counts a replay', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 1)
    const slug = `public-${uuid().slice(0, 8)}`
    await env.DB.prepare(
      `INSERT INTO web_booking_publications (id, organization_id, store_id, public_slug, status, starts_at, ends_at, contact_phone, access_text, notice, region, nearest_station, latitude, longitude, public_purpose_ids_json, version, published_at, updated_at)
       VALUES (?, ?, ?, ?, 'published', NULL, NULL, '03-0000-0000', 'access', 'notice', '東京都', '新宿駅', NULL, NULL, '[]', 1, ?, ?)`,
    )
      .bind(
        uuid(),
        store.organizationId,
        store.storeId,
        slug,
        '2026-08-26T00:00:00.000Z',
        '2026-08-26T00:00:00.000Z',
      )
      .run()

    const sessionId = uuid()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await SELF.fetch(`${BASE}/api/public/stores/${slug}/funnel-events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, stage: 'started' }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ recorded: true })
    }

    const result = await report(store.storeId, store.token)
    expect(result.funnel.sessionCount).toBe(1)
  })

  it('rejects a funnel step for an unpublished store', async () => {
    const response = await SELF.fetch(`${BASE}/api/public/stores/not-published/funnel-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: uuid(), stage: 'started' }),
    })
    expect(response.status).toBe(404)
  })
})

describe('operational quality warnings (UC-EYEX-104)', () => {
  it('reports recording save failures and settings contradictions', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 1)
    await insertFailedRecording({ ...store, updatedAt: MORNING })
    await insertPurpose({ ...store, durationMinutes: 20, slotIntervalMinutes: 15 })

    const result = await report(store.storeId, store.token)
    const codes = result.qualityWarnings.map((warning) => warning.code)
    expect(codes).toContain('recording_save_failure')
    expect(codes).toContain('settings_contradiction')
    for (const warning of result.qualityWarnings) {
      expect(warning.count).toBeGreaterThan(0)
      expect(warning.nextAction.length).toBeGreaterThan(0)
    }
  })
})

describe('self-describing responses (UC-EYEX-105, AC-EYEX-49)', () => {
  it('carries the definition, period, timezone, last update and row count', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 1)
    await insertReservation({ ...store, startAt: MORNING })

    const result = await report(store.storeId, store.token)
    expect(result.timezone).toBe('Asia/Tokyo')
    expect(result.period).toMatchObject({
      granularity: 'day',
      startDate: DATE,
      endDate: DATE,
      startAt: '2026-08-30T15:00:00.000Z',
      endAt: '2026-08-31T15:00:00.000Z',
    })
    // The injected request clock, never the wall clock.
    expect(result.lastUpdatedAt).toBe('2026-08-31T00:00:00.000Z')
    expect(result.totalCount).toBe(1)
    expect(result.smallSampleThreshold).toBe(1)
    for (const entry of result.metrics) {
      expect(entry.definition.length).toBeGreaterThan(0)
      expect(entry.unit).toBe('count')
    }
  })
})

describe('comparison and targets (AC-EYEX-52, AC-EYEX-51)', () => {
  it('reports the previous period and the difference in the same unit', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 1)
    await insertReservation({ ...store, startAt: MORNING })
    await insertReservation({ ...store, startAt: NOON })
    await insertReservation({ ...store, startAt: PREVIOUS_DAY })

    const result = await report(store.storeId, store.token)
    expect(result.previousPeriod).toMatchObject({ startDate: '2026-08-30', endDate: '2026-08-30' })
    const reservations = metric(result, 'reservations')
    expect(reservations.value).toBe(2)
    expect(reservations.previousValue).toBe(1)
    expect(reservations.difference).toBe(1)
  })

  it('states an unconfigured target as absent rather than inventing one', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 1)
    await insertReservation({ ...store, startAt: MORNING })

    const result = await report(store.storeId, store.token)
    for (const entry of result.metrics) {
      expect(entry.target).toBeNull()
      expect(entry.targetDifference).toBeNull()
      expect(entry.exceedsTarget).toBe(false)
    }
    expect(result.causeCandidates).toHaveLength(0)
  })

  it('offers cause candidates with evidence counts, never an asserted cause', async () => {
    const store = await seedStore()
    await setSettings(store.organizationId, store.storeId, {
      smallSampleThreshold: 1,
      targets: [{ metric: 'no_shows', target: 1 }],
    })
    for (let index = 0; index < 3; index += 1) {
      await insertReservation({ ...store, startAt: MORNING, status: 'no_show', source: 'web' })
    }

    const result = await report(store.storeId, store.token)
    const noShows = metric(result, 'no_shows')
    expect(noShows.value).toBe(3)
    expect(noShows.target).toBe(1)
    expect(noShows.targetDifference).toBe(2)
    expect(noShows.exceedsTarget).toBe(true)
    expect(result.causeCandidates.length).toBeGreaterThan(0)
    for (const candidate of result.causeCandidates) {
      expect(candidate.metric).toBe('no_shows')
      expect(candidate.evidenceCount).toBeGreaterThan(0)
      expect(candidate.inspectionTarget.length).toBeGreaterThan(0)
      // Wording stays a hypothesis: nothing is asserted as the cause.
      expect(candidate.hypothesis).toMatch(/可能性/)
    }
  })
})

describe('small-sample suppression (UC-EYEX-180, AC-EYEX-53, AC-EYEX-119)', () => {
  it('suppresses the value and every re-derivable breakdown below the threshold', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 5)
    await insertReservation({ ...store, startAt: MORNING, assignedStaffId: 'staff-a' })
    await insertReservation({ ...store, startAt: NOON, assignedStaffId: 'staff-b' })

    const result = await report(store.storeId, store.token)
    expect(result.status).toBe('suppressed')
    expect(result.reason).not.toBeNull()
    expect(result.nextAction).not.toBeNull()
    expect(result.totalCount).toBe(2)
    for (const entry of result.metrics) expect(entry.value).toBeNull()
    for (const breakdown of result.breakdowns) {
      expect(breakdown.suppressed).toBe(true)
      for (const item of breakdown.items) expect(item.value).toBeNull()
    }
  })

  it('shows a total on the threshold but still hides a re-derivable breakdown bucket', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 5)
    for (let index = 0; index < 5; index += 1) {
      await insertReservation({
        ...store,
        startAt: MORNING,
        assignedStaffId: index === 4 ? 'staff-rare' : 'staff-common',
      })
    }

    const result = await report(store.storeId, store.token)
    expect(result.status).toBe('ok')
    expect(metric(result, 'reservations').value).toBe(5)
    const staff = required(
      result.breakdowns.find((entry) => entry.dimension === 'staff'),
      'staff breakdown',
    )
    expect(staff.suppressed).toBe(true)
    expect(staff.suppressionReason).toBe('derivable_from_small_sample')
    // Every bucket goes: 5 - 4 would reconstruct the hidden one.
    expect(staff.items.every((item) => item.value === null)).toBe(true)
  })
})

describe('empty periods and aggregation failures (UC-EYEX-108)', () => {
  it('explains an empty period instead of returning a bare zero', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 1)

    const result = await report(store.storeId, store.token)
    expect(result.status).toBe('empty')
    expect(result.totalCount).toBe(0)
    expect(result.reason).not.toBeNull()
    expect(result.nextAction).not.toBeNull()
  })

  it('explains an unreadable configuration instead of guessing a threshold', async () => {
    const store = await seedStore()
    await setThreshold(store.organizationId, store.storeId, 1)
    await env.DB.prepare('UPDATE analytics_settings SET targets_json = ? WHERE organization_id = ?')
      .bind('{not json', store.organizationId)
      .run()
    await insertReservation({ ...store, startAt: MORNING })

    const result = await report(store.storeId, store.token)
    expect(result.status).toBe('failed')
    expect(result.reason).not.toBeNull()
    expect(result.nextAction).not.toBeNull()
    expect(result.metrics).toHaveLength(0)
  })
})

describe('analytics settings', () => {
  it('returns a safe default threshold before anything is configured', async () => {
    const store = await seedStore()
    const adminToken = await tokenFor(store.organizationId, 'admin')
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${store.storeId}/analytics/settings`,
      auth(adminToken),
    )
    expect(response.status).toBe(200)
    const settings = (await response.json()) as AnalyticsSettings
    expect(settings.smallSampleThreshold).toBeGreaterThan(1)
    expect(settings.targets).toEqual([])
  })

  it('stores the threshold and targets for the whole organization', async () => {
    const store = await seedStore()
    const saved = await setSettings(store.organizationId, store.storeId, {
      smallSampleThreshold: 7,
      targets: [{ metric: 'visits', target: 40 }],
    })
    expect(saved).toMatchObject({
      organizationId: store.organizationId,
      smallSampleThreshold: 7,
      updatedAt: '2026-08-31T00:00:00.000Z',
    })
    expect(saved.targets).toEqual([{ metric: 'visits', target: 40 }])

    const result = await report(store.storeId, store.token)
    expect(result.smallSampleThreshold).toBe(7)
  })

  it('rejects a threshold below one', async () => {
    const store = await seedStore()
    const adminToken = await tokenFor(store.organizationId, 'admin')
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${store.storeId}/analytics/settings`,
      auth(adminToken, {
        method: 'PUT',
        body: JSON.stringify({ smallSampleThreshold: 0, targets: [] }),
      }),
    )
    expect(response.status).toBe(400)
  })
})
