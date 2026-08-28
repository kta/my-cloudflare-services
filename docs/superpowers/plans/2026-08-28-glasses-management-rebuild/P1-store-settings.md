# P1 店舗の受付条件 — TODO

- spec: [`specs/glasses_management/features/004-store-settings/spec.md`](../../../../specs/glasses_management/features/004-store-settings/spec.md)
- 依存: P0
- 状態: 未着手
- 目的: 店長が「いつ・誰が・どの設備で・どのご用件を受けられるか」を 6 面で決められるようにし、
  保存が既にあるご予約に響くときは保存の前に件数を数えて見せる。この 6 面が P2 以降の空き枠と台帳の入力になる。

---

## この TODO 全体で守る決め

書きながら迷ったらここへ戻る。**spec と設計文書が食い違ったら feature spec を正とする。**

| # | 決め | 根拠 |
|---|---|---|
| 1 | 第2サイドバーに出すのは **6 項目**（店舗の情報 / 営業日 / 営業時間 / ご来店の目的 / スタッフと技能 / 設備と点検）。「公開」は P8 が足す。モックが描く残り 8 項目は行ごと出さない | 006 §2 ／ 押せて何も起きない行き先を置かない |
| 2 | 編集を捨てるボタンの文字は **`変更を捨てる`**。`キャンセル` は画面に出さない（予約の「取り消し」と取り違えるため）。AC-SET-03 の「キャンセル」は操作の意味を指す | 007 §6(d) |
| 3 | 保存を拒む文は **「〜のため保存できません。〜を直してください。」の 2 文**。保存できたら `role="status"` で **「保存しました」**、落ちたら **「保存できませんでした。入力はそのまま残っています。」** | 005 §7.3 |
| 4 | 保存を拒むのは 3 つだけ — 閉店 ≤ 開店 / 止める帯が営業時間の外 / 紹介文 201 文字以上。**それ以外はすべて警告を出して通す**（刻み < 片付け・技能 0 人・資源 0 台・勤務が営業時間外） | AC-SET-05 / AC-SET-12 / 006 IDX-SET-10 E1 |
| 5 | 版は **`store_settings_revision` の 1 本**。版の条件を `db.batch()` の**全文**に `WHERE EXISTS` で配り、`version` を +1 する文を**最後**に置く。409 の判定は最後の文の `meta.changes === 0` | 003 §4.6 |
| 6 | お昼の止める帯は **12:00–13:00**。SETTINGS-HOURS の「13:00–14:00」（2 か所）はモックの誤記。モック画像は直さない | 003 §4.5 |
| 7 | スタッフ 6 人目は **山田 大輔（店長）**。マスタープラン §5 の「高橋 慎輔（店長）」は誤り | 004 spec HOW ／ 003 §5.1 |
| 8 | ご来店の目的は **6 件**（コンタクトの相談 40 分を含む）。**フィッティングは目的ではなく技能**。マスタープラン §5 の目的表は誤り | 004 spec HOW ／ 003 §6.1 |
| 9 | 設備・場所は **DB 7 行**（1 台 1 行）。SETTINGS-EQUIPMENT が「相談カウンター 1・2」を 1 行に描いているのは**表示側のまとめ**で、まとめる条件は「`kind` と `role_label` が同じで、名前が同じ前置き＋末尾の連番だけ違う 2 行以上」。まとめた結果を「設備と場所　6件」と数える。1 台しか無い行（加工室・フィッティング台）はまとめない | 003 §5.4 |
| 10 | 個人モード（ご本人の確認）は **P10**。P1 が強制するのは `settings.manage` だけ | 004 §2.2 ／ 013 spec |
| 11 | EX-PERMISSION に **「この下書きを店長に依頼する」を出さない**。`[要確認: Q-10]`。いまの前提＝承認は要るが、依頼の受け取り先が未定なので押せて何も起きないボタンを作らない | 009 Q-10 |
| 12 | `purpose_requirements` の必要数は **固定**（人数に比例させない）。`[要確認: Q-11]`。いまの前提＝`metric='guests'` を落とす | 009 Q-11 |
| 13 | 既存データの取り込み口（一括投入の API・画面）を**作らない**。初期値は `seed.mjs` で入れる。`[要確認: Q-12]` | 009 Q-12 |
| 14 | 触れるものは 44pt 以上。モックが 44pt を割る 2 つ（カレンダーの丸 40px / つまみ 51×31px）は**見た目を変えず当たり判定だけ広げる**（丸は `::before { inset: -2px }`、つまみは行全体 52pt を `role="switch"`） | 007 §2.1 / §2.3 |
| 15 | 色・寸法は `packages/ui/src/theme.css` のトークン経由のみ。Tailwind 既定パレットと任意値を書かない | ルール 5 |
| 16 | 「メガネを新しく作る」の seed の所要は **60 分**（003 §6.1 が正本）。AC-SET-15 の「50分から 60分に変える」は、テスト側で**先に 50 分を保存してから 60 分へ戻して**作る。**seed を 50 分にしない**（一覧が 60 分を出すモックと食い違うため） | 003 §6.1 ／ AC-SET-15 |

---

## T-001 追加するものの承認を取る（規約 10）

- **目的**: 決定ブリーフ §3 とフェーズ表に無い追加を、着手前に人に通す。承認が出るまで T-004 に入らない。
- **触るファイル**: なし（人への提案文だけ）
- **先に書くテスト**: なし
- **提案する 4 件**
  1. `store_blackout_windows`（表を新設）— `store_business_hours.break_start` / `break_end` の 1 帯では
     SETTINGS-HOURS の「＋ 止める時間帯を足す」が成立しない。銀座店は 1 日 3 帯を持つ。
  2. `store_settings_revision`（表を新設）— 設定 6 面の楽観ロックを 1 本にまとめる。7 表を個別に版管理すると
     1 画面の保存が 7 本の版比較になる。
  3. `stores.sort_order`（列を追加）— `00_service-spec.md` / 05 / 06 / 011 が既に使っているのに 03 §4.1 に列が無い。
  4. **`reservations` / `reservation_purposes` / `reservation_assignments` の 3 表を P1 へ前倒しする**（読み取り専用の器として作る。
     書き込み経路は P3 が足す）— `03-data-model.md` §12 のフェーズ表は P2 に置いているが、
     AC-SET-13（止めると影響するご予約 3 件）/ AC-SET-14（0 件なら赤くしない）/ AC-SET-15（受けられなくなる Web 枠 2 件）は
     予約の行が無いと 1 本も通らない。**代案**: 影響カードを P1 で作らず、AC-SET-13 / 14 / 15 を P2 の spec へ移す。
- **実装**: 無し（コードを 1 行も書かない。返事が来るまで T-004 に入らない）。
- **返事の使い方**（あとのタスクがこの分岐を読む）
  - **承認 4 が通ったとき** — T-004 は 13 表ではなく **16 表**を作り（`reservations` / `reservation_purposes` /
    `reservation_assignments` を読み取り専用の器として足す）、`0001_*.sql` の `CREATE TABLE` は 16 本になる。
    T-007 / T-008 / T-010 / T-018 / T-019 はそのまま進める。
  - **代案を採ったとき** — T-004 は 13 表のまま。**T-010（影響の試算）と、T-007 の
    `settings-impact.time.test.ts` 9 本、T-018 / T-019 の影響カードのテスト 5 本を P2 へ送る。**
    あわせて 004 spec から AC-SET-13 / 14 / 15 を落として 005 spec へ移し、T-020 の対応付けを 36 → 33 に減らす。
- **完了条件**: 4 件それぞれに「承認」か「代案を採る」の返事が付いた。進捗台帳にその返事を書いた。
- **依存**: なし

## T-002 契約を書く①（店舗・営業時間・営業日・予約の間隔）（Red）

- **目的**: 6 面のうち 3 面が使う入出力の形と境界値を Zod で 1 か所に決める。
- **触るファイル**
  - `packages/contracts/src/glasses_management.ts`（追記）
  - `packages/contracts/src/index.ts`（re-export を足す）
  - `packages/contracts/test/glasses_management.contract.test.ts`（追記）
