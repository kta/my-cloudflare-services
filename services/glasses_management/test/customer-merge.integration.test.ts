import { env, SELF } from 'cloudflare:test'
import type {
  CustomerLinkReleaseResult,
  CustomerMergePreview,
  CustomerMergeResult,
} from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  auth,
  BASE,
  insertCustomer,
  insertReservation,
  insertWalkin,
  syncMembership,
  syncOrganization,
  syncStore,
  tokenFor,
  uuid,
} from './customer-detail.fixtures'

const NOW = '2026-08-31T00:00:00.000Z'

async function seed() {
  const organizationId = uuid()
  await syncOrganization(organizationId)
  const storeId = await syncStore({ organizationId, name: '新宿店' })
  const primaryId = await insertCustomer({
    organizationId,
    primaryStoreId: storeId,
    phone: '09011112222',
  })
  const duplicateId = await insertCustomer({
    organizationId,
    primaryStoreId: storeId,
    phone: '09033334444',
  })
  const userId = uuid()
  await syncMembership({
    organizationId,
    storeId,
    userId,
    permissions: [
      'store.read',
      'customer.read',
      'customer.write',
      'customer.history',
      'audit.read',
    ],
  })
  const token = await tokenFor(organizationId, 'staff', userId)
  const reservationId = await insertReservation({
    organizationId,
    storeId,
    customerId: duplicateId,
    startAt: '2026-08-20T01:00:00.000Z',
  })
  const walkinId = await insertWalkin({
    organizationId,
    storeId,
    customerId: duplicateId,
    arrivedAt: '2026-08-21T01:00:00.000Z',
  })
  return { organizationId, storeId, primaryId, duplicateId, token, userId, reservationId, walkinId }
}

