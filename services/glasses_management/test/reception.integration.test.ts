/**
 * 来店受付とウォークインの 7 ルートを**実 D1** で通す。
 *
 * 見たいのは 1 本の線である —「お客様を特定しないまま受け付け、接客を始め、あとから
 * お客様へ結びつけ、退店し、翌日に受付履歴で見つけ直す」。この線のどこか 1 か所でも
 * お客様の登録を求めると、入口に立っているお客様をお待たせしたまま画面が止まる
 * （US-RECEP-02 / AC-RECEP-05）。
 *
 * 同時受付の上限も同じ理由でここに置く。担当を決めずに受け付ける 2 人目が 409 で
 * 落ちる実装は、**目の前のお客様を受け付けられない画面**になる（AC-RECEP-29）。
 * 上限ちょうどと +1 件目の両方を実 D1 で確かめる。
 *
 * D1 はテストファイル内で共有されるので、組織 id・電話番号は毎回
 * `crypto.randomUUID()` から作る。時刻は body の `arrivedAt` / `occurredAt` で
 * 明示的に渡し、**実時刻を読まない**。
 */
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import {
  authed,
  BASE,
  FIXED_NOW,
  insertBusinessHours,
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

/** モックが描いている 1 日の前日（受付履歴を「期間を広げて」見つける材料）。 */
const PREV_DATE = '2026-08-26'

type Json = Record<string, unknown>

/** 受け付けられる店舗ひとそろい。同時受付の上限は既定で 3（銀座店と同じ）。 */
async function receptionTenant(input: { maxParallel?: number } = {}) {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await insertStore(org)
  await insertBusinessHours(org, storeId)
  await insertSlotRules(org, storeId, {
    slotMinutes: 30,
    cleanupMinutes: 10,
    maxParallel: input.maxParallel ?? 3,
  })
  const staffId = await insertStaff(org, storeId, {
    displayName: '中村 彩',
    maxParallelReservations: 1,
  })
  await insertShift(org, storeId, staffId)
  const purposeId = await insertVisitPurpose(org, storeId, {
    nameInternal: 'メガネを新しく作る',
    nameShort: '新調相談',
    durationMinutes: 60,
  })
  return { org, token, storeId, staffId, purposeId }
}

/**
 * お客様 1 名を D1 へ直に置く。電話番号は毎回作る（下 4 桁の検索が
 * 別のテストのお客様に当たらないようにするため）。
 */
async function seedCustomer(
  org: string,
  input: { name: string; kana: string; phone: string; customerNumber?: string },
): Promise<string> {
  const id = crypto.randomUUID()
  const normalized = input.phone.replace(/\D/g, '')
  await env.DB.prepare(
    'INSERT INTO customers (id, organization_id, customer_number, name, kana, phone, phone_normalized, phone_last4, email, birth_date, address, memo, first_visit_at, last_visit_at, visit_count, merged_into_id, version, created_store_id, created_terminal_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,NULL,NULL,0,NULL,1,NULL,NULL,?,?)',
  )
    .bind(
      id,
      org,
      input.customerNumber ?? `G-${String(Math.floor(Math.random() * 90000) + 10000)}`,
      input.name,
      input.kana,
      input.phone,
      normalized,
      normalized.slice(-4),
      '',
      jstAt(LEDGER_DATE, '09:00'),
      jstAt(LEDGER_DATE, '09:00'),
    )
    .run()
  return id
}

/* --- 7 ルートを叩く道具 --------------------------------------------------- */

async function createWalkin(
  token: string,
  body: Json,
  idempotencyKey?: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: Json }> {
  const res = await SELF.fetch(`${BASE}/api/staff/walkins`, {
    method: 'POST',
    headers:
      idempotencyKey === undefined
        ? { ...authed(token), ...extraHeaders }
        : { ...authed(token), ...extraHeaders, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json }
}

async function listWalkins(
  token: string,
  query: { storeId: string; date: string; status?: string },
): Promise<{ status: number; items: Json[] }> {
  const status = query.status === undefined ? '' : `&status=${query.status}`
  const res = await SELF.fetch(
    `${BASE}/api/staff/walkins?storeId=${query.storeId}&date=${query.date}${status}`,
    { headers: authed(token) },
  )
  return { status: res.status, items: (await res.json().catch(() => [])) as Json[] }
}

async function patchWalkin(
  token: string,
  walkinId: string,
  body: Json,
): Promise<{ status: number; body: Json }> {
  const res = await SELF.fetch(`${BASE}/api/staff/walkins/${walkinId}`, {
    method: 'PATCH',
    headers: authed(token),
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json }
}

async function postVisit(
  token: string,
  body: Json,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: Json }> {
  const res = await SELF.fetch(`${BASE}/api/staff/visits`, {
    method: 'POST',
    headers: { ...authed(token), ...extraHeaders },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json }
}

type BoardRow = {
  subjectType: string
  subjectId: string
  displayName: string
  visitCount: number | null
  isWaitingTooLong: boolean
  cells: { stage: string; state: string; at: string | null; label: string }[]
}

async function readBoard(
  token: string,
  query: { storeId: string; date: string; scope?: 'active' | 'all' },
): Promise<{ status: number; activeCount: number; rows: BoardRow[]; serverNow: string }> {
  const scope = query.scope === undefined ? '' : `&scope=${query.scope}`
  const res = await SELF.fetch(
    `${BASE}/api/staff/visits/board?storeId=${query.storeId}&date=${query.date}${scope}`,
    { headers: authed(token) },
  )
  const body = (await res.json().catch(() => ({}))) as {
    activeCount?: number
    rows?: BoardRow[]
    serverNow?: string
  }
  return {
    status: res.status,
    activeCount: body.activeCount ?? -1,
    rows: body.rows ?? [],
    serverNow: body.serverNow ?? '',
  }
}

type HistoryEntry = {
  entryId: string
  sessionId: string | null
  startedAt: string
  displayName: string
  reservationStatus: string | null
}

async function readHistory(
  token: string,
  query: Record<string, string>,
): Promise<{
  status: number
  items: HistoryEntry[]
  total: number
  nextCursor: string | null
  relaxations: { label: string; count: number; query: Record<string, unknown> }[]
}> {
  const search = new URLSearchParams(query).toString()
  const res = await SELF.fetch(`${BASE}/api/staff/reception-sessions?${search}`, {
    headers: authed(token),
  })
  const body = (await res.json().catch(() => ({}))) as {
    items?: HistoryEntry[]
    total?: number
    nextCursor?: string | null
    relaxations?: { label: string; count: number; query: Record<string, unknown> }[]
  }
  return {
    status: res.status,
    items: body.items ?? [],
    total: body.total ?? -1,
    nextCursor: body.nextCursor ?? null,
    relaxations: body.relaxations ?? [],
  }
}

async function readHistoryDetail(
  token: string,
  entryId: string,
): Promise<{ status: number; body: Json }> {
  const res = await SELF.fetch(`${BASE}/api/staff/reception-sessions/${entryId}`, {
    headers: authed(token),
  })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json }
}

async function readLedger(
  token: string,
  query: { storeId: string; date: string },
): Promise<{ status: number; body: Json }> {
  const res = await SELF.fetch(
    `${BASE}/api/staff/ledger?storeId=${query.storeId}&date=${query.date}`,
    { headers: authed(token) },
  )
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json }
}

/** その店舗・その日のウォークインの行を D1 から読み直す。 */
async function walkinRows(org: string, storeId: string, visitDate: string) {
  const found = await env.DB.prepare(
    'SELECT id, ticket_no AS ticketNo, status, left_at AS leftAt, customer_id AS customerId, reservation_id AS reservationId, version FROM walk_ins WHERE organization_id = ? AND store_id = ? AND visit_date = ? ORDER BY ticket_no',
  )
    .bind(org, storeId, visitDate)
    .all<{
      id: string
      ticketNo: number
      status: string
      leftAt: string | null
      customerId: string | null
      reservationId: string
      version: number
    }>()
  return found.results
}

/** その対象に積まれた工程を発生順に読む（追記だけであることを確かめる）。 */
async function visitEventRows(org: string, subjectId: string) {
  const found = await env.DB.prepare(
    'SELECT id, stage, occurred_at AS occurredAt, note, staff_id AS staffId FROM visit_events WHERE organization_id = ? AND subject_id = ? ORDER BY occurred_at, id',
  )
    .bind(org, subjectId)
    .all<{
      id: string
      stage: string
      occurredAt: string
      note: string | null
      staffId: string | null
    }>()
  return found.results
}

/** ウォークイン 1 件を「お客様を特定しないまま」受け付ける既定の本文。 */
const walkinBody = (storeId: string, time: string, extra: Json = {}): Json => ({
  storeId,
  purposeNote: 'フレームの相談',
  arrivedAt: jstAt(LEDGER_DATE, time),
  startsAt: jstAt(LEDGER_DATE, `${time.slice(0, 3)}00`),
  durationMinutes: 20,
  staffId: null,
  ...extra,
})

async function seedTerminalSession(
  tenant: Awaited<ReturnType<typeof receptionTenant>>,
  mode: 'shared' | 'personal',
) {
  const terminalId = crypto.randomUUID()
  const sessionToken = (mode === 'shared' ? 'q' : 'r').repeat(64)
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionToken)),
  )
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  const credentialHash = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  await env.DB.prepare(
    "INSERT INTO terminals (id, organization_id, store_id, name, kind, auto_lock_seconds, is_active, version, created_at) VALUES (?,?,?,'銀座店 レジ横iPad','shared',120,'1',1,?)",
  )
    .bind(terminalId, tenant.org, tenant.storeId, FIXED_NOW)
    .run()
  await env.DB.prepare(
    'INSERT INTO terminal_sessions (id, organization_id, store_id, terminal_id, staff_id, mode, credential_hash, started_at, expires_at, revoked_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?)',
  )
    .bind(
      crypto.randomUUID(),
      tenant.org,
      tenant.storeId,
      terminalId,
      mode === 'personal' ? tenant.staffId : null,
      mode,
      credentialHash,
      FIXED_NOW,
      mode === 'personal' ? '2026-08-27T02:10:00.000Z' : '2026-08-28T02:08:00.000Z',
      FIXED_NOW,
    )
    .run()
  return {
    terminalId,
    sessionToken,
    headers: { 'x-terminal-id': terminalId, 'x-terminal-session': sessionToken },
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * T-009 代表フロー
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('ウォークインの受付', () => {
  it('お客様を特定しないまま受け付けると、整理番号つきで台帳に載る', async () => {
    const t = await receptionTenant()
    const created = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))

    expect(created.status).toBe(200)
    expect(created.body).toMatchObject({
      ticketNo: 1,
      customerId: null,
      status: 'waiting',
      arrivedAt: jstAt(LEDGER_DATE, '11:02'),
      leftAt: null,
    })
    expect(typeof created.body.reservationId).toBe('string')

    const ledger = await readLedger(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    expect(ledger.body).toMatchObject({ walkinWaitingCount: 1, nextTicketNo: 2 })
  })

  it('共有sessionはwalk-in作成の全監査を端末主体にし、invalid pairは書込みも監査も拒む', async () => {
    const t = await receptionTenant()
    const shared = await seedTerminalSession(t, 'shared')
    const created = await createWalkin(
      t.token,
      walkinBody(t.storeId, '11:02'),
      undefined,
      shared.headers,
    )
    expect(created.status).toBe(200)
    const audits = await env.DB.prepare(
      "SELECT action, actor_type AS actorType, actor_id AS actorId, terminal_id AS terminalId FROM audit_events WHERE organization_id = ? AND action IN ('reservation.created','walkin.created') ORDER BY action",
    )
      .bind(t.org)
      .all<{ action: string; actorType: string; actorId: string; terminalId: string }>()
    expect(audits.results).toHaveLength(2)
    for (const audit of audits.results) {
      expect(audit).toMatchObject({
        actorType: 'terminal',
        actorId: shared.terminalId,
        terminalId: shared.terminalId,
      })
    }

    const denied = await createWalkin(t.token, walkinBody(t.storeId, '11:32'), undefined, {
      'x-terminal-id': shared.terminalId,
    })
    expect(denied.status).toBe(403)
    expect(denied.body).toEqual({ error: 'terminal_session_invalid' })
    expect(await walkinRows(t.org, t.storeId, LEDGER_DATE)).toHaveLength(1)
  })

  it('個人sessionはreception stage変更を本人主体・端末付きで監査する', async () => {
    const t = await receptionTenant()
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    const personal = await seedTerminalSession(t, 'personal')
    const changed = await postVisit(
      t.token,
      {
        storeId: t.storeId,
        subjectType: 'walkin',
        subjectId: walkin.body.id,
        stage: 'consulting',
        occurredAt: jstAt(LEDGER_DATE, '11:05'),
        staffId: t.staffId,
      },
      personal.headers,
    )
    expect(changed.status).toBe(200)
    const audit = await env.DB.prepare(
      "SELECT actor_type AS actorType, actor_id AS actorId, terminal_id AS terminalId FROM audit_events WHERE organization_id = ? AND action = 'visit.stage.changed' AND target_id = ?",
    )
      .bind(t.org, walkin.body.id)
      .first<{ actorType: string; actorId: string; terminalId: string }>()
    expect(audit).toEqual({
      actorType: 'staff',
      actorId: t.staffId,
      terminalId: personal.terminalId,
    })
  })

  it("同じ操作で source='walkin' の予約と枠の占有が 1 件ずつできる", async () => {
    const t = await receptionTenant()
    const created = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    const reservationId = created.body.reservationId as string

    const reservation = await env.DB.prepare(
      'SELECT source, status, starts_at AS startsAt FROM reservations WHERE organization_id = ? AND id = ?',
    )
      .bind(t.org, reservationId)
      .first<{ source: string; status: string; startsAt: string }>()
    expect(reservation).toMatchObject({ source: 'walkin', startsAt: jstAt(LEDGER_DATE, '11:00') })

    const locks = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ?',
    )
      .bind(t.org, reservationId)
      .first<{ n: number }>()
    expect(locks?.n ?? 0).toBeGreaterThan(0)

    const rows = await walkinRows(t.org, t.storeId, LEDGER_DATE)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.reservationId).toBe(reservationId)
  })

  it('4 択に無いご用件は自由記述だけが残る', async () => {
    const t = await receptionTenant()
    const created = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    expect(created.body).toMatchObject({ purposeId: null, purposeNote: 'フレームの相談' })

    const chosen = await createWalkin(
      t.token,
      walkinBody(t.storeId, '11:32', {
        purposeNote: undefined,
        purposeId: t.purposeId,
        durationMinutes: 60,
      }),
    )
    expect(chosen.body).toMatchObject({ purposeId: t.purposeId, purposeNote: null })
  })

  it('受付時に選んだ顧客を予約にも保存し、退店後の来店回数へ反映する', async () => {
    const t = await receptionTenant()
    const customerId = await seedCustomer(t.org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: `090-2222-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    })
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02', { customerId }))
    const reservation = await env.DB.prepare(
      'SELECT customer_id AS customerId FROM reservations WHERE organization_id = ? AND id = ?',
    )
      .bind(t.org, walkin.body.reservationId)
      .first<{ customerId: string | null }>()
    expect(reservation?.customerId).toBe(customerId)

    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'consulting',
      occurredAt: jstAt(LEDGER_DATE, '11:05'),
    })
    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'left',
      occurredAt: jstAt(LEDGER_DATE, '12:05'),
    })
    const customer = await env.DB.prepare(
      'SELECT visit_count AS visitCount FROM customers WHERE organization_id = ? AND id = ?',
    )
      .bind(t.org, customerId)
      .first<{ visitCount: number }>()
    expect(customer?.visitCount).toBe(1)
  })

  it('同じ Idempotency-Key の再送は同じ整理番号の同じ 1 件を返す', async () => {
    const t = await receptionTenant()
    const key = crypto.randomUUID()
    const body = walkinBody(t.storeId, '11:02')

    const first = await createWalkin(t.token, body, key)
    const again = await createWalkin(t.token, body, key)

    expect(first.status).toBe(200)
    expect(again.status).toBe(200)
    expect(again.body).toEqual(first.body)
    expect(await walkinRows(t.org, t.storeId, LEDGER_DATE)).toHaveLength(1)
  })

  it('同じ Idempotency-Key の再送は受付後に目的設定が削除されても保存済み応答を返す', async () => {
    const t = await receptionTenant()
    const key = crypto.randomUUID()
    const body = walkinBody(t.storeId, '11:02', {
      purposeNote: undefined,
      purposeId: t.purposeId,
      durationMinutes: 60,
    })

    const first = await createWalkin(t.token, body, key)
    expect(first.status).toBe(200)
    await env.DB.prepare('DELETE FROM visit_purposes WHERE organization_id = ? AND id = ?')
      .bind(t.org, t.purposeId)
      .run()

    const replay = await createWalkin(t.token, body, key)
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(first.body)
    expect(await walkinRows(t.org, t.storeId, LEDGER_DATE)).toHaveLength(1)
  })

  it('目的の所要時間より短い durationMinutes では枠を過少占有しない', async () => {
    const t = await receptionTenant()
    const created = await createWalkin(
      t.token,
      walkinBody(t.storeId, '11:02', {
        purposeNote: undefined,
        purposeId: t.purposeId,
        durationMinutes: 55,
      }),
    )

    expect(created.status).toBe(422)
    expect(await walkinRows(t.org, t.storeId, LEDGER_DATE)).toHaveLength(0)
  })

  it('同じキーで中身が違う再送は 409 idempotency_conflict', async () => {
    const t = await receptionTenant()
    const key = crypto.randomUUID()

    await createWalkin(t.token, walkinBody(t.storeId, '11:02'), key)
    const other = await createWalkin(
      t.token,
      walkinBody(t.storeId, '11:02', { purposeNote: 'レンズだけ替えたい' }),
      key,
    )

    expect(other.status).toBe(409)
    expect(other.body).toMatchObject({ error: 'idempotency_conflict' })
    expect(await walkinRows(t.org, t.storeId, LEDGER_DATE)).toHaveLength(1)
  })

  it('「いまお待ち N名」は当日の waiting だけを数え、前日の行を数えない', async () => {
    const t = await receptionTenant()
    // 前日にお待ちのまま残った行（日付の条件を落とすと今朝の行列に混ざる）。
    const stale = await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: jstAt(PREV_DATE, '11:00'),
      durationMinutes: 20,
      source: 'walkin',
      staffId: null,
    })
    await env.DB.prepare(
      "INSERT INTO walk_ins (id, organization_id, store_id, visit_date, ticket_no, arrived_at, purpose_id, purpose_note, customer_id, reservation_id, status, left_at, version, created_at) VALUES (?,?,?,?,?,?,NULL,?,NULL,?,'waiting',NULL,1,?)",
    )
      .bind(
        crypto.randomUUID(),
        t.org,
        t.storeId,
        PREV_DATE,
        3,
        jstAt(PREV_DATE, '11:02'),
        'フレームの相談',
        stale,
        jstAt(PREV_DATE, '11:02'),
      )
      .run()

    await createWalkin(t.token, walkinBody(t.storeId, '11:02'))

    const today = await listWalkins(t.token, {
      storeId: t.storeId,
      date: LEDGER_DATE,
      status: 'waiting',
    })
    expect(today.items).toHaveLength(1)
    expect(today.items[0]).toMatchObject({ ticketNo: 1 })

    const ledger = await readLedger(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    expect(ledger.body).toMatchObject({ walkinWaitingCount: 1 })
  })
})

describe('工程を進める', () => {
  it('お客様を登録しないまま「ご相談」を始められる', async () => {
    const t = await receptionTenant()
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))

    const started = await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'consulting',
      occurredAt: jstAt(LEDGER_DATE, '11:05'),
      staffId: t.staffId,
    })
    expect(started.status).toBe(200)
    expect(started.body).toMatchObject({ stage: 'consulting', subjectType: 'walkin' })

    const board = await readBoard(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    const row = board.rows.find((entry) => entry.subjectId === walkin.body.id)
    expect(row?.displayName).toBe('ウォークイン 001')
    expect(row?.visitCount).toBeNull()
  })

  it('最新工程より古い occurredAt は状態と盤面を食い違わせない', async () => {
    const t = await receptionTenant()
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'consulting',
      occurredAt: jstAt(LEDGER_DATE, '11:10'),
    })

    const stale = await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'left',
      occurredAt: jstAt(LEDGER_DATE, '11:05'),
    })

    expect(stale.status).toBe(409)
    expect(
      (await visitEventRows(t.org, String(walkin.body.id))).map((event) => event.stage),
    ).toEqual(['consulting'])
    expect((await walkinRows(t.org, t.storeId, LEDGER_DATE))[0]).toMatchObject({
      status: 'serving',
      leftAt: null,
    })
  })

  it('工程の記録は追記だけで、前の行が書き換わらない', async () => {
    const t = await receptionTenant()
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    const subjectId = walkin.body.id as string

    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId,
      stage: 'consulting',
      occurredAt: jstAt(LEDGER_DATE, '11:05'),
      note: 'お名前を確かめました',
    })
    const before = await visitEventRows(t.org, subjectId)

    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId,
      stage: 'fitting',
      occurredAt: jstAt(LEDGER_DATE, '11:20'),
    })
    const after = await visitEventRows(t.org, subjectId)

    expect(after).toHaveLength(before.length + 1)
    expect(after.slice(0, before.length)).toEqual(before)
  })

  it('ご予約のお客様の受付を記録すると、予約が arrived になる', async () => {
    const t = await receptionTenant()
    const reservationId = await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      durationMinutes: 60,
      purposes: [{ id: t.purposeId }],
    })

    const received = await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'reservation',
      subjectId: reservationId,
      stage: 'received',
      occurredAt: jstAt(LEDGER_DATE, '10:55'),
    })
    expect(received.status).toBe(200)

    const row = await env.DB.prepare(
      'SELECT status FROM reservations WHERE organization_id = ? AND id = ?',
    )
      .bind(t.org, reservationId)
      .first<{ status: string }>()
    expect(row?.status).toBe('arrived')
  })

  it('同じ予約を二重に受け付けても 2 行目の received を積まない', async () => {
    const t = await receptionTenant()
    const reservationId = await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      durationMinutes: 60,
      purposes: [{ id: t.purposeId }],
    })
    const body = {
      storeId: t.storeId,
      subjectType: 'reservation',
      subjectId: reservationId,
      stage: 'received',
      occurredAt: jstAt(LEDGER_DATE, '10:55'),
    }

    const first = await postVisit(t.token, body)
    const again = await postVisit(t.token, { ...body, occurredAt: jstAt(LEDGER_DATE, '10:57') })

    expect(again.status).toBe(200)
    expect(again.body.id).toBe(first.body.id)
    const rows = await visitEventRows(t.org, reservationId)
    expect(rows.filter((row) => row.stage === 'received')).toHaveLength(1)
  })

  /*
   * 記録は `store_id` 付きで残り、盤面は `store_id` で絞って読む。同じ会社の別の店舗を
   * 指したまま書けると、記録は残っているのにどの盤面にも出ない行ができる
   * （お客様が画面から消え、お待たせしていることに誰も気づけない）。
   */
  it('同じ会社でも別の店舗の来店を進めようとすると 404 で、1 行も残らない', async () => {
    const t = await receptionTenant()
    const otherStoreId = await insertStore(t.org, 'EYEX 新宿店')
    await insertBusinessHours(t.org, otherStoreId)
    await insertSlotRules(t.org, otherStoreId, {
      slotMinutes: 30,
      cleanupMinutes: 10,
      maxParallel: 3,
    })
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))

    const misplaced = await postVisit(t.token, {
      storeId: otherStoreId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'consulting',
      occurredAt: jstAt(LEDGER_DATE, '11:10'),
    })

    expect(misplaced.status).toBe(404)
    expect(await visitEventRows(t.org, String(walkin.body.id))).toEqual([])
  })
})

describe('あとから結びつける', () => {
  it('同じ会社でも別店舗の予約には付け替えられない', async () => {
    const t = await receptionTenant()
    const otherStoreId = await insertStore(t.org, 'EYEX 新宿店')
    const otherReservationId = await insertReservation(t.org, {
      storeId: otherStoreId,
      startsAt: jstAt(LEDGER_DATE, '13:00'),
      durationMinutes: 60,
    })
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))

    const rejected = await patchWalkin(t.token, String(walkin.body.id), {
      version: walkin.body.version,
      reservationId: otherReservationId,
    })

    expect(rejected.status).toBe(404)
    const rows = await walkinRows(t.org, t.storeId, LEDGER_DATE)
    expect(rows[0]?.reservationId).toBe(walkin.body.reservationId)
  })

  it('電話番号の下 4 桁で見つけた顧客を紐づけると、表示が整理番号から名前に変わる', async () => {
    const t = await receptionTenant()
    const phone = `090-1234-${String(Math.floor(Math.random() * 9000) + 1000)}`
    const customerId = await seedCustomer(t.org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone,
    })
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'consulting',
      occurredAt: jstAt(LEDGER_DATE, '11:05'),
    })

    const found = await SELF.fetch(
      `${BASE}/api/staff/customers/lookup?phoneLast4=${phone.slice(-4)}`,
      { headers: authed(t.token) },
    )
    const candidates = (await found.json()) as { customer: { id: string } }[]
    expect(candidates.map((candidate) => candidate.customer.id)).toContain(customerId)

    // 接客が始まった行は版が進んでいる。送る直前に読み直す（楽観ロック）。
    const listed = await listWalkins(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    const current = listed.items.find((item) => item.id === walkin.body.id)
    expect(current).toMatchObject({ status: 'serving' })

    const linked = await patchWalkin(t.token, walkin.body.id as string, {
      version: current?.version,
      customerId,
    })
    expect(linked.status).toBe(200)
    expect(linked.body).toMatchObject({ customerId })

    const board = await readBoard(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    const row = board.rows.find((entry) => entry.subjectId === walkin.body.id)
    expect(row?.displayName).toBe('田中 花子 様')
  })

  it('紐づけた来店はそのお客様の来店回数に数えられる', async () => {
    const t = await receptionTenant()
    const customerId = await seedCustomer(t.org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: `080-0000-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    })
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    await patchWalkin(t.token, walkin.body.id as string, {
      version: walkin.body.version,
      customerId,
    })
    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'consulting',
      occurredAt: jstAt(LEDGER_DATE, '11:05'),
    })
    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'left',
      occurredAt: jstAt(LEDGER_DATE, '12:05'),
    })

    const row = await env.DB.prepare(
      'SELECT visit_count AS visitCount FROM customers WHERE organization_id = ? AND id = ?',
    )
      .bind(t.org, customerId)
      .first<{ visitCount: number }>()
    expect(row?.visitCount).toBe(1)
  })

  it('接客中の来店を紐づけると来店の日付は動くが、来店回数は退店まで増えない', async () => {
    const t = await receptionTenant()
    const customerId = await seedCustomer(t.org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: `080-1111-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    })
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'consulting',
      occurredAt: jstAt(LEDGER_DATE, '11:05'),
    })
    const current = await listWalkins(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    const serving = current.items.find((item) => item.id === walkin.body.id)
    await patchWalkin(t.token, String(walkin.body.id), {
      version: serving?.version,
      customerId,
    })

    const row = await env.DB.prepare(
      'SELECT visit_count AS visitCount, first_visit_at AS firstVisitAt, last_visit_at AS lastVisitAt FROM customers WHERE organization_id = ? AND id = ?',
    )
      .bind(t.org, customerId)
      .first<{ visitCount: number; firstVisitAt: string | null; lastVisitAt: string | null }>()
    /*
     * 数え方が 2 通りあることをここで固定する。
     *   来店回数（`visit_count`）: 退店（`done`）だけ（AC-RECEP-23）。
     *   初回・最後のご来店: 来店済み（`arrived` / `serving` / `done`）（AC-CUST-11）。
     * 接客中の日付まで止めていたころ、いまお店にいらしている方の「最後のご来店」に
     * 前回の日付が出続けた（実装不足の洗い出し customers-05）。
     */
    expect(row?.visitCount).toBe(0)
    // ウォークインの枠は刻みへ丸められるので 11:00 から始まる。
    expect(row?.firstVisitAt).toBe(jstAt(LEDGER_DATE, '11:00'))
    expect(row?.lastVisitAt).toBe(jstAt(LEDGER_DATE, '11:00'))
  })

  it('別テナントの担当者をウォークインへ割り当てられない', async () => {
    const t = await receptionTenant()
    const other = await receptionTenant()
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))

    const rejected = await patchWalkin(t.token, String(walkin.body.id), {
      version: walkin.body.version,
      staffId: other.staffId,
    })

    expect(rejected.status).toBe(404)
    const assignment = await env.DB.prepare(
      "SELECT target_id AS targetId FROM reservation_assignments WHERE organization_id = ? AND reservation_id = ? AND kind = 'staff'",
    )
      .bind(t.org, walkin.body.reservationId)
      .first<{ targetId: string | null }>()
    expect(assignment?.targetId).toBeNull()
  })

  it('同じ時間に埋まっている担当者へ変更すると割当と枠を変えず 409 にする', async () => {
    const t = await receptionTenant({ maxParallel: 3 })
    await createWalkin(t.token, walkinBody(t.storeId, '11:02', { staffId: t.staffId }))
    const unassigned = await createWalkin(t.token, walkinBody(t.storeId, '11:04'))

    const rejected = await patchWalkin(t.token, String(unassigned.body.id), {
      version: unassigned.body.version,
      staffId: t.staffId,
    })

    expect(rejected.status).toBe(409)
    expect(rejected.body).toMatchObject({ error: 'slot_taken' })
    const assignment = await env.DB.prepare(
      "SELECT target_id AS targetId FROM reservation_assignments WHERE organization_id = ? AND reservation_id = ? AND kind = 'staff'",
    )
      .bind(t.org, unassigned.body.reservationId)
      .first<{ targetId: string | null }>()
    expect(assignment?.targetId).toBeNull()
    const locks = await env.DB.prepare(
      "SELECT target_key AS targetKey FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ? AND kind = 'staff' ORDER BY slot_start",
    )
      .bind(t.org, unassigned.body.reservationId)
      .all<{ targetKey: string }>()
    expect(new Set(locks.results.map((row) => row.targetKey))).toEqual(new Set(['unassigned']))
  })

  it('複数枠の後半だけ競合しても、先頭枠を部分取得せず担当変更を断る', async () => {
    const t = await receptionTenant({ maxParallel: 3 })
    await createWalkin(
      t.token,
      walkinBody(t.storeId, '11:32', { staffId: t.staffId, startsAt: jstAt(LEDGER_DATE, '11:30') }),
    )
    const unassigned = await createWalkin(
      t.token,
      walkinBody(t.storeId, '11:02', {
        purposeNote: undefined,
        purposeId: t.purposeId,
        durationMinutes: 60,
      }),
    )

    const rejected = await patchWalkin(t.token, String(unassigned.body.id), {
      version: unassigned.body.version,
      staffId: t.staffId,
    })

    expect(rejected.status).toBe(409)
    expect(rejected.body).toMatchObject({ error: 'slot_taken' })
    const staffLocks = await env.DB.prepare(
      "SELECT slot_start AS slotStart FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ? AND kind = 'staff' AND target_key = ?",
    )
      .bind(t.org, unassigned.body.reservationId, t.staffId)
      .all<{ slotStart: string }>()
    expect(staffLocks.results).toEqual([])
    const assignment = await env.DB.prepare(
      "SELECT target_id AS targetId FROM reservation_assignments WHERE organization_id = ? AND reservation_id = ? AND kind = 'staff'",
    )
      .bind(t.org, unassigned.body.reservationId)
      .first<{ targetId: string | null }>()
    expect(assignment?.targetId).toBeNull()
  })

  it('空いている担当者へ変更すると未定レーンの枠も担当者レーンへ移す', async () => {
    const t = await receptionTenant({ maxParallel: 3 })
    const unassigned = await createWalkin(t.token, walkinBody(t.storeId, '11:04'))

    const assigned = await patchWalkin(t.token, String(unassigned.body.id), {
      version: unassigned.body.version,
      staffId: t.staffId,
    })

    expect(assigned.status).toBe(200)
    const locks = await env.DB.prepare(
      "SELECT target_key AS targetKey FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ? AND kind = 'staff' ORDER BY slot_start",
    )
      .bind(t.org, unassigned.body.reservationId)
      .all<{ targetKey: string }>()
    expect(new Set(locks.results.map((row) => row.targetKey))).toEqual(new Set([t.staffId]))
  })

  it('古い版の担当変更は 409 で割当と枠を一切変えない', async () => {
    const t = await receptionTenant({ maxParallel: 3 })
    const unassigned = await createWalkin(t.token, walkinBody(t.storeId, '11:04'))
    const advanced = await patchWalkin(t.token, String(unassigned.body.id), {
      version: unassigned.body.version,
      status: 'serving',
    })
    expect(advanced.status).toBe(200)

    const rejected = await patchWalkin(t.token, String(unassigned.body.id), {
      version: unassigned.body.version,
      staffId: t.staffId,
    })

    expect(rejected.status).toBe(409)
    expect(rejected.body).toMatchObject({ error: 'version_conflict' })
    const assignment = await env.DB.prepare(
      "SELECT target_id AS targetId FROM reservation_assignments WHERE organization_id = ? AND reservation_id = ? AND kind = 'staff'",
    )
      .bind(t.org, unassigned.body.reservationId)
      .first<{ targetId: string | null }>()
    expect(assignment?.targetId).toBeNull()
    const locks = await env.DB.prepare(
      "SELECT DISTINCT target_key AS targetKey FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ? AND kind = 'staff'",
    )
      .bind(t.org, unassigned.body.reservationId)
      .all<{ targetKey: string }>()
    expect(locks.results).toEqual([{ targetKey: 'unassigned' }])
  })

  it('無効化済みの担当者は勤務と技能が残っていても割り当てない', async () => {
    const t = await receptionTenant({ maxParallel: 3 })
    const inactiveId = await insertStaff(t.org, t.storeId, {
      displayName: '無効化済みスタッフ',
      maxParallelReservations: 1,
    })
    await insertShift(t.org, t.storeId, inactiveId)
    await env.DB.prepare('UPDATE staff SET is_active = 0 WHERE organization_id = ? AND id = ?')
      .bind(t.org, inactiveId)
      .run()
    const unassigned = await createWalkin(t.token, walkinBody(t.storeId, '11:04'))

    const rejected = await patchWalkin(t.token, String(unassigned.body.id), {
      version: unassigned.body.version,
      staffId: inactiveId,
    })

    expect(rejected.status).toBe(404)
    const assignment = await env.DB.prepare(
      "SELECT target_id AS targetId FROM reservation_assignments WHERE organization_id = ? AND reservation_id = ? AND kind = 'staff'",
    )
      .bind(t.org, unassigned.body.reservationId)
      .first<{ targetId: string | null }>()
    expect(assignment?.targetId).toBeNull()
  })

  it('予約時間に勤務していない担当者へ変更できない', async () => {
    const t = await receptionTenant({ maxParallel: 3 })
    const offDutyId = await insertStaff(t.org, t.storeId, {
      displayName: '勤務外スタッフ',
      maxParallelReservations: 1,
    })
    const unassigned = await createWalkin(t.token, walkinBody(t.storeId, '11:04'))

    const rejected = await patchWalkin(t.token, String(unassigned.body.id), {
      version: unassigned.body.version,
      staffId: offDutyId,
    })

    expect(rejected.status).toBe(409)
    expect(rejected.body).toMatchObject({ error: 'purpose_unavailable' })
  })

  it('新しく登録したお客様に紐づけると、その来店が初めてのご来店になる', async () => {
    const t = await receptionTenant()
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))

    const created = await SELF.fetch(`${BASE}/api/staff/customers`, {
      method: 'POST',
      headers: authed(t.token),
      body: JSON.stringify({
        name: '相川 みどり',
        kana: 'あいかわ みどり',
        phone: `070-1111-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      }),
    })
    const customer = (await created.json()) as { id: string; visitCount: number }
    expect(customer.visitCount).toBe(0)

    await patchWalkin(t.token, walkin.body.id as string, {
      version: walkin.body.version,
      customerId: customer.id,
    })
    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'consulting',
      occurredAt: jstAt(LEDGER_DATE, '11:05'),
    })
    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'left',
      occurredAt: jstAt(LEDGER_DATE, '12:05'),
    })

    const row = await env.DB.prepare(
      'SELECT visit_count AS visitCount, first_visit_at AS firstVisitAt FROM customers WHERE organization_id = ? AND id = ?',
    )
      .bind(t.org, customer.id)
      .first<{ visitCount: number; firstVisitAt: string | null }>()
    expect(row?.visitCount).toBe(1)
    expect(row?.firstVisitAt).toBe(jstAt(LEDGER_DATE, '11:00'))
  })
})