- **先に書くテスト**（`pnpm --filter @app/contracts test`）
  - `LocalTime` > `10:00 と 23:59 を通し、24:00 と 9:00 を落とす`
  - `LocalDate` > `2026-08-27 を通し、2026-8-7 を落とす`
  - `Weekday` > `0 と 6 を通し、-1 と 7 と 3.5 を落とす`
  - `StoreDetail` > `slug は 2 文字ちょうどと 40 文字ちょうどを通し、1 文字と 41 文字を落とす`
  - `StoreDetail` > `namePublic / nearestStation / parkingNote / introText は null を取る（未入力）`
  - `StorePatch` > `introText は 200 文字ちょうどを通し、201 文字を落とす`
  - `StorePatch` > `version を欠いた本文を落とす（楽観ロックを外させない）`
  - `StorePatch` > `知らないキーが混ざった本文を落とす`
  - `BusinessHoursInput` > `7 行ちょうどを通し、6 行と 8 行を落とす`
  - `BusinessHoursInput` > `同じ weekday を 2 行入れた本文を落とす`
  - `BusinessHoursRow` > `isClosed=false で closesAt <= opensAt の行を落とす`
  - `BusinessHoursRow` > `isClosed=true なら opensAt と closesAt は null でなければならない`
  - `BlackoutWindowInput` > `startsAt < endsAt を要求し、同時刻を落とす`
  - `BlackoutWindowInput` > `label は 1 文字ちょうどと 20 文字ちょうどを通し、0 文字と 21 文字を落とす`
  - `SlotRulesInput` > `slotMinutes は 5 と 120 を通し、4 と 121 を落とす`
  - `SlotRulesInput` > `cleanupMinutes は 0 と 60 を通し、-1 と 61 を落とす`
  - `SlotRulesInput` > `maxParallel は 1 と 20 を通し、0 と 21 を落とす`
  - `SlotRulesView` > `lastAcceptableAt は曜日 0..6 の 7 件で、休みの曜日は null を取る`
  - `CalendarExceptionInput` > `kind='special' は opensAt と closesAt の両方を要求する`
  - `CalendarExceptionInput` > `kind='closed' は opensAt と closesAt を持てない`
  - `CalendarExceptionQuery` > `from から to までが 92 日ちょうどを通し、93 日を落とす`
- **実装**: `LocalDate` / `LocalTime` / `Weekday` / `Version` の原始型と、
  `StoreDetail` / `StorePatch` / `BusinessHoursRow` / `BusinessHoursView` / `BusinessHoursInput` /
  `BlackoutWindow` / `BlackoutWindowInput` / `CalendarException` / `CalendarExceptionInput` /
  `CalendarExceptionQuery` / `SlotRules` / `SlotRulesInput` / `SlotRulesView` / `DeletedResult`。
  綴りは `04-api.md` §4.3 と `03-data-model.md` の列名に合わせる（`publicName` / `intro` / `maxParallelReservations` の
  短縮などの別名を作らない）。既存の `Store` は `name` を `1..60`、`slug` を `2..40` に狭める
  （seed の 3 店舗が収まることを先に確かめる）。
- **完了条件**: 21 本が緑。`packages/contracts` のカバレッジ 4 指標 80% 以上。
- **依存**: なし

## T-003 契約を書く②（スタッフ・設備・目的・影響試算）（Red）

- **目的**: 残る 3 面と、3 面が共有する影響試算の形を決める。
- **触るファイル**: T-002 と同じ 3 ファイル
- **先に書くテスト**（`pnpm --filter @app/contracts test`）
  - `SkillCode` > `6 値ちょうどで、eye_exam のような別名を落とす`
  - `StaffMember` > `role は staff と manager の 2 値で、既定は staff`
  - `StaffMember` > `maxParallelReservations は 1 と 5 を通し、0 と 6 を落とす。既定は 1`
  - `StaffMember` > `pinHash を持たない（PIN のハッシュを外へ出さない）`
  - `StaffSkillsInput` > `0 件を通し、同じ技能を 2 回入れた本文を落とす`
  - `StaffShiftsInput` > `weekly は 7 行ちょうどで、6 行と 8 行を落とす`
  - `StaffShiftsInput` > `isOff=false の行は startsAt < endsAt を要求する`
  - `StaffShiftsInput` > `休憩は startsAt と endsAt の両方があるか、両方無いかのどちらかである`
  - `StaffShiftQuery` > `from から to までが 62 日ちょうどを通し、63 日を落とす`
  - `EquipmentKind` > `measure / counter / workbench の 3 値だけを取る`
  - `Equipment` > `capacity は 1 と 10 を通し、0 と 11 を落とす`
  - `Equipment` > `roleLabel は 1 文字ちょうどと 20 文字ちょうどを通す`
  - `Equipment` > `ledgerDisplay は grey と hide の 2 値`
  - `EquipmentMaintenanceInput` > `startsAt < endsAt を要求し、同時刻を落とす`
  - `VisitPurpose` > `nameShort は 1 文字ちょうどと 5 文字ちょうどを通し、6 文字を落とす`
  - `VisitPurpose` > `durationMinutes は 5 の倍数だけを取り、25 を通し 26 を落とす`
  - `PurposeRequirementsInput` > `kind='skill' は 1 行まで、kind='equipment_kind' は 2 行までを通す`
  - `PurposeRequirementsInput` > `skill が 2 行、equipment_kind が 3 行の本文を落とす`
  - `PurposeRequirementsInput` > `kind='skill' の value に equipment_kind の値を入れた本文を落とす`
  - `PurposeOrderInput` > `重複した purposeId を落とす`
  - `SettingsImpactRequest` > `kind ごとに draft の形が変わる（equipment_stop / purpose_duration / business_hours）`
  - `SettingsImpactReport` > `severity は影響 0 件のとき info、1 件以上のとき action`
  - `SettingsImpactItem` > `label は 1 文字ちょうどと 80 文字ちょうどを通す`
- **実装**: `SkillCode` / `StaffMember` / `StaffMemberInput` / `StaffMemberPatch` / `StaffSkillsInput` /
  `StaffShift` / `StaffShiftQuery` / `StaffShiftsInput` / `StaffListQuery` / `EquipmentKind` / `Equipment` /
  `EquipmentInput` / `EquipmentPatch` / `EquipmentListQuery` / `EquipmentMaintenance` /
  `EquipmentMaintenanceInput` / `MaintenanceQuery` / `VisitPurpose` / `VisitPurposeInput` /
  `VisitPurposePatch` / `PurposeRequirement`（discriminated union）/ `PurposeRequirementsInput` /
  `PurposeOrderInput` / `PurposeListQuery` / `SettingsImpactRequest`（`kind` の discriminated union）/
  `SettingsImpactReport` / `SettingsImpactItem`。
  `StaffPinInput` / `PinSetResult` は**この面では作らない**（PIN の再設定は P10）。
- **完了条件**: 23 本が緑。カバレッジ 4 指標 80% 以上。
- **依存**: T-002

## T-004 13 表を書き、`stores` に 7 列を足し、slug の index を張り替える（Red → Green）

- **目的**: D1 の形を固定し、index が「実際に投げるクエリの形」に合っていることをテストで押さえる。
- **触るファイル**
  - `services/glasses_management/src/worker/db/schema.ts`
  - `services/glasses_management/test/schema.test.ts`
  - `services/glasses_management/migrations/0001_*.sql`（生成物）
- **先に書くテスト**（`getTableConfig` で index の名前と対象列を見る。`pnpm --filter @app/glasses_management test`）
  - `stores` > `お客様に見せる名前・道順・紹介文・並び順・更新者の 7 列を持ち、すべて NULL 可`
  - `stores` > `slug は全組織横断で一意（公開ページが組織を知らずに引く）`
  - `store_business_hours` > `組織・店舗・曜日で 1 行に決まる`
  - `store_blackout_windows` > `1 日分の帯を開始時刻順にまとめて引ける`
  - `store_calendar_exceptions` > `同じ店舗の同じ日に 2 行を作れない`
  - `store_slot_rules` > `1 店舗 1 行（2 行目を DB 側で禁じる）`
  - `store_settings_revision` > `1 店舗 1 行で、version を持つ`
  - `staff` > `台帳の行順（組織・店舗・並び順）で引ける`
  - `staff` > `個人ログインのために adminUserId から引ける`
  - `staff_skills` > `同じ技能を 2 回付けられない`
  - `staff_skills` > `「この技能を持つ担当は誰か」を店舗で絞って引ける`
  - `staff_weekly_shifts` > `同じ適用開始日に同じ曜日の 2 行を作れない`
  - `staff_shifts` > `台帳の 1 日分と、担当ひとりの 1 日分の両方を引ける`
  - `equipment` > `台帳の行順と、種別での絞り込みの 2 つを引ける`
  - `equipment_maintenance` > `店舗の 1 日分と、設備ごとの次の点検を引ける`
  - `visit_purposes` > `一覧の並び順と、Web 公開だけの絞り込みを引ける`
  - `purpose_requirements` > `同じ要求を 2 回書けない`
  - `外部キー` > `13 表のどれも外部キーを宣言していない`
