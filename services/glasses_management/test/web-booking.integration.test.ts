/**
 * お客様向け Web 予約（P8）の統合テスト。
 *
 * 見るのは status ではなく **D1 の中身**である。公開面（`/api/public/**`）は未認証で、
 * 組織は `stores.slug` からしか解決しない。だから「公開していないものが外から一切
 * 見えない」「社内の事情（店内名・担当・設備）が 1 語も漏れない」「確定は 1 バッチで、
 * 二重予約は条件付き INSERT が止める」の 3 つは、応答の形だけでは確かめられない。
 *
 * **日付はサーバの実時刻の JST 暦日から相対で作る。**受付の窓（`accept_from_hours` /
 * `accept_until_days`）と変更の締切は実時刻を見るので、台帳のテストのような固定日
 * （`2026-08-27`）を使うと日が経つだけで落ちる。時刻そのものの境界値は
 * `web-booking.time.test.ts` が純関数で閉じている。
 *
 * 組織 id と店舗 slug は毎回 `crypto.randomUUID()` から作る（D1 と KV はテストファイル内で
 * 共有される）。公開の店舗一覧は全組織横断なので、数えるときは自分の slug に絞る。
 */

import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashManagementCode } from '../src/worker/domain/management-code'
import {
  authed,
  BASE,
  INTERNAL_HEADERS,
  insertBusinessHours,
  insertEquipment,
  insertShift,
  insertSlotRules,
  insertStaff,
  JSON_HEADERS,
  JWT_SECRET,
  orgId,
  tokenFor,
} from './helpers'

/* ───────────────────────────────────────────────────────────────────────────
 * 暦の道具（JST）
 * ─────────────────────────────────────────────────────────────────────────── */

const MS_PER_DAY = 86_400_000
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** UTC のミリ秒 → JST の暦日。 */
const jstDay = (at: number): string => new Date(at + JST_OFFSET_MS).toISOString().slice(0, 10)

/** JST の「きょう」。実時刻を読むのはこの 1 か所だけにする。 */
const TODAY = jstDay(Date.now())

const plusDays = (date: string, days: number): string =>
  jstDay(Date.parse(`${date}T00:00:00.000+09:00`) + days * MS_PER_DAY)

/** 0=日 … 6=土。 */
const weekdayOf = (date: string): number =>
  new Date(Date.parse(`${date}T00:00:00.000+09:00`) + JST_OFFSET_MS).getUTCDay()

/** JST の壁時計（`HH:MM`）→ UTC の ISO8601。 */
const at = (date: string, time: string): string =>
  new Date(Date.parse(`${date}T${time}:00.000+09:00`)).toISOString()

/** ご来店は 1 週間先。受付を開始する 2 時間先よりも十分あとで、30 日先よりも手前。 */
const VISIT = plusDays(TODAY, 7)

/* ───────────────────────────────────────────────────────────────────────────
 * 店舗ひとそろい
 * ─────────────────────────────────────────────────────────────────────────── */

/** モックの 6 行（`05-screen-flow.md` §3.11）。修理・部品交換だけ Web に出さない。 */
const PURPOSES = [
  // 店内名は対客名の一部にならない語を選ぶ（「出ていない」を文字列で確かめるため）。
  { internal: 'メガネ新調', pub: '新しいメガネを作る', short: '新調', minutes: 30, web: 1 },
  { internal: 'レンズ交換', pub: 'レンズの交換', short: 'レンズ', minutes: 30, web: 1 },
  { internal: '視力検査のみ', pub: '目の検査（視力測定）', short: '測定', minutes: 30, web: 1 },
  { internal: 'フレーム微調整', pub: 'フレームの調整', short: '調整', minutes: 15, web: 1 },
  { internal: '完成品お渡し', pub: 'できあがりの受け取り', short: '受取', minutes: 15, web: 1 },
  { internal: '修理受付', pub: '修理・部品の交換', short: '修理', minutes: 30, web: 0 },
] as const

type Purpose = { id: string; internal: string; pub: string; minutes: number }

type WebTenant = {
  org: string
  storeId: string
  slug: string
  /** 権限を持たないスタッフ。 */
  token: string
  /** `settings.manage` を持つ店長。 */
  manager: string
  purposes: Purpose[]
  /** Web に出す 5 件。 */
  published: Purpose[]
  /** 修理・部品の交換（`is_web_published='0'`）。 */
  hidden: Purpose
}

let sortSeq = 0

async function seedPurpose(
  org: string,
  storeId: string,
  spec: (typeof PURPOSES)[number],
): Promise<Purpose> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO visit_purposes (id, organization_id, store_id, name_internal, name_public, name_short, duration_minutes, is_web_published, is_active, sort_order, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)',
  )
    .bind(
      id,
      org,
      storeId,
      spec.internal,
      spec.pub,
      spec.short,
      spec.minutes,
      String(spec.web),
      '1',
      sortSeq++,
      at(TODAY, '00:00'),
      at(TODAY, '00:00'),
    )
    .run()
  return { id, internal: spec.internal, pub: spec.pub, minutes: spec.minutes }
}

async function seedSettings(
  org: string,
  storeId: string,
  input: {
    isPublished?: boolean
    opensAt?: string
    closesAt?: string
    acceptFromHours?: number
    acceptUntilDays?: number
    changeDeadlineDays?: number
    requiresApproval?: boolean
    message?: string | null
  } = {},
): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    'INSERT INTO web_booking_settings (id, organization_id, store_id, is_published, opens_at, closes_at, accept_from_hours, accept_until_days, change_deadline_days, requires_approval, message, version, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)',
  )
    .bind(
      crypto.randomUUID(),
      org,
      storeId,
      input.isPublished === false ? '0' : '1',
      input.opensAt ?? '10:30',
      input.closesAt ?? '18:00',
      input.acceptFromHours ?? 2,
      input.acceptUntilDays ?? 30,
      input.changeDeadlineDays ?? 1,
      input.requiresApproval === false ? '0' : '1',
      input.message ?? null,
      now,
      now,
    )
    .run()
}

/**
 * 受け付けられる店舗ひとそろい。担当 1 名（技能の要らない目的なので勤務だけ見る）・
 * 設備 1 台・目的 6 件・お昼の受付停止帯（12:00–13:00）。
 */
