# EYEX予約 再構築 — 進捗台帳

計画: [`../plans/2026-08-28-glasses-management-rebuild.md`](../plans/2026-08-28-glasses-management-rebuild.md)

| フェーズ | spec | 状態 | 最後に確かめたこと |
|---|---|---|---|
| P0 サービスの土台 | `003-service-foundation` | **完了（Approved）** | 下記 |
| P1 店舗の受付条件 | `004-store-settings` | 未着手 | — |
| P2 空き枠と予約台帳 | `005-availability-and-ledger` | 未着手 | — |
| P3 予約受付 | `006-booking-flow` | 未着手 | — |
| P4 顧客台帳 | `007-customer-records` | 未着手 | — |
| P5 来店受付とウォークイン | `008-reception-and-walkin` | 未着手 | — |
| P6 変更と取消 | `009-change-and-cancel` | 未着手 | — |
| P7 受付の録音 | `010-recording` | 未着手 | — |
| P8 お客様向けWeb予約 | `011-web-booking` | 未着手 | — |
| P9 分析 | `012-analytics` | 未着手 | — |
| P10 端末と監査 | `013-terminals-and-audit` | 未着手 | — |

## P0（2026-08-28）

作ったもの:

- `services/glasses_management/` を `services/example_service` から起こした
  （package.json / wrangler.jsonc（D1・KV・R2・NOTIFIER）/ vite / vitest ×2 / drizzle / playwright / tsconfig）
- `packages/contracts/src/glasses_management.ts` を 0 から書き直した
  （`OrganizationSync` / `StorePermission` / `StoreMembership` / `Store` / `Actor`）
- `packages/ui/src/theme.css` を承認済みモック `eyex` のトークンへ全面的に書き直した
  （旧モック専用の方言 `terminal-*` / `viz-*` / `sp-*` / `compact-*` は削除）
- D1: `organizations` / `stores` / `store_memberships`（migration `0000`）
- Worker: health / dev トークングラント / `POST /api/internal/organizations/sync`（revision で巻き戻さない）/
  `GET /api/internal/organizations` / `POST /api/internal/store-memberships/sync` / `GET /api/staff/stores`
- web: `AppShell`（上のバー 64px + 左サイドバー 216px、たたむと 76px）と業務開始の画面
- 旧実装の残骸を削除（`docs/frontend/{diff,overlay,raw,reference,screens,REBUILD.md}`、
  旧モック `mockups/eyex-reservation/`、旧 spec `features/002-*`、旧 superpowers 文書）
- 旧 spec が持っていた `UC-EYEX-149` / `UC-EYEX-151` は admin の業務なので
  `specs/admin/features/003-user-administration/spec.md` へ移し、admin の e2e タグを付け替えた

確かめたこと:

```
pnpm run lint                                → 緑（notifier に既存の warning 2 件のみ）
pnpm run deps:check                          → 緑
pnpm run typecheck                           → 緑（4 サービス）
pnpm run test                                → 緑（contracts 47 / shared 80 / ui 20 / notifier 22 /
                                                admin 171+102 / example 34+19 / glasses 54+10）
pnpm run test:traceability                   → 緑（Approved の UC/AC がちょうど 1 本ずつ対応）
pnpm --filter @app/glasses_management e2e    → 5 passed
```

カバレッジ: Worker lines 94% / branches 88.9% / functions 91.7% / statements 92.5%（下限 80%）、
web lines 87.1% / branches 94.3% / functions 84.6% / statements 86.8%（下限 60%）。
