# デプロイ手順（runbook）

各サービスは **1 Worker が SPA と API を同一オリジンで配信**する。旧来の「SPA と API が別オリジン」に伴う CORS / `VITE_API_URL` の設定は存在しない。**Queue は一切使わない**（無料枠方針 — AGENTS.md ルール 9）。非同期通知は notifier の同期送信 API（`POST /api/internal/send`）に service binding で送る。

## デプロイは merge で起きる

| ブランチ | 環境 | Worker 名 | GitHub Environment |
|---|---|---|---|
| `develop` | staging | `admin-staging` / `glasses-management-staging` / `notifier-staging` | `staging` |
| `main` | production | `admin` / `glasses-management` / `notifier` | `production` |

merge すると `.github/workflows/ci.yml` の `verify` が走り、緑なら `deploy` job が続く。**承認ゲートは無い**。手で叩く経路は Actions の `workflow_dispatch`（`deploy-eye-stack`）だけで、これは緊急時用に残してある。

`deploy` job は次の順で動く。

1. **preflight** — ブランチ / `CLOUDFLARE_ENV` / Environment 名 / 必須 secrets を確認する。1 つでも噛み合わなければ、Terraform も wrangler も走らせずに落ちる。
2. Terraform（`envs/<env>`）を init → 既存リソースの import → apply。
3. **binding 突合** — Terraform 出力と `wrangler.jsonc` の ID が一致するか。ずれていたら落ちる。
4. `notifier` → `glasses_management` → `admin` の順に、**deploy してから secrets を同期**。service binding は参照先が先に存在している必要があり、未作成の Worker には secret を打てないため、この順序は動かせない。
5. staging だけ admin の seed を流す（冪等）。

**ロールバックはしない。** D1 マイグレーションは戻せず、Worker だけ戻すと整合しない。前方修正が方針である。ただしこの順序を守る限り、途中で失敗しても「新しい Worker がまだ出ていない」だけで、既存の環境は動き続ける。

## secrets は GitHub Environment が唯一の源泉

**`wrangler secret put` を手で叩く運用は廃止した。** 値はリポジトリにも開発者の手元にも置かない。

| 名前 | production | staging | 用途 |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✓ | ✓ | Terraform provider + wrangler |
| `CLOUDFLARE_ACCOUNT_ID` | ✓ | ✓ | 同上 + state backend endpoint |
| `R2_STATE_ACCESS_KEY_ID` | ✓ | ✓ | TF state backend（S3 互換） |
| `R2_STATE_SECRET_ACCESS_KEY` | ✓ | ✓ | 同上 |
| `WORKER_INTERNAL_KEY` | ✓ | ✓ | `INTERNAL_KEY`（**全サービス同一値**） |
| `WORKER_JWT_SECRET` | ✓ | ✓ | `JWT_SECRET`（発行側 admin と検証側で同一値） |
| `WORKER_AUTH_PEPPER` | ✓ | ✓ | `AUTH_PEPPER` |
| `WORKER_DOMAIN_AUTH_KEY` | ✓ | ✓ | admin の `DOMAIN_AUTH_KEY` / glasses_management の `ADMIN_DOMAIN_AUTH_KEY` |
| `WORKER_STAGING_ACCESS_TOKEN` | **入れない** | ✓ | staging ゲート |
| `WORKER_STAGING_ADMIN_PASSWORD` | **入れない** | ✓ | staging の seed |
| `WORKER_RESEND_API_KEY` | ✓ | **入れない** | notifier の送信手段 |

「入れない」欄は preflight が**混入を検出して落とす**。本番に staging の抜け道を持ち込ませないため、また staging から実メールを飛ばさないため（notifier は送信手段が未設定なら fail close する）。

### 変えてはいけない値

`AUTH_PEPPER` は**変えると既存パスワードハッシュが全部無効**になる。一度決めたら固定する。`INTERNAL_KEY` は全サービス同一値なので、ローテーションは全サービス同時に行う。

### 設定する

