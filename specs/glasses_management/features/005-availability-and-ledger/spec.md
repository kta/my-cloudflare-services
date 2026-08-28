# 005-availability-and-ledger: 空き枠と予約台帳

- サービス: `glasses_management`
- ステータス: Draft

## 1. WHAT / WHY

**概要**: 店の決まりをすべて掛けて「置ける時刻」を出す計算と、その日の予約を担当者別・設備別・時間順の
3 つの読み方で見せる予約台帳を作る。この feature は**読むことと、置けるかどうかの判断**だけを担い、
予約を取る・変える操作は後続の feature が足す。

**ユーザーストーリー**:

- US-LEDGER-01: 受付スタッフとして、いまお店がどこまで埋まっているかを一目で読むために、縦が担当者・横が時間の台帳がほしい。
- US-LEDGER-02: 受付スタッフとして、測定機と相談カウンターの取り合いに気づくために、縦が設備・場所の台帳がほしい。
- US-LEDGER-03: 受付スタッフとして、次に何をすべきか迷わないために、同じ日を時間順に並べたリストがほしい。
- US-LEDGER-04: 受付スタッフとして、台帳の位置を見失わないまま 1 件の中身を確かめたいので、その場で開く詳細がほしい。
- US-LEDGER-05: 予約を受ける担当として、お客様を待たせずに答えるために、店の決まりをすべて掛けた空き枠の計算がほしい。
- US-LEDGER-06: 担当として、朝いちばんに自分の持ち場を確かめるために、本日わたしが担当するご予約の一覧がほしい。

**ユースケース**:

- UC-LEDGER-01: 受付スタッフは担当者別で当日の台帳を読める。
- UC-LEDGER-02: 受付スタッフは並べ方を設備・場所別に切り替えられる。
- UC-LEDGER-03: 受付スタッフは予約リストで時間順に読み、絞り込める。
- UC-LEDGER-04: 受付スタッフは帯を押して予約の詳細を台帳の上で開ける。
- UC-LEDGER-05: 受付スタッフは日付を前後に移し、本日へ戻せる。
- UC-LEDGER-06: システムは表示中の日付が本日のとき、現在時刻を台帳に線と札で示せる。
- UC-LEDGER-07: システムは店舗・日付・目的から、置ける時刻とその空き数を求められる。
- UC-LEDGER-08: 受付スタッフは担当・設備を未定のまま押さえた枠を、台帳の専用の行で読める。
- UC-LEDGER-09: 受付スタッフは通信が切れた台帳を、読み取り専用のまま読み続けられる。
- UC-LEDGER-10: 受付スタッフは、開いた予約の詳細を指でもキーボードでも閉じて、元の帯へ戻れる。
- UC-LEDGER-11: 担当スタッフは、個人端末のトップで本日自分が担当するご予約を時間順に読める。

**受け入れ基準**:

