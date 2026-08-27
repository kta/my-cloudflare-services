# EYEX 台帳・来店・検索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 選択中店舗に閉じた予約台帳、ウォークイン、来店進捗、予約検索・変更・取消と追記型履歴を実装する。

**Architecture:** `packages/contracts` に全入力・出力をZodで定義し、`glasses_management` D1に予約の進捗・変更履歴・ウォークインを保存する。すべての読書きはJWTの`organizationId`とURLの`storeId`を認可根拠にし、状態変更と監査イベントは同一`db.batch()`で失敗時に成立させない。

**Tech Stack:** Cloudflare Workers/D1、Drizzle、Hono、Zod、Vitest workers。

**Spec:** `specs/glasses_management/features/002-eyex-reservation-product/spec.md`（UC-EYEX-043–062、AC-EYEX-11–26・56–62）、`docs/superpowers/specs/2026-08-26-glasses-management-design.md`、`docs/superpowers/plans/2026-08-26-glasses-management-roadmap.md`。

## Global Constraints

- 全業務行と全D1 queryをJWT由来`organization_id`でスコープし、選択中`storeId`への権限を先に確認する。
- FKを作らず、IDは`crypto.randomUUID()`、複数書込みは`db.batch()`、監査失敗時は業務変更を成立させない。
- APIはZod単一ソースとHono route chainを使い、version不一致は409、権限外は403、未認証は401にする。
- UTC ISO日時を保存し、表示用の日付・現在時刻はJSTかつ注入時計で判定する。

---

### Task 1: 台帳読取と来店進捗の契約・保存

**Files:**
- Modify: `packages/contracts/src/glasses_management.ts`
- Modify: `services/glasses_management/src/worker/db/schema.ts`
- Create: `services/glasses_management/migrations/0008_*.sql`
- Modify: `services/glasses_management/src/worker/index.ts`
- Test: `services/glasses_management/test/ledger.integration.test.ts`

- [x] 失敗する統合テストを追加し、同日の予約をsource/status/担当・設備表示付きで取得し、`checked_in`・工程更新がversion比較と監査を伴うことを確認する。
- [x] 対象テストを実行し、route不存在でRedを確認する。
- [x] `LedgerEntry`、`ReservationProgressPatch`、`LedgerQuery`をstrict Zodとして追加し、予約に進捗列、工程イベント表、適切な組織・店舗・時刻indexをmigrationへ追加する。
- [x] `GET /api/staff/stores/:storeId/ledger` と `PATCH /api/staff/stores/:storeId/reservations/:reservationId/progress` を実装する。PATCHは`version`をCAS条件にし、予約更新と`reservation.progress_updated`監査を同一batchに置く。
- [x] integration test、typecheck、migration適用をGreenにする。Luna Max再レビュー済み（Critical / Importantなし）。

### Task 2: ウォークイン・顧客後関連付け・未登録退店

**Files:**
- Modify: `packages/contracts/src/glasses_management.ts`
- Modify: `services/glasses_management/src/worker/db/schema.ts`
- Create: `services/glasses_management/migrations/0009_*.sql`
- Modify: `services/glasses_management/src/worker/index.ts`
- Test: `services/glasses_management/test/walkins.integration.test.ts`

- [ ] 顧客なしウォークイン作成、既存顧客関連付け、新規顧客作成関連付け、未登録退店検索の失敗テストを追加する。
- [ ] route不存在でRedを確認する。
- [ ] `walkins`表（仮識別子、customerId nullable、status、進捗、version、時刻）と履歴表をmigrationへ追加する。
- [ ] `POST /walkins`、`PATCH /walkins/:id/customer`、`PATCH /walkins/:id/progress`、`GET /walkins`を実装する。customer作成/関連付け/監査は同一batch、他店・他組織入力は403とする。
- [ ] integration、tenant-isolation、permissionsをGreenにする。

### Task 3: 予約検索・詳細・変更・取消と履歴

**Files:**
- Modify: `packages/contracts/src/glasses_management.ts`
- Modify: `services/glasses_management/src/worker/db/schema.ts`
- Create: `services/glasses_management/migrations/0010_*.sql`
- Modify: `services/glasses_management/src/worker/index.ts`
- Test: `services/glasses_management/test/reservation-lifecycle.integration.test.ts`

- [ ] 氏名/かな/正規化電話/予約番号検索、期間/source/status絞込み、取消理由必須、競合変更が元予約を保持、version競合の失敗テストを追加する。
- [ ] route不存在または不正結果でRedを確認する。
- [ ] `reservation_changes`追記表と検索indexを追加し、`GET /reservations`、`GET /reservations/:id`、`PATCH /reservations/:id`、`POST /reservations/:id/cancel`を実装する。
- [ ] 変更では新枠の資源claimを予約・旧claim解放・投影・履歴・監査と同一batchにし、確保不能なら元予約を不変にする。取消は理由・確認入力を必須にし履歴と監査を同一batchに置く。
- [ ] 全integration・権限・テナント分離をGreenにする。

### Task 4: 受付履歴・警告とレビュー

**Files:**
- Modify: `packages/contracts/src/glasses_management.ts`
- Modify: `services/glasses_management/src/worker/index.ts`
- Test: `services/glasses_management/test/reception-history.integration.test.ts`
- Modify: `services/glasses_management/test/permissions.test.ts`
- Modify: `services/glasses_management/test/tenant-isolation.test.ts`

- [ ] 予約受付/変更/取消/ウォークインを時系列で検索し、店舗固定・要確認絞込み・予約詳細維持・長時間待機警告を確認する失敗テストを追加する。
- [ ] Redを確認する。
- [ ] 既存の`audit_events`と進捗時刻から`GET /reception-history`と台帳警告を構成し、録音状態は録音フェーズまで`none`として明示する。
- [ ] route matrixに新APIを追加し、時間境界・3組織分離をGreenにする。
- [ ] Luna Maxの読み取り専用レビューを実行し、Critical/ImportantをTDDで解消して再レビューする。

## Self-review

- UC 043–054 はTask 1/2/4、UC 055–062 はTask 3/4、AC 11–26・56–62は各統合テストと後続E2Eに割当する。
- `TODO`/`TBD`の実装指示を残さず、Task 3のclaim操作は既存`reservation_resource_allocations`と`withIdempotency`の原子性規則を再利用する。
- UI/E2EはPhase 9で一括ではなく、各APIが完成した後にscreen IDごとのTDD/E2Eへ増分追加する。
