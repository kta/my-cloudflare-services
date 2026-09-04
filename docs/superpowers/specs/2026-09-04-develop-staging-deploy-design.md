# develop → staging 自動デプロイ設計（Terraform × Wrangler × GitHub Actions）

- 日付: 2026-09-04
- 状態: 承認待ち（設計）
- 対象: `infra/terraform/cloudflare/`, `.github/workflows/ci.yml`, 各 `services/*/wrangler.jsonc`, `Makefile`, `scripts/`

## 1. 目的

`develop` へ merge したら **staging 環境**へ自動デプロイし、`main` へ merge したら **production**
へ自動デプロイする。基盤リソース（D1 / KV / R2）は Terraform が両環境ぶん所有し、CI が
apply する。人間の手作業を最小にする。

現状は次のとおりで、いずれも自動化されていない。

- `ci.yml` は `pull_request` と `push: main` で `verify` を回すだけ。デプロイは
  `workflow_dispatch` の `deploy-eye-stack` のみ（人間がボタンを押す）。
- `infra/terraform/cloudflare/` は単一ルート・**ローカル state**（`terraform.tfstate` は存在しない）。
  backend の `s3` ブロックは README にコメントアウトのまま。
- 本番リソースの一部は Terraform 管理外。`services/admin/wrangler.jsonc` の D1 ID は実 UUID だが、
  `services/glasses_management/wrangler.jsonc` は placeholder（`00000000-...`）のまま。
- `wrangler.jsonc` に環境の区分（`env.*`）が無い。

## 2. 環境モデル

| | production | staging |
|---|---|---|
| ブランチ | `main` | `develop` |
| Worker 名 | `admin` / `glasses-management` / `notifier` | `admin-staging` / `glasses-management-staging` / `notifier-staging` |
| wrangler 設定 | 上位（トップレベル） | `env.staging` |
| 公開 | 現状のまま | `*.workers.dev` |
| Cron | `glasses-management` の日次 1 本 | **0 本** |
| GitHub Environment | `production` | `staging` |

### 2.1 なぜ上位を production のままにするか

Wrangler の名前付き環境は Worker 名に `-<env>` を自動で付ける。`env.production` を新設すると
本番 Worker が `admin-production` に**改名**され、既存のデプロイ・secrets・observability の
連続性が切れる。したがって **上位＝production のまま据え置き、`env.staging` だけを足す**。
`main` のデプロイは今までどおり `wrangler deploy`（環境指定なし）で走る。

### 2.2 staging の Cron を 0 本にする理由

Cron は Workers Free で**アカウント全体 5 トリガー**の共有枠（`docs/howto/free-tier-limits.md`）。
staging に日次 Cron を持たせると枠を 1 本食い、かつ staging の録音掃除ジョブが誰も見ていない
時間に動く。`env.staging` では `"triggers": { "crons": [] }` として明示的に切る。

### 2.3 バインディングは非継承

`vars` / `kv_namespaces` / `d1_databases` / `r2_buckets` / `services` は Wrangler の
**非継承キー**で、環境ごとに全部書き下ろす必要がある。service binding の `service` は自動で
サフィックスが付かないため、`env.staging` では明示的に `glasses-management-staging` /
`notifier-staging` / `admin-staging` を指す。

### 2.4 Vite プラグイン利用時の環境選択

`admin` / `glasses_management` は `@cloudflare/vite-plugin` を使うため、環境は `--env` ではなく
**`CLOUDFLARE_ENV` 環境変数**で決まる（ビルド時に「flattened deploy config」が生成され、
`wrangler deploy` はそれを検証する）。CI ではビルドとデプロイの両方に同じ値を渡す。

```sh
CLOUDFLARE_ENV=staging pnpm --filter @app/admin run deploy
```

`notifier` は Vite を通さないので `--env staging` でも `CLOUDFLARE_ENV` でも良いが、
**表記を `CLOUDFLARE_ENV` に統一**する。

## 3. Terraform 構成

### 3.1 ディレクトリ

```
infra/terraform/cloudflare/
  modules/substrate/     # 現 main.tf を var.name_suffix 付きで一般化
    main.tf variables.tf outputs.tf
  envs/production/       # name_suffix = ""      → admin, glasses_management, ...
    main.tf backend.tf variables.tf outputs.tf
  envs/staging/          # name_suffix = "_staging" / "-staging"
    main.tf backend.tf variables.tf outputs.tf
```

