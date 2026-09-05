/**
 * 業務端末の入口（未認証）。
 *
 * ここで出してよいのは店名と置き場所の名前まで。スタッフの氏名・勤務・在席は
 * PIN を通したあとにしか出さない（設計 §2 制約 4）—— URL を知っているだけの人に
 * 「誰が何時に出勤しているか」を渡さないためである。
 *
 * 押しても入れない行き先も出さない。無効な端末、PIN 未設定の共有端末、
 * 持ち主が決まっていない個人端末は一覧に載せない。
 */
import { env, SELF } from 'cloudflare:test'
import { hashStretched, stretchPin } from '@app/shared'
import { describe, expect, it } from 'vitest'
import { BASE, FIXED_NOW, insertStaff, insertStore, orgId } from './helpers'

const PEPPER = 'dev-auth-pepper-change-me'

async function setSlug(storeId: string, slug: string): Promise<void> {
  await env.DB.prepare('UPDATE stores SET slug = ? WHERE id = ?').bind(slug, storeId).run()
}

async function insertTerminal(input: {
  org: string
  storeId: string
  name: string
  kind: 'shared' | 'personal'
  staffId?: string | null
  pin?: string | null
  isActive?: '0' | '1'
  placeNote?: string
}): Promise<string> {
  const id = crypto.randomUUID()
  // 端末 PIN の塩は端末 id。個人端末は持ち主の staff.pin_hash で照合するので持たない。
  const pinHash =
    input.pin === undefined || input.pin === null
      ? null
      : await hashStretched(await stretchPin(input.pin, input.org, id, 1), PEPPER)
  await env.DB.prepare(
    'INSERT INTO terminals (id, organization_id, store_id, name, kind, staff_id, place_note, device_label, pin_hash, auto_lock_seconds, last_seen_at, is_active, version, created_at) ' +
      "VALUES (?,?,?,?,?,?,?,'EYE-iPad-07',?,120,NULL,?,1,?)",
  )
    .bind(
      id,
      input.org,
      input.storeId,
      input.name,
      input.kind,
      input.staffId ?? null,
      input.placeNote ?? 'レジの右側',
      pinHash,
      input.isActive ?? '1',
      FIXED_NOW,
    )
    .run()
  return id
}

/** 個人端末の持ち主に PIN を持たせる（塩は staff id）。 */
async function setStaffPin(org: string, staffId: string, pin: string): Promise<void> {
  const hash = await hashStretched(await stretchPin(pin, org, staffId, 1), PEPPER)
  await env.DB.prepare('UPDATE staff SET pin_hash = ? WHERE organization_id = ? AND id = ?')
    .bind(hash, org, staffId)
    .run()
}

async function site() {
  const org = orgId()
  const slug = `ginza-${crypto.randomUUID().slice(0, 8)}`
  const storeId = await insertStore(org, 'EYE 銀座店')
  await setSlug(storeId, slug)
  const staffId = await insertStaff(org, storeId, { displayName: '佐藤 美咲' })
  await setStaffPin(org, staffId, '246810')

  const shared = await insertTerminal({
    org,
    storeId,
    name: '銀座店 レジ横iPad',
    kind: 'shared',
    pin: '135790',
  })
  const personal = await insertTerminal({
    org,
    storeId,
    name: '佐藤 美咲の iPad',
    kind: 'personal',
    staffId,
    pin: null,
  })
  const noPin = await insertTerminal({
    org,
    storeId,
    name: '暗証番号がまだの iPad',
    kind: 'shared',
    pin: null,
  })
  const inactive = await insertTerminal({
    org,
    storeId,
    name: '使わなくなった iPad',
    kind: 'shared',
    pin: '135790',
    isActive: '0',
  })
  const unassigned = await insertTerminal({
    org,
    storeId,
    name: '割り当て待ちの iPad',
    kind: 'personal',
    staffId: null,
    pin: null,
  })
  return { org, slug, storeId, staffId, shared, personal, noPin, inactive, unassigned }
}

