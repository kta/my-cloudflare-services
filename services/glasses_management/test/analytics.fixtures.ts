import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { expect } from 'vitest'

export const BASE = 'https://glasses-management.test'
const JWT_SECRET = 'dev-jwt-secret-change-me'
const JSON_HEADERS = { 'content-type': 'application/json' }
const INTERNAL = { ...JSON_HEADERS, 'x-internal-key': 'dev-internal-key' }
const CREATED_AT = '2026-08-26T00:00:00.000Z'

export const uuid = () => crypto.randomUUID()

/** Narrow an optional lookup, failing the test loudly rather than asserting. */
export function required<T>(value: T | undefined | null, name: string): T {
  if (value === null || value === undefined) throw new Error(`${name} is missing`)
  return value
}

export const ANALYTICS_PERMISSIONS = ['store.read', 'analytics.read'] as const

export async function tokenFor(org: string, role: 'admin' | 'staff' = 'staff', userId = uuid()) {
  return signAccessToken({ sub: userId, org, email: `${userId}@example.test`, role }, JWT_SECRET)
}

export function auth(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  }
}

export async function syncOrganization(id: string) {
  const response = await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id,
      name: `Organization ${id.slice(0, 8)}`,
      plan: 'free',
      isDisabled: false,
      createdAt: CREATED_AT,
    }),
  })
  expect(response.status).toBe(200)
}

export async function syncStore(input: { organizationId: string; name: string; slug?: string }) {
  const id = uuid()
  const response = await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id,
      organizationId: input.organizationId,
      name: input.name,
      slug: input.slug ?? `store-${id.slice(0, 8)}`,
      isActive: true,
      createdAt: CREATED_AT,
    }),
  })
  expect(response.status).toBe(200)
  return id
}

export async function syncMembership(input: {
  organizationId: string
  storeId: string
  userId: string
  permissions: readonly string[]
}) {
  const response = await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: uuid(),
      organizationId: input.organizationId,
      storeId: input.storeId,
      userId: input.userId,
      permissions: [...input.permissions],
      createdAt: CREATED_AT,
    }),
  })
  expect(response.status).toBe(200)
}

/** An organization + store + analytics-capable staff member. */
export async function seedStore(name = '新宿店') {
  const organizationId = uuid()
  await syncOrganization(organizationId)
  const storeId = await syncStore({ organizationId, name })
  const userId = uuid()
  await syncMembership({
    organizationId,
    storeId,
    userId,
    permissions: [...ANALYTICS_PERMISSIONS],
  })
  const token = await tokenFor(organizationId, 'staff', userId)
  return { organizationId, storeId, userId, token }
}

export async function insertReservation(input: {
  organizationId: string
  storeId: string
  startAt: string
  status?: 'confirmed' | 'checked_in' | 'cancelled' | 'no_show'
  source?: 'staff' | 'web'
  purposeIds?: readonly string[]
  assignedStaffId?: string | null
  progress?: string | null
  waitStartedAt?: string | null
}) {
  const id = uuid()
  await env.DB.prepare(
    `INSERT INTO reservations (id, organization_id, store_id, reservation_number, source, status, start_at, end_at, purpose_ids_json, customer_id, customer_name, customer_kana, customer_phone, recital, progress, wait_started_at, assigned_staff_id, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '山田 太郎', 'ヤマダ タロウ', '09011112222', '', ?, ?, ?, 1, ?, ?)`,
  )
    .bind(
      id,
      input.organizationId,
      input.storeId,
      `R-${id.slice(0, 12)}`,
      input.source ?? 'staff',
      input.status ?? 'checked_in',
      input.startAt,
      input.startAt,
      JSON.stringify(input.purposeIds ?? []),
      input.progress ?? null,
      input.waitStartedAt ?? null,
      input.assignedStaffId ?? null,
      CREATED_AT,
      CREATED_AT,
    )
    .run()
  return id
}

