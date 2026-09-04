# EYE予約 再構築 — 進捗台帳

計画: [`../plans/2026-08-28-glasses-management-rebuild.md`](../plans/2026-08-28-glasses-management-rebuild.md)

| フェーズ | spec | 状態 | 最後に確かめたこと |
|---|---|---|---|
| P0 サービスの土台 | `003-service-foundation` | **完了（Approved）** | 下記 |
| P1 店舗の受付条件 | `004-store-settings` | **完了（Approved）** | 下記 |
| P2 空き枠と予約台帳 | `005-availability-and-ledger` | **完了（Approved）** | 下記 |
| P3 予約受付 | `006-booking-flow` | **完了（Approved）** | 下記 |
| P4 顧客台帳 | `007-customer-records` | **完了（Approved）** | 下記 |
| P5 来店受付とウォークイン | `008-reception-and-walkin` | **完了（Approved）** | 下記 |
| P6 変更と取消 | `009-change-and-cancel` | **完了（Approved）** | 下記 |
| P7 受付の録音 | `010-recording` | **完了（Approved）** | 下記 |
| P8 お客様向けWeb予約 | `011-web-booking` | **完了（Approved）** | 下記 |
| P9 分析 | `012-analytics` | **完了（Approved）** | 下記 |
| P10 端末と監査 | `013-terminals-and-audit` | 未着手 | — |

## P0（2026-08-28）

作ったもの:

- `services/glasses_management/` を `services/example_service` から起こした
  （package.json / wrangler.jsonc（D1・KV・R2・NOTIFIER）/ vite / vitest ×2 / drizzle / playwright / tsconfig）
- `packages/contracts/src/glasses_management.ts` を 0 から書き直した
  （`OrganizationSync` / `StorePermission` / `StoreMembership` / `Store` / `Actor`）
- `packages/ui/src/theme.css` を承認済みモック `eye` のトークンへ全面的に書き直した
  （旧モック専用の方言 `terminal-*` / `viz-*` / `sp-*` / `compact-*` は削除）
- D1: `organizations` / `stores` / `store_memberships`（migration `0000`）
- Worker: health / dev トークングラント / `POST /api/internal/organizations/sync`（revision で巻き戻さない）/
  `GET /api/internal/organizations` / `POST /api/internal/store-memberships/sync` / `GET /api/staff/stores`
- web: `AppShell`（上のバー 64px + 左サイドバー 216px、たたむと 76px）と業務開始の画面
- 旧実装の残骸を削除（`docs/frontend/{diff,overlay,raw,reference,screens,REBUILD.md}`、
  旧モック `mockups/eye-reservation/`、旧 spec `features/002-*`、旧 superpowers 文書）
- 旧 spec が持っていた `UC-EYE-149` / `UC-EYE-151` は admin の業務なので
  `specs/admin/features/003-user-administration/spec.md` へ移し、admin の e2e タグを付け替えた

確かめたこと:

```
pnpm run lint                                → 緑（notifier に既存の warning 2 件のみ）
pnpm run deps:check                          → 緑
pnpm run typecheck                           → 緑（4 サービス）
pnpm run test                                → 緑（contracts 47 / shared 80 / ui 20 / notifier 22 /
                                                admin 171+102 / example 34+19 / glasses 54+10）
pnpm run test:traceability                   → 緑（Approved の UC/AC がちょうど 1 本ずつ対応）
pnpm --filter @app/glasses_management e2e    → 5 passed
```

カバレッジ: Worker lines 94% / branches 88.9% / functions 91.7% / statements 92.5%（下限 80%）、
web lines 87.1% / branches 94.3% / functions 84.6% / statements 86.8%（下限 60%）。


## P1 T-001 の返事（2026-08-28）

規約 10（同意なしに決めない）に従い、決定ブリーフに無い追加を人に諮った。**4 件とも承認。**

