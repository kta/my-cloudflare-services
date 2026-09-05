# 006-booking-flow: 電話・店頭からの予約受付

- サービス: `glasses_management`
- ステータス: Approved

## 1. WHAT / WHY

**概要**: お電話や店頭で伺ったご予約を、会話の順のまま 1 工程 1 問で受ける 5 工程
（1 日時 / 2 ご来店の目的 / 3 担当と場所 / 4 お客様 / 5 ご確認）。
希望の日時はもう決まっている前提で、決めるのは目的と担当・場所とお客様だけにする。

**ユーザーストーリー**:

- US-BOOK-01: 受付スタッフとして、聞き漏らさないために、お客様と話す順のまま 1 画面 1 問で伺える受付がほしい。
- US-BOOK-02: 受付スタッフとして、あとで断らずに済むように、目的を伺った時点でその時刻に収まるかを知り、収まらないなら言い換えられる時刻の候補がほしい。
- US-BOOK-03: 受付スタッフとして、電話をつないだまま調整するために、置いたご予約を指でつかんで別の担当・時刻へ動かせるようにしたい。
- US-BOOK-04: 受付スタッフとして、二重のご予約を作らないために、先約と重なったらその場で気づき、同じ時刻で受けられる別の担当・設備を出してほしい。
- US-BOOK-05: 受付スタッフとして、受話器を持ったまま片手で番号を打ちたい。両手をふさぐと伺ったことを書き留められないため。
- US-BOOK-06: 受付スタッフとして、言い違いをその場で正すために、確定の前に復唱し、言い直しがあった箇所だけへ戻りたい。

**ユースケース**:

- UC-BOOK-01: 受付スタッフは、お日にちとお時間を伺って選ぶことができる。
- UC-BOOK-02: 受付スタッフは、ご来店の目的を伺い、お取りする時間を決めることができる。
- UC-BOOK-03: 受付スタッフは、伺った時刻に所要が収まらないと分かったとき、同じ画面で代わりの時刻へ言い換えることができる。
- UC-BOOK-04: 受付スタッフは、担当を決め、先約との重なりをその場で知ることができる。
- UC-BOOK-05: 受付スタッフは、縦軸を設備・場所に入れ替えて、使う設備から決めることができる。
- UC-BOOK-06: 受付スタッフは、置いたご予約を指でつかんで別の担当・時刻へ動かすことができる。
- UC-BOOK-07: 受付スタッフは、担当・設備を未定のままご予約を進めることができる。
- UC-BOOK-08: 受付スタッフは、お客様のお電話番号をテンキーで伺うことができる。
- UC-BOOK-09: 受付スタッフは、お電話番号を伺えないお客様を、お名前とふりがなだけで進めることができる。
- UC-BOOK-10: 受付スタッフは、ご要望を手書きのかたちのまま残すことができる。
- UC-BOOK-11: 受付スタッフは、復唱してからご予約を確定し、予約番号を伝えることができる。
- UC-BOOK-12: 受付スタッフは、確定の瞬間に枠が埋まっていたとき、伺った内容を保ったまま選び直すことができる。
- UC-BOOK-13: 受付スタッフは、入力を失わずに 1 つ前の工程へ戻ってやり直すことができる。
- UC-BOOK-14: 受付スタッフは、受付をやめる前に確認を受けてから破棄することができる。
- UC-BOOK-15: 受付スタッフは、いまどの工程にいるかを読み上げでも追え、進めないときはその理由を知ることができる。

**受け入れ基準**:

