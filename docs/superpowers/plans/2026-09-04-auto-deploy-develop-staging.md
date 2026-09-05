# develop → staging / main → production 自動デプロイ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `develop` / `main` への merge で、GitHub Environment secrets を唯一の源泉として staging / production へ自動デプロイする。

**Architecture:** Wrangler の名前付き環境（上位＝production、`env.staging` を新設）で Worker を分け、Terraform は `modules/substrate` + `envs/{production,staging}` で基盤を両環境ぶん所有する。壊れると静かな 2 箇所 — D1 の宛先解決と staging の公開 — は、純関数に切り出して単体テストで固定する。

**Tech Stack:** GitHub Actions / Wrangler 4 / Terraform (cloudflare provider v5) / Hono ミドルウェア / Node.js `node:test` / vitest

**Spec:** `docs/superpowers/specs/2026-09-04-develop-staging-deploy-design.md`

## Global Constraints

- 応答・コメント・コミットメッセージは日本語。コミットは **Conventional Commits**。
- **TDD 必須**: 挙動を変える production code は、期待した理由で落ちるテストを先に書く。
- backend coverage は lines / statements / functions / branches **各 80% 以上**（`packages/shared` の閾値）。閾値の引き下げ・広範な除外は禁止。
- 新しい `scripts/*.mjs` は **root `package.json` の script から参照する**。参照が無いと Knip の dependency audit が落ちる。
- **秘密値をコミットしない**。`.dev.vars` は gitignore、本番値は GitHub Environment secrets のみ。
- Cron は UTC で書き、JST の意図をコメントに残す。
- `pnpm check` は lint(Biome) + Knip + typecheck + combined test。**各タスクの最後に関連テストを実行し、緑を確認してからコミット**する。
- D1 に FK を宣言しない。ID はアプリ生成。原子性は `db.batch()`。
- 既存の公開挙動を変えない: `STAGING_ACCESS_TOKEN` 未設定の環境（production・ローカル・テスト）は**完全に素通り**しなければならない。

---

### Task 1: 定数時間比較を共有部品に切り出す

`internal.ts` の中に閉じている `timingSafeEqualStr` を、staging ゲートからも使えるように独立させる。挙動は一切変えない。

**Files:**
- Create: `packages/shared/src/timing-safe.ts`
- Create: `packages/shared/test/timing-safe.test.ts`
- Modify: `packages/shared/src/internal.ts`（自前の実装を削除して import に置き換える）

**Interfaces:**
- Produces: `timingSafeEqualStr(a: string, b: string): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`packages/shared/test/timing-safe.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { timingSafeEqualStr } from '../src/timing-safe'

describe('timingSafeEqualStr', () => {
  it('同一の文字列を一致と判定する', () => {
    expect(timingSafeEqualStr('secret-value', 'secret-value')).toBe(true)
  })

  it('1 文字違えば不一致', () => {
    expect(timingSafeEqualStr('secret-value', 'secret-valuf')).toBe(false)
  })

  it('長さが違えば不一致', () => {
    expect(timingSafeEqualStr('short', 'short-and-longer')).toBe(false)
  })

  it('空文字同士は一致する（呼び出し側が未設定を弾く責務を持つ）', () => {
    expect(timingSafeEqualStr('', '')).toBe(true)
  })

  it('マルチバイト文字を byte 単位で比較する', () => {
    expect(timingSafeEqualStr('鍵', '鍵')).toBe(true)
    expect(timingSafeEqualStr('鍵', '錠')).toBe(false)
  })
})
```

- [ ] **Step 2: 落ちることを確認する**

Run: `pnpm --filter @app/shared exec vitest run test/timing-safe.test.ts`
Expected: FAIL — `Failed to resolve import "../src/timing-safe"`

- [ ] **Step 3: 実装する**

`packages/shared/src/timing-safe.ts`:

```ts
/**
 * 共有 secret の照合に使う定数時間比較。
 * `!==` の早期 return は先頭からの一致文字数を実行時間として漏らすため使わない。
 * 長さ不一致の早期 return は長さ以外を漏らさないので許容する。
 */
const enc = new TextEncoder()

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}
```

`packages/shared/src/internal.ts` を書き換える。ファイル冒頭の `const enc = new TextEncoder()` と `timingSafeEqualStr` 関数の定義を削除し、import を足す:

```ts
import type { MiddlewareHandler } from 'hono'
import { timingSafeEqualStr } from './timing-safe'
```

- [ ] **Step 4: 通ることを確認する**

Run: `pnpm --filter @app/shared exec vitest run test/timing-safe.test.ts test/internal.test.ts`
Expected: PASS（`internal.test.ts` が無傷であること＝挙動を変えていない証拠）

- [ ] **Step 5: コミット**

```bash
git add packages/shared/src/timing-safe.ts packages/shared/test/timing-safe.test.ts packages/shared/src/internal.ts
git commit -m "refactor(shared): 定数時間比較を共有部品として独立させる"
```

---

### Task 2: staging ゲートのミドルウェア

`STAGING_ACCESS_TOKEN` が設定されている環境でだけ、全リクエストにトークンを要求する。未設定なら完全に素通りする。

**Files:**
- Create: `packages/shared/src/staging-gate.ts`
- Create: `packages/shared/test/staging-gate.test.ts`
- Modify: `packages/shared/src/index.ts`（export を追加）

**Interfaces:**
- Consumes: `timingSafeEqualStr`（Task 1）
- Produces: `stagingGate(): MiddlewareHandler<{ Bindings: { STAGING_ACCESS_TOKEN?: string } }>` / `STAGING_GATE_COOKIE = 'staging_gate'`

- [ ] **Step 1: 失敗するテストを書く**

`packages/shared/test/staging-gate.test.ts`:

```ts
/**
 * staging ゲート。`*.workers.dev` は URL を知る誰でも叩けるため、staging だけ
 * トークンを要求する。production は `STAGING_ACCESS_TOKEN` を設定しないので
 * この分岐は死ぬ — その「素通り」こそ最も壊してはいけない性質なので先に固定する。
 */
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { STAGING_GATE_COOKIE, stagingGate } from '../src/staging-gate'

const TOKEN = 'staging-token-0123456789abcdef'

function app() {
  const a = new Hono<{ Bindings: { STAGING_ACCESS_TOKEN?: string } }>()
  a.use('*', stagingGate())
  a.get('/', (c) => c.text('home'))
  a.get('/api/internal/ping', (c) => c.text('internal'))
  a.get('/api/items', (c) => c.text('items'))
  return a
}

