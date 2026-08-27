import { env, SELF } from 'cloudflare:test'
import type {
  AttentionNoteRecord,
  AttentionSettings,
  AttentionSharingScopeImpact,
} from '@app/contracts'
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
const ALL_ATTENTION = [
  'store.read',
  'customer.read',
  'attention.read',
  'attention.write',
  'attention.publish',
  'attention.revise',
  'attention.hide',
] as const

const noteInput = {
  body: '来店中に他の顧客へ大声で抗議した',
  occurredAt: '2026-08-30T02:00:00.000Z',
  basis: '店内カメラ映像と担当者2名の報告',
  recommendedAction: '複数名で対応し、必要なら店長へ引き継ぐ',
}

type Actor = { userId: string; token: string }

async function seed(
  options: { managerPermissions?: readonly string[]; staffPermissions?: readonly string[] } = {},
) {
  const organizationId = uuid()
  await syncOrganization(organizationId)
  const storeId = await syncStore({ organizationId, name: '新宿店' })
  const customerId = await insertCustomer({ organizationId, primaryStoreId: storeId })

  const manager: Actor = { userId: uuid(), token: '' }
  await syncMembership({
    organizationId,
    storeId,
    userId: manager.userId,
    permissions: [...(options.managerPermissions ?? ['store.manage', ...ALL_ATTENTION])],
  })
  manager.token = await tokenFor(organizationId, 'staff', manager.userId)

  const staff: Actor = { userId: uuid(), token: '' }
  await syncMembership({
    organizationId,
    storeId,
    userId: staff.userId,
    permissions: [
      ...(options.staffPermissions ?? [
        'store.read',
        'customer.read',
        'attention.read',
        'attention.write',
      ]),
    ],
  })
  staff.token = await tokenFor(organizationId, 'staff', staff.userId)

  return { organizationId, storeId, customerId, manager, staff }
}

function notesUrl(storeId: string, customerId: string) {
  return `${BASE}/api/staff/stores/${storeId}/customers/${customerId}/attention-notes`
}

function noteUrl(storeId: string, noteId: string, suffix = '') {
  return `${BASE}/api/staff/stores/${storeId}/attention-notes/${noteId}${suffix}`
}

async function register(
  storeId: string,
  customerId: string,
  token: string,
): Promise<AttentionNoteRecord> {
  const response = await SELF.fetch(
    notesUrl(storeId, customerId),
    auth(token, { method: 'POST', body: JSON.stringify(noteInput) }),
  )
  expect(response.status).toBe(201)
  return (await response.json()) as AttentionNoteRecord
}

async function auditActions(organizationId: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    'SELECT action FROM audit_events WHERE organization_id = ? ORDER BY rowid',
  )
    .bind(organizationId)
    .all<{ action: string }>()
  return rows.results.map((row) => row.action)
}

