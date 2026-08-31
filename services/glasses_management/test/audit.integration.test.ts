/**
 * 監査（`audit_events`）は**追記専用**である。
 *
 * ここで固定するのは 5 つ。
 *
 * 1. **主体** — 共有モードの書き込みは端末（`actor_type='terminal'`）、個人モードは本人
 *    （`'staff'`）、端末セッションが 1 本も無い経路は `'system'`。主体は**リクエストの
 *    入力から作らない**（送られてきた担当 id を信じると、誰でも他人の名前で残せる）。
 * 2. **追記専用** — 書き換える経路も消す経路も無い。訂正は打ち消しの行を足す。
 * 3. **伏せても増えない** — 自動ロックは画面だけの話で、監査に 1 行も足さない。
 * 4. **版のガード** — 409 で終わった操作の監査を残さない。D1 のバッチは 0 行しか
 *    当たらない `UPDATE` でも中断せず後続を commit するので、**監査の追記にも本処理と
 *    同じ `WHERE EXISTS` のガードが要る**。無いと「409 を返したのに、起きなかった
 *    操作の監査だけが残る」。
 * 5. **残さないもの** — `before_json` / `after_json` に平文の暗証番号もハッシュも
 *    メールアドレスも入れない（`07-nfr.md` §7.1）。
 */
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  auditRowsOf,
  authed,
  BASE,
  createTerminal,
  elevate,
  grantStorePermissions,
  insertStaff,
  insertStore,
  orgId,
  setStaffPin,
  startSession,
  syncOrganization,
  tokenFor,
} from './helpers'

type AuditRow = Awaited<ReturnType<typeof auditRowsOf>>[number]

/** ちょうど 1 行であることを確かめて、その 1 行を返す。 */
function only(rows: readonly AuditRow[]): AuditRow {
  expect(rows).toHaveLength(1)
  return rows[0] as AuditRow
}

const SHARED_PIN = '4831'
const STAFF_PIN = '2748'

async function setup(): Promise<{
  org: string
  token: string
  storeId: string
  staffId: string
  terminalId: string
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
  const terminal = await createTerminal(token, { storeId, pin: SHARED_PIN })
  return { org, token, storeId, staffId, terminalId: String(terminal.body?.id) }
}

/** 端末の名前を書き換える（監査の「変更前後」を作る、いちばん短い操作）。 */
async function renameTerminal(
  token: string,
  terminalId: string,
  version: number,
  name: string,
): Promise<number> {
  const res = await SELF.fetch(`${BASE}/api/staff/terminals/${terminalId}`, {
    method: 'PATCH',
    headers: authed(token),
    body: JSON.stringify({ version, name }),
  })
  return res.status
}

describe('主体', () => {
  it("共有モードの書き込みは actor_type='terminal'・actor_id=端末 id・terminal_id=端末 id になる", async () => {
    const { org, token, terminalId } = await setup()
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    expect(await renameTerminal(token, terminalId, 1, 'レジ横iPad（共有）')).toBe(200)
    const updated = (await auditRowsOf(org)).filter((row) => row.action === 'terminal.updated')
    expect(only(updated)).toMatchObject({
      actor_type: 'terminal',
      actor_id: terminalId,
      terminal_id: terminalId,
      target_type: 'terminals',
      target_id: terminalId,
    })
  })

  it("個人モードの書き込みは actor_type='staff'・actor_id=スタッフ id・terminal_id=端末 id になる", async () => {
    const { org, token, staffId, terminalId } = await setup()
    await startSession(token, terminalId, { mode: 'personal', staffId, pin: STAFF_PIN })
    expect(await renameTerminal(token, terminalId, 1, 'レジ横iPad（個人）')).toBe(200)
    const updated = (await auditRowsOf(org)).filter((row) => row.action === 'terminal.updated')
    expect(only(updated)).toMatchObject({
      actor_type: 'staff',
      actor_id: staffId,
      terminal_id: terminalId,
    })
  })

  it("端末セッションが 1 本も無い経路（内部同期）は actor_type='system'・actor_id=null になる", async () => {
    const org = orgId()
    await syncOrganization({ id: org, name: 'EYEX', revision: 1 })
    await syncOrganization({ id: org, name: 'EYEX 銀座', revision: 2 })
    const rows = (await auditRowsOf(org)).filter((row) => row.target_type === 'organizations')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row).toMatchObject({ actor_type: 'system', actor_id: null, terminal_id: null })
    }
  })
})