describe('stagingGate', () => {
  it('STAGING_ACCESS_TOKEN 未設定なら素通りする（production の挙動）', async () => {
    const res = await app().request('/', {}, {})
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('home')
  })

  it('設定済みで資格が無ければ 401', async () => {
    const res = await app().request('/', {}, { STAGING_ACCESS_TOKEN: TOKEN })
    expect(res.status).toBe(401)
  })

  it('未知のパスも 401（default-deny）', async () => {
    const res = await app().request('/no/such/path', {}, { STAGING_ACCESS_TOKEN: TOKEN })
    expect(res.status).toBe(401)
  })

  it('/api/internal/* はゲートの対象外（x-internal-key が守る）', async () => {
    const res = await app().request('/api/internal/ping', {}, { STAGING_ACCESS_TOKEN: TOKEN })
    expect(res.status).toBe(200)
  })

  it('?gate=<token> が一致したら Cookie を発行してクエリを落としたパスへ 302', async () => {
    const res = await app().request(`/api/items?gate=${TOKEN}`, {}, { STAGING_ACCESS_TOKEN: TOKEN })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/api/items')
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${STAGING_GATE_COOKIE}=${TOKEN}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('gate 以外のクエリは残す', async () => {
    const res = await app().request(`/api/items?a=1&gate=${TOKEN}&b=2`, {}, { STAGING_ACCESS_TOKEN: TOKEN })
    expect(res.headers.get('location')).toBe('/api/items?a=1&b=2')
  })

  it('誤った ?gate= は 401（リダイレクトしない）', async () => {
    const res = await app().request('/api/items?gate=wrong', {}, { STAGING_ACCESS_TOKEN: TOKEN })
    expect(res.status).toBe(401)
  })

  it('正しい Cookie があれば通す', async () => {
    const res = await app().request(
      '/api/items',
      { headers: { cookie: `${STAGING_GATE_COOKIE}=${TOKEN}` } },
      { STAGING_ACCESS_TOKEN: TOKEN },
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('items')
  })

  it('誤った Cookie は 401', async () => {
    const res = await app().request(
      '/api/items',
      { headers: { cookie: `${STAGING_GATE_COOKIE}=wrong-token` } },
      { STAGING_ACCESS_TOKEN: TOKEN },
    )
    expect(res.status).toBe(401)
  })

  it('401 の本文はトークンの手掛かりを含まない', async () => {
    const res = await app().request('/', {}, { STAGING_ACCESS_TOKEN: TOKEN })
    expect(await res.text()).not.toContain(TOKEN)
  })
})
```

- [ ] **Step 2: 落ちることを確認する**

Run: `pnpm --filter @app/shared exec vitest run test/staging-gate.test.ts`
Expected: FAIL — `Failed to resolve import "../src/staging-gate"`

- [ ] **Step 3: 実装する**

`packages/shared/src/staging-gate.ts`:

```ts
/**
 * staging 環境だけを守るゲート。
 *
 * `*.workers.dev` は URL を知っていれば誰でも叩ける。独自ドメインを持たないため
 * Cloudflare Access は適用できず（Access は自分の zone のホスト名にしか掛からない）、
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
      // 資格を Cookie に移し、URL からトークンを消す（履歴・Referer に残さない）。
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
```

`packages/shared/src/index.ts` に export を足す（`export { internalAuth, ... }` の並びに合わせてアルファベット順の位置へ）:

```ts
export { STAGING_GATE_COOKIE, stagingGate } from './staging-gate'
```

- [ ] **Step 4: 通ることを確認する**

Run: `pnpm --filter @app/shared test`
Expected: PASS（カバレッジ閾値 80% も維持されること）

- [ ] **Step 5: コミット**

```bash
git add packages/shared/src/staging-gate.ts packages/shared/test/staging-gate.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): staging だけを守るトークンゲートを置く"
```

---

### Task 3: ゲートを admin / glasses_management に配線する

**Files:**
- Modify: `services/admin/src/worker/index.ts`（`Bindings` に `STAGING_ACCESS_TOKEN?`、`const app = new Hono...` の直後に `app.use('*', stagingGate())`）
- Modify: `services/glasses_management/src/worker/index.ts`（同様）
- Test: 既存の `services/admin/test/permissions.test.ts` / `services/glasses_management/test/*` が**無傷で通る**ことが「未設定なら素通り」の証明になる

**Interfaces:**
- Consumes: `stagingGate`（Task 2）

- [ ] **Step 1: 失敗するテストを書く**

`services/admin/test/permissions.test.ts` の末尾に追加する:

```ts
describe('staging ゲート', () => {
  it('STAGING_ACCESS_TOKEN 未設定のこの環境では素通りする', async () => {
    // 未認証は 401 になるが、それは tenantAuth の 401 であってゲートのものではない。
    // ゲートが誤って有効化されていれば、認証済みの正規リクエストまで 401 になる。
    const token = await devToken('admin', 'operator-org')
    const res = await SELF.fetch(`${BASE}/api/organizations`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: 落ちないことを確認する（この 1 本は回帰の網であって Red にはならない）**

Run: `pnpm --filter @app/admin exec vitest run test/permissions.test.ts`
Expected: PASS。**配線前から通る**。このテストの役割は、次のステップで `app.use('*', ...)` を足したときに壊れないことを保証すること。

- [ ] **Step 3: 配線する**

`services/admin/src/worker/index.ts`:
- `@app/shared` の import に `stagingGate` を足す
- `export type Bindings = {` の中に足す:

```ts
  // staging だけに設定される。未設定なら stagingGate は何もしない（production）。
  STAGING_ACCESS_TOKEN?: string
```

- `const app = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>()` の直後に足す:

```ts
// staging（workers.dev 公開）を守る。production は secret 未設定なので素通りする。
// 他のどのミドルウェアより先に置く。
app.use('*', stagingGate())
```

`services/glasses_management/src/worker/index.ts` にも同じ 3 点を施す（`Env` の `Bindings` に `STAGING_ACCESS_TOKEN?: string`、`const app = new Hono<Env>()` の直後に `app.use('*', stagingGate())`）。

- [ ] **Step 4: 通ることを確認する**

Run: `pnpm --filter @app/admin test && pnpm --filter @app/glasses_management test`
Expected: PASS（全既存テストが無傷＝未設定時の素通りが証明される）

- [ ] **Step 5: コミット**

```bash
git add services/admin/src/worker/index.ts services/glasses_management/src/worker/index.ts services/admin/test/permissions.test.ts
git commit -m "feat(admin,glasses_management): staging ゲートを worker の先頭に配線する"
```

---

### Task 4: wrangler.jsonc を読む純関数

`wrangler.jsonc` はコメント付き JSON なので `JSON.parse` に直接は通らない。文字列リテラルの中の `//` を壊さずにコメントを落とす。ここが甘いと**間違った DB へマイグレーションを当てる**ので、境界値まで固定する。

**Files:**
- Create: `scripts/lib/wrangler-config.mjs`
- Create: `scripts/lib/wrangler-config.test.mjs`
- Modify: `package.json`（`test:scripts` を追加し、`test` の連鎖に入れる）

**Interfaces:**
- Produces:
  - `stripJsonc(source: string): string`
  - `readWranglerConfig(path: string): object`
  - `parseWranglerConfig(source: string): object`
  - `resolveEnv(config: object, envName: string | undefined): { workerName, d1, kv, r2, services, crons }`
    - `d1`: `{ binding, database_name, database_id }[]` / `kv`: `{ binding, id }[]` / `r2`: `{ binding, bucket_name }[]` / `services`: `{ binding, service }[]` / `crons`: `string[]`

- [ ] **Step 1: 失敗するテストを書く**

`scripts/lib/wrangler-config.test.mjs`:

```js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseWranglerConfig, resolveEnv, stripJsonc } from './wrangler-config.mjs'

test('行コメントを落とす', () => {
  assert.equal(stripJsonc('{\n // これは注釈\n "a": 1\n}'), '{\n \n "a": 1\n}')
})

test('ブロックコメントを落とす', () => {
  assert.equal(stripJsonc('{/* 注釈 */"a": 1}'), '{"a": 1}')
})

test('文字列リテラルの中の // は残す', () => {
  const src = '{"url": "https://example.test/x"}'
  assert.equal(stripJsonc(src), src)
})

test('文字列リテラルの中の /* は残す', () => {
  const src = '{"glob": "src/*/index.ts", "c": "/* not a comment */"}'
  assert.equal(stripJsonc(src), src)
})

test('エスケープされた引用符で文字列の終端を誤判定しない', () => {
  const src = '{"a": "quote\\" // still string", "b": 1}'
  assert.equal(stripJsonc(src), src)
})

test('末尾カンマを落とす', () => {
  assert.equal(JSON.parse(stripJsonc('{"a": [1, 2,], "b": 1,}')).a.length, 2)
})

test('コメントと末尾カンマを含む設定をパースできる', () => {
  const cfg = parseWranglerConfig('{\n // name\n "name": "admin",\n "vars": { "X": "" },\n}')
  assert.equal(cfg.name, 'admin')
})

const CONFIG = {
  name: 'admin',
  d1_databases: [{ binding: 'DB', database_name: 'admin', database_id: 'prod-d1' }],
  kv_namespaces: [{ binding: 'AUTH_RL', id: 'prod-kv' }],
  services: [{ binding: 'GLASSES_MANAGEMENT', service: 'glasses-management' }],
  triggers: { crons: ['0 15 * * *'] },
  env: {
    staging: {
      d1_databases: [
        { binding: 'DB', database_name: 'admin_staging', database_id: 'stg-d1' },
      ],
      kv_namespaces: [{ binding: 'AUTH_RL', id: 'stg-kv' }],
      services: [{ binding: 'GLASSES_MANAGEMENT', service: 'glasses-management-staging' }],
      triggers: { crons: [] },
    },
  },
}

test('環境未指定なら上位のバインディングを返す', () => {
  const r = resolveEnv(CONFIG, undefined)
  assert.equal(r.workerName, 'admin')
  assert.equal(r.d1[0].database_name, 'admin')
  assert.equal(r.d1[0].database_id, 'prod-d1')
  assert.equal(r.kv[0].id, 'prod-kv')
  assert.deepEqual(r.crons, ['0 15 * * *'])
})

test('staging は env.staging を返し、Worker 名にサフィックスが付く', () => {
  const r = resolveEnv(CONFIG, 'staging')
  assert.equal(r.workerName, 'admin-staging')
  assert.equal(r.d1[0].database_name, 'admin_staging')
  assert.equal(r.kv[0].id, 'stg-kv')
  assert.deepEqual(r.crons, [])
  assert.equal(r.services[0].service, 'glasses-management-staging')
})

test('空文字の環境名は「上位」と同じに扱う', () => {
  assert.equal(resolveEnv(CONFIG, '').workerName, 'admin')
})

test('存在しない環境は失敗させる', () => {
  assert.throws(() => resolveEnv(CONFIG, 'qa'), /env\.qa/)
})

test('非継承キーの書き落としを失敗させる', () => {
  const broken = { ...CONFIG, env: { staging: { kv_namespaces: [] } } }
  assert.throws(() => resolveEnv(broken, 'staging'), /d1_databases/)
})
```

- [ ] **Step 2: 落ちることを確認する**

Run: `node --test scripts/lib/wrangler-config.test.mjs`
Expected: FAIL — `Cannot find module .../wrangler-config.mjs`

- [ ] **Step 3: 実装する**

`scripts/lib/wrangler-config.mjs`:

```js
/**
 * `wrangler.jsonc` を読み、指定した環境の実効バインディングを返す。
 *
 * デプロイ先の D1 をここで解決する。文字列リテラルの中の `//` をコメントと
 * 誤認すると宛先が変わりうるので、パーサは素朴な走査で厳密に書く。
 */
import { readFileSync } from 'node:fs'

/** jsonc → json。文字列リテラルとエスケープを尊重してコメントと末尾カンマを落とす。 */
export function stripJsonc(source) {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]
    if (inLine) {
      if (ch === '\n') {
        inLine = false
        out += ch
      }
      continue
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false
        i++
      }
      continue
    }
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i++
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      inLine = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      inBlock = true
      i++
      continue
    }
    out += ch
  }
  // 末尾カンマ（`,` の後に空白を挟んで `}` か `]`）を落とす。
  return out.replace(/,(\s*[}\]])/g, '$1')
}

export function parseWranglerConfig(source) {
  return JSON.parse(stripJsonc(source))
}

export function readWranglerConfig(path) {
  return parseWranglerConfig(readFileSync(path, 'utf8'))
}

/**
 * 環境の実効バインディング。wrangler の非継承キーは環境ごとに全部書き下ろす
 * 決まりなので、上位にあって環境に無いキーは「書き落とし」として失敗させる。
 */