async function webTenant(
  input: {
    publish?: boolean
    maxParallel?: number
    closedWeekdays?: readonly number[]
    sortOrder?: number
    name?: string
    namePublic?: string
    shiftDays?: number
    settings?: Parameters<typeof seedSettings>[2]
  } = {},
): Promise<WebTenant> {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = crypto.randomUUID()
  const slug = `ginza-${crypto.randomUUID().slice(0, 12)}`
  const now = new Date().toISOString()
  await env.DB.prepare(
    'INSERT INTO stores (id, organization_id, name, slug, phone, address, access_note, is_active, created_at, name_public, sort_order, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      storeId,
      org,
      input.name ?? '銀座本店（本部管理）',
      slug,
      '03-1234-5678',
      '東京都中央区銀座4丁目1-1',
      '銀座駅 A2出口から徒歩3分',
      '1',
      now,
      input.namePublic ?? 'EYEX 銀座店',
      input.sortOrder ?? 0,
      now,
    )
    .run()

  // 店長は `store_memberships` の許可リストで決まる（JWT の role では決まらない）。
  const sub = `dev:${org}:manager`
  await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      organizationId: org,
      storeId,
      userId: sub,
      permissions: ['settings.read', 'settings.manage'],
      createdAt: now,
    }),
  })
  const manager = await signAccessToken(
    { sub, org, email: 'manager@example.test', role: 'staff' },
    JWT_SECRET,
  )

  await insertBusinessHours(org, storeId, {
    opensAt: '10:00',
    closesAt: '19:00',
    closedWeekdays: input.closedWeekdays ?? [],
  })
  // お昼の受付停止帯。曜日ごとに 1 本ずつ置く（表は曜日で持つ）。
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    await env.DB.prepare(
      'INSERT INTO store_blackout_windows (id, organization_id, store_id, weekday, starts_at, ends_at, label, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    )
      .bind(crypto.randomUUID(), org, storeId, weekday, '12:00', '13:00', 'お昼の受付停止', 0, now)
      .run()
  }
  await insertSlotRules(org, storeId, {
    slotMinutes: 30,
    cleanupMinutes: 10,
    maxParallel: input.maxParallel ?? 3,
  })
  const staffId = await insertStaff(org, storeId, { displayName: '佐藤 美咲' })
  for (let day = 0; day <= (input.shiftDays ?? 12); day += 1) {
    await insertShift(org, storeId, staffId, {
      date: plusDays(TODAY, day),
      startsAt: '10:00',
      endsAt: '19:00',
    })
  }
  await insertEquipment(org, storeId, { name: '視力測定機 A' })

  const purposes: Purpose[] = []
  for (const spec of PURPOSES) purposes.push(await seedPurpose(org, storeId, spec))
  if (input.publish !== false) await seedSettings(org, storeId, input.settings ?? {})

  const hidden = purposes[5]
  if (hidden === undefined) throw new Error('目的の seed に失敗した')
  return {
    org,
    storeId,
    slug,
    token,
    manager,
    purposes,
    published: purposes.slice(0, 5),
    hidden,
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * 呼び出しの道具
 * ─────────────────────────────────────────────────────────────────────────── */

type Json = Record<string, unknown>

/**
 * 総当たりの回数は**コード × IP** で数える。ご予約番号は組織の中でしか一意でないので、
 * 既定の IP のままだと別のテナントの `EY-W-2608-0001` が同じ枠を食い合う。
 * テストごとに違う IP を名乗り、数え方そのものを見たい 1 本だけ IP を固定する。
 */
async function call(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: Json }> {
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'cf-connecting-ip': crypto.randomUUID(), ...JSON_HEADERS, ...(init.headers ?? {}) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  const body = (await res.json().catch(() => null)) as Json
  return { status: res.status, body }
}

async function callList(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Json[] }> {
  const res = await SELF.fetch(`${BASE}${path}`, { headers: { ...JSON_HEADERS, ...headers } })
  const body = (await res.json().catch(() => [])) as Json[]
  return { status: res.status, body: Array.isArray(body) ? body : [] }
}

const settingsPath = (storeId: string) => `/api/staff/web-booking-settings/${storeId}`

async function readSettings(t: WebTenant): Promise<Json> {
  const res = await call(settingsPath(t.storeId), { headers: authed(t.manager) })
  expect(res.status).toBe(200)
  return res.body
}

/** 保存の本文。`GET` が返した形から、サーバが決める 3 つを落とす。 */
function toInput(settings: Json, patch: Json = {}): Json {
  const {
    storeId: _storeId,
    landingPath: _landingPath,
    updatedAt: _updatedAt,
    ...rest
  } = settings as Json & { storeId: string; landingPath: string; updatedAt: string }
  return { ...rest, ...patch }
}

type BookingResult = {
  code: string
  status: string
  startsAt: string
  endsAt: string
  storeName: string
  purposeName: string
  contactName: string
  managementCode: string
  emailed: boolean
}

async function book(
  t: WebTenant,
  input: {
    startsAt?: string
    purposeId?: string
    contactName?: string
    contactEmail?: string
    contactPhone?: string
    key?: string
    slug?: string
  } = {},
): Promise<{ status: number; body: Json & Partial<BookingResult> }> {
  const purpose = t.published[0]
  if (purpose === undefined) throw new Error('公開する目的が無い')
  const res = await call(`/api/public/stores/${input.slug ?? t.slug}/bookings`, {
    method: 'POST',
    headers: { 'idempotency-key': input.key ?? crypto.randomUUID() },
    body: {
      purposeId: input.purposeId ?? purpose.id,
      startsAt: input.startsAt ?? at(VISIT, '11:00'),
      contactName: input.contactName ?? '山口 真央',
      contactKana: 'やまぐち まお',
      contactPhone: input.contactPhone ?? '080-2345-6789',
      contactEmail: input.contactEmail ?? 'm.yamaguchi@example.jp',
    },
  })
  return res as { status: number; body: Json & Partial<BookingResult> }
}

/** 予約を 1 件作って、番号と確認番号を返す。 */
async function booked(t: WebTenant, startsAt = at(VISIT, '11:00')) {
  const res = await book(t, { startsAt })
  expect(res.status).toBe(200)
  const code = String(res.body.code)
  const managementCode = String(res.body.managementCode)
  return { code, managementCode, body: res.body }
}

const mgmt = (code: string) => ({ 'x-management-code': code })

/** 本人確認を通して、短命の鍵を取る。 */
async function verified(code: string, managementCode: string): Promise<string> {
  const res = await call('/api/public/reservations/verify', {
    method: 'POST',
    headers: mgmt(managementCode),
    body: { code, contactEmail: 'm.yamaguchi@example.jp' },
  })
  expect(res.status).toBe(200)
  return String(res.body.managementCode)
}

async function countRows(sql: string, ...params: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...params)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/**
 * 台帳の予約と Web 予約を D1 へ直に置く（締切を過ぎた予約は API から作れない）。
 * 確認番号は本番と同じ `hashManagementCode` で焼く。
 */
async function seedWebBooking(
  t: WebTenant,
  input: {
    startsAt: string
    managementCode?: string
    status?: 'pending' | 'confirmed' | 'cancelled'
    createdAt?: string
    contactEmail?: string
  },
): Promise<{ code: string; managementCode: string; reservationId: string; webBookingId: string }> {
  const reservationId = crypto.randomUUID()
  const webBookingId = crypto.randomUUID()
  const managementCode = input.managementCode ?? 'A7K2M9PQ'
  const createdAt = input.createdAt ?? new Date().toISOString()
  const endsAt = new Date(Date.parse(input.startsAt) + 30 * 60_000).toISOString()
  const purpose = t.published[0]
  if (purpose === undefined) throw new Error('公開する目的が無い')
  const code = `EY-W-2608-${String(Math.floor(Math.random() * 9000) + 1000)}`
  await env.DB.prepare(
    'INSERT INTO reservations (id, organization_id, store_id, code, customer_id, source, status, starts_at, ends_at, duration_minutes, note_customer, note_internal, version, created_at, updated_at, created_by, cancelled_at, cancel_reason) VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,1,?,?,NULL,NULL,NULL)',
  )
    .bind(
      reservationId,
      t.org,
      t.storeId,
      `EY-2608-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      'web',
      input.status === 'cancelled' ? 'cancelled' : 'confirmed',
      input.startsAt,
      endsAt,
      30,
      '',
      '',
      createdAt,
      createdAt,
    )
    .run()
  await env.DB.prepare(
    'INSERT INTO reservation_purposes (id, organization_id, reservation_id, purpose_id, duration_minutes, sort_order, created_at) VALUES (?,?,?,?,?,0,?)',
  )
    .bind(crypto.randomUUID(), t.org, reservationId, purpose.id, 30, createdAt)
    .run()
  await env.DB.prepare(
    'INSERT INTO reservation_assignments (id, organization_id, reservation_id, kind, target_id, starts_at, ends_at, created_at) VALUES (?,?,?,?,NULL,?,?,?)',
  )
    .bind(crypto.randomUUID(), t.org, reservationId, 'staff', input.startsAt, endsAt, createdAt)
    .run()
  await env.DB.prepare(
    'INSERT INTO web_bookings (id, organization_id, store_id, reservation_id, public_code, confirmation_key_hash, management_code_hash, contact_name, contact_kana, contact_phone, contact_email, status, created_at, confirmed_at, cancelled_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?)',
  )
    .bind(
      webBookingId,
      t.org,
      t.storeId,
      reservationId,
      code,
      await hashManagementCode('confirmation-key', `${t.org}:${code}`),
      await hashManagementCode(managementCode, `${t.org}:${code}`),
      '山口 真央',
      'やまぐち まお',
      '080-2345-6789',
      input.contactEmail ?? 'm.yamaguchi@example.jp',
      input.status ?? 'confirmed',
      createdAt,
      createdAt,
    )
    .run()
  return { code, managementCode, reservationId, webBookingId }
}

afterEach(() => {
  vi.restoreAllMocks()
})

/* ───────────────────────────────────────────────────────────────────────────
 * T-004 公開設定の読み書きと楽観ロック
 * ─────────────────────────────────────────────────────────────────────────── */

describe('公開設定の取得', () => {
  it('行が無い店舗は「公開していません」として読める', async () => {
    const t = await webTenant({ publish: false })
    const settings = await readSettings(t)
    expect(settings).toMatchObject({
      storeId: t.storeId,
      isPublished: false,
      opensAt: '10:30',
      closesAt: '18:00',
      acceptFromHours: 2,
      acceptUntilDays: 30,
      changeDeadlineDays: 1,
      requiresApproval: true,
      message: '',
      version: 0,
    })
    // 行を作らずに読めている（読むだけで表が増えない）。
    expect(
      await countRows(
        'SELECT COUNT(*) AS n FROM web_booking_settings WHERE organization_id = ?',
        t.org,
      ),
    ).toBe(0)
  })

  it('ご案内のページは stores.slug から組み立てる', async () => {
    const t = await webTenant()
    expect(await readSettings(t)).toMatchObject({ landingPath: `eyex.jp/${t.slug}` })

    // slug を変えれば案内のページも変わる。表に持っていたら追随しない。
    const renamed = `ginza-${crypto.randomUUID().slice(0, 12)}`
    await env.DB.prepare('UPDATE stores SET slug = ? WHERE id = ?').bind(renamed, t.storeId).run()
    expect(await readSettings(t)).toMatchObject({ landingPath: `eyex.jp/${renamed}` })
  })

  it('公開する目的は is_web_published と is_active の両方が立つ行だけ', async () => {
    const t = await webTenant()
    const stopped = t.published[4]
    if (stopped === undefined) throw new Error('目的が足りない')
    await env.DB.prepare('UPDATE visit_purposes SET is_active = ? WHERE id = ?')
      .bind('0', stopped.id)
      .run()

    const settings = await readSettings(t)
    const ids = settings.publishedPurposeIds as string[]
    expect(ids).toHaveLength(4)
    expect(ids).not.toContain(stopped.id)
    expect(ids).not.toContain(t.hidden.id)
  })
})

describe('公開設定の保存', () => {
  it('版が一致すれば保存でき、版が 1 つ進む', async () => {
    const t = await webTenant()
    const before = await readSettings(t)
    const res = await call(settingsPath(t.storeId), {
      method: 'PUT',
      headers: authed(t.manager),
      body: toInput(before, { message: 'ご来店をお待ちしております。', acceptUntilDays: 45 }),
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      message: 'ご来店をお待ちしております。',
      acceptUntilDays: 45,
      version: Number(before.version) + 1,
    })
    expect(await readSettings(t)).toMatchObject({
      message: 'ご来店をお待ちしております。',
      acceptUntilDays: 45,
    })
  })

  it('古い版で保存すると 409 version_conflict になり、1 行も書き換わらない', async () => {
    const t = await webTenant()
    const stale = await readSettings(t)
    const first = await call(settingsPath(t.storeId), {
      method: 'PUT',
      headers: authed(t.manager),
      body: toInput(stale, { message: '先に保存した文' }),
    })
    expect(first.status).toBe(200)

    const second = await call(settingsPath(t.storeId), {
      method: 'PUT',
      headers: authed(t.manager),
      body: toInput(stale, { message: 'あとから来た文', acceptUntilDays: 7 }),
    })
    expect(second.status).toBe(409)
    expect(second.body).toMatchObject({ error: 'version_conflict' })

    const after = await readSettings(t)
    expect(after).toMatchObject({ message: '先に保存した文', acceptUntilDays: 30 })
  })

  it('公開する目的が 0 件のまま公開しようとすると 422 で拒む', async () => {
    const t = await webTenant({ publish: false })
    const settings = await readSettings(t)
    const res = await call(settingsPath(t.storeId), {
      method: 'PUT',
      headers: authed(t.manager),
      body: toInput(settings, { isPublished: true, publishedPurposeIds: [] }),
    })
    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({ error: 'invalid_input' })
    expect(await readSettings(t)).toMatchObject({ isPublished: false })
  })

  it('受け付ける時間の前後が逆なら 400 で拒む', async () => {
    const t = await webTenant()
    const settings = await readSettings(t)
    const res = await call(settingsPath(t.storeId), {
      method: 'PUT',
      headers: authed(t.manager),
      body: toInput(settings, { opensAt: '18:00', closesAt: '10:30' }),
    })
    expect(res.status).toBe(400)
    expect(await readSettings(t)).toMatchObject({ opensAt: '10:30', closesAt: '18:00' })
  })

  it('お知らせ文が 121 文字なら 400 で拒み、120 文字は保存できる', async () => {
    const t = await webTenant()
    const settings = await readSettings(t)
    const tooLong = await call(settingsPath(t.storeId), {
      method: 'PUT',
      headers: authed(t.manager),
      body: toInput(settings, { message: 'あ'.repeat(121) }),
    })
    expect(tooLong.status).toBe(400)

    const fits = await call(settingsPath(t.storeId), {
      method: 'PUT',
      headers: authed(t.manager),
      body: toInput(settings, { message: 'あ'.repeat(120) }),
    })
    expect(fits.status).toBe(200)
    expect(String((await readSettings(t)).message)).toHaveLength(120)
  })

  it('店長でないスタッフの保存は 403 で、入力を捨てない', async () => {
    const t = await webTenant()
    const settings = await readSettings(t)
    const res = await call(settingsPath(t.storeId), {
      method: 'PUT',
      headers: authed(t.token),
      body: toInput(settings, { message: 'スタッフが書いた文', isPublished: false }),
    })
    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ error: 'forbidden' })
    // 値は 1 つも変わらない（画面が下書きを持ったまま店長を呼べる）。
    expect(await readSettings(t)).toMatchObject({ message: '', isPublished: true })
  })
})

describe('お客様の画面の見え方', () => {
  it('未保存の目的とお知らせ文をクエリで受け取り、保存しないまま返す', async () => {
    const t = await webTenant()
    const two = t.published.slice(0, 2)
    const res = await call(
      `${settingsPath(t.storeId)}/preview?purposeIds=${two.map((p) => p.id).join(',')}&message=${encodeURIComponent('棚卸しのため9月1日は休みます。')}`,
      { headers: authed(t.manager) },
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      storeName: 'EYEX 銀座店',
      message: '棚卸しのため9月1日は休みます。',
    })
    expect((res.body.purposes as Json[]).map((p) => p.id)).toEqual(two.map((p) => p.id))

    // プレビューは保存を伴わない。
    expect(await readSettings(t)).toMatchObject({ message: '' })
    expect((await readSettings(t)).publishedPurposeIds).toHaveLength(5)
  })

  it('出るのは対客名だけで、店内名は 1 つも出ない', async () => {
    const t = await webTenant()
    const res = await call(`${settingsPath(t.storeId)}/preview`, { headers: authed(t.manager) })
    expect(res.status).toBe(200)
    const text = JSON.stringify(res.body)
    for (const purpose of t.published) {
      expect(text).toContain(purpose.pub)
      expect(text).not.toContain(purpose.internal)
    }
    expect(text).not.toContain('銀座本店（本部管理）')
  })

  it('公開する目的の件数とプレビューの件数が一致する', async () => {
    const t = await webTenant()
    const settings = await readSettings(t)
    const preview = await call(`${settingsPath(t.storeId)}/preview`, {
      headers: authed(t.manager),
    })
    expect((settings.publishedPurposeIds as string[]).length).toBe(5)
    expect((preview.body.purposes as Json[]).length).toBe(
      (settings.publishedPurposeIds as string[]).length,
    )
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * T-005 公開面の読み取り
 * ─────────────────────────────────────────────────────────────────────────── */

describe('店舗一覧', () => {
  it('公開している店舗だけを登録順（sort_order）で返す', async () => {
    // 一覧は全組織横断で `limit` が 10 までなので、先に立った店舗（`sort_order` 0）の
    // 前へ置く。並びを見たいのであって、混ざる件数を見たいのではない。
    const third = await webTenant({ sortOrder: -30, namePublic: 'EYEX 渋谷店' })
    const first = await webTenant({ sortOrder: -50, namePublic: 'EYEX 銀座店' })
    const second = await webTenant({ sortOrder: -40, namePublic: 'EYEX 丸の内店' })
    const closed = await webTenant({ publish: false, sortOrder: -45 })

    const res = await callList('/api/public/stores?limit=10')
    expect(res.status).toBe(200)
    const mine = res.body.filter((store) =>
      [first.slug, second.slug, third.slug, closed.slug].includes(String(store.slug)),
    )
    expect(mine.map((store) => store.name)).toEqual(['EYEX 銀座店', 'EYEX 丸の内店', 'EYEX 渋谷店'])
  })

  it('公開している店舗が 0 件なら空配列を返す', async () => {
    const a = await webTenant({ publish: false })
    const b = await webTenant({ publish: false })
    const res = await callList('/api/public/stores?limit=10')
    expect(res.status).toBe(200)
    expect(res.body.filter((s) => [a.slug, b.slug].includes(String(s.slug)))).toEqual([])
  })
})

describe('店舗の詳細', () => {
  it('存在しない slug と、公開していない店舗の slug は同じ 404 になる', async () => {
    const hidden = await webTenant({ publish: false })
    const missing = await call(
      `/api/public/stores/no-such-store-${crypto.randomUUID().slice(0, 8)}`,
    )
    const unpublished = await call(`/api/public/stores/${hidden.slug}`)
    expect(missing.status).toBe(404)
    expect(unpublished.status).toBe(404)
    // body まで同じにする。code が違えば slug の実在が読めてしまう。
    expect(unpublished.body).toEqual(missing.body)
  })

  it('お客様に見せる店名（stores.name_public）を返し、店内名を返さない', async () => {
    const t = await webTenant()
    const res = await call(`/api/public/stores/${t.slug}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      slug: t.slug,
      name: 'EYEX 銀座店',
      accessNote: '銀座駅 A2出口から徒歩3分',
      isPublished: true,
    })
    expect(JSON.stringify(res.body)).not.toContain('銀座本店（本部管理）')
  })
})