export async function insertWalkin(input: {
  organizationId: string
  storeId: string
  arrivedAt: string
  progress?: string
  status?: string
}) {
  const id = uuid()
  await env.DB.prepare(
    `INSERT INTO walkins (id, organization_id, store_id, service_date, sequence, customer_id, status, progress, arrived_at, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(
      id,
      input.organizationId,
      input.storeId,
      input.arrivedAt.slice(0, 10),
      Math.floor(Math.random() * 1_000_000),
      input.status ?? 'departed',
      input.progress ?? 'departed',
      input.arrivedAt,
      CREATED_AT,
      CREATED_AT,
    )
    .run()
  return id
}

export async function insertProgressEvent(input: {
  organizationId: string
  storeId: string
  reservationId: string
  toProgress: string
  createdAt: string
}) {
  await env.DB.prepare(
    `INSERT INTO reservation_progress_events (id, organization_id, store_id, reservation_id, from_progress, to_progress, assigned_staff_id, assigned_equipment_ids_json, next_guidance, version, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, NULL, '[]', NULL, 1, ?)`,
  )
    .bind(
      uuid(),
      input.organizationId,
      input.storeId,
      input.reservationId,
      input.toProgress,
      input.createdAt,
    )
    .run()
}

export async function insertWalkinEvent(input: {
  organizationId: string
  storeId: string
  walkinId: string
  toProgress: string
  occurredAt: string
}) {
  await env.DB.prepare(
    `INSERT INTO walkin_events (id, organization_id, store_id, walkin_id, event_type, from_customer_id, to_customer_id, from_progress, to_progress, version, occurred_at)
     VALUES (?, ?, ?, ?, 'progress', NULL, NULL, NULL, ?, 1, ?)`,
  )
    .bind(
      uuid(),
      input.organizationId,
      input.storeId,
      input.walkinId,
      input.toProgress,
      input.occurredAt,
    )
    .run()
}

export async function insertPurpose(input: {
  organizationId: string
  storeId: string
  staffName?: string
  durationMinutes?: number
  slotIntervalMinutes?: number
  maxConcurrent?: number
  isPublic?: string
}) {
  const id = uuid()
  await env.DB.prepare(
    `INSERT INTO visit_purposes (id, organization_id, store_id, staff_name, customer_label, duration_minutes, slot_interval_minutes, is_public, required_skills_json, required_equipment_json, max_concurrent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?)`,
  )
    .bind(
      id,
      input.organizationId,
      input.storeId,
      input.staffName ?? '視力測定',
      '新しいメガネを作る',
      input.durationMinutes ?? 30,
      input.slotIntervalMinutes ?? 15,
      input.isPublic ?? '1',
      input.maxConcurrent ?? 2,
    )
    .run()
  return id
}

export async function insertFailedRecording(input: {
  organizationId: string
  storeId: string
  updatedAt: string
  failureReason?: string | null
  state?: string
}) {
  const id = uuid()
  await env.DB.prepare(
    `INSERT INTO recordings (id, organization_id, store_id, reception_session_id, reservation_id, recorder_type, recorder_id, started_at, ended_at, duration_seconds, end_reason, state, content_type, storage_key, retention_until, hold_reason, held_by, held_at, failure_reason, deleted_at, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, NULL, 'shared_terminal', 'terminal-1', ?, ?, 60, 'manual', ?, 'audio/webm', ?, NULL, NULL, NULL, NULL, ?, NULL, ?, ?, 1)`,
  )
    .bind(
      id,
      input.organizationId,
      input.storeId,
      uuid(),
      input.updatedAt,
      input.updatedAt,
      input.state ?? 'failed',
      `key-${id}`,
      input.failureReason ?? 'upload_aborted',
      input.updatedAt,
      input.updatedAt,
    )
    .run()
  return id
}

export async function insertFunnelEvent(input: {
  organizationId: string
  storeId: string
  sessionId: string
  stage: string
  occurredAt: string
}) {
  await env.DB.prepare(
    `INSERT INTO web_booking_funnel_events (id, organization_id, store_id, session_id, stage, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      uuid(),
      input.organizationId,
      input.storeId,
      input.sessionId,
      input.stage,
      input.occurredAt,
    )
    .run()
}

export function analyticsUrl(storeId: string, granularity: string, date: string) {
  return `${BASE}/api/staff/stores/${storeId}/analytics?granularity=${granularity}&date=${date}`
}