export function resolveEnv(config, envName) {
  const name = envName || ''
  const source = name ? config.env?.[name] : config
  if (name && !source) {
    throw new Error(`wrangler 設定に env.${name} がありません`)
  }
  if (name) {
    for (const key of ['d1_databases', 'kv_namespaces', 'r2_buckets']) {
      if (Array.isArray(config[key]) && config[key].length > 0 && !source[key]) {
        throw new Error(
          `env.${name} に ${key} がありません（wrangler の非継承キーは環境ごとに書き下ろす必要があります）`,
        )
      }
    }
  }
  return {
    workerName: name ? `${config.name}-${name}` : config.name,
    d1: source.d1_databases ?? [],
    kv: source.kv_namespaces ?? [],
    r2: source.r2_buckets ?? [],
    services: source.services ?? [],
    crons: source.triggers?.crons ?? [],
  }
}
```

`package.json` の scripts に足す（`test:traceability` の直前に置き、`test` の連鎖にも入れる）:

```json
"test:scripts": "node --test scripts/lib/",
```

`test` の値の末尾を `... && pnpm --filter @app/glasses_management test:all && pnpm run test:scripts && pnpm run test:traceability` に変える。

- [ ] **Step 4: 通ることを確認する**

Run: `node --test scripts/lib/` — Expected: PASS（12 tests）
Run: `pnpm run deps:check` — Expected: PASS（新スクリプトが package.json から参照されているので Knip が拾う）

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/wrangler-config.mjs scripts/lib/wrangler-config.test.mjs package.json
git commit -m "feat(scripts): wrangler.jsonc から環境ごとのバインディングを解決する"
```

---

### Task 5: Terraform 出力との突合

「これから触るリソースが、その環境の Terraform が作ったものか」を判定する純関数。**マイグレーションと CI の両方がこれを使う**。

**Files:**
- Create: `scripts/lib/binding-check.mjs`
- Create: `scripts/lib/binding-check.test.mjs`

**Interfaces:**
- Consumes: `resolveEnv`（Task 4）
- Produces:
  - `BINDING_MAP`: `{ [service]: { kind: 'd1'|'kv'|'r2', binding: string, output: string }[] }`
  - `checkBindings({ service, resolved, tfOutputs }): { ok: boolean, errors: string[] }`
  - `planD1Migration({ service, resolved, tfOutputs, envName }): { databaseName: string, args: string[] }`

- [ ] **Step 1: 失敗するテストを書く**

`scripts/lib/binding-check.test.mjs`:

```js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BINDING_MAP, checkBindings, planD1Migration } from './binding-check.mjs'

const RESOLVED = {
  workerName: 'admin',
  d1: [{ binding: 'DB', database_name: 'admin', database_id: 'd1-real' }],
  kv: [{ binding: 'AUTH_RL', id: 'kv-real' }],
  r2: [],
  services: [],
  crons: [],
}
const TF = {
  admin_d1_database_id: { value: 'd1-real' },
  auth_rl_kv_namespace_id: { value: 'kv-real' },
}

test('全バインディングが Terraform 出力と一致すれば ok', () => {
  const r = checkBindings({ service: 'admin', resolved: RESOLVED, tfOutputs: TF })
  assert.equal(r.ok, true)
  assert.deepEqual(r.errors, [])
})

test('D1 の ID がずれていたら両方の値を挙げて落とす', () => {
  const r = checkBindings({
    service: 'admin',
    resolved: { ...RESOLVED, d1: [{ binding: 'DB', database_name: 'admin', database_id: 'other' }] },
    tfOutputs: TF,
  })
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /DB/)
  assert.match(r.errors[0], /other/)
  assert.match(r.errors[0], /d1-real/)
})

test('placeholder はそれと分かる文言で落とす', () => {
  const r = checkBindings({
    service: 'admin',
    resolved: {
      ...RESOLVED,
      d1: [
        {
          binding: 'DB',
          database_name: 'admin',
          database_id: '00000000-0000-0000-0000-000000000000',
        },
      ],
    },
    tfOutputs: TF,
  })
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /placeholder/)
})

test('Terraform 出力にキーが無ければ落とす', () => {
  const r = checkBindings({ service: 'admin', resolved: RESOLVED, tfOutputs: {} })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /admin_d1_database_id/)
})

test('設定に無いバインディングは落とす（書き落とし検知）', () => {
  const r = checkBindings({ service: 'admin', resolved: { ...RESOLVED, kv: [] }, tfOutputs: TF })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /AUTH_RL/)
})

test('突合が通れば production のマイグレーション引数を組む', () => {
  const p = planD1Migration({ service: 'admin', resolved: RESOLVED, tfOutputs: TF, envName: '' })
  assert.equal(p.databaseName, 'admin')
  assert.deepEqual(p.args, ['d1', 'migrations', 'apply', 'admin', '--remote'])
})

test('staging は --env staging を付ける', () => {
  const resolved = {
    ...RESOLVED,
    workerName: 'admin-staging',
    d1: [{ binding: 'DB', database_name: 'admin_staging', database_id: 'd1-stg' }],
    kv: [{ binding: 'AUTH_RL', id: 'kv-stg' }],
  }
  const tf = {
    admin_d1_database_id: { value: 'd1-stg' },
    auth_rl_kv_namespace_id: { value: 'kv-stg' },
  }
  const p = planD1Migration({ service: 'admin', resolved, tfOutputs: tf, envName: 'staging' })
  assert.equal(p.databaseName, 'admin_staging')
  assert.deepEqual(p.args, [
    'd1',
    'migrations',
    'apply',
    'admin_staging',
    '--remote',
    '--env',
    'staging',
  ])
})

test('突合が落ちたらマイグレーションを組み立てない', () => {
  assert.throws(
    () => planD1Migration({ service: 'admin', resolved: RESOLVED, tfOutputs: {}, envName: '' }),
    /admin_d1_database_id/,
  )
})

test('BINDING_MAP は notifier と glasses_management も覆う', () => {
  assert.ok(BINDING_MAP.notifier.some((b) => b.binding === 'DEDUPE'))
  assert.ok(BINDING_MAP.glasses_management.some((b) => b.binding === 'RECORDINGS'))
})
```

- [ ] **Step 2: 落ちることを確認する**

Run: `node --test scripts/lib/binding-check.test.mjs`
Expected: FAIL — モジュールが無い

- [ ] **Step 3: 実装する**

`scripts/lib/binding-check.mjs`:

```js
/**
 * wrangler 設定のバインディングと Terraform 出力を突き合わせる。
 *
 * 環境を取り違えて別のリソースへ書きに行く事故は、成功してしまうので気づけない。
 * デプロイの前とマイグレーションの直前の 2 箇所でこの関数を通す。
 */

/** サービスごとの「バインディング ↔ Terraform 出力名」。新しい binding を足したらここに 1 行足す。 */
export const BINDING_MAP = {
  admin: [
    { kind: 'd1', binding: 'DB', output: 'admin_d1_database_id' },
    { kind: 'kv', binding: 'AUTH_RL', output: 'auth_rl_kv_namespace_id' },
  ],
  glasses_management: [
    { kind: 'd1', binding: 'DB', output: 'glasses_management_d1_database_id' },
    { kind: 'kv', binding: 'SHORT_LIVED', output: 'glasses_management_short_lived_kv_namespace_id' },
    { kind: 'r2', binding: 'RECORDINGS', output: 'glasses_management_recordings_bucket_name' },
  ],
  notifier: [{ kind: 'kv', binding: 'DEDUPE', output: 'notifier_dedupe_kv_namespace_id' }],
}

/** Terraform を通していない雛形値。`00000000-…` は wrangler.jsonc の placeholder。 */
function isPlaceholder(value) {
  return typeof value === 'string' && /^[0-]+$/.test(value) && value.length > 0
}

function actualValue(kind, entry) {
  if (kind === 'd1') return entry.database_id
  if (kind === 'kv') return entry.id
  return entry.bucket_name
}

function findEntry(kind, resolved, binding) {
  const list = kind === 'd1' ? resolved.d1 : kind === 'kv' ? resolved.kv : resolved.r2
  return list.find((e) => e.binding === binding)
}

export function checkBindings({ service, resolved, tfOutputs }) {
  const map = BINDING_MAP[service]
  if (!map) return { ok: false, errors: [`未知のサービス: ${service}`] }
  const errors = []
  for (const { kind, binding, output } of map) {
    const entry = findEntry(kind, resolved, binding)
    if (!entry) {
      errors.push(`${service}: バインディング ${binding} が wrangler 設定にありません`)
      continue
    }
    const actual = actualValue(kind, entry)
    if (isPlaceholder(actual)) {
      errors.push(
        `${service}: ${binding} が placeholder のままです (${actual})。Terraform 出力 ${output} の実値に差し替えてください`,
      )
      continue
    }
    const expected = tfOutputs[output]?.value
    if (expected === undefined) {
      errors.push(`${service}: Terraform 出力に ${output} がありません`)
      continue
    }
    if (actual !== expected) {
      errors.push(
        `${service}: ${binding} が Terraform 出力と一致しません (wrangler=${actual} / terraform=${expected} / output=${output})`,
      )
    }
  }
  return { ok: errors.length === 0, errors }
}

export function planD1Migration({ service, resolved, tfOutputs, envName }) {
  const { ok, errors } = checkBindings({ service, resolved, tfOutputs })
  if (!ok) throw new Error(errors.join('\n'))
  const db = resolved.d1.find((e) => e.binding === 'DB')
  if (!db) throw new Error(`${service}: DB バインディングがありません`)
  const args = ['d1', 'migrations', 'apply', db.database_name, '--remote']
  if (envName) args.push('--env', envName)
  return { databaseName: db.database_name, args }
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `node --test scripts/lib/`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/binding-check.mjs scripts/lib/binding-check.test.mjs
git commit -m "feat(scripts): wrangler の binding と Terraform 出力の突合を書く"
```

---

### Task 6: CLI 2 本（突合とマイグレーション）

純関数に薄い CLI を被せる。CI からはこの 2 本だけを呼ぶ。

