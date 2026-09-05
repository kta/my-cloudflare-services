# EYE予約（glasses_management）0ベース再構築 — マスタープラン

- 起票: 2026-08-28
- 対象: `services/glasses_management`（`@app/glasses_management` / Worker `glasses-management`）
- 状態: P0 完了 / P1 以降 未着手

旧実装は**削除済み**。`services/example_service` の雛形から作り直す。
見た目の正本は `docs/frontend/mockups/eye/`（68画面）、意味の正本は `packages/ui/src/theme.css`。

## 0. この文書の使い方

- **フェーズごとの TODO は `2026-08-28-glasses-management-rebuild/P<N>-*.md` にある。** 実装者はそれを上から順に消化する。
- 1 タスク（`T-NNN`）は「目的 / 触るファイル / 先に書くテスト / 実装 / 完了条件 / 依存」を持つ。
  **書いてある以上のことをしない。書いてあることは全部やる。**
- 進捗は `docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md` に記録する。
- 仕様の正本は `specs/glasses_management/`。この plan と食い違ったら **spec が正**。

## 1. フェーズ

| # | feature spec | 中身 | 依存 |
|---|---|---|---|
| P0 | `003-service-foundation` | 雛形・契約の骨・組織/担当店舗の同期・認証・テナント分離・デザイントークン・業務画面の器 | — |
| P1 | `004-store-settings` | 店舗・営業時間・カレンダー・スタッフ・技能・勤務・設備・点検・ご来店の目的 | P0 |
| P2 | `005-availability-and-ledger` | 空き枠エンジン・予約台帳（担当軸／設備軸／リスト／詳細／ウォークイン帯） | P1 |
| P3 | `006-booking-flow` | 電話・店頭予約の5工程・重なり警告・ドラッグ移動 | P2 |
| P4 | `007-customer-records` | 顧客検索（電話番号推定）・詳細・新規・統合・手書き | P3 |
| P5 | `008-reception-and-walkin` | 来店受付・ウォークイン・来店進捗・受付履歴 | P4 |
| P6 | `009-change-and-cancel` | 予約検索・変更・取消・差分・同時編集の衝突 | P5 |
| P7 | `010-recording` | 受付録音・R2・保持期限・失敗と再送・アラート | P5 |
| P8 | `011-web-booking` | お客様向けWeb予約・公開設定・通知・管理コード | P2, P4 |
| P9 | `012-analytics` | 分析5画面・指標定義・小標本抑制 | P5 |
| P10 | `013-terminals-and-audit` | 端末の使い分け・PIN・個人モード昇格・監査 | P0 |

P7 と P8 と P9 と P10 は互いに独立なので、P6 以降は並行できる。

## 2. 全フェーズ共通の作業の型

各タスクは必ずこの順で進める。**テストを先に書き、期待した理由で失敗することを目で見てから実装する。**

1. **契約** — `packages/contracts/src/glasses_management.ts` に Zod を足す。
   → `packages/contracts/test/glasses_management.contract.test.ts` に境界値と unknown key のテスト（Red）。
2. **スキーマ** — `services/glasses_management/src/worker/db/schema.ts` を編集し、
   `test/schema.test.ts` に index の名前と対象列のテストを足す（Red）。
   → `pnpm --filter @app/glasses_management db:generate` → `db:migrate:local`。
3. **Worker のテスト**（Red）
   - `test/permissions.test.ts` の表に新ルートの行を足す（未認証 / staff / admin / 期限切れ / 別 secret / 未知パス）
   - `test/tenant-isolation.test.ts` に 3 テナント・偽装入力の観点を足す
   - 時刻・期限が絡むなら `test/<領域>.time.test.ts`（**時刻は引数で注入。`Date.now()` を使わない**）
   - `test/<領域>.integration.test.ts` に代表フロー
4. **Worker の実装**（Green） — `src/worker/domain/<領域>.ts`（純関数）＋ `src/worker/index.ts`（ルートをチェーン）。
5. **画面の計画** — コードの前に `docs/frontend/DESIGN_RULE.md` のパス 1 を 3 行で書く（題材 / トークン計画 / シグネチャ要素）。
   **該当するモックの PNG を必ず Read で実際に見る。**
6. **画面のテスト**（Red） — `src/web/<領域>/*.test.tsx`。「何が読めて、何が押せるか」を書く。
7. **画面の実装**（Green） — `src/web/<領域>/*.tsx`。色・寸法は `packages/ui/src/theme.css` のトークン経由のみ。
8. **E2E** — `e2e/<領域>.spec.ts`。spec の AC 1 本につき Playwright test 1 本、直前の行に
   `// @e2e-covers AC-<TAG>-NN`。**書けたら spec の `- ステータス:` を `Draft` → `Approved` に上げる。**
