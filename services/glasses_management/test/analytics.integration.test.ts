/** P9 の読出し／保守 API。集計済み analytics_daily だけを fixture にする。 */
import { env, SELF } from 'cloudflare:test'
import { AnalyticsReport, AnalyticsRollupResult } from '@app/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rollupAnalytics } from '../src/worker/index'
import {
  authed,
  BASE,
  INTERNAL_HEADERS,
  insertBusinessHours,
  insertReservation,
  insertStaff,
  insertStore,
  JSON_HEADERS,
  jstAt,
  orgId,
  tokenFor,
} from './helpers'

const NOW = '2026-08-27T02:08:00.000Z'
const FROM = '2026-08-01'
const TO = '2026-08-31'
const METRICS = [
  'overview',
  'reservation_count',
  'reservation_source',
  'cancellation',
  'visit_frequency',
  'staff',
  'purpose',
  'wait_time',
] as const

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
})

async function analyticsTenant(permission = 'analytics.read') {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await insertStore(org, '分析テスト店')
  await insertBusinessHours(org, storeId)
  await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      organizationId: org,
      storeId,
      userId: `dev:${org}`,
      permissions: permission ? [permission] : [],
      createdAt: NOW,
    }),
  })
  return { org, token, storeId }
}

async function daily(
  tenant: { org: string; storeId: string },
  input: { date: string; metric: string; dimension?: string; key?: string; value: number },
) {
  await env.DB.prepare(
    'INSERT INTO analytics_daily (id, organization_id, store_id, date, metric, dimension, dimension_key, dimension_label, value, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      crypto.randomUUID(),
      tenant.org,
      tenant.storeId,
      input.date,
      input.metric,
      input.dimension ?? 'total',
      input.key ?? '',
      input.key ?? '合計',
      input.value,
      NOW,
      NOW,
    )
    .run()
}

function reportPath(storeId: string, metric: (typeof METRICS)[number], extra = '') {
  return `${BASE}/api/staff/analytics?storeId=${storeId}&metric=${metric}&from=${FROM}&to=${TO}${extra}`
}

async function rollupAllPages(body: { from: string; to: string; limit: number }) {
  const seenCursors = new Set<string>()
  let storeCursor: string | undefined
  let processedStores = 0
  for (let page = 0; page < 100; page += 1) {
    const response = await SELF.fetch(`${BASE}/api/internal/maintenance/analytics/rollup`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ ...body, ...(storeCursor === undefined ? {} : { storeCursor }) }),
    })
    expect(response.status).toBe(200)
    const result = AnalyticsRollupResult.parse(await response.json())
    expect(result.processedStores).toBeLessThanOrEqual(3)
    processedStores += result.processedStores
    if (result.nextStoreCursor === null) return { processedStores, pages: page + 1 }
    expect(seenCursors.has(result.nextStoreCursor)).toBe(false)
    seenCursors.add(result.nextStoreCursor)
    storeCursor = result.nextStoreCursor
  }
  throw new Error('storeCursor did not terminate within the bounded test page count')
}

