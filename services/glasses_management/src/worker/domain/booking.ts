/**
 * ご予約を確定するときの「番号」「再送」「制約違反」。
 *
 * ここに置くのは 3 つだけである。
 *
 * 1. **採番** — `EY-YYMM-NNNN`。組織 × JST の暦月ごとの連番で、9999 の次は 5 桁へ桁上げする。
 *    衝突したら +1 して打ち直し、尽きたら 409 `code_exhausted`（500 にしない。人を呼ぶ）。
 * 2. **冪等** — D1 `idempotency_records` の 4 手順（`design/04-api.md` §6.2）。
 * 3. **制約違反の翻訳** — D1 は構造化されたエラーコードを返さないので、`message` の形から
 *    表名を取り出す。**メッセージの形に依存してよいのはこのファイルの `constraintTable` だけ**。
 *
 * **時刻はすべて引数で受ける。**`Date.now()` を書かない。`YYMM` は JST の暦月で決まるので、
 * UTC のまま月を読むと月末の 15:00 から翌朝 9:00 までのご予約が翌月の列に落ちる。
 */

import { toJstDateString } from '@app/shared'
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { slotLockRequests, slotLockStatements } from '../db/slot-locks'
import { expandToSlotStarts } from './availability'

/* ─────────────────────────────────────────────────────────────────────────
 * 1. 予約番号
 * ───────────────────────────────────────────────────────────────────────── */

/** 予約番号の接頭辞。**書式は 1 種類だけ**（Web の対客番号 `EY-W-…` は別列）。 */
const RESERVATION_CODE_PREFIX = 'EY'
/** 連番のゼロ埋め幅。9999 を越えた月は 5 桁になり、`/^EY-\d{4}-\d{4,5}$/` で通る。 */
const RESERVATION_CODE_DIGITS = 4
/** 試す番号の総数（最初の 1 本 ＋ 打ち直し 4 本）。尽きたら 409 `code_exhausted`。 */
export const RESERVATION_CODE_ATTEMPTS = 5

/** `EY-` のあと `YYMM-` までの長さ。SQL の `SUBSTR(code, 9)` と同じ数である。 */
const CODE_SERIAL_OFFSET = `${RESERVATION_CODE_PREFIX}-YYMM-`.length

/** JST の暦月 `YYMM`。`2026-09-01T00:30+09:00`（＝ UTC 8/31 15:30）は `2609`。 */
export function reservationCodeMonth(now: Date): string {
  const jst = toJstDateString(now)
  return `${jst.slice(2, 4)}${jst.slice(5, 7)}`
}

/** `EY-2608-0142`。9999 を越えたら 5 桁のまま伸ばす（頭を切らない）。 */
function formatReservationCode(month: string, serial: number): string {
  const digits = String(serial).padStart(RESERVATION_CODE_DIGITS, '0')
  return `${RESERVATION_CODE_PREFIX}-${month}-${digits}`
}

/** 予約番号の連番だけを取り出す。書式が違えば 0。 */
function reservationCodeSerial(code: string): number {
  const serial = Number.parseInt(code.slice(CODE_SERIAL_OFFSET), 10)
  return Number.isFinite(serial) ? serial : 0
}

/** 打ち直しの 1 手。月はそのままに連番だけ +1 する。 */
function bumpReservationCode(code: string): string {
  const month = code.slice(RESERVATION_CODE_PREFIX.length + 1, CODE_SERIAL_OFFSET - 1)
  return formatReservationCode(month, reservationCodeSerial(code) + 1)
}

/**
 * 次に振る予約番号。**組織ごと・JST の暦月ごと**に採る（店舗ごとではない —
 * 店舗をまたぐ検索で番号が衝突しないため。`03-data-model.md` §7.1）。
 *
 * 連番は**文字列ではなく数として**最大を採る。文字列の `MAX(code)` では
 * `EY-2608-9999` > `EY-2608-10000` になり、桁上げした月の採番が 10000 に戻り続けて
 * 必ず衝突する。`code LIKE 'EY-YYMM-%'` の前方一致なので `reservations_org_code_idx` に載る。
 */
export async function nextReservationCode(
  db: D1Database,
  organizationId: string,
  now: Date,
): Promise<string> {
  const month = reservationCodeMonth(now)
  const row = await db
    .prepare(
      `SELECT MAX(CAST(SUBSTR(code, ${CODE_SERIAL_OFFSET + 1}) AS INTEGER)) AS maxSerial
       FROM reservations
       WHERE organization_id = ?1 AND code LIKE ?2`,
    )
    .bind(organizationId, `${RESERVATION_CODE_PREFIX}-${month}-%`)
    .first<{ maxSerial: number | null }>()
  return formatReservationCode(month, (row?.maxSerial ?? 0) + 1)
}

