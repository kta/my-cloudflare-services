# Admin 単独運用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** notifier と ops を完全に廃止し、Cloudflare には admin だけをデプロイする。

**Architecture:** admin は D1 と `AUTH_RL` KV だけを所有する単独 Worker にする。組織 CRUD は admin D1 で完結させ、招待は常に手動共有用 URL を返す。CI と Terraform も admin の必要資源だけに限定し、Cloudflare 上の廃止資源は admin の更新デプロイ後に明示削除する。

**Tech Stack:** Cloudflare Workers / D1 / KV / Wrangler / Terraform / Hono / React / Vitest / Playwright / GitHub Actions

**Spec:** `specs/admin/features/001-admin-standalone/spec.md`

## Global Constraints

- US-ID: `US-ADMIN-01`, `US-ADMIN-02`。受け入れ基準は `AC-ADMIN-01`〜`AC-ADMIN-04`。
- admin D1 と `AUTH_RL` KV、および既存の admin データは削除しない。
- `example_service` は雛形として残し、本番デプロイ・Terraform 資源・admin binding を持たせない。
- API schema と DB schema は変更しない。`synced` を組織 CRUD レスポンスから削除する。
- トークンやアプリ secret はコード、Git、チャットに保存しない。Cloudflare secret は `wrangler secret put` の標準入力で登録する。
- Cloudflare の削除は対象を一覧確認してから、対象ごとに実行直前の人間承認を得る。

---

### Task 1: admin 単独 Worker の振る舞いをテストで固定

**Files:**

- Modify: `services/admin/test/admin.integration.test.ts`
- Modify: `services/admin/test/permissions.test.ts`（既存の route 表に影響があれば）
- Modify: `services/admin/e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: 現行 `POST/PATCH/DELETE /api/organizations/:id?` と `POST /api/organizations/:id/invitations`。
- Produces: 外部 binding 非依存の組織 CRUD と `{ emailed: false, acceptUrl: string }` の招待レスポンス期待値。

- [ ] **Step 1: Worker integration の失敗テストを書く**

  `EXAMPLE_SERVICE` の spy を削除し、組織作成・更新・無効化が `synced` を含まず admin D1 の値を返すことを追加する。招待では `emailed === false` と request origin を基にした `acceptUrl` を期待する。

  ```ts
  expect(await res.json()).toMatchObject({ id: org.id, isDisabled: true })
  expect((await res.json()) as { synced?: unknown }).not.toHaveProperty('synced')
  expect(body).toMatchObject({ emailed: false })
  expect(body.acceptUrl).toContain(`${BASE}/invite?token=`)
  ```

- [ ] **Step 2: 対象テストが現行実装で失敗することを確認する**

  Run: `pnpm --filter @app/admin exec vitest run test/admin.integration.test.ts`

  Expected: `synced` の存在または `EXAMPLE_SERVICE` への呼び出しにより失敗する。

- [ ] **Step 3: E2E の期待値を単独運用へ変更する**

  smoke scenario の名称を「組織作成 → 手動招待リンク → プラン切替 → 無効化」にし、メール障害ではなく常に手動共有 URL が表示されることを期待する。

  ```ts
  expect(invitation).toMatchObject({ emailed: false })
  expect(invitation.acceptUrl).toMatch(/^http:\/\/localhost:4174\/invite\?token=/)
  ```

- [ ] **Step 4: 変更したテストが Red のままであることを確認する**

  Run: `pnpm --filter @app/admin exec vitest run test/admin.integration.test.ts`

  Expected: production code がまだ external sync / notify に依存しているため FAIL。

### Task 2: admin の binding、同期、Cron を除去して Green にする

**Files:**

- Modify: `services/admin/src/worker/index.ts`
- Delete: `services/admin/src/worker/sync.ts`
- Delete: `services/admin/src/worker/reconcile.ts`
- Delete: `services/admin/test/reconcile.test.ts`
- Modify: `services/admin/vitest.config.ts`
- Modify: `services/admin/wrangler.jsonc`
- Modify: `services/admin/package.json`
- Modify: `services/admin/vite.config.ts`

**Interfaces:**

- Consumes: Task 1 のレスポンス期待値。
- Produces: `Bindings` が `DB`, `AUTH_RL`, `JWT_SECRET`, `AUTH_PEPPER`, `AUTH_DEV_GRANT?`, `INVITE_BASE_URL?` だけの admin Worker。

- [ ] **Step 1: 最小実装を入れる**

  `index.ts` から `NotificationJob`, `sendNotification`, `Fetcher`, `lt`, `authEvents`, sync/reconcile imports、`NOTIFIER` / `EXAMPLE_SERVICE` / `INTERNAL_KEY` / `OPS_ALERT_EMAIL` binding、`notify()` と `scheduled()` を除く。組織 CRUD は DB 更新後に変換結果だけを返し、招待は通知を呼ばず次を返す。

  ```ts
  const acceptUrl = `${c.env.INVITE_BASE_URL || new URL(c.req.url).origin}/invite?token=${token}`
  return c.json({ emailed: false as const, acceptUrl }, 201)
  ```

  Worker export は fetch 専用にする。

  ```ts
  export default { fetch: app.fetch }
  ```

- [ ] **Step 2: test fixture と Wrangler 設定を最小化する**

  `vitest.config.ts` の `INTERNAL_KEY`、`OPS_ALERT_EMAIL`、`serviceBindings` を削除する。`wrangler.jsonc` の `services`、`triggers`、`OPS_ALERT_EMAIL` を削除し、admin D1 と `AUTH_RL` KV は残す。`@app/example_service` を admin の devDependency から除く。

- [ ] **Step 3: Task 1 のテストを Green にする**

  Run: `pnpm --filter @app/admin exec vitest run test/admin.integration.test.ts`

  Expected: PASS。

- [ ] **Step 4: admin の型検査を行う**

  Run: `pnpm --filter @app/admin typecheck`

  Expected: PASS。削除済み binding / module の型参照がない。

### Task 3: notifier と ops を workspace から撤去する

**Files:**

- Delete: `services/notifier/`
- Delete: `services/ops/`
- Modify: `package.json`
- Modify: `knip.jsonc`
- Modify: `Makefile`
- Modify: `scripts/check-agent-compat.sh`
- Modify: `.github/workflows/ci.yml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: Task 2 の admin-only Worker。
- Produces: root test・check・CI deploy が存在する `admin` と雛形 `example_service` だけを扱う。

