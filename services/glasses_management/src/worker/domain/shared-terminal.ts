const encoder = new TextEncoder()

/** Hash bearer credentials before D1 persistence; plain tokens are issuance-only. */
export async function hashSharedTerminalToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Two independent UUIDs provide 244 bits of entropy in a URL/header-safe token. */
export function issueSharedTerminalToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`
}

/** Evaluate terminal state against an injected instant so expiry is boundary-testable. */
export function sharedTerminalAccessError(
  terminal: Readonly<{
    status: string
    expiresAt: string
    lastSeenAt?: string | null
    idleTimeoutSeconds?: number
  }>,
  now: Date,
): 'terminal_revoked' | 'terminal_expired' | 'terminal_locked' | null {
  if (terminal.status === 'revoked') return 'terminal_revoked'
  if (Date.parse(terminal.expiresAt) <= now.getTime()) return 'terminal_expired'
  if (
    terminal.lastSeenAt !== undefined &&
    terminal.lastSeenAt !== null &&
    terminal.idleTimeoutSeconds !== undefined &&
    Date.parse(terminal.lastSeenAt) + terminal.idleTimeoutSeconds * 1000 <= now.getTime()
  )
    return 'terminal_locked'
  return null
}

/** Fail-closed scope and expiry check for a hash-only personal reauthentication grant. */
export function sharedTerminalReauthAccessError(
  session: Readonly<{
    organizationId: string
    storeId: string
    terminalId: string
    actionClass: string
    expiresAt: string
  }>,
  expected: Readonly<{
    organizationId: string
    storeId: string
    terminalId: string
    actionClass: string
  }>,
  now: Date,
): 'reauth_expired' | 'reauth_scope_mismatch' | null {
  if (Date.parse(session.expiresAt) <= now.getTime()) return 'reauth_expired'
  if (
    session.organizationId !== expected.organizationId ||
    session.storeId !== expected.storeId ||
    session.terminalId !== expected.terminalId ||
    session.actionClass !== expected.actionClass
  )
    return 'reauth_scope_mismatch'
  return null
}
