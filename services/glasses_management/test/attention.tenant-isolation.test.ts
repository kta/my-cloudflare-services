import { env, SELF } from 'cloudflare:test'
import type { AttentionNoteRecord, AuditEventView } from '@app/contracts'
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

const permissions = [
  'store.read',
  'store.manage',
  'customer.read',
  'customer.write',
  'customer.history',
  'attention.read',
  'attention.write',
  'attention.publish',
  'attention.revise',
  'attention.hide',
  'audit.read',
  'settings.manage',
]

async function tenant(name: string) {
  const organizationId = uuid()
  await syncOrganization(organizationId)
  const storeId = await syncStore({ organizationId, name })
  const customerId = await insertCustomer({ organizationId, primaryStoreId: storeId })
  const userId = uuid()
  await syncMembership({ organizationId, storeId, userId, permissions })
  const token = await tokenFor(organizationId, 'staff', userId)
  const created = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/customers/${customerId}/attention-notes`,
    auth(token, { method: 'POST', body: JSON.stringify(noteInput) }),
  )
  expect(created.status).toBe(201)
  const note = (await created.json()) as AttentionNoteRecord
  const published = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/attention-notes/${note.noteId}/review`,
    auth(token, {
      method: 'POST',
      body: JSON.stringify({ decision: 'publish', reason: '確認済み', expectedVersion: 1 }),
    }),
  )
  expect(published.status).toBe(200)
  return { organizationId, storeId, customerId, token, note }
}

describe('注意事項・監査・顧客統合のテナント分離', () => {
  it("never lets one tenant read, revise, hide or audit another tenant's note", async () => {
    const alpha = await tenant('アルファ新宿店')
    const beta = await tenant('ベータ横浜店')

    // A foreign store id is opaque: the same 403 as a store that does not exist.
    for (const path of [
      `/api/staff/stores/${beta.storeId}/customers/${beta.customerId}/attention-notes`,
      `/api/staff/stores/${beta.storeId}/attention-notes/${beta.note.noteId}/versions`,
      `/api/staff/stores/${beta.storeId}/audit-events`,
    ]) {
      const response = await SELF.fetch(`${BASE}${path}`, auth(alpha.token))
      expect(response.status).toBe(403)
    }

    // Alpha's own store id with beta's note id must not reach beta's row.
    const crossNote = await SELF.fetch(
      `${BASE}/api/staff/stores/${alpha.storeId}/attention-notes/${beta.note.noteId}/revisions`,
      auth(alpha.token, {
        method: 'POST',
        body: JSON.stringify({ ...noteInput, body: '越境改訂', expectedVersion: 1 }),
      }),
    )
    expect(crossNote.status).toBe(404)
    const untouched = await env.DB.prepare(
      'SELECT body, version FROM customer_attention_notes WHERE organization_id = ?',
    )
      .bind(beta.organizationId)
      .first<{ body: string; version: number }>()
    expect(untouched).toEqual({ body: noteInput.body, version: 1 })

    const hide = await SELF.fetch(
      `${BASE}/api/staff/stores/${alpha.storeId}/attention-notes/${beta.note.noteId}/hide`,
      auth(alpha.token, {
        method: 'POST',
        body: JSON.stringify({ reason: '越境非表示', expectedVersion: 1 }),
      }),
    )
    expect(hide.status).toBe(404)
  })

  it("keeps audit search inside the caller's organization", async () => {
    const alpha = await tenant('アルファ渋谷店')
    const beta = await tenant('ベータ川崎店')

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${alpha.storeId}/audit-events?limit=200`,
      auth(alpha.token),
    )
    expect(response.status).toBe(200)
    const events = (await response.json()) as AuditEventView[]
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((event) => event.storeId === alpha.storeId)).toBe(true)
    expect(JSON.stringify(events)).not.toContain(beta.note.noteId)
    expect(JSON.stringify(events)).not.toContain(beta.storeId)
  })

  it('refuses to merge a customer that belongs to another tenant, spoofed input included', async () => {
    const alpha = await tenant('アルファ池袋店')
    const beta = await tenant('ベータ上大岡店')

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${alpha.storeId}/customer-merges`,
      auth(alpha.token, {
        method: 'POST',
        body: JSON.stringify({
          primaryCustomerId: alpha.customerId,
          duplicateCustomerId: beta.customerId,
          reason: '越境統合',
          acknowledgedImpactTotal: 0,
        }),
      }),
    )
    expect(response.status).toBe(404)
    const foreign = await env.DB.prepare(
      'SELECT merged_into_customer_id FROM customers WHERE id = ?',
    )
      .bind(beta.customerId)
      .first<{ merged_into_customer_id: string | null }>()
    expect(foreign?.merged_into_customer_id).toBeNull()
  })
})
