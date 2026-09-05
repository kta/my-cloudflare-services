/**
 * 顧客台帳のドメイン。「探す・特定する・思い出す」を決める純関数だけを置く。
 *
 * ここに置くのは 5 つである。
 *
 * 1. **探し方** — お電話番号の正規化と、**2 本立ての引き方**。台帳は下 4 桁の完全一致
 *    （`phone_last4`）、予約の工程は正規化した番号の前方一致（`phone_normalized`）で、
 *    同じ番号でも拾える相手が違う。後方一致（`LIKE '%' || ?`）は前方ワイルドカードで
 *    B-tree が効かず、年 20,000 行ずつ増えて消えない顧客表を毎回全走査することになるので、
 *    **電話番号の列にはそのパターンを 1 つも組み立てない**。
 * 2. **候補の確からしさ** — 全桁一致が `strong`、前方一致と下 4 桁一致が `weak` の 2 段。
 *    **1 件でも自動で確定しない**（返すのは常に配列で、選ばれた 1 件を指す印を持たない）。
 * 3. **来店回数と最後のご来店** — この 2 つは**別の条件から出る**。回数は接客が終わった件数
 *    （`status='done'`）、最後のご来店は足を運ばれた日（`arrived` / `serving` / `done` の
 *    最終 `starts_at`）である。いま接客中の方は回数が増えないまま今日いらしている。
 * 4. **おまとめの下見** — 項目ごとの残す側の解決。`'both'` は接客のメモだけに許す。
 *    **下見に出した姿と、実行が書き込む行を同じ 1 か所から作る**（`mergedRow`）。
 *    別々に組み立てると、読んで納得した姿と保存された姿が静かに食い違う。
 * 5. **手書きの再直列化** — 他店舗のスタッフが開く SVG を、実行されうる形のまま返さない。
 *    **許可リストであって禁止リストにしない**（知らない要素・属性は落ちる側が既定）。
 *
 * **D1 も R2 も `Date.now()` もここに持ち込まない。**暦日は JST で決まるので、
 * 変換は `@app/shared` の `toJstDateString` に通す（UTC のまま日付を読むと
 * 15:00Z 以降のご来店が前日に落ちる）。
 */
import type { CustomerSummary, ReservationStatus } from '@app/contracts'
import { toJstDateString } from '@app/shared'

/* ─────────────────────────────────────────────────────────────────────────
 * 1. お電話番号と探し方
 * ───────────────────────────────────────────────────────────────────────── */

/** 台帳の 1 行。`customers` から読み出す列のうち、探す・並べる・まとめるに要るものだけ。 */
export type CustomerRow = {
  id: string
  customerNumber: string
  name: string
  /** ふりがな。五十音順一覧の並びの鍵で、無い方は空文字（NULL を持ち込まない）。 */
  kana: string
  /** 数字だけの番号。`phone` / `phone_normalized` / `phone_last4` は 3 つとも NULL か 3 つとも非 NULL。 */
  phoneNormalized: string | null
  phoneLast4: string | null
  address: string | null
  /** 一覧の「覚えておくこと」列。 */
  memo: string
  visitCount: number
  /** JST の暦日 `YYYY-MM-DD`。ご来店が 0 件の方は null（画面は「—」）。 */
  lastVisitAt: string | null
  /** 非 NULL の行は参照専用。検索からも一覧からも外す。 */
  mergedIntoId: string | null
}

/** 全角の数字だけを半角へ。ハイフンや空白は次の段で落ちるのでここでは触らない。 */
const FULL_WIDTH_DIGITS = /[０-９]/g

/** 数字以外（ハイフン・半角空白・全角空白・記号）。 */
const NOT_A_DIGIT = /\D/g

/** 正規化した番号の形。10 桁または 11 桁で、先頭は 0。 */
const PHONE_SHAPE = /^0\d{9,10}$/

/** ちょうど 4 桁の数字。3 桁も 5 桁もお名前として扱う。 */
const PHONE_SUFFIX_SHAPE = /^\d{4}$/

