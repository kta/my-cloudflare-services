import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  auth,
  BASE,
  createRecording,
  INTERNAL_HEADERS,
  type RecordingView,
  recordingMetadata,
  setupRecordingStore,
  storedRecording,
  uploadAudio,
  uuid,
} from './recording.fixtures'

async function auditActions(entityId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT action FROM audit_events WHERE entity_id = ? ORDER BY occurred_at, action',
  )
    .bind(entityId)
    .all<{ action: string }>()
  return results.map((row) => row.action)
}

async function storageKeyOf(recordingId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT storage_key FROM recordings WHERE id = ?')
    .bind(recordingId)
    .first<{ storage_key: string }>()
  expect(row).not.toBeNull()
  return String(row?.storage_key)
}

describe('recording metadata and upload', () => {
  it('stores a discarded reception recording against its session with no reservation id', async () => {
    const fixture = await setupRecordingStore()
    const sessionId = uuid()
    const created = await createRecording(fixture, {
      receptionSessionId: sessionId,
      endReason: 'discarded',
    })

    expect(created).toMatchObject({
      organizationId: fixture.organizationId,
      storeId: fixture.storeId,
      receptionSessionId: sessionId,
      reservationId: null,
      endReason: 'discarded',
      state: 'uploading',
      version: 1,
    })
    expect(created).not.toHaveProperty('storageKey')

    const stored = (await (await uploadAudio(fixture, created.id)).json()) as RecordingView
    expect(stored.state).toBe('stored')
    // 24h from the end of a discarded reception.
    expect(stored.retentionUntil).toBe('2026-08-31T01:04:30.000Z')
  })

  it('keeps the R2 object under a tenant-scoped, unguessable key', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    const key = await storageKeyOf(recording.id)

    expect(key.startsWith(`${fixture.organizationId}/${fixture.storeId}/${recording.id}/`)).toBe(
      true,
    )
    expect(key.split('/')[3]).toMatch(/^[0-9a-f]{32}$/)
    const object = await env.RECORDINGS.get(key)
    expect(await object?.text()).toBe('eyex-audio-bytes')
  })

  it('does not create a second recording when the same upload is resent with one idempotency key', async () => {
    const fixture = await setupRecordingStore()
    const body = recordingMetadata({ idempotencyKey: 'resent-upload-key' })

    const first = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings`,
      auth(fixture.managerToken, { method: 'POST', body: JSON.stringify(body) }),
    )
    const second = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings`,
      auth(fixture.managerToken, { method: 'POST', body: JSON.stringify(body) }),
    )
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(((await first.json()) as RecordingView).id).toBe(
      ((await second.json()) as RecordingView).id,
    )

    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM recordings WHERE organization_id = ?',
    )
      .bind(fixture.organizationId)
      .first<{ total: number }>()
    expect(count?.total).toBe(1)
  })

  it('replays the same stored result when the audio body is resent', async () => {
    const fixture = await setupRecordingStore()
    const recording = await createRecording(fixture)
    const first = await uploadAudio(fixture, recording.id)
    const second = await uploadAudio(fixture, recording.id)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const replayed = (await second.json()) as RecordingView
    expect(replayed.state).toBe('stored')
    expect(replayed.version).toBe(((await first.json()) as RecordingView).version)
  })

  it('marks an upload failed when the audio body is empty and lets the operator retry only that recording', async () => {
    const fixture = await setupRecordingStore()
    const recording = await createRecording(fixture)
    const failed = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/audio`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${fixture.managerToken}`,
          'content-type': 'audio/webm',
        },
        body: '',
      },
    )
    expect(failed.status).toBe(400)
    const row = await env.DB.prepare('SELECT state, failure_reason FROM recordings WHERE id = ?')
      .bind(recording.id)
      .first<{ state: string; failure_reason: string | null }>()
    expect(row?.state).toBe('failed')
    expect(row?.failure_reason).toBe('empty_audio_body')

    const retried = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/retry`,
      auth(fixture.managerToken, { method: 'POST' }),
    )
    expect(retried.status).toBe(200)
    expect(((await retried.json()) as RecordingView).state).toBe('uploading')
    const reuploaded = (await (await uploadAudio(fixture, recording.id)).json()) as RecordingView
    expect(reuploaded.state).toBe('stored')
  })

  it('refuses to retry a recording that is not in the failed state', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/retry`,
      auth(fixture.managerToken, { method: 'POST' }),
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_recording_state' })
  })

  it('links a stored recording to the reservation that the reception produced', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    const reservationId = uuid()

    const linked = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/reservation`,
      auth(fixture.managerToken, {
        method: 'POST',
        body: JSON.stringify({ version: recording.version, reservationId }),
      }),
    )
    expect(linked.status).toBe(200)
    const body = (await linked.json()) as RecordingView
    expect(body.reservationId).toBe(reservationId)
    // A confirmed reservation extends the guarantee to 30 days from the end.
    expect(body.retentionUntil).toBe('2026-09-29T01:04:30.000Z')
  })

  it('refuses a stale version when linking a reservation', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/reservation`,
      auth(fixture.managerToken, {
        method: 'POST',
        body: JSON.stringify({ version: recording.version + 5, reservationId: uuid() }),
      }),
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: 'version_conflict' })
  })
})

