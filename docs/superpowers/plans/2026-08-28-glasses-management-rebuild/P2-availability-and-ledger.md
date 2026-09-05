# P2 空き枠と予約台帳 — TODO

- spec: [`specs/glasses_management/features/005-availability-and-ledger/spec.md`](../../../../specs/glasses_management/features/005-availability-and-ledger/spec.md)
- 依存: P1
- 状態: 未着手
- 目的: 店の決まりをすべて掛けて「置ける時刻」を出す純関数と、その日の予約を担当者別・設備別・
  時間順の 3 通りで読む予約台帳を作る。この段階では**読むことと、置けるかどうかの判断**だけを持つ。

> 書き方の手本は [`P0-foundation.md`](./P0-foundation.md)。1 タスクは
> 「目的 / 触るファイル / 先に書くテスト / 実装 / 完了条件 / 依存」を必ず持つ。
> **テストを先に書き、期待した理由で失敗することを目で見てから実装する。**

## このフェーズで先に頭に入れること

| 事実 | 出どころ |
|---|---|
| 台帳の表示窓は **10:00–16:30 の 30分刻み 14 列**。営業時間がそれより長い日は台帳の中だけを横スクロールさせる | AC-LEDGER-02 ／ モック 3 面 |
| 現在時刻の線は**応答の `serverNow`** から算出する。端末の時計を読まない | AC-LEDGER-03 ／ `design/06-use-cases.md` IDX-LEDGER-06 |
| `axis`（`staff` / `resource`）と `view`（`timetable` / `list`）は**別の指定**。1 つの enum にまとめない | `design/04-api.md` §3.6 |
| `source` は **4 値**（`phone` / `counter` / `web` / `walkin`）、表示語は 4 語、帯の色は 3 系統。緑の帯は語を持たない | AC-LEDGER-05 ／ `design/03-data-model.md` §7.1 |
| 担当が未定（`reservation_assignments.target_id IS NULL`）の予約も**枠を消費する** | `design/02-domain-model.md` I-05 |
| `customers` は P4、`walk_ins` は P5。**この段階の台帳はお客様のお名前と来店回数を描かない**。「ご来店お待ち」は人数 0 の器 | spec §2「データモデル差分」 |
| P2 は予約を**書かない**。テストデータは API ではなく直接 INSERT と seed で作る | `design/03-data-model.md` §12 |

---

## T-001 契約を書く（Red → Green）

- **目的**: 台帳と空き枠の応答の形を Zod で 1 か所に決め、境界値と未知キーをテストで固定する。
- **触るファイル**
  - `packages/contracts/src/glasses_management.ts`（追記）
  - `packages/contracts/src/index.ts`（re-export を足す）
  - `packages/contracts/test/glasses_management.contract.test.ts`（追記）
- **先に書くテスト**（`pnpm --filter @app/contracts test`）
  - `LedgerQuery` > `axis の既定は staff、view の既定は timetable、filter の既定は all`
  - `LedgerQuery` > `axis に equipment を渡すと落ちる（URL に乗る語は resource）`
  - `LedgerQuery` > `filter に pending_review を渡すと落ちる（語は pending）`
  - `LedgerQuery` > `date は YYYY-MM-DD だけを受ける（2026-8-7 は落ちる）`
  - `LedgerView` > `serverNow が無い応答は落ちる（現在時刻の線の出どころだから）`
  - `LedgerView` > `定休日は opensAt と closesAt が null でも通る`
  - `LedgerView` > `counts は all / upcoming / pendingReview の 3 つを必ず持つ`
  - `LedgerLane` > `kind は staff / equipment / unassigned / walkin の 4 値`
  - `LedgerLane` > `unassigned と walkin の行は id が null でよい`
  - `LedgerEntry` > `customerName と visitCount は null を許す（顧客は 007 で足す）`
  - `LedgerBlock` > `kind は break / maintenance / closed の 3 値で、label は 30 文字まで`
  - `ReservationSource` > `phone / counter / web / walkin の 4 値だけを受ける`
  - `ReservationAssignment` > `targetId は null を許す（あとで決める）`
  - `ReservationDetail` > `purposes は 1 件以上 5 件まで`
  - `ReservationDetail` > `code は EY-2608-0142 の形。EY-W- で始まる番号は落ちる`
  - `ReservationDetail` > `webBookingCode は source が web のときだけ非 null になる`
  - `AvailabilityQuery` > `purposeIds はカンマ区切りで最大 5 件、6 件目で落ちる`
  - `AvailabilityQuery` > `durationMinutes は 5 の倍数で 5〜480`
  - `AvailabilityReason` > `11 値をすべて受け、知らない語は落ちる`
  - `AvailabilitySlot` > `remaining は 0 以上。−1 は落ちる`
  - `AvailabilityResponse` > `定休日は isClosed が true で slots が空でも通る`
  - `AvailabilityResponse` > `alternatives は 3 件まで`
  - 共通 > `いずれの応答スキーマも知らないキーを 1 つ混ぜると落ちる`
- **実装**: `design/04-api.md` §4.4 / §4.5 の表のとおりに `ReservationSource` / `ReservationStatus` /
  `ReservationAssignment` / `ReservationPurposeLine` / `ReservationDetail` / `ReservationSummary` /
  `LedgerQuery` / `LedgerView` / `LedgerLane` / `LedgerEntry` / `LedgerBlock` /
  `AvailabilityQuery` / `AvailabilitySlot` / `AvailabilityReason` / `AvailabilityLane` /
  `AvailabilityResponse` を足す。原始型（`LocalDate` / `LocalTime` / `IsoDateTime` / `Uuid` /
  `DurationMinutes` / `ReservationCode` / `Version`）は §4.1 の定義を再利用する。
  `z.strictObject` を使い、手書き型と `any` を書かない。
- **完了条件**: 23 本が緑。`packages/contracts` のカバレッジ 4 指標 80% 以上。
- **依存**: なし

## T-002 スキーマ 4 表と index を書く（Red → Green）

- **目的**: 予約の 4 表を作り、index が「実際に投げるクエリの形」に合っていることをテストで固定する。
- **人の承認**: `reservation_slot_locks` は決定ブリーフ §3 に無い表の追加なので、**着手前に人の承認を取る**
  （規約 10）。承認が取れるまでこのタスクを始めない。理由は `design/03-data-model.md` §7.6 に書いてある
  （D1 の `db.batch()` は同じバッチの中で読んで判定して書けないので、二重予約を止める手段がこの表しかない）。
- **触るファイル**
  - `services/glasses_management/src/worker/db/schema.ts`（追記）
  - `services/glasses_management/test/schema.test.ts`（追記）
  - `services/glasses_management/migrations/0002_*.sql`（生成物）
- **先に書くテスト**（`getTableConfig` で index の名前・対象列・一意かどうかを見る）
  - `reservations` > `組織・店舗・開始時刻で 1 日分を引く index を持つ`
  - `reservations` > `組織の中で予約番号が一意である`
  - `reservations` > `絞り込み用に組織・店舗・状態・開始時刻の index を持つ`
  - `reservations` > `顧客の次のご予約を引く index を持つ`
  - `reservation_purposes` > `予約 id と並び順で引ける`
  - `reservation_assignments` > `種別・対象・開始時刻で「その担当はその時間に空いているか」を引ける`
  - `reservation_assignments` > `予約 id で 1 件分をまとめて引ける`
  - `reservation_slot_locks` > `組織・店舗・種別・対象キー・枠の開始の複合 index を持つ`
  - `reservation_slot_locks` > `その index は一意でない（上限つきの条件付き INSERT が上限を数えるため）`
  - `reservation_slot_locks` > `予約 id で一括 DELETE できる index を持つ`
  - 共通 > `4 表とも外部キーを宣言しない`
