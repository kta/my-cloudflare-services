# develop → staging / main → production 自動デプロイ設計

- 日付: 2026-09-04
- 状態: 承認済み（実装待ち）
- 対象: `infra/terraform/cloudflare/`, `.github/workflows/ci.yml`, 各 `services/*/wrangler.jsonc`,
  `services/*/package.json`, `services/admin/seed.mjs`, `packages/shared/`, `Makefile`, `scripts/`,
  `docs/howto/deploy.md`, `docs/architecture/infra.md`, `AGENTS.md`

## 1. 目的

`develop` へ merge したら **staging**、`main` へ merge したら **production** へ自動でデプロイする。
どちらも承認ゲートを置かず、verify が緑なら即座に出す。デプロイに要る値は **GitHub Environment
secrets を唯一の源泉**とし、それを経由しない限りデプロイが成立しないようにする。

## 2. 現状（実物を読んで確認した事実）

- `ci.yml` は `pull_request` と `push: [main]` で `verify` を回すだけ。デプロイは
  `workflow_dispatch` + `deploy_eye_stack == true` の `deploy-eye-stack` job のみ。
  **merge では発火しない**。`develop` は `push.branches` に入っていない。
- `infra/terraform/cloudflare/` は単一ルート・**ローカル state**（`terraform.tfstate` は存在しない）。
  backend の `s3` ブロックは `versions.tf` にコメントアウトのまま。
- **本番リソースの一部が Terraform 管理外**。`services/admin/wrangler.jsonc` の D1
  (`0388dd19-68f7-4d34-a5bb-818b84205548`) と KV (`ec31896881954c4aa932a4a72b1a08be`) は実 ID だが
  state に無い。`services/glasses_management/wrangler.jsonc` と `services/notifier/wrangler.jsonc`
  は placeholder（`00000000-…`）のまま。
- `wrangler.jsonc` に環境の区分（`env.*`）が無い。`routes` / `custom_domain` / `workers_dev` の
  指定も無く、**全 Worker が `*.workers.dev` で公開**される。
- **D1 の名前が 3 箇所にハードコード**されている（§6）。
- **`services/ops` が存在しない**。`AGENTS.md` と `docs/howto/deploy.md` は実在しない Worker を
  前提に書かれている（§12）。

## 3. 決定事項

| 論点 | 決定 |
|---|---|
| スコープ | staging と production を**一度に**有効化する |
| Terraform の実行者 | **CI が apply**（R2 state backend + 既存リソースの import） |
| 本番の承認ゲート | **置かない**（merge → verify 緑 → 即デプロイ） |
| staging のアクセス制御 | **Worker 内のゲートトークン必須**（Cloudflare Access は使えない — §7） |
| secrets の源泉 | **GitHub Environment secrets のみ**。手動 `wrangler secret put` は廃止 |

## 4. 環境モデル

| | production | staging |
|---|---|---|
| ブランチ | `main` | `develop` |
| Worker 名 | `admin` / `glasses-management` / `notifier` | `admin-staging` / `glasses-management-staging` / `notifier-staging` |
| wrangler 設定 | 上位（トップレベル）＝据え置き | `env.staging` を新設 |
| `CLOUDFLARE_ENV` | 空 | `staging` |
| GitHub Environment | `production` | `staging` |
| 承認ゲート | なし | なし |
| Cron | `glasses-management` の日次 1 本 | **0 本** |
| アクセス | `*.workers.dev` 素通り | `*.workers.dev` + **ゲートトークン必須** |
| seed | 初回のみ人間が実行 | **毎デプロイ**（冪等） |

### 4.1 なぜ上位を production のままにするか

Wrangler の名前付き環境は Worker 名に `-<env>` を自動で付ける。`env.production` を新設すると
本番 Worker が `admin-production` に**改名**され、既存のデプロイ・secrets・observability の
連続性が切れる。したがって **上位＝production のまま据え置き、`env.staging` だけを足す**。

### 4.2 staging の Cron を 0 本にする理由

Cron は Workers Free で**アカウント全体 5 トリガー**の共有枠（`docs/howto/free-tier-limits.md`）。
staging に日次 Cron を持たせると枠を 1 本食い、かつ staging の録音掃除ジョブが誰も見ていない
時間に動く。`env.staging` では `"triggers": { "crons": [] }` として明示的に切る。

### 4.3 バインディングは非継承

