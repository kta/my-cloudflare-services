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

/**
 * API を直に叩くときに使う端末。**画面が使う端末とは別のものを選ぶ。**
 *
 * 端末セッションを開くと、その端末の既存のセッションは失効する（同じ iPad を
 * 2 人が同時に持てない、という当たり前の決まり）。前提づくりで同じ端末の
 * セッションを開くと、**開いている画面の資格情報がその場で無効になり**、
 * 以降の操作が「うまく処理できませんでした」で落ちる。
 *
 * 画面の導線（`completeSeededTerminalStart`）はレジ横 iPad を使うので、
 * ここは受付 iPad を使う。
 */
const API_TERMINAL_NAME = '受付iPad'

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
  const shared =
    body.terminals.find((terminal) => terminal.name.includes(API_TERMINAL_NAME)) ??
    body.terminals.find((terminal) => terminal.kind === 'shared')
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

/**
 * seed の端末が動くための担当店舗の権限を、**責任者ぶんまとめて**配る。
 *
 * 端末は責任者の権限で動く（`terminals.staff_id` → `staff.admin_user_id` → JWT の
 * `sub`）。共有端末は店長（`dev:eye`）、個人端末は持ち主（`dev:eye-sato`）なので、
 * どちらの面を開くかで要る行が変わる。片方だけ配ると、もう片方が 403 になる。
 */
const SEEDED_OPERATOR_USER_IDS = ['dev:eye', 'dev:eye-sato'] as const

export async function grantSeededOperators(
  request: APIRequestContext,
  input: {
    organizationId: string
    storeId: string
    permissions: readonly string[]
    /** 行の id は利用者ごとに変える（同じ id で上書きすると 1 人ぶんしか残らない）。 */
    membershipId: string
  },
): Promise<void> {
  for (const [index, userId] of SEEDED_OPERATOR_USER_IDS.entries()) {
    const res = await request.post('/api/internal/store-memberships/sync', {
      headers: { 'x-internal-key': 'dev-internal-key' },
      data: {
        id: index === 0 ? input.membershipId : `${input.membershipId.slice(0, -1)}${index}`,
        organizationId: input.organizationId,
        storeId: input.storeId,
        userId,
        permissions: input.permissions,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    })
    if (res.status() !== 200) {
      throw new Error(`担当店舗の権限を配れなかった (${userId}): ${res.status()}`)
    }
  }
}

/**
 * 会社の同期行を置く。
 *
 * 以前は dev グラントが「知らない組織にもトークンを出したうえで `organizations` に
 * 行を作る」ので、テストは何もしなくてよかった。その抜け道は撤去したので、
 * **実運用と同じ経路**（admin からの同期）で行を作る。行が無いと業務 API は
 * 503 `not_synced` を返す。
 */
export async function syncOrganization(
  request: APIRequestContext,
  organizationId: string,
): Promise<void> {
  const res = await request.post('/api/internal/organizations/sync', {
    headers: { 'x-internal-key': 'dev-internal-key' },
    data: {
      id: organizationId,
      name: organizationId,
      plan: 'free',
      isDisabled: false,
      createdAt: '2026-08-01T00:00:00.000Z',
      revision: 0,
    },
  })
  if (res.status() !== 200) {
    throw new Error(`会社の同期行を置けなかった (${organizationId}): ${res.status()}`)
  }
}
