# Terraform — Cloudflare substrate

`cloudflare/cloudflare ~> 5`. Provisions the **stateful** resources (D1, KV, R2)
for **two environments**. Worker **code + bindings** are deployed by Wrangler —
Terraform and Wrangler each own a resource exactly once to avoid drift.
**No Queues**: they are available on the free plan (since 2026-02), but this
template deliberately does not use them — notifications go through the notifier's
sync send API instead (see `docs/howto/notifications.md`).

## Layout

```
modules/substrate/     # リソース定義。名前の接尾辞で環境を分ける
envs/production/       # d1_suffix = ""        kv_r2_suffix = ""
envs/staging/          # d1_suffix = "_staging" kv_r2_suffix = "-staging"
```

環境ごとに root を分けてある。CI の staging job は `envs/staging` に `cd` するので、
**構造として production の state に触れられない**。workspace は選択ミスがそのまま
本番を壊す経路になるので採らない。

D1 はアンダースコア、KV / R2 はハイフンで命名の慣習が違うため、module は接尾辞を
2 つ受け取る。

| リソース | production | staging |
|---|---|---|
| D1 | `admin` / `glasses_management` | `admin_staging` / `glasses_management_staging` |
| KV | `admin-auth-rl` / `notifier-dedupe` / `glasses-management-short-lived` | 各々に `-staging` |
| R2 | `glasses-management-recordings` | 同 `-staging` |

## Division of responsibility

| Owner | Resources |
|---|---|
| **Terraform** (here) | D1 databases, KV namespaces, R2 bucket |
| **Wrangler** (each `wrangler.jsonc`) | Worker code, bindings, cron triggers |
| **GitHub Environment secrets** | すべての secret（`wrangler secret bulk` で CI が同期） |

## 誰が apply するか

**CI が apply する。** `develop` / `main` への push で `.github/workflows/ci.yml` の
`deploy` job が `envs/<env>` を init → import → apply し、出力を `wrangler.jsonc` と
突き合わせてからデプロイに進む。

> **Prereq**: a brand-new Cloudflare account must enable R2 once (dashboard → R2 →
> accept terms) before `terraform apply`, or the `cloudflare_r2_bucket` resources fail.

## 既存リソースの取り込み

`admin` の D1 と KV は Cloudflare 上に実在するのに state に無い。素の `apply` は
同名リソースを作りに行って壊れるため、`import-existing.sh` を apply の前に必ず通す。
冪等で、state 済みは触らず、見つからないものは何もしない（apply が作る）。

import ID の形式は provider v5 の docs で確認済み。

| リソース | ID 形式 |
|---|---|
| `cloudflare_d1_database` | `<account_id>/<database_id>` |
| `cloudflare_workers_kv_namespace` | `<account_id>/<namespace_id>` |
| `cloudflare_r2_bucket` | `<account_id>/<bucket_name>/<jurisdiction>` |

R2 だけ 3 要素であることに注意。

## State backend (R2)

`backend "s3"` を R2 に向ける。`endpoints` にアカウント ID が入るので、値はファイルに
書かず CI から `-backend-config` で注入する。R2 は S3 互換（`region = "auto"`,
path-style, skip flags）だが **ネイティブなロックが無い** — CI の
`concurrency: deploy-<branch>`（`cancel-in-progress: false`）で apply を直列化する。

state バケット（`tfstate`）は CI が `wrangler r2 bucket create` を冪等に呼んで用意する。
backend の認証には R2 のアクセスキー（`R2_STATE_ACCESS_KEY_ID` /
`R2_STATE_SECRET_ACCESS_KEY`）が要る。Cloudflare の API トークンでは認証できない。

## ローカルから触るとき

デプロイ用トークンを手元に常設しない。その場限りで渡す。

```sh
read -rs CF_TOKEN   # 貼り付けて Enter
CLOUDFLARE_API_TOKEN=$CF_TOKEN AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
  terraform -chdir=envs/staging plan
```

`terraform.tfvars` はローカル専用（gitignore 対象）。CI は
`TF_VAR_cloudflare_account_id` を GitHub secret から渡す。

## Secrets

Terraform には置かない — `secret_text` bindings would land in TF state.
値の源泉は GitHub Environment secrets で、CI が各 Worker のデプロイ直後に
`wrangler secret bulk` で流し込む（`docs/howto/deploy.md`）。
