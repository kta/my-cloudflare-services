import { describe, expect, it } from 'vitest'
import {
  AttentionNoteView,
  CustomerDetail,
  CustomerNoteView,
  OwnedGlassesView,
  PrescriptionView,
  StorePermission,
  VisitHistoryView,
} from '../src/index'

const storeId = '79a59f06-5bd1-4fb4-8574-14b7a79bd48b'
const customerId = 'c6a2a900-9c85-4f4d-b9d4-c9d8c55c20cb'

const prescription = {
  measuredOn: '2026-08-30',
  storeId,
  storeName: '新宿店',
  recordedBy: '検査 太郎',
  rightSphere: '-2.25',
  leftSphere: '-2.00',
  pupillaryDistance: '63.0',
  addPower: null,
}

describe('customer record contracts', () => {
  it('parses a prescription view whose numeric values are already formatted strings', () => {
    expect(PrescriptionView.parse(prescription)).toEqual(prescription)
    expect(PrescriptionView.parse({ ...prescription, addPower: '+1.50' }).addPower).toBe('+1.50')
  })

  it('rejects unformatted numeric values and unknown keys on a prescription view', () => {
    expect(PrescriptionView.safeParse({ ...prescription, rightSphere: -2.25 }).success).toBe(false)
    expect(PrescriptionView.safeParse({ ...prescription, extra: 'x' }).success).toBe(false)
    expect(PrescriptionView.safeParse({ ...prescription, measuredOn: '2026-8-30' }).success).toBe(
      false,
    )
    expect(PrescriptionView.safeParse({ ...prescription, storeId: 'store-1' }).success).toBe(false)
  })

  it('requires the store identity on every store-scoped view so clients never filter by name', () => {
    const note = {
      recordedOn: '2026-08-20',
      storeId,
      storeName: '新宿店',
      recordedBy: '接客 花子',
      body: '掛け心地を軽さ優先で調整。',
    }
    expect(CustomerNoteView.parse(note)).toEqual(note)
    expect(CustomerNoteView.safeParse({ ...note, storeId: undefined }).success).toBe(false)

    const glasses = {
      label: 'EYEX Frame 01',
      purchasedOn: '2026-07-01',
      storeId,
      storeName: '新宿店',
      lensType: '遠近両用',
    }
    expect(OwnedGlassesView.parse(glasses)).toEqual(glasses)
    expect(OwnedGlassesView.safeParse({ ...glasses, storeId: undefined }).success).toBe(false)

    const visit = {
      visitedOn: '2026-08-20',
      storeId,
      storeName: '新宿店',
      summary: '予約来店',
    }
    expect(VisitHistoryView.parse(visit)).toEqual(visit)
    expect(VisitHistoryView.safeParse({ ...visit, storeId: undefined }).success).toBe(false)
  })

  it('requires basis, recorder and record date on an attention note', () => {
    const attention = {
      body: '強度近視のため装用テストを長めに取る。',
      basis: '2026-08-01 の検査結果',
      recordedBy: '店長 次郎',
      recordedOn: '2026-08-01',
    }
    expect(AttentionNoteView.parse(attention)).toEqual(attention)
    for (const key of ['body', 'basis', 'recordedBy', 'recordedOn'] as const) {
      expect(AttentionNoteView.safeParse({ ...attention, [key]: '' }).success).toBe(false)
    }
  })

  it('parses a customer record with empty sections and no restricted-information markers', () => {
    const detail = CustomerDetail.parse({
      customerId,
      currentPrescription: null,
      pastPrescriptions: [],
      latestNote: null,
      ownedGlasses: [],
      attentionNotes: [],
      visitHistory: [],
    })
    expect(Object.keys(detail).sort()).toEqual([
      'attentionNotes',
      'currentPrescription',
      'customerId',
      'latestNote',
      'ownedGlasses',
      'pastPrescriptions',
      'visitHistory',
    ])
    expect(
      CustomerDetail.safeParse({
        customerId,
        currentPrescription: null,
        pastPrescriptions: [],
        latestNote: null,
        ownedGlasses: [],
        attentionNotes: [],
        visitHistory: [],
        attentionNoteCount: 2,
      }).success,
    ).toBe(false)
  })

  it('allow-lists the customer record and attention permissions', () => {
    for (const permission of [
      'customer.read',
      'customer.history',
      'attention.read',
      'attention.write',
      'attention.publish',
      'attention.revise',
      'attention.hide',
    ]) {
      expect(StorePermission.parse(permission)).toBe(permission)
    }
    expect(StorePermission.safeParse('attention.delete').success).toBe(false)
  })
})