- **実装**
  - 13 表を `03-data-model.md` §4.2〜§6.2 の列名・型・NULL 可否のとおりに書く。
    真偽値は `'0'|'1'` の text、日付は `'YYYY-MM-DD'`、時刻は `'HH:MM'`、日時は ISO8601 の text、
    分・件数・並び順は integer。FK を宣言しない。DDL の DEFAULT に意味を持たせない。
  - `stores` に足す 7 列（`name_public` / `nearest_station` / `parking_note` / `intro_text` /
    `sort_order` / `updated_at` / `updated_by`）は**すべて NULL 可**。
    SQLite の `ALTER TABLE ADD COLUMN` は DEFAULT なしの NOT NULL を足せない。
  - **P0 が出した列の型・NULL 可否・既定値を変えない**（`phone` / `address` / `access_note` の
    `NOT NULL DEFAULT ''` と `store_memberships.permissions` はそのまま）。
  - **T-001 の承認 4 が通ったときだけ**、`reservations` / `reservation_purposes` /
    `reservation_assignments` の 3 表も同じ `0001_*.sql` で作る（列は `03-data-model.md` §7.1〜§7.3 のまま。
    読み取り専用の器で、書き込み経路は P3 が足す）。**そのときは 16 表**になり、
    schema テストに `reservations` > `組織・店舗・開始時刻で 1 日分を引く index を持つ` を 1 本足して 19 本にする。
    代案を採ったときは 13 表のままで、T-010 と影響カードは P2 へ送る。
- **手順**: 編集 → `pnpm --filter @app/glasses_management db:generate` →
  **生成された `0001_*.sql` を目で読む** → `db:migrate:local`
  - 期待する文: `ALTER TABLE stores ADD ...` が 7 本、`DROP INDEX stores_org_slug_unique_idx`、
    `CREATE UNIQUE INDEX stores_slug_idx ON stores (slug)`、`CREATE TABLE` が 13 本
    （承認 4 が通ったときは 16 本）。
  - **テーブルの再作成（`__new_stores` への移し替え）が出ていたら手で直す。**
    P0 の `0000_talented_korvac.sql` が作った 3 表を壊してはならない。
- **完了条件**: 18 本（承認 4 が通ったときは 19 本）が緑。`0001_*.sql` にテーブル再作成が 1 つも無い。
  `test/setup.ts` が全 migration を当てられる。
- **依存**: T-001, T-003

## T-005 権限マトリクスに設定の行を足す（Red）

- **目的**: 設定の書き込みは店長だけ、読み取りは店舗の誰でも、という線をサーバ側で固定する。
  401（期限切れ）と 403（権限不足）を取り違えないことも同じ表で押さえる。
- **触るファイル**
  - `services/glasses_management/test/permissions.test.ts`（`TABLE` に行を足す）
  - `services/glasses_management/test/helpers.ts`（`syncMembership(org, storeId, userId, permissions)` を足す）
- **先に書くテスト**（既存の主体 5 種 × 新しい経路）
  - 主体を 2 つ増やす: `manager`（`settings.manage` を持つ membership 付き）/
    `staff-no-manage`（`settings.read` だけの membership 付き）。**membership の `userId` は
    dev グラントが載せる `sub`（`dev:<組織id>`）に合わせる。**
  - 足す行（読み取り = 全員 200 / 書き込み = manager 200・staff-no-manage 403・未認証 401・期限切れ 401・別 secret 401）
    - `GET /api/staff/stores/:storeId`
    - `PATCH /api/staff/stores/:storeId`
    - `GET /api/staff/stores/:storeId/business-hours`
    - `PUT /api/staff/stores/:storeId/business-hours`
    - `GET /api/staff/stores/:storeId/calendar-exceptions`
    - `POST /api/staff/stores/:storeId/calendar-exceptions`
    - `DELETE /api/staff/stores/:storeId/calendar-exceptions/:exceptionId`
    - `GET /api/staff/stores/:storeId/slot-rules`
    - `PUT /api/staff/stores/:storeId/slot-rules`
    - `GET /api/staff/stores/:storeId/staff`
    - `POST /api/staff/stores/:storeId/staff`
    - `PATCH /api/staff/stores/:storeId/staff/:staffId`
    - `PUT /api/staff/stores/:storeId/staff/:staffId/skills`
    - `GET /api/staff/stores/:storeId/staff-shifts`
    - `PUT /api/staff/stores/:storeId/staff-shifts`
    - `GET /api/staff/stores/:storeId/equipment`
    - `POST /api/staff/stores/:storeId/equipment`
    - `PATCH /api/staff/stores/:storeId/equipment/:equipmentId`
    - `GET /api/staff/stores/:storeId/equipment/:equipmentId/maintenance`
    - `POST /api/staff/stores/:storeId/equipment/:equipmentId/maintenance`
    - `DELETE /api/staff/stores/:storeId/equipment/:equipmentId/maintenance/:maintenanceId`
    - `GET /api/staff/purposes`
    - `POST /api/staff/purposes`
    - `PATCH /api/staff/purposes/:purposeId`
    - `PUT /api/staff/purposes/:purposeId/requirements`
    - `PUT /api/staff/purposes/order`
    - `POST /api/staff/settings/impact`（**読み取り専用なので店長を要求しない**。staff-no-manage も 200）
  - 単独で足す 3 本
    - `担当店舗の membership がまったく無い利用者は、設定の保存が 403 になる`
    - `他店舗の membership で settings.manage を持っていても、この店舗の保存は 403 になる`
    - `未知パス /api/staff/settings/not-a-route は default-deny のまま 404 にならず 401 / 403 を返す`
- **実装**: まだ書かない（T-011 で書く）。**期待した理由で赤いことを目で見る。**
- **完了条件**: 表が緑。**新しいルートを足したらこの表に 1 行足す。**
- **依存**: T-004

## T-006 テナント分離に受付条件を足す（Red）

- **目的**: 他社・他店舗の受付条件に手が届く経路が無いことを、3 テナント同時と偽装入力で潰す。
- **触るファイル**: `services/glasses_management/test/tenant-isolation.test.ts`
- **先に書くテスト**
  - `3 テナントが同じ曜日に営業時間を持っても、各自の 7 行しか読めない`
  - `他テナントの storeId をパスに入れた設定の読み取りは 404 になる（403 で存在を漏らさない）`
  - `他テナントの storeId をパスに入れた設定の保存は 404 になり、相手の行は 1 行も変わらない`
  - `本文に別テナントの organizationId を混ぜても、保存されるのは JWT の org である`
  - `同じ店舗 id を持つ 2 テナントは作れない（id は UUID なので衝突しない）が、slug は全組織で先取り順になる`
  - `他テナントのスタッフ id を staff-shifts の保存に混ぜると 404 になる`
  - `他テナントの目的 id を purposes/order に混ぜると 404 になり、自テナントの並び順も変わらない`
  - `他テナントの設備 id を点検の追加に混ぜると 404 になる`
  - `店舗をまたぐ読み取りは無い — 同じ組織の別店舗の営業時間は storeId を変えないと読めない`
- **注意**: D1 はテストファイル内で共有される。組織 id は `orgId()`、店舗 id・スタッフ id は
  `crypto.randomUUID()` で毎回作る。
- **実装**: まだ書かない（T-011 で書く）。**期待した理由で赤いことを目で見る。**
- **完了条件**: 9 本が緑。
- **依存**: T-004

## T-007 時刻の境界を書く（Red）

- **目的**: 「最後にお受けできる時刻」と「止める期間の重なり」を、実時刻に依存しない形で固定する。
- **触るファイル**
  - `services/glasses_management/test/store-settings.time.test.ts`（新規）
  - `services/glasses_management/test/settings-impact.time.test.ts`（新規）
