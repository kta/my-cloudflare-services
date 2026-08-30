# P5 来店受付とウォークイン — TODO

- spec: [`specs/glasses_management/features/008-reception-and-walkin/spec.md`](../../../../specs/glasses_management/features/008-reception-and-walkin/spec.md)
- 依存: P4
- 状態: 未着手
- 目的: お客様が店に着いてから帰るまでを 1 枚の盤面で共有する。ご予約のお客様を受け付け、
  予約なしのお客様をお名前も伺わないうちから受け付け、その日の受付をあとから時系列で追えるようにする。

> 上から順に消化する。**書いてある以上のことをしない。書いてあることは全部やる。**
> 進捗は `docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md` に書く。

## このフェーズが新しく作るもの / 作らないもの

| | 中身 |
|---|---|
| **新設する表** | `walk_ins` / `visit_events` の 2 つだけ（`0005_*.sql`） |
| **読み書きするが新設しない表** | `reservations` / `reservation_purposes` / `reservation_assignments` / `reservation_slot_locks`（P2）・`reception_sessions` / `audit_events` / `idempotency_records`（P3）・`customers`（P4）・`staff` / `staff_shifts` / `equipment` / `visit_purposes` / `store_slot_rules`（P1） |
| **新設するルート** | `/api/staff/walkins`（POST / GET / PATCH）・`/api/staff/visits`（POST）・`/api/staff/visits/board`（GET）・`/api/staff/reception-sessions`（GET）・`/api/staff/reception-sessions/:sessionId`（GET）の **7 本** |
| **既存ルートに枝を足すだけ** | `POST /api/staff/reservations/:reservationId/cancel` に `reason='no_show'` の枝（AC-RECEP-16）。ルートは増えないので権限表の行は増やさない |
| **作らない** | 録音（P7）／予約の変更・取消の操作面（P6）／顧客の登録・検索・統合（P4）／台帳そのものの描画と空き枠の計算（P2）／待ち時間の日次集計（P9）／端末・PIN（P10）。受付の記録と監査の記録の端末欄は NULL のまま置く |

## 着手前に読む 3 か所

1. `specs/glasses_management/design/03-data-model.md` §7.4（`walk_ins`）・§7.5（`visit_events`）・§7.6（`reservation_slot_locks`）・§8.1（`reception_sessions`）
2. `specs/glasses_management/design/04-api.md` §3.7（7 本の表）・§4（スキーマ一覧）・§6.1（冪等）
3. `specs/glasses_management/design/06-use-cases.md` §6（IDX-RECEP-01〜09）

## このフェーズで先に決着させた食い違い（実装はこの表に従う）

| 食い違い | 出どころ | **採る** |
|---|---|---|
| `purposeNote` の長さが 60 と 80 で割れている | `03-data-model.md` §7.4 は 0〜60、`04-api.md` §4 と feature spec T-001 は 0..80 | **80 文字**。契約が 80 で、列はそれを収める |
| `walk_ins` に `version` があるか | `03-data-model.md` §7.4 の列に無い、`04-api.md` §4.0(b) は「足した」と書き `WalkinPatch` が `version` 必須で 409 `version_conflict` を返す | **持たせる**（`integer` NOT NULL・1 以上）。顧客の紐づけと担当決めを 2 台の iPad が同時に触るため |
| 枠が決まらないウォークインは予約を起こすか | `06-use-cases.md` IDX-RECEP-06 の 7 は「起こさない」、`03-data-model.md` §7.4 は `reservation_id` NOT NULL で「必ず起こす」 | **必ず 1 件起こす**。担当未定は `target_key='unassigned'` の枠を取る（AC-RECEP-29 がこの形でしか成立しない） |
| `reservations.status='arrived'` を誰が書くか | `04-api.md` §3.6 は `PATCH .../progress`、feature spec HOW は「`arrived` と `no_show` への遷移をこのフェーズで初めて書く」 | **`POST /api/staff/visits` の同じ `db.batch()` で書く**。2 本に割ると「盤面に載っているのに `confirmed` のまま」が作れてしまう |
| 受付履歴の 1 行の識別子 | `ReceptionHistoryEntry.sessionId` は必須だが、Web 予約（相川 みどり 様・山口 真央 様）は `reception_sessions` を持たない | **`entryId` を足し、`sessionId` を `Uuid \| null` にする**。`entryId` は `reception_sessions.id` ?? `reservations.id` ?? `walk_ins.id`。詳細のパスは `/:sessionId` のまま（値が `entryId`） |
| 「結果」の絞り込みの語 | 画面は 成立 / 取消 / ご来店なし、契約は `outcome: 'booked'\|'discarded'` と `status: ReservationStatus[]` | **`status` に落とす**。成立＝`['confirmed','arrived','serving','done']`／取消＝`['cancelled']`／ご来店なし＝`['no_show']`。契約に新しい語を足さない |

---

## T-001 ウォークイン系の契約を書く（Red）

- **目的**: 受付パネルが送る形とサーバが返す形を Zod で 1 か所に決め、整理番号をクライアントに採番させない。
- **触るファイル**
  - `packages/contracts/src/glasses_management.ts`（追記）
  - `packages/contracts/src/index.ts`（re-export に追記）
  - `packages/contracts/test/glasses_management.contract.test.ts`（追記）
- **先に書くテスト**（`pnpm --filter @app/contracts test`）
  - `WalkinCreate` > `整理番号を受け取らない（サーバが採番する）`
  - `WalkinCreate` > `purposeId と purposeNote はどちらか一方だけを受ける`
  - `WalkinCreate` > `ご用件を両方入れた配信を落とす`
  - `WalkinCreate` > `ご用件をどちらも入れない配信を落とす`
  - `WalkinCreate` > `purposeNote は 80 文字ちょうどまで通り、81 文字で落ちる`
  - `WalkinCreate` > `staffId に null を明示できる（担当を決めずに受け付ける）`
  - `WalkinCreate` > `arrivedAt を省略できる（サーバ時刻で埋める）`
  - `WalkinCreate` > `知らないキーが混ざった配信を落とす`
  - `Walkin` > `ticketNo は 1 以上 999 以下で、0 と 1000 を落とす`
  - `Walkin` > `waitedMinutes は 0 以上の整数で、負の値と小数を落とす`
  - `Walkin` > `status は waiting / serving / booked / left の 4 語だけ`
  - `Walkin` > `leftAt は null を許し、日時でない文字列を落とす`
  - `Walkin` > `reservationId を必ず持つ（受付と同時に予約を 1 件起こすため）`
  - `WalkinListQuery` > `date は必須（当日で絞らない一覧を作らせない）`
  - `WalkinListQuery` > `status は配列で複数取れる`
  - `WalkinPatch` > `version を必須にし、customerId / staffId / status / reservationId だけを受ける`
  - `WalkinSummary` > `台帳の帯に出す 6 項目だけを持つ`
- **実装**: `Walkin` / `WalkinCreate` / `WalkinPatch` / `WalkinListQuery` / `WalkinSummary` の 5 つ。
  すべて `z.strictObject`。ご用件の排他は `.superRefine` で書く（`purposeId` と `purposeNote` の
  「ちょうど一方」）。`purposeNote` は `z.string().trim().min(1).max(80)`。
  日時は `z.string().datetime()`、日付は `YYYY-MM-DD` の regex。
- **完了条件**: 17 本が緑。`packages/contracts` のカバレッジ 4 指標 80% 以上を保つ。
- **依存**: なし

## T-002 来店受付ボードと受付履歴の契約を書く（Red）

- **目的**: 盤面 6 列の状態語と、0 件のときだけ付く緩和候補を型で固定する。
- **触るファイル**
  - `packages/contracts/src/glasses_management.ts`（追記）
  - `packages/contracts/test/glasses_management.contract.test.ts`（追記）
