/**
 * テナント分離（絶対ルール 6: 全 DB クエリを organization_id でスコープ）。
 *
 * foundation.integration.test.ts が代表フローを見るのに対し、ここは
 * 「他テナントのデータに手が届く経路が本当に無いか」を、複数テナント・
 * 偽装入力・組織の未同期／無効化の遷移で潰す。
 *
 * D1 はテストファイル内で共有されるので、組織 id は毎回ユニークに作る。
 */
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  authed,
  BASE,
  INTERNAL_HEADERS,
  JSON_HEADERS,
  orgId,
  syncOrganization,
  tokenFor,
} from './helpers'

const NOW = '2026-08-27T02:08:00.000Z'

/** 店舗を D1 へ直に置く（P0 には店舗の作成 API がまだ無い）。 */
async function seedStore(org: string, name: string, slug: string): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO stores (id, organization_id, name, slug, phone, address, access_note, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  )
    .bind(id, org, name, slug, '', '', '', '1', NOW)
    .run()
  return id
}

async function listStores(token: string) {
  const res = await SELF.fetch(`${BASE}/api/staff/stores`, { headers: authed(token) })
  return {
    status: res.status,
    stores: (await res.json().catch(() => [])) as Array<{ id: string; name: string }>,
  }
}

describe('複数テナントの相互不可視', () => {
  it('3 テナントが同時に店舗を持っても、各自の店舗しか見えない', async () => {
    const [a, b, c] = [orgId(), orgId(), orgId()]
    const [ta, tb, tc] = await Promise.all([tokenFor(a), tokenFor(b), tokenFor(c)])

    await seedStore(a, 'EYEX 銀座店', `ginza-${crypto.randomUUID().slice(0, 8)}`)
    await seedStore(a, 'EYEX 丸の内店', `marunouchi-${crypto.randomUUID().slice(0, 8)}`)
    await seedStore(b, 'B 新宿店', `shinjuku-${crypto.randomUUID().slice(0, 8)}`)
    await seedStore(c, 'C 渋谷店', `shibuya-${crypto.randomUUID().slice(0, 8)}`)

    const [ra, rb, rc] = await Promise.all([listStores(ta), listStores(tb), listStores(tc)])
    expect(ra.stores.map((s) => s.name).sort()).toEqual(['EYEX 丸の内店', 'EYEX 銀座店'])
    expect(rb.stores.map((s) => s.name)).toEqual(['B 新宿店'])
    expect(rc.stores.map((s) => s.name)).toEqual(['C 渋谷店'])
  })

  it('同じ slug を別テナントが使っても衝突せず、互いに見えない', async () => {
    const [a, b] = [orgId(), orgId()]
    const [ta, tb] = await Promise.all([tokenFor(a), tokenFor(b)])
    await seedStore(a, 'A の銀座店', 'ginza')
    await seedStore(b, 'B の銀座店', 'ginza')

    expect((await listStores(ta)).stores.map((s) => s.name)).toEqual(['A の銀座店'])
    expect((await listStores(tb)).stores.map((s) => s.name)).toEqual(['B の銀座店'])
  })
})

describe('入力による偽装が効かない', () => {
  it('クエリで他テナントの organizationId を指定しても自分の店舗しか返らない', async () => {
    const [a, b] = [orgId(), orgId()]
    const ta = await tokenFor(a)
    await tokenFor(b)
    await seedStore(a, 'A 店', `a-${crypto.randomUUID().slice(0, 8)}`)
    await seedStore(b, 'B 店', `b-${crypto.randomUUID().slice(0, 8)}`)

    const res = await SELF.fetch(
      `${BASE}/api/staff/stores?organizationId=${encodeURIComponent(b)}`,
      { headers: authed(ta) },
    )
    const stores = (await res.json()) as Array<{ name: string }>
    expect(stores.map((s) => s.name)).toEqual(['A 店'])
  })

  it('担当店舗の同期に他テナントの id を混ぜても、その organizationId のまま隔離される', async () => {
    const [a, b] = [orgId(), orgId()]
    const ta = await tokenFor(a)
    await tokenFor(b)
    const storeOfB = await seedStore(b, 'B 店', `b-${crypto.randomUUID().slice(0, 8)}`)

    const res = await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({
        id: crypto.randomUUID(),
        organizationId: b,
        storeId: storeOfB,
        userId: 'user-1',
        permissions: ['store.read'],
        createdAt: NOW,
      }),
    })
    expect(res.status).toBe(200)
    // A のトークンでは B の店舗は依然として見えない
    expect((await listStores(ta)).stores).toEqual([])
  })
})

describe('組織の同期状態による遷移', () => {
  it('未同期は 503（再試行できる）、同期後は 200、無効化で 403、再有効化で 200 に戻る', async () => {
    const org = orgId()
    // dev グラントを使わず、同期行が無い状態のトークンを作る
    const token = await tokenFor(orgId()).then(() => tokenFor(org))
    // dev グラントは同期行を作ってしまうので、いったん消してから未同期を確かめる
    await env.DB.prepare('DELETE FROM organizations WHERE id = ?').bind(org).run()

    expect((await listStores(token)).status).toBe(503)

    expect((await syncOrganization({ id: org, revision: 1 })).status).toBe(200)
    expect((await listStores(token)).status).toBe(200)

    expect((await syncOrganization({ id: org, isDisabled: true, revision: 2 })).status).toBe(200)
    expect((await listStores(token)).status).toBe(403)

    expect((await syncOrganization({ id: org, isDisabled: false, revision: 3 })).status).toBe(200)
    expect((await listStores(token)).status).toBe(200)
  })

  it('未同期の 503 と 無効化の 403 は取り違えない', async () => {
    const org = orgId()
    const token = await tokenFor(org)
    await env.DB.prepare('DELETE FROM organizations WHERE id = ?').bind(org).run()
    const missing = await SELF.fetch(`${BASE}/api/staff/stores`, { headers: authed(token) })
    expect(missing.status).toBe(503)
    expect(await missing.json()).toMatchObject({ error: 'not_synced' })

    await syncOrganization({ id: org, isDisabled: true, revision: 1 })
    const disabled = await SELF.fetch(`${BASE}/api/staff/stores`, { headers: authed(token) })
    expect(disabled.status).toBe(403)
    expect(await disabled.json()).toMatchObject({ error: 'org_disabled' })
  })
})

describe('内部 API は組織を越えて配れるが、業務 API は越えられない', () => {
  it('共有鍵の一覧は全組織を返す（admin の日次照合のため）', async () => {
    const org = orgId()
    await syncOrganization({ id: org, name: 'EYEX 照合用', revision: 1 })
    const res = await SELF.fetch(`${BASE}/api/internal/organizations`, {
      headers: INTERNAL_HEADERS,
    })
    const rows = (await res.json()) as Array<{ id: string }>
    expect(rows.some((r) => r.id === org)).toBe(true)
  })

  it('テナントのトークンではその一覧に触れない', async () => {
    const token = await tokenFor(orgId())
    const res = await SELF.fetch(`${BASE}/api/internal/organizations`, {
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })
})