- **先に書くテスト**（**時刻はすべて引数で注入する。`Date.now()` を呼ばない**）
  - `store-settings.time.test.ts`
    - 最後にお受けできる時刻 > `木曜 10:00–19:00・帯 18:40–19:00・片付け 10分・刻み 30分・最短の目的 20分 なら 18:20`
    - 最後にお受けできる時刻 > `定休の火曜は null を返す`
    - 最後にお受けできる時刻 > `金曜 11:00–20:00 では 19:40 になる（曜日ごとに違う閉店を読む）`
    - 最後にお受けできる時刻 > `最短の目的の所要が閉店までに収まらない曜日は null を返す`
    - 最後にお受けできる時刻 > `片付けが帯の長さを超えると、閉店から片付けを引いた時刻まで下がる`
    - 受付できる区間 > `帯を差し引くと 10:15–12:00 と 13:00–18:40 の 2 区間になる`
    - 受付できる区間 > `10:00 ちょうどに始まる帯は最初の区間を 10:15 から始める`
    - 営業時間の解決 > `例外の行がある日は曜日の行を一切見ない`
    - 営業時間の解決 > `kind='closed' の日は区間が 0 本になる`
    - 営業時間の解決 > `kind='special' の日は例外の開店・閉店を使い、帯は曜日のものを引き続き差し引く`
    - 営業時間の解決 > `曜日の行が欠けている日は定休として扱う`
    - JST の日跨ぎ > `UTC 15:00 ちょうどは翌日の JST 0:00 として解ける`
    - JST の日跨ぎ > `2028-02-29 の翌日は 2028-03-01 になる`
    - 曜日 > `2026-08-27 は木曜（weekday=4）である`
  - `settings-impact.time.test.ts`
    - 止める期間 > `10:00 ちょうどに始まるご予約は影響する（半開区間の左端を含む）`
    - 止める期間 > `12:00 ちょうどに始まるご予約は影響しない（半開区間の右端を含まない）`
    - 止める期間 > `9:59 に始まり 10:01 に終わるご予約は影響する（またぐものを取りこぼさない）`
    - 止める期間 > `その設備を使わないご予約は影響しない`
    - 止める期間 > `過去のご予約は数えない（基準時刻より前に終わったもの）`
    - 所要時間の変更 > `50分から 60分へ延ばすと、次の予約まで 50分しか空いていない Web 枠が落ちる`
    - 所要時間の変更 > `短くする変更は 1 件も落とさない（severity は info）`
    - 件数と札 > `影響 0 件なら severity は info、1 件以上なら action`
    - JST の日跨ぎ > `止める期間が UTC 15:00 をまたいでも、JST の同じ日として数える`
- **実装**: まだ書かない（T-009 / T-010 で書く）。**期待した理由で赤いことを目で見る。**
- **完了条件**: 23 本が赤（期待した理由で落ちている）。
- **依存**: T-004

## T-008 読み書きと版の衝突を書く（Red）

- **目的**: 6 面の読み書きが通ることと、版が合わないときに**1 行も書き換わらない**ことを固定する。
- **触るファイル**: `services/glasses_management/test/store-settings.integration.test.ts`（新規）
- **先に書くテスト**
  - 店舗の情報 > `保存した値をそのまま読み返せる` / `updatedAt と updatedBy が保存で更新される` /
    `201 文字の紹介文は 400 で落ち、行は変わらない`
  - 営業時間 > `7 行を置き換えられる` / `閉店が開店以前の行は 400 で落ち、行は変わらない` /
    `営業時間の外にはみ出す帯は 400 で落ちる` / `刻みが片付けより短い保存は通り、応答に警告が 1 件載る`
  - 営業日 > `臨時のお休みを足すと行が 1 つ増える` / `同じ日をもう一度押すと行が消える` /
    `92 日を超える範囲の取得は 400 で落ちる`
  - 予約の間隔 > `保存すると lastAcceptableAt が 7 曜日ぶん返る`
  - スタッフ > `足すと一覧が 1 名増える` / `技能を置き換えても既存の割り当ては変わらない` /
    `いま使えるを切っても行は消えない`
  - 勤務時間 > `曜日 7 行を保存すると staff_shifts が 62 日ぶん作り直される` /
    `保存し直すと同じ期間の古い行が残らない` / `営業時間の外にはみ出す勤務は通り、応答に警告が 1 件載る`
  - 設備 > `足すと一覧が 1 行増える` / `いま使えるを切っても行は消えず、既存の割り当ても変わらない` /
    `点検を足して消せる`
  - ご来店の目的 > `所要時間を変えても既存の予約の所要時間は変わらない` /
    `Web 予約に出すを切ると公開の件数が 1 減る` / `並べ替えると sort_order が入れ替わる` /
    `必要な技能 2 行の保存は 400 で落ちる`
  - 版の衝突 > `古い version で保存すると 409 version_conflict が返る`
  - 版の衝突 > **`409 のとき、営業時間・スタッフ・設備・目的のどの行も保存前の値のままである`**
  - 版の衝突 > `409 のとき store_settings_revision の version も上がっていない`
  - 版の衝突 > `保存が通ると version がちょうど 1 だけ上がる`
  - 影響試算 > `POST /api/staff/settings/impact は何も保存しない（試算の前後で全表の行が同じ）`
- **実装**: まだ書かない（T-011 で書く）。**期待した理由で赤いことを目で見る。**
- **完了条件**: 29 本が赤。
- **依存**: T-004

## T-009 営業時間の解決と検証を実装する（Green）

- **目的**: T-007 の `store-settings.time.test.ts` を緑にする。**純関数だけを置く**（D1 を触らない）。
- **触るファイル**: `services/glasses_management/src/worker/domain/store-settings.ts`（新規）
- **先に書くテスト**: T-007 の `store-settings.time.test.ts` 14 本。ここでは足さない。
- **実装**
  - `resolveBusinessDay({ date, weeklyRows, exceptions, blackouts })` → `{ isClosed, opensAt, closesAt, windows }`。
    解決順は**例外 → 曜日**。例外行があれば曜日の行を一切見ない。曜日の行が欠けていれば定休。
  - `acceptableWindows(opensAt, closesAt, blackouts)` → `{ startsAt, endsAt }[]`。
    営業時間から帯を差し引く。区間は**半開 `[start, end)`**。
  - `lastAcceptableStart({ windows, shortestDurationMinutes, cleanupMinutes, closesAt })` → `LocalTime | null`。
    **最後の区間の終わり − 最短の目的の所要**を返し、`開始 + 所要 + 片付け <= 閉店` を満たさなければ
    満たすまで下げる。区間が 0 本なら `null`。
    銀座店の木曜（区間の終わり 18:40 / 最短 20分 / 片付け 10分 / 閉店 19:00）で **18:20**、
    18:20+20+10 = 18:50 <= 19:00 なのでそのまま返る。
    **P2 の空き枠エンジンはこの関数を呼ぶ。式を 2 つ作らない**（表示と押せる枠が食い違うため）。
  - `validateBusinessHours(rows)` / `validateBlackouts(windows, opensAt, closesAt)` →
    `{ code, message }[]`。拒否は 3 つだけ（この TODO の決め #4）。
  - `warnBusinessHours({ slotMinutes, cleanupMinutes })` / `warnShiftOutsideHours(shift, hours)` →
    `string[]`。警告は保存を止めない。
  - JST は `packages/shared` の日付関数を使う。**この面で `Date.now()` を呼ばない**（時刻は引数で受ける）。
- **完了条件**: `store-settings.time.test.ts` の 14 本が緑。
- **依存**: T-007

## T-010 影響の試算を実装する（Green）

- **目的**: T-007 の `settings-impact.time.test.ts` を緑にする。**読み取り専用の純関数**にする。
- **触るファイル**: `services/glasses_management/src/worker/domain/settings-impact.ts`（新規）
- **先に書くテスト**: T-007 の `settings-impact.time.test.ts` 9 本。ここでは足さない。
- **実装**
  - `impactOfEquipmentStop({ reservations, equipmentId, startsAt, endsAt, now })` →
    `SettingsImpactItem[]`。重なり判定は**半開区間**（`予約の開始 < 止める終わり && 予約の終わり > 止める開始`）。
    `now` より前に終わったご予約は数えない。ラベルは `{お客様名} 様　{目的の name_short}`。
  - `impactOfPurposeDuration({ webSlots, purposeId, from, to })` → `SettingsImpactItem[]`。
    延ばしたあとの所要が入らなくなる枠だけを返す。短くする変更は 0 件。
    ラベルは `{設備名}が空きません`。
  - `impactOfBusinessHours({ reservations, windows, now })` → `SettingsImpactItem[]`。
  - `severityOf(report)` → `'info' | 'action'`。合計 0 件なら `info`、1 件以上なら `action`。
    **`action` のときだけ `setbar` の札を赤にする**（AC-SET-14）。
  - 予約の読み口は `readAffectedReservations(db, { organizationId, storeId, from, to })` の 1 関数に閉じ込め、
    T-001 の承認 4 で作る 3 表から読む。**この関数の外で `reservations` を SELECT しない**
    （P2 が読み口を広げるときに触る場所を 1 か所にする）。
  - 時刻は引数で受ける。`Date.now()` を呼ばない。
- **完了条件**: `settings-impact.time.test.ts` の 9 本が緑。
- **依存**: T-007, T-009

## T-011 店長判定と設定のルートを足す（Green）

- **目的**: T-005・T-006・T-008 を緑にする。
- **触るファイル**
  - `services/glasses_management/src/worker/store-permission.ts`（新規）
  - `services/glasses_management/src/worker/index.ts`（ルートをチェーンに足す）
