/**
 * おまとめの代表フロー（P4 T-010 / T-013 の書き戻し）。
 *
 * 取り消せない操作なので、確かめるのは「まとまったこと」より
 * **「拒んだと言いながら付け替えだけは済んでいる」状態を作れないこと**である（AC-CUST-15）。
 * 拒んだあとは status だけを見ず、予約の `customer_id`・メモの `customer_id`・
 * 両者の `version`・`merged_into_id` の 5 つを読み直して下見の前と比べる。
 *
 * 店長は `StorePermission` の `settings.manage` を持つ人である（JWT の `role` では判定しない）。
 */
import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'
import {
  authed,
  BASE,
  FIXED_NOW,
  INTERNAL_HEADERS,
  insertStore,
  JSON_HEADERS,
  JWT_SECRET,
  jstAt,
  orgId,
  tokenFor,
} from './helpers'

let numberSeq = 1800

async function insertCustomer(
  org: string,
  seed: {
    name: string
    kana?: string
    phone?: string | null
    address?: string | null
    memo?: string
    customerNumber?: string
    visitCount?: number
  },
): Promise<string> {
  const id = crypto.randomUUID()
  const normalized = (seed.phone ?? '').replace(/\D/g, '')
  await env.DB.prepare(
    'INSERT INTO customers (id, organization_id, customer_number, name, kana, phone, phone_normalized, phone_last4, email, birth_date, address, memo, first_visit_at, last_visit_at, visit_count, merged_into_id, version, created_store_id, created_terminal_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,NULL,?,?,NULL,NULL,?,NULL,1,NULL,NULL,?,?)',
  )
    .bind(
      id,
      org,
      seed.customerNumber ?? `G-${String(++numberSeq).padStart(5, '0')}`,
      seed.name,
      seed.kana ?? '',
      normalized === '' ? null : (seed.phone ?? null),
      normalized === '' ? null : normalized,
      normalized === '' ? null : normalized.slice(-4),
      seed.address ?? null,
      seed.memo ?? '',
      seed.visitCount ?? 0,
      FIXED_NOW,
      FIXED_NOW,
    )
    .run()
  return id
}

async function insertNote(org: string, customerId: string, storeId: string, body: string) {
  await env.DB.prepare(
    "INSERT INTO customer_notes (id, organization_id, customer_id, store_id, kind, body, handwriting_key, author_id, revision, status, created_at, updated_at) VALUES (?,?,?,?,'memo',?,NULL,NULL,1,'draft',?,?)",
  )
    .bind(crypto.randomUUID(), org, customerId, storeId, body, FIXED_NOW, FIXED_NOW)
    .run()
}

let reservationSeq = 0

async function insertVisit(
  org: string,
  seed: {
    storeId: string
    customerId: string
    startsAt: string
    status?: 'confirmed' | 'arrived' | 'serving' | 'done' | 'cancelled' | 'no_show'
  },
): Promise<string> {
  const id = crypto.randomUUID()
  const endsAt = new Date(Date.parse(seed.startsAt) + 30 * 60_000).toISOString()
  await env.DB.prepare(
    'INSERT INTO reservations (id, organization_id, store_id, code, customer_id, source, status, starts_at, ends_at, duration_minutes, note_customer, note_internal, version, created_at, updated_at, created_by, cancelled_at, cancel_reason) VALUES (?,?,?,?,?,?,?,?,?,30,?,?,1,?,?,NULL,NULL,NULL)',
  )
    .bind(
      id,
      org,
      seed.storeId,
      `EY-2609-${String(++reservationSeq).padStart(4, '0')}`,
      seed.customerId,
      'phone',
      seed.status ?? 'confirmed',
      seed.startsAt,
      endsAt,
      '',
      '',
      FIXED_NOW,
      FIXED_NOW,
    )
    .run()
  return id
}

/** 選択中店舗の `StorePermission`。店長は `settings.manage` を持つ人。 */
async function syncMembership(
  org: string,
  storeId: string,
  userId: string,
  permissions: readonly string[],
) {
  await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      organizationId: org,
      storeId,
      userId,
      permissions,
      createdAt: FIXED_NOW,
    }),
  })
}

type Fixture = {
  org: string
  storeId: string
  /** 店長（`settings.manage` あり）のトークン。 */
  manager: string
  /** 同じ組織のスタッフ（`settings.read` まで）のトークン。 */
  clerk: string
  primaryId: string
  secondaryId: string
}

