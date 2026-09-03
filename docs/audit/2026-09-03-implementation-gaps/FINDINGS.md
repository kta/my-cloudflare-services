# EYEX予約 実装不足の洗い出し（2026-09-03）

11 の機能領域ごとに spec の UC/AC と実装を突き合わせ、各所見を 3 つの観点
（実装の存在 / 仕様の解釈 / 実行時の挙動）から反証にかけた。2 票以上が反証できなかった 36 件を残す。

生データ: `findings.json` / `journal.jsonl`。

> 注記: booking と terminals-audit の一部（booking-02〜08、terminals-audit-01〜09）は
> 検証の途中で利用上限に当たって票が揃っていない。表には残すが、着手前にもう一度裏を取る。

| 重大度 | ID | 何が足りないか | 場所 | 仕様 |
|---|---|---|---|---|
| high | booking-01 | 受けかけの受付を読む GET が別スキーマ（ReceptionHistoryDetail）を返すため、下書きの復帰が必ず失敗する | `src/web/booking/BookingScreen.tsx:106` | AC-BOOK-16 / UC-BOOK-13（HOW「5 工程の下書きは reception_sessions に持たせる」・T-009b） |
| high | booking-02 | 工程 4 の手書きご要望がサーバへ一切送られず、確定と同時に消える | `src/web/booking/BookingScreen.tsx:160` | AC-BOOK-12 / UC-BOOK-10 |
| high | change-cancel-01 | EX-CONFLICT の「1項目ずつ選ぶ」で、担当・場所の選択がサーバへ一切送られない（日時以外の picks が捨てられている） | `src/web/change/ChangeScreen.tsx:694` | UC-CHANGE-08 / 決めたこと「1 項目ずつ選ぶは相手の日時と自分の担当を混ぜられる」 |
| high | change-cancel-04 | 変更先の仮の押さえに担当・設備を載せていないため、別端末で同じ担当の同時刻が「満席」にならない | `src/web/change/ChangeScreen.tsx:441` | AC-CHANGE-12 |
| high | change-cancel-05 | 検索へ戻っても担当・場所の選択（chosenSlot）が消えず、別の予約の差分・送信内容に混入する | `src/web/change/ChangeScreen.tsx:489` | AC-CHANGE-14 |
| high | reception-02 | 受付パネルの「目安 N分」が実装されておらず、estimatedWaitMinutes は常に null 固定 | `src/worker/index.ts:5893` | AC-RECEP-06 / UC-RECEP-07 |
| high | recording-02 | 「録音を聞く」導線が本番のどの画面にも繋がっていない（RecordingPlayer が到達不能） | `src/web/ledger/LedgerScreen.tsx:465` | AC-REC-08 / AC-REC-09 / AC-REC-10 / UC-REC-07 |
| high | recording-03 | 録音一覧 API に受付セッション／予約での絞り込みが無く、画面が録音を引けない | `packages/contracts/src/glasses_management.ts:2458` | AC-REC-09 / UC-REC-07 |
| high | customers-01 | 予約確定時に customerId を送っておらず、選んだお客様が予約に結び付かない | `src/web/booking/BookingScreen.tsx:523` | AC-CUST-13 / AC-CUST-24 / AC-CUST-25 / AC-CUST-26 |
| high | customers-05 | 「最後のご来店」の集計が done のみで、arrived / serving を数えていない | `src/worker/index.ts:1250` | AC-CUST-11 |
| high | settings-05 | スタッフ面の保存が直前に版を読み直すため、他端末の変更を検知できない | `src/web/settings/StaffPanel.tsx:751` | AC-SET-02 / HOW（設定の楽観ロックは店舗単位の 1 版） |
| high | settings-07 | 勤務の曜日テンプレートを日次 Cron が展開せず、62日先で勤務が尽きる | `src/worker/index.ts:10773` | UC-SET-08 / HOW（staff_weekly_shifts を正に 62 日先まで展開） |
| high | foundation-07 | 店舗を切り替えると端末選択・PIN 入力へ引き戻される | `src/web/App.tsx:445` | none |
| high | foundation-12 | dev サーバに allowedHosts が無く、admin からの組織・担当店舗同期が 403 になる（T-018 未実装） | `vite.config.ts:13` | none |
| medium | ledger-01 | 予約詳細（LEDGER-DETAIL）にお客様のお名前が一切描かれない | `src/web/ledger/ReservationDetail.tsx:220` | AC-CUST-25 / AC-LEDGER-15 |
| medium | ledger-03 | 台帳から開いた詳細に「● 録音を聞く」が絶対に出ない | `src/web/ledger/LedgerScreen.tsx:465` | AC-REC-09 |
| medium | change-cancel-02 | CHANGE-DIFF が Web 予約に「変更をメールでお知らせします」と表示するが、変更確定でメールを送るコードが存在しない | `src/web/change/ChangeDiff.tsx:266` | AC-CHANGE-15 / 決めたこと「承認が下りるまで変更・取消のメールを送らない」 |
| medium | change-cancel-03 | CHANGE-SEARCH の詳細に「録音を聞く」が絶対に出ない（recording prop を親が渡していない） | `src/web/change/ChangeScreen.tsx:825` | AC-CHANGE-08 |
| medium | reception-01 | 来店受付ボードから「ご来店がなかった」を記録できない（onMarkNoShow がどこからも渡されていない） | `src/web/reception/ReceptionScreen.tsx:353` | AC-RECEP-16 / UC-RECEP-11（および「決めたこと」の『ご来店がなかった』は来店受付ボードからも残せる） |
| medium | reception-04 | 工程を進めるとき担当・設備を選べず、visit_events.staff_id は常に NULL | `src/web/reception/ReceptionScreen.tsx:359` | AC-RECEP-12 / UC-RECEP-05 |
| medium | recording-01 | 受付履歴の詳細 API が録音を常に null で返す（契約も null 固定） | `src/worker/index.ts:8610` | AC-REC-10 / UC-REC-07 / AC-REC-02 |
| medium | recording-04 | 送信失敗を端末がサーバへ知らせないため upload_attempts が増えず、3回失敗のお知らせが実運用で立たない | `src/web/recording/useRecorder.ts:248` | AC-REC-19 |
| medium | recording-05 | 3回失敗のお知らせに端末名が入らない（terminalName: null 固定） | `src/worker/index.ts:2791` | AC-REC-19 |
| medium | customers-02 | 手書きメモ 6 枚目の「置き換える」が保存されず、押しても何も起きない | `src/web/customers/CustomerScreen.tsx:573` | AC-CUST-18 |
| medium | customers-06 | おまとめ拒否時に「何が変わったかの差分」を出さず固定文言を表示している | `src/web/customers/CustomerScreen.tsx:384` | AC-CUST-15 |
| medium | settings-01 | 店舗まるごとの受付停止が保存できない（切り替えが常に無効） | `src/web/settings/CalendarPanel.tsx:205` | UC-SET-06 |
| medium | settings-02 | 「最後にお受けできる時刻」が下書きに追随せず、保存前の確認にならない | `src/web/settings/HoursPanel.tsx:220` | UC-SET-05 / AC-SET-07 |
| medium | settings-03 | 曜日ごとの営業時間の上書きが読むだけで編集できない | `src/web/settings/HoursPanel.tsx:254` | UC-SET-03 |
| medium | analytics-02 | 「予約数」日別グラフの縦軸が 24 件固定で、25 件以上の日は棒が枠外へはみ出す | `src/web/analytics/OfficialTab.tsx:352` | AC-ANA-06 / AC-ANA-07 |
| medium | booking-01 | 満席時の代替時刻ボタンが選んだ時刻を捨てて日時選択に戻るだけ | `src/web/public/PublicBookingRoot.tsx:296` | AC-WEB-11 周辺（決めたこと「送信の瞬間に枠が埋まっていたときは BOOK-CONFLICT と同じ型（代わりの時刻を出す）に落とす」） |
| medium | foundation-01 | 業務画面の器に <main> も画面名の見出しも無い（T-011 未実装） | `src/web/shell/AppShell.tsx:194` | AC-FOUND-01 |
| medium | foundation-03 | HOME 系以外の画面でもサイドバーに「トップ」の行が出る（行き先が 8 つのまま） | `src/web/shell/AppShell.tsx:135` | AC-FOUND-02 |
| medium | foundation-04 | コードのお店が見つからなくてもトークンが消えず、再読み込みで業務画面に入れてしまう | `src/web/App.tsx:94` | AC-FOUND-03 |
| medium | foundation-08 | 店舗を切り替えても台帳の日付と受付履歴の絞り込みが既定へ戻らない | `src/web/App.tsx:752` | none |
| medium | foundation-09 | 店舗の切り替えが上のバーの店名からではなくトップ画面のチップからしかできない | `src/web/App.tsx:937` | none |
| medium | foundation-10 | 上のバーのお知らせのバッジが 4 画面でしか出ない（常設の入口になっていない） | `src/web/shell/AppShell.tsx:18` | AC-FOUND-02 |