- [ ] **Step 1: package-level の検査変更を先に行う**

  root `test` から `@app/notifier` と `@app/ops` を外し、Knip workspace と agent compatibility loop からも外す。Makefile の `dev/notifier`、`deploy/notifier`、`deploy/ops` と PHONY 参照を除く。CI deploy matrix を次の一要素だけにする。

  ```yaml
  matrix:
    include:
      - { pkg: '@app/admin' }
  ```

- [ ] **Step 2: 期待どおりに検査が失敗することを確認する**

  Run: `pnpm run typecheck`

  Expected: notifier/ops がまだ workspace にあり、削除途中の参照または lockfile 状態で失敗する場合は、その参照箇所を特定する。

- [ ] **Step 3: notifier/ops の全ファイルを削除し lockfile を更新する**

  `services/notifier` と `services/ops` の tracked files を削除し、`pnpm install --lockfile-only` で workspace lockfile を正規化する。

- [ ] **Step 4: workspace 検査を Green にする**

  Run: `pnpm run typecheck && bash scripts/check-agent-compat.sh && pnpm run deps:check`

  Expected: PASS。

### Task 4: Terraform と運用文書を admin 単独構成へ更新する

**Files:**

- Modify: `infra/terraform/cloudflare/main.tf`
- Modify: `infra/terraform/cloudflare/outputs.tf`
- Modify: `infra/terraform/cloudflare/README.md`
- Modify: `README.md`
- Modify: `CODEMAP.md`
- Modify: `AGENTS.md`
- Modify: `services/admin/AGENTS.md`
- Modify: `specs/admin/00_service-spec.md`
- Modify: `docs/howto/cloudflare-setup.md`
- Modify: `docs/howto/deploy.md`
- Modify: `docs/howto/prompting.md`
- Modify: `docs/architecture/infra.md`

**Interfaces:**

- Consumes: Task 2/3 の admin-only リソース境界。
- Produces: Terraform output は `admin_d1_database_id` と `auth_rl_kv_namespace_id` のみ。運用文書は OAuth/CI token、D1/KV、admin deploy のみを説明する。

- [ ] **Step 1: Terraform の削除対象を宣言から外す**

  `example_service` D1、`dedupe` KV、`backups` R2、R2 lifecycle と対応 outputs を削除する。admin D1 と `auth_rl` KV は変更しない。

- [ ] **Step 2: Terraform の構文と plan を検証する**

  Run: `terraform -chdir=infra/terraform/cloudflare fmt -check && terraform -chdir=infra/terraform/cloudflare validate`

  Expected: PASS。リモート state が初期化・設定済みの場合だけ `terraform plan` で削除予定資源を表示し、apply はしない。

