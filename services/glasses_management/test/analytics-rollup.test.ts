/**
 * 1 店舗 1 日分の生データを `analytics_daily` の行へ畳む純関数。
 * ここが分析の数字の出どころなので、**何を数え、何を数えないか**を行の形で固定する。
 *
 * 「名」（人数）は 1 行も書かない（Q-11）。定休日は `value=0` の行を必ず書き、
 * 行が無い状態（欠測）と区別できるようにする。
 */

import { describe, expect, it } from 'vitest'
import {
  type AnalyticsRow,
  type RollupInput,
  rollupDay,
} from '../src/worker/domain/analytics-rollup'

const ORG = 'org-1'
const STORE = 'store-1'
const DATE = '2026-08-27' // 木曜

/** JST の壁時計を UTC の ISO8601 に直す。読み手に +9 時間の暗算をさせない。 */
function jst(date: string, time: string): string {
  const [h, m] = time.split(':').map(Number)
  const base = Date.parse(`${date}T00:00:00.000Z`)
  return new Date(base + ((h as number) - 9) * 3_600_000 + (m as number) * 60_000).toISOString()
}

function baseInput(over: Partial<RollupInput> = {}): RollupInput {
  return {
    organizationId: ORG,
    storeId: STORE,
    date: DATE,
    // 木曜（weekday=4）は営業日。
    businessHours: [{ weekday: 4, isClosed: '0' }],
    calendarExceptions: [],
    reservations: [],
    reservationAssignments: [],
    reservationPurposes: [],
    walkIns: [],
    visitEvents: [],
    laterVisits: [],
    ...over,
  }
}

function pick(rows: readonly AnalyticsRow[], metric: string, dimension: string): AnalyticsRow[] {
  return rows.filter((row) => row.metric === metric && row.dimension === dimension)
}

function valueAt(
  rows: readonly AnalyticsRow[],
  metric: string,
  dimension: string,
  key = '',
): number | undefined {
  return rows.find(
    (r) => r.metric === metric && r.dimension === dimension && r.dimensionKey === key,
  )?.value
}

function reservation(over: Partial<RollupInput['reservations'][number]> = {}) {
  return {
    id: 'r-1',
    source: 'phone',
    status: 'done',
    startsAt: jst(DATE, '11:00'),
    createdAt: jst(DATE, '09:00'),
    cancelReason: null,
    customerId: 'c-1',
    ...over,
  }
}

