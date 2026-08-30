/**
 * P2 台帳・空き枠・ご予約 1 件の代表フロー。
 *
 * 行の組み立てそのものは `ledger.test.ts`、枠の判定は `availability.time.test.ts` が
 * 純関数として押さえてある（8 条件 19 本と境界値 17 本はこの 1 ファイルにある）。ここで見るのは
 * **ルートを通したときの形**である —
 * 応答が契約どおりか / `serverNow` が載っているか / 1 日分を 1 回の `db.batch()` で読むか /
 * 打ち間違えたクエリが 400 になるか / 無いものが 404 になるか。
 *
 * P2 に予約を**書く** API は無い（`POST /api/staff/reservations` は P3）ので、
 * 材料は `helpers.ts` の直 INSERT で置く。D1 はテストファイル内で共有されるため、
 * 組織 id・店舗 id は毎回 `crypto.randomUUID()` から作る。
 */
import { env, SELF } from 'cloudflare:test'
import type { D1Database } from '@cloudflare/workers-types'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  authed,
  BASE,
  insertBusinessHours,
  insertCalendarException,
  insertEquipment,
  insertMaintenance,
  insertReservation,
  insertShift,
  insertSlotRules,
  insertStaff,
  insertStore,
  insertVisitPurpose,
  jstAt,
  LEDGER_DATE,
  orgId,
  setStoreActive,
  tokenFor,
} from './helpers'

/** 定休日（火曜）。銀座店の営業時間 7 行は火曜だけを閉めてある。 */
const CLOSED_DATE = '2026-09-01'

type Fixture = Awaited<ReturnType<typeof seedTenant>>

type LedgerLane = {
  kind: 'staff' | 'equipment' | 'unassigned' | 'walkin'
  id: string | null
  name: string
  subtitle: string
  entries: {
    reservationId: string
    startsAt: string
    endsAt: string
    purposeLabel: string
    source: string
    status: string
    isUnassigned: boolean
    customerName: string | null
    visitCount: number | null
  }[]
  blocks: { kind: string; startsAt: string; endsAt: string; label: string }[]
}

type LedgerView = {
  date: string
  axis: 'staff' | 'resource'
  view: 'timetable' | 'list'
  opensAt: string | null
  closesAt: string | null
  slotMinutes: number
  lanes: LedgerLane[]
  counts: { all: number; upcoming: number; pendingReview: number }
  serverNow: string
}

type AvailabilityResponse = {
  date: string
  opensAt: string | null
  closesAt: string | null
  isClosed: boolean
  slotMinutes: number
  cleanupMinutes: number
  durationMinutes: number
  slots: { startsAt: string; isAvailable: boolean; remaining: number; reason: string | null }[]
  lanes: { kind: string; id: string | null; name: string }[]
  alternatives: unknown[]
  reason: string | null
  serverNow: string
}

/**
 * 銀座店 1 日分。担当 3 名・設備 2 台・ご用件 3 件と、8月27日（木）の予約 6 件。
 * うち 1 件は取り消し（帯にしない）、1 件は ご来店なし（帯にする）。
 */
