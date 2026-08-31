/**
 * 分析 8 タブの読み出し（`GET /api/staff/analytics` / `.../targets`）。
 *
 * 画面は `analytics_daily` しか読まないので、ここも同じ表を材料に置いて
 * 「何を、いつを基準に、どれだけの母数で数えたか」が応答から読めることを固定する。
 *
 * この面が守る 3 つを、境界値で潰す:
 * 1. **人数（「名」）を 1 か所も返さない。**
 * 2. **「1日あたり」の分母は営業日数**で、暦日数では割らない。
 * 3. **根拠にできない率は数字にしない**（20 件ちょうどは出し、19 件は `null`）。
 *
 * 時刻は `now` を query で注入する。**テストは実時刻を読まない。**
 */
import { env, SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  authed,
  BASE,
  FIXED_NOW,
  grantStorePermissions,
  INTERNAL_HEADERS,
  insertAnalyticsDaily,
  insertBusinessHours,
  insertReservation,
  insertStaff,
  insertStore,
  insertVisitPurpose,
  jstAt,
  markAnalyticsDays,
  orgId,
  tokenFor,
} from './helpers'

/** JST 2026年8月27日（木）11:08。トップの「本日」はこの日になる。 */
const NOW = FIXED_NOW
const AUGUST = { from: '2026-08-01', to: '2026-08-31' }
/** 2026年8月の火曜（定休）。暦 31 日 − 4 日 = 営業日 27 日。 */
const CLOSED_TUESDAYS = ['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25']

