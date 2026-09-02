/** PIN の試行回数とロック境界。時刻はすべて呼出元から注入する。 */

const PIN_LOCK_SECONDS = 30
const MAX_PIN_FAILURES = 3

/** 同一数字の並びと、±1 の単調連番だけを弱い PIN とする。 */
export function isWeakPin(pin: string): boolean {
  if (!/^\d{4,6}$/.test(pin)) return false
  if (/^(\d)\1+$/.test(pin)) return true

  const digits = [...pin].map(Number)
  const step = (digits[1] ?? 0) - (digits[0] ?? 0)
  return (
    (step === 1 || step === -1) &&
    digits.every((digit, index) => {
      if (index === 0) return true
      return digit - (digits[index - 1] ?? digit) === step
    })
  )
}

/** KV に置く、共有または個人 PIN の失敗回数キー。 */
export function pinFailureKey(
  organizationId: string,
  terminalId: string,
  staffId: string | null,
): string {
  return `pin:${organizationId}:${terminalId}:${staffId ?? 'shared'}`
}

export type PinFailureState = {
  attempts: number
  locked: boolean
  remainingAttempts: number
  retryAfterSeconds: number
}

export type StoredPinFailure = { attempts: number; failedAt: string }

/** KVは正本ではないため、壊れた値はロックせず未試行として扱う。 */
export function parsePinFailure(raw: string | null): StoredPinFailure | null {
  if (raw === null) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (typeof value !== 'object' || value === null) return null
    const record = value as Record<string, unknown>
    if (
      typeof record.attempts !== 'number' ||
      !Number.isInteger(record.attempts) ||
      record.attempts < 1 ||
      record.attempts > MAX_PIN_FAILURES ||
      typeof record.failedAt !== 'string' ||
      !Number.isFinite(Date.parse(record.failedAt))
    ) {
      return null
    }
    return { attempts: record.attempts, failedAt: record.failedAt }
  } catch {
    return null
  }
}

/** 直前の失敗回数から、次の失敗後の状態を返す。3 回目で 30 秒ロックする。 */
export function nextFailureState(previousAttempts: number): PinFailureState {
  const attempts = Math.min(Math.max(0, Math.floor(previousAttempts)) + 1, MAX_PIN_FAILURES)
  const locked = attempts >= MAX_PIN_FAILURES
  return {
    attempts,
    locked,
    remainingAttempts: locked ? 0 : MAX_PIN_FAILURES - attempts,
    retryAfterSeconds: locked ? PIN_LOCK_SECONDS : 0,
  }
}

/** ロック開始から30秒ちょうどまでは入力を拒み、+1ms で解除する。 */
export function isPinLocked(lockedAt: Date | null, now: Date): boolean {
  return lockedAt !== null && now.getTime() - lockedAt.getTime() <= PIN_LOCK_SECONDS * 1000
}
