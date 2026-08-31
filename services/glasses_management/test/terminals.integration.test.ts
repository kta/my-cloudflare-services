/**
 * 端末とセッションの代表フロー（`013-terminals-and-audit`）。
 *
 * 見るのは 5 つ。**置き場所の一覧**（`pin_hash` を 1 度も外へ出さない）、
 * **共有と個人の業務開始**、**暗証番号の誤りと 30 秒の待ち**、**業務の終了**、
 * そして**置き場所の引き継ぎ**（すでに誰かが使っている置き場所を別の端末が選ぶ）。
 *
 * 平文の暗証番号は保存も応答もしないので、材料は必ず API を通して作る
 * （`createTerminal` / `setStaffPin`）。D1 へ直に触るのは、API から書けない
 * `last_seen_at` と、KV に置いた失敗回数が D1 に漏れていないことの確認だけである。
 *
 * D1 はテストファイル内で共有されるので、組織 id は毎回 `orgId()` で作る。
 */
import { env, SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  authed,
  BASE,
  createTerminal,
  elevate,
  FIXED_NOW,
  grantStorePermissions,
  insertStaff,
  insertStore,
  orgId,
  setStaffPin,
  startSession,
  tokenFor,
  touchTerminal,
} from './helpers'

/** 共有端末の店舗共通の暗証番号と、佐藤 美咲 の暗証番号。どちらも弱くない 4 桁。 */
const SHARED_PIN = '4831'
const STAFF_PIN = '2748'

/** 1 組織ぶんの足場をまとめて作る。 */
async function setup(): Promise<{
  org: string
  token: string
  storeId: string
  staffId: string
}> {
  const org = orgId()
  const token = await tokenFor(org, 'staff')
  const storeId = await insertStore(org)
  await grantStorePermissions(org, storeId, `dev:${org}`, [
    'settings.read',
    'settings.manage',
    'terminal.manage',
    'audit.read',
  ])
  const staffId = await insertStaff(org, storeId, { displayName: '佐藤 美咲' })
  await setStaffPin(token, storeId, staffId, STAFF_PIN)
  return { org, token, storeId, staffId }
}

async function listTerminals(
  token: string,
  storeId: string,
  query = '',
): Promise<{
  status: number
  items: Array<Record<string, unknown>>
}> {
  const res = await SELF.fetch(`${BASE}/api/staff/terminals?storeId=${storeId}${query}`, {
    headers: authed(token),
  })
  const body = (await res.json().catch(() => null)) as {
    items?: Array<Record<string, unknown>>
  } | null
  return { status: res.status, items: body?.items ?? [] }
}

describe('置き場所の一覧', () => {
  it('作成の古い順に 3 件返し、pin_hash を 1 度も含まない', async () => {
    const { token, storeId } = await setup()
    for (const name of ['レジ横iPad', '受付台iPad', '奥のiPad']) {
      await createTerminal(token, { storeId, name, pin: SHARED_PIN })
    }
    const { status, items } = await listTerminals(token, storeId)
    expect(status).toBe(200)
    expect(items.map((item) => item.name)).toEqual(['レジ横iPad', '受付台iPad', '奥のiPad'])
    expect(JSON.stringify(items)).not.toContain('pin_hash')
    expect(JSON.stringify(items)).not.toContain('pinHash')
    expect(JSON.stringify(items)).not.toContain(SHARED_PIN)
  })

  it('hasPin は pin_hash の有無から作る（値そのものは返さない）', async () => {
    const { token, storeId } = await setup()
    await createTerminal(token, { storeId, name: 'PIN あり', pin: SHARED_PIN })
    await createTerminal(token, { storeId, name: 'PIN なし' })
    const { items } = await listTerminals(token, storeId)
    expect(items.map((item) => [item.name, item.hasPin])).toEqual([
      ['PIN あり', true],
      ['PIN なし', false],
    ])
  })

  it('最終通信が 5 分より古い端末は isOnline=false になる（列に状態を持たない）', async () => {
    const { org, token, storeId } = await setup()
    const fresh = await createTerminal(token, { storeId, name: 'いま', pin: SHARED_PIN })
    const stale = await createTerminal(token, { storeId, name: 'むかし', pin: SHARED_PIN })
    // 「つながっている」の判定は毎回計算される。列に真偽値を持たない。
    await touchTerminal(org, String(fresh.body?.id), new Date().toISOString())
    await touchTerminal(org, String(stale.body?.id), '2026-08-27T00:00:00.000Z')
    const { items } = await listTerminals(token, storeId)
    expect(items.map((item) => [item.name, item.isOnline])).toEqual([
      ['いま', true],
      ['むかし', false],
    ])
  })

  it('last_seen_at が NULL の端末は isOnline=false で、lastSeenAt も null のまま返る', async () => {
    const { token, storeId } = await setup()
    await createTerminal(token, { storeId, name: '箱から出したばかり', pin: SHARED_PIN })
    const { items } = await listTerminals(token, storeId)
    expect(items[0]).toMatchObject({ lastSeenAt: null, isOnline: false })
  })

  it("includeInactive=false のとき is_active='0' の端末を返さない", async () => {
    const { token, storeId } = await setup()
    await createTerminal(token, { storeId, name: '現役', pin: SHARED_PIN })
    await createTerminal(token, { storeId, name: '引退', pin: SHARED_PIN, isActive: false })
    expect((await listTerminals(token, storeId)).items.map((item) => item.name)).toEqual(['現役'])
    expect(
      (await listTerminals(token, storeId, '&includeInactive=true')).items.map((item) => item.name),
    ).toEqual(['現役', '引退'])
  })
})

