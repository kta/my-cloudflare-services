/**
 * P1（店舗の受付条件）の代表フロー。6 面の読み書きと、版が合わないときに
 * **1 行も書き換わらない**ことを固定する。
 *
 * 境界値の網羅は `store-settings.time.test.ts` / `settings-impact.time.test.ts` に、
 * 権限の表は `permissions.test.ts` に、越境は `tenant-isolation.test.ts` に分ける。
 * ここが見るのは「保存が通るか」「通ったとき何が変わり、落ちたとき何が変わらないか」だけである。
 *
 * D1 はテストファイル内で共有されるので、組織 id は `orgId()`、店舗・スタッフ・設備の id は
 * `crypto.randomUUID()` で毎回作る。
 */
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { expandShiftWindow } from '../src/worker/index'
import { authed, BASE, INTERNAL_HEADERS, orgId, tokenFor } from './helpers'

const NOW = '2026-08-27T02:08:00.000Z'
/** 銀座店の並びに合わせた曜日の代表値（0=日 … 6=土）。 */
const THURSDAY = 4

/* --- 器を作る ------------------------------------------------------------ */

async function seedStore(org: string, name = 'EYE 銀座店'): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO stores (id, organization_id, name, slug, phone, address, access_note, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  )
    .bind(id, org, name, `ginza-${crypto.randomUUID().slice(0, 8)}`, '', '', '', '1', NOW)
    .run()
  return id
}

/** admin からの担当店舗配信を模す。`permissions` を空白区切りで持つ 1 行になる。 */
async function grant(org: string, storeId: string, userId: string, permissions: string[]) {
  await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      organizationId: org,
      storeId,
      userId,
      permissions,
      createdAt: NOW,
    }),
  })
}

/** 店長として入り、店舗 1 つを持つ組織を用意する。 */
async function manager(): Promise<{ org: string; token: string; storeId: string }> {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await seedStore(org)
  await grant(org, storeId, `dev:${org}`, ['settings.read', 'settings.manage'])
  return { org, token, storeId }
}

function api(token: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await SELF.fetch(`${BASE}${path}`, {
      method,
      headers: authed(token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: res.status, body: (await res.json().catch(() => null)) as never }
  }
}

/** 設定 6 面が共有する版。行がまだ無い店舗は 1 から始まる。 */
async function settingsVersion(org: string, storeId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT version FROM store_settings_revision WHERE organization_id = ? AND store_id = ?',
  )
    .bind(org, storeId)
    .first<{ version: number }>()
  return row?.version ?? 1
}

