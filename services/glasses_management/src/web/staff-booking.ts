import type {
  AvailabilityPurpose,
  AvailabilitySlot,
  AvailabilityStoreSettings,
  StaffReservationCreate,
} from '@app/contracts'

/*
 * The telephone/counter booking flow, as a pure state machine.
 *
 * The order of the five steps is a property of the conversation, not of the
 * software: a staff member on the phone asks for the day, then the time, then
 * what the visit is for, then who is calling, and finally reads the whole
 * thing back. It is therefore a literal constant here — there is no way to
 * reorder, skip or configure it.
 *
 * Nothing in this module reads the clock. Today is always passed in.
 */

export type StaffBookingStep = 'date' | 'time' | 'purpose' | 'customer' | 'recital' | 'complete'

/** The five input steps, with the sentence the staff member reads aloud. */
export const STAFF_BOOKING_STEPS = [
  { step: 'date', label: '日', prompt: 'ご来店予定の日を伺えますか？' },
  { step: 'time', label: '時間', prompt: 'ご来店予定の時刻を伺えますか？' },
  { step: 'purpose', label: '来店目的', prompt: '今回のご来店目的を伺えますか？' },
  { step: 'customer', label: 'お客様情報', prompt: 'お電話番号を伺えますか？' },
  { step: 'recital', label: '復唱する', prompt: '次の内容を、お客様へそのままお伝えください' },
] as const satisfies readonly { step: StaffBookingStep; label: string; prompt: string }[]

/** 1-based position of a step in the five-step flow; 0 once the booking is made. */
export function stepPosition(step: StaffBookingStep): number {
  return STAFF_BOOKING_STEPS.findIndex((entry) => entry.step === step) + 1
}

type StaffBookingError = 'slot_unavailable' | 'network' | 'idempotency_key_required'

/** Only what StaffReservationCreate needs — customer identification is its own component. */
type StaffBookingCustomer = {
  name: string
  kana: string
  phone: string
  email?: string
}

export type StaffBookingDraft = {
  step: StaffBookingStep
  date?: string
  startTime?: string
  purposeIds: string[]
  customer: StaffBookingCustomer
  reservationMemo: string
  handoffNote: string
  /** Same-store alternative times offered after a lost slot. */
  alternatives: AvailabilitySlot[]
  error?: StaffBookingError
  /** Minted once per booking attempt and reused by every resend. */
  idempotencyKey?: string
  submitting: boolean
  confirmingDiscard: boolean
  reservationNumber?: string
}

export type StaffBookingAction =
  | { type: 'date_selected'; date: string }
  | { type: 'time_selected'; startTime: string }
  | { type: 'purposes_changed'; purposeIds: string[] }
  | { type: 'availability_confirmed' }
  | { type: 'availability_rejected'; alternatives: AvailabilitySlot[] }
  | { type: 'alternative_selected'; startTime: string }
  | { type: 'customer_changed'; customer: Partial<StaffBookingCustomer> }
  | { type: 'notes_changed'; notes: { reservationMemo?: string; handoffNote?: string } }
  | { type: 'customer_confirmed' }
  | { type: 'back' }
  | { type: 'submit_started'; idempotencyKey: string }
  | { type: 'submit_conflicted'; alternatives: AvailabilitySlot[] }
  | { type: 'submit_failed'; error: StaffBookingError }
  | { type: 'submit_succeeded'; reservationNumber: string }
  | { type: 'discard_requested' }
  | { type: 'discard_cancelled' }
  | { type: 'discard_confirmed' }

/**
 * Whether abandoning this draft would actually lose the operator's work.
 *
 * A store switch interrupts only when something real is at stake
 * (UC-EYEX-065, AC-EYEX-29): warning on an untouched form teaches operators to
 * dismiss the warning that matters. A confirmed booking is already saved, so
 * its draft holds nothing to lose.
 */
export function hasUnsavedBookingInput(draft: StaffBookingDraft): boolean {
  if (draft.reservationNumber !== undefined) return false
  return (
    draft.date !== undefined ||
    draft.startTime !== undefined ||
    draft.purposeIds.length > 0 ||
    draft.customer.name !== '' ||
    draft.customer.kana !== '' ||
    draft.customer.phone !== '' ||
    draft.reservationMemo !== '' ||
    draft.handoffNote !== ''
  )
}

export function createStaffBookingDraft(): StaffBookingDraft {
  return {
    step: 'date',
    purposeIds: [],
    customer: { name: '', kana: '', phone: '' },
    reservationMemo: '',
    handoffNote: '',
    alternatives: [],
    submitting: false,
    confirmingDiscard: false,
  }
}

const previousStep: Record<StaffBookingStep, StaffBookingStep> = {
  date: 'date',
  time: 'date',
  purpose: 'time',
  customer: 'purpose',
  recital: 'customer',
  complete: 'complete',
}

