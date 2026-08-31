/**
 * 日次集計の保守の経路（`POST /api/internal/maintenance/analytics/rollup`）を
 * **実 D1** の上で通す。ここが埋まっていないと画面は生データを走査することになる。
 *
 * 時刻は必ず `now` で注入する（**実時刻に依存した境界を書かない**）。
 * D1 はテストファイル内で共有されるので、組織 id は毎回 `crypto.randomUUID()` から作る。
 */

import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  BASE,
  INTERNAL_HEADERS,
  insertBusinessHours,
  insertReservation,
  insertStore,
  JSON_HEADERS,
  jstAt,
  orgId,
} from './helpers'

type Json = Record<string, unknown>

/** JST の 2026-08-27（木）を基準にする。前日 8/26（水）も営業日。 */
const NOW = '2026-08-27T14:00:00.000Z' // JST 8/27 23:00

const rollup = async (body: Json) => {
  const res = await SELF.fetch(`${BASE}/api/internal/maintenance/analytics/rollup`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as never as Json }
}

async function rowsOf(org: string, metric: string) {
  const found = await env.DB.prepare(
    'SELECT date, dimension, dimension_key AS dimensionKey, value FROM analytics_daily ' +
      'WHERE organization_id = ? AND metric = ? ORDER BY date, dimension, dimension_key',
  )
    .bind(org, metric)
    .all<{ date: string; dimension: string; dimensionKey: string; value: number }>()
  return found.results
}

