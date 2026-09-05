/**
 * 確認番号（内部名 **管理コード**）の発行・保存・照合。
 *
 * お客様が WEB-CANCEL でご自分の予約を開くための番号である。**画面とメールでは
 * 「確認番号」としか呼ばない。**「管理コード」はこのファイルと列名（`management_code_hash`）
 * にだけ残る内部語で、お客様には出さない。
 *
 * ここで守るのは 4 つである。
 *
 * 1. **平文を保存しない。**D1 に入るのはハッシュだけで、生値が現れるのは予約を作った
 *    ときの応答（`PublicBookingResult`）と本人確認が通ったときの応答だけである。
 *    平文を持つと、D1 が一度漏れた日にすべての予約が同時に開く。
 * 2. **1 件が漏れても隣が開かない。**ハッシュは組織とご予約番号から作る塩を混ぜる。
 *    塩が無ければ 8 文字の総当たり表 1 枚で全件が引ける。
 * 3. **伸長しない。**Workers の CPU は 1 リクエスト 10ms なので、PBKDF2 の反復は入れず
 *    SHA-256 を 1 回だけ掛ける（`docs/howto/free-tier-limits.md`）。**そのぶんの強さは
 *    総当たりの回数制限（10 回/時。`04-api.md` §5）で担保する。**
 * 4. **一定時間で比べる。**一致した文字数の差が応答時間に出ないよう、長さの違いでも
 *    早く返らない。
 *
 * 時刻はすべて引数で受ける。`Date.now()` を呼ばない。
 */

/**
 * 確認番号に使う英数字 32 文字。**読み違えやすい `0` `O` `1` `I` `L` を入れない**
 * （お電話で読み上げていただくことがある）。32 は 256 の約数なので、乱数 1 バイトを
 * 32 で割った余りに偏りが出ない。
 */
const MANAGEMENT_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** 確認番号の長さ。32^8 ≒ 1.1 兆通りで、10 回/時の制限と合わせて総当たりに耐える。 */
export const MANAGEMENT_CODE_LENGTH = 8

/** 確認メールのリンクに載せる 1 回性の鍵の長さ（バイト）。hex にすると 32 文字。 */
const CONFIRMATION_KEY_BYTES = 16

/** 短命の確認鍵の寿命（`04-api.md` §8 の KV `mgmt:<orgId>:<code>`）。 */
const SHORT_LIVED_TTL_SECONDS = 900

/** 確認番号の入力を締める回数（コード × IP。`04-api.md` §5）。 */
const MANAGEMENT_CODE_FAILURE_LIMIT = 10

/** 失敗回数を覚えておく時間。失敗したときにだけ書く。 */
export const MANAGEMENT_CODE_FAILURE_TTL_SECONDS = 3600

/** 締めたあとにお待ちいただく秒数（429 の `retryAfterSeconds`）。 */
export const MANAGEMENT_CODE_RETRY_AFTER_SECONDS = 900

/* --- 発行 ---------------------------------------------------------------- */

/** ハッシュ 1 本ぶんの hex 文字列（64 文字）。 */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * 確認番号を 1 つ作る。`crypto.getRandomValues` だけを使う（`Math.random()` を混ぜない）。
 */
export function issueManagementCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(MANAGEMENT_CODE_LENGTH))
  return [...bytes]
    .map((byte) => MANAGEMENT_CODE_ALPHABET[byte % MANAGEMENT_CODE_ALPHABET.length])
    .join('')
}

/**
 * 確認メールのリンクに載せる 1 回性の鍵。お客様が読み上げるものではないので、
 * 読み違えの心配をせず hex にする。
 */
export function issueConfirmationKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CONFIRMATION_KEY_BYTES))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/* --- 保存と照合 ----------------------------------------------------------- */

/**
 * お客様が入れた確認番号を、比べられる形にそろえる。
 *
 * 大文字にし、空白とハイフンを落とすだけである。**`O` を `0` に読み替えるような
 * 置き換えはしない** — どちらも英数字の集合に無いので、読み替え先が一意に決まらない。
 */
function normalize(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase()
}

/**
 * D1 に入れるハッシュ。`salt` には**組織とご予約番号**を渡す
 * （`<organizationId>:<publicCode>`）。1 件のハッシュが漏れても、同じ表で隣の 1 件を
 * 引けないようにするためである。
 */
export function hashManagementCode(code: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${normalize(code)}`)
}

/** 確認鍵のハッシュ。こちらは読み上げないので、そろえずにそのまま掛ける。 */
export function hashConfirmationKey(key: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${key}`)
}

/**
 * 2 本の hex を**一定時間**で比べる。長さが違っても早く返らないのは、
 * 応答時間から確認番号の長さが読めないようにするためである。
 */
function equalsInConstantTime(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < length; i += 1) {
    diff |= (a.codePointAt(i) ?? 0) ^ (b.codePointAt(i) ?? 0)
  }
  return diff === 0
}

/**
 * 保存したハッシュと、お客様が入れた確認番号を照合する。
 * **入力が空でも同じ道を通る**（空を先に弾くと、空かどうかが応答時間に出る）。
 */
export async function verifyManagementCode(
  storedHash: string,
  code: string,
  salt: string,
): Promise<boolean> {
  return equalsInConstantTime(storedHash, await hashManagementCode(code, salt))
}

/* --- 短命の鍵と失敗回数（KV `SHORT_LIVED`） ------------------------------- */

/** 本人確認が通ったあとの短命の鍵の置き場。 */
export function shortLivedKey(organizationId: string, code: string): string {
  return `mgmt:${organizationId}:${code}`
}

/** 失敗回数の置き場。**コード × IP** で数える（1 台が 1 件を叩き続けるのを止める）。 */
export function failureKey(code: string, ip: string): string {
  return `mgmtfail:${code}:${ip}`
}

/** 短命の鍵の期限（`now + 900 秒`）。 */
export function shortLivedExpiresAt(now: Date): string {
  return new Date(now.getTime() + SHORT_LIVED_TTL_SECONDS * 1000).toISOString()
}

/**
 * 期限内か。**900 秒ちょうどはまだ効く**（`now <= expiresAt`。`07-nfr.md` §10.3）。
 * 切れていたら 401 `invalid_management_code` で、番号違いと同じ文言に落とす。
 */
export function isShortLivedFresh(record: { expiresAt: string }, now: Date): boolean {
  return now.getTime() <= Date.parse(record.expiresAt)
}

/** 10 回目の失敗で締める（9 回まではまだ試せる）。429 `management_code_locked`。 */
export function isManagementCodeLocked(failures: number): boolean {
  return failures >= MANAGEMENT_CODE_FAILURE_LIMIT
}
