import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const INTERNAL = { 'content-type': 'application/json', 'x-internal-key': 'dev-internal-key' }
const CREATED_AT = '2026-08-27T00:00:00.000Z'
const uuid = () => crypto.randomUUID()

type StoreScope = { organizationId: string; storeId: string; userId: string; slug: string }

/**
 * Public discovery joins organization, store, availability settings and publication.
 * Seeding through the internal sync API (instead of raw SQL) keeps the fixture on the
 * same write path production uses, so a schema drift breaks the test loudly.
 */
async function syncStore(
  options: { name?: string; isActive?: boolean; isOrganizationDisabled?: boolean } = {},
): Promise<StoreScope> {
  const organizationId = uuid()
  const storeId = uuid()
  const userId = uuid()
  const organization = await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: organizationId,
      name: '公開組織',
      plan: 'free',
      isDisabled: options.isOrganizationDisabled ?? false,
      createdAt: CREATED_AT,
    }),
  })
  expect(organization.status).toBe(200)
  const store = await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: storeId,
      organizationId,
      name: options.name ?? '銀座 EYEX',
      slug: `store-${uuid().slice(0, 8)}`,
      isActive: options.isActive ?? true,
      createdAt: CREATED_AT,
    }),
  })
  expect(store.status).toBe(200)
  await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: uuid(),
      organizationId,
      storeId,
      userId,
      permissions: ['settings.manage'],
      createdAt: CREATED_AT,
    }),
  })
  return { organizationId, storeId, userId, slug: '' }
}