- **先に書くテスト**: T-005 / T-006 / T-008 で書いた表と 29 本。ここでは足さない。
- **実装**
  - `requireStorePermission(perm: StorePermission)` — `c.get('auth')` の `org` と `sub`、パスの `storeId` で
    `store_memberships` を 1 行引き、`permissions`（空白区切り）に `perm` があれば通す。
    無ければ **403 `forbidden`**。行が無くても **403**（401 にしない）。
    **body / query の `organizationId` を認可の根拠にしない。**
  - 27 本のルートを `04-api.md` §3.3 / §3.4 のとおりチェーンする。書き込みには
    `requireStorePermission('settings.manage')` を付ける。`POST /api/staff/settings/impact` には付けない。
  - `zValidator` は**ルート内にインライン**で書く。応答は必ず契約で `parse` してから `c.json` する。
  - 保存は `db.batch()` 1 本。**版の条件を全文に `WHERE EXISTS (SELECT 1 FROM store_settings_revision
    WHERE organization_id=?1 AND store_id=?2 AND version=?3)` で配り、`version` を +1 する `UPDATE` を最後に置く。**
    最後の文の `meta.changes === 0` を 409 `version_conflict` の合図にする。
    行が無い店舗は先に `version=1` の行を作る。
  - 勤務時間の保存は `staff_weekly_shifts` 7 行の置き換えと、`effectiveFrom` から **62 日先まで**の
    `staff_shifts` の作り直しを同じ `db.batch()` に入れる。
  - `export type AppType = typeof routes` を保つ（チェーンを切らない）。
- **完了条件**: `pnpm --filter @app/glasses_management test` が緑。Worker 側カバレッジ 4 指標 80% 以上。
- **依存**: T-005, T-006, T-008, T-009, T-010

## T-012 世界観データを seed に入れる

- **目的**: モックと同じ盤面を dev と E2E で再現する。設定の初期値は取り込みではなく seed で入れる（Q-12 のいまの前提）。
- **触るファイル**: `services/glasses_management/seed.mjs`
- **先に書くテスト**: なし（T-008 の integration が読み込み側を押さえている）
- **実装**（値の正本は `03-data-model.md`。マスタープラン §5 と食い違う 2 件は §5 が誤り）
  - 営業時間 7 行（銀座店）: 月・水・木・土 10:00–19:00 / 火 定休 / 金 11:00–20:00 / 日 10:00–18:00。
    `break_start` / `break_end` は**常に NULL**。
  - 止める帯 3 本 × 営業する 6 曜日: 朝の支度 10:00–10:15 / お昼 **12:00–13:00** / 閉店前の片付け 18:40–19:00。
  - 予約の間隔 1 行: 刻み 30 / 片付け 10 / 同時受付 3。
  - 臨時のお休み 1 行: 2026-09-30 `closed` `棚卸しのため`。
  - スタッフ 6 名（`sort_order` 0 から）: 佐藤 美咲（視力測定・加工・販売・受付）/ 高橋 健（フィッティング・販売・受付）/
    中村 彩（販売・受付）/ 小林 学（視力測定）/ 渡辺 由紀（販売・受付）/ **山田 大輔（店長。role=`manager`・
    `job_label='店長'`・販売・受付）**。
  - 勤務の曜日テンプレート 6 名 × 7 行。佐藤 美咲は 月 10:00–19:00 / 火 お休み / 水 10:00–19:00 /
    木 10:00–19:00 / 金 お休み / 土 10:00–19:00 / **日 12:00–19:00**（日の営業時間 10:00–18:00 から
    わざとはみ出す。警告が出て通ることの実データになる）。
  - 設備 7 行: 視力測定機 A（`measure` / `視力測定`）/ 視力測定機 B（`measure` / `視力測定`）/
    検査室 1（`measure` / `精密検査`）/ 相談カウンター 1（`counter` / `接客・ご相談`）/
    相談カウンター 2（`counter` / `接客・ご相談`）/ フィッティング台（`counter` / `フィッティング`）/
    加工室（`workbench` / `加工`）。`role_label` は 7 行すべて非 NULL。
  - 点検 1 行: 視力測定機 B を `2026-08-28T01:00:00.000Z`〜`2026-08-28T03:00:00.000Z`（JST 10:00–12:00）、
    `定期点検（メーカー来店）`。
  - ご来店の目的 6 行（`sort_order` 0 から）: メガネを新しく作る / 新しいメガネを作る / 新調相談 / 60 / 公開・
    今のメガネを調整したい / かけ具合の調整 / 調整 / 20 / 公開・
    できあがりを受け取る / できあがりの受け取り / 受け取り / 20 / 公開・
    修理・部品交換 / 修理・部品の交換 / 修理 / 30 / **非公開**・
    コンタクトの相談 / コンタクトのご相談 / コンタクト / 40 / 公開・
    視力測定だけ / 視力測定 / 視力測定 / 30 / 公開。
  - 「メガネを新しく作る」の必要資源 3 行: `skill=measure` / `equipment_kind=measure` / `equipment_kind=counter`。
  - `store_settings_revision` を 3 店舗ぶん `version=1` で作る。
  - `store_memberships` を 2 件: 山田 大輔 に `settings.manage` を含む一式、中村 彩 に `settings.read` まで
    （E2E の AC-SET-17 が使う）。
- **完了条件**: `pnpm --filter @app/glasses_management db:seed:local` を 2 回続けて実行しても行数が変わらない
  （`INSERT OR IGNORE`）。`make dev/glasses_management` で 6 面が seed の値を出す。
- **依存**: T-011

## T-013 設定の器と影響カードを作る（Red → Green）

- **目的**: 6 面が同じ器の上で切り替わり、保存バーと影響カードが 6 面すべてで同じ位置・同じ言い方になる状態を作る。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 店長が接客の合間に、店の受付条件を 1 か所で直して保存する面。
  - トークン計画: 緑は左の柱 1 本だけに保つ（第2サイドバーは `--color-surface-2` の薄い面）。
    白い箱は 3 枚まで、説明文は 2 つまで。角は 8/12/16px の 3 段。値は右寄せ。
  - シグネチャ: **上の 56px のバーに「変更を捨てる／面の名前／未保存の札＋保存」を固定し、6 面すべてで同じ位置に置く。**
- **見るモック**: `docs/frontend/mockups/eyex/images/SETTINGS-STORE.png`（1194×834。撮影は上の 24px を外した 1194×810）
- **実測値**（`screens/SETTINGS-*.html` の `<style>` と `assets/eyex.css`。6 面すべて同じ）
  - `.set`: `grid-template-columns: 236px 1fr`、高さ 100%
  - 第2サイドバー: 地 `--color-surface-2`、右に 1px `--color-line`、`padding: 4px 10px 0`
  - 群の見出し: 11px / 行高 13px / `--color-ink-muted` / `padding: 3px 12px 0`
  - 項目: `min-height: 44px` / `padding: 0 12px` / 角 8px / 14px。選択中は地 `--color-pine`・文字 `--color-on-pine`・700
  - 保存バー: 高さ 56px / `grid-template-columns: 1fr auto 1fr` / `padding: 0 20px` / 地 `--color-surface` /
    下に 1px `--color-line`。見出し 17px 中央。ボタン `min-height: 44px` / `padding: 0 16px` / 15px
  - 本体: `padding: 32px 40px`
  - 未保存の札: `min-height: 22px` / `padding: 1px 8px` / 角 8px / 1px `--color-line-strong` / 12px 600 /
    `--color-ink-muted`。赤いときは地 `--color-danger-soft` / 縁 `--color-danger-line` / 文字 `--color-danger`
  - グループ表: 地 `--color-surface` / 1px `--color-line` / 角 12px / `overflow: hidden`。
    行は `min-height: 52px`（SETTINGS-STORE と HOURS は 56px、EQUIPMENT と PURPOSE は 48px）/ `padding: 8px 16px` /
    行間に 1px `--color-line` / 値は右寄せ `--color-ink-muted`
  - カード: 地 `--color-surface` / 1px `--color-line` / 角 16px / `padding: 20px 22px`。
    赤は地 `--color-danger-soft` / 縁 `--color-danger-line`、茶は地 `--color-walkin-soft` / 縁 `--color-walkin-line`
