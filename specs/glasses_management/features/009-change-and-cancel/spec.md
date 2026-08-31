# 009-change-and-cancel: 予約の検索・変更・取消

- サービス: `glasses_management`
- ステータス: Approved

## 1. WHAT / WHY

**概要**: お客様から「日にちを変えたい」「やめたい」と言われたときに、受付スタッフが
お名前かお電話番号だけで目当ての 1 件にたどり着き、変わる前と後を並べて読み上げてから確定する
ところまでを担う。取り消しは戻せないので、既定の操作を「戻る」に置き、理由を残して実行する。

**ユーザーストーリー**:

- US-CHANGE-01: 受付スタッフとして、お電話を受けながら目当ての 1 件を当てるために、お名前・お電話番号・予約番号のどれからでも探せる画面がほしい。
- US-CHANGE-02: 受付スタッフとして、お客様に正しく読み上げるために、変わる行だけを塗り分けた変更前後の一覧がほしい。
- US-CHANGE-03: 受付スタッフとして、間違って取り消してしまわないために、理由を選ぶまで実行できず既定の操作が「戻る」になっている画面がほしい。
- US-CHANGE-04: 店長として、あとから経緯を説明できるように、誰がいつ何を変えたのかが残る仕組みがほしい。
- US-CHANGE-05: 受付スタッフとして、ほかの端末が先に直していても入力を捨てずに済むように、両方の内容を並べて選べる画面がほしい。

**ユースケース**:

- UC-CHANGE-01: 受付スタッフは、お名前・かな・お電話番号・予約番号から予約を探し、一覧と詳細を同時に見ることができる。
- UC-CHANGE-02: 受付スタッフは、結果が 0 件のとき、入れた条件を保ったまま、条件を 1 つ外した案とほかの探し方を受け取ることができる。
- UC-CHANGE-03: 受付スタッフは、いまのご予約を左に置いたまま、所要時間が収まる時刻だけから新しい日時を選ぶことができる。
- UC-CHANGE-04: 受付スタッフは、変更前と変更後を項目ごとに並べ、変わる行だけを見分けてから確定することができる。
- UC-CHANGE-05: 受付スタッフは、変更を確定し、変更後の姿とお客様にお伝えすることを 1 画面で確かめて終えることができる。
- UC-CHANGE-06: 受付スタッフは、日時を保ったまま担当と場所だけを置き直すことができる。
- UC-CHANGE-07: 受付スタッフは、理由を選んだうえで予約を取り消し、その枠をほかのお客様に案内できる状態に戻すことができる。
- UC-CHANGE-08: 受付スタッフは、ほかの端末が先に保存していたとき、両方の内容を並べて見比べ、どちらを残すかを選ぶことができる。
- UC-CHANGE-09: 受付スタッフは、変更先の枠を先に確保してから元の予約を切り替えることができる。
- UC-CHANGE-10: 店長は、変更・取消を実行した人・日時・変更前後を、あとから 1 件ずつたどることができる。

**受け入れ基準**:

