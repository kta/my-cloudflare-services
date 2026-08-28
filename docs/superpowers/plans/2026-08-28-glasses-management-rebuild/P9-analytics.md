# P9 分析 — TODO

- spec: [`specs/glasses_management/features/012-analytics/spec.md`](../../../../specs/glasses_management/features/012-analytics/spec.md)
- 依存: P5
- 状態: 未着手
- 目的: 朝礼と月次のふりかえりで使う 8 タブを立て、「何を、いつを基準に、どれだけの母数で数えたか」が
  画面の上で読める形にする。根拠にできない数字（標本 20 件未満の率・まだ集計できていない期間・人数の「名」）は
  数字として出さない。

---

## このフェーズの前提（着手前に 3 分で確認する）

| 事項 | いまの前提 | 出どころ |
|---|---|---|
| 分析の「名」（88名・414名） | **出さない。** `metric='guests'` の行を書かず、画面は件数だけを出す | `design/09-open-questions.md` Q-11 |
| `analytics.read` をサーバで強制するか | **強制する。** `GET /api/staff/analytics` と `.../targets` の 2 本に `requireStorePermission('analytics.read')` を付ける。持たないスタッフにはサイドバーの「分析」も出さない | `design/09-open-questions.md` Q-03 / `design/04-api.md` §2.2 |
| 目安の 3 つ | お待ち時間 8分 / 取消率 10% / 再来 90日。**全店共通の固定値**で、画面から変える操作を作らない。置き場のテーブルも作らない | `design/04-api.md` §3.10 / `design/05-screen-flow.md` §4.9 |
| 小標本抑制の閾値 | **20 件。** 20 件ちょうどは率を出し、19 件は「—」。`unassigned`（担当が未定）は分母が 20 以上でも常に「—」 | `design/03-data-model.md` §11.4 / `design/06-use-cases.md` IDX-ANA-07 |
| モックの無い 3 タブ | **作る。**「予約の入口」「来店回数」「ご来店の目的」を既存 5 枚と同じ型（グラフ 1 つ＋定義 1 行＋まとめ 3 行）で組む | `design/05-screen-flow.md` §4.9 |
| Cron 枠 | このリポジトリで `triggers.crons` を持つ Worker は 0 本。P7（録音）が先に `"55 14 * * *"`（UTC = JST 23:55）を足しているなら**足さず `scheduled` に 1 行足すだけ**にする。まだ無ければこのフェーズが 1 本目を作る | `design/04-api.md` §3.2 / `P7-recording.md` T-012 |
| `requireStorePermission()` | P1 が `services/glasses_management/src/worker/store-permission.ts` に作る。**パスの `storeId` を読む実装**なので、query で `storeId` を受ける分析のために引数を 1 つ足す（T-011） | `P1-store-settings.md` T-011 |
| 集計の元になる表 | `reservations` / `reservation_assignments` / `reservation_purposes`（P2・P3）/ `visit_events` / `walk_ins`（P5）/ `staff`（P1）/ `store_business_hours` / `store_calendar_exceptions`（P1）。**画面からは 1 度も触らない** | `design/03-data-model.md` §11.4 |

### このフェーズで足す 7 つの逸脱（設計文書との突き合わせで出たもの。実装者が迷わないようここで確定させる）

1. **`AnalyticsMetric` に `overview` を足して 8 値にする。** `design/04-api.md` §3.10 は 7 値しか挙げていないが、
   タブは 8 つあり、トップを区別して要求する値が無い。`07-nfr.md` §4.1 は 1 画面 1 本を上限にしているので、
   トップを「複数 metric を 2 本叩いて束ねる」形にはできない。既存 7 値は 1 つも変えず、8 値目を足すだけにする。
2. **`AnalyticsPoint.secondaryValue` は「人数」ではなく「率」を載せる。** `design/04-api.md` は当初
   「件数に対する人数」と書いているが、Q-11 のいまの前提で人数を書かないので空く。担当者タブの
   「90日以内の再来」（0.00〜1.00。伏せたら `null`）をここに載せる。「—」の描き分けは `null` かどうかだけで決まる。
3. **取り消しの 5 層は `analytics_daily` に `dimension='cancel_reason'` で保存する。**
   `design/03-data-model.md` §11.4 は「積み上げは保存しない。読み出し時に `reservations` の列から組み立てる」と書くが、
   同じ節の不変条件「生データの走査を画面から行わない」と `07-nfr.md` §4.2 の CPU 10ms と両立しない。
   「保存しない」は **`metric` を 5 つに増やさない**（`dimension` で割る）という意味に読む。
4. **`metric='receptions'` を足す。** ANALYTICS-STAFF の「合計 328件」と ANALYTICS-WAIT の「受付 328件」は
   ご来店の受付（ウォークインを含む）の件数で、ANALYTICS-COUNT の 320 件（取消を含まない予約）とは別の母数である
   （`design/06-use-cases.md` §13）。§11.4 の 7 metric にこれを数えるものが 1 つも無い。
5. **`revisit_rate_90d`（率）を保存せず、`revisits_90d`（分子・件数）を保存する。** 率を日ごとに保存すると
   期間で足したときに「率の平均」になり、日ごとの母数の違いが消える。分母は `receptions`（同じ `dimension_key`）を使い、
   率は読み出し時に割って出す。小標本抑制（分母 20 件未満）はこの分母でしか判定できない。
6. **`metric='closed'` を足す。** 定休日の 0 件（`value=0` の行がある）と欠測（行が無い）を区別するために、
   日次 upsert が必ず 1 行書く「その日を集計した」という印を兼ねる。`closed=1` が定休・臨時休業、`closed=0` が営業日。
   `businessDays`（「1日あたり」の分母）と `pendingDays`（「〜日ぶんはまだ集計中です」）と
   `AnalyticsPoint.isClosed` の 3 つがこの 1 metric から出る。
7. **AC-ANA-21 の「26 日」は数え違いである。** 2026年8月は暦 31 日、火曜（4・11・18・25）が 4 日なので
   営業日は **27 日**になる。26 は ANALYTICS-COUNT のグラフが 1〜30 日の 30 本しか描いていない（8/31 が落ちている）ことに由来する。
   **実装は暦を正とする。** T-021 で spec を Approved に上げるとき、AC-ANA-21 の具体値を seed の実測値へ直す
   （「分母は営業日数（定休日・臨時休業を除く）」という定義そのものは変えない）。

---

## T-001 契約を書く（Red）

- **目的**: 分析の入出力の形を Zod で 1 か所に決め、**期間の上限・enum の既定値・「名」を持たないこと**を型で固定する。
- **触るファイル**
  - `packages/contracts/src/glasses_management.ts`（追記）
  - `packages/contracts/src/index.ts`（re-export に足す）
  - `packages/contracts/test/glasses_management.contract.test.ts`（追記）
- **先に書くテスト**（`pnpm --filter @app/contracts test`）
  このファイルの既存のテスト名は英語なので、**そのファイルの慣習に合わせて英語で書く**（サービス側のテストは日本語）。
  - `AnalyticsMetric` > `is an allow-list of eight metrics and fails closed on anything else`
  - `AnalyticsMetric` > `keeps overview separate from reservation_count — the top tab is its own request`
  - `AnalyticsQuery` > `defaults granularity to day and countBy to visit_date`
  - `AnalyticsQuery` > `accepts a range of exactly 400 days (2026-01-01 to 2027-02-04)`
  - `AnalyticsQuery` > `rejects a range of 401 days (2026-01-01 to 2027-02-05)`
  - `AnalyticsQuery` > `rejects a to earlier than from`
  - `AnalyticsQuery` > `accepts from equal to to — a single day is a valid range`
  - `AnalyticsQuery` > `requires a UUID storeId so a store slug cannot be smuggled in`
  - `AnalyticsQuery` > `rejects an unknown key so a stale client field never lands silently`
  - `AnalyticsPoint` > `defaults secondaryValue to null so a suppressed rate is not zero`
  - `AnalyticsPoint` > `bounds a rate secondaryValue to 0..1`
  - `AnalyticsPoint` > `carries isClosed and isOverTarget as booleans, never as a colour`
  - `AnalyticsSeries` > `requires a pattern of solid, hatch or dot`
  - `AnalyticsSeries` > `bounds name to 1..30 characters`
  - `AnalyticsReport` > `has no guests field — the mock's 名 is out until Q-11 is answered`
  - `AnalyticsReport` > `keeps target nullable because most tabs have no 目安`
  - `AnalyticsReport` > `requires businessDays and pendingDays to be non-negative integers`
  - `AnalyticsTargets` > `is the fixed all-store triple 8 / 10 / 90`
