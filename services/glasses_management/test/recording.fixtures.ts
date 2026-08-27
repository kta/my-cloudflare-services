import { SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { expect } from 'vitest'

export const BASE = 'https://glasses-management.test'
const JWT_SECRET = 'dev-jwt-secret-change-me'
const JSON_HEADERS = { 'content-type': 'application/json' }
export const INTERNAL_HEADERS = { ...JSON_HEADERS, 'x-internal-key': 'dev-internal-key' }
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

async function internalPost(path: string, body: unknown) {
  const response = await SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(200)
}

export async function syncOrganization(id: string) {
  await internalPost('/api/internal/organizations/sync', {
    id,
    name: `録音組織 ${id.slice(0, 8)}`,
    plan: 'free',
    isDisabled: false,
    createdAt: CREATED_AT,
  })
}

export async function syncStore(organizationId: string, id = uuid()) {
  await internalPost('/api/internal/stores/sync', {
    id,
    organizationId,
    name: `録音店舗 ${id.slice(0, 8)}`,
    slug: `rec-${id.slice(0, 8)}`,
    isActive: true,
    createdAt: CREATED_AT,
  })
  return id
}

export async function syncMembership(input: {
  organizationId: string
  storeId: string
  userId: string
  permissions: readonly string[]
}) {
  await internalPost('/api/internal/store-memberships/sync', {
    id: uuid(),
    ...input,
    permissions: [...input.permissions],
    createdAt: CREATED_AT,
  })
}

export type RecordingStoreFixture = {
  organizationId: string
  storeId: string
  managerId: string
  managerToken: string
  viewerId: string
  viewerToken: string
  outsiderToken: string
}

/** One synchronized organization with a store, a recording manager and a plain viewer. */
export async function setupRecordingStore(): Promise<RecordingStoreFixture> {
  const organizationId = uuid()
  await syncOrganization(organizationId)
  const storeId = await syncStore(organizationId)
  const managerId = uuid()
  const viewerId = uuid()
  const outsiderId = uuid()
  await syncMembership({
    organizationId,
    storeId,
    userId: managerId,
    permissions: ['store.read', 'recording.manage', 'terminal.manage'],
  })
  await syncMembership({
    organizationId,
    storeId,
    userId: viewerId,
    permissions: ['store.read', 'recording.read'],
  })
  await syncMembership({
    organizationId,
    storeId,
    userId: outsiderId,
    permissions: ['store.read', 'reservation.read'],
  })
  return {
    organizationId,
    storeId,
    managerId,
    managerToken: await tokenFor(organizationId, 'staff', managerId),
    viewerId,
    viewerToken: await tokenFor(organizationId, 'staff', viewerId),
    outsiderToken: await tokenFor(organizationId, 'staff', outsiderId),
  }
}

export type RecordingMetadataOverrides = {
  receptionSessionId?: string
  reservationId?: string | null
  recorderType?: 'personal' | 'shared_terminal'
  recorderId?: string
  startedAt?: string
  endedAt?: string
  durationSeconds?: number
  endReason?: 'completed' | 'discarded' | 'interrupted' | 'permission_denied'
  contentType?: 'audio/webm' | 'audio/mp4' | 'audio/mpeg' | 'audio/wav'
  idempotencyKey?: string
}

export function recordingMetadata(overrides: RecordingMetadataOverrides = {}) {
  return {
    idempotencyKey: overrides.idempotencyKey ?? `rec-${uuid()}`,
    receptionSessionId: overrides.receptionSessionId ?? uuid(),
    reservationId: overrides.reservationId ?? null,
    recorderType: overrides.recorderType ?? 'personal',
    recorderId: overrides.recorderId ?? uuid(),
    startedAt: overrides.startedAt ?? '2026-08-30T01:00:00.000Z',
    endedAt: overrides.endedAt ?? '2026-08-30T01:04:30.000Z',
    durationSeconds: overrides.durationSeconds ?? 270,
    endReason: overrides.endReason ?? 'discarded',
    contentType: overrides.contentType ?? 'audio/webm',
  }
}

export type RecordingView = {
  id: string
  organizationId: string
  storeId: string
  receptionSessionId: string
  reservationId: string | null
  state: string
  retentionUntil: string | null
  holdReason: string | null
  heldBy: string | null
  heldAt: string | null
  deletedAt: string | null
  failureReason: string | null
  endReason: string
  version: number
}

export async function createRecording(
  fixture: Pick<RecordingStoreFixture, 'storeId' | 'managerToken'>,
  overrides: RecordingMetadataOverrides = {},
): Promise<RecordingView> {
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${fixture.storeId}/recordings`,
    auth(fixture.managerToken, {
      method: 'POST',
      body: JSON.stringify(recordingMetadata(overrides)),
    }),
  )
  expect(response.status).toBe(201)
  return (await response.json()) as RecordingView
}

export async function uploadAudio(
  fixture: Pick<RecordingStoreFixture, 'storeId' | 'managerToken'>,
  recordingId: string,
  body = 'eyex-audio-bytes',
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recordingId}/audio`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${fixture.managerToken}`,
      'content-type': 'audio/webm',
    },
    body,
  })
}

export async function storedRecording(
  fixture: Pick<RecordingStoreFixture, 'storeId' | 'managerToken'>,
  overrides: RecordingMetadataOverrides = {},
): Promise<RecordingView> {
  const created = await createRecording(fixture, overrides)
  const uploaded = await uploadAudio(fixture, created.id)
  expect(uploaded.status).toBe(200)
  return (await uploaded.json()) as RecordingView
}
