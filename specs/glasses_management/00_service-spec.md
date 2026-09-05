# サービス仕様: glasses_management

- パッケージ: `services/glasses_management` (`@app/glasses_management`)
- Worker 名: `glasses-management`
- 所有 D1: `glasses_management`（binding `DB` / `migrations_dir: migrations`。1 サービス = 1 D1。cross-D1 JOIN 禁止）
- 所有 KV: `SHORT_LIVED`（Terraform: `glasses-management-short-lived`）— 短命状態のみ（TTL 必須）。書き込み API の冪等レコードの正本は D1 の `idempotency_records`
- 所有 R2: `RECORDINGS`（Terraform: `glasses-management-recordings`、location `apac`）— 非公開。署名付き URL も公開バケットも作らない
- service binding: `NOTIFIER` → Worker `notifier`（`POST /api/internal/send` を `x-internal-key` 付きで同期呼び出し）
- 受信 binding: admin の `GLASSES_MANAGEMENT` → 本 Worker（組織スナップショットの push 先）
- secrets: `INTERNAL_KEY` / `JWT_SECRET` / `AUTH_DEV_GRANT`（dev のみ）
- dev port: 5175（`make dev/glasses_management`。`make dev/all` で admin:5174 と併走）
- ステータス: Approved（**再承認が要る**。第3巡で下の 3 種類の追随を入れた — ①列名・index 名を `design/03-data-model.md` の正本へそろえた（`stores.name_public` / `stores.intro_text` / `equipment.inactive_reason` / `staff.max_parallel_reservations` / `staff_weekly_shifts` の `is_off` ＋ `break_start` / `break_end` / `reservations_org_store_status_start_idx` / `walk_ins_org_store_date_status_idx`。挙動は変わらない）②エンティティ表に `reservation_slot_locks` と `reception_sessions.draft_json` を足した ③`walk_ins.reservation_id` を NULL 可から NOT NULL に改めた。③だけは挙動の変更にあたる）

## 目的・責務

眼鏡店チェーン **EYE** の予約管理を担う。1 Worker が業務用 SPA（iPad 11 インチ 横向き 1194×834pt）と
お客様向け Web 予約 SPA（iPhone 390×844pt）と Hono API を同一オリジンで配信する。

**所有するもの**（このサービスの D1 が正本）:

| 領域 | 所有する事実 |
|---|---|
| 店舗と受付条件 | 店舗・営業時間・臨時休業・枠の刻み・スタッフ・技能・シフト・設備・点検・ご来店の目的とその要求 |
| 予約 | 予約本体・目的の内訳・担当と設備の割当・版（version）・予約番号 `EY-YYMM-NNNN` |
| 来店 | ウォークイン・来店工程イベント・受付セッション |
| 顧客 | 顧客・度数・現在のメガネ・メモと注意ごと（手書き含む） |
| 録音 | 受付録音のメタデータ（本体は R2）・保持期限・アップロード再送状態 |
| 統制 | 端末・端末セッション（共有 / 個人モード）・監査イベント・冪等レコード |
| Web 予約 | 公開設定・Web 予約申込・Web 予約番号・確認番号（ハッシュ保存） |
| 運用 | アラート・日次分析集計 |

**所有しないもの**:

| 事実 | 正本 | 本サービスでの扱い |
|---|---|---|
| 組織（`organizations`） | `services/admin` | 同期コピーを保持。自分で作成・更新しない |
| 認証（ユーザー・パスワード・招待・refresh token） | `services/admin` | admin が HS256 で発行した access JWT を `JWT_SECRET` 共有で検証するだけ |
| メール送信 | `services/notifier` | service binding で同期送信を依頼するだけ（best-effort） |
| D1 バックアップ・鮮度監視 | `services/ops` — `CODEMAP.md` と `docs/howto/deploy.md` に記述があるが、**本リポジトリに実体が無い**（`git ls-files services/ops` が 0 件） | 依存しない。ただし本サービスの D1 を戻す手段は現時点で D1 Time Travel（7 日）だけである（末尾の不明点） |
| デザイントークンの定義 | `packages/ui/src/theme.css` | 参照のみ。モックの生 hex を SPA に書かない |
| API 契約（Zod）の定義 | `packages/contracts/src/glasses_management.ts` | 参照のみ。手書き型を書かない |

見た目の正本は `docs/frontend/mockups/eye/`（68 画面の HTML + PNG + `assets/eye.css`）。
`docs/frontend/mockups/eye/assets/eye.css` の値は `packages/ui/src/theme.css` のセマンティックトークンへ翻訳して使う。

## エンティティ（所有データ）

共通規約: ID は `crypto.randomUUID()` のアプリ生成 / FK を宣言しない（整合はアプリ層）/
全ドメイン行に `organization_id` / 真偽値は `text` の `'0'|'1'` / 日時は ISO8601 文字列の `text` /
時刻は `HH:MM` の `text` / 日付は `YYYY-MM-DD` の `text` / DDL DEFAULT に意味を持たせない /
時間順の並びは `created_at`（UUID v4 は k-sortable ではない）。
以下の表で `slot_minutes(30)` のように括弧で添えた数値は**アプリ層が入れる既定値**であり、DDL の `DEFAULT` ではない。
列挙値（`kind` / `status` / `state` / `stage` など）は Zod の `z.enum` を単一ソースとし、DB 側は制約を持たない。

### 同期・組織

| テーブル | 主な属性 | 備考 |
|---|---|---|
| `organizations` | id / name / plan / is_disabled / created_at / revision | admin からの同期コピー。`revision` 単調増加の条件付き upsert。本サービスからは書き換えない |
| `store_memberships` | id / organization_id / store_id / user_id / permissions（空白区切り） / created_at | admin からの同期コピー。「誰がどの店舗で何をしてよいか」。担当解除は行削除ではなく `permissions` を空文字にした配信で届く。**決定ブリーフ §3 の正式テーブルとして追認済み**（受け口が無いと admin の `PATCH /api/users/:id` が 502 になる） |

### 店舗と受付条件

