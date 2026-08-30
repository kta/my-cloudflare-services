/**
 * ご予約を受けるときの「ちょうど」と「+1 秒」を固定する。
 *
 * 仮の押さえ（420 秒）・冪等（24 時間）・刻みの端・JST の日跨ぎは、どれも
 * 1 秒ずれても接客の途中で静かに壊れる。**時刻はすべて引数で受ける** —
 * `isHoldAlive(hold, now)` / `holdWarning(hold, now)` / `beginIdempotency(..., now)` /
 * `evaluateSlot(input, startsAt)` のどれもが `Date.now()` を呼ばない。
 * このファイルにも `Date.now()` を 1 度も書かない。
 *
 * 基準時刻は世界観データの **2026年8月27日（木）11:08 JST**。
 * 押さえの基準はモック BOOK-05-CONFIRM の statusbar `11:11` と
 * 「仮の押さえ → 11:18 まで」の差（＝ 420 秒）に合わせる。
 */
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  type AvailabilityInput,
  evaluateSlot,
  expandToSlotStarts,
  jstDayRange,
  overlapsJstDay,
} from '../src/worker/domain/availability'
import {
  beginIdempotency,
  idempotencyExpiresAt,
  idempotencyKey,
  isIdempotencyFresh,
  requestHash,
  reservationCodeMonth,
} from '../src/worker/domain/booking'
import {
  HOLD_RENEW_MAX,
  HOLD_TTL_SECONDS,
  HOLD_WARNING_SECONDS,
  type HoldEntry,
  holdOccupancies,
  holdRemainingSeconds,
  holdWarning,
  isHoldAlive,
  renewHold,
} from '../src/worker/domain/holds'
import type { WeeklyHours } from '../src/worker/domain/store-settings'
import { FIXED_NOW, jstAt } from './helpers'

/* --- 盤面 ---------------------------------------------------------------- */

/** モックが描いている木曜日。10:00–19:00 で開いている。 */
const THURSDAY = '2026-08-27'
const SATO = 'staff-sato'
const at = (time: string) => jstAt(THURSDAY, time)

/** 7 曜日ぶん 10:00–19:00。定休を置かない（刻みの端だけを見たいので）。 */
const OPEN_WEEK: WeeklyHours[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  isClosed: false,
  opensAt: '10:00',
  closesAt: '19:00',
}))

/**
 * 佐藤 美咲 が 1 人だけ 10:00–19:00 で勤務している盤面。
 * 同時に持てるご予約は 1 件なので、押さえが 1 本でも当たれば枠が閉じる。
 */
function board(over: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    date: THURSDAY,
    now: new Date(FIXED_NOW),
    slotRules: { slotMinutes: 30, cleanupMinutes: 0, maxParallel: 3 },
    weeklyHours: OPEN_WEEK,
    durationMinutes: 60,
    staff: [
      { id: SATO, displayName: '佐藤 美咲', skills: [], maxParallelReservations: 1, sortOrder: 0 },
    ],
    shifts: [{ staffId: SATO, date: THURSDAY, startsAt: '10:00', endsAt: '19:00', kind: 'work' }],
    ...over,
  }
}

/* --- 仮の押さえ ---------------------------------------------------------- */

/** 押さえた瞬間（JST 11:11）。 */
const HELD_AT = new Date(jstAt(THURSDAY, '11:11'))
/** 420 秒後（JST 11:18）。モックの「仮の押さえ → 11:18 まで」そのもの。 */
const EXPIRES_AT = jstAt(THURSDAY, '11:18')
/** `HELD_AT` から `seconds` 秒あとの時刻。 */
const after = (seconds: number) => new Date(HELD_AT.getTime() + seconds * 1000)

/** 佐藤 美咲 の 11:00–12:00 を押さえた 1 本（設備は決めていない）。 */
const heldSlot: HoldEntry = {
  id: 'hold-1',
  staffId: SATO,
  equipmentIds: [],
  startsAt: at('11:00'),
  endsAt: at('12:00'),
  expiresAt: EXPIRES_AT,
  receptionSessionId: 'reception-1',
}