- **実装**（`design/03-data-model.md` §7.1 / §7.2 / §7.3 / §7.6 の列表をそのまま写す）
  - `reservations`: `id` / `organization_id` / `store_id` / `code` / `customer_id`（常に NULL）/
    `source` / `status` / `starts_at` / `ends_at` / `duration_minutes` / `note_customer` /
    `note_internal` / `version` / `created_at` / `updated_at` / `created_by` /
    `cancelled_at` / `cancel_reason`
  - `reservation_purposes`: `id` / `organization_id` / `reservation_id` / `purpose_id` /
    `duration_minutes` / `sort_order` / `created_at`
  - `reservation_assignments`: `id` / `organization_id` / `reservation_id` / `kind` /
    `target_id`（NULL 可）/ `starts_at` / `ends_at` / `created_at`。`store_id` は置かない
  - `reservation_slot_locks`: `id` / `organization_id` / `store_id` / `reservation_id` / `kind` /
    `target_key`（`unassigned` の固定値を使う。NULL を使わない）/ `slot_start` / `created_at`
  - あわせて `visit_purposes` に `name_short`（1〜5 文字・NOT NULL）を足す。**P1 が既にこの列を
    出していれば足さない**（`migrations/0001_*.sql` を先に読んで確かめる）。
  - 真偽値は `'0'|'1'`、日時は ISO8601 文字列、日付は `YYYY-MM-DD`、時刻は `HH:MM`。FK を宣言しない。
- **手順**: 編集 → `pnpm --filter @app/glasses_management db:generate` →
  生成された `0002_*.sql` を目で読む（テーブル再作成が出ていたら手で直す）→ `db:migrate:local`
- **完了条件**: `0002_*.sql` が生成され、`schema.test.ts` が緑。
- **依存**: T-001

## T-003 空き枠の 8 条件を表で縛る（Red）

