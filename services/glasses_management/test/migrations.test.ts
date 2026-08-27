import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

type SqliteObject = {
  name: string
  type: string
}

async function sqliteObjects(): Promise<SqliteObject[]> {
  const result = await env.DB.prepare(
    "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index', 'trigger') ORDER BY type, name",
  ).all<SqliteObject>()
  return result.results
}

describe('glasses_management D1 migrations', () => {
  it('applies the complete foundation schema to an empty D1 database', async () => {
    const objects = await sqliteObjects()
    const names = new Set(objects.map((object) => `${object.type}:${object.name}`))

    expect([...names]).toEqual(
      expect.arrayContaining([
        'table:organizations',
        'table:stores',
        'table:store_memberships',
        'table:audit_events',
        'table:idempotency_records',
        'table:d1_migrations',
        'index:stores_organization_id_idx',
        'index:stores_organization_active_idx',
        'index:stores_organization_slug_unique_idx',
        'index:store_memberships_org_user_idx',
        'index:store_memberships_org_store_user_idx',
        'index:audit_events_org_occurred_idx',
        'index:audit_events_org_entity_idx',
        'index:idempotency_org_operation_key_idx',
        'index:idempotency_expires_at_idx',
        'trigger:audit_events_no_update',
        'trigger:audit_events_no_delete',
        'table:web_booking_management_code_issues',
        'table:web_booking_verified_sessions',
        'index:web_booking_management_code_issues_hash_unique_idx',
        'index:web_booking_verified_sessions_token_hash_unique_idx',
      ]),
    )
  })

  it('keeps the append-only audit guard and tenant columns in the generated schema', async () => {
    const columns = await env.DB.prepare('PRAGMA table_info(audit_events)').all<{
      name: string
      notnull: number
    }>()
    expect(columns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'organization_id', notnull: 1 }),
        expect.objectContaining({ name: 'actor_id', notnull: 1 }),
        expect.objectContaining({ name: 'entity_id', notnull: 1 }),
      ]),
    )

    const trigger = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'audit_events_no_update'",
    ).first<{ sql: string }>()
    expect(trigger?.sql).toContain('RAISE(ABORT')
  })

  it('gives existing shared terminals the safe two-minute idle default', async () => {
    const columns = await env.DB.prepare('PRAGMA table_info(shared_terminals)').all<{
      name: string
      notnull: number
      dflt_value: string | null
    }>()
    expect(columns.results).toContainEqual(
      expect.objectContaining({
        name: 'idle_timeout_seconds',
        notnull: 1,
        dflt_value: '120',
      }),
    )
  })

  it('enforces one store slug per organization and one membership per store user', async () => {
    const organizationId = crypto.randomUUID()
    const storeId = crypto.randomUUID()
    const userId = crypto.randomUUID()

    await env.DB.prepare(
      `INSERT INTO stores
        (id, organization_id, name, slug, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(storeId, organizationId, '銀座店', 'ginza', '1', '2026-08-26T00:00:00.000Z')
      .run()

    await expect(
      env.DB.prepare(
        `INSERT INTO stores
          (id, organization_id, name, slug, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          organizationId,
          '銀座別名',
          'ginza',
          '1',
          '2026-08-26T00:00:00.000Z',
        )
        .run(),
    ).rejects.toThrow()

    await env.DB.prepare(
      `INSERT INTO store_memberships
        (id, organization_id, store_id, user_id, permissions, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        organizationId,
        storeId,
        userId,
        '["store.read"]',
        '2026-08-26T00:00:00.000Z',
      )
      .run()

    await expect(
      env.DB.prepare(
        `INSERT INTO store_memberships
          (id, organization_id, store_id, user_id, permissions, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          organizationId,
          storeId,
          userId,
          '["store.manage"]',
          '2026-08-26T00:00:00.000Z',
        )
        .run(),
    ).rejects.toThrow()
  })
})