- AC-LEDGER-01: Given 銀座店を選んで業務画面を開いている, When サイドバーの「予約台帳」を押す, Then 上のバーに「2026年8月27日（木）」が出て、並べ方は「担当者」・表示のかたちは「タイムテーブル」が選ばれ、縦に「佐藤 美咲」「高橋 健」「中村 彩」の行が並ぶ。
- AC-LEDGER-02: Given 担当者別のタイムテーブルを開いている, When 予約の帯が置かれている列を読む, Then 時間の目盛りは 10:00 から 16:30 までの 30分刻み **14 列を表示窓**として描かれ（承認済みモックの 3 面がいずれも 14 列で、19:00 まで届いていない）、営業時間がそれより長い日は台帳の中だけを横スクロールさせる。30分ごとの薄い線と 1時間ごとの濃い線は予約の帯の下でも途切れずに縦へ通っている。
- AC-LEDGER-03: Given 表示中の日付が本日である, When 台帳を描く, Then 現在時刻の位置に縦線が 1 本引かれ、ツールバーの右に「現在 11:08」と出る。端末の時計だけを 1 時間進めても、線の位置と札の時刻は動かない。現在時刻が表示窓の外（開店前・閉店後）のときは縦線を引かず、札だけを「現在 9:42（営業時間の外）」のように出して、いま何時かを見失わせない。
- AC-LEDGER-04: Given 本日の台帳を開いている, When 日付の「›」を押す, Then 日付が「2026年8月28日（金）」になり、現在時刻の線と「現在 11:08」の札が消え、並べ方「担当者」と表示のかたち「タイムテーブル」は保たれる。「本日」を押すと元の日へ戻る。
- AC-LEDGER-05: Given Web から入った予約が台帳にある, When その帯を読む, Then 帯に「Web予約」の文字が出て、出どころが色だけでなく文字でも分かる。出どころの語は **お電話 / 店頭 / Web予約 / ウォークイン の 4 つ**（`source` は `phone` / `counter` / `web` / `walkin` の 4 値。店頭で先の日時を伺った予約＝`counter` と、予約なしで来られた方＝`walkin` は業務上まったく別）、色は 3 系統（お電話と店頭＝緑・Web予約＝青・ウォークイン＝茶）にする。帯に出どころの語を書くのは Web予約（青）とウォークイン（茶）だけで、緑の帯は既定なので語を持たない。4 語は予約リストと詳細でそのまま出し、LEDGER-DETAIL の札「電話予約」も「お電話」に揃える。
- AC-LEDGER-06: Given 60分の予約と 30分の予約が同じ台帳にある, When 帯を読む, Then 60分の帯にはご用件の短い名前（`visit_purposes.name_short`。「新調相談・視力測定」）が出て、30分幅の狭い帯にはご用件を入れない。30分 1 列の文字予算はおよそ 6 字（13px で 1 行 3.0 字 × 2 行）しかなく、`name_internal`（「メガネを新しく作る」）は入りきらずに「メガネを新し…」と切れて業務上読めなくなる。お名前と来店回数の印は `customers` を作る `007-customer-records` で足す（AC-CUST-24）。
- AC-LEDGER-07: Given 担当が決まっていない予約が 1 件ある, When 担当者別の台帳を読む, Then 担当の行の下に「担当が未定」の行があり、その予約の帯がそこに置かれる。赤い帯は「担当が未定」以外の意味を持たず、色だけに意味を持たせないので帯の中にも「担当が未定」と文字で書く。
- AC-LEDGER-08: Given 担当者別の台帳を開いている, When 最下段を読む, Then 「ご来店お待ち」の行が時間軸に載らない**全幅の帯**として最下段に固定されており、行見出しに待っている人数（「2名」）が数字で出る。人数は当日（JST）の `walk_ins.status='waiting'` の件数で、`008-reception-and-walkin` を作るまでは 0名 のままである。台帳の高さが足りないときも、この行だけは画面の下端に貼り付けて隠れないようにする。
- AC-LEDGER-09: Given 担当者別の台帳を開いている, When 並べ方の「設備・場所」を押す, Then 縦軸が「視力測定機 A」「視力測定機 B」「検査室 1」「相談カウンター 1」「相談カウンター 2」の順に入れ替わり、日付と表示のかたちは保たれる。
- AC-LEDGER-10: Given 1 件の予約が視力測定機 A と 相談カウンター 2 を同時に押さえている, When 設備・場所別の台帳を読む, Then 同じ 1 件の帯が 2 行に同時に出て、片方を押すともう片方にも同じ印が付く。
- AC-LEDGER-11: Given 視力測定機 B に 11:30 からの点検が入っていて、予約が 1 件も無い設備が 1 台ある, When 設備・場所別の台帳を読む, Then 点検の時間帯が「点検」の帯で埋まり、予約の無い設備の行には「いま空いています」と出る。埋まった枠の中の文字は、地に `--color-busy-soft` を敷いたうえで `--color-ink-muted` で書き、地との差を 4.5:1 以上にする（文字を本文と同じ濃さまで上げると、埋まった枠が空き枠より目立ってしまうため、地を明るくする側で解く）。
- AC-LEDGER-12: Given 台帳を開いている, When 表示のかたちの「予約リスト」を押す, Then 同じ日が時間順の行になり、列見出しが「受け付け」「時間」「お客様」「ご用件」「担当」で、絞り込みの札「すべて」「これから」「確認待ち」が件数つきで並ぶ。「受け付け」の欄には出どころの 4 語（お電話 / 店頭 / Web予約 / ウォークイン）をそのまま出す。
- AC-LEDGER-13: Given 予約リストを「すべて 12件」で開いていて、現在時刻が 11:08 である, When 「これから」を押す, Then 11:08 までに始まった 5 行（10:00・10:30・11:00 の 2 行・11:02）が消えて 7 行になり、札の「これから 7件」と一致する。当てはまる行が 0 件になる絞り込みでは表を空のまま残さず、HISTORY-EMPTY と同じ型（見出し 1 行＋なぜ 0 件かの 1 行＋条件を緩める操作 1 つ）で「『確認待ち』のご予約はありません。」と「すべてを見る」を出し、行き止まりにしない。
- AC-LEDGER-14: Given 担当が未定の予約が予約リストにある, When その行を読む, Then 担当の欄が「決めてください」になる。
- AC-LEDGER-15: Given 担当者別の台帳を開いている, When 11:00 の帯を押す, Then 台帳を隠さずその場に詳細が開き、「11:00–12:00」「60分」・ご用件「メガネを新しく作る」・担当「佐藤 美咲」・場所「視力測定機 A ／ 相談カウンター 2」（1 予約は場所を複数持てる）・「注意ごと」の 1 行が並び、下段に「ご来店を受け付ける」「変更する」「取り消す」の 3 つだけが出る。すでに受け付けが済んだ予約（`status` が `arrived` 以降）では「ご来店を受け付ける」を出さず、代わりに「受付済み 11:02」と事実だけを出す（受付を押し直す導線はモックに無く、押し間違いは「取り消して受け直す」で足りる）。お客様のお名前は `customers` を作る `007-customer-records` で足す（AC-CUST-25）。
- AC-LEDGER-16: Given 12:00 に終わる予約があり、片付けの時間が 10分に決めてある, When その日の空き枠を 60分の目的で求める, Then 12:00 から始まる枠は置けない枠として返り、12:30 から始まる枠は置ける枠として返る。
- AC-LEDGER-17: Given 同時受付の上限が 3 件の店舗で、13:00 台に担当が未定のままの予約を含む 3 件が入っている, When その時間帯の空き枠を求める, Then 担当が未定の予約も数に入って上限に達し、13:00 の枠は「満席」として返る。
- AC-LEDGER-18: Given 台帳を開いている, When 通信が切れる, Then 台帳の上に「通信が切れています」の帯が出て、「いまご覧の内容は」といつ時点かを示す時刻と「再接続を試す」が並び、台帳は時間順のリストとして読める状態を保ったまま書き込みの操作を受け付けない。この帯は読み上げに割り込まない知らせとして伝え、接客中の読み上げを断ち切る警告にはしない。
- AC-LEDGER-19: Given 11:00 の予約の詳細を台帳の上に開いている, When 台帳の空いているところを 1 回押す・開いた帯をもう一度押す・Esc を押す のいずれかを行う, Then 詳細が閉じてフォーカスが元の帯へ戻り、閉じるためのその 1 回は新しい予約を起こさず、日付・並べ方・表示のかたち・スクロールの位置は変わらない。
- AC-LEDGER-20: Given 担当者別のタイムテーブルを開いている, When キーボードだけで台帳をたどる, Then 台帳は矢印キーで枠を移れる格子（`role="grid"`。行見出しに担当名、列見出しに時刻）として読め、帯 1 つずつが「11:00から12:00　新調相談・視力測定　佐藤 美咲」のようにひと続きの名前で読まれ、台帳を通り抜けるのに 14 列ぶんの移動を要さず、フォーカスの輪は白い枠の上でも緑の面の上でも見える。2 列以上にまたがる帯は先頭のセルにだけ置いて幅を `aria-colspan` で伝え、同じ帯を 2 度読ませない。全列にまたがる「ご来店お待ち」の行は 1 つのセルとして扱う。
- AC-LEDGER-21: Given 個人端末で佐藤 美咲として業務を始めている, When トップを開く, Then 右に「本日わたしが担当するご予約　4件」が出て、時刻・ご用件・状態（「ご案内中」など）が時間順に並び、1 行を押すと台帳のその帯の詳細が開く（お客様のお名前は `007-customer-records` の AC-CUST-24 で足す）。担当のご予約が 0 件の日は「本日ご担当のご予約はありません。」と、なぜ空かの 1 行と「店全体の台帳を見る」を出して行き止まりにしない。
- AC-LEDGER-22: Given 2026年9月1日（火）が定休日である, When その日の台帳を開く, Then 目盛りだけの空の格子を出さず、「9月1日（火）は定休日です。」と、日付を戻す操作（「本日」）を 1 つ出す。臨時休業の日と、店舗まるごとの受付を止めた日も同じ型で出す。

