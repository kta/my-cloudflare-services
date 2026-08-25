export type View = 'home' | 'booking' | 'ledger' | 'list' | 'customer' | 'dashboard'
export type Customer = {
  id: string
  name: string
  phone: string
  gender: string
  age: string
  birthday: string
  lastVisit: string
  memberId: string
  purpose: string
}
type Reservation = {
  id: string
  date: string
  time: string
  name: string
  purpose: string
  staff: string
  room: string
  status: '確定' | '仮予約'
  tone: 'green' | 'blue' | 'orange'
}
type DraftCustomer = { name: string; phone: string }
type AppointmentDraft = {
  date: string
  startTime: string
  purpose: string
  staff: string
  selectedSlot: string
}
export type ReservationState = {
  view: View
  customers: Customer[]
  reservations: Reservation[]
  draftCustomer: DraftCustomer | null
  draft: AppointmentDraft
  customerSuggestion: Customer | null
  notice: string
  detailId: string | null
  changeOpen: boolean
  recordingPaused: boolean
  listStaff: string
  customerTab: string
  homeCalendarOpen: boolean
  homeDate: string
  listDate: string
}