describe('業務開始', () => {
  it('共有・個人どちらの開始でも terminal.session.started が 1 行だけ増える', async () => {
    const shared = await setup()
    await startSession(shared.token, shared.terminalId, { mode: 'shared', pin: SHARED_PIN })
    expect(
      (await auditRowsOf(shared.org)).filter((row) => row.action === 'terminal.session.started'),
    ).toHaveLength(1)

    const personal = await setup()
    await startSession(personal.token, personal.terminalId, {
      mode: 'personal',
      staffId: personal.staffId,
      pin: STAFF_PIN,
    })
    expect(
      (await auditRowsOf(personal.org)).filter((row) => row.action === 'terminal.session.started'),
    ).toHaveLength(1)
  })

  it('業務を終えると terminal.session.ended が増える', async () => {
    const { org, token, terminalId } = await setup()
    const started = await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    await SELF.fetch(
      `${BASE}/api/staff/terminals/${terminalId}/sessions/${String(started.body?.id)}`,
      { method: 'DELETE', headers: authed(token) },
    )
    const ended = (await auditRowsOf(org)).filter((row) => row.action === 'terminal.session.ended')
    expect(only(ended).target_id).toBe(String(started.body?.id))
  })

  it("置き場所の引き継ぎでは、失効した側に terminal.session.ended（after_json.reason='taken_over'）が残る", async () => {
    const { org, token, terminalId } = await setup()
    const first = await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    const ended = (await auditRowsOf(org)).filter((row) => row.action === 'terminal.session.ended')
    expect(only(ended).target_id).toBe(String(first.body?.id))
    expect(JSON.parse(only(ended).after_json ?? '{}')).toMatchObject({ reason: 'taken_over' })
  })
})

describe('暗証番号', () => {
  it('失敗すると terminal.pin.failed が増え、入力された番号もハッシュも残らない', async () => {
    const { org, token, staffId, terminalId } = await setup()
    await startSession(token, terminalId, { mode: 'personal', staffId, pin: '9999' })
    const failed = (await auditRowsOf(org)).filter((row) => row.action === 'terminal.pin.failed')
    // 残すのは端末 id と担当 id まで。入力された値は 1 文字も残さない。
    expect(only(failed)).toMatchObject({ terminal_id: terminalId, target_id: terminalId })
    const serialized = JSON.stringify(only(failed))
    expect(serialized).not.toContain('9999')
    expect(serialized).not.toContain('pin_hash')
    expect(serialized).not.toContain('pinHash')
    expect(serialized).toContain(staffId)
  })
})

describe('昇格', () => {
  it('MODE-PERSONAL の成功で terminal.mode.elevated が増える', async () => {
    const { org, token, staffId, terminalId } = await setup()
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    await elevate(token, terminalId, staffId, STAFF_PIN, 'recording')
    const rows = (await auditRowsOf(org)).filter((row) => row.action === 'terminal.mode.elevated')
    expect(only(rows)).toMatchObject({ actor_type: 'staff', actor_id: staffId })
  })

  it("EX-PERMISSION の店長 PIN も同じ action で、after_json.reason='settings_approval' で区別できる", async () => {
    const { org, token, staffId, terminalId } = await setup()
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    await elevate(token, terminalId, staffId, STAFF_PIN, 'settings')
    const rows = (await auditRowsOf(org)).filter((row) => row.action === 'terminal.mode.elevated')
    expect(JSON.parse(only(rows).after_json ?? '{}')).toMatchObject({
      reason: 'settings_approval',
    })
  })
})

describe('追記専用', () => {
  it('監査を書き換える経路が 1 本も無い（PATCH / PUT / DELETE がすべて 404）', async () => {
    const { org, token, terminalId } = await setup()
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    expect((await auditRowsOf(org)).length).toBeGreaterThan(0)
    const id = await env.DB.prepare('SELECT id FROM audit_events WHERE organization_id = ? LIMIT 1')
      .bind(org)
      .first<{ id: string }>()
    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const res = await SELF.fetch(`${BASE}/api/staff/audit/${id?.id}`, {
        method,
        headers: authed(token),
        ...(method === 'DELETE' ? {} : { body: JSON.stringify({ action: 'tampered' }) }),
      })
      expect(res.status).toBe(404)
    }
    const after = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM audit_events WHERE organization_id = ?',
    )
      .bind(org)
      .first<{ n: number }>()
    expect(after?.n).toBe((await auditRowsOf(org)).length)
  })

  it('伏せても（自動ロック）監査は 1 行も増えない', async () => {
    const { org, token, terminalId } = await setup()
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    const before = (await auditRowsOf(org)).length
    // 伏せているあいだは API を叩かない。「伏せた」を伝える経路そのものが無い。
    const res = await SELF.fetch(`${BASE}/api/staff/terminals/${terminalId}/mask`, {
      method: 'POST',
      headers: authed(token),
      body: JSON.stringify({ masked: true }),
    })
    expect(res.status).toBe(404)
    const rows = await auditRowsOf(org)
    expect(rows).toHaveLength(before)
    expect(rows.some((row) => row.action.includes('masked'))).toBe(false)
  })

  it('409 version_conflict になった PATCH では監査が 1 行も増えない', async () => {
    const { org, token, terminalId } = await setup()
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    expect(await renameTerminal(token, terminalId, 1, '新しい名前')).toBe(200)
    const before = await auditRowsOf(org)
    expect(await renameTerminal(token, terminalId, 1, 'さらに別の名前')).toBe(409)
    // ガードが外れていると、起きなかった操作の監査だけがここで 1 行増える。
    expect(await auditRowsOf(org)).toHaveLength(before.length)
  })
})

