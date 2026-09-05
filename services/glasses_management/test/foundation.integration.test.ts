/**
 * P0（基盤）の代表フロー。admin から届く組織・担当店舗の同期と、店舗一覧。
 * 境界値の網羅は permissions.test.ts / tenant-isolation.test.ts / sync.time.test.ts に分ける。
 */
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { authed, BASE, INTERNAL_HEADERS, orgId, syncOrganization, tokenFor } from './helpers'

const NOW = '2026-08-27T02:08:00.000Z'

describe('ヘルスチェック', () => {
  it('認証なしで ok を返す', async () => {
    const res = await SELF.fetch(`${BASE}/api/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})

describe('組織の同期', () => {
  it('初回は挿入し、受け取った内容をそのまま返す', async () => {
    const org = orgId()
    const { status, body } = await syncOrganization({
      id: org,
      name: 'EYE',
      plan: 'contracted',
      revision: 1,
    })
    expect(status).toBe(200)
    expect(body).toMatchObject({ id: org, name: 'EYE', plan: 'contracted', revision: 1 })
  })

  it('同じ id への再送で名前とプランが収束する', async () => {
    const org = orgId()
    await syncOrganization({ id: org, name: '旧名', plan: 'free', revision: 1 })
    const { body } = await syncOrganization({
      id: org,
      name: '新名',
      plan: 'contracted',
      revision: 2,
    })
    expect(body).toMatchObject({ name: '新名', plan: 'contracted', revision: 2 })

    const listed = (await (
      await SELF.fetch(`${BASE}/api/internal/organizations`, { headers: INTERNAL_HEADERS })
    ).json()) as Array<{ id: string; name: string; revision: number }>
    expect(listed.find((r) => r.id === org)).toMatchObject({ name: '新名', revision: 2 })
  })

  it('古い revision の配信は現在値を返して無視する（巻き戻さない）', async () => {
    const org = orgId()
    await syncOrganization({ id: org, name: '新しい名前', revision: 5 })
    const { status, body } = await syncOrganization({ id: org, name: '古い名前', revision: 3 })
    expect(status).toBe(200)
    expect(body).toMatchObject({ name: '新しい名前', revision: 5 })
  })

  it('同じ revision の再送は受け入れる（再送は冪等）', async () => {
    const org = orgId()
    await syncOrganization({ id: org, name: '名前', revision: 4 })
    const { body } = await syncOrganization({ id: org, name: '名前', revision: 4 })
    expect(body).toMatchObject({ name: '名前', revision: 4 })
  })

  it('知らないキーが混ざった配信は 400 で落とす', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({
        id: orgId(),
        name: 'EYE',
        plan: 'free',
        isDisabled: false,
        createdAt: NOW,
        revision: 1,
        legacyField: 'x',
      }),
    })
    expect(res.status).toBe(400)
  })
})

describe('担当店舗の同期', () => {
  it('配られた membership を保存し、そのまま返す', async () => {
    const org = orgId()
    await syncOrganization({ id: org, revision: 1 })
    const id = crypto.randomUUID()
    const storeId = crypto.randomUUID()
    const res = await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({
        id,
        organizationId: org,
        storeId,
        userId: 'user-1',
        permissions: ['store.read', 'reservation.read'],
        createdAt: NOW,
      }),
    })
    expect(res.status).toBe(200)
    const saved = await env.DB.prepare('SELECT permissions FROM store_memberships WHERE id = ?')
      .bind(id)
      .first<{ permissions: string }>()
    expect(saved?.permissions).toBe('store.read reservation.read')
  })

  it('担当解除は permissions が空の配信として届き、行は消えない', async () => {
    const org = orgId()
    await syncOrganization({ id: org, revision: 1 })
    const id = crypto.randomUUID()
    const storeId = crypto.randomUUID()
    const payload = {
      id,
      organizationId: org,
      storeId,
      userId: 'user-2',
      createdAt: NOW,
    }
    await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ ...payload, permissions: ['store.manage'] }),
    })
    const res = await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ ...payload, permissions: [] }),
    })
    expect(res.status).toBe(200)
    const saved = await env.DB.prepare('SELECT permissions FROM store_memberships WHERE id = ?')
      .bind(id)
      .first<{ permissions: string }>()
    expect(saved?.permissions).toBe('')
  })

  it('同じ組織・利用者・店舗が別IDで再同期されても1行へ収束する', async () => {
    const org = orgId()
    await syncOrganization({ id: org, revision: 1 })
    const storeId = crypto.randomUUID()
    const firstId = crypto.randomUUID()
    const latestId = crypto.randomUUID()
    const base = {
      organizationId: org,
      storeId,
      userId: 'user-reassigned',
      createdAt: NOW,
    }
    await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ id: firstId, ...base, permissions: ['store.read'] }),
    })
    const response = await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ id: latestId, ...base, permissions: ['terminal.manage'] }),
    })
    expect(response.status).toBe(200)
    const rows = await env.DB.prepare(
      'SELECT id, permissions FROM store_memberships WHERE organization_id = ? AND user_id = ? AND store_id = ?',
    )
      .bind(org, base.userId, storeId)
      .all<{ id: string; permissions: string }>()
    expect(rows.results).toEqual([{ id: latestId, permissions: 'terminal.manage' }])
  })

  it('許可リストに無い権限は 400 で落とす（fail close）', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({
        id: crypto.randomUUID(),
        organizationId: orgId(),
        storeId: crypto.randomUUID(),
        userId: 'user-3',
        permissions: ['store.destroy'],
        createdAt: NOW,
      }),
    })
    expect(res.status).toBe(400)
  })
})

describe('列が無かった頃の行の読み方', () => {
  it('plan / is_disabled / revision が NULL の行は free・有効・revision 0 として読む', async () => {
    const org = orgId()
    await env.DB.prepare(
      'INSERT INTO organizations (id, name, plan, is_disabled, created_at, revision) VALUES (?,?,NULL,NULL,?,NULL)',
    )
      .bind(org, '旧い行', NOW)
      .run()

    const listed = (await (
      await SELF.fetch(`${BASE}/api/internal/organizations`, { headers: INTERNAL_HEADERS })
    ).json()) as Array<{ id: string; plan: string; isDisabled: boolean; revision: number }>
    expect(listed.find((r) => r.id === org)).toMatchObject({
      plan: 'free',
      isDisabled: false,
      revision: 0,
    })
  })

  it('revision が NULL の行へは、どの revision の配信でも適用できる', async () => {
    const org = orgId()
    await env.DB.prepare(
      'INSERT INTO organizations (id, name, plan, is_disabled, created_at, revision) VALUES (?,?,NULL,NULL,?,NULL)',
    )
      .bind(org, '旧い行', NOW)
      .run()
    const { body } = await syncOrganization({ id: org, name: '新しい名前', revision: 1 })
    expect(body).toMatchObject({ name: '新しい名前', revision: 1 })
  })
})

describe('dev トークングラント', () => {
  it('AUTH_DEV_GRANT が立っていなければ 404（本番では開かない）', async () => {
    const previous = env.AUTH_DEV_GRANT
    env.AUTH_DEV_GRANT = 'false'
    try {
      const res = await SELF.fetch(`${BASE}/api/auth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId(), role: 'staff' }),
      })
      expect(res.status).toBe(404)
    } finally {
      env.AUTH_DEV_GRANT = previous
    }
  })
})