**スコープ外**:

- 予約を新しく取る 5 工程・帯のドラッグでの置き直し・重なり警告（`006-booking-flow`）。
- 予約の変更・取り消し・差分の確認（`009-change-and-cancel`）。詳細の「変更する」「取り消す」は**置くだけ**で、押した先はこの feature では作らない。
- ご来店の受け付け・ウォークインの受付パネル「受付して台帳に載せる」・来店の工程（`008-reception-and-walkin`）。詳細の「ご来店を受け付ける」も置くだけ。
- 録音の再生（`010-recording`）。詳細の「● 録音を聞く」は置くだけ。
- 絞り込みの「確認待ち」の中身になる Web 予約の承認待ち（`011-web-booking`）。この feature では札と件数の器だけを作る。
- 店舗・営業時間・スタッフ・設備・目的の**登録と編集**（`004-store-settings`）。この feature はそれらを読むだけ。
- 「絞り込み」ボタンの中身（担当・目的での絞り込み）。モックはボタンだけで中身を描いていない。

**不明点**: なし（第2巡で全件決着した。決めた内容は上の受け入れ基準と下の HOW に書き込んである）。

## 2. HOW

**触るファイル**:

- `packages/contracts/src/glasses_management.ts` — `Reservation` / `ReservationDetail` / `ReservationAssignment` / `LedgerQuery` / `LedgerView` / `LedgerLane` / `LedgerEntry` / `LedgerBlock` / `AvailabilityQuery` / `AvailabilitySlot` / `AvailabilityReason` / `AvailabilityLane` / `AvailabilityResponse`
- `packages/contracts/test/glasses_management.contract.test.ts` — 上記の境界値と未知キー
- `services/glasses_management/src/worker/db/schema.ts` — `reservations` / `reservationPurposes` / `reservationAssignments` / `reservationSlotLocks` と `visitPurposes.nameShort` の追加列
- `services/glasses_management/src/worker/domain/availability.ts` — **純関数**。`now: Date` を含め、営業時間・休憩・勤務・点検・既存の押さえをすべて**引数で受け取り**、DB にも実時刻にも触れない
- `services/glasses_management/src/worker/domain/ledger.ts` — **純関数**。読み出した行から担当軸・設備軸・リストの 3 通りの行を組み立てる（「担当が未定」の擬似行、1 予約の複数行への複製、「ご来店お待ち」の帯を含む）
- `services/glasses_management/src/worker/index.ts` — `GET /api/staff/availability` / `GET /api/staff/ledger` / `GET /api/staff/reservations/:reservationId` をチェーンに足す
- `services/glasses_management/src/web/ledger/` — `LedgerPage.tsx` / `Timetable.tsx` / `TimeGrid.tsx` / `NowLine.tsx` / `LedgerList.tsx` / `ReservationPopover.tsx` / `OfflineBand.tsx` と各 `*.test.tsx`
- `services/glasses_management/src/web/home/MyReservations.tsx` — 個人端末のトップの「本日わたしが担当するご予約」（AC-LEDGER-21）
- `services/glasses_management/seed/` — 決定ブリーフ §11 の世界観データ（完了条件。T-022）
- `services/glasses_management/src/web/client.ts` — 台帳・空き枠の取得を足す
- `services/glasses_management/test/availability.test.ts` — 8 条件を 1 つずつ落とす表駆動
- `services/glasses_management/test/availability.time.test.ts` — 片付け時間・休憩帯・上限・JST 日跨ぎの「ちょうど」と「±1分」
- `services/glasses_management/test/ledger.integration.test.ts` — 3 軸の応答と `serverNow`
- `services/glasses_management/test/permissions.test.ts` — 追加した 3 本のルートを表に足す
- `services/glasses_management/test/tenant-isolation.test.ts` — 他テナントの予約が台帳・空き枠に混ざらないこと
- `services/glasses_management/e2e/ledger.spec.ts` — 上の AC と 1 対 1 で `// @e2e-covers` を付ける