- **触るファイル**
  - `packages/ui/src/theme.css`（`--color-danger-line: #d9a9a4` と `--color-walkin-line: #d9bb92` を足す。
    影響カードの縁は塗りと対になる色で、`--color-danger`（`#97302b`）で代用するとモックより明らかに濃くなる。
    **装飾の縁なので 3:1 を要求しない**理由をコメントに残す）
  - `services/glasses_management/src/web/settings/{SettingsSections.ts,SettingsShell.tsx,SaveBar.tsx,ImpactCard.tsx,GroupTable.tsx,SwitchRow.tsx}`（新規）
  - `services/glasses_management/src/web/settings/SettingsShell.test.tsx`（新規）
  - `services/glasses_management/src/web/App.tsx`（`current === 'settings'` で設定の面へ差し替える）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test:web`）
  - 第2サイドバー > `6 項目を上から店舗の情報・営業日・営業時間・ご来店の目的・スタッフと技能・設備と点検の順に持つ`
  - 第2サイドバー > `モックが描いている「予約のきまり」「公開」などの 8 項目は出さない`
  - 第2サイドバー > `いま開いている項目に aria-current="page" が付く`
  - 第2サイドバー > `項目を選ぶと見出しがその名前に変わる`
  - 保存バー > `変更が無ければ札を出さず、保存は押せない`
  - 保存バー > `2 項目を直すと札が「未保存の変更 2件」になり、保存が押せる`
  - 保存バー > `件数の変化は割り込まない知らせ（role="status"）として 1 度だけ伝わる`
  - 保存バー > `「変更を捨てる」を押すと値が編集前へ戻り、札が消える`
  - 保存バー > `保存できたら「保存しました」が 1 度だけ伝わり、札が消える`
  - 保存バー > `保存が落ちたら「保存できませんでした。入力はそのまま残っています。」を出し、打ち込んだ値を保つ`
  - 影響カード > `件数が 0 のとき出さず、札も赤くならない`
  - 影響カード > `件数が 1 以上のとき見出しに件数を出し、札を赤くする`
  - 影響カード > `1 件 1 行で日時・お客様・目的を出す`
  - 切り替え > `行全体が role="switch" で、aria-checked が入と切で変わる`
  - 切り替え > `画面にも「使えます」「止めています」の文字が出る（色だけで伝えない）`
  - 権限 > `保存が 403 で跳ねられたら EX-PERMISSION の型で「{対象}を変えられるのは 店長 だけです。…」を出し、打ち込んだ値を残す`
  - 権限 > `「この下書きを店長に依頼する」のボタンを出さない`
  - 200% > `文字を 200% にすると第2サイドバーが細い柱に倒れ、行き先の名前は読み上げに残る`
- **実装**
  - 6 面は 1 ルート `/settings?section=...` で切り替える（面ごとにルートを分けない）。
  - 行の高さは `height` ではなく `min-height` で書く。器に `overflow: hidden` を置かず `overflow: auto` にする。
  - 溢れる表は**その表の中だけ**を `overflow-x: auto` にする。ページ本体を横スクロールさせない。
  - 装飾の記号（`›`）は `aria-hidden="true"`。
- **完了条件**: 18 本が緑。web 側カバレッジ 4 指標 60% 以上。
- **依存**: T-011

## T-014 店舗の情報を作る（Red → Green）

- **目的**: お客様に見せる名前・道順・紹介文を 1 か所で直せるようにし、200 文字の境界を画面で見せる。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: お客様に見せる名前・道順・紹介文を 1 か所で直す面。
  - トークン計画: 左は 2 群のグループ表（白 1 枚 + 罫だけの 3 行）、右は紹介文のカード 1 枚。白い箱は 2 枚。
  - シグネチャ: **右カラムに紹介文だけを置き、文字数を数字で常に見せる。**
- **見るモック**: `images/SETTINGS-STORE.png`
- **実測値**: `.cols` = `1fr 344px` / `gap: 22px`。群の見出し `margin: 32px 2px 12px`。
  グループ表の行 `min-height: 56px` / 15px。「行き方のご案内」は表ではなく罫だけの行（`padding: 16px 0` /
  上に 1px `--color-line`、先頭行は罫なし）。紹介文のカードは本文 16px / 行高 1.8。
  「書き直す」は `min-height: 44px` / `padding: 0 14px` / 15px。最後に直した行は 13px `--color-ink-muted` / `margin-top: 28px`。
- **触るファイル**
  - `services/glasses_management/src/web/settings/StorePanel.tsx`（新規）
  - `services/glasses_management/src/web/settings/StorePanel.test.tsx`（新規）
- **先に書くテスト**
  - `見出しが「店舗の情報」になり、「お店の基本」と「行き方のご案内」の 2 群が並ぶ`
  - `お店の基本は 店名・お客様に見せる店名・電話番号・住所 の 4 行を持つ`
  - `行き方のご案内は 最寄り駅・出口と所要時間・駐車場 の 3 行を持つ`
  - `店名と住所を直すと札が「未保存の変更 2件」になる`
  - `紹介文が 200 文字ちょうどなら「200文字／200文字まで」と出て保存できる`
  - `紹介文が 201 文字なら「紹介文が 200 文字を超えているため保存できません。文字数を減らしてください。」と出て保存できない`
  - `電話番号の欄は type="tel" と inputmode="numeric" を持つ`
  - `どの入力欄も autocomplete="off" を持つ（共有 iPad で前の利用者の入力を候補に出さない）`
  - `続きのある欄は enterkeyhint="next"、最後の欄は "done" を持つ`
  - `最後に直した日時と操作者を 1 行で出す`
- **実装**: `GET /api/staff/stores/:storeId` で読み、`PATCH` で保存する。`version` は `settingsVersion` を送る。
  電話番号は表示のとき `--font-mono`。空いた右下を埋めるために要素を足さない。
- **完了条件**: 10 本が緑。
- **依存**: T-013

## T-015 営業時間を作る（Red → Green）

- **目的**: 開店・閉店・止める帯・予約の間隔を決め、最後にお受けできる時刻をその場で確かめられるようにする。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 開店・閉店・止める帯・予約の間隔を決め、最後にお受けできる時刻をその場で確かめる面。
  - トークン計画: 左右 2 カラムの均等割り。白い箱は 2 枚（通常の営業時間 / 受付を止める時間帯）。
    導出結果は箱に入れず 13px の 1 行で置く。
  - シグネチャ: **右下の「木曜日に最後にお受けできるのは 18:20 です。」が、値を変えるたびに書き変わる。**
- **見るモック**: `images/SETTINGS-HOURS.png`
- **実測値**: `.cols` = `1fr 1fr` / `gap: 24px`。群の見出し `margin: 28px 2px 12px`。
  グループ表の行 `min-height: 56px`。「＋ 止める時間帯を足す」は表の最後の行で、文字は `--color-pine` の 600。
  「曜日ごとの上書き」「予約の間隔」は罫だけの行（`padding: 16px 0`）。
  最後の 1 行は 13px `--color-ink-muted`。
- **触るファイル**
  - `services/glasses_management/src/web/settings/HoursPanel.tsx`（新規）
  - `services/glasses_management/src/web/settings/HoursPanel.test.tsx`（新規）
- **先に書くテスト**
  - `左に「通常の営業時間」、右に「受付を止める時間帯」が並ぶ`
  - `通常の営業時間は 開店 10:00・閉店 19:00 を出す`
  - `受付を止める時間帯は 朝の支度 10:00–10:15・お昼 12:00–13:00・閉店前の片付け 18:40–19:00 の 3 行を出す`
  - `「＋ 止める時間帯を足す」を押して名前と時間帯を入れると、行が 1 つ増える`
  - `閉店を開店と同じ時刻にして保存すると「閉店が開店より前のため保存できません。閉店の時刻を直してください。」と出て保存されない`
  - `止める時間帯を営業時間の外にすると同じ 2 文の型で拒む`
  - `曜日ごとの上書きは 火曜日 お休み（定休日）・金曜日 11:00–20:00・日曜日 10:00–18:00・月・水・木・土曜日 通常どおり を出す`
  - `予約の間隔は 片付け 10分・刻み 30分ごと・同時に受けられる件数 3件まで を出す`
  - `「木曜日に最後にお受けできるのは 18:20 です。」を出す`
  - `刻みを片付けより短くすると警告を 1 行出し、保存は押せたままである`
  - `時刻の欄は数字の入力になっている`
- **実装**: `GET/PUT .../business-hours` と `GET/PUT .../slot-rules` の 2 本を読み、保存は 1 回の操作で両方を送る
  （画面の「保存」は 1 つ）。最後にお受けできる時刻は**画面で計算せず** `SlotRulesView.lastAcceptableAt` を出す。
- **完了条件**: 11 本が緑。
- **依存**: T-013

## T-016 営業日を作る（Red → Green）

- **目的**: 2 か月のカレンダーで臨時のお休みと営業日を入れ替えられるようにする。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 2 か月の丸を押して、営業日と臨時のお休みを入れ替える面。
  - トークン計画: 丸は薄い緑（`--color-pine-soft` + `--color-pine-line`）、休みは灰（`--color-busy` +
    `--color-line-strong`）、本日は 3px の緑の輪。白い箱は 2 枚（月のカード）。
  - シグネチャ: **色だけで休みを伝えず、丸の中に「休」の字を必ず置く。**
- **見るモック**: `images/SETTINGS-CALENDAR.png`
- **実測値**: `.months` = `1fr 1fr` / `gap: 22px` / `margin-top: 16px`。
  月のカード: 1px `--color-line` / 角 16px / `padding: 14px 14px 16px`、見出し 15px。
  日の格子: `repeat(7, 1fr)` / `gap: 4px`、曜日の見出し 11px `--color-ink-muted` / 行高 18px。
  丸: **40×40px** / 円 / 1px `--color-pine-line` / 地 `--color-pine-soft` / 14px 600 / 文字 `--color-pine-deep`。
  「休」は 11px 600 の別行。休み: 地 `--color-busy` / 縁 `--color-line-strong` / 文字 `--color-ink-muted`。
  本日: 3px `--color-pine` の輪。**丸は 40px なので当たり判定だけ 44pt へ広げる**（`::before { inset: -2px }`）。
  「まとめて決める」は罫だけの 2 行。
- **触るファイル**
  - `services/glasses_management/src/web/settings/CalendarPanel.tsx`（新規）
  - `services/glasses_management/src/web/settings/CalendarPanel.test.tsx`（新規）
- **先に書くテスト**
  - `2026年8月と2026年9月の 2 か月が並び、週は月曜から始まる`
  - `8月の定休は 4・11・18・25 で、丸の中に「休」が出る`
  - `9月の定休は 1・8・15・22・29 である`
  - `2026年8月27日に本日の輪が付く`
  - `9月30日の丸を押して保存すると、その日が休みの見た目になり「臨時のお休み」に「9月30日（水）」が入る`
  - `休みの日をもう一度押して保存すると営業日へ戻り、「臨時のお休み」から消える`
  - `丸は押せる大きさが 44pt 以上ある`
  - `「この店舗で予約を受け付ける」は入切を持つ切り替えとして読まれる`
  - `丸の読み上げ名は日付と状態の両方を持つ（例: 9月30日（水） お休み）`
- **実装**: `GET .../calendar-exceptions?from=&to=` を 2 か月ぶん引き、`POST` / `DELETE` で切り替える。
  `kind='special'` を作る操作は置かない（モックが描いていない）。
- **完了条件**: 9 本が緑。
- **依存**: T-013

## T-017 スタッフと技能を作る（Red → Green）

- **目的**: 誰がどのご用件を受け持てるかを、技能の札と曜日の勤務で決められるようにする。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 誰がどのご用件を受け持てるかを、技能の札と曜日の勤務で決める面。
  - トークン計画: 左は 250px の一覧（選択中は左端に 4px の緑）、右は白い箱 1 枚 + 札の列 + 曜日の 7 列。
  - シグネチャ: **技能の札 6 枚が 1 か所に並び、✓ の有無だけで受け持てる目的が決まる。**
- **見るモック**: `images/SETTINGS-STAFF.png`
- **実測値**: `.staff` = `250px 1fr` / `gap: 30px`。群の見出し `margin: 26px 2px 12px`。
  一覧の行: 名前 16px 600 / 技能 13px `--color-ink-muted`（`margin-top: 2px`）。
  選択中は `box-shadow: inset 4px 0 0 --color-pine` + `padding-left: 14px`。
  グループ表の行 `min-height: 52px` / 15px。
  技能の札: `min-height: 44px` / `padding: 0 16px` / pill / 1px `--color-line-strong` / 14px 600 /
  `gap: 10px`。選んだ札は 2px `--color-pine` / 地 `--color-pine-soft` / 文字 `--color-pine-deep`。
  勤務の 7 列: `repeat(7, 1fr)` / `gap: 6px`、セル `min-height: 62px` / `padding: 6px 2px` / 中央寄せ、
  曜日 13px 太字 / 時刻 12px 行高 1.45 `--color-ink-muted`。
- **触るファイル**
  - `services/glasses_management/src/web/settings/StaffPanel.tsx`（新規）
  - `services/glasses_management/src/web/settings/StaffPanel.test.tsx`（新規）
- **先に書くテスト**
  - `左に「スタッフ　6名」が並び、6 人目は 山田 大輔（店長）である`
  - `佐藤 美咲 を選ぶと右が「佐藤 美咲 の設定」になる`
  - `佐藤 美咲 の技能は 視力測定・加工・販売・受付 に ✓ が付いている`
  - `技能の札は 視力測定・加工・販売・受付・フィッティング・コンタクトの相談・修理・部品交換 の 6 枚である`
  - `「フィッティング」を押して保存すると、左の一覧の佐藤 美咲の技能にフィッティングが加わる`
  - `技能の札は押せる大きさが 44pt 以上あり、✓ の有無が読み上げでも分かる`
  - `勤務時間は 月から日の 7 列で、日曜が 12:00–19:00 である`
  - `日曜を 10:00–19:00 に直して保存し、開き直すと 10:00–19:00 になっている`
  - `日曜の勤務が営業時間 10:00–18:00 の外へ出ても保存でき、「日曜日の勤務が営業時間（10:00–18:00）の外にはみ出しています。」と警告だけ出る`
  - `「＋ スタッフを足す」から お名前・ふりがな・できる役割・技能 を入れて保存すると「スタッフ 7名」になる`
  - `「いま使える」を切ったスタッフの行は一覧から消えない`
  - `PIN の行は「設定してあります」と出すが、この面では作り直せない（P10）`
- **実装**: `GET .../staff` と `GET .../staff-shifts` の 2 本を読む。技能は `PUT .../skills`、
  勤務は `PUT .../staff-shifts`（曜日 7 行を送る）。
  肩書き行（`佐藤 美咲 / 視力測定・加工・販売`）は列を持たず、`jobLabel` と `skills` を `・` で連結して作る。
- **完了条件**: 12 本が緑。
- **依存**: T-013

## T-018 設備と点検を作る（Red → Green）

- **目的**: 設備を点検で止める前に、止めると困るご予約を数えて見せる。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 設備を点検で止める前に、止めると困るご予約を数えて見せる面。
  - トークン計画: 上は白い表 1 枚（選択行は薄い緑 + 左端 4px の緑）、下は左に編集の白い箱、右に赤いカード。
    白い箱は 3 枚まで。
  - シグネチャ: **「いま使える」を切った瞬間に、右の赤いカードと上の赤い札が同時に出る。**
- **見るモック**: `images/SETTINGS-EQUIPMENT.png`
- **実測値**: `.two` = `1.1fr 0.9fr` / `gap: 24px`。群の見出し `margin: 20px 2px 10px`。
  表の器: 地 `--color-surface` / 1px `--color-line` / 角 16px / `overflow: hidden`。
  見出しセル `padding: 10px 13px` / 12px / 地 `--color-surface-2`、本文セル `padding: 9px 13px` / 14px、
  1 列目の名前は 15px 太字。選択行は地 `--color-pine-soft`、1 列目に `inset 4px 0 0 --color-pine`。
  グループ表の行 `min-height: 48px` / 15px。
  赤いカード: 地 `--color-danger-soft` / 縁 `--color-danger-line` / 角 16px / `padding: 20px 22px`、
  行は `padding: 8px 0` / 14px。
- **触るファイル**
  - `services/glasses_management/src/web/settings/EquipmentPanel.tsx`（新規）
  - `services/glasses_management/src/web/settings/EquipmentPanel.test.tsx`（新規）
- **先に書くテスト**
  - `一覧は「設備と場所　6件」で、相談カウンター 1・2 を 1 行にまとめて出す`
  - `列は 設備・場所 / いまの状態 / 次の点検 の 3 つである`
  - `視力測定機 B の状態は「点検のため止めます」で、次の点検が 2026年8月28日（金）10:00–12:00 である`
  - `視力測定機 B を選ぶと「編集中：視力測定機 B」が出る`
  - `「いま使える」を切ると「止めると影響するご予約　3件」が出て、山口 真央 様・川上 恵 様・佐々木 亮 様 の 3 行が並ぶ`
  - `そのとき上の札が赤くなる`
  - `影響するご予約が 0 件の設備を止めると、影響の一覧は出ず札も赤くならない`
  - `「いま使える」は行全体が押せる切り替えで、入と切の状態が読み上げられる`
  - `画面に「使えます」「止めています」の文字が出る`
  - `「＋ 設備を足す」から 名前と種別（視力測定機／相談カウンター／加工台）を入れて保存すると 1 行増える`
  - `「いま使える」を切った設備の行は一覧から消えない`
- **実装**: `GET .../equipment` と `GET .../equipment/:id/maintenance` を読み、
  切り替えのたびに `POST /api/staff/settings/impact`（`kind='equipment_stop'`）を投げて件数を出す。
  **試算は保存しない。**保存は `PATCH .../equipment/:id` と `POST .../maintenance`。
  保存しても割り当ては自動で付け替えない。
- **完了条件**: 11 本が緑。
- **依存**: T-013

## T-019 ご来店の目的を作る（Red → Green）

- **目的**: ご用件の所要時間・必要な技能・必要な設備・Web への出し方を決め、延ばしたときに落ちる Web 枠を見せる。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: ご用件の所要時間・必要な技能・必要な設備・Web への出し方を決める面。
  - トークン計画: 上は白い表 1 枚（4 列）、下は左に編集の白い箱、右に茶色のカード。
    「50分から変更」は赤い札 1 つだけに留める（状態の札は 3 つまで）。
  - シグネチャ: **所要時間を延ばした瞬間に、受けられなくなる Web 枠が右に数字で出る。**
- **見るモック**: `images/SETTINGS-PURPOSE.png`
- **実測値**: `.two` = `1.15fr 0.85fr` / `gap: 22px`。表と行の寸法は T-018 と同じ。
  茶色のカード: 地 `--color-walkin-soft` / 縁 `--color-walkin-line` / 角 16px / `padding: 20px 22px`。
  「50分から変更」の札は `.tag.alert`（地 `--color-danger-soft` / 縁 `--color-danger-line` / 文字 `--color-danger`）。
- **触るファイル**
  - `services/glasses_management/src/web/settings/PurposePanel.tsx`（新規）
  - `services/glasses_management/src/web/settings/PurposePanel.test.tsx`（新規）
- **先に書くテスト**
  - `一覧は「ご来店の目的　6件」で、列は 目的の名前（店内） / お客様に見せる名前 / 所要時間 / Web予約 である`
  - `1 行目は メガネを新しく作る / 新しいメガネを作る / 60分 / 公開しています である`
  - `修理・部品交換 だけが「お店で受けるだけ」で、残り 5 件が「公開しています」である`
  - `「メガネを新しく作る」を選ぶと「編集中：メガネを新しく作る」が出る`
  - `所要時間を 50分から 60分へ変えると「50分から変更」の札が付く`（決め #16 のとおり、
    先に 50 分を保存してから 60 分へ戻して作る。seed は 60 分のまま）
  - `そのとき「60分に延ばすと受けられなくなるWeb枠　2件」が出て、2 行が並ぶ`
  - `所要時間を短くする変更では影響のカードを出さない`
  - `「修理・部品交換」の「Web予約に出す」を切って保存すると、公開している行が 5 件になる`
  - `「Web予約に出す」は行全体が押せる切り替えで、入と切の状態が読み上げられる`
  - `必要な技能は 1 つまで、必要な設備・場所は 2 つまでしか選べない`
  - `「＋ 目的を足す」から 目的の名前（店内）・お客様に見せる名前・台帳に出す短い名前・所要時間・必要な技能・必要な設備 を入れて保存すると「ご来店の目的　7件」になる`
  - `一覧の並び順を変えると、その順のままお客様への提示順になる`
- **実装**: `GET /api/staff/purposes` を読み、`PATCH` / `PUT .../requirements` / `PUT /purposes/order` で保存する。
  所要時間を変えるたびに `POST /api/staff/settings/impact`（`kind='purpose_duration'`）を投げる。
  **台帳に出す短い名前（`nameShort`）の欄は「お客様に見せる名前」の下に 1 行足す**
  （モックに描かれていない要素を足す唯一の箇所。理由は台帳の帯が 30 分幅・最小 54px しかないこと）。
- **完了条件**: 12 本が緑。web 側カバレッジ 4 指標 60% 以上。
- **依存**: T-013

## T-020 E2E を書き、spec を Approved に上げる

- **目的**: UC-SET-01〜14 と AC-SET-01〜22 の 36 件を、実ブラウザと実 Worker で 1 対 1 に固定する。
- **触るファイル**
  - `services/glasses_management/e2e/store-settings.spec.ts`（新規）
  - `specs/glasses_management/features/004-store-settings/spec.md`（`- ステータス:` を `Draft` → `Approved`）
  - `docs/testing/E2E_TRACEABILITY.md`（末尾の対応表に行を足す）
- **やること**
  - `test(...)` の**直前の行**に `// @e2e-covers <ID> [<ID> ...]` を置く。
    **1 行に空白区切りで複数 ID を書ける**ので、対応する UC と AC を同じ test にまとめる
    （例: `// @e2e-covers UC-SET-01 AC-SET-01 AC-SET-02`）。36 件を 22 本前後の test に収める。
  - コメントと `test(` の間に**別の文・別のコメント・`test.describe` を挟まない**（空行は許される）。
  - `test.only` / `test.skip` / `test.fixme` を使わない（付けると traceability が落ちる）。
  - **1 つの ID に有効な mapping が 2 つ以上あると落ちる。** 36 件がちょうど 1 回ずつ現れることを目で数える。
  - E2E の前提データは `seed.mjs`（T-012）と、テスト内で `POST /api/internal/store-memberships/sync` を
    叩いて作る 2 人（`settings.manage` あり / なし）で用意する。AC-SET-17 は後者で入る。
  - AC-SET-17 の本文は
    `{対象}を変えられるのは 店長 だけです。{操作者}（{役割}）の権限では保存できません。{対象}はまだ何も変わっていません。`
    の型で出ることと、打ち込んだ 2 行が「下書きは残っています」の下に残ることの両方を見る。
