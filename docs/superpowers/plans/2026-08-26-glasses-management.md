# glasses_management Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 旧モックを廃止し、EYEX予約を実装できる `glasses_management` の認証済み・テナント分離済み・監査可能なCloudflare基盤を構築する。

**Architecture:** `glasses_management` は同一Worker内のReact SPA/Hono RPCと専用D1を持ち、R2録音と短期KVを利用する。adminは認証と組織の正として内部認証プロキシ・組織同期を提供し、notifierは確定メールと管理コードメールだけを同期送信する。

**Tech Stack:** Cloudflare Workers/D1/R2/KV/service bindings、React、Hono RPC、Zod、Drizzle、Vitest workers/jsdom、Playwright。

**Spec:** `specs/glasses_management/00_service-spec.md`、`specs/glasses_management/features/002-eyex-reservation-product/spec.md`、`docs/superpowers/specs/2026-08-26-glasses-management-design.md`

## Global Constraints

- 1 domain = 1 D1、全業務行をJWTの`organization_id`でスコープし、cross-D1 JOINとFKを使わない。
- API契約は`packages/contracts/src/glasses_management.ts`のZod単一ソース、Hono route chainと`AppType`を使う。
- private APIはdefault-deny、未認証は401、権限・無効組織は403、未同期組織は503、古い版は409とする。
- IDは`crypto.randomUUID()`、複数書込みは`db.batch()`、時刻は注入し、テストで`Date.now()`に依存しない。
- 色・書体・radiusは`packages/ui/src/theme.css`のセマンティックトークンだけを使う。
- Web確定メールと会社側の管理コード再発行メールはnotifier経由、送信失敗は予約を取り消さない。
- Worker/integration coverageは各80%以上、web coverageは各60%以上、Approved UC/ACはPlaywrightへちょうど1回対応付ける。

---

### Task 1: 旧モック廃止と新サービスのworkspace設定

**Files:**
- Create: `services/glasses_management/**`（`services/example_service`をコピーしてitem固有コードを除去）
- Modify: `package.json`, `Makefile`, `.github/workflows/ci.yml`, `CODEMAP.md`
- Delete: `services/glasses_reservation/**`
- Test: root combined testの対象workspaceと`services/glasses_management/test/service-shell.test.ts`

**Produces:** package `@app/glasses_management`、Worker `glasses-management`、未使用port、D1 binding `DB`、R2 binding `RECORDINGS`、KV binding `SHORT_LIVED`、空の`/api/health`。

- [ ] **Step 1: 失敗するサービスshellテストを書く**

```ts
test('returns the glasses-management health response', async () => {
  const response = await SELF.fetch('https://example.test/api/health')
  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({ status: 'ok' })
})
```

- [ ] **Step 2: Redを確認する**

Run: `pnpm --filter @app/glasses_management exec vitest run test/service-shell.test.ts`

Expected: package or test config does not exist.

- [ ] **Step 3: 最小Worker、Wrangler、Vitest設定を追加する**

```ts
const routes = app.get('/api/health', (c) => c.json({ status: 'ok' as const }))
export type AppType = typeof routes
export default { fetch: app.fetch }
```

- [ ] **Step 4: Greenを確認する**

Run: `pnpm --filter @app/glasses_management exec vitest run test/service-shell.test.ts`

Expected: PASS。

- [ ] **Step 5: 旧モックのworkspace、CI、deploy、Makefile参照を新サービスへ置換し、削除対象が残らないことを確認する**

Run: `rg 'glasses_reservation|glasses-reservation' package.json Makefile .github CODEMAP.md services`

Expected: 移行記録以外に旧package/Workerの実行参照がない。

### Task 2: Zod契約、組織同期、default-deny、店舗権限

**Files:**
- Create: `packages/contracts/src/glasses_management.ts`, `services/glasses_management/src/worker/auth.ts`, `services/glasses_management/test/permissions.test.ts`, `services/glasses_management/test/tenant-isolation.test.ts`
- Modify: `packages/contracts/src/index.ts`, `services/glasses_management/src/worker/index.ts`, `services/glasses_management/src/worker/db/schema.ts`
- Test: `permissions.test.ts`, `tenant-isolation.test.ts`

**Produces:** `OrganizationSync`, `Store`, `Actor`, `requireStorePermission()`、internal組織sync endpoint、organization同期コピー。