/**
 * 候補を拾う前方一致の桁数。BOOK-04b で `090-1234-5678` と打つと 2 件出るが、
 * 2 件目の田中 一郎 様は `090-1234-9912` で、共通するのは先頭 7 桁（`0901234`）だけである。
 * 打ち切った 11 桁をそのまま前方一致に使うと、この方が候補から落ちる。
 */
const LOOKUP_PREFIX_DIGITS = 7

/** 一覧の「覚えておくこと」に載せる長さ（`CustomerSummary.memoShort`）。 */
const MEMO_SHORT_LENGTH = 40

function toHalfWidthDigits(raw: string): string {
  return raw.replace(FULL_WIDTH_DIGITS, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
}

/**
 * 打ち込まれたままのお電話番号を、数字だけの番号へ落とす。
 * **番号として通すのは先頭が 0 の 10 桁か 11 桁だけ**で、それ以外は null を返す
 * （9 桁は打ち終えていない途中、12 桁と国番号付きは番号ではない）。
 */
export function normalizePhone(raw: string): string | null {
  const digits = toHalfWidthDigits(raw).replace(NOT_A_DIGIT, '')
  return PHONE_SHAPE.test(digits) ? digits : null
}

/** 正規化した番号の下 4 桁（`customers.phone_last4` に写す値）。 */
export function last4(normalized: string): string {
  return normalized.slice(-4)
}

/** 台帳の検索欄に打たれた 1 語の読み方。 */
export type CustomerSearchMode = { kind: 'phoneLast4' | 'name'; value: string }

/**
 * 台帳の検索欄（「お名前・電話番号　一部でも探せます」）の読み分け。
 * **数字ちょうど 4 桁だけを下 4 桁として扱う。**3 桁も 5 桁もお名前として扱うのは、
 * 「5678」は下 4 桁だが「678」は番号の一部にも住所の一部にもなりうるからである。
 */
export function searchMode(query: string): CustomerSearchMode {
  const value = toHalfWidthDigits(query.trim())
  if (PHONE_SUFFIX_SHAPE.test(value)) return { kind: 'phoneLast4', value }
  return { kind: 'name', value: query.trim() }
}

/**
 * 1 つの列に当てる 1 つの条件。`pattern` を持つのは `LIKE` を使う引き方だけで、
 * **電話番号の列に当たる `pattern` は必ず `%` で終わり、`%` で始まらない**。
 */
export type CustomerFilter =
  | { column: 'phone_last4'; op: 'eq'; value: string }
  | { column: 'phone_normalized'; op: 'prefix'; value: string; pattern: string }
  | { column: 'name_kana'; op: 'contains'; value: string; pattern: string }

/** `LIKE` のパターンに紛れる記号を殺す（`%` を打った検索が全件に化けない）。 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/** 台帳の検索。下 4 桁は完全一致、それ以外はお名前とふりがなの部分一致。 */
export function searchFilter(query: string): CustomerFilter | null {
  const mode = searchMode(query)
  if (mode.value === '') return null
  if (mode.kind === 'phoneLast4') return { column: 'phone_last4', op: 'eq', value: mode.value }
  return {
    column: 'name_kana',
    op: 'contains',
    value: mode.value,
    pattern: `%${escapeLike(mode.value)}%`,
  }
}

/**
 * 予約の工程の候補。打ち終えた番号の**先頭 7 桁**で前方一致を掛ける。
 * 打ち切った 11 桁をそのまま使うと、下 4 桁の違うご家族・お連れ様が候補から落ちる。
 */
export function lookupFilter(phone: string): CustomerFilter | null {
  const normalized = normalizePhone(phone)
  if (normalized === null) return null
  const value = normalized.slice(0, LOOKUP_PREFIX_DIGITS)
  return { column: 'phone_normalized', op: 'prefix', value, pattern: `${value}%` }
}

function matchesFilter(row: CustomerRow, filter: CustomerFilter): boolean {
  if (filter.column === 'phone_last4') return row.phoneLast4 === filter.value
  if (filter.column === 'phone_normalized') {
    return (row.phoneNormalized ?? '').startsWith(filter.value)
  }
  return row.name.includes(filter.value) || row.kana.includes(filter.value)
}

/**
 * 条件に当てはまる行だけを残す。**まとめられた行（`merged_into_id` が非 NULL）は
 * 条件の前に落とす** — 検索でも一覧でも、参照専用になった登録は出さない。
 */
export function filterCustomers(rows: CustomerRow[], filter: CustomerFilter | null): CustomerRow[] {
  const alive = rows.filter((row) => row.mergedIntoId === null)
  if (filter === null) return alive
  return alive.filter((row) => matchesFilter(row, filter))
}

/* --- 並べ方とカーソル ----------------------------------------------------- */

/** 並べ方は 2 つだけ（CUSTOMER-LIST の segmented の 2 枚）。 */
export type CustomerSort = 'kana' | 'visits'

/** カーソルが指す位置。**`OFFSET` は使わない**（件数が増えるほど遅くなる）。 */
export type CustomerCursor =
  | { sort: 'kana'; kana: string; id: string }
  | { sort: 'visits'; visitCount: number; id: string }

/** `kana|id` と `visits|id` の区切り。ふりがなにも id にも現れない文字を使う。 */
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

/**
 * 続きの位置を不透明な base64url 1 本にする。**並べ方の鍵と id の複合**にするのは、
 * 同じふりがな・同じ来店回数の方が並んだときに 2 ページ目で取りこぼさないためである。
 */
export function encodeCursor(sort: CustomerSort, row: CustomerRow): string {
  const key = sort === 'kana' ? row.kana : String(row.visitCount)
  return toBase64Url(`${key}${CURSOR_SEPARATOR}${row.id}`)
}

/** 読めないカーソル・別の並べ方のカーソルは null（黙って先頭へ戻さない材料にする）。 */
export function decodeCursor(sort: CustomerSort, cursor: string): CustomerCursor | null {
  const text = fromBase64Url(cursor)
  if (text === null) return null
  const at = text.indexOf(CURSOR_SEPARATOR)
  if (at < 0) return null
  const key = text.slice(0, at)
  const id = text.slice(at + 1)
  if (id === '') return null
  if (sort === 'kana') return { sort: 'kana', kana: key, id }
  const visitCount = Number(key)
  if (!Number.isInteger(visitCount) || visitCount < 0) return null
  return { sort: 'visits', visitCount, id }
}

function compareText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function orderCustomers(rows: CustomerRow[], sort: CustomerSort): CustomerRow[] {
  return [...rows].sort((a, b) => {
    if (sort === 'kana') {
      return a.kana === b.kana ? compareText(a.id, b.id) : compareText(a.kana, b.kana)
    }
    return a.visitCount === b.visitCount ? compareText(a.id, b.id) : b.visitCount - a.visitCount
  })
}

function isAfterCursor(row: CustomerRow, cursor: CustomerCursor): boolean {
  if (cursor.sort === 'kana') {
    if (row.kana !== cursor.kana) return row.kana > cursor.kana
    return row.id > cursor.id
  }
  if (row.visitCount !== cursor.visitCount) return row.visitCount < cursor.visitCount
  return row.id > cursor.id
}

/** 一覧の 1 ページ。`total` は同じ条件の全件で、「当てはまるお客様 42名」に出る数である。 */
export function pageCustomers(
  rows: CustomerRow[],
  page: { sort: CustomerSort; limit: number; cursor?: string },
): { items: CustomerRow[]; nextCursor: string | null; total: number } {
  const ordered = orderCustomers(rows, page.sort)
  const from = page.cursor === undefined ? null : decodeCursor(page.sort, page.cursor)
  const rest = from === null ? ordered : ordered.filter((row) => isAfterCursor(row, from))
  const items = rest.slice(0, page.limit)
  const last = items[items.length - 1]
  const nextCursor =
    last === undefined || rest.length <= page.limit ? null : encodeCursor(page.sort, last)
  return { items, nextCursor, total: ordered.length }
}

/* ─────────────────────────────────────────────────────────────────────────
 * 2. 候補の確からしさ
 * ───────────────────────────────────────────────────────────────────────── */

/** 候補 1 件。**選ばれた 1 件を指す印を持たない**（決めるのは人である）。 */
export type RankedCandidate = { customer: CustomerRow; match: 'strong' | 'weak' }

const MATCH_ORDER: Record<RankedCandidate['match'], number> = { strong: 0, weak: 1 }

function matchOf(
  row: CustomerRow,
  phone: string | null,
  prefix: string | null,
  suffix: string | null,
): RankedCandidate['match'] | null {
  const normalized = row.phoneNormalized
  if (normalized === null) return null
  if (phone !== null && normalized === phone) return 'strong'
  if (prefix !== null && normalized.startsWith(prefix)) return 'weak'
  if (suffix !== null && row.phoneLast4 === suffix) return 'weak'
  return null
}

/**
 * 読み出した行を「よく一致しています」「確かめが必要です」の 2 段に分ける。
 * 3 段目を作らないのは、添える札の文言が無く、自動確定への逃げ道にもなるからである。
 * **当てはまりが 0 件でも例外にしない**（空配列を返し、画面は手入力へ進む）。
 */
export function rankCandidates(
  rows: CustomerRow[],
  typed: { phone?: string | null; phoneLast4?: string | null },
): RankedCandidate[] {
  const phone =
    typed.phone === undefined || typed.phone === null ? null : normalizePhone(typed.phone)
  const prefix = phone === null ? null : phone.slice(0, LOOKUP_PREFIX_DIGITS)
  const suffix = typed.phoneLast4 ?? null
  const ranked: RankedCandidate[] = []
  for (const row of rows) {
    const match = matchOf(row, phone, prefix, suffix)
    if (match !== null) ranked.push({ customer: row, match })
  }
  return ranked.sort((a, b) => {
    if (a.match !== b.match) return MATCH_ORDER[a.match] - MATCH_ORDER[b.match]
    const left = a.customer.lastVisitAt ?? ''
    const right = b.customer.lastVisitAt ?? ''
    return left === right ? compareText(a.customer.id, b.customer.id) : compareText(right, left)
  })
}

/* ─────────────────────────────────────────────────────────────────────────
 * 3. 来店回数と最後のご来店
 * ───────────────────────────────────────────────────────────────────────── */

/** 来店回数の判定に要る 1 件。状態と開始時刻だけを読む。 */
export type VisitReservation = { status: ReservationStatus; startsAt: string }

/** 足を運ばれた状態。取消・不来店・受付前は入らない。 */
const VISITED_STATUSES: readonly ReservationStatus[] = ['arrived', 'serving', 'done']

/** 来店回数は**接客が終わった件数**だけを数える（`status='done'`）。 */
export function countVisits(reservations: VisitReservation[]): number {
  return reservations.filter((row) => row.status === 'done').length
}

/** 「もう足を運ばれた」ご予約。これからの日付のものは、状態が進んでいても数えない。 */
function visited(reservations: VisitReservation[], now: Date): VisitReservation[] {
  const limit = now.getTime()
  return reservations.filter(
    (row) => VISITED_STATUSES.includes(row.status) && Date.parse(row.startsAt) <= limit,
  )
}

/**
 * 最後のご来店（JST の暦日）。**いま接客中でも今日になる** — 回数は増えていなくても
 * 目の前にいらっしゃるので、「前回のご来店」に古い日付を出したままにしない。
 */
export function lastVisitDate(reservations: VisitReservation[], now: Date): string | null {
  const rows = visited(reservations, now)
  if (rows.length === 0) return null
  const latest = rows.reduce((a, b) => (Date.parse(a.startsAt) >= Date.parse(b.startsAt) ? a : b))
  return toJstDateString(latest.startsAt)
}

/** 初回のご来店（JST の暦日）。あとから来るご予約では書き換わらない。 */
export function firstVisitDate(reservations: VisitReservation[], now: Date): string | null {
  const rows = visited(reservations, now)
  if (rows.length === 0) return null
  const earliest = rows.reduce((a, b) => (Date.parse(a.startsAt) <= Date.parse(b.startsAt) ? a : b))
  return toJstDateString(earliest.startsAt)
}

/**
 * 来店回数の文言。**出る場所で 2 通りあるが、どちらも同じ `visit_count` から作る**
 * （一覧の列は「初 / 4回」、帯とバッジは「初めて / 4回目」）。
 */
export function visitLabel(count: number, place: 'list' | 'badge'): string {
  if (count <= 0) return place === 'list' ? '初' : '初めて'
  return place === 'list' ? `${count}回` : `${count}回目`
}

/** 最後のご来店の文言。ご来店が 0 件の方は「—」で、空欄にしない。 */
export function lastVisitLabel(date: string | null): string {
  if (date === null) return '—'
  return `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`
}

/* ─────────────────────────────────────────────────────────────────────────
 * 4. おまとめの下見
 * ───────────────────────────────────────────────────────────────────────── */

/** 下見に要る 1 名。接客のメモの件数だけは行の外から数えて渡す。 */
export type MergeCustomer = CustomerRow & { noteCount: number }

/** 項目ごとの残す側。`'both'` は接客のメモだけに許す。 */
type MergeChoice = 'primary' | 'secondary' | 'both'

/** 画面から届く選択。知らない項目名も型では止まらないので、ここで拒む。 */
export type MergeFieldChoice = { field: string; choice: MergeChoice }

/** 解決した 1 項目。`display` は値の無い側を選んだときの言い回しまで含む。 */
export type ResolvedMergeField = {
  field: string
  primaryValue: string | null
  secondaryValue: string | null
  choice: MergeChoice
  value: string | null
  display: string
}

/** 下見の結果。拒むときは**何も書き換えずに**理由だけを返す。 */
export type MergeResolution =
  | {
      ok: true
      fields: ResolvedMergeField[]
      result: CustomerSummary
      noteCount: number
      losingCustomerNumber: string
    }
  | { ok: false; error: 'same_customer' | 'unknown_field' | 'choice_not_allowed' }

/**
 * CUSTOMER-MERGE の見比べ表が描く 4 項目**この順**。空いた場所を埋めるために
 * 項目を足さない（ふりがな・メール・生年月日は画面に無い）。
 */
const MERGE_FIELDS: readonly string[] = ['name', 'phone', 'address', 'notes']

/** 値の無い側を残す選択をしたときの言い回し。空欄のままにしない。 */
const NO_VALUE_LABEL = 'ご登録がありません'

function fieldValueOf(field: string, row: MergeCustomer): string | null {
  if (field === 'name') return row.name
  if (field === 'phone') return row.phoneNormalized
  if (field === 'address') return row.address
  return String(row.noteCount)
}

function resolveFields(
  primary: MergeCustomer,
  secondary: MergeCustomer,
  choices: MergeFieldChoice[],
): ResolvedMergeField[] | 'unknown_field' | 'choice_not_allowed' {
  const chosen = new Map<string, MergeChoice>()
  for (const choice of choices) {
    if (!MERGE_FIELDS.includes(choice.field)) return 'unknown_field'
    if (choice.choice === 'both' && choice.field !== 'notes') return 'choice_not_allowed'
    chosen.set(choice.field, choice.choice)
  }
  return MERGE_FIELDS.map((field) => {
    const primaryValue = fieldValueOf(field, primary)
    const secondaryValue = fieldValueOf(field, secondary)
    // 既定は残す側。接客のメモだけ「両方を残します」（7 + 1 = 8）から始める。
    const choice = chosen.get(field) ?? (field === 'notes' ? 'both' : 'primary')
    // 接客のメモは**残す側のぶんを消さない**（行は参照専用で残す、が設計の約束である）。
    // だから「残さない側だけを残す」は成り立たず、寄せるか寄せないかの 2 通りしかない。
    // ここで `'secondary'` を 1 件と数えると、下見が「1件」と言った直後に 8 件が寄る。
    const value =
      field === 'notes'
        ? String(choice === 'primary' ? primary.noteCount : primary.noteCount + secondary.noteCount)
        : choice === 'primary'
          ? primaryValue
          : secondaryValue
    return { field, primaryValue, secondaryValue, choice, value, display: value ?? NO_VALUE_LABEL }
  })
}

function pickValue(fields: ResolvedMergeField[], field: string): string | null {
  return fields.find((row) => row.field === field)?.value ?? null
}

function laterOf(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a >= b ? a : b
}

/**
 * まとめたあとの行。**下見の姿も実行が書き込む行もここから作る** —
 * 2 か所で組み立てると、読んで納得した姿と保存された姿が静かに食い違う。
 * ご予約とメモは残す側へ寄るので、ご来店の回数と最後のご来店も足し合わせる。
 */
function mergedRow(
  primary: MergeCustomer,
  secondary: MergeCustomer,
  fields: ResolvedMergeField[],
): CustomerRow {
  const phone = pickValue(fields, 'phone')
  return {
    id: primary.id,
    customerNumber: primary.customerNumber,
    name: pickValue(fields, 'name') ?? primary.name,
    kana: primary.kana,
    phoneNormalized: phone,
    phoneLast4: phone === null ? null : last4(phone),
    address: pickValue(fields, 'address'),
    memo: primary.memo,
    visitCount: primary.visitCount + secondary.visitCount,
    lastVisitAt: laterOf(primary.lastVisitAt, secondary.lastVisitAt),
    mergedIntoId: primary.mergedIntoId,
  }
}

/** 一覧と下見が返す形（`CustomerSummary`）。手書きの型を作らない。 */
export function toCustomerSummary(row: CustomerRow): CustomerSummary {
  return {
    id: row.id,
    customerNumber: row.customerNumber,
    name: row.name,
    kana: row.kana,
    phone: row.phoneNormalized,
    visitCount: row.visitCount,
    lastVisitAt: row.lastVisitAt,
    memoShort: [...row.memo].slice(0, MEMO_SHORT_LENGTH).join(''),
  }
}

/**
 * おまとめの下見。取り消せない操作の前に、**まとめたあとの姿と失う番号**を返す。
 * 同じ登録どうし・知らない項目・接客のメモ以外の「両方を残します」は拒む。
 */
export function mergePreview(
  primary: MergeCustomer,
  secondary: MergeCustomer,
  choices: MergeFieldChoice[] = [],
): MergeResolution {
  if (primary.id === secondary.id) return { ok: false, error: 'same_customer' }
  const fields = resolveFields(primary, secondary, choices)
  if (typeof fields === 'string') return { ok: false, error: fields }
  return {
    ok: true,
    fields,
    result: toCustomerSummary(mergedRow(primary, secondary, fields)),
    noteCount: Number(pickValue(fields, 'notes') ?? '0'),
    losingCustomerNumber: secondary.customerNumber,
  }
}

/** 実行が残す側へ書き込む行。下見が拒む組み合わせはここでも null（1 列も書かない）。 */
export function applyMerge(
  primary: MergeCustomer,
  secondary: MergeCustomer,
  choices: MergeFieldChoice[] = [],
): CustomerRow | null {
  if (primary.id === secondary.id) return null
  const fields = resolveFields(primary, secondary, choices)
  if (typeof fields === 'string') return null
  return mergedRow(primary, secondary, fields)
}

/* ─────────────────────────────────────────────────────────────────────────
 * 5. 手書きの再直列化
 * ───────────────────────────────────────────────────────────────────────── */

/** 1 顧客 5 枚まで。1 枚 3〜12KB × 5 枚 × 5,000 顧客で R2 に約 300MB になる。 */
export const HANDWRITING_MAX_SHEETS = 5

/** 1 枚の上限（`CustomerNote.handwritingSvg` と同じ 512KB）。 */
const HANDWRITING_MAX_BYTES = 512 * 1024

/**
 * 残す要素。**許可リストであって禁止リストにしない** — 知らない要素が増えたときに
 * 落ちる側が既定でないと、見落とした 1 つがそのまま他店舗の端末で動く。
 */
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'line',
  'polyline',
  'circle',
  'ellipse',
  'text',
])

