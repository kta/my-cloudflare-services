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

/*
 * 階段状のロック（長い窓）。
 *
 * 上の「3 回で 30 秒」は、打ち間違えた人をすぐ通すための短い窓である。それだけを
 * 公開の入口に置くと総当たりに耐えない —— 4 桁は 10,000 通りしかなく、30 秒待ちを
 * 挟んでも約 3.5 日で尽きる。そこで、長い窓の合計失敗回数でさらに待たせる層を重ねる。
 *
 * いっぽう永久ロックは店を止める（レジ横の iPad が二度と開かない）ので、
 * 24 時間で頭打ちにする。閾値を跨いだあとは倍々にして、当てずっぽうの試行が
 * 現実的な時間に収まらないようにする。
 */
const STREAK_LOCK_STEPS = [
  { failures: 20, seconds: 60 * 60 },
  { failures: 10, seconds: 15 * 60 },
  { failures: 3, seconds: 30 },
] as const
const STREAK_DOUBLING_FROM = 20
const STREAK_LOCK_CEILING_SECONDS = 24 * 60 * 60

/** 合計失敗回数から、次に待たせる秒数。0 は「待たせない」。 */
export function lockSecondsFor(totalFailures: number): number {
  const failures = Math.max(0, Math.floor(totalFailures))
  if (failures > STREAK_DOUBLING_FROM) {
    const doublings = failures - STREAK_DOUBLING_FROM
    // 2 ** doublings は 1024 回も繰り返せば Infinity になるが、Math.min が拾う。
    const seconds = 60 * 60 * 2 ** doublings
    return Math.min(seconds, STREAK_LOCK_CEILING_SECONDS)
  }
  return STREAK_LOCK_STEPS.find((step) => failures >= step.failures)?.seconds ?? 0
}

/**
 * 長い窓の失敗回数キー。**端末単位**にする（スタッフ単位ではない）。
 * 相手を変えながら試す総当たりを、同じ端末の中で 1 本に数えるため。
 */
export function pinStreakKey(organizationId: string, terminalId: string): string {
  return `pinstreak:${organizationId}:${terminalId}`
}

/** KV は正本ではないので、読めない値は「失敗していない」として扱う。 */
export function parsePinStreak(raw: string | null): number {
  if (raw === null) return 0
  const value = Number.parseInt(raw, 10)
  if (!Number.isInteger(value) || value < 0) return 0
  return value
}