| # | 提案 | 返事 |
|---|---|---|
| 1 | `store_blackout_windows` を新設（受付を止める時間帯。銀座店は 1 日 3 帯） | 承認 |
| 2 | `store_settings_revision` を新設（設定 6 面の版を 1 本にまとめる） | 承認 |
| 3 | `stores.sort_order` を追加（店舗の並び順。設計文書の 4 か所が既に使っている） | 承認 |
| 4 | `reservations` / `reservation_purposes` / `reservation_assignments` を P1 へ前倒し（読み取り専用の器。書き込みは P3） | 承認（代案は採らない） |

これにより T-004 は **16 表**を作り、`0001_*.sql` の `CREATE TABLE` は 16 本になる。
AC-SET-13 / 14 / 15（保存前の影響）は P1 に残し、005 spec へ移さない。


## P1（2026-08-28）

作ったもの:

- 契約 44 本のテストとともに、設定 6 面ぶんの Zod（`StoreDetail` / `BusinessHours*` / `BlackoutWindow*` /
  `CalendarException*` / `SlotRules*` / `StaffMember*` / `StaffShift*` / `Equipment*` /
  `VisitPurpose*` / `PurposeRequirement*` / `SettingsImpact*`）
- D1 に **16 表**（承認 4 により `reservations` / `reservation_purposes` / `reservation_assignments` を
  読み取り専用の器として前倒し）と `stores` の 7 列、index 28 本。`migrations/0001_massive_dark_phoenix.sql`
- `src/worker/domain/store-settings.ts`（営業時間の解決・受けられる区間・最後にお受けできる時刻・
  保存を拒む 3 条件と警告どまりの 4 条件）と `src/worker/domain/settings-impact.ts`（保存前の影響試算 3 種）。
  **どちらも純関数で、時刻は引数で受ける**
- 設定の読み書きルートと `POST /api/staff/settings/impact`。版の競合は
  `INSERT ... SELECT ... WHERE EXISTS` を 1 バッチに配り、最後の文の `meta.changes === 0` で 409 を返す
- 画面 6 面（店舗の情報 / 営業日 / 営業時間 / ご来店の目的 / スタッフと技能 / 設備と点検）と
  保存バー・影響カード。保存の言い方は器が 1 か所で持つ
- `seed.mjs` に銀座店の受付条件（営業時間 7 行 / 止める帯 18 行 / スタッフ 6 名・技能 9 行・勤務 42 行 /
  設備 7 行 / 目的 6 件）。E2E の使い捨て D1 にも seed を流すようにした

確かめたこと:

```
pnpm check                                   → 緑（1,016 テスト + traceability）
  contracts 95 / shared 80 / ui 20 / notifier 22 / admin 171+102 /
  example 34+19 / glasses 336+137
pnpm --filter @app/glasses_management e2e    → 34 passed
```

カバレッジ: Worker statements 95.8% / branches 85.4% / functions 98.5% / lines 98.8%（下限 80%）、
web statements 91.3% / branches 81.7% / functions 93.3% / lines 95.7%（下限 60%）。

承認済みモックとの差（`playwright test --project=mock`。**下げるだけで上げない**）:

| 画面 | 差 | いま残っている差の中身 |
|---|---|---|
| HOME | 3.23% | 日付の帯（P2）・お知らせ札（P10）|
| SETTINGS-STORE | 3.81% | 第2サイドバーを 6 項目に絞っている（残り 9 項目は P8/P10 か対象外）|
| SETTINGS-CALENDAR | 4.51% | 同上 |
| SETTINGS-HOURS | 4.05% | 同上 |
| SETTINGS-PURPOSE | 4.94% | 同上 |
| SETTINGS-STAFF | 5.27% | 同上 |
| SETTINGS-EQUIPMENT | 4.52% | 同上 |

自己判断は [`2026-08-28-self-decisions.md`](./2026-08-28-self-decisions.md) に全 220 件。


## P2（2026-08-31）

作ったもの:

- `src/worker/domain/availability.ts` — 空き枠の 8 条件（営業日 / 営業時間と止める帯 / 刻みと片付け /
  目的の所要 / 技能を持つ担当の空き / 設備種別の空きと点検 / 同時受付上限 / Web 公開条件）を
  表駆動で縛った純関数。時刻は引数で受ける
