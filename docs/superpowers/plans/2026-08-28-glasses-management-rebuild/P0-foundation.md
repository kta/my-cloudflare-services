# P0 サービスの土台 — TODO

- spec: [`specs/glasses_management/features/003-service-foundation/spec.md`](../../../../specs/glasses_management/features/003-service-foundation/spec.md)
- 依存: なし
- 状態: **完了**（2026-08-28）
- 目的: `services/example_service` の雛形から EYE予約を起こし、業務画面の器が立ち、
  admin から届く組織・担当店舗を受け取り、テナントの外へ一切漏れない状態にする。

> このファイルは、以降のフェーズの TODO の**書き方の手本**でもある。
> 1 タスクは「目的 / 触るファイル / 先に書くテスト / 実装 / 完了条件 / 依存」を必ず持つ。

---

## T-001 契約を書く（Red）

- **目的**: admin から届く形と、このドメインが持つ店舗の形を Zod で 1 か所に決める。
- **触るファイル**
  - `packages/contracts/src/glasses_management.ts`（新規・全面）
  - `packages/contracts/src/index.ts`（re-export をこの 5 つだけに絞る）
  - `packages/contracts/test/glasses_management.contract.test.ts`（新規）
- **先に書くテスト**（`pnpm --filter @app/contracts test`）
  - `OrganizationSync` > `accepts a canonical snapshot from admin`
  - `OrganizationSync` > `defaults revision to 0 so a pre-revision snapshot still applies`
  - `OrganizationSync` > `rejects a negative or fractional revision`
  - `OrganizationSync` > `rejects an unknown key so a stale admin field never lands silently`
  - `OrganizationSync` > `rejects an empty id and a non-datetime createdAt`
  - `StorePermission` > `is an allow-list: an unknown permission fails closed`
  - `StoreMembership` > `accepts an empty permission list — that is how admin revokes an assignment`
  - `StoreMembership` > `requires UUIDs for domain-owned ids but not for the admin organization id`
  - `Store` > `accepts a hyphenated lowercase slug and rejects anything else`
  - `Actor` > `defaults terminalId to null so a personal device carries no terminal`
- **実装**: `OrganizationSync` / `StorePermission` / `StoreMembership` / `Store` / `Actor` の 5 つだけ。
  `Plan` は `./auth` から import する（`./organization` には無い）。
- **完了条件**: 契約テストが緑。`packages/contracts` のカバレッジ 4 指標 80% 以上。
- **依存**: なし

## T-002 スキーマを書き、index を固定する（Red → Green）

- **目的**: D1 の 3 表を作り、index が「実際に投げるクエリの形」に合っていることをテストで固定する。
- **触るファイル**
  - `services/glasses_management/src/worker/db/schema.ts`（新規）
  - `services/glasses_management/test/schema.test.ts`（新規）
  - `services/glasses_management/migrations/`（生成物）
- **先に書くテスト**（`getTableConfig` で index の名前と対象列を見る）
  - `organizations` > `組織 id を主キーにし、外部キーを持たない`
  - `stores` > `組織で絞って作成順に並べる index を持つ`
  - `stores` > `slug は組織の中で一意（お客様向け URL の解決に使う）`
  - `store_memberships` > `「この利用者はこの店舗で何ができるか」を 1 行で引ける`
- **実装**: `organizations`（id / name / plan / is_disabled / created_at / revision）、
  `stores`（+ slug / phone / address / access_note / is_active）、
  `store_memberships`（permissions は**空白区切りの文字列**）。
  FK を宣言しない。真偽値は `'0'|'1'`。日時は ISO 文字列。
- **手順**: 編集 → `pnpm --filter @app/glasses_management db:generate` → `db:migrate:local`
- **完了条件**: `migrations/0000_*.sql` が生成され、`schema.test.ts` が緑。
- **依存**: T-001

## T-003 権限マトリクスを書く（Red）

