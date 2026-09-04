/**
 * 変更の面が触る「時刻の境界」を、実時刻に依存させずに固める。
 *
 * **`Date.now()` を 1 度も呼ばない。**仮の押さえの残り時間も、期間の絞り込みも、
 * 期間を広げる案の幅も、すべて引数で受けた時刻と暦日から出す。押さえが切れる 420 秒と
 * JST の日跨ぎは店がいちばん静かに壊れるところなので、テストを回した日と時刻で
 * 答えが変わる書き方をしない。
 *
 * 期間は JST の暦日を UTC の**半開区間** `[from 00:00, to+1 日 00:00)` に直す。
 * 1 日は UTC 15:00 に始まって翌 UTC 15:00 に終わるので、JST 23:59 のご予約は当日に入り、
 * 翌 00:00 のご予約は入らない。
 */
import type { EquipmentKind, SkillCode } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  type AvailabilityInput,
  computeAvailability,
  type HoldOccupancy,
  type SlotResult,
} from '../src/worker/domain/availability'
import {
  HOLD_RENEW_MAX,
  HOLD_TTL_SECONDS,
  holdRemainingSeconds,
  holdWarning,
  isHoldAlive,
  renewHold,
} from '../src/worker/domain/holds'
import {
  filterReservations,
  type ReservationSearchInput,
  type ReservationSearchRow,
  relaxationsFor,
  resolveSearch,
} from '../src/worker/domain/reservation-search'

/* --- 仮の押さえ ----------------------------------------------------------- */

/** JST 2026年8月27日（木）11:11。押さえた瞬間。 */
const HELD_AT = new Date('2026-08-27T02:11:00.000Z')
/** 押さえた瞬間から 420 秒後（11:18）。 */
const HOLD = { expiresAt: new Date(HELD_AT.getTime() + HOLD_TTL_SECONDS * 1000).toISOString() }

/** 押さえた瞬間から `seconds` 秒後の時刻。 */
function after(seconds: number): Date {
  return new Date(HELD_AT.getTime() + seconds * 1000)
}

describe('仮の押さえ', () => {
  it('420 秒ちょうどでは、まだ有効である', () => {
    expect(isHoldAlive(HOLD, after(HOLD_TTL_SECONDS))).toBe(true)
    expect(holdRemainingSeconds(HOLD, after(HOLD_TTL_SECONDS))).toBe(0)
  })

  it('421 秒で失効し、その枠は空きとして数え直される', () => {
    expect(isHoldAlive(HOLD, after(HOLD_TTL_SECONDS + 1))).toBe(false)
  })

  it('残り 60 秒ちょうどで警告の合図が立つ', () => {
    expect(holdWarning(HOLD, after(HOLD_TTL_SECONDS - 60))).toBe(true)
  })

  it('残り 61 秒では警告の合図が立たない', () => {
    expect(holdWarning(HOLD, after(HOLD_TTL_SECONDS - 61))).toBe(false)
  })

  it('延ばすと期限が押した時刻から 420 秒になる', () => {
    const renewed = renewHold({ renewals: 0 }, after(360))
    expect(renewed).toEqual({
      ok: true,
      renewals: 1,
      expiresAt: '2026-08-27T02:24:00.000Z',
    })
  })

  it('延ばせるのは 10 回まで、11 回目は延びない', () => {
    expect(renewHold({ renewals: HOLD_RENEW_MAX - 1 }, after(360)).ok).toBe(true)
    expect(renewHold({ renewals: HOLD_RENEW_MAX }, after(360))).toEqual({
      ok: false,
      error: 'renew_limit',
      renewals: HOLD_RENEW_MAX,
    })
  })

  it('自分の受付が置いた押さえは自分の空き枠計算では塞がりに数えない', () => {
    const mine = hold('session-mine')
    const theirs = hold('session-other')
    expect(slotAt(computeAvailability(board({ holds: [theirs] })).slots, '11:00').isAvailable).toBe(
      false,
    )
    expect(
      slotAt(
        computeAvailability(board({ holds: [mine], excludeReceptionSessionId: 'session-mine' }))
          .slots,
        '11:00',
      ).isAvailable,
    ).toBe(true)
  })
})

/* --- 空き枠の盤面（押さえの除外を見るだけの最小面） ------------------------ */

const THURSDAY = '2026-08-27'
const MEASURE: SkillCode = 'measure'
const VISION: EquipmentKind = 'measure'