- **先に書くテスト**（`pnpm --filter @app/contracts test`）
  - `VisitStage` > `received / waiting / consulting / fitting / measuring / checkout / handover / left の 8 語だけを受ける`
  - `VisitEventInput` > `note は 120 文字ちょうどまで通り、121 文字で落ちる`
  - `VisitEventInput` > `occurredAt を省略できる（サーバ時刻で埋める）`
  - `VisitEventInput` > `subjectType は reservation と walkin の 2 語だけ`
  - `VisitBoardCell` > `state は done / doing / next / waiting / empty の 5 語だけ`
  - `VisitBoardCell` > `label は 30 文字まで`
  - `VisitBoardCell` > `注意の文は label と別の欄に持つ（設備名と注意を 1 つの文字列に混ぜない）`
  - `VisitBoardCell` > `注意を持つ欄は needsAttention が true になる`
  - `VisitBoardCell` > `empty の欄は at も label も注意も持たない`
  - `VisitBoardQuery` > `scope の既定は active`
  - `VisitBoardRow` > `ウォークインの行は visitCount を null にできる`
  - `VisitBoard` > `serverNow を必ず持つ（端末の時計で描かせない）`
  - `ReceptionHistoryQuery` > `期間は 92 日ちょうどまで通り、93 日で落ちる`
  - `ReceptionHistoryQuery` > `from が to より後の期間を落とす`
  - `ReceptionHistoryQuery` > `name は 40 文字まで`
  - `ReceptionHistoryQuery` > `limit の既定は 50 で、0 と 201 を落とす`
  - `ReceptionHistoryEntry` > `sessionId は null を許す（Web 予約は受付セッションを持たない）`
  - `ReceptionHistoryEntry` > `entryId を必ず持つ`
  - `ReceptionHistoryList` > `0 件のときだけ relaxations を持てる`
  - `ReceptionHistoryList` > `1 件以上あるのに relaxations が付いた応答を落とす`
  - `ReceptionHistoryList` > `relaxations は多くても 3 件`
  - `ReceptionHistoryDetail` > `changes は配列で、recording は null を許す`
  - `SearchRelaxation` > `count は 1 以上（0 件の候補を出さない）`
  - `SearchRelaxation` > `label は 60 文字まで`
  - `LedgerView` > `walkinWaitingCount と nextTicketNo を必ず持ち、estimatedWaitMinutes は null を許す`
- **実装**: `VisitStage` / `VisitEventInput` / `VisitEvent` / `VisitBoardQuery` / `VisitBoardCell` /
  `VisitBoardRow` / `VisitBoard` / `ReceptionHistoryQuery` / `ReceptionHistoryEntry` /
  `ReceptionHistoryList` / `ReceptionHistoryDetail` / `SearchRelaxation`。
  - `VisitBoardCell` に **`note: string | null`（0..40）と `needsAttention: boolean`** を足す
    （`04-api.md` §4 の 4 項目では AC-RECEP-14 / AC-RECEP-15 を色だけに頼らず出せない）。
  - `ReceptionHistoryEntry` に **`entryId`** を足し、`sessionId` を `Uuid | null` にする。
  - `ReceptionHistoryList` の `relaxations` は `.superRefine` で「`total === 0` のときだけ 1..3 件、
    それ以外は空配列」を強制する。
  - **P2 の `LedgerView` に 3 欄を足す**（T-017 の受付パネルが props で受ける値。画面が API を増やさないため）:
    `walkinWaitingCount`（0 以上の整数）/ `estimatedWaitMinutes`（`number | null`。出せないときは null）/
    `nextTicketNo`（1〜999）。あわせて `GET /api/staff/ledger` の応答にこの 3 欄を載せる（T-012 で実装する）。
- **完了条件**: 25 本が緑。
- **依存**: T-001

## T-003 2 表をスキーマに足してマイグレーションを作る（Red → Green）

- **目的**: `walk_ins` / `visit_events` を作り、index が「実際に投げるクエリの形」に合っていることを固定する。
- **触るファイル**
  - `services/glasses_management/src/worker/db/schema.ts`
  - `services/glasses_management/test/schema.test.ts`
  - `services/glasses_management/migrations/`（生成物 `0005_*.sql`）
- **先に書くテスト**（`getTableConfig` で index の名前と対象列を見る。`pnpm --filter @app/glasses_management test`）
  - `walk_ins` > `整理番号を組織・店舗・来店日で一意にする`
  - `walk_ins` > `台帳の最下段を受付時刻順に引く index を持つ`
  - `walk_ins` > `「いまお待ち N名」を来店日で絞って数える index を持つ`
  - `walk_ins` > `外部キーを持たず、version を整数で持つ`
  - `walk_ins` > `真偽値の列を持たない（状態は 4 語の text）`
  - `visit_events` > `そのお客様の工程を発生順に引く index を持つ`
  - `visit_events` > `当日のボード全体を引く index を持つ`
  - `visit_events` > `追記専用なので updated_at を持たない`
- **実装**
  - `walk_ins`: `id` / `organization_id` / `store_id` / `visit_date`(`YYYY-MM-DD`) /
    `ticket_no`(integer) / `arrived_at` / `purpose_id`(null 可) / `purpose_note`(null 可) /
    `customer_id`(null 可) / `reservation_id`(NOT NULL) / `status` / `left_at`(null 可) /
    `version`(integer NOT NULL) / `created_at`。
    index は `walk_ins_org_store_date_ticket_idx`（**`uniqueIndex`**）/
    `walk_ins_org_store_arrived_idx` / `walk_ins_org_store_date_status_idx`。
  - `visit_events`: `id` / `organization_id` / `store_id` / `subject_type` / `subject_id` /
    `stage` / `occurred_at` / `staff_id`(null 可) / `note`(null 可) / `created_at`。
    index は `visit_events_org_subject_idx` / `visit_events_org_store_occurred_idx`。
  - FK を宣言しない。DDL DEFAULT に意味を持たせない。日時は ISO8601（UTC・末尾 `Z`・ミリ秒 3 桁）。
  - `reception_sessions` は **P3 が作った表をそのまま使う**。ここで作らない
    （同じ表を 2 つの migration が作ると、あとから走った `db:generate` が既存表の再作成を出す）。
- **手順**: 編集 → `pnpm --filter @app/glasses_management db:generate` → `db:migrate:local`
- **完了条件**: `migrations/0005_*.sql` が生成され、既存表の再作成（`DROP TABLE`）を 1 行も含まない。
  `schema.test.ts` の 8 本が緑。
- **依存**: T-001, T-002

## T-004 `walkin.time.test.ts` を書く（Red）

