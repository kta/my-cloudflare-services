import type { AvailabilitySlot, AvailabilityStoreSettings } from '@app/contracts'
import { describe, expect, it, test } from 'vitest'
import {
  bookingBarSubtitle,
  createStaffBookingDraft,
  desiredTimes,
  hasUnsavedBookingInput,
  japaneseDayLabel,
  nearestAlternatives,
  receivableDates,
  recitalSentence,
  STAFF_BOOKING_STEPS,
  type StaffBookingAction,
  type StaffBookingDraft,
  spokenPhone,
  staffBookingReducer,
  stepPosition,
  totalDurationMinutes,
} from './staff-booking'

const purpose = (overrides: Partial<AvailabilityStoreSettings['purposes'][number]> = {}) => ({
  id: '0b4b58a5-0ea8-4ad8-8dc5-44f3db3f67d1',
  staffName: '視力測定・新調相談',
  customerLabel: 'メガネを新しく作りたい',
  durationMinutes: 60,
  slotIntervalMinutes: 30,
  isPublic: true,
  requiredSkills: ['眼鏡作製技能'],
  requiredEquipment: ['視力測定機'],
  maxConcurrent: 1,
  ...overrides,
})

const settings = (
  overrides: Partial<AvailabilityStoreSettings> = {},
): AvailabilityStoreSettings => ({
  storeId: '11111111-1111-4111-8111-111111111111',
  version: 1,
  receptionStatus: 'open',
  desiredTimeCandidateCount: 6,
  // Sunday (0) is closed; every other weekday opens 10:00-12:00.
  businessHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    periods: dayOfWeek === 0 ? [] : [{ startTime: '10:00', endTime: '12:00' }],
  })),
  exceptions: [],
  purposes: [purpose()],
  staff: [],
  shifts: [],
  equipment: [],
  maintenance: [],
  ...overrides,
})

const slot = (date: string, startTime: string, endTime: string): AvailabilitySlot => ({
  date,
  startTime,
  endTime,
  startAt: `${date}T${startTime}:00.000Z`,
  endAt: `${date}T${endTime}:00.000Z`,
})

const filled = (): StaffBookingDraft => {
  let draft = staffBookingReducer(createStaffBookingDraft(), {
    type: 'date_selected',
    date: '2026-08-27',
  })
  draft = staffBookingReducer(draft, { type: 'time_selected', startTime: '10:30' })
  draft = staffBookingReducer(draft, { type: 'purposes_changed', purposeIds: [purpose().id] })
  draft = staffBookingReducer(draft, { type: 'availability_confirmed' })
  draft = staffBookingReducer(draft, {
    type: 'customer_changed',
    customer: { name: '田中 花子', kana: 'タナカ ハナコ', phone: '090-1234-5678' },
  })
  draft = staffBookingReducer(draft, {
    type: 'notes_changed',
    notes: { reservationMemo: 'PC作業用', handoffNote: '度数変更の説明を段階的に' },
  })
  return staffBookingReducer(draft, { type: 'customer_confirmed' })
}

// UC-EYEX-009 / AC-EYEX-01 / AC-EYEX-02: the five steps and their spoken headings are fixed.
describe('the fixed five-step order', () => {
  test('runs 日 → 時間 → 来店目的 → お客様情報 → 復唱する with a spoken prompt on every step', () => {
    expect(STAFF_BOOKING_STEPS.map((entry) => entry.step)).toEqual([
      'date',
      'time',
      'purpose',
      'customer',
      'recital',
    ])
    expect(STAFF_BOOKING_STEPS.map((entry) => entry.label)).toEqual([
      '日',
      '時間',
      '来店目的',
      'お客様情報',
      '復唱する',
    ])
    expect(STAFF_BOOKING_STEPS.map((entry) => entry.prompt)).toEqual([
      'ご来店予定の日を伺えますか？',
      'ご来店予定の時刻を伺えますか？',
      '今回のご来店目的を伺えますか？',
      'お電話番号を伺えますか？',
      '次の内容を、お客様へそのままお伝えください',
    ])
  })

  test('starts on the day step and advances one step at a time', () => {
    const start = createStaffBookingDraft()
    expect(start.step).toBe('date')
    expect(stepPosition('date')).toBe(1)
    expect(stepPosition('recital')).toBe(5)

    const afterDate = staffBookingReducer(start, { type: 'date_selected', date: '2026-08-27' })
    expect(afterDate).toMatchObject({ step: 'time', date: '2026-08-27' })
    const afterTime = staffBookingReducer(afterDate, { type: 'time_selected', startTime: '10:30' })
    expect(afterTime).toMatchObject({ step: 'purpose', startTime: '10:30' })
  })
})

