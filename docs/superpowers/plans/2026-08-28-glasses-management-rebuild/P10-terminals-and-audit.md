# P10 端末の使い分けと監査 — TODO

- spec: [`specs/glasses_management/features/013-terminals-and-audit/spec.md`](../../../../specs/glasses_management/features/013-terminals-and-audit/spec.md)
- 依存: P0
- 状態: 未着手
- 目的: 同じアプリを「スタッフが持ち歩く個人の iPad」と「レジ横に据え置く共有の iPad」のどちらとしても
  使えるようにし、責任の残る操作の前だけ本人の暗証番号で個人モードへ上げる。あわせて、重要な操作が
  消せない形で残ること・伏せても打ちかけの入力を捨てないことを担う。

---

## このフェーズの前提（着手前に 5 分で確認する）

### 実際に要る先行フェーズ

マスタープランの「依存: P0」は契約とスキーマの土台だけを指す。**この面が読み書きする表は 3 つ他のフェーズにある。**

| 表 | 持ち主 | 無かったときにすること |
|---|---|---|
| `staff`（`pin_hash` / `pin_updated_at` / `role` / `sort_order`） | **P1**（`004-store-settings` の 13 表の一部） | **このフェーズでは作らない。P1 を先に終わらせる。** LOGIN-STAFF / MODE-PERSONAL の 6 タイルがこの表そのものである |
| `audit_events` | **P3**（`006-booking-flow`、`0003_*.sql`） | 無ければ**このフェーズが作る**。列は `03-data-model.md` §10.3 のとおり。migration 番号は実際の連番に従う |
| `alerts` | **P7**（`010-recording`、`0006_*.sql`） | 無ければ**このフェーズが作る**。列は `03-data-model.md` §11.3 のとおり。`GET /api/staff/alerts` の最小形も P7 が持っているので、あればそれを広げる |

着手時に `ls services/glasses_management/migrations/` と
`grep -n "audit_events\|alerts\|export const staff" services/glasses_management/src/worker/db/schema.ts` を
実行して、どれが揃っているかを目で確かめる。

### 未決事項と、いまの前提

| Q | 問い | いまの前提（このとおりに実装・テスト・E2E を書く） |
|---|---|---|
| **Q-07** | スタッフのログインと暗証番号を admin に任せてよいか | **admin に任せる。**ただし `/start` と `/login/**` は JWT を持たない画面なので、**この面は「端末はすでに org スコープの JWT を持っている」前提から始める**（`POST /api/staff/terminals/:terminalId/sessions` より前）。最初のトークンは P0 の dev グラント（`POST /api/auth/token`）のまま使う。`ADMIN` binding と `AUTH_PEPPER` の追加は**このフェーズでは行わない**（binding の追加はアーキ変更＝人間承認事項。ルール 10）。`AUTH_PEPPER` だけは `.dev.vars` と `Bindings` に足す（PIN のハッシュに要る。secret であって binding ではない） |
| **Q-06** | 自動ロック 120 秒と個人モードの寿命 120 秒を WCAG 2.2.1 の免除にしてよいか | **免除（essential）を主張する。**警告も延長も出さない（伏せるだけで打ちかけの入力は消えない）。**読み上げでのフォーカス移動も「さわった」に数える**（`focusin` を最後にさわった時刻の更新に含める） |
| **Q-03** | 閲覧系 4 権限をサーバで強制するか | **強制する。**この面では `audit.read`（`GET /api/staff/audit`）と `terminal.manage`（端末の登録・更新）を `requireStorePermission()` で強制する |
| **Q-10** | 設定の下書きを店長に依頼する経路を作るか | **作らない。**下の「決め ⑤」を読む |

### このフェーズで確定させる決め（設計文書どうしが食い違っている 6 点）

実装者が迷わないよう、ここで断定する。**根拠まで書いてあるので、これ以外の読み方をしない。**

1. **境界値は `07-nfr.md` §10.3 を正とする。**自動ロックは **120 秒ちょうどでは伏せず、+1 秒で伏せる**
   （`06-use-cases.md` IDX-TERM-07 の検証点「120秒ちょうどで伏せ」はこれに合わせて読む）。
   個人モードの寿命も同じ。PIN の 30 秒ロックは **30 秒ちょうどはまだ入力できず、+1 秒で入力できる**。

2. **`audit_events.target_type` は「対象のテーブル名そのまま（snake_case・複数形）」にする**
   （`07-nfr.md` §7.2）。`03-data-model.md` §10.3 の単数形の列挙（`reservation` / `customer` …）は
   `customer_notes` / `alerts` / `store_business_hours` を表せないので採らない。
   P3・P5・P7 が単数形で書いた行が残っていたら、T-010 で綴りを揃える（そのフェーズのテストの期待値も同じコミットで直す）。

3. **`terminals` に `version`（integer・1 以上）を持たせる。**`03-data-model.md` §10.1 の列表には無いが、
   `04-api.md` の `TerminalPatch` が `version` 必須で `409 version_conflict` を返し、§5 の楽観ロック表も
   `terminals` を挙げている。列が無いと `PATCH` が成立しない。

4. **契約の文字数は `04-api.md` §4.2 を正とする。**`Terminal.name` は **1..60**（`03-data-model.md` §10.1 の
   「1〜30文字」は採らない）。P7 が `Alert.body` を 120 に決めたのと同じ扱い。

5. **EX-PERMISSION の「この下書きを店長に依頼する」を画面に出さない。**
   AC-TERM-13 の Then はこのボタンを含むが、同じ spec の 不明点（Q-10）と TASKS T-015b が「答えが来るまで
   出さない」と書いており、依頼を立てるための `AlertCode` は **10 値の許可リスト**で
   `settings.approval_requested` を含まない（`04-api.md` §4.9）。押せて何も起きないボタンを置かない。
   → **T-020 で spec を Approved に上げるとき、AC-TERM-13 の Then から「「この下書きを店長に依頼する」と」の
   一句を落とす**（同じコミットで直す）。Q-10 の答えが来たら一句を戻し、E2E を 1 本足す。

6. **`terminal.masked` の監査行を書かない。**`07-nfr.md` §7.2 の語彙には残るが、伏せている間は API を叩かない
   という決めがあり、書くための経路が `04-api.md` §3.10 に 1 本も無い。
   `audit.integration.test.ts` に「伏せても監査は 1 行も増えない」を書いて固定する。

### 画面の出し分けと URL

- **`react-router` をこのフェーズで入れない**（ライブラリ追加は人間承認事項。ルール 10）。
  P0〜P8 と同じく `App.tsx` の状態で画面を出し分ける（P8 も入れない。お客様がブックマークする
  `/w/:storeSlug` だけは `src/web/public/route.ts` の `history.pushState` + `popstate` で持っている。
  **業務画面はそれすら要らない**）。`05-screen-flow.md` §3.1 のルート
  （`/start` / `/login/staff` / `/login/staff/pin` / `/login/shared` / `/login/shared/pin` / `/mode/personal` / `/alerts`）は
  **「どの画面がどの状態か」を示す名前**として読む。URL は書き換えない。
- E2E は `/` を開いて操作で辿る（P0 の `e2e/foundation.spec.ts` と同じ形）。

### 世界観データ（seed で足すもの）

| 端末（銀座店） | `kind` | `place_note` | 状態（画面に出る文字） |
|---|---|---|---|
| 銀座店 レジ横iPad | `shared` | レジの右側　固定スタンド | まだ誰も使っていません |
| 銀座店 受付iPad | `shared` | 入口の受付台 | 業務中（高橋 健　9:32 から） |
| 銀座店 検査室iPad | `shared` | 検査室 1　測定機の脇 | つながっていません（最終通信　昨日 18:42） |

`device_label` は START-DEVICE-MODE の脚注に出る `EYE-iPad-07`。店舗共通 PIN は seed で `000000`
（連番でもゾロ目でもない。`weak_pin` に当たらないことを seed のコメントに書く）。

---

## T-001 契約を書く①（暗証番号・端末・セッション・再認証）（Red）

- **目的**: 端末と業務開始の入出力の形を Zod で 1 か所に決め、**応答に PIN のハッシュが載らないこと**を型で固定する。
- **触るファイル**
  - `packages/contracts/src/glasses_management.ts`（追記）
  - `packages/contracts/src/index.ts`（re-export に足す）
  - `packages/contracts/test/glasses_management.contract.test.ts`（追記）
- **先に書くテスト**（`pnpm --filter @app/contracts test`）
  このファイルの既存のテスト名は英語なので、**そのファイルの慣習に合わせて英語で書く**（サービス側のテストは日本語）。
  - `Pin` > `accepts exactly 4 digits and exactly 6 digits`
  - `Pin` > `rejects 3 digits, 7 digits, and anything that is not a digit`
  - `Terminal` > `bounds name to 1..60 — the API contract wins over the data model note of 30`
  - `Terminal` > `never carries pinHash — parsing a raw row fails`
  - `Terminal` > `exposes hasPin and isOnline as server-computed booleans`
  - `Terminal` > `defaults autoLockSeconds to 120 and bounds it to 30..1800`
  - `Terminal` > `keeps lastSeenAt nullable because a terminal may never have connected`
  - `TerminalListQuery` > `defaults includeInactive to false and leaves kind optional`
  - `TerminalInput` > `rejects an unknown key so a stale client field never lands silently`
  - `TerminalPatch` > `requires version so the optimistic lock cannot be skipped`
  - `TerminalSessionStart` > `requires staffId when mode is personal`
  - `TerminalSessionStart` > `rejects staffId when mode is shared`
  - `TerminalSession` > `keeps staffId null for a shared session`
  - `TerminalSession` > `carries startedAt and expiresAt as ISO datetimes`
  - `ReauthInput` > `is an allow-list of four reasons and fails closed on anything else`
  - `PinInvalidError` > `bounds remainingAttempts to 0..2`
  - `PinLockedError` > `carries retryAfterSeconds and remainingAttempts of 0`