describe('仮の押さえ', () => {
  it('420 秒ちょうどではまだ押さえている', () => {
    expect(HOLD_TTL_SECONDS).toBe(420)
    expect(isHoldAlive(heldSlot, after(HOLD_TTL_SECONDS))).toBe(true)
    expect(holdRemainingSeconds(heldSlot, after(HOLD_TTL_SECONDS))).toBe(0)

    // ほかの端末から見ると、この 420 秒目までは 11:00 が塞がっている。
    const holds = holdOccupancies([heldSlot], after(HOLD_TTL_SECONDS))
    expect(holds).toHaveLength(1)
    const slot = evaluateSlot(board({ holds }), at('11:00'))
    expect(slot.isAvailable).toBe(false)
    expect(slot.reason).toBe('staff_busy')
  })

  it('421 秒目には解放され、ほかの端末が同じ枠を取れる', () => {
    expect(isHoldAlive(heldSlot, after(HOLD_TTL_SECONDS + 1))).toBe(false)

    const holds = holdOccupancies([heldSlot], after(HOLD_TTL_SECONDS + 1))
    expect(holds).toEqual([])
    expect(evaluateSlot(board({ holds }), at('11:00')).isAvailable).toBe(true)
  })

  it('残り 60 秒ちょうどで警告を出し、61 秒では出さない', () => {
    expect(HOLD_WARNING_SECONDS).toBe(60)

    const warnAt = after(HOLD_TTL_SECONDS - HOLD_WARNING_SECONDS)
    expect(holdRemainingSeconds(heldSlot, warnAt)).toBe(60)
    expect(holdWarning(heldSlot, warnAt)).toBe(true)

    const quietAt = after(HOLD_TTL_SECONDS - HOLD_WARNING_SECONDS - 1)
    expect(holdRemainingSeconds(heldSlot, quietAt)).toBe(61)
    expect(holdWarning(heldSlot, quietAt)).toBe(false)

    // 切れたあとは警告ではない（「まだ入力中です」を押しても取り直しにならない）。
    expect(holdWarning(heldSlot, after(HOLD_TTL_SECONDS + 1))).toBe(false)
  })

  it('押さえ直すと残り時間が 420 秒に戻る', () => {
    // 「まだ入力中です」を押すのは残り 60 秒。そこから 420 秒へ戻る
    // （延長の API は作らない。`DELETE` → `POST` の 2 本でこの値になる）。
    const pressedAt = after(HOLD_TTL_SECONDS - HOLD_WARNING_SECONDS)
    const again = renewHold({ renewals: 0 }, pressedAt)
    if (!again.ok) throw new Error('1 回目の取り直しが断られた')

    expect(again).toEqual({
      ok: true,
      renewals: 1,
      expiresAt: new Date(pressedAt.getTime() + HOLD_TTL_SECONDS * 1000).toISOString(),
    })
    expect(holdRemainingSeconds({ expiresAt: again.expiresAt }, pressedAt)).toBe(420)

    // 取り直せるのは 10 回まで。11 回目は断る（無限に押さえ続けられない）。
    expect(HOLD_RENEW_MAX).toBe(10)
    expect(renewHold({ renewals: HOLD_RENEW_MAX - 1 }, pressedAt).ok).toBe(true)
    expect(renewHold({ renewals: HOLD_RENEW_MAX }, pressedAt)).toEqual({
      ok: false,
      error: 'renew_limit',
      renewals: HOLD_RENEW_MAX,
    })
  })
})

/* --- 冪等 ---------------------------------------------------------------- */

/** 再送で同じ本文が来たときの `request_hash` の元。 */
const BODY = { storeId: 'store-ginza', startsAt: at('11:00'), purposeIds: ['purpose-new'] }
/** 保存してある応答（`response_json`）。 */
const SAVED = { id: 'reservation-1', code: 'EY-2608-0142' }

/** `done` の行を 1 つ置く。作成は基準時刻、期限は 24 時間後。 */
async function insertDone(org: string, clientKey: string, createdAt: Date): Promise<string> {
  const key = idempotencyKey(org, 'reservation.create', clientKey)
  await env.DB.prepare(
    'INSERT INTO idempotency_records (key, organization_id, scope, request_hash, response_json, status, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)',
  )
    .bind(
      key,
      org,
      'reservation.create',
      await requestHash(BODY),
      JSON.stringify(SAVED),
      'done',
      createdAt.toISOString(),
      idempotencyExpiresAt(createdAt),
    )
    .run()
  return key
}

describe('冪等', () => {
  it('24 時間ちょうどの再送は保存した応答をそのまま返す', async () => {
    const org = `org-${crypto.randomUUID()}`
    const clientKey = crypto.randomUUID()
    const createdAt = new Date(FIXED_NOW)
    const key = await insertDone(org, clientKey, createdAt)

    const justInTime = new Date(Date.parse(idempotencyExpiresAt(createdAt)))
    expect(isIdempotencyFresh({ expiresAt: idempotencyExpiresAt(createdAt) }, justInTime)).toBe(
      true,
    )

    const answer = await beginIdempotency(env.DB, {
      organizationId: org,
      scope: 'reservation.create',
      clientKey,
      requestHash: await requestHash(BODY),
      now: justInTime,
    })

    // **再実行しない。**保存した応答をそのまま返す（`design/04-api.md` §6.2 の②）。
    expect(answer).toEqual({ state: 'replay', key, response: SAVED })
  })

  it('24 時間 +1 秒の再送は期限切れとして新しく実行する', async () => {
    const org = `org-${crypto.randomUUID()}`
    const clientKey = crypto.randomUUID()
    const createdAt = new Date(FIXED_NOW)
    const key = await insertDone(org, clientKey, createdAt)

    const tooLate = new Date(Date.parse(idempotencyExpiresAt(createdAt)) + 1000)
    expect(isIdempotencyFresh({ expiresAt: idempotencyExpiresAt(createdAt) }, tooLate)).toBe(false)

    const answer = await beginIdempotency(env.DB, {
      organizationId: org,
      scope: 'reservation.create',
      clientKey,
      requestHash: await requestHash(BODY),
      now: tooLate,
    })

    expect(answer).toEqual({ state: 'started', key })
    const row = await env.DB.prepare(
      'SELECT status, response_json AS responseJson, expires_at AS expiresAt FROM idempotency_records WHERE key = ?',
    )
      .bind(key)
      .first<{ status: string; responseJson: string | null; expiresAt: string }>()
    expect(row?.status).toBe('in_progress')
    expect(row?.responseJson).toBeNull()
    expect(row?.expiresAt).toBe(idempotencyExpiresAt(tooLate))
  })
})

