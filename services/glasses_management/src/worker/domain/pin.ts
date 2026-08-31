/**
 * 暗証番号（PIN）の純関数。**時刻は必ず引数で受ける**（`Date.now()` を呼ばない）。
 *
 * ここには**平文の暗証番号を保存・応答・ログへ出す経路を 1 本も置かない**。
 * 照合そのものは `packages/shared` の `stretchPin` / `hashStretched` /
 * `verifyStretched` が担い、この面が持つのは「登録してよい形か」「あと何回か」
 * 「まだ待たされているか」の 3 つだけである（`04-api.md` §5・`07-nfr.md` §10.3）。
 */

/** 続けて間違えられる回数。3 回目で待ちに入る。 */
const PIN_MAX_ATTEMPTS = 3
/** 待ち時間（秒）。境界を 2 か所に持たないよう、ここだけに書く。 */
const PIN_LOCK_SECONDS = 30

/**
 * 登録を断る暗証番号かどうか。**辞書は持たない**（`04-api.md` §5）。
 * 断るのは 2 つだけ — 同じ数字の連続（`0000`）と ±1 の連番（`1234` / `4321`）。
 */
export function isWeakPin(pin: string): boolean {
  const digits = [...pin].map(Number)
  const first = digits[0]
  if (first === undefined) return false
  const same = digits.every((digit) => digit === first)
  const up = digits.every((digit, index) => index === 0 || digit === (digits[index - 1] ?? 0) + 1)
  const down = digits.every((digit, index) => index === 0 || digit === (digits[index - 1] ?? 0) - 1)
  return same || up || down
}

/**
 * 連続失敗の置き場（KV の鍵）。D1 に行を作らないので、30 秒で自然に消える。
 * 共有モードは担当を持たないので `'shared'` に落とす。
 */
export function pinFailureKey(
  organizationId: string,
  terminalId: string,
  staffId: string | null,
): string {
  return `pin:${organizationId}:${terminalId}:${staffId ?? 'shared'}`
}

/** 失敗を 1 つ数えたあとの状態。画面は `remainingAttempts` をそのまま読み上げる。 */
export type PinFailureState = {
  attempts: number
  locked: boolean
  remainingAttempts: number
  retryAfterSeconds: number
}

/** いまの失敗回数 `attempts` に 1 つ足した状態を返す。 */
export function nextFailureState(attempts: number): PinFailureState {
  const next = attempts + 1
  const locked = next >= PIN_MAX_ATTEMPTS
  return {
    attempts: next,
    locked,
    remainingAttempts: locked ? 0 : PIN_MAX_ATTEMPTS - next,
    retryAfterSeconds: locked ? PIN_LOCK_SECONDS : 0,
  }
}

/**
 * まだ待たされているか。**30 秒ちょうどはまだ入力できず、+1 秒で入力できる**
 * （`07-nfr.md` §10.3）。一度も失敗していない（`lockedAt === null`）なら待たない。
 */
export function isPinLocked(lockedAt: Date | null, now: Date): boolean {
  if (lockedAt === null) return false
  return now.getTime() - lockedAt.getTime() <= PIN_LOCK_SECONDS * 1000
}
