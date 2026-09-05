/**
 * ご予約を探す（CHANGE-SEARCH / EX-EMPTY-SEARCH）。
 *
 * ここに置くのは**純関数だけ**である。D1 も `Date.now()` も触らず、条件は
 * 「SQL の断片 ＋ パラメータ」に直すだけで、読み出した行の当たり判定は同じ条件を
 * もう一度読む（`resolveSearch` と `filterReservations` は 1 つの決めの表と裏である）。
 * ルートが数えるのは `resolveSearch` が組み立てた `COUNT(*)` のほうで、
 * `filterReservations` は同じ決めを行の側から言い直したものである — 2 つが同じ答えを
 * 出すことを `reservation-search.test.ts` が固定する。
 *
 * 0 件のときに出す案の件数は、`relaxationsFor` が返した `query` を**そのまま**
 * 数え直して埋める（`index.ts` の `relaxationsWithCounts`）。期間を広げる幅の規則を
 * ここに 1 つだけ置き、ルートが同じ計算を複製しないので、**押す前に見えている件数と
 * 押したあとに出る件数が食い違わない**。
 *
 * **組織と店舗の条件は必ず先頭 2 本に入る。**`ReservationSearchInput` は
 * `organizationId` と `storeId` を省略できない形にしてあり、呼び出し側がこの 2 つを
 * 外した問い合わせを組み立てられない（AC-CHANGE-05「丸の内店のご予約は結果に出ない」）。
 *
 * **お電話番号の引き方は 2 本立てである。**下 4 桁ちょうどは `customers.phone_last4` の
 * 完全一致、5 桁以上は `phone_normalized` の前方一致で、**後方一致は 1 つも作らない** —
 * 前にワイルドカードを置くと B-tree が効かず、1 回の検索が顧客表の全走査になる
 * （`customers.ts` と同じ決め）。`LIKE` のパターンは SQL の中で連結せず**値として**渡すので、
 * 前方一致か後方一致かはパラメータを見れば分かる。
 *
 * 期間は JST の暦日を UTC の半開区間 `[from 00:00, to+1 日 00:00)` に直す
 * （`availability.ts` の `jstDayRange` を使う。自前で +9 時間しない）。
 */
import type { ReservationSource, ReservationStatus, SearchRelaxation } from '@app/contracts'
import { jstDayRange } from './availability'
import { SOURCE_LABELS } from './ledger'

/* --- 読み出した行の形 ----------------------------------------------------- */

/**
 * 検索結果の 1 行。`reservations` にお客様（`customers`）と担当
 * （`reservation_assignments` × `staff`）を寄せた姿で、そのまま
 * `ReservationSummary` へ写せる。
 */
export type ReservationSearchRow = {
  id: string
  code: string
  storeId: string
  source: ReservationSource
  status: ReservationStatus
  /** ISO8601（UTC）。 */
  startsAt: string
  durationMinutes: number
  /** お客様の付いていないご予約（ウォークインの前身）は null。 */
  customerName: string | null
  customerKana: string | null
  phoneNormalized: string | null
  phoneLast4: string | null
  visitCount: number | null
  purposeLabel: string
  /** 未定の行は null（「担当が未定」と描く）。 */
  staffName: string | null
  staffIds: readonly string[]
  /** `source='web'` のときだけ非 null（`web_bookings.public_code`）。 */
  webBookingCode: string | null
}

/* --- 条件 ----------------------------------------------------------------- */

/** 画面から届く条件。**そのまま再送できる形**にしておく（緩和候補の `query` になる）。 */
export type ReservationSearchQueryLike = {
  storeId?: string
  name?: string
  kana?: string
  phone?: string
  code?: string
  from?: string
  to?: string
  status?: readonly ReservationStatus[]
  source?: readonly ReservationSource[]
  staffId?: string
  includeCancelled?: boolean
}

/** 検索を解くのに要るもの。**組織と店舗は省略できない。** */
export type ReservationSearchInput = ReservationSearchQueryLike & {
  organizationId: string
  storeId: string
}

/** 1 つの条件。`?` の数と `params` の数は必ず揃う。 */
type SearchCondition = { sql: string; params: string[] }

/** 予約番号をどちらの表で引くか。`null` は番号を指定していない。 */
type CodeTarget = 'reservations' | 'web_bookings'

