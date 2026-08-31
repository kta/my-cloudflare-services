/**
 * 予約の確定（`POST /api/staff/reservations`）。
 *
 * ここで見るのは「409 が返ること」ではなく **D1 の中身**である。確定は 1 バッチで、
 * 枠が取れたときだけ予約が書かれ、取れなかったときは 1 行も書かれない。D1 の
 * `db.batch()` は 0 行しか当たらない文を失敗と見なさずバッチを止めないので、
 * 「409 を返しながら二重予約を作る」形は status を見るだけのテストでは捕まらない。
 *
 * 組織 id は毎回 `orgId()` で作る（D1 はテストファイル内で共有される）。
 * 店舗・担当・設備・目的・営業時間は P1 / P2 のヘルパーで用意し、別の作り方を発明しない。
 */
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  authed,
  BASE,
  insertBusinessHours,
  insertEquipment,
  insertReservation,
  insertShift,
  insertSlotRules,
  insertStaff,
  insertStore,
  insertVisitPurpose,
  jstAt,
  LEDGER_DATE,
  orgId,
  tokenFor,
} from './helpers'

/** 世界観データの 1 日（木曜）。P2 のヘルパーと同じ日を使う。 */
const AT_11 = jstAt(LEDGER_DATE, '11:00')
const AT_13 = jstAt(LEDGER_DATE, '13:00')
const AT_16 = jstAt(LEDGER_DATE, '16:00')

/** 受け付けられる店舗ひとそろい。担当 1 名・設備 2 台・60 分のご用件。 */
async function bookingTenant(input: { maxParallelReservations?: number } = {}) {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await insertStore(org)
  await insertBusinessHours(org, storeId)
  await insertSlotRules(org, storeId, { slotMinutes: 30, cleanupMinutes: 10, maxParallel: 3 })
  const staffId = await insertStaff(org, storeId, {
    displayName: '佐藤 美咲',
    maxParallelReservations: input.maxParallelReservations ?? 1,
  })
  await insertShift(org, storeId, staffId)
  const purposeId = await insertVisitPurpose(org, storeId, {
    nameInternal: 'メガネを新しく作る',
    nameShort: '新調相談',
    durationMinutes: 60,
  })
  const equipmentA = await insertEquipment(org, storeId, { name: '視力測定機 A', sortOrder: 0 })
  const equipmentB = await insertEquipment(org, storeId, {
    name: '相談カウンター 1',
    kind: 'counter',
    roleLabel: '接客・ご相談',
    sortOrder: 1,
  })
  return { org, token, storeId, staffId, purposeId, equipmentA, equipmentB }
}

type ConfirmBody = {
  storeId: string
  startsAt: string
  purposeIds: string[]
  source: 'phone' | 'counter' | 'walkin' | 'web'
  staffId?: string | null
  equipmentIds?: string[]
  holdId?: string
  receptionSessionId?: string
  noteCustomer?: string
  customerId?: string
}

type ConfirmResponse = {
  id?: string
  code?: string
  error?: string
  alternatives?: { startsAt: string; endsAt: string }[]
  customerId?: string | null
  customerName?: string | null
  visitCount?: number | null
}

async function seedBookingCustomer(org: string): Promise<string> {
  const id = crypto.randomUUID()
  const now = jstAt(LEDGER_DATE, '09:00')
  await env.DB.prepare(
    'INSERT INTO customers (id, organization_id, customer_number, name, kana, phone, phone_normalized, phone_last4, email, birth_date, address, memo, first_visit_at, last_visit_at, visit_count, merged_into_id, version, created_store_id, created_terminal_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,NULL,NULL,2,NULL,1,NULL,NULL,?,?)',
  )
    .bind(
      id,
      org,
      `G-${crypto.randomUUID().slice(0, 8)}`,
      '田中 花子',
      'たなか はなこ',
      '090-1234-5678',
      '09012345678',
      '5678',
      '',
      now,
      now,
    )
    .run()
  return id
}

