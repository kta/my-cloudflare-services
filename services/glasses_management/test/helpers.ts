/**
 * テスト共通の入口。D1 と KV はテストファイル内で共有されるので、
 * 組織 id・店舗 slug は必ず `crypto.randomUUID()` から作って衝突させない。
 */
import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { STORE_TARGET_KEY, UNASSIGNED_TARGET_KEY } from '../src/worker/db/slot-locks'
import { expandToSlotStarts } from '../src/worker/domain/availability'

export const BASE = 'https://glasses-management.test'
export const JSON_HEADERS = { 'content-type': 'application/json' }
export const INTERNAL_HEADERS = { ...JSON_HEADERS, 'x-internal-key': 'dev-internal-key' }
export const JWT_SECRET = 'dev-jwt-secret-change-me'

export const orgId = () => `org-${crypto.randomUUID()}`

export function authed(token: string) {
  return { ...JSON_HEADERS, authorization: `Bearer ${token}` }
}

/**
 * テナントのトークンを直接発行し、組織の同期行も置く。
 *
 * 以前は dev グラント（`POST /api/auth/token`）で取っていたが、あの経路は
 * 「知らない組織にもトークンを出したうえで組織行を作る」ので本番に置けず、撤去した。
 * テストが欲しかったのは資格情報そのものなので、ここで署名する。
 */
export async function tokenFor(org: string, role: 'admin' | 'staff' = 'staff'): Promise<string> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO organizations (id, name, plan, is_disabled, created_at, revision) VALUES (?,?,'free','0',?,'0')",
  )
    .bind(org, org, FIXED_NOW)
    .run()
  return signAccessToken({ sub: `dev:${org}`, org, email: `${role}@example.com`, role }, JWT_SECRET)
}

/** admin からの組織スナップショット配信を模す。 */
export async function syncOrganization(input: {
  id: string
  name?: string
  plan?: 'free' | 'contracted'
  isDisabled?: boolean
  createdAt?: string
  revision?: number
}) {
  const res = await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify({
      id: input.id,
      name: input.name ?? 'EYE',
      plan: input.plan ?? 'free',
      isDisabled: input.isDisabled ?? false,
      createdAt: input.createdAt ?? '2026-08-27T02:08:00.000Z',
      revision: input.revision ?? 0,
    }),
  })
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<string, unknown> | null,
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * P2 予約の直 INSERT
 * P2 に予約を**書く** API は無い（`POST /api/staff/reservations` は P3）。
 * 台帳・空き枠・枠の一次排他を確かめる材料は、ここから `env.DB` へ直に置く。
 * ─────────────────────────────────────────────────────────────────────────── */

/** 固定の基準時刻（JST 2026年8月27日（木）11:08）。テストは実時刻を読まない。 */
export const FIXED_NOW = '2026-08-27T02:08:00.000Z'
/** モックが描いている 1 日。 */
export const LEDGER_DATE = '2026-08-27'

/** 予約番号は組織の中で一意。`EY-2608-0001` から機械的に振る。 */
let codeSeq = 0
export const nextReservationCode = (): string => `EY-2608-${String(++codeSeq).padStart(4, '0')}`

/** JST の壁時計（`HH:MM`）→ その日の UTC の ISO8601。 */
export function jstAt(date: string, time: string): string {
  return new Date(Date.parse(`${date}T${time}:00.000+09:00`)).toISOString()
}

export async function insertStore(org: string, name = 'EYE 銀座店'): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO stores (id, organization_id, name, slug, phone, address, access_note, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  )
    .bind(id, org, name, `store-${crypto.randomUUID().slice(0, 8)}`, '', '', '', '1', FIXED_NOW)
    .run()
  return id
}