- AC-CHANGE-01: Given 銀座店を選んで「予約を探す」を開いている, When 「お名前」に「田中」と入れる, Then 「結果 4件」と出て、1 行目に「8/27（木）11:00　田中 花子 様　4回目　メガネを新しく作る／佐藤 美咲」が並ぶ。
- AC-CHANGE-02: Given 「予約を探す」を開いている, When 「お名前」に「たなか はなこ」とかなで入れる, Then 漢字で登録された「田中 花子 様」のご予約が結果に出る。
- AC-CHANGE-03: Given 「予約を探す」を開いている, When 「お電話番号」に下 4 桁「5678」だけを入れる, Then 「田中 花子 様」のご予約が結果に出る。
- AC-CHANGE-04: Given 「予約を探す」を開いている, When 「予約番号」に「EY-2608-0142」を入れる, Then 結果は 1 件になり、右の詳細に「EY-2608-0142」と「お電話でのご予約」が出る。
- AC-CHANGE-05: Given 銀座店を選んでいて、丸の内店にも同じお名前のご予約がある, When 「お名前」に「田中」と入れて探す, Then 丸の内店のご予約は結果に出ず、銀座店のご予約だけが並ぶ。
- AC-CHANGE-06: Given 「結果 4件」が出ている, When 絞り込みの「今日」を押す, Then 8/27 のご予約 3 件だけが残り、9/3 のご予約は消える。
- AC-CHANGE-07: Given 取り消し済みのご予約が結果に出ていない, When 絞り込みの「取消済み」を押す, Then 取り消されたご予約が結果に加わる。
- AC-CHANGE-08: Given 「結果 4件」が並んでいる, When 1 行目の「田中 花子 様」を押す, Then 一覧は左に残ったまま、右に「8月27日（木）11:00–12:00」「担当と場所　佐藤 美咲」「録音を聞く」「変更の内容は、お客様にお伝えしてから確定します。」が出る。
- AC-CHANGE-09: Given 「お名前」に「たなか はなこ」、期間に「8/27〜8/31」、出どころに「Web予約だけ」を入れている, When 探す, Then 「結果 0件」と「入力した条件はそのまま残しています。」が出て、右に「この条件では、ご予約が見つかりませんでした」と件数つきの案が 3 つ、続いて「ほかの探し方」が出る。
- AC-CHANGE-10: Given 「条件をひとつ外すと見つかります」に「5件　「Web予約だけ」を外す」が出ている, When その案を押す, Then 出どころの絞り込みだけが外れて「結果 5件」になり、ほかの条件は残ったままになる。
- AC-CHANGE-11: Given 「EY-2608-0142」を選んで「日時を変える」を押した, When 8月27日を選ぶ, Then 「60分の枠が取れる時刻だけを出しています。」と出て、候補は「10:00　受付できます」のように時刻ごとに受けられるかどうかが文字で添い、「15:30　満席」は押せない。
- AC-CHANGE-12: Given 14:00 を選んで「14:00 から60分、佐藤 美咲／視力測定機 A を確保します。」が出ている, When 別の端末が佐藤 美咲の別のご予約を同じ 8月27日 14:00 へ移そうとする, Then その端末では 14:00 が「満席」になって押せず、「EY-2608-0142」はまだ 11:00–12:00 のままである。
- AC-CHANGE-13: Given 14:00 を選んで「変更内容を確認する」を押した, When 差分の画面が出る, Then 「この内容に変更します」「変わる行だけ色を付けています」と出て、「お日にちとお時間」と「場所」の行に「変更」の札が付き、「ご用件」と「担当」の行には「変更」の札が付かない。
- AC-CHANGE-14: Given 差分の画面を見ている, When 「戻って直す」で日時を選ぶ画面へ戻り、続けてサイドバーの「予約を探す」から同じご予約をもう一度開く, Then 日時は「8月27日（木）11:00–12:00」のままで、変更は残っていない。
- AC-CHANGE-15: Given 差分の画面を見ている, When 「変更を確定する」を押す, Then 「ご予約の変更を承りました」と「予約番号は変わりません」が出て、予約番号は「EY-2608-0142」のまま、変更後の日時に「変更前は 11:00–12:00」が添う。
- AC-CHANGE-16: Given 「取り消す」を押して「この予約を取り消します」「まだ取り消していません」が出ている, When 理由を 1 つも選ばずに「この予約を取り消す」を押す, Then 取り消しは行われず、ご予約は「8月27日（木）11:00–12:00」のまま残る。
- AC-CHANGE-17: Given 理由に「お客様のご都合」を選んで「この予約を取り消す」を押した, When 完了の画面を読み、続けて佐藤 美咲の別のご予約で「日時を変える」を開いて 8月27日を選ぶ, Then 「ご予約を取り消しました」「この枠は、ほかのお客様にご案内できる状態に戻りました。」と操作した店舗・端末・時刻・操作者の 1 行が出て、11:00 が「受付できます」として候補に出て押せる。
- AC-CHANGE-18: Given 変更を確定した, When 受付履歴でそのご予約の「そのあとの変更」を開く, Then 変更した時刻・操作した人の名前・「ご来店時刻を 11:00 から 14:00 へ」のように変更前後が 1 行で並ぶ。
- AC-CHANGE-19: Given 自分の端末で 8月28日（金）10:30–11:30 に直している最中に、ほかの端末が同じご予約を 8月27日（木）14:00–15:00 で保存した, When 「変更を確定する」を押す, Then 「同じご予約を、ほかの端末でも直していました」と左に相手の内容・右に自分の内容が並び、どちらの内容もまだ保存されていない。
- AC-CHANGE-20: Given 「同じご予約を、ほかの端末でも直していました」が出ている, When 「あなたの内容で上書きする」を押す, Then 送る前に「8月28日（金）10:30–11:30」の空きが当て直され、空いていればご予約はその内容になって「ご予約の変更を承りました」が出る。
- AC-CHANGE-21: Given 「取り消す」を押して取り消しの画面が開いた, When 画面に入った直後の焦点を確かめる, Then 焦点は「取り消さずに戻る」に当たり、「この予約を取り消します」「まだ取り消していません」が読み上げられる。
- AC-CHANGE-22: Given 「結果 0件」になった, When 読み上げを聞く, Then 入力の手を止めずに 0 件になったことが読み上げられ、条件を 1 つ外す案は「5件　「Web予約だけ」を外す」のように件数を含む名前の押せる操作として読まれる。
- AC-CHANGE-23: Given 「同じご予約を、ほかの端末でも直していました」が出ている, When 「中村 彩 の内容を残す」を押す, Then ご予約は相手の内容「8月27日（木）14:00–15:00」になり、自分の入力を捨てたことが文で出る。
- AC-CHANGE-24: Given 「結果 0件」で「ほかの探し方」が出ている, When 「顧客台帳で調べる」を押す, Then 入れたお名前を引き継いだ顧客台帳が開き、探し直しを最初からやり直さずに済む。
- AC-CHANGE-25: Given 「EY-2608-0142」（8月27日 11:00–12:00）で「日時を変える」を開いて 8月27日を選ぶ, When 候補を読む, Then 先頭に「11:00　いまのまま」が出て、担当だけを変えたいときに時刻を選び直さずに進める。
- AC-CHANGE-26: Given 14:00 を選んで差分を確かめているあいだに、別の端末がその枠を埋めた, When 「変更を確定する」を押す, Then 変更は行われず、BOOK-CONFLICT と同じ形で代わりの時刻と担当が出て、いまのご予約は「8月27日（木）11:00–12:00」のまま残る。
- AC-CHANGE-27: Given ほかの端末が先に同じご予約を保存して版が進んでいる, When 古い版のまま「変更を確定する」または「この予約を取り消す」を送る, Then 409 が返るだけでなく、そのご予約の日時・ご用件・担当・場所・枠の押さえ・取消の状態のどれも 1 行も書き換わっておらず、先に保存した端末の内容がそのまま残る。