- **目的**: 8 条件を 1 つずつ落としたときに枠が消えることを、条件ごとに 1 本ずつ固定する。
- **触るファイル**: `services/glasses_management/test/availability.test.ts`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test`。**時刻は必ず引数で注入する**）
  - `定休日（火曜）はどの時刻も枠にならず、理由は closed になる`
  - `営業時間（10:00–19:00）の外の 9:30 は枠にならず、理由は outside_hours になる`
  - `受付を止める帯（お昼 12:00–13:00）の中の 12:00 と 12:30 は枠にならず、理由は break になる`
  - `刻み 30 分の格子に載らない 11:15 は候補として出さない`
  - `所要 60 分が閉店 19:00 までに収まらない 18:30 は枠にならない`
  - `技能を持つ担当が誰も勤務していない時刻は枠にならず、理由は staff_off になる`
  - `技能を持つ担当が全員ふさがっている時刻は枠にならず、理由は staff_busy になる`
  - `目的が要求する技能を持つ担当が 1 人も居ない日は、全時刻が枠にならず理由は no_skill になる`
  - `設備が点検中（11:30–12:00）の時刻は枠にならず、理由は maintenance になる`
  - `設備が capacity まで埋まっている時刻は枠にならず、理由は equipment_busy になる`
  - `同時受付上限に達した時刻は枠にならず、理由は max_parallel になる`
  - `8 条件をすべて満たす時刻は isAvailable が true で、remaining と staffIds と equipmentIds を持つ`
  - `担当が未定の予約も枠を消費する（target_id が NULL でも数に入る）`
  - `store_slot_rules の行が無い店舗は枠を 0 件にする（暗黙の既定値を作らない）`
  - `excludeReservationId を渡すと、その予約は塞がりに数えない`
  - `excludeReceptionSessionId と同じ受付が置いた仮の押さえは塞がりに数えない`
  - `仮の押さえは 1 件でも枠を塞ぐ（受付セッションが違えば数える）`
  - `axis=resource では設備ごとのレーンを返し、axis=staff では担当ごとのレーンを返す`
  - `関数の中で Date.now() を呼ばない（now を 1 時間進めても返る枠が変わらない）`
- **注意**: この段階では**純関数の unit テスト**である。DB にも実時刻にも触れない入力
  （営業時間・受付停止帯・勤務・技能・設備・点検・既存の押さえ・仮の押さえ・`now`）を
  すべて引数で組み立てる。`test/fixtures/availability.ts` に銀座店 1 日分の素材を置いて使い回す。
- **完了条件**: 19 本が期待どおり赤い（`availability.ts` がまだ無いのでインポートで落ちる状態にしない
  — 先にシグネチャだけの空実装を置き、**アサーションで落ちる**ことを目で見る）。
- **依存**: T-001

## T-004 空き枠の境界値を縛る（Red）

- **目的**: 片付け時間・受付停止帯・同時受付上限・JST の日跨ぎの「ちょうど」と「±1」を固定する。
- **触るファイル**: `services/glasses_management/test/availability.time.test.ts`（新規）
- **先に書くテスト**
  - 片付け > `12:00 に終わる予約があり片付け 10 分のとき、12:00 から始まる枠は置けない`
  - 片付け > `同じ条件で 12:30 から始まる枠は置ける`
  - 片付け > `片付け 0 分なら 12:00 から始まる枠は置ける`
  - 片付け > `片付けは予約の後ろにだけ付き、ends_at には含めない`
  - 受付停止帯 > `帯が 12:00–13:00 のとき 12:00 は枠にならない`
  - 受付停止帯 > `帯が 12:00–13:00 のとき 13:00 は枠になる（終わりは含めない）`
  - 受付停止帯 > `帯を 12:01–13:00 へ 1 分ずらすと 12:00 の枠が戻る`
  - 同時受付上限 > `上限 3 件の店で 2 件入っている時刻は remaining が 1 になる`
  - 同時受付上限 > `上限 3 件の店で 3 件入っている時刻は満席（remaining 0・isAvailable false）になる`
  - 同時受付上限 > `3 件のうち 1 件が担当未定でも数に入って満席になる`
  - JST > `date=2026-08-27 の窓は UTC 2026-08-26T15:00:00.000Z 以上 2026-08-27T15:00:00.000Z 未満である`
  - JST > `UTC 2026-08-27T14:59:59.999Z に始まる予約は 8月27日の計算に入る`
  - JST > `UTC 2026-08-27T15:00:00.000Z に始まる予約は 8月27日の計算に入らない`
  - JST > `月をまたぐ 2026-08-31 と 2026-09-01 が別の日として扱われる`
  - JST > `うるう年の 2028-02-29 が営業日として扱われる`
  - 勤務 > `勤務が 10:00–19:00 のとき 10:00 は枠になり、9:59 台の格子は候補にならない`
  - 勤務 > `勤務が 18:00 に終わるとき、所要 60 分の 17:30 は枠にならない`
- **注意**: `Date.now()` を 1 度も呼ばない。`now` は `new Date('2026-08-27T02:08:00.000Z')`
  （JST 11:08）のような固定値を引数で渡す。
- **実装**: まだ書かない（T-008 で書く）。**期待した理由で赤いことを目で見る。**
- **完了条件**: 17 本が期待どおり赤い。
- **依存**: T-003

## T-005 台帳の行組み立てを縛る（Red）

- **目的**: 読み出した行から 3 通りの並びを組み立てる純関数の振る舞いを、DB に触れない形で固定する。
- **触るファイル**: `services/glasses_management/test/ledger.test.ts`（新規）
- **先に書くテスト**
  - 担当者別 > `当日勤務している担当の行を並び順で並べる`
  - 担当者別 > `担当が未定の予約は「担当が未定」の擬似行に置く`
  - 担当者別 > `「担当が未定」の行は担当の行より後ろに来る`
  - 担当者別 > `「ご来店お待ち」の行を最下段に 1 行だけ置き、時間軸に載せない`
  - 担当者別 > `walk_ins がまだ無いので「ご来店お待ち」の人数は 0 になる`
  - 担当者別 > `staff_shifts の kind=break は「休憩」の LedgerBlock になる`
  - 設備別 > `設備を並び順（視力測定機 A・視力測定機 B・検査室 1・相談カウンター 1・相談カウンター 2）で並べる`
  - 設備別 > `1 予約が 2 つの設備を押さえていると、同じ reservationId の帯が 2 行に出る`
  - 設備別 > `equipment_maintenance は「点検」の LedgerBlock になる`
  - 設備別 > `予約も点検も無い設備の行は entries も blocks も空になる`
  - 共通 > `status が cancelled の予約は帯にしない`
  - 共通 > `status が no_show の予約は帯にする（その日に起きた事実だから）`
  - 共通 > `帯の purposeLabel は visit_purposes.name_short を「・」で連ねる`
  - 共通 > `source が phone と counter の帯は出どころの語を持たない`
  - 共通 > `source が web の帯は「Web予約」、walkin の帯は「ウォークイン」を持つ`
  - 共通 > `他店舗の予約は 1 件も混ざらない`
  - リスト > `時刻順に平坦化し、同じ時刻は担当の並び順で並べる`
  - リスト > `counts は all・upcoming・pendingReview の 3 つを返す`
  - リスト > `upcoming は serverNow までに始まった行を落とす`
  - リスト > `担当が未定の行は staffName を null にする`
- **実装**: まだ書かない（T-009 で書く）。**期待した理由で赤いことを目で見る。**
- **完了条件**: 20 本が期待どおり赤い。
- **依存**: T-001

## T-006 台帳 API・権限表・テナント分離を縛る（Red）

- **目的**: 3 本の新ルートについて、応答の形・default-deny・他テナントからの遮断を固定する。
- **触るファイル**
  - `services/glasses_management/test/ledger.integration.test.ts`（新規）
  - `services/glasses_management/test/permissions.test.ts`（追記）
  - `services/glasses_management/test/tenant-isolation.test.ts`（追記）
  - `services/glasses_management/test/helpers.ts`（予約・割当を直接 INSERT する道具を足す）
- **先に書くテスト**
  - `GET /api/staff/ledger` > `既定は axis=staff・view=timetable・filter=all で返る`
  - `GET /api/staff/ledger` > `応答の serverNow が注入した時刻と一致する`
  - `GET /api/staff/ledger` > `axis=resource で縦軸が設備の行に入れ替わり、日付と view は保たれる`
  - `GET /api/staff/ledger` > `view=list で同じ日が時刻順の行になる`
  - `GET /api/staff/ledger` > `定休日は isClosed が true・opensAt が null・lanes が空で返る`
  - `GET /api/staff/ledger` > `知らない axis は 400 で落ちる`
  - `GET /api/staff/ledger` > `storeId を省くと 400 で落ちる`
  - `GET /api/staff/ledger` > `1 日分を db.batch() 1 回・16 文以内で読む`
  - `GET /api/staff/reservations/:id` > `予約 1 件を ReservationDetail の形で返す`
  - `GET /api/staff/reservations/:id` > `場所を 2 つ押さえた予約は assignments を 2 行返す`
  - `GET /api/staff/reservations/:id` > `無い id は 404 で落ちる`
  - `GET /api/staff/availability` > `8 条件を掛けた枠と serverNow を返す`
  - `GET /api/staff/availability` > `定休日は 409 ではなく 200 で slots が空・reason が closed になる`
  - `GET /api/staff/availability` > `目的が無効なら 200 で slots が空・reason が purpose_unavailable になる`
  - 権限表（`permissions.test.ts`）> 主体 5 種（未認証 / staff / admin / 期限切れ / 別 secret 署名）×
    経路 3 本（`/api/staff/ledger` / `/api/staff/availability` / `/api/staff/reservations/:id`）の
    **15 行**を既存の表に足す。期限切れは 401、権限不足は 403 で取り違えない。
  - テナント分離（`tenant-isolation.test.ts`）> `別テナントの予約は台帳の帯に 1 件も混ざらない`
  - テナント分離 > `別テナントの予約は空き枠の塞がりに数えない`
  - テナント分離 > `別テナントの storeId をクエリに渡しても、自分の組織の中でしか引かない`
  - テナント分離 > `別テナントの予約 id は 404 を返す（403 で存在を漏らさない）`
  - テナント分離 > `3 テナントが同じ日に予約を持っても、各自の台帳しか見えない`
- **注意**: D1 はテストファイル内で共有される。組織 id・店舗 id・予約 id は毎回 `crypto.randomUUID()`
  で作る。予約は API では作れない（`POST /api/staff/reservations` は P3）ので、`env.DB` へ直接 INSERT する。
- **実装**: まだ書かない（T-010 で書く）。**期待した理由で赤いことを目で見る。**
- **完了条件**: 19 本 + 権限表 15 行が期待どおり赤い。
- **依存**: T-002

## T-007 枠の一次排他を実 D1 で縛る（Red）

- **目的**: 上限つきの条件付き INSERT が本当に上限で止まることを、実 D1 に対して固定する。
  書く側は P3 だが、上限の数え方は空き枠エンジンと同じなのでここで決着させる。
- **触るファイル**: `services/glasses_management/test/slot-locks.integration.test.ts`（新規）
- **先に書くテスト**（`vitest-pool-workers` の実 D1）
  - `上限 1 のレーンは 1 本目が入り、2 本目は meta.changes が 0 になる`
  - `上限 3 のレーンは 3 本目まで入り、4 本目で meta.changes が 0 になる`
  - `target_key=unassigned のレーンは store_slot_rules.max_parallel（3）まで取れる`
  - `equipment.capacity=2 の設備は同じ枠で 2 件まで取れる`
  - `staff.max_parallel_reservations=1 の担当は同じ枠で 1 件しか取れない`
  - `(organization_id, store_id, kind, target_key, slot_start) に一意制約が張られていない`
  - `自分の予約 id の行は上限の数に入れない（reservation_id <> ?4 が効く）`
  - `別テナントの行は上限の数に入れない`
  - `予約 id で一括 DELETE すると、その予約の行だけが消える`
- **実装の材料**: SQL の実物は `design/03-data-model.md` §7.6。発火の有無は `meta.changes` の 1 / 0 で読む。
- **完了条件**: 9 本が期待どおり赤い。
- **依存**: T-002

## T-008 空き枠エンジンを実装する（Green）

- **目的**: T-003 と T-004 を緑にする。
- **触るファイル**: `services/glasses_management/src/worker/domain/availability.ts`（新規）
- **先に書くテスト**: T-003 の 19 本と T-004 の 17 本。ここでは足さない。
- **実装**
  - **純関数**にする。`now: Date` を含め、営業時間・受付停止帯・勤務・技能・設備・点検・
    既存の押さえ・仮の押さえを**すべて引数で受け取る**。DB にも実時刻にも触れない。
  - 8 条件をこの順で適用する: ①営業日か（`store_calendar_exceptions` → `store_business_hours`）
    ②営業時間内か（`store_blackout_windows` を差し引く）③刻み `slot_minutes`（30）と片付け
    `cleanup_minutes`（10）④所要時間が収まるか ⑤技能を持つ担当が勤務中かつ空いているか
    （上限は `staff.max_parallel_reservations`）⑥設備が点検中でなく空いているか
    （上限は `equipment.capacity`）⑦同時受付上限（`store_slot_rules.max_parallel`＝3）
    ⑧Web 予約のときだけ公開条件（**P2 では ⑧ を掛けない**。公開面は P8）。
  - **落ちた条件を `AvailabilityReason` で必ず添える**（11 値）。最初に落ちた条件を返す。
  - 占有の数え方は `reservation_slot_locks` の**枠ごとの行数**に揃える。確定時の上限判定と
    数え方を 1 つにするため、`reservation_assignments` から枠へ展開する関数をここに置いて共有する。
  - JST の暦日 → UTC の窓は `packages/shared` の JST ヘルパを使う（自前で +9 時間しない）。
  - `store_slot_rules` の行が無い店舗は枠を 0 件にする。暗黙の既定値を作らない。
- **未決事項**: `design/09-open-questions.md` **Q-11**（1 件のご予約に複数名がありうるか）。
  **いまの前提**: `purpose_requirements` の必要数は固定（技能 1 ＋ 設備 0〜2）。人数に比例させない。
  答えが来たら条件 ⑤ ⑥ の必要数の式だけを直す。
- **完了条件**: `availability.test.ts` 19 本と `availability.time.test.ts` 17 本が緑。
- **依存**: T-003, T-004

## T-009 台帳の行組み立てを実装する（Green）

- **目的**: T-005 を緑にする。
- **触るファイル**: `services/glasses_management/src/worker/domain/ledger.ts`（新規）
- **先に書くテスト**: T-005 の `ledger.test.ts` 20 本。ここでは足さない。
- **実装**
  - **純関数**。読み出した行（予約・目的・割当・担当・勤務・設備・点検・目的マスタ）と
    `serverNow` を引数で受け取り、`LedgerView` を組み立てて返す。
  - `axis='staff'` の行順: 当日 `staff_shifts` に `kind='work'` を持つ担当を並び順 →
    「担当が未定」の擬似行（`kind='unassigned'` / `id=null`）→ 「ご来店お待ち」（`kind='walkin'`）。
  - `axis='resource'` の行順: `equipment` の並び順。**1 予約が複数の設備を押さえていたら、
    同じ `reservationId` の `LedgerEntry` を各行に複製する**（片方を押すともう片方にも印が付くのは画面側）。
  - 「ご来店お待ち」は時間軸に載せず、行の帯として持つ。人数は当日（JST）の
    `walk_ins.status='waiting'` の件数。`walk_ins` を作るまで **0** を返す。
  - `LedgerBlock` は 2 種類。`break` は `staff_shifts.kind='break'`（担当ひとりの休憩。担当の行だけ）、
    `maintenance` は `equipment_maintenance`（設備の行だけ）。
    **`store_blackout_windows` は台帳の帯にしない**（空き枠エンジンだけが読む）。
  - 帯の `purposeLabel` は `visit_purposes.name_short` を「・」で連ねる。
    `status IN ('cancelled')` は帯にせず、`no_show` は帯にする。
  - `view='list'` は `lanes` を時刻順に平坦化する。`counts.upcoming` は `serverNow` より後に始まる件数、
    `counts.pendingReview` は Web 由来の承認待ちの件数（P8 まで `web_bookings` が無いので、
    `source='web'` かつ `status='confirmed'` で担当が未定の件数を数える器として作る）。
- **完了条件**: `ledger.test.ts` 20 本が緑。
- **依存**: T-005

## T-010 3 本のルートをチェーンに足す（Green）

- **目的**: T-006 と T-007 を緑にする。
- **触るファイル**
  - `services/glasses_management/src/worker/index.ts`（チェーンに追記）
  - `services/glasses_management/src/worker/db/queries/ledger.ts`（新規。1 日分の読み出し）
  - `services/glasses_management/src/worker/db/slot-locks.ts`（新規。上限つき条件付き INSERT の SQL）
  - `services/glasses_management/src/web/client.ts`（台帳・空き枠・予約 1 件の取得を足す）
- **先に書くテスト**: T-006 の 19 本＋権限表 15 行と、T-007 の 9 本。ここでは足さない。
- **実装**
  - チェーンに `GET /api/staff/availability` → `GET /api/staff/ledger` →
    `GET /api/staff/reservations/:reservationId` を足す。`export type AppType = typeof routes` を保つ。
  - 入力は `zValidator('query', LedgerQuery)` / `zValidator('query', AvailabilityQuery)`。
    出力は必ず `LedgerView.parse` / `AvailabilityResponse.parse` / `ReservationDetail.parse` に通す。
  - **全クエリを JWT の `org` と `storeId` で絞る**。body / query 由来の organizationId を認可根拠にしない。
  - 台帳の読み出しは **`db.batch()` 1 回・16 文以内**（`design/04-api.md` §3.6）。
    `drizzle(c.env.DB)` はハンドラ内で毎回生成する。
  - `serverNow` はハンドラの入口で 1 回だけ `new Date()` を作り、ドメイン層へ引数で渡す。
    **ドメイン層で `Date.now()` を呼ばない。**
  - 無い予約・他テナントの予約は 404 `not_found`（403 で存在を漏らさない）。
  - 空き枠の `store_closed` / `purpose_unavailable` は **200 の本文で `slots: []` + `reason`** を返す。
    409 にしない。
- **完了条件**: `pnpm --filter @app/glasses_management test` が緑。カバレッジ 4 指標 80% 以上。
- **依存**: T-006, T-007, T-008, T-009

## T-011 世界観データを seed に入れる

- **目的**: 台帳が実際に 12 件を描くところまで持っていく。P2 には予約を作る操作が無いので、
  seed 無しでは AC-LEDGER-01〜22 が 1 本も緑にならない。
- **触るファイル**
  - `services/glasses_management/seed/reservations.mjs`（新規）
  - `services/glasses_management/seed.mjs`（`seed/` の各モジュールを読む形に分ける）
- **先に書くテスト**: seed はテスト対象ではない。**検証は T-020 の E2E が行う**
  （台帳に 12 件が出て、絞り込みの件数が「すべて 12件／これから 7件／確認待ち 1件」になる）。
- **実装**: 2026年8月27日（木）の銀座店に予約 12 件を入れる。**モック同士が食い違う値は
  LEDGER-STAFF を正本にする**（spec T-022）。`customer_id` は全件 NULL、お名前は入れない。

  | # | 開始 | 分 | ご用件（`name_short`） | 担当 | `source` | `status` | 設備 |
  |---|---|---|---|---|---|---|---|
  | 1 | 10:00 | 30 | 調整 | 高橋 健 | `phone` | `arrived` | — |
  | 2 | 10:30 | 60 | 視力測定 | 中村 彩 | `web` | `arrived` | 視力測定機 B |
  | 3 | 11:00 | 60 | 新調相談・視力測定 | 佐藤 美咲 | `phone` | `confirmed` | 視力測定機 A ／ 相談カウンター 2 |
  | 4 | 11:00 | 30 | 視力測定 | 渡辺 由紀 | `walkin` | `arrived` | — |
  | 5 | 11:02 | 60 | 新調相談 | **未定** | `walkin` | `confirmed` | — |
  | 6 | 13:00 | 20 | 調整 | **未定** | `web` | `confirmed` | 相談カウンター 1 |
  | 7 | 13:00 | 60 | 調整 | 高橋 健 | `phone` | `confirmed` | — |
  | 8 | 14:00 | 20 | 受け取り | 佐藤 美咲 | `phone` | `confirmed` | 相談カウンター 1 |
  | 9 | 15:00 | 60 | 新調相談 | 中村 彩 | `counter` | `confirmed` | — |
  | 10 | 15:30 | 60 | 視力測定 | **未定** | `phone` | `confirmed` | 視力測定機 A（15:30–16:00）／ 相談カウンター 2（16:00–16:30） |
  | 11 | 17:00 | 30 | 調整 | 佐藤 美咲 | `phone` | `confirmed` | — |
  | 12 | 17:30 | 30 | 受け取り | 佐藤 美咲 | `phone` | `confirmed` | — |

  - 11 と 12 は**表示窓 10:00–16:30 の外**に置く。AC-LEDGER-02 の横スクロールの証拠になり、
    「すべて 12件／これから 7件」（11:08 以降に始まる 7 件＝#6〜#12）を計算の結果として成立させる。
  - 「確認待ち 1件」は #6（`source='web'` で担当が未定）1 件だけになるように置く。
  - 予約番号は `EY-2608-0001` から連番で振る。`version` は 1。`created_by` は NULL。
  - 各予約に `reservation_purposes` を 1 行以上、`reservation_assignments` を
    `kind='staff'` 1 行（未定は `target_id=NULL`）＋設備の行だけ作る。**担当欄は「未定」か担当名の
    2 通りだけで、`kind='staff'` の行を作らない予約は 1 件も置かない**（I-05）。
  - `reservation_slot_locks` も同じ内容で展開して入れる（空き枠エンジンがこの表を数えるため）。
  - 佐藤 美咲の本日の担当は **#3 / #8 / #11 / #12 の 4 件**になる。
    **AC-LEDGER-21 の「本日わたしが担当するご予約　4件」はこの 4 件で成立する**（spec が正）。
    #11 と #12 は表示窓 10:00–16:30 の外に置いてあるので、LEDGER-STAFF の見た目は変わらない
    （HOME-PERSONAL のモックは 13:00 佐々木 亮 様 と 15:30 山口 真央 様 を佐藤 美咲 に置いているが、
    LEDGER-STAFF はそれぞれ 高橋 健 と 中村 彩 に置いている。**LEDGER-STAFF を正本にする**ので
    4 行の時刻は 11:00 / 14:00 / 17:00 / 17:30 になる）。モック画像は直さない。T-021 のコメントに残す。
  - 「担当が未定」の行に載るのは #5 / #6 / #10 の **3 件**になる。
  - `INSERT OR IGNORE` で何度実行しても同じ結果にする（既存の `seed.mjs` と同じ流儀）。
- **完了条件**: `pnpm --filter @app/glasses_management db:migrate:local && db:seed:local` が通り、
  `wrangler d1 execute` で `SELECT COUNT(*) FROM reservations` が 12 を返す。
- **依存**: T-002

## T-012 台帳の見た目を決める（DESIGN_RULE パス 1）

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 受付スタッフが電話を取りながら「いまお店がどこまで埋まっているか」を一目で読む面。
  - トークン計画: 時間の目盛りは**背景に 1 枚**（30分線 `--color-grid`・1時間線 `--color-grid-hour`）。
    帯は出どころ 3 系統（`--color-pine` / `--color-web` / `--color-walkin`）＋担当未定の `--color-danger`
    で、**色には必ず文字を添える**。埋まった枠は地 `--color-busy-soft`・文字 `--color-ink-muted`。
    角は 8/12/16px の 3 段、書体は 1 書体でウェイトだけ。
  - シグネチャ: **白い箱を並べず、罫線と背景の目盛りだけで格子を作ること。**
- **目的**: 実装に入る前に、モックの実測値と足りないトークンを 1 か所に確定させる。
- **先に書くテスト**: なし（定数と 1 トークンだけを置く。これを読む画面のテストは T-013 / T-014 が書く）。
- **触るファイル**
  - `packages/ui/src/theme.css`（`--color-busy-soft: #e4e9e6` を新設）
  - `services/glasses_management/src/web/ledger/metrics.ts`（新規。表示窓と寸法の定数）