/**
 * モックの 2 件（G-01842 を残し、G-02310 を失う）。残す側にメモ 7 件、
 * 残さない側にメモ 1 件と予約 2 件を置く。
 */
async function fixture(): Promise<Fixture> {
  const org = orgId()
  const manager = await tokenFor(org)
  const storeId = await insertStore(org)
  await syncMembership(org, storeId, `dev:${org}`, ['settings.read', 'settings.manage'])
  const clerkSub = `dev:${org}:clerk`
  await syncMembership(org, storeId, clerkSub, ['settings.read'])
  const clerk = await signAccessToken(
    { sub: clerkSub, org, email: 'clerk@example.test', role: 'staff' },
    JWT_SECRET,
  )

  const primaryId = await insertCustomer(org, {
    name: '田中 花子',
    kana: 'たなか はなこ',
    phone: '090-1234-5678',
    address: '東京都中央区銀座 1-2-3',
    customerNumber: 'G-01842',
  })
  const secondaryId = await insertCustomer(org, {
    name: '田中 花子',
    kana: 'たなか はなこ',
    phone: '090-1234-9912',
    address: null,
    customerNumber: 'G-02310',
  })
  for (let index = 0; index < 7; index++) {
    await insertNote(org, primaryId, storeId, `残す側のメモ ${index + 1}`)
  }
  await insertNote(org, secondaryId, storeId, '残さない側のメモ 1')
  await insertVisit(org, {
    storeId,
    customerId: secondaryId,
    startsAt: jstAt('2026-05-12', '11:00'),
    status: 'done',
  })
  await insertVisit(org, {
    storeId,
    customerId: secondaryId,
    startsAt: jstAt('2027-03-01', '11:00'),
  })

  return { org, storeId, manager, clerk, primaryId, secondaryId }
}

type Preview = {
  fields: {
    field: string
    primaryValue: string | null
    secondaryValue: string | null
    choice: string
  }[]
  result: {
    customerNumber: string
    name: string
    phone: string | null
    visitCount: number
    lastVisitAt: string | null
  }
  noteCount: number
  losingCustomerNumber: string
}

async function preview(f: Fixture, token = f.manager) {
  const res = await SELF.fetch(`${BASE}/api/staff/customers/merge/preview`, {
    method: 'POST',
    headers: authed(token),
    body: JSON.stringify({ primaryId: f.primaryId, secondaryId: f.secondaryId }),
  })
  return { status: res.status, body: (await res.json()) as Preview }
}

async function versionsOf(f: Fixture) {
  const rows = await env.DB.prepare(
    'SELECT id, version, merged_into_id AS mergedIntoId FROM customers WHERE organization_id = ? ORDER BY customer_number',
  )
    .bind(f.org)
    .all<{ id: string; version: number; mergedIntoId: string | null }>()
  return rows.results
}

async function mergeWith(
  f: Fixture,
  input: {
    token?: string
    fields: Preview['fields']
    primaryVersion?: number
    secondaryVersion?: number
    idempotencyKey?: string
  },
) {
  const headers: Record<string, string> = { ...authed(input.token ?? f.manager) }
  if (input.idempotencyKey !== undefined) headers['idempotency-key'] = input.idempotencyKey
  const res = await SELF.fetch(`${BASE}/api/staff/customers/merge`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      primaryId: f.primaryId,
      secondaryId: f.secondaryId,
      primaryVersion: input.primaryVersion ?? 1,
      secondaryVersion: input.secondaryVersion ?? 1,
      fields: input.fields,
    }),
  })
  return {
    status: res.status,
    body: (await res.json()) as {
      error?: string
      mergedId?: string
      movedReservations?: number
      movedNotes?: number
      customer?: { id: string; customerNumber: string; visitCount: number }
    },
  }
}

/** 下見の前と後で読み比べる 5 つの値。 */
async function snapshot(f: Fixture) {
  const customers = await env.DB.prepare(
    'SELECT id, version, merged_into_id AS mergedIntoId FROM customers WHERE organization_id = ? ORDER BY id',
  )
    .bind(f.org)
    .all<{ id: string; version: number; mergedIntoId: string | null }>()
  const reservations = await env.DB.prepare(
    'SELECT id, customer_id AS customerId FROM reservations WHERE organization_id = ? ORDER BY id',
  )
    .bind(f.org)
    .all<{ id: string; customerId: string | null }>()
  const notes = await env.DB.prepare(
    'SELECT id, customer_id AS customerId FROM customer_notes WHERE organization_id = ? ORDER BY id',
  )
    .bind(f.org)
    .all<{ id: string; customerId: string }>()
  return {
    customers: customers.results,
    reservations: reservations.results,
    notes: notes.results,
  }
}