## 詳細

### booking-01 受けかけの受付を読む GET が別スキーマ（ReceptionHistoryDetail）を返すため、下書きの復帰が必ず失敗する

- **重大度**: high ／ **種別**: broken-behavior ／ **仕様**: AC-BOOK-16 / UC-BOOK-13（HOW「5 工程の下書きは reception_sessions に持たせる」・T-009b）
- **場所**: `services/glasses_management/src/web/booking/BookingScreen.tsx:106`
- **根拠**: BookingScreen.tsx:106-111 `async function readReceptionSession(sessionId) { const res = await auth.authFetch(`/api/staff/reception-sessions/${sessionId}`) ... const parsed = ReceptionSession.safeParse(await res.json()); return parsed.success ? parsed.data : null }` — 呼び先の worker ルートは src/worker/index.ts:8522 `.get('/api/staff/reception-sessions/:sessionId', ...)` の 1 本きりで、返すのは index.ts:8597 `ReceptionHistoryDetail.parse({ entryId, sessionId, reservation, receivedBy, receivedAt, changes, recording })`。`ReceptionSession` は packages/contracts/src/glasses_management.ts:1366 の `z.strictObject({ id, storeId, ..., draft, createdAt })` なので safeParse は必ず失敗し、常に null が返る。BookingScreen.tsx:221-232 はその結果 `sessionStorage.removeItem(SESSION_KEY)` して index.ts:6750 の POST で新しい受付を作り直す。unit テストが緑なのは src/web/booking/BookingScreen.test.tsx:247-248 が `ReceptionSession` 形の擬似応答を返しているためで、実サーバの形とは違う。
- **お客様・スタッフに起きること**: 「あとで続ける」で抜けた受付に戻っても、iPadOS の Safari がタブを捨てて戻っても、マイクの許可を取り直す再読み込み（MicDeniedPanel の window.location.reload、BookingScreen.tsx:859-862）をしても、日時・目的・担当・お名前・お電話番号がすべて消えて工程 1 からやり直しになる。さらに毎回 reception_sessions の行だけが outcome=null のまま積み上がり、受けかけ受付の一覧に幽霊の受付が増える。

### booking-02 工程 4 の手書きご要望がサーバへ一切送られず、確定と同時に消える

- **重大度**: high ／ **種別**: data-not-persisted ／ **仕様**: AC-BOOK-12 / UC-BOOK-10
- **場所**: `services/glasses_management/src/web/booking/BookingScreen.tsx:160`
- **根拠**: BookingScreen.tsx:160-161 `/** 手書きのご要望。R2 へ上げる口がまだ無いので、この受付のあいだだけ端末に置く。 */ const [notes, setNotes] = useState<readonly HandwrittenNote[]>([])`。CustomerStep.tsx:283-286 の onSave は `patch({ notes: [...value.notes, note] })` で React state に足すだけで、BookingScreen.tsx:970-979 の onChange も `phoneTyped / nameTyped / kanaTyped / noteTyped` しか draft へ畳まない。契約側の受け皿 packages/contracts/src/glasses_management.ts:1339 `handwritingKeys: ...array().max(5).default([])` はコード全体で参照が 0 件（grep で contracts の定義行のみ）で、worker にも受付セッションの筆跡を R2 へ置く口が無い（src/worker/index.ts:1247 の `notes/${org}/${customerId}/${noteId}.svg` は customerId を要る 007 の顧客メモ経路だけ）。確定 BookingScreen.tsx:521-537 が送るのも `noteCustomer: draft.noteTyped` のみ。
- **お客様・スタッフに起きること**: 「手書きのまま残す」を押して残したご要望は画面に見えているだけで、予約を確定した瞬間（あるいは工程を戻って画面が作り直された時点）に失われる。当日その予約を開いても手書きのご要望も記入者・時刻も出てこず、口頭で伺ったご要望が伝わらない。

