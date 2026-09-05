# P3 電話・店頭からの予約受付 — TODO

- spec: [`specs/glasses_management/features/006-booking-flow/spec.md`](../../../../specs/glasses_management/features/006-booking-flow/spec.md)
- 依存: P2
- 状態: 未着手
- 目的: お電話・店頭で伺ったご予約を、会話の順のまま 1 工程 1 問の 5 工程で受け切り、
  確定の瞬間に D1 が二重予約を止め、伺った内容がどの経路でも消えない状態にする。

> 書き方の手本は [`P0-foundation.md`](./P0-foundation.md)。1 タスクは
> 「目的 / 触るファイル / 先に書くテスト / 実装 / 完了条件 / 依存」を必ず持つ。
> **書いてある以上のことをしない。書いてあることは全部やる。**

## このフェーズを始める前に読む

- `specs/glasses_management/design/03-data-model.md` §7.1 / §7.3 / §7.6 / §8.1 / §10.3 / §10.4 / §12
- `specs/glasses_management/design/04-api.md` §3.6 / §4.5 / §5 / §6.1 / §6.2 / §6.3
- `specs/glasses_management/design/05-screen-flow.md` §2.5 / §2.6 / §2.7 / §3.3 / §4.3 / §5.1 / §7.6 / §7.7
- `specs/glasses_management/design/06-use-cases.md` IDX-BOOK-01〜12
- `specs/glasses_management/design/07-nfr.md` §2.8 / §2.9 / §4.1 / §5.3 / §5.4 / §6.6 / §10.3

**テスト名の言語は package ごとに実物へ揃える。** `packages/contracts` は英語（既存 20 本が英語）、
`services/glasses_management` は日本語（既存 45 本が日本語）。混ぜない。

**P2 が出荷済みである前提**で書く。この TODO は `reservations` / `reservation_purposes` /
`reservation_assignments` / `reservation_slot_locks` の 4 表と `GET /api/staff/availability` /
`GET /api/staff/ledger` を**既にあるもの**として使う。無ければ P2 へ戻る。

**未決事項**: `design/09-open-questions.md` の **Q-06**（接客の途中で時間切れになってよいものはどれか）。
いまの前提 = 枠の仮押さえ 420 秒は残り時間を画面に出し、**残り 60 秒ちょうど**で `role="status"` の警告を出し、
「まだ入力中です」（44pt）で 420 秒を取り直せる（10 回まで）。延長の API（`PATCH /api/staff/holds/:holdId`）は
**作らない** — 押し直しは `DELETE` + `POST` の 2 本で足りる。T-004 / T-008 / T-018 がこの前提に触れる。

---

## T-001 契約を書く（Red）

- **目的**: 予約の確定・仮の押さえ・受付セッションの下書きの形を Zod で 1 か所に決める。
  手書き型と `any` をこのフェーズで 1 つも作らない。
- **触るファイル**
  - `packages/contracts/src/glasses_management.ts`（追記）
  - `packages/contracts/src/index.ts`（re-export を足す）
  - `packages/contracts/test/glasses_management.contract.test.ts`（追記）
- **先に書くテスト**（`pnpm --filter @app/contracts test`。**英語名**）
  - `ReservationCode` > `accepts EY-2608-0142 and the five-digit carry EY-2608-10000`
  - `ReservationCode` > `rejects a store prefix, a three-digit serial and a lowercase ey`
  - `StaffReservationCreate` > `accepts a phone booking with one purpose and no staff`
  - `StaffReservationCreate` > `treats a null staffId as decide-later and keeps it distinct from omitted`
  - `StaffReservationCreate` > `bounds purposeIds to 1..5 and equipmentIds to 0..5`
  - `StaffReservationCreate` > `rejects customerId and customerDraft given together`
  - `StaffReservationCreate` > `rejects an unknown key so a stale client field never lands silently`
  - `HoldInput` > `accepts a hold with no staff and no equipment`
  - `Hold` > `carries expiresAt so the screen can count down without asking again`
  - `ReservationAssignment` > `allows a null targetId — decide-later still consumes the slot`
  - `ReservationDetail` > `keeps purposeLabel and purposeLabelInternal as separate fields`
  - `ReservationDetail` > `requires webBookingCode to be null unless source is web`
  - `ReceptionSessionDraft` > `holds only chosen ids and typed characters, never a customer name or phone`
  - `ReceptionSessionClose` > `only accepts discarded — booked is written by the server on confirm`
- **実装**（`design/04-api.md` §4.5 の表がスキーマ名の正本）
  - 原始型: `ReservationCode = z.string().regex(/^EY-\d{4}-\d{4,5}$/)`
  - `ReservationSource` = `z.enum(['phone','counter','walkin','web'])`
  - `ReservationStatus` = `z.enum(['confirmed','arrived','serving','done','cancelled','no_show'])`
  - `ReservationAssignment` / `ReservationPurposeLine` / `ReservationDetail`
  - `StaffReservationCreate`（`customerId` × `customerDraft` は `.refine` で排他）
  - `HoldInput` / `Hold` / `DeletedResult`
  - `ReceptionSessionStart` / `ReceptionSessionDraft` / `ReceptionSessionDraftPatch` /
    `ReceptionSession` / `ReceptionSessionClose`
  - `ReceptionSessionDraft` に持たせるのは **`purposeIds` / `staffId` / `equipmentIds` / `startsAt` /
    `durationMinutes` / `customerId` / `phoneTyped` / `nameTyped` / `kanaTyped` / `noteTyped` /
    `handwritingKeys`（0〜5 件の R2 キー。T-017）だけ**。
    確定したお客様の氏名・電話番号を持つ列を作らない（`07-nfr.md` §6.6）。
  - `customerDraft` は P4（`007-customer-records`）が `CustomerCreate` を作るまで
    `z.never().optional()` にせず、**フィールドごと足さない**。P4 が足す。
- **完了条件**: 14 本が緑。`packages/contracts` のカバレッジ 4 指標 80% 以上。
- **依存**: なし

## T-002 3 表をスキーマに書き、index を固定する（Red → Green）

- **目的**: 監査・冪等・受付セッションの 3 表を作り、index が実際に投げるクエリの形に合っていることを固定する。
- **触るファイル**
  - `services/glasses_management/src/worker/db/schema.ts`（追記）
  - `services/glasses_management/test/schema.test.ts`（追記）
  - `services/glasses_management/migrations/0003_*.sql`（生成物）
- **先に書くテスト**（`getTableConfig` で index の名前と対象列を見る）
  - `audit_events` > `組織と発生時刻で時系列に引ける index を持つ`
  - `audit_events` > `1 予約の履歴を対象種別と対象 id で引ける index を持つ`
  - `audit_events` > `store_id だけが NULL 可（組織同期の行のため）`
  - `idempotency_records` > `冪等キーそのものが主キーで、追加の一意 index を張らない`
  - `idempotency_records` > `期限切れを掃除する Cron のための expires_at の index を持つ`
  - `reception_sessions` > `店舗と開始日時で日別に引ける index を持つ`
  - `reception_sessions` > `予約 id から受付をたどれる index を持つ`
  - `reception_sessions` > `下書き・終了・結果は NULL 可（進行中の行が成り立つ）`
- **実装**（列は `design/03-data-model.md` §10.3 / §10.4 / §8.1 の表をそのまま写す）
  - `audit_events`: `id` / `organization_id` / `store_id?` / `actor_type` / `actor_id?` / `terminal_id?` /
    `action` / `target_type` / `target_id` / `before_json?` / `after_json?` / `correlation_id?` / `occurred_at`
  - `idempotency_records`: `key`(PK) / `organization_id` / `scope` / `request_hash` / `response_json?` /
    `status` / `created_at` / `expires_at`
  - `reception_sessions`: `id` / `organization_id` / `store_id` / `reservation_id?` / `terminal_id?` /
    `actor_id?` / `started_at` / `ended_at?` / `outcome?` / `draft_json?` / `created_at`
  - FK を宣言しない。真偽値は `'0'|'1'`。日時は ISO 文字列。`terminal_id` は P10 まで常に NULL。
  - **`reservation_slot_locks` をここで作らない**（P2 が `0002_*.sql` で作っている）。
- **手順**: 編集 → `pnpm --filter @app/glasses_management db:generate` → 生成 SQL を目で読む
  （列削除・テーブル再作成が出ていたら手で直す）→ `db:migrate:local`