9. **モックとの突き合わせ** — `e2e/mock-compare.spec.ts` で、実装画面と
   `docs/frontend/mockups/eye/images/<ID>.png` を並べて撮り、差分の割合を記録する。
10. **緑にする** — `pnpm --filter @app/glasses_management test:all` → `e2e` → `pnpm check`。

## 3. 完了の定義（毎フェーズ）

- [ ] `pnpm check` が緑（lint / knip / typecheck / 全 workspace のテスト / traceability）
- [ ] `pnpm --filter @app/glasses_management e2e` が緑
- [ ] そのフェーズの spec が `- ステータス: Approved` で、全 UC/AC に `@e2e-covers` が 1 対 1 で付いている
- [ ] Worker 側カバレッジ 4 指標すべて 80% 以上 / web 側 60% 以上（**閾値を下げない・広く除外しない**）
- [ ] 進捗台帳に、実行したコマンドとその結果を書いた

## 4. 非交渉のルール（毎タスク）

| # | ルール | 破ったときに起きること |
|---|---|---|
| 1 | 全 D1 クエリを `organization_id` で絞る。店舗業務は `store_id` も | 他社のお客様の情報が見える |
| 2 | FK を宣言しない。id は `crypto.randomUUID()`。原子性は `db.batch()` | D1 の制約に合わない |
| 3 | 型は Zod からの派生物。手書き型と `any` を書かない | 契約とコードがずれる |
| 4 | ルートはチェーンして `export type AppType = typeof routes` | RPC の型が web に届かない |
| 5 | 色・寸法は `packages/ui/src/theme.css` のトークンだけ。Tailwind 既定パレットと任意値を書かない | 承認された見た目から離れる |
| 6 | 触れるものは 44pt 以上（テンキーは 72pt）。状態を色だけで伝えない | HIG と WCAG AA を外す |
| 7 | 時刻は引数で注入する。テストで `Date.now()` に依存しない | 日跨ぎ・月跨ぎで落ちる |
| 8 | Workers Paid が要るもの（Queues 等）を設計に入れない | 無料枠で動かない |
| 9 | 録音は非公開 R2。ダウンロード URL を出さない。最低保持前に消さない | 統制上の事故 |
| 10 | 監査は追記専用 | 追跡できない |

## 5. 世界観データ（seed の正本）

モック間で食い違っていた値は**この表を正**として実装側で正規化する。モックの画像は直さない。

| 項目 | 値 |
|---|---|
| 組織 | EYE（`eye`） |
| 店舗 | 銀座店（`ginza` / 10:00–19:00 / 定休 火）・丸の内店（`marunouchi`）・新宿店（`shinjuku`） |
| 基準日時 | 2026年8月27日（木）11:08 JST |
| 担当 | 佐藤 美咲（視力測定・加工）／高橋 健（フィッティング）／中村 彩（販売・受付）／小林 学（視力測定）／渡辺 由紀（販売）／高橋 慎輔（店長） |
| 設備 | 視力測定機A・視力測定機B・相談カウンター1・相談カウンター2・加工室 |
| ご来店の目的 | メガネを新しく作る(60分)／視力測定だけ(30)／フィッティング(30)／できあがりの受け取り(20)／今のメガネを調整したい(20)／修理・部品交換(30・Web非公開) |
| お客様 | 田中 花子(4回目)／佐々木 亮(3回目)／松本 一郎(7回目)／山口 真央(初)／伊藤 健(2回目)／川上 恵(初)／相川 みどり(2回目) |

## 6. 進め方の注意

- **モックに無い機能を発明しない。** 足りないと思ったら spec に `[要確認: ...]` を残して人に聞く。
- **空いた場所を埋めるために要素を足さない。** 下や右が空いているのは正しい状態
  （`docs/frontend/mockups/eye/README.md` の引き算の表）。
- **1 画面の主役は 1 つ。** 白い箱は 3 枚まで、説明文は 2 つまで、一覧の行は 8 つまで、状態の札は 3 つまで。
- モックは 1 状態しか描いていない。**読み込み中 / 空 / エラー / 375px / 200%文字拡大 / VoiceOver は
  DESIGN_RULE の品質フロアで補う**（モックに無いから作らない、は誤り）。
