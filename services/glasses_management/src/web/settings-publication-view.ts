/**
 * 設定の 下書き → 影響確認 → 公開 の閉ループを、DOM に触れずに決める部分。
 *
 * ここが受け持つのは「何を状態と呼ぶか」「何を警告と呼ぶか」「どの店舗を
 * 再試行対象にするか」「境界の日時をどう読ませるか」の 4 点で、いずれも
 * 画面から見ると静かに壊れる場所なので、DOM ではなくここで直接テストする。
 *
 * 時刻は必ず引数で受け取る。`Date.now()` も実行時タイムゾーンもここには無い。
 * 日本には夏時間が無いので JST は固定 +09:00 として扱ってよい。
 */

import type {
  SettingsConflictResolutionKind,
  SettingsDraft,
  SettingsImpactItem,
  SettingsImpactKind,
  SettingsImpactReport,
  SettingsImpactSeverity,
  SettingsOrigin,
  SettingsPublication,
  SettingsPublicationStatus,
  SettingsPublicationTarget,
  SettingsVersionDetail,
} from '@app/contracts'

const JST = 'Asia/Tokyo'

const instantFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** A stored UTC instant, read back as the JST wall clock an operator recognises. */
export function formatJstInstant(instant: string): string {
  const parsed = new Date(instant)
  if (Number.isNaN(parsed.getTime())) return instant
  return instantFormat.format(parsed)
}

const JST_WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/**
 * A JST wall clock (`YYYY-MM-DDTHH:mm`) rendered without ever becoming an
 * instant: converting to UTC and back is exactly where a boundary minute goes
 * missing, so the string is read literally (UC-EYEX-166).
 */