- [ ] **Step 1: 全認証状態で失敗するpermissions表を先に書く**

```ts
test.each([
  ['no token', undefined, 401],
  ['expired token', expiredToken, 401],
  ['wrong secret', foreignToken, 401],
  ['inactive organization', disabledToken, 403],
  ['unknown api route', staffToken, 404],
])('%s is rejected with %i', async (_name, token, status) => {
  const response = await api(token).get('/api/staff/stores')
  expect(response.status).toBe(status)
})
```

- [ ] **Step 2: Redを確認する**

Run: `pnpm --filter @app/glasses_management exec vitest run test/permissions.test.ts`

Expected: staff route and organization middleware do not exist.

- [ ] **Step 3: Zod契約、同期organization表、`tenantAuth()`/`requireActiveOrg()`、店舗permissionを実装する**

```ts
export const OrganizationSync = z.strictObject({
  id: z.string().uuid(), name: z.string().min(1), plan: Plan, isDisabled: z.boolean(),
})
export async function requireStorePermission(c: StoreContext, storeId: string): Promise<Response | null>
```

- [ ] **Step 4: Greenと3組織分離を確認する**

Run: `pnpm --filter @app/glasses_management exec vitest run test/permissions.test.ts test/tenant-isolation.test.ts`

Expected: PASS。bodyの`organizationId`・別storeIdを偽装しても越境read/writeできない。

### Task 3: 版、冪等、監査、JST時計の共通基盤

**Files:**
- Create: `services/glasses_management/src/worker/domain/{audit,idempotency,version,clock}.ts`, `services/glasses_management/test/{audit,idempotency,clock}.test.ts`
- Modify: `services/glasses_management/src/worker/db/schema.ts`
- Test: 同上

**Produces:** `writeAuditBatch()`, `withIdempotency()`, `assertVersion()`, `Clock`。

- [ ] **Step 1: 失敗する監査・冪等・時刻境界テストを書く**

```ts
test('does not perform a management write when its audit event cannot be written', async () => {
  await expect(publishSettings(failingAuditDeps)).rejects.toMatchObject({ status: 500 })
  expect(await loadPublishedSettings()).toBeNull()
})
test('returns the original result for the same idempotency key', async () => {
  expect(await createOnce('same-key')).toEqual(await createOnce('same-key'))
})
```

- [ ] **Step 2: Redを確認する**

Run: `pnpm --filter @app/glasses_management exec vitest run test/audit.test.ts test/idempotency.test.ts test/clock.time.test.ts`

Expected: domain helpers do not exist.

- [ ] **Step 3: D1表と最小helperを実装する**

```ts
export type Clock = { now: () => Date }
export async function assertVersion(current: number, expected: number): Promise<void>
export async function withIdempotency<T>(input: IdempotencyInput, execute: () => Promise<T>): Promise<T>
```

- [ ] **Step 4: Greenを確認する**

Run: `pnpm --filter @app/glasses_management exec vitest run test/audit.test.ts test/idempotency.test.ts test/clock.time.test.ts`

Expected: PASS。JST日跨ぎ・月末・うるう年・ちょうど/±1msを含む。

### Task 4: adminのドメイン認証プロキシと組織同期

**Files:**
- Create: `services/admin/src/worker/domain-auth.ts`, `services/admin/test/glasses-management-sync.test.ts`
- Modify: `services/admin/src/worker/index.ts`, `services/admin/wrangler.jsonc`, `services/admin/test/permissions.test.ts`
- Test: `glasses-management-sync.test.ts`

**Produces:** `GLASSES_MANAGEMENT` binding、`/api/internal/domain-auth/*`、組織作成・変更・無効化時の同期。

- [ ] **Step 1: service bindingが組織作成時に同期する失敗テストを書く**

```ts
test('sends organization data to glasses-management after creation', async () => {
  await createOrganizationAsOperator()
  expect(env.GLASSES_MANAGEMENT.fetch).toHaveBeenCalledWith(expect.objectContaining({
    method: 'POST', headers: expect.objectContaining({ 'x-internal-key': expect.any(String) }),
  }))
})
```

- [ ] **Step 2: Redを確認する**

Run: `pnpm --filter @app/admin exec vitest run test/glasses-management-sync.test.ts`