- **実装**
  - `AnalyticsMetric = z.enum(['overview','reservation_count','reservation_source','cancellation','visit_frequency','staff','purpose','wait_time'])`
  - `AnalyticsQuery = z.strictObject({ storeId: Uuid, metric: AnalyticsMetric, from: LocalDate, to: LocalDate,
    granularity: z.enum(['day','month','hour','weekday']).default('day'),
    countBy: z.enum(['visit_date','received_date']).default('visit_date') })`
    に `.refine()` を 2 本（`from <= to`／`to - from + 1 <= 400` 日）付ける。
  - `AnalyticsPoint = z.strictObject({ key: z.string().min(1).max(20), label: z.string().min(1).max(30),
    value: z.number().nonnegative(), secondaryValue: z.number().min(0).max(1).nullable().default(null),
    isClosed: z.boolean(), isOverTarget: z.boolean() })`
  - `AnalyticsSeries = z.strictObject({ name: z.string().min(1).max(30), pattern: z.enum(['solid','hatch','dot']),
    points: AnalyticsPoint.array() })`
  - `AnalyticsReport = z.strictObject({ metric, from, to, granularity, countBy, series: AnalyticsSeries.array(),
    summary: z.strictObject({ label: 1..30, value: 0..40文字の文字列, unit: 0..8文字, isOverTarget: boolean }).array().max(3),
    target: z.number().nullable(), suppressed: z.boolean(), businessDays: z.number().int().nonnegative(),
    pendingDays: z.number().int().nonnegative() })`
    `summary.value` を**文字列**にするのは「8分40秒」「8月15日」のように数字でない値が入るためである。
  - `AnalyticsTargets = z.strictObject({ waitMinutes: z.literal(8), cancellationRatePercent: z.literal(10),
    revisitWindowDays: z.literal(90) })`
  - `StoreIdQuery` が既にあればそれを使う。無ければ `z.strictObject({ storeId: Uuid })` として足す。
  - `LocalDate` / `Uuid` は既存のものを使い、**同じ意味のスキーマを 2 つ作らない**。
- **完了条件**: 契約テスト 18 本が緑。`packages/contracts` のカバレッジ 4 指標 80% 以上。
- **依存**: なし

## T-002 `analytics_daily` をスキーマに足す（Red → Green）

- **目的**: 日次集計の 1 表を作り、index が「実際に投げるクエリの形」（一意 upsert と期間読み出し）に合っていることを固定する。
- **触るファイル**
  - `services/glasses_management/src/worker/db/schema.ts`（追記）
  - `services/glasses_management/test/schema.test.ts`（追記）
  - `services/glasses_management/migrations/`（生成物。P9 は `0008_*.sql` になる想定）
- **先に書くテスト**（`getTableConfig` で index の名前と対象列を見る。`pnpm --filter @app/glasses_management test`）
  - `analytics_daily` > `日次 upsert の重複を組織・店舗・日・指標・切り口で止める`
  - `analytics_daily` > `期間指定の読み出しを組織・店舗・指標・日の順で引ける`
  - `analytics_daily` > `外部キーを持たない`
  - `analytics_daily` > `値は real で持つ（件数も率も中央値も 1 列に入る）`
  - `analytics_daily` > `dimension_key は NOT NULL で、total のときは空文字を入れる`
- **実装**
  - 列: `id`(text PK) / `organization_id` / `store_id` / `date`(`YYYY-MM-DD`・JST の暦日) /
    `metric` / `dimension` / `dimension_key` / `value`(real) / `created_at` / `updated_at`。
    すべて NOT NULL。FK を宣言しない。id は `crypto.randomUUID()`。
  - index 2 本:
    - `analytics_daily_org_store_date_metric_dim_idx`（**`uniqueIndex`**）
      `(organization_id, store_id, date, metric, dimension, dimension_key)`
    - `analytics_daily_org_store_metric_date_idx` `(organization_id, store_id, metric, date)`
  - `metric` の語彙は **8 値**: `closed` / `reservations` / `reservations_received` / `receptions` /
    `cancellations` / `no_shows` / `wait_seconds_median` / `revisits_90d`。
    **`guests` は書かない**（Q-11 のいまの前提）。
  - `dimension` の語彙は 6 値: `total` / `staff` / `purpose` / `hour` / `source` / `cancel_reason`。
    `dimension='total'` のとき `dimension_key=''`。`hour` は `14`（2 桁ゼロ埋めしない）。
    `staff` の担当未定は `unassigned`。
  - 語彙は `packages/contracts` の `z.enum` を単一ソースにし、**D1 に CHECK 制約を書かない**。
- **手順**: 編集 → `pnpm --filter @app/glasses_management db:generate` → 生成 SQL を目で読む
  （テーブル再作成が出ていたら手で直す）→ `db:migrate:local`
- **完了条件**: `migrations/0008_*.sql` が生成され、schema テスト 5 本が緑。
- **依存**: T-001

## T-003 期間の解決と目安の境界を書く（Red）

- **目的**: JST の暦日で期間を解くこと、目安の超過判定が「ちょうど」で倒れないことを、固定時刻で固定する。
- **触るファイル**: `services/glasses_management/test/analytics.time.test.ts`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test`。**時刻は必ず引数で注入し、`Date.now()` を書かない**）
  - 期間の解決 > `2026-08-27T14:59:59.999Z は JST の 2026-08-27 に落ちる`
  - 期間の解決 > `2026-08-27T15:00:00.000Z は JST の 2026-08-28 に落ちる（日跨ぎ）`
  - 期間の解決 > `2025-12-31T15:00:00.000Z は JST の 2026-01-01 に落ちる（年跨ぎ）`
  - 期間の解決 > `2026年8月の単月は 2026-08-01 から 2026-08-31 の 31 日`
  - 期間の解決 > `2026年2月の単月は 28 日、2028年2月は 29 日（うるう年）`
  - 期間の解決 > `トップの前後7日は 2026-08-27 を中心に 2026-08-20 から 2026-09-03 の 15 日（月跨ぎ）`
  - 期間の解決 > `週の区切りは月曜始まりで、先週 8/17〜8/23・今週 8/24〜8/30・来週 8/31〜9/6 になる`
  - 期間の解決 > `取り消しのレンジ 2026-03 から 2026-08 は 2026-03-01 から 2026-08-31 になる`
  - 期間の解決 > `2026-01-01 から 2027-02-04 は 400 日で通り、2027-02-05 は 401 日で 400 を返す`
  - 営業日数 > `2026年8月は暦 31 日から火曜 4 日を引いて 27 日（AC-ANA-21 の 26 は 8/31 を数え落としている）`
  - 営業日数 > `臨時休業の 1 日も分母から抜く`
  - 目安の境界 > `お待ち時間 480 秒（8分ちょうど）は超過にしない`
  - 目安の境界 > `お待ち時間 481 秒（8分1秒）は超過にする`
  - 目安の境界 > `取消率 10.0% は超過にしない`
  - 目安の境界 > `取消率 10.04% は 10.0% に丸まるので超過にしない`
  - 目安の境界 > `取消率 10.05% は 10.1% に丸まるので超過にする`
  - 再来の窓 > `来店から 90 日ちょうどの再来は数える。91 日目は数えない`
- **実装の前提**: 対象は `src/worker/domain/analytics.ts` の純関数
  `resolveRange(kind, anchor, now)` / `businessDaysIn(range, closedDates)` / `isOverWaitTarget(seconds, targets)` /
  `isOverCancellationTarget(rate, targets)` / `roundRate1(rate)` / `isRevisitWithinWindow(a, b, targets)`。
  JST の変換は `@app/shared` の `toJstDateString` / `toJstMonthKey` / `jstDaysBetween` を使い、自前で書き直さない。
  率の丸めは `Math.round(rate * 1000) / 10`（％の小数第 1 位）に統一する。
- **完了条件**: 17 本が「関数が無い」理由で赤い（緑にするのは T-008）。
- **依存**: T-001

## T-004 8 タブ分の応答テストを書く（Red）

- **目的**: 8 タブが返す形と数字を固定する。とくに「名」が 1 か所も出ないこと、「1日あたり」の分母が営業日数であることを固定する。
- **触るファイル**: `services/glasses_management/test/analytics.integration.test.ts`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test`）
  - トップ > `前後7日の 15 点を返し、本日の点に isToday ではなく label「8/27 本日」が付く`
  - トップ > `まとめは 先週・今週・来週 の 3 行で、単位は「件」だけになる`
  - トップ > `応答のどこにも「名」が現れない（JSON を文字列にして検査する）`
  - トップ > `analytics_daily に metric='guests' の行を 1 つも書かない`
  - 予約数 > `集計の種類 4 択 × かぞえる日 2 択 の 8 通りがすべて 200 で返る`
  - 予約数 > `ご来店日と受付日で同じ月の合計が異なる（同じ予約が別の日に落ちる）`
  - 予約数 > `時間帯別にすると点の key が 10..18 になり、日付が 1 つも出ない`
  - 予約数 > `曜日別にすると点が 7 つになり、月別にすると期間の月数と同じ数になる`
  - 予約数 > `まとめは 合計・1日あたり・最も多い日 の 3 つだけで、4 つ目を返さない`
  - 予約数 > `1日あたりは 合計 ÷ businessDays で、暦日数では割らない`
  - 予約数 > `取り消した予約を合計に含めない`
  - 担当者 > `各点の value の合計が まとめの合計件数と一致する`
  - 担当者 > `件数 0 の担当も点として返る`
  - 担当者 > `担当が未定は key='unassigned' で並びの最後に来て、secondaryValue は常に null`
  - お待ち時間 > `中央値は received から最初の consulting までの秒差から出る`
  - お待ち時間 > `中央値であって平均ではない（外れ値 1 件で動かない）`
  - お待ち時間 > `まとめに 前の月の中央値と 受付件数の母数が入る`
  - お待ち時間 > `受付 0 件の時間帯は点を返さない（軸だけ残す）`
  - 取り消し > `凡例は 5 本で、名前が CHANGE-CANCEL の 4 択と 1 字も違わない`
  - 取り消し > `5 層は排他で、層の合計がその月の取消件数と一致する`
  - 取り消し > `取消率の分母は 予約数 + 取消件数（来店予定だった総数）である`
  - 取り消し > `取消が 0 件の月は点を返さない`
  - 予約の入口 > `お電話・店頭・Web予約・ウォークイン の 4 系列を返す`
  - 来店回数 > `初めて・2回目・3〜5回・6回以上 の 4 階級を返す`
  - ご来店の目的 > `目的ごとの件数を返し、削除済みの目的も期間内に予約があれば残す`
  - 8 タブ共通 > `どの metric でも series が 1 つ以上あり、summary が 3 つ以下である`
  - 目安 > `GET /api/staff/analytics/targets が 8 / 10 / 90 を返す`
