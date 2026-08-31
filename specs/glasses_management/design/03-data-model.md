# glasses_management — データモデル（D1 / Drizzle）

- サービス: `services/glasses_management` (`@app/glasses_management`)
- 所有 D1: `glasses_management`（binding `DB` / `migrations_dir: migrations`）
- スキーマの実体: `services/glasses_management/src/worker/db/schema.ts`
- 対応する UI の正本: `docs/frontend/mockups/eyex/`（68画面）

この文書はテーブルの**全カラム**を確定させる。決定ブリーフ §3 の「主なカラム」を展開したもので、
ブリーフが挙げた列は 1 つも削っていない。ブリーフに無くモックが要求する列には **＋** を付ける。

---

## 1. 全体規約（全テーブルに例外なく適用する）

| # | 規約 | 具体 |
|---|---|---|
| 1 | **FK を宣言しない** | `references()` を書かない。参照整合はアプリ層で確かめる（各表の「不変条件」に書く） |
| 2 | **ID はアプリ生成** | `crypto.randomUUID()`（v4）。`AUTOINCREMENT` / `rowid` に依存しない。例外は `organizations.id`（admin 由来）と `idempotency_records.key` |
| 3 | **全ドメイン行に `organization_id`** | 全クエリを JWT の `org` でスコープ。body / query / path 由来の organization ID を認可根拠にしない |
| 4 | **真偽値は `text` の `'0'` / `'1'`** | `integer({mode:'boolean'})` を使わない。新規に作る表の真偽値列は **NOT NULL**。NULL 可の真偽値は `organizations.is_disabled` だけ（admin から後付けされる列のため） |
| 5 | **日時は ISO8601 の `text`（UTC・末尾 `Z`・ミリ秒3桁）** | `2026-08-27T02:00:00.000Z`。JST 表示は `packages/shared` の JST ヘルパで変換する。文字列比較で範囲検索が成立するよう桁を必ず揃える |
| 6 | **日付は `YYYY-MM-DD` の `text`（JST の暦日）** | `2026-08-27`。列名は `date` そのもの、または接尾 `_date`（`walk_ins.visit_date` / `customers.birth_date`）。例外として `customer_prescriptions.measured_at` / `customer_glasses.purchased_at` はブリーフ §3 の列名を保ったまま**日付**を入れる |
| 7 | **時刻は `HH:MM` の `text`（JST の壁時計・24時間・ゼロ埋め）** | `09:30` / `19:00`。`9:30` と書かない（文字列比較が壊れる） |
| 8 | **DDL DEFAULT に意味を持たせない** | 時刻・状態・フラグの既定値は必ずアプリ層で入れる。`.default()` を書いてよいのは値にロジックが無いとき（空文字など）だけ |
| 9 | **並びは `created_at`** | UUID v4 は k-sortable ではないので ID 順に頼らない。ブリーフ §3 が `created_at` を挙げていない表にも `created_at`（NOT NULL）を置く |
| 10 | **原子性は `db.batch()`** | トランザクションは無い。複数文が同時に成立しなければならない箇所（予約の確定・変更・取消、顧客の統合、度数の切り替え）は 1 つの batch にまとめる |
| 11 | **cross-D1 JOIN 禁止** | admin の organizations / users は service binding で同期した `organizations` 表と `staff.admin_user_id` 経由でのみ触る |
| 12 | **命名** | SQL 側は snake_case（`organization_id`）、TS 側は camelCase（`organizationId`）。index 名は一意・非一意を問わず `<table>_<cols>_idx`（一意であることは名前ではなく `uniqueIndex()` で表す） |
| 13 | **接続を持ち回らない** | `drizzle(c.env.DB)` をハンドラ内で毎回生成する |
| 14 | **楽観ロック** | ブリーフ §3 が `version` を挙げた 5 表（`reservations` / `customers` / `visit_purposes` / `store_slot_rules` / `web_booking_settings`）に `version`（integer）を置く。更新は `WHERE id=? AND version=?` で行い、0 行なら 409 を返す。**それ以外の設定系の表（`stores` / `staff` / `staff_skills` / `staff_weekly_shifts` / `staff_shifts` / `equipment` / `equipment_maintenance` / `store_business_hours` / `store_blackout_windows` / `store_calendar_exceptions`）は個別に `version` を持たない。設定 7 画面の保存はすべて `store_settings_revision`（店舗単位の 1 版。§4.6）で衝突を見る。**1 画面の保存を 7 本の版比較に割らないための決めであり、2 台の iPad で同じ設定面を開いても、後から保存したほうが相手の変更を黙って巻き戻すことはない。EX-CONFLICT（同じ予約を 2 人が直した）は `reservations` だけの話であり、設定画面には出さない。**版の条件は `db.batch()` の全文に配り、版を +1 する文を必ずバッチの最後に置く**（0 行の `UPDATE` はバッチを止めないため。§4.6 / §7.1） |
| 15 | **論理削除** | 行を物理削除するのは `idempotency_records` と `terminal_sessions` の期限切れだけ。それ以外は `is_active='0'` / `merged_into_id` / `state='deleted'` で落とす |

### 1.1 接尾 `_at` の読み分け（必ず先に読む）

ブリーフ §3 が決めた列名をそのまま使うため、**`_at` で終わる列が 3 種類の値を持つ**。名前からは判別できないので下表を正とする。

| 値の形 | 該当する列（これ以外の `_at` はすべて ISO8601） |
|---|---|
| **`HH:MM`（JST の壁時計）** | `store_business_hours.opens_at` / `closes_at` / `break_start` / `break_end`、`store_calendar_exceptions.opens_at` / `closes_at`、`staff_shifts.starts_at` / `ends_at`、`web_booking_settings.opens_at` / `closes_at` |
| **`YYYY-MM-DD`（JST の暦日）** | `customer_prescriptions.measured_at`、`customer_glasses.purchased_at` |
| **ISO8601（UTC）** | 上記以外のすべて（`reservations.starts_at` / `ends_at`、`reservation_assignments.starts_at` / `ends_at`、`equipment_maintenance.starts_at` / `ends_at`、`created_at` / `updated_at` / `occurred_at` / `arrived_at` ほか） |

とくに `starts_at` / `ends_at` は、`staff_shifts` では `HH:MM`、`reservations` / `reservation_assignments` /
`equipment_maintenance` では ISO8601 である。Zod 契約側で別スキーマ（`Hhmm` / `IsoDateTime`）に分けて型でも区別する。

### 1.2 列の型の使い分け

| 用途 | SQLite 型 | Drizzle | 例 |
|---|---|---|---|
| ID・文字列・日時・日付・時刻・真偽値・JSON | `text` | `text()` | `id` / `starts_at` / `is_active` / `before_json` |
| 件数・分・秒・バイト・連番・リビジョン | `integer` | `integer()` | `duration_minutes` / `version` / `bytes` |
| 度数・PD・率・中央値 | `real` | `real()` | `r_sph` / `pd` / `value` |

`integer({mode:'timestamp'})` と `integer({mode:'boolean'})` は使わない（規約 4・5 と衝突するため）。

### 1.3 語彙（enum 相当）の置き場所

すべて `packages/contracts/src/glasses_management.ts` の `z.enum` を単一ソースとし、DB には CHECK 制約を書かない。
未知値は `zValidator` が 400 で弾く。DB 側は素の `text` として持つ。

---

## 2. テーブル一覧（36 表）

| 群 | テーブル | 追加フェーズ |
|---|---|---|
| 同期 | `organizations` / `store_memberships` | **P0**（`0000_talented_korvac.sql` で作成済み） |
| 店舗 | `stores` | **P0**（同上。列の追加と slug の index の張り替えは P1。§12） |
| 店舗 | `store_business_hours` / `store_blackout_windows` / `store_calendar_exceptions` / `store_slot_rules` / `store_settings_revision` | P1 |
| 人と設備 | `staff` / `staff_skills` / `staff_weekly_shifts` / `staff_shifts` / `equipment` / `equipment_maintenance` | P1 |
| 目的 | `visit_purposes` / `purpose_requirements` | P1 |
| 予約 | `reservations` / `reservation_purposes` / `reservation_assignments` / `reservation_slot_locks` | P2 |
| 統制 | `audit_events` / `idempotency_records` | P3 |
| 受付 | `reception_sessions` | P3（予約フローの下書き置き場。§8.1 / §12） |
| 顧客 | `customers` / `customer_prescriptions` / `customer_glasses` / `customer_notes` | P4 |
| 来店 | `walk_ins` / `visit_events` | P5 |
| 録音 | `recordings` | P7 |
| Web予約 | `web_booking_settings` / `web_bookings` | P8 |
| 運用 | `alerts` / `analytics_daily` | P7 / P9 |
| 端末 | `terminals` / `terminal_sessions` | P10 |

---

## 3. 同期・組織

### 3.1 `organizations`

admin が源泉の組織スナップショット。`requireActiveOrg` が毎リクエスト読む。
**行が無い＝未同期で 503 `not_synced`（リトライ可）、`is_disabled='1'`＝403 `org_disabled`。**
トークンが無い・不正・期限切れは、この表を読む前に `tenantAuth()` が 401 で落とす。401 / 403 / 503 を取り違えない。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| 組織ID | `id` | `id` | text (PK) | 不可 | 1〜200文字 | admin の `organizations.id` をそのまま入れる。**この表だけ ID をアプリ生成しない**（admin 側に UUID でない seed 値がある） |
| 組織名 | `name` | `name` | text | 不可 | 1〜200文字 | `EYEX` |
| プラン | `plan` | `plan` | text | 可 | `free` \| `contracted` | NULL は `free` として読む |
| 無効化 | `is_disabled` | `isDisabled` | text | 可 | `0` \| `1` | NULL は `0` として読む。`1` は 403 `org_disabled` |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | admin 側の作成日時をそのまま複製する |
| 同期リビジョン | `revision` | `revision` | text | **可** | 整数を入れた文字列 | admin が単調増加で採番。**列は `text`・NULL 可**（P0 実装がこの形。`00_service-spec.md` と決定ブリーフ §12.4 も同じ）。NULL は 0 として読み、比較は必ず `Number()` に通す |

**index**: 張らない。全アクセスが `WHERE id = ?` の等値 1 件引き。

**不変条件**
- 他の 35 表の `organization_id` は、この表に存在する `id` でなければならない（FK が無いので INSERT 前に存在を確かめる）。
- **revision の比較はアプリ層で行う**（`Number(existing.revision ?? '0') > incoming.revision` なら upsert せず保存済みの行を返す）。
  **`WHERE revision <= ?` という SQL を書かない** — 列が `text` なので文字列比較になり、`'10' < '2'` が真になる。
  revision が 10 に達した瞬間に、以後すべての配信が「古い」と判定されて organizations が二度と更新されなくなる。
- **受信 revision == 保存 revision で内容が違うときは、届いた内容で upsert して 200 を返す**（admin が源泉。P0 実装と
  `00_service-spec.md` がこの挙動）。409 を返さない — admin は 429 と 5xx だけを retryable と扱うので、
  409 は admin 側で non-retryable になり、admin が呼び出し元へ 502 を返して人に見える形で失敗する。
- `plan` を JWT クレームに入れない。毎リクエストこの行から読む。

```sql
SELECT id, name, plan, is_disabled, revision FROM organizations WHERE id = ?1;
```

### 3.2 `store_memberships`

admin が配る「誰がどの店舗で何をできるか」。`POST /api/internal/store-memberships/sync` の保存先で、
`requireStorePermission()` はこの表だけを判定材料にする（決定ブリーフ §12.4 で正式表として確定済み。**追加フェーズは P0** — `0000_talented_korvac.sql` で作成済み）。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | admin 側の id をそのまま入れる |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | `stores.id` | |
| ユーザID | `user_id` | `userId` | text | 不可 | admin の `users.id` | `staff.admin_user_id` と突き合わせる |
| 権限 | `permissions` | `permissions` | text | 不可（既定 `''`） | **空白区切りの文字列** | `StorePermission` の 19 値のうち許可されたもの（`store.read reservation.write`）。**空文字は担当解除の墓標**。JSON 配列にしない（決定ブリーフ §12.4 と P0 実装がこの形） |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | admin 側の作成日時 |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `store_memberships_org_user_store_unique_idx`（一意） | `(organization_id, user_id, store_id)` | 毎リクエストの権限解決（「この利用者はこの店舗で何ができるか」を 1 行で引く）。同じ人に 2 行を作らせない |
| `store_memberships_org_store_idx` | `(organization_id, store_id)` | その店舗の担当者一覧 |

**不変条件**
- 未知の権限語が 1 つでも混じった同期は 400 で拒む（**許可リスト。fail close**）。
- 行が無い＝その店舗の権限を 1 つも持たない。`requireStorePermission()` は 403 `forbidden` を返す。
- 権限セットは upsert（衝突キーは `id`）で丸ごと置き換える（差分を当てない）。
- 読むときは `permissions.split(' ')` で語に割り、空文字は 0 件として扱う。保存するときは重複を除いて 1 個の空白でつなぐ。

---

## 4. 店舗と受付条件

### 4.1 `stores`

選択中店舗の実体。業務 API のスコープ単位であり、Web 予約の公開単位でもある。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| 店舗ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店名（社内） | `name` | `name` | text | 不可 | 1〜60文字 | `EYEX 銀座店` |
| 店名（対客）＋ | `name_public` | `namePublic` | text | 可 | 1〜60文字 | `EYEX 銀座店（銀座4丁目）`。NULL なら `name` を使う。**P1 で足す列**（§12） |
| slug | `slug` | `slug` | text | 不可 | `^[a-z0-9]+(?:-[a-z0-9]+)*$`（2〜40文字） | `ginza` / `marunouchi` / `shinjuku`。`/w/:storeSlug` と `eyex.jp/ginza` の末尾。P0 実装は上限 80 文字なので、P1 で契約側を 40 文字へ狭める |
| 電話番号 | `phone` | `phone` | text | **不可**（既定 `''`） | 表示用の生文字列 | `03-3571-0001`。**空文字＝未入力**（P0 実装が `NOT NULL DEFAULT ''`。表を作り直さない） |
| 住所 | `address` | `address` | text | **不可**（既定 `''`） | 0〜120文字 | `東京都中央区銀座4-5-6 EYEXビル 2階`。空文字＝未入力 |
| 最寄り駅＋ | `nearest_station` | `nearestStation` | text | 可 | 0〜40文字 | `東京メトロ 銀座駅`。**P1 で足す列**（§12） |
| 行き方 | `access_note` | `accessNote` | text | **不可**（既定 `''`） | 0〜60文字 | `A1出口から徒歩3分`。空文字＝未入力 |
| 駐車場＋ | `parking_note` | `parkingNote` | text | 可 | 0〜60文字 | `提携駐車場はありません`。**P1 で足す列** |
| 紹介文＋ | `intro_text` | `introText` | text | 可 | 0〜200文字 | SETTINGS-STORE「お客様に見せる紹介文（78文字／200文字まで）」。**P1 で足す列** |
| 並び順＋ | `sort_order` | `sortOrder` | integer | 可 | 0 以上 | 店舗切り替え・台帳・分析の店舗の並び（`00_service-spec.md` §エンティティ / `05` / `06` / `011` が使う）。**P1 で足す列**。NULL の行は `created_at` 順で後ろに置く |
| 有効 | `is_active` | `isActive` | text | 不可 | `0` \| `1` | `0` は店舗切り替え候補から外し、公開 API では 404 |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | |
| 更新日時＋ | `updated_at` | `updatedAt` | text | **可** | ISO8601 | SETTINGS-STORE「最後に直したのは 2026年8月20日（木）」。**P1 で足す列なので NULL 可**（§12 冒頭の方針）。NULL は `created_at` として読む |
| 更新者＋ | `updated_by` | `updatedBy` | text | 可 | `staff.id` | 同上「山田 大輔（店長）」。**P1 で足す列** |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `stores_org_created_idx` | `(organization_id, created_at)` | ヘッダーの店舗切り替え一覧 |
| `stores_slug_idx`（一意） | `(slug)` | `/api/public/**` は未認証で `organization_id` を持たないため slug 単独で引く。**P0 実装は `stores_org_slug_unique_idx (organization_id, slug)` を張っているので、P1 の `0001_*.sql` で `DROP INDEX` してからこの index を張り直す**（§12） |

**不変条件**
- `slug` は**全組織横断で一意**。公開 API が org 不明のまま解決するため、組織内一意では足りない
  （組織内一意だと `WHERE slug = ?1` が 2 行を返し、公開ページがどちらの組織の店舗か決められない）。
  **代償として slug は組織をまたいで先取り順になる**（別テナントが `ginza` を取っていたら取れない）。
  取れなかった保存は 409 `version_conflict` ではなく 400 で返し、別の slug を促す。
- `is_active='0'` の店舗にぶら下がる予約・スタッフ・設備の行は消さない（過去の台帳・履歴が読めなくなるため）。
- 1 組織の店舗数はモックで 3（銀座・丸の内・新宿）。上限は設けない。

```sql
-- 店舗切り替え
SELECT id, name, slug FROM stores
WHERE organization_id = ?1 AND is_active = '1' ORDER BY created_at;

-- 公開ページ（未認証）
SELECT id, organization_id, name, name_public, intro_text
FROM stores WHERE slug = ?1 AND is_active = '1';
```

### 4.2 `store_business_hours`

曜日ごとの通常営業時間と昼休憩。SETTINGS-HOURS「通常の営業時間」「曜日ごとの上書き」の保存先で、
空き枠エンジンの第 1 入力になる。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 曜日 | `weekday` | `weekday` | integer | 不可 | 0〜6 | **0=日 / 1=月 / 2=火 / 3=水 / 4=木 / 5=金 / 6=土** |
| 定休 | `is_closed` | `isClosed` | text | 不可 | `0` \| `1` | 銀座店は `weekday=2`（火）が `1` |
| 開店 | `opens_at` | `opensAt` | text | 可 | `HH:MM` | 銀座店 `10:00`。金 `11:00` / 日 `10:00` |
| 閉店 | `closes_at` | `closesAt` | text | 可 | `HH:MM` | 銀座店 `19:00`。金 `20:00` / 日 `18:00` |
| 休憩開始 | `break_start` | `breakStart` | text | 可 | `HH:MM` | **常に NULL。**受付を止める帯は `store_blackout_windows`（§4.5）が正本。ブリーフ §3.2 の列名を保つためだけに残す |
| 休憩終了 | `break_end` | `breakEnd` | text | 可 | `HH:MM` | 同上 |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `store_business_hours_org_store_weekday_idx`（一意） | `(organization_id, store_id, weekday)` | 空き枠エンジンが 1 日分を 1 行で引く。重複行を DB 側で禁じる |

**不変条件**
- 1 店舗につき 7 行そろっているのが正常。**行が欠けた曜日は `is_closed='1'` と同じに扱う**（枠を作らない）。
- `is_closed='1'` のとき `opens_at` / `closes_at` はどちらも NULL。
- `is_closed='0'` のとき `opens_at < closes_at`（`HH:MM` の文字列比較で判定できる）。
- **`break_start` / `break_end` には書き込まない（常に NULL）。**受付を止める帯は 1 日に 3 本あるので（§4.5）、
  1 帯しか持てないこの 2 列では表せない。空き枠エンジンもこの 2 列を読まない。
- **曜日ごとの上書き（SETTINGS-HOURS「曜日ごとの上書き」）は 3 種だけを取る。**
  ①定休（`is_closed='1'`）②時間の差し替え（`is_closed='0'` にして通常と違う `opens_at` / `closes_at` を入れる。
  金 11:00–20:00 ／ 日 10:00–18:00）③通常どおり（通常の営業時間と同じ値を入れる）。
  「この曜日だけ受付を止める帯を変える」は取らない（帯は §4.5 が曜日ごとに持つ）。

```sql
SELECT is_closed, opens_at, closes_at
FROM store_business_hours
WHERE organization_id = ?1 AND store_id = ?2 AND weekday = ?3;
```

### 4.3 `store_calendar_exceptions`

臨時休業と特別営業。SETTINGS-CALENDAR で 1 日ずつ切り替える。`store_business_hours` より**優先**する。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 日付 | `date` | `date` | text | 不可 | `YYYY-MM-DD` | `2026-09-30` |
| 種別 | `kind` | `kind` | text | 不可 | `closed` \| `special` | `closed`＝臨時のお休み、`special`＝特別営業 |
| 開店 | `opens_at` | `opensAt` | text | 可 | `HH:MM` | `kind='special'` のときだけ非 NULL |
| 閉店 | `closes_at` | `closesAt` | text | 可 | `HH:MM` | 同上 |
| 理由 | `note` | `note` | text | 可 | 0〜60文字 | `棚卸しのため` |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |
| 作成者＋ | `created_by` | `createdBy` | text | 可 | `staff.id` | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `store_calendar_exceptions_org_store_date_idx`（一意） | `(organization_id, store_id, date)` | 空き枠エンジンの 1 日引き。同じ日に 2 行を作らせない |

**不変条件**
- 同じ店舗・同じ日に 2 行は作らない。上書きは UPDATE。
- `kind='closed'` なら `opens_at` / `closes_at` は NULL。`kind='special'` なら両方非 NULL かつ `opens_at < closes_at`。
- 解決順は「例外 → 曜日」。例外行があれば `store_business_hours` を一切見ない。
- **`kind='special'` を作る UI はモックに無い。**SETTINGS-CALENDAR は「丸をおすと、営業日とお休みが入れ替わります。」の
  2 値トグルだけで、生成されるのは `kind='closed'` の行と、その行の削除である。`special` は列としては持つが、
  P1 では書き込み経路を作らない（空き枠エンジンの読み側だけ実装し、テストは直接 INSERT で作る）。

