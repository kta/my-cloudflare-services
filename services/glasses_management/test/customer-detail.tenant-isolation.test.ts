import { SELF } from 'cloudflare:test'
import type { CustomerDetail } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  auth,
  customerUrl,
  insertAttentionNote,
  insertCustomer,
  insertNote,
  insertPrescription,
  syncMembership,
  syncOrganization,
  syncStore,
  tokenFor,
  uuid,
} from './customer-detail.fixtures'

async function seedTenant(label: string) {
  const organizationId = uuid()
  await syncOrganization(organizationId)
  const storeId = await syncStore({ organizationId, name: `${label}店` })
  const customerId = await insertCustomer({ organizationId, primaryStoreId: storeId })
  const userId = uuid()
  await syncMembership({
    organizationId,
    storeId,
    userId,
    permissions: ['customer.read', 'customer.history', 'attention.read'],
  })
  const token = await tokenFor(organizationId, 'staff', userId)
  await insertPrescription({
    organizationId,
    storeId,
    customerId,
    measuredOn: '2026-08-20',
    recordedBy: `${label} 検査`,
    rightSphere: -2.25,
    leftSphere: -2,
    pupillaryDistance: 63,
  })
  await insertNote({
    organizationId,
    storeId,
    customerId,
    recordedOn: '2026-08-20',
    recordedBy: `${label} 接客`,
    body: `${label} のメモ`,
  })
  await insertAttentionNote({
    organizationId,
    storeId,
    customerId,
    body: `${label} の注意事項`,
    basis: `${label} の根拠`,
    recordedBy: `${label} 店長`,
    recordedOn: '2026-08-01',
  })
  return { organizationId, storeId, customerId, token, label }
}

describe('customer record tenant isolation', () => {
  it('never lets one tenant read another tenant customer record, even with the correct ids', async () => {
    const tenants = [await seedTenant('A'), await seedTenant('B'), await seedTenant('C')]

    for (const tenant of tenants) {
      const own = await SELF.fetch(
        customerUrl(tenant.storeId, tenant.customerId),
        auth(tenant.token),
      )
      expect(own.status).toBe(200)
      const body = (await own.json()) as CustomerDetail
      expect(body.customerId).toBe(tenant.customerId)
      expect(body.latestNote?.body).toBe(`${tenant.label} のメモ`)
      expect(body.attentionNotes[0]?.body).toBe(`${tenant.label} の注意事項`)
      const serialized = JSON.stringify(body)
      for (const other of tenants.filter((entry) => entry.label !== tenant.label)) {
        expect(serialized).not.toContain(other.customerId)
        expect(serialized).not.toContain(other.storeId)
        expect(serialized).not.toContain(`${other.label} のメモ`)
        expect(serialized).not.toContain(`${other.label} の注意事項`)
      }
    }

    const [a, b] = tenants as [
      Awaited<ReturnType<typeof seedTenant>>,
      Awaited<ReturnType<typeof seedTenant>>,
    ]
    // Another tenant's store id, and another tenant's customer id inside the
    // caller's own store, both fail closed with the same opaque response.
    const foreignStore = await SELF.fetch(customerUrl(b.storeId, b.customerId), auth(a.token))
    expect(foreignStore.status).toBe(403)
    await expect(foreignStore.json()).resolves.toEqual({ error: 'forbidden' })

    const foreignCustomer = await SELF.fetch(customerUrl(a.storeId, b.customerId), auth(a.token))
    expect(foreignCustomer.status).toBe(403)
    await expect(foreignCustomer.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('ignores rows another tenant wrote for the same customer identifier', async () => {
    const tenant = await seedTenant('D')
    const intruderOrganization = uuid()
    await syncOrganization(intruderOrganization)
    const intruderStore = await syncStore({ organizationId: intruderOrganization, name: '侵入店' })
    await insertNote({
      organizationId: intruderOrganization,
      storeId: intruderStore,
      customerId: tenant.customerId,
      recordedOn: '2026-08-30',
      recordedBy: '侵入 太郎',
      body: '越境メモ',
    })
    await insertAttentionNote({
      organizationId: intruderOrganization,
      storeId: intruderStore,
      customerId: tenant.customerId,
      body: '越境注意事項',
      basis: '越境根拠',
      recordedBy: '侵入 太郎',
      recordedOn: '2026-08-30',
    })

    const response = await SELF.fetch(
      customerUrl(tenant.storeId, tenant.customerId),
      auth(tenant.token),
    )
    expect(response.status).toBe(200)
    const serialized = JSON.stringify(await response.json())
    expect(serialized).not.toContain('越境')
    expect(serialized).not.toContain(intruderStore)
  })
})