async function seedTenant() {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await insertStore(org)
  await insertBusinessHours(org, storeId)
  await insertSlotRules(org, storeId)

  const sato = await insertStaff(org, storeId, {
    displayName: '佐藤 美咲',
    sortOrder: 0,
    skills: ['measure', 'sales_reception'],
  })
  const takahashi = await insertStaff(org, storeId, {
    displayName: '高橋 健',
    sortOrder: 1,
    skills: ['sales_reception'],
  })
  const nakamura = await insertStaff(org, storeId, {
    displayName: '中村 彩',
    sortOrder: 2,
    skills: ['measure', 'sales_reception'],
  })
  for (const staffId of [sato, takahashi, nakamura]) {
    await insertShift(org, storeId, staffId)
  }
  // 台帳の灰帯は担当ひとりの休憩。店舗の受付停止帯ではない。
  await insertShift(org, storeId, sato, { startsAt: '13:00', endsAt: '14:00', kind: 'break' })

  const measure = await insertEquipment(org, storeId, {
    name: '視力測定機 A',
    kind: 'measure',
    sortOrder: 0,
  })
  const counter = await insertEquipment(org, storeId, {
    name: '相談カウンター 2',
    kind: 'counter',
    roleLabel: '接客・ご相談',
    sortOrder: 1,
  })

  const newGlasses = await insertVisitPurpose(org, storeId, {
    nameInternal: 'メガネを新しく作る',
    nameShort: '新調相談',
    durationMinutes: 60,
    sortOrder: 0,
    requirements: [
      { kind: 'skill', value: 'measure' },
      { kind: 'equipment_kind', value: 'measure' },
      { kind: 'equipment_kind', value: 'counter' },
    ],
  })
  const eyesight = await insertVisitPurpose(org, storeId, {
    nameInternal: '視力測定だけ',
    nameShort: '視力測定',
    durationMinutes: 30,
    sortOrder: 1,
    requirements: [{ kind: 'skill', value: 'measure' }],
  })
  const adjust = await insertVisitPurpose(org, storeId, {
    nameInternal: '今のメガネを調整したい',
    nameShort: '調整',
    durationMinutes: 20,
    sortOrder: 2,
  })

  const at = (time: string) => jstAt(LEDGER_DATE, time)

  const r1 = await insertReservation(org, {
    storeId,
    startsAt: at('10:00'),
    durationMinutes: 30,
    source: 'phone',
    status: 'arrived',
    staffId: takahashi,
    purposes: [{ id: adjust }],
    slotLocks: true,
  })
  const r2 = await insertReservation(org, {
    storeId,
    startsAt: at('11:00'),
    durationMinutes: 60,
    source: 'phone',
    status: 'confirmed',
    staffId: sato,
    equipment: [{ id: measure }, { id: counter }],
    purposes: [{ id: newGlasses }, { id: eyesight }],
    slotLocks: true,
  })
  const r3 = await insertReservation(org, {
    storeId,
    startsAt: at('13:00'),
    durationMinutes: 20,
    source: 'web',
    status: 'confirmed',
    staffId: null,
    equipment: [{ id: counter }],
    purposes: [{ id: adjust }],
    slotLocks: true,
  })
  const r4 = await insertReservation(org, {
    storeId,
    startsAt: at('15:00'),
    durationMinutes: 60,
    source: 'counter',
    status: 'confirmed',
    staffId: nakamura,
    purposes: [{ id: newGlasses }],
    slotLocks: true,
  })
  const cancelled = await insertReservation(org, {
    storeId,
    startsAt: at('16:00'),
    durationMinutes: 30,
    source: 'phone',
    status: 'cancelled',
    staffId: takahashi,
    purposes: [{ id: adjust }],
  })
  const noShow = await insertReservation(org, {
    storeId,
    startsAt: at('17:00'),
    durationMinutes: 30,
    source: 'walkin',
    status: 'no_show',
    staffId: sato,
    purposes: [{ id: adjust }],
  })

  return {
    org,
    token,
    storeId,
    staff: { sato, takahashi, nakamura },
    equipment: { measure, counter },
    purposes: { newGlasses, eyesight, adjust },
    reservations: { r1, r2, r3, r4, cancelled, noShow },
    at,
  }
}

let fx: Fixture

beforeAll(async () => {
  fx = await seedTenant()
})

async function ledger(query: string, token = fx.token) {
  const res = await SELF.fetch(`${BASE}/api/staff/ledger?${query}`, { headers: authed(token) })
  return { status: res.status, body: (await res.json().catch(() => null)) as LedgerView }
}

