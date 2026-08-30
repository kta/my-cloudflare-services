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

Approved かつ UC/AC を持つ spec は次の 7 本である。`admin` の service spec と
infrastructure-only の文書には UC/AC がないため、分母には入らない（機械的な免除ではなく、
そもそも product behavior を定義していない）。新しい production behavior は Approved spec
に UC/AC を付け、この表と E2E mapping を同じ変更で追加する。

`glasses_management` は 0 から作り直している最中で、P4 以降の feature spec は
**`- ステータス: Draft` のまま置いてある**。Approved にした瞬間に E2E が必須になるので、
そのフェーズの E2E が緑になってから Approved へ上げる（`specs/glasses_management/design/08-traceability.md`）。
P1（`004-store-settings`）はこの表の 36 行が、P2（`005-availability-and-ledger`）は
続く 33 行（UC-LEDGER-01..11 / AC-LEDGER-01..22）が、P3（`006-booking-flow`）はさらに続く
37 行（UC-BOOK-01..15 / AC-BOOK-01..22）が、P4（`007-customer-records`）はさらに続く
40 行（UC-CUST-01..14 / AC-CUST-01..26）がそろった時点で Approved にした。

`007-customer-records` の 26 本のうち、新しいお客様の登録・おまとめ・手書き・候補の吹き出しに
属するものは**画面ではなく HTTP のふるまいで固定してある**。部品（`src/web/customers/`）は
実装済みだが、器（`CustomerScreen.tsx`）と受付の工程 4（`book/CustomerStep.tsx`）がまだ
差し込んでおらず、ブラウザから開けないためである。どの面が足りないかは
`services/glasses_management/e2e/customers.spec.ts` の先頭と各 test のコメントに書いてある。
面が器に載ったら、同じ ID の test を操作へ書き換える（行は増えない）。

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
| UC-LEDGER-01 | `services/glasses_management/e2e/ledger.spec.ts` — 予約台帳を開くと本日の担当者別タイムテーブルが出る |
| UC-LEDGER-02 | `services/glasses_management/e2e/ledger.spec.ts` — 並べ方を「設備・場所」にすると縦軸が設備の行に入れ替わる |
| UC-LEDGER-03 | `services/glasses_management/e2e/ledger.spec.ts` — 表示のかたちを「予約リスト」にすると時間順の行になり、出どころの 4 語がそのまま出る |
| UC-LEDGER-04 | `services/glasses_management/e2e/ledger.spec.ts` — 帯を押すと台帳を隠さずに詳細が開き、次の操作が 3 つだけ並ぶ |
| UC-LEDGER-05 | `services/glasses_management/e2e/ledger.spec.ts` — 日付を前後に移すと線と札が消え、並べ方と表示のかたちは保たれる |
| UC-LEDGER-06 | `services/glasses_management/e2e/ledger.spec.ts` — 本日は現在時刻の線と札が出て、端末の時計を 1 時間進めても動かない |
| UC-LEDGER-07 | `services/glasses_management/e2e/ledger.spec.ts` — 12:00 に終わる予約の後ろには片付けの 10分が付き、次の刻みから置ける |
| UC-LEDGER-08 | `services/glasses_management/e2e/ledger.spec.ts` — 担当が未定の予約は担当の行の下の専用の行に置かれ、帯にも文字で書かれる |
| UC-LEDGER-09 | `services/glasses_management/e2e/ledger.spec.ts` — 通信が切れても台帳は読めたまま残り、書き込みの操作を受け付けない |
| UC-LEDGER-10 | `services/glasses_management/e2e/ledger.spec.ts` — 開いた詳細は 3 つのどの道でも閉じ、閉じるその 1 回は新しい予約を起こさない |
| UC-LEDGER-11 | `services/glasses_management/e2e/ledger.spec.ts` — トップに本日わたしが担当するご予約が時間順に並び、1 行から台帳の詳細へ行ける |
| AC-LEDGER-01 | `services/glasses_management/e2e/ledger.spec.ts` — 予約台帳を開くと本日の担当者別タイムテーブルが出る |
| AC-LEDGER-02 | `services/glasses_management/e2e/ledger.spec.ts` — 目盛りは 10:00 から 16:30 までの 14 列を表示窓にし、長い日は台帳の中だけが横に流れる |
| AC-LEDGER-03 | `services/glasses_management/e2e/ledger.spec.ts` — 本日は現在時刻の線と札が出て、端末の時計を 1 時間進めても動かない |
| AC-LEDGER-04 | `services/glasses_management/e2e/ledger.spec.ts` — 日付を前後に移すと線と札が消え、並べ方と表示のかたちは保たれる |
| AC-LEDGER-05 | `services/glasses_management/e2e/ledger.spec.ts` — 出どころは色だけでなく文字で分かり、緑の帯は語を持たない |
| AC-LEDGER-06 | `services/glasses_management/e2e/ledger.spec.ts` — 60分の帯にはご用件の短い名前が出て、30分の狭い帯には入らない |
| AC-LEDGER-07 | `services/glasses_management/e2e/ledger.spec.ts` — 担当が未定の予約は担当の行の下の専用の行に置かれ、帯にも文字で書かれる |
| AC-LEDGER-08 | `services/glasses_management/e2e/ledger.spec.ts` — 「ご来店お待ち」は最下段の全幅の帯で、行見出しに人数が出る |
| AC-LEDGER-09 | `services/glasses_management/e2e/ledger.spec.ts` — 並べ方を「設備・場所」にすると縦軸が設備の行に入れ替わる |
| AC-LEDGER-10 | `services/glasses_management/e2e/ledger.spec.ts` — 場所を 2 つ押さえた 1 件の予約は 2 行に出て、片方を押すともう片方にも印が付く |
| AC-LEDGER-11 | `services/glasses_management/e2e/ledger.spec.ts` — 点検の時間帯は「点検」で埋まり、予約の無い設備は「いま空いています」と出る |
| AC-LEDGER-12 | `services/glasses_management/e2e/ledger.spec.ts` — 表示のかたちを「予約リスト」にすると時間順の行になり、出どころの 4 語がそのまま出る |
| AC-LEDGER-13 | `services/glasses_management/e2e/ledger.spec.ts` — 「これから」を押すと現在時刻までに始まった行が消え、0 件の絞り込みは行き止まりにしない |
| AC-LEDGER-14 | `services/glasses_management/e2e/ledger.spec.ts` — 担当が未定の行は担当の欄が「決めてください」になる |
| AC-LEDGER-15 | `services/glasses_management/e2e/ledger.spec.ts` — 帯を押すと台帳を隠さずに詳細が開き、次の操作が 3 つだけ並ぶ |
| AC-LEDGER-16 | `services/glasses_management/e2e/ledger.spec.ts` — 12:00 に終わる予約の後ろには片付けの 10分が付き、次の刻みから置ける |
| AC-LEDGER-17 | `services/glasses_management/e2e/ledger.spec.ts` — 担当が未定の予約も同時受付の上限に数えられ、上限に達した時刻は満席になる |
| AC-LEDGER-18 | `services/glasses_management/e2e/ledger.spec.ts` — 通信が切れても台帳は読めたまま残り、書き込みの操作を受け付けない |
| AC-LEDGER-19 | `services/glasses_management/e2e/ledger.spec.ts` — 開いた詳細は 3 つのどの道でも閉じ、閉じるその 1 回は新しい予約を起こさない |
| AC-LEDGER-20 | `services/glasses_management/e2e/ledger.spec.ts` — 台帳は矢印キーで枠を移れる格子で、またぐ帯を 2 度読ませない |
| AC-LEDGER-21 | `services/glasses_management/e2e/ledger.spec.ts` — トップに本日わたしが担当するご予約が時間順に並び、1 行から台帳の詳細へ行ける |
| AC-LEDGER-22 | `services/glasses_management/e2e/ledger.spec.ts` — 定休日は目盛りだけの空の格子を出さず、事実と「本日」だけを出す |
| UC-BOOK-01 | `services/glasses_management/e2e/booking.spec.ts` — 工程 1 は日付と時刻をどちらも選ぶまで進めず、定休と満席は押せない |
| UC-BOOK-02 | `services/glasses_management/e2e/booking.spec.ts` — 工程 2 でご用件を押すと所要が決まり、収まる時刻なら進める |
| UC-BOOK-03 | `services/glasses_management/e2e/booking.spec.ts` — 収まらない時刻には理由が 1 文で出て、代わりの時刻が 3 つまで並ぶ |
| UC-BOOK-04 | `services/glasses_management/e2e/booking.spec.ts` — 工程 3 で先約に重なると帯が重なり、右に先約のお名前が出て進めない |
| UC-BOOK-05 | `services/glasses_management/e2e/booking.spec.ts` — 縦軸を設備・場所へ入れ替えても、担当者へ戻すと選んでいた担当が残る |
| UC-BOOK-06 | `services/glasses_management/e2e/booking.spec.ts` — 帯をつかんで別の担当・時刻へ運べ、置けない場所には理由が添えられる |
| UC-BOOK-07 | `services/glasses_management/e2e/booking.spec.ts` — 担当も設備もあとで決めたまま確定でき、予約は「決めてください」と出る |
| UC-BOOK-08 | `services/glasses_management/e2e/booking.spec.ts` — 工程 4 はテンキーで番号を打ち切るまで「完了」も「次へ進む」も押せない |
| UC-BOOK-09 | `services/glasses_management/e2e/booking.spec.ts` — お電話番号を伺えなくても、お名前とふりがなだけで工程 5 まで進める |
| UC-BOOK-10 | `services/glasses_management/e2e/booking.spec.ts` — ご要望を手書きのまま残し、文字に変換するボタンは出さない |
| UC-BOOK-11 | `services/glasses_management/e2e/booking.spec.ts` — 復唱の文を読み上げて確定すると、予約番号と控えのお願いが出る |
| UC-BOOK-12 | `services/glasses_management/e2e/booking.spec.ts` — 確定の瞬間に枠が埋まっていたら、伺った内容を残したまま選び直せる |
| UC-BOOK-13 | `services/glasses_management/e2e/booking.spec.ts` — 工程 4 から工程 3 へ戻ってももう一度進めば、打ち込んだ内容が残っている |
| UC-BOOK-14 | `services/glasses_management/e2e/booking.spec.ts` — 「やめる」は 2 択の確認を出し、続ければ工程に留まり、やめればトップへ戻る |
| UC-BOOK-15 | `services/glasses_management/e2e/booking.spec.ts` — 工程の帯は順番といまの位置を読み上げに渡し、押せる操作にはしない |
| AC-BOOK-01 | `services/glasses_management/e2e/booking.spec.ts` — 工程 1 は日付と時刻をどちらも選ぶまで進めず、定休と満席は押せない |
| AC-BOOK-02 | `services/glasses_management/e2e/booking.spec.ts` — 工程 2 でご用件を押すと所要が決まり、収まる時刻なら進める |
| AC-BOOK-03 | `services/glasses_management/e2e/booking.spec.ts` — 収まらない時刻には理由が 1 文で出て、代わりの時刻が 3 つまで並ぶ |
| AC-BOOK-04 | `services/glasses_management/e2e/booking.spec.ts` — 代わりの時刻を押しても目的と所要はそのまま残る |
| AC-BOOK-05 | `services/glasses_management/e2e/booking.spec.ts` — 工程 3 で先約に重なると帯が重なり、右に先約のお名前が出て進めない |
| AC-BOOK-06 | `services/glasses_management/e2e/booking.spec.ts` — 同じ時刻で受けられる担当の候補を押すと重なりが消えて進める |
| AC-BOOK-07 | `services/glasses_management/e2e/booking.spec.ts` — 縦軸を設備・場所へ入れ替えても、担当者へ戻すと選んでいた担当が残る |
| AC-BOOK-08 | `services/glasses_management/e2e/booking.spec.ts` — 帯をつかんで別の担当・時刻へ運べ、置けない場所には理由が添えられる |
| AC-BOOK-09 | `services/glasses_management/e2e/booking.spec.ts` — 担当も設備もあとで決めたまま確定でき、予約は「決めてください」と出る |
| AC-BOOK-10 | `services/glasses_management/e2e/booking.spec.ts` — 工程 4 はテンキーで番号を打ち切るまで「完了」も「次へ進む」も押せない |
| AC-BOOK-11 | `services/glasses_management/e2e/booking.spec.ts` — お電話番号を伺えなくても、お名前とふりがなだけで工程 5 まで進める |
| AC-BOOK-12 | `services/glasses_management/e2e/booking.spec.ts` — ご要望を手書きのまま残し、文字に変換するボタンは出さない |
| AC-BOOK-13 | `services/glasses_management/e2e/booking.spec.ts` — 復唱の文を読み上げて確定すると、予約番号と控えのお願いが出る |
| AC-BOOK-14 | `services/glasses_management/e2e/booking.spec.ts` — 確定を続けて 2 度押しても、予約は 1 件で同じ予約番号が返る |
| AC-BOOK-15 | `services/glasses_management/e2e/booking.spec.ts` — 確定の瞬間に枠が埋まっていたら、伺った内容を残したまま選び直せる |
| AC-BOOK-16 | `services/glasses_management/e2e/booking.spec.ts` — 工程 4 から工程 3 へ戻ってももう一度進めば、打ち込んだ内容が残っている |
| AC-BOOK-17 | `services/glasses_management/e2e/booking.spec.ts` — 「やめる」は 2 択の確認を出し、続ければ工程に留まり、やめればトップへ戻る |
| AC-BOOK-18 | `services/glasses_management/e2e/booking.spec.ts` — 録音の置き場所は工程 1 から 4 まで動かず、工程 5 では右下へ移る |
| AC-BOOK-19 | `services/glasses_management/e2e/booking.spec.ts` — 工程の帯は順番といまの位置を読み上げに渡し、押せる操作にはしない |
| AC-BOOK-20 | `services/glasses_management/e2e/booking.spec.ts` — テンキーを使っている間も iPadOS のソフトキーボードは出ず、帯は見えている |
| AC-BOOK-21 | `services/glasses_management/e2e/booking.spec.ts` — 変換が確定するまでふりがなは入らず、人が直したふりがなは上書きされない |
| AC-BOOK-22 | `services/glasses_management/e2e/booking.spec.ts` — 2 台が同じ枠を同時に確定すると一方だけが成立し、もう一方に行は増えない |
| UC-CUST-01 | `services/glasses_management/e2e/customers.spec.ts` — 台帳の検索は下 4 桁で引け、0 件でも行き止まりにしない |
| AC-CUST-01 | `services/glasses_management/e2e/customers.spec.ts` — 台帳の検索は下 4 桁で引け、0 件でも行き止まりにしない |
| AC-CUST-02 | `services/glasses_management/e2e/customers.spec.ts` — 名前の一部でもふりがなでも同じお客様が残る |
| UC-CUST-02 | `services/glasses_management/e2e/customers.spec.ts` — 並べ方と絞り込みで人数が変わり、選んでいた行の選択が外れない |
| AC-CUST-03 | `services/glasses_management/e2e/customers.spec.ts` — 並べ方と絞り込みで人数が変わり、選んでいた行の選択が外れない |
| UC-CUST-05 | `services/glasses_management/e2e/customers.spec.ts` — 11 桁を打ち終えると候補が 2 件返る |
| AC-CUST-04 | `services/glasses_management/e2e/customers.spec.ts` — 11 桁を打ち終えると候補が 2 件返る |
| AC-CUST-05 | `services/glasses_management/e2e/customers.spec.ts` — 候補は自動で確定せず、2 段の札で分かれる |
| UC-CUST-06 | `services/glasses_management/e2e/customers.spec.ts` — 候補を選ぶと入る名前と、引き継がれる 4 項目が候補に載っている |
| AC-CUST-06 | `services/glasses_management/e2e/customers.spec.ts` — 候補を選ぶと入る名前と、引き継がれる 4 項目が候補に載っている |
| AC-CUST-07 | `services/glasses_management/e2e/customers.spec.ts` — 候補を退けてもお名前を手で入れて先へ進める |
| UC-CUST-03 | `services/glasses_management/e2e/customers.spec.ts` — 行を選ぶと 4 項目の要約が出て、度数の履歴表は出ない |
| AC-CUST-08 | `services/glasses_management/e2e/customers.spec.ts` — 行を選ぶと 4 項目の要約が出て、度数の履歴表は出ない |
| UC-CUST-04 | `services/glasses_management/e2e/customers.spec.ts` — 詳細の度数は新しい順で、いま有効な 1 行に「いま使っています」が付く |
| AC-CUST-09 | `services/glasses_management/e2e/customers.spec.ts` — 詳細の度数は新しい順で、いま有効な 1 行に「いま使っています」が付く |
| AC-CUST-10 | `services/glasses_management/e2e/customers.spec.ts` — 来店回数の表記が一覧・候補・受付で一致する |
| UC-CUST-07 | `services/glasses_management/e2e/customers.spec.ts` — 新規登録の途中で同じお電話番号のお客様を知らせる |
| AC-CUST-11 | `services/glasses_management/e2e/customers.spec.ts` — 新規登録の途中で同じお電話番号のお客様を知らせる |
| UC-CUST-08 | `services/glasses_management/e2e/customers.spec.ts` — 「別の方なので、新しく登録する」を選んだときだけ 2 件目ができる |
| AC-CUST-12 | `services/glasses_management/e2e/customers.spec.ts` — 「別の方なので、新しく登録する」を選んだときだけ 2 件目ができる |
| AC-CUST-13 | `services/glasses_management/e2e/customers.spec.ts` — 候補から 1 名を選んで確定しても、もう 1 件の登録は残る |
| UC-CUST-09 | `services/glasses_management/e2e/customers.spec.ts` — おまとめの下見が結果と失うものを同じ応答で返す |
| AC-CUST-14 | `services/glasses_management/e2e/customers.spec.ts` — おまとめの下見が結果と失うものを同じ応答で返す |
| AC-CUST-15 | `services/glasses_management/e2e/customers.spec.ts` — まとめると寄り、下見のあとに片方が動いていたら実行を拒む |
| AC-CUST-16 | `services/glasses_management/e2e/customers.spec.ts` — 店長でないと入口が出ず、直接叩いても拒まれる |
| AC-CUST-17 | `services/glasses_management/e2e/customers.spec.ts` — 別の会社のお客様 ID は 404 として扱われる |
| UC-CUST-10 | `services/glasses_management/e2e/customers.spec.ts` — 手書きを 1 枚足すと 1 枚増え、他店で書かれた 1 枚も読める |
| AC-CUST-18 | `services/glasses_management/e2e/customers.spec.ts` — 手書きを 1 枚足すと 1 枚増え、他店で書かれた 1 枚も読める |
| UC-CUST-11 | `services/glasses_management/e2e/customers.spec.ts` — 読み取った文字を直しても筆跡は書いたときのまま残る |
| AC-CUST-19 | `services/glasses_management/e2e/customers.spec.ts` — 読み取った文字を直しても筆跡は書いたときのまま残る |
| UC-CUST-12 | `services/glasses_management/e2e/customers.spec.ts` — 申し込みだけでは注意ごとにならない |
| AC-CUST-20 | `services/glasses_management/e2e/customers.spec.ts` — 申し込みだけでは注意ごとにならない |
| UC-CUST-13 | `services/glasses_management/e2e/customers.spec.ts` — お客様を伺う面が開いている間も録音の表示が読み上げから外れない |
| AC-CUST-21 | `services/glasses_management/e2e/customers.spec.ts` — お客様を伺う面が開いている間も録音の表示が読み上げから外れない |
| AC-CUST-22 | `services/glasses_management/e2e/customers.spec.ts` — お名前の欄の手順は飾りではなく読める濃さで描かれる |
| AC-CUST-23 | `services/glasses_management/e2e/customers.spec.ts` — 用紙をなぞる間は背後がスクロールせず、文字でも同じ内容を残せる |
| AC-CUST-24 | `services/glasses_management/e2e/customers.spec.ts` — 台帳の帯はお名前と来店回数を運び、お客様の付かない帯は運ばない |
| AC-CUST-25 | `services/glasses_management/e2e/customers.spec.ts` — 帯を押して開く詳細の見出しと注意ごとがその方のものになる |
| UC-CUST-14 | `services/glasses_management/e2e/customers.spec.ts` — 顧客台帳からそのままご予約を取り始められる |
| AC-CUST-26 | `services/glasses_management/e2e/customers.spec.ts` — 顧客台帳からそのままご予約を取り始められる |

validator 自体は `scripts/check-e2e-traceability.test.mjs` で unit test する。通常の実行は次の
とおり。

```sh
pnpm run test:traceability
pnpm --filter @app/example_service e2e
pnpm --filter @app/admin e2e
pnpm --filter @app/glasses_management e2e
```
