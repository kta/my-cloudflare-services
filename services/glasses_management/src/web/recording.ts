import type { RecordingState } from '@app/contracts'

/*
 * 録音の状態と保持期限の純粋ロジック。React も fetch も含まない。
 *
 * 時刻は必ず引数で注入する。`new Date()` / `Date.now()` はこのファイルに
 * 存在しない — 共有 iPad が自分の壁時計で保持期限を判断してはならない。
 */

/**
 * 録音の状態遷移。予約の状態とは独立しており、破棄された受付の録音も
 * 保存・保全・削除の全経路を通る (UC-EYEX-176, AC-EYEX-115)。
 * ここに書かれていない遷移は拒否する。Worker 側 `domain/recording.ts` と
 * 同じ表を、境界を越えた import を作らずに持つ。
 */
const TRANSITIONS: Readonly<Record<RecordingState, readonly RecordingState[]>> = Object.freeze({
  permission_check: ['recording', 'failed'],
  recording: ['stopped', 'failed'],
  stopped: ['uploading', 'failed'],
  uploading: ['stored', 'failed'],
  stored: ['held', 'pending_deletion', 'deleted'],
  failed: ['uploading', 'deleted'],
  held: ['stored', 'pending_deletion'],
  pending_deletion: ['held', 'deleted'],
  // 削除済みは終端。復元経路を持たせない。
  deleted: [],
})

export function canTransitionRecording(from: RecordingState, to: RecordingState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to)
}

/** 状態は必ず文言で示す。色だけで録音中を伝えない (AC-EYEX-115)。 */
export const RECORDING_STATE_LABEL: Readonly<Record<RecordingState, string>> = Object.freeze({
  permission_check: '権限確認',
  recording: '録音中',
  stopped: '停止',
  uploading: '送信中',
  stored: '保存済み',
  failed: '失敗',
  held: '保全中',
  pending_deletion: '削除予定',
  deleted: '削除済み',
})

export type RecordingTone = 'success' | 'warning' | 'danger' | 'neutral'

export function recordingStateTone(state: RecordingState): RecordingTone {
  switch (state) {
    case 'stored':
      return 'success'
    case 'failed':
    case 'recording':
      return 'danger'
    case 'held':
    case 'pending_deletion':
      return 'warning'
    default:
      return 'neutral'
  }
}

/** 録音運用画面の区分。保存中・失敗・保全中・削除予定・削除済みを分ける (AC-EYEX-100)。 */
export const RECORDING_OPS_FILTERS: readonly { state: RecordingState; label: string }[] =
  Object.freeze([
    { state: 'uploading', label: '保存中' },
    { state: 'stored', label: '保存済み' },
    { state: 'failed', label: '失敗' },
    { state: 'held', label: '保全中' },
    { state: 'pending_deletion', label: '削除予定' },
    { state: 'deleted', label: '削除済み' },
  ] as const)

/** 再試行できるのは保存に失敗した録音だけ (AC-EYEX-100)。 */
export function canRetryRecording(state: RecordingState): boolean {
  return state === 'failed'
}

/** 成立予約の録音は最低30日、破棄受付の録音は最低24時間 (AC-EYEX-75, 76, 99)。 */
export const MINIMUM_CONFIRMED_RETENTION_DAYS = 30
export const MINIMUM_DISCARDED_RETENTION_HOURS = 24

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function parseInstant(iso: string, field: string): number {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) throw new RangeError(`${field} must be an ISO instant`)
  return at
}

/** 削除を拒否したときに示す、最低保証だけの期限。 */
export function minimumRetentionUntil(endedAt: string, hasReservation: boolean): string {
  const at = parseInstant(endedAt, 'endedAt')
  const duration = hasReservation
    ? MINIMUM_CONFIRMED_RETENTION_DAYS * DAY_MS
    : MINIMUM_DISCARDED_RETENTION_HOURS * HOUR_MS
  return new Date(at + duration).toISOString()
}

/** 最低値を「値」ではなく「理由つきの一文」で伝える (AC-EYEX-99)。 */
export function minimumRetentionSummary(hasReservation: boolean): string {
  return hasReservation
    ? `成立した予約の録音は、録音完了から最低${MINIMUM_CONFIRMED_RETENTION_DAYS}日間保持します。`
    : `破棄した受付の録音は、録音終了から最低${MINIMUM_DISCARDED_RETENTION_HOURS}時間保持します。`
}

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

/** `2026年8月27日 11:00` — 商品が単一国なので JST 固定。 */
export function formatRecordingInstant(iso: string): string {
  const parts = instantFormat.formatToParts(new Date(parseInstant(iso, 'instant')))
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}年${pick('month')}月${pick('day')}日 ${pick('hour')}:${pick('minute')}`
}

function remainingLabel(remainingMs: number): string {
  if (remainingMs <= 0) return '保持期限は経過しています'
  if (remainingMs >= DAY_MS) return `残り${Math.floor(remainingMs / DAY_MS)}日`
  if (remainingMs >= HOUR_MS) return `残り${Math.floor(remainingMs / HOUR_MS)}時間`
  return `残り${Math.max(1, Math.floor(remainingMs / MINUTE_MS))}分`
}

/** 保持期限と残り時間。時刻は注入されたものだけを使う。 */
export function retentionLabel(input: { retentionUntil: string | null; now: string }): string {
  if (input.retentionUntil === null) return '保持期限未設定'
  const deadline = parseInstant(input.retentionUntil, 'retentionUntil')
  const now = parseInstant(input.now, 'now')
  return `${formatRecordingInstant(input.retentionUntil)} まで保持（${remainingLabel(deadline - now)}）`
}

/**
 * 保持は期限ちょうどで終わる: `now === 期限` は削除でき、1ミリ秒前は削除できない。
 * 保全中の録音は期限を過ぎても削除経路に乗らない (AC-EYEX-78)。
 */
export function canDeleteRecording(input: {
  state: RecordingState
  retentionUntil: string | null
  now: string
}): boolean {
  if (!canTransitionRecording(input.state, 'deleted')) return false
  if (input.retentionUntil === null) return true
  return parseInstant(input.now, 'now') >= parseInstant(input.retentionUntil, 'retentionUntil')
}

/** 長さは `mm:ss`。 */
export function formatRecordingDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/**
 * 承認済みモック `RECORDING-OPS--failure-hold--ipad-landscape.png` の行見出し
 * `録音 EY-R-1482` の形。UUID をそのまま並べると行が読めないので、末尾 4 桁だけを
 * 運用者が口頭で照合できる短縮符として出す。完全な id は詳細と監査記録にある。
 */
export function recordingLabel(id: string): string {
  return `録音 EY-R-${id.replaceAll('-', '').slice(-4).toUpperCase()}`
}