### change-cancel-01 EX-CONFLICT の「1項目ずつ選ぶ」で、担当・場所の選択がサーバへ一切送られない（日時以外の picks が捨てられている）

- **重大度**: high ／ **種別**: broken-behavior ／ **仕様**: UC-CHANGE-08 / 決めたこと「1 項目ずつ選ぶは相手の日時と自分の担当を混ぜられる」
- **場所**: `services/glasses_management/src/web/change/ChangeScreen.tsx:694`
- **根拠**: resolveConflict は picks のうち datetime しか読まない: `const keepMine = choice.kind === 'mine' ? true : (choice.picks.datetime ?? 'theirs') === 'mine'` / `if (!keepMine) { await resolveConflict({ kind: 'theirs' }); return }`。実際に送る欄は picks ではなく chosenSlot から作る（同ファイル 590-596: `if (chosenSlot !== null && before !== null) { if (chosenSlot.staffId !== before.staffId) slotFields.staffId = ... }`）。ConflictPanel は staff / equipment 行にもラジオを出し `onResolve({ kind: 'perField', picks })` で 3 行ぶんの選択を返している（ConflictPanel.tsx:180-199, 277-279）が、その 2 行は読まれずに消える。picks.datetime='theirs' かつ picks.staff='mine' の組み合わせでは 'theirs' 分岐に落ち、自分の入力を全部捨てたうえ「ほかの端末の内容を残しました」と表示する。
- **お客様・スタッフに起きること**: スタッフが「相手の日時＋自分の担当」で 1 項目ずつ選んでも、担当・場所の選択は保存されない。押した内容と実際に保存される内容が食い違い、口頭で案内した担当と台帳がずれる。

### change-cancel-04 変更先の仮の押さえに担当・設備を載せていないため、別端末で同じ担当の同時刻が「満席」にならない

- **重大度**: high ／ **種別**: broken-behavior ／ **仕様**: AC-CHANGE-12
- **場所**: `services/glasses_management/src/web/change/ChangeScreen.tsx:441`
- **根拠**: `client.api.staff.holds.$post({ json: { storeId, startsAt, durationMinutes } })` のみ。HoldInput は `staffId` / `equipmentIds` を受けるが（packages/contracts/src/glasses_management.ts:1268-1284）既定は null / [] になる。holdOccupancies は `rows.push({ ...band, kind: 'staff', targetId: hold.staffId })`（domain/holds.ts:133）で targetId=null のレーンしか作らず、availability の buildOccupancy はそれを `laneKey('staff', null)` に積むだけ（domain/availability.ts:377-384）なので、担当を佐藤 美咲に絞った別端末の空き枠計算では佐藤のレーンが減らない（店舗全体の同時上限にしか効かない）。変更対象の担当・設備は before.staffId / before.equipmentIds として画面が持っているのに送っていない。
- **お客様・スタッフに起きること**: 復唱中の 7 分間に別端末が同じ担当の同じ時刻へ別の予約を移せてしまい、確定時に初めて衝突する。AC-CHANGE-12 の「その端末では 14:00 が満席になって押せない」が成立しない。

### change-cancel-05 検索へ戻っても担当・場所の選択（chosenSlot）が消えず、別の予約の差分・送信内容に混入する

- **重大度**: high ／ **種別**: broken-behavior ／ **仕様**: AC-CHANGE-14
- **場所**: `services/glasses_management/src/web/change/ChangeScreen.tsx:489`
- **根拠**: `function backToSearch() { releaseHold(); setChosenStartsAt(null); setSlotTaken(null); setConflict(null); setConfirmError(null); setDone(null); setStep('search') }` — chosenStartsAt は消すが chosenSlot は消さない。ChangeSlot の onBack はこの backToSearch（900-919 行）。onChangeSlot ハンドラも `setChosenStartsAt(null)` だけで chosenSlot を初期化しない（852-861 行）。after の計算は `if (chosenSlot !== null) { next = { ...next, startsAt: chosenSlot.startsAt, endsAt: chosenSlot.endsAt, staffId: chosenSlot.staffId, equipmentIds: chosenSlot.equipmentIds } }`（516-527 行）で、patchTo はその差分を slotFields として送る（590-600 行）。chosenSlot が消えるのは patch 成功時（615 行）だけ。
- **お客様・スタッフに起きること**: 担当を選びかけて検索に戻り、別のお客様のご予約を開いて日時を変えると、前のお客様向けに選んだ担当・設備・開始時刻がそのまま差分と保存内容に載る。無関係の予約の担当が書き換わる。

### reception-02 受付パネルの「目安 N分」が実装されておらず、estimatedWaitMinutes は常に null 固定

- **重大度**: high ／ **種別**: stub-or-fake ／ **仕様**: AC-RECEP-06 / UC-RECEP-07
- **場所**: `services/glasses_management/src/worker/index.ts:5893`
- **根拠**: 台帳の応答を作る唯一の箇所が `estimatedWaitMinutes: null,`（index.ts:5893、直上のコメント「台帳を開いた時点ではご用件が決まっていないので、ここでは出せない（null）」）。domain/ledger.ts:540 も `input.estimatedWaitMinutes ?? null` のみで、空き枠エンジンから算出する呼び出しはソース全体に存在しない（`grep -rn estimatedWaitMinutes services/glasses_management/src` の結果は型宣言・null 固定・表示側だけ）。表示側 WalkinPanel.tsx:246-248 は `estimatedWaitMinutes !== null && ...` なので「目安」の行は決して描かれない。ご用件を選んでも再取得しない（WalkinPanel はコメント通り API を持たない）。e2e/reception.spec.ts:862-863 は逆に `not.toContainText('目安')` を assert している。
- **お客様・スタッフに起きること**: 店頭のお客様に「どれくらい待ちますか」と聞かれても、受付パネルに目安時間が一切出ない。スタッフは勘で答えることになる。

### recording-02 「録音を聞く」導線が本番のどの画面にも繋がっていない（RecordingPlayer が到達不能）

