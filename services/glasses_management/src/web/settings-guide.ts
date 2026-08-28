/**
 * The step model behind the EYEX store settings guide.
 *
 * Pure on purpose: the order of the six steps, what makes a step 完了, and the
 * SP stepper summary are the parts that are only wrong at the edges, so they
 * are derived here and unit-tested directly rather than asserted through the
 * DOM. Nothing here reads the clock, the network or storage.
 */

import type {
  AvailabilityBusinessHours,
  AvailabilityPurpose,
  SettingsImpactReport,
} from '@app/contracts'

export type SettingsStepId =
  | 'store-hours'
  | 'purposes'
  | 'staff-skills'
  | 'equipment'
  | 'web-booking'
  | 'impact'

export type SettingsStep = {
  id: SettingsStepId
  /** 1-based position in the guide. */
  number: number
  /** Full name, used at every width. */
  label: string
  /** Name under the SP rail circle. Never an abbreviation of `Web予約` (AC-EYEX-74). */
  shortLabel: string
  /** One line of guidance shown with the step heading. */
  description: string
}

/**
 * The guide order fixed by AC-EYEX-40: 店舗と営業時間 → 来店目的 → スタッフと技能
 * → 設備と点検 → Web予約 → 影響確認と公開.
 */
export const SETTINGS_STEPS: readonly SettingsStep[] = [
  {
    id: 'store-hours',
    number: 1,
    label: '店舗と営業時間',
    shortLabel: '店舗',
    description: '通常営業時間、休業日、臨時営業、受付停止を設定します。',
  },
  {
    id: 'purposes',
    number: 2,
    label: '来店目的',
    shortLabel: '目的',
    description: 'スタッフ向け名称と顧客向け文言、所要時間、必要技能と設備を設定します。',
  },
  {
    id: 'staff-skills',
    number: 3,
    label: 'スタッフと技能',
    shortLabel: 'スタッフ',
    description: 'スタッフの技能、勤務、休憩、予約受付可否を設定します。',
  },
  {
    id: 'equipment',
    number: 4,
    label: '設備と点検',
    shortLabel: '設備',
    description: '設備の台数、利用可能時間、点検停止を設定します。',
  },
  {
    id: 'web-booking',
    number: 5,
    // `Web` に略さない。SP 幅でも同じ名称を出す（AC-EYEX-74）。
    label: 'Web予約',
    shortLabel: 'Web予約',
    description: '公開状態、公開期間、公開する来店目的、受付条件を設定します。',
  },
  {
    id: 'impact',
    number: 6,
    label: '影響確認と公開',
    shortLabel: '確認',
    description: '保存前に既存予約への影響を確認して公開します。',
  },
]

/** The same six steps, addressable by id without an index-out-of-range dance. */
export const SETTINGS_STEP_BY_ID: Record<SettingsStepId, SettingsStep> = Object.fromEntries(
  SETTINGS_STEPS.map((step) => [step.id, step]),
) as Record<SettingsStepId, SettingsStep>

export type StepState = 'complete' | 'editing' | 'incomplete'

/** 状態は語で伝える。色だけに依存しない（AC-EYEX-41, 73）。 */
export const STEP_STATE_LABEL: Record<StepState, string> = {
  complete: '完了',
  editing: '編集中',
  incomplete: '未完了',
}

/**
 * Only what step completion depends on — deliberately structural, so this
 * module never has to be updated when an unrelated settings field appears.
 */
export type StepStateSource = {
  businessHours: readonly { dayOfWeek?: number; periods: readonly unknown[] }[]
  purposes: readonly unknown[]
  staff: readonly unknown[]
  equipment: readonly unknown[]
}

export function deriveStepStates(input: {
  current: SettingsStepId
  settings?: StepStateSource
  /** Whether the Web 予約公開設定 has been configured. Undefined while its API is 未取得. */
  webBookingConfigured?: boolean
}): Record<SettingsStepId, StepState> {
  const settings = input.settings
  const complete = (done: boolean): StepState => (done ? 'complete' : 'incomplete')
  const states: Record<SettingsStepId, StepState> = {
    'store-hours': complete((settings?.businessHours ?? []).some((day) => day.periods.length > 0)),
    purposes: complete((settings?.purposes.length ?? 0) > 0),
    'staff-skills': complete((settings?.staff.length ?? 0) > 0),
    equipment: complete((settings?.equipment.length ?? 0) > 0),
    'web-booking': complete(input.webBookingConfigured === true),
    // 影響確認は下書き・影響確認 API が未提供のため、完了と主張しない。
    impact: 'incomplete',
  }
  states[input.current] = 'editing'
  return states
}

export type StepperSummary = {
  number: number
  total: number
  remaining: number
  label: string
  state: StepState
  stateLabel: string
  headline: string
  remainingLabel: string
}