| テーブル | 主な属性 | 備考 |
|---|---|---|
| `stores` | id / organization_id / name / name_public / slug / phone / address / nearest_station / access_note / parking_note / intro_text / is_active / sort_order / created_at / updated_at / updated_by | **列名の正本は `design/03-data-model.md` §4.1**（`public_name` / `intro` という別名を作らない）。`slug` は Web 予約の `/w/:storeSlug` に使い、**全組織横断で一意**（`/api/public/**` は未認証で組織を持たないので、組織内一意では店舗を解決できない）。`name_public` は Web 予約に出す店名、`intro_text` は紹介文（200 文字まで）、`access_note` は道順。`sort_order` は Web の店舗一覧の並び順（登録順。位置情報は使わない）。**P0 実装（`migrations/0000_talented_korvac.sql`）はこのうち `name` / `slug` / `phone` / `address` / `access_note` / `is_active` までしか持たず、index も `stores_org_slug_unique_idx (organization_id, slug)` である。残りの列の追加と `stores_slug_idx (slug)` への張り替えは P1 の `0001_*.sql` で行う** |
| `store_business_hours` | id / organization_id / store_id / weekday(0=日..6=土) / is_closed / opens_at / closes_at | 曜日ごとの既定。受付を止める時間帯は下の `store_blackout_windows` が持つ（1 帯しか持てない `break_start` / `break_end` は使わない） |
| `store_blackout_windows` | id / organization_id / store_id / weekday(nullable=毎日) / label / starts_at / ends_at / sort_order | 受付を止める時間帯。初期セットは **3 帯**（「朝の支度」10:00–10:15 ／「お昼」**12:00–13:00** ／「閉店前の片付け」18:40–19:00）。SETTINGS-HOURS が「＋ 止める時間帯を足す」を持つため 1 帯に丸めない |
| `store_calendar_exceptions` | id / organization_id / store_id / date / kind('closed'\|'special') / opens_at / closes_at / note | 既定より優先して解決する |
| `store_slot_rules` | id / organization_id / store_id / slot_minutes(30) / cleanup_minutes(10) / max_parallel(3) / version / updated_at | `version` で楽観ロック |
| `store_settings_revision` | id / organization_id / store_id / revision / updated_at / updated_by | 店舗の設定全体の版を 1 本で持つ。`version` 列を持たない設定 7 表（`staff` / `staff_skills` / `staff_shifts` / `equipment` / `equipment_maintenance` / `store_business_hours` / `store_calendar_exceptions`）の保存はすべてこの版で衝突を見る |
| `staff` | id / organization_id / store_id / admin_user_id(nullable) / display_name / kana / job_label / role('manager'\|'staff') / max_parallel_reservations(1) / pin_hash / pin_updated_at / is_active / sort_order / created_at | `admin_user_id` は admin のユーザーとの対応。`role` は 2 値だけ（店長 / スタッフ＝設定は見るだけ）。`max_parallel_reservations`（1〜5・既定 1）は「同時に受け持てるご予約」で、店舗全体の `store_slot_rules.max_parallel` とは別。**`max_parallel` という短縮名は使わない**（`design/04-api.md` §4.0）。`pin_hash` は**担当ごと**の 4〜6 桁（端末の `terminals.pin_hash` とは別物） |
| `staff_skills` | id / organization_id / store_id / staff_id / skill_code | 目的が要求する技能の充足判定に使う |
| `staff_weekly_shifts` | id / organization_id / store_id / staff_id / weekday(0=日..6=土) / is_off / starts_at(nullable) / ends_at(nullable) / break_start(nullable) / break_end(nullable) / effective_from / created_at | 勤務の**正本**。SETTINGS-STAFF は月〜日の 7 行で編集する。**`kind('work'\|'break')` 列は持たない** — お休みは `is_off='1'`、休憩は `break_start` / `break_end` の 1 帯で表す（列名の正本は `design/03-data-model.md` §5.6）。展開先の `staff_shifts` だけが `kind` を持つ |
| `staff_shifts` | id / organization_id / store_id / staff_id / date / starts_at / ends_at / kind('work'\|'break') | `staff_weekly_shifts` を 62 日先まで展開した結果。展開は保存時と日次 Cron の両方で行い、窓を先へ送り続ける |
| `equipment` | id / organization_id / store_id / name / kind('measure'\|'counter'\|'workbench') / capacity / inactive_reason(nullable) / is_active / sort_order | 初期セットは **7 件**（決定ブリーフ §12.3 が正。§11 の 5 件は誤り）。視力測定機 A・視力測定機 B・**検査室 1** = `measure` ／ 相談カウンター 1・相談カウンター 2・**フィッティング台** = `counter` ／ 加工室 = `workbench` |
| `equipment_maintenance` | id / organization_id / store_id / equipment_id / starts_at / ends_at / note | 点検中は割当不可 |
| `visit_purposes` | id / organization_id / store_id(nullable=チェーン共通) / name_internal / name_public / name_short / duration_minutes / is_web_published / is_active / sort_order / version | `store_id` が NULL ならチェーン共通。初期セットは **6 件**（メガネを新しく作る 60 ／ 今のメガネを調整したい 20 ／ できあがりを受け取る 20 ／ 修理・部品交換 30 ／ コンタクトの相談 40 ／ 視力測定だけ 30）。`name_public` の正本は SETTINGS-PURPOSE の「お客様に見せる名前」列。`name_short` は台帳の帯・HOME の一覧・影響カードに出す短い名前（30 分幅の帯に `name_internal` が入らない）。Web に出すのは `is_web_published='1'` の **5 件**（非公開は修理・部品交換だけ） |
| `purpose_requirements` | id / organization_id / purpose_id / kind('skill'\|'equipment_kind') / value | 目的が要求する技能・設備種別 |

### 予約と来店

| テーブル | 主な属性 | 備考 |
|---|---|---|
| `reservations` | id / organization_id / store_id / code(`EY-YYMM-NNNN`) / customer_id(nullable) / source('phone'\|'counter'\|'web'\|'walkin') / status('confirmed'\|'arrived'\|'serving'\|'done'\|'cancelled'\|'no_show') / starts_at / ends_at / duration_minutes / note_customer / note_internal / version / created_at / updated_at / created_by / cancelled_at / cancel_reason | `customer_id` は NULL 可（顧客未特定のまま受ける）。`version` で楽観ロック。出どころは画面の 4 語（お電話 = `phone` ／ 店頭 = `counter` ／ Web予約 = `web` ／ ウォークイン = `walkin`）と 1 対 1。色は 3 系統（緑・青・茶）だが語は 4 つある |
| `reservation_purposes` | id / organization_id / reservation_id / purpose_id / duration_minutes / sort_order | 1 予約に複数の目的。合計が所要時間 |
| `reservation_assignments` | id / organization_id / reservation_id / kind('staff'\|'equipment') / target_id(nullable=未定) / starts_at / ends_at | `target_id` が NULL（あとで決める）でも枠を消費する |
| `reservation_slot_locks` | id / organization_id / store_id / reservation_id / kind('staff'\|'equipment') / target_key(`staff.id` \| `equipment.id` \| `'unassigned'`) / slot_start / created_at | **枠の一次排他**。刻み（`slot_minutes`）単位に展開した占有行で、予約の確定・変更・取消と**必ず同じ `db.batch()`** で INSERT / DELETE する。二重予約を DB 側で止める唯一の手段（`db.batch()` は「同じバッチの中で読んで判定して書く」ことができないため。下の「枠の一次排他」）。**表を新設するのは P2（`005-availability-and-ledger`）**。決定ブリーフ §3 に無い表の追加なので人間の追認が要る |
| `walk_ins` | id / organization_id / store_id / ticket_no / visit_date / arrived_at / purpose_id(nullable) / purpose_note / customer_id(nullable) / reservation_id / status('waiting'\|'serving'\|'booked'\|'left') / left_at / created_at | 予約なしの来店。**`reservation_id` は NULL 可にしない** — 受付と同時に `source='walkin'` の予約を 1 件起こして必ず結ぶ（持たせないと担当も開始時刻も空き枠エンジンから見えず、同じ枠を電話予約と取り合う。`design/03-data-model.md` §7.4）。`waiting → booked` は新しい予約を作る操作ではなく、**すでに結んである予約を当日の枠から先の枠へ差し替える**操作である。`ticket_no` は画面に「ウォークイン 004」「ウォークイン 005」と 3 桁で出る（LEDGER-WALKIN）。`status` は `visit_events.stage` の写しにしない（「先の枠のご予約になったか」は stage に無い軸である）。ご用件は受付パネルの 4 択（`purpose_id`）で選ばなかったときに `purpose_note` へ自由記述で残す（LEDGER-STAFF「フレームの相談」） |
| `visit_events` | id / organization_id / store_id / subject_type('reservation'\|'walkin') / subject_id / stage('received'\|'waiting'\|'consulting'\|'fitting'\|'measuring'\|'checkout'\|'handover'\|'left') / occurred_at / staff_id / note | 追記専用。来店進捗の唯一の根拠。`fitting` = 盤面の「フレーム選び」、`handover` = 「お渡し」。**`handover` は決定ブリーフ §3.3 の 7 値に足した 8 つ目である**（「お渡し 対応中」の伊藤 健 様が「ご来店中 4名」に数えられているため、`left` を「お渡し」に当てられない） |

