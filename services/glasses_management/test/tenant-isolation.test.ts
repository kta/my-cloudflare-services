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

/* ───────────────────────────────────────────────────────────────────────────
 * P3 電話・店頭からの予約受付
 * 押さえ（KV）・受付セッション・冪等キーは、どれも**鍵に組織が入っている**ことだけで
 * 隔離が成り立っている。鍵の組み立てが 1 か所でも org を落とすと、他社の枠が塞がるか、
 * 他社の再送がこちらの応答を受け取る。ここはその 1 か所を潰しにいく。
 * ─────────────────────────────────────────────────────────────────────────── */

/** 仮の押さえを 1 本置く。 */
async function holdAs(
  token: string,
  input: { storeId: string; startsAt?: string; durationMinutes?: number },
) {
  const res = await SELF.fetch(`${BASE}/api/staff/holds`, {
    method: 'POST',
    headers: authed(token),
    body: JSON.stringify({
      storeId: input.storeId,
      startsAt: input.startsAt ?? jstAt(LEDGER_DATE, '11:00'),
      durationMinutes: input.durationMinutes ?? 60,
    }),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as { id: string } }
}

/** ご予約を 1 件確定する。 */
async function confirmAs(
  token: string,
  key: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: { id?: string; code?: string; error?: string } }> {
  const res = await SELF.fetch(`${BASE}/api/staff/reservations`, {
    method: 'POST',
    headers: { ...authed(token), 'idempotency-key': key },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as { id?: string } }
}

/** その組織が持つ行の数。 */
async function countOf(table: string, org: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE organization_id = ?`)
    .bind(org)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/** KV に置かれている押さえの鍵。 */
async function holdKeysOf(prefix: string): Promise<string[]> {
  return (await env.SHORT_LIVED.list({ prefix })).keys.map((key) => key.name)
}

describe('予約の受付は組織をまたがない', () => {
  it('他テナントの店舗 id で枠を押さえても、その組織の鍵空間にしか書かれない', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]

    // 押さえは表示のためだけの仕組みで、KV に CAS が無いので**常に 200** を返す
    // （店舗の実在を D1 に問い合わせない）。隔離は鍵の前置きだけで成り立つ。
    const held = await holdAs(mine.token, { storeId: theirs.storeId })
    expect(held.status).toBe(200)

    expect(await holdKeysOf(`hold:${mine.org}:${theirs.storeId}:`)).toEqual([
      `hold:${mine.org}:${theirs.storeId}:${held.body.id}`,
    ])
    // 相手の鍵空間には 1 本も入らない。相手の空き枠は 1 枠も塞がらない。
    expect(await holdKeysOf(`hold:${theirs.org}:`)).toEqual([])
  })

  it('他テナントの holdId を消そうとしても 404 で、相手の押さえは残る', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const held = await holdAs(theirs.token, { storeId: theirs.storeId })
    const prefix = `hold:${theirs.org}:${theirs.storeId}:`

    const intruded = await SELF.fetch(
      `${BASE}/api/staff/holds/${held.body.id}?storeId=${theirs.storeId}`,
      { method: 'DELETE', headers: authed(mine.token) },
    )
    expect(intruded.status).toBe(404)
    expect(await holdKeysOf(prefix)).toHaveLength(1)

    // 持ち主なら店舗を渡さなくても消せる（404 は「無い」ではなく「あなたのものではない」）。
    const owner = await SELF.fetch(`${BASE}/api/staff/holds/${held.body.id}`, {
      method: 'DELETE',
      headers: authed(theirs.token),
    })
    expect(owner.status).toBe(200)
    expect(await holdKeysOf(prefix)).toEqual([])
  })

  it('他テナントの receptionSessionId を指した確定は 404 で、予約はできない', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const started = await SELF.fetch(`${BASE}/api/staff/reception-sessions`, {
      method: 'POST',
      headers: authed(theirs.token),
      body: JSON.stringify({ storeId: theirs.storeId }),
    })
    const session = (await started.json()) as { id: string }

    const intruded = await confirmAs(mine.token, crypto.randomUUID(), {
      storeId: mine.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      purposeIds: [mine.purposeId],
      staffId: mine.staffId,
      source: 'phone',
      receptionSessionId: session.id,
    })
    expect(intruded.status).toBe(404)

    // 自分の側に予約は 1 件もできず、相手の受付は進行中のまま閉じられていない。
    expect(await countOf('reservations', mine.org)).toBe(0)
    const row = await env.DB.prepare(
      'SELECT outcome, reservation_id AS reservationId FROM reception_sessions WHERE id = ?',
    )
      .bind(session.id)
      .first<{ outcome: string | null; reservationId: string | null }>()
    expect(row?.outcome).toBeNull()
    expect(row?.reservationId).toBeNull()
  })

  it('同じ Idempotency-Key を 2 テナントが同時に使っても互いに衝突しない', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const key = crypto.randomUUID()
    const body = (tenant: { storeId: string; purposeId: string; staffId: string }) => ({
      storeId: tenant.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      purposeIds: [tenant.purposeId],
      staffId: tenant.staffId,
      source: 'phone',
    })

    const [a, b] = await Promise.all([
      confirmAs(mine.token, key, body(mine)),
      confirmAs(theirs.token, key, body(theirs)),
    ])
    expect([a.status, b.status]).toEqual([200, 200])

    // 主キーが `<組織>:<scope>:<鍵>` なので、同じヘッダーでも行が分かれる。
    // （前方が `%` の LIKE は D1 が `LIKE or GLOB pattern too complex` で断るので、
    // 組み立てた鍵をそのまま 2 本引く。)
    for (const org of [mine.org, theirs.org]) {
      const row = await env.DB.prepare(
        'SELECT status FROM idempotency_records WHERE key = ? AND organization_id = ?',
      )
        .bind(`${org}:reservation.create:${key}`, org)
        .first<{ status: string }>()
      expect(row?.status).toBe('done')
    }
    expect(await countOf('reservations', mine.org)).toBe(1)
    expect(await countOf('reservations', theirs.org)).toBe(1)
  })

  it('他テナントの予約 id で監査を引けない', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const created = await confirmAs(theirs.token, crypto.randomUUID(), {
      storeId: theirs.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      purposeIds: [theirs.purposeId],
      staffId: theirs.staffId,
      source: 'phone',
    })
    expect(created.status).toBe(200)

    const auditsFor = async (org: string): Promise<number> => {
      const row = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM audit_events WHERE organization_id = ? AND target_id = ?',
      )
        .bind(org, created.body.id)
        .first<{ n: number }>()
      return row?.n ?? 0
    }
    expect(await auditsFor(theirs.org)).toBe(1)
    // 監査は追記した組織の名前空間にしか無い。こちらの org で引くと 0 件である。
    expect(await auditsFor(mine.org)).toBe(0)

    // 監査を出す面（`GET /api/staff/reservations/:id/history`）は P10 が足すが、
    // その手前のご予約 1 件がすでに 404 なので、他テナントの id は経路に載らない。
    const intruded = await SELF.fetch(`${BASE}/api/staff/reservations/${created.body.id}`, {
      headers: authed(mine.token),
    })
    expect(intruded.status).toBe(404)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * P4 顧客台帳は組織をまたがない
 *
 * お客様の行は組織単位で 1 本なので、**店舗では絞らない**（他店で書かれた度数・
 * 手書き・履歴も同じ組織なら見せる）。境界はテナントだけであり、そこは
 * 3 テナント・偽装入力・R2 のキーの 3 方向から潰す。
 * ─────────────────────────────────────────────────────────────────────────── */

/** 顧客を D1 へ直に置く（他社の行は API から作れないので直に置くしかない）。 */
async function seedCustomer(
  org: string,
  seed: { name: string; kana?: string; phone?: string; customerNumber: string },
): Promise<string> {
  const id = crypto.randomUUID()
  const normalized = (seed.phone ?? '').replace(/\D/g, '')
  await env.DB.prepare(
    'INSERT INTO customers (id, organization_id, customer_number, name, kana, phone, phone_normalized, phone_last4, email, birth_date, address, memo, first_visit_at, last_visit_at, visit_count, merged_into_id, version, created_store_id, created_terminal_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,NULL,NULL,0,NULL,1,NULL,NULL,?,?)',
  )
    .bind(
      id,
      org,
      seed.customerNumber,
      seed.name,
      seed.kana ?? '',
      normalized === '' ? null : (seed.phone ?? null),
      normalized === '' ? null : normalized,
      normalized === '' ? null : normalized.slice(-4),
      '',
      NOW,
      NOW,
    )
    .run()
  return id
}

async function seedNote(org: string, customerId: string, storeId: string, body: string) {
  await env.DB.prepare(
    "INSERT INTO customer_notes (id, organization_id, customer_id, store_id, kind, body, handwriting_key, author_id, revision, status, created_at, updated_at) VALUES (?,?,?,?,'attention',?,NULL,NULL,1,'published',?,?)",
  )
    .bind(crypto.randomUUID(), org, customerId, storeId, body, NOW, NOW)
    .run()
}

describe('顧客台帳は組織をまたがない', () => {
  it('3 テナントが同じ電話番号のお客様を持っても、各自の 1 件しか出ない', async () => {
    const [a, b, c] = [await managerOf('A 店'), await managerOf('B 店'), await managerOf('C 店')]
    await seedCustomer(a.org, {
      name: 'A の田中',
      kana: 'たなか',
      phone: '090-1234-5678',
      customerNumber: 'G-01842',
    })
    await seedCustomer(b.org, {
      name: 'B の田中',
      kana: 'たなか',
      phone: '090-1234-5678',
      customerNumber: 'G-01842',
    })
    await seedCustomer(c.org, {
      name: 'C の田中',
      kana: 'たなか',
      phone: '090-1234-5678',
      customerNumber: 'G-01842',
    })

    for (const tenant of [a, b, c]) {
      const listed = await callAs(tenant.token)('GET', '/api/staff/customers?query=5678')
      const body = listed.body as unknown as { items: { name: string }[]; total: number }
      expect(body.total).toBe(1)
      expect(body.items).toHaveLength(1)
    }
    expect(
      (
        (await callAs(a.token)('GET', '/api/staff/customers?query=5678')).body as unknown as {
          items: { name: string }[]
        }
      ).items[0]?.name,
    ).toBe('A の田中')
  })

  it('他社のお客様 ID で詳細を開くと 404（403 にしない。存在の有無を漏らさない）', async () => {
    const [mine, theirs] = [await managerOf(), await managerOf('B 店')]
    const theirCustomer = await seedCustomer(theirs.org, {
      name: '他社の花子',
      customerNumber: 'G-02310',
    })
    const intruded = await callAs(mine.token)('GET', `/api/staff/customers/${theirCustomer}`)
    expect(intruded.status).toBe(404)
    expect(intruded.body).toMatchObject({ error: 'not_found' })
    expect(JSON.stringify(intruded.body)).not.toContain('他社の花子')
  })

  it('他社のお客様 ID を merge の primaryId に渡すと 404', async () => {
    const [mine, theirs] = [await managerOf(), await managerOf('B 店')]
    const theirCustomer = await seedCustomer(theirs.org, {
      name: '他社の花子',
      customerNumber: 'G-02311',
    })
    const ours = await seedCustomer(mine.org, { name: '自社の花子', customerNumber: 'G-01843' })

    const asPrimary = await callAs(mine.token)('POST', '/api/staff/customers/merge/preview', {
      primaryId: theirCustomer,
      secondaryId: ours,
    })
    expect(asPrimary.status).toBe(404)
    const asSecondary = await callAs(mine.token)('POST', '/api/staff/customers/merge/preview', {
      primaryId: ours,
      secondaryId: theirCustomer,
    })
    expect(asSecondary.status).toBe(404)
    const stillThere = await env.DB.prepare(
      'SELECT merged_into_id AS mergedIntoId FROM customers WHERE id = ?',
    )
      .bind(theirCustomer)
      .first<{ mergedIntoId: string | null }>()
    expect(stillThere?.mergedIntoId).toBeNull()
  })

  it('body に別テナントの organizationId を混ぜても、自分の org の行として作られる', async () => {
    const [mine, theirs] = [await managerOf(), await managerOf('B 店')]
    // 契約は strictObject なので、組織を名指しする本文はそもそも受け取らない。
    const forged = await callAs(mine.token)('POST', '/api/staff/customers', {
      name: '偽装 太郎',
      organizationId: theirs.org,
    })
    expect(forged.status).toBe(400)

    const created = await callAs(mine.token)('POST', '/api/staff/customers', { name: '正規 太郎' })
    expect(created.status).toBe(200)
    const saved = await env.DB.prepare('SELECT organization_id AS org FROM customers WHERE id = ?')
      .bind((created.body as unknown as { id: string }).id)
      .first<{ org: string }>()
    expect(saved?.org).toBe(mine.org)
    const theirList = await callAs(theirs.token)('GET', '/api/staff/customers')
    expect((theirList.body as unknown as { items: unknown[] }).items).toEqual([])
  })

  it('他社のお客様に付いたメモは一覧にも「注意ごと N件」にも出ない', async () => {
    const [mine, theirs] = [await managerOf(), await managerOf('B 店')]
    const theirCustomer = await seedCustomer(theirs.org, {
      name: '他社の花子',
      customerNumber: 'G-02312',
    })
    await seedNote(theirs.org, theirCustomer, theirs.storeId, '他社の注意ごと')
    const ours = await seedCustomer(mine.org, { name: '自社の花子', customerNumber: 'G-01844' })

    const notes = await callAs(mine.token)('GET', `/api/staff/customers/${ours}/notes`)
    expect(notes.status).toBe(200)
    expect(notes.body).toEqual([])
    const detail = await callAs(mine.token)('GET', `/api/staff/customers/${ours}`)
    expect((detail.body as unknown as { notes: unknown[] }).notes).toEqual([])
    // 他社の顧客 id を指したメモの一覧も 404（存在の有無を漏らさない）。
    const intruded = await callAs(mine.token)('GET', `/api/staff/customers/${theirCustomer}/notes`)
    expect(intruded.status).toBe(404)
  })

  it('他社のお客様番号（G-01842）で検索しても引けない', async () => {
    const [mine, theirs] = [await managerOf(), await managerOf('B 店')]
    await seedCustomer(theirs.org, {
      name: '他社の花子',
      kana: 'たなか はなこ',
      customerNumber: 'G-01842',
    })
    const listed = await callAs(mine.token)('GET', '/api/staff/customers?query=G-01842')
    expect((listed.body as unknown as { items: unknown[]; total: number }).total).toBe(0)
    const byName = await callAs(mine.token)(
      'GET',
      `/api/staff/customers?query=${encodeURIComponent('たなか')}`,
    )
    expect((byName.body as unknown as { items: unknown[] }).items).toEqual([])
  })

  it('下 4 桁の検索と候補の照会は、自分の org の中だけを走る', async () => {
    const [mine, theirs] = [await managerOf(), await managerOf('B 店')]
    await seedCustomer(theirs.org, {
      name: '他社の花子',
      phone: '090-1234-5678',
      customerNumber: 'G-02313',
    })
    const bySuffix = await callAs(mine.token)('GET', '/api/staff/customers?query=5678')
    expect((bySuffix.body as unknown as { total: number }).total).toBe(0)
    const lookedUp = await callAs(mine.token)(
      'GET',
      '/api/staff/customers/lookup?phone=09012345678',
    )
    expect(lookedUp.body).toEqual([])
  })

  it('ご予約の詳細が運ぶお名前は、他社の予約 id では 1 文字も返らない', async () => {
    // AC-CUST-25 で `ReservationDetail` がお客様を運ぶようになったので、
    // その 3 欄が他社のご予約から漏れないことを確かめる。
    const [mine, theirs] = [await managerOf(), await managerOf('B 店')]
    const theirCustomer = await seedCustomer(theirs.org, {
      name: '他社の花子',
      customerNumber: 'G-02315',
    })
    const theirReservation = crypto.randomUUID()
    await env.DB.prepare(
      "INSERT INTO reservations (id, organization_id, store_id, code, customer_id, source, status, starts_at, ends_at, duration_minutes, note_customer, note_internal, version, created_at, updated_at, created_by, cancelled_at, cancel_reason) VALUES (?,?,?,?,?,'phone','confirmed',?,?,30,'','',1,?,?,NULL,NULL,NULL)",
    )
      .bind(
        theirReservation,
        theirs.org,
        theirs.storeId,
        'EY-2608-9911',
        theirCustomer,
        '2026-08-27T02:00:00.000Z',
        '2026-08-27T02:30:00.000Z',
        NOW,
        NOW,
      )
      .run()

    const intruded = await callAs(mine.token)('GET', `/api/staff/reservations/${theirReservation}`)
    expect(intruded.status).toBe(404)
    expect(JSON.stringify(intruded.body)).not.toContain('他社の花子')
  })

  it('手書きの R2 キーは organizationId を含み、他社のキーは読めない', async () => {
    const [mine, theirs] = [await managerOf(), await managerOf('B 店')]
    const ours = await seedCustomer(mine.org, { name: '自社の花子', customerNumber: 'G-01845' })
    const theirCustomer = await seedCustomer(theirs.org, {
      name: '他社の花子',
      customerNumber: 'G-02314',
    })

    const svg =
      '<svg viewBox="0 0 600 400"><path d="M10 10 L100 90" stroke="#1b3a2f" stroke-width="3" fill="none"/></svg>'
    const created = await callAs(mine.token)('POST', `/api/staff/customers/${ours}/notes`, {
      kind: 'memo',
      storeId: mine.storeId,
      handwritingSvg: svg,
    })
    expect(created.status).toBe(200)
    const noteId = (created.body as unknown as { id: string }).id
    const key = await env.DB.prepare(
      'SELECT handwriting_key AS handwritingKey FROM customer_notes WHERE id = ?',
    )
      .bind(noteId)
      .first<{ handwritingKey: string }>()
    expect(key?.handwritingKey).toBe(`notes/${mine.org}/${ours}/${noteId}.svg`)
    expect(key?.handwritingKey).not.toContain(theirs.org)

    // 他社のお客様にぶら下げようとしても、その顧客 id はこちらには無い。
    const intruded = await callAs(mine.token)(
      'POST',
      `/api/staff/customers/${theirCustomer}/notes`,
      { kind: 'memo', storeId: mine.storeId, handwritingSvg: svg },
    )
    expect(intruded.status).toBe(404)
    const objects = await env.RECORDINGS.list({ prefix: `notes/${theirs.org}/` })
    expect(objects.objects).toEqual([])
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * P5 来店受付とウォークイン
 * 受付は**お客様を特定しないまま**始まるので、行を結び直せる手がかりは
 * 整理番号と id しか無い。整理番号は店舗 × 来店日で 1 から採り直すため、
 * 他社の行を巻き込んで数えるとその日の採番が丸ごとずれる。
 * 店舗をまたぐ閲覧は作らない（`design/09-open-questions.md` Q-04 のいまの前提）ので、
 * `storeId` は絞り込みにだけ使い、**認可の根拠にしない**。
 * ─────────────────────────────────────────────────────────────────────────── */

/** 店頭のお客様を 1 名受け付ける。 */
async function walkinAs(
  token: string,
  input: { storeId: string; time?: string; staffId?: string | null },
) {
  const time = input.time ?? '11:02'
  const res = await SELF.fetch(`${BASE}/api/staff/walkins`, {
    method: 'POST',
    headers: authed(token),
    body: JSON.stringify({
      storeId: input.storeId,
      purposeNote: 'フレームの相談',
      arrivedAt: jstAt(LEDGER_DATE, time),
      startsAt: jstAt(LEDGER_DATE, `${time.slice(0, 3)}00`),
      durationMinutes: 20,
      staffId: input.staffId ?? null,
    }),
  })
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as {
      id?: string
      ticketNo?: number
      version?: number
      reservationId?: string
    },
  }
}

describe('来店受付は組織をまたがない', () => {
  it('3 テナントが同時に受け付けても、整理番号は各自の店舗で 1 から始まる', async () => {
    const tenants = [
      await ledgerTenant('A 銀座店'),
      await ledgerTenant('B 新宿店'),
      await ledgerTenant('C 渋谷店'),
    ]
    const received = await Promise.all(
      tenants.map((tenant) => walkinAs(tenant.token, { storeId: tenant.storeId })),
    )
    expect(received.map((one) => one.status)).toEqual([200, 200, 200])
    expect(received.map((one) => one.body.ticketNo)).toEqual([1, 1, 1])

    // 2 人目もそれぞれの店舗で 2 番になる（他社の行を数えていない証拠）。
    for (const tenant of tenants) {
      const second = await walkinAs(tenant.token, { storeId: tenant.storeId, time: '11:34' })
      expect(second.body.ticketNo).toBe(2)
    }
  })

  it('他テナントのウォークイン id を PATCH しても 404 で、存在の有無も返らない', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const received = await walkinAs(theirs.token, { storeId: theirs.storeId })
    expect(received.status).toBe(200)

    const intruded = await callAs(mine.token)('PATCH', `/api/staff/walkins/${received.body.id}`, {
      version: received.body.version,
      status: 'left',
    })
    expect(intruded.status).toBe(404)
    // 相手の行は 1 つも動いていない（版も状態もそのまま）。
    const row = await env.DB.prepare(
      'SELECT status, version FROM walk_ins WHERE organization_id = ? AND id = ?',
    )
      .bind(theirs.org, received.body.id)
      .first<{ status: string; version: number }>()
    expect(row).toMatchObject({ status: 'waiting', version: received.body.version })
  })

  it('body に他テナントの organizationId を混ぜても自分のテナントの行にしか書かれない', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const res = await SELF.fetch(`${BASE}/api/staff/walkins`, {
      method: 'POST',
      headers: authed(mine.token),
      body: JSON.stringify({
        organizationId: theirs.org,
        storeId: mine.storeId,
        purposeNote: 'フレームの相談',
        arrivedAt: jstAt(LEDGER_DATE, '11:02'),
        durationMinutes: 20,
        staffId: null,
      }),
    })
    // 知らないキーは契約が落とす（`z.strictObject`）。通る場合も JWT の org に書く。
    expect([200, 400]).toContain(res.status)
    expect(await countOf('walk_ins', theirs.org)).toBe(0)
  })

  it('他テナントの subjectId で工程を進めようとしても 404', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const received = await walkinAs(theirs.token, { storeId: theirs.storeId })

    const intruded = await callAs(mine.token)('POST', '/api/staff/visits', {
      storeId: mine.storeId,
      subjectType: 'walkin',
      subjectId: received.body.id,
      stage: 'consulting',
      occurredAt: jstAt(LEDGER_DATE, '11:05'),
    })
    expect(intruded.status).toBe(404)
    expect(await countOf('visit_events', mine.org)).toBe(0)
    expect(await countOf('visit_events', theirs.org)).toBe(0)
  })

  it('他テナントの担当を工程の記録に混ぜても 404 で、1 行も残らない', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const received = await walkinAs(mine.token, { storeId: mine.storeId })

    const intruded = await callAs(mine.token)('POST', '/api/staff/visits', {
      storeId: mine.storeId,
      subjectType: 'walkin',
      subjectId: received.body.id,
      stage: 'consulting',
      staffId: theirs.staffId,
      occurredAt: jstAt(LEDGER_DATE, '11:05'),
    })
    expect(intruded.status).toBe(404)
    expect(await countOf('visit_events', mine.org)).toBe(0)
  })

  it('他テナントのご予約へ付け替える PATCH は 404 で、ウォークインの版も動かない', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const ours = await walkinAs(mine.token, { storeId: mine.storeId })
    const theirWalkin = await walkinAs(theirs.token, { storeId: theirs.storeId })

    const intruded = await callAs(mine.token)('PATCH', `/api/staff/walkins/${ours.body.id}`, {
      version: ours.body.version,
      reservationId: theirWalkin.body.reservationId,
    })
    expect(intruded.status).toBe(404)
    const row = await env.DB.prepare(
      'SELECT reservation_id AS reservationId, version FROM walk_ins WHERE organization_id = ? AND id = ?',
    )
      .bind(mine.org, ours.body.id)
      .first<{ reservationId: string; version: number }>()
    expect(row).toMatchObject({
      reservationId: ours.body.reservationId,
      version: ours.body.version,
    })
  })

  it('他テナントの受付履歴は期間を広げても 1 件も出ない', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const received = await walkinAs(theirs.token, { storeId: theirs.storeId })

    const history = await callAs(mine.token)(
      'GET',
      `/api/staff/reception-sessions?from=2026-08-01&to=${LEDGER_DATE}`,
    )
    expect(history.status).toBe(200)
    const body = history.body as unknown as {
      items: { entryId: string }[]
      total: number
    }
    expect(body.items.map((entry) => entry.entryId)).not.toContain(received.body.reservationId)
    expect(body.total).toBe(0)
  })

  it('来店受付ボードは他テナントの storeId を渡しても空を返す', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    await walkinAs(theirs.token, { storeId: theirs.storeId })

    const board = await callAs(mine.token)(
      'GET',
      `/api/staff/visits/board?storeId=${theirs.storeId}&date=${LEDGER_DATE}`,
    )
    expect(board.status).toBe(200)
    const body = board.body as unknown as { rows: unknown[]; activeCount: number }
    expect(body.rows).toEqual([])
    expect(body.activeCount).toBe(0)
  })

  it('他テナントのご予約を「ご来店がなかった」として残そうとしても 404 で、状態は動かない', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const reservationId = await insertReservation(theirs.org, {
      storeId: theirs.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      durationMinutes: 30,
      staffId: null,
    })

    const denied = await callAs(mine.token)(
      'POST',
      `/api/staff/reservations/${reservationId}/cancel`,
      { version: 1, reason: 'no_show' },
    )
    // 403 にしない（存在の有無を漏らさない）。
    expect(denied.status).toBe(404)

    const row = await env.DB.prepare(
      'SELECT status, version FROM reservations WHERE organization_id = ? AND id = ?',
    )
      .bind(theirs.org, reservationId)
      .first<{ status: string; version: number }>()
    expect(row).toMatchObject({ status: 'confirmed', version: 1 })
  })

  it('未同期は 503、無効化は 403（受付の 7 ルートでも取り違えない）', async () => {
    const tenant = await ledgerTenant()
    const paths = [
      `/api/staff/walkins?storeId=${tenant.storeId}&date=${LEDGER_DATE}`,
      `/api/staff/visits/board?storeId=${tenant.storeId}&date=${LEDGER_DATE}`,
      `/api/staff/reception-sessions?from=${LEDGER_DATE}&to=${LEDGER_DATE}`,
    ]

    await env.DB.prepare('DELETE FROM organizations WHERE id = ?').bind(tenant.org).run()
    for (const path of paths) {
      const missing = await callAs(tenant.token)('GET', path)
      expect(missing.status).toBe(503)
      expect(missing.body).toMatchObject({ error: 'not_synced' })
    }

    await syncOrganization({ id: tenant.org, isDisabled: true, revision: 1 })
    for (const path of paths) {
      const disabled = await callAs(tenant.token)('GET', path)
      expect(disabled.status).toBe(403)
      expect(disabled.body).toMatchObject({ error: 'org_disabled' })
    }
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * P6 予約の検索・変更・取消
 * 4 ルート（検索・変更・取消・経緯）はどれも `reservationId` か `storeId` を
 * 外から受け取る。**他社の id を指した要求は「無い」（404）**にして、存在の有無も
 * 漏らさない。検索は選択中店舗にも固定するので、同じ組織の別店舗も結果に出ない。
 * ─────────────────────────────────────────────────────────────────────────── */

/** お客様を 1 人置いて、そのご予約に結ぶ（検索がお名前で当たるようにする）。 */
let isolationCustomerSeq = 0
async function seedCustomerFor(org: string, reservationId: string, name: string): Promise<void> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO customers (id, organization_id, customer_number, name, kana, phone, phone_normalized, phone_last4, email, birth_date, address, memo, first_visit_at, last_visit_at, visit_count, merged_into_id, version, created_store_id, created_terminal_id, created_at, updated_at) ' +
      "VALUES (?,?,?,?,'たなか はなこ','090-1234-5678','09012345678','5678',NULL,NULL,NULL,'',NULL,NULL,0,NULL,1,NULL,NULL,?,?)",
  )
    .bind(id, org, `G-${String(90000 + ++isolationCustomerSeq)}`, name, NOW, NOW)
    .run()
  await env.DB.prepare(
    'UPDATE reservations SET customer_id = ? WHERE organization_id = ? AND id = ?',
  )
    .bind(id, org, reservationId)
    .run()
}

type SearchResult = { items: { id: string }[]; total: number }

async function searchByName(token: string, storeId: string, name: string) {
  const query = new URLSearchParams({ storeId, name })
  const found = await callAs(token)('GET', `/api/staff/reservations?${query.toString()}`)
  return { status: found.status, body: found.body as unknown as SearchResult }
}

async function lockCountOf(org: string, reservationId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ?',
  )
    .bind(org, reservationId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

describe('予約の検索・変更・取消は組織をまたがない', () => {
  it('3 テナントが同じお名前のご予約を持っても、自分のご予約しか検索に出ない', async () => {
    const [a, b, c] = [
      await ledgerTenant('A 銀座店'),
      await ledgerTenant('B 銀座店'),
      await ledgerTenant('C 銀座店'),
    ]
    const seeded: Record<string, string> = {}
    for (const tenant of [a, b, c]) {
      const reservationId = await insertReservation(tenant.org, {
        storeId: tenant.storeId,
        startsAt: jstAt(LEDGER_DATE, '11:00'),
        staffId: tenant.staffId,
        purposes: [{ id: tenant.purposeId }],
      })
      await seedCustomerFor(tenant.org, reservationId, '田中 花子')
      seeded[tenant.org] = reservationId
    }

    for (const tenant of [a, b, c]) {
      const found = await searchByName(tenant.token, tenant.storeId, '田中')
      expect(found.status).toBe(200)
      expect(found.body.items.map((item) => item.id)).toEqual([seeded[tenant.org]])
      expect(found.body.total).toBe(1)
    }
  })

  it('他テナントの reservationId を URL に入れて変更しても 404 で、相手の行は 1 行も変わらない', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const reservationId = await insertReservation(theirs.org, {
      storeId: theirs.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      staffId: theirs.staffId,
      purposes: [{ id: theirs.purposeId }],
      slotLocks: true,
    })

    const denied = await callAs(mine.token)('PATCH', `/api/staff/reservations/${reservationId}`, {
      version: 1,
      startsAt: jstAt(LEDGER_DATE, '14:00'),
    })
    // 403 にしない（存在の有無を漏らさない）。
    expect(denied.status).toBe(404)

    const row = await env.DB.prepare(
      'SELECT starts_at AS startsAt, version FROM reservations WHERE organization_id = ? AND id = ?',
    )
      .bind(theirs.org, reservationId)
      .first<{ startsAt: string; version: number }>()
    expect(row).toMatchObject({ startsAt: jstAt(LEDGER_DATE, '11:00'), version: 1 })
  })

  it('他テナントの reservationId を取り消しても 404 で、相手の枠のロックが消えない', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const reservationId = await insertReservation(theirs.org, {
      storeId: theirs.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      staffId: theirs.staffId,
      purposes: [{ id: theirs.purposeId }],
      slotLocks: true,
    })
    const before = await lockCountOf(theirs.org, reservationId)
    expect(before).toBeGreaterThan(0)

    const denied = await callAs(mine.token)(
      'POST',
      `/api/staff/reservations/${reservationId}/cancel`,
      { version: 1, reason: 'customer' },
    )
    expect(denied.status).toBe(404)
    expect(await lockCountOf(theirs.org, reservationId)).toBe(before)
  })

  it('他テナントの reservationId の経緯は 404 になる', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const reservationId = await insertReservation(theirs.org, {
      storeId: theirs.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      staffId: theirs.staffId,
      purposes: [{ id: theirs.purposeId }],
    })

    const denied = await callAs(mine.token)(
      'GET',
      `/api/staff/reservations/${reservationId}/history`,
    )
    expect(denied.status).toBe(404)
    expect(denied.body).toMatchObject({ error: 'not_found' })
  })

  it('クエリに他テナントの organizationId を混ぜても自分のご予約しか返らない', async () => {
    const [mine, theirs] = [await ledgerTenant(), await ledgerTenant('B 店')]
    const theirReservation = await insertReservation(theirs.org, {
      storeId: theirs.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      staffId: theirs.staffId,
      purposes: [{ id: theirs.purposeId }],
    })
    await seedCustomerFor(theirs.org, theirReservation, '田中 花子')
    const myReservation = await insertReservation(mine.org, {
      storeId: mine.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:30'),
      staffId: mine.staffId,
      purposes: [{ id: mine.purposeId }],
    })
    await seedCustomerFor(mine.org, myReservation, '田中 花子')

    // 契約は `z.strictObject` なので、知らないキーはそもそも通らない（400）。
    // 組織は JWT の `org` だけが決め、クエリからは決して来ない。
    const spoofed = new URLSearchParams({
      storeId: mine.storeId,
      name: '田中',
      organizationId: theirs.org,
    })
    const rejected = await callAs(mine.token)(
      'GET',
      `/api/staff/reservations?${spoofed.toString()}`,
    )
    expect(rejected.status).toBe(400)

    // 同じ条件から偽装だけ抜くと、自分のご予約だけが返る。
    const found = await searchByName(mine.token, mine.storeId, '田中')
    expect(found.body.items.map((item) => item.id)).toEqual([myReservation])
    expect(found.body.items.map((item) => item.id)).not.toContain(theirReservation)
  })

  it('別の店舗の reservationId は、同じ組織でも選択中店舗の外なら結果に出ない', async () => {
    // Q-04 のいまの前提。別店舗のご予約は見せない（押せない導線を置かない）。
    const mine = await ledgerTenant()
    const another = await insertStore(mine.org, 'EYEX 丸の内店')
    await insertBusinessHours(mine.org, another)
    await insertSlotRules(mine.org, another)
    const here = await insertReservation(mine.org, {
      storeId: mine.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      staffId: mine.staffId,
      purposes: [{ id: mine.purposeId }],
    })
    await seedCustomerFor(mine.org, here, '田中 花子')
    const there = await insertReservation(mine.org, {
      storeId: another,
      startsAt: jstAt(LEDGER_DATE, '14:00'),
      staffId: null,
      purposes: [{ id: mine.purposeId }],
    })
    await seedCustomerFor(mine.org, there, '田中 太郎')

    const found = await searchByName(mine.token, mine.storeId, '田中')
    expect(found.body.items.map((item) => item.id)).toEqual([here])
    expect(found.body.items.map((item) => item.id)).not.toContain(there)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 受付の録音（P7）
 *
 * 録音はお客様の声そのものである。組織で漏れると取り返しが付かないので、
 * 「読めない」だけでなく **存在の有無すら漏れない**（404）ところまで潰す。
 * 権限の有無ではなく組織で落ちることを見たいので、どちらのテナントにも
 * `recording.read` と `recording.manage` を配ったうえで確かめる。
 * ─────────────────────────────────────────────────────────────────────────── */

/** 録音を持てるテナント。再生も保全もできる権限を最初から配る。 */
async function recordingTenant(name = 'EYEX 銀座店') {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await insertStore(org, name)
  await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      organizationId: org,
      storeId,
      userId: `dev:${org}`,
      permissions: ['recording.read', 'recording.manage'],
      createdAt: NOW,
    }),
  })
  return { org, token, storeId }
}

/** 保管済みの録音 1 本。行と保管庫の実体を直に置く（開始の API は別のテストが見る）。 */
async function seedRecording(
  tenant: { org: string; storeId: string },
  input: { code: string; retainUntil?: string },
): Promise<{ id: string; key: string }> {
  const id = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  const key = `recordings/${tenant.org}/${tenant.storeId}/2026/08/${id}.m4a`
  await env.DB.prepare(
    'INSERT INTO reception_sessions (id, organization_id, store_id, reservation_id, terminal_id, actor_id, started_at, ended_at, outcome, draft_json, created_at) VALUES (?,?,?,NULL,NULL,NULL,?,NULL,?,NULL,?)',
  )
    .bind(sessionId, tenant.org, tenant.storeId, NOW, 'discarded', NOW)
    .run()
  await env.DB.prepare(
    'INSERT INTO recordings (id, organization_id, store_id, code, reception_session_id, reservation_id, r2_key, content_type, duration_seconds, bytes, state, retain_until, legal_hold, upload_attempts, created_at, updated_at, deleted_at) ' +
      "VALUES (?,?,?,?,?,NULL,?,'audio/mp4',192,4,'stored',?,'0',0,?,?,NULL)",
  )
    .bind(
      id,
      tenant.org,
      tenant.storeId,
      input.code,
      sessionId,
      key,
      input.retainUntil ?? '2026-09-30T00:00:00.000Z',
      NOW,
      NOW,
    )
    .run()
  await env.RECORDINGS.put(key, new Uint8Array([1, 2, 3, 4]))
  return { id, key }
}

type RecordingListBody = { items: { id: string; code: string }[]; total: number }

async function listRecordings(token: string, storeId: string) {
  const res = await SELF.fetch(`${BASE}/api/staff/recordings?storeId=${storeId}`, {
    headers: authed(token),
  })
  return { status: res.status, body: (await res.json()) as never as RecordingListBody }
}

describe('録音は組織をまたがない', () => {
  it('3 テナントが同時に録音を持っても、各自の録音しか一覧に出ない', async () => {
    const [a, b, c] = [
      await recordingTenant('A 店'),
      await recordingTenant('B 店'),
      await recordingTenant('C 店'),
    ]
    await seedRecording(a, { code: 'EY-R-0001' })
    await seedRecording(a, { code: 'EY-R-0002' })
    await seedRecording(b, { code: 'EY-R-0001' })
    await seedRecording(c, { code: 'EY-R-0001' })

    const [ra, rb, rc] = await Promise.all([
      listRecordings(a.token, a.storeId),
      listRecordings(b.token, b.storeId),
      listRecordings(c.token, c.storeId),
    ])
    // 録音番号は組織で通しなので、3 社が同じ `EY-R-0001` を持てる。
    expect(ra.body.total).toBe(2)
    expect(rb.body.total).toBe(1)
    expect(rc.body.total).toBe(1)
  })

  it('他テナントの録音 id を直接指しても 404 で、存在の有無すら漏れない', async () => {
    const [mine, theirs] = [await recordingTenant(), await recordingTenant('B 店')]
    const target = await seedRecording(theirs, { code: 'EY-R-0001' })

    const call = callAs(mine.token)
    for (const [method, path] of [
      ['POST', `/api/staff/recordings/${target.id}/playback`],
      ['POST', `/api/staff/recordings/${target.id}/retry`],
      ['PATCH', `/api/staff/recordings/${target.id}`],
    ] as const) {
      const denied = await call(method, path, method === 'PATCH' ? { state: 'failed' } : undefined)
      expect(denied.status).toBe(404)
      expect(denied.body).toMatchObject({ error: 'not_found' })
    }
  })

  it('他テナントで発行した再生チケットは、こちらの stream では通らない', async () => {
    const [mine, theirs] = [await recordingTenant(), await recordingTenant('B 店')]
    const target = await seedRecording(theirs, { code: 'EY-R-0001' })
    const issued = await callAs(theirs.token)('POST', `/api/staff/recordings/${target.id}/playback`)
    expect(issued.status).toBe(200)
    const token = (issued.body as never as { token: string }).token

    // チケットは `play:<orgId>:<token>` に置く。org が違えば鍵そのものが見つからない。
    const stolen = await SELF.fetch(
      `${BASE}/api/staff/recordings/${target.id}/stream?token=${token}`,
      { headers: authed(mine.token) },
    )
    expect([401, 404]).toContain(stolen.status)

    const own = await SELF.fetch(
      `${BASE}/api/staff/recordings/${target.id}/stream?token=${token}`,
      { headers: authed(theirs.token) },
    )
    expect(own.status).toBe(200)
  })

  it('他テナントの録音に保全を立てられない', async () => {
    const [mine, theirs] = [await recordingTenant(), await recordingTenant('B 店')]
    const target = await seedRecording(theirs, { code: 'EY-R-0001' })

    const denied = await callAs(mine.token)('POST', `/api/staff/recordings/${target.id}/hold`, {
      legalHold: true,
      reason: '他社の録音を止めたい',
    })
    expect(denied.status).toBe(404)
    const row = await env.DB.prepare('SELECT legal_hold AS legalHold FROM recordings WHERE id = ?')
      .bind(target.id)
      .first<{ legalHold: string }>()
    expect(row?.legalHold).toBe('0')
  })

  it('他テナントの録音を削除できない', async () => {
    const [mine, theirs] = [await recordingTenant(), await recordingTenant('B 店')]
    const target = await seedRecording(theirs, {
      code: 'EY-R-0001',
      retainUntil: '2020-01-01T00:00:00.000Z',
    })

    const denied = await callAs(mine.token)('DELETE', `/api/staff/recordings/${target.id}`)
    expect(denied.status).toBe(404)
    // 実体も行も動いていない（期限は過ぎているので、組織で落ちた証拠になる）。
    expect(await env.RECORDINGS.head(target.key)).not.toBeNull()
    const row = await env.DB.prepare('SELECT state FROM recordings WHERE id = ?')
      .bind(target.id)
      .first<{ state: string }>()
    expect(row?.state).toBe('stored')
  })

  it('クエリに他テナントの organizationId を混ぜても自分の録音しか返らない', async () => {
    const [mine, theirs] = [await recordingTenant(), await recordingTenant('B 店')]
    const theirRecording = await seedRecording(theirs, { code: 'EY-R-0001' })
    const myRecording = await seedRecording(mine, { code: 'EY-R-0001' })

    // 契約は `z.strictObject` なので、知らないキーはそもそも通らない（400）。
    const spoofed = new URLSearchParams({
      storeId: mine.storeId,
      organizationId: theirs.org,
    })
    const rejected = await callAs(mine.token)('GET', `/api/staff/recordings?${spoofed.toString()}`)
    expect(rejected.status).toBe(400)

    const found = await listRecordings(mine.token, mine.storeId)
    expect(found.body.items.map((item) => item.id)).toEqual([myRecording.id])
    expect(found.body.items.map((item) => item.id)).not.toContain(theirRecording.id)
  })

  it('権限外の店舗の録音は、同じ組織でも聞けず一覧にも出ない', async () => {
    // Q-03 のいまの前提。`recording.read` は担当している店舗にだけ効く。
    const mine = await recordingTenant()
    const another = await insertStore(mine.org, 'EYEX 丸の内店')
    const outside = await seedRecording({ org: mine.org, storeId: another }, { code: 'EY-R-0002' })
    const here = await seedRecording(mine, { code: 'EY-R-0001' })

    const denied = await callAs(mine.token)('POST', `/api/staff/recordings/${outside.id}/playback`)
    expect(denied.status).toBe(404)

    const found = await listRecordings(mine.token, mine.storeId)
    expect(found.body.items.map((item) => item.id)).toEqual([here.id])
  })

  it('保守の掃除は組織をまたいで他テナントの録音を消さない', async () => {
    const [mine, theirs] = [await recordingTenant(), await recordingTenant('B 店')]
    const expired = await seedRecording(mine, {
      code: 'EY-R-0001',
      retainUntil: '2026-08-01T00:00:00.000Z',
    })
    const alsoExpired = await seedRecording(theirs, {
      code: 'EY-R-0001',
      retainUntil: '2026-08-01T00:00:00.000Z',
    })

    // 掃除は組織を指定せずに走る 1 本だが、消すのは行が指すキーだけである。
    // 両方が期限切れなら両方が消えるのが正しく、**片方だけを消す条件を持たない**。
    // ここで見たいのは「A の掃除が B の実体を巻き込まない」なので、B は保全で残す。
    await callAs(theirs.token)('POST', `/api/staff/recordings/${alsoExpired.id}/hold`, {
      legalHold: true,
      reason: '照会に備えるため',
    })
    const res = await SELF.fetch(`${BASE}/api/internal/maintenance/recordings/purge`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ now: '2026-08-27T02:08:00.000Z', limit: 500 }),
    })
    expect(res.status).toBe(200)

    expect(await env.RECORDINGS.head(expired.key)).toBeNull()
    expect(await env.RECORDINGS.head(alsoExpired.key)).not.toBeNull()
  })

  it('alerts も組織で絞られ、他テナントのお知らせが混ざらない', async () => {
    const [mine, theirs] = [await recordingTenant(), await recordingTenant('B 店')]
    const seedAlert = async (tenant: { org: string; storeId: string }, title: string) => {
      await env.DB.prepare(
        "INSERT INTO alerts (id, organization_id, store_id, code, severity, audience, title, body, target_type, target_id, occurred_at, read_at, resolved_at, resolved_by, created_at) VALUES (?,?,?,'recording.upload_failed','action','store',?,NULL,NULL,NULL,?,NULL,NULL,NULL,?)",
      )
        .bind(crypto.randomUUID(), tenant.org, tenant.storeId, title, NOW, NOW)
        .run()
    }
    await seedAlert(mine, 'A のお知らせ')
    await seedAlert(theirs, 'B のお知らせ')

    const listed = await callAs(mine.token)('GET', `/api/staff/alerts?storeId=${mine.storeId}`)
    expect(listed.status).toBe(200)
    const items = (listed.body as never as { items: { title: string }[] }).items
    expect(items.map((item) => item.title)).toEqual(['A のお知らせ'])
  })
})