`vars` / `kv_namespaces` / `d1_databases` / `r2_buckets` / `services` / `triggers` は Wrangler の
**非継承キー**で、環境ごとに全部書き下ろす必要がある。service binding の `service` は自動で
サフィックスが付かないため、`env.staging` では明示的に `glasses-management-staging` /
`notifier-staging` / `admin-staging` を指す。

### 4.4 Vite プラグイン利用時の環境選択

`admin` / `glasses_management` は `@cloudflare/vite-plugin` を使うため、環境は `--env` ではなく
**`CLOUDFLARE_ENV` 環境変数**で決まる（ビルド時に flattened deploy config が生成され、
`wrangler deploy` はそれを検証する）。CI ではビルドとデプロイの両方に同じ値を渡す。
`notifier` は Vite を通さないが、**表記を `CLOUDFLARE_ENV` に統一**する。

```sh
CLOUDFLARE_ENV=staging pnpm --filter @app/admin run deploy
```

## 5. Terraform 構成

### 5.1 ディレクトリ

```
infra/terraform/cloudflare/
  modules/substrate/     # 現 main.tf を suffix 付きで一般化
    main.tf variables.tf outputs.tf
  envs/production/       # d1_suffix = ""        kv_r2_suffix = ""
    main.tf backend.tf variables.tf outputs.tf
  envs/staging/          # d1_suffix = "_staging" kv_r2_suffix = "-staging"
    main.tf backend.tf variables.tf outputs.tf
```

workspace ではなく**ルートディレクトリ分割**を採る。CI の staging job は `envs/staging` に
`cd` するので、**構造上 production の state に触れられない**。workspace は選択ミスが本番を
壊す経路になる。

### 5.2 命名

D1 はアンダースコア命名、KV / R2 はハイフン命名で許容文字が違うため、module はサフィックスを
2 つ受け取る。

| リソース | production | staging |
|---|---|---|
| D1 | `admin` / `glasses_management` | `admin_staging` / `glasses_management_staging` |
| KV | `admin-auth-rl` / `notifier-dedupe` / `glasses-management-short-lived` | 各々に `-staging` |
| R2 | `glasses-management-recordings`（`location = "apac"`） | 同 `-staging` |

### 5.3 State backend（R2）

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

`endpoints` にアカウント ID が入るため、backend 設定は `-backend-config` で CI から注入する
（ファイルにアカウント ID を書かない）。R2 には**ネイティブなロック機構が無い**ので、CI の
`concurrency: deploy-<branch>`（`cancel-in-progress: false`）で apply を直列化する。
state バケットは CI が `wrangler r2 bucket create tfstate` を冪等に呼んで用意する。

### 5.4 既存リソースの取り込み（import）

production の D1 / KV は Cloudflare 上に実在するが state に無い。そのまま `apply` すると
同名リソースを作りに行って壊れる。`scripts/tf-import-existing.sh <env>` を **apply の前に CI が
実行**する。各リソースについて:

1. `terraform state show <addr>` が成功したら何もしない（冪等）。
2. 失敗したら Cloudflare API を名前で引いて ID を取得する。
   - D1: `GET /accounts/{account_id}/d1/database?name=<name>`
   - KV: `GET /accounts/{account_id}/storage/kv/namespaces`（title 一致）
   - R2: `GET /accounts/{account_id}/r2/buckets/<name>`（存在確認のみ）
3. 見つかったら `terraform import <addr> <import_id>` を実行する。
4. 見つからなければ何もしない（続く `apply` が新規作成する）。

staging でも同じロジックがそのまま動く（初回は何も見つからず apply が作る）。
**import ID の形式は実装時に provider v5 のドキュメントで確認して確定させる**（§15-1）。

### 5.5 ID の突合

`terraform apply` の後、`terraform output -json` と `wrangler.jsonc` の値を突き合わせ、
**一致しなければ job を落とす**。突合先は環境で変わる — staging は `env.staging`、production は
上位（トップレベル）のバインディング。黙って別リソースへデプロイする事故を防ぐ唯一の関所である。

この突合は D1 / KV / R2 の全バインディングを対象とする一般の関所で、CI の 1 ステップとして
`terraform apply` の直後に走る。D1 についてはこれに加えて、`scripts/d1-migrate.mjs` が
マイグレーション適用の直前にもう一度同じ検証を行う（§6.1）。二重にするのは、マイグレーションだけが
取り返しのつかない操作だからである。

