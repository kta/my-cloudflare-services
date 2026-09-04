/**
 * 予約の検索・変更・取消の通し（`GET /api/staff/reservations` /
 * `PATCH /api/staff/reservations/:reservationId` /
 * `POST /api/staff/reservations/:reservationId/cancel` /
 * `GET /api/staff/reservations/:reservationId/history`）。
 *
 * ここで見るのは「409 が返ること」ではなく **D1 の中身**である。変更は 1 バッチで、
 * ①新しい枠を取る → …… → ⑥版を +1 する、の順に並ぶ。D1 の `db.batch()` は
 * 0 行しか当たらない文を失敗と見なさずバッチを止めないので、版の条件を 1 文目にだけ
 * 置いた実装は「409 を返しながら割当と占有行だけ書き換える」形になり、status を見る
 * だけのテストでは捕まらない（AC-CHANGE-27）。**元を先に空けない**ことも同じで、
 * 空けてから取る実装は 409 のときに枠だけ失う。
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

/** 世界観データの 1 日（2026-08-27 木曜）。モックが描いているご予約は 11:00–12:00。 */
const AT_11 = jstAt(LEDGER_DATE, '11:00')
const AT_14 = jstAt(LEDGER_DATE, '14:00')
const AT_16 = jstAt(LEDGER_DATE, '16:00')

/** dev グラントが載せる `sub`。監査の操作者名はこれを `staff.admin_user_id` で引く。 */
const subOf = (org: string) => `dev:${org}`

function callAs(token: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await SELF.fetch(`${BASE}${path}`, {
      method,
      headers: authed(token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: res.status, body: (await res.json().catch(() => null)) as never }
  }
}

/** 受け付けられる店舗ひとそろい。担当 1 名（同時 1 件）・設備 1 台・60 分のご用件。 */
async function changeTenant(name = 'EYE 銀座店') {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await insertStore(org, name)
  await insertBusinessHours(org, storeId)
  await insertSlotRules(org, storeId, { slotMinutes: 30, cleanupMinutes: 10, maxParallel: 3 })
  const staffId = await insertStaff(org, storeId, {
    displayName: '佐藤 美咲',
    maxParallelReservations: 1,
  })
  await insertShift(org, storeId, staffId)
  const otherStaffId = await insertStaff(org, storeId, {
    displayName: '中村 彩',
    maxParallelReservations: 1,
    sortOrder: 1,
  })
  await insertShift(org, storeId, otherStaffId)
  // 監査の操作者名は `staff.admin_user_id` = JWT の `sub` で引く。共有端末のまま
  // だと `actor_id` が NULL になり、経緯の行に名前が入らない（AC-CHANGE-18）。
  await env.DB.prepare('UPDATE staff SET admin_user_id = ? WHERE id = ?')
    .bind(subOf(org), staffId)
    .run()
  const purposeId = await insertVisitPurpose(org, storeId, {
    nameInternal: 'メガネを新しく作る',
    nameShort: '新調相談',
    durationMinutes: 60,
  })
  const otherPurposeId = await insertVisitPurpose(org, storeId, {
    nameInternal: '今のメガネを調整したい',
    nameShort: '調整',
    durationMinutes: 60,
    sortOrder: 1,
  })
  const equipmentA = await insertEquipment(org, storeId, { name: '視力測定機 A', sortOrder: 0 })
  const equipmentB = await insertEquipment(org, storeId, {
    name: '相談カウンター 1',
    kind: 'counter',
    roleLabel: '接客・ご相談',
    sortOrder: 1,
  })
  return {
    org,
    token,
    storeId,
    staffId,
    otherStaffId,
    purposeId,
    otherPurposeId,
    equipmentA,
    equipmentB,
    call: callAs(token),
  }
}

type Booked = { id: string; code: string; version: number; startsAt: string }

/** ご予約を 1 件確定する（枠の占有行まで本番と同じ経路で作る）。 */
async function book(
  tenant: Awaited<ReturnType<typeof changeTenant>>,
  input: {
    startsAt?: string
    staffId?: string | null
    equipmentIds?: string[]
    purposeIds?: string[]
    source?: 'phone' | 'counter' | 'web'
  } = {},
): Promise<Booked> {
  const res = await SELF.fetch(`${BASE}/api/staff/reservations`, {
    method: 'POST',
    headers: { ...authed(tenant.token), 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({
      storeId: tenant.storeId,
      startsAt: input.startsAt ?? AT_11,
      purposeIds: input.purposeIds ?? [tenant.purposeId],
      staffId: input.staffId === undefined ? tenant.staffId : input.staffId,
      equipmentIds: input.equipmentIds ?? [tenant.equipmentA],
      source: input.source ?? 'phone',
    }),
  })
  const body = (await res.json()) as Booked
  expect(res.status, JSON.stringify(body)).toBe(200)
  return body
}

/** お客様を 1 人置いて、そのご予約に結ぶ（検索がお名前・お電話番号で当たるようにする）。 */
let customerSeq = 0
async function attachCustomer(
  org: string,
  reservationId: string,
  seed: { name: string; kana?: string; phone?: string; visitCount?: number },
): Promise<string> {
  const id = crypto.randomUUID()
  const normalized = (seed.phone ?? '').replace(/\D/g, '')
  await env.DB.prepare(
    'INSERT INTO customers (id, organization_id, customer_number, name, kana, phone, phone_normalized, phone_last4, email, birth_date, address, memo, first_visit_at, last_visit_at, visit_count, merged_into_id, version, created_store_id, created_terminal_id, created_at, updated_at) ' +
      'VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,NULL,NULL,?,NULL,1,NULL,NULL,?,?)',
  )
    .bind(
      id,
      org,
      `G-${String(++customerSeq).padStart(5, '0')}`,
      seed.name,
      seed.kana ?? '',
      seed.phone ?? null,
      normalized === '' ? null : normalized,
      normalized === '' ? null : normalized.slice(-4),
      '',
      seed.visitCount ?? 0,
      '2026-08-27T02:08:00.000Z',
      '2026-08-27T02:08:00.000Z',
    )
    .run()
  await env.DB.prepare(
    'UPDATE reservations SET customer_id = ? WHERE organization_id = ? AND id = ?',
  )
    .bind(id, org, reservationId)
    .run()
  return id
}

type SlotLockRow = { kind: string; targetKey: string; slotStart: string }

/** 1 予約が押さえている枠の行。並びを固定して比べられる形で返す。 */
async function locksOf(org: string, reservationId: string): Promise<SlotLockRow[]> {
  const rows = await env.DB.prepare(
    'SELECT kind, target_key AS targetKey, slot_start AS slotStart FROM reservation_slot_locks ' +
      'WHERE organization_id = ? AND reservation_id = ? ORDER BY slot_start, kind, target_key',
  )
    .bind(org, reservationId)
    .all<SlotLockRow>()
  return rows.results
}

type AssignmentRow = { kind: string; targetId: string | null; startsAt: string; endsAt: string }

async function assignmentsOf(org: string, reservationId: string): Promise<AssignmentRow[]> {
  const rows = await env.DB.prepare(
    'SELECT kind, target_id AS targetId, starts_at AS startsAt, ends_at AS endsAt ' +
      'FROM reservation_assignments WHERE organization_id = ? AND reservation_id = ? ' +
      'ORDER BY kind, target_id',
  )
    .bind(org, reservationId)
    .all<AssignmentRow>()
  return rows.results
}

type ReservationRow = {
  code: string
  status: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  version: number
  cancelReason: string | null
  cancelledAt: string | null
}

async function reservationRow(org: string, reservationId: string): Promise<ReservationRow> {
  const row = await env.DB.prepare(
    'SELECT code, status, starts_at AS startsAt, ends_at AS endsAt, duration_minutes AS durationMinutes, ' +
      'version, cancel_reason AS cancelReason, cancelled_at AS cancelledAt ' +
      'FROM reservations WHERE organization_id = ? AND id = ?',
  )
    .bind(org, reservationId)
    .first<ReservationRow>()
  if (row === null) throw new Error(`ご予約 ${reservationId} が無い`)
  return row
}

async function purposeIdsOf(org: string, reservationId: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    'SELECT purpose_id AS purposeId FROM reservation_purposes ' +
      'WHERE organization_id = ? AND reservation_id = ? ORDER BY sort_order',
  )
    .bind(org, reservationId)
    .all<{ purposeId: string }>()
  return rows.results.map((row) => row.purposeId)
}

type AuditRow = { action: string; beforeJson: string | null; afterJson: string | null }

async function auditOf(org: string, targetId: string): Promise<AuditRow[]> {
  const rows = await env.DB.prepare(
    'SELECT action, before_json AS beforeJson, after_json AS afterJson FROM audit_events ' +
      'WHERE organization_id = ? AND target_id = ? ORDER BY occurred_at, id',
  )
    .bind(org, targetId)
    .all<AuditRow>()
  return rows.results
}

type SearchBody = {
  items: {
    id: string
    code: string
    startsAt: string
    status: string
    source: string
    customerName: string | null
    visitCount: number | null
    purposeLabel: string
    staffName: string | null
  }[]
  total: number
  relaxations: { label: string; count: number; query: Record<string, unknown> }[]
}

function searchPath(storeId: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ storeId, ...params })
  return `/api/staff/reservations?${query.toString()}`
}