- **先に書くテスト**: この 22 本前後の Playwright test そのものが検証（先に書いてから spec を Approved に上げる）。
- **実装**: `store-settings.spec.ts` に「やること」のとおりの test を並べる。
- **完了条件**: `pnpm --filter @app/glasses_management e2e` が緑。
  `pnpm run test:traceability` が
  `E2E traceability: all approved UC/AC identifiers are mapped exactly once.` を出す。
- **依存**: T-014, T-015, T-016, T-017, T-018, T-019

## T-021 モックとの突き合わせを 6 面ぶん足す

- **目的**: 承認された見た目からどれだけ離れているかを数字で残す。
- **触るファイル**: `services/glasses_management/e2e/mock-compare.spec.ts`
- **やること**
  - `SETTINGS-STORE` / `SETTINGS-CALENDAR` / `SETTINGS-HOURS` / `SETTINGS-PURPOSE` / `SETTINGS-STAFF` /
    `SETTINGS-EQUIPMENT` の 6 枚を `toHaveScreenshot('<画面ID>.png', { scale: 'device' })` で撮る。
    基準画像は `docs/frontend/mockups/eyex/reference/`（ステータスバー 24px を外した派生物）。
    `node docs/frontend/mockups/eyex/reference.mjs` で作り直せる。
  - `maxDiffPixelRatio` は「いま許している差」。**残っている差が何かをコメントに書く。下げるだけで、上げてはいけない。**
    既知の差として先に書いておくもの: ①「キャンセル」→「変更を捨てる」の文字（この TODO の決め #2）
    ②お昼の帯 13:00–14:00 → 12:00–13:00（決め #6）③第2サイドバーの 8 項目を出さないこと（決め #1）
    ④上のバーの「お知らせ 3」（P10）。
  - **HOME の `maxDiffPixelRatio` を下げる。**T-012 で銀座店が入るので、店名が `EYEX` から `EYEX 銀座店` になる。