- [ ] **Step 3: 文書・service spec を更新する**

  admin の責務を auth/organization の単独源泉に更新し、メール通知・組織同期・自動バックアップ/監視を提供しないこと、手動招待 URL、admin 専用の D1/KV、CI secret の権限を明記する。`example_service` はデプロイしない雛形と明記する。

- [ ] **Step 4: 文書参照の残骸を確認する**

  Run: `rg -n -i 'notifier|services/ops|@app/ops|@app/notifier|NOTIFIER|EXAMPLE_SERVICE' --glob '!pnpm-lock.yaml' --glob '!docs/superpowers/plans/**' .`

  Expected: 現在形の運用説明・実装参照は 0 件。雛形自身の通知説明は別途 admin 単独化と矛盾しないか確認する。

### Task 5: ローカル品質ゲートと E2E traceability を完了する

**Files:**

- Modify: `services/admin/e2e/smoke.spec.ts`
- Modify: `specs/admin/features/001-admin-standalone/spec.md`（実施済みタスクを更新）

**Interfaces:**

- Consumes: Tasks 1–4 の完成状態。
- Produces: `AC-ADMIN-01`〜`AC-ADMIN-03` を一意に追跡できる admin E2E と緑のローカル品質ゲート。

- [ ] **Step 1: E2E covers annotation を付与する**

  E2E traceability convention に従い、組織作成、手動招待、無効化を通す scenario に `AC-ADMIN-01`〜`AC-ADMIN-03` の `@e2e-covers` をちょうど一度付ける。

- [ ] **Step 2: 変更対象のテストと E2E を実行する**

  Run: `pnpm --filter @app/admin test:all && pnpm --filter @app/admin e2e`

  Expected: PASS、Worker 4 指標 80% 以上、web 4 指標 60% 以上。

- [ ] **Step 3: リポジトリ全体を確認する**

  Run: `pnpm check`

  Expected: lint、Knip、typecheck、combined tests、coverage、traceability が PASS。

### Task 6: Cloudflare の admin-only 移行と廃止資源削除

**Files:**

- Modify: `services/admin/wrangler.jsonc`（実 D1 / KV ID をローカルに反映する場合のみ。値は commit しない。）

**Interfaces:**

- Consumes: Cloudflare OAuth または GitHub Secrets、admin D1/KV の実 ID、Task 5 の緑の状態。
- Produces: デプロイ済み admin と削除済み notifier/ops Cloudflare 資源。

- [ ] **Step 1: 認証と正確な対象を read-only で確認する**

  Run: `pnpm --dir services/admin exec wrangler whoami`、`pnpm --dir services/admin exec wrangler deployments list`、`pnpm --dir services/admin exec wrangler kv namespace list`、`pnpm --dir services/admin exec wrangler r2 bucket list`

  Expected: 操作対象アカウント、既存 Worker、notifier KV、ops R2 バケットを名前と ID で確定する。

- [ ] **Step 2: admin の資源を用意し secrets を登録する**

  `admin` D1 と `AUTH_RL` KV が存在しない場合だけ作成し、生成された ID をローカル `wrangler.jsonc` に反映する。`JWT_SECRET` と `AUTH_PEPPER` を `wrangler secret put` に標準入力で登録する。`AUTH_DEV_GRANT` と `INTERNAL_KEY` は登録しない。

- [ ] **Step 3: admin を migrate → deploy する**

  Run: `pnpm --dir services/admin run db:migrate:remote && pnpm --dir services/admin run deploy`

  Expected: admin Worker の URL が表示され、D1 migration が成功する。これは外部状態を更新するため、実行直前に再承認を得る。

- [ ] **Step 4: admin の公開状態を確認する**

  Run: `pnpm --dir services/admin exec wrangler deployments list` と admin URL の `/api/health`。

  Expected: 新 deployment が active で、`{ "status": "ok" }` を返す。

- [ ] **Step 5: notifier/ops の Cloudflare 資源を削除する**

  admin の正常稼働を確認してから、`notifier` Worker、`ops` Worker、notifier `DEDUPE` KV、ops R2 bucket（中のバックアップを含む）を名前/ID指定で削除する。Terraform state がある場合は、先に `terraform plan -destroy` 相当で差分を確定し、各不可逆コマンドの直前に再承認を得る。

- [ ] **Step 6: 残存資源がないことを確認する**

  Run: `wrangler deployments list`（各旧 Worker 名）、`wrangler kv namespace list`、`wrangler r2 bucket list`。

  Expected: admin Worker、admin D1、`AUTH_RL` KV だけが今回の構成に残る。
