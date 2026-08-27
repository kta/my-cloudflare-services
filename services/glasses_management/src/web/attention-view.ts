/**
 * 注意事項・監査・顧客統合の画面が共有する「言葉と数え方」だけを持つ層。
 *
 * ここに DOM も React も無い。静かに壊れるのは表示ロジック（適用元の取り違え、
 * 影響件数の数え違い、JST 日跨ぎのズレ、変更前後の突き合わせ漏れ）なので、
 * その判断を画面から剥がしてここで直接テストする。
 *
 * 時刻は必ず引数で受け取る。`Date.now()` も実行時タイムゾーンもここには無い。
 * 日本に夏時間は無いので JST は固定 +09:00 として扱ってよい。
 */

import {
  ATTENTION_CAPABILITIES,
  type AttentionCapability,
  type AttentionNoteStatus,
  type AttentionReviewDecision,
  type AttentionRole,
  type AttentionSettings,
  type AttentionSettingsOrigin,
  type AttentionSharingScope,
  type AttentionSharingScopeImpact,
  type AttentionVersionConflict,
  type AuditEventView,
  type CustomerMergeImpact,
  type StorePermission,
} from '@app/contracts'

/* ------------------------------------------------------------------ *
 * ラベル (UC-EYEX-139〜142, AC-EYEX-84)
 * ------------------------------------------------------------------ */

const CAPABILITY_LABEL: Record<AttentionCapability, string> = {
  read: '閲覧',
  write: '登録',
  publish: '公開',
  revise: '改訂',
  hide: '非表示化',
}

export function capabilityLabel(capability: AttentionCapability): string {
  return CAPABILITY_LABEL[capability]
}

const ROLE_LABEL: Record<AttentionRole, string> = {
  staff: 'スタッフ',
  store_manager: '店舗管理者',
  organization_admin: '本部管理者',
}

export function roleLabel(role: AttentionRole): string {
  return ROLE_LABEL[role]
}

const SHARING_SCOPE_LABEL: Record<AttentionSharingScope, string> = {
  permitted_stores: '権限のある店舗',
  chain: 'チェーン全体',
}

export function sharingScopeLabel(scope: AttentionSharingScope): string {
  return SHARING_SCOPE_LABEL[scope]
}

const ORIGIN_LABEL: Record<AttentionSettingsOrigin, string> = {
  organization: '組織共通',
  store: '店舗上書き',
}

export function originLabel(origin: AttentionSettingsOrigin): string {
  return ORIGIN_LABEL[origin]
}

/**
 * 能力とそれを裏づける店舗権限の対応。設定は権限を新しく生やさず、
 * `attention.<capability>` の上にロールの門を足すだけである。
 */
const CAPABILITY_PERMISSION: Record<AttentionCapability, StorePermission> = {
  read: 'attention.read',
  write: 'attention.write',
  publish: 'attention.publish',
  revise: 'attention.revise',
  hide: 'attention.hide',
}

export function attentionPermissionFor(capability: AttentionCapability): StorePermission {
  return CAPABILITY_PERMISSION[capability]
}

export type AttentionCapabilityRow = {
  capability: AttentionCapability
  label: string
  minimumRole: AttentionRole
  roleLabel: string
  originLabel: string
}

/**
 * 5 能力を契約の順序どおりに並べ、それぞれの適用元を添える (AC-EYEX-84)。
 * サーバの並び順に依存させない。並びが揺れると読み手が別の行を読む。
 */
export function attentionCapabilityRows(settings: AttentionSettings): AttentionCapabilityRow[] {
  return ATTENTION_CAPABILITIES.map((capability) => {
    const rule = settings.capabilities.find((candidate) => candidate.capability === capability)
    const minimumRole: AttentionRole = rule?.minimumRole ?? 'organization_admin'
    const origin: AttentionSettingsOrigin = rule?.origin ?? 'organization'
    return {
      capability,
      label: CAPABILITY_LABEL[capability],
      minimumRole,
      roleLabel: ROLE_LABEL[minimumRole],
      originLabel: ORIGIN_LABEL[origin],
    }
  })
}

/**
 * 承認済みモック `ATTENTION-PERMISSIONS--default--ipad-landscape.png` の列見出し。
 * 表の中では `非表示化` ではなく `非表示` と書く（列幅の都合ではなく承認済みの文言）。
 */
const CAPABILITY_COLUMN_LABEL: Record<AttentionCapability, string> = {
  read: '閲覧',
  write: '登録',
  publish: '公開',
  revise: '改訂',
  hide: '非表示',
}

export function capabilityColumnLabel(capability: AttentionCapability): string {
  return CAPABILITY_COLUMN_LABEL[capability]
}

const ROLE_RANK: Record<AttentionRole, number> = {
  staff: 0,
  store_manager: 1,
  organization_admin: 2,
}

