/*
 * お客様向けの 2 つの流れの目次と、進捗の帯の読み上げ。
 *
 * 承認済みモック docs/frontend/mockups/eyex/images/WEB-01-STORE.png 〜 WEB-06-DONE.png の
 * `.webprogress` は 6 本の細い帯で、`aria-label` に「全6ステップのうち1つ目です」を持つ。
 * WEB-CANCEL.png は同じ帯を 2 本にし、「2つの手順のうち2つ目です」と読ませる。
 *
 * **帯は押せない**（`role="img"`）。番号は帯が付けるので、ここには名前だけを置く
 * （業務側の `booking/steps.ts` と同じ決め）。
 */

export type PublicStepKey = 'store' | 'purpose' | 'datetime' | 'form' | 'confirm' | 'done'
export type ManageStepKey = 'lookup' | 'detail'

export type PublicStep<Key> = {
  key: Key
  /** 上のバーの副題に出る名前（「ステップ 3 / 6　日にちと時間」）。 */
  label: string
}

/** ご予約の 6 歩（WEB-01〜WEB-06）。 */
export const BOOKING_STEPS: readonly PublicStep<PublicStepKey>[] = [
  { key: 'store', label: '店舗' },
  { key: 'purpose', label: 'ご用件' },
  { key: 'datetime', label: '日にちと時間' },
  { key: 'form', label: 'お客様の情報' },
  { key: 'confirm', label: 'ご確認' },
  { key: 'done', label: '完了' },
]

/** ご予約を確かめ・変え・取り消す 2 手順（WEB-CANCEL）。 */
export const MANAGE_STEPS: readonly PublicStep<ManageStepKey>[] = [
  { key: 'lookup', label: 'ご本人の確認' },
  { key: 'detail', label: 'ご予約の内容' },
]

/**
 * ご予約の流れの読み上げ。最後の 1 歩（WEB-06-DONE）だけは「終わりました」にする —
 * 6 本すべてが点いた帯を「6つ目です」と読ませると、まだ続きがあるように聞こえる。
 */
export function bookingProgressLabel(step: number): string {
  const total = BOOKING_STEPS.length
  return step >= total
    ? `全${total}ステップが終わりました`
    : `全${total}ステップのうち${step}つ目です`
}

/** WEB-CANCEL の読み上げ。2 手順なので「ステップ」と呼ばない。 */
export function manageProgressLabel(step: number): string {
  return `${MANAGE_STEPS.length}つの手順のうち${step}つ目です`
}

/**
 * 上のバーの副題（「ステップ 3 / 6　日にちと時間」）。WEB-CANCEL は 2 手順しかないので
 * 「手順 1 / 2　ご本人の確認」と数える（進捗の読み上げと同じ数え方に揃える）。
 */
export function stepCaption(step: number, total: number, label: string, noun: string): string {
  return `${noun} ${step} / ${total}　${label}`
}

/** 進捗の帯 1 本ずつの点灯。1 始まりの `step` までを点ける。 */
export function litBars(step: number, total: number): boolean[] {
  return Array.from({ length: total }, (_, index) => index < step)
}
