import type { RecordingState } from '@app/contracts'

/**
 * 録音の状態遷移。予約の状態とは独立しており、破棄された受付の録音も
 * 保存・保全・削除の全経路を通る。ここに書かれていない遷移は拒否する。
 */
export const RECORDING_TRANSITIONS: Readonly<Record<RecordingState, readonly RecordingState[]>> =
  Object.freeze({
    permission_check: ['recording', 'failed'],
    recording: ['stopped', 'failed'],
    stopped: ['uploading', 'failed'],
    uploading: ['stored', 'failed'],
    stored: ['held', 'pending_deletion', 'deleted'],
    failed: ['uploading', 'deleted'],
    held: ['stored', 'pending_deletion'],
    pending_deletion: ['held', 'deleted'],
    // 削除済みは終端。復元経路を持たせない。
    deleted: [],
  })

/** Refused state change, mapped by handlers to 409. */
export class RecordingTransitionError extends Error {
  readonly code = 'invalid_recording_state' as const
  readonly status = 409 as const
  readonly from: RecordingState
  readonly to: RecordingState

  constructor(from: RecordingState, to: RecordingState) {
    super(`recording cannot move from ${from} to ${to}`)
    this.name = 'RecordingTransitionError'
    this.from = from
    this.to = to
  }
}

export function canTransitionRecording(from: RecordingState, to: RecordingState): boolean {
  return (RECORDING_TRANSITIONS[from] ?? []).includes(to)
}

export function assertRecordingTransition(from: RecordingState, to: RecordingState): void {
  if (!canTransitionRecording(from, to)) throw new RecordingTransitionError(from, to)
}

/** 成立予約の録音は最低30日、破棄受付の録音は最低24時間。 */
export const MINIMUM_CONFIRMED_RETENTION_DAYS = 30
export const MINIMUM_DISCARDED_RETENTION_HOURS = 24

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export type RetentionInput = {
  endedAt: string
  hasReservation: boolean
  confirmedRetentionDays: number
  discardedRetentionHours: number
}

/**
 * The deadline before which no deletion path may remove the audio body. The
 * configured operational retention can only lengthen it, never shorten the
 * guaranteed minimum.
 */
export function retentionDeadline(input: RetentionInput): string {
  const endedAt = Date.parse(input.endedAt)
  if (Number.isNaN(endedAt)) throw new RangeError('endedAt must be an ISO instant')
  const durationMs = input.hasReservation
    ? Math.max(input.confirmedRetentionDays, MINIMUM_CONFIRMED_RETENTION_DAYS) * DAY_MS
    : Math.max(input.discardedRetentionHours, MINIMUM_DISCARDED_RETENTION_HOURS) * HOUR_MS
  return new Date(endedAt + durationMs).toISOString()
}

/** The minimum guarantee alone, shown when a deletion is refused. */
export function minimumRetentionDeadline(endedAt: string, hasReservation: boolean): string {
  return retentionDeadline({
    endedAt,
    hasReservation,
    confirmedRetentionDays: MINIMUM_CONFIRMED_RETENTION_DAYS,
    discardedRetentionHours: MINIMUM_DISCARDED_RETENTION_HOURS,
  })
}

/**
 * Retention is over exactly at the deadline: `now === deadline` may delete,
 * one millisecond earlier may not.
 */
export function retentionIsActive(retentionUntil: string, now: Date): boolean {
  const deadline = Date.parse(retentionUntil)
  if (Number.isNaN(deadline)) throw new RangeError('retentionUntil must be an ISO instant')
  return now.getTime() < deadline
}

export type StorageKeyInput = {
  organizationId: string
  storeId: string
  recordingId: string
  /** 32 hex characters of entropy so the key cannot be guessed from ids. */
  secret: string
}

function assertKeySegment(value: string): string {
  if (value.length === 0 || value.includes('/') || value.includes('..')) {
    throw new RangeError('recording key segment must not escape its tenant prefix')
  }
  return value
}

/** Tenant-scoped, unguessable private R2 key. It is never sent to a client. */
export function recordingStorageKey(input: StorageKeyInput): string {
  if (!/^[0-9a-f]{32}$/.test(input.secret)) {
    throw new RangeError('recording key secret must be 32 hex characters')
  }
  return [
    assertKeySegment(input.organizationId),
    assertKeySegment(input.storeId),
    assertKeySegment(input.recordingId),
    input.secret,
  ].join('/')
}

/** Fresh entropy for one recording object key. */
export function recordingKeySecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