/** 表に並ぶロールの順序。モックと同じ 3 段。 */
export const ATTENTION_ROLES: readonly AttentionRole[] = Object.freeze([
  'staff',
  'store_manager',
  'organization_admin',
] as const)

export type AttentionMatrixCell = {
  capability: AttentionCapability
  /** `許可` / `確認待ち` / `不可` のいずれか。色ではなく文字が可否を運ぶ。 */
  label: string
  allowed: boolean
}

export type AttentionMatrixRow = {
  role: AttentionRole
  label: string
  cells: AttentionMatrixCell[]
}

/**
 * ロール×操作の許可表 (UC-EYEX-140, AC-EYEX-84)。
 *
 * 登録だけは「できる／できない」の二値では足りない。管理者確認後に公開する設定
 * では、公開権限を持たないロールの登録は必ず確認待ちで止まる。そこを `許可` と
 * 書くと、スタッフは自分の登録がその場で共有されたと誤解する。
 */
export function attentionMatrixRows(settings: AttentionSettings): AttentionMatrixRow[] {
  const minimumRoleOf = (capability: AttentionCapability): AttentionRole =>
    settings.capabilities.find((rule) => rule.capability === capability)?.minimumRole ??
    'organization_admin'
  const publishRank = ROLE_RANK[minimumRoleOf('publish')]
  return ATTENTION_ROLES.map((role) => ({
    role,
    label: ROLE_LABEL[role],
    cells: ATTENTION_CAPABILITIES.map((capability) => {
      const allowed = ROLE_RANK[role] >= ROLE_RANK[minimumRoleOf(capability)]
      const pending =
        allowed &&
        capability === 'write' &&
        settings.reviewMode === 'review_required' &&
        ROLE_RANK[role] < publishRank
      return { capability, allowed, label: !allowed ? '不可' : pending ? '確認待ち' : '許可' }
    }),
  }))
}

/* ------------------------------------------------------------------ *
 * 共有範囲の影響 (UC-EYEX-142, AC-EYEX-118)
 * ------------------------------------------------------------------ */

/** 変更前に「何件がどこへ動くか」を一文で言い切る (AC-EYEX-118)。 */
export function sharingScopeImpactSummary(impact: AttentionSharingScopeImpact): string {
  const to = SHARING_SCOPE_LABEL[impact.requestedScope]
  if (impact.affectedNoteCount === 0)
    return `過去の注意事項に影響はありません。今後の登録から「${to}」で共有されます。`
  const from = SHARING_SCOPE_LABEL[impact.currentScope]
  return `既存の注意事項 ${impact.affectedNoteCount}件（顧客 ${impact.affectedCustomerCount}人・店舗 ${impact.affectedStoreCount}店舗）が「${from}」から「${to}」へ変わります。`
}

/* ------------------------------------------------------------------ *
 * 状態と判断 (AC-EYEX-85, 116, UC-EYEX-145, 146)
 * ------------------------------------------------------------------ */

const STATUS_LABEL: Record<AttentionNoteStatus, string> = {
  pending_review: '確認待ち',
  published: '公開済み',
  returned: '差戻し',
  rejected: '却下',
  superseded: '旧版',
  hidden: '非表示',
}

export function noteStatusLabel(status: AttentionNoteStatus): string {
  return STATUS_LABEL[status]
}

/** 色は補助。語（`noteStatusLabel`）が常に添えられる前提の色分けである。 */
export function noteStatusTone(
  status: AttentionNoteStatus,
): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'published') return 'success'
  if (status === 'pending_review' || status === 'returned') return 'warning'
  if (status === 'rejected') return 'danger'
  return 'neutral'
}

const DECISION_LABEL: Record<AttentionReviewDecision, string> = {
  publish: '公開',
  return: '差戻し',
  reject: '却下',
}

export function reviewDecisionLabel(decision: AttentionReviewDecision): string {
  return DECISION_LABEL[decision]
}

/** 共有端末で個人認証を要求する操作の説明 (UC-EYEX-137, AC-EYEX-87)。 */
export function attentionActionLabel(action: 'publish' | 'revise' | 'hide'): string {
  return `注意事項の${action === 'publish' ? '公開' : action === 'revise' ? '改訂' : '非表示化'}`
}

/* ------------------------------------------------------------------ *
 * 版の競合 (AC-EYEX-117)
 * ------------------------------------------------------------------ */

const NOTE_FIELD_LABEL: Record<string, string> = {
  body: '発生した事実',
  occurredAt: '発生日時',
  basis: '根拠',
  recommendedAction: '推奨対応',
  status: '状態',
  version: '版',
  sharingScope: '共有範囲',
}

export type VersionConflictRow = {
  field: string
  label: string
  before: string
  after: string
}