**スコープ外**: 予約を新しく取る 5 工程と重なり警告（`006-booking-flow`）、台帳の描画とドラッグ移動（`005-availability-and-ledger`）、
受付履歴の一覧そのもの（`008-reception-and-walkin`）、受付の録音と再生（`010-recording`）、
お客様側の Web からの変更・取消（`011-web-booking`）、取消率の集計（`012-analytics`）、
共有端末・個人モードと監査の一覧画面（`013-terminals-and-audit`）。

**決めたこと**（第2巡の検査で決着させた。根拠は承認済みモックと決定ブリーフ）:

- 変更のとき、いま入っているご予約自身の時刻を候補の先頭に「いまのまま」として残す。担当だけを変えたいときに時刻を選び直させない。
- 変更を確定する瞬間に変更先の枠が埋まっていたときは、BOOK-CONFLICT と同じ形（代わりの時刻・担当を出す）に落とす。EX-CONFLICT の 4 つの出口（相手を残す／自分の内容で上書きする／1 項目ずつ選ぶ／取り直す）はいずれも、送る前に空き枠を当て直してから確定する。とくに「1 項目ずつ選ぶ」は相手の日時と自分の担当を混ぜられ、その組み合わせをどちらの端末も検証していないため、当て直しを省けない。
- 「担当・場所を変える」は BOOK-03-SLOT-STAFF / BOOK-03b-SLOT-RESOURCE を再利用する。専用画面は起こさない（選ぶものが同じで、覚え直しが要らない）。
- 「この予約を取り消す」のあとの完了画面は CHANGE-DONE を取消向けの文言で流用する。文は「ご予約を取り消しました」＋「この枠は、ほかのお客様にご案内できる状態に戻りました。」＋操作した店舗・端末・時刻・操作者の 1 行。CHANGE-CANCEL の予告（「取り消すと、この枠はすぐほかのお客様にご案内できる状態になります。」）の完了形にする。
- 取り消しの理由は必須で、未選択から始める。既定で「お客様のご都合」を選んでおくと、店舗都合や重複の取り消しが押し間違いでお客様都合として残り、ANALYTICS-CANCEL の内訳と受付履歴の説明が実態とずれる。「ご来店がなかった」を選んだものだけを `no_show`、それ以外を `cancelled` にする。
- 出どころが Web 予約のご予約を店頭で変更・取り消したときのお客様へのご連絡は、**いまの契約では送れない**。`packages/contracts/src/notification.ts` の `NotificationJob` は `reservation.confirmed` / `reservation.management_code_issued` / `reservation.management_code_reissued` の 3 型の `z.strictObject` で、取消・変更の型が無く、payload に別のキーも混ぜられない。型を足すのは別サービスの契約変更（人間の承認事項）なので、**承認が下りるまで変更・取消のメールを送らない**。完了画面に「お客様へのご連絡は、お電話でお願いします。」を出す（`011-web-booking` と同じ扱い）。日時だけを変えたときは `reservation.confirmed` の送り直しで賄い、新しい型を足さない。
- サイドバーの行き先の名前は「予約を探す」に揃える（面の名前「予約を変更する」とは別の 2 段として扱う）。

