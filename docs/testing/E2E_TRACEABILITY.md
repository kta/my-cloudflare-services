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

Approved かつ UC/AC を持つ spec は次の 4 本である。`admin` の service spec と
infrastructure-only の文書には UC/AC がないため、分母には入らない（機械的な免除ではなく、
そもそも product behavior を定義していない）。新しい production behavior は Approved spec
に UC/AC を付け、この表と E2E mapping を同じ変更で追加する。

`glasses_management` は 0 から作り直している最中で、P2 以降の feature spec は
**`- ステータス: Draft` のまま置いてある**。Approved にした瞬間に E2E が必須になるので、
そのフェーズの E2E が緑になってから Approved へ上げる（`specs/glasses_management/design/08-traceability.md`）。
P1（`004-store-settings`）はこの表の下 36 行がそろった時点で Approved にした。

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
| UC-SET-01 | `services/glasses_management/e2e/store-settings.spec.ts` — 設定を開くと店舗の情報が出て、お店の基本と行き方のご案内が並ぶ |
| AC-SET-01 | `services/glasses_management/e2e/store-settings.spec.ts` — 設定を開くと店舗の情報が出て、お店の基本と行き方のご案内が並ぶ |
| AC-SET-02 | `services/glasses_management/e2e/store-settings.spec.ts` — 店名と住所を直すと未保存の変更 2件になり、保存すると保存しましたが 1 度だけ伝わる |
| AC-SET-03 | `services/glasses_management/e2e/store-settings.spec.ts` — 変更を捨てると値が編集前へ戻り、未保存の札が消える |
| UC-SET-02 | `services/glasses_management/e2e/store-settings.spec.ts` — 紹介文は 200 文字ちょうどなら保存でき、201 文字は 2 文で拒む |
| AC-SET-04 | `services/glasses_management/e2e/store-settings.spec.ts` — 紹介文は 200 文字ちょうどなら保存でき、201 文字は 2 文で拒む |
| UC-SET-03 | `services/glasses_management/e2e/store-settings.spec.ts` — 閉店を開店と同じ時刻にすると 2 文で拒み、営業時間は元のままである |
| AC-SET-05 | `services/glasses_management/e2e/store-settings.spec.ts` — 閉店を開店と同じ時刻にすると 2 文で拒み、営業時間は元のままである |
| UC-SET-04 | `services/glasses_management/e2e/store-settings.spec.ts` — 止める時間帯を足すと行が 1 つ増える |
| AC-SET-06 | `services/glasses_management/e2e/store-settings.spec.ts` — 止める時間帯を足すと行が 1 つ増える |
| UC-SET-05 | `services/glasses_management/e2e/store-settings.spec.ts` — 予約の間隔を見ると、最後にお受けできる時刻が空き枠と同じ式で出る |
| AC-SET-07 | `services/glasses_management/e2e/store-settings.spec.ts` — 予約の間隔を見ると、最後にお受けできる時刻が空き枠と同じ式で出る |
| UC-SET-06 | `services/glasses_management/e2e/store-settings.spec.ts` — 営業日の丸を押して保存すると、その日が休みになり臨時のお休みに入る |
| AC-SET-08 | `services/glasses_management/e2e/store-settings.spec.ts` — 営業日の丸を押して保存すると、その日が休みになり臨時のお休みに入る |
| AC-SET-09 | `services/glasses_management/e2e/store-settings.spec.ts` — 臨時のお休みをもう一度押して保存すると営業日へ戻り、一覧から消える |
| UC-SET-07 | `services/glasses_management/e2e/store-settings.spec.ts` — スタッフを選ぶと右がその人の設定になり、持っている技能に ✓ が付く |
| AC-SET-10 | `services/glasses_management/e2e/store-settings.spec.ts` — スタッフを選ぶと右がその人の設定になり、持っている技能に ✓ が付く |
| AC-SET-11 | `services/glasses_management/e2e/store-settings.spec.ts` — 技能を押して保存すると、一覧のその人の技能に加わる |
| UC-SET-08 | `services/glasses_management/e2e/store-settings.spec.ts` — 日曜の勤務を直して保存すると残り、営業時間の外へ出ても警告だけで保存できる |
| AC-SET-12 | `services/glasses_management/e2e/store-settings.spec.ts` — 日曜の勤務を直して保存すると残り、営業時間の外へ出ても警告だけで保存できる |
| UC-SET-09 | `services/glasses_management/e2e/store-settings.spec.ts` — 設備を止めると、保存の前に影響するご予約を数えて見せる |
| AC-SET-13 | `services/glasses_management/e2e/store-settings.spec.ts` — 設備を止めると、保存の前に影響するご予約を数えて見せる |
| AC-SET-14 | `services/glasses_management/e2e/store-settings.spec.ts` — 影響するご予約が 0 件の設備を止めても、影響の一覧は出ず札も赤くならない |
| UC-SET-10 | `services/glasses_management/e2e/store-settings.spec.ts` — 目的の所要時間を延ばすと、変更の札と受けられなくなる Web 枠が出る |
| AC-SET-15 | `services/glasses_management/e2e/store-settings.spec.ts` — 目的の所要時間を延ばすと、変更の札と受けられなくなる Web 枠が出る |
| AC-SET-16 | `services/glasses_management/e2e/store-settings.spec.ts` — Web予約に出すを切ると、一覧のその行がお店で受けるだけになる |
| AC-SET-17 | `services/glasses_management/e2e/store-settings.spec.ts` — スタッフの権限で保存すると、店長だけができると断られ下書きは残る |
| UC-SET-11 | `services/glasses_management/e2e/store-settings.spec.ts` — いま使えるの切り替えは入切を持つ操作で、状態が字でも読めて 44pt 以上ある |
| AC-SET-18 | `services/glasses_management/e2e/store-settings.spec.ts` — いま使えるの切り替えは入切を持つ操作で、状態が字でも読めて 44pt 以上ある |
| AC-SET-19 | `services/glasses_management/e2e/store-settings.spec.ts` — 件数の変化は割り込まない知らせとして伝わり、警告にはしない |
| UC-SET-12 | `services/glasses_management/e2e/store-settings.spec.ts` — スタッフを足すと 7名になり、いま使えるを切っても行は消えない |
| AC-SET-20 | `services/glasses_management/e2e/store-settings.spec.ts` — スタッフを足すと 7名になり、いま使えるを切っても行は消えない |
| UC-SET-13 | `services/glasses_management/e2e/store-settings.spec.ts` — 設備を足すと一覧に 1 行増える |
| AC-SET-21 | `services/glasses_management/e2e/store-settings.spec.ts` — 設備を足すと一覧に 1 行増える |
| UC-SET-14 | `services/glasses_management/e2e/store-settings.spec.ts` — 目的を足すと 7件になり、並べ替えた順のまま残る |
| AC-SET-22 | `services/glasses_management/e2e/store-settings.spec.ts` — 目的を足すと 7件になり、並べ替えた順のまま残る |

validator 自体は `scripts/check-e2e-traceability.test.mjs` で unit test する。通常の実行は次の
とおり。

```sh
pnpm run test:traceability
pnpm --filter @app/example_service e2e
pnpm --filter @app/admin e2e
pnpm --filter @app/glasses_management e2e
```
