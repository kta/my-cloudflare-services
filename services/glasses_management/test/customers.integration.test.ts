/**
 * 顧客台帳の代表フロー（P4 T-009 / T-013）。
 *
 * 実 D1 の上で、検索・詳細・登録・更新・候補・メモの往復を 1 本ずつ固定する。
 * おまとめだけは取り消せない操作なので `customer-merge.integration.test.ts` に分けた。
 *
 * D1 はテストファイル内で共有されるので、組織 id は毎回 `crypto.randomUUID()` から作る。
 * 時刻は固定値（`FIXED_NOW` / 2027 年の未来）で置き、実時刻に依存させない。
 */
import { env, SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  authed,
  BASE,
  FIXED_NOW,
  insertBusinessHours,
  insertShift,
  insertSlotRules,
  insertStaff,
  insertStore,
  jstAt,
  LEDGER_DATE,
  orgId,
  tokenFor,
} from './helpers'

/* ───────────────────────────────────────────────────────────────────────────
 * 台帳の 4 表へ直に置く道具（P4 より前に顧客を書く API は無い）
 * ─────────────────────────────────────────────────────────────────────────── */

let numberSeq = 1000
const nextCustomerNumber = (): string => `G-${String(++numberSeq).padStart(5, '0')}`

type CustomerSeed = {
  name: string
  kana?: string
  phone?: string | null
  memo?: string
  visitCount?: number
  /** ISO8601。`customers.last_visit_at` は暦日ではなく瞬間で持つ。 */
  lastVisitAt?: string | null
  firstVisitAt?: string | null
  address?: string | null
  email?: string | null
  birthDate?: string | null
  customerNumber?: string
  storeId?: string | null
  mergedIntoId?: string | null
}

async function insertCustomer(org: string, seed: CustomerSeed): Promise<string> {
  const id = crypto.randomUUID()
  const normalized = (seed.phone ?? '').replace(/\D/g, '')
  const hasPhone = normalized !== ''
  await env.DB.prepare(
    'INSERT INTO customers (id, organization_id, customer_number, name, kana, phone, phone_normalized, phone_last4, email, birth_date, address, memo, first_visit_at, last_visit_at, visit_count, merged_into_id, version, created_store_id, created_terminal_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,NULL,?,?)',
  )
    .bind(
      id,
      org,
      seed.customerNumber ?? nextCustomerNumber(),
      seed.name,
      seed.kana ?? '',
      hasPhone ? (seed.phone ?? null) : null,
      hasPhone ? normalized : null,
      hasPhone ? normalized.slice(-4) : null,
      seed.email ?? null,
      seed.birthDate ?? null,
      seed.address ?? null,
      seed.memo ?? '',
      seed.firstVisitAt ?? null,
      seed.lastVisitAt ?? null,
      seed.visitCount ?? 0,
      seed.mergedIntoId ?? null,
      seed.storeId ?? null,
      FIXED_NOW,
      FIXED_NOW,
    )
    .run()
  return id
}

async function insertPrescription(
  org: string,
  customerId: string,
  storeId: string,
  seed: { measuredAt: string; rSph?: number; lSph?: number; pd?: number; isCurrent?: boolean },
): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO customer_prescriptions (id, organization_id, customer_id, store_id, measured_at, r_sph, r_cyl, r_axis, r_add, l_sph, l_cyl, l_axis, l_add, pd, note, is_current, created_at) VALUES (?,?,?,?,?,?,NULL,NULL,NULL,?,NULL,NULL,NULL,?,?,?,?)',
  )
    .bind(
      id,
      org,
      customerId,
      storeId,
      seed.measuredAt,
      seed.rSph ?? null,
      seed.lSph ?? null,
      seed.pd ?? null,
      '',
      seed.isCurrent === true ? '1' : '0',
      FIXED_NOW,
    )
    .run()
  return id
}

async function insertGlasses(
  org: string,
  customerId: string,
  storeId: string,
  seed: { purchasedAt: string; frameName?: string; isCurrent?: boolean },
): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO customer_glasses (id, organization_id, customer_id, store_id, purchased_at, frame_name, lens_name, usage_label, note, is_current, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      id,
      org,
      customerId,
      storeId,
      seed.purchasedAt,
      seed.frameName ?? 'JINS SF-201',
      '',
      '',
      '',
      seed.isCurrent === false ? '0' : '1',
      FIXED_NOW,
    )
    .run()
  return id
}

async function insertNote(
  org: string,
  customerId: string,
  storeId: string,
  seed: {
    kind?: 'memo' | 'attention'
    body?: string
    status?: 'draft' | 'published' | 'hidden'
    handwritingKey?: string | null
    createdAt?: string
  } = {},
): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO customer_notes (id, organization_id, customer_id, store_id, kind, body, handwriting_key, author_id, revision, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,NULL,1,?,?,?)',
  )
    .bind(
      id,
      org,
      customerId,
      storeId,
      seed.kind ?? 'memo',
      seed.body ?? '',
      seed.handwritingKey ?? null,
      seed.status ?? 'draft',
      seed.createdAt ?? FIXED_NOW,
      seed.createdAt ?? FIXED_NOW,
    )
    .run()
  return id
}

let reservationSeq = 0

/** お客様に紐づいた予約 1 件。担当の割当も `kind='staff'` で 1 行作る（I-05）。 */
async function insertVisit(
  org: string,
  seed: {
    storeId: string
    customerId: string | null
    startsAt: string
    status?: 'confirmed' | 'arrived' | 'serving' | 'done' | 'cancelled' | 'no_show'
    staffId?: string | null
    durationMinutes?: number
  },
): Promise<string> {
  const id = crypto.randomUUID()
  const durationMinutes = seed.durationMinutes ?? 30
  const endsAt = new Date(Date.parse(seed.startsAt) + durationMinutes * 60_000).toISOString()
  await env.DB.prepare(
    'INSERT INTO reservations (id, organization_id, store_id, code, customer_id, source, status, starts_at, ends_at, duration_minutes, note_customer, note_internal, version, created_at, updated_at, created_by, cancelled_at, cancel_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,NULL,NULL,NULL)',
  )
    .bind(
      id,
      org,
      seed.storeId,
      `EY-2608-${String(++reservationSeq).padStart(4, '0')}`,
      seed.customerId,
      'phone',
      seed.status ?? 'confirmed',
      seed.startsAt,
      endsAt,
      durationMinutes,
      '',
      '',
      FIXED_NOW,
      FIXED_NOW,
    )
    .run()
  await env.DB.prepare(
    'INSERT INTO reservation_assignments (id, organization_id, reservation_id, kind, target_id, starts_at, ends_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
  )
    .bind(
      crypto.randomUUID(),
      org,
      id,
      'staff',
      seed.staffId ?? null,
      seed.startsAt,
      endsAt,
      FIXED_NOW,
    )
    .run()
  return id
}