- AC-BOOK-01: Given 新しい予約を取り始めた, When 工程 1 で日付と時刻をどちらも選んでいない, Then 「次へ進む」は押せず、定休日の札には「定休」、埋まっている時刻の札には「満席」と書かれていて押せず、日付と時刻を 1 つずつ選ぶと「次へ進む」が押せるようになる。
- AC-BOOK-02: Given 工程 2 を開いている, When 「メガネを新しく作る」を押す, Then その札に「✓ 選んでいます」が付き、「お取りする時間」の「60分 標準」が選ばれ、右のまとめに「11:00–12:00 で受け付けられます。」が出て「次へ進む」が押せる。
- AC-BOOK-03: Given 工程 2 で時刻に収まらない目的を選んだ, When 画面が更新される, Then 「11:00 から60分の受付ができません」と収まらない理由が 1 文で出て、代わりに取れる時刻が 3 つまで並び、右のまとめのご来店時刻に「受付できません」の札が付き、「次へ進む」は押せない。代わりに取れる時刻が 0 件のときは欄を空のまま残さず、「この日は 60分 の枠が空いていません。」と理由を 1 文で出したうえで「別の日を選ぶ」を 1 つ出し、行き止まりにしない。
- AC-BOOK-04: Given AC-BOOK-03（前掲）の状態, When 代わりの時刻「13:00–14:00」を押す, Then 選んでいた目的と所要時間はそのまま残り、時刻だけが差し替わって「次へ進む」が押せるようになる。
- AC-BOOK-05: Given 工程 3 を開き、希望時刻の位置にご予約の帯が置かれている, When その担当に先約がある, Then 先約の帯の上にこのご予約の帯が重なって出て「重なっています」と書かれ、右に「佐藤 美咲 に 11:00 の先約があります」と出て、「次へ進む」は押せない。
- AC-BOOK-06: Given AC-BOOK-05（前掲）の状態, When 右の「同じ 11:00 で受けられる担当」の候補「小林 学」を押す, Then 帯がその担当の行へ移って重なりが無くなり、「次へ進む」が押せるようになる。
- AC-BOOK-07: Given 工程 3 を担当者の軸で開いている, When 「設備・場所」に切り替える, Then 縦軸が設備・場所に入れ替わって右に「同じ 11:00 で使える設備」が出て、「担当者」に戻しても選んでいた担当が保たれている。
- AC-BOOK-08: Given 工程 3 でご予約の帯が置かれている, When 帯のつまみをつかんで別の担当の 13:00 の枠まで運ぶ, Then もとの場所が薄く残り、置く先に点線の枠と「13:00–14:00 へ」が出て、指を離すとその担当・時刻で確保され、「もとの 11:00 に戻す」を押すと元の位置へ戻る。置けない場所（営業時間の外・その担当の勤務の外・点検中の設備）へ運んだときは点線の枠を出さず、「ここには置けません（視力測定機 B は点検中です）」と理由を添えて、指を離すと元の位置へ戻る。
- AC-BOOK-09: Given 工程 3 で重なりが残っている, When 「担当はあとで決める」または「設備はあとで決める」を押す, Then 押した側を未定にしたまま工程 4 へ進み、確定後の予約は担当が「決めてください」、設備が「あとで決める」と表示される。未定でも枠は消費する（`reservation_assignments.target_id` を NULL のまま行を作る）ので、二重に入らない。
- AC-BOOK-10: Given 工程 4 でお電話番号の欄を押した, When テンキーで「090-1234-5」まで打つ, Then 欄の右に「あと3桁」と出て「完了」は押せず「次へ進む」も押せない状態が続き、残り 3 桁を打つと「完了」が押せるようになる。
- AC-BOOK-11: Given 工程 4 を開いている, When お電話番号を伺えないままお名前「田中 花子」とふりがな「たなか はなこ」だけを入れる, Then 「次へ進む」が押せるようになり、工程 5 の「確保する内容」にそのお名前が出る。
- AC-BOOK-12: Given 工程 4 を開いている, When 「手書きで書く」を押して用紙に書き、「手書きのまま残す」を押す, Then 文字に変換しないままご要望が残り、記入した人と時刻が添えられる。「文字に変換する」のボタンは出さない（無料枠の構成にサーバ側の文字認識を置かず、端末側の手書き認識も持たないため、押しても何も起きないボタンを画面に出さない）。読み取った文字を人が打ち直す欄は `007-customer-records` の手書きメモ側（AC-CUST-19）に置く。用紙の上をなぞっている間は背後の画面がスクロールせず、手書きが使えない人は同じ画面の「キーボードで入力」から同じご要望を残せる。
- AC-BOOK-13: Given 工程 5 を開いている, When 復唱の文を読み上げて「復唱を終えて予約を確定する」を押す, Then 復唱の文に工程 1 で選んだ日付と時刻・工程 2 で決めた所要時間・工程 4 で伺ったお名前とお電話番号が入っており、ご来店の目的は**工程 2 で押した札と同じ店内の名前（`name_internal`）のまま**読み上げられ（複数選んだときは「と」でつなぐ）、「ご予約を承りました」と `EY-2608-0142` の形の予約番号が出る。台帳の帯だけが短い名前（`name_short`）を使い、復唱・詳細・受付は `name_internal` に揃えるので、お客様と店員の間で言葉がずれない。BOOK-06-DONE に「控えは 090-1234-5678 へお送りしました。」は出さない — notifier はメールだけを送り、`to` はメールアドレス型なので、お電話番号へ控えを送る手立てが無い（`design/04-api.md` §7）。代わりに「予約番号 EY-2608-0142 をお控えいただくようお伝えください」を出す。
- AC-BOOK-14: Given 工程 5 で確定を押した, When 続けてもう一度確定を押す, Then 予約は 1 件しかできず、同じ予約番号が返る。
- AC-BOOK-15: Given 工程 5 で確定を押した, When その枠がほかの端末で先に確定されていた, Then 「この枠は、ほかの端末で先に確定されました」と出て、右のまとめの埋まった時刻に取り消し線と「埋まりました」の札が付き、伺った内容は残ったまま、同じ担当で案内できる時刻 3 つと担当を入れ替える案 1 つが並び、どれかを選ぶまで「次へ進む」は押せない。
- AC-BOOK-16: Given 工程 4 まで入力した, When 工程の帯の左の「‹」で工程 3 へ戻る, Then 工程 3 で選んでいた担当が選ばれたままで、もう一度工程 4 へ進むと打ち込んだお電話番号とお名前が残っている。
- AC-BOOK-17: Given 受付の途中である, When 上のバーの「やめる」を押す, Then 「入力をやめますか」の確認が **2 択**（「入力をやめる」／「続ける」）で出て、「続ける」を選ぶとその工程に留まり、「入力をやめる」を選ぶとトップへ戻って受付が破棄として閉じる。伺った内容は消えるが、録音は捨てずに `discarded` として残す（破棄した受付も記録に残す）。
- AC-BOOK-18: Given 受付を始めた, When 工程 1 から工程 5 まで進める, Then どの工程でも下端の工程の帯の中に**録音の表示を置く場所が同じ位置で確保されて**いて、工程を移っても位置が動かず、キーボードが出る欄でも隠れない。録音そのものと経過時間を入れるのは `010-recording`（AC-REC-01）で、この feature は器だけを作る。マイクの許可は Safari の制約から指の操作を起点にする必要があるので、**「新しい予約を取る」を押したその操作の中で求める**（許可の取得と失敗の面は `010-recording`）。
- AC-BOOK-19: Given 工程 4 を開いている, When 工程の帯を読み上げでたどる, Then 「予約の工程　全5工程のうち4つ目」のように順番といまの位置が読まれ、済んだ工程の札は押せる操作としては現れない（戻るのは左端の「‹」だけ）。「次へ進む」が押せないときは、押せない理由（「お客様が決まると進めます」など）がその操作の名前か説明として必ず読まれる。
- AC-BOOK-20: Given 工程 4 でお電話番号の欄を押した, When テンキーの数字を押す, Then iPadOS のソフトキーボードは出ずに数字がその場で欄に入り、下端の工程の帯と録音の表示はキーボードに覆われないまま見えている。
- AC-BOOK-21: Given 工程 4 でお名前に「たなか」と打って変換している, When 変換が確定するまでの間, Then ふりがなの欄に未確定の文字は入らず、確定した時点で 1 度だけ埋まり、人が一度でも直したふりがなはそのあと自動で上書きされない。
- AC-BOOK-22: Given 2 台の端末が同じ担当・同じ 11:00 の枠を選んで工程 5 を開いている, When ほぼ同時に「復唱を終えて予約を確定する」を押す, Then 成立するのは一方だけで、もう一方は 409 `slot_taken` を受けて AC-BOOK-15 の面（BOOK-CONFLICT）に落ち、伺った内容は残っている。落ちた側では `reservations` / `reservation_purposes` / `reservation_assignments` / `audit_events` のいずれにも行が増えていない。同時受付の上限が 3 件の店で担当を未定にしたまま同じ時刻へ 2 件目・3 件目を確定するときは、上限に届いていないので**成立する**（枠 1 本 = 1 行では止めない）。

