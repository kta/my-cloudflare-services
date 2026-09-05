import { env, SELF } from 'cloudflare:test'
import { hashStretched, stretchPin } from '@app/shared'
import { describe, expect, it } from 'vitest'
import {
  authed,
  BASE,
  FIXED_NOW,
  INTERNAL_HEADERS,
  insertStaff,
  insertStore,
  orgId,
  tokenFor,
} from './helpers'

const PEPPER = 'dev-auth-pepper-change-me'

async function credentialHash(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
  )
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function terminalTenant() {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await insertStore(org)
  const terminalId = crypto.randomUUID()
  const pinHash = await hashStretched(await stretchPin('2580', org, terminalId, 1), PEPPER)
  await env.DB.prepare(
    "INSERT INTO terminals (id, organization_id, store_id, name, kind, place_note, device_label, pin_hash, auto_lock_seconds, last_seen_at, is_active, version, created_at) VALUES (?,?,?,?,?,?,?,?,?,?, '1',1,?)",
  )
    .bind(
      terminalId,
      org,
      storeId,
      '銀座店 レジ横iPad',
      'shared',
      'レジの右側',
      'EYE-iPad-07',
      pinHash,
      120,
      FIXED_NOW,
      FIXED_NOW,
    )
    .run()
  return { org, token, storeId, terminalId }
}

async function call(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { ...authed(token), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as Record<string, unknown> | null,
  }
}

async function startShared(tenant: Awaited<ReturnType<typeof terminalTenant>>) {
  const started = await call(
    tenant.token,
    'POST',
    `/api/staff/terminals/${tenant.terminalId}/sessions`,
    { mode: 'shared', pin: '2580' },
  )
  expect(started.status).toBe(200)
  return started.body as {
    id: string
    terminalId: string
    mode: 'shared'
    sessionToken: string
    expiresAt: string
  }
}

const sessionHeaders = (terminalId: string, sessionToken: string) => ({
  'x-terminal-id': terminalId,
  'x-terminal-session': sessionToken,
})