/* ───────────────────────────────────────────────────────────────────────────
 * 検索（CHANGE-SEARCH / EX-EMPTY-SEARCH）
 * ─────────────────────────────────────────────────────────────────────────── */

describe('検索', () => {
  it('お名前で探すと選択中店舗のご予約だけが並ぶ', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    await attachCustomer(tenant.org, hers.id, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: '090-1234-5678',
      visitCount: 4,
    })
    const others = await book(tenant, { startsAt: AT_16, staffId: tenant.otherStaffId })
    await attachCustomer(tenant.org, others.id, { name: '鈴木 一郎', kana: 'すずき いちろう' })

    const found = await tenant.call('GET', searchPath(tenant.storeId, { name: '田中' }))
    expect(found.status).toBe(200)
    const body = found.body as unknown as SearchBody
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: hers.id,
      code: hers.code,
      startsAt: AT_11,
      customerName: '田中 花子',
      visitCount: 4,
      purposeLabel: '新調相談',
      staffName: '佐藤 美咲',
    })
    // 1 件以上あるのに緩和候補が並ぶと、いま見えている一覧が信用できなくなる。
    expect(body.relaxations).toEqual([])
  })

  it('別店舗の同じお名前のご予約は結果に出ない', async () => {
    // AC-CHANGE-05。同じ組織の丸の内店に同姓のご予約があっても、銀座店の結果に混ぜない。
    const tenant = await changeTenant()
    const ginza = await book(tenant, { startsAt: AT_11 })
    await attachCustomer(tenant.org, ginza.id, { name: '田中 花子', kana: 'たなか はなこ' })

    const marunouchi = await insertStore(tenant.org, 'EYE 丸の内店')
    await insertBusinessHours(tenant.org, marunouchi)
    await insertSlotRules(tenant.org, marunouchi)
    // ご用件も担当も店舗ごとの行なので、丸の内店にも 1 組置く
    // （銀座店の目的では確定できず、勤務している担当が居ないと 409 になる）。
    const marunouchiPurpose = await insertVisitPurpose(tenant.org, marunouchi, {
      nameInternal: 'メガネを新しく作る',
      nameShort: '新調相談',
      durationMinutes: 60,
    })
    const marunouchiStaff = await insertStaff(tenant.org, marunouchi, { displayName: '伊藤 健' })
    await insertShift(tenant.org, marunouchi, marunouchiStaff)
    const there = await SELF.fetch(`${BASE}/api/staff/reservations`, {
      method: 'POST',
      headers: { ...authed(tenant.token), 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        storeId: marunouchi,
        startsAt: AT_14,
        purposeIds: [marunouchiPurpose],
        staffId: null,
        source: 'phone',
      }),
    })
    const thereBody = (await there.json()) as Booked
    expect(there.status, JSON.stringify(thereBody)).toBe(200)
    await attachCustomer(tenant.org, thereBody.id, { name: '田中 太郎', kana: 'たなか たろう' })

    const found = await tenant.call('GET', searchPath(tenant.storeId, { name: '田中' }))
    const body = found.body as unknown as SearchBody
    expect(body.items.map((item) => item.id)).toEqual([ginza.id])
    expect(body.items.map((item) => item.id)).not.toContain(thereBody.id)
    expect(body.total).toBe(1)
  })

  it('予約番号で探すと 1 件になり、出どころが「お電話でのご予約」で返る', async () => {
    // AC-CHANGE-04。出どころの語は画面が引き当てる（契約は `source` の 4 語だけを運ぶ）。
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11, source: 'phone' })
    await attachCustomer(tenant.org, hers.id, { name: '田中 花子' })
    await book(tenant, { startsAt: AT_16, staffId: tenant.otherStaffId })

    const found = await tenant.call('GET', searchPath(tenant.storeId, { code: hers.code }))
    const body = found.body as unknown as SearchBody
    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({ id: hers.id, code: hers.code, source: 'phone' })
  })

  it('担当・状態・期間の片側だけの絞り込みも SQL として通る', async () => {
    // `staffId` は `EXISTS` の子問い合わせ、`status` は語の並び、`from` / `to` は
    // 片側だけの半開区間になる。どれも組み立てを 1 文字間違えると 500 に化けるので、
    // 断片ではなく実物の D1 に投げて通ることまで見る。
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })

    const cases: Record<string, string>[] = [
      { staffId: tenant.staffId },
      { status: 'confirmed' },
      { from: LEDGER_DATE },
      { to: LEDGER_DATE },
    ]
    for (const params of cases) {
      const found = await tenant.call('GET', searchPath(tenant.storeId, params))
      expect(found.status, JSON.stringify(params)).toBe(200)
      const body = found.body as unknown as SearchBody
      expect(
        body.items.map((item) => item.id),
        JSON.stringify(params),
      ).toEqual([hers.id])
    }

    // 別の担当で絞ると外れる（条件が効いていることまで見る）。
    const other = await tenant.call(
      'GET',
      searchPath(tenant.storeId, { staffId: tenant.otherStaffId }),
    )
    expect((other.body as unknown as SearchBody).items).toEqual([])
  })

  it('EY-W- の番号は Web のご予約にだけ当たり、同じ連番のお電話のご予約は出ない', async () => {
    // `EY-W-2608-0001` は Web の控えにしか無い番号である。業務側の番号へ直すだけだと
    // 同じ連番のお電話のご予約が 1 件当たり、受付が別のお客様のご予約を開く。
    const tenant = await changeTenant()
    const byPhone = await book(tenant, { startsAt: AT_11, source: 'phone' })
    const webCode = byPhone.code.replace('EY-', 'EY-W-')

    const found = await tenant.call('GET', searchPath(tenant.storeId, { code: webCode }))
    const body = found.body as unknown as SearchBody
    expect(body.total).toBe(0)
    expect(body.items).toEqual([])

    // 同じ番号が Web のご予約に付いていれば、そちらは当たる。
    const byWeb = await book(tenant, { startsAt: AT_16, source: 'web' })
    const hit = await tenant.call(
      'GET',
      searchPath(tenant.storeId, { code: byWeb.code.replace('EY-', 'EY-W-') }),
    )
    const hitBody = hit.body as unknown as SearchBody
    expect(hitBody.items.map((item) => item.id)).toEqual([byWeb.id])
  })

  it('0 件のとき relaxations が 1〜3 件付き、案の件数と実際の再検索の件数が一致する', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11, source: 'phone' })
    await attachCustomer(tenant.org, hers.id, { name: '田中 花子', kana: 'たなか はなこ' })

    // 「Web予約だけ」を足すと 0 件になる（このご予約はお電話から入っている）。
    const empty = await tenant.call(
      'GET',
      searchPath(tenant.storeId, { name: '田中', source: 'web' }),
    )
    expect(empty.status).toBe(200)
    const body = empty.body as unknown as SearchBody
    expect(body.total).toBe(0)
    expect(body.items).toEqual([])
    expect(body.relaxations.length).toBeGreaterThanOrEqual(1)
    expect(body.relaxations.length).toBeLessThanOrEqual(3)

    // 案の `query` はそのまま再送できる形である（画面は条件を組み立て直さない）。
    for (const relaxation of body.relaxations) {
      expect(relaxation.count).toBeGreaterThanOrEqual(1)
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(relaxation.query)) {
        if (value === undefined || value === null) continue
        params.set(key, Array.isArray(value) ? value.join(',') : String(value))
      }
      const again = await tenant.call('GET', `/api/staff/reservations?${params.toString()}`)
      expect(again.status).toBe(200)
      expect((again.body as unknown as SearchBody).total).toBe(relaxation.count)
    }
  })
})