workspace ではなく**ルートディレクトリ分割**を採る。CI の staging job は
`envs/staging` に `cd` するので、**構造上 production の state に触れられない**。
workspace は選択ミスが本番を壊す経路になる。

### 3.2 命名

module 側は D1 / KV / R2 で許される文字が違うため、サフィックスを 2 つ受け取る。

| リソース | production | staging |
|---|---|---|
| D1 | `admin` / `glasses_management` | `admin_staging` / `glasses_management_staging` |
| KV | `admin-auth-rl` / `notifier-dedupe` / `glasses-management-short-lived` | 各々に `-staging` |
| R2 | `glasses-management-recordings` | `glasses-management-recordings-staging` |

### 3.3 State backend（R2）

```hcl
backend "s3" {
  bucket = "tfstate"
  key    = "cloudflare/staging.tfstate"   # production は cloudflare/production.tfstate
  region = "auto"
  endpoints = { s3 = "https://<ACCOUNT_ID>.r2.cloudflarestorage.com" }
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_region_validation      = true
  skip_requesting_account_id  = true
  skip_s3_checksum            = true
  use_path_style              = true
}
```

R2 には**ネイティブなロック機構が無い**ので、CI の `concurrency: deploy-<env>`
（`cancel-in-progress: false`）で apply を直列化する。`endpoints` にアカウント ID が入るため、
backend 設定は `-backend-config` で CI から注入する（ファイルにアカウント ID を書かない）。

state バケットは CI が `wrangler r2 bucket create tfstate` を冪等に呼んで用意する
（既存なら失敗を無視）。

### 3.4 本番リソースの取り込み（import）

production の D1 / KV / R2 の一部は Cloudflare 上に実在するが Terraform state に無い。
そのまま `apply` すると同名リソースを作りに行って壊れる。

`scripts/tf-import-existing.sh` を用意し、**apply の前に CI が実行**する。各リソースについて:

1. `terraform state show <addr>` が成功したら何もしない（冪等）。
2. 失敗したら Cloudflare API を名前で引いて ID を取得する。
   - D1: `GET /accounts/{account_id}/d1/database?name=<name>`
   - KV: `GET /accounts/{account_id}/storage/kv/namespaces`（title 一致）
   - R2: `GET /accounts/{account_id}/r2/buckets/<name>`（存在確認のみ）
3. 見つかったら `terraform import <addr> <import_id>` を実行する。
4. 見つからなければ何もしない（続く `apply` が新規作成する）。

import ID の形式は `<account_id>/<resource_id>`（R2 は `<account_id>/<bucket_name>`）を前提とするが、
**実装時に provider v5 のドキュメントで各リソースの `import` セクションを確認して確定させる**。
このスクリプトは staging でも同じロジックで動く（初回は何も見つからず apply が作る）。

## 4. wrangler.jsonc の変更

各サービスに `env.staging` を追加する。ID は Terraform 出力の実値をコミットして固定する。

例（`services/notifier/wrangler.jsonc`）:

```jsonc
{
  "name": "notifier",
  // ... 上位 = production（現状のまま）
  "env": {
    "staging": {
      "kv_namespaces": [{ "binding": "DEDUPE", "id": "<notifier_dedupe_kv_namespace_id (staging)>" }],
      "vars": { "MAIL_FROM": "" }
    }
  }
}
```

`glasses_management` の `env.staging` は D1 / KV / R2 / service bindings に加えて
`"triggers": { "crons": [] }` を持つ。`admin` の `env.staging` は
`"services": [{ "binding": "GLASSES_MANAGEMENT", "service": "glasses-management-staging" }]`。

### 4.1 ID のずれを検知する

CI は `terraform apply` の後に `terraform output -json` と `wrangler.jsonc` の値を突き合わせ、
**一致しなければ job を落とす**。突合先は環境で変わる — staging は `env.staging`、production は
上位（トップレベル）のバインディング。黙って別リソースへデプロイする事故を防ぐ。
初回はリソースが新規作成されて突合が落ちるので、出力された ID をコミットする（一度きり）。
`services/glasses_management/wrangler.jsonc` の production 側 D1 ID が placeholder のままなので、
production 初回はここでも落ちる。実値を入れて解消する。