const augustDates = (): string[] =>
  Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`)

type Report = {
  metric: string
  granularity: string
  countBy: string
  series: {
    name: string
    pattern: string
    points: {
      key: string
      label: string
      value: number
      secondaryValue: number | null
      isClosed: boolean
      isOverTarget: boolean
    }[]
  }[]
  summary: { label: string; value: string; unit: string; isOverTarget: boolean }[]
  target: number | null
  suppressed: boolean
  businessDays: number
  pendingDays: number
}

type Fixture = { org: string; token: string; storeId: string }

/** 組織・店舗・`analytics.read` を持つ人を 1 組作る。組織 id は毎回ユニーク。 */
async function setup(): Promise<Fixture> {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await insertStore(org)
  await grantStorePermissions(org, storeId, `dev:${org}`, ['analytics.read'])
  return { org, token, storeId }
}

async function fetchReport(
  fixture: Fixture,
  params: Record<string, string>,
): Promise<{ status: number; body: Report }> {
  const query = new URLSearchParams({ storeId: fixture.storeId, now: NOW, ...params })
  const res = await SELF.fetch(`${BASE}/api/staff/analytics?${query}`, {
    headers: authed(fixture.token),
  })
  return { status: res.status, body: (await res.json()) as Report }
}

const sumOfPoints = (report: Report): number =>
  report.series.reduce(
    (total, series) => total + series.points.reduce((sub, point) => sub + point.value, 0),
    0,
  )

const summaryOf = (report: Report, label: string): string =>
  report.summary.find((row) => row.label === label)?.value ?? '（無い）'

/* ═════════════════════════════════════════════════════════════════════════
 * トップ
 * ═══════════════════════════════════════════════════════════════════════ */

describe('トップ', () => {
  let fixture: Fixture

  beforeAll(async () => {
    fixture = await setup()
    // 前後 7 日（8/20〜9/3）の 15 日ぶん。すべて営業日として印を置く。
    const dates = Array.from({ length: 15 }, (_, i) =>
      i < 12 ? `2026-08-${20 + i}` : `2026-09-0${i - 11}`,
    )
    await markAnalyticsDays(fixture.org, fixture.storeId, dates)
    await insertAnalyticsDaily(
      fixture.org,
      fixture.storeId,
      dates.map((date) => ({ date, metric: 'reservations', value: 3 })),
    )
  })

  it('前後7日の 15 点を返し、本日の点に label「8/27 本日」が付く', async () => {
    const { status, body } = await fetchReport(fixture, {
      metric: 'overview',
      from: '2026-08-20',
      to: '2026-09-03',
    })
    expect(status).toBe(200)
    expect(body.series).toHaveLength(1)
    expect(body.series[0]?.points).toHaveLength(15)
    expect(body.series[0]?.points.map((point) => point.label)).toContain('8/27 本日')
    // 「本日」は 1 日だけ。前後の日はただの日付に留める。
    expect(body.series[0]?.points.filter((point) => point.label.includes('本日'))).toHaveLength(1)
  })

  it('まとめは 先週・今週・来週 の 3 行で、単位は「件」だけになる', async () => {
    const { body } = await fetchReport(fixture, {
      metric: 'overview',
      from: '2026-08-20',
      to: '2026-09-03',
    })
    expect(body.summary.map((row) => row.label)).toEqual(['先週', '今週', '来週'])
    expect(new Set(body.summary.map((row) => row.unit))).toEqual(new Set(['件']))
    // 今週（8/24〜8/30）は 7 日ぶんすべてが期間に入っている。
    expect(summaryOf(body, '今週')).toBe('21')
  })

  it('応答のどこにも「名」が現れない（JSON を文字列にして検査する）', async () => {
    for (const metric of [
      'overview',
      'reservation_count',
      'reservation_source',
      'cancellation',
      'visit_frequency',
      'staff',
      'purpose',
      'wait_time',
    ]) {
      const { body } = await fetchReport(fixture, {
        metric,
        from: '2026-08-20',
        to: '2026-09-03',
      })
      expect(JSON.stringify(body)).not.toContain('名')
    }
  })

  it("analytics_daily に metric='guests' の行を 1 つも書かない", async () => {
    // 日次集計を実際に走らせても、人数の行は 1 行も生まれない。
    const storeId = await insertStore(fixture.org, 'EYEX 集計確認店')
    await insertBusinessHours(fixture.org, storeId, { closedWeekdays: [] })
    await insertReservation(fixture.org, {
      storeId,
      startsAt: jstAt('2026-08-27', '11:00'),
      status: 'done',
    })
    const res = await SELF.fetch(`${BASE}/api/internal/maintenance/analytics/rollup`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ now: NOW, days: 1 }),
    })
    expect(res.status).toBe(200)

    const guests = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM analytics_daily WHERE metric = 'guests'",
    ).first<{ n: number }>()
    expect(guests?.n).toBe(0)
    const counted = await env.DB.prepare(
      "SELECT value FROM analytics_daily WHERE store_id = ? AND date = '2026-08-27' " +
        "AND metric = 'reservations' AND dimension = 'total'",
    )
      .bind(storeId)
      .first<{ value: number }>()
    expect(counted?.value).toBe(1)
  })
})

/* ═════════════════════════════════════════════════════════════════════════
 * 予約数
 * ═══════════════════════════════════════════════════════════════════════ */

describe('予約数', () => {
  let fixture: Fixture

  beforeAll(async () => {
    fixture = await setup()
    await markAnalyticsDays(fixture.org, fixture.storeId, augustDates(), CLOSED_TUESDAYS)
    // 営業日 27 日に 2 件ずつ = 54 件。1日あたりはちょうど 2.0 件になる。
    await insertAnalyticsDaily(
      fixture.org,
      fixture.storeId,
      augustDates()
        .filter((date) => !CLOSED_TUESDAYS.includes(date))
        .map((date) => ({ date, metric: 'reservations', value: 2 })),
    )
    // 受付日で数えると別の日に落ちる（同じ 8 月でも合計が変わる）。
    await insertAnalyticsDaily(fixture.org, fixture.storeId, [
      { date: '2026-08-10', metric: 'reservations_received', value: 9 },
    ])
    // 時間帯別・曜日別・月別の材料。
    await insertAnalyticsDaily(
      fixture.org,
      fixture.storeId,
      Array.from({ length: 9 }, (_, i) => ({
        date: '2026-08-10',
        metric: 'reservations',
        dimension: 'hour',
        dimensionKey: String(10 + i),
        value: i + 1,
      })),
    )
  })

  it('集計の種類 4 択 × かぞえる日 2 択 の 8 通りがすべて 200 で返る', async () => {
    for (const granularity of ['day', 'month', 'hour', 'weekday']) {
      for (const countBy of ['visit_date', 'received_date']) {
        const { status } = await fetchReport(fixture, {
          metric: 'reservation_count',
          ...AUGUST,
          granularity,
          countBy,
        })
        expect(status, `${granularity} × ${countBy}`).toBe(200)
      }
    }
  })

  it('ご来店日と受付日で同じ月の合計が異なる（同じ予約が別の日に落ちる）', async () => {
    const visit = await fetchReport(fixture, {
      metric: 'reservation_count',
      ...AUGUST,
      countBy: 'visit_date',
    })
    const received = await fetchReport(fixture, {
      metric: 'reservation_count',
      ...AUGUST,
      countBy: 'received_date',
    })
    expect(summaryOf(visit.body, '合計')).toBe('54')
    expect(summaryOf(received.body, '合計')).toBe('9')
  })

  it('時間帯別にすると点の key が 10..18 になり、日付が 1 つも出ない', async () => {
    const { body } = await fetchReport(fixture, {
      metric: 'reservation_count',
      ...AUGUST,
      granularity: 'hour',
    })
    expect(body.series[0]?.points.map((point) => point.key)).toEqual([
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
      '16',
      '17',
      '18',
    ])
    for (const point of body.series[0]?.points ?? []) {
      expect(point.key).not.toContain('-')
      expect(point.label).not.toContain('/')
    }
  })

  it('曜日別にすると点が 7 つになり、月別にすると期間の月数と同じ数になる', async () => {
    const weekday = await fetchReport(fixture, {
      metric: 'reservation_count',
      ...AUGUST,
      granularity: 'weekday',
    })
    expect(weekday.body.series[0]?.points).toHaveLength(7)
    expect(weekday.body.series[0]?.points.map((point) => point.label)).toEqual([
      '月',
      '火',
      '水',
      '木',
      '金',
      '土',
      '日',
    ])
    // 火曜は 4 日とも定休なので 0 件。棒は残す（曜日の軸を欠かさない）。
    expect(weekday.body.series[0]?.points[1]?.value).toBe(0)

    const month = await fetchReport(fixture, {
      metric: 'reservation_count',
      ...AUGUST,
      granularity: 'month',
    })
    expect(month.body.series[0]?.points).toHaveLength(1)
    expect(month.body.series[0]?.points[0]?.label).toBe('8月')
  })

  it('まとめは 合計・1日あたり・最も多い日 の 3 つだけで、4 つ目を返さない', async () => {
    const { body } = await fetchReport(fixture, { metric: 'reservation_count', ...AUGUST })
    expect(body.summary.map((row) => row.label)).toEqual(['合計', '1日あたり', '最も多い日'])
  })

  it('1日あたりは 合計 ÷ businessDays で、暦日数では割らない', async () => {
    const { body } = await fetchReport(fixture, { metric: 'reservation_count', ...AUGUST })
    // 暦は 31 日だが、火曜 4 日は定休なので分母は 27 日（54 ÷ 27 = 2）。
    expect(body.businessDays).toBe(27)
    expect(summaryOf(body, '1日あたり')).toBe('2')
    expect(summaryOf(body, '1日あたり')).not.toBe(String(Math.round((54 / 31) * 10) / 10))
  })

  it('取り消した予約を合計に含めない', async () => {
    // 日次集計を実際に走らせる（取消の除外は数え方の問題なので、生データから見る）。
    const storeId = await insertStore(fixture.org, 'EYEX 取消確認店')
    await insertBusinessHours(fixture.org, storeId, { closedWeekdays: [] })
    await grantStorePermissions(fixture.org, storeId, `dev:${fixture.org}`, ['analytics.read'])
    for (const status of ['confirmed', 'done', 'no_show'] as const) {
      await insertReservation(fixture.org, {
        storeId,
        startsAt: jstAt('2026-08-27', '11:00'),
        status,
      })
    }
    const res = await SELF.fetch(`${BASE}/api/internal/maintenance/analytics/rollup`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ now: NOW, days: 1 }),
    })
    expect(res.status).toBe(200)

    const query = new URLSearchParams({
      storeId,
      now: NOW,
      metric: 'reservation_count',
      from: '2026-08-27',
      to: '2026-08-27',
    })
    const report = (await (
      await SELF.fetch(`${BASE}/api/staff/analytics?${query}`, { headers: authed(fixture.token) })
    ).json()) as Report
    expect(summaryOf(report, '合計')).toBe('2')
  })
})

/* ═════════════════════════════════════════════════════════════════════════
 * 担当者
 * ═══════════════════════════════════════════════════════════════════════ */

describe('担当者', () => {
  let fixture: Fixture
  let sato = ''
  let ito = ''

  beforeAll(async () => {
    fixture = await setup()
    sato = await insertStaff(fixture.org, fixture.storeId, { displayName: '佐藤 美咲' })
    ito = await insertStaff(fixture.org, fixture.storeId, { displayName: '伊藤 亮', sortOrder: 1 })
    // 中村さんは期間に 1 件も受けていない（点としては残る）。
    await insertStaff(fixture.org, fixture.storeId, { displayName: '中村 彩', sortOrder: 2 })
    await markAnalyticsDays(fixture.org, fixture.storeId, augustDates(), CLOSED_TUESDAYS)
    await insertAnalyticsDaily(fixture.org, fixture.storeId, [
      {
        date: '2026-08-10',
        metric: 'receptions',
        dimension: 'staff',
        dimensionKey: sato,
        value: 30,
      },
      {
        date: '2026-08-10',
        metric: 'receptions',
        dimension: 'staff',
        dimensionKey: ito,
        value: 24,
      },
      {
        date: '2026-08-10',
        metric: 'receptions',
        dimension: 'staff',
        dimensionKey: 'unassigned',
        value: 6,
      },
      {
        date: '2026-08-10',
        metric: 'revisits_90d',
        dimension: 'staff',
        dimensionKey: sato,
        value: 12,
      },
    ])
  })

  it('各点の value の合計が まとめの合計件数と一致する', async () => {
    const { body } = await fetchReport(fixture, { metric: 'staff', ...AUGUST })
    expect(summaryOf(body, '合計')).toBe(String(sumOfPoints(body)))
    expect(sumOfPoints(body)).toBe(60)
  })

  it('件数 0 の担当も点として返る', async () => {
    const { body } = await fetchReport(fixture, { metric: 'staff', ...AUGUST })
    const nakamura = body.series[0]?.points.find((point) => point.label === '中村 彩')
    expect(nakamura?.value).toBe(0)
  })

  it('担当が未定は key=unassigned で並びの最後に来て、secondaryValue は常に null', async () => {
    const { body } = await fetchReport(fixture, { metric: 'staff', ...AUGUST })
    const points = body.series[0]?.points ?? []
    expect(points[points.length - 1]?.key).toBe('unassigned')
    expect(points[points.length - 1]?.secondaryValue).toBeNull()
    // 担当が決まっている人は、分母が足りていれば率が出る（30 件中 12 件）。
    expect(points[0]?.secondaryValue).toBeCloseTo(0.4, 5)
  })
})

/* ═════════════════════════════════════════════════════════════════════════
 * お待ち時間
 * ═══════════════════════════════════════════════════════════════════════ */

describe('お待ち時間', () => {
  let fixture: Fixture

  beforeAll(async () => {
    fixture = await setup()
    await markAnalyticsDays(fixture.org, fixture.storeId, augustDates(), CLOSED_TUESDAYS)
    await markAnalyticsDays(
      fixture.org,
      fixture.storeId,
      Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`),
    )
    await insertAnalyticsDaily(fixture.org, fixture.storeId, [
      // 8 月：中央値 320 秒（外れ値の 3600 秒に引っぱられない）。
      { date: '2026-08-05', metric: 'wait_seconds_median', value: 300 },
      { date: '2026-08-05', metric: 'receptions', value: 10 },
      { date: '2026-08-06', metric: 'wait_seconds_median', value: 320 },
      { date: '2026-08-06', metric: 'receptions', value: 10 },
      { date: '2026-08-07', metric: 'wait_seconds_median', value: 3600 },
      { date: '2026-08-07', metric: 'receptions', value: 1 },
      // 時間帯別。12 時台は受付が 0 件なので点を返さない。
      {
        date: '2026-08-05',
        metric: 'wait_seconds_median',
        dimension: 'hour',
        dimensionKey: '11',
        value: 540,
      },
      {
        date: '2026-08-05',
        metric: 'receptions',
        dimension: 'hour',
        dimensionKey: '11',
        value: 8,
      },
      {
        date: '2026-08-05',
        metric: 'wait_seconds_median',
        dimension: 'hour',
        dimensionKey: '12',
        value: 200,
      },
      // 前の月（7 月）の中央値。
      { date: '2026-07-15', metric: 'wait_seconds_median', value: 420 },
      { date: '2026-07-15', metric: 'receptions', value: 12 },
    ])
  })

  it('中央値は日ごとの中央値を受付件数で重み付けして出す（秒で持つ）', async () => {
    const { body } = await fetchReport(fixture, { metric: 'wait_time', ...AUGUST })
    expect(summaryOf(body, '中央値')).toBe('5分20秒')
    expect(body.target).toBe(480)
  })

  it('中央値であって平均ではない（外れ値 1 件で動かない）', async () => {
    const { body } = await fetchReport(fixture, { metric: 'wait_time', ...AUGUST })
    // 平均なら (300+320+3600)/3 ≒ 1406 秒（23分）になる。中央値はそこへ動かない。
    expect(summaryOf(body, '中央値')).not.toBe('23分27秒')
    expect(body.summary.find((row) => row.label === '中央値')?.isOverTarget).toBe(false)
  })

  it('まとめに 前の月の中央値と 受付件数の母数が入る', async () => {
    const { body } = await fetchReport(fixture, { metric: 'wait_time', ...AUGUST })
    expect(summaryOf(body, '前の月の中央値')).toBe('7分0秒')
    expect(summaryOf(body, '受付')).toBe('21')
    expect(body.summary.find((row) => row.label === '受付')?.unit).toBe('件')
  })

  it('受付 0 件の時間帯は点を返さない（軸だけ残す）', async () => {
    const { body } = await fetchReport(fixture, { metric: 'wait_time', ...AUGUST })
    const keys = body.series[0]?.points.map((point) => point.key)
    expect(keys).toEqual(['11'])
    // 11 時台の 540 秒（9 分）は 8 分の目安を超えている。
    expect(body.series[0]?.points[0]?.isOverTarget).toBe(true)
  })
})

