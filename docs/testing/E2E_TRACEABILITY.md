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

Approved かつ UC/AC を持つ spec は次の 9 本である。`admin` の service spec と
infrastructure-only の文書には UC/AC がないため、分母には入らない（機械的な免除ではなく、
そもそも product behavior を定義していない）。新しい production behavior は Approved spec
に UC/AC を付け、この表と E2E mapping を同じ変更で追加する。

`glasses_management` は 0 から作り直している最中で、P4 以降の feature spec は
**`- ステータス: Draft` のまま置いてある**。Approved にした瞬間に E2E が必須になるので、
そのフェーズの E2E が緑になってから Approved へ上げる（`specs/glasses_management/design/08-traceability.md`）。
P1（`004-store-settings`）はこの表の 36 行が、P2（`005-availability-and-ledger`）は
続く 33 行（UC-LEDGER-01..11 / AC-LEDGER-01..22）が、P3（`006-booking-flow`）はさらに続く
37 行（UC-BOOK-01..15 / AC-BOOK-01..22）が、P4（`007-customer-records`）はさらに続く
40 行（UC-CUST-01..14 / AC-CUST-01..26）が、P5（`008-reception-and-walkin`）はさらに続く
45 行（UC-RECEP-01..16 / AC-RECEP-01..29）が、P6（`009-change-and-cancel`）はさらに続く
37 行（UC-CHANGE-01..10 / AC-CHANGE-01..27）が、P7（`010-recording`）はさらに続く
29 行（UC-REC-01..09 / AC-REC-01..20）がそろった時点で Approved にした。

`007-customer-records` の 26 本のうち、新しいお客様の登録・おまとめ・手書き・候補の吹き出しに
属するものは**画面ではなく HTTP のふるまいで固定してある**。部品（`src/web/customers/`）は
実装済みだが、器（`CustomerScreen.tsx`）と受付の工程 4（`book/CustomerStep.tsx`）がまだ
差し込んでおらず、ブラウザから開けないためである。どの面が足りないかは
`services/glasses_management/e2e/customers.spec.ts` の先頭と各 test のコメントに書いてある。
面が器に載ったら、同じ ID の test を操作へ書き換える（行は増えない）。

`008-reception-and-walkin` の 45 本も同じ扱いである。来店受付ボードからお客様を結びつける口・
予約を「ご来店がなかった」として残す口・台帳リストの行の「ご来店」の行き先は**まだ器に
載っていない**ので、その AC は HTTP のふるまいで固定してある。どの入口が足りないかは
`services/glasses_management/e2e/reception.spec.ts` の先頭と各 test のコメントに書いてある。

`009-change-and-cancel` の 37 本（UC-CHANGE-01..10 / AC-CHANGE-01..27）も同じ扱いで、
**1 ID = 1 test**（相乗りなし）で並べてある。取り消しの面（CHANGE-CANCEL）・完了の面
（CHANGE-DONE）・競合の解消の面（EX-CONFLICT の 4 つの出口）・「担当・場所を変える」の
入口は、部品（`src/web/change/ChangeCancel.tsx` / `ChangeDone.tsx` / `ConflictPanel.tsx`）が
出荷済みでありながら器（`ChangeScreen` / `App`）がまだ読み込んでおらず、ブラウザから
開けない。その AC は HTTP のふるまいで固定してある。どの入口が足りないかは
`services/glasses_management/e2e/change.spec.ts` の先頭と各 test のコメントに書いてある。
承認済みモックとの突き合わせも同じ理由で 5 面（CHANGE-SEARCH / EX-EMPTY-SEARCH /
CHANGE-DATETIME / CHANGE-DIFF / EX-CONFLICT）だけを実測し、CHANGE-CANCEL と CHANGE-DONE の
2 面は `test.skip` で置いてある（`e2e/mock-compare.spec.ts`）。