**初回の鶏と卵**: リソースが新規作成された初回は突合が落ちる。出力された ID をコミットして
解消する（一度きり）。`glasses_management` と `notifier` の production 側も placeholder のままなので、
**production の初回もここで落ちる**。実値を入れて解消する。

## 6. D1 マイグレーションと seed の安全化（最大の事故ポイント）

D1 の名前がハードコードされている箇所は、数え直すと **3 箇所ではなく 6 箇所**だった。
`glasses_management/seed.mjs` が当初この表から漏れており、`db:migrate:remote` は全サービスにある。

| 箇所 | 直書きだった値 | 本番に出るか | 塞ぎ方 |
|---|---|---|---|
| `services/admin/seed.mjs` | `wrangler d1 execute admin --remote` | 出る | `resolveSeedTarget` |
| `services/glasses_management/seed.mjs` | `wrangler d1 execute glasses_management --remote` | 出る | `resolveSeedTarget` |
| `services/admin/package.json` の `db:migrate:remote` | `wrangler d1 migrations apply admin --remote` | 出る | `scripts/d1-migrate-manual.mjs` |
| `services/glasses_management/package.json` の同 | `wrangler d1 migrations apply glasses_management --remote` | 出る | 同上 |
| `services/example_service/package.json` の同 | `wrangler d1 migrations apply example_service --remote` | 出ない（雛形） | 同上 |
| `services/patent_research/package.json` の同 | `wrangler d1 migrations apply patent_research --remote` | 出ない（ローカル完結） | 同上 |

このまま `develop` の CI を有効にすると、**staging のデプロイが production の D1 に
マイグレーションと seed を当てる**。seed は `INSERT OR IGNORE` で冪等なため静かに成功し、
気づけない。ここを塞がずに自動化してはならない。

塞ぎ方は経路で 3 つに分かれる。**CI** は §6.1 のラッパー（`scripts/d1-migrate.mjs`）で、
Terraform 出力との突合まで通す。**seed** は `resolveSeedTarget`（`scripts/lib/wrangler-config.mjs`）。
**人が手で叩く `db:migrate:*`** は `scripts/d1-migrate-manual.mjs` で、同じ解決を通して
宛先を必ず印字する（手元には Terraform state が無いのが普通なので、突合は持たない）。
宛先の決め方が 1 か所に閉じたので、DB 名を二重管理する場所は無くなった。

**残っている非対称**: `deploy-eye-stack` job は `db:migrate:remote` を呼んでおり、
宛先は正しくなったが **Terraform 出力との ID 突合は通らない**。逃げ道のほうが関所が
少ないのは、緊急時ほど間違えるという点で逆立ちしている。あの job を残すかどうかは
別途の判断とする（通常の `main` push は `deploy` job が同じことを、関所付きで行う）。

### 6.1 採用案 — ラッパースクリプト

`scripts/d1-migrate.mjs <service> <env>` を追加する。このスクリプトが:

1. `services/<service>/wrangler.jsonc` から、指定環境の `database_name` と `database_id` を読む
   （`env` 未指定なら上位、`staging` なら `env.staging`）。
2. `terraform output -json` の対応する値と**一致することを確かめる**（§5.5 の突合をここに統合）。
3. 一致したときだけ `wrangler d1 migrations apply <database_name> --remote` を実行する。

不採用にした案:

- **環境変数で名前を渡す** — 単純だが、既定値を置くと事故が復活し、渡し忘れが静かに本番へ当たる。
- **wrangler の `--env` に任せる** — 引数の DB 名は結局書く必要があり、二重管理が残る。

採用理由は 3 つ。人が DB 名を二重管理しない。ID 突合を適用の直前に置けるので取り違えが構造的に
起きない。seed も同じ経路に乗せられる。

jsonc（コメント付き JSON）のパースは依存を増やさず**テスト可能な純関数**として書く。文字列
リテラル内の `//` や `/*` を誤除去しないことを境界値テストで担保する。`@cloudflare/vite-plugin`
がビルド時に出す flattened config を使う手もあるので、実装時にどちらが確実か実機で確かめる（§15-2）。

### 6.2 seed

`services/admin/seed.mjs` の `wrangler d1 execute admin` を、§6.1 が解決した名前に置き換える。

staging は dev グラント無しの fail close なので、**admin ユーザーがいないとログインできない**。
seed は冪等なので staging では毎デプロイ実行してよい。`AUTH_PEPPER` は GitHub secret
`WORKER_AUTH_PEPPER` から、`ADMIN_PASSWORD` は `WORKER_STAGING_ADMIN_PASSWORD` から渡す。
production では**回さない**（初回だけ人間が実行する現行方針を維持する）。