/* ═════════════════════════════════════════════════════════════════════════
 * 取り消し
 * ═══════════════════════════════════════════════════════════════════════ */

describe('取り消し', () => {
  let fixture: Fixture

  beforeAll(async () => {
    fixture = await setup()
    const july = Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`)
    await markAnalyticsDays(fixture.org, fixture.storeId, [...july, ...augustDates()])
    await insertAnalyticsDaily(fixture.org, fixture.storeId, [
      { date: '2026-08-10', metric: 'reservations', value: 90 },
      // 5 層で合計 10 件（取消率 10.0% ちょうど＝超過にしない）。
      ...(
        [
          ['customer', 4],
          ['store', 2],
          ['duplicate', 1],
          ['no_show', 2],
          ['web', 1],
        ] as const
      ).map(([key, value]) => ({
        date: '2026-08-10',
        metric: 'cancellations',
        dimension: 'cancel_reason',
        dimensionKey: key,
        value,
      })),
      { date: '2026-08-10', metric: 'no_shows', value: 2 },
      // 7 月は予約だけで取消が 0 件。
      { date: '2026-07-10', metric: 'reservations', value: 50 },
    ])
  })

  const cancellation = () =>
    fetchReport(fixture, {
      metric: 'cancellation',
      from: '2026-07-01',
      to: '2026-08-31',
      granularity: 'month',
    })

  it('凡例は 5 本で、名前が CHANGE-CANCEL の 4 択と 1 字も違わない', async () => {
    const { body } = await cancellation()
    expect(body.series.map((series) => series.name)).toEqual([
      'お客様のご都合',
      '店舗の都合',
      '予約の重複',
      'ご来店がなかった',
      'Webからの取消',
    ])
  })

  it('5 層は排他で、層の合計がその月の取消件数と一致する', async () => {
    const { body } = await cancellation()
    expect(sumOfPoints(body)).toBe(10)
    expect(summaryOf(body, '取消件数')).toBe('10')
  })

  it('取消率の分母は 予約数 + 取消件数（来店予定だった総数）である', async () => {
    const { body } = await cancellation()
    // 予約 140 件（7 月 50 + 8 月 90）＋ 取消 10 件 = 150 件。
    expect(summaryOf(body, '来店予定だった総数')).toBe('150')
    expect(summaryOf(body, '取消率')).toBe('6.7')
    expect(body.target).toBe(10)
    expect(body.suppressed).toBe(false)
  })

  it('取消が 0 件の月は点を返さない', async () => {
    const { body } = await cancellation()
    for (const series of body.series) {
      expect(series.points.map((point) => point.key)).toEqual(['2026-08'])
    }
  })

  it('取消率 10.0% ちょうどは超過にせず、10.1% で超過にする', async () => {
    const exact = await fetchReport(fixture, {
      metric: 'cancellation',
      from: '2026-08-01',
      to: '2026-08-31',
      granularity: 'month',
    })
    // 8 月だけなら 90 + 10 = 100 件の 10 件 = 10.0%。
    expect(summaryOf(exact.body, '取消率')).toBe('10')
    expect(exact.body.summary.find((row) => row.label === '取消率')?.isOverTarget).toBe(false)

    // 予約を 1 件減らすと 10 / 99 = 10.1% になり、超過になる。
    await insertAnalyticsDaily(fixture.org, fixture.storeId, [
      { date: '2026-08-10', metric: 'reservations', value: 89 },
    ])
    const over = await fetchReport(fixture, {
      metric: 'cancellation',
      from: '2026-08-01',
      to: '2026-08-31',
      granularity: 'month',
    })
    expect(summaryOf(over.body, '取消率')).toBe('10.1')
    expect(over.body.summary.find((row) => row.label === '取消率')?.isOverTarget).toBe(true)
  })
})

/* ═════════════════════════════════════════════════════════════════════════
 * モックの無い 3 タブ
 * ═══════════════════════════════════════════════════════════════════════ */

describe('予約の入口・来店回数・ご来店の目的', () => {
  let fixture: Fixture
  let purposeId = ''

  beforeAll(async () => {
    fixture = await setup()
    await markAnalyticsDays(fixture.org, fixture.storeId, augustDates(), CLOSED_TUESDAYS)
    purposeId = await insertVisitPurpose(fixture.org, fixture.storeId, {
      nameInternal: 'メガネを新しく作る',
      nameShort: '新調',
    })
    // 目的そのものは削除済み（is_active='0'）でも、期間に予約があるなら名前を残す。
    await env.DB.prepare("UPDATE visit_purposes SET is_active = '0' WHERE id = ?")
      .bind(purposeId)
      .run()
    await insertAnalyticsDaily(fixture.org, fixture.storeId, [
      ...(
        [
          ['phone', 12],
          ['counter', 5],
          ['web', 8],
          ['walkin', 3],
        ] as const
      ).map(([key, value]) => ({
        date: '2026-08-10',
        metric: 'reservations',
        dimension: 'source',
        dimensionKey: key,
        value,
      })),
      ...(
        [
          ['first', 9],
          ['second', 4],
          ['third_to_fifth', 6],
          ['sixth_plus', 2],
        ] as const
      ).map(([key, value]) => ({
        date: '2026-08-10',
        metric: 'receptions',
        dimension: 'visit_frequency',
        dimensionKey: key,
        value,
      })),
      {
        date: '2026-08-10',
        metric: 'reservations',
        dimension: 'purpose',
        dimensionKey: purposeId,
        value: 7,
      },
    ])
  })

  it('予約の入口 > お電話・店頭・Web予約・ウォークイン の 4 系列を返す', async () => {
    const { body } = await fetchReport(fixture, { metric: 'reservation_source', ...AUGUST })
    expect(body.series.map((series) => series.name)).toEqual([
      'お電話',
      '店頭',
      'Web予約',
      'ウォークイン',
    ])
    expect(sumOfPoints(body)).toBe(28)
    expect(summaryOf(body, '最も多い入口')).toBe('お電話')
  })

  it('来店回数 > 初めて・2回目・3〜5回・6回以上 の 4 階級を返す', async () => {
    const { body } = await fetchReport(fixture, { metric: 'visit_frequency', ...AUGUST })
    expect(body.series[0]?.points.map((point) => point.label)).toEqual([
      '初めて',
      '2回目',
      '3〜5回',
      '6回以上',
    ])
    expect(summaryOf(body, '合計')).toBe('21')
  })

  it('ご来店の目的 > 目的ごとの件数を返し、削除済みの目的も期間内に予約があれば残す', async () => {
    const { body } = await fetchReport(fixture, { metric: 'purpose', ...AUGUST })
    expect(body.series[0]?.points).toHaveLength(1)
    expect(body.series[0]?.points[0]?.label).toBe('メガネを新しく作る')
    expect(body.series[0]?.points[0]?.value).toBe(7)
  })
})

/* ═════════════════════════════════════════════════════════════════════════
 * 8 タブ共通 / 目安
 * ═══════════════════════════════════════════════════════════════════════ */

describe('8 タブ共通', () => {
  let fixture: Fixture

  beforeAll(async () => {
    fixture = await setup()
    await markAnalyticsDays(fixture.org, fixture.storeId, augustDates(), CLOSED_TUESDAYS)
  })

  it('どの metric でも series が 1 つ以上あり、summary が 3 つ以下である', async () => {
    for (const metric of [
      'overview',
      'reservation_count',
      'reservation_source',
      'cancellation',
      'visit_frequency',
      'staff',
      'purpose',
      'wait_time',
    ]) {
      const { status, body } = await fetchReport(fixture, { metric, ...AUGUST })
      expect(status, metric).toBe(200)
      expect(body.series.length, metric).toBeGreaterThanOrEqual(1)
      expect(body.summary.length, metric).toBeLessThanOrEqual(3)
      expect(body.metric, metric).toBe(metric)
    }
  })

  it('目安 > GET /api/staff/analytics/targets が 8 / 10 / 90 を返す', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/analytics/targets?storeId=${fixture.storeId}`, {
      headers: authed(fixture.token),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      waitMinutes: 8,
      cancellationRatePercent: 10,
      revisitWindowDays: 90,
    })
  })
})

