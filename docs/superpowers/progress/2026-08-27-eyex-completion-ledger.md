# EYEX reservation — completion ledger (Claude, from 2026-08-27)

正本: `specs/glasses_management/features/002-eyex-reservation-product/spec.md`（Approved, 181 UC / 125 AC）と
`docs/superpowers/plans/2026-08-26-glasses-management-roadmap.md`。
引き継ぎ: `docs/superpowers/handoffs/2026-08-27-eyex-reservation-claude-handoff.md`。

引き継ぎ文書が参照する `.superpowers/sdd/2026-08-27-eyex-web-booking/progress.md` と
GPT側の添付タスク一覧は、このマシンに存在しない。したがって本台帳を新しい正本とし、
ロードマップのフェーズ順を残作業の基準にする。

## 着手時点の実測（2026-08-27）

| ゲート | 実測 |
| --- | --- |
| `pnpm run lint` | 緑（warning のみ）。`StaffWorkspace.test.tsx` の format 崩れ 1 件を修正した。 |
| `pnpm run typecheck` | 緑。 |
| `@app/contracts` coverage | functions 69.23% / branches 78.94% で **不足**。 |
| `@app/glasses_management` Worker coverage | branches 73.74% で **不足**（statements/lines/functions は充足）。 |
| `pnpm run test:traceability` | 失敗。admin 側 4 件 + EYEX の UC 162 件 / AC 113 件が未マッピング。 |

## 完了した修正

- **contracts coverage**: `packages/contracts/test/glasses_management.refinements.test.ts` を追加し、
  cross-field refinement（店舗切替の同一店舗拒否、緯度経度のペア必須、`LocalDate` の実在日、
  `purposeIds` の重複拒否 3 箇所、予約検索の日付順序、顧客検索の排他条件）を両方向で検証。
  → statements/branches/functions/lines すべて **100%**。
- **traceability(admin)**: validator が `Superseded` status を認識しなかったため、
  置換済みの `001-admin-standalone` が「status 未宣言」として失敗し、後継 spec が UC/AC を
  定義しないことで `AC-ADMIN-01..03` が孤立していた。validator にテスト先行で `Superseded`
  を追加（Approved のみが分母、Superseded は `@e2e-covers` の対応先にもならない）、
  admin smoke の孤立マッピングコメントを削除、`SPEC_WORKFLOW.md` と
  `E2E_TRACEABILITY.md` を更新。→ traceability の残件は EYEX の未実装フェーズのみ。
- **未定義デザイントークン**: `text-on-pine` / `bg-on-pine/30` を使いながら
  `packages/ui/src/theme.css` に `--color-on-pine` が無く、濃緑ヘッダー上の文字色が
  解決されていなかった（実バグ）。トークンを定義（pine 上で 7.4:1）。

- **Worker branch coverage 73.74% → 84.69%**（閾値 80%）。例外経路へ integration テストを
  6 グループ追加（公開店舗検索 16 / 公開予約の冪等・競合 28 / 予約ライフサイクル 14 /
  ウォークイン・顧客 10 / 共有端末 20 / 設定検証と認証プロキシ 16）。
  Worker テストは 203 → 314 本。
- **knip(dependency audit) 緑化**: `knip.jsonc` に `services/glasses_management` の
  workspace 定義が欠けていた。追加のうえ、未使用 export 3 件・未使用 export 型 5 件を
  非公開化し、同一スキーマの別名 export 4 組（`StoreSync` / `StoreMembershipSync` /
  `AvailabilityBreak` / `PublicAvailabilityQuery`）を正名へ統合した。
- **時刻注入の欠陥を修正**（実バグ）: `requestClock(c)` が 6 箇所しか使われず
  `systemClock()` が 45 箇所あったため、予約・ウォークイン・監査・共有端末の書き込みが
  壁時計で刻まれ、JST 日境界に依存する台帳・受付履歴が実質テスト不能だった。
  失敗する `test/request-clock.time.test.ts` を先に書き、44 箇所を `requestClock(c)` へ
  置換。壁時計に依存していた既存テスト 1 件も注入日へ修正。
- **共有端末の fail-closed 化**（実バグ）: `shared_terminals.idle_timeout_seconds` に
  DB 制約が無く、契約違反値があると端末認証面の全経路が 500 になっていた。
  `test/shared-terminal-integrity.test.ts` を先に書き、セッション応答を safeParse して
  401 `terminal_unauthorized` で fail close するよう修正。

## 到達状態（本セッション終了時）

**`pnpm check` は緑**。E2E traceability も
`all approved UC/AC identifiers are mapped exactly once`（181 UC / 125 AC）。

| ゲート | 着手時 | 現在 |
| --- | --- | --- |
| lint (Biome) | 失敗 | 緑（warning のみ） |
| dependency audit (Knip) | 失敗 | 緑 |
| typecheck | 緑 | 緑（`e2e` 用 tsconfig を分離） |
| contracts coverage | 69.2% / 78.9% | **100%**（全指標） |
| Worker coverage | branches 73.74% | **83.29%**（閾値 80%） |
| web coverage | branches 68.43% | **78.93%**（閾値 60%） |
| traceability | 275 件未マッピング | **0 件** |

テスト数: Worker 203 → **744**、web 30 → **512**、contracts 27 → **156**、
admin 169、E2E 4 → **86**。