describe('ご用件', () => {
  it('is_web_published が立つ 5 件だけを sort_order 順に返す', async () => {
    const t = await webTenant()
    const res = await callList(`/api/public/stores/${t.slug}/purposes`)
    expect(res.status).toBe(200)
    expect(res.body.map((p) => p.id)).toEqual(t.published.map((p) => p.id))
  })

  it("修理・部品交換（is_web_published='0'）は API からも返らない", async () => {
    const t = await webTenant()
    const res = await callList(`/api/public/stores/${t.slug}/purposes`)
    expect(res.body.map((p) => p.id)).not.toContain(t.hidden.id)
    expect(JSON.stringify(res.body)).not.toContain('修理・部品の交換')
  })

  it('返るのは対客名（name_public）で、店内名・技能・設備は 1 つも含まない', async () => {
    const t = await webTenant()
    const res = await callList(`/api/public/stores/${t.slug}/purposes`)
    const text = JSON.stringify(res.body)
    expect(text).toContain('新しいメガネを作る')
    for (const purpose of t.published) expect(text).not.toContain(purpose.internal)
    expect(text).not.toContain('視力測定機 A')
    expect(text).not.toContain('佐藤 美咲')
    expect(res.body.every((p) => Object.keys(p).sort().join(',') === 'durationMinutes,id,name'))
  })
})

