# P9 分析 — 完了

- spec: [`specs/glasses_management/features/012-analytics/spec.md`](../../../../specs/glasses_management/features/012-analytics/spec.md)
- 依存: P5 / P7 / P8
- 状態: 完了（Approved）
- 目的: 朝礼と月次のふりかえりで使う 8 タブを、**何を・いつを基準に・どの母数で数えたか**が画面だけで読める形で作る。生データは画面から読まず、`analytics_daily` ただ 1 表に保存した日次集計だけを読む。

## このTODOの正本と確定事項

spec が要件の正本であり、このTODOは実装順・テスト・既存実装への接続を決める。本文で確定した語彙・計算は、実装と同じ変更で spec / design の該当箇所へ反映する。承認前の spec を Draft のまま放置して E2E mapping を足さない。

| 事項 | 確定した扱い |
|---|---|
| 「名」 | Q-11 が未解決なので出さない。`guests` の metric、応答フィールド、DOM を作らない |
| 権限 | analytics / targets は `analytics.read` をサーバで強制する。権限なしは 403、他組織の店舗は存在を漏らさず 404 |
| 目安 | 待ち8分、取消率10%、再来90日。全店共通・編集UI／設定表は作らない |
| 小標本 | 20件ちょうどから率を出し、19件以下は `null` → UI は `—`。`unassigned` は分母に関係なく `null` |
| 営業日数 | 2026年8月は火曜4日を除く **27日**。320 ÷ 27 = **11.9件**（小数第1位） |
| 再来 | **後方参照**。集計日の完了来店について、同一顧客の直前の完了来店が JST で1〜90日前なら returning とする。未来の来店を待たない |
| 待ち時間 | 日別中央値の近似ではなく、日次ヒストグラムを期間内で合算して **exact median** を求める |
| 取消分類 | `analytics_daily` に cancel 分類を保存する。画面の読出しで `reservations` を走査しない |
| Cron | 既存の `triggers.crons` / `scheduled()` を **JST 00:00（UTC `0 15 * * *`）**へ寄せる。`ScheduledController.scheduledTime` を時計の正本にし、`new Date()` で取り直さない |
| Cron順序 | Web確認待ち取消 → analytics rollup → recording purge。各jobを独立 try/catch で実行し、前の失敗で後続を止めない |
| 既存5面の見た目 | `docs/frontend/mockups/eyex` の ANALYTICS-TOP / COUNT / STAFF / WAIT / CANCEL を正本として使い、別案で置き換えない |
| 3つの追加タブ | mockups README が採用した**案B**の `ANALYTICS-SOURCE` / `ANALYTICS-VISITS` / `ANALYTICS-PURPOSE` を正式な見た目の正本にする。入口・来店回数は縦棒、長い目的名だけ横棒とし、3面ともグラフ1つ＋定義1行＋まとめ3項目 |

## `analytics_daily` の固定設計

新設表は **1表だけ**。列は `id`, `organization_id`, `store_id`, `date` (JST `YYYY-MM-DD`), `metric`, `dimension`, `dimension_key`, `dimension_label`, `value` (`integer` かつ 0 以上), `created_at`, `updated_at` のすべて NOT NULL。FK は置かず、ID は `crypto.randomUUID()`。`dimension_label` は集計時点の表示名スナップショットで、担当者の無効化や目的名の変更後も過去レポートを ID 表示に退行させない。

物理 metric は次の **9種だけ**とする。

```text
closed
reservations
scheduled_reservations
reservations_received
receptions
cancellations
wait_seconds_histogram
revisit_eligible
revisit_returning_90d
```

dimension は次の **8種だけ**とする。

```text
total
staff
purpose
hour
source
cancellation_category
wait_seconds
visit_frequency
```

- `total` の key は必ず空文字。
- `staff` は `staff.id`、未定は `unassigned`。
- `purpose` は目的ID、`source` は `phone` / `counter` / `web` / `walkin`、`hour` は JST の `10` のような非ゼロ埋め時。
- `dimension_label` は `staff` / `purpose` で集計時点の表示名、固定語彙で日本語表示名を保存する。`total` / `hour` / `wait_seconds` も「合計」「10時台」などの非空表示名を必ず持ち、DDL DEFAULT で補わない。
- `cancellation_category` は `customer` / `store` / `duplicate` / `no_show` / `web` の5値。分類は排他で、未知・矛盾データを黙って customer に寄せない。
- `wait_seconds` は `hour:<0..23>:<seconds>` を key にし、value に同じ受付JST時間帯・待ち秒数の件数を置く。全時間帯または時間帯別に頻度表を合算するため、中央値は厳密に再現できる。
- `visit_frequency` は `first` / `second` / `third_to_fifth` / `sixth_or_more` の4値。`total` の key を流用しない。

