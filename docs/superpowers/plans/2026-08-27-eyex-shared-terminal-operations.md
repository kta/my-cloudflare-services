# EYEX 共有端末・店舗切替 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 選択店舗を越えない店舗切替と、失効可能な完全共有iPad・個人PIN再認証・PIIマスクを実装する。

**Architecture:** 個人JWTと共有端末トークンは混在させない。共有端末はD1にハッシュだけを保持する短命bearer tokenとし、店舗・端末・失効・最終通信を毎回検証する。PINの本人確認はadminが唯一の認証源として検証し、EYEXは短期の管理再認証結果だけを保存する。共有主体と再認証した個人の双方を、PIIを含まない追記型監査で記録する。

**Tech Stack:** Cloudflare Workers/D1/KV、Hono、Drizzle、Zod、WebCrypto、React、Vitest workers/jsdom、Playwright。

**Spec:** `specs/glasses_management/features/002-eyex-reservation-product/spec.md` (UC-EYEX-063–072, 130–138, 150–152, 157–158)、`docs/superpowers/specs/2026-08-26-glasses-management-design.md`、`specs/glasses_management/features/002-eyex-reservation-product/design/EYEX_RESERVATION_DESIGN.md`。

## Global Constraints

- `organization_id`と`store_id`を全読書きの条件にし、URL/bodyの組織IDは認可根拠にしない。
- PIN平文・端末トークン平文・PIIをD1、監査、ログ、レスポンスへ保存しない。端末トークンは発行時だけ返し、D1にはWebCrypto SHA-256 hashを保持する。
- 端末登録・失効・管理再認証と監査イベントは同じ`db.batch()`で成立させる。監査失敗なら業務変更を成立させない。
- 共有端末は日常業務だけを許可し、`settings.manage`、`recording.manage`、注意事項公開・権限変更を共有主体のまま実行できない。
- JWT/PINの認証源はadmin。EYEXはadmin service bindingを使う内部APIだけを呼び、内部キーとJWT secretを兼用しない。
- 時刻は注入し、PIN再認証期限、無操作期限、失効のちょうど/±1秒をtime testで固定する。

---

### Task 1: 端末契約・保存・共有主体の認証

**Files:**
- Modify: `packages/contracts/src/glasses_management.ts`, `packages/contracts/src/index.ts`
- Modify: `services/glasses_management/src/worker/db/schema.ts`
- Create: `services/glasses_management/migrations/0016_shared_terminals.sql`
- Create: `services/glasses_management/src/worker/domain/shared-terminal.ts`
- Modify: `services/glasses_management/src/worker/index.ts`, `services/glasses_management/src/worker/auth.ts`
- Test: `services/glasses_management/test/shared-terminal.integration.test.ts`, `services/glasses_management/test/shared-terminal.time.test.ts`

**Interfaces:**
- Produces `SharedTerminalCreateInput { name }`, `SharedTerminalIssue { terminal, token }`, `SharedTerminalSession`, `SharedTerminal`, and `sharedTerminalAuth()`.
- `shared_terminals` contains id, organization_id, store_id, name, token_hash, status, idle_timeout_seconds, expires_at, last_seen_at, created_at, revoked_at; the hash is unique per tenant and token rotation replaces it atomically.

- [ ] Write failing tests: an authorized terminal manager can register a selected-store terminal once and receives a token once; only its SHA-256 hash persists; no token can read another org/store; unknown/revoked/expired tokens receive 401.
- [ ] Run `pnpm --filter @app/glasses_management exec vitest run test/shared-terminal.integration.test.ts`; expect the routes and tables not to exist.
- [ ] Add strict contracts, schema/migration indexes, a hash helper, and a shared-terminal Hono context. Require `x-shared-terminal-token`, verify status/expiry/store every request, update `last_seen_at` only after successful validation, and derive a non-person actor `{ actorType: 'shared_terminal', actorId: terminal.id }`.
- [ ] Implement `POST /api/staff/stores/:storeId/shared-terminals`, `GET /api/staff/stores/:storeId/shared-terminals`, and `POST /api/staff/stores/:storeId/shared-terminals/:terminalId/revoke`; require `terminal.manage`, scope every operation to JWT org/store, and batch mutation plus audit.
- [ ] Add fixed-clock expiry and idle boundaries (exact expiry/idle is rejected; 1 ms before is accepted), then run target tests, migration test, and typecheck.

### Task 2: admin PIN source and short-lived reauthentication

**Files:**
- Modify: `packages/contracts/src/auth.ts`, `packages/contracts/src/index.ts`
- Modify: `services/admin/src/worker/db/schema.ts`, `services/admin/src/worker/index.ts`, `services/admin/src/worker/domain-auth.ts`
- Create: `services/admin/migrations/0003_user_pins.sql`
- Modify: `services/admin/wrangler.jsonc`, `services/glasses_management/wrangler.jsonc`, `services/glasses_management/src/worker/index.ts`
- Test: `services/admin/test/pin-reauthentication.time.test.ts`, `services/glasses_management/test/shared-terminal-reauth.integration.test.ts`

