import { describe, expect, it } from 'vitest'
import { createPublicBookingDraft, publicBookingReducer } from './public-booking'

/* 一覧の店舗はアクセス文と本日の営業時間まで持つ（承認済みモックの検索カード）。 */
const store = {
  slug: 'ginza',
  name: '銀座店',
  contactPhone: '03-0000-0000',
  region: '東京都',
  nearestStation: '銀座駅',
  accessText: '銀座駅 A3出口から徒歩2分',
  todayBusinessHours: '10:00–19:00',
}
const purpose = {
  id: '00000000-0000-4000-8000-000000000001',
  label: 'メガネを新しく作りたい',
  durationMinutes: 60,
}

describe('public booking state machine', () => {
  it('keeps the selected store and progresses through purpose, datetime, customer, and confirmation', () => {
    const selectedStore = publicBookingReducer(createPublicBookingDraft(), {
      type: 'store_selected',
      store,
    })
    const selectedPurpose = publicBookingReducer(selectedStore, {
      type: 'purposes_selected',
      purposeIds: [purpose.id],
    })
    const selectedSlot = publicBookingReducer(selectedPurpose, {
      type: 'slot_selected',
      date: '2026-09-01',
      startTime: '10:00',
    })
    const enteredCustomer = publicBookingReducer(selectedSlot, {
      type: 'customer_entered',
      customer: {
        name: '田中花子',
        kana: 'タナカハナコ',
        phone: '09012345678',
        email: 'hanako@example.test',
      },
    })
    const ready = publicBookingReducer(enteredCustomer, { type: 'confirmation_opened' })

    expect(ready).toMatchObject({
      step: 'confirm',
      store,
      purposeIds: [purpose.id],
      date: '2026-09-01',
      startTime: '10:00',
      customer: { name: '田中花子', email: 'hanako@example.test' },
    })
  })

  it('keeps same-store input and offers recovery when the selected slot becomes unavailable', () => {
    const selectedStore = publicBookingReducer(createPublicBookingDraft(), {
      type: 'store_selected',
      store,
    })
    const readyToSubmit = publicBookingReducer(
      publicBookingReducer(
        publicBookingReducer(selectedStore, {
          type: 'purposes_selected',
          purposeIds: [purpose.id],
        }),
        { type: 'slot_selected', date: '2026-09-01', startTime: '10:00' },
      ),
      {
        type: 'customer_entered',
        customer: {
          name: '田中花子',
          kana: 'タナカハナコ',
          phone: '09012345678',
          email: 'hanako@example.test',
        },
      },
    )
    const conflicted = publicBookingReducer(readyToSubmit, { type: 'booking_conflicted' })

    expect(conflicted).toMatchObject({
      step: 'datetime',
      store,
      purposeIds: [purpose.id],
      date: '2026-09-01',
      startTime: '10:00',
      customer: { name: '田中花子', email: 'hanako@example.test' },
      error: 'slot_unavailable',
    })
  })

  it('clears a memory-only booking draft when the customer selects a different store', () => {
    const initial = publicBookingReducer(createPublicBookingDraft(), {
      type: 'store_selected',
      store,
    })
    const withPurpose = publicBookingReducer(initial, {
      type: 'purposes_selected',
      purposeIds: [purpose.id],
    })
    const changedStore = publicBookingReducer(withPurpose, {
      type: 'store_selected',
      store: { ...store, slug: 'marunouchi', name: '丸の内店' },
    })

    expect(changedStore).toEqual({
      step: 'store_detail',
      store: { ...store, slug: 'marunouchi', name: '丸の内店' },
      purposeIds: [],
      date: undefined,
      startTime: undefined,
      customer: undefined,
      error: undefined,
      confirmationKey: undefined,
    })
  })

  it('retains one in-memory confirmation key while resolving an unknown booking result', () => {
    const customer = {
      name: '田中花子',
      kana: 'タナカハナコ',
      phone: '09012345678',
      email: 'hanako@example.test',
    }
    const selected = publicBookingReducer(createPublicBookingDraft(), {
      type: 'store_selected',
      store,
    })
    const withPurpose = publicBookingReducer(selected, {
      type: 'purposes_selected',
      purposeIds: [purpose.id],
    })
    const withSlot = publicBookingReducer(withPurpose, {
      type: 'slot_selected',
      date: '2026-09-01',
      startTime: '10:00',
    })
    const confirmed = publicBookingReducer(
      publicBookingReducer(withSlot, { type: 'customer_entered', customer }),
      { type: 'confirmation_opened', confirmationKey: 'confirmation-key-1' },
    )
    const unknown = publicBookingReducer(confirmed, { type: 'booking_result_unknown' })
    const recovered = publicBookingReducer(unknown, {
      type: 'booking_status_resolved',
      status: 'confirmed',
    })

    expect(unknown).toMatchObject({
      step: 'unknown',
      error: 'unknown_result',
      confirmationKey: 'confirmation-key-1',
      store,
      customer,
      date: '2026-09-01',
      startTime: '10:00',
    })
    expect(recovered).toMatchObject({
      step: 'complete',
      error: undefined,
      confirmationKey: 'confirmation-key-1',
    })
  })
})
