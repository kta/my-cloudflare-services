import type { PublicBookingCreate, PublicStoreSummary } from '@app/contracts'

export type PublicBookingStep =
  | 'store'
  | 'store_detail'
  | 'purpose'
  | 'datetime'
  | 'customer'
  | 'confirm'
  | 'complete'
  | 'unknown'
export type PublicBookingStore = PublicStoreSummary
type PublicBookingCustomer = PublicBookingCreate['customer']

export type PublicBookingDraft = {
  step: PublicBookingStep
  store?: PublicBookingStore
  purposeIds: string[]
  date?: string
  startTime?: string
  customer?: PublicBookingCustomer
  error?: 'slot_unavailable' | 'network' | 'unknown_result' | 'verification_expired'
  confirmationKey?: string
}

export type PublicBookingAction =
  | { type: 'store_selected'; store: PublicBookingStore }
  | { type: 'purposes_selected'; purposeIds: string[] }
  | { type: 'slot_selected'; date: string; startTime: string }
  | { type: 'customer_entered'; customer: PublicBookingCustomer }
  | { type: 'booking_started' }
  | { type: 'confirmation_opened'; confirmationKey?: string }
  | { type: 'booking_conflicted' }
  | { type: 'booking_succeeded' }
  | { type: 'booking_result_unknown' }
  | { type: 'booking_status_resolved'; status: 'confirmed' | 'pending' | 'not_found' }

export function createPublicBookingDraft(): PublicBookingDraft {
  return { step: 'store', purposeIds: [] }
}

export function publicBookingReducer(
  draft: PublicBookingDraft,
  action: PublicBookingAction,
): PublicBookingDraft {
  switch (action.type) {
    case 'store_selected':
      if (draft.store?.slug === action.store.slug)
        return { ...draft, step: 'store_detail', error: undefined }
      return {
        step: 'store_detail',
        store: action.store,
        purposeIds: [],
        date: undefined,
        startTime: undefined,
        customer: undefined,
        error: undefined,
        confirmationKey: undefined,
      }
    case 'purposes_selected':
      return { ...draft, step: 'datetime', purposeIds: action.purposeIds, error: undefined }
    case 'slot_selected':
      return {
        ...draft,
        step: 'customer',
        date: action.date,
        startTime: action.startTime,
        error: undefined,
      }
    case 'customer_entered':
      return { ...draft, step: 'customer', customer: action.customer, error: undefined }
    case 'booking_started':
      return { ...draft, step: 'purpose', error: undefined }
    case 'confirmation_opened':
      return {
        ...draft,
        step: 'confirm',
        confirmationKey: action.confirmationKey ?? draft.confirmationKey,
        error: undefined,
      }
    case 'booking_conflicted':
      return { ...draft, step: 'datetime', error: 'slot_unavailable' }
    case 'booking_succeeded':
      return { ...draft, step: 'complete', error: undefined }
    case 'booking_result_unknown':
      return { ...draft, step: 'unknown', error: 'unknown_result' }
    case 'booking_status_resolved':
      if (action.status === 'confirmed') return { ...draft, step: 'complete', error: undefined }
      return { ...draft, step: 'unknown', error: 'unknown_result' }
  }
}