function formatJstWallClock(value: string): string {
  const match = JST_WALL_CLOCK.exec(value)
  if (!match) return value
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日 ${match[4]}:${match[5]}`
}

/* ------------------------------------------------------------------ *
 * 状態と警告 (UC-EYEX-159)
 * ------------------------------------------------------------------ */

const DRAFT_STATUS_LABEL: Record<SettingsDraft['status'], string> = {
  draft: '下書き',
  review: '確認待ち',
  scheduled: '公開予約',
  published: '公開中',
  cancelled: '取消',
}

/**
 * 状態は 下書き / 確認待ち / 公開予約 / 公開中 / 受付停止 の 5 つ。
 *
 * 受付停止 は「公開されている設定が今どう動いているか」であって下書きの状態
 * ではない。下書き中に受付停止を選んでも、まだ誰にも見えていないのだから
 * 状態は 下書き のまま — ここを混ぜると「止めたつもりが止まっていない」に
 * なる。
 */
export function settingsStateLabel(draft: SettingsDraft): string {
  if (draft.status === 'published' && draft.settings.receptionStatus === 'paused') {
    return '受付停止'
  }
  return DRAFT_STATUS_LABEL[draft.status]
}

export type SettingsWarning = {
  id: string
  label: string
  tone: 'warning' | 'danger'
}

/** 競合と失敗は状態ではなく警告として、状態表示とは別の場所に出す。 */
export function settingsWarnings(input: {
  impact?: SettingsImpactReport
  publication?: SettingsPublication
}): SettingsWarning[] {
  const warnings: SettingsWarning[] = []
  const unresolved = input.impact === undefined ? [] : unresolvedBlocking(input.impact)
  if (unresolved.length > 0) {
    warnings.push({
      id: 'blocking',
      label: `影響予約${String(unresolved.length)}件が未解消です`,
      tone: 'danger',
    })
  }
  if ((input.impact?.warningCount ?? 0) > 0) {
    warnings.push({
      id: 'warning',
      label: `警告${String(input.impact?.warningCount ?? 0)}件`,
      tone: 'warning',
    })
  }
  if ((input.publication?.failedCount ?? 0) > 0) {
    warnings.push({
      id: 'failure',
      label: `${String(input.publication?.failedCount ?? 0)}店舗で公開が失敗しました`,
      tone: 'danger',
    })
  }
  return warnings
}

/* ------------------------------------------------------------------ *
 * 下書きの保存状態 (UC-EYEX-095, 096, AC-EYEX-45)
 * ------------------------------------------------------------------ */

export type DraftSaveState = {
  label: string
  savedAtLabel: string
  savedByLabel: string
  dirty: boolean
}

/**
 * 画面を離れる前に「保存されているのか」「いつの保存なのか」が読めること。
 * 下書きがまだ無いときに 保存済み と言わないのが要点。
 */
export function draftSaveState(input: { draft?: SettingsDraft; dirty: boolean }): DraftSaveState {
  const draft = input.draft
  if (draft === undefined) {
    return {
      label: '下書きなし',
      savedAtLabel: '最終保存 なし',
      savedByLabel: '変更者 なし',
      dirty: input.dirty,
    }
  }
  return {
    label: input.dirty ? '未保存' : '保存済み',
    savedAtLabel: `最終保存 ${formatJstInstant(draft.savedAt)}`,
    savedByLabel: `変更者 ${draft.savedBy}`,
    dirty: input.dirty,
  }
}

/* ------------------------------------------------------------------ *
 * 影響確認 (UC-EYEX-093, 097, 115, AC-EYEX-43, 44, 46, 66)
 * ------------------------------------------------------------------ */

/** 重大度は語で伝える。色だけに頼らない。 */
export const IMPACT_SEVERITY_LABEL: Record<SettingsImpactSeverity, string> = {
  blocking: '要対応',
  warning: '警告',
  info: '情報',
}

export const IMPACT_KIND_LABEL: Record<SettingsImpactKind, string> = {
  reservation_conflict: '既存予約との競合',
  missing_staff_skill: '技能不足',
  missing_equipment: '設備不足',
  out_of_hours: '営業時間外設定',
  web_slot_change: 'Web公開枠の変化',
}

export const RESOLUTION_LABEL: Record<SettingsConflictResolutionKind, string> = {
  alternative_resource: '代替資源割当',
  keep_exception: '例外維持',
  customer_contacted: '顧客連絡',
}

export const ORIGIN_LABEL: Record<SettingsOrigin, string> = {
  chain: '全店共通',
  store_override: '店舗上書き',
}

/** 重い順に読ませる。同じ重大度のなかは受け取った順のまま。 */
const SEVERITY_ORDER: Record<SettingsImpactSeverity, number> = {
  blocking: 0,
  warning: 1,
  info: 2,
}

type ImpactGroup = {
  kind: SettingsImpactKind
  label: string
  severity: SettingsImpactSeverity
  severityLabel: string
  items: SettingsImpactItem[]
}

export type ImpactSummary = {
  groups: ImpactGroup[]
  blockingCount: number
  warningCount: number
  /** 解消の記録が無いブロッキング項目。これが残るあいだは公開しない。 */
  unresolved: SettingsImpactItem[]
  canPublish: boolean
  /** 公開できない事実そのもの。理由と分けて出す（モックの見出し／本文）。 */
  blockedHeadline?: string
  blockedReason?: string
  /** 未解消のブロッキング件数。カード「ブロッキング」の値。 */
  blockingLabel: string
  /** 警告件数。カード「警告」の値。 */
  warningLabel: string
  slotLabel: string
  ledgerLabel: string
  evaluatedAtLabel: string
}

function unresolvedBlocking(report: SettingsImpactReport): SettingsImpactItem[] {
  return report.items.filter((item) => item.severity === 'blocking' && item.resolution === null)
}

function signedDelta(before: number, after: number): string {
  const delta = after - before
  if (delta === 0) return '±0件'
  return `${delta > 0 ? '+' : '-'}${String(Math.abs(delta))}件`
}

export function impactSummary(report: SettingsImpactReport): ImpactSummary {
  const groups: ImpactGroup[] = []
  for (const item of report.items) {
    const existing = groups.find((group) => group.kind === item.kind)
    if (existing === undefined) {
      groups.push({
        kind: item.kind,
        label: IMPACT_KIND_LABEL[item.kind],
        severity: item.severity,
        severityLabel: IMPACT_SEVERITY_LABEL[item.severity],
        items: [item],
      })
      continue
    }
    existing.items.push(item)
    if (SEVERITY_ORDER[item.severity] < SEVERITY_ORDER[existing.severity]) {
      existing.severity = item.severity
      existing.severityLabel = IMPACT_SEVERITY_LABEL[item.severity]
    }
  }
  groups.sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity])

  const unresolved = unresolvedBlocking(report)
  // サーバが公開不可と言っているあいだは、画面側で解消済みに見えても公開しない。
  const canPublish = report.canPublish && unresolved.length === 0
  return {
    groups,
    blockingCount: report.blockingCount,
    warningCount: report.warningCount,
    unresolved,
    canPublish,
    // 文言は承認済みモック（settings-complete-approved.html #impact）どおり。
    blockedHeadline: canPublish ? undefined : '公開できません',
    blockedReason: canPublish
      ? undefined
      : '影響予約ごとに代替設備、例外維持、顧客連絡を記録してください。',
    blockingLabel: `影響予約${String(unresolved.length)}件`,
    warningLabel: `${String(report.warningCount)}件`,
    slotLabel: `公開枠 ${String(report.publicSlots.publishedCount)}件 → ${String(report.publicSlots.draftCount)}件（${signedDelta(report.publicSlots.publishedCount, report.publicSlots.draftCount)}）`,
    ledgerLabel: `影響する台帳 ${String(report.ledgerEntriesAffected)}件`,
    evaluatedAtLabel: `確認日時 ${formatJstInstant(report.evaluatedAt)}`,
  }
}

/* ------------------------------------------------------------------ *
 * 公開予約 (UC-EYEX-094, 161, 166, AC-EYEX-105)
 * ------------------------------------------------------------------ */

/**
 * 公開予定日時の入力検証。JST の壁時計として読み、当日 00:00 より前は拒否する。
 * `today` は呼び出し側から注入された JST の日付で、ここで時計は読まない。
 */
export function scheduleError(value: string, today: string): string | undefined {
  if (value.trim() === '') return '公開日時を入力してください。'
  const match = JST_WALL_CLOCK.exec(value)
  if (!match || Number(match[4]) > 23 || Number(match[5]) > 59) {
    return '公開日時は YYYY-MM-DDTHH:mm 形式で入力してください。'
  }
  // 文字列比較で足りる。ゼロ埋めされた ISO 風の日付は辞書順が時系列順。
  if (value.slice(0, 10) < today) return '過去の日時は指定できません。'
  return undefined
}

/* ------------------------------------------------------------------ *
 * 公開結果と部分失敗 (UC-EYEX-162, 163, AC-EYEX-106, 107)
 * ------------------------------------------------------------------ */

const PUBLICATION_STATUS_LABEL: Record<SettingsPublicationStatus, string> = {
  scheduled: '公開予約',
  completed: '完了',
  partially_failed: '一部失敗',
  cancelled: '取消',
}

export type PublicationView = {
  id: string
  versionId: string
  statusLabel: string
  statusTone: 'success' | 'warning' | 'danger' | 'neutral'
  scheduledLabel: string
  executedLabel: string
  appliedLabel: string
  failedLabel: string
  webSlotLabel: string
  ledgerLabel: string
  applied: SettingsPublicationTarget[]
  failed: SettingsPublicationTarget[]
  pending: SettingsPublicationTarget[]
  /** 再試行の対象は失敗店舗だけ。成功済み店舗へ同じ版を二度当てない。 */
  retryStoreIds: string[]
  canRetry: boolean
  canReschedule: boolean
  canCancel: boolean
}

export function publicationView(publication: SettingsPublication): PublicationView {
  const failed = publication.targets.filter((target) => target.status === 'failed')
  const effect = publication.webSlotEffect
  return {
    id: publication.id,
    versionId: publication.versionId,
    statusLabel: PUBLICATION_STATUS_LABEL[publication.status],
    statusTone:
      publication.status === 'completed'
        ? 'success'
        : publication.status === 'partially_failed'
          ? 'danger'
          : publication.status === 'scheduled'
            ? 'warning'
            : 'neutral',
    scheduledLabel:
      publication.scheduledForJst === null
        ? '公開予定 即時'
        : `公開予定 ${formatJstWallClock(publication.scheduledForJst)}`,
    executedLabel:
      publication.executedAt === null
        ? '実行日時 未実行'
        : `実行日時 ${formatJstInstant(publication.executedAt)}`,
    appliedLabel: `成功 ${String(publication.appliedCount)}店舗`,
    failedLabel: `失敗 ${String(publication.failedCount)}店舗`,
    webSlotLabel: `Web公開枠 ${String(effect.previousSlotCount)}件 → ${String(effect.publishedSlotCount)}件（${signedDelta(effect.previousSlotCount, effect.publishedSlotCount)}）`,
    ledgerLabel: `予約台帳 ${String(publication.ledgerEntriesAffected)}件反映`,
    applied: publication.targets.filter((target) => target.status === 'applied'),
    failed,
    pending: publication.targets.filter((target) => target.status === 'pending'),
    retryStoreIds:
      publication.status === 'partially_failed' ? failed.map((target) => target.storeId) : [],
    canRetry: publication.status === 'partially_failed' && failed.length > 0,
    canReschedule: publication.status === 'scheduled',
    canCancel: publication.status === 'scheduled',
  }
}

/* ------------------------------------------------------------------ *
 * 版履歴の差分 (UC-EYEX-096, 164, AC-EYEX-108)
 * ------------------------------------------------------------------ */

const FIELD_LABEL: Record<string, string> = {
  receptionStatus: '受付状態',
  businessHours: '営業時間',
  exceptions: '例外日',
  purposes: '来店目的',
  staff: 'スタッフ',
  shifts: '勤務',
  equipment: '設備',
  maintenance: '点検',
}

/** 設定項目の日本語名。未知の項目名はそのまま出す（推測して名付けない）。 */
export function settingsFieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field
}

/**
 * 差分の値は契約上ただの JSON 文字列。生の JSON を並べても読めないので、
 * 配列は件数、スカラーはそのまま、解釈できないものは元の文字列を出す。
 */
function summariseDiffValue(serialized: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    return serialized
  }
  if (Array.isArray(parsed)) return `${String(parsed.length)}件`
  if (parsed === null) return '未設定'
  if (typeof parsed === 'object') return `${String(Object.keys(parsed).length)}項目`
  return String(parsed)
}

export type DiffRow = {
  field: string
  label: string
  before: string
  after: string
}

export function diffRows(detail: SettingsVersionDetail): DiffRow[] {
  return detail.diff.map((entry) => ({
    field: entry.field,
    label: settingsFieldLabel(entry.field),
    before: summariseDiffValue(entry.before),
    after: summariseDiffValue(entry.after),
  }))
}

/* ------------------------------------------------------------------ *
 * 上書き解除 (UC-EYEX-160, AC-EYEX-104)
 * ------------------------------------------------------------------ */

export type OverrideReleaseNotice = {
  headline: string
  detail: string
  canPublish: boolean
}

/** 上書き解除は即座に共通値へ戻すのではなく、新しい下書きと影響を先に見せる。 */
export function overrideReleaseNotice(release: {
  chainVersion: number
  draft: SettingsDraft
  impact: SettingsImpactReport
}): OverrideReleaseNotice {
  return {
    headline: `全店共通値 第${String(release.chainVersion)}版を新しい下書きにしました`,
    detail: '公開する前に影響確認を行ってください。',
    canPublish: impactSummary(release.impact).canPublish,
  }
}

/* ------------------------------------------------------------------ *
 * 版競合
 * ------------------------------------------------------------------ */

/**
 * 古い版を土台にした保存は拒否され、操作者には最新版が示される。
 * 本文は `unknown` のまま受け取り、形が合ったときだけ文言を返す。
 */
export function versionConflictNotice(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const record = body as Record<string, unknown>
  if (record.error !== 'version_conflict') return undefined
  if (typeof record.currentVersion !== 'number' || typeof record.expectedVersion !== 'number') {
    return undefined
  }
  return `他の担当者が先に保存しました。最新は第${String(record.currentVersion)}版です（この画面は第${String(record.expectedVersion)}版）。最新を読み込み直してください。`
}