describe('共有の業務開始', () => {
  it("正しい店舗の暗証番号で mode='shared' のセッションが開き、staffId は null になる", async () => {
    const { token, storeId } = await setup()
    const terminal = await createTerminal(token, { storeId, pin: SHARED_PIN })
    const started = await startSession(token, String(terminal.body?.id), {
      mode: 'shared',
      pin: SHARED_PIN,
    })
    expect(started.status).toBe(201)
    expect(started.body).toMatchObject({
      terminalId: terminal.body?.id,
      mode: 'shared',
      staffId: null,
    })
  })

  it('expires_at は開始時刻 + auto_lock_seconds になる', async () => {
    const { token, storeId } = await setup()
    const terminal = await createTerminal(token, { storeId, pin: SHARED_PIN, autoLockSeconds: 300 })
    const started = await startSession(token, String(terminal.body?.id), {
      mode: 'shared',
      pin: SHARED_PIN,
    })
    const startedAt = Date.parse(String(started.body?.startedAt))
    const expiresAt = Date.parse(String(started.body?.expiresAt))
    expect(expiresAt - startedAt).toBe(300_000)
  })
})

describe('個人の業務開始', () => {
  it("正しい本人の暗証番号で mode='personal' のセッションが開き、staffId が入る", async () => {
    const { token, storeId, staffId } = await setup()
    const terminal = await createTerminal(token, { storeId, kind: 'personal' })
    const started = await startSession(token, String(terminal.body?.id), {
      mode: 'personal',
      staffId,
      pin: STAFF_PIN,
    })
    expect(started.status).toBe(201)
    expect(started.body).toMatchObject({ mode: 'personal', staffId })
  })

  it('staffId を欠いた本文は 400 で落ちる', async () => {
    const { token, storeId } = await setup()
    const terminal = await createTerminal(token, { storeId, kind: 'personal' })
    const started = await startSession(token, String(terminal.body?.id), {
      mode: 'personal',
      pin: STAFF_PIN,
    })
    expect(started.status).toBe(400)
  })

  it('pin_hash が NULL のスタッフでは 401 pin_invalid になる（PIN 未設定は個人ログイン不可）', async () => {
    const { org, token, storeId } = await setup()
    const noPin = await insertStaff(org, storeId, { displayName: '中村 彩' })
    const terminal = await createTerminal(token, { storeId, kind: 'personal' })
    const started = await startSession(token, String(terminal.body?.id), {
      mode: 'personal',
      staffId: noPin,
      pin: STAFF_PIN,
    })
    expect(started.status).toBe(401)
    expect(started.body).toMatchObject({ error: 'pin_invalid' })
  })
})