describe('GET /api/public/sites/:storeSlug', () => {
  it('店名と置き場所を、認証なしで返す', async () => {
    const s = await site()
    const res = await SELF.fetch(`${BASE}/api/public/sites/${s.slug}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      store: { slug: string; name: string }
      terminals: { id: string; name: string; kind: string }[]
    }
    expect(body.store).toEqual({ slug: s.slug, name: 'EYE 銀座店' })
    expect(body.terminals.map((t) => t.id).sort()).toEqual([s.personal, s.shared].sort())
  })

  it('スタッフの氏名・勤務・在席をどこにも出さない', async () => {
    const s = await site()
    const res = await SELF.fetch(`${BASE}/api/public/sites/${s.slug}`)
    const text = await res.text()
    // 端末名（店長が付けた名前）は出るが、staff 表から引いた氏名や id は出さない。
    expect(text).not.toContain(s.staffId)
    expect(text).not.toContain('isOnline')
    expect(text).not.toContain('lastSeenAt')
    expect(text).not.toContain('shift')
  })

  it('押しても入れない行き先を出さない（PIN 未設定・無効・割り当て待ち）', async () => {
    const s = await site()
    const res = await SELF.fetch(`${BASE}/api/public/sites/${s.slug}`)
    const body = (await res.json()) as { terminals: { id: string }[] }
    const ids = body.terminals.map((t) => t.id)
    expect(ids).not.toContain(s.noPin)
    expect(ids).not.toContain(s.inactive)
    expect(ids).not.toContain(s.unassigned)
  })

  it('知らない slug は 404', async () => {
    const res = await SELF.fetch(`${BASE}/api/public/sites/no-such-store`)
    expect(res.status).toBe(404)
  })

  it('別テナントの端末が混ざらない', async () => {
    const a = await site()
    await site()
    const res = await SELF.fetch(`${BASE}/api/public/sites/${a.slug}`)
    const body = (await res.json()) as { terminals: { id: string }[] }
    for (const terminal of body.terminals) {
      const row = await env.DB.prepare('SELECT organization_id AS org FROM terminals WHERE id = ?')
        .bind(terminal.id)
        .first<{ org: string }>()
      expect(row?.org).toBe(a.org)
    }
  })
})

describe('POST /api/public/sites/:storeSlug/terminals/:terminalId/sessions', () => {
  const start = (slug: string, terminalId: string, body: unknown) =>
    SELF.fetch(`${BASE}/api/public/sites/${slug}/terminals/${terminalId}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('共有端末は正しい暗証番号でトークンと端末セッションを返す', async () => {
    const s = await site()
    const res = await start(s.slug, s.shared, { pin: '135790' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      token: string
      session: { mode: string; staffId: string | null; sessionToken: string }
    }
    expect(body.session.mode).toBe('shared')
    expect(body.session.staffId).toBeNull()
    const claims = JSON.parse(atob(body.token.split('.')[1] ?? '')) as Record<string, unknown>
    expect(claims.org).toBe(s.org)
    // 端末トークンだと名乗る。admin 側はこれを見て拒む。
    expect(claims.kind).toBe('terminal')
  })

  it('端末の資格情報を HttpOnly Cookie で返す', async () => {
    const s = await site()
    const res = await start(s.slug, s.shared, { pin: '135790' })
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('eye_device=')
    expect(cookie.toLowerCase()).toContain('httponly')
    expect(cookie.toLowerCase()).toContain('secure')
  })

  it('個人端末は紐づくスタッフの暗証番号で個人モードになる', async () => {
    const s = await site()
    const res = await start(s.slug, s.personal, { pin: '246810' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { session: { mode: string; staffId: string | null } }
    expect(body.session.mode).toBe('personal')
    expect(body.session.staffId).toBe(s.staffId)
  })

  /*
   * staffId をクライアントに名乗らせない。名乗れると、端末を選んだうえで
   * 相手だけ差し替えて他人の暗証番号を総当たりする経路になる。
   * `z.strictObject` は未知のキーを「無視」ではなく「拒否」する。
   */
  it('body に staffId を混ぜると 400 で拒む（無視ではない）', async () => {
    const s = await site()
    const res = await start(s.slug, s.personal, { pin: '246810', staffId: 'someone-else' })
    expect(res.status).toBe(400)
  })

  it('slug と端末の組が食い違うと 404（存在を漏らさない）', async () => {
    const a = await site()
    const b = await site()
    const res = await start(b.slug, a.shared, { pin: '135790' })
    expect(res.status).toBe(404)
  })

  it('持ち主が決まっていない個人端末は 404', async () => {
    const s = await site()
    const res = await start(s.slug, s.unassigned, { pin: '135790' })
    expect(res.status).toBe(404)
  })

  it('違う暗証番号は 401 と残り回数を返す', async () => {
    const s = await site()
    const res = await start(s.slug, s.shared, { pin: '999999' })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'pin_invalid', remainingAttempts: 2 })
  })

  it('発行するトークンの org は slug から引いた組織（入力は混ざらない）', async () => {
    const s = await site()
    const res = await start(s.slug, s.shared, { pin: '135790' })
    const body = (await res.json()) as { token: string }
    const claims = JSON.parse(atob(body.token.split('.')[1] ?? '')) as Record<string, unknown>
    expect(claims.org).toBe(s.org)
  })
})