async function confirm(token: string, key: string, body: ConfirmBody) {
  const res = await SELF.fetch(`${BASE}/api/staff/reservations`, {
    method: 'POST',
    headers: { ...authed(token), 'idempotency-key': key },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as ConfirmResponse }
}

/** `idempotency_records` の行数。鍵を汚していないことを数で見る。 */
async function countIdempotency(org: string): Promise<number> {
  return (
    (
      await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM idempotency_records WHERE organization_id = ?',
      )
        .bind(org)
        .first<{ n: number }>()
    )?.n ?? 0
  )
}

/** 受付を 1 件始めて id を返す（押さえと確定が同じ受付を指すため）。 */
async function startSession(token: string, storeId: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/staff/reception-sessions`, {
    method: 'POST',
    headers: authed(token),
    body: JSON.stringify({ storeId }),
  })
  return String(((await res.json()) as { id: string }).id)
}

async function patchDraft(token: string, sessionId: string, draft: Record<string, unknown>) {
  return await SELF.fetch(`${BASE}/api/staff/reception-sessions/${sessionId}`, {
    method: 'PATCH',
    headers: authed(token),
    body: JSON.stringify({ draft }),
  })
}

async function postHold(token: string, body: Record<string, unknown>) {
  const res = await SELF.fetch(`${BASE}/api/staff/holds`, {
    method: 'POST',
    headers: authed(token),
    body: JSON.stringify(body),
  })
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as { id?: string; error?: string },
  }
}

/** その組織が KV に持っている押さえの鍵。確定のあとに残っていないことを見る。 */
async function holdKeys(org: string): Promise<string[]> {
  const listed = await env.SHORT_LIVED.list({ prefix: `hold:${org}:` })
  return listed.keys.map((key) => key.name)
}

/** その組織が書いた行の数。409 の経路で 1 行も増えていないことを 5 表で見る。 */
async function countRows(org: string) {
  const one = async (table: string) =>
    (
      await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE organization_id = ?`)
        .bind(org)
        .first<{ n: number }>()
    )?.n ?? 0
  return {
    reservations: await one('reservations'),
    purposes: await one('reservation_purposes'),
    assignments: await one('reservation_assignments'),
    audits: await one('audit_events'),
    locks: await one('reservation_slot_locks'),
  }
}