- **目的**: 経過分と整理番号の境界を固定する。**時刻は必ず引数で注入し、`Date.now()` を使わない。**
- **触るファイル**: `services/glasses_management/test/walkin.time.test.ts`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test`）
  - `経過分` > `受付ちょうどは 0 分`
  - `経過分` > `59 秒は 0 分、60 秒で 1 分（切り捨て）`
  - `経過分` > `15 分ちょうどはお待たせ中でない`
  - `経過分` > `15 分 1 秒でお待たせ中になる`
  - `経過分` > `受付時刻が未来でも負の分を返さず 0 に丸める`
  - `来店日` > `UTC の 2026-08-27T14:59:59.999Z は JST の 2026-08-27`
  - `来店日` > `UTC の 2026-08-27T15:00:00.000Z は JST の 2026-08-28`
  - `整理番号` > `その日がまだ 0 件なら 1 から始まる`
  - `整理番号` > `その日の最大が 4 なら次は 5`
  - `整理番号` > `JST の日が変わると 1 に戻る`
  - `整理番号` > `月をまたいでも日でリセットする（8月31日 → 9月1日）`
  - `整理番号` > `年とうるう年をまたいでも日でリセットする（2028-02-28 → 2028-02-29）`
  - `整理番号` > `999 の次は採番しない（1..999 の外へ出さない）`
  - `表示` > `4 は「ウォークイン 004」、005 の次は「ウォークイン 006」`
  - `待ちきれずお帰り` > `ご相談が始まる前に left になった来店だけを数える`
  - `待ちきれずお帰り` > `接客を終えて退店した来店は母数に入れるが、待ちきれずには数えない`
- **実装の前提**: 対象は `src/worker/domain/walkin.ts` の純関数
  （`waitedMinutes(arrivedAt, now)` / `isWaitingTooLong(arrivedAt, now)` /
  `jstVisitDate(iso)` / `nextTicketNo(maxTicketNo)` / `formatTicket(no)` /
  `isAbandonedWait(events)`）。閾値 **15 分** は定数 1 か所に置く。
- **完了条件**: 16 本が Red で、期待した理由（関数が無い）で落ちる。
- **依存**: T-003

## T-005 `visit-board.test.ts` を書く — 6 列と 5 状態（Red）

- **目的**: 盤面の列の並びとセルの状態を、`stage` の宣言順から作らせないよう固定する。
- **触るファイル**: `services/glasses_management/test/visit-board.test.ts`（新規）
- **先に書くテスト**
  - `列の並び` > `受付・ご相談・フレーム選び・視力測定・レンズ・お会計・お渡しの 6 列をこの順で返す`
  - `列の並び` > `stage の宣言順ではなく画面の並びで返す`
  - `列の並び` > `waiting と left は列を持たない`
  - `セルの状態` > `済んだ工程は done と終了時刻を持つ`
  - `セルの状態` > `いま進んでいる工程は doing と開始時刻を持つ`
  - `セルの状態` > `対応中は 1 人 1 工程だけ`
  - `セルの状態` > `次にやることは next と設備名を label に持つ`
  - `セルの状態` > `次にやることは 1 人 0 個か 1 個`
  - `セルの状態` > `何も起きていない工程は empty で、at も label も持たない`
  - `セルの状態` > `工程を飛ばした行は飛ばした列を empty のまま返す`
  - `セルの状態` > `打ち消しの行を足すと状態が戻り、元の行は消えない`
  - `お待たせ中` > `最後の記録から 15 分ちょうどは waiting にしない`
  - `お待たせ中` > `最後の記録から 15 分 1 秒で waiting にし、経過分を label に入れる`
  - `お待たせ中` > `お待たせ中の行は isWaitingTooLong が true になる`
  - `ご来店中の数` > `最新が left でない subject だけを数える`
  - `ご来店中の数` > `お渡しが対応中の人もご来店中に数える`
  - `ご来店中の数` > `scope=all は退店した行も返すが activeCount は変わらない`
  - `行の名前` > `ウォークインは整理番号を 3 桁ゼロ埋めで出し、visitCount を null にする`
  - `行の名前` > `ご予約のお客様は「田中 花子 様」と来店回数を持つ`
- **実装の前提**: 対象は `src/worker/domain/visit-board.ts` の純関数
  `buildBoard(rows, events, { now, scope })`。現在時刻は引数。
  列の並びは `BOARD_STAGES`（`['received','consulting','fitting','measuring','checkout','handover']`）
  という **UI と共有する定数**に持つ。
- **完了条件**: 19 本が Red。
- **依存**: T-003

## T-006 `visit-board.test.ts` に担当不在・設備停止の警告を足す（Red）

- **目的**: 「次にやること」の担当が勤務外・設備が点検中のとき、色だけでなく文字で伝わることを固定する。
- **触るファイル**: `services/glasses_management/test/visit-board.test.ts`（追記）
- **先に書くテスト**
  - `注意` > `次にやることの担当がその時間帯の勤務に入っていないとき、欄が注意を持つ`
  - `注意` > `不在の注意の文は「本日はお休みです。担当を決め直してください。」`
  - `注意` > `次にやることの設備が点検で止まっているとき、欄が注意を持つ`
  - `注意` > `点検の注意の文は「視力測定機 A は点検で止まっています。」で、設備名を差し込む`
  - `注意` > `注意を持つ欄は needsAttention が true で、label（設備名）はそのまま残る`
  - `注意` > `勤務にも点検にも当たらない欄は注意を持たず needsAttention が false`
  - `注意` > `注意は「次にやること」の欄にだけ出す（済みました・対応中には出さない）`
- **実装の前提**: `buildBoard` に `shifts`（`staff_shifts` の当日ぶん）と
  `maintenances`（`equipment_maintenance` の当日ぶん）を渡す。勤務の判定は JST の `HH:MM` 比較、
  点検の判定は ISO8601 の重なり判定で、**どちらも `now` を引数で受ける**。
- **完了条件**: 7 本が Red。合計 26 本。
- **依存**: T-005

## T-007 `reception-history.test.ts` を書く（Red）

- **目的**: 絞り込みと、0 件のときに条件を 1 つ緩めた件数が実際に引ける件数と一致することを固定する。
- **触るファイル**: `services/glasses_management/test/reception-history.test.ts`（新規）
- **先に書くテスト**
  - `絞り込み` > `期間はご来店日で絞る（受け付けた日ではない）`
  - `絞り込み` > `担当は接客する担当で絞る（受け付けた人ではない）`
  - `絞り込み` > `受け付けた人が空の受付も担当の絞り込みで落ちない`
  - `絞り込み` > `結果「ご来店なし」は no_show の予約だけを返す`
  - `絞り込み` > `結果「取消」は cancelled の予約だけを返す`
  - `絞り込み` > `結果「成立」は confirmed / arrived / serving / done を返す`
  - `絞り込み` > `お客様名は姓・名・ふりがなの部分一致で絞る`
  - `絞り込み` > `お客様名の絞り込みは期間・担当・結果を保ったまま効く`
  - `絞り込み` > `破棄した受付は予約を持たないまま、開始日の暦日で一覧に混ざる`
  - `並びと読み足し` > `新しい順に limit 件まで返し、nextCursor で続きを返す`
  - `並びと読み足し` > `同じ時刻の行が二重にも欠けにもならない（複合カーソル）`
  - `並びと読み足し` > `total は絞り込んだ総件数で、読み足しても変わらない`
  - `並びと読み足し` > `最後のページの nextCursor は null`
  - `0 件の緩和候補` > `0 件のときだけ relaxations を返す`
  - `0 件の緩和候補` > `期間を今月まで広げた件数が、実際にその条件で引いた件数と一致する`
  - `0 件の緩和候補` > `担当を外した件数が、実際にその条件で引いた件数と一致する`
  - `0 件の緩和候補` > `全解除の件数が絞り込みなしの総件数と一致する`
  - `0 件の緩和候補` > `件数 0 の候補を出さない`
  - `0 件の緩和候補` > `候補は多くても 3 件`
  - `0 件の緩和候補` > `緩められる条件が 1 つも無いときは候補を返さない`
  - `0 件の緩和候補` > `全解除しても 0 件のときは候補を返さない`
  - `0 件の緩和候補` > `候補の query はそのまま再送できる形になっている`
- **実装の前提**: 対象は `src/worker/domain/reception-history.ts`。
  「今月（8月1日 〜 8月27日）」の**今月**は `now` を JST に直して出す（引数で注入）。
  緩和候補は **0 件の応答に同梱する**（追加の往復を作らない）。
- **完了条件**: 22 本が Red。
- **依存**: T-003

## T-008 `constraintTable(err)` に `walk_ins` の複合一意を足す（Red → Green）

- **目的**: D1 の UNIQUE 違反を判別できる唯一の手がかり（エラーメッセージ）への依存を 1 か所に閉じたまま、
  整理番号の複合一意（`walk_ins`）でも表名を取り出せるようにする。
- **既にあるもの**: `constraintTable` は **P3 T-007 が `src/worker/db/constraint.ts` に、
  テストは P3 T-003 が `test/constraint.test.ts` に置いてある。新設しない。**
  このタスクは 3 本（`walk_ins` の単一列・`walk_ins` の複合一意・前後に別の文字がある形）を足し、
  既存の 4 本と合わせて 7 本にする。
- **触るファイル**
  - `services/glasses_management/test/constraint.test.ts`（追記）
  - `services/glasses_management/src/worker/db/constraint.ts`（追記）
- **先に書くテスト**
  - `constraintTable` > `D1_ERROR: UNIQUE constraint failed: walk_ins.ticket_no から walk_ins を取り出す`
  - `constraintTable` > `複合一意（walk_ins.organization_id, walk_ins.store_id, ...）でも walk_ins を取り出す`
  - `constraintTable` > `reservations.code の衝突から reservations を取り出す`
  - `constraintTable` > `idempotency_records の主キー衝突から idempotency_records を取り出す`
  - `constraintTable` > `UNIQUE 以外のエラーからは null を返す`
  - `constraintTable` > `Error でない値（文字列・undefined）を渡しても落ちずに null を返す`
  - `constraintTable` > `メッセージの前後に別の文字があっても取り出せる`
- **実装**: P3 の `export function constraintTable(err: unknown): string | null` を広げる。
  `D1_ERROR: UNIQUE constraint failed: <表>.<列>[, <表>.<列>…]` の 1 書式だけを見て、**最初の表名**を返す。
  **この関数以外に同じ正規表現を書かない**（書式が変わったとき 409 が 500 に化ける場所を 1 つに閉じる）。
- **完了条件**: 既存 4 本＋追加 3 本の 7 本が緑。
- **依存**: T-003

## T-009 `reception.integration.test.ts` を書く — 代表フロー（Red）

- **目的**: 「お客様を特定しない受付 → 接客開始 → あとから結びつけ → 退店 → 履歴で再発見」を実 D1 で通す。
- **触るファイル**
  - `services/glasses_management/test/reception.integration.test.ts`（新規）
  - `services/glasses_management/test/helpers.ts`（受付の下ごしらえを足す）
- **先に書くテスト**
  - `ウォークインの受付` > `お客様を特定しないまま受け付けると、整理番号つきで台帳に載る`
  - `ウォークインの受付` > `同じ操作で source='walkin' の予約と枠の占有が 1 件ずつできる`
  - `ウォークインの受付` > `4 択に無いご用件は自由記述だけが残る`
  - `ウォークインの受付` > `同じ Idempotency-Key の再送は同じ整理番号の同じ 1 件を返す`
  - `ウォークインの受付` > `同じキーで中身が違う再送は 409 idempotency_conflict`
  - `ウォークインの受付` > `「いまお待ち N名」は当日の waiting だけを数え、前日の行を数えない`
  - `工程を進める` > `お客様を登録しないまま「ご相談」を始められる`
  - `工程を進める` > `工程の記録は追記だけで、前の行が書き換わらない`
  - `工程を進める` > `ご予約のお客様の受付を記録すると、予約が arrived になる`
  - `工程を進める` > `同じ予約を二重に受け付けても 2 行目の received を積まない`
  - `あとから結びつける` > `電話番号の下 4 桁で見つけた顧客を紐づけると、表示が整理番号から名前に変わる`
  - `あとから結びつける` > `紐づけた来店はそのお客様の来店回数に数えられる`
  - `あとから結びつける` > `新しく登録したお客様に紐づけると、その来店が初めてのご来店になる`
  - `退店` > `退店を記録すると、ご来店中から外れて本日すべてにだけ残る`
  - `退店` > `お待ちのまま帰られた来店は待ちの帯から外れ、受付履歴には残る`
  - `ご来店がなかった` > `no_show として残すと、受付履歴の結果がご来店なしになる`
  - `受付履歴` > `前日のウォークインを期間を広げて見つけられる`
  - `受付履歴` > `1 件を選ぶと受け付けた人・時刻・手段と、そのあとの変更が古い順に読める`
  - `受付履歴` > `一覧を読んだことが監査に 1 行残る`
- **注意**: D1 はテストファイル内で共有される。組織 id・店舗 id・顧客の電話番号は毎回
  `crypto.randomUUID()` から作る。時刻は body の `arrivedAt` / `occurredAt` で明示的に渡す。
- **実装**: まだ書かない（T-012 / T-013 / T-014 で書く）。**期待した理由で赤いことを目で見る。**
- **完了条件**: 19 本が Red。
- **依存**: T-003

## T-010 同時受付の上限を `reception.integration.test.ts` に足す（Red）

- **目的**: 目の前に立っているお客様を受け付けられない画面を作らないことを、上限ちょうどと +1 件目で固定する（AC-RECEP-29）。
- **触るファイル**: `services/glasses_management/test/reception.integration.test.ts`（追記）
- **先に書くテスト**（銀座店の `store_slot_rules.max_parallel` を **3** にして始める）
  - `同時受付の上限` > `担当を決めずに受け付ける 2 人目が同じ 11:00 の枠に載る`
  - `同時受付の上限` > `上限ちょうどの 3 件目まで受け付けられる`
  - `同時受付の上限` > `4 件目だけが 409 slot_taken になる`
  - `同時受付の上限` > `枠が取れなかったとき、予約もウォークインも 1 行も書かれていない`
  - `同時受付の上限` > `担当を決めた受付は staff.max_parallel_reservations で数える`
  - `同時受付の上限` > `整理番号がぶつかったら +1 して採番し直し、最大 5 回まで試す`
  - `同時受付の上限` > `再試行のあいだ in_progress の冪等キーを消さない`
  - `同時受付の上限` > `再試行で解けない失敗のときだけ in_progress の行を消す`
- **実装の前提**: 枠は**一意 index ではなく上限つきの条件付き INSERT** で取る
  （`03-data-model.md` §7.6 の SQL をそのまま使う。取れたかは `meta.changes` で読む）。
  `?9` の上限は 担当未定＝`store_slot_rules.max_parallel`／担当あり＝`staff.max_parallel_reservations`／
  設備＝`equipment.capacity`。枠を取る文より後ろの全文に
  `WHERE EXISTS (SELECT 1 FROM reservation_slot_locks WHERE reservation_id = ?)` のガードを付ける。
- **完了条件**: 8 本が Red。合計 27 本。
- **依存**: T-008, T-009

## T-011 権限表とテナント分離に 7 ルートを足す（Red）

- **目的**: default-deny が新ルートにも効き、他社の来店に手が届く経路が無いことを固定する。
- **触るファイル**
  - `services/glasses_management/test/permissions.test.ts`
  - `services/glasses_management/test/tenant-isolation.test.ts`
- **先に書くテスト**
  - `permissions.test.ts` の表に **7 行**足す（主体 5 種 = 未認証 / staff / admin / 期限切れ / 別 secret 署名）:
    `POST /api/staff/walkins` / `GET /api/staff/walkins` / `PATCH /api/staff/walkins/:walkinId` /
    `POST /api/staff/visits` / `GET /api/staff/visits/board` /
    `GET /api/staff/reception-sessions` / `GET /api/staff/reception-sessions/:sessionId`。
    期限切れのトークンは**固定の過去時刻**から作る（`Date.now()` に依存させない）。
  - `permissions.test.ts` > `受付履歴はスタッフも読める（店長に絞らない）`
  - `permissions.test.ts` > `未知パス /api/staff/not-a-reception-route は 404 のまま`
  - `tenant-isolation.test.ts` > `3 テナントが同時に受け付けても、整理番号は各自の店舗で 1 から始まる`
  - `tenant-isolation.test.ts` > `他テナントのウォークイン id を PATCH しても 404 で、存在の有無も返らない`
  - `tenant-isolation.test.ts` > `body に他テナントの organizationId を混ぜても自分のテナントの行にしか書かれない`
  - `tenant-isolation.test.ts` > `他テナントの subjectId で工程を進めようとしても 404`
  - `tenant-isolation.test.ts` > `他テナントの受付履歴は期間を広げても 1 件も出ない`
  - `tenant-isolation.test.ts` > `来店受付ボードは他テナントの storeId を渡しても空を返す`
  - `tenant-isolation.test.ts` > `未同期は 503、無効化は 403（受付の 7 ルートでも取り違えない）`
- **Q-04（`design/09-open-questions.md`）に触れる**。いまの前提: **店舗をまたぐ閲覧を作らない**。
  すべて選択中店舗の中で完結させ、`storeId` は絞り込みにだけ使い認可の根拠にしない。
- **実装**: まだ書かない（T-012 / T-013 / T-014 で書く）。**期待した理由で赤いことを目で見る。**
- **完了条件**: permissions が 35 本以上、tenant-isolation の追加 7 本が Red。
- **依存**: T-003

## T-012 ウォークインの 3 ルートを実装する（Green）

- **目的**: T-004 / T-009 / T-010 / T-011 のウォークイン側を緑にする。
- **触るファイル**
  - `services/glasses_management/src/worker/domain/walkin.ts`（新規）
  - `services/glasses_management/src/worker/index.ts`（チェーンに 3 本足す）
- **先に書くテスト**: T-004 の 16 本、T-009 / T-010 のウォークイン系、T-011 の権限表。ここでは足さない。
- **実装**
  - `POST /api/staff/walkins`（`zValidator('json', WalkinCreate)` + `Idempotency-Key`）
    1. `idempotency_records` に `<org>:<walkin.create>:<key>` で `in_progress` を立てる。
       同じキーで `request_hash` が違えば 409 `idempotency_conflict`、同じなら保存済み応答を返す。
    2. `MAX(ticket_no) + 1` を JST の当日で読む。
    3. `reservations`（`source='walkin'`）/ `reservation_purposes` / `reservation_assignments` /
       `reservation_slot_locks`（上限つき条件付き INSERT）/ `walk_ins` / `audit_events`(`walkin.created`)
       を **1 つの `db.batch()`** で書く。
    4. 枠の文の `meta.changes === 0` なら 409 `slot_taken`（このとき予約も受付も 1 行も残らない）。
    5. `constraintTable(err)` が `walk_ins` / `reservations` を返したら +1 して**最大 5 回**再試行する。
       そのあいだ `in_progress` の行を消さない。5 回で解けなければ `in_progress` を消して throw する。
    6. 成功応答を `idempotency_records.response_json` に入れて `done` にする。
  - `GET /api/staff/walkins`（`zValidator('query', WalkinListQuery)`）— `date` 必須。
    `waitedMinutes` は `serverNow - arrived_at` を分へ切り捨てて載せる（列に持たない）。
  - `PATCH /api/staff/walkins/:walkinId`（`zValidator('json', WalkinPatch)`）—
    `WHERE id=? AND organization_id=? AND version=?`。0 行なら 409 `version_conflict`。
    `customerId` を入れた更新では、その顧客の来店回数の起点になる行として `visit_events` は触らない。
  - 応答はすべて `Walkin.parse` / `Walkin.array().parse` を通してから `c.json` する。
  - ルートは**チェーン**して `export type AppType = typeof routes` を保つ。
- **完了条件**: `pnpm --filter @app/glasses_management test` のウォークイン系が緑。
  Worker 側カバレッジ 4 指標 80% 以上。
- **依存**: T-004, T-009, T-010, T-011

## T-013 工程の 2 ルートを実装する（Green）

- **目的**: T-005 / T-006 の盤面と、退店・お待ちのままお帰りを緑にする。
- **触るファイル**
  - `services/glasses_management/src/worker/domain/visit-board.ts`（新規）
  - `services/glasses_management/src/worker/index.ts`（チェーンに 2 本足す）
- **先に書くテスト**: T-005 / T-006 の 26 本と、T-009 の工程・退店。ここでは足さない。
- **実装**
  - `POST /api/staff/visits`（`zValidator('json', VisitEventInput)`）— **追記だけ**。UPDATE / DELETE を発行しない。
    訂正は打ち消しの行を足す。同じ `db.batch()` で書くのは次の 4 つ:
    1. `visit_events` の 1 行（`occurredAt` 省略時はサーバ時刻）
    2. `subject_type='reservation'` かつ `stage='received'` のとき `reservations.status='arrived'`
    3. `stage='left'` のとき、ウォークインなら `walk_ins.status='left'` と `left_at`。
       ご予約のお客様なら `reservations.status='done'`。あわせて `customers.visit_count` /
       `last_visit_at` / `first_visit_at` を **P4 T-013 が置いた同じ更新（`bumpVisitCount`）で** 1 度だけ書く
       （顧客が未特定の来店は数えない）。**`status='done'` を書く経路をこの 1 本に集め、
       P4 の予約の状態遷移ハンドラと二重に +1 しない。**
    4. `audit_events`（`visit.stage.changed`。`target_type` は `reservations` または `walk_ins`）
    対象が自テナントに無ければ 404 `not_found`。
  - `GET /api/staff/visits/board`（`zValidator('query', VisitBoardQuery)`）—
    当日の `visit_events` / `reservations` / `walk_ins` / `staff_shifts` / `equipment_maintenance` を
    読んで `buildBoard` に渡すだけ。**応答に `serverNow` を必ず入れる**（端末の時計で描かせない）。
  - `no_show` は既存の `POST /api/staff/reservations/:reservationId/cancel` に
    `reason='no_show'` の枝を足して扱う（`cancel_reason='no_show'` → `status='no_show'`。
    それ以外の理由は `cancelled`）。新ルートを作らない。
- **完了条件**: `visit-board.test.ts` 26 本と `reception.integration.test.ts` の工程・退店が緑。
- **依存**: T-005, T-006, T-009, T-011

## T-014 受付履歴の 2 ルートを実装する（Green）

- **目的**: T-007 を緑にし、0 件でも行き止まりにならない応答を作る。
- **触るファイル**
  - `services/glasses_management/src/worker/domain/reception-history.ts`（新規）
  - `services/glasses_management/src/worker/index.ts`（チェーンに 2 本足す）
- **先に書くテスト**: T-007 の 22 本と、T-009 の受付履歴 3 本。ここでは足さない。
- **実装**
  - `GET /api/staff/reception-sessions`（`zValidator('query', ReceptionHistoryQuery)`）
    - 一覧の元は「その日にご来店予定の予約（`reservations.starts_at` の JST 暦日）＋ その日のウォークイン」。
      各行に `reception_sessions`（あれば）を左結合する。**`reception_sessions` だけを読まない**
      （スタッフが受け付けない Web 予約が一覧から落ちる）。
      破棄した受付（`outcome='discarded'`）は予約を持たないので `started_at` の暦日で混ぜる。
    - 並びは新しい順。**`OFFSET` を使わない**。カーソルは `(startedAt, entryId)` の複合。
    - `total === 0` のときだけ `relaxations` を **同じ応答に** 1〜3 件同梱する。
      候補の件数は実際にその条件で `COUNT(*)` を引いた値にする（推定しない）。
    - 閲覧そのものを `audit_events` に 1 行残す（`action='reception.history.viewed'` /
      `target_type='reception_sessions'`）。度数と録音へ届く経路であるため。
      **Q-03（`design/09-open-questions.md`）に触れる。いまの前提: 受付履歴は全スタッフが読める**
      （`audit.read` の対象は生の監査ログだけ）。権限で閉じず、閲覧の記録だけを残す。
  - `GET /api/staff/reception-sessions/:sessionId` — 値は `entryId`。
    `reception_sessions` → `reservations` → `walk_ins` の順に id で引き、どれにも無ければ 404 `not_found`。
    `changes` は `audit_events` を `target_id` で引いて**古い順**に組み立てる。
    このフェーズが作る行は「新しく受け付けました」（`reservation.created`）と
    「ご来店を受け付けました」（`visit.stage.changed` の `received`）の 2 種。
    日時・担当を変えた行が同じ並びに載るのは `009-change-and-cancel` の仕事。
    `recording` は **常に null** を返す（P7 で埋める）。
- **完了条件**: `reception-history.test.ts` 22 本と `reception.integration.test.ts` の履歴が緑。
  `pnpm --filter @app/glasses_management test` が全体で緑、カバレッジ 4 指標 80% 以上。
- **依存**: T-007, T-009, T-011

## T-015 来店受付ボードを作る（RECEPTION-JOURNEY）

- **目的**: フロアのスタッフが顔を上げて 3 秒で「誰をお待たせしているか」を掴める盤面を作る。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: フロアのスタッフが顔を上げて 3 秒で「誰をお待たせしているか」を掴む面。主役は盤面 1 枚。
  - トークン計画: 面は白 1 枚（`--color-surface`）。緑（`--color-pine` / `--color-pine-soft`）は
    「対応中」の縦線と「次にやること」の地だけ、赤（`--color-danger` / `--color-danger-soft`）は
    「お待たせ中」だけに使う。状態は **4 語**（済みました／対応中／次にやること／お待たせ中）に限る。
  - シグネチャ: **待たせている行が赤地と文字の両方で真っ先に目に入り、空の欄は空のまま置くこと。**
- **見るモック**: `docs/frontend/mockups/eyex/images/RECEPTION-JOURNEY.png`（1194×834）— **Read で実際に見る**
  - サイドバーは **rail 76px が既定**。上のバー 64px、`.toolbar` 56px。
  - 盤面の外枠 `.board` は padding **28px 36px**。
  - 格子は `grid-template-columns: 220px repeat(6, 1fr)` / `grid-template-rows: 40px repeat(4, 1fr)`、
    枠 1px `--color-line`、角 **16px**（`--radius-panel`）、`overflow: hidden`。
  - 列見出し 13px / 600 / `--color-ink-muted`、下罫 1px `--color-line-strong`、padding 0 14px。
  - お客様欄: padding 0 16px、名前 16px、ご用件 13px `--color-ink-muted`、右罫 1px `--color-line-strong`。
    お待たせ中の行は地が `--color-danger-soft`。
  - 工程の欄: padding 0 14px、状態 13px、値 15px/600。
    「対応中」は左に 4px の緑の縦線（padding-left 10px）、「次にやること」は地 `--color-pine-soft`、
    「お待たせ中」は地 `--color-danger-soft` に `--color-danger` の文字。最終行は下罫なし。
- **触るファイル**
  - `services/glasses_management/src/web/reception/ReceptionBoard.tsx`（新規）
  - `services/glasses_management/src/web/reception/stages.ts`（新規。列の並びと日本語名）
  - `services/glasses_management/src/web/reception/ReceptionBoard.test.tsx`（新規）
  - `services/glasses_management/src/web/App.tsx`（`/reception?view=board` を足す）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test:web`）
  - `来店受付ボード` > `列が お客様／受付／ご相談／フレーム選び／視力測定／レンズ・お会計／お渡し の順に並ぶ`
  - `来店受付ボード` > `右上に「2026年8月27日（木）　ご来店中 4名」が出る`
  - `来店受付ボード` > `何も起きていない欄は空のまま（文字を足さない）`
  - `来店受付ボード` > `お待たせ中の行は赤地と「お待たせ中　18分」の両方で分かる`
  - `来店受付ボード` > `ウォークインの行は来店回数の札を持たない`
  - `来店受付ボード` > `表として「来店受付ボード　お客様ごとの工程」の名前を持つ`
  - `来店受付ボード` > `どの欄も お客様の名前と工程の名前の両方と一緒に読まれる`
  - `来店受付ボード` > `Tab 1 回で盤面を通り抜け、中は矢印キーで移る`
  - `来店受付ボード` > `キーボードだけで「次にやること」から工程を進められる`
  - `来店受付ボード` > `担当が勤務外の欄に「本日はお休みです。担当を決め直してください。」が出る`
  - `来店受付ボード` > `設備が点検中の欄に「視力測定機 A は点検で止まっています。」が出る`
  - `来店受付ボード` > `注意のある欄は色だけでなく文字でも見分けられる`
  - `来店受付ボード` > `「ご来店中」と「本日すべて」を切り替えられる`
  - `来店受付ボード` > `ご来店中が 0 名のときは 見出し 1 行・理由 1 行・「＋ ご来店を受け付ける」だけが残る`
  - `来店受付ボード` > `退店を記録すると、その行がご来店中から外れて人数が 1 減る`
  - `来店受付ボード` > `「ご来店がなかった」として残せる`