Expected: binding and synchronization behavior do not exist.

- [ ] **Step 3: internal auth proxyと明示的な同期失敗結果を実装する**

```ts
POST /api/internal/domain-auth/login
POST /api/internal/domain-auth/refresh
POST /api/internal/organizations/sync
```

- [ ] **Step 4: Greenを確認する**

Run: `pnpm --filter @app/admin exec vitest run test/glasses-management-sync.test.ts`

Expected: PASS。internal keyなしとtenant JWTは401、同期失敗は呼び出し元へ明示される。

### Task 5: notifierの予約メール最小実装

**Files:**
- Create: `services/notifier/**`, `packages/contracts/src/notification.ts`, `services/notifier/test/send.test.ts`
- Modify: `packages/contracts/src/index.ts`, root workspace/CI/Terraform、`services/glasses_management/wrangler.jsonc`
- Test: `services/notifier/test/send.test.ts`

**Produces:** internal `POST /api/internal/send`、`DEDUPE` KV、予約確定・管理コード再発行のメール契約。

- [ ] **Step 1: 鍵なし、重複、送信設定なしの失敗テストを書く**

```ts
test('fails closed when mail delivery is not configured', async () => {
  const response = await SELF.fetch(requestForReservationEmail())
  expect(response.status).toBe(502)
})
test('does not send the same idempotency key twice', async () => {
  await sendTwice('reservation:abc:confirmed')
  expect(resend).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Redを確認する**

Run: `pnpm --filter @app/notifier exec vitest run test/send.test.ts`

Expected: package and endpoint do not exist.

- [ ] **Step 3: internal key、KV dedupe、Resend adapter、Zod notification契約を実装する**

```ts
export const ReservationConfirmedEmail = z.strictObject({ reservationId: z.string().uuid(), to: z.string().email(), managementCode: z.string().min(1) })
```

- [ ] **Step 4: Greenを確認する**

Run: `pnpm --filter @app/notifier exec vitest run test/send.test.ts`

Expected: PASS。キー未設定はfail-close、重複は外部送信しない。

### Task 6: Cloudflare資源、migration、CI、検証基線

**Files:**
- Create: `services/glasses_management/migrations/0000_*.sql`
- Modify: `infra/terraform/cloudflare/{main.tf,outputs.tf}`, `services/glasses_management/wrangler.jsonc`, `.github/workflows/ci.yml`, `package.json`, `Makefile`, `CODEMAP.md`
- Test: `services/glasses_management/test/setup.ts`, root check

**Produces:** TerraformのD1/R2/KV、Wrangler bindings、CIの新service/notifier matrix、local migration。

- [ ] **Step 1: migrationを読むintegrationテストを先に書く**

```ts
test('applies the glasses-management migrations to an empty D1 database', async () => {
  await expect(env.DB.prepare('select * from organizations').all()).resolves.toBeDefined()
})
```

- [ ] **Step 2: Redを確認する**

Run: `pnpm --filter @app/glasses_management exec vitest run test/setup.test.ts`

Expected: migration/schema does not exist.

- [ ] **Step 3: Drizzle schema、generated migration、D1/R2/KV Terraform outputs、Wrangler binding、CI matrixを追加する**

```sh
pnpm --filter @app/glasses_management db:generate
pnpm --filter @app/glasses_management db:migrate:local
pnpm -r cf-typegen
```

- [ ] **Step 4: 基盤ゲートを確認する**

Run: `pnpm --filter @app/glasses_management test:all && pnpm --filter @app/admin test:all && pnpm --filter @app/notifier test && pnpm run test:traceability`

Expected: PASS。次フェーズのApproved UC/AC E2E mappingは未追加のため、基盤のみがgreen。

## 計画セルフレビュー

- Spec coverage: Phase 0のサービス名移行、旧モック廃止、認証、組織同期、R2/KV、メール、監査、冪等、時刻、CIをTask 1–6へ割当済み。予約等のproduct behaviorはロードマップのPhase 1以降で扱う。
- Placeholder scan: 未確定実装を残さず、各Taskのproduces、Red/Greenコマンド、期待結果を明記した。
- Type consistency: `OrganizationSync`、`Clock`、`withIdempotency`、`assertVersion`を後続フェーズの共通インターフェースとして固定した。
