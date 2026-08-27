import { AvailabilityPurpose } from '@app/contracts'
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_PURPOSE_TEMPLATE,
  deriveStepStates,
  formatJapaneseDate,
  formatSlashDate,
  SETTINGS_STEP_BY_ID,
  SETTINGS_STEPS,
  type SettingsStepId,
  STEP_STATE_LABEL,
  stepperSummary,
  summariseBusinessHours,
} from './settings-guide'

const EMPTY = {
  businessHours: [],
  purposes: [],
  staff: [],
  equipment: [],
} as const

describe('SETTINGS_STEPS (AC-EYEX-40, 74)', () => {
  test('is exactly the six steps in the guide order', () => {
    expect(SETTINGS_STEPS.map((step) => step.label)).toEqual([
      '店舗と営業時間',
      '来店目的',
      'スタッフと技能',
      '設備と点検',
      'Web予約',
      '影響確認と公開',
    ])
  })

  test('numbers the steps 1..6 with stable ids', () => {
    expect(SETTINGS_STEPS.map((step) => step.number)).toEqual([1, 2, 3, 4, 5, 6])
    expect(SETTINGS_STEPS.map((step) => step.id)).toEqual([
      'store-hours',
      'purposes',
      'staff-skills',
      'equipment',
      'web-booking',
      'impact',
    ])
  })

  test('never abbreviates the fifth step to `Web`, at any width (AC-EYEX-74)', () => {
    const web = SETTINGS_STEP_BY_ID['web-booking']
    expect(web.label).toBe('Web予約')
    expect(web.shortLabel).toBe('Web予約')
  })

  test('every step carries a short label for the SP rail', () => {
    expect(SETTINGS_STEPS.map((step) => step.shortLabel)).toEqual([
      '店舗',
      '目的',
      'スタッフ',
      '設備',
      'Web予約',
      '確認',
    ])
  })
})

describe('deriveStepStates (AC-EYEX-41)', () => {
  test('the current step is 編集中 even when its data is complete', () => {
    const states = deriveStepStates({
      current: 'store-hours',
      settings: {
        ...EMPTY,
        businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
      },
    })
    expect(states['store-hours']).toBe('editing')
  })

  test('a step with no data yet is 未完了', () => {
    const states = deriveStepStates({ current: 'store-hours', settings: EMPTY })
    expect(states.purposes).toBe('incomplete')
    expect(states['staff-skills']).toBe('incomplete')
    expect(states.equipment).toBe('incomplete')
  })

  test('a step whose data is present is 完了', () => {
    const states = deriveStepStates({
      current: 'impact',
      settings: {
        businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
        purposes: [{ id: 'p1' }],
        staff: [{ id: 's1' }],
        equipment: [{ id: 'e1' }],
      },
      webBookingConfigured: true,
    })
    expect(states['store-hours']).toBe('complete')
    expect(states.purposes).toBe('complete')
    expect(states['staff-skills']).toBe('complete')
    expect(states.equipment).toBe('complete')
    expect(states['web-booking']).toBe('complete')
  })

  test('a business-hours row with no period does not count as configured', () => {
    const states = deriveStepStates({
      current: 'purposes',
      settings: { ...EMPTY, businessHours: [{ dayOfWeek: 2, periods: [] }] },
    })
    expect(states['store-hours']).toBe('incomplete')
  })

  test('without settings every non-current step is 未完了', () => {
    const states = deriveStepStates({ current: 'purposes' })
    expect(states.purposes).toBe('editing')
    expect(states['store-hours']).toBe('incomplete')
  })

  test('影響確認と公開 is never 完了 while its API is 未取得', () => {
    const states = deriveStepStates({
      current: 'store-hours',
      settings: EMPTY,
      webBookingConfigured: true,
    })
    expect(states.impact).toBe('incomplete')
  })

  test('state labels never rely on colour', () => {
    expect(STEP_STATE_LABEL).toEqual({ complete: '完了', editing: '編集中', incomplete: '未完了' })
  })
})