// UC-EYEX-011: going back never loses what has already been entered.
describe('going back', () => {
  test('walks back through every step keeping date, time, purposes, customer and notes', () => {
    let draft = filled()
    expect(draft.step).toBe('recital')
    for (const expected of ['customer', 'purpose', 'time', 'date']) {
      draft = staffBookingReducer(draft, { type: 'back' })
      expect(draft.step).toBe(expected)
    }
    expect(draft).toMatchObject({
      date: '2026-08-27',
      startTime: '10:30',
      purposeIds: [purpose().id],
      customer: { name: '田中 花子', kana: 'タナカ ハナコ', phone: '090-1234-5678' },
      reservationMemo: 'PC作業用',
      handoffNote: '度数変更の説明を段階的に',
    })
    expect(staffBookingReducer(draft, { type: 'back' }).step).toBe('date')
  })

  test('keeps the chosen time when the same day is re-picked and clears it for another day', () => {
    const draft = filled()
    expect(staffBookingReducer(draft, { type: 'date_selected', date: '2026-08-27' })).toMatchObject(
      {
        step: 'time',
        startTime: '10:30',
      },
    )
    const moved = staffBookingReducer(draft, { type: 'date_selected', date: '2026-08-28' })
    expect(moved.startTime).toBeUndefined()
    expect(moved.purposeIds).toEqual([purpose().id])
    expect(moved.customer.name).toBe('田中 花子')
  })
})

// UC-EYEX-012: only today and later receivable days are selectable.
describe('receivable days', () => {
  test('starts at today, never before it, and drops closed weekdays', () => {
    const dates = receivableDates(settings(), '2026-08-27', 7)
    expect(dates[0]).toBe('2026-08-27')
    expect(dates.every((date) => date >= '2026-08-27')).toBe(true)
    // 2026-08-30 is a Sunday and the store has no Sunday hours.
    expect(dates).not.toContain('2026-08-30')
    expect(dates).toContain('2026-09-02')
  })

  test('honours exceptions and a paused reception', () => {
    const withExceptions = settings({
      exceptions: [
        { date: '2026-08-28', mode: 'closed', periods: [] },
        { date: '2026-08-29', mode: 'paused', periods: [] },
        { date: '2026-08-30', mode: 'open', periods: [{ startTime: '13:00', endTime: '17:00' }] },
      ],
    })
    const dates = receivableDates(withExceptions, '2026-08-27', 7)
    expect(dates).not.toContain('2026-08-28')
    expect(dates).not.toContain('2026-08-29')
    expect(dates).toContain('2026-08-30')
    expect(receivableDates(settings({ receptionStatus: 'paused' }), '2026-08-27', 7)).toEqual([])
  })

  test('labels a day the way staff say it', () => {
    expect(japaneseDayLabel('2026-08-27')).toBe('8月27日（木）')
    expect(japaneseDayLabel('2026-08-30')).toBe('8月30日（日）')
  })
})