`010-recording` の 29 本（UC-REC-01..09 / AC-REC-01..20）も同じ扱いである。マイクが使えない面
（EX-MIC-DENIED）・録音だけが送れなかった面（EX-UPLOAD-FAILED）・3 か所の「録音を聞く」は、
部品（`src/web/recording/MicDeniedPanel.tsx` / `UploadFailedPanel.tsx` / `RecordingPlayer.tsx`）が
出荷済みでありながら器（`BookingScreen` / `ReservationDetail` / `ReceptionHistory` を呼ぶ側）が
まだ差し込んでおらず、ブラウザから開けない。その AC はブラウザで通せる半分（マイクが断られても
受付が最後まで続く・予約の成立が録音の失敗より先に読める・右下に「録音は端末に保管中」が残る・
録音が無い予約詳細に「録音を聞く」が出ない）を操作で見て、残りを HTTP のふるまいで固定してある。
最低保持期限（成立 30 日 / 破棄 24 時間）の境界は**ブラウザの時計を動かさず**、
`POST /api/internal/maintenance/recordings/purge` の `now` に固定値を注入して確かめる。
承認済みモックとの突き合わせは、上と同じ理由で EX-MIC-DENIED と EX-UPLOAD-FAILED の 2 面を
`test.skip` で置いてある（撮る相手が画面に無いので `maxDiffPixelRatio` を測れない）。
どの入口が足りないかは `services/glasses_management/e2e/recording.spec.ts` の先頭と
各 test のコメントに書いてある。

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
| AC-RECEP-01 | `services/glasses_management/e2e/reception.spec.ts` — 来店受付の画面は「11:00 のご予約　5分早くお着きです」と、お名前ひとまとめのカードを出す |
| UC-RECEP-01 | `services/glasses_management/e2e/reception.spec.ts` — 来店受付の画面は「11:00 のご予約　5分早くお着きです」と、お名前ひとまとめのカードを出す |
| AC-RECEP-02 | `services/glasses_management/e2e/reception.spec.ts` — 「ご来店を受け付ける」を押すと盤面へ戻り、その行の「受付」が済みましたになる |
| AC-RECEP-03 | `services/glasses_management/e2e/reception.spec.ts` — 注意ごとの行だけが「要確認」の札を持ち、確かめ済みと未確認が札で見分けられる |
| UC-RECEP-02 | `services/glasses_management/e2e/reception.spec.ts` — 注意ごとの行だけが「要確認」の札を持ち、確かめ済みと未確認が札で見分けられる |
| AC-RECEP-04 | `services/glasses_management/e2e/reception.spec.ts` — 「お待ちいただく」を押すと盤面に行が残り、受け付けがまだ済んでいないことが分かる |
| UC-RECEP-03 | `services/glasses_management/e2e/reception.spec.ts` — 「お待ちいただく」を押すと盤面に行が残り、受け付けがまだ済んでいないことが分かる |
| AC-RECEP-05 | `services/glasses_management/e2e/reception.spec.ts` — お客様を「あとで登録する」のまま受け付けて、そのままご相談を始められる |
| UC-RECEP-06 | `services/glasses_management/e2e/reception.spec.ts` — お客様を「あとで登録する」のまま受け付けて、そのままご相談を始められる |
| AC-RECEP-06 | `services/glasses_management/e2e/reception.spec.ts` — 受付パネルは「いまお待ち N名」と次の整理番号を出し、その番号で受付履歴に載る |
| UC-RECEP-07 | `services/glasses_management/e2e/reception.spec.ts` — 受付パネルは「いまお待ち N名」と次の整理番号を出し、その番号で受付履歴に載る |
| AC-RECEP-07 | `services/glasses_management/e2e/reception.spec.ts` — 台帳の最下段に「ご来店お待ち」の帯が出て、お待ちの人数とご用件が読める |
| AC-RECEP-08 | `services/glasses_management/e2e/reception.spec.ts` — 受け付けたあとのウォークインを今までのお客様へ結びつけると、表示がお名前に変わる |
| UC-RECEP-08 | `services/glasses_management/e2e/reception.spec.ts` — 受け付けたあとのウォークインを今までのお客様へ結びつけると、表示がお名前に変わる |
| AC-RECEP-09 | `services/glasses_management/e2e/reception.spec.ts` — 新しく登録したお客様へ結びつけると、その来店がそのお客様の初めてのご来店になる |
| UC-RECEP-09 | `services/glasses_management/e2e/reception.spec.ts` — 新しく登録したお客様へ結びつけると、その来店がそのお客様の初めてのご来店になる |
| AC-RECEP-10 | `services/glasses_management/e2e/reception.spec.ts` — 前日に受け付けて退店したウォークインを、期間を広げて受付履歴から見つけられる |
| UC-RECEP-10 | `services/glasses_management/e2e/reception.spec.ts` — 前日に受け付けて退店したウォークインを、期間を広げて受付履歴から見つけられる |
| AC-RECEP-11 | `services/glasses_management/e2e/reception.spec.ts` — 来店受付ボードは 7 列をこの順で並べ、右上にその日とご来店中の人数を出す |
| UC-RECEP-04 | `services/glasses_management/e2e/reception.spec.ts` — 来店受付ボードは 7 列をこの順で並べ、右上にその日とご来店中の人数を出す |
| AC-RECEP-12 | `services/glasses_management/e2e/reception.spec.ts` — 「次にやること　視力測定機 A」を押すと対応中になり、前の工程が済みましたに変わる |
| UC-RECEP-05 | `services/glasses_management/e2e/reception.spec.ts` — 「次にやること　視力測定機 A」を押すと対応中になり、前の工程が済みましたに変わる |
| AC-RECEP-13 | `services/glasses_management/e2e/reception.spec.ts` — お待たせしている行は赤地と「お待たせ中　18分」の両方で分かる |
| AC-RECEP-14 | `services/glasses_management/e2e/reception.spec.ts` — 「次にやること」の担当が勤務に入っていない欄は、文字でも担当を決め直すよう促す |
| AC-RECEP-15 | `services/glasses_management/e2e/reception.spec.ts` — 「次にやること」の設備が点検で止まっている欄は、設備名を差し込んだ文で分かる |
| AC-RECEP-16 | `services/glasses_management/e2e/reception.spec.ts` — 受付履歴の「結果」は 成立・取消・ご来店なし の 3 語を選び分けられる |
| UC-RECEP-11 | `services/glasses_management/e2e/reception.spec.ts` — 受付履歴の「結果」は 成立・取消・ご来店なし の 3 語を選び分けられる |
| AC-RECEP-17 | `services/glasses_management/e2e/reception.spec.ts` — 1 件を選ぶと、受け付けた時刻と手段と、そのあとの変更が古い順に読める |
| UC-RECEP-12 | `services/glasses_management/e2e/reception.spec.ts` — 1 件を選ぶと、受け付けた時刻と手段と、そのあとの変更が古い順に読める |
| AC-RECEP-18 | `services/glasses_management/e2e/reception.spec.ts` — 絞りすぎて 0 件になると、条件を 1 つ緩めた候補が件数つきで並び、押すと開き直せる |
| UC-RECEP-13 | `services/glasses_management/e2e/reception.spec.ts` — 絞りすぎて 0 件になると、条件を 1 つ緩めた候補が件数つきで並び、押すと開き直せる |
| AC-RECEP-19 | `services/glasses_management/e2e/reception.spec.ts` — 来店受付ボードは表として読まれ、どの欄もお客様の名前と工程の名前と一緒に読まれる |
| AC-RECEP-20 | `services/glasses_management/e2e/reception.spec.ts` — 盤面はキーボードだけでたどれて、Tab で通り抜けるのに何十回も押さずに済む |
| AC-RECEP-21 | `services/glasses_management/e2e/reception.spec.ts` — 0 件になったことは割り込まない知らせとして読み上げられ、候補の名前に件数が入る |
| AC-RECEP-22 | `services/glasses_management/e2e/reception.spec.ts` — 台帳リストの行にも「ご来店」の入口があり、来店受付の画面は 1 つである |
| AC-RECEP-23 | `services/glasses_management/e2e/reception.spec.ts` — 退店を記録するとご来店中から外れ、人数が 1 減り、来店回数に 1 件数えられる |
| UC-RECEP-14 | `services/glasses_management/e2e/reception.spec.ts` — 退店を記録するとご来店中から外れ、人数が 1 減り、来店回数に 1 件数えられる |
| AC-RECEP-24 | `services/glasses_management/e2e/reception.spec.ts` — お待ちのまま帰られた来店は待ちの帯から外れ、受付履歴には残る |
| UC-RECEP-15 | `services/glasses_management/e2e/reception.spec.ts` — お待ちのまま帰られた来店は待ちの帯から外れ、受付履歴には残る |
| AC-RECEP-25 | `services/glasses_management/e2e/reception.spec.ts` — 「お客様名で探す」は期間・結果の絞り込みを保ったまま効く |
| AC-RECEP-26 | `services/glasses_management/e2e/reception.spec.ts` — 選んだ 1 件から「予約を開く」でご予約へ移り、戻ると同じ絞り込みの受付履歴に戻る |
| UC-RECEP-16 | `services/glasses_management/e2e/reception.spec.ts` — 選んだ 1 件から「予約を開く」でご予約へ移り、戻ると同じ絞り込みの受付履歴に戻る |
| AC-RECEP-27 | `services/glasses_management/e2e/reception.spec.ts` — ご来店中が 0 名のときは、見出し 1 行と理由 1 行と次の一手だけが残る |
| AC-RECEP-28 | `services/glasses_management/e2e/reception.spec.ts` — 受付履歴は新しい順に 20 件まで出て、残りは 1 行にまとまり、押すと読み足される |
| AC-RECEP-29 | `services/glasses_management/e2e/reception.spec.ts` — 担当を決めずに受け付ける 2 人目も同じ枠に載り、上限の 3 件目までは受け付けられる |
| UC-CHANGE-01 | `services/glasses_management/e2e/change.spec.ts` — お名前・かな・お電話番号・予約番号のどれからでも同じ 1 件にたどり着ける |
| AC-CHANGE-01 | `services/glasses_management/e2e/change.spec.ts` — 「お名前」に 田中 と入れると、8/27（木）11:00 の 田中 花子 様 の行が並ぶ |
| AC-CHANGE-02 | `services/glasses_management/e2e/change.spec.ts` — 「お名前」に かな で入れても、漢字で登録されたご予約が結果に出る |
| AC-CHANGE-03 | `services/glasses_management/e2e/change.spec.ts` — 「お電話番号」に下 4 桁 5678 だけを入れても、田中 花子 様のご予約が出る |
| AC-CHANGE-04 | `services/glasses_management/e2e/change.spec.ts` — 「予約番号」を入れると結果は 1 件になり、右の詳細に番号と出どころが出る |
| AC-CHANGE-05 | `services/glasses_management/e2e/change.spec.ts` — 検索は選択中の店舗に固定され、ほかの店舗のご予約は結果に出ない |
| AC-CHANGE-06 | `services/glasses_management/e2e/change.spec.ts` — 絞り込みの「今日」を押すと、その日でないご予約が結果から消える |
| AC-CHANGE-07 | `services/glasses_management/e2e/change.spec.ts` — 絞り込みの「取消済み」を押すと、取り消されたご予約が結果に加わる |
| AC-CHANGE-08 | `services/glasses_management/e2e/change.spec.ts` — 行を押すと一覧は左に残ったまま、右に日時・担当と場所・確認の 1 行が出る |
| UC-CHANGE-02 | `services/glasses_management/e2e/change.spec.ts` — 0 件でも入れた条件は消えず、条件を 1 つ外す案とほかの探し方が出る |
| AC-CHANGE-09 | `services/glasses_management/e2e/change.spec.ts` — 0 件のときは「入力した条件はそのまま残しています。」と件数つきの案が出る |
| AC-CHANGE-10 | `services/glasses_management/e2e/change.spec.ts` — 案を押すと外した条件だけが外れ、ほかの条件は残ったままになる |
| AC-CHANGE-22 | `services/glasses_management/e2e/change.spec.ts` — 0 件は読み上げに届き、案は件数を含む名前の押せる操作として読まれる |
| AC-CHANGE-24 | `services/glasses_management/e2e/change.spec.ts` — 0 件から「顧客台帳で調べる」を押すと顧客台帳が開く |
| UC-CHANGE-03 | `services/glasses_management/e2e/change.spec.ts` — いまのご予約を左に置いたまま、所要が収まる時刻だけから選び直せる |
| AC-CHANGE-11 | `services/glasses_management/e2e/change.spec.ts` — 候補には受けられるかどうかが文字で添い、満席の時刻は押せない |
| AC-CHANGE-25 | `services/glasses_management/e2e/change.spec.ts` — 候補の先頭は「いまのまま」で、いまのご予約自身の時刻が残る |
| AC-CHANGE-12 | `services/glasses_management/e2e/change.spec.ts` — 同じ担当の枠を先に持たれていると満席になり、元のご予約は動かない |
| UC-CHANGE-09 | `services/glasses_management/e2e/change.spec.ts` — 変更先の枠を先に押さえてから元の予約を切り替える |
| UC-CHANGE-04 | `services/glasses_management/e2e/change.spec.ts` — 変更前と変更後を項目ごとに 4 行で並べる |
| AC-CHANGE-13 | `services/glasses_management/e2e/change.spec.ts` — 差分は「変わる行だけ色を付けています」と出て、変わらない行に札が付かない |
| AC-CHANGE-14 | `services/glasses_management/e2e/change.spec.ts` — 「戻って直す」で戻ったあと開き直すと、日時は元のままで変更が残っていない |
| AC-CHANGE-15 | `services/glasses_management/e2e/change.spec.ts` — 「変更を確定する」を押すと承った旨が出て、予約番号は変わらない |
| UC-CHANGE-05 | `services/glasses_management/e2e/change.spec.ts` — 変更を確定すると、読み上げる文と変更後の姿を 1 画面で確かめて終えられる |
| UC-CHANGE-06 | `services/glasses_management/e2e/change.spec.ts` — 日時を保ったまま担当と場所だけを置き直せる |
| UC-CHANGE-07 | `services/glasses_management/e2e/change.spec.ts` — 理由を選んで取り消すと、その枠がほかのお客様に案内できる状態へ戻る |
| AC-CHANGE-16 | `services/glasses_management/e2e/change.spec.ts` — 理由を 1 つも選ばずに取り消しを送っても、ご予約はそのまま残る |
| AC-CHANGE-17 | `services/glasses_management/e2e/change.spec.ts` — 取り消したあと、その時刻はほかのご予約の候補として受付できますに戻る |
| AC-CHANGE-21 | `services/glasses_management/e2e/change.spec.ts` — 取り消しは押した 1 回では起きず、ご予約はそのまま残る |
| UC-CHANGE-08 | `services/glasses_management/e2e/change.spec.ts` — ほかの端末が先に保存していると、選ぶまでどちらの内容も書き換わらない |
| AC-CHANGE-19 | `services/glasses_management/e2e/change.spec.ts` — 確定を押すと相手の内容と自分の内容が並び、どちらもまだ保存されていない |
| AC-CHANGE-20 | `services/glasses_management/e2e/change.spec.ts` — 「あなたの内容で上書きする」は、送る前に空きを当て直してから保存される |
| AC-CHANGE-23 | `services/glasses_management/e2e/change.spec.ts` — 相手の内容を残すと、ご予約は相手の内容のままで自分の入力は捨てられる |
| AC-CHANGE-26 | `services/glasses_management/e2e/change.spec.ts` — 確定の瞬間に枠が埋まっていると変更されず、BOOK-CONFLICT と同じ形になる |
| AC-CHANGE-27 | `services/glasses_management/e2e/change.spec.ts` — 古い版のまま送ると 409 になり、日時も担当も枠も監査も 1 行も書き換わらない |
| UC-CHANGE-10 | `services/glasses_management/e2e/change.spec.ts` — 変更と取消は、実行した日時と変更前後が 1 件ずつたどれる形で残る |
| AC-CHANGE-18 | `services/glasses_management/e2e/change.spec.ts` — 変更したご予約の「そのあとの変更」に、変更前後が 1 行で並ぶ |
| UC-REC-01 | `services/glasses_management/e2e/recording.spec.ts` — 受付を始めると、その押した操作のなかで許可を求める |
| AC-REC-15 | `services/glasses_management/e2e/recording.spec.ts` — 受付を始めると、その押した操作のなかで許可を求める |
| UC-REC-02 | `services/glasses_management/e2e/recording.spec.ts` — 復唱まで進めても経過時間は減らない |
| AC-REC-01 | `services/glasses_management/e2e/recording.spec.ts` — 復唱まで進めても経過時間は減らない |
| AC-REC-02 | `services/glasses_management/e2e/recording.spec.ts` — 工程を戻しても録音は 1 本のまま |
| UC-REC-03 | `services/glasses_management/e2e/recording.spec.ts` — マイクが切られていると、直し方が 3 手順で出る |
| AC-REC-03 | `services/glasses_management/e2e/recording.spec.ts` — マイクが切られていると、直し方が 3 手順で出る |
| AC-REC-04 | `services/glasses_management/e2e/recording.spec.ts` — 録音せずに続けると、伺った内容が残ったまま戻る |
| AC-REC-16 | `services/glasses_management/e2e/recording.spec.ts` — 直したので、もう一度確かめる |
| AC-REC-05 | `services/glasses_management/e2e/recording.spec.ts` — 途中で止まると「録音していません」に変わる |
| AC-REC-17 | `services/glasses_management/e2e/recording.spec.ts` — 止まったことが読み上げにも届く |
| UC-REC-04 | `services/glasses_management/e2e/recording.spec.ts` — 終わった録音が保管庫へ入り、保持期限が決まる |
| UC-REC-05 | `services/glasses_management/e2e/recording.spec.ts` — 保存に失敗しても、先に予約の成立を言う |
| AC-REC-06 | `services/glasses_management/e2e/recording.spec.ts` — 保存に失敗しても、先に予約の成立を言う |
| AC-REC-07 | `services/glasses_management/e2e/recording.spec.ts` — 失敗した予約も台帳に載り、「録音を聞く」は出ない |
| UC-REC-06 | `services/glasses_management/e2e/recording.spec.ts` — もう一度送ると「録音を聞く」が出る |
| AC-REC-08 | `services/glasses_management/e2e/recording.spec.ts` — もう一度送ると「録音を聞く」が出る |
| AC-REC-18 | `services/glasses_management/e2e/recording.spec.ts` — このまま続けると右下に「録音は端末に保管中」が残る |
| UC-REC-07 | `services/glasses_management/e2e/recording.spec.ts` — 台帳から「● 録音を聞く　03:12」で聞ける |
| AC-REC-09 | `services/glasses_management/e2e/recording.spec.ts` — 台帳から「● 録音を聞く　03:12」で聞ける |
| AC-REC-10 | `services/glasses_management/e2e/recording.spec.ts` — 受付履歴から「再生する」で位置のバーが進む |
| AC-REC-11 | `services/glasses_management/e2e/recording.spec.ts` — 成立予約は 30 日ちょうどで消せず、+1 秒で消せる |
| AC-REC-12 | `services/glasses_management/e2e/recording.spec.ts` — 破棄受付は 24 時間ちょうどで消せず、+1 秒で消せる |
| UC-REC-08 | `services/glasses_management/e2e/recording.spec.ts` — 保全を立てた録音は片づけで消えない |
| AC-REC-13 | `services/glasses_management/e2e/recording.spec.ts` — 保全を立てた録音は片づけで消えない |
| AC-REC-14 | `services/glasses_management/e2e/recording.spec.ts` — 他組織の録音は再生も保全もできず、一覧にも出ない |
| AC-REC-19 | `services/glasses_management/e2e/recording.spec.ts` — 3 回失敗するとお知らせに 1 件立つ |
| AC-REC-20 | `services/glasses_management/e2e/recording.spec.ts` — 端末セッションが失効しても未送信の録音は残る |
| UC-REC-09 | `services/glasses_management/e2e/recording.spec.ts` — 受付をやめても記録と録音が残る |

validator 自体は `scripts/check-e2e-traceability.test.mjs` で unit test する。通常の実行は次の
とおり。

```sh
pnpm run test:traceability
pnpm --filter @app/example_service e2e
pnpm --filter @app/admin e2e
pnpm --filter @app/glasses_management e2e
```