- **目的**: default-deny が本当に効いていること、期限切れ（401）と権限不足（403）を取り違えないことを固定する。
- **触るファイル**: `services/glasses_management/test/permissions.test.ts` / `test/helpers.ts`
- **先に書くテスト**: 主体 5 種（未認証 / staff / admin / 期限切れ / 別 secret 署名）× 経路 4 本
  （`/api/health` / `/api/staff/stores` / `/api/staff/not-a-route` / `/api/internal/organizations`）の表。
  加えて共有鍵の 3 本（正しい鍵 200 / 違う鍵 401 / 鍵なし 401）と、dev グラントの入力検証（400）。
  - 期限切れトークンは**固定の過去時刻**から作る（`signAccessToken(claims, secret, 1, 過去のエポック秒)`）。
    `Date.now()` に依存させない。
- **完了条件**: 23 本が緑。**新しいルートを足したらこの表に 1 行足す。**
- **依存**: T-002

## T-004 テナント分離を書く（Red）

- **目的**: 他社のデータに手が届く経路が無いことを、複数テナント・偽装入力・同期状態の遷移で潰す。
- **触るファイル**: `services/glasses_management/test/tenant-isolation.test.ts`
- **先に書くテスト**
  - `3 テナントが同時に店舗を持っても、各自の店舗しか見えない`
  - `同じ slug を別テナントが使っても衝突せず、互いに見えない`
  - `クエリで他テナントの organizationId を指定しても自分の店舗しか返らない`
  - `担当店舗の同期に他テナントの id を混ぜても、その organizationId のまま隔離される`
  - `未同期は 503（再試行できる）、同期後は 200、無効化で 403、再有効化で 200 に戻る`
  - `未同期の 503 と 無効化の 403 は取り違えない`
  - `テナントのトークンでは内部 API の一覧に触れない`
- **注意**: D1 はテストファイル内で共有されるので、組織 id は毎回 `crypto.randomUUID()` で作る。
- **完了条件**: 7 本が緑。
- **依存**: T-002

## T-005 代表フローを書く（Red）

- **目的**: 組織同期の revision 規則と、担当店舗の配り方（空の permissions ＝ 担当解除）を固定する。
- **触るファイル**: `services/glasses_management/test/foundation.integration.test.ts`
- **先に書くテスト**
  - ヘルスチェック > `認証なしで ok を返す`
  - 組織の同期 > `初回は挿入し、受け取った内容をそのまま返す` / `再送で名前とプランが収束する` /
    `古い revision の配信は現在値を返して無視する（巻き戻さない）` / `同じ revision の再送は受け入れる` /
    `知らないキーが混ざった配信は 400 で落とす`
  - 列が無かった頃の行 > `plan / is_disabled / revision が NULL の行は free・有効・revision 0 として読む` /
    `revision が NULL の行へは、どの revision の配信でも適用できる`
  - dev トークングラント > `AUTH_DEV_GRANT が立っていなければ 404（本番では開かない）`
  - 担当店舗の同期 > `配られた membership を保存し、そのまま返す` /
    `担当解除は permissions が空の配信として届き、行は消えない` /
    `許可リストに無い権限は 400 で落とす`
  - 店舗一覧 > `作成の古い順に返し、契約どおりの形になっている` / `店舗が 1 つも無ければ空配列を返す`
- **完了条件**: 15 本が緑。
- **依存**: T-002

## T-006 Worker を実装する（Green）