**Files:**
- Create: `scripts/check-binding-ids.mjs`
- Create: `scripts/d1-migrate.mjs`
- Modify: `package.json`（`check:bindings` / `db:migrate:env` を追加）

**Interfaces:**
- Consumes: `readWranglerConfig` / `resolveEnv`（Task 4）、`checkBindings` / `planD1Migration`（Task 5）
- CLI: `node scripts/check-binding-ids.mjs <service...> --env <name> --tf-output <file>`
- CLI: `node scripts/d1-migrate.mjs <service> --env <name> --tf-output <file> [--dry-run]`

- [ ] **Step 1: 実装する（CLI は薄いので純関数のテストで担保する）**

`scripts/check-binding-ids.mjs`:

```js
#!/usr/bin/env node
/**
 * Terraform 出力と wrangler.jsonc のバインディングを突き合わせる。
 * 不一致があれば非ゼロで終了し、CI をそこで止める。
 */
import { readFileSync } from 'node:fs'
import { checkBindings } from './lib/binding-check.mjs'
import { readWranglerConfig, resolveEnv } from './lib/wrangler-config.mjs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const envName = arg('env', '')
const tfOutputPath = arg('tf-output')
if (!tfOutputPath) {
  console.error('使い方: node scripts/check-binding-ids.mjs <service...> --env <name> --tf-output <file>')
  process.exit(2)
}
const services = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.includes('/'))
  .filter((a) => a !== envName && a !== tfOutputPath)

const tfOutputs = JSON.parse(readFileSync(tfOutputPath, 'utf8'))
let failed = false
for (const service of services) {
  const config = readWranglerConfig(`services/${service}/wrangler.jsonc`)
  const resolved = resolveEnv(config, envName)
  const { ok, errors } = checkBindings({ service, resolved, tfOutputs })
  if (ok) {
    console.log(`✅ ${service} (${resolved.workerName}): バインディングは Terraform 出力と一致`)
  } else {
    failed = true
    for (const e of errors) console.error(`❌ ${e}`)
  }
}
process.exit(failed ? 1 : 0)
```

`scripts/d1-migrate.mjs`:

```js
#!/usr/bin/env node
/**
 * 環境ごとの D1 へマイグレーションを当てる。
 *
 * DB 名を人が二重管理しないため、宛先は wrangler.jsonc から解決する。適用の直前に
 * Terraform 出力と突き合わせる — マイグレーションだけが取り返しのつかない操作なので、
 * CI の突合ステップと二重にする。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { planD1Migration } from './lib/binding-check.mjs'
import { readWranglerConfig, resolveEnv } from './lib/wrangler-config.mjs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const service = process.argv[2]
if (!service || service.startsWith('--')) {
  console.error('使い方: node scripts/d1-migrate.mjs <service> --env <name> --tf-output <file> [--dry-run]')
  process.exit(2)
}
const envName = arg('env', '')
const tfOutputPath = arg('tf-output')
const dryRun = process.argv.includes('--dry-run')

const tfOutputs = JSON.parse(readFileSync(tfOutputPath, 'utf8'))
const config = readWranglerConfig(`services/${service}/wrangler.jsonc`)
const resolved = resolveEnv(config, envName)
const { databaseName, args } = planD1Migration({ service, resolved, tfOutputs, envName })

console.log(`▶ ${service}: ${databaseName} へマイグレーションを適用します (worker=${resolved.workerName})`)
if (dryRun) {
  console.log(`(dry-run) wrangler ${args.join(' ')}`)
  process.exit(0)
}
execFileSync('pnpm', ['exec', 'wrangler', ...args], {
  cwd: `services/${service}`,
  stdio: 'inherit',
})
```

`package.json` の scripts に足す:

```json
"check:bindings": "node scripts/check-binding-ids.mjs",
"db:migrate:env": "node scripts/d1-migrate.mjs",
```

- [ ] **Step 2: 手で動かして確認する**

```bash
cat > /tmp/tf-out.json <<'JSON'
{"admin_d1_database_id":{"value":"0388dd19-68f7-4d34-a5bb-818b84205548"},
 "auth_rl_kv_namespace_id":{"value":"ec31896881954c4aa932a4a72b1a08be"}}
JSON
node scripts/check-binding-ids.mjs admin --tf-output /tmp/tf-out.json
```

Expected: `✅ admin (admin): バインディングは Terraform 出力と一致`

```bash
node scripts/check-binding-ids.mjs notifier --tf-output /tmp/tf-out.json
```

Expected: `❌ notifier: DEDUPE が placeholder のままです (00000000000000000000000000000000)…` で exit 1

- [ ] **Step 3: 全体が緑であることを確認する**

Run: `pnpm run lint && pnpm run deps:check && node --test scripts/lib/`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add scripts/check-binding-ids.mjs scripts/d1-migrate.mjs package.json
git commit -m "feat(scripts): 環境ごとの D1 マイグレーションと binding 突合の CLI を置く"
```

---

### Task 7: seed を環境ごとの D1 に向ける

`seed.mjs` は `wrangler d1 execute admin` を直書きしている。staging から実行すると**本番の admin D1 に `INSERT OR IGNORE` が静かに通る**。

**Files:**
- Modify: `services/admin/seed.mjs`

**Interfaces:**
- Consumes: `readWranglerConfig` / `resolveEnv`（Task 4）

- [ ] **Step 1: 実装する**

`services/admin/seed.mjs` の import に足す:

```js
import { readWranglerConfig, resolveEnv } from '../../scripts/lib/wrangler-config.mjs'
```

`const REMOTE = process.argv.includes('--remote')` の直後に足す:

```js
// 宛先の D1 は wrangler.jsonc から解決する（DB 名を直書きすると staging の seed が
// 本番へ当たる。INSERT OR IGNORE は静かに成功するので気づけない）。
const ENV_NAME = process.env.CLOUDFLARE_ENV ?? ''
const RESOLVED = resolveEnv(
  readWranglerConfig(new URL('./wrangler.jsonc', import.meta.url).pathname),
  ENV_NAME,
)
const DB_NAME = RESOLVED.d1.find((d) => d.binding === 'DB')?.database_name
if (!DB_NAME) {
  console.error('❌ wrangler.jsonc から DB バインディングを解決できませんでした。')
  process.exit(1)
}
```

`execFileSync` の引数を書き換える:

```js
execFileSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'd1',
    'execute',
    DB_NAME,
    REMOTE ? '--remote' : '--local',
    ...(ENV_NAME ? ['--env', ENV_NAME] : []),
    '--file',
    sqlPath,
    '--yes',
  ],
  { cwd: import.meta.dirname, stdio: 'inherit' },
)
```

最後の出力も宛先が分かるようにする:

```js
const where = REMOTE ? `REMOTE(${DB_NAME})` : `local(${DB_NAME})`
```

- [ ] **Step 2: ローカル seed が壊れていないことを確認する**

Run: `pnpm --filter @app/admin db:migrate:local && pnpm --filter @app/admin db:seed:local`
Expected: `✅ seeded admin D1 [local(admin)]`

- [ ] **Step 3: コミット**

```bash
git add services/admin/seed.mjs
git commit -m "fix(admin): seed の宛先 D1 を wrangler 設定から解決する"
```

---

### Task 8: デプロイ前の preflight

ブランチ・`CLOUDFLARE_ENV`・GitHub Environment の 3 つが噛み合っているか、必要な secrets が揃っているかを、**何かを触る前に**確かめる。

**Files:**
- Create: `scripts/lib/preflight.mjs`
- Create: `scripts/lib/preflight.test.mjs`
- Create: `scripts/deploy-preflight.mjs`
- Modify: `package.json`（`deploy:preflight` を追加）

**Interfaces:**
- Produces: `checkPreflight({ ref, cloudflareEnv, environment, secrets }): { ok: boolean, errors: string[] }`
  - `secrets`: `Record<string, string | undefined>`

- [ ] **Step 1: 失敗するテストを書く**

`scripts/lib/preflight.test.mjs`:

```js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkPreflight } from './preflight.mjs'

const PROD_SECRETS = {
  CLOUDFLARE_API_TOKEN: 't',
  CLOUDFLARE_ACCOUNT_ID: 'a',
  R2_STATE_ACCESS_KEY_ID: 'k',
  R2_STATE_SECRET_ACCESS_KEY: 's',
  WORKER_INTERNAL_KEY: 'i',
  WORKER_JWT_SECRET: 'j',
  WORKER_AUTH_PEPPER: 'p',
  WORKER_DOMAIN_AUTH_KEY: 'd',
  WORKER_RESEND_API_KEY: 'r',
}
const STAGING_SECRETS = {
  CLOUDFLARE_API_TOKEN: 't',
  CLOUDFLARE_ACCOUNT_ID: 'a',
  R2_STATE_ACCESS_KEY_ID: 'k',
  R2_STATE_SECRET_ACCESS_KEY: 's',
  WORKER_INTERNAL_KEY: 'i',
  WORKER_JWT_SECRET: 'j',
  WORKER_AUTH_PEPPER: 'p',
  WORKER_DOMAIN_AUTH_KEY: 'd',
  WORKER_STAGING_ACCESS_TOKEN: 'g',
  WORKER_STAGING_ADMIN_PASSWORD: 'w',
}

test('main / 空 env / production は通る', () => {
  const r = checkPreflight({
    ref: 'main',
    cloudflareEnv: '',
    environment: 'production',
    secrets: PROD_SECRETS,
  })
  assert.deepEqual(r.errors, [])
  assert.equal(r.ok, true)
})

test('develop / staging / staging は通る', () => {
  const r = checkPreflight({
    ref: 'develop',
    cloudflareEnv: 'staging',
    environment: 'staging',
    secrets: STAGING_SECRETS,
  })
  assert.equal(r.ok, true)
})

