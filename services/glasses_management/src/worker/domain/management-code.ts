export const MANAGEMENT_CODE_MAX_FAILED_ATTEMPTS = 5
export const VERIFIED_RESERVATION_SESSION_TTL_MS = 15 * 60 * 1000

export function issueVerifiedReservationSessionToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`
}

export function managementCodeAccessError(
  code: Readonly<{ expiresAt: string; revokedAt: string | null; failedAttempts: number }>,
  now: Date,
): 'management_code_expired' | 'management_code_revoked' | 'management_code_attempt_limit' | null {
  if (code.revokedAt !== null) return 'management_code_revoked'
  if (code.failedAttempts >= MANAGEMENT_CODE_MAX_FAILED_ATTEMPTS)
    return 'management_code_attempt_limit'
  const expiresAt = Date.parse(code.expiresAt)
  if (Number.isNaN(expiresAt) || expiresAt <= now.getTime()) return 'management_code_expired'
  return null
}

export function verifiedReservationSessionAccessError(
  session: Readonly<{
    organizationId: string
    storeId: string
    reservationId: string
    expiresAt: string
  }>,
  expected: Readonly<{ organizationId: string; storeId: string; reservationId: string }>,
  now: Date,
): 'verification_expired' | 'verification_scope_mismatch' | null {
  const expiresAt = Date.parse(session.expiresAt)
  if (Number.isNaN(expiresAt) || expiresAt <= now.getTime()) return 'verification_expired'
  if (
    session.organizationId !== expected.organizationId ||
    session.storeId !== expected.storeId ||
    session.reservationId !== expected.reservationId
  ) {
    return 'verification_scope_mismatch'
  }
  return null
}

/** Until store-specific policy is published, a customer may change/cancel strictly before start. */
export function reservationModificationAccessError(
  startAt: string,
  now: Date,
): 'reservation_modification_deadline_passed' | null {
  const start = Date.parse(startAt)
  return Number.isNaN(start) || start <= now.getTime()
    ? 'reservation_modification_deadline_passed'
    : null
}