describe('暗証番号の誤り', () => {
  it('1 回目は 401 pin_invalid で remainingAttempts=2', async () => {
    const { token, storeId } = await setup()
    const terminal = await createTerminal(token, { storeId, pin: SHARED_PIN })
    const first = await startSession(token, String(terminal.body?.id), {
      mode: 'shared',
      pin: '9999',
    })
    expect(first.status).toBe(401)
    expect(first.body).toEqual({ error: 'pin_invalid', remainingAttempts: 2 })
    const second = await startSession(token, String(terminal.body?.id), {
      mode: 'shared',
      pin: '9999',
    })
    expect(second.body).toEqual({ error: 'pin_invalid', remainingAttempts: 1 })
  })

  it('3 回目は 429 pin_locked で retryAfterSeconds=30・remainingAttempts=0', async () => {
    const { token, storeId } = await setup()
    const terminal = await createTerminal(token, { storeId, pin: SHARED_PIN })
    for (const _ of [1, 2]) {
      await startSession(token, String(terminal.body?.id), { mode: 'shared', pin: '9999' })
    }
    const third = await startSession(token, String(terminal.body?.id), {
      mode: 'shared',
      pin: '9999',
    })
    expect(third.status).toBe(429)
    expect(third.body).toEqual({
      error: 'pin_locked',
      retryAfterSeconds: 30,
      remainingAttempts: 0,
    })
  })

  it('ロック中は正しい暗証番号でも 429 のまま業務が始まらない', async () => {
    const { org, token, storeId } = await setup()
    const terminal = await createTerminal(token, { storeId, pin: SHARED_PIN })
    for (const _ of [1, 2, 3]) {
      await startSession(token, String(terminal.body?.id), { mode: 'shared', pin: '9999' })
    }
    const correct = await startSession(token, String(terminal.body?.id), {
      mode: 'shared',
      pin: SHARED_PIN,
    })
    expect(correct.status).toBe(429)
    const live = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM terminal_sessions WHERE organization_id = ?',
    )
      .bind(org)
      .first<{ n: number }>()
    expect(live?.n).toBe(0)
  })

  it("失敗回数は KV の pin:<org>:<terminal>:<staffId ?? 'shared'> に置き、D1 に行を作らない", async () => {
    const { org, token, storeId } = await setup()
    const terminal = await createTerminal(token, { storeId, pin: SHARED_PIN })
    const terminalId = String(terminal.body?.id)
    await startSession(token, terminalId, { mode: 'shared', pin: '9999' })
    expect(await env.SHORT_LIVED.get(`pin:${org}:${terminalId}:shared`)).not.toBeNull()
    const rows = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM terminal_sessions WHERE organization_id = ?',
    )
      .bind(org)
      .first<{ n: number }>()
    expect(rows?.n).toBe(0)
  })

  it('3 桁の本文は zValidator の 400 で落ち、weak_pin にはならない', async () => {
    const { token, storeId } = await setup()
    const terminal = await createTerminal(token, { storeId, pin: SHARED_PIN })
    const short = await startSession(token, String(terminal.body?.id), {
      mode: 'shared',
      pin: '483',
    })
    expect(short.status).toBe(400)
    expect(short.body?.error).not.toBe('weak_pin')
  })

  it('0000 と 1234 の登録は 400 weak_pin で拒む（照合ではなく登録のときだけ）', async () => {
    const { token, storeId, staffId } = await setup()
    for (const pin of ['0000', '1234']) {
      const created = await createTerminal(token, { storeId, pin })
      expect(created.status).toBe(400)
      expect(created.body).toMatchObject({ error: 'weak_pin' })
      const set = await setStaffPin(token, storeId, staffId, pin)
      expect(set.status).toBe(400)
      expect(set.body).toMatchObject({ error: 'weak_pin' })
    }
    // 照合の側は弱さを見ない（弱い番号が登録済みなら 401 pin_invalid のまま）。
    const terminal = await createTerminal(token, { storeId, pin: SHARED_PIN })
    const attempt = await startSession(token, String(terminal.body?.id), {
      mode: 'shared',
      pin: '0000',
    })
    expect(attempt.status).toBe(401)
    expect(attempt.body).toMatchObject({ error: 'pin_invalid' })
  })
})