test('develop なのに CLOUDFLARE_ENV が空なら落ちる（本番へ出る事故）', () => {
  const r = checkPreflight({
    ref: 'develop',
    cloudflareEnv: '',
    environment: 'staging',
    secrets: STAGING_SECRETS,
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /CLOUDFLARE_ENV/)
})

test('main なのに staging 環境なら落ちる', () => {
  const r = checkPreflight({
    ref: 'main',
    cloudflareEnv: 'staging',
    environment: 'production',
    secrets: PROD_SECRETS,
  })
  assert.equal(r.ok, false)
})

test('Environment 名がブランチと噛み合わなければ落ちる', () => {
  const r = checkPreflight({
    ref: 'main',
    cloudflareEnv: '',
    environment: 'staging',
    secrets: PROD_SECRETS,
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /environment/i)
})

test('デプロイ対象外のブランチは落ちる', () => {
  const r = checkPreflight({
    ref: 'feature/x',
    cloudflareEnv: '',
    environment: 'production',
    secrets: PROD_SECRETS,
  })
  assert.equal(r.ok, false)
})

test('欠けている secret を名指しで挙げる', () => {
  const { WORKER_JWT_SECRET, ...rest } = PROD_SECRETS
  const r = checkPreflight({ ref: 'main', cloudflareEnv: '', environment: 'production', secrets: rest })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /WORKER_JWT_SECRET/)
})

test('空文字の secret は未設定として扱う', () => {
  const r = checkPreflight({
    ref: 'main',
    cloudflareEnv: '',
    environment: 'production',
    secrets: { ...PROD_SECRETS, WORKER_INTERNAL_KEY: '' },
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /WORKER_INTERNAL_KEY/)
})

test('staging に RESEND キーは要らない', () => {
  const r = checkPreflight({
    ref: 'develop',
    cloudflareEnv: 'staging',
    environment: 'staging',
    secrets: STAGING_SECRETS,
  })
  assert.equal(r.ok, true)
})

test('production に staging 用 secret が混ざっていたら落ちる', () => {
  const r = checkPreflight({
    ref: 'main',
    cloudflareEnv: '',
    environment: 'production',
    secrets: { ...PROD_SECRETS, WORKER_STAGING_ACCESS_TOKEN: 'g' },
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /WORKER_STAGING_ACCESS_TOKEN/)
})

test('production に staging admin パスワードが混ざっていたら落ちる', () => {
  const r = checkPreflight({
    ref: 'main',
    cloudflareEnv: '',
    environment: 'production',
    secrets: { ...PROD_SECRETS, WORKER_STAGING_ADMIN_PASSWORD: 'w' },
  })
  assert.equal(r.ok, false)
})

test('staging に RESEND キーが混ざっていたら落ちる（実メール送信の事故）', () => {
  const r = checkPreflight({
    ref: 'develop',
    cloudflareEnv: 'staging',
    environment: 'staging',
    secrets: { ...STAGING_SECRETS, WORKER_RESEND_API_KEY: 'r' },
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /WORKER_RESEND_API_KEY/)
})
```

- [ ] **Step 2: 落ちることを確認する**

Run: `node --test scripts/lib/preflight.test.mjs`
Expected: FAIL — モジュールが無い

- [ ] **Step 3: 実装する**

`scripts/lib/preflight.mjs`:

```js
/**
 * デプロイの入口で、環境の取り違えと secrets の欠落を止める。
 *
 * ここを通らない限り terraform も wrangler も走らせない。secrets は GitHub
 * Environment が唯一の源泉なので、欠けているなら「設定し忘れ」であって
 * 「無くても動く」ではない。
 */

/** ブランチ → その環境の姿。ここに無いブランチはデプロイしない。 */
const ENVIRONMENTS = {
  main: { cloudflareEnv: '', environment: 'production' },
  develop: { cloudflareEnv: 'staging', environment: 'staging' },
}

const COMMON_REQUIRED = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'R2_STATE_ACCESS_KEY_ID',
  'R2_STATE_SECRET_ACCESS_KEY',
  'WORKER_INTERNAL_KEY',
  'WORKER_JWT_SECRET',
  'WORKER_AUTH_PEPPER',
  'WORKER_DOMAIN_AUTH_KEY',
]

const REQUIRED = {
  production: [...COMMON_REQUIRED, 'WORKER_RESEND_API_KEY'],
  staging: [...COMMON_REQUIRED, 'WORKER_STAGING_ACCESS_TOKEN', 'WORKER_STAGING_ADMIN_PASSWORD'],
}

/** その環境に**あってはいけない**もの。混ざると事故になる secret を名指しで拒む。 */
const FORBIDDEN = {
  // 本番に staging の抜け道を持ち込ませない。
  production: ['WORKER_STAGING_ACCESS_TOKEN', 'WORKER_STAGING_ADMIN_PASSWORD'],
  // staging から実メールを飛ばさない（notifier は未設定なら fail close する）。
  staging: ['WORKER_RESEND_API_KEY'],
}

export function checkPreflight({ ref, cloudflareEnv, environment, secrets }) {
  const errors = []
  const expected = ENVIRONMENTS[ref]
  if (!expected) {
    return {
      ok: false,
      errors: [`ブランチ ${ref} はデプロイ対象ではありません（main / develop のみ）`],
    }
  }
  if ((cloudflareEnv ?? '') !== expected.cloudflareEnv) {
    errors.push(
      `CLOUDFLARE_ENV がブランチと噛み合いません (ref=${ref} なら "${expected.cloudflareEnv}" のはずが "${cloudflareEnv ?? ''}")`,
    )
  }
  if (environment !== expected.environment) {
    errors.push(
      `GitHub environment がブランチと噛み合いません (ref=${ref} なら ${expected.environment} のはずが ${environment})`,
    )
  }
  for (const name of REQUIRED[expected.environment]) {
    if (!secrets[name]) errors.push(`secret ${name} が ${expected.environment} に設定されていません`)
  }
  for (const name of FORBIDDEN[expected.environment]) {
    if (secrets[name]) {
      errors.push(`secret ${name} は ${expected.environment} に設定してはいけません`)
    }
  }
  return { ok: errors.length === 0, errors }
}

export const PREFLIGHT_ENVIRONMENTS = ENVIRONMENTS
export const PREFLIGHT_REQUIRED = REQUIRED
```

`scripts/deploy-preflight.mjs`:

```js
#!/usr/bin/env node
/** CI の入口。環境変数から preflight を回し、1 つでも問題があれば非ゼロで止める。 */
import { checkPreflight } from './lib/preflight.mjs'

const { ok, errors } = checkPreflight({
  ref: process.env.GITHUB_REF_NAME ?? '',
  cloudflareEnv: process.env.CLOUDFLARE_ENV ?? '',
  environment: process.env.DEPLOY_ENVIRONMENT ?? '',
  secrets: process.env,
})

if (!ok) {
  console.error('❌ preflight に失敗しました。デプロイを中止します。')
  for (const e of errors) console.error(`   - ${e}`)
  process.exit(1)
}
console.log(`✅ preflight OK (ref=${process.env.GITHUB_REF_NAME} env=${process.env.DEPLOY_ENVIRONMENT})`)
```

`package.json` の scripts に足す:

```json
"deploy:preflight": "node scripts/deploy-preflight.mjs",
```

- [ ] **Step 4: 通ることを確認する**

Run: `node --test scripts/lib/`
Expected: PASS（全 33 テスト）

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/preflight.mjs scripts/lib/preflight.test.mjs scripts/deploy-preflight.mjs package.json
git commit -m "feat(scripts): デプロイ前に環境の取り違えと secrets 欠落を止める"
```

---

### Task 9: Terraform を module + envs に分ける

**Files:**
- Create: `infra/terraform/cloudflare/modules/substrate/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/terraform/cloudflare/envs/production/{main.tf,backend.tf,variables.tf,outputs.tf}`
- Create: `infra/terraform/cloudflare/envs/staging/{main.tf,backend.tf,variables.tf,outputs.tf}`
- Delete: `infra/terraform/cloudflare/{main.tf,outputs.tf,variables.tf,versions.tf}`（module と envs へ移す）
- Modify: `infra/terraform/cloudflare/terraform.tfvars.example`

- [ ] **Step 1: module を書く**

`modules/substrate/variables.tf`:

```hcl
variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID that owns these resources."
}

variable "d1_suffix" {
  type        = string
  description = "D1 名に付ける接尾辞。production は空、staging は \"_staging\"（D1 はアンダースコア命名）。"
  default     = ""
}

variable "kv_r2_suffix" {
  type        = string
  description = "KV / R2 名に付ける接尾辞。production は空、staging は \"-staging\"（KV/R2 はハイフン命名）。"
  default     = ""
}
```

`modules/substrate/main.tf` — 現行 `infra/terraform/cloudflare/main.tf` の内容をそのまま持ち込み、名前だけ接尾辞付きにする。コメントは残す。

```hcl
# Stateful Cloudflare substrate. Worker CODE and per-Worker bindings are owned
# by Wrangler (each wrangler.jsonc) — Terraform only provisions the resources
# below and exports their IDs (see outputs.tf) to wire into wrangler.jsonc.
# One owner per resource avoids drift.

# --- D1: admin owns its own database. ---
resource "cloudflare_d1_database" "admin" {
  account_id = var.cloudflare_account_id
  name       = "admin${var.d1_suffix}"
}

# glasses_management owns the EYE reservation domain data. It is deliberately
# separate from admin's organization/authentication source of truth.
resource "cloudflare_d1_database" "glasses_management" {
  account_id = var.cloudflare_account_id
  name       = "glasses_management${var.d1_suffix}"
}

# --- KV ---
# admin: login rate-limit / lockout counters (email+IP window).
resource "cloudflare_workers_kv_namespace" "auth_rl" {
  account_id = var.cloudflare_account_id
  title      = "admin-auth-rl${var.kv_r2_suffix}"
}

# notifier: 24-hour idempotency records for outbound email jobs.
resource "cloudflare_workers_kv_namespace" "notifier_dedupe" {
  account_id = var.cloudflare_account_id
  title      = "notifier-dedupe${var.kv_r2_suffix}"
}

# glasses_management: short-lived reservation/session state. Long-lived domain
# data belongs in its D1; this KV is not used as a source of truth.
resource "cloudflare_workers_kv_namespace" "glasses_management_short_lived" {
  account_id = var.cloudflare_account_id
  title      = "glasses-management-short-lived${var.kv_r2_suffix}"
}

# R2 objects are private by default. The Worker mediates recording metadata and
# retention; no public bucket or direct customer download URL is provisioned.
resource "cloudflare_r2_bucket" "glasses_management_recordings" {
  account_id = var.cloudflare_account_id
  name       = "glasses-management-recordings${var.kv_r2_suffix}"
  location   = "apac"
}
```

`modules/substrate/outputs.tf` — 現行 `outputs.tf` をそのまま（値の参照先だけ module 内リソースになる）。

- [ ] **Step 2: envs を書く**

`envs/production/main.tf`:

```hcl
terraform {
  required_version = ">= 1.9, < 2.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment. Scope the token minimally:
# Account: Workers Scripts Edit, D1 Edit, Workers KV Storage Edit, Workers R2
# Storage Edit, Account Settings Read. (No Queues — free-tier policy.)
provider "cloudflare" {}

module "substrate" {
  source                = "../../modules/substrate"
  cloudflare_account_id = var.cloudflare_account_id
  # production は接尾辞なし。既存リソースの名前を動かさない。
  d1_suffix    = ""
  kv_r2_suffix = ""
}
```

`envs/production/backend.tf`:

```hcl
# state は R2（S3 互換）。endpoints にアカウント ID が入るので、値は CI から
# -backend-config で注入する（ファイルにアカウント ID を書かない）。
# R2 にはネイティブなロックが無いため、CI の concurrency で apply を直列化する。
terraform {
  backend "s3" {
    key    = "cloudflare/production.tfstate"
    region = "auto"

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true
  }
}
```

`envs/production/variables.tf` は現行 `variables.tf` と同じ内容。`envs/production/outputs.tf`:

```hcl
output "admin_d1_database_id" {
  value       = module.substrate.admin_d1_database_id
  description = "services/admin/wrangler.jsonc → d1_databases[0].database_id"
}

output "glasses_management_d1_database_id" {
  value       = module.substrate.glasses_management_d1_database_id
  description = "services/glasses_management/wrangler.jsonc → d1_databases[0].database_id"
}

output "auth_rl_kv_namespace_id" {
  value       = module.substrate.auth_rl_kv_namespace_id
  description = "services/admin/wrangler.jsonc → kv_namespaces[0].id (AUTH_RL)"
}

output "notifier_dedupe_kv_namespace_id" {
  value       = module.substrate.notifier_dedupe_kv_namespace_id
  description = "services/notifier/wrangler.jsonc → kv_namespaces[0].id (DEDUPE)"
}

output "glasses_management_short_lived_kv_namespace_id" {
  value       = module.substrate.glasses_management_short_lived_kv_namespace_id
  description = "services/glasses_management/wrangler.jsonc → kv_namespaces[0].id (SHORT_LIVED)"
}

output "glasses_management_recordings_bucket_name" {
  value       = module.substrate.glasses_management_recordings_bucket_name
  description = "services/glasses_management/wrangler.jsonc → r2_buckets[0].bucket_name (RECORDINGS)"
}
```

`envs/staging/` は同じ 4 ファイルを置き、`main.tf` の module 引数だけ変える:

```hcl
module "substrate" {
  source                = "../../modules/substrate"
  cloudflare_account_id = var.cloudflare_account_id
  # D1 はアンダースコア、KV / R2 はハイフンで命名の慣習が違う。
  d1_suffix    = "_staging"
  kv_r2_suffix = "-staging"
}
```

`backend.tf` の `key` は `cloudflare/staging.tfstate`。`outputs.tf` / `variables.tf` は production と同一。

- [ ] **Step 3: 旧ファイルを消して検証する**

```bash
rm infra/terraform/cloudflare/main.tf infra/terraform/cloudflare/outputs.tf \
   infra/terraform/cloudflare/variables.tf infra/terraform/cloudflare/versions.tf
terraform fmt -check -recursive infra/terraform
```

Expected: 差分なし（落ちたら `terraform fmt -recursive infra/terraform` で直す）

`terraform validate` は backend の初期化が要るため CI では `-backend=false` で回す:

```bash
terraform -chdir=infra/terraform/cloudflare/envs/production init -backend=false && \
terraform -chdir=infra/terraform/cloudflare/envs/production validate
terraform -chdir=infra/terraform/cloudflare/envs/staging init -backend=false && \
terraform -chdir=infra/terraform/cloudflare/envs/staging validate
```

Expected: `Success! The configuration is valid.`（terraform 未インストールならこの検証は CI に委ね、その旨をコミットメッセージに書く）

- [ ] **Step 4: コミット**

```bash
git add infra/terraform
git commit -m "refactor(infra): Terraform を module と環境ごとの root に分ける"
```

---

### Task 10: 既存リソースの取り込みスクリプト

**Files:**
- Create: `infra/terraform/cloudflare/import-existing.sh`

- [ ] **Step 1: 実装する**

```bash
#!/usr/bin/env bash
# Terraform state に無い「既に実在するリソース」を取り込む。
#
# admin の D1 / KV は wrangler.jsonc に実 ID があるのに state に無い。そのまま
# apply すると同名リソースを作りに行って壊れるため、apply の前に必ず通す。
# 冪等: 既に state にあるものは触らない。見つからないものは何もしない（apply が作る）。
set -euo pipefail

ENV_NAME="${1:?usage: import-existing.sh <production|staging>}"
DIR="$(cd "$(dirname "$0")" && pwd)/envs/${ENV_NAME}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN が要ります}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID が要ります}"

if [ "$ENV_NAME" = "staging" ]; then
  D1_SUFFIX="_staging"; NAME_SUFFIX="-staging"
else
  D1_SUFFIX=""; NAME_SUFFIX=""
fi

API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
auth=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")

in_state() { terraform -chdir="$DIR" state show "$1" >/dev/null 2>&1; }

import() { # <address> <id>
  echo "→ import $1 ($2)"
  terraform -chdir="$DIR" import "$1" "$2"
}

# --- D1 ---
for pair in "admin:admin${D1_SUFFIX}" "glasses_management:glasses_management${D1_SUFFIX}"; do
  res="module.substrate.cloudflare_d1_database.${pair%%:*}"
  name="${pair##*:}"
  in_state "$res" && { echo "= $res は state 済み"; continue; }
  id=$(curl -sf "${auth[@]}" "${API}/d1/database?name=${name}" | jq -r ".result[]? | select(.name==\"${name}\") | .uuid" | head -1)
  [ -n "${id:-}" ] && import "$res" "${CLOUDFLARE_ACCOUNT_ID}/${id}" || echo "· D1 ${name} は未作成（apply が作る）"
done

# --- KV ---
kv_json=$(curl -sf "${auth[@]}" "${API}/storage/kv/namespaces?per_page=100" || echo '{"result":[]}')
for pair in "auth_rl:admin-auth-rl${NAME_SUFFIX}" \
            "notifier_dedupe:notifier-dedupe${NAME_SUFFIX}" \
            "glasses_management_short_lived:glasses-management-short-lived${NAME_SUFFIX}"; do
  res="module.substrate.cloudflare_workers_kv_namespace.${pair%%:*}"
  title="${pair##*:}"
  in_state "$res" && { echo "= $res は state 済み"; continue; }
  id=$(echo "$kv_json" | jq -r ".result[]? | select(.title==\"${title}\") | .id" | head -1)
  [ -n "${id:-}" ] && import "$res" "${CLOUDFLARE_ACCOUNT_ID}/${id}" || echo "· KV ${title} は未作成（apply が作る）"
done

# --- R2 ---
res="module.substrate.cloudflare_r2_bucket.glasses_management_recordings"
bucket="glasses-management-recordings${NAME_SUFFIX}"
if in_state "$res"; then
  echo "= $res は state 済み"
elif curl -sf "${auth[@]}" "${API}/r2/buckets/${bucket}" >/dev/null 2>&1; then
  import "$res" "${CLOUDFLARE_ACCOUNT_ID}/${bucket}"
else
  echo "· R2 ${bucket} は未作成（apply が作る）"
fi

echo "✅ import 済み（${ENV_NAME}）"
```

`chmod +x infra/terraform/cloudflare/import-existing.sh`

> **実装時の確認事項（spec §15-1）**: `terraform import` の ID 形式は provider v5 の各リソースの
> `import` セクションで確認する。上の `<account_id>/<resource_id>` は前提であり、
> 違っていればこのスクリプトだけを直す。

- [ ] **Step 2: 構文を検証する**

Run: `bash -n infra/terraform/cloudflare/import-existing.sh`
Expected: 出力なし（構文 OK）

- [ ] **Step 3: コミット**

```bash
git add infra/terraform/cloudflare/import-existing.sh
git commit -m "feat(infra): state に無い既存リソースを冪等に取り込む"
```

---

### Task 11: wrangler.jsonc に env.staging を足す

**Files:**
- Modify: `services/notifier/wrangler.jsonc`
- Modify: `services/glasses_management/wrangler.jsonc`
- Modify: `services/admin/wrangler.jsonc`

ID は Terraform を回すまで確定しないので、**staging 側は placeholder を置く**。Task 5 の突合が「placeholder のままです」と名指しで落とすので、初回 apply 後に実値を入れる運用になる。

- [ ] **Step 1: notifier**

`services/notifier/wrangler.jsonc` の末尾（`vars` の後）に足す:

```jsonc
  ,
  // staging（develop からの自動デプロイ先）。Worker 名は notifier-staging になる。
  // kv_namespaces は wrangler の非継承キーなので環境ごとに書き下ろす。
  // id は Terraform(envs/staging) の notifier_dedupe_kv_namespace_id の実値に差し替える。
  "env": {
    "staging": {
      "kv_namespaces": [{ "binding": "DEDUPE", "id": "00000000000000000000000000000000" }],
      // staging では RESEND_API_KEY を設定しないので、この空値のまま fail close する。
      "vars": { "MAIL_FROM": "" }
    }
  }
```

- [ ] **Step 2: glasses_management**

`services/glasses_management/wrangler.jsonc` の `triggers` の後に足す:

```jsonc
  ,
  // staging。service binding は自動でサフィックスが付かないので明示的に -staging を指す。
  // Cron はアカウント全体で 5 本しか無い共有枠なので staging では 0 本にする。
  "env": {
    "staging": {
      "assets": {
        "not_found_handling": "single-page-application",
        "run_worker_first": ["/api/*"]
      },
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "glasses_management_staging",
          "database_id": "00000000-0000-0000-0000-000000000000",
          "migrations_dir": "migrations"
        }
      ],
      "kv_namespaces": [{ "binding": "SHORT_LIVED", "id": "00000000000000000000000000000000" }],
      "r2_buckets": [
        { "binding": "RECORDINGS", "bucket_name": "glasses-management-recordings-staging" }
      ],
      "services": [
        { "binding": "NOTIFIER", "service": "notifier-staging" },
        { "binding": "ADMIN", "service": "admin-staging" }
      ],
      "triggers": { "crons": [] }
    }
  }
```

- [ ] **Step 3: admin**

`services/admin/wrangler.jsonc` の `vars` の後に足す:

```jsonc
  ,
  // staging。GLASSES_MANAGEMENT は staging の Worker を指す（binding にサフィックスは付かない）。
  "env": {
    "staging": {
      "assets": {
        "not_found_handling": "single-page-application",
        "run_worker_first": ["/api/*"]
      },
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "admin_staging",
          "database_id": "00000000-0000-0000-0000-000000000000",
          "migrations_dir": "migrations"
        }
      ],
      "kv_namespaces": [{ "binding": "AUTH_RL", "id": "00000000000000000000000000000000" }],
      "services": [{ "binding": "GLASSES_MANAGEMENT", "service": "glasses-management-staging" }],
      "vars": { "INVITE_BASE_URL": "" }
    }
  }
```

- [ ] **Step 4: パーサが読めることを確認する**

```bash
node -e "
import('./scripts/lib/wrangler-config.mjs').then((m) => {
  for (const s of ['admin', 'glasses_management', 'notifier']) {
    const c = m.readWranglerConfig(\`services/\${s}/wrangler.jsonc\`)
    const r = m.resolveEnv(c, 'staging')
    console.log(s, '→', r.workerName, r.d1.map((d) => d.database_name).join(','), 'crons=', JSON.stringify(r.crons))
  }
})
"
```

Expected:
```
admin → admin-staging admin_staging crons= []
glasses_management → glasses-management-staging glasses_management_staging crons= []
notifier → notifier-staging  crons= []
```

- [ ] **Step 5: typecheck と dry-run が壊れていないことを確認する**

Run: `pnpm -r --if-present cf-typegen && pnpm -r --if-present typecheck`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add services/admin/wrangler.jsonc services/glasses_management/wrangler.jsonc services/notifier/wrangler.jsonc
git commit -m "feat(infra): 各サービスに staging 環境の設定を足す"
```

---

### Task 12: CI ワークフロー

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: verify にゲートを足す**

`verify` job の `Typecheck` の後に足す:

```yaml
      - name: Terraform fmt
        uses: hashicorp/setup-terraform@b9cd54a3c349d3f38e8881555d616ced269862dd # v3.1.2
        with:
          terraform_version: 1.9.8
          terraform_wrapper: false
      - name: Terraform fmt / validate
        run: |
          terraform fmt -check -recursive infra/terraform
          for env in production staging; do
            terraform -chdir="infra/terraform/cloudflare/envs/$env" init -backend=false
            terraform -chdir="infra/terraform/cloudflare/envs/$env" validate
          done
```

続けて、staging 構成が wrangler にとって妥当かを dry-run で確かめる（spec §11）:

```yaml
      - name: Validate staging wrangler config
        env:
          CLOUDFLARE_ENV: staging
        run: |
          pnpm --filter @app/notifier exec wrangler deploy --dry-run --env staging
          pnpm --filter @app/admin run build
          pnpm --filter @app/glasses_management run build
```

> SPA サービスは `@cloudflare/vite-plugin` がビルド時に flattened deploy config を作るため、
> `CLOUDFLARE_ENV=staging` での `build` が通ることが staging 構成の妥当性の証明になる。

- [ ] **Step 2: push トリガに develop を足す**

```yaml
on:
  pull_request: {}
  push:
    branches: [main, develop]
```

- [ ] **Step 3: deploy job を足す**

`deploy-eye-stack` job の**前**に置く（`deploy-eye-stack` はそのまま残す）:

```yaml
  # merge で発火する自動デプロイ。develop → staging、main → production。
  # 環境の取り違えは preflight が止める。service binding の依存順があるので直列。
  deploy:
    if: github.event_name == 'push'
    needs: [verify]
    runs-on: ubuntu-latest
    environment: ${{ github.ref_name == 'main' && 'production' || 'staging' }}
    concurrency:
      group: deploy-${{ github.ref_name }}
      cancel-in-progress: false
    env:
      CLOUDFLARE_ENV: ${{ github.ref_name == 'main' && '' || 'staging' }}
      DEPLOY_ENVIRONMENT: ${{ github.ref_name == 'main' && 'production' || 'staging' }}
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      R2_STATE_ACCESS_KEY_ID: ${{ secrets.R2_STATE_ACCESS_KEY_ID }}
      R2_STATE_SECRET_ACCESS_KEY: ${{ secrets.R2_STATE_SECRET_ACCESS_KEY }}
      WORKER_INTERNAL_KEY: ${{ secrets.WORKER_INTERNAL_KEY }}
      WORKER_JWT_SECRET: ${{ secrets.WORKER_JWT_SECRET }}
      WORKER_AUTH_PEPPER: ${{ secrets.WORKER_AUTH_PEPPER }}
      WORKER_DOMAIN_AUTH_KEY: ${{ secrets.WORKER_DOMAIN_AUTH_KEY }}
      WORKER_RESEND_API_KEY: ${{ secrets.WORKER_RESEND_API_KEY }}
      WORKER_STAGING_ACCESS_TOKEN: ${{ secrets.WORKER_STAGING_ACCESS_TOKEN }}
      WORKER_STAGING_ADMIN_PASSWORD: ${{ secrets.WORKER_STAGING_ADMIN_PASSWORD }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6.0.10
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      # 何かを触る前に、ブランチ / CLOUDFLARE_ENV / environment / secrets を確かめる。
      - name: Preflight
        run: pnpm run deploy:preflight

      - run: pnpm -r --if-present cf-typegen

      - uses: hashicorp/setup-terraform@b9cd54a3c349d3f38e8881555d616ced269862dd # v3.1.2
        with:
          terraform_version: 1.9.8
          terraform_wrapper: false

      # state バケット。既にあれば失敗を無視する（冪等化）。
      - name: Ensure state bucket
        run: pnpm --filter @app/notifier exec wrangler r2 bucket create tfstate || true

      - name: Terraform init
        working-directory: infra/terraform/cloudflare/envs/${{ env.DEPLOY_ENVIRONMENT }}
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_STATE_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_STATE_SECRET_ACCESS_KEY }}
        run: |
          terraform init \
            -backend-config="bucket=tfstate" \
            -backend-config="endpoints={\"s3\":\"https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com\"}"

      - name: Import pre-existing resources
        run: bash infra/terraform/cloudflare/import-existing.sh "${DEPLOY_ENVIRONMENT}"
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_STATE_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_STATE_SECRET_ACCESS_KEY }}

      - name: Terraform apply
        working-directory: infra/terraform/cloudflare/envs/${{ env.DEPLOY_ENVIRONMENT }}
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_STATE_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_STATE_SECRET_ACCESS_KEY }}
          TF_VAR_cloudflare_account_id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          terraform apply -auto-approve
          terraform output -json > "${GITHUB_WORKSPACE}/tf-output.json"

      # 黙って別リソースへデプロイする事故を止める唯一の関所。
      - name: Check binding IDs
        run: pnpm run check:bindings admin glasses_management notifier --env "${CLOUDFLARE_ENV}" --tf-output tf-output.json

      - name: Deploy notifier
        run: pnpm --filter @app/notifier run deploy
      - name: Sync notifier secrets
        run: |
          node -e 'const s={INTERNAL_KEY:process.env.WORKER_INTERNAL_KEY};
            if(process.env.WORKER_RESEND_API_KEY)s.RESEND_API_KEY=process.env.WORKER_RESEND_API_KEY;
            process.stdout.write(JSON.stringify(s))' \
            | pnpm --filter @app/notifier exec wrangler secret bulk ${CLOUDFLARE_ENV:+--env $CLOUDFLARE_ENV}

      - name: Migrate glasses_management
        run: pnpm run db:migrate:env glasses_management --env "${CLOUDFLARE_ENV}" --tf-output tf-output.json
      - name: Deploy glasses_management
        run: pnpm --filter @app/glasses_management run deploy
      - name: Sync glasses_management secrets
        run: |
          node -e 'const s={INTERNAL_KEY:process.env.WORKER_INTERNAL_KEY,
            JWT_SECRET:process.env.WORKER_JWT_SECRET,
            ADMIN_DOMAIN_AUTH_KEY:process.env.WORKER_DOMAIN_AUTH_KEY};
            if(process.env.WORKER_STAGING_ACCESS_TOKEN)s.STAGING_ACCESS_TOKEN=process.env.WORKER_STAGING_ACCESS_TOKEN;
            process.stdout.write(JSON.stringify(s))' \
            | pnpm --filter @app/glasses_management exec wrangler secret bulk ${CLOUDFLARE_ENV:+--env $CLOUDFLARE_ENV}

      - name: Migrate admin
        run: pnpm run db:migrate:env admin --env "${CLOUDFLARE_ENV}" --tf-output tf-output.json
      - name: Deploy admin
        run: pnpm --filter @app/admin run deploy
      - name: Sync admin secrets
        run: |
          node -e 'const s={INTERNAL_KEY:process.env.WORKER_INTERNAL_KEY,
            JWT_SECRET:process.env.WORKER_JWT_SECRET,
            AUTH_PEPPER:process.env.WORKER_AUTH_PEPPER,
            DOMAIN_AUTH_KEY:process.env.WORKER_DOMAIN_AUTH_KEY};
            if(process.env.WORKER_STAGING_ACCESS_TOKEN)s.STAGING_ACCESS_TOKEN=process.env.WORKER_STAGING_ACCESS_TOKEN;
            process.stdout.write(JSON.stringify(s))' \
            | pnpm --filter @app/admin exec wrangler secret bulk ${CLOUDFLARE_ENV:+--env $CLOUDFLARE_ENV}

      # staging は dev グラント無しの fail close なので、ログインできる admin が要る。
      # seed は INSERT OR IGNORE で冪等。production では回さない。
      - name: Seed staging admin
        if: env.DEPLOY_ENVIRONMENT == 'staging'
        env:
          AUTH_PEPPER: ${{ secrets.WORKER_AUTH_PEPPER }}
          ADMIN_PASSWORD: ${{ secrets.WORKER_STAGING_ADMIN_PASSWORD }}
          ADMIN_EMAIL: admin@example.com
        run: node services/admin/seed.mjs --remote
