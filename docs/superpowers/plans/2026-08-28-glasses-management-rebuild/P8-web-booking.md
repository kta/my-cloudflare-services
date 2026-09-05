# P8 お客様向け Web 予約 — TODO

- spec: [`specs/glasses_management/features/011-web-booking/spec.md`](../../../../specs/glasses_management/features/011-web-booking/spec.md)
- 依存: P2, P4
- 状態: 未着手
- 目的: 店舗ごとに「出す・出さない／何を出すか／いつまで受けるか」を店長が決められるようにし、
  お客様が自分のスマートフォンから 6 歩で予約を取り、ご予約番号と確認番号で後から確かめ・変え・取り消せるようにする。

---

## 0. 始める前に必ず読むもの

| 何を | どこ |
|---|---|
| 表と列と不変条件 | `specs/glasses_management/design/03-data-model.md` §11.1 / §11.2 / §11.3 |
| 経路とエラー語彙 | `specs/glasses_management/design/04-api.md` §3.11 / §3.12 / §4.10 / §5 / §6 / §7 |
| 画面と遷移 | `specs/glasses_management/design/05-screen-flow.md` §3.11 / §5.3 / §7 |
| 主フロー・代替・例外 | `specs/glasses_management/design/06-use-cases.md` IDX-WEB-01〜09 |
| 境界値・入力の型・読み上げ | `specs/glasses_management/design/07-nfr.md` §2.3 / §2.9 / §5.4 / §10.3 |
| 未決事項 | `specs/glasses_management/design/09-open-questions.md` Q-01 / Q-09 |

### 0.1 このフェーズが前提にする、他フェーズの成果物

| 使うもの | 作ったフェーズ | 無いときにどうするか |
|---|---|---|
| `visit_purposes`（`name_public` / `name_short` / `is_web_published`） | P1 | P8 に着手しない |
| `reservations` / `reservation_purposes` / `reservation_assignments` / `reservation_slot_locks` / `availability.ts` | P2 | P8 に着手しない |
| `idempotency_records` / `audit_events` | P3 | P8 に着手しない |
| `customers` | P4 | P8 に着手しない |
| `alerts` | **P7** | `alerts` に行を立てる部分（T-011 の一部・T-012 の `web_booking.pending`）だけを P7 の完了後に回す。**表を P8 で新設しない**（`03-data-model.md` §12 が P7 の `0006_*.sql` に置いている） |

migration の番号は `0007_*.sql`（`03-data-model.md` §12 のフェーズ表）。**この番号を前に詰めない。**

### 0.2 モックと実装がわざと違うところ（実装側を正とする。モックの画像は直さない）

| # | モック | 実装 | 根拠 |
|---|---|---|---|
| 1 | WEB-01 「近い順に3店舗を表示しています。」 | 「3店舗を表示しています。」 | 位置情報を使わない。並びは `stores.sort_order`（`06-use-cases.md` IDX-WEB-03 検証点） |
| 2 | WEB-02 が 6 件（「修理・部品の交換」を含む）・表記が独自 | 公開 5 件・`visit_purposes.name_public` の表記 | `05-screen-flow.md` §3.11 の 6 行表。修理・部品交換は `is_web_published='0'` |
| 3 | WEB-05 / WEB-06 の「メガネを新しく作る」 | 「新しいメガネを作る」 | 対客名は `name_public`。店内名（`name_internal`）を客面に出さない |
| 4 | WEB-06 は「ご予約番号」しか描かない | 「ご予約番号」と**「確認番号」の 2 つ**を出す | `04-api.md` §7.2。出さないとメールが届かなかったお客様が WEB-CANCEL を通れない |
| 5 | SETTINGS-WEB の「受け付ける内容」が 4 行 | **5 行**（「何時間先から受ける　2時間先から」を足す） | `03-data-model.md` §11.1 の `accept_from_hours` 既定 2 |
| 6 | SETTINGS-WEB のプレビューが 4 件 | 公開する目的の**全件**（銀座店は 5 件） | `06-use-cases.md` IDX-WEB-02 例外 E1 |

### 0.3 未決事項（`design/09-open-questions.md`）

| Q | いまの前提 | この TODO での扱い |
|---|---|---|
| **Q-01** 承認待ちの間、お客様に何と伝えるか | 完了の見出しを「ご予約を承りました」にし「お店で確認のうえ、本日中にご連絡いたします。確定までお席の確保はできておりません。」を出す。確定後に `reservation.confirmed` を送る。**取消のメールは送らない**（`notification.ts` に型が無く、足すのは人間の承認事項） | T-019 / T-011 |
| **Q-09** メールアドレスを必須にしてよいか | **必須（NOT NULL）** | T-001 / T-002 / T-016 |

### 0.4 テストの言葉

`packages/contracts/test/glasses_management.contract.test.ts` は既存の記述が英語なので**英語で書く**。
`services/glasses_management/test/**` と `src/web/**/*.test.tsx` と `e2e/**` は**日本語で書く**（既存ファイルがそうなっている）。

---

## T-001 契約を書く（Red）

- **目的**: Web 予約の入出力の形を Zod の 1 か所に決め、境界値と unknown key をテストで閉じる。
- **触るファイル**
  - `packages/contracts/src/glasses_management.ts`（追記）
  - `packages/contracts/src/index.ts`（re-export に足す）
  - `packages/contracts/test/glasses_management.contract.test.ts`（追記）
- **先に書くテスト**（`pnpm --filter @app/contracts test`。英語）
  - `WebBookingSettingsInput` > `accepts a 0-character and a 120-character message and rejects 121`
  - `WebBookingSettingsInput` > `accepts acceptUntilDays 1 and 180 and rejects 0 and 181`
  - `WebBookingSettingsInput` > `accepts acceptFromHours 0 and 168 and rejects -1 and 169`
  - `WebBookingSettingsInput` > `accepts changeDeadlineDays 0 and 30 and rejects 31`
  - `WebBookingSettingsInput` > `rejects opensAt equal to or later than closesAt`
  - `WebBookingSettingsInput` > `requires version so a blind overwrite cannot be sent`
  - `WebBookingSettingsInput` > `rejects an unknown key so a stale settings field never lands silently`
  - `WebBookingSettings` > `keeps requiresApproval true by default because there is no auto-confirm option`
  - `WebBookingCode` > `accepts EY-W-2608-0031 and EY-W-2608-10000 and rejects EY-2608-0031`
  - `PublicStorePurpose` > `carries the public-facing name and the duration only — no internal name`
  - `PublicAvailabilityQuery` > `accepts a 7-day window and rejects an 8-day one`
  - `PublicAvailabilityResponse` > `exposes only whether a slot is open — never the staff or equipment behind it`
  - `PublicBookingCreate` > `requires contactEmail because an approval flow needs a way back to the customer`
  - `PublicBookingCreate` > `accepts a 40-character name and rejects 41`
  - `PublicBookingCreate` > `accepts a hyphenated phone number and rejects a 9-digit one`
  - `PublicBookingResult` > `returns the management code in plaintext exactly here and nowhere else`
  - `PublicBookingResult` > `carries emailed so the done screen can stop claiming a mail that never left`
  - `PublicReservationVerification` > `rejects a request that carries neither a phone number nor an email`
  - `PublicReservationStatus` > `never carries the management code`
  - `WebBookingReviewInput` > `requires a reason when the decision is reject`
- **実装**: `WebBookingSettings` / `WebBookingSettingsInput` / `WebPreviewQuery` / `WebPreviewResult` /
  `WebBookingReviewInput` / `PublicStoreSearchQuery` / `PublicStoreSummary` / `PublicStoreDetail` /
  `PublicStorePurpose` / `PublicAvailabilityQuery` / `PublicAvailabilityResponse` / `PublicBookingCreate` /
  `PublicBookingResult` / `PublicReservationVerification` / `PublicReservationVerificationResult` /
  `PublicReservationStatus` / `PublicReservationChange` / `PublicReservationChangeResult` /
  `PublicReservationCancel` / `PublicReservationMutationResult` / `WebPublicationApplyRequest` /
  `WebPublicationApplyResult`。定義は `04-api.md` §4.10 の表をそのまま写す。
  原始型（`LocalDate` / `LocalTime` / `IsoDateTime` / `Uuid` / `PhoneInput` / `DurationMinutes` / `Version`）は
  P2 が置いたものを再利用し、同じものを二度定義しない。`WebBookingCode` は `/^EY-W-\d{4}-\d{4,5}$/`。
  全スキーマを `z.strictObject`（enum と配列を除く）にする。