### 6.3 デプロイ順と失敗時

`notifier` → `glasses_management` → `admin` の直列。service binding は参照先の Worker が先に
存在している必要があるため、この順序は動かせない。各サービスは **deploy → secrets 同期**の順
（未作成の Worker には `secret bulk` を打てない）。

**ただし順序だけでは初回が通らない。** `glasses_management` は `/api/auth/login` を admin へ
委譲するため `ADMIN` を、`admin` は org 同期のため `GLASSES_MANAGEMENT` を張っており、参照は
**相互**である。閉路には始点が無いので、どちらを先に置いても初回は
`Service binding 'ADMIN' references Worker 'admin-staging' which was not found.` で落ちる。

そこでチェーンの前に `pnpm run bootstrap:workers`（`scripts/bootstrap-workers.mjs`）を挟む。
参照先の Worker がアカウントに無いときだけ、**バインディングを持たない空の Worker**（503 を返す
だけ）を先に置いて閉路を切る。直後に本物のデプロイが同じ名前を上書きするので、踏み台が残るのは
数十秒である。**既に実在する Worker には触らない** — 触ると生きた Worker からバインディングを
剥がしてしまい、後続が失敗した瞬間にサービスが止まる。したがって 2 回目以降は no-op になる。

**ロールバックはしない。** D1 マイグレーションは戻せず、Worker だけ戻すと整合しない。前方修正が
方針である。ただしこの順序を守る限り、途中で失敗しても「新しい Worker がまだ出ていない」だけで、
既存の本番は動き続ける。

## 7. staging ゲート

`*.workers.dev` は URL を知っていれば誰でも叩ける。**Cloudflare Access は使えない** — 本番も
staging も独自ドメインを持たず（`routes` / `custom_domain` の指定が無い）、Access は自分の zone の
ホスト名にしか適用できないためである。ドメインの持ち込みは別の承認事項とする。

代わりに `packages/shared/src/staging-gate.ts` に Hono ミドルウェアを 1 本置く。

- `env.STAGING_ACCESS_TOKEN` が未設定なら**即座に `next()`**。production ではこの分岐が死ぬ。
- `/api/internal/*` は対象外（service binding は `x-internal-key` が守る）。
- Cookie `staging_gate` の値が一致 → 通す。
- `?gate=<token>` が一致 → `HttpOnly; Secure; SameSite=Lax; Max-Age=30d` の Cookie を発行し、
  クエリを除いた同 URL へ 302。
- どちらも無ければ `401`。本文は最小限にし、トークンの存在をヒントにしない。
- 比較は**定数時間**で行う（長さの差でも早期 return しない）。

`admin` と `glasses_management` の Worker エントリで、他のどのミドルウェアより先に置く。

## 8. CI ワークフロー

`.github/workflows/ci.yml` の変更は 3 点。

```yaml
on:
  pull_request: {}
  push:
    branches: [main, develop]
  workflow_dispatch: { ... 既存のまま ... }
```

`verify` job は §11 のゲートを足す以外は変えない。

新しい `deploy` job:

- `if: github.event_name == 'push'`
- `needs: [verify]`
- `environment: ${{ github.ref_name == 'main' && 'production' || 'staging' }}`
- `concurrency: { group: deploy-${{ github.ref_name }}, cancel-in-progress: false }`
- `env.CLOUDFLARE_ENV`: `main` なら空（上位環境）、`develop` なら `staging`

手順:

1. checkout / pnpm / node / `pnpm install --frozen-lockfile`
2. **preflight**（`scripts/deploy-preflight.sh`）— ブランチ / `CLOUDFLARE_ENV` / Environment 名の
   3 つが整合しているか検証し、ずれていたら即 fail（`develop` なのに `CLOUDFLARE_ENV` が空、
   のような取り違えを構造的に殺す）。続けて必須 secrets の非空を検証し、1 つでも欠けたら
   `terraform` にも `wrangler` にも進まない。スクリプトはリポジトリ内にあるので checkout の後に置く。