export function staffBookingReducer(
  draft: StaffBookingDraft,
  action: StaffBookingAction,
): StaffBookingDraft {
  switch (action.type) {
    case 'date_selected':
      // Re-picking the same day must not throw away the time already agreed.
      return {
        ...draft,
        step: 'time',
        date: action.date,
        startTime: action.date === draft.date ? draft.startTime : undefined,
        alternatives: [],
        error: undefined,
      }
    case 'time_selected':
      return {
        ...draft,
        step: 'purpose',
        startTime: action.startTime,
        alternatives: [],
        error: undefined,
      }
    case 'purposes_changed':
      return { ...draft, purposeIds: action.purposeIds, alternatives: [], error: undefined }
    case 'availability_confirmed':
      return { ...draft, step: 'customer', alternatives: [], error: undefined }
    case 'availability_rejected':
      return {
        ...draft,
        step: 'purpose',
        alternatives: action.alternatives,
        error: 'slot_unavailable',
        submitting: false,
      }
    case 'alternative_selected':
      return {
        ...draft,
        step: 'purpose',
        startTime: action.startTime,
        alternatives: [],
        error: undefined,
      }
    case 'customer_changed':
      return { ...draft, customer: { ...draft.customer, ...action.customer } }
    case 'notes_changed':
      return {
        ...draft,
        reservationMemo: action.notes.reservationMemo ?? draft.reservationMemo,
        handoffNote: action.notes.handoffNote ?? draft.handoffNote,
      }
    case 'customer_confirmed':
      return { ...draft, step: 'recital', error: undefined }
    case 'back':
      return { ...draft, step: previousStep[draft.step], error: undefined }
    case 'submit_started':
      // A resend keeps the key it already has, so the server sees one booking.
      return {
        ...draft,
        idempotencyKey: draft.idempotencyKey ?? action.idempotencyKey,
        submitting: true,
        error: undefined,
      }
    case 'submit_conflicted':
      return {
        ...draft,
        step: 'purpose',
        alternatives: action.alternatives,
        error: 'slot_unavailable',
        submitting: false,
      }
    case 'submit_failed':
      // Everything typed stays on screen; only the send failed.
      return { ...draft, submitting: false, error: action.error }
    case 'submit_succeeded':
      return {
        ...draft,
        step: 'complete',
        submitting: false,
        error: undefined,
        reservationNumber: action.reservationNumber,
      }
    case 'discard_requested':
      return { ...draft, confirmingDiscard: true }
    case 'discard_cancelled':
      return { ...draft, confirmingDiscard: false }
    case 'discard_confirmed':
      return createStaffBookingDraft()
  }
}

function toMinutes(time: string): number {
  const [hour = '0', minute = '0'] = time.split(':')
  return Number(hour) * 60 + Number(minute)
}

