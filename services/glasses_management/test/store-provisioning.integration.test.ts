/**
 * お店の登録（`POST /api/staff/stores`）。
 *
 * 新しい会社はここを通らないと何も始められない。店舗の設定は担当店舗の権限で
 * 守られ、その権限は店舗が無いと持てないため、**この 1 本だけは会社のロールで
 * 判断する**。その例外が他社へ漏れないこと、登録した本人がその場で続けられること、
 * 作った直後に空き枠が出ることを、ここで固定する。
 */
import { env, SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { authed, BASE, JSON_HEADERS, orgId, syncOrganization, tokenFor } from './helpers'

const ORG = orgId()
const OTHER_ORG = orgId()

let adminToken = ''
let staffToken = ''
let otherAdminToken = ''

/** 合い言葉はテスト間で衝突しないよう毎回変える（全組織横断で一意なため）。 */
const uniqueSlug = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().slice(0, 8)}`.toLowerCase()

async function createStore(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await SELF.fetch(`${BASE}/api/staff/stores`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...authed(token) },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as never }
}

beforeAll(async () => {
  await syncOrganization({ id: ORG })
  await syncOrganization({ id: OTHER_ORG })
  adminToken = await tokenFor(ORG, 'admin')
  staffToken = await tokenFor(ORG, 'staff')
  otherAdminToken = await tokenFor(OTHER_ORG, 'admin')
})

describe('POST /api/staff/stores', () => {
  it('会社の管理者は担当店舗を持たなくても最初のお店を登録できる', async () => {
    const slug = uniqueSlug('first')
    const created = await createStore(adminToken, { name: '銀座店', slug })

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      organizationId: ORG,
      name: '銀座店',
      slug,
      isActive: true,
    })
    expect(typeof created.body?.id).toBe('string')
  })

  it('登録したお店は自分の会社の一覧に出る', async () => {
    const slug = uniqueSlug('listed')
    const created = await createStore(adminToken, { name: '丸の内店', slug })
    const res = await SELF.fetch(`${BASE}/api/staff/stores`, { headers: authed(adminToken) })
    const list = (await res.json()) as Array<{ id: string }>

    expect(res.status).toBe(200)
    expect(list.map((s) => s.id)).toContain(created.body?.id)
  })

  it('任意の項目を渡せば店舗に入る', async () => {
    const created = await createStore(adminToken, {
      name: '新宿店',
      slug: uniqueSlug('detail'),
      phone: '03-1234-5678',
      address: '東京都新宿区1-1-1',
      accessNote: '新宿駅東口から徒歩3分',
    })

    expect(created.body).toMatchObject({
      phone: '03-1234-5678',
      address: '東京都新宿区1-1-1',
      accessNote: '新宿駅東口から徒歩3分',
    })
  })

  it('既定の営業時間が 7 曜日ぶん入り、日曜だけ定休になる', async () => {
    const created = await createStore(adminToken, { name: '既定時間店', slug: uniqueSlug('hours') })
    const storeId = created.body?.id as string
    const res = await SELF.fetch(`${BASE}/api/staff/stores/${storeId}/business-hours`, {
      headers: authed(adminToken),
    })
    const body = (await res.json()) as {
      rows: Array<{ weekday: number; isClosed: boolean; opensAt: string | null }>
    }

    expect(res.status).toBe(200)
    expect(body.rows).toHaveLength(7)
    expect(body.rows.find((h) => h.weekday === 0)?.isClosed).toBe(true)
    expect(body.rows.find((h) => h.weekday === 1)).toMatchObject({
      isClosed: false,
      opensAt: '10:00',
    })
  })

  it('既定の予約の間隔が入る（刻み 30 / 片付け 10 / 同時 3）', async () => {
    const created = await createStore(adminToken, { name: '既定枠店', slug: uniqueSlug('slot') })
    const storeId = created.body?.id as string
    const res = await SELF.fetch(`${BASE}/api/staff/stores/${storeId}/slot-rules`, {
      headers: authed(adminToken),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      slotMinutes: 30,
      cleanupMinutes: 10,
      maxParallel: 3,
    })
  })

  it('既定のご来店の目的が 3 件入る', async () => {
    const created = await createStore(adminToken, {
      name: '既定目的店',
      slug: uniqueSlug('purpose'),
    })
    const storeId = created.body?.id as string
    const res = await SELF.fetch(`${BASE}/api/staff/purposes?storeId=${storeId}`, {
      headers: authed(adminToken),
    })
    const list = (await res.json()) as Array<{ nameInternal: string; isActive: boolean }>

    expect(res.status).toBe(200)
    expect(list).toHaveLength(3)
    expect(list.map((p) => p.nameInternal)).toEqual([
      'メガネを新しく作る',
      '調整・修理',
      'その他のご相談',
    ])
  })

  it('登録した本人はその場でお店の設定を保存できる', async () => {
    const created = await createStore(adminToken, {
      name: '続けて設定店',
      slug: uniqueSlug('cont'),
    })
    const storeId = created.body?.id as string
    const res = await SELF.fetch(`${BASE}/api/staff/stores/${storeId}`, {
      method: 'PATCH',
      headers: { ...JSON_HEADERS, ...authed(adminToken) },
      // 設定の版は登録時に 1 で置かれる。保存が通るということは、
      // 登録した本人に settings.manage が渡っているということ。
      body: JSON.stringify({ phone: '03-0000-0000', version: 1 }),
    })

    expect(res.status).toBe(200)
  })

  it('同じ合い言葉は二度使えない', async () => {
    const slug = uniqueSlug('dup')
    await createStore(adminToken, { name: '先に取る店', slug })
    const second = await createStore(adminToken, { name: '後から来る店', slug })

    expect(second.status).toBe(409)
    expect(second.body).toEqual({ error: 'store_slug_taken', slug })
  })

  it('他社が使っている合い言葉も使えない（全組織横断で一意）', async () => {
    const slug = uniqueSlug('cross')
    const mine = await createStore(adminToken, { name: '自社の店', slug })
    expect(mine.status).toBe(201)

    const theirs = await createStore(otherAdminToken, { name: '他社の店', slug })
    expect(theirs.status).toBe(409)
    // どの会社が使っているかは返さない。
    expect(theirs.body).toEqual({ error: 'store_slug_taken', slug })
  })

  it('使えない文字の合い言葉は断る', async () => {
    for (const slug of ['Ginza', 'ginza_main', '銀座', '-ginza', 'ginza-', 'g']) {
      const res = await createStore(adminToken, { name: '合い言葉が変な店', slug })
      expect(res.status).toBe(400)
    }
  })

  it('店名が空なら断る', async () => {
    expect((await createStore(adminToken, { name: '   ', slug: uniqueSlug('blank') })).status).toBe(
      400,
    )
  })

  it('会社の管理者でない店員は登録できない', async () => {
    const before = await SELF.fetch(`${BASE}/api/staff/stores`, { headers: authed(adminToken) })
    const countBefore = ((await before.json()) as unknown[]).length

    const res = await createStore(staffToken, { name: '店員が作る店', slug: uniqueSlug('staff') })
    expect(res.status).toBe(403)

    const after = await SELF.fetch(`${BASE}/api/staff/stores`, { headers: authed(adminToken) })
    expect(((await after.json()) as unknown[]).length).toBe(countBefore)
  })

  it('未認証では登録できない', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/stores`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: '名無しの店', slug: uniqueSlug('anon') }),
    })
    expect(res.status).toBe(401)
  })

  it('本文に会社 id を入れても受け取らない（偽装の経路を作らない）', async () => {
    const res = await createStore(adminToken, {
      name: '偽装する店',
      slug: uniqueSlug('spoof'),
      organizationId: OTHER_ORG,
    })
    expect(res.status).toBe(400)
  })

  it('他社のお店は一覧に出ない', async () => {
    const mine = await createStore(adminToken, { name: '自社', slug: uniqueSlug('mine') })
    const theirs = await createStore(otherAdminToken, { name: '他社', slug: uniqueSlug('theirs') })

    const res = await SELF.fetch(`${BASE}/api/staff/stores`, { headers: authed(adminToken) })
    const ids = ((await res.json()) as Array<{ id: string }>).map((s) => s.id)

    expect(ids).toContain(mine.body?.id)
    expect(ids).not.toContain(theirs.body?.id)
  })

  it('登録した記録が監査に残る', async () => {
    const created = await createStore(adminToken, {
      name: '監査に残る店',
      slug: uniqueSlug('audit'),
    })
    const storeId = created.body?.id as string

    const row = await env.DB.prepare(
      'SELECT action, target_type AS targetType, target_id AS targetId, organization_id AS organizationId FROM audit_events WHERE target_id = ? AND action = ?',
    )
      .bind(storeId, 'store.created')
      .first<{ action: string; targetType: string; targetId: string; organizationId: string }>()

    expect(row).toMatchObject({
      action: 'store.created',
      targetType: 'stores',
      targetId: storeId,
      organizationId: ORG,
    })
  })

  it('止められた会社では登録できない', async () => {
    const disabled = orgId()
    await syncOrganization({ id: disabled })
    const token = await tokenFor(disabled, 'admin')
    await syncOrganization({ id: disabled, isDisabled: true, revision: 1 })

    const res = await createStore(token, { name: '止まった会社の店', slug: uniqueSlug('disabled') })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/internal/stores', () => {
  it('内部キーがあれば会社のお店を返す', async () => {
    const created = await createStore(adminToken, { name: '内部照会店', slug: uniqueSlug('intl') })
    const res = await SELF.fetch(`${BASE}/api/internal/stores?organizationId=${ORG}`, {
      headers: { 'x-internal-key': 'dev-internal-key' },
    })
    const list = (await res.json()) as Array<{ id: string; name: string }>

    expect(res.status).toBe(200)
    expect(list.map((s) => s.id)).toContain(created.body?.id)
  })

  it('内部キーが無ければ拒む', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/stores?organizationId=${ORG}`)
    expect(res.status).toBe(401)
  })

  it('会社を指定しなければ断る（全社の店舗を返さない）', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/stores`, {
      headers: { 'x-internal-key': 'dev-internal-key' },
    })
    expect(res.status).toBe(400)
  })

  it('他社を指定してもその会社のぶんだけを返す', async () => {
    const mine = await createStore(adminToken, { name: '自社2', slug: uniqueSlug('m2') })
    const res = await SELF.fetch(`${BASE}/api/internal/stores?organizationId=${OTHER_ORG}`, {
      headers: { 'x-internal-key': 'dev-internal-key' },
    })
    const ids = ((await res.json()) as Array<{ id: string }>).map((s) => s.id)

    expect(ids).not.toContain(mine.body?.id)
  })
})