```

- [ ] **Step 4: ワークフローの構文を確認する**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!y.includes('deploy:')) throw new Error('deploy job がありません'); console.log('ok')"`
Expected: `ok`。可能なら `gh workflow view` / `actionlint` でも確認する。

- [ ] **Step 5: コミット**

```bash
git add .github/workflows/ci.yml
git commit -m "feat(ci): merge で staging / production へ自動デプロイする"
```

---

### Task 13: ブートストラップ

**Files:**
- Create: `scripts/bootstrap-ci.sh`
- Modify: `Makefile`（`bootstrap/ci` ターゲット）

- [ ] **Step 1: 実装する**

`scripts/bootstrap-ci.sh`:

```bash
#!/usr/bin/env bash
# GitHub Environment (staging / production) と secrets を用意する。
#
# Worker 用の値は生成するだけで人は知らなくてよい。人の手が要るのは Cloudflare の
# API トークンと R2 アクセスキーの発行だけ（S3 互換 backend は CF トークンでは
# 認証できないため）。
set -euo pipefail

REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
echo "対象リポジトリ: $REPO"

read -rsp "CLOUDFLARE_API_TOKEN: " CF_TOKEN; echo
read -rp  "CLOUDFLARE_ACCOUNT_ID: " CF_ACCOUNT
read -rsp "R2_STATE_ACCESS_KEY_ID: " R2_KEY; echo
read -rsp "R2_STATE_SECRET_ACCESS_KEY: " R2_SECRET; echo
read -rsp "WORKER_RESEND_API_KEY (production のみ・空可): " RESEND; echo

for env in staging production; do
  echo "--- environment: $env"
  gh api -X PUT "repos/${REPO}/environments/${env}" >/dev/null

  printf '%s' "$CF_TOKEN"   | gh secret set CLOUDFLARE_API_TOKEN          --repo "$REPO" --env "$env"
  printf '%s' "$CF_ACCOUNT" | gh secret set CLOUDFLARE_ACCOUNT_ID         --repo "$REPO" --env "$env"
  printf '%s' "$R2_KEY"     | gh secret set R2_STATE_ACCESS_KEY_ID        --repo "$REPO" --env "$env"
  printf '%s' "$R2_SECRET"  | gh secret set R2_STATE_SECRET_ACCESS_KEY    --repo "$REPO" --env "$env"

  # Worker 用の共有 secret。既存を上書きしないよう、無いときだけ作る。
  # AUTH_PEPPER は変えると既存パスワードハッシュが全部無効になる。
  existing=$(gh secret list --repo "$REPO" --env "$env" --json name -q '.[].name' || true)
  for name in WORKER_INTERNAL_KEY WORKER_JWT_SECRET WORKER_AUTH_PEPPER WORKER_DOMAIN_AUTH_KEY; do
    if echo "$existing" | grep -qx "$name"; then
      echo "= $name は設定済み（保持）"
    else
      openssl rand -hex 32 | tr -d '\n' | gh secret set "$name" --repo "$REPO" --env "$env"
      echo "+ $name を生成"
    fi
  done

  if [ "$env" = "staging" ]; then
    for name in WORKER_STAGING_ACCESS_TOKEN WORKER_STAGING_ADMIN_PASSWORD; do
      if echo "$existing" | grep -qx "$name"; then
        echo "= $name は設定済み（保持）"
      else
        openssl rand -hex 32 | tr -d '\n' | gh secret set "$name" --repo "$REPO" --env "$env"
        echo "+ $name を生成"
      fi
    done
  elif [ -n "$RESEND" ]; then
    printf '%s' "$RESEND" | gh secret set WORKER_RESEND_API_KEY --repo "$REPO" --env "$env"
  fi
done

echo
echo "✅ 完了。staging のゲートトークンは次で取り出せる（値はここでしか見えない）:"
echo "   gh secret list --repo $REPO --env staging"
echo "   ※ 値自体は GitHub からは読めない。staging を人が開くときは"
echo "      Actions のログに出さずに、必要なら再生成して配る。"
```