describe('空き枠', () => {
  const week = (t: WebTenant, purposeId: string, from = VISIT, days = 6) =>
    `/api/public/stores/${t.slug}/availability?purposeId=${purposeId}&from=${from}&to=${plusDays(from, days)}`

  it('満席の枠は isAvailable=false で返り、担当名も設備名も含まない', async () => {
    const t = await webTenant({ maxParallel: 1 })
    const purpose = t.published[0]
    if (purpose === undefined) throw new Error('目的が無い')
    const taken = await book(t, { startsAt: at(VISIT, '14:00') })
    expect(taken.status).toBe(200)

    const res = await call(week(t, purpose.id))
    expect(res.status).toBe(200)
    const day = (res.body.days as Json[]).find((d) => d.date === VISIT)
    const slots = day?.slots as Json[]
    const full = slots.find((slot) => slot.startsAt === at(VISIT, '14:00'))
    expect(full).toMatchObject({ isAvailable: false })
    const text = JSON.stringify(res.body)
    expect(text).not.toContain('佐藤 美咲')
    expect(text).not.toContain('視力測定機 A')
    expect(Object.keys(full ?? {}).sort()).toEqual(['isAvailable', 'startsAt'])
  })

  it('定休日は isClosed=true で、その日の枠を 1 つも返さない', async () => {
    const closedDate = plusDays(VISIT, 2)
    const t = await webTenant({ closedWeekdays: [weekdayOf(closedDate)] })
    const purpose = t.published[0]
    if (purpose === undefined) throw new Error('目的が無い')
    const res = await call(week(t, purpose.id))
    const day = (res.body.days as Json[]).find((d) => d.date === closedDate)
    expect(day).toMatchObject({ isClosed: true })
    expect(day?.slots).toEqual([])
  })

  it('お昼の受付停止帯（12:00–13:00）の枠を返さない', async () => {
    const t = await webTenant()
    const purpose = t.published[0]
    if (purpose === undefined) throw new Error('目的が無い')
    const res = await call(week(t, purpose.id))
    const day = (res.body.days as Json[]).find((d) => d.date === VISIT)
    const starts = ((day?.slots ?? []) as Json[]).map((slot) => slot.startsAt)
    expect(starts).not.toContain(at(VISIT, '12:00'))
    expect(starts).not.toContain(at(VISIT, '12:30'))
    expect(starts).toContain(at(VISIT, '13:00'))
  })

  it('8 日ぶんを求めると 400 で落ちる', async () => {
    const t = await webTenant()
    const purpose = t.published[0]
    if (purpose === undefined) throw new Error('目的が無い')
    const res = await call(week(t, purpose.id, VISIT, 7))
    expect(res.status).toBe(400)
  })

  it('公開していない目的を指定すると 409 purpose_unavailable になる', async () => {
    const t = await webTenant()
    const res = await call(week(t, t.hidden.id))
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'purpose_unavailable' })
  })

  it('公開面の計算では KV を 1 度も読まない', async () => {
    const t = await webTenant()
    const purpose = t.published[0]
    if (purpose === undefined) throw new Error('目的が無い')
    // KV の list は無料枠 1,000 回/日で、公開ページの閲覧数がそのまま list 数になる。
    const list = vi.spyOn(env.SHORT_LIVED, 'list')
    const res = await call(week(t, purpose.id))
    expect(res.status).toBe(200)
    expect(list).not.toHaveBeenCalled()
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * T-006 予約の作成・冪等・枠競合
 * ─────────────────────────────────────────────────────────────────────────── */

describe('予約の作成', () => {
  it("reservations（source='web'）と web_bookings が 1 件ずつできる", async () => {
    const t = await webTenant()
    const res = await book(t)
    expect(res.status).toBe(200)
    expect(
      await countRows(
        "SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ? AND source = 'web'",
        t.org,
      ),
    ).toBe(1)
    expect(
      await countRows('SELECT COUNT(*) AS n FROM web_bookings WHERE organization_id = ?', t.org),
    ).toBe(1)
    expect(
      await countRows(
        'SELECT COUNT(*) AS n FROM reservation_slot_locks WHERE organization_id = ?',
        t.org,
      ),
    ).toBeGreaterThan(0)
  })

  it('ご予約番号は EY-W-YYMM-NNNN で、reservations.code の EY-YYMM-NNNN とは別に採番される', async () => {
    const t = await webTenant()
    const res = await book(t)
    expect(String(res.body.code)).toMatch(/^EY-W-\d{4}-\d{4,5}$/)
    const row = await env.DB.prepare(
      'SELECT code FROM reservations WHERE organization_id = ? LIMIT 1',
    )
      .bind(t.org)
      .first<{ code: string }>()
    expect(row?.code).toMatch(/^EY-\d{4}-\d{4,5}$/)
    expect(row?.code).not.toBe(res.body.code)
  })

  it('確認番号の平文は作成の応答にだけ現れ、D1 にはハッシュしか無い', async () => {
    const t = await webTenant()
    const res = await book(t)
    const plain = String(res.body.managementCode)
    expect(plain.length).toBeGreaterThanOrEqual(8)
    const row = await env.DB.prepare(
      'SELECT management_code_hash AS hash, confirmation_key_hash AS key FROM web_bookings WHERE organization_id = ?',
    )
      .bind(t.org)
      .first<{ hash: string; key: string }>()
    expect(row?.hash).not.toBe(plain)
    expect(row?.hash).not.toContain(plain)
    expect(row?.key).not.toContain(plain)
  })

  it('承認要否が「お店が確かめてから確定する」なら web_bookings.status は pending になる', async () => {
    const t = await webTenant()
    const res = await book(t)
    expect(res.body.status).toBe('pending')
    const row = await env.DB.prepare('SELECT status FROM web_bookings WHERE organization_id = ?')
      .bind(t.org)
      .first<{ status: string }>()
    expect(row?.status).toBe('pending')
  })

  it('予約本体は作成の時点で confirmed で、承認は web_bookings.status だけを動かす', async () => {
    const t = await webTenant()
    await book(t)
    const row = await env.DB.prepare('SELECT status FROM reservations WHERE organization_id = ?')
      .bind(t.org)
      .first<{ status: string }>()
    expect(row?.status).toBe('confirmed')

    const web = await env.DB.prepare('SELECT id FROM web_bookings WHERE organization_id = ?')
      .bind(t.org)
      .first<{ id: string }>()
    const review = await call(`/api/staff/web-bookings/${web?.id}/review`, {
      method: 'POST',
      headers: authed(t.manager),
      body: { decision: 'approve' },
    })
    expect(review.status).toBe(200)
    const after = await env.DB.prepare('SELECT status FROM web_bookings WHERE organization_id = ?')
      .bind(t.org)
      .first<{ status: string }>()
    expect(after?.status).toBe('confirmed')
  })

  it('受け付ける時間の外の時刻を送ると 409 store_closed になる', async () => {
    const t = await webTenant()
    // 店舗は 19:00 まで開いているが、Web で受けるのは 18:00 まで。
    const res = await book(t, { startsAt: at(VISIT, '18:30') })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'store_closed' })
    expect(
      await countRows('SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?', t.org),
    ).toBe(0)
  })

  it('公開していない店舗へ送ると 404 になる', async () => {
    const t = await webTenant({ publish: false })
    const res = await book(t)
    expect(res.status).toBe(404)
    expect(
      await countRows('SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?', t.org),
    ).toBe(0)
  })
})