**データモデル差分**: `reservations` / `reservation_purposes` / `reservation_assignments` / `reservation_slot_locks` の
**4 表**を新設する（`design/03-data-model.md` §12 の `0002_*.sql`）。`reservations.source` は
`phone` / `counter` / `web` / `walkin` の **4 値**で持つ（AC-LEDGER-05）。
`visit_purposes` に台帳・一覧用の短い名前 `name_short`（**1〜5 文字**。`design/03-data-model.md` §6.1 が正本で、
seed は 新調相談 / 調整 / 受け取り / 修理 / コンタクト / 視力測定 の 6 件）を足す。使い分けは
**台帳の帯・HOME の一覧・設定の影響カード＝`name_short`／予約の詳細・復唱・受付＝`name_internal`／
お客様に見せる面＝`name_public`** の 3 通りに固定する。
`reservations.customer_id` は `customers` を作る `007-customer-records` まで常に NULL、
`walk_ins` は `008-reception-and-walkin` で足すため、「ご来店お待ち」の帯はこの feature では人数 0 の器として作る。
そのぶん、この feature の台帳は**お客様のお名前と来店回数を描かない**（AC-LEDGER-06 / AC-LEDGER-15 から外し、
`007-customer-records` の AC-CUST-24 / AC-CUST-25 で足す）。
index は `reservations_org_store_start_idx` に加えて `reservations_org_store_status_start_idx` を張る
（LEDGER-LIST の絞り込みと ALERTS の確認待ち件数が全走査にならないようにする）。