async function countRows(table: string, org: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE organization_id = ?`)
    .bind(org)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/* --- 本文の型（画面が送るものと同じ形を手で組む） ------------------------- */

type HoursRow = {
  weekday: number
  isClosed: boolean
  opensAt: string | null
  closesAt: string | null
}

/** 月〜土 10:00–19:00・火曜だけ定休、という銀座店の並びを作る。 */
function sevenRows(overrides: Partial<Record<number, Partial<HoursRow>>> = {}): HoursRow[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const base: HoursRow =
      weekday === 2
        ? { weekday, isClosed: true, opensAt: null, closesAt: null }
        : { weekday, isClosed: false, opensAt: '10:00', closesAt: '19:00' }
    return { ...base, ...(overrides[weekday] ?? {}) }
  })
}

function weeklyShifts(overrides: Partial<Record<number, { isOff: boolean }>> = {}) {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isOff: overrides[weekday]?.isOff ?? false,
    startsAt: overrides[weekday]?.isOff ? null : '10:00',
    endsAt: overrides[weekday]?.isOff ? null : '19:00',
    breaks: [],
  }))
}

async function addStaff(token: string, storeId: string, displayName: string) {
  const call = api(token)
  const created = await call('POST', `/api/staff/stores/${storeId}/staff`, { displayName })
  return created.body as { id: string }
}

async function addEquipment(token: string, storeId: string, name: string) {
  const call = api(token)
  const created = await call('POST', `/api/staff/stores/${storeId}/equipment`, {
    name,
    kind: 'measure',
    roleLabel: '視力測定',
  })
  return created.body as { id: string }
}

async function addPurpose(
  token: string,
  input: { nameInternal: string; nameShort: string; durationMinutes: number; sortOrder: number },
) {
  const call = api(token)
  const created = await call('POST', '/api/staff/purposes', {
    nameInternal: input.nameInternal,
    namePublic: input.nameInternal,
    nameShort: input.nameShort,
    durationMinutes: input.durationMinutes,
    sortOrder: input.sortOrder,
  })
  return created.body as { id: string; version: number }
}

/* ------------------------------------------------------------------------- */

describe('店舗の情報', () => {
  it('保存した値をそのまま読み返せる', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    const before = await call('GET', `/api/staff/stores/${storeId}`)
    expect(before.status).toBe(200)

    const saved = await call('PATCH', `/api/staff/stores/${storeId}`, {
      name: 'EYE 銀座店',
      namePublic: 'EYE 銀座',
      phone: '03-1234-5678',
      address: '東京都中央区銀座1-2-3',
      nearestStation: '銀座駅',
      accessNote: 'A1 出口から徒歩 3 分',
      parkingNote: '提携駐車場あり',
      introText: 'まぶしさの少ないレンズをご案内します。',
      version: (before.body as { settingsVersion: number }).settingsVersion,
    })
    expect(saved.status).toBe(200)

    const after = await call('GET', `/api/staff/stores/${storeId}`)
    expect(after.body).toMatchObject({
      namePublic: 'EYE 銀座',
      nearestStation: '銀座駅',
      parkingNote: '提携駐車場あり',
      introText: 'まぶしさの少ないレンズをご案内します。',
    })
  })

  it('updatedAt と updatedBy が保存で更新される', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    // 個人ログイン済みの担当として保存する（共有端末のままなら updatedBy は null になる）。
    const staffId = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO staff (id, organization_id, store_id, admin_user_id, display_name, role, max_parallel_reservations, is_active, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(staffId, org, storeId, `dev:${org}`, '山田 大輔', 'manager', 1, '1', 0, NOW, NOW)
      .run()

    await call('PATCH', `/api/staff/stores/${storeId}`, { name: 'EYE 銀座店', version: 1 })

    const after = await call('GET', `/api/staff/stores/${storeId}`)
    const body = after.body as { updatedAt: string | null; updatedBy: string | null }
    expect(body.updatedBy).toBe(staffId)
    expect(body.updatedAt).not.toBeNull()
  })

  it('201 文字の紹介文は 400 で落ち、行は変わらない', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    await call('PATCH', `/api/staff/stores/${storeId}`, { introText: 'あ'.repeat(200), version: 1 })

    const rejected = await call('PATCH', `/api/staff/stores/${storeId}`, {
      introText: 'い'.repeat(201),
      version: 2,
    })
    expect(rejected.status).toBe(400)

    const after = await call('GET', `/api/staff/stores/${storeId}`)
    expect((after.body as { introText: string }).introText).toBe('あ'.repeat(200))
  })
})

describe('営業時間', () => {
  it('7 行を置き換えられる', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    const saved = await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows({ 5: { opensAt: '11:00', closesAt: '20:00' } }),
      blackouts: [
        { weekday: THURSDAY, startsAt: '12:00', endsAt: '13:00', label: 'お昼', sortOrder: 1 },
      ],
      version: 1,
    })
    expect(saved.status).toBe(200)

    const read = await call('GET', `/api/staff/stores/${storeId}/business-hours`)
    const body = read.body as { rows: HoursRow[]; blackouts: { label: string }[] }
    expect(body.rows).toHaveLength(7)
    expect(body.rows.find((r) => r.weekday === 5)).toMatchObject({
      opensAt: '11:00',
      closesAt: '20:00',
    })
    expect(body.rows.find((r) => r.weekday === 2)).toMatchObject({ isClosed: true })
    expect(body.blackouts.map((b) => b.label)).toEqual(['お昼'])
  })

  it('閉店が開店以前の行は 400 で落ち、行は変わらない', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows(),
      version: 1,
    })

    const rejected = await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows({ [THURSDAY]: { opensAt: '19:00', closesAt: '19:00' } }),
      version: 2,
    })
    expect(rejected.status).toBe(400)

    const read = await call('GET', `/api/staff/stores/${storeId}/business-hours`)
    expect(
      (read.body as { rows: HoursRow[] }).rows.find((r) => r.weekday === THURSDAY),
    ).toMatchObject({ opensAt: '10:00', closesAt: '19:00' })
  })

  it('営業時間の外にはみ出す帯は 400 で落ちる', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    const rejected = await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows(),
      blackouts: [
        { weekday: THURSDAY, startsAt: '19:00', endsAt: '20:00', label: '片付け', sortOrder: 0 },
      ],
      version: 1,
    })
    expect(rejected.status).toBe(400)
    // 拒んだ保存は 7 行のほうも書き込まない（部分保存を作らない）。
    expect(await countRows('store_business_hours', org)).toBe(0)
  })

  it('刻みが片付けより短い保存は通り、応答に警告が 1 件載る', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    // 刻み 5 分・片付け 10 分。続けて受けられない時刻ができるが、保存は止めない。
    const rules = await call('PUT', `/api/staff/stores/${storeId}/slot-rules`, {
      slotMinutes: 5,
      cleanupMinutes: 10,
      maxParallel: 3,
      version: 1,
    })
    expect(rules.status).toBe(200)

    const saved = await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows(),
      version: 2,
    })
    expect(saved.status).toBe(200)
    expect((saved.body as { warnings: string[] }).warnings).toHaveLength(1)
  })
})

describe('営業日', () => {
  it('臨時のお休みを足すと行が 1 つ増える', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    const created = await call('POST', `/api/staff/stores/${storeId}/calendar-exceptions`, {
      date: '2026-09-30',
      kind: 'closed',
      note: '棚卸しのため',
    })
    expect(created.status).toBe(200)

    const listed = await call(
      'GET',
      `/api/staff/stores/${storeId}/calendar-exceptions?from=2026-09-01&to=2026-10-31`,
    )
    expect((listed.body as { date: string }[]).map((r) => r.date)).toEqual(['2026-09-30'])
  })

  it('同じ日をもう一度押すと行が消える', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    const created = await call('POST', `/api/staff/stores/${storeId}/calendar-exceptions`, {
      date: '2026-09-30',
      kind: 'closed',
    })
    const { id } = created.body as { id: string }

    const removed = await call('DELETE', `/api/staff/stores/${storeId}/calendar-exceptions/${id}`)
    expect(removed.status).toBe(200)
    expect(removed.body).toMatchObject({ id, deleted: true })

    const listed = await call(
      'GET',
      `/api/staff/stores/${storeId}/calendar-exceptions?from=2026-09-01&to=2026-10-31`,
    )
    expect(listed.body).toEqual([])
  })

  it('92 日を超える範囲の取得は 400 で落ちる', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    const rejected = await call(
      'GET',
      `/api/staff/stores/${storeId}/calendar-exceptions?from=2026-09-01&to=2026-12-03`,
    )
    expect(rejected.status).toBe(400)
  })
})

describe('予約の間隔', () => {
  it('保存すると lastAcceptableAt が 7 曜日ぶん返る', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows(),
      blackouts: [
        { weekday: THURSDAY, startsAt: '18:40', endsAt: '19:00', label: '片付け', sortOrder: 2 },
      ],
      version: 1,
    })
    await addPurpose(token, {
      nameInternal: '今のメガネを調整したい',
      nameShort: '調整',
      durationMinutes: 20,
      sortOrder: 0,
    })

    // 行が無いうちは「設定未完」。暗黙の既定値を出さずに 404 で返す。
    expect((await call('GET', `/api/staff/stores/${storeId}/slot-rules`)).status).toBe(404)

    const saved = await call('PUT', `/api/staff/stores/${storeId}/slot-rules`, {
      slotMinutes: 30,
      cleanupMinutes: 10,
      maxParallel: 3,
      version: 2,
    })
    expect(saved.status).toBe(200)
    expect((await call('GET', `/api/staff/stores/${storeId}/slot-rules`)).body).toMatchObject({
      slotMinutes: 30,
      cleanupMinutes: 10,
      maxParallel: 3,
    })
    const view = saved.body as { lastAcceptableAt: Record<string, string | null> }
    expect(Object.keys(view.lastAcceptableAt).sort()).toEqual(['0', '1', '2', '3', '4', '5', '6'])
    // 木曜は 帯の終わり 18:40 − 最短の目的 20分 = 18:20。定休の火曜は枠が 1 つも無い。
    expect(view.lastAcceptableAt['4']).toBe('18:20')
    expect(view.lastAcceptableAt['2']).toBeNull()
  })
})

describe('スタッフ', () => {
  it('足すと一覧が 1 名増える', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    expect((await call('GET', `/api/staff/stores/${storeId}/staff`)).body).toEqual([])

    await addStaff(token, storeId, '佐藤 美咲')
    const listed = await call('GET', `/api/staff/stores/${storeId}/staff`)
    expect((listed.body as { displayName: string }[]).map((s) => s.displayName)).toEqual([
      '佐藤 美咲',
    ])

    // 6 人目の 山田 大輔 は店長。役割は 店長 と スタッフ の 2 段だけを持つ。
    await call('POST', `/api/staff/stores/${storeId}/staff`, {
      displayName: '山田 大輔',
      kana: 'やまだ だいすけ',
      jobLabel: '店長',
      role: 'manager',
      sortOrder: 5,
    })
    const both = await call('GET', `/api/staff/stores/${storeId}/staff`)
    expect((both.body as { displayName: string; role: string }[]).map((s) => s.role)).toEqual([
      'staff',
      'manager',
    ])
  })

  it('技能を置き換えても既存の割り当ては変わらない', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    const { id } = await addStaff(token, storeId, '佐藤 美咲')
    const assignmentId = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO reservation_assignments (id, organization_id, reservation_id, kind, target_id, starts_at, ends_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
      .bind(assignmentId, org, crypto.randomUUID(), 'staff', id, NOW, NOW, NOW)
      .run()

    const saved = await call('PUT', `/api/staff/stores/${storeId}/staff/${id}/skills`, {
      skills: ['measure', 'processing', 'sales_reception'],
    })
    expect(saved.status).toBe(200)
    expect((saved.body as { skills: string[] }).skills.sort()).toEqual([
      'measure',
      'processing',
      'sales_reception',
    ])

    const kept = await env.DB.prepare('SELECT target_id FROM reservation_assignments WHERE id = ?')
      .bind(assignmentId)
      .first<{ target_id: string }>()
    expect(kept?.target_id).toBe(id)
  })

  it('いま使えるを切っても行は消えない', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    const { id } = await addStaff(token, storeId, '渡辺 由紀')

    const patched = await call('PATCH', `/api/staff/stores/${storeId}/staff/${id}`, {
      isActive: false,
      version: await settingsVersion(org, storeId),
    })
    expect(patched.status).toBe(200)

    // 一覧の既定は「いま使える」だけ。行そのものは残っていて、含めれば読める。
    expect((await call('GET', `/api/staff/stores/${storeId}/staff`)).body).toEqual([])
    const all = await call('GET', `/api/staff/stores/${storeId}/staff?includeInactive=true`)
    expect((all.body as { displayName: string; isActive: boolean }[])[0]).toMatchObject({
      displayName: '渡辺 由紀',
      isActive: false,
    })
  })
})

describe('勤務時間', () => {
  it('曜日 7 行を保存すると staff_shifts が 62 日ぶん作り直される', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    const { id } = await addStaff(token, storeId, '佐藤 美咲')

    const saved = await call('PUT', `/api/staff/stores/${storeId}/staff-shifts`, {
      staffId: id,
      weekly: weeklyShifts(),
      effectiveFrom: '2026-08-27',
      version: await settingsVersion(org, storeId),
    })
    expect(saved.status).toBe(200)
    expect((saved.body as unknown[]).length).toBe(62)

    // その日に勤務がある担当だけを引ける（LOGIN-STAFF の「本日の勤務」）。
    const onDuty = await call('GET', `/api/staff/stores/${storeId}/staff?date=2026-08-27`)
    expect((onDuty.body as unknown[]).length).toBe(1)
    const offDuty = await call('GET', `/api/staff/stores/${storeId}/staff?date=2026-12-31`)
    expect(offDuty.body).toEqual([])

    const mine = await call(
      'GET',
      `/api/staff/stores/${storeId}/staff-shifts?from=2026-08-27&to=2026-09-27&staffId=${id}`,
    )
    expect((mine.body as { date: string }[])[0]).toMatchObject({ date: '2026-08-27' })
  })

  it('保存し直すと同じ期間の古い行が残らない', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    const { id } = await addStaff(token, storeId, '高橋 健')
    const body = (version: number) => ({
      staffId: id,
      weekly: weeklyShifts(),
      effectiveFrom: '2026-08-27',
      version,
    })

    await call(
      'PUT',
      `/api/staff/stores/${storeId}/staff-shifts`,
      body(await settingsVersion(org, storeId)),
    )
    await call(
      'PUT',
      `/api/staff/stores/${storeId}/staff-shifts`,
      body(await settingsVersion(org, storeId)),
    )

    expect(await countRows('staff_shifts', org)).toBe(62)
    expect(await countRows('staff_weekly_shifts', org)).toBe(7)
  })

  it('営業時間の外にはみ出す勤務でも保存でき、行がそのまま残る', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    const { id } = await addStaff(token, storeId, '佐藤 美咲')
    await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows({ 0: { opensAt: '10:00', closesAt: '18:00' } }),
      version: await settingsVersion(org, storeId),
    })

    const saved = await call('PUT', `/api/staff/stores/${storeId}/staff-shifts`, {
      staffId: id,
      // 日曜は営業時間 10:00–18:00 の外へ 1 時間はみ出す。拒まない（AC-SET-12）。
      weekly: weeklyShifts().map((row) =>
        row.weekday === 0 ? { ...row, startsAt: '12:00', endsAt: '19:00' } : row,
      ),
      effectiveFrom: '2026-08-27',
      version: await settingsVersion(org, storeId),
    })
    expect(saved.status).toBe(200)

    const sunday = await env.DB.prepare(
      'SELECT starts_at, ends_at FROM staff_weekly_shifts WHERE organization_id = ? AND staff_id = ? AND weekday = 0',
    )
      .bind(org, id)
      .first<{ starts_at: string; ends_at: string }>()
    expect(sunday).toMatchObject({ starts_at: '12:00', ends_at: '19:00' })
  })

  // LEDGER-STAFF の灰色の帯は担当ひとりの休憩（`staff_shifts.kind='break'`）で、
  // 店舗の停止帯とは別物である。曜日テンプレートの休憩がそこまで展開されることを見る。
  it('お休みの曜日は日付の行を作らず、休憩は kind=break の行として展開される', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    const { id } = await addStaff(token, storeId, '佐藤 美咲')

    const saved = await call('PUT', `/api/staff/stores/${storeId}/staff-shifts`, {
      staffId: id,
      // 火曜（weekday=2）は定休でお休み。残る 6 曜日は 13:00–14:00 に休憩を 1 本持つ。
      weekly: weeklyShifts({ 2: { isOff: true } }).map((row) =>
        row.isOff ? row : { ...row, breaks: [{ startsAt: '13:00', endsAt: '14:00' }] },
      ),
      effectiveFrom: '2026-08-27',
      version: await settingsVersion(org, storeId),
    })
    expect(saved.status).toBe(200)

    // 62 日のうち火曜は 9 日ある（2026-09-01 が最初）。その 9 日は行が 1 本も無い。
    const counted = await env.DB.prepare(
      'SELECT kind, COUNT(*) AS n FROM staff_shifts WHERE organization_id = ? AND staff_id = ? GROUP BY kind ORDER BY kind',
    )
      .bind(org, id)
      .all<{ kind: string; n: number }>()
    expect(counted.results).toEqual([
      { kind: 'break', n: 53 },
      { kind: 'work', n: 53 },
    ])

    const tuesday = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM staff_shifts WHERE organization_id = ? AND staff_id = ? AND date = ?',
    )
      .bind(org, id, '2026-09-01')
      .first<{ n: number }>()
    expect(tuesday?.n).toBe(0)

    // 曜日テンプレートの側にも休憩が 1 組で残る（2 件目を黙って捨てない形）。
    const template = await env.DB.prepare(
      'SELECT break_start, break_end FROM staff_weekly_shifts WHERE organization_id = ? AND staff_id = ? AND weekday = 4',
    )
      .bind(org, id)
      .first<{ break_start: string; break_end: string }>()
    expect(template).toMatchObject({ break_start: '13:00', break_end: '14:00' })
  })
})

describe('設備', () => {
  it('足すと一覧が 1 行増える', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    await addEquipment(token, storeId, '視力測定機 A')
    const listed = await call('GET', `/api/staff/stores/${storeId}/equipment`)
    expect((listed.body as { name: string }[]).map((e) => e.name)).toEqual(['視力測定機 A'])

    // 種別で絞れる（空き枠エンジンの「この種別の設備は何が空いているか」と同じ引き方）。
    expect(
      (await call('GET', `/api/staff/stores/${storeId}/equipment?kind=measure`)).body,
    ).toHaveLength(1)
    expect((await call('GET', `/api/staff/stores/${storeId}/equipment?kind=counter`)).body).toEqual(
      [],
    )
  })

  it('いま使えるを切っても行は消えず、既存の割り当ても変わらない', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    const { id } = await addEquipment(token, storeId, '視力測定機 B')
    const assignmentId = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO reservation_assignments (id, organization_id, reservation_id, kind, target_id, starts_at, ends_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
      .bind(assignmentId, org, crypto.randomUUID(), 'equipment', id, NOW, NOW, NOW)
      .run()

    const patched = await call('PATCH', `/api/staff/stores/${storeId}/equipment/${id}`, {
      isActive: false,
      inactiveReason: '定期点検（メーカー来店）',
      version: await settingsVersion(org, storeId),
    })
    expect(patched.status).toBe(200)

    const listed = await call('GET', `/api/staff/stores/${storeId}/equipment?includeInactive=true`)
    expect((listed.body as { isActive: boolean }[]).map((e) => e.isActive)).toEqual([false])
    const kept = await env.DB.prepare('SELECT target_id FROM reservation_assignments WHERE id = ?')
      .bind(assignmentId)
      .first<{ target_id: string }>()
    expect(kept?.target_id).toBe(id)
  })

  it('点検を足して消せる', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    const { id } = await addEquipment(token, storeId, '視力測定機 B')

    const created = await call('POST', `/api/staff/stores/${storeId}/equipment/${id}/maintenance`, {
      startsAt: '2026-08-28T01:00:00.000Z',
      endsAt: '2026-08-28T03:00:00.000Z',
      note: '定期点検（メーカー来店）',
    })
    expect(created.status).toBe(200)
    const maintenanceId = (created.body as { id: string }).id

    const listed = await call(
      'GET',
      `/api/staff/stores/${storeId}/equipment/${id}/maintenance?from=2026-08-01&to=2026-08-31`,
    )
    expect((listed.body as unknown[]).length).toBe(1)

    const removed = await call(
      'DELETE',
      `/api/staff/stores/${storeId}/equipment/${id}/maintenance/${maintenanceId}`,
    )
    expect(removed.status).toBe(200)
    const empty = await call(
      'GET',
      `/api/staff/stores/${storeId}/equipment/${id}/maintenance?from=2026-08-01&to=2026-08-31`,
    )
    expect(empty.body).toEqual([])
  })

  it('別の設備の点検 id を渡した取り消しは 404 になり、行は残る', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    const owner = await addEquipment(token, storeId, '視力測定機 B')
    const other = await addEquipment(token, storeId, '検査室 1')
    const created = await call(
      'POST',
      `/api/staff/stores/${storeId}/equipment/${owner.id}/maintenance`,
      { startsAt: '2026-08-28T01:00:00.000Z', endsAt: '2026-08-28T03:00:00.000Z' },
    )
    const maintenanceId = (created.body as { id: string }).id

    const wrong = await call(
      'DELETE',
      `/api/staff/stores/${storeId}/equipment/${other.id}/maintenance/${maintenanceId}`,
    )
    expect(wrong.status).toBe(404)
    const kept = await call(
      'GET',
      `/api/staff/stores/${storeId}/equipment/${owner.id}/maintenance?from=2026-08-01&to=2026-08-31`,
    )
    expect(kept.body).toHaveLength(1)
  })

  it('点検の期間は半開区間で、to の翌日 0:00 JST に始まる行は入らない', async () => {
    const { token, storeId } = await manager()
    const call = await api(token)
    const { id } = await addEquipment(token, storeId, '視力測定機 B')
    // JST 2026-08-31 0:00 ちょうど（= UTC 8/30 15:00）。to=2026-08-30 の範囲の右端。
    await call('POST', `/api/staff/stores/${storeId}/equipment/${id}/maintenance`, {
      startsAt: '2026-08-30T15:00:00.000Z',
      endsAt: '2026-08-30T16:00:00.000Z',
    })

    const excluded = await call(
      'GET',
      `/api/staff/stores/${storeId}/equipment/${id}/maintenance?from=2026-08-01&to=2026-08-30`,
    )
    expect(excluded.body).toEqual([])
    const included = await call(
      'GET',
      `/api/staff/stores/${storeId}/equipment/${id}/maintenance?from=2026-08-01&to=2026-08-31`,
    )
    expect(included.body).toHaveLength(1)
  })
})

/**
 * クエリ文字列は必ず文字列で届く。契約に無い形は **400** で返し、
 * `internal_error`（500）に化けさせない — 500 は「予期しない throw」の合図で、
 * 打ち間違えたクエリをサーバの故障として画面に出すことになる。
 */
describe('壊れたクエリ', () => {
  it('日付・種別・id の形が違う一覧の取得は 400 になる（500 にしない）', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    const statuses = await Promise.all(
      [
        `/api/staff/stores/${storeId}/staff?date=2026-8-7`,
        `/api/staff/stores/${storeId}/equipment?kind=fitting`,
        '/api/staff/purposes?storeId=not-a-uuid',
      ].map(async (path) => (await call('GET', path)).status),
    )
    expect(statuses).toEqual([400, 400, 400])
  })

  it('includeInactive は true / 1 / false / 0 を受け、知らない語は 400 になる', async () => {
    const { token, storeId } = await manager()
    const call = api(token)
    const path = `/api/staff/stores/${storeId}/staff`
    await addStaff(token, storeId, '佐藤 美咲')
    for (const value of ['true', '1', 'false', '0']) {
      expect((await call('GET', `${path}?includeInactive=${value}`)).status).toBe(200)
    }
    expect((await call('GET', `${path}?includeInactive=yes`)).status).toBe(400)
  })
})

describe('ご来店の目的', () => {
  it('所要時間を変えても既存の予約の所要時間は変わらない', async () => {
    const { org, token } = await manager()
    const call = api(token)
    const purpose = await addPurpose(token, {
      nameInternal: 'メガネを新しく作る',
      nameShort: '新調相談',
      durationMinutes: 50,
      sortOrder: 0,
    })
    const reservationId = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO reservation_purposes (id, organization_id, reservation_id, purpose_id, duration_minutes, sort_order, created_at) VALUES (?,?,?,?,?,?,?)',
    )
      .bind(crypto.randomUUID(), org, reservationId, purpose.id, 50, 0, NOW)
      .run()

    const patched = await call('PATCH', `/api/staff/purposes/${purpose.id}`, {
      durationMinutes: 60,
      version: purpose.version,
    })
    expect(patched.status).toBe(200)
    expect((patched.body as { durationMinutes: number }).durationMinutes).toBe(60)

    const frozen = await env.DB.prepare(
      'SELECT duration_minutes AS d FROM reservation_purposes WHERE reservation_id = ?',
    )
      .bind(reservationId)
      .first<{ d: number }>()
    expect(frozen?.d).toBe(50)
  })

  it('Web 予約に出すを切ると公開の件数が 1 減る', async () => {
    const { token } = await manager()
    const call = api(token)
    const repair = await addPurpose(token, {
      nameInternal: '修理・部品交換',
      nameShort: '修理',
      durationMinutes: 30,
      sortOrder: 3,
    })
    await addPurpose(token, {
      nameInternal: 'コンタクトの相談',
      nameShort: 'コンタ',
      durationMinutes: 40,
      sortOrder: 4,
    })
    const before = await call('GET', '/api/staff/purposes?webPublishedOnly=true')
    expect((before.body as unknown[]).length).toBe(2)

    await call('PATCH', `/api/staff/purposes/${repair.id}`, {
      isWebPublished: false,
      version: repair.version,
    })
    const after = await call('GET', '/api/staff/purposes?webPublishedOnly=true')
    expect((after.body as unknown[]).length).toBe(1)

    // storeId を渡すと「その店舗の行 + チェーン共通の行」。seed は共通の 2 行だけ。
    const scoped = await call('GET', `/api/staff/purposes?storeId=${crypto.randomUUID()}`)
    expect((scoped.body as unknown[]).length).toBe(2)
    const withInactive = await call('GET', '/api/staff/purposes?includeInactive=true')
    expect((withInactive.body as unknown[]).length).toBe(2)
  })

  it('並べ替えると sort_order が入れ替わる', async () => {
    const { token } = await manager()
    const call = api(token)
    const first = await addPurpose(token, {
      nameInternal: 'メガネを新しく作る',
      nameShort: '新調相談',
      durationMinutes: 60,
      sortOrder: 0,
    })
    const second = await addPurpose(token, {
      nameInternal: '今のメガネを調整したい',
      nameShort: '調整',
      durationMinutes: 20,
      sortOrder: 1,
    })

    const reordered = await call('PUT', '/api/staff/purposes/order', {
      purposeIds: [second.id, first.id],
    })
    expect(reordered.status).toBe(200)
    expect((reordered.body as { id: string }[]).map((p) => p.id)).toEqual([second.id, first.id])
  })

  it('必要な技能 2 行の保存は 400 で落ちる', async () => {
    const { token } = await manager()
    const call = api(token)
    const purpose = await addPurpose(token, {
      nameInternal: 'メガネを新しく作る',
      nameShort: '新調相談',
      durationMinutes: 60,
      sortOrder: 0,
    })

    const rejected = await call('PUT', `/api/staff/purposes/${purpose.id}/requirements`, {
      requirements: [
        { kind: 'skill', value: 'measure' },
        { kind: 'skill', value: 'fitting' },
      ],
    })
    expect(rejected.status).toBe(400)

    const accepted = await call('PUT', `/api/staff/purposes/${purpose.id}/requirements`, {
      requirements: [
        { kind: 'skill', value: 'measure' },
        { kind: 'equipment_kind', value: 'measure' },
        { kind: 'equipment_kind', value: 'counter' },
      ],
    })
    expect(accepted.status).toBe(200)
    expect((accepted.body as { requirements: unknown[] }).requirements).toHaveLength(3)
  })
})

describe('版の衝突', () => {
  it('古い version で保存すると 409 version_conflict が返る', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows(),
      version: await settingsVersion(org, storeId),
    })

    const stale = await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows({ [THURSDAY]: { opensAt: '09:00', closesAt: '17:00' } }),
      version: 1,
    })
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ error: 'version_conflict' })
  })

  it('409 のとき、営業時間・スタッフ・設備・目的のどの行も保存前の値のままである', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    const { id: staffId } = await addStaff(token, storeId, '佐藤 美咲')
    const { id: equipmentId } = await addEquipment(token, storeId, '視力測定機 A')
    const purpose = await addPurpose(token, {
      nameInternal: 'メガネを新しく作る',
      nameShort: '新調相談',
      durationMinutes: 60,
      sortOrder: 0,
    })
    await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows(),
      blackouts: [
        { weekday: THURSDAY, startsAt: '12:00', endsAt: '13:00', label: 'お昼', sortOrder: 1 },
      ],
      version: await settingsVersion(org, storeId),
    })

    const stale = (await settingsVersion(org, storeId)) - 1
    const hours = await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows({ [THURSDAY]: { opensAt: '09:00', closesAt: '17:00' } }),
      blackouts: [],
      version: stale,
    })
    const person = await call('PATCH', `/api/staff/stores/${storeId}/staff/${staffId}`, {
      displayName: '別人',
      version: stale,
    })
    const unit = await call('PATCH', `/api/staff/stores/${storeId}/equipment/${equipmentId}`, {
      name: '別の機械',
      version: stale,
    })
    const purposeConflict = await call('PATCH', `/api/staff/purposes/${purpose.id}`, {
      durationMinutes: 30,
      version: purpose.version + 5,
    })
    expect([hours.status, person.status, unit.status, purposeConflict.status]).toEqual([
      409, 409, 409, 409,
    ])

    const read = await call('GET', `/api/staff/stores/${storeId}/business-hours`)
    const body = read.body as { rows: HoursRow[]; blackouts: unknown[] }
    expect(body.rows.find((r) => r.weekday === THURSDAY)).toMatchObject({
      opensAt: '10:00',
      closesAt: '19:00',
    })
    expect(body.blackouts).toHaveLength(1)
    expect(
      (
        (await call('GET', `/api/staff/stores/${storeId}/staff`)).body as { displayName: string }[]
      )[0]?.displayName,
    ).toBe('佐藤 美咲')
    expect(
      ((await call('GET', `/api/staff/stores/${storeId}/equipment`)).body as { name: string }[])[0]
        ?.name,
    ).toBe('視力測定機 A')
    expect(
      ((await call('GET', '/api/staff/purposes')).body as { durationMinutes: number }[])[0]
        ?.durationMinutes,
    ).toBe(60)
  })

  it('409 のとき store_settings_revision の version も上がっていない', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows(),
      version: await settingsVersion(org, storeId),
    })
    const settled = await settingsVersion(org, storeId)

    await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows(),
      version: settled - 1,
    })
    expect(await settingsVersion(org, storeId)).toBe(settled)
  })

  // 勤務時間の保存は 1 バッチが 70 文を超える（曜日 7 行 + 62 日ぶんの展開）。
  // 版の条件を配り忘れた文が 1 つでもあれば、409 を返しながらその日ぶんだけ書き換わる。
  it('409 のとき staff_shifts は 1 行も作られない（一番長いバッチでも部分適用が無い）', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    const { id: staffId } = await addStaff(token, storeId, '佐藤 美咲')
    const body = {
      staffId,
      weekly: weeklyShifts(),
      effectiveFrom: '2026-08-27',
      version: (await settingsVersion(org, storeId)) - 1,
    }

    const stale = await call('PUT', `/api/staff/stores/${storeId}/staff-shifts`, body)
    expect(stale.status).toBe(409)
    const rows = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM staff_shifts WHERE organization_id = ? AND staff_id = ?',
    )
      .bind(org, staffId)
      .first<{ n: number }>()
    const weekly = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM staff_weekly_shifts WHERE organization_id = ? AND staff_id = ?',
    )
      .bind(org, staffId)
      .first<{ n: number }>()
    expect([rows?.n, weekly?.n]).toEqual([0, 0])
  })

  // 予約の間隔だけは `INSERT ... SELECT ... WHERE EXISTS ... ON CONFLICT DO UPDATE` で書く。
  // 版の条件は SELECT 側にしか付かないので、上書きの経路が素通りしないことを見る。
  it('409 のとき予約の間隔は上書きされない', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    await call('PUT', `/api/staff/stores/${storeId}/slot-rules`, {
      slotMinutes: 30,
      cleanupMinutes: 10,
      maxParallel: 3,
      version: await settingsVersion(org, storeId),
    })

    const stale = await call('PUT', `/api/staff/stores/${storeId}/slot-rules`, {
      slotMinutes: 15,
      cleanupMinutes: 0,
      maxParallel: 1,
      version: (await settingsVersion(org, storeId)) - 1,
    })
    expect(stale.status).toBe(409)
    const read = await call('GET', `/api/staff/stores/${storeId}/slot-rules`)
    expect(read.body).toMatchObject({ slotMinutes: 30, cleanupMinutes: 10, maxParallel: 3 })
  })

  it('2 台が同じ版で同時に保存すると、通るのは 1 台だけで、負けた側の値は 1 つも残らない', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    const before = await settingsVersion(org, storeId)
    const save = (opensAt: string, closesAt: string) =>
      call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
        rows: sevenRows({ [THURSDAY]: { opensAt, closesAt } }),
        version: before,
      })

    // 2 台の iPad が同じ版を読んだまま同時に「保存」を押した形。
    const [first, second] = await Promise.all([save('09:00', '17:00'), save('11:00', '20:00')])
    expect([first.status, second.status].sort()).toEqual([200, 409])

    // 版は 1 だけ上がる（負けた側のバッチは 1 文も当たっていない）。
    expect(await settingsVersion(org, storeId)).toBe(before + 1)
    // 7 行の置き換えが 2 度走れば 14 行になる。負けた側の INSERT が
    // 版の条件で落ちていることを、行数そのもので確かめる。
    const rows = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM store_business_hours WHERE organization_id = ? AND store_id = ?',
    )
      .bind(org, storeId)
      .first<{ n: number }>()
    expect(rows?.n).toBe(7)

    // 残っているのは勝った側の値だけで、2 台の値が混ざった行は無い。
    const thursday = (
      (await call('GET', `/api/staff/stores/${storeId}/business-hours`)).body as {
        rows: HoursRow[]
      }
    ).rows.find((row) => row.weekday === THURSDAY)
    const won = first.status === 200 ? ['09:00', '17:00'] : ['11:00', '20:00']
    expect([thursday?.opensAt, thursday?.closesAt]).toEqual(won)
  })

  it('保存が通ると version がちょうど 1 だけ上がる', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    const before = await settingsVersion(org, storeId)
    const saved = await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows(),
      version: before,
    })
    expect(saved.status).toBe(200)
    expect(await settingsVersion(org, storeId)).toBe(before + 1)
    expect((saved.body as { version: number }).version).toBe(before + 1)
  })
})

describe('影響の試算', () => {
  it('POST /api/staff/settings/impact は何も保存しない（試算の前後で全表の行が同じ）', async () => {
    const { org, token, storeId } = await manager()
    const call = api(token)
    const { id: equipmentId } = await addEquipment(token, storeId, '視力測定機 B')
    await call('PUT', `/api/staff/stores/${storeId}/business-hours`, {
      rows: sevenRows(),
      version: await settingsVersion(org, storeId),
    })
    await call('PUT', `/api/staff/stores/${storeId}/slot-rules`, {
      slotMinutes: 30,
      cleanupMinutes: 10,
      maxParallel: 3,
      version: await settingsVersion(org, storeId),
    })
    const reservationId = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO reservations (id, organization_id, store_id, code, source, status, starts_at, ends_at, duration_minutes, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        reservationId,
        org,
        storeId,
        `EY-2608-${crypto.randomUUID().slice(0, 4)}`,
        'counter',
        'confirmed',
        '2030-01-10T01:30:00.000Z',
        '2030-01-10T02:30:00.000Z',
        60,
        1,
        NOW,
        NOW,
      )
      .run()
    await env.DB.prepare(
      'INSERT INTO reservation_assignments (id, organization_id, reservation_id, kind, target_id, starts_at, ends_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
      .bind(
        crypto.randomUUID(),
        org,
        reservationId,
        'equipment',
        equipmentId,
        '2030-01-10T01:30:00.000Z',
        '2030-01-10T02:30:00.000Z',
        NOW,
      )
      .run()

    const before = {
      version: await settingsVersion(org, storeId),
      hours: await countRows('store_business_hours', org),
      maintenance: await countRows('equipment_maintenance', org),
      reservations: await countRows('reservations', org),
    }

    const report = await call('POST', '/api/staff/settings/impact', {
      storeId,
      kind: 'equipment_stop',
      draft: {
        equipmentId,
        startsAt: '2030-01-10T01:00:00.000Z',
        endsAt: '2030-01-10T03:00:00.000Z',
      },
    })
    expect(report.status).toBe(200)
    expect((report.body as { severity: string }).severity).toBe('action')
    expect((report.body as { affectedReservations: unknown[] }).affectedReservations).toHaveLength(
      1,
    )

    // 3 面が同じ器を使う。残る 2 種も同じ経路で数えるだけで、1 行も書かない。
    const purpose = await addPurpose(token, {
      nameInternal: 'メガネを新しく作る',
      nameShort: '新調相談',
      durationMinutes: 30,
      sortOrder: 0,
    })
    const byDuration = await call('POST', '/api/staff/settings/impact', {
      storeId,
      kind: 'purpose_duration',
      draft: {
        purposeId: purpose.id,
        durationMinutes: 60,
        from: '2030-01-07',
        to: '2030-01-13',
      },
    })
    expect(byDuration.status).toBe(200)
    expect(
      (byDuration.body as { affectedWebSlots: unknown[] }).affectedWebSlots.length,
    ).toBeGreaterThan(0)

    const byHours = await call('POST', '/api/staff/settings/impact', {
      storeId,
      kind: 'business_hours',
      draft: { rows: sevenRows(), blackouts: [] },
    })
    expect(byHours.status).toBe(200)
    expect(
      (byHours.body as { lastAcceptableAt: string | null }).lastAcceptableAt,
    ).not.toBeUndefined()

    expect({
      version: await settingsVersion(org, storeId),
      hours: await countRows('store_business_hours', org),
      maintenance: await countRows('equipment_maintenance', org),
      reservations: await countRows('reservations', org),
    }).toEqual(before)
  })
})

describe('勤務の窓を日次で前へ出す', () => {
  /*
   * 曜日テンプレートが正本で、日付の行はその展開結果である
   * （`004-store-settings/spec.md`「62 日先までを展開した結果で、保存時と日次 Cron の
   * 両方で展開する」）。保存時しか展開していなかったので、設定を触らないまま
   * 62 日が過ぎると勤務の行が尽き、台帳に担当者の行が出ず空き枠も出せなくなっていた
   * （実装不足の洗い出し settings-07）。
   */
  async function savedShifts() {
    const { org, token, storeId } = await manager()
    const call = api(token)
    const { id } = await addStaff(token, storeId, '佐藤 美咲')
    const saved = await call('PUT', `/api/staff/stores/${storeId}/staff-shifts`, {
      staffId: id,
      weekly: weeklyShifts(),
      effectiveFrom: '2026-08-27',
      version: await settingsVersion(org, storeId),
    })
    expect(saved.status).toBe(200)
    return { org, storeId, staffId: id }
  }

  async function shiftsOn(org: string, date: string): Promise<number> {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM staff_shifts WHERE organization_id = ? AND date = ?',
    )
      .bind(org, date)
      .first<{ n: number }>()
    return row?.n ?? 0
  }

  it('窓の先端の 1 日を足す（保存の窓が切れる先まで前へ出る）', async () => {
    const { org } = await savedShifts()
    // 保存は 2026-08-27 から 62 日ぶん。その最後は 2026-10-27。
    expect(await shiftsOn(org, '2026-10-27')).toBeGreaterThan(0)
    expect(await shiftsOn(org, '2026-10-28')).toBe(0)

    // 翌日に Cron が回ると、先端が 1 日ぶん前へ出る。
    const result = await expandShiftWindow(env.DB, new Date('2026-08-28T02:00:00.000Z'))
    expect(result.date).toBe('2026-10-28')
    expect(result.inserted).toBeGreaterThan(0)
    expect(await shiftsOn(org, '2026-10-28')).toBeGreaterThan(0)
  })

  it('すでに行がある日は触らない（日付ごとの手直しを塗り潰さない）', async () => {
    const { org } = await savedShifts()
    const before = await shiftsOn(org, '2026-10-27')
    // 2026-08-27 + 61 = 2026-10-27。すでに保存時の展開が入っている日。
    // JST の暦日で 2026-08-27（Cron は JST 0 時に動くが、ここは日だけが要る）。
    const result = await expandShiftWindow(env.DB, new Date('2026-08-27T02:00:00.000Z'))
    expect(result.date).toBe('2026-10-27')
    expect(result.inserted).toBe(0)
    expect(await shiftsOn(org, '2026-10-27')).toBe(before)
  })

  it('お休みの曜日は行を作らない', async () => {
    const { org } = await savedShifts()
    // `weeklyShifts()` の火曜は定休。2026-11-03 は火曜。
    await expandShiftWindow(env.DB, new Date('2026-09-03T15:10:00.000Z'))
    expect(new Date('2026-11-03T00:00:00.000Z').getUTCDay()).toBe(2)
    expect(await shiftsOn(org, '2026-11-03')).toBe(0)
  })
})