**スコープ外**: 空き枠エンジンそのものと台帳の描画（`005-availability-and-ledger`）、
お電話番号から過去のご来店を推定する候補の面・顧客の新規登録・統合・顧客台帳側の手書き（`007-customer-records`。
この feature はお名前とお電話番号を伺って予約に残すところまでで、顧客台帳とは結びつけない）、
録音の取得・R2 への保存・保持期限・失敗と再送とマイク拒否の面（`010-recording`。この feature は工程の帯の中に置き場所を空け、
マイクの許可を求める起点だけを持つ）、手書きを文字へ変換する処理（実装対象から外す。BOOK-04d-HANDWRITE の
「文字に変換する」のボタンは出さない）、
来店受付とウォークイン（`008-reception-and-walkin`）、予約の変更と取り消し（`009-change-and-cancel`）、
お客様向け Web 予約（`011-web-booking`）。

**不明点**:

- `[要確認: Q-06 — いまの前提（端末の自動ロック 120 秒と個人モードの寿命 120 秒は「必須」として警告なしで切る。枠の仮押さえ 420 秒は残り時間を画面に出し、残り 60 秒で警告して 1 回だけ延ばせるようにする）で進める。延長を認めるなら `PATCH /api/staff/holds/:holdId` が 1 本増えるが、未決の分岐なので `design/04-api.md` §3 の表には載せない]`