## 5. CI ワークフロー

`.github/workflows/ci.yml` を次のように変える。

```yaml
on:
  pull_request: {}
  push:
    branches: [main, develop]
  workflow_dispatch: { ... 既存のまま ... }
```

`verify` job は変更しない（`pull_request` と両ブランチの push で走る）。

新しい `deploy` job:

- `if: github.event_name == 'push'`
- `needs: [verify]`
- `environment: ${{ github.ref_name == 'main' && 'production' || 'staging' }}`
- `concurrency: { group: deploy-${{ github.ref_name }}, cancel-in-progress: false }`
- `env.CLOUDFLARE_ENV`: `main` なら空（上位環境）、`develop` なら `staging`

手順:

1. checkout / pnpm / node / `pnpm install --frozen-lockfile`
2. `pnpm -r --if-present cf-typegen`
3. `hashicorp/setup-terraform`（バージョンはピン留め、SHA 指定）
4. state バケットの用意（`wrangler r2 bucket create tfstate` を冪等に）
5. `terraform init -backend-config=...`（`envs/<env>`）
6. `bash scripts/tf-import-existing.sh <env>`
7. `terraform apply -auto-approve`
8. Terraform 出力と `wrangler.jsonc` の ID を突合（不一致なら fail）
9. デプロイを依存順に。**各 Worker はデプロイしてから secrets を同期する**
   （未作成の Worker に `secret bulk` は打てないため。§11.3）:
    - `notifier` deploy → secrets 同期
    - `glasses_management`: `db:migrate:remote` → deploy → secrets 同期
    - `admin`: `db:migrate:remote` → deploy → secrets 同期
      （`glasses-management` への service binding があるため最後）
10. secrets 同期後、反映のために各 Worker を**もう一度 deploy はしない**
    — `wrangler secret` は Worker の新しいバージョンを作るので再デプロイは不要。
    ただし初回デプロイ直後の数十秒は secrets 未設定で fail-closed になる。

`db:migrate:remote` は環境ごとに DB 名が違うので、`--env` を効かせるか DB 名を引数化する。
package.json の script を `wrangler d1 migrations apply $D1_NAME --remote` の形にして、
環境変数で切り替える（実装時に wrangler の `--env` と `d1 migrations apply` の
組み合わせを実機で確認する）。

既存の `workflow_dispatch` 版 `deploy-eye-stack` は**残す**。初回投入・緊急時の手動経路として要る。

`e2e` job は現状どおり `workflow_dispatch` のみ（変更なし）。

## 6. Secrets

### 6.1 GitHub Environment secrets

| 名前 | production | staging | 用途 |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✓ | ✓ | wrangler / Terraform provider |
| `CLOUDFLARE_ACCOUNT_ID` | ✓ | ✓ | 同上 + backend endpoint |
| `R2_STATE_ACCESS_KEY_ID` | ✓ | ✓ | TF state backend（`AWS_ACCESS_KEY_ID` に写す） |
| `R2_STATE_SECRET_ACCESS_KEY` | ✓ | ✓ | 同上 |
| `WORKER_INTERNAL_KEY` | ✓ | ✓ | Worker secret `INTERNAL_KEY` |
| `WORKER_JWT_SECRET` | ✓ | ✓ | Worker secret `JWT_SECRET` |
| `WORKER_AUTH_PEPPER` | ✓ | ✓ | Worker secret `AUTH_PEPPER` |
| `WORKER_RESEND_API_KEY` | ✓ | （未設定） | notifier の送信手段 |

### 6.2 CI が Worker へ同期する

各 Worker のデプロイ直後に `wrangler secret bulk` で投入する。Worker secrets は Worker ごとに
独立なので、`admin-staging` は `admin` とは別の保管庫になる。これで staging はいつでも
作り直せる。値はワークフローのログに出さない（`secret bulk` は stdin から JSON を読む）。

Terraform には secrets を置かない（`secret_text` は state に載る）。ルール 11 に従う。

`AUTH_PEPPER` は**変えるとパスワードハッシュが全部無効になる**ので、一度決めたら固定する。
GitHub secret を後から書き換えないよう README に明記する。

### 6.3 staging では RESEND_API_KEY を設定しない

