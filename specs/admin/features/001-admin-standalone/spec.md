# 001-admin-standalone: admin 単独運用

- ステータス: Approved

## 1. WHAT / WHY

**概要**: `admin` だけを Cloudflare にデプロイする最小構成へ移行する。通知、他サービスとの組織同期、バックアップ・監視を廃止し、関連するサービスと Cloudflare 資源を削除する。

**ユーザーストーリー**:

- US-ADMIN-01: 運用者として、管理コンソールだけを Cloudflare で安全に公開・運用したい。
- US-ADMIN-02: 運用者として、不要な notifier/ops の Worker・ストレージ・自動デプロイを持たずに済ませたい。

**受け入れ基準**:

- AC-ADMIN-01: Given `admin` 単独構成, When 組織を作成・更新・無効化する, Then admin D1 内で完結し外部 Worker への同期を試みない。
- AC-ADMIN-02: Given `admin` 単独構成, When 招待を作成する, Then メール送信を試みず手動共有用の招待 URL を返す。
- AC-ADMIN-03: Given main への push, When CI の deploy job が実行される, Then admin だけがマイグレーション後にデプロイされる。

**運用時の検証**: Cloudflare に notifier/ops と付随資源が存在する場合、移行完了後に notifier/ops Worker、notifier 用 KV、ops 用 R2 バケットが存在しないことを CLI の一覧で確認する。

**スコープ外**:

- `example_service` の雛形コードの削除または本番デプロイ（notifier 依存のみを除去する）。
- notifier/ops が提供していたメール通知、自動バックアップ、死活・容量監視の代替導入。
- admin D1、`AUTH_RL` KV、既存の admin データの削除。

**不明点**: なし。

## 2. HOW

**触るファイル**:

- `services/admin/src/worker/index.ts` — 組織 CRUD を admin D1 内で完結させ、通知送信と Cron を除去する。
- `services/admin/src/worker/sync.ts` / `services/admin/src/worker/reconcile.ts` — domain sync / 日次照合の実装を削除する。
- `services/admin/test/admin.integration.test.ts` / `services/admin/test/reconcile.test.ts` / `services/admin/vitest.config.ts` — 単独構成の期待値へ置換し、不要な binding fixture を除去する。
- `services/admin/wrangler.jsonc` / `services/admin/package.json` / `services/admin/AGENTS.md` / `services/admin/vite.config.ts` / `services/admin/e2e/smoke.spec.ts` — service binding、Cron、雛形パッケージ依存、説明・E2E を単独構成に合わせる。
- `services/notifier/**` / `services/ops/**` — サービスを削除する。
- `services/example_service/**` / `packages/{contracts,shared}/**` — notifier binding、送信処理、通知契約、通知専用テスト fixture を削除し、雛形の item / org 同期機能は維持する。
- `package.json` / `knip.jsonc` / `Makefile` / `scripts/check-agent-compat.sh` / `.github/workflows/ci.yml` — notifier/ops の workspace、検査、ローカル起動、CI デプロイ対象を除去する。
- `infra/terraform/cloudflare/main.tf` / `infra/terraform/cloudflare/outputs.tf` / `infra/terraform/cloudflare/README.md` — notifier KV、ops R2 と lifecycle、example_service 用 D1 および出力を Terraform 管理から外す。
- `README.md` / `CODEMAP.md` / `docs/howto/{cloudflare-setup,deploy,prompting}.md` / `docs/architecture/infra.md` / `AGENTS.md` / `specs/admin/00_service-spec.md` — 単独運用、トークン、デプロイ、責務の説明を更新する。

**契約**: API の Zod schema と D1 スキーマに変更なし。組織作成・更新・無効化レスポンスから同期結果 `synced` を除外する。

**データモデル差分**: admin D1 と `AUTH_RL` KV に変更なし。Terraform 管理から example_service D1、notifier `DEDUPE` KV、ops バックアップ R2 を削除する。

**却下した代替案**:

- notifier/ops をデプロイせず service binding だけ残す: 失敗する同期・通知・Cron が継続するため却下。
- 通知・バックアップの代替サービスを導入する: 要求範囲外の機能追加になるため却下。
- example_service の雛形を削除する: 新サービスのコピー元として維持するため却下。

## 3. TASKS

- [ ] T-001: admin の組織 CRUD / 招待について、同期・メール送信を試みず DB と手動共有 URL だけを返す失敗テスト（Red）を書き、既存の照合テストを削除対象として確定する。
- [ ] T-002: `admin` の service binding / Cron を除去し、T-001 のテストを Green にする。`sync.ts` と `reconcile.ts`、関連テスト・fixture を削除する。
- [ ] T-003: notifier と ops の全ファイル、example_service の notifier 依存、共有通知契約を削除し、root scripts、Makefile、Knip、agent compatibility、CI matrix から両サービスを除去する。
- [ ] T-004: Terraform を admin D1 と `AUTH_RL` KV のみにし、運用・アーキテクチャ・サービス仕様書を単独構成へ更新する。
- [ ] T-005: admin の `wrangler.jsonc` に実 D1/KV ID を設定するための安全な手順を用意し、`pnpm --filter @app/admin typecheck`、対象テスト、E2E、`pnpm check` を実行する。
- [ ] T-006: Cloudflare OAuth 認証後に既存リソースを一覧で特定し、admin を更新デプロイしてから notifier/ops Worker、notifier KV、ops R2 を削除する。各不可逆操作の直前に対象を再確認する。