- **重大度**: high ／ **種別**: missing-feature ／ **仕様**: AC-REC-08 / AC-REC-09 / AC-REC-10 / UC-REC-07
- **場所**: `services/glasses_management/src/web/ledger/LedgerScreen.tsx:465`
- **根拠**: `ReservationDetail` / `ReservationSearch` / `ReceptionHistory` はいずれも `recording?: RecordingSummary | null` を受ける口を持つが既定値 null（ReservationDetail.tsx:107 `recording = null`、ReceptionHistory.tsx:282 `recording = null`）。呼び出し側 LedgerScreen.tsx:465、ChangeScreen.tsx:825、App.tsx:1046 のいずれも `recording` を渡しておらず、`grep -rn "recording=" src/web`（recording/ 配下を除く）は 0 件。`hasPlayableRecording()` が常に false になるので `RecordingPlayer` は必ず `return null` する。
- **お客様・スタッフに起きること**: 保存済みの録音があっても、予約台帳の詳細・予約検索・受付履歴のどこにも「● 録音を聞く」が出ず、店長は録音を一切聞けない。API だけが動いていて画面は空振りする。

### recording-03 録音一覧 API に受付セッション／予約での絞り込みが無く、画面が録音を引けない

- **重大度**: high ／ **種別**: missing-feature ／ **仕様**: AC-REC-09 / UC-REC-07
- **場所**: `packages/contracts/src/glasses_management.ts:2458`
- **根拠**: `RecordingListQuery = z.strictObject({ storeId, state, from, to, limit, cursor })`（2458-2465）に `reservationId` も `receptionSessionId` も無い。worker 側 `GET /api/staff/recordings`（index.ts:9032-）の WHERE も store_id / state / created_at だけを組む。
- **お客様・スタッフに起きること**: 予約 1 件に紐づく録音を特定する API 経路が存在しないため、recording-02 の導線を画面側で埋めようとしても引く手段が無い。

### customers-01 予約確定時に customerId を送っておらず、選んだお客様が予約に結び付かない

- **重大度**: high ／ **種別**: data-not-persisted ／ **仕様**: AC-CUST-13 / AC-CUST-24 / AC-CUST-25 / AC-CUST-26
- **場所**: `services/glasses_management/src/web/booking/BookingScreen.tsx:523`
- **根拠**: BookingScreen.tsx:521-534 の `client.api.staff.reservations.$post({ json: { storeId, startsAt, purposeIds, durationMinutes, staffId, equipmentIds, noteCustomer, source: 'phone', ...} })` に `customerId` が無い。契約 packages/contracts/src/glasses_management.ts:1234 は `customerId: Uuid.optional()` を受け口として持ち、CustomerStep.tsx:37-40 のコメント自身が「選んだ 1 名を予約へ結び付ける経路（`POST /api/staff/reservations` の `customerId`）はまだ書き込まれない」と書いている。App.tsx:390 の `startBooking(customer?: { name; kana; phone })` も CustomerScreen が渡した `id` を型ごと捨てており、BookingScreen.tsx:74 の `initialCustomer` にも `id` が無い。
- **お客様・スタッフに起きること**: 候補から 1 名を選んでも、顧客台帳から「ご予約を取る」で来ても、予約行の customer_id は NULL のまま。台帳の帯にお名前・来店回数が出ず（AC-CUST-24/25）、来店回数と最後のご来店も一生増えず（AC-CUST-10/11）、顧客詳細の「次のご予約」も空のままになる。

### customers-05 「最後のご来店」の集計が done のみで、arrived / serving を数えていない

- **重大度**: high ／ **種別**: broken-behavior ／ **仕様**: AC-CUST-11
- **場所**: `services/glasses_management/src/worker/index.ts:1250`
- **根拠**: index.ts:1250 `const VISITED_STATUSES = "('done')"` を、index.ts:1648-1649 の `MIN/MAX(CASE WHEN status IN ('done') THEN starts_at END)` と index.ts:2133-2134 の `first_visit_at` / `last_visit_at` の書き戻しがそのまま使っている。仕様と純関数側は 3 状態で、src/worker/domain/customers.ts:312 は `const VISITED_STATUSES: readonly ReservationStatus[] = ['arrived', 'serving', 'done']`。
- **お客様・スタッフに起きること**: ご来店中（arrived / serving）のお客様の「最後のご来店」が更新されず、一覧・要約・重複警告に前回の日付が出続ける。同じ日に受け付けた方かどうかを台帳から読めない。

### settings-05 スタッフ面の保存が直前に版を読み直すため、他端末の変更を検知できない

- **重大度**: high ／ **種別**: broken-behavior ／ **仕様**: AC-SET-02 / HOW（設定の楽観ロックは店舗単位の 1 版）
- **場所**: `services/glasses_management/src/web/settings/StaffPanel.tsx:751`
- **根拠**: StaffPanel.tsx:747-756 `readVersion` が business-hours を GET して最新 version を取り、writeAll（StaffPanel.tsx:785-786, 798-799）が書き込み直前にそれを取り直して送る。楽観ロックの条件が「自分が読んだ版」ではなく「送信直前の最新版」になるため、他端末が先に保存していても 409 にならず上書きする。
- **お客様・スタッフに起きること**: spec HOW の楽観ロック（他端末が先に保存していたら 409 で EX-CONFLICT を見せる）が効かない。2台の iPad で同時に設定を直すと、後から押した側が相手の変更を黙って上書きし、店長は取り消されたことに気づけない。

### settings-07 勤務の曜日テンプレートを日次 Cron が展開せず、62日先で勤務が尽きる

- **重大度**: high ／ **種別**: missing-feature ／ **仕様**: UC-SET-08 / HOW（staff_weekly_shifts を正に 62 日先まで展開）
- **場所**: `services/glasses_management/src/worker/index.ts:10773`
- **根拠**: `staff_weekly_shifts` は staff-shifts PUT（index.ts:5204, 5209）で書かれるだけで、他に読む箇所が無い（grep 'staff_weekly_shifts' のヒットはこの2行のみ）。日次 Cron の `runScheduledMaintenance` / `scheduled`（index.ts:10726-10788）が呼ぶのは applyWebPublications / rollupAnalytics / purgeRecordings / purgeAuditAndSessions の4本だけで、勤務の展開が無い。展開は保存時に `SHIFT_WINDOW_DAYS = 62`（index.ts:431）ぶんしか作られない。
- **お客様・スタッフに起きること**: spec HOW の「保存時と日次 Cron の両方で展開する」の片方が欠けている。設定を触らないまま 62 日が過ぎると担当者の勤務行が消え、予約台帳にスタッフの行が出ない・空き枠が出せない状態になる。

