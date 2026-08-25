/**
 * サービス間(service binding)内部 API の共有部品。
 * - `internalAuth()`: `x-internal-key` ガード(secret 未設定は fail close)
 */
import type { MiddlewareHandler } from 'hono'

type InternalEnv = { Bindings: { INTERNAL_KEY: string } }

const enc = new TextEncoder()

/**
 * 定数時間比較。`/api/internal/*` は service binding 経由が正規経路だが Worker の
 * 公開 URL からも到達できるため、共有 secret の照合を `!==`(早期 return)にしない。
 * 長さ不一致の早期 return は長さ以外を漏らさないので許容。
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

/**
 * `/api/internal/*` を守る共有キーガード。secret 未設定なら全拒否(fail close —
 * 未設定の env と欠落ヘッダが undefined 同士で一致して素通りするのを防ぐ)。
 */
export function internalAuth(): MiddlewareHandler<InternalEnv> {
  return async (c, next) => {
    const expected = c.env.INTERNAL_KEY
    const got = c.req.header('x-internal-key')
    if (!expected || !got || !timingSafeEqualStr(got, expected)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    await next()
  }
}