- **実装**
  - `role="grid"` にする（台帳と同じ型。**覚え直しを作らない**）。`aria-label="来店受付ボード　お客様ごとの工程"`。
    行は `role="row"`、お客様欄は `role="rowheader"`、列見出しは `role="columnheader"`、
    工程の欄は `role="gridcell"`。**roving tabindex** で Tab は 1 回だけ、格子の中は矢印キーで移る。
  - 各欄の `aria-label` は「田中 花子 様　視力測定　次にやること　視力測定機 A」の順にする
    （お客様の名前と工程の名前の両方を必ず含める）。
  - 工程を進める入口は**その行の「次にやること」の欄そのもの**。欄の中の `<button>` を押すと進む。
    担当以外のスタッフも押せる。
  - 列の並びは `stages.ts` の `BOARD_STAGES` から作り、**`VisitStage` の宣言順から作らない**。
  - 色・寸法は `packages/ui/src/theme.css` のトークン経由のみ。Tailwind 既定パレットと任意値を書かない。
  - 説明文は 2 つまで・各 1 行、状態の札は 3 つまで。**空いた場所を埋めるために要素を足さない。**
- **完了条件**: 16 本が緑。web 側カバレッジ 4 指標 60% 以上。
- **依存**: T-013

## T-016 来店受付の画面を作る（RECEPTION-CHECKIN）