- **完了条件**: 20 本が緑。`packages/contracts` のカバレッジ 4 指標 80% 以上。
- **依存**: なし

## T-002 スキーマを足し、migration を生成する（Red → Green）

- **目的**: `web_booking_settings` と `web_bookings` を D1 に置き、index が実際のクエリ形と一致することを固定する。
- **触るファイル**
  - `services/glasses_management/src/worker/db/schema.ts`（追記）
  - `services/glasses_management/test/schema.test.ts`（追記）
  - `services/glasses_management/migrations/0007_*.sql`（生成物）
- **先に書くテスト**（`getTableConfig` で index 名と対象列を見る）
  - `web_booking_settings` > `店舗ごとに 1 行しか持てない`
  - `web_booking_settings` > `外部キーを宣言していない`
  - `web_bookings` > `予約 1 件に Web 予約 1 件しか結び付かない`
  - `web_bookings` > `ご予約番号は組織の中で一意`
  - `web_bookings` > `店舗と状態で「確認待ち」を数える index を持つ`
  - `web_bookings` > `確認鍵と確認番号はハッシュの列しか持たない`
- **実装**
  - `webBookingSettings`: `id` / `organization_id` / `store_id` / `is_published`（`'0'|'1'`）/
    `opens_at`・`closes_at`（`HH:MM`）/ `accept_from_hours`・`accept_until_days`・`change_deadline_days`（integer）/
    `requires_approval`（`'0'|'1'`）/ `message`（NULL 可）/ `version`（integer）/ `updated_at` / `created_at`。
    index は `web_booking_settings_org_store_idx`（一意・`(organization_id, store_id)`）の 1 本だけ。
  - `webBookings`: `id` / `organization_id` / `store_id` / `reservation_id` / `public_code` /
    `confirmation_key_hash` / `management_code_hash` / `contact_name` / `contact_kana`（NULL 可）/
    `contact_phone` / `contact_email`（**NOT NULL**。Q-09 の前提）/ `status`（`pending|confirmed|cancelled`）/
    `created_at` / `confirmed_at`（NULL 可）/ `cancelled_at`（NULL 可）/ `updated_at`。
    index は `web_bookings_org_reservation_idx`（一意）/ `web_bookings_org_public_code_idx`（一意）/
    `web_bookings_org_store_status_idx` の 3 本。
  - FK を宣言しない。真偽値は `'0'|'1'`。日時は ISO 文字列。**DDL の DEFAULT に意味を持たせない**。
  - `alerts` を**新設しない**（P7 の `0006_*.sql` が作る）。
- **手順**: 編集 → `pnpm --filter @app/glasses_management db:generate` →
  生成された SQL を目で読む（テーブル再作成が出ていたら手で直す）→ `db:migrate:local`
- **完了条件**: `migrations/0007_*.sql` が 2 表ぶんの `CREATE TABLE` と 4 本の `CREATE INDEX` だけを持ち、
  `schema.test.ts` が緑。
- **依存**: T-001

## T-003 時刻の境界値を書く（Red）

