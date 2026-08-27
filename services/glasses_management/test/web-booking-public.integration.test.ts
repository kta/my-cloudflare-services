import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const INTERNAL = { 'content-type': 'application/json', 'x-internal-key': 'dev-internal-key' }

const uuid = () => crypto.randomUUID()

async function syncStore(overrides: { isActive?: boolean; slug?: string } = {}) {
  const organizationId = uuid()
  const storeId = uuid()
  const slug = overrides.slug ?? `public-${uuid().slice(0, 8)}`
  const organization = await SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: organizationId,
      name: '公開組織',
      plan: 'free',
      isDisabled: false,
      createdAt: '2026-08-26T00:00:00.000Z',
    }),
  })
  expect(organization.status).toBe(200)
  const store = await SELF.fetch(`${BASE}/api/internal/stores/sync`, {
    method: 'POST',
    headers: INTERNAL,
    body: JSON.stringify({
      id: storeId,
      organizationId,
      name: '銀座 EYEX',
      slug,
      isActive: overrides.isActive ?? true,
      createdAt: '2026-08-26T00:00:00.000Z',
    }),
  })
  expect(store.status).toBe(200)
  return { organizationId, storeId, slug }
}

describe('public web-booking store portal', () => {
  it('returns only a published active store and its public purposes', async () => {
    const published = await syncStore({ slug: `ginza-${uuid().slice(0, 8)}` })
    const hidden = await syncStore({ slug: `hidden-${uuid().slice(0, 8)}` })
    const publicPurposeId = uuid()
    const privatePurposeId = uuid()
    const now = '2026-08-27T00:00:00.000Z'

    await env.DB.batch([
      env.DB.prepare(`INSERT INTO web_booking_publications
        (id, organization_id, store_id, public_slug, status, starts_at, ends_at, contact_phone, access_text, notice, region, nearest_station, latitude, longitude, public_purpose_ids_json, version, published_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        uuid(),
        published.organizationId,
        published.storeId,
        `eyex-ginza-${uuid().slice(0, 8)}`,
        'published',
        null,
        null,
        '03-0000-0000',
        '銀座駅 A1出口',
        'ご来店時は処方箋をお持ちください',
        '東京都中央区',
        '銀座駅',
        35.6717,
        139.765,
        JSON.stringify([publicPurposeId]),
        1,
        now,
        now,
      ),
      env.DB.prepare(`INSERT INTO visit_purposes
        (id, organization_id, store_id, staff_name, customer_label, duration_minutes, slot_interval_minutes, is_public, required_skills_json, required_equipment_json, max_concurrent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        publicPurposeId,
        published.organizationId,
        published.storeId,
        '視力測定',
        '新しいメガネを作る',
        60,
        30,
        '1',
        '[]',
        '[]',
        1,
      ),
      env.DB.prepare(`INSERT INTO visit_purposes
        (id, organization_id, store_id, staff_name, customer_label, duration_minutes, slot_interval_minutes, is_public, required_skills_json, required_equipment_json, max_concurrent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        privatePurposeId,
        published.organizationId,
        published.storeId,
        '社内検査',
        '内部専用',
        30,
        30,
        '0',
        '["internal"]',
        '["hidden-device"]',
        1,
      ),
      env.DB.prepare(`INSERT INTO web_booking_publications
        (id, organization_id, store_id, public_slug, status, starts_at, ends_at, contact_phone, access_text, notice, region, nearest_station, latitude, longitude, public_purpose_ids_json, version, published_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        uuid(),
        hidden.organizationId,
        hidden.storeId,
        `eyex-hidden-${uuid().slice(0, 8)}`,
        'hidden',
        null,
        null,
        '03-1111-1111',
        '非公開',
        '非公開',
        '東京都',
        '非公開駅',
        null,
        null,
        '[]',
        1,
        now,
        now,
      ),
    ])

    const list = await SELF.fetch(`${BASE}/api/public/stores?q=銀座`)
    expect(list.status).toBe(200)
    await expect(list.json()).resolves.toEqual([
      {
        slug: expect.stringMatching(/^eyex-ginza-/),
        name: '銀座 EYEX',
        contactPhone: '03-0000-0000',
        region: '東京都中央区',
        nearestStation: '銀座駅',
      },
    ])

    const listed = await SELF.fetch(`${BASE}/api/public/stores?region=東京都中央区&station=銀座駅`)
    await expect(listed.json()).resolves.toHaveLength(1)

    const publicSlug = `eyex-ginza-${uuid().slice(0, 8)}`
    await env.DB.prepare(
      'UPDATE web_booking_publications SET public_slug = ? WHERE organization_id = ? AND store_id = ?',
    )
      .bind(publicSlug, published.organizationId, published.storeId)
      .run()
    await env.DB.prepare(
      'UPDATE web_booking_publications SET public_purposes_json = ? WHERE organization_id = ? AND store_id = ?',
    )
      .bind(
        JSON.stringify([{ id: publicPurposeId, label: '新しいメガネを作る', durationMinutes: 60 }]),
        published.organizationId,
        published.storeId,
      )
      .run()
    await env.DB.prepare(
      'UPDATE visit_purposes SET customer_label = ?, duration_minutes = ? WHERE id = ?',
    )
      .bind('変更後の内部表示', 30, publicPurposeId)
      .run()
    await env.DB.prepare(
      `INSERT INTO availability_business_hours (id, organization_id, store_id, day_of_week, periods_json) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        uuid(),
        published.organizationId,
        published.storeId,
        1,
        '[{"startTime":"10:00","endTime":"19:00"}]',
      )
      .run()

    const detail = await SELF.fetch(`${BASE}/api/public/stores/${publicSlug}`)
    expect(detail.status).toBe(200)
    await expect(detail.json()).resolves.toEqual({
      slug: publicSlug,
      name: '銀座 EYEX',
      contactPhone: '03-0000-0000',
      accessText: '銀座駅 A1出口',
      notice: 'ご来店時は処方箋をお持ちください',
      region: '東京都中央区',
      nearestStation: '銀座駅',
      businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
      purposes: [{ id: publicPurposeId, label: '新しいメガネを作る', durationMinutes: 60 }],
    })
  })

  it('returns a reason and contact only for a known unavailable public URL', async () => {
    const inactive = await syncStore({ isActive: false })
    const now = '2026-08-27T00:00:00.000Z'
    const publicSlug = `inactive-${uuid().slice(0, 8)}`
    await env.DB.prepare(`INSERT INTO web_booking_publications
      (id, organization_id, store_id, public_slug, status, starts_at, ends_at, contact_phone, access_text, notice, region, nearest_station, latitude, longitude, public_purpose_ids_json, version, published_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        uuid(),
        inactive.organizationId,
        inactive.storeId,
        publicSlug,
        'published',
        null,
        null,
        '03-2222-2222',
        '駅前',
        '停止中',
        '東京都',
        '有楽町駅',
        null,
        null,
        '[]',
        1,
        now,
        now,
      )
      .run()
    const response = await SELF.fetch(`${BASE}/api/public/stores/${publicSlug}`)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'public_store_unavailable',
      reason: 'store_inactive',
      contactPhone: '03-2222-2222',
    })

    const unknown = await SELF.fetch(`${BASE}/api/public/stores/no-such-public-store`)
    expect(unknown.status).toBe(404)
    await expect(unknown.json()).resolves.toEqual({ error: 'public_store_not_found' })
  })

  it('does not expose a paused or disabled organization through its known public URL', async () => {
    const paused = await syncStore()
    const disabled = await syncStore()
    const now = '2026-08-27T00:00:00.000Z'
    const pausedSlug = `paused-${uuid().slice(0, 8)}`
    const disabledSlug = `disabled-${uuid().slice(0, 8)}`
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO web_booking_publications (id, organization_id, store_id, public_slug, status, starts_at, ends_at, contact_phone, access_text, notice, region, nearest_station, latitude, longitude, public_purpose_ids_json, version, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        uuid(),
        paused.organizationId,
        paused.storeId,
        pausedSlug,
        'published',
        null,
        null,
        '03-3333-3333',
        '駅前',
        '',
        '東京都',
        '東京駅',
        null,
        null,
        '[]',
        1,
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO availability_settings (id, organization_id, store_id, version, reception_status, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(uuid(), paused.organizationId, paused.storeId, 1, 'paused', 'staff', now),
      env.DB.prepare(
        `INSERT INTO web_booking_publications (id, organization_id, store_id, public_slug, status, starts_at, ends_at, contact_phone, access_text, notice, region, nearest_station, latitude, longitude, public_purpose_ids_json, version, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        uuid(),
        disabled.organizationId,
        disabled.storeId,
        disabledSlug,
        'published',
        null,
        null,
        '03-4444-4444',
        '駅前',
        '',
        '東京都',
        '品川駅',
        null,
        null,
        '[]',
        1,
        now,
        now,
      ),
      env.DB.prepare('UPDATE organizations SET is_disabled = ? WHERE id = ?').bind(
        '1',
        disabled.organizationId,
      ),
    ])

    const pausedResponse = await SELF.fetch(`${BASE}/api/public/stores/${pausedSlug}`)
    await expect(pausedResponse.json()).resolves.toEqual({
      error: 'public_store_unavailable',
      reason: 'reception_paused',
      contactPhone: '03-3333-3333',
    })
    const disabledResponse = await SELF.fetch(`${BASE}/api/public/stores/${disabledSlug}`)
    await expect(disabledResponse.json()).resolves.toEqual({
      error: 'public_store_unavailable',
      reason: 'organization_disabled',
      contactPhone: '03-4444-4444',
    })
  })
})