- **見るべきモックと実測値**（`docs/frontend/mockups/eye/images/` を Read で実際に見る）

  | 画面ID | 読むもの | 実測値 |
  |---|---|---|
  | LEDGER-STAFF | 台帳の骨格 | 名前列 **170px** 固定 ＋ 時間 **14 列 1fr**。行は `34px / 1fr ×4 / 88px`。列見出し `min-height 34px`・`padding 0 8px`・地 `--color-surface-2`。名前セル `min-height 64px`・`padding 6px 10px`・補足 11px。セル `padding 4px`・下罫 1px `--color-grid` |
  | LEDGER-STAFF | 予約の帯 | `min-height 54px`・角 8px・`padding 6px 8px`・地 `--color-pine-soft`・左に 4px の `--color-pine`・本文 13px/1.35・お名前行 14px |
  | LEDGER-STAFF | 現在時刻 | 線は幅 **2px** の `--color-danger`、左位置 `170px + (100% − 170px) × 0.1619`（11:08 ＝ 10:00 から 68 分 ÷ 420 分）。札は `min-height 32px`・`padding 0 12px`・ピル・`--color-danger` の枠と文字 |
  | LEDGER-STAFF | ご来店お待ち | 最下段 **88px**。行見出しの地は `--color-walkin-soft`、帯は 14 列すべてにまたがる |
  | LEDGER-RESOURCE | 設備の行 | 空き行は `--color-free` の地に 1px 破線 `--color-pine-line`、文字は `--color-pine-deep` 600。点検の帯は `--color-busy` の地 |
  | LEDGER-LIST | 絞り込みの札 | 帯の高さ **60px**・`padding 0 32px`・地 `--color-surface-2`。札は `min-height 44px`・`padding 0 16px`・ピル。選択中は 2px の `--color-pine` ＋ 地 `--color-pine-soft` |
  | LEDGER-LIST | 行 | 列幅 `120px / 96px / 224px / 1fr / 140px`・`gap 16px`。行 `min-height 62px`・下罫 1px。時刻は 18px 等幅 700、お名前 17px 700、ほか 15px。操作ボタンは `min-height 46px`・角 8px |
  | LEDGER-DETAIL | ポップオーバー | 幅 **440px**・角 16px・枠 1px `--color-line-strong`・影 `0 12px 32px`。矢印 16px を左 40px に置く。頭 `padding 14px 16px`、胴 `12px 16px`、足 `12px 16px` で地は `--color-surface-2`。主操作は幅いっぱい・`min-height 52px`・17px |
  | EX-OFFLINE | 通信断の帯 | `padding 20px 32px`・地 `--color-danger-soft`・下に 2px の `--color-danger`。見出し 21px、本文 16px/1.6。「再接続を試す」は `min-height 52px` |
  | 共通 | 触れる大きさ | 44pt 以上（`design/07-nfr.md` §2.1） |

