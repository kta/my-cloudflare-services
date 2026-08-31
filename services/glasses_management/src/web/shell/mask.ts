import type { LedgerLane, LedgerView } from '@app/contracts'

/*
 * 伏せ字（HOME-SHARED-LOCKED.png / AC-TERM-12）。
 *
 * 伏せるのは**お客様のお名前と電話番号だけ**で、時刻・件数・端末名・サイドバーの
 * 項目名は文字のまま残す。**桁数も漏らさない**ので、● の数は元の長さに依らず一定にする。
 */

const DOTS = '●●●●'

/** 「田中 花子」→「●●●●」。呼ぶ側が「 様」を添える。 */
export function maskName(_name: string): string {
  return DOTS
}

/**
 * 「090-1234-5678」→「090-●●●●-●●●●」。市外局番だけ残す。
 *
 * ハイフンで区切られていない番号（「09012345678」）でも**先頭 3 桁より後ろは
 * 1 桁も残さない**。区切りをそのまま信じると、区切りの無い番号がまるごと
 * 伏せ字の前に出てしまう。
 */
export function maskPhone(phone: string): string {
  const head = phone.split('-')[0] ?? ''
  return `${head.slice(0, 3)}-${DOTS}-${DOTS}`
}

/**
 * 台帳の 1 行を伏せる。**置き換えるのはお客様のお名前だけ**で、時刻・件数・
 * ご用件・担当・休憩の帯は読めたまま残す（AC-TERM-09）。
 */
export function maskLane(lane: LedgerLane): LedgerLane {
  return {
    ...lane,
    entries: lane.entries.map((entry) =>
      entry.customerName === null
        ? entry
        : { ...entry, customerName: maskName(entry.customerName) },
    ),
  }
}

/** 台帳まるごとを伏せる。伏せ字にした値しか DOM へ渡らないようにここで作り直す。 */
export function maskView(view: LedgerView): LedgerView {
  return { ...view, lanes: view.lanes.map(maskLane) }
}
