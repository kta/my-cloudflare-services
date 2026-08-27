# EYEX reservation — Claude handoff (2026-08-27)

## Active goal — do not narrow it

> 今残っているタスクはこちらになります。しっかりと最後まで実装をTDDでやり切ってください。適宜まとまりごとに実装が完了したら、luna max(subagent)にレビューをさせるようにしてください。

The full user-provided task list is in:

`/Users/tetsuya.sakakibara/.codex/attachments/e75d6044-d649-4def-90e6-0e3db964c0a1/pasted-text-1.txt`

Read it before doing any implementation. It is intentionally broader than the web-booking work described below. Do not report the service complete until every listed roadmap area, the exact UC/AC E2E mapping, and the final quality gates have current evidence.

## Authoritative sources and reading order

1. This handoff.
2. `.superpowers/sdd/2026-08-27-eyex-web-booking/progress.md` — durable Task 1–5 ledger and decisions.
3. `docs/superpowers/plans/2026-08-26-glasses-management-roadmap.md` — authoritative remaining phase order and common quality TODO.
4. `specs/glasses_management/features/002-eyex-reservation-product/spec.md` — Approved product behavior (181 UC / 125 AC).
5. `docs/superpowers/specs/2026-08-26-glasses-management-design.md` — architecture decisions.
6. The task-specific plans in `docs/superpowers/plans/`, especially:
   - `2026-08-27-eyex-web-booking.md`
   - `2026-08-27-eyex-ledger-operations.md`
   - `2026-08-27-eyex-shared-terminal-operations.md`
   - `2026-08-26-reservation-concurrency-repair.md`
7. `specs/glasses_management/features/002-eyex-reservation-product/design/SCREEN_INVENTORY.md` and `EYEX_RESERVATION_DESIGN.md`.

## Workspace and safety state

- Branch: `002-eyex-reservation-product` (not the default branch).
- No commit or push has been made for the current worktree changes. A normal
  `git commit -m "feat: add eyex reservation service"` was attempted on
  2026-08-27 and was correctly stopped by the pre-commit hook; do not bypass it.
- No deployment, remote D1 migration, secret mutation, or other external side effect has been performed.
- The legacy `services/glasses_reservation` is intentionally deleted. The new service is `services/glasses_management`; do not revive the legacy service.
- The source tree has intentionally untracked new service files. Do not use `git clean` or reset. Exclude local Drizzle inspection directories matching `services/glasses_management/.drizzle-meta-*` from any future staging.
- Do not stage `.dev.vars`; only `.dev.vars.example` belongs in git.

## What is complete before the current pause

The earlier ledger has the detailed evidence. In brief:

- New `glasses_management` service, organization synchronization/auth foundation, notifier, availability engine, settings persistence, staff reservation foundation, customer search, resource occupancy and concurrency remediation are implemented.
- Web booking Tasks 1–4 are implemented and their last recorded Luna Max re-review was clean.
- Migration metadata baseline ends at `services/glasses_management/migrations/0026_metadata_baseline.sql`; `drizzle-kit check` and scratch generation previously reported no schema changes.

## Current implementation point — Task 5 public Web booking

Task 5 is **functionally implemented but not review-complete**. The current Luna Max review was intentionally interrupted at the user's request; it must be restarted before calling Task 5 complete.

### Implemented code

| Capability | Main files | Notes |
| --- | --- | --- |
| Public entry routes | `services/glasses_management/src/web/main.tsx`, `app-route.ts` | `/book`, `/book/`, and `/book/<public-slug>` are public; other paths still render `StaffWorkspace`. The dedicated slug is decoded only from the exact route shape. |
| Public client boundary | `src/web/public-booking-client.ts` | Same-origin public API calls only; Zod parses successful responses; public HTTP error payload remains in memory in `PublicBookingRequestError`; slugs are encoded. |
| Booking state machine | `src/web/public-booking.ts` | Store → detail → purpose → datetime → customer → confirm → complete; selected-store scope; a confirmation key is in memory only; unknown-result state and 409 recovery exist. |
| Public mobile UI | `src/web/PublicBooking.tsx` | Store search, details/notice/contact, purpose, slots, customer form, confirmation details, success, result-lost recovery, management-code identity, verified cancel, verified date/time change. All buttons use `min-h-12` (48px). |
| Verified management contract | `packages/contracts/src/glasses_management.ts`, `services/glasses_management/src/worker/index.ts` | Successful code verification returns only non-PII data necessary for versioned public change/cancel: `reservationId`, short-lived token, expiry, `version`, `startAt`, `purposeIds`, public `storeSlug`. It does **not** return customer data. |
| Public UI tests | `src/web/PublicBooking.test.tsx`, `public-booking.test.ts`, `public-booking-client.test.ts`, `app-route.test.ts` | Direct success, reused confirmation key/recovery, 409 retention, public client validation, route parsing, verified change and cancellation are covered. |
| Browser E2E | `e2e/web-booking.spec.ts` | 375×812 normal booking/management, same-store conflict, and unknown-result recovery. Exact Task 5 mapping comments are present. `e2e/smoke.spec.ts` now correctly checks the staff sign-in entry. |