describe('退店', () => {
  it('退店を記録すると、ご来店中から外れて本日すべてにだけ残る', async () => {
    const t = await receptionTenant()
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'handover',
      occurredAt: jstAt(LEDGER_DATE, '11:50'),
    })
    const before = await readBoard(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    expect(before.activeCount).toBe(1)

    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'left',
      occurredAt: jstAt(LEDGER_DATE, '12:05'),
    })

    const active = await readBoard(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    expect(active.activeCount).toBe(0)
    expect(active.rows.map((row) => row.subjectId)).not.toContain(walkin.body.id)

    const all = await readBoard(t.token, { storeId: t.storeId, date: LEDGER_DATE, scope: 'all' })
    expect(all.rows.map((row) => row.subjectId)).toContain(walkin.body.id)
    expect(all.activeCount).toBe(0)
  })

  it('お待ちのまま帰られた来店は待ちの帯から外れ、受付履歴には残る', async () => {
    const t = await receptionTenant()
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))

    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'left',
      occurredAt: jstAt(LEDGER_DATE, '11:40'),
      note: 'お待ちのままお帰りになりました',
    })

    const waiting = await listWalkins(t.token, {
      storeId: t.storeId,
      date: LEDGER_DATE,
      status: 'waiting',
    })
    expect(waiting.items).toHaveLength(0)

    const rows = await walkinRows(t.org, t.storeId, LEDGER_DATE)
    expect(rows[0]).toMatchObject({ status: 'left', leftAt: jstAt(LEDGER_DATE, '11:40') })

    const history = await readHistory(t.token, {
      storeId: t.storeId,
      from: LEDGER_DATE,
      to: LEDGER_DATE,
    })
    expect(history.items.map((entry) => entry.displayName)).toContain('ウォークイン 001')
  })
})