- **目的**: お客様が目の前に立っている 20 秒で、名前と伝え忘れやすいことを確かめて受け付けられるようにする。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: お客様が目の前に立っている 20 秒で、名前と伝え忘れやすいことを確かめて受け付ける面。
  - トークン計画: 白い箱は **3 枚まで**（お客様カード 1 枚 ＋ 右の前回のご来店 1 枚）。
    茶（`--color-walkin` / `--color-walkin-soft`）は「要確認」の札だけに使う（モックの
    `.tag.walkin` に合わせる。`--color-amber` を使わない）。主操作は 1 つ（緑の大ボタン）。
  - シグネチャ: **左に確かめること、右に前回のご来店。確かめ終えなくても受け付けられること。**
- **見るモック**: `docs/frontend/mockups/eyex/images/RECEPTION-CHECKIN.png`（1194×834）— **Read で実際に見る**
  - サイドバーは **ひらく 216px が既定**。`.toolbar` 56px の中に戻るボタン（min-height **40px** / padding 0 14px）と `h2` 18px。
  - 本文は `1fr 320px` の 2 段。左 padding **28px 32px** / 段の間 24px、右は左罫 1px `--color-line`・地は白・padding **28px 24px**。
  - 見出しの 1 行「11:00 のご予約　5分早くお着きです」は 13px `--color-pine-deep`、下に 10px。
  - お客様カード: padding **22px**、丸いアイコン **56×56**（地 `--color-pine-soft` / 枠 `--color-pine-line`）、
    名前 **26px/700**、ふりがな＋電話 13px、下の 3 項目は 3 等分の `<dl>`（dt 13px / dd 16px/600）。
  - 確かめることの行: min-height **52px**、チェック箱 **30×30**（枠 2px・角 8px）、文字 15px、
    札は右端（`margin-left: auto`）。注意ごとの行だけ枠と文字が `--color-walkin`、札は「要確認」。
  - 主操作: min-width **280px** / min-height **56px** / 19px。副操作「お待ちいただく」は既定のボタン。
  - 右の欄: dt 13px `--color-ink-muted`（上に 20px）・dd 16px/600。度数と PD は等幅（`--font-mono`）。
  - **右下の録音の帯（`.rec-float`）はこのフェーズでは出さない**（P7）。
