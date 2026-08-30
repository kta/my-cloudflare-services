# EYEX予約 再構築 — 進捗台帳

計画: [`../plans/2026-08-28-glasses-management-rebuild.md`](../plans/2026-08-28-glasses-management-rebuild.md)

| フェーズ | spec | 状態 | 最後に確かめたこと |
|---|---|---|---|
| P0 サービスの土台 | `003-service-foundation` | **完了（Approved）** | 下記 |
| P1 店舗の受付条件 | `004-store-settings` | **完了（Approved）** | 下記 |
| P2 空き枠と予約台帳 | `005-availability-and-ledger` | **完了（Approved）** | 下記 |
| P3 予約受付 | `006-booking-flow` | **完了（Approved）** | 下記 |
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


## P1 T-001 の返事（2026-08-28）

規約 10（同意なしに決めない）に従い、決定ブリーフに無い追加を人に諮った。**4 件とも承認。**

| # | 提案 | 返事 |
|---|---|---|
| 1 | `store_blackout_windows` を新設（受付を止める時間帯。銀座店は 1 日 3 帯） | 承認 |
| 2 | `store_settings_revision` を新設（設定 6 面の版を 1 本にまとめる） | 承認 |
| 3 | `stores.sort_order` を追加（店舗の並び順。設計文書の 4 か所が既に使っている） | 承認 |
| 4 | `reservations` / `reservation_purposes` / `reservation_assignments` を P1 へ前倒し（読み取り専用の器。書き込みは P3） | 承認（代案は採らない） |

これにより T-004 は **16 表**を作り、`0001_*.sql` の `CREATE TABLE` は 16 本になる。
AC-SET-13 / 14 / 15（保存前の影響）は P1 に残し、005 spec へ移さない。


## P1（2026-08-28）

作ったもの:

- 契約 44 本のテストとともに、設定 6 面ぶんの Zod（`StoreDetail` / `BusinessHours*` / `BlackoutWindow*` /
  `CalendarException*` / `SlotRules*` / `StaffMember*` / `StaffShift*` / `Equipment*` /
  `VisitPurpose*` / `PurposeRequirement*` / `SettingsImpact*`）
- D1 に **16 表**（承認 4 により `reservations` / `reservation_purposes` / `reservation_assignments` を
  読み取り専用の器として前倒し）と `stores` の 7 列、index 28 本。`migrations/0001_massive_dark_phoenix.sql`
- `src/worker/domain/store-settings.ts`（営業時間の解決・受けられる区間・最後にお受けできる時刻・
  保存を拒む 3 条件と警告どまりの 4 条件）と `src/worker/domain/settings-impact.ts`（保存前の影響試算 3 種）。
  **どちらも純関数で、時刻は引数で受ける**
- 設定の読み書きルートと `POST /api/staff/settings/impact`。版の競合は
  `INSERT ... SELECT ... WHERE EXISTS` を 1 バッチに配り、最後の文の `meta.changes === 0` で 409 を返す
- 画面 6 面（店舗の情報 / 営業日 / 営業時間 / ご来店の目的 / スタッフと技能 / 設備と点検）と
  保存バー・影響カード。保存の言い方は器が 1 か所で持つ
- `seed.mjs` に銀座店の受付条件（営業時間 7 行 / 止める帯 18 行 / スタッフ 6 名・技能 9 行・勤務 42 行 /
  設備 7 行 / 目的 6 件）。E2E の使い捨て D1 にも seed を流すようにした

確かめたこと:

```
pnpm check                                   → 緑（1,016 テスト + traceability）
  contracts 95 / shared 80 / ui 20 / notifier 22 / admin 171+102 /
  example 34+19 / glasses 336+137
pnpm --filter @app/glasses_management e2e    → 34 passed
```

カバレッジ: Worker statements 95.8% / branches 85.4% / functions 98.5% / lines 98.8%（下限 80%）、
web statements 91.3% / branches 81.7% / functions 93.3% / lines 95.7%（下限 60%）。

承認済みモックとの差（`playwright test --project=mock`。**下げるだけで上げない**）:

| 画面 | 差 | いま残っている差の中身 |
|---|---|---|
| HOME | 3.23% | 日付の帯（P2）・お知らせ札（P10）|
| SETTINGS-STORE | 3.81% | 第2サイドバーを 6 項目に絞っている（残り 9 項目は P8/P10 か対象外）|
| SETTINGS-CALENDAR | 4.51% | 同上 |
| SETTINGS-HOURS | 4.05% | 同上 |
| SETTINGS-PURPOSE | 4.94% | 同上 |
| SETTINGS-STAFF | 5.27% | 同上 |
| SETTINGS-EQUIPMENT | 4.52% | 同上 |

自己判断は [`2026-08-28-self-decisions.md`](./2026-08-28-self-decisions.md) に全 220 件。


## P2（2026-08-31）

作ったもの:

