/*
 * 暗証番号を「どちら側で伸ばすか」の境界を押さえるテスト。
 *
 * デプロイ先の workerd は PBKDF2 の iterations に **10 万回の上限**があり、既定の
 * 60 万回をサーバで回すと `NotSupportedError` になる。これが、暗証番号のストレッチングを
 * ブラウザ側に置く理由のすべてである（パスワードは最初からその設計だった。
 * `packages/shared/src/password.ts`）。
 *
 * **この上限はローカルの workerd（vitest-pool-workers / miniflare）では課されない。**
 * だからこそ本番でだけ落ち、テストは 1901 本が緑のまま素通りした。上限そのものは
 * ここでは確かめようがないので、代わりに「平文は契約に無い」ことを固定する。
 * 実装がサーバ側ストレッチに戻れば、この 2 本が落ちる。
 * 静的な見張りは `test/no-server-side-stretching.test.mjs`。
 */
import { env, SELF } from 'cloudflare:test'
import { hashStretched, stretchPin } from '@app/shared'
import { describe, expect, it } from 'vitest'
import { authed, BASE, FIXED_NOW, insertStore, orgId, tokenFor } from './helpers'

const PEPPER = 'dev-auth-pepper-change-me'

async function sharedTerminal() {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await insertStore(org)
  const terminalId = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO terminals (id, organization_id, store_id, name, kind, place_note, device_label, pin_hash, auto_lock_seconds, last_seen_at, is_active, version, created_at) VALUES (?,?,?,?,?,'','',?,120,?,'1',1,?)",
  )
    .bind(
      terminalId,
      org,
      storeId,
      '銀座店 レジ横iPad',
      'shared',
      await hashStretched(await stretchPin('2580', org, terminalId, 1), PEPPER),
      FIXED_NOW,
      FIXED_NOW,
    )
    .run()
  return { org, token, terminalId }
}

const startSession = (token: string, terminalId: string, body: unknown) =>
  SELF.fetch(`${BASE}/api/staff/terminals/${terminalId}/sessions`, {
    method: 'POST',
    headers: { ...authed(token), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('暗証番号を伸ばす側', () => {
  it('平文の暗証番号は契約に無いので、送っても400で断られる', async () => {
    const terminal = await sharedTerminal()
    const response = await startSession(terminal.token, terminal.terminalId, {
      mode: 'shared',
      pin: '2580',
    })
    expect(response.status).toBe(400)
  })

  it('伸ばした値が合えば業務セッションが開く（サーバはHMACを1回するだけ）', async () => {
    const terminal = await sharedTerminal()
    const response = await startSession(terminal.token, terminal.terminalId, {
      mode: 'shared',
      stretchedPin: await stretchPin('2580', terminal.org, terminal.terminalId, 1),
    })
    expect(response.status).toBe(200)
  })
})