```sql
-- SETTINGS-CALENDAR は 2 か月ぶんを一度に描く
SELECT date, kind, opens_at, closes_at, note
FROM store_calendar_exceptions
WHERE organization_id = ?1 AND store_id = ?2 AND date >= ?3 AND date <= ?4
ORDER BY date;
```

### 4.4 `store_slot_rules`

予約の刻み・片付け時間・同時受付上限。**1 店舗 1 行**。SETTINGS-HOURS「予約の間隔」の保存先。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 刻み（分） | `slot_minutes` | `slotMinutes` | integer | 不可 | 5〜120 | 「予約をお受けする刻み 30分ごと」。銀座店は 30 |
| 片付け（分） | `cleanup_minutes` | `cleanupMinutes` | integer | 不可 | 0〜60 | 「1件あたりの片付け時間 10分」。予約の**後ろ**に付く |
| 同時受付上限 | `max_parallel` | `maxParallel` | integer | 不可 | 1〜20 | 「同じ時刻に受けられる件数 3件まで」 |
| リビジョン | `version` | `version` | integer | 不可 | 1 以上 | 楽観ロック。保存のたび +1 |
| 更新日時 | `updated_at` | `updatedAt` | text | 不可 | ISO8601 | |
| 更新者＋ | `updated_by` | `updatedBy` | text | 可 | `staff.id` | |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `store_slot_rules_org_store_idx`（一意） | `(organization_id, store_id)` | 空き枠エンジンが毎回 1 行引く。2 行目を DB 側で禁じる |

**不変条件**
- 1 店舗に 1 行。行が無い店舗は「設定未完」として空き枠を 0 件にし、設定画面へ誘導する（暗黙の既定値を作らない）。
- 銀座店の seed は `slot_minutes=30` / `cleanup_minutes=10` / `max_parallel=3`
  （SETTINGS-HOURS「予約の間隔」の 3 行そのまま）。片付けは予約の**後ろ**に付き、`reservations.ends_at` には含めない。
- **SETTINGS-HOURS 末尾の「木曜日に最後にお受けできるのは 18:20 です。」は保存しない。
  空き枠エンジンがその曜日に返す枠のうち、最後の枠の開始時刻をそのまま出す。**
  画面が独自の式で算出しない。式で出すと、30 分の格子に載らない時刻（18:20）を案内して
  「押せる枠が無い時刻」を読ませてしまう。**表示と実際に押せる枠は必ず一致させる。**
  この値は `SlotRulesView.lastAcceptableAt`（`04-api.md` §4.0 (a)）としてサーバが返す。

### 4.5 `store_blackout_windows`

**受付を止める時間帯。曜日ごとに 0 本以上**。SETTINGS-HOURS 右カラム「受付を止める時間帯」の保存先で、
空き枠エンジンは営業時間からこの帯を差し引く。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 曜日 | `weekday` | `weekday` | integer | 不可 | 0〜6 | 0=日 … 6=土（`store_business_hours` と同じ） |
| 開始 | `starts_at` | `startsAt` | text | 不可 | `HH:MM` | `12:00` |
| 終了 | `ends_at` | `endsAt` | text | 不可 | `HH:MM` | `13:00` |
| 名前 | `label` | `label` | text | 不可 | 1〜20文字 | `朝の支度` / `お昼` / `閉店前の片付け` |
| 並び順 | `sort_order` | `sortOrder` | integer | 不可 | 0 以上 | 画面の行順 |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**銀座店の seed（曜日 7 行 × 3 帯）**

| `label` | `starts_at` | `ends_at` |
|---|---|---|
| 朝の支度 | `10:00` | `10:15` |
| お昼 | **`12:00`** | **`13:00`** |
| 閉店前の片付け | `18:40` | `19:00` |

**お昼の帯は 12:00–13:00 とする。SETTINGS-HOURS の「13:00–14:00」（2 か所）はモックの誤記である。**
BOOK-01-DATETIME と WEB-03-DATETIME は 10:00 / 10:30 / 11:00 / 11:30（満席）/ **13:00 / 13:30 / 14:00** / 14:30（満席）の
8 枠を出し、12:00 と 12:30 を 1 枠も出さない。満席の枠は出しているので「埋まっているから消えた」ではない。
さらに LEDGER-STAFF と EX-OFFLINE は 13:00 に実際の予約を 2 件（佐々木 亮 様＝高橋 健、相川 みどり 様＝担当が未定）置いている。
13:00–14:00 を受付停止帯にすると、この 4 面が同時に成り立たない。モック画像は直さず、seed をこの値で入れる。

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `store_blackout_windows_org_store_weekday_idx` | `(organization_id, store_id, weekday, starts_at)` | 空き枠エンジンが 1 日分の帯をまとめて引く |

**不変条件**
- `starts_at < ends_at`。同じ曜日の帯どうしは重ならない。
- 帯は営業時間の内側にある（`opens_at <= starts_at` かつ `ends_at <= closes_at`）。外にはみ出す帯は保存を拒む
  （「営業時間の外にある帯は保存できません。時間を直してください。」）。
- 帯が 0 本の曜日があってよい（「＋ 止める時間帯を足す」で増やし、行の削除で減らす）。
- **`store_business_hours.break_start` / `break_end` は使わない。**受付を止める帯の正本はこの表だけである。
- 台帳（LEDGER-STAFF）の灰色の帯は**この表ではない**。あれは `staff_shifts.kind='break'`（担当ひとりの休憩）で、
  13:00–14:00 の灰帯が佐藤 美咲の行にだけあり同じ時間に高橋 健が接客していることから区別できる。
  店舗の受付停止帯は担当の行をまたいで全行に掛かる。

### 4.6 `store_settings_revision`

**設定 7 画面の楽観ロックを 1 本にまとめる版。1 店舗 1 行**（規約 14）。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| リビジョン | `version` | `version` | integer | 不可 | 1 以上 | 設定のどの面を保存しても +1 |
| 更新日時 | `updated_at` | `updatedAt` | text | 不可 | ISO8601 | SETTINGS-STORE「最後に直したのは 2026年8月20日（木）」 |
| 更新者 | `updated_by` | `updatedBy` | text | 可 | `staff.id` | 同「山田 大輔（店長）」 |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `store_settings_revision_org_store_idx`（一意） | `(organization_id, store_id)` | 設定面の保存が毎回 1 行引く。2 行目を DB 側で禁じる |

**不変条件**
- 設定 7 画面（店舗の情報 / 営業時間と定休日 / 予約のきまり / スタッフと技能 / 設備と点検 / ご来店の目的 / Web予約の公開）の
  保存は、対象表の書き込みと `UPDATE store_settings_revision SET version = version + 1 WHERE ... AND version = ?` を
  **同じ `db.batch()`** に入れる。
- **版の条件はバッチの全文に配り、版を +1 する文を最後に置く。**対象表への各文（INSERT / UPDATE / DELETE）に
  `AND EXISTS (SELECT 1 FROM store_settings_revision WHERE organization_id=?1 AND store_id=?2 AND version=?3)` を足し、
  最後に置いた `UPDATE store_settings_revision ... AND version=?3` の `meta.changes === 0` を 409 `version_conflict` の合図にする。
  **0 行の `UPDATE` はバッチを止めない**（D1 の実測。`changes` が 0 でも後続の文はそのまま commit される）ので、
  版の条件を 1 文だけに付けると「相手の変更を黙って巻き戻したうえで 409 を返す」ことになり、規約 14 の約束が守れない。
  テストは「409 が返る」で止めず、**版が合わないときに 1 行も書き換わっていない**ことまで確かめる。
- `visit_purposes` / `store_slot_rules` / `web_booking_settings` は自身の `version`（ブリーフ §3 の列）も持つが、
  **画面の保存の衝突判定はこの表の 1 本だけで行う**。行ごとの `version` は API の部分更新（1 行だけを直す PATCH）に使う。
- 行が無い店舗は `version=1` の行を作ってから保存する。

---

## 5. 人と設備

### 5.1 `staff`

接客するスタッフ。並び順がそのまま予約台帳（担当軸）の行順になる。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | 兼務は店舗ごとに 1 行を作り、`admin_user_id` の一致で同一人物と分かるようにする |
| adminユーザID | `admin_user_id` | `adminUserId` | text | 可 | admin の `users.id` | 個人ログインを許すスタッフだけ埋まる |
| 表示名 | `display_name` | `displayName` | text | 不可 | 1〜30文字 | `佐藤 美咲` |
| ふりがな | `kana` | `kana` | text | 可 | ひらがな・空白 | 並べ替え用 |
| 肩書 | `job_label` | `jobLabel` | text | 可 | 0〜20文字 | `店長`（`山田 大輔（店長）` の括弧内） |
| 役割＋ | `role` | `role` | text | 不可 | `manager` \| `staff` | `staff`＝SETTINGS-STAFF「できる役割 → スタッフ（設定は見るだけ）」、`manager`＝MODE-PERSONAL の店長の行「店舗の管理」 |
| 同時担当上限＋ | `max_parallel_reservations` | `maxParallelReservations` | integer | 不可 | 1〜5 | 「同時に受け持てるご予約 1件まで」 |
| PINハッシュ＋ | `pin_hash` | `pinHash` | text | 可 | ハッシュ文字列 | NULL は「PIN 未設定」＝個人ログイン不可 |
| PIN更新日時＋ | `pin_updated_at` | `pinUpdatedAt` | text | 可 | ISO8601 | |
| 有効 | `is_active` | `isActive` | text | 不可 | `0` \| `1` | |
| 並び順 | `sort_order` | `sortOrder` | integer | 不可 | 0 以上 | 台帳の行順・LOGIN-STAFF のタイル順 |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | |
| 更新日時＋ | `updated_at` | `updatedAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `staff_org_store_sort_idx` | `(organization_id, store_id, sort_order)` | 台帳の行・LOGIN-STAFF・SETTINGS-STAFF の一覧 |
| `staff_org_admin_user_idx` | `(organization_id, admin_user_id)` | 個人ログイン時に JWT の `sub` から staff 行を解決する |

**不変条件**
- 平文 PIN を保存しない。`packages/shared` の password 関数（クライアント側ストレッチング + サーバ HMAC 1 回）を使う。
  サーバで PBKDF2 を回すと Workers の CPU 10ms を超える。
- PIN の連続失敗回数（LOGIN-PIN-ERROR「あと2回」「3回続くと 30秒」）は KV（`SHORT_LIVED`）で数える。D1 に置かない。
- `is_active='0'` のスタッフは新規予約の担当候補に出さない。既存の `reservation_assignments` は書き換えない。
- `sort_order` の重複を許す。同値は `kana` の昇順で解く。
- 台帳・MODE-PERSONAL の行に出る肩書き行（`佐藤 美咲 / 視力測定・加工`、`山田 大輔（店長）/ 店舗の管理`）は列を持たない。
  `job_label` と `staff_skills` の画面表記を `・` で連結して組み立てる。
- **役割（`role`）は 2 段だけ。**SETTINGS-STAFF の「できる役割」が `店長` と `スタッフ（設定は見るだけ）` の
  2 値しか出さないので、チェーン管理者・監査担当を独立した役割として持たない。
- **`max_parallel_reservations` は担当ごとの設定**（既定 1）。SETTINGS-STAFF 右の「同時に受け持てるご予約　1件まで ›」が
  スタッフ 1 人ずつの編集欄になっている。店舗全体の `store_slot_rules.max_parallel`（3 件）とは別の値で、
  空き枠エンジンは両方を満たす枠だけを返す。
- **`pin_hash` は担当ごとの暗証番号**。端末の暗証番号（`terminals.pin_hash`）とは別に持つ。
  SETTINGS-STAFF の「PIN　設定してあります／作り直す」と START-DEVICE-MODE の「スタッフ一人ひとりの4〜6桁」が根拠。
- **銀座店のスタッフ seed は 6 名**（SETTINGS-STAFF「スタッフ 6名」）。
  佐藤 美咲 / 高橋 健 / 中村 彩 / 小林 学 / 渡辺 由紀 / **山田 大輔（店長）**。
  `role='manager'` は山田 大輔だけで、その行だけ `job_label='店長'`・当日の `staff_shifts` が 0 件（「本日はお休み」）。
  **決定ブリーフ §11 の「高橋 慎輔（店長）」は誤りとし、seed もテストも `山田 大輔` を使う。**
  SETTINGS-STAFF / SETTINGS-STORE / MODE-PERSONAL の 3 面がそろって `山田 大輔（店長）` を描いており、
  承認済みモックが seed の正本になる（ブリーフ §12.3 が §11 を訂正したのと同じ扱い）。
- **佐藤 美咲の技能は 視力測定・加工・販売・受付 の 4 つ**（SETTINGS-STAFF 右の技能札が正。
  一覧の「視力測定・加工・販売」は札を `・` で連結した表示が途中で切れたもので、`販売・受付` が 1 語である）。

### 5.2 `staff_skills`

スタッフが持つ技能。`purpose_requirements`（`kind='skill'`）と突き合わせて担当候補を絞る。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | `staff.store_id` の非正規化コピー |
| スタッフID | `staff_id` | `staffId` | text | 不可 | `staff.id` | |
| 技能コード | `skill_code` | `skillCode` | text | 不可 | 下表 6 値 | |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

技能の語彙（SETTINGS-STAFF「できること（技能）」の 6 チップに 1 対 1）:

| `skill_code` | 画面の表記 |
|---|---|
| `measure` | 視力測定 |
| `processing` | 加工 |
| `sales_reception` | 販売・受付 |
| `fitting` | フィッティング |
| `contact_lens` | コンタクトの相談 |
| `repair` | 修理・部品交換 |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `staff_skills_org_staff_skill_idx`（一意） | `(organization_id, staff_id, skill_code)` | 同じ技能を 2 回付けさせない |
| `staff_skills_org_store_skill_idx` | `(organization_id, store_id, skill_code)` | 空き枠エンジンの「この技能を持つ担当は誰か」 |

**不変条件**
- `store_id` は必ず `staff.store_id` と一致させる（非正規化した理由は、空き枠エンジンが 1 クエリで店舗を絞れるようにするため）。
- 技能を外しても、すでに割り当て済みの `reservation_assignments` は書き換えない。
- **技能の語彙はこの 6 値だけ。**`purpose_requirements`（`kind='skill'`）の `value` も同じ 6 値しか取らない。
  SETTINGS-STAFF が「できること（技能）」に 6 つの札を並べ「✓ の技能が要る目的だけご案内します。」と書いているのが根拠で、
  7 つ目を足すには SETTINGS-STAFF と SETTINGS-PURPOSE の両方を変える必要がある。
  `04-api.md` §4.3 の `SkillCode` はこの `skill_code` と**同じ綴り**にする（別名を作らない）。
- **`フィッティング` は技能であって目的ではない。**ご来店の目的（§6.1）に `フィッティング` は無く、
  `staff_skills.skill_code='fitting'` としてだけ現れる。

### 5.3 `staff_shifts`

日ごとの勤務帯と休憩帯。台帳の行に「休憩」の帯を出す元でもある。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| スタッフID | `staff_id` | `staffId` | text | 不可 | `staff.id` | |
| 日付 | `date` | `date` | text | 不可 | `YYYY-MM-DD` | JST の暦日 |
| 開始 | `starts_at` | `startsAt` | text | 不可 | `HH:MM` | `10:00` |
| 終了 | `ends_at` | `endsAt` | text | 不可 | `HH:MM` | `19:00` |
| 種別 | `kind` | `kind` | text | 不可 | `work` \| `break` | `break` は台帳に「休憩」と出す |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `staff_shifts_org_store_date_idx` | `(organization_id, store_id, date)` | 台帳 1 日分の行をまとめて引く |
| `staff_shifts_org_staff_date_idx` | `(organization_id, staff_id, date)` | 空き枠エンジンの「この担当はその時間帯に勤務しているか」 |

**不変条件**
- `starts_at < ends_at`。日跨ぎの勤務は 2 行に分ける（この業態では発生しない）。
- 同じ `staff_id` + `date` の `kind='work'` 帯は重ならない。
- `kind='break'` は同じ日の `work` 帯の内側にある。
- `kind='work'` の行が 0 件の日は「本日はお休み」。LOGIN-STAFF はそのスタッフのタイルを `disabled` にする。
- **この表は編集の対象ではない。展開結果である。**編集の単位は曜日（SETTINGS-STAFF の「勤務時間」は
  月10:00–19:00 / 火 定休日 / 水10:00–19:00 / 木10:00–19:00 / 金 お休み / 土10:00–19:00 / 日12:00–19:00 の 7 列グリッド）なので、
  正本は `staff_weekly_shifts`（§5.6）に置き、この表はそこから **62 日先まで**展開した行だけを持つ。
  展開は「保存したとき」と「日次 Cron」の両方で行う。**Cron が毎日 1 日ぶん先へ窓を送る**ので、
  最後に設定を触った日から 62 日を過ぎて全担当が勤務外になる（＝Web 予約の受付窓が黙って閉じる）ことは起きない。
- 展開した行を人が個別に直すことは P1 では扱わない（臨時のシフト変更は `staff_weekly_shifts` の
  `effective_from` を切り替えて作り直す）。

### 5.4 `equipment`

視力測定機・相談カウンター・加工室など、1 予約が同時に押さえられる設備・場所。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 名前 | `name` | `name` | text | 不可 | 1〜30文字 | `視力測定機 A` |
| 種別 | `kind` | `kind` | text | 不可 | `measure` \| `counter` \| `workbench` | 下表の割り当て |
| 役割の表示＋ | `role_label` | `roleLabel` | text | 可 | 0〜20文字 | LEDGER-RESOURCE の行名の下に出る小さい文字（`視力測定` / `精密検査` / `接客・ご相談`）。`kind` からは導けない（`視力測定機 A` と `検査室 1` はどちらも `measure` だが表示が違う） |
| 同時受け入れ数 | `capacity` | `capacity` | integer | 不可 | 1〜10 | 既定 1。1 台で同時に複数を受けられる場所だけ 2 以上 |
| 有効 | `is_active` | `isActive` | text | 不可 | `0` \| `1` | `0` は「止めています」 |
| 停止理由＋ | `inactive_reason` | `inactiveReason` | text | 可 | 0〜40文字 | `定期点検（メーカー来店）` / `部品待ち`。`is_active='0'` のときだけ非 NULL |
| 台帳の見せ方＋ | `ledger_display` | `ledgerDisplay` | text | 不可 | `grey` \| `hide` | SETTINGS-EQUIPMENT「台帳に出す → 灰色にして残す」＝`grey` |
| 並び順 | `sort_order` | `sortOrder` | integer | 不可 | 0 以上 | 台帳（設備軸）の行順 |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |
| 更新日時＋ | `updated_at` | `updatedAt` | text | 不可 | ISO8601 | |

**seed の正本は決定ブリーフ §12.3**（「§11 の 5 件は誤り。モックの 7 件を正とする」）。
SETTINGS-EQUIPMENT「設備と場所　6件」（相談カウンター 1・2 が 1 行）と LEDGER-RESOURCE の 5 行を合わせて **7 行**にする。

| 設備・場所 | `kind` | `role_label` | 出典 |
|---|---|---|---|
| 視力測定機 A | `measure` | `視力測定` | LEDGER-RESOURCE |
| 視力測定機 B | `measure` | `視力測定` | LEDGER-RESOURCE |
| 検査室 1 | `measure` | `精密検査` | LEDGER-RESOURCE |
| 相談カウンター 1 | `counter` | `接客・ご相談` | LEDGER-RESOURCE |
| 相談カウンター 2 | `counter` | `接客・ご相談` | LEDGER-RESOURCE |
| フィッティング台 | `counter` | `フィッティング` | SETTINGS-EQUIPMENT のみ（LEDGER-RESOURCE には描かれていない）。**種別は決定ブリーフ §12.3** |
| 加工室 | `workbench` | `加工` | SETTINGS-EQUIPMENT のみ（同上） |

seed では `kind='workbench'` が **加工室 1 台だけ**になる。決定ブリーフ §12.3 はフィッティング台を
`counter` に置いており、`workbench`（作業台）という語の見た目に引きずられて `workbench` を割り当てない。
これにより `purpose_requirements` の `equipment_kind='counter'` は
相談カウンター 1・2 とフィッティング台の **3 台**を候補にする（2 台ではない）。

**`role_label` は全 7 行で非 NULL にする。**`is_active='1'` の設備は必ず台帳（設備軸）に行として出るので
（下の不変条件）、行名の下が空欄になる設備を作らない。フィッティング台は `フィッティング`、加工室は `加工` を入れる。
LEDGER-RESOURCE がこの 2 行を描いていないのはモックの省略（README「一覧・表の行は 8 つまで」）であり、隠す指定ではない。

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `equipment_org_store_sort_idx` | `(organization_id, store_id, sort_order)` | 台帳（設備軸）の行・SETTINGS-EQUIPMENT の一覧 |
| `equipment_org_store_kind_idx` | `(organization_id, store_id, kind)` | 空き枠エンジンの「この種別の設備は何が空いているか」 |

**不変条件**
- **1 台 1 行**にする。SETTINGS-EQUIPMENT は「相談カウンター 1・2」を 1 行に描き、LEDGER-RESOURCE は「相談カウンター 1」
  「相談カウンター 2」を 2 行に描いている。台帳の行と 1 対 1 にするため**行は 2 本**とし、設定画面の 1 行表示は
  同名接頭の設備をまとめた表示として実装する。
- `is_active='0'` の設備を要求する目的は、空き枠を 1 件も返さない（SETTINGS-EQUIPMENT「止めている間は、その設備を使う目的をご案内しません。」）。
- 停止に伴って既存予約を自動で取り消さない。SETTINGS-EQUIPMENT の「止めると影響するご予約 3件」を保存前に見せるだけにする。
- `ledger_display` が効くのは **`is_active='0'` の設備だけ**（SETTINGS-EQUIPMENT の「台帳に出す」は「止めています」の
  編集欄の中にある）。`is_active='1'` の設備は必ず台帳（設備軸）に行を出す。
  LEDGER-RESOURCE がフィッティング台・加工室の行を描いていないのはモックの省略（README の「一覧・表の行は 8 つまで」）
  であって、隠す指定ではない。実装は `is_active='1'` の全設備を `sort_order` 順に出す。

### 5.5 `equipment_maintenance`

設備の点検予定。空き枠エンジンが「その時間帯は使えない」と読む。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 設備ID | `equipment_id` | `equipmentId` | text | 不可 | `equipment.id` | |
| 開始 | `starts_at` | `startsAt` | text | 不可 | ISO8601 | `8月28日（金）10:00` |
| 終了 | `ends_at` | `endsAt` | text | 不可 | ISO8601 | `8月28日（金）12:00` |
| 内容 | `note` | `note` | text | 可 | 0〜60文字 | `定期点検（メーカー来店）` |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |
| 作成者＋ | `created_by` | `createdBy` | text | 可 | `staff.id` | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `equipment_maintenance_org_store_start_idx` | `(organization_id, store_id, starts_at)` | 台帳 1 日分に「点検」の帯を重ねる |
| `equipment_maintenance_org_equipment_start_idx` | `(organization_id, equipment_id, starts_at)` | 空き枠エンジンの設備別判定・SETTINGS-EQUIPMENT の「次の点検」 |

**不変条件**
- `starts_at < ends_at`。
- 同じ設備に重なる行があってもよい。空き枠エンジンは和集合で塞ぐ。
- 点検帯と重なる既存予約は自動で動かさない。ALERTS に `equipment.maintenance_scheduled` を 1 件出す。
- **視力測定機 B の点検日はモック間で食い違う。**SETTINGS-EQUIPMENT は「2026年8月28日（金）10:00–12:00」、
  ALERTS は「8月30日 10:00–12:00」。seed は SETTINGS-EQUIPMENT（設定の保存先そのものを描いている面）を正とし、
  **`2026-08-28T01:00:00.000Z` 〜 `2026-08-28T03:00:00.000Z`**（JST 10:00–12:00）で 1 行作る。モック画像は直さない。

```sql
-- 台帳・空き枠エンジンの重なり判定（半開区間 [starts_at, ends_at)）
SELECT equipment_id, starts_at, ends_at, note
FROM equipment_maintenance
WHERE organization_id = ?1 AND store_id = ?2
  AND starts_at < ?4 AND ends_at > ?3;