`Makefile` に足す（`worktree/new` の前）:

```make
## bootstrap/ci: GitHub Environment と secrets を用意する（人の手は R2 トークン発行のみ）
bootstrap/ci:
	bash scripts/bootstrap-ci.sh
```

`.PHONY` の並びに `bootstrap/ci` を足す。

- [ ] **Step 2: 構文を確認する**

Run: `bash -n scripts/bootstrap-ci.sh && make help | grep bootstrap`
Expected: ターゲットが一覧に出る

- [ ] **Step 3: コミット**

```bash
git add scripts/bootstrap-ci.sh Makefile
git commit -m "feat(ci): GitHub Environment と secrets を用意する導線を置く"
```

---

### Task 14: ドキュメントを実態に合わせる

**Files:**
- Modify: `docs/howto/deploy.md`（全面改稿）
- Modify: `docs/architecture/infra.md`
- Modify: `infra/terraform/cloudflare/README.md`
- Modify: `AGENTS.md`（サービス境界表の staging 名、ops の記述）

- [ ] **Step 1: `docs/howto/deploy.md` を書き換える**

次の 4 点を反映する。

1. デプロイは **merge で自動**（`develop` → staging / `main` → production）。手動は `workflow_dispatch` の緊急経路のみ。
2. secrets は **GitHub Environment が唯一の源泉**。`wrangler secret put` の手順は削除し、`make bootstrap/ci` に置き換える。
3. **`services/ops` は存在しない**ので、ops のデプロイ・`D1_EXPORT_API_TOKEN` の記述を削り、「バックアップ Worker は未実装（別件）」と明記する。
4. staging ゲートの使い方（`https://<worker>.workers.dev/?gate=<token>` で Cookie を得る）。