type ListBody = {
  items: {
    id: string
    name: string
    kana: string
    visitCount: number
    lastVisitAt: string | null
  }[]
  nextCursor: string | null
  total: number
}

async function search(token: string, query: string): Promise<{ status: number; body: ListBody }> {
  const res = await SELF.fetch(`${BASE}/api/staff/customers${query}`, { headers: authed(token) })
  return { status: res.status, body: (await res.json()) as ListBody }
}

/* ───────────────────────────────────────────────────────────────────────────
 * 検索と一覧
 * ─────────────────────────────────────────────────────────────────────────── */

describe('検索と一覧', () => {
  const org = orgId()
  let token = ''

  beforeAll(async () => {
    token = await tokenFor(org)
    await insertStore(org)
    // CUSTOMER-LIST の 8 行。ふりがなの五十音順で並ぶ。
    const listed: [string, string, number][] = [
      ['相川 みどり', 'あいかわ みどり', 5],
      ['青木 律子', 'あおき りつこ', 1],
      ['石井 孝', 'いしい たかし', 0],
      ['伊藤 健', 'いとう けん', 3],
      ['大森 千夏', 'おおもり ちなつ', 2],
      ['川上 恵', 'かわかみ めぐみ', 7],
      ['木下 亮太', 'きのした りょうた', 2],
    ]
    for (const [name, kana, visitCount] of listed) {
      await insertCustomer(org, { name, kana, visitCount })
    }
    await insertCustomer(org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: '090-1234-5678',
      visitCount: 4,
      lastVisitAt: jstAt('2026-05-12', '11:00'),
      memo: '遠近をお使いです。まぶしさに弱いとのこと。',
    })
    await insertCustomer(org, {
      name: '田中 一郎',
      kana: 'たなか いちろう',
      phone: '090-1234-9912',
      visitCount: 1,
    })
    // 「当てはまるお客様 42名」を作る残り 32 名。
    for (let index = 0; index < 32; index++) {
      await insertCustomer(org, {
        name: `山田 ${index}`,
        kana: `やまだ ${String(index).padStart(2, '0')}`,
        visitCount: index % 6,
      })
    }
    // まとめられた行は検索にも一覧にも出ない。
    const survivor = await insertCustomer(org, { name: '残る 側', kana: 'のこる がわ' })
    await insertCustomer(org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: '090-1234-5678',
      mergedIntoId: survivor,
    })
  })

  it('五十音順で返し、total と items.length が別の数になる（42名 と 8行）', async () => {
    const { status, body } = await search(token, '?limit=8')
    expect(status).toBe(200)
    expect(body.total).toBe(42)
    expect(body.items).toHaveLength(8)
    expect(body.items.map((row) => row.kana)).toEqual([...body.items.map((row) => row.kana)].sort())
    expect(body.items[0]?.name).toBe('相川 みどり')
    expect(body.nextCursor).not.toBeNull()
  })

  it('「5678」では下 4 桁の一致だけが残る', async () => {
    const { body } = await search(token, '?query=5678')
    expect(body.items.map((row) => row.name)).toEqual(['田中 花子'])
    expect(body.total).toBe(1)
  })

  it('「1234」では 090-1234-5678 が残らない', async () => {
    const { body } = await search(token, '?query=1234')
    expect(body.items.map((row) => row.name)).not.toContain('田中 花子')
    expect(body.total).toBe(0)
  })

  it('「たなか」でも「花子」でも同じ 1 行が残る', async () => {
    const byKana = await search(token, `?query=${encodeURIComponent('たなか はなこ')}`)
    const byName = await search(token, `?query=${encodeURIComponent('花子')}`)
    expect(byKana.body.items.map((row) => row.name)).toEqual(['田中 花子'])
    expect(byName.body.items.map((row) => row.id)).toEqual(byKana.body.items.map((row) => row.id))
  })

  it('ご来店の回数順に切り替えると多い順になる', async () => {
    const { body } = await search(token, '?sort=visits&limit=8')
    const counts = body.items.map((row) => row.visitCount)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    expect(counts[0]).toBe(7)
  })

  it('絞り込み（ご来店 2〜4回）で total が絞り込み後の数になる', async () => {
    const { body } = await search(token, '?visitCountMin=2&visitCountMax=4&limit=50')
    expect(body.total).toBeGreaterThan(0)
    expect(body.total).toBeLessThan(42)
    expect(body.items.every((row) => row.visitCount >= 2 && row.visitCount <= 4)).toBe(true)
    expect(body.items).toHaveLength(body.total)
  })

  it('当てはまるお客様が 0 名なら items は空・total は 0・nextCursor は null', async () => {
    const { body } = await search(token, `?query=${encodeURIComponent('該当しないお名前')}`)
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    expect(body.nextCursor).toBeNull()
  })

  it('nextCursor をそのまま渡すと続きが返り、同じ行が 2 度出ない', async () => {
    const first = await search(token, '?limit=8')
    const second = await search(
      token,
      `?limit=8&cursor=${encodeURIComponent(first.body.nextCursor ?? '')}`,
    )
    expect(second.body.items).toHaveLength(8)
    expect(second.body.total).toBe(42)
    const ids = new Set(first.body.items.map((row) => row.id))
    expect(second.body.items.some((row) => ids.has(row.id))).toBe(false)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 詳細
 * ─────────────────────────────────────────────────────────────────────────── */

type DetailBody = {
  id: string
  name: string
  customerNumber: string
  version: number
  frequentStaffName: string | null
  prescriptions: { id: string; measuredAt: string; isCurrent: boolean }[]
  glasses: { id: string; isCurrent: boolean }[]
  notes: { id: string; kind: string; status: string; body: string; storeId: string }[]
  nextReservation: { id: string; startsAt: string } | null
}

async function detail(token: string, id: string) {
  const res = await SELF.fetch(`${BASE}/api/staff/customers/${id}`, { headers: authed(token) })
  return { status: res.status, body: (await res.json()) as DetailBody }
}

describe('詳細', () => {
  const org = orgId()
  let token = ''
  let ginza = ''
  let marunouchi = ''
  let hanako = ''
  let soon = ''

  beforeAll(async () => {
    token = await tokenFor(org)
    ginza = await insertStore(org, 'EYEX 銀座店')
    marunouchi = await insertStore(org, 'EYEX 丸の内店')
    hanako = await insertCustomer(org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: '090-1234-5678',
      visitCount: 4,
    })
    await insertPrescription(org, hanako, ginza, { measuredAt: '2024-03-15', rSph: -2.0 })
    await insertPrescription(org, hanako, marunouchi, { measuredAt: '2025-04-02', rSph: -2.25 })
    await insertPrescription(org, hanako, ginza, {
      measuredAt: '2026-05-12',
      rSph: -2.5,
      isCurrent: true,
    })
    await insertGlasses(org, hanako, ginza, { purchasedAt: '2025-04-02' })
    await insertGlasses(org, hanako, ginza, { purchasedAt: '2026-05-12' })
    await insertGlasses(org, hanako, ginza, { purchasedAt: '2021-01-05', isCurrent: false })
    // 注意ごとに数えるのは kind='attention' かつ status='published' の 1 件だけ。
    await insertNote(org, hanako, ginza, {
      kind: 'attention',
      status: 'published',
      body: 'まぶしさに弱いとのこと。',
    })
    await insertNote(org, hanako, ginza, { kind: 'attention', status: 'draft', body: '申し込み中' })
    await insertNote(org, hanako, ginza, {
      kind: 'memo',
      status: 'published',
      body: 'ふつうのメモ',
    })
    await insertNote(org, hanako, marunouchi, { kind: 'memo', body: '丸の内店で書いた 1 枚' })

    const sato = await insertStaff(org, ginza, { displayName: '佐藤 美咲' })
    const nakamura = await insertStaff(org, ginza, { displayName: '中村 彩' })
    await insertVisit(org, {
      storeId: ginza,
      customerId: hanako,
      startsAt: jstAt('2026-01-10', '11:00'),
      status: 'done',
      staffId: sato,
    })
    await insertVisit(org, {
      storeId: ginza,
      customerId: hanako,
      startsAt: jstAt('2026-03-10', '11:00'),
      status: 'done',
      staffId: sato,
    })
    await insertVisit(org, {
      storeId: ginza,
      customerId: hanako,
      startsAt: jstAt('2026-05-12', '11:00'),
      status: 'done',
      staffId: nakamura,
    })
    // 未来のご予約は 2 件。近いほうだけが「次のご予約」になる。
    soon = await insertVisit(org, {
      storeId: ginza,
      customerId: hanako,
      startsAt: jstAt('2027-02-03', '11:00'),
    })
    await insertVisit(org, {
      storeId: ginza,
      customerId: hanako,
      startsAt: jstAt('2027-08-03', '11:00'),
    })
  })

  it('度数は測定日の新しい順で、is_current が true の行はちょうど 1 つ', async () => {
    const { status, body } = await detail(token, hanako)
    expect(status).toBe(200)
    expect(body.prescriptions.map((row) => row.measuredAt)).toEqual([
      '2026-05-12',
      '2025-04-02',
      '2024-03-15',
    ])
    expect(body.prescriptions.filter((row) => row.isCurrent)).toHaveLength(1)
  })

  it('いまお使いのメガネは is_current の本数だけを数える', async () => {
    const { body } = await detail(token, hanako)
    expect(body.glasses.filter((row) => row.isCurrent)).toHaveLength(2)
  })

  it('「注意ごと N件」は kind=attention かつ status=published の行だけを数える', async () => {
    const { body } = await detail(token, hanako)
    const attention = body.notes.filter(
      (row) => row.kind === 'attention' && row.status === 'published',
    )
    expect(attention).toHaveLength(1)
  })

  it('よくご担当した者は done の予約の担当で最も多い者', async () => {
    const { body } = await detail(token, hanako)
    expect(body.frequentStaffName).toBe('佐藤 美咲')
  })

  it('次のご予約は starts_at が現在時刻以降でいちばん早い 1 件', async () => {
    const { body } = await detail(token, hanako)
    expect(body.nextReservation?.id).toBe(soon)
  })

  it('丸の内店で書かれたメモと度数も、銀座店のトークンで読める', async () => {
    const { body } = await detail(token, hanako)
    expect(body.notes.map((row) => row.body)).toContain('丸の内店で書いた 1 枚')
    expect(body.notes.some((row) => row.storeId === marunouchi)).toBe(true)
    expect(body.prescriptions).toHaveLength(3)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 新規登録と更新
 * ─────────────────────────────────────────────────────────────────────────── */

describe('新規登録', () => {
  const org = orgId()
  let token = ''

  beforeAll(async () => {
    token = await tokenFor(org)
    await insertStore(org)
  })

  async function create(body: unknown) {
    const res = await SELF.fetch(`${BASE}/api/staff/customers`, {
      method: 'POST',
      headers: authed(token),
      body: JSON.stringify(body),
    })
    return { status: res.status, body: (await res.json()) as DetailBody }
  }

  it('お名前だけで登録できる（お電話番号は任意）', async () => {
    const created = await create({ name: '初回 太郎' })
    expect(created.status).toBe(200)
    expect(created.body.name).toBe('初回 太郎')
    expect(created.body.version).toBe(1)
  })

  it('お名前もお電話番号も空なら 400', async () => {
    const created = await create({ name: '' })
    expect(created.status).toBe(400)
  })

  it('お客様番号 G-NNNNN を採番し、組織の中で一意になる', async () => {
    const first = await create({ name: '採番 一' })
    const second = await create({ name: '採番 二' })
    expect(first.body.customerNumber).toMatch(/^G-\d{5}$/)
    expect(second.body.customerNumber).toMatch(/^G-\d{5}$/)
    expect(second.body.customerNumber).not.toBe(first.body.customerNumber)
  })

  it('phone / phone_normalized / phone_last4 の 3 つが同時に入る', async () => {
    const created = await create({ name: '電話 有子', phone: '090-1234-5678' })
    const row = await env.DB.prepare(
      'SELECT phone, phone_normalized AS normalized, phone_last4 AS last4 FROM customers WHERE id = ?',
    )
      .bind(created.body.id)
      .first<{ phone: string; normalized: string; last4: string }>()
    expect(row).toMatchObject({
      phone: '090-1234-5678',
      normalized: '09012345678',
      last4: '5678',
    })
  })
})

describe('更新', () => {
  const org = orgId()
  let token = ''
  let customerId = ''

  beforeAll(async () => {
    token = await tokenFor(org)
    await insertStore(org)
    customerId = await insertCustomer(org, { name: '更新 前子', kana: 'こうしん まえこ' })
  })

  async function patch(body: unknown) {
    const res = await SELF.fetch(`${BASE}/api/staff/customers/${customerId}`, {
      method: 'PATCH',
      headers: authed(token),
      body: JSON.stringify(body),
    })
    return { status: res.status, body: (await res.json()) as DetailBody }
  }

  it('version が合えば更新され、version が +1 される', async () => {
    const updated = await patch({ name: '更新 後子', version: 1 })
    expect(updated.status).toBe(200)
    expect(updated.body.name).toBe('更新 後子')
    expect(updated.body.version).toBe(2)
  })

  it('version が古ければ 409 version_conflict で 1 列も変わらない', async () => {
    const before = await env.DB.prepare('SELECT name, version FROM customers WHERE id = ?')
      .bind(customerId)
      .first<{ name: string; version: number }>()
    const conflicted = await patch({ name: '割り込み', version: 1 })
    expect(conflicted.status).toBe(409)
    expect(conflicted.body).toMatchObject({ error: 'version_conflict' })
    const after = await env.DB.prepare('SELECT name, version FROM customers WHERE id = ?')
      .bind(customerId)
      .first<{ name: string; version: number }>()
    expect(after).toEqual(before)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 候補（BOOK-04b / CUSTOMER-NEW の重複警告）
 * ─────────────────────────────────────────────────────────────────────────── */

describe('候補', () => {
  const org = orgId()
  let token = ''

  beforeAll(async () => {
    token = await tokenFor(org)
    const storeId = await insertStore(org)
    const hanako = await insertCustomer(org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: '090-1234-5678',
      visitCount: 4,
      lastVisitAt: jstAt('2026-05-12', '11:00'),
    })
    await insertPrescription(org, hanako, storeId, {
      measuredAt: '2026-05-12',
      rSph: -2.5,
      isCurrent: true,
    })
    await insertCustomer(org, {
      name: '田中 一郎',
      kana: 'たなか いちろう',
      phone: '090-1234-9912',
      visitCount: 1,
    })
  })

  it('11 桁を打ち終えると 2 件返り、全桁一致が strong・前方一致が weak', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/customers/lookup?phone=09012345678`, {
      headers: authed(token),
    })
    expect(res.status).toBe(200)
    const candidates = (await res.json()) as {
      customer: { name: string }
      match: 'strong' | 'weak'
    }[]
    expect(candidates).toHaveLength(2)
    const byName = new Map(candidates.map((row) => [row.customer.name, row.match]))
    expect(byName.get('田中 花子')).toBe('strong')
    expect(byName.get('田中 一郎')).toBe('weak')
  })

  it('phone / phoneLast4 / name / kana の 4 つがすべて空なら 400', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/customers/lookup`, { headers: authed(token) })
    expect(res.status).toBe(400)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * メモと手書き
 * ─────────────────────────────────────────────────────────────────────────── */

const STROKE =
  '<svg viewBox="0 0 600 400" role="img" aria-label="手書きメモ"><path d="M10 10 L100 90" stroke="#1b3a2f" stroke-width="3" fill="none"/></svg>'

type NoteBody = {
  id: string
  kind: string
  status: string
  body: string
  revision: number
  handwritingSvg: string | null
}

describe('メモ', () => {
  const org = orgId()
  let token = ''
  let storeId = ''
  let customerId = ''

  beforeAll(async () => {
    token = await tokenFor(org)
    storeId = await insertStore(org)
    customerId = await insertCustomer(org, { name: '手書き 好子', kana: 'てがき よしこ' })
  })

  async function addNote(body: unknown) {
    const res = await SELF.fetch(`${BASE}/api/staff/customers/${customerId}/notes`, {
      method: 'POST',
      headers: authed(token),
      body: JSON.stringify(body),
    })
    return { status: res.status, body: (await res.json()) as NoteBody }
  }

  it('手書きだけのメモを保存でき、本文は空でよい', async () => {
    const created = await addNote({ kind: 'memo', storeId, handwritingSvg: STROKE })
    expect(created.status).toBe(200)
    expect(created.body.body).toBe('')
    expect(created.body.handwritingSvg).toContain('<path')
    const stored = await env.DB.prepare(
      'SELECT handwriting_key AS handwritingKey FROM customer_notes WHERE id = ?',
    )
      .bind(created.body.id)
      .first<{ handwritingKey: string }>()
    expect(stored?.handwritingKey).toBe(`notes/${org}/${customerId}/${created.body.id}.svg`)
    // ダウンロード URL も R2 のキーも応答に出さない。
    expect(JSON.stringify(created.body)).not.toContain('notes/')
  })

  it('読み取った文字を直すと revision が +1 され、handwriting_key は変わらない', async () => {
    const created = await addNote({ kind: 'memo', storeId, handwritingSvg: STROKE })
    const before = await env.DB.prepare(
      'SELECT handwriting_key AS handwritingKey FROM customer_notes WHERE id = ?',
    )
      .bind(created.body.id)
      .first<{ handwritingKey: string }>()
    const res = await SELF.fetch(
      `${BASE}/api/staff/customers/${customerId}/notes/${created.body.id}`,
      {
        method: 'PATCH',
        headers: authed(token),
        body: JSON.stringify({ revision: created.body.revision, body: '読み取り直した文字' }),
      },
    )
    expect(res.status).toBe(200)
    const patched = (await res.json()) as NoteBody
    expect(patched.body).toBe('読み取り直した文字')
    expect(patched.revision).toBe(created.body.revision + 1)
    const after = await env.DB.prepare(
      'SELECT handwriting_key AS handwritingKey FROM customer_notes WHERE id = ?',
    )
      .bind(created.body.id)
      .first<{ handwritingKey: string }>()
    expect(after?.handwritingKey).toBe(before?.handwritingKey)
  })

  it('注意ごとへの申し込みは kind=attention / status=draft になり、件数は増えない', async () => {
    const created = await addNote({ kind: 'memo', storeId, body: '強い光がつらいとのこと' })
    const res = await SELF.fetch(
      `${BASE}/api/staff/customers/${customerId}/notes/${created.body.id}/publish`,
      {
        method: 'POST',
        headers: authed(token),
        body: JSON.stringify({ revision: created.body.revision, body: '強い光がつらいとのこと' }),
      },
    )
    expect(res.status).toBe(200)
    const applied = (await res.json()) as NoteBody
    expect(applied.kind).toBe('attention')
    expect(applied.status).toBe('draft')
    const published = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM customer_notes WHERE customer_id = ? AND kind = 'attention' AND status = 'published'",
    )
      .bind(customerId)
      .first<{ count: number }>()
    expect(published?.count).toBe(0)
  })

  it('6 枚目の手書きは 409 で拒む', async () => {
    const only = await insertCustomer(org, { name: '五枚 満子', kana: 'ごまい みつこ' })
    for (let sheet = 0; sheet < 5; sheet++) {
      const res = await SELF.fetch(`${BASE}/api/staff/customers/${only}/notes`, {
        method: 'POST',
        headers: authed(token),
        body: JSON.stringify({ kind: 'memo', storeId, handwritingSvg: STROKE }),
      })
      expect(res.status).toBe(200)
    }
    const sixth = await SELF.fetch(`${BASE}/api/staff/customers/${only}/notes`, {
      method: 'POST',
      headers: authed(token),
      body: JSON.stringify({ kind: 'memo', storeId, handwritingSvg: STROKE }),
    })
    expect(sixth.status).toBe(409)
    // 黙って古い 1 枚を消さない。置き換える候補（5 枚）を返して人に選ばせる。
    const refused = (await sixth.json()) as {
      error: string
      sheets: { id: string; createdAt: string }[]
    }
    expect(refused.error).toBe('invalid_transition')
    expect(refused.sheets).toHaveLength(5)
    const kept = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM customer_notes WHERE customer_id = ? AND handwriting_key IS NOT NULL',
    )
      .bind(only)
      .first<{ count: number }>()
    expect(kept?.count).toBe(5)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 台帳の帯（P2 が器だけ置いた場所を埋める。T-013）
 * ─────────────────────────────────────────────────────────────────────────── */

describe('台帳の帯', () => {
  const org = orgId()
  let token = ''
  let storeId = ''

  beforeAll(async () => {
    token = await tokenFor(org)
    storeId = await insertStore(org)
    await insertBusinessHours(org, storeId, { closedWeekdays: [] })
    await insertSlotRules(org, storeId)
    const staffId = await insertStaff(org, storeId, { displayName: '佐藤 美咲' })
    await insertShift(org, storeId, staffId, { date: LEDGER_DATE })
    const hanako = await insertCustomer(org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      visitCount: 4,
    })
    await insertVisit(org, {
      storeId,
      customerId: hanako,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      durationMinutes: 60,
      staffId,
    })
    await insertVisit(org, {
      storeId,
      customerId: null,
      startsAt: jstAt(LEDGER_DATE, '14:00'),
      durationMinutes: 30,
      staffId,
    })
  })

  it('帯はお名前と来店回数を持つ（P2 が null で置いていた 2 欄が埋まる）', async () => {
    const res = await SELF.fetch(
      `${BASE}/api/staff/ledger?storeId=${storeId}&date=${LEDGER_DATE}&axis=staff`,
      { headers: authed(token) },
    )
    expect(res.status).toBe(200)
    const view = (await res.json()) as {
      lanes: {
        entries: { startsAt: string; customerName: string | null; visitCount: number | null }[]
      }[]
    }
    const entries = view.lanes.flatMap((lane) => lane.entries)
    const named = entries.find((entry) => entry.customerName !== null)
    expect(named).toMatchObject({ customerName: '田中 花子', visitCount: 4 })
  })

  it('お客様の付いていない帯は、お名前も来店回数も null のまま', async () => {
    const res = await SELF.fetch(
      `${BASE}/api/staff/ledger?storeId=${storeId}&date=${LEDGER_DATE}&axis=staff`,
      { headers: authed(token) },
    )
    const view = (await res.json()) as {
      lanes: { entries: { customerName: string | null; visitCount: number | null }[] }[]
    }
    const entries = view.lanes.flatMap((lane) => lane.entries)
    const anonymous = entries.filter((entry) => entry.customerName === null)
    expect(anonymous.length).toBeGreaterThan(0)
    expect(anonymous.every((entry) => entry.visitCount === null)).toBe(true)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 2 巡目に足した受入基準の検証点
 *
 * 1 巡目は「応答が返ること」までは見ていたが、受入基準が名指ししている値
 * （絞り込みの 4 段・引き継がれる 4 つ・来店回数の一致・JST の暦日・
 * 記入した店舗と記入者・詳細の見出しのお客様）までは読んでいなかった。
 * ─────────────────────────────────────────────────────────────────────────── */

/** 絞り込みの札が持つご来店の回数の 4 段（AC-CUST-03）。これ以外の条件を足さない。 */
const VISIT_BANDS: readonly {
  label: string
  query: string
  fits: (count: number) => boolean
}[] = [
  { label: '初', query: 'visitCountMin=0&visitCountMax=0', fits: (n) => n === 0 },
  { label: '1回', query: 'visitCountMin=1&visitCountMax=1', fits: (n) => n === 1 },
  { label: '2〜4回', query: 'visitCountMin=2&visitCountMax=4', fits: (n) => n >= 2 && n <= 4 },
  { label: '5回以上', query: 'visitCountMin=5', fits: (n) => n >= 5 },
]

describe('絞り込みの 4 段（AC-CUST-03）', () => {
  const org = orgId()
  let token = ''
  /** ご来店 0〜6 回を 1 名ずつ。4 段が重ならず、合わせて全員になることを数で見る。 */
  const counts = [0, 0, 1, 2, 3, 4, 5, 6]

  beforeAll(async () => {
    token = await tokenFor(org)
    await insertStore(org)
    for (const [index, visitCount] of counts.entries()) {
      await insertCustomer(org, {
        name: `絞り ${index}`,
        kana: `しぼり ${String(index).padStart(2, '0')}`,
        visitCount,
      })
    }
  })

  for (const band of VISIT_BANDS) {
    it(`「${band.label}」の札は当てはまる方だけを残し、total も絞り込み後の数になる`, async () => {
      const { body } = await search(token, `?${band.query}&limit=50`)
      const expected = counts.filter(band.fits).length
      expect(body.total).toBe(expected)
      expect(body.items).toHaveLength(expected)
      expect(body.items.every((row) => band.fits(row.visitCount))).toBe(true)
    })
  }

  it('4 段は重ならず、合わせると絞り込み無しの人数にちょうど戻る', async () => {
    const all = await search(token, '?limit=50')
    let summed = 0
    const seen = new Set<string>()
    for (const band of VISIT_BANDS) {
      const { body } = await search(token, `?${band.query}&limit=50`)
      summed += body.total
      for (const row of body.items) {
        expect(seen.has(row.id)).toBe(false)
        seen.add(row.id)
      }
    }
    expect(summed).toBe(all.body.total)
    expect(seen.size).toBe(all.body.total)
  })
})

/* --- 候補が引き継ぐ 4 つ（AC-CUST-06 / AC-CUST-09 / AC-CUST-10 / AC-CUST-11） --- */

type Candidate = {
  customer: { id: string; name: string; phone: string | null; visitCount: number }
  match: 'strong' | 'weak'
  lastVisitAt: string | null
  currentPrescription: { id: string; measuredAt: string; rSph: number | null } | null
  lastStaffName: string | null
  attentionSummary: string
}

describe('候補が引き継ぐもの', () => {
  const org = orgId()
  let token = ''
  let hanako = ''
  let currentPrescriptionId = ''

  beforeAll(async () => {
    token = await tokenFor(org)
    const storeId = await insertStore(org)
    hanako = await insertCustomer(org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: '090-1234-5678',
      visitCount: 4,
      // 2026-05-12 11:00 JST。**瞬間**で持ち、応答は JST の暦日に落ちる。
      lastVisitAt: jstAt('2026-05-12', '11:00'),
    })
    await insertPrescription(org, hanako, storeId, { measuredAt: '2024-03-15', rSph: -2.0 })
    currentPrescriptionId = await insertPrescription(org, hanako, storeId, {
      measuredAt: '2026-05-12',
      rSph: -2.5,
      isCurrent: true,
    })
    // 注意ごとは公開済みの 1 件だけを引き継ぐ（申し込み中の draft は引き継がない）。
    await insertNote(org, hanako, storeId, {
      kind: 'attention',
      status: 'published',
      body: '金属アレルギーのお申し出があります。',
    })
    await insertNote(org, hanako, storeId, {
      kind: 'attention',
      status: 'draft',
      body: '申し込み中なので引き継がない',
    })

    // 前回の担当は「いちばん新しい done のご予約の担当」であって、件数の多い者ではない。
    const sato = await insertStaff(org, storeId, { displayName: '佐藤 美咲' })
    const nakamura = await insertStaff(org, storeId, { displayName: '中村 彩' })
    for (const date of ['2026-01-10', '2026-03-10', '2026-04-10']) {
      await insertVisit(org, {
        storeId,
        customerId: hanako,
        startsAt: jstAt(date, '11:00'),
        status: 'done',
        staffId: sato,
      })
    }
    await insertVisit(org, {
      storeId,
      customerId: hanako,
      startsAt: jstAt('2026-05-12', '11:00'),
      status: 'done',
      staffId: nakamura,
    })
    // 取り消しは来店回数にも「最後のご来店」にも入らない。
    await insertVisit(org, {
      storeId,
      customerId: hanako,
      startsAt: jstAt('2026-06-30', '11:00'),
      status: 'cancelled',
      staffId: nakamura,
    })
  })

  async function lookup(query: string): Promise<Candidate[]> {
    const res = await SELF.fetch(`${BASE}/api/staff/customers/lookup?${query}`, {
      headers: authed(token),
    })
    expect(res.status).toBe(200)
    return (await res.json()) as Candidate[]
  }

  it('選んだ 1 名から、現在の度数・前回の担当・注意ごと・ご連絡先の 4 つが引き継げる', async () => {
    const [candidate] = await lookup('phone=09012345678')
    expect(candidate?.currentPrescription?.id).toBe(currentPrescriptionId)
    expect(candidate?.currentPrescription?.rSph).toBe(-2.5)
    expect(candidate?.lastStaffName).toBe('中村 彩')
    expect(candidate?.attentionSummary).toBe('金属アレルギーのお申し出があります。')
    expect(candidate?.customer.phone).toBe('09012345678')
  })

  it('引き継ぐ「いまの度数」は、詳細で「いま使っています」が付く 1 行と同じ', async () => {
    const [candidate] = await lookup('phone=09012345678')
    const { body } = await detail(token, hanako)
    const current = body.prescriptions.filter((row) => row.isCurrent)
    expect(current).toHaveLength(1)
    expect(candidate?.currentPrescription?.id).toBe(current[0]?.id)
    expect(candidate?.currentPrescription?.measuredAt).toBe(current[0]?.measuredAt)
  })

  it('一覧の「ご来店」と候補のバッジは同じ数から作られる（AC-CUST-10）', async () => {
    const listed = await search(token, '?query=5678')
    const [candidate] = await lookup('phone=09012345678')
    expect(listed.body.items[0]?.visitCount).toBe(4)
    expect(candidate?.customer.visitCount).toBe(listed.body.items[0]?.visitCount)
  })

  it('「最後のご来店」は一覧でも候補でも JST の暦日 2026-05-12 になる', async () => {
    const listed = await search(token, '?query=5678')
    const [candidate] = await lookup('phone=09012345678')
    expect(listed.body.items[0]?.lastVisitAt).toBe('2026-05-12')
    expect(candidate?.lastVisitAt).toBe('2026-05-12')
  })

  it('ご来店が 0 件の方は来店回数 0・最後のご来店 null（画面が「初」と「—」を出す元）', async () => {
    const first = await insertCustomer(org, {
      name: '初回 花',
      kana: 'しょかい はな',
      phone: '090-1234-0001',
    })
    const { body } = await detail(token, first)
    expect(body).toMatchObject({ visitCount: 0, lastVisitAt: null })
  })
})

describe('JST の日跨ぎ（AC-CUST-11）', () => {
  const org = orgId()
  let token = ''

  beforeAll(async () => {
    token = await tokenFor(org)
    await insertStore(org)
    // 15:00Z ちょうど＝ JST の翌日 0:00。UTC のまま日付を読むと前日に落ちる。
    await insertCustomer(org, {
      name: '日跨ぎ 子',
      kana: 'ひまたぎ こ',
      phone: '090-9999-0001',
      lastVisitAt: '2026-08-27T15:00:00.000Z',
    })
    // 14:59:59Z は JST でもまだ 8 月 28 日ではない。
    await insertCustomer(org, {
      name: '寸前 子',
      kana: 'すんぜん こ',
      phone: '090-9999-0002',
      lastVisitAt: '2026-08-27T14:59:59.000Z',
    })
    // 年をまたぐ 1 件（12/31 15:00Z ＝ 翌年 1 月 1 日 JST）。
    await insertCustomer(org, {
      name: '年跨ぎ 子',
      kana: 'としまたぎ こ',
      phone: '090-9999-0003',
      lastVisitAt: '2026-12-31T15:00:00.000Z',
    })
  })

  it('一覧の「最後のご来店」が JST の暦日で 1 日ずれない', async () => {
    const { body } = await search(token, '?limit=50')
    const byName = new Map(body.items.map((row) => [row.name, row.lastVisitAt]))
    expect(byName.get('日跨ぎ 子')).toBe('2026-08-28')
    expect(byName.get('寸前 子')).toBe('2026-08-27')
    expect(byName.get('年跨ぎ 子')).toBe('2027-01-01')
  })

  it('候補の「最後のご来店」も同じ暦日になる', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/customers/lookup?phone=09099990001`, {
      headers: authed(token),
    })
    const [candidate] = (await res.json()) as Candidate[]
    expect(candidate?.lastVisitAt).toBe('2026-08-28')
  })
})

/* --- 同じお電話番号の 2 人（AC-CUST-08 / AC-CUST-12 / AC-CUST-13） ---------- */

describe('同じお電話番号でもう 1 名を登録する', () => {
  const org = orgId()
  let token = ''
  let storeId = ''

  beforeAll(async () => {
    token = await tokenFor(org)
    storeId = await insertStore(org)
  })

  async function create(body: unknown) {
    const res = await SELF.fetch(`${BASE}/api/staff/customers`, {
      method: 'POST',
      headers: authed(token),
      body: JSON.stringify(body),
    })
    return { status: res.status, body: (await res.json()) as DetailBody }
  }

  it('「別の方なので、新しく登録する」で 2 件目ができる（お電話番号で塞がない）', async () => {
    const first = await create({ name: '同番 一子', phone: '090-5555-1234' })
    const second = await create({ name: '同番 二子', phone: '090-5555-1234' })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.id).not.toBe(first.body.id)
    expect(second.body.customerNumber).not.toBe(first.body.customerNumber)

    // 照会は 2 件とも返す。どちらかを黙って消したり結び付けたりしない。
    const res = await SELF.fetch(`${BASE}/api/staff/customers/lookup?phone=09055551234`, {
      headers: authed(token),
    })
    const candidates = (await res.json()) as Candidate[]
    expect(candidates.map((row) => row.customer.id).sort()).toEqual(
      [first.body.id, second.body.id].sort(),
    )
  })

  it('「このお客様として進む」を選んだ経路では 1 件も増えない', async () => {
    const before = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM customers WHERE organization_id = ?',
    )
      .bind(org)
      .first<{ count: number }>()
    // 既存の 1 名を選ぶだけの経路は照会（GET）で、書き込みの API を 1 度も通らない。
    const res = await SELF.fetch(`${BASE}/api/staff/customers/lookup?phone=09055551234`, {
      headers: authed(token),
    })
    expect(res.status).toBe(200)
    const after = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM customers WHERE organization_id = ?',
    )
      .bind(org)
      .first<{ count: number }>()
    expect(after?.count).toBe(before?.count)
  })

  it('ご予約に付くのは選んだ 1 名だけで、もう 1 件の登録はそのまま残る（AC-CUST-13）', async () => {
    const chosen = await create({ name: '選ばれ 子', phone: '090-5555-9876' })
    const other = await create({ name: '選ばれず 子', phone: '090-5555-9876' })
    await insertVisit(org, {
      storeId,
      customerId: chosen.body.id,
      startsAt: jstAt('2027-04-01', '11:00'),
    })
    const attached = await env.DB.prepare(
      'SELECT customer_id AS customerId FROM reservations WHERE organization_id = ? AND customer_id IN (?, ?)',
    )
      .bind(org, chosen.body.id, other.body.id)
      .all<{ customerId: string }>()
    expect(attached.results.map((row) => row.customerId)).toEqual([chosen.body.id])
    // 勝手にまとめられていない（`merged_into_id` は両方 NULL のまま）。
    const rows = await env.DB.prepare(
      'SELECT merged_into_id AS mergedIntoId FROM customers WHERE id IN (?, ?)',
    )
      .bind(chosen.body.id, other.body.id)
      .all<{ mergedIntoId: string | null }>()
    expect(rows.results.every((row) => row.mergedIntoId === null)).toBe(true)
  })
})

/* --- 手書き 1 枚に添うもの（AC-CUST-18） ---------------------------------- */

describe('手書き 1 枚に添うもの', () => {
  const org = orgId()
  let token = ''
  let ginza = ''
  let marunouchi = ''
  let customerId = ''

  beforeAll(async () => {
    token = await tokenFor(org)
    ginza = await insertStore(org, 'EYEX 銀座店')
    marunouchi = await insertStore(org, 'EYEX 丸の内店')
    customerId = await insertCustomer(org, { name: '手書き 添子', kana: 'てがき そえこ' })
    // 記入者は「この端末に入っている人」に結び付いた staff 行から引く。
    await env.DB.prepare(
      'INSERT INTO staff (id, organization_id, store_id, admin_user_id, display_name, kana, job_label, role, max_parallel_reservations, pin_hash, pin_updated_at, is_active, sort_order, created_at, updated_at) ' +
        "VALUES (?,?,?,?,?,NULL,NULL,'staff',1,NULL,NULL,'1',0,?,?)",
    )
      .bind(crypto.randomUUID(), org, marunouchi, `dev:${org}`, '中村 彩', FIXED_NOW, FIXED_NOW)
      .run()
  })

  it('丸の内店で書いた 1 枚に日付・記入した店舗・記入者が添い、銀座店の端末から筆跡ごと読める', async () => {
    const written = await SELF.fetch(`${BASE}/api/staff/customers/${customerId}/notes`, {
      method: 'POST',
      headers: authed(token),
      body: JSON.stringify({ kind: 'memo', storeId: marunouchi, handwritingSvg: STROKE }),
    })
    expect(written.status).toBe(200)
    const note = (await written.json()) as NoteBody & {
      storeId: string
      authorName: string
      createdAt: string
    }
    expect(note.storeId).toBe(marunouchi)
    expect(note.authorName).toBe('中村 彩')
    expect(note.createdAt).not.toBe('')

    // 別の店舗を選んでいる端末（既定の `includeOtherStores`）でも筆跡ごと読める。
    const read = await SELF.fetch(`${BASE}/api/staff/customers/${customerId}/notes`, {
      headers: authed(token),
    })
    const notes = (await read.json()) as (NoteBody & { storeId: string })[]
    const found = notes.find((row) => row.id === note.id)
    expect(found?.storeId).toBe(marunouchi)
    expect(found?.handwritingSvg).toContain('<path')
    expect(ginza).not.toBe(marunouchi)
  })

  it('読み出した筆跡は保存した筆跡と 1 文字も変わらない（読むたびに逃がし直さない）', async () => {
    const raw =
      '<svg viewBox="0 0 600 400" aria-label="花子 &amp; 一郎">' +
      '<path d="M10 10 L100 90" stroke="#1b3a2f" stroke-width="3" fill="none"/></svg>'
    const written = await SELF.fetch(`${BASE}/api/staff/customers/${customerId}/notes`, {
      method: 'POST',
      headers: authed(token),
      body: JSON.stringify({ kind: 'memo', storeId: ginza, handwritingSvg: raw }),
    })
    const saved = (await written.json()) as NoteBody
    const read = await SELF.fetch(`${BASE}/api/staff/customers/${customerId}/notes`, {
      headers: authed(token),
    })
    const notes = (await read.json()) as NoteBody[]
    const again = notes.find((row) => row.id === saved.id)
    expect(again?.handwritingSvg).toBe(saved.handwritingSvg)
    expect(again?.handwritingSvg).toContain('&amp; 一郎')
    expect(again?.handwritingSvg).not.toContain('&amp;amp;')
  })
})

/* --- 台帳の詳細の見出し（AC-CUST-25） ------------------------------------- */

describe('台帳の詳細の見出し', () => {
  const org = orgId()
  let token = ''
  let storeId = ''
  let wide = ''
  let anonymous = ''

  beforeAll(async () => {
    token = await tokenFor(org)
    storeId = await insertStore(org)
    await insertBusinessHours(org, storeId, { closedWeekdays: [] })
    await insertSlotRules(org, storeId)
    const staffId = await insertStaff(org, storeId, { displayName: '佐藤 美咲' })
    await insertShift(org, storeId, staffId, { date: LEDGER_DATE })
    const hanako = await insertCustomer(org, {
      name: '田中 花子',
      kana: 'たなか はなこ',
      visitCount: 4,
    })
    wide = await insertVisit(org, {
      storeId,
      customerId: hanako,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      durationMinutes: 60,
      staffId,
    })
    anonymous = await insertVisit(org, {
      storeId,
      customerId: null,
      startsAt: jstAt(LEDGER_DATE, '14:00'),
      durationMinutes: 30,
      staffId,
    })
  })

  async function reservation(id: string) {
    const res = await SELF.fetch(`${BASE}/api/staff/reservations/${id}`, { headers: authed(token) })
    return {
      status: res.status,
      body: (await res.json()) as {
        customerId: string | null
        customerName: string | null
        visitCount: number | null
      },
    }
  }

  it('11:00 の帯を開いた詳細が、その方のお名前と来店回数を運ぶ', async () => {
    const { status, body } = await reservation(wide)
    expect(status).toBe(200)
    expect(body.customerName).toBe('田中 花子')
    expect(body.visitCount).toBe(4)
    expect(body.customerId).not.toBeNull()
  })

  it('お客様の付いていないご予約では 3 欄とも null（お名前を捏造しない）', async () => {
    const { body } = await reservation(anonymous)
    expect(body).toMatchObject({ customerId: null, customerName: null, visitCount: null })
  })

  it('帯と詳細は同じお名前・同じ来店回数を出す', async () => {
    const res = await SELF.fetch(
      `${BASE}/api/staff/ledger?storeId=${storeId}&date=${LEDGER_DATE}&axis=staff`,
      { headers: authed(token) },
    )
    const view = (await res.json()) as {
      lanes: {
        entries: {
          reservationId: string
          customerName: string | null
          visitCount: number | null
        }[]
      }[]
    }
    const band = view.lanes
      .flatMap((lane) => lane.entries)
      .find((entry) => entry.reservationId === wide)
    const { body } = await reservation(wide)
    expect(band?.customerName).toBe(body.customerName)
    expect(band?.visitCount).toBe(body.visitCount)
  })
})

/* --- R2 に置かれた 1 枚を、実行されうる形のまま返さない ------------------- */

describe('手書きの読み出し', () => {
  const org = orgId()
  let token = ''
  let storeId = ''
  let customerId = ''

  beforeAll(async () => {
    token = await tokenFor(org)
    storeId = await insertStore(org)
    customerId = await insertCustomer(org, { name: '再直列 化子', kana: 'さいちょくれつ かこ' })
  })

  it('書き込みの入口を通っていない 1 枚も、読み出しで許可リストに落ちる', async () => {
    /*
     * 保存のときに再直列化しているから読み出しは素通しでよい、とはしない。
     * バケットは受付録音と同じ `RECORDINGS` で、掃除の Cron・移行・別のサービスなど
     * Worker の入口を通らずに object が置かれうる。**他店舗の端末で開くのは読み出しの側**
     * なので、そこが最後の砦である。
     */
    const noteId = crypto.randomUUID()
    const key = `notes/${org}/${customerId}/${noteId}.svg`
    await env.RECORDINGS.put(
      key,
      '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script>' +
        '<foreignObject><iframe src="javascript:alert(3)"></iframe></foreignObject>' +
        '<image href="https://example.test/x.png"/>' +
        '<path d="M1 1 L9 9" stroke-width="2"/></svg>',
    )
    await env.DB.prepare(
      "INSERT INTO customer_notes (id, organization_id, customer_id, store_id, kind, body, handwriting_key, author_id, revision, status, created_at, updated_at) VALUES (?,?,?,?,'memo','',?,NULL,1,'draft',?,?)",
    )
      .bind(noteId, org, customerId, storeId, key, FIXED_NOW, FIXED_NOW)
      .run()

    const res = await SELF.fetch(`${BASE}/api/staff/customers/${customerId}/notes`, {
      headers: authed(token),
    })
    expect(res.status).toBe(200)
    const notes = (await res.json()) as NoteBody[]
    const svg = notes.find((row) => row.id === noteId)?.handwritingSvg ?? ''
    for (const forbidden of ['onload', '<script', 'alert(', '<foreignObject', '<iframe', 'href']) {
      expect(svg).not.toContain(forbidden)
    }
    // 筆跡の線は 1 本も減らない。
    expect(svg).toContain('<path d="M1 1 L9 9" stroke-width="2"/>')
    expect(svg).toContain('viewBox="0 0 10 10"')
    // R2 のキーもダウンロード URL も応答に出さない。
    expect(JSON.stringify(notes)).not.toContain('notes/')
  })

  it('R2 の object が失われている 1 枚は、行ごと消えず筆跡だけが null になる', async () => {
    const noteId = crypto.randomUUID()
    await env.DB.prepare(
      "INSERT INTO customer_notes (id, organization_id, customer_id, store_id, kind, body, handwriting_key, author_id, revision, status, created_at, updated_at) VALUES (?,?,?,?,'memo','読み取った文字だけ残っている',?,NULL,1,'draft',?,?)",
    )
      .bind(
        noteId,
        org,
        customerId,
        storeId,
        `notes/${org}/${customerId}/${crypto.randomUUID()}.svg`,
        FIXED_NOW,
        FIXED_NOW,
      )
      .run()
    const res = await SELF.fetch(`${BASE}/api/staff/customers/${customerId}/notes`, {
      headers: authed(token),
    })
    const notes = (await res.json()) as NoteBody[]
    const lost = notes.find((row) => row.id === noteId)
    expect(lost?.handwritingSvg).toBeNull()
    expect(lost?.body).toBe('読み取った文字だけ残っている')
  })
})