- **完了条件**: 27 本が「ルートがまだ無い」理由で赤い（緑にするのは T-011）。
- **依存**: T-002

## T-005 小標本抑制と欠測のテストを書く（Red）

- **目的**: 「根拠にできない数字を数字として出さない」という一番の主張を、境界値で固定する。
- **触るファイル**: `services/glasses_management/test/analytics.integration.test.ts`（追記）
- **先に書くテスト**
  - 小標本 > `分母 20 件ちょうどの担当は率を返す`
  - 小標本 > `分母 19 件の担当は secondaryValue が null になり、件数は返る`
  - 小標本 > `伏せた行があっても report.suppressed は担当者タブでは false のまま（点ごとの話である）`
  - 小標本 > `取消率の分母が 19 のとき report.suppressed が true になり、まとめの率が「—」で返る`
  - 小標本 > `担当が未定は分母 40 件でも secondaryValue が null`
  - 欠測 > `closed の行が無い日は点を返さず、pendingDays に数える`
  - 欠測 > `closed=1 の日は value=0 の点を返し、isClosed が true になる`
  - 欠測 > `closed=0 で予約が 0 件の日は value=0・isClosed=false の点を返す（定休と区別する）`
  - 欠測 > `期間の 15 日のうち 2 日が未集計なら pendingDays=2 を返す`
  - 欠測 > `businessDays は closed=0 の日数だけを数え、未集計の日を営業日に数えない`
- **完了条件**: 10 本が「ルートがまだ無い」理由で赤い（緑にするのは T-011）。
- **依存**: T-002

## T-006 権限マトリクスに 2 経路を足す（Red）

- **目的**: 分析が `analytics.read` でしか開けないこと、期限切れ（401）と権限不足（403）を取り違えないことを固定する。
- **触るファイル**: `services/glasses_management/test/permissions.test.ts`（表に 2 行）/ `test/helpers.ts`（必要なら
  membership を配るヘルパを足す）
- **先に書くテスト**: 主体 × 経路の表に次の 2 経路を足す。
  - `GET /api/staff/analytics?storeId=...&metric=overview&from=...&to=...`
  - `GET /api/staff/analytics/targets?storeId=...`

  主体ごとの期待値:

  | 主体 | 期待 |
  |---|---|
  | 未認証 | 401 |
  | 期限切れトークン（固定の過去時刻から作る） | 401 |
  | 別 secret で署名したトークン | 401 |
  | `analytics.read` を持たない staff | **403** |
  | `analytics.read` を持つ staff（店長） | 200 |
  | 別 org のトークン | 403（未同期なら 503。**取り違えない**） |
  | 未知パス `/api/staff/analytics/not-a-route` | 401（未認証）/ 404（認証済み） |

  加えて 1 本: `storeId` を渡さない要求は **400**（認可の前に入力検証で落ちる）。
- **完了条件**: 表の 15 本が「ルートがまだ無い」理由で赤い（緑にするのは T-011）。
  **新しいルートを足したらこの表に 1 行足す**という決めを崩さない。
- **依存**: T-002

## T-007 テナント分離に分析の観点を足す（Red）

- **目的**: 他社・担当外の店舗の数字が 1 件も混ざらないことを、3 テナント同時と偽装入力で潰す。
- **触るファイル**: `services/glasses_management/test/tenant-isolation.test.ts`（追記）
- **先に書くテスト**
  - `3 テナントが同じ期間・同じ指標を集計しても、数字が互いに混ざらない`
  - `他組織の storeId を渡しても 403 で、その店舗が存在するかどうかも分からない`
  - `query の organizationId を混ぜても、JWT の org でしか集計しない`
  - `日次 upsert が他組織の行を 1 行も書き換えない（同じ日・同じ指標でも組織で分かれる）`
  - `担当していない自組織の店舗も 403 になる（membership が無ければ通さない）`
  - `テナントのトークンでは内部 API（保守）に触れない`
- **注意**: D1 はテストファイル内で共有されるので、組織 id は毎回 `crypto.randomUUID()` で作る。
- **完了条件**: 6 本が「ルートがまだ無い」理由で赤い（緑にするのは T-011）。
- **依存**: T-002

## T-008 `domain/analytics.ts` を実装する（Green）

- **目的**: T-003 を緑にする。期間・中央値・率・小標本抑制・目安の判定を、時刻を引数で受ける純関数にする。
- **触るファイル**: `services/glasses_management/src/worker/domain/analytics.ts`（新規）
- **実装**
  - `resolveRange(kind: 'month'|'range'|'around', anchor, now): { from, to }`。
    `around` は `now` の JST 暦日を中心に前後 7 日（15 日）。`month` は月初と月末。`range` は開始月の 1 日と終了月の末日。
  - `weekBuckets(now)` — 月曜始まりで 先週・今週・来週 の 3 区間を返す。
  - `businessDaysIn(dates, closedByDate)` — `closed=0` の日数を数える。**未集計の日を営業日に数えない**。
  - `pendingDaysIn(range, seenDates)` — `closed` の行が無い暦日の数。
  - `medianOf(values: number[])` — 偶数個は中央 2 つの平均。空配列は `null`。
  - `weightedMedian(samples: { value, weight }[])` — 重みの累計が総重みの半分**以上**になった最初の標本の値。
    月の中央値は「日ごとの中央値（`dimension='total'`）を、その日の受付件数で重み付けした加重中央値」で出す。
    生の 328 件を走査しない（§11.4 の不変条件）ため厳密な中央値と一致しないことがある旨を、
    **関数の直上のコメントに残す**。
  - `rateOrNull(numerator, denominator, threshold = 20)` — 分母が閾値未満なら `null`。分母 0 も `null`。
  - `SMALL_SAMPLE_THRESHOLD = 20` / `UNASSIGNED_KEY = 'unassigned'` をこのファイルから export する。
  - `roundRate1(rate)` = `Math.round(rate * 1000) / 10`。
  - `isOverWaitTarget(seconds, targets)` = `seconds > targets.waitMinutes * 60`。
  - `isOverCancellationTarget(rate, targets)` = `roundRate1(rate) > targets.cancellationRatePercent`。
  - `ANALYTICS_TARGETS = { waitMinutes: 8, cancellationRatePercent: 10, revisitWindowDays: 90 }` を定数として持つ。
    **店舗ごとの上書きを受け取る引数を作らない**（作ると設定画面が無いことと矛盾する）。
  - `formatSeconds(seconds)` = `8分40秒` の形（0 秒は `0分0秒`、60 秒未満でも「分」を落とさない）。
  - **`Date.now()` を 1 度も書かない。** 時刻は必ず引数で受ける。
