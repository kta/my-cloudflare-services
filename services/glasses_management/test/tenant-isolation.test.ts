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
  insertBusinessHours,
  insertReservation,
  insertShift,
  insertSlotRules,
  insertStaff,
  insertStore,
  insertVisitPurpose,
  JSON_HEADERS,
  jstAt,
  LEDGER_DATE,
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

  it('同じ店舗 id を持つ 2 テナントは作れないが、slug は全組織で先取り順になる', async () => {
    const [a, b] = [orgId(), orgId()]
    const [ta, tb] = await Promise.all([tokenFor(a), tokenFor(b)])
    const slug = `ginza-${crypto.randomUUID().slice(0, 8)}`
    await seedStore(a, 'A の銀座店', slug)

    // お客様向けの /w/:storeSlug は未認証で組織を知らないまま引くので、slug は
    // 全組織横断で一意。2 社目は同じ slug を取れない（取れない保存は画面が 400 で受ける）。
    await expect(seedStore(b, 'B の銀座店', slug)).rejects.toThrow()

    // id は UUID なので、先取りされるのは slug だけ。互いの店舗は依然として見えない。
    await seedStore(b, 'B の銀座店', `ginza-${crypto.randomUUID().slice(0, 8)}`)
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

/* ───────────────────────────────────────────────────────────────────────────
 * P1 店舗の受付条件
 * 6 面の読み書きに、他社・他店舗へ手が届く経路が無いことを潰す。
 * ─────────────────────────────────────────────────────────────────────────── */

/** 店長として入り、店舗 1 つを持つ組織を用意する。 */
async function managerOf(name = 'EYEX 銀座店') {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await seedStore(org, name, `store-${crypto.randomUUID().slice(0, 8)}`)
  await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      organizationId: org,
      storeId,
      userId: `dev:${org}`,
      permissions: ['settings.read', 'settings.manage'],
      createdAt: NOW,
    }),
  })
  return { org, token, storeId }
}

function callAs(token: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await SELF.fetch(`${BASE}${path}`, {
      method,
      headers: authed(token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: res.status, body: (await res.json().catch(() => null)) as never }
  }
}

const sevenRows = (opensAt: string, closesAt: string) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, isClosed: false, opensAt, closesAt }))

async function saveHours(token: string, storeId: string, opensAt: string, closesAt: string) {
  return callAs(token)('PUT', `/api/staff/stores/${storeId}/business-hours`, {
    rows: sevenRows(opensAt, closesAt),
    version: 1,
  })
}

async function addStaffMember(token: string, storeId: string, displayName: string) {
  const created = await callAs(token)('POST', `/api/staff/stores/${storeId}/staff`, {
    displayName,
  })
  return (created.body as { id: string }).id
}

async function addEquipmentUnit(token: string, storeId: string, name: string) {
  const created = await callAs(token)('POST', `/api/staff/stores/${storeId}/equipment`, {
    name,
    kind: 'measure',
    roleLabel: '視力測定',
  })
  return (created.body as { id: string }).id
}

async function addVisitPurpose(token: string, nameInternal: string, sortOrder: number) {
  const created = await callAs(token)('POST', '/api/staff/purposes', {
    nameInternal,
    namePublic: nameInternal,
    nameShort: '相談',
    durationMinutes: 30,
    sortOrder,
  })
  return (created.body as { id: string }).id
}