- **`reservation_slot_locks`（枠の一次排他）はこの feature で作る。** 書く側は `006-booking-flow`（P3）だが、
  読む側の空き枠エンジンが先に要るので表は P2 に置く。D1 の `db.batch()` は「同じバッチの中で読んで判定して書く」ことが
  できないので、二重予約を止める手段はこの表しかない。**一意 index は張らない。**
  `(organization_id, store_id, kind, target_key, slot_start)` を**非一意**の複合 index にし、
  `(organization_id, reservation_id)` を取消・変更の一括 DELETE 用に張る。占有は次の 1 文で数える
  （D1 で発火することを実測済み。発火したかどうかは `meta.changes` の 1 / 0 で読む）:

  ```sql
  INSERT INTO reservation_slot_locks (id, organization_id, store_id, reservation_id, kind, target_key, slot_start, created_at)
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
  WHERE (SELECT COUNT(*) FROM reservation_slot_locks
         WHERE organization_id = ?2 AND store_id = ?3 AND kind = ?5 AND target_key = ?6 AND slot_start = ?7) < ?9
  ```

  `?9` には担当なら `staff.max_parallel_reservations`、設備なら `equipment.capacity`、
  担当未定のレーン（`target_key='unassigned'`）なら `store_slot_rules.max_parallel` を渡す。
  空き枠エンジンの占有判定も**この表の枠ごとの行数**を数える形にし、確定時の上限判定と数え方を 1 つに揃える
  （AC-LEDGER-17 の「担当が未定の予約も数に入って上限に達する」はこの数え方の帰結である）。
- **仮の押さえ（KV）を読むのは業務面の空き枠計算だけにする。** `GET /api/staff/availability` は KV の押さえを
  塞がりとして数えるが、公開面（`/api/public/**`。`011-web-booking`）では読まない。Workers KV（Free）の
  **list は 1,000 回/日**で、押さえの鍵は `holdId` なので 1 回の空き枠計算につき `KV.list` が 1 回要る。
  公開の日時選びが 1 日 400 人 × 3 回あるだけで上限を越え、越えるとその種類の操作がエラーになって空き枠が丸ごと落ちる。
  お客様に「他の端末が押さえ中」を見せる必要は無く、一次排他は確定時の `reservation_slot_locks` が担うので、
  公開面で読まなくても二重予約にはならない。