describe('ご来店がなかった', () => {
  it('no_show として残すと、受付履歴の結果がご来店なしになる', async () => {
    const t = await receptionTenant()
    const reservationId = await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      durationMinutes: 60,
      status: 'no_show',
      purposes: [{ id: t.purposeId }],
    })

    const missed = await readHistory(t.token, {
      storeId: t.storeId,
      from: LEDGER_DATE,
      to: LEDGER_DATE,
      status: 'no_show',
    })
    expect(missed.items.map((entry) => entry.entryId)).toEqual([reservationId])
    expect(missed.items[0]?.reservationStatus).toBe('no_show')

    const booked = await readHistory(t.token, {
      storeId: t.storeId,
      from: LEDGER_DATE,
      to: LEDGER_DATE,
      status: 'confirmed,arrived,serving,done',
    })
    expect(booked.items.map((entry) => entry.entryId)).not.toContain(reservationId)
  })
})

describe('受付履歴', () => {
  it('前日のウォークインを期間を広げて見つけられる', async () => {
    const t = await receptionTenant()
    const reservationId = await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: jstAt(PREV_DATE, '11:00'),
      durationMinutes: 20,
      source: 'walkin',
      staffId: null,
    })
    await env.DB.prepare(
      "INSERT INTO walk_ins (id, organization_id, store_id, visit_date, ticket_no, arrived_at, purpose_id, purpose_note, customer_id, reservation_id, status, left_at, version, created_at) VALUES (?,?,?,?,?,?,NULL,?,NULL,?,'left',?,1,?)",
    )
      .bind(
        crypto.randomUUID(),
        t.org,
        t.storeId,
        PREV_DATE,
        3,
        jstAt(PREV_DATE, '11:02'),
        'フレームの相談',
        reservationId,
        jstAt(PREV_DATE, '12:00'),
        jstAt(PREV_DATE, '11:02'),
      )
      .run()

    const today = await readHistory(t.token, {
      storeId: t.storeId,
      from: LEDGER_DATE,
      to: LEDGER_DATE,
    })
    expect(today.items.map((entry) => entry.entryId)).not.toContain(reservationId)

    const widened = await readHistory(t.token, {
      storeId: t.storeId,
      from: PREV_DATE,
      to: LEDGER_DATE,
    })
    const entry = widened.items.find((row) => row.entryId === reservationId)
    expect(entry?.displayName).toBe('ウォークイン 003')
    expect(entry?.startedAt).toBe(jstAt(PREV_DATE, '11:02'))
  })

  it('1 件を選ぶと受け付けた人・時刻・手段と、そのあとの変更が古い順に読める', async () => {
    const t = await receptionTenant()
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'received',
      occurredAt: jstAt(LEDGER_DATE, '11:03'),
    })

    const detail = await readHistoryDetail(t.token, walkin.body.reservationId as string)
    expect(detail.status).toBe(200)
    expect(detail.body).toMatchObject({
      entryId: walkin.body.reservationId,
      receivedAt: jstAt(LEDGER_DATE, '11:02'),
      recording: null,
    })
    expect((detail.body.reservation as Json).source).toBe('walkin')

    const changes = detail.body.changes as { occurredAt: string; what: string }[]
    expect(changes.length).toBeGreaterThanOrEqual(2)
    expect(changes.map((change) => change.occurredAt)).toEqual(
      [...changes.map((change) => change.occurredAt)].sort(),
    )
    expect(changes.map((change) => change.what)).toContain('新しく受け付けました')
    expect(changes.map((change) => change.what)).toContain('ご来店を受け付けました')
  })

  it('一覧を読んだことが監査に 1 行残る', async () => {
    const t = await receptionTenant()
    await readHistory(t.token, { storeId: t.storeId, from: LEDGER_DATE, to: LEDGER_DATE })

    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_events WHERE organization_id = ? AND action = 'reception.history.viewed' AND target_type = 'reception_sessions'",
    )
      .bind(t.org)
      .first<{ n: number }>()
    expect(audit?.n).toBe(1)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * T-010 同時受付の上限（AC-RECEP-29）
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('同時受付の上限', () => {
  it('担当を決めずに受け付ける 2 人目が同じ 11:00 の枠に載る', async () => {
    const t = await receptionTenant({ maxParallel: 3 })
    const first = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    const second = await createWalkin(t.token, walkinBody(t.storeId, '11:04'))

    expect([first.status, second.status]).toEqual([200, 200])
    expect(second.body.ticketNo).toBe(2)
    const rows = await walkinRows(t.org, t.storeId, LEDGER_DATE)
    expect(rows.map((row) => row.ticketNo)).toEqual([1, 2])
  })

  it('上限ちょうどの 3 件目まで受け付けられる', async () => {
    const t = await receptionTenant({ maxParallel: 3 })
    for (const time of ['11:02', '11:04', '11:06']) {
      expect((await createWalkin(t.token, walkinBody(t.storeId, time))).status).toBe(200)
    }
    expect((await walkinRows(t.org, t.storeId, LEDGER_DATE)).map((row) => row.ticketNo)).toEqual([
      1, 2, 3,
    ])
  })

  it('4 件目だけが 409 slot_taken になる', async () => {
    const t = await receptionTenant({ maxParallel: 3 })
    for (const time of ['11:02', '11:04', '11:06']) {
      await createWalkin(t.token, walkinBody(t.storeId, time))
    }
    const fourth = await createWalkin(t.token, walkinBody(t.storeId, '11:08'))
    expect(fourth.status).toBe(409)
    expect(fourth.body).toMatchObject({ error: 'slot_taken' })
  })

  it('枠が取れなかったとき、予約もウォークインも 1 行も書かれていない', async () => {
    const t = await receptionTenant({ maxParallel: 3 })
    for (const time of ['11:02', '11:04', '11:06']) {
      await createWalkin(t.token, walkinBody(t.storeId, time))
    }
    await createWalkin(t.token, walkinBody(t.storeId, '11:08'))

    expect(await walkinRows(t.org, t.storeId, LEDGER_DATE)).toHaveLength(3)
    const reservations = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ? AND source = 'walkin'",
    )
      .bind(t.org)
      .first<{ n: number }>()
    expect(reservations?.n).toBe(3)
  })

  it('担当を決めた受付は staff.max_parallel_reservations で数える', async () => {
    const t = await receptionTenant({ maxParallel: 3 })
    const first = await createWalkin(
      t.token,
      walkinBody(t.storeId, '11:02', { staffId: t.staffId }),
    )
    const second = await createWalkin(
      t.token,
      walkinBody(t.storeId, '11:04', { staffId: t.staffId }),
    )

    expect(first.status).toBe(200)
    // 中村 彩 の同時受付は 1 件までなので、店舗の上限（3）に余りがあっても入らない。
    expect(second.status).toBe(409)
    expect(second.body).toMatchObject({ error: 'slot_taken' })
    // 担当を決めなければ同じ 11:00 に入る（止めているのは担当の上限である）。
    const unassigned = await createWalkin(t.token, walkinBody(t.storeId, '11:06'))
    expect(unassigned.status).toBe(200)
  })

  it('整理番号がぶつかったら +1 して採番し直し、最大 5 回まで試す', async () => {
    const t = await receptionTenant({ maxParallel: 3 })
    // 同時に 3 台の iPad が受け付ける。採番は MAX(ticket_no)+1 を読んでから書くので、
    // 打ち直しが無いと 2 台目以降が一意制約で 500 になる。
    const results = await Promise.all([
      createWalkin(t.token, walkinBody(t.storeId, '11:02')),
      createWalkin(t.token, walkinBody(t.storeId, '11:04')),
      createWalkin(t.token, walkinBody(t.storeId, '11:06')),
    ])
    expect(results.map((result) => result.status)).toEqual([200, 200, 200])
    expect([...results.map((result) => result.body.ticketNo)].sort()).toEqual([1, 2, 3])
  })

  it('再試行のあいだ in_progress の冪等キーを消さない', async () => {
    const t = await receptionTenant({ maxParallel: 3 })
    const key = crypto.randomUUID()
    const created = await createWalkin(t.token, walkinBody(t.storeId, '11:02'), key)
    expect(created.status).toBe(200)

    const record = await env.DB.prepare(
      'SELECT status, response_json AS responseJson FROM idempotency_records WHERE key = ?',
    )
      .bind(`${t.org}:walkin.create:${key}`)
      .first<{ status: string; responseJson: string | null }>()
    expect(record?.status).toBe('done')
    expect(record?.responseJson).not.toBeNull()
  })

  it('再試行で解けない失敗のときだけ in_progress の行を消す', async () => {
    const t = await receptionTenant({ maxParallel: 3 })
    for (const time of ['11:02', '11:04', '11:06']) {
      await createWalkin(t.token, walkinBody(t.storeId, time))
    }
    const key = crypto.randomUUID()
    const blocked = await createWalkin(t.token, walkinBody(t.storeId, '11:08'), key)
    expect(blocked.status).toBe(409)

    const record = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM idempotency_records WHERE key = ?',
    )
      .bind(`${t.org}:walkin.create:${key}`)
      .first<{ n: number }>()
    expect(record?.n).toBe(0)

    // 鍵が空いているので、同じ鍵のまま時刻を選び直して受け付けられる。
    const later = await createWalkin(t.token, walkinBody(t.storeId, '13:02'), key)
    expect(later.status).toBe(200)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 巡目 — 受入基準を実際に観測する
 *
 * 1 巡目のテストが「通っている」ことと、受入基準の Given/When/Then を**見ている**
 * ことは別である。ここに足したのは、通っていたのに条件を見ていなかったもの
 * （盤面のご来店中・お待たせ中・お待ち分数・ご来店なし）と、壊しにいって見つけた
 * もの（同時受付・日をまたぐ採番・おまとめ・二重の記録）だけである。
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** ISO8601 → JST の暦日。ルートが `walk_ins.visit_date` に入れるのと同じ直し方。 */
function jstVisitDateOf(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 60 * 60_000).toISOString().slice(0, 10)
}

/** 選択中店舗の `StorePermission`（店長は `settings.manage` を持つ）。 */
async function syncMembership(
  org: string,
  storeId: string,
  userId: string,
  permissions: readonly string[],
): Promise<void> {
  await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': 'dev-internal-key' },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      organizationId: org,
      storeId,
      userId,
      permissions,
      createdAt: FIXED_NOW,
    }),
  })
}