// UC-EYEX-013: the time step offers the customer's desired time, not a held resource.
describe('desired times', () => {
  test('lays a fixed grid over the opening periods and never offers the closing time', () => {
    expect(desiredTimes(settings(), '2026-08-28', 30)).toEqual(['10:00', '10:30', '11:00', '11:30'])
    expect(desiredTimes(settings(), '2026-08-30', 30)).toEqual([])
  })

  // 電話口で読み上げられる長さに絞る（承認済みモック BOOK-TIME は 6 件・2 行）。
  test('shortlists a full trading day to the store\u2019s candidate count, spread over the day', () => {
    const allDay = settings({
      businessHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        periods: [{ startTime: '10:00', endTime: '19:00' }],
      })),
    })
    const times = desiredTimes(allDay, '2026-08-28', 30)
    expect(times).toHaveLength(6)
    // 営業開始と最終受付は必ず残る。午前だけ・午後だけに偏らない。
    expect(times[0]).toBe('10:00')
    expect(times.at(-1)).toBe('18:30')
    expect(times.some((time) => time >= '13:00')).toBe(true)
  })

  test('honours a store that wants a different number of candidates', () => {
    const allDay = settings({
      desiredTimeCandidateCount: 3,
      businessHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        periods: [{ startTime: '10:00', endTime: '19:00' }],
      })),
    })
    expect(desiredTimes(allDay, '2026-08-28', 30)).toEqual(['10:00', '14:30', '18:30'])
  })

  test('uses an exceptional opening when the day has one', () => {
    const withException = settings({
      exceptions: [
        { date: '2026-08-30', mode: 'open', periods: [{ startTime: '13:00', endTime: '14:00' }] },
      ],
    })
    expect(desiredTimes(withException, '2026-08-30', 30)).toEqual(['13:00', '13:30'])
  })
})

// UC-EYEX-015: several purposes, one combined duration.
describe('purposes', () => {
  test('adds the durations of every selected purpose and ignores unknown ids', () => {
    const first = purpose({ id: '11111111-1111-4111-8111-111111111111', durationMinutes: 60 })
    const second = purpose({ id: '22222222-2222-4222-8222-222222222222', durationMinutes: 20 })
    const purposes = [first, second]
    expect(totalDurationMinutes(purposes, [first.id, second.id])).toBe(80)
    expect(totalDurationMinutes(purposes, ['33333333-3333-4333-8333-333333333333'])).toBe(0)
  })
})

// UC-EYEX-013 / 014 / 019, AC-EYEX-08 / 88: a lost slot keeps every input and offers alternatives.
describe('re-validation after the purpose step', () => {
  test('keeps the whole draft on the purpose step and stores same-store alternatives', () => {
    let draft = staffBookingReducer(createStaffBookingDraft(), {
      type: 'date_selected',
      date: '2026-08-27',
    })
    draft = staffBookingReducer(draft, { type: 'time_selected', startTime: '10:30' })
    draft = staffBookingReducer(draft, { type: 'purposes_changed', purposeIds: [purpose().id] })
    const alternatives = [slot('2026-08-27', '11:00', '12:00')]
    const rejected = staffBookingReducer(draft, { type: 'availability_rejected', alternatives })
    expect(rejected).toMatchObject({
      step: 'purpose',
      date: '2026-08-27',
      startTime: '10:30',
      purposeIds: [purpose().id],
      error: 'slot_unavailable',
      alternatives,
    })

    const recovered = staffBookingReducer(rejected, {
      type: 'alternative_selected',
      startTime: '11:00',
    })
    expect(recovered).toMatchObject({ step: 'purpose', startTime: '11:00', alternatives: [] })
    expect(recovered.error).toBeUndefined()
  })

  test('offers the alternatives closest to the desired time, in clock order', () => {
    const slots = [
      slot('2026-08-27', '10:00', '11:00'),
      slot('2026-08-27', '11:00', '12:00'),
      slot('2026-08-27', '13:30', '14:30'),
      slot('2026-08-27', '17:00', '18:00'),
    ]
    expect(nearestAlternatives(slots, '10:30', 3).map((entry) => entry.startTime)).toEqual([
      '10:00',
      '11:00',
      '13:30',
    ])
  })

  test('a conflict at confirmation time returns to the purpose step with everything intact', () => {
    const draft = staffBookingReducer(filled(), { type: 'submit_started', idempotencyKey: 'key-1' })
    const alternatives = [slot('2026-08-27', '11:00', '12:00')]
    const conflicted = staffBookingReducer(draft, { type: 'submit_conflicted', alternatives })
    expect(conflicted).toMatchObject({
      step: 'purpose',
      error: 'slot_unavailable',
      alternatives,
      submitting: false,
      customer: { name: '田中 花子' },
      reservationMemo: 'PC作業用',
    })
  })
})