### 受付セッションと録音

| テーブル | 主な属性 | 備考 |
|---|---|---|
| `reception_sessions` | id / organization_id / store_id / reservation_id(nullable) / terminal_id(nullable) / actor_id(nullable) / started_at / ended_at(nullable) / outcome('booked'\|'discarded'。進行中は NULL) / draft_json(nullable) / created_at | 予約が成立しなくても行は残す。**`draft_json` は予約 5 工程の下書き置き場**（選んだ id と入力途中の文字だけ）。iPadOS の Safari は裏に回ったタブを捨てるので端末側に置けない。**この表を新設するのは P3（`006-booking-flow`）** であり、P5 の来店受付はその表を来店側へ広げて使う |
| `recordings` | id / organization_id / store_id / reception_session_id / reservation_id(nullable) / code(`EY-R-NNNN`) / r2_key / content_type / duration_seconds / bytes / state('recording'\|'uploading'\|'stored'\|'failed'\|'deleted') / retain_until / legal_hold / upload_attempts / created_at | 本体は R2。D1 はメタデータのみ。`content_type` の既定は `audio/mp4`（AAC 32kbps モノラル。iPadOS の Safari の MediaRecorder が確実に出せる形式で、60 分でも約 14MB）。`code` は ALERTS が出す人が読む録音番号 |

### 顧客

| テーブル | 主な属性 | 備考 |
|---|---|---|
| `customers` | id / organization_id / customer_number(`G-NNNNN`) / name / kana / phone / phone_normalized / phone_last4 / email / birth_date / address / memo / first_visit_at / last_visit_at / visit_count / merged_into_id(nullable) / version / created_at / updated_at | `phone_normalized` は数字のみに正規化した文字列。**候補の拾い方は 2 通りで、どちらも B-tree が効く形にする** — 予約フローのお客様の推定は `phone_normalized` の**前方一致**（BOOK-04b は 090-1234-5678 に対し下 4 桁の違う 090-1234-9912 も候補に出す）、受付パネルの「下4桁でも探せます」は `phone_last4` の**完全一致**。後方一致では index が効かないので使わない。`customer_number` は人が読む番号で、統合で失った番号は再利用しない |
| `customer_prescriptions` | id / organization_id / customer_id / store_id / measured_at / r_sph / r_cyl / r_axis / r_add / l_sph / l_cyl / l_axis / l_add / pd / note / is_current | 度数の履歴 |
| `customer_glasses` | id / organization_id / customer_id / store_id / purchased_at / frame_name / lens_name / usage_label / note / is_current | 今かけているメガネ |
| `customer_notes` | id / organization_id / customer_id / store_id / kind('memo'\|'attention') / body / handwriting_key(nullable) / author_id / revision / status('draft'\|'published'\|'hidden') / created_at | 注意ごとは上書きせず `revision` を増やして追記する。**手書きの筆跡は D1 に入れず R2（`RECORDINGS` と同じバケット）に置き、`handwriting_key` にキーだけを持つ**（1 枚 3〜12KB × 5 枚 × 5,000 顧客で 300MB になり、D1 の 500MB のうち手書きだけで 6 割を占めるため）。枚数は 1 顧客 5 枚まで |

### 統制

| テーブル | 主な属性 | 備考 |
|---|---|---|
| `terminals` | id / organization_id / store_id / name / kind('shared'\|'personal') / pin_hash / auto_lock_seconds / is_active / created_at | PIN はハッシュのみ保存 |
| `terminal_sessions` | id / organization_id / store_id / terminal_id / staff_id(nullable) / mode('shared'\|'personal') / started_at / expires_at / revoked_at | 個人モードは `expires_at` で共有へ戻る |
| `audit_events` | id / organization_id / store_id / actor_type('staff'\|'terminal'\|'system'\|'customer') / actor_id / terminal_id / action / target_type / target_id / before_json / after_json / correlation_id / occurred_at | 追記専用。UPDATE / DELETE しない |
| `idempotency_records` | key(PK) / organization_id / scope / request_hash / response_json / status / created_at / expires_at | 同じ key + 同じ `request_hash` は保存済み応答を返す |

### Web 予約・運用

| テーブル | 主な属性 | 備考 |
|---|---|---|
| `web_booking_settings` | id / organization_id / store_id / is_published / opens_at / closes_at / accept_from_hours / accept_until_days / requires_approval / message / version / updated_at | 店舗ごとの公開条件 |
| `web_bookings` | id / organization_id / store_id / reservation_id / public_code(`EY-W-YYMM-NNNN`) / confirmation_key_hash / management_code_hash / contact_name / contact_kana / contact_phone / contact_email / status('pending'\|'confirmed'\|'cancelled') / created_at | 本人確認の番号はハッシュのみ保存。平文は発行時の応答とメールにだけ載せる。**画面とメールに出す語は「確認番号」**（`management_code` はコードと DB の中だけの名前。「管理コード」は画面に出さない）。`public_code` は Web 予約の予約番号で、店内予約の `reservations.code`（`EY-YYMM-NNNN`）とは**別系統で採番する** |
| `alerts` | id / organization_id / store_id / code / severity('info'\|'action') / title / body / target_type / target_id / occurred_at / read_at / resolved_at / resolved_by | 種別は `code` が表す（語彙は各フェーズの spec で足す）。`severity='action'` が ALERTS 画面の左ペイン「アラート（対応が必要）」、`'info'` が「お知らせ」、`resolved_at` の入った行が「対応済み」。録音アップロード失敗と Web 予約の承認待ちを含む |
| `analytics_daily` | id / organization_id / store_id / date / metric / dimension / dimension_key / value | 日次の事前集計。画面は集計済み行だけを読む |

### index の方針

実際のクエリ形に合わせた複合 index を張る。名前は `<table>_<cols>_idx`。**名前と対象列の正本は `design/03-data-model.md`** の各節で、最低限は次の 14 本。

| index | 対象列 | 効かせる画面 |
|---|---|---|
| `reservations_org_store_start_idx` | `(organization_id, store_id, starts_at)` | 台帳（日付 × 店舗） |
| `reservations_org_store_status_start_idx` | `(organization_id, store_id, status, starts_at)` | 予約リストの絞り込み・当日の未着 |
| `reservations_org_code_idx` | `(organization_id, code)` | 予約番号での検索 |
| `customers_org_phone_idx` | `(organization_id, phone_normalized)` | お客様の推定（**前方一致**。後方一致では効かない） |
| `customers_org_phone_last4_idx` | `(organization_id, phone_last4)` | 受付パネルの「下4桁でも探せます」 |
| `customers_org_kana_idx` | `(organization_id, kana)` | 顧客台帳の並び・カーソル |
| `walk_ins_org_store_date_status_idx` | `(organization_id, store_id, visit_date, status)` | 来店受付ボードの「いまお待ち N名」（**必ず当日で絞る**） |
| `walk_ins_org_store_arrived_idx` | `(organization_id, store_id, arrived_at)` | 台帳の最終行（ウォークイン行）・受付ボードの並び |
| `audit_events_org_occurred_idx` | `(organization_id, occurred_at)` | 受付履歴の経緯 |
| `visit_events_org_subject_idx` | `(organization_id, subject_type, subject_id, occurred_at)` | 来店進捗の最新値 |
| `analytics_daily_org_store_date_metric_idx` | `(organization_id, store_id, date, metric)` | 分析 5 面 |
| `alerts_org_store_occurred_idx` | `(organization_id, store_id, occurred_at)` | お知らせ |
| `recordings_org_state_retain_idx` | `(organization_id, state, retain_until)` | 録音の掃除 Cron |
| `reservation_slot_locks_org_store_target_slot_idx` | `(organization_id, store_id, kind, target_key, slot_start)` | 枠の占有数の判定（**一意にしない**。下の「枠の一次排他」） |

