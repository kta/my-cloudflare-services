/**
 * 業務 API の**権限マトリクス**を表駆動で固定する。
 *
 * ゲートは default-deny（`/api/*` に一括適用）なので、ルートを足しただけで
 * 守られる。その性質が壊れていないことを、未知パスへのアクセスでも確かめる。
 * 期限切れは「権限なし(403)」ではなく「未認証(401)」に写像されなければならない
 * — クライアントの再ログイン判定がこの区別に依存している。
 *
 * 設定の**読み取りは店舗の誰でも、書き込みは `settings.manage` を持つ人だけ**（AC-SET-17）。
 * 判定は JWT の `role` ではなく `store_memberships` の許可リストで行うので、
 * 主体は「店長（settings.manage あり）」と「スタッフ（settings.read まで）」を別に立てる。
 *
 * 新しいルートを足したら、この表に 1 行足す。
 */
import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import { BASE, INTERNAL_HEADERS, JSON_HEADERS, JWT_SECRET, orgId, tokenFor } from './helpers'

type ActorName = 'none' | 'staff' | 'admin' | 'manager' | 'clerk' | 'expired' | 'wrong-secret'

const ORG = orgId()
const NOW = '2026-08-27T02:08:00.000Z'
const tokens: Record<Exclude<ActorName, 'none'>, string> = {
  staff: '',
  admin: '',
  manager: '',
  clerk: '',
  expired: '',
  'wrong-secret': '',
}

/** 表が叩く実在の行。設定の書き込みが 200 になる形を用意しておく。 */
const fixture = {
  storeId: '',
  staffId: '',
  equipmentId: '',
  maintenanceId: '',
  purposeId: '',
  exceptionId: '',
}

/** dev グラントが載せる `sub`。membership の `userId` はこれに合わせる。 */
const subOf = (org: string, suffix = '') => `dev:${org}${suffix}`

async function syncMembership(org: string, storeId: string, userId: string, permissions: string[]) {
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

beforeAll(async () => {
  tokens.staff = await tokenFor(ORG, 'staff')
  tokens.admin = await tokenFor(ORG, 'admin')
  // 店長とスタッフは同じ組織の別人。dev グラントは組織ごとに 1 つの sub しか作らないので、
  // 2 人ぶんのトークンは署名から自分で作る。
  tokens.manager = await signAccessToken(
    { sub: subOf(ORG, ':manager'), org: ORG, email: 'manager@example.test', role: 'staff' },
    JWT_SECRET,
  )
  tokens.clerk = await signAccessToken(
    { sub: subOf(ORG, ':clerk'), org: ORG, email: 'clerk@example.test', role: 'staff' },
    JWT_SECRET,
  )
  // 期限切れは固定の過去時刻から作る（`now` を引数で注入するので実時刻に依存しない）。
  const issuedAt = Math.floor(Date.parse('2020-01-01T00:00:00.000Z') / 1000)
  tokens.expired = await signAccessToken(
    { sub: 'dev:expired', org: ORG, email: 'a@example.test', role: 'staff' },
    JWT_SECRET,
    1,
    issuedAt,
  )
  tokens['wrong-secret'] = await signAccessToken(
    { sub: 'dev:other', org: ORG, email: 'a@example.test', role: 'staff' },
    'another-secret-entirely',
  )

  fixture.storeId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO stores (id, organization_id, name, slug, phone, address, access_note, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      fixture.storeId,
      ORG,
      'EYEX 銀座店',
      `ginza-${crypto.randomUUID().slice(0, 8)}`,
      '',
      '',
      '',
      '1',
      NOW,
    )
    .run()
  await syncMembership(ORG, fixture.storeId, subOf(ORG, ':manager'), [
    'settings.read',
    'settings.manage',
  ])
  await syncMembership(ORG, fixture.storeId, subOf(ORG, ':clerk'), ['settings.read'])

  fixture.staffId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO staff (id, organization_id, store_id, display_name, role, max_parallel_reservations, is_active, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(fixture.staffId, ORG, fixture.storeId, '佐藤 美咲', 'staff', 1, '1', 0, NOW, NOW)
    .run()

  fixture.equipmentId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO equipment (id, organization_id, store_id, name, kind, role_label, capacity, is_active, ledger_display, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      fixture.equipmentId,
      ORG,
      fixture.storeId,
      '視力測定機 A',
      'measure',
      '視力測定',
      1,
      '1',
      'grey',
      0,
      NOW,
      NOW,
    )
    .run()

  fixture.maintenanceId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO equipment_maintenance (id, organization_id, store_id, equipment_id, starts_at, ends_at, note, created_at) VALUES (?,?,?,?,?,?,?,?)',
  )
    .bind(
      fixture.maintenanceId,
      ORG,
      fixture.storeId,
      fixture.equipmentId,
      '2026-08-28T01:00:00.000Z',
      '2026-08-28T03:00:00.000Z',
      '定期点検',
      NOW,
    )
    .run()

  fixture.exceptionId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO store_calendar_exceptions (id, organization_id, store_id, date, kind, note, created_at) VALUES (?,?,?,?,?,?,?)',
  )
    .bind(fixture.exceptionId, ORG, fixture.storeId, '2026-09-30', 'closed', '棚卸しのため', NOW)
    .run()

  fixture.purposeId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO visit_purposes (id, organization_id, store_id, name_internal, name_public, name_short, duration_minutes, is_web_published, is_active, sort_order, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      fixture.purposeId,
      ORG,
      fixture.storeId,
      'メガネを新しく作る',
      '新しいメガネを作る',
      '新調相談',
      60,
      '1',
      '1',
      0,
      1,
      NOW,
      NOW,
    )
    .run()
})