/** 採番の結果。**戻り値を捨てると 409 が 200 になる。** */
export type ReservationCodeAttempt<T> =
  | { ok: true; code: string; value: T; attempts: number }
  | { ok: false; error: 'code_exhausted'; attempts: number }

/**
 * 予約番号を採って `run` に渡し、番号が衝突したら +1 して打ち直す。
 *
 * 打ち直すのは **`reservations` の一意制約で落ちたときだけ**である。ほかの制約違反と
 * 予期しない失敗はそのまま投げ直す（握りつぶさない → `app.onError` が 500 にする）。
 * `RESERVATION_CODE_ATTEMPTS` 本を試して取れなければ 409 `code_exhausted` を**返す**。
 * throw ではなく戻り値にするのは、「500 にしない」を型で保証するためである。
 *
 * **採番の打ち直しは冪等の「失敗」に数えない**（`design/04-api.md` §6.2 の④）。
 * `in_progress` を消すのは、ここが尽きたとき・枠が取れなかったとき・500 のときだけである。
 */
export async function withReservationCode<T>(
  db: D1Database,
  organizationId: string,
  now: Date,
  run: (code: string) => Promise<T>,
): Promise<ReservationCodeAttempt<T>> {
  let code = await nextReservationCode(db, organizationId, now)
  for (let attempts = 1; attempts <= RESERVATION_CODE_ATTEMPTS; attempts += 1) {
    try {
      return { ok: true, code, value: await run(code), attempts }
    } catch (err) {
      if (constraintTable(err) !== 'reservations') throw err
      code = bumpReservationCode(code)
    }
  }
  return { ok: false, error: 'code_exhausted', attempts: RESERVATION_CODE_ATTEMPTS }
}

/* ─────────────────────────────────────────────────────────────────────────
 * 2. 制約違反の翻訳
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * D1 が投げたエラーから、落ちた表の名前を取り出す。**見つからなければ `null`。**
 *
 * **メッセージの形に依存してよいのはこの関数だけである。**D1 は構造化された
 * エラーコードを返さない（実測: `Object.keys(err)` が空で `cause` も文言だけ）。
 * 実物は次の形をしている。
 *
 * ```
 * D1_ERROR: UNIQUE constraint failed: reservations.organization_id, reservations.code: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)
 * D1_ERROR: UNIQUE constraint failed: idempotency_records.key: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)
 * D1_ERROR: UNIQUE constraint failed: walk_ins.organization_id, walk_ins.store_id, walk_ins.visit_date, walk_ins.ticket_no
 * ```
 *
 * 一意 index が複数列なら `<表>.<列>` が並ぶので、**先頭の 1 つ**から表名を採る。
 * 前後に別の文（`Error in batch statement 5:` など）が付いても、
 * `UNIQUE constraint failed:` の 1 書式だけを見るので取り出せる。
 *
 * 拡張コードは**付いていて、それが一意違反でないときだけ**捨てる
 * （`NOT NULL constraint failed: …` を一意違反と取り違えない）。付いていない形も通すのは、
 * 整理番号（`walk_ins`）の衝突が拡張コード無しで届くことがあるためで、ここで落とすと
 * 採番の打ち直しが 1 度も走らないまま 500 になる。
 *
 * D1 の文言が変わるとこの関数が `null` を返し、409 が 500 に化ける。それを検知する
 * ために `test/booking.test.ts` の 2 本は**本物の D1 に違反を起こさせて**いる。
 */
export function constraintTable(err: unknown): string | null {
  // Error でないものは推測しない（表名を作らずに null を返す）。
  if (!(err instanceof Error) || !err.message) return null
  const extended = /SQLITE_CONSTRAINT_([A-Z]+)\b/.exec(err.message)?.[1]
  if (extended !== undefined && extended !== 'UNIQUE' && extended !== 'PRIMARYKEY') return null
  const matched = /\b(?:UNIQUE|PRIMARY KEY) constraint failed:\s*([A-Za-z_][A-Za-z0-9_]*)\./.exec(
    err.message,
  )
  return matched?.[1] ?? null
}

/* ─────────────────────────────────────────────────────────────────────────
 * 3. 冪等（D1 `idempotency_records`）
 * ───────────────────────────────────────────────────────────────────────── */