## 2. HOW

**触るファイル**:

- `packages/contracts/src/glasses_management.ts` — `HoldInput` / `Hold` / `StaffReservationCreate` / `ReservationDetail` / `ReservationPurposeLine` / `ReservationAssignment`
- `services/glasses_management/src/worker/db/schema.ts` — `audit_events` / `idempotency_records` / `reception_sessions`
- `services/glasses_management/src/worker/domain/booking.ts` — 割り当ての組み立て・枠の占有行の組み立て・監査への追記（**確定時の枠の再検査は置かない**。D1 の `db.batch()` は同じバッチの中で読んで判定できないため）
- `services/glasses_management/src/worker/domain/holds.ts` — 仮の押さえ（KV `SHORT_LIVED`。鍵は `hold:<orgId>:<storeId>:<holdId>`、metadata に `{ kind, targetId, startsAt, receptionSessionId }`）
- `services/glasses_management/src/worker/db/constraint.ts` — D1 のエラー文字列から違反した表名を取り出す唯一の場所（`constraintTable(err): string | null`）
- `services/glasses_management/src/worker/domain/reservation-code.ts` — `EY-YYMM-NNNN` の採番（組織 × `YYMM` 内の連番・衝突時は 5 回まで再試行）
- `services/glasses_management/src/worker/domain/idempotency.ts` — `Idempotency-Key` の記録と再生
- `services/glasses_management/src/worker/index.ts` — `POST /api/staff/holds` / `DELETE /api/staff/holds/:holdId` / `POST /api/staff/reservations`
- `services/glasses_management/src/web/book/` — 5 工程の画面（`/book/datetime` `/book/purpose` `/book/slot` `/book/customer` `/book/confirm` `/book/done`）と工程の帯
- `services/glasses_management/test/booking.integration.test.ts` / `booking.time.test.ts` / `reservation-code.test.ts` / `permissions.test.ts` / `tenant-isolation.test.ts`
- `services/glasses_management/src/web/book/*.test.tsx`
- `services/glasses_management/e2e/booking-flow.spec.ts`

**データモデル差分**: `audit_events` / `idempotency_records` / `reception_sessions` の 3 表を新設する（`design/03-data-model.md` §12 の `0003_*.sql`）。
`reservation_slot_locks` は `005-availability-and-ledger` が P2 で作った表を、この feature が初めて書く（ここでは新設しない）。
1 予約分は `reservations` / `reservation_purposes` / `reservation_assignments` / `reservation_slot_locks` と `audit_events` を
`db.batch()` でまとめて書き、確定の応答は `idempotency_records` に残す。口頭のご要望は `reservations.note_customer` へ入れる。
担当・設備が未定のときは `reservation_assignments.target_id` を `null` にしたまま行を作る（枠は消費する。
`reservation_slot_locks.target_key` は `unassigned` の固定値）。仮の押さえは D1 に表を足さず KV `SHORT_LIVED` に置く。