/* ═════════════════════════════════════════════════════════════════════════
 * 小標本抑制（T-005）
 * ═══════════════════════════════════════════════════════════════════════ */

describe('小標本', () => {
  let fixture: Fixture
  let exactly20 = ''
  let nineteen = ''
  let quiet = ''

  beforeAll(async () => {
    fixture = await setup()
    exactly20 = await insertStaff(fixture.org, fixture.storeId, { displayName: '佐藤 美咲' })
    nineteen = await insertStaff(fixture.org, fixture.storeId, {
      displayName: '伊藤 亮',
      sortOrder: 1,
    })
    quiet = await insertStaff(fixture.org, fixture.storeId, {
      displayName: '中村 彩',
      sortOrder: 2,
    })
    await markAnalyticsDays(fixture.org, fixture.storeId, augustDates(), CLOSED_TUESDAYS)
    await insertAnalyticsDaily(fixture.org, fixture.storeId, [
      // 分母ちょうど 20 件 → 率を出す。
      {
        date: '2026-08-10',
        metric: 'receptions',
        dimension: 'staff',
        dimensionKey: exactly20,
        value: 20,
      },
      {
        date: '2026-08-10',
        metric: 'revisits_90d',
        dimension: 'staff',
        dimensionKey: exactly20,
        value: 5,
      },
      // 分母 19 件 → 伏せる（件数は返す）。
      {
        date: '2026-08-10',
        metric: 'receptions',
        dimension: 'staff',
        dimensionKey: nineteen,
        value: 19,
      },
      {
        date: '2026-08-10',
        metric: 'revisits_90d',
        dimension: 'staff',
        dimensionKey: nineteen,
        value: 9,
      },
      // 担当未定は分母 40 件でも伏せる。
      {
        date: '2026-08-10',
        metric: 'receptions',
        dimension: 'staff',
        dimensionKey: 'unassigned',
        value: 40,
      },
      {
        date: '2026-08-10',
        metric: 'revisits_90d',
        dimension: 'staff',
        dimensionKey: 'unassigned',
        value: 20,
      },
    ])
  })

  const staffPoints = async () => {
    const { body } = await fetchReport(fixture, { metric: 'staff', ...AUGUST })
    return { body, points: body.series[0]?.points ?? [] }
  }

  it('分母 20 件ちょうどの担当は率を返す', async () => {
    const { points } = await staffPoints()
    const row = points.find((point) => point.label === '佐藤 美咲')
    expect(row?.value).toBe(20)
    expect(row?.secondaryValue).toBeCloseTo(0.25, 5)
  })

  it('分母 19 件の担当は secondaryValue が null になり、件数は返る', async () => {
    const { points } = await staffPoints()
    const row = points.find((point) => point.label === '伊藤 亮')
    expect(row?.value).toBe(19)
    expect(row?.secondaryValue).toBeNull()
  })

  it('伏せた行があっても report.suppressed は担当者タブでは false のまま（点ごとの話である）', async () => {
    const { body } = await staffPoints()
    expect(body.suppressed).toBe(false)
    // 1 件も受けていない担当も伏せられる（分母 0）。
    const row = (body.series[0]?.points ?? []).find((point) => point.label === '中村 彩')
    expect(row?.key).toBe(quiet.slice(0, 20))
    expect(row?.secondaryValue).toBeNull()
  })

  it('担当が未定は分母 40 件でも secondaryValue が null', async () => {
    const { points } = await staffPoints()
    const row = points.find((point) => point.key === 'unassigned')
    expect(row?.value).toBe(40)
    expect(row?.secondaryValue).toBeNull()
  })

  it('取消率の分母が 19 のとき report.suppressed が true になり、まとめの率が「—」で返る', async () => {
    const thin = await setup()
    await markAnalyticsDays(thin.org, thin.storeId, augustDates(), CLOSED_TUESDAYS)
    await insertAnalyticsDaily(thin.org, thin.storeId, [
      { date: '2026-08-10', metric: 'reservations', value: 17 },
      {
        date: '2026-08-10',
        metric: 'cancellations',
        dimension: 'cancel_reason',
        dimensionKey: 'customer',
        value: 2,
      },
    ])
    const { body } = await fetchReport(thin, {
      metric: 'cancellation',
      ...AUGUST,
      granularity: 'month',
    })
    expect(body.suppressed).toBe(true)
    expect(summaryOf(body, '取消率')).toBe('—')
    // 件数そのものは返る（率だけを伏せる）。
    expect(summaryOf(body, '取消件数')).toBe('2')
    expect(summaryOf(body, '来店予定だった総数')).toBe('19')
  })
})

