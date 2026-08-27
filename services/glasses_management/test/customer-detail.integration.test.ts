import { SELF } from 'cloudflare:test'
import type { CustomerDetail } from '@app/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  auth,
  customerUrl,
  insertAttentionNote,
  insertCustomer,
  insertNote,
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

const ALL = ['store.read', 'customer.read', 'customer.history', 'attention.read'] as const

type Fixture = {
  organizationId: string
  selectedStoreId: string
  otherStoreId: string
  customerId: string
  userId: string
}

async function seed(permissions: readonly string[]): Promise<Fixture & { token: string }> {
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
  return { organizationId, selectedStoreId, otherStoreId, customerId, userId, token }
}

async function seedRecord(fixture: Fixture) {
  const { organizationId, selectedStoreId, otherStoreId, customerId } = fixture
  await insertPrescription({
    organizationId,
    storeId: selectedStoreId,
    customerId,
    measuredOn: '2026-08-20',
    recordedBy: '検査 太郎',
    rightSphere: -2.25,
    leftSphere: -2,
    pupillaryDistance: 63,
    addPower: null,
  })
  await insertPrescription({
    organizationId,
    storeId: selectedStoreId,
    customerId,
    measuredOn: '2025-04-02',
    recordedBy: '検査 三郎',
    rightSphere: -1.5,
    leftSphere: -1.25,
    pupillaryDistance: 62.5,
    addPower: 1.5,
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
    addPower: null,
  })
  await insertNote({
    organizationId,
    storeId: selectedStoreId,
    customerId,
    recordedOn: '2026-08-20',
    recordedBy: '接客 花子',
    body: '軽さ優先で調整。',
  })
  await insertNote({
    organizationId,
    storeId: selectedStoreId,
    customerId,
    recordedOn: '2025-04-02',
    recordedBy: '接客 次郎',
    body: '古いメモ。',
  })
  await insertOwnedGlasses({
    organizationId,
    storeId: selectedStoreId,
    customerId,
    label: 'EYEX Frame 01',
    purchasedOn: '2026-08-20',
    lensType: '単焦点',
  })
  await insertOwnedGlasses({
    organizationId,
    storeId: otherStoreId,
    customerId,
    label: 'EYEX Frame 02',
    purchasedOn: '2026-01-15',
    lensType: '遠近両用',
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
}

async function read(token: string, storeId: string, customerId: string) {
  const response = await SELF.fetch(customerUrl(storeId, customerId), auth(token))
  return { response, body: (await response.json()) as CustomerDetail }
}

describe('customer record read API', () => {
  let fixture: Fixture & { token: string }

  beforeEach(async () => {
    fixture = await seed(ALL)
    await seedRecord(fixture)
  })

  it('separates the current prescription from past ones, newest first, with 測定日・店舗・記録者', async () => {
    const { response, body } = await read(
      fixture.token,
      fixture.selectedStoreId,
      fixture.customerId,
    )
    expect(response.status).toBe(200)
    expect(body.customerId).toBe(fixture.customerId)
    expect(body.currentPrescription).toEqual({
      measuredOn: '2026-08-20',
      storeId: fixture.selectedStoreId,
      storeName: '新宿店',
      recordedBy: '検査 太郎',
      rightSphere: '-2.25',
      leftSphere: '-2.00',
      pupillaryDistance: '63.0',
      addPower: null,
    })
    expect(body.pastPrescriptions.map((row) => row.measuredOn)).toEqual([
      '2026-01-15',
      '2025-04-02',
    ])
    expect(body.pastPrescriptions[0]).toMatchObject({
      storeId: fixture.otherStoreId,
      storeName: '横浜店',
      recordedBy: '横浜 花子',
    })
    expect(body.pastPrescriptions[1]).toMatchObject({
      addPower: '+1.50',
      pupillaryDistance: '62.5',
    })
  })

  it('returns the latest note, owned glasses and cross-store visit history for a permitted staff member', async () => {
    const { body } = await read(fixture.token, fixture.selectedStoreId, fixture.customerId)
    expect(body.latestNote).toEqual({
      recordedOn: '2026-08-20',
      storeId: fixture.selectedStoreId,
      storeName: '新宿店',
      recordedBy: '接客 花子',
      body: '軽さ優先で調整。',
    })
    expect(body.ownedGlasses.map((row) => row.label)).toEqual(['EYEX Frame 01', 'EYEX Frame 02'])
    expect(body.visitHistory).toEqual([
      {
        visitedOn: '2026-08-20',
        storeId: fixture.selectedStoreId,
        storeName: '新宿店',
        summary: '予約来店',
      },
      {
        visitedOn: '2026-01-15',
        storeId: fixture.otherStoreId,
        storeName: '横浜店',
        summary: 'ウォークイン来店',
      },
    ])
  })

  it('returns attention notes with 根拠・記録者・記録日 and hides drafts and hidden notes', async () => {
    await insertAttentionNote({
      organizationId: fixture.organizationId,
      storeId: fixture.selectedStoreId,
      customerId: fixture.customerId,
      body: '未公開の下書き。',
      basis: '下書き根拠',
      recordedBy: '店長 次郎',
      recordedOn: '2026-08-02',
      status: 'draft',
    })
    await insertAttentionNote({
      organizationId: fixture.organizationId,
      storeId: fixture.selectedStoreId,
      customerId: fixture.customerId,
      body: '非表示化済み。',
      basis: '非表示根拠',
      recordedBy: '店長 次郎',
      recordedOn: '2026-08-03',
      hiddenAt: '2026-08-04T00:00:00.000Z',
    })
    const { body } = await read(fixture.token, fixture.selectedStoreId, fixture.customerId)
    expect(body.attentionNotes).toEqual([
      {
        body: '装用テストを長めに取る。',
        basis: '2026-08-01 の検査結果',
        recordedBy: '店長 次郎',
        recordedOn: '2026-08-01',
      },
    ])
  })

  it('excludes visits that have not happened yet at the injected request time', async () => {
    await insertReservation({
      organizationId: fixture.organizationId,
      storeId: fixture.selectedStoreId,
      customerId: fixture.customerId,
      startAt: '2026-09-10T01:00:00.000Z',
      status: 'confirmed',
    })
    const { body } = await read(fixture.token, fixture.selectedStoreId, fixture.customerId)
    expect(body.visitHistory.map((row) => row.visitedOn)).toEqual(['2026-08-20', '2026-01-15'])
  })

  it('returns empty sections for a customer with no record yet', async () => {
    const emptyCustomerId = await insertCustomer({
      organizationId: fixture.organizationId,
      primaryStoreId: fixture.selectedStoreId,
    })
    const { response, body } = await read(fixture.token, fixture.selectedStoreId, emptyCustomerId)
    expect(response.status).toBe(200)
    expect(body).toEqual({
      customerId: emptyCustomerId,
      currentPrescription: null,
      pastPrescriptions: [],
      latestNote: null,
      ownedGlasses: [],
      attentionNotes: [],
      visitHistory: [],
    })
  })

  it('never merges duplicate customers: each record is read on its own identifier', async () => {
    const duplicateId = await insertCustomer({
      organizationId: fixture.organizationId,
      primaryStoreId: fixture.selectedStoreId,
    })
    await insertNote({
      organizationId: fixture.organizationId,
      storeId: fixture.selectedStoreId,
      customerId: duplicateId,
      recordedOn: '2026-08-25',
      recordedBy: '接客 花子',
      body: '重複候補のメモ。',
    })
    const original = await read(fixture.token, fixture.selectedStoreId, fixture.customerId)
    const duplicate = await read(fixture.token, fixture.selectedStoreId, duplicateId)
    expect(original.body.latestNote?.body).toBe('軽さ優先で調整。')
    expect(duplicate.body.latestNote?.body).toBe('重複候補のメモ。')
    expect(duplicate.body.currentPrescription).toBeNull()
  })

  it('answers an unknown customer identifier with the same opaque forbidden response', async () => {
    const response = await SELF.fetch(
      customerUrl(fixture.selectedStoreId, 'not-a-uuid'),
      auth(fixture.token),
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })
})
