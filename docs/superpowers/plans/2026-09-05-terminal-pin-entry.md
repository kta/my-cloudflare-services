# 業務端末の入口を PIN だけにする Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 業務端末が `/s/:storeSlug` を開いて PIN を打つだけで業務を始められるようにし、開発用の抜け道 `POST /api/auth/token`（dev グラント）を撤去する。

**Architecture:** `stores.slug` が全組織横断で一意である性質を使い、未認証の `/api/public/sites/:storeSlug` から組織と端末一覧を引く。PIN 照合の成功が access JWT（15 分・メモリ保持）と端末 refresh（HttpOnly Cookie・30 日・ローテーション）を発行する。admin は人の認証、glasses は端末の認証を持つ。トークンには `kind: 'user' | 'terminal'` を足し、端末トークンが admin へ流れ込むのを塞ぐ。

**Tech Stack:** Cloudflare Workers / Hono / Drizzle + D1 / Workers KV / Zod（`packages/contracts` 単一ソース）/ React 19 + Vite / Vitest（`@cloudflare/vitest-pool-workers` と jsdom）/ Playwright

**Spec:** `docs/superpowers/specs/2026-09-05-terminal-pin-entry-design.md`

## Global Constraints

- **作業場所**: worktree `../my-cloudflare-services-worktrees/fix-staging-seed-env`、ブランチ `feat/terminal-pin-entry`（`origin/develop` 起点）。
- **TDD 必須**: 挙動を足す production code は、必ず「期待した理由で落ちるテスト」を先に確認してから書く（`CLAUDE.md` 絶対ルール 2）。
- **型は派生物**: API 契約は `packages/contracts/src/glasses_management.ts` と `.../auth.ts` の Zod が単一ソース。手書き型・`any` は禁止（`unknown` + Zod）。
- **テナントスコープ強制**: 全 DB クエリを `organization_id` でスコープする。公開ルートでは JWT の代わりに slug から解決した組織を使う。
- **時刻は注入**: `Date.now()` に依存したテストを書かない。Worker は `c.env.TEST_NOW`、純粋関数は引数で受ける。
- **FK を宣言しない / ID はアプリ生成（`crypto.randomUUID()`）/ 原子性は `db.batch()`**（絶対ルール 7）。
- **デザインはトークン経由のみ**: 色・フォント・角丸は `packages/ui/src/theme.css` のセマンティックトークンだけ。Tailwind デフォルトパレット（`bg-blue-500`）と任意値（`p-[13px]`・`text-[#hex]`）は禁止（絶対ルール 5）。
- **カバレッジ下限**: backend 各指標 80% 以上、frontend 各指標 60% 以上。閾値を下げて通さない。
- **コミット**: Conventional Commits。各タスクの最後に 1 コミット。
- **マイグレーション**: `pnpm --filter @app/glasses_management db:generate` → `db:migrate:local`。`out` == `migrations_dir` == `./migrations`。
- **PIN の桁**: `Pin = /^\d{4,6}$/`。既存の 4 桁端末は動かし続ける。新規作成の既定を 6 桁にするだけ。
- **1 テストに絞る**: `pnpm --filter @app/glasses_management exec vitest run -t "<name>"`（web は `--config vitest.web.config.ts` を足す）。

---

## File Structure

**新規**

| ファイル | 責務 |
|---|---|
| `services/glasses_management/src/worker/domain/device-credential.ts` | 端末 refresh の発行・検証・ローテーションの純粋部分 |
| `services/glasses_management/src/worker/public-site.ts` | 公開ルート 3 本のハンドラ |
| `services/glasses_management/src/web/site/SiteEntry.tsx` | `/s/:slug` の画面（置き場所選択 → PIN） |
| `services/glasses_management/src/web/site/siteRoute.ts` | `/s/` の判定と slug 取り出し（`public/PublicBookingApp` と同じ流儀） |
| `services/glasses_management/test/public-site.integration.test.ts` | 公開ルートの代表フロー |
| `services/glasses_management/test/public-site.time.test.ts` | refresh 30 日・access 15 分・ロック階段の境界 |
| `services/glasses_management/migrations/00NN_terminal_staff_and_devices.sql` | `terminals.staff_id` と `terminal_devices` |

**変更**

| ファイル | 変更内容 |
|---|---|
| `packages/contracts/src/auth.ts` | `AuthTokenPayload` に `kind`。`TokenKind` を新設 |
| `packages/shared/src/jwt.ts` | `AccessClaims` に `kind`。`signAccessToken` の既定を `'user'` に |
| `packages/shared/src/auth-server.ts` | `AuthVariables.auth` に `kind`。`requireUserToken()` を新設 |
| `packages/contracts/src/glasses_management.ts` | `PublicSite` / `PublicTerminal` / `PublicTerminalSessionStart` / `TerminalStaffAssignment` |
| `services/glasses_management/src/worker/db/schema.ts` | `terminals.staffId`、`terminalDevices` テーブル |
| `services/glasses_management/src/worker/domain/pin.ts` | 階段状のロック（`lockSecondsFor`・`parsePinStreak`） |
| `services/glasses_management/src/worker/index.ts` | 公開ルートの登録、セッション生成の共通化、dev グラント削除 |
| `services/glasses_management/src/web/App.tsx` | `StartWork`（お店のコード）を削除 |
| `services/glasses_management/src/web/main.tsx` | `/s/` の振り分け |
| `services/admin/src/worker/index.ts` | `kind === 'terminal'` を拒む |
| `.github/workflows/ci.yml` | `AUTH_DEV_GRANT` の同期を削除 |
| `specs/glasses_management/features/003-service-foundation/spec.md` | AC-FOUND-01 改訂・AC-FOUND-03 移設 |
| `specs/glasses_management/features/013-terminals-and-audit/spec.md` | AC-TERM-01/02/03/04/05/16 改訂、23/24/25 追加 |

---

## Task 1: トークンに `kind` を足し、admin が端末トークンを拒む

`packages/shared/src/jwt.ts` が自ら警告しているとおり、`JWT_SECRET` は全サービス共有で `aud`/`iss` が無い。glasses を 2 人目の発行者にする前に、この穴を先に塞ぐ。

**Files:**
- Modify: `packages/contracts/src/auth.ts`
- Modify: `packages/shared/src/jwt.ts`
- Modify: `packages/shared/src/auth-server.ts`
- Modify: `services/admin/src/worker/index.ts`
- Test: `packages/shared/test/jwt.test.ts`（既存に追記）
- Test: `services/admin/test/permissions.test.ts`（既存に追記）

**Interfaces:**
- Produces: `TokenKind = z.enum(['user','terminal'])`、`AccessClaims.kind?: TokenKind`、`AuthVariables.auth.kind: TokenKind`、`requireUserToken(): MiddlewareHandler`
- Consumes: なし（最初のタスク）

- [ ] **Step 1: 契約に `kind` を足す失敗テストを書く**

`packages/shared/test/jwt.test.ts` に追記:

```ts
it('kind を省いたトークンは user として読める（既存トークンとの互換）', async () => {
  const token = await sign({ sub: 'u1', org: 'o1', email: 'a@b.c', role: 'staff', exp: nowSec() + 60 }, SECRET, 'HS256')
  const payload = await verifyAccessToken(token, SECRET)
  expect(payload?.kind).toBe('user')
})

it('kind: terminal を発行して読み戻せる', async () => {
  const token = await signAccessToken(
    { sub: 't1', org: 'o1', email: 'terminal@terminal.invalid', role: 'staff', kind: 'terminal' },
    SECRET,
  )
  const payload = await verifyAccessToken(token, SECRET)
  expect(payload?.kind).toBe('terminal')
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `pnpm --filter @app/shared exec vitest run -t "kind"`
Expected: FAIL（`kind` が型にも実装にも無い）

- [ ] **Step 3: 契約と署名を実装する**

`packages/contracts/src/auth.ts`:

```ts
/**
 * トークンの主体。`user` は admin が発行する人のトークン、`terminal` は
 * glasses_management が発行する端末のトークン。
 *
 * JWT_SECRET は全サービスで共有され `aud`/`iss` が無いため、発行者が 2 人に
 * なった時点で「どのサービス向けか」を本文で名乗らせる必要がある。省略時は
 * `user` とし、この変更より前に出たトークンをそのまま通す。
 */
export const TokenKind = z.enum(['user', 'terminal'])
export type TokenKind = z.infer<typeof TokenKind>

export const AuthTokenPayload = z.looseObject({
  sub: z.string(),
  org: z.string(),
  email: z.string().email(),
  role: Role,
  kind: TokenKind.default('user'),
  exp: z.number(),
})
```

`packages/shared/src/jwt.ts`:

```ts
export type AccessClaims = {
  sub: string
  org: string
  email: string
  role: Role
  /** 省略時は 'user'。端末トークンは必ず 'terminal' を明示する。 */
  kind?: TokenKind
}

export async function signAccessToken(
  claims: AccessClaims,
  secret: string,
  ttlSeconds = ACCESS_TTL_SECONDS,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  return sign({ kind: 'user', ...claims, exp: now + ttlSeconds }, secret, 'HS256')
}
```

`packages/shared/src/auth-server.ts` の `AuthVariables` と `tenantAuth` に `kind` を通す:

```ts
export type AuthVariables = {
  auth: { sub: string; org: string; email: string; role: Role; kind: TokenKind }
  org?: { plan: Plan; isDisabled: boolean }
}
```

`tenantAuth()` の `c.set('auth', …)` に `kind: payload.kind` を足す。

- [ ] **Step 4: 通ることを確かめる**

Run: `pnpm --filter @app/shared exec vitest run -t "kind"`
Expected: PASS

- [ ] **Step 5: admin が端末トークンを拒む失敗テストを書く**

`services/admin/test/permissions.test.ts` に追記:

```ts
/*
 * JWT_SECRET は全サービス共有で aud/iss が無い。glasses_management が発行する
 * 端末トークンは、署名としては admin でも正しい。本文の kind で拒む。
 * 運営ゲートの外にある /api/users・/api/me/*・/api/organizations/:id/stores を
 * 必ず含める —— そこが素通りすると、店頭の iPad から社員名簿が引ける。
 */
const TERMINAL_TOKEN_PATHS = [
  '/api/users',
  '/api/me/pin',
  '/api/organizations/org-1/stores',
  '/api/organizations',
  '/api/no/such/path',
] as const

for (const path of TERMINAL_TOKEN_PATHS) {
  it(`kind=terminal のトークンは ${path} で拒まれる`, async () => {
    const token = await signAccessToken(
      { sub: 'terminal-1', org: 'org-1', email: 'terminal@terminal.invalid', role: 'admin', kind: 'terminal' },
      JWT_SECRET,
    )
    const res = await SELF.fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'terminal_token_rejected' })
  })
}
```

- [ ] **Step 6: 落ちることを確かめる**

Run: `pnpm --filter @app/admin exec vitest run -t "kind=terminal"`
Expected: FAIL（200 か 401/404 が返る）

- [ ] **Step 7: admin に門を足す**

`packages/shared/src/auth-server.ts`:

```ts
/**
 * 端末トークンを拒む。admin は人の認証だけを扱うので、端末が名乗ってきたら
 * ロールを見るまでもなく断る。tenantAuth の直後に置く。
 */
export function rejectTerminalToken(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (c.get('auth')?.kind === 'terminal') {
      return c.json({ error: 'terminal_token_rejected' }, 403)
    }
    await next()
  }
}
```

`services/admin/src/worker/index.ts` — `/api/*` の default-deny と、その門の外にある各ルートの両方に効かせるため、`tenantAuth()` を使うすべての箇所の直後へ入れる。既存の `except([...], tenantAuth(), requireActiveOrg(orgResolver))` を次に替える:

```ts
app.use(
  '/api/*',
  except(
    [
      '/api/health',
      '/api/auth/*',
      '/api/internal/*',
    ],
    tenantAuth(),
    rejectTerminalToken(),
  ),
)
```

**注意**: 既存の except リストから `/api/users` 等を外すのではなく、**`tenantAuth` + `rejectTerminalToken` だけを全 `/api/*` に先に掛け、運営限定ゲートは従来どおり後段に残す**。運営ゲートの except リストはそのまま。

- [ ] **Step 8: 通ることを確かめる**

Run: `pnpm --filter @app/admin exec vitest run -t "kind=terminal"`
Expected: PASS（5 パスすべて 403）

- [ ] **Step 9: 波及を確かめる**

Run: `pnpm --filter @app/shared test && pnpm --filter @app/admin test && pnpm --filter @app/example_service test && pnpm --filter @app/patent_research test`
Expected: すべて PASS（`kind` は省略時 `user` なので既存は無傷）

- [ ] **Step 10: Commit**

```bash
git add packages/contracts/src/auth.ts packages/shared/src/jwt.ts packages/shared/src/auth-server.ts services/admin/src/worker/index.ts packages/shared/test/jwt.test.ts services/admin/test/permissions.test.ts
git commit -m "feat(auth): トークンに kind を足し、admin が端末トークンを拒む"
```

---

## Task 2: `terminals.staff_id` と `terminal_devices`

個人端末の PIN を 2 回にしないため、個人端末を 1 人に紐づける。あわせて端末 refresh の置き場所を作る。

**Files:**
- Modify: `services/glasses_management/src/worker/db/schema.ts`
- Create: `services/glasses_management/migrations/<generated>.sql`（`db:generate` が作る）
- Modify: `packages/contracts/src/glasses_management.ts`
- Modify: `services/glasses_management/seed.mjs`
- Test: `services/glasses_management/test/schema.test.ts`（既存に追記）

**Interfaces:**
- Consumes: なし
- Produces: `terminals.staffId: string | null`、`terminalDevices` テーブル、`Terminal` 契約に `staffId: Uuid.nullable()`

- [ ] **Step 1: schema の失敗テストを書く**

`services/glasses_management/test/schema.test.ts` に追記:

```ts
it('terminals に staff_id があり、personal の端末に人を紐づけられる', async () => {
  const row = await env.DB.prepare(
    "SELECT name FROM pragma_table_info('terminals') WHERE name = 'staff_id'",
  ).first<{ name: string }>()
  expect(row?.name).toBe('staff_id')
})

it('terminal_devices があり、端末ごとの資格情報を複数持てる', async () => {
  const cols = await env.DB.prepare("SELECT name FROM pragma_table_info('terminal_devices')").all<{ name: string }>()
  expect(cols.results.map((c) => c.name).sort()).toEqual(
    ['created_at', 'credential_hash', 'expires_at', 'id', 'last_used_at', 'organization_id', 'revoked_at', 'terminal_id'].sort(),
  )
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run -t "terminal_devices"`
Expected: FAIL（列もテーブルも無い）

- [ ] **Step 3: schema を書く**

`services/glasses_management/src/worker/db/schema.ts` の `terminals` に 1 列足す:

```ts
    // kind='personal' の端末が持ち主。NULL のまま personal にはしない（割り当てが
    // 済むまで /s/:slug の一覧に出さない）。shared では常に NULL。
    staffId: text('staff_id'),
```

同じファイルに新しいテーブルを足す:

```ts
/**
 * 端末そのものの資格情報。**業務セッションとは別の寿命**を持つ。
 *
 * 業務セッション（terminal_sessions）は共有なら業務日、個人なら auto_lock_seconds で
 * 切れる。いっぽうこちらは 30 日で、使うたびにローテーションする。分けるのは、
 * 「画面を伏せる／業務を終える」と「この iPad が誰のものか」が別の話だからである。
 *
 * 平文は Cookie にしか出さない。D1 には SHA-256 のハッシュだけを置く。
 * 失効は行を消さずに revoked_at へ記録する（端末の乗っ取りを後から追えるように）。
 */