- **目的**: 受付の窓・変更の締切・確認待ちの自動取消の境目を、実時刻に依存しない形で 1 か所に閉じる。
- **触るファイル**: `services/glasses_management/test/web-booking.time.test.ts`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test`）
  - 受付開始 > `2時間先ちょうどの枠は受け付ける`
  - 受付開始 > `2時間先の1秒手前の枠は受け付けない`
  - 受付終了 > `30日先ちょうどの日は受け付ける`
  - 受付終了 > `31日先の日は受け付けない`
  - 受付終了 > `31日先を含む週へは送れない`
  - 受け付ける時間 > `10:30 ちょうどの枠は出す。10:29 に終わる枠は出さない`
  - 受け付ける時間 > `18:00 に始まる枠は出さない`
  - 変更・取消の締切 > `前日 23:59:59.999 JST ちょうどは変更できる`
  - 変更・取消の締切 > `当日 00:00:00.000 JST から change_deadline_passed になる`
  - 変更・取消の締切 > `change_deadline_days が 0 なら来店日の 23:59:59.999 JST まで変更できる`
  - 確認待ちの自動取消 > `受信日の 23:59:59.999 JST では取り消さない`
  - 確認待ちの自動取消 > `受信日の翌 00:00:00.000 JST で取り消す`
  - 確認待ちの自動取消 > `来店日が3週間先でも、受信日を過ぎたら取り消す`
  - 確認待ちの自動取消 > `月をまたぐ受信日（8月31日受信）でも受信日で切れる`
  - 確認待ちの自動取消 > `年をまたぐ受信日（12月31日受信）でも受信日で切れる`
  - 確認待ちの自動取消 > `うるう年の2月29日に受け取った予約も同じ規則で切れる`
  - 短命の確認番号 > `900秒ちょうどは本人確認が通る`
  - 短命の確認番号 > `901秒で invalid_management_code になる`
- **注意**: 時刻はすべて純関数の最後の引数（`now: Date`）で注入する。
  ドメイン層で `Date.now()` / 引数なしの `new Date()` を呼ばない（`07-nfr.md` §10.2）。
  JST の日境界は UTC 15:00。テストの基準日時は `2026-08-27T02:08:00.000Z`（= JST 8/27 11:08）。
- **完了条件**: 18 本が「期待した理由で」落ちることを目で見る。
- **依存**: T-001

## T-004 公開設定の読み書きと楽観ロックを書く（Red）

- **目的**: SETTINGS-WEB の保存が版で衝突を見ること、公開できない条件で保存を拒むことを固定する。
- **触るファイル**: `services/glasses_management/test/web-booking.integration.test.ts`（新規）
- **先に書くテスト**
  - 公開設定の取得 > `行が無い店舗は「公開していません」として読める`
  - 公開設定の取得 > `ご案内のページは stores.slug から組み立てる`
  - 公開設定の取得 > `公開する目的は is_web_published と is_active の両方が立つ行だけ`
  - 公開設定の保存 > `版が一致すれば保存でき、版が 1 つ進む`
  - 公開設定の保存 > `古い版で保存すると 409 version_conflict になり、1 行も書き換わらない`
  - 公開設定の保存 > `公開する目的が 0 件のまま公開しようとすると 422 で拒む`
  - 公開設定の保存 > `受け付ける時間の前後が逆なら 400 で拒む`
  - 公開設定の保存 > `お知らせ文が 121 文字なら 400 で拒み、120 文字は保存できる`
  - 公開設定の保存 > `店長でないスタッフの保存は 403 で、入力を捨てない`
  - お客様の画面の見え方 > `未保存の目的とお知らせ文をクエリで受け取り、保存しないまま返す`
  - お客様の画面の見え方 > `出るのは対客名だけで、店内名は 1 つも出ない`
  - お客様の画面の見え方 > `公開する目的の件数とプレビューの件数が一致する`
- **実装の決め**: 版の条件は `db.batch()` の**全文**に配り、`version` を +1 する文を**最後**に置く。
  409 の判定は最後の文の `meta.changes === 0`（`03-data-model.md` §2-14）。
- **完了条件**: 12 本が緑（T-011 / T-012 のあと）。
- **依存**: T-002

## T-005 公開面の読み取りを書く（Red）

- **目的**: 公開していないものが外から一切見えないこと、空き枠に社内の事情が漏れないことを固定する。
- **触るファイル**: `services/glasses_management/test/web-booking.integration.test.ts`（追記）
- **先に書くテスト**
  - 店舗一覧 > `公開している店舗だけを登録順（sort_order）で返す`
  - 店舗一覧 > `公開している店舗が 0 件なら空配列を返す`
  - 店舗の詳細 > `存在しない slug と、公開していない店舗の slug は同じ 404 になる`
  - 店舗の詳細 > `お客様に見せる店名（stores.name_public）を返し、店内名を返さない`
  - ご用件 > `is_web_published が立つ 5 件だけを sort_order 順に返す`
  - ご用件 > `修理・部品交換（is_web_published='0'）は API からも返らない`
  - ご用件 > `返るのは対客名（name_public）で、店内名・技能・設備は 1 つも含まない`
  - 空き枠 > `満席の枠は isAvailable=false で返り、担当名も設備名も含まない`
  - 空き枠 > `定休日は isClosed=true で、その日の枠を 1 つも返さない`
  - 空き枠 > `お昼の受付停止帯（12:00–13:00）の枠を返さない`
  - 空き枠 > `8 日ぶんを求めると 400 で落ちる`
  - 空き枠 > `公開していない目的を指定すると 409 purpose_unavailable になる`
  - 空き枠 > `公開面の計算では KV を 1 度も読まない`
- **実装の決め**: 最後の 1 本は `vi.spyOn(env.SHORT_LIVED, 'list')` が呼ばれないことで見る
  （`04-api.md` §6.3。KV の list は無料枠 1,000 回/日で、公開ページの閲覧数がそのまま list 数になる）。
- **完了条件**: 13 本が緑（T-012 のあと）。
- **依存**: T-002

## T-006 予約の作成・冪等・枠競合を書く（Red）

- **目的**: 二度押しと回線断で予約が 2 件にならないこと、承認要否が正しく効くことを固定する。
- **触るファイル**: `services/glasses_management/test/web-booking.integration.test.ts`（追記）
- **先に書くテスト**
  - 予約の作成 > `reservations（source='web'）と web_bookings が 1 件ずつできる`
  - 予約の作成 > `ご予約番号は EY-W-YYMM-NNNN で、reservations.code の EY-YYMM-NNNN とは別に採番される`
  - 予約の作成 > `確認番号の平文は作成の応答にだけ現れ、D1 にはハッシュしか無い`
  - 予約の作成 > `承認要否が「お店が確かめてから確定する」なら web_bookings.status は pending になる`
  - 予約の作成 > `予約本体は作成の時点で confirmed で、承認は web_bookings.status だけを動かす`
  - 予約の作成 > `受け付ける時間の外の時刻を送ると 409 store_closed になる`
  - 予約の作成 > `公開していない店舗へ送ると 404 になる`
  - 冪等 > `同じ Idempotency-Key と同じ内容の再送は、同じご予約番号を返して予約を 1 件に保つ`
  - 冪等 > `同じ Idempotency-Key で違う内容を送ると 409 idempotency_conflict になる`
  - 冪等 > `処理中（in_progress）の鍵へ重ねて送ると 409 idempotency_conflict になる`
  - 枠競合 > `送信の瞬間に枠が埋まっていると 409 slot_taken になり、代わりの時刻が 3 件返る`
  - 枠競合 > `409 slot_taken のとき、予約も占有行も 1 行も書かれていない`
- **実装の決め**: 書き込みの順は ① `reservation_slot_locks`（上限つき条件付き INSERT）→ ② `reservations` →
  ③ `reservation_purposes` / `reservation_assignments` → ④ `web_bookings` → ⑤ `audit_events`（`02-domain-model.md` §7）。
  すべて 1 つの `db.batch()` に入れ、`idempotency_records` の `status='done'` も同じバッチで書く。
- **完了条件**: 12 本が緑（T-012 のあと）。
- **依存**: T-002

## T-007 照会・変更・取消・確認番号・メール失敗を書く（Red）

- **目的**: 本人確認が総当たりに耐えること、締切を過ぎたら何も動かないこと、メールが出ない日でも予約が残ることを固定する。
- **触るファイル**: `services/glasses_management/test/web-booking.integration.test.ts`（追記）
- **先に書くテスト**
  - 本人確認 > `ご予約番号と確認番号が合えば短命の鍵を返す`
  - 本人確認 > `確認番号が違うと 401 で、明細は 1 行も返らない`
  - 本人確認 > `存在しないご予約番号と、確認番号違いは同じ文言・同じ status で返る`
  - 本人確認 > `1 時間に 10 回失敗すると 429 management_code_locked になり、retryAfterSeconds は 900`
  - 照会 > `明細はご来店・店舗・ご用件・お名前・ご予約番号の 5 つで、確認番号を含まない`
  - 照会 > `変更の締切（changeDeadlineAt）を応答に載せる`
  - 日時の変更 > `別の空いている時刻へ移すと、台帳の予約も同じ時刻に移る`
  - 日時の変更 > `変更のあとに previousStartsAt で元の時刻が読める`
  - 日時の変更 > `移す先が埋まっていると 409 slot_taken になり、元の時刻のまま残る`
  - 取消 > `取り消すと web_bookings と reservations の両方が cancelled になる`
  - 取消 > `取り消した予約をもう一度取り消そうとしても、状態も取消日時も変わらない`
  - 締切 > `締切を過ぎた変更は 409 change_deadline_passed で、日時も状態も変わらない`
  - 締切 > `締切を過ぎた取消は 409 change_deadline_passed で、日時も状態も変わらない`
  - 確認メール > `送れたときだけ emailed が true になる`
  - 確認メール > `notifier が 502 を返しても予約は成立し、ご予約番号と確認番号が返る`
  - 確認メール > `notifier が落ちたことを console.error に残す`
  - 確認メール > `送れなかったときに冪等キーを残さない`
  - 確認メール > `store名には stores.name_public を渡し、店内名を渡さない`
  - 確認メール > `取消のときはメールを送らない（notification.ts に型が無い）`
- **実装の決め**: notifier は `miniflare.serviceBindings` のスタブへ差し替え、`vi.spyOn(env.NOTIFIER, 'fetch')` で
  呼ばれ方を見る。予約の D1 書き込みは先に済ませ、通知の失敗でロールバックしない（`04-api.md` §7.2）。
- **完了条件**: 19 本が緑（T-012 のあと）。
- **依存**: T-002

## T-008 権限とテナント分離の表に行を足す（Red）

- **目的**: 公開面が未認証で通ること、そこから他組織へ手が届かないこと、設定の保存が店長だけであることを固定する。
- **触るファイル**
  - `services/glasses_management/test/permissions.test.ts`
  - `services/glasses_management/test/tenant-isolation.test.ts`
- **先に書くテスト（permissions）**: 主体 5 種（未認証 / staff / admin / 期限切れ / 別 secret 署名）× 新しい経路
  - `GET /api/staff/web-booking-settings/:storeId`（読みは staff も admin も 200）
  - `PUT /api/staff/web-booking-settings/:storeId`（**staff は 403 / admin は 200**）
  - `GET /api/staff/web-booking-settings/:storeId/preview`
  - `POST /api/staff/web-bookings/:webBookingId/review`（**staff は 403**）
  - `GET /api/public/stores` / `GET /api/public/stores/:slug/purposes` /
    `POST /api/public/stores/:slug/bookings` / `POST /api/public/reservations/verify`
    （**未認証で通る**。トークンを付けても挙動が変わらない）
  - `POST /api/internal/maintenance/web-publications/apply`（共有鍵のみ。テナント JWT では 401）
  - 未知パス `/api/public/not-a-route`（default-deny の証明として 404）
  - 期限切れトークンは**固定の過去時刻**から作る（`signAccessToken(claims, secret, 1, 過去のエポック秒)`）
- **先に書くテスト（tenant-isolation）**
  - `3 テナントが同時に Web 予約を受けても、他社の予約は照会できない`
  - `stores.slug は全組織横断で一意なので、公開面の slug から解決した組織以外には触れない`
  - `body に他テナントの organizationId を混ぜても、slug から解決した組織のまま隔離される`
  - `他社のご予約番号と自社の確認番号の組み合わせでは明細が返らない`
  - `冪等キーは組織名前空間を含むので、他テナントの同じ Idempotency-Key と衝突しない`
  - `公開設定は他テナントの storeId を指定しても読めない・書けない`
- **完了条件**: permissions が 11 行ぶん、tenant-isolation が 6 本、すべて緑。
  **新しいルートを足したら permissions の表に 1 行足す。**
- **依存**: T-002

## T-009 確認番号を実装する（Green）

- **目的**: 本人確認の番号を、平文を持たずに発行・照合できるようにする。
- **触るファイル**: `services/glasses_management/src/worker/domain/management-code.ts`（新規）
- **実装**
  - `issueManagementCode()` — 誤読しない英数字（`0/O` `1/I/l` を除く）から **8 文字**を `crypto.getRandomValues` で作る。
  - `hashManagementCode(code, salt)` — WebCrypto の SHA-256 のみ（Workers の CPU は 10ms/リクエスト。
    PBKDF2 の反復は入れない。`docs/howto/free-tier-limits.md`）。ハッシュだけを D1 に入れる。
  - `verifyManagementCode(hash, input)` — **一定時間比較**（長さで早期 return しない）。
  - `issueConfirmationKey()` / `hashConfirmationKey()` — 確認メールのリンクに載せる 1 回性の鍵。
  - 短命の鍵は KV `SHORT_LIVED` の `mgmt:<orgId>:<code>` に **TTL 900 秒**。
    失敗回数は `mgmtfail:<code>:<ip>` に **TTL 3600 秒**（失敗時にだけ書く）。10 回で 429。
  - **ファイル名と型名は `management-code` のまま**にする（内部の名前）。画面とメールには「確認番号」しか出さない。
  - 時刻は引数で受ける（`Date.now()` を呼ばない）。
- **完了条件**: T-003 の短命の鍵 2 本と T-007 の本人確認 4 本が緑。
- **依存**: T-003, T-007

## T-010 空き枠エンジンに Web の絞り込みを引数で足す（Green）

- **目的**: 店内と Web で答えがずれないようにする。関数を複製しない。
- **触るファイル**: `services/glasses_management/src/worker/domain/availability.ts`（P2 が作ったものを編集）
- **実装**
  - 既存のシグネチャの末尾に任意の引数 `webWindow?: { opensAt, closesAt, acceptFromHours, acceptUntilDays }` を足す。
    渡さなければ店内の挙動が 1 ミリも変わらないこと（P2 のテストがそのまま緑であること）を先に確かめる。
  - 絞り込みの順は ①店舗の営業時間 ②受付停止帯（お昼 12:00–13:00）③担当・設備・技能 ④`opensAt`〜`closesAt`
    ⑤`now + acceptFromHours` 以降 ⑥`now + acceptUntilDays` 以内。
    ④〜⑥で落ちた枠の理由は `web_window` / `lead_time`（`04-api.md` §4.6 の `AvailabilityReason`）。
  - **公開面から呼ぶときは KV を読まない**（引数 `readHolds: false`）。二重予約は確定時の
    `reservation_slot_locks` が止める。
  - `now` は引数。ドメイン層で作らない。
- **完了条件**: P2 の空き枠テストが 1 本も落ちず、T-003 の受付の窓 5 本と T-005 の空き枠 6 本が緑。
- **依存**: T-003, T-005

## T-011 Web 予約のドメインを実装する（Green）

- **目的**: 公開設定の解決・承認要否・締切・確認待ちの自動取消を、時刻を注入できる純関数にまとめる。
- **触るファイル**: `services/glasses_management/src/worker/domain/web-booking.ts`（新規）
- **実装**
  - `resolvePublication(settingsRow | null, purposes)` — 行が無い店舗は「未公開」。
    公開する目的が 0 件なら `is_published='1'` を許さない。`landingPath` は `<公開ドメイン>/<stores.slug>`
    （公開ドメインは `wrangler.jsonc` の `vars`。この表に持たない）。
  - `requiresApproval(settings)` — `'1'` だけを返す形にする。**自動確定の選択肢を作らない**。
  - `changeDeadlineAt(visitDate, changeDeadlineDays)` — 来店日 −N 日の **23:59:59.999 JST**。
    翌 00:00:00.000 JST から `change_deadline_passed`。
  - `shouldAutoCancel(webBooking, now)` — `status='pending'` かつ **受信日**（`created_at` の JST 暦日）の
    23:59:59.999 JST を過ぎていたら true。**来店日で判定しない。**
  - `nextPublicCode(org, yyyymm, 既存の最大値)` — `EY-W-YYMM-NNNN`（4 桁ゼロ埋め、9999 を越えたら 5 桁）。
    衝突は最大 5 回まで振り直し、尽きたら 409 `code_exhausted`。`reservations.code` の採番と**混ぜない**。
  - 自動取消は `web_bookings.status='cancelled'` と `reservations.status='cancelled'` /
    `cancel_reason='store'` を**同じ `db.batch()`** で書き、`alerts` に `web_booking.auto_cancelled`
    （`severity='info'` / `audience='store'`）を 1 行足す。
  - **自動取消でお客様へメールを送らない**（`notification.ts` に取消の型が無い。Q-01 の前提）。
  - `Date.now()` を呼ばない。すべて `now: Date` を最後の引数で受ける。
- **完了条件**: T-003 の 18 本が緑。
- **依存**: T-003, T-009

## T-012 ルートを足す（Green）

- **目的**: T-004〜T-008 を緑にする。
- **触るファイル**: `services/glasses_management/src/worker/index.ts`
- **実装**（既存のチェーンの末尾に足す。`export type AppType = typeof routes` を保つ）
  - staff 4 本: `GET /api/staff/web-booking-settings/:storeId` /
    `PUT /api/staff/web-booking-settings/:storeId` /
    `GET /api/staff/web-booking-settings/:storeId/preview` /
    `POST /api/staff/web-bookings/:webBookingId/review`。
    `storeId` は**パスで**受ける（クエリと混ぜない）。書き込み 2 本は `requireRole('admin')` を通す。
  - public 10 本: `04-api.md` §3.12 の表そのまま。`app.use('/api/*', except([... '/api/public/*'], ...))` は
    P0 で既に例外に入っているので、**新しいミドルウェアを足さない**。
  - internal 1 本: `POST /api/internal/maintenance/web-publications/apply`（`internalAuth()` で守られている）。
    `now` を body で受け取れるようにし、テストから時刻を注入できる形にする。
  - 組織は **`stores.slug` から解決する**。body / query の `organizationId` を認可の根拠にしない。
  - 確認番号は `X-Management-Code` ヘッダーで受ける。URL・クエリに載せない。
  - `zValidator` はルート内インライン。応答は必ず契約で `parse` してから `c.json`。
  - 公開していない店舗は `{ error: 'not_published' }` を **404** で返す（`not_found` と同じ status）。
  - `Idempotency-Key` を受けるのは public の 3 本だけ（`bookings` / `PATCH reservations/:code` /
    `cancel`）。scope は `public.booking.create` / `.change` / `.cancel`、保持 24 時間。
- **完了条件**: `pnpm --filter @app/glasses_management test` が緑、カバレッジ 4 指標 80% 以上。
  ルート総数が `04-api.md` §3.12 末尾の数と合う。
- **依存**: T-004, T-005, T-006, T-007, T-008, T-010, T-011

## T-013 お客様向けの器を作る（Red → Green）

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 電車の中で片手で持ったお客様が、1 問だけ読んで 1 回だけ押す面。
  - トークン計画: 緑 1 色（`--color-pine`）が上のバー・進捗の点いた段・選択・下の主操作を担う。
    面は下地（`--color-paper`）と白（`--color-surface`）の 2 段だけ。角は 8/12/16px。書体は iOS 既定の 1 書体。
  - シグネチャ: **下端に固定した全幅 56px の緑 1 枚**と、その上に 6 本の細い進捗の帯。
- **見るモック**: WEB-01-STORE / WEB-02-PURPOSE / WEB-03-DATETIME / WEB-04-FORM / WEB-05-CONFIRM /
  WEB-06-DONE / WEB-CANCEL（`docs/frontend/mockups/eye/images/`。実測は 390×844。
  実装が持つのは**ステータスバーを外した 390×800**）
- **実測値（7 面に共通）**
  | 部位 | 値 |
  |---|---|
  | 上のバー | 高さ **56px**、地 `--color-pine`、左に `‹`（48×48px。WEB-06 だけ無い） |
  | 店名 / 副題 | 19px 太字 / 12px（`opacity .9`） |
  | 進捗 | 白地・下 1px 罫・`padding 10px 16px`、帯は `height 4px` / `gap 4px` / `radius 2px`。点いた段は `--color-pine`、消えた段は `--color-line` |
  | 本文の余白 | `padding: 32px 28px 120px`（WEB-06 は下 140px、WEB-CANCEL は下 152px） |
  | 問いかけ | 見出し 20px、補足 13px（`--color-ink-muted`）、左の吹き出し 18×15px（`margin-top 6px` / `gap 10px`） |
  | 下の固定 | `left 28px / right 28px / bottom 32px`。主操作は全幅・**min-height 56px**・18px |
- **触るファイル**
  - `services/glasses_management/src/web/public/{PublicShell.tsx,Progress.tsx,StickyAction.tsx,bookingState.ts,publicClient.ts}`（新規）
  - `services/glasses_management/src/web/public/PublicShell.test.tsx`（新規）
  - `services/glasses_management/src/web/App.tsx`（`/w/**` を分岐させる）
  - `services/glasses_management/src/web/public/route.ts`（新規。`location.pathname` の読み取りと
    `history.pushState` / `popstate` だけの 40 行）
- **`react-router` を入れない。** P0 の `src/web/App.tsx` は `useState`（`current`）で画面を出し分けており、
  URL ルータを持たない。P10 も同じ決めで進む。`/w/:storeSlug` は**お客様がブックマーク・共有する URL** なので
  ここだけは実 URL が要るが、必要なのは「`/w/` で始まるか」「slug は何か」「戻るで 1 工程戻る」の 3 つだけで、
  `route.ts` の `location.pathname` + `history.pushState` + `popstate` で足りる。
  `react-router` は catalog にあり `services/admin` も使っているが、**このサービスへの依存追加は人間承認事項**
  （ルール 10）であり、`route.ts` で足りることが分かっている以上ここで諮らない。
  **[要確認: 工程の戻りが自前の popstate で破綻したら、そのときに人間へ react-router の追加を諮る]**
- **先に書くテスト**（`pnpm --filter @app/glasses_management test:web`）
  - お客様向けの器 > `/w/ginza を開くと業務のサイドバーを 1 つも描かない`
  - お客様向けの器 > `上のバーに店名と「ステップ N / 6」を出す`
  - お客様向けの器 > `進捗は role="img" で「全6ステップのうち1つ目です」と読める`
  - お客様向けの器 > `WEB-CANCEL の進捗は「2つの手順のうち2つ目です」と読める`
  - お客様向けの器 > `‹ は 1 つ前の工程へ戻り、入力は消えない`
  - お客様向けの器 > `読み込み中・空・エラー・通信が切れたの 4 状態を、見出し 1 行と理由 1 行と次の一手 1 つで出す`
  - お客様向けの器 > `下端の主操作は 56px 以上で、下の安全領域に重ならない`
  - 通信 > `公開面のクライアントは bearer を 1 度も付けない`
- **実装の要点**
  - ランドマークは `<header>` / `<main>` の 2 つ。**`<nav>` を作らない**（進捗は押せない `role="img"`）。
  - 工程の入力（店舗・目的・日時・お客様の情報）は**メモリだけ**に持つ。`localStorage` に顧客情報を書かない
    （`07-nfr.md` §5.3 / §6.6）。
  - `hc<AppType>` を使うが、`auth.authFetch` を通さない素の `fetch` で作る（公開面に bearer は無い）。
  - 器に `padding-bottom: env(safe-area-inset-bottom)`、左右に `env(safe-area-inset-left/right)`。
  - 色・寸法は `packages/ui/src/theme.css` のトークン経由のみ。Tailwind 既定パレットと任意値を書かない。
- **完了条件**: 8 本が緑。
- **依存**: T-012

## T-014 WEB-01-STORE と WEB-02-PURPOSE を作る（Red → Green）

- **目的**: 店舗とご用件を 1 画面 1 問で選ばせ、社内の言葉を 1 語も出さない。
- **触るファイル**
  - `services/glasses_management/src/web/public/StoreStep.tsx`（新規）
  - `services/glasses_management/src/web/public/PurposeStep.tsx`（新規）
  - `services/glasses_management/src/web/public/StoreStep.test.tsx`（新規）
  - `services/glasses_management/src/web/public/PurposeStep.test.tsx`（新規）
- **見るモック**: `images/WEB-01-STORE.png` / `images/WEB-02-PURPOSE.png`
- **実測値**
  | 部位 | 値 |
  |---|---|
  | 店舗の並び | `gap 12px`、上 `margin 28px` |
  | 店舗 1 件 | `min-height 76px` / `padding 16px` / 角 12px / 縁 1px `--color-line-strong` |
  | 選択中の店舗 | 縁 **3px** `--color-pine` + 地 `--color-pine-soft` + `padding 14px`（外形を保つ） |
  | 店名 / 道順 | 16px 太字（`gap 8px`）/ 13px `--color-ink-muted`（`margin-top 4px`） |
  | 「選択中」の札 | `min-height 22px` / `padding 1px 8px` / 角 8px / 地 `--color-pine-soft` |
  | ご用件の並び | `gap 10px`、上 `margin 28px` |
  | ご用件 1 件 | `min-height 60px` / `padding 0 16px` / 角 12px / 16px 太さ 600 |
  | 選択中のご用件 | 縁 3px + 地 `--color-pine-soft` + `padding 0 14px` |
  | 分数 | 右寄せ 13px 太さ 600 `--color-ink-muted`、その下に「選択中」を `--color-pine-deep` で改行 |
- **先に書くテスト**
  - 店舗を選ぶ > `見出しは「ご希望の店舗をお選びください」で、補足は「3店舗を表示しています。」`
  - 店舗を選ぶ > `店舗は登録順に並び、選ぶと「選択中」の札が付く`
  - 店舗を選ぶ > `slug 付きの URL で開くとその店舗が選ばれている`
  - 店舗を選ぶ > `主操作は「銀座店で予約を進める」で、選ばれた店名がそのまま入る`
  - 店舗を選ぶ > `公開している店舗が 0 件なら、電話番号の案内を出して工程へ進ませない`
  - ご用件を選ぶ > `見出しは「ご用件をお選びください」で、補足は「お時間は目安です。」`
  - ご用件を選ぶ > `出るのは対客名だけで、「メガネを新しく作る」は 1 つも出ない`
  - ご用件を選ぶ > `Web 非公開の「修理・部品の交換」を出さない`
  - ご用件を選ぶ > `目的を選ぶまで「日時を選ぶ」は押せず、理由が読める`
  - ご用件を選ぶ > `公開している目的が 0 件なら、電話番号の案内を出して工程へ進ませない`
- **実装の要点**: 選択は `<button aria-pressed>` ではなく `role="radio"` を持つ `<input type="radio">` +
  `<fieldset>` にする（モックの偽物の role を持ち込まない。`07-nfr.md` §2.3）。
  触れる大きさは 44pt 以上。選択を**縁の太さだけで示さない**（札の文字も置く）。
  説明文は 2 つまで・各 1 行。状態の札は 3 つまで。**空いた場所を埋めるために要素を足さない。**
- **完了条件**: 10 本が緑。
- **依存**: T-013

## T-015 WEB-03-DATETIME を作る（Red → Green）

- **目的**: 一週間の空き具合を先に見せ、押せない枠を色と文字の両方で示す。
- **触るファイル**
  - `services/glasses_management/src/web/public/DateTimeStep.tsx`（新規）
  - `services/glasses_management/src/web/public/DateTimeStep.test.tsx`（新規）
- **見るモック**: `images/WEB-03-DATETIME.png`
- **実測値**
  | 部位 | 値 |
  |---|---|
  | 週の送り | `margin 28px 0 10px` / `gap 8px`。`‹` `›` は **44×44px** / 角 12px。中央の「8月27日 〜 9月2日」は 16px |
  | 日の並び | 7 列 / `gap 4px`。1 件は `min-height 64px` / `padding 6px 0` / 角 8px / 数字 20px 太字 |
  | 曜日 / 状態 | 13px 標準（曜日）/ 13px 太さ 600（「定休」。`--color-ink-faint`） |
  | 選んだ日 | 縁 3px `--color-pine` + 地 `--color-pine-soft` + 文字 `--color-pine-deep` |
  | 押せない日 | 地 `--color-surface-2` + 文字 `--color-ink-faint` + 「定休」 |
  | 小見出し | 「8月29日（土）のお時間」。`margin 28px 0 10px` |
  | 時刻の並び | **4 列** / `gap 10px`。1 件は `min-height 60px` / 角 12px / 16px 太字 |
  | 時刻の状態 | 選択中は縁 3px + 「選択中」（13px `--color-pine-deep`）、満は地 `--color-surface-2` + 「満」 |
- **先に書くテスト**
  - 日時を選ぶ > `見出しは「ご希望の日時をお選びください」で、補足に選んだ目的の所要が入る`
  - 日時を選ぶ > `定休日は押せず「定休」と読める`
  - 日時を選ぶ > `埋まっている時刻は押せず「満」と読める`
  - 日時を選ぶ > `押せない理由は色だけでなく文字でも分かる`
  - 日時を選ぶ > `受け付ける時間（10:30–18:00）の外の時刻は候補に出ない`
  - 日時を選ぶ > `お昼（12:00–13:00）の時刻は候補に出ない`
  - 日時を選ぶ > `30 日先ちょうどの日は選べ、31 日先を含む週へは「›」が進めない`
  - 日時を選ぶ > `日と時刻の両方が選ばれるまで「お客様の情報を入力する」は押せない`
  - 日時を選ぶ > `その週に空きが 1 つも無ければ、週の表は残したまま「この週に空きがありません。」と次に空きのある週へ跳ぶボタンを 1 つだけ出す`
  - 日時を選ぶ > `空き枠の再計算が終わったことを role="status" で読み上げる`
- **実装の要点**: 押せない枠は `disabled` にせず `aria-disabled="true"` + 理由の文字にする
  （`07-nfr.md` §2.3「理由なしの disabled を置かない」）。週の送りは `‹` `›` を `aria-hidden`、
  ボタンには「前の週」「次の週」の名前を付ける。日時変更（WEB-CANCEL 経由）でもこの画面をそのまま使い、
  見出しだけ「ご予約の変更」に差し替える（専用の画面を起こさない）。
- **完了条件**: 10 本が緑。
- **依存**: T-013

## T-016 WEB-04-FORM と WEB-05-CONFIRM を作る（Red → Green）

- **目的**: 4 欄だけを伺い、送る前に 5 行で読み返せるようにする。
- **触るファイル**
  - `services/glasses_management/src/web/public/FormStep.tsx`（新規）
  - `services/glasses_management/src/web/public/ConfirmStep.tsx`（新規）
  - `services/glasses_management/src/web/public/kana.ts`（新規。IME の 2 段構えと「人が触れた欄」の記憶）
  - `services/glasses_management/src/web/public/FormStep.test.tsx`（新規）
  - `services/glasses_management/src/web/public/ConfirmStep.test.tsx`（新規）
- **見るモック**: `images/WEB-04-FORM.png` / `images/WEB-05-CONFIRM.png`
- **実測値**
  | 部位 | 値 |
  |---|---|
  | 欄の並び | `gap 20px`、上 `margin 28px` |
  | 見出し / 入力 | 13px `--color-ink-muted` / `min-height 52px`・16px・角 12px・縁 1px `--color-line-strong` |
  | 焦点のある欄 | 縁 **2px** `--color-pine` |
  | 確認の表 | 上 `margin 28px`、角 12px、縁 1px `--color-line`、行の間に 1px の罫（最後の行は無し） |
  | 行 | `min-height 56px` / `padding 12px 16px` / `gap 12px` |
  | 見出し列 / 値 / 変更 | 幅 66px・13px / 16px 太さ 600（補足は 13px 標準）/ 13px 太さ 600 `--color-pine` |
  | 1 行目（ご来店） | 地 `--color-pine-soft`、値の色 `--color-pine-deep` |
- **先に書くテスト**
  - お客様の情報 > `見出しは「お客様のことを教えてください」で、補足は「ご予約のご連絡だけに使わせていただきます。」`
  - お客様の情報 > `お電話番号は数字のキーボード（inputmode=numeric）が出る`
  - お客様の情報 > `メールアドレスはメール用のキーボード（type=email / inputmode=email）が出る`
  - お客様の情報 > `お名前・お電話番号・メールアドレスは端末が覚えている値から入れられる（autocomplete が付く）`
  - お客様の情報 > `ふりがなは autocomplete を持たない`
  - お客様の情報 > `工程の途中の欄は enterkeyhint=next、最後の欄は done`
  - ふりがな > `日本語入力の変換中は値を読まず、変換の途中の文字が入らない`
  - ふりがな > `変換を確定すると「やまぐち まお」が一度だけ入る`
  - ふりがな > `お客様が自分でふりがなを直したあとは、名前を打ち直しても上書きしない`
  - ふりがな > `変換の確定イベントが来ない経路でも、欄を離れたときに 1 回だけ埋まる`
  - お客様の情報 > `4 欄が埋まるまで「入力内容を確認する」は押せない`
  - お客様の情報 > `メールアドレスは必須で、空のままでは進めない`
  - お客様の情報 > `電話番号・メールアドレスの形が正しくなければ進めない`
  - ご確認 > `見出しは「この内容でお間違いないですか」で、補足は「まだ確定していません。」`
  - ご確認 > `5 行（ご来店・店舗・ご用件・お名前・ご連絡先）が入力と一致する`
  - ご確認 > `ご用件の行は対客名（新しいメガネを作る）で、店内名を出さない`
  - ご確認 > `各行の「変更」を押すと該当の工程へ戻り、入力は保たれる`
  - ご確認 > `送信中はボタンの文字が「送信しています…」に変わり、aria-busy が立ち、二度押しできない`
  - ご確認 > `送信中も焦点はボタンに残る（disabled 属性にしない）`
  - ご確認 > `送信の瞬間に枠を取られたら、まだ取れていないことを先に言い、埋まった時刻に「満」を付け、同じ日の空いている時刻を並べる`
  - ご確認 > `回線が切れて同じ内容が再送されても、同じ Idempotency-Key を送り続ける`
- **実装の要点**
  - IME は `compositionstart` 〜 `compositionend` の間 `input` の値を読まない。ふりがなは `compositionend` で
    1 回だけ埋め、`change`（blur）でもう 1 回拾う二段構え。**人が触れた欄は二度と上書きしない**（`07-nfr.md` §2.9）。
  - ソフトキーボードが出ても主操作と入力中の欄が隠れないようにする
    （下の固定は `env(safe-area-inset-bottom)` + `visualViewport` の高さに追随させる）。
  - `Idempotency-Key` は工程の開始時に `crypto.randomUUID()` で 1 つ作り、成功するまで同じ値を送る。
  - 枠競合（409 `slot_taken`）の面は BOOK-CONFLICT と同じ型を 1 カラムで作る。
- **完了条件**: 21 本が緑。
- **依存**: T-013, T-015

## T-017 WEB-06-DONE を作る（Red → Green）

- **目的**: 番号を主役にし、戻り道を消し、メールが出なかった日でもお客様が自分の予約へ戻れるようにする。
- **触るファイル**
  - `services/glasses_management/src/web/public/DoneStep.tsx`（新規）
  - `services/glasses_management/src/web/public/DoneStep.test.tsx`（新規）
- **見るモック**: `images/WEB-06-DONE.png`
- **実測値**
  | 部位 | 値 |
  |---|---|
  | 上のバー | `‹` を**持たない**（`⌂` も無い）。店名は `padding-left 4px` |
  | 進捗 | 6 段すべて点灯。読み上げは「全6ステップが終わりました」 |
  | ✓ の丸 | 56×56px / 地 `--color-pine` / 文字 28px 太字 / `margin 0 auto 12px` |
  | 見出し / 副文 | 20px / 13px `--color-ink-muted`（`margin-top 6px`） |
  | 番号の箱 | 上 `margin 28px` / `padding 16px 12px` / 中央寄せ / 地 `--color-pine-soft` |
  | 番号 | 見出し 13px `--color-ink-muted`、値は 24px 等幅 `--color-pine-deep`（`letter-spacing .04em` / `margin-top 4px`） |
  | 明細 | 上 `margin 24px`。行は `padding 16px 0` + 上 1px の罫（最初の行は罫無し）。見出し列 66px・13px、値 16px 太さ 600 |
  | 下の固定 | 「地図・道順を見る」（56px の緑）+ 「予約を変更・取り消す」（44px の `quiet`。`margin-top 8px`）。下 `padding 140px` |
- **先に書くテスト**
  - 完了 > `前の画面へ戻る「‹」が無い`
  - 完了 > `「ご予約番号」とその番号が読める`
  - 完了 > `「確認番号」とその番号と「ご変更・お取り消しのときにお使いください。」が読める`
  - 完了 > `明細 4 行（ご来店・店舗・ご用件・お名前）が予約の内容と一致する`
  - 完了 > `メールを送れたときは「確認のメールをお送りしました。」を出す`
  - 完了 > `メールを送れなかったときは「確認のメールをお送りしました。」を出さず、「この画面のご予約番号と確認番号をお控えください。メールはお送りできませんでした。」を出す`
  - 完了 > `承認制のときは見出しを「ご予約を承りました」にし、「お店で確認のうえ、本日中にご連絡いたします。確定までお席の確保はできておりません。」を出す`
  - 完了 > `「地図・道順を見る」は店舗の住所を持った外部の地図を新しいタブで開く`
  - 完了 > `「予約を変更・取り消す」は本人確認の画面へ進む`
- **実装の要点**: 確認番号は `emailed` の値にかかわらず**必ず画面に出す**（`04-api.md` §7.2）。
  番号は `--font-mono`。ハイフンは半角（U+002D）だけを使う。
  「ご予約を承りました」の分岐は `PublicBookingResult.status === 'pending'` で決める。
  **`[要確認: Q-01 — いまの前提で進める]`**（`design/09-open-questions.md`）。
  答えが来たらこの 3 つの文言だけを直す（見出し・副文・確定後のメール）。
- **完了条件**: 9 本が緑。
- **依存**: T-013, T-016

## T-018 WEB-CANCEL を作る（Red → Green）

- **目的**: 番号 2 つだけで自分の予約に戻り、変更と取消の 2 つの出口だけを置く。
- **触るファイル**
  - `services/glasses_management/src/web/public/ManageLookup.tsx`（新規。本人確認の 2 欄）
  - `services/glasses_management/src/web/public/ManageDetail.tsx`（新規。明細・変更・取消）
  - `services/glasses_management/src/web/public/ManageLookup.test.tsx`（新規）
  - `services/glasses_management/src/web/public/ManageDetail.test.tsx`（新規）
- **見るモック**: `images/WEB-CANCEL.png`
- **実測値**
  | 部位 | 値 |
  |---|---|
  | 進捗 | **2 段**（両方点灯）。読み上げは「2つの手順のうち2つ目です」 |
  | 明細 | 上 `margin 24px`。見出し列は **78px**（WEB-06 の 66px より広い）・13px。値 16px 太さ 600 |
  | ご来店の行 | 20px `--color-pine-deep` |
  | ご予約番号の行 | `--font-mono` |
  | 期限の 1 行 | 上 `margin 24px` / 13px `--color-ink-muted` |
  | 下の固定 | 「日時を変更する」（56px の緑）+ 「この予約を取り消す」（48px・文字と縁が `--color-danger`・`margin-top 10px`）。下 `padding 152px` |
- **先に書くテスト**
  - 本人確認 > `欄はご予約番号と確認番号の 2 つだけで、「ご予約をお調べする」の 1 操作`
  - 本人確認 > `番号が違うと「ご予約番号か確認番号が違います。お送りしたメールの番号をお確かめください。」を出し、入力を残す`
  - 本人確認 > `番号が違ったとき、どちらが違うかを言わない`
  - 本人確認 > `10 回失敗すると「お待ちください。15分ほど経ってから、もう一度お試しください。」を出す`
  - 本人確認 > `短命の鍵が切れたら「お時間が経ちましたので、もう一度ご予約番号と確認番号をご入力ください。」を出して入力へ戻す`
  - 明細 > `見出しは「ご予約をお調べしました」で、補足は「ご本人様の確認ができました。」`
  - 明細 > `5 行（ご来店・店舗・ご用件・お名前・ご予約番号）が出る`
  - 明細 > `期限の文は設定から作り、画面に固定で書かない`
  - 明細 > `確認番号を 1 度も画面に出さない`
  - 日時の変更 > `WEB-03 と同じ形の候補が出て、見出しだけ「ご予約の変更」に変わる`
  - 日時の変更 > `確かめると「ご来店」の日時がその時刻に変わる`
  - 取消 > `確かめる前に role="alertdialog" で問い直す`
  - 取消 > `取り消すと「ご予約を取り消しました」「またのご来店をお待ちしております。」を出す`
  - 取消 > `取り消したあとは「日時を変更する」も「この予約を取り消す」も出さない`
  - 締切 > `前日の終わりを過ぎていると、変更も取消も押せず、お電話でのご連絡をお願いする案内と店舗の電話番号を出す`
- **実装の要点**: 存在しない番号・確認番号違い・非公開店舗の slug は**すべて同じ文言**にする
  （予約の有無を外に漏らさない。`07-nfr.md` §6.2）。取消の確認だけ `role="alertdialog"`。
  「この予約を取り消す」は `--color-danger` の縁と文字（塗りにしない）。
- **完了条件**: 15 本が緑。
- **依存**: T-013, T-015, T-017

## T-019 SETTINGS-WEB を作る（Red → Green）

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 店長が棚卸しの休みを決めた日に、Web に出す内容を 1 画面で見直して保存する面。
  - トークン計画: 緑は第 2 サイドバーの現在地・「保存」・プレビューの帯の 3 か所だけ。
    左は白の箱 2 枚と罫の一覧、右はプレビュー 1 枚。未保存は札の**文字**で示す。
  - シグネチャ: **右 300px にお客様の画面をそのまま置き、左を触ると即座に変わること**。
- **見るモック**: `images/SETTINGS-WEB.png`（1194×834。実装が持つのは 1194×810）
- **実測値**
  | 部位 | 値 |
  |---|---|
  | 第 2 サイドバー | 幅 **236px** / 地 `--color-surface-2` / 右 1px の罫 / `padding 4px 10px 0` |
  | 群の見出し | 11px（行間 13px）`--color-ink-muted` / `padding 3px 12px 0` |
  | 項目 | `min-height 44px` / `padding 0 12px` / 角 8px / 14px。現在地は緑地に白の太字 |
  | 上の帯 | 高さ **56px** / `1fr auto 1fr` / `padding 0 20px` / 白地 / 下 1px の罫 |
  | 題 / ボタン | 17px 中央 / `min-height 44px`・`padding 0 16px`・15px |
  | 本文 | `padding 32px 40px`。2 列は `1fr 300px` / `gap 28px` |
  | 群の名前 | `margin 20px 2px 10px` |
  | 箱の中の行 | `min-height 52px`。罫の一覧の行は `padding 14px 0` |
  | プレビュー | 角 16px / 縁 1px `--color-line-strong`。帯は緑地に白 14px 太字（`padding 12px 16px`） |
  | プレビューの中 | `padding 18px 16px 20px`。問い 15px 太字（下 12px）。1 件は `min-height 56px` / `padding 8px 14px` / 角 12px / 14px 太さ 600、補足 12px。件の間は 10px |
  | プレビューの注記 | 上 16px / `padding 12px 14px` / 角 8px / 地 `--color-pine-soft` / 13px `--color-pine-deep` / 行間 1.6 |
  | お知らせ文 | 本文 16px（行間 1.8）+ 「27文字／120文字まで」+ 「書き直す」（44px / `padding 0 16px`） |
- **触るファイル**: `services/glasses_management/src/web/settings/{WebPublication.tsx,WebPreview.tsx}`（新規）
  ＋ P1 が作った設定の器（第 2 サイドバーの「Web予約」群に「公開」を足す）
- **先に書くテスト**
  - Web予約の公開 > `「Web予約を公開する」は role="switch" で、行全体（52px）が押せる`
  - Web予約の公開 > `切ると値が「公開していません」に変わる`
  - Web予約の公開 > `ご案内のページは stores.slug から組み立てた文字を出す`
  - 受け付ける内容 > `5 行（公開する目的・受け付ける時間・何時間先から受ける・何日先まで受ける・ご予約の確定）が並ぶ`
  - 受け付ける内容 > `「ご予約の確定」は「お店が確かめてから確定する」の 1 値だけで、押しても選択肢が出ない`
  - お知らせ文 > `文字数が「27文字／120文字まで」の形で出る`
  - お知らせ文 > `121 文字目は入らない`
  - お客様の画面の見え方 > `公開する目的をすべて出す（5 件のときは 5 件）`
  - お客様の画面の見え方 > `出る名前は対客名で、店内名は 1 つも出ない`
  - お客様の画面の見え方 > `公開する目的から 1 件外すと、その場でプレビューからも消えて 4 件になる`
  - お客様の画面の見え方 > `お知らせ文を書き換えると、保存しなくてもプレビューの注記が変わる`
  - 保存 > `未保存の変更があると「未保存の変更 1件」の札が出る`
  - 保存 > `公開する目的が 0 件のまま公開しようとすると「公開する目的が 0 件のため公開できません。ご来店の目的を 1 つ以上 Web に出してください。」を出し、値を変えない`
  - 保存 > `他の端末が先に保存していたら、どちらも書き換えずに衝突を伝える`
  - 保存 > `スタッフの権限で保存すると、店長だけができることを伝え、下書きを残す`
- **実装の要点**: モックの `<span class="toggle" aria-hidden="true">` を**そのまま持ち込まない**
  （`role="switch"` + `aria-checked`。行のラベルをアクセシブル名にする）。
  プレビューは保存を伴わない（`GET .../preview` に未保存の値をクエリで渡す）。
  「ご予約の確定」の行は読み取り専用（自動確定の選択肢を作らない）。
- **完了条件**: 15 本が緑。web 側カバレッジ 4 指標 60% 以上。
- **依存**: T-012

## T-020 E2E を書き、spec を Approved に上げる

- **目的**: UC-WEB-01〜13 と AC-WEB-01〜23 の **36 個**に、Playwright の test をちょうど 1 本ずつ対応させる。
- **触るファイル**
  - `services/glasses_management/e2e/web-booking.spec.ts`（新規。**iphone** project が拾う）
  - `services/glasses_management/e2e/web-booking-settings.spec.ts`（新規。**ipad** project が拾う）
  - `services/glasses_management/seed.mjs`（銀座店の Web 予約の seed を足す）
  - `specs/glasses_management/features/011-web-booking/spec.md`（`- ステータス:` を上げる）
  - `docs/testing/E2E_TRACEABILITY.md`（`## 現在の基準線` の表に 36 行）
- **やること**
  - **ipad の 8 本**（`web-booking-settings.spec.ts`）:
    `UC-WEB-01` / `UC-WEB-02` / `UC-WEB-09` / `UC-WEB-10` / `AC-WEB-01` / `AC-WEB-02` / `AC-WEB-07` / `AC-WEB-22`
  - **iphone の 28 本**（`web-booking.spec.ts`）:
    `UC-WEB-03` `UC-WEB-04` `UC-WEB-05` `UC-WEB-06` `UC-WEB-07` `UC-WEB-08` `UC-WEB-11` `UC-WEB-12` `UC-WEB-13` と
    `AC-WEB-03` 〜 `AC-WEB-06` / `AC-WEB-08` 〜 `AC-WEB-21` / `AC-WEB-23`
  - 対応づけの書式は **`// @e2e-covers AC-WEB-NN`** を `test(` の**直前の行**に置く（間に別の文・別のコメント・
    `test.describe` を挟まない。空行は可）。`test.only` / `test.skip` / `test.fixme` は traceability が落ちる。
  - ファイル名は**この 2 つでなければならない**。`playwright.config.ts` の `iphone` project は
    `/web-booking\.spec\.ts$/` にだけ一致し、`ipad` project は `web-booking.spec.ts` を除外する。
  - seed の値は世界観データに合わせる: 組織 `eye` / 店舗 `ginza`（`EYE 銀座店`）/
    ご来店 2026-08-29（土）11:00 / 山口 真央 / `080-2345-6789` / `m.yamaguchi@example.jp` /
    ご予約番号 `EY-W-2608-0031`。受付条件は 10:30–18:00 / 2 時間先から / 30 日先まで / お店が確かめてから確定する。
  - 全 36 個が埋まったら spec の `- ステータス: Draft` を `Approved` に上げる。
- **完了条件**: `pnpm --filter @app/glasses_management e2e` が緑。`pnpm run test:traceability` が
  `unknown` / `duplicate` / `missing` を 1 件も出さない。
- **依存**: T-014, T-015, T-016, T-017, T-018, T-019

## T-021 モックとの突き合わせを足す

- **目的**: 承認された見た目からどれだけ離れているかを、画素で測って記録に残す。
- **触るファイル**
  - `services/glasses_management/e2e/mock-compare-web.spec.ts`（新規。**mock-phone** project が拾う）
  - `services/glasses_management/e2e/mock-compare.spec.ts`（SETTINGS-WEB の 1 本を足す）
  - `services/glasses_management/playwright.config.ts`（`ipad` project の `testIgnore` に
    `/mock-compare-web\.spec\.ts$/` を足す）
- **やること**
  - **先に `playwright.config.ts` を直す。** いまの `ipad` project は `web-booking.spec.ts` と
    `mock-compare.spec.ts` しか除外していないので、新しい `mock-compare-web.spec.ts` が
    1194×834 でも走って必ず落ちる。
  - 基準画像は `docs/frontend/mockups/eye/reference/` 側（ステータスバーを外した派生物）。
    既に 8 枚そろっている（WEB-01〜06 / WEB-CANCEL は 780×1600 = 390×800 @2x、
    SETTINGS-WEB は 2388×1620 = 1194×810 @2x）。作り直すときは
    `node docs/frontend/mockups/eye/reference.mjs WEB` と `... SETTINGS-WEB`。
  - `toHaveScreenshot('<画面ID>.png', { scale: 'device', maxDiffPixelRatio: <いま許している差> })`。
    **`scale: 'device'` を必ず付ける**（既定の `'css'` だと寸法が合わない）。
  - 残っている差が何かを 1 行ずつコメントに書く（0.2 の「わざと違うところ」6 件がそのまま差になる）。
    **`maxDiffPixelRatio` は下げるだけ。上げてはいけない。**
- **完了条件**: `pnpm --filter @app/glasses_management exec playwright test --project=mock --project=mock-phone`
  が緑。WEB-01〜06 と WEB-CANCEL の差分が各 5% 以下、SETTINGS-WEB が 8% 以下。
- **依存**: T-020

## T-022 完了の確認

- **目的**: このフェーズが終わったことを、機械が確かめられる形で残す。
- **触るファイル**: `docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md`（追記）/
  `knip.jsonc`（entry を実在のものだけにする）
- **先に書くテスト**: なし（既存のテストを走らせるだけ）。
- **実装**: 下のコマンドを上から順に実行し、赤いものを直してから次のコマンドへ進む。**飛ばさない。**

```sh
pnpm run lint                                   # 緑
pnpm run deps:check                             # 緑（knip.jsonc の entry を実在のものだけにする）
pnpm run typecheck                              # 緑
pnpm --filter @app/glasses_management test      # 緑・カバレッジ 4 指標 80% 以上
pnpm --filter @app/glasses_management test:web  # 緑・カバレッジ 4 指標 60% 以上
pnpm run test:traceability                      # 緑（36 個がちょうど 1 本ずつ）
pnpm --filter @app/glasses_management e2e       # 緑
pnpm --filter @app/glasses_management exec playwright test --project=mock --project=mock-phone   # 緑
pnpm check                                      # 緑
```

- `[要確認: Q-01]` と `[要確認: Q-09]` が**いまの前提のまま実装されている**ことを目で確かめる
  （答えが来たら直す場所は `design/09-open-questions.md` の Q-01 / Q-09 の一覧で閉じる）。
- **完了条件**
  - 上の 9 コマンドがすべて緑。
  - `specs/glasses_management/features/011-web-booking/spec.md` が `- ステータス: Approved` で、
    UC-WEB-01〜13 と AC-WEB-01〜23 の 36 個すべてに `@e2e-covers` が 1 対 1 で付いている。
  - Worker 側カバレッジ 4 指標 80% 以上 / web 側 60% 以上（**閾値を下げない・広く除外しない**）。
  - `docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md` に、
    実行したコマンド・その結果・カバレッジの実測値・`maxDiffPixelRatio` の実測値を書いた。
- **依存**: T-021
