/**
 * staging 環境だけを守るゲート。
 *
 * `*.workers.dev` は URL を知っていれば誰でも叩ける。独自ドメインを持たないため
 * Cloudflare Access は適用できず(Access は自分の zone のホスト名にしか掛からない)、
 * Worker の中でトークンを要求する。
 *
 * `STAGING_ACCESS_TOKEN` が未設定なら**何もしない**。production はこの secret を
 * 持たないので、本番の経路にこのミドルウェアは一切影響しない。
 */
import type { MiddlewareHandler } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { timingSafeEqualStr } from './timing-safe'

export const STAGING_GATE_COOKIE = 'staging_gate'

/** 30 日。staging を触る人が毎日貼り直さずに済み、放置端末に残り続けもしない長さ。 */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

type StagingGateEnv = { Bindings: { STAGING_ACCESS_TOKEN?: string } }

export function stagingGate(): MiddlewareHandler<StagingGateEnv> {
  return async (c, next) => {
    const expected = c.env?.STAGING_ACCESS_TOKEN
    // 未設定 = production / ローカル / テスト。ゲートは存在しないものとして振る舞う。
    if (!expected) {
      await next()
      return
    }
    // service binding の内部 API は x-internal-key が守る。ブラウザ資格は持てない。
    if (c.req.path.startsWith('/api/internal/')) {
      await next()
      return
    }

    const url = new URL(c.req.url)
    const fromQuery = url.searchParams.get('gate')
    if (fromQuery !== null) {
      if (!timingSafeEqualStr(fromQuery, expected)) return c.text('unauthorized', 401)
      // 資格を Cookie に移し、URL からトークンを消す(履歴・Referer に残さない)。
      setCookie(c, STAGING_GATE_COOKIE, expected, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: MAX_AGE_SECONDS,
      })
      url.searchParams.delete('gate')
      return c.redirect(`${url.pathname}${url.search}`, 302)
    }

    const cookie = getCookie(c, STAGING_GATE_COOKIE)
    if (cookie && timingSafeEqualStr(cookie, expected)) {
      await next()
      return
    }
    return c.text('unauthorized', 401)
  }
}
