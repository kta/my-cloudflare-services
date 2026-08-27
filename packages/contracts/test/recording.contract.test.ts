import { describe, expect, it } from 'vitest'
import {
  Recording,
  RecordingEndReason,
  RecordingHoldInput,
  RecordingHoldRelease,
  RecordingListQuery,
  RecordingMetadataCreate,
  RecordingReconciliationReport,
  RecordingReconciliationRequest,
  RecordingReservationLink,
  RecordingRetentionSettings,
  RecordingRetentionSettingsInput,
  RecordingState,
} from '../src/index'

const ids = {
  recording: '2b2c9b7a-4b4d-4a1e-9d33-7c30f7f5a111',
  organization: 'org-eyex-seed',
  store: 'b8a3c5b1-95f2-4a26-8f79-3f4d24e1c222',
  session: '5b1d0f3a-8e64-4a2c-8b52-1f9a35c7d333',
  reservation: 'c0f6a5d4-2b3c-4d5e-9f60-71a2b3c4d444',
}

const metadata = {
  idempotencyKey: 'recording-upload-0001',
  receptionSessionId: ids.session,
  reservationId: null,
  recorderType: 'personal' as const,
  recorderId: 'user-9f1a',
  startedAt: '2026-08-30T01:00:00.000Z',
  endedAt: '2026-08-30T01:04:30.000Z',
  durationSeconds: 270,
  endReason: 'discarded' as const,
  contentType: 'audio/webm' as const,
}

const recording = {
  id: ids.recording,
  organizationId: ids.organization,
  storeId: ids.store,
  receptionSessionId: ids.session,
  reservationId: null,
  recorderType: 'personal' as const,
  recorderId: 'user-9f1a',
  startedAt: '2026-08-30T01:00:00.000Z',
  endedAt: '2026-08-30T01:04:30.000Z',
  durationSeconds: 270,
  endReason: 'discarded' as const,
  state: 'stored' as const,
  retentionUntil: '2026-08-31T01:04:30.000Z',
  holdReason: null,
  heldBy: null,
  heldAt: null,
  deletedAt: null,
  failureReason: null,
  version: 1,
}

describe('recording state contract', () => {
  it('names every state the reception recording can hold', () => {
    expect(RecordingState.options).toEqual([
      'permission_check',
      'recording',
      'stopped',
      'uploading',
      'stored',
      'failed',
      'held',
      'pending_deletion',
      'deleted',
    ])
  })

  it('names every way a recording can end', () => {
    expect(RecordingEndReason.options).toEqual([
      'completed',
      'discarded',
      'interrupted',
      'permission_denied',
    ])
  })
})