- **実装**
  - `Pin = z.string().regex(/^\d{4,6}$/)`（`04-api.md` §4.1）。
  - `TerminalKind = z.enum(['shared','personal'])`。
  - `Terminal` = `id: Uuid` / `storeId: Uuid` / `name: 1..60` / `kind` / `placeNote: 0..40` /
    `deviceLabel: 0..30` / `autoLockSeconds: int 30..1800 (既定 120)` / `isActive: boolean` /
    `hasPin: boolean` / `lastSeenAt: IsoDateTime|null` / `isOnline: boolean` / `version: int >= 1` / `createdAt`。
    **`pinHash` を持たない**（`z.strictObject` にして、D1 の行をそのまま渡したら落ちるようにする）。
  - `TerminalListQuery` = `storeId: Uuid` / `includeInactive: boolean (既定 false)` / `kind?: TerminalKind`。
  - `TerminalInput` = `name` / `kind` / `placeNote?` / `deviceLabel?` / `autoLockSeconds (既定 120)` /
    `isActive (既定 true)` / `pin?: Pin`。`TerminalPatch` は同じ項目を任意にし、`version` だけ必須。
  - `TerminalSessionStart` = `mode` / `staffId?` / `pin`。**`mode` の判別つき union にする**
    （`personal` は `staffId` 必須、`shared` は `staffId` を持てない）。
  - `TerminalSession` = `id` / `terminalId` / `staffId: Uuid|null` / `mode` / `startedAt` / `expiresAt`。
  - `ReauthInput` = `staffId: Uuid` / `pin: Pin` / `reason: z.enum(['recording','attention','settings','customer_merge'])`。
  - `PinInvalidError` / `PinLockedError` は既存の `ApiError` に足す形（`04-api.md` §5）。
- **完了条件**: 17 本が緑。`packages/contracts` のカバレッジ 4 指標 80% 以上。
- **依存**: なし

## T-002 契約を書く②（監査・お知らせ・スタッフ PIN）（Red）

- **目的**: 監査 1 件の形と `target_type` の許可リストを確定し、お知らせの 4 分類の数え方を型で表す。
- **触るファイル**: T-001 と同じ 3 ファイル
- **先に書くテスト**（`pnpm --filter @app/contracts test`）
  - `AuditActorType` > `is the four-value allow-list staff / terminal / system / customer`
  - `AuditTargetType` > `spells target types as plural table names and rejects the singular reservation`
  - `AuditEvent` > `keeps actorId null for a system actor and terminalId null for a personal device`
  - `AuditEvent` > `bounds action to 1..80 and keeps beforeJson / afterJson unknown`
  - `AuditSearchQuery` > `defaults limit to 50 and rejects 0 and 201`
  - `AuditSearchQuery` > `accepts from and to as LocalDate and rejects a datetime`
  - `AuditEventList` > `has the items / nextCursor / total shape`
  - `AlertListQuery` > `defaults kind to all and audience to store`
  - `AlertListQuery` > `is an allow-list of four kinds — resolved is one of them`
  - `AlertList` > `carries counts for all / action / info / resolved`
  - `AlertPatch` > `accepts readAt of null so a read alert can be marked unread again`
  - `AlertPatch` > `rejects a body with neither readAt nor resolved`
  - `AlertReadAllResult` > `counts updated rows and cannot be negative`
  - `StaffPinInput` > `takes a Pin and nothing else`
  - `PinSetResult` > `returns staffId and updatedAt but never the pin`
- **実装**
  - `AuditActorType = z.enum(['staff','terminal','system','customer'])`。
  - `AuditTargetType` は**表テーブル名の許可リスト 24 値**:
    `organizations` / `stores` / `store_business_hours` / `store_blackout_windows` /
    `store_calendar_exceptions` / `store_slot_rules` / `staff` / `staff_skills` /
    `staff_weekly_shifts` / `staff_shifts` / `equipment` / `equipment_maintenance` /
    `visit_purposes` / `purpose_requirements` / `reservations` / `walk_ins` /
    `reception_sessions` / `customers` / `customer_notes` / `recordings` /
    `web_bookings` / `web_booking_settings` / `alerts` / `terminals`。
    **知らない値は落とす（fail close）。**
  - `AuditEvent` = `id` / `occurredAt` / `actorType` / `actorId: string|null` / `terminalId: Uuid|null` /
    `action: 1..80` / `targetType` / `targetId` / `correlationId: Uuid|null` /
    `beforeJson: z.unknown()` / `afterJson: z.unknown()`。
  - `AuditSearchQuery` = `storeId?` / `from?`・`to?: LocalDate` / `actorId?` / `action?` / `limit (既定 50・上限 200)` / `cursor?`。
  - `AlertListQuery` に `kind: z.enum(['all','action','info','resolved']).default('all')` を足す（P7 の形を広げる）。
  - `AlertList` に `counts: z.strictObject({ all, action, info, resolved })` を足す。
  - `AlertPatch` = `readAt?: IsoDateTime|null` / `resolved?: boolean`。**両方欠けた本文は落とす**（`.refine`）。
  - `AlertReadAllInput` = `storeId?` / `AlertReadAllResult` = `updated: int >= 0`。
  - `StaffPinInput` = `pin: Pin` / `PinSetResult` = `staffId: Uuid` / `updatedAt: IsoDateTime`。
- **完了条件**: 15 本が緑。カバレッジ 4 指標 80% 以上。
- **依存**: T-001

## T-003 `terminals` と `terminal_sessions` を書き、index を固定する（Red → Green）

- **目的**: D1 の 2 表を足し、index が「実際に投げるクエリの形」に合っていることをテストで固定する。
- **触るファイル**
  - `services/glasses_management/src/worker/db/schema.ts`（追記）
  - `services/glasses_management/test/schema.test.ts`（追記）
  - `services/glasses_management/seed.mjs`（3 端末を足す）
  - `services/glasses_management/migrations/0009_*.sql`（生成物。`design/03-data-model.md` §12 の割り当て。
    P1〜P9 のどれかが未着手で連番が空いていたら**実際の連番に従う**。番号を前に詰めない）
- **先に書くテスト**（`getTableConfig` で index の名前と対象列を見る。`pnpm --filter @app/glasses_management test`）
  - `terminals` > `LOGIN-SHARED の置き場所一覧を組織・店舗・作成順で引ける`
  - `terminals` > `楽観ロックの version を持つ（PATCH が 409 を返せる）`
  - `terminals` > `pin_hash と auto_lock_seconds を持ち、外部キーを宣言していない`
  - `terminal_sessions` > `端末の現在の使用者を組織・端末・開始時刻で引ける`
  - `terminal_sessions` > `期限切れの掃除を組織・期限で引ける`
  - `terminal_sessions` > `外部キーを宣言していない`
  - （`audit_events` / `alerts` を**このフェーズが作る**ことになった場合だけ）
    `audit_events` > `組織と発生時刻で時系列に引ける index を持つ` /
    `audit_events` > `1 対象の履歴を対象種別と対象 id で引ける index を持つ` /
    `alerts` > `店舗の新しい順と、未解決の件数の 2 つを引ける`
- **実装**
  - `terminals`: `id` / `organization_id` / `store_id` / `name` / `kind` / `place_note?` / `device_label?` /
    `pin_hash?` / `auto_lock_seconds`(integer) / `last_seen_at?` / `is_active`(`'0'|'1'`) / `version`(integer) / `created_at`。
    index は `terminals_org_store_created_idx (organization_id, store_id, created_at)` の 1 本。
  - `terminal_sessions`: `id` / `organization_id` / `store_id` / `terminal_id` / `staff_id?` / `mode` /
    `started_at` / `expires_at` / `revoked_at?` / `created_at`。
    index は `terminal_sessions_org_terminal_started_idx (organization_id, terminal_id, started_at)` と
    `terminal_sessions_org_expires_idx (organization_id, expires_at)` の 2 本。
  - FK を宣言しない。真偽値は `'0'|'1'` の text。日時は ISO8601 の text。DDL の DEFAULT に意味を持たせない。
  - `seed.mjs` に銀座店の 3 端末（上の表）を `INSERT OR IGNORE` で足す。`pin_hash` は
    `hashStretched(await stretchPin('000000', ORG, terminalId), pepper)` で作り、**ハッシュだけを INSERT する**。
    pepper は `.dev.vars` の `AUTH_PEPPER` から読む。seed は開発の足場なので `000000` はコードにそのまま書いてよい
    （本番の端末 PIN は「設定 › 端末」から作り直す）。
- **手順**: 編集 → `pnpm --filter @app/glasses_management db:generate` →
  **生成された `000N_*.sql` を目で読む**（`CREATE TABLE` が 2 本、`CREATE INDEX` が 3 本。
  既存表の再作成が 1 つも無いこと）→ `db:migrate:local`
- **完了条件**: 6 本（または 10 本）が緑。`test/setup.ts` が全 migration を当てられる。
- **依存**: T-001

## T-004 自動ロックと個人モードと 30 秒の待ちの境界を書く（Red）

