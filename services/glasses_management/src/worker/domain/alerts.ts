import type { AlertCode, AlertCondition, AlertKind } from '@app/contracts'

/*
 * Pure evaluation of the operator warning conditions (UC-EYEX-179). Time is an
 * argument, never a wall-clock read, so the "one second past the threshold"
 * boundary is testable and does not depend on the machine running the test.
 */

/** What an evaluation decided to raise, before it is persisted. */
export type AlertDescriptor = {
  kind: AlertKind
  code: AlertCode
  title: string
  /** 発生理由. */
  reason: string
  /** 対象 — an operational label, deliberately not a customer name. */
  subject: string
  subjectType: 'reservation' | 'walkin' | 'recording' | 'visit_purpose'
  subjectId: string
  /** 発生時刻 — when the condition became true, not when it was noticed. */
  occurredAt: string
  /** 次の操作. */
  nextAction: string
  dedupeKey: string
}

/** The conditions an administrator may switch on, off or retune. */
export const DEFAULT_ALERT_CONDITIONS: readonly AlertCondition[] = [
  { code: 'long_wait', enabled: true, thresholdMinutes: 15 },
  { code: 'recording_save_failure', enabled: true, thresholdMinutes: null },
  { code: 'settings_contradiction', enabled: true, thresholdMinutes: null },
]

/**
 * One alert per condition + subject + occurrence. Re-evaluating the same
 * still-true condition therefore updates nothing rather than filling the
 * inbox, which is what lets evaluation be called as often as an operator (or
 * a future scheduled trigger) likes.
 */
export function alertDedupeKey(code: AlertCode, subjectId: string, occurredAt: string): string {
  return `${code}:${subjectId}:${occurredAt}`
}

export type WaitingEntry = {
  subjectType: 'reservation' | 'walkin'
  subjectId: string
  subject: string
  waitStartedAt: string | null
  isWaiting: boolean
}

export function longWaitAlerts(input: {
  entries: readonly WaitingEntry[]
  thresholdMinutes: number
  now: Date
}): AlertDescriptor[] {
  const thresholdMs = input.thresholdMinutes * 60 * 1000
  return input.entries.flatMap((entry) => {
    if (!entry.isWaiting || entry.waitStartedAt === null) return []
    const startedAt = new Date(entry.waitStartedAt)
    if (Number.isNaN(startedAt.getTime())) return []
    const elapsed = input.now.getTime() - startedAt.getTime()
    // Exactly on the threshold is still inside the promise; only past it fails.
    if (elapsed <= thresholdMs) return []
    const occurredAt = new Date(startedAt.getTime() + thresholdMs).toISOString()
    return [
      {
        kind: 'alert' as const,
        code: 'long_wait' as const,
        title: '待ち時間が設定した上限を超えました',
        reason: `受付から${input.thresholdMinutes}分を超えても接客が開始されていません。`,
        subject: entry.subject,
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        occurredAt,
        nextAction:
          '受付台帳で担当者を割り当てるか、お客様へ待ち時間の見込みをお伝えしてください。',
        dedupeKey: alertDedupeKey('long_wait', entry.subjectId, occurredAt),
      },
    ]
  })
}

export type RecordingRow = {
  id: string
  state: string
  failureReason: string | null
  updatedAt: string
}

export function recordingFailureAlerts(rows: readonly RecordingRow[]): AlertDescriptor[] {
  return rows.flatMap((row) => {
    if (row.state !== 'failed') return []
    const reason =
      row.failureReason === null
        ? '録音の保存に失敗しました。失敗理由は記録されていません。'
        : `録音の保存に失敗しました。記録された失敗理由: ${row.failureReason}`
    return [
      {
        kind: 'alert' as const,
        code: 'recording_save_failure' as const,
        title: '録音の保存に失敗しました',
        reason,
        subject: `録音 ${row.id}`,
        subjectType: 'recording' as const,
        subjectId: row.id,
        occurredAt: row.updatedAt,
        nextAction:
          '録音一覧で該当セッションを開き、再取得の可否と手書き記録の要否を確認してください。',
        dedupeKey: alertDedupeKey('recording_save_failure', row.id, row.updatedAt),
      },
    ]
  })
}

export type PurposeRow = {
  id: string
  staffName: string
  durationMinutes: number
  slotIntervalMinutes: number
  maxConcurrent: number
  isPublic: string
}

/** The contradictions that silently make a purpose unbookable. */
function contradictionsFor(purpose: PurposeRow): string[] {
  const found: string[] = []
  if (purpose.slotIntervalMinutes <= 0) found.push('枠間隔が0分以下に設定されています')
  else if (purpose.durationMinutes % purpose.slotIntervalMinutes !== 0)
    found.push(
      `所要時間${purpose.durationMinutes}分が枠間隔${purpose.slotIntervalMinutes}分の整数倍ではありません`,
    )
  if (purpose.maxConcurrent < 1) found.push('同時受入数が0のため、どの枠も予約できません')
  if (purpose.isPublic === '1' && purpose.durationMinutes <= 0)
    found.push('Web公開中の目的に所要時間が設定されていません')
  return found
}

export function settingsContradictionAlerts(
  purposes: readonly PurposeRow[],
  now: Date,
): AlertDescriptor[] {
  const occurredAt = now.toISOString()
  return purposes.flatMap((purpose) => {
    const found = contradictionsFor(purpose)
    if (found.length === 0) return []
    return [
      {
        kind: 'alert' as const,
        code: 'settings_contradiction' as const,
        title: '来店目的の設定に矛盾があります',
        reason: `${purpose.staffName}: ${found.join(' / ')}`,
        subject: `来店目的 ${purpose.staffName}`,
        subjectType: 'visit_purpose' as const,
        subjectId: purpose.id,
        occurredAt,
        nextAction: '設定画面で所要時間・枠間隔・同時受入数を見直し、下書きを公開してください。',
        dedupeKey: alertDedupeKey('settings_contradiction', purpose.id, occurredAt),
      },
    ]
  })
}
