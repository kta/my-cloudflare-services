import { and, eq } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { idempotencyRecords } from '../db/schema'
import type { Clock } from './clock'

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

export type IdempotencyInput<TSchema extends Record<string, unknown> = Record<string, never>> = {
  db: DrizzleD1Database<TSchema>
  organizationId: string
  operation: string
  key: string
  /** A stable digest of the request body; prevents key reuse with new input. */
  requestHash: string
  clock: Clock
  ttlMs?: number
}

export class IdempotencyConflictError extends Error {
  readonly code = 'idempotency_conflict' as const
  readonly status = 409 as const

  constructor() {
    super('idempotency key was already used with a different request')
    this.name = 'IdempotencyConflictError'
  }
}

export class IdempotencyInProgressError extends Error {
  readonly code = 'idempotency_in_progress' as const
  readonly status = 409 as const

  constructor() {
    super('idempotency key has started and cannot be safely retried')
    this.name = 'IdempotencyInProgressError'
  }
}

/**
 * Signals that the caller proved no domain side effect committed (for example,
 * a D1 batch was rolled back by a unique resource claim). Only this error may
 * release the claim created by the current invocation.
 */
export class RetryableIdempotencyError extends Error {
  readonly retryable = true as const

  constructor(message: string) {
    super(message)
    this.name = 'RetryableIdempotencyError'
  }
}

function validateInput<TSchema extends Record<string, unknown>>(
  input: IdempotencyInput<TSchema>,
): void {
  for (const [label, value] of [
    ['organizationId', input.organizationId],
    ['operation', input.operation],
    ['key', input.key],
    ['requestHash', input.requestHash],
  ] as const) {
    if (value.trim().length === 0) throw new TypeError(`${label} must not be empty`)
  }
  if (input.ttlMs !== undefined && (!Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0)) {
    throw new RangeError('idempotency ttl must be a positive safe integer')
  }
}

function encodeResult<T>(value: T): string {
  const result = JSON.stringify(value)
  if (result === undefined) throw new TypeError('idempotency result must be JSON serializable')
  return result
}

function decodeResult<T>(result: string): T {
  return JSON.parse(result) as T
}

/**
 * Execute an operation once per tenant/operation/key and persist its result.
 *
 * A unique D1 index claims the key before executing the operation. Another
 * request that sees a claim receives a conflict rather than executing the side
 * effect a second time. Because an arbitrary `execute` callback cannot share a
 * D1 transaction with the completion update, a started claim is never
 * automatically released or reclaimed, even after `expiresAt`. This is an
 * intentional fail-closed trade-off: an interrupted request may require manual
 * reconciliation, but it can never be retried into a duplicate reservation or
 * notification. Successful operations return the stored JSON result.
 */
export async function withIdempotency<T, TSchema extends Record<string, unknown>>(
  input: IdempotencyInput<TSchema>,
  execute: (completeInBatch: (result: T, persistedResult?: T) => BatchItem<'sqlite'>) => Promise<T>,
): Promise<T> {
  validateInput(input)
  const now = input.clock.now()
  const nowMs = now.getTime()
  if (Number.isNaN(nowMs)) throw new RangeError('clock returned an invalid date')
  const createdAt = now.toISOString()
  const expiresAt = new Date(nowMs + (input.ttlMs ?? DEFAULT_TTL_MS)).toISOString()
  const id = crypto.randomUUID()

  await input.db
    .insert(idempotencyRecords)
    .values({
      id,
      organizationId: input.organizationId,
      operation: input.operation,
      key: input.key,
      requestHash: input.requestHash,
      status: 'in_progress',
      resultJson: null,
      createdAt,
      expiresAt,
    })
    .onConflictDoNothing({
      target: [
        idempotencyRecords.organizationId,
        idempotencyRecords.operation,
        idempotencyRecords.key,
      ],
    })
    .run()

  const rows = await input.db
    .select()
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.organizationId, input.organizationId),
        eq(idempotencyRecords.operation, input.operation),
        eq(idempotencyRecords.key, input.key),
      ),
    )
  const record = rows[0]
  if (!record) throw new Error('idempotency claim disappeared')
  if (record.requestHash !== input.requestHash) throw new IdempotencyConflictError()

  if (record.status === 'completed') {
    if (record.resultJson === null) throw new Error('completed idempotency record has no result')
    return decodeResult<T>(record.resultJson)
  }

  if (record.status !== 'in_progress') {
    throw new Error(`unknown idempotency status: ${record.status}`)
  }

  // `expiresAt` is an operational reconciliation signal, not a retry lease.
  // Reclaiming here would be unsafe: the previous Worker may have committed
  // its domain write and crashed before persisting the completed marker.
  if (record.id !== id) {
    throw new IdempotencyInProgressError()
  }

  let completionIncluded = false
  const completeInBatch = (result: T, persistedResult: T = result): BatchItem<'sqlite'> => {
    completionIncluded = true
    const completion = input.db
      .update(idempotencyRecords)
      .set({ status: 'completed', resultJson: encodeResult(persistedResult) })
      .where(
        and(eq(idempotencyRecords.id, record.id), eq(idempotencyRecords.status, 'in_progress')),
      )
    return completion as unknown as BatchItem<'sqlite'>
  }
  let result: T
  try {
    result = await execute(completeInBatch)
  } catch (error) {
    if (error instanceof RetryableIdempotencyError) {
      await input.db
        .delete(idempotencyRecords)
        .where(
          and(eq(idempotencyRecords.id, record.id), eq(idempotencyRecords.status, 'in_progress')),
        )
        .run()
    }
    throw error
  }
  if (completionIncluded) return result
  const resultJson = encodeResult(result)
  const completed = await input.db
    .update(idempotencyRecords)
    .set({ status: 'completed', resultJson })
    .where(and(eq(idempotencyRecords.id, record.id), eq(idempotencyRecords.status, 'in_progress')))
    .run()
  if (completed.meta.changes === 0) throw new Error('idempotency claim was lost before completion')
  return result
}