- **実装**
  - `--color-busy-soft: #e4e9e6` を `theme.css` に足す。**理由をコメントに残す**
    （`--color-busy` の上では `--color-ink-muted` が 4.5:1 に届かない。文字を濃くすると埋まった枠が
    空き枠より目立つので、地を明るくする側で解く。`design/07-nfr.md` §2.5 の決定 9）。
  - `metrics.ts` に `WINDOW_START = '10:00'` / `WINDOW_SLOTS = 14` / `SLOT_MINUTES = 30` /
    `LABEL_WIDTH_PX = 170` / `HEAD_HEIGHT_PX = 34` / `WALKIN_ROW_PX = 88` を置く。
    **画面はここだけを読む。任意値（`p-[13px]`・`text-[#hex]`）と Tailwind 既定パレットを書かない。**
- **未決事項**: `design/09-open-questions.md` **Q-05**（業務用 iPad にどう入れるか）。
  **いまの前提**: ①ホーム画面に追加した Web アプリ。有効高は **810px**（1194×834 − ステータスバー 24）。
  表示窓 14 列はこの幅と高さを前提にする。答えが①以外なら列数を測り直す。
- **完了条件**: `pnpm --filter @app/ui test` が緑。`metrics.ts` の定数が上の実測値と一致する。
- **依存**: なし

## T-013 タイムテーブルの web テストを書く（Red）