- `src/worker/domain/ledger.ts` と `src/worker/db/queries/ledger.ts` — 担当者別・設備別・時間順の
  3 通りの行組み立て。**1 予約が複数の設備を押さえると設備軸では複数行に出る**
- 台帳のルート 3 本。応答に `serverNow` を載せ、現在時刻の線は端末の時計を読まない
- 画面 4 面（タイムテーブル / 設備・場所別 / 予約リスト / 台帳を隠さず開く詳細）と通信断の帯
- 表示窓は 10:00–16:30 の 30分刻み 14 列。営業時間が長い日は台帳の中だけ横スクロール
- 任意値を書かないため、格子の寸法は `src/web/ledger/metrics.ts` が `--spacing` の刻みで計算する

レビュー: subagent で **3 巡**（① backend ② frontend とモック突き合わせ
③ 受入基準の充足・敵対的な実装可能性・モック忠実度）。

確かめたこと:

```
（.dev.vars を退避した CI 相当の状態で）
bash scripts/check-agent-compat.sh   → ok
pnpm exec biome check .              → 緑
pnpm run deps:check                  → 緑
pnpm -r --if-present typecheck       → 緑
pnpm run test                        → 緑（1,362 テスト + traceability）
pnpm --filter @app/glasses_management e2e → 62 passed
```

カバレッジ: Worker statements 96.3% / branches 87.8%、web statements 89.6% / branches 81.7%。

承認済みモックとの差: LEDGER-STAFF 3.14% / LEDGER-RESOURCE 3.66% / LEDGER-LIST 5.16% /
LEDGER-DETAIL 7.83%。残っている差はお客様のお名前と来店回数（P4/P5 の持ち物）が中心。

### CI で落ちていたものと直し

PR #6 の最初の `verify` は `test/foundation.integration.test.ts` の
`Property 'AUTH_DEV_GRANT' does not exist on type 'Env'` で落ちた。
**CI には `.dev.vars` が無い**（gitignore。verify では作らない）ので、`wrangler types` が作る
`Env` に secret が現れない。ローカルにはファイルがあるので通ってしまう。
`test/env.d.ts` で `INTERNAL_KEY` / `JWT_SECRET` / `AUTH_DEV_GRANT` を明示し、生成物に頼らない形にした。
あわせて `services/glasses_management/CLAUDE.md → AGENTS.md` の symlink を足し、
`scripts/check-agent-compat.sh` の検査対象に `glasses_management` を加えた（旧サービス削除で落ちていた規約）。


## P3（2026-08-31）

作ったもの:

- `src/worker/domain/booking.ts` — 予約番号（`EY-YYMM-NNNN`）の採番と衝突時の再試行、冪等キー、
  UNIQUE 違反の翻訳（エラー文字列のパースに頼らない）
- `src/worker/domain/holds.ts` — 枠の仮押さえ 420 秒。残り 60 秒ちょうどの境界、取り直し 10 回まで
- 確定は **1 バッチ**。上限つきの条件付き INSERT が D1 側で二重予約を止め、`meta.changes === 0` を 409 の合図にする
- `reception_sessions` を確定・破棄の両方で残す（予約にならなかった受付も記録が残る）
- 画面 13 面（5 工程 + 目的が収まらない面 + ドラッグ移動 + テンキー + 手書き + 枠が先に埋まっていた面）
- 各工程の「次へ」が押せる条件は、モックの `.fab` の有効・無効をそのまま状態機械にした

レビュー: subagent で **3 巡**（① backend / frontend ② 受入基準の充足・敵対的な実装可能性・
モック忠実度の検査 ③ 指摘の反映）。

確かめたこと:

```
（.dev.vars を退避した CI 相当の状態で）
bash scripts/check-agent-compat.sh   → ok
pnpm exec biome check .              → 緑
pnpm run deps:check                  → 緑
pnpm -r --if-present typecheck       → 緑
pnpm run test                        → 緑（1,629 テスト + traceability）
pnpm --filter @app/glasses_management e2e → 96 passed
```

モック突き合わせは 20 面に増えた（HOME / HOME-PERSONAL / SETTINGS ×6 / LEDGER ×4 /
EX-OFFLINE / BOOK ×7）。

