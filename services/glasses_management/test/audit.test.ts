import { env } from 'cloudflare:test'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { describe, expect, it } from 'vitest'
import * as schema from '../src/worker/db/schema'
import { auditEvents, organizations, stores } from '../src/worker/db/schema'
import { AuditAppendError, type AuditEventInput, writeAuditBatch } from '../src/worker/domain/audit'
import { fixedClock } from '../src/worker/domain/clock'

const db = drizzle(env.DB, { schema })

function event(input: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    id: input.id ?? crypto.randomUUID(),
    organizationId: input.organizationId ?? crypto.randomUUID(),
    storeId: input.storeId ?? null,
    actorType: input.actorType ?? 'staff',
    actorId: input.actorId ?? crypto.randomUUID(),
    action: input.action ?? 'store.update',
    entityType: input.entityType ?? 'store',
    entityId: input.entityId ?? crypto.randomUUID(),
    requestId: input.requestId ?? crypto.randomUUID(),
    metadata: input.metadata ?? { source: 'test' },
  }
}

async function insertOrganization(id: string) {
  await db.insert(organizations).values({
    id,
    name: `Audit test ${id}`,
    plan: 'free',
    isDisabled: '0',
    createdAt: '2026-08-26T00:00:00.000Z',
    syncRevision: 0,
  })
}

describe('writeAuditBatch', () => {
  it('requires at least one audit event', async () => {
    await expect(
      writeAuditBatch(db, {
        clock: fixedClock('2026-08-26T00:00:00.000Z'),
        events: [],
      }),
    ).rejects.toBeInstanceOf(AuditAppendError)
  })

  it('commits a domain write and its append-only audit event as one D1 batch', async () => {
    const organizationId = crypto.randomUUID()
    const storeId = crypto.randomUUID()
    const auditId = crypto.randomUUID()
    await insertOrganization(organizationId)

    const audit = event({ organizationId, storeId, entityId: storeId, id: auditId })
    await writeAuditBatch(db, {
      clock: fixedClock('2026-08-26T14:59:59.999Z'),
      operations: [
        db.insert(stores).values({
          id: storeId,
          organizationId,
          name: 'Shibuya',
          slug: `shibuya-${storeId}`,
          isActive: '1',
          createdAt: '2026-08-26T14:59:59.999Z',
        }),
      ],
      events: [audit],
    })

    const savedStore = await db.select().from(stores).where(eq(stores.id, storeId))
    const savedAudit = await db.select().from(auditEvents).where(eq(auditEvents.id, auditId))
    expect(savedStore).toHaveLength(1)
    expect(savedAudit).toMatchObject([
      expect.objectContaining({
        organizationId,
        storeId,
        action: 'store.update',
        occurredAt: '2026-08-26T14:59:59.999Z',
      }),
    ])
  })

  it('fails closed: a failed audit append rolls back the management write', async () => {
    const organizationId = crypto.randomUUID()
    const storeId = crypto.randomUUID()
    const auditId = crypto.randomUUID()
    await insertOrganization(organizationId)
    await db.insert(stores).values({
      id: storeId,
      organizationId,
      name: 'Before',
      slug: `before-${storeId}`,
      isActive: '1',
      createdAt: '2026-08-26T00:00:00.000Z',
    })

    const audit = event({ organizationId, storeId, entityId: storeId, id: auditId })
    await writeAuditBatch(db, {
      clock: fixedClock('2026-08-26T00:00:00.000Z'),
      events: [audit],
    })

    await expect(
      writeAuditBatch(db, {
        clock: fixedClock('2026-08-26T00:00:01.000Z'),
        operations: [
          db
            .update(stores)
            .set({ name: 'Should not be committed' })
            .where(and(eq(stores.id, storeId), eq(stores.organizationId, organizationId))),
        ],
        events: [audit],
      }),
    ).rejects.toBeInstanceOf(AuditAppendError)

    const unchanged = await db.select().from(stores).where(eq(stores.id, storeId))
    expect(unchanged[0]?.name).toBe('Before')
  })

  it('stores JSON metadata and rejects updates to an existing audit event', async () => {
    const organizationId = crypto.randomUUID()
    const audit = event({ organizationId, metadata: { nested: { value: 42 }, pii: false } })
    await insertOrganization(organizationId)
    await writeAuditBatch(db, {
      clock: fixedClock('2026-02-28T15:00:00.000Z'),
      events: [audit],
    })

    const auditId = audit.id ?? ''
    const row = (await db.select().from(auditEvents).where(eq(auditEvents.id, auditId)))[0]
    expect(row?.metadata).toBe(JSON.stringify(audit.metadata))
    await expect(
      db.update(auditEvents).set({ action: 'tampered' }).where(eq(auditEvents.id, auditId)),
    ).rejects.toThrow()
  })
})