**不明点**:

- `[要確認: Q-06 — いまの前提で進める]` 変更先の枠の仮の押さえ（7 分）は、残り時間を画面に出し、残り 60 秒で警告して 1 回だけ延ばせるようにする。`006-booking-flow` の同じ論点と 1 か所で決める（`design/09-open-questions.md` の Q-06）。

## 2. HOW

**触るファイル**:

- `packages/contracts/src/glasses_management.ts` — `ReservationSearchQuery` / `ReservationList` / `ReservationSummary` / `SearchRelaxation` / `ReservationChangeInput` / `ReservationCancelInput` / `ReservationChangeHistory` / `HoldInput` / `Hold`
- `services/glasses_management/src/worker/domain/reservation-search.ts` — 検索条件の解決と、0 件のときの緩和候補（外す条件と件数）の組み立て
- `services/glasses_management/src/worker/domain/reservation-change.ts` — 変更前後の差分・楽観ロックによる競合検知・取消
- `services/glasses_management/src/worker/domain/availability.ts` — 変更対象の予約を除外して空き枠を数える引数を足す（`005` で作った純関数の拡張）
- `services/glasses_management/src/worker/index.ts` — 予約の一覧・変更・取消・経緯の 4 ルート（仮の押さえは `006-booking-flow` が作った `POST /api/staff/holds` / `DELETE /api/staff/holds/:holdId` を変更の面から使う。ここでは新設しない）
- `services/glasses_management/src/web/search/` — CHANGE-SEARCH / CHANGE-DATETIME / CHANGE-DIFF / CHANGE-CANCEL / CHANGE-DONE / EX-EMPTY-SEARCH / EX-CONFLICT の 7 面
- `services/glasses_management/test/reservation-search.test.ts` — 検索と緩和候補
- `services/glasses_management/test/reservation-change.integration.test.ts` — 変更・取消の通し
- `services/glasses_management/test/reservation-change.time.test.ts` — 仮の押さえの期限と JST 日跨ぎの期間絞り込み
- `services/glasses_management/test/permissions.test.ts` / `services/glasses_management/test/tenant-isolation.test.ts` — 足したルートの行を追加
- `services/glasses_management/e2e/change-and-cancel.spec.ts` — AC と 1 対 1