/** Publish a store under a public slug. The slug is the only key a visitor ever supplies. */
async function publish(
  scope: StoreScope,
  options: {
    status?: 'published' | 'hidden'
    startsAt?: string | null
    endsAt?: string | null
    contactPhone?: string
    accessText?: string
    notice?: string
    region?: string
    nearestStation?: string
    latitude?: number | null
    longitude?: number | null
    publicPurposeIds?: string[]
    publicPurposesJson?: string | null
    publicServicesJson?: string | null
  } = {},
): Promise<string> {
  const slug = `eyex-${uuid().slice(0, 8)}`
  await env.DB.prepare(
    `INSERT INTO web_booking_publications (id, organization_id, store_id, public_slug, status, starts_at, ends_at, contact_phone, access_text, notice, region, nearest_station, latitude, longitude, public_purpose_ids_json, public_purposes_json, public_services_json, version, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      uuid(),
      scope.organizationId,
      scope.storeId,
      slug,
      options.status ?? 'published',
      options.startsAt ?? null,
      options.endsAt ?? null,
      options.contactPhone ?? '03-0000-0000',
      options.accessText ?? '銀座駅 A1出口',
      options.notice ?? '処方箋をお持ちください',
      options.region ?? '東京都中央区',
      options.nearestStation ?? '銀座駅',
      options.latitude ?? null,
      options.longitude ?? null,
      JSON.stringify(options.publicPurposeIds ?? []),
      options.publicPurposesJson ?? null,
      options.publicServicesJson ?? null,
      1,
      CREATED_AT,
      CREATED_AT,
    )
    .run()
  scope.slug = slug
  return slug
}

/** Reception status lives in availability settings, which is LEFT JOINed and may be absent. */
async function setReceptionStatus(scope: StoreScope, receptionStatus: 'open' | 'paused') {
  await env.DB.prepare(
    `INSERT INTO availability_settings (id, organization_id, store_id, version, reception_status, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(uuid(), scope.organizationId, scope.storeId, 1, receptionStatus, 'staff', CREATED_AT)
    .run()
}

async function addVisitPurpose(
  scope: StoreScope,
  purpose: { id: string; label: string; durationMinutes: number },
) {
  await env.DB.prepare(
    `INSERT INTO visit_purposes (id, organization_id, store_id, staff_name, customer_label, duration_minutes, slot_interval_minutes, is_public, required_skills_json, required_equipment_json, max_concurrent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      purpose.id,
      scope.organizationId,
      scope.storeId,
      '視力測定',
      purpose.label,
      purpose.durationMinutes,
      30,
      '1',
      '[]',
      '[]',
      1,
    )
    .run()
}

async function addBusinessHours(scope: StoreScope, dayOfWeek: number, periodsJson: string) {
  await env.DB.prepare(
    `INSERT INTO availability_business_hours (id, organization_id, store_id, day_of_week, periods_json) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(uuid(), scope.organizationId, scope.storeId, dayOfWeek, periodsJson)
    .run()
}

/**
 * Persist a bookable configuration through the staff API so the slot engine sees a
 * consistent store (purpose, skilled staff on shift, equipment). 2026-08-31 is a Monday.
 */
async function saveBookableSettings(
  scope: StoreScope,
  options: { purposeId: string; receptionStatus?: 'open' | 'paused' },
) {
  const token = await signAccessToken(
    { sub: scope.userId, org: scope.organizationId, email: 'staff@example.test', role: 'staff' },
    'dev-jwt-secret-change-me',
  )
  const staffId = uuid()
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${scope.storeId}/availability/settings`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        version: 0,
        receptionStatus: options.receptionStatus ?? 'open',
        businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '11:00' }] }],
        exceptions: [],
        purposes: [
          {
            id: options.purposeId,
            staffName: '視力測定',
            customerLabel: '新調相談',
            durationMinutes: 60,
            slotIntervalMinutes: 30,
            isPublic: true,
            requiredSkills: ['skill'],
            requiredEquipment: ['machine'],
            maxConcurrent: 1,
          },
        ],
        staff: [{ id: staffId, name: '担当', skills: ['skill'], canBook: true, isActive: true }],
        shifts: [
          {
            id: uuid(),
            staffId,
            date: '2026-08-31',
            startTime: '10:00',
            endTime: '11:00',
            breaks: [],
          },
        ],
        equipment: [
          {
            id: uuid(),
            name: 'machine',
            capacity: 1,
            isActive: true,
            availablePeriods: [{ startTime: '10:00', endTime: '11:00' }],
          },
        ],
        maintenance: [],
      }),
    },
  )
  expect(response.status).toBe(201)
}

describe('public store search', () => {
  it('lists only bookable stores by name when the visitor shares no location', async () => {
    // A visitor without geolocation must still get a stable, predictable order, and
    // must never see a store that staff have taken off the public surface.
    const cherry = await syncStore({ name: 'Cherry 店' })
    const apple = await syncStore({ name: 'Apple 店' })
    const paused = await syncStore({ name: 'Paused 店' })
    const hidden = await syncStore({ name: 'Hidden 店' })
    const inactive = await syncStore({ name: 'Inactive 店', isActive: false })
    const disabled = await syncStore({ name: 'Disabled 店', isOrganizationDisabled: true })
    await publish(cherry)
    await publish(apple)
    await publish(paused)
    await setReceptionStatus(paused, 'paused')
    await publish(hidden, { status: 'hidden' })
    await publish(inactive)
    await publish(disabled)

    const response = await SELF.fetch(`${BASE}/api/public/stores`)

    expect(response.status).toBe(200)
    const all = (await response.json()) as { name: string; slug: string }[]
    const seeded = new Set(
      [cherry, apple, paused, hidden, inactive, disabled].map((store) => store.slug),
    )
    const listed = all.filter((store) => seeded.has(store.slug))
    expect(listed.map((store) => store.name)).toEqual(['Apple 店', 'Cherry 店'])
    expect(listed[0]).toEqual({
      slug: apple.slug,
      name: 'Apple 店',
      contactPhone: '03-0000-0000',
      region: '東京都中央区',
      nearestStation: '銀座駅',
      accessText: '銀座駅 A1出口',
      // 営業時間を登録していない店舗は「本日営業」の行そのものを出さない。
      todayBusinessHours: null,
    })
  })

  it('narrows the list by free text, region and nearest station independently', async () => {
    // Each filter is applied separately in the query builder; a visitor combining them
    // must not widen the result set, and free text must also match the access text.
    // Every fixture carries a token unique to this test so the assertions describe the
    // filter, not whatever else happens to be published in the database.
    const token = uuid().slice(0, 8)
    const ginza = await syncStore({ name: `銀座 ${token}` })
    const osaka = await syncStore({ name: `梅田 ${token}` })
    await publish(ginza, {
      accessText: `A1出口 ${token}`,
      region: `東京都-${token}`,
      nearestStation: `銀座駅-${token}`,
    })
    await publish(osaka, {
      accessText: `南口 ${token}`,
      region: `大阪府-${token}`,
      nearestStation: `梅田駅-${token}`,
    })

    const byName = await SELF.fetch(
      `${BASE}/api/public/stores?q=${encodeURIComponent(`銀座 ${token}`)}`,
    )
    const byAccessText = await SELF.fetch(
      `${BASE}/api/public/stores?q=${encodeURIComponent(`南口 ${token}`)}`,
    )
    const byRegion = await SELF.fetch(
      `${BASE}/api/public/stores?region=${encodeURIComponent(`大阪府-${token}`)}`,
    )
    const byStation = await SELF.fetch(
      `${BASE}/api/public/stores?station=${encodeURIComponent(`銀座駅-${token}`)}`,
    )
    const contradictory = await SELF.fetch(
      `${BASE}/api/public/stores?region=${encodeURIComponent(`大阪府-${token}`)}&station=${encodeURIComponent(`銀座駅-${token}`)}`,
    )

    await expect(byName.json()).resolves.toMatchObject([{ slug: ginza.slug }])
    await expect(byAccessText.json()).resolves.toMatchObject([{ slug: osaka.slug }])
    await expect(byRegion.json()).resolves.toMatchObject([{ slug: osaka.slug }])
    await expect(byStation.json()).resolves.toMatchObject([{ slug: ginza.slug }])
    await expect(contradictory.json()).resolves.toEqual([])
  })

  it('orders stores by distance and pushes stores without coordinates to the end', async () => {
    // Coordinates are optional per publication. A store that never registered them must
    // still be reachable — it just cannot claim to be nearby — so it sorts last instead
    // of corrupting the comparison with NaN.
    const near = await syncStore({ name: 'ZZ Near 店' })
    const far = await syncStore({ name: 'AA Far 店' })
    const unknown = await syncStore({ name: 'MM Unknown 店' })
    await publish(near, { latitude: 35.6718, longitude: 139.7651 })
    await publish(far, { latitude: 35.7, longitude: 139.9 })
    await publish(unknown, { latitude: null, longitude: null })

    const located = await SELF.fetch(`${BASE}/api/public/stores?latitude=35.6717&longitude=139.765`)
    const unlocated = await SELF.fetch(`${BASE}/api/public/stores`)

    expect(located.status).toBe(200)
    const seeded = new Set([near.slug, far.slug, unknown.slug])
    const keep = (rows: { slug: string }[]) =>
      rows.filter((store) => seeded.has(store.slug)).map((store) => store.slug)
    const byDistance = (await located.json()) as { slug: string }[]
    expect(keep(byDistance)).toEqual([near.slug, far.slug, unknown.slug])
    // Without a location the order falls back to store name, proving the geo sort is
    // applied only when the visitor actually shared coordinates.
    const byName = (await unlocated.json()) as { slug: string }[]
    expect(keep(byName)).toEqual([far.slug, unknown.slug, near.slug])
  })

  it('carries the access text and the opening hours for today on the search card', async () => {
    // 承認済みモックの検索カードは「銀座駅 A3出口 徒歩2分」と「本日営業 10:00–19:00」を
    // 詳細を開かずに見せる。TEST_CLOCK_NOW は 2026-08-31（JST 月曜 = dayOfWeek 1）。
    const scope = await syncStore({ name: `カード ${uuid().slice(0, 8)}` })
    await addBusinessHours(scope, 1, '[{"startTime":"10:00","endTime":"19:00"}]')
    await addBusinessHours(scope, 2, '[{"startTime":"11:00","endTime":"20:00"}]')
    const slug = await publish(scope, { accessText: '銀座駅 A3出口 徒歩2分' })

    const response = await SELF.fetch(`${BASE}/api/public/stores`)

    expect(response.status).toBe(200)
    const listed = ((await response.json()) as { slug: string }[]).find(
      (store) => store.slug === slug,
    )
    expect(listed).toMatchObject({
      accessText: '銀座駅 A3出口 徒歩2分',
      todayBusinessHours: '10:00–19:00',
    })
  })

  it('rejects a half-supplied location instead of guessing the missing coordinate', async () => {
    // Sorting by an implied coordinate would silently mis-rank stores, so the contract
    // requires latitude and longitude together.
    const response = await SELF.fetch(`${BASE}/api/public/stores?latitude=35.6717`)

    expect(response.status).toBe(400)
  })
})

describe('public store detail', () => {
  it('returns 404 for an unknown public slug without leaking whether a store exists', async () => {
    const response = await SELF.fetch(`${BASE}/api/public/stores/no-such-public-store`)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'public_store_not_found' })
  })

  it('serves a store whose reception is explicitly open with live public purposes', async () => {
    // With no purpose snapshot, the detail must be derived from the current visit purposes
    // and restricted to the ids the company actually published.
    const scope = await syncStore()
    const publishedPurposeId = uuid()
    const internalPurposeId = uuid()
    await addVisitPurpose(scope, {
      id: publishedPurposeId,
      label: '新しいメガネを作る',
      durationMinutes: 60,
    })
    await addVisitPurpose(scope, { id: internalPurposeId, label: '内部専用', durationMinutes: 30 })
    await addBusinessHours(scope, 1, '[{"startTime":"10:00","endTime":"19:00"}]')
    const slug = await publish(scope, {
      publicPurposeIds: [publishedPurposeId],
      publicPurposesJson: null,
    })
    await setReceptionStatus(scope, 'open')

    const response = await SELF.fetch(`${BASE}/api/public/stores/${slug}`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      slug,
      name: '銀座 EYEX',
      contactPhone: '03-0000-0000',
      accessText: '銀座駅 A1出口',
      notice: '処方箋をお持ちください',
      region: '東京都中央区',
      nearestStation: '銀座駅',
      businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
      purposes: [{ id: publishedPurposeId, label: '新しいメガネを作る', durationMinutes: 60 }],
      services: [],
    })
  })

  it('prefers the published purpose snapshot over later internal edits', async () => {
    // Customers must keep seeing what was published; renaming a purpose internally may
    // not silently change the public page until it is republished.
    const scope = await syncStore()
    const purposeId = uuid()
    await addVisitPurpose(scope, { id: purposeId, label: '変更後の内部表示', durationMinutes: 30 })
    const slug = await publish(scope, {
      publicPurposeIds: [purposeId],
      publicPurposesJson: JSON.stringify([
        { id: purposeId, label: '公開時の表示', durationMinutes: 60 },
      ]),
    })

    const response = await SELF.fetch(`${BASE}/api/public/stores/${slug}`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      businessHours: [],
      purposes: [{ id: purposeId, label: '公開時の表示', durationMinutes: 60 }],
    })
  })

  it('serves 対応サービス separately from the bookable visit purposes', async () => {
    // 対応サービスは説明文で、来店目的は予約できる枠である。同じ列で兼用すると、
    // 公開していない目的まで説明に出るか、説明が予約導線に化ける。
    const scope = await syncStore()
    const purposeId = uuid()
    await addVisitPurpose(scope, {
      id: purposeId,
      label: 'メガネを新しく作りたい',
      durationMinutes: 60,
    })
    const slug = await publish(scope, {
      publicPurposeIds: [purposeId],
      publicServicesJson: JSON.stringify([
        'メガネ新調',
        '視力測定',
        'フィッティング調整',
        '修理受付',
      ]),
    })

    const response = await SELF.fetch(`${BASE}/api/public/stores/${slug}`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      services: ['メガネ新調', '視力測定', 'フィッティング調整', '修理受付'],
      purposes: [{ id: purposeId, label: 'メガネを新しく作りたい', durationMinutes: 60 }],
    })
  })

  it('answers a paused reception with the reason and a phone number to call', async () => {
    // A paused store is still a real store: the visitor deserves a way to reach it
    // rather than a dead end.
    const scope = await syncStore()
    const slug = await publish(scope, { contactPhone: '03-5555-5555' })
    await setReceptionStatus(scope, 'paused')

    const response = await SELF.fetch(`${BASE}/api/public/stores/${slug}`)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'public_store_unavailable',
      reason: 'reception_paused',
      contactPhone: '03-5555-5555',
    })
  })

  it('answers a hidden publication with not_published rather than serving its content', async () => {
    const scope = await syncStore()
    const slug = await publish(scope, { status: 'hidden', contactPhone: '03-6666-6666' })

    const response = await SELF.fetch(`${BASE}/api/public/stores/${slug}`)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'public_store_unavailable',
      reason: 'not_published',
      contactPhone: '03-6666-6666',
    })
  })

  it('resolves the tenant from the slug alone so one slug never returns another tenant', async () => {
    // Public endpoints take no organization or store id from input; the slug is the only
    // scope key, which is what keeps tenants isolated on an unauthenticated surface.
    const first = await syncStore({ name: '第一店舗' })
    const second = await syncStore({ name: '第二店舗' })
    const firstSlug = await publish(first, { contactPhone: '03-1111-1111' })
    const secondSlug = await publish(second, { contactPhone: '03-2222-2222' })

    const firstResponse = await SELF.fetch(
      `${BASE}/api/public/stores/${firstSlug}?organizationId=${second.organizationId}&storeId=${second.storeId}`,
    )
    const secondResponse = await SELF.fetch(`${BASE}/api/public/stores/${secondSlug}`)

    await expect(firstResponse.json()).resolves.toMatchObject({
      name: '第一店舗',
      contactPhone: '03-1111-1111',
    })
    await expect(secondResponse.json()).resolves.toMatchObject({
      name: '第二店舗',
      contactPhone: '03-2222-2222',
    })
  })
})

describe('public availability by slug', () => {
  it('returns 404 slots for an unknown public slug', async () => {
    const response = await SELF.fetch(
      `${BASE}/api/public/stores/no-such-public-store/slots?date=2026-08-31&purposeIds=${uuid()}`,
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'public_store_not_found' })
  })

  it('returns bookable slots when the resolved store has reception open', async () => {
    const scope = await syncStore()
    const purposeId = uuid()
    await saveBookableSettings(scope, { purposeId })
    const slug = await publish(scope, { publicPurposeIds: [purposeId] })

    const response = await SELF.fetch(
      `${BASE}/api/public/stores/${slug}/slots?date=2026-08-31&purposeIds=${purposeId}`,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      date: '2026-08-31',
      timezone: 'Asia/Tokyo',
      durationMinutes: 60,
      intervalMinutes: 30,
      slots: [
        {
          date: '2026-08-31',
          startTime: '10:00',
          endTime: '11:00',
          startAt: '2026-08-31T01:00:00.000Z',
          endAt: '2026-08-31T02:00:00.000Z',
        },
      ],
    })
  })

  it('refuses to compute slots for a paused store and hands back its phone number', async () => {
    const scope = await syncStore()
    const purposeId = uuid()
    await saveBookableSettings(scope, { purposeId, receptionStatus: 'paused' })
    const slug = await publish(scope, {
      publicPurposeIds: [purposeId],
      contactPhone: '03-7777-7777',
    })

    const response = await SELF.fetch(
      `${BASE}/api/public/stores/${slug}/slots?date=2026-08-31&purposeIds=${purposeId}`,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'public_store_unavailable',
      reason: 'reception_paused',
      contactPhone: '03-7777-7777',
    })
  })

  it('refuses to compute slots for a hidden publication', async () => {
    const scope = await syncStore()
    const purposeId = uuid()
    await saveBookableSettings(scope, { purposeId })
    const slug = await publish(scope, {
      status: 'hidden',
      publicPurposeIds: [purposeId],
      contactPhone: '03-8888-8888',
    })

    const response = await SELF.fetch(
      `${BASE}/api/public/stores/${slug}/slots?date=2026-08-31&purposeIds=${purposeId}`,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'public_store_unavailable',
      reason: 'not_published',
      contactPhone: '03-8888-8888',
    })
  })

  it('rejects a purpose the store never published, even if it exists internally', async () => {
    // Guessing an internal purpose id must not open a booking path that staff kept private.
    const scope = await syncStore()
    const publishedPurposeId = uuid()
    const internalPurposeId = uuid()
    await saveBookableSettings(scope, { purposeId: publishedPurposeId })
    await publish(scope, { publicPurposeIds: [publishedPurposeId] })

    const response = await SELF.fetch(
      `${BASE}/api/public/stores/${scope.slug}/slots?date=2026-08-31&purposeIds=${internalPurposeId}`,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_public_purpose_selection' })
  })

  it('reports an invalid selection instead of failing when a published purpose was deleted', async () => {
    // The publication snapshot can outlive the purpose it points at. That stale state must
    // surface as a 400 the customer UI can recover from, not a 500.
    const scope = await syncStore()
    const purposeId = uuid()
    const deletedPurposeId = uuid()
    await saveBookableSettings(scope, { purposeId })
    const slug = await publish(scope, { publicPurposeIds: [purposeId, deletedPurposeId] })

    const response = await SELF.fetch(
      `${BASE}/api/public/stores/${slug}/slots?date=2026-08-31&purposeIds=${deletedPurposeId}`,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_public_purpose_selection' })
  })
})

describe('public offers by slug', () => {
  it('offers a shortlist without asking the customer for a date first', async () => {
    // 承認済みモックの第 2 工程は日付入力を持たない。日付は入力ではなく結果である。
    const scope = await syncStore()
    const purposeId = uuid()
    await saveBookableSettings(scope, { purposeId })
    const slug = await publish(scope, { publicPurposeIds: [purposeId] })

    const response = await SELF.fetch(
      `${BASE}/api/public/stores/${slug}/offers?purposeIds=${purposeId}`,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      timezone: 'Asia/Tokyo',
      durationMinutes: 60,
      slots: [
        {
          date: '2026-08-31',
          startTime: '10:00',
          endTime: '11:00',
          startAt: '2026-08-31T01:00:00.000Z',
          endAt: '2026-08-31T02:00:00.000Z',
        },
      ],
    })
  })

  it('caps the shortlist at the requested number of candidates', async () => {
    const scope = await syncStore()
    const purposeId = uuid()
    await saveBookableSettings(scope, { purposeId })
    const slug = await publish(scope, { publicPurposeIds: [purposeId] })

    const response = await SELF.fetch(
      `${BASE}/api/public/stores/${slug}/offers?purposeIds=${purposeId}&limit=1`,
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { slots: unknown[] }
    expect(body.slots).toHaveLength(1)
  })

  it('refuses a purpose the store never published', async () => {
    const scope = await syncStore()
    const purposeId = uuid()
    await saveBookableSettings(scope, { purposeId })
    await publish(scope, { publicPurposeIds: [purposeId] })

    const response = await SELF.fetch(
      `${BASE}/api/public/stores/${scope.slug}/offers?purposeIds=${uuid()}`,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_public_purpose_selection' })
  })

  it('refuses to offer candidates for a paused store and hands back its phone number', async () => {
    const scope = await syncStore()
    const purposeId = uuid()
    await saveBookableSettings(scope, { purposeId, receptionStatus: 'paused' })
    const slug = await publish(scope, {
      publicPurposeIds: [purposeId],
      contactPhone: '03-7777-7777',
    })

    const response = await SELF.fetch(
      `${BASE}/api/public/stores/${slug}/offers?purposeIds=${purposeId}`,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'public_store_unavailable',
      reason: 'reception_paused',
      contactPhone: '03-7777-7777',
    })
  })

  it('returns 404 for an unknown public slug', async () => {
    const response = await SELF.fetch(
      `${BASE}/api/public/stores/no-such-public-store/offers?purposeIds=${uuid()}`,
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'public_store_not_found' })
  })
})