async function cancelReservation(
  token: string,
  reservationId: string,
  body: Json,
): Promise<{ status: number; body: Json }> {
  const res = await SELF.fetch(`${BASE}/api/staff/reservations/${reservationId}/cancel`, {
    method: 'POST',
    headers: authed(token),
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json }
}

async function reservationStatusOf(org: string, reservationId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT status, cancel_reason AS cancelReason FROM reservations WHERE organization_id = ? AND id = ?',
  )
    .bind(org, reservationId)
    .first<{ status: string; cancelReason: string | null }>()
  return row?.status ?? null
}

describe('盤面はお着きになった方だけを数える', () => {
  it('受け付けただけで工程の記録が無いウォークインも、受付の欄が受付時刻で済みましたになる', async () => {
    const t = await receptionTenant()
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))

    const board = await readBoard(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    const row = board.rows.find((entry) => entry.subjectId === walkin.body.id)
    expect(row?.cells.find((cell) => cell.stage === 'received')).toMatchObject({
      state: 'done',
      at: jstAt(LEDGER_DATE, '11:02'),
    })
  })

  it('まだお着きでない当日のご予約はご来店中に数えない', async () => {
    const t = await receptionTenant()
    await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: jstAt(LEDGER_DATE, '16:00'),
      durationMinutes: 60,
      purposes: [{ id: t.purposeId }],
    })

    const board = await readBoard(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    expect(board.activeCount).toBe(0)
    expect(board.rows).toHaveLength(0)
    // 「本日すべて」に切り替えても、まだお着きでない行は来店の記録ではない。
    const all = await readBoard(t.token, { storeId: t.storeId, date: LEDGER_DATE, scope: 'all' })
    expect(all.rows).toHaveLength(0)
  })

  it('受付を記録するとその行だけがご来店中に載る', async () => {
    const t = await receptionTenant()
    const reservationId = await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: jstAt(LEDGER_DATE, '16:00'),
      durationMinutes: 60,
      purposes: [{ id: t.purposeId }],
    })
    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'reservation',
      subjectId: reservationId,
      stage: 'received',
      occurredAt: jstAt(LEDGER_DATE, '15:55'),
    })

    const board = await readBoard(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    expect(board.activeCount).toBe(1)
    expect(board.rows.map((row) => row.subjectId)).toEqual([reservationId])
    expect(board.rows[0]?.cells.find((cell) => cell.stage === 'received')).toMatchObject({
      state: 'done',
      at: jstAt(LEDGER_DATE, '15:55'),
    })
  })
})