### Important implementation invariants

- Never store `managementCode`, `verificationToken`, `confirmationKey`, or PII in localStorage/sessionStorage. They must stay in React memory only.
- A POST result loss is not a booking failure. Reuse exactly the same confirmation key and query `GET /api/public/reservations/status`; do not auto-create a new key.
- Only a 409 returns to same-store date choices. Other POST failures go to unknown-result recovery, preserving the draft.
- Public routes derive organization/store scope from public slug or verified session. Never accept organization/store ID from public input.
- Management code issuance/reissue remains company/staff-only. There is no public reissue endpoint.
- Public verification success must not expose customer PII. The version and public booking state returned after successful code verification are required by the existing CAS mutation API.
- Keep all API contracts Zod-first in `packages/contracts`; do not add hand-written API types.
- Continue UI token-only styling. `packages/ui/src/theme.css` is the color/font/radius source of truth. There are still legacy `text-on-pine` / `bg-on-pine/30` class occurrences elsewhere in the service; inspect and replace only when touching those UI files because the theme does not define `on-pine`.

## Exact test evidence at the pause

Passed:

```text
pnpm --filter @app/glasses_management exec vitest run --config vitest.web.config.ts \
  src/web/PublicBooking.test.tsx src/web/public-booking-client.test.ts src/web/public-booking.test.ts
# 3 files / 11 tests

pnpm --filter @app/glasses_management run test:web
# 9 files / 30 tests; web coverage: lines 86.14%, statements 83.36%,
# functions 87.76%, branches 68.56% (all required web thresholds >=60%)

pnpm --filter @app/glasses_management typecheck
pnpm --filter @app/contracts typecheck
# passed

pnpm exec playwright test e2e/web-booking.spec.ts
# 3 passed

pnpm exec playwright test
# 4 passed (including staff sign-in smoke)

pnpm --filter @app/glasses_management test
# 31 files / 203 Worker tests passed before the coverage gate rejected the run
```

Not green — do not hide or bypass:

```text
pnpm --filter @app/glasses_management test:all
# Worker statements/lines/functions satisfy 80%; branches are 73.74%,
# below the mandated 80% threshold. No threshold was lowered.

pnpm run test:traceability
# Validator unit tests pass, but the repository reports unmapped EYEX IDs
# for the remaining, not-yet-implemented roadmap phases, plus existing admin
# spec-status/mapping issues. This is expected until the whole product is done.
```

Therefore **`pnpm check` is not green**. Repository rules require local CI-equivalent checks to be green before push. Do not use `--no-verify` / `LEFTHOOK=0` to mask this; fix the remaining roadmap work and coverage/traceability evidence first.

### Latest normal commit attempt (2026-08-27)

The pre-commit hook ran `lint-format` and the combined test suite. Biome applied
formatting changes to 65 files, then stopped with the following remaining errors
(the output was capped after these diagnostics):

1. `src/worker/index.ts`: two `noUselessCatch` errors around lines 3489 and
   3781. The catches merely rethrow and need either removal or a real
   fail-closed transformation with a test.
2. `src/web/PublicBooking.tsx`: an invalid `aria-label` on a plain `div` around
   line 627. Use an appropriate semantic/ARIA role and retain an accessible
   progress label.
3. `src/web/shared-terminal.ts` and `src/web/store-switch.ts`: callbacks passed
   to `forEach` return the listener result; use block bodies.
4. Other diagnostics visible before truncation include unused/non-null
   assertions and an implicit-any `let result` in `src/worker/index.ts`.

The combined test command then stopped earlier than the glasses-management suite
at `@app/contracts`: functions **69.23%** and branches **78.94%**, both below the
mandatory 80% gate. Add behavior-focused contract tests; do not weaken coverage.
After these are fixed, rerun the ordinary hook/`pnpm check`, then commit and push
normally. The worktree is staged except for the two untracked temporary
`services/glasses_management/.drizzle-meta-*` directories; never stage them.