notifier は送信手段が未設定なら **fail close（502）** する設計（`docs/howto/notifications.md`）。
staging から本物のメールが飛ぶ事故を防ぐため、これを積極的に利用して未設定のままにする。
staging で通知経路を試したくなったら、Resend のテスト用キーを GitHub secret に足す。

### 6.4 ブートストラップ（人間の手作業）

`make bootstrap/ci` を追加する。`gh` CLI で:

1. GitHub Environment `staging` / `production` を作成（`gh api`）。
2. `WORKER_INTERNAL_KEY` / `WORKER_JWT_SECRET` / `WORKER_AUTH_PEPPER` を `openssl rand -hex 32`
   で生成し、`gh secret set --env <env>` で登録する。**値は人間が知る必要がない。**
3. `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / R2 アクセスキー 2 値は対話で受け取って登録。

**自動化できない唯一の作業**は、Cloudflare ダッシュボードで **R2 API トークンを 1 回発行**すること。
S3 互換 backend は Cloudflare API トークンでは認証できず、R2 のアクセスキー ID / シークレットが要る。
発行した 2 値を `make bootstrap/ci` に貼れば、以降は全部スクリプトが処理する。

## 7. 検証

Terraform と CI はユニットテストの対象外なので、`verify` job にゲートを足す。

- `terraform fmt -check -recursive infra/terraform`
- `terraform validate`（`envs/production` と `envs/staging` の両方）
- `CLOUDFLARE_ENV=staging wrangler deploy --dry-run`（各サービス。staging 構成の妥当性）

`pnpm check`（lint / knip / typecheck / combined test）は変更しない。
Knip の設定に新しいスクリプトが引っかからないか確認する。

## 8. 無料枠への影響（正直な代償）

staging は同じ Cloudflare アカウントに同居するので、**アカウント共有の枠を食う**。

| 枠 | 影響 |
|---|---|
| D1 日次 row read / write | **アカウント共有**。2026-09-01 から超過でクエリがエラーになる。staging の動作確認が本番の枠を消費する |
| Workers 100k req/日 | 共有 |
| R2 10GB | 共有。staging の `RECORDINGS` は運用で溜め込まないよう注意 |
| Cron 5 本/アカウント | staging は 0 本にするので消費しない |
| D1 500MB/DB | DB 単位なので影響なし |

staging を本番相当の負荷で回すと本番が止まりうる。**staging は手動確認とスモークに限る**。
負荷試験を回すなら Paid への移行判断が要る（ルール 10 の人間承認事項）。

## 9. ドキュメントの更新

- `docs/architecture/infra.md` — 2 環境モデル、TF ディレクトリ構成、state backend を反映
- `docs/howto/deploy.md` — develop/main のデプロイ経路、ブートストラップ手順、本番前チェックリスト
- `infra/terraform/cloudflare/README.md` — module + envs 構成、import スクリプト
- `AGENTS.md` — 「サービス境界」表に staging Worker 名を追記するかは実装時に判断

## 10. 実装しないと決めたもの（YAGNI）

- **staging への独自ドメイン / Cloudflare Access**: `*.workers.dev` で足りる。認証は各サービスが持つ。
- **PR ごとのプレビュー環境**: Worker とリソースが PR 数だけ増え、無料枠を食う。develop の 1 本で足りる。
- **Terraform による Worker / バインディング管理**: 1 リソース 1 オーナーの原則（`docs/architecture/infra.md`）を崩さない。
- **CI での e2e 実行**: 現行方針（`workflow_dispatch` のみ）を変えない。
- **staging の Cron**: §2.2 のとおり切る。

## 11. 未確定（実装時に実機／公式ドキュメントで確認する）

1. `terraform import` の ID 形式（cloudflare provider v5 の D1 / KV / R2 各リソース）。
2. `wrangler d1 migrations apply` と `--env` / `CLOUDFLARE_ENV` の組み合わせで、環境の
   `d1_databases` から DB 名が解決されるか。解決されないなら DB 名を引数で渡す。
3. `wrangler secret bulk` の `--env` 対応と、対象 Worker が未作成のときの挙動
   （初回は secrets 同期をデプロイ後に回す必要があるかもしれない）。
4. `wrangler r2 bucket create` が既存バケットに対して返す終了コード（冪等化の書き方）。