- **完了条件**: `migrations/0003_*.sql` が 3 表の `CREATE TABLE` と 5 本の `CREATE INDEX` だけを持ち、
  `schema.test.ts` が緑。
- **依存**: T-001

## T-003 採番と制約違反の unit テストを書く（Red）

- **目的**: 予約番号の書式・桁上げ・衝突再試行と、D1 のエラー文字列から表名を取り出す 1 か所を固定する。
  D1 の文言が変わったときに 409 が黙って 500 に化けることを、この 2 本が検知する。
- **触るファイル**
  - `services/glasses_management/test/reservation-code.test.ts`（新規）
  - `services/glasses_management/test/constraint.test.ts`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test`）
  - 予約番号 > `EY-2608-0142 の形で採る（組織ごと・YYMM ごとの 4 桁ゼロ埋め）`
  - 予約番号 > `月をまたぐと連番が 1 に戻る（8月31日と9月1日）`
  - 予約番号 > `年をまたぐと YYMM が 2612 から 2701 になる`
  - 予約番号 > `9999 の次は 5 桁へ桁上げして EY-2608-10000 になる`
  - 予約番号 > `店舗が違っても組織が同じなら同じ連番の列を使う`
  - 予約番号 > `衝突したら +1 して最大 5 回まで打ち直す`
  - 予約番号 > `5 回打ち直しても取れなければ 409 code_exhausted を返す（500 にしない）`
  - 制約違反 > `UNIQUE constraint failed: reservations.code から reservations を取り出す`
  - 制約違反 > `SQLITE_CONSTRAINT_PRIMARYKEY: idempotency_records.key から idempotency_records を取り出す`
  - 制約違反 > `知らない形のメッセージには null を返す（推測で表名を作らない）`
  - 制約違反 > `Error でないもの・message が空のものにも null を返して落ちない`
- **実装のための注意**: 時刻は引数で注入する（`nextReservationCode(db, orgId, now: Date)`）。
  `Date.now()` を書かない。JST の暦月で `YYMM` を決めるので、`2026-09-01T00:30:00+09:00`
  （= UTC 8/31 15:30）は `2609` になる。
- **完了条件**: 11 本が緑。
- **依存**: T-002

## T-004 時刻と期限の境界値テストを書く（Red）

- **目的**: 仮の押さえ・冪等・刻みの端が「ちょうど」と「+1 秒」で正しく割れることを固定する。
- **触るファイル**: `services/glasses_management/test/booking.time.test.ts`（新規）
- **先に書くテスト**
  - 仮の押さえ > `420 秒ちょうどではまだ押さえている`
  - 仮の押さえ > `421 秒目には解放され、ほかの端末が同じ枠を取れる`
  - 仮の押さえ > `残り 60 秒ちょうどで警告を出し、61 秒では出さない`
  - 仮の押さえ > `押さえ直すと残り時間が 420 秒に戻る`
  - 冪等 > `24 時間ちょうどの再送は保存した応答をそのまま返す`
  - 冪等 > `24 時間 +1 秒の再送は期限切れとして新しく実行する`
  - 刻み > `10:00 開始の枠は取れ、19:00 に終わる枠も取れる`
  - 刻み > `19:00 開始の枠は取れない`
  - 刻み > `片付け 10 分が終わる時刻ちょうどから次を取れ、その 1 秒前は取れない`
  - JST > `9月1日 00:30 JST の予約は 8月31日 の枠に混ざらない（UTC 15:00 の日跨ぎ）`
  - JST > `うるう年 2028年2月29日 の予約が 3月1日 に流れない`
- **実装のための注意**: 時刻はすべて引数で注入する（`isHoldAlive(hold, now: Date)` /
  `holdWarning(hold, now: Date)` / `isIdempotencyFresh(record, now: Date)`）。
  基準時刻は世界観データの **2026年8月27日（木）11:08 JST**。モックの BOOK-05-CONFIRM は
  statusbar `11:11` に対して「仮の押さえ 11:18 まで」＝ **420 秒**。
- **完了条件**: 11 本が緑。`Date.now()` がこのファイルに 1 度も出てこない。
- **依存**: T-002

## T-005 確定と受付セッションの integration テストを書く（Red）

- **目的**: 「枠が取れたときだけ予約が書かれ、取れなかったときは 1 行も書かれない」を固定する。
  409 が返ることで止めず、**D1 の中身**まで見る。あわせて 5 工程の下書きが復せることを固定する。
- **触るファイル**
  - `services/glasses_management/test/booking.integration.test.ts`（新規）
  - `services/glasses_management/test/reception-session.integration.test.ts`（新規）
- **先に書くテスト**（`booking.integration.test.ts`）
  - 予約の確定 > `1 予約で reservations / reservation_purposes / reservation_assignments / audit_events が揃う`
  - 予約の確定 > `占有行は（所要 60 + 片付け 10）÷ 刻み 30 を切り上げた 3 枠 ×（担当 1 + 設備 2）= 9 行できる`
  - 予約の確定 > `応答の予約番号が EY-YYMM-NNNN の形で、reservations.code と一致する`
  - 予約の確定 > `監査は reservation.created 1 件で、同じ correlation_id を持つ`
  - 担当が未定 > `target_id は NULL、占有行の target_key は unassigned で枠を消費する`
  - 担当が未定 > `同時受付上限 3 の店では 3 件目まで同じ 11:00 に成立する`
  - 担当が未定 > `4 件目は 409 slot_taken で落ちる`
  - 枠の競合 > `担当の枠が上限まで埋まっていたら 409 slot_taken を返す`
  - 枠の競合 > `409 のとき reservations / reservation_purposes / reservation_assignments / audit_events / reservation_slot_locks に 1 行も増えていない`
  - 枠の競合 > `409 の応答に代わりの時刻が 3 件まで載る`
  - 冪等 > `同じ Idempotency-Key の再送で予約は 1 件、応答の予約番号も同じ`
  - 冪等 > `同じ鍵で本文が違えば 409 idempotency_conflict で、予約は増えない`
  - 冪等 > `処理中（in_progress）の鍵に再送が来ても 409 idempotency_conflict`
  - 冪等 > `枠が取れなかったときは in_progress の行を消して、同じ鍵で選び直せる`
  - 冪等 > `予約番号の衝突による打ち直しでは in_progress を消さない`
  - 仮の押さえ > `POST /api/staff/holds は 2 台が同じ枠を押さえても両方 200 を返す`
  - 仮の押さえ > `holdId が期限切れでも確定は 404 にも 409 にもならない`
- **先に書くテスト**（`reception-session.integration.test.ts`）
  - 受付セッション > `始めると進行中（outcome も ended_at も NULL）の行が 1 件できる`
  - 受付セッション > `下書きを保存して読み直すと、選んだ id と打ちかけの文字が戻る`
  - 受付セッション > `下書きにお客様の氏名・電話番号そのものを入れて送ると 400 で落ちる`
  - 受付セッション > `確定すると outcome=booked・reservation_id が入り、draft_json が NULL に戻る`
  - 受付セッション > `やめると outcome=discarded で行は残り、reservation_id は NULL のまま`
  - 受付セッション > `終わった受付の下書きは更新できない（409 invalid_transition）`
- **実装のための注意**: D1 はテストファイル内で共有されるので、組織 id は毎回 `crypto.randomUUID()` で作る
  （`test/helpers.ts` の `orgId()`）。店舗・担当・設備・目的・営業時間は P1 / P2 が作った
  ヘルパーで用意し、このフェーズで別の作り方を発明しない。
- **完了条件**: 23 本が緑。
- **依存**: T-002

## T-006 権限マトリクスとテナント分離に行を足す（Red）

- **目的**: 新しい 6 ルートが default-deny の外へ漏れていないこと、他テナントの枠に手が届かないことを固定する。
- **触るファイル**
  - `services/glasses_management/test/permissions.test.ts`（表に 6 行）
  - `services/glasses_management/test/tenant-isolation.test.ts`（追記）
- **先に書くテスト**
  - 権限の表に 6 行を足す（主体 5 種 = 未認証 / staff / admin / 期限切れ / 別 secret 署名）:
    `POST /api/staff/holds` / `DELETE /api/staff/holds/:holdId` / `POST /api/staff/reservations` /
    `POST /api/staff/reception-sessions` / `PATCH /api/staff/reception-sessions/:sessionId` /
    `POST /api/staff/reception-sessions/:sessionId/close`
    → 未認証・期限切れ・別 secret は **401**、staff と admin は 200 系または 400 系（403 にしない。
    予約の受付は店長限定ではない）
  - テナント分離 > `他テナントの店舗 id で枠を押さえても、その組織の鍵空間にしか書かれない`
  - テナント分離 > `他テナントの holdId を消そうとしても 404 で、相手の押さえは残る`
  - テナント分離 > `他テナントの receptionSessionId を指した確定は 404 で、予約はできない`
  - テナント分離 > `同じ Idempotency-Key を 2 テナントが同時に使っても互いに衝突しない`
  - テナント分離 > `他テナントの予約 id で監査を引けない`
- **実装**: まだ書かない（T-010 で書く）。**期待した理由で赤いことを目で見る。**
- **完了条件**: 権限 30 本・テナント分離 5 本が緑。
- **依存**: T-002

## T-007 採番・冪等・制約の翻訳を実装する（Green）

- **目的**: T-003 を緑にする。D1 のメッセージの形に依存する場所を 1 か所に閉じ込める。
- **触るファイル**
  - `services/glasses_management/src/worker/db/constraint.ts`（新規）
  - `services/glasses_management/src/worker/domain/reservation-code.ts`（新規）
  - `services/glasses_management/src/worker/domain/idempotency.ts`（新規）
- **先に書くテスト**: T-003 の 11 本。ここでは足さない。
- **実装**
  - `constraintTable(err: unknown): string | null` — `message` の中の
    `UNIQUE constraint failed: <表>.<列>` と `SQLITE_CONSTRAINT_UNIQUE` / `_PRIMARYKEY` だけを見る。
    **メッセージの形に依存してよいのはこの関数だけ**とコメントに明記する。
  - `nextReservationCode(db, organizationId, now: Date)` — JST の `YYMM` で
    `MAX(code)` を引いて +1、4 桁ゼロ埋め。9999 の次は 5 桁。
  - 冪等は `design/04-api.md` §6.2 の 4 手順のまま:
    ① `insert ... on conflict do nothing` で `in_progress`
    ② 入らなかったら `request_hash` 不一致 → 409 / `done` → `response_json` をそのまま返す /
    `in_progress` → 409
    ③ 本処理と `done` 化を**同じ `db.batch()`**
    ④ 失敗したら `in_progress` を消す。**採番の打ち直しは失敗に数えない**
  - `key` は `<organization_id>:reservation.create:<Idempotency-Key ヘッダー値>`。
    `request_hash` は正規化した JSON body の SHA-256 hex（64 文字）。
- **完了条件**: T-003 の 11 本が緑。
- **依存**: T-003

## T-008 仮の押さえ（KV）を実装する（Green）

- **目的**: 復唱の間に別の端末が同じ枠を触ったことを早く気づかせる。**排他ではない**。
- **触るファイル**
  - `services/glasses_management/src/worker/domain/holds.ts`（新規）
  - `services/glasses_management/src/worker/domain/availability.ts`（P2 の実装に押さえを混ぜる 1 か所）
- **先に書くテスト**: T-004 の 11 本と T-005 の仮の押さえ 2 本。ここでは足さない。
- **実装**
  - 鍵は `hold:<orgId>:<storeId>:<holdId>` の **1 通りだけ**。TTL **420 秒**。
  - `KV.put` の第 3 引数 `metadata` に `{ kind, targetId, startsAt, endsAt, receptionSessionId }` を載せる。
  - 空き枠エンジンは `KV.list({ prefix: 'hold:<orgId>:<storeId>:' })` を **1 回だけ**叩き、
    返る metadata をそのまま塞がりに数える。1 予約 3 本（担当 1 + 設備 2）。
  - **同じ `receptionSessionId` の押さえは塞がりに数えない**（自分の受付が自分の押さえに当たると、
    11:00 に置いてから 11:30 へ動かしたときに 11:00 が 7 分間だれにも取れなくなる）。
  - **`/api/public/**` から KV を読まない**（list は無料枠 1,000 回/日で、Web 予約の閲覧数がそのまま list 数になる）。
  - `POST /api/staff/holds` は **409 を返さない。常に 200**。KV に CAS が無く「取れなかった」を判定できない。
  - Q-06 の前提: 延長の API を作らない。押し直しは `DELETE` → `POST` の 2 本。
- **完了条件**: T-005 の押さえ 2 本が緑。`KV.list` の呼び出しが空き枠 1 回につき 1 回であることを
  テストのモックで数えて確かめる。
- **依存**: T-004, T-005

## T-009 確定の 1 バッチを実装する（Green）

- **目的**: 枠が取れたかどうかを、確定のバッチの中だけで決める。読んでから書くまでの窓を作らない。
- **触るファイル**: `services/glasses_management/src/worker/domain/booking.ts`（新規）
- **先に書くテスト**: T-005 の `booking.integration.test.ts` 17 本。ここでは足さない。
- **実装**（順序を変えない。SQL の実物は `design/03-data-model.md` §7.6）
  1. `reservation_slot_locks` への**上限つき条件付き INSERT** を枠の本数ぶん並べる。
     `INSERT ... SELECT ... WHERE NOT EXISTS (…)` で、`WHERE NOT EXISTS (...)` の中身は
     **この予約が要求する全枠の INSERT に一字一句同じ**にする。自分の行は `l.reservation_id <> ?4` で除く。
     `cap` は `kind='staff'` かつ `target_key <> 'unassigned'` → `staff.max_parallel_reservations`、
     `kind='equipment'` → `equipment.capacity`、`target_key='unassigned'` → `store_slot_rules.max_parallel`。
     上限はハンドラの入口で 1 回読んでパラメータとして渡す。
  2. `reservations` / `reservation_purposes` / `reservation_assignments` / `audit_events` の INSERT。
     **すべてに `WHERE EXISTS (SELECT 1 FROM reservation_slot_locks WHERE reservation_id = ?)` を付ける。**
     D1 の `db.batch()` は 0 行しか当たらない文を失敗と見なさずバッチを中断しないので、
     ガードしないと「枠は取れていないのに予約本体だけが書かれた」状態ができる。
  3. `idempotency_records` を `done` にする（同じバッチの中）。
  - 1 本目の `meta.changes === 0` を **409 `slot_taken`** の合図にする。そのとき予約は 1 行も書かれていない。
  - **確定前に枠を読み直す再検査を置かない。**
  - `reservations.customer_id` は P4 まで常に NULL。お名前・お電話番号は `reception_sessions` に置く。
  - 担当・設備が未定でも `reservation_assignments` の行を作る（`target_id = null`、
    占有行の `target_key = 'unassigned'`）。`kind='staff'` の行は 1 予約にちょうど 1 行。
  - `duration_minutes` は `ends_at - starts_at` の分。`SUM(reservation_purposes.duration_minutes)` と
    等しいとは限らない（「お取りする時間」で長く押さえられる）。
- **完了条件**: T-005 の `booking.integration.test.ts` 17 本が緑。
- **依存**: T-007, T-008

## T-010 ルートをチェーンに足す（Green）

- **目的**: 6 本のルートを RPC のチェーンに載せ、web が `hc<AppType>` から型を受け取れるようにする。
- **触るファイル**
  - `services/glasses_management/src/worker/index.ts`
  - `specs/glasses_management/design/04-api.md`（§3.7 の表に 3 行を足す）
- **先に書くテスト**: T-006 の権限 30 本・テナント分離 5 本。ここでは足さない。
- **実装**
  - `POST /api/staff/holds` → `HoldInput` → `Hold`（**常に 200**）
  - `DELETE /api/staff/holds/:holdId` → `DeletedResult`（404 `not_found`）
  - `POST /api/staff/reservations` → `StaffReservationCreate` + `Idempotency-Key` → `ReservationDetail`
    （409 `slot_taken` / `store_closed` / `purpose_unavailable` / `idempotency_conflict` / `code_exhausted`）
  - `POST /api/staff/reception-sessions` → `ReceptionSessionStart` → `ReceptionSession`
  - `PATCH /api/staff/reception-sessions/:sessionId` → `ReceptionSessionDraftPatch` → `ReceptionSession`
  - `POST /api/staff/reception-sessions/:sessionId/close` → `ReceptionSessionClose` → `ReceptionSession`
  - すべて `zValidator` インラインで受け、返す前に契約のスキーマで `parse` する。
  - `except([...])` の除外リストを**触らない**（`/api/staff/**` は default-deny のまま守られる）。
  - **設計文書の穴を埋める**: `design/04-api.md` §3.7 は受付セッションの **GET 2 本しか持っていない**。
    書く側の 3 本をこのフェーズで足すので、同じコミットで §3.7 の表にも 3 行を書き加える
    （入力・出力・主なエラー・使う画面 = BOOK-01〜05 / HOME「受けかけのご予約」）。
    **表に載せないままルートを増やさない。**
- **完了条件**: `pnpm --filter @app/glasses_management test` が緑、Worker 側カバレッジ 4 指標 80% 以上。
  `export type AppType = typeof routes` に 6 本が載っている。
- **依存**: T-006, T-009

## T-011 受付の器を作る（Red → Green）

- **目的**: 受付の 5 工程が同じ器の上で動き、いまどの工程にいるか・録音がどこにあるかが工程を移っても変わらない状態にする。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 受話器を持ったまま、いまどの工程にいるかを見失わずに次の 1 問へ進む面。
  - トークン計画: 面は白（`--color-surface`）1 枚と右の要約 1 枚の 2 段だけ。緑（`--color-pine`）は
    いまの工程の札と「次へ」の丸だけに使い、赤（`--color-danger`）は録音と警告だけに使う。角は 8/12/999。
  - シグネチャ: **下端 76px の帯が 5 工程・録音・次へを常に同じ位置で持ち、工程を移っても動かないこと**。
- **触るファイル**
  - `services/glasses_management/src/web/book/{BookingFlow.tsx,StepBar.tsx,useReception.ts,types.ts}`（新規）
  - `services/glasses_management/src/web/book/{BookingFlow.test.tsx,StepBar.test.tsx}`（新規）
  - `services/glasses_management/src/web/App.tsx`（`/book/*` の 6 ルートを足す）
  - `packages/ui/src/components.tsx` / `index.ts`（`StepBar` / `RecordingBadge` を export）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test:web`）
  - 工程の帯 > `5 つの工程を順番に持ち、いまの工程に aria-current="step" が付く`
  - 工程の帯 > `済んだ工程には ✓ が付き、押せる操作としては現れない`
  - 工程の帯 > `ol の aria-label が「予約の工程　全5工程」で、読み上げで順番が分かる`
  - 工程の帯 > `戻るのは左端の ‹ だけで、押すと 1 つ前の工程へ戻る`
  - 録音の置き場所 > `工程 1 から工程 4 まで、録音の表示が帯の中の同じ位置にある`
  - 録音の置き場所 > `工程 5 では右下 20/20 の常駐表示に移る`
  - 出口 > `「やめる」を押すと 2 択（入力をやめる／続ける）の確認が出る`
  - 出口 > `「続ける」を選ぶとその工程に留まり、入力が残っている`
  - 出口 > `「入力をやめる」を選ぶとトップへ戻り、受付は discarded として閉じる`
  - 出口 > `「あとで続ける」は受付を進行中のまま残し、押さえを解放してトップへ戻る`
  - 下書き > `受付セッション id だけを sessionStorage に置き、氏名・電話番号は置かない`
  - 下書き > `読み込み直しても、受付セッション id からサーバの下書きで工程が復る`
- **実装の要点**（モック BOOK-01〜05 の実測値。すべて `packages/ui/src/theme.css` のトークン経由で書く）
  - 端末 1194×834。上のバー 64px（P0 の `AppShell` を再利用）。**予約フローはサイドバーを出さない**。
  - 下の帯 `.stepbar` = **高さ 76px・左右 18px・要素の間 14px・上に 1px の罫**。
  - 戻る `‹` = **48×48px の丸**、`--color-line-strong` の 1px 罫。
  - 工程の札 = **最小高 36px・左右 14px・角 999px**。未通過は `--color-surface-2`、
    通過は `--color-pine-soft` + `--color-pine-deep`、現在は `--color-pine` + 白。文字 14px/600。
  - 札のあいだの `›` は `--color-ink-faint` の 12px。
  - 録音のピル `.rec` = **最小高 48px・左右 14px・角 999px**、`--color-danger` の 1px 罫、
    地は `--color-danger-soft`、点 12px、時間はモノスペース 15px。`role="status"`。
  - 「次へ」`.fab` = **64×64px の丸**、`--color-pine`。押せないときの地は `--color-busy`。
  - **押せない `.fab` に理由を必ず持たせる**（`aria-label="次へ進む　お客様が決まると進めます"`）。
    モックの BOOK-02b / 03 / 03b / 03c は理由を持っていない。実装では 4 画面とも足す。
  - 工程バーを `<nav>` にしない。`<ol aria-label="予約の工程　全5工程">` にする。
  - 下書きは **サーバの `reception_sessions`** に持たせ、端末には受付セッション id と選んだ id だけ。
  - マイクの許可は「新しい予約を取る」を押した**その操作の中で**求める（Safari の制約）。
    許可の取得と失敗の面は P7（`010-recording`）。ここは器と起点だけ。
- **完了条件**: web テスト 12 本が緑、web 側カバレッジ 4 指標 60% 以上。
- **依存**: T-010

## T-012 工程 1 — お日にちとお時間（BOOK-01-DATETIME）

- **目的**: 工程 1 の「日 → 時間」の 2 問を、サーバが返した枠だけで組み立てる。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 「お日にちはいつがよろしいですか？」と声に出す順のまま、日 → 時間の 2 問だけを置く面。
  - トークン計画: 選んだ札だけが `--color-pine` の 3px 罫 + `--color-pine-soft`。押せない札は
    `--color-surface-2` + `--color-ink-faint` に沈め、**必ず「定休」「満席」の文字を添える**。
  - シグネチャ: 右 372px の要約が、伺えていない欄を「このあと伺います」と言い切って空けておくこと。
- **見るモック**: `docs/frontend/mockups/eye/images/BOOK-01-DATETIME.png`
  - 本文と要約は **1fr / 372px** の 2 列、境目に 1px の罫。本文の余白 36px 44px、要約 36px 28px。
  - カレンダーは 7 列・間 8px、日の札は**最小高 58px**・角 8px・文字 18px/600、曜日見出し 12px。
    選択中は 3px の緑罫 + `--color-pine-soft`。定休は `--color-surface-2` + 10px の「定休」。
  - 時刻の札は 4 列・間 14px、**最小高 72px**・角 12px・文字 19px/600、補足 11px（「あと2枠」「満席」）。
  - 質問と質問のあいだは 44px。
  - 要約は `dt` 12px（上に 22px）/ `dd` 17px/600。
- **触るファイル**
  - `services/glasses_management/src/web/book/DateTimeStep.tsx`（新規）
  - `services/glasses_management/src/web/book/DateTimeStep.test.tsx`（新規）
  - `services/glasses_management/src/web/book/BookingFlow.tsx`（工程 1 を差し込む）
- **先に書くテスト**（`src/web/book/DateTimeStep.test.tsx`）
  - 工程 1 > `日付も時刻も選んでいないと「次へ進む」が押せず、理由が読み上げで分かる`
  - 工程 1 > `定休日の札に「定休」と書いてあり、押せない`
  - 工程 1 > `埋まっている時刻の札に「満席」と書いてあり、押せない`
  - 工程 1 > `空いている時刻の札に残り枠数（あと2枠）が出る`
  - 工程 1 > `日付と時刻を 1 つずつ選ぶと「次へ進む」が押せるようになる`
  - 工程 1 > `右の要約に選んだ日と時刻が入り、目的とお客様は「このあと伺います」のまま`
  - 工程 1 > `選んだ日の空き枠が 0 件なら、時刻の札がすべて「満席」になる`
  - 工程 1 > `読み込み中は札の枠だけを出し、回るアイコンを置かない`
- **実装**: `GET /api/staff/availability`（`storeId` / `date` / `axis=staff` /
  `excludeReceptionSessionId`）**1 本だけ**で描く（`07-nfr.md` §4.1）。
  目的が未確定なので所要は暫定。「受け付けられる時刻だけを出しています。目的を伺ったあとに、もう一度確かめます。」を添える。
  モックの 8 枠に 12:00 台が無いのは**受付を止める帯（お昼 12:00–13:00）**があるためで、
  枠を間引く分岐を画面側に書かない（サーバの結果をそのまま並べる）。
- **完了条件**: 8 本が緑。
- **依存**: T-011

## T-013 工程 2 — ご来店の目的と、収まらないときの面（BOOK-02-PURPOSE / BOOK-02b）

- **目的**: 工程 2 でご用件と所要を決め、収まらないときに工程を戻さず同じ面で選び直せるようにする。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 「本日はどのようなご用件でしょうか？」の 1 問と、その答えで所要が決まる面。
  - トークン計画: 目的の札は白 1 面、選ぶと 3px の緑罫 + `--color-pine-soft` + 「✓ 選んでいます」。
    収まらないときだけ `--color-danger-soft` の箱を 1 枚だけ足す（白い箱は 3 枚まで）。
  - シグネチャ: 収まらない理由を**1 文**で言い、代わりの時刻を**同じ面**に 3 つ並べて工程を戻さないこと。
- **見るモック**: `BOOK-02-PURPOSE.png` / `BOOK-02b-PURPOSE-CONFLICT.png`
  - 目的の札は 3 列・間 12px・**最小高 96px**・角 12px、題 17px/600、所要 13px、
    「✓ 選んでいます」12px/600（`--color-pine-deep`）。
  - 「お取りする時間」は 4 列・間 14px・**最小高 64px**、45分 短め / 60分 標準 / 75分 ゆっくり / 90分 じっくり。
  - 警告の箱は 24px 26px の内側余白、見出し 21px（`--color-danger`）、理由 15px（下 20px）、
    代替の札は最小高 56px・文字 18px。
  - 要約の「ご来店時刻」に「受付できません」の札が付き、「所要時間 約60分」が増える。
- **触るファイル**
  - `services/glasses_management/src/web/book/PurposeStep.tsx`（新規）
  - `services/glasses_management/src/web/book/PurposeStep.test.tsx`（新規）
  - `services/glasses_management/src/web/book/BookingFlow.tsx`（工程 2 を差し込む）
- **先に書くテスト**（`src/web/book/PurposeStep.test.tsx`）
  - 工程 2 > `目的を押すと「✓ 選んでいます」が付き、お取りする時間の「60分 標準」が選ばれる`
  - 工程 2 > `右の要約に「11:00–12:00 で受け付けられます。」が出て「次へ進む」が押せる`
  - 工程 2 > `お取りする時間を 90分 に変えると、その所要で空き枠を取り直す`
  - 収まらないとき > `「11:00 から60分の受付ができません」と理由が 1 文で出る`
  - 収まらないとき > `代わりに取れる時刻が 3 つまで並ぶ`
  - 収まらないとき > `要約のご来店時刻に「受付できません」の札が付き、「次へ進む」が押せない`
  - 収まらないとき > `代わりの時刻を押すと、目的と所要は残ったまま時刻だけ差し替わる`
  - 収まらないとき > `代わりの時刻が 0 件なら「この日は 60分 の枠が空いていません。」と「別の日を選ぶ」を出す`
  - 工程 2 > `目的の並びが設定（P1）の並び順と一致する`
- **実装**: 目的の一覧は P1 の `GET /api/staff/purposes`、可否は `GET /api/staff/availability`。
  理由は `AvailabilityReason` の 11 値をそのまま文にする（`maintenance` →「{設備}が {時刻} から点検です。」）。
  **3 事由を 1 文で束ねない。**
  目的は P1 の seed が入れた **6 件**をそのまま描く（`03-data-model.md` §6.1 が正本）:
  メガネを新しく作る 60 / 今のメガネを調整したい 20 / できあがりを受け取る 20 /
  修理・部品交換 30（Web 非公開）/ **コンタクトの相談 40** / 視力測定だけ 30。
  **マスタープラン §5 の目的表（`フィッティング(30)` を含み `コンタクトの相談(40)` を含まない）は誤り**で、
  `フィッティング` は目的ではなく技能である（§5.2）。モックの BOOK-02 が描く
  「コンタクトの相談 約40分」は seed と一致するので、ここは差にならない。モックの画像は直さない。
- **完了条件**: 9 本が緑。
- **依存**: T-012

## T-014 工程 3 — 担当と場所、重なりの警告（BOOK-03-SLOT-STAFF / BOOK-03b）

- **目的**: 工程 3 で担当と場所を決め、先約との重なりを目と文字の両方で見せる。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 希望時刻に帯を置いてみて、先約とぶつかるかどうかを目で見る面。
  - トークン計画: 先約は `--color-busy` の灰、いま置いている帯は `--color-danger` の 2px 罫、
    置ける場所は `--color-pine-line` の破線。**色だけで伝えず、帯の中に「重なっています」「ここに置けます」を書く。**
  - シグネチャ: 縦軸を担当 ⇄ 設備で入れ替えても、選んだものが保たれること。
- **見るモック**: `BOOK-03-SLOT-STAFF.png` / `BOOK-03b-SLOT-RESOURCE.png`
  - 盤は **左の名前列 170px + 30 分刻み 8 列**（10:00–14:00）。右の相談欄は **330px**（本文 1fr）。
  - 見出し行は最小高 34px、名前セルと時間セルは**最小高 64px**、帯は最小高 54px・角 8px・左に 4px の色帯。
  - 相談欄の余白は 28px 24px。候補のボタンは**最小高 56px**・角 12px・文字 16px/600、補足 12px、間 10px。
  - 警告カードは `--color-danger-soft`、見出し「佐藤 美咲 に 11:00 の先約があります」。
  - 承れない担当の行は斜線塗り + 「この用件は承れません」。
  - 「担当はあとで決める」は相談欄の最下段。設備軸では「設備はあとで決める」。
- **触るファイル**
  - `services/glasses_management/src/web/book/SlotStep.tsx`（新規）
  - `services/glasses_management/src/web/book/SlotStep.test.tsx`（新規）
  - `services/glasses_management/src/web/book/BookingFlow.tsx`（工程 3 を差し込む）
- **先に書くテスト**（`src/web/book/SlotStep.test.tsx`）
  - 工程 3 > `希望時刻の位置に「このご予約」の帯が置かれる`
  - 重なり > `先約の上に帯が重なって「重なっています」と書かれる`
  - 重なり > `右に「佐藤 美咲 に 11:00 の先約があります」と出て「次へ進む」が押せない`
  - 重なり > `「同じ 11:00 で受けられる担当」の候補を押すと帯がその行へ移り、重なりが消える`
  - 重なり > `重なりが消えると「次へ進む」が押せるようになる`
  - 軸の切り替え > `「設備・場所」に切り替えると縦軸が設備になり「同じ 11:00 で使える設備」が出る`
  - 軸の切り替え > `「担当者」に戻すと、選んでいた担当が保たれている`
  - 技能 > `その目的を受けられない担当の行に「この用件は承れません」と書かれる`
  - 未定 > `「担当はあとで決める」を押すと未定のまま工程 4 へ進める`
  - 未定 > `「設備はあとで決める」を押しても、選んでいた担当は残る`
  - 押せない理由 > `重なっている間の「次へ進む」に「重なりを解くと進めます」が読み上げられる`
- **実装**: `GET /api/staff/availability`（`axis=staff` / `axis=resource`）1 本で描く。
  帯は `@app/ui` の `Appointment`、盤は `TimeGrid` を使う（`05-screen-flow.md` §2.7 の置き場所表）。
  設備軸では 1 予約が複数行に同時に現れる。点検中の設備は候補に出さない。
  枠を選んだら `POST /api/staff/holds` を担当 1 + 設備 0〜2 の本数ぶん打ち、
  選び直したら古い押さえを `DELETE /api/staff/holds/:holdId` で返す。
- **完了条件**: 11 本が緑。
- **依存**: T-013

## T-015 工程 3 のドラッグ移動（BOOK-03c-DRAG）

- **目的**: 置いた帯を指でつかんで別の担当・時刻へ運べるようにし、置けない場所には理由を添える。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 電話をつないだまま、置いた帯を指でつかんで別の担当・時刻へ運ぶ面。
  - トークン計画: もとの場所は不透明度 .35 に落とし、置く先は `--color-pine-line` の破線。
    運んでいる帯だけが影を持つ。**新しい色を足さない。**
  - シグネチャ: つまみ（`⠿`）を持ってから離すまで、行き先の時刻がツールバーの丸い札を追いかけること。
- **見るモック**: `BOOK-03c-DRAG.png`
  - ツールバーの行き先の札は角 999px・地 `--color-pine-soft`・1px の `--color-pine-line` 罫、
    時刻 22px/700 + 所要 13px/600、内側 6px 16px。
  - もとの場所の帯は「もとの場所 11:00–12:00」と書いて**不透明度 .35**。
  - 置く先は破線の枠 + 下端から 9px の位置に「13:00–14:00 へ」（14px）。
  - 右の「確保するもの」は 担当 / 設備 / 場所 の 3 行、ラベル列 44px・13px、値 17px + 補足 13px。
  - 最下段に「もとの 11:00 に戻す」。
- **触るファイル**
  - `services/glasses_management/src/web/book/SlotDrag.tsx`（新規）
  - `services/glasses_management/src/web/book/SlotDrag.test.tsx`（新規）
  - `services/glasses_management/src/web/book/SlotStep.tsx`（つまみとドロップ先を足す）
- **先に書くテスト**（`src/web/book/SlotDrag.test.tsx`）
  - ドラッグ > `つまみをつかむと、もとの場所が薄く残る`
  - ドラッグ > `運んでいる先に点線の枠と「13:00–14:00 へ」が出る`
  - ドラッグ > `右に「指を離すと、この時刻で確保します」と重なりの有無が出る`
  - ドラッグ > `運んでいる間は「次へ進む」が押せず「指を離すと進めます」が読み上げられる`
  - ドラッグ > `指を離すとその担当・時刻で確保され、押さえを取り直す`
  - ドラッグ > `別の担当の行まで運ぶと担当ごと変わる`
  - ドラッグ > `「もとの 11:00 に戻す」を押すと元の位置と元の担当へ戻る`
  - 置けない場所 > `点検中の設備へ運ぶと点線の枠を出さず「ここには置けません（視力測定機 B は点検中です）」と理由を添える`
  - 置けない場所 > `営業時間の外・勤務の外でも同じく置けず、指を離すと元の位置へ戻る`
  - 刻み > `座標がずれても 30 分の刻みと担当の行へ吸着する`
- **実装**: Pointer Events で受ける。`pointerType === 'pen'` が接触している間は `touch` を捨てる。
  盤に `touch-action: none`。筆圧は使わない。**座標そのままの自由配置にしない**（30 分の刻みと行へ吸着）。
  キーボードだけで使う人の代替は候補のボタン（T-014）で満たす。
- **完了条件**: 10 本が緑。
- **依存**: T-014

## T-016 工程 4 — テンキーとお名前・ふりがな（BOOK-04 / 04c）

- **目的**: 工程 4 でお電話番号を片手で打ち切り、伺えないときはお名前だけで進めるようにする。
- **範囲の線引き（守る）**: **候補の吹き出し（BOOK-04b-CUSTOMER-MATCH）はこのフェーズで作らない。**
  候補の元になる `customers` 表は `0004_*.sql`（P4）で初めてできる（`03-data-model.md` §12）。
  AC-BOOK-01〜22 に候補の受け入れ条件は 1 つも無く、候補は AC-CUST-04〜07 の受け持ちである。
  P3 は「番号を打ち終えたらお名前の欄へ進める」ところまでを作り、**候補の 5 本と BOOK-04b の
  突き合わせは P4 T-017 / T-021 が持つ**。

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 受話器を持ったまま片手で番号を打ち、伺えないときはお名前だけで進む面。
  - トークン計画: 番号の欄だけが特大（34px モノスペース）で、ほかは 17px の 1 段に落とす。
    テンキーは白の 3 列で、確定キーだけ `--color-pine`。
  - シグネチャ: 番号の欄の右に残り桁数が出続け、揃うまで「完了」が沈んでいること。
- **見るモック**: `BOOK-04-CUSTOMER.png` / `BOOK-04c-KEYPAD.png`（`BOOK-04b-CUSTOMER-MATCH.png` は P4）
  - BOOK-04: 本文 1fr / 要約 372px。番号の欄は **幅 420px・最小高 96px・34px のモノスペース**、
    字間 .04em、キャレット 3px×38px。お名前とふりがなは 2 列・間 26px・最大 700px・**最小高 60px**。
    ご要望の箱は**最小高 168px**・最大 700px・内側 16px 18px。
  - BOOK-04c: 番号の欄は **幅 520px・最小高 104px**。右の柱に「番号を打つ」。
    テンキーは **3 列 × 96px・間 12px、キーの高さ 72px**、角 12px、数字 28px。
    **左下は「ハイフン」、右下は「削除」ではなく「完了」** — 承認済みモック 7 面のうち 5 面が
    左下ハイフン・右下削除なので、**電話番号の面は 左下「ハイフン」／中央下「0」／右下「完了」**とし、
    「削除」は 3 行目の左（モック BOOK-04c の実測）に置く。確定キーの語は
    電話番号の面が「完了」、暗証番号の面が「確定」。
    キーの下に「あと3桁で「完了」を押せます」（`--color-ink-muted`）。
- **触るファイル**
  - `services/glasses_management/src/web/book/CustomerStep.tsx`（新規）
  - `services/glasses_management/src/web/book/CustomerStep.test.tsx`（新規）
  - `packages/ui/src/components.tsx` / `packages/ui/src/index.ts`（`Keypad` を export。確定キーは `confirmLabel?`）
- **先に書くテスト**（`src/web/book/CustomerStep.test.tsx`）
  - 工程 4 > `お客様が決まるまで「次へ進む」が押せず「お客様が決まると進めます」が読み上げられる`
  - テンキー > `番号の欄を押すと右にテンキーが出て、iPadOS のソフトキーボードは出ない`
  - テンキー > `「090-1234-5」まで打つと「あと3桁」と出て「完了」が押せない`
  - テンキー > `残り 3 桁を打つと「完了」が押せるようになる`
  - テンキー > `「削除」で 1 文字消え、残り桁数の表示が追いかける`
  - テンキー > `テンキーを使っている間も、工程の帯と録音の表示が見えている`
  - テンキー > `「完了」を押すとフォーカスがお名前の欄へ移る`
  - テンキー > `打ち終えた番号は工程 5 の要約にそのまま出る`
  - 名前だけ > `お名前「田中 花子」とふりがな「たなか はなこ」だけで「次へ進む」が押せる`
  - ふりがな > `変換の確定前はふりがなの欄に未確定の文字が入らない`
  - ふりがな > `変換が確定すると 1 度だけ埋まり、「自動で入れました」の 1 行が出る`
  - ふりがな > `人が一度でも直したふりがなは、そのあと自動で上書きされない`
- **実装**
  - 欄は `type="tel"` + `inputmode="numeric"` + `autocomplete="off"`。
    テンキーで打つ欄は `inputMode="none"`（ソフトキーボードを出さない）。
  - 物理キーボードは前提にしない。つないである場合の数字・Backspace・Enter は拾うが、無くても完結する。
  - `compositionstart` 〜 `compositionend` の間は `input` の値を読まない。`compositionend` で 1 回だけ
    ふりがなを埋め、`change`（blur）でももう 1 回拾う二段構えにする。
  - この工程で伺ったお名前・ふりがな・お電話番号は `reception_sessions.draft_json` に置き、
    **顧客台帳と結びつけない**（`customers` が無い。結びつけるのは P4）。
    **候補の照会（`GET /api/staff/customers/lookup`）をここで呼ばない。**
  - キーボードが出る欄では、工程の帯と録音の表示を見えている高さの底へ貼り直す。
- **完了条件**: 12 本が緑。
- **依存**: T-015

## T-017 工程 4 の手書き（BOOK-04d-HANDWRITE）

- **目的**: 伺ったことばを文字に直さず、かたちのまま残せるようにする。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 伺ったことばを、文字に直さずかたちのまま残す面。
  - トークン計画: 用紙は白 1 面に `--color-line` の罫だけ。道具は 48pt の白い札で、選んだものだけ緑罫。
  - シグネチャ: 用紙の上をなぞっている間、背後の画面が 1px も動かないこと。
- **見るモック**: `BOOK-04d-HANDWRITE.png`
  - 本文 1fr / 右 **320px**。本文の余白 32px 40px、右 32px 26px。
  - 道具は ペン / マーカー / 消しゴム ｜ 細 / 中 / 太 ｜ 取り消し。仕切りは 1px×32px。
  - 用紙は**高さ 420px**・上に 20px、罫の下に「記入　山田 大輔（店長）　11:04」（右寄せ）。
  - 右の柱は「文字にするとこうなります」の下書き（17px / 行間 2.1）と、最下段に主操作。
- **触るファイル**
  - `services/glasses_management/src/web/book/Handwrite.tsx`（新規）
  - `services/glasses_management/src/web/book/Handwrite.test.tsx`（新規）
  - `services/glasses_management/src/web/book/CustomerStep.tsx`（「手書きで書く」の入口を足す）
- **先に書くテスト**（`src/web/book/Handwrite.test.tsx`）
  - 手書き > `「手書きで書く」を押すと罫線つきの用紙が出る`
  - 手書き > `「手書きのまま残す」で、文字に変換しないままご要望が残る`
  - 手書き > `残したご要望に記入した人と時刻が添えられる`
  - 手書き > `「文字に変換する」のボタンを画面に出さない`
  - 手書き > `用紙の上をなぞっている間、背後の画面がスクロールしない`
  - 手書き > `「キーボードで入力」から同じご要望を文字で残せる`
  - 手書き > `残した筆跡に role="img" と読み上げ用の説明が付く`
- **実装**
  - **「文字に変換する」を出さない。** 無料枠の構成にサーバ側の文字認識を置かず、端末側の手書き認識も
    持たないので、押しても何も起きないボタンを画面に出さない（モックの画像は直さない）。
    読み取った文字を人が打ち直す欄は P4（`007-customer-records` の AC-CUST-19）に置く。
  - 用紙は SVG。`touch-action: none` を入れる。筆圧は使わない。
  - 筆跡は R2 へ置き、D1 に筆跡そのものを置かない
    （1 枚 3〜12KB × 5 枚 × 5,000 顧客で 300MB になり、D1 の 500MB の 6 割を手書きが占める）。
    **`reception_sessions` に `handwriting_key` 列は無い**（`03-data-model.md` §8.1 の列表）。
    キーは `notes/{organizationId}/sessions/{receptionSessionId}/{noteId}.svg` にし、
    `draft_json.handwritingKeys`（最大 5 件）に持つ。バケットは `RECORDINGS` binding を使う。
    お客様が決まったあと `customer_notes`（`notes/{organizationId}/{customerId}/{noteId}.svg`）へ
    移すのは **P4 T-012** の仕事で、このフェーズでは移さない。
  - キーボードだけで使う人への代替は BOOK-04-CUSTOMER の「キーボードで入力」（48pt）。
    これが WCAG 2.1.1 の充足根拠になる。
- **完了条件**: 7 本が緑。
- **依存**: T-016

## T-018 工程 5 — 復唱と確定、完了（BOOK-05-CONFIRM / BOOK-06-DONE）

- **目的**: 工程 5 で声に出す文をそのまま出し、確定を 1 回だけ効かせて完了まで通す。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 声に出す文をそのまま大きく置き、言い直しがあった箇所だけへ戻す面。
  - トークン計画: 白い箱は復唱の 1 枚だけ。聞き違えやすい語だけを `--color-pine-deep` の 700 にする。
    確定は `--color-pine` の大きなボタン 1 つで、`.fab` を使わない。
  - シグネチャ: 24px / 行間 2 の文が、声に出す単位で改行されていること。
- **見るモック**: `BOOK-05-CONFIRM.png` / `BOOK-06-DONE.png`
  - BOOK-05: 本文 1fr / 要約 372px。復唱の箱は内側 30px 32px・上に 24px、
    文 **24px / 行間 2**、強い語は 700 + `--color-pine-deep`。
  - 「言い直しがあった箇所だけ直せます」の下に 4 つの戻り口（4 列・間 12px・文字 15px）:
    日にちと時刻 / ご来店の目的 / 担当と場所 / お名前と番号。
  - 要約は 担当 / 設備と場所 / 所要 / 仮の押さえ の 4 項目 + 「3つとも空いています」の札。
  - 録音は右下 20/20 の白カード（2px の `--color-danger` 罫）に移る。
  - 確定は帯の右端の `.btn.primary.big`（**最小高 56px**）。
  - BOOK-06: **stepbar を持たない**。左 1fr / 右 372px、余白 40px 44px / 40px 28px。
    ✓ の丸は **78px**、見出し 30px、予約番号 22px のモノスペース。
    要約は 2 列（`dd` 19px/600）。「続けて予約を取る」「台帳で見る」は上に 40px。
    右は 3 点のお伝えごと（1 行 18px 上下・下に 1px の罫）。
- **触るファイル**
  - `services/glasses_management/src/web/book/ConfirmStep.tsx`（新規）
  - `services/glasses_management/src/web/book/DoneStep.tsx`（新規）
  - `services/glasses_management/src/web/book/{ConfirmStep.test.tsx,DoneStep.test.tsx}`（新規）
- **先に書くテスト**（`src/web/book/ConfirmStep.test.tsx` / `DoneStep.test.tsx`）
  - 復唱 > `文に工程 1 の日付と時刻・工程 2 の所要・工程 4 の名前と番号が入る`
  - 復唱 > `目的は工程 2 で押した札と同じ店内の名前で読み上げられる`
  - 復唱 > `目的を 2 つ選ぶと「と」でつないで読み上げる`
  - 復唱 > `4 つの戻り口から工程 1・2・3・4 へ戻れる`
  - 復唱 > `仮の押さえの残り時間が出て、残り 60 秒で「まだ入力中です」の警告が出る`
  - 確定 > `「復唱を終えて予約を確定する」を押すと完了画面へ移る`
  - 確定 > `続けてもう一度押しても予約は 1 件で、同じ予約番号が返る`
  - 確定 > `確定している間はボタンを disabled にせず aria-busy にしてフォーカスを保つ`
  - 完了 > `「ご予約を承りました」と EY-2608-0142 の形の予約番号が出る`
  - 完了 > `「控えは 090-1234-5678 へお送りしました。」を出さない`
  - 完了 > `代わりに「予約番号 EY-2608-0142 をお控えいただくようお伝えください」を出す`
  - 完了 > `お伝えすること 3 点（10分前 10:50 ごろ／今のメガネ／変更はお電話）が並ぶ`
  - 完了 > `工程の帯を出さない`
- **実装**
  - 復唱の目的は **`visit_purposes.name_internal`** をそのまま読む。台帳の帯だけが `name_short` を使う。
    モックの「視力測定とメガネの新調」は工程 2 の札（「メガネを新しく作る」）と違うので採らない。
  - **控えを送らない。** notifier はメールだけを送り、`to` はメールアドレス型なので、
    お電話番号へ控えを送る手立てが無い（`design/04-api.md` §7）。モックの 1 行は採らない。
  - `Idempotency-Key` は**工程 1 を始めた時点で** `crypto.randomUUID()` で作り、成功するまで同じ値を送る。
  - 確定は `POST /api/staff/reservations` 1 本。完了画面は `GET /api/staff/reservations/:id` 1 本。
  - Q-06 の前提: 残り 60 秒で `role="status"` の警告 + 44pt の「まだ入力中です」。押すと
    `DELETE /api/staff/holds/:holdId` → `POST /api/staff/holds` で 420 秒を取り直す（10 回まで）。
- **完了条件**: 13 本が緑。
- **依存**: T-017

## T-019 枠が先に埋まっていた面（BOOK-CONFLICT）

- **目的**: 確定の瞬間に枠を取られたとき、伺った内容を失わずに選び直せるようにする。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 確定を押した瞬間に枠を取られた人へ、**失われていないもの**を先に言う面。
  - トークン計画: 赤は上の 1 枚だけ。代わりの時刻の札は白のままにして、赤を選択肢へ広げない。
  - シグネチャ: 右の要約で埋まった時刻だけに取り消し線を引き、ほかの入力をそのまま残すこと。
- **見るモック**: `BOOK-CONFLICT.png`
  - 警告の箱は内側 26px 28px、見出し 22px（`--color-danger`）、本文 15px / 行間 1.6。
  - 「同じ担当（佐藤 美咲）でご案内できる時刻」の札は 3 列・**最小高 96px**、時刻 26px/700、設備 13px。
  - 「時刻を変えたくない場合」は 1 枚の横長（**最小高 88px**）で、時刻 26px/700 + 説明 16px/600 + 補足 13px。
  - 要約の埋まった時刻に取り消し線（`--color-danger`）と「埋まりました」の札。
  - 工程の札は `1 done` `2 done` / `3 on` / `4 done` / 5 未通過（工程 3 へ差し戻した状態）。
- **触るファイル**
  - `services/glasses_management/src/web/book/Conflict.tsx`（新規）
  - `services/glasses_management/src/web/book/Conflict.test.tsx`（新規）
  - `services/glasses_management/src/web/book/ConfirmStep.tsx`（409 を受けて差し戻す）
- **先に書くテスト**（`src/web/book/Conflict.test.tsx`）
  - 競合 > `「この枠は、ほかの端末で先に確定されました」と出る`
  - 競合 > `伺った内容が残っていることを先に言い、要約の埋まった時刻に取り消し線が付く`
  - 競合 > `同じ担当で案内できる時刻が 3 つ並ぶ`
  - 競合 > `担当を入れ替える案が 1 つ並ぶ`
  - 競合 > `どれかを選ぶまで「次へ進む」が押せず、理由が読み上げられる`
  - 競合 > `代わりの時刻を選ぶとその場で押さえ直し、工程 5 へ戻る`
  - 競合 > `代替が 0 件なら「この時刻に代わるお時間がありません」と「別の日を選ぶ」だけを出す`
  - 競合 > `選び直した枠も埋まっていたら同じ面を出し直す`
- **実装**: 409 `slot_taken` の応答の `alternatives`（最大 3 件）をそのまま並べる。
  選び直したら `POST /api/staff/holds` で押さえ直す。
  **`Idempotency-Key` は作り直す**（枠が取れなかったときサーバは `in_progress` を消しているので、
  同じ鍵でも通るが、内容が変わるので 409 `idempotency_conflict` になる）。
- **完了条件**: 8 本が緑。web 側カバレッジ 4 指標 60% 以上。
- **依存**: T-018

## T-020 E2E を書き、spec を Approved に上げる

- **目的**: spec の全 UC / AC を Playwright の 1 本ずつに結び、traceability を緑にする。
- **触るファイル**
  - `services/glasses_management/e2e/booking-flow.spec.ts`（新規）
  - `specs/glasses_management/features/006-booking-flow/spec.md`（`- ステータス:` の行）
- **やること**
  - UC-BOOK-01〜15（15 件）と AC-BOOK-01〜22（22 件）の **37 個すべて**に、
    Playwright test を 1 対 1 で対応させる。1 本の test に複数 ID を載せてよい
    （`// @e2e-covers AC-BOOK-03 UC-BOOK-03` のように半角空白区切り）。
    **`@e2e-covers` はその test の直前の行**に置く。`/* */` は使えない。
  - 割り当ては次のとおり（22 本の test で 37 ID を覆う）:
    | test | 載せる ID |
    |---|---|
    | 工程 1 の日時を選ぶ | `AC-BOOK-01 UC-BOOK-01` |
    | 工程 2 の目的と所要 | `AC-BOOK-02 UC-BOOK-02` |
    | 収まらない理由と代替 | `AC-BOOK-03 UC-BOOK-03` |
    | 代替を押しても目的が残る | `AC-BOOK-04` |
    | 先約と重なる | `AC-BOOK-05 UC-BOOK-04` |
    | 候補の担当で解消する | `AC-BOOK-06` |
    | 設備軸へ入れ替える | `AC-BOOK-07 UC-BOOK-05` |
    | 帯を運んで置き直す | `AC-BOOK-08 UC-BOOK-06` |
    | 担当・設備をあとで決める | `AC-BOOK-09 UC-BOOK-07` |
    | テンキーで番号を打つ | `AC-BOOK-10 UC-BOOK-08` |
    | 名前とふりがなだけで進む | `AC-BOOK-11 UC-BOOK-09` |
    | 手書きのまま残す | `AC-BOOK-12 UC-BOOK-10` |
    | 復唱して確定する | `AC-BOOK-13 UC-BOOK-11` |
    | 二度押しても 1 件 | `AC-BOOK-14` |
    | 枠が先に埋まっていた | `AC-BOOK-15 UC-BOOK-12` |
    | 戻っても入力が残る | `AC-BOOK-16 UC-BOOK-13` |
    | やめるの 2 択 | `AC-BOOK-17 UC-BOOK-14` |
    | 録音の置き場所が動かない | `AC-BOOK-18` |
    | 工程を読み上げでたどる | `AC-BOOK-19 UC-BOOK-15` |
    | ソフトキーボードが出ない | `AC-BOOK-20` |
    | 変換確定までふりがなが入らない | `AC-BOOK-21` |
    | 2 台が同時に確定する | `AC-BOOK-22` |
  - `test.only` / `test.skip` / `test.fixme` を 1 つも残さない（validator が落とす）。
  - 書けたら spec の `- ステータス: Draft` を `Approved` に上げる。**上げてよいかを人に確認してから**上げる。
- **先に書くテスト**: この 22 本の Playwright test そのものが検証。
- **実装**: `booking-flow.spec.ts` に割り当て表のとおりの test を並べる。
- **完了条件**: `pnpm --filter @app/glasses_management e2e` が緑、
  `pnpm run test:traceability` が `all approved UC/AC identifiers are mapped exactly once.` を出す。
- **依存**: T-010, T-019

## T-021 モックとの突き合わせ

- **目的**: 承認された見た目からどれだけ離れているかを画素で測って記録に残す。
- **触るファイル**: `services/glasses_management/e2e/mock-compare.spec.ts`（追記）
- **やること**
  - BOOK-01-DATETIME / BOOK-02-PURPOSE / BOOK-02b-PURPOSE-CONFLICT / BOOK-03-SLOT-STAFF /
    BOOK-03b-SLOT-RESOURCE / BOOK-03c-DRAG / BOOK-04-CUSTOMER /
    BOOK-04c-KEYPAD / BOOK-04d-HANDWRITE / BOOK-05-CONFIRM / BOOK-06-DONE / BOOK-CONFLICT の **12 面**を
    （**BOOK-04b-CUSTOMER-MATCH は P4 T-021 が撮る。**候補の元になる `customers` がまだ無い）
    `toHaveScreenshot('<画面ID>.png', { scale: 'device', maxDiffPixelRatio: ... })` で撮る。
  - `mock` project（1194×810 / deviceScaleFactor 2）で走らせる。基準は `reference/`（ステータスバーを外した派生物）。
  - `maxDiffPixelRatio` は「いま許している差」。**残っている差が何かをコメントに 1 行ずつ書く。**
    既知で許してよい差は 3 つだけ:
    ①BOOK-05 の復唱文の目的（`name_internal` に揃えた）
    ②BOOK-06 の「控えは 090-… へお送りしました。」（出さないと決めた）
    ③上のバーの「お知らせ 3」（P10 で入る）
  - **値は下げるだけ。上げてはいけない。**
- **先に書くテスト**: なし（`toHaveScreenshot` そのものが検証）。
- **実装**: 12 面の `toHaveScreenshot` と、許している差のコメント。
- **完了条件**: `pnpm --filter @app/glasses_management exec playwright test --project=mock` が緑。
  12 面すべてが `maxDiffPixelRatio` 0.08 以下、BOOK-01 / BOOK-04c / BOOK-06 は 0.04 以下。
- **依存**: T-020

## T-022 完了の確認

- **目的**: このフェーズの全ゲートを実際に走らせ、緑であることを結果で確かめる。
- **触るファイル**: `knip.jsonc`（新しい entry がある場合のみ）／進捗台帳
- **先に書くテスト**: なし（ここで新しいテストを書かない。足りなければ元のタスクへ戻る）
- **実装**: 下の 6 本を上から順に走らせ、落ちたら原因のタスクへ戻る。

```sh
pnpm run lint          # 緑
pnpm run deps:check    # 緑
pnpm run typecheck     # 緑
pnpm run test          # 緑（traceability を含む）
pnpm --filter @app/glasses_management e2e   # 緑
pnpm --filter @app/glasses_management exec playwright test --project=mock   # 緑
```

- Worker 側カバレッジ 4 指標 80% 以上 / web 側 60% 以上。**閾値を下げない・広く除外しない。**
- 進捗台帳（`docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md`）に、
  実行したコマンドとその結果・カバレッジの実測値・`maxDiffPixelRatio` の実測値を書く。
- **完了条件**: 上の 6 本がすべて緑。spec が `- ステータス: Approved`。進捗台帳に実測値を書いた。
- **依存**: T-021