**枠が取れたかどうかは、確定のバッチの中だけで決める。** `reservation_slot_locks` への INSERT は
`005-availability-and-ledger` の HOW に書いた**上限つきの条件付き INSERT**（`INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < ?上限`）で
行い、発火したかどうかを `meta.changes` で読む。**後続の文（`reservations` / `reservation_purposes` /
`reservation_assignments` / `audit_events` の INSERT）はすべて
`WHERE EXISTS (SELECT 1 FROM reservation_slot_locks WHERE reservation_id = ?)` でガードする。**
D1 の `db.batch()` は 0 行しか当たらない文を「失敗」と見なさずバッチを中断しないので、ガードしないと
「枠は取れていないのに予約本体だけが書かれた」状態ができる。占有行が 1 本も入らなかったときは 409 `slot_taken` を返し、
そのとき**予約は 1 行も書かれていない**。確定前に枠を読み直す再検査は置かない（読んでから書くまでに窓が空くため）。

**バッチが `UNIQUE` 違反で落ちたときの分岐**は `src/worker/db/constraint.ts` の 1 か所に閉じ込める。
D1 のエラーには構造化されたコードが無く、判別できるのは `message` の中の `<表>.<列>` だけである。
`reservations_org_code_idx`（予約番号）の衝突は +1 して 5 回まで再試行し、`idempotency_records` の PK の衝突は
409 `idempotency_conflict` を返す。**予約番号の衝突は「本処理の失敗」に数えない** — `idempotency_records` の
`in_progress` の行を消さずに同じキーのまま再試行する。`in_progress` を消すのは、再試行しても解けない失敗のときだけである。

**仮の押さえは排他ではない。** KV に CAS は無く、`get` → 無い → `put` の間に別の端末が同じことをするのを止められない。
鍵は `hold:<orgId>:<storeId>:<holdId>` の 1 通りに決め、`KV.put` の `metadata` に
`{ kind, targetId, startsAt, receptionSessionId }` を載せる。`KV.list` は metadata をそのまま返すので、
1 回の list で空き枠エンジンに要る情報が揃い、`holdId` からの削除も引ける。
`POST /api/staff/holds` は 409 `slot_taken` を返さず**常に 200 を返す**（「取れなかった」を KV では判定できないため）。
枠の一次排他は確定時の `reservation_slot_locks` が担うので、押さえが重なっても二重予約にはならない。

**5 工程の下書きは `reception_sessions` に持たせる**（この feature で新設し、`008-reception-and-walkin` が
来店受付へ広げる）。iPadOS の Safari は裏に回ったタブを捨てるので、下書きを端末のメモリだけに置くと
日時・目的・担当・お客様・ご要望が丸ごと消える。マイクの許可を取り直すための読み込み直しでも同じことが起きる。
端末に持ち帰るのは**受付セッションの id と選んだ id だけ**にし、お客様のお名前・お電話番号そのものは端末に残さない
（共有端末に顧客情報を残さないという決めと両立する）。

工程 4 で伺ったお名前・ふりがな・お電話番号は `reception_sessions` に置き、確定した予約からは
その受付セッションを指す。`reservations.customer_id` は `customers` を作る `007-customer-records` で初めて埋め、
そのときに受付セッションのお名前・お電話番号を顧客行へ寄せ直す。
手書きのご要望も同じく受付セッションに紐づけて R2 へ置き（`handwriting_key`）、
お客様が確定した時点で `customer_notes` へ移す。手書きの筆跡を D1 に置かないのは、
1 枚 3〜12KB × 5 枚 × 5,000 顧客で 300MB となり D1 の 500MB の 6 割を手書きだけで占めるためである。

**却下した代替案**:

- 5 工程を 1 画面のフォームにまとめる: 電話の会話の順から外れて聞き漏らしが出るため却下。1 工程 1 問にする。
- 5 工程の下書きを端末のメモリだけに置く: iPadOS の Safari が裏に回ったタブを捨てた時点で伺った内容が丸ごと消えるため却下。`reception_sessions` に置き、端末にはセッション id と選んだ id だけを持ち帰る。
- 工程 1 で空き枠を最終確定する: 所要時間は目的を伺うまで決まらないため却下。目的の直後にもう一度検証する。
- 「空き」の大きな札を工程の先頭に置く: 希望の日時はもう伺い終えているため却下。決めるのは担当・設備だけにする。
- 重なりを確定時のエラーだけで伝える: 会話中に気づけないため却下。置いた瞬間に帯を重ねて警告する。
- 確定を楽観ロックだけに任せる: 復唱している間に枠を取られるため却下。仮の押さえを置いてから復唱する。
- 手書きを文字へ変換して保存する: サーバ側の文字認識は無料枠の構成に置けず、端末側の手書き認識も持たないため却下。筆跡をそのまま残し、「文字に変換する」のボタンは出さない。文字が要るときは人が打ち直す（`007-customer-records` の AC-CUST-19）。
- ドラッグを座標そのままの自由配置にする: 30 分の刻みから外れた予約ができるため却下。担当の行と刻みへ吸着させる。
- 確定の直前に枠を読み直して判定する: D1 の `db.batch()` は同じバッチの中で読んで分岐できず、バッチの外で読むと読んでから書くまでに窓が空くため却下。上限つきの条件付き INSERT の `meta.changes` で判定する。
- 仮の押さえを枠の一次排他にする: KV に CAS が無く（`get` → 無い → `put` の間を止められない）、結果整合なので別の colo の押さえが見えないこともあり、2 台が同時に押さえれば両方 200 になるため却下。押さえは表示のためだけに使い、排他は確定時の D1 に寄せる。

## 3. TASKS

