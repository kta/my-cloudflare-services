/**
 * ご予約を変更する・取り消す（CHANGE-DIFF / CHANGE-CANCEL / EX-CONFLICT）。
 *
 * ここに置くのは**純関数だけ**である。D1 へ 1 文も投げず、`Date.now()` も呼ばない。
 * 差分・読み上げ文・取消の結果・バッチの並びを 1 か所に集め、画面とルートが同じ答えを見る。
 *
 * ## 並びとガードが「409 が二重予約を作らない」ための唯一の仕掛けである
 *
 * D1 の `db.batch()` は 1 トランザクションだが、**0 行しか当たらない `UPDATE` では
 * 中断せずに後続の文を commit する**（`meta.changes` が `[0, 1]` になって成功する）。
 * だから `UPDATE reservations ... WHERE version = ?` を 1 文目に置いて 409 を返す作りにすると、
 * 版が合わなかった端末が「何も起きていません」と言われながら `reservation_assignments` と
 * `reservation_slot_locks` だけを自分の値へ書き換えてしまう。取消ではもっと直接的で、
 * 予約は `confirmed` のまま枠のロックだけが消え、**409 が二重予約を作る**。
 *
 * そこで次の 2 つを守る（`design/04-api.md` §3.6 / `03-data-model.md` §7.1 / §7.6）。
 *
 * 1. **版のガードを全文に配る。**`EXISTS (SELECT 1 FROM reservations WHERE … version = ?)` を
 *    置き換え・削除・追記のどの文にも、**新しい枠の INSERT にも**付ける。1 文目に付けないと、
 *    版が合わないときに新しい枠だけが入り、古い枠と両取りになる。
 * 2. **`version` を +1 する `UPDATE reservations` をバッチの最後に置く。**先に置くと、
 *    同じトランザクションの後続の文から見た版が既に +1 されていて、全部のガードが外れる。
 *    最後に置けば全文が同じ版を見るので、**全部通るか 1 行も通らないかのどちらか**になる。
 *
 * `UPDATE reservations` にも**枠のガード**を付ける。枠が取れなかったとき（409 `slot_taken`）に
 * 本体と版だけが進むと、AC-CHANGE-26 の「いまのご予約は元のまま残る」が崩れる。
 *
 * 409 の見分けは、バッチのあとに `SELECT version FROM reservations WHERE id = ?` を 1 本
 * 読んで行う。送った版と違えば版の競合、同じなら枠の競合である（何も書けていないので
 * 読み直して差し支えない）。
 *
 * ## 上限つき条件付き INSERT をここでもう一度書いている理由
 *
 * 新しい枠の INSERT は `db/slot-locks.ts` の `slotLockStatements` と同じ形だが、**版のガードを
 * 足す必要がある**ので文をここで組み立てている。数え方（どの `kind` / `target_key` を
 * 何本要求するか）は `slotLockRequests` をそのまま呼んで 1 つに保つ。
 * `db/slot-locks.ts` の上限判定を直すときは、**この文も一緒に直す。**
 */
import type { ReservationCancelInput, ReservationStatus } from '@app/contracts'
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import type { SlotLockRequest } from '../db/slot-locks'

/* --- 変更前後の姿 --------------------------------------------------------- */

/** 差分表と読み上げ文が読む、ご予約 1 件の姿。 */
export type ReservationSnapshot = {
  /** ISO8601（UTC）。 */
  startsAt: string
  /** ISO8601（UTC）。片付け時間は含まない。 */
  endsAt: string
  durationMinutes: number
  purposeIds: readonly string[]
  /** `visit_purposes.name_internal` を `・` で連ねたもの（詳細と復唱は店内の名前を読む）。 */
  purposeLabel: string
  /** `null` は「あとで決める」。 */
  staffId: string | null
  staffName: string | null
  equipmentIds: readonly string[]
  equipmentNames: readonly string[]
}

/** 差分表の 1 マス。`note` はモックの `small`（時間帯・所要・2 台目の場所）。 */
type DiffCell = { text: string; note: string }