describe('stepperSummary (AC-EYEX-72, 73)', () => {
  const states = {
    'store-hours': 'complete',
    purposes: 'complete',
    'staff-skills': 'complete',
    equipment: 'complete',
    'web-booking': 'editing',
    impact: 'incomplete',
  } as const

  test('reports current number, total, remaining and state without colour', () => {
    const summary = stepperSummary(states, 'web-booking')
    expect(summary).toEqual({
      number: 5,
      total: 6,
      remaining: 1,
      label: 'Web予約',
      state: 'editing',
      stateLabel: '編集中',
      headline: '5 / 6 Web予約',
      remainingLabel: '残り1工程',
    })
  })

  test('the first step has five steps remaining', () => {
    const summary = stepperSummary(states, 'store-hours')
    expect(summary.number).toBe(1)
    expect(summary.remaining).toBe(5)
    expect(summary.remainingLabel).toBe('残り5工程')
  })

  test('the last step has none remaining', () => {
    const summary = stepperSummary(states, 'impact')
    expect(summary.remaining).toBe(0)
    expect(summary.remainingLabel).toBe('残り0工程')
    expect(summary.headline).toBe('6 / 6 影響確認と公開')
  })

  test('every step id resolves to a summary', () => {
    for (const step of SETTINGS_STEPS) {
      const id: SettingsStepId = step.id
      expect(stepperSummary(states, id).number).toBe(step.number)
    }
  })
})

describe('DEFAULT_PURPOSE_TEMPLATE (UC-EYEX-117, AC-EYEX-68)', () => {
  test('offers standard purposes with 文言・所要時間・技能・設備・Web公開初期値', () => {
    expect(DEFAULT_PURPOSE_TEMPLATE.length).toBeGreaterThanOrEqual(3)
    for (const purpose of DEFAULT_PURPOSE_TEMPLATE) {
      expect(purpose.staffName.length).toBeGreaterThan(0)
      // 顧客向け文言は staff 向け名称と別（UC-EYEX-118）
      expect(purpose.customerLabel).not.toBe(purpose.staffName)
      expect(purpose.requiredSkills.length).toBeGreaterThan(0)
      expect(purpose.requiredEquipment.length).toBeGreaterThan(0)
      expect(typeof purpose.isPublic).toBe('boolean')
    }
  })

  test('every template entry is a valid contract purpose once given an id', () => {
    for (const purpose of DEFAULT_PURPOSE_TEMPLATE) {
      const parsed = AvailabilityPurpose.safeParse({
        id: '00000000-0000-4000-8000-000000000001',
        ...purpose,
      })
      expect(parsed.success).toBe(true)
    }
  })

  test('the default week opens every day except the regular closing day', () => {
    expect(DEFAULT_BUSINESS_HOURS).toHaveLength(7)
    expect(DEFAULT_BUSINESS_HOURS.filter((day) => day.periods.length === 0)).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ *
 * 承認済みモックの要約カード（SETTINGS-STORE-HOURS / EQUIPMENT）
 * ------------------------------------------------------------------ */

test('通常営業時間は同じ時間帯の曜日をまとめ、休業日は連続を切らない', () => {
  const summary = summariseBusinessHours([
    { dayOfWeek: 0, periods: [{ startTime: '10:00', endTime: '18:00' }] },
    { dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] },
    { dayOfWeek: 2, periods: [] },
    { dayOfWeek: 3, periods: [{ startTime: '10:00', endTime: '19:00' }] },
    { dayOfWeek: 4, periods: [{ startTime: '10:00', endTime: '19:00' }] },
    { dayOfWeek: 5, periods: [{ startTime: '10:00', endTime: '19:00' }] },
    { dayOfWeek: 6, periods: [{ startTime: '10:00', endTime: '19:00' }] },
  ])
  // 火曜が休業でも 月–土 は途切れない（承認済みモック SETTINGS-STORE-HOURS）。
  expect(summary.openLines).toEqual(['月–土 10:00–19:00', '日 10:00–18:00'])
  expect(summary.closedLabel).toBe('毎週火曜日')
})

test('週の登録が無ければ営業時間は書かず、全曜日を休業として述べる', () => {
  const summary = summariseBusinessHours([])
  expect(summary.openLines).toEqual([])
  expect(summary.closedLabel).toBe('毎週月曜日・火曜日・水曜日・木曜日・金曜日・土曜日・日曜日')
})

test('休業日が無ければ 設定なし と述べる（推測しない）', () => {
  const summary = summariseBusinessHours(
    [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      periods: [{ startTime: '10:00', endTime: '19:00' }],
    })),
  )
  expect(summary.openLines).toEqual(['月–日 10:00–19:00'])
  expect(summary.closedLabel).toBe('設定なし')
})

test('日付は用途ごとに 9月23日 と 9/10 を出し分ける', () => {
  expect(formatJapaneseDate('2026-09-23')).toBe('9月23日')
  expect(formatSlashDate('2026-09-10')).toBe('9/10')
  // 解釈できない値は推測せずそのまま返す。
  expect(formatJapaneseDate('unknown')).toBe('unknown')
  expect(formatSlashDate('unknown')).toBe('unknown')
})