### 空き枠の決まり

ある店舗・ある日の枠は次の 8 条件の積で決まる。純関数として `src/worker/domain/availability.ts` に置き、
現在時刻は引数で注入する（`Date.now()` を関数内で読まない）。

| # | 条件 | 参照 |
|---|---|---|
| 1 | 営業日か | `store_calendar_exceptions` → `store_business_hours` の順に解決 |
| 2 | 営業時間内か（受付を止める時間帯を除く） | `store_blackout_windows` の 3 帯（朝の支度 10:00–10:15 ／ お昼 12:00–13:00 ／ 閉店前の片付け 18:40–19:00） |
| 3 | 刻みと後片付け | `store_slot_rules.slot_minutes`（既定 30 分）/ `cleanup_minutes`（既定 10 分） |
| 4 | 所要時間が収まるか | `reservation_purposes.duration_minutes` の合計 |
| 5 | 技能を持つ担当が勤務中かつ空いているか | `purpose_requirements.kind='skill'` × `staff_skills` × `staff_shifts`。同時に受け持てる件数は `staff.max_parallel_reservations`（1〜5・既定 1） |
| 6 | 設備が点検中でなく空いているか | `purpose_requirements.kind='equipment_kind'` × `equipment` × `equipment_maintenance`。同時に受け入れられる件数は `equipment.capacity`（1〜10・既定 1） |
| 7 | 同時受付上限を超えないか | `store_slot_rules.max_parallel`（既定 3） |
| 8 | （Web 予約のみ）公開条件を満たすか | `web_booking_settings` の公開時間帯 / `accept_from_hours` / `accept_until_days` / `requires_approval` |

`reservation_assignments.target_id IS NULL`（担当があとで決まる予約）も 5〜7 の枠を消費する。
**ウォークインも枠を消費する** — LEDGER-WALKIN の「受付して台帳に載せる」は `source='walkin'` の予約を 1 件起こし、
`walk_ins.reservation_id` で結ぶ。`walk_ins` に開始時刻・担当を別に持たせない（持たせると空き枠エンジンから見えず、
同じ担当の同じ時刻を電話予約と取り合う）。

### 枠の一次排他（二重予約を止める仕掛け）

空き枠エンジンは**読むだけ**なので、2 台の iPad が同じ枠を同時に確定する窓を塞げない。
一次排他は `reservation_slot_locks`（`design/03-data-model.md` §7.6）が担う。刻み（`slot_minutes`）単位に
展開した占有行を、予約の確定・変更・取消と**必ず同じ `db.batch()`** で INSERT / DELETE する。

**一意 index では表現できない。** 一意 index が表せる上限は「1」だけだが、実際の上限は
担当 `staff.max_parallel_reservations`（1〜5）／設備 `equipment.capacity`（1〜10）／担当未定のレーン
`store_slot_rules.max_parallel`（既定 3）とレーンごとに違う。一意にすると、
**銀座店の 11:00 台にウォークインが 2 人続けて来ただけで 2 人目の「受付して台帳に載せる」が 409 で落ちる**
（目の前のお客様を受け付けられない画面ができる）。編集できるのに効かない設定も 3 つできる。

上限つきの条件付き INSERT を 1 文で書く（D1 で動くことを実測済み）:

```sql
INSERT INTO reservation_slot_locks (id, organization_id, store_id, reservation_id, kind, target_key, slot_start, created_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
WHERE (SELECT COUNT(*) FROM reservation_slot_locks
       WHERE organization_id = ?2 AND store_id = ?3 AND kind = ?5
         AND target_key = ?6 AND slot_start = ?7) < ?9
```

- `?9` にそのレーンの上限を入れる。`target_key` は `staff.id` / `equipment.id` / `'unassigned'` の固定値。
- 発火したかどうかは `meta.changes`（1 / 0）で読む。**0 なら 409 `slot_taken`** を返す。
- index は一意にせず `(organization_id, store_id, kind, target_key, slot_start)` の複合 index にする。
- **同じ batch の後続の文はすべて `WHERE EXISTS (SELECT 1 FROM reservation_slot_locks WHERE reservation_id = ?4)` でガードする。**
  `db.batch()` は 1 トランザクションだが、**0 行の INSERT / UPDATE は「失敗」ではないのでバッチを中断しない**（実測）。
  ガードしないと「予約は書けたのに枠が押さえられていない」状態が commit される。
- 一意制約に本当に弾かれる経路（予約番号・整理番号・冪等キー）は例外でバッチごと巻き戻るが、
  D1 は構造化されたエラーコードを返さない（`Object.keys(err)` が空）。判別できるのは
  `message` の中の `<table>.<column>` と `SQLITE_CONSTRAINT_UNIQUE` / `_PRIMARYKEY` だけなので、
  **表名を取り出すヘルパを `src/worker/db/constraint.ts` に 1 つだけ置き、そこにだけメッセージ形式への依存を閉じ込める**
  （unit テストを必須にする。D1 の文言が変われば 409 `slot_taken` が 500 に化ける）。
  予約番号・整理番号の衝突は +1 して 5 回まで再試行し、そのときは冪等レコードの `in_progress` を消さない。

### 採番の決まり

| 番号 | 書式 | 単位 | あふれたとき |
|---|---|---|---|
| 予約番号 `reservations.code` | `EY-YYMM-NNNN` | **組織 × `YYMM`**（`starts_at` の JST 年下2桁＋月2桁）の連番。作成時の 1 回だけ採番し、`starts_at` を変えても振り直さない | 9999 に達したら 5 桁へ桁上げして `EY-YYMM-NNNNN` にする。5 回再試行しても取れなければ 500 ではなく `code_exhausted` を返して人を呼ぶ |
| Web 予約番号 `web_bookings.public_code` | `EY-W-YYMM-NNNN` | 同上。**店内予約とは別系統**（モックが同月に `EY-W-2608-0031` と `EY-2608-0142` を同時に出しており、同じ連番では共存しない） | 同上 |
| ウォークイン番号 `walk_ins.ticket_no` | 3 桁ゼロ埋め | **店舗 × JST 日付**ごとに `001` から。日が変わると 001 に戻る | 999 に達したら 4 桁へ桁上げする |
| お客様番号 `customers.customer_number` | `G-NNNNN` | 組織内の 5 桁連番 | 統合で失った番号は再利用しない。99999 に達したら 6 桁へ桁上げする |
| 録音番号 `recordings.code` | `EY-R-NNNN` | 組織内の 4 桁連番 | 9999 に達したら 5 桁へ桁上げする |