describe('予約の確定', () => {
  it('既存のお客様を予約と成功応答へ載せ、同じ鍵の再送でも同じ顧客情報を返す', async () => {
    const t = await bookingTenant()
    const customerId = await seedBookingCustomer(t.org)
    const key = crypto.randomUUID()
    const body: ConfirmBody = {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      source: 'phone',
      customerId,
    }

    const first = await confirm(t.token, key, body)
    const replay = await confirm(t.token, key, body)

    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ customerId, customerName: '田中 花子', visitCount: 2 })
    expect(replay.body).toMatchObject({ customerId, customerName: '田中 花子', visitCount: 2 })
    const saved = await env.DB.prepare(
      'SELECT customer_id AS customerId FROM reservations WHERE organization_id = ? AND id = ?',
    )
      .bind(t.org, first.body.id)
      .first<{ customerId: string | null }>()
    expect(saved?.customerId).toBe(customerId)
  })

  it('初回成功後に顧客が統合されても同じ鍵は保存済み応答を replay する', async () => {
    const t = await bookingTenant()
    const customerId = await seedBookingCustomer(t.org)
    const key = crypto.randomUUID()
    const body: ConfirmBody = {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      source: 'phone',
      customerId,
    }
    const first = await confirm(t.token, key, body)
    expect(first.status).toBe(200)
    await env.DB.prepare(
      'UPDATE customers SET merged_into_id = ? WHERE organization_id = ? AND id = ?',
    )
      .bind(crypto.randomUUID(), t.org, customerId)
      .run()

    const replay = await confirm(t.token, key, body)

    expect(replay).toEqual(first)
    expect((await countRows(t.org)).reservations).toBe(1)
  })

  it('存在しない customerId では予約も冪等キーも作らない', async () => {
    const t = await bookingTenant()
    const res = await confirm(t.token, crypto.randomUUID(), {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      source: 'phone',
      customerId: crypto.randomUUID(),
    })
    expect(res.status).toBe(404)
    expect(await countRows(t.org)).toMatchObject({ reservations: 0 })
    expect(await countIdempotency(t.org)).toBe(0)
  })

  it('1 予約で reservations / reservation_purposes / reservation_assignments / audit_events が揃う', async () => {
    const t = await bookingTenant()
    const res = await confirm(t.token, crypto.randomUUID(), {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      equipmentIds: [t.equipmentA, t.equipmentB],
      source: 'phone',
    })
    expect(res.status).toBe(200)

    const rows = await countRows(t.org)
    expect(rows.reservations).toBe(1)
    expect(rows.purposes).toBe(1)
    // 担当 1 + 設備 2。担当が決まっていても未定でも `kind='staff'` はちょうど 1 行。
    expect(rows.assignments).toBe(3)
    expect(rows.audits).toBe(1)

    const reservation = await env.DB.prepare(
      'SELECT status, source, duration_minutes AS durationMinutes, customer_id AS customerId FROM reservations WHERE organization_id = ?',
    )
      .bind(t.org)
      .first<{
        status: string
        source: string
        durationMinutes: number
        customerId: string | null
      }>()
    expect(reservation).toMatchObject({ status: 'confirmed', source: 'phone', durationMinutes: 60 })
    // お客様の台帳は P4。ここでは必ず NULL で、お名前は `reception_sessions` に置く。
    expect(reservation?.customerId).toBeNull()
  })

  it('占有行は（所要 60 + 片付け 10）÷ 刻み 30 を切り上げた 3 枠 ×（担当 1 + 設備 2）= 9 行できる', async () => {
    const t = await bookingTenant()
    const res = await confirm(t.token, crypto.randomUUID(), {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      equipmentIds: [t.equipmentA, t.equipmentB],
      source: 'phone',
    })
    expect(res.status).toBe(200)

    const lanes = await env.DB.prepare(
      "SELECT kind, COUNT(*) AS n FROM reservation_slot_locks WHERE organization_id = ? AND kind <> 'store' GROUP BY kind",
    )
      .bind(t.org)
      .all<{ kind: string; n: number }>()
    expect(Object.fromEntries(lanes.results.map((row) => [row.kind, row.n]))).toEqual({
      staff: 3,
      equipment: 6,
    })

    // 店舗まるごとのレーン（同時受付上限）は P2 が足した 4 本目のレーンで、
    // 1 枠につきさらに 1 行入る（`db/slot-locks.ts` の `STORE_TARGET_KEY`）。
    const store = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM reservation_slot_locks WHERE organization_id = ? AND kind = 'store'",
    )
      .bind(t.org)
      .first<{ n: number }>()
    expect(store?.n).toBe(3)
  })

  it('応答の予約番号が EY-YYMM-NNNN の形で、reservations.code と一致する', async () => {
    const t = await bookingTenant()
    const res = await confirm(t.token, crypto.randomUUID(), {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      source: 'phone',
    })
    expect(res.status).toBe(200)
    expect(res.body.code).toMatch(/^EY-\d{4}-\d{4,5}$/)

    const stored = await env.DB.prepare('SELECT code FROM reservations WHERE organization_id = ?')
      .bind(t.org)
      .first<{ code: string }>()
    expect(stored?.code).toBe(res.body.code)
  })

  it('監査は reservation.created 1 件で、同じ correlation_id を持つ', async () => {
    const t = await bookingTenant()
    const res = await confirm(t.token, crypto.randomUUID(), {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      source: 'phone',
    })
    expect(res.status).toBe(200)

    const audits = await env.DB.prepare(
      'SELECT action, target_type AS targetType, target_id AS targetId, correlation_id AS correlationId, store_id AS storeId FROM audit_events WHERE organization_id = ?',
    )
      .bind(t.org)
      .all<{
        action: string
        targetType: string
        targetId: string
        correlationId: string | null
        storeId: string | null
      }>()
    expect(audits.results).toHaveLength(1)
    const audit = audits.results[0]
    expect(audit?.action).toBe('reservation.created')
    expect(audit?.targetType).toBe('reservation')
    expect(audit?.targetId).toBe(res.body.id)
    expect(audit?.storeId).toBe(t.storeId)
    // 1 操作でまとまった行を束ねる鍵。同じ `db.batch()` の行は同じ値を持つ。
    expect(audit?.correlationId).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('担当が未定', () => {
  it('target_id は NULL、占有行の target_key は unassigned で枠を消費する', async () => {
    const t = await bookingTenant()
    const res = await confirm(t.token, crypto.randomUUID(), {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: null,
      source: 'phone',
    })
    expect(res.status).toBe(200)

    const assignments = await env.DB.prepare(
      'SELECT kind, target_id AS targetId FROM reservation_assignments WHERE organization_id = ?',
    )
      .bind(t.org)
      .all<{ kind: string; targetId: string | null }>()
    expect(assignments.results).toEqual([{ kind: 'staff', targetId: null }])

    const locks = await env.DB.prepare(
      "SELECT DISTINCT target_key AS targetKey FROM reservation_slot_locks WHERE organization_id = ? AND kind = 'staff'",
    )
      .bind(t.org)
      .all<{ targetKey: string }>()
    expect(locks.results).toEqual([{ targetKey: 'unassigned' }])
  })

  it('同時受付上限 3 の店では 3 件目まで同じ 11:00 に成立する', async () => {
    const t = await bookingTenant()
    for (const _ of [0, 1, 2]) {
      const res = await confirm(t.token, crypto.randomUUID(), {
        storeId: t.storeId,
        startsAt: AT_11,
        purposeIds: [t.purposeId],
        staffId: null,
        source: 'phone',
      })
      expect(res.status).toBe(200)
    }
    expect((await countRows(t.org)).reservations).toBe(3)
  })

  it('4 件目は 409 slot_taken で落ちる', async () => {
    const t = await bookingTenant()
    for (const _ of [0, 1, 2]) {
      await confirm(t.token, crypto.randomUUID(), {
        storeId: t.storeId,
        startsAt: AT_11,
        purposeIds: [t.purposeId],
        staffId: null,
        source: 'phone',
      })
    }
    const fourth = await confirm(t.token, crypto.randomUUID(), {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: null,
      source: 'phone',
    })
    expect(fourth.status).toBe(409)
    expect(fourth.body.error).toBe('slot_taken')
    expect((await countRows(t.org)).reservations).toBe(3)
  })
})

describe('枠の競合', () => {
  it('担当の枠が上限まで埋まっていたら 409 slot_taken を返す', async () => {
    const t = await bookingTenant()
    // 佐藤 美咲 の同時受付は 1 件。11:00 の先約が占有行まで持っている。
    await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: AT_11,
      durationMinutes: 60,
      staffId: t.staffId,
      purposes: [{ id: t.purposeId }],
      slotLocks: true,
    })

    const res = await confirm(t.token, crypto.randomUUID(), {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      source: 'phone',
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('slot_taken')
  })

  it('409 のとき reservations / reservation_purposes / reservation_assignments / audit_events / reservation_slot_locks に 1 行も増えていない', async () => {
    const t = await bookingTenant()
    await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: AT_11,
      durationMinutes: 60,
      staffId: t.staffId,
      purposes: [{ id: t.purposeId }],
      slotLocks: true,
    })
    const before = await countRows(t.org)

    const res = await confirm(t.token, crypto.randomUUID(), {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      equipmentIds: [t.equipmentA, t.equipmentB],
      source: 'phone',
    })
    expect(res.status).toBe(409)
    // 0 行の INSERT はバッチを止めないので、status だけでは「予約本体だけ書けた」を捕まえられない。
    expect(await countRows(t.org)).toEqual(before)
  })

  it('同じ枠へ 2 本を同時に投げても、落ちた側の 4 表に 1 行も増えていない', async () => {
    // AC-BOOK-22 の Given そのまま（2 台が同時に押した）。上の 1 本は「先に埋まっていた」
    // 前提で数えているので、条件付き INSERT が**同時**でも同じことを守るかは別に見る。
    const t = await bookingTenant()
    const before = await countRows(t.org)
    const body: ConfirmBody = {
      storeId: t.storeId,
      startsAt: AT_13,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      equipmentIds: [t.equipmentA, t.equipmentB],
      source: 'phone',
    }
    const [one, two] = await Promise.all([
      confirm(t.token, crypto.randomUUID(), body),
      confirm(t.token, crypto.randomUUID(), body),
    ])

    const statuses = [one.status, two.status].sort()
    expect(statuses).toEqual([200, 409])
    expect([one.body.error, two.body.error]).toContain('slot_taken')

    // 通ったのは 1 本だけ。落ちた側は reservations / reservation_purposes /
    // reservation_assignments / audit_events のどれにも行を足していない。
    const after = await countRows(t.org)
    expect(after.reservations).toBe(before.reservations + 1)
    expect(after.purposes).toBe(before.purposes + 1)
    expect(after.assignments).toBe(before.assignments + 3)
    expect(after.audits).toBe(before.audits + 1)
  })

  it('409 の応答に代わりの時刻が 3 件まで載る', async () => {
    const t = await bookingTenant()
    await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: AT_11,
      durationMinutes: 60,
      staffId: t.staffId,
      purposes: [{ id: t.purposeId }],
      slotLocks: true,
    })

    const res = await confirm(t.token, crypto.randomUUID(), {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      source: 'phone',
    })
    expect(res.status).toBe(409)
    expect(res.body.alternatives).toHaveLength(3)
    for (const slot of res.body.alternatives ?? []) {
      expect(slot.startsAt).not.toBe(AT_11)
      expect(Date.parse(slot.endsAt)).toBeGreaterThan(Date.parse(slot.startsAt))
    }
  })
})