describe('詳細', () => {
  it('1 件を選ぶと日時・ご用件・お客様・担当と場所・注意ごとが返る', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    await attachCustomer(tenant.org, hers.id, { name: '田中 花子', visitCount: 4 })

    const detail = await tenant.call('GET', `/api/staff/reservations/${hers.id}`)
    expect(detail.status).toBe(200)
    const body = detail.body as unknown as {
      code: string
      startsAt: string
      endsAt: string
      durationMinutes: number
      customerName: string | null
      visitCount: number | null
      purposes: { nameInternal: string }[]
      assignments: { kind: string; targetId: string | null }[]
      noteCustomer: string
      noteInternal: string
      version: number
    }
    expect(body.code).toBe(hers.code)
    expect(body.startsAt).toBe(AT_11)
    expect(body.durationMinutes).toBe(60)
    expect(body.customerName).toBe('田中 花子')
    expect(body.visitCount).toBe(4)
    expect(body.purposes.map((line) => line.nameInternal)).toEqual(['メガネを新しく作る'])
    expect(body.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'staff', targetId: tenant.staffId }),
        expect.objectContaining({ kind: 'equipment', targetId: tenant.equipmentA }),
      ]),
    )
    expect(body.version).toBe(1)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 変更（CHANGE-DATETIME → CHANGE-DIFF →「変更を確定する」）
 * ─────────────────────────────────────────────────────────────────────────── */

