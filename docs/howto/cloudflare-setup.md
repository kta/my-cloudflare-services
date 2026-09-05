# Cloudflare 初期設定（一度だけ）

**ローカルで動かすだけなら Cloudflare アカウントは不要**（`make dev/*`・test・e2e はすべてローカルの workerd で動く）。ここは「インターネットに公開する」ときに一度だけ必要な作業である。

デプロイそのもの（順序・secrets の全量・トークンの発行手順・本番前チェック）は [`deploy.md`](./deploy.md) にある。この文書は**まだ何も無い状態から deploy.md に入るまでの橋渡し**だけを書く。

## 全体像

デプロイは **merge で自動に起きる**。`develop` へ merge したら staging、`main` へ merge したら production。手で `wrangler deploy` を叩く運用は無く、そのためのローカル手順も用意していない（本番トークンを手元に常設させないための意図的な欠落）。

したがって初期設定でやることは 2 つだけである。

1. Cloudflare のアカウントを作る
2. GitHub Environment に secrets を入れる（`make bootstrap/ci`）

リソース（D1 / KV / R2）は **CI が Terraform で作る**。手で作る必要はない。

## 1. アカウント

https://dash.cloudflare.com/sign-up （**Free プランのままで全機能動く**）

**R2 を一度有効にしておく**（ダッシュボード → R2 Object Storage → 利用開始）。Terraform state を R2 に置くので、有効化前に apply すると `cloudflare_r2_bucket` が失敗する。無料枠でもクレジットカードの登録を求められることがあるが、この構成では課金は発生しない。

## 2. secrets を入れる

トークン 2 枚の発行手順、`make bootstrap/ci` の使い方、確認コマンドは
**[`deploy.md` の「secrets は GitHub Environment が唯一の源泉」](./deploy.md#secrets-は-github-environment-が唯一の源泉)** に全部ある。そちらへ。

要点だけ:

- Cloudflare の API トークン（デプロイ用）と R2 のアクセスキー（state 用）の **2 枚**が要る。R2 は S3 互換なので Cloudflare の API トークンでは認証できない。
- `INTERNAL_KEY` / `JWT_SECRET` / `AUTH_PEPPER` などは**自動生成**される。人が値を知る必要はない。
- GitHub Environment (`staging` / `production`) も `make bootstrap/ci` が作る。

## 3. 初回は必ず一度落ちる

`services/*/wrangler.jsonc` の D1 / KV / R2 の id は、Terraform を回すまで確定しない。placeholder（`00000000-…`）のままなので、初回の deploy は binding 突合で止まる。

Actions のログに出る `terraform apply` の出力を読み、対応する id を `wrangler.jsonc` に書いてコミットする。**一度きり**の作業である。詳しくは [`deploy.md` の「初回に必ず落ちるところ」](./deploy.md#初回に必ず落ちるところ)。

## ローカルから Cloudflare を覗きたいとき

`wrangler` は各サービスの devDependency なので個別インストールは不要。ルートには無いので `--filter` を付けて呼ぶ。

```sh
pnpm --filter @app/admin exec wrangler login    # ブラウザで OAuth（ローカル作業用）
pnpm --filter @app/admin exec wrangler whoami   # Account ID と権限を見る
```

この OAuth はローカル用で、CI では使えない（非対話のため）。CI が使うのは API トークンである。

基盤 Terraform をローカルで触る必要が出たときは、トークンを常設せずその場限りで渡す。

```sh
read -rs CF_TOKEN   # 貼り付けて Enter
CLOUDFLARE_API_TOKEN=$CF_TOKEN terraform -chdir=infra/terraform/cloudflare/envs/staging plan
```

## まだ無いもの

`services/ops`（D1 バックアップ・監視）は**実装されていない**。バックアップ用の追加設定は現時点では不要である。
