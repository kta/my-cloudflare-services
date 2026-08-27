# 本番デプロイ手順（runbook）

各サービスは **1 Worker が SPA と API を同一オリジンで配信**する。旧来の「SPA と API が別オリジン」に伴う CORS / `VITE_API_URL` の設定は存在しない。**Queue は一切使わない**（無料枠方針 — AGENTS.md ルール 9）。非同期通知は notifier の同期送信 API（`POST /api/internal/send`）に service binding で送る。

## 0. 前提
- Cloudflare アカウント / `CLOUDFLARE_API_TOKEN`（**Workers Scripts / D1 / KV / R2 Edit + Account Read**。Queues は不要）/ `CLOUDFLARE_ACCOUNT_ID`

## 1. 基盤を作る（Terraform）
```sh
cd infra/terraform/cloudflare
export CLOUDFLARE_API_TOKEN=...
cp terraform.tfvars.example terraform.tfvars   # account id
terraform init && terraform apply
terraform output            # D1 id / KV id / R2 bucket 名を控える
```

## 2. wrangler.jsonc に id を反映
- `services/admin/wrangler.jsonc` / `services/glasses_management/wrangler.jsonc` の `d1_databases[0].database_id` を TF 出力の値に。
- KV: `services/admin`（`AUTH_RL`）/ `services/notifier`（`DEDUPE`）/ `services/glasses_management`（`SHORT_LIVED`）の `kv_namespaces[].id` を TF 出力の値に。
- R2: `services/glasses_management/wrangler.jsonc` の `RECORDINGS` `bucket_name` を TF 出力の値に（バケットは非公開のまま運用する）。
- ops: `services/ops/wrangler.jsonc` の `ADMIN_DB_ID` を TF 出力の admin `database_id` に（バックアップ export 対象。自ドメインサービスを足したらその D1 も追加）。R2 バケットは TF が作成（`backups_r2_bucket_name` 出力）。

## 3. secrets を設定
**機密値は wrangler.jsonc の `vars` に置いていない**（公式方針: 機密は secrets のみ）。ローカル開発は各サービスの `.dev.vars`（`make init` が `.dev.vars.example` からコピー、gitignore 対象）、本番は `wrangler secret put` **のみ**。secret を設定するまで各サービスは fail close（internal API 401 / 認証不可）で動く。

`INTERNAL_KEY` は **service binding でつながる全サービスで同一値**。`JWT_SECRET` は発行側（admin）と検証側（**各ドメインサービスにも必ず設定**）で同一値。`AUTH_PEPPER` は **admin のみ**（パスワードハッシュは admin だけが扱う — ドメインサービスには設定不要）。
```sh
KEY="<high-entropy>"; JWT="<high-entropy>"; PEPPER="<high-entropy>"; DOMAIN_AUTH_KEY="<high-entropy>"
for s in admin notifier glasses_management ops; do
  echo -n "$KEY" | pnpm --filter @app/$s exec wrangler secret put INTERNAL_KEY
done
for s in admin glasses_management; do  # 検証側にも JWT_SECRET が必要
  echo -n "$JWT" | pnpm --filter @app/$s exec wrangler secret put JWT_SECRET
done
echo -n "$PEPPER" | pnpm --filter @app/admin exec wrangler secret put AUTH_PEPPER
# PIN再認証は admin と glasses_management の間だけを結ぶ専用キーを使う。
# INTERNAL_KEY / JWT_SECRET と値を共有しない。
echo -n "$DOMAIN_AUTH_KEY" | pnpm --filter @app/admin exec wrangler secret put DOMAIN_AUTH_KEY
echo -n "$DOMAIN_AUTH_KEY" | pnpm --filter @app/glasses_management exec wrangler secret put ADMIN_DOMAIN_AUTH_KEY
# 通知メール。RESEND_API_KEY または MAIL_FROM が未設定の本番は
# 送信が fail close（502）。ローカルでも設定が無ければ同じ挙動になる。
echo -n "<resend-key>" | pnpm --filter @app/notifier exec wrangler secret put RESEND_API_KEY
# 送信元アドレスは secret ではなく notifier/wrangler.jsonc の vars.MAIL_FROM を編集する
# （Resend は from ドメインの検証必須 → **検証済み運用ドメイン**。空のままでは
# notifier が Resend を呼ばずに fail close する）
# ops バックアップ: D1 REST export トークン（**D1:Read のみ**にスコープ。容量監視も
# 同トークンで「Get database」→ file_size を読む）
echo -n "<d1-read-token>" | pnpm --filter @app/ops exec wrangler secret put D1_EXPORT_API_TOKEN
# 非機密の設定は wrangler.jsonc の vars で: ops の CF_ACCOUNT_ID（アカウント ID）と
# OPS_ALERT_EMAIL（アラート宛先 — **検証済み実メール**。未設定だと通知はスキップされる）、
# admin の OPS_ALERT_EMAIL（日次照合ドリフト通知の宛先）
# AUTH_DEV_GRANT は本番では**設定しない**（未設定 = fail close で dev グラント無効。
# dev では .dev.vars の AUTH_DEV_GRANT=true が有効化する）
```

