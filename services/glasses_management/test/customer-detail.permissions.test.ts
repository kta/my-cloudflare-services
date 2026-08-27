import { SELF } from 'cloudflare:test'
import type { CustomerDetail } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  auth,
  BASE,
  customerUrl,
  insertAttentionNote,
  insertCustomer,
  insertOwnedGlasses,
  insertPrescription,
  insertReservation,
  insertWalkin,
  syncMembership,
  syncOrganization,
  syncStore,
  tokenFor,
  uuid,
} from './customer-detail.fixtures'

type Seeded = {
  organizationId: string
  selectedStoreId: string
  otherStoreId: string
  customerId: string
  token: string
}

async function seed(permissions: readonly string[]): Promise<Seeded> {
  const organizationId = uuid()
  await syncOrganization(organizationId)
  const selectedStoreId = await syncStore({ organizationId, name: '新宿店' })
  const otherStoreId = await syncStore({ organizationId, name: '横浜店' })
  const customerId = await insertCustomer({ organizationId, primaryStoreId: selectedStoreId })
  const userId = uuid()
  await syncMembership({
    organizationId,
    storeId: selectedStoreId,
    userId,
    permissions: [...permissions],
  })
  const token = await tokenFor(organizationId, 'staff', userId)

  await insertPrescription({
    organizationId,
    storeId: selectedStoreId,
    customerId,
    measuredOn: '2026-08-20',
    recordedBy: '検査 太郎',
    rightSphere: -2.25,
    leftSphere: -2,
    pupillaryDistance: 63,
  })
  await insertPrescription({
    organizationId,
    storeId: otherStoreId,
    customerId,
    measuredOn: '2026-01-15',
    recordedBy: '横浜 花子',
    rightSphere: -2,
    leftSphere: -1.75,
    pupillaryDistance: 63,
  })
  await insertOwnedGlasses({
    organizationId,
    storeId: otherStoreId,
    customerId,
    label: 'EYEX Frame 02',
    purchasedOn: '2026-01-15',
    lensType: '遠近両用',
  })
  await insertReservation({
    organizationId,
    storeId: selectedStoreId,
    customerId,
    startAt: '2026-08-20T01:00:00.000Z',
  })
  await insertWalkin({
    organizationId,
    storeId: otherStoreId,
    customerId,
    arrivedAt: '2026-01-15T02:00:00.000Z',
  })
  await insertAttentionNote({
    organizationId,
    storeId: selectedStoreId,
    customerId,
    body: '装用テストを長めに取る。',
    basis: '2026-08-01 の検査結果',
    recordedBy: '店長 次郎',
    recordedOn: '2026-08-01',
  })
  return { organizationId, selectedStoreId, otherStoreId, customerId, token }
}