**データモデル差分**: 新しい表・列は足さない。`reservations`（`status` / `version` / `cancelled_at` / `cancel_reason`）、
`reservation_purposes`、`reservation_assignments`、`reservation_slot_locks`、`customers`、`audit_events`、
`idempotency_records` を読み書きする（`reservation_slot_locks` は `005-availability-and-ledger` が作る表で、
変更のときは古い枠を DELETE して新しい枠を INSERT し、取消のときは DELETE する）。
検索は `reservations_org_store_start_idx` / `reservations_org_code_idx` / `customers_org_phone_idx` / `customers_org_kana_idx` に乗る形だけを書く。

**版の条件はバッチの全文に配り、版を進める文を最後に置く。** D1 のバッチは、0 行しか当たらない `UPDATE` では
中断せずに後続の文を commit する（`meta.changes` が `[0, 1]` になり、トランザクションは成功する）。
`UPDATE reservations ... WHERE version = ?` をバッチの 1 文目に置いて 409 を返す作りにすると、
版が合わなかった端末が「何も起きていません」と言われながら `reservation_assignments` と `reservation_slot_locks` だけを
自分の値へ書き換えてしまう。取消ではさらに直接的で、予約は `confirmed` のまま枠のロックだけが消え、
**409 が二重予約を作る**。そこで置き換え・削除・追記のどの文にも
`WHERE EXISTS (SELECT 1 FROM reservations WHERE id = ?1 AND version = ?2)` を付け、
`version` を +1 する `UPDATE reservations` を**バッチの最後**に置く。バッチ全体が 1 トランザクションなので全文が同じ版を見て、
**全部通るか 1 行も通らないかのどちらか**になる。409 `version_conflict` の判定は最後の文の `meta.changes === 0` で行う。
監査の追記にも同じガードを付ける（条件が外れたのに監査だけ残ると、起きなかった操作が記録に残る）。

変更先の枠の仮の押さえは D1 に置かず、KV `SHORT_LIVED` に短命キーとして置く。鍵は
`hold:<orgId>:<storeId>:<holdId>` の 1 通りに揃える（`DELETE /api/staff/holds/:holdId` が `holdId` から鍵を組み立てられる
唯一の形である）。空き枠エンジンが要る `kind` / `targetId` / `startsAt` / `receptionSessionId` は
`KV.put` の `metadata` に載せ、1 回の `KV.list` で押さえの一覧と中身をまとめて受け取る。
**押さえは排他の一次手段ではない。** KV に CAS が無いので「取れなかった」を判定できず、
`POST /api/staff/holds` は常に 200 を返す（409 `slot_taken` は返さない）。二重予約を止めるのは確定時の
`reservation_slot_locks` だけで、AC-CHANGE-12 の「別の端末では 14:00 が満席になる」は、
空き枠の応答が押さえを塞がりとして返すことで満たす。
KV の list は無料枠で 1,000 回/日しかないので、押さえを読むのは業務面の空き枠計算だけとし、
公開面（`/api/public/**`、`011-web-booking`）では読まない。

**却下した代替案**:

- 変更を「取り消し + 新規作成」で表す: 予約番号が変わり、お客様への説明と来店回数・分析の連続性が切れるため却下。
- 差分を出さずにその場で保存する: 読み上げの根拠が画面に残らず、言い間違いを検知できないため却下。
- 競合を後勝ちで自動上書きする: 相手の保存が黙って消えるため却下。両方を並べて選ばせる。
- 元の予約を先に空けてから新しい枠を取る: 空けた瞬間に他端末へ枠を取られると戻せないため却下。先に押さえてから切り替える。
- 検索の既定を全店舗横断にする: 選択中店舗の業務と混ざり、誤って他店舗の予約を触るため却下。0 件のときだけ広げる導線を出す。
- 取消をワンタップの確認ダイアログで済ませる: 理由が残らず分析に使えないため却下。
- 取消の理由を「お客様のご都合」で選択済みにして始める: 店舗都合と重複の取り消しが押し間違いでお客様都合として残り、分析の内訳が実態とずれるため却下。未選択から始め、1 つ選ぶまで実行できないようにする。
- 競合を解いた内容をそのまま保存する: 版の競合を解いた結果が枠の競合に当たることがあるため却下。送る前に必ず空き枠を当て直す。