function headersFor(actor: ActorName): HeadersInit {
  if (actor === 'none') return JSON_HEADERS
  return { ...JSON_HEADERS, authorization: `Bearer ${tokens[actor]}` }
}

/** いまの設定の版。店長の保存が 1 行ごとに版を進めるので、送る直前に読み直す。 */
async function currentVersion(): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT version FROM store_settings_revision WHERE organization_id = ? AND store_id = ?',
  )
    .bind(ORG, fixture.storeId)
    .first<{ version: number }>()
  return row?.version ?? 1
}

/** 目的だけは行そのものの版で衝突を見る（チェーン共通の行があるため）。 */
async function currentPurposeVersion(): Promise<number> {
  const row = await env.DB.prepare('SELECT version FROM visit_purposes WHERE id = ?')
    .bind(fixture.purposeId)
    .first<{ version: number }>()
  return row?.version ?? 1
}

type Row = {
  name: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: () => string
  body?: () => Promise<unknown> | unknown
  expected: Partial<Record<ActorName, number>>
}

/** 読み取りは店舗の誰でも通る。未認証・期限切れ・別 secret だけが 401。 */
const READ = {
  none: 401,
  staff: 200,
  manager: 200,
  clerk: 200,
  expired: 401,
  'wrong-secret': 401,
} as const
/** 書き込みは `settings.manage` を持つ店長だけ。持たない人は 403（401 にしない）。 */
const WRITE = {
  none: 401,
  staff: 403,
  manager: 200,
  clerk: 403,
  expired: 401,
  'wrong-secret': 401,
} as const

const sevenRows = () =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isClosed: false,
    opensAt: '10:00',
    closesAt: '19:00',
  }))

const weeklyShifts = () =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isOff: false,
    startsAt: '10:00',
    endsAt: '19:00',
    breaks: [],
  }))

/**
 * 期待値は「その主体がそのパスを叩いたときの status」。
 * 200 系は経路が通ったこと、401 は未認証、403 は権限不足、404 は存在しないこと。
 */