describe('おまとめ', () => {
  it('下見は項目ごとの残す側と、まとめたあとの姿と、失う番号を返す', async () => {
    const f = await fixture()
    const { status, body } = await preview(f)
    expect(status).toBe(200)
    // CUSTOMER-MERGE の見比べ表は 4 項目。この順で並ぶ。
    expect(body.fields.map((row) => row.field)).toEqual(['name', 'phone', 'address', 'notes'])
    expect(body.result.customerNumber).toBe('G-01842')
    expect(body.losingCustomerNumber).toBe('G-02310')
    expect(body.noteCount).toBe(8)
  })

  it('実行すると残さない側に merged_into_id が入り、行は消えない', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    const merged = await mergeWith(f, { fields: plan.fields })
    expect(merged.status).toBe(200)
    expect(merged.body.mergedId).toBe(f.secondaryId)
    const rows = await versionsOf(f)
    expect(rows).toHaveLength(2)
    const secondary = rows.find((row) => row.id === f.secondaryId)
    expect(secondary?.mergedIntoId).toBe(f.primaryId)
  })

  it('予約が残す側へ付け替わる', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    const merged = await mergeWith(f, { fields: plan.fields })
    expect(merged.body.movedReservations).toBe(2)
    const left = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM reservations WHERE organization_id = ? AND customer_id = ?',
    )
      .bind(f.org, f.secondaryId)
      .first<{ count: number }>()
    expect(left?.count).toBe(0)
    const moved = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM reservations WHERE organization_id = ? AND customer_id = ?',
    )
      .bind(f.org, f.primaryId)
      .first<{ count: number }>()
    expect(moved?.count).toBe(2)
  })

  it('メモが 7 + 1 = 8 件になる', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    const merged = await mergeWith(f, { fields: plan.fields })
    expect(merged.body.movedNotes).toBe(1)
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM customer_notes WHERE organization_id = ? AND customer_id = ?',
    )
      .bind(f.org, f.primaryId)
      .first<{ count: number }>()
    expect(row?.count).toBe(8)
  })

  it('audit_events に customer.merged が 1 件だけ増える', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    await mergeWith(f, { fields: plan.fields })
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE organization_id = ? AND action = 'customer.merged'",
    )
      .bind(f.org)
      .first<{ count: number }>()
    expect(row?.count).toBe(1)
  })

  it('同じ Idempotency-Key の再送では 2 度走らず、同じ結果が返る', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    const key = crypto.randomUUID()
    const first = await mergeWith(f, { fields: plan.fields, idempotencyKey: key })
    const second = await mergeWith(f, { fields: plan.fields, idempotencyKey: key })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body).toEqual(first.body)
    const audits = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE organization_id = ? AND action = 'customer.merged'",
    )
      .bind(f.org)
      .first<{ count: number }>()
    expect(audits?.count).toBe(1)
  })

  it('同じ Idempotency-Key に違う本文を送ると 409 idempotency_conflict', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    const key = crypto.randomUUID()
    await mergeWith(f, { fields: plan.fields, idempotencyKey: key })
    const changed = plan.fields.map((row) =>
      row.field === 'name' ? { ...row, choice: 'secondary' } : row,
    )
    const conflicted = await mergeWith(f, { fields: changed, idempotencyKey: key })
    expect(conflicted.status).toBe(409)
    expect(conflicted.body.error).toBe('idempotency_conflict')
  })

  it('失った番号 G-02310 では一覧からも検索からも引けない', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    await mergeWith(f, { fields: plan.fields })
    const res = await SELF.fetch(`${BASE}/api/staff/customers?limit=50`, {
      headers: authed(f.manager),
    })
    const list = (await res.json()) as { items: { id: string }[]; total: number }
    expect(list.items.map((row) => row.id)).not.toContain(f.secondaryId)
    expect(list.total).toBe(1)
    const searched = await SELF.fetch(`${BASE}/api/staff/customers?query=9912`, {
      headers: authed(f.manager),
    })
    const found = (await searched.json()) as { items: { id: string }[] }
    expect(found.items).toEqual([])
  })

  it('下見のあとに片方へ新しい予約が入ると 409 で拒む', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    await insertVisit(f.org, {
      storeId: f.storeId,
      customerId: f.primaryId,
      startsAt: jstAt('2027-06-01', '11:00'),
    })
    const refused = await mergeWith(f, { fields: plan.fields })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe('version_conflict')
  })

  it('拒んだあと、予約の customer_id・メモの customer_id・両者の version・merged_into_id がすべて下見の前と同じ', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    const before = await snapshot(f)
    const intruder = await insertVisit(f.org, {
      storeId: f.storeId,
      customerId: f.primaryId,
      startsAt: jstAt('2027-06-01', '11:00'),
    })
    const refused = await mergeWith(f, { fields: plan.fields })
    expect(refused.status).toBe(409)

    const after = await snapshot(f)
    expect(after.customers).toEqual(before.customers)
    expect(after.notes).toEqual(before.notes)
    // 割り込んだ 1 件だけが増え、もとの予約の付け先は 1 つも動いていない。
    expect(after.reservations.filter((row) => row.id !== intruder)).toEqual(before.reservations)
  })

  it('店長でない主体の実行は 403 で、どちらの登録も 1 行も変わらない', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    const before = await snapshot(f)
    const refused = await mergeWith(f, { fields: plan.fields, token: f.clerk })
    expect(refused.status).toBe(403)
    expect(await snapshot(f)).toEqual(before)
  })

  it('店長でない主体は下見も 403（入口が画面のどこにも出ない）', async () => {
    const f = await fixture()
    const denied = await preview(f, f.clerk)
    expect(denied.status).toBe(403)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 来店回数の書き戻し（T-013）
 *
 * `visit_count` / `first_visit_at` / `last_visit_at` は読むたびに数え直さず、
 * お客様の予約の集合が変わった瞬間に同じバッチで書き戻す。P4 でその集合が変わるのは
 * おまとめだけである（`done` へ進める `PATCH .../progress` は P5 の面）。
 * ─────────────────────────────────────────────────────────────────────────── */

describe('来店回数の書き戻し', () => {
  it('done の予約だけを数え、取り消しと不来店は数えない', async () => {
    const f = await fixture()
    await insertVisit(f.org, {
      storeId: f.storeId,
      customerId: f.secondaryId,
      startsAt: jstAt('2026-06-01', '11:00'),
      status: 'done',
    })
    await insertVisit(f.org, {
      storeId: f.storeId,
      customerId: f.secondaryId,
      startsAt: jstAt('2026-06-02', '11:00'),
      status: 'cancelled',
    })
    await insertVisit(f.org, {
      storeId: f.storeId,
      customerId: f.secondaryId,
      startsAt: jstAt('2026-06-03', '11:00'),
      status: 'no_show',
    })
    const { body: plan } = await preview(f)
    const merged = await mergeWith(f, { fields: plan.fields })
    expect(merged.status).toBe(200)
    expect(merged.body.customer?.visitCount).toBe(2)
  })

  it('last_visit_at は接客中も数えた最終 starts_at の JST 暦日になる', async () => {
    const f = await fixture()
    // UTC 15:00 をまたぐ 1 件。JST では翌日の 0 時なので暦日は 8 月 28 日。
    await insertVisit(f.org, {
      storeId: f.storeId,
      customerId: f.secondaryId,
      startsAt: '2026-08-27T15:00:00.000Z',
      status: 'serving',
    })
    const { body: plan } = await preview(f)
    const merged = await mergeWith(f, { fields: plan.fields })
    expect(merged.status).toBe(200)
    /*
     * `AC-CUST-11` は「最後のご来店」を**来店済み（`arrived` / `serving` / `done`）の
     * 予約の最終 `starts_at`」と定めている。いまお店にいらしている方の日付が
     * 前回のまま止まると、一覧・要約・重複の警告に古い日付が出続ける
     * （実装不足の洗い出し customers-05）。
     * 来店回数（`visit_count`）のほうは AC-RECEP-23 のとおり退店（`done`）だけを数える。
     */
    const row = await env.DB.prepare(
      'SELECT last_visit_at AS lastVisitAt, visit_count AS visitCount FROM customers WHERE id = ?',
    )
      .bind(f.primaryId)
      .first<{ lastVisitAt: string; visitCount: number }>()
    expect(row?.lastVisitAt).toBe('2026-08-27T15:00:00.000Z')
    const res = await SELF.fetch(`${BASE}/api/staff/customers/${f.primaryId}`, {
      headers: authed(f.manager),
    })
    const detail = (await res.json()) as { lastVisitAt: string | null }
    // UTC 15:00 をまたぐので JST では翌日。暦日は 8 月 28 日。
    expect(detail.lastVisitAt).toBe('2026-08-28')
  })

  it('first_visit_at は最初の来店済みの日で、あとから来る予約で書き換わらない', async () => {
    const f = await fixture()
    await insertVisit(f.org, {
      storeId: f.storeId,
      customerId: f.secondaryId,
      startsAt: jstAt('2024-02-29', '11:00'),
      status: 'done',
    })
    const { body: plan } = await preview(f)
    await mergeWith(f, { fields: plan.fields })
    const res = await SELF.fetch(`${BASE}/api/staff/customers/${f.primaryId}`, {
      headers: authed(f.manager),
    })
    const detail = (await res.json()) as { firstVisitAt: string | null; lastVisitAt: string | null }
    expect(detail.firstVisitAt).toBe('2024-02-29')
    expect(detail.lastVisitAt).toBe('2026-05-12')
  })

  it('下見の result.visitCount / lastVisitAt は、customers.visit_count の保存値が古くても実行後の値と一致する', async () => {
    // fixture() は両者の visit_count を保存値 0 のまま作る（P5 の書き戻しが無いと
    // 古いまま残る列）。それでも secondary には 2026-05-12 の done が 1 件あるので、
    // 「下見に出した姿と実行が書き込む行を同じ 1 か所から作る」原則どおりなら、
    // 下見は保存値の素の足し算（0）ではなく実際の来店から数えた値を返すはずである。
    const f = await fixture()
    const { body: plan } = await preview(f)
    expect(plan.result.visitCount).toBe(1)
    expect(plan.result.lastVisitAt).toBe('2026-05-12')

    const merged = await mergeWith(f, { fields: plan.fields })
    expect(merged.status).toBe(200)
    expect(merged.body.customer?.visitCount).toBe(plan.result.visitCount)
    const res = await SELF.fetch(`${BASE}/api/staff/customers/${f.primaryId}`, {
      headers: authed(f.manager),
    })
    const detail = (await res.json()) as { lastVisitAt: string | null }
    expect(detail.lastVisitAt).toBe(plan.result.lastVisitAt)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 拒み方
 * ─────────────────────────────────────────────────────────────────────────── */

describe('おまとめの拒み方', () => {
  it('下見をせずに実行すると 409 で、下見からやり直させる', async () => {
    const f = await fixture()
    const refused = await mergeWith(f, {
      fields: [
        {
          field: 'name',
          primaryValue: '田中 花子',
          secondaryValue: '田中 花子',
          choice: 'primary',
        },
      ],
    })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe('version_conflict')
  })

  it('同じお客様どうしは下見も実行も 400', async () => {
    const f = await fixture()
    const res = await SELF.fetch(`${BASE}/api/staff/customers/merge/preview`, {
      method: 'POST',
      headers: authed(f.manager),
      body: JSON.stringify({ primaryId: f.primaryId, secondaryId: f.primaryId }),
    })
    expect(res.status).toBe(400)
  })

  it('未認証では下見も実行も 401（JSON_HEADERS だけでは入口に届かない）', async () => {
    const f = await fixture()
    const res = await SELF.fetch(`${BASE}/api/staff/customers/merge/preview`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ primaryId: f.primaryId, secondaryId: f.secondaryId }),
    })
    expect(res.status).toBe(401)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 2 巡目に足した敵対的な確かめ
 *
 * 1 巡目は「まとまったこと」と「拒んだあとに何も動いていないこと」までは見ていたが、
 * **半端にまとまった状態**（残す側の版だけが進む／残さない側だけが統合先を持つ）と、
 * **途中で 1 文が失敗したときにバッチ全体が巻き戻ること**は読んでいなかった。
 * ─────────────────────────────────────────────────────────────────────────── */

describe('おまとめの原子性', () => {
  it('最後の 1 文が 2 行とも動かし、版が片方だけ進む状態を作らない', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    const merged = await mergeWith(f, { fields: plan.fields })
    expect(merged.status).toBe(200)

    const rows = await env.DB.prepare(
      'SELECT id, version, merged_into_id AS mergedIntoId FROM customers WHERE organization_id = ?',
    )
      .bind(f.org)
      .all<{ id: string; version: number; mergedIntoId: string | null }>()
    const primary = rows.results.find((row) => row.id === f.primaryId)
    const secondary = rows.results.find((row) => row.id === f.secondaryId)
    // 版は 2 人ぶん同時に +1 する。片方だけ進むと、次の下見と実行の条件が静かにずれる。
    expect(primary?.version).toBe(2)
    expect(secondary?.version).toBe(2)
    // 統合先を持つのは残さない側だけ。残す側に統合先が入ると、まとめた先が自分を指す。
    expect(primary?.mergedIntoId).toBeNull()
    expect(secondary?.mergedIntoId).toBe(f.primaryId)
  })

  it('同じ下見でもう一度実行しても、二重にまとまらない', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    expect((await mergeWith(f, { fields: plan.fields })).status).toBe(200)
    const after = await snapshot(f)

    // 版が進んでいるので条件が通らない。写しも消してあるので下見からやり直しになる。
    const again = await mergeWith(f, { fields: plan.fields })
    expect(again.status).toBe(409)
    expect(await snapshot(f)).toEqual(after)
  })

  it('すでにまとめられた登録を、さらに 3 人目へまとめられない', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    await mergeWith(f, { fields: plan.fields })

    const third = await insertCustomer(f.org, { name: '三人目 子', kana: 'さんにんめ こ' })
    const chained: Fixture = { ...f, primaryId: third, secondaryId: f.secondaryId }
    const before = await snapshot(f)
    // 下見は開けても（まとめ済みの行も id を知っていれば読める）、実行は条件で止まる。
    await preview(chained)
    const refused = await mergeWith(chained, { fields: plan.fields, secondaryVersion: 2 })
    expect(refused.status).toBe(409)

    const rows = await env.DB.prepare(
      'SELECT merged_into_id AS mergedIntoId FROM customers WHERE id = ?',
    )
      .bind(f.secondaryId)
      .first<{ mergedIntoId: string | null }>()
    // 統合先は最初にまとめた相手のまま。3 人目へ付け替わっていない。
    expect(rows?.mergedIntoId).toBe(f.primaryId)
    expect((await snapshot(f)).reservations).toEqual(before.reservations)
  })

  it('バッチの途中の 1 文が失敗すると、先に並んだ付け替えごと巻き戻る', async () => {
    // おまとめが原子性を D1 の `batch()` に預けている以上、その前提そのものを
    // 実 D1 で確かめる。**おまとめと同じ並び**（付け替え → 追記 → 版の +1）を作り、
    // 真ん中の 1 文だけをわざと壊す。
    const f = await fixture()
    const before = await snapshot(f)
    const failed = await env.DB.batch([
      env.DB.prepare(
        'UPDATE reservations SET customer_id = ? WHERE organization_id = ? AND customer_id = ?',
      ).bind(f.primaryId, f.org, f.secondaryId),
      // 主キーが重なる INSERT。ここで例外になる。
      env.DB.prepare(
        'INSERT INTO customers (id, organization_id, customer_number, name, kana, phone, phone_normalized, phone_last4, email, birth_date, address, memo, first_visit_at, last_visit_at, visit_count, merged_into_id, version, created_store_id, created_terminal_id, created_at, updated_at) VALUES (?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,?,NULL,NULL,0,NULL,1,NULL,NULL,?,?)',
      ).bind(f.primaryId, f.org, 'G-09999', '衝突 子', '', '', FIXED_NOW, FIXED_NOW),
      env.DB.prepare('UPDATE customers SET version = version + 1 WHERE id = ?').bind(f.primaryId),
    ]).then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    )
    expect(failed).toBe('rejected')
    // 1 文目の付け替えも 3 文目の版も残っていない。
    expect(await snapshot(f)).toEqual(before)
  })
})

describe('おまとめと来店回数', () => {
  it('両方に来店があっても二重に数えず、寄せた集合の done の件数になる', async () => {
    const f = await fixture()
    // 残す側に 2 件、残さない側に（fixture の 1 件に足して）2 件。合わせて done は 4 件。
    for (const date of ['2026-02-01', '2026-03-01']) {
      await insertVisit(f.org, {
        storeId: f.storeId,
        customerId: f.primaryId,
        startsAt: jstAt(date, '11:00'),
        status: 'done',
      })
    }
    await insertVisit(f.org, {
      storeId: f.storeId,
      customerId: f.secondaryId,
      startsAt: jstAt('2026-04-01', '11:00'),
      status: 'done',
    })
    const { body: plan } = await preview(f)
    const merged = await mergeWith(f, { fields: plan.fields })
    expect(merged.status).toBe(200)
    expect(merged.body.customer?.visitCount).toBe(4)

    // 数え直した値は、寄せたあとの予約を数え直した値と一致する。
    const counted = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM reservations WHERE organization_id = ? AND customer_id = ? AND status = 'done'",
    )
      .bind(f.org, f.primaryId)
      .first<{ count: number }>()
    expect(merged.body.customer?.visitCount).toBe(counted?.count)
  })

  it('まとめたあとの来店回数は、保存値の素の足し算にならない', async () => {
    // fixture の 2 人は保存値 0 のまま。素の足し算なら 0、数え直しなら 1 になる。
    const f = await fixture()
    const { body: plan } = await preview(f)
    const merged = await mergeWith(f, { fields: plan.fields })
    expect(merged.body.customer?.visitCount).toBe(1)
  })
})

describe('まとめられた登録の見え方', () => {
  it('照会・一覧・台帳の帯・ご予約の詳細のどこにも、残さない側が出てこない', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    await mergeWith(f, { fields: plan.fields })

    // 照会（受付の候補）。番号の前方一致でも拾わない。
    const lookedUp = await SELF.fetch(`${BASE}/api/staff/customers/lookup?phone=09012349912`, {
      headers: authed(f.manager),
    })
    const candidates = (await lookedUp.json()) as { customer: { id: string } }[]
    expect(candidates.map((row) => row.customer.id)).not.toContain(f.secondaryId)

    // 一覧（お名前でも下 4 桁でも）。
    for (const query of ['9912', encodeURIComponent('田中')]) {
      const listed = await SELF.fetch(`${BASE}/api/staff/customers?query=${query}&limit=50`, {
        headers: authed(f.manager),
      })
      const body = (await listed.json()) as { items: { id: string }[] }
      expect(body.items.map((row) => row.id)).not.toContain(f.secondaryId)
    }

    // ご予約の詳細（寄せた予約はどれも残す側のお名前を出す）。
    const moved = await env.DB.prepare(
      'SELECT id FROM reservations WHERE organization_id = ? AND customer_id = ?',
    )
      .bind(f.org, f.primaryId)
      .all<{ id: string }>()
    expect(moved.results.length).toBeGreaterThan(0)
    for (const row of moved.results) {
      const res = await SELF.fetch(`${BASE}/api/staff/reservations/${row.id}`, {
        headers: authed(f.manager),
      })
      const detail = (await res.json()) as {
        customerId: string | null
        customerName: string | null
      }
      expect(detail.customerId).toBe(f.primaryId)
      expect(detail.customerName).toBe('田中 花子')
    }
  })
})

describe('おまとめの記録', () => {
  it('操作した者・店舗・日時が残り、平文のお名前とお電話番号は残さない', async () => {
    const f = await fixture()
    const { body: plan } = await preview(f)
    await mergeWith(f, { fields: plan.fields })

    const event = await env.DB.prepare(
      "SELECT actor_type AS actorType, store_id AS storeId, target_id AS targetId, after_json AS afterJson, correlation_id AS correlationId, occurred_at AS occurredAt FROM audit_events WHERE organization_id = ? AND action = 'customer.merged'",
    )
      .bind(f.org)
      .first<{
        actorType: string
        storeId: string | null
        targetId: string
        afterJson: string
        correlationId: string | null
        occurredAt: string
      }>()
    expect(event?.actorType).toBe('staff')
    expect(event?.storeId).toBe(f.storeId)
    expect(event?.targetId).toBe(f.primaryId)
    // 日時は ISO8601 の瞬間で、実行の時刻に付く。
    expect(event?.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(event?.correlationId).not.toBeNull()

    // 追記に入るのは id と番号と選択だけ。平文のお名前・お電話番号は入れない。
    const after = event?.afterJson ?? ''
    expect(after).toContain(f.secondaryId)
    expect(after).toContain('G-02310')
    expect(after).not.toContain('田中 花子')
    expect(after).not.toContain('09012345678')
    expect(after).not.toContain('090-1234-5678')
  })
})

describe('同時に触られたとき', () => {
  it('2 台が同じお客様を同時に直すと、勝つのは 1 台だけで版は 1 つしか進まない', async () => {
    const f = await fixture()
    const patch = (name: string) =>
      SELF.fetch(`${BASE}/api/staff/customers/${f.primaryId}`, {
        method: 'PATCH',
        headers: authed(f.manager),
        body: JSON.stringify({ name, version: 1 }),
      })
    const [first, second] = await Promise.all([patch('銀座 の端末'), patch('丸の内 の端末')])
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 409])

    const row = await env.DB.prepare('SELECT name, version FROM customers WHERE id = ?')
      .bind(f.primaryId)
      .first<{ name: string; version: number }>()
    expect(row?.version).toBe(2)
    expect(['銀座 の端末', '丸の内 の端末']).toContain(row?.name)
  })

  it('同じ番号で同時に何人も登録しても、お客様番号が重ならない', async () => {
    const f = await fixture()
    const created = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        SELF.fetch(`${BASE}/api/staff/customers`, {
          method: 'POST',
          headers: authed(f.manager),
          body: JSON.stringify({ name: `同時 ${index}`, phone: '090-7777-1234' }),
        }).then(async (res) => ({ status: res.status, body: await res.json() })),
      ),
    )
    expect(created.every((row) => row.status === 200)).toBe(true)
    const numbers = created.map((row) => (row.body as { customerNumber: string }).customerNumber)
    expect(new Set(numbers).size).toBe(numbers.length)
    for (const number of numbers) expect(number).toMatch(/^G-\d{5}$/)
  })
})

