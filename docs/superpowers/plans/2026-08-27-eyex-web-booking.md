# EYEX 公開Web予約 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 顧客が公開店舗だけを検索し、同じ可否・資源確保で予約し、会社発行管理コードにより自分の予約だけを照会・変更・取消できるようにする。

**Architecture:** 公開APIは店舗slugからD1内の組織・店舗を導出し、JWTや入力中のorganizationIdを使わない。Web確定は既存の資源占有・冪等基盤を使うが、公開設定、同意証跡、管理コードはWeb専用行に分離する。確定後のnotifier送信はbest-effortで、予約をロールバックしない。

**Tech Stack:** Cloudflare Workers/D1/KV/service binding、Hono、Drizzle、Zod、React、Vitest workers/jsdom、Playwright。

**Spec:** `specs/glasses_management/features/002-eyex-reservation-product/spec.md`（UC-EYEX-073–086、167–171）、`docs/superpowers/specs/2026-08-26-glasses-management-design.md`、`docs/frontend/mockups/eyex-reservation/web-booking-approved.html`。

## Global Constraints

- 公開APIは店舗slugからスコープを導出し、organization/store idをbody・queryから受けない。
- 管理コード・本人確認トークン・確定キーは平文をD1、監査、ログ、レスポンスへ保存しない。管理コードは会社が発行・再発行し、顧客画面は自動再送をしない。
- 予約、顧客upsert、資源占有、同意・入力履歴、監査、確定結果は同一`db.batch()`で確定する。通知失敗は別記録にし、予約を取り消さない。
- 公開予約は同店舗の可否エンジンと資源占有を使い、他店舗の空き・技能・設備・内部メモを返さない。
- `idempotency-key`は公開確定キーとして組織・店舗・操作でスコープし、成立不明時に同じ結果だけを返す。
- 顧客画面は375px以上、承認済みモックの一問一答順（店舗→目的→日時→お客様情報→確認→完了）を使い、全操作は44px以上・可視focus・通信/409/空状態を実装する。

---

### Task 1: 公開設定と店舗ポータル読取

**Files:**
- Modify: `packages/contracts/src/glasses_management.ts`, `packages/contracts/src/index.ts`
- Modify: `services/glasses_management/src/worker/db/schema.ts`
- Create: `services/glasses_management/migrations/0020_web_booking_publication.sql`
- Modify: `services/glasses_management/src/worker/index.ts`
- Test: `services/glasses_management/test/web-booking-public.integration.test.ts`, `services/glasses_management/test/web-booking-public.permissions.test.ts`

**Interfaces:** `PublicStoreSearchQuery`, `PublicStoreSummary`, `PublicStoreDetail`, `WebBookingPublication`、`GET /api/public/stores`、`GET /api/public/stores/:slug`。公開状態・開始/終了時刻・公開目的だけを返す。

- [ ] Write failing integration tests for公開中店舗検索、slug詳細、非公開/停止店舗の理由、別組織・内部設定非露出。
- [ ] Run `pnpm --filter @app/glasses_management exec vitest run test/web-booking-public.integration.test.ts test/web-booking-public.permissions.test.ts`; expect missing routes/tables.
- [ ] Add strict Zod contracts, publication D1 row (organization/store/status/window/public purpose ids/contact/access/notice/version) and public routes. Resolve scope exclusively through active store + slug + publication state.
- [ ] Run target tests and `pnpm --filter @app/glasses_management typecheck`; expect pass.

### Task 2: 公開枠とWeb確定の原子性

**Files:**
- Modify: `packages/contracts/src/glasses_management.ts`, `services/glasses_management/src/worker/index.ts`
- Modify: `services/glasses_management/src/worker/db/schema.ts`
- Create: `services/glasses_management/migrations/0021_web_booking_records.sql`
- Test: `services/glasses_management/test/web-booking-confirmation.integration.test.ts`, `services/glasses_management/test/web-booking-concurrency.integration.test.ts`, `services/glasses_management/test/web-booking.tenant-isolation.test.ts`

**Interfaces:** `PublicAvailabilityQuery`, `PublicBookingCreate`, `PublicBookingResult`, `GET /api/public/stores/:slug/slots`, `POST /api/public/stores/:slug/reservations`。結果に予約番号、管理コード（初回だけ）、メール送信状態を返す。