/** 古い版から公開しようとしたときに見せる新旧差分 (AC-EYEX-117)。 */
export function versionConflictRows(conflict: AttentionVersionConflict): VersionConflictRow[] {
  return conflict.differences.map((difference) => ({
    field: difference.field,
    label: NOTE_FIELD_LABEL[difference.field] ?? difference.field,
    before: difference.before === '' ? '（未記録）' : difference.before,
    after: difference.after === '' ? '（未記録）' : difference.after,
  }))
}

/* ------------------------------------------------------------------ *
 * JST の日時
 * ------------------------------------------------------------------ */

const JST = 'Asia/Tokyo'
const dayFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})
const timeFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const isoDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: JST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** `2026年8月25日 15:10` — 保存された UTC を、店頭が読む JST の壁時計で返す。 */
export function formatJstInstant(instant: string): string {
  const at = new Date(instant)
  if (Number.isNaN(at.getTime())) return instant
  return `${dayFormat.format(at)} ${timeFormat.format(at)}`
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/**
 * `<input type="datetime-local">` の JST 壁時計を保存用インスタントへ。
 * 読めない値は握りつぶさず `undefined` を返し、呼び出し側に失敗を見せる。
 */
export function jstWallClockToInstant(wallClock: string): string | undefined {
  if (!WALL_CLOCK.test(wallClock)) return undefined
  const at = new Date(`${wallClock}:00+09:00`)
  if (Number.isNaN(at.getTime())) return undefined
  return at.toISOString()
}

/** 逆向き。改訂フォームへ現在の値を戻すときに使う。 */
export function instantToJstWallClock(instant: string): string {
  const at = new Date(instant)
  if (Number.isNaN(at.getTime())) return ''
  return `${isoDayFormat.format(at)}T${timeFormat.format(at)}`
}

/* ------------------------------------------------------------------ *
 * 監査 (UC-EYEX-155, AC-EYEX-102)
 * ------------------------------------------------------------------ */

/** 監査値は型を落とさない。`null` と「鍵が無い」を混ぜると読み違える。 */
export function auditValueText(value: unknown): string {
  if (value === undefined) return '（なし）'
  if (value === null) return '（空）'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export type AuditDiffRow = { key: string; before: string; after: string }

/** 変更前後を同じ鍵で突き合わせて並べる (AC-EYEX-102)。 */
export function auditDiffRows(event: AuditEventView): AuditDiffRow[] {
  const before = event.before ?? {}
  const after = event.after ?? {}
  const keys = [...Object.keys(before), ...Object.keys(after).filter((key) => !(key in before))]
  return keys.map((key) => ({
    key,
    before: auditValueText(before[key]),
    after: auditValueText(after[key]),
  }))
}

/* ------------------------------------------------------------------ *
 * 顧客統合の影響 (UC-EYEX-181, AC-EYEX-121)
 * ------------------------------------------------------------------ */

const MERGE_IMPACT_LABEL: Record<keyof CustomerMergeImpact, string> = {
  reservations: '予約',
  walkins: 'ウォークイン',
  prescriptions: '度数記録',
  notes: '接客メモ',
  attentionNotes: '注意事項',
  ownedGlasses: '所有メガネ',
}

const MERGE_IMPACT_KEYS = [
  'reservations',
  'walkins',
  'prescriptions',
  'notes',
  'attentionNotes',
  'ownedGlasses',
] as const

export type MergeImpactRow = { key: keyof CustomerMergeImpact; label: string; count: number }

/** 統合が動かす履歴を、実行前に項目ごとに見せる (AC-EYEX-121)。 */
export function mergeImpactRows(impact: CustomerMergeImpact): MergeImpactRow[] {
  return MERGE_IMPACT_KEYS.map((key) => ({
    key,
    label: MERGE_IMPACT_LABEL[key],
    count: impact[key],
  }))
}

/** サーバが承認値として突き合わせる合計。画面はこの値だけを送る。 */
export function mergeImpactTotal(impact: CustomerMergeImpact): number {
  return MERGE_IMPACT_KEYS.reduce((sum, key) => sum + impact[key], 0)
}

/**
 * 承認済みモック `ATTENTION-REVIEW--pending--ipad-landscape.png` の待ち行列の見出し
 * 「田中 花子 · 本日」。今日と昨日だけ言葉にし、それ以外は日付をそのまま出す。
 *
 * `today` は JST の `YYYY-MM-DD` を必ず引数で受け取る。壁時計はここには無い。
 */
export function relativeJstDay(instant: string, today: string): string {
  const day = instantToJstWallClock(instant).slice(0, 10)
  if (day === today) return '本日'
  const yesterday = new Date(`${today}T00:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  if (day === yesterday.toISOString().slice(0, 10)) return '昨日'
  return day
}