describe('お待ち分数', () => {
  it('一覧のお待ち分数はサーバの時計で数える（端末の時計を読まない）', async () => {
    const t = await receptionTenant()
    // ルートの現在時刻は差し替えられないので、e2e と同じく相対時刻で仕込む。
    // 6 分 5 秒前 → 切り捨てで 6 分（AC-RECEP-07 の「お待ち 6分」）。
    const arrivedAt = new Date(Date.now() - 6 * 60_000 - 5_000).toISOString()
    const created = await createWalkin(t.token, {
      storeId: t.storeId,
      purposeNote: 'フレームの相談',
      arrivedAt,
      startsAt: arrivedAt,
      durationMinutes: 20,
      staffId: null,
    })
    expect(created.status).toBe(200)
    expect(created.body.waitedMinutes).toBe(6)

    const list = await listWalkins(t.token, {
      storeId: t.storeId,
      date: jstVisitDateOf(arrivedAt),
    })
    expect(list.items[0]?.waitedMinutes).toBe(6)
  })

  it('受付時刻が未来でも負の分を返さない', async () => {
    const t = await receptionTenant()
    const arrivedAt = new Date(Date.now() + 3 * 60_000).toISOString()
    const created = await createWalkin(t.token, {
      storeId: t.storeId,
      purposeNote: 'フレームの相談',
      arrivedAt,
      startsAt: arrivedAt,
      durationMinutes: 20,
      staffId: null,
    })
    expect(created.body.waitedMinutes).toBe(0)
  })
})

