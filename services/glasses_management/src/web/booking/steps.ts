import { ReceptionSessionDraft } from '@app/contracts'

/*
 * 受付の 5 工程の目次と、器（BookingScreen）と工程（*Step）のあいだの約束。
 *
 * 承認済みモック docs/frontend/mockups/eyex/images/BOOK-01-DATETIME.png ほか 12 面の
 * 下端の帯（`.stepbar`）が「1 日時 › 2 ご来店の目的 › 3 担当と場所 › 4 お客様 › 5 ご確認」を
 * 常に同じ順で持つ。番号は帯が付けるので、ここには名前だけを置く。
 *
 * 「次へ」（`.fab`）が押せる条件は、モックの `.fab` の `disabled` がそのまま状態機械である
 * （`design/05-screen-flow.md` §5.1）。押せないときは**必ず理由を持つ** —— 理由なしの
 * `disabled` を置かないという決め（§7.6）に、モックが理由を落としている 4 画面も揃える。
 */

export type BookingStepKey = 'datetime' | 'purpose' | 'slot' | 'customer' | 'confirm'

export type BookingStep = {
  key: BookingStepKey
  /** 工程の帯に出す名前。 */
  label: string
}

export const BOOKING_STEPS: readonly BookingStep[] = [
  { key: 'datetime', label: '日時' },
  { key: 'purpose', label: 'ご来店の目的' },
  { key: 'slot', label: '担当と場所' },
  { key: 'customer', label: 'お客様' },
  { key: 'confirm', label: 'ご確認' },
]

/**
 * 「次へ進む」の可否。押せないときの `blockedReason` は読み上げの名前に入るので、
 * 「〜すると進めます」の型で書く（`aria-label="次へ進む　お客様が決まると進めます"`）。
 */
export type StepGuard = {
  canProceed: boolean
  blockedReason: string
}

/** 何も伺っていない下書き。契約の既定値がそのまま空の形になる。 */
export function emptyDraft(): ReceptionSessionDraft {
  return ReceptionSessionDraft.parse({})
}

export function stepIndex(key: BookingStepKey): number {
  return BOOKING_STEPS.findIndex((step) => step.key === key)
}

export function previousStep(key: BookingStepKey): BookingStepKey | null {
  return BOOKING_STEPS[stepIndex(key) - 1]?.key ?? null
}

export function nextStep(key: BookingStepKey): BookingStepKey | null {
  return BOOKING_STEPS[stepIndex(key) + 1]?.key ?? null
}

/**
 * 受けかけの受付へ戻ったときの着地。`reception_sessions.draft_json` は
 * 「どの工程で止めたか」を持たないので、伺えている内容から導く。
 *
 * 担当（`staffId`）とお客様（`customerId`）は**未定のままでも成り立つ**ので、
 * 埋まっていないことを理由に工程 3 より先へ進めない（`design/05-screen-flow.md` §5.3 の
 * 「工程の途中へ黙って飛ばさない」）。
 */
export function stepFromDraft(draft: ReceptionSessionDraft): BookingStepKey {
  if (draft.startsAt === null) return 'datetime'
  if (draft.purposeIds.length === 0) return 'purpose'
  return 'slot'
}

/** 「次へ」の読み上げの名前。押せないときは理由を必ず添える。 */
export function nextButtonLabel(guard: StepGuard): string {
  return guard.canProceed ? '次へ進む' : `次へ進む　${guard.blockedReason}`
}

/** 「‹」の読み上げの名前。最初の工程では戻り先が無いので、そのことを名前に持つ。 */
export function backButtonLabel(key: BookingStepKey): string {
  return previousStep(key) === null ? '前へ戻る　最初の工程です' : '前へ戻る'
}
