import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { expect } from 'vitest'

export const BASE = 'https://glasses-management.test'
const JWT_SECRET = 'dev-jwt-secret-change-me'
const JSON_HEADERS = { 'content-type': 'application/json' }
const INTERNAL = { ...JSON_HEADERS, 'x-internal-key': 'dev-internal-key' }
const CREATED_AT = '2026-08-26T00:00:00.000Z'

export const uuid = () => crypto.randomUUID()

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

export async function syncStore(input: { organizationId: string; name: string; id?: string }) {
  const id = input.id ?? uuid()
  const response = await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id,
      organizationId: input.organizationId,
      name: input.name,
      slug: `store-${id.slice(0, 8)}`,
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
  permissions: string[]
}) {
  const response = await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({ id: uuid(), ...input, createdAt: CREATED_AT }),
  })
  expect(response.status).toBe(200)
}

export async function insertCustomer(input: {
  organizationId: string
  primaryStoreId: string
  id?: string
  phone?: string
}) {
  const id = input.id ?? uuid()
  await env.DB.prepare(
    `INSERT INTO customers (id, organization_id, primary_store_id, name, kana, phone_normalized, email, visit_count, created_at, updated_at)
     VALUES (?, ?, ?, '山田 太郎', 'ヤマダ タロウ', ?, NULL, 2, ?, ?)`,
  )
    .bind(
      id,
      input.organizationId,
      input.primaryStoreId,
      input.phone ?? `090${id.replace(/\D/g, '').slice(0, 8).padEnd(8, '1')}`,
      CREATED_AT,
      CREATED_AT,
    )
    .run()
  return id
}

export async function insertPrescription(input: {
  organizationId: string
  storeId: string
  customerId: string
  measuredOn: string
  recordedBy: string
  rightSphere: number
  leftSphere: number
  pupillaryDistance: number
  addPower?: number | null
}) {
  await env.DB.prepare(
    `INSERT INTO customer_prescriptions (id, organization_id, store_id, customer_id, measured_on, recorded_by, right_sphere, left_sphere, pupillary_distance, add_power, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      uuid(),
      input.organizationId,
      input.storeId,
      input.customerId,
      input.measuredOn,
      input.recordedBy,
      input.rightSphere,
      input.leftSphere,
      input.pupillaryDistance,
      input.addPower ?? null,
      `${input.measuredOn}T00:00:00.000Z`,
    )
    .run()
}

export async function insertNote(input: {
  organizationId: string
  storeId: string
  customerId: string
  recordedOn: string
  recordedBy: string
  body: string
}) {
  await env.DB.prepare(
    `INSERT INTO customer_notes (id, organization_id, store_id, customer_id, recorded_on, recorded_by, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      uuid(),
      input.organizationId,
      input.storeId,
      input.customerId,
      input.recordedOn,
      input.recordedBy,
      input.body,
      `${input.recordedOn}T00:00:00.000Z`,
    )
    .run()
}

export async function insertOwnedGlasses(input: {
  organizationId: string
  storeId: string
  customerId: string
  label: string
  purchasedOn: string
  lensType: string
}) {
  await env.DB.prepare(
    `INSERT INTO customer_owned_glasses (id, organization_id, store_id, customer_id, label, purchased_on, lens_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      uuid(),
      input.organizationId,
      input.storeId,
      input.customerId,
      input.label,
      input.purchasedOn,
      input.lensType,
      `${input.purchasedOn}T00:00:00.000Z`,
    )
    .run()
}

export async function insertAttentionNote(input: {
  organizationId: string
  storeId: string
  customerId: string
  body: string
  basis: string
  recordedBy: string
  recordedOn: string
  status?: 'draft' | 'published'
  hiddenAt?: string | null
}) {
  await env.DB.prepare(
    `INSERT INTO customer_attention_notes (id, organization_id, store_id, customer_id, body, basis, status, version, recorded_by, recorded_on, published_at, hidden_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      uuid(),
      input.organizationId,
      input.storeId,
      input.customerId,
      input.body,
      input.basis,
      input.status ?? 'published',
      input.recordedBy,
      input.recordedOn,
      (input.status ?? 'published') === 'published' ? `${input.recordedOn}T00:00:00.000Z` : null,
      input.hiddenAt ?? null,
      `${input.recordedOn}T00:00:00.000Z`,
      `${input.recordedOn}T00:00:00.000Z`,
    )
    .run()
}

export async function insertReservation(input: {
  organizationId: string
  storeId: string
  customerId: string
  startAt: string
  status?: string
}) {
  const id = uuid()
  await env.DB.prepare(
    `INSERT INTO reservations (id, organization_id, store_id, reservation_number, source, status, start_at, end_at, purpose_ids_json, customer_id, customer_name, customer_kana, customer_phone, recital, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'staff', ?, ?, ?, '[]', ?, '山田 太郎', 'ヤマダ タロウ', '09011112222', '', 1, ?, ?)`,
  )
    .bind(
      id,
      input.organizationId,
      input.storeId,
      `R-${id.slice(0, 8)}`,
      input.status ?? 'checked_in',
      input.startAt,
      input.startAt,
      input.customerId,
      CREATED_AT,
      CREATED_AT,
    )
    .run()
  return id
}

export async function insertWalkin(input: {
  organizationId: string
  storeId: string
  customerId: string
  arrivedAt: string
  sequence?: number
}) {
  const id = uuid()
  await env.DB.prepare(
    `INSERT INTO walkins (id, organization_id, store_id, service_date, sequence, customer_id, status, progress, arrived_at, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'departed', 'departed', ?, 1, ?, ?)`,
  )
    .bind(
      id,
      input.organizationId,
      input.storeId,
      input.arrivedAt.slice(0, 10),
      input.sequence ?? Math.floor(Math.random() * 100000),
      input.customerId,
      input.arrivedAt,
      CREATED_AT,
      CREATED_AT,
    )
    .run()
  return id
}

export function customerUrl(storeId: string, customerId: string) {
  return `${BASE}/api/staff/stores/${storeId}/customers/${customerId}`
}
