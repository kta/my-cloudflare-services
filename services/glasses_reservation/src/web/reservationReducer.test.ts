import { describe, expect, it } from 'vitest'
import { customers, initialReservationState, reservationReducer } from './reservationReducer'

describe('reservationReducer', () => {
  it('元モックの顧客3名と5/20・5/21の予約を持つ', () => {
    expect(customers).toHaveLength(3)
    expect(
      initialReservationState.reservations.filter((r) => r.date.startsWith('2025/05/20')),
    ).toHaveLength(5)
    expect(
      initialReservationState.reservations.filter((r) => r.date.startsWith('2025/05/21')),
    ).toHaveLength(1)
  })
  it('既存電話番号の一部から佐藤みどりを選択できる', () => {
    const queried = reservationReducer(initialReservationState, {
      type: 'setCustomerQuery',
      field: 'phone',
      value: '090000000',
    })
    expect(queried.customerSuggestion?.name).toBe('佐藤 みどり')
    const selected = reservationReducer(queried, {
      type: 'selectCustomer',
      customerId: 'customer-sato',
    })
    expect(selected.draftCustomer).toMatchObject({ name: '佐藤 みどり', phone: '090-0000-0000' })
  })

  it('選択済み候補の予約を確定し、取消すると台帳から除く', () => {
    const selectable = {
      ...initialReservationState,
      view: 'booking' as const,
      draftCustomer: { name: '佐藤 みどり', phone: '090-0000-0000' },
      draft: {
        date: '2025/05/20 (火)',
        startTime: '14:00',
        purpose: '検眼・カウンセリング',
        staff: '鈴木 明日香',
        selectedSlot: '14:00 〜 15:30',
      },
    }
    const confirmed = reservationReducer(selectable, { type: 'confirmReservation' })
    expect(confirmed.notice).toBe('予約を確定しました')
    const cancelled = reservationReducer(
      { ...confirmed, detailId: 'reservation-new' },
      { type: 'cancelReservation', reservationId: 'reservation-new' },
    )
    expect(cancelled.notice).toBe('予約をキャンセルしました')
    expect(cancelled.reservations.find((entry) => entry.id === 'reservation-new')).toBeUndefined()
  })
})