describe('業務の終了', () => {
  it('セッションを消すと revoked_at が入り、行は残る', async () => {
    const { org, token, storeId } = await setup()
    const terminal = await createTerminal(token, { storeId, pin: SHARED_PIN })
    const terminalId = String(terminal.body?.id)
    const started = await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    const sessionId = String(started.body?.id)
    const res = await SELF.fetch(
      `${BASE}/api/staff/terminals/${terminalId}/sessions/${sessionId}`,
      { method: 'DELETE', headers: authed(token) },
    )
    expect(res.status).toBe(204)
    const row = await env.DB.prepare(
      'SELECT revoked_at FROM terminal_sessions WHERE organization_id = ? AND id = ?',
    )
      .bind(org, sessionId)
      .first<{ revoked_at: string | null }>()
    expect(row).not.toBeNull()
    expect(row?.revoked_at).not.toBeNull()
  })

  it('他人のセッション id を指定しても 404 で、相手のセッションは生きたままである', async () => {
    const mine = await setup()
    const theirs = await setup()
    const myTerminal = await createTerminal(mine.token, { storeId: mine.storeId, pin: SHARED_PIN })
    const theirTerminal = await createTerminal(theirs.token, {
      storeId: theirs.storeId,
      pin: SHARED_PIN,
    })
    const theirSession = await startSession(theirs.token, String(theirTerminal.body?.id), {
      mode: 'shared',
      pin: SHARED_PIN,
    })
    const res = await SELF.fetch(
      `${BASE}/api/staff/terminals/${String(myTerminal.body?.id)}/sessions/${String(theirSession.body?.id)}`,
      { method: 'DELETE', headers: authed(mine.token) },
    )
    expect(res.status).toBe(404)
    const row = await env.DB.prepare(
      'SELECT revoked_at FROM terminal_sessions WHERE organization_id = ? AND id = ?',
    )
      .bind(theirs.org, String(theirSession.body?.id))
      .first<{ revoked_at: string | null }>()
    expect(row?.revoked_at).toBeNull()
  })
})

describe('置き場所の引き継ぎ', () => {
  it('業務中の置き場所を別の端末が選ぶと、前のセッションが失効し新しいセッションが開く', async () => {
    const { org, token, storeId } = await setup()
    const terminal = await createTerminal(token, { storeId, pin: SHARED_PIN })
    const terminalId = String(terminal.body?.id)
    const first = await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    const second = await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    expect(second.status).toBe(201)
    expect(second.body?.id).not.toBe(first.body?.id)
    const before = await env.DB.prepare(
      'SELECT revoked_at FROM terminal_sessions WHERE organization_id = ? AND id = ?',
    )
      .bind(org, String(first.body?.id))
      .first<{ revoked_at: string | null }>()
    expect(before?.revoked_at).not.toBeNull()
  })

  it('1 端末に revoked_at が NULL で期限内のセッションは高々 1 本である', async () => {
    const { org, token, storeId, staffId } = await setup()
    const terminal = await createTerminal(token, { storeId, pin: SHARED_PIN })
    const terminalId = String(terminal.body?.id)
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    await startSession(token, terminalId, { mode: 'personal', staffId, pin: STAFF_PIN })
    const live = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM terminal_sessions WHERE organization_id = ? AND terminal_id = ? AND revoked_at IS NULL AND expires_at > ?',
    )
      .bind(org, terminalId, FIXED_NOW)
      .first<{ n: number }>()
    expect(live?.n).toBe(1)
  })
})

describe('個人モードへの昇格', () => {
  it("共有セッションのある端末で elevate すると mode='personal' の行に入れ替わる", async () => {
    const { org, token, storeId, staffId } = await setup()
    const terminal = await createTerminal(token, { storeId, pin: SHARED_PIN })
    const terminalId = String(terminal.body?.id)
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    const elevated = await elevate(token, terminalId, staffId, STAFF_PIN)
    expect(elevated.status).toBe(201)
    expect(elevated.body).toMatchObject({ mode: 'personal', staffId })
    const { results } = await env.DB.prepare(
      'SELECT mode FROM terminal_sessions WHERE organization_id = ? AND terminal_id = ? AND revoked_at IS NULL',
    )
      .bind(org, terminalId)
      .all<{ mode: string }>()
    expect(results.map((row) => row.mode)).toEqual(['personal'])
  })

  it('セッションが 1 本も無い端末で elevate すると 404 になる', async () => {
    const { token, storeId, staffId } = await setup()
    const terminal = await createTerminal(token, { storeId, pin: SHARED_PIN })
    const elevated = await elevate(token, String(terminal.body?.id), staffId, STAFF_PIN)
    expect(elevated.status).toBe(404)
  })
})