const TABLE: Row[] = [
  {
    name: 'ヘルスチェックは誰でも通る',
    method: 'GET',
    path: () => '/api/health',
    expected: { none: 200, staff: 200, admin: 200, expired: 200, 'wrong-secret': 200 },
  },
  {
    name: '店舗一覧はテナントの JWT を要求する',
    method: 'GET',
    path: () => '/api/staff/stores',
    expected: { none: 401, staff: 200, admin: 200, expired: 401, 'wrong-secret': 401 },
  },
  {
    name: '未知パスも default-deny の対象（ルートを足し忘れても漏れない）',
    method: 'GET',
    path: () => '/api/staff/not-a-route',
    expected: { none: 401, staff: 404, admin: 404, expired: 401, 'wrong-secret': 401 },
  },
  {
    name: '内部 API はテナント JWT では越えられない（共有鍵が要る）',
    method: 'GET',
    path: () => '/api/internal/organizations',
    expected: { none: 401, staff: 401, admin: 401, expired: 401, 'wrong-secret': 401 },
  },

  /* --- 店舗の情報 --- */
  {
    name: '店舗の情報は誰でも読める',
    method: 'GET',
    path: () => `/api/staff/stores/${fixture.storeId}`,
    expected: READ,
  },
  {
    name: '店舗の情報の保存は店長だけ',
    method: 'PATCH',
    path: () => `/api/staff/stores/${fixture.storeId}`,
    body: async () => ({ name: 'EYEX 銀座店', version: await currentVersion() }),
    expected: WRITE,
  },

  /* --- 営業時間 --- */
  {
    name: '営業時間は誰でも読める',
    method: 'GET',
    path: () => `/api/staff/stores/${fixture.storeId}/business-hours`,
    expected: READ,
  },
  {
    name: '営業時間の保存は店長だけ',
    method: 'PUT',
    path: () => `/api/staff/stores/${fixture.storeId}/business-hours`,
    body: async () => ({ rows: sevenRows(), version: await currentVersion() }),
    expected: WRITE,
  },

  /* --- 営業日 --- */
  {
    name: '営業日は誰でも読める',
    method: 'GET',
    path: () =>
      `/api/staff/stores/${fixture.storeId}/calendar-exceptions?from=2026-09-01&to=2026-10-31`,
    expected: READ,
  },
  {
    name: '臨時のお休みの追加は店長だけ',
    method: 'POST',
    path: () => `/api/staff/stores/${fixture.storeId}/calendar-exceptions`,
    body: () => ({ date: '2026-09-29', kind: 'closed' }),
    expected: WRITE,
  },
  {
    name: '臨時のお休みの取り消しは店長だけ',
    method: 'DELETE',
    path: () => `/api/staff/stores/${fixture.storeId}/calendar-exceptions/${fixture.exceptionId}`,
    expected: WRITE,
  },

  /* --- 予約の間隔 --- */
  {
    name: '予約の間隔は誰でも読める（まだ保存が無ければ 404）',
    method: 'GET',
    path: () => `/api/staff/stores/${fixture.storeId}/slot-rules`,
    expected: {
      none: 401,
      staff: 404,
      manager: 404,
      clerk: 404,
      expired: 401,
      'wrong-secret': 401,
    },
  },
  {
    name: '予約の間隔の保存は店長だけ',
    method: 'PUT',
    path: () => `/api/staff/stores/${fixture.storeId}/slot-rules`,
    body: async () => ({
      slotMinutes: 30,
      cleanupMinutes: 10,
      maxParallel: 3,
      version: await currentVersion(),
    }),
    expected: WRITE,
  },

  /* --- スタッフと技能 --- */
  {
    name: 'スタッフの一覧は誰でも読める',
    method: 'GET',
    path: () => `/api/staff/stores/${fixture.storeId}/staff`,
    expected: READ,
  },
  {
    name: 'スタッフの追加は店長だけ',
    method: 'POST',
    path: () => `/api/staff/stores/${fixture.storeId}/staff`,
    body: () => ({ displayName: '中村 彩' }),
    expected: WRITE,
  },
  {
    name: 'スタッフの更新は店長だけ',
    method: 'PATCH',
    path: () => `/api/staff/stores/${fixture.storeId}/staff/${fixture.staffId}`,
    body: async () => ({ jobLabel: '視力測定', version: await currentVersion() }),
    expected: WRITE,
  },
  {
    name: '技能の置き換えは店長だけ',
    method: 'PUT',
    path: () => `/api/staff/stores/${fixture.storeId}/staff/${fixture.staffId}/skills`,
    body: () => ({ skills: ['measure'] }),
    expected: WRITE,
  },
  {
    name: '勤務時間は誰でも読める',
    method: 'GET',
    path: () => `/api/staff/stores/${fixture.storeId}/staff-shifts?from=2026-08-27&to=2026-09-27`,
    expected: READ,
  },
  {
    name: '勤務時間の保存は店長だけ',
    method: 'PUT',
    path: () => `/api/staff/stores/${fixture.storeId}/staff-shifts`,
    body: async () => ({
      staffId: fixture.staffId,
      weekly: weeklyShifts(),
      effectiveFrom: '2026-08-27',
      version: await currentVersion(),
    }),
    expected: WRITE,
  },

  /* --- 設備と点検 --- */
  {
    name: '設備の一覧は誰でも読める',
    method: 'GET',
    path: () => `/api/staff/stores/${fixture.storeId}/equipment`,
    expected: READ,
  },
  {
    name: '設備の追加は店長だけ',
    method: 'POST',
    path: () => `/api/staff/stores/${fixture.storeId}/equipment`,
    body: () => ({ name: '相談カウンター 1', kind: 'counter', roleLabel: '接客・ご相談' }),
    expected: WRITE,
  },
  {
    name: '設備の更新は店長だけ',
    method: 'PATCH',
    path: () => `/api/staff/stores/${fixture.storeId}/equipment/${fixture.equipmentId}`,
    body: async () => ({ capacity: 1, version: await currentVersion() }),
    expected: WRITE,
  },
  {
    name: '点検の予定は誰でも読める',
    method: 'GET',
    path: () =>
      `/api/staff/stores/${fixture.storeId}/equipment/${fixture.equipmentId}/maintenance?from=2026-08-01&to=2026-08-31`,
    expected: READ,
  },
  {
    name: '点検の追加は店長だけ',
    method: 'POST',
    path: () => `/api/staff/stores/${fixture.storeId}/equipment/${fixture.equipmentId}/maintenance`,
    body: () => ({
      startsAt: '2026-09-01T01:00:00.000Z',
      endsAt: '2026-09-01T03:00:00.000Z',
    }),
    expected: WRITE,
  },
  {
    name: '点検の取り消しは店長だけ',
    method: 'DELETE',
    path: () =>
      `/api/staff/stores/${fixture.storeId}/equipment/${fixture.equipmentId}/maintenance/${fixture.maintenanceId}`,
    expected: WRITE,
  },

  /* --- ご来店の目的 --- */
  {
    name: 'ご来店の目的は誰でも読める',
    method: 'GET',
    path: () => '/api/staff/purposes',
    expected: READ,
  },
  {
    name: '目的の追加は店長だけ',
    method: 'POST',
    path: () => '/api/staff/purposes',
    body: () => ({
      nameInternal: '視力測定だけ',
      namePublic: '視力測定',
      nameShort: '視力',
      durationMinutes: 30,
    }),
    expected: WRITE,
  },
  {
    name: '目的の更新は店長だけ',
    method: 'PATCH',
    path: () => `/api/staff/purposes/${fixture.purposeId}`,
    body: async () => ({ durationMinutes: 60, version: await currentPurposeVersion() }),
    expected: WRITE,
  },
  {
    name: '必要な技能・設備の置き換えは店長だけ',
    method: 'PUT',
    path: () => `/api/staff/purposes/${fixture.purposeId}/requirements`,
    body: () => ({ requirements: [{ kind: 'skill', value: 'measure' }] }),
    expected: WRITE,
  },
  {
    name: '目的の並べ替えは店長だけ',
    method: 'PUT',
    path: () => '/api/staff/purposes/order',
    body: () => ({ purposeIds: [fixture.purposeId] }),
    expected: WRITE,
  },

  /* --- 保存の前に見せる影響（読み取り専用なので店長を要求しない） --- */
  {
    name: '影響の試算は読み取りなので店長を要求しない',
    method: 'POST',
    path: () => '/api/staff/settings/impact',
    body: () => ({
      storeId: fixture.storeId,
      kind: 'equipment_stop',
      draft: {
        equipmentId: fixture.equipmentId,
        startsAt: '2026-09-01T01:00:00.000Z',
        endsAt: '2026-09-01T03:00:00.000Z',
      },
    }),
    expected: READ,
  },
]