一意 index は `(organization_id, store_id, date, metric, dimension, dimension_key)`、期間読出し index は `(organization_id, store_id, metric, date)`。index 名は既存 design の規約を引き継ぐ。

## T-001 契約を書く（Red）

- **触るファイル**: `packages/contracts/src/glasses_management.ts`, `packages/contracts/src/index.ts`, `packages/contracts/test/glasses_management.contract.test.ts`
- **先に赤くする**:
  - `AnalyticsMetric` は8タブの allow-list（`overview`, `reservation_count`, `reservation_source`, `cancellation`, `visit_frequency`, `staff`, `purpose`, `wait_time`）であり、未知値を拒む。
  - `AnalyticsQuery` は `storeId` UUID、strict object、`from <= to`、400日ちょうど可／401日不可、単日可、`granularity` / `countBy` の既定値を持つ。
  - `AnalyticsDailyMetric` の9値、`AnalyticsDailyDimension` の8値、各 key 語彙を fail-close にする。
  - `AnalyticsRollupRequest` は `from` / `to` の JST日付を必須にし、inclusive 31日ちょうど可／32日不可、`limit` は最大3、`storeCursor` は不透明文字列または未指定、unknown key を拒む。
  - `AnalyticsPoint.secondaryValue` は率の `0..1 | null`。0 と抑制を混同しない。report に guests が無い。
  - targets は `8 / 10 / 90` の固定値で、storeId query は strict に検証する。
- **Green**: Zod を単一ソースとして実装し、契約テストを緑にする。
- **完了条件**: contracts の4 coverage指標80%以上。

## T-002 スキーマとmigrationを書く（Red → Green）

- **触るファイル**: `services/glasses_management/src/worker/db/schema.ts`, `services/glasses_management/test/schema.test.ts`, `services/glasses_management/migrations/`
- **先に赤くする**:
  - 日次upsert用一意index、期間読出しindex、FKなし、`real` value、全列 NOT NULL。
  - 9 metric / 8 dimension、`total=''`、`visit_frequency` と `wait_seconds` が独立して表せること。
  - histogram の同日・同秒・同店舗の重複を一意indexで止めること。
- **Green**: Drizzle schema を足し、`pnpm --filter @app/glasses_management db:generate` で生成する。生成SQLを確認し、表再作成が出たら migration を直す。`db:migrate:local` を実行する。
- **完了条件**: schema test が緑。migration は新規追加のみ。

## T-003 時刻・閾値・exact median を書く（Red）

- **触るファイル**: `services/glasses_management/test/analytics.time.test.ts`, `services/glasses_management/test/analytics.test.ts`
- **先に赤くする**:
  - UTC 14:59:59.999 / 15:00:00.000 の JST日跨ぎ、月末、年末、2028-02-29、400日境界。
  - 週は月曜始まり、around は中心日前後7日、月rangeは月初〜月末。
  - 2026-08 の営業日27、臨時休業除外、closed行欠測は営業日数に入れない。
  - 480秒は非超過、481秒は超過。取消率10.04%は非超過、10.05%は10.1%へ丸めて超過。
  - 後方再来: 90日ちょうどを数え、91日目を数えず、未来来店を必要としない。
  - histogram を合算した odd/even 件数の exact median。**日別中央値を重み付けすると誤答になる反例**を置く。
- **Green**: `src/worker/domain/analytics.ts` に、時計を引数で受ける純関数（range、営業日、threshold、rate、histogram median、後方90日判定）を実装する。`Date.now()` を書かない。

## T-004 rollup の出力を先に書く（Red）

