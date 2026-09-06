/**
 * 端末そのものの資格情報。
 *
 * 業務セッション（`terminal_sessions`）とは寿命が違う。あちらは共有なら業務日、
 * 個人なら `auto_lock_seconds` で切れるが、こちらは 30 日で、使うたびに
 * ローテーションする。分けるのは「画面を伏せる・業務を終える」と
 * 「この iPad が誰のものか」が別の話だからである。
 *
 * 平文は HttpOnly Cookie にしか出さない。D1 には SHA-256 のハッシュだけを置く。
 *
 * 時刻はすべて引数で受ける。ここで `Date.now()` を呼ぶと、30 日の境界が
 * 実時刻に縛られてテストできなくなる。
 */

/** 30 日。これを超えて放置された端末は PIN からやり直す（パスワードは出さない）。 */
export const DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function hashDeviceToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return base64Url(new Uint8Array(digest))
}

/** 平文（Cookie 用）と、保存するハッシュ。平文はここでしか作らない。 */
export async function newDeviceCredential(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = base64Url(bytes)
  return { token, hash: await hashDeviceToken(token) }
}

export function deviceExpiresAt(now: Date): string {
  return new Date(now.getTime() + DEVICE_TTL_SECONDS * 1000).toISOString()
}

/**
 * 期限ちょうどは切れている扱い。失効していれば期限内でも使えない。
 * 期限が読めない行も使えないものとして扱う —— DB を信用しきらない。
 */
export function isDeviceUsable(
  row: { expiresAt: string; revokedAt: string | null },
  now: Date,
): boolean {
  if (row.revokedAt !== null) return false
  const expires = Date.parse(row.expiresAt)
  if (!Number.isFinite(expires)) return false
  return now.getTime() < expires
}