- **目的**: 時刻に絡む 5 つの境界を、**固定時刻**で一度に押さえる。`Date.now()` に依存させない。
- **触るファイル**: `services/glasses_management/test/terminal-session.time.test.ts`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test`。基準時刻は `2026-08-27T02:08:00.000Z`）
  - 自動ロック > `最後にさわってから 120 秒ちょうどでは伏せない`
  - 自動ロック > `最後にさわってから 120 秒 +1 秒で伏せる`
  - 自動ロック > `端末の auto_lock_seconds が 30 なら 30 秒 +1 秒で伏せる（既定値を焼き込まない）`
  - 自動ロック > `画面が裏に回ったまま 120 秒ちょうどが過ぎて表に戻ったときは伏せない`
  - 自動ロック > `画面が裏に回ったまま 120 秒 +1 秒が過ぎて表に戻ったときは伏せた状態で戻る`
  - 自動ロック > `個人の端末（kind='personal'）は経過にかかわらず伏せない`
  - 個人モード > `開始から 120 秒ちょうどはまだ個人モードである`
  - 個人モード > `開始から 120 秒 +1 秒で共有モードへ戻る`
  - 個人モード > `さわるたびに期限が 120 秒先へ延びる`
  - 個人モード > `失効した個人セッションは revoked_at を書いても二重に書かない`
  - 暗証番号の待ち > `1 回目の失敗は残り 2 回、2 回目は残り 1 回`
  - 暗証番号の待ち > `3 回目の失敗でロックに入り、待ち時間は 30 秒である`
  - 暗証番号の待ち > `ロックから 30 秒ちょうどはまだ入力できない`
  - 暗証番号の待ち > `ロックから 30 秒 +1 秒で入力でき、失敗回数は 0 に戻る`
- **実装**: テストだけ。純関数は T-009 で書く（この時点では import が解決せず落ちる＝期待した Red）。
- **完了条件**: 14 本が「関数が無い」理由で落ちる。**`Date.now()` を 1 回も呼んでいない。**
- **依存**: T-003

## T-005 端末とセッションの代表フローを書く（Red）

- **目的**: 置き場所の一覧・共有と個人の業務開始・暗証番号の誤り・業務の終了・置き場所の引き継ぎを固定する。
- **触るファイル**
  - `services/glasses_management/test/terminals.integration.test.ts`（新規）
  - `services/glasses_management/test/helpers.ts`（`createTerminal(org, storeId, input)` と
    `startSession(token, terminalId, body)` を足す）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test`）
  - 置き場所の一覧 > `作成の古い順に 3 件返し、pin_hash を 1 度も含まない`
  - 置き場所の一覧 > `hasPin は pin_hash の有無から作る（値そのものは返さない）`
  - 置き場所の一覧 > `最終通信が 5 分より古い端末は isOnline=false になる（列に状態を持たない）`
  - 置き場所の一覧 > `last_seen_at が NULL の端末は isOnline=false で、lastSeenAt も null のまま返る`
  - 置き場所の一覧 > `includeInactive=false のとき is_active='0' の端末を返さない`
  - 共有の業務開始 > `正しい店舗の暗証番号で mode='shared' のセッションが開き、staffId は null になる`
  - 共有の業務開始 > `expires_at は開始時刻 + auto_lock_seconds になる`
  - 個人の業務開始 > `正しい本人の暗証番号で mode='personal' のセッションが開き、staffId が入る`
  - 個人の業務開始 > `staffId を欠いた本文は 400 で落ちる`
  - 個人の業務開始 > `pin_hash が NULL のスタッフでは 401 pin_invalid になる（PIN 未設定は個人ログイン不可）`
  - 暗証番号の誤り > `1 回目は 401 pin_invalid で remainingAttempts=2`
  - 暗証番号の誤り > `3 回目は 429 pin_locked で retryAfterSeconds=30・remainingAttempts=0`
  - 暗証番号の誤り > `ロック中は正しい暗証番号でも 429 のまま業務が始まらない`
  - 暗証番号の誤り > `失敗回数は KV の pin:<org>:<terminal>:<staffId ?? 'shared'> に置き、D1 に行を作らない`
  - 暗証番号の誤り > `3 桁の本文は zValidator の 400 で落ち、weak_pin にはならない`
  - 暗証番号の誤り > `0000 と 1234 の登録は 400 weak_pin で拒む（照合ではなく登録のときだけ）`
  - 業務の終了 > `セッションを消すと revoked_at が入り、行は残る`
  - 業務の終了 > `他人のセッション id を指定しても 404 で、相手のセッションは生きたままである`
  - 置き場所の引き継ぎ > `業務中の置き場所を別の端末が選ぶと、前のセッションが失効し新しいセッションが開く`
  - 置き場所の引き継ぎ > `1 端末に revoked_at が NULL で期限内のセッションは高々 1 本である`
  - 個人モードへの昇格 > `共有セッションのある端末で elevate すると mode='personal' の行に入れ替わる`
  - 個人モードへの昇格 > `セッションが 1 本も無い端末で elevate すると 404 になる`
  - 端末の登録・更新 > `POST は version=1 の端末を作り、PATCH は version を +1 する`
  - 端末の登録・更新 > `古い version の PATCH は 409 version_conflict で、行は変わらない`
- **実装**: テストだけ。
- **完了条件**: 24 本が 404 / 型エラーで落ちる。**組織 id は毎回 `orgId()` で作る**（D1 はファイル内で共有される）。
- **依存**: T-003

## T-006 監査を書く（Red）