describe('同時受付の上限（同時に叩く）', () => {
  it('上限 1 の枠を 2 台の iPad が同時に取ると、通るのは 1 件だけ', async () => {
    const t = await receptionTenant({ maxParallel: 1 })
    const results = await Promise.all([
      createWalkin(t.token, walkinBody(t.storeId, '11:02')),
      createWalkin(t.token, walkinBody(t.storeId, '11:04')),
    ])
    expect(results.filter((result) => result.status === 200)).toHaveLength(1)
    expect(results.filter((result) => result.status === 409)).toHaveLength(1)
    expect(results.find((result) => result.status === 409)?.body).toMatchObject({
      error: 'slot_taken',
    })
    // 断られた 1 件は整理番号も予約も残さない。
    expect(await walkinRows(t.org, t.storeId, LEDGER_DATE)).toHaveLength(1)
    const reservations = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?',
    )
      .bind(t.org)
      .first<{ n: number }>()
    expect(reservations?.n).toBe(1)
  })
})

describe('整理番号は日で採り直す', () => {
  it('同じ店舗でも前日と当日はそれぞれ 001 から始まる', async () => {
    const t = await receptionTenant()
    const yesterday = await createWalkin(t.token, {
      storeId: t.storeId,
      purposeNote: 'フレームの相談',
      arrivedAt: jstAt(PREV_DATE, '11:02'),
      startsAt: jstAt(PREV_DATE, '11:00'),
      durationMinutes: 20,
      staffId: null,
    })
    const today = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    expect(yesterday.body.ticketNo).toBe(1)
    expect(today.body.ticketNo).toBe(1)
    // 同じ日の 2 件目は 2 になる（日で採り直すのであって毎回 1 に戻すのではない）。
    const second = await createWalkin(t.token, walkinBody(t.storeId, '11:06'))
    expect(second.body.ticketNo).toBe(2)
  })
})