export const terminalDevices = sqliteTable(
  'terminal_devices',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    terminalId: text('terminal_id').notNull(),
    credentialHash: text('credential_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // Cookie の平文からハッシュを引いて 1 行を出す、唯一の読み筋。
    uniqueIndex('terminal_devices_hash_idx').on(t.credentialHash),
    // 端末を無効化するとき、その端末の生きている資格情報を全部落とす。
    index('terminal_devices_org_terminal_idx').on(t.organizationId, t.terminalId),
  ],
)
```

- [ ] **Step 4: マイグレーションを作って当てる**

```bash
pnpm --filter @app/glasses_management db:generate
pnpm --filter @app/glasses_management db:migrate:local
```

生成された SQL を目で確かめる。`ALTER TABLE terminals ADD COLUMN staff_id text;` と `CREATE TABLE terminal_devices …` の 2 つだけであること。既存行を触る `UPDATE` が入っていたら破棄してやり直す。

- [ ] **Step 5: 通ることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run -t "terminal_devices"`
Expected: PASS

- [ ] **Step 6: 契約に `staffId` を足す**

`packages/contracts/src/glasses_management.ts` の `Terminal` に足す:

```ts
  /** kind='personal' の持ち主。shared では null。 */
  staffId: Uuid.nullable(),
```

- [ ] **Step 7: seed に個人端末を 1 台足す**

`services/glasses_management/seed.mjs` の端末に、銀座店の個人端末を 1 台足す。id は固定値（`INSERT OR IGNORE` が冪等であるために必須）。`staff_id` は佐藤 美咲の固定 id を指す。PIN は佐藤 美咲の個人 PIN と同じものを使う（端末 PIN は NULL のまま）。

- [ ] **Step 8: seed を流し直して確かめる**

```bash
pnpm --filter @app/glasses_management db:seed:local
```
Expected: 端末 4 台（shared 3・personal 1）。2 回流しても増えない。

- [ ] **Step 9: Commit**

```bash
git add services/glasses_management/src/worker/db/schema.ts services/glasses_management/migrations packages/contracts/src/glasses_management.ts services/glasses_management/seed.mjs services/glasses_management/test/schema.test.ts
git commit -m "feat(glasses_management): 個人端末に持ち主を持たせ、端末の資格情報を置く場所を作る"
```

---

## Task 3: PIN のロックを階段にする

PIN が公開オリジン唯一の資格情報になる。既存の「3 回で 30 秒」だけでは、4 桁 10,000 通りが約 3.5 日で尽きる。

**Files:**
- Modify: `services/glasses_management/src/worker/domain/pin.ts`
- Test: `services/glasses_management/test/pin.test.ts`（新規。純粋関数だけなので Worker を起こさない）

**Interfaces:**
- Consumes: なし
- Produces: `pinStreakKey(org, terminalId): string`、`parsePinStreak(raw): number`、`lockSecondsFor(totalFailures): number`

- [ ] **Step 1: 失敗テストを書く**

`services/glasses_management/test/pin.test.ts`:

```ts
/**
 * PIN の階段状ロック。境界のちょうどと ±1 を必ず押さえる。
 * 時刻は引数で受けるので、この表に実時刻は出てこない。
 */
import { describe, expect, it } from 'vitest'
import { lockSecondsFor, parsePinStreak, pinStreakKey } from '../src/worker/domain/pin'

describe('lockSecondsFor', () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 30],
    [9, 30],
    [10, 15 * 60],
    [19, 15 * 60],
    [20, 60 * 60],
    [21, 2 * 60 * 60],
    [22, 4 * 60 * 60],
  ])('%i 回の失敗で %i 秒待たせる', (failures, seconds) => {
    expect(lockSecondsFor(failures)).toBe(seconds)
  })

  it('上限は 24 時間で頭打ちにする（永久ロックで店を止めない）', () => {
    expect(lockSecondsFor(100)).toBe(24 * 60 * 60)
  })
})

describe('parsePinStreak', () => {
  it('壊れた値は 0 として扱う（KV は正本ではない）', () => {
    expect(parsePinStreak('{')).toBe(0)
    expect(parsePinStreak(null)).toBe(0)
    expect(parsePinStreak('-3')).toBe(0)
  })

  it('数字の文字列を読む', () => {
    expect(parsePinStreak('7')).toBe(7)
  })
})

describe('pinStreakKey', () => {
  it('組織と端末で分ける（別テナントの失敗が混ざらない）', () => {
    expect(pinStreakKey('o1', 't1')).not.toBe(pinStreakKey('o2', 't1'))
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run -t "lockSecondsFor"`
Expected: FAIL（`lockSecondsFor` が export されていない）

- [ ] **Step 3: 実装する**

`services/glasses_management/src/worker/domain/pin.ts` に追記:

```ts
/**
 * 階段状のロック。既存の「3 回で 30 秒」の外側に、長い窓の合計失敗回数で
 * さらに待たせる層を重ねる。
 *
 * 4 桁は 10,000 通りしかない。30 秒待ちだけでは約 3.5 日で尽きるので、
 * 公開の入口に置く以上この層が要る。いっぽう永久ロックは店を止めるので、
 * 24 時間で頭打ちにする。
 */
const STREAK_LOCK_STEPS = [
  { failures: 20, seconds: 60 * 60 },
  { failures: 10, seconds: 15 * 60 },
  { failures: 3, seconds: 30 },
] as const
const STREAK_LOCK_CEILING_SECONDS = 24 * 60 * 60

export function lockSecondsFor(totalFailures: number): number {
  const failures = Math.max(0, Math.floor(totalFailures))
  if (failures > 20) {
    const doublings = failures - 20
    const seconds = 60 * 60 * 2 ** doublings
    return Math.min(seconds, STREAK_LOCK_CEILING_SECONDS)
  }
  return STREAK_LOCK_STEPS.find((step) => failures >= step.failures)?.seconds ?? 0
}

/** 長い窓の失敗回数キー。端末単位（スタッフ単位ではない）。 */
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
```

- [ ] **Step 4: 通ることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run -t "lockSecondsFor"`
Expected: PASS（表の 10 行 + 上限 + parse 3 件 + key 1 件）

- [ ] **Step 5: Commit**

```bash
git add services/glasses_management/src/worker/domain/pin.ts services/glasses_management/test/pin.test.ts
git commit -m "feat(glasses_management): PIN のロックを階段にする"
```

---

## Task 4: 端末の資格情報（発行・検証・ローテーション）

**Files:**
- Create: `services/glasses_management/src/worker/domain/device-credential.ts`
- Test: `services/glasses_management/test/device-credential.test.ts`

**Interfaces:**
- Consumes: Task 2 の `terminalDevices`
- Produces:
  - `DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60`
  - `newDeviceCredential(): Promise<{ token: string; hash: string }>`
  - `hashDeviceToken(token: string): Promise<string>`
  - `deviceExpiresAt(now: Date): string`
  - `isDeviceUsable(row: { expiresAt: string; revokedAt: string | null }, now: Date): boolean`

- [ ] **Step 1: 失敗テストを書く**

`services/glasses_management/test/device-credential.test.ts`:

```ts
/**
 * 端末の資格情報。30 日の境界は「ちょうど」と「±1 秒」を押さえる。
 * 期限切れで入れなくなること自体が仕様（そのとき PIN からやり直す）。
 */
