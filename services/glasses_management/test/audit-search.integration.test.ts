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

const NOW = '2026-08-31T00:00:00.000Z'
const noteInput = {
  body: '来店中に他の顧客へ大声で抗議した',
  occurredAt: '2026-08-30T02:00:00.000Z',
  basis: '店内カメラ映像と担当者2名の報告',
  recommendedAction: '複数名で対応し、必要なら店長へ引き継ぐ',
}

async function seed() {
  const organizationId = uuid()
  await syncOrganization(organizationId)
  const storeId = await syncStore({ organizationId, name: '新宿店' })
  const otherStoreId = await syncStore({ organizationId, name: '横浜店' })
  const customerId = await insertCustomer({ organizationId, primaryStoreId: storeId })
  const userId = uuid()
  await syncMembership({
    organizationId,
    storeId,
    userId,
    permissions: [
      'store.read',
      'store.manage',
      'customer.read',
      'attention.read',
      'attention.write',
      'attention.publish',
      'attention.revise',
      'attention.hide',
      'audit.read',
    ],
  })
  const token = await tokenFor(organizationId, 'staff', userId)

  const created = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/customers/${customerId}/attention-notes`,
    auth(token, { method: 'POST', body: JSON.stringify(noteInput) }),
  )
  const note = (await created.json()) as AttentionNoteRecord
  await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/attention-notes/${note.noteId}/review`,
    auth(token, {
      method: 'POST',
      body: JSON.stringify({ decision: 'publish', reason: '確認済み', expectedVersion: 1 }),
    }),
  )
  await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/attention-notes/${note.noteId}/revisions`,
    auth(token, {
      method: 'POST',
      body: JSON.stringify({ ...noteInput, body: '改訂した本文', expectedVersion: 1 }),
    }),
  )
  return { organizationId, storeId, otherStoreId, customerId, token, userId, note }
}

async function search(storeId: string, token: string, query = '') {
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/audit-events${query}`,
    auth(token),
  )
  expect(response.status).toBe(200)
  return (await response.json()) as AuditEventView[]
}

describe('監査検索 (UC-EYEX-155, AC-EYEX-102)', () => {
  it('returns the newest events first with before/after and the correlation id', async () => {
    const { storeId, token, note, userId } = await seed()
    const events = await search(storeId, token)
    const revision = events.find((event) => event.action === 'attention_note.revised')
    expect(revision).toMatchObject({
      occurredAt: NOW,
      storeId,
      actorType: 'user',
      actorId: userId,
      entityType: 'attention_note',
      entityId: note.noteId,
    })
    // 監査は「どの項目が動いたか」までを残し、本文そのものは残さない。
    // `audit.read` は `attention.read` とは別の権限だからである(AC-EYEX-91)。
    expect(revision?.before).toMatchObject({ version: 1, status: 'published' })
    expect(revision?.after).toMatchObject({ version: 2, status: 'published' })
    expect(JSON.stringify(revision)).not.toContain(noteInput.body)
    expect(JSON.stringify(revision)).not.toContain('改訂した本文')
    expect(revision?.correlationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(events.map((event) => event.occurredAt)).toEqual(
      [...events]
        .map((event) => event.occurredAt)
        .sort()
        .reverse(),
    )
  })

  it('filters by 期間・操作・主体種別・対象 and honours the limit', async () => {
    const { storeId, token, note } = await seed()

    expect(
      (await search(storeId, token, '?action=attention_note.revised')).map((event) => event.action),
    ).toEqual(['attention_note.revised'])
    expect(await search(storeId, token, '?actorType=shared_terminal')).toEqual([])
    expect(
      (await search(storeId, token, `?entityType=attention_note&entityId=${note.noteId}`)).length,
    ).toBeGreaterThan(0)
    expect(await search(storeId, token, '?from=2026-09-01T00:00:00.000Z')).toEqual([])
    expect(await search(storeId, token, '?to=2026-08-01T00:00:00.000Z')).toEqual([])
    expect((await search(storeId, token, '?limit=1')).length).toBe(1)
  })

  it('rejects an invalid search and never widens the store the actor may see', async () => {
    const { storeId, otherStoreId, token, organizationId } = await seed()
    const invalid = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/audit-events?limit=999`,
      auth(token),
    )
    expect(invalid.status).toBe(400)

    // Auditing another store the actor has no membership in is refused, and
    // the same actor sees nothing of it through their own store.
    const foreign = await SELF.fetch(
      `${BASE}/api/staff/stores/${otherStoreId}/audit-events`,
      auth(token),
    )
    expect(foreign.status).toBe(403)

    await env.DB.prepare(
      `INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, action, entity_type, entity_id, request_id, metadata, occurred_at)
       VALUES (?, ?, ?, 'user', 'someone-else', 'attention_note.published', 'attention_note', ?, NULL, '{}', ?)`,
    )
      .bind(uuid(), organizationId, otherStoreId, uuid(), NOW)
      .run()
    const events = await search(storeId, token)
    expect(events.every((event) => event.storeId === storeId)).toBe(true)
  })
})
