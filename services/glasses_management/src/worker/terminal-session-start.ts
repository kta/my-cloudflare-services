/**
 * 端末セッションの開始（暗証番号の照合 → 監査 → セッション行）。
 *
 * 認証ありの `/api/staff/terminals/:terminalId/sessions` と、未認証の
 * `/api/public/sites/:storeSlug/terminals/:terminalId/sessions` が共有する。
 * 違いは「組織をどこから得るか」だけで、照合と監査の中身は 1 つにする ——
 * 二重に書くと、片方だけロックが緩いといった食い違いが静かに生まれる。
 *
 * 時刻は呼出元から注入する（`c.env.TEST_NOW`）。
 */
import { stretchPin, verifyStretched } from '@app/shared'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import {
  isPinLocked,
  lockSecondsFor,
  nextFailureState,
  parsePinFailure,
  parsePinStreak,
  pinFailureKey,
  pinStreakKey,
} from './domain/pin'
import { expiresAtFrom, sharedExpiresAtFrom } from './domain/terminal-session'

export type SessionStartEnv = {
  DB: D1Database
  SHORT_LIVED: KVNamespace
  AUTH_PEPPER: string
  TEST_NOW?: string
}

export type SessionStartInput = {
  organizationId: string
  terminalId: string
  pin: string
  /** 個人モードのときだけ埋まる。公開ルートはサーバが `terminals.staff_id` から引く。 */
  staffId: string | null
  mode: 'shared' | 'personal'
}

type StartedSession = {
  id: string
  terminalId: string
  staffId: string | null
  mode: 'shared' | 'personal'
  startedAt: string
  expiresAt: string
  sessionToken: string
}

export type SessionStartResult =
  | { ok: true; session: StartedSession; storeId: string }
  | { ok: false; status: 401 | 404 | 429; body: Record<string, unknown> }

/** 長い窓の失敗を数える TTL。24 時間の頭打ちに合わせる。 */
const STREAK_TTL_SECONDS = 24 * 60 * 60

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sessionCredential(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(48))
  const token = base64Url(bytes)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return { token, hash: base64Url(new Uint8Array(digest)) }
}