- **触るファイル**
  - `services/glasses_management/src/web/reception/ReceptionCheckin.tsx`（新規）
  - `services/glasses_management/src/web/reception/ReceptionCheckin.test.tsx`（新規）
  - `services/glasses_management/src/web/App.tsx`（`/reception?view=checkin&subject=<id>` を足す）
- **先に書くテスト**
  - `来店受付の画面` > `見出しに「11:00 のご予約　5分早くお着きです」が出る`
  - `来店受付の画面` > `遅れてお着きのときは「10分遅れてお着きです」になる`
  - `来店受付の画面` > `予定時刻ちょうどのときは差を出さない`
  - `来店受付の画面` > `お名前・来店回数・ご予約・ご来店の目的・担当が 1 枚のカードで読める`
  - `来店受付の画面` > `確かめることの行を押すと済みになり、もう一度押すと未済に戻る`
  - `来店受付の画面` > `注意ごとの行だけが「要確認」の札を持つ`
  - `来店受付の画面` > `確かめ済みの行と未確認の行が札と枠で見分けられる`
  - `来店受付の画面` > `確かめることが 1 つも済んでいなくても受け付けられる`
  - `来店受付の画面` > `注意ごとが 0 件のときは 2 行になる`
  - `来店受付の画面` > `右に前回のご来店（日付・度数・PD・担当・ご希望メモ）が出る`
  - `来店受付の画面` > `前回のご来店が無いお客様では右の欄がその事実だけを出す`
  - `来店受付の画面` > `「ご来店を受け付ける」を押すと来店受付ボードへ戻る`
  - `来店受付の画面` > `「お待ちいただく」を押すと待ちとして盤面に載る`
  - `来店受付の画面` > `「‹ 来店受付ボードへ戻る」で何も記録せずに戻る`
  - `来店受付の画面` > `既に受け付けた予約では主操作が押せない`
  - `来店受付の画面` > `消し込みの結果（確かめた行と確かめなかった行）が受付と一緒に送られる`
- **実装**
  - 差の 1 行は `serverNow` と予約の `startsAt` の差から出す（端末の時計を使わない）。
  - 確かめることは 3 行が既定（「お名前を確かめました」「前回からの変化をお伺いする」＋ 注意ごと 1 行につき 1 行）。
    **必須の行を設けない。** 消し込みの結果は `POST /api/staff/visits` の `note` に載せて残す
    （「確かめずに受けた」ことがあとから分かるようにする）。
  - 「ご来店を受け付ける」→ `POST /api/staff/visits`（`stage='received'`）→ 盤面へ戻る。
    「お待ちいただく」→ `POST /api/staff/visits`（`stage='waiting'`）→ 盤面へ戻る。
  - 面が差し替わったら `<h2>` へフォーカスを移し、閉じたら開いた要素へ戻す。
  - 白い箱は 3 枚まで、説明文は 2 つまで。**空いた場所を埋めるために要素を足さない。**
- **完了条件**: 16 本が緑。
- **依存**: T-013

## T-017 台帳に重なる受付パネルを作る（LEDGER-WALKIN）

- **目的**: 台帳を見たまま、店頭のお客様のご用件を 3 タップで伺って受け付けられるようにする。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 台帳を見たまま、店頭のお客様のご用件を 3 タップで伺って受け付ける面。
  - トークン計画: 台帳を隠しきらない右 **400px** のパネル 1 枚。茶（`--color-walkin` / `--color-walkin-soft`）は
    待ち状況の帯と整理番号の札だけ、緑は選んだご用件と主操作だけに使う。
  - シグネチャ: **お客様を後回しにできること**（「あとで登録する」のまま主操作が押せる）。
- **見るモック**: `docs/frontend/mockups/eyex/images/LEDGER-WALKIN.png`（1194×834）— **Read で実際に見る**
  - パネルは `position: absolute` で `top/right/bottom: 0`、幅 **400px**、左罫 1px `--color-line-strong`、地は白。
  - 見出し帯 padding **12px 22px**（`h2` 18px ＋ 右に「やめる」min-height 44px / padding 0 10px）、下罫 1px。
  - 本文 padding **22px 22px 0**、節の間 24px。足元 padding **20px 22px**。
  - 待ち状況の帯: min-height **44px** / padding 0 12px / 角 12px / 地 `--color-walkin-soft` / 枠 1px `--color-walkin`。
    「いまお待ち 2名」15px、「目安 15分」small、右に札「ウォークイン 005」。
  - ご用件: 2×2 の格子（gap 10px）。1 枚 min-height **60px** / padding 8px 10px / 角 8px、
    見出し 15px/600・所要 12px。選択中は枠 3px `--color-pine` ＋ 地 `--color-pine-soft`（padding 6px 8px）。
  - お客様: ラベル 13px（下に 10px）＋ 入力 min-height **52px** / 16px、
    プレースホルダは「電話番号で探す（下4桁でも探せます）」。下に丸い札「あとで登録する」min-height 44px。
  - 主操作「受付して台帳に載せる」は幅いっぱい・min-height **56px**。
  - 台帳側の点線の枠「ここに入ります 11:30–12:30」と最下段の帯（`ご来店お待ち / 2名` 行、高さ **92px**）は
    **P2 が描く**。ここでは値を渡すだけ。