describe('recording playback', () => {
  it('streams the audio inline for playback and never offers a download', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/audio`,
      { headers: { authorization: `Bearer ${fixture.viewerToken}` } },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/webm')
    expect(response.headers.get('content-disposition')).toBe('inline')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.text()).toBe('eyex-audio-bytes')
  })

  it('serves a range request so the player can seek', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/audio`,
      { headers: { authorization: `Bearer ${fixture.viewerToken}`, range: 'bytes=0-3' } },
    )

    expect(response.status).toBe(206)
    expect(await response.text()).toBe('eyex')
  })

  it('records who played which recording, when, and for which reservation', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    const reservationId = uuid()
    await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/reservation`,
      auth(fixture.managerToken, {
        method: 'POST',
        body: JSON.stringify({ version: recording.version, reservationId }),
      }),
    )

    await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/audio`,
      { headers: { authorization: `Bearer ${fixture.viewerToken}` } },
    )

    const event = await env.DB.prepare(
      "SELECT actor_id, metadata, occurred_at FROM audit_events WHERE entity_id = ? AND action = 'recording.played'",
    )
      .bind(recording.id)
      .first<{ actor_id: string; metadata: string; occurred_at: string }>()
    expect(event?.actor_id).toBe(fixture.viewerId)
    expect(event?.occurred_at).toBe('2026-08-31T00:00:00.000Z')
    expect(JSON.parse(String(event?.metadata))).toMatchObject({ reservationId })
  })

  it('refuses playback of a deleted recording body', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture, {
      endedAt: '2026-08-01T00:00:00.000Z',
      startedAt: '2026-08-01T00:00:00.000Z',
      durationSeconds: 0,
    })
    const deleted = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}`,
      auth(fixture.managerToken, { method: 'DELETE' }),
    )
    expect(deleted.status).toBe(200)

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/audio`,
      { headers: { authorization: `Bearer ${fixture.viewerToken}` } },
    )
    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({ error: 'recording_deleted' })
  })
})