- [ ] Write failing tests for公開目的のみの同店舗slot、同一確定キーの単一予約、同時slot競合409、顧客/同意/入力履歴/資源占有/監査の原子性。
- [ ] Run confirmation/concurrency/isolation tests; expect missing routes/tables.
- [ ] Implement public-only availability projection and reservation confirmer by extracting shared allocation logic from staff confirmation without accepting staff-only memo/recital. Store consent version/time and input history. Hash management code before storage; plaintext code appears only in initial result/email payload.
- [ ] Run target tests and ensure other-store/other-org/hidden-purpose data is not returned.

### Task 3: notifier送信状態と成立照会

**Files:**
- Modify: `packages/contracts/src/notification.ts`, `services/glasses_management/src/worker/index.ts`
- Modify: `services/glasses_management/src/worker/db/schema.ts`
- Test: `services/glasses_management/test/web-booking-notification.integration.test.ts`, `services/notifier/test/send.test.ts`

**Interfaces:** notification IDs `reservation:<id>:confirmed` and `reservation:<id>:management-code-issued`; `GET /api/public/reservations/status?confirmationKey=...` returns `confirmed|not_found|pending` without PII.

- [ ] Write failing tests where notifier returns success, duplicate, and 502. Confirmed reservation remains confirmed and response marks email as pending/failed on 502.
- [ ] Run target tests; expect no status record or public result route.
- [ ] Persist notification attempt state after reservation batch, call notifier with internal key, and write an append-only notification audit/result. Implement confirmation-key status lookup via hash and no reservation details.
- [ ] Run target tests and notifier regression tests; expect pass.

### Task 4: 会社発行管理コードによる照会・変更・取消

**Files:**
- Modify: `packages/contracts/src/glasses_management.ts`, `services/glasses_management/src/worker/index.ts`
- Modify: `services/glasses_management/src/worker/db/schema.ts`
- Test: `services/glasses_management/test/web-booking-management-code.integration.test.ts`, `services/glasses_management/test/web-booking-management-code.time.test.ts`, `services/glasses_management/test/web-booking-management-code.permissions.test.ts`

**Interfaces:** `PublicReservationVerification`, `PublicReservationChange`, `PublicReservationCancel`; company-only internal issue/reissue routes; public `POST /api/public/reservations/verify`, `PATCH /api/public/reservations/:id`, `POST /api/public/reservations/:id/cancel` require a short-lived verified session.

- [ ] Write failing fixed-clock tests for expiry exact/±1ms, attempt limit, cross-reservation/code mismatch, cancellation deadline, and no PII before verification.
- [ ] Run target tests; expect missing verification/session tables/routes.
- [ ] Add hashed code issue history and short-lived verified session rows. Require verified session plus reservation scope on each mutation; reuse reservation CAS/resource reallocation/cancel audit path. Internal issue/reissue requires staff/company authentication and sends notifier email; no public reissue endpoint.
- [ ] Run target tests and permission/isolation matrix; expect pass.

### Task 5: スマートフォン予約フローと回復UI

**Files:**
- Modify: `services/glasses_management/src/web/App.tsx`, `services/glasses_management/src/web/app.css`
- Create: `services/glasses_management/src/web/public-booking.ts`, `services/glasses_management/src/web/PublicBooking.tsx`
- Test: `services/glasses_management/src/web/public-booking.test.ts`, `services/glasses_management/src/web/PublicBooking.test.tsx`
- Create: `services/glasses_management/e2e/web-booking.spec.ts`

**Interfaces:** state machine `store → purpose → datetime → customer → confirm → complete`; memory-only draft scoped to the selected store and confirmation key; error states `unavailable|conflict|network|unknown_result|verification_expired`.

- [ ] Write failing reducer/jsdom tests for一問一答順、選択店舗しおり、409で入力保持+同店舗代替、ネットワーク成立不明で確認キー照会、完了画面の予約番号/変更取消導線。
- [ ] Run web tests; expect missing reducer/component.
- [ ] Implement approved mobile visual language using existing semantic tokens, native labels, 44px actions, focus order, loading/empty/401/403/409/network views. Do not persist PII or management code in local/session storage.
- [ ] Add Playwright paths with exact `@e2e-covers` mappings for UC-EYEX-073–086 and 167–171; capture 375px screenshots and run `pnpm --filter @app/glasses_management e2e`.

## Self-review

- UC 073–074/167–168 map to Task 1; only public store fields are exposed.
- UC 075–080/82–86 map to Tasks 2–3; resource conflict and mail failure retain the reservation safely.
- UC 081/169–171 map to Task 4; verified sessions replace raw-code reuse and company-only reissue is explicit.
- AC-EYEX-32,33,39,92–95 map to Task 5 E2E; task tests cover Worker boundaries before UI.