/** 営業時間 7 行。`closedWeekdays` に挙げた曜日だけ定休にする（既定は火曜が定休）。 */
export async function insertBusinessHours(
  org: string,
  storeId: string,
  input: { opensAt?: string; closesAt?: string; closedWeekdays?: readonly number[] } = {},
): Promise<void> {
  const opensAt = input.opensAt ?? '10:00'
  const closesAt = input.closesAt ?? '19:00'
  const closed = new Set(input.closedWeekdays ?? [2])
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    const isClosed = closed.has(weekday)
    await env.DB.prepare(
      'INSERT INTO store_business_hours (id, organization_id, store_id, weekday, is_closed, opens_at, closes_at, break_start, break_end, created_at) VALUES (?,?,?,?,?,?,?,NULL,NULL,?)',
    )
      .bind(
        crypto.randomUUID(),
        org,
        storeId,
        weekday,
        isClosed ? '1' : '0',
        isClosed ? null : opensAt,
        isClosed ? null : closesAt,
        FIXED_NOW,
      )
      .run()
  }
}

/** 臨時休業・臨時営業の 1 日（`store_calendar_exceptions`）。 */
export async function insertCalendarException(
  org: string,
  storeId: string,
  input: { date: string; kind?: 'closed' | 'special'; opensAt?: string; closesAt?: string },
): Promise<void> {
  const kind = input.kind ?? 'closed'
  await env.DB.prepare(
    'INSERT INTO store_calendar_exceptions (id, organization_id, store_id, date, kind, opens_at, closes_at, note, created_at, created_by) VALUES (?,?,?,?,?,?,?,NULL,?,NULL)',
  )
    .bind(
      crypto.randomUUID(),
      org,
      storeId,
      input.date,
      kind,
      kind === 'closed' ? null : (input.opensAt ?? null),
      kind === 'closed' ? null : (input.closesAt ?? null),
      FIXED_NOW,
    )
    .run()
}

/** 店舗まるごとの受付を止める・戻す（`stores.is_active`）。 */
export async function setStoreActive(
  org: string,
  storeId: string,
  isActive: boolean,
): Promise<void> {
  await env.DB.prepare('UPDATE stores SET is_active = ? WHERE organization_id = ? AND id = ?')
    .bind(isActive ? '1' : '0', org, storeId)
    .run()
}

export async function insertSlotRules(
  org: string,
  storeId: string,
  input: { slotMinutes?: number; cleanupMinutes?: number; maxParallel?: number } = {},
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO store_slot_rules (id, organization_id, store_id, slot_minutes, cleanup_minutes, max_parallel, version, updated_at, updated_by, created_at) VALUES (?,?,?,?,?,?,1,?,NULL,?)',
  )
    .bind(
      crypto.randomUUID(),
      org,
      storeId,
      input.slotMinutes ?? 30,
      input.cleanupMinutes ?? 10,
      input.maxParallel ?? 3,
      FIXED_NOW,
      FIXED_NOW,
    )
    .run()
}

export async function insertStaff(
  org: string,
  storeId: string,
  input: {
    displayName: string
    jobLabel?: string | null
    sortOrder?: number
    skills?: readonly string[]
    maxParallelReservations?: number
  },
): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO staff (id, organization_id, store_id, admin_user_id, display_name, kana, job_label, role, max_parallel_reservations, pin_hash, pin_updated_at, is_active, sort_order, created_at, updated_at) VALUES (?,?,?,NULL,?,NULL,?,?,?,NULL,NULL,?,?,?,?)',
  )
    .bind(
      id,
      org,
      storeId,
      input.displayName,
      input.jobLabel ?? null,
      'staff',
      input.maxParallelReservations ?? 1,
      '1',
      input.sortOrder ?? 0,
      FIXED_NOW,
      FIXED_NOW,
    )
    .run()
  for (const skill of input.skills ?? []) {
    await env.DB.prepare(
      'INSERT INTO staff_skills (id, organization_id, store_id, staff_id, skill_code, created_at) VALUES (?,?,?,?,?,?)',
    )
      .bind(crypto.randomUUID(), org, storeId, id, skill, FIXED_NOW)
      .run()
  }
  return id
}

export async function insertShift(
  org: string,
  storeId: string,
  staffId: string,
  input: { date?: string; startsAt?: string; endsAt?: string; kind?: 'work' | 'break' } = {},
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO staff_shifts (id, organization_id, store_id, staff_id, date, starts_at, ends_at, kind, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      crypto.randomUUID(),
      org,
      storeId,
      staffId,
      input.date ?? LEDGER_DATE,
      input.startsAt ?? '10:00',
      input.endsAt ?? '19:00',
      input.kind ?? 'work',
      FIXED_NOW,
    )
    .run()
}