## Review status

- A fresh `gpt-5.6-luna`, max-reasoning Task 5 reviewer was started with scope covering the public client/state/UI/E2E and Worker verification response.
- It was intentionally interrupted before returning a verdict because the user asked for an immediate handoff.
- On resume, start a new independent Luna Max review for Task 5. Record Critical/Important findings in `.superpowers/sdd/2026-08-27-eyex-web-booking/progress.md`, address each with TDD, and request a scoped re-review before marking Task 5 complete.

## First steps for the next agent

1. Read the active-goal attachment and all sources listed above.
2. Run `git status --short`, confirm no unexpected files or secrets, and preserve all worktree changes.
3. Resume the Task 5 Luna Max review. Do not start the next roadmap task until Task 5 Critical/Important findings are resolved or formally ruled on in the ledger.
4. Add focused tests before every behavior change (Red → Green → Refactor). In particular, improve any reviewer-found gaps around:
   - 401 management-code expiry/attempt-limit UI showing only contact/reissue guidance;
   - cancellation/change idempotency response-loss recovery;
   - loading and empty states, public unavailable reason/contact, focus flow;
   - direct `/book/<slug>` initial selection behavior;
   - visual token validity and 375px screenshot artifacts.
5. After Task 5 is review-clean, continue the next incomplete roadmap task, in phase order. Each completed chunk requires a Luna Max review.
6. Do not claim global completion or push until the mandatory Worker coverage and full UC/AC traceability are green.

## Claudeへ最初に渡すプロンプト（そのまま貼り付け可）

```text
/goal
EYEX reservation の残タスクを、仕様とロードマップに従って最後までTDDで実装してください。
各まとまりの実装完了後は必ず luna max のsubagentに独立コードレビューを依頼し、Critical/Important をTDDで修正して再レビューまで完了してください。途中の見かけの成功でゴールを狭めないでください。

最初に必ず次を全て読んでください。
1. docs/superpowers/handoffs/2026-08-27-eyex-reservation-claude-handoff.md
2. /Users/tetsuya.sakakibara/.codex/attachments/e75d6044-d649-4def-90e6-0e3db964c0a1/pasted-text-1.txt
3. .superpowers/sdd/2026-08-27-eyex-web-booking/progress.md
4. docs/superpowers/plans/2026-08-26-glasses-management-roadmap.md
5. specs/glasses_management/features/002-eyex-reservation-product/spec.md

現在のブランチは 002-eyex-reservation-product です。旧 services/glasses_reservation は廃止済みで、実装対象は services/glasses_management だけです。

最初の再開地点は Task 5（公開Web予約）のLuna Maxレビューです。Task 5の実装はあるが、レビューがユーザー要望で中断されており未完了です。レビューを再開し、指摘を解消してから次のロードマップタスクへ進んでください。

重要な不変条件:
- 公開予約のconfirmation key、管理コード、verification token、PIIをlocalStorage/sessionStorageへ保存しない。
- 結果不明時に新規予約を作らず、同じconfirmation keyで結果照会する。
- 公開APIのテナント/店舗はslugまたは検証済みセッションから導出し、入力のorganization/store IDを信用しない。
- 管理コードの発行・再発行は会社側のみ。
- API契約はpackages/contractsのZod単一ソース。
- push前に pnpm check を必ずgreenにする。現在はWorker branch coverage 73.74%（必要80%）と全UC/AC E2E追跡未達のため、pushしてはいけない。

引き継ぎ文書の「Exact test evidence」「Review status」「Remaining product work」を根拠に作業を継続し、実装・テスト・レビュー・台帳更新を繰り返してください。
```

## Remaining product work (authoritative detail is the roadmap)

- Reservation idempotency permissions/tenant-boundary coverage; notifier concurrent-send claim; admin synchronization retry/audit/key separation/deploy protection.
- Reservation ledger/search/detail/change/cancel/progress.
- Walk-in reception, reception history, customer detail/history/correction.
- Store switching, shared iPad/PIN reauthentication/PII masking.
- Settings drafts/impact/publication/attention items.
- Recording upload/playback/retention/legal hold/delete reconciliation.
- Analytics, alerts, notification operations, customer merge/unlink.
- All approved React screens/states/accessibility.
- Full 181 UC / 125 AC exact Playwright mapping and final `pnpm check`.

The roadmap is the source of truth; this list is a resume index, not a replacement.