describe('変更', () => {
  it('新しい枠を取ってから古い枠を返す（古い枠の行は確定後に 0 件、新しい枠の行は要求本数ぶんある）', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    const before = await locksOf(tenant.org, hers.id)
    expect(before.length).toBeGreaterThan(0)
    expect(before.every((row) => row.slotStart >= AT_11)).toBe(true)

    const changed = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
    })
    expect(changed.status, JSON.stringify(changed.body)).toBe(200)

    const after = await locksOf(tenant.org, hers.id)
    // 古い枠は 1 行も残らない。残ると 11:00 が翌朝まで埋まったままになる。
    expect(after.filter((row) => row.slotStart === AT_11)).toEqual([])
    // 新しい枠は元と同じ本数ある（担当・設備・店舗の 3 レーン × 刻みの本数）。
    expect(after).toHaveLength(before.length)
    expect(after.filter((row) => row.slotStart === AT_14).length).toBeGreaterThan(0)
    expect(new Set(after.map((row) => row.kind))).toEqual(new Set(before.map((row) => row.kind)))
  })

  it('日時を変えても予約番号は変わらない', async () => {
    // AC-CHANGE-15。変更を「取消 + 新規」で表すと番号が変わり、お客様への説明が切れる。
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })

    const changed = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
    })
    expect(changed.status).toBe(200)
    expect((changed.body as unknown as { code: string }).code).toBe(hers.code)
    expect((await reservationRow(tenant.org, hers.id)).code).toBe(hers.code)
  })

  it('version が 1 つ上がる', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    expect((await reservationRow(tenant.org, hers.id)).version).toBe(1)

    const changed = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
    })
    expect(changed.status).toBe(200)
    expect((changed.body as unknown as { version: number }).version).toBe(2)
    expect((await reservationRow(tenant.org, hers.id)).version).toBe(2)
  })

  it('日時を保ったまま担当と場所だけを置き直せる', async () => {
    // UC-CHANGE-06。時刻を選び直させない（「いまのまま」で進める）。
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })

    const changed = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      staffId: tenant.otherStaffId,
      equipmentIds: [tenant.equipmentB],
    })
    expect(changed.status, JSON.stringify(changed.body)).toBe(200)

    const row = await reservationRow(tenant.org, hers.id)
    expect(row.startsAt).toBe(AT_11)
    expect(row.durationMinutes).toBe(60)
    const assignments = await assignmentsOf(tenant.org, hers.id)
    expect(assignments.find((band) => band.kind === 'staff')?.targetId).toBe(tenant.otherStaffId)
    expect(assignments.filter((band) => band.kind === 'equipment').map((b) => b.targetId)).toEqual([
      tenant.equipmentB,
    ])
    // 枠は同じ時刻のまま、押さえ先だけが入れ替わる。
    const locks = await locksOf(tenant.org, hers.id)
    expect(locks.every((lock) => lock.slotStart >= AT_11)).toBe(true)
    expect(locks.some((lock) => lock.targetKey === tenant.otherStaffId)).toBe(true)
    expect(locks.some((lock) => lock.targetKey === tenant.staffId)).toBe(false)
  })

  it('変更先の枠が埋まっていたら 409 slot_taken を返し、代わりの枠を 3 件まで載せる', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    // 佐藤 美咲は同時 1 件。14:00 を別のご予約が取ったら、そこへは移せない。
    await book(tenant, { startsAt: AT_14 })

    const refused = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
    })
    expect(refused.status).toBe(409)
    const body = refused.body as unknown as {
      error: string
      alternatives: { startsAt: string }[]
    }
    expect(body.error).toBe('slot_taken')
    expect(body.alternatives.length).toBeLessThanOrEqual(3)
    expect(body.alternatives.every((slot) => slot.startsAt !== AT_14)).toBe(true)
  })

  it('409 slot_taken のとき、元のご予約の日時・担当・場所・枠は 1 行も変わっていない', async () => {
    // AC-CHANGE-26。取れなかったのに元を空けていたら、11:00 のお客様の枠が消える。
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    const beforeRow = await reservationRow(tenant.org, hers.id)
    const beforeLocks = await locksOf(tenant.org, hers.id)
    const beforeAssignments = await assignmentsOf(tenant.org, hers.id)
    const beforeAudit = await auditOf(tenant.org, hers.id)
    await book(tenant, { startsAt: AT_14 })

    const refused = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
      noteInternal: 'お時間の変更のご希望',
    })
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({ error: 'slot_taken' })

    expect(await reservationRow(tenant.org, hers.id)).toEqual(beforeRow)
    expect(await locksOf(tenant.org, hers.id)).toEqual(beforeLocks)
    expect(await assignmentsOf(tenant.org, hers.id)).toEqual(beforeAssignments)
    expect(await auditOf(tenant.org, hers.id)).toEqual(beforeAudit)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 経緯と監査（HISTORY-LIST 右「そのあとの変更」）
 * ─────────────────────────────────────────────────────────────────────────── */