describe('冪等', () => {
  it('同じ Idempotency-Key の再送で予約は 1 件、応答の予約番号も同じ', async () => {
    const t = await bookingTenant()
    const key = crypto.randomUUID()
    const body: ConfirmBody = {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      source: 'phone',
    }
    const first = await confirm(t.token, key, body)
    const again = await confirm(t.token, key, body)

    expect(first.status).toBe(200)
    expect(again.status).toBe(200)
    expect(again.body.code).toBe(first.body.code)
    expect(again.body.id).toBe(first.body.id)
    expect((await countRows(t.org)).reservations).toBe(1)
  })

  it('同じ鍵で本文が違えば 409 idempotency_conflict で、予約は増えない', async () => {
    const t = await bookingTenant()
    const key = crypto.randomUUID()
    const first = await confirm(t.token, key, {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      source: 'phone',
    })
    expect(first.status).toBe(200)

    const different = await confirm(t.token, key, {
      storeId: t.storeId,
      startsAt: AT_13,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      source: 'phone',
    })
    expect(different.status).toBe(409)
    expect(different.body.error).toBe('idempotency_conflict')
    expect((await countRows(t.org)).reservations).toBe(1)
  })

  it('処理中（in_progress）の鍵に再送が来ても 409 idempotency_conflict', async () => {
    const t = await bookingTenant()
    const clientKey = crypto.randomUUID()
    // 途中で落ちた先行処理を模す。待ち合わせ・引き継ぎの経路は作らない決めなので、
    // 同じ鍵の再送は本文が同じでも 409 になる（クライアントは鍵を作り直す）。
    const now = new Date()
    await env.DB.prepare(
      'INSERT INTO idempotency_records (key, organization_id, scope, request_hash, response_json, status, created_at, expires_at) VALUES (?,?,?,?,NULL,?,?,?)',
    )
      .bind(
        `${t.org}:reservation.create:${clientKey}`,
        t.org,
        'reservation.create',
        'x'.repeat(64),
        'in_progress',
        now.toISOString(),
        new Date(now.getTime() + 86_400_000).toISOString(),
      )
      .run()

    const res = await confirm(t.token, clientKey, {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      source: 'phone',
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('idempotency_conflict')
    expect((await countRows(t.org)).reservations).toBe(0)
  })

  it('枠が取れなかったときは in_progress の行を消して、同じ鍵で選び直せる', async () => {
    const t = await bookingTenant()
    await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: AT_11,
      durationMinutes: 60,
      staffId: t.staffId,
      purposes: [{ id: t.purposeId }],
      slotLocks: true,
    })
    const key = crypto.randomUUID()

    const taken = await confirm(t.token, key, {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      source: 'phone',
    })
    expect(taken.status).toBe(409)

    const rows = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM idempotency_records WHERE organization_id = ?',
    )
      .bind(t.org)
      .first<{ n: number }>()
    expect(rows?.n).toBe(0)

    // 同じ鍵のまま時刻だけ選び直せる（画面は伺った内容を失わない）。
    const retried = await confirm(t.token, key, {
      storeId: t.storeId,
      startsAt: AT_13,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      source: 'phone',
    })
    expect(retried.status).toBe(200)
  })

  it('空文字の Idempotency-Key は「送っていない」と同じで、2 件目を replay しない', async () => {
    // `?? null` が空文字を素通しすると、鍵が `<org>:reservation.create:` になって
    // 組織のすべての端末が 1 本を共有し、2 件目が 1 件目の応答をそのまま返す
    // （予約されないまま「承りました」と出る）。
    const t = await bookingTenant()
    const body: ConfirmBody = {
      storeId: t.storeId,
      startsAt: AT_13,
      purposeIds: [t.purposeId],
      staffId: null,
      source: 'phone',
    }
    const one = await confirm(t.token, '', body)
    const two = await confirm(t.token, '', body)

    expect([one.status, two.status]).toEqual([200, 200])
    expect(one.body.code).not.toBe(two.body.code)
    expect((await countRows(t.org)).reservations).toBe(2)
    // 鍵として使わないので、行も残さない。
    expect(await countIdempotency(t.org)).toBe(0)
  })

  it('鍵として使えない Idempotency-Key は 400 で、予約も冪等の行も増えない', async () => {
    const t = await bookingTenant()
    const body: ConfirmBody = {
      storeId: t.storeId,
      startsAt: AT_13,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      source: 'phone',
    }
    // 10 万文字の鍵がそのまま主キーになると、認証済みの端末 1 台で D1 を膨らませられる。
    for (const key of ['k'.repeat(256), 'あいうえお']) {
      const res = await confirm(t.token, key, body)
      expect(res.status, key.slice(0, 8)).toBe(400)
      expect(res.body.error).toBe('invalid_input')
    }
    expect((await countRows(t.org)).reservations).toBe(0)
    expect(await countIdempotency(t.org)).toBe(0)
  })

  it('予約番号の衝突による打ち直しでは in_progress を消さない', async () => {
    const t = await bookingTenant()
    const first = await confirm(t.token, crypto.randomUUID(), {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      source: 'phone',
    })
    expect(first.status).toBe(200)
    // 採番はその月の `MAX(code)` に +1 する。文字列の MAX は 4 桁の `9999` を
    // 5 桁の `10000` より大きいと読むので、両方ある月は必ず 1 度衝突する。
    const prefix = (first.body.code ?? '').slice(0, 8)
    await env.DB.prepare('UPDATE reservations SET code = ? WHERE id = ?')
      .bind(`${prefix}9999`, first.body.id)
      .run()
    const filler = await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: AT_16,
      staffId: null,
      purposes: [{ id: t.purposeId }],
    })
    await env.DB.prepare('UPDATE reservations SET code = ? WHERE id = ?')
      .bind(`${prefix}10000`, filler)
      .run()

    const key = crypto.randomUUID()
    const second = await confirm(t.token, key, {
      storeId: t.storeId,
      startsAt: AT_13,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      source: 'phone',
    })
    expect(second.status).toBe(200)
    expect(second.body.code).toBe(`${prefix}10001`)

    // 採番の打ち直しは「失敗」に数えない。行が消えていれば `done` を同じバッチで
    // 書く決めが成り立たなくなる（`04-api.md` §6.2 の 4）。
    const record = await env.DB.prepare(
      'SELECT status, response_json AS responseJson FROM idempotency_records WHERE key = ?',
    )
      .bind(`${t.org}:reservation.create:${key}`)
      .first<{ status: string; responseJson: string | null }>()
    expect(record?.status).toBe('done')
    expect(record?.responseJson).not.toBeNull()
  })
})