### 既知の残課題（本セッション由来ではない）

- `services/admin/e2e/smoke.spec.ts` の「組織作成 → …」は、admin の Playwright 設定が
  admin 単体しか起動せず `glasses-management` の service binding が無いため 502 になり失敗する。
  ベースライン `d471497` の worktree でも同一の失敗を再現済みで、**既存の環境依存**である。
  `pnpm check` は e2e を含まないため影響しない。

## 旧: 着手時の `pnpm check` 状態

lint / dependency audit / typecheck / combined test（Worker 314 本・web 30 本・
contracts 51 本・shared・ui・admin・notifier）はすべて緑。
**残る失敗は EYEX の E2E traceability のみ**（UC 162 件 / AC 113 件が未マッピング）。
これは未実装のスタッフ画面群そのものであり、ロードマップ Phase 2 以降の作業に等しい。

## 進行中 — Phase 2/3 スタッフ画面

`StaffWorkspace` はログイン・店舗切替・共有端末ロックしか持たず、
UC-EYEX-001〜062 の画面が丸ごと未実装だった。承認済みモック
（`docs/frontend/mockups/eyex-reservation/`）を視覚の正として実装する。

- `src/web/staff-navigation.ts`（新規, TDD 7 本）: 画面位置は URL ではなくメモリに置く。
  共有 iPad の履歴に顧客 ID や台帳日を残さないため、かつ店舗切替で
  全パラメータを一括破棄できるようにするため（UC-EYEX-070 / AC-EYEX-30）。
- `src/web/staff-screen.ts`（新規）: 全画面共通の Props 契約。店舗をグローバルではなく
  Props で渡し、画面が店舗切替をまたいで生き残れないようにする。
- `App.tsx`: `navigation` と `renderScreen` を注入する seam を追加し、店舗切替成功時に
  `resetForStoreSwitch()` を呼ぶ。テスト 2 本を先に赤にしてから実装。
- **画面実装（並列, 全て TDD）**: `HomeScreen`(21) / `BookingFlow`+`staff-booking`(31) /
  `CustomerPanel`+`customer-search`(36) / `LedgerScreen`+`JourneyScreen`+`ledger-timeline`(39) /
  `ReservationSearchScreen`+`ReceptionHistoryScreen`(32)。
  `StaffWorkspace` へ画面ルーティングを統合（テスト先行 3 本）。
  web テストは 30 → **201 本**、branch coverage 68.4% → **79.78%**（閾値 60%）。
- **未定義デザイントークンの実バグ 2 件目**: `App.tsx` の `bg-canvas` が theme.css に無く、
  ワークスペース背景が解決されていなかった。`bg-glass-canvas` へ修正。
  （1 件目は `--color-on-pine`。**同種のバグが 2 件出たので、`theme.css` に定義の無い
  色トークン class を落とす lint を後続で入れることを推奨する。**）


## Phase 4/6 の追加分

- **画面**: `SharedTerminalScreen` + `ReauthPrompt`(26 テスト) / `SettingsScreen` + `settings-guide`(37 テスト)。
  設定と共有端末はホーム副操作ではなく**ワークスペースヘッダー**に置いた（承認済みモックの情報構造どおり、
  どの画面からでも到達できる必要があるため）。
- **バックエンド**: 店舗別権限 API（`GET /api/staff/stores/:storeId/permissions`）を追加。
  クライアントが権限を JWT ロールから推測すると、制限情報を過剰露出するか、
  権限のあるスタッフから隠してしまうため、サーバの評価結果を返す。
  `StaffWorkspace` がこれを取得し、`customer.history` / `attention.read` から
  `CustomerPanel` の表示範囲を決める。取得前・取得失敗時は**最も狭い表示**に倒す（AC-EYEX-91）。
- **バックエンド**: 設定の下書き→影響確認→公開の閉ループ（16 ルート、6 テーブル、
  マイグレーション `0028_short_hex.sql`）。JST 境界は「その瞬間は due、1ms 前は not due」を
  1 箇所で判定する。部分失敗の再試行は成功済み店舗へ二重適用しない。
- **e2e tsconfig を分離**: `page.evaluate` のコールバックはブラウザで動くため DOM 型が要るが、
  Worker プロジェクトに DOM 型を持ち込むと存在しない API を型が許してしまう。
  `e2e/tsconfig.json` を独立させ、`typecheck` に `tsc --noEmit -p e2e` を追加した。

## 人間の承認が必要な未決事項

- **公開予約のスケジュール実行に cron が無い**。`glasses_management` に cron trigger が無く、
  追加はアーキ判断（ルール 10）のため、実行は権限付きの `POST .../publications/:id/run` に留めた。
  無人実行が必要なら `services/ops` から叩くか、この Worker に cron を足すかの判断が要る。

## 残作業（ロードマップ順）

Phase 2/3/4/6/7/8 の**スタッフ画面はほぼ未実装**（`StaffWorkspace` はログイン・店舗切替・
共有端末ロックのみ）。バックエンドは Phase 0–5 をおおむね実装済み。
録音運用(R2)・分析・アラート・注意事項・顧客統合はバックエンドも未実装。
承認済みモックは `docs/frontend/mockups/eyex-reservation/` に全画面分ある。