describe('経緯', () => {
  it('変更したご予約の history に「ご来店時刻を 11:00 から 14:00 へ」の 1 行が並ぶ', async () => {
    // AC-CHANGE-18。
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    const changed = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
    })
    expect(changed.status).toBe(200)

    const history = await tenant.call('GET', `/api/staff/reservations/${hers.id}/history`)
    expect(history.status).toBe(200)
    const rows = history.body as unknown as { occurredAt: string; what: string }[]
    expect(rows.map((row) => row.what)).toContain('ご来店時刻を 11:00 から 14:00 へ')
    // 古い順に並ぶ（受け付けた行が先、変えた行が後）。
    expect(rows[0]?.what).toBe('新しく受け付けました')
  })

  it('history に操作した人の名前と時刻が入る', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
    })

    const history = await tenant.call('GET', `/api/staff/reservations/${hers.id}/history`)
    const rows = history.body as unknown as {
      occurredAt: string
      what: string
      actorName: string | null
    }[]
    const moved = rows.find((row) => row.what === 'ご来店時刻を 11:00 から 14:00 へ')
    expect(moved?.actorName).toBe('佐藤 美咲')
    expect(moved?.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

describe('監査', () => {
  it('audit_events に reservation.rescheduled が 1 行だけ増え、before_json と after_json を持つ', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    const before = await auditOf(tenant.org, hers.id)

    const changed = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
    })
    expect(changed.status).toBe(200)

    const after = await auditOf(tenant.org, hers.id)
    expect(after).toHaveLength(before.length + 1)
    const added = after.filter((row) => row.action === 'reservation.rescheduled')
    expect(added).toHaveLength(1)
    expect(JSON.parse(String(added[0]?.beforeJson))).toMatchObject({ startsAt: AT_11 })
    expect(JSON.parse(String(added[0]?.afterJson))).toMatchObject({ startsAt: AT_14 })
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 取消（CHANGE-CANCEL →「この予約を取り消す」）
 * ─────────────────────────────────────────────────────────────────────────── */

describe('取消', () => {
  it('理由 customer で取り消すと status が cancelled になり cancel_reason が残る', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })

    const cancelled = await tenant.call('POST', `/api/staff/reservations/${hers.id}/cancel`, {
      version: 1,
      reason: 'customer',
    })
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)

    const row = await reservationRow(tenant.org, hers.id)
    expect(row.status).toBe('cancelled')
    expect(row.cancelReason).toBe('customer')
    expect(row.cancelledAt).not.toBeNull()
  })

  it('理由 no_show で取り消すと status が no_show になる', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })

    const cancelled = await tenant.call('POST', `/api/staff/reservations/${hers.id}/cancel`, {
      version: 1,
      reason: 'no_show',
    })
    expect(cancelled.status).toBe(200)
    expect((await reservationRow(tenant.org, hers.id)).status).toBe('no_show')
  })

  it('取り消すと reservation_slot_locks の行が 0 件になり、同じ時刻が空き枠に戻る', async () => {
    // AC-CHANGE-17。解かないと、お帰りになった方の 11:00 が翌朝まで埋まったままになる。
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    expect((await locksOf(tenant.org, hers.id)).length).toBeGreaterThan(0)

    const full = await tenant.call(
      'GET',
      `/api/staff/availability?storeId=${tenant.storeId}&date=${LEDGER_DATE}&purposeIds=${tenant.purposeId}&staffId=${tenant.staffId}`,
    )
    const fullSlots = (
      full.body as unknown as { slots: { startsAt: string; isAvailable: boolean }[] }
    ).slots
    expect(fullSlots.find((slot) => slot.startsAt === AT_11)?.isAvailable).toBe(false)

    const cancelled = await tenant.call('POST', `/api/staff/reservations/${hers.id}/cancel`, {
      version: 1,
      reason: 'customer',
    })
    expect(cancelled.status).toBe(200)
    expect(await locksOf(tenant.org, hers.id)).toEqual([])

    const open = await tenant.call(
      'GET',
      `/api/staff/availability?storeId=${tenant.storeId}&date=${LEDGER_DATE}&purposeIds=${tenant.purposeId}&staffId=${tenant.staffId}`,
    )
    const openSlots = (
      open.body as unknown as { slots: { startsAt: string; isAvailable: boolean }[] }
    ).slots
    expect(openSlots.find((slot) => slot.startsAt === AT_11)?.isAvailable).toBe(true)
  })

  it('取り消したご予約は既定の検索に出ず、includeCancelled を立てると出る', async () => {
    // AC-CHANGE-07。
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    await attachCustomer(tenant.org, hers.id, { name: '田中 花子' })
    await tenant.call('POST', `/api/staff/reservations/${hers.id}/cancel`, {
      version: 1,
      reason: 'customer',
    })

    const hidden = await tenant.call('GET', searchPath(tenant.storeId, { name: '田中' }))
    expect((hidden.body as unknown as SearchBody).items.map((item) => item.id)).not.toContain(
      hers.id,
    )

    const shown = await tenant.call(
      'GET',
      searchPath(tenant.storeId, { name: '田中', includeCancelled: '1' }),
    )
    expect((shown.body as unknown as SearchBody).items.map((item) => item.id)).toContain(hers.id)
  })

  it('理由を送らない要求は 400 で落ち、ご予約は元のまま残る', async () => {
    // AC-CHANGE-16。理由は必須で、既定値を持たない。
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    const before = await reservationRow(tenant.org, hers.id)

    const refused = await tenant.call('POST', `/api/staff/reservations/${hers.id}/cancel`, {
      version: 1,
    })
    expect(refused.status).toBe(400)
    expect(await reservationRow(tenant.org, hers.id)).toEqual(before)
    expect((await locksOf(tenant.org, hers.id)).length).toBeGreaterThan(0)
  })

  it('監査に reservation.cancelled が 1 行だけ増える', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    const before = await auditOf(tenant.org, hers.id)

    await tenant.call('POST', `/api/staff/reservations/${hers.id}/cancel`, {
      version: 1,
      reason: 'store',
    })

    const after = await auditOf(tenant.org, hers.id)
    expect(after).toHaveLength(before.length + 1)
    expect(after.filter((row) => row.action === 'reservation.cancelled')).toHaveLength(1)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 版の競合（EX-CONFLICT）
 * **409 は 1 行も書き換えない。**409 が返ることだけを見て終わらせない（AC-CHANGE-27）。
 * ─────────────────────────────────────────────────────────────────────────── */

describe('版の競合（変更）', () => {
  /** 相手が先に 14:00・中村 彩・相談カウンター 1 へ保存した状態を作る。 */
  async function savedByOther() {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    const first = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
      staffId: tenant.otherStaffId,
      equipmentIds: [tenant.equipmentB],
      purposeIds: [tenant.otherPurposeId],
    })
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    return { tenant, reservationId: hers.id }
  }

  it('古い版で送ると 409 version_conflict を返す', async () => {
    const { tenant, reservationId } = await savedByOther()

    const stale = await tenant.call('PATCH', `/api/staff/reservations/${reservationId}`, {
      version: 1,
      startsAt: AT_16,
    })
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ error: 'version_conflict' })
  })

  it('409 のとき reservations の日時・ご用件が先に保存した側のまま', async () => {
    const { tenant, reservationId } = await savedByOther()
    const saved = await reservationRow(tenant.org, reservationId)
    const savedPurposes = await purposeIdsOf(tenant.org, reservationId)

    const stale = await tenant.call('PATCH', `/api/staff/reservations/${reservationId}`, {
      version: 1,
      startsAt: AT_16,
      purposeIds: [tenant.purposeId],
    })
    expect(stale.status).toBe(409)

    expect(await reservationRow(tenant.org, reservationId)).toEqual(saved)
    expect(await purposeIdsOf(tenant.org, reservationId)).toEqual(savedPurposes)
    expect(savedPurposes).toEqual([tenant.otherPurposeId])
  })

  it('409 のとき reservation_assignments が先に保存した側の値のまま', async () => {
    const { tenant, reservationId } = await savedByOther()
    const saved = await assignmentsOf(tenant.org, reservationId)

    const stale = await tenant.call('PATCH', `/api/staff/reservations/${reservationId}`, {
      version: 1,
      staffId: tenant.staffId,
      equipmentIds: [tenant.equipmentA],
    })
    expect(stale.status).toBe(409)

    const after = await assignmentsOf(tenant.org, reservationId)
    expect(after).toEqual(saved)
    expect(after.find((band) => band.kind === 'staff')?.targetId).toBe(tenant.otherStaffId)
  })

  it('409 のとき reservation_slot_locks の行が先に保存した側のまま残っている', async () => {
    const { tenant, reservationId } = await savedByOther()
    const saved = await locksOf(tenant.org, reservationId)
    expect(saved.length).toBeGreaterThan(0)

    const stale = await tenant.call('PATCH', `/api/staff/reservations/${reservationId}`, {
      version: 1,
      startsAt: AT_16,
      staffId: tenant.staffId,
      equipmentIds: [tenant.equipmentA],
    })
    expect(stale.status).toBe(409)

    expect(await locksOf(tenant.org, reservationId)).toEqual(saved)
  })

  it('409 のとき audit_events の行が 1 行も増えていない', async () => {
    const { tenant, reservationId } = await savedByOther()
    const saved = await auditOf(tenant.org, reservationId)

    const stale = await tenant.call('PATCH', `/api/staff/reservations/${reservationId}`, {
      version: 1,
      startsAt: AT_16,
    })
    expect(stale.status).toBe(409)

    // 条件が外れたのに監査だけ残ると、起きなかった操作が記録に残る。
    expect(await auditOf(tenant.org, reservationId)).toEqual(saved)
  })
})