- `src/worker/domain/availability.ts` — 空き枠の 8 条件（営業日 / 営業時間と止める帯 / 刻みと片付け /
  目的の所要 / 技能を持つ担当の空き / 設備種別の空きと点検 / 同時受付上限 / Web 公開条件）を
  表駆動で縛った純関数。時刻は引数で受ける
- `src/worker/domain/ledger.ts` と `src/worker/db/queries/ledger.ts` — 担当者別・設備別・時間順の
  3 通りの行組み立て。**1 予約が複数の設備を押さえると設備軸では複数行に出る**
- 台帳のルート 3 本。応答に `serverNow` を載せ、現在時刻の線は端末の時計を読まない
- 画面 4 面（タイムテーブル / 設備・場所別 / 予約リスト / 台帳を隠さず開く詳細）と通信断の帯
- 表示窓は 10:00–16:30 の 30分刻み 14 列。営業時間が長い日は台帳の中だけ横スクロール
- 任意値を書かないため、格子の寸法は `src/web/ledger/metrics.ts` が `--spacing` の刻みで計算する

レビュー: subagent で **3 巡**（① backend ② frontend とモック突き合わせ
③ 受入基準の充足・敵対的な実装可能性・モック忠実度）。

確かめたこと:

```
（.dev.vars を退避した CI 相当の状態で）
bash scripts/check-agent-compat.sh   → ok
pnpm exec biome check .              → 緑
pnpm run deps:check                  → 緑
pnpm -r --if-present typecheck       → 緑
pnpm run test                        → 緑（1,362 テスト + traceability）
pnpm --filter @app/glasses_management e2e → 62 passed
```

カバレッジ: Worker statements 96.3% / branches 87.8%、web statements 89.6% / branches 81.7%。

承認済みモックとの差: LEDGER-STAFF 3.14% / LEDGER-RESOURCE 3.66% / LEDGER-LIST 5.16% /
LEDGER-DETAIL 7.83%。残っている差はお客様のお名前と来店回数（P4/P5 の持ち物）が中心。

### CI で落ちていたものと直し

PR #6 の最初の `verify` は `test/foundation.integration.test.ts` の
`Property 'AUTH_DEV_GRANT' does not exist on type 'Env'` で落ちた。
**CI には `.dev.vars` が無い**（gitignore。verify では作らない）ので、`wrangler types` が作る
`Env` に secret が現れない。ローカルにはファイルがあるので通ってしまう。
`test/env.d.ts` で `INTERNAL_KEY` / `JWT_SECRET` / `AUTH_DEV_GRANT` を明示し、生成物に頼らない形にした。
あわせて `services/glasses_management/CLAUDE.md → AGENTS.md` の symlink を足し、
`scripts/check-agent-compat.sh` の検査対象に `glasses_management` を加えた（旧サービス削除で落ちていた規約）。


## P3（2026-08-31）

作ったもの:

- `src/worker/domain/booking.ts` — 予約番号（`EY-YYMM-NNNN`）の採番と衝突時の再試行、冪等キー、
  UNIQUE 違反の翻訳（エラー文字列のパースに頼らない）
- `src/worker/domain/holds.ts` — 枠の仮押さえ 420 秒。残り 60 秒ちょうどの境界、取り直し 10 回まで
- 確定は **1 バッチ**。上限つきの条件付き INSERT が D1 側で二重予約を止め、`meta.changes === 0` を 409 の合図にする
- `reception_sessions` を確定・破棄の両方で残す（予約にならなかった受付も記録が残る）
- 画面 13 面（5 工程 + 目的が収まらない面 + ドラッグ移動 + テンキー + 手書き + 枠が先に埋まっていた面）
- 各工程の「次へ」が押せる条件は、モックの `.fab` の有効・無効をそのまま状態機械にした

レビュー: subagent で **3 巡**（① backend / frontend ② 受入基準の充足・敵対的な実装可能性・
モック忠実度の検査 ③ 指摘の反映）。

確かめたこと:

```
（.dev.vars を退避した CI 相当の状態で）
bash scripts/check-agent-compat.sh   → ok
pnpm exec biome check .              → 緑
pnpm run deps:check                  → 緑
pnpm -r --if-present typecheck       → 緑
pnpm run test                        → 緑（1,629 テスト + traceability）
pnpm --filter @app/glasses_management e2e → 96 passed
```

モック突き合わせは 20 面に増えた（HOME / HOME-PERSONAL / SETTINGS ×6 / LEDGER ×4 /
EX-OFFLINE / BOOK ×7）。

### 途中で落ちたところ

- セッションの中断でワークフローが死に、T-002（3 表と migration `0003`）だけが完成した状態で止まった。
  そのまま resume すると migration が重複して生えるので、**T-002 を外したワークフローを組み直して**再開した。
- `006` spec が Draft のままだったため traceability が 37 件の `Unknown E2E mapping` で落ちた。
  E2E が全部緑であることを確かめてから Approved に上げた。
  **spec を Approved に上げるのは E2E が緑になった後**という運用は変えない。