function toTime(minutes: number): string {
  const hour = Math.floor(minutes / 60)
  return `${String(hour).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Parsed as UTC midnight: pure arithmetic on the date parts, never the clock. */
function utcMidnight(date: string): Date {
  const [year = '0', month = '1', day = '1'] = date.split('-')
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
}

function addDays(date: string, days: number): string {
  const shifted = utcMidnight(date)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

function weekday(date: string): number {
  return utcMidnight(date).getUTCDay()
}

/** How far ahead the telephone flow accepts bookings. Settings carry no horizon. */
const STAFF_BOOKING_HORIZON_DAYS = 60

function openPeriods(
  settings: AvailabilityStoreSettings,
  date: string,
): { startTime: string; endTime: string }[] {
  const exception = settings.exceptions.find((entry) => entry.date === date)
  if (exception) return exception.mode === 'open' ? exception.periods : []
  return settings.businessHours.find((entry) => entry.dayOfWeek === weekday(date))?.periods ?? []
}

/** Today first, then every open day inside the horizon. Never a past day. */
export function receivableDates(
  settings: AvailabilityStoreSettings,
  today: string,
  horizonDays: number = STAFF_BOOKING_HORIZON_DAYS,
): string[] {
  if (settings.receptionStatus === 'paused') return []
  const dates: string[] = []
  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const date = addDays(today, offset)
    if (openPeriods(settings, date).length > 0) dates.push(date)
  }
  return dates
}

/**
 * The times the customer may ask for on a given day. These are wishes, not
 * held resources — the resource check happens once the purposes are known.
 *
 * 候補は「読み上げられる短い一覧」に絞る（承認済みモック BOOK-TIME は 6 件・
 * 2 行）。営業時間を刻み幅で全部並べると 18 件を超え、電話口では読み上げられ
 * ないうえ下部の工程バーに最終行が隠れる。件数は店舗設定
 * （`desiredTimeCandidateCount`）が持ち、ここでは「どう選ぶか」だけを決める。
 *
 * 選び方は 1 日を等間隔に見渡す間引きにした。営業開始と最終受付を必ず含み、
 * 午前しか出ない・午後しか出ないという偏りが起きない。目的を選ぶまで所要時間
 * も技能も分からないので、この工程で空きを根拠にすることはできない。
 */
export function desiredTimes(
  settings: AvailabilityStoreSettings,
  date: string,
  intervalMinutes = 30,
  limit: number = settings.desiredTimeCandidateCount,
): string[] {
  const times: string[] = []
  for (const period of openPeriods(settings, date)) {
    const end = toMinutes(period.endTime)
    for (let at = toMinutes(period.startTime); at < end; at += intervalMinutes)
      times.push(toTime(at))
  }
  if (times.length <= limit) return times
  const last = times.length - 1
  const picked = new Set<string>()
  for (let index = 0; index < limit; index += 1) {
    const at = Math.round((index * last) / (limit - 1))
    const time = times[at]
    if (time !== undefined) picked.add(time)
  }
  return [...picked]
}

/*
 * 電話番号は伺ったまま（`09012345678`）ではなく、読み上げられる形に整える。
 * 復唱は耳で確かめる工程なので、区切りの無い 11 桁は読み違えの元になる。
 * すでに区切られている入力には触れない。
 */
export function spokenPhone(phone: string): string {
  const trimmed = phone.trim()
  if (!/^[0-9]+$/.test(trimmed)) return trimmed
  // 携帯・IP 電話は 3-4-4、市外局番 2 桁（03 / 06）は 2-4-4、それ以外は 3-3-4。
  if (trimmed.length === 11)
    return `${trimmed.slice(0, 3)}-${trimmed.slice(3, 7)}-${trimmed.slice(7)}`
  if (trimmed.length === 10) {
    const head = /^0[36]/.test(trimmed) ? 2 : 3
    return `${trimmed.slice(0, head)}-${trimmed.slice(head, 6)}-${trimmed.slice(6)}`
  }
  return trimmed
}

export function totalDurationMinutes(
  purposes: readonly AvailabilityPurpose[],
  purposeIds: readonly string[],
): number {
  return purposeIds.reduce((total, id) => {
    const purpose = purposes.find((entry) => entry.id === id)
    return total + (purpose?.durationMinutes ?? 0)
  }, 0)
}

/** The offered slots nearest the desired time, listed in clock order. */
export function nearestAlternatives(
  slots: readonly AvailabilitySlot[],
  startTime: string,
  limit = 3,
): AvailabilitySlot[] {
  const desired = toMinutes(startTime)
  return [...slots]
    .filter((entry) => entry.startTime !== startTime)
    .sort(
      (a, b) =>
        Math.abs(toMinutes(a.startTime) - desired) - Math.abs(toMinutes(b.startTime) - desired),
    )
    .slice(0, limit)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
}

/** 復唱で名乗る屋号。モックの `EYEX予約 銀座店` の前半。 */
const BRAND_NAME = 'EYEX予約'

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const

/** A day as staff read it aloud and tap it: 8月27日（木）. */
export function japaneseDayLabel(date: string): string {
  const [, month = '1', day = '1'] = date.split('-')
  return `${Number(month)}月${Number(day)}日（${WEEKDAY_NAMES[weekday(date)]}）`
}

function spokenTime(startTime: string): string {
  const [hourText = '0', minuteText = '0'] = startTime.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const half = hour < 12 ? '午前' : '午後'
  const spokenHour = hour < 13 ? hour : hour - 12
  return `${half}${spokenHour}時${minute === 0 ? '' : `${minute}分`}`
}

export type RecitalInput = {
  date: string
  startTime: string
  storeName: string
  purposeNames: readonly string[]
  durationMinutes: number
  customerName: string
  phone: string
}

/** The complete sentence the staff member reads back before confirming. */
export function recitalSentence(input: RecitalInput): string {
  const [, month = '1', day = '1'] = input.date.split('-')
  return (
    `${Number(month)}月${Number(day)}日、${WEEKDAY_NAMES[weekday(input.date)]}曜日の` +
    // モックの復唱は屋号込みで店舗を名乗る（`EYEX予約 銀座店で、`）。
    `${spokenTime(input.startTime)}に、${BRAND_NAME} ${input.storeName}で、` +
    `${input.purposeNames.join('と')}を承りました。` +
    `所要時間は約${input.durationMinutes}分です。` +
    `${input.customerName}様、お電話番号は${spokenPhone(input.phone)}でお間違いないでしょうか？`
  )
}

/** The draft as the API wants it, or undefined while something required is missing. */
export function toReservationCreate(
  draft: StaffBookingDraft,
  recital: string,
): StaffReservationCreate | undefined {
  const { date, startTime, purposeIds, customer } = draft
  if (!date || !startTime || purposeIds.length === 0) return undefined
  if (!customer.name.trim() || !customer.kana.trim() || !customer.phone.trim()) return undefined
  return {
    date,
    startTime,
    purposeIds,
    customer: {
      name: customer.name.trim(),
      kana: customer.kana.trim(),
      phone: customer.phone.trim(),
      ...(customer.email?.trim() ? { email: customer.email.trim() } : {}),
    },
    recital,
    ...(draft.reservationMemo.trim() ? { reservationMemo: draft.reservationMemo.trim() } : {}),
    ...(draft.handoffNote.trim() ? { handoffNote: draft.handoffNote.trim() } : {}),
  }
}
