/**
 * 端末の業務（`terminal_sessions`）と自動ロックの純関数。
 * **時刻は必ず引数で受ける**（`Date.now()` も引数なしの `new Date()` も呼ばない）。
 *
 * 自動ロックは**経過を数えるタイマーに頼らない** — 裏タブでは時間の進みが絞られるので、
 * 「最後にさわった時刻」と「いまの時刻」の差だけで決める（`07-nfr.md` §10.3）。
 */
import type { TerminalKind } from '@app/contracts'

/** つながっていると見なす最終通信の古さ（秒）。列に状態を持たない。 */
const ONLINE_THRESHOLD_SECONDS = 300

/** 業務の期限。開始（またはさわり直した時刻）+ `autoLockSeconds`。 */
export function expiresAtFrom(startedAt: Date, autoLockSeconds: number): string {
  return new Date(startedAt.getTime() + autoLockSeconds * 1000).toISOString()
}

/**
 * まだ生きている業務か。**期限ちょうどはまだ生きていて**、+1 秒で切れる
 * （伏せるのも共有モードへ戻るのも +1 秒から）。失効済みは期限内でも生きていない。
 */
export function isSessionLive(
  session: { expiresAt: string; revokedAt: string | null },
  now: Date,
): boolean {
  return session.revokedAt === null && Date.parse(session.expiresAt) >= now.getTime()
}

/** 自動ロックの材料。伏せるのは画面だけで、セッションごと終わらせない。 */
export type MaskInput = {
  kind: TerminalKind
  autoLockSeconds: number
  lastTouchedAt: Date
  recordingActive: boolean
}

/**
 * お客様のお名前とお電話番号を伏せるか。
 * 個人の端末は伏せない。録音中の受付があるあいだも伏せない（`07-nfr.md` §6.4）。
 * **`autoLockSeconds` ちょうどでは伏せず、+1 秒で伏せる。**
 */
export function shouldMask(input: MaskInput, now: Date): boolean {
  if (input.kind === 'personal' || input.recordingActive) return false
  return now.getTime() - input.lastTouchedAt.getTime() > input.autoLockSeconds * 1000
}

/** つながっているか。一度もつながっていない端末（`null`）はつながっていない。 */
export function isOnline(
  lastSeenAt: string | null,
  now: Date,
  thresholdSeconds = ONLINE_THRESHOLD_SECONDS,
): boolean {
  if (lastSeenAt === null) return false
  return now.getTime() - Date.parse(lastSeenAt) <= thresholdSeconds * 1000
}
