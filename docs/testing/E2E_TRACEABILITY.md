# E2E 要件トレーサビリティ

承認済み feature spec（`specs/**/spec.md`）にある全 `UC-*` / `AC-*` **定義**は、Playwright
scenario に**ちょうど 1 回**対応付ける。これは E2E の line coverage ではなく、仕様の
網羅性を検証する 100% gate である。

feature spec は先頭で `- ステータス: Draft` / `- ステータス: Approved` / `- ステータス: Superseded`
のいずれかを必ず宣言する。`Approved` の定義だけが mapping の分母になる。`Superseded` は
後継 spec に置換された履歴であり、分母にも `@e2e-covers` の対応先にもならない。UC/AC は `- AC-<TAG>-01: ...` または
`- UC-<TAG>-01: ...` という definition bullet でのみ宣言し、同じ ID を複数 spec で定義しない。
本文中の ID 参照は validator の分母に含めない。

## 機械可読な対応付け

Playwright テストの直前に、次の 1 行コメントを置く。空行は許容するが、別の statement や
`test.describe` を挟んではならない。複数 ID は同じ行に半角空白で並べる。

```ts
// @e2e-covers AC-BOOKING-01 UC-BOOKING-02
test('staff creates a booking', async ({ page }) => {
  // observable browser/API assertions
})
```

`pnpm run test:traceability` は Approved の `spec.md` だけを読んで、次を失敗にする。

- E2E mapping がない UC/AC
- Approved spec にない ID
- 同じ ID の重複 mapping
- `@e2e-covers` の直後に、`@playwright/test` から**値として import**した top-level の Playwright `test(...)` がない mapping（`import type`、関数内、`test.describe.skip` 内は対象外）

`pnpm test`、`pnpm check`、pre-commit、pre-push、CI `verify` はこの validator を実行する。
Playwright 自体は重いため、UI/API の挙動を変えた担当者が対象サービスで実行し、CI では
`workflow_dispatch` の e2e job で実行する。

AC-ITEM-05 は `playwright.config.ts` が test-only の `notifier` Worker fixture を Wrangler
local mode で起動する。scenario は fixture の `POST /api/internal/send` 実レスポンスが 418 で
あることを先に確認してから state を reset する。UI による item 作成（201）後、state は
service binding 経由の呼出し、`item.created` の job/payload、internal key、返却 item ID 由来の
idempotency ID を検証するためだけに使う。production Worker にテスト専用 route/header は追加しない。

## 現在の基準線

Approved かつ UC/AC を持つ spec は次の 3 本である。`admin` の service spec と
infrastructure-only の文書には UC/AC がないため、分母には入らない（機械的な免除ではなく、
そもそも product behavior を定義していない）。新しい production behavior は Approved spec
に UC/AC を付け、この表と E2E mapping を同じ変更で追加する。

`glasses_management` は 0 から作り直している最中で、P1 以降の feature spec は
**`- ステータス: Draft` のまま置いてある**。Approved にした瞬間に E2E が必須になるので、
そのフェーズの E2E が緑になってから Approved へ上げる（`specs/glasses_management/design/08-traceability.md`）。

| Spec ID | Playwright scenario |
|---|---|
| AC-ITEM-01 | `services/example_service/e2e/smoke.spec.ts` — sign in, capture `POST /api/items` 201, reload, and see the persisted entry |
| AC-ITEM-02 | `services/example_service/e2e/smoke.spec.ts` — item API rejects unauthenticated reads and writes |
| AC-ITEM-03 | `services/example_service/e2e/smoke.spec.ts` — item API rejects empty and overlong titles |
| AC-ITEM-04 | `services/example_service/e2e/smoke.spec.ts` — an organization cannot list an item created by another organization |
| AC-ITEM-05 | `services/example_service/e2e/smoke.spec.ts` — service binding records an `item.created` job despite the local notifier's 418, while creation remains successful |
| UC-ADMIN-USERS-01 | `services/admin/e2e/user-administration.spec.ts` — 本部管理者が利用者を検索し、権限差分を見て標準ロールと担当店舗を変更する |
| UC-ADMIN-USERS-02 | `services/admin/e2e/user-administration.spec.ts` — 本人が個人PINを設定・変更し、管理者は本人確認後に再設定を開始できるがPINは見えない |
| AC-FOUND-01 | `services/glasses_management/e2e/foundation.spec.ts` — お店のコードを入れて業務を始めると、上のバーに店名と営業状態が出る |
| AC-FOUND-02 | `services/glasses_management/e2e/foundation.spec.ts` — サイドバーはつまみで細い柱にたため、もう一度押すと元に戻る |
| AC-FOUND-03 | `services/glasses_management/e2e/foundation.spec.ts` — 店舗がまだ届いていないときは、その事実だけを出す |
| AC-FOUND-04 | `services/glasses_management/e2e/foundation.spec.ts` — 業務を終えると業務開始の画面へ戻る |
| AC-FOUND-05 | `services/glasses_management/e2e/foundation.spec.ts` — ヘルスチェックは認証なしで ok を返す |

validator 自体は `scripts/check-e2e-traceability.test.mjs` で unit test する。通常の実行は次の
とおり。

```sh
pnpm run test:traceability
pnpm --filter @app/example_service e2e
pnpm --filter @app/admin e2e
pnpm --filter @app/glasses_management e2e
```