// UC-EYEX-016: reservation memo and in-store handoff note stay separate.
describe('notes', () => {
  test('records the reservation memo and the handoff note in separate fields', () => {
    const draft = staffBookingReducer(filled(), {
      type: 'notes_changed',
      notes: { handoffNote: '担当は佐藤' },
    })
    expect(draft.reservationMemo).toBe('PC作業用')
    expect(draft.handoffNote).toBe('担当は佐藤')
  })
})

// UC-EYEX-017: discarding asks first.
describe('discarding', () => {
  test('asks before discarding, keeps everything when cancelled and resets when confirmed', () => {
    const asked = staffBookingReducer(filled(), { type: 'discard_requested' })
    expect(asked.confirmingDiscard).toBe(true)
    expect(asked.customer.name).toBe('田中 花子')

    const cancelled = staffBookingReducer(asked, { type: 'discard_cancelled' })
    expect(cancelled.confirmingDiscard).toBe(false)
    expect(cancelled).toMatchObject({ step: 'recital', date: '2026-08-27' })

    expect(staffBookingReducer(asked, { type: 'discard_confirmed' })).toEqual(
      createStaffBookingDraft(),
    )
  })
})

// UC-EYEX-018 / 174, AC-EYEX-111: a failed send keeps the input and reuses the same key.
describe('sending', () => {
  test('mints one idempotency key and reuses it for every retry', () => {
    const first = staffBookingReducer(filled(), { type: 'submit_started', idempotencyKey: 'key-1' })
    expect(first).toMatchObject({ idempotencyKey: 'key-1', submitting: true })
    const failed = staffBookingReducer(first, { type: 'submit_failed', error: 'network' })
    expect(failed).toMatchObject({
      step: 'recital',
      error: 'network',
      submitting: false,
      idempotencyKey: 'key-1',
      customer: { name: '田中 花子', phone: '090-1234-5678' },
    })
    const retried = staffBookingReducer(failed, { type: 'submit_started', idempotencyKey: 'key-2' })
    expect(retried.idempotencyKey).toBe('key-1')
  })

  test('moves to the completed state with the created reservation', () => {
    const sent = staffBookingReducer(filled(), { type: 'submit_started', idempotencyKey: 'key-1' })
    const done = staffBookingReducer(sent, {
      type: 'submit_succeeded',
      reservationNumber: 'R-0001',
    })
    expect(done).toMatchObject({ step: 'complete', reservationNumber: 'R-0001', submitting: false })
    expect(done.error).toBeUndefined()
  })
})

// UC-EYEX-020 / AC-EYEX-06: one complete natural-language sentence.
describe('the recital sentence', () => {
  test('names the date, weekday, time, store, purposes, duration, customer and phone', () => {
    expect(
      recitalSentence({
        date: '2026-08-27',
        startTime: '11:00',
        storeName: '銀座店',
        purposeNames: ['視力測定', 'メガネの新調相談'],
        durationMinutes: 60,
        customerName: '田中 花子',
        phone: '090-1234-5678',
      }),
    ).toBe(
      '8月27日、木曜日の午前11時に、EYEX予約 銀座店で、視力測定とメガネの新調相談を承りました。所要時間は約60分です。田中 花子様、お電話番号は090-1234-5678でお間違いないでしょうか？',
    )
  })

  test('reads afternoon times in 午後 and keeps the minutes when they are not on the hour', () => {
    expect(
      recitalSentence({
        date: '2026-08-30',
        startTime: '13:30',
        storeName: '銀座店',
        purposeNames: ['調整'],
        durationMinutes: 20,
        customerName: '山田 太郎',
        phone: '03-1111-2222',
      }),
    ).toBe(
      '8月30日、日曜日の午後1時30分に、EYEX予約 銀座店で、調整を承りました。所要時間は約20分です。山田 太郎様、お電話番号は03-1111-2222でお間違いないでしょうか？',
    )
  })

  // 復唱は耳で確かめる工程なので、伺ったままの 11 桁は読み違えの元になる。
  test('reads an unpunctuated phone number back in spoken groups', () => {
    expect(
      recitalSentence({
        date: '2026-08-27',
        startTime: '11:00',
        storeName: '銀座店',
        purposeNames: ['調整'],
        durationMinutes: 20,
        customerName: '田中 花子',
        phone: '09012345678',
      }),
    ).toContain('お電話番号は090-1234-5678で')
  })
})

