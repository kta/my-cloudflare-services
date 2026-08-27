import { RecordingState } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  assertRecordingTransition,
  canTransitionRecording,
  MINIMUM_CONFIRMED_RETENTION_DAYS,
  MINIMUM_DISCARDED_RETENTION_HOURS,
  RECORDING_TRANSITIONS,
  RecordingTransitionError,
  recordingStorageKey,
  retentionDeadline,
  retentionIsActive,
} from '../src/worker/domain/recording'

const states = RecordingState.options

const legal: ReadonlyArray<readonly [string, string]> = [
  ['permission_check', 'recording'],
  ['permission_check', 'failed'],
  ['recording', 'stopped'],
  ['recording', 'failed'],
  ['stopped', 'uploading'],
  ['stopped', 'failed'],
  ['uploading', 'stored'],
  ['uploading', 'failed'],
  ['stored', 'held'],
  ['stored', 'pending_deletion'],
  ['stored', 'deleted'],
  ['failed', 'uploading'],
  ['failed', 'deleted'],
  ['held', 'stored'],
  ['held', 'pending_deletion'],
  ['pending_deletion', 'held'],
  ['pending_deletion', 'deleted'],
]

describe('recording state machine', () => {
  it.each(legal)('allows %s → %s', (from, to) => {
    expect(canTransitionRecording(from as never, to as never)).toBe(true)
    expect(() => {
      assertRecordingTransition(from as never, to as never)
    }).not.toThrow()
  })

  it('rejects every transition that is not explicitly allowed', () => {
    const allowed = new Set(legal.map(([from, to]) => `${from}->${to}`))
    for (const from of states) {
      for (const to of states) {
        if (allowed.has(`${from}->${to}`)) continue
        expect(canTransitionRecording(from, to)).toBe(false)
        expect(() => {
          assertRecordingTransition(from, to)
        }).toThrow(RecordingTransitionError)
      }
    }
  })

  it('never leaves the deleted state and covers every declared state', () => {
    expect(RECORDING_TRANSITIONS.deleted).toEqual([])
    expect(Object.keys(RECORDING_TRANSITIONS).sort()).toEqual([...states].sort())
  })

  it('reports the refused transition on the error', () => {
    const error = (() => {
      try {
        assertRecordingTransition('deleted', 'stored')
        return null
      } catch (thrown) {
        return thrown
      }
    })()
    expect(error).toBeInstanceOf(RecordingTransitionError)
    expect((error as RecordingTransitionError).status).toBe(409)
    expect((error as RecordingTransitionError).code).toBe('invalid_recording_state')
    expect((error as RecordingTransitionError).message).toContain('deleted')
  })
})

describe('retention deadline', () => {
  it('keeps a confirmed reservation recording for at least thirty days from completion', () => {
    expect(MINIMUM_CONFIRMED_RETENTION_DAYS).toBe(30)
    expect(
      retentionDeadline({
        endedAt: '2026-08-01T00:00:00.000Z',
        hasReservation: true,
        confirmedRetentionDays: 30,
        discardedRetentionHours: 24,
      }),
    ).toBe('2026-08-31T00:00:00.000Z')
  })

  it('keeps a discarded reception recording for at least twenty-four hours from the end', () => {
    expect(MINIMUM_DISCARDED_RETENTION_HOURS).toBe(24)
    expect(
      retentionDeadline({
        endedAt: '2026-08-30T00:00:00.000Z',
        hasReservation: false,
        confirmedRetentionDays: 30,
        discardedRetentionHours: 24,
      }),
    ).toBe('2026-08-31T00:00:00.000Z')
  })

  it('honours a configured retention raised above the minimum', () => {
    expect(
      retentionDeadline({
        endedAt: '2026-08-01T00:00:00.000Z',
        hasReservation: true,
        confirmedRetentionDays: 90,
        discardedRetentionHours: 72,
      }),
    ).toBe('2026-10-30T00:00:00.000Z')
    expect(
      retentionDeadline({
        endedAt: '2026-08-30T00:00:00.000Z',
        hasReservation: false,
        confirmedRetentionDays: 90,
        discardedRetentionHours: 72,
      }),
    ).toBe('2026-09-02T00:00:00.000Z')
  })

  it('never falls below the guaranteed minimum even if a lower value reaches it', () => {
    expect(
      retentionDeadline({
        endedAt: '2026-08-01T00:00:00.000Z',
        hasReservation: true,
        confirmedRetentionDays: 1,
        discardedRetentionHours: 1,
      }),
    ).toBe('2026-08-31T00:00:00.000Z')
    expect(
      retentionDeadline({
        endedAt: '2026-08-30T00:00:00.000Z',
        hasReservation: false,
        confirmedRetentionDays: 1,
        discardedRetentionHours: 1,
      }),
    ).toBe('2026-08-31T00:00:00.000Z')
  })

  it('rejects an invalid end instant', () => {
    expect(() =>
      retentionDeadline({
        endedAt: 'not-an-instant',
        hasReservation: false,
        confirmedRetentionDays: 30,
        discardedRetentionHours: 24,
      }),
    ).toThrow(RangeError)
  })
})

describe('retentionIsActive boundary', () => {
  const deadline = '2026-08-31T00:00:00.000Z'

  it('is active one millisecond before the deadline', () => {
    expect(retentionIsActive(deadline, new Date('2026-08-30T23:59:59.999Z'))).toBe(true)
  })

  it('is active one second before the deadline', () => {
    expect(retentionIsActive(deadline, new Date('2026-08-30T23:59:59.000Z'))).toBe(true)
  })

  it('is over exactly at the deadline', () => {
    expect(retentionIsActive(deadline, new Date(deadline))).toBe(false)
  })

  it('is over one second after the deadline', () => {
    expect(retentionIsActive(deadline, new Date('2026-08-31T00:00:01.000Z'))).toBe(false)
  })
})

describe('recordingStorageKey', () => {
  it('scopes the object key to the tenant, the store and an unguessable suffix', () => {
    const key = recordingStorageKey({
      organizationId: 'org-1',
      storeId: 'store-1',
      recordingId: 'rec-1',
      secret: 'a'.repeat(32),
    })
    expect(key).toBe(`org-1/store-1/rec-1/${'a'.repeat(32)}`)
  })

  it('refuses an identifier that would escape its tenant prefix', () => {
    expect(() =>
      recordingStorageKey({
        organizationId: '../other-org',
        storeId: 'store-1',
        recordingId: 'rec-1',
        secret: 'a'.repeat(32),
      }),
    ).toThrow(RangeError)
    expect(() =>
      recordingStorageKey({
        organizationId: 'org-1',
        storeId: 'store-1',
        recordingId: 'rec-1',
        secret: 'short',
      }),
    ).toThrow(RangeError)
  })
})