describe('変更前後', () => {
  it('端末名を変えると before_json と after_json に変わった項目だけが入る', async () => {
    const { org, token, terminalId } = await setup()
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    await renameTerminal(token, terminalId, 1, '銀座店 受付台iPad')
    const updated = only(
      (await auditRowsOf(org)).filter((row) => row.action === 'terminal.updated'),
    )
    expect(JSON.parse(updated.before_json ?? '{}')).toEqual({ name: '銀座店 レジ横iPad' })
    expect(JSON.parse(updated.after_json ?? '{}')).toEqual({ name: '銀座店 受付台iPad' })
  })

  it('before_json と after_json に pin も pin_hash も入らない', async () => {
    const { org, token, terminalId } = await setup()
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    const res = await SELF.fetch(`${BASE}/api/staff/terminals/${terminalId}`, {
      method: 'PATCH',
      headers: authed(token),
      body: JSON.stringify({ version: 1, name: '暗証番号も変える', pin: '5926' }),
    })
    expect(res.status).toBe(200)
    const serialized = JSON.stringify(await auditRowsOf(org))
    expect(serialized).not.toContain('5926')
    expect(serialized).not.toContain(SHARED_PIN)
    expect(serialized).not.toContain('pinHash')
    expect(serialized).not.toContain('pin_hash')
  })
})

describe('相関', () => {
  it('1 回の操作で出た複数行が同じ correlation_id を持つ', async () => {
    const { org, token, terminalId } = await setup()
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    // 引き継ぎは 1 操作で 2 行（前を終える + 新しく始める）を書く。
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    const rows = await auditRowsOf(org)
    const ended = rows.find((row) => row.action === 'terminal.session.ended')
    const started = rows.filter((row) => row.action === 'terminal.session.started')
    expect(started).toHaveLength(2)
    const [older, newer] = started as [AuditRow, AuditRow]
    expect(ended?.correlation_id).not.toBeNull()
    expect(ended?.correlation_id).toBe(newer.correlation_id)
    expect(older.correlation_id).not.toBe(newer.correlation_id)
  })
})

describe('読み取り', () => {
  it('GET /api/staff/audit は新しい順で、limit と cursor で続きが読める', async () => {
    const { org, token, storeId, terminalId } = await setup()
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    for (const [index, name] of ['名前 1', '名前 2', '名前 3'].entries()) {
      expect(await renameTerminal(token, terminalId, index + 1, name)).toBe(200)
    }
    const first = await SELF.fetch(
      `${BASE}/api/staff/audit?storeId=${storeId}&action=terminal.updated&limit=2`,
      { headers: authed(token) },
    )
    expect(first.status).toBe(200)
    const page1 = (await first.json()) as {
      items: Array<{ occurredAt: string; afterJson: { name?: string } }>
      nextCursor: string | null
      total: number
    }
    expect(page1.items).toHaveLength(2)
    expect(page1.total).toBe(3)
    expect(page1.items[0]?.afterJson.name).toBe('名前 3')
    expect(page1.nextCursor).not.toBeNull()

    const second = await SELF.fetch(
      `${BASE}/api/staff/audit?storeId=${storeId}&action=terminal.updated&limit=2&cursor=${encodeURIComponent(String(page1.nextCursor))}`,
      { headers: authed(token) },
    )
    const page2 = (await second.json()) as {
      items: Array<{ afterJson: { name?: string } }>
      nextCursor: string | null
    }
    expect(page2.items.map((item) => item.afterJson.name)).toEqual(['名前 1'])
    expect(page2.nextCursor).toBeNull()
    expect(JSON.stringify(page1)).not.toContain(org === '' ? 'never' : 'pin_hash')
  })

  it('監査を読んだこと自体は監査に残らない', async () => {
    const { org, token, storeId, terminalId } = await setup()
    await startSession(token, terminalId, { mode: 'shared', pin: SHARED_PIN })
    const before = (await auditRowsOf(org)).length
    for (const _ of [1, 2, 3]) {
      const res = await SELF.fetch(`${BASE}/api/staff/audit?storeId=${storeId}`, {
        headers: authed(token),
      })
      expect(res.status).toBe(200)
    }
    expect(await auditRowsOf(org)).toHaveLength(before)
  })
})