describe('legal hold', () => {
  it('places a hold with a mandatory reason and keeps the body through routine deletion', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture, {
      startedAt: '2026-08-01T00:00:00.000Z',
      endedAt: '2026-08-01T00:00:00.000Z',
      durationSeconds: 0,
    })

    const held = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/hold`,
      auth(fixture.managerToken, {
        method: 'POST',
        body: JSON.stringify({ version: recording.version, reason: '訴訟対応のため保全' }),
      }),
    )
    expect(held.status).toBe(200)
    const body = (await held.json()) as RecordingView
    expect(body).toMatchObject({
      state: 'held',
      holdReason: '訴訟対応のため保全',
      heldBy: fixture.managerId,
      heldAt: '2026-08-31T00:00:00.000Z',
    })

    const reconciled = await SELF.fetch(`${BASE}/api/internal/recordings/reconcile`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ organizationId: fixture.organizationId }),
    })
    expect(reconciled.status).toBe(200)
    await expect(reconciled.json()).resolves.toMatchObject({ held: 1, deleted: 0, mismatches: [] })
    expect(await env.RECORDINGS.head(await storageKeyOf(recording.id))).not.toBeNull()
  })

  it('refuses a hold without a reason and refuses manual deletion while the hold stands', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture, {
      startedAt: '2026-08-01T00:00:00.000Z',
      endedAt: '2026-08-01T00:00:00.000Z',
      durationSeconds: 0,
    })

    const noReason = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/hold`,
      auth(fixture.managerToken, {
        method: 'POST',
        body: JSON.stringify({ version: recording.version, reason: '  ' }),
      }),
    )
    expect(noReason.status).toBe(400)

    await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/hold`,
      auth(fixture.managerToken, {
        method: 'POST',
        body: JSON.stringify({ version: recording.version, reason: '保全' }),
      }),
    )
    const deletion = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}`,
      auth(fixture.managerToken, { method: 'DELETE' }),
    )
    expect(deletion.status).toBe(409)
    await expect(deletion.json()).resolves.toMatchObject({ error: 'recording_held' })
  })

  it('releases a hold with a reason and audits both the hold and the release', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    const held = (await (
      await SELF.fetch(
        `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/hold`,
        auth(fixture.managerToken, {
          method: 'POST',
          body: JSON.stringify({ version: recording.version, reason: '照会対応' }),
        }),
      )
    ).json()) as RecordingView

    const released = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/hold/release`,
      auth(fixture.managerToken, {
        method: 'POST',
        body: JSON.stringify({ version: held.version, reason: '照会終了' }),
      }),
    )
    expect(released.status).toBe(200)
    expect((await released.json()) as RecordingView).toMatchObject({
      state: 'stored',
      holdReason: null,
      heldBy: null,
      heldAt: null,
    })
    expect(await auditActions(recording.id)).toEqual(
      expect.arrayContaining(['recording.held', 'recording.hold_released']),
    )
  })

  it('does not take effect when the audit event cannot be appended', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    await env.DB.prepare('DROP TABLE audit_events').run()
    try {
      const response = await SELF.fetch(
        `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/hold`,
        auth(fixture.managerToken, {
          method: 'POST',
          body: JSON.stringify({ version: recording.version, reason: '保全' }),
        }),
      )
      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({ error: 'audit_append_failed' })
      const row = await env.DB.prepare('SELECT state FROM recordings WHERE id = ?')
        .bind(recording.id)
        .first<{ state: string }>()
      expect(row?.state).toBe('stored')
    } finally {
      await env.DB.prepare(
        `CREATE TABLE audit_events (
          id text PRIMARY KEY NOT NULL,
          organization_id text NOT NULL,
          store_id text,
          actor_type text NOT NULL,
          actor_id text NOT NULL,
          action text NOT NULL,
          entity_type text NOT NULL,
          entity_id text NOT NULL,
          request_id text,
          metadata text NOT NULL,
          occurred_at text NOT NULL
        )`,
      ).run()
    }
  })
})

describe('deletion and reconciliation', () => {
  it('deletes an unheld recording after the deadline and audits the outcome', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture, {
      startedAt: '2026-08-01T00:00:00.000Z',
      endedAt: '2026-08-01T00:00:00.000Z',
      durationSeconds: 0,
    })
    const key = await storageKeyOf(recording.id)

    const response = await SELF.fetch(`${BASE}/api/internal/recordings/reconcile`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ organizationId: fixture.organizationId }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      scanned: 1,
      deleted: 1,
      mismatches: [],
    })
    expect(await env.RECORDINGS.head(key)).toBeNull()
    const row = await env.DB.prepare('SELECT state, deleted_at FROM recordings WHERE id = ?')
      .bind(recording.id)
      .first<{ state: string; deleted_at: string | null }>()
    expect(row).toMatchObject({ state: 'deleted', deleted_at: '2026-08-31T00:00:00.000Z' })
    expect(await auditActions(recording.id)).toContain('recording.deleted')
  })

  it('reports a recording whose object vanished from R2 before its deadline', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    await env.RECORDINGS.delete(await storageKeyOf(recording.id))

    const response = await SELF.fetch(`${BASE}/api/internal/recordings/reconcile`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ organizationId: fixture.organizationId }),
    })

    await expect(response.json()).resolves.toMatchObject({
      retained: 1,
      deleted: 0,
      mismatches: [{ recordingId: recording.id, kind: 'object_missing' }],
    })
    expect(await auditActions(recording.id)).toContain('recording.reconciliation_mismatch')
  })

  it('reports an object that survived a recorded deletion', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture, {
      startedAt: '2026-08-01T00:00:00.000Z',
      endedAt: '2026-08-01T00:00:00.000Z',
      durationSeconds: 0,
    })
    const key = await storageKeyOf(recording.id)
    await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}`,
      auth(fixture.managerToken, { method: 'DELETE' }),
    )
    // Simulate a silent R2 failure that left the body behind.
    await env.RECORDINGS.put(key, 'resurrected-body')

    const response = await SELF.fetch(`${BASE}/api/internal/recordings/reconcile`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ organizationId: fixture.organizationId }),
    })

    await expect(response.json()).resolves.toMatchObject({
      mismatches: [{ recordingId: recording.id, kind: 'object_present_after_deletion' }],
    })
  })

  it('requires the internal key for reconciliation and rejects an unknown organization', async () => {
    const fixture = await setupRecordingStore()
    const unauthenticated = await SELF.fetch(`${BASE}/api/internal/recordings/reconcile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: fixture.organizationId }),
    })
    expect(unauthenticated.status).toBe(401)

    const unknown = await SELF.fetch(`${BASE}/api/internal/recordings/reconcile`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ organizationId: uuid() }),
    })
    expect(unknown.status).toBe(404)
  })
})

describe('recording operations view', () => {
  it('separates stored, failed, held and deleted recordings for one store', async () => {
    const fixture = await setupRecordingStore()
    const stored = await storedRecording(fixture)
    const failed = await createRecording(fixture)
    await SELF.fetch(`${BASE}/api/staff/stores/${fixture.storeId}/recordings/${failed.id}/audio`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${fixture.managerToken}`, 'content-type': 'audio/webm' },
      body: '',
    })
    const held = await storedRecording(fixture)
    await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${held.id}/hold`,
      auth(fixture.managerToken, {
        method: 'POST',
        body: JSON.stringify({ version: held.version, reason: '保全' }),
      }),
    )

    const all = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings`,
      auth(fixture.viewerToken),
    )
    expect(all.status).toBe(200)
    expect(((await all.json()) as RecordingView[]).map((row) => row.id).sort()).toEqual(
      [stored.id, failed.id, held.id].sort(),
    )

    const onlyFailed = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings?state=failed`,
      auth(fixture.viewerToken),
    )
    const failedRows = (await onlyFailed.json()) as RecordingView[]
    expect(failedRows).toHaveLength(1)
    expect(failedRows[0]?.id).toBe(failed.id)

    const onlyHeld = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings?state=held`,
      auth(fixture.viewerToken),
    )
    expect((await onlyHeld.json()) as RecordingView[]).toHaveLength(1)
  })

  it('rejects an unknown state filter', async () => {
    const fixture = await setupRecordingStore()
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings?state=lost`,
      auth(fixture.viewerToken),
    )
    expect(response.status).toBe(400)
  })

  it('reads one recording and reports an unknown id as not found', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    const found = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}`,
      auth(fixture.viewerToken),
    )
    expect(found.status).toBe(200)
    expect(((await found.json()) as RecordingView).id).toBe(recording.id)

    const missing = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${uuid()}`,
      auth(fixture.viewerToken),
    )
    expect(missing.status).toBe(404)
  })
})

describe('retention settings', () => {
  it('returns the guaranteed minimum before an operator configures anything', async () => {
    const fixture = await setupRecordingStore()
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recording-retention`,
      auth(fixture.managerToken),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      confirmedRetentionDays: 30,
      discardedRetentionHours: 24,
    })
  })

  it('raises the retention above the minimum and applies it to a newly stored recording', async () => {
    const fixture = await setupRecordingStore()
    const saved = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recording-retention`,
      auth(fixture.managerToken, {
        method: 'PUT',
        body: JSON.stringify({ confirmedRetentionDays: 90, discardedRetentionHours: 72 }),
      }),
    )
    expect(saved.status).toBe(200)

    const recording = await storedRecording(fixture)
    expect(recording.retentionUntil).toBe('2026-09-02T01:04:30.000Z')
  })

  it('refuses a retention below the guaranteed minimum and states the minimum', async () => {
    const fixture = await setupRecordingStore()
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recording-retention`,
      auth(fixture.managerToken, {
        method: 'PUT',
        body: JSON.stringify({ confirmedRetentionDays: 29, discardedRetentionHours: 24 }),
      }),
    )
    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('30')
  })
})

describe('recording attribution comes from the session, not the request', () => {
  it('records the authenticated staff member as the recorder, whoever the body names', async () => {
    // 録音者は AC-EYEX-80 の監査主体そのものである。本文の申告を信じると、
    // 誰でも他人の名前で録音を残せるうえ、個人モードの既定値がそのまま
    // 保存されてしまう(UC-EYEX-036, AC-EYEX-15)。
    const fixture = await setupRecordingStore()

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings`,
      auth(fixture.managerToken, {
        method: 'POST',
        body: JSON.stringify(
          recordingMetadata({ recorderType: 'personal', recorderId: 'unknown' }),
        ),
      }),
    )

    expect(response.status).toBe(201)
    const created = (await response.json()) as { recorderType: string; recorderId: string }
    expect(created.recorderType).toBe('personal')
    expect(created.recorderId).toBe(fixture.managerId)
  })

  it('refuses a personal recording that claims to be a shared terminal', async () => {
    const fixture = await setupRecordingStore()

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings`,
      auth(fixture.managerToken, {
        method: 'POST',
        body: JSON.stringify(
          recordingMetadata({ recorderType: 'shared_terminal', recorderId: 'terminal-1' }),
        ),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_recorder' })
  })
})