```

### 5.6 `staff_weekly_shifts`

**勤務の曜日テンプレート。`staff_shifts`（§5.3）の正本**。SETTINGS-STAFF「勤務時間」の 7 列グリッドの保存先。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| スタッフID | `staff_id` | `staffId` | text | 不可 | `staff.id` | |
| 曜日 | `weekday` | `weekday` | integer | 不可 | 0〜6 | 0=日 … 6=土 |
| お休み | `is_off` | `isOff` | text | 不可 | `0` \| `1` | `1`＝「定休日」「お休み」（火・金） |
| 開始 | `starts_at` | `startsAt` | text | 可 | `HH:MM` | `is_off='0'` のとき非 NULL |
| 終了 | `ends_at` | `endsAt` | text | 可 | `HH:MM` | 同上 |
| 休憩開始 | `break_start` | `breakStart` | text | 可 | `HH:MM` | 担当ひとりの休憩（台帳の灰帯）。無ければ NULL |
| 休憩終了 | `break_end` | `breakEnd` | text | 可 | `HH:MM` | 同上 |
| 適用開始日 | `effective_from` | `effectiveFrom` | text | 不可 | `YYYY-MM-DD` | この日以降の展開に使う |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `staff_weekly_shifts_org_staff_weekday_idx`（一意） | `(organization_id, staff_id, effective_from, weekday)` | 保存時の置き換えと展開。同じ適用開始日に同じ曜日の 2 行を作らせない |

**不変条件**
- 1 スタッフ・1 `effective_from` につき **7 行ちょうど**（月〜日）。保存は 7 行の置き換え（`db.batch()`）。
- `is_off='0'` なら `starts_at < ends_at`。休憩は両方 NULL か両方非 NULL で、勤務帯の内側にある。
- 保存の直後に、`effective_from` から **62 日先まで**の `staff_shifts` を作り直す
  （`kind='work'` 1 行 ＋ 休憩があれば `kind='break'` 1 行）。既存の同期間の行は消してから入れる。
- 日次 Cron が毎日「各スタッフの `staff_shifts` の最終日が 62 日先を下回っていたら 1 日ぶん延ばす」を行う。
  Web 予約は 30 日先まで受けるので、この 1 本が無いと受付窓の末端が誰も操作しないまま閉じていく。
- **勤務帯が店舗の営業時間からはみ出しても保存を拒まない。**警告を 1 行出して通す
  （「日曜日の勤務が営業時間（10:00–18:00）の外に出ています。」）。
  承認済みモックの seed 自身がはみ出しており（佐藤 美咲の日曜は 12:00–19:00、店舗の日曜は 10:00–18:00）、
  拒否すると初期データが入らない。空き枠エンジンは営業時間との積集合だけを枠にするので、実害は出ない。

---

## 6. 来店の目的

### 6.1 `visit_purposes`

ご来店の目的マスタ。所要時間と、必要な技能・設備（`purpose_requirements`）を持つ。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | **可** | `stores.id` | **NULL はチェーン共通**。非 NULL はその店舗だけの目的 |
| 名前（店内） | `name_internal` | `nameInternal` | text | 不可 | 1〜30文字 | `メガネを新しく作る` |
| 名前（対客） | `name_public` | `namePublic` | text | 不可 | 1〜30文字 | `新しいメガネを作る`。**お客様に見せる名前の正本はこの列**（SETTINGS-PURPOSE の「お客様に見せる名前」列） |
| 名前（短）＋ | `name_short` | `nameShort` | text | 不可 | 1〜5文字 | `新調相談`。台帳の帯・HOME の一覧・設定の影響カードに出す |
| 所要（分） | `duration_minutes` | `durationMinutes` | integer | 不可 | 5〜240 | 60 / 20 / 20 / 30 / 40 / 30 |
| Web公開 | `is_web_published` | `isWebPublished` | text | 不可 | `0` \| `1` | 「修理・部品交換」だけ `0`（お店で受けるだけ） |
| 有効 | `is_active` | `isActive` | text | 不可 | `0` \| `1` | |
| 並び順 | `sort_order` | `sortOrder` | integer | 不可 | 0 以上 | 「この順でお客様にお見せします。」 |
| リビジョン | `version` | `version` | integer | 不可 | 1 以上 | 楽観ロック |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |
| 更新日時＋ | `updated_at` | `updatedAt` | text | 不可 | ISO8601 | |

モックの 6 件（SETTINGS-PURPOSE「ご来店の目的　6件」の並び順そのまま。`sort_order` は 0 から）:

| `name_internal` | `name_public` | `name_short` | `duration_minutes` | `is_web_published` |
|---|---|---|---|---|
| メガネを新しく作る | 新しいメガネを作る | 新調相談 | 60 | `1` |
| 今のメガネを調整したい | かけ具合の調整 | 調整 | 20 | `1` |
| できあがりを受け取る | できあがりの受け取り | 受け取り | 20 | `1` |
| 修理・部品交換 | 修理・部品の交換 | 修理 | 30 | `0` |
| コンタクトの相談 | コンタクトのご相談 | コンタクト | 40 | `1` |
| 視力測定だけ | 視力測定 | 視力測定 | 30 | `1` |

`is_web_published='1'` は 5 件で、SETTINGS-WEB の「公開する目的　5件」と一致する。
**公開の判定は `is_web_published` 単独で行う**（`is_active='1'` を前提とする。§6.1 の不変条件）。
SETTINGS-WEB のプレビューが 4 件、WEB-02-PURPOSE が 6 件を描いているのは**どちらもモックの描き漏れ**であり、
判定に別の条件を足す根拠にはしない（README の行上限は 8 なので省略ではない）。

**この 6 件を seed の正本とする。決定ブリーフ §11 の 6 件（`フィッティング(30)` を含み `コンタクトの相談(40)` を含まない）は誤りとする。**
SETTINGS-PURPOSE / BOOK-02 / SETTINGS-WEB の 3 面がそろって `コンタクトの相談 40分` を描き、
`フィッティング` を目的として描いていない（`フィッティング` は §5.2 の**技能**としてのみ現れる）。
ブリーフ §12.3 が §11 の設備 5 件を訂正したのと同じ扱いで、モックを正とする。

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `visit_purposes_org_store_sort_idx` | `(organization_id, store_id, sort_order)` | BOOK-02 / LEDGER-WALKIN / SETTINGS-PURPOSE の一覧 |
| `visit_purposes_org_web_idx` | `(organization_id, store_id, is_web_published)` | 公開 API（WEB-02）の目的一覧 |

**不変条件**
- 店舗の目的一覧は「`store_id = 選択中店舗`」∪「`store_id IS NULL`」を `sort_order` で並べる。
  `name_internal` が衝突したら店舗行を優先し、共通行を出さない。
- `is_active='0'` なら `is_web_published='1'` でも公開しない。
- **`duration_minutes` を変えても既存の `reservation_purposes.duration_minutes` は書き換えない**。
  予約時点の所要時間を凍結する。これが SETTINGS-PURPOSE の影響プレビューを「これから」の枠だけに限れる根拠になる。
- LEDGER-WALKIN が「メガネを調整したい」、BOOK-02 が「今のメガネを調整したい」と揺れているが、実装は
  `name_internal` の 1 語（`今のメガネを調整したい`）に正規化する。モック画像は直さない。
- **お客様に見せる名前の正本は SETTINGS-PURPOSE の「お客様に見せる名前」列＝`name_public` である。**
  同画面の「お客様の画面の見え方」プレビュー（新しいメガネを作る／かけ具合の調整／できあがりの受け取り／視力測定）が
  この表記と一字一句一致する。WEB-02-PURPOSE の「メガネを新しく作る」と WEB-06-DONE の同表記は
  `name_internal` の混入であり、実装は `name_public` を出す。モック画像は直さない。

**台帳・一覧に出す短い名前（この表が持っていない列）**

同じ 1 件（田中 花子 様 8月27日 11:00）を、モックは面によって別の文字で書いている。
`name_internal` / `name_public` の 2 列だけでは次の表記を作れない:

| 画面 | 出ている文字 | 対応する `name_internal` |
|---|---|---|
| LEDGER-STAFF / LEDGER-RESOURCE / LEDGER-DETAIL / LEDGER-WALKIN の帯 | `新調相談・視力測定` | `メガネを新しく作る` ＋ `視力測定だけ` |
| LEDGER-STAFF の帯（15:00 川上 恵 様） | `新調相談` | `メガネを新しく作る` |
| CUSTOMER-LIST 「直近のご来店」／CUSTOMER-DETAIL 「次のご予約」／HOME-PERSONAL 「本日の担当」 | `新調相談・視力測定` | 同上 |
| SETTINGS-EQUIPMENT 「止めると影響するご予約」 | `新しく作る` / `視力測定` | `メガネを新しく作る` / `視力測定だけ` |
| BOOK-02-PURPOSE / LEDGER-LIST / CHANGE-* / RECEPTION-* | `メガネを新しく作る` | 同左（`name_internal` そのもの） |

これは表記ゆれ（上の `今のメガネを調整したい` の件）ではなく**幅の制約**である。
台帳の 30 分枠は 1194px の面で 1 枠およそ 68px しかなく
（`screens/LEDGER-STAFF.html:10` の `.tt-grid { grid-template-columns: 170px repeat(14, 1fr) }`）、
帯（`.appt`）は `min-height: 54px` / `font-size: 13px` / `overflow: hidden`
（`docs/frontend/mockups/eyex/assets/eyex.css:704-714`）。
`name_internal` は最大 30 文字を許すので、そのまま流すと帯の中で「メガネを新し…」に切れて業務上読めなくなる。
**よって `name_short`（1〜5 文字・NOT NULL）を持つ。**溢れを `overflow: hidden` に任せる案は採らない。

**3 つの名前の使い分け（実装はこの表以外の組み合わせを作らない）**

| 名前 | 出す面 |
|---|---|
| `name_short` | 台帳の帯（LEDGER-STAFF / RESOURCE / DETAIL / WALKIN）／HOME・HOME-PERSONAL の一覧／CUSTOMER-LIST・CUSTOMER-DETAIL の予約行／設定の影響カード（SETTINGS-EQUIPMENT / SETTINGS-PURPOSE） |
| `name_internal` | 予約の詳細・復唱・受付・変更（BOOK-02-PURPOSE / BOOK-05-CONFIRM / LEDGER-LIST / CHANGE-* / RECEPTION-*） |
| `name_public` | お客様の面（`/w/**` の全画面・確認メール・SETTINGS-WEB のプレビュー） |

SETTINGS-EQUIPMENT の `新しく作る` は `name_short`（`新調相談`）に正規化する。同じ目的に短い名前を 2 つ持たせない。
モック画像は直さない。

`ReservationSummary.purposeLabel` / `LedgerEntry.purposeLabel`（`04-api.md` §4.5）は
`reservation_purposes` を `sort_order` 順に並べ、**`name_short` を `・` でつなぐ**（`新調相談・視力測定`）。
詳細・復唱側のラベルは同じ並びで `name_internal` をつなぐ。

**SETTINGS-PURPOSE に `name_short` の入力欄はモックに描かれていない。**編集欄は
「お客様に見せる名前」の下に 1 行足す（描かれていない要素を足す唯一の箇所として、§16 に追認事項として残す）。

### 6.2 `purpose_requirements`

目的が要求する技能・設備種別。空き枠エンジンの第 5・第 6 条件。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 目的ID | `purpose_id` | `purposeId` | text | 不可 | `visit_purposes.id` | |
| 種別 | `kind` | `kind` | text | 不可 | `skill` \| `equipment_kind` | |
| 値 | `value` | `value` | text | 不可 | `kind='skill'` → `staff_skills.skill_code` の 6 値／`kind='equipment_kind'` → `equipment.kind` の 3 値 | |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

`メガネを新しく作る` の 3 行（SETTINGS-PURPOSE「必要な技能 → 視力測定」「必要な設備・場所 → 視力測定機A・相談カウンター」）:

| `kind` | `value` |
|---|---|
| `skill` | `measure` |
| `equipment_kind` | `measure` |
| `equipment_kind` | `counter` |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `purpose_requirements_org_purpose_idx`（一意） | `(organization_id, purpose_id, kind, value)` | 同じ要求を 2 回書かせない。空き枠エンジンの目的別引き |

**不変条件**
- 同じ `kind` の行が複数あるときは**すべて満たす（AND）**。`equipment_kind` が `measure` と `counter` の 2 行なら、
  視力測定機と相談カウンターを**両方**押さえる（BOOK-05「設備と場所 → 視力測定機 A ／ 相談カウンター 2」と一致）。
- 行が 0 件の目的は「技能・設備の制約なし」。担当と場所は未定のまま確定できる。
- **1 目的が持てるのは `kind='skill'` が 1 行まで、`kind='equipment_kind'` が 2 行まで。**
  SETTINGS-PURPOSE の編集欄が「必要な技能　視力測定」（1 つ）と「必要な設備・場所　視力測定機A・相談カウンター」（2 つ）で、
  それ以上を入れる場所を持たない。超える入力は 400 で弾く。
- `kind='skill'` の `value` は §5.2 の 6 値、`kind='equipment_kind'` の `value` は §5.4 の 3 値だけを取る。

---

## 7. 予約と来店

### 7.1 `reservations`

予約の本体。台帳・検索・変更・分析のすべてがこの表を軸にする。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 予約番号 | `code` | `code` | text | 不可 | `EY-YYMM-NNNN` | `EY-2608-0142`（BOOK-06 / CHANGE-CANCEL）。**書式は 1 種類だけ**。Web のお客様に見せる `EY-W-2608-0031` は別列（`web_bookings.public_code`。§11.2） |
| 顧客ID | `customer_id` | `customerId` | text | 可 | `customers.id` | ウォークインは NULL のまま確定できる |
| 出どころ | `source` | `source` | text | 不可 | `phone` \| `counter` \| `walkin` \| `web` | 台帳の色分けの元。表示語は お電話 / 店頭 / ウォークイン / Web予約 |
| 状態 | `status` | `status` | text | 不可 | `confirmed` \| `arrived` \| `serving` \| `done` \| `cancelled` \| `no_show` | |
| 開始 | `starts_at` | `startsAt` | text | 不可 | ISO8601 | |
| 終了 | `ends_at` | `endsAt` | text | 不可 | ISO8601 | 片付け時間は含めない |
| 所要（分） | `duration_minutes` | `durationMinutes` | integer | 不可 | 5〜480 | `ends_at - starts_at` の分。分析で SQL 集計するため冗長に持つ |
| ご要望 | `note_customer` | `noteCustomer` | text | 可 | 0〜500文字 | `遠近は初めてです` |
| 店内メモ | `note_internal` | `noteInternal` | text | 可 | 0〜500文字 | お客様には見せない |
| リビジョン | `version` | `version` | integer | 不可 | 1 以上 | 楽観ロック。EX-CONFLICT の検出に使う |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | ANALYTICS-COUNT の「受付日」 |
| 更新日時 | `updated_at` | `updatedAt` | text | 不可 | ISO8601 | |
| 作成者 | `created_by` | `createdBy` | text | 可 | `staff.id` | 共有端末で個人未確認なら NULL |
| 取消日時 | `cancelled_at` | `cancelledAt` | text | 可 | ISO8601 | |
| 取消理由 | `cancel_reason` | `cancelReason` | text | 可 | `customer` \| `store` \| `duplicate` \| `no_show` | CHANGE-CANCEL の 4 択（お客様のご都合／店舗の都合／予約の重複／ご来店がなかった） |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `reservations_org_store_start_idx` | `(organization_id, store_id, starts_at)` | 台帳 1 日分（LEDGER-STAFF / RESOURCE / LIST）と空き枠エンジンの重なり判定 |
| `reservations_org_code_idx`（一意） | `(organization_id, code)` | 予約番号での検索。採番の衝突検出 |
| `reservations_org_store_status_start_idx` | `(organization_id, store_id, status, starts_at)` | LEDGER-LIST の絞り込み（すべて／これから／確認待ち）と ALERTS の確認待ち件数 |
| `reservations_org_customer_start_idx` | `(organization_id, customer_id, starts_at)` | 顧客詳細の「次のご予約」・来店回数の再計算 |

**不変条件**
- `starts_at < ends_at`、`duration_minutes` ＝ `ends_at` と `starts_at` のミリ秒差 ÷ 60000（整数）。
- **`status IN ('cancelled','no_show')` のとき `cancelled_at` と `cancel_reason` が非 NULL。それ以外では両方 NULL。**
  CHANGE-CANCEL の 4 択は 1 つの画面で「取り消し」と「無断キャンセル」の両方を作る。
  `cancel_reason='no_show'`（「ご来店がなかった　当日いらっしゃらず」）を選んだときだけ `status='no_show'`、
  ほかの 3 つ（`customer` / `store` / `duplicate`）は `status='cancelled'`。
  ANALYTICS-CANCEL の「無断キャンセル」はこの `cancel_reason='no_show'` を数える（§11.4）。
- 状態遷移は `confirmed → arrived → serving → done` の一方向。ほかに `confirmed → cancelled` と `confirmed → no_show`。逆行しない。
- **枠の二重確保は `reservation_slot_locks`（§7.6）の「上限つき条件付き INSERT」で止める。**
  「確定の直前に同じ `db.batch()` の中で重なりを再検査する」方式は D1 では成立しない
  （`db.batch()` は全文を投げてから結果をまとめて受け取るので、読んだ結果で分岐して書くことができない）。
  読み → アプリ側で判定 → 書き の 2 往復になり、その間に別端末の書き込みが入る窓が空く。
  刻み単位に展開した占有行を予約本体と同じ `db.batch()` で `INSERT ... SELECT ... WHERE (上限判定)` として書き、
  **1 行も入らなかったら（`meta.changes === 0`）409 `slot_taken`** を返して BOOK-CONFLICT / EX-CONFLICT を出す。
- **版と枠のガードは `db.batch()` の全文に配り、版を +1 する文を最後に置く**（規約 14）。
  変更・取消・進捗のすべての文に版のガード `AND EXISTS (SELECT 1 FROM reservations WHERE id=?R AND version=?V)` を足し、
  枠を書き換える操作にはさらに枠のガード
  `AND (SELECT COUNT(*) FROM reservation_slot_locks WHERE reservation_id=?R AND created_at=?T) = ?N`
  （`?T` はこのバッチの時刻、`?N` はこの予約が要求する枠の本数）を足す。
  最後に `UPDATE reservations SET ..., version = version + 1 WHERE id=?R AND version=?V` を置き、
  その `meta.changes === 0` を 409 の合図にする。
  **0 行の `UPDATE` はバッチを止めない**（D1 の実測）ので、版の条件を 1 文だけに付けると
  「予約は元のまま・割当と占有行だけ相手の内容に書き換わった」状態が commit され、409 を返しながら二重予約を作る。
  409 のとき **1 行も書き換わっていない**ことをテストで固定する（「409 が返る」までで止めない）。
  0 行だった理由（版か枠か）は、バッチのあとに `SELECT version FROM reservations WHERE id=?R` を 1 本読んで見分ける
  （何も書けていないので読み直して差し支えない。`version_conflict` の応答に載せる相手の現在値もこの読み直しで作る）。
- `code` の採番は「**組織 × `YYMM`** 内の 4 桁ゼロ埋め連番」。接頭辞は `EY-` の 1 種類だけ。
  店舗ごとではなく**組織ごと**に採るのは、店舗をまたぐ検索で番号が衝突しないようにするため。
  `reservations_org_code_idx` で衝突を検出し、衝突したら +1 して最大 5 回まで再試行する。
  **`NNNN` が 9999 に達した月は 5 桁へ桁上げする**（`EY-2608-10000`）。桁が伸びても書式の検証は
  `/^EY-\d{4}-\d{4,5}$/` で通る。5 回再試行しても取れなかったときは 500 ではなく
  409 `code_exhausted` を返して人を呼ぶ（黙って別番号を振らない）。
- 予約の作成・変更・取消は必ず `db.batch()` で `reservations` / `reservation_purposes` / `reservation_assignments` / **`reservation_slot_locks`** / `audit_events` をまとめて書く。

```sql
-- 台帳 1 日分（取消は帯を出さない。no_show はその日に起きた事実なので出す）
SELECT id, code, customer_id, source, status, starts_at, ends_at, duration_minutes, note_customer
FROM reservations
WHERE organization_id = ?1 AND store_id = ?2
  AND starts_at < ?4 AND ends_at > ?3
  AND status <> 'cancelled'
ORDER BY starts_at;

-- 予約番号での 1 件引き
SELECT * FROM reservations WHERE organization_id = ?1 AND code = ?2;
```

**出どころは 4 値。表示は 4 語・色は 3 系統。**決定ブリーフ §3 の 3 値に `counter`（店頭）を足す。
EX-OFFLINE の予約リストが 4 語を出し分けている（川上 恵 様＝**店頭**、田中 花子 様＝**お電話**、
山口 真央 様＝**Web予約**、ウォークイン 004＝**ウォークイン**）のが根拠で、
「予約なしで来た人（`walkin`）」と「店頭で先の日時を予約した人（`counter`）」は業務上まったく別である。

| `source` | 画面に出す語 | 台帳の帯の色 |
|---|---|---|
| `phone` | お電話 | 緑（既定。帯に出どころの語を書かない） |
| `counter` | 店頭 | 緑（同上） |
| `web` | Web予約 | 青（帯に「Web予約」と書く） |
| `walkin` | ウォークイン | 茶（帯に「ウォークイン 004」と書く） |

緑の 2 値は帯に語を持たせない（LEDGER-STAFF の緑の帯 5 本はどれも出どころの語を持たない）。
出どころの語は予約リスト（EX-OFFLINE）と予約詳細（LEDGER-DETAIL）で出す。
LEDGER-DETAIL の札「電話予約」は「お電話」に揃える。モック画像は直さない。

### 7.2 `reservation_purposes`

1 予約に複数の目的を載せる。所要時間は予約時点で凍結する。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 予約ID | `reservation_id` | `reservationId` | text | 不可 | `reservations.id` | |
| 目的ID | `purpose_id` | `purposeId` | text | 不可 | `visit_purposes.id` | |
| 所要（分） | `duration_minutes` | `durationMinutes` | integer | 不可 | 5〜240 | **予約時点の `visit_purposes.duration_minutes` の写し** |
| 並び順 | `sort_order` | `sortOrder` | integer | 不可 | 0 以上 | 復唱文と台帳での並び |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `reservation_purposes_org_reservation_idx` | `(organization_id, reservation_id, sort_order)` | 台帳・詳細・復唱文の目的表示 |
| `reservation_purposes_org_purpose_idx` | `(organization_id, purpose_id)` | ANALYTICS の目的別集計と、SETTINGS-PURPOSE の影響プレビュー |

**不変条件**
- 1 予約に 1 件以上。
- `SUM(duration_minutes) <= reservations.duration_minutes`。BOOK-02 の「お取りする時間」（45／60／75／90 分）で
  目的の合計より長く押さえられるため、等しいとは限らない。
  **この不等号が正で、`02-domain-model.md` の I-03（総和と等しい）／I-03b（お取りする時間で上書きする）は
  こちらに揃える。**「目的が要求する 60 分」と「押さえた 90 分」は別の事実で、前者は分析（目的別の集計）に、
  後者は台帳の帯・片付け時間の起点・空き枠の判定に効く。上書きすると分析側が失われる。

### 7.3 `reservation_assignments`

担当と設備の押さえ。**担当が未定の予約も枠を消費する**ため、未定でも行を作る。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 予約ID | `reservation_id` | `reservationId` | text | 不可 | `reservations.id` | |
| 種別 | `kind` | `kind` | text | 不可 | `staff` \| `equipment` | |
| 対象ID | `target_id` | `targetId` | text | **可** | `staff.id` または `equipment.id` | **NULL＝あとで決める**。枠は消費する |
| 開始 | `starts_at` | `startsAt` | text | 不可 | ISO8601 | 予約全体と別の帯を押さえられるよう行ごとに持つ |
| 終了 | `ends_at` | `endsAt` | text | 不可 | ISO8601 | |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `reservation_assignments_org_target_start_idx` | `(organization_id, kind, target_id, starts_at)` | 空き枠エンジンの「この担当／この設備はその時間帯に空いているか」 |
| `reservation_assignments_org_reservation_idx` | `(organization_id, reservation_id)` | 予約詳細・変更差分（CHANGE-DIFF） |

**不変条件**
- `kind='staff'` の行は 1 予約にちょうど 1 行（未定でも `target_id=NULL` で作る）。
- `kind='equipment'` の行は 0 行以上（BOOK-05 は視力測定機 A と相談カウンター 2 の 2 行）。
- `starts_at` / `ends_at` は `reservations` の帯の内側にある。
- 店舗の絞り込みは `reservations` との JOIN で行う（同一 D1 なので JOIN してよい）。この表に `store_id` は置かない。
- 取消した予約（`status IN ('cancelled','no_show')`）の行は残すが、空き枠エンジンは除外する。
- **BOOK-05 の「仮の押さえ　11:18 まで」は D1 に置かない。**確定前の一時押さえは KV（`SHORT_LIVED`）に
  **`hold:{organizationId}:{storeId}:{holdId}` の 1 通りのキー**で TTL 付きに書く（`04-api.md` §6.3 と同じ形に揃える）。
  枠は `KV.put` の第 3 引数 `metadata` に `{ kind, targetId, startsAt, endsAt, receptionSessionId }` として持たせる。
  **業務面の空き枠エンジンは `KV.list({ prefix: 'hold:{organizationId}:{storeId}:' })` を 1 回叩き、
  返る metadata をそのまま塞がりとして読む。** 鍵に `targetId` と `startsAt` を入れる形にすると
  `DELETE /api/staff/holds/:holdId` が鍵を作れず、`holdId` だけの形で list を使わないと空き枠エンジンが押さえを読めない。
  両方を満たすのは metadata 付きの list だけである。
  **公開面（`/api/public/**`）では KV を読まない**（KV の list は無料枠 1,000 回/日で、Web 予約の閲覧数がそのまま list 数になる。
  `04-api.md` §6.3）。押さえは表示のためだけの仕組みなので、公開面で読まなくても二重予約は起きない（一次排他は §7.6）。
  確定時に `reservation_assignments` と `reservation_slot_locks` を作って hold を消す。
  **未確定の押さえを `reservation_assignments` に先に作らない**（作ると台帳に帯が出てしまう）。

```sql
-- 担当 X が [?3, ?4) に空いているか（0 件なら空き）
SELECT 1
FROM reservation_assignments a
JOIN reservations r ON r.id = a.reservation_id AND r.organization_id = a.organization_id
WHERE a.organization_id = ?1 AND a.kind = 'staff' AND a.target_id = ?2
  AND a.starts_at < ?4 AND a.ends_at > ?3
  AND r.status NOT IN ('cancelled', 'no_show')
LIMIT 1;

-- 「担当が未定」の予約も枠を消費する（target_id IS NULL を数える）
SELECT COUNT(*)
FROM reservation_assignments a
JOIN reservations r ON r.id = a.reservation_id AND r.organization_id = a.organization_id
WHERE a.organization_id = ?1 AND r.store_id = ?2 AND a.kind = 'staff'
  AND a.starts_at < ?4 AND a.ends_at > ?3 AND r.status NOT IN ('cancelled', 'no_show');
```

**仮の押さえの有効時間は 420 秒（7 分）**。BOOK-05-CONFIRM の statusbar `11:11` と「仮の押さえ → 11:18 まで」の差から取る
（`04-api.md` §6.3）。押さえは**排他の一次手段ではない**（一次排他は §7.6）。切れても入力は消えず、確定も試せる。
空き枠エンジンは **同じ `reception_session_id` の押さえを塞がりに数えない**（自分の受付が自分の押さえに当たると、
工程 3 で 11:00 に置いてから 11:30 へ動かしたときに 11:00 が 7 分間だれにも取れなくなる）。
工程の中で枠を選び直したときは古い押さえを `DELETE /api/staff/holds/:holdId` で解放する。

### 7.4 `walk_ins`

予約なしの来店。顧客未特定のまま受付し、台帳に載せる。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 来店日＋ | `visit_date` | `visitDate` | text | 不可 | `YYYY-MM-DD` | `arrived_at` を JST に直した暦日。採番と台帳の日引きに使う |
| 整理番号 | `ticket_no` | `ticketNo` | integer | 不可 | 1 以上 | 表示は `ウォークイン 004`（3 桁ゼロ埋め） |
| 来店時刻 | `arrived_at` | `arrivedAt` | text | 不可 | ISO8601 | `11:02` |
| 目的ID＋ | `purpose_id` | `purposeId` | text | 可 | `visit_purposes.id` | 受付パネルの 4 択から選んだとき |
| ご用件 | `purpose_note` | `purposeNote` | text | 可 | 0〜60文字 | 4 択にないご用件の自由記述（`フレームの相談`） |
| 顧客ID | `customer_id` | `customerId` | text | 可 | `customers.id` | あとから紐づく |
| 予約ID | `reservation_id` | `reservationId` | text | 不可 | `reservations.id` | **受付と同時に作る `source='walkin'` の予約**（下の不変条件） |
| 状態 | `status` | `status` | text | 不可 | `waiting` \| `serving` \| `booked` \| `left` | お待ち／ご案内中／先のご予約にした／お帰り |
| 退店時刻 | `left_at` | `leftAt` | text | 可 | ISO8601 | `status='left'` のとき非 NULL |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `walk_ins_org_store_date_ticket_idx`（一意） | `(organization_id, store_id, visit_date, ticket_no)` | 整理番号の重複を DB 側で禁じる |
| `walk_ins_org_store_arrived_idx` | `(organization_id, store_id, arrived_at)` | 台帳の最終行（ウォークイン行）・受付ボード |
| `walk_ins_org_store_date_status_idx` | `(organization_id, store_id, visit_date, status)` | 「いまお待ち 2名」の件数（**必ず当日で絞る**） |

**不変条件**
- `ticket_no` は `(organization_id, store_id, visit_date)` 内で 1 から連番（**店舗 × 日でリセット**）。表示は 3 桁ゼロ埋め。
  採番は `MAX(ticket_no) + 1` を読んでから INSERT し、一意 index に弾かれたら最大 5 回まで再試行する。
- **受付と同時に `source='walkin'` の予約を 1 件起こす。**`reservations` / `reservation_purposes` /
  `reservation_assignments` / `reservation_slot_locks` / `walk_ins` を 1 つの `db.batch()` で書く。
  こうしないと LEDGER-WALKIN が「ここに入ります 11:30–12:30」と描いた枠が空き枠エンジンから見て空いたままになり、
  同じ瞬間に電話予約が同じ担当を取れてしまう（`walk_ins` は担当も開始時刻も持たない）。
  顧客が未特定でも `reservations.customer_id` は NULL 可なので成立する。担当が未定なら
  `reservation_assignments.target_id = NULL` で作り、`reservation_slot_locks` は `target_key='unassigned'` で作る。
  **担当未定のレーンの上限は `store_slot_rules.max_parallel`（銀座店は 3）** なので、
  同じ 30 分枠に続けてお越しになった 2 人目・3 人目も受け付けられる（§7.6。1 本しか取れない形にすると、
  目の前に立っているお客様を受け付けられない画面ができる）。
- **「いまお待ち N名」は `visit_date = 本日（JST）` かつ `status='waiting'` で数える。**日付条件を落とすと、
  昨日帰ったお客様が今朝の待ち行列に残り、`LedgerView.estimatedWaitMinutes` まで狂う。
- `status` の遷移は `waiting → serving → left` / `waiting → left`（待たずにお帰り）/
  `waiting → booked`（その日は接客せず、先の日時のご予約に振り替えた。`reservation_id` が当日でない予約を指す）。
  この 4 値は `visit_events.stage` の写しではない（「予約になったか」は stage が持たない軸である）。
  **`waiting` から直接 `left` になった行が「待ちきれずお帰りになった」件数**で、ANALYTICS-WAIT の母数から
  落とさない（落とすと待ち時間が実態より必ず良く出る）。
- 日次 Cron が前日以前の `waiting` / `serving` を `left` にし、`left_at` に営業終了時刻を入れる
  （閉店時に盤面から降ろし忘れた行を翌日まで残さない）。
- 受付パネルの「ご用件」は 4 択（メガネを新しく作る 60 / メガネを調整したい 20 / できあがりを受け取る 20 /
  視力測定だけ 30）で、選んだときは `purpose_id` に入れる。4 択に無いご用件（LEDGER-STAFF の「フレームの相談」）は
  `purpose_note` に自由記述として残す。**`purpose_id` と `purpose_note` はどちらか一方が非 NULL**。
- 「お待ち 6分」は保存しない。`now − arrived_at` を画面側で算出する。**15 分以上で「お待たせ中」に変える**
  （LEDGER-WALKIN の受付パネル「いまお待ち 2名　目安 15分」と同じ値。RECEPTION-JOURNEY の 18 分は赤地、
  LEDGER-STAFF の 6 分は通常で、15 分はその間にある唯一の画面上の値）。
- 台帳の「ご来店お待ち」は時間軸に載せない。**最下段に固定した全幅の帯**とし、行見出しに待ち人数（「2名」）を出す
  （LEDGER-STAFF / LEDGER-WALKIN のウォークイン帯は 10:00 から右端まで通しで、開始時刻に載っていない）。

### 7.5 `visit_events`

来店中の工程の記録。RECEPTION-JOURNEY のボードと ANALYTICS-WAIT の元データ。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 対象種別 | `subject_type` | `subjectType` | text | 不可 | `reservation` \| `walkin` | |
| 対象ID | `subject_id` | `subjectId` | text | 不可 | `reservations.id` または `walk_ins.id` | |
| 工程 | `stage` | `stage` | text | 不可 | 下表 8 値 | |
| 発生時刻 | `occurred_at` | `occurredAt` | text | 不可 | ISO8601 | |
| 担当 | `staff_id` | `staffId` | text | 可 | `staff.id` | 誰が進めたか |
| 備考 | `note` | `note` | text | 可 | 0〜120文字 | |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

`stage` と RECEPTION-JOURNEY の 6 列の対応（**決定ブリーフ §3.3 の 7 値に `handover` を足して 8 値にする**）:

| `stage` | ボードの列 |
|---|---|
| `received` | 受付 |
| `consulting` | ご相談 |
| `fitting` | フレーム選び |
| `measuring` | 視力測定 |
| `checkout` | レンズ・お会計 |
| `handover`＋ | **お渡し**（ボードの最後の列。ここに居る人も「ご来店中」に数える） |
| `left` | 列を持たない。**退店**（ボードから降りる） |
| `waiting` | 列を持たない。工程と工程の間の「お待たせ中」を表す（RECEPTION-JOURNEY「お待たせ中　18分」） |

**`left` を「お渡し」に当てない。**RECEPTION-JOURNEY の伊藤 健 様は「お渡し　対応中 11:04〜」でありながら
右上の「ご来店中 4名」に数えられている。`left`（退店）を当てるとご来店中から外れるので成立しない。
6 列に対して既存の 7 値では 1 つ足りないことがここで確定するため、`handover` を足す。

列の並びはボードの左から右の順（受付 → ご相談 → フレーム選び → 視力測定 → レンズ・お会計 → お渡し）であり、
`stage` の enum 定義順（`received` / `waiting` / `measuring` / `consulting` / `fitting` / `checkout` / `handover` / `left`）とは一致しない。
**画面の並びを enum の宣言順から作らない。**上表を UI 側の定数として持つ。
`left` は `visit_events` では「退店」、`walk_ins.status` では「お帰り」を指す。指す事実は同じだが別の表の別の語彙である。

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `visit_events_org_subject_idx` | `(organization_id, subject_type, subject_id, occurred_at)` | そのお客様の工程の並び（ボードの 1 行） |
| `visit_events_org_store_occurred_idx` | `(organization_id, store_id, occurred_at)` | 当日のボード全体と ANALYTICS-WAIT の日次集計 |

**不変条件**
- **追記のみ**。UPDATE / DELETE を発行しない。訂正は打ち消しの行を足す。
- 現在地は「同じ subject の `occurred_at` 最大の行」。
- ANALYTICS-WAIT の「ご来店の受付からご相談開始まで」は、同じ subject の `stage='received'` の `occurred_at` と、
  その後の最初の `stage='consulting'` の `occurred_at` の差（秒）。中央値は `analytics_daily` に日次で書き戻す。
- RECEPTION-JOURNEY の「ご来店中 N名」は、**最新の `stage` が `left` でない subject の数**。
  `handover`（お渡し）に居る人も数える。
- 「お待たせ中」に変えるのは **15 分**から。`now −（最新の `occurred_at`）` が 15 分以上のとき、
  その行の「ご相談」欄などに「お待たせ中 N分」を出す（LEDGER-WALKIN の受付パネル「目安 15分」と同じ値）。
- 工程を進める操作は行の「次にやること」欄から行い、**担当以外のスタッフも進められる**（受付は手の空いた人がやる）。
  誰が進めたかは `staff_id` に残す。

### 7.6 `reservation_slot_locks`

**枠の一次排他。刻み（`slot_minutes`）単位に展開した占有行**。予約の確定・変更と同じ `db.batch()` で INSERT する。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 予約ID | `reservation_id` | `reservationId` | text | 不可 | `reservations.id` | 取消・変更で DELETE する |
| 種別 | `kind` | `kind` | text | 不可 | `staff` \| `equipment` | |
| 対象キー | `target_key` | `targetKey` | text | 不可 | `staff.id` / `equipment.id` / `unassigned` | **担当が未定のレーンは `unassigned` の固定値**（NULL を使わない。NULL 同士は `=` で結べず、上限判定の `COUNT(*)` が担当未定のレーンだけ数えられなくなるため） |
| 枠の開始 | `slot_start` | `slotStart` | text | 不可 | ISO8601 | `slot_minutes` の格子に載った時刻 |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `reservation_slot_locks_org_store_target_slot_idx`（**非一意**） | `(organization_id, store_id, kind, target_key, slot_start)` | 上限判定の `COUNT(*)` を 1 枠 1 回で引く |
| `reservation_slot_locks_org_reservation_idx` | `(organization_id, reservation_id)` | 取消・変更のときの一括 DELETE と、枠のガードの `COUNT(*)` |

**一意 index は張らない。**一意 index は「1」しか表現できず、設定で編集できる 3 つの上限
（`equipment.capacity` 1〜10 / `staff.max_parallel_reservations` 1〜5 / `store_slot_rules.max_parallel` 1〜20）が
すべて 1 に潰れる。**編集できるのに効かない設定**が 3 つできるうえ、`target_key='unassigned'` のレーンが 1 本に縛られると、
担当を決めずに受け付けるウォークイン（§7.4 は受付と同時に予約を 1 件起こす）が**同じ 30 分枠に 2 人目を作れなくなる**。
目の前に立っているお客様を受け付けられない画面ができるので採らない。
`02-domain-model.md` の I-06（同一対象の重なりが `equipment.capacity` を超えない）とも、この形でようやく一致する。

**書き方（確定・変更で共通）**: 1 枠 1 文の**上限つき条件付き INSERT**にする。D1 で 1 文で書けること、
発火の有無が `meta.changes`（1 / 0）で読めることは実測で確かめてある。

```sql
INSERT INTO reservation_slot_locks
  (id, organization_id, store_id, reservation_id, kind, target_key, slot_start, created_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8   -- ?8 = このバッチの時刻
WHERE NOT EXISTS (
  -- この予約が要求する枠のうち 1 つでも上限に達していたら、どの文も発火させない
  SELECT 1 FROM (
              SELECT ?9  AS kind, ?10 AS target_key, ?11 AS slot_start, ?12 AS cap
    UNION ALL SELECT ?13,         ?14,               ?15,               ?16
    -- …この予約が要求する枠の数だけ 4 つずつ増やして並べる（担当 1 + 設備 0〜2 × 刻みの本数）
  ) w
  WHERE (
    SELECT COUNT(*) FROM reservation_slot_locks l
    WHERE l.organization_id = ?2 AND l.store_id = ?3
      AND l.kind = w.kind AND l.target_key = w.target_key AND l.slot_start = w.slot_start
      AND l.reservation_id <> ?4        -- 自分がこのバッチで入れた行・自分の古い行を数えない
  ) >= w.cap
);
```

- `cap` に入れる値: `kind='staff'` かつ `target_key <> 'unassigned'` なら `staff.max_parallel_reservations`、
  `kind='equipment'` なら `equipment.capacity`、`target_key='unassigned'` なら `store_slot_rules.max_parallel`。
  上限はハンドラの入口で 1 回読み、文のパラメータとして渡す（時刻を引数で注入するのと同じ扱い）。
- **同じ `WHERE NOT EXISTS (...)` を、この予約が要求する全枠の INSERT に一字一句同じで付ける。**
  自分の行を `l.reservation_id <> ?4` で除くので判定はバッチの途中で変わらず、
  **N 本すべてが入るか 1 本も入らないかのどちらか**になる。1 本目の `meta.changes` が 0 なら 409 `slot_taken` を返す。
- `created_at`（`?8`）にはバッチの時刻を入れる。**同じ予約の古い行と新しい行はこの値で見分ける。**
- 本文がガードの説明で使う `?R` / `?V` / `?T` / `?N` は、それぞれ予約 ID・送られてきた版・バッチの時刻・要求する枠の本数を指す
  読みやすさのための記号である。実装では上の SQL と同じく**番号付きのプレースホルダ**（`?1` …）にする。
- 予約本体・目的・割当・監査の各文は
  `AND (SELECT COUNT(*) FROM reservation_slot_locks WHERE reservation_id = ?4 AND created_at = ?T) = ?N` でガードする
  （ガードしないと「予約だけ書けて占有行が無い」状態ができる）。§7.1 の「版と枠のガード」を参照。

**不変条件**
- 予約 1 件が持つ行数は「（`duration_minutes` ＋ `cleanup_minutes`）÷ `slot_minutes`」×（担当 1 ＋ 設備 0〜2）。
  60 分・刻み 30 分・片付け 10 分・担当 1 + 設備 2 なら 9 行。1 予約あたり 1KB に満たない。
- 確定・変更・取消はこの表の INSERT / DELETE を**必ず予約本体と同じ `db.batch()`** に入れる。
- **変更は「新しい枠を取ってから古い枠を返す」順にする。**① 新しい枠の INSERT（上の形） ② 予約本体・目的・割当・監査
  ③ `DELETE FROM reservation_slot_locks WHERE reservation_id=?4 AND created_at <> ?T`（枠のガードつき）。
  逆順にすると、枠が取れずに 409 を返す経路で**古い枠だけが解放される**。
- 取消の DELETE には版のガード `AND EXISTS (SELECT 1 FROM reservations WHERE id=?R AND version=?V)` を必ず付ける。
  付けないと、版が合わずに 409 を返したときに占有行だけが消え、予約は `confirmed` のまま枠が空く。**409 が二重予約を作る。**
- **`unassigned` レーンも占有として数える**（担当が未定の予約も枠を消費する）。上限は `store_slot_rules.max_parallel`（銀座店は 3）で、
  同時受付上限もこの表が DB 側で止める。空き枠エンジンは同じ判定を表示のために先回りで行うが、**最後の砦はこの表**である。
- 取り消した予約（`status IN ('cancelled','no_show')`）の行は残さない（DELETE する）。空き枠を即座に戻すため。
- **この表を足すのは決定ブリーフ §3 に無い表の追加なので、人間の追認が要る**（§16）。
  ただしこれ以外に二重予約を止める手段が無い — D1 の `db.batch()` は全文を投げてから結果を受け取るので、
  「同じバッチの中で読んで判定して書く」ことができない。

---

## 8. 受付セッションと録音

### 8.1 `reception_sessions`

受付開始から予約確定または破棄までの記録単位。**破棄でも行を残す**（用語の正本）。HISTORY-LIST の 1 行。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 予約ID | `reservation_id` | `reservationId` | text | 可 | `reservations.id` | 破棄なら NULL のまま |
| 端末ID | `terminal_id` | `terminalId` | text | 可 | `terminals.id` | P10 より前は NULL |
| 操作者 | `actor_id` | `actorId` | text | 可 | `staff.id` | 共有モードで個人未確認なら NULL |
| 開始 | `started_at` | `startedAt` | text | 不可 | ISO8601 | |
| 終了 | `ended_at` | `endedAt` | text | 可 | ISO8601 | 進行中は NULL |
| 結果 | `outcome` | `outcome` | text | 可 | `booked` \| `discarded` | 進行中は NULL |
| 下書き＋ | `draft_json` | `draftJson` | text | 可 | JSON 文字列 | 予約フローで伺った内容（**選んだ id と入力途中の文字だけ**）。進行中のみ非 NULL |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `reception_sessions_org_store_started_idx` | `(organization_id, store_id, started_at)` | HISTORY-LIST の日別一覧（「2026年8月27日（木）46件」） |
| `reception_sessions_org_reservation_idx` | `(organization_id, reservation_id)` | 予約詳細から受付と録音へたどる |

**不変条件**
- `outcome` を書くときは `ended_at` も同じ UPDATE で書く。同時に `draft_json` を NULL に戻す。
- `outcome='booked'` なら `reservation_id` が非 NULL。
- 行は削除しない（HISTORY-EMPTY の「該当 0件」は絞り込みの結果であって削除ではない）。
- **予約フローの下書きは `draft_json` に置く。**端末のメモリだけに持たない。iPadOS の Safari は裏に回ったタブを
  容易に破棄して戻ると読み込み直すので、伺った内容が丸ごと消える（マイク許可の取り直しでも同じ）。
  ただし**お客様のお名前・お電話番号そのものは書かない**。選んだ `purpose_id` / `staff_id` / `equipment_id` /
  `starts_at` / `customer_id` と、入力途中の文字だけを持つ（`07-nfr.md` §6.6 の禁止表と揃える）。
- **HISTORY-LIST の「2026年8月27日（木）46件」は、この表の件数ではない。**モックの当日一覧には
  `reception_sessions` を持たない Web 予約（相川 みどり 様・山口 真央 様）が並び、選択中の 1 件の受付は
  「中村 彩 が 8月20日（木）14:32 に電話で受け付け」＝別の日である。つまりモックは
  **ご来店日で束ねて、その予約に受付の記録をぶら下げて**見せている。
  一覧の元は「その日にご来店予定の予約（`reservations.starts_at` の JST 暦日）＋ その日のウォークイン」とし、
  各行に `reception_sessions`（あれば）と録音をぶら下げる。破棄した受付（`outcome='discarded'`）は
  予約を持たないので、`started_at` の暦日でこの一覧に混ぜる。HISTORY-EMPTY の「絞り込みをすべて外す（46件）」も同じ数を使う。

### 8.2 `recordings`

受付中の録音。実体は R2（binding `RECORDINGS`、非公開）。**ダウンロード URL を返さない**。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 録音番号＋ | `code` | `code` | text | 不可 | `EY-R-NNNN` | ALERTS の `EY-R-1482` |
| 受付セッションID | `reception_session_id` | `receptionSessionId` | text | 不可 | `reception_sessions.id` | |
| 予約ID | `reservation_id` | `reservationId` | text | 可 | `reservations.id` | NULL＝破棄受付の録音 |
| R2キー | `r2_key` | `r2Key` | text | 不可 | `recordings/{organizationId}/{storeId}/{YYYY}/{MM}/{id}.{ext}` | 前置 `recordings/` で手書き SVG（`notes/`。§9.4）と同じバケットの中で分ける |
| MIME | `content_type` | `contentType` | text | 不可 | `audio/mp4` \| `audio/webm` \| `audio/mpeg` | **既定は `audio/mp4`**（AAC 32kbps モノラル）。iPadOS の Safari の MediaRecorder が確実に出せる形式で、60 分でも約 14MB に収まる。`audio/webm` は取れない端末がある |
| 長さ（秒） | `duration_seconds` | `durationSeconds` | integer | 可 | 0 以上 | `03:12` は 192。完了まで NULL |
| バイト数 | `bytes` | `bytes` | integer | 可 | 0 以上 | 完了まで NULL |
| 状態 | `state` | `state` | text | 不可 | `recording` \| `uploading` \| `stored` \| `failed` \| `deleted` | |
| 最低保持期限 | `retain_until` | `retainUntil` | text | 不可 | ISO8601 | これ以前の削除は拒否 |
| 保全 | `legal_hold` | `legalHold` | text | 不可 | `0` \| `1` | `1` の間は期限後も消さない（MODE-PERSONAL「録音の保全」） |
| 送信回数 | `upload_attempts` | `uploadAttempts` | integer | 不可 | 0 以上 | ALERTS「録音の保存に3回失敗しました」 |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | |
| 更新日時＋ | `updated_at` | `updatedAt` | text | 不可 | ISO8601 | |
| 削除日時＋ | `deleted_at` | `deletedAt` | text | 可 | ISO8601 | `state='deleted'` のとき非 NULL |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `recordings_org_code_idx`（一意） | `(organization_id, code)` | 録音番号の採番衝突検出とアラートからの引き当て |
| `recordings_org_state_retain_idx` | `(organization_id, state, retain_until)` | 保持期限切れを掃除する Cron |
| `recordings_org_session_idx` | `(organization_id, reception_session_id)` | HISTORY-LIST の再生 |
| `recordings_org_reservation_idx` | `(organization_id, reservation_id)` | LEDGER-DETAIL / CHANGE-SEARCH の「録音を聞く 03:12」 |

**不変条件**
- `retain_until` は `state='stored'` になった時刻から算出する。**成立予約（`reservation_id` 非 NULL）は +30 日、
  破棄受付（`reservation_id` NULL）は +24 時間**。
- `legal_hold='1'` か `now < retain_until` の間は `state='deleted'` にしない（要求は 409 `recording_retained`。`04-api.md` §5 のコードに揃える）。
- `state='failed'` の行は端末に実体が残っている状態を表す（EX-UPLOAD-FAILED「録音は、この iPad の中に残っています」）。
  **再送は端末が 5 分の固定間隔で行う**（EX-UPLOAD-FAILED は 11:15 表示で「11:20 に自動でもう一度送ります。」）。
  **`upload_attempts` が 3 に達したら ALERTS に `recording.upload_failed`（`severity='action'`）を 1 件出す。**
  通信の再接続は 1 分間隔（EX-OFFLINE は 11:08 表示で「11:09 に自動でも試します」）。
- **サーバ側からの再送経路は無い。**音声の実体は端末にあり、サーバが持つのはこの表の行だけである。
  ALERTS の「もう一度送る」は**その録音を持っている端末でしか成功しない**ので、
  `alerts.body` に端末名（`terminals.name`）を必ず入れる（レジ横 iPad で失敗した録音を受付 iPad から押しても直らない）。
- **`r2_key` を第 2 の冪等キーにする。**冪等キーの TTL 24 時間を越えた再送で同じ音声が R2 に二重に置かれるのを防ぐ。
  `r2_key` は `recordings.id` から決まるので、同じ録音の再送は必ず同じキーを上書きする。
- **1 録音 = 1 キー。実体を分割して複数キーに置かない**（`r2_key` が冪等キーである以上、分割すると成立しない）。
  §9.3 の見積りで 60 分でも約 14MB なので、100MB の上限は約 7 時間ぶんに当たり、通常の受付では届かない。
  それでも 413 になったときは分割せず、3 回失敗と同じ扱いで `alerts` に上げて人が判断する。
- **`state` が `recording` / `uploading` のまま 24 時間動かない行は `failed` に落とす**（日次 Cron）。
  警告を出し続けないための運用上の決め。
- 行は削除しない。R2 のオブジェクトだけ消して `state='deleted'` / `deleted_at` を書く。

---

## 9. 顧客

### 9.1 `customers`

顧客台帳の本体。**組織単位で 1 本**（店舗をまたいで共有する）。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| お客様番号＋ | `customer_number` | `customerNumber` | text | 不可 | `G-NNNNN` | `G-01842`。統合で失った番号は再利用しない。**列名は `customer_number`**（`00_service-spec.md` と `features/007-customer-records` が使う綴り。`reservations.code` / `recordings.code` と紛れないよう `code` にしない） |
| お名前 | `name` | `name` | text | 不可 | 1〜40文字 | `田中 花子` |
| ふりがな | `kana` | `kana` | text | 可 | ひらがな・空白 | `たなか はなこ`。五十音順一覧の並び |
| 電話（表示） | `phone` | `phone` | text | 可 | 表示用の生文字列 | `090-1234-5678` |
| 電話（正規化） | `phone_normalized` | `phoneNormalized` | text | 可 | 数字のみ | `09012345678` |
| 電話（下4桁）＋ | `phone_last4` | `phoneLast4` | text | 可 | 数字 4 桁 | `5678`。`phone_normalized` の末尾 4 桁の写し。下 4 桁検索を index に載せるため |
| メール | `email` | `email` | text | 可 | RFC 準拠 | Web 予約から入る |
| 生年月日 | `birth_date` | `birthDate` | text | 可 | `YYYY-MM-DD` | |
| 住所＋ | `address` | `address` | text | 可 | 0〜120文字 | CUSTOMER-MERGE の「ご住所」 |
| 覚えておくこと | `memo` | `memo` | text | 可 | 0〜60文字 | 一覧の「覚えておくこと」列（`PC作業用・鼻パッド低め`） |
| 初回来店 | `first_visit_at` | `firstVisitAt` | text | 可 | ISO8601 | |
| 最終来店 | `last_visit_at` | `lastVisitAt` | text | 可 | ISO8601 | 一覧の「最後のご来店」 |
| 来店回数 | `visit_count` | `visitCount` | integer | 不可 | 0 以上 | `.visits` バッジの数字 |
| 統合先 | `merged_into_id` | `mergedIntoId` | text | 可 | `customers.id` | 非 NULL の行は検索・一覧から外す |
| リビジョン | `version` | `version` | integer | 不可 | 1 以上 | 楽観ロック |
| 登録店舗＋ | `created_store_id` | `createdStoreId` | text | 可 | `stores.id` | CUSTOMER-MERGE「2024年3月15日 ご登録／銀座店」 |
| 登録端末＋ | `created_terminal_id` | `createdTerminalId` | text | 可 | `terminals.id` | 同「2026年8月13日 ご登録／受付iPad」 |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | |
| 更新日時 | `updated_at` | `updatedAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `customers_org_phone_idx` | `(organization_id, phone_normalized)` | BOOK-04b の候補提示（**前方一致**）・CUSTOMER-NEW の重複警告 |
| `customers_org_phone_last4_idx` | `(organization_id, phone_last4)` | LEDGER-WALKIN「電話番号で探す（下4桁でも探せます）」 |
| `customers_org_kana_idx` | `(organization_id, kana)` | CUSTOMER-LIST の五十音順一覧 |
| `customers_org_customer_number_idx`（一意） | `(organization_id, customer_number)` | お客様番号での引き当てと採番衝突検出 |
| `customers_org_last_visit_idx` | `(organization_id, last_visit_at)` | 「ご来店の回数順」以外の並べ替えと、来店の古い順の抽出 |

**不変条件**
- `phone` / `phone_normalized` / `phone_last4` は 3 つとも NULL か 3 つとも非 NULL。`phone_normalized` は
  `phone` から数字だけを抜いた文字列、`phone_last4` はその末尾 4 桁。
- **電話番号の検索は 2 通りあり、どちらも index に載せる。**後方一致（`LIKE '%' || ?`）は前方ワイルドカードで
  B-tree が効かず、顧客表の全走査になるので使わない。1 組織の顧客は年 20,000 行ずつ増え、消さない。

  | 面 | 引き方 | 使う index |
  |---|---|---|
  | BOOK-04b（電話を伺いながら打つ） | `phone_normalized` の**前方一致**（`LIKE ? \|\| '%'`） | `customers_org_phone_idx` |
  | LEDGER-WALKIN / CUSTOMER-NEW（下 4 桁だけ分かる） | `phone_last4` の**完全一致** | `customers_org_phone_last4_idx` |

- **候補の確からしさは 2 段で返す。**全桁が一致したものが「よく一致しています」（`strong`）、
  前方一致だけ・下 4 桁だけのものが「確かめが必要です」（`weak`）。**自動で 1 件に確定しない。**
  BOOK-04b で `090-1234-5678` と打つと 2 件出るが、2 件目の田中 一郎 様は `090-1234-9912` で
  共通するのは先頭 7 桁（`0901234`）だけである（後方一致では拾えない組み合わせ）。
- `merged_into_id` が非 NULL の行は**参照専用**。予約・受付・メモは統合先の行に付け替える。行は削除しない。
- **`last_visit_at`（「最後のご来店」）は、来店済み（`status IN ('arrived','serving','done')`）の予約の
  最終 `starts_at` の日付。**田中 花子 様の seed は **2026年5月12日**。
  RECEPTION-CHECKIN の「前回のご来店（2026年3月12日）」はモックの誤記であり
  （同画面がその下に並べる度数 −2.25 / −2.00・PD 62.0 は CUSTOMER-DETAIL の**2026年5月12日**行と完全に一致する）、
  BOOK-04b の「5月18日」も桁の誤記である。モック画像は直さない。
- `visit_count` は `reservations` の `status='done'` の件数から算出して書き戻す。読むたびに `COUNT(*)` しない。
  文言は場所によって 2 通りある。**どちらも同じ `visit_count` から作る。**

  | 出る場所 | `visit_count = 0` | `visit_count >= 1` |
  |---|---|---|
  | 台帳・受付ボード・受付履歴のバッジ（LEDGER-RESOURCE / RECEPTION-JOURNEY / HISTORY-LIST） | `初めて` | `{visit_count}回目` |
  | 顧客一覧の「ご来店」列（CUSTOMER-LIST） | `初` | `{visit_count}回` |

  `visit_count = 0` の行は CUSTOMER-LIST の「最後のご来店」列を `—` にする（`last_visit_at` が NULL）。
- CUSTOMER-DETAIL の「よくご担当した者　佐藤 美咲」は列を持たない。その顧客の `status='done'` の予約に紐づく
  `reservation_assignments`（`kind='staff'` / `target_id IS NOT NULL`）を数え、最多の `staff_id` を読み出し時に決める。
  同数なら `reservations.starts_at` が最も新しいほうを採る。
- 顧客の統合は `db.batch()` で「統合元の `merged_into_id` 更新」「統合先の項目更新」「予約・メモの付け替え」
  「`audit_events` の追記」をまとめて書く。元に戻せない（CUSTOMER-MERGE の警告どおり）。

```sql
-- 電話番号の前方一致（BOOK-04b。打ちながら候補を出す）
SELECT id, customer_number, name, kana, phone, visit_count, last_visit_at
FROM customers
WHERE organization_id = ?1 AND merged_into_id IS NULL
  AND phone_normalized LIKE ?2 || '%'
ORDER BY last_visit_at DESC
LIMIT 20;

-- 下 4 桁の完全一致（LEDGER-WALKIN / CUSTOMER-NEW）
SELECT id, customer_number, name, kana, phone, visit_count, last_visit_at
FROM customers
WHERE organization_id = ?1 AND merged_into_id IS NULL
  AND phone_last4 = ?2
ORDER BY last_visit_at DESC
LIMIT 20;

-- 五十音順一覧（カーソルは (kana, id) の複合。OFFSET を使わない）
SELECT id, customer_number, name, kana, visit_count, last_visit_at, memo
FROM customers
WHERE organization_id = ?1 AND merged_into_id IS NULL
  AND (?2 IS NULL OR (kana, id) > (?2, ?3))
ORDER BY kana, id
LIMIT 50;
```

一覧のページングは `04-api.md` §1.2 の `cursor` 方式に合わせる。`OFFSET` は件数が増えるほど遅くなり、
`nextCursor` を返す契約（`CustomerList`）とも噛み合わない。

**他店で書かれた履歴・手書き・度数は、同じ組織なら店舗をまたいで見せる。**
顧客行は組織単位で 1 本であり、CUSTOMER-HANDWRITE が丸の内店で書かれたメモを銀座店の端末に出しているのが根拠。
「別の店舗だから見えない」という分岐は作らない。

> [要確認: Q-03 — いまの前提で進める]（問いと答えの受け取り方は `design/09-open-questions.md`）。
> いまの前提: `customer.history` / `recording.read` / `analytics.read` / `attention.publish` の 4 つを
> **サーバ側で強制する**。録音の再生とお客様のおまとめは個人モード（本人の PIN）を必須にする。

### 9.2 `customer_prescriptions`

度数の履歴。CUSTOMER-DETAIL の「度数の移り変わり」表。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 顧客ID | `customer_id` | `customerId` | text | 不可 | `customers.id` | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | `stores.id` | 測定した店舗 |
| 測定日 | `measured_at` | `measuredAt` | text | 不可 | **`YYYY-MM-DD`** | `2026-05-12`（時刻は持たない） |
| 右 球面 | `r_sph` | `rSph` | real | 可 | -20.00〜+20.00（0.25 刻み） | `-2.25` |
| 右 乱視 | `r_cyl` | `rCyl` | real | 可 | -10.00〜0.00 | `-0.50` |
| 右 軸 | `r_axis` | `rAxis` | integer | 可 | 0〜180 | `180` |
| 右 加入 | `r_add` | `rAdd` | real | 可 | 0.00〜+4.00 | 遠近のみ |
| 左 球面 | `l_sph` | `lSph` | real | 可 | 同上 | `-2.00` |
| 左 乱視 | `l_cyl` | `lCyl` | real | 可 | 同上 | `-0.75` |
| 左 軸 | `l_axis` | `lAxis` | integer | 可 | 0〜180 | `175` |
| 左 加入 | `l_add` | `lAdd` | real | 可 | 同上 | |
| PD | `pd` | `pd` | real | 可 | 40.0〜80.0（mm） | `62.0` |
| 備考 | `note` | `note` | text | 可 | 0〜200文字 | |
| 現在 | `is_current` | `isCurrent` | text | 不可 | `0` \| `1` | 表の緑・太字行 |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `customer_prescriptions_org_customer_measured_idx` | `(organization_id, customer_id, measured_at)` | CUSTOMER-DETAIL の履歴表（新しい順） |

**不変条件**
- `is_current='1'` は顧客ごとにちょうど 1 行。新しい測定を足すときは、古い行を `'0'` にする UPDATE と同じ `db.batch()` で書く。
- 度数を `text` で持たない。BOOK-04b の「R -2.25 L -2.00 PD 62.0」は表示時に小数 2 桁（PD は 1 桁）へ整形する。

### 9.3 `customer_glasses`

いまお使いのメガネ。CUSTOMER-DETAIL の「いまお使いのメガネ 2本」。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 顧客ID | `customer_id` | `customerId` | text | 不可 | `customers.id` | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | `stores.id` | お渡しした店舗 |
| お渡し日 | `purchased_at` | `purchasedAt` | text | 不可 | **`YYYY-MM-DD`** | `2025-04-20` |
| フレーム | `frame_name` | `frameName` | text | 可 | 0〜60文字 | `クラシック TR-88 マットブラウン 52□17` |
| レンズ | `lens_name` | `lensName` | text | 可 | 0〜40文字 | `遠近両用` |
| 用途 | `usage_label` | `usageLabel` | text | 可 | 0〜20文字 | `お出かけ用` / `PC作業用` |
| 備考 | `note` | `note` | text | 可 | 0〜200文字 | |
| 現在 | `is_current` | `isCurrent` | text | 不可 | `0` \| `1` | `1` の本数が「いまお使いのメガネ N本」 |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `customer_glasses_org_customer_purchased_idx` | `(organization_id, customer_id, purchased_at)` | CUSTOMER-DETAIL の一覧（新しい順） |

**不変条件**
- `is_current='1'` は 0 本以上（上限なし）。モックの田中 花子 様は 2 本。
- 買い替えても行を削除しない。古い行を `is_current='0'` にする。

### 9.4 `customer_notes`

接客のメモ・注意ごと・手書き。**手書きから注意ごとへの昇格は申し込み制**（自動で上げない）。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 顧客ID | `customer_id` | `customerId` | text | 不可 | `customers.id` | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | `stores.id` | 書いた店舗（`丸の内店 記入 中村 彩`） |
| 種別 | `kind` | `kind` | text | 不可 | `memo` \| `attention` | `attention` が `.card.warn`「注意ごと」 |
| 本文 | `body` | `body` | text | 不可 | 1〜500文字 | 手書きの読み取り結果もここに入る |
| 手書き | `handwriting_key` | `handwritingKey` | text | 可 | `notes/{organizationId}/{customerId}/{id}.svg` | **R2（binding `RECORDINGS`）のキー。SVG の本体を D1 に置かない**。前置 `notes/` で録音（`recordings/`。§8.2）と分ける |
| 記入者 | `author_id` | `authorId` | text | 可 | `staff.id` | `記入 佐藤 美咲` |
| リビジョン | `revision` | `revision` | integer | 不可 | 1 以上 | 直すたび +1 |
| 状態 | `status` | `status` | text | 不可 | `draft` \| `published` \| `hidden` | 昇格の申し込みは `draft` で作る |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | |
| 更新日時＋ | `updated_at` | `updatedAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `customer_notes_org_customer_created_idx` | `(organization_id, customer_id, created_at)` | CUSTOMER-HANDWRITE のサムネイル一覧（新しい順） |
| `customer_notes_org_customer_kind_idx` | `(organization_id, customer_id, kind, status)` | 「注意ごと 1件」の件数と RECEPTION-CHECKIN の確認行 |

**不変条件**
- 「注意ごと N件」に数えるのは `kind='attention'` かつ `status='published'` の行だけ。`draft` は数えない。
- **手書きの SVG は R2 に置き、D1 には `handwriting_key` だけを持つ。枚数上限は 1 顧客 5 枚。**
  1 枚 3〜12KB × 5 枚 × 5,000 顧客で約 300MB となり、D1 の 500MB（ops は 400MB で警告）に対して
  手書きだけで 6 割を占める見積りになる。R2 は録音（`RECORDINGS`）で既に使っている。
  6 枚目を保存しようとしたら、古い 1 枚を消すか置き換えるかを尋ねる（黙って消さない）。
- 読み出しは Worker が R2 から取り、`<script>` / `on*` 属性 / `<foreignObject>` を除いた許可リストで
  再直列化してから返す（他店舗のスタッフが開くため）。R2 の署名付き URL をクライアントへ渡さない。
- **バケットは録音と同じ `RECORDINGS` を使う**（決定ブリーフ §1 の binding を増やさない＝人間承認を要する変更にしない）。
  用途が 2 つになるので、**キーの前置で分ける**: 録音は `recordings/`、手書きは `notes/`。
  掃除の Cron はそれぞれ自分の前置だけを見る（`recordings/` は `recordings.state='deleted'` の行、
  `notes/` は `customer_notes` から参照が消えた行）。`wrangler.jsonc` のコメントも
  「受付録音と手書きメモの本体。非公開のまま Worker が仲介し、ダウンロード URL は発行しない」に直す。
- 行を消しても R2 のオブジェクトは Cron が拾って消す（先に R2、次に D1 の順で消す）。
- 手書きの読み取り結果は必ず人が直せる（`body` を編集して `revision` を +1）。読み取り信頼度は保存しない。

---

## 10. 統制

### 10.1 `terminals`

店舗に置く iPad の登録。共有端末と個人端末で PIN の持ち方が変わる。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 名前 | `name` | `name` | text | 不可 | 1〜30文字 | `銀座店 レジ横iPad` |
| 種別 | `kind` | `kind` | text | 不可 | `shared` \| `personal` | |
| 置き場所＋ | `place_note` | `placeNote` | text | 可 | 0〜40文字 | `レジの右側　固定スタンド` |
| 端末名＋ | `device_label` | `deviceLabel` | text | 可 | 0〜30文字 | `EYEX-iPad-07` |
| PINハッシュ | `pin_hash` | `pinHash` | text | 可 | ハッシュ文字列 | `kind='shared'` のときの店舗共通 PIN。`personal` では NULL（個人 PIN は `staff.pin_hash`） |
| 自動ロック（秒） | `auto_lock_seconds` | `autoLockSeconds` | integer | 不可 | 30〜1800 | 共有端末は 120（2分さわらないと自動で隠す） |
| 最終通信＋ | `last_seen_at` | `lastSeenAt` | text | 可 | ISO8601 | LOGIN-SHARED の「最終通信 昨日 18:42」「つながっていません」 |
| 有効 | `is_active` | `isActive` | text | 不可 | `0` \| `1` | |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `terminals_org_store_created_idx` | `(organization_id, store_id, created_at)` | LOGIN-SHARED の置き場所一覧・設定の端末一覧 |

**不変条件**
- PIN は 4〜6 桁。平文を保存しない。ハッシュは `staff.pin_hash` と同じ関数を使う。
- 連続失敗回数と 30 秒の待機は KV（`SHORT_LIVED`）で管理する。D1 に置かない。
- 「つながっていません」の判定は `now − last_seen_at` のしきい値で行い、状態を列に持たない。

### 10.2 `terminal_sessions`

端末の使用中セッション。共有モードと個人モードの切り替えを記録する。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 端末ID | `terminal_id` | `terminalId` | text | 不可 | `terminals.id` | |
| スタッフID | `staff_id` | `staffId` | text | 可 | `staff.id` | `mode='personal'` のとき非 NULL |
| モード | `mode` | `mode` | text | 不可 | `shared` \| `personal` | |
| 開始 | `started_at` | `startedAt` | text | 不可 | ISO8601 | LOGIN-SHARED の「高橋 健　9:32 から」 |
| 期限 | `expires_at` | `expiresAt` | text | 不可 | ISO8601 | `personal` は `started_at + auto_lock_seconds` |
| 失効 | `revoked_at` | `revokedAt` | text | 可 | ISO8601 | 自動ロック・明示的な終了で書く |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `terminal_sessions_org_terminal_started_idx` | `(organization_id, terminal_id, started_at)` | 端末の現在の使用者（LOGIN-SHARED の「業務中」） |
| `terminal_sessions_org_expires_idx` | `(organization_id, expires_at)` | 期限切れ行の掃除 Cron |

**不変条件**
- `mode='personal'` なら `staff_id` は非 NULL。`mode='shared'` なら `staff_id` は NULL。
- 個人モードから共有へ戻るときは、personal 行に `revoked_at` を書く（shared 行を作り直さない）。
- 1 端末に `revoked_at IS NULL` かつ `expires_at > now` の行は高々 1 本。

### 10.3 `audit_events`

誰が・どの端末で・何を変えたか。**追記専用で削除しない。**
HISTORY-LIST の「そのあとの変更」タイムラインと CHANGE-DONE の「この操作は受付履歴に残ります」の元データ。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 可 | `stores.id` | 店舗に紐づかない操作（組織同期）は NULL |
| 主体種別 | `actor_type` | `actorType` | text | 不可 | `staff` \| `terminal` \| `system` \| `customer` | `customer` は Web 予約からの操作 |
| 主体ID | `actor_id` | `actorId` | text | 可 | `staff.id` 等 | `system` では NULL |
| 端末ID | `terminal_id` | `terminalId` | text | 可 | `terminals.id` | |
| 操作 | `action` | `action` | text | 不可 | ドット区切り | `reservation.created` / `reservation.rescheduled` / `reservation.cancelled` / `reservation.checked_in` / `customer.merged` / `recording.deleted` / `settings.updated` |
| 対象種別 | `target_type` | `targetType` | text | 不可 | `reservation` \| `customer` \| `recording` \| `store` \| `staff` \| `equipment` \| `visit_purpose` \| `web_booking` \| `terminal` \| `organization` | `organization` は `store_id` が NULL になる唯一の種別（admin からの組織同期）。`terminal` は端末の登録・PIN 変更 |
| 対象ID | `target_id` | `targetId` | text | 不可 | 対象表の `id` | |
| 変更前 | `before_json` | `beforeJson` | text | 可 | JSON 文字列 | 差分表示（CHANGE-DIFF）の材料 |
| 変更後 | `after_json` | `afterJson` | text | 可 | JSON 文字列 | |
| 相関ID | `correlation_id` | `correlationId` | text | 可 | UUID v4 | 1 操作でまとまった複数行を束ねる。同じ `db.batch()` に同じ値を入れる |
| 発生時刻 | `occurred_at` | `occurredAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `audit_events_org_occurred_idx` | `(organization_id, occurred_at)` | 監査の時系列閲覧 |
| `audit_events_org_target_idx` | `(organization_id, target_type, target_id, occurred_at)` | HISTORY-LIST の「そのあとの変更」（1 予約の履歴） |

**不変条件**
- **INSERT だけ。業務の経路から UPDATE / DELETE を発行しない。**訂正は打ち消しの行を足す。
  行が消えるのは日次 Cron の保持期限（**400 日**。§15 と `07-nfr.md` §8）だけである。
- `before_json` / `after_json` に平文 PIN・ハッシュ・お客様のメールアドレス全文を入れない。
- 監査の追記に失敗しても本処理を成功させない（予約の確定と同じ `db.batch()` に入れる）。
  **この表が P3 に必要なのはこの 1 行のためである**（§12 の順序表を参照）。
- `store_id` が NULL になるのは `target_type='organization'` の行だけ。ほかは必ず非 NULL。

### 10.4 `idempotency_records`

再送しても同じ応答を返す必要がある操作（予約の確定など）の記録。短命な排他は KV（`SHORT_LIVED`）が担う。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| 冪等キー | `key` | `key` | text (PK) | 不可 | `{organizationId}:{scope}:{clientKey}` | 組織で名前空間を切る |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 範囲 | `scope` | `scope` | text | 不可 | `reservation.create` / `reservation.cancel` / `web_booking.create` 等 | |
| 要求ハッシュ | `request_hash` | `requestHash` | text | 不可 | SHA-256 hex（64文字） | 同じキーで本文が違えば 409 `idempotency_conflict` |
| 応答 | `response_json` | `responseJson` | text | 可 | JSON 文字列 | `status='done'` のとき非 NULL |
| 状態 | `status` | `status` | text | 不可 | `in_progress` \| `done` | `in_progress` に再送が来たら 409 `idempotency_conflict`（`04-api.md` §5 のコード。`idempotency_in_progress` という別コードを作らない） |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | |
| 期限 | `expires_at` | `expiresAt` | text | 不可 | ISO8601 | `created_at + 24h` |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `idempotency_records_expires_idx` | `(expires_at)` | 期限切れ行の削除 Cron |

**不変条件**
- 主キーが冪等キーそのものなので、`INSERT` の衝突が排他になる。追加の一意 index を張らない。
- **この表は物理削除する**（期限切れのみ）。
- 通知（notifier）側の冪等は KV が担う。ここでは扱わない。

---

## 11. Web予約・運用

### 11.1 `web_booking_settings`

Web 予約の公開設定。**1 店舗 1 行**。SETTINGS-WEB の保存先。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 公開 | `is_published` | `isPublished` | text | 不可 | `0` \| `1` | 「Web予約を公開する → 公開しています」 |
| 受付開始時刻 | `opens_at` | `opensAt` | text | 不可 | `HH:MM` | 「受け付ける時間 10:30–18:00」の 10:30 |
| 受付終了時刻 | `closes_at` | `closesAt` | text | 不可 | `HH:MM` | 同 18:00 |
| 何時間先から | `accept_from_hours` | `acceptFromHours` | integer | 不可 | 0〜168 | 直前予約を止める幅 |
| 何日先まで | `accept_until_days` | `acceptUntilDays` | integer | 不可 | 1〜180 | 「何日先まで受ける 30日先まで」 |
| 承認要否 | `requires_approval` | `requiresApproval` | text | 不可 | `0` \| `1` | 「お店が確かめてから確定する」＝`1` |
| 変更締切（日前）＋ | `change_deadline_days` | `changeDeadlineDays` | integer | 不可 | 0〜30（既定 **1**） | WEB-CANCEL「変更・取り消しは前日までにお願いいたします。」の「前日」。**締切＝来店日の `change_deadline_days` 日前の 23:59:59.999 JST**（既定 1 なら前日 23:59:59 JST。翌 00:00:00 JST から 409 `change_deadline_passed`）。営業終了時刻を締切にしない — 店舗ごとに締切が動くとお客様に説明できず、`*.time.test.ts` の境界値も書けない |
| お知らせ文 | `message` | `message` | text | 可 | 0〜120文字 | `9月30日（水）は棚卸しのためお休みをいただきます。` |
| リビジョン | `version` | `version` | integer | 不可 | 1 以上 | 楽観ロック |
| 更新日時 | `updated_at` | `updatedAt` | text | 不可 | ISO8601 | |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `web_booking_settings_org_store_idx`（一意） | `(organization_id, store_id)` | 公開 API が店舗ごとに 1 行引く。2 行目を DB 側で禁じる |

**不変条件**
- `opens_at < closes_at`。この帯は `store_business_hours` の内側でなくてよい（Web だけ受付を狭められる）。
- `change_deadline_days` の既定は **1**。行が無い店舗も 1 として読む。境界は「来店日 −`change_deadline_days` 日」の
  **23:59:59.999 JST まで受け、その 1 ミリ秒後（翌 00:00:00.000 JST）から 409** とする（`07-nfr.md` §10.3 の境界値表と同じ切り方）。
- 行が無い店舗は「未公開」として扱う（`is_published='0'` と同じ）。
- 「ご案内のページ `eyex.jp/ginza`」はこの表に持たない。`stores.slug` から組み立てる。

**銀座店の seed（SETTINGS-WEB の「受け付ける内容」4 行そのまま）**

| 列 | 値 | 根拠 |
|---|---|---|
| `is_published` | `1` | 「公開しています」 |
| `opens_at` / `closes_at` | `10:30` / `18:00` | 「受け付ける時間　10:30–18:00」 |
| `accept_until_days` | `30` | 「何日先まで受ける　30日先まで」 |
| `requires_approval` | `1` | 「ご予約の確定　お店が確かめてから確定する」 |
| `message` | 0〜120 文字 | 「27文字／120文字まで」 |
| **`accept_from_hours`** | **`2`** | 画面に項目が無いので既定値を置く。目的の最長が 60 分＋片付け 10 分で、直前の予約を受けると台帳の組み替えが間に合わない |

**`requires_approval` に「自動で確定する」の選択肢を持たせない。**SETTINGS-WEB が 1 値しか描いておらず、
自動確定を足すと承認待ちの経路が二重になる。列は `0` / `1` を取るが、`0` は「承認を要らなくする」ためではなく
将来の拡張のために残す（P8 の UI は `1` 固定で保存する）。

**公開する目的が 0 件のときは `is_published='1'` にできない。**目的を選べない予約画面は成立しないので、
保存を拒む（「公開する目的が 1 件もありません。目的を 1 つ以上公開してください。」）。

### 11.2 `web_bookings`

お客様が Web から入れた予約の付帯情報。予約本体は `reservations` に作る。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 予約ID | `reservation_id` | `reservationId` | text | 不可 | `reservations.id` | |
| ご予約番号（対客）＋ | `public_code` | `publicCode` | text | 不可 | `EY-W-YYMM-NNNN` | `EY-W-2608-0031`。**お客様に見せるのはこの番号**（WEB-06-DONE / WEB-CANCEL）。`reservations.code` とは別の採番系統 |
| 確認鍵ハッシュ | `confirmation_key_hash` | `confirmationKeyHash` | text | 不可 | ハッシュ文字列 | 確認メールのリンクに載せる 1 回性の鍵 |
| 確認番号ハッシュ | `management_code_hash` | `managementCodeHash` | text | 不可 | ハッシュ文字列 | **画面・メールでは「確認番号」と呼ぶ**（「管理コード」は内部語）。`/w/reservations/:code` の本人確認（WEB-CANCEL）に使う |
| お名前 | `contact_name` | `contactName` | text | 不可 | 1〜40文字 | `山口 真央` |
| ふりがな | `contact_kana` | `contactKana` | text | 可 | ひらがな・空白 | `やまぐち まお` |
| 電話 | `contact_phone` | `contactPhone` | text | 不可 | 表示用の生文字列 | `080-2345-6789` |
| メール | `contact_email` | `contactEmail` | text | 可 | RFC 準拠 | `m.yamaguchi@example.jp` |
| 状態 | `status` | `status` | text | 不可 | `pending` \| `confirmed` \| `cancelled` | `pending` はお店の確認待ち |
| 作成日時 | `created_at` | `createdAt` | text | 不可 | ISO8601 | |
| 確定日時＋ | `confirmed_at` | `confirmedAt` | text | 可 | ISO8601 | |
| 取消日時＋ | `cancelled_at` | `cancelledAt` | text | 可 | ISO8601 | |
| 更新日時＋ | `updated_at` | `updatedAt` | text | 不可 | ISO8601 | |

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `web_bookings_org_reservation_idx`（一意） | `(organization_id, reservation_id)` | 予約 1 件に Web 予約 1 件。台帳から付帯情報を引く |
| `web_bookings_org_public_code_idx`（一意） | `(organization_id, public_code)` | WEB-CANCEL の番号引きと採番衝突検出 |
| `web_bookings_org_store_status_idx` | `(organization_id, store_id, status)` | LEDGER-LIST の「確認待ち 1件」・ALERTS の「Web予約が2件、確認待ちです」 |

**不変条件**
- **生の確認鍵・確認番号を保存しない**（ハッシュだけ）。生値はお客様への控えにだけ載せる。
- **`public_code` は `reservations.code` とは独立した採番**（組織 × `YYMM` 内の 4 桁ゼロ埋め連番、接頭辞 `EY-W-`）。
  モックの Web は `EY-W-2608-0031`、店内は `EY-2608-0142` / `EY-2608-0187` で、
  **同じ連番なら 0031 と 0142 が同じ月に共存しない**ので、採番系統が別であることが読める。
  表示のときだけ `W` を足す案は採れない。`reservations.code` の書式は `EY-YYMM-NNNN` の 1 種類に保つ（§7.1）。
- `web_booking_settings.requires_approval='0'` の店舗では、作成時点で `status='confirmed'` にする。
- `contact_email` が NULL のときは確認メールを送れない。WEB-06-DONE の「確認のメールをお送りしました。」は出さず、
  ご予約番号と確認番号を控えるようお願いする文を画面に出す。
- `status='pending'` のまま **受信日（`created_at` の JST 暦日）の 24:00 JST** を越えたものは自動で取り消す。
  **起算日は受信日であって来店日ではない**（`02-domain-model.md` §3 の W4 と同じ。ALERTS の
  「本日中に確認しないと自動で取り消されます。」は届いた日のうちに確かめてほしいという意味で、
  来店日起算にすると 3 週間先の予約が `pending` のまま ALERTS に居座り、この文言が嘘になる）。
  境界は受信日の 23:59:59.999 JST まで `pending` を許し、翌 00:00:00.000 JST から取り消す。
  取り消しは `reservations.status='cancelled'` / `cancel_reason='store'` と同じ `db.batch()` で書く。

> [要確認: Q-09 — いまの前提で進める]（`design/09-open-questions.md`）。
> いまの前提: `contact_email` を **必須（NOT NULL）** にする。承認制である以上、連絡手段の無いお客様の予約は宙に浮くため。

### 11.3 `alerts`

放っておくと予約に響くものを 1 行 1 件にする。ALERTS 画面の元データ。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 種別コード | `code` | `code` | text | 不可 | 下の 10 値 | ALERTS のモックに出るのは上から 3 件 |
| 強さ | `severity` | `severity` | text | 不可 | `info` \| `action` | `action` が「対応が必要」 |
| 出し先＋ | `audience` | `audience` | text | 不可（既定 `store`） | `store` \| `ops` | `store` は ALERTS の 4 分類に出る。`ops` は運用の失敗（`07-nfr.md` §11.3）で、ALERTS には出さず設定 › 端末とスタッフの下の運用の面にだけ出す |
| 見出し | `title` | `title` | text | 不可 | 1〜60文字 | `録音の保存に3回失敗しました` |
| 本文 | `body` | `body` | text | 可 | 0〜200文字 | `EY-R-1482 田中 花子 様。ご予約は成立しています。` |
| 対象種別 | `target_type` | `targetType` | text | 可 | `recording` \| `reservation` \| `equipment` | |
| 対象ID | `target_id` | `targetId` | text | 可 | 対象表の `id` | 行動ボタンの遷移先 |
| 発生時刻 | `occurred_at` | `occurredAt` | text | 不可 | ISO8601 | |
| 既読 | `read_at` | `readAt` | text | 可 | ISO8601 | 「すべて既読にする」で埋める |
| 解決 | `resolved_at` | `resolvedAt` | text | 可 | ISO8601 | 非 NULL の件数が ALERTS の「対応済み　12」 |
| 解決者 | `resolved_by` | `resolvedBy` | text | 可 | `staff.id` | |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |

`code` の語彙:

| `code` | `severity` | 立てる場面 |
|---|---|---|
| `recording.upload_failed` | `action` | 録音の送信が 3 回続けて失敗した（§8.2）。本文に端末名を入れる |
| `web_booking.pending` | `info` | Web 予約が確認待ちのまま残っている |
| `equipment.maintenance_scheduled` | `info` | 点検の帯と重なる予約がある |
| `store.closed_with_reservations`＋ | `action` | 予約が入っている日を臨時休業・時間短縮にした（対象の予約一覧を添える） |
| `reservation.unclosed`＋ | `action` | 営業終了を過ぎても `status='confirmed'` の予約が残っている（翌朝に片づける） |
| `store.no_shift`＋ | `action` | 今日から 35 日先までのいずれかの営業日に `kind='work'` の勤務が 0 件（Web の受付窓が閉じる前に気づく）。**名前は `store.no_shift`**（`07-nfr.md` §11.3 / §11.4 と同じ綴り。`staff.no_shift` にしない） |
| `web_booking.auto_cancelled`＋ | `info` | 受信日のうちに確かめられず自動で取り消した（§11.2） |
| `notifier.send_failed`＋ | `action` | notifier が 502 を返し、UI のフォールバックも出せなかった。**`audience='ops'`** |
| `org.not_synced`＋ | `action` | `organizations` の行が無い状態（503 `not_synced`）が 15 分続いた。**`audience='ops'`** |
| `d1.capacity_warning`＋ | `action` | D1 が 400MB（500MB の 80%）に達した。**`audience='ops'`** |

下 5 値（`web_booking.auto_cancelled` 以降の 4 値と `store.no_shift`）は `07-nfr.md` §11.3 が足したもので、
そのうち `audience='ops'` の 3 値は**記録としては残すが ALERTS には出さない**。
運用の失敗を業務の「お知らせ」に積むと「対応が必要」の意味が薄まるためである。

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `alerts_org_store_occurred_idx` | `(organization_id, store_id, occurred_at)` | ALERTS の一覧（新しい順） |
| `alerts_org_store_resolved_idx` | `(organization_id, store_id, resolved_at)` | サイドバーの未対応バッジ件数（`resolved_at IS NULL` を数える） |

**不変条件**
- 同じ原因で連打しない。**同じ `code` + `target_id` の未解決行（`resolved_at IS NULL`）があれば新しい行を作らない。**
  Cron の再検知は既存行の `occurred_at` を更新せず、何もしない。
- 通知（notifier への同期送信）は best-effort。失敗しても行の作成は成功させる。
- **件数はすべて `audience='store'` の行だけで数える**（`ops` の行はサイドバーのバッジにも ALERTS の 4 分類にも入れない）。
- 件数の数え方はモック全体で一貫している。サイドバーの「お知らせ　3」＝**未解決行（`resolved_at IS NULL`）の総数**で、
  ALERTS の絞り込みタブがその内訳になる。3 つの数は必ずこの関係を保つ。

  | ALERTS のタブ | 数え方 | モックの値 |
  |---|---|---|
  | すべて | `resolved_at IS NULL` | 3 |
  | アラート（対応が必要） | `resolved_at IS NULL AND severity='action'` | 1（`recording.upload_failed`） |
  | お知らせ | `resolved_at IS NULL AND severity='info'` | 2（`web_booking.pending` / `equipment.maintenance_scheduled`） |
  | 対応済み | **`resolved_at` が本日（JST）** | 12 |

  「対応済み」だけ本日で区切るのは、ALERTS の右ペイン見出しが「本日 8月27日（木）」で、
  左ペインの 4 つの数がその見出しの下にあるため。ほかの 3 つは日付で区切らない（未解決は溜まったまま数える）。
- **バッジの数は全画面で同じ「選択中店舗の未解決総数」。**個人端末でも共有端末でも同じ数を出す。
  HOME-PERSONAL の「2」は「お知らせ」カテゴリだけの数で、**「対応が必要」1 件が落ちている**。
  バッジが対応必須のアラートを隠すのは事故なので採らない。モック画像は直さない。

  行に付く小さな札（ALERTS の「対応が必要」「Web予約」）は `severity` と `code` の両方から作る。
  `severity='info'` の行にも `code` 由来の札が付くので、**札の有無を `severity` の判定に使わない**。

### 11.4 `analytics_daily`

分析 8 タブの元になる唯一の日次集計表。**表示 API は生表を読まず `analytics_daily` だけを読む**。ロールアップ用の
別表（`analytics_rollup_work` を含む）は作らない。

| 論理名 | SQL 列名 | TS 名 | 型 | NULL | 取りうる値 | 説明 |
|---|---|---|---|---|---|---|
| ID | `id` | `id` | text (PK) | 不可 | UUID v4 | |
| 組織ID | `organization_id` | `organizationId` | text | 不可 | | |
| 店舗ID | `store_id` | `storeId` | text | 不可 | | |
| 集計日 | `date` | `date` | text | 不可 | `YYYY-MM-DD` | JST の暦日 |
| 指標 | `metric` | `metric` | text | 不可 | 下表 | |
| 切り口 | `dimension` | `dimension` | text | 不可 | `total` \| `staff` \| `purpose` \| `hour` \| `source` \| `cancellation_category` \| `visit_frequency` \| `wait_seconds` | 「曜日別」「月別」は `date` を表示時にまとめる。率・中央値を保存する次元は持たない |
| 切り口キー | `dimension_key` | `dimensionKey` | text | 不可 | 下表 | `total` は空文字。`staff` は `staff.id`、担当未定は `unassigned`。`purpose` は `visit_purposes.id`、`hour` は `0..23`、`source` は `phone` / `counter` / `web` / `walkin` |
| 切り口表示名 | `dimension_label` | `dimensionLabel` | text | 不可 | 1〜60文字 | 日次集計時点の名称スナップショット。`staff` / `purpose` の無効化・改名後も過去の表示名を残す。固定分類は正式な日本語表示名を持ち、`total` 等も「合計」などを必ず保存する。DDL DEFAULT で空文字を補わない |
| 値 | `value` | `value` | integer | 不可 | 0 以上 | 保存値は件数（整数）。率・中央値は期間の行を読んで計算する |
| 作成日時＋ | `created_at` | `createdAt` | text | 不可 | ISO8601 | |
| 更新日時＋ | `updated_at` | `updatedAt` | text | 不可 | ISO8601 | |

`dimension` の固定キー:

| `dimension` | `dimension_key` |
|---|---|
| `cancellation_category` | `customer` / `store` / `duplicate` / `no_show` / `web` |
| `visit_frequency` | `first` / `second` / `third_to_fifth` / `sixth_or_more` |
| `wait_seconds` | `hour:<0..23>:<seconds>`。同じ受付 JST 時間帯・待ち秒の件数を `value` に保存する |

`metric` の物理語彙と対応する画面:

| `metric` | 意味 | かぞえる日 | 画面 |
|---|---|---|---|
| `closed` | 営業状態 | `date` の JST 暦日 | `total`、営業日 0 / 定休日・臨時休業 1。未来日は**行を書かない** |
| `reservations` | 有効な来店予定件数 | `starts_at` の JST 暦日。`cancelled` / `no_show` を除く | TOP / COUNT（ご来店日）、purpose / hour / source |
| `scheduled_reservations` | 予定総数 | `starts_at` の JST 暦日。取消・no show を含む | 取消率の分母（`total`） |
| `reservations_received` | 受け付けた有効予約件数 | `created_at` の JST 暦日。`cancelled` / `no_show` を除く | COUNT（受付日）、source / purpose / hour |
| `receptions` | 完了来店件数 | `status='done'` の来店日の JST 暦日 | staff / source / visit_frequency / total |
| `cancellations` | 取消・no show 件数 | `starts_at` の JST 暦日 | `cancellation_category` の 5 キーだけ |
| `wait_seconds_histogram` | 受付から相談開始までの待ち秒の度数 | 受付日の JST 暦日 | `wait_seconds`。期間内の度数を合算して厳密中央値を出す |
| `revisit_eligible` | 再来率の分母 | 完了来店日の JST 暦日 | `staff`。担当未定には書かない |
| `revisit_returning_90d` | 再来率の分子 | 完了来店日の JST 暦日 | `staff`。対象来店の前 1〜90 日に同一顧客の完了来店がある件数 |

`reservations` と `reservations_received` を **2 つの `metric` に分ける**のは、ANALYTICS-COUNT が
「かぞえる日　ご来店日／受付日」の 2 択を持つためである。1 つの `metric` を読み替えでは作れない
（同じ予約が別の日に落ちるので、`date` の意味が行ごとに変わってしまう）。

`revisit_eligible` / `revisit_returning_90d` は**現在の完了来店を基準に後ろを待たない**。対象の `done` 来店について、
同じ customer の `done` 来店が **過去 1〜90 日**に 1 件以上あれば分子、対象来店すべてを分母にする
（backward-looking）。よって 90 日後を待たず、日次ロールアップで確定できる。
顧客未特定でも担当が決まっている完了来店は担当者別の分母へ含め、分子は 0 とする。担当未定だけは
担当者別率を出さないため分母・分子のどちらにも書かない。

`wait_seconds_histogram` は中央値を保存しない。期間中の `hour:<hour>:<seconds>` の件数をすべて合算し、
昇順の累積件数が `floor((n + 1) / 2)` と `ceil((n + 1) / 2)` を越える秒を選ぶ。偶数件では両者の平均を取り、
月次・複数月でも**厳密な中央値**を返す。

> [要確認: Q-11 — いまの前提で進める]（`design/09-open-questions.md`）。
> `metric='guests'` は物理語彙に含めず、画面の「名」も出さない。

**index**

| 名前 | 対象列 | どのクエリのため |
|---|---|---|
| `analytics_daily_org_store_date_metric_dim_idx`（一意） | `(organization_id, store_id, date, metric, dimension, dimension_key)` | 日次 upsert の重複防止 |
| `analytics_daily_org_store_metric_date_idx` | `(organization_id, store_id, metric, date)` | 期間指定の読み出し（単月・6か月レンジ） |

ロールアップの入力走査には、既存の `reservations_org_store_start_idx`（来店日）と
`reservations_org_customer_start_idx`（再来の過去 90 日）を使う。受付日と Cron の pending 掃除を範囲走査にするため、
同じマイグレーションで**表を増やさず** `reservations_org_store_created_idx`
`(organization_id, store_id, created_at)` と `web_bookings_status_created_idx` `(status, created_at)` を追加する。

**不変条件**
- 日次ロールアップは生表を **bulk read** し、`json_each(?)` を使う 1 回の JSON bulk upsert で書く。再来判定の入力は対象範囲の開始 90 日前まで広げる。定期実行はcursorの各ページで、店舗ごとに `analytics_daily` の `metric='closed'` のJST昨日以下の最終確定日の翌日から最大31日を再集計する。昨日まで未確定の日が残るページは同じcursorを持ち越し、追いついた店舗はJST昨日〜7日先の通常窓へ戻す。JST昨日までを確定済みとすることで、最大3店舗ずつの次ページでも72店舗超または31日超停止後のforecast行を実績へ上書きできる。
  未来日は予約系だけを作り、`closed` は 0 / 1 を推測せず欠測（行なし）にする。再実行しても同じ一意キーを上書きするため冪等である。
  分析レポート API はこの表だけを読み、生表は読まない。固定値だけを返す targets API の `analytics_daily` 読み取りは 0 件とし、これは D1 全体の read を 0 にする意味ではない（認可の membership 読み取りは別）。
- 定休日も `metric='closed', value=1` の行を作る。読み出し側はこれを予約 0 件の棒に変換し、**「0 件」と「欠測（行なし）」を区別する**。
- 担当者次元はロールアップ時点の店舗スタッフ全員を読み、受付 0 件の担当も `receptions/staff=0` の行と名称スナップショットを残す。
- 小標本抑制は**読み出し側**で行う。**分母が 20 件未満の率**（再来率・取消率）は画面に出さず「—」にし、
  件数だけを出す。再来率は `revisit_returning_90d / revisit_eligible`、取消率は `cancellations / scheduled_reservations` で計算する。閾値を 20 にするのは、ANALYTICS-STAFF の担当者別で
  1 人あたり月 20 件を下回ると率が跳ねるためである。
  `dimension_key='unassigned'`（担当未定）は件数だけを出し、分母が 20 件以上でも再来率は常に「—」にする
  （ANALYTICS-STAFF は 9 件で「—」を描いている）。
- **件数 0 の担当の行は出す**（「その人が 0 件だった」ことが情報）。**受付 0 件の時間帯の棒は出さない**（軸は残す）。
- 担当者系列の表示順は日次snapshotの `dimension_label` の文字列（Unicode）順とし、`unassigned`（担当が未定）だけを最後に置く。reader はstaffマスターを読まない。
- **「1日あたり」の分母は営業日数**（定休日・臨時休業を除く）。暦日数ではない。
  ANALYTICS-COUNT の「8月の合計 320件」「1日あたり」は、2026年8月の営業日 27 日で **320 ÷ 27 = 11.851... → 11.9**。暦日 31 でも 26 日でもない。
  月途中など `closed` が欠測の未来日は、月合計の予約には含めるが「1日あたり」の分子・分母には含めない。
  したがって平均は営業状態行（`closed=0/1`）が確定している日の予約件数 ÷
  `closed=0` の営業日数であり、営業状態未確定の未来予約は分子に含めず、集計済み日数で割って過大表示しない。
- ANALYTICS-CANCEL の積み上げは `analytics_daily` に保存し、読み出し時に生の `reservations` から組み立てない。
  `dimension='cancellation_category'` の層は必ず**排他**にする。

  | 積み上げの層（凡例） | 条件（この順に上から当てる） |
  |---|---|
  | ご来店がなかった (`no_show`) | `status='no_show'` |
  | Webからの取消 (`web`) | `status='cancelled' AND source='web'` |
  | お客様のご都合 (`customer`) | `status='cancelled' AND cancel_reason='customer'` |
  | 店舗の都合 (`store`) | `status='cancelled' AND cancel_reason='store'` |
  | 予約の重複 (`duplicate`) | `status='cancelled' AND cancel_reason='duplicate'` |

  **凡例の文字は CHANGE-CANCEL の 4 択と 1 字も違えない。**モックの「お客様都合」「無断キャンセル」の 3 層に丸めると、
  店舗の都合で店側が取り消した予約が店長の分析画面で「お客様都合」に化ける（`cancel_reason` を持っているのに使わないため）。
  モックの棒は 3 色だが積み上げは本数を増やせる。モック画像は直さない。
- **取消率の分母は `scheduled_reservations`（その日にご来店予定だった予約の総数。取消・無断キャンセルを含む）、分子は上の 5 層の合計。**
  一方、`metric='reservations'`（予約数）には取消を含めない。率と件数で分母をそろえると
  「取り消しても予約数が減らない」ことになり、現場の感覚と合わない。
- **`analytics_daily` は 25 か月保持**（24 か月＋当月）。削除基準日は backfill の `to` ではなく、
  実行時刻から求めた JST 当日に固定する。ANALYTICS-WAIT が「前の月は 7分20秒」を出し、
  前年同月比まで見るため。それより古い行は日次 Cron が消す。

---

## 12. マイグレーションの順序

**表ごと足す**設計を基本にする。**例外は P1 の `stores` だけ**である。
P0（`0000_talented_korvac.sql`）は既に `organizations` / `stores` / `store_memberships` の **3 表**を出荷しており、
`stores` にはモックが要求する列（`name_public` / `nearest_station` / `parking_note` / `intro_text` / `sort_order` /
`updated_at` / `updated_by`）が無く、slug の index も組織内一意（`stores_org_slug_unique_idx`）で張られている。
SQLite の `ALTER TABLE ADD COLUMN` は DEFAULT なしで NOT NULL 列を足せず、規約 8（DDL DEFAULT に意味を持たせない）と
衝突するため、**後から足す列は必ず NULL 可にする**（`organizations.plan` / `is_disabled` と同じ扱い）。
**P0 で出した列の型・NULL 可否・既定値は変えない**（`store_memberships.permissions` も `stores.phone` / `address` /
`access_note` も P0 実装のままにする）。列の型を変えると drizzle-kit がテーブル再作成を出すので、
§13 の手順 3「生成された SQL を必ず目で読む」でそれを見つけたら手で直す。

| フェーズ | feature | 生成される migration | 追加する表 |
|---|---|---|---|
| P0 | `003-service-foundation` | `0000_talented_korvac.sql`（**出荷済み**） | `organizations` / `stores` / `store_memberships` |
| P1 | `004-store-settings` | `0001_*.sql` | **13 表**: `store_business_hours` / `store_blackout_windows` / `store_calendar_exceptions` / `store_slot_rules` / `store_settings_revision` / `staff` / `staff_skills` / `staff_weekly_shifts` / `staff_shifts` / `equipment` / `equipment_maintenance` / `visit_purposes` / `purpose_requirements`。**あわせて `stores` に 7 列を足し、slug の index を張り替える**（下） |
| P2 | `005-availability-and-ledger` | `0002_*.sql` | `reservations` / `reservation_purposes` / `reservation_assignments` / `reservation_slot_locks` |
| P3 | `006-booking-flow` | `0003_*.sql` | `audit_events` / `idempotency_records` / `reception_sessions` |
| P4 | `007-customer-records` | `0004_*.sql` | `customers` / `customer_prescriptions` / `customer_glasses` / `customer_notes` |
| P5 | `008-reception-and-walkin` | `0005_*.sql` | `walk_ins` / `visit_events` |
| P6 | `009-change-and-cancel` | なし | 追加なし（`cancelled_at` / `cancel_reason` / `version` は P2 で作る） |
| P7 | `010-recording` | `0006_*.sql` | `recordings` / `alerts` |
| P8 | `011-web-booking` | `0007_*.sql` | `web_booking_settings` / `web_bookings` |
| P9 | `012-analytics` | `0008_*.sql` | `analytics_daily` |
| P10 | `013-terminals-and-audit` | `0009_*.sql` | `terminals` / `terminal_sessions` |

P1 の `0001_*.sql` が `stores` に対して出す文（生成結果を目で確かめる）:

```sql
-- 足す列はすべて NULL 可（NOT NULL + DEFAULT を DDL に持たせない。規約 8）
ALTER TABLE `stores` ADD `name_public` text;
ALTER TABLE `stores` ADD `nearest_station` text;
ALTER TABLE `stores` ADD `parking_note` text;
ALTER TABLE `stores` ADD `intro_text` text;
ALTER TABLE `stores` ADD `sort_order` integer;
ALTER TABLE `stores` ADD `updated_at` text;
ALTER TABLE `stores` ADD `updated_by` text;
-- slug を組織内一意から全組織横断の一意へ張り替える（§4.1）
DROP INDEX `stores_org_slug_unique_idx`;
CREATE UNIQUE INDEX `stores_slug_idx` ON `stores` (`slug`);
```

`CREATE UNIQUE INDEX` は既存行に重複する `slug` があると失敗するので、**この migration を当てる前に
重複が無いことを確かめる**（seed は 1 組織 3 店舗なので通る）。テーブルの再作成は出さない。

順序の根拠のうち、フェーズ表から自明でないもの:

| 表 | 置いたフェーズ | 理由 |
|---|---|---|
| `audit_events` | **P3** | ブリーフ §7 の P10（`013-terminals-and-audit`）は監査の**閲覧面**と `actor_type` / `terminal_id` の厳密化を担うが、**表そのものは P3 に要る**。§7.1 の不変条件「予約の作成・変更・取消は必ず `db.batch()` で `reservations` / `reservation_purposes` / `reservation_assignments` / `audit_events` をまとめて書く」を満たす最初のフェーズが P3（予約を書く最初のフェーズ）だからである。P5 では HISTORY-LIST の「そのあとの変更」タイムラインが同じ表を読む |
| `reception_sessions` | **P3** | 予約フローの 5 工程の下書き（`draft_json`）の置き場で、それが要るのは P3 である（§8.1。iPadOS の Safari は裏に回ったタブを捨てるので端末に置けない）。受付履歴（P5）と録音（P7）は同じ表を後から読む。`features/006-booking-flow` が新設し、`features/008-reception-and-walkin` は来店受付へ広げるだけにする |
| `alerts` | **P7** | 録音の失敗（`recording.upload_failed`）を立てるのが最初の用途で、それが P7 である。ブリーフ §7 は Web 予約（P8）と同時に置いていたが、P7 の時点で「3 回失敗したらお知らせに上げる」（§8.2）を満たせなくなる。ALERTS の**画面**は P10（`013-terminals-and-audit`） |
| `stores` / `store_memberships` | **P0** | `0000_talented_korvac.sql` が既に作っている（`features/003-service-foundation` は Approved で「3 表を新設」と書いている）。P1 でこの 2 表を作り直さない |
| `reservation_slot_locks` | P2 | 台帳と空き枠エンジンが読む側で先に要る。書く側（予約の確定）は P3 |
| `terminals` | P10 | それより前のフェーズでは `reception_sessions.terminal_id` / `audit_events.terminal_id` / `customers.created_terminal_id` を NULL のままにする |

フェーズをまたぐ NULL の扱い:

| 列 | 作るフェーズ | 参照先ができるフェーズ | それまでの扱い |
|---|---|---|---|
| `reservations.customer_id` | P2 | P4（`customers`） | 常に NULL。P2・P3 のテストは `customer_id IS NULL` の経路（ウォークイン相当）だけを通す |
| `reception_sessions.reservation_id` | P3 | P2 で既にある | 制約なし |
| `recordings.reception_session_id` | P7 | P3 で既にある | 制約なし |
| `*.terminal_id` / `customers.created_terminal_id` | P3・P4 | P10（`terminals`） | 常に NULL |
| `*.created_by` / `*.updated_by` / `*.actor_id`（`staff.id`） | P1 で既にある | P1 | 共有端末で個人未確認なら NULL |

P2 は予約を**読む**だけのフェーズ（空き枠エンジンと台帳）なので、`audit_events` が無くても成立する。
P2 のテストデータは API ではなく直接 INSERT で作る。

## 13. マイグレーションの手順

```sh
# 1. スキーマを編集
#    services/glasses_management/src/worker/db/schema.ts

# 2. SQL を生成（drizzle.config.ts の out == wrangler.jsonc の migrations_dir == ./migrations）
pnpm --filter @app/glasses_management db:generate

# 3. 生成された migrations/NNNN_*.sql を必ず目で読む
#    列の削除・テーブルの再作成が出ていたら手で直す

# 4. ローカル D1 に適用
pnpm --filter @app/glasses_management db:migrate:local

# 5. テストを回す（test/setup.ts が readD1Migrations → applyD1Migrations で全 migration を毎回当てる）
pnpm --filter @app/glasses_management test

# 6. 本番（人間の承認を得てから）
pnpm --filter @app/glasses_management db:migrate:remote
```

- **`drizzle-kit migrate` は使わない。**適用は `wrangler d1 migrations apply` だけ。
- binding や `wrangler.jsonc` を触ったら `pnpm -r cf-typegen` を回す。
- 生成済みの migration ファイルは編集も削除もしない。直すときは新しい migration を足す。

## 14. Drizzle スキーマの雛形

`services/glasses_management/src/worker/db/schema.ts` にそのまま置ける形。代表 3 表だけ示す。
残りの 28 表も同じ書き方（`text` / `integer` / `real`、FK なし、`index` / `uniqueIndex` は配列で返す）に揃える。

```ts
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// D1 は SQLite。全表に共通する決め:
// - FK を宣言しない。参照整合はアプリ層で確かめる。
// - ID は crypto.randomUUID()（v4）。DB 生成 ID を使わない。
// - 全ドメイン行に organization_id を置き、全クエリを JWT の org でスコープする。
// - 真偽値は text の '0' | '1'。日時は UTC の ISO8601 text。日付は 'YYYY-MM-DD'、時刻は 'HH:MM'。
// - DDL DEFAULT に意味を持たせない（既定値はアプリ層で入れる）。
// - 並びは created_at（UUID v4 は k-sortable ではない）。

/** 店舗。業務 API のスコープ単位であり、Web 予約の公開単位でもある。 */
export const stores = sqliteTable(
  'stores',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    // P0（0000_talented_korvac.sql）が NOT NULL DEFAULT '' で出した 3 列。
    // 空文字が「未入力」を表す。型も NULL 可否も変えない（変えると表の再作成になる）。
    phone: text('phone').notNull().default(''),
    address: text('address').notNull().default(''),
    accessNote: text('access_note').notNull().default(''),
    isActive: text('is_active').notNull(), // '0' | '1'
    createdAt: text('created_at').notNull(), // ISO8601 (UTC)
    // ここから下は P1（0001_*.sql）で ALTER TABLE ADD COLUMN する列。
    // 既存行に入る値が無いので、すべて NULL 可にする（規約 8 / §12）。
    namePublic: text('name_public'),
    nearestStation: text('nearest_station'),
    parkingNote: text('parking_note'),
    introText: text('intro_text'),
    sortOrder: integer('sort_order'),
    updatedAt: text('updated_at'),
    updatedBy: text('updated_by'),
  },
  (t) => [
    // ヘッダーの店舗切り替え一覧。
    index('stores_org_created_idx').on(t.organizationId, t.createdAt),
    // /api/public/** は未認証で organization_id を持たないため slug 単独で引く。
    // よって slug は全組織横断で一意でなければならない。
    // P0 は stores_org_slug_unique_idx (organization_id, slug) を張っているので、
    // P1 の migration で DROP INDEX してからこれを張り直す（§12）。
    uniqueIndex('stores_slug_idx').on(t.slug),
  ],
)