- [ ] T-001: `packages/contracts/test/glasses_management.contract.test.ts` に `HoldInput` / `Hold` / `StaffReservationCreate` の境界値と unknown key のテストを足す（Red）。
- [ ] T-002: `services/glasses_management/test/reservation-code.test.ts` を書く（`EY-YYMM-NNNN` の形・月跨ぎ・年跨ぎ・連番の衝突再試行）。
- [ ] T-003: `services/glasses_management/test/booking.time.test.ts` を書く（仮の押さえの期限ちょうどと +1 秒、JST の日跨ぎ、刻みの端）。時刻は引数で注入する。
- [ ] T-004: `services/glasses_management/test/booking.integration.test.ts` を書く（確定で予約の 3 表と `reservation_slot_locks` の枠ぶんの行と監査 1 件が揃う / 未定の割り当ては `target_key='unassigned'` で枠を消費する / 枠が上限まで埋まっていたら 409 `slot_taken` / **409 のとき予約の 3 表と `audit_events` に 1 行も書かれていない** / 担当を未定にしたまま同時受付上限 3 件目までは成立する / 同じ `Idempotency-Key` で 1 件）。
- [ ] T-005: `permissions.test.ts` に `/api/staff/holds` と `/api/staff/reservations` の行を足し、`tenant-isolation.test.ts` に他テナントの枠を押さえられないことを足す。
- [ ] T-006: 契約に予約作成・仮の押さえのスキーマを足す（Green）。
- [ ] T-007: `audit_events` / `idempotency_records` / `reception_sessions` の 3 表をスキーマに書き、`db:generate` で `0003_*.sql` を作ってローカルへ当てる（`reception_sessions` は 5 工程の下書き置き場としてこのフェーズで要る。`design/03-data-model.md` §12 の P3 行に置く）。`reservation_slot_locks` はここでは作らない（`005-availability-and-ledger` が P2 で作る）。
- [ ] T-008: `src/worker/domain/reservation-code.ts` と `idempotency.ts` を実装する。
- [ ] T-009: `src/worker/domain/holds.ts`（KV）を実装する。鍵は `hold:<orgId>:<storeId>:<holdId>`、`KV.put` の `metadata` に `{ kind, targetId, startsAt, receptionSessionId }` を載せ、空き枠エンジンへは 1 回の `KV.list` で渡す。仮押さえの残り時間の見せ方と延ばせるかどうかは Q-06 が解けてから配線する。
- [ ] T-009b: `reception_sessions` の作成・更新・破棄を実装し、アプリを切り替えて戻っても 5 工程の入力が復せることを integration テストで確かめる。
- [ ] T-010: `src/worker/domain/booking.ts` を実装する。1 バッチの並びは「① `reservation_slot_locks` への上限つき条件付き INSERT（枠ぶん）→ ② `reservations` / `reservation_purposes` / `reservation_assignments` / `audit_events` の INSERT（すべて `WHERE EXISTS (SELECT 1 FROM reservation_slot_locks WHERE reservation_id = ?)` でガード）→ ③ `idempotency_records` を `done` に」。① が 1 本も発火しなければ 409 `slot_taken` を返す。確定前の枠の再検査は置かない。
- [ ] T-011: `src/worker/index.ts` に 3 本のルートをチェーンで足す。
- [ ] T-012: `src/web/book/` の工程の帯（工程 5 つ・録音の表示・戻る・やめる）と受付の状態の持ち方を作る。パス 1 の計画は「主役は 1 画面に 1 問 / 白い箱は 3 枚まで / 説明文は 2 つまで・各 1 行 / 右は伺った内容のまとめだけ / 次へは右下に 1 つ」。空いた場所を埋めるために要素を足さない（下や右が空いているのは正しい状態）。工程の札は押せる操作にせず、順番といまの位置を読み上げに伝える並びとして作る。「次へ進む」を押せない状態にするときは、押せない理由を必ずその操作の名前か説明に持たせる。
- [ ] T-013: 工程 1（`/book/datetime`）を作る。
- [ ] T-014: 工程 2（`/book/purpose`）と収まらないときの警告を作る。
- [ ] T-015: 工程 3（`/book/slot`）の担当軸・設備軸と重なりの警告・候補を作る。
- [ ] T-016: 工程 3 のドラッグ移動（もとの場所・置く先・離して確保・もとに戻す）を作る。
- [ ] T-017: 工程 4（`/book/customer`）のテンキーとお名前・ふりがな・手書きの入力を作る。テンキーの左下は電話番号の面では「ハイフン」、右下は全画面で「削除」（承認済みモック 7 面のうち 5 面がそう描いている。CUSTOMER-NEW の「1文字消す」と EX-PERMISSION の「1字消す」は少数派なので寄せる）、上のバーの中止は「やめる」に揃える。確定キーは電話番号の面が「完了」（入力が終わる）、暗証番号の面が「確定」（照合が走る）。物理キーボードは前提にしない（欄は `inputmode` でソフトキーボードを出さない形にし、つないである場合の数字・Backspace・Enter は拾うが、それ無しで完結する）。テンキーを使っている間は iPadOS のソフトキーボードを出さず、キーボードが出る欄では工程の帯と録音の表示を見えている高さの底へ貼り直す。ふりがなの自動入力は日本語の変換が確定してから 1 度だけ行い、人が直した欄は上書きしない。
- [ ] T-018: 工程 5（`/book/confirm`）の復唱と確定、完了（`/book/done`）を作る。
- [ ] T-019: 確定時に枠が埋まっていたときの面を作る。
- [ ] T-020: 「やめる」の確認（2 択）と破棄を作る。破棄しても録音は `discarded` として残す。
- [ ] T-021: `src/web/book/*.test.tsx` を書く（工程ごとの「次へ」の有効・無効と、戻っても入力が残ること）。
- [ ] T-022: `e2e/booking-flow.spec.ts` に `// @e2e-covers` を付けて UC/AC と 1 対 1 で対応させる。
- [ ] T-023: `pnpm --filter @app/glasses_management e2e` と `pnpm check` を緑にし、ステータスを Approved に上げてよいか人に確認する。
- [ ] T-024: `src/worker/db/constraint.ts` と `test/constraint.test.ts` を書く。D1 は構造化されたエラーコードを持たず（`Object.keys(err)` は空、`cause` も空）、判別できるのは `message` の中の `UNIQUE constraint failed: <表>.<列>` と `SQLITE_CONSTRAINT_UNIQUE` / `_PRIMARYKEY` だけなので、表名を取り出す `constraintTable(err): string | null` を 1 か所に閉じ込め、そこだけがメッセージの形に依存すると明記する。`reservations_org_code_idx`（予約番号）は +1 して 5 回まで再試行、`idempotency_records` の PK は 409 `idempotency_conflict` へ振り分ける。D1 の文言が変わると 409 が 500 に化けるので、壊れたことを検知できる場所をこの unit テストに置く。