- **完了条件**: `analytics.time.test.ts` の 17 本が緑。
- **依存**: T-003

## T-009 `domain/analytics-rollup.ts` を実装する（Green）

- **目的**: 1 店舗 1 日分の生データを 8 metric の行に畳む純関数を書く。ここが分析の数字の出どころになる。
- **触るファイル**: `services/glasses_management/src/worker/domain/analytics-rollup.ts`（新規）/
  `services/glasses_management/test/analytics-rollup.test.ts`（新規）
- **先に書くテスト**（実装より先に書く）
  - `rollupDay` > `定休日は closed=1 と reservations=0 の 2 行を必ず書く`
  - `rollupDay` > `営業日は closed=0 を書く（行があること自体が「集計済み」の印になる）`
  - `rollupDay` > `reservations は status が cancelled と no_show の予約を数えない`
  - `rollupDay` > `reservations_received は created_at の JST 暦日で数える`
  - `rollupDay` > `receptions は予約の受付とウォークインの両方を数える`
  - `rollupDay` > `receptions は dimension=staff / hour / total の 3 通りを書く`
  - `rollupDay` > `cancellations を 5 層へ排他に割る（no_show → web → customer → store → duplicate の順で当てる）`
  - `rollupDay` > `no_shows の total は cancellations の no_show 層と必ず一致する`
  - `rollupDay` > `wait_seconds_median は received から最初の consulting までの差で、consulting が無い人を数えない`
  - `rollupDay` > `wait_seconds_median は dimension=hour（受付した時間帯）にも書く`
  - `rollupDay` > `revisits_90d は「その日の来店客のうち 90 日以内に再来した人数」を担当ごとに書く`
  - `rollupDay` > `guests の行を 1 つも作らない`
  - `rollupDay` > `1 件も無い日でも closed の行だけは書く（欠測にしない）`
- **実装**
  - `rollupDay(input, now): AnalyticsRow[]` — 入力は 1 店舗 1 日分の
    `reservations` / `reservationAssignments` / `walkIns` / `visitEvents` / `staff` / `businessHours` / `calendarExceptions`。
    **DB に触らない純関数**にする（I/O は呼び出し側）。
  - 5 層の割り当ては**この順で上から当て、最初に当たったものだけに数える**（排他）:
    `status='no_show'` → `status='cancelled' AND source='web'` → `cancel_reason='customer'` →
    `'store'` → `'duplicate'`。どれにも当たらない `cancelled` は `customer` に寄せず、
    **`other` を作らずに落とし、その事実を戻り値の `dropped` に数える**（データの壊れを黙って丸めない）。
  - `dimension_key` は `staff` なら `staff.id`（未割当は `unassigned`）、`hour` なら `10`〜`18`（ゼロ埋めしない）、
    `source` なら `phone`/`counter`/`walkin`/`web`、`cancel_reason` なら上の 5 語。
  - 日付は必ず `toJstDateString()` を通す。**UTC の暦日で数えない**。
- **完了条件**: 13 本が緑。
- **依存**: T-008

## T-010 日次 Cron に集計を載せる（Green）

- **目的**: 当日分と前日分を毎日 upsert し、25 か月より古い行を消す。画面から生データを走査しない状態を作る。
- **触るファイル**
  - `services/glasses_management/src/worker/index.ts`（`POST /api/internal/maintenance/analytics/rollup` と `scheduled`）
  - `services/glasses_management/wrangler.jsonc`（`triggers.crons`。**P7 が先に足していれば触らない**）
  - `services/glasses_management/worker-configuration.d.ts`（`pnpm -r cf-typegen` の生成物）
  - `services/glasses_management/test/analytics.integration.test.ts`（保守の経路のテストを追記）
- **先に書くテスト**
  - 保守 > `共有鍵なしでは 401、正しい鍵で 200`
  - 保守 > `now を注入でき、当日分と前日分の 2 日を upsert する`
  - 保守 > `2 回続けて呼んでも行が重複しない（一意 index が効く）`
  - 保守 > `25 か月より古い行を消し、24 か月前の行は残す`
  - 保守 > `1 店舗で失敗しても残りの店舗の集計を止めない（失敗件数を返す）`
- **実装**
  - `POST /api/internal/maintenance/analytics/rollup`（共有鍵。`AnalyticsRollupRequest`）—
    `now`（テストの注入口）と `days`（既定 2）と `limit`（既定 100 店舗）を受ける。
    1. 有効な店舗を組織横断で引く（内部 API なのでテナント JWT は無い）。
    2. 店舗ごとに 1 日分の生データを引き、`rollupDay()` に渡す。
    3. 返った行を `db.batch()` で upsert する（`onConflictDoUpdate` の target は一意 index の 6 列）。
    4. 1 店舗が throw しても try/catch で握り、`failed` に数えて次へ進む。
    5. 保持期限（25 か月 = 24 か月＋当月）より古い `date` の行を消す。
    6. `AnalyticsRollupResult`（`stores` / `days` / `rows` / `deleted` / `failed`）を返す。
  - `wrangler.jsonc`: `triggers.crons` が**無ければ** `"55 14 * * *"` を足す（UTC。**JST 23:55** の意図をコメントに残す）。
    **あれば足さない**（アカウント全体の枠は 5 本。P7 と 2 本使わない）。
  - `export default { fetch: app.fetch, scheduled }` の `scheduled` に、集計の呼び出しを
    **try/catch で包んだ 1 行**として足す。1 つが失敗しても後続（録音の掃除・Web 予約の自動取消）を止めない。
  - binding を変えたら `pnpm -r cf-typegen` を回す。
- **完了条件**: 5 本が緑。`pnpm --filter @app/glasses_management typecheck` が緑。
- **依存**: T-009

## T-011 ルート 2 本を実装する（Green）

- **目的**: T-004〜T-007 を緑にする。読み出しは `analytics_daily` だけを見る。
- **触るファイル**
  - `services/glasses_management/src/worker/index.ts`（チェーンに 2 本足す）
  - `services/glasses_management/src/worker/store-permission.ts`（P1 の実装に引数を 1 つ足す）
  - `services/glasses_management/src/worker/domain/analytics-report.ts`（新規。行 → `AnalyticsReport` の組み立て）
- **実装**
  - `requireStorePermission(perm, { storeIdFrom: 'param' | 'query' } = {})` に拡張する。
    既定は `'param'` のままなので **P1 が付けた 27 本のルートは 1 行も変わらない**。分析は `'query'` を渡す。
  - `GET /api/staff/analytics` — `zValidator('query', AnalyticsQuery)` →
    `requireStorePermission('analytics.read', { storeIdFrom: 'query' })` →
    metric ごとに必要な行だけを `analytics_daily` から読む。**D1 のクエリは 4 本以内**（`07-nfr.md` §4.2 の 16 本の上限に対し十分に余裕を取る）。

    | metric | 読む metric 行 |
    |---|---|
    | `overview` | `reservations`(total) / `closed` |
    | `reservation_count` | `reservations` または `reservations_received`(total ＋ granularity に応じた dimension) / `closed` |
    | `reservation_source` | `reservations`(source) / `closed` |
    | `cancellation` | `cancellations`(cancel_reason) / `reservations`(total) / `no_shows`(total) / `closed` |
    | `visit_frequency` | `receptions`(total) ＋ 来店回数の階級（`dimension='purpose'` ではなく `source` を使わず、**専用の `dimension_key` を持たないので `customers.visit_count` の階級を rollup が `dimension='hour'` に混ぜない**。階級は `dimension='total'` の `metric='receptions'` を階級ごとの `dimension_key` に割って持つ） |
    | `staff` | `receptions`(staff) / `revisits_90d`(staff) / `closed` |
    | `purpose` | `reservations`(purpose) / `closed` |
    | `wait_time` | `wait_seconds_median`(total, hour) / `receptions`(total, hour) ＋ **前の月**の `wait_seconds_median`(total) |

  - 応答は必ず `AnalyticsReport.parse()` を通してから `c.json()` する。
  - 「—」は `secondaryValue: null` と `suppressed: true` で表す。**サーバは文字列の「—」を返さない**（描き方は画面が決める）。
  - `businessDays` / `pendingDays` は `closed` の行から出す。
  - `GET /api/staff/analytics/targets` — `StoreIdQuery` を受け、`requireStorePermission('analytics.read', { storeIdFrom: 'query' })`
    を通し、**定数**を返す。D1 を 1 回も読まない。
  - ルートは**チェーン**に足し、`export type AppType = typeof routes` を保つ。
  - 全クエリを JWT の `org` と query の `storeId`（membership で検証済み）で絞る。
    **query / body の `organizationId` を認可の根拠にしない。**