describe('顧客の重複統合・誤関連解除 (UC-EYEX-181, AC-EYEX-121)', () => {
  it('compares the duplicate candidates and reports the affected history before anything happens', async () => {
    const { storeId, primaryId, duplicateId, token, organizationId } = await seed()
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/customer-merges/preview`,
      auth(token, {
        method: 'POST',
        body: JSON.stringify({ primaryCustomerId: primaryId, duplicateCustomerId: duplicateId }),
      }),
    )
    expect(response.status).toBe(200)
    const preview = (await response.json()) as CustomerMergePreview
    expect(preview.primary.customerId).toBe(primaryId)
    expect(preview.duplicate.customerId).toBe(duplicateId)
    expect(preview.impact).toEqual({
      reservations: 1,
      walkins: 1,
      prescriptions: 0,
      notes: 0,
      attentionNotes: 0,
      ownedGlasses: 0,
    })
    expect(preview.alreadyMerged).toBe(false)

    // A preview is never a merge.
    const rows = await env.DB.prepare(
      'SELECT count(*) as total FROM customers WHERE organization_id = ? AND merged_into_customer_id IS NOT NULL',
    )
      .bind(organizationId)
      .first<{ total: number }>()
    expect(rows?.total).toBe(0)
  })

  it('merges only with an acknowledged impact and audits actor, instant and before/after', async () => {
    const { storeId, primaryId, duplicateId, token, userId, organizationId } = await seed()
    const unacknowledged = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/customer-merges`,
      auth(token, {
        method: 'POST',
        body: JSON.stringify({
          primaryCustomerId: primaryId,
          duplicateCustomerId: duplicateId,
          reason: '同一人物と確認',
          acknowledgedImpactTotal: 0,
        }),
      }),
    )
    expect(unacknowledged.status).toBe(409)
    await expect(unacknowledged.json()).resolves.toMatchObject({
      error: 'merge_impact_unacknowledged',
    })

    const merged = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/customer-merges`,
      auth(token, {
        method: 'POST',
        body: JSON.stringify({
          primaryCustomerId: primaryId,
          duplicateCustomerId: duplicateId,
          reason: '同一人物と確認',
          acknowledgedImpactTotal: 2,
        }),
      }),
    )
    expect(merged.status).toBe(200)
    const result = (await merged.json()) as CustomerMergeResult
    expect(result).toMatchObject({
      primaryCustomerId: primaryId,
      mergedCustomerId: duplicateId,
      mergedAt: NOW,
    })

    const movedReservations = await env.DB.prepare(
      'SELECT count(*) as total FROM reservations WHERE customer_id = ?',
    )
      .bind(primaryId)
      .first<{ total: number }>()
    expect(movedReservations?.total).toBe(1)
    const losing = await env.DB.prepare(
      'SELECT merged_into_customer_id FROM customers WHERE id = ?',
    )
      .bind(duplicateId)
      .first<{ merged_into_customer_id: string | null }>()
    expect(losing?.merged_into_customer_id).toBe(primaryId)

    const audit = await env.DB.prepare(
      "SELECT actor_id, occurred_at, metadata FROM audit_events WHERE organization_id = ? AND action = 'customer.merged'",
    )
      .bind(organizationId)
      .first<{ actor_id: string; occurred_at: string; metadata: string }>()
    expect(audit?.actor_id).toBe(userId)
    expect(audit?.occurred_at).toBe(NOW)
    const metadata = JSON.parse(audit?.metadata ?? '{}') as {
      before: { duplicateCustomerId: string; mergedIntoCustomerId: string | null }
      after: { mergedIntoCustomerId: string }
      reason: string
    }
    expect(metadata.before.mergedIntoCustomerId).toBeNull()
    expect(metadata.after.mergedIntoCustomerId).toBe(primaryId)
    expect(metadata.reason).toBe('同一人物と確認')
  })

  it('releases a wrong association without deleting the entry, and audits it', async () => {
    const { storeId, token, reservationId, duplicateId, organizationId } = await seed()
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/customer-links/release`,
      auth(token, {
        method: 'POST',
        body: JSON.stringify({
          entryType: 'reservation',
          entryId: reservationId,
          reason: '別人の来店だった',
        }),
      }),
    )
    expect(response.status).toBe(200)
    const released = (await response.json()) as CustomerLinkReleaseResult
    expect(released).toEqual({
      entryType: 'reservation',
      entryId: reservationId,
      previousCustomerId: duplicateId,
      releasedAt: NOW,
    })

    const row = await env.DB.prepare('SELECT customer_id FROM reservations WHERE id = ?')
      .bind(reservationId)
      .first<{ customer_id: string | null }>()
    expect(row?.customer_id).toBeNull()

    const audit = await env.DB.prepare(
      "SELECT metadata FROM audit_events WHERE organization_id = ? AND action = 'customer.link_released'",
    )
      .bind(organizationId)
      .first<{ metadata: string }>()
    expect(JSON.parse(audit?.metadata ?? '{}')).toMatchObject({
      before: { customerId: duplicateId },
      after: { customerId: null },
      reason: '別人の来店だった',
    })
  })

  it('refuses an entry that is not linked and a candidate that no longer exists', async () => {
    const { storeId, token, primaryId, walkinId } = await seed()
    const released = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/customer-links/release`,
      auth(token, {
        method: 'POST',
        body: JSON.stringify({ entryType: 'walkin', entryId: walkinId, reason: '別人' }),
      }),
    )
    expect(released.status).toBe(200)
    const again = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/customer-links/release`,
      auth(token, {
        method: 'POST',
        body: JSON.stringify({ entryType: 'walkin', entryId: walkinId, reason: '別人' }),
      }),
    )
    expect(again.status).toBe(409)
    await expect(again.json()).resolves.toEqual({ error: 'link_already_released' })

    const missing = await SELF.fetch(
      `${BASE}/api/staff/stores/${storeId}/customer-merges/preview`,
      auth(token, {
        method: 'POST',
        body: JSON.stringify({ primaryCustomerId: primaryId, duplicateCustomerId: uuid() }),
      }),
    )
    expect(missing.status).toBe(404)
  })
})