- [ ] **Step 2: `docs/architecture/infra.md` に 2 環境モデルを反映**

Terraform の `modules` + `envs` 構成、R2 state backend、1 リソース 1 オーナー原則が変わっていないことを書く。

- [ ] **Step 3: `AGENTS.md` を直す**

サービス境界表の各行に staging Worker 名を添え、`services/ops` の行に**未実装**であることを明記する（表から消すのではなく、実態を書く）。

- [ ] **Step 4: `infra/terraform/cloudflare/README.md` を直す**

`modules/substrate` + `envs/<env>` の構成、`import-existing.sh`、backend の `-backend-config` 注入を説明する。ローカルから触るときは `terraform -chdir=envs/<env>` を使うことと、**トークンを常設しない**ことを書く。

- [ ] **Step 5: コミット**

```bash
git add docs AGENTS.md infra/terraform/cloudflare/README.md
git commit -m "docs: 自動デプロイと secrets の源泉に合わせて手順を書き直す"
```

---

### Task 15: 全体を緑にして PR を出す

- [ ] **Step 1: フルチェック**

Run: `pnpm check`
Expected: lint / Knip / typecheck / combined test すべて PASS

落ちたら直して再実行する。**カバレッジ閾値を下げて通してはならない。**

- [ ] **Step 2: push**

```bash
git push -u origin feat/auto-deploy-develop-staging
```

- [ ] **Step 3: PR を作る**

本文に含めるもの: 目的、設計書へのリンク、**マージしても即座には本番が動かないこと**（`develop` / `main` への merge が必要）、**初回は placeholder のため binding 突合で落ちる**こと、必要な secrets の一覧と `make bootstrap/ci`、R2 API トークンの手発行が要ること。

```bash
gh pr create --base main --title "feat(ci): merge で staging / production へ自動デプロイする" --body "..."
```
