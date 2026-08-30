/**
 * 枠の一次排他を**実 D1** で縛る。
 *
 * 書く経路そのものは P3（`POST /api/staff/reservations`）だが、上限の数え方は
 * 空き枠エンジンと同じものなので、ここで決着させる。見るのは 1 点だけ —
 * **上限つきの条件付き INSERT が本当に上限で止まるか**である。
 *
 * 発火の有無は `meta.changes` の 1 / 0 で読む。**0 行の INSERT はバッチを止めない**
 * ので、戻り値を見ないと「409 を返しながら二重予約を作る」形になる。
 */
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  releaseSlotLocks,
  type SlotLockRequest,
  STORE_TARGET_KEY,
  slotLockRequests,
  slotLockStatements,
  UNASSIGNED_TARGET_KEY,
} from '../src/worker/db/slot-locks'
import { FIXED_NOW, insertSlotLock, jstAt, LEDGER_DATE, orgId } from './helpers'

const SLOT = jstAt(LEDGER_DATE, '11:00')

/** 1 予約ぶんの押さえを 1 回の `db.batch()` で試す。返すのは文ごとの `meta.changes`。 */
async function claim(input: {
  org: string
  storeId: string
  reservationId: string
  requests: readonly SlotLockRequest[]
  createdAt?: string
}): Promise<number[]> {
  const statements = slotLockStatements(env.DB, {
    organizationId: input.org,
    storeId: input.storeId,
    reservationId: input.reservationId,
    createdAt: input.createdAt ?? FIXED_NOW,
    requests: input.requests,
  })
  const results = await env.DB.batch(statements)
  return results.map((result) => result.meta.changes ?? 0)
}

async function countLocks(org: string, reservationId?: string): Promise<number> {
  const row =
    reservationId === undefined
      ? await env.DB.prepare(
          'SELECT COUNT(*) AS n FROM reservation_slot_locks WHERE organization_id = ?',
        )
          .bind(org)
          .first<{ n: number }>()
      : await env.DB.prepare(
          'SELECT COUNT(*) AS n FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ?',
        )
          .bind(org, reservationId)
          .first<{ n: number }>()
  return row?.n ?? 0
}

const staffSlot = (targetKey: string, cap: number): SlotLockRequest => ({
  kind: 'staff',
  targetKey,
  slotStart: SLOT,
  cap,
})