describe('分析レポートは analytics_daily だけを読む', () => {
  it('8 metric を契約どおり返し、guests を作らない', async () => {
    const tenant = await analyticsTenant()
    await daily(tenant, { date: FROM, metric: 'closed', value: 0 })
    await daily(tenant, { date: FROM, metric: 'reservations', value: 20 })

    for (const metric of METRICS) {
      const response = await SELF.fetch(reportPath(tenant.storeId, metric), {
        headers: authed(tenant.token),
      })
      expect(response.status).toBe(200)
      const report = AnalyticsReport.parse(await response.json())
      expect(report.metric).toBe(metric)
      expect(JSON.stringify(report)).not.toContain('guests')
    }
  })

  it('期間合算 histogram の中央値、20/19 の抑制、closed と pending を区別する', async () => {
    const twenty = await analyticsTenant()
    await daily(twenty, { date: '2026-08-01', metric: 'closed', value: 0 })
    await daily(twenty, { date: '2026-08-02', metric: 'closed', value: 1 })
    await daily(twenty, {
      date: '2026-08-01',
      metric: 'revisit_eligible',
      dimension: 'staff',
      key: 'staff-analytics',
      value: 20,
    })
    await daily(twenty, {
      date: '2026-08-01',
      metric: 'revisit_returning_90d',
      dimension: 'staff',
      key: 'staff-analytics',
      value: 10,
    })
    await daily(twenty, {
      date: '2026-08-01',
      metric: 'wait_seconds_histogram',
      dimension: 'wait_seconds',
      key: 'hour:10:300',
      value: 1,
    })
    await daily(twenty, {
      date: '2026-08-02',
      metric: 'wait_seconds_histogram',
      dimension: 'wait_seconds',
      key: 'hour:11:480',
      value: 1,
    })

    const staffResponse = await SELF.fetch(reportPath(twenty.storeId, 'staff'), {
      headers: authed(twenty.token),
    })
    expect(staffResponse.status).toBe(200)
    const staff = AnalyticsReport.parse(await staffResponse.json())
    expect(staff.businessDays).toBe(1)
    expect(staff.pendingDays).toBe(29)
    expect(
      staff.series.flatMap((series) => series.points).some((point) => point.secondaryValue === 0.5),
    ).toBe(true)
    const waitResponse = await SELF.fetch(reportPath(twenty.storeId, 'wait_time'), {
      headers: authed(twenty.token),
    })
    expect(waitResponse.status).toBe(200)
    const wait = AnalyticsReport.parse(await waitResponse.json())
    expect(wait.summary[0]?.value).toBe('390')

    const nineteen = await analyticsTenant()
    await daily(nineteen, { date: FROM, metric: 'closed', value: 0 })
    await daily(nineteen, {
      date: FROM,
      metric: 'revisit_eligible',
      dimension: 'staff',
      key: 'staff-analytics',
      value: 19,
    })
    await daily(nineteen, {
      date: FROM,
      metric: 'revisit_returning_90d',
      dimension: 'staff',
      key: 'staff-analytics',
      value: 10,
    })
    const suppressedResponse = await SELF.fetch(reportPath(nineteen.storeId, 'staff'), {
      headers: authed(nineteen.token),
    })
    expect(suppressedResponse.status).toBe(200)
    const suppressed = AnalyticsReport.parse(await suppressedResponse.json())
    expect(suppressed.suppressed).toBe(true)
    expect(
      suppressed.series
        .flatMap((series) => series.points)
        .some((point) => point.secondaryValue === null),
    ).toBe(true)
  })

  it('targets は analytics_daily の内容に関係なく固定値を返す', async () => {
    const tenant = await analyticsTenant()
    const response = await SELF.fetch(
      `${BASE}/api/staff/analytics/targets?storeId=${tenant.storeId}`,
      {
        headers: authed(tenant.token),
      },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      waitMinutes: 8,
      cancellationRatePercent: 10,
      revisitWindowDays: 90,
    })
  })
})

