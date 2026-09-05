/**
 * 受付履歴の絞り込み・読み足しと、0 件のときの緩和候補（HISTORY-LIST / HISTORY-EMPTY）。
 *
 * ここに置くのは**純関数だけ**である。D1 も `Date.now()` も触らず、読み出した行と
 * `now` をすべて引数で受ける。「今月（8月1日 〜 8月27日）」の**今月**は `now` を JST に
 * 直して出すので、実行日で候補の文言が変わることはない。
 *
 * 絞り込みの軸は 3 つとも「取り違えやすい方」がある。
 *
 * - **期間はご来店日**で絞る（受け付けた日ではない）。8月20日に電話で承ったご予約は
 *   8月27日の一覧に並ぶ。
 * - **担当は接客する担当**（`reservation_assignments`）で絞る。受け付けた人
 *   （`reception_sessions.actor_id`）は共有端末では NULL になり、そちらで絞ると
 *   共有端末の受付が丸ごと漏れる。
 * - **結果は画面の 3 語**（成立／取消／ご来店なし）を `ReservationStatus` へ落としたもので、
 *   契約に新しい語を足さない。
 *
 * 読み足しは `(startedAt, entryId)` の複合カーソルで行い、**`OFFSET` を使わない**。
 */

import type { ReceptionHistoryList, ReservationStatus, SearchRelaxation } from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { subjectDisplayName } from './walkin'

/* --- 読み出した行の形 ----------------------------------------------------- */

/**
 * 受付履歴の 1 行。「その日にご来店予定の予約 ＋ その日のウォークイン」に
 * `reception_sessions` を左結合した結果である。
 */
export type ReceptionHistoryRow = {
  /** 行の識別子。`reception_sessions.id` ?? `reservations.id` ?? `walk_ins.id`。 */
  entryId: string
  /** Web のご予約は受付セッションを持たないので null になる。 */
  sessionId: string | null
  /** 一覧の並びとカーソルに使う時刻。ISO8601。 */
  startedAt: string
  /**
   * 受け付けた時刻。**絞り込みには使わない**（期間はご来店日で絞る）。
   * 詳細の 1 行「中村 彩 が 8月20日（木）14:32 に電話で受け付け」がこれを読む。
   */
  receivedAt: string
  /** ご来店日（JST の暦日）。破棄した受付は `startedAt` の暦日を入れる。 */
  visitDate: string
  customerName: string | null
  customerKana: string | null
  ticketNo: number | null
  visitCount: number | null
  /** 接客する担当。1 件が複数の担当を持つことがある。 */
  staffIds: readonly string[]
  /** 受け付けた人。**絞り込みには使わない**（共有端末では NULL になる）。 */
  receivedByStaffId: string | null
  outcome: 'booked' | 'discarded' | null
  /** 破棄した受付は予約を持たないので null。 */
  reservationStatus: ReservationStatus | null
}

/** 画面の絞り込み 4 つ。期間だけが必須である。 */
export type ReceptionHistoryFilter = {
  from: string
  to: string
  staffId?: string
  status?: readonly ReservationStatus[]
  name?: string
}

/** 一覧 1 ページぶんの問い合わせ。 */
export type ReceptionHistorySearch = ReceptionHistoryFilter & { limit: number; cursor?: string }

/* --- 絞り込み ------------------------------------------------------------- */

/** 空白の有無で 0 件にしない（「田中花子」と打った操作も拾う）。 */
function matchesName(row: ReceptionHistoryRow, query: string): boolean {
  const needle = query.trim()
  if (needle === '') return true
  const bare = needle.replace(/\s+/g, '')
  const haystacks = [row.customerName ?? '', row.customerKana ?? '']
  return haystacks.some((text) => text.includes(needle) || text.replace(/\s+/g, '').includes(bare))
}