/** 予約の本体。台帳・検索・変更・分析のすべてがこの表を軸にする。 */
export const reservations = sqliteTable(
  'reservations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    code: text('code').notNull(), // 'EY-YYMM-NNNN'（1 書式。Web の対客番号は web_bookings.public_code）
    customerId: text('customer_id'), // ウォークインは NULL のまま確定できる
    source: text('source').notNull(), // 'phone' | 'counter' | 'walkin' | 'web'
    status: text('status').notNull(), // 'confirmed' | 'arrived' | 'serving' | 'done' | 'cancelled' | 'no_show'
    startsAt: text('starts_at').notNull(), // ISO8601 (UTC)
    endsAt: text('ends_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    noteCustomer: text('note_customer'),
    noteInternal: text('note_internal'),
    version: integer('version').notNull(), // 楽観ロック。UPDATE ... WHERE version=? が 0 行なら 409
    createdAt: text('created_at').notNull(), // ANALYTICS-COUNT の「受付日」
    updatedAt: text('updated_at').notNull(),
    createdBy: text('created_by'),
    cancelledAt: text('cancelled_at'),
    cancelReason: text('cancel_reason'), // 'customer' | 'store' | 'duplicate' | 'no_show'
  },
  (t) => [
    // 台帳 1 日分と、空き枠エンジンの重なり判定。
    index('reservations_org_store_start_idx').on(t.organizationId, t.storeId, t.startsAt),
    // 予約番号での検索と、YYMM 連番の採番衝突検出。
    uniqueIndex('reservations_org_code_idx').on(t.organizationId, t.code),
    // LEDGER-LIST の絞り込み（すべて／これから／確認待ち）。
    index('reservations_org_store_status_start_idx').on(
      t.organizationId,
      t.storeId,
      t.status,
      t.startsAt,
    ),
    // 顧客詳細の「次のご予約」と来店回数の再計算。
    index('reservations_org_customer_start_idx').on(t.organizationId, t.customerId, t.startsAt),
  ],
)