- **触るファイル**: `services/glasses_management/test/analytics-rollup.test.ts`
- **先に赤くする**:
  - 定休は `closed=1`、営業日は `closed=0` を必ず書き、空営業日も欠測にしない。
  - `reservations` は cancelled/no_show を除き、`scheduled_reservations` は取消・no_showを含む取消率分母、`reservations_received` は作成日のJSTで数える。
  - receptions は予約来店とwalkinを正しく合算し、`03-data-model.md` §11.4 の正本どおり staff / source / visit_frequency / total を出す。`hour` は reservations / reservations_received と wait histogram が担い、receptions には重複保存しない。
  - purpose、source4系列、visit-frequency4階級の排他と合計を確認する。
  - cancellation_category 5分類の優先順位・排他・未知データの観測可能な dropped 結果を確認する。
  - wait histogram は received→最初のconsultingだけを記録し、consulting無しを混ぜない。
  - revisit eligible / returning を担当確定済みの staff 別に出す。担当未定は件数行だけを残し、`03-data-model.md` §11.4 の正本どおり再来率の分母・分子には書かない。
- **Green**: `src/worker/domain/analytics-rollup.ts` をDB非依存の純関数で実装する。

## T-005 rollup API・backfill・冪等を先に書く（Red）

- **触るファイル**: `services/glasses_management/test/analytics.integration.test.ts`
- **先に赤くする**:
  - shared keyなし401、正しいshared keyでのみ通る。テナントJWTでは通らない。
- `from` / `to` の31日境界、最大3店舗、`storeCursor` の次ページ、範囲外・過大limit・不正cursorは400。保持期限は `now` のJST当日を基準にし、backfillの `to` から動かさない。
  - 同一範囲を2回rollupしても重複せず、変更済み生データを再集計してupsert更新する。
  - `storeCursor` が返す店舗だけを処理し、別orgの同日・同metric行を更新しない。
  - 25か月より古い行を消し、24か月前までを残す。
  - 1店舗の失敗が残り店舗を止めず、`failed` と対象storeが戻り値／ログに残る。
- **Green**: `POST /api/internal/maintenance/analytics/rollup` を `src/worker/index.ts` に追加する。`from` / `to` はinclusive、最大31日、1呼び出し最大3店舗、`storeCursor` で続行する。全書込みは `db.batch()` と一意index upsert にする。

## T-006 権限マトリクスを先に書く（Red）

- **触るファイル**: `services/glasses_management/test/permissions.test.ts`, 必要なら `test/helpers.ts`
- **先に赤くする**: `GET /api/staff/analytics` と `/targets` の各ルートについて、未認証・期限切れ・別secretは401、同店舗でanalytics.read無しは403、analytics.read有りは200、未同期は503、無効orgは403、unknown analytics pathは未認証401／認証済み404を表駆動で固定する。storeId欠損・不正・unknown query keyは400を追加する。
- **Green**: ルートへ analytics.read を付ける。既存 `requireStorePermission()` は **`src/worker/index.ts` 内**にあるため、param既定を壊さず query storeId を選べるよう拡張する。

## T-007 3テナント分離を先に書く（Red）

- **触るファイル**: `services/glasses_management/test/tenant-isolation.test.ts`
- **先に赤くする**:
  - 3組織が同じ期間・同じmetricに異なる行を持っても、自組織の数字だけを返す。
  - 他組織のstoreIdは404、同組織の担当外storeは403、同店舗でもanalytics.read無しは403。
  - forged `organizationId` queryはstrict schemaの400で、正常queryのorg根拠はJWTだけである。
  - internal rollupは他組織の行を一切更新しない。
  - internal maintenance はテナントJWTで越えられない。
- **Green**: reader・rollupの全クエリを `organization_id` と許可済み `store_id` で絞る。

## T-008 analytics report reader を実装する（Green）

- **触るファイル**: `services/glasses_management/src/worker/domain/analytics-report.ts`, `test/analytics.integration.test.ts`
- `analytics_daily` のみから8タブを構成する。histogramを合算して exact median、`revisit_returning_90d / revisit_eligible` で率、小標本でnullを返す。
- `businessDays` / `pendingDays` はclosed行だけから作る。targetsは分析表を読まないが、**認可のためのD1 membership読出しは行う**。
- reportは必ず `AnalyticsReport.parse()` を通す。サーバは `—` を返さない。

## T-009 分析2ルートを実装する（Green）

- **触るファイル**: `services/glasses_management/src/worker/index.ts`
- `GET /api/staff/analytics` と `GET /api/staff/analytics/targets` をチェーンに足し、`AppType` を保つ。analytics readは4クエリ以内を目安にバッチ化し、N+1を作らない。
- **完了条件**: T-004〜T-007 のRedがすべて緑、Worker coverage 4指標80%以上。

## T-010 Web取消のraceをTDDで直す（Red → Green）