**完了条件**: 決定ブリーフ §11 の世界観データ（銀座店・スタッフ 6 名・設備 7 件・目的 6 件・2026年8月27日の予約 12 件）を
seed として投入し、台帳がその 12 件を描くところまでを緑とする。P2 には予約を作る操作（`POST /api/staff/reservations` は
`006-booking-flow`）が無いので、seed 無しでは AC-LEDGER-01〜22 が 1 本も緑にならない。seed は実装物として T-022 に立てる。

**却下した代替案**:

- 台帳の行を SQL の `GROUP BY` だけで組み立てる: 「担当が未定」の擬似行と 1 予約を複数の設備行へ複製する処理が SQL に書きづらく、テストが D1 依存になるため却下。読み出しは素直な 1 日分の抽出にして、行の組み立ては純関数に寄せる。
- 現在時刻の線を端末の時計から描く: iPad の時計がずれると台帳が嘘をつくため却下。応答の `serverNow` から算出する。
- 30分ごとの線を各セルの `border` で引く: 予約の帯が乗ると線が途切れるため却下。表の背景として 1 枚だけ敷く。
- 空き枠を台帳の応答に同梱する: 台帳は「いま埋まっている事実」、空き枠は「これから置けるかの判断」で、要求元も更新の頻度も違うため却下。別の面にする。
- 担当が未定の予約を空き枠の計算から外す: 二重に入って当日に破綻するため却下。`target_id` が NULL でも枠を消費する。
- 台帳の日付移動を毎回サーバへ問い合わせず前後の日を先読みする: 台帳は書き換わり続ける面で古い内容を出す害が大きいため却下。移動のたびに取り直す。
- 枠の占有を「枠 1 本 = 1 行」の一意 index で止める: `staff.max_parallel_reservations` / `equipment.capacity` / 同時受付上限の 3 つが実効値 1 に固定され、画面で編集できるのに効かない設定になるため却下。同時受付上限 3 件の店で担当が未定の 2 件目が 409 になり、ウォークインの 2 人目を受け付けられなくなる。上限つきの条件付き INSERT にして、設定値をそのまま上限に渡す。

## 3. TASKS