/** `Idempotency-Key` を受ける操作の名前（`design/04-api.md` §6.1 の 6 つ）。 */
export type IdempotencyScope =
  | 'reservation.create'
  | 'walkin.create'
  | 'customer.merge'
  | 'public.booking.create'
  | 'public.booking.change'
  | 'public.booking.cancel'

/** 保持は 24 時間（`created_at + 24h`）。 */
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60

/**
 * `Idempotency-Key` ヘッダーに許す長さ。**主キーの一部にそのまま入る**ので閉じる。
 * 上限が無いと、認証済みの端末 1 台が 10 万文字の鍵を並べて `idempotency_records` を
 * 膨らませられる（保持は 24 時間だが、掃除の経路はまだ保守側にある。`04-api.md` §6.2）。
 */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255

/**
 * ヘッダーの読み取り結果。`key: null` は「**送っていない**」で、素通りして毎回実行する。
 * `ok: false` は 400（鍵として使えない文字列を主キーに載せない）。
 */
export type IdempotencyHeader = { ok: true; key: string | null } | { ok: false }

/**
 * `Idempotency-Key` ヘッダーを鍵として読む。
 *
 * **空文字を「送った」と数えない。**`?? null` で素通しすると鍵が
 * `<org>:reservation.create:` になり、**その組織のすべての端末が 1 本の鍵を共有する** —
 * 同じ店舗の 2 件目のご予約が 1 件目の応答を replay して、予約されないまま
 * 「承りました」と出る（実測）。空白だけの鍵も同じなので trim してから見る。
 *
 * 通すのは印字できる ASCII（`0x21`〜`0x7E`）だけである。空白・制御文字・改行を
 * 主キーに載せない。
 */
export function readIdempotencyKey(raw: string | undefined): IdempotencyHeader {
  if (raw === undefined) return { ok: true, key: null }
  const key = raw.trim()
  if (key === '') return { ok: true, key: null }
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) return { ok: false }
  if (!/^[!-~]+$/.test(key)) return { ok: false }
  return { ok: true, key }
}

/**
 * 主キーそのものになる冪等キー。**組織で名前空間を切る**ので、2 テナントが同じ
 * `Idempotency-Key` ヘッダーを同時に使っても互いに衝突しない。
 */
export function idempotencyKey(
  organizationId: string,
  scope: IdempotencyScope,
  clientKey: string,
): string {
  return `${organizationId}:${scope}:${clientKey}`
}

/** `created_at + 24h`。 */
export function idempotencyExpiresAt(createdAt: Date): string {
  return new Date(createdAt.getTime() + IDEMPOTENCY_TTL_SECONDS * 1000).toISOString()
}

/** 期限内か。**24 時間ちょうどはまだ効く**（`now <= expires_at`）。 */
export function isIdempotencyFresh(record: { expiresAt: string }, now: Date): boolean {
  return now.getTime() <= Date.parse(record.expiresAt)
}