describe('同じ工程を 2 回記録する', () => {
  it('2 行とも残り、盤面は最後の 1 行で描く', async () => {
    const t = await receptionTenant()
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    for (const time of ['11:10', '11:20']) {
      await postVisit(t.token, {
        storeId: t.storeId,
        subjectType: 'walkin',
        subjectId: walkin.body.id,
        stage: 'consulting',
        occurredAt: jstAt(LEDGER_DATE, time),
      })
    }

    const events = await visitEventRows(t.org, walkin.body.id as string)
    expect(events.filter((row) => row.stage === 'consulting')).toHaveLength(2)

    const board = await readBoard(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    const row = board.rows.find((entry) => entry.subjectId === walkin.body.id)
    expect(row?.cells.find((cell) => cell.stage === 'consulting')).toMatchObject({
      state: 'doing',
      at: jstAt(LEDGER_DATE, '11:20'),
    })
  })
})

describe('おまとめのあとの来店回数', () => {
  it('まとめたあとに退店しても、来店回数は残す側に数えられる', async () => {
    const t = await receptionTenant()
    await syncMembership(t.org, t.storeId, `dev:${t.org}`, ['settings.read', 'settings.manage'])
    const primaryId = await seedCustomer(t.org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: `090-1234-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    })
    const secondaryId = await seedCustomer(t.org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: `090-9999-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    })

    // 受け付けたウォークインを、まとめられて消える側のお客様へ結びつける。
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    const linked = await patchWalkin(t.token, walkin.body.id as string, {
      version: walkin.body.version,
      customerId: secondaryId,
    })
    expect(linked.status).toBe(200)

    // 2 件を 1 件にまとめる（残す側は primaryId）。
    const preview = await SELF.fetch(`${BASE}/api/staff/customers/merge/preview`, {
      method: 'POST',
      headers: authed(t.token),
      body: JSON.stringify({ primaryId, secondaryId }),
    })
    expect(preview.status).toBe(200)
    const fields = ((await preview.json()) as { fields: { field: string; choice: string }[] })
      .fields
    const merged = await SELF.fetch(`${BASE}/api/staff/customers/merge`, {
      method: 'POST',
      headers: authed(t.token),
      body: JSON.stringify({
        primaryId,
        secondaryId,
        primaryVersion: 1,
        secondaryVersion: 1,
        fields: fields.map((field) => ({ field: field.field, choice: field.choice })),
      }),
    })
    expect(merged.status).toBe(200)

    // まとめたあと、その来店が終わる。
    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'handover',
      occurredAt: jstAt(LEDGER_DATE, '11:40'),
    })
    await postVisit(t.token, {
      storeId: t.storeId,
      subjectType: 'walkin',
      subjectId: walkin.body.id,
      stage: 'left',
      occurredAt: jstAt(LEDGER_DATE, '12:05'),
    })

    const counts = await env.DB.prepare(
      'SELECT id, visit_count AS visitCount FROM customers WHERE organization_id = ? AND id IN (?, ?)',
    )
      .bind(t.org, primaryId, secondaryId)
      .all<{ id: string; visitCount: number }>()
    const byId = new Map(counts.results.map((row) => [row.id, row.visitCount]))
    expect(byId.get(primaryId)).toBe(1)
    expect(byId.get(secondaryId)).toBe(0)

    // 受付の行そのものも残す側へ寄る（消えた id を指したままにしない）。
    const rows = await walkinRows(t.org, t.storeId, LEDGER_DATE)
    expect(rows[0]?.customerId).toBe(primaryId)
  })
})