describe('店舗一覧', () => {
  it('作成の古い順に返し、契約どおりの形になっている', async () => {
    const org = orgId()
    const token = await tokenFor(org)
    const first = crypto.randomUUID()
    const second = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO stores (id, organization_id, name, slug, phone, address, access_note, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        first,
        org,
        'EYE 銀座店',
        'ginza',
        '03-1234-5678',
        '東京都中央区銀座',
        '銀座駅 A1 出口',
        '1',
        '2026-08-01T00:00:00.000Z',
      )
      .run()
    await env.DB.prepare(
      'INSERT INTO stores (id, organization_id, name, slug, phone, address, access_note, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    )
      .bind(second, org, 'EYE 丸の内店', 'marunouchi', '', '', '', '0', '2026-08-02T00:00:00.000Z')
      .run()

    const res = await SELF.fetch(`${BASE}/api/staff/stores`, { headers: authed(token) })
    expect(res.status).toBe(200)
    const rows = (await res.json()) as Array<Record<string, unknown>>
    expect(rows.map((r) => r.slug)).toEqual(['ginza', 'marunouchi'])
    expect(rows[0]).toMatchObject({
      name: 'EYE 銀座店',
      phone: '03-1234-5678',
      accessNote: '銀座駅 A1 出口',
      isActive: true,
    })
    expect(rows[1]).toMatchObject({ isActive: false })
  })

  it('店舗が 1 つも無ければ空配列を返す', async () => {
    const token = await tokenFor(orgId())
    const res = await SELF.fetch(`${BASE}/api/staff/stores`, { headers: authed(token) })
    expect(await res.json()).toEqual([])
  })
})
