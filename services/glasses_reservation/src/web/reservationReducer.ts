import type { Customer, ReservationState, View } from './model'

export const customers: Customer[] = [
  {
    id: 'customer-sato',
    name: '佐藤 みどり',
    phone: '090-0000-0000',
    gender: '女性',
    age: '50代',
    birthday: '1971/04/12',
    lastVisit: '2024/12/15（日）',
    memberId: '1000123',
    purpose: 'メガネの作製（遠近両用）',
  },
  {
    id: 'customer-tanaka',
    name: '田中 花子',
    phone: '080-1234-5678',
    gender: '女性',
    age: '40代',
    birthday: '1984/09/20',
    lastVisit: '2025/03/08（土）',
    memberId: '1000210',
    purpose: 'メガネの調整',
  },
  {
    id: 'customer-yamamoto',
    name: '山本 太郎',
    phone: '070-3456-7890',
    gender: '男性',
    age: '30代',
    birthday: '1990/07/18',
    lastVisit: '2025/04/22（火）',
    memberId: '1000311',
    purpose: 'コンタクト相談',
  },
]
const initialReservations = [
  {
    id: 'r1',
    date: '2025/05/20 (火)',
    time: '09:00 〜 10:30',
    name: '鈴木 一郎',
    purpose: 'メガネの作製（遠近両用）',
    staff: '鈴木 明日香',
    room: '検眼室 1',
    status: '確定' as const,
    tone: 'blue' as const,
  },
  {
    id: 'r2',
    date: '2025/05/20 (火)',
    time: '11:00 〜 12:30',
    name: '田中 花子',
    purpose: 'メガネの調整・フィッティング',
    staff: '田中 健一',
    room: '検眼室 2',
    status: '確定' as const,
    tone: 'green' as const,
  },
  {
    id: 'r3',
    date: '2025/05/20 (火)',
    time: '14:00 〜 15:30',
    name: '佐藤 みどり',
    purpose: '検眼・カウンセリング',
    staff: '鈴木 明日香',
    room: '検眼室 1',
    status: '仮予約' as const,
    tone: 'green' as const,
  },
  {
    id: 'r4',
    date: '2025/05/20 (火)',
    time: '15:30 〜 17:00',
    name: '山本 太郎',
    purpose: 'コンタクト相談・購入',
    staff: '佐藤 美咲',
    room: '検眼室 2',
    status: '確定' as const,
    tone: 'orange' as const,
  },
  {
    id: 'r5',
    date: '2025/05/20 (火)',
    time: '16:00 〜 17:30',
    name: '高橋 美咲',
    purpose: 'メガネの作製（遠近両用）',
    staff: '田中 健一',
    room: '検眼室 1',
    status: '確定' as const,
    tone: 'blue' as const,
  },
  {
    id: 'r6',
    date: '2025/05/21 (水)',
    time: '10:00 〜 11:30',
    name: '小林 誠',
    purpose: '初回検眼',
    staff: '鈴木 明日香',
    room: '検眼室 1',
    status: '確定' as const,
    tone: 'green' as const,
  },
]
export const initialReservationState: ReservationState = {
  view: 'home',
  customers,
  reservations: initialReservations,
  draftCustomer: null,
  draft: { date: '', startTime: '', purpose: '', staff: '', selectedSlot: '' },
  customerSuggestion: null,
  notice: '',
  detailId: null,
  changeOpen: false,
  recordingPaused: false,
  listStaff: 'すべて',
  customerTab: 'visit',
  homeCalendarOpen: false,
  homeDate: '20',
  listDate: '2025/05/20 (火)',
}
export type Action =
  | { type: 'setView'; view: View }
  | { type: 'openBooking' }
  | { type: 'setCustomerQuery'; field: 'name' | 'phone'; value: string }
  | { type: 'selectCustomer'; customerId: string }
  | {
      type: 'registerCustomer'
      name: string
      phone: string
      gender: string
      age: string
      birthday: string
      memberId: string
      lastVisit: string
      purpose: string
    }
  | { type: 'setAppointment'; field: 'date' | 'startTime' | 'purpose' | 'staff'; value: string }
  | { type: 'selectSlot'; slot: string; staff: string }
  | { type: 'confirmReservation' }
  | { type: 'openReservation'; reservationId: string }
  | { type: 'saveReservationChange'; date?: string; time?: string; staff?: string }
  | { type: 'cancelReservation'; reservationId: string }
  | { type: 'setRecordPaused' }
  | { type: 'setCustomerTab'; tab: string }
  | { type: 'setListStaff'; staff: string }
  | { type: 'toggleHomeCalendar' }
  | { type: 'setHomeDate'; date: string }
  | { type: 'setListDate'; date: string }
  | { type: 'setNotice'; notice: string }