describe('customer record permission matrix', () => {
  it.each([
    ['no store membership at all', [], 403],
    ['store.read only', ['store.read'], 403],
    ['reservation.read only', ['reservation.read'], 403],
    ['customer.write without customer.read', ['customer.write'], 403],
    ['customer.read', ['customer.read'], 200],
    ['customer.read with customer.history', ['customer.read', 'customer.history'], 200],
    ['customer.read with attention.read', ['customer.read', 'attention.read'], 200],
  ] as const)('%s is answered with %i', async (_name, permissions, status) => {
    const seeded = await seed(permissions)
    const response = await SELF.fetch(
      customerUrl(seeded.selectedStoreId, seeded.customerId),
      auth(seeded.token),
    )
    expect(response.status).toBe(status)
    if (status === 403) await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('rejects an unauthenticated caller with 401 before any permission check', async () => {
    const seeded = await seed(['customer.read'])
    const anonymous = await SELF.fetch(customerUrl(seeded.selectedStoreId, seeded.customerId))
    expect(anonymous.status).toBe(401)
  })

  it('restricts history to the selected store without customer.history', async () => {
    const seeded = await seed(['customer.read', 'attention.read'])
    const response = await SELF.fetch(
      customerUrl(seeded.selectedStoreId, seeded.customerId),
      auth(seeded.token),
    )
    const body = (await response.json()) as CustomerDetail
    expect(body.currentPrescription?.storeId).toBe(seeded.selectedStoreId)
    expect(body.pastPrescriptions).toEqual([])
    expect(body.ownedGlasses).toEqual([])
    expect(body.visitHistory.map((row) => row.storeId)).toEqual([seeded.selectedStoreId])
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(seeded.otherStoreId)
    expect(serialized).not.toContain('横浜')
    expect(body.attentionNotes).toHaveLength(1)
  })

  it('includes cross-store history with customer.history', async () => {
    const seeded = await seed(['customer.read', 'customer.history'])
    const response = await SELF.fetch(
      customerUrl(seeded.selectedStoreId, seeded.customerId),
      auth(seeded.token),
    )
    const body = (await response.json()) as CustomerDetail
    expect(body.pastPrescriptions.map((row) => row.storeId)).toEqual([seeded.otherStoreId])
    expect(body.ownedGlasses.map((row) => row.storeId)).toEqual([seeded.otherStoreId])
    expect(body.visitHistory.map((row) => row.storeId)).toEqual([
      seeded.selectedStoreId,
      seeded.otherStoreId,
    ])
  })

  it('omits attention notes entirely, with no count or other trace, without attention.read', async () => {
    const seeded = await seed(['customer.read', 'customer.history'])
    const response = await SELF.fetch(
      customerUrl(seeded.selectedStoreId, seeded.customerId),
      auth(seeded.token),
    )
    const body = (await response.json()) as CustomerDetail
    expect(body.attentionNotes).toEqual([])
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('装用テスト')
    expect(serialized).not.toContain('2026-08-01 の検査結果')
    expect(Object.keys(body).sort()).toEqual([
      'attentionNotes',
      'currentPrescription',
      'customerId',
      'latestNote',
      'ownedGlasses',
      'pastPrescriptions',
      'visitHistory',
    ])
    // No response header may hint that a restricted section was withheld.
    for (const [name] of response.headers.entries()) {
      expect(name.toLowerCase()).not.toContain('attention')
      expect(name.toLowerCase()).not.toContain('restricted')
    }
  })

  it('hides a customer unrelated to the selected store unless customer.history is held', async () => {
    const organizationId = uuid()
    await syncOrganization(organizationId)
    const selectedStoreId = await syncStore({ organizationId, name: '新宿店' })
    const otherStoreId = await syncStore({ organizationId, name: '横浜店' })
    const customerId = await insertCustomer({ organizationId, primaryStoreId: otherStoreId })

    const localUser = uuid()
    await syncMembership({
      organizationId,
      storeId: selectedStoreId,
      userId: localUser,
      permissions: ['customer.read'],
    })
    const localToken = await tokenFor(organizationId, 'staff', localUser)
    const denied = await SELF.fetch(customerUrl(selectedStoreId, customerId), auth(localToken))
    expect(denied.status).toBe(403)
    await expect(denied.json()).resolves.toEqual({ error: 'forbidden' })

    const chainUser = uuid()
    await syncMembership({
      organizationId,
      storeId: selectedStoreId,
      userId: chainUser,
      permissions: ['customer.read', 'customer.history'],
    })
    const chainToken = await tokenFor(organizationId, 'staff', chainUser)
    const allowed = await SELF.fetch(customerUrl(selectedStoreId, customerId), auth(chainToken))
    expect(allowed.status).toBe(200)
  })

  it('gives a tenant admin the whole record for any store in the organization', async () => {
    const seeded = await seed(['store.read'])
    const adminToken = await tokenFor(seeded.organizationId, 'admin')
    const response = await SELF.fetch(
      customerUrl(seeded.selectedStoreId, seeded.customerId),
      auth(adminToken),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as CustomerDetail
    expect(body.attentionNotes).toHaveLength(1)
    expect(body.pastPrescriptions).toHaveLength(1)
  })

  it('keeps the customer record behind the store gate for an unknown store', async () => {
    const seeded = await seed(['customer.read'])
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${uuid()}/customers/${seeded.customerId}`,
      auth(seeded.token),
    )
    expect(response.status).toBe(403)
  })
})
