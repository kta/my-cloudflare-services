/**
 * 枠の一次排他。**上限つきの条件付き INSERT** を 1 枠 1 文で組み立てる。
 *
 * D1 の `db.batch()` は全文を投げてから結果をまとめて受け取るので、同じバッチの中で
 * 「読んで・判定して・書く」ことができない。確定の直前に重なりを読み直す方式は
 * 読み → 判定 → 書き の 2 往復になり、その間に別の端末の書き込みが入る窓が空く。
 * 1 文で上限を数えながら書ける形はこれしかない（`design/03-data-model.md` §7.6）。
 *
 * **発火したかどうかは `meta.changes`（1 / 0）で読む。**0 行の INSERT はバッチを止めない
 * ので、戻り値を見ずに次へ進むと「409 を返しながら二重予約を作る」形になる。
 *
 * `WHERE NOT EXISTS (…)` は**この予約が要求する全枠に一字一句同じで付ける**。
 * 自分の行を `l.reservation_id <> ?` で除くため判定はバッチの途中で変わらず、
 * **N 本すべてが入るか 1 本も入らないかのどちらか**になる。
 *
 * 書く経路そのもの（`POST /api/staff/reservations`）は `006-booking-flow` が足す。
 * P2 でこの文を置くのは、**上限の数え方を空き枠エンジンと 1 つに決める**ためである。
 *
 * **P3 への申し送り**: 空き枠エンジンが読むのは `reservation_assignments` の区間、
 * 上限を止めるのはこの表の行で、**2 つの表の同期は誰も保証していない**。
 * 空き枠は `status IN ('cancelled','no_show')` のご予約を塞がりから外すので
 * （`db/queries/ledger.ts` の `NOT_OCCUPYING`）、取消・ご来店なしを付けるときに
 * `releaseSlotLocks` を同じ `db.batch()` で呼ばないと、**「空いていると案内した枠が
 * 409 で取れない」**が起きる（`03-data-model.md` §7.6「取り消した予約の行は残さない」）。
 */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

/** 担当が未定のレーンの鍵。NULL を使わない（NULL 同士は `=` で結べない）。 */
export const UNASSIGNED_TARGET_KEY = 'unassigned'

/**
 * 店舗まるごとのレーンの鍵。**同時受付上限（`store_slot_rules.max_parallel`）を
 * 数えるのはこのレーンである。**
 *
 * 上限判定は `target_key` が一致する行しか数えない。担当が決まっているご予約の
 * `target_key` は `staff.id` なので、担当が別なら互いに数え合わず、
 * **`max_parallel = 3` の店の同じ枠に 4 件が入る**（実測）。空き枠エンジンは同じ盤面を
 * `max_parallel` で断る（`domain/availability.ts` の ⑦ は担当の割当行を全部数える）ので、
 * このレーンが無いと「表示は満席・DB は通す」で判定が食い違う。
 * `design/03-data-model.md` §7.6 の「同時受付上限もこの表が DB 側で止める」を成り立たせる
 * ために、**1 予約 1 枠につき必ず 1 行**入れる。
 */
export const STORE_TARGET_KEY = 'store'

/**
 * 押さえる枠 1 つ。`cap` はハンドラの入口で 1 回だけ読んで渡す
 * （`kind='staff'` かつ対象が決まっていれば `staff.max_parallel_reservations`、
 * `kind='equipment'` なら `equipment.capacity`、未定のレーンと `kind='store'` は
 * `store_slot_rules.max_parallel`）。
 */
export type SlotLockRequest = {
  kind: 'staff' | 'equipment' | 'store'
  targetKey: string
  /** 刻みの格子に載った時刻（ISO8601）。 */
  slotStart: string
  cap: number
}

/** 1 予約ぶんの押さえ。`slotStarts` は `expandToSlotStarts` の結果をそのまま渡す。 */
export type SlotLockClaim = {
  /** 刻みの格子に載った、この予約が使う枠すべて。 */
  slotStarts: readonly string[]
  /** 担当。決まっていなければ `null`（`unassigned` のレーンに積む）。 */
  staff: { id: string; maxParallelReservations: number } | null
  /** 設備。0〜2 台。 */
  equipment?: readonly { id: string; capacity: number }[]
  /** `store_slot_rules.max_parallel`。店舗レーンと担当未定レーンの上限になる。 */
  maxParallel: number
}

/**
 * 1 予約ぶんの押さえを、**数え方を空き枠エンジンと 1 つにした形**で組み立てる。
 * `slotLockStatements` へ直に配列を渡さず必ずここを通すことで、店舗レーン
 * （`STORE_TARGET_KEY`）の入れ忘れで同時受付上限が素通りする経路を作らない。
 *
 * 出る行は 1 枠につき「店舗 1 ＋ 担当 1 ＋ 設備 0〜2」。
 * `domain/availability.ts` の `buildOccupancy` と 1 対 1 で対応する
 * （`totals` ↔ 店舗レーン、`staff:<id>` / `staff:unassigned` ↔ 担当レーン、
 * `equipment:<id>` ↔ 設備レーン）。
 */