- **先に書くテスト**: なし（`toHaveScreenshot` そのものが検証）。
- **実装**: 6 面の `toHaveScreenshot` と、許している差のコメント。
- **完了条件**: `pnpm --filter @app/glasses_management exec playwright test --project=mock` が緑。
  6 面それぞれの差分の割合を進捗台帳に書いた。HOME の値が P0 の 5% より小さくなった。
- **依存**: T-020

## T-022 完了の確認

- **目的**: このフェーズの全ゲートを実際に走らせ、緑であることを結果で確かめる。
- **触るファイル**: `knip.jsonc`（新しい entry がある場合のみ）／進捗台帳
- **先に書くテスト**: なし（ここで新しいテストを書かない。足りなければ元のタスクへ戻る）
- **実装**: 下の 5 本を上から順に走らせ、落ちたら原因のタスクへ戻る。

```sh
pnpm run lint          # 緑
pnpm run deps:check    # 緑（新しい entry を knip.jsonc に足したか確かめる）
pnpm run typecheck     # 緑
pnpm run test          # 緑（traceability を含む）
pnpm --filter @app/glasses_management e2e   # 緑
```

- Worker 側カバレッジ 4 指標 80% 以上 / web 側 60% 以上。**閾値を下げない。広く除外しない。**
- 進捗台帳（`docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md`）に、
  実行したコマンドとその結果・カバレッジの実測値・6 面の差分の割合・T-001 の承認の返事を書く。
- **完了条件**: 上の 5 本がすべて緑。spec が `- ステータス: Approved`。進捗台帳に実測値を書いた。
- **依存**: T-021