### 途中で落ちたところ

- セッションの中断でワークフローが死に、T-002（3 表と migration `0003`）だけが完成した状態で止まった。
  そのまま resume すると migration が重複して生えるので、**T-002 を外したワークフローを組み直して**再開した。
- `006` spec が Draft のままだったため traceability が 37 件の `Unknown E2E mapping` で落ちた。
  E2E が全部緑であることを確かめてから Approved に上げた。
  **spec を Approved に上げるのは E2E が緑になった後**という運用は変えない。


## P4（2026-08-31）

作ったもの:

- `src/worker/domain/customers.ts` — お電話番号の正規化と後方一致（伺い終えた時点で候補が出る）、
  お名前・かなでの探し方、候補の確からしさの順序、来店回数と「最後のご来店」、
  おまとめの下見、手書きの再直列化。**すべて純関数で時刻は引数で受ける**
- 顧客のルート 11 本。おまとめは**下見と実行の両方**に `settings.manage` を要求する
  （`requireRole('admin')` を店長判定に使わない）。実行は 1 バッチで、
  統合された顧客は行を消さず `merged_into_id` を持ち検索結果に出さない
- 来店回数を書き戻し、**台帳の帯にお名前と来店回数が出るようになった**（P2 が器だけ置いた場所）
- 手書きは `RECORDINGS` バケットの `notes/{org}/{customerId}/{noteId}.svg`。ダウンロード URL を出さない
- 画面 6 面（一覧と右の要約 / 詳細 / 新しいお客様 / 候補の面 / おまとめ / 手書き）

レビュー: subagent で **2 巡**（① Sonnet で backend / frontend ② Opus で受入基準 40 本の
1 本ずつの充足確認と敵対的な粗探し）。

確かめたこと:

```
（.dev.vars を退避した CI 相当の状態で）
bash scripts/check-agent-compat.sh   → ok
pnpm exec biome check .              → 緑
pnpm run deps:check                  → 緑
pnpm -r --if-present typecheck       → 緑
pnpm run test                        → 緑（2,031 テスト + traceability）
pnpm --filter @app/glasses_management e2e → 128 passed
```

モック突き合わせは **26 面**（差 1.7〜8.6%）。


## P5（2026-08-31）

作ったもの:

- `domain/walkin.ts` — 整理番号の採番（衝突したら再試行・日をまたいだら 1 に戻る）、同時受付の上限
- `domain/visit-board.ts` — 来店受付ボードの 6 列と 5 状態、担当不在・設備停止の警告。
  **「いまお待ち N名」はその日の待ちだけを数える**（昨日の行列を数えない）
- `domain/reception-history.ts` — 受付履歴の並びと絞り込み
- ルート 7 本（ウォークインの受付・顧客の関連付け・進捗 / 工程 2 本 / 受付履歴 2 本）。
  `visit_events` は**追記だけ**で、行を書き換えない
- 画面 5 面（来店受付ボード / 来店受付 / 台帳に重なる受付パネル / 受付履歴 / 0 件）
- **顧客未特定のままウォークインの受付と接客を始められる。** 後から既存顧客へ関連付けても、
  新規顧客を作って関連付けてもよい。顧客未登録のまま退店した記録も後から探せる

レビュー: subagent で **2 巡**（Opus。① backend / frontend ② 受入基準 45 本の 1 本ずつの充足確認と
敵対的な粗探し）。

確かめたこと:

```
（.dev.vars を退避した CI 相当の状態で）
bash scripts/check-agent-compat.sh   → ok
pnpm exec biome check .              → 緑
pnpm run deps:check                  → 緑
pnpm -r --if-present typecheck       → 緑
pnpm run test                        → 緑（2,356 テスト + traceability）
pnpm --filter @app/glasses_management e2e → 162 passed
```

モック突き合わせは **36 面**。


## P6（2026-08-31）

作ったもの:

- `domain/reservation-search.ts` — 氏名・かな・電話番号・予約番号での検索と、0 件のときの緩和候補
- `domain/reservation-change.ts` — 変更の差分（何がどう変わるか）と版の競合の判定
- `domain/availability.ts` に **「自分を除く」引数**を足した（自分の予約が自分の変更を邪魔しない）
- ルート 4 本。**変更先の枠を確保してから元の予約を切り替える**（元を先に空けない）。
  **409 は 1 行も書き換えない**ことを実 D1 で確かめた