const normalize = (value: string) => value.replace(/[\s-]/g, '').toLowerCase()
const reservationDate = (value: string) => {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][
    new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  ]
  return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')} (${weekday})`
}
const customerDate = (value: string, fallback: string) => {
  if (!value) return fallback
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][
    new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  ]
  return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}（${weekday}）`
}
export function reservationReducer(state: ReservationState, action: Action): ReservationState {
  switch (action.type) {
    case 'setView':
      return {
        ...state,
        view: action.view,
        notice: '',
        detailId: null,
        changeOpen: false,
        ...(action.view === 'booking'
          ? {
              draftCustomer: null,
              draft: { date: '', startTime: '', purpose: '', staff: '', selectedSlot: '' },
            }
          : {}),
      }
    case 'openBooking':
      return reservationReducer(state, { type: 'setView', view: 'booking' })
    case 'setCustomerQuery': {
      const value = normalize(action.value)
      const found =
        state.customers.find(
          (c) => normalize(c.name).includes(value) || normalize(c.phone).includes(value),
        ) ?? null
      return { ...state, customerSuggestion: state.draftCustomer ? null : found }
    }
    case 'selectCustomer': {
      const customer = state.customers.find((c) => c.id === action.customerId)
      return customer
        ? {
            ...state,
            draftCustomer: { name: customer.name, phone: customer.phone },
            customerSuggestion: null,
          }
        : state
    }
    case 'registerCustomer': {
      const customer = {
        id: `customer-${state.customers.length + 1}`,
        name: action.name || '新しいお客様',
        phone: action.phone || '未入力',
        gender: action.gender || '未入力',
        age: action.age || '—',
        birthday: customerDate(action.birthday, '—'),
        memberId: action.memberId || '新規',
        lastVisit: customerDate(action.lastVisit, '本日'),
        purpose: action.purpose || 'ご相談',
      }
      return {
        ...state,
        customers: [customer, ...state.customers],
        draftCustomer: { name: customer.name, phone: customer.phone },
        notice: '顧客情報を登録しました',
      }
    }
    case 'setAppointment':
      return { ...state, draft: { ...state.draft, [action.field]: action.value } }
    case 'selectSlot':
      return {
        ...state,
        draft: {
          ...state.draft,
          selectedSlot: action.slot,
          staff: action.staff,
          startTime: action.slot.slice(0, 5),
        },
      }
    case 'confirmReservation': {
      if (
        !state.draftCustomer ||
        !state.draft.date ||
        !state.draft.startTime ||
        !state.draft.purpose ||
        !state.draft.selectedSlot ||
        !state.draft.staff
      ) {
        return { ...state, notice: '予約に必要な情報を入力してください' }
      }
      const slot = state.draft.selectedSlot
      return {
        ...state,
        view: 'list',
        reservations: [
          {
            id: 'reservation-new',
            date: state.draft.date || '2025/05/20 (火)',
            time: slot,
            name: state.draftCustomer.name,
            purpose: state.draft.purpose,
            staff: state.draft.staff,
            room: '検眼室 1',
            status: '確定',
            tone: 'green',
          },
          ...state.reservations,
        ],
        notice: '予約を確定しました',
      }
    }
    case 'openReservation':
      return { ...state, detailId: action.reservationId, changeOpen: false }
    case 'saveReservationChange':
      return {
        ...state,
        reservations: state.reservations.map((r) =>
          r.id === state.detailId
            ? {
                ...r,
                date: action.date ? reservationDate(action.date) : r.date,
                time: action.time || r.time,
                staff: action.staff || r.staff,
                status: '確定',
              }
            : r,
        ),
        changeOpen: false,
        notice: '予約内容を変更しました',
      }
    case 'cancelReservation':
      return {
        ...state,
        reservations: state.reservations.filter((r) => r.id !== action.reservationId),
        detailId: null,
        changeOpen: false,
        notice: '予約をキャンセルしました',
      }
    case 'setRecordPaused':
      return { ...state, recordingPaused: !state.recordingPaused }
    case 'setCustomerTab':
      return { ...state, customerTab: action.tab }
    case 'setListStaff':
      return { ...state, listStaff: action.staff }
    case 'toggleHomeCalendar':
      return { ...state, homeCalendarOpen: !state.homeCalendarOpen }
    case 'setHomeDate':
      return { ...state, homeDate: action.date, homeCalendarOpen: false }
    case 'setListDate':
      return { ...state, listDate: action.date }
    case 'setNotice':
      return { ...state, notice: action.notice }
  }
}