describe('版の競合（取消）', () => {
  it('古い版で取り消すと 409 version_conflict を返す', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    const moved = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
    })
    expect(moved.status).toBe(200)

    const stale = await tenant.call('POST', `/api/staff/reservations/${hers.id}/cancel`, {
      version: 1,
      reason: 'customer',
    })
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ error: 'version_conflict' })
  })

  it('409 のとき予約は confirmed のままで、枠のロックも消えていない', async () => {
    // **409 が二重予約を作らない。**枠だけ空くと、同じ時刻をもう 1 件に案内できてしまう。
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
    })
    const saved = await reservationRow(tenant.org, hers.id)
    const savedLocks = await locksOf(tenant.org, hers.id)
    const savedAudit = await auditOf(tenant.org, hers.id)

    const stale = await tenant.call('POST', `/api/staff/reservations/${hers.id}/cancel`, {
      version: 1,
      reason: 'customer',
    })
    expect(stale.status).toBe(409)

    const after = await reservationRow(tenant.org, hers.id)
    expect(after).toEqual(saved)
    expect(after.status).toBe('confirmed')
    expect(after.cancelledAt).toBeNull()
    expect(await locksOf(tenant.org, hers.id)).toEqual(savedLocks)
    expect(savedLocks.length).toBeGreaterThan(0)
    expect(await auditOf(tenant.org, hers.id)).toEqual(savedAudit)
  })
})

describe('版の競合', () => {
  it('409 の応答に相手の現在の version が載る（画面が読み直さずに済む）', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
    })

    const staleChange = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_16,
    })
    expect(staleChange.status).toBe(409)
    expect(staleChange.body).toMatchObject({
      error: 'version_conflict',
      current: { version: 2, startsAt: AT_14 },
    })

    const staleCancel = await tenant.call('POST', `/api/staff/reservations/${hers.id}/cancel`, {
      version: 1,
      reason: 'customer',
    })
    expect(staleCancel.status).toBe(409)
    expect(staleCancel.body).toMatchObject({
      error: 'version_conflict',
      current: { version: 2, startsAt: AT_14 },
    })
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 検索の絞り込み（CHANGE-SEARCH の 3 つの欄と絞り込みの札）
 *
 * かなと `LIKE` の組み立ては断片だけを見ても足りない。`LIKE ? ESCAPE '\'` は
 * 1 文字違えば 500 に化けるし、パターンを値として渡していなければ `%` を打った
 * 検索が全件に化ける。**実物の D1 に投げて当たるところまで**見る。
 * ─────────────────────────────────────────────────────────────────────────── */

/** 検索が当たるお客様を 1 人置いた、11:00 のご予約。 */
async function bookedFor(
  tenant: Awaited<ReturnType<typeof changeTenant>>,
  seed: { name: string; kana?: string; phone?: string; visitCount?: number },
  startsAt = AT_11,
): Promise<Booked> {
  const booked = await book(tenant, { startsAt })
  await attachCustomer(tenant.org, booked.id, seed)
  return booked
}

const idsOf = (body: unknown): string[] => (body as SearchBody).items.map((item) => item.id)

