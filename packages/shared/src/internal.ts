/**
 * サービス間(service binding)内部 API の共有部品。
 * - `internalAuth()`: `x-internal-key` ガード(secret 未設定は fail close)
 */
import type { MiddlewareHandler } from 'hono'
// 定数時間比較は staging ゲートとも共有する。`/api/internal/*` は service binding
// 経由が正規経路だが Worker の公開 URL からも到達できるため、照合を早期 return にしない。
import { timingSafeEqualStr } from './timing-safe'

type InternalEnv = { Bindings: { INTERNAL_KEY: string } }

/**
 * `/api/internal/*` を守る共有キーガード。secret 未設定なら全拒否(fail close —
 * 未設定の env と欠落ヘッダが undefined 同士で一致して素通りするのを防ぐ)。
 */
export function internalAuthFor(
  key: string,
): MiddlewareHandler<{ Bindings: Record<string, string | undefined> }> {
  return async (c, next) => {
    const expected = c.env[key]
    const got = c.req.header('x-internal-key')
    if (!expected || !got || !timingSafeEqualStr(got, expected)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    await next()
  }
}

export function internalAuth(): MiddlewareHandler<InternalEnv> {
  return internalAuthFor('INTERNAL_KEY') as unknown as MiddlewareHandler<InternalEnv>
}