- **触るファイル**: `services/glasses_management/test/web-booking.integration.test.ts`, `services/glasses_management/src/worker/index.ts`
- 既存 `applyWebPublications()` の自動取消で、同じpending予約を人のreviewとCronが競合させるRedを作る。片方だけが状態を変え、片方は0行更新を成功扱いにせず、予約本体・Web行・監査が矛盾しないことを固定する。
- Greenは条件付き更新と同一 `db.batch()` で解く。P8の期限・status・レスポンスを回帰させない。

## T-011 JST 00:00 Cron を実装する（Green）

- **触るファイル**: `services/glasses_management/wrangler.jsonc`, `services/glasses_management/src/worker/index.ts`, `services/glasses_management/test/analytics.integration.test.ts`, `services/glasses_management/worker-configuration.d.ts`
- cronをUTC `0 15 * * *`（JST 00:00）へ更新し、コメントも意図に合わせる。`scheduled(controller, env)` は `controller.scheduledTime` をDateに変換してJST日付を決める。
- 順序は Web pending取消 → analytics rollup → recording purge。analytics rollup はcursorの各ページで、店舗ごとに `analytics_daily` の `closed` のJST昨日以下の最終確定日の翌日から最大31日を再集計する。昨日まで未確定の日が残るページは同じcursorを `SHORT_LIVED` KVへ持ち越し、追いついた店舗はJST昨日〜7日先の通常窓を再計算して次ページへ進む。JST昨日までを確定済みとし、当日以降は予約系だけを再計算して `closed` を推測して書かない。これにより1回最大3店舗でも、72店舗超または31日超の停止後にforecastを実績へ欠測なく上書きする。各jobを別try/catchにし、失敗をログへ残して次へ進む。
- **先に赤くする**: scheduledTimeのJST年/月/日境界、Web失敗後もanalytics/recording実行、analytics失敗後もrecording実行、recording失敗が前2者を巻き戻さない、各jobが1回だけ呼ばれる。
- `wrangler.jsonc` を変えたら `pnpm -r cf-typegen` を実行する。

## T-012 画面のパス1と共通器を書く（Red → Green）

- **触るファイル**: `services/glasses_management/src/web/analytics/AnalyticsScreen.tsx`, `tabs.ts`, `Toolbar.tsx`, `describe.ts`, `AnalyticsScreen.test.tsx`, `src/web/App.tsx`
- パス1: 題材は朝礼前に1枚だけ読む分析。白い面＋paperの二層、主役はグラフ1つ、数字は箱に入れず罫線で分ける。目安は色と文字、空白は埋めない。
- 8タブ固定順、tablist/tab/aria-selected、draftとapplied分離、「適用」時だけ再取得、タブ初回は本体API1本。表示する固定目安は各 `AnalyticsReport.target` を正本とし、web は重複する `/targets` を画面入場時に取得しない（`/targets` は認可済みの固定値を必要とする別クライアント向けの契約として維持する）。
- Red: 8タブ・定義1行・適用前後・店舗切替・loading/empty/error・aria順序。

## T-013 グラフ部品と代替テキストを書く（Red → Green）

- **触るファイル**: `src/web/analytics/charts.tsx`, `patterns.css`, `charts.test.tsx`
- 縦棒、積み上げ、横棒、legend、target lineだけをexportする。塗り＋hatch/dot＋系列名で区別し、色だけに頼らない。
- Red: closedの0棒、pendingの非描画、本日強調、5取消層、0件staff、目安線、最大値／定休0／欠測を含む代替テキスト。

## T-014 トップを実装する（Red → Green）

- 前後7日の15点、定休日0、欠測通知、先週／今週／来週3行、名なし、今日強調を固定する。

## T-015 予約数を実装する（Red → Green）

- 日・月・時・曜日 × 来店日／受付日の4×2と、営業日27を分母にした1日あたり11.9を固定する。取消率はT-018だけに出す。

## T-016 担当者を実装する（Red → Green）

- receptionsの担当別件数、後方再来率、0件staff、unassigned最後と常時`—`を固定する。

## T-017 お待ち時間を実装する（Red → Green）

- histogram由来のexact median、前月、母数、8分ちょうど／1秒超の札、hour別の空軸を固定する。

## T-018 取り消しを実装する（Red → Green）

- cancellation_categoryの5積層、率分母=`scheduled_reservations`、10%目安、5分類名の完全一致、色以外の系列識別を固定する。