import { describe, expect, it } from 'vitest'
import {
  DEVICE_TTL_SECONDS,
  deviceExpiresAt,
  hashDeviceToken,
  isDeviceUsable,
  newDeviceCredential,
} from '../src/worker/domain/device-credential'

const NOW = new Date('2026-09-05T00:00:00.000Z')

describe('newDeviceCredential', () => {
  it('平文とハッシュを返し、平文は毎回違う', async () => {
    const a = await newDeviceCredential()
    const b = await newDeviceCredential()
    expect(a.token).not.toBe(b.token)
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43,}$/)
    expect(await hashDeviceToken(a.token)).toBe(a.hash)
  })
})

describe('isDeviceUsable', () => {
  const expiresAt = deviceExpiresAt(NOW)

  it('期限のちょうど 1 秒前は使える', () => {
    const at = new Date(NOW.getTime() + (DEVICE_TTL_SECONDS - 1) * 1000)
    expect(isDeviceUsable({ expiresAt, revokedAt: null }, at)).toBe(true)
  })

  it('期限ちょうどは使えない', () => {
    const at = new Date(NOW.getTime() + DEVICE_TTL_SECONDS * 1000)
    expect(isDeviceUsable({ expiresAt, revokedAt: null }, at)).toBe(false)
  })

  it('失効した資格情報は期限内でも使えない', () => {
    expect(
      isDeviceUsable({ expiresAt, revokedAt: '2026-09-05T00:00:01.000Z' }, NOW),
    ).toBe(false)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run -t "isDeviceUsable"`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

`services/glasses_management/src/worker/domain/device-credential.ts`:

```ts
/**
 * 端末そのものの資格情報。業務セッションとは別の寿命を持つ（30 日・使うたび
 * ローテーション）。平文は HttpOnly Cookie にしか出さず、D1 には SHA-256 だけ置く。
 *
 * 時刻は必ず引数で受ける。`Date.now()` をここで呼ぶと、境界のテストが実時刻に
 * 縛られる。
 */
export const DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function hashDeviceToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return base64Url(new Uint8Array(digest))
}

export async function newDeviceCredential(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = base64Url(bytes)
  return { token, hash: await hashDeviceToken(token) }
}

export function deviceExpiresAt(now: Date): string {
  return new Date(now.getTime() + DEVICE_TTL_SECONDS * 1000).toISOString()
}

/** 期限ちょうどは切れている扱い。失効していれば期限内でも使えない。 */
export function isDeviceUsable(
  row: { expiresAt: string; revokedAt: string | null },
  now: Date,
): boolean {
  if (row.revokedAt !== null) return false
  return now.getTime() < Date.parse(row.expiresAt)
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run -t "isDeviceUsable"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/glasses_management/src/worker/domain/device-credential.ts services/glasses_management/test/device-credential.test.ts
git commit -m "feat(glasses_management): 端末の資格情報を発行・検証する"
```

---

## Task 5: 公開ルート `GET /api/public/sites/:storeSlug`

**Files:**
- Create: `services/glasses_management/src/worker/public-site.ts`
- Modify: `services/glasses_management/src/worker/index.ts`
- Modify: `packages/contracts/src/glasses_management.ts`
- Test: `services/glasses_management/test/public-site.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 の `terminals.staffId`
- Produces: `PublicSite`・`PublicTerminal` 契約、`GET /api/public/sites/:storeSlug`

- [ ] **Step 1: 契約を書く**

`packages/contracts/src/glasses_management.ts`:

```ts
/** 業務端末の入口が未認証で読む、店舗 1 つぶんの姿。 */
export const PublicTerminal = z.strictObject({
  id: Uuid,
  name: z.string(),
  placeNote: z.string().nullable(),
  kind: TerminalKind,
})
export type PublicTerminal = z.infer<typeof PublicTerminal>

export const PublicSite = z.strictObject({
  store: z.strictObject({ slug: z.string(), name: z.string() }),
  terminals: z.array(PublicTerminal),
})
export type PublicSite = z.infer<typeof PublicSite>
```

- [ ] **Step 2: 失敗テストを書く**

`services/glasses_management/test/public-site.integration.test.ts`:

```ts
/**
 * 業務端末の入口（未認証）。
 *
 * ここで出してよいのは店名と置き場所の名前まで。スタッフの氏名・勤務・在席は
 * PIN を通したあとにしか出さない（設計 §2 制約 4）。押しても入れない行き先も
 * 出さない —— 無効な端末と PIN 未設定の端末は一覧に載せない。
 */
import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { BASE, insertStaff, insertStore, insertTerminal, resetDb } from './helpers'

describe('GET /api/public/sites/:storeSlug', () => {
  beforeEach(async () => {
    await resetDb()
    await insertStore({ id: 'store-1', organizationId: 'eye', slug: 'ginza', name: 'EYE 銀座店' })
    await insertStaff({ id: 'staff-1', organizationId: 'eye', storeId: 'store-1', displayName: '佐藤 美咲', pinHash: 'hmac$x' })
    await insertTerminal({ id: 'term-1', organizationId: 'eye', storeId: 'store-1', name: 'レジ横iPad', kind: 'shared', pinHash: 'hmac$y' })
    await insertTerminal({ id: 'term-2', organizationId: 'eye', storeId: 'store-1', name: '佐藤 美咲の iPad', kind: 'personal', staffId: 'staff-1', pinHash: null })
    await insertTerminal({ id: 'term-3', organizationId: 'eye', storeId: 'store-1', name: 'PIN 未設定', kind: 'shared', pinHash: null })
    await insertTerminal({ id: 'term-4', organizationId: 'eye', storeId: 'store-1', name: '無効', kind: 'shared', pinHash: 'hmac$z', isActive: '0' })
  })

  it('店名と置き場所を、認証なしで返す', async () => {
    const res = await SELF.fetch(`${BASE}/api/public/sites/ginza`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.store).toEqual({ slug: 'ginza', name: 'EYE 銀座店' })
    expect(body.terminals.map((t: { id: string }) => t.id).sort()).toEqual(['term-1', 'term-2'])
  })

  it('スタッフの氏名・勤務・在席をどこにも出さない', async () => {
    const res = await SELF.fetch(`${BASE}/api/public/sites/ginza`)
    const text = await res.text()
    expect(text).not.toContain('佐藤 美咲の iPad'.slice(0, 0) + 'staff-1')
    expect(text).not.toContain('shifts')
    expect(text).not.toContain('isOnline')
  })

  it('PIN 未設定と無効な端末は出さない（押しても入れない行き先を出さない）', async () => {
    const res = await SELF.fetch(`${BASE}/api/public/sites/ginza`)
    const body = await res.json()
    const ids = body.terminals.map((t: { id: string }) => t.id)
    expect(ids).not.toContain('term-3')
    expect(ids).not.toContain('term-4')
  })

  it('知らない slug は 404', async () => {
    const res = await SELF.fetch(`${BASE}/api/public/sites/nope`)
    expect(res.status).toBe(404)
  })
})
```

`insertTerminal` が helpers に無ければ、`staffId` と `isActive` を受ける形で足す。

- [ ] **Step 3: 落ちることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run public-site`
Expected: FAIL（404 が返る。ルートが無い）

- [ ] **Step 4: 実装する**

`services/glasses_management/src/worker/public-site.ts`:

```ts
/**
 * 業務端末の入口（未認証）。
 *
 * `stores.slug` は全組織横断で一意（schema.ts の `stores_slug_idx`）で、
 * まさに「未認証で organization_id を持たないので slug 単独で引く」ために
 * そう設計されている。その性質にそのまま乗る。
 *
 * 既存の `/api/public/stores/:storeSlug` は流用しない。あちらは isPublished で
 * 404 を返す（Web 予約の公開状態）。Web 予約を公開していない店でも iPad は動く。
 */
import { PublicSite } from '@app/contracts'
import type { Context } from 'hono'

type SiteTerminalRow = {
  id: string
  name: string
  placeNote: string | null
  kind: 'shared' | 'personal'
}

export async function readPublicSite(
  db: D1Database,
  slug: string,
): Promise<PublicSite | null> {
  const store = await db
    .prepare("SELECT id, organization_id AS organizationId, slug, name FROM stores WHERE slug = ? AND is_active = '1'")
    .bind(slug)
    .first<{ id: string; organizationId: string; slug: string; name: string }>()
  if (store === null) return null

  // 出せる端末の条件を 1 か所に置く。
  // - is_active='1'：使える端末だけ
  // - shared は自分の pin_hash、personal は紐づくスタッフの pin_hash が要る
  // - personal で staff_id が NULL のものは、割り当て待ちなので出さない
  const rows = await db
    .prepare(
      `SELECT t.id AS id, t.name AS name, t.place_note AS placeNote, t.kind AS kind
         FROM terminals t
         LEFT JOIN staff s
           ON s.organization_id = t.organization_id AND s.id = t.staff_id AND s.is_active = '1'
        WHERE t.organization_id = ? AND t.store_id = ? AND t.is_active = '1'
          AND ( (t.kind = 'shared'   AND t.pin_hash IS NOT NULL)
             OR (t.kind = 'personal' AND t.staff_id IS NOT NULL AND s.pin_hash IS NOT NULL) )
        ORDER BY t.created_at`,
    )
    .bind(store.organizationId, store.id)
    .all<SiteTerminalRow>()

  return PublicSite.parse({
    store: { slug: store.slug, name: store.name },
    terminals: rows.results,
  })
}
```

`services/glasses_management/src/worker/index.ts` のルートチェーンに足す（`/api/public/*` は既に default-deny の except に入っているので、ミドルウェアの追加は不要）:

```ts
  .get('/api/public/sites/:storeSlug', async (c) => {
    const site = await readPublicSite(c.env.DB, c.req.param('storeSlug'))
    if (site === null) return c.json({ error: 'not_found' }, 404)
    return c.json(site)
  })
```

- [ ] **Step 5: 通ることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run public-site`
Expected: PASS（4 件）

- [ ] **Step 6: テナント分離を足す**

`services/glasses_management/test/tenant-isolation.test.ts` に追記:

```ts
it('別テナントの slug からは、そのテナントの端末しか出ない', async () => {
  const res = await SELF.fetch(`${BASE}/api/public/sites/ginza`)
  const body = await res.json()
  for (const terminal of body.terminals) {
    const row = await env.DB.prepare('SELECT organization_id AS org FROM terminals WHERE id = ?')
      .bind(terminal.id)
      .first<{ org: string }>()
    expect(row?.org).toBe('eye')
  }
})
```

- [ ] **Step 7: 権限表に 1 行足す**

`services/glasses_management/test/permissions.test.ts` の表に `/api/public/sites/ginza` を「未認証で 200」として足す。default-deny の証明を保つ。

- [ ] **Step 8: 通ることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run -t "tenant" && pnpm --filter @app/glasses_management exec vitest run permissions`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add services/glasses_management/src/worker/public-site.ts services/glasses_management/src/worker/index.ts packages/contracts/src/glasses_management.ts services/glasses_management/test/
git commit -m "feat(glasses_management): 業務端末の入口を未認証で開く"
```

---

## Task 6: セッション生成の共通化（挙動を変えない）

いまの `POST /api/staff/terminals/:terminalId/sessions` は 100 行ほどのハンドラで、PIN 照合・監査・セッション生成をすべて抱えている。公開ルートが同じことをするので、先に純粋な関数へ括り出す。**このタスクでは挙動を 1 つも変えない。**

**Files:**
- Create: `services/glasses_management/src/worker/terminal-session-start.ts`
- Modify: `services/glasses_management/src/worker/index.ts:4157-4290`

**Interfaces:**
- Consumes: Task 3 の `lockSecondsFor` / `pinStreakKey` / `parsePinStreak`
- Produces:

```ts
export type SessionStartInput = {
  organizationId: string
  terminalId: string
  pin: string
  /** 個人端末のときだけ埋まる。公開ルートはサーバが terminals.staff_id から引く。 */
  staffId: string | null
  mode: 'shared' | 'personal'
}
export type SessionStartResult =
  | { ok: true; session: TerminalSession; storeId: string }
  | { ok: false; status: 401 | 404 | 429; body: Record<string, unknown> }

export async function startTerminalSession(
  env: Bindings,
  input: SessionStartInput,
  now: Date,
): Promise<SessionStartResult>
```

- [ ] **Step 1: 既存テストが緑であることを確かめる（基準線）**

Run: `pnpm --filter @app/glasses_management exec vitest run terminals`
Expected: PASS。この結果を控える。

- [ ] **Step 2: 括り出す**

`index.ts` のハンドラ本体を `terminal-session-start.ts` の `startTerminalSession` へ移す。ハンドラは次だけになる:

```ts
  .post(
    '/api/staff/terminals/:terminalId/sessions',
    zValidator('json', TerminalSessionStart),
    async (c) => {
      const { org } = c.get('auth')
      const input = c.req.valid('json')
      const result = await startTerminalSession(
        c.env,
        {
          organizationId: org,
          terminalId: c.req.param('terminalId'),
          pin: input.pin,
          staffId: input.mode === 'personal' ? input.staffId : null,
          mode: input.mode,
        },
        new Date(c.env.TEST_NOW ?? Date.now()),
      )
      if (!result.ok) return c.json(result.body, result.status)
      return c.json(result.session)
    },
  )
```

- [ ] **Step 3: 同じテストが同じ結果であることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run terminals`
Expected: PASS（Step 1 と同じ件数・同じ内容）

- [ ] **Step 4: Commit**

```bash
git add services/glasses_management/src/worker/terminal-session-start.ts services/glasses_management/src/worker/index.ts
git commit -m "refactor(glasses_management): 端末セッションの開始を括り出す"
```

---

## Task 7: 公開ルートで PIN を通し、トークンと Cookie を出す

**Files:**
- Modify: `services/glasses_management/src/worker/public-site.ts`
- Modify: `services/glasses_management/src/worker/terminal-session-start.ts`
- Modify: `services/glasses_management/src/worker/index.ts`
- Modify: `packages/contracts/src/glasses_management.ts`
- Test: `services/glasses_management/test/public-site.integration.test.ts`
- Test: `services/glasses_management/test/public-site.time.test.ts`

**Interfaces:**
- Consumes: Task 4 の `newDeviceCredential`・`deviceExpiresAt`、Task 6 の `startTerminalSession`
- Produces: `PublicTerminalSessionStart`、`PublicSessionResponse`、`POST /api/public/sites/:storeSlug/terminals/:terminalId/sessions`

- [ ] **Step 1: 契約を書く**

```ts
/** 公開の入口は PIN だけを受ける。mode と staffId はサーバが terminals から引く。 */
export const PublicTerminalSessionStart = z.strictObject({ pin: Pin })
export type PublicTerminalSessionStart = z.infer<typeof PublicTerminalSessionStart>

export const PublicSessionResponse = z.strictObject({
  token: z.string(),
  session: TerminalSession,
})
export type PublicSessionResponse = z.infer<typeof PublicSessionResponse>
```

- [ ] **Step 2: 失敗テストを書く**

`public-site.integration.test.ts` に追記:

```ts
describe('POST /api/public/sites/:slug/terminals/:id/sessions', () => {
  it('共有端末は正しい PIN で access トークンと端末セッションを返す', async () => {
    const res = await SELF.fetch(`${BASE}/api/public/sites/ginza/terminals/term-1/sessions`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ pin: '123456' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session.mode).toBe('shared')
    const claims = JSON.parse(atob(body.token.split('.')[1]))
    expect(claims.org).toBe('eye')
    expect(claims.kind).toBe('terminal')
    expect(res.headers.get('set-cookie')).toMatch(/eye_device=[^;]+; .*HttpOnly/i)
  })

  it('個人端末は body の staffId を受け取らない（strictObject で 400）', async () => {
    const res = await SELF.fetch(`${BASE}/api/public/sites/ginza/terminals/term-2/sessions`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ pin: '2580', staffId: 'someone-else' }),
    })
    expect(res.status).toBe(400)
  })

  it('個人端末は紐づくスタッフの PIN で個人モードになる', async () => {
    const res = await SELF.fetch(`${BASE}/api/public/sites/ginza/terminals/term-2/sessions`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ pin: '2580' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session.mode).toBe('personal')
    expect(body.session.staffId).toBe('staff-1')
  })

  it('slug と terminalId が食い違うと 404（存在を漏らさない）', async () => {
    const res = await SELF.fetch(`${BASE}/api/public/sites/marunouchi/terminals/term-1/sessions`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ pin: '123456' }),
    })
    expect(res.status).toBe(404)
  })

  it('違う PIN は 401 と残り回数を返す', async () => {
    const res = await SELF.fetch(`${BASE}/api/public/sites/ginza/terminals/term-1/sessions`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ pin: '999999' }),
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'pin_invalid', remainingAttempts: 2 })
  })
})
```

- [ ] **Step 3: 落ちることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run public-site`
Expected: FAIL（ルートが無い）

- [ ] **Step 4: 実装する**

`public-site.ts` に足す:

```ts
export const DEVICE_COOKIE = 'eye_device'
/** Cookie の届く範囲を公開の入口だけに絞る。業務 API へは送られない。 */
export const DEVICE_COOKIE_PATH = '/api/public/sites'

/** slug と terminalId の両方で引く。片方だけ正しくても通さない。 */
export async function resolveSiteTerminal(
  db: D1Database,
  slug: string,
  terminalId: string,
): Promise<{ organizationId: string; storeId: string; kind: 'shared' | 'personal'; staffId: string | null } | null> {
  return db
    .prepare(
      `SELECT t.organization_id AS organizationId, t.store_id AS storeId, t.kind AS kind, t.staff_id AS staffId
         FROM terminals t
         JOIN stores s ON s.id = t.store_id AND s.organization_id = t.organization_id
        WHERE s.slug = ? AND t.id = ? AND t.is_active = '1' AND s.is_active = '1'`,
    )
    .bind(slug, terminalId)
    .first()
}
```

`index.ts` にルートを足す:

```ts
  .post(
    '/api/public/sites/:storeSlug/terminals/:terminalId/sessions',
    zValidator('json', PublicTerminalSessionStart),
    async (c) => {
      const now = new Date(c.env.TEST_NOW ?? Date.now())
      const terminal = await resolveSiteTerminal(
        c.env.DB,
        c.req.param('storeSlug'),
        c.req.param('terminalId'),
      )
      // 存在しない slug・別テナントの端末・無効な端末を、同じ 404 に畳む。
      if (terminal === null) return c.json({ error: 'not_found' }, 404)
      if (terminal.kind === 'personal' && terminal.staffId === null) {
        return c.json({ error: 'not_found' }, 404)
      }

      const result = await startTerminalSession(
        c.env,
        {
          organizationId: terminal.organizationId,
          terminalId: c.req.param('terminalId'),
          pin: c.req.valid('json').pin,
          staffId: terminal.kind === 'personal' ? terminal.staffId : null,
          mode: terminal.kind,
        },
        now,
      )
      if (!result.ok) return c.json(result.body, result.status)

      const credential = await newDeviceCredential()
      await c.env.DB.prepare(
        'INSERT INTO terminal_devices (id, organization_id, terminal_id, credential_hash, expires_at, last_used_at, revoked_at, created_at) VALUES (?,?,?,?,?,NULL,NULL,?)',
      )
        .bind(
          crypto.randomUUID(),
          terminal.organizationId,
          c.req.param('terminalId'),
          credential.hash,
          deviceExpiresAt(now),
          now.toISOString(),
        )
        .run()

      setCookie(c, DEVICE_COOKIE, credential.token, {
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
        path: DEVICE_COOKIE_PATH,
        maxAge: DEVICE_TTL_SECONDS,
      })

      const token = await signAccessToken(
        {
          sub: result.session.staffId ?? `terminal:${c.req.param('terminalId')}`,
          org: terminal.organizationId,
          email: 'terminal@terminal.invalid',
          role: 'staff',
          kind: 'terminal',
        },
        c.env.JWT_SECRET,
        ACCESS_TTL_SECONDS,
        Math.floor(now.getTime() / 1000),
      )
      return c.json({ token, session: result.session })
    },
  )
```

- [ ] **Step 5: 通ることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run public-site`
Expected: PASS（前タスクの 4 件 + 今回の 5 件）

- [ ] **Step 6: 境界のテストを書く**

`services/glasses_management/test/public-site.time.test.ts`:

```ts
/**
 * 公開の入口の境界。時刻は TEST_NOW で注入する（実時刻に依存させない）。
 */
import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { BASE, JSON_HEADERS, resetDb, seedSite } from './helpers'

const START = Date.parse('2026-09-05T00:00:00.000Z')

describe('access トークンの 15 分', () => {
  it('14 分 59 秒では業務 API が通る', async () => { /* TEST_NOW を進めて 200 を確かめる */ })
  it('15 分ちょうどで 401 になる', async () => { /* 401 を確かめる */ })
})

describe('PIN のロックの階段', () => {
  it('3 回で 30 秒、10 回で 15 分、20 回で 1 時間', async () => {
    // 失敗を積み、429 の retryAfterSeconds が 30 → 900 → 3600 と上がることを確かめる
  })
  it('ロック中は正しい PIN でも通らない', async () => { /* 429 を確かめる */ })
})
```

**注意**: この 3 つの `it` は実際の body を書くこと。骨だけで残してはならない。`TEST_NOW` の進め方は既存の `terminal-session.time.test.ts` に倣う。

- [ ] **Step 7: 通ることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run public-site.time`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add services/glasses_management/src/worker packages/contracts/src/glasses_management.ts services/glasses_management/test
git commit -m "feat(glasses_management): PIN の成功でトークンと端末の資格情報を出す"
```

---

## Task 8: `POST /api/public/sites/:slug/terminals/:id/sessions/refresh`

**Files:**
- Modify: `services/glasses_management/src/worker/index.ts`
- Test: `services/glasses_management/test/public-site.time.test.ts`

**Interfaces:**
- Consumes: Task 4 の `isDeviceUsable`・`hashDeviceToken`・`newDeviceCredential`
- Produces: `POST …/sessions/refresh` → `{ token }` と、ローテーションされた Cookie

- [ ] **Step 1: 失敗テストを書く**

```ts
describe('端末の refresh', () => {
  it('Cookie があれば PIN 無しで新しい access トークンが出る', async () => {
    // sessions で得た Set-Cookie を送り返し、200 と新しい token を確かめる
  })

  it('使うたび Cookie がローテーションする（同じ値は 2 度使えない）', async () => {
    // 1 回目の Cookie で refresh → 2 回目に同じ Cookie を送ると 401
  })

  it('30 日ちょうどで切れる', async () => {
    // TEST_NOW を 30 日ちょうどへ進め、401 を確かめる
  })

  it('29 日 23 時間 59 分 59 秒なら通る', async () => { /* 200 */ })

  it('Cookie が無ければ 401（パスワードは求めない）', async () => {
    const res = await SELF.fetch(`${BASE}/api/public/sites/ginza/terminals/term-1/sessions/refresh`, { method: 'POST' })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run -t "端末の refresh"`
Expected: FAIL

- [ ] **Step 3: 実装する**

`index.ts`:

```ts
  .post('/api/public/sites/:storeSlug/terminals/:terminalId/sessions/refresh', async (c) => {
    const now = new Date(c.env.TEST_NOW ?? Date.now())
    const presented = getCookie(c, DEVICE_COOKIE)
    if (presented === undefined) return c.json({ error: 'unauthorized' }, 401)

    const terminal = await resolveSiteTerminal(c.env.DB, c.req.param('storeSlug'), c.req.param('terminalId'))
    if (terminal === null) return c.json({ error: 'not_found' }, 404)

    const hash = await hashDeviceToken(presented)
    const row = await c.env.DB.prepare(
      'SELECT id, organization_id AS organizationId, terminal_id AS terminalId, expires_at AS expiresAt, revoked_at AS revokedAt FROM terminal_devices WHERE credential_hash = ?',
    )
      .bind(hash)
      .first<{ id: string; organizationId: string; terminalId: string; expiresAt: string; revokedAt: string | null }>()
    // 期限切れ・失効・別端末の Cookie を、同じ 401 に畳む。
    if (
      row === null ||
      row.terminalId !== c.req.param('terminalId') ||
      row.organizationId !== terminal.organizationId ||
      !isDeviceUsable(row, now)
    ) {
      return c.json({ error: 'unauthorized' }, 401)
    }

    // ローテーション。古い行は消さず失効させ、盗まれた Cookie の再利用を検知できる形で残す。
    const next = await newDeviceCredential()
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE terminal_devices SET revoked_at = ?, last_used_at = ? WHERE id = ?').bind(
        now.toISOString(),
        now.toISOString(),
        row.id,
      ),
      c.env.DB.prepare(
        'INSERT INTO terminal_devices (id, organization_id, terminal_id, credential_hash, expires_at, last_used_at, revoked_at, created_at) VALUES (?,?,?,?,?,NULL,NULL,?)',
      ).bind(
        crypto.randomUUID(),
        row.organizationId,
        row.terminalId,
        next.hash,
        deviceExpiresAt(now),
        now.toISOString(),
      ),
    ])

    setCookie(c, DEVICE_COOKIE, next.token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: DEVICE_COOKIE_PATH,
      maxAge: DEVICE_TTL_SECONDS,
    })

    const token = await signAccessToken(
      {
        sub: `terminal:${row.terminalId}`,
        org: row.organizationId,
        email: 'terminal@terminal.invalid',
        role: 'staff',
        kind: 'terminal',
      },
      c.env.JWT_SECRET,
      ACCESS_TTL_SECONDS,
      Math.floor(now.getTime() / 1000),
    )
    return c.json({ token })
  })
```

- [ ] **Step 4: 通ることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run -t "端末の refresh"`
Expected: PASS（5 件）

- [ ] **Step 5: Commit**

```bash
git add services/glasses_management/src/worker/index.ts services/glasses_management/test/public-site.time.test.ts
git commit -m "feat(glasses_management): 端末の資格情報でトークンを更新する"
```

---

## Task 9: SPA の入口 `/s/:slug`

**Files:**
- Create: `services/glasses_management/src/web/site/siteRoute.ts`
- Create: `services/glasses_management/src/web/site/SiteEntry.tsx`
- Create: `services/glasses_management/src/web/site/SiteEntry.test.tsx`
- Modify: `services/glasses_management/src/web/main.tsx`

**Interfaces:**
- Consumes: Task 5・7 の公開ルート
- Produces: `isSitePath(path): boolean`、`siteSlugOf(path): string`、`<SiteEntry slug={…} onStarted={…} />`

- [ ] **Step 1: ルート判定の失敗テストを書く**

```ts
import { describe, expect, it } from 'vitest'
import { isSitePath, siteSlugOf } from './siteRoute'

describe('siteRoute', () => {
  it.each([
    ['/s/ginza', true],
    ['/s/ginza/', true],
    ['/w/ginza', false],
    ['/', false],
    ['/settings', false],
  ])('%s の判定は %s', (path, expected) => {
    expect(isSitePath(path)).toBe(expected)
  })

  it('slug を取り出す', () => {
    expect(siteSlugOf('/s/ginza')).toBe('ginza')
    expect(siteSlugOf('/s/ginza/')).toBe('ginza')
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run --config vitest.web.config.ts -t "siteRoute"`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
/** `/s/:slug` の判定と slug 取り出し。`public/PublicBookingApp` と同じ流儀で、
 *  react-router は入れない（要るのは前置きと slug の 2 つだけ）。 */
const PREFIX = '/s/'

export function isSitePath(path: string): boolean {
  return path.startsWith(PREFIX) && siteSlugOf(path).length > 0
}

export function siteSlugOf(path: string): string {
  return path.slice(PREFIX.length).replace(/\/+$/, '').split('/')[0] ?? ''
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `pnpm --filter @app/glasses_management exec vitest run --config vitest.web.config.ts -t "siteRoute"`
Expected: PASS

- [ ] **Step 5: 画面の失敗テストを書く**

`SiteEntry.test.tsx`。**`docs/frontend/DESIGN_RULE.md` に従うこと**（トークンのみ。任意値と Tailwind 既定パレットは禁止）。

```tsx
it('店名と置き場所を出し、スタッフの氏名はどこにも出さない', async () => { /* … */ })
it('置き場所を選ぶとテンキーが出て、4 桁で確定が押せる', async () => { /* … */ })
it('PIN が違うと残り回数を出し、入力を空にする', async () => { /* … */ })
it('ロック中は待ち時間を分で出し、確定を押しても始まらない', async () => { /* … */ })
```

既存の `login/PinEntry.tsx` と `login/PlacePick.tsx` を再利用する。**新しく作らない** —— AC-TERM-06/07/19 の文言と読み上げの担保がそちらに入っている。

- [ ] **Step 6〜8: 落ちる→実装→通る**

Run: `pnpm --filter @app/glasses_management exec vitest run --config vitest.web.config.ts SiteEntry`

- [ ] **Step 9: `main.tsx` に振り分けを足す**

```tsx
{isPublicPath(path) ? (
  <PublicBookingRoot slug={publicStoreSlug(path)} flow={publicFlowOf(path)} />
) : isSitePath(path) ? (
  <SiteEntry slug={siteSlugOf(path)} />
) : (
  <App />
)}
```

- [ ] **Step 10: Commit**

```bash
git add services/glasses_management/src/web/site services/glasses_management/src/web/main.tsx
git commit -m "feat(glasses_management): /s/:slug で置き場所と暗証番号だけの入口を出す"
```

---

## Task 10: トークンをメモリへ移し、黙って更新する

**Files:**
- Modify: `services/glasses_management/src/web/client.ts`
- Modify: `services/glasses_management/src/web/App.tsx`
- Test: `services/glasses_management/src/web/client.test.ts`

**Interfaces:**
- Consumes: Task 8 の refresh ルート
- Produces: `setAccessToken(token)`, `withFreshToken(fetch)`

- [ ] **Step 1: 失敗テストを書く**

```ts
it('401 を受けたら refresh を 1 回だけ試し、成功したら元の要求をやり直す', async () => { /* … */ })
it('refresh も 401 なら /s/:slug へ戻す（パスワードは求めない）', async () => { /* … */ })
it('同時に走った 2 本の 401 で refresh が 2 回走らない', async () => { /* … */ })
```

- [ ] **Step 2〜4: 落ちる→実装→通る**

access トークンはモジュールスコープの変数に持ち、`sessionStorage` へは書かない。`StartWork`（お店のコード）は削除する。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(glasses_management): access トークンをメモリに持ち、黙って更新する"
```

---

## Task 11: dev グラントを撤去する

**Files:**
- Modify: `services/glasses_management/src/worker/index.ts`
- Modify: `services/glasses_management/wrangler.jsonc`（コメントの `AUTH_DEV_GRANT` を消す）
- Modify: `.github/workflows/ci.yml`
- Modify: `services/glasses_management/.dev.vars.example`
- Test: `services/glasses_management/test/foundation.integration.test.ts`

- [ ] **Step 1: 失敗テストを書く**

```ts
it('dev グラントは AUTH_DEV_GRANT に関わらず 404（経路ごと無い）', async () => {
  const res = await SELF.fetch(`${BASE}/api/auth/token`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ organizationId: 'eye' }),
  })
  expect(res.status).toBe(404)
})
```

- [ ] **Step 2: 落ちることを確かめる**

Expected: FAIL（テスト環境では `AUTH_DEV_GRANT` が有効で 200 が返る）

- [ ] **Step 3: 消す**

`POST /api/auth/token` のルート、`Bindings.AUTH_DEV_GRANT`、CI の `if(process.env.DEPLOY_ENVIRONMENT==="staging")s.AUTH_DEV_GRANT="true";` を削除する。
**`Assert no dev grant on production` の検査は残す**（過去に入った残骸を拾うため）。

- [ ] **Step 4: 波及を直す**

`AUTH_DEV_GRANT` に依存していた既存テストの資格情報の取り方を、`signAccessToken` の直接発行へ置き換える。

- [ ] **Step 5: 通ることを確かめる**

Run: `pnpm --filter @app/glasses_management test:all`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(glasses_management)!: dev グラントを撤去する"
```

---

## Task 12: spec の改訂と traceability

**Files:**
- Modify: `specs/glasses_management/features/003-service-foundation/spec.md`
- Modify: `specs/glasses_management/features/013-terminals-and-audit/spec.md`
- Modify: `specs/glasses_management/features/014-store-provisioning/spec.md`
- Modify: `specs/glasses_management/design/05-screen-flow.md`（§3.1 に `/s/:slug` を足し、§5 の Q-07 を解決済みにする）
- Modify: `services/glasses_management/e2e/terminals.spec.ts` ほか

- [ ] **Step 1: 設計 §7 のとおりに AC を書き換える**

AC-FOUND-01 改訂 / AC-FOUND-03 を 014 へ移設 / AC-TERM-01・03・04・05・16 改訂 / AC-TERM-02 削除・UC-TERM-02 書き換え / AC-TERM-23・24・25 追加。

- [ ] **Step 2: E2E を付け替え、新規 3 本を書く**

- [ ] **Step 3: traceability を通す**

Run: `pnpm run test:traceability`
Expected: 「all approved UC/AC identifiers are mapped exactly once.」

- [ ] **Step 4: e2e をローカルで回す**

Run: `pnpm --filter @app/glasses_management e2e`
Expected: PASS（CI では手動トリガのみなので、ここで回す）

- [ ] **Step 5: Commit**

```bash
git commit -m "docs(spec): 業務端末の入口の AC を PIN だけの導線へ改訂する"
```

---

## Task 13: 仕上げ

- [ ] **Step 1: 全体を通す**

Run: `pnpm check`
Expected: すべて緑（lint / knip / typecheck / combined test）

- [ ] **Step 2: staging の後始末を記録する**

`docs/howto/deploy.md` の staging 節から `AUTH_DEV_GRANT` の記述を消し、「`/s/:slug` を開いて PIN」に書き換える。デプロイ後に手で `wrangler secret delete AUTH_DEV_GRANT --env staging` を実行することを、リリース手順として書く。

- [ ] **Step 3: PR を出す**

```bash
git push -u origin feat/terminal-pin-entry
gh pr create --base develop --title "feat(glasses_management)!: 業務端末の入口を PIN だけにし、dev グラントを撤去する"
```

---

## Self-Review

**Spec coverage:**

| 設計の節 | 担当タスク |
|---|---|
| §3 全体像・§4.1 `GET /sites/:slug` | Task 5 |
| §4.1.1 個人端末を 1 人に紐づける | Task 2・7 |
| §4.2 dev グラント撤去 | Task 11 |
| §5 資格情報（メモリ + Cookie） | Task 4・7・8・10 |
| §5.3 `kind` クレーム | Task 1 |
| §6 総当たり対策（階段） | Task 3・7 |
| §7 spec 改訂・traceability | Task 12 |
| §8 テスト | 各タスクに分散 + Task 13 |
| §10 移行 | Task 2（マイグレーション）・Task 13（staging の後始末） |

**未消化として自覚しているもの:**

- **§6-2 の IP 単位の絞りにタスクが無い。** Task 3 は端末単位の階段だけを実装する。IP 単位（`CF-Connecting-IP` で 1 分 10 回 / 1 時間 60 回）は KV の書き込み回数が読めず、無料枠（1 日 1,000 write）を圧迫しうる。**先に実測してから設計する**べきなので、このプランからは外し、別タスクとして残す。端末単位の階段だけでも 4 桁 10,000 通りに対しては実用上尽きない（3 回目以降ほぼ常時ロックになる）。
- **§6-3 の「新規作成の既定を 6 桁」にタスクが無い。** 端末の作成・PIN 再設定の UI は `013` の設定画面にあり、そこへ手を入れると本プランの範囲が二重になる。既定値の変更だけの小さな別 PR にする。
- **§6-4 の `GET /sites/:slug` への IP 絞り**も同じ理由で外す。

**Placeholder scan:** Task 7 Step 6 と Task 9 Step 5、Task 10 Step 1 の `it(…)` は本文が骨のままである。実行者はここを埋めること（プラン上は「注意」で明示済み）。それ以外に TBD は無い。

**Type consistency:** `startTerminalSession` の戻り（Task 6）を Task 7 が `result.ok` / `result.session` / `result.body` / `result.status` で読む形に揃えた。`newDeviceCredential` は `{token, hash}`、`hashDeviceToken` は `string` を返す形で Task 4・7・8 が一致している。`PublicSite` は Task 5 で定義し Task 9 が消費する。