- **目的**: 「何が読めて、何が押せて、キーボードでどう動くか」を先に決める。
- **触るファイル**
  - `services/glasses_management/src/web/ledger/Timetable.test.tsx`（新規）
  - `services/glasses_management/src/web/ledger/NowLine.test.tsx`（新規）
  - `services/glasses_management/src/web/ledger/LedgerPage.test.tsx`（新規。日付の移動）
  - `services/glasses_management/src/web/ledger/fixtures.ts`（新規。`LedgerView` の作り置き）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test:web`）
  - 目盛り > `10:00 から 16:30 までの 30分刻みで 14 列ある`
  - 目盛り > `営業時間が表示窓より長い日は、台帳の中だけが横スクロールになる`
  - 格子 > `台帳は role=grid で、行見出しに担当名・列見出しに時刻を持つ`
  - 格子 > `2 列にまたがる帯は先頭のセルにだけ置き、aria-colspan で幅を伝える`
  - 格子 > `同じ帯が 2 度読まれない`
  - 格子 > `空のセルは「10:30　佐藤 美咲　空いています」と読める`
  - 格子 > `矢印キーで隣の枠へ移れる`
  - 格子 > `Tab 1 回で台帳を通り抜ける（14 列ぶんの移動を要さない）`
  - 帯 > `帯は「11:00から12:00　新調相談・視力測定　佐藤 美咲」のひと続きの名前で読める`
  - 帯 > `60分の帯にはご用件の短い名前が出る`
  - 帯 > `30分の帯にはご用件を入れない`
  - 帯 > `Web予約の帯には「Web予約」の文字が出る`
  - 帯 > `ウォークインの帯には「ウォークイン」の文字が出る`
  - 帯 > `お電話と店頭の帯には出どころの語を出さない`
  - 帯 > `担当が未定の帯には「担当が未定」と文字で書く`
  - 行 > `「担当が未定」の行は担当の行の下にある`
  - 行 > `「ご来店お待ち」の行は最下段にあり、行見出しに待ち人数が出る`
  - 行 > `「ご来店お待ち」の行は 1 つのセルで、aria-colspan が列数と同じ`
  - 行 > `walk_ins がまだ無いので待ち人数は 0名 と出る`
  - 設備別 > `並べ方を「設備・場所」にすると縦軸が設備の行に入れ替わる`
  - 設備別 > `同じ予約の帯が 2 行に出て、片方を押すともう片方にも同じ印が付く`
  - 設備別 > `点検の時間帯は「点検」の帯で埋まる`
  - 設備別 > `予約の無い設備の行には「いま空いています」と出る`
  - 定休日 > `目盛りだけの空の格子を出さず「9月1日（火）は定休日です。」と「本日」を出す`
  - 現在時刻 > `serverNow が 11:08 のとき、線は時間軸の左から 16.19% の位置に引かれる`
  - 現在時刻 > `表示中の日付が本日でないときは線も札も出さない`
  - 現在時刻 > `現在時刻が表示窓より前のときは線を引かず、札に「現在 9:42（営業時間の外）」を出す`
  - 現在時刻 > `現在時刻が表示窓より後のときも同じ型で札だけを出す`
  - 現在時刻 > `端末の時計を 1 時間進めても線の位置と札の時刻は動かない`
  - 現在時刻 > `線は aria-hidden で、時刻は role=status の札が持つ`
  - 日付の移動（`LedgerPage.test.tsx`。**AC-LEDGER-04 / UC-LEDGER-05**）
    - `上のバーに「2026年8月27日（木）」が出て、左右に ‹ と › と「本日」が並ぶ`
    - `› を押すと日付が「2026年8月28日（金）」になり、並べ方「担当者」と表示のかたち「タイムテーブル」が保たれる`
    - `本日でない日を出している間は現在時刻の線と「現在 11:08」の札を出さない`
    - `「本日」を押すと 2026年8月27日（木）へ戻り、線と札が戻る`
    - `‹ と › と「本日」は押せる大きさが 44pt 以上ある`
- **実装**: まだ書かない（T-015 / T-016 で書く）。**期待した理由で赤いことを目で見る。**
- **完了条件**: 35 本が期待どおり赤い。
- **依存**: T-012

## T-014 予約リスト・詳細・通信断の web テストを書く（Red）

- **目的**: 読む面（リスト）と、その場で開く面（詳細）と、書けない面（通信断）の振る舞いを先に決める。
- **触るファイル**
  - `services/glasses_management/src/web/ledger/LedgerList.test.tsx`（新規）
  - `services/glasses_management/src/web/ledger/ReservationPopover.test.tsx`（新規）
  - `services/glasses_management/src/web/ledger/OfflineBand.test.tsx`（新規）
  - `services/glasses_management/src/web/home/MyReservations.test.tsx`（新規）
- **先に書くテスト**
  - リスト > `列見出しは「受け付け」「時間」「お客様」「ご用件」「担当」の 5 つ`
  - リスト > `絞り込みの札は「すべて」「これから」「確認待ち」で、件数が添えられている`
  - リスト > `「これから」を押すと、現在時刻までに始まった行が消えて件数と一致する`
  - リスト > `「受け付け」の欄には お電話 / 店頭 / Web予約 / ウォークイン の 4 語がそのまま出る`
  - リスト > `担当が未定の行は担当の欄が「決めてください」になる`
  - リスト > `当てはまる行が 0 件の絞り込みは、見出し 1 行と理由 1 行と「すべてを見る」を出す`
  - リスト > `表示のかたちを切り替えても日付と並べ方は保たれる`
  - 詳細 > `見出しに「11:00–12:00」と「60分」が並ぶ`
  - 詳細 > `ご用件・担当・場所・ご要望・注意ごとの 5 行が並ぶ`
  - 詳細 > `場所が 2 つあるときは「視力測定機 A ／ 相談カウンター 2」と連ねる`
  - 詳細 > `出どころの札は「お電話」と出る（「電話予約」にしない）`
  - 詳細 > `下段の操作は「ご来店を受け付ける」「変更する」「取り消す」の 3 つだけ`
  - 詳細 > `受付が済んだ予約では「ご来店を受け付ける」を出さず「受付済み 11:02」を出す`
  - 詳細 > `押した帯の左端に矢印が付く`
  - 詳細 > `台帳の空いているところを 1 回押すと閉じ、その 1 回は新しい予約を起こさない`
  - 詳細 > `開いた帯をもう一度押すと閉じる`
  - 詳細 > `Esc を押すと閉じる`
  - 詳細 > `閉じるとフォーカスが元の帯へ戻る`
  - 詳細 > `開いても閉じても日付・並べ方・表示のかたち・スクロールの位置は変わらない`
  - 通信断 > `帯に「通信が切れています」と、いつ時点かの時刻と「再接続を試す」が並ぶ`
  - 通信断 > `帯は role=status で、読み上げに割り込まない`
  - 通信断 > `帯が出ている間は書き込みの操作を押せない`
  - 通信断 > `台帳は時間順のリストとして読める状態を保つ`
  - 通信断 > `「受け付け」の列ごと出さない`
  - 個人トップ > `見出しは「本日わたしが担当するご予約」で、件数が行数と一致する`
  - 個人トップ > `時刻・ご用件・状態が時間順に並ぶ`
  - 個人トップ > `1 行を押すと台帳のその帯の詳細が開く`
  - 個人トップ > `0 件の日は「本日ご担当のご予約はありません。」と「店全体の台帳を見る」を出す`
- **実装**: まだ書かない（T-017 / T-018 / T-019 で書く）。**期待した理由で赤いことを目で見る。**
- **完了条件**: 28 本が期待どおり赤い。
- **依存**: T-012

## T-015 タイムテーブルと現在時刻の線を実装する（Green）

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 縦が担当・横が時間の 1 枚。主役は台帳そのもので、ほかに主役を作らない。
  - トークン計画: 目盛りは背景 1 枚（`--color-grid` / `--color-grid-hour`）。帯は左 4px の色 ＋ 文字。
    現在時刻は `--color-danger` の線 2px と同色のピル。地は `--color-surface`、見出し行は `--color-surface-2`。
  - シグネチャ: **帯が乗っても目盛りが途切れないこと**（セルの `border` で線を引かない）。
- **目的**: T-013 の 35 本を緑にする。
- **見るべきモック**: `docs/frontend/mockups/eye/images/LEDGER-STAFF.png`。実測値は T-012 の表。
- **触るファイル**
  - `services/glasses_management/src/web/ledger/LedgerPage.tsx`（新規）
  - `services/glasses_management/src/web/ledger/TimeGrid.tsx`（新規。背景の目盛り 1 枚）
  - `services/glasses_management/src/web/ledger/Timetable.tsx`（新規）
  - `services/glasses_management/src/web/ledger/NowLine.tsx`（新規）
  - `services/glasses_management/src/web/App.tsx`（`ledger` の行き先に差し込む）
- **先に書くテスト**: T-013 の 35 本。ここでは足さない。
- **実装**
  - 格子は `role="grid"` ＋ roving tabindex。行見出しに担当名、列見出しに時刻。
    2 列以上にまたがる帯は**先頭のセルにだけ置き** `aria-colspan` で幅を伝える。
    「ご来店お待ち」の行は `aria-colspan` を列数いっぱいに取った 1 セルにする。
  - 目盛りは `TimeGrid` が `repeating-linear-gradient` の背景 1 枚として敷く。
    **セルに縦罫を引かない**（帯が乗ると途切れる）。
  - 現在時刻の線の位置は `(serverNow − 表示開始) ÷ 表示幅の分数`。`serverNow` は応答の値だけを使い、
    `Date.now()` を読まない。線は `aria-hidden="true"`、時刻は `role="status"` の札が文字で持つ。
    表示中の日付が本日でないときは線も札も出さない。窓の外のときは線を出さず札だけを出す。
  - 埋まった枠の帯は地 `--color-busy-soft`・文字 `--color-ink-muted`。
  - 定休日・臨時休業・受付停止の日は空の格子を出さず、事実 1 行と「本日」だけを出す。
  - 読み込み中 / 空 / エラー / 375px / 200%文字拡大 / VoiceOver は `docs/frontend/DESIGN_RULE.md` の
    品質フロアで補う（モックに無いから作らない、は誤り）。
  - 上のバーの日付は `LedgerPage` が持つ（`‹` / `2026年8月27日（木）` / `›` / `本日` の 4 つ。**44pt 以上**）。
    日付を動かしても `axis` と `view` は保つ。`date` が本日でないときは `NowLine` を描かない。
    日付は JST の暦日で ±1 日し、端末の時計を読まない（本日の判定は応答の `serverNow`）。
  - **空いた場所を埋めるために要素を足さない。** 色・寸法は `theme.css` のトークン経由のみ。
- **完了条件**: `Timetable.test.tsx` / `NowLine.test.tsx` / `LedgerPage.test.tsx` の 35 本が緑。
  web カバレッジ 4 指標 60% 以上。
- **依存**: T-010, T-013

## T-016 設備・場所別の並べ替えを実装する（Green）

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 測定機と相談カウンターの取り合いに気づくための同じ 1 枚。並べ方だけが変わる。
  - トークン計画: タイムテーブルと同じ。点検は `--color-busy` の地 ＋ `--color-busy-soft` の帯、
    空き設備は `--color-free` の地に破線 `--color-pine-line`。
  - シグネチャ: **同じ予約が 2 行に同時に現れ、片方を押すともう片方にも同じ印が付くこと。**
- **目的**: AC-LEDGER-09 / 10 / 11 を満たす。
- **見るべきモック**: `docs/frontend/mockups/eye/images/LEDGER-RESOURCE.png`。
  縦軸は「視力測定機 A」「視力測定機 B」「検査室 1」「相談カウンター 1」「相談カウンター 2」の 5 行。
  空き行の帯は破線 1px、点検の帯は 1 列分（11:30–12:00）。
- **先に書くテスト**: T-013 で書いた `Timetable.test.tsx` の設備別 4 本。ここでは足さない。
- **触るファイル**
  - `services/glasses_management/src/web/ledger/Timetable.tsx`（軸の切り替えを足す）
  - `services/glasses_management/src/web/ledger/LedgerPage.tsx`（セグメント「台帳の並べ方」）
- **実装**
  - セグメントは 2 つ（`aria-label="台帳の並べ方"` と `aria-label="表示のかたち"`）。**1 つにまとめない。**
  - 軸を切り替えても日付と表示のかたちは保つ。URL のクエリは `axis=resource`（`equipment` にしない）。
  - 同じ `reservationId` の帯を押したら、両方の行の帯に同じ選択の印を付ける（`aria-selected`）。
  - 予約も点検も無い設備の行には「いま空いています」を 1 つだけ出す。
- **完了条件**: `Timetable.test.tsx` の設備別 4 本が緑。
- **依存**: T-015

## T-017 予約リストと絞り込みを実装する（Green）

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 同じ日を時間順に読み、次に何をすべきかを左端の 1 ボタンで進める面。
  - トークン計画: 白い箱を並べず**罫線だけ**で区切る。左端のボタンだけが色を持つ
    （`--color-pine` / `--color-walkin` / `--color-web`）。地は `--color-surface`。
  - シグネチャ: **左端の 1 列だけが押せて、ほかは読むだけであること。**
- **目的**: AC-LEDGER-12 / 13 / 14 を満たす。
- **見るべきモック**: `docs/frontend/mockups/eye/images/LEDGER-LIST.png`。
  絞り込みの帯 60px、列幅 `120px / 96px / 224px / 1fr / 140px`、行 `min-height 62px`、
  操作ボタン `min-height 46px`。末尾に「このあと 14:00 …」の 1 行。
- **先に書くテスト**: T-014 で書いた `LedgerList.test.tsx` のリスト 7 本。ここでは足さない。
- **触るファイル**
  - `services/glasses_management/src/web/ledger/LedgerList.tsx`（新規）
  - `services/glasses_management/src/web/ledger/LedgerPage.tsx`（表示のかたちの切り替え）
- **実装**
  - 列見出しは「受け付け」「時間」「お客様」「ご用件」「担当」。
    「受け付け」の欄は出どころの 4 語をそのまま出す。担当が未定の行は「決めてください」。
  - 絞り込みの札は「すべて」「これから」「確認待ち」に件数を添える。件数は応答の `counts` を出す
    （画面で数え直さない）。
  - 0 件になる絞り込みは HISTORY-EMPTY と同じ型で出す:
    見出し 1 行「『確認待ち』のご予約はありません。」＋ なぜ 0 件かの 1 行 ＋「すべてを見る」1 つ。
    **表を空のまま残さない。**
  - 左端のボタンは押せる形で置くだけにする（押した先は `008` / `009` が作る）。
  - **一覧の行は 8 つまで**、超えたぶんは末尾の 1 行にまとめる（引き算の決め）。
- **完了条件**: `LedgerList.test.tsx` 7 本が緑。
- **依存**: T-015

## T-018 台帳を隠さず開く詳細を実装する（Green）

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 台帳の位置を見失わないまま、1 件の中身と次の操作だけを見る面。
  - トークン計画: 幅 440px の白い面 1 枚。地 `--color-surface`、足だけ `--color-surface-2`。
    主操作は `--color-pine`、取り消しは `--color-danger` の枠だけ。注意ごとは `--color-danger` の文字。
  - シグネチャ: **押した帯へ矢印が刺さり、台帳がその後ろに見えたままであること。**
- **目的**: AC-LEDGER-04 / 15 / 19 を満たす。
- **見るべきモック**: `docs/frontend/mockups/eye/images/LEDGER-DETAIL.png`。
  幅 440px、角 16px、矢印 16px を左 40px、頭 `14px 16px` / 胴 `12px 16px` / 足 `12px 16px`、
  主操作は幅いっぱい `min-height 52px` 17px、その下に「変更する」「取り消す」を 10px 空けて 2 つ。
- **触るファイル**
  - `services/glasses_management/src/web/ledger/ReservationPopover.tsx`（新規）
  - `services/glasses_management/src/web/ledger/Timetable.tsx`（帯を押したら開く）
- **実装**
  - 台帳を隠さない（モーダルにしない）。押した帯の左端に矢印を合わせる。
  - 閉じる道は 3 本 — 台帳の空いているところを 1 回押す・開いた帯をもう一度押す・Esc。
    **閉じるためのその 1 回は新しい予約を起こさない**（空きセルの押下を閉じる操作として消費する）。
  - 閉じたらフォーカスを元の帯へ戻す。日付・並べ方・表示のかたち・スクロールの位置は変えない。
  - 下段は 3 つだけ。`status` が `arrived` 以降なら「ご来店を受け付ける」を出さず「受付済み 11:02」を出す。
    「録音を聞く」「変更する」「取り消す」「ご来店を受け付ける」は**置くだけ**で、押した先は作らない
    （`006` / `008` / `009` / `010` の範囲）。
  - 出どころの札は「お電話」に揃える（モックの「電話予約」は直さず、実装だけ揃える）。
- **先に書くテスト**: T-014 で書いた `ReservationPopover.test.tsx` の詳細 12 本。ここでは足さない。
- **完了条件**: `ReservationPopover.test.tsx` 12 本が緑。
- **依存**: T-015

## T-019 通信断の帯と個人端末のトップを実装する（Green）

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 書けないことを伝えたうえで、読むことだけは続けられる状態。
  - トークン計画: 帯は `--color-danger-soft` の地に下 2px の `--color-danger`。見出しだけ
    `--color-danger`、本文は `--color-ink`。個人トップの一覧は罫線だけで区切る。
  - シグネチャ: **帯が出ても台帳が消えず、押せないものが押せない形で残ること。**
- **目的**: AC-LEDGER-18 / 21 を満たす。
- **見るべきモック**
  - `docs/frontend/mockups/eye/images/EX-OFFLINE.png` — 帯 `padding 20px 32px`、見出し 21px、
    本文 16px/1.6、「再接続を試す」`min-height 52px`、その下に自動再試行の時刻 1 行。
    表は「受け付け」の列を落とした 4 列（`112px / 250px / 1fr / 140px`）。
  - `docs/frontend/mockups/eye/images/HOME-PERSONAL.png` — 右の一覧は見出し 1 行 ＋
    時刻（等幅）・お名前・状態の札・ご用件の 2 行組みで、行の間は 1px の罫線。
- **先に書くテスト**: T-014 で書いた `OfflineBand.test.tsx` 5 本と `MyReservations.test.tsx` 4 本。ここでは足さない。
- **触るファイル**
  - `services/glasses_management/src/web/ledger/OfflineBand.tsx`（新規）
  - `services/glasses_management/src/web/home/MyReservations.tsx`（新規）
  - `services/glasses_management/src/web/App.tsx`（トップの右に差し込む）
- **実装**
  - 帯は `role="status"`（`aria-live="polite"`）にする。**`role="alert"` にしない**
    （接客中の読み上げを断ち切る）。
  - 帯が出ている間、書き込みの操作は `disabled` にし、「受け付け」の列ごと出さない。
    台帳は時間順のリストとして読める状態を保つ。
  - 「いまご覧の内容は 11:02 現在 のものです。」の時刻は**最後に成功した応答の `serverNow`**。
  - 個人トップの件数は seed の計算結果に従う（T-011 のとおり佐藤 美咲は **4 件**＝
    11:00 / 14:00 / 17:00 / 17:30）。0 件の日は事実 1 行 ＋ なぜ空かの 1 行 ＋「店全体の台帳を見る」。
- **完了条件**: `OfflineBand.test.tsx` 5 本と `MyReservations.test.tsx` 4 本が緑。
  `pnpm --filter @app/glasses_management test:all` が緑、web カバレッジ 4 指標 60% 以上。
- **依存**: T-017, T-018

## T-020 E2E に `@e2e-covers` を付け、spec を Approved に上げる

- **目的**: spec の全 UC / AC を Playwright の 1 本ずつに結び、traceability を緑にする。
- **触るファイル**
  - `services/glasses_management/e2e/ledger.spec.ts`（新規）
  - `specs/glasses_management/features/005-availability-and-ledger/spec.md`（ステータス行）
  - `docs/testing/E2E_TRACEABILITY.md`（基準線の表に 33 行を足す）
- **やること**
  - **対応付けるのは 33 個**（`UC-LEDGER-01`〜`11` ＋ `AC-LEDGER-01`〜`22`）。
    validator は `- UC-...:` / `- AC-...:` の定義行だけを分母にし、`US-...` は数えない。
    1 つの ID は**ちょうど 1 回**しか対応付けられない。
    UC と、それを一番よく表す AC は**同じ行にまとめてよい**（`// @e2e-covers UC-LEDGER-01 AC-LEDGER-01`）。
  - コメントは `test(...)` の直前の行に置く。間に `test.describe` やほかの文を挟まない。
  - E2E は seed（T-011）の 12 件に対して走る。**件数を画面から数えず、`すべて 12件 / これから 7件 /
    確認待ち 1件` の札の文字と行数が一致することを見る。**
  - AC-LEDGER-03 の「端末の時計を 1 時間進めても線が動かない」は、Playwright の
    `page.clock.setSystemTime` で端末時刻だけを進めて確かめる。
  - AC-LEDGER-18 は `page.route` で `/api/staff/ledger` を落として通信断を作る。
  - 書けたら spec の `- ステータス:` を `Draft` → `Approved` に上げる。