### foundation-07 店舗を切り替えると端末選択・PIN 入力へ引き戻される

- **重大度**: high ／ **種別**: broken-behavior ／ **仕様**: none
- **場所**: `services/glasses_management/src/web/App.tsx:445`
- **根拠**: 店舗依存の初期化 effect は deps が `[now, org, store]`（460 行）で、`store` は `selectedStoreId` の変更で差し替わる。その中で `const saved = localStorage.getItem(...)` のあと `setStartPhase(saved === 'personal' ? 'staff' : 'place')`（445-451 行）を、既に `terminalSession` が確立していても無条件に実行する。
- **お客様・スタッフに起きること**: トップの「◯◯へ切り替える」を押しただけで業務画面から追い出され、スタッフ選択と暗証番号の入力をやり直させられる。US-FOUND-06 / T-016 の店舗切り替えが実質使えない。

### foundation-12 dev サーバに allowedHosts が無く、admin からの組織・担当店舗同期が 403 になる（T-018 未実装）

- **重大度**: high ／ **種別**: missing-feature ／ **仕様**: none
- **場所**: `services/glasses_management/vite.config.ts:13`
- **根拠**: vite.config.ts は `server: { port: 5175 }`（13 行）のみで `allowedHosts` を持たない。`grep allowedHosts vite.config.ts` はヒット 0。admin 側は `https://glasses-management.internal/...` を固定文字列で叩く（spec T-018）。
- **お客様・スタッフに起きること**: `make dev/all` で組織も担当店舗も届かず、業務 API が 503 `not_synced` を返し続ける。US-FOUND-03 の「admin で直した組織名と担当店舗がその日の受付に効く」がローカルで検証できない。

### ledger-01 予約詳細（LEDGER-DETAIL）にお客様のお名前が一切描かれない

- **重大度**: medium ／ **種別**: spec-ac-unimplemented ／ **仕様**: AC-CUST-25 / AC-LEDGER-15
- **場所**: `services/glasses_management/src/web/ledger/ReservationDetail.tsx:220`
- **根拠**: 見出しは時刻・所要・出どころだけを描く: `<h2 className="font-mono text-title font-bold text-ink">{`${jstClock(detail.startsAt)}–${jstClock(detail.endsAt)}`}</h2>` … `<span>{`${detail.durationMinutes}分`}</span>`。ファイル全体を grep しても `customerName` の参照は 0 件（`grep -rn customerName src/web/ledger/` は Timetable.tsx しか出ない）。一方サーバは値を返している: src/worker/index.ts:2318 `customerName: band?.customerName ?? null,` と契約 packages/contracts/src/glasses_management.ts:921 `customerName: z.string().trim().max(40).nullable().optional(),`。
- **お客様・スタッフに起きること**: 台帳の帯を押して詳細を開いても「田中 花子 様」が出ないので、スタッフは電話口・接客中に誰のご予約かを詳細から確認できず、帯の狭い文字（30分帯は姓のみ）に頼るしかない。

### ledger-03 台帳から開いた詳細に「● 録音を聞く」が絶対に出ない

- **重大度**: medium ／ **種別**: missing-feature ／ **仕様**: AC-REC-09
- **場所**: `services/glasses_management/src/web/ledger/LedgerScreen.tsx:465`
- **根拠**: LedgerScreen は `<ReservationDetail ... />` に `recording` を渡していない。ReservationDetail.tsx:107 `recording = null,`、同 228 `<RecordingPlayer recording={recording} placement="pill" />` なので常に null が入る。ReservationDetail.tsx:66-69 のコメントも「器が渡したときだけ出る」と明記しており、渡す器が存在しない。
- **お客様・スタッフに起きること**: 保存済み録音のある予約でも台帳の詳細から再生に入れず、AC-REC-09 の「台帳で開いて『録音を聞く』を押す」導線がユーザーに存在しない。

### change-cancel-02 CHANGE-DIFF が Web 予約に「変更をメールでお知らせします」と表示するが、変更確定でメールを送るコードが存在しない

- **重大度**: medium ／ **種別**: stub-or-fake ／ **仕様**: AC-CHANGE-15 / 決めたこと「承認が下りるまで変更・取消のメールを送らない」
- **場所**: `services/glasses_management/src/web/change/ChangeDiff.tsx:266`
- **根拠**: `source === 'web' ? 'Webでのご予約のため、変更をメールでお知らせします。' : `${sourceTagLabel(source)}のため、メールは送りません。``。しかし worker の `PATCH /api/staff/reservations/:reservationId`（src/worker/index.ts:6034-6250）には通知呼び出しが 1 つも無く、`sendReservationMail(` の呼び出し箇所は grep で 2 か所（index.ts:10157, 10258）＝いずれも `/api/public/**` の Web 予約自身の確定・再発行のみ。ChangeDone.tsx:205-207 は仕様どおり「お客様へのご連絡は、お電話でお願いします。」を出しており、同じフローの 2 画面で言っていることが矛盾している。
- **お客様・スタッフに起きること**: スタッフが「メールで届きます」と信じてお客様に案内するが、実際には何も送信されない。Web 予約のお客様が変更を知らないまま元の時刻に来店する。

### change-cancel-03 CHANGE-SEARCH の詳細に「録音を聞く」が絶対に出ない（recording prop を親が渡していない）

- **重大度**: medium ／ **種別**: missing-feature ／ **仕様**: AC-CHANGE-08
- **場所**: `services/glasses_management/src/web/change/ChangeScreen.tsx:825`
- **根拠**: ReservationSearch は `recording?: RecordingSummary | null`（既定 null）を受け取り `{hasPlayableRecording(recording) && (<Fact term="受付のときの録音">…)}`（ReservationSearch.tsx:562-566）で行を出すが、ChangeScreen の `<ReservationSearch ... />`（825-870 行）には recording が 1 度も渡されない。`grep -n "recording" src/web/change/ChangeScreen.tsx` は 0 件。既定値 null のため行は常に非表示。
- **お客様・スタッフに起きること**: AC-CHANGE-08 が求める右ペインの「録音を聞く」が変更画面から一切使えず、受付時のやり取りを確認せずに変更・取消を確定することになる。

### reception-01 来店受付ボードから「ご来店がなかった」を記録できない（onMarkNoShow がどこからも渡されていない）