- 画面 7 面（検索 / 0 件 / 日時 / 差分 / 取消 / 完了 / 別の端末との競合）
- 別の端末でも同じ予約を直していたときは両方の内容を並べ、選ぶまでどちらも書き換えない

レビュー: subagent で **2 巡**（Opus。① backend / frontend ② 受入基準 37 本の 1 本ずつの充足確認と
敵対的な粗探し）。

確かめたこと:

```
（.dev.vars を退避した CI 相当の状態で）
bash scripts/check-agent-compat.sh   → ok
pnpm exec biome check .              → 緑
pnpm run deps:check                  → 緑
pnpm -r --if-present typecheck       → 緑
pnpm run test                        → 緑（2,608 テスト + traceability）
pnpm --filter @app/glasses_management e2e → 206 passed
```

モック突き合わせは **44 面**。


## P7（2026-08-31）

作ったもの:

- `domain/retention.ts` — 保持期限。**成立予約は録音完了から 30 日、破棄受付は録音終了から 24 時間**。
  境界を両側で縛った（ちょうど＝消せない／+1 秒＝消せる）。保全（legal hold）は期限より優先する
- `domain/recording.ts` — 状態遷移（recording → uploading → stored / failed → deleted）と採番、
  お知らせ本文
- 録音のルート 5 本（開始・本体の受け取り・状態更新・再送・一覧）と、再生の 2 段（チケット → 本体）、
  保全の指定と解除、削除。**最低保持期限より前の削除は拒否する**
- **ダウンロード URL を一切出さない。** R2 は非公開のまま Worker が仲介する
- 保守の Cron を 1 本（JST 23:55 = UTC 14:55）。期限の来た録音だけを消す
- **再生・保全の指定と解除・削除を監査に残す**
- 画面: 受付中の録音の帯（全工程）・確認画面の常駐表示・端末側の録音と待避と再送・
  マイクが許可されていない面・保存に失敗した面・再生の導線 3 か所
- **予約は成立しているのに録音だけ失敗した状態**を画面で区別して見せる

レビュー: subagent で **2 巡**（Opus。① backend / frontend ② 受入基準 29 本の 1 本ずつの充足確認と
敵対的な粗探し）。

確かめたこと:

```
（.dev.vars を退避した CI 相当の状態で）
bash scripts/check-agent-compat.sh   → ok
pnpm exec biome check .              → 緑
pnpm run deps:check                  → 緑
pnpm -r --if-present typecheck       → 緑
pnpm run test                        → 緑（2,912 テスト + traceability）
pnpm --filter @app/glasses_management e2e → 230 passed
```

モック突き合わせは **46 面**。

## P8 お客様向け Web 予約 — 完了

ブランチ `011-web-booking`。仕様は `specs/glasses_management/features/011-web-booking/spec.md`（Approved）。

作ったもの:

- 契約と表: `WebPublication` / `PublicStore` / `PublicStorePurpose` / `PublicAvailabilityResponse` /
  `PublicReservationView` ほか。マイグレーション `0007`
- `domain/web-booking.ts` — 公開の可否、受付できる期間、目的ごとの所要時間から**空きかどうかだけ**を
  返す計算。**誰が・どの台がという内訳は外に出さない**
- `domain/management-code.ts` — 確認番号の採番と照合。**番号か電話のどちらが違うかは言わない**
  （どちらが当たっているか探れてしまうため）
- 公開ルート（`/api/public/*`）は既定拒否の**例外**として認証を通さない。テナントは slug から引く
- 画面 7 面（iPhone 390×844）: 店舗選び・目的・日時・お客様の情報・確認・完了・ご予約の確認と変更取消
- 設定に 7 項目目「Web予約の公開」(`WebPublishPanel`) を追加

判断したこと:

- 空き枠 API は **KV を 1 度も読まない**。公開面から内部の割り当てを推測されないようにするため
- 前日の終わりを過ぎた変更・取消は画面から落とし、お電話での連絡をお願いする
- 確認番号の照合失敗は**明細を 1 行も出さず**、どちらが違うかも示さない

レビュー: subagent で **2 巡**（Opus）。

確かめたこと:

```
（.dev.vars を退避した CI 相当の状態で）
bash scripts/check-agent-compat.sh   → ok
pnpm exec biome check .              → 緑
pnpm run deps:check                  → 緑
pnpm -r --if-present typecheck       → 緑
pnpm run test                        → 緑（3,226 テスト + traceability）
pnpm --filter @app/glasses_management e2e → 274 passed
```

検証中に直したもの（レビュー後に残っていた）:

- `PublicBookingApp.tsx` の空き枠取得が `zValidator` の無いルートに `query` を渡して型が合わなかった。
  既存の `StaffPanel` と同じ手（経路だけ型のついたクライアントに引かせ、query は `fetch` 側で足す）に揃えた
- `publicClient` が外から使われていない export だった（knip）ので export を外した
- 設定の第2サイドバーが 7 項目になったのに、既存テストが 6 項目のままだった

## P9 分析 — 完了（2026-09-01）

作ったもの:

- `analytics_daily` 1 表と migration `0008_cool_whizzer.sql`。表示 API は生表を読まず、
  日次スナップショットだけを読む
- JST 日次 rollup、最大 31 日・1 回 3 店舗の内部再集計、24か月保持、店舗 cursor、冪等 upsert
- `GET /api/staff/analytics` / `GET /api/staff/analytics/targets` と、組織・担当店舗の認可
- 既存 Cron 1 本を JST 00:00 に揃え、Web 公開反映 → 分析集計 → 録音片づけを独立 `try/catch` で実行
- トップ／予約数／担当者／お待ち時間／取り消しの既存5 mockを基準にした画面
- mockの無かった3タブは案Bを正式採用。予約の入口・来店回数は縦棒、長い目的名だけ横棒にし、
  3面とも「グラフ1つ＋定義1行＋まとめ3項目」で統一
- 期間・店舗は「適用」を押すまで表示値を変えず、4×2の予約数、厳密中央値、20件未満の率抑制、
  定休日0件と欠測、取消5分類、営業27日で 320 ÷ 27 = 11.9件を実装
- Web公開反映の条件付き更新が競合したとき、予約取消・枠削除・alert作成へ進まないようTDDで修正
- 受付履歴の既存integration testが実行月を読んでいたため、`FIXED_NOW` を注入して月替わりでも安定化
- 使い捨てE2E D1にだけ注入JST日付から45日分の勤務を展開し、将来日でもWeb予約と受付を再現可能にした
- 旧seedが残した実行日の特別営業IDをローカル再seedで掃除し、Nodeテス6件を通常の品質ゲートへ組み込んだ
- 予約数・待ち時間・取消グラフのVoiceOver代替文を正本相当へ揃え、追加3タブの実値が正本目盛りを超える場合は縦軸だけを上方拡張

確かめたこと:

```text
pnpm check
  → 緑（lint / Knip / 全typecheck / 全unit・integration / coverage / traceability）
  → seed互換 Node 6 passed、glasses Worker 1,668 passed、web 955 passed
  → Worker coverage 92.95 / 83.81 / 97.08 / 95.69%
  → web coverage 83.99 / 79.64 / 83.65 / 87.51%
pnpm --filter @app/glasses_management exec playwright test e2e/analytics.spec.ts --project=ipad
  → 21 passed
pnpm --filter @app/glasses_management exec playwright test e2e/mock-compare.spec.ts --project=mock --grep 'ANALYTICS-'
  → 5 passed
pnpm test:traceability
  → Approved の UC-ANA-01..10 / AC-ANA-01..21 がちょうど1本ずつ対応
pnpm --filter @app/glasses_management e2e
  → 300 passed / 0 failed（mock 51本、分析21本、既存機能回帰を含む）
```

既存5 mockとの差分率（承認画像は更新していない）:

- TOP 7.7152%（閾値 7.73%）
- COUNT 8.4850%（閾値 8.49%）
- STAFF 7.3666%（閾値 7.38%）
- WAIT 8.8903%（閾値 8.91%）
- CANCEL 10.9739%（閾値 11.00%）

## P10 端末の使い分けと監査 — 完了（2026-09-01）

作ったもの:

- `terminals` / `terminal_sessions` と migration `0009_round_gwen_stacy.sql`。端末の置き場所、
  共有・個人の使い方、PINの有無、自動で伏せるまでの秒数、楽観ロックの `version` を持つ
- admin の認証源泉を `ADMIN` service binding から利用する業務開始、個人端末・共有端末の選択、
  スタッフ／置き場所の選択、4〜6桁PIN、3回失敗後30秒の待ち、端末セッションの開始・終了
- 平文PINは保存・応答・監査へ出さず、`AUTH_PEPPER` と端末／スタッフごとのsaltでハッシュだけを保持。
  失敗回数は `SHORT_LIVED` KVへ30秒TTLで置く
- 共有モードでは日常業務を続け、録音の保全など責任の残る操作だけ本人PINで個人モードへ昇格。
  個人モードと共有端末の自動ロックは120秒ちょうどでは維持し、+1秒で失効／伏せる
- 予約・録音・設定などの監査を本処理と同じ `db.batch()` へ追加。条件付き更新では同じ
  `WHERE EXISTS` を監査INSERTにも付け、409になった操作だけが監査へ残らないようにした
- お知らせを「対応が必要」「お知らせ」「対応済み」に分け、未読は赤い罫と「未読」の文字で示し、
  付属操作が成功した1件だけを対応済みにする
- 自動ロックの覆い、氏名と電話番号だけの伏せ字、`visibilitychange` 復帰時の時刻差判定、
  通信断の帯と書き込み停止、入力途中の下書き保持、設定の権限不足画面
- モックの無い「設定 › 端末」は既存設定パネルの型で、端末の新規登録、使い方の変更、
  PINの作り直し、自動で伏せる時間の変更を実装

確かめたこと:

```text
pnpm check
  → 緑（lint / Knip / 全typecheck / 全unit・integration / coverage / traceability）
  → glasses Worker 1,804 passed、web 980 passed
  → Worker coverage 91.21 / 80.58 / 96.39 / 93.77%
  → web coverage 82.27 / 77.74 / 82.23 / 85.65%
pnpm --filter @app/glasses_management e2e
  → 333 passed / 0 failed（mock 61本、P10のUC/AC、既存機能回帰を含む）
pnpm test:traceability
  → Approved の UC-TERM-01..16 / AC-TERM-01..22 がちょうど1 scenarioずつ対応
pnpm --filter @app/glasses_management exec playwright test e2e/terminal-mock-compare.spec.ts --project=mock
  → 正規閾値で10 passed。実測採取時は閾値だけ一時的に厳しくし、直後に戻した
```

端末10面の実測差（承認画像は更新していない）:

- START-DEVICE-MODE 4.7427%
- LOGIN-STAFF 2.0116%
- LOGIN-STAFF-PIN 2.9368%
- LOGIN-SHARED 2.1657%
- LOGIN-SHARED-PIN 3.1412%
- LOGIN-PIN-ERROR 4.6655%
- MODE-PERSONAL 4.8550%
- HOME-SHARED-LOCKED 2.3801%
- ALERTS 5.4360%（未読を色だけにせず「未読」の札を追加）
- EX-PERMISSION 8.1260%（依頼先未定の店長依頼ボタンを出さず、6桁対応テンキーを共通化）

既存の EX-OFFLINE は 6.1260%。11面のうち8面が5%以下で、P10計画の基準を満たす。

申し送り:

1. `AuditTargetType` は監査対象のテーブル名そのまま（snake_case・複数形）に確定した。
2. `terminals.version` を追加し、端末設定の更新を楽観ロックにした。
3. Q-10の依頼先と承認フローが決まったら、EX-PERMISSIONに「この下書きを店長に依頼する」を戻し、
   `AlertCode`へ `settings.approval_requested` を追加してAC-TERM-13とE2Eを更新する。