describe('注意事項の権限設定 (UC-EYEX-139, 140, 142, 148, AC-EYEX-84)', () => {
  it('applies the new-organization default and reports the organization as the applied origin', async () => {
    const { storeId, manager } = await seed()
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/attention-settings`,
      auth(manager.token),
    )
    expect(response.status).toBe(200)
    const settings = (await response.json()) as AttentionSettings
    expect(settings.origin).toBe('organization')
    expect(settings.reviewMode).toBe('review_required')
    expect(settings.sharingScope).toBe('permitted_stores')
    expect(settings.capabilities).toEqual(
      expect.arrayContaining([
        { capability: 'read', minimumRole: 'staff', origin: 'organization' },
        { capability: 'write', minimumRole: 'staff', origin: 'organization' },
        { capability: 'publish', minimumRole: 'store_manager', origin: 'organization' },
        { capability: 'revise', minimumRole: 'store_manager', origin: 'organization' },
        { capability: 'hide', minimumRole: 'store_manager', origin: 'organization' },
      ]),
    )
    expect(settings.guidance.avoid).toContain('人格評価')
  })

  it('stores an organization default and a store override, and reports the store as the origin', async () => {
    const { organizationId, storeId } = await seed()
    const adminToken = await tokenFor(organizationId, 'admin')
    const capabilities = [
      { capability: 'read', minimumRole: 'staff' },
      { capability: 'write', minimumRole: 'staff' },
      { capability: 'publish', minimumRole: 'store_manager' },
      { capability: 'revise', minimumRole: 'store_manager' },
      { capability: 'hide', minimumRole: 'organization_admin' },
    ]
    const organizationWrite = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/attention-settings`,
      auth(adminToken, {
        method: 'PUT',
        body: JSON.stringify({
          scope: 'organization',
          reviewMode: 'review_required',
          sharingScope: 'permitted_stores',
          storeOverrideAllowed: true,
          capabilities,
        }),
      }),
    )
    expect(organizationWrite.status).toBe(200)

    const storeWrite = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/attention-settings`,
      auth(adminToken, {
        method: 'PUT',
        body: JSON.stringify({
          scope: 'store',
          reviewMode: 'immediate',
          sharingScope: 'permitted_stores',
          storeOverrideAllowed: true,
          capabilities,
        }),
      }),
    )
    expect(storeWrite.status).toBe(200)
    const stored = (await storeWrite.json()) as AttentionSettings
    expect(stored.origin).toBe('store')
    expect(stored.reviewMode).toBe('immediate')
    expect(stored.capabilities.every((rule) => rule.origin === 'store')).toBe(true)
    expect(await auditActions(organizationId)).toEqual([
      'attention_settings.updated',
      'attention_settings.updated',
    ])
  })

  it('reports the affected notes before a sharing-scope change and refuses an unacknowledged one (AC-EYEX-118)', async () => {
    const { organizationId, storeId, customerId, manager } = await seed()
    const first = await register(storeId, customerId, manager.token)
    await register(storeId, customerId, manager.token)
    expect(first.sharingScope).toBe('permitted_stores')

    const adminToken = await tokenFor(organizationId, 'admin')
    const impactResponse = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/attention-settings/sharing-scope-impact`,
      auth(adminToken, { method: 'POST', body: JSON.stringify({ requestedScope: 'chain' }) }),
    )
    expect(impactResponse.status).toBe(200)
    const impact = (await impactResponse.json()) as AttentionSharingScopeImpact
    expect(impact).toEqual({
      currentScope: 'permitted_stores',
      requestedScope: 'chain',
      affectedNoteCount: 2,
      affectedCustomerCount: 1,
      affectedStoreCount: 1,
    })

    const body = {
      scope: 'organization',
      reviewMode: 'review_required',
      sharingScope: 'chain',
      storeOverrideAllowed: true,
      capabilities: [
        { capability: 'read', minimumRole: 'staff' },
        { capability: 'write', minimumRole: 'staff' },
        { capability: 'publish', minimumRole: 'store_manager' },
        { capability: 'revise', minimumRole: 'store_manager' },
        { capability: 'hide', minimumRole: 'store_manager' },
      ],
    }
    const refused = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/attention-settings`,
      auth(adminToken, { method: 'PUT', body: JSON.stringify(body) }),
    )
    expect(refused.status).toBe(409)
    await expect(refused.json()).resolves.toEqual({
      error: 'sharing_scope_impact_unacknowledged',
      impact,
    })

    const accepted = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/attention-settings`,
      auth(adminToken, {
        method: 'PUT',
        body: JSON.stringify({ ...body, acknowledgedAffectedNoteCount: 2 }),
      }),
    )
    expect(accepted.status).toBe(200)
    const rescoped = await env.DB.prepare(
      "SELECT count(*) as total FROM customer_attention_notes WHERE organization_id = ? AND sharing_scope = 'chain'",
    )
      .bind(organizationId)
      .first<{ total: number }>()
    expect(rescoped?.total).toBe(2)
  })
})