describe('受付条件は組織をまたがない', () => {
  it('3 テナントが同じ曜日に営業時間を持っても、各自の 7 行しか読めない', async () => {
    const [a, b, c] = await Promise.all([managerOf('A 店'), managerOf('B 店'), managerOf('C 店')])
    await saveHours(a.token, a.storeId, '10:00', '19:00')
    await saveHours(b.token, b.storeId, '11:00', '20:00')
    await saveHours(c.token, c.storeId, '09:00', '18:00')

    for (const [tenant, opensAt] of [
      [a, '10:00'],
      [b, '11:00'],
      [c, '09:00'],
    ] as const) {
      const read = await callAs(tenant.token)(
        'GET',
        `/api/staff/stores/${tenant.storeId}/business-hours`,
      )
      const rows = (read.body as { rows: { opensAt: string }[] }).rows
      expect(rows).toHaveLength(7)
      expect(rows.every((row) => row.opensAt === opensAt)).toBe(true)
    }
  })

  it('他テナントの storeId をパスに入れた設定の読み取りは 404 になる（403 で存在を漏らさない）', async () => {
    const [mine, theirs] = await Promise.all([managerOf(), managerOf()])
    await saveHours(theirs.token, theirs.storeId, '11:00', '20:00')

    const call = callAs(mine.token)
    expect((await call('GET', `/api/staff/stores/${theirs.storeId}`)).status).toBe(404)
    expect((await call('GET', `/api/staff/stores/${theirs.storeId}/business-hours`)).status).toBe(
      404,
    )
    expect((await call('GET', `/api/staff/stores/${theirs.storeId}/staff`)).status).toBe(404)
    expect((await call('GET', `/api/staff/stores/${theirs.storeId}/equipment`)).status).toBe(404)
  })

  it('他テナントの storeId をパスに入れた設定の保存は 404 になり、相手の行は 1 行も変わらない', async () => {
    const [mine, theirs] = await Promise.all([managerOf(), managerOf()])
    await saveHours(theirs.token, theirs.storeId, '11:00', '20:00')

    const intruded = await callAs(mine.token)(
      'PUT',
      `/api/staff/stores/${theirs.storeId}/business-hours`,
      { rows: sevenRows('06:00', '07:00'), version: 2 },
    )
    expect(intruded.status).toBe(404)

    const read = await callAs(theirs.token)(
      'GET',
      `/api/staff/stores/${theirs.storeId}/business-hours`,
    )
    const rows = (read.body as { rows: { opensAt: string }[] }).rows
    expect(rows.every((row) => row.opensAt === '11:00')).toBe(true)
  })

  it('本文に別テナントの organizationId を混ぜても、保存されるのは JWT の org である', async () => {
    const [mine, theirs] = await Promise.all([managerOf(), managerOf()])
    const call = callAs(mine.token)

    // 契約は strictObject なので、組織を名指しする本文はそもそも受け取らない。
    const forged = await call('POST', `/api/staff/stores/${mine.storeId}/equipment`, {
      name: '視力測定機 A',
      kind: 'measure',
      roleLabel: '視力測定',
      organizationId: theirs.org,
    })
    expect(forged.status).toBe(400)

    // 正しい本文で保存した行の organization_id は、本文ではなく JWT の org になる。
    const id = await addEquipmentUnit(mine.token, mine.storeId, '視力測定機 A')
    const saved = await env.DB.prepare('SELECT organization_id AS org FROM equipment WHERE id = ?')
      .bind(id)
      .first<{ org: string }>()
    expect(saved?.org).toBe(mine.org)
    expect(
      (await callAs(theirs.token)('GET', `/api/staff/stores/${theirs.storeId}/equipment`)).body,
    ).toEqual([])
  })

  it('他テナントのスタッフ id を staff-shifts の保存に混ぜると 404 になる', async () => {
    const [mine, theirs] = await Promise.all([managerOf(), managerOf()])
    const theirStaff = await addStaffMember(theirs.token, theirs.storeId, '高橋 健')

    const intruded = await callAs(mine.token)(
      'PUT',
      `/api/staff/stores/${mine.storeId}/staff-shifts`,
      {
        staffId: theirStaff,
        weekly: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          isOff: false,
          startsAt: '10:00',
          endsAt: '19:00',
          breaks: [],
        })),
        effectiveFrom: '2026-08-27',
        version: 1,
      },
    )
    expect(intruded.status).toBe(404)
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM staff_shifts WHERE staff_id = ?')
      .bind(theirStaff)
      .first<{ n: number }>()
    expect(rows?.n).toBe(0)
  })

  it('他テナントの目的 id を purposes/order に混ぜると 404 になり、自テナントの並び順も変わらない', async () => {
    const [mine, theirs] = await Promise.all([managerOf(), managerOf()])
    const first = await addVisitPurpose(mine.token, 'メガネを新しく作る', 0)
    const second = await addVisitPurpose(mine.token, '今のメガネを調整したい', 1)
    const theirPurpose = await addVisitPurpose(theirs.token, '修理・部品交換', 0)

    const intruded = await callAs(mine.token)('PUT', '/api/staff/purposes/order', {
      purposeIds: [second, theirPurpose, first],
    })
    expect(intruded.status).toBe(404)

    const listed = await callAs(mine.token)('GET', '/api/staff/purposes')
    expect((listed.body as { id: string }[]).map((purpose) => purpose.id)).toEqual([first, second])
  })

  it('他テナントの設備 id を点検の追加に混ぜると 404 になる', async () => {
    const [mine, theirs] = await Promise.all([managerOf(), managerOf()])
    const theirUnit = await addEquipmentUnit(theirs.token, theirs.storeId, '視力測定機 B')

    const intruded = await callAs(mine.token)(
      'POST',
      `/api/staff/stores/${mine.storeId}/equipment/${theirUnit}/maintenance`,
      { startsAt: '2026-08-28T01:00:00.000Z', endsAt: '2026-08-28T03:00:00.000Z' },
    )
    expect(intruded.status).toBe(404)
    const rows = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM equipment_maintenance WHERE equipment_id = ?',
    )
      .bind(theirUnit)
      .first<{ n: number }>()
    expect(rows?.n).toBe(0)
  })

  it('店舗をまたぐ読み取りは無い — 同じ組織の別店舗の営業時間は storeId を変えないと読めない', async () => {
    const mine = await managerOf('EYEX 銀座店')
    const another = await seedStore(
      mine.org,
      'EYEX 丸の内店',
      `marunouchi-${crypto.randomUUID().slice(0, 8)}`,
    )
    await saveHours(mine.token, mine.storeId, '10:00', '19:00')

    const other = await callAs(mine.token)('GET', `/api/staff/stores/${another}/business-hours`)
    // 同じ組織なので 404 にはならないが、銀座店の 7 行は 1 行も出てこない（定休として返る）。
    expect(other.status).toBe(200)
    const rows = (other.body as { rows: { isClosed: boolean }[] }).rows
    expect(rows.every((row) => row.isClosed)).toBe(true)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * P2 予約台帳と空き枠
 * 予約は API では作れない（`POST /api/staff/reservations` は P3）ので、
 * 他テナントの行は `env.DB` へ直に置く。**自分の店舗 id を持たせた他社の行**を
 * わざと作り、org で絞っていない経路が 1 本も無いことを確かめる。
 * ─────────────────────────────────────────────────────────────────────────── */

/** 台帳と空き枠を読める最小の店舗（営業時間・予約の間隔・担当・ご用件）を持つテナント。 */
async function ledgerTenant(name = 'EYEX 銀座店') {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await insertStore(org, name)
  await insertBusinessHours(org, storeId)
  await insertSlotRules(org, storeId)
  const staffId = await insertStaff(org, storeId, {
    displayName: '佐藤 美咲',
    skills: ['sales_reception'],
  })
  await insertShift(org, storeId, staffId)
  const purposeId = await insertVisitPurpose(org, storeId, {
    nameInternal: '今のメガネを調整したい',
    nameShort: '調整',
    durationMinutes: 20,
  })
  return { org, token, storeId, staffId, purposeId }
}

type LedgerBody = {
  lanes: { entries: { reservationId: string }[] }[]
  counts: { all: number; upcoming: number; pendingReview: number }
}
type AvailabilityBody = {
  slots: { startsAt: string; isAvailable: boolean; reason: string | null }[]
}

async function readLedger(token: string, storeId: string) {
  const res = await SELF.fetch(`${BASE}/api/staff/ledger?storeId=${storeId}&date=${LEDGER_DATE}`, {
    headers: authed(token),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as LedgerBody }
}

async function readAvailability(token: string, storeId: string, purposeId: string) {
  const res = await SELF.fetch(
    `${BASE}/api/staff/availability?storeId=${storeId}&date=${LEDGER_DATE}&purposeIds=${purposeId}`,
    { headers: authed(token) },
  )
  return { status: res.status, body: (await res.json().catch(() => null)) as AvailabilityBody }
}

/** 台帳に出ているご予約 id をすべて集める。 */
const drawnIds = (body: LedgerBody) =>
  body.lanes.flatMap((lane) => lane.entries.map((entry) => entry.reservationId))

describe('予約台帳と空き枠は組織をまたがない', () => {
  it('別テナントが自分の店舗 id を持つ予約を書いても、台帳の帯に 1 件も混ざらない', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const ours = await insertReservation(mine.org, {
      storeId: mine.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      staffId: mine.staffId,
      purposes: [{ id: mine.purposeId }],
    })
    // 他社の行に、こちらの店舗 id を持たせる（読み出しが org を落としていれば混ざる）。
    const intruder = await insertReservation(theirs.org, {
      storeId: mine.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:30'),
      staffId: null,
      purposes: [{ id: theirs.purposeId }],
    })

    const ledger = await readLedger(mine.token, mine.storeId)
    expect(ledger.status).toBe(200)
    expect(drawnIds(ledger.body)).toEqual([ours])
    expect(drawnIds(ledger.body)).not.toContain(intruder)
    expect(ledger.body.counts.all).toBe(1)
  })

  it('別テナントの予約は空き枠の塞がりに数えない（自分の 3 件は数える）', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const at11 = jstAt(LEDGER_DATE, '11:00')
    const slotAt11 = (body: AvailabilityBody) => body.slots.find((slot) => slot.startsAt === at11)

    // 同時受付上限は 3 件。他社の 3 件をこちらの店舗 id で書いても満席にならない。
    for (const _ of [0, 1, 2]) {
      await insertReservation(theirs.org, {
        storeId: mine.storeId,
        startsAt: at11,
        staffId: null,
        purposes: [{ id: theirs.purposeId }],
      })
    }
    const open = await readAvailability(mine.token, mine.storeId, mine.purposeId)
    expect(slotAt11(open.body)?.isAvailable).toBe(true)

    // 同じ 3 件を自分の組織で書くと満席になる（上の緑が「数えていない」ことの証拠になる）。
    for (const _ of [0, 1, 2]) {
      await insertReservation(mine.org, {
        storeId: mine.storeId,
        startsAt: at11,
        staffId: null,
        purposes: [{ id: mine.purposeId }],
      })
    }
    const full = await readAvailability(mine.token, mine.storeId, mine.purposeId)
    expect(slotAt11(full.body)?.isAvailable).toBe(false)
    expect(slotAt11(full.body)?.reason).toBe('max_parallel')
  })

  it('別テナントの storeId をクエリに渡しても 404 になる（403 で存在を漏らさない）', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    await insertReservation(theirs.org, {
      storeId: theirs.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      staffId: theirs.staffId,
      purposes: [{ id: theirs.purposeId }],
    })

    expect((await readLedger(mine.token, theirs.storeId)).status).toBe(404)
    expect((await readAvailability(mine.token, theirs.storeId, theirs.purposeId)).status).toBe(404)
    // 自分の店舗なら同じ形の要求が通る（落ちているのは店舗の持ち主だけである）。
    expect((await readLedger(mine.token, mine.storeId)).status).toBe(200)
  })

  it('別テナントのご予約 id は 404 を返す（403 で存在を漏らさない）', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const theirReservation = await insertReservation(theirs.org, {
      storeId: theirs.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      staffId: theirs.staffId,
      purposes: [{ id: theirs.purposeId }],
    })

    const intruded = await SELF.fetch(`${BASE}/api/staff/reservations/${theirReservation}`, {
      headers: authed(mine.token),
    })
    expect(intruded.status).toBe(404)
    expect(await intruded.json()).toMatchObject({ error: 'not_found' })

    // 持ち主が読めば 200。404 は「無い」ではなく「あなたのものではない」である。
    const owner = await SELF.fetch(`${BASE}/api/staff/reservations/${theirReservation}`, {
      headers: authed(theirs.token),
    })
    expect(owner.status).toBe(200)
  })

  it('3 テナントが同じ日に予約を持っても、各自の台帳しか見えない', async () => {
    const tenants = [
      await ledgerTenant('A 店'),
      await ledgerTenant('B 店'),
      await ledgerTenant('C 店'),
    ]
    const owned: string[][] = []
    for (const [index, tenant] of tenants.entries()) {
      const ids: string[] = []
      for (let n = 0; n <= index; n++) {
        ids.push(
          await insertReservation(tenant.org, {
            storeId: tenant.storeId,
            startsAt: jstAt(LEDGER_DATE, `1${n}:00`),
            staffId: tenant.staffId,
            purposes: [{ id: tenant.purposeId }],
          }),
        )
      }
      owned.push(ids)
    }

    for (const [index, tenant] of tenants.entries()) {
      const ledger = await readLedger(tenant.token, tenant.storeId)
      expect(drawnIds(ledger.body).sort()).toEqual([...(owned[index] ?? [])].sort())
      expect(ledger.body.counts.all).toBe(index + 1)
    }
  })
})