describe('rollupDay', () => {
  it('定休日は closed=1 と reservations=0 の 2 行を必ず書く', () => {
    const { rows } = rollupDay(baseInput({ businessHours: [{ weekday: 4, isClosed: '1' }] }))
    expect(rows).toHaveLength(2)
    expect(valueAt(rows, 'closed', 'total')).toBe(1)
    expect(valueAt(rows, 'reservations', 'total')).toBe(0)
  })

  it('臨時休業の日も closed=1 になる（営業曜日でも暦が勝つ）', () => {
    const { rows } = rollupDay(baseInput({ calendarExceptions: [{ date: DATE, kind: 'closed' }] }))
    expect(valueAt(rows, 'closed', 'total')).toBe(1)
  })

  it('営業日は closed=0 を書く（行があること自体が「集計済み」の印になる）', () => {
    const { rows } = rollupDay(baseInput())
    expect(valueAt(rows, 'closed', 'total')).toBe(0)
  })

  it('reservations は status が cancelled と no_show の予約を数えない', () => {
    const { rows } = rollupDay(
      baseInput({
        reservations: [
          reservation({ id: 'r-1', status: 'done' }),
          reservation({ id: 'r-2', status: 'confirmed' }),
          reservation({ id: 'r-3', status: 'cancelled', cancelReason: 'customer' }),
          reservation({ id: 'r-4', status: 'no_show', cancelReason: 'no_show' }),
        ],
      }),
    )
    expect(valueAt(rows, 'reservations', 'total')).toBe(2)
  })

  it('reservations_received は created_at の JST 暦日で数える', () => {
    const { rows } = rollupDay(
      baseInput({
        reservations: [
          // 来店は当日、受付は前日 → 来店日では数え、受付日では数えない。
          reservation({ id: 'r-1', createdAt: jst('2026-08-26', '18:00') }),
          // 来店は先の日、受付が当日 → 受付日でだけ数える。
          reservation({
            id: 'r-2',
            startsAt: jst('2026-09-10', '11:00'),
            createdAt: jst(DATE, '10:00'),
          }),
        ],
      }),
    )
    expect(valueAt(rows, 'reservations', 'total')).toBe(1)
    expect(valueAt(rows, 'reservations_received', 'total')).toBe(1)
  })

  it('reservations_received も取消・無断の予約を数えない（来店日と同じ数え方）', () => {
    const { rows } = rollupDay(
      baseInput({
        reservations: [
          reservation({
            id: 'r-1',
            startsAt: jst('2026-09-10', '11:00'),
            createdAt: jst(DATE, '10:00'),
          }),
          reservation({
            id: 'r-2',
            startsAt: jst('2026-09-10', '11:00'),
            createdAt: jst(DATE, '10:30'),
            status: 'cancelled',
            cancelReason: 'customer',
          }),
          reservation({
            id: 'r-3',
            startsAt: jst('2026-09-10', '11:00'),
            createdAt: jst(DATE, '10:40'),
            status: 'no_show',
          }),
        ],
      }),
    )
    // 受付日でも「予約数」は取消を含まない（含めると取消率の分母と二重に数える）。
    expect(valueAt(rows, 'reservations_received', 'total')).toBe(1)
  })

  it('receptions は予約の受付とウォークインの両方を数える', () => {
    const { rows } = rollupDay(
      baseInput({
        reservations: [reservation({ id: 'r-1' })],
        walkIns: [{ id: 'w-1', reservationId: 'r-9', arrivedAt: jst(DATE, '14:20') }],
        visitEvents: [
          {
            subjectType: 'reservation',
            subjectId: 'r-1',
            stage: 'received',
            occurredAt: jst(DATE, '10:55'),
            staffId: 's-1',
          },
          {
            subjectType: 'walkin',
            subjectId: 'w-1',
            stage: 'received',
            occurredAt: jst(DATE, '14:20'),
            staffId: 's-1',
          },
        ],
      }),
    )
    expect(valueAt(rows, 'receptions', 'total')).toBe(2)
  })

  it('receptions は dimension=staff / hour / total の 3 通りを書く', () => {
    const { rows } = rollupDay(
      baseInput({
        reservations: [reservation({ id: 'r-1' })],
        reservationAssignments: [{ reservationId: 'r-1', kind: 'staff', targetId: 's-1' }],
        walkIns: [{ id: 'w-1', reservationId: 'r-9', arrivedAt: jst(DATE, '14:20') }],
        visitEvents: [
          {
            subjectType: 'reservation',
            subjectId: 'r-1',
            stage: 'received',
            occurredAt: jst(DATE, '10:55'),
            staffId: 's-1',
          },
          {
            subjectType: 'walkin',
            subjectId: 'w-1',
            stage: 'received',
            occurredAt: jst(DATE, '14:20'),
            staffId: null,
          },
        ],
      }),
    )
    expect(valueAt(rows, 'receptions', 'staff', 's-1')).toBe(1)
    expect(valueAt(rows, 'receptions', 'staff', 'unassigned')).toBe(1)
    // 時間帯はゼロ埋めしない。
    expect(valueAt(rows, 'receptions', 'hour', '10')).toBe(1)
    expect(valueAt(rows, 'receptions', 'hour', '14')).toBe(1)
    expect(pick(rows, 'receptions', 'total')).toHaveLength(1)
  })

  it('cancellations を 5 層へ排他に割る（no_show → web → customer → store → duplicate の順で当てる）', () => {
    const { rows, dropped } = rollupDay(
      baseInput({
        reservations: [
          reservation({ id: 'r-1', status: 'no_show', cancelReason: 'no_show' }),
          // web の取消は cancel_reason='customer' でも web 層へ寄せる（先に当たる）。
          reservation({ id: 'r-2', status: 'cancelled', source: 'web', cancelReason: 'customer' }),
          reservation({ id: 'r-3', status: 'cancelled', cancelReason: 'customer' }),
          reservation({ id: 'r-4', status: 'cancelled', cancelReason: 'store' }),
          reservation({ id: 'r-5', status: 'cancelled', cancelReason: 'duplicate' }),
          // どれにも当たらない壊れた行は customer に寄せず、落として数える。
          reservation({ id: 'r-6', status: 'cancelled', cancelReason: null }),
        ],
      }),
    )
    expect(valueAt(rows, 'cancellations', 'cancel_reason', 'no_show')).toBe(1)
    expect(valueAt(rows, 'cancellations', 'cancel_reason', 'web')).toBe(1)
    expect(valueAt(rows, 'cancellations', 'cancel_reason', 'customer')).toBe(1)
    expect(valueAt(rows, 'cancellations', 'cancel_reason', 'store')).toBe(1)
    expect(valueAt(rows, 'cancellations', 'cancel_reason', 'duplicate')).toBe(1)
    expect(pick(rows, 'cancellations', 'cancel_reason')).toHaveLength(5)
    // 層の合計はその日の取消件数と一致する。
    expect(valueAt(rows, 'cancellations', 'total')).toBe(5)
    expect(dropped).toBe(1)
  })

  it('no_shows の total は cancellations の no_show 層と必ず一致する', () => {
    const { rows } = rollupDay(
      baseInput({
        reservations: [
          reservation({ id: 'r-1', status: 'no_show', cancelReason: 'no_show' }),
          reservation({ id: 'r-2', status: 'no_show', cancelReason: null }),
        ],
      }),
    )
    expect(valueAt(rows, 'no_shows', 'total')).toBe(2)
    expect(valueAt(rows, 'cancellations', 'cancel_reason', 'no_show')).toBe(2)
  })

  it('wait_seconds_median は received から最初の consulting までの差で、consulting が無い人を数えない', () => {
    const { rows } = rollupDay(
      baseInput({
        walkIns: [
          { id: 'w-1', reservationId: 'r-1', arrivedAt: jst(DATE, '10:00') },
          { id: 'w-2', reservationId: 'r-2', arrivedAt: jst(DATE, '10:10') },
          { id: 'w-3', reservationId: 'r-3', arrivedAt: jst(DATE, '10:20') },
        ],
        visitEvents: [
          {
            subjectType: 'walkin',
            subjectId: 'w-1',
            stage: 'received',
            occurredAt: jst(DATE, '10:00'),
            staffId: null,
          },
          {
            subjectType: 'walkin',
            subjectId: 'w-1',
            stage: 'consulting',
            occurredAt: jst(DATE, '10:05'),
            staffId: null,
          },
          // 2 度目の consulting は最初の 1 つだけを見る。
          {
            subjectType: 'walkin',
            subjectId: 'w-1',
            stage: 'consulting',
            occurredAt: jst(DATE, '10:40'),
            staffId: null,
          },
          {
            subjectType: 'walkin',
            subjectId: 'w-2',
            stage: 'received',
            occurredAt: jst(DATE, '10:10'),
            staffId: null,
          },
          {
            subjectType: 'walkin',
            subjectId: 'w-2',
            stage: 'consulting',
            occurredAt: jst(DATE, '10:18'),
            staffId: null,
          },
          // w-3 は consulting へ進んでいない → 標本に入れない。
          {
            subjectType: 'walkin',
            subjectId: 'w-3',
            stage: 'received',
            occurredAt: jst(DATE, '10:20'),
            staffId: null,
          },
        ],
      }),
    )
    expect(valueAt(rows, 'wait_seconds_median', 'total')).toBe(390)
  })

  it('wait_seconds_median は中央値であって平均ではない（外れ値 1 件で動かない）', () => {
    const events = (id: string, receivedAt: string, consultingAt: string) => [
      {
        subjectType: 'walkin',
        subjectId: id,
        stage: 'received',
        occurredAt: receivedAt,
        staffId: null,
      },
      {
        subjectType: 'walkin',
        subjectId: id,
        stage: 'consulting',
        occurredAt: consultingAt,
        staffId: null,
      },
    ]
    const { rows } = rollupDay(
      baseInput({
        walkIns: [
          { id: 'w-1', reservationId: 'r-1', arrivedAt: jst(DATE, '10:00') },
          { id: 'w-2', reservationId: 'r-2', arrivedAt: jst(DATE, '10:00') },
          { id: 'w-3', reservationId: 'r-3', arrivedAt: jst(DATE, '10:00') },
        ],
        visitEvents: [
          ...events('w-1', jst(DATE, '10:00'), jst(DATE, '10:05')),
          ...events('w-2', jst(DATE, '10:00'), jst(DATE, '10:06')),
          ...events('w-3', jst(DATE, '10:00'), jst(DATE, '12:00')),
        ],
      }),
    )
    expect(valueAt(rows, 'wait_seconds_median', 'total')).toBe(360)
  })

  it('wait_seconds_median は dimension=hour（受付した時間帯）にも書く', () => {
    const events = (id: string, receivedAt: string, consultingAt: string) => [
      {
        subjectType: 'walkin',
        subjectId: id,
        stage: 'received',
        occurredAt: receivedAt,
        staffId: null,
      },
      {
        subjectType: 'walkin',
        subjectId: id,
        stage: 'consulting',
        occurredAt: consultingAt,
        staffId: null,
      },
    ]
    const { rows } = rollupDay(
      baseInput({
        walkIns: [
          { id: 'w-1', reservationId: 'r-1', arrivedAt: jst(DATE, '10:00') },
          { id: 'w-2', reservationId: 'r-2', arrivedAt: jst(DATE, '14:00') },
        ],
        visitEvents: [
          ...events('w-1', jst(DATE, '10:00'), jst(DATE, '10:05')),
          ...events('w-2', jst(DATE, '14:00'), jst(DATE, '14:10')),
        ],
      }),
    )
    expect(valueAt(rows, 'wait_seconds_median', 'hour', '10')).toBe(300)
    expect(valueAt(rows, 'wait_seconds_median', 'hour', '14')).toBe(600)
  })

  it('revisits_90d は「その日の来店客のうち 90 日以内に再来した人数」を担当ごとに書く', () => {
    const { rows } = rollupDay(
      baseInput({
        reservations: [
          reservation({ id: 'r-1', customerId: 'c-1' }),
          reservation({ id: 'r-2', customerId: 'c-2' }),
        ],
        reservationAssignments: [
          { reservationId: 'r-1', kind: 'staff', targetId: 's-1' },
          { reservationId: 'r-2', kind: 'staff', targetId: 's-1' },
        ],
        visitEvents: [
          {
            subjectType: 'reservation',
            subjectId: 'r-1',
            stage: 'received',
            occurredAt: jst(DATE, '11:00'),
            staffId: 's-1',
          },
          {
            subjectType: 'reservation',
            subjectId: 'r-2',
            stage: 'received',
            occurredAt: jst(DATE, '13:00'),
            staffId: 's-1',
          },
        ],
        laterVisits: [
          // 90 日ちょうどは数える。
          { customerId: 'c-1', date: '2026-11-25' },
          // 91 日目は数えない。
          { customerId: 'c-2', date: '2026-11-26' },
        ],
      }),
    )
    expect(valueAt(rows, 'revisits_90d', 'staff', 's-1')).toBe(1)
    expect(valueAt(rows, 'revisits_90d', 'total')).toBe(1)
  })

  it('guests の行を 1 つも作らない', () => {
    const { rows } = rollupDay(
      baseInput({
        reservations: [reservation({ id: 'r-1' })],
        walkIns: [{ id: 'w-1', reservationId: 'r-9', arrivedAt: jst(DATE, '14:20') }],
        visitEvents: [
          {
            subjectType: 'walkin',
            subjectId: 'w-1',
            stage: 'received',
            occurredAt: jst(DATE, '14:20'),
            staffId: null,
          },
        ],
      }),
    )
    expect(rows.some((row) => String(row.metric) === 'guests')).toBe(false)
    expect(JSON.stringify(rows)).not.toContain('名')
  })

  it('1 件も無い日でも closed の行だけは書く（欠測にしない）', () => {
    const { rows } = rollupDay(baseInput())
    expect(rows.some((row) => row.metric === 'closed')).toBe(true)
    expect(rows.every((row) => row.date === DATE && row.organizationId === ORG)).toBe(true)
  })

  it('reservations は total / staff / purpose / hour / source を書く', () => {
    const { rows } = rollupDay(
      baseInput({
        reservations: [reservation({ id: 'r-1', source: 'web' })],
        reservationAssignments: [{ reservationId: 'r-1', kind: 'staff', targetId: 's-1' }],
        reservationPurposes: [{ reservationId: 'r-1', purposeId: 'p-1' }],
      }),
    )
    expect(valueAt(rows, 'reservations', 'total')).toBe(1)
    expect(valueAt(rows, 'reservations', 'staff', 's-1')).toBe(1)
    expect(valueAt(rows, 'reservations', 'purpose', 'p-1')).toBe(1)
    expect(valueAt(rows, 'reservations', 'hour', '11')).toBe(1)
    expect(valueAt(rows, 'reservations', 'source', 'web')).toBe(1)
  })
})