## 4. リモート D1 マイグレーション → デプロイ
デプロイ順は **binding の参照先を先に**する: `notifier → glasses_management → admin → ops`。`admin` は `glasses_management` を service binding するため、初回を含めて必ず domain Worker の後にデプロイする。ops は notifier/admin（+ドメインサービス）を binding するため最後。

`wrangler.jsonc` の新サービスには、Terraform の実リソース ID を反映するまで意図的に placeholder が残る。したがって **main push ではデプロイを行わず**、notifier / glasses_management / admin は GitHub Actions の `workflow_dispatch` で `deploy_eyex_stack=true` を明示したときだけ順番に実行する。手動実行の直前に、Terraform apply、D1/KV/R2 の ID反映、secrets設定、`pnpm -r cf-typegen` を完了させること。

> `example_service` は雛形で**本番には決してデプロイされない**。EYEX の実サービスは
> `glasses_management` であり、admin の `GLASSES_MANAGEMENT` service binding は
> この Worker を参照する。
```sh
# deploy は pnpm の予約語なので必ず `run` を付ける。
# SPA サービスの `deploy` = vite build && wrangler deploy（ビルド出力の wrangler.json を自動使用）。
# notifier / ops の `deploy` は wrangler deploy のみ。
pnpm --filter @app/notifier run deploy
pnpm --filter @app/glasses_management run db:migrate:remote && pnpm --filter @app/glasses_management run deploy
pnpm --filter @app/admin run db:migrate:remote && pnpm --filter @app/admin run deploy
pnpm --filter @app/ops run deploy
```
`example_service` はテンプレの雛形（`new-service` のコピー元）であり、**本番にはデプロイしない**（CI の deploy matrix からも除外）。検証/e2e のみ対象とする。
CI（`.github/workflows/ci.yml` の `deploy-eyex-stack` job）は Actions から手動実行し、`deploy_eyex_stack` を true にした場合だけ notifier → glasses_management → admin の順で migrate→deploy する。placeholder のままこの入力を true にしてはならない。Cron（admin の日次照合 / ops のバックアップ・監視）は各 `wrangler.jsonc` の `triggers.crons` から deploy 時に構成される。

## ⚠️ 本番前に必ず潰すこと（テンプレの意図的な dev 設定）
- **`AUTH_DEV_GRANT` を本番 secrets/vars に入れない**（未設定 = dev グラント 404 fail close。`true` を入れると任意 org の JWT 発行 = 認証バイパスが開く）。実運用は `/api/auth/login` を使う。
- `INTERNAL_KEY` / `JWT_SECRET` / `AUTH_PEPPER` / `DOMAIN_AUTH_KEY` は高エントロピー値を `wrangler secret put` で設定（`.dev.vars` の dev 値はローカル専用でデプロイに載らない）。`DOMAIN_AUTH_KEY`（admin）と `ADMIN_DOMAIN_AUTH_KEY`（glasses_management）は同じ専用値にし、**`INTERNAL_KEY` や `JWT_SECRET` と共有しない**。**`INTERNAL_KEY` は全サービス同一**なのでローテーションは全サービス同時に。
- ops の `D1_EXPORT_API_TOKEN` は **D1:Read のみ**にスコープ（バックアップ export 専用・最小権限）。R2 バックアップバケットは非公開のまま運用する。**初回デプロイ後にリストア訓練を 1 回実施**（`docs/howto/restore.md`）。
- D1 / バックアップ R2 を消されたくない環境では Terraform の該当リソースに `lifecycle { prevent_destroy = true }` を足す。