export function slotLockRequests(input: SlotLockClaim): SlotLockRequest[] {
  const requests: SlotLockRequest[] = []
  for (const slotStart of input.slotStarts) {
    // 店舗まるごとの同時受付上限。担当が決まっていても未定でも必ず 1 行入れる。
    requests.push({ kind: 'store', targetKey: STORE_TARGET_KEY, slotStart, cap: input.maxParallel })
    requests.push(
      input.staff === null
        ? { kind: 'staff', targetKey: UNASSIGNED_TARGET_KEY, slotStart, cap: input.maxParallel }
        : {
            kind: 'staff',
            targetKey: input.staff.id,
            slotStart,
            cap: input.staff.maxParallelReservations,
          },
    )
    for (const unit of input.equipment ?? []) {
      requests.push({ kind: 'equipment', targetKey: unit.id, slotStart, cap: unit.capacity })
    }
  }
  return requests
}

export type SlotLockBatchInput = {
  organizationId: string
  storeId: string
  reservationId: string
  /** このバッチの時刻。同じ予約の古い行と新しい行をこの値で見分ける。 */
  createdAt: string
  requests: readonly SlotLockRequest[]
  /** 呼び出し元の楽観ロックなど、容量判定と同時に満たす条件。 */
  additionalGuard?: { condition: string; params: readonly unknown[] }
  /** id の作り方を差し替えられるようにしておく（既定は `crypto.randomUUID()`）。 */
  newId?: () => string
}

/**
 * 上限判定の内側。要求する枠を 1 つずつ数え、**1 つでも埋まっていれば真**になる。
 *
 * 要求は `SELECT ? UNION ALL SELECT ?…` の派生表ではなく **JSON の配列 1 個**で渡す。
 * `design/03-data-model.md` §7.6 の SQL は `UNION ALL` で書いてあるが、
 * **D1 の compound SELECT は 5 項までしか受け取らない**（実測: 6 項目で
 * `too many terms in compound SELECT: SQLITE_ERROR`）。1 予約は「（所要 ＋ 片付け）÷ 刻み」
 * 枠 ×（店舗 1 ＋ 担当 1 ＋ 設備 0〜2）行を要求するので、60 分・刻み 30 分・設備 2 台の
 * ごく普通のご予約が 12 項になり、確定が丸ごと 500 で落ちる。
 * SQLite の複数行 `VALUES` も内部では compound SELECT なので同じ壁に当たる。
 * `json_each` なら項の数が SQL の形に出ないので、枠が何本でも 1 文で書ける。
 *
 * **代償: 枠の本数に対して二乗で効く。**要求する枠の全体を JSON 1 個にして、その 1 個を
 * 枠の本数ぶんの全文へ配るので、N 枠の予約は N×N 個の枠記述子をバインドする
 * （実測: 10:00 から 480 分・設備 5 台の 119 文で 1 回の確定に約 1.5MB）。
 * ふつうのご予約は 9〜16 文なので実害は無いが、所要と設備の上限を緩めるときは
 * ここを先に見る。
 */
function capacityReached(): string {
  return (
    'SELECT 1 FROM json_each(?) w WHERE (' +
    'SELECT COUNT(*) FROM reservation_slot_locks l ' +
    'WHERE l.organization_id = ? AND l.store_id = ? ' +
    "AND l.kind = json_extract(w.value, '$.kind') " +
    "AND l.target_key = json_extract(w.value, '$.targetKey') " +
    "AND l.slot_start = json_extract(w.value, '$.slotStart') " +
    'AND l.reservation_id <> ?' +
    ") >= json_extract(w.value, '$.cap')"
  )
}

/**
 * 要求した枠の本数ぶんの文を返す。**予約本体と同じ `db.batch()` に並べる。**
 * 1 本目の `meta.changes` が 0 なら 409 `slot_taken` を返す。
 */
export function slotLockStatements(
  db: D1Database,
  input: SlotLockBatchInput,
): D1PreparedStatement[] {
  if (input.requests.length === 0) return []
  const newId = input.newId ?? (() => crypto.randomUUID())
  const guard = capacityReached()
  // 要求する枠は JSON 1 個にまとめて渡す（項の数が SQL の形に出ないので枠が何本でも通る）。
  const guardParams = [
    JSON.stringify(input.requests),
    input.organizationId,
    input.storeId,
    input.reservationId,
  ]

  return input.requests.map((request) =>
    db
      .prepare(
        'INSERT INTO reservation_slot_locks (id, organization_id, store_id, reservation_id, kind, target_key, slot_start, created_at) ' +
          `SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (${guard})${input.additionalGuard === undefined ? '' : ` AND ${input.additionalGuard.condition}`}`,
      )
      .bind(
        newId(),
        input.organizationId,
        input.storeId,
        input.reservationId,
        request.kind,
        request.targetKey,
        request.slotStart,
        input.createdAt,
        ...guardParams,
        ...(input.additionalGuard?.params ?? []),
      ),
  )
}

/** 取消・変更でその予約の行をまとめて返す。`exceptCreatedAt` を渡すと古い行だけを消す。 */
export function releaseSlotLocks(
  db: D1Database,
  input: { organizationId: string; reservationId: string; exceptCreatedAt?: string },
): D1PreparedStatement {
  if (input.exceptCreatedAt === undefined) {
    return db
      .prepare(
        'DELETE FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ?',
      )
      .bind(input.organizationId, input.reservationId)
  }
  return db
    .prepare(
      'DELETE FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ? AND created_at <> ?',
    )
    .bind(input.organizationId, input.reservationId, input.exceptCreatedAt)
}
