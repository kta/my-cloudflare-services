import { signAccessToken } from '@app/shared'
import type { APIRequestContext } from '@playwright/test'

/**
 * e2e が API を直に叩くための資格情報。
 *
 * 以前は dev グラント（`POST /api/auth/token`）で取っていたが、あの経路は
 * credential を検査せずに任意の組織のトークンを出すもので、本番では決して
 * 有効にできなかった。撤去したので、**実際の入口と同じ道**で取る ——
 * `/s/:storeSlug` が使う公開の端末セッションである。
 *
 * これにより、e2e の前提づくりが本番と同じ経路を通る。抜け道でしか通らない
 * 状態が e2e に残ると、その抜け道を塞いだ日に初めて気づくことになる。
 */

/** seed の銀座店。`seed.mjs` の `slug: 'ginza'` と揃えている。 */
const SEED_STORE_SLUG = 'ginza'
/** seed の共有端末の暗証番号。`seed.mjs` が全端末に同じ値を置いている。 */
const SEED_TERMINAL_PIN = '000000'

type SiteResponse = {
  store: { slug: string; name: string }
  terminals: { id: string; name: string; kind: 'shared' | 'personal' }[]
}

/**
 * 業務トークンと端末セッションを、公開の入口から取る。
 * `slug` の店の**共有端末の 1 台目**を使う（個人端末は持ち主の暗証番号が要る）。
 */
export async function startSeededTerminal(
  request: APIRequestContext,
  slug: string = SEED_STORE_SLUG,
): Promise<{
  headers: Record<string, string>
  token: string
  terminalId: string
  sessionToken: string
}> {
  const site = await request.get(`/api/public/sites/${slug}`)
  if (site.status() !== 200) {
    throw new Error(`公開の入口が開けない (${slug}): ${site.status()}`)
  }
  const body = (await site.json()) as SiteResponse
  const shared = body.terminals.find((terminal) => terminal.kind === 'shared')
  if (shared === undefined) throw new Error(`共有端末が seed に無い (${slug})`)

  const started = await request.post(`/api/public/sites/${slug}/terminals/${shared.id}/sessions`, {
    data: { pin: SEED_TERMINAL_PIN },
  })
  if (started.status() !== 200) {
    throw new Error(`暗証番号で入れない (${shared.id}): ${started.status()}`)
  }
  const session = (await started.json()) as {
    token: string
    session: { sessionToken: string }
  }
  return {
    headers: { authorization: `Bearer ${session.token}` },
    token: session.token,
    terminalId: shared.id,
    sessionToken: session.session.sessionToken,
  }
}

/** 業務 API を叩くための `authorization` ヘッダーだけが要るとき。 */
export async function authHeadersFor(
  request: APIRequestContext,
  slug: string = SEED_STORE_SLUG,
): Promise<Record<string, string>> {
  return (await startSeededTerminal(request, slug)).headers
}

/**
 * 任意の組織・ロールのトークンを **e2e 自身が署名して**作る。
 *
 * テナント分離（別会社のデータが見えないこと）や、店舗をまだ 1 つも持たない
 * 新しい会社の検証では、seed の端末が存在しない組織のトークンが要る。公開の
 * 入口はその組織の店舗と端末を前提にするので、そこからは作れない。
 *
 * かつては dev グラントがこれを担っていたが、あれは**サーバ側の抜け道**だった。
 * e2e は Node で動くので、鍵を持っているならこちら側で署名すればよい ——
 * サーバに credential を検査しない経路を残す理由にはならない。
 *
 * 鍵はローカル e2e の dev 値（`.dev.vars.example` の `JWT_SECRET`）。
 * `E2E_JWT_SECRET` で上書きできる。
 */
const E2E_JWT_SECRET = process.env.E2E_JWT_SECRET ?? 'dev-jwt-secret-change-me'

export async function signedTokenFor(
  organizationId: string,
  role: 'admin' | 'staff' = 'staff',
): Promise<string> {
  return signAccessToken(
    {
      sub: `dev:${organizationId}`,
      org: organizationId,
      email: `${role}@example.com`,
      role,
    },
    E2E_JWT_SECRET,
  )
}

/** 上を bearer ヘッダーの形で返す。 */
export async function signedHeadersFor(
  organizationId: string,
  role: 'admin' | 'staff' = 'staff',
): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await signedTokenFor(organizationId, role)}` }
}
