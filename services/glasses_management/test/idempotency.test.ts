import { env } from 'cloudflare:test'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { describe, expect, it } from 'vitest'
import * as schema from '../src/worker/db/schema'
import { idempotencyRecords } from '../src/worker/db/schema'
import { fixedClock } from '../src/worker/domain/clock'
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  type IdempotencyInput,
  RetryableIdempotencyError,
  withIdempotency,
} from '../src/worker/domain/idempotency'

const db = drizzle(env.DB, { schema })
type TestInput = IdempotencyInput<typeof schema>

const baseInput = (overrides: Partial<Omit<TestInput, 'db'>> = {}): TestInput => ({
  db,
  organizationId: crypto.randomUUID(),
  operation: 'reservation.create',
  key: crypto.randomUUID(),
  requestHash: 'request-v1',
  clock: fixedClock('2026-08-26T14:59:59.999Z'),
  ...overrides,
})

describe('withIdempotency', () => {
  it('rejects invalid input before claiming a key', async () => {
    const input = baseInput({ ttlMs: 0 })
    await expect(withIdempotency(input, async () => 'never')).rejects.toBeInstanceOf(RangeError)
  })

  it('returns the original result and does not execute twice for the same key', async () => {
    const input = baseInput()
    let executions = 0
    const execute = async () => {
      executions += 1
      return { reservationId: crypto.randomUUID(), sequence: executions }
    }

    const first = await withIdempotency(input, execute)
    const second = await withIdempotency(input, execute)

    expect(second).toEqual(first)
    expect(executions).toBe(1)
    const rows = await db
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.organizationId, input.organizationId),
          eq(idempotencyRecords.operation, input.operation),
          eq(idempotencyRecords.key, input.key),
        ),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('completed')
  })

  it('fails closed when completion persistence fails after the operation ran', async () => {
    const input = baseInput()
    let executions = 0

    await env.DB.prepare(`
      CREATE TRIGGER idempotency_test_reject_completion
      BEFORE UPDATE OF status ON idempotency_records
      WHEN NEW.status = 'completed'
      BEGIN
        SELECT RAISE(ABORT, 'simulated completion persistence failure');
      END;
    `).run()

    try {
      const execute = async () => {
        executions += 1
        return { reservationId: crypto.randomUUID() }
      }

      await expect(withIdempotency(input, execute)).rejects.toThrow('Failed query')
      await expect(
        withIdempotency({ ...input, clock: fixedClock('2026-08-28T15:00:00.000Z') }, execute),
      ).rejects.toBeInstanceOf(IdempotencyInProgressError)

      expect(executions).toBe(1)
    } finally {
      await env.DB.prepare('DROP TRIGGER idempotency_test_reject_completion').run()
    }
  })

  it('rejects reuse of a key with a different request hash', async () => {
    const input = baseInput()
    await withIdempotency(input, async () => 'first')

    await expect(
      withIdempotency({ ...input, requestHash: 'request-v2' }, async () => 'second'),
    ).rejects.toBeInstanceOf(IdempotencyConflictError)
  })

  it('keeps the same key independent when the operation scope is different', async () => {
    const input = baseInput({ key: 'shared-key' })
    await expect(withIdempotency(input, async () => 'store-a')).resolves.toBe('store-a')
    await expect(
      withIdempotency(
        { ...input, operation: 'reservation.create:other-store' },
        async () => 'store-b',
      ),
    ).resolves.toBe('store-b')
  })

  it('fails closed after an operation error because its side effects may be indeterminate', async () => {
    const input = baseInput()
    await expect(
      withIdempotency(input, async () => {
        throw new Error('domain write failed')
      }),
    ).rejects.toThrow('domain write failed')

    let executions = 0
    await expect(
      withIdempotency(input, async () => {
        executions += 1
        return 'recovered'
      }),
    ).rejects.toBeInstanceOf(IdempotencyInProgressError)
    expect(executions).toBe(0)
  })

  it('releases its own claim after an explicitly retryable pre-commit failure', async () => {
    const input = baseInput()
    let executions = 0

    await expect(
      withIdempotency(input, async () => {
        executions += 1
        throw new RetryableIdempotencyError('the atomic reservation batch rolled back')
      }),
    ).rejects.toBeInstanceOf(RetryableIdempotencyError)

    await expect(
      withIdempotency(input, async () => {
        executions += 1
        return 'recovered'
      }),
    ).resolves.toBe('recovered')
    expect(executions).toBe(2)
  })

  it('does not execute while another request owns a non-expired in-progress key', async () => {
    const input = baseInput()
    await db.insert(idempotencyRecords).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      operation: input.operation,
      key: input.key,
      requestHash: input.requestHash,
      status: 'in_progress',
      resultJson: null,
      createdAt: '2026-08-26T14:59:59.999Z',
      expiresAt: '2026-08-27T14:59:59.999Z',
    })

    await expect(withIdempotency(input, async () => 'must not run')).rejects.toBeInstanceOf(
      IdempotencyInProgressError,
    )
  })

  it('does not take over an expired in-progress key whose side effects are indeterminate', async () => {
    const input = baseInput({ clock: fixedClock('2026-08-28T15:00:00.000Z') })
    await db.insert(idempotencyRecords).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      operation: input.operation,
      key: input.key,
      requestHash: input.requestHash,
      status: 'in_progress',
      resultJson: null,
      createdAt: '2026-08-26T14:59:59.999Z',
      expiresAt: '2026-08-27T14:59:59.999Z',
    })

    await expect(withIdempotency(input, async () => 'must-not-run')).rejects.toBeInstanceOf(
      IdempotencyInProgressError,
    )
  })

  it('refuses a claim whose expiry value is invalid instead of guessing its lease', async () => {
    const input = baseInput({ clock: fixedClock('2026-08-28T15:00:00.000Z') })
    await db.insert(idempotencyRecords).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      operation: input.operation,
      key: input.key,
      requestHash: input.requestHash,
      status: 'in_progress',
      resultJson: null,
      createdAt: '2026-08-26T14:59:59.999Z',
      expiresAt: 'not-a-date',
    })

    await expect(withIdempotency(input, async () => 'must-not-run')).rejects.toBeInstanceOf(
      IdempotencyInProgressError,
    )
  })

  it('rejects a malformed completed record instead of executing again', async () => {
    const input = baseInput()
    await db.insert(idempotencyRecords).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      operation: input.operation,
      key: input.key,
      requestHash: input.requestHash,
      status: 'completed',
      resultJson: null,
      createdAt: '2026-08-26T00:00:00.000Z',
      expiresAt: '2026-08-27T00:00:00.000Z',
    })

    await expect(withIdempotency(input, async () => 'must-not-run')).rejects.toThrow(
      'completed idempotency record has no result',
    )
  })

  it('rejects an unknown persisted status', async () => {
    const input = baseInput()
    await db.insert(idempotencyRecords).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      operation: input.operation,
      key: input.key,
      requestHash: input.requestHash,
      status: 'corrupt',
      resultJson: null,
      createdAt: '2026-08-26T00:00:00.000Z',
      expiresAt: '2026-08-27T00:00:00.000Z',
    })

    await expect(withIdempotency(input, async () => 'must-not-run')).rejects.toThrow(
      'unknown idempotency status: corrupt',
    )
  })

  it('fails closed when the operation result cannot be serialized', async () => {
    const input = baseInput()
    await expect(withIdempotency(input, async () => undefined)).rejects.toThrow(
      'idempotency result must be JSON serializable',
    )
    const rows = await db
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.organizationId, input.organizationId),
          eq(idempotencyRecords.operation, input.operation),
          eq(idempotencyRecords.key, input.key),
        ),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('in_progress')
    await expect(withIdempotency(input, async () => 'must-not-run')).rejects.toBeInstanceOf(
      IdempotencyInProgressError,
    )
  })
})
