import { SELF } from 'cloudflare:test'
import type { AttentionNoteRecord, CustomerDetail } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  auth,
  BASE,
  insertCustomer,
  syncMembership,
  syncOrganization,
  syncStore,
  tokenFor,
  uuid,
} from './customer-detail.fixtures'

const noteInput = {
  body: '来店中に他の顧客へ大声で抗議した',
  occurredAt: '2026-08-30T02:00:00.000Z',
  basis: '店内カメラ映像と担当者2名の報告',
  recommendedAction: '複数名で対応し、必要なら店長へ引き継ぐ',
}

const settingsInput = {
  scope: 'organization',
  reviewMode: 'review_required',
  sharingScope: 'permitted_stores',
  storeOverrideAllowed: true,
  capabilities: [
    { capability: 'read', minimumRole: 'staff' },
    { capability: 'write', minimumRole: 'staff' },
    { capability: 'publish', minimumRole: 'store_manager' },
    { capability: 'revise', minimumRole: 'store_manager' },
    { capability: 'hide', minimumRole: 'store_manager' },
  ],
}

const reviewInput = { decision: 'publish', reason: '確認済み', expectedVersion: 1 }
const hideInput = { reason: '申し出', expectedVersion: 1 }
const mergeInput = (primary: string, duplicate: string) => ({
  primaryCustomerId: primary,
  duplicateCustomerId: duplicate,
  reason: '同一人物',
  acknowledgedImpactTotal: 0,
})

async function seed(permissions: readonly string[], role: 'admin' | 'staff' = 'staff') {
  const organizationId = uuid()
  await syncOrganization(organizationId)
  const storeId = await syncStore({ organizationId, name: '新宿店' })
  const customerId = await insertCustomer({ organizationId, primaryStoreId: storeId })
  const userId = uuid()
  await syncMembership({ organizationId, storeId, userId, permissions: [...permissions] })
  const token = await tokenFor(organizationId, role, userId)
  return { organizationId, storeId, customerId, token, userId }
}

/** A published note owned by an all-permissions manager, for read/write probes. */
async function seedPublishedNote(storeId: string, customerId: string, organizationId: string) {
  const managerId = uuid()
  await syncMembership({
    organizationId,
    storeId,
    userId: managerId,
    permissions: [
      'store.read',
      'store.manage',
      'customer.read',
      'attention.read',
      'attention.write',
      'attention.publish',
      'attention.revise',
      'attention.hide',
    ],
  })
  const managerToken = await tokenFor(organizationId, 'staff', managerId)
  const created = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/customers/${customerId}/attention-notes`,
    auth(managerToken, { method: 'POST', body: JSON.stringify(noteInput) }),
  )
  const note = (await created.json()) as AttentionNoteRecord
  await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/attention-notes/${note.noteId}/review`,
    auth(managerToken, { method: 'POST', body: JSON.stringify(reviewInput) }),
  )
  return note
}

type Row = {
  name: string
  method: 'GET' | 'POST' | 'PUT'
  path: (ids: { storeId: string; customerId: string; noteId: string }) => string
  body?: unknown
  granted: readonly string[]
  /** Role needed by the configured capability, on top of the permission. */
  role?: 'admin' | 'staff'
}