async function availability(query: string, token = fx.token) {
  const res = await SELF.fetch(`${BASE}/api/staff/availability?${query}`, {
    headers: authed(token),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as AvailabilityResponse }
}

/** `fx` 以外の組織の台帳を読む（店舗を止めるテストが `fx` を汚さないため）。 */
async function ledgerOf(fixture: Fixture, date: string) {
  const res = await SELF.fetch(`${BASE}/api/staff/ledger?storeId=${fixture.storeId}&date=${date}`, {
    headers: authed(fixture.token),
  })
  return { status: res.status, body: (await res.json()) as LedgerView }
}

/** 行の中の帯を 1 本の配列に均す（どの行に居たかを問わず数えたいときに使う）。 */
const entriesOf = (view: LedgerView) => view.lanes.flatMap((lane) => lane.entries)

describe('GET /api/staff/ledger', () => {
  it('既定は axis=staff・view=timetable・filter=all で返る', async () => {
    const { status, body } = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}`)
    expect(status).toBe(200)
    expect(body.axis).toBe('staff')
    expect(body.view).toBe('timetable')
    expect(body.date).toBe(LEDGER_DATE)
    expect(body.opensAt).toBe('10:00')
    expect(body.closesAt).toBe('19:00')
    expect(body.slotMinutes).toBe(30)
    // 担当 3 行 → 「担当が未定」→ 「ご来店お待ち」の順。
    expect(body.lanes.map((lane) => lane.kind)).toEqual([
      'staff',
      'staff',
      'staff',
      'unassigned',
      'walkin',
    ])
    expect(body.lanes.map((lane) => lane.name)).toEqual([
      '佐藤 美咲',
      '高橋 健',
      '中村 彩',
      '担当が未定',
      'ご来店お待ち',
    ])
  })

  it('応答の serverNow はサーバの時計から作る（端末が送った時刻は受け取らない）', async () => {
    const before = Date.now()
    const { body } = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}`)
    const after = Date.now()
    const serverNow = Date.parse(body.serverNow)
    expect(Number.isNaN(serverNow)).toBe(false)
    expect(serverNow).toBeGreaterThanOrEqual(before)
    expect(serverNow).toBeLessThanOrEqual(after)

    // 端末の時計を本文に混ぜる道は開けない（契約は strictObject）。
    const forged = await ledger(
      `storeId=${fx.storeId}&date=${LEDGER_DATE}&serverNow=1999-01-01T00:00:00.000Z`,
    )
    expect(forged.status).toBe(400)
  })

  it('「ご来店お待ち」の行は時間軸に載らず、walk_ins がまだ無いので 0名 になる', async () => {
    const { body } = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}`)
    const walkin = body.lanes.at(-1)
    expect(walkin?.kind).toBe('walkin')
    expect(walkin?.subtitle).toBe('0名')
    expect(walkin?.entries).toEqual([])
    expect(walkin?.blocks).toEqual([])
  })

  it('お客様のお名前と来店回数はまだ描かない（customers は P4）', async () => {
    const { body } = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}`)
    expect(entriesOf(body).length).toBeGreaterThan(0)
    for (const entry of entriesOf(body)) {
      expect(entry.customerName).toBeNull()
      expect(entry.visitCount).toBeNull()
    }
  })

  it('axis=resource で縦軸が設備の行に入れ替わり、日付と view は保たれる', async () => {
    const { body } = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}&axis=resource`)
    expect(body.axis).toBe('resource')
    expect(body.view).toBe('timetable')
    expect(body.date).toBe(LEDGER_DATE)
    expect(body.lanes.map((lane) => lane.name)).toEqual(['視力測定機 A', '相談カウンター 2'])
    expect(body.lanes.every((lane) => lane.kind === 'equipment')).toBe(true)
  })

  it('1 予約が 2 つの設備を押さえていると、同じ reservationId の帯が 2 行に出る', async () => {
    const { body } = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}&axis=resource`)
    const rows = body.lanes.filter((lane) =>
      lane.entries.some((entry) => entry.reservationId === fx.reservations.r2),
    )
    expect(rows.map((lane) => lane.name)).toEqual(['視力測定機 A', '相談カウンター 2'])
  })

  it('view=list でも同じ日の帯を返し、axis は保たれる（平坦化は画面が行う）', async () => {
    const { body } = await ledger(
      `storeId=${fx.storeId}&date=${LEDGER_DATE}&axis=resource&view=list`,
    )
    expect(body.view).toBe('list')
    expect(body.axis).toBe('resource')
    // 予約リストの「担当」欄は担当の割当からしか出せないので、行は担当軸で返す。
    expect(body.lanes.map((lane) => lane.kind)).toEqual([
      'staff',
      'staff',
      'staff',
      'unassigned',
      'walkin',
    ])
  })

  it('定休日は opensAt と closesAt が null になり、行を 1 本も返さない', async () => {
    const { status, body } = await ledger(`storeId=${fx.storeId}&date=${CLOSED_DATE}`)
    expect(status).toBe(200)
    expect(body.opensAt).toBeNull()
    expect(body.closesAt).toBeNull()
    expect(body.lanes).toEqual([])
    expect(body.counts).toEqual({ all: 0, upcoming: 0, pendingReview: 0 })
  })

  it('取り消したご予約は帯にせず、ご来店がなかったご予約は帯にする', async () => {
    const { body } = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}`)
    const ids = entriesOf(body).map((entry) => entry.reservationId)
    expect(ids).not.toContain(fx.reservations.cancelled)
    expect(ids).toContain(fx.reservations.noShow)
    expect(body.counts.all).toBe(5)
  })

  it('帯のご用件は name_short を「・」で連ねる', async () => {
    const { body } = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}`)
    const entry = entriesOf(body).find((row) => row.reservationId === fx.reservations.r2)
    expect(entry?.purposeLabel).toBe('新調相談・視力測定')
  })

  it('担当が未定のご予約は「担当が未定」の行に置き、印を付ける', async () => {
    const { body } = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}`)
    const lane = body.lanes.find((row) => row.kind === 'unassigned')
    expect(lane?.entries.map((entry) => entry.reservationId)).toEqual([fx.reservations.r3])
    expect(lane?.entries[0]?.isUnassigned).toBe(true)
  })

  it('休憩は担当の行の break になり、点検は設備の行の maintenance になる', async () => {
    await insertMaintenance(fx.org, fx.storeId, fx.equipment.measure, {
      startsAt: fx.at('11:30'),
      endsAt: fx.at('12:00'),
      note: '定期点検',
    })

    const byStaff = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}`)
    const sato = byStaff.body.lanes.find((lane) => lane.id === fx.staff.sato)
    expect(sato?.blocks).toEqual([
      { kind: 'break', startsAt: fx.at('13:00'), endsAt: fx.at('14:00'), label: '休憩' },
    ])

    const byResource = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}&axis=resource`)
    const measure = byResource.body.lanes.find((lane) => lane.id === fx.equipment.measure)
    expect(measure?.blocks).toEqual([
      { kind: 'maintenance', startsAt: fx.at('11:30'), endsAt: fx.at('12:00'), label: '点検' },
    ])
  })

  it('counts の upcoming は応答の serverNow より後に始まる件数と一致する', async () => {
    const { body } = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}`)
    const now = Date.parse(body.serverNow)
    const drawn = new Map(entriesOf(body).map((entry) => [entry.reservationId, entry.startsAt]))
    const upcoming = [...drawn.values()].filter((startsAt) => Date.parse(startsAt) > now).length
    expect(body.counts.upcoming).toBe(upcoming)
  })

  it('counts の pendingReview は Web から入って担当が未定のご予約を数える', async () => {
    const { body } = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}`)
    expect(body.counts.pendingReview).toBe(1)
  })

  it('同じ組織の別店舗の予約は 1 件も混ざらない', async () => {
    const other = await insertStore(fx.org, 'EYEX 丸の内店')
    await insertBusinessHours(fx.org, other)
    await insertSlotRules(fx.org, other)
    await insertReservation(fx.org, {
      storeId: other,
      startsAt: fx.at('10:30'),
      durationMinutes: 30,
      staffId: null,
      purposes: [{ id: fx.purposes.adjust }],
    })

    const mine = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}`)
    expect(mine.body.counts.all).toBe(5)

    const theirs = await ledger(`storeId=${other}&date=${LEDGER_DATE}`)
    expect(theirs.body.counts.all).toBe(1)
  })

  it('1 日分を db.batch() 1 回・16 文以内で読む（バッチの外の文も数える）', async () => {
    const batched: number[] = []
    // `db.batch()` の外で投げた文も数える。バッチの中だけを数えると、
    // 店舗の実在を確かめる 1 文のような「バッチの外の 1 往復」が見えなくなり、
    // 07-nfr.md §「D1 クエリ本数 16 本以内」を測ったことにならない。
    let prepared = 0
    const real = env.DB
    const counted = new Proxy(real, {
      get(target, property, receiver) {
        if (property === 'batch') {
          return (statements: unknown[]) => {
            batched.push(statements.length)
            return real.batch(statements as never)
          }
        }
        if (property === 'prepare') {
          return (sql: string) => {
            prepared += 1
            return real.prepare(sql)
          }
        }
        const value = Reflect.get(target, property, receiver) as unknown
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value
      },
    })
    ;(env as unknown as { DB: D1Database }).DB = counted
    try {
      const { status } = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}`)
      expect(status).toBe(200)
    } finally {
      ;(env as unknown as { DB: D1Database }).DB = real
    }
    expect(batched).toHaveLength(1)
    expect(batched[0]).toBeLessThanOrEqual(16)
    // 台帳 1 画面の初回描画で叩く D1 の文は 13 文 —— バッチの 11 文に、
    // 組織が同期済みかを見る 1 文（`requireActiveOrg`）と店舗の実在を見る 1 文が付く。
    // バッチが 11 文なのは、ご用件の短い名前を**別の 1 文**で読むためである
    // （帯 1 本ごとに `visit_purposes` を引き直すと、読む行数が帯の数だけ掛け算になる）。
    // 07-nfr.md の上限は 16 本なので 3 本の余裕がある。増やすときはここを直す。
    expect(prepared).toBe(13)
  })

  it('知らない axis は 400 で落ちる（URL に乗る語は resource）', async () => {
    const { status } = await ledger(`storeId=${fx.storeId}&date=${LEDGER_DATE}&axis=equipment`)
    expect(status).toBe(400)
  })

  it('storeId を省くと 400 で落ちる', async () => {
    const { status } = await ledger(`date=${LEDGER_DATE}`)
    expect(status).toBe(400)
  })

  it('日付が YYYY-MM-DD でなければ 400 で落ちる', async () => {
    const { status } = await ledger(`storeId=${fx.storeId}&date=2026-8-27`)
    expect(status).toBe(400)
  })

  it('無い店舗は 404 で落ちる', async () => {
    const { status } = await ledger(`storeId=${crypto.randomUUID()}&date=${LEDGER_DATE}`)
    expect(status).toBe(404)
  })
})

describe('GET /api/staff/reservations/:reservationId', () => {
  it('ご予約 1 件を ReservationDetail の形で返す', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/reservations/${fx.reservations.r2}`, {
      headers: authed(fx.token),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      id: fx.reservations.r2,
      storeId: fx.storeId,
      source: 'phone',
      status: 'confirmed',
      startsAt: fx.at('11:00'),
      endsAt: fx.at('12:00'),
      durationMinutes: 60,
      purposeLabel: '新調相談・視力測定',
      purposeLabelInternal: 'メガネを新しく作る・視力測定だけ',
      version: 1,
      webBookingCode: null,
    })
    expect(String(body.code)).toMatch(/^EY-\d{4}-\d{4,5}$/)
  })

  it('場所を 2 つ押さえたご予約は、設備の割当を 2 行返す（担当の行は必ず 1 行ある）', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/reservations/${fx.reservations.r2}`, {
      headers: authed(fx.token),
    })
    const body = (await res.json()) as {
      assignments: { kind: string; targetId: string | null }[]
    }
    expect(body.assignments.filter((row) => row.kind === 'staff')).toHaveLength(1)
    // 担当の行が先頭に来る（詳細の「担当」欄は 1 行目から読む）。
    expect(body.assignments[0]?.kind).toBe('staff')
    const places = body.assignments
      .filter((row) => row.kind === 'equipment')
      .map((row) => row.targetId)
    expect(places).toHaveLength(2)
    expect(new Set(places)).toEqual(new Set([fx.equipment.measure, fx.equipment.counter]))
  })

  it('担当が未定のご予約は kind=staff の行を targetId=null で返す', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/reservations/${fx.reservations.r3}`, {
      headers: authed(fx.token),
    })
    const body = (await res.json()) as {
      assignments: { kind: string; targetId: string | null }[]
    }
    expect(body.assignments.find((row) => row.kind === 'staff')?.targetId).toBeNull()
  })

  it('Web から入ったご予約はお客様に読み上げていただく番号を持つ', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/reservations/${fx.reservations.r3}`, {
      headers: authed(fx.token),
    })
    const body = (await res.json()) as { source: string; webBookingCode: string | null }
    expect(body.source).toBe('web')
    expect(body.webBookingCode).toMatch(/^EY-W-\d{4}-\d{4,5}$/)
  })

  it('無い id は 404 で落ちる', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/reservations/${crypto.randomUUID()}`, {
      headers: authed(fx.token),
    })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/staff/availability', () => {
  it('8 条件を掛けた枠と serverNow を返す', async () => {
    const { status, body } = await availability(
      `storeId=${fx.storeId}&date=${LEDGER_DATE}&purposeIds=${fx.purposes.eyesight}`,
    )
    expect(status).toBe(200)
    expect(body.isClosed).toBe(false)
    expect(body.opensAt).toBe('10:00')
    expect(body.closesAt).toBe('19:00')
    expect(body.slotMinutes).toBe(30)
    expect(body.cleanupMinutes).toBe(10)
    expect(body.durationMinutes).toBe(30)
    // 10:00 から 18:30 まで 30 分刻みで 18 本。
    expect(body.slots).toHaveLength(18)
    expect(body.slots[0]?.startsAt).toBe(fx.at('10:00'))
    expect(Date.parse(body.serverNow)).not.toBeNaN()
    // 置けない枠には必ず理由が添う。
    for (const slot of body.slots) {
      if (!slot.isAvailable) expect(slot.reason).not.toBeNull()
    }
    // 置ける枠が 1 つでもある日は、応答まるごとの理由を持たない。
    expect(body.reason).toBeNull()
  })

  it('埋まっている時刻は理由つきで塞がり、空いている時刻は担当を伴って返る', async () => {
    const { body } = await availability(
      `storeId=${fx.storeId}&date=${LEDGER_DATE}&purposeIds=${fx.purposes.eyesight}`,
    )
    const at = (time: string) => body.slots.find((slot) => slot.startsAt === fx.at(time))
    // 佐藤 美咲 は 13:00–14:00 が休憩、中村 彩 は 15:00 の 60 分が入っている。
    expect(at('10:00')?.isAvailable).toBe(true)
    expect(at('13:00')?.isAvailable).toBe(true)
    expect(at('18:30')?.isAvailable).toBe(false)
    expect(at('18:30')?.reason).toBe('outside_hours')
  })

  it('定休日は 409 ではなく 200 で、slots が空・isClosed が true になる', async () => {
    const { status, body } = await availability(
      `storeId=${fx.storeId}&date=${CLOSED_DATE}&purposeIds=${fx.purposes.eyesight}`,
    )
    expect(status).toBe(200)
    expect(body.isClosed).toBe(true)
    expect(body.slots).toEqual([])
    expect(body.lanes).toEqual([])
    expect(body.opensAt).toBeNull()
    // 枠が 0 件の理由を本文で伝える（画面が「定休日です。」と書けるのはこの語から）。
    expect(body.reason).toBe('closed')
  })

  it('受けられないご用件は 200 で slots が空になる（409 にしない）', async () => {
    const { status, body } = await availability(
      `storeId=${fx.storeId}&date=${LEDGER_DATE}&purposeIds=${crypto.randomUUID()}`,
    )
    expect(status).toBe(200)
    expect(body.isClosed).toBe(false)
    expect(body.slots).toEqual([])
    expect(body.lanes).toEqual([])
    // 定休日と同じ「空の一覧」にせず、お受けできないご用件だと分かる語を添える。
    expect(body.reason).toBe('purpose_unavailable')
  })

  it('同じご用件を 2 度渡しても、お受けできないご用件にはしない', async () => {
    const { status, body } = await availability(
      `storeId=${fx.storeId}&date=${LEDGER_DATE}&purposeIds=${fx.purposes.eyesight},${fx.purposes.eyesight}`,
    )
    expect(status).toBe(200)
    expect(body.reason).toBeNull()
    expect(body.slots.length).toBeGreaterThan(0)
  })

  it('axis=resource は設備のレーンを返し、axis=staff は担当のレーンを返す', async () => {
    const byResource = await availability(
      `storeId=${fx.storeId}&date=${LEDGER_DATE}&purposeIds=${fx.purposes.eyesight}&axis=resource`,
    )
    expect(byResource.body.lanes.every((lane) => lane.kind === 'equipment')).toBe(true)
    expect(byResource.body.lanes.map((lane) => lane.name)).toEqual([
      '視力測定機 A',
      '相談カウンター 2',
    ])

    const byStaff = await availability(
      `storeId=${fx.storeId}&date=${LEDGER_DATE}&purposeIds=${fx.purposes.eyesight}`,
    )
    expect(byStaff.body.lanes.map((lane) => lane.name)).toEqual([
      '佐藤 美咲',
      '中村 彩',
      '担当が未定',
    ])
  })

  it('変更のときは自分自身を塞がりに数えない', async () => {
    const query = `storeId=${fx.storeId}&date=${LEDGER_DATE}&purposeIds=${fx.purposes.adjust}&staffId=${fx.staff.takahashi}`
    const withSelf = await availability(query)
    const without = await availability(`${query}&excludeReservationId=${fx.reservations.r1}`)
    const at = (body: AvailabilityResponse, time: string) =>
      body.slots.find((slot) => slot.startsAt === fx.at(time))
    // 10:00 は 高橋 健 の 30 分（＋片付け 10 分）で塞がっている。
    expect(at(withSelf.body, '10:00')?.isAvailable).toBe(false)
    expect(at(without.body, '10:00')?.isAvailable).toBe(true)
  })

  it('予約の間隔がまだ決まっていない店舗は 404 で落ちる（暗黙の既定値を作らない）', async () => {
    const bare = await insertStore(fx.org, 'EYEX 新宿店')
    await insertBusinessHours(fx.org, bare)
    const { status } = await availability(`storeId=${bare}&date=${LEDGER_DATE}`)
    expect(status).toBe(404)
  })

  it('目的を 6 件渡すと 400 で落ちる（上限は 5 件）', async () => {
    const ids = Array.from({ length: 6 }, () => crypto.randomUUID()).join(',')
    const { status } = await availability(
      `storeId=${fx.storeId}&date=${LEDGER_DATE}&purposeIds=${ids}`,
    )
    expect(status).toBe(400)
  })

  it('無い店舗は 404 で落ちる', async () => {
    const { status } = await availability(`storeId=${crypto.randomUUID()}&date=${LEDGER_DATE}`)
    expect(status).toBe(404)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 受け付けを止めた日（AC-LEDGER-22）と、1 件の綻びで面が落ちないこと
 * ─────────────────────────────────────────────────────────────────────────── */

describe('受け付けを止めた日は 3 通りとも同じ型で出る（AC-LEDGER-22）', () => {
  /** 木曜。営業時間の 7 行では開いている日。 */
  const SPECIAL_CLOSED_DATE = '2026-09-03'

  it('臨時休業の日は opensAt と closesAt が null になり、行を 1 本も返さない', async () => {
    await insertCalendarException(fx.org, fx.storeId, { date: SPECIAL_CLOSED_DATE })

    const { status, body } = await ledger(`storeId=${fx.storeId}&date=${SPECIAL_CLOSED_DATE}`)
    expect(status).toBe(200)
    expect(body.opensAt).toBeNull()
    expect(body.closesAt).toBeNull()
    expect(body.lanes).toEqual([])
    expect(body.counts).toEqual({ all: 0, upcoming: 0, pendingReview: 0 })
  })

  it('臨時休業の日は空き枠も 0 件で、理由は closed になる', async () => {
    const { status, body } = await availability(
      `storeId=${fx.storeId}&date=${SPECIAL_CLOSED_DATE}&purposeIds=${fx.purposes.adjust}`,
    )
    expect(status).toBe(200)
    expect(body.isClosed).toBe(true)
    expect(body.slots).toEqual([])
    expect(body.reason).toBe('closed')
  })

  it('店舗まるごとの受付を止めた日は、営業日でも台帳が定休日と同じ型になる', async () => {
    // 他のテストが読む店舗を止めないよう、この 1 本だけの組織を作る。
    const other = await seedTenant()
    const open = await ledgerOf(other, LEDGER_DATE)
    expect(open.body.opensAt).toBe('10:00')
    expect(open.body.lanes.length).toBeGreaterThan(0)

    await setStoreActive(other.org, other.storeId, false)

    const { status, body } = await ledgerOf(other, LEDGER_DATE)
    expect(status).toBe(200)
    expect(body.opensAt).toBeNull()
    expect(body.closesAt).toBeNull()
    expect(body.lanes).toEqual([])
    expect(body.counts).toEqual({ all: 0, upcoming: 0, pendingReview: 0 })
  })

  it('店舗まるごとの受付を止めた日は空き枠も 0 件で、理由は closed になる', async () => {
    const other = await seedTenant()
    await setStoreActive(other.org, other.storeId, false)

    const res = await SELF.fetch(
      `${BASE}/api/staff/availability?storeId=${other.storeId}&date=${LEDGER_DATE}&purposeIds=${other.purposes.adjust}`,
      { headers: authed(other.token) },
    )
    const body = (await res.json()) as AvailabilityResponse
    expect(res.status).toBe(200)
    expect(body.isClosed).toBe(true)
    expect(body.slots).toEqual([])
    expect(body.lanes).toEqual([])
    expect(body.reason).toBe('closed')
  })
})

describe('ご予約 1 件の綻びで面がまるごと落ちない', () => {
  /** 金曜。ほかのテストが読む日と分ける。 */
  const SPARE_DATE = '2026-09-04'

  it('ご用件の行が 1 本も無いご予約でも、詳細は 200 で返る', async () => {
    const id = await insertReservation(fx.org, {
      storeId: fx.storeId,
      startsAt: jstAt(SPARE_DATE, '11:00'),
      durationMinutes: 30,
      staffId: fx.staff.sato,
      purposes: [],
    })

    const res = await SELF.fetch(`${BASE}/api/staff/reservations/${id}`, {
      headers: authed(fx.token),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { purposes: unknown[]; purposeLabel: string }
    expect(body.purposes).toEqual([])
    expect(body.purposeLabel).toBe('')
  })

  it('name_short が長いご用件が 1 件あっても台帳は 200 で、帯のご用件は 30 文字で切れる', async () => {
    // `visit_purposes.name_short` は 1〜5 文字の決めだが、D1 に CHECK は無い。
    const long = await insertVisitPurpose(fx.org, fx.storeId, {
      nameInternal: 'とても長いご用件',
      nameShort: 'あ'.repeat(40),
      durationMinutes: 30,
      sortOrder: 9,
    })
    await insertReservation(fx.org, {
      storeId: fx.storeId,
      startsAt: jstAt(SPARE_DATE, '13:00'),
      durationMinutes: 30,
      staffId: fx.staff.sato,
      purposes: [{ id: long }],
    })

    const { status, body } = await ledger(`storeId=${fx.storeId}&date=${SPARE_DATE}`)
    expect(status).toBe(200)
    const labels = entriesOf(body).map((entry) => entry.purposeLabel)
    expect(labels).toContain('あ'.repeat(30))
  })
})