/**
 * What the pinned SP rail must say without colour: 現在工程番号 / 全6工程 /
 * 残り工程数 / 状態（AC-EYEX-73）.
 */
export function stepperSummary(
  states: Record<SettingsStepId, StepState>,
  current: SettingsStepId,
): StepperSummary {
  const step = SETTINGS_STEP_BY_ID[current]
  const total = SETTINGS_STEPS.length
  const state = states[step.id]
  return {
    number: step.number,
    total,
    remaining: total - step.number,
    label: step.label,
    state,
    stateLabel: STEP_STATE_LABEL[state],
    headline: `${step.number} / ${total} ${step.label}`,
    remainingLabel: `残り${total - step.number}工程`,
  }
}

/** A template purpose: a contract purpose before the store gives it an id. */
export type PurposeTemplate = Omit<AvailabilityPurpose, 'id'>

/**
 * 新規店舗へ提示する標準の来店目的テンプレート（UC-EYEX-117, AC-EYEX-68）.
 *
 * 顧客向け文言はスタッフ向け名称と別に持つ（UC-EYEX-118）。値は初期値であって
 * 強制ではない — 店舗はそのまま採用しても、保存前に上書きしてもよい。
 */
export const DEFAULT_PURPOSE_TEMPLATE: readonly PurposeTemplate[] = [
  {
    staffName: '視力測定・新調相談',
    customerLabel: 'メガネを新しく作りたい',
    durationMinutes: 60,
    slotIntervalMinutes: 15,
    isPublic: true,
    requiredSkills: ['眼鏡作製技能'],
    requiredEquipment: ['視力測定機', '相談席'],
    maxConcurrent: 1,
  },
  {
    staffName: 'フィッティング調整',
    customerLabel: 'かけ心地を調整したい',
    durationMinutes: 20,
    slotIntervalMinutes: 10,
    isPublic: true,
    requiredSkills: ['調整'],
    requiredEquipment: ['調整台'],
    maxConcurrent: 2,
  },
  {
    staffName: '修理・部品交換受付',
    customerLabel: '修理を相談したい',
    durationMinutes: 30,
    slotIntervalMinutes: 15,
    isPublic: true,
    requiredSkills: ['修理受付'],
    requiredEquipment: ['調整台'],
    maxConcurrent: 1,
  },
  {
    staffName: 'コンタクトレンズ相談',
    customerLabel: 'コンタクトレンズを相談したい',
    durationMinutes: 45,
    slotIntervalMinutes: 15,
    isPublic: false,
    requiredSkills: ['コンタクト販売'],
    requiredEquipment: ['相談席'],
    maxConcurrent: 1,
  },
]

/** 標準の週間営業時間。0=日曜。火曜を定休日とする初期値。 */
export const DEFAULT_BUSINESS_HOURS: readonly AvailabilityBusinessHours[] = [
  { dayOfWeek: 0, periods: [{ startTime: '10:00', endTime: '18:00' }] },
  { dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] },
  { dayOfWeek: 2, periods: [] },
  { dayOfWeek: 3, periods: [{ startTime: '10:00', endTime: '19:00' }] },
  { dayOfWeek: 4, periods: [{ startTime: '10:00', endTime: '19:00' }] },
  { dayOfWeek: 5, periods: [{ startTime: '10:00', endTime: '19:00' }] },
  { dayOfWeek: 6, periods: [{ startTime: '10:00', endTime: '19:00' }] },
]

export const WEEKDAY_LABEL = ['日', '月', '火', '水', '木', '金', '土'] as const

/* ------------------------------------------------------------------ *
 * 承認済みモックの要約カード（SETTINGS-STORE-HOURS ほか）
 * ------------------------------------------------------------------ */

/** 日本語の週は月曜はじまり。承認済みモックの `月–土` はこの並びで読む。 */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

export type BusinessHoursSummary = {
  /** `月–土 10:00–19:00` の並び。時間帯ごとに 1 行。 */
  openLines: string[]
  /** `毎週火曜日`。休業曜日が無ければ `設定なし`。 */
  closedLabel: string
}

/**
 * 週間営業時間を、モックの `.field` 2 枚（通常営業時間 / 休業日）に読める形へ。
 *
 * 休業曜日は連続の判定で「透明」に扱う。火曜が定休でも 月–土 と読ませたいのは、
 * 営業する曜日の並びが人の頭の中では途切れないからで、ここで区切ると
 * `月 / 水–土` という誰も口にしない表現になる（承認済みモックが根拠）。
 */