他サービスのデータが必要な場合は **アプリ層で同期**する（下の「cross-D1 同期」）。cross-D1 JOIN は行わない。

## API 面（Hono RPC + Zod）

ルートは 1 本にチェーンして `export type AppType = typeof routes` を出す。`zValidator` はルート内インライン。
同一オリジンなので CORS は書かない。レスポンスは契約でシリアライズする（`c.json(X.array().parse(rows))`）。

| 面 | 認証 | 概要 |
|---|---|---|
| `GET /api/health` | なし | ヘルス。`{ status: 'ok' }` |
| `POST /api/auth/token` | なし（`AUTH_DEV_GRANT === 'true'` のときだけ開く） | dev トークングラント。それ以外は **404 `not_found`** を返す（本番は未設定 = 無効） |
| `/api/staff/**` | JWT + 有効 org（default-deny） | 業務 API。全クエリを JWT の `org` と選択中 `store_id` でスコープ |
| `/api/public/**` | なし（`storeSlug` からサーバ側で店舗を解決） | お客様向け Web 予約。`web_booking_settings.is_published = '1'` の店舗のみ |
| `/api/internal/**` | `x-internal-key`（= `INTERNAL_KEY`） | admin からの組織同期・定期処理。テナント JWT では越えられない |

`/api/staff/**` の主なリソース: `stores` / `staff` / `equipment` / `purposes` / `hours` / `calendar` /
`availability` / `reservations` / `walkins` / `visits` / `customers` / `recordings` / `terminals` / `audit` /
`alerts` / `analytics` / `web-booking-settings`。

認証ミドルウェアの層（`packages/shared/src/auth-server.ts` を使う。自前で JWT を検証し直さない）:

| 段 | 役割 | 失敗時 |
|---|---|---|
| default-deny gate | `app.use('/api/*', except(['/api/health','/api/auth/*','/api/internal/*','/api/public/*'], ...))` | ルートを足しただけで保護される |
| `tenantAuth()` | admin が HS256 で発行した access JWT を `JWT_SECRET` で検証し `c.var.auth`（`sub`/`org`/`email`/`role`）を確立 | 無 / 不正 / 期限切れ = **401 `unauthorized`** |
| `requireActiveOrg(orgResolver)` | 同期コピーの `organizations` 行を毎リクエスト解決。`plan` はここで載せる | 行なし = **503 `not_synced`**（リトライ可）、`is_disabled='1'` = **403 `org_disabled`** |
| `requireRole(role)` | JWT の `role` を検査 | **403 `forbidden`** |
| `internalAuth()` | `/api/internal/*` の `x-internal-key` を定数時間比較 | 不一致・欠落・**secret 未設定**のいずれも **401 `unauthorized`**（fail close） |

`app.onError` は `HTTPException` を透過し、予期しない throw は `console.error` + `{ error: 'internal_error' }` + 500。
401（未認証・期限切れ）と 403（権限不足）を取り違えない。クライアントの再ログイン判定がこの区別に依存する。

**店舗スコープの権限**: JWT の `role` は組織全体の粗い区分でしかない。「この人がこの店舗で何をしてよいか」は
admin から届く `store_memberships.permissions`（語彙は `packages/contracts/src/glasses_management.ts` の
`StorePermission`。`store.read` / `store.manage` / `reservation.read` / `reservation.write` / `customer.read` /
`customer.write` / `customer.history` / `attention.read` / `attention.write` / `attention.publish` /
`attention.revise` / `attention.hide` / `settings.read` / `settings.manage` / `recording.read` /
`recording.manage` / `audit.read` / `terminal.manage` / `analytics.read`）で決まる。許可リストであり、
知らない値は落とす（fail close）。権限が無い操作は **403 `forbidden`**（401 ではない）。

契約は `packages/contracts/src/glasses_management.ts`（Zod 単一ソース）。`packages/contracts/src/index.ts` から
re-export し、Worker は `zValidator`、SPA は `hc<AppType>('/')`（`AppType` は type-only import）で同じ定義を使う。

## cross-D1 同期

admin が源泉、本サービスは受け側。cross-D1 JOIN は使わない。

| 項目 | 値 |
|---|---|
| 方向 | admin → glasses_management（push のみ。本サービスから admin を pull しない） |
| binding | admin 側の `GLASSES_MANAGEMENT`（`services/admin/wrangler.jsonc`） |
| 受け口 | `POST /api/internal/organizations/sync`。決定ブリーフ §1 の `POST /api/internal/organizations` は表記の誤りで、**`/sync` を正とする**（admin の `services/admin/src/worker/sync.ts` の `ORGANIZATION_SYNC_URL` も P0 実装も `/sync` である） |
| 受け口（店舗担当） | `POST /api/internal/store-memberships/sync`。payload は `{ id, organizationId, storeId, userId, permissions[], createdAt }`。`permissions` が空配列なら担当解除 |
| 照合用の読み取り口 | `GET /api/internal/organizations`（同期済み組織の一覧を `created_at` 昇順で返す）。現時点で admin 側に呼び出し元は無い |
| ヘッダ | `content-type: application/json` / `x-internal-key: <INTERNAL_KEY>`（全サービス同一値） |
| payload | `{ id, name, plan: 'free'\|'contracted', isDisabled: boolean, createdAt: ISO8601, revision: int>=0 }` |
| 応答 | 受理した snapshot を **6 フィールドそのまま**返す。admin 側（`services/admin/src/worker/sync.ts` の `matchesCanonicalSnapshot`）が `id`/`name`/`plan`/`isDisabled`/`createdAt`/`revision` の**全一致**を検査するので、1 つでも欠けても・値が 1 つでも違っても admin 側は失敗扱いにする |
| 呼ばれる契機 | 組織の作成（`revision=1`）/ 更新 / 無効化（`sync_revision = sync_revision + 1`）/ 明示再同期（`POST /api/organizations/:id/sync`。revision は増えない） |

**revision の扱い（順序逆転の防止）**: `organizations.revision` は**整数を入れた `text` 列**なので、比較は必ず
`Number()` に通してから行う（SQL の `<` は文字列比較になり、`'9' > '10'` になる）。P0 実装は「読んでから JS で比較」で
これを満たしている。

| 到着した revision | 挙動 |
|---|---|
| 保存済み revision より大きい | upsert する（`name` / `plan` / `is_disabled` / `revision` を更新。`id` と `created_at` は動かさない） |
| 保存済み revision より小さい | 保存済みの内容を 200 で返す（古い配信で新しい状態へ戻さない）。返す内容が配信内容と違うため、admin 側の全一致検査は失敗し `retryable: true` → 502 になる。これは「admin の revision が遅れている」ことを表面化させる意図した挙動であり、握りつぶさない |
| 保存済み revision と同じ・内容が同じ | 冪等に 200 を返す |
| 保存済み revision と同じ・内容が違う | 到着した内容で upsert して 200 を返す（admin が源泉なので、同 revision の内容差は admin 側が正しいものとして受け入れる）。**P0 実装（`services/glasses_management/src/worker/index.ts`）もこの挙動である** |

**失敗時**: admin は D1 への書き込みを同期の前に済ませており、同期失敗でもロールバックしない。
本サービスが 429 または 5xx を返すと admin 側は `retryable: true` として **502 `organization_sync_failed`** を
呼び出し元へ返す。回復は運営 admin が `POST /api/organizations/:id/sync` を叩く経路のみで、
**admin 側に日次照合 Cron は存在しない**（`services/admin/wrangler.jsonc` に `triggers` なし）。