/** 残す属性。`href` / `xlink:href` / `on*` はこの表に無いので、書き方を問わず落ちる。 */
const ALLOWED_ATTRIBUTES = new Set([
  'viewBox',
  'width',
  'height',
  'd',
  'transform',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'class',
  'role',
  'aria-label',
])

const COMMENTS = /<!--[\s\S]*?-->/g
const DECLARATIONS = /<[!?][^>]*>/g
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9:_.-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g
const ATTRIBUTE = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/**
 * まだ実体参照になっていない `&` だけ。**再直列化は保存のときと読み出しのときの
 * 2 回通る**ので、`&` を無条件に逃がすと 1 枚が読まれるたびに `&amp;` が
 * `&amp;amp;` へ伸び、お客様の書いた「田中 & 花子」が読むたび別の文字列になる。
 * すでに実体参照の形をしている `&` は、逃がし済みとして触らない。
 */
const BARE_AMPERSAND = /&(?!(?:[A-Za-z][A-Za-z0-9]{0,30}|#\d{1,7}|#[xX][0-9A-Fa-f]{1,6});)/g

function escapeText(text: string): string {
  return text.replace(BARE_AMPERSAND, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;')
}

function keepAttributes(source: string): string {
  let kept = ''
  for (const found of source.matchAll(ATTRIBUTE)) {
    const name = found[1] ?? ''
    if (!ALLOWED_ATTRIBUTES.has(name)) continue
    kept += ` ${name}="${escapeAttribute(found[2] ?? found[3] ?? '')}"`
  }
  return kept
}

/**
 * 筆跡の SVG を、許可リストだけで組み直す。**落とす要素は中身ごと落とす**
 * （`<script>` の本文や `<foreignObject>` の中の HTML を残さない）。
 * 筆跡の線（`path`）は 1 本も減らない。
 */
export function sanitizeSvg(raw: string): string {
  const source = raw.replace(COMMENTS, '').replace(DECLARATIONS, '')
  const open: string[] = []
  let out = ''
  let cursor = 0
  let skipping: string | null = null
  let depth = 0
  for (const found of source.matchAll(TAG)) {
    const at = found.index
    const tag = found[0]
    const name = found[2] ?? ''
    const isClose = found[1] === '/'
    const isSelfClosing = found[4] === '/'
    if (skipping === null) out += escapeText(source.slice(cursor, at))
    cursor = at + tag.length
    if (skipping !== null) {
      if (name !== skipping) continue
      if (isClose) depth -= 1
      else if (!isSelfClosing) depth += 1
      if (depth === 0) skipping = null
      continue
    }
    if (!ALLOWED_ELEMENTS.has(name)) {
      if (!isClose && !isSelfClosing) {
        skipping = name
        depth = 1
      }
      continue
    }
    if (isClose) {
      if (open[open.length - 1] === name) {
        open.pop()
        out += `</${name}>`
      }
      continue
    }
    const attributes = keepAttributes(found[3] ?? '')
    if (isSelfClosing) {
      out += `<${name}${attributes}/>`
      continue
    }
    open.push(name)
    out += `<${name}${attributes}>`
  }
  if (skipping === null) out += escapeText(source.slice(cursor))
  while (open.length > 0) out += `</${open.pop() ?? ''}>`
  return out.trim()
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length

/**
 * 受け取った 1 枚。大きすぎるものは**再直列化する前に**断る。
 * **逃がしたあとの大きさも測る** — `<` 1 文字が `&lt;` の 4 文字になるので、
 * 上限ちょうどの 1 枚が上限を越えて保存されうる。越えたまま保存すると、
 * 読み直した 1 枚が契約（`CustomerNote.handwritingSvg`）を通らず、
 * その方の詳細が**まるごと 500 になって二度と開けなくなる**。
 */
export function acceptHandwriting(
  raw: string,
): { ok: true; svg: string } | { ok: false; error: 'too_large' } {
  if (byteLength(raw) > HANDWRITING_MAX_BYTES) return { ok: false, error: 'too_large' }
  const svg = sanitizeSvg(raw)
  if (byteLength(svg) > HANDWRITING_MAX_BYTES) return { ok: false, error: 'too_large' }
  return { ok: true, svg }
}

/** すでにある 1 枚。置き換える 1 枚を選んでもらうために日付を添えて返す。 */
export type HandwritingSheet = { id: string; createdAt: string }

/**
 * 6 枚目を保存してよいか。**黙って古い 1 枚を消さない** — 拒んだうえで、
 * いまある 5 枚をそのまま返し、どれを置き換えるかを人に尋ねる。
 */
export function acceptSheet(
  existing: HandwritingSheet[],
): { ok: true } | { ok: false; error: 'too_many_sheets'; sheets: HandwritingSheet[] } {
  if (existing.length < HANDWRITING_MAX_SHEETS) return { ok: true }
  return { ok: false, error: 'too_many_sheets', sheets: [...existing] }
}