/* ═════════════════════════════════════════════════════════════════════════
 * 欠測と定休（T-005）
 * ═══════════════════════════════════════════════════════════════════════ */

describe('欠測', () => {
  let fixture: Fixture
  /** 8/20〜9/3 の 15 日。うち 2 日はまだ集計していない。 */
  const RANGE = { from: '2026-08-20', to: '2026-09-03' }
  const PENDING = ['2026-09-02', '2026-09-03']
  const CLOSED = ['2026-08-25']

  beforeAll(async () => {
    fixture = await setup()
    const dates = Array.from({ length: 15 }, (_, i) =>
      i < 12 ? `2026-08-${20 + i}` : `2026-09-0${i - 11}`,
    ).filter((date) => !PENDING.includes(date))
    await markAnalyticsDays(fixture.org, fixture.storeId, dates, CLOSED)
    await insertAnalyticsDaily(fixture.org, fixture.storeId, [
      { date: '2026-08-21', metric: 'reservations', value: 4 },
    ])
  })

  const overview = () => fetchReport(fixture, { metric: 'overview', ...RANGE })

  it('closed の行が無い日は点を返さず、pendingDays に数える', async () => {
    const { body } = await overview()
    const keys = body.series[0]?.points.map((point) => point.key) ?? []
    expect(keys).not.toContain('2026-09-02')
    expect(keys).not.toContain('2026-09-03')
    expect(keys).toHaveLength(13)
  })

  it('closed=1 の日は value=0 の点を返し、isClosed が true になる', async () => {
    const { body } = await overview()
    const row = body.series[0]?.points.find((point) => point.key === '2026-08-25')
    expect(row?.value).toBe(0)
    expect(row?.isClosed).toBe(true)
  })

  it('closed=0 で予約が 0 件の日は value=0・isClosed=false の点を返す（定休と区別する）', async () => {
    const { body } = await overview()
    const row = body.series[0]?.points.find((point) => point.key === '2026-08-24')
    expect(row?.value).toBe(0)
    expect(row?.isClosed).toBe(false)
  })

  it('期間の 15 日のうち 2 日が未集計なら pendingDays=2 を返す', async () => {
    const { body } = await overview()
    expect(body.pendingDays).toBe(2)
  })

  it('businessDays は closed=0 の日数だけを数え、未集計の日を営業日に数えない', async () => {
    const { body } = await overview()
    // 15 日 − 未集計 2 日 − 定休 1 日 = 12 日。
    expect(body.businessDays).toBe(12)
  })
})
