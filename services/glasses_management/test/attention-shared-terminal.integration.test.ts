import { env, SELF } from 'cloudflare:test'
import type { AttentionNoteRecord } from '@app/contracts'
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

async function setup() {
  const organizationId = uuid()
  await syncOrganization(organizationId)
  const storeId = await syncStore({ organizationId, name: '共有端末店' })
  const customerId = await insertCustomer({ organizationId, primaryStoreId: storeId })
  const managerId = uuid()
  await syncMembership({
    organizationId,
    storeId,
    userId: managerId,
    permissions: [
      'store.read',
      'store.manage',
      'customer.read',
      'terminal.manage',
      'attention.read',
      'attention.write',
      'attention.publish',
      'attention.revise',
      'attention.hide',
    ],
  })
  const managerToken = await tokenFor(organizationId, 'staff', managerId)
  const created = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/shared-terminals`,
    auth(managerToken, { method: 'POST', body: JSON.stringify({ name: '受付iPad' }) }),
  )
  expect(created.status).toBe(201)
  const issued = (await created.json()) as { terminal: { id: string }; token: string }
  return { organizationId, storeId, customerId, managerId, managerToken, ...issued }
}

async function reauthenticate(terminalId: string, token: string, userId: string) {
  const response = await SELF.fetch(`${BASE}/api/shared-terminals/${terminalId}/reauthenticate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shared-terminal-token': token },
    body: JSON.stringify({ userId, stretchedPin: 'pin-proof-from-browser' }),
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { token: string }).token
}

describe('完全共有端末の注意事項 (UC-EYEX-137, 138, AC-EYEX-87)', () => {
  it('lets the shared terminal register for review without personal reauthentication, as the terminal', async () => {
    const context = await setup()
    const response = await SELF.fetch(
      `${BASE}/api/shared-terminals/${context.terminal.id}/stores/${context.storeId}/customers/${context.customerId}/attention-notes`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shared-terminal-token': context.token,
        },
        body: JSON.stringify(noteInput),
      },
    )
    expect(response.status).toBe(201)
    const note = (await response.json()) as AttentionNoteRecord
    expect(note).toMatchObject({ status: 'pending_review', version: 1, publishedAt: null })
    expect(note.recordedBy).toBe(context.terminal.id)

    const audit = await env.DB.prepare(
      "SELECT actor_type, actor_id FROM audit_events WHERE organization_id = ? AND action = 'attention_note.registered'",
    )
      .bind(context.organizationId)
      .first<{ actor_type: string; actor_id: string }>()
    expect(audit).toEqual({ actor_type: 'shared_terminal', actor_id: context.terminal.id })
  })

  it('requires personal reauthentication before publishing, revising or hiding from a shared terminal', async () => {
    const context = await setup()
    const registered = await SELF.fetch(
      `${BASE}/api/shared-terminals/${context.terminal.id}/stores/${context.storeId}/customers/${context.customerId}/attention-notes`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shared-terminal-token': context.token },
        body: JSON.stringify(noteInput),
      },
    )
    const note = (await registered.json()) as AttentionNoteRecord

    const base = `${BASE}/api/shared-terminals/${context.terminal.id}/stores/${context.storeId}/attention-notes/${note.noteId}`
    for (const [suffix, body] of [
      ['/review', { decision: 'publish', reason: '確認済み', expectedVersion: 1 }],
      ['/revisions', { ...noteInput, body: '改訂', expectedVersion: 1 }],
      ['/hide', { reason: '申し出', expectedVersion: 1 }],
    ] as const) {
      const refused = await SELF.fetch(`${base}${suffix}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shared-terminal-token': context.token },
        body: JSON.stringify(body),
      })
      expect(refused.status).toBe(401)
      await expect(refused.json()).resolves.toEqual({ error: 'reauth_unauthorized' })
    }

    const grant = await reauthenticate(context.terminal.id, context.token, context.managerId)
    const published = await SELF.fetch(`${base}/review`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shared-terminal-token': context.token,
        'x-shared-terminal-reauth-token': grant,
      },
      body: JSON.stringify({ decision: 'publish', reason: '確認済み', expectedVersion: 1 }),
    })
    expect(published.status).toBe(200)
    expect((await published.json()) as AttentionNoteRecord).toMatchObject({
      status: 'published',
      publishedAt: NOW,
      reviewedBy: context.managerId,
    })

    const audit = await env.DB.prepare(
      "SELECT actor_type, actor_id, metadata FROM audit_events WHERE organization_id = ? AND action = 'attention_note.published'",
    )
      .bind(context.organizationId)
      .first<{ actor_type: string; actor_id: string; metadata: string }>()
    expect(audit?.actor_type).toBe('shared_terminal')
    expect(audit?.actor_id).toBe(context.terminal.id)
    expect(JSON.parse(audit?.metadata ?? '{}')).toMatchObject({
      reauthenticatedUserId: context.managerId,
    })
  })

  it('refuses a reauthenticated person who does not hold the capability themselves', async () => {
    const context = await setup()
    const registered = await SELF.fetch(
      `${BASE}/api/shared-terminals/${context.terminal.id}/stores/${context.storeId}/customers/${context.customerId}/attention-notes`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shared-terminal-token': context.token },
        body: JSON.stringify(noteInput),
      },
    )
    const note = (await registered.json()) as AttentionNoteRecord

    const assistantId = uuid()
    await syncMembership({
      organizationId: context.organizationId,
      storeId: context.storeId,
      userId: assistantId,
      permissions: ['store.read', 'customer.read', 'terminal.manage', 'attention.read'],
    })
    const grant = await reauthenticate(context.terminal.id, context.token, assistantId)
    const refused = await SELF.fetch(
      `${BASE}/api/shared-terminals/${context.terminal.id}/stores/${context.storeId}/attention-notes/${note.noteId}/review`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shared-terminal-token': context.token,
          'x-shared-terminal-reauth-token': grant,
        },
        body: JSON.stringify({ decision: 'publish', reason: '確認済み', expectedVersion: 1 }),
      },
    )
    expect(refused.status).toBe(403)
    await expect(refused.json()).resolves.toEqual({ error: 'forbidden' })
  })
})
