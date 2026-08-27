import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  auth,
  BASE,
  type RecordingView,
  setupRecordingStore,
  storedRecording,
  syncMembership,
  uuid,
} from './recording.fixtures'

async function issueTerminal(fixture: { storeId: string; managerToken: string }) {
  const created = await SELF.fetch(
    `${BASE}/api/staff/stores/${fixture.storeId}/shared-terminals`,
    auth(fixture.managerToken, { method: 'POST', body: JSON.stringify({ name: '受付iPad' }) }),
  )
  expect(created.status).toBe(201)
  return (await created.json()) as { terminal: { id: string }; token: string }
}

async function reauthenticate(terminalId: string, terminalToken: string, userId: string) {
  const response = await SELF.fetch(`${BASE}/api/shared-terminals/${terminalId}/reauthenticate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shared-terminal-token': terminalToken },
    body: JSON.stringify({ userId, stretchedPin: 'pin-proof-from-browser' }),
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { token: string }).token
}

function holdRequest(input: {
  terminalId: string
  storeId: string
  recordingId: string
  terminalToken: string
  reauthToken?: string
  body: unknown
  path?: 'hold' | 'hold/release'
}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-shared-terminal-token': input.terminalToken,
  }
  if (input.reauthToken) headers['x-shared-terminal-reauth-token'] = input.reauthToken
  return SELF.fetch(
    `${BASE}/api/shared-terminals/${input.terminalId}/stores/${input.storeId}/recordings/${input.recordingId}/${input.path ?? 'hold'}`,
    { method: 'POST', headers, body: JSON.stringify(input.body) },
  )
}

describe('legal hold from a shared terminal', () => {
  it('requires a personal reauthentication grant before a hold takes effect', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    const terminal = await issueTerminal(fixture)

    const withoutGrant = await holdRequest({
      terminalId: terminal.terminal.id,
      storeId: fixture.storeId,
      recordingId: recording.id,
      terminalToken: terminal.token,
      body: { version: recording.version, reason: '保全' },
    })
    expect(withoutGrant.status).toBe(401)
    await expect(withoutGrant.json()).resolves.toEqual({ error: 'reauth_unauthorized' })

    const row = await env.DB.prepare('SELECT state FROM recordings WHERE id = ?')
      .bind(recording.id)
      .first<{ state: string }>()
    expect(row?.state).toBe('stored')
  })

  it('places and releases a hold after personal reauthentication and audits the person', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    const terminal = await issueTerminal(fixture)
    const grant = await reauthenticate(terminal.terminal.id, terminal.token, fixture.managerId)

    const held = await holdRequest({
      terminalId: terminal.terminal.id,
      storeId: fixture.storeId,
      recordingId: recording.id,
      terminalToken: terminal.token,
      reauthToken: grant,
      body: { version: recording.version, reason: '共有端末からの保全' },
    })
    expect(held.status).toBe(200)
    const body = (await held.json()) as RecordingView
    expect(body).toMatchObject({ state: 'held', heldBy: fixture.managerId })

    const event = await env.DB.prepare(
      "SELECT actor_type, actor_id, metadata FROM audit_events WHERE entity_id = ? AND action = 'recording.held'",
    )
      .bind(recording.id)
      .first<{ actor_type: string; actor_id: string; metadata: string }>()
    expect(event?.actor_type).toBe('shared_terminal')
    expect(event?.actor_id).toBe(terminal.terminal.id)
    expect(JSON.parse(String(event?.metadata))).toMatchObject({
      reauthenticatedUserId: fixture.managerId,
    })

    // グラントは一度きり。解除はもう一度本人確認を通す。
    const releaseGrant = await reauthenticate(
      terminal.terminal.id,
      terminal.token,
      fixture.managerId,
    )
    const released = await holdRequest({
      terminalId: terminal.terminal.id,
      storeId: fixture.storeId,
      recordingId: recording.id,
      terminalToken: terminal.token,
      reauthToken: releaseGrant,
      path: 'hold/release',
      body: { version: body.version, reason: '解除' },
    })
    expect(released.status).toBe(200)
    expect(((await released.json()) as RecordingView).state).toBe('stored')
  })

  it('refuses a reauthenticated person who may not manage recordings', async () => {
    const fixture = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    const terminal = await issueTerminal(fixture)
    const deviceAdminId = uuid()
    await syncMembership({
      organizationId: fixture.organizationId,
      storeId: fixture.storeId,
      userId: deviceAdminId,
      // May unlock the device, may not touch recordings.
      permissions: ['terminal.manage'],
    })
    const grant = await reauthenticate(terminal.terminal.id, terminal.token, deviceAdminId)

    const response = await holdRequest({
      terminalId: terminal.terminal.id,
      storeId: fixture.storeId,
      recordingId: recording.id,
      terminalToken: terminal.token,
      reauthToken: grant,
      body: { version: recording.version, reason: '保全' },
    })
    expect(response.status).toBe(403)
  })

  it('refuses a grant issued for another store terminal', async () => {
    const fixture = await setupRecordingStore()
    const other = await setupRecordingStore()
    const recording = await storedRecording(fixture)
    const terminal = await issueTerminal(fixture)
    const otherTerminal = await issueTerminal(other)
    const foreignGrant = await reauthenticate(
      otherTerminal.terminal.id,
      otherTerminal.token,
      other.managerId,
    )

    const response = await holdRequest({
      terminalId: terminal.terminal.id,
      storeId: fixture.storeId,
      recordingId: recording.id,
      terminalToken: terminal.token,
      reauthToken: foreignGrant,
      body: { version: recording.version, reason: '保全' },
    })
    expect(response.status).toBe(403)
  })
})
