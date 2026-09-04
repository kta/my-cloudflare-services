/**
 * analytics_daily に書く前の、D1 非依存の日次ロールアップ契約。
 *
 * この層は「どの行を数えるか」だけを決める。DB の join や upsert、Cron の時計は
 * 呼び出し側の責務とし、ここでは now も入力として注入する。
 */
import { describe, expect, it } from 'vitest'
import {
  type AnalyticsDailyRow,
  type AnalyticsReservation,
  type AnalyticsRollupInput,
  type AnalyticsVisitEvent,
  rollupAnalyticsDay,
} from '../src/worker/domain/analytics-rollup'

const ORG = 'org-a'
const STORE = 'store-a'
const OTHER_STORE = 'store-b'
const OTHER_ORG = 'org-b'
const DATE = '2026-08-27'
const NOW = new Date('2026-08-27T15:00:00.000Z') // JST 2026-08-28 00:00

/** JST の壁時計を UTC ISO へ直す。 */
function jst(date: string, time: string): string {
  return new Date(Date.parse(`${date}T${time}:00.000Z`) - 9 * 60 * 60_000).toISOString()
}

function reservation(
  overrides: Partial<AnalyticsReservation> & { id: string },
): AnalyticsReservation {
  return {
    organizationId: ORG,
    storeId: STORE,
    source: 'phone',
    status: 'confirmed',
    startsAt: jst(DATE, '10:00'),
    createdAt: jst(DATE, '09:00'),
    customerId: null,
    staffId: null,
    purposeIds: [],
    ...overrides,
  }
}

function event(
  overrides: Partial<AnalyticsVisitEvent> & { subjectId: string },
): AnalyticsVisitEvent {
  return {
    organizationId: ORG,
    storeId: STORE,
    stage: 'received',
    occurredAt: jst(DATE, '10:00'),
    ...overrides,
  }
}

function rollup(overrides: Partial<AnalyticsRollupInput> = {}) {
  return rollupAnalyticsDay({
    organizationId: ORG,
    storeId: STORE,
    date: DATE,
    now: NOW,
    isClosed: false,
    reservations: [],
    visitEvents: [],
    ...overrides,
  })
}

function value(
  rows: readonly AnalyticsDailyRow[],
  metric: AnalyticsDailyRow['metric'],
  dimension: AnalyticsDailyRow['dimension'] = 'total',
  dimensionKey = '',
): number | undefined {
  return rows.find(
    (row) =>
      row.metric === metric && row.dimension === dimension && row.dimensionKey === dimensionKey,
  )?.value
}