export async function insertEquipment(
  org: string,
  storeId: string,
  input: {
    name: string
    kind?: 'measure' | 'counter' | 'workbench'
    roleLabel?: string
    capacity?: number
    sortOrder?: number
  },
): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO equipment (id, organization_id, store_id, name, kind, role_label, capacity, is_active, inactive_reason, ledger_display, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?,?)',
  )
    .bind(
      id,
      org,
      storeId,
      input.name,
      input.kind ?? 'measure',
      input.roleLabel ?? '視力測定',
      input.capacity ?? 1,
      '1',
      'grey',
      input.sortOrder ?? 0,
      FIXED_NOW,
      FIXED_NOW,
    )
    .run()
  return id
}

export async function insertVisitPurpose(
  org: string,
  storeId: string | null,
  input: {
    nameInternal: string
    nameShort: string
    durationMinutes?: number
    sortOrder?: number
    requirements?: readonly { kind: 'skill' | 'equipment_kind'; value: string }[]
  },
): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO visit_purposes (id, organization_id, store_id, name_internal, name_public, name_short, duration_minutes, is_web_published, is_active, sort_order, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)',
  )
    .bind(
      id,
      org,
      storeId,
      input.nameInternal,
      input.nameInternal,
      input.nameShort,
      input.durationMinutes ?? 30,
      '1',
      '1',
      input.sortOrder ?? 0,
      FIXED_NOW,
      FIXED_NOW,
    )
    .run()
  for (const requirement of input.requirements ?? []) {
    await env.DB.prepare(
      'INSERT INTO purpose_requirements (id, organization_id, purpose_id, kind, value, created_at) VALUES (?,?,?,?,?,?)',
    )
      .bind(crypto.randomUUID(), org, id, requirement.kind, requirement.value, FIXED_NOW)
      .run()
  }
  return id
}

export async function insertMaintenance(
  org: string,
  storeId: string,
  equipmentId: string,
  input: { startsAt: string; endsAt: string; note?: string | null },
): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO equipment_maintenance (id, organization_id, store_id, equipment_id, starts_at, ends_at, note, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,NULL)',
  )
    .bind(
      id,
      org,
      storeId,
      equipmentId,
      input.startsAt,
      input.endsAt,
      input.note ?? null,
      FIXED_NOW,
    )
    .run()
  return id
}

/** 1 予約ぶんの材料。`kind='staff'` の割当は担当が未定でも必ず 1 行できる（I-05）。 */
export type ReservationSeed = {
  storeId: string
  startsAt: string
  durationMinutes?: number
  source?: 'phone' | 'counter' | 'web' | 'walkin'
  status?: 'confirmed' | 'arrived' | 'serving' | 'done' | 'cancelled' | 'no_show'
  staffId?: string | null
  /** 設備の押さえ。区間を省くとご予約まるごとを押さえる。 */
  equipment?: readonly { id: string; startsAt?: string; endsAt?: string }[]
  purposes?: readonly { id: string; durationMinutes?: number }[]
  noteCustomer?: string
  noteInternal?: string
  /** 枠の一次排他の行も同じ内容で入れる（空き枠エンジンがこの表を数える）。 */
  slotLocks?: boolean
  slotMinutes?: number
  cleanupMinutes?: number
  maxParallel?: number
}