- **目的**: T-003〜T-005 を緑にする。
- **触るファイル**: `services/glasses_management/src/worker/index.ts`（新規）
- **実装**
  - `Bindings`: `DB` / `SHORT_LIVED` / `RECORDINGS` / `NOTIFIER` / `INTERNAL_KEY` / `JWT_SECRET` / `AUTH_DEV_GRANT?`
  - `app.onError` — `HTTPException` は透過、予期しない throw は `{ error: 'internal_error' }` 500
  - `app.use('/api/internal/*', internalAuth())`
  - default-deny: `except(['/api/health','/api/auth/*','/api/internal/*','/api/public/*'], tenantAuth(), requireActiveOrg(orgResolver))`
  - `POST /api/auth/token`（dev のみ。RPC のチェーンに載せない）
  - チェーン: `GET /api/health` → `POST /api/internal/organizations/sync` →
    `GET /api/internal/organizations` → `POST /api/internal/store-memberships/sync` → `GET /api/staff/stores`
  - `export type AppType = typeof routes`
  - **admin が実際に叩く URL に合わせる**（`services/admin/src/worker/sync.ts` を読んで確認する）
- **完了条件**: `pnpm --filter @app/glasses_management test` が緑、カバレッジ 4 指標 80% 以上。
- **依存**: T-003, T-004, T-005

## T-007 デザイントークンを書き直す（Green）

- **目的**: 見た目の意味の正本を、承認済みモック `eye` の値へ合わせる。
- **触るファイル**: `packages/ui/src/theme.css` / `packages/ui/src/components.tsx` / `packages/ui/src/index.ts`
- **実装**
  - 旧モック（`eye-reservation`）専用の方言（`terminal-*` / `viz-*` / `sp-*` / `compact-*`）を**削除**する。
  - 面・文字・緑・出どころ・状態・グリッド・角・書体を `docs/frontend/mockups/eye/assets/eye.css` の `:root` から採る。
  - **アクセシビリティのために 3 つだけ暗くする**（モックの画像は変えない）:
    `--color-ink-faint` `#7d8b85`→`#626e69`（4.5:1）/ `--color-line-strong` `#b6c2bc`→`#778d82`（3:1）/
    `--color-pine-line` `#9cc4b6`→`#58947f`（3:1）。理由をコメントに残す。
  - `--color-focus-on-pine: #ffffff` を新設し、`focusRingOnPine` を export する
    （青い輪は緑の面で 1.03:1 になって消える）。
  - **Web フォントを配らない**。`@fontsource/*` の import と依存を外す
    （iPad では常に system 書体が先に当たるので 15MB が無駄になる）。
- **完了条件**: `pnpm --filter @app/ui test` が緑。ビルド後の資産が 300KB 程度に収まる。
- **依存**: なし

## T-008 業務画面の器を作る（Red → Green）

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 店舗スタッフが電話を取りながら次にやることを選ぶ面。
  - トークン計画: 緑 1 色（`--color-pine`）がバー・主操作・選択を担う。面は白と薄い緑灰の 2 段。
    角は 8/12/16px の 3 段。書体は iPadOS 既定の 1 書体で、ウェイトだけで段を作る。
  - シグネチャ: **左の柱に行き先を全部集め、細くたためること**。
- **触るファイル**
  - `services/glasses_management/src/web/shell/{icons.tsx,destinations.ts,AppShell.tsx}`（新規）
  - `services/glasses_management/src/web/{App.tsx,client.ts,main.tsx,app.css,tsconfig.json,vite-env.d.ts}`
  - `services/glasses_management/src/web/test/setup.ts` / `src/web/App.test.tsx`
- **先に書くテスト**（`pnpm --filter @app/glasses_management test:web`）
  - 業務開始 > `コードが空のまま始めようとすると、何を入れるか教える` / `始めると店舗名が上のバーに出る`
  - 左サイドバー > `行き先を上から順に持つ` /
    `つまみで細い柱にたたむと、文字は見えなくなるが読み上げ名は残る` /
    `横に広い画面へ移ると、たたんだ状態が既定になる` / `いま開いている行き先が分かる`
  - トップ > `主操作は 2 つだけ` / `お店が届いていないときは、その理由と次の行動を出す` /
    `お店が 1 つも無ければ、その事実だけを出す`
  - 業務を終える > `終えると業務開始の画面へ戻る`