describe('冪等', () => {
  it('同じ Idempotency-Key と同じ内容の再送は、同じご予約番号を返して予約を 1 件に保つ', async () => {
    const t = await webTenant()
    const key = crypto.randomUUID()
    const first = await book(t, { key })
    const second = await book(t, { key })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.code).toBe(first.body.code)
    expect(second.body.managementCode).toBe(first.body.managementCode)
    expect(
      await countRows('SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?', t.org),
    ).toBe(1)
  })

  it('同じ Idempotency-Key で違う内容を送ると 409 idempotency_conflict になる', async () => {
    const t = await webTenant()
    const key = crypto.randomUUID()
    expect((await book(t, { key })).status).toBe(200)
    const other = await book(t, { key, contactName: '別の お客様' })
    expect(other.status).toBe(409)
    expect(other.body).toMatchObject({ error: 'idempotency_conflict' })
  })

  it('処理中（in_progress）の鍵へ重ねて送ると 409 idempotency_conflict になる', async () => {
    const t = await webTenant()
    const key = crypto.randomUUID()
    const now = new Date()
    // 途中で回線が切れた端末が残した行を模す。
    await env.DB.prepare(
      "INSERT INTO idempotency_records (key, organization_id, scope, request_hash, response_json, status, created_at, expires_at) VALUES (?,?,?,?,NULL,'in_progress',?,?)",
    )
      .bind(
        `${t.org}:public.booking.create:${key}`,
        t.org,
        'public.booking.create',
        'a'.repeat(64),
        now.toISOString(),
        new Date(now.getTime() + 86_400_000).toISOString(),
      )
      .run()
    const res = await book(t, { key })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'idempotency_conflict' })
  })
})

