# services/glasses_management — EYE予約

ルート [`AGENTS.md`](../../AGENTS.md) の規約に加えて、このサービスで作業するときはこれを守る。

## このサービスが持っているもの

眼鏡店チェーン **EYE** の予約・来店受付・顧客・録音・設定・分析と、お客様向け Web 予約。
1 Worker が **業務 SPA（iPad 横向き）+ お客様向け Web 予約（スマートフォン）+ API** を同一オリジンで配る。

| 種別 | binding | 実体 |
|---|---|---|
| D1 | `DB` | `glasses_management`（このドメインの正本） |
| KV | `SHORT_LIVED` | 冪等キー・短命な下書き。**正本にしない** |
| R2 | `RECORDINGS` | 受付録音の本体。**非公開。ダウンロード URL を出さない** |
| service | `NOTIFIER` | 予約確定メール等の同期送信（Queues は使わない） |

**持っていないもの**: 利用者・組織・認証（`admin` が正本）、メール配送そのもの（`notifier`）。
admin からは service binding で `POST /api/internal/organizations/sync` と
`POST /api/internal/store-memberships/sync` に押し込まれる。**cross-D1 JOIN はしない。**

## 設計の正本

| 何を決めるとき | 読むもの |
|---|---|
| 見た目 | `docs/frontend/mockups/eye/`（68画面の HTML と PNG）。**PNG を実際に見てから書く** |
| 色・寸法 | `packages/ui/src/theme.css` のセマンティックトークンだけ。モックの生 hex を貼らない |
| 業務要件 | `specs/glasses_management/design/01-requirements.md` |
| 状態遷移 | `design/02-domain-model.md` |
| テーブル | `design/03-data-model.md` |
| API | `design/04-api.md` |
| 画面と遷移 | `design/05-screen-flow.md` |
| ユースケース | `design/06-use-cases.md` |
| 非機能 | `design/07-nfr.md` |
| 作業分解 | `docs/superpowers/plans/2026-08-28-glasses-management-rebuild.md` |

## このサービスで必ず書くテスト

| 変えたもの | 足すテスト |
|---|---|
| ルート | `test/permissions.test.ts` の表に 1 行（未認証 / staff / admin / 期限切れ / 別 secret / 未知パス） |
| ドメインのクエリ・書き込み | `test/tenant-isolation.test.ts`（3 テナント・偽装入力・未同期 503 と無効化 403 の遷移） |
| Zod 契約 | `packages/contracts/test/glasses_management.contract.test.ts`（境界値と unknown key） |
| スキーマ | `test/schema.test.ts`（index の名前と対象列・FK が無いこと）→ `db:generate` |
| 空き枠・保持期限・JST の判定 | `test/*.time.test.ts`。**時刻は引数で注入する。`Date.now()` に依存したテストを書かない** |
| Worker のフロー | `test/*.integration.test.ts`（D1 の結果・status・notifier の成功と失敗） |
| 画面 | `src/web/**/*.test.tsx` を**先に失敗させてから**実装し、`test:web` と e2e を回す |
| Approved な UC/AC | `e2e/*.spec.ts` に `// @e2e-covers <ID>` を 1 対 1 で付ける |

カバレッジ下限: Worker 側 80%（4 指標）、web 側 60%（4 指標）。**閾値を下げたり広く除外したりしない。**

## やってはいけない

- 全 D1 クエリから `organization_id` のスコープを外す。店舗業務は `store_id` も併せて絞る。
- 他店舗の空き枠を横断検索・一覧比較・候補提示する（店舗を切り替えてから操作する設計）。
- 録音本体のダウンロード URL を出す。R2 は非公開のまま Worker が仲介する。
- 最低保持期間（成立予約 30 日 / 破棄受付 24 時間）より前に録音を消す。
- 監査イベントを更新・削除する（追記専用）。
- Queues / Durable Objects など Workers Paid が要るものを設計に入れる。
- Tailwind の既定パレット（`bg-blue-500`）や任意値（`p-[13px]`・`text-[#hex]`）を書く。

## よく使うコマンド

```sh
make dev/glasses_management                      # :5175 で SPA + API
pnpm --filter @app/glasses_management db:generate      # スキーマ → migrations
pnpm --filter @app/glasses_management db:migrate:local
pnpm --filter @app/glasses_management test:all   # Worker + web
pnpm --filter @app/glasses_management e2e        # Playwright（UI を変えたら必ず）
pnpm check                                       # 完了の定義
```