/** JST の壁時計を UTC の ISO へ。 */
function jst(time: string): string {
  return new Date(Date.parse(`${THURSDAY}T${time}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()
}

/** 11:00–12:00 を担当 1 名ぶん塞ぐ仮の押さえ。 */
function hold(receptionSessionId: string): HoldOccupancy {
  return {
    holdId: `hold-${receptionSessionId}`,
    receptionSessionId,
    kind: 'staff',
    targetId: 'staff-sato',
    startsAt: jst('11:00'),
    endsAt: jst('12:00'),
  }
}

function board(over: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    date: THURSDAY,
    now: HELD_AT,
    slotRules: { slotMinutes: 30, cleanupMinutes: 10, maxParallel: 3 },
    weeklyHours: [{ weekday: 4, isClosed: false, opensAt: '10:00', closesAt: '19:00' }],
    purposes: [{ id: 'purpose-new-glasses', durationMinutes: 60, requiredSkills: [MEASURE] }],
    staff: [
      {
        id: 'staff-sato',
        displayName: '佐藤 美咲',
        skills: [MEASURE],
        maxParallelReservations: 1,
      },
    ],
    shifts: [
      { staffId: 'staff-sato', date: THURSDAY, startsAt: '10:00', endsAt: '19:00', kind: 'work' },
    ],
    equipment: [{ id: 'eq-vision-a', name: '視力測定機 A', kind: VISION, capacity: 1 }],
    ...over,
  }
}

function slotAt(slots: readonly SlotResult[], time: string): SlotResult {
  const found = slots.find((slot) => slot.startsAt === jst(time))
  if (!found) throw new Error(`${time} の枠が無い`)
  return found
}

/* --- 期間の絞り込み ------------------------------------------------------- */

const ORG = 'org-eye'
const GINZA = 'store-ginza'

function query(from: string, to: string): ReservationSearchInput {
  return { organizationId: ORG, storeId: GINZA, from, to }
}

function at(id: string, startsAt: string): ReservationSearchRow {
  return {
    id,
    code: 'EY-2608-0142',
    storeId: GINZA,
    source: 'phone',
    status: 'confirmed',
    startsAt,
    durationMinutes: 60,
    customerName: '田中 花子',
    customerKana: 'たなか はなこ',
    phoneNormalized: '09012345678',
    phoneLast4: '5678',
    visitCount: 4,
    purposeLabel: 'メガネを新しく作る',
    staffName: '佐藤 美咲',
    staffIds: ['staff-sato'],
    webBookingCode: null,
  }
}

describe('期間の絞り込み', () => {
  it('JST の 8/27 は UTC の 8/26T15:00 から 8/27T15:00 未満で当たる', () => {
    expect(resolveSearch(query('2026-08-27', '2026-08-27')).range).toEqual({
      fromIso: '2026-08-26T15:00:00.000Z',
      toIso: '2026-08-27T15:00:00.000Z',
    })
  })

  it('JST の 23:59 のご予約は当日に入り、翌 00:00 のご予約は入らない', () => {
    const lastMinute = at('r-2359', '2026-08-27T14:59:00.000Z')
    const nextMidnight = at('r-0000', '2026-08-27T15:00:00.000Z')
    const found = filterReservations([lastMinute, nextMidnight], query('2026-08-27', '2026-08-27'))
    expect(found.map((reservation) => reservation.id)).toEqual(['r-2359'])
  })

  it('月をまたぐ 8/31〜9/1 の指定で両日のご予約が並ぶ', () => {
    const august = at('r-0831', '2026-08-31T01:00:00.000Z')
    const september = at('r-0901', '2026-09-01T01:00:00.000Z')
    const found = filterReservations([august, september], query('2026-08-31', '2026-09-01'))
    expect(found.map((reservation) => reservation.id)).toEqual(['r-0831', 'r-0901'])
  })

  it('年をまたぐ 12/31〜1/1 の指定で両日のご予約が並ぶ', () => {
    const lastDay = at('r-1231', '2026-12-31T01:00:00.000Z')
    const newYear = at('r-0101', '2027-01-01T01:00:00.000Z')
    const found = filterReservations([lastDay, newYear], query('2026-12-31', '2027-01-01'))
    expect(found.map((reservation) => reservation.id)).toEqual(['r-1231', 'r-0101'])
    expect(resolveSearch(query('2026-12-31', '2027-01-01')).range).toEqual({
      fromIso: '2026-12-30T15:00:00.000Z',
      toIso: '2027-01-01T15:00:00.000Z',
    })
  })

  it('うるう年の 2/29 を含む期間が 1 日ぶん欠けない', () => {
    const span = query('2028-02-28', '2028-03-01')
    expect(resolveSearch(span).range).toEqual({
      fromIso: '2028-02-27T15:00:00.000Z',
      toIso: '2028-03-01T15:00:00.000Z',
    })
    const rows = [
      at('r-0228', '2028-02-28T01:00:00.000Z'),
      at('r-0229', '2028-02-29T01:00:00.000Z'),
      at('r-0301', '2028-03-01T01:00:00.000Z'),
    ]
    expect(filterReservations(rows, span).map((reservation) => reservation.id)).toEqual([
      'r-0228',
      'r-0229',
      'r-0301',
    ])
  })
})

describe('緩和候補', () => {
  it('期間を広げる案は from の月初から to の翌月末までになる（8/27〜8/31 → 8/1〜9/30）', () => {
    const august = relaxationsFor({ from: '2026-08-27', to: '2026-08-31' }, { total: 0, period: 3 })
    expect(august[0]?.label).toBe('期間を 8月1日 〜 9月30日 に広げる')
    expect(august[0]?.query).toMatchObject({ from: '2026-08-01', to: '2026-09-30' })

    // 翌月末がうるう年の 2月29日 になる年も 1 日ぶん欠けない。
    const leap = relaxationsFor({ from: '2028-01-15', to: '2028-01-20' }, { total: 0, period: 2 })
    expect(leap[0]?.query).toMatchObject({ from: '2028-01-01', to: '2028-02-29' })
  })
})