const rows: readonly Row[] = [
  {
    name: 'GET attention settings',
    method: 'GET',
    path: ({ storeId }) => `/api/staff/stores/${storeId}/attention-settings`,
    granted: ['store.read', 'attention.read'],
  },
  {
    name: 'PUT attention settings',
    method: 'PUT',
    path: ({ storeId }) => `/api/staff/stores/${storeId}/attention-settings`,
    body: settingsInput,
    granted: ['store.read', 'settings.manage'],
    role: 'admin',
  },
  {
    name: 'POST sharing-scope impact',
    method: 'POST',
    path: ({ storeId }) => `/api/staff/stores/${storeId}/attention-settings/sharing-scope-impact`,
    body: { requestedScope: 'chain' },
    granted: ['store.read', 'settings.manage'],
    role: 'admin',
  },
  {
    name: 'GET attention notes',
    method: 'GET',
    path: ({ storeId, customerId }) =>
      `/api/staff/stores/${storeId}/customers/${customerId}/attention-notes`,
    granted: ['store.read', 'customer.read', 'attention.read'],
  },
  {
    name: 'POST attention note',
    method: 'POST',
    path: ({ storeId, customerId }) =>
      `/api/staff/stores/${storeId}/customers/${customerId}/attention-notes`,
    body: noteInput,
    granted: ['store.read', 'customer.read', 'attention.write'],
  },
  {
    name: 'GET attention note versions',
    method: 'GET',
    path: ({ storeId, noteId }) =>
      `/api/staff/stores/${storeId}/attention-notes/${noteId}/versions`,
    granted: ['store.read', 'attention.read'],
  },
  {
    name: 'POST attention review',
    method: 'POST',
    path: ({ storeId, noteId }) => `/api/staff/stores/${storeId}/attention-notes/${noteId}/review`,
    body: reviewInput,
    granted: ['store.read', 'store.manage', 'attention.publish'],
  },
  {
    name: 'POST attention revision',
    method: 'POST',
    path: ({ storeId, noteId }) =>
      `/api/staff/stores/${storeId}/attention-notes/${noteId}/revisions`,
    body: { ...noteInput, expectedVersion: 1 },
    granted: ['store.read', 'store.manage', 'attention.revise'],
  },
  {
    name: 'POST attention hide',
    method: 'POST',
    path: ({ storeId, noteId }) => `/api/staff/stores/${storeId}/attention-notes/${noteId}/hide`,
    body: hideInput,
    granted: ['store.read', 'store.manage', 'attention.hide'],
  },
  {
    name: 'GET audit events',
    method: 'GET',
    path: ({ storeId }) => `/api/staff/stores/${storeId}/audit-events`,
    granted: ['store.read', 'audit.read'],
  },
  {
    name: 'POST customer merge preview',
    method: 'POST',
    path: ({ storeId }) => `/api/staff/stores/${storeId}/customer-merges/preview`,
    body: undefined,
    granted: ['store.read', 'customer.read', 'customer.write', 'customer.history'],
  },
  {
    name: 'POST customer merge',
    method: 'POST',
    path: ({ storeId }) => `/api/staff/stores/${storeId}/customer-merges`,
    body: undefined,
    granted: ['store.read', 'customer.read', 'customer.write', 'customer.history'],
  },
  {
    name: 'POST customer link release',
    method: 'POST',
    path: ({ storeId }) => `/api/staff/stores/${storeId}/customer-links/release`,
    body: undefined,
    granted: ['store.read', 'customer.read', 'customer.write', 'customer.history'],
  },
]

describe.each(rows)('$name', (row) => {
  it('is refused for an actor holding no store permission at all', async () => {
    const { storeId, customerId, organizationId } = await seed([])
    const noteId = uuid()
    void organizationId
    const response = await SELF.fetch(
      `${BASE}${row.path({ storeId, customerId, noteId })}`,
      auth(await tokenFor(organizationId, 'staff'), {
        method: row.method,
        body: row.method === 'GET' ? undefined : JSON.stringify(row.body ?? {}),
      }),
    )
    expect(response.status).toBe(403)
  })

  it.each(row.granted.filter((permission) => permission !== 'store.read'))(
    'is refused when %s is the only missing permission',
    async (missing) => {
      const { storeId, customerId, organizationId, token } = await seed(
        row.granted.filter((permission) => permission !== missing),
        row.role === 'admin' ? 'staff' : 'staff',
      )
      const note = await seedPublishedNote(storeId, customerId, organizationId)
      const response = await SELF.fetch(
        `${BASE}${row.path({ storeId, customerId, noteId: note.noteId })}`,
        auth(token, {
          method: row.method,
          body:
            row.method === 'GET'
              ? undefined
              : JSON.stringify(row.body ?? mergeInput(customerId, uuid())),
        }),
      )
      expect(response.status).toBe(403)
    },
  )
})

describe('capability configuration on top of the permission', () => {
  it('refuses publication by a permitted actor whose role is below the configured minimum (UC-EYEX-140)', async () => {
    const { organizationId, storeId, customerId } = await seed([])
    const note = await seedPublishedNote(storeId, customerId, organizationId)
    const staffId = uuid()
    await syncMembership({
      organizationId,
      storeId,
      userId: staffId,
      permissions: ['store.read', 'customer.read', 'attention.read', 'attention.revise'],
    })
    const staffToken = await tokenFor(organizationId, 'staff', staffId)
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/attention-notes/${note.noteId}/revisions`,
      auth(staffToken, {
        method: 'POST',
        body: JSON.stringify({ ...noteInput, body: '改訂', expectedVersion: 1 }),
      }),
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })
})

describe('no existence leak without attention.read (UC-EYEX-029, AC-EYEX-91)', () => {
  it('gives an unpermitted actor no body, no count and no flag', async () => {
    const { organizationId, storeId, customerId } = await seed([])
    await seedPublishedNote(storeId, customerId, organizationId)
    const staffId = uuid()
    await syncMembership({
      organizationId,
      storeId,
      userId: staffId,
      permissions: ['store.read', 'customer.read'],
    })
    const token = await tokenFor(organizationId, 'staff', staffId)

    const detail = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/customers/${customerId}`,
      auth(token),
    )
    expect(detail.status).toBe(200)
    const body = (await detail.json()) as CustomerDetail
    expect(body.attentionNotes).toEqual([])
    expect(JSON.stringify(body)).not.toContain(noteInput.body)
    expect(Object.keys(body)).not.toContain('attentionNoteCount')

    const list = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/customers/${customerId}/attention-notes`,
      auth(token),
    )
    expect(list.status).toBe(403)
    await expect(list.json()).resolves.toEqual({ error: 'forbidden' })
  })
})