/**
 * 絞り込んだ行を**読み出した順のまま**返す（並べ替えは `buildHistoryList` が行う）。
 * 緩和候補の件数は、この同じ関数に候補の `query` を渡して数える。だから
 * 「押す前に見えている件数」と「押したあとに出る件数」が食い違わない。
 */
export function filterHistory(
  rows: readonly ReceptionHistoryRow[],
  filter: ReceptionHistoryFilter,
): ReceptionHistoryRow[] {
  return rows.filter((row) => {
    if (row.visitDate < filter.from || row.visitDate > filter.to) return false
    if (filter.staffId !== undefined && !row.staffIds.includes(filter.staffId)) return false
    if (filter.status !== undefined && filter.status.length > 0) {
      // 予約を持たない行（破棄した受付）は「結果」を持たないので、結果で絞ると落ちる。
      if (row.reservationStatus === null || !filter.status.includes(row.reservationStatus)) {
        return false
      }
    }
    if (filter.name !== undefined && !matchesName(row, filter.name)) return false
    return true
  })
}

/* --- 並びとカーソル -------------------------------------------------------- */

/** `startedAt|entryId` の区切り。ISO8601 にも UUID にも現れない文字を使う。 */
const CURSOR_SEPARATOR = '|'

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): string | null {
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
  } catch {
    return null
  }
}

type HistoryCursor = { startedAt: string; entryId: string }

/**
 * 続きの位置を不透明な base64url 1 本にする。**時刻と id の複合**にするのは、
 * 同じ時刻の受付が並んだときに 2 ページ目で取りこぼしも二重も作らないためである。
 */
function encodeHistoryCursor(row: ReceptionHistoryRow): string {
  return toBase64Url(`${row.startedAt}${CURSOR_SEPARATOR}${row.entryId}`)
}

/** 読めないカーソルは null（黙って先頭へ戻す材料にする）。 */
function decodeHistoryCursor(cursor: string): HistoryCursor | null {
  const text = fromBase64Url(cursor)
  if (text === null) return null
  const at = text.indexOf(CURSOR_SEPARATOR)
  if (at < 0) return null
  const entryId = text.slice(at + 1)
  return entryId === '' ? null : { startedAt: text.slice(0, at), entryId }
}

/** 新しい順。同じ時刻なら id の降順で必ず 1 通りに決まる。 */
function newestFirst(a: ReceptionHistoryRow, b: ReceptionHistoryRow): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1
  if (a.entryId === b.entryId) return 0
  return a.entryId < b.entryId ? 1 : -1
}

function isAfterCursor(row: ReceptionHistoryRow, cursor: HistoryCursor): boolean {
  if (row.startedAt !== cursor.startedAt) return row.startedAt < cursor.startedAt
  return row.entryId < cursor.entryId
}

/* --- 0 件の緩和候補 -------------------------------------------------------- */

/** 「8月1日」。前ゼロを付けない（画面の文言に合わせる）。 */
function jstLabelDate(date: string): string {
  const [, month, day] = date.split('-')
  return `${Number(month)}月${Number(day)}日`
}

/** 候補 1 つぶんの下ごしらえ。件数は**実際にその条件で引いた値**にする。 */
function relaxation(
  rows: readonly ReceptionHistoryRow[],
  label: string,
  query: ReceptionHistoryFilter,
): SearchRelaxation | null {
  const count = filterHistory(rows, query).length
  if (count === 0) return null
  return { label, count, query: { ...query } }
}

/** 同じ条件の候補を 2 つ並べない。 */
function sameQuery(a: ReceptionHistoryFilter, b: ReceptionHistoryFilter): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 条件を 1 つ緩めた候補（多くても 3 件）。**0 件の応答に同梱する**ので、
 * 0 件の画面が追加の往復ぶんだけ遅れて出ることがない。
 *
 * 並びは 期間 → 担当 → 結果 → お客様名 → 全解除 で、3 件を越えるときは
 * **先頭 2 件 ＋ 全解除**を残す。「絞り込みをすべて外す（46件）」は 0 件の画面の主操作なので、
 * 単純に先頭 3 件で切ると落ちてしまう。
 *
 * 緩められる条件が 1 つも無いとき（期間が既に今月以上で、担当・結果・名前が空）は
 * 全解除も出さない — 押しても同じ画面へ戻る候補を並べない。
 */