describe('確認待ち登録とレビュー (UC-EYEX-141, 143, AC-EYEX-85, 116)', () => {
  it('stores a registered note apart from published information and hides it from ordinary staff', async () => {
    const { storeId, customerId, manager, staff } = await seed()
    const registered = await register(storeId, customerId, staff.token)
    expect(registered).toMatchObject({
      status: 'pending_review',
      version: 1,
      publishedAt: null,
      recordedBy: staff.userId,
      body: noteInput.body,
      occurredAt: noteInput.occurredAt,
      basis: noteInput.basis,
      recommendedAction: noteInput.recommendedAction,
    })

    const staffList = await SELF.fetch(notesUrl(storeId, customerId), auth(staff.token))
    expect(staffList.status).toBe(200)
    await expect(staffList.json()).resolves.toEqual([])

    const reviewerList = await SELF.fetch(notesUrl(storeId, customerId), auth(manager.token))
    const pending = (await reviewerList.json()) as AttentionNoteRecord[]
    expect(pending.map((note) => note.status)).toEqual(['pending_review'])

    const detail = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/customers/${customerId}`,
      auth(staff.token),
    )
    await expect(detail.json()).resolves.toMatchObject({ attentionNotes: [] })
  })

  it('publishes immediately when the organization is configured to (UC-EYEX-141)', async () => {
    const { organizationId, storeId, customerId, manager, staff } = await seed()
    const adminToken = await tokenFor(organizationId, 'admin')
    await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/attention-settings`,
      auth(adminToken, {
        method: 'PUT',
        body: JSON.stringify({
          scope: 'organization',
          reviewMode: 'immediate',
          sharingScope: 'permitted_stores',
          storeOverrideAllowed: true,
          capabilities: [
            { capability: 'read', minimumRole: 'staff' },
            { capability: 'write', minimumRole: 'staff' },
            { capability: 'publish', minimumRole: 'store_manager' },
            { capability: 'revise', minimumRole: 'store_manager' },
            { capability: 'hide', minimumRole: 'store_manager' },
          ],
        }),
      }),
    )
    const registered = await register(storeId, customerId, staff.token)
    expect(registered.status).toBe('published')
    expect(registered.publishedAt).toBe(NOW)

    const visible = await SELF.fetch(notesUrl(storeId, customerId), auth(staff.token))
    expect(((await visible.json()) as AttentionNoteRecord[]).map((note) => note.status)).toEqual([
      'published',
    ])
    void manager
  })

  it.each([
    ['publish', 'published'],
    ['return', 'returned'],
    ['reject', 'rejected'],
  ] as const)(
    'records the %s outcome with its reason against the registrant and the audit',
    async (decision, status) => {
      const { organizationId, storeId, customerId, manager, staff } = await seed()
      const registered = await register(storeId, customerId, staff.token)
      const response = await SELF.fetch(
        noteUrl(storeId, registered.noteId, '/review'),
        auth(manager.token, {
          method: 'POST',
          body: JSON.stringify({ decision, reason: '事実と根拠を確認した', expectedVersion: 1 }),
        }),
      )
      expect(response.status).toBe(200)
      const reviewed = (await response.json()) as AttentionNoteRecord
      expect(reviewed).toMatchObject({
        status,
        reviewedBy: manager.userId,
        reviewedAt: NOW,
        reviewReason: '事実と根拠を確認した',
        recordedBy: staff.userId,
      })
      expect(reviewed.publishedAt).toBe(decision === 'publish' ? NOW : null)
      expect(await auditActions(organizationId)).toContain(`attention_note.${status}`)
    },
  )

  it('refuses a review of a version that is no longer current and returns the difference (AC-EYEX-117)', async () => {
    const { storeId, customerId, manager, staff } = await seed()
    const registered = await register(storeId, customerId, staff.token)
    const published = await SELF.fetch(
      noteUrl(storeId, registered.noteId, '/review'),
      auth(manager.token, {
        method: 'POST',
        body: JSON.stringify({ decision: 'publish', reason: '確認済み', expectedVersion: 1 }),
      }),
    )
    expect(published.status).toBe(200)

    const revised = await SELF.fetch(
      noteUrl(storeId, registered.noteId, '/revisions'),
      auth(manager.token, {
        method: 'POST',
        body: JSON.stringify({ ...noteInput, body: '改訂した本文', expectedVersion: 1 }),
      }),
    )
    expect(revised.status).toBe(200)

    const stale = await SELF.fetch(
      noteUrl(storeId, registered.noteId, '/revisions'),
      auth(manager.token, {
        method: 'POST',
        body: JSON.stringify({ ...noteInput, body: '古い版からの改訂', expectedVersion: 1 }),
      }),
    )
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toEqual({
      error: 'attention_version_conflict',
      currentVersion: 2,
      expectedVersion: 1,
      differences: [{ field: 'body', before: noteInput.body, after: '改訂した本文' }],
    })
  })
})