- **目的**: 「共有モードは端末が主体・個人モードは本人が主体」と「追記専用」をテストで固定する。
- **触るファイル**: `services/glasses_management/test/audit.integration.test.ts`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test`）
  - 主体 > `共有モードの書き込みは actor_type='terminal'・actor_id=端末 id・terminal_id=端末 id になる`
  - 主体 > `個人モードの書き込みは actor_type='staff'・actor_id=スタッフ id・terminal_id=端末 id になる`
  - 主体 > `端末セッションが 1 本も無い経路（内部同期）は actor_type='system'・actor_id=null になる`
  - 業務開始 > `共有・個人どちらの開始でも terminal.session.started が 1 行だけ増える`
  - 業務開始 > `業務を終えると terminal.session.ended が増える`
  - 業務開始 > `置き場所の引き継ぎでは、失効した側に terminal.session.ended（after_json.reason='taken_over'）が残る`
  - 暗証番号 > `失敗すると terminal.pin.failed が増え、入力された番号もハッシュも残らない`
  - 昇格 > `MODE-PERSONAL の成功で terminal.mode.elevated が増える`
  - 昇格 > `EX-PERMISSION の店長 PIN も同じ action で、after_json.reason='settings_approval' で区別できる`
  - 追記専用 > `監査を書き換える経路が 1 本も無い（PATCH / PUT / DELETE がすべて 404）`
  - 追記専用 > `伏せても（自動ロック）監査は 1 行も増えない`
  - 版のガード > `409 version_conflict になった PATCH では監査が 1 行も増えない`
  - 変更前後 > `端末名を変えると before_json と after_json に変わった項目だけが入る`
  - 変更前後 > `before_json と after_json に pin も pin_hash も入らない`
  - 相関 > `1 回の操作で出た複数行が同じ correlation_id を持つ`
  - 読み取り > `GET /api/staff/audit は新しい順で、limit と cursor で続きが読める`
  - 読み取り > `監査を読んだこと自体は監査に残らない`
- **実装**: テストだけ。
- **完了条件**: 17 本が落ちる。
- **依存**: T-003

## T-007 権限マトリクスに端末・監査・お知らせの行を足す（Red）

- **目的**: 401（未認証・期限切れ）・403（権限不足）・403（個人モードが要る）の 3 つを取り違えないことを固定する。
- **触るファイル**
  - `services/glasses_management/test/permissions.test.ts`（`TABLE` に行を足す）
  - `services/glasses_management/test/helpers.ts`（`elevate(token, terminalId, staffId, pin)` を足す）
- **先に書くテスト**（既存の主体 5 種 ＋ このフェーズで増やす 2 種）
  - 主体を 2 つ増やす: `shared-session`（共有モードのセッションを開いた端末のトークン）/
    `personal-session`（個人モードへ昇格済み）。**どちらも同じ JWT で、違うのは端末セッションの状態だけである。**
  - 足す行（`JWT` = 全員 200 / `+店長` = `terminal.manage` か `audit.read` を持つ membership だけ 200 /
    `+本人` = `personal-session` だけ 200・`shared-session` は **403 `personal_mode_required`**）
    - `GET /api/staff/terminals` — JWT
    - `POST /api/staff/terminals` — JWT+店長（`terminal.manage`）+本人
    - `PATCH /api/staff/terminals/:terminalId` — JWT+店長（`terminal.manage`）+本人
    - `POST /api/staff/terminals/:terminalId/sessions` — JWT
    - `DELETE /api/staff/terminals/:terminalId/sessions/:sessionId` — JWT
    - `POST /api/staff/terminals/:terminalId/elevate` — JWT
    - `GET /api/staff/audit` — JWT+店長（`audit.read`）
    - `GET /api/staff/alerts` — JWT
    - `PATCH /api/staff/alerts/:alertId` — JWT
    - `POST /api/staff/alerts/read-all` — JWT
    - `PUT /api/staff/stores/:storeId/staff/:staffId/pin` — JWT+店長（`settings.manage`）+本人
  - 取り違えを直接見る 3 本
    - `期限切れのトークンは 401 で、個人モードがあっても通らない`
    - `権限が足りないのは 403 forbidden、個人モードが足りないのは 403 personal_mode_required で、コードが違う`
    - `個人モードの期限が切れた直後は 403 personal_mode_required になる（401 にしない）`
  - 未知パス > `/api/staff/terminals/not-a-route は 404 で、認証の前に漏れない`
- **実装**: テストだけ。**新しいルートを足したらこの表に 1 行足す。**
- **完了条件**: 追加した行がすべて落ちる。表の主体と経路の積が抜けなく埋まっている。
- **依存**: T-003

## T-008 テナント分離に端末・セッション・お知らせを足す（Red）

- **目的**: 端末・セッション・お知らせ・監査に他社から手が届く経路が無いことを潰す。
- **触るファイル**: `services/glasses_management/test/tenant-isolation.test.ts`（追記）
- **先に書くテスト**
  - `3 テナントが同じ名前の端末を持っても、各自の端末しか見えない`
  - `他テナントの terminalId でセッションを開こうとしても 404 になる`
  - `他テナントの staffId を混ぜた個人ログインは 404 で、自分のテナントのスタッフとして開かない`
  - `他テナントのセッション id を DELETE しても 404 で、相手のセッションは生きたままである`
  - `本文に別のテナントの organizationId を混ぜても、保存されるのは JWT の org である`
  - `他テナントの alertId を PATCH しても 404 で、相手の行は既読にならない`
  - `read-all は自分のテナントの、しかも選択中店舗の行だけを既読にする`
  - `GET /api/staff/audit は他テナントの監査を 1 行も返さない`
  - `無効化されたテナント（403）と未同期のテナント（503）は端末の一覧でも取り違えない`
- **実装**: テストだけ。組織 id は毎回 `orgId()` で作る。
- **完了条件**: 9 本が落ちる。
- **依存**: T-003

## T-009 `domain/pin.ts` と `domain/terminal-session.ts` を実装する（Green）

- **目的**: T-004 を緑にする。**時刻は最後の引数で注入し、`Date.now()` を呼ばない。**
- **触るファイル**
  - `services/glasses_management/src/worker/domain/pin.ts`（新規）
  - `services/glasses_management/src/worker/domain/terminal-session.ts`（新規）
- **実装**
  - `pin.ts`
    - `isWeakPin(pin: string): boolean` — **同一数字の連続**（`0000`）と **±1 の連番**（`1234` / `4321`）の 2 つだけ。
      辞書を持たない（`04-api.md` §5 の決め）。
    - `pinFailureKey(organizationId, terminalId, staffId: string | null): string`
      → `pin:${organizationId}:${terminalId}:${staffId ?? 'shared'}`。
    - `nextFailureState(attempts: number): { attempts, locked, remainingAttempts, retryAfterSeconds }`
      — 1 回目 `{ attempts: 1, locked: false, remainingAttempts: 2 }` /
      2 回目 `{ attempts: 2, locked: false, remainingAttempts: 1 }` /
      3 回目 `{ attempts: 3, locked: true, remainingAttempts: 0, retryAfterSeconds: 30 }`。
    - `isPinLocked(lockedAt: Date | null, now: Date): boolean` — `lockedAt` から **30 秒ちょうどはロック**、
      +1 秒で解ける。KV の TTL 30 秒と同じ境界にする。
  - `terminal-session.ts`
    - `expiresAtFrom(startedAt: Date, autoLockSeconds: number): string`
    - `isSessionLive(session: { expiresAt: string; revokedAt: string | null }, now: Date): boolean`
      — `revokedAt === null && new Date(session.expiresAt) > now`（**ちょうどは切れている**）。
    - `shouldMask(input: { kind: TerminalKind; autoLockSeconds: number; lastTouchedAt: Date; recordingActive: boolean }, now: Date): boolean`
      — `kind === 'personal'` なら常に `false`。`recordingActive` なら `false`
      （録音中の受付がある間は伏せない。`07-nfr.md` §6.4。P7 が未着手なら常に `false` を渡す）。
      それ以外は `now.getTime() - lastTouchedAt.getTime() > autoLockSeconds * 1000`（**厳密に大なり**）。
    - `isOnline(lastSeenAt: string | null, now: Date, thresholdSeconds = 300): boolean`
      — `lastSeenAt` が null なら `false`。
- **完了条件**: `test/terminal-session.time.test.ts` の 14 本が緑。
  `src/worker/domain/**` に `Date.now()` と引数なしの `new Date()` が 1 つも無い（grep で確かめる）。
- **依存**: T-004

## T-010 `domain/audit.ts` を実装し、書き込み経路へ配る（Green）

- **目的**: 主体の決め方を 1 か所にまとめ、**本処理と同じ `db.batch()`** に監査の追記を入れる。
- **触るファイル**
  - `services/glasses_management/src/worker/domain/audit.ts`（新規）
  - `services/glasses_management/src/worker/index.ts`（既存の書き込みルートに配る）
  - 既存フェーズの実装とテスト（`target_type` の綴りを揃えるときだけ）
- **実装**
  - `resolveActor(session: TerminalSession | null, auth: AuthClaims): Actor`
    — 個人モードのセッションがあれば `{ kind: 'staff', subjectId: staffId, terminalId }`、
    共有モードなら `{ kind: 'terminal', subjectId: terminalId, terminalId }`、
    セッションが無ければ `{ kind: 'system', subjectId: auth.sub, terminalId: null }`。
    **リクエスト入力から作らない。**
  - `auditRow(input): typeof auditEvents.$inferInsert` — `id` は `crypto.randomUUID()`、
    `occurred_at` は注入した `now`、`correlation_id` は 1 操作につき 1 個を呼び出し側で作って配る。
  - `changedFields(before, after): { before: Record<string, unknown>; after: Record<string, unknown> }`
    — **変わった項目だけ**を残す。`pin` / `pinHash` / `email` を含むキーは落とす（`07-nfr.md` §7.1）。
  - **版や枠の条件が付くバッチでは、監査の追記にも本処理と同じ `WHERE EXISTS` のガードを付ける。**
    D1 のバッチは 0 行しか当たらない `UPDATE` では中断せず後続を commit するので、ガードが無いと
    「409 を返したのに、起きなかった操作の監査だけが残る」。
  - **綴りの掃除**: `grep -rn "target_type\|targetType" services/glasses_management/src services/glasses_management/test` を
    実行し、単数形（`'reservation'` / `'customer'` / `'recording'` …）が残っていたら
    T-002 の許可リストの綴りへ直す。**そのフェーズのテストの期待値も同じコミットで直す。**
- **完了条件**: `test/audit.integration.test.ts` の 17 本が緑。単数形の `target_type` が 0 件。
- **依存**: T-006, T-009

## T-011 端末・セッション・再認証のルートと `requirePersonalMode()` を実装する（Green）

- **目的**: T-005 と T-007 の端末側を緑にする。
- **触るファイル**: `services/glasses_management/src/worker/index.ts`
- **実装**
  - `Bindings` に `AUTH_PEPPER: string` を足す（`.dev.vars` / `.dev.vars.example` / `vitest.config.ts` の
    `miniflare.bindings` にも dev 値を足す）。**`wrangler.jsonc` の `vars` には置かない。**
  - `requireStorePermission(perm: StorePermission)` は **P1 が
    `services/glasses_management/src/worker/store-permission.ts` に作っている**ので、
    **あればそれを使う**（P9 は同じ関数に `{ storeIdFrom: 'query' }` を足している。既定の `'param'` は変えない）。
    P1 が未着手で無ければここで新設する。判定材料は **JWT の `role` ではなく
    選択中店舗の `store_memberships.permissions`**（`04-api.md` §2.1）。足りなければ **403 `forbidden`**。
    `packages/shared` の `requireRole()` はこの面では使わない。
  - `requirePersonalMode()` を新設する。`terminal_sessions` に `mode='personal'` かつ
    `expires_at > now` かつ `revoked_at IS NULL` の行を要求する。無ければ **403 `personal_mode_required`**。
    応答本文に `{ error: 'personal_mode_required', subject: '録音の保全' }` のように用件を載せる
    （`{用件}` は `録音の保全` / `注意ごとの公開` / `設定の変更` / `お客様のおまとめ` の 4 語だけ）。
  - ルートを**チェーンして**足す（`export type AppType = typeof routes` に載る位置）:
    - `GET /api/staff/terminals` — `TerminalListQuery`。`hasPin` / `isOnline` はサーバで計算して返す。
    - `POST /api/staff/terminals` — `requireStorePermission('terminal.manage')` + `requirePersonalMode()`。
      `pin` があれば `isWeakPin` を通してから `hashStretched(stretchPin(...), AUTH_PEPPER)` を保存。`version=1`。
    - `PATCH /api/staff/terminals/:terminalId` — 同じ 2 つ。`UPDATE ... WHERE id=? AND version=?` が
      0 行なら **409 `version_conflict`**（`current` を添える）。成功時は `version` を +1。
    - `POST /api/staff/terminals/:terminalId/sessions` — `TerminalSessionStart`。
      1. KV の失敗回数を読み、ロック中なら **429 `pin_locked`**。
      2. `mode='shared'` は `terminals.pin_hash`、`mode='personal'` は `staff.pin_hash` と照合（`verifyStretched`）。
      3. 不一致なら KV に失敗回数を書き（TTL 30 秒）**401 `pin_invalid`** + `remainingAttempts`。
         同じ `db.batch()` で `terminal.pin.failed` を追記する。**入力された番号もハッシュも残さない。**
      4. 一致したら KV の失敗回数を消し、同じ端末の生きたセッションに `revoked_at` を書いてから
         新しい行を INSERT する（引き継ぎ。`terminal.session.ended` に `reason:'taken_over'`）。
         `expires_at = started_at + auto_lock_seconds`。`terminal.session.started` を同じバッチで追記。
    - `DELETE /api/staff/terminals/:terminalId/sessions/:sessionId` — `revoked_at` を書く（行は消さない）。
      `terminal.session.ended` を同じバッチで追記。無ければ **404 `not_found`**。
    - `POST /api/staff/terminals/:terminalId/elevate` — `ReauthInput`。本人の PIN を照合し、
      生きた共有セッションを `revoked_at` で閉じてから `mode='personal'` + `staff_id` の行を開く。
      `terminal.mode.elevated` を同じバッチで追記（`reason='settings'` かつ店長 PIN のときだけ
      `after_json.reason='settings_approval'`）。
  - **全クエリを `organization_id` で絞る。店舗業務は `store_id` も。**
  - `last_seen_at` は端末が叩くたびに更新する（`GET /api/staff/terminals` と各セッション操作の入口で 1 回）。
- **完了条件**: `test/terminals.integration.test.ts` の 24 本と `test/permissions.test.ts` の端末の行が緑。
  Worker 側カバレッジ 4 指標 80% 以上。
- **依存**: T-005, T-007, T-008, T-009, T-010

## T-012 監査・お知らせ・スタッフ PIN のルートを実装する（Green）

- **目的**: 読み返しの経路と、お知らせの 4 分類・既読・対応済みを緑にする。
- **触るファイル**: `services/glasses_management/src/worker/index.ts`
- **実装**（チェーンに足す）
  - `GET /api/staff/audit` — `requireStorePermission('audit.read')`。`AuditSearchQuery` で絞り、
    `occurred_at` の新しい順。**`OFFSET` を使わない**（`(occurred_at, id)` の複合カーソル）。
    応答は `{ items, nextCursor, total }`。**閲覧そのものは監査に残さない。**
  - `GET /api/staff/alerts` — `AlertListQuery`。P7 が最小形を作っていればそれを広げる。
    - `kind` の 4 分類: `all` = `resolved_at IS NULL` / `action` = `+ severity='action'` /
      `info` = `+ severity='info'` / `resolved` = **`resolved_at` が本日（JST）**。
    - `counts` は 4 分類すべての件数を同時に返す（ALERTS 左ペインが 4 つ同時に出す）。
    - **`audience='store'` の行だけを数える。**`ops` はサイドバーのバッジにも 4 分類にも入れない。
  - `PATCH /api/staff/alerts/:alertId` — `AlertPatch`。`readAt` と `resolved` を書く。
    `resolved: true` のとき `resolved_at` = 注入した `now`、`resolved_by` = 個人モードなら staff id・
    共有モードなら null。`alert.read` / `alert.resolved` を同じバッチで追記。無ければ **404**。
  - `POST /api/staff/alerts/read-all` — 選択中店舗の未読（`read_at IS NULL`）を一括で埋め、`{ updated }` を返す。
  - `PUT /api/staff/stores/:storeId/staff/:staffId/pin` — `requireStorePermission('settings.manage')` +
    `requirePersonalMode()`。`isWeakPin` なら **400 `weak_pin`**。保存は `staff.pin_hash` /
    `staff.pin_updated_at`。応答は `PinSetResult` のみ（**PIN そのものを返さない**）。
    `settings.changed`（`target_type='staff'`）を追記し、`before_json` / `after_json` には
    `{ hasPin: false }` → `{ hasPin: true }` だけを入れる。
- **完了条件**: `test/permissions.test.ts` / `test/tenant-isolation.test.ts` / `test/audit.integration.test.ts` が
  すべて緑。`pnpm --filter @app/glasses_management test` が緑でカバレッジ 4 指標 80% 以上。
- **依存**: T-011

## T-013 画面の計画（DESIGN_RULE パス 1）と `@app/ui` のテンキーを作る

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: レジ横の iPad を誰の手にも渡す面。**主役は 1 画面に 1 つ**（誰の番号か／どの置き場所か／何が足りないか）。
  - トークン計画: 面は `--color-paper` と `--color-surface` の 2 段。選択は緑 1 色（`--color-pine` の縁 3px と
    `--color-pine-soft` の塗り）。止まっている状態は `--color-danger` と `--color-danger-soft` に限り、
    **色に必ず文字を添える**（「本日休み」「つながっていません」「未読」）。角は 8/12/16px の 3 段。
  - シグネチャ: **右 420px に固定したテンキー**（1 キー 72×96px）と、その下に押せない理由を書く 13px の 1 行。
- **触るファイル**
  - `packages/ui/src/keypad.tsx`（新規。`Keypad` / `PinField` / `TryMeter`）
  - `packages/ui/src/index.ts`（re-export）
  - `packages/ui/src/keypad.test.tsx`（新規）
- **見るべきモック**: `docs/frontend/mockups/eye/images/LOGIN-STAFF-PIN.png` / `LOGIN-PIN-ERROR.png` /
  `MODE-PERSONAL.png` / `EX-PERMISSION.png` を **Read で実際に見る**。
- **実測値**（`assets/eye.css` の `.keypad` / `.key` / `.pins` / `.tries`）
  | 部品 | 値 |
  |---|---|
  | `Keypad` の枠 | `grid-template-columns: repeat(3, 96px)` / `gap: 12px` |
  | キー | 高さ **72px**・幅 96px・角 8px・1px `--color-line-strong`・地 白・28px 400 |
  | 「確定」 | 地 `--color-pine`・縁 `--color-pine`・文字 `--color-on-pine`・700 |
  | 「削除」 | 16px 600（`.key.wide`） |
  | `PinField` の桁 | 6 枠・各 **44×56px**・`gap: 12px`・角 8px・1px `--color-line-strong`・● は 26px |
  | 入力済みの桁 | 縁 `--color-pine` |
  | 誤りの桁 | 縁 `--color-danger`・地 `--color-danger-soft` |
  | `TryMeter` | 3 本・各 **30×10px**・角 5px・`gap: 8px`。未使用 `--color-busy` / 使用済み `--color-danger` |
- **先に書くテスト**（`pnpm --filter @app/ui test`）
  - `Keypad` > `0〜9 と 削除 と 確定 の 12 個を持つ`
  - `Keypad` > `キーは 1 つずつ名前を持ち、押すと 1 文字ずつ増える`
  - `Keypad` > `削除は末尾を 1 文字だけ消し、空のときは何もしない`
  - `Keypad` > `3 桁では確定を押せず、押せない理由が読み上げに乗る`
  - `Keypad` > `4 桁で確定を押せるようになる`
  - `Keypad` > `6 桁を超えて入力できない`
  - `Keypad` > `物理キーボードの数字・Backspace・Enter が画面のキーと同じ結果になる`
  - `PinField` > `常に 6 枠で、何桁入力したかを文字でも伝える`
  - `PinField` > `入力値そのものを DOM に出さない（value は ● だけ）`
  - `TryMeter` > `残り回数を role="img" と aria-label の両方で伝える`
- **実装の要点**
  - 欄は `readOnly` にせず **`inputMode="none"`** で置く（ソフトキーボードを出さないが、フォーカスと
    物理キーボードは生きる。`07-nfr.md` §2.2）。数字・Backspace・Enter は `keydown` で自前に拾う。
  - 「確定」が押せないときは `disabled` にしたうえで `aria-describedby` で理由を結ぶ
    （「あと1桁で「確定」を押せます」）。**押せない理由の無い disabled を作らない**（AC-TERM-19）。
  - **下段は全画面で「削除 / 0 / 確定」に揃える。**`06-use-cases.md` §13 の
    「右下は全画面 `削除`」は**電話番号のテンキー**（BOOK-04c / CUSTOMER-NEW）への正規化として読む。
    暗証番号の面には「確定」が要る（AC-TERM-03 / 05 / 19）。
    EX-PERMISSION の「やめる」「1字消す」はこの揃えで消える（残る差は T-021 に書く）。
  - 色・寸法は `packages/ui/src/theme.css` のトークン経由のみ。Tailwind 既定パレットと任意値を書かない。
- **完了条件**: 10 本が緑。`pnpm --filter @app/ui test` が
  `packages/ui/vitest.config.ts` の閾値（lines 100 / functions 100 / branches 94 / statements 96）を
  満たしたまま通る。**閾値を下げない。**
- **依存**: なし

## T-014 業務開始 6 面の画面テストを書く（Red）

- **目的**: 「何が読めて、何が押せるか」を先に決める。
- **触るファイル**
  - `services/glasses_management/src/web/start/DeviceMode.test.tsx`（新規）
  - `services/glasses_management/src/web/login/StaffPick.test.tsx`（新規）
  - `services/glasses_management/src/web/login/PinEntry.test.tsx`（新規）
  - `services/glasses_management/src/web/login/PlacePick.test.tsx`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test:web`）
  - 端末の使い方 > `「この iPad の使い方を決めてください」と「はじめの1回だけの設定です。」が出る`
  - 端末の使い方 > `個人と共有の 2 枚に「記録される名前」「お客様の情報」「暗証番号」の 3 行が並ぶ`
  - 端末の使い方 > `下に「あとから「設定 › 端末」で変更できます。」と端末の名前が出る`
  - 端末の使い方 > `「個人の端末にする」でスタッフを選ぶ画面へ進む`
  - 端末の使い方 > `「みんなで使う端末にする」で置き場所を選ぶ画面へ進む`
  - 端末の使い方 > `ヘルプはこの面に重ねる 1 枚のシートで、別の画面を起こさない`
  - スタッフを選ぶ > `「業務を始めるスタッフを選んでください」と「選んだ方の名前が、この日の記録に残ります。」が出る`
  - スタッフを選ぶ > `本日休みのスタッフは押せず、「本日休み」と文字でも示される`
  - スタッフを選ぶ > `選択中店舗のスタッフだけが並ぶ`
  - スタッフを選ぶ > `有効なスタッフが 0 人なら、設定で足す案内と「みんなで使う端末にする」を出して行き止まりにしない`
  - 暗証番号（個人） > `左に誰の番号かを名前・技能・本日の勤務で出す`
  - 暗証番号（個人） > `3 桁では確定を押せず、4 桁目で押せるようになる`
  - 暗証番号（個人） > `確定すると業務画面が開き、左の柱の下に「佐藤 美咲の iPad」と「個人で使っています」が出る`
  - 暗証番号（個人） > `「別のスタッフを選ぶ」で選び直せる`
  - 暗証番号の誤り > `「暗証番号が違います。あと2回お試しいただけます」と「3回続くと、30秒お待ちいただきます。」が出る`
  - 暗証番号の誤り > `入力欄は空になり、残り回数が目盛りと文字の両方で出る`
  - 暗証番号の誤り > `「店長に暗証番号の再設定を頼む」と「別のスタッフを選ぶ」が同じ画面にある`
  - 暗証番号の誤り > `3 回目の誤りで 30 秒待つことが文字で出て、その間は確定を押しても業務が始まらない`
  - 置き場所を選ぶ > `「この端末はどこに置きますか？」と「選んだ置き場所の名前が、そのまま記録に残ります。」が出る`
  - 置き場所を選ぶ > `3 件の状態が「まだ誰も使っていません」「業務中」「つながっていません」と文字で出る`
  - 置き場所を選ぶ > `つながっていない置き場所も、業務中の置き場所も押せる`
  - 置き場所を選ぶ > `「使い方を変える」で端末の使い方の画面へ戻る`
  - 暗証番号（共有） > `「個人を選ばずにできる」と「ご本人の確認が必要」の 2 群がそれぞれ 3 語ずつ出る`
  - 暗証番号（共有） > `確定すると左の柱の下に「銀座店 レジ横iPad」と「共有で使っています」が出る`
  - すべての面 > `入力欄はすべて autocomplete="off" を持つ`
- **実装**: テストだけ。
- **完了条件**: 25 本が「その部品が無い」理由で落ちる。
- **依存**: T-013

## T-015 `/start` と `/login/**` を実装する（Green）

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: まだ誰の端末でもない iPad に、名前を与える 6 面。
  - トークン計画: 白い箱は 1 画面に最大 3 枚（START は 2 枚、LOGIN-STAFF は 6 枚のタイルで**箱ではなく行**として数える）。
    説明文は 2 つまで・各 1 行。選択は `--color-pine` の 3px と `--color-pine-soft`。
  - シグネチャ: **上のバーに `⌂` を置かない**（まだ戻る先が無い）。右 420px のテンキーだけが固定される。
- **触るファイル**
  - `services/glasses_management/src/web/start/DeviceMode.tsx`（新規）
  - `services/glasses_management/src/web/login/{StaffPick.tsx,PinEntry.tsx,PlacePick.tsx,StartBar.tsx}`（新規）
  - `services/glasses_management/src/web/App.tsx`（`phase` の状態で 6 面を出し分ける）
  - `services/glasses_management/src/web/terminal/terminalState.ts`（新規。端末セッションの保持と更新）
- **見るべきモック**（`docs/frontend/mockups/eye/images/` を **Read で実際に見る**）
  `START-DEVICE-MODE.png` / `LOGIN-STAFF.png` / `LOGIN-STAFF-PIN.png` / `LOGIN-PIN-ERROR.png` /
  `LOGIN-SHARED.png` / `LOGIN-SHARED-PIN.png`
- **実測値**
  | 画面 | 値 |
  |---|---|
  | 上のバー（6 面共通） | 高さ **64px**・地 `--color-pine`・**`⌂` なし**・店名 19px 太字 + 補足 12px（`opacity .9`） |
  | バー右のボタン | `min-width: 60px` / `min-height: 48px` / 角 12px / 上段 12px・下段 17px 600 |
  | START の面 | `padding: 36px 44px` |
  | START の 2 枚 | `grid-template-columns: 1fr 1fr` / `gap: 32px` / `margin-top: 28px` / 角 16px / 1px `--color-line-strong` / `padding: 28px 30px` |
  | START の丸 | **62×62px**・27px。個人は `--color-pine`、共有は `--color-walkin` |
  | START の 3 行 | 各 `padding: 14px 0` + 下 1px `--color-line`（最後の行は罫なし）。見出し 13px 600 `--color-ink-muted`、値 16px/1.45 |
  | START のボタン | 幅 100%・`margin-top: 26px`・**48px**。脚注は `margin-top: 26px` の 13px |
  | LOGIN-STAFF の面 | `padding: 40px 44px`。タイルは `repeat(3, 1fr)` / `gap: 18px` / `margin-top: 30px` |
  | スタッフのタイル | `min-height: 116px` / `padding: 16px 20px` / 角 12px / 1px `--color-line-strong` |
  | タイルの丸 | **52×52px**・地 `--color-pine-soft`・縁 1px `--color-pine-line`・文字 `--color-pine-deep` 20px 700 |
  | タイルの文字 | 名前 17px 700 / 下段 13px `--color-ink-muted`（技能　勤務時間） |
  | 休みのタイル | `disabled`・地 `--color-surface-2`・**破線**の枠・文字 `--color-ink-faint`・丸は `--color-busy` |
  | PIN の面 | `grid-template-columns: 1fr 420px`。左 `padding: 40px 44px`、右 `padding: 40px 24px` + 左 1px `--color-line` + 地 白 + 中央寄せ + `gap: 22px` |
  | 誰の番号か（個人） | 丸 **56×56px** 地 `--color-pine` 文字白 23px 700 / 名前 18px 700 / 補足 13px。緑の枠の箱（`--color-pine-soft` + `--color-pine-line`）に入る |
  | 誰の番号か（共有） | **角 8px の四角** 56×56px 地 `--color-walkin`・24px |
  | PIN の見出し | 22px「4〜6桁の暗証番号を入力してください」/ 補足 16px |
  | 誤りのカード | 地 `--color-danger-soft`・縁 1px（`--color-danger` の薄い側）・角 16px・`padding: 24px 28px`。見出し 22px 700 `--color-danger`・本文 16px |
  | 誤りの `.tries` | `margin-top: 14px`。3 本・30×10px・角 5px・`gap: 8px` |
  | 共有の線引き | `margin-top: 34px`。ラベル 13px `--color-ink-muted` + 本文 16px。2 群の間に 1px `--color-line` |
  | LOGIN-SHARED の置き場所 | `repeat(3, 1fr)` / `gap: 20px` / `margin-top: 30px` / `padding: 20px 22px` / 角 12px。選択中は 3px `--color-pine` + 地 `--color-pine-soft` + `padding: 16px 18px` |
  | 置き場所の状態の札 | `.tag` = `min-height: 22px` / `padding: 1px 8px` / 角 8px / 12px 600。「つながっていません」だけ `--color-danger-soft` + `--color-danger` |
  | 置き場所の下段 | `margin-top: 16px` + `padding-top: 16px` + 上 1px `--color-line`・13px。状態行は `margin-top: 8px` |
  | LOGIN-SHARED の操作 | `margin-top: 34px` 右寄せ。「使い方を変える」は文字だけ（`--color-pine`）、「この置き場所で始める」は **56px** の緑 |
- **実装の要点**
  - **触れるものは 44pt 以上**（テンキーは 72pt）。休みのタイルは押せないので当たり判定を広げない。
  - 状態を色だけで伝えない。「選択中」「業務中」「つながっていません」「本日休み」はすべて文字を持つ。
  - `POST /api/staff/terminals/:terminalId/sessions` の 401 / 429 を、
    `remainingAttempts` と `retryAfterSeconds` で画面の文言に落とす。**平文の PIN を `console.log` に出さない。**
  - 429 の間は「確定」を `disabled` にし、残り秒数を `role="status"` で 1 回だけ読ませる。
  - モックに無い状態（読み込み中 / 空 / エラー / 375px / 200%文字拡大 / VoiceOver）は
    `docs/frontend/DESIGN_RULE.md` の品質フロアで補う。**空いた場所を埋めるために要素を足さない。**
- **完了条件**: T-014 の 25 本が緑。web 側カバレッジ 4 指標 60% 以上。
- **依存**: T-011, T-014

## T-016 昇格・自動ロック・通信断の画面テストを書く（Red）

- **目的**: 「伏せても打ちかけの入力を捨てない」ことと「裏に回ったタブから戻ったとき」をテストで押さえる。
- **触るファイル**
  - `services/glasses_management/src/web/mode/PersonalMode.test.tsx`（新規）
  - `services/glasses_management/src/web/shell/LockVeil.test.tsx`（新規）
  - `services/glasses_management/src/web/shell/OfflineBand.test.tsx`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test:web`。時刻は `vi.setSystemTime` ではなく**引数で注入**する）
  - 昇格 > `「録音の保全にはご本人の確認が必要です」と「操作するスタッフを選んでください。」が出る`
  - 昇格 > `上のバーに「いまは共有モード」の札が出る`
  - 昇格 > `本日休みのスタッフは押せない`
  - 昇格 > `4 桁入れて確定すると元の操作の画面へ戻り、「いまは共有モード」が消える`
  - 昇格 > `「やめて台帳に戻る」で昇格をやめても、元の画面の入力は消えない`
  - 自動ロック > `120 秒ちょうどでは伏せない`
  - 自動ロック > `120 秒 +1 秒で画面全体が覆われ、サイドバーも覆われる`
  - 自動ロック > `伏せるのはお名前と電話番号だけで、時刻・件数・端末名は読めたまま`
  - 自動ロック > `「2分間さわらなかったので伏せました。さわると元に戻ります。」が出る`
  - 自動ロック > `「画面にさわって続ける」で元に戻り、そのとき最新を読み直す`
  - 自動ロック > `伏せている間は API を 1 回も叩かない`
  - 自動ロック > `裏に回ったまま 120 秒 +1 秒が過ぎて表に戻ると、戻った時点ですでに伏せられている`
  - 自動ロック > `読み上げのフォーカス移動も「さわった」に数える`
  - 自動ロック > `個人の端末では伏せない`
  - 自動ロック > `覆いは role="dialog" と aria-modal="true" を持ち、Esc では閉じない（さわって続ける）`
  - 通信断 > `「通信が切れています」の帯といつ時点の内容かと次に自動で試す時刻が出る`
  - 通信断 > `台帳は読めるまま、予約の確定・変更・ご来店の受付だけが押せなくなる`
  - 通信断 > `打ちかけの入力は消えない`
  - 通信断 > `「再接続を試す」を押すと読み直し、成功したら帯が消える`
- **実装**: テストだけ。
- **完了条件**: 19 本が落ちる。
- **依存**: T-013

## T-017 `/mode/personal` と shell の覆い・伏せ字・帯を実装する（Green）

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 業務を止めずに「いま誰が操作しているか」を差し込む面と、離席した iPad を覆う 1 枚。
  - トークン計画: 覆いは `--color-paper` を `opacity .86` で敷くだけ（新しい色を作らない）。中央の箱だけが
    白 + 3px `--color-pine`。通信断の帯は `--color-danger-soft` の地に下 2px `--color-danger`。
  - シグネチャ: **覆いはサイドバーごとかける**（さわるまでどこへも進めないことを形で示す）。
- **触るファイル**
  - `services/glasses_management/src/web/mode/PersonalMode.tsx`（新規）
  - `services/glasses_management/src/web/shell/{LockVeil.tsx,OfflineBand.tsx,mask.ts,useIdle.ts}`（新規）
  - `services/glasses_management/src/web/shell/AppShell.tsx`（バーの札・お知らせボタン・覆いの差し込み口）
- **見るべきモック**: `MODE-PERSONAL.png` / `HOME-SHARED-LOCKED.png` / `EX-OFFLINE.png`
- **実測値**
  | 部品 | 値 |
  |---|---|
  | MODE-PERSONAL の枠 | `grid-template-columns: 1fr 400px`。左 `padding: 40px 40px`、右 `padding: 40px 24px` + 左 1px `--color-line` |
  | MODE-PERSONAL のタイル | `repeat(3, 1fr)` / `gap: 16px` / `margin-top: 14px` / `min-height: 100px` / `padding: 14px 16px`。丸 **46×46px** 18px 700 |
  | 選択中のタイル | 3px `--color-pine` + 地 `--color-pine-soft` + `padding: 12px 14px`。丸は地 `--color-pine` 文字白 |
  | 「やめて台帳に戻る」 | `margin-top: 32px`・48px |
  | 右の見出し | 15px「佐藤 美咲 さんの暗証番号　4〜6桁」 |
  | バーの札 | `.tag` 相当。「いまは共有モード」は白地・`--color-ink-muted`、「お客様の情報を隠しています」は `--color-danger-soft` + `--color-danger` |
  | `.veil` | `position: absolute; inset: 0` / 地 `--color-paper` / `opacity: .86` / `z-index: 4` |
  | `.lock` | 中央・幅 **560px** / `padding: 36px 40px 34px` / 地 白 / **3px** `--color-pine` / 角 16px / `z-index: 5` |
  | `.lock` の文字 | 見出し **26px** / 説明 16px `--color-ink-muted`（`margin-top: 10px`）/ 操作は `margin-top: 30px`・**56px**・主操作は `flex: 1` |
  | 伏せ字 | 等幅 + `letter-spacing: .06em`。`●●●● 様` / `090-●●●●-●●●●` |
  | 通信断の帯 | `padding: 20px 32px` / 地 `--color-danger-soft` / 下 **2px** `--color-danger` / `gap: 28px` |
  | 帯の文字 | 見出し **21px** `--color-danger` / 本文 16px/1.6 / 右のボタン **52px** + その下 13px（`margin-top: 8px`） |
- **実装の要点**
  - **`useIdle` はタイマーの経過に頼らない。**「最後にさわった時刻」を保持し、
    `visibilitychange` で表示に戻った瞬間に `now − lastTouch` を比べて、超えていれば即座に伏せる。
    iPadOS は非表示タブの `setTimeout` を強く絞るので、経過を数えるだけでは伏せられないまま戻る。
    さわったに数えるのは `pointerdown` / `keydown` / **`focusin`**（読み上げの移動）の 3 つ。
  - **伏せている間は API を叩かない。**進行中の `setInterval` / ポーリングを止め、
    「画面にさわって続ける」で読み直す。
  - `mask.ts` は**お名前と電話番号だけ**を `●` に置き換える純関数にする（時刻・件数・端末名・サイドバーの
    項目名は文字のまま）。伏せ字にした値を DOM のどこにも残さない。
  - 覆いは `role="dialog"` + `aria-modal="true"` + 開いた瞬間に見出しへフォーカス。
    **Esc で閉じない**（閉じる手は「画面にさわって続ける」と「業務を終える」の 2 つ）。
  - 通信断の帯は `role="status"`。次の自動再試行は **60 秒後**（`07-nfr.md` §5.2）。
    帯が出ている間は「確定」「変更」「受け付ける」を `disabled` にし、**下書きは保ったまま**にする。
  - `AppShell` のバッジを **`トップ` の行から上のバーへ移す**（`05-screen-flow.md` §2.4 —
    モック 68 枚のうち「トップ」にバッジを付けた画面は 1 枚も無い）。細い柱でも消えない場所に置く。
  - 業務画面の入力欄はすべて `autocomplete="off"`（共有端末に前の利用者の値を出さない）。
- **完了条件**: T-016 の 19 本が緑。web 側カバレッジ 4 指標 60% 以上。
- **依存**: T-011, T-016

## T-018 お知らせ・権限不足・設定 › 端末 の画面テストを書く（Red）

- **目的**: 4 分類の数え方・未読の示し方・下書きを捨てないこと・端末の決め直しを固定する。
- **触るファイル**
  - `services/glasses_management/src/web/alerts/AlertList.test.tsx`（新規）
  - `services/glasses_management/src/web/shell/PermissionWall.test.tsx`（新規）
  - `services/glasses_management/src/web/settings/TerminalSettings.test.tsx`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test:web`）
  - お知らせ > `左に「すべて 3」「アラート（対応が必要） 1」「お知らせ 2」「対応済み 12」の 4 分類が出る`
  - お知らせ > `対応が必要な 1 件が先頭に出る`
  - お知らせ > `未読の 3 件には左の赤い縦罫のほかに「未読」の札が付く`
  - お知らせ > `「すべて既読にする」で未読の印と札が消える`
  - お知らせ > `行に添えられた操作（もう一度送る／台帳で確認する／影響する予約を見る）が押せる`
  - お知らせ > `「もう一度送る」が成功すると、その 1 件が一覧から外れて「対応済み」が 1 増える`
  - お知らせ > `「もう一度送る」が失敗したら未対応のまま残る`
  - お知らせ > `手で対応済みにする操作を持たない`
  - お知らせの入口 > `左の柱の入口が「お知らせ 3件」と読まれ、数字だけが単独で読まれない`
  - お知らせの入口 > `柱がアイコンだけにたたまれていても同じように読まれる`
  - お知らせの入口 > `上のバーのボタンも「お知らせ 3件」と読まれる`
  - 権限不足 > `「この操作は店長だけができます」と足りない権限の名前が出る`
  - 権限不足 > `「設定はまだ何も変わっていません」が出る`
  - 権限不足 > `「下書きは残っています」の下に、書き換えた 2 行がそのまま読める`
  - 権限不足 > `「この下書きを店長に依頼する」を画面に出さない（Q-10 の答えが来るまで）`
  - 権限不足 > `右に「店長の暗証番号で続ける」のテンキーがあり、通ると元の操作が実行できる`
  - 権限不足 > `「設定に戻る」で下書きを保ったまま戻る`
  - 権限不足 > `下書きが無いまま開いたときは「下書きは残っています」を出さない`
  - 設定 › 端末 > `端末の一覧に名前・置き場所・使い方・自動で伏せるまでの時間が出る`
  - 設定 › 端末 > `使い方を決め直すと、次に業務を始める画面が変わる`
  - 設定 › 端末 > `暗証番号を作り直せる（0000 と 1234 は「簡単すぎます」で拒む）`
  - 設定 › 端末 > `自動で伏せるまでの時間は 30〜1800 秒の外を受け付けない`
  - 設定 › 端末 > `スタッフの権限では保存できず、権限不足の面が出る`
- **実装**: テストだけ。
- **完了条件**: 23 本が落ちる。
- **依存**: T-013

## T-019 ALERTS・EX-PERMISSION・設定 › 端末 を実装する（Green）

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 放っておくと予約に響くものを上へ積む面と、止められた操作の行き先を示す面。
  - トークン計画: 未読は左 4px の `--color-danger` **と**「未読」の札の 2 つで示す（色だけに意味を持たせない）。
    分類の選択中だけが白地 + 1px の影で浮く。それ以外は `--color-surface-2` に沈める。
  - シグネチャ: **1 行 1 件・1 行 1 操作**。行の右端のボタンが「次にやること」そのものになる。
- **触るファイル**
  - `services/glasses_management/src/web/alerts/{AlertList.tsx,alertLabels.ts}`（新規）
  - `services/glasses_management/src/web/shell/PermissionWall.tsx`（新規）
  - `services/glasses_management/src/web/settings/TerminalSettings.tsx`（新規）
  - `services/glasses_management/src/web/shell/destinations.ts`（`alerts` を足す）
  - `services/glasses_management/src/web/shell/AppShell.tsx` / `App.tsx`
- **見るべきモック**: `ALERTS.png` / `EX-PERMISSION.png`
- **実測値**
  | 部品 | 値 |
  |---|---|
  | ALERTS の 2 ペイン | `grid-template-columns: 252px 1fr`（既定の 340px を詰めた値） |
  | 左ペイン | `padding: 30px 14px` / 地 `--color-surface-2` / 右 1px `--color-line` |
  | 分類のボタン | `min-height: 52px` / `padding: 0 12px` / 角 8px / 15px 600 / `gap: 6px`。選択中は地 白 + `box-shadow: 0 0 0 1px --color-line` + 文字 `--color-pine` |
  | 件数 | 右端・13px 等幅・`--color-ink-muted` |
  | 右ペイン | `padding: 30px 24px`。日付ラベル 13px `--color-ink-muted`（`margin-bottom: 14px`） |
  | 行 | 地 白 / 1px `--color-line` / 角 12px / `padding: 20px` / 行間 16px。未読は**左 4px** `--color-danger` |
  | 行の時刻 | 幅 **52px**・13px 600 等幅・`--color-ink-muted`・`padding-top: 3px` |
  | 行の文字 | 見出し 17px / 本文 13px `--color-ink-muted`（`margin-top: 6px`） |
  | 行のボタン | 右端・上下中央・**48px**（`.btn`） |
  | 行の札 | 「対応が必要」= `--color-danger-soft` + `--color-danger`、「Web予約」= `--color-web-soft` + `--color-web` |
  | EX-PERMISSION の枠 | `grid-template-columns: 1fr 400px`。左 `padding: 40px 40px`、右 `padding: 40px 32px` + 左 1px `--color-line` + 地 白 |
  | 警告のカード | 地 `--color-danger-soft` / 角 16px / **左 6px** `--color-danger` / 見出し 22px `--color-danger` / 本文 16px/1.6（`margin-top: 10px`） |
  | 下書き | 見出し 16px 700 / 各行 `padding: 14px 0` + 1px `--color-line` |
  | 右の見出し | 16px 700「店長の暗証番号で続ける」+ 13px `--color-ink-muted`。`.pins` は `margin: 20px 0 24px` |
- **実装の要点**
  - **件数の数え方を 1 か所（`alertLabels.ts`）に置く。**サイドバー／上のバー／ALERTS の 4 分類が
    必ず同じ関数を通る。`すべて` = `resolved_at IS NULL` の総数、`対応済み` だけ**本日（JST）**で区切る。
    **`audience='ops'` の行はどの数にも入れない。**
  - 行の札は `severity` と `code` の**両方**から作る。`severity='info'` の行にも `code` 由来の札が付くので、
    **札の有無を `severity` の判定に使わない。**
  - 行に添えた操作が成功したら、その 1 件を `PATCH /api/staff/alerts/:alertId { resolved: true }` で
    対応済みにする（「もう一度送る」は再送の 200 を受けてから、「台帳で確認する」「影響する予約を見る」は
    遷移が起きた時点）。**手で対応済みにする操作は持たない。**
  - サイドバーの「お知らせ」の行は **ALERTS を開いているときだけ**出す（モック 68 枚がそうなっている）。
    ほかの画面の入口は上のバーのボタン。どちらも `aria-label="お知らせ 3件"` を持ち、
    **数字だけを裸で置かない**（`04-api.md` / AC-TERM-18）。
  - `PermissionWall` は 403 を受けた**その場**に出す（設定の先頭へ戻さない）。下書きは呼び出し元の
    state に残したまま、`POST /api/staff/terminals/:terminalId/elevate` が 200 を返したら元の保存を
    もう一度投げる。**「この下書きを店長に依頼する」を出さない**（決め ⑤）。
  - 「設定 › 端末」は `POST` / `PATCH /api/staff/terminals/:terminalId` を叩く。
    保存が 403 なら `PermissionWall` を出す。`0000` / `1234` は 400 `weak_pin` を
    「この暗証番号は簡単すぎます。同じ数字の並びと連番は使えません。」に落とす。
- **完了条件**: T-018 の 23 本が緑。web 側カバレッジ 4 指標 60% 以上。
- **依存**: T-012, T-017, T-018

## T-020 E2E を書き、spec を Approved に上げる

- **目的**: Approved の UC/AC 38 個に、有効な `@e2e-covers` をちょうど 1 つずつ貼り、traceability を通す。
- **触るファイル**
  - `services/glasses_management/e2e/terminals.spec.ts`（新規）
  - `specs/glasses_management/features/013-terminals-and-audit/spec.md`
  - `docs/testing/E2E_TRACEABILITY.md`（末尾の対応表に 38 行足す）
- **やること**
  - **UC-TERM-01〜16 と AC-TERM-01〜22 の 38 件に、1 対 1 で Playwright test を書く。**
    直前の行に `// @e2e-covers UC-TERM-NN` または `// @e2e-covers AC-TERM-NN`。
    - コメントと `test(` の間に**別の文・別のコメント・`test.describe` を挟まない**（空行だけ許される）。
    - `test.only` / `test.skip` / `test.fixme` を使わない（validator が落とす）。
    - `test(...)` は**ファイル直下の式文**でなければならない（`test.describe` の中は対象外）。
  - **AC-TERM-13 の Then から「「この下書きを店長に依頼する」と」の一句を落とす**（決め ⑤）。
    落とした理由を spec の 不明点 の Q-10 の行に 1 文で足す。
  - 書けたら spec の `- ステータス:` を `Draft` → `Approved` に上げる。
  - 時間に絡む 4 本（AC-TERM-09 / 12 / 17 と UC-TERM-08）は、**端末の `auto_lock_seconds` を
    seed で 2 秒に落とした専用の端末**を使って待つ（120 秒を実時間で待たない）。
    「2分間さわらなかったので伏せました。」の文言は `auto_lock_seconds` から作るのではなく
    固定文とし、文言のテストと時間のテストを分ける。
- **完了条件**: `pnpm --filter @app/glasses_management e2e` が緑。
  `pnpm run test:traceability` が
  `E2E traceability: all approved UC/AC identifiers are mapped exactly once.` を出す。
- **依存**: T-015, T-017, T-019

## T-021 モックとの突き合わせに 11 画面を足す

- **目的**: 承認された見た目からどれだけ離れているかを画素で測り、残っている差を数字と理由で記録に残す。
- **触るファイル**: `services/glasses_management/e2e/mock-compare.spec.ts`
- **やること**
  - `START-DEVICE-MODE` / `LOGIN-STAFF` / `LOGIN-STAFF-PIN` / `LOGIN-PIN-ERROR` / `LOGIN-SHARED` /
    `LOGIN-SHARED-PIN` / `MODE-PERSONAL` / `HOME-SHARED-LOCKED` / `EX-PERMISSION` / `EX-OFFLINE` / `ALERTS`
    の 11 枚を `toHaveScreenshot('<画面ID>.png', { scale: 'device', maxDiffPixelRatio: ... })` で撮る。
    基準画像は `docs/frontend/mockups/eye/reference/` にすでに 68 枚ある
    （作り直すときは `node docs/frontend/mockups/eye/reference.mjs <画面ID>`）。
  - `mock` project は viewport **1194×810**・`deviceScaleFactor: 2`。
  - **`maxDiffPixelRatio` は「いま許している差」。下げるだけで、上げてはいけない。**
    残っている差が何かを 1 枚ずつコメントに書く。**いま分かっている差は次の 4 つだけ**なので、
    これ以外の差が出たら実装を直す。
    1. `EX-PERMISSION` — 「この下書きを店長に依頼する」と在店中の 1 文を出していない（決め ⑤）。
       テンキーの下段が「削除 / 0 / 確定」で、モックの「やめる / 0 / 1字消す」と違う（T-013 の揃え）。
       `.pins` が 4 枠ではなく 6 枠。
    2. `ALERTS` — 未読の 3 行に「未読」の札を足している（色だけに意味を持たせない。spec の決めたこと）。
    3. `HOME` 系 — 上のバーの「お知らせ 3」を足したので、P0 のコメントに書いた 4% のうち 1 項目が消える。
       **`HOME.png` の `maxDiffPixelRatio` を下げ直す**（P0 のコメントも同じコミットで書き換える）。
    4. `LOGIN-*-PIN` — アクセシビリティのために暗くした 3 トークン（`--color-ink-faint` /
       `--color-line-strong` / `--color-pine-line`）のぶん、罫と補足文字がモックより濃い。
- **完了条件**: `pnpm --filter @app/glasses_management exec playwright test --project=mock` が緑。
  11 枚のうち少なくとも 8 枚が **5% 以下**。
- **依存**: T-020

## T-022 完了の確認

- **目的**: このフェーズが終わったことを、機械が確かめられる形で残す。
- **触るファイル**: `docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md`（追記）/
  `knip.jsonc`（entry を実在のものだけにする）
- **先に書くテスト**: なし（既存のテストを走らせるだけ）。
- **実装**: 下のコマンドを上から順に実行し、赤いものを直してから次のコマンドへ進む。**飛ばさない。**

```sh
pnpm run lint          # 緑
pnpm run deps:check    # 緑（knip.jsonc の entry に新しいファイルが要るなら足す）
pnpm run typecheck     # 緑
pnpm run test          # 緑（traceability を含む）
pnpm --filter @app/ui test                       # 緑（Keypad / PinField / TryMeter）
pnpm --filter @app/glasses_management test:all   # 緑（Worker 80% / web 60%）
pnpm --filter @app/glasses_management e2e        # 緑
pnpm --filter @app/glasses_management exec playwright test --project=mock   # 緑
pnpm check                                       # 緑
```

- 進捗台帳（`docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md`）に、
  実行したコマンドとその結果・カバレッジの実測値・`mock` project の差分の割合を書く。
- **閾値を下げない。広く除外しない。**届かないときはテストを足す。
- **完了条件**
  - 上の 9 コマンドがすべて緑。
  - `specs/glasses_management/features/013-terminals-and-audit/spec.md` が `- ステータス: Approved` で、
    UC-TERM-01〜16 と AC-TERM-01〜22 の 38 個すべてに `@e2e-covers` が 1 対 1 で付いている。
  - Worker 側カバレッジ 4 指標 80% 以上 / web 側 60% 以上。
  - T-021 の 11 画面のうち 8 画面以上の差分が 5% 以下で、その実測値が進捗台帳に書かれている。
  - 下の申し送り 3 行が進捗台帳に書かれている。
- 次のフェーズへ渡す申し送りを 3 行で書く:
  ①`AuditTargetType` を表テーブル名（複数形）に確定したこと
  ②`terminals.version` を足したこと
  ③Q-10 が解けたら EX-PERMISSION に「この下書きを店長に依頼する」を戻し、
  `AlertCode` に `settings.approval_requested` を足して AC-TERM-13 の一句と E2E を 1 本戻すこと
- **依存**: T-021
