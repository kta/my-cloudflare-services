import type { BatchItem } from 'drizzle-orm/batch'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { auditEvents } from '../db/schema'
import type { Clock } from './clock'

type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type AuditEventInput = {
  id?: string
  organizationId: string
  storeId?: string | null
  actorType: string
  actorId: string
  action: string
  entityType: string
  entityId: string
  requestId?: string | null
  metadata?: JsonValue
}

export type AuditBatchOperation = BatchItem<'sqlite'>
// Keep the boundary compatible with the repository convention of creating
// `drizzle(c.env.DB)` inside each handler. The table arguments still provide
// full column inference without forcing every caller to register a global
// schema object.
export type GlassesDatabase<TSchema extends Record<string, unknown>> = DrizzleD1Database<TSchema>

export type AuditBatchInput = {
  clock: Clock
  events: readonly AuditEventInput[]
  operations?: readonly AuditBatchOperation[]
}

/** Error mapped by handlers to a fail-closed 500 response. */
export class AuditAppendError extends Error {
  readonly code = 'audit_append_failed' as const
  readonly status = 500 as const

  constructor(cause: unknown) {
    super('audit event could not be appended')
    this.name = 'AuditAppendError'
    this.cause = cause
  }
}

function serializedMetadata(metadata: JsonValue | undefined): string {
  const serialized = JSON.stringify(metadata ?? {})
  if (serialized === undefined) throw new TypeError('audit metadata must be JSON serializable')
  return serialized
}

function eventInsert<TSchema extends Record<string, unknown>>(
  db: GlassesDatabase<TSchema>,
  input: AuditEventInput,
  occurredAt: string,
) {
  return db.insert(auditEvents).values({
    id: input.id ?? crypto.randomUUID(),
    organizationId: input.organizationId,
    storeId: input.storeId ?? null,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    requestId: input.requestId ?? null,
    metadata: serializedMetadata(input.metadata),
    occurredAt,
  })
}

/**
 * Execute domain writes and their audit append in one D1 batch.
 *
 * D1 rolls the complete batch back when any statement fails, which is the
 * fail-closed guarantee needed for settings, reservations, recording
 * metadata, and other sensitive operations.
 */
export async function writeAuditBatch<TSchema extends Record<string, unknown>>(
  db: GlassesDatabase<TSchema>,
  input: AuditBatchInput,
): Promise<readonly unknown[]> {
  if (input.events.length === 0) {
    throw new AuditAppendError(new Error('at least one audit event is required'))
  }

  const occurredAt = input.clock.now().toISOString()
  const statements: AuditBatchOperation[] = [
    ...(input.operations ?? []),
    ...input.events.map((event) => eventInsert(db, event, occurredAt)),
  ]

  try {
    // D1's Drizzle batch API requires a non-empty tuple. The event guard above
    // proves that this cast has a real first element, not an optional query.
    return await db.batch(
      statements as unknown as readonly [AuditBatchOperation, ...AuditBatchOperation[]],
    )
  } catch (cause) {
    throw new AuditAppendError(cause)
  }
}