**通知（notifier）**: 予約確定と確認番号発行のメールは `c.env.NOTIFIER.fetch('http://notifier/api/internal/send', ...)`
（`docs/howto/notifications.md` の書式）を `x-internal-key` 付きで同期呼び出しする。`NotificationJob.type` は
`reservation.confirmed` / `reservation.management_code_issued` / `reservation.management_code_reissued` の 3 種のみ。
呼び出しは try/catch で包み、**送信失敗が予約を巻き戻すことは無い**（best-effort）。
`sent` / `duplicate` は成功。`409 idempotency_in_progress` だけは**同じ `organizationId` + `id` でそのまま再試行**し、
それ以外の失敗（`409 idempotency_conflict` / `502` / 例外）は `alerts` に行を積んで画面から再送できるようにする。
`id` は `organizationId` + 通知種別 + 予約 id から決まる固定値にする（再試行のたびに新しい id を作らない）。

| 応答 | 意味 | 本サービスの扱い |
|---|---|---|
| `200 { status: 'sent' }` | 送信した | 成功 |
| `200 { status: 'duplicate' }` | 同じ冪等キーで送信済み | 成功 |
| `409 idempotency_conflict` | 同じ `id` で payload が違う | 失敗。`id` の作り方の不具合として `alerts` に積む |
| `409 idempotency_in_progress` | Resend が同一キーを処理中 | 失敗。同じ `organizationId` + `id` で再試行する |
| `502 send_failed` | notifier 側の設定不足 / upstream 失敗 | 失敗。`alerts` に積み、画面から再送 |

## 非機能・横断

**テナントスコープ**

- 全 D1 クエリを JWT の `org`（`organization_id`）でスコープする。body / query / path 由来の organization ID を認可根拠にしない。
- 業務 API はさらに選択中 `store_id` でスコープする。店舗をまたぐ読み書きを 1 リクエストで行わない。
- `/api/public/**` は `storeSlug` から店舗と組織をサーバ側で解決する。クライアントが送った組織 ID を信用しない。
- 3 テナント以上を同時に動かす `test/tenant-isolation.test.ts` を必ず 1 本置き、偽装入力（body に `organizationId` を混ぜる）が効かないことを固定する。

**冪等**

- 書き込み API は `idempotency_records`（`key` PK / `request_hash` / `response_json` / `expires_at`）で保護する。同じ key + 同じ `request_hash` は保存済み応答をそのまま返し、同じ key + 違う `request_hash` は **409** を返す。`expires_at` は作成から **24 時間**（notifier の冪等 TTL に合わせる）。
- `key` は `<organization_id>:<scope>:<クライアントが送る Idempotency-Key ヘッダ>` で組み立てる。`scope` は API ごとの固定文字列（例 `reservations.create`）で、`idempotency_records.scope` 列にも入れる。ヘッダの無い書き込みは **400** で断る（採番の重複は後から直せないため）。
- **D1 と KV の使い分け**（迷ったら D1 側に置く）:

| 置くもの | 置き場所 | 理由 |
|---|---|---|
| 書き込み API の冪等レコード（保存済み応答の再生） | D1 `idempotency_records` | 正本。件数が予約件数に比例するので KV の 1,000 write/日 に載せられない |
| 受付中の下書き・端末の短命状態 | KV `SHORT_LIVED`（TTL 必須） | 消えても業務が壊れない情報だけ。1 イベント 1 write に抑える |

- KV の無料枠は **1,000 write/日**。イベント時のみ書き、時間バケットキー + TTL で 1 イベント 1 write に抑える。予約 1 件ごとに KV へ書かない。
- 原子性が要る複数書き込みは `db.batch([...])` を使う（トランザクションは無い）。`drizzle(c.env.DB)` はハンドラ内で生成する。

**版競合（楽観ロック）**

- `version` を持つのは `reservations` / `customers` / `visit_purposes` / `store_slot_rules` / `web_booking_settings`。
- 更新リクエストは取得時の `version` を必ず送る。DB 側の `version` と一致しなければ **409** を返す。成功時のみ `version` を +1 する。
- **版の条件は `db.batch()` の全文に付け、版を進める文を最後に置く。** 版の条件を先頭の 1 文だけに付けると、
  0 行しか当たらない `UPDATE` はバッチを中断しないので、**後続の DELETE / INSERT だけが commit される**
  （409 を返しながら相手の内容を黙って壊し、枠のロックだけを消して二重予約を作る）。
  各文を `WHERE EXISTS (SELECT 1 FROM <親表> WHERE id = ?1 AND version = ?2)` でガードし、
  `version` を +1 する `UPDATE` を batch の最後に置いて、その `meta.changes === 0` で 409 を判定する。
  設定 7 画面の `store_settings_revision` も同じ形にする。
- テストは「409 が返ること」で止めず、**「版が合わないときに 1 行も書き換わっていないこと」**を必ず確かめる。
- 409 のときサーバは値を書き換えない。応答は保存済みの内容と要求された内容の両方を返し、画面（EX-CONFLICT「同じご予約を、ほかの端末でも直していました」）が左右に並べて「中村 彩 の内容を残す」「あなたの内容で上書きする」「1項目ずつ選ぶ」を選ばせる。選ぶまでどちらの内容も書き換えない。

**録音の保持**

| 対象 | 最低保持 | 起点 |
|---|---|---|
| 予約が成立した受付（`reception_sessions.outcome='booked'`） | **30 日** | 録音完了（`recordings.state='stored'` になった時刻） |
| 予約が成立しなかった受付（`outcome='discarded'`） | **24 時間** | 録音終了 |

- `recordings.retain_until` に上の期限を入れる。`retain_until` 到達前の削除要求は拒否する。`legal_hold='1'` の行は期限到達後も削除しない。
- R2 バケットは非公開。ダウンロード URL・署名付き URL・公開バケットのいずれも作らない。再生は Worker 経由で認可を通した上で配信する。
- アップロード失敗（`state='failed'`）は `upload_attempts` を増やして `alerts` に行を積む。再送は自動（EX-UPLOAD-FAILED は 11:15 の失敗に対し「11:20 に自動でもう一度送ります。操作は要りません。」と出す）と手動（「もう一度送る」）の 2 経路。**録音の失敗が予約の成立を妨げることは無い**（同画面は「ご予約は確定しています」を先に言い切る）。

**時刻（JST）**

- 現在時刻は必ず引数で注入する（`now: Date` / `deps.now`）。ドメイン関数の中で `Date.now()` を読まない。テストも実時刻に依存させない。
- JST の日付境界は **UTC 15:00**。日跨ぎ・月跨ぎ・年跨ぎ・うるう年（2/29）を `*.time.test.ts` に必ず書く。境界は「ちょうど」と「±1 秒」の両方を書く。
- Cron を置く場合の指定は **UTC**。JST での意図はコメントに残す。Cron トリガーはアカウント全体で **5 本**が上限。追加する前に実際の `wrangler.jsonc` を数える — **本リポジトリで `triggers.crons` を宣言している Worker は現時点で 0 本**である（admin / notifier / example_service / glasses_management のいずれにも無く、`services/ops` は実体が無い）。`AGENTS.md` と `docs/howto/deploy.md` の「ops×2 + admin×1 = 3 消費」は現状と合っていない。本サービスが 1 本目を使う。**`services/glasses_management/wrangler.jsonc` にはまだ `triggers.crons` も `export default { scheduled }` も無い**ので、日次処理を最初に必要とするフェーズの TASKS で「`triggers.crons` を足し、`scheduled` ハンドラを内部ディスパッチにする」を立てる。