describe('版管理と非表示化 (UC-EYEX-145, 146, AC-EYEX-86)', () => {
  it('keeps the previous version readable and publishes the new one', async () => {
    const { organizationId, storeId, customerId, manager, staff } = await seed()
    const registered = await register(storeId, customerId, staff.token)
    await SELF.fetch(
      noteUrl(storeId, registered.noteId, '/review'),
      auth(manager.token, {
        method: 'POST',
        body: JSON.stringify({ decision: 'publish', reason: '確認済み', expectedVersion: 1 }),
      }),
    )
    const revised = await SELF.fetch(
      noteUrl(storeId, registered.noteId, '/revisions'),
      auth(manager.token, {
        method: 'POST',
        body: JSON.stringify({ ...noteInput, body: '改訂した本文', expectedVersion: 1 }),
      }),
    )
    const current = (await revised.json()) as AttentionNoteRecord
    expect(current).toMatchObject({ version: 2, status: 'published', body: '改訂した本文' })

    const versions = await SELF.fetch(
      noteUrl(storeId, registered.noteId, '/versions'),
      auth(manager.token),
    )
    expect(versions.status).toBe(200)
    const history = (await versions.json()) as AttentionNoteRecord[]
    expect(history.map((note) => [note.version, note.status])).toEqual([
      [2, 'published'],
      [1, 'superseded'],
    ])
    expect(history[1]?.body).toBe(noteInput.body)

    const list = await SELF.fetch(notesUrl(storeId, customerId), auth(staff.token))
    expect(((await list.json()) as AttentionNoteRecord[]).map((note) => note.version)).toEqual([2])
    expect(await auditActions(organizationId)).toContain('attention_note.revised')
  })

  it('hides rather than deletes, keeping every row in D1', async () => {
    const { organizationId, storeId, customerId, manager, staff } = await seed()
    const registered = await register(storeId, customerId, staff.token)
    await SELF.fetch(
      noteUrl(storeId, registered.noteId, '/review'),
      auth(manager.token, {
        method: 'POST',
        body: JSON.stringify({ decision: 'publish', reason: '確認済み', expectedVersion: 1 }),
      }),
    )
    const hidden = await SELF.fetch(
      noteUrl(storeId, registered.noteId, '/hide'),
      auth(manager.token, {
        method: 'POST',
        body: JSON.stringify({ reason: '本人からの申し出', expectedVersion: 1 }),
      }),
    )
    expect(hidden.status).toBe(200)
    expect((await hidden.json()) as AttentionNoteRecord).toMatchObject({
      status: 'hidden',
      hiddenAt: NOW,
    })

    const list = await SELF.fetch(notesUrl(storeId, customerId), auth(staff.token))
    await expect(list.json()).resolves.toEqual([])
    const rows = await env.DB.prepare(
      'SELECT count(*) as total FROM customer_attention_notes WHERE organization_id = ?',
    )
      .bind(organizationId)
      .first<{ total: number }>()
    expect(rows?.total).toBe(1)
    expect(await auditActions(organizationId)).toContain('attention_note.hidden')
  })
})