- **先に書くテスト**: この Playwright test そのものが検証（先に書いてから spec を Approved に上げる）。
- **実装**: `ledger.spec.ts` に「やること」のとおりの test を並べる。
- **完了条件**: `pnpm --filter @app/glasses_management e2e` が緑。
  `pnpm run test:traceability` が緑（未対応・未知・重複が 0）。
- **依存**: T-011, T-016, T-019

## T-021 モックとの突き合わせ

- **目的**: 承認された見た目からどれだけ離れているかを数値で残す。
- **触るファイル**: `services/glasses_management/e2e/mock-compare.spec.ts`（追記）
- **先に書くテスト**: なし（`toHaveScreenshot` そのものが検証）。
- **やること**
  - `playwright test --project=mock`（viewport 1194×810 / deviceScaleFactor 2）で
    `LEDGER-STAFF` / `LEDGER-RESOURCE` / `LEDGER-LIST` / `LEDGER-DETAIL` / `EX-OFFLINE` /
    `HOME-PERSONAL` の 6 枚を撮る。基準画像は `docs/frontend/mockups/eye/reference/`。
  - `LEDGER-WALKIN` は右 400px の受付パネルが `008-reception-and-walkin` の範囲なので**突き合わせない**。
    「ご来店お待ち」の行見出しに人数を出す根拠としてだけ読む。
  - `maxDiffPixelRatio` は「いま許している差」。**下げるだけで、上げてはいけない。**
    残っている差の中身を必ずコメントに書く。この段階で分かっている差は次の 5 つ:
    1. お客様のお名前と来店回数の印（`customers` は `007-customer-records` で足す）
    2. LEDGER-STAFF が `渡辺 由紀` の行を描いていない（LEDGER-WALKIN と LEDGER-LIST の両方が
       11:00 のウォークイン 003 を 渡辺 由紀 に置いている。**実装は勤務の事実に従う**）
    3. LEDGER-STAFF の 佐々木 亮 様 の帯が「フィッティング」（`visit_purposes.name_short` に
       その語は無い。実装は「調整」を出す）
    4. LEDGER-DETAIL の札「電話予約」（実装は「お電話」）
    5. HOME-PERSONAL の 4 行の中身（件数は 4 件で一致するが、時刻とお名前は
       11:00 / 14:00 / 17:00 / 17:30 になる。LEDGER-STAFF を正本にしたため。T-011）
    6. LEDGER-STAFF の「担当が未定」の行に 15:30 の帯（#10）が 1 本増える
       （`kind='staff'` の割当行は 1 予約にちょうど 1 行なので、担当を置かない予約は作れない。I-05）
  - 差分が出た画面は `test-results/` の `-diff.png` を見て、寸法の食い違いだけを直す。
    **モックの画像は直さない。**