describe('rollupAnalyticsDay', () => {
  it('定休日にはclosed=1、空営業日にはclosed=0を書き、未来日は予約系だけを先に書く', () => {
    expect(value(rollup({ isClosed: true }).rows, 'closed')).toBe(1)
    expect(value(rollup().rows, 'closed')).toBe(0)

    const futureDate = '2026-08-29'
    const future = rollup({
      date: futureDate,
      reservations: [
        reservation({
          id: 'future-active',
          startsAt: jst(futureDate, '10:00'),
          purposeIds: ['p-future'],
        }),
        reservation({
          id: 'future-cancelled',
          startsAt: jst(futureDate, '11:00'),
          status: 'cancelled',
          source: 'web',
          cancelReason: 'customer',
        }),
      ],
    })
    expect(value(future.rows, 'closed')).toBeUndefined()
    expect(value(future.rows, 'reservations')).toBe(1)
    expect(value(future.rows, 'scheduled_reservations')).toBe(2)
    expect(value(future.rows, 'reservations', 'purpose', 'p-future')).toBe(1)
    expect(value(future.rows, 'cancellations', 'cancellation_category', 'web')).toBe(1)
    expect(future.rows.some((row) => row.metric === 'receptions')).toBe(false)
    expect(future.dropped).toEqual({ cancellationReservationIds: [] })
  })

  it('休業日でも予約・予定・取消を残し、実績系だけを確定しない', () => {
    const result = rollup({
      isClosed: true,
      reservations: [
        reservation({ id: 'active' }),
        reservation({
          id: 'cancelled',
          status: 'cancelled',
          cancelReason: 'customer',
        }),
        reservation({ id: 'done', status: 'done', staffId: 'staff-a' }),
      ],
      visitEvents: [
        event({ subjectId: 'done' }),
        event({ subjectId: 'done', stage: 'consulting', occurredAt: jst(DATE, '10:02') }),
      ],
    })

    expect(value(result.rows, 'closed')).toBe(1)
    expect(value(result.rows, 'scheduled_reservations')).toBe(3)
    expect(value(result.rows, 'reservations')).toBe(2)
    expect(value(result.rows, 'reservations_received')).toBe(2)
    expect(value(result.rows, 'cancellations', 'cancellation_category', 'customer')).toBe(1)
    expect(value(result.rows, 'receptions')).toBeUndefined()
    expect(
      value(result.rows, 'wait_seconds_histogram', 'wait_seconds', 'hour:10:120'),
    ).toBeUndefined()
    expect(value(result.rows, 'revisit_eligible', 'staff', 'staff-a')).toBeUndefined()
  })

  it('当日を未確定forecastとして扱い、予約系だけを作る', () => {
    const result = rollup({
      date: '2026-08-28',
      completedThrough: '2026-08-27',
      reservations: [reservation({ id: 'today', startsAt: jst('2026-08-28', '10:00') })],
    })

    expect(value(result.rows, 'closed')).toBeUndefined()
    expect(value(result.rows, 'scheduled_reservations')).toBe(1)
    expect(value(result.rows, 'receptions')).toBeUndefined()
  })

  it('後続のcatch-upでforecast日をclosed・実績系へ確定し直す', () => {
    const date = '2026-08-28'
    const reservations = [
      reservation({
        id: 'current',
        status: 'done',
        startsAt: jst(date, '10:00'),
        createdAt: jst(date, '09:00'),
        customerId: 'customer-a',
        staffId: 'staff-a',
      }),
      reservation({
        id: 'prior',
        status: 'done',
        startsAt: jst('2026-08-01', '10:00'),
        customerId: 'customer-a',
      }),
    ]
    const visitEvents = [
      event({ subjectId: 'current', occurredAt: jst(date, '10:00') }),
      event({ subjectId: 'current', stage: 'consulting', occurredAt: jst(date, '10:02') }),
    ]
    const forecast = rollup({ date, completedThrough: '2026-08-27', reservations, visitEvents })
    const confirmed = rollup({ date, completedThrough: date, reservations, visitEvents })

    expect(value(forecast.rows, 'closed')).toBeUndefined()
    expect(value(forecast.rows, 'receptions')).toBeUndefined()
    expect(
      value(forecast.rows, 'wait_seconds_histogram', 'wait_seconds', 'hour:10:120'),
    ).toBeUndefined()
    expect(value(forecast.rows, 'revisit_eligible', 'staff', 'staff-a')).toBeUndefined()
    expect(value(confirmed.rows, 'closed')).toBe(0)
    expect(value(confirmed.rows, 'receptions')).toBe(1)
    expect(value(confirmed.rows, 'wait_seconds_histogram', 'wait_seconds', 'hour:10:120')).toBe(1)
    expect(value(confirmed.rows, 'revisit_eligible', 'staff', 'staff-a')).toBe(1)
    expect(value(confirmed.rows, 'revisit_returning_90d', 'staff', 'staff-a')).toBe(1)
  })

  it('来店日・受付日の予約指標をJSTで分け、取消/no_showは有効来店予定から除く', () => {
    const result = rollup({
      reservations: [
        reservation({ id: 'active', purposeIds: ['p-a'], source: 'phone' }),
        reservation({
          id: 'cancelled',
          status: 'cancelled',
          cancelReason: 'customer',
          source: 'web',
        }),
        reservation({ id: 'no-show', status: 'no_show', source: 'counter' }),
        reservation({
          id: 'received-today',
          startsAt: jst('2026-08-28', '00:01'),
          createdAt: jst(DATE, '23:59'),
          source: 'counter',
          purposeIds: ['p-b'],
        }),
        reservation({
          id: 'foreign-store',
          storeId: OTHER_STORE,
          source: 'walkin',
          startsAt: jst(DATE, '11:00'),
        }),
      ],
    })

    expect(value(result.rows, 'reservations')).toBe(1)
    expect(value(result.rows, 'scheduled_reservations')).toBe(3)
    expect(value(result.rows, 'reservations_received')).toBe(2)
    expect(value(result.rows, 'reservations', 'purpose', 'p-a')).toBe(1)
    expect(value(result.rows, 'reservations_received', 'purpose', 'p-b')).toBe(1)
  })

  it('完了来店を予約とwalkinで合算し、staff/hour/source/来店回数を排他的に出す', () => {
    const result = rollup({
      reservations: [
        reservation({
          id: 'reserved-done',
          status: 'done',
          source: 'web',
          startsAt: jst(DATE, '10:30'),
          customerId: 'customer-returning',
          staffId: 'staff-a',
          visitCountBefore: 0,
        }),
        reservation({
          id: 'walkin-done',
          status: 'done',
          source: 'walkin',
          startsAt: jst(DATE, '11:30'),
          customerId: 'customer-second',
          staffId: null,
          visitCountBefore: 1,
        }),
        reservation({
          id: 'not-done',
          status: 'arrived',
          source: 'phone',
          startsAt: jst(DATE, '12:00'),
          customerId: 'customer-not-done',
          staffId: 'staff-b',
          visitCountBefore: 5,
        }),
      ],
    })

    expect(value(result.rows, 'receptions')).toBe(2)
    expect(value(result.rows, 'receptions', 'staff', 'staff-a')).toBe(1)
    expect(value(result.rows, 'receptions', 'staff', 'unassigned')).toBe(1)
    expect(result.rows.some((row) => row.metric === 'receptions' && row.dimension === 'hour')).toBe(
      false,
    )
    expect(value(result.rows, 'receptions', 'source', 'web')).toBe(1)
    expect(value(result.rows, 'receptions', 'source', 'walkin')).toBe(1)
    expect(
      ['first', 'second', 'third_to_fifth', 'sixth_or_more'].map((key) =>
        value(result.rows, 'receptions', 'visit_frequency', key),
      ),
    ).toEqual([1, 1, 0, 0])
  })

  it('purpose、4入口、4来店回数を合計と混同せず固定語彙で出す', () => {
    const result = rollup({
      reservations: [
        reservation({
          id: 'one',
          status: 'done',
          source: 'phone',
          purposeIds: ['p-a', 'p-b'],
          customerId: 'customer-1',
          visitCountBefore: 2,
        }),
        reservation({
          id: 'two',
          status: 'done',
          source: 'counter',
          customerId: 'customer-2',
          visitCountBefore: 5,
        }),
      ],
    })

    expect(value(result.rows, 'reservations')).toBe(2)
    expect(value(result.rows, 'reservations', 'purpose', 'p-a')).toBe(1)
    expect(value(result.rows, 'reservations', 'purpose', 'p-b')).toBe(1)
    expect(
      ['phone', 'counter', 'web', 'walkin'].map((key) =>
        value(result.rows, 'reservations', 'source', key),
      ),
    ).toEqual([1, 1, 0, 0])
    expect(
      ['first', 'second', 'third_to_fifth', 'sixth_or_more'].map((key) =>
        value(result.rows, 'receptions', 'visit_frequency', key),
      ),
    ).toEqual([0, 0, 1, 1])
    expect(result.rows.some((row) => row.metric === ('guests' as never))).toBe(false)
  })

  it('active staff の0件行と、日次へ残す日本語snapshot labelを作る', () => {
    const result = rollup({
      staff: [
        { id: 'staff-a', label: '佐藤 美咲', isActive: true },
        { id: 'staff-b', label: '鈴木 健', isActive: true },
      ],
      reservations: [
        reservation({
          id: 'done',
          status: 'done',
          source: 'web',
          staffId: 'staff-a',
          purposeIds: ['purpose-a'],
          purposeLabels: { 'purpose-a': '視力測定' },
          customerId: 'customer-a',
          visitCountBefore: 0,
        }),
      ],
    })
    const find = (
      metric: AnalyticsDailyRow['metric'],
      dimension: AnalyticsDailyRow['dimension'],
      key: string,
    ) =>
      result.rows.find(
        (row) => row.metric === metric && row.dimension === dimension && row.dimensionKey === key,
      )

    expect(find('receptions', 'staff', 'staff-a')).toMatchObject({
      value: 1,
      dimensionLabel: '佐藤 美咲',
    })
    expect(find('receptions', 'staff', 'staff-b')).toMatchObject({
      value: 0,
      dimensionLabel: '鈴木 健',
    })
    expect(find('reservations', 'purpose', 'purpose-a')).toMatchObject({
      dimensionLabel: '視力測定',
    })
    expect(find('reservations', 'source', 'web')).toMatchObject({ dimensionLabel: 'Web予約' })
    expect(find('receptions', 'visit_frequency', 'first')).toMatchObject({
      dimensionLabel: '初めて',
    })
  })

  it('取消を5分類へ排他的にし、未知の取消はdroppedとして観測可能にする', () => {
    const result = rollup({
      reservations: [
        reservation({
          id: 'no-show-wins',
          status: 'no_show',
          source: 'web',
          cancelReason: 'customer',
        }),
        reservation({ id: 'web-wins', status: 'cancelled', source: 'web', cancelReason: 'store' }),
        reservation({ id: 'customer', status: 'cancelled', cancelReason: 'customer' }),
        reservation({ id: 'store', status: 'cancelled', cancelReason: 'store' }),
        reservation({ id: 'duplicate', status: 'cancelled', cancelReason: 'duplicate' }),
        reservation({ id: 'unknown', status: 'cancelled', cancelReason: null }),
      ],
    })

    expect(
      ['customer', 'store', 'duplicate', 'no_show', 'web'].map((key) =>
        value(result.rows, 'cancellations', 'cancellation_category', key),
      ),
    ).toEqual([1, 1, 1, 1, 1])
    expect(result.dropped).toEqual({ cancellationReservationIds: ['unknown'] })
  })

  it('受付から最初のconsultingだけをexact histogramへ入れ、相談開始なしと他org/storeを混ぜない', () => {
    const result = rollup({
      visitEvents: [
        event({ subjectId: 'a', occurredAt: jst(DATE, '10:00') }),
        event({ subjectId: 'a', stage: 'consulting', occurredAt: jst(DATE, '10:02') }),
        event({ subjectId: 'a', stage: 'consulting', occurredAt: jst(DATE, '10:07') }),
        event({ subjectId: 'b', occurredAt: jst(DATE, '11:00') }),
        event({ subjectId: 'foreign-store', storeId: OTHER_STORE, occurredAt: jst(DATE, '12:00') }),
        event({
          subjectId: 'foreign-org',
          organizationId: OTHER_ORG,
          occurredAt: jst(DATE, '13:00'),
        }),
      ],
    })

    expect(value(result.rows, 'wait_seconds_histogram', 'wait_seconds', 'hour:10:120')).toBe(1)
    expect(result.rows.filter((row) => row.metric === 'wait_seconds_histogram')).toHaveLength(1)
  })

  it('後方1〜90日の完了来店だけを再来にし、担当が未定は率の分母・分子へ書かない', () => {
    const result = rollup({
      reservations: [
        reservation({
          id: 'returning-at-90',
          status: 'done',
          customerId: 'customer-a',
          staffId: 'staff-a',
          startsAt: jst(DATE, '10:00'),
        }),
        reservation({
          id: 'prior-at-90',
          status: 'done',
          customerId: 'customer-a',
          startsAt: jst('2026-05-29', '12:00'),
        }),
        reservation({
          id: 'outside-91',
          status: 'done',
          customerId: 'customer-b',
          staffId: null,
          startsAt: jst(DATE, '11:00'),
        }),
        reservation({
          id: 'prior-at-91',
          status: 'done',
          customerId: 'customer-b',
          startsAt: jst('2026-05-28', '12:00'),
        }),
        reservation({
          id: 'anonymous',
          status: 'done',
          customerId: null,
          startsAt: jst(DATE, '12:00'),
        }),
      ],
    })

    expect(value(result.rows, 'revisit_eligible')).toBeUndefined()
    expect(value(result.rows, 'revisit_returning_90d')).toBeUndefined()
    expect(value(result.rows, 'revisit_eligible', 'staff', 'staff-a')).toBe(1)
    expect(value(result.rows, 'revisit_returning_90d', 'staff', 'staff-a')).toBe(1)
    expect(value(result.rows, 'revisit_eligible', 'staff', 'unassigned')).toBeUndefined()
    expect(value(result.rows, 'revisit_returning_90d', 'staff', 'unassigned')).toBeUndefined()
  })

  it('顧客未特定でも担当済みの完了来店は再来率の分母へ入れ、分子は0にする', () => {
    const result = rollup({
      reservations: [
        reservation({
          id: 'anonymous-assigned',
          status: 'done',
          customerId: null,
          staffId: 'staff-a',
        }),
      ],
    })

    expect(value(result.rows, 'revisit_eligible', 'staff', 'staff-a')).toBe(1)
    expect(value(result.rows, 'revisit_returning_90d', 'staff', 'staff-a')).toBe(0)
  })
})