- **重大度**: medium ／ **種別**: missing-feature ／ **仕様**: AC-RECEP-16 / UC-RECEP-11（および「決めたこと」の『ご来店がなかった』は来店受付ボードからも残せる）
- **場所**: `services/glasses_management/src/web/reception/ReceptionScreen.tsx:353`
- **根拠**: VisitBoard は `onMarkNoShow?: (row) => void` を受け取り RowActions で「ご来店がなかった」ボタンを出す（VisitBoard.tsx:69, 319-321 `onMarkNoShow === undefined ? null : { label: 'ご来店がなかった', ... }`）が、唯一の呼び出し元 ReceptionScreen.tsx:353-388 の `<VisitBoard ... />` は onMarkNoShow を一切渡していない（`grep -rn onMarkNoShow src/web` の非テストの一致は VisitBoard.tsx のみ）。ReceptionScreen.tsx:37 のコメントも「ご来店がなかったの記録（予約の取消のルートは 009 が付ける）」を持たないと明記。実際には worker 側に no_show 化の経路は存在する（index.ts:6254 付近 `reason='no_show' だけが status='no_show' になる`）。e2e/reception.spec.ts:1183-1195 も「『ご来店がなかった』として残す経路がアプリにまだ 1 本も無い」ため絞り込みが 0 件になることを assert している。
- **お客様・スタッフに起きること**: 受付の現場（来店受付ボード）で予約のお客様が来られなかったことを残せず、盤面の行はいつまでも残る。受付履歴の「ご来店なし」絞り込みは常に 0 件で、店長は取消とご来店なしを分けて数えられない。

### reception-04 工程を進めるとき担当・設備を選べず、visit_events.staff_id は常に NULL

- **重大度**: medium ／ **種別**: missing-feature ／ **仕様**: AC-RECEP-12 / UC-RECEP-05
- **場所**: `services/glasses_management/src/web/reception/ReceptionScreen.tsx:359`
- **根拠**: 盤面のセルを押すと `onAdvance={(row, cell) => { ... addVisitEvent(row, cell.stage) ... }}`（ReceptionScreen.tsx:359-371）で、`addVisitEvent` が組み立てる body は `{ storeId, subjectType, subjectId, stage, ...note }` のみ（同 218-226）。契約 `VisitEventInput` は `staffId: Uuid.optional()` を持ち（contracts:1985-1993）、worker も staffId を検証して visit_events.staff_id に書く用意がある（index.ts の visits ルート「進めた人も自分の組織・自分の店舗の在籍者だけ」）が、画面から送る経路が 1 つも無い。設備 id は契約自体に無い。
- **お客様・スタッフに起きること**: 「視力測定を誰が・どの測定機で始めたか」が記録されない。担当を選び直して工程を始めることができず、監査・分析でも担当が辿れない。

### recording-01 受付履歴の詳細 API が録音を常に null で返す（契約も null 固定）

- **重大度**: medium ／ **種別**: spec-ac-unimplemented ／ **仕様**: AC-REC-10 / UC-REC-07 / AC-REC-02
- **場所**: `services/glasses_management/src/worker/index.ts:8610`
- **根拠**: `GET /api/staff/reception-sessions/:sessionId` の応答が `ReceptionHistoryDetail.parse({ ..., recording: null })`（index.ts:8610、直前のコメントも「`recording` は P7（`010-recording`）が埋めるまで常に null である」）。契約側も packages/contracts/src/glasses_management.ts:2217 `recording: z.null().default(null)` で、そもそも録音を載せられない形のまま。`recordings_org_session_idx` はあるのに受付セッションから録音を引く SQL が 1 本も無い。
- **お客様・スタッフに起きること**: 受付履歴で 1 件を選んでも「受付のときの録音」の節が出ず、店長は履歴から録音を再生できない（AC-REC-10 / UC-REC-07 が実機で成立しない）。

### recording-04 送信失敗を端末がサーバへ知らせないため upload_attempts が増えず、3回失敗のお知らせが実運用で立たない

- **重大度**: medium ／ **種別**: broken-behavior ／ **仕様**: AC-REC-19
- **場所**: `services/glasses_management/src/web/recording/useRecorder.ts:248`
- **根拠**: `defaultApi()` は `create` と `send`（PUT .../content）しか持たず（useRecorder.ts:241-259）、`send` が失敗しても `return 'retry'` するだけで `PATCH /api/staff/recordings/:id`（state=failed）を呼ばない。サーバ側で `uploadAttempts` が増えるのは 413 の `countFailure()`（index.ts:8759-8785）と PATCH ルートだけ。したがって通信断や 500 で 3 回失敗しても `upload_attempts` は 0 のままで、`attempts >= RECORDING_ALERT_ATTEMPTS` に到達しない。e2e/recording.spec.ts:1139 の AC-REC-19 テストも PATCH を直接叩いており、実アプリの経路を通っていない。
- **お客様・スタッフに起きること**: 同じ録音が何度失敗しても「録音の保存に3回失敗しました／対応が必要」のお知らせが立たず、スタッフは端末に取り残された録音に気付けない。

### recording-05 3回失敗のお知らせに端末名が入らない（terminalName: null 固定）

- **重大度**: medium ／ **種別**: stub-or-fake ／ **仕様**: AC-REC-19
- **場所**: `services/glasses_management/src/worker/index.ts:2791`
- **根拠**: `raiseUploadFailedAlert()` が `uploadFailedAlert({ ..., terminalName: null })` を渡す（index.ts:2791、コメント「端末名は `terminals` 表ができる P10 まで `null`」）。domain/recording.ts:163 は `terminalName === null` のとき一句ごと落とす実装。`terminals` 表は既に存在し（index.ts:8575 で `terminals` を join して受付端末名を出している）、`reception_sessions.terminal_id` から辿れる。
- **お客様・スタッフに起きること**: お知らせを見ても「どの端末に録音が残っているか」が書かれず、別の端末で「もう一度送る」を押しても直らない状態で担当者が迷う。

### customers-02 手書きメモ 6 枚目の「置き換える」が保存されず、押しても何も起きない