**Interfaces:**
- admin internal endpoint `POST /api/internal/domain-auth/pin/verify` consumes `{ userId, organizationId, pinStretched }` and returns only `{ verified: true }`; it never exposes a PIN hash.
- EYEX endpoint `POST /api/shared-terminals/:terminalId/reauthenticate` consumes the PIN proof and returns an opaque, short-lived reauth token scoped to terminal, user, organization, store, and management action class.

- [ ] Write failing admin tests for 4–6 digit PIN setup/replacement, bad PIN rejection, cross-org subject rejection, and no PIN/hash in audit/response; run them to Red.
- [ ] Add admin user-PIN hash storage using the existing stretched/HMAC password primitives with a distinct PIN domain separator; add internal-key-only set/verify handlers and append-only admin audit.
- [ ] Add the one-way admin binding to EYEX with an independent internal key. Add EYEX reauth session hash storage, explicit TTL, terminal/user/store binding, and endpoint that requires a valid shared terminal plus valid admin proof. Batch issuance/audit.
- [ ] Write and run EYEX failing tests for an expired token, a token used from another terminal/store, a revoked terminal, and an admin-only action without reauth; implement `requirePersonalReauth()` to fail closed (401 for missing/expired token, 403 for wrong scope).
- [ ] Run admin and EYEX target tests/typechecks; verify neither Wrangler vars nor migrations contain a secret or PIN.

### Task 3: shared-mode capability boundary, PII lock and remote revocation

**Files:**
- Modify: `services/glasses_management/src/worker/auth.ts`, `services/glasses_management/src/worker/index.ts`
- Modify: `services/glasses_management/src/web/auth.ts`, `services/glasses_management/src/web/App.tsx`
- Create: `services/glasses_management/src/web/shared-terminal.ts`
- Test: `services/glasses_management/test/shared-terminal.permissions.test.ts`, `services/glasses_management/src/web/shared-terminal.test.ts`

**Interfaces:**
- `SharedTerminalState` has `active | locked | revoked`; `lockSharedTerminal()` clears in-memory token, selected reservation/customer, form drafts and all PII-bearing data.
- Every shared-token request returns terminal/session state headers; a 401 `terminal_revoked | terminal_expired | terminal_locked` forces the web client to clear state before routing to the shared start page.

- [ ] Write failing worker permissions tests: shared terminal may use `reservation.read/write` and customer matching required by daily reception, but cannot use settings/recording/audit/terminal management; reauth does not elevate a non-admin subject.
- [ ] Implement actor-aware authorization that intersects the terminal's selected store with the daily-operation allowlist and requires personal reauth for management. Preserve existing JWT behavior exactly.
- [ ] Write jsdom tests with fake timers: idle timeout locks at the exact deadline, visibility/pagehide locks immediately, lock clears reservations/customers/search drafts, and a revoked API response cannot restore cached state.
- [ ] Implement a memory-only shared terminal client state and lock handlers; do not put terminal credentials or PII in localStorage/sessionStorage. Add accessible locked/revoked status text and a 44px restart action.
- [ ] Run worker/web target tests and typecheck.

### Task 4: selected-store switching and approved screens/E2E

**Files:**
- Modify: `services/glasses_management/src/web/App.tsx` and staff routes/components
- Create: `services/glasses_management/e2e/store-switch.spec.ts`, `services/glasses_management/e2e/shared-terminal.spec.ts`
- Modify: `services/glasses_management/e2e/traceability.ts` (or the repository traceability mapping)

**Interfaces:**
- Store selection is client state only; every API request carries the selected store in its path and server authorization remains authoritative.
- `switchStore(nextStore)` first locks/discards unsaved store-bound state, clears search/selection/drafts, then loads the selected store's permitted routes.

- [ ] Write failing web tests for switch confirmation while a draft exists, complete discard of selected reservation/search/draft after confirmation, and no data carried to the new store.
- [ ] Implement the approved `STORE-SWITCH`, `EX-STORE-UNSAVED`, `DEVICE-LIST`, `REAUTH`, `EX-SHARED-LOCK`, and `EX-SESSION-REVOKED` states using semantic UI tokens only; add loading, empty, 401/403/409/network states and keyboard/focus behavior.
- [ ] Write Playwright tests for UC-EYEX-063–072, 130–138, 150–152, 157–158 with exactly one `@e2e-covers` mapping per UC/AC; capture the prescribed iPad viewport screenshots.
- [ ] Run `pnpm --filter @app/glasses_management test:all`, the two E2E files, traceability validation, and then a Luna Max read-only review. Correct Critical/Important findings with a new red test and re-review.

## Self-review

- UC-EYEX-063–072 is covered by Task 4; server selection remains a path + store-membership decision and cannot become a client trust boundary.
- UC-EYEX-130–138 and 150–152/157–158 are covered by Tasks 1–4; no personal identity is inferred from a shared terminal.
- Token/pin material is only issued once or handled in memory; D1/audits retain hashes and non-sensitive IDs only.
- Task boundaries independently produce testable security behavior and each ends before the next dependency begins.