/** 予約 1 件を D1 へ直に置き、その id を返す。 */
export async function insertReservation(org: string, seed: ReservationSeed): Promise<string> {
  const id = crypto.randomUUID()
  const durationMinutes = seed.durationMinutes ?? 30
  const endsAt = new Date(Date.parse(seed.startsAt) + durationMinutes * 60_000).toISOString()
  await env.DB.prepare(
    'INSERT INTO reservations (id, organization_id, store_id, code, customer_id, source, status, starts_at, ends_at, duration_minutes, note_customer, note_internal, version, created_at, updated_at, created_by, cancelled_at, cancel_reason) VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,1,?,?,NULL,NULL,NULL)',
  )
    .bind(
      id,
      org,
      seed.storeId,
      nextReservationCode(),
      seed.source ?? 'phone',
      seed.status ?? 'confirmed',
      seed.startsAt,
      endsAt,
      durationMinutes,
      seed.noteCustomer ?? '',
      seed.noteInternal ?? '',
      FIXED_NOW,
      FIXED_NOW,
    )
    .run()

  const bands: {
    kind: 'staff' | 'equipment'
    targetId: string | null
    from: string
    to: string
  }[] = [{ kind: 'staff', targetId: seed.staffId ?? null, from: seed.startsAt, to: endsAt }]
  for (const unit of seed.equipment ?? []) {
    bands.push({
      kind: 'equipment',
      targetId: unit.id,
      from: unit.startsAt ?? seed.startsAt,
      to: unit.endsAt ?? endsAt,
    })
  }
  for (const band of bands) {
    await env.DB.prepare(
      'INSERT INTO reservation_assignments (id, organization_id, reservation_id, kind, target_id, starts_at, ends_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
      .bind(crypto.randomUUID(), org, id, band.kind, band.targetId, band.from, band.to, FIXED_NOW)
      .run()
  }

  let sortOrder = 0
  for (const purpose of seed.purposes ?? []) {
    await env.DB.prepare(
      'INSERT INTO reservation_purposes (id, organization_id, reservation_id, purpose_id, duration_minutes, sort_order, created_at) VALUES (?,?,?,?,?,?,?)',
    )
      .bind(
        crypto.randomUUID(),
        org,
        id,
        purpose.id,
        purpose.durationMinutes ?? durationMinutes,
        sortOrder++,
        FIXED_NOW,
      )
      .run()
  }

  if (seed.slotLocks) {
    const slotMinutes = seed.slotMinutes ?? 30
    const cleanupMinutes = seed.cleanupMinutes ?? 10
    for (const band of bands) {
      for (const slotStart of slotStarts(band.from, band.to, slotMinutes, cleanupMinutes)) {
        await insertSlotLock(org, {
          storeId: seed.storeId,
          reservationId: id,
          kind: band.kind,
          targetKey: band.targetId ?? UNASSIGNED_TARGET_KEY,
          slotStart,
        })
      }
    }
    // 店舗まるごとのレーン（同時受付上限）。担当が決まっていても未定でも 1 枠 1 行入る。
    for (const slotStart of slotStarts(seed.startsAt, endsAt, slotMinutes, cleanupMinutes)) {
      await insertSlotLock(org, {
        storeId: seed.storeId,
        reservationId: id,
        kind: 'store',
        targetKey: STORE_TARGET_KEY,
        slotStart,
      })
    }
  }
  return id
}

/**
 * 押さえ 1 行を刻みの格子へ展開する（`reservation_slot_locks` に入る `slot_start`）。
 *
 * **本番と同じ `expandToSlotStarts` を呼ぶ。**助手が自前で格子を作ると原点がずれる —
 * 本番の原点は JST の 0:00 で、UTC の 0:00 を原点にすると 540 分ずれる。
 * `slot_minutes` が 30（540 の約数）のあいだは偶然一致して気づけないが、
 * 契約は 5〜60 を許すので、25 分にした日に助手と本番が 15 分ずれる。
 */
export function slotStarts(
  startsAt: string,
  endsAt: string,
  slotMinutes: number,
  cleanupMinutes: number,
): string[] {
  return expandToSlotStarts({ startsAt, endsAt, slotMinutes, cleanupMinutes })
}

export async function insertSlotLock(
  org: string,
  input: {
    storeId: string
    reservationId: string
    kind: 'staff' | 'equipment' | 'store'
    targetKey: string
    slotStart: string
    createdAt?: string
  },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO reservation_slot_locks (id, organization_id, store_id, reservation_id, kind, target_key, slot_start, created_at) VALUES (?,?,?,?,?,?,?,?)',
  )
    .bind(
      crypto.randomUUID(),
      org,
      input.storeId,
      input.reservationId,
      input.kind,
      input.targetKey,
      input.slotStart,
      input.createdAt ?? FIXED_NOW,
    )
    .run()
}