```sh
make bootstrap/ci
```

`WORKER_*` は `openssl rand -hex 32` で生成され、**人は値を知らなくてよい**。既にある値は上書きしない。対話で聞かれるのは Cloudflare の API トークン / アカウント ID / R2 アクセスキー 2 値 / Resend キーだけ。

**人の手が要るのは Cloudflare ダッシュボードでの発行だけ**である。

1. **Cloudflare API トークン** — `dash.cloudflare.com/profile/api-tokens` → Create Token → Custom token。権限は Account の **Workers Scripts / D1 / Workers KV Storage / Workers R2 Storage を Edit、Account Settings を Read**（Queues は不要）。
2. **R2 API トークン** — R2 → Manage R2 API Tokens → Object Read & Write。S3 互換 backend は Cloudflare の API トークンでは認証できないので、これが別に要る。

## 初回に必ず落ちるところ

`wrangler.jsonc` の D1 / KV / R2 の ID は、Terraform を回すまで確定しない。`glasses_management` と `notifier` の production 側、および全サービスの `env.staging` は **placeholder（`00000000-…`）** のままである。

初回の deploy は binding 突合が次のように落ちる。

```
❌ notifier: DEDUPE が placeholder のままです (00000000000000000000000000000000)。
   Terraform 出力 notifier_dedupe_kv_namespace_id の実値に差し替えてください
```

Actions のログから `terraform apply` の出力を読み、対応する `wrangler.jsonc` に実値を入れてコミットする。**一度きり**の作業である。

手元で確かめるなら:

```sh
node scripts/check-binding-ids.mjs admin glasses_management notifier \
  --env staging --tf-output tf-output.json
```

## staging に入る

staging は `*.workers.dev` で公開されるため、URL を知っていれば誰でも叩ける。独自ドメインを持たず Cloudflare Access を掛けられないので、Worker の中でトークンを要求している。

```
https://admin-staging.<subdomain>.workers.dev/?gate=<WORKER_STAGING_ACCESS_TOKEN>
```

一致すると `HttpOnly` Cookie（30 日）が発行され、以後はトークン無しで開ける。`/api/internal/*` は対象外で、これは service binding の正規経路を `x-internal-key` が守っているためである。

production には `STAGING_ACCESS_TOKEN` を設定しないので、このゲートは**分岐ごと死ぬ**。

## ローカルから触るとき

デプロイ用トークンを手元に常設しない。基盤 Terraform をローカルで触る必要が出たときだけ、その場限りで渡す。

```sh
read -rs CF_TOKEN   # 貼り付けて Enter
CLOUDFLARE_API_TOKEN=$CF_TOKEN terraform -chdir=infra/terraform/cloudflare/envs/staging plan
```

## ⚠️ 本番前に必ず潰すこと

- **`AUTH_DEV_GRANT` を本番 secrets/vars に入れない**（未設定 = dev グラント 404 fail close。`true` を入れると任意 org の JWT 発行 = 認証バイパスが開く）。実運用は `/api/auth/login` を使う。
- `MAIL_FROM` は secret ではなく `services/notifier/wrangler.jsonc` の `vars` に置く。Resend は from ドメインの検証が要るので**検証済み運用ドメイン**を入れる。空のままだと notifier は Resend を呼ばずに fail close する。
- `example_service` は雛形なので**本番にデプロイしない**（CI の deploy 対象外）。EYE の実サービスは `glasses_management` である。
- D1 / バックアップ R2 を消されたくない環境では、Terraform の該当リソースに `lifecycle { prevent_destroy = true }` を足す。

## まだ無いもの

**`services/ops` は存在しない。** D1 バックアップ（R2 への世代保存）・鮮度/容量/死活監視・リストア訓練は、設計だけがあって実装されていない。`docs/howto/restore.md` と `AGENTS.md` の ops に関する記述は将来の姿であり、現状の運用手順ではない。バックアップが要る段階になったら別途起こす（ルール 10 の承認事項）。