## 3. TASKS

- [ ] T-001: `packages/contracts/test/glasses_management.contract.test.ts` に検索・変更・取消の契約テストを足す（境界値と未知キー拒否まで）。
- [ ] T-002: `test/reservation-search.test.ts` を書く（名前・かな・電話下 4 桁・予約番号・店舗固定・期間・状態）。
- [ ] T-003: `test/reservation-search.test.ts` に 0 件のときの緩和候補（外す条件と件数の一致）を足す。
- [ ] T-004: `test/reservation-change.integration.test.ts` を書く（枠の確保 → 切り替え → 確定、予約番号が変わらないこと）。
- [ ] T-005: `test/reservation-change.integration.test.ts` に競合（先に保存された側が勝ち、選ぶまで書き換わらない）と取消（理由必須・枠の解放）を足す。
- [ ] T-005b: `test/reservation-change.integration.test.ts` に「版が合わないときに 1 行も書き換わっていない」ことを足す（変更と取消の両方。`reservation_assignments` が先に保存した側の値のままであること、`reservation_slot_locks` の行が残っていること、監査の行が増えていないことを検証する。409 が返ることだけを見て終わらせない）（AC-CHANGE-27）。
- [ ] T-006: `test/reservation-change.time.test.ts` を書く（仮の押さえの期限ちょうどと +1 秒、JST 日跨ぎの期間絞り込み。時刻は引数で注入）。
- [ ] T-007: `test/permissions.test.ts` と `test/tenant-isolation.test.ts` にこの feature のルートの行を足す。
- [ ] T-008: `src/worker/domain/reservation-search.ts` を実装する（Green）。
- [ ] T-009: `src/worker/domain/reservation-change.ts` を実装する（差分・競合検知・取消）（Green）。
- [ ] T-010: `src/worker/domain/availability.ts` に変更対象を除外する引数を足す（Green）。
- [ ] T-011: `src/worker/index.ts` に一覧・変更・取消・経緯のルートと仮の押さえを足す（Green）。
- [ ] T-012: UI のパス 1（トークン計画）を書く。計画は「左は探す・右は決める / 変わるものだけ緑地 / 危険な操作は右端で赤 / 色だけで状態を伝えず必ず文字を添える」。7 面すべてに共通で、説明文は 2 つまで・各 1 行、状態の札は 3 つまでにし、**空いた場所を埋めるために要素を足さない**（EX-EMPTY-SEARCH の下半分が空いているのは正しい状態）。
- [ ] T-013: `src/web/search/*.test.tsx` を書く（検索の一覧と詳細、差分の塗り分け、取消の理由必須、競合の左右、取消の画面の初期フォーカスが「取り消さずに戻る」に当たること、0 件が読み上げに届くこと）（Red）。
- [ ] T-014: CHANGE-SEARCH と EX-EMPTY-SEARCH を実装する。
- [ ] T-015: CHANGE-DATETIME と CHANGE-DIFF を実装する。
- [ ] T-016: CHANGE-CANCEL と CHANGE-DONE を実装する。
- [ ] T-017: EX-CONFLICT を実装する。
- [ ] T-018: `e2e/change-and-cancel.spec.ts` に `@e2e-covers` を付けて AC と 1 対 1 で対応させる。
- [ ] T-019: モックの PNG と実装画面を Playwright で突き合わせ、差分を `e2e/mock-compare.spec.ts` に記録する。
- [ ] T-020: `pnpm check` を緑にする。