- **重大度**: medium ／ **種別**: broken-behavior ／ **仕様**: AC-CUST-18
- **場所**: `services/glasses_management/src/web/customers/CustomerScreen.tsx:573`
- **根拠**: CustomerHandwrite.tsx:307 は `onSaveSheet({ svg: drawn, replacesId })` と置き換え対象を渡すが、CustomerScreen.tsx:573-582 の受け手は `json: { kind: 'memo', body: '', handwritingSvg: sheet.svg, storeId }` と `replacesId` を無視して新規 POST するだけ。worker 側 index.ts:7433-7440 は 5 枚を超える POST を `return c.json({ error: 'invalid_transition', sheets: room.sheets }, 409)` で拒み、画面は `res.ok ? loadSheets(...) : undefined` で 409 を握りつぶす（エラー表示すらしない）。置き換え・削除の API も存在しない（リポジトリ全体で `replacesId` は CustomerHandwrite 内にしか無い）。
- **お客様・スタッフに起きること**: 手書きが 5 枚たまったお客様では、書いた 1 枚を「この 1 枚と置き換える」で保存できず、ボタンを押しても画面が閉じるだけで筆跡が失われる。エラーも出ないので保存できたと誤解する。

### customers-06 おまとめ拒否時に「何が変わったかの差分」を出さず固定文言を表示している

- **重大度**: medium ／ **種別**: stub-or-fake ／ **仕様**: AC-CUST-15
- **場所**: `services/glasses_management/src/web/customers/CustomerScreen.tsx:384`
- **根拠**: CustomerScreen.tsx:380-387 は 409 を受けると `rejection: { changes: ['下見のあとに、いずれかの登録が動きました。もう一度下見してください。'] }` と常に同一の 1 行を入れる。サーバ index.ts:7229-7234 も `return c.json({ error: 'version_conflict' }, 409)` だけで、何が動いたか（増えた予約・メモ）を一切返していない。
- **お客様・スタッフに起きること**: 実行を拒まれた店長は「どの登録に何が入ったのか」を画面から知れず、下見をやり直しても同じ結果になるのか判断できない。

### settings-01 店舗まるごとの受付停止が保存できない（切り替えが常に無効）

- **重大度**: medium ／ **種別**: missing-feature ／ **仕様**: UC-SET-06
- **場所**: `services/glasses_management/src/web/settings/CalendarPanel.tsx:205`
- **根拠**: CalendarPanel.tsx:196-214 で `role="switch"` に `aria-disabled="true"` を付け、onClick を持たない読み取り専用の span を描き、コメントに「店舗まるごとの受付停止は、まだ保存する経路が無い（StorePatch に isActive の列が無い）」「いまは切り替えられません。」と書いている。契約側 packages/contracts/src/glasses_management.ts:240-251 の `StorePatch` にも `isActive` が無く、worker の PATCH /api/staff/stores/:storeId も受け取らない。
- **お客様・スタッフに起きること**: UC-SET-06 の「店舗まるごとの受付も止められる」ができない。臨時休業や設備トラブルで店を止めたいとき、店長は日付の丸を1日ずつ押して休みにするしかなく、Web予約を一括で止められない。

### settings-02 「最後にお受けできる時刻」が下書きに追随せず、保存前の確認にならない

- **重大度**: medium ／ **種別**: broken-behavior ／ **仕様**: UC-SET-05 / AC-SET-07
- **場所**: `services/glasses_management/src/web/settings/HoursPanel.tsx:220`
- **根拠**: HoursPanel.tsx:219-220 `const lastAcceptable = loaded.rules.lastAcceptableAt?.[String(weekday)] ?? null` — 表示元は GET /slot-rules で読んだ**保存済み**の値だけ。刻み・片付け・止める時間帯・開閉店を編集しても再計算・再取得されない（HoursPanel は POST /api/staff/settings/impact を1度も呼んでいない。grep 'impact' の結果に HoursPanel.tsx は現れない）。worker 側には index.ts:5710-5730 に下書きの rows/blackouts から `lastAcceptableAt` を返す `business_hours` 種別が実装済みだが未使用。
- **お客様・スタッフに起きること**: UC-SET-05 の「最後にお受けできる時刻を保存の前に確かめられる」が成立しない。店長は刻みや片付け時間を変えても保存するまで実際の最終受付時刻を知れず、閉店間際の予約可否を確かめずに保存することになる。

### settings-03 曜日ごとの営業時間の上書きが読むだけで編集できない

- **重大度**: medium ／ **種別**: missing-feature ／ **仕様**: UC-SET-03
- **場所**: `services/glasses_management/src/web/settings/HoursPanel.tsx:254`
- **根拠**: HoursPanel.tsx:254-271 の「曜日ごとの上書き」は `overrideLines(loaded.hours.rows).map(...)` で `<span>` を並べるだけで、input も button も無い。編集できるのは `baseHours` が返す最頻の開店・閉店（= 通常の営業時間）だけで、save() も `days.has(row.weekday)` の曜日のみ書き換える（HoursPanel.tsx:124-127）。
- **お客様・スタッフに起きること**: UC-SET-03 の「曜日ごとの上書きを直して保存できる」ができない。金曜だけ 21:00 まで、水曜を定休にする等の曜日別変更を画面から行えず、定休日の追加・解除も不可能。

### analytics-02 「予約数」日別グラフの縦軸が 24 件固定で、25 件以上の日は棒が枠外へはみ出す

- **重大度**: medium ／ **種別**: broken-behavior ／ **仕様**: AC-ANA-06 / AC-ANA-07
- **場所**: `services/glasses_management/src/web/analytics/OfficialTab.tsx:352`
- **根拠**: `target={report.selectedGranularity === 'day' ? 24 : undefined}` / `ticks={report.selectedGranularity === 'day' ? [24, 18, 12, 6, 0] : undefined}`。VerticalBars 側は `const scaleMaximum = gridTicks[0] ?? maximum`（OfficialTab.tsx:107）→ `style={{ height: `${(point.value / scaleMaximum) * 100}%` }}`（同 142）で、ticks が渡ると実データの最大値を無視して常に 24 で割る。
- **お客様・スタッフに起きること**: 1 日 25 件以上入る店舗では棒の高さが 100% を超えてプロット枠を突き抜け、目盛（24/18/12/6/0）も実際の値と合わない。混雑日の多寡がグラフから読めず、モックの数字（最大 24 件）でしか正しく描画されない。

### booking-01 満席時の代替時刻ボタンが選んだ時刻を捨てて日時選択に戻るだけ