/** 差分表の 1 行。`changed` の行だけ緑地にして「変更」の札を付ける。 */
export type ReservationDiffRow = {
  label: string
  before: DiffCell
  after: DiffCell
  changed: boolean
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
/** 担当が決まっていない行の言い方。台帳の擬似レーンと同じ語にする。 */
const UNASSIGNED_STAFF = '担当が未定'
/** 場所を 1 つも押さえていないとき。 */
const NO_EQUIPMENT = '指定なし'

/** JST の壁時計。UTC のまま読むと日跨ぎで 1 日ずれる。 */
function jstOf(instant: string): Date {
  return new Date(Date.parse(instant) + JST_OFFSET_MS)
}

/** 「8月27日（木）」。前ゼロを付けない（画面の文言に合わせる）。 */
function dayLabel(instant: string): string {
  const at = jstOf(instant)
  return `${at.getUTCMonth() + 1}月${at.getUTCDate()}日（${WEEKDAYS[at.getUTCDay()] ?? ''}）`
}

/** 「11:00」。時も分も 2 桁にする。 */
function clock(instant: string): string {
  const at = jstOf(instant)
  return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`
}

/** 「11:00–12:00」。区切りは en dash（モックと同じ字）。 */
function timeRange(snapshot: ReservationSnapshot): string {
  return `${clock(snapshot.startsAt)}–${clock(snapshot.endsAt)}`
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function placeCell(snapshot: ReservationSnapshot): DiffCell {
  const [first, ...rest] = snapshot.equipmentNames
  return { text: first ?? NO_EQUIPMENT, note: rest.join('・') }
}

/**
 * 変更前と変更後を 4 行（お日にちとお時間 / ご用件 / 担当 / 場所）に並べる。
 * **行の並びは固定**で、変わらない行も薄字で残す（読み上げるときに「そこは同じです」と
 * 言えるのが差分表の仕事である）。
 *
 * 変更が 1 行も無ければ**空の配列**を返す。画面はこれを見て確定を押させない
 * （何も変わらない確定を通すと、差分表が空のまま版だけが進み、
 * 起きなかった操作が監査に 1 行残る）。
 */
export function diffReservation(
  before: ReservationSnapshot,
  after: ReservationSnapshot,
): ReservationDiffRow[] {
  const rows: ReservationDiffRow[] = [
    {
      label: 'お日にちとお時間',
      before: { text: dayLabel(before.startsAt), note: timeRange(before) },
      after: { text: dayLabel(after.startsAt), note: timeRange(after) },
      changed: before.startsAt !== after.startsAt || before.endsAt !== after.endsAt,
    },
    {
      label: 'ご用件',
      before: { text: before.purposeLabel, note: `所要 ${before.durationMinutes}分` },
      after: { text: after.purposeLabel, note: `所要 ${after.durationMinutes}分` },
      changed:
        !sameIds(before.purposeIds, after.purposeIds) ||
        before.durationMinutes !== after.durationMinutes,
    },
    {
      label: '担当',
      before: { text: before.staffName ?? UNASSIGNED_STAFF, note: '' },
      after: { text: after.staffName ?? UNASSIGNED_STAFF, note: '' },
      changed: before.staffId !== after.staffId,
    },
    {
      label: '場所',
      before: placeCell(before),
      after: placeCell(after),
      changed: !sameIds(before.equipmentIds, after.equipmentIds),
    },
  ]
  return rows.some((row) => row.changed) ? rows : []
}

/* --- 読み上げ文 ----------------------------------------------------------- */

/**
 * お客様へ読み上げる 1 文。**確定の前に読む文なので完了形にしない**
 * （`design/06-use-cases.md` IDX-CHANGE-04 手順 5）。丁重語（「でございます」）も使わず、
 * BOOK-05-CONFIRM と同じ「読み返して同意をいただく」形に揃える。
 * モックの「変更いたしました」「でございます」は採らない。
 *
 * 担当がまだ決まっていないご予約では「担当は…」の節をまるごと落とす
 * （「担当は担当が未定、」と読める文を作らない）。
 */
export function sayOnConfirm(after: ReservationSnapshot): string {
  const at = jstOf(after.startsAt)
  const half = at.getUTCHours() < 12 ? '午前' : '午後'
  const hour = at.getUTCHours() % 12 === 0 ? 12 : at.getUTCHours() % 12
  const minutes = at.getUTCMinutes() === 0 ? '' : `${at.getUTCMinutes()}分`
  const weekday = WEEKDAYS[at.getUTCDay()] ?? ''
  const staff = after.staffName === null ? '' : `担当は${after.staffName}、`
  return (
    `${at.getUTCMonth() + 1}月${at.getUTCDate()}日${weekday}曜日、${half}${hour}時${minutes}へ` +
    `お時間を変更いたします。${staff}所要時間は約${after.durationMinutes}分です。` +
    'こちらでお間違いないでしょうか？'
  )
}

/* --- 取消 ----------------------------------------------------------------- */

/** CHANGE-CANCEL の 4 択。**既定値を持たない**（選ぶまで取り消せない）。 */
type CancelReason = ReservationCancelInput['reason']

/** 取り消したあとの姿。理由そのものは `cancel_reason` に残して分析の内訳に使う。 */
export type CancelOutcome = {
  status: Extract<ReservationStatus, 'cancelled' | 'no_show'>
  cancelledAt: string
  reason: CancelReason
}

/**
 * 理由から結果の状態を決める。**「ご来店がなかった」だけが `no_show`** で、
 * お客様のご都合・店舗の都合・予約の重複の 3 つは `cancelled` になる
 * （受付履歴の「結果」は 成立 / 取消 / ご来店なし の 3 語で、この分け方に対応する）。
 *
 * 時刻は引数で受ける。`cancelled_at` にサーバ時刻を入れるので、ここで `Date.now()` を
 * 呼ぶと実時刻に依存したテストしか書けなくなる。
 */
export function cancelOutcome(reason: CancelReason, now: Date): CancelOutcome {
  return {
    status: reason === 'no_show' ? 'no_show' : 'cancelled',
    cancelledAt: now.toISOString(),
    reason,
  }
}

/* --- バッチ --------------------------------------------------------------- */

/**
 * 版のガード。置き換え・削除・追記の**全文に一字一句同じ**で付ける。
 * `organization_id` を落とさない（全 D1 クエリをテナントで絞る決めと、
 * 索引の先頭列を欠かさないため。`booking.ts` の `LOCKED` と同じ理由）。
 */
const VERSION_GUARD =
  'EXISTS (SELECT 1 FROM reservations WHERE organization_id = ? AND id = ? AND version = ?)'

/**
 * 枠のガード。**このバッチで入った占有行が要求どおりの本数あるか**を数える。
 * 1 本でも入らなかった（＝ 409 `slot_taken`）ときに、本体・目的・割当・監査が
 * 書き換わらないようにする。
 */
const SLOT_GUARD =
  '(SELECT COUNT(*) FROM reservation_slot_locks ' +
  'WHERE organization_id = ? AND reservation_id = ? AND created_at = ?) = ?'

/**
 * 上限判定の内側（`db/slot-locks.ts` の `capacityReached` と同じ文）。要求する枠を
 * JSON の配列 1 個で渡すのは、D1 の compound SELECT が 5 項までしか受けないためである。
 */
const CAPACITY_REACHED =
  'SELECT 1 FROM json_each(?) w WHERE (' +
  'SELECT COUNT(*) FROM reservation_slot_locks l ' +
  'WHERE l.organization_id = ? AND l.store_id = ? ' +
  "AND l.kind = json_extract(w.value, '$.kind') " +
  "AND l.target_key = json_extract(w.value, '$.targetKey') " +
  "AND l.slot_start = json_extract(w.value, '$.slotStart') " +
  'AND l.reservation_id <> ?' +
  ") >= json_extract(w.value, '$.cap')"

/** 監査の 1 行に入る列。`booking.ts` と同じ並び。 */
const AUDIT_COLUMNS =
  'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, ' +
  'action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) '

/** 1 予約に載せるご用件 1 件。所要は**予約した時点の写し**で凍結する。 */
type ChangePurposeLine = { purposeId: string; durationMinutes: number; sortOrder: number }

/** 担当・設備の押さえ 1 本。`targetId` の `null` は「あとで決める」。 */
type ChangeAssignment = { kind: 'staff' | 'equipment'; targetId: string | null }

/** 変更 1 件ぶんの材料。 */
export type ChangeBatchInput = {
  db: D1Database
  organizationId: string
  storeId: string
  reservationId: string
  /** 送られてきた版。全文のガードがこの値を見る。 */
  version: number
  /** このバッチの時刻（ISO8601）。古い枠と新しい枠をこの値で見分ける。 */
  batchAt: string
  /** 新しく押さえる枠。`slotLockRequests` の結果をそのまま渡す。 */
  requests: readonly SlotLockRequest[]
  after: {
    startsAt: string
    /** 片付け時間は含めない。 */
    endsAt: string
    durationMinutes: number
    noteCustomer: string
    noteInternal: string
  }
  purposes: readonly ChangePurposeLine[]
  assignments: readonly ChangeAssignment[]
  /** 共有端末で個人が未確認なら null。 */
  actorId: string | null
  /** 1 操作でまとまった行を束ねる。 */
  correlationId: string
  /** 監査に残す変更前後。平文のお名前・お電話番号を入れない（`07-nfr.md` §6.6）。 */
  audit: { before: unknown; after: unknown }
  /** id の作り方を差し替えられるようにしておく（既定は `crypto.randomUUID()`）。 */
  newId?: () => string
}

/** 取消 1 件ぶんの材料。 */
export type CancelBatchInput = {
  db: D1Database
  organizationId: string
  storeId: string
  reservationId: string
  version: number
  reason: CancelReason
  /** サーバ時刻。`cancelled_at` と監査の時刻になる。 */
  now: Date
  actorId: string | null
  correlationId: string
  audit: { before: unknown }
  newId?: () => string
}

/**
 * 変更 1 件ぶんの文。**この並びを変えない。**
 *
 * 1. 新しい `reservation_slot_locks` の上限つき条件付き INSERT（枠 1 本 1 文）
 * 2. `reservation_purposes` の置き換え
 * 3. `reservation_assignments` の置き換え
 * 4. `audit_events` の追記
 * 5. 古い `reservation_slot_locks` の DELETE（`created_at <> ?`）
 * 6. 最後に `reservations` の UPDATE（`version` を +1）
 *
 * **新しい枠を取ってから古い枠を返す。**先に DELETE すると、枠が取れずに 409 を返す
 * 経路で古い枠だけが空き、戻せなくなる。
 */
export function buildChangeBatch(input: ChangeBatchInput): D1PreparedStatement[] {
  const { db } = input
  const newId = input.newId ?? (() => crypto.randomUUID())
  const version = [input.organizationId, input.reservationId, input.version] as const
  const slots = [
    input.organizationId,
    input.reservationId,
    input.batchAt,
    input.requests.length,
  ] as const
  /** 版と枠の両方を見るガード。②〜⑤に一字一句同じで付ける。 */
  const guards = `${VERSION_GUARD} AND ${SLOT_GUARD}`
  const guardParams = [...version, ...slots]

  // ① 新しい枠。要求する枠は JSON 1 個にまとめて全文へ配る（項の数を SQL の形に出さない）。
  const capacityParams = [
    JSON.stringify(input.requests),
    input.organizationId,
    input.storeId,
    input.reservationId,
  ]
  const statements: D1PreparedStatement[] = input.requests.map((request) =>
    db
      .prepare(
        'INSERT INTO reservation_slot_locks (id, organization_id, store_id, reservation_id, kind, target_key, slot_start, created_at) ' +
          `SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (${CAPACITY_REACHED}) AND ${VERSION_GUARD}`,
      )
      .bind(
        newId(),
        input.organizationId,
        input.storeId,
        input.reservationId,
        request.kind,
        request.targetKey,
        request.slotStart,
        input.batchAt,
        ...capacityParams,
        ...version,
      ),
  )

  // ② ご用件の置き換え。
  statements.push(
    db
      .prepare(
        `DELETE FROM reservation_purposes WHERE organization_id = ? AND reservation_id = ? AND ${guards}`,
      )
      .bind(input.organizationId, input.reservationId, ...guardParams),
  )
  for (const purpose of input.purposes) {
    statements.push(
      db
        .prepare(
          'INSERT INTO reservation_purposes (id, organization_id, reservation_id, purpose_id, duration_minutes, sort_order, created_at) ' +
            `SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guards}`,
        )
        .bind(
          newId(),
          input.organizationId,
          input.reservationId,
          purpose.purposeId,
          purpose.durationMinutes,
          purpose.sortOrder,
          input.batchAt,
          ...guardParams,
        ),
    )
  }

  // ③ 担当・設備の置き換え。`kind='staff'` は未定でも 1 行作る（`03-data-model.md` §7.3 I-05）。
  statements.push(
    db
      .prepare(
        `DELETE FROM reservation_assignments WHERE organization_id = ? AND reservation_id = ? AND ${guards}`,
      )
      .bind(input.organizationId, input.reservationId, ...guardParams),
  )
  for (const band of input.assignments) {
    statements.push(
      db
        .prepare(
          'INSERT INTO reservation_assignments (id, organization_id, reservation_id, kind, target_id, starts_at, ends_at, created_at) ' +
            `SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guards}`,
        )
        .bind(
          newId(),
          input.organizationId,
          input.reservationId,
          band.kind,
          band.targetId,
          input.after.startsAt,
          input.after.endsAt,
          input.batchAt,
          ...guardParams,
        ),
    )
  }

  // ④ 監査。条件が外れたのに監査だけ残ると、起きなかった操作が記録に残る。
  statements.push(
    db
      .prepare(
        `${AUDIT_COLUMNS}SELECT ?, ?, ?, 'staff', ?, NULL, 'reservation.rescheduled', 'reservation', ?, ?, ?, ?, ? WHERE ${guards}`,
      )
      .bind(
        newId(),
        input.organizationId,
        input.storeId,
        input.actorId,
        input.reservationId,
        JSON.stringify(input.audit.before),
        JSON.stringify(input.audit.after),
        input.correlationId,
        input.batchAt,
        ...guardParams,
      ),
  )

  // ⑤ 古い枠を返す。**新しい枠が入ったあとに消す。**
  statements.push(
    db
      .prepare(
        'DELETE FROM reservation_slot_locks ' +
          `WHERE organization_id = ? AND reservation_id = ? AND created_at <> ? AND ${guards}`,
      )
      .bind(input.organizationId, input.reservationId, input.batchAt, ...guardParams),
  )

  // ⑥ 最後に本体。この 1 文の `meta.changes === 0` が 409 の合図になる。
  statements.push(
    db
      .prepare(
        'UPDATE reservations SET starts_at = ?, ends_at = ?, duration_minutes = ?, ' +
          'note_customer = ?, note_internal = ?, updated_at = ?, version = version + 1 ' +
          `WHERE organization_id = ? AND id = ? AND version = ? AND ${SLOT_GUARD}`,
      )
      .bind(
        input.after.startsAt,
        input.after.endsAt,
        input.after.durationMinutes,
        input.after.noteCustomer,
        input.after.noteInternal,
        input.batchAt,
        ...version,
        ...slots,
      ),
  )
  return statements
}

/**
 * 取消 1 件ぶんの文。**版を +1 する `UPDATE` は変更と同じく最後に置く。**
 *
 * `design/04-api.md` §4.5 の表は `reservations` UPDATE を先頭に書いているが、その並びでは
 * 後続の `EXISTS (… version = ?)` が同じトランザクションの中で必ず外れ、枠の DELETE と
 * 監査が 1 度も走らない。ガードを付ける決め（同 §3.6 の 3）を成り立たせるほうを採る。
 */
export function buildCancelBatch(input: CancelBatchInput): D1PreparedStatement[] {
  const { db } = input
  const newId = input.newId ?? (() => crypto.randomUUID())
  const outcome = cancelOutcome(input.reason, input.now)
  const version = [input.organizationId, input.reservationId, input.version] as const

  return [
    // 枠を返す。版のガードが無いと、409 のときに枠だけ空いて二重予約になる。
    db
      .prepare(
        'DELETE FROM reservation_slot_locks ' +
          `WHERE organization_id = ? AND reservation_id = ? AND ${VERSION_GUARD}`,
      )
      .bind(input.organizationId, input.reservationId, ...version),
    db
      .prepare(
        `${AUDIT_COLUMNS}SELECT ?, ?, ?, 'staff', ?, NULL, 'reservation.cancelled', 'reservation', ?, ?, ?, ?, ? WHERE ${VERSION_GUARD}`,
      )
      .bind(
        newId(),
        input.organizationId,
        input.storeId,
        input.actorId,
        input.reservationId,
        JSON.stringify(input.audit.before),
        JSON.stringify({ status: outcome.status, cancelReason: outcome.reason }),
        input.correlationId,
        outcome.cancelledAt,
        ...version,
      ),
    db
      .prepare(
        'UPDATE reservations SET status = ?, cancelled_at = ?, cancel_reason = ?, ' +
          'updated_at = ?, version = version + 1 ' +
          'WHERE organization_id = ? AND id = ? AND version = ?',
      )
      .bind(outcome.status, outcome.cancelledAt, outcome.reason, outcome.cancelledAt, ...version),
  ]
}