describe('RecordingMetadataCreate', () => {
  it('accepts a discarded reception with no reservation id', () => {
    const parsed = RecordingMetadataCreate.parse(metadata)
    expect(parsed.reservationId).toBeNull()
    expect(parsed.receptionSessionId).toBe(ids.session)
  })

  it('accepts a reservation id once the reception became a reservation', () => {
    const parsed = RecordingMetadataCreate.parse({
      ...metadata,
      reservationId: ids.reservation,
      endReason: 'completed',
    })
    expect(parsed.reservationId).toBe(ids.reservation)
  })

  it('rejects an end instant before the start instant', () => {
    const parsed = RecordingMetadataCreate.safeParse({
      ...metadata,
      endedAt: '2026-08-30T00:59:00.000Z',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown audio content type and unknown keys', () => {
    expect(
      RecordingMetadataCreate.safeParse({ ...metadata, contentType: 'application/zip' }).success,
    ).toBe(false)
    expect(RecordingMetadataCreate.safeParse({ ...metadata, storageKey: 'x' }).success).toBe(false)
  })

  it('rejects a negative duration', () => {
    expect(RecordingMetadataCreate.safeParse({ ...metadata, durationSeconds: -1 }).success).toBe(
      false,
    )
  })
})

describe('Recording', () => {
  it('parses the stored representation', () => {
    expect(Recording.parse(recording).state).toBe('stored')
  })

  it('never exposes the R2 storage key to a client', () => {
    expect(Object.keys(Recording.shape)).not.toContain('storageKey')
    expect(Recording.safeParse({ ...recording, storageKey: 'org/store/key' }).success).toBe(false)
  })

  it('carries the hold reason and holder once a recording is under legal hold', () => {
    const held = Recording.parse({
      ...recording,
      state: 'held',
      holdReason: '訴訟対応のため保全',
      heldBy: 'manager-1',
      heldAt: '2026-08-31T00:00:00.000Z',
      version: 2,
    })
    expect(held.holdReason).toBe('訴訟対応のため保全')
  })
})

describe('RecordingListQuery', () => {
  it('filters the operations view by state', () => {
    expect(RecordingListQuery.parse({ state: 'failed' }).state).toBe('failed')
    expect(RecordingListQuery.parse({})).toEqual({})
    expect(RecordingListQuery.safeParse({ state: 'unknown' }).success).toBe(false)
  })
})

describe('hold contracts', () => {
  it('requires a non-empty reason to place or release a hold', () => {
    expect(RecordingHoldInput.parse({ version: 1, reason: '監督官庁の照会' }).reason).toBe(
      '監督官庁の照会',
    )
    expect(RecordingHoldInput.safeParse({ version: 1, reason: '   ' }).success).toBe(false)
    expect(RecordingHoldInput.safeParse({ version: 1 }).success).toBe(false)
    expect(RecordingHoldRelease.safeParse({ version: 2, reason: '' }).success).toBe(false)
    expect(RecordingHoldRelease.parse({ version: 2, reason: '照会終了' }).version).toBe(2)
  })
})

describe('RecordingReservationLink', () => {
  it('links a stored recording to the reservation it produced', () => {
    expect(
      RecordingReservationLink.parse({ version: 1, reservationId: ids.reservation }).reservationId,
    ).toBe(ids.reservation)
    expect(RecordingReservationLink.safeParse({ version: 1, reservationId: null }).success).toBe(
      false,
    )
  })
})

describe('retention settings contracts', () => {
  it('refuses a configured retention below the guaranteed minimum', () => {
    const below = RecordingRetentionSettingsInput.safeParse({
      confirmedRetentionDays: 29,
      discardedRetentionHours: 24,
    })
    expect(below.success).toBe(false)
    expect(JSON.stringify(below.error?.issues)).toContain('30')

    const belowDiscarded = RecordingRetentionSettingsInput.safeParse({
      confirmedRetentionDays: 30,
      discardedRetentionHours: 23,
    })
    expect(belowDiscarded.success).toBe(false)
    expect(JSON.stringify(belowDiscarded.error?.issues)).toContain('24')
  })

  it('accepts a retention raised above the minimum', () => {
    expect(
      RecordingRetentionSettingsInput.parse({
        confirmedRetentionDays: 90,
        discardedRetentionHours: 72,
      }),
    ).toEqual({ confirmedRetentionDays: 90, discardedRetentionHours: 72 })
  })

  it('reports the effective retention with its update instant', () => {
    expect(
      RecordingRetentionSettings.parse({
        confirmedRetentionDays: 30,
        discardedRetentionHours: 24,
        updatedAt: '2026-08-31T00:00:00.000Z',
      }).confirmedRetentionDays,
    ).toBe(30)
  })
})

describe('reconciliation contracts', () => {
  it('scopes a reconciliation run to one synchronized organization', () => {
    expect(RecordingReconciliationRequest.parse({ organizationId: ids.organization })).toEqual({
      organizationId: ids.organization,
      limit: 100,
    })
    expect(RecordingReconciliationRequest.safeParse({ organizationId: '' }).success).toBe(false)
  })

  it('reports every mismatch so a silent R2 failure cannot look like success', () => {
    const report = RecordingReconciliationReport.parse({
      scanned: 3,
      deleted: 1,
      retained: 1,
      held: 1,
      mismatches: [
        { recordingId: ids.recording, kind: 'object_present_after_deletion' },
        { recordingId: ids.recording, kind: 'object_missing' },
        { recordingId: ids.recording, kind: 'delete_failed' },
      ],
    })
    expect(report.mismatches).toHaveLength(3)
    expect(
      RecordingReconciliationReport.safeParse({
        scanned: 1,
        deleted: 0,
        retained: 0,
        held: 0,
        mismatches: [{ recordingId: ids.recording, kind: 'unknown' }],
      }).success,
    ).toBe(false)
  })
})
