# P6 予約の検索・変更・取消 — TODO

- spec: [`specs/glasses_management/features/009-change-and-cancel/spec.md`](../../../../specs/glasses_management/features/009-change-and-cancel/spec.md)
- 依存: P5
- 状態: 未着手
- 目的: お名前・お電話番号・予約番号のどれからでも目当ての 1 件にたどり着き、変わる前と後を並べて
  読み上げてから確定するところまでを立てる。取消は理由を選ぶまで押せず、同時編集は両方の内容を残して選ばせる。

> 書き方は `P0-foundation.md` に揃える。1 タスクは「目的 / 触るファイル / 先に書くテスト / 実装 / 完了条件 / 依存」を持つ。
> **書いてある以上のことをしない。書いてあることは全部やる。**

このフェーズが触るモックは 7 枚。実装前に **必ず Read で実際に見る**。

| 画面ID | ルート | 実測（`docs/frontend/mockups/eye/screens/*.html` の `<style>`） |
|---|---|---|
| CHANGE-SEARCH | `/search` | `.split` 既定 `340px 1fr` |
| EX-EMPTY-SEARCH | `/search`（0件） | `.split` `300px 1fr` |
| CHANGE-DATETIME | `/search?selected=<id>&step=datetime` | `.split` `300px 1fr` + 工程バー 76px |
| CHANGE-DIFF | `?step=diff` | `.confirm` `1fr 360px` gap 32px |
| CHANGE-CANCEL | `?step=cancel` | `.cancel` padding `36px 44px` |
| CHANGE-DONE | `?step=done` | `.done` padding `40px 44px 0` |
| EX-CONFLICT | `?step=diff`（409） | `.wrap` padding `32px 36px 28px` |

**ルートの列は「どの画面がどの状態か」を示す名前である。**P0 の `src/web/App.tsx` は `useState`（`current`）で
画面を出し分けており、URL ルータを持たない。このフェーズも同じ形で作り、`react-router` を入れない
（ライブラリ追加は人間承認事項。ルール 10）。`?step=` を URL に書き換えない。

未決事項:

- `[Q-04 — いまの前提で進める]` 別店舗のご予約は見せない。EX-EMPTY-SEARCH の「丸の内店・新宿店のご予約も含める」は
  **画面に出さない**（押せない導線を置かない）。契約の `crossStore` は `false` だけを受ける形で置く。
- `[Q-06 — いまの前提で進める]` 変更先の枠の仮の押さえは 420 秒。残り時間を画面に出し、残り 60 秒で
  `role="status"` の警告を出して 1 回だけ延ばせるようにする（延長は 10 回まで）。

---

## T-001 契約を足す（Red → Green）

- **目的**: 検索・変更・取消・経緯の入出力を Zod の 1 か所に決め、境界値と未知キーで固める。
- **触るファイル**
  - `packages/contracts/src/glasses_management.ts`（追記）
  - `packages/contracts/test/glasses_management.contract.test.ts`（追記）
- **先に書くテスト**（`pnpm --filter @app/contracts test`）
  - `ReservationSearchQuery` > `名前だけ・電話だけ・予約番号だけのどれでも通る`
  - `ReservationSearchQuery` > `phone は下 4 桁だけでも全桁でも通り、5〜9 桁は落ちる`
  - `ReservationSearchQuery` > `code は EY-2608-0142 と EY-W-2608-0031 の両方で通る`
  - `ReservationSearchQuery` > `code の 5 桁への桁上げ（EY-2608-10000）も通る`
  - `ReservationSearchQuery` > `includeCancelled の既定は false`
  - `ReservationSearchQuery` > `crossStore は false だけを受け、true は落ちる`（Q-04 のいまの前提）
  - `ReservationSearchQuery` > `知らないキーが混ざったら落ちる`
  - `SearchRelaxation` > `count は 1 以上（0 件の案は候補にしない）`
  - `SearchRelaxation` > `label は 1〜60 文字`
  - `ReservationList` > `relaxations は 0 件のときだけ 1〜3 件`
  - `ReservationSummary` > `staffName は null を許す（「担当が未定」で描く）`
  - `ReservationChangeInput` > `version は必須で、それ以外は全部省略できる`
  - `ReservationChangeInput` > `staffId に null を渡せる（担当をあとで決めるへ戻す）`
  - `ReservationChangeInput` > `notify の既定は false`
  - `ReservationChangeInput` > `1 つも変更点が無い入力は落ちる`（refine）
  - `ReservationCancelInput` > `reason は 4 値の許可リストで、既定値を持たない`
  - `ReservationCancelInput` > `reason を省いた入力は落ちる（理由は必須）`
  - `ReservationChangeHistory` > `what は 1〜120 文字、actorName は null を許す`
  - `HoldInput` / `Hold` > `expiresAt は ISO8601、staffId は null を許す`
- **実装**: `ReservationSearchQuery` / `ReservationList` / `ReservationSummary` / `SearchRelaxation` /
  `ReservationChangeInput` / `ReservationCancelInput` / `ReservationChangeHistory` /
  `HoldInput` / `Hold`（`HoldInput` / `Hold` が P3 で既にあるなら足さない）。
  形は `specs/glasses_management/design/04-api.md` §4.5 の表どおり。すべて `z.strictObject`。
  `crossStore` は `z.literal(false).default(false)`。Q-04 の答えが来たら `z.boolean()` に戻す（理由をコメントに残す）。
- **完了条件**: 契約テストが緑。`packages/contracts` のカバレッジ 4 指標 80% 以上。
- **依存**: なし（P5 まで完了していること）

## T-002 スキーマの前提を固定する（Red → Green）

- **目的**: このフェーズは**表も列も足さない**。検索と変更が乗る index が実在することをテストで固定し、
  無ければ P2 / P3 の定義に戻す。
- **触るファイル**
  - `services/glasses_management/test/schema.test.ts`（追記）
  - `services/glasses_management/src/worker/db/schema.ts`（足りない index があるときだけ）
- **先に書くテスト**（`getTableConfig` で index の名前と対象列を見る）
  - `reservations` > `組織・店舗・開始時刻で引ける index を持つ`（`reservations_org_store_start_idx`）
  - `reservations` > `予約番号は組織の中で一意`（`reservations_org_code_idx`）
  - `reservations` > `version / cancelled_at / cancel_reason を持つ`
  - `customers` > `電話の前方一致と下 4 桁一致がそれぞれ index に乗る`
    （`customers_org_phone_idx` / `customers_org_phone_last4_idx`）
  - `customers` > `かなの並び替えが index に乗る`（`customers_org_kana_idx`）
  - `reservation_slot_locks` > `予約 ID でまとめて消せる index を持つ`（`reservation_slot_locks_org_reservation_idx`）
  - `audit_events` > `1 予約の経緯を時系列で引ける index を持つ`（`audit_events_org_target_idx`）
- **実装**: マイグレーションは**生成しない**（差分が無いはず）。差分が出たら P2 / P3 の定義が
  `design/03-data-model.md` §7.1 / §7.6 / §9.1 / §10.3 とずれているので、そちらを直してから生成する。
