import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  auth,
  BASE,
  INTERNAL_HEADERS,
  type RecordingView,
  recordingMetadata,
  setupRecordingStore,
  storedRecording,
  uuid,
} from './recording.fixtures'

describe('recording tenant isolation', () => {
  it('never shows, plays, holds or deletes another organization recording', async () => {
    const left = await setupRecordingStore()
    const right = await setupRecordingStore()
    const leftRecording = await storedRecording(left)
    const rightRecording = await storedRecording(right)

    const leftList = (await (
      await SELF.fetch(
        `${BASE}/api/staff/stores/${left.storeId}/recordings`,
        auth(left.viewerToken),
      )
    ).json()) as RecordingView[]
    expect(leftList.map((row) => row.id)).toEqual([leftRecording.id])

    // The right organization's store id is a valid uuid, but it is outside the
    // left JWT organization: the store gate answers 403 without revealing it.
    const crossStore = await SELF.fetch(
      `${BASE}/api/staff/stores/${right.storeId}/recordings/${rightRecording.id}`,
      auth(left.viewerToken),
    )
    expect(crossStore.status).toBe(403)

    // A foreign recording id supplied against the caller's own store must not
    // resolve either: the row is scoped by organization and store.
    for (const [path, init] of [
      [`/recordings/${rightRecording.id}`, auth(left.viewerToken)],
      [`/recordings/${rightRecording.id}/audio`, auth(left.viewerToken)],
      [
        `/recordings/${rightRecording.id}/hold`,
        auth(left.managerToken, {
          method: 'POST',
          body: JSON.stringify({ version: 1, reason: '越境保全' }),
        }),
      ],
      [`/recordings/${rightRecording.id}`, auth(left.managerToken, { method: 'DELETE' })],
    ] as const) {
      const response = await SELF.fetch(
        `${BASE}/api/staff/stores/${left.storeId}${path}`,
        init as RequestInit,
      )
      expect(response.status).toBe(404)
    }

    const untouched = await env.DB.prepare('SELECT state, hold_reason FROM recordings WHERE id = ?')
      .bind(rightRecording.id)
      .first<{ state: string; hold_reason: string | null }>()
    expect(untouched).toMatchObject({ state: 'stored', hold_reason: null })
  })

  it('ignores an organization id supplied in a recording creation body', async () => {
    const left = await setupRecordingStore()
    const right = await setupRecordingStore()

    const spoofed = await SELF.fetch(
      `${BASE}/api/staff/stores/${left.storeId}/recordings`,
      auth(left.managerToken, {
        method: 'POST',
        body: JSON.stringify({
          ...recordingMetadata(),
          organizationId: right.organizationId,
          storeId: right.storeId,
        }),
      }),
    )
    // Unknown keys are rejected by the strict contract, never silently trusted.
    expect(spoofed.status).toBe(400)
  })

  it('reconciles only the requested organization', async () => {
    const left = await setupRecordingStore()
    const right = await setupRecordingStore()
    const expired = { startedAt: '2026-08-01T00:00:00.000Z', endedAt: '2026-08-01T00:00:00.000Z' }
    const leftRecording = await storedRecording(left, { ...expired, durationSeconds: 0 })
    const rightRecording = await storedRecording(right, { ...expired, durationSeconds: 0 })

    const response = await SELF.fetch(`${BASE}/api/internal/recordings/reconcile`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ organizationId: left.organizationId }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ scanned: 1, deleted: 1 })

    const leftRow = await env.DB.prepare('SELECT state FROM recordings WHERE id = ?')
      .bind(leftRecording.id)
      .first<{ state: string }>()
    const rightRow = await env.DB.prepare('SELECT state FROM recordings WHERE id = ?')
      .bind(rightRecording.id)
      .first<{ state: string }>()
    expect(leftRow?.state).toBe('deleted')
    expect(rightRow?.state).toBe('stored')
  })

  it('scopes the idempotency key to the organization and the store', async () => {
    const left = await setupRecordingStore()
    const right = await setupRecordingStore()
    const body = recordingMetadata({ idempotencyKey: `shared-${uuid()}` })

    const first = await SELF.fetch(
      `${BASE}/api/staff/stores/${left.storeId}/recordings`,
      auth(left.managerToken, { method: 'POST', body: JSON.stringify(body) }),
    )
    const second = await SELF.fetch(
      `${BASE}/api/staff/stores/${right.storeId}/recordings`,
      auth(right.managerToken, { method: 'POST', body: JSON.stringify(body) }),
    )
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const firstBody = (await first.json()) as RecordingView
    const secondBody = (await second.json()) as RecordingView
    expect(firstBody.id).not.toBe(secondBody.id)
    expect(secondBody.organizationId).toBe(right.organizationId)
  })
})
