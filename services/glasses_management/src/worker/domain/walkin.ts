/**
 * 店頭の受け付け（ウォークイン）の数え方。
 *
 * ここに置くのは**純関数だけ**である。D1 も `Date.now()` も触らず、現在時刻を含む
 * すべての時刻を引数で受ける。「お待ち 6分」も「お待たせ中 18分」も列に持たず、
 * `now − arrivedAt` から毎回出す（保存すると画面ごとに違う分数が出て、書き込みも増える）。
 *
 * 整理番号は **店舗 × 来店日（JST）で 1 から採り直す**。日付を UTC のまま読むと
 * 15:00Z から翌 15:00Z までが 1 日になり、夕方にお越しになったお客様が翌日の 001 を受け取る。
 * 採番そのものは `MAX(ticket_no) + 1` を読んでから INSERT するので、同じ値を読んだ 2 台目は
 * `walk_ins_org_store_date_ticket_idx` に弾かれる。弾かれたら +1 して打ち直す（受付ルートの仕事）。
 */

import type { VisitStage } from '@app/contracts'
import { toJstDateString } from '@app/shared'

/* --- 経過分 --------------------------------------------------------------- */

/**
 * 「お待たせ中」に変える閾値（分）。**この 1 か所だけが持つ。**
 * LEDGER-WALKIN の受付パネルの「目安 15分」と同じ値で、RECEPTION-JOURNEY の 18 分は
 * お待たせ中、LEDGER-STAFF の 6 分は通常である。画面上に現れる境目はこの 15 分だけである。
 */
export const WAITING_TOO_LONG_MINUTES = 15

const MS_PER_MINUTE = 60_000

/**
 * 受け付けてからの経過分。**切り捨て**で、6 分 59 秒は「お待ち 6分」である
 * （繰り上げると、受付が実際より長くお待たせしたことになる）。
 *
 * 受付時刻が `now` より後でも負の分を返さない。端末の時計が進んでいる iPad から
 * `arrivedAt` が届くことがあり、台帳の帯に「お待ち −3分」を出さないためである。
 */
export function waitedMinutes(arrivedAt: string, now: Date): number {
  const elapsed = now.getTime() - Date.parse(arrivedAt)
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0
  return Math.floor(elapsed / MS_PER_MINUTE)
}

/**
 * 15 分**ちょうど**はお待たせ中でない。**越えた瞬間**（15 分 1 秒）から赤地にする。
 * 分に切り捨てた値で比べると、15 分 1 秒から 15 分 59 秒までが取りこぼされる
 * （赤くなるのが 1 分近く遅れ、その間に声を掛ける機会が消える）。
 */
export function isWaitingTooLong(arrivedAt: string, now: Date): boolean {
  const elapsed = now.getTime() - Date.parse(arrivedAt)
  return Number.isFinite(elapsed) && elapsed > WAITING_TOO_LONG_MINUTES * MS_PER_MINUTE
}

/* --- 来店日と整理番号 ------------------------------------------------------ */

/** `arrived_at` を JST の暦日に直した写し（`walk_ins.visit_date`）。 */
export function jstVisitDate(iso: string): string {
  return toJstDateString(iso)
}

/** 整理番号の下限と上限。表示が 3 桁ゼロ埋めなので 1000 番目は台帳の札が桁あふれする。 */
const TICKET_MIN = 1
const TICKET_MAX = 999

/**
 * その店舗のその日の次の整理番号。まだ 1 件も無ければ 1 から始まる。
 *
 * **999 の次は採番しない。**`null` を返すのは、打ち止めが 500 ではなく人を呼ぶ事象だからで、
 * `withReservationCode` の `code_exhausted` と同じ扱いである（throw にすると
 * `app.onError` が 500 にして、受付が原因も分からないまま止まる）。
 */
export function nextTicketNo(maxTicketNo: number | null): number | null {
  const next = (maxTicketNo ?? 0) + 1
  return next < TICKET_MIN || next > TICKET_MAX ? null : next
}

/** 台帳と盤面の札（「ウォークイン 004」）。3 桁ゼロ埋め。 */
export function formatTicket(no: number): string {
  return `ウォークイン ${String(no).padStart(3, '0')}`
}

/**
 * 盤面と受付履歴に出す行の名前。お客様が分かるまでは整理番号、分かったらお名前である
 * （AC-RECEP-08 の「表示が整理番号からお名前に変わる」）。**規則をここ 1 か所に置く**ので、
 * 来店受付ボードと受付履歴が別々の「様」の付け方を持たない。
 */
export function subjectDisplayName(customerName: string | null, ticketNo: number | null): string {
  const name = customerName?.trim() ?? ''
  if (name !== '') return `${name} 様`
  return ticketNo === null ? 'お客様' : formatTicket(ticketNo)
}

/* --- 待ちきれずお帰り ------------------------------------------------------ */

/** 工程の記録 1 行のうち、ここで見る 2 つ（`visit_events`）。 */
export type WalkinVisitEvent = { stage: VisitStage; occurredAt: string }

/** 接客が始まったと言える工程。`received` と `waiting` は「まだ始まっていない」。 */
const SERVED_STAGES: ReadonlySet<VisitStage> = new Set<VisitStage>([
  'consulting',
  'fitting',
  'measuring',
  'checkout',
  'handover',
])

/**
 * 待ちきれずにお帰りになった来店か。
 *
 * **退店した来店をひとまとめにしない。**接客を終えた退店と待ちきれずのお帰りを 1 つに潰すと、
 * ANALYTICS-WAIT のお待ち時間の中央値が実態より必ず良い側へずれる（`03-data-model.md` §7.4）。
 * まだお帰りでない行は数えない — それは「お待たせ中」であって、待ちきれずではない。
 */
export function isAbandonedWait(events: readonly WalkinVisitEvent[]): boolean {
  if (!events.some((event) => event.stage === 'left')) return false
  return !events.some((event) => SERVED_STAGES.has(event.stage))
}