- **完了条件**: `pnpm --filter @app/glasses_management exec vitest run test/schema.test.ts` が緑
  （`-t` は**テスト名**で絞る旗なので、`-t "schema"` では 1 本も当たらない。既存の describe は
  `organizations` / `stores` / `store_memberships` である）。
  `pnpm --filter @app/glasses_management db:generate` が新しい `.sql` を作らない。
- **依存**: T-001

## T-003 検索と緩和候補の unit テストを書く（Red）

- **目的**: 「どの条件でどの行が当たるか」と「0 件のときに何件の案を出すか」を、DB へ行く前の純関数で固める。
- **触るファイル**: `services/glasses_management/test/reservation-search.test.ts`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test`）
  - 条件の解決 > `お名前は部分一致で当たる（「田中」で 田中 花子 が出る）`
  - 条件の解決 > `かなで入れても漢字で登録されたお客様が出る（「たなか はなこ」→ 田中 花子）`
  - 条件の解決 > `お電話番号は下 4 桁なら phone_last4 の完全一致になる`
  - 条件の解決 > `お電話番号が 5 桁以上なら phone_normalized の前方一致になる`
  - 条件の解決 > `後方一致（LIKE '%' || ?）を組み立てない`（生成した SQL 断片を見る）
  - 条件の解決 > `予約番号は 1 件に絞り、ほかの条件を無視しない`
  - 条件の解決 > `EY-W- で始まる番号は web_bookings の公開番号として引く`
  - 店舗の境界 > `選択中店舗の条件を必ず付ける（storeId を外した問い合わせを作れない）`
  - 期間 > `from / to は JST の暦日を UTC の半開区間 [from 00:00, to+1 日 00:00) に直す`
  - 状態 > `includeCancelled が false なら cancelled と no_show を外す`
  - 状態 > `includeCancelled が true なら取り消されたご予約も並ぶ`
  - 並び順 > `開始時刻の昇順で、同時刻はお客様名の昇順で安定する`
  - 緩和候補 > `結果が 1 件以上あるときは候補を作らない`
  - 緩和候補 > `期間を外す案は「期間を 8月1日 〜 9月30日 に広げる」になる（from の月初〜to の翌月末）`
  - 緩和候補 > `出どころを外す案は「「Web予約だけ」を外す」になる`
  - 緩和候補 > `取消を含める案は「取り消されたご予約も含める」になる`
  - 緩和候補 > `件数が 0 の案は候補に載せない`
  - 緩和候補 > `候補は最大 3 件で、件数の多い順に並ぶ`
  - 緩和候補 > `外した条件以外は元のクエリのまま残る`
- **実装**: まだ書かない（Red を目で見る）。
- **完了条件**: 20 本が「期待した理由で」赤い。
- **依存**: T-002

## T-004 変更の差分と版の競合の unit テストを書く（Red）

- **目的**: 差分表に出る行と、版が合わないときの判定を、SQL を打つ前の純関数で固める。
- **触るファイル**: `services/glasses_management/test/reservation-change.test.ts`（新規）
- **先に書くテスト**
  - 差分 > `日時だけを変えたら「お日にちとお時間」の 1 行だけが変更になる`
  - 差分 > `場所だけを変えたら「場所」の 1 行だけが変更になる`
  - 差分 > `担当を変えずに場所を変えたとき、「担当」の行に「変更」の札が付かない`（AC-CHANGE-13）
  - 差分 > `ご用件と所要が同じなら「ご用件」の行は変更にならない`
  - 差分 > `担当を未定へ戻したら「担当が未定」を変更後に出す`
  - 差分 > `変更点が 1 つも無ければ空の差分を返す（画面は確定を押させない）`
  - 差分 > `行の並びは お日にちとお時間 → ご用件 → 担当 → 場所 で固定する`
  - 読み上げ文 > `確定前なので「変更いたします」で終わり、「変更いたしました」にしない`
  - 読み上げ文 > `丁重語（でございます）を使わず「です・ます」で書く`
  - 読み上げ文 > `「8月27日木曜日、午後2時へお時間を変更いたします。担当は佐藤 美咲、所要時間は約60分です。こちらでお間違いないでしょうか？」を組み立てる`
  - 取消 > `理由が no_show のときだけ status は no_show になる`
  - 取消 > `customer / store / duplicate の 3 つは status が cancelled になる`
  - 取消 > `どの理由でも cancelled_at にサーバ時刻が入る`
  - 取消 > `理由が未選択の入力は取消の組み立てに渡せない`
  - バッチの並び > `新しい枠の INSERT が 1 文目、version を +1 する UPDATE が最後の文になる`
  - バッチの並び > `古い枠の DELETE は version を +1 する文より前に置く`
  - バッチのガード > `置き換え・削除・追記のすべての文に版の EXISTS ガードが付く`
  - バッチのガード > `監査の追記にも版のガードが付く`
- **実装**: まだ書かない。
- **完了条件**: 18 本が赤い。
- **依存**: T-002

## T-005 変更の通しテストを書く（Red）

- **目的**: 「枠を先に確保してから元の予約を切り替える」順序と、予約番号が変わらないことを D1 の実物で固める。
- **触るファイル**: `services/glasses_management/test/reservation-change.integration.test.ts`（新規）
- **先に書くテスト**
  - 検索 > `お名前で探すと選択中店舗のご予約だけが並ぶ`
  - 検索 > `別店舗の同じお名前のご予約は結果に出ない`（AC-CHANGE-05）
  - 検索 > `予約番号で探すと 1 件になり、出どころが「お電話でのご予約」で返る`（AC-CHANGE-04）
  - 検索 > `0 件のとき relaxations が 1〜3 件付き、案の件数と実際の再検索の件数が一致する`
  - 詳細 > `1 件を選ぶと日時・ご用件・お客様・担当と場所・注意ごとが返る`
  - 変更 > `新しい枠を取ってから古い枠を返す（古い枠の行は確定後に 0 件、新しい枠の行は要求本数ぶんある）`
  - 変更 > `日時を変えても予約番号は変わらない`（AC-CHANGE-15）
  - 変更 > `version が 1 つ上がる`
  - 変更 > `日時を保ったまま担当と場所だけを置き直せる`（UC-CHANGE-06）
  - 変更 > `変更先の枠が埋まっていたら 409 slot_taken を返し、代わりの枠を 3 件まで載せる`
  - 変更 > `409 slot_taken のとき、元のご予約の日時・担当・場所・枠は 1 行も変わっていない`
  - 経緯 > `変更したご予約の history に「ご来店時刻を 11:00 から 14:00 へ」の 1 行が並ぶ`（AC-CHANGE-18）
  - 経緯 > `history に操作した人の名前と時刻が入る`
  - 監査 > `audit_events に reservation.rescheduled が 1 行だけ増え、before_json と after_json を持つ`
- **注意**: D1 はテストファイル内で共有されるので、組織 id と店舗 id は毎回 `crypto.randomUUID()` で作る。
- **完了条件**: 14 本が赤い。
- **依存**: T-002

## T-006 取消と「409 が 1 行も書き換えない」ことを書く（Red）

- **目的**: 取消で枠が本当に戻ること、そして**版が合わないときに何も起きていない**ことを固定する（AC-CHANGE-27）。
  409 が返ることだけを見て終わらせない。
- **触るファイル**: `services/glasses_management/test/reservation-change.integration.test.ts`（追記）
- **先に書くテスト**
  - 取消 > `理由 customer で取り消すと status が cancelled になり cancel_reason が残る`
  - 取消 > `理由 no_show で取り消すと status が no_show になる`
  - 取消 > `取り消すと reservation_slot_locks の行が 0 件になり、同じ時刻が空き枠に戻る`（AC-CHANGE-17）
  - 取消 > `取り消したご予約は既定の検索に出ず、includeCancelled を立てると出る`（AC-CHANGE-07）
  - 取消 > `理由を送らない要求は 400 で落ち、ご予約は元のまま残る`（AC-CHANGE-16）
  - 取消 > `監査に reservation.cancelled が 1 行だけ増える`
  - 版の競合（変更） > `古い版で送ると 409 version_conflict を返す`
  - 版の競合（変更） > `409 のとき reservations の日時・ご用件が先に保存した側のまま`
  - 版の競合（変更） > `409 のとき reservation_assignments が先に保存した側の値のまま`
  - 版の競合（変更） > `409 のとき reservation_slot_locks の行が先に保存した側のまま残っている`
  - 版の競合（変更） > `409 のとき audit_events の行が 1 行も増えていない`
  - 版の競合（取消） > `古い版で取り消すと 409 version_conflict を返す`
  - 版の競合（取消） > `409 のとき予約は confirmed のままで、枠のロックも消えていない`（**409 が二重予約を作らない**）
  - 版の競合 > `409 の応答に相手の現在の version が載る（画面が読み直さずに済む）`
- **実装**: まだ書かない。
- **完了条件**: 14 本が赤い。
- **依存**: T-005

## T-007 時刻の境界テストを書く（Red）

- **目的**: 仮の押さえの期限と JST の日跨ぎを、実時刻に依存させずに固める。
- **触るファイル**: `services/glasses_management/test/reservation-change.time.test.ts`（新規）
- **先に書くテスト**（**時刻は必ず引数で注入する。`Date.now()` を使わない**）
  - 仮の押さえ > `420 秒ちょうどでは、まだ有効である`
  - 仮の押さえ > `421 秒で失効し、その枠は空きとして数え直される`
  - 仮の押さえ > `残り 60 秒ちょうどで警告の合図が立つ`
  - 仮の押さえ > `残り 61 秒では警告の合図が立たない`
  - 仮の押さえ > `延ばすと期限が押した時刻から 420 秒になる`
  - 仮の押さえ > `延ばせるのは 10 回まで、11 回目は延びない`（Q-06 のいまの前提）
  - 仮の押さえ > `自分の受付が置いた押さえは自分の空き枠計算では塞がりに数えない`
  - 期間の絞り込み > `JST の 8/27 は UTC の 8/26T15:00 から 8/27T15:00 未満で当たる`
  - 期間の絞り込み > `JST の 23:59 のご予約は当日に入り、翌 00:00 のご予約は入らない`
  - 期間の絞り込み > `月をまたぐ 8/31〜9/1 の指定で両日のご予約が並ぶ`
  - 期間の絞り込み > `年をまたぐ 12/31〜1/1 の指定で両日のご予約が並ぶ`
  - 期間の絞り込み > `うるう年の 2/29 を含む期間が 1 日ぶん欠けない`
  - 緩和候補 > `期間を広げる案は from の月初から to の翌月末までになる（8/27〜8/31 → 8/1〜9/30）`
- **完了条件**: 13 本が赤い。
- **依存**: T-003

## T-008 権限表とテナント分離に行を足す（Red）

- **目的**: 足した 4 ルートが default-deny の下にいることと、他社の予約へ手が届かないことを固める。
- **触るファイル**
  - `services/glasses_management/test/permissions.test.ts`（表に行を足す）
  - `services/glasses_management/test/tenant-isolation.test.ts`（追記）
- **先に書くテスト**
  - 権限の表に主体 5 種（未認証 / staff / admin / 期限切れ / 別 secret 署名）× 経路 4 本を足す:
    `GET /api/staff/reservations` / `PATCH /api/staff/reservations/:id` /
    `POST /api/staff/reservations/:id/cancel` / `GET /api/staff/reservations/:id/history`
    - 期限切れトークンは**固定の過去時刻**から作る（`signAccessToken(claims, secret, 1, 過去のエポック秒)`）
    - 期限切れは 401、権限不足は 403 で取り違えない
  - テナント分離 > `3 テナントが同じお名前のご予約を持っても、自分のご予約しか検索に出ない`
  - テナント分離 > `他テナントの reservationId を URL に入れて変更しても 404 で、相手の行は 1 行も変わらない`
  - テナント分離 > `他テナントの reservationId を取り消しても 404 で、相手の枠のロックが消えない`
  - テナント分離 > `他テナントの reservationId の経緯は 404 になる`
  - テナント分離 > `クエリに他テナントの organizationId を混ぜても自分のご予約しか返らない`
  - テナント分離 > `別の店舗の reservationId は、同じ組織でも選択中店舗の外なら結果に出ない`（Q-04 のいまの前提）
- **完了条件**: 権限表 20 行と分離 6 本が赤い。**新しいルートを足したらこの表に 1 行足す。**
- **依存**: T-002

## T-009 検索の純関数を実装する（Green）

- **目的**: T-003 と T-007 の期間まわりを緑にする。
- **触るファイル**: `services/glasses_management/src/worker/domain/reservation-search.ts`（新規）
- **実装**
  - `resolveSearch(query, { now })` — 条件を SQL の断片（`where` 配列 + パラメータ）に直す純関数。
    `organization_id` と `store_id` を**必ず**先頭に置く。呼び出し側がこの 2 つを外せる形にしない。
  - 電話は 2 経路。**4 桁ちょうど → `phone_last4 = ?`**、**5 桁以上 → `phone_normalized LIKE ? || '%'`**。
    後方一致（`LIKE '%' || ?`）を書かない（B-tree が効かず顧客表の全走査になる）。
  - お名前は `name LIKE '%' || ? || '%'`、かなは `kana LIKE '%' || ? || '%'`。
    かなの入力（`kana` 欄が空で `name` にひらがなだけが入っている場合）は**両方に当てる**（AC-CHANGE-02）。
  - 期間は JST の暦日 → UTC の半開区間。`from` は `T-15:00:00.000Z`（前日）、`to` は `to+1 日 T-15:00:00.000Z`。
  - `relaxationsFor(query, counts)` — 案は 3 種類だけ（期間を広げる / 出どころの絞りを外す / 取消を含める）。
    件数 0 の案を落とし、件数の多い順に最大 3 件。`label` は
    `期間を <M月D日> 〜 <M月D日> に広げる` / `「<出どころの語>だけ」を外す` / `取り消されたご予約も含める`。
    `query` には**外した条件以外をそのまま**入れて返す（画面はこれを再送するだけでよい）。
  - 期間を広げる幅は「`from` の月初 〜 `to` の翌月末」。8/27〜8/31 → 8/1〜9/30。
- **完了条件**: T-003 の 20 本と T-007 の期間 6 本が緑。
- **依存**: T-003, T-007

## T-010 変更・取消の純関数を実装する（Green）

- **目的**: T-004 を緑にする。差分・読み上げ文・バッチの組み立てを 1 か所に置く。
- **触るファイル**: `services/glasses_management/src/worker/domain/reservation-change.ts`（新規）
- **実装**
  - `diffReservation(before, after)` — 4 行固定（お日にちとお時間 / ご用件 / 担当 / 場所）を返し、
    各行に `changed: boolean` を持たせる。変更が 0 行なら空配列。
  - `sayOnConfirm(after)` — **確定前の形**で組み立てる。
    「8月27日木曜日、午後2時へお時間を変更いたします。担当は佐藤 美咲、所要時間は約60分です。こちらでお間違いないでしょうか？」
    **モックの「変更いたしました」「でございます」を採らない**（`design/06-use-cases.md` IDX-CHANGE-04 §5）。
  - `cancelOutcome(reason)` — `no_show` → `status='no_show'`、ほかの 3 つ → `status='cancelled'`。
    どちらも `cancelled_at` にサーバ時刻。
  - `buildChangeBatch({ reservationId, version, batchAt, slotCount, ... })` — 文の並びを**この順で固定**する:
    ① 新しい `reservation_slot_locks` の上限つき条件付き INSERT（`INSERT ... SELECT ... WHERE NOT EXISTS (…)`）
    ② `reservation_purposes` 置き換え ③ `reservation_assignments` 置き換え ④ `audit_events` INSERT
    ⑤ 古い `reservation_slot_locks` の DELETE（`created_at <> ?T`）
    ⑥ 最後に `UPDATE reservations SET ..., version = version + 1 WHERE id=?R AND version=?V`
  - **②〜⑤のすべての文に**版のガード `AND EXISTS (SELECT 1 FROM reservations WHERE id=?R AND version=?V)` と、
    枠のガード `AND (SELECT COUNT(*) FROM reservation_slot_locks WHERE reservation_id=?R AND created_at=?T) = ?N` を付ける。
    **0 行の `UPDATE` は D1 のバッチを止めない。**1 文目にだけ版の条件を置くと、409 を返しながら
    割当と占有行だけが書き換わり、**409 が二重予約を作る**。
  - `buildCancelBatch(...)` — `reservations` UPDATE / `reservation_slot_locks` DELETE / `audit_events` INSERT。
    DELETE と INSERT にも版のガードを付ける（付けないと 409 のときに枠だけ空く）。
  - 409 の見分け: **最後の文の `meta.changes === 0`** が版の競合。1 文目の `meta.changes === 0` が枠の競合。
    版か枠かはバッチのあとに `SELECT version FROM reservations WHERE id=?R` を 1 本読んで確かめ、
    その値を 409 の応答に載せる（何も書けていないので読み直して差し支えない）。
- **完了条件**: T-004 の 18 本が緑。
- **依存**: T-004

## T-011 空き枠に「自分を除く」引数を足す（Green）

- **目的**: 変更のとき、いま入っているご予約自身と競合しないようにする。
- **触るファイル**
  - `services/glasses_management/src/worker/domain/availability.ts`（P2 が作った純関数を拡張）
  - `services/glasses_management/test/availability.test.ts`（P2 のテストに追記）
- **先に書くテスト**
  - `excludeReservationId を渡すと、その予約が押さえている枠は塞がりに数えない`
  - `除いた結果、いまのご予約自身の時刻が「受付できます」に戻る`
  - `候補の先頭に、いまのご予約の時刻を「いまのまま」として置く`（AC-CHANGE-25）
  - `excludeReceptionSessionId は自分の受付が置いた仮の押さえだけを外す`
  - `他人の仮の押さえは塞がりとして数える`（AC-CHANGE-12 の「別の端末では 14:00 が満席」）
  - `所要 60 分が収まらない時刻は候補から落とす（60分の枠が取れる時刻だけを出す）`
  - `担当・設備が現状のままでは取れない時刻には理由を添えて候補に残す`
- **実装**: `excludeReservationId` を受け、`reservations` / `reservation_assignments` /
  `reservation_slot_locks` の重なり判定からその予約 ID の行を除く。
  仮の押さえ（KV `SHORT_LIVED` の `hold:<orgId>:<storeId>:<holdId>`）は 1 回の `KV.list` で
  metadata ごと受け取り、`excludeReceptionSessionId` に一致するものだけ外す。
  **押さえを読むのは業務面だけ**（`/api/public/**` では読まない。KV list は無料枠で 1,000 回/日）。
- **完了条件**: 7 本が緑。P2 の既存テストが 1 本も落ちない。
- **依存**: T-010

## T-012 Worker にルートを足す（Green）

- **目的**: T-005 / T-006 / T-008 を緑にする。
- **触るファイル**: `services/glasses_management/src/worker/index.ts`（チェーンに追記）
- **実装**
  - チェーンに 4 本足す（**この順**）:
    - `GET /api/staff/reservations`（`ReservationSearchQuery` → `ReservationList`）
    - `PATCH /api/staff/reservations/:reservationId`（`ReservationChangeInput` → `ReservationDetail`。
      409 `version_conflict` / 409 `slot_taken`）
    - `POST /api/staff/reservations/:reservationId/cancel`（`ReservationCancelInput` → `ReservationDetail`。
      409 `version_conflict`）
    - `GET /api/staff/reservations/:reservationId/history`（→ `ReservationChangeHistory[]`。404 `not_found`）
  - **仮の押さえのルートを新設しない。** P3 が作った `POST /api/staff/holds` /
    `DELETE /api/staff/holds/:holdId` を変更の面から使う。鍵は `hold:<orgId>:<storeId>:<holdId>` の 1 通り。
  - `Idempotency-Key` を**受け取らない**（変更・取消は `version` の楽観ロックで二重適用を防ぐ。
    冪等キーを重ねない — `design/04-api.md` §6.1）。
  - 409 の応答本文: `{ error: 'version_conflict', current: { version, startsAt, endsAt, staffName, equipmentNames, savedAt, savedBy } }`
    ／ `{ error: 'slot_taken', alternatives: AvailabilitySlot[] }`（最大 3 件）。
  - `db.batch()` は T-010 が組み立てた並びをそのまま投げる。**アプリ側で並べ替えない。**
  - `export type AppType = typeof routes` を保つ（ルートを `app.get(...)` 単発で書かない）。
- **完了条件**: `pnpm --filter @app/glasses_management test` が緑、カバレッジ 4 指標 80% 以上。
- **依存**: T-005, T-006, T-008, T-009, T-010, T-011

## T-013 画面の計画を書き、行き先の名前を直す

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: お客様と電話でつながったまま、目当ての 1 件を当てて、変える前と後を読み上げて確かめる面。
  - トークン計画: **左は探す・右は決める**の 2 段組み。緑（`--color-pine` / `--color-pine-soft`）は
    「選ばれているもの」と「変わる行」だけに使い、赤（`--color-danger`）は取消と競合の見出しだけに使う。
    角は 8/12/16px の 3 段、書体は 1 書体でウェイトだけ。**色だけで状態を伝えず、必ず文字を添える**
    （「受付できます」「満席」「変更」「いまのまま」）。
  - シグネチャ: **変わる行だけが緑地になり、変わらない行は薄字のまま並ぶ差分表。**
- **触るファイル**
  - `services/glasses_management/src/web/shell/destinations.ts`（`search` のラベルを直す）
  - `services/glasses_management/src/web/App.test.tsx`（ラベルのテストを直す）
- **やること**
  - サイドバーの行き先の名前を **`予約を検索` → `予約を探す`** に直す
    （`design/05-screen-flow.md` §2.2。面の名前「予約を変更する」とは別の 2 段として持つ）。
  - `RAIL_BY_DEFAULT` は変えない（CHANGE 系 7 面はすべて **ひらく 216px が既定**）。
- **完了条件**: `pnpm --filter @app/glasses_management test:web` が緑。この計画がこの節に 3 行で書けている。
- **依存**: T-012

## T-014 画面のテスト（検索と 0 件）を書く（Red）

- **目的**: CHANGE-SEARCH と EX-EMPTY-SEARCH で「何が読めて、何が押せるか」を先に決める。
- **触るファイル**: `services/glasses_management/src/web/search/SearchPage.test.tsx`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test:web`）
  - 探す > `お名前・お電話番号・予約番号の 3 つの欄がある`
  - 探す > `絞り込みは これから／今日／取消済み の 3 つで、押すと選択が入れ替わる`
  - 結果 > `件数を「結果 4件」と出す`
  - 結果 > `1 行目に 8/27（木）11:00・田中 花子 様・4回目・メガネを新しく作る／佐藤 美咲 が並ぶ`
  - 結果 > `担当が決まっていない行は「担当が未定」と描く`
  - 結果 > `「今日」を押すと 8/27 の 3 件だけが残る`
  - 結果 > `「取消済み」を押すと取り消されたご予約が結果に加わる`
  - 詳細 > `1 件を押しても一覧は左に残る`
  - 詳細 > `予約番号・出どころの札・日時・所要・ご用件・お客様・担当と場所を読める`
  - 詳細 > `「変更の内容は、お客様にお伝えしてから確定します。」が出る`
  - 詳細 > `出口は 日時を変える／担当・場所を変える／取り消す の 3 つ`
  - 0 件 > `「結果 0件」が role="status" で読み上げに届く`（AC-CHANGE-22）
  - 0 件 > `「入力した条件はそのまま残しています。」が出て、入れた条件が欄に残る`
  - 0 件 > `右に「この条件では、ご予約が見つかりませんでした」が出る`
  - 0 件 > `緩和の案は「5件　「Web予約だけ」を外す」のように件数を含む名前の押せる操作になる`
  - 0 件 > `案を押すとその条件だけが外れ、ほかの条件は残る`
  - 0 件 > `「ほかの探し方」は お電話番号で探す／予約番号で探す の 2 行`（Q-04：他店舗の行は出さない）
  - 0 件 > `「顧客台帳で調べる」を押すと入れたお名前を引き継ぐ`（AC-CHANGE-24）
  - 読み込み中 > `行の高さ 62px を保った灰色の帯をモックと同じ 4 本置く`
  - 触れる大きさ > `絞り込みの札と結果の行が 44px 以上ある`
- **完了条件**: 20 本が赤い。
- **依存**: T-013

## T-015 画面のテスト（日時・差分・取消・完了・競合）を書く（Red）

- **目的**: 工程 2〜4 と例外 2 面の中身を先に決める。
- **触るファイル**
  - `services/glasses_management/src/web/search/ChangeDateTime.test.tsx`（新規）
  - `services/glasses_management/src/web/search/ChangeDiff.test.tsx`（新規）
  - `services/glasses_management/src/web/search/ChangeCancel.test.tsx`（新規）
  - `services/glasses_management/src/web/search/ChangeDone.test.tsx`（新規）
  - `services/glasses_management/src/web/search/ConflictResolve.test.tsx`（新規）
- **先に書くテスト**
  - 日時 > `左に「いまのご予約」が固定で置かれ、日時・お客様・ご用件と所要・担当と場所を読める`
  - 日時 > `「60分の枠が取れる時刻だけを出しています。」が出る`
  - 日時 > `候補の先頭が「11:00　いまのまま」になる`（AC-CHANGE-25）
  - 日時 > `候補に「受付できます」「満席」の文字が添う（色だけで伝えない）`
  - 日時 > `「15:30　満席」は押せない`
  - 日時 > `定休日の 1日 は「定休」と出て押せない`
  - 日時 > `時刻を選ぶと「14:00 から60分、佐藤 美咲／視力測定機 A を確保します。」が出る`
  - 日時 > `工程バーは 1 予約を探す／2 日時を変える／3 ご確認／4 完了 の 4 段で、2 に aria-current="step" が付く`
  - 日時 > `仮の押さえの残り時間を出し、残り 60 秒で role="status" の警告と「まだ入力中です」が出る`（Q-06）
  - 差分 > `「この内容に変更します」「変わる行だけ色を付けています」が出る`
  - 差分 > `表は 項目／変更前／変更後 の 3 列`
  - 差分 > `お日にちとお時間 と 場所 の行に「変更」の札が付く`
  - 差分 > `ご用件 と 担当 の行に「変更」の札が付かない`（AC-CHANGE-13）
  - 差分 > `右に読み上げ文が出て、末尾が「こちらでお間違いないでしょうか？」になる`
  - 差分 > `店内予約では「お電話でのご予約のため、メールは送りません。」が出る`
  - 差分 > `Web予約では「Webでのご予約のため、変更をメールでお知らせします。」に変わる`
  - 差分 > `「戻って直す」で日時を選ぶ画面へ戻り、まだ何も保存されていない`（AC-CHANGE-14）
  - 取消 > `「この予約を取り消します」「まだ取り消していません」が出る`
  - 取消 > `対象のご予約が 1 枚のカードで出る（日時と所要／お客様／ご用件／担当と場所）`
  - 取消 > `「取り消すと、この枠はすぐほかのお客様にご案内できる状態になります。」が出る`
  - 取消 > `理由の 4 択はどれも選ばれていない状態で始まる`（**モックの「お客様のご都合＝選択中」を採らない**）
  - 取消 > `理由を選ぶまで「この予約を取り消す」は押せず、押せない理由が aria-label に入る`（AC-CHANGE-16）
  - 取消 > `画面に入った直後の焦点は「取り消さずに戻る」に当たる`（AC-CHANGE-21）
  - 取消 > `焦点の当たったボタンから「この予約を取り消します」「まだ取り消していません」が読める`（aria-describedby）
  - 取消 > `左が「取り消さずに戻る」、右が「この予約を取り消す」の逆転レイアウトになっている`
  - 完了 > `「ご予約の変更を承りました」と「予約番号は変わりません」が出る`
  - 完了 > `予約番号が変わっていない`
  - 完了 > `変更後の日時に「変更前は 11:00–12:00」が添う`
  - 完了 > `「この操作は受付履歴に残ります（銀座店 レジ横iPad・11:12　操作者 中村 彩）。」が出る`
  - 完了（取消） > `「ご予約を取り消しました」「この枠は、ほかのお客様にご案内できる状態に戻りました。」が出る`
  - 競合 > `「同じご予約を、ほかの端末でも直していました」と「選ぶまで、どちらの内容も書き換わりません。」が出る`
  - 競合 > `左に相手の内容（保存済み）、右に自分の内容（まだ保存していません）が並ぶ`
  - 競合 > `変わった項目だけ旧値に取り消し線が付き、変わらない項目は薄字になる`
  - 競合 > `出口は 相手の内容を残す／あなたの内容で上書きする／1項目ずつ選ぶ／やめて台帳に戻る の 4 つ`
  - 競合 > `「1項目ずつ選ぶ」を押すと各行にラジオが出て、全行を選ぶまで保存を押せない`
  - 競合 > `どの出口も、押した時点ではまだ何も保存されていない`
- **完了条件**: 36 本が赤い。
- **依存**: T-013

## T-016 CHANGE-SEARCH と EX-EMPTY-SEARCH を実装する（Green）

- **目的**: T-014 を緑にする。お名前・お電話番号・予約番号のどれからでも 1 件にたどり着く面と、
  0 件のときに「入力を捨てずに次の一手を出す」面を立てる。
- **見るモック**: `docs/frontend/mockups/eye/images/CHANGE-SEARCH.png` /
  `docs/frontend/mockups/eye/images/EX-EMPTY-SEARCH.png`（**Read で実際に見る**）
- **触るファイル**
  - `services/glasses_management/src/web/search/SearchPage.tsx`（新規）
  - `services/glasses_management/src/web/search/ReservationDetailPane.tsx`（新規）
  - `services/glasses_management/src/web/search/Relaxations.tsx`（新規）
  - `services/glasses_management/src/web/search/format.ts`（新規。日時・予約番号・出どころの語）
- **実装（モックの実測値をそのまま）**
  - 上のバーの小見出しは **「予約を変更する」**。左サイドバーの選択は `予約を探す`。
  - CHANGE-SEARCH の 2 段組みは `340px 1fr`、EX-EMPTY-SEARCH は `300px 1fr`。
  - 左ペイン: padding `32px 24px`、見出し 17px（0 件の面は 16px）、欄の間 16px（0 件の面は 14px）。
    0 件の面だけ左ペインを白地にし、右に 1px の `--color-line-strong` の罫を引く。
  - 絞り込みの札: 最小高 **44px**、padding `0 14px`、角はピル、14px/600。選択中は緑地・白文字。
  - 結果の見出し「結果 4件」は 13px、margin `26px 0 10px`。
  - 結果の行: 最小高 **62px**、padding `10px 12px`、角 12px、行間 10px。
    左の時刻は幅 74px の等幅 12px/1.45。名前 15px、概要 12px。
    選択中は 2px の緑の縁 + `--color-pine-soft`（padding は `9px 11px` に詰める）。
  - 右ペイン: padding `36px 40px`。予約番号は等幅 15px、日時は 26px/600、所要は 15px。
    項目名の列は幅 128px の 13px、値は 17px/600。注意ごとのカードは上に 26px 空ける。
  - 0 件: 「結果 0件」は 16px/700 の `--color-danger`、`role="status"`。
    その下に「入力した条件はそのまま残しています。」を 6px 空けて 13px で置く。
  - 0 件の右: 見出し 22px（下 30px）、小見出し 16px/700。
    緩和の案は 3 列 grid・gap 14px・最小高 **112px**・padding `14px 16px`・角 12px。
    件数は等幅 22px/700 の `--color-pine-deep`、「件」は 13px。案の文は 15px/1.45、上 6px。
    案の押せる名前は **「5件　「Web予約だけ」を外す」**（件数を含む）。
  - 「ほかの探し方」は **2 行**（お電話番号で探す／予約番号で探す）。
    Q-04 のいまの前提により**他店舗の行を出さない**（押せない導線を置かない）。
  - 下の出口: 顧客台帳で調べる／新しく予約を取る。
  - **空いた場所を埋めるために要素を足さない。**EX-EMPTY-SEARCH の右ペインは白い箱が 3 枚で、
    下半分が空いているのが正しい状態。
  - 色・寸法は `packages/ui/src/theme.css` のトークン経由のみ。Tailwind 既定パレットと任意値を書かない。
- **完了条件**: T-014 の 20 本が緑。
- **依存**: T-014, T-012

## T-017 CHANGE-DATETIME と CHANGE-DIFF を実装する（Green）

- **目的**: T-015 の日時 9 本と差分 9 本を緑にする。変更先の枠を選ばせ、変わる行だけを色と文字で示して
  確定前に読み上げられる形にする。
- **見るモック**: `images/CHANGE-DATETIME.png` / `images/CHANGE-DIFF.png`（**Read で実際に見る**）
- **触るファイル**
  - `services/glasses_management/src/web/search/ChangeDateTime.tsx`（新規）
  - `services/glasses_management/src/web/search/ChangeDiff.tsx`（新規）
- **実装（モックの実測値をそのまま）**
  - 上のバーの小見出しは **「予約の変更　EY-2608-0142」**（半角ハイフン U+002D。モックの非改行ハイフンを採らない）。
  - CHANGE-DATETIME: `300px 1fr`。左ペイン padding `36px 26px`、見出し 15px、日時は 20px/1.4 の
    `--color-pine-deep`、項目名 12px（上 24px）、値 17px/600、補足 13px。
  - 日付は 7 列 grid・gap 10px・最小高 **76px**・21px/600。選択中は 3px の緑の縁 + `--color-pine-soft`。
    定休は `--color-surface-2` 地に `--color-ink-faint` で「定休」を添えて押せなくする。
  - 時刻は 5 列 grid・gap 12px・最小高 **96px**・padding 14px。時刻は 24px/600、
    札の文は 13px/1.35（上 6px）。選択中は 3px の縁（padding を 12px に詰める）。
    満席は `--color-surface-2` 地で `disabled`。
  - 候補の先頭に **「11:00　いまのまま」**（いま入っているご予約自身の時刻）。
  - 選んだ結果は 1 文で返す: 「14:00 から60分、佐藤 美咲／視力測定機 A を確保します。」（20px/1.5・緑）。
  - 下辺は工程バー 76px（`‹` 48円 + 4 段 + 主操作「変更内容を確認する」）。`@app/ui` の `StepBar` を使う
    （P3 が置いた `<ol>` + `aria-current="step"`）。
  - CHANGE-DIFF: `1fr 360px` gap 32px、padding 36px。見出し 18px、補足は 400/13px を 10px 右に。
  - 差分表は `132px 1fr 1fr` の grid、隙間 1px を `--color-line` で見せ、外枠 1px `--color-line-strong`・角 12px。
    セルは padding `16px 14px`・16px。見出し行は `--color-surface-2` の 12px/600（padding `8px 14px`）。
    項目名の列は 13px/600。補足は 13px。
  - **変わる行だけ** `--color-pine-soft` を敷き、変更後のセルを 700 の `--color-pine-deep` にして
    「変更」の札を 10px 右に付ける。変わらない行の変更後は `--color-ink-muted` の薄字。
  - 右の読み上げカードは 2px の `--color-pine-line` の縁、本文 24px/1.6。
    **確定前の形**で書く（「…変更いたします。…こちらでお間違いないでしょうか？」）。
    モックの「変更いたしました」「でございます」を採らない。
  - 通知の 1 行はカードの下に 13px で置く（店内予約と Web 予約で文言が入れ替わる）。
  - 下の出口: 「読み上げてご了承をいただいてから確定してください。」＋ 戻って直す／変更を確定する。
  - 確定の 409 は 2 通りに分ける: `version_conflict` → EX-CONFLICT へ、
    `slot_taken` → BOOK-CONFLICT と同じ形（「まだ変更していません。伺った内容は残っています。」→ 何が埋まったか →
    同じ担当で取れる時刻 3 件と担当だけ入れ替える案 1 件）で出し、いまのご予約は元のまま残す（AC-CHANGE-26）。
- **完了条件**: T-015 のうち日時 9 本・差分 9 本が緑。
- **依存**: T-015, T-016

## T-018 CHANGE-CANCEL と CHANGE-DONE を実装する（Green）

- **目的**: T-015 の取消 8 本と完了 5 本を緑にする。取消は理由を選ぶまで押せない形にし、完了は
  「予約番号が変わらないこと」を主役にする。
- **見るモック**: `images/CHANGE-CANCEL.png` / `images/CHANGE-DONE.png`（**Read で実際に見る**）
- **触るファイル**
  - `services/glasses_management/src/web/search/ChangeCancel.tsx`（新規）
  - `services/glasses_management/src/web/search/ChangeDone.tsx`（新規）
- **実装（モックの実測値をそのまま）**
  - CHANGE-CANCEL: 上のバーの小見出しは **「予約の取り消し　EY-2608-0142」**。padding `36px 44px`。
    見出し 18px + 補足 13px（10px 右）。
  - 対象のカードは `--color-danger-soft` 地の 4 列 grid（`250px 1fr 1fr 1fr`）・gap 20px・padding `22px 24px`。
    左は 24px/1.3 の日時 + 13px の「所要 60分」、右 3 つは 12px の項目名 + 17px/600 の値 + 13px の補足。
  - 予告の 1 行「取り消すと、この枠はすぐほかのお客様にご案内できる状態になります。」を 14px 空けて 13px で置く。
  - 理由は 4 列 grid・gap 12px・最小高 **96px**・padding `16px 18px`・18px/600・補足 13px/1.4。
    選択中は 3px の緑の縁 + `--color-pine-soft`（padding を `14px 16px` に詰める）。
    **どれも選ばれていない状態から始める**（モックの `.reason.on` を採らない）。`@app/ui` の `ChoiceGroup` を使う。
  - 下辺は逆転レイアウト: 左が主操作「取り消さずに戻る」、中央に 13px `--color-danger` の
    「お客様にお伝えしてから取り消してください。取り消した予約は元に戻せません。」、右が危険操作「この予約を取り消す」。
  - 面に入った直後に「取り消さずに戻る」へ焦点を移し、そのボタンを `aria-describedby` で
    「この予約を取り消します」「まだ取り消していません」に結ぶ（AC-CHANGE-21）。
  - 理由が未選択の間は「この予約を取り消す」を `disabled` にし、`aria-label` に押せない理由を持たせる。
  - CHANGE-DONE: padding `40px 44px 0`・中央寄せ。丸い印 76px（`--color-pine` 地）、見出し 26px。
    予約番号のピルは `--color-pine-soft` 地・等幅 16px/600 + 13px の「予約番号は変わりません」。
    下は最大幅 900px の 2 列（gap 56px、上 44px）。小見出し 14px/600、値 17px/600、
    日時だけ 22px の `--color-pine-deep`、補足 13px。
    「お客様にお伝えすること」は罫線区切りの 16px/1.6。
    出口は「台帳で見る」（主操作）と「トップへ戻る」（控えめ）。
    左下 44px / 下 20px に 13px の脚注「この操作は受付履歴に残ります（銀座店 レジ横iPad・11:12　操作者 中村 彩）。」
  - **取消の完了は CHANGE-DONE を流用する**（新しい画面 ID を作らない）。文言だけ差し替える:
    「ご予約を取り消しました」＋「この枠は、ほかのお客様にご案内できる状態に戻りました。」＋同じ脚注。
  - 変更・取消のメールは**送らない**。`packages/contracts/src/notification.ts` の `NotificationJob` に
    取消・変更の型が無く、型を足すのは別サービスの契約変更（人間の承認事項）である。
    完了画面に「お客様へのご連絡は、お電話でお願いします。」を出す。日時だけを変えたときは
    `reservation.confirmed` の送り直しで賄う。
- **完了条件**: T-015 のうち取消 8 本・完了 5 本が緑。
- **依存**: T-015, T-017

## T-019 EX-CONFLICT を実装する（Green）

- **目的**: T-015 の競合 6 本を緑にする。同時編集で 409 になったとき、両方の内容を並べて
  「選ぶまでどちらも書き換わらない」ことを形で示す。
- **見るモック**: `images/EX-CONFLICT.png`（**Read で実際に見る**）
- **触るファイル**: `services/glasses_management/src/web/search/ConflictResolve.tsx`（新規）
- **実装（モックの実測値をそのまま）**
  - padding `32px 36px 28px`。上に左 6px の `--color-danger` を持つカードで
    「同じご予約を、ほかの端末でも直していました」（22px・赤）＋
    「受付iPad の 中村 彩 が 11:06 に保存しました。選ぶまで、どちらの内容も書き換わりません。」（16px/1.6）。
  - 下は 2 列 grid・gap 24px（上 28px）。各面は 1px `--color-line-strong` の枠・角 12px。
    自分の面だけ 2px の緑の枠にし、見出し帯を `--color-pine-soft` にする。
  - 見出し帯: padding `14px 18px`、名前 16px、出どころ 13px（「受付iPad／11:06 保存済み」／
    「レジ横iPad／まだ保存していません」）。
  - 行は `116px 1fr` の grid・gap 12px・padding `15px 0`。項目名 13px、値 16px/600/1.45。
    **旧値は 13px の取り消し線**で値の下に置く。変わらない項目は 400 の `--color-ink-muted`。
  - 各面の下に幅いっぱいのボタン（左「中村 彩 の内容を残す」／右「あなたの内容で上書きする」）。
    その下に「1項目ずつ選ぶ」「やめて台帳に戻る」。
  - **選ぶまでどちらの内容も送らない。** 出口ごとの動きは:
    - 「相手の内容を残す」— 書き込みを送らず、最新の版を読み直して表示する。
      自分の入力を捨てたことを 1 文で出す（AC-CHANGE-23）。
    - 「あなたの内容で上書きする」— 送る前に `GET /api/staff/availability`（`excludeReservationId` 付き）で
      **空き枠を当て直し**、空いていれば相手の最新 `version` を載せて `PATCH` する（AC-CHANGE-20）。
    - 「1項目ずつ選ぶ」— 同じ画面の各行にラジオ（相手／自分）を出す。既定はどちらも未選択で、
      全行を選ぶまで保存を押せない。**混ぜた組み合わせはどちらの端末も検証していないので、当て直しを省かない。**
    - 「やめて台帳に戻る」— 自分の編集を捨てて台帳へ戻る。
  - 当て直しで埋まっていたら 409 `slot_taken` の形（BOOK-CONFLICT）に落とす。
  - サイドバーの選択は**ルートで決める**。`/search` なので `予約を探す`
    （モックは `予約台帳` になっているが `design/05-screen-flow.md` §8 の既知差分 #8。モックの画像は直さない）。
- **完了条件**: T-015 のうち競合 6 本が緑。web カバレッジ 4 指標 60% 以上。
- **依存**: T-015, T-017

## T-020 E2E を書き、spec を Approved に上げる

- **目的**: Approved の UC/AC 37 個（UC-CHANGE-01〜10 と AC-CHANGE-01〜27）に、
  有効な `@e2e-covers` をちょうど 1 つずつ貼り、traceability を通す。
- **触るファイル**
  - `services/glasses_management/e2e/change-and-cancel.spec.ts`（新規）
  - `specs/glasses_management/features/009-change-and-cancel/spec.md`
- **やること**
  - AC-CHANGE-01〜27 に **1 対 1** で Playwright test を書き、直前の行に `// @e2e-covers AC-CHANGE-NN`。
  - UC-CHANGE-01〜10 は、その挙動を実際に通す test の同じ行に**相乗り**させる（重複は落ちる）:

    | UC | 相乗りさせる AC |
    |---|---|
    | UC-CHANGE-01 | AC-CHANGE-08 |
    | UC-CHANGE-02 | AC-CHANGE-09 |
    | UC-CHANGE-03 | AC-CHANGE-11 |
    | UC-CHANGE-04 | AC-CHANGE-13 |
    | UC-CHANGE-05 | AC-CHANGE-15 |
    | UC-CHANGE-07 | AC-CHANGE-17 |
    | UC-CHANGE-08 | AC-CHANGE-19 |
    | UC-CHANGE-09 | AC-CHANGE-12 |
    | UC-CHANGE-10 | AC-CHANGE-18 |

    `UC-CHANGE-06`（日時を保ったまま担当と場所だけを置き直す）だけは対応する AC が無いので、
    **単独の test を 1 本**立てて `// @e2e-covers UC-CHANGE-06` を付ける。合計 28 本。
  - **validator の制約を守る**（`scripts/check-e2e-traceability.mjs`）:
    - `// @e2e-covers` は 1 行コメントのみ。ID は半角空白区切り。行末に ID 以外を書かない。
    - コメントの直後は `test(...)` でなければならない。**`test.describe` の中に置かない**
      （ソースファイル直下の式でないと拾われない）。空行は挟んでよい。
    - `test.only` / `test.skip` / `test.fixme` を使わない。
  - AC-CHANGE-12 と AC-CHANGE-19 は 2 台目の端末が要る。`browser.newContext()` で 2 つ目の
    ページを起こし、**同じ組織・同じ店舗**の別セッションとして操作する。
  - 全部書けたら spec の `- ステータス:` を `Draft` → `Approved` に上げる。
- **完了条件**: `pnpm --filter @app/glasses_management e2e` が緑、`pnpm run test:traceability` が
  `all approved UC/AC identifiers are mapped exactly once.` を出す。
- **依存**: T-016, T-017, T-018, T-019

## T-021 モックとの突き合わせに 7 面を足す

- **目的**: 承認された見た目からどれだけ離れているかを画素で測り、残っている差を数字と理由で記録に残す。
- **触るファイル**
  - `services/glasses_management/e2e/mock-compare.spec.ts`（追記）
  - `docs/frontend/mockups/eye/reference/`（`node docs/frontend/mockups/eye/reference.mjs` で作り直す）
- **やること**
  - `CHANGE-SEARCH` / `EX-EMPTY-SEARCH` / `CHANGE-DATETIME` / `CHANGE-DIFF` / `CHANGE-CANCEL` /
    `CHANGE-DONE` / `EX-CONFLICT` の 7 枚を
    `await expect(page).toHaveScreenshot('<画面ID>.png', { scale: 'device', maxDiffPixelRatio: … })` で撮る。
  - project は `mock`（viewport 1194×810 / deviceScaleFactor 2）。
    `pnpm --filter @app/glasses_management exec playwright test --project=mock`
  - **残っている差が何かを 1 枚ずつコメントに書く。**このフェーズで残る差は次のものだけ:
    - 録音の表示（CHANGE-SEARCH の「録音を聞く 03:12」／CHANGE-DATETIME の `.rec`／CHANGE-DIFF の `.rec-float`）… P7 で足す
    - 上のバーの「お知らせ 3」（EX-EMPTY-SEARCH / EX-CONFLICT）… P10 で足す
    - サイドバーの「＋ ＋ 予約を取る」（モック側の重複。§8 既知差分 #9。正は HOME）
    - サイドバーの行き先の名前（モックは「予約を検索」、実装は「予約を探す」。§2.2）
    - EX-CONFLICT のサイドバーの選択（モックは「予約台帳」、実装はルートどおり「予約を探す」。§8 既知差分 #8）
    - CHANGE-CANCEL の理由の初期選択（モックは「お客様のご都合＝選択中」、実装は未選択）
    - CHANGE-DIFF の読み上げ文（確定前の形に直してある。§13）
    - EX-EMPTY-SEARCH の「ほかの探し方」が 2 行（Q-04 のいまの前提）
  - `maxDiffPixelRatio` は「いま許している差」。**下げるだけで、上げてはいけない。**
- **完了条件**: `playwright test --project=mock` が緑。CHANGE-SEARCH / CHANGE-CANCEL / CHANGE-DONE /
  EX-CONFLICT の差分が 5% 以下、CHANGE-DATETIME / CHANGE-DIFF / EX-EMPTY-SEARCH が 8% 以下。
- **依存**: T-020

## T-022 完了の確認

- **目的**: このフェーズが終わったことを、機械が確かめられる形で残す。
- **触るファイル**: `docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md`（追記）/
  `specs/glasses_management/features/009-change-and-cancel/spec.md`（ステータスの確認だけ）
- **先に書くテスト**: なし（既存のテストを走らせるだけ）。
- **実装**: 下のコマンドを上から順に実行し、赤いものを直してから次のコマンドへ進む。**飛ばさない。**

```sh
pnpm run lint          # 緑
pnpm run deps:check    # 緑
pnpm run typecheck     # 緑
pnpm run test          # 緑（traceability を含む）
pnpm --filter @app/glasses_management test:all            # 緑（Worker 80% / web 60%）
pnpm --filter @app/glasses_management e2e                 # 緑
pnpm --filter @app/glasses_management exec playwright test --project=mock   # 緑
```

- **完了条件**
  - `pnpm check` が緑。
  - `specs/glasses_management/features/009-change-and-cancel/spec.md` が `- ステータス: Approved`。
  - Worker 側カバレッジ 4 指標 80% 以上 / web 側 60% 以上（**閾値を下げない・広く除外しない**）。
  - 進捗台帳（`docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md`）に、
    実行したコマンドとその結果・カバレッジの実測値・`maxDiffPixelRatio` の実測値を書いた。
- **依存**: T-021