/* --- 刻み ---------------------------------------------------------------- */

describe('刻み', () => {
  it('10:00 開始の枠は取れ、19:00 に終わる枠も取れる', () => {
    expect(evaluateSlot(board(), at('10:00')).isAvailable).toBe(true)

    // 18:00 + 60 分 = 19:00 ちょうど。閉店に接する枠は取れる。
    const last = evaluateSlot(board(), at('18:00'))
    expect(last.isAvailable).toBe(true)
    expect(last.endsAt).toBe(at('19:00'))
  })

  it('19:00 開始の枠は取れない', () => {
    const closed = evaluateSlot(board(), at('19:00'))
    expect(closed.isAvailable).toBe(false)
    expect(closed.reason).toBe('outside_hours')
  })

  it('片付け 10 分が終わる時刻ちょうどから次を取れ、その 1 秒前は取れない', () => {
    const rules = { slotMinutes: 30, cleanupMinutes: 10, maxParallel: 3 }
    const onGrid = at('10:20')
    const oneSecondLater = new Date(Date.parse(onGrid) + 1000).toISOString()
    const taken = (endsAt: string) => [
      {
        reservationId: 'r-1',
        kind: 'staff' as const,
        targetId: SATO,
        startsAt: at('10:00'),
        endsAt,
      },
    ]

    // 10:00–10:20 のご予約。片付け 10 分を足すと 10:30 ちょうどで空く。
    expect(
      expandToSlotStarts({
        startsAt: at('10:00'),
        endsAt: onGrid,
        cleanupMinutes: 10,
        slotMinutes: 30,
      }),
    ).toEqual([at('10:00')])
    expect(
      evaluateSlot(
        board({ slotRules: rules, durationMinutes: 30, occupied: taken(onGrid) }),
        at('10:30'),
      ).isAvailable,
    ).toBe(true)

    // 1 秒延びると片付けが 10:30:01 に終わり、10:30 の枠まで塞がる。
    expect(
      expandToSlotStarts({
        startsAt: at('10:00'),
        endsAt: oneSecondLater,
        cleanupMinutes: 10,
        slotMinutes: 30,
      }),
    ).toEqual([at('10:00'), at('10:30')])
    const blocked = evaluateSlot(
      board({ slotRules: rules, durationMinutes: 30, occupied: taken(oneSecondLater) }),
      at('10:30'),
    )
    expect(blocked.isAvailable).toBe(false)
    expect(blocked.reason).toBe('staff_busy')
  })
})

/* --- JST の日跨ぎ -------------------------------------------------------- */

describe('JST', () => {
  it('9月1日 00:30 JST の予約は 8月31日 の枠に混ざらない（UTC 15:00 の日跨ぎ）', () => {
    const startsAt = '2026-08-31T15:30:00.000Z' // JST 9月1日 00:30
    const endsAt = '2026-08-31T16:30:00.000Z' // JST 9月1日 01:30

    // 1 日は UTC 15:00 に始まって翌 UTC 15:00 に終わる。
    expect(jstDayRange('2026-08-31')).toEqual({
      fromIso: '2026-08-30T15:00:00.000Z',
      toIso: '2026-08-31T15:00:00.000Z',
    })
    expect(overlapsJstDay(startsAt, endsAt, '2026-08-31')).toBe(false)
    expect(overlapsJstDay(startsAt, endsAt, '2026-09-01')).toBe(true)

    // 採番の列も同じ境目で移る（`EY-2609-…`）。
    expect(reservationCodeMonth(new Date(startsAt))).toBe('2609')
    expect(reservationCodeMonth(new Date('2026-08-31T14:59:59.999Z'))).toBe('2608')
  })

  it('うるう年 2028年2月29日 の予約が 3月1日 に流れない', () => {
    const startsAt = '2028-02-29T14:30:00.000Z' // JST 2月29日 23:30
    const endsAt = '2028-02-29T14:59:00.000Z' // JST 2月29日 23:59

    expect(overlapsJstDay(startsAt, endsAt, '2028-02-29')).toBe(true)
    expect(overlapsJstDay(startsAt, endsAt, '2028-03-01')).toBe(false)
    expect(jstDayRange('2028-02-29')).toEqual({
      fromIso: '2028-02-28T15:00:00.000Z',
      toIso: '2028-02-29T15:00:00.000Z',
    })

    expect(reservationCodeMonth(new Date(startsAt))).toBe('2802')
    // JST 3月1日 00:00（UTC 2月29日 15:00）から 3 月の列になる。
    expect(reservationCodeMonth(new Date('2028-02-29T15:00:00.000Z'))).toBe('2803')
  })
})