describe('端末と業務セッション', () => {
  it('端末一覧はPINハッシュを返さず、オンライン状態を時刻から導く', async () => {
    const tenant = await terminalTenant()
    const result = await call(tenant.token, 'GET', `/api/staff/terminals?storeId=${tenant.storeId}`)
    expect(result.status).toBe(200)
    expect(result.body).toEqual([
      expect.objectContaining({
        id: tenant.terminalId,
        hasPin: true,
        isOnline: true,
        lastSeenAt: FIXED_NOW,
      }),
    ])
    expect(JSON.stringify(result.body)).not.toContain('pinHash')
    expect(JSON.stringify(result.body)).not.toContain('hmac$')
  })

  it('正しい共有PINでセッションを開き、監査を同じ操作として残す', async () => {
    const tenant = await terminalTenant()
    const result = await call(
      tenant.token,
      'POST',
      `/api/staff/terminals/${tenant.terminalId}/sessions`,
      { mode: 'shared', pin: '2580' },
    )
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      terminalId: tenant.terminalId,
      staffId: null,
      mode: 'shared',
    })
    expect(result.body?.sessionToken).toMatch(/^[A-Za-z0-9_-]{64}$/)
    const stored = await env.DB.prepare(
      'SELECT credential_hash AS credentialHash FROM terminal_sessions WHERE organization_id = ? AND id = ?',
    )
      .bind(tenant.org, result.body?.id)
      .first<{ credentialHash: string }>()
    expect(stored?.credentialHash).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(stored?.credentialHash).not.toBe(result.body?.sessionToken)
    const audit = await env.DB.prepare(
      "SELECT actor_type AS actorType, actor_id AS actorId, terminal_id AS terminalId FROM audit_events WHERE organization_id = ? AND action = 'terminal.session.started'",
    )
      .bind(tenant.org)
      .first<{ actorType: string; actorId: string; terminalId: string }>()
    expect(audit).toEqual({
      actorType: 'terminal',
      actorId: tenant.terminalId,
      terminalId: tenant.terminalId,
    })
    const auditJson = await env.DB.prepare(
      "SELECT after_json AS afterJson FROM audit_events WHERE organization_id = ? AND action = 'terminal.session.started'",
    )
      .bind(tenant.org)
      .first<{ afterJson: string }>()
    expect(auditJson?.afterJson).not.toContain(String(result.body?.sessionToken))
    expect(auditJson?.afterJson).not.toContain(String(stored?.credentialHash))
  })

  it('session終了は正しい資格情報の組だけを受け付ける', async () => {
    const tenant = await terminalTenant()
    const session = await startShared(tenant)
    const path = `/api/staff/terminals/${tenant.terminalId}/sessions/${session.id}`

    const invalidHeaders: Record<string, string>[] = [
      {},
      { 'x-terminal-id': tenant.terminalId },
      { 'x-terminal-session': session.sessionToken },
      sessionHeaders(tenant.terminalId, 'x'.repeat(64)),
      sessionHeaders(tenant.terminalId, `+${'a'.repeat(63)}`),
      sessionHeaders(crypto.randomUUID(), session.sessionToken),
    ]
    for (const headers of invalidHeaders) {
      const denied = await call(tenant.token, 'DELETE', path, undefined, headers)
      expect(denied.status).toBe(403)
      expect(denied.body).toEqual({ error: 'terminal_session_invalid' })
    }

    const ended = await call(
      tenant.token,
      'DELETE',
      path,
      undefined,
      sessionHeaders(tenant.terminalId, session.sessionToken),
    )
    expect(ended.status).toBe(200)
    const replay = await call(
      tenant.token,
      'DELETE',
      path,
      undefined,
      sessionHeaders(tenant.terminalId, session.sessionToken),
    )
    expect(replay.status).toBe(403)
  })

  it('別セッション・別テナントのtokenは認証されずstaff fallbackもしない', async () => {
    const owner = await terminalTenant()
    const other = await terminalTenant()
    const ownerSession = await startShared(owner)
    const otherSession = await startShared(other)
    const path = `/api/staff/terminals/${owner.terminalId}/sessions/${ownerSession.id}`

    expect(
      (
        await call(
          owner.token,
          'DELETE',
          path,
          undefined,
          sessionHeaders(owner.terminalId, otherSession.sessionToken),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await call(
          other.token,
          'DELETE',
          path,
          undefined,
          sessionHeaders(owner.terminalId, ownerSession.sessionToken),
        )
      ).status,
    ).toBe(403)
  })

  it('personal sessionの明示終了はstaff actorとterminalを終了監査へ残す', async () => {
    const tenant = await terminalTenant()
    const staffId = await insertStaff(tenant.org, tenant.storeId, { displayName: '佐藤 美咲' })
    const sessionId = crypto.randomUUID()
    const sessionToken = 'd'.repeat(64)
    await env.DB.prepare(
      "INSERT INTO terminal_sessions (id, organization_id, store_id, terminal_id, staff_id, mode, credential_hash, started_at, expires_at, revoked_at, created_at) VALUES (?,?,?,?,?,'personal',?,?,'2026-08-27T02:10:00.000Z',NULL,?)",
    )
      .bind(
        sessionId,
        tenant.org,
        tenant.storeId,
        tenant.terminalId,
        staffId,
        await credentialHash(sessionToken),
        FIXED_NOW,
        FIXED_NOW,
      )
      .run()

    const ended = await call(
      tenant.token,
      'DELETE',
      `/api/staff/terminals/${tenant.terminalId}/sessions/${sessionId}`,
      undefined,
      sessionHeaders(tenant.terminalId, sessionToken),
    )
    expect(ended.status).toBe(200)
    const audit = await env.DB.prepare(
      "SELECT actor_type AS actorType, actor_id AS actorId, terminal_id AS terminalId FROM audit_events WHERE organization_id = ? AND action = 'terminal.session.ended'",
    )
      .bind(tenant.org)
      .first<{ actorType: string; actorId: string; terminalId: string }>()
    expect(audit).toEqual({ actorType: 'staff', actorId: staffId, terminalId: tenant.terminalId })
  })

  it('personal startによるtakeoverは開始staffを終了監査のactorにする', async () => {
    const tenant = await terminalTenant()
    const staffId = await insertStaff(tenant.org, tenant.storeId, { displayName: '佐藤 美咲' })
    const staffPinHash = await hashStretched(
      await stretchPin('2580', tenant.org, staffId, 1),
      PEPPER,
    )
    await env.DB.prepare('UPDATE staff SET pin_hash = ? WHERE organization_id = ? AND id = ?')
      .bind(staffPinHash, tenant.org, staffId)
      .run()
    await startShared(tenant)

    const personal = await call(
      tenant.token,
      'POST',
      `/api/staff/terminals/${tenant.terminalId}/sessions`,
      { mode: 'personal', staffId, pin: '2580' },
    )
    expect(personal.status).toBe(200)
    const audit = await env.DB.prepare(
      "SELECT actor_type AS actorType, actor_id AS actorId, terminal_id AS terminalId FROM audit_events WHERE organization_id = ? AND action = 'terminal.session.ended' ORDER BY rowid DESC LIMIT 1",
    )
      .bind(tenant.org)
      .first<{ actorType: string; actorId: string; terminalId: string }>()
    expect(audit).toEqual({ actorType: 'staff', actorId: staffId, terminalId: tenant.terminalId })
  })

  it('同一端末の並行start後はunrevokedが1行でstart/end監査が釣り合う', async () => {
    const tenant = await terminalTenant()
    const path = `/api/staff/terminals/${tenant.terminalId}/sessions`
    const [first, second] = await Promise.all([
      call(tenant.token, 'POST', path, { mode: 'shared', pin: '2580' }),
      call(tenant.token, 'POST', path, { mode: 'shared', pin: '2580' }),
    ])
    expect([first.status, second.status]).toEqual([200, 200])
    const live = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM terminal_sessions WHERE organization_id = ? AND terminal_id = ? AND revoked_at IS NULL',
    )
      .bind(tenant.org, tenant.terminalId)
      .first<{ n: number }>()
    expect(live?.n).toBe(1)
    const audits = await env.DB.prepare(
      "SELECT action, COUNT(*) AS n FROM audit_events WHERE organization_id = ? AND terminal_id = ? AND action IN ('terminal.session.started','terminal.session.ended') GROUP BY action",
    )
      .bind(tenant.org, tenant.terminalId)
      .all<{ action: string; n: number }>()
    const counts = Object.fromEntries(audits.results.map((row) => [row.action, row.n]))
    expect(counts['terminal.session.started']).toBe(2)
    expect(counts['terminal.session.ended']).toBe(1)
  })

  it('elevateは共有tokenを回転し、端末設定30秒を期限に使い、stale tokenでは行も監査も作らない', async () => {
    const tenant = await terminalTenant()
    const staffId = await insertStaff(tenant.org, tenant.storeId, { displayName: '佐藤 美咲' })
    const staffPinHash = await hashStretched(
      await stretchPin('2580', tenant.org, staffId, 1),
      PEPPER,
    )
    await env.DB.prepare('UPDATE staff SET pin_hash = ? WHERE organization_id = ? AND id = ?')
      .bind(staffPinHash, tenant.org, staffId)
      .run()
    await env.DB.prepare(
      'UPDATE terminals SET auto_lock_seconds = 30 WHERE organization_id = ? AND id = ?',
    )
      .bind(tenant.org, tenant.terminalId)
      .run()
    const shared = await startShared(tenant)
    const elevated = await call(
      tenant.token,
      'POST',
      `/api/staff/terminals/${tenant.terminalId}/elevate`,
      { staffId, pin: '2580', reason: 'recording' },
      sessionHeaders(tenant.terminalId, shared.sessionToken),
    )
    expect(elevated.status).toBe(200)
    expect(elevated.body).toMatchObject({ mode: 'personal', staffId })
    expect(elevated.body?.sessionToken).toMatch(/^[A-Za-z0-9_-]{64}$/)
    expect(elevated.body?.sessionToken).not.toBe(shared.sessionToken)
    expect(elevated.body?.expiresAt).toBe('2026-08-27T02:08:30.000Z')

    const stale = await call(
      tenant.token,
      'POST',
      `/api/staff/terminals/${tenant.terminalId}/elevate`,
      { staffId, pin: '2580', reason: 'recording' },
      sessionHeaders(tenant.terminalId, shared.sessionToken),
    )
    expect(stale.status).toBe(403)
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM terminal_sessions WHERE organization_id = ? AND terminal_id = ? AND mode = 'personal'",
    )
      .bind(tenant.org, tenant.terminalId)
      .first<{ n: number }>()
    const audits = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_events WHERE organization_id = ? AND terminal_id = ? AND action = 'terminal.mode.elevated'",
    )
      .bind(tenant.org, tenant.terminalId)
      .first<{ n: number }>()
    expect(rows?.n).toBe(1)
    expect(audits?.n).toBe(1)
  })

  it('端末一覧は有効な資格情報があるときだけlast_seen_atを更新する', async () => {
    const tenant = await terminalTenant()
    await env.DB.prepare(
      'UPDATE terminals SET last_seen_at = NULL WHERE organization_id = ? AND id = ?',
    )
      .bind(tenant.org, tenant.terminalId)
      .run()
    await call(tenant.token, 'GET', `/api/staff/terminals?storeId=${tenant.storeId}`, undefined, {
      'x-terminal-id': tenant.terminalId,
    })
    let row = await env.DB.prepare(
      'SELECT last_seen_at AS lastSeenAt FROM terminals WHERE organization_id = ? AND id = ?',
    )
      .bind(tenant.org, tenant.terminalId)
      .first<{ lastSeenAt: string | null }>()
    expect(row?.lastSeenAt).toBeNull()

    const session = await startShared(tenant)
    await env.DB.prepare(
      'UPDATE terminals SET last_seen_at = NULL WHERE organization_id = ? AND id = ?',
    )
      .bind(tenant.org, tenant.terminalId)
      .run()
    const listed = await call(
      tenant.token,
      'GET',
      `/api/staff/terminals?storeId=${tenant.storeId}`,
      undefined,
      sessionHeaders(tenant.terminalId, session.sessionToken),
    )
    expect(listed.status).toBe(200)
    row = await env.DB.prepare(
      'SELECT last_seen_at AS lastSeenAt FROM terminals WHERE organization_id = ? AND id = ?',
    )
      .bind(tenant.org, tenant.terminalId)
      .first<{ lastSeenAt: string | null }>()
    expect(row?.lastSeenAt).toBe(FIXED_NOW)
  })

  it('3回目の誤りで30秒ロックし、PINもハッシュも監査へ残さない', async () => {
    const tenant = await terminalTenant()
    const path = `/api/staff/terminals/${tenant.terminalId}/sessions`
    expect(
      (await call(tenant.token, 'POST', path, { mode: 'shared', pin: '1111' })).body,
    ).toMatchObject({
      error: 'pin_invalid',
      remainingAttempts: 2,
    })
    await call(tenant.token, 'POST', path, { mode: 'shared', pin: '1111' })
    const third = await call(tenant.token, 'POST', path, { mode: 'shared', pin: '1111' })
    expect(third.status).toBe(429)
    expect(third.body).toEqual({ error: 'pin_locked', retryAfterSeconds: 30, remainingAttempts: 0 })
    const audits = await env.DB.prepare(
      "SELECT after_json AS afterJson FROM audit_events WHERE organization_id = ? AND action = 'terminal.pin.failed'",
    )
      .bind(tenant.org)
      .all<{ afterJson: string }>()
    expect(audits.results).toHaveLength(3)
    expect(JSON.stringify(audits.results)).not.toContain('1111')
    expect(JSON.stringify(audits.results)).not.toContain('hmac$')
  })

  it('他テナントの端末ではセッションを開けない', async () => {
    const owner = await terminalTenant()
    const attacker = await terminalTenant()
    const result = await call(
      attacker.token,
      'POST',
      `/api/staff/terminals/${owner.terminalId}/sessions`,
      { mode: 'shared', pin: '2580' },
    )
    expect(result.status).toBe(404)
  })

  it('端末をinactiveにする同一batchで全live sessionを監査付きrevokeし全credentialを即時拒否する', async () => {
    const tenant = await terminalTenant()
    const staffId = await insertStaff(tenant.org, tenant.storeId, { displayName: '佐藤 美咲' })
    await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({
        id: crypto.randomUUID(),
        organizationId: tenant.org,
        storeId: tenant.storeId,
        userId: `dev:${tenant.org}`,
        permissions: ['terminal.manage'],
        createdAt: FIXED_NOW,
      }),
    })
    const sessions = [
      {
        id: crypto.randomUUID(),
        token: 'i'.repeat(64),
        mode: 'personal',
        staffId,
        startedAt: FIXED_NOW,
        expiresAt: '2026-08-27T02:10:00.000Z',
      },
      {
        id: crypto.randomUUID(),
        token: 's'.repeat(64),
        mode: 'shared',
        staffId: null,
        startedAt: FIXED_NOW,
        expiresAt: '2026-08-28T02:08:00.000Z',
      },
      {
        id: crypto.randomUUID(),
        token: 'f'.repeat(64),
        mode: 'personal',
        staffId,
        startedAt: '2026-08-26T03:00:00.000Z',
        expiresAt: '2026-08-27T02:07:59.999Z',
      },
    ] as const
    for (const session of sessions) {
      await env.DB.prepare(
        'INSERT INTO terminal_sessions (id, organization_id, store_id, terminal_id, staff_id, mode, credential_hash, started_at, expires_at, revoked_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?)',
      )
        .bind(
          session.id,
          tenant.org,
          tenant.storeId,
          tenant.terminalId,
          session.staffId,
          session.mode,
          await credentialHash(session.token),
          session.startedAt,
          session.expiresAt,
          session.startedAt,
        )
        .run()
    }

    const disabled = await call(
      tenant.token,
      'PATCH',
      `/api/staff/terminals/${tenant.terminalId}`,
      { isActive: false, version: 1 },
      sessionHeaders(tenant.terminalId, sessions[0].token),
    )
    expect(disabled.status).toBe(200)
    expect(disabled.body).toMatchObject({ isActive: false, version: 2 })
    const live = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM terminal_sessions WHERE organization_id = ? AND terminal_id = ? AND revoked_at IS NULL',
    )
      .bind(tenant.org, tenant.terminalId)
      .first<{ n: number }>()
    expect(live?.n).toBe(0)
    const ended = await env.DB.prepare(
      "SELECT actor_type AS actorType, actor_id AS actorId, terminal_id AS terminalId, after_json AS afterJson FROM audit_events WHERE organization_id = ? AND action = 'terminal.session.ended'",
    )
      .bind(tenant.org)
      .all<{ actorType: string; actorId: string; terminalId: string; afterJson: string }>()
    expect(ended.results).toHaveLength(3)
    expect(ended.results).toEqual(
      expect.arrayContaining(
        sessions.map((session) =>
          expect.objectContaining({
            actorType: 'staff',
            actorId: staffId,
            terminalId: tenant.terminalId,
            afterJson: expect.stringContaining(session.id),
          }),
        ),
      ),
    )

    await env.DB.prepare(
      'UPDATE terminals SET last_seen_at = NULL WHERE organization_id = ? AND id = ?',
    )
      .bind(tenant.org, tenant.terminalId)
      .run()
    for (const session of sessions) {
      const denied = await call(
        tenant.token,
        'GET',
        `/api/staff/terminals?storeId=${tenant.storeId}&includeInactive=true`,
        undefined,
        sessionHeaders(tenant.terminalId, session.token),
      )
      expect(denied.status).toBe(403)
    }
    const lastSeen = await env.DB.prepare(
      'SELECT last_seen_at AS lastSeenAt FROM terminals WHERE organization_id = ? AND id = ?',
    )
      .bind(tenant.org, tenant.terminalId)
      .first<{ lastSeenAt: string | null }>()
    expect(lastSeen?.lastSeenAt).toBeNull()
    expect(
      (
        await call(
          tenant.token,
          'POST',
          `/api/staff/terminals?storeId=${tenant.storeId}`,
          {
            name: '拒否される端末',
            kind: 'shared',
            placeNote: '',
            deviceLabel: '',
            autoLockSeconds: 120,
            isActive: true,
          },
          sessionHeaders(tenant.terminalId, sessions[0].token),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await call(
          tenant.token,
          'POST',
          `/api/staff/terminals/${tenant.terminalId}/elevate`,
          { staffId, pin: '2580', reason: 'settings' },
          sessionHeaders(tenant.terminalId, sessions[1].token),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await call(
          tenant.token,
          'DELETE',
          `/api/staff/terminals/${tenant.terminalId}/sessions/${sessions[0].id}`,
          undefined,
          sessionHeaders(tenant.terminalId, sessions[0].token),
        )
      ).status,
    ).toBe(403)
  })

  it('inactive PATCHとstartが競合してもinactive端末にlive sessionを残さない', async () => {
    const tenant = await terminalTenant()
    const staffId = await insertStaff(tenant.org, tenant.storeId, { displayName: '佐藤 美咲' })
    await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({
        id: crypto.randomUUID(),
        organizationId: tenant.org,
        storeId: tenant.storeId,
        userId: `dev:${tenant.org}`,
        permissions: ['terminal.manage'],
        createdAt: FIXED_NOW,
      }),
    })
    const controllerId = crypto.randomUUID()
    const controllerPinHash = await hashStretched(
      await stretchPin('2580', tenant.org, controllerId, 1),
      PEPPER,
    )
    await env.DB.prepare(
      "INSERT INTO terminals (id, organization_id, store_id, name, kind, pin_hash, auto_lock_seconds, is_active, version, created_at) VALUES (?,?,?,?,?,?,120,'1',1,?)",
    )
      .bind(
        controllerId,
        tenant.org,
        tenant.storeId,
        '操作用端末',
        'shared',
        controllerPinHash,
        FIXED_NOW,
      )
      .run()
    const personalToken = 'r'.repeat(64)
    await env.DB.prepare(
      "INSERT INTO terminal_sessions (id, organization_id, store_id, terminal_id, staff_id, mode, credential_hash, started_at, expires_at, revoked_at, created_at) VALUES (?,?,?,?,?,'personal',?,?,'2026-08-27T02:10:00.000Z',NULL,?)",
    )
      .bind(
        crypto.randomUUID(),
        tenant.org,
        tenant.storeId,
        controllerId,
        staffId,
        await credentialHash(personalToken),
        FIXED_NOW,
        FIXED_NOW,
      )
      .run()

    const [patched, started] = await Promise.all([
      call(
        tenant.token,
        'PATCH',
        `/api/staff/terminals/${tenant.terminalId}`,
        { isActive: false, version: 1 },
        sessionHeaders(controllerId, personalToken),
      ),
      call(tenant.token, 'POST', `/api/staff/terminals/${tenant.terminalId}/sessions`, {
        mode: 'shared',
        pin: '2580',
      }),
    ])
    expect(patched.status).toBe(200)
    expect([200, 403, 404]).toContain(started.status)
    const terminal = await env.DB.prepare(
      'SELECT is_active AS isActive FROM terminals WHERE organization_id = ? AND id = ?',
    )
      .bind(tenant.org, tenant.terminalId)
      .first<{ isActive: string }>()
    const live = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM terminal_sessions WHERE organization_id = ? AND terminal_id = ? AND revoked_at IS NULL',
    )
      .bind(tenant.org, tenant.terminalId)
      .first<{ n: number }>()
    expect(terminal?.isActive).toBe('0')
    expect(live?.n).toBe(0)
  })

  it('個人モード中の端末登録監査はセッションのstaffとterminalをactorにする', async () => {
    const tenant = await terminalTenant()
    const staffId = await insertStaff(tenant.org, tenant.storeId, { displayName: '佐藤 美咲' })
    await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({
        id: crypto.randomUUID(),
        organizationId: tenant.org,
        storeId: tenant.storeId,
        userId: `dev:${tenant.org}`,
        permissions: ['terminal.manage'],
        createdAt: FIXED_NOW,
      }),
    })
    const sessionToken = 'm'.repeat(64)
    await env.DB.prepare(
      "INSERT INTO terminal_sessions (id, organization_id, store_id, terminal_id, staff_id, mode, credential_hash, started_at, expires_at, revoked_at, created_at) VALUES (?,?,?,?,?,'personal',?,?,'2026-08-27T02:10:00.000Z',NULL,?)",
    )
      .bind(
        crypto.randomUUID(),
        tenant.org,
        tenant.storeId,
        tenant.terminalId,
        staffId,
        await credentialHash(sessionToken),
        FIXED_NOW,
        FIXED_NOW,
      )
      .run()

    const created = await call(
      tenant.token,
      'POST',
      `/api/staff/terminals?storeId=${tenant.storeId}`,
      {
        name: '検査用iPad',
        kind: 'shared',
        placeNote: '',
        deviceLabel: '',
        autoLockSeconds: 120,
        isActive: true,
      },
      sessionHeaders(tenant.terminalId, sessionToken),
    )
    expect(created.status).toBe(200)
    const audit = await env.DB.prepare(
      "SELECT actor_type AS actorType, actor_id AS actorId, terminal_id AS terminalId FROM audit_events WHERE organization_id = ? AND action = 'terminal.created'",
    )
      .bind(tenant.org)
      .first<{ actorType: string; actorId: string; terminalId: string }>()
    expect(audit).toEqual({ actorType: 'staff', actorId: staffId, terminalId: tenant.terminalId })
  })

  it('生きた個人モードと権限がある店長だけがスタッフPINを再設定でき、平文を残さない', async () => {
    const tenant = await terminalTenant()
    const staffId = await insertStaff(tenant.org, tenant.storeId, { displayName: '佐藤 美咲' })
    await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({
        id: crypto.randomUUID(),
        organizationId: tenant.org,
        storeId: tenant.storeId,
        userId: `dev:${tenant.org}`,
        permissions: ['settings.manage'],
        createdAt: FIXED_NOW,
      }),
    })
    await env.DB.prepare(
      "INSERT INTO terminal_sessions (id, organization_id, store_id, terminal_id, staff_id, mode, credential_hash, started_at, expires_at, revoked_at, created_at) VALUES (?,?,?,?,?,'personal',?,?,'2026-08-27T02:10:00.000Z',NULL,?)",
    )
      .bind(
        crypto.randomUUID(),
        tenant.org,
        tenant.storeId,
        tenant.terminalId,
        staffId,
        await credentialHash('p'.repeat(64)),
        FIXED_NOW,
        FIXED_NOW,
      )
      .run()

    const path = `/api/staff/stores/${tenant.storeId}/staff/${staffId}/pin`
    expect(
      (
        await call(
          tenant.token,
          'PUT',
          path,
          { pin: '1234' },
          sessionHeaders(tenant.terminalId, 'p'.repeat(64)),
        )
      ).status,
    ).toBe(400)
    const updated = await call(
      tenant.token,
      'PUT',
      path,
      { pin: '2580' },
      sessionHeaders(tenant.terminalId, 'p'.repeat(64)),
    )
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({ staffId, updatedAt: FIXED_NOW })
    const row = await env.DB.prepare(
      'SELECT pin_hash AS pinHash FROM staff WHERE organization_id = ? AND id = ?',
    )
      .bind(tenant.org, staffId)
      .first<{ pinHash: string }>()
    expect(row?.pinHash).toMatch(/^hmac\$/)
    expect(row?.pinHash).not.toContain('2580')
    const audit = await env.DB.prepare(
      "SELECT actor_type AS actorType, actor_id AS actorId, terminal_id AS terminalId, after_json AS afterJson FROM audit_events WHERE organization_id = ? AND action = 'staff.pin.updated'",
    )
      .bind(tenant.org)
      .first<{ actorType: string; actorId: string; terminalId: string; afterJson: string }>()
    expect(audit).toMatchObject({
      actorType: 'staff',
      actorId: staffId,
      terminalId: tenant.terminalId,
    })
    expect(audit?.afterJson).not.toContain('2580')
    expect(audit?.afterJson).not.toContain('hmac$')
  })
})