describe('権限マトリクス', () => {
  for (const row of TABLE) {
    for (const [actor, expected] of Object.entries(row.expected) as [ActorName, number][]) {
      it(`${row.name} — ${actor} は ${expected}`, async () => {
        const body = row.body === undefined ? undefined : await row.body()
        const res = await SELF.fetch(`${BASE}${row.path()}`, {
          method: row.method,
          headers: headersFor(actor),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        expect(res.status).toBe(expected)
      })
    }
  }
})

describe('設定の書き込みは membership だけで決まる', () => {
  it('担当店舗の membership がまったく無い利用者は、設定の保存が 403 になる', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/stores/${fixture.storeId}`, {
      method: 'PATCH',
      headers: headersFor('staff'),
      body: JSON.stringify({ name: '書き換えたい', version: await currentVersion() }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'forbidden' })
  })

  it('他店舗の membership で settings.manage を持っていても、この店舗の保存は 403 になる', async () => {
    const otherStore = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO stores (id, organization_id, name, slug, phone, address, access_note, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        otherStore,
        ORG,
        'EYEX 丸の内店',
        `marunouchi-${crypto.randomUUID().slice(0, 8)}`,
        '',
        '',
        '',
        '1',
        NOW,
      )
      .run()
    const sub = subOf(ORG, ':other-store-manager')
    await syncMembership(ORG, otherStore, sub, ['settings.read', 'settings.manage'])
    const token = await signAccessToken(
      { sub, org: ORG, email: 'other@example.test', role: 'staff' },
      JWT_SECRET,
    )

    const res = await SELF.fetch(`${BASE}/api/staff/stores/${fixture.storeId}`, {
      method: 'PATCH',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: '書き換えたい', version: await currentVersion() }),
    })
    expect(res.status).toBe(403)
    // 自分の店舗なら同じ本文が通る（権限そのものは持っている）。
    const allowed = await SELF.fetch(`${BASE}/api/staff/stores/${otherStore}`, {
      method: 'PATCH',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'EYEX 丸の内店', version: 1 }),
    })
    expect(allowed.status).toBe(200)
  })

  it('未知の設定パスは、未認証なら 401 で経路の有無を漏らさず、認証済みで初めて 404 になる', async () => {
    const anonymous = await SELF.fetch(`${BASE}/api/staff/settings/not-a-route`, {
      headers: headersFor('none'),
    })
    expect(anonymous.status).toBe(401)

    const authenticated = await SELF.fetch(`${BASE}/api/staff/settings/not-a-route`, {
      headers: headersFor('clerk'),
    })
    expect(authenticated.status).toBe(404)
  })
})

describe('内部 API の共有鍵', () => {
  it('正しい鍵なら通る', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/organizations`, {
      headers: INTERNAL_HEADERS,
    })
    expect(res.status).toBe(200)
  })

  it('鍵が違えば 401', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/organizations`, {
      headers: { ...JSON_HEADERS, 'x-internal-key': 'not-the-key' },
    })
    expect(res.status).toBe(401)
  })

  it('鍵が無ければ 401', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/organizations`, { headers: JSON_HEADERS })
    expect(res.status).toBe(401)
  })
})

describe('dev トークングラント', () => {
  it('組織 id が空なら 400', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/token`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ organizationId: '', role: 'staff' }),
    })
    expect(res.status).toBe(400)
  })
})
