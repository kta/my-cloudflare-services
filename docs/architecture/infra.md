# インフラ方針（Terraform × Wrangler）

## 配信アーキテクチャ（2026 基準）
- **1 サービス = 1 Worker が SPA と API を両方配信**（Workers static assets）。`assets.not_found_handling: "single-page-application"` + `run_worker_first: ["/api/*"]`。Pages は使わない（新機能は Workers のみに載る）。
- 開発は `@cloudflare/vite-plugin` の単一 dev サーバ（SPA は Vite HMR、Worker は実 workerd）。proxy 設定・二重起動は存在しない。
- `vite build` が `dist/client`（assets）と `dist/<worker>/wrangler.json`（出力設定）を生成し、`wrangler deploy` はそれを自動で使う。

## 環境（2 つ）
| | production | staging |
|---|---|---|
| ブランチ | `main` | `develop` |
| Worker 名 | `admin` / `glasses-management` / `notifier` | 各々に `-staging` |
| wrangler 設定 | 上位（トップレベル） | `env.staging` |
| Cron | `glasses-management` の日次 1 本 | **0 本**（アカウント共有枠を食わない） |
| アクセス | `*.workers.dev` | `*.workers.dev` + ゲートトークン |

上位を production のまま据え置くのは、`env.production` を新設すると wrangler が本番 Worker を `admin-production` に**改名**し、既存のデプロイ・secrets・observability の連続性が切れるため。

Terraform は `modules/substrate` を `envs/production` と `envs/staging` の 2 つの root から呼ぶ。CI の staging job は `envs/staging` に `cd` するので、**構造として production の state に触れられない**。workspace は選択ミスがそのまま本番を壊す経路になるので採らない。

**staging は同じアカウントに同居する**ので、D1 の日次 row read/write・Workers リクエスト・R2 容量は本番と共有枠になる。staging は手動確認とスモークに限り、負荷試験は回さない。

## 分担（1 リソース = 1 オーナー）
- **Terraform が所有（基盤）**: D1 / KV / R2 / DNS（**Queues は使わない** — Free でも使えるが、通知は同期送信 API で足りるという設計判断）。TF outputs の id を各 `wrangler.jsonc` に手動/CI で反映。
- **Wrangler が所有（コード + バインディング）**: 各 `wrangler.jsonc` + `wrangler deploy`。service binding・Cron・Workflows も wrangler.jsonc 側。
- 同一リソースを両方で管理しない（drift の元）。

## Secrets
**GitHub Environment secrets が唯一の源泉**で、CI が deploy 直後に `wrangler secret bulk` で同期する。手で `wrangler secret put` を叩く運用は廃止した。**TF state には置かない**（`secret_text` は state に載る）。手順は `docs/howto/deploy.md`。

## State backend（R2）
`backend "s3"` を R2 エンドポイント（`region = "auto"`, 各 `skip_*`, `use_path_style`）で。`endpoints` にアカウント ID が入るため、値はファイルに書かず CI から `-backend-config` で注入する。ロック機構が無いため CI の `concurrency: deploy-<branch>`（`cancel-in-progress: false`）で apply を直列化。

## 料金の前提（Workers Free でも全部動く）
- 静的 assets 配信は無料・無課金リクエスト。
- 通知は notifier への同期送信 API（KV 冪等 + 再検知 Cron）。無料枠上限と設計対処の全量は `docs/howto/free-tier-limits.md`。
- Cron は Free で**アカウント全体 5 トリガー**まで（UTC）。Worker 単位の枠ではないので、サービスを増やすと共有枠を消費する。

## 非 Cloudflare（必要なら）
Auth0（認証）/ Resend（メール）/ GA4（解析）。AWS は使わない。

## まだ無いもの
`services/ops`（D1 バックアップ・監視）は**実装されていない**。設計だけが `docs/howto/restore.md` と `AGENTS.md` に残っている。