/** 解いた条件。`where` を `AND` でつなぎ、`params` をその順に束ねる。 */
export type ResolvedSearch = {
  where: SearchCondition[]
  params: string[]
  /** JST の暦日を直した UTC の半開区間。期間を指定していなければ null。 */
  range: { fromIso: string | null; toIso: string | null } | null
  codeTarget: CodeTarget | null
  orderBy: string
}

/** 取り消したご予約の状態。既定の検索からは外す。 */
const CANCELLED_STATUSES: readonly ReservationStatus[] = ['cancelled', 'no_show']

/** お客様が読み上げる Web のご予約番号の頭。 */
const WEB_CODE_HEAD = 'EY-W-'

/** 下 4 桁として読む桁数。3 桁も 5 桁も下 4 桁ではない（`customers.ts` と同じ決め）。 */
const PHONE_SUFFIX_DIGITS = 4

/** 全角の数字。打ち込みは全角のまま届くことがある。 */
const FULL_WIDTH_DIGITS = /[０-９]/g
const NOT_A_DIGIT = /\D/g

/** 開始時刻の昇順、同時刻はお客様名の昇順。SQLite の BINARY 照合と同じ並びにする。 */
const ORDER_BY = 'r.starts_at ASC, c.name ASC, r.id ASC'

function toHalfWidthDigits(raw: string): string {
  return raw.replace(FULL_WIDTH_DIGITS, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
}

/** 打ち込まれたお電話番号から数字だけを取り出す（途中まででも読む）。 */
function digitsOf(raw: string): string {
  return toHalfWidthDigits(raw).replace(NOT_A_DIGIT, '')
}

/** `LIKE` のパターンに紛れる記号を殺す（`%` を打った検索が全件に化けない）。 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/** 部分一致のパターン。**電話番号の列には使わない。** */
function contains(value: string): string {
  return `%${escapeLike(value)}%`
}

function trimmed(value: string | undefined): string {
  return (value ?? '').trim()
}

/**
 * 条件を SQL の断片へ直す。表の別名は `r`（`reservations`）/ `c`（`customers`）/
 * `a`（`reservation_assignments`）/ `w`（`web_bookings`）で固定する。
 *
 * **`EY-W-` の番号は `web_bookings.public_code` を指す。**その表は P8
 * （`011-web-booking`）が作るので、いまはこの条件を解くところまでで止まる
 * （`codeTarget` を見たルートが 0 件を返してよい）。
 */
export function resolveSearch(input: ReservationSearchInput): ResolvedSearch {
  const where: SearchCondition[] = [
    { sql: 'r.organization_id = ?', params: [input.organizationId] },
    { sql: 'r.store_id = ?', params: [input.storeId] },
  ]

  const code = trimmed(input.code)
  const codeTarget: CodeTarget | null =
    code === '' ? null : code.startsWith(WEB_CODE_HEAD) ? 'web_bookings' : 'reservations'
  if (codeTarget === 'web_bookings') {
    where.push({ sql: 'w.public_code = ?', params: [code] })
  } else if (codeTarget === 'reservations') {
    where.push({ sql: 'r.code = ?', params: [code] })
  }

  // お名前の欄はお名前とふりがなの両方に当てる。画面に かな 専用の欄は無いので、
  // 「たなか はなこ」と打った操作が漢字で登録されたお客様に届かないと 0 件になる。
  const name = trimmed(input.name)
  if (name !== '') {
    where.push({
      sql: "(c.name LIKE ? ESCAPE '\\' OR c.kana LIKE ? ESCAPE '\\')",
      params: [contains(name), contains(name)],
    })
  }
  const kana = trimmed(input.kana)
  if (kana !== '') {
    where.push({ sql: "c.kana LIKE ? ESCAPE '\\'", params: [contains(kana)] })
  }

  const phone = digitsOf(trimmed(input.phone))
  if (phone.length === PHONE_SUFFIX_DIGITS) {
    where.push({ sql: 'c.phone_last4 = ?', params: [phone] })
  } else if (phone.length > PHONE_SUFFIX_DIGITS) {
    // 前方一致だけ。`%` で始まるパターンをこの列に作らない。
    where.push({ sql: "c.phone_normalized LIKE ? ESCAPE '\\'", params: [`${escapeLike(phone)}%`] })
  }

  const range = spanOf(input)
  if (range !== null) {
    if (range.fromIso !== null && range.toIso !== null) {
      where.push({
        sql: 'r.starts_at >= ? AND r.starts_at < ?',
        params: [range.fromIso, range.toIso],
      })
    } else if (range.fromIso !== null) {
      where.push({ sql: 'r.starts_at >= ?', params: [range.fromIso] })
    } else if (range.toIso !== null) {
      where.push({ sql: 'r.starts_at < ?', params: [range.toIso] })
    }
  }

  const status = input.status ?? []
  if (status.length > 0) {
    where.push({ sql: `r.status IN (${placeholders(status.length)})`, params: [...status] })
  } else if (input.includeCancelled !== true) {
    where.push({ sql: `r.status NOT IN (${quoted(CANCELLED_STATUSES)})`, params: [] })
  }

  const source = input.source
  if (source !== undefined) {
    // **空の並びは「どの出どころにも当たらない」である。**欄そのものが無い（undefined）
    // ときだけ絞らない。`EY-W-` の番号に「お電話でのご予約だけ」が重なった要求がここへ
    // 来るので、空を「絞らない」と読むと、その番号を持たないお電話のご予約が当たる。
    where.push(
      source.length === 0
        ? { sql: '1 = 0', params: [] }
        : { sql: `r.source IN (${placeholders(source.length)})`, params: [...source] },
    )
  }

  const staffId = trimmed(input.staffId)
  if (staffId !== '') {
    where.push({
      sql:
        'EXISTS (SELECT 1 FROM reservation_assignments a WHERE a.organization_id = ? ' +
        "AND a.reservation_id = r.id AND a.kind = 'staff' AND a.target_id = ?)",
      params: [input.organizationId, staffId],
    })
  }

  return {
    where,
    params: where.flatMap((condition) => condition.params),
    range,
    codeTarget,
    orderBy: ORDER_BY,
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

/** 語の並びをそのまま SQL に書く（`ReservationStatus` の 6 語しか入らない）。 */
function quoted(words: readonly string[]): string {
  return words.map((word) => `'${word}'`).join(', ')
}

/** JST の暦日 → UTC の半開区間。`to` は翌日の 00:00（＝その日の終わり）まで。 */
function spanOf(input: ReservationSearchQueryLike): ResolvedSearch['range'] {
  const from = trimmed(input.from)
  const to = trimmed(input.to)
  if (from === '' && to === '') return null
  return {
    fromIso: from === '' ? null : jstDayRange(from).fromIso,
    toIso: to === '' ? null : jstDayRange(to).toIso,
  }
}

/* --- 当たり判定 ----------------------------------------------------------- */

function matchesRow(row: ReservationSearchRow, input: ReservationSearchInput): boolean {
  if (row.storeId !== input.storeId) return false

  const code = trimmed(input.code)
  if (code !== '') {
    const target = code.startsWith(WEB_CODE_HEAD) ? row.webBookingCode : row.code
    if (target !== code) return false
  }

  const name = trimmed(input.name)
  if (name !== '') {
    const haystacks = [row.customerName ?? '', row.customerKana ?? '']
    if (!haystacks.some((text) => text.includes(name))) return false
  }
  const kana = trimmed(input.kana)
  if (kana !== '' && !(row.customerKana ?? '').includes(kana)) return false

  const phone = digitsOf(trimmed(input.phone))
  if (phone.length === PHONE_SUFFIX_DIGITS && row.phoneLast4 !== phone) return false
  if (phone.length > PHONE_SUFFIX_DIGITS && !(row.phoneNormalized ?? '').startsWith(phone)) {
    return false
  }

  const range = spanOf(input)
  if (range !== null) {
    if (range.fromIso !== null && row.startsAt < range.fromIso) return false
    if (range.toIso !== null && row.startsAt >= range.toIso) return false
  }

  const status = input.status ?? []
  if (status.length > 0) {
    if (!status.includes(row.status)) return false
  } else if (input.includeCancelled !== true && CANCELLED_STATUSES.includes(row.status)) {
    return false
  }

  const source = input.source
  if (source !== undefined && !source.includes(row.source)) return false

  const staffId = trimmed(input.staffId)
  if (staffId !== '' && !row.staffIds.includes(staffId)) return false

  return true
}

/** 開始時刻の昇順、同時刻はお客様名の昇順。同名は id で必ず 1 通りに決まる。 */
function byStartThenName(a: ReservationSearchRow, b: ReservationSearchRow): number {
  if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1
  const nameA = a.customerName ?? ''
  const nameB = b.customerName ?? ''
  if (nameA !== nameB) return nameA < nameB ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/**
 * 条件に当てはまる行を並べる。`resolveSearch` が組み立てる `WHERE` と**同じ決め**を
 * 行の側から言い直したもので、並びも `ORDER BY` と揃えてある。SQL を打たずに
 * 「どの条件でどの行が当たるか」を 1 本ずつ固定できるようにここへ置く。
 */
export function filterReservations(
  rows: readonly ReservationSearchRow[],
  input: ReservationSearchInput,
): ReservationSearchRow[] {
  return rows.filter((row) => matchesRow(row, input)).sort(byStartThenName)
}

/* --- 0 件の緩和候補 -------------------------------------------------------- */

/** 外せる条件は 3 つだけ（期間・出どころ・取消）。 */
type RelaxationKind = 'period' | 'source' | 'cancelled'

/**
 * 候補ごとの件数と、いまの検索の総件数。件数は呼び出し側が、この関数の返した
 * `query` をそのまま数え直して渡す（案の件数と再検索の件数を 1 本の条件で作る）。
 */
export type RelaxationCounts = { total: number } & Partial<Record<RelaxationKind, number>>

/** 候補は 3 件までに閉じる（4 つ目を出しても画面に置き場が無い）。 */
const RELAXATIONS_MAX = 3

/** 「8月1日」。前ゼロを付けない（画面の文言に合わせる）。 */
function jstLabelDate(date: string): string {
  const [, month, day] = date.split('-')
  return `${Number(month)}月${Number(day)}日`
}

/** その暦日の月初。 */
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}

/** その暦日の**翌月の末日**。うるう年の 2月29日 もそのまま出る。 */
function nextMonthEnd(date: string): string {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate()
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

/** 条件を 1 つ外したクエリ。**外した条件以外はそのまま**残す（画面は再送するだけでよい）。 */
function relaxedQuery(
  query: ReservationSearchQueryLike,
  kind: RelaxationKind,
): ReservationSearchQueryLike {
  const next: ReservationSearchQueryLike = { ...query }
  if (kind === 'period') {
    next.from = monthStart(query.from ?? '')
    next.to = nextMonthEnd(query.to ?? '')
    return next
  }
  if (kind === 'source') {
    delete next.source
    return next
  }
  next.includeCancelled = true
  return next
}

function labelFor(query: ReservationSearchQueryLike, kind: RelaxationKind): string {
  if (kind === 'period') {
    const widened = relaxedQuery(query, 'period')
    return `期間を ${jstLabelDate(widened.from ?? '')} 〜 ${jstLabelDate(widened.to ?? '')} に広げる`
  }
  if (kind === 'source') {
    const words = (query.source ?? []).map((source) => SOURCE_LABELS[source]).join('・')
    return `「${words}だけ」を外す`
  }
  return '取り消されたご予約も含める'
}

/** その条件がそもそも掛かっているか（掛かっていないものは外せない）。 */
function isRelaxable(query: ReservationSearchQueryLike, kind: RelaxationKind): boolean {
  if (kind === 'period') return trimmed(query.from) !== '' && trimmed(query.to) !== ''
  if (kind === 'source') return (query.source ?? []).length > 0
  return query.includeCancelled !== true
}

/**
 * 条件を 1 つ外した候補（多くても 3 件）。**0 件のときだけ**返す — 1 件以上あるのに
 * 「もっと広げますか」と読める操作が結果の隣に並ぶと、いま見えている一覧が信用できなくなる
 * （`ReservationList` の `superRefine` と同じ決め）。
 *
 * 件数 0 の案は落とす（押しても 0 件のままの画面へ送るのは行き止まりを 1 つ増やすだけである）。
 * 並びは件数の多い順で、同じ件数なら 期間 → 出どころ → 取消 の順に落ち着く。
 */
export function relaxationsFor(
  query: ReservationSearchQueryLike,
  counts: RelaxationCounts,
): SearchRelaxation[] {
  if (counts.total !== 0) return []
  const kinds: RelaxationKind[] = ['period', 'source', 'cancelled']
  return kinds
    .filter((kind) => isRelaxable(query, kind) && (counts[kind] ?? 0) > 0)
    .map((kind) => ({
      label: labelFor(query, kind),
      count: counts[kind] ?? 0,
      query: relaxedQuery(query, kind) as Record<string, unknown>,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, RELAXATIONS_MAX)
}