describe('内部 rollup は範囲・ページング・結果を固定する', () => {
  it('先頭ページのcatch-upは内部cursorで同じページを再試行する', async () => {
    const tenant = await analyticsTenant()
    const firstStoreId = '00000000-0000-4000-8000-000000000001'
    await env.DB.prepare('UPDATE stores SET id = ? WHERE organization_id = ? AND id = ?')
      .bind(firstStoreId, tenant.org, tenant.storeId)
      .run()
    await env.DB.prepare(
      'UPDATE store_business_hours SET store_id = ? WHERE organization_id = ? AND store_id = ?',
    )
      .bind(firstStoreId, tenant.org, tenant.storeId)
      .run()
    await daily(
      { ...tenant, storeId: firstStoreId },
      { date: '2026-08-31', metric: 'closed', value: 0 },
    )

    const input = {
      from: '2026-10-02',
      to: '2026-10-10',
      limit: 3,
      now: new Date('2026-10-02T15:00:00.000Z'),
      completedThrough: '2026-10-02',
    }
    const first = await rollupAnalytics(env, input)
    expect(first.nextStoreCursor).toBe(btoa('analytics:retry-first-page'))

    await expect(
      rollupAnalytics(env, { ...input, storeCursor: first.nextStoreCursor ?? undefined }),
    ).resolves.toMatchObject({ processedStores: expect.any(Number) })
  })

  it('32日以上の停止後も同じcursorを保持し、店舗ごとに実績確定日までcatch-upする', async () => {
    const tenant = await analyticsTenant()
    // UUID順の末尾に置き、直前のcursorからはこの店舗だけを選べるようにする。
    const beforeCatchUpStoreId = 'ffffffff-ffff-4fff-8fff-ffffffffff00'
    const catchUpStoreId = 'ffffffff-ffff-4fff-8fff-ffffffffff01'
    await env.DB.prepare('UPDATE stores SET id = ? WHERE organization_id = ? AND id = ?')
      .bind(catchUpStoreId, tenant.org, tenant.storeId)
      .run()
    await env.DB.prepare(
      'UPDATE store_business_hours SET store_id = ? WHERE organization_id = ? AND store_id = ?',
    )
      .bind(catchUpStoreId, tenant.org, tenant.storeId)
      .run()
    const catchUpTenant = { ...tenant, storeId: catchUpStoreId }
    await daily(catchUpTenant, { date: '2026-08-31', metric: 'closed', value: 0 })
    const staffId = await insertStaff(tenant.org, catchUpStoreId, { displayName: '追いつく担当' })
    const customerId = `customer-${crypto.randomUUID()}`
    const priorReservationId = await insertReservation(tenant.org, {
      storeId: catchUpStoreId,
      startsAt: jstAt('2026-09-10', '10:00'),
      status: 'done',
      staffId,
    })
    const currentReservationId = await insertReservation(tenant.org, {
      storeId: catchUpStoreId,
      startsAt: jstAt('2026-10-02', '10:00'),
      status: 'done',
      staffId,
    })
    await env.DB.prepare('UPDATE reservations SET customer_id = ? WHERE id IN (?, ?)')
      .bind(customerId, priorReservationId, currentReservationId)
      .run()
    for (const [stage, occurredAt] of [
      ['received', jstAt('2026-10-02', '09:55')],
      ['consulting', jstAt('2026-10-02', '10:00')],
    ] as const) {
      await env.DB.prepare(
        'INSERT INTO visit_events (id, organization_id, store_id, subject_type, subject_id, stage, occurred_at, staff_id, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      )
        .bind(
          crypto.randomUUID(),
          tenant.org,
          catchUpStoreId,
          'reservation',
          currentReservationId,
          stage,
          occurredAt,
          staffId,
          null,
          NOW,
        )
        .run()
    }

    const now = new Date('2026-10-02T15:00:00.000Z') // JST 2026-10-03
    const first = await rollupAnalytics(env, {
      from: '2026-10-02',
      to: '2026-10-10',
      limit: 3,
      storeCursor: btoa(beforeCatchUpStoreId),
      now,
      completedThrough: '2026-10-02',
    })

    expect(first.nextStoreCursor).toBe(btoa(beforeCatchUpStoreId))
    expect(
      (
        await env.DB.prepare(
          "SELECT 1 FROM analytics_daily WHERE organization_id = ? AND store_id = ? AND date = '2026-10-02' AND metric = 'closed'",
        )
          .bind(tenant.org, catchUpStoreId)
          .all()
      ).results,
    ).toEqual([])

    const second = await rollupAnalytics(env, {
      from: '2026-10-03',
      to: '2026-10-11',
      limit: 3,
      storeCursor: first.nextStoreCursor ?? undefined,
      now: new Date('2026-10-03T15:00:00.000Z'),
      completedThrough: '2026-10-03',
    })
    expect(second.nextStoreCursor).toBeNull()
    const actuals = await env.DB.prepare(
      "SELECT metric, dimension, dimension_key AS dimensionKey, value FROM analytics_daily WHERE organization_id = ? AND store_id = ? AND date = '2026-10-02' AND ((metric = 'closed' AND dimension = 'total') OR (metric = 'receptions' AND dimension = 'total') OR (metric = 'wait_seconds_histogram' AND dimension = 'wait_seconds') OR (metric IN ('revisit_eligible', 'revisit_returning_90d') AND dimension = 'staff')) ORDER BY metric, dimension_key",
    )
      .bind(tenant.org, catchUpStoreId)
      .all<{ metric: string; dimension: string; dimensionKey: string; value: number }>()
    expect(actuals.results).toEqual(
      expect.arrayContaining([
        { metric: 'closed', dimension: 'total', dimensionKey: '', value: 0 },
        { metric: 'receptions', dimension: 'total', dimensionKey: '', value: 1 },
        {
          metric: 'wait_seconds_histogram',
          dimension: 'wait_seconds',
          dimensionKey: 'hour:9:300',
          value: 1,
        },
        { metric: 'revisit_eligible', dimension: 'staff', dimensionKey: staffId, value: 1 },
        {
          metric: 'revisit_returning_90d',
          dimension: 'staff',
          dimensionKey: staffId,
          value: 1,
        },
      ]),
    )
  })

  it('未来期間のbackfillでも現在の保持行を削除しない', async () => {
    const tenant = await analyticsTenant()
    await daily(tenant, { date: '2026-08-01', metric: 'reservations', value: 1 })

    const response = await SELF.fetch(`${BASE}/api/internal/maintenance/analytics/rollup`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ from: '2099-01-01', to: '2099-01-31', limit: 1 }),
    })
    expect(response.status).toBe(200)

    const retained = await env.DB.prepare(
      'SELECT value FROM analytics_daily WHERE organization_id = ? AND store_id = ? AND date = ?',
    )
      .bind(tenant.org, tenant.storeId, '2026-08-01')
      .all<{ value: number }>()
    expect(retained.results).toEqual([{ value: 1 }])
  })

  it('最終日の受付後、翌JST日に相談開始した待ち時間も単日集計する', async () => {
    const tenant = await analyticsTenant()
    const subjectId = crypto.randomUUID()
    for (const [stage, occurredAt] of [
      ['received', jstAt('2026-08-27', '23:59')],
      ['consulting', jstAt('2026-08-28', '00:01')],
    ] as const) {
      await env.DB.prepare(
        'INSERT INTO visit_events (id, organization_id, store_id, subject_type, subject_id, stage, occurred_at, staff_id, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      )
        .bind(
          crypto.randomUUID(),
          tenant.org,
          tenant.storeId,
          'walkin',
          subjectId,
          stage,
          occurredAt,
          null,
          null,
          NOW,
        )
        .run()
    }

    await rollupAllPages({ from: '2026-08-27', to: '2026-08-27', limit: 3 })
    const rows = await env.DB.prepare(
      "SELECT dimension_key AS dimensionKey, value FROM analytics_daily WHERE organization_id = ? AND store_id = ? AND date = '2026-08-27' AND metric = 'wait_seconds_histogram'",
    )
      .bind(tenant.org, tenant.storeId)
      .all<{ dimensionKey: string; value: number }>()
    expect(rows.results).toEqual([{ dimensionKey: 'hour:23:120', value: 1 }])
  })

  it('101件超でもJSON1のID集合で目的・担当を読み、failedにしない', async () => {
    const tenant = await analyticsTenant()
    for (let index = 0; index < 101; index += 1) {
      await insertReservation(tenant.org, {
        storeId: tenant.storeId,
        startsAt: jstAt('2026-08-27', `10:${String(index % 60).padStart(2, '0')}`),
      })
    }
    // purpose / assignment / customer の3集合すべてを JSON1 1 bind で読む経路へ入れる。
    await env.DB.prepare(
      'UPDATE reservations SET customer_id = ? WHERE organization_id = ? AND store_id = ?',
    )
      .bind('customer-many', tenant.org, tenant.storeId)
      .run()
    await rollupAllPages({ from: '2026-08-27', to: '2026-08-27', limit: 3 })
    const rows = await env.DB.prepare(
      "SELECT value FROM analytics_daily WHERE organization_id = ? AND store_id = ? AND date = ? AND metric = 'reservations' AND dimension = 'total'",
    )
      .bind(tenant.org, tenant.storeId, '2026-08-27')
      .all<{ value: number }>()
    expect(rows.results[0]?.value).toBe(101)
  })

  it('各完了来店より前の完了来店数で2回目と3〜5回を分類する', async () => {
    const tenant = await analyticsTenant()
    const thirdStaff = await insertStaff(tenant.org, tenant.storeId, {
      displayName: '先の担当',
      sortOrder: 10,
    })
    const secondStaff = await insertStaff(tenant.org, tenant.storeId, {
      displayName: '後の担当',
      sortOrder: 20,
    })
    const secondCustomer = `customer-${crypto.randomUUID()}`
    const thirdCustomer = `customer-${crypto.randomUUID()}`
    const ids = [
      await insertReservation(tenant.org, {
        storeId: tenant.storeId,
        startsAt: jstAt('2026-08-20', '10:00'),
        status: 'done',
        staffId: secondStaff,
      }),
      await insertReservation(tenant.org, {
        storeId: tenant.storeId,
        startsAt: jstAt('2025-01-01', '10:00'),
        status: 'done',
        staffId: thirdStaff,
      }),
      await insertReservation(tenant.org, {
        storeId: tenant.storeId,
        startsAt: jstAt('2025-02-01', '10:00'),
        status: 'done',
        staffId: thirdStaff,
      }),
      await insertReservation(tenant.org, {
        storeId: tenant.storeId,
        startsAt: jstAt('2025-03-01', '10:00'),
        status: 'done',
        staffId: thirdStaff,
      }),
      await insertReservation(tenant.org, {
        storeId: tenant.storeId,
        startsAt: jstAt('2026-08-27', '10:00'),
        status: 'done',
        staffId: secondStaff,
      }),
      await insertReservation(tenant.org, {
        storeId: tenant.storeId,
        startsAt: jstAt('2026-08-27', '11:00'),
        status: 'done',
        staffId: thirdStaff,
      }),
    ]
    await env.DB.prepare('UPDATE reservations SET customer_id = ? WHERE id IN (?,?)')
      .bind(secondCustomer, ids[0], ids[4])
      .run()
    await env.DB.prepare('UPDATE reservations SET customer_id = ? WHERE id IN (?,?,?,?)')
      .bind(thirdCustomer, ids[1], ids[2], ids[3], ids[5])
      .run()

    await rollupAllPages({ from: '2026-08-27', to: '2026-08-27', limit: 3 })

    const frequencies = await env.DB.prepare(
      "SELECT dimension_key AS dimensionKey, value FROM analytics_daily WHERE organization_id = ? AND store_id = ? AND date = '2026-08-27' AND metric = 'receptions' AND dimension = 'visit_frequency'",
    )
      .bind(tenant.org, tenant.storeId)
      .all<{ dimensionKey: string; value: number }>()
    expect(
      Object.fromEntries(frequencies.results.map((row) => [row.dimensionKey, row.value])),
    ).toMatchObject({
      second: 1,
      third_to_fifth: 1,
    })
  })

  it('inactive storeを含めて25か月前の月全体を保持し、それより前を全体削除する', async () => {
    const tenant = await analyticsTenant()
    await env.DB.prepare("UPDATE stores SET is_active = '0' WHERE organization_id = ? AND id = ?")
      .bind(tenant.org, tenant.storeId)
      .run()
    await daily(tenant, { date: '2024-07-27', metric: 'reservations', value: 1 })
    await daily(tenant, { date: '2024-08-01', metric: 'reservations', value: 2 })
    await daily(tenant, { date: '2024-08-26', metric: 'reservations', value: 3 })
    await daily(tenant, { date: '2024-08-27', metric: 'reservations', value: 2 })

    const response = await SELF.fetch(`${BASE}/api/internal/maintenance/analytics/rollup`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ from: '2026-08-27', to: '2026-08-27', limit: 3 }),
    })
    expect(response.status).toBe(200)
    const retained = await env.DB.prepare(
      'SELECT date FROM analytics_daily WHERE organization_id = ? AND store_id = ? ORDER BY date',
    )
      .bind(tenant.org, tenant.storeId)
      .all<{ date: string }>()
    expect(retained.results).toEqual([
      { date: '2024-08-01' },
      { date: '2024-08-26' },
      { date: '2024-08-27' },
    ])
  })

  it('JWTを拒否し、31日/limit3とcursorを受け、32日/limit4を拒否する', async () => {
    const tenant = await analyticsTenant()
    for (let index = 0; index < 3; index += 1) {
      const storeId = await insertStore(tenant.org, `ページング ${index}`)
      await insertBusinessHours(tenant.org, storeId)
    }
    const body = { from: '2026-08-01', to: '2026-08-31', limit: 3 }
    const jwt = await SELF.fetch(`${BASE}/api/internal/maintenance/analytics/rollup`, {
      method: 'POST',
      headers: authed(tenant.token),
      body: JSON.stringify(body),
    })
    expect(jwt.status).toBe(401)
    const noKey = await SELF.fetch(`${BASE}/api/internal/maintenance/analytics/rollup`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    })
    expect(noKey.status).toBe(401)
    const wrongKey = await SELF.fetch(`${BASE}/api/internal/maintenance/analytics/rollup`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'x-internal-key': 'wrong-internal-key' },
      body: JSON.stringify(body),
    })
    expect(wrongKey.status).toBe(401)
    const pages = await rollupAllPages(body)
    expect(pages.processedStores).toBeGreaterThanOrEqual(4)
    expect(pages.pages).toBeGreaterThanOrEqual(2)
    const invalidCursor = await SELF.fetch(`${BASE}/api/internal/maintenance/analytics/rollup`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ ...body, storeCursor: 'not-a-store-cursor' }),
    })
    expect(invalidCursor.status).toBe(400)
    const invalidDays = await SELF.fetch(`${BASE}/api/internal/maintenance/analytics/rollup`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ ...body, to: '2026-09-01' }),
    })
    expect(invalidDays.status).toBe(400)
    const invalidLimit = await SELF.fetch(`${BASE}/api/internal/maintenance/analytics/rollup`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ ...body, limit: 4 }),
    })
    expect(invalidLimit.status).toBe(400)
  })

  it('再実行は同じ日次行を重複させず、保持対象月を丸ごと残す', async () => {
    const tenant = await analyticsTenant()
    await daily(tenant, { date: '2024-07-31', metric: 'closed', value: 0 })
    await daily(tenant, { date: '2024-08-27', metric: 'closed', value: 0 })
    await daily(tenant, { date: '2024-08-26', metric: 'closed', value: 0 })
    const body = { from: '2026-08-01', to: '2026-08-31', limit: 3 }
    for (let run = 0; run < 2; run += 1) await rollupAllPages(body)
    const rows = await env.DB.prepare(
      'SELECT date FROM analytics_daily WHERE organization_id = ? AND store_id = ? AND metric = ? ORDER BY date',
    )
      .bind(tenant.org, tenant.storeId, 'closed')
      .all<{ date: string }>()
    expect(rows.results.map((row) => row.date)).toContain('2024-08-27')
    expect(rows.results.map((row) => row.date)).toContain('2024-08-26')
    expect(rows.results.map((row) => row.date)).not.toContain('2024-07-31')
    expect(new Set(rows.results.map((row) => row.date)).size).toBe(rows.results.length)
  })
})