function buildRelaxations(
  rows: readonly ReceptionHistoryRow[],
  filter: ReceptionHistoryFilter,
  now: Date,
): SearchRelaxation[] {
  const today = toJstDateString(now)
  const monthStart = `${today.slice(0, 7)}-01`
  const widened = { ...filter, from: monthStart, to: today }
  const canWiden = filter.from > monthStart || filter.to < today

  const singles: SearchRelaxation[] = []
  if (canWiden) {
    const label = `期間を「今月（${jstLabelDate(monthStart)} 〜 ${jstLabelDate(today)}）」まで広げる`
    const found = relaxation(rows, label, widened)
    if (found !== null) singles.push(found)
  }
  if (filter.staffId !== undefined) {
    const { staffId: _dropped, ...rest } = filter
    const found = relaxation(rows, '担当の絞り込みを外す', rest)
    if (found !== null) singles.push(found)
  }
  if (filter.status !== undefined && filter.status.length > 0) {
    const { status: _dropped, ...rest } = filter
    const found = relaxation(rows, '結果の絞り込みを外す', rest)
    if (found !== null) singles.push(found)
  }
  if (filter.name !== undefined && filter.name.trim() !== '') {
    const { name: _dropped, ...rest } = filter
    const found = relaxation(rows, 'お客様名の絞り込みを外す', rest)
    if (found !== null) singles.push(found)
  }

  // 緩められる条件が 1 つも無ければ、全解除も出さない。
  const relaxable =
    canWiden ||
    filter.staffId !== undefined ||
    (filter.status !== undefined && filter.status.length > 0) ||
    (filter.name !== undefined && filter.name.trim() !== '')
  if (!relaxable) return []

  const cleared: ReceptionHistoryFilter = { from: monthStart, to: today }
  const all = singles.some((item) => sameQuery(item.query as ReceptionHistoryFilter, cleared))
    ? null
    : relaxation(rows, '絞り込みをすべて外す', cleared)

  if (all === null) return singles.slice(0, 3)
  return singles.length + 1 <= 3 ? [...singles, all] : [...singles.slice(0, 2), all]
}

/* --- 一覧 1 ページ --------------------------------------------------------- */

/**
 * 受付履歴の一覧 1 ページ。`total` は絞り込んだ総件数で、読み足しても変わらない
 * （一覧の見出し「2026年8月27日（木）　46件」がこの数を読む）。
 */
export function buildHistoryList(
  rows: readonly ReceptionHistoryRow[],
  search: ReceptionHistorySearch,
  now: Date,
): ReceptionHistoryList {
  const { limit, cursor, ...filter } = search
  const matched = filterHistory(rows, filter).sort(newestFirst)
  const from = cursor === undefined ? null : decodeHistoryCursor(cursor)
  const rest = from === null ? matched : matched.filter((row) => isAfterCursor(row, from))
  const page = rest.slice(0, limit)
  const last = page[page.length - 1]

  return {
    items: page.map((row) => ({
      entryId: row.entryId,
      sessionId: row.sessionId,
      startedAt: row.startedAt,
      displayName: subjectDisplayName(row.customerName, row.ticketNo),
      visitCount: row.customerName === null ? null : row.visitCount,
      outcome: row.outcome,
      reservationStatus: row.reservationStatus,
    })),
    nextCursor: last === undefined || rest.length <= limit ? null : encodeHistoryCursor(last),
    total: matched.length,
    relaxations: matched.length === 0 ? buildRelaxations(rows, filter, now) : [],
  }
}