- **完了条件**: `pnpm --filter @app/glasses_management test` が緑。Worker 側カバレッジ 4 指標 80% 以上。
- **依存**: T-004, T-005, T-006, T-007, T-008

## T-012 画面の計画とタブ共通の器を作る（Red → Green）

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 店長が朝礼の前に 1 枚だけ開いて、今日の入り具合と先週との差を読む面。
  - トークン計画: 面は白（`--color-surface`）1 枚と下地（`--color-paper`）の 2 段だけ。緑（`--color-pine`）は
    選択中のタブの下線・「適用」・棒の塗りの 3 つに限る。赤（`--color-danger`）は目安を超えたときだけに使う。
    角は 12px（`rounded-card`・期間の札）と 16px（`rounded-panel`・カード）の 2 段。
  - シグネチャ: **数字を箱に入れない**。まとめは罫線 1 本だけで区切り、下 1/3 が空いている状態を正しい状態として保つ。
- **見るべきモックと実測値**（`docs/frontend/mockups/eyex/images/` を **Read で実際に見る**）
  - ANALYTICS-TOP / ANALYTICS-COUNT / ANALYTICS-STAFF / ANALYTICS-WAIT / ANALYTICS-CANCEL（すべて 1194×834。
    実装が持つ描画領域はステータスバー 24px を除いた **1194×810**）
  - 上のバー 64px（P0 の `AppShell`）。サイドバーは**たたんだ柱 76px が既定**（分析 5 面すべて）。
  - タブ帯: 高さ 46px ＋ 下罫 1px、地は白、左右の余白 16px、タブ間 4px。
    タブは高さ 46px・左右 16px・15px の太字・色 `--color-ink-muted`。
    選択中だけ色 `--color-pine` と下辺 3px の `--color-pine`。並びは
    **トップ / 予約数 / 予約の入口 / 取り消し / 来店回数 / 担当者 / ご来店の目的 / お待ち時間** の 8 つ固定。
  - ツールバー: 高さ 56px ＋ 下罫 1px、地は白、左右の余白 16px、要素間 10px。
    見出し 18px 太字（タブ名と同じ語）／「対象の期間」13px `--color-ink-muted`／
    期間の札は高さ 44px・左右 14px・角 12px・縁 1px `--color-line-strong`・15px 太字／
    「適用」は高さ 44px・左右 22px・緑地に白・15px／右端に「店舗：銀座店 ▾」（同じ札。`margin-left:auto`）。
  - 本文の余白: 上下 32px・左右 40px、節の間 32px（予約数だけ 28px）。