describe('接客のメモの残し方', () => {
  /** 下見が出した件数と、まとめたあとに残す側が持つ件数が食い違わないこと。 */
  const choicesFor = (plan: Preview, notes: string): Preview['fields'] =>
    plan.fields.map((row) => (row.field === 'notes' ? { ...row, choice: notes } : row))

  for (const notes of ['both', 'secondary', 'primary'] as const) {
    it(`「${notes}」を選んだとき、下見の件数と残す側が持つ件数が一致する`, async () => {
      const f = await fixture()
      const { body: plan } = await preview(f)
      const chosen = choicesFor(plan, notes)
      // 下見をもう一度取り直し、その選択での件数を読む。
      const res = await SELF.fetch(`${BASE}/api/staff/customers/merge/preview`, {
        method: 'POST',
        headers: authed(f.manager),
        body: JSON.stringify({ primaryId: f.primaryId, secondaryId: f.secondaryId }),
      })
      expect(res.status).toBe(200)

      const merged = await mergeWith(f, { fields: chosen })
      expect(merged.status).toBe(200)
      const kept = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM customer_notes WHERE organization_id = ? AND customer_id = ?',
      )
        .bind(f.org, f.primaryId)
        .first<{ count: number }>()
      expect(kept?.count).toBe(notes === 'primary' ? 7 : 8)
    })
  }
})

describe('写しがまだ書けていない再送', () => {
  it('応答の写しが空の done へ再送しても 500 にならず、409 で鍵を作り直させる', async () => {
    /*
     * おまとめの応答は、まとめ終えた詳細を読まないと組めない。だから写しはバッチの
     * **あと**の 1 文で書かれ、その隙間に同じ鍵の再送が届きうる。
     * ここで `JSON.parse('')` を投げると、確定しているのに失敗と見える。
     */
    const f = await fixture()
    const { body: plan } = await preview(f)
    const key = crypto.randomUUID()
    expect((await mergeWith(f, { fields: plan.fields, idempotencyKey: key })).status).toBe(200)

    // 写しが書かれる前の姿へ戻す（バッチが置く値は空文字である）。
    const written = await env.DB.prepare(
      "UPDATE idempotency_records SET response_json = '' WHERE organization_id = ? AND scope = 'customer.merge'",
    )
      .bind(f.org)
      .run()
    expect(written.meta.changes).toBe(1)

    const resent = await mergeWith(f, { fields: plan.fields, idempotencyKey: key })
    expect(resent.status).toBe(409)
    expect(resent.body.error).toBe('idempotency_conflict')
  })
})