## T-019 案Bの3タブを実装する（Red → Green）

- **触るファイル**: `src/web/analytics/SimpleTab.tsx`, `SimpleTab.test.tsx`
- 正式モックは `docs/frontend/mockups/eyex/screens/ANALYTICS-SOURCE.html`, `ANALYTICS-VISITS.html`, `ANALYTICS-PURPOSE.html`。入口・来店回数の短い4分類は縦棒、長い目的名だけ既存担当者型の横棒とし、3面ともグラフ1つ＋定義1行＋まとめ3項目にする。
- 予約入口4系列、来店回数4階級、目的別件数、0件時の一文をRedで固定する。

## T-020 品質フロアを埋める（Red → Green）

- **web unit**: loading中に旧値を残さない、empty/error、403本文と戻る操作、tab/toolbar/definition/chartの読み上げ順。
- **Playwright（未tag品質テスト）**: 375pxで本文が横に動かず、タブ・グラフだけが自分のscroll領域を持ち8タブ全てを操作できることを `scrollWidth` と操作で測る。`html { font-size: 200% }` を注入してtoolbar4操作のbounding boxが重ならず操作可能なことを測る。
- `window.innerWidth` の一発分岐を作らず、44pt以上、色以外の状態表現を守る。
- **完了条件**: web coverage 4指標60%以上。

## T-021 E2EとApproved化

- **触るファイル**: `services/glasses_management/e2e/analytics.spec.ts`, `services/glasses_management/seed.mjs`, `specs/glasses_management/features/012-analytics/spec.md`
- 集計済み `analytics_daily` を直接seedし、Cron待ち・実時刻依存を排除する。Cron→rollup接続はT-005/T-011 integrationで証明する。
- 21本のPlaywright testへ、UC-ANA-01..10とAC-ANA-01..21の**31 IDをちょうど1回ずつ**付ける。各ACは1 testだけ、UCは対応するACと同じtestに置ける。コメントは直前のtop-level `test()` に `// @e2e-covers ...` の1行だけ置き、skip/fixme/onlyにしない。
- E2Eで、27日/11.9、20/19の抑制、closedとpending、exact medianの8分境界、3組織隔離、案Bの3タブ、キーボード操作を観測する。
- E2Eが緑になり `pnpm run test:traceability` がexact-oneを出してから、specをDraft→Approvedにする。

## T-022 5面のmock比較を足す

- **触るファイル**: `services/glasses_management/e2e/mock-compare.spec.ts`
- `ANALYTICS-TOP`, `ANALYTICS-COUNT`, `ANALYTICS-STAFF`, `ANALYTICS-WAIT`, `ANALYTICS-CANCEL` を既存 `mock` project（1194×810、DSF2、reference PNG）で比較する。
- apply後かつグラフ可視後に `toHaveScreenshot(..., { scale: 'device', maxDiffPixelRatio })` を実行する。値は上げず、実測値・残存差・根拠を各test直上と進捗台帳に残す。
- 既知差は名を出さないこと、8月31日と27営業日、取消5分類、P10のお知らせである。案Bの3面は正式HTMLモックを読み、操作・品質E2Eで検証する。

## T-023 完了の確認

- `docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md` に、実測mock差分、実行コマンド、spec/designへ反映した決定を残す。`knip.jsonc` は実在entryだけにする。
- 次を全て緑にする。閾値を下げず、広いexcludeを追加しない。

```sh
pnpm run lint
pnpm run deps:check
pnpm run typecheck
pnpm run test
pnpm --filter @app/glasses_management test:all
pnpm run test:traceability
pnpm --filter @app/glasses_management exec playwright test e2e/analytics.spec.ts
pnpm --filter @app/glasses_management exec playwright test --project=mock
pnpm --filter @app/glasses_management e2e
pnpm check
```

- **完了条件**: Approved specの31 UC/ACがexact-one、Worker 4指標80%以上、web 4指標60%以上、5 mock面が緑、全コマンドが緑。

## 実装時の注意

- 全D1クエリを `organization_id` で、店舗業務を `store_id` で絞る。
- 既存Cronは1本なので増やさない。scheduled jobは互いの失敗を握りつぶすだけでなく、ログ／結果で観測可能にする。
- migrationは生成済みを編集・削除せず新規のみ追加する。
- UIを変更する前に `docs/frontend/DESIGN_RULE.md` と5面＋案B3面のHTML/PNGを実際に確認する。