- **実装の要点**（モックの実測に合わせる）
  - 上のバー 64px、ホームボタン 48px、店名 19px + 補足 12px。
  - サイドバー 216px（たたむと 76px）、地は `--color-surface-2`、右に 1px の罫。
  - 並びは **たたむ → トップ → ＋予約を取る → 予約台帳 → 来店受付 → 予約を検索 → 受付履歴 → 顧客台帳
    →「お店の運用」→ 分析 → 設定 → 端末の但し書き**。
  - 行き先は 46px、角 12px、選択中は緑地に白。`＋ 予約を取る` は 52px の緑。
  - **たたんでもラベルを DOM から消さない**（`sr-only` にする）。アイコンだけのボタンに名前が無いのは欠陥。
  - 横に広い画面（台帳・来店受付・顧客台帳・分析・設定）はたたんだ状態を既定にする。
  - 色・寸法は `packages/ui/src/theme.css` のトークン経由のみ。Tailwind 既定パレットと任意値を書かない。
- **完了条件**: web テストが緑、カバレッジ 4 指標 60% 以上。
- **依存**: T-007

## T-009 E2E を書き、spec を Approved に上げる

- **触るファイル**: `services/glasses_management/e2e/foundation.spec.ts` /
  `specs/glasses_management/features/003-service-foundation/spec.md`
- **やること**: AC-FOUND-01〜05 に 1 対 1 で Playwright test を書き、直前の行に `// @e2e-covers AC-FOUND-NN`。
  書けたら spec の `- ステータス:` を `Draft` → `Approved` に上げる。
- **完了条件**: `pnpm --filter @app/glasses_management e2e` が緑、`pnpm run test:traceability` が緑。
- **依存**: T-006, T-008

## T-010 モックとの突き合わせを常設にする

- **触るファイル**
  - `docs/frontend/mockups/eye/reference.mjs`（新規。ステータスバーを外した基準画像を作る）
  - `services/glasses_management/playwright.config.ts`（`snapshotPathTemplate` と `mock` / `mock-phone` の project）
  - `services/glasses_management/e2e/mock-compare.spec.ts`（新規）
- **やること**
  - モックは端末そのものを描いていて上に iPadOS のステータスバー（iPad 24px / iPhone 44px）が乗っている。
    実装はブラウザの中で動くのでその帯を持たない。`reference/` にその帯を外した派生物を作る。
  - `mock` project は viewport 1194×810 / deviceScaleFactor 2。`toHaveScreenshot('<画面ID>.png', { scale: 'device' })`。
  - `maxDiffPixelRatio` は「いま許している差」。**下げるだけで、上げてはいけない。**
    残っている差が何かをコメントに書く。
- **完了条件**: `playwright test --project=mock` が緑。HOME の差分が 5% 以下。
- **依存**: T-009

## T-011 宙に浮いた参照を片づける

- **やること**
  - `knip.jsonc` の `services/glasses_management` の entry を実在のものだけにする。
  - 旧実装の残骸を削除する（`docs/frontend/{diff,overlay,raw,reference,screens,REBUILD.md}` /
    旧モック `mockups/eye-reservation/` / 旧 spec `features/002-*` / 旧 superpowers 文書）。
  - 旧 spec が持っていた `UC-EYE-149` / `UC-EYE-151` は admin の業務なので
    `specs/admin/features/003-user-administration/spec.md` へ `UC-ADMIN-USERS-01/02` として移し、
    `services/admin/e2e/user-administration.spec.ts` のタグを付け替える。
  - `docs/frontend/mockups/README.md` の台帳を、採用＝`eye/`、却下＝`eye-reservation/` に書き直す。
- **完了条件**: `pnpm check` が緑。
- **依存**: T-009

## T-012 完了の確認

```sh
pnpm run lint          # 緑
pnpm run deps:check    # 緑
pnpm run typecheck     # 緑
pnpm run test          # 緑（traceability を含む）
pnpm --filter @app/glasses_management e2e   # 緑
```

進捗台帳（`docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md`）に、
実行したコマンドとその結果・カバレッジの実測値を書く。