- **触るファイル**
  - `services/glasses_management/src/web/ledger/WalkinPanel.tsx`（新規）
  - `services/glasses_management/src/web/ledger/WalkinPanel.test.tsx`（新規）
- **先に書くテスト**
  - `受付パネル` > `「いまお待ち 2名」「目安 15分」「ウォークイン 005」が 1 行に並ぶ`
  - `受付パネル` > `目安を出せないときは「いまお待ち 2名」だけを出す`
  - `受付パネル` > `ご用件は 4 択で、選ぶと 1 つだけが選択中になる`
  - `受付パネル` > `4 択に無いご用件は自由記述として残せる`
  - `受付パネル` > `ご用件を選ぶまで主操作を押せない`
  - `受付パネル` > `お客様は「あとで登録する」のまま受け付けられる`
  - `受付パネル` > `電話番号の下 4 桁で候補を出す`
  - `受付パネル` > `候補を出しても入力欄からフォーカスを奪わない`
  - `受付パネル` > `「受付して台帳に載せる」は 1 回だけ効く（二度押しで 2 件作らない）`
  - `受付パネル` > `入る枠が無いときは「いまお入れできる枠がありません。お待ちの列に入れます。」を 1 文で出す`
  - `受付パネル` > `409 slot_taken のときも入力を捨てない`
  - `受付パネル` > `開いたときは見出しへフォーカスが移る`
  - `受付パネル` > `「やめる」で閉じ、開いた要素へフォーカスが戻る`
- **実装**
  - 「いまお待ち」「目安」「次の整理番号」は台帳の応答（T-002 で `LedgerView` に足した
    `walkinWaitingCount` / `estimatedWaitMinutes` / `nextTicketNo`）を props で受け取る。
    **このパネルから API を足さない。**
  - 目安は空き枠エンジンの結果だけから出す。出せないときは数字を出さない
    （お客様に口で伝える約束になるため、担当の空きを見ない数字を出さない）。
  - 主操作は `POST /api/staff/walkins` を `Idempotency-Key`（画面で 1 度だけ作る UUID）付きで叩く。
  - **お客様を新しく登録する導線はここに置かない**（受付を止めないため）。
    受け付けたあとに来店受付ボードのその行から登録する。パネルが持つのは
    「電話番号で探す（下4桁でも探せます）」と「あとで登録する」の **2 つだけ**。
  - 台帳を隠しきらない（右 400px に収める）。触れるものは 44pt 以上。
- **完了条件**: 13 本が緑。
- **依存**: T-012

## T-018 受付履歴の一覧と詳細を作る（HISTORY-LIST）

- **目的**: 「いつ誰が受け、そのあと何が変わったか」をその場で答えられる受付履歴を作る。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 店長がお客様からのお問い合わせに、その場で「いつ誰が受け、そのあと何が変わったか」を答える面。
  - トークン計画: 左で選び右で読む 2 段。緑は選択中の行の地（`--color-pine-soft`）と「成立」の札だけ。
    時刻は等幅（`--font-mono`）で桁を揃える。
  - シグネチャ: **左 288px の細い一覧と、右の「そのあとの変更」の時系列。**
- **見るモック**: `docs/frontend/mockups/eyex/images/HISTORY-LIST.png`（1194×834）— **Read で実際に見る**
  - サイドバーは **ひらく 216px が既定**。`.toolbar` 56px に絞り込み 3 つ（min-height **40px** / padding 0 12px /
    角 8px / 13px・600、値は 400 の `--color-ink-muted`。選択中は枠 2px `--color-pine` ＋ 地 `--color-pine-soft`）と、
    右に「お客様名で探す」（min-height 40px / padding 0 14px）。
  - 本文は **`288px 1fr`** の 2 段。左ペイン padding **24px 16px**。
  - 一覧の行: min-height **56px** / gap 10px、時刻 14px/600 等幅 `--color-ink-muted`、名前 15px/600、札は右端。
    選択中の行は margin 0 −8px / padding 16px 8px / 角 12px / 地 `--color-pine-soft` / 下罫なし。
  - 「ほか 42件　8月21日まで」は small・muted・上に 20px。
  - 右ペイン padding **28px 32px** / 段の間 26px。見出し 20px、副文 13px（上に 4px）、
    「予約を開く」min-height 44px / padding 0 14px。
  - 3 項目の `<dl>` は `1.15fr 1.15fr 0.7fr`（dt 13px / dd 15px/600）。
  - 「そのあとの変更」の各行: padding 11px 0 / 下罫 1px、日時の欄は幅 **92px** の等幅 13px/600、
    内容 15px、操作者は右端 13px `--color-ink-muted`。
  - **「受付のときの録音」の欄はこのフェーズでは出さない**（P7）。
- **触るファイル**
  - `services/glasses_management/src/web/history/HistoryList.tsx`（新規）
  - `services/glasses_management/src/web/history/HistoryDetail.tsx`（新規）
  - `services/glasses_management/src/web/history/History.test.tsx`（新規）
  - `services/glasses_management/src/web/App.tsx`（`/history` を足す）
- **先に書くテスト**
  - `受付履歴` > `絞り込みが 期間・担当・結果 の 3 つ並ぶ`
  - `受付履歴` > `左の一覧はご来店日で束ね、見出しに「2026年8月27日（木）　46件」を出す`
  - `受付履歴` > `一覧は新しい順に 20 件まで出る`
  - `受付履歴` > `残りは「ほか 26件　8月21日まで」の 1 行にまとまる`
  - `受付履歴` > `その 1 行を押すと次の 20 件が読み足される`
  - `受付履歴` > `取消の行は「取消」の札を持つ`
  - `受付履歴` > `ご来店なしの行は「ご来店なし」の札を持つ`
  - `受付履歴` > `1 件を選ぶと右に「中村 彩 が 8月20日（木）14:32 に電話で受け付け」が出る`
  - `受付履歴` > `そのあとの変更が古い順に並ぶ`
  - `受付履歴` > `「お客様名で探す」に「田中」と入れると、期間・担当・結果を保ったまま絞れる`
  - `受付履歴` > `「予約を開く」でその予約へ移り、戻ると同じ絞り込みの受付履歴に戻る`
  - `受付履歴` > `選択中の行は aria-current="true" を持つ`
  - `受付履歴` > `録音の欄はこのフェーズでは出さない`
  - `受付履歴` > `読み込み中は骨組みだけを出し、行数を変えない`
- **実装**
  - 一覧の `limit` は **20**（AC-RECEP-28）。読み足しはカーソルで行い、`OFFSET` を使わない。
  - 絞り込みは URL のクエリに持つ（「予約を開く」から戻ったときに同じ条件へ戻るため）。
  - 「結果」の 3 語は `ReceptionHistoryQuery.status` に落とす
    （成立＝`confirmed,arrived,serving,done` / 取消＝`cancelled` / ご来店なし＝`no_show`）。
  - 一覧の行は 8 つまで見せて残りを 1 行にまとめる。白い箱を並べず、罫線だけで区切る。
- **完了条件**: 14 本が緑。
- **依存**: T-014

## T-019 受付履歴の 0 件を作る（HISTORY-EMPTY）

- **目的**: 絞りすぎて 0 件になった店長を、条件を 1 つ緩めるだけで元の道へ戻す。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 絞りすぎて 0 件になった店長を、条件を 1 つ緩めるだけで元の道へ戻す面。
  - トークン計画: 中央 **640px** の 1 枚。件数だけを緑（`--color-pine-deep`）の等幅で強め、
    それ以外に色を足さない。主操作は 1 つ（全解除）。
  - シグネチャ: **候補の右に件数が先に出ていて、押す前に何件見つかるか分かること。**
- **見るモック**: `docs/frontend/mockups/eyex/images/HISTORY-EMPTY.png`（1194×834）— **Read で実際に見る**
  - `.toolbar` は HISTORY-LIST と同じで、絞り込み 3 つがすべて選択中の見た目、右に small muted「該当 0件」。
  - 本文は中央寄せ（`place-items: center` / padding **36px**）、幅 **640px**。
  - 見出し **24px** 中央、副文 15px `--color-ink-muted` 中央（上に 12px）。
  - 「条件を変えると見つかります」は section-title（上に 36px / 下に 6px）。
  - 候補の行: min-height **62px** / gap 14px、文 16px、件数は右寄せ **21px/600** の等幅 `--color-pine-deep`、
    「この条件で見る」min-height 44px / padding 0 14px / 15px。
  - 「絞り込みをすべて外す（46件）」は主操作（min-height **56px** / 18px）、上に 32px。