- [ ] T-001: `packages/contracts/test/glasses_management.contract.test.ts` に台帳の契約テストを書く（`LedgerQuery` の `axis` / `filter` の既定と未知値、`LedgerView` の `serverNow` 必須、`LedgerLane.kind` の 4 値）。
- [ ] T-002: 同ファイルに空き枠の契約テストを書く（`AvailabilityQuery` の `purposeIds` 最大 5 件、`AvailabilityReason` の 11 値、`AvailabilitySlot.remaining >= 0`）。
- [ ] T-003: `test/availability.test.ts` に 8 条件の表駆動テストを書く（1 条件ずつ落として枠が消えることを 1 本ずつ）。Red のまま置く。
- [ ] T-004: `test/availability.time.test.ts` に境界値テストを書く（片付け 10分の「12:00 ちょうど」と「12:10」、休憩帯の 13:00 と 14:00、同時受付上限 3 件と 4 件目、JST の UTC 15:00 日跨ぎ）。時刻は必ず引数で注入する。
- [ ] T-005: `test/ledger.integration.test.ts` に 3 軸の応答テストを書く（担当が未定の擬似行、1 予約が 2 つの設備行に出る、リストの件数、取消済みを出さない）。
- [ ] T-006: `test/permissions.test.ts` に追加 3 ルートの行を足し、`test/tenant-isolation.test.ts` に他テナントの予約が混ざらないことを足す。
- [ ] T-007: `src/worker/db/schema.ts` に 4 表（`reservation_slot_locks` を含む）と index を足し、`db:generate` で `0002_*.sql` を作って `db:migrate:local` を通す。`reservation_slot_locks` の `(organization_id, store_id, kind, target_key, slot_start)` は**非一意**の複合 index にする（一意にすると同時受付上限と `capacity` が効かなくなる）。この表は決定ブリーフ §3 に無い表の追加なので、着手前に人の承認を取る（規約 10）。
- [ ] T-008: `packages/contracts/src/glasses_management.ts` に台帳・空き枠の Zod を足し、T-001/T-002 を Green にする。
- [ ] T-009: `src/worker/domain/availability.ts` を純関数として実装し、T-003/T-004 を Green にする。
- [ ] T-010: `src/worker/domain/ledger.ts` を純関数として実装し、`src/worker/index.ts` に 3 本のルートを足して T-005/T-006 を Green にする。
- [ ] T-011: 台帳の web unit テスト（`Timetable.test.tsx` / `NowLine.test.tsx`）を書く。現在時刻の線の位置が `serverNow` から算出されること、現在時刻が表示窓の外のときに線を引かないことを固定値で確かめる。
- [ ] T-012: 予約リストと詳細の web unit テスト（`LedgerList.test.tsx` / `ReservationPopover.test.tsx` / `OfflineBand.test.tsx`）を書く。
- [ ] T-013: 台帳のタイムテーブルを実装する。パス 1 の計画は「主役は台帳 1 枚 / 説明文は 2 つまで・各 1 行 / 状態の札は 3 つまで / 時間の目盛りは背景に 1 枚（`--color-grid` の 30分線・`--color-grid-hour` の 1時間線）／帯の出どころは `--color-pine`・`--color-web`・`--color-walkin` の 3 系統に文字を必ず添える／白い箱を並べず罫線だけで区切る」。空いた場所を埋めるために要素を足さない（下や右が空いているのは正しい状態）。任意値と Tailwind 既定パレットは使わない。台帳は `role="grid"` の格子として作り、2 列にまたがる帯は先頭セルに置いて `aria-colspan` で幅を伝える。埋まった枠は地に `--color-busy-soft` を敷き、文字を `--color-ink-muted` で書く。
- [ ] T-014: 現在時刻の線と「現在 11:08」の札を実装し、表示中の日付が本日でないときは出さない。
- [ ] T-015: 設備・場所別の並べ替えと、1 予約を複数行へ出す描画を実装する。
- [ ] T-016: 予約リストと絞り込みの札を実装する。
- [ ] T-017: 台帳を隠さず開く詳細（ポップオーバー）を実装する。押した帯の左端に矢印が付くこと、台帳の空いているところを押す・もう一度帯を押す・Esc のいずれでも閉じ、閉じたらフォーカスが元の帯へ戻り、閉じるためのその 1 回が新規予約にならないことまで含める。
- [ ] T-018: 通信断の帯を実装し、書き込みの操作を止める。
- [ ] T-019: `e2e/ledger.spec.ts` に `// @e2e-covers` を付けて AC と 1 対 1 で対応させる。
- [ ] T-020: モックの PNG（`docs/frontend/mockups/eyex/images/LEDGER-*.png`）と実装画面を突き合わせ、差分を `e2e/mock-compare.spec.ts` に記録する。
- [ ] T-021: `pnpm check` を緑にし、ステータスを Approved に上げてよいか人に確認する。
- [ ] T-022: 決定ブリーフ §11 の世界観データを seed として書く（`services/glasses_management/seed/`）。台帳の 12 件・担当が未定の 1 件・Web 由来の 1 件を含める。モック同士で食い違う値は LEDGER-STAFF を予約の正本として寄せる（佐藤 美咲の本日の担当 2 件、山口 真央 様は 8/27 10:30・中村 彩、相川 みどり 様は 13:00 の 20 分、ウォークイン 004 のご用件は「フレームの相談」）。
- [ ] T-023: `test/slot-locks.integration.test.ts` を書く。実 D1（vitest-pool-workers）に対して、上限つきの条件付き INSERT が上限ちょうどまで発火し、上限を越える 1 本目で `meta.changes === 0` になること、`target_key='unassigned'` のレーンが `store_slot_rules.max_parallel`（3）まで取れること、`equipment.capacity = 2` の設備が同じ枠で 2 件まで取れること、`(organization_id, store_id, kind, target_key, slot_start)` に一意制約が張られていないことを確かめる。この表へ書く経路そのものは `006-booking-flow` だが、上限の数え方は空き枠エンジンと同じなのでここで固定する。