- **重大度**: medium ／ **種別**: broken-behavior ／ **仕様**: AC-WEB-11 周辺（決めたこと「送信の瞬間に枠が埋まっていたときは BOOK-CONFLICT と同じ型（代わりの時刻を出す）に落とす」）
- **場所**: `services/glasses_management/src/web/public/PublicBookingRoot.tsx:296`
- **根拠**: PublicBookingRoot.tsx:295-296 `onReselect={() => editFrom(seam.step, 'datetime')}` / `onPickAlternative={() => editFrom(seam.step, 'datetime')}`。ConfirmStep.tsx:212-219 は代替時刻を `aria-label={`${jstClock(at)} に予約する`}` の押しボタンで並べ `onPickAlternative?.(at)` に時刻を渡しているが、受け側は引数 `at` を受け取らず捨て、「日時を選び直す」と全く同じ動き（history.go(-2)）になる。
- **お客様・スタッフに起きること**: 送信の瞬間に枠が埋まったお客様が「11:30 に予約する」を押しても、その時刻では予約されず日時選択の最初へ戻される。選び直しボタンと区別がつかず、二度手間になる。

### foundation-01 業務画面の器に <main> も画面名の見出しも無い（T-011 未実装）

- **重大度**: medium ／ **種別**: spec-ac-unimplemented ／ **仕様**: AC-FOUND-01
- **場所**: `services/glasses_management/src/web/shell/AppShell.tsx:194`
- **根拠**: AppShell の本文は `<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>`（194 行）だけで、`<main>` 要素も本文先頭の見出しも無い。`grep '<main\|<h1' AppShell.tsx App.tsx` のヒットは業務開始画面（App.tsx:110,113）のみで、Workspace 側には 1 件も無い。
- **お客様・スタッフに起きること**: スクリーンリーダーや見出しジャンプを使う店舗スタッフが本文へ直接飛べず、いま開いている画面の名前も読み上げで取れない。AC-FOUND-01 の「header / nav / main を 1 つずつ、本文先頭に画面名の見出し」を満たしていない。

### foundation-03 HOME 系以外の画面でもサイドバーに「トップ」の行が出る（行き先が 8 つのまま）

- **重大度**: medium ／ **種別**: broken-behavior ／ **仕様**: AC-FOUND-02
- **場所**: `services/glasses_management/src/web/shell/AppShell.tsx:135`
- **根拠**: `<NavItem destination={HOME_DESTINATION} ... />`（135-141 行）が current に関係なく無条件に描画されている。current による分岐は `current === 'alerts'` の ALERT_DESTINATION（173 行）だけ。
- **お客様・スタッフに起きること**: AC-FOUND-02 が定める「トップの行を持つのは HOME 系の 3 画面だけ、ほかの画面は 7 つ」に反し、どの画面でも行き先が 8 つ数えられる。読み上げでの件数照合と、上のバー ⌂ に集約するという設計が崩れる。

### foundation-04 コードのお店が見つからなくてもトークンが消えず、再読み込みで業務画面に入れてしまう

- **重大度**: medium ／ **種別**: broken-behavior ／ **仕様**: AC-FOUND-03
- **場所**: `services/glasses_management/src/web/App.tsx:94`
- **根拠**: StartWork は `await auth.login(orgId.trim())`（82 行）で sessionStorage にトークンと org を書いたあと `/api/staff/stores` を見て `if (rows.length === 0) { setError(...); return }`（94-99 行）で戻るだけ。`auth.logout()` を呼んでいない。`packages/shared/src/auth.ts:30-31` の login は `sessionStorage.setItem(TOKEN_KEY/ORG_KEY)` を済ませており、`App`（51-52 行）は `auth.getOrganization()` があれば Workspace を描画する。
- **お客様・スタッフに起きること**: 「このコードのお店が見つかりませんでした」と出た直後に画面を再読み込みすると、存在しないコードのまま業務画面へ入れる。AC-FOUND-03 の「業務画面へ入れず、入口に留まる」が破れる。

### foundation-08 店舗を切り替えても台帳の日付と受付履歴の絞り込みが既定へ戻らない

- **重大度**: medium ／ **種別**: missing-feature ／ **仕様**: none
- **場所**: `services/glasses_management/src/web/App.tsx:752`
- **根拠**: `onSwitchStore={setSelectedStoreId}`（752 行）だけで、`historyQuery`（168 行）・`barCenter`（164 行）・`openReservation`（145 行）などの前の店舗の状態を初期化していない。切り替え専用のリセット関数は App.tsx に存在しない。
- **お客様・スタッフに起きること**: 別店舗へ切り替えたあとも前の店舗の絞り込み条件や上のバーの日付の帯が残り、別店舗のご予約を誤って触るおそれがある。T-016 の「切り替えたら台帳の日付と絞り込みを既定へ戻す」が未実装。

### foundation-09 店舗の切り替えが上のバーの店名からではなくトップ画面のチップからしかできない

- **重大度**: medium ／ **種別**: missing-feature ／ **仕様**: none
- **場所**: `services/glasses_management/src/web/App.tsx:937`
- **根拠**: 切り替え UI は Home の `<section aria-label="ほかのお店">` 内のチップ（937-957 行）のみ。AppShell の店名は `<p className="truncate text-bar font-bold">{storeName}</p>`（AppShell.tsx:88）で、押せる要素ではない。
- **お客様・スタッフに起きること**: 台帳や受付を開いている最中は店舗を切り替えられず、いったんトップへ戻る必要がある。T-016 の「上のバーの店名から担当店舗の一覧を開いて選び直す」が未実装。

### foundation-10 上のバーのお知らせのバッジが 4 画面でしか出ない（常設の入口になっていない）

- **重大度**: medium ／ **種別**: broken-behavior ／ **仕様**: AC-FOUND-02
- **場所**: `services/glasses_management/src/web/shell/AppShell.tsx:18`
- **根拠**: `const HEADER_ALERT_DESTINATIONS = new Set(['home', 'ledger', 'customers', 'settings'])`（18 行）で、93 行の `HEADER_ALERT_DESTINATIONS.has(current) && alertCount > 0` によりバッジの描画を絞っている。来店受付・予約を探す・受付履歴・分析ではバッジ自体が出ない。
- **お客様・スタッフに起きること**: AC-FOUND-02 の「お知らせの常設の入口は上のバーのバッジ」に反し、4 画面では『録音の保存に3回失敗しました（対応が必要）』に気づけない。ソース内コメント自身が UX 監査 UI-05 として未解決の宿題と認めている。