**無料枠のみ（Workers Paid を必要とする機能を設計に含めない）**

| 制約 | 上限 | 設計上の対処 |
|---|---|---|
| Workers CPU | 10ms/リクエスト | 空き枠計算は 1 日分に区切る。端末 PIN も `packages/shared/src/password.ts` と同じくクライアント側でストレッチし、サーバは HMAC 1 回だけにする（サーバ側 PBKDF2 600k は入らない） |
| D1 容量 | 500MB/DB | 全テナント総和で効く。`audit_events` / `visit_events` / `analytics_daily` の増え方を見積もる。400MB（80%）で警告する監視は `services/ops` の担当だが、その Worker は本リポジトリに無い（末尾の不明点） |
| サブリクエスト | Cloudflare サービス宛 1,000 / 外部 50 | N+1 を書かない。集計は SQL 側で行う |
| KV 書き込み | 1,000 write/日 | 冪等キーと短命状態のみ。TTL バケット |
| Queues | 使わない | 採用は人間承認事項。通知は notifier への同期送信 + KV 冪等（TTL 24h）+ UI からの再送で代替する |
| D1 Time Travel | 7 日 | 復旧の主砦にしない。R2 世代バックアップは `services/ops` の担当だが、その Worker は本リポジトリに無いため、**現時点の本サービスの復旧手段は Time Travel の 7 日だけ**である（末尾の不明点） |

DLQ・リトライキューは存在しない前提で設計する。失敗の実害は ①UI フォールバック（`alerts` からの再送）
②次回実行での再検知 の 2 つで塞ぐ。

**HIG とアクセシビリティ**

| 項目 | 値 |
|---|---|
| 業務画面 | iPad 11 インチ 横向き 1194×834pt。ただしブラウザで開くので、本文に使える**高さ**は 834pt より小さい（横向き Safari のタブバー＋ツールバーで概ね 40〜90pt 減る）。配り方は末尾の不明点 |
| Web 予約 | iPhone 390×844pt |
| 触れる大きさ | **当たり判定**が 44pt 以上。テンキーは 72pt。承認済みモックには見た目の高さが 44pt に満たない操作がある（`.segmented` 38px / `.step` 36px / `.toggle` 31px / `.datepill .today` 28px）。見た目を変えずに `padding` で当たり判定だけを 44pt へ広げる（内訳は `design/07-nfr.md` §2.1） |
| 書体 | iPadOS 既定（`--font-sans` の先頭は `-apple-system` / `"SF Pro JP"` / `"Hiragino Sans"`）。時刻・ID・数値は `--font-mono`。**Web フォントは配らない**（決定ブリーフ §12.2。`@fontsource/*` の import と依存は `packages/ui` から外してある） |
| 色 | `packages/ui/src/theme.css` のセマンティックトークン経由のみ。Tailwind デフォルトパレット（`bg-blue-500`）と任意値（`p-[13px]` / `text-[#hex]`）を書かない |
| コントラスト | ヘッダーの緑 `#17705a` と白文字が WCAG AA を満たす。この関係を崩す色変更をしない |
| フォーカスの見え方 | 白・下地・薄い緑の面は `--color-focus`（`#0a63c4`）。**緑地（アプリバー・`--color-pine` 塗りの主操作）の上に載る操作は `--color-focus-on-pine`（`#ffffff`）**を使う（青い輪は緑の上で 1.03:1 になって消える。決定ブリーフ §12.1）。`outline: none` を書かない |
| 状態の示し方 | 色だけに意味を持たせず、必ず文字を添える（「Web予約」「ウォークイン」「取消」） |
| 出どころの色分け | 電話・店頭 = `pine` / Web 予約 = `web` / ウォークイン = `walkin` / 取消・警告 = `danger` |

**テスト**

| 層 | 置き場所 | 下限 |
|---|---|---|
| 契約 | `packages/contracts/test/*.contract.test.ts` | — |
| Worker unit / integration | `services/glasses_management/test/*.test.ts` | lines / statements / functions / branches 各 **80%** |
| React web unit | `services/glasses_management/src/web/**/*.test.{ts,tsx}`（`vitest.web.config.ts`。jsdom） | 同 4 指標 各 **60%** |
| E2E | `services/glasses_management/e2e/*.spec.ts` | Approved な UC/AC に `// @e2e-covers <ID>` がちょうど 1 本ずつ |

`test/permissions.test.ts`（未認証 / staff / テナント admin / 運営 admin / 期限切れ / 別 secret 署名 × 全エンドポイント +
未知パス）、`test/tenant-isolation.test.ts`、`test/*.time.test.ts` を必ず置く。新ルートを足したら権限表に 1 行足す。

## features

フェーズ = feature spec = git ブランチ。各 spec は `- ステータス: Draft` で作り、そのフェーズの E2E が緑になった
時点で `Approved` に上げる（validator は Approved の UC/AC に E2E が 1 対 1 で存在することを要求するため）。

| # | spec | 内容 | UC/AC タグ |
|---|---|---|---|
| — | `features/002-eye-reservation-product/spec.md` | 旧 spec。**削除のままにする**（本文は git 履歴に残る）。traceability は既に admin 側へ移設済みで、UC-EYE-149 / UC-EYE-151 は `specs/admin/features/003-user-administration/spec.md` の UC-ADMIN-USERS-01 / UC-ADMIN-USERS-02 として Approved になっている | かつて `UC-EYE-*` / `AC-EYE-*`（現在は admin 側の `UC-ADMIN-USERS-*`） |
| P0 | [`003-service-foundation`](./features/003-service-foundation/spec.md) | 雛形・契約の骨・組織同期・認証・テナント分離・デザイントークン | `UC-FOUND-NN` / `AC-FOUND-NN` |
| P1 | [`004-store-settings`](./features/004-store-settings/spec.md) | 店舗・営業時間・カレンダー・スタッフ・技能・設備・来店目的（設定 7 画面） | `UC-SET-NN` / `AC-SET-NN` |
| P2 | [`005-availability-and-ledger`](./features/005-availability-and-ledger/spec.md) | 空き枠エンジン・予約台帳（担当軸 / 設備軸 / リスト / 詳細） | `UC-LEDGER-NN` / `AC-LEDGER-NN` |
| P3 | [`006-booking-flow`](./features/006-booking-flow/spec.md) | 電話・店頭予約の 5 工程・重なり警告・ドラッグ移動 | `UC-BOOK-NN` / `AC-BOOK-NN` |
| P4 | [`007-customer-records`](./features/007-customer-records/spec.md) | 顧客検索・電話番号推定・詳細・新規・統合・手書き | `UC-CUST-NN` / `AC-CUST-NN` |
| P5 | [`008-reception-and-walkin`](./features/008-reception-and-walkin/spec.md) | 来店受付・ウォークイン・来店進捗・受付履歴 | `UC-RECEP-NN` / `AC-RECEP-NN` |
| P6 | [`009-change-and-cancel`](./features/009-change-and-cancel/spec.md) | 予約検索・変更・取消・差分確認 | `UC-CHANGE-NN` / `AC-CHANGE-NN` |
| P7 | [`010-recording`](./features/010-recording/spec.md) | 受付録音・R2・保持期限・失敗と再送・アラート | `UC-REC-NN` / `AC-REC-NN` |
| P8 | [`011-web-booking`](./features/011-web-booking/spec.md) | お客様向け Web 予約・公開設定・通知・確認番号 | `UC-WEB-NN` / `AC-WEB-NN` |
| P9 | [`012-analytics`](./features/012-analytics/spec.md) | 分析 5 画面・指標定義・小標本抑制 | `UC-ANA-NN` / `AC-ANA-NN` |
| P10 | [`013-terminals-and-audit`](./features/013-terminals-and-audit/spec.md) | 共有端末・個人モード昇格・PIN・監査 | `UC-TERM-NN` / `AC-TERM-NN` |