- **触るファイル**
  - `services/glasses_management/src/web/history/HistoryEmpty.tsx`（新規）
  - `services/glasses_management/src/web/history/History.test.tsx`（追記）
- **先に書くテスト**
  - `受付履歴が 0 件` > `右上が「該当 0件」になる`
  - `受付履歴が 0 件` > `「条件に合う受付履歴はありませんでした」と絞った条件の言い直しが出る`
  - `受付履歴が 0 件` > `緩和候補が件数つきで並ぶ`
  - `受付履歴が 0 件` > `候補は「期間を「今月（8月1日 〜 8月27日）」まで広げる　12件」の名前で引ける`
  - `受付履歴が 0 件` > `「この条件で見る」を押すとその条件で開き直す`
  - `受付履歴が 0 件` > `「絞り込みをすべて外す（46件）」が件数つきで出て、押すと全件に戻る`
  - `受付履歴が 0 件` > `0 件になったことが role="status" で読み上げられ、入力の手が止まらない`
  - `受付履歴が 0 件` > `候補が 1 つも無いときは全解除だけが出る`
  - `受付履歴が 0 件` > `この店舗にまだ受付が無いときは理由だけを出し「＋ 予約を取る」を置く`
  - `受付履歴が 0 件` > `絞り込みの値は消さない（0 件になっても条件が画面に残る）`
- **実装**
  - 0 件の型は EX-EMPTY-SEARCH と揃える（見出し 1 行 ＋ なぜ空かの 1 行 ＋ 次の一手）。**行き止まりにしない。**
  - 候補は `ReceptionHistoryList.relaxations` をそのまま並べる。**追加の呼び出しをしない。**
  - 押せる操作の名前に件数を含める（読み上げでも件数が読まれる）。
  - `role="status"` にするのはこの 0 件の告知だけ。`role="alert"` にしない（接客中に読み上げが割り込む）。
- **完了条件**: 10 本が緑。web 側カバレッジ 4 指標 60% 以上。
- **依存**: T-018

## T-020 E2E を書き、spec を Approved に上げる

- **目的**: Approved の UC/AC 45 件を、ちょうど 1 本ずつの Playwright test へ結ぶ。
- **触るファイル**
  - `services/glasses_management/e2e/reception.spec.ts`（新規）
  - `specs/glasses_management/features/008-reception-and-walkin/spec.md`
  - `docs/testing/E2E_TRACEABILITY.md`（`## 現在の基準線` の表に 1 行足す）
- **やること**
  - `test(...)` の**直前の行**に `// @e2e-covers <ID> [<ID>]` を書く（`//` の 1 行コメントだけ。
    間に別の文・別のコメント・`test.describe` を挟むと validator が落ちる）。
    `test.only` / `test.skip` / `test.fixme` を使わない。
  - **29 本**の test に 45 件を割り付ける（AC 1 件につき 1 本、UC はそれを通す本に相乗りさせる）:

    | test | `@e2e-covers` |
    |---|---|
    | 1 | `AC-RECEP-01 UC-RECEP-01` |
    | 2 | `AC-RECEP-02` |
    | 3 | `AC-RECEP-03 UC-RECEP-02` |
    | 4 | `AC-RECEP-04 UC-RECEP-03` |
    | 5 | `AC-RECEP-05 UC-RECEP-06` |
    | 6 | `AC-RECEP-06 UC-RECEP-07` |
    | 7 | `AC-RECEP-07` |
    | 8 | `AC-RECEP-08 UC-RECEP-08` |
    | 9 | `AC-RECEP-09 UC-RECEP-09` |
    | 10 | `AC-RECEP-10 UC-RECEP-10` |
    | 11 | `AC-RECEP-11 UC-RECEP-04` |
    | 12 | `AC-RECEP-12 UC-RECEP-05` |
    | 13 | `AC-RECEP-13` |
    | 14 | `AC-RECEP-14` |
    | 15 | `AC-RECEP-15` |
    | 16 | `AC-RECEP-16 UC-RECEP-11` |
    | 17 | `AC-RECEP-17 UC-RECEP-12` |
    | 18 | `AC-RECEP-18 UC-RECEP-13` |
    | 19 | `AC-RECEP-19` |
    | 20 | `AC-RECEP-20` |
    | 21 | `AC-RECEP-21` |
    | 22 | `AC-RECEP-22` |
    | 23 | `AC-RECEP-23 UC-RECEP-14` |
    | 24 | `AC-RECEP-24 UC-RECEP-15` |
    | 25 | `AC-RECEP-25` |
    | 26 | `AC-RECEP-26 UC-RECEP-16` |
    | 27 | `AC-RECEP-27` |
    | 28 | `AC-RECEP-28` |
    | 29 | `AC-RECEP-29` |

  - 時刻に依存する 3 本（AC-RECEP-07 の「お待ち 6分」・AC-RECEP-13 の「お待たせ中 18分」・
    AC-RECEP-01 の「5分早くお着きです」）は、**受付時刻を body で明示して仕込む**。
    ブラウザの時計を進めない。
  - 書けたら spec の `- ステータス: Draft` を `- ステータス: Approved` に上げる。
- **先に書くテスト**: この 29 本の Playwright test そのものが検証。
- **実装**: `reception.spec.ts` に割り当て表のとおりの test を並べる。
- **完了条件**: `pnpm --filter @app/glasses_management e2e` が緑。
  `pnpm run test:traceability` が
  `E2E traceability: all approved UC/AC identifiers are mapped exactly once.` を出す。
- **依存**: T-015, T-016, T-017, T-018, T-019

## T-021 モックとの突き合わせを足す

- **目的**: 承認された見た目からどれだけ離れているかを、5 画面ぶん数字で残す。
- **触るファイル**: `services/glasses_management/e2e/mock-compare.spec.ts`
- **やること**
  - `RECEPTION-JOURNEY` / `RECEPTION-CHECKIN` / `LEDGER-WALKIN` / `HISTORY-LIST` / `HISTORY-EMPTY` の
    5 本を足す。`toHaveScreenshot('<画面ID>.png', { scale: 'device' })`。
  - `maxDiffPixelRatio` の初期値と、**残っている差が何かをコメントに書く**:
    - `RECEPTION-JOURNEY.png` — 0.05（上のバーの「お知らせ 3」が P10 で入る）
    - `RECEPTION-CHECKIN.png` — 0.08（右下の録音の帯が P7 で入る）
    - `LEDGER-WALKIN.png` — 0.06（台帳の帯と点線の枠は P2 が描く）
    - `HISTORY-LIST.png` — 0.10（「受付のときの録音」の欄が P7 で入る）
    - `HISTORY-EMPTY.png` — 0.04
  - **この値は下げるだけ。上げてはいけない。**
- **先に書くテスト**: なし（`toHaveScreenshot` そのものが検証）。
- **実装**: 5 面の `toHaveScreenshot` と、許している差のコメント。
- **完了条件**: `pnpm --filter @app/glasses_management exec playwright test --project=mock` が緑。
- **依存**: T-020

## T-022 `pnpm check` を緑にする

- **目的**: このフェーズの全ゲートを実際に走らせ、緑であることを結果で確かめる。
- **触るファイル**: `knip.jsonc`（新しい entry がある場合のみ）／進捗台帳
- **先に書くテスト**: なし（ここで新しいテストを書かない。足りなければ元のタスクへ戻る）
- **実装**: 下の 10 本を上から順に走らせ、落ちたら原因のタスクへ戻る。

```sh
pnpm --filter @app/contracts test                                    # 緑
pnpm --filter @app/glasses_management test                           # 緑・4 指標 80% 以上
pnpm --filter @app/glasses_management test:web                       # 緑・4 指標 60% 以上
pnpm --filter @app/glasses_management e2e                            # 緑
pnpm --filter @app/glasses_management exec playwright test --project=mock  # 緑
pnpm run lint                                                        # 緑
pnpm run deps:check                                                  # 緑（新規ファイルを knip の entry に登録する）
pnpm run typecheck                                                   # 緑
pnpm run test                                                        # 緑（traceability を含む）
pnpm check                                                            # 緑
```

- **カバレッジの閾値を下げない。広く除外しない。**
- 進捗台帳（`docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md`）に、
  実行したコマンドとその結果・カバレッジの実測値・`maxDiffPixelRatio` の実測値を書く。
- **完了条件**: 上の 10 本がすべて緑。spec が `- ステータス: Approved`。進捗台帳に実測値を書いた。
- **依存**: T-021