describe('監査 (UC-EYEX-147, 156, AC-EYEX-103)', () => {
  it('audits every read, registration, publication, revision and hide', async () => {
    const { organizationId, storeId, customerId, manager, staff } = await seed()
    const registered = await register(storeId, customerId, staff.token)
    await SELF.fetch(
      noteUrl(storeId, registered.noteId, '/review'),
      auth(manager.token, {
        method: 'POST',
        body: JSON.stringify({ decision: 'publish', reason: '確認済み', expectedVersion: 1 }),
      }),
    )
    await SELF.fetch(
      noteUrl(storeId, registered.noteId, '/revisions'),
      auth(manager.token, {
        method: 'POST',
        body: JSON.stringify({ ...noteInput, body: '改訂', expectedVersion: 1 }),
      }),
    )
    await SELF.fetch(
      noteUrl(storeId, registered.noteId, '/hide'),
      auth(manager.token, {
        method: 'POST',
        body: JSON.stringify({ reason: '申し出', expectedVersion: 2 }),
      }),
    )
    const read = await SELF.fetch(notesUrl(storeId, customerId), auth(manager.token))
    expect(read.status).toBe(200)

    expect(await auditActions(organizationId)).toEqual([
      'attention_note.registered',
      'attention_note.published',
      'attention_note.revised',
      'attention_note.hidden',
      'attention_note.read',
    ])
  })

  it('does not let a management action take effect when its audit row cannot be appended (AC-EYEX-103)', async () => {
    const { storeId, customerId, staff } = await seed()
    // Make exactly the audit append fail, the way a broken audit store would.
    await env.DB.prepare(
      `CREATE TRIGGER audit_unavailable BEFORE INSERT ON audit_events
       WHEN NEW.action = 'attention_note.registered'
       BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`,
    ).run()

    const response = await SELF.fetch(
      notesUrl(storeId, customerId),
      auth(staff.token, { method: 'POST', body: JSON.stringify(noteInput) }),
    )
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'audit_append_failed' })
    const rows = await env.DB.prepare(
      'SELECT count(*) as total FROM customer_attention_notes WHERE customer_id = ?',
    )
      .bind(customerId)
      .first<{ total: number }>()
    expect(rows?.total).toBe(0)

    await env.DB.prepare('DROP TRIGGER audit_unavailable').run()
  })
})

describe('attention notes are not readable through the audit trail', () => {
  it('records which fields a revision changed, never the note text itself', async () => {
    // `audit.read` is a separate capability from `attention.read`. If the audit
    // metadata carried the note body, an auditor without `attention.read` could
    // read every 注意事項 through the audit surface, defeating AC-EYEX-91 and
    // the whole capability matrix.
    const { organizationId, storeId, customerId, manager, staff } = await seed()
    const registered = await register(storeId, customerId, staff.token)
    await SELF.fetch(
      noteUrl(storeId, registered.noteId, '/review'),
      auth(manager.token, {
        method: 'POST',
        body: JSON.stringify({ decision: 'publish', reason: '確認済み', expectedVersion: 1 }),
      }),
    )
    await SELF.fetch(
      noteUrl(storeId, registered.noteId, '/revisions'),
      auth(manager.token, {
        method: 'POST',
        body: JSON.stringify({ ...noteInput, body: '改訂した本文', expectedVersion: 1 }),
      }),
    )

    const rows = await env.DB.prepare(
      'SELECT metadata FROM audit_events WHERE organization_id = ? AND entity_type = ?',
    )
      .bind(organizationId, 'attention_note')
      .all<{ metadata: string | null }>()

    expect(rows.results.length).toBeGreaterThan(0)
    const metadata = rows.results.map((row) => row.metadata ?? '').join('\n')
    for (const secret of [
      noteInput.body,
      noteInput.basis,
      noteInput.recommendedAction,
      '改訂した本文',
    ])
      expect(metadata).not.toContain(secret)
    // The auditor still learns what happened: which fields moved, and to what version.
    expect(metadata).toContain('body')
    expect(metadata).toContain('version')
  })
})