- **触るファイル**
  - `services/glasses_management/src/web/analytics/AnalyticsScreen.tsx`（新規。8 タブの器）
  - `services/glasses_management/src/web/analytics/tabs.ts`（新規。タブの並びと metric の対応）
  - `services/glasses_management/src/web/analytics/Toolbar.tsx`（新規。期間・適用・店舗）
  - `services/glasses_management/src/web/analytics/describe.ts`（新規。定義文を組む純関数）
  - `services/glasses_management/src/web/App.tsx`（`current === 'analytics'` でこの画面を出す）
  - `services/glasses_management/src/web/analytics/AnalyticsScreen.test.tsx`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test:web`）
  - タブ > `8 つのタブが決まった並びで出る`
  - タブ > `いま開いているタブが読み上げで分かる（aria-selected）`
  - タブ > `押しても何も出ないタブが 1 つも無い（8 つすべてでグラフ 1 つと定義の 1 行が出る）`
  - ツールバー > `対象の期間を変えるだけでは数字が変わらない`
  - ツールバー > `適用を押したときにだけ集計し直す`
  - ツールバー > `取り消しのタブだけ期間の札が 2 つ並ぶ`
  - ツールバー > `店舗を変えて適用すると、その店舗の数字に入れ替わる`
  - 定義の 1 行 > `何を・いつを基準に・どれだけの母数で数えたかが 1 行で読める`
  - 読み込み中 > `読み込んでいる間は前の数字を残さず、読み込み中であることを出す`
  - 空 > `期間に 1 件も無ければ、その事実だけを 1 行で出す`
  - エラー > `読めなかったときは理由と次の行動を出し、グラフの枠を残さない`
- **実装**
  - タブは `role="tablist"` / `role="tab"` / `aria-selected`。当たり判定 46px（HIG の 44pt を満たす）。
    URL は `?tab=top|count|source|cancel|visits|staff|purpose|wait`。
  - **「適用」を押すまで集計しない。** 下書きの状態（`draft`）と適用済みの状態（`applied`）を別々に持ち、
    `applied` が変わったときだけ `GET /api/staff/analytics` を叩く。
  - 1 タブの初回描画で叩く API は **1 本**（`07-nfr.md` §4.1）。目安は `GET .../targets` を
    **画面に入ったときの 1 回だけ**取って保持し、タブを移るたびに取り直さない。
  - 期間の選択肢は当月から 24 か月遡って作る（`analytics_daily` の保持が 25 か月なので、それ以上を選ばせない）。
  - `pendingDays > 0` のとき、ツールバーの**下**に「〜日ぶんはまだ集計中です」を 1 行だけ出す。
  - 色・寸法は `packages/ui/src/theme.css` のトークン経由のみ。Tailwind 既定パレットと任意値を書かない。
- **完了条件**: 11 本が緑。
- **依存**: T-011

## T-013 グラフの部品を作る（Red → Green）

- **目的**: 5 種類のグラフ（縦棒・積み上げ・横棒・目安線つき縦棒）を 1 組の部品で組み、
  **色以外でも系列を見分けられる**ことを部品の側で保証する。
- **触るファイル**
  - `services/glasses_management/src/web/analytics/charts.tsx`（新規）
  - `services/glasses_management/src/web/analytics/patterns.css`（新規）
  - `services/glasses_management/src/web/analytics/charts.test.tsx`（新規）
- **先に書くテスト**
  - 縦棒 > `点の数だけ棒が出て、値 0 の棒も軸の位置を保つ`
  - 縦棒 > `定休日の棒は 0 の高さで描かれ、ラベルに「定休」が付く`
  - 縦棒 > `本日の列だけ地色が変わり、ラベルが太字になる`
  - 積み上げ > `層の順が凡例の順と一致し、0 件の層を描かない`
  - 横棒 > `最大件数の行を 100% とし、0 件の行は長さ 0 で描く`
  - 目安線 > `目安の値に破線が引かれ、「目安 8分」の札が線の上に出る`
  - 凡例 > `どの系列も 塗り・地模様・系列名の文字 の 3 つを持つ`
  - 凡例 > `塗りを外しても地模様と文字だけで系列を見分けられる`
  - 代替テキスト > `最も多い点とその値、定休日が 0 件であること、未集計の日があることが 1 文で読める`
- **実装**
  - `<BarChart>` / `<StackedBarChart>` / `<RowBars>` / `<Legend>` / `<TargetLine>` の 5 つだけを export する。
  - **寸法の実測値**（すべてモックから）:
    - プロットの高さ 200px、y 軸の幅 40px（お待ち時間だけ 46px）。
    - 目盛りは 5 本（トップ・予約数は 0/6/12/18/24、取り消しは 0/10/20/30/40、
      お待ち時間は 0分/5分/10分/15分＝ bottom 0/67/133/200）。罫線は 1px の `--color-line`、
      いちばん下だけ `--color-line-strong`。
    - 棒の幅は列の 62%（予約数だけ 74%）、列の間は トップ 12px / 予約数 6px / お待ち時間 16px / 取り消し 24px。
    - x 軸のラベルは 13px、棒の 26px 下。本日の列は地が `--color-pine-soft`、角 4px 4px 0 0、ラベルは太字 `--color-pine-deep`。
    - お待ち時間の目安線は bottom 107px の 2px 破線 `--color-pine`、札は左端・bottom 111px・上下 1px 左右 8px・
      角 8px・緑地に白の 13px 太字。棒の上の値ラベルは 13px（超過の列だけ `--color-danger` の太字）。
    - 取り消しの積み上げは 1 本 104px 幅。
    - 担当者の横棒は 高さ 18px・角 4px、地 `--color-surface-2`、塗り `--color-pine`（担当未定だけ `--color-danger`）。
  - **地模様**: `patterns.css` に `.pattern-hatch`（45° の 2px 斜線・6px 間隔）と `.pattern-dot`（2px の点・4px 間隔）の
    2 クラスだけを置き、色は `currentColor` で受ける。トークンの色は `text-pine` / `text-danger` / `text-web` で当てる。
    **任意値のユーティリティ（`bg-[#hex]`・`p-[13px]`）を 1 つも書かない。**
  - データで決まる寸法（棒の高さ・横棒の幅）だけ `style` に置く。色・角・余白はトークンのユーティリティで書く。
  - グラフの外枠に `role="img"` と `aria-label` を必ず付ける。ラベルは呼び出し側が文で渡す。
- **完了条件**: 9 本が緑。web 側カバレッジ 4 指標 60% 以上を保つ。
- **依存**: T-012

## T-014 タブ「トップ」を実装する（Red → Green）

- **目的**: 朝礼で最初に開く 1 枚を立てる。前後 7 日の入り具合と週の 3 行だけを出し、「名」を 1 か所も出さない。
- **見るべきモック**: `ANALYTICS-TOP.png`（1194×834）。棒 15 本（8/20〜9/3）、
  8/25 と 9/1 は高さ 0 で「8/25 定休」「9/1 定休」、8/27 の列だけ地が緑の薄色でラベルが「8/27 本日」の太字。
  カードは 白地・1px の罫・角 16px・上下 20px 左右 22px。見出し 20px 太字＋補足 13px（左に 12px 空ける）。
  「週の予約」は箱に入れず、罫線 1 本ずつで 3 行（行の上下 16px）。行のグリッドは 88px / 1fr / 132px、
  週の名前 16px 太字、日付 13px `--color-ink-muted`、件数は右寄せの 20px 等幅太字＋「件」13px。今週の行だけ名前が緑。
- **触るファイル**: `services/glasses_management/src/web/analytics/TopTab.tsx`（新規）/ `TopTab.test.tsx`（新規）
- **先に書くテスト**
  - `グラフが 1 つだけ出る（白い箱は 1 枚）`
  - `見出しに「予約の入り具合」と「本日を中心に前後7日／件数・火曜は定休日です」が出る`
  - `本日の棒だけが「8/27 本日」の見出しで強調される`
  - `週の予約は 先週・今週・来週 の 3 行で、今週の行だけ色が変わる`
  - `どの行にも「名」の数字が出ない`
  - `定休日は 0 件の棒として描かれ、未集計の日は棒を描かない`
  - `未集計の日があると「2日ぶんはまだ集計中です」が 1 行だけ出る`
  - `読み上げの文に 最も多い日と件数・定休日が 0 件であること・未集計の日があることが入る`
- **実装**
  - `metric='overview'`、`granularity='day'`、期間は本日を中心に前後 7 日。
  - 「名」の列を **DOM に作らない**（`design/09-open-questions.md` Q-11 のいまの前提。答えが来たら
    `guest_count` を足したうえで列を戻す。決定ブリーフ §3 に無い列なのでそのとき人間の承認を取る）。
  - **下 1/3 が空いているのは正しい状態**（`mockups/eyex/README.md` の引き算の表）。埋めるために要素を足さない。
- **完了条件**: 8 本が緑。
- **依存**: T-013

## T-015 タブ「予約数」を実装する（Red → Green）

- **目的**: 集計の種類 4 択 × かぞえる日 2 択をキーボードだけでも切り替えられるようにし、
  「1日あたり」の分母が営業日数であることを画面から読めるようにする。
- **見るべきモック**: `ANALYTICS-COUNT.png`。切り口の帯（本文の上端）→ カード → まとめの 3 つ。
  切り口の札は 高さ 44px・左右 16px・角は丸ごと丸い・縁 1px `--color-line-strong`・16px。
  選択中だけ 縁 2px `--color-pine`・地 `--color-pine-soft`・文字 `--color-pine-deep`・太字。
  丸印は 18px（中の点 10px）。「集計の種類」と「かぞえる日」の間に 1px×28px の縦罫（左右 14px）。
  群のラベルは 13px `--color-ink-muted`。まとめは 3 列等分・ラベル 13px・数字 24px 等幅太字（日付だけ 22px の和文太字）。
- **触るファイル**: `services/glasses_management/src/web/analytics/CountTab.tsx`（新規）/
  `services/glasses_management/src/web/analytics/SegmentedRadio.tsx`（新規）/ 各 `*.test.tsx`
- **先に書くテスト**
  - `集計の種類は 日別・月別・時間帯別・曜日別 の 4 択で、いま選ばれている 1 つが読み上げで分かる`
  - `かぞえる日は ご来店日・受付日 の 2 択で、群に「かぞえる日」の名前が付く`
  - `矢印キーだけで選び替えられ、Tab では群を 1 つ飛び越す（roving tabindex）`
  - `かぞえる日を 受付日 に変えて適用すると、同じ月でも合計が変わる`
  - `集計の種類を 時間帯別 に変えて適用すると、横軸が「10時台」「11時台」に変わる`
  - `グラフの下は 8月の合計・1日あたり・最も多い日 の 3 つだけで、4 つ目を置かない`
  - `1日あたりは 合計 ÷ 営業日数 で、営業日数が定義文から読める`
  - `合計に「名」を添えない`
- **実装**
  - `SegmentedRadio` は `role="radiogroup"` + `role="radio"` + `aria-checked` + roving tabindex。
    ← → ↑ ↓ で移動し、移動と同時に選択が移る（WAI-ARIA の radio group の作法）。
    **モックが紙の再現のために置いている `<span role="radio">` の偽の印をそのまま写さない。**
  - 「1日あたり」は `report.summary` の値をそのまま出す。**画面側で割り直さない**（分母がずれる）。
  - 定義文（`describe.ts`）に「2026年8月／火曜（4・11・18・25日）は定休日です」と、
    分母が営業日数であることを 1 行で書く。
- **完了条件**: 8 本が緑。
- **依存**: T-013

## T-016 タブ「担当者」を実装する（Red → Green）

- **目的**: 担当ごとの件数を横棒で並べ、標本が足りない再来率を「0%」ではなく「—」として出す。
- **見るべきモック**: `ANALYTICS-STAFF.png`。カード 1 枚に見出し＋列見出し＋7 行。
  行のグリッドは 290px / 1fr / 108px / 140px、列の間 20px、行の上下 16px、行の上に 1px の罫（先頭行だけ罫なし）。
  名前 16px 太字＋技能 13px `--color-ink-muted`（左に 10px）。横棒は 高さ 18px・角 4px・地 `--color-surface-2`。
  件数は右寄せの 20px 等幅太字＋「件」13px。再来は右寄せの 16px `--color-ink-muted`。
  列見出しは 13px（上 4px・下 10px）。「担当が未定」の行だけ名前・件数・棒が `--color-danger`、再来は「—」。
- **触るファイル**: `services/glasses_management/src/web/analytics/StaffTab.tsx`（新規）/ `StaffTab.test.tsx`（新規）
- **先に書くテスト**
  - `見出しに「担当者ごとの件数」と「2026年8月／ご来店日でかぞえます　合計 328件」が出る`
  - `列見出しに「件数」と「90日以内の再来」が出る`
  - `各行の件数の合計が見出しの合計と一致する`
  - `最大件数の担当の棒が 100% になる`
  - `件数 0 の担当も行として出て、棒の長さが 0 になる`
  - `担当が未定の行は並びの最後に出て、件数は数字・再来は「—」になる`
  - `標本が 20 件に満たない担当は再来が「—」になり、件数はそのまま読める`
  - `「担当が未定」は色だけでなく「担当が未定」の文字で見分けられる`
  - `店舗を丸の内店に変えて適用すると、銀座店だけにいる担当の行が消える`
- **実装**
  - 「—」は `secondaryValue === null` のときに出す。**0% と「—」を取り違えない。**
  - 並びは件数の多い順。`unassigned` だけは件数によらず最後に固定する。
  - 赤い行に必ず「担当が未定」の文字を添える（`07-nfr.md` §2.4）。
- **完了条件**: 9 本が緑。
- **依存**: T-013

## T-017 タブ「お待ち時間」を実装する（Red → Green）

- **目的**: 受付からご相談開始までの中央値を主役にし、目安 8 分の超過を色と文字の両方で示す。
- **見るべきモック**: `ANALYTICS-WAIT.png`。上に中央値の塊（カードに入れない）、下にカード 1 枚。
  ラベル 13px `--color-ink-muted`、中央値 52px 等幅太字（超過のとき `--color-danger`）、
  その 14px 下に 札「目安 8分を超えています」（`--color-danger-soft` の地・`--color-danger` の縁と文字・12px 太字）と
  補足 13px を 14px 空けて並べる。カードの見出しは「時間帯ごとのお待ち時間」20px＋「中央値」13px、
  凡例はカード見出しの右端。棒 9 本（10時台〜18時台）。
- **触るファイル**: `services/glasses_management/src/web/analytics/WaitTab.tsx`（新規）/ `WaitTab.test.tsx`（新規）
- **先に書くテスト**
  - `見出し「受付からご相談開始まで（中央値）」の下に中央値が大きく出る`
  - `前の月の中央値と「2026年8月・受付 328件」の母数が添えられる`
  - `中央値が 8分ちょうどの月では「目安 8分を超えています」の札が出ない`
  - `中央値が 8分1秒の月では札が出る`
  - `目安 8分の破線と「目安 8分」の札がグラフに出る`
  - `目安を超えた時間帯は 色と文字の両方で示される`
  - `凡例は「目安の内」「目安を超えた時間帯」の 2 つで、塗り・地模様・文字の 3 つを持つ`
  - `受付 0 件の時間帯は棒を描かず、横軸の見出しだけ残して「0件」を添える`
  - `読み上げの文に 最も長い時間帯とその値・目安を超えていることが入る`
- **実装**
  - 中央値の色は超過のときだけ `--color-danger`。超過でないときは `--color-ink`。**色だけで伝えない**ので札を必ず添える。
  - 「前の月」は同じ応答の `summary` から取る（別の要求を投げない。`07-nfr.md` §4.1）。
  - 「予約」と「受付」を 1 語で書かない。この面の 328 件は**ご来店の受付**（ウォークインを含む）である。
- **完了条件**: 9 本が緑。
- **依存**: T-013

## T-018 タブ「取り消し」を実装する（Red → Green）

- **目的**: 月ごとの取消を 5 層の積み上げで出し、層の名前を CHANGE-CANCEL の 4 択と 1 字も違えない。
- **見るべきモック**: `ANALYTICS-CANCEL.png`。ツールバーの期間の札が 2 つ（間に「−」13px `--color-ink-muted`）。
  カード 1 枚に積み上げ 6 本（1 本 104px 幅・間 24px）。x 軸のラベルは「7月　37件・11.9%」の 1 行 13px。
  下に「6か月のまとめ」（20px 太字）と罫線 3 行。行のグリッドは 240px / 1fr、名前 16px 太字、
  値 16px `--color-ink-muted`、数字 20px 等幅太字（超過だけ `--color-danger`）。
- **触るファイル**: `services/glasses_management/src/web/analytics/CancelTab.tsx`（新規）/ `CancelTab.test.tsx`（新規）
- **先に書くテスト**
  - `期間をレンジで指定でき、開始月より前の終了月を選べない`
  - `2026年3月から2026年8月を適用すると積み上げが 6 本並ぶ`
  - `凡例は「お客様のご都合」「店舗の都合」「予約の重複」「ご来店がなかった」「Webからの取消」の 5 つになる`
  - `凡例の文字が CHANGE-CANCEL の 4 択と 1 字も違わない`
  - `凡例のどれも 塗り・地模様・文字の 3 つを持ち、塗りを外しても見分けられる`
  - `棒の下に「7月　37件・11.9%」のように件数と率が添う`
  - `取消が 0 件の月は棒を描かない`
  - `まとめの取消率の行に「目安 10%以内」が併記される`
  - `最も高い月の行にその月と「目安を超過」が添う`
  - `取消率の分母が来店予定だった予約の総数であることが定義文から読める`
- **実装**
  - 5 層の順（下から上）は **お客様のご都合 → 店舗の都合 → 予約の重複 → ご来店がなかった → Webからの取消**。
    凡例の並びも同じにする（凡例と棒で順が違うと読めない）。
  - 塗りは 3 系統でよい（緑・赤・青）が、**同じ色の 2 層は地模様で分ける**
    （お客様のご都合＝塗りつぶし／店舗の都合＝斜線／予約の重複＝点）。
  - 取消率が 10% を超えた月だけ数字を `--color-danger` にし、必ず「目安を超過」の文字を添える。
- **完了条件**: 10 本が緑。
- **依存**: T-013

## T-019 モックの無い 3 タブを実装する（Red → Green）

- **目的**: 「予約の入口」「来店回数」「ご来店の目的」を、押しても何も出ないタブにしない。
- **触るファイル**: `services/glasses_management/src/web/analytics/SimpleTab.tsx`（新規）/ `SimpleTab.test.tsx`（新規）
- **先に書くテスト**
  - `予約の入口は お電話・店頭・Web予約・ウォークイン の 4 系列を 1 つのグラフで出す`
  - `来店回数は 初めて・2回目・3〜5回・6回以上 の 4 階級を出す`
  - `ご来店の目的は 目的ごとの件数を多い順に出す`
  - `3 タブとも グラフが 1 つ・定義の 1 行・まとめ 3 行 の同じ型になる`
  - `3 タブとも 押して何も出ない状態にならない（0 件でも「この期間に数えられるご予約はありません。」を出す）`
- **実装**
  - **骨格は `ANALYTICS-COUNT` を流用し、新しい部品を 1 つも足さない**（`design/05-screen-flow.md` §4.9）。
  - まとめの 3 行は 合計・最も多い区分・その割合。**4 行目を置かない。**
  - 出どころの 4 語は「お電話 / 店頭 / Web予約 / ウォークイン」で、`07-nfr.md` §2.4 の語と 1 字も違えない。
- **完了条件**: 5 本が緑。
- **依存**: T-013

## T-020 品質フロアを埋める（Red → Green）

- **目的**: モックは 1 状態しか描いていない。読み込み中・空・エラー・375px・200%文字拡大・読み上げを
  DESIGN_RULE の品質フロアで補う（モックに無いから作らない、は誤り）。
- **触るファイル**: `services/glasses_management/src/web/analytics/*.tsx`（追記）/
  `services/glasses_management/src/web/analytics/AnalyticsScreen.test.tsx`（追記）
- **先に書くテスト**
  - `読み込み中は前の期間の数字を残さない（古い数字を新しい期間の見出しの下に置かない）`
  - `1 件も無い期間では「この期間に数えられるご予約はありません。」だけを出し、0 の棒を並べない`
  - `読めなかったときは理由と「もう一度読み込む」を出す`
  - `375px 幅ではタブが横スクロールし、8 つとも押せる`
  - `375px 幅でもグラフは横スクロールの中に収まり、ページ全体は横に動かない`
  - `文字を 200% にしてもツールバーの 4 つの操作が重ならない`
  - `分析を開くと本文の先頭にタブ名の見出しがあり、読み上げの順が タブ → ツールバー → 定義 → グラフ になる`
  - `analytics.read を持たないと 分析の行き先がサイドバーに出ず、URL で開いても「この画面は店長だけがご覧になれます」が出る`
- **実装**
  - 403 の面は EX-PERMISSION の形を当てない。**サイドバーは残したまま本文だけを 1 枚のカードに差し替え**、
    「この画面は店長だけがご覧になれます」＋「前の画面に戻る」（`design/05-screen-flow.md` §7.3）。
  - 幅の段は `07-nfr.md` §1.2 に従う（767px 以下はサイドバーを畳んで本文の先頭に行き先リストを置く）。
    **`window.innerWidth` の一発判定にしない**。
  - 横に広いもの（グラフ・タブ帯）は自分の `overflow-x: auto` の中でスクロールさせ、**本文を横に動かさない**。
  - 触れるものは 44pt 以上。状態を色だけで伝えない。
- **完了条件**: 8 本が緑。web 側カバレッジ 4 指標 60% 以上。
- **依存**: T-014, T-015, T-016, T-017, T-018, T-019

## T-021 E2E を書き、spec を Approved に上げる

- **目的**: 実ブラウザと実 Worker で AC を 1 対 1 に確かめ、traceability を通す。
- **触るファイル**
  - `services/glasses_management/e2e/analytics.spec.ts`（新規）
  - `services/glasses_management/seed.mjs`（分析の seed を足す）
  - `specs/glasses_management/features/012-analytics/spec.md`（ステータスと AC-ANA-21 の数字）
- **やること**
  - **31 個の識別子**（UC-ANA-01〜10 と AC-ANA-01〜21）を**ちょうど 1 回ずつ**割り当てる。
    1 テストに複数の ID を空白区切りで書いてよいので、次の 21 本にまとめる。

    | テスト | `// @e2e-covers` |
    |---|---|
    | 分析トップで前後7日の入り具合と週の数字を読む | `UC-ANA-01 AC-ANA-01` |
    | 週の予約は件数だけで、「名」を出さない | `AC-ANA-02` |
    | 期間を変えただけでは数字が変わらず、適用で変わる | `UC-ANA-02 AC-ANA-03` |
    | 店舗を丸の内店に変えて適用すると担当の行が入れ替わる | `AC-ANA-04` |
    | かぞえる日を受付日に変えると合計が変わる | `UC-ANA-03 AC-ANA-05` |
    | 集計の種類を時間帯別に変えると横軸が変わる | `AC-ANA-06` |
    | 予約数のまとめは 3 つだけ | `AC-ANA-07` |
    | 担当者の見出しと列見出しで何をいつ基準に数えたかが分かる | `UC-ANA-04 AC-ANA-08` |
    | 担当が未定の行は最後に出て再来が「—」になる | `AC-ANA-09` |
    | お待ち時間の中央値に前の月と母数が添う | `UC-ANA-05 AC-ANA-10` |
    | 8分ちょうどと 8分1秒で札の出方が変わる | `AC-ANA-11` |
    | 取り消しは 5 分類の積み上げで件数と率が添う | `UC-ANA-06 AC-ANA-12` |
    | 6か月のまとめに目安が併記される | `AC-ANA-13` |
    | 標本が 20 件に満たない担当の率が「—」になる | `UC-ANA-07 AC-ANA-14` |
    | 定休日の 0 件と未集計の日が別々に示される | `UC-ANA-08 AC-ANA-15` |
    | 別の組織のスタッフには他組織の数字が 1 件も出ない | `UC-ANA-09 AC-ANA-16` |
    | 凡例は塗り以外でも見分けられる | `AC-ANA-17` |
    | 切り口をキーボードだけで切り替えられる | `AC-ANA-18` |
    | グラフの読み上げで最大値・定休日・未集計が分かる | `AC-ANA-19` |
    | 予約の入口・来店回数・ご来店の目的も同じ型の 1 枚になる | `UC-ANA-10 AC-ANA-20` |
    | 1日あたりの分母が営業日数である | `AC-ANA-21` |

  - タグは **直前の行**に `// @e2e-covers <ID> [<ID> ...]` の 1 行コメントで書く。`/* */` は通らない。
    `test.only` / `test.skip` / `test.fixme` に付けない。
  - seed は `docs/superpowers/plans/2026-08-28-glasses-management-rebuild.md` §5 の世界観データを使う
    （組織 EYEX / 銀座店・丸の内店・新宿店 / 基準日時 2026年8月27日（木）11:08 JST）。
    **店長は「山田 大輔」である。**マスタープラン §5 の「高橋 慎輔（店長）」は誤りで、
    `design/03-data-model.md` §5.1 と `design/05-screen-flow.md` §8 #1 が
    「モック 8 面（ANALYTICS-STAFF / LOGIN-STAFF / MODE-PERSONAL / SETTINGS-STAFF / SETTINGS-STORE /
    EX-PERMISSION / HISTORY-LIST / BOOK-04d）がそろって描いている `山田 大輔` を正とする」と決めている
    （マスタープラン §0「spec が正」）。P1 の seed も `山田 大輔` で入っているので、そこに合わせるだけでよい。
    E2E は時刻に依存しないよう、**集計済みの `analytics_daily` を直接 seed する**（Cron を待たない）。
  - **AC-ANA-21 の「26 日」を seed の実測値へ直す**（前提の逸脱 7）。2026年8月の営業日は暦 31 日 − 火曜 4 日 = **27 日**。
    定義（分母は営業日数）は変えず、括弧の中の数だけを直す。E2E は「合計 ÷ 営業日数」であることと
    営業日数が 27 であることを確かめる。
  - 書けたら spec の `- ステータス:` を `Draft` → `Approved` に上げる。
- **完了条件**: `pnpm --filter @app/glasses_management e2e` が緑。`pnpm run test:traceability` が
  `E2E traceability: all approved UC/AC identifiers are mapped exactly once.` を出す。
- **依存**: T-011, T-020

## T-022 モックとの突き合わせに 5 画面を足す

- **目的**: 承認された見た目からどれだけ離れているかを数で残す。
- **触るファイル**: `services/glasses_management/e2e/mock-compare.spec.ts`（追記）
- **やること**
  - 5 本足す: `ANALYTICS-TOP` / `ANALYTICS-COUNT` / `ANALYTICS-STAFF` / `ANALYTICS-WAIT` / `ANALYTICS-CANCEL`。
    基準画像は `docs/frontend/mockups/eyex/reference/<画面ID>.png`（**5 枚とも生成済み**）。
  - `mock` project（viewport 1194×810 / `deviceScaleFactor` 2）で
    `await expect(page).toHaveScreenshot('<画面ID>.png', { scale: 'device', maxDiffPixelRatio: ... })`。
  - 撮る前に「適用」まで済ませ、**読み込み中の状態を撮らない**（`await expect(グラフ).toBeVisible()` で待つ）。
  - `maxDiffPixelRatio` は「いま許している差」であり、**下げるだけで、上げてはいけない。**
    残っている差が何かをテストの直上にコメントで書く。いま分かっている既知差分は 4 つ:
    1. 「名」の列（TOP の 88名/92名/55名、COUNT の 414名）… Q-11 が解けるまで出さない。
    2. 8月の棒が 31 本（モックは 30 本で 8/31 が落ちている）。「1日あたり」も 12.3 ではなく暦どおりの値になる。
    3. 取り消しの積み上げが 5 層（モックは 3 層）。凡例の文字も CHANGE-CANCEL の 4 択に揃えてある。
    4. 上のバーの「お知らせ 3」… P10 で足す。
- **完了条件**: `pnpm --filter @app/glasses_management exec playwright test --project=mock` が緑。
  5 画面の差分がいずれも 8% 以下。
- **依存**: T-021

## T-023 完了の確認

- **目的**: このフェーズが終わったことを、機械が確かめられる形で残す。
- **触るファイル**: `docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md`（追記）/
  `knip.jsonc`（entry を実在のものだけにする）
- **先に書くテスト**: なし（既存のテストを走らせるだけ）。
- **実装**: 下のコマンドを上から順に実行し、赤いものを直してから次のコマンドへ進む。**飛ばさない。**

```sh
pnpm run lint                                    # 緑
pnpm run deps:check                              # 緑（knip。新しい entry を足したら knip.jsonc も直す）
pnpm run typecheck                               # 緑
pnpm run test                                    # 緑（traceability を含む）
pnpm --filter @app/glasses_management test:all   # 緑（Worker 80% / web 60%）
pnpm --filter @app/glasses_management e2e        # 緑
pnpm --filter @app/glasses_management exec playwright test --project=mock   # 緑
pnpm check                                       # 緑
```

- 前提の逸脱 1〜7 のうち、spec と設計文書に反映したもの（AC-ANA-21 の数字）と
  反映していないもの（`design/03-data-model.md` §11.4 の metric 表）を進捗台帳に 1 行ずつ残す。
- **完了条件**
  - 上の 8 コマンドがすべて緑。
  - `specs/glasses_management/features/012-analytics/spec.md` が `- ステータス: Approved` で、
    UC-ANA-01〜10 と AC-ANA-01〜21 の 31 個すべてに `@e2e-covers` が 1 対 1 で付いている。
  - Worker 側カバレッジ 4 指標 80% 以上 / web 側 60% 以上。**閾値を下げない・広く除外しない。**
  - 5 画面の `maxDiffPixelRatio` の実測値が進捗台帳に書かれている。
- **依存**: T-022