設計文書は `design/01-requirements.md` 〜 `design/08-traceability.md`。UC/AC の**定義**は `spec.md` にだけ置き、
`design/**` からは参照するだけにする（validator が読むのはファイル名が厳密に `spec.md` のものだけだが、
`design/**` に `- UC-XXX-01: ...` という bullet を書くと将来の誤検出の種になる）。

## 既知の制約（本番前に必須）

**secrets（`wrangler secret put`。コード / `wrangler.jsonc` の `vars` / Terraform state に置かない）**

| secret | 値をそろえる相手 | 未設定時 |
|---|---|---|
| `INTERNAL_KEY` | admin の `INTERNAL_KEY` / notifier の `INTERNAL_KEY` と**同値** | `/api/internal/*` が全拒否（fail close）。admin からの組織同期が 502 になる |
| `JWT_SECRET` | admin の `JWT_SECRET` と**同値**（`aud` / `iss` クレームは無いので、同じ secret を持つ全サービスで 1 つの access token が有効） | 全業務 API が 401 |
| `AUTH_DEV_GRANT` | — | **本番には設定しない**。未設定 = `POST /api/auth/token` は無効 |

dev 値は `services/glasses_management/.dev.vars`（gitignore 対象）にだけ置く。

**Terraform で作った ID を `wrangler.jsonc` に反映する**

Worker のコードと binding は Wrangler 所有、stateful な substrate は Terraform 所有（1 リソース 1 オーナー）。
`infra/terraform/cloudflare/outputs.tf` の 3 output を手で `services/glasses_management/wrangler.jsonc` に写す。

| output | 反映先 |
|---|---|
| `glasses_management_d1_database_id` | `d1_databases[0].database_id`（binding `DB`） |
| `glasses_management_short_lived_kv_namespace_id` | `kv_namespaces[0].id`（binding `SHORT_LIVED`） |
| `glasses_management_recordings_bucket_name` | `r2_buckets[0].bucket_name`（binding `RECORDINGS`） |

`infra/terraform/cloudflare/main.tf` の 3 リソース（`cloudflare_d1_database.glasses_management` /
`cloudflare_workers_kv_namespace.glasses_management_short_lived` / `cloudflare_r2_bucket.glasses_management_recordings`）は
実リソースが state にある。**消すと `terraform apply` で D1 / KV / R2 が破棄される。**

**admin 側 binding とデプロイ順**

- `services/admin/wrangler.jsonc` の `services[]` に `GLASSES_MANAGEMENT` → Worker `glasses-management` がある。**この Worker が存在しない状態で admin をデプロイすると失敗する。**
- デプロイ順は `notifier` → `glasses_management`（migrate → deploy）→ `admin`（`docs/howto/deploy.md`）。同文書は末尾に `ops` を足しているが、その Worker は本リポジトリに無く、CI の `deploy-eye-stack` job も notifier / glasses_management / admin の 3 本しか実行しない。
- admin は service binding を `https://glasses-management.internal/api/internal/...` という固定ホスト名で叩く。dev の Vite サーバはこのホスト名を明示的に許可しないと拒否するため、`services/glasses_management/vite.config.ts` に `server: { port: 5175, allowedHosts: ['glasses-management.internal'] }` が要る。**現状は `server: { port: 5175 }` だけで `allowedHosts` が無い**（実測: `Host: glasses-management.internal` を付けた `POST /api/internal/organizations/sync` が 403 `Blocked request.` で落ちる）。組織も担当店舗も届かないと業務 API は `requireActiveOrg` が 503 `not_synced` を返すので、**この 1 行が無いと P1 以降の E2E が 1 本も緑にならない**。`features/003-service-foundation` の TASKS で塞ぐ。admin 側は `services/admin/vite.config.ts` が `allowedHosts: ['admin.internal']` を宣言済み。
- admin のテストは `services/admin/vitest.config.ts` の `miniflare.serviceBindings.GLASSES_MANAGEMENT` echo スタブ（送った body をそのまま 200 で返す）に依存している。**このスタブを消すと admin の 4 テストファイルが落ちる**ので残す。

**再構築で復旧済みの参照（壊さないこと）**

再構築の過程で一度落ちた参照は 4 つとも戻っている。フェーズを進めるときに再び落とさない。

| ファイル | 入っているもの | 落ちたときの症状 |
|---|---|---|
| `package.json` の `test` | `pnpm --filter @app/glasses_management test:all &&` を admin / example_service の後に置く | pnpm は no-match でも exit 0 を返すので**無言で素通り**する。テスト件数で実行を確かめる |
| `Makefile` | `dev/glasses_management`（:5175）/ `dev/all` の併走行 / `.PHONY` | `make dev/glasses_management` が無いターゲットで落ちる |
| `.github/workflows/ci.yml` | e2e matrix の `glasses_management` 行 / `deploy-eye-stack` の migrate + deploy ステップ | e2e が手動実行の対象から外れ、デプロイ順が admin より先にならない |
| `knip.jsonc` | `services/glasses_management` の workspace 定義 | `pnpm run deps:check` が未使用依存を誤検出する |

**不明点**

発注元（EYE）への確認事項の**正本は `design/09-open-questions.md`（全 12 件）**である。件数と暫定案はそちらだけで数え、
本書に別の一覧を持たない。**暫定案のもとで実装を進めてよい**（答え待ちを理由に着手を止めない）。
本書に直接効くのは次の 3 件で、いずれも 09 の「いまの前提（暫定）」がそのまま本書の記述の根拠になっている。

- `[要確認: Q-07 — いまの前提で進める]` スタッフのログインと暗証番号の再確認を admin に任せるか。
  いまの前提は「任せる」。admin 側に実在する `/api/internal/domain-auth/login` `/refresh` `/pin/verify` を
  service binding 経由で呼び、`ADMIN` binding と `AUTH_PEPPER` を決定ブリーフ §1 に足す
  （`POST /api/auth/token` は dev 専用で、`AUTH_DEV_GRANT !== 'true'` なら 404 である）。
- `[要確認: Q-05 — いまの前提で進める]` 業務用の iPad にこの画面をどう入れるか。
  いまの前提は「①ホーム画面に追加した Web アプリとして配る」。`manifest.json` と
  `apple-mobile-web-app-capable` を足し、EX-MIC-DENIED の 3 手順の文言をそのまま使う
  （②では iPadOS の「設定」に項目が無く 3 手順が成り立たない。画面の有効高・台帳に入る枠数もこれに従属する）。
- `[要確認: Q-08 — いまの前提で進める]` 本サービスの D1 バックアップと容量監視を誰が持つか。
  いまの前提は「当面 D1 Time Travel の 7 日で受け、`glasses-management` に割り当てた Cron 1 枠の中で
  D1 のサイズを測り 400MB を超えたらお知らせに上げるところまでを持つ。R2 への世代バックアップは持たない」。