/** 並びに依らない JSON。欄の順が違うだけの再送を「本文が違う」と言わないため。 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, item]) => [name, normalize(item)] as const)
    return Object.fromEntries(entries)
  }
  return value
}

/** 正規化した本文の SHA-256（hex 64 文字）。同じ鍵で本文が違えば 409。 */
export async function requestHash(body: unknown): Promise<string> {
  const json = JSON.stringify(normalize(body)) ?? 'null'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * 冪等の入口の答え。
 * - `started` — この端末が本処理を進める。
 * - `replay` — 保存した応答をそのまま返す（**再実行しない**）。
 * - `conflict` — 409 `idempotency_conflict`。同じ鍵で本文が違う／先行処理が進行中。
 */
export type IdempotencyStart =
  | { state: 'started'; key: string }
  | { state: 'replay'; key: string; response: unknown }
  | { state: 'conflict'; key: string }

type IdempotencyRow = {
  requestHash: string
  responseJson: string | null
  status: string
  expiresAt: string
}

/**
 * `design/04-api.md` §6.2 の①と②。`in_progress` の行を作れたらこの端末が進む。
 *
 * 作れなかったときは既存の行を読んで返すものを決める。**中断された `in_progress` を
 * 待つ・引き継ぐ経路は作らない**（D1 に CAS が無く、待ち合わせを安全に書けない）。
 * クライアントは `Idempotency-Key` を作り直して送り直す。
 *
 * 期限切れ（`expires_at < now`）の行は、同じ 1 文の中で `in_progress` へ戻して
 * 新しく始める。消してから入れ直すと 2 文になり、その間に別の再送が入る窓が空く。
 */
export async function beginIdempotency(
  db: D1Database,
  input: {
    organizationId: string
    scope: IdempotencyScope
    clientKey: string
    requestHash: string
    now: Date
  },
): Promise<IdempotencyStart> {
  const key = idempotencyKey(input.organizationId, input.scope, input.clientKey)
  const createdAt = input.now.toISOString()
  const claimed = await db
    .prepare(
      `INSERT INTO idempotency_records
         (key, organization_id, scope, request_hash, response_json, status, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, NULL, 'in_progress', ?5, ?6)
       ON CONFLICT(key) DO UPDATE SET
         request_hash = excluded.request_hash,
         response_json = NULL,
         status = 'in_progress',
         created_at = excluded.created_at,
         expires_at = excluded.expires_at
       WHERE idempotency_records.expires_at < ?5`,
    )
    .bind(
      key,
      input.organizationId,
      input.scope,
      input.requestHash,
      createdAt,
      idempotencyExpiresAt(input.now),
    )
    .run()
  if ((claimed.meta.changes ?? 0) > 0) return { state: 'started', key }

  const row = await db
    .prepare(
      `SELECT request_hash AS requestHash, response_json AS responseJson, status,
              expires_at AS expiresAt
       FROM idempotency_records WHERE key = ?1`,
    )
    .bind(key)
    .first<IdempotencyRow>()
  // 掃除の Cron と競り合って行が消えていた。鍵を作り直してもらう（黙って二重に実行しない）。
  if (!row) return { state: 'conflict', key }
  if (row.requestHash !== input.requestHash) return { state: 'conflict', key }
  if (row.status !== 'done') return { state: 'conflict', key }
  /*
   * 写しがまだ書かれていない `done` がありうる。応答が本処理の**あと**にしか作れない
   * 経路（おまとめは、まとめ終えた詳細を読まないと `CustomerMergeResult` を組めない）が
   * バッチで `done` にし、写しは次の 1 文で書くからである。その隙間に届いた再送で
   * `JSON.parse('')` を投げると 500 になり、**確定しているのに失敗と見える**。
   * 409 にして鍵を作り直させる（作り直した実行は版の条件で止まるので、二重にはまとまらない）。
   */
  if (row.responseJson === null || row.responseJson === '') return { state: 'conflict', key }
  return { state: 'replay', key, response: JSON.parse(row.responseJson) }
}

/*
 * §6.2 の③（本処理と同じ `db.batch()` で `done` にする）はここに関数を置かない。
 * `done` の UPDATE は**枠のガードを同じ 1 文に配らなければならない** — 配らないと、
 * 占有行が 1 行も入らなかったバッチでもこの UPDATE だけが 1 行に当たって `done` になり、
 * 409 のあとの `releaseIdempotency`（`status='in_progress'` が条件）が効かなくなって
 * **同じ鍵で選び直せない端末**ができる。ガードを持っているのは確定のバッチだけなので、
 * この 1 文は `bookingStatements`（下の §4）が組み立てる。2 か所に置かない。
 */

/**
 * §6.2 の④。本処理が失敗したら `in_progress` を消して、同じ鍵で選び直せるようにする。
 * **消すのは尽きた採番（409 `code_exhausted`）・枠が取れなかったとき（409 `slot_taken`）・
 * 版が合わなかったとき（409 `version_conflict`）・500 のときだけ**である。
 * 採番の打ち直しはここを通さない（通すと③の「同じ batch で done を書く」が成り立たない）。
 */
export async function releaseIdempotency(db: D1Database, key: string): Promise<void> {
  await db
    .prepare(`DELETE FROM idempotency_records WHERE key = ?1 AND status = 'in_progress'`)
    .bind(key)
    .run()
}

/* ─────────────────────────────────────────────────────────────────────────
 * 4. 確定の 1 バッチ
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * ご予約の確定を **1 つの `db.batch()`** に組み立てる。
 *
 * 枠が取れたかどうかは、このバッチの中だけで決まる。読んでから書くまでの窓を作らない
 * （`design/04-api.md` §3.6 / `design/03-data-model.md` §7.6）。**確定の直前に枠を
 * 読み直す再検査を置かない** — 読み → 判定 → 書き の 2 往復になり、そのあいだに
 * 別の端末の書き込みが入る。
 *
 * 並べる順を変えない。
 *
 * 1. `reservation_slot_locks` への**上限つき条件付き INSERT**（`db/slot-locks.ts`）。
 *    **1 本目の `meta.changes === 0` が 409 `slot_taken` の合図**で、そのとき予約は 1 行も
 *    書かれていない。`WHERE NOT EXISTS (…)` は全枠に一字一句同じで付くので、
 *    N 本すべてが入るか 1 本も入らないかのどちらかである。
 * 2. 予約本体・目的・割当・監査・受付セッション・冪等の記録。**すべてに枠のガードを付ける。**
 *    D1 の `db.batch()` は 0 行しか当たらない文を失敗と見なさずバッチを止めないので、
 *    ガードしないと「枠は取れていないのに予約本体だけが書かれた」状態ができる。
 *
 * 冪等を `done` にする 1 文をここで組み立てるのは、**枠のガードを掛けるため**である
 * （`completeIdempotency` は枠のガードを持たない。ガード無しで `done` を書くと、
 * 409 `slot_taken` を返したあとの `releaseIdempotency` が `in_progress` を見つけられず、
 * 同じ鍵で選び直せなくなる）。
 *
 * 時刻は引数（`now`）で受ける。ここで `Date.now()` を呼ばない。
 */

/** 1 予約に載せるご用件 1 件。所要は**予約した時点の写し**で凍結する。 */
export type BookingPurposeLine = {
  purposeId: string
  durationMinutes: number
  sortOrder: number
}

/** 確定 1 件ぶんの材料。上限（`cap`）はハンドラの入口で 1 回読んで渡す。 */
export type BookingInput = {
  organizationId: string
  storeId: string
  reservationId: string
  code: string
  /** 既存顧客を選んだ受付。未特定なら null。 */
  customerId?: string | null
  source: string
  startsAt: string
  /** 片付け時間は含めない。 */
  endsAt: string
  /** `ends_at - starts_at` の分。**目的の合計とは限らない**（長く押さえられる）。 */
  durationMinutes: number
  purposes: readonly BookingPurposeLine[]
  /** 担当。`null` は「あとで決める」で、占有行は `unassigned` のレーンに積む。 */
  staff: { id: string; maxParallelReservations: number } | null
  equipment: readonly { id: string; capacity: number }[]
  slotRules: { slotMinutes: number; cleanupMinutes: number; maxParallel: number }
  noteCustomer: string
  noteInternal: string
  /** 共有端末で個人が未確認なら null。 */
  actorId: string | null
  actorType?: 'staff' | 'terminal' | 'customer' | 'system'
  terminalId?: string | null
  /** 1 操作でまとまった行を束ねる。同じバッチの監査は同じ値を持つ。 */
  correlationId: string
  /** 進行中の受付。確定と同じバッチで `booked` にして閉じる。 */
  receptionSessionId: string | null
  /** 冪等の記録。**本処理と `done` 化を別の文に分けない**（片方だけ成功する窓を作らない）。 */
  idempotency: { key: string; response: unknown } | null
  now: Date
}

/**
 * 枠のガード。予約本体から下の全文に**一字一句同じ**で付ける。
 *
 * `organization_id` を落とさない。落としても `reservation_id` は
 * `crypto.randomUUID()` なので他テナントの行に当たることは無いが、
 * **全 D1 クエリをテナントで絞る**という決めをこの 1 文だけ外すと、
 * 次に写す人が外したまま増やす。索引の面でも、この表の索引は
 * `(organization_id, reservation_id)` の複合なので、組織を書かないと
 * 先頭列が欠けて索引に載らず、確定 1 回につき全走査が行の本数ぶん走る。
 */
const LOCKED =
  'EXISTS (SELECT 1 FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ?)'

/**
 * 確定 1 件ぶんの文。**先頭は必ず占有行の INSERT** で、その `meta.changes` だけが
 * 枠を取れたかどうかを知っている。
 */
export function bookingStatements(db: D1Database, input: BookingInput): D1PreparedStatement[] {
  const createdAt = input.now.toISOString()
  const statements = slotLockStatements(db, {
    organizationId: input.organizationId,
    storeId: input.storeId,
    reservationId: input.reservationId,
    createdAt,
    requests: slotLockRequests({
      slotStarts: expandToSlotStarts({
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        cleanupMinutes: input.slotRules.cleanupMinutes,
        slotMinutes: input.slotRules.slotMinutes,
      }),
      staff: input.staff,
      equipment: input.equipment,
      maxParallel: input.slotRules.maxParallel,
    }),
  })

  statements.push(
    db
      .prepare(
        'INSERT INTO reservations (id, organization_id, store_id, code, customer_id, source, status, starts_at, ends_at, duration_minutes, note_customer, note_internal, version, created_at, updated_at, created_by, cancelled_at, cancel_reason) ' +
          `SELECT ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, NULL WHERE ${LOCKED}`,
      )
      .bind(
        input.reservationId,
        input.organizationId,
        input.storeId,
        input.code,
        input.customerId ?? null,
        input.source,
        input.startsAt,
        input.endsAt,
        input.durationMinutes,
        input.noteCustomer,
        input.noteInternal,
        createdAt,
        createdAt,
        input.actorType === undefined || input.actorType === 'staff' ? input.actorId : null,
        input.organizationId,
        input.reservationId,
      ),
  )

  for (const purpose of input.purposes) {
    statements.push(
      db
        .prepare(
          'INSERT INTO reservation_purposes (id, organization_id, reservation_id, purpose_id, duration_minutes, sort_order, created_at) ' +
            `SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${LOCKED}`,
        )
        .bind(
          crypto.randomUUID(),
          input.organizationId,
          input.reservationId,
          purpose.purposeId,
          purpose.durationMinutes,
          purpose.sortOrder,
          createdAt,
          input.organizationId,
          input.reservationId,
        ),
    )
  }

  // `kind='staff'` の行は 1 予約にちょうど 1 行。**担当が未定でも作る**
  // （作らないと同時受付上限の数え方が台帳とずれる。`03-data-model.md` §7.3 の I-05）。
  const bands: { kind: 'staff' | 'equipment'; targetId: string | null }[] = [
    { kind: 'staff', targetId: input.staff?.id ?? null },
    ...input.equipment.map((unit) => ({ kind: 'equipment' as const, targetId: unit.id })),
  ]
  for (const band of bands) {
    statements.push(
      db
        .prepare(
          'INSERT INTO reservation_assignments (id, organization_id, reservation_id, kind, target_id, starts_at, ends_at, created_at) ' +
            `SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${LOCKED}`,
        )
        .bind(
          crypto.randomUUID(),
          input.organizationId,
          input.reservationId,
          band.kind,
          band.targetId,
          input.startsAt,
          input.endsAt,
          createdAt,
          input.organizationId,
          input.reservationId,
        ),
    )
  }

  // 監査は追記専用。平文のお名前・お電話番号を入れない（`07-nfr.md` §6.6）。
  statements.push(
    db
      .prepare(
        'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
          `SELECT ?, ?, ?, ?, ?, ?, 'reservation.created', 'reservations', ?, NULL, ?, ?, ? WHERE ${LOCKED}`,
      )
      .bind(
        crypto.randomUUID(),
        input.organizationId,
        input.storeId,
        input.actorType ?? 'staff',
        input.actorId,
        input.terminalId ?? null,
        input.reservationId,
        JSON.stringify({
          code: input.code,
          source: input.source,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          durationMinutes: input.durationMinutes,
          staffId: input.staff?.id ?? null,
          equipmentIds: input.equipment.map((unit) => unit.id),
          purposeIds: input.purposes.map((purpose) => purpose.purposeId),
        }),
        input.correlationId,
        createdAt,
        input.organizationId,
        input.reservationId,
      ),
  )

  // 受付は成立として閉じる。`outcome` と `ended_at` を同じ UPDATE で書き、
  // `draft_json` を NULL へ戻す（`03-data-model.md` §8.1 の 3 つの不変条件）。
  if (input.receptionSessionId !== null) {
    statements.push(
      db
        .prepare(
          "UPDATE reception_sessions SET reservation_id = ?, ended_at = ?, outcome = 'booked', draft_json = NULL " +
            `WHERE organization_id = ? AND id = ? AND outcome IS NULL AND ${LOCKED}`,
        )
        .bind(
          input.reservationId,
          createdAt,
          input.organizationId,
          input.receptionSessionId,
          input.organizationId,
          input.reservationId,
        ),
    )
  }

  if (input.idempotency !== null) {
    statements.push(
      db
        .prepare(
          "UPDATE idempotency_records SET status = 'done', response_json = ? " +
            `WHERE key = ? AND status = 'in_progress' AND ${LOCKED}`,
        )
        .bind(
          JSON.stringify(input.idempotency.response),
          input.idempotency.key,
          input.organizationId,
          input.reservationId,
        ),
    )
  }
  return statements
}