export function summariseBusinessHours(
  businessHours: readonly {
    dayOfWeek: number
    periods: readonly { startTime: string; endTime: string }[]
  }[],
): BusinessHoursSummary {
  const rangeOf = (day: number): string | undefined => {
    const period = businessHours.find((entry) => entry.dayOfWeek === day)?.periods[0]
    return period ? `${period.startTime}–${period.endTime}` : undefined
  }

  const ranges: string[] = []
  for (const day of WEEK_ORDER) {
    const range = rangeOf(day)
    if (range !== undefined && !ranges.includes(range)) ranges.push(range)
  }

  const openLines = ranges.map((range) => {
    const runs: number[][] = []
    let run: number[] = []
    for (const [position, day] of WEEK_ORDER.entries()) {
      const dayRange = rangeOf(day)
      if (dayRange === range) {
        run.push(position)
        continue
      }
      // 休業日は連続を切らない。別の時間帯の営業日だけが区切りになる。
      if (dayRange !== undefined && run.length > 0) {
        runs.push(run)
        run = []
      }
    }
    if (run.length > 0) runs.push(run)
    const label = runs
      .map((positions) => {
        const first = WEEKDAY_LABEL[WEEK_ORDER[positions[0] as number] as number]
        const last = WEEKDAY_LABEL[WEEK_ORDER[positions[positions.length - 1] as number] as number]
        return positions.length === 1 ? first : `${first}–${last}`
      })
      .join('・')
    return `${label} ${range}`
  })

  const closed = WEEK_ORDER.filter((day) => rangeOf(day) === undefined).map(
    (day) => `${WEEKDAY_LABEL[day]}曜日`,
  )
  return {
    openLines,
    closedLabel: closed.length === 0 ? '設定なし' : `毎週${closed.join('・')}`,
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `2026-09-23` → `9月23日`。JST の日付文字列なので時計も時差も要らない。 */
export function formatJapaneseDate(date: string): string {
  const match = ISO_DATE.exec(date)
  if (!match) return date
  return `${Number(match[2])}月${Number(match[3])}日`
}

/** `2026-09-10` → `9/10`。設備の点検停止など、行に収めたいときの表記。 */
export function formatSlashDate(date: string): string {
  const match = ISO_DATE.exec(date)
  if (!match) return date
  return `${Number(match[2])}/${Number(match[3])}`
}

/* ------------------------------------------------------------------ *
 * 工程ごとの「影響」（承認済みモックの `.preview` / `.preview.warning`）
 * ------------------------------------------------------------------ */

/**
 * 工程の下に続く影響の面。
 *
 * なぜ工程ごとに出すのか: モックは工程 1・3・4 に `.preview` を置いている。
 * 影響を工程 6 まで見せないと、5 工程ぶん編集したあとで初めて「公開できない」
 * と知ることになり、どの編集が原因かを辿り直すはめになる。
 *
 * 報告が無いあいだは何も出さない。影響の有無は推測できるものではなく、
 * 「たぶん無い」を白い面で断言すると、あるものを無いと読ませる。
 */
export type StepImpact = {
  /** 面の名前。太字の 1 行目にもなる（モックの `<b>`）。 */
  label: string
  body: string
  tone: 'plain' | 'caution'
}

export function stepImpact(
  step: SettingsStepId,
  report: SettingsImpactReport | undefined,
): StepImpact | undefined {
  if (report === undefined) return undefined
  if (step === 'store-hours')
    return {
      label: '影響',
      body: `公開中のWeb枠${String(report.publicSlots.publishedCount)}件を再確認します。`,
      tone: 'plain',
    }
  if (step === 'staff-skills') {
    const messages = report.items
      .filter((item) => item.kind === 'missing_staff_skill')
      .map((item) => item.message)
    if (messages.length === 0) return undefined
    return { label: '影響', body: messages.join('　'), tone: 'caution' }
  }
  if (step === 'equipment') {
    /* 設備の工程で見せるのは「代わりを当てるか連絡するか」を決める件数だけ。 */
    const blocking = report.items.filter(
      (item) => item.severity === 'blocking' && item.resolution === null,
    ).length
    if (blocking === 0) return undefined
    return {
      label: `影響予約 ${String(blocking)}件`,
      body: '代替設備の割当または顧客連絡が必要です。',
      tone: 'caution',
    }
  }
  return undefined
}

/**
 * 工程の見出しの右端（モックの `.title .push`）に出る「下書き保存 14:32」。
 *
 * 日付ではなく時刻だけを出す。この面は「いま編集しているものが、いつ保存
 * されたか」を確かめるためのもので、モックもそう書いている。保存が一度も
 * 無いあいだは何も言わない（`未保存` は状態の面が持つ語で、ここには無い）。
 */
export function draftSavedAtLabel(savedAt: string | undefined): string | undefined {
  if (savedAt === undefined) return undefined
  const at = new Date(savedAt)
  if (Number.isNaN(at.getTime())) return undefined
  const jst = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at)
  return `下書き保存 ${jst}`
}