3. `pnpm -r --if-present cf-typegen`
4. `hashicorp/setup-terraform`（SHA でピン留め）
5. state バケットの用意（`wrangler r2 bucket create tfstate` を冪等に）
6. `terraform init -backend-config=...`（`envs/<env>`）
7. `bash scripts/tf-import-existing.sh <env>`
8. `terraform apply -auto-approve`
9. Terraform 出力と `wrangler.jsonc` の ID を突合（不一致なら fail）
10. デプロイを依存順に。各 Worker は **deploy → `wrangler secret bulk`** の順:
    - `notifier` deploy → secrets 同期
    - `glasses_management`: `scripts/d1-migrate.mjs` → deploy → secrets 同期
    - `admin`: `scripts/d1-migrate.mjs` → deploy → secrets 同期 → （staging のみ）seed
11. secrets 同期後に再デプロイはしない（`wrangler secret` は Worker の新しいバージョンを作る）。
    ただし初回デプロイ直後の数十秒は secrets 未設定で fail-closed になる。

既存の `workflow_dispatch` 版 `deploy-eye-stack` は**残す**。緊急時の手動経路として要る。
`e2e` job は現状どおり `workflow_dispatch` のみ（変更なし）。

## 9. Secrets — 源泉と強制

**GitHub Environment secrets が唯一の源泉**とし、値がリポジトリにも開発者の手元にも存在しない
状態を作る。

| 名前 | production | staging | 用途 |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✓ | ✓ | Terraform provider + wrangler |
| `CLOUDFLARE_ACCOUNT_ID` | ✓ | ✓ | 同上 + backend endpoint |
| `R2_STATE_ACCESS_KEY_ID` | ✓ | ✓ | TF state backend（`AWS_ACCESS_KEY_ID` に写す） |
| `R2_STATE_SECRET_ACCESS_KEY` | ✓ | ✓ | 同上 |
| `WORKER_INTERNAL_KEY` | ✓ | ✓ | Worker secret `INTERNAL_KEY`（全サービス同一値） |
| `WORKER_JWT_SECRET` | ✓ | ✓ | Worker secret `JWT_SECRET`（発行側と検証側で同一値） |
| `WORKER_AUTH_PEPPER` | ✓ | ✓ | Worker secret `AUTH_PEPPER`（admin のみ） |
| `WORKER_DOMAIN_AUTH_KEY` | ✓ | ✓ | admin の `DOMAIN_AUTH_KEY` / glasses_management の `ADMIN_DOMAIN_AUTH_KEY` |
| `WORKER_STAGING_ACCESS_TOKEN` | **入れない** | ✓ | §7 のゲート |
| `WORKER_STAGING_ADMIN_PASSWORD` | **入れない** | ✓ | §6.2 の seed |
| `WORKER_RESEND_API_KEY` | ✓ | **入れない** | notifier の送信手段 |

強制は 3 段で効かせる。

1. **preflight** — 必須 secrets が空なら job を落とす（§8-1）。
2. **同期** — deploy 直後に `wrangler secret bulk` へ stdin で流し込む。値はログに出さない。
3. **アプリ側の fail close** — 既存設計のまま。`INTERNAL_KEY` 無しで internal API 401、
   `JWT_SECRET` 無しで認証不可、`MAIL_FROM` / `RESEND_API_KEY` 無しで送信 502。
   secrets を経ずに出た Worker は動かない。

**保証できないこと（正直に）**: Cloudflare API トークンを手元に持つ人が `wrangler deploy` を
打つことは Cloudflare 側の仕組みでは止められない。実効的な強制は「**デプロイ用トークンを
ローカルに置かない**」運用に倒すことである。`docs/howto/deploy.md` から手動デプロイ手順と
`wrangler secret put` 手順を削り、ローカルで基盤 Terraform を触るときだけその場限りで
トークンを渡す形にする。

### 9.1 変えてはいけない値

`AUTH_PEPPER` は**変えると既存パスワードハッシュが全部無効**になる。一度決めたら固定し、
GitHub secret を後から書き換えない。`INTERNAL_KEY` は全サービス同一値なので、
ローテーションするときは全サービス同時に行う。

### 9.2 staging では RESEND_API_KEY を設定しない

notifier は送信手段が未設定なら **fail close（502）** する（`docs/howto/notifications.md`）。
staging から本物のメールが飛ぶ事故を防ぐため、これを積極的に利用して未設定のままにする。

### 9.3 Terraform に secrets を置かない

`secret_text` は state に載る。ルール 11 に従い、Terraform は基盤リソースだけを持つ。

## 10. ブートストラップ（人間の手作業）

`make bootstrap/ci` を追加する。`gh` CLI で:

1. GitHub Environment `staging` / `production` を作成（`gh api`）。
2. `WORKER_INTERNAL_KEY` / `WORKER_JWT_SECRET` / `WORKER_AUTH_PEPPER` /
   `WORKER_DOMAIN_AUTH_KEY` / `WORKER_STAGING_ACCESS_TOKEN` /
   `WORKER_STAGING_ADMIN_PASSWORD` を `openssl rand -hex 32` で生成し、
   `gh secret set --env <env>` で登録する。**値は人間が知る必要がない。**
3. `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / R2 アクセスキー 2 値 /
   `WORKER_RESEND_API_KEY` は対話で受け取って登録する。

**自動化できない唯一の作業**は、Cloudflare ダッシュボードで **R2 API トークンを 1 回発行**する
こと。S3 互換 backend は Cloudflare API トークンでは認証できず、R2 のアクセスキー ID /
シークレットが要る。発行した 2 値を `make bootstrap/ci` に渡せば、以降はスクリプトが処理する。

Cloudflare API トークンの権限は `docs/howto/deploy.md` のとおり **Workers Scripts / D1 /
Workers KV Storage / Workers R2 Storage の Edit + Account Settings Read**（Queues は不要）。

## 11. 検証・テスト

Terraform と CI はユニットテストの対象外なので、`verify` job にゲートを足す。

- `terraform fmt -check -recursive infra/terraform`
- `terraform validate`（`envs/production` と `envs/staging` の両方）
- `CLOUDFLARE_ENV=staging wrangler deploy --dry-run`（各サービス。staging 構成の妥当性）

TDD の対象になるコードは 2 つ。

1. **`scripts/d1-migrate.mjs`** — jsonc パーサ（文字列リテラル内の `//` `/*` を誤除去しない）と
   環境解決（`env` 未指定 → 上位 / `staging` → `env.staging`）、突合の不一致で必ず落ちること。
2. **`packages/shared/src/staging-gate.ts`** — `permissions.test.ts` の表駆動に 1 ブロック追加する。
   未設定時に素通りすること、Cookie 一致で通ること、`?gate=` からの Cookie 発行、
   不一致・欠落で 401、`/api/internal/*` が対象外、**未知パスも 401**（default-deny の証明）。

`pnpm check`（lint / knip / typecheck / combined test）の内容は変えない。Knip の設定に新しい
スクリプトが引っかからないか確認する。

## 12. 付随して直すもの

- **`services/ops` が存在しない**。`AGENTS.md` のサービス境界表、`docs/howto/deploy.md` の
  デプロイ順・secrets 手順、`docs/howto/restore.md` が実在しない Worker を前提に書かれている。
  今回は**ドキュメント側を実態に合わせる**。ops の新規実装は別件（ルール 10 の承認事項）。
- `docs/howto/deploy.md` を「GitHub secrets が源泉、手動 `wrangler secret put` は廃止、
  デプロイは merge で自動」に全面改稿する。
- `docs/architecture/infra.md` に 2 環境モデル・TF ディレクトリ構成・state backend を反映する。
- `infra/terraform/cloudflare/README.md` を module + envs 構成と import スクリプトに合わせる。
- `AGENTS.md` のサービス境界表に staging Worker 名を追記する。

## 13. 無料枠への影響（正直な代償）

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

## 14. 実装しないと決めたもの（YAGNI）

- **staging への独自ドメイン / Cloudflare Access**: §7 のゲートで足りる。
- **PR ごとのプレビュー環境**: Worker とリソースが PR 数だけ増え、無料枠を食う。
- **Terraform による Worker / バインディング管理**: 1 リソース 1 オーナーの原則を崩さない。
- **CI での e2e 実行**: 現行方針（`workflow_dispatch` のみ）を変えない。
- **staging の Cron**: §4.2 のとおり切る。
- **デプロイのロールバック**: §6.3 のとおり前方修正で対応する。

## 15. 未確定（実装時に実機／公式ドキュメントで確認する）

1. `terraform import` の ID 形式（cloudflare provider v5 の D1 / KV / R2 各リソース）。
2. `wrangler.jsonc` から環境ごとの `database_name` / `database_id` を得る方法として、
   自前の jsonc パーサと `@cloudflare/vite-plugin` の flattened config のどちらが確実か。
3. `wrangler secret bulk` の `--env` 対応と、stdin から JSON を渡す正確な形式。
4. `wrangler r2 bucket create` が既存バケットに対して返す終了コード（冪等化の書き方）。
5. `wrangler d1 migrations apply` に `--env` を付けたときの DB 名解決の挙動（§6.1 の前提確認）。