describe('上限つきの条件付き INSERT', () => {
  it('上限 1 のレーンは 1 本目が入り、2 本目は meta.changes が 0 になる', async () => {
    const org = orgId()
    const storeId = crypto.randomUUID()
    const target = crypto.randomUUID()

    const first = await claim({
      org,
      storeId,
      reservationId: crypto.randomUUID(),
      requests: [staffSlot(target, 1)],
    })
    const second = await claim({
      org,
      storeId,
      reservationId: crypto.randomUUID(),
      requests: [staffSlot(target, 1)],
    })

    expect(first).toEqual([1])
    expect(second).toEqual([0])
    expect(await countLocks(org)).toBe(1)
  })

  it('上限 3 のレーンは 3 本目まで入り、4 本目で meta.changes が 0 になる', async () => {
    const org = orgId()
    const storeId = crypto.randomUUID()
    const target = crypto.randomUUID()

    const changes: number[] = []
    for (let n = 0; n < 4; n++) {
      const [change] = await claim({
        org,
        storeId,
        reservationId: crypto.randomUUID(),
        requests: [staffSlot(target, 3)],
      })
      changes.push(change ?? 0)
    }

    expect(changes).toEqual([1, 1, 1, 0])
    expect(await countLocks(org)).toBe(3)
  })

  it('target_key=unassigned のレーンは store_slot_rules.max_parallel（3）まで取れる', async () => {
    const org = orgId()
    const storeId = crypto.randomUUID()

    const changes: number[] = []
    for (let n = 0; n < 4; n++) {
      const [change] = await claim({
        org,
        storeId,
        reservationId: crypto.randomUUID(),
        requests: [staffSlot(UNASSIGNED_TARGET_KEY, 3)],
      })
      changes.push(change ?? 0)
    }

    // 同じ 30 分枠に続けてお越しになった 2 人目・3 人目も受け付けられる。
    expect(changes).toEqual([1, 1, 1, 0])
  })

  it('equipment.capacity=2 の設備は同じ枠で 2 件まで取れる', async () => {
    const org = orgId()
    const storeId = crypto.randomUUID()
    const unit = crypto.randomUUID()
    const request = (): SlotLockRequest[] => [
      { kind: 'equipment', targetKey: unit, slotStart: SLOT, cap: 2 },
    ]

    const changes: number[] = []
    for (let n = 0; n < 3; n++) {
      const [change] = await claim({
        org,
        storeId,
        reservationId: crypto.randomUUID(),
        requests: request(),
      })
      changes.push(change ?? 0)
    }
    expect(changes).toEqual([1, 1, 0])
  })

  it('staff.max_parallel_reservations=1 の担当は同じ枠で 1 件しか取れない', async () => {
    const org = orgId()
    const storeId = crypto.randomUUID()
    const staffId = crypto.randomUUID()

    const first = await claim({
      org,
      storeId,
      reservationId: crypto.randomUUID(),
      requests: [staffSlot(staffId, 1)],
    })
    const second = await claim({
      org,
      storeId,
      reservationId: crypto.randomUUID(),
      requests: [staffSlot(staffId, 1)],
    })
    expect(first).toEqual([1])
    expect(second).toEqual([0])
  })

  it('要求する枠が 1 つでも埋まっていれば、どの文も 1 行も入れない', async () => {
    const org = orgId()
    const storeId = crypto.randomUUID()
    const staffId = crypto.randomUUID()
    const unit = crypto.randomUUID()
    const later = jstAt(LEDGER_DATE, '11:30')

    // 11:30 の設備だけを先に埋める。
    await claim({
      org,
      storeId,
      reservationId: crypto.randomUUID(),
      requests: [{ kind: 'equipment', targetKey: unit, slotStart: later, cap: 1 }],
    })

    const reservationId = crypto.randomUUID()
    const changes = await claim({
      org,
      storeId,
      reservationId,
      requests: [
        staffSlot(staffId, 1),
        { kind: 'equipment', targetKey: unit, slotStart: SLOT, cap: 1 },
        { kind: 'equipment', targetKey: unit, slotStart: later, cap: 1 },
      ],
    })

    // 3 本すべてが入るか 1 本も入らないかのどちらかである。
    expect(changes).toEqual([0, 0, 0])
    expect(await countLocks(org, reservationId)).toBe(0)
  })

  it('同時に 2 本走っても、上限 1 のレーンは片方だけが通る', async () => {
    const org = orgId()
    const storeId = crypto.randomUUID()
    const target = crypto.randomUUID()

    const [a, b] = await Promise.all([
      claim({
        org,
        storeId,
        reservationId: crypto.randomUUID(),
        requests: [staffSlot(target, 1)],
      }),
      claim({
        org,
        storeId,
        reservationId: crypto.randomUUID(),
        requests: [staffSlot(target, 1)],
      }),
    ])

    expect([...(a ?? []), ...(b ?? [])].filter((change) => change === 1)).toHaveLength(1)
    expect(await countLocks(org)).toBe(1)
  })

  it('自分の予約 id の行は上限の数に入れない（同じバッチを二度流しても止まらない）', async () => {
    const org = orgId()
    const storeId = crypto.randomUUID()
    const target = crypto.randomUUID()
    const reservationId = crypto.randomUUID()

    const first = await claim({ org, storeId, reservationId, requests: [staffSlot(target, 1)] })
    // 変更は「新しい枠を取ってから古い枠を返す」順に書く。自分の古い行が上限に
    // 数えられると、日時を動かさない変更が自分自身に当たって 409 になる。
    const again = await claim({
      org,
      storeId,
      reservationId,
      requests: [staffSlot(target, 1)],
      createdAt: '2026-08-27T02:30:00.000Z',
    })

    expect(first).toEqual([1])
    expect(again).toEqual([1])
    expect(await countLocks(org, reservationId)).toBe(2)
  })

  it('別テナントの行は上限の数に入れない', async () => {
    const [a, b] = [orgId(), orgId()]
    const storeId = crypto.randomUUID()
    const target = crypto.randomUUID()

    const mine = await claim({
      org: a,
      storeId,
      reservationId: crypto.randomUUID(),
      requests: [staffSlot(target, 1)],
    })
    const theirs = await claim({
      org: b,
      storeId,
      reservationId: crypto.randomUUID(),
      requests: [staffSlot(target, 1)],
    })

    expect(mine).toEqual([1])
    expect(theirs).toEqual([1])
  })

  it('別店舗の行は上限の数に入れない', async () => {
    const org = orgId()
    const target = crypto.randomUUID()

    const first = await claim({
      org,
      storeId: crypto.randomUUID(),
      reservationId: crypto.randomUUID(),
      requests: [staffSlot(target, 1)],
    })
    const second = await claim({
      org,
      storeId: crypto.randomUUID(),
      reservationId: crypto.randomUUID(),
      requests: [staffSlot(target, 1)],
    })
    expect(first).toEqual([1])
    expect(second).toEqual([1])
  })

  it('(organization_id, store_id, kind, target_key, slot_start) に一意制約が張られていない', async () => {
    const org = orgId()
    const storeId = crypto.randomUUID()
    const target = crypto.randomUUID()

    // 一意 index があると、ここで UNIQUE constraint failed になる。
    await insertSlotLock(org, {
      storeId,
      reservationId: crypto.randomUUID(),
      kind: 'staff',
      targetKey: target,
      slotStart: SLOT,
    })
    await expect(
      insertSlotLock(org, {
        storeId,
        reservationId: crypto.randomUUID(),
        kind: 'staff',
        targetKey: target,
        slotStart: SLOT,
      }),
    ).resolves.toBeUndefined()
    expect(await countLocks(org)).toBe(2)
  })

  it('予約 id で一括 DELETE すると、その予約の行だけが消える', async () => {
    const org = orgId()
    const storeId = crypto.randomUUID()
    const mine = crypto.randomUUID()
    const theirs = crypto.randomUUID()

    await claim({
      org,
      storeId,
      reservationId: mine,
      requests: [
        staffSlot(crypto.randomUUID(), 1),
        { kind: 'equipment', targetKey: crypto.randomUUID(), slotStart: SLOT, cap: 1 },
      ],
    })
    await claim({
      org,
      storeId,
      reservationId: theirs,
      requests: [staffSlot(crypto.randomUUID(), 1)],
    })

    await env.DB.batch([releaseSlotLocks(env.DB, { organizationId: org, reservationId: mine })])

    expect(await countLocks(org, mine)).toBe(0)
    expect(await countLocks(org, theirs)).toBe(1)
  })

  it('変更の古い行だけを返すときは、このバッチで入れた行を残す', async () => {
    const org = orgId()
    const storeId = crypto.randomUUID()
    const reservationId = crypto.randomUUID()
    const fresh = '2026-08-27T02:30:00.000Z'

    await claim({ org, storeId, reservationId, requests: [staffSlot(crypto.randomUUID(), 1)] })
    await claim({
      org,
      storeId,
      reservationId,
      requests: [staffSlot(crypto.randomUUID(), 1)],
      createdAt: fresh,
    })
    await env.DB.batch([
      releaseSlotLocks(env.DB, {
        organizationId: org,
        reservationId,
        exceptCreatedAt: fresh,
      }),
    ])

    const rows = await env.DB.prepare(
      'SELECT created_at AS createdAt FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ?',
    )
      .bind(org, reservationId)
      .all<{ createdAt: string }>()
    expect(rows.results.map((row) => row.createdAt)).toEqual([fresh])
  })

  it('押さえる枠が 0 本なら文を 1 つも作らない', () => {
    expect(
      slotLockStatements(env.DB, {
        organizationId: orgId(),
        storeId: crypto.randomUUID(),
        reservationId: crypto.randomUUID(),
        createdAt: FIXED_NOW,
        requests: [],
      }),
    ).toEqual([])
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 店舗まるごとのレーン（同時受付上限）
 * 担当ごとのレーンだけでは `target_key` が違う予約どうしが数え合わず、
 * 上限 3 件の店の同じ枠に 4 件が入る。空き枠エンジンは同じ盤面を `max_parallel` で
 * 断るので、このレーンが無いと「表示は満席・DB は通す」で判定が食い違う。
 * ─────────────────────────────────────────────────────────────────────────── */

describe('店舗まるごとの同時受付上限', () => {
  const MAX_PARALLEL = 3

  it('1 予約ぶんの押さえは 1 枠につき「店舗 1 ＋ 担当 1 ＋ 設備 n」になる', () => {
    const requests = slotLockRequests({
      slotStarts: [SLOT],
      staff: { id: 'staff-1', maxParallelReservations: 1 },
      equipment: [{ id: 'eq-1', capacity: 2 }],
      maxParallel: MAX_PARALLEL,
    })
    expect(requests).toEqual([
      { kind: 'store', targetKey: STORE_TARGET_KEY, slotStart: SLOT, cap: MAX_PARALLEL },
      { kind: 'staff', targetKey: 'staff-1', slotStart: SLOT, cap: 1 },
      { kind: 'equipment', targetKey: 'eq-1', slotStart: SLOT, cap: 2 },
    ])
  })

  it('担当が未定でも店舗のレーンは入る（未定のレーンと 2 本になる）', () => {
    const requests = slotLockRequests({
      slotStarts: [SLOT],
      staff: null,
      maxParallel: MAX_PARALLEL,
    })
    expect(requests.map((request) => request.targetKey)).toEqual([
      STORE_TARGET_KEY,
      UNASSIGNED_TARGET_KEY,
    ])
  })

  it('担当が 4 人とも違っても、4 件目は同時受付上限で止まる', async () => {
    const org = orgId()
    const storeId = crypto.randomUUID()

    const changes: number[] = []
    for (let n = 0; n < 4; n++) {
      const [change] = await claim({
        org,
        storeId,
        reservationId: crypto.randomUUID(),
        // 担当はそれぞれ別人。担当のレーンだけなら 4 件とも入ってしまう。
        requests: slotLockRequests({
          slotStarts: [SLOT],
          staff: { id: crypto.randomUUID(), maxParallelReservations: 1 },
          maxParallel: MAX_PARALLEL,
        }),
      })
      changes.push(change ?? 0)
    }

    expect(changes).toEqual([1, 1, 1, 0])
    // 4 件目は店舗のレーンも担当のレーンも 1 行も入っていない（全か無か）。
    expect(await countLocks(org)).toBe(MAX_PARALLEL * 2)
  })

  it('担当ありと担当未定が混ざっても、同じ枠の合計が上限を越えない', async () => {
    const org = orgId()
    const storeId = crypto.randomUUID()

    const changes: number[] = []
    for (let n = 0; n < 4; n++) {
      const [change] = await claim({
        org,
        storeId,
        reservationId: crypto.randomUUID(),
        requests: slotLockRequests({
          slotStarts: [SLOT],
          staff: n % 2 === 0 ? null : { id: crypto.randomUUID(), maxParallelReservations: 1 },
          maxParallel: MAX_PARALLEL,
        }),
      })
      changes.push(change ?? 0)
    }

    expect(changes).toEqual([1, 1, 1, 0])
  })
})