describe('仮の押さえ', () => {
  it('POST /api/staff/holds は 2 台が同じ枠を押さえても両方 200 を返す', async () => {
    const t = await bookingTenant()
    const body = JSON.stringify({
      storeId: t.storeId,
      startsAt: AT_11,
      durationMinutes: 60,
      staffId: t.staffId,
    })
    const [one, two] = await Promise.all([
      SELF.fetch(`${BASE}/api/staff/holds`, { method: 'POST', headers: authed(t.token), body }),
      SELF.fetch(`${BASE}/api/staff/holds`, { method: 'POST', headers: authed(t.token), body }),
    ])
    // KV に CAS が無く「取れなかった」を判定できないので、409 `slot_taken` を返さない。
    expect([one.status, two.status]).toEqual([200, 200])
    const [a, b] = (await Promise.all([one.json(), two.json()])) as {
      id: string
      expiresAt: string
    }[]
    expect(a?.id).not.toBe(b?.id)
    // 残り時間は端末の時計ではなくこの値から数える（420 秒 = 7 分）。
    expect(a?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('確定すると、その予約が置いた押さえが KV から消える', async () => {
    const t = await bookingTenant()
    const sessionId = await startSession(t.token, t.storeId)
    const held = await postHold(t.token, {
      storeId: t.storeId,
      startsAt: AT_16,
      durationMinutes: 60,
      staffId: t.staffId,
      receptionSessionId: sessionId,
    })
    expect(held.status).toBe(200)
    expect(await holdKeys(t.org)).toHaveLength(1)

    const res = await confirm(t.token, crypto.randomUUID(), {
      storeId: t.storeId,
      startsAt: AT_16,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      holdId: String(held.body.id),
      receptionSessionId: sessionId,
      source: 'phone',
    })
    expect(res.status).toBe(200)
    // 残すと、確定したご予約とその予約が置いた押さえの**両方**が同じ枠を数える
    // （同時受付 2 の担当なら 1 件のご予約で「満席」と出る）。画面の DELETE だけに
    // 任せると、タブを閉じる・回線が切れるで 420 秒ぶん残る。
    expect(await holdKeys(t.org)).toEqual([])
  })

  it('取り直しが 10 回を越えた受付の押さえは 409 renew_limit（読み込み直しでも上限が消えない）', async () => {
    const t = await bookingTenant()
    const sessionId = await startSession(t.token, t.storeId)
    const hold = {
      storeId: t.storeId,
      startsAt: AT_16,
      durationMinutes: 60,
      staffId: t.staffId,
      receptionSessionId: sessionId,
    }
    // 下書きの回数は「いま押した 1 回」を含む（画面は打ち直しの前に送る）ので、
    // 10 回目ちょうどまでは取り直せる。
    await patchDraft(t.token, sessionId, { holdRenewals: 10 })
    expect((await postHold(t.token, hold)).status).toBe(200)

    // 11 回目で断る。数えるのは下書きに載った回数なので、タブを読み込み直しても 0 に戻らない
    // （端末の state だけで数えると、読み込み直すたびに上限が消える）。
    await patchDraft(t.token, sessionId, { holdRenewals: 11 })
    const over = await postHold(t.token, hold)
    expect(over.status).toBe(409)
    expect(over.body.error).toBe('renew_limit')
  })

  it('holdId が期限切れでも確定は 404 にも 409 にもならない', async () => {
    const t = await bookingTenant()
    const res = await confirm(t.token, crypto.randomUUID(), {
      storeId: t.storeId,
      startsAt: AT_11,
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      // 420 秒を過ぎて KV から消えた押さえ。仮の押さえは表示のためだけの仕組みなので、
      // 確定はそのまま通る（枠が取れるかどうかはバッチの中だけで決まる）。
      holdId: crypto.randomUUID(),
      source: 'phone',
    })
    expect(res.status).toBe(200)
    expect((await countRows(t.org)).reservations).toBe(1)
  })
})
