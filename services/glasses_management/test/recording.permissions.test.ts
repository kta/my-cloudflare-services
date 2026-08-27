import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  auth,
  BASE,
  createRecording,
  recordingMetadata,
  setupRecordingStore,
  storedRecording,
  syncMembership,
  syncOrganization,
  syncStore,
  tokenFor,
  uuid,
} from './recording.fixtures'

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'
type Actor = 'manager' | 'viewer' | 'outsider' | 'none' | 'expired' | 'other-org'

async function callRoute(
  path: string,
  method: Method,
  token: string | undefined,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('recording permission table', () => {
  const rows: ReadonlyArray<
    readonly [route: string, method: Method, actor: Actor, expected: number]
  > = [
    // list / read / play require recording.read (recording.manage implies it)
    ['list', 'GET', 'viewer', 200],
    ['list', 'GET', 'manager', 200],
    ['list', 'GET', 'outsider', 403],
    ['list', 'GET', 'none', 401],
    ['list', 'GET', 'expired', 401],
    ['list', 'GET', 'other-org', 403],
    ['read', 'GET', 'viewer', 200],
    ['read', 'GET', 'outsider', 403],
    ['read', 'GET', 'other-org', 403],
    ['play', 'GET', 'viewer', 200],
    ['play', 'GET', 'manager', 200],
    ['play', 'GET', 'outsider', 403],
    ['play', 'GET', 'none', 401],
    ['play', 'GET', 'other-org', 403],
    // create / upload / retry / hold / release / delete / retention require recording.manage
    ['create', 'POST', 'manager', 201],
    ['create', 'POST', 'viewer', 403],
    ['create', 'POST', 'other-org', 403],
    ['hold', 'POST', 'manager', 200],
    ['hold', 'POST', 'viewer', 403],
    ['hold', 'POST', 'outsider', 403],
    ['hold', 'POST', 'none', 401],
    ['hold', 'POST', 'other-org', 403],
    ['release', 'POST', 'viewer', 403],
    ['retry', 'POST', 'viewer', 403],
    ['link', 'POST', 'viewer', 403],
    ['delete', 'DELETE', 'viewer', 403],
    ['delete', 'DELETE', 'other-org', 403],
    ['retention-read', 'GET', 'manager', 200],
    ['retention-read', 'GET', 'viewer', 403],
    ['retention-write', 'PUT', 'manager', 200],
    ['retention-write', 'PUT', 'viewer', 403],
    ['retention-write', 'PUT', 'other-org', 403],
  ]

  it.each(rows)('%s (%s) as %s → %i', async (route, method, actor, expected) => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)

    let token: string | undefined
    if (actor === 'manager') token = fixture.managerToken
    if (actor === 'viewer') token = fixture.viewerToken
    if (actor === 'outsider') token = fixture.outsiderToken
    if (actor === 'expired') token = fixture.viewerToken.replace(/.$/, 'x')
    if (actor === 'other-org') {
      const foreignOrg = uuid()
      await syncOrganization(foreignOrg)
      token = await tokenFor(foreignOrg, 'admin')
    }

    const base = `/api/staff/stores/${fixture.storeId}/recordings`
    const paths: Record<string, string> = {
      list: base,
      read: `${base}/${recording.id}`,
      play: `${base}/${recording.id}/audio`,
      create: base,
      hold: `${base}/${recording.id}/hold`,
      release: `${base}/${recording.id}/hold/release`,
      retry: `${base}/${recording.id}/retry`,
      link: `${base}/${recording.id}/reservation`,
      delete: `${base}/${recording.id}`,
      'retention-read': `/api/staff/stores/${fixture.storeId}/recording-retention`,
      'retention-write': `/api/staff/stores/${fixture.storeId}/recording-retention`,
    }
    const bodies: Record<string, unknown> = {
      create: recordingMetadata(),
      hold: { version: recording.version, reason: '保全' },
      release: { version: recording.version, reason: '解除' },
      link: { version: recording.version, reservationId: uuid() },
      'retention-write': { confirmedRetentionDays: 30, discardedRetentionHours: 24 },
    }

    const response = await callRoute(paths[route] as string, method, token, bodies[route])
    expect(response.status).toBe(expected)
  })

  it('gives a store outside the caller permissions the same 403 as an unknown store', async () => {
    const fixture = await setupRecordingStore()
    const otherStore = await syncStore(fixture.organizationId)
    const unknownStore = uuid()

    const outside = await callRoute(
      `/api/staff/stores/${otherStore}/recordings`,
      'GET',
      fixture.viewerToken,
    )
    const unknown = await callRoute(
      `/api/staff/stores/${unknownStore}/recordings`,
      'GET',
      fixture.viewerToken,
    )
    expect(outside.status).toBe(403)
    expect(unknown.status).toBe(403)
    await expect(outside.json()).resolves.toEqual(await unknown.json())
  })

  it('lets a store member with only recording.read play but never manage', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    const playerId = uuid()
    await syncMembership({
      organizationId: fixture.organizationId,
      storeId: fixture.storeId,
      userId: playerId,
      permissions: ['recording.read'],
    })
    const playerToken = await tokenFor(fixture.organizationId, 'staff', playerId)

    const played = await callRoute(
      `/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/audio`,
      'GET',
      playerToken,
    )
    expect(played.status).toBe(200)

    const held = await callRoute(
      `/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/hold`,
      'POST',
      playerToken,
      { version: recording.version, reason: '保全' },
    )
    expect(held.status).toBe(403)
  })

  it('refuses to upload audio for a recording created in another store', async () => {
    const fixture = await setupRecordingStore()
    const recording = await createRecording(fixture)
    const otherStore = await syncStore(fixture.organizationId)
    await syncMembership({
      organizationId: fixture.organizationId,
      storeId: otherStore,
      userId: fixture.managerId,
      permissions: ['recording.manage'],
    })

    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${otherStore}/recordings/${recording.id}/audio`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${fixture.managerToken}`,
          'content-type': 'audio/webm',
        },
        body: 'bytes',
      },
    )
    expect(response.status).toBe(404)
  })

  it('lets a tenant admin manage recordings in every store of the organization', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    const adminToken = await tokenFor(fixture.organizationId, 'admin')

    const response = await callRoute(
      `/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/hold`,
      'POST',
      adminToken,
      { version: recording.version, reason: '本部保全' },
    )
    expect(response.status).toBe(200)
  })

  it('never exposes a download affordance on the playback route', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${fixture.storeId}/recordings/${recording.id}/audio`,
      auth(fixture.viewerToken),
    )
    expect(response.headers.get('content-disposition')).not.toContain('attachment')
    expect([...response.headers.keys()]).not.toContain('x-signed-download-url')
  })
})