/** 担当と設備の押さえ。target_id が NULL（あとで決める）でも枠は消費する。 */
export const reservationAssignments = sqliteTable(
  'reservation_assignments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    reservationId: text('reservation_id').notNull(),
    kind: text('kind').notNull(), // 'staff' | 'equipment'
    targetId: text('target_id'), // NULL = 未定。空き枠エンジンはこの行も重なりとして数える
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 「この担当／この設備はその時間帯に空いているか」。
    index('reservation_assignments_org_target_start_idx').on(
      t.organizationId,
      t.kind,
      t.targetId,
      t.startsAt,
    ),
    // 予約詳細と変更差分（CHANGE-DIFF）。
    index('reservation_assignments_org_reservation_idx').on(t.organizationId, t.reservationId),
  ],
)
```

## 15. 保持期限とデータ削除

| データ | 最低保持 | 削除の仕方 | 実行者 |
|---|---|---|---|
| `recordings`（成立予約） | `state='stored'` から **30日** | `retain_until` 経過かつ `legal_hold='0'` のとき R2 のオブジェクトを削除し、行は `state='deleted'` / `deleted_at` を書く | 日次 Cron |
| `recordings`（破棄受付） | `state='stored'` から **24時間** | 同上 | 日次 Cron |
| `recordings`（`legal_hold='1'`） | 無期限 | 保全を外すまで削除しない | — |
| `audit_events` | **400 日** | 追記専用のまま、`occurred_at` が 400 日より古い行を物理削除する | 日次 Cron |
| `visit_events` | 無期限 | **削除しない**（追記専用） | — |
| `customers`（統合された行） | 無期限 | **削除しない**。`merged_into_id` を書き、検索・一覧から外す。`customer_number`（お客様番号）は再利用しない | 統合操作 |
| `idempotency_records` | 24時間 | `expires_at` 経過で**物理削除** | 日次 Cron |
| `terminal_sessions` | `revoked_at` / `expires_at` から 30日 | **物理削除**（誰がいつ操作したかは `audit_events` に残る） | 日次 Cron |
| `analytics_daily` | **25 か月**（24 か月＋当月） | 期限を過ぎた `date` の行を物理削除する | 日次 Cron |
| ほかのドメイン表 | 無期限 | 物理削除しない。`is_active='0'` / `status` で落とす | — |

**削除の拒否**
- `now < retain_until` または `legal_hold='1'` の録音に削除要求が来たら 409 `recording_retained` を返す（`04-api.md` §5）。
  共有端末からは削除操作そのものを出さない（MODE-PERSONAL のとおり「録音の保全」は個人モード昇格が要る）。
- R2 のオブジェクトを消してから D1 の `state` を書く。逆順にすると、行だけ `deleted` で実体が残る。
  途中で落ちた場合は次回の Cron が `state='deleted'` かつ R2 に実体がある行を拾って消し直す。

**容量の見積り（D1 500MB / ops は 400MB で警告）**

| 見積り対象 | 1 件あたり | 1 年（3 店舗 × 12 件/日） |
|---|---|---|
| `reservations` + `reservation_purposes` + `reservation_assignments` + `audit_events` | 約 2KB | 約 26MB |
| `visit_events`（1 来店 6 行） | 約 0.6KB | 約 8MB |
| `customer_notes`（本文とキーだけ） | 約 0.3KB | 約 2MB |

**手書きの SVG（1 枚 3〜12KB・1 顧客 5 枚まで）は R2 に置くので D1 の見積りに入らない**（§9.4）。
D1 に置いたままだと 5 枚 × 5,000 顧客で約 300MB となり、500MB の 6 割を手書きだけで占める。
年 40MB 前後に収まるのはこの前提のうえでのことである。

---

## 16. 残した確認事項

**発注元（EYEX）に聞かないと決められないもの**。ここに挙げた 3 件以外の論点は、本文で決めて `[要確認]` を落とした。
3 件はいずれも `design/09-open-questions.md` の問いに対応する（新しい問いを足していない）。

| # | 箇所 | 内容 | 止まるフェーズ |
|---|---|---|---|
| 1（**Q-03**） | `customers` §9.1 | 録音を聞くこと・お客様をおまとめすること・他店で書かれた履歴を読むことを、店長だけに絞るか。admin が配る `customer.history` / `recording.read` をサーバ側で強制するか（`04-api.md` §2.2 と同じ問い）。**暫定は「強制する」** | P4 |
| 2（**Q-11**） | `analytics_daily` §11.4 | 1 予約に複数名がありうるか。ありうるなら人数が設備の台数と所要時間にどう効くか。**暫定は「`metric='guests'` を落とす」** | P9 |
| 3（**Q-09**） | `web_bookings.contact_email` §11.2 | Web 予約でメールアドレスを必須にしてよいか。**暫定は「必須」**（NOT NULL） | P8 |

**この文書で決着させたもの**（人間の追認は要るが、実装は止めない）:

| 箇所 | 論点 | 採った値 |
|---|---|---|
| §2 / §7.6 | 枠の二重確保。「同じ `db.batch()` の中で読み直して判定する」は D1 では書けない | **`reservation_slot_locks` を足し、刻み単位の占有行で止める**（ブリーフ §3 に無い表の追加） |
| §7.6 | 一意 index は「1」しか表現できず、`equipment.capacity` / `staff.max_parallel_reservations` / 担当未定レーンの上限（`store_slot_rules.max_parallel`）が 3 つとも 1 に潰れる。ウォークインの 2 人目が受け付けられなくなる | **一意 index をやめ、上限つきの条件付き INSERT（`INSERT ... SELECT ... WHERE NOT EXISTS (…上限判定…)`）にする**。発火の有無は `meta.changes` で読む |
| 規約 14 / §4.6 / §7.1 | 0 行の `UPDATE` は `db.batch()` を止めない（D1 実測）。版の条件を 1 文だけに付けると、409 を返しながら相手の変更を巻き戻す・占有行だけ消して二重予約を作る | **版の条件をバッチの全文に配り、版を +1 する文を最後に置く**。409 のとき 1 行も書き換わっていないことをテストで固定する |
| §7.3 | 仮の押さえの KV キーが 3 文書で違い、どの形も「空き枠エンジンが読む」と「`holdId` で消す」を両立しない | **`hold:{organizationId}:{storeId}:{holdId}` の 1 通りにし、枠は `metadata` に持たせて `KV.list` で読む**。公開面では KV を読まない（list は 1,000 回/日） |
| §3.1 / §3.2 / §12 | 出荷済みの `0000_talented_korvac.sql` と文書の食い違い（`revision` の型・`permissions` の持ち方・P0 の表数） | **P0 実装に寄せる**（`revision` は `text`・NULL 可、`permissions` は空白区切り、P0 は 3 表）。P1 は `stores` への列追加と slug の index の張り替えだけを行い、表を作り直さない |
| §4.1 | `stores.sort_order` を 5 文書が使うのに列が無い | **`sort_order`（integer・P1 で足すので NULL 可）を足す**（ブリーフ §3 に無い列の追加） |
| §9.1 | お客様番号の列名が `code` と `customer_number` の 2 通りある | **`customer_number`**（`00_service-spec.md` と `features/007-customer-records` の綴り。`reservations.code` / `recordings.code` と紛れない） |
| §11.1 | Web 予約の変更・取消の締切が「前日 23:59」と「営業終了時刻」の 2 通りある | **`change_deadline_days`（integer・既定 1）を足し、締切を「来店日 −N 日の 23:59:59.999 JST」に固定する**（ブリーフ §3 に無い列の追加） |
| §11.3 | 運用の失敗（notifier・同期・容量）を業務の ALERTS に混ぜると「対応が必要」の意味が薄まる | **`audience`（`store` / `ops`）を足し、`code` を 11 値に広げる**（`07-nfr.md` §11.3 に合わせ、名前は `store.no_shift`）。ブリーフ §3 に無い列の追加 |
| §8.2 / §9.4 | 手書き SVG を録音と同じ R2 バケットに置くと用途が 2 つになる | **binding は `RECORDINGS` のまま、キーの前置で分ける**（`recordings/` と `notes/`）。決定ブリーフ §1 の binding 一覧を増やさない |
| §15 | 監査ログの保持が「無期限」と「400 日」で食い違う | **400 日**（`07-nfr.md` §8 が容量見積りと境界値テストまで書き下している唯一の値） |
| §12 | `reception_sessions` のフェーズが P3 と P5 で食い違う | **P3**（予約フローの下書きの置き場が最初の用途。`features/006-booking-flow` が新設する） |
| §2 / §4.5 | 受付を止める時間帯が 3 帯あるのに `store_business_hours` は 1 帯しか持たない | **`store_blackout_windows` を足す**（ブリーフ §3 に無い表の追加）。`break_start` / `break_end` は使わない |
| §2 / §4.6 | `version` を持たない設定 7 表の競合検出 | **`store_settings_revision` を足し、店舗単位の 1 版に集約する**（ブリーフ §3 に無い表の追加） |
| §2 / §5.6 | 曜日グリッドで編集する勤務を日付表だけで持つと、62 日先で全担当が勤務外になる | **`staff_weekly_shifts`（曜日テンプレート）を正本にし、`staff_shifts` は 62 日先までの展開結果にする**（ブリーフ §3 に無い表の追加） |
| §3.2 | admin が配る `StorePermission` の保存先 | **`store_memberships`**（ブリーフ §12.4 で確定済み） |
| §4.5 | SETTINGS-HOURS の「お昼 13:00–14:00」 | **12:00–13:00**（BOOK-01 / WEB-03 が 12 時台を 1 枠も出さず、LEDGER-STAFF / EX-OFFLINE は 13:00 に予約を置いている） |
| §4.4 | 「木曜日に最後にお受けできるのは 18:20 です。」の算出式 | 式を持たない。**空き枠エンジンが返す最後の枠の開始時刻をそのまま出す** |
| §5.1 `staff` | 店長の氏名。モックは `山田 大輔（店長）`、ブリーフ §11 は `高橋 慎輔（店長）` | **モック（`山田 大輔`）**。8 面がそろって描いており（ANALYTICS-STAFF / BOOK-04d-HANDWRITE / EX-PERMISSION / HISTORY-LIST / LOGIN-STAFF / MODE-PERSONAL / SETTINGS-STAFF / SETTINGS-STORE）、ブリーフ §12.3 が §11 を訂正したのと同じ扱い |
| §5.4 `equipment` | 設備の初期セット。ブリーフ §11 は 5 件 | 決定ブリーフ **§12.3** の 7 件。フィッティング台の `kind` は `counter`、`role_label` は `フィッティング` |
| §5.5 `equipment_maintenance` | 視力測定機 B の点検日。SETTINGS-EQUIPMENT は 8月28日、ALERTS は 8月30日 | SETTINGS-EQUIPMENT（8月28日 10:00–12:00） |
| §5.6 | 営業時間の外にはみ出す勤務 | **拒まず警告だけ出す**（承認済みモックの seed 自身がはみ出している） |
| §6.1 `visit_purposes` | 目的マスタ 6 件の seed。ブリーフ §11 は `フィッティング(30)` を含む | **モックの 6 件**（`コンタクトの相談(40)` を含む）。`フィッティング` は技能であって目的ではない |
| §6.1 | 目的名の表記。LEDGER-WALKIN は「メガネを調整したい」、BOOK-02 は「今のメガネを調整したい」 | `name_internal` を `今のメガネを調整したい` に正規化 |
| §6.1 | 台帳・一覧に出す短い名前 | **`name_short` を足す**（1〜5 文字・NOT NULL）。SETTINGS-PURPOSE にモックの無い入力欄が 1 つ増える |
| §7.1 `reservations.code` | ブリーフ §3 は `EY-YYMM-NNNN` のみ。WEB-06 / WEB-CANCEL は `EY-W-2608-0031` | **`reservations.code` は `EY-YYMM-NNNN` の 1 書式**。Web の対客番号は `web_bookings.public_code` に分ける |
| §7.1 `reservations.source` | ブリーフ §3 の enum は 3 値だが、EX-OFFLINE は 4 語を出し分ける | **`counter`（店頭）を足して 4 値** |
| §7.4 `walk_ins` | ウォークインが枠を押さえないので、同じ担当を電話予約と取り合える | **受付と同時に `source='walkin'` の予約を 1 件起こす**（表は増やさない） |
| §7.4 `walk_ins.status` | 02 は `abandoned`、03 / 04 は `left` を挙げていた | **`waiting` / `serving` / `booked` / `left` の 4 値**。「待たずにお帰り」は `waiting → left` の遷移で数える |
| §7.5 `visit_events.stage` | RECEPTION-JOURNEY の 6 列に対して値が 1 つ足りない | **`handover`（お渡し）を足して 8 値**。`left` は退店 |
| §9.1 `customers` | 電話番号の後方一致は index が効かない | **`phone_last4` を足し、前方一致（`phone_normalized`）と下 4 桁一致（`phone_last4`）の 2 本にする** |
| §9.4 `customer_notes` | 手書き SVG を D1 に置くと 5,000 顧客で 300MB | **R2 に置き、`handwriting_key` だけを D1 に持つ。1 顧客 5 枚まで** |
| §11.4 `analytics_daily` | ANALYTICS-CANCEL の 3 分類が「店舗の都合」「予約の重複」を「お客様都合」に混ぜる | **`cancel_reason` と source から `cancellation_category` の 5 層へ日次保存する**。凡例は CHANGE-CANCEL の 4 択と同じ文字にする |