describe('the spoken phone number', () => {
  test.each([
    ['09012345678', '090-1234-5678'],
    ['0312345678', '03-1234-5678'],
    ['0612345678', '06-1234-5678'],
    ['0451234567', '045-123-4567'],
    ['090-1234-5678', '090-1234-5678'],
    ['', ''],
  ])('formats %s as %s', (input: string, expected: string) => {
    expect(spokenPhone(input)).toBe(expected)
  })
})

describe('unsaved booking input', () => {
  it('reports a fresh draft as having nothing to lose', () => {
    expect(hasUnsavedBookingInput(createStaffBookingDraft())).toBe(false)
  })

  it.each([
    ['a chosen day', { type: 'date_selected', date: '2026-09-01' } as const],
    ['typed notes', { type: 'notes_changed', notes: { reservationMemo: '常連' } } as const],
  ] as const)('reports %s as unsaved input', (_label: string, action: StaffBookingAction) => {
    // A store switch must interrupt only when something would actually be lost
    // (UC-EYEX-065, AC-EYEX-29); warning on an untouched form trains operators
    // to dismiss the warning that matters.
    expect(hasUnsavedBookingInput(staffBookingReducer(createStaffBookingDraft(), action))).toBe(
      true,
    )
  })

  it('reports a customer name as unsaved input', () => {
    const draft = staffBookingReducer(createStaffBookingDraft(), {
      type: 'customer_changed',
      customer: { name: '田中 花子' },
    })
    expect(hasUnsavedBookingInput(draft)).toBe(true)
  })

  it('reports a completed booking as having nothing left to lose', () => {
    const entered = staffBookingReducer(createStaffBookingDraft(), {
      type: 'date_selected',
      date: '2026-09-01',
    })
    const done = staffBookingReducer(entered, {
      type: 'submit_succeeded',
      reservationNumber: 'EY-0001',
    })
    expect(hasUnsavedBookingInput(done)).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * バーの副題（承認済みモック BOOK-REPEAT / EX-UPLOAD-FAILED）
 * ------------------------------------------------------------------ */

test('復唱の面のバーは店舗名と最終確認を名乗る', () => {
  expect(bookingBarSubtitle('recital', '銀座店', undefined)).toBe('銀座店 · 最終確認')
})

test('成立後のバーは確認ではなく取れた予約番号を名乗る', () => {
  // モック EX-UPLOAD-FAILED の副題は `銀座店 · 予約 EY-0828-1142`。成立した後も
  // `最終確認` のままだと、まだ確定していない面に見える。
  expect(bookingBarSubtitle('complete', '銀座店', 'EY-0828-1142')).toBe(
    '銀座店 · 予約 EY-0828-1142',
  )
})

test('成立したのに予約番号が届いていないときは番号を騙らない', () => {
  expect(bookingBarSubtitle('complete', '銀座店', undefined)).toBe('銀座店 · 最終確認')
})

test('入力途中の面はバーに副題を持たない（チップが日時を名乗る）', () => {
  expect(bookingBarSubtitle('time', '銀座店', undefined)).toBeUndefined()
})