- **完了条件**: `playwright test --project=mock` が緑。LEDGER-STAFF の差分が 8% 以下。
- **依存**: T-020

## T-022 完了の確認

- **目的**: このフェーズの全ゲートを実際に走らせ、緑であることを結果で確かめる。
- **触るファイル**: `knip.jsonc`（新しい entry がある場合のみ）／進捗台帳
- **先に書くテスト**: なし（ここで新しいテストを書かない。足りなければ元のタスクへ戻る）
- **実装**: 下の 7 本を上から順に走らせ、落ちたら原因のタスクへ戻る。

```sh
pnpm run lint          # 緑
pnpm run deps:check    # 緑（knip.jsonc の entry を実在のものだけにする）
pnpm run typecheck     # 緑
pnpm run test          # 緑（traceability を含む）
pnpm --filter @app/glasses_management test:all              # 緑（Worker 80% / web 60%）
pnpm --filter @app/glasses_management e2e                   # 緑
pnpm --filter @app/glasses_management exec playwright test --project=mock   # 緑
```

- **やること**
  - **カバレッジの閾値を下げない。広い除外を書かない。**足りなければテストを足す。
  - 進捗台帳（`docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md`）に、
    実行したコマンドとその結果・カバレッジの実測値・`maxDiffPixelRatio` の実測値を書く。
  - このフェーズで残った `[要確認]` が `design/09-open-questions.md` の Q-05 / Q-11 に
    1 対 1 で対応していることを `grep -rn '要確認' specs/glasses_management` で確かめる。
- **完了条件**: 上の 7 本がすべて緑。spec が `- ステータス: Approved`。
- **依存**: T-021