describe('保守（日次集計）', () => {
  it('共有鍵なしでは 401、正しい鍵で 200', async () => {
    const denied = await SELF.fetch(`${BASE}/api/internal/maintenance/analytics/rollup`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    })
    expect(denied.status).toBe(401)
    expect((await rollup({ now: NOW })).status).toBe(200)
  })

  it('now を注入でき、当日分と前日分に先 7 日を足した 9 日を upsert する', async () => {
    const org = orgId()
    const storeId = await insertStore(org)
    await insertBusinessHours(org, storeId)
    await insertReservation(org, { storeId, startsAt: jstAt('2026-08-27', '11:00') })
    await insertReservation(org, { storeId, startsAt: jstAt('2026-08-26', '11:00') })

    const result = await rollup({ now: NOW })
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ days: 9, failed: 0 })

    const closed = await rowsOf(org, 'closed')
    expect(closed.map((row) => row.date)).toEqual([
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ])
    // 木曜も水曜も営業日なので closed=0（定休の火曜 9/1 の 1 と区別できる）。
    expect(closed.filter((row) => row.value === 1).map((row) => row.date)).toEqual(['2026-09-01'])

    const reservations = await rowsOf(org, 'reservations')
    const totals = reservations.filter((row) => row.dimension === 'total')
    expect(totals.filter((row) => row.value > 0)).toEqual([
      { date: '2026-08-26', dimension: 'total', dimensionKey: '', value: 1 },
      { date: '2026-08-27', dimension: 'total', dimensionKey: '', value: 1 },
    ])
  })

  it('先の予定も集計する（トップの前後7日が未来だけ空にならない）', async () => {
    const org = orgId()
    const storeId = await insertStore(org)
    await insertBusinessHours(org, storeId)
    // 今日より 6 日先の予約。夜間の集計が過去しか数えないと、この日の棒が永久に出ない。
    await insertReservation(org, { storeId, startsAt: jstAt('2026-09-02', '11:00') })

    expect((await rollup({ now: NOW })).status).toBe(200)
    const totals = (await rowsOf(org, 'reservations')).filter((row) => row.dimension === 'total')
    expect(totals).toEqual(
      expect.arrayContaining([
        { date: '2026-09-02', dimension: 'total', dimensionKey: '', value: 1 },
      ]),
    )
    // 先の日にも「集計した」印が付くので、未来が「まだ集計中」に見えない。
    const closed = await rowsOf(org, 'closed')
    expect(closed.map((row) => row.date)).toContain('2026-09-03')
  })

  it('定休日は closed=1 の行を書き、欠測（行が無い日）と区別できる', async () => {
    const org = orgId()
    const storeId = await insertStore(org)
    // 木曜（4）を定休にすると 8/27 が休みになる。8/26（水）は営業日のまま。
    await insertBusinessHours(org, storeId, { closedWeekdays: [4] })

    expect((await rollup({ now: NOW })).status).toBe(200)
    const closed = await rowsOf(org, 'closed')
    expect(closed.filter((row) => row.date <= '2026-08-27')).toEqual([
      { date: '2026-08-26', dimension: 'total', dimensionKey: '', value: 0 },
      { date: '2026-08-27', dimension: 'total', dimensionKey: '', value: 1 },
    ])
    // 集計していない 8/25 は行が無い（0 件の棒として描かせない）。
    expect(closed.some((row) => row.date === '2026-08-25')).toBe(false)
  })

  it('2 回続けて呼んでも行が重複しない（一意 index が効く）', async () => {
    const org = orgId()
    const storeId = await insertStore(org)
    await insertBusinessHours(org, storeId)
    await insertReservation(org, { storeId, startsAt: jstAt('2026-08-27', '11:00') })

    await rollup({ now: NOW })
    const first = await rowsOf(org, 'reservations')
    await rollup({ now: NOW })
    const second = await rowsOf(org, 'reservations')
    expect(second).toEqual(first)
  })

  it('「名」（人数）の行を 1 つも書かない', async () => {
    const org = orgId()
    const storeId = await insertStore(org)
    await insertBusinessHours(org, storeId)
    await insertReservation(org, { storeId, startsAt: jstAt('2026-08-27', '11:00') })

    await rollup({ now: NOW })
    const found = await env.DB.prepare(
      'SELECT metric FROM analytics_daily WHERE organization_id = ? AND metric = ?',
    )
      .bind(org, 'guests')
      .all()
    expect(found.results).toHaveLength(0)
  })

  it('25 か月より古い行を消し、24 か月前の行は残す', async () => {
    const org = orgId()
    const storeId = await insertStore(org)
    await insertBusinessHours(org, storeId)
    const seed = async (date: string) => {
      await env.DB.prepare(
        'INSERT INTO analytics_daily (id, organization_id, store_id, date, metric, dimension, dimension_key, value, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      )
        .bind(crypto.randomUUID(), org, storeId, date, 'reservations', 'total', '', 3, NOW, NOW)
        .run()
    }
    // 基準は JST 2026-08 → 保持の下限は 2024-08-01。
    await seed('2024-07-31')
    await seed('2024-08-01')

    const result = await rollup({ now: NOW })
    expect(Number(result.body.deleted)).toBeGreaterThanOrEqual(1)
    const kept = (await rowsOf(org, 'reservations')).map((row) => row.date)
    expect(kept).toContain('2024-08-01')
    expect(kept).not.toContain('2024-07-31')
  })

  it('1 店舗で失敗しても残りの店舗の集計を止めない（失敗件数を返す）', async () => {
    const org = orgId()
    const healthy = await insertStore(org, 'EYEX 銀座店')
    await insertBusinessHours(org, healthy)
    await insertReservation(org, { storeId: healthy, startsAt: jstAt('2026-08-27', '11:00') })
    // 営業時間の行が無い店舗（設定未完）。集計は止まらず、休みとして 1 行だけ書く。
    const unconfigured = await insertStore(org, 'EYEX 設定未完店')

    const result = await rollup({ now: NOW })
    expect(result.body).toMatchObject({ failed: 0 })
    const closed = await env.DB.prepare(
      'SELECT store_id AS storeId, value FROM analytics_daily WHERE organization_id = ? ' +
        "AND metric = 'closed' AND date = '2026-08-27'",
    )
      .bind(org)
      .all<{ storeId: string; value: number }>()
    expect(closed.results).toEqual(
      expect.arrayContaining([
        { storeId: healthy, value: 0 },
        { storeId: unconfigured, value: 1 },
      ]),
    )
  })
})