describe('検索の絞り込み', () => {
  it('かなで打っても漢字で登録されたお客様が当たる', async () => {
    // AC-CHANGE-02。画面に かな 専用の欄は無いので、「お名前」の 1 欄が
    // `c.name` と `c.kana` の両方に当たらないと 0 件になる。
    const tenant = await changeTenant()
    const hers = await bookedFor(tenant, { name: '田中 花子', kana: 'たなか はなこ' })

    const byKana = await tenant.call('GET', searchPath(tenant.storeId, { name: 'たなか はなこ' }))
    expect(byKana.status).toBe(200)
    expect(idsOf(byKana.body)).toEqual([hers.id])

    // 途中まででも当たる（お客様は名字だけを読み上げてくださることがある）。
    const partial = await tenant.call('GET', searchPath(tenant.storeId, { name: 'たなか' }))
    expect(idsOf(partial.body)).toEqual([hers.id])
  })

  it('お電話番号は下 4 桁の完全一致でも全桁の前方一致でも当たる', async () => {
    // AC-CHANGE-03。下 4 桁は `phone_last4`、5 桁以上は `phone_normalized` の前方一致。
    const tenant = await changeTenant()
    const hers = await bookedFor(tenant, { name: '田中 花子', phone: '090-1234-5678' })
    const his = await bookedFor(tenant, { name: '田中 一郎', phone: '090-1234-5670' }, AT_16)

    const byLast4 = await tenant.call('GET', searchPath(tenant.storeId, { phone: '5678' }))
    expect(byLast4.status).toBe(200)
    expect(idsOf(byLast4.body)).toEqual([hers.id])

    // 全桁は前方一致。読み上げていただいた 11 桁はその 1 人だけに当たる。
    const byFull = await tenant.call('GET', searchPath(tenant.storeId, { phone: '090-1234-5678' }))
    expect(idsOf(byFull.body)).toEqual([hers.id])

    // 先頭 10 桁は 2 人に共通する。前方一致なので両方が並ぶ。
    const bothPrefix = await tenant.call('GET', searchPath(tenant.storeId, { phone: '0901234567' }))
    expect(idsOf(bothPrefix.body).sort()).toEqual([hers.id, his.id].sort())
  })

  it('お名前に % を打っても全件に化けない', async () => {
    // `LIKE` のパターンは SQL の中で連結せず値として渡し、記号を殺してある。
    // 素通しすると「%」の 1 文字が店舗のご予約を全部並べる。
    const tenant = await changeTenant()
    await bookedFor(tenant, { name: '田中 花子', kana: 'たなか はなこ' })

    const wild = await tenant.call('GET', searchPath(tenant.storeId, { name: '%' }))
    expect(wild.status).toBe(200)
    expect((wild.body as SearchBody).total).toBe(0)
    expect(idsOf(wild.body)).toEqual([])
  })

  it('期間を当日に絞ると、ほかの日のご予約が消える', async () => {
    // AC-CHANGE-06。絞り込みの「今日」は `from` / `to` を当日にするだけである。
    const tenant = await changeTenant()
    // どちらも D1 に直に置く（この面が見るのは検索の条件だけである）。
    const today = await insertReservation(tenant.org, {
      storeId: tenant.storeId,
      startsAt: AT_11,
      durationMinutes: 60,
      staffId: tenant.staffId,
      purposes: [{ id: tenant.purposeId }],
    })
    await attachCustomer(tenant.org, today, { name: '田中 花子' })
    const nextWeek = await insertReservation(tenant.org, {
      storeId: tenant.storeId,
      startsAt: jstAt('2026-09-03', '11:00'),
      durationMinutes: 60,
      staffId: tenant.staffId,
      purposes: [{ id: tenant.purposeId }],
    })
    await attachCustomer(tenant.org, nextWeek, { name: '田中 太郎' })

    const all = await tenant.call('GET', searchPath(tenant.storeId, { name: '田中' }))
    expect(idsOf(all.body).sort()).toEqual([today, nextWeek].sort())

    const onlyToday = await tenant.call(
      'GET',
      searchPath(tenant.storeId, { name: '田中', from: LEDGER_DATE, to: LEDGER_DATE }),
    )
    expect(idsOf(onlyToday.body)).toEqual([today])
    expect((onlyToday.body as SearchBody).total).toBe(1)
    // 1 件以上あるので候補は付かない。
    expect((onlyToday.body as SearchBody).relaxations).toEqual([])
  })

  it('結果は開始時刻の昇順で、同時刻はお客様名の昇順で並ぶ', async () => {
    // AC-CHANGE-01 の並び。`ORDER BY` と純関数の並べ替えが同じ答えを出すこと。
    const tenant = await changeTenant()
    const seed = async (time: string, name: string) => {
      const id = await insertReservation(tenant.org, {
        storeId: tenant.storeId,
        startsAt: jstAt(LEDGER_DATE, time),
        durationMinutes: 60,
        staffId: null,
        purposes: [{ id: tenant.purposeId }],
      })
      await attachCustomer(tenant.org, id, { name })
      return id
    }
    const hanako = await seed('11:00', '田中 花子')
    const ichiro = await seed('11:00', '田中 一郎')
    const taro = await seed('09:30', '田中 太郎')

    const found = await tenant.call('GET', searchPath(tenant.storeId, { name: '田中' }))
    // 09:30 → 11:00（一郎 → 花子）。同時刻の並びを id 任せにしない。
    expect(idsOf(found.body)).toEqual([taro, ichiro, hanako])
  })

  it('店舗を選ばずに探すと 400、ほかのテナントの店舗 id は 404 になる', async () => {
    const tenant = await changeTenant()
    const stranger = await changeTenant('B 銀座店')

    const noStore = await tenant.call('GET', '/api/staff/reservations')
    expect(noStore.status).toBe(400)

    // 403 にしない（他社の店舗が「ある」ことを漏らさない）。
    const foreign = await tenant.call('GET', searchPath(stranger.storeId, { name: '田中' }))
    expect(foreign.status).toBe(404)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 版の競合の出口（EX-CONFLICT の「相手の内容を残す」「あなたの内容で上書きする」）
 * ─────────────────────────────────────────────────────────────────────────── */

describe('版の競合（読み直しと上書き）', () => {
  it('409 の応答に相手の日時・担当・場所・保存した人が載る', async () => {
    // AC-CHANGE-19。左に相手・右に自分を並べるので、相手の内容が 409 に載っていないと
    // 画面はご予約 1 件を取り直す往復を足すことになる。
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    const saved = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
      staffId: tenant.otherStaffId,
      equipmentIds: [tenant.equipmentB],
    })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)

    const stale = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_16,
    })
    expect(stale.status).toBe(409)
    const body = stale.body as unknown as {
      error: string
      current: {
        version: number
        startsAt: string
        endsAt: string
        staffName: string | null
        equipmentNames: string[]
        savedAt: string
        savedBy: string | null
      }
    }
    expect(body.error).toBe('version_conflict')
    expect(body.current).toMatchObject({
      version: 2,
      startsAt: AT_14,
      staffName: '中村 彩',
      equipmentNames: ['相談カウンター 1'],
      // 「受付iPad の 佐藤 美咲 が 11:06 に保存しました。」の人。
      savedBy: '佐藤 美咲',
    })
    expect(body.current.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    // **どちらの内容もまだ選ばれていない。**自分の 16:00 は 1 行も入っていない。
    expect((await reservationRow(tenant.org, hers.id)).startsAt).toBe(AT_14)
  })

  it('相手の版で送り直すと、あなたの内容で上書きできる', async () => {
    // AC-CHANGE-20。409 は行き止まりではない。相手の版を載せ直せば通る。
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    const saved = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
    })
    expect(saved.status).toBe(200)

    const stale = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_16,
    })
    expect(stale.status).toBe(409)
    const current = (stale.body as unknown as { current: { version: number } }).current

    const overwritten = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: current.version,
      startsAt: AT_16,
    })
    expect(overwritten.status, JSON.stringify(overwritten.body)).toBe(200)

    const row = await reservationRow(tenant.org, hers.id)
    expect(row.startsAt).toBe(AT_16)
    expect(row.version).toBe(3)
    expect(row.code).toBe(hers.code)
    // 相手が押さえていた 14:00 の枠は 1 行も残らない（残ると 14:00 が翌朝まで埋まる）。
    const locks = await locksOf(tenant.org, hers.id)
    expect(locks.filter((lock) => lock.slotStart === AT_14)).toEqual([])
    expect(locks.filter((lock) => lock.slotStart === AT_16).length).toBeGreaterThan(0)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 取り消したあと（2 度目の取消・取り消したご予約の変更）
 * 版が合っていても書き換えない。版だけでは「同じ版のまま理由を上書きする」
 * 2 度目の取消も、返した枠を押さえ直す変更も止められない。
 * ─────────────────────────────────────────────────────────────────────────── */

describe('取り消したご予約', () => {
  it('もう一度取り消しても 409 で、理由も監査も上書きされない', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    const first = await tenant.call('POST', `/api/staff/reservations/${hers.id}/cancel`, {
      version: 1,
      reason: 'customer',
    })
    expect(first.status).toBe(200)
    const saved = await reservationRow(tenant.org, hers.id)
    const savedAudit = await auditOf(tenant.org, hers.id)

    // 古い版でも、いまの版でも断る（版だけでは 2 度目の取消を止められない）。
    for (const version of [1, saved.version]) {
      const again = await tenant.call('POST', `/api/staff/reservations/${hers.id}/cancel`, {
        version,
        reason: 'store',
      })
      expect(again.status, `version ${version}`).toBe(409)
      expect(again.body).toMatchObject({ error: 'version_conflict' })
    }

    expect(await reservationRow(tenant.org, hers.id)).toEqual(saved)
    expect(saved.cancelReason).toBe('customer')
    expect(await auditOf(tenant.org, hers.id)).toEqual(savedAudit)
  })

  it('取り消したご予約は変更できず、返した枠を押さえ直さない', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    const cancelled = await tenant.call('POST', `/api/staff/reservations/${hers.id}/cancel`, {
      version: 1,
      reason: 'customer',
    })
    expect(cancelled.status).toBe(200)
    const saved = await reservationRow(tenant.org, hers.id)
    expect(await locksOf(tenant.org, hers.id)).toEqual([])

    const refused = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: saved.version,
      startsAt: AT_14,
    })
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({ error: 'invalid_transition' })

    // 取り消したご予約が枠を押さえ直すと、その時刻が誰にも案内できないまま埋まる。
    expect(await locksOf(tenant.org, hers.id)).toEqual([])
    expect(await reservationRow(tenant.org, hers.id)).toEqual(saved)
    expect(await assignmentsOf(tenant.org, hers.id)).toHaveLength(2)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * ご用件の所要は予約した時点の写しである
 * ─────────────────────────────────────────────────────────────────────────── */