describe('ご来店がなかったとして残す', () => {
  it('当日のご予約を no_show にすると、受付履歴の結果がご来店なしになる', async () => {
    const t = await receptionTenant()
    const reservationId = await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      durationMinutes: 60,
      purposes: [{ id: t.purposeId }],
    })

    const done = await cancelReservation(t.token, reservationId, { version: 1, reason: 'no_show' })
    expect(done.status).toBe(200)
    expect(await reservationStatusOf(t.org, reservationId)).toBe('no_show')

    const missed = await readHistory(t.token, {
      storeId: t.storeId,
      from: LEDGER_DATE,
      to: LEDGER_DATE,
      status: 'no_show',
    })
    expect(missed.items.map((entry) => entry.entryId)).toContain(reservationId)
  })

  it('取り消したご予約の結果は「取消」で、ご来店なしと同じ集合に入らない', async () => {
    const t = await receptionTenant()
    const reservationId = await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: jstAt(LEDGER_DATE, '13:00'),
      durationMinutes: 60,
      purposes: [{ id: t.purposeId }],
    })
    const done = await cancelReservation(t.token, reservationId, { version: 1, reason: 'customer' })
    expect(done.status).toBe(200)
    expect(await reservationStatusOf(t.org, reservationId)).toBe('cancelled')

    const cancelled = await readHistory(t.token, {
      storeId: t.storeId,
      from: LEDGER_DATE,
      to: LEDGER_DATE,
      status: 'cancelled',
    })
    expect(cancelled.items.map((entry) => entry.entryId)).toContain(reservationId)
    const missed = await readHistory(t.token, {
      storeId: t.storeId,
      from: LEDGER_DATE,
      to: LEDGER_DATE,
      status: 'no_show',
    })
    expect(missed.items.map((entry) => entry.entryId)).not.toContain(reservationId)
  })

  it('版が合わなければ 409 で、予約の状態は動かない', async () => {
    const t = await receptionTenant()
    const reservationId = await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: jstAt(LEDGER_DATE, '14:00'),
      durationMinutes: 60,
      purposes: [{ id: t.purposeId }],
    })
    const stale = await cancelReservation(t.token, reservationId, { version: 9, reason: 'no_show' })
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ error: 'version_conflict' })
    expect(await reservationStatusOf(t.org, reservationId)).toBe('confirmed')
  })

  it('版が合わずに断った取消は監査に 1 行も残さない', async () => {
    const t = await receptionTenant()
    const reservationId = await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: jstAt(LEDGER_DATE, '16:30'),
      durationMinutes: 60,
      purposes: [{ id: t.purposeId }],
    })
    expect(
      (await cancelReservation(t.token, reservationId, { version: 7, reason: 'no_show' })).status,
    ).toBe(409)

    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_events WHERE organization_id = ? AND action = 'reservation.cancelled' AND target_id = ?",
    )
      .bind(t.org, reservationId)
      .first<{ n: number }>()
    expect(audit?.n).toBe(0)
  })

  it('取り消した来店は待ちの帯から外れ、枠の占有も残らない', async () => {
    const t = await receptionTenant()
    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    const before = await readLedger(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    expect(before.body).toMatchObject({ walkinWaitingCount: 1 })

    const done = await cancelReservation(t.token, walkin.body.reservationId as string, {
      version: 1,
      reason: 'customer',
    })
    expect(done.status).toBe(200)

    const after = await readLedger(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    expect(after.body).toMatchObject({ walkinWaitingCount: 0 })
    const rows = await walkinRows(t.org, t.storeId, LEDGER_DATE)
    expect(rows[0]?.status).toBe('left')
    const locks = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ?',
    )
      .bind(t.org, walkin.body.reservationId)
      .first<{ n: number }>()
    expect(locks?.n).toBe(0)
    // 取り消した来店は盤面にも出さない。
    const board = await readBoard(t.token, { storeId: t.storeId, date: LEDGER_DATE })
    expect(board.rows.map((row) => row.subjectId)).not.toContain(walkin.body.id)
  })

  it('取り消した予約をもう一度取り消しても状態が上書きされない', async () => {
    const t = await receptionTenant()
    const reservationId = await insertReservation(t.org, {
      storeId: t.storeId,
      startsAt: jstAt(LEDGER_DATE, '15:00'),
      durationMinutes: 60,
      purposes: [{ id: t.purposeId }],
    })
    expect(
      (await cancelReservation(t.token, reservationId, { version: 1, reason: 'no_show' })).status,
    ).toBe(200)
    const again = await cancelReservation(t.token, reservationId, {
      version: 2,
      reason: 'customer',
    })
    expect(again.status).toBe(409)
    expect(await reservationStatusOf(t.org, reservationId)).toBe('no_show')
  })
})

describe('受付履歴の読み足しと 0 件', () => {
  it('limit で切って nextCursor で続きを読み、二重にも欠けにもならない', async () => {
    const t = await receptionTenant()
    for (const time of ['11:02', '11:04', '11:06']) {
      await createWalkin(t.token, walkinBody(t.storeId, time))
    }

    const first = await readHistory(t.token, {
      storeId: t.storeId,
      from: LEDGER_DATE,
      to: LEDGER_DATE,
      limit: '2',
    })
    expect(first.total).toBe(3)
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()

    const second = await readHistory(t.token, {
      storeId: t.storeId,
      from: LEDGER_DATE,
      to: LEDGER_DATE,
      limit: '2',
      cursor: first.nextCursor ?? '',
    })
    expect(second.nextCursor).toBeNull()
    // 読み足しても総件数は変わらない。
    expect(second.total).toBe(3)
    const seen = [...first.items, ...second.items].map((entry) => entry.entryId)
    expect(new Set(seen).size).toBe(3)
  })

  it('0 件のときは、実際に引ける件数の付いた緩和候補が同じ応答で返る', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(FIXED_NOW))
    try {
      const t = await receptionTenant()
      // 今月の頭に近い日の受付。狭い期間で絞ると 0 件になり、今月まで広げると見つかる。
      const early = '2026-08-03'
      await createWalkin(t.token, {
        storeId: t.storeId,
        purposeNote: 'フレームの相談',
        arrivedAt: jstAt(early, '11:02'),
        startsAt: jstAt(early, '11:00'),
        durationMinutes: 20,
        staffId: null,
      })

      const empty = await readHistory(t.token, {
        storeId: t.storeId,
        from: LEDGER_DATE,
        to: LEDGER_DATE,
      })
      expect(empty.total).toBe(0)
      const widen = empty.relaxations.find((item) => item.label.startsWith('期間を'))
      expect(widen?.count).toBeGreaterThanOrEqual(1)

      // 候補の query をそのまま送り直すと、同じ件数がそのまま出る（推定した数字ではない）。
      const again = await readHistory(t.token, {
        storeId: t.storeId,
        from: String(widen?.query.from),
        to: String(widen?.query.to),
      })
      expect(again.total).toBe(widen?.count)
    } finally {
      vi.useRealTimers()
    }
  })

  it('92 日を越える期間は 400 で断る（読める窓を黙って広げない）', async () => {
    const t = await receptionTenant()
    const res = await SELF.fetch(
      `${BASE}/api/staff/reception-sessions?storeId=${t.storeId}&from=2026-05-01&to=2026-08-27`,
      { headers: authed(t.token) },
    )
    expect(res.status).toBe(400)
  })
})

describe('まとめられて消えたお客様へは結びつけない', () => {
  it('merged_into_id の付いたお客様 id を PATCH に送ると 404', async () => {
    const t = await receptionTenant()
    const survivor = await seedCustomer(t.org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: `090-2222-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    })
    const gone = await seedCustomer(t.org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: `090-3333-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    })
    await env.DB.prepare(
      'UPDATE customers SET merged_into_id = ? WHERE organization_id = ? AND id = ?',
    )
      .bind(survivor, t.org, gone)
      .run()

    const walkin = await createWalkin(t.token, walkinBody(t.storeId, '11:02'))
    const denied = await patchWalkin(t.token, walkin.body.id as string, {
      version: walkin.body.version,
      customerId: gone,
    })
    expect(denied.status).toBe(404)

    // 断られた更新は版も customer_id も動かさない。
    const rows = await walkinRows(t.org, t.storeId, LEDGER_DATE)
    expect(rows[0]).toMatchObject({ customerId: null, version: 1 })
  })
})