export async function startTerminalSession(
  env: SessionStartEnv,
  input: SessionStartInput,
  now: Date,
): Promise<SessionStartResult> {
  const org = input.organizationId
  const { terminalId, staffId, mode } = input
  const nowIso = now.toISOString()

  const terminal = await env.DB.prepare(
    "SELECT id, store_id AS storeId, pin_hash AS pinHash, auto_lock_seconds AS autoLockSeconds FROM terminals WHERE organization_id = ? AND id = ? AND is_active = '1'",
  )
    .bind(org, terminalId)
    .first<{ id: string; storeId: string; pinHash: string | null; autoLockSeconds: number }>()
  if (terminal === null) return { ok: false, status: 404, body: { error: 'not_found' } }

  let storedHash = terminal.pinHash
  if (staffId !== null) {
    const member = await env.DB.prepare(
      "SELECT pin_hash AS pinHash FROM staff WHERE organization_id = ? AND store_id = ? AND id = ? AND is_active = '1'",
    )
      .bind(org, terminal.storeId, staffId)
      .first<{ pinHash: string | null }>()
    if (member === null) return { ok: false, status: 404, body: { error: 'not_found' } }
    storedHash = member.pinHash
  }

  const failureKey = pinFailureKey(org, terminalId, staffId)
  const streakKey = pinStreakKey(org, terminalId)
  const rawFailure = await env.SHORT_LIVED.get(failureKey)
  const failure = parsePinFailure(rawFailure)
  const streak = parsePinStreak(await env.SHORT_LIVED.get(streakKey))
  // Workers KV のTTL下限は60秒。値の時刻で30秒境界を守り、物理削除は60秒に任せる。
  const previous =
    failure !== null && now.getTime() - Date.parse(failure.failedAt) <= 30_000
      ? failure.attempts
      : 0

  /*
   * 長い窓のロック。短い窓（3 回で 30 秒）の外側にあり、こちらのほうが長い。
   * 待ち時間は合計失敗回数から決まるので、失敗を重ねるほど伸びる。
   */
  const streakLockSeconds = lockSecondsFor(streak)
  if (failure !== null && streakLockSeconds > 0) {
    const elapsedSeconds = Math.floor((now.getTime() - Date.parse(failure.failedAt)) / 1000)
    const remaining = streakLockSeconds - elapsedSeconds
    if (remaining > 0) {
      return {
        ok: false,
        status: 429,
        body: { error: 'pin_locked', retryAfterSeconds: remaining, remainingAttempts: 0 },
      }
    }
  }

  if (failure !== null && failure.attempts >= 3 && isPinLocked(new Date(failure.failedAt), now)) {
    const elapsedSeconds = Math.floor((now.getTime() - Date.parse(failure.failedAt)) / 1000)
    return {
      ok: false,
      status: 429,
      body: {
        error: 'pin_locked',
        retryAfterSeconds: Math.max(1, 30 - elapsedSeconds),
        remainingAttempts: 0,
      },
    }
  }

  const stretched = await stretchPin(
    input.pin,
    org,
    staffId ?? terminalId,
    env.TEST_NOW === undefined ? undefined : 1,
  )
  const verified =
    storedHash !== null && (await verifyStretched(stretched, env.AUTH_PEPPER, storedHash))
  if (!verified) {
    const state = nextFailureState(previous)
    await env.SHORT_LIVED.put(
      failureKey,
      JSON.stringify({ attempts: state.attempts, failedAt: nowIso }),
      { expirationTtl: 60 },
    )
    await env.SHORT_LIVED.put(streakKey, String(streak + 1), {
      expirationTtl: STREAK_TTL_SECONDS,
    })
    await env.DB.prepare(
      'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
        "VALUES (?,?,?,'terminal',?,?, 'terminal.pin.failed','terminals',?,NULL,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        org,
        terminal.storeId,
        terminalId,
        terminalId,
        terminalId,
        JSON.stringify({ staffId, remainingAttempts: state.remainingAttempts }),
        crypto.randomUUID(),
        nowIso,
      )
      .run()
    const nextStreakLock = lockSecondsFor(streak + 1)
    if (state.locked || nextStreakLock > 0) {
      return {
        ok: false,
        status: 429,
        body: {
          error: 'pin_locked',
          retryAfterSeconds: Math.max(30, nextStreakLock),
          remainingAttempts: 0,
        },
      }
    }
    return {
      ok: false,
      status: 401,
      body: { error: 'pin_invalid', remainingAttempts: state.remainingAttempts },
    }
  }

  await env.SHORT_LIVED.delete(failureKey)
  await env.SHORT_LIVED.delete(streakKey)
  const sessionId = crypto.randomUUID()
  const expiresAt =
    mode === 'shared' ? sharedExpiresAtFrom(now) : expiresAtFrom(now, terminal.autoLockSeconds)
  const correlationId = crypto.randomUUID()
  const credential = await sessionCredential()
  // stale read を置かず、既存行の終了監査→全 revoke→新規行→開始監査を1 batchにする。
  const result = await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
        "SELECT id, organization_id, store_id, ?, ?, terminal_id, 'terminal.session.ended', 'terminals', terminal_id, NULL, json_object('reason','taken_over','sessionId',id), ?, ? FROM terminal_sessions " +
        'WHERE organization_id = ? AND terminal_id = ? AND revoked_at IS NULL',
    ).bind(
      mode === 'personal' ? 'staff' : 'terminal',
      staffId ?? terminalId,
      correlationId,
      nowIso,
      org,
      terminalId,
    ),
    env.DB.prepare(
      'UPDATE terminal_sessions SET revoked_at = ? WHERE organization_id = ? AND terminal_id = ? AND revoked_at IS NULL',
    ).bind(nowIso, org, terminalId),
    env.DB.prepare(
      'INSERT INTO terminal_sessions (id, organization_id, store_id, terminal_id, staff_id, mode, credential_hash, started_at, expires_at, revoked_at, created_at) ' +
        "SELECT ?,?,?,?,?,?,?,?,?,NULL,? WHERE EXISTS (SELECT 1 FROM terminals WHERE organization_id = ? AND id = ? AND is_active = '1')",
    ).bind(
      sessionId,
      org,
      terminal.storeId,
      terminalId,
      staffId,
      mode,
      credential.hash,
      nowIso,
      expiresAt,
      nowIso,
      org,
      terminalId,
    ),
    env.DB.prepare(
      'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
        "SELECT ?,?,?,?,?,?,?,'terminals',?,NULL,?,?,? WHERE EXISTS (SELECT 1 FROM terminal_sessions WHERE organization_id = ? AND id = ? AND credential_hash = ? AND revoked_at IS NULL)",
    ).bind(
      crypto.randomUUID(),
      org,
      terminal.storeId,
      mode === 'personal' ? 'staff' : 'terminal',
      staffId ?? terminalId,
      terminalId,
      'terminal.session.started',
      terminalId,
      JSON.stringify({ mode, sessionId }),
      correlationId,
      nowIso,
      org,
      sessionId,
      credential.hash,
    ),
    env.DB.prepare(
      "UPDATE terminals SET last_seen_at = ? WHERE organization_id = ? AND id = ? AND is_active = '1'",
    ).bind(nowIso, org, terminalId),
  ])
  if ((result[2]?.meta.changes ?? 0) === 0) {
    return { ok: false, status: 404, body: { error: 'not_found' } }
  }

  return {
    ok: true,
    storeId: terminal.storeId,
    session: {
      id: sessionId,
      terminalId,
      staffId,
      mode,
      startedAt: nowIso,
      expiresAt,
      sessionToken: credential.token,
    },
  }
}
