/** 端末の自動ロック・セッション寿命。時刻はすべて呼出元から注入する。 */

export type TerminalKind = 'shared' | 'personal'

/** 業務開始時刻から端末ごとの自動ロック秒数後をセッション期限にする。 */
export function expiresAtFrom(startedAt: Date, autoLockSeconds: number): string {
  return new Date(startedAt.getTime() + autoLockSeconds * 1000).toISOString()
}

/** 共有業務は自動ロックで終えない。日をまたぐ置き忘れだけ24時間で失効させる。 */
export function sharedExpiresAtFrom(startedAt: Date): string {
  return new Date(startedAt.getTime() + 24 * 60 * 60 * 1000).toISOString()
}

/** revoked でなく、期限より厳密に後の時刻だけを有効なセッションとする。 */
export function isSessionLive(
  session: { expiresAt: string; revokedAt: string | null },
  now: Date,
): boolean {
  return session.revokedAt === null && Date.parse(session.expiresAt) > now.getTime()
}

/**
 * 個人モードの権限は expires_at で終わるが、同じ資格情報は開始24時間まで共有主体として使う。
 * 明示終了・takeover は期限に関係なく即時失効する。
 */
export function sessionAuthorizationAt(
  session: {
    mode: 'shared' | 'personal'
    startedAt: string
    expiresAt: string
    revokedAt: string | null
  },
  now: Date,
): 'personal' | 'shared' | null {
  if (session.revokedAt !== null) return null
  const nowMs = now.getTime()
  if (session.mode === 'shared') {
    return Date.parse(session.expiresAt) > nowMs ? 'shared' : null
  }
  if (Date.parse(session.expiresAt) > nowMs) return 'personal'
  return Date.parse(session.startedAt) + 24 * 60 * 60 * 1000 > nowMs ? 'shared' : null
}

/**
 * 共有端末は最後の操作から設定秒数を厳密に超えると伏せる。
 * 個人端末と録音中の受付は伏せない。
 */
export function shouldMask(
  input: {
    kind: TerminalKind
    autoLockSeconds: number
    lastTouchedAt: Date
    recordingActive: boolean
  },
  now: Date,
): boolean {
  if (input.kind === 'personal' || input.recordingActive) return false
  return now.getTime() - input.lastTouchedAt.getTime() > input.autoLockSeconds * 1000
}

/** 最終通信から閾値秒数ちょうどまではオンライン、超えたらオフライン。 */
export function isOnline(lastSeenAt: string | null, now: Date, thresholdSeconds = 300): boolean {
  return lastSeenAt !== null && now.getTime() - Date.parse(lastSeenAt) <= thresholdSeconds * 1000
}
