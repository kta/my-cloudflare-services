import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  auth,
  BASE,
  INTERNAL_HEADERS,
  type RecordingStoreFixture,
  type RecordingView,
  setupRecordingStore,
  storedRecording,
  uuid,
} from './recording.fixtures'

// The pool pins the request clock to this instant for every handler.
const NOW = '2026-08-31T00:00:00.000Z'

async function deleteManually(
  fixture: RecordingStoreFixture,
  recordingId: string,
): Promise<Response> {
  return SELF.fetch(
    `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recordingId}`,
    auth(fixture.managerToken, { method: 'DELETE' }),
  )
}

async function reconcile(fixture: RecordingStoreFixture) {
  const response = await SELF.fetch(`${BASE}/api/internal/recordings/reconcile`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify({ organizationId: fixture.organizationId }),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as { scanned: number; deleted: number; retained: number }
}

async function stateOf(recordingId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT state FROM recordings WHERE id = ?')
    .bind(recordingId)
    .first<{ state: string }>()
  return String(row?.state)
}

describe('discarded reception retention boundary (24h)', () => {
  it.each([
    ['one second before the deadline', '2026-08-30T00:00:01.000Z', '2026-08-31T00:00:01.000Z'],
    ['exactly at the deadline', '2026-08-30T00:00:00.000Z', NOW],
    ['one second after the deadline', '2026-08-29T23:59:59.000Z', '2026-08-30T23:59:59.000Z'],
  ])('%s', async (label, endedAt, retentionUntil) => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture, {
      startedAt: endedAt,
      endedAt,
      durationSeconds: 0,
      endReason: 'discarded',
    })
    expect(recording.retentionUntil).toBe(retentionUntil)

    const manual = await deleteManually(fixture, recording.id)
    if (label === 'one second before the deadline') {
      expect(manual.status).toBe(409)
      await expect(manual.json()).resolves.toEqual({
        error: 'retention_active',
        retentionUntil,
        minimumRetentionUntil: retentionUntil,
      })
      const report = await reconcile(fixture)
      expect(report).toMatchObject({ deleted: 0, retained: 1 })
      expect(await stateOf(recording.id)).toBe('stored')
      return
    }
    expect(manual.status).toBe(200)
    expect(((await manual.json()) as RecordingView).state).toBe('deleted')
  })
})

describe('confirmed reservation retention boundary (30 days)', () => {
  it('refuses routine and manual deletion one second before the thirty-day deadline', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture, {
      startedAt: '2026-08-01T00:00:01.000Z',
      endedAt: '2026-08-01T00:00:01.000Z',
      durationSeconds: 0,
      endReason: 'completed',
      reservationId: uuid(),
    })
    expect(recording.retentionUntil).toBe('2026-08-31T00:00:01.000Z')

    const manual = await deleteManually(fixture, recording.id)
    expect(manual.status).toBe(409)
    await expect(manual.json()).resolves.toMatchObject({
      error: 'retention_active',
      minimumRetentionUntil: '2026-08-31T00:00:01.000Z',
    })

    expect(await reconcile(fixture)).toMatchObject({ deleted: 0, retained: 1 })
    expect(await stateOf(recording.id)).toBe('stored')
  })

  it('deletes exactly at the thirty-day deadline', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture, {
      startedAt: '2026-08-01T00:00:00.000Z',
      endedAt: '2026-08-01T00:00:00.000Z',
      durationSeconds: 0,
      endReason: 'completed',
      reservationId: uuid(),
    })
    expect(recording.retentionUntil).toBe(NOW)

    expect(await reconcile(fixture)).toMatchObject({ deleted: 1, retained: 0 })
    expect(await stateOf(recording.id)).toBe('deleted')
  })

  it('deletes one second after the thirty-day deadline', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture, {
      startedAt: '2026-07-31T23:59:59.000Z',
      endedAt: '2026-07-31T23:59:59.000Z',
      durationSeconds: 0,
      endReason: 'completed',
      reservationId: uuid(),
    })
    expect(recording.retentionUntil).toBe('2026-08-30T23:59:59.000Z')

    const manual = await deleteManually(fixture, recording.id)
    expect(manual.status).toBe(200)
    expect(await stateOf(recording.id)).toBe('deleted')
  })

  it('a raised retention pushes the deadline past the minimum and blocks deletion at the minimum', async () => {
    const fixture = await setupRecordingStore()
    const saved = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recording-retention`,
      auth(fixture.managerToken, {
        method: 'PUT',
        body: JSON.stringify({ confirmedRetentionDays: 31, discardedRetentionHours: 24 }),
      }),
    )
    expect(saved.status).toBe(200)

    const recording = await storedRecording(fixture, {
      startedAt: '2026-08-01T00:00:00.000Z',
      endedAt: '2026-08-01T00:00:00.000Z',
      durationSeconds: 0,
      endReason: 'completed',
      reservationId: uuid(),
    })
    expect(recording.retentionUntil).toBe('2026-09-01T00:00:00.000Z')

    const manual = await deleteManually(fixture, recording.id)
    expect(manual.status).toBe(409)
    await expect(manual.json()).resolves.toMatchObject({
      // The minimum guarantee is 30 days; the configured retention is longer
      // and is the binding deadline.
      minimumRetentionUntil: '2026-08-31T00:00:00.000Z',
      retentionUntil: '2026-09-01T00:00:00.000Z',
    })
  })

  it('refuses deletion while the audio has not been stored yet', async () => {
    const fixture = await setupRecordingStore()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings`,
      auth(fixture.managerToken, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `rec-${uuid()}`,
          receptionSessionId: uuid(),
          reservationId: null,
          recorderType: 'personal',
          recorderId: uuid(),
          startedAt: '2026-08-01T00:00:00.000Z',
          endedAt: '2026-08-01T00:00:00.000Z',
          durationSeconds: 0,
          endReason: 'discarded',
          contentType: 'audio/webm',
        }),
      }),
    )
    const recording = (await created.json()) as RecordingView
    const manual = await deleteManually(fixture, recording.id)
    expect(manual.status).toBe(409)
    await expect(manual.json()).resolves.toMatchObject({ error: 'invalid_recording_state' })
  })
})