describe('端末の登録・更新', () => {
  it('POST は version=1 の端末を作り、PATCH は version を +1 する', async () => {
    const { token, storeId } = await setup()
    const created = await createTerminal(token, { storeId, pin: SHARED_PIN })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ version: 1 })
    const res = await SELF.fetch(`${BASE}/api/staff/terminals/${String(created.body?.id)}`, {
      method: 'PATCH',
      headers: authed(token),
      body: JSON.stringify({ version: 1, name: '銀座店 受付台iPad' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ name: '銀座店 受付台iPad', version: 2 })
  })

  it('古い version の PATCH は 409 version_conflict で、行は変わらない', async () => {
    const { org, token, storeId } = await setup()
    const created = await createTerminal(token, { storeId, name: '元の名前', pin: SHARED_PIN })
    const terminalId = String(created.body?.id)
    await SELF.fetch(`${BASE}/api/staff/terminals/${terminalId}`, {
      method: 'PATCH',
      headers: authed(token),
      body: JSON.stringify({ version: 1, name: '新しい名前' }),
    })
    const stale = await SELF.fetch(`${BASE}/api/staff/terminals/${terminalId}`, {
      method: 'PATCH',
      headers: authed(token),
      body: JSON.stringify({ version: 1, name: 'さらに別の名前' }),
    })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: 'version_conflict' })
    const row = await env.DB.prepare(
      'SELECT name, version FROM terminals WHERE organization_id = ? AND id = ?',
    )
      .bind(org, terminalId)
      .first<{ name: string; version: number }>()
    expect(row).toMatchObject({ name: '新しい名前', version: 2 })
  })

  it('別の店舗でしか terminal.manage を持たない店長は、その端末を PATCH できない（403）', async () => {
    const { org, token, storeId } = await setup()
    // 同じ組織の 2 店舗目。この人はここでは何の権限も持たない。
    const otherStoreId = await insertStore(org, 'EYEX 新宿店')
    const created = await createTerminal(token, {
      storeId: otherStoreId,
      name: '新宿店 レジ横iPad',
      pin: SHARED_PIN,
    })
    // 登録そのものが 403（`storeId` はクエリにあるので middleware が止める）。
    expect(created.status).toBe(403)
    // 直に置いた新宿店の端末も、銀座店の権限では書き換えられない。
    const terminalId = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO terminals (id, organization_id, store_id, name, kind, place_note, device_label, pin_hash, auto_lock_seconds, last_seen_at, is_active, version, created_at) ' +
        "VALUES (?,?,?,?,'shared','','',NULL,120,NULL,'1',1,?)",
    )
      .bind(terminalId, org, otherStoreId, '新宿店 レジ横iPad', FIXED_NOW)
      .run()
    expect(storeId).not.toBe(otherStoreId)
    const res = await SELF.fetch(`${BASE}/api/staff/terminals/${terminalId}`, {
      method: 'PATCH',
      headers: authed(token),
      body: JSON.stringify({ version: 1, name: '乗っ取られた名前' }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'forbidden' })
    const row = await env.DB.prepare('SELECT name FROM terminals WHERE id = ?')
      .bind(terminalId)
      .first<{ name: string }>()
    expect(row?.name).toBe('新宿店 レジ横iPad')
  })
})

beforeAll(() => {
  // 基準時刻は世界観データの 2026年8月27日（木）11:08。時刻に依る判定は
  // `terminal-session.time.test.ts` が固定するので、ここでは実時刻を読む行を置かない。
  expect(FIXED_NOW).toBe('2026-08-27T02:08:00.000Z')
})
