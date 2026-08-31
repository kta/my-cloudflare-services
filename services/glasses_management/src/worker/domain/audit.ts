/**
 * 監査（`audit_events`）の組み立て。**追記専用**で、書き換える経路も消す経路も作らない。
 *
 * 主体は**リクエストの入力から作らない** — 送られてきた担当 id を信じると、
 * 誰でも他人の名前で行を残せる。端末セッションだけが主体を決める
 * （個人モード = その本人、共有モード = 端末そのもの、セッションが無ければ system）。
 *
 * `target_type` は**対象のテーブル名そのまま（snake_case・複数形）**である
 * （`07-nfr.md` §7.2）。
 */

import type { AuditActorType } from '@app/contracts'
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

/** 監査に残す主体。`terminalId` はどの端末から起きたか（個人の端末でも埋める）。 */
export type AuditActor = {
  type: AuditActorType
  id: string | null
  terminalId: string | null
}

/** 主体を決める材料。生きている端末セッション 1 本ぶん。 */
export type ActorSession = {
  id: string
  terminalId: string
  staffId: string | null
  mode: string
}

/**
 * 主体を決める。**セッションが無い経路（内部同期・端末を 1 台も登録していない最初の
 * 1 回）は `system`** で、`actor_id` は残さない（誰の名前でもない操作だから）。
 */
export function resolveActor(session: ActorSession | null): AuditActor {
  if (session === null) return { type: 'system', id: null, terminalId: null }
  if (session.mode === 'personal' && session.staffId !== null) {
    return { type: 'staff', id: session.staffId, terminalId: session.terminalId }
  }
  return { type: 'terminal', id: session.terminalId, terminalId: session.terminalId }
}

/** 監査に載せてはいけないキー（`07-nfr.md` §7.1）。 */
const SECRET_KEY = /pin|password|email|hash/i

const isSecret = (key: string): boolean => SECRET_KEY.test(key)

/**
 * 変わった項目だけを残す。値が同じ項目も、秘密を含むキーも落とす。
 * 片側にしか無いキーも「変わった」と数える（追加・削除が読めるようにする）。
 */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {}
  const changedAfter: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (isSecret(key)) continue
    const from = before[key]
    const to = after[key]
    if (Object.is(from, to)) continue
    if (key in before) changedBefore[key] = from
    if (key in after) changedAfter[key] = to
  }
  return { before: changedBefore, after: changedAfter }
}

/** 監査 1 行の材料。`occurredAt` と `correlationId` は呼び出し側が注入する。 */
export type AuditInput = {
  organizationId: string
  /** 組織そのものへの操作（admin からの同期）だけ null になる。 */
  storeId: string | null
  actor: AuditActor
  action: string
  /** テーブル名そのまま（snake_case・複数形）。 */
  targetType: string
  targetId: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  correlationId: string
  occurredAt: string
  /**
   * 版や枠の条件が付くバッチで、**本処理と同じ条件**を監査にも当てるガード。
   * D1 のバッチは 0 行しか当たらない `UPDATE` でも中断せず後続を commit するので、
   * これが無いと「409 を返したのに、起きなかった操作の監査だけが残る」。
   */
  guard?: { clause: string; params: readonly unknown[] }
}

/** 監査 1 行を `db.batch()` に並べられる形で返す。 */
export function auditInsert(db: D1Database, input: AuditInput): D1PreparedStatement {
  const where = input.guard === undefined ? '' : ` WHERE ${input.guard.clause}`
  const json = (value: Record<string, unknown> | null | undefined): string | null =>
    value === null || value === undefined ? null : JSON.stringify(value)
  return db
    .prepare(
      'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, ' +
        'action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
        `SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${where}`,
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.storeId,
      input.actor.type,
      input.actor.id,
      input.actor.terminalId,
      input.action,
      input.targetType,
      input.targetId,
      json(input.before),
      json(input.after),
      input.correlationId,
      input.occurredAt,
      ...(input.guard?.params ?? []),
    )
}