describe('枠競合', () => {
  it('送信の瞬間に枠が埋まっていると 409 slot_taken になり、代わりの時刻が 3 件返る', async () => {
    const t = await webTenant({ maxParallel: 1 })
    expect((await book(t, { startsAt: at(VISIT, '15:00') })).status).toBe(200)
    const res = await book(t, { startsAt: at(VISIT, '15:00') })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'slot_taken' })
    expect((res.body.alternatives as Json[]).length).toBe(3)
  })

  it('409 slot_taken のとき、予約も占有行も 1 行も書かれていない', async () => {
    const t = await webTenant({ maxParallel: 1 })
    expect((await book(t, { startsAt: at(VISIT, '15:00') })).status).toBe(200)
    const locksBefore = await countRows(
      'SELECT COUNT(*) AS n FROM reservation_slot_locks WHERE organization_id = ?',
      t.org,
    )
    const res = await book(t, { startsAt: at(VISIT, '15:00') })
    expect(res.status).toBe(409)
    expect(
      await countRows('SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?', t.org),
    ).toBe(1)
    expect(
      await countRows('SELECT COUNT(*) AS n FROM web_bookings WHERE organization_id = ?', t.org),
    ).toBe(1)
    expect(
      await countRows(
        'SELECT COUNT(*) AS n FROM reservation_slot_locks WHERE organization_id = ?',
        t.org,
      ),
    ).toBe(locksBefore)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * T-007 照会・変更・取消・確認番号・メール失敗
 * ─────────────────────────────────────────────────────────────────────────── */

describe('本人確認', () => {
  it('ご予約番号と確認番号が合えば短命の鍵を返す', async () => {
    const t = await webTenant()
    const { code, managementCode } = await booked(t)
    const res = await call('/api/public/reservations/verify', {
      method: 'POST',
      headers: mgmt(managementCode),
      body: { code, contactEmail: 'm.yamaguchi@example.jp' },
    })
    expect(res.status).toBe(200)
    expect(String(res.body.managementCode).length).toBeGreaterThanOrEqual(8)
    expect(Date.parse(String(res.body.expiresAt))).toBeGreaterThan(Date.now())
  })

  it('確認番号が違うと 401 で、明細は 1 行も返らない', async () => {
    const t = await webTenant()
    const { code } = await booked(t)
    const res = await call('/api/public/reservations/verify', {
      method: 'POST',
      headers: mgmt('ZZZZZZZZ'),
      body: { code, contactEmail: 'm.yamaguchi@example.jp' },
    })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'invalid_management_code' })
    expect(Object.keys(res.body)).toEqual(['error'])
  })

  it('存在しないご予約番号と、確認番号違いは同じ文言・同じ status で返る', async () => {
    const t = await webTenant()
    const { code } = await booked(t)
    const wrongCode = await call('/api/public/reservations/verify', {
      method: 'POST',
      headers: mgmt('ZZZZZZZZ'),
      body: { code: 'EY-W-2608-9999', contactEmail: 'm.yamaguchi@example.jp' },
    })
    const wrongMgmt = await call('/api/public/reservations/verify', {
      method: 'POST',
      headers: mgmt('YYYYYYYY'),
      body: { code, contactEmail: 'm.yamaguchi@example.jp' },
    })
    expect(wrongCode.status).toBe(wrongMgmt.status)
    expect(wrongCode.body).toEqual(wrongMgmt.body)
  })

  it('1 時間に 10 回失敗すると 429 management_code_locked になり、retryAfterSeconds は 900', async () => {
    const t = await webTenant()
    const { code } = await booked(t)
    const ip = { 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 200) + 1}` }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const res = await call('/api/public/reservations/verify', {
        method: 'POST',
        headers: { ...mgmt('ZZZZZZZZ'), ...ip },
        body: { code, contactEmail: 'm.yamaguchi@example.jp' },
      })
      expect(res.status).toBe(401)
    }
    const locked = await call('/api/public/reservations/verify', {
      method: 'POST',
      headers: { ...mgmt('ZZZZZZZZ'), ...ip },
      body: { code, contactEmail: 'm.yamaguchi@example.jp' },
    })
    expect(locked.status).toBe(429)
    expect(locked.body).toMatchObject({
      error: 'management_code_locked',
      retryAfterSeconds: 900,
    })
  })
})

describe('照会', () => {
  it('明細はご来店・店舗・ご用件・お名前・ご予約番号の 5 つで、確認番号を含まない', async () => {
    const t = await webTenant()
    const { code, managementCode } = await booked(t)
    const short = await verified(code, managementCode)
    const res = await call(`/api/public/reservations/${code}`, { headers: mgmt(short) })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      code,
      startsAt: at(VISIT, '11:00'),
      storeName: 'EYEX 銀座店',
      purposeName: '新しいメガネを作る',
      contactName: '山口 真央',
    })
    expect(res.body).not.toHaveProperty('managementCode')
    expect(JSON.stringify(res.body)).not.toContain(managementCode)
  })

  it('変更の締切（changeDeadlineAt）を応答に載せる', async () => {
    const t = await webTenant()
    const { code, managementCode } = await booked(t)
    const short = await verified(code, managementCode)
    const res = await call(`/api/public/reservations/${code}`, { headers: mgmt(short) })
    // 既定は前日の 23:59:59.999 JST。
    expect(res.body.changeDeadlineAt).toBe(
      new Date(Date.parse(`${plusDays(VISIT, -1)}T23:59:59.999+09:00`)).toISOString(),
    )
  })
})

describe('日時の変更', () => {
  it('別の空いている時刻へ移すと、台帳の予約も同じ時刻に移る', async () => {
    const t = await webTenant()
    const { code, managementCode } = await booked(t)
    const short = await verified(code, managementCode)
    const res = await call(`/api/public/reservations/${code}`, {
      method: 'PATCH',
      headers: { ...mgmt(short), 'idempotency-key': crypto.randomUUID() },
      body: { startsAt: at(VISIT, '16:00') },
    })
    expect(res.status).toBe(200)
    expect(res.body.startsAt).toBe(at(VISIT, '16:00'))
    const row = await env.DB.prepare(
      'SELECT starts_at AS startsAt FROM reservations WHERE organization_id = ?',
    )
      .bind(t.org)
      .first<{ startsAt: string }>()
    expect(row?.startsAt).toBe(at(VISIT, '16:00'))
  })

  it('変更のあとに previousStartsAt で元の時刻が読める', async () => {
    const t = await webTenant()
    const { code, managementCode } = await booked(t)
    const short = await verified(code, managementCode)
    const res = await call(`/api/public/reservations/${code}`, {
      method: 'PATCH',
      headers: { ...mgmt(short), 'idempotency-key': crypto.randomUUID() },
      body: { startsAt: at(VISIT, '16:30') },
    })
    expect(res.body.previousStartsAt).toBe(at(VISIT, '11:00'))
  })

  it('移す先が埋まっていると 409 slot_taken になり、元の時刻のまま残る', async () => {
    const t = await webTenant({ maxParallel: 1 })
    expect((await book(t, { startsAt: at(VISIT, '17:00') })).status).toBe(200)
    const mine = await booked(t, at(VISIT, '11:00'))
    const short = await verified(mine.code, mine.managementCode)
    const res = await call(`/api/public/reservations/${mine.code}`, {
      method: 'PATCH',
      headers: { ...mgmt(short), 'idempotency-key': crypto.randomUUID() },
      body: { startsAt: at(VISIT, '17:00') },
    })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'slot_taken' })
    const detail = await call(`/api/public/reservations/${mine.code}`, { headers: mgmt(short) })
    expect(detail.body.startsAt).toBe(at(VISIT, '11:00'))
  })
})

describe('取消', () => {
  it('取り消すと web_bookings と reservations の両方が cancelled になる', async () => {
    const t = await webTenant()
    const { code, managementCode } = await booked(t)
    const short = await verified(code, managementCode)
    const res = await call(`/api/public/reservations/${code}/cancel`, {
      method: 'POST',
      headers: { ...mgmt(short), 'idempotency-key': crypto.randomUUID() },
      body: { reason: '' },
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ code, status: 'cancelled' })
    const web = await env.DB.prepare('SELECT status FROM web_bookings WHERE organization_id = ?')
      .bind(t.org)
      .first<{ status: string }>()
    const ledger = await env.DB.prepare(
      'SELECT status, cancel_reason AS reason FROM reservations WHERE organization_id = ?',
    )
      .bind(t.org)
      .first<{ status: string; reason: string }>()
    expect(web?.status).toBe('cancelled')
    expect(ledger?.status).toBe('cancelled')
  })

  it('取り消した予約をもう一度取り消そうとしても、状態も取消日時も変わらない', async () => {
    const t = await webTenant()
    const { code, managementCode } = await booked(t)
    const short = await verified(code, managementCode)
    const first = await call(`/api/public/reservations/${code}/cancel`, {
      method: 'POST',
      headers: { ...mgmt(short), 'idempotency-key': crypto.randomUUID() },
      body: { reason: '' },
    })
    expect(first.status).toBe(200)
    const before = await env.DB.prepare(
      'SELECT status, cancelled_at AS cancelledAt FROM web_bookings WHERE organization_id = ?',
    )
      .bind(t.org)
      .first<{ status: string; cancelledAt: string }>()

    const again = await call(`/api/public/reservations/${code}/cancel`, {
      method: 'POST',
      headers: { ...mgmt(short), 'idempotency-key': crypto.randomUUID() },
      body: { reason: '' },
    })
    expect(again.status).toBe(409)
    const after = await env.DB.prepare(
      'SELECT status, cancelled_at AS cancelledAt FROM web_bookings WHERE organization_id = ?',
    )
      .bind(t.org)
      .first<{ status: string; cancelledAt: string }>()
    expect(after).toEqual(before)
  })
})

describe('締切', () => {
  it('締切を過ぎた変更は 409 change_deadline_passed で、日時も状態も変わらない', async () => {
    const t = await webTenant()
    // 来店日は「きょう」。既定（前日まで）の締切はもう過ぎている。
    const seeded = await seedWebBooking(t, { startsAt: at(TODAY, '17:00') })
    const short = await verified(seeded.code, seeded.managementCode)
    const res = await call(`/api/public/reservations/${seeded.code}`, {
      method: 'PATCH',
      headers: { ...mgmt(short), 'idempotency-key': crypto.randomUUID() },
      body: { startsAt: at(VISIT, '11:00') },
    })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'change_deadline_passed' })
    const row = await env.DB.prepare(
      'SELECT starts_at AS startsAt, status FROM reservations WHERE id = ?',
    )
      .bind(seeded.reservationId)
      .first<{ startsAt: string; status: string }>()
    expect(row).toEqual({ startsAt: at(TODAY, '17:00'), status: 'confirmed' })
  })

  it('締切を過ぎた取消は 409 change_deadline_passed で、日時も状態も変わらない', async () => {
    const t = await webTenant()
    const seeded = await seedWebBooking(t, { startsAt: at(TODAY, '17:00') })
    const short = await verified(seeded.code, seeded.managementCode)
    const res = await call(`/api/public/reservations/${seeded.code}/cancel`, {
      method: 'POST',
      headers: { ...mgmt(short), 'idempotency-key': crypto.randomUUID() },
      body: { reason: '' },
    })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'change_deadline_passed' })
    const row = await env.DB.prepare(
      'SELECT starts_at AS startsAt, status FROM reservations WHERE id = ?',
    )
      .bind(seeded.reservationId)
      .first<{ startsAt: string; status: string }>()
    expect(row).toEqual({ startsAt: at(TODAY, '17:00'), status: 'confirmed' })
  })
})

describe('確認メール', () => {
  it('送れたときだけ emailed が true になる', async () => {
    const t = await webTenant()
    const ok = await book(t)
    expect(ok.body.emailed).toBe(true)

    const other = await webTenant()
    vi.spyOn(env.NOTIFIER, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'send_failed' }), { status: 502 }),
    )
    const failed = await book(other)
    expect(failed.body.emailed).toBe(false)
  })

  it('notifier が 502 を返しても予約は成立し、ご予約番号と確認番号が返る', async () => {
    const t = await webTenant()
    vi.spyOn(env.NOTIFIER, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'send_failed' }), { status: 502 }),
    )
    const res = await book(t)
    expect(res.status).toBe(200)
    expect(String(res.body.code)).toMatch(/^EY-W-\d{4}-\d{4,5}$/)
    expect(String(res.body.managementCode).length).toBeGreaterThanOrEqual(8)
    expect(
      await countRows('SELECT COUNT(*) AS n FROM web_bookings WHERE organization_id = ?', t.org),
    ).toBe(1)
  })

  it('notifier が落ちたことを console.error に残す', async () => {
    const t = await webTenant()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(env.NOTIFIER, 'fetch').mockRejectedValue(new Error('binding is down'))
    const res = await book(t)
    expect(res.status).toBe(200)
    expect(logged).toHaveBeenCalled()
    expect(logged.mock.calls.some((args) => String(args[0]).includes('notify failed'))).toBe(true)
  })

  it('送れなかったときに冪等キーを残さない', async () => {
    const t = await webTenant()
    const failing = vi
      .spyOn(env.NOTIFIER, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: 'send_failed' }), { status: 502 }))
    const res = await book(t)
    const reservationId = await env.DB.prepare(
      'SELECT reservation_id AS id FROM web_bookings WHERE organization_id = ?',
    )
      .bind(t.org)
      .first<{ id: string }>()
    expect(res.body.emailed).toBe(false)
    // 鍵を残すと、次に照会が来ても再送されない（`04-api.md` §7.2 の「再検知」）。
    expect(await env.SHORT_LIVED.get(`mailsent:${t.org}:${reservationId?.id}`)).toBeNull()

    // 送れる状態に戻して、控えが**置かれる**ほうも同じテストで見る。
    failing.mockRestore()
    const sent = await webTenant()
    await book(sent)
    const okId = await env.DB.prepare(
      'SELECT reservation_id AS id FROM web_bookings WHERE organization_id = ?',
    )
      .bind(sent.org)
      .first<{ id: string }>()
    expect(await env.SHORT_LIVED.get(`mailsent:${sent.org}:${okId?.id}`)).not.toBeNull()
  })

  it('store名には stores.name_public を渡し、店内名を渡さない', async () => {
    const t = await webTenant()
    const notify = vi.spyOn(env.NOTIFIER, 'fetch')
    await book(t)
    expect(notify).toHaveBeenCalled()
    const call0 = notify.mock.calls[0]
    const init = call0?.[1] as RequestInit | undefined
    const job = JSON.parse(String(init?.body)) as { payload: { storeName: string } }
    expect(job.payload.storeName).toBe('EYEX 銀座店')
    expect(String(init?.body)).not.toContain('銀座本店（本部管理）')
  })

  it('取消のときはメールを送らない（notification.ts に型が無い）', async () => {
    const t = await webTenant()
    const { code, managementCode } = await booked(t)
    const short = await verified(code, managementCode)
    const notify = vi.spyOn(env.NOTIFIER, 'fetch')
    const res = await call(`/api/public/reservations/${code}/cancel`, {
      method: 'POST',
      headers: { ...mgmt(short), 'idempotency-key': crypto.randomUUID() },
      body: { reason: '' },
    })
    expect(res.status).toBe(200)
    expect(notify).not.toHaveBeenCalled()
  })
})