describe('ご用件の所要', () => {
  it('日時だけを変えても、ご用件の所要は予約した時点の写しのまま動かない', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })

    // 設定でご用件の所要を 90 分へ直す（P4 の SETTINGS-PURPOSES と同じ列である）。
    await env.DB.prepare('UPDATE visit_purposes SET duration_minutes = 90 WHERE id = ?')
      .bind(tenant.purposeId)
      .run()

    const changed = await tenant.call('PATCH', `/api/staff/reservations/${hers.id}`, {
      version: 1,
      startsAt: AT_14,
    })
    expect(changed.status, JSON.stringify(changed.body)).toBe(200)

    // ご予約まるごとの所要も、ご用件 1 行の所要も、予約した時点の 60 分のまま。
    expect((await reservationRow(tenant.org, hers.id)).durationMinutes).toBe(60)
    const lines = await env.DB.prepare(
      'SELECT duration_minutes AS durationMinutes FROM reservation_purposes ' +
        'WHERE organization_id = ? AND reservation_id = ? ORDER BY sort_order',
    )
      .bind(tenant.org, hers.id)
      .all<{ durationMinutes: number }>()
    expect(lines.results.map((line) => line.durationMinutes)).toEqual([60])
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 0 件の緩和候補（EX-EMPTY-SEARCH「条件をひとつ外すと見つかります」）
 * ─────────────────────────────────────────────────────────────────────────── */

describe('緩和候補の取りこぼし', () => {
  it('外せる条件が 3 つとも当たるときは 3 つとも並ぶ（黙って落ちる案が無い）', async () => {
    // 案は「緩めた条件をそのまま数え直す」形で作る。数え直しの入口で条件が契約を
    // 通らないと、その案だけが**黙って**消えて「ほかの探し方」しか残らない。
    const tenant = await changeTenant()
    const seed = async (input: {
      at: string
      name: string
      source: 'phone' | 'web'
      status?: 'cancelled'
    }) => {
      const id = await insertReservation(tenant.org, {
        storeId: tenant.storeId,
        startsAt: input.at,
        durationMinutes: 60,
        staffId: null,
        source: input.source,
        status: input.status,
        purposes: [{ id: tenant.purposeId }],
      })
      await attachCustomer(tenant.org, id, { name: input.name })
      return id
    }
    // 期間を広げると当たる（8/28 の Web のご予約）。
    const wider = await seed({ at: jstAt('2026-08-28', '11:00'), name: '田中 広子', source: 'web' })
    // 出どころを外すと当たる（当日のお電話のご予約）。
    const byPhone = await seed({ at: AT_11, name: '田中 花子', source: 'phone' })
    // 取消を含めると当たる（当日の取り消された Web のご予約）。
    const cancelled = await seed({
      at: AT_14,
      name: '田中 太郎',
      source: 'web',
      status: 'cancelled',
    })

    const params = {
      name: '田中',
      from: LEDGER_DATE,
      to: LEDGER_DATE,
      source: 'web',
    }
    const empty = await tenant.call('GET', searchPath(tenant.storeId, params))
    expect(empty.status).toBe(200)
    const body = empty.body as unknown as SearchBody
    expect(body.total).toBe(0)
    expect(body.relaxations.map((relaxation) => relaxation.label)).toEqual([
      '期間を 8月1日 〜 9月30日 に広げる',
      '「Web予約だけ」を外す',
      '取り消されたご予約も含める',
    ])
    expect(body.relaxations.map((relaxation) => relaxation.count)).toEqual([1, 1, 1])

    // 押したあとに出る 1 件は、案が数えた 1 件と同じご予約である。
    const hits: Record<string, string> = {
      '期間を 8月1日 〜 9月30日 に広げる': wider,
      '「Web予約だけ」を外す': byPhone,
      取り消されたご予約も含める: cancelled,
    }
    for (const relaxation of body.relaxations) {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(relaxation.query)) {
        if (value === undefined || value === null) continue
        query.set(key, Array.isArray(value) ? value.join(',') : String(value))
      }
      const again = await tenant.call('GET', `/api/staff/reservations?${query.toString()}`)
      expect(again.status, relaxation.label).toBe(200)
      expect(idsOf(again.body), relaxation.label).toEqual([hits[relaxation.label]])
    }
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * ほかの端末の仮の押さえ（AC-CHANGE-12）
 *
 * 押さえは KV に置く。**この経路だけは純関数のテストでは守れない** — 鍵の形や
 * `KV.list` の読み方が 1 文字ずれても盤面の unit テストは全部緑のまま通り、
 * 店では「別の端末が押さえている枠へもう 1 件を案内できる」に化ける。
 * ─────────────────────────────────────────────────────────────────────────── */

describe('ほかの端末の仮の押さえ', () => {
  it('押さえた 14:00 は空き枠から外れ、いまのご予約は 11:00 のまま残る', async () => {
    const tenant = await changeTenant()
    const hers = await book(tenant, { startsAt: AT_11 })
    const slots = async () => {
      const found = await tenant.call(
        'GET',
        `/api/staff/availability?storeId=${tenant.storeId}&date=${LEDGER_DATE}` +
          `&purposeIds=${tenant.purposeId}&staffId=${tenant.staffId}` +
          `&excludeReservationId=${hers.id}`,
      )
      expect(found.status).toBe(200)
      const body = found.body as unknown as {
        slots: { startsAt: string; isAvailable: boolean }[]
      }
      return body.slots
    }
    expect((await slots()).find((slot) => slot.startsAt === AT_14)?.isAvailable).toBe(true)

    // 別の端末が 佐藤 美咲 の 14:00 を押さえる（同時 1 件）。
    const held = await tenant.call('POST', '/api/staff/holds', {
      storeId: tenant.storeId,
      startsAt: AT_14,
      durationMinutes: 60,
      staffId: tenant.staffId,
    })
    expect(held.status, JSON.stringify(held.body)).toBe(200)

    expect((await slots()).find((slot) => slot.startsAt === AT_14)?.isAvailable).toBe(false)
    // 押さえはご予約を 1 行も動かさない（「EY-2608-0142 はまだ 11:00–12:00 のまま」）。
    expect((await reservationRow(tenant.org, hers.id)).startsAt).toBe(AT_11)

    // 押さえを外すと 14:00 が戻る（押さえっぱなしで枠が死なない）。
    const holdId = (held.body as unknown as { id: string }).id
    const released = await tenant.call(
      'DELETE',
      `/api/staff/holds/${holdId}?storeId=${tenant.storeId}`,
    )
    expect(released.status).toBe(200)
    expect((await slots()).find((slot) => slot.startsAt === AT_14)?.isAvailable).toBe(true)
  })
})
