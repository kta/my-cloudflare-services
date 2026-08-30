# glasses_management 設計 08 — 追跡表（UC/AC ↔ 画面 ↔ E2E）

- サービス: `glasses_management`（`@app/glasses_management`）
- UC/AC の**定義の正本**: `specs/glasses_management/features/<NNN>-<slug>/spec.md`（11 本）
- 画面 ID の正本: `design/05-screen-flow.md` §3 と `docs/frontend/mockups/eyex/screens/*.html`（68 枚）
- E2E の正本: `services/glasses_management/e2e/*.spec.ts`
- validator: `scripts/check-e2e-traceability.mjs`（`pnpm run test:traceability`）

---

## 1. この表の読み方

本書は**人が読むための地図**である。「この受け入れ基準は、どの画面で、どの E2E が守るのか」を 1 行で引けるようにしてある。

- **validator の分母ではない。** 分母は `spec.md` 側にしか無い（§3）。本書を直しても validator の判定は 1 ミリも動かない。
- **UC/AC の定義を本書に書かない。** 本書の ID は**必ず表のセル**に置く。`design/**` は `spec.md` で終わらないので validator の走査対象外だが、
  定義の置き場所を 2 つにすると「どちらが正か」が生まれる。決定ブリーフ §8 の「design 側は参照だけにする」に従う。
- **食い違ったら `spec.md` が正。** 本書と feature spec がずれたときは feature spec を信じ、本書を直す。
- 表の 5 列はそれぞれ次を指す。

| 列 | 何を書くか |
|---|---|
| ID | feature spec が定義している `UC-` / `AC-` の識別子そのもの |
| 内容 | 20 字以内の要約。正確な文面は feature spec を読む |
| 画面ID | `design/05-screen-flow.md` §3 の画面 ID。画面を持たない（API・エンジン・Cron）ものは `—` を付ける |
| E2E ファイル | その ID を `@e2e-covers` で受け持つ Playwright ファイル。まだ無いものは「未」 |
| 状態 | 実装済 / 未着手 |

**「未」と「未着手」は正常な状態である。** spec を Draft で置いている間、E2E は無くてよい（§3）。

---

## 2. フェーズ × UC/AC × 画面 × E2E

フェーズと feature の対応は決定ブリーフ §7 のとおり。E2E ファイルは各 feature spec の「触るファイル」が名指ししているものを引いた。

| フェーズ | feature spec | ステータス | E2E ファイル | UC/AC 件数 | 状態 |
|---|---|---|---|---|---|
| P0 | `features/003-service-foundation` | Approved | `e2e/foundation.spec.ts` | 5 | 実装済 |
| P1 | `features/004-store-settings` | Draft | `e2e/store-settings.spec.ts`（未） | 36 | 未着手 |
| P2 | `features/005-availability-and-ledger` | Draft | `e2e/ledger.spec.ts`（未） | 33 | 未着手 |
| P3 | `features/006-booking-flow` | Draft | `e2e/booking-flow.spec.ts`（未） | 36 | 未着手 |
| P4 | `features/007-customer-records` | Draft | `e2e/customer-records.spec.ts`（未） | 40 | 未着手 |
| P5 | `features/008-reception-and-walkin` | Draft | `e2e/reception.spec.ts`（未） | 44 | 未着手 |
| P6 | `features/009-change-and-cancel` | Draft | `e2e/change-and-cancel.spec.ts`（未） | 36 | 未着手 |
| P7 | `features/010-recording` | Draft | `e2e/recording.spec.ts`（未） | 28 | 未着手 |
| P8 | `features/011-web-booking` | Draft | `e2e/web-booking.spec.ts`（未） | 36 | 未着手 |
| P9 | `features/012-analytics` | Draft | `e2e/analytics.spec.ts`（未） | 31 | 未着手 |
| P10 | `features/013-terminals-and-audit` | Draft | `e2e/terminals.spec.ts`（未） | 38 | 未着手 |

合計 **363 件**。

### 2.1 P0 サービスの土台（`FOUND` / 5 件 / Approved）

`e2e/foundation.spec.ts` は 5 件すべてを 1 対 1 で受け持っており、validator が現に緑である。

| ID | 内容 | 画面ID | E2E ファイル | 状態 |
|---|---|---|---|---|
| AC-FOUND-01 | 業務画面の器が立つ | HOME | `e2e/foundation.spec.ts` | 実装済 |
| AC-FOUND-02 | サイドバーをたたむ・ひらく | HOME | `e2e/foundation.spec.ts` | 実装済 |
| AC-FOUND-03 | 店舗が 0 件のときの文 | HOME | `e2e/foundation.spec.ts` | 実装済 |
| AC-FOUND-04 | 業務を終えて資格情報を消す | HOME-PERSONAL | `e2e/foundation.spec.ts` | 実装済 |
| AC-FOUND-05 | ヘルスは認証なしで ok | —（API） | `e2e/foundation.spec.ts` | 実装済 |

### 2.2 P1 店舗の受付条件（`SET` / 36 件 / Draft）

| ID | 内容 | 画面ID | E2E ファイル | 状態 |
|---|---|---|---|---|
| UC-SET-01 | 店舗の情報を直して保存 | SETTINGS-STORE | 未 | 未着手 |
| UC-SET-02 | 紹介文を 200 字以内で保存 | SETTINGS-STORE | 未 | 未着手 |
| UC-SET-03 | 営業時間と曜日の上書き | SETTINGS-HOURS | 未 | 未着手 |
| UC-SET-04 | 受付を止める時間帯を足す | SETTINGS-HOURS | 未 | 未着手 |
| UC-SET-05 | 予約の間隔と最終受付時刻 | SETTINGS-HOURS | 未 | 未着手 |
| UC-SET-06 | 臨時のお休みと受付停止 | SETTINGS-CALENDAR | 未 | 未着手 |
| UC-SET-07 | スタッフの技能を切り替える | SETTINGS-STAFF | 未 | 未着手 |
| UC-SET-08 | 曜日ごとの勤務時間を直す | SETTINGS-STAFF | 未 | 未着手 |
| UC-SET-09 | 設備を止めて影響を数える | SETTINGS-EQUIPMENT | 未 | 未着手 |
| UC-SET-10 | 目的を直し Web 枠を数える | SETTINGS-PURPOSE | 未 | 未着手 |
| UC-SET-11 | 切り替えを指でも読み上げでも | SETTINGS-EQUIPMENT | 未 | 未着手 |
| UC-SET-12 | スタッフを足す・退職は残す | SETTINGS-STAFF | 未 | 未着手 |
| UC-SET-13 | 設備を足す・廃棄は残す | SETTINGS-EQUIPMENT | 未 | 未着手 |
| UC-SET-14 | 目的を足して並び順を決める | SETTINGS-PURPOSE | 未 | 未着手 |
| AC-SET-01 | 設定から店舗の情報を開く | SETTINGS-STORE | 未 | 未着手 |
| AC-SET-02 | 2 項目を直すと未保存 2 件 | SETTINGS-STORE | 未 | 未着手 |
| AC-SET-03 | キャンセルで編集前へ戻る | SETTINGS-STORE | 未 | 未着手 |
| AC-SET-04 | 紹介文 200 字と 201 字の境 | SETTINGS-STORE | 未 | 未着手 |
| AC-SET-05 | 閉店が開店より前は拒む | SETTINGS-HOURS | 未 | 未着手 |
| AC-SET-06 | 止める時間帯が 1 行増える | SETTINGS-HOURS | 未 | 未着手 |
| AC-SET-07 | 最後にお受けできるのは 18:20 | SETTINGS-HOURS | 未 | 未着手 |
| AC-SET-08 | 9月30日を臨時のお休みに | SETTINGS-CALENDAR | 未 | 未着手 |
| AC-SET-09 | もう一度押すと営業日へ戻る | SETTINGS-CALENDAR | 未 | 未着手 |
| AC-SET-10 | 佐藤 美咲の技能に ✓ が付く | SETTINGS-STAFF | 未 | 未着手 |
| AC-SET-11 | 技能を足すと一覧に出る | SETTINGS-STAFF | 未 | 未着手 |
| AC-SET-12 | 勤務が営業時間外でも警告のみ | SETTINGS-STAFF | 未 | 未着手 |
| AC-SET-13 | 止めると影響するご予約 3 件 | SETTINGS-EQUIPMENT | 未 | 未着手 |
| AC-SET-14 | 影響 0 件なら札を赤くしない | SETTINGS-EQUIPMENT | 未 | 未着手 |
| AC-SET-15 | 60 分に延ばすと Web 枠 2 件 | SETTINGS-PURPOSE | 未 | 未着手 |
| AC-SET-16 | Web 公開を切ると 5 件になる | SETTINGS-PURPOSE | 未 | 未着手 |
| AC-SET-17 | スタッフ権限では保存できない | EX-PERMISSION | 未 | 未着手 |
| AC-SET-18 | 切り替えは状態つきで読まれる | SETTINGS-EQUIPMENT | 未 | 未着手 |
| AC-SET-19 | 件数の変化は割り込まない | SETTINGS-EQUIPMENT | 未 | 未着手 |
| AC-SET-20 | スタッフを足すと 7 名になる | SETTINGS-STAFF | 未 | 未着手 |
| AC-SET-21 | 設備を足すと台帳に行が出る | SETTINGS-EQUIPMENT | 未 | 未着手 |
| AC-SET-22 | 目的を足すと 7 件になる | SETTINGS-PURPOSE | 未 | 未着手 |

### 2.3 P2 空き枠と予約台帳（`LEDGER` / 33 件 / Draft）

| ID | 内容 | 画面ID | E2E ファイル | 状態 |
|---|---|---|---|---|
| UC-LEDGER-01 | 担当者別で当日の台帳を読む | LEDGER-STAFF | 未 | 未着手 |
| UC-LEDGER-02 | 設備・場所別に切り替える | LEDGER-RESOURCE | 未 | 未着手 |
| UC-LEDGER-03 | 予約リストで時間順に読む | LEDGER-LIST | 未 | 未着手 |
| UC-LEDGER-04 | 帯を押して詳細を開く | LEDGER-DETAIL | 未 | 未着手 |
| UC-LEDGER-05 | 日付を移し本日へ戻す | LEDGER-STAFF | 未 | 未着手 |
| UC-LEDGER-06 | 現在時刻を線と札で示す | LEDGER-STAFF | 未 | 未着手 |
| UC-LEDGER-07 | 置ける時刻と空き数を求める | —（空き枠エンジン） | 未 | 未着手 |
| UC-LEDGER-08 | 未定のまま押さえた枠を読む | LEDGER-STAFF | 未 | 未着手 |
| UC-LEDGER-09 | 通信断でも読み取り専用で読む | EX-OFFLINE | 未 | 未着手 |
| UC-LEDGER-10 | 詳細を閉じて元の帯へ戻る | LEDGER-DETAIL | 未 | 未着手 |
| UC-LEDGER-11 | 個人トップで自分の担当を読む | HOME-PERSONAL | 未 | 未着手 |
| AC-LEDGER-01 | 台帳を開くと担当の行が並ぶ | LEDGER-STAFF | 未 | 未着手 |
| AC-LEDGER-02 | 30 分刻み 14 列を表示窓に | LEDGER-STAFF | 未 | 未着手 |
| AC-LEDGER-03 | 現在 11:08 の線と札 | LEDGER-STAFF | 未 | 未着手 |
| AC-LEDGER-04 | 翌日へ送ると線と札が消える | LEDGER-STAFF | 未 | 未着手 |
| AC-LEDGER-05 | 出どころ 4 語を文字で出す | LEDGER-STAFF | 未 | 未着手 |
| AC-LEDGER-06 | 60 分帯だけ短い目的名を出す | LEDGER-STAFF | 未 | 未着手 |
| AC-LEDGER-07 | 担当が未定の行に帯を置く | LEDGER-STAFF | 未 | 未着手 |
| AC-LEDGER-08 | ご来店お待ちの帯を最下段に | LEDGER-STAFF | 未 | 未着手 |
| AC-LEDGER-09 | 設備軸へ縦を入れ替える | LEDGER-RESOURCE | 未 | 未着手 |
| AC-LEDGER-10 | 1 件の帯が 2 行に同時に出る | LEDGER-RESOURCE | 未 | 未着手 |
| AC-LEDGER-11 | 点検の帯と「いま空いています」 | LEDGER-RESOURCE | 未 | 未着手 |
| AC-LEDGER-12 | 予約リストの列見出しと札 | LEDGER-LIST | 未 | 未着手 |
| AC-LEDGER-13 | 「これから」で 7 行に減る | LEDGER-LIST | 未 | 未着手 |
| AC-LEDGER-14 | 担当欄が「決めてください」 | LEDGER-LIST | 未 | 未着手 |
| AC-LEDGER-15 | 詳細の中身と下段の 3 操作 | LEDGER-DETAIL | 未 | 未着手 |
| AC-LEDGER-16 | 片付け 10 分で 12:00 は不可 | —（空き枠エンジン） | 未 | 未着手 |
| AC-LEDGER-17 | 未定込みで上限 3 件は満席 | —（空き枠エンジン） | 未 | 未着手 |
| AC-LEDGER-18 | 通信が切れた帯と再接続 | EX-OFFLINE | 未 | 未着手 |
| AC-LEDGER-19 | 詳細を閉じて焦点が帯へ戻る | LEDGER-DETAIL | 未 | 未着手 |
| AC-LEDGER-20 | 台帳を格子としてキーで辿る | LEDGER-STAFF | 未 | 未着手 |
| AC-LEDGER-21 | 個人トップに担当 4 件が並ぶ | HOME-PERSONAL | 未 | 未着手 |
| AC-LEDGER-22 | 定休日は空の格子を出さない | LEDGER-STAFF | 未 | 未着手 |

### 2.4 P3 予約の 5 工程（`BOOK` / 36 件 / Draft）

| ID | 内容 | 画面ID | E2E ファイル | 状態 |
|---|---|---|---|---|
| UC-BOOK-01 | お日にちとお時間を伺う | BOOK-01-DATETIME | 未 | 未着手 |
| UC-BOOK-02 | 目的を伺い所要時間を決める | BOOK-02-PURPOSE | 未 | 未着手 |
| UC-BOOK-03 | 収まらない時刻を言い換える | BOOK-02b-PURPOSE-CONFLICT | 未 | 未着手 |
| UC-BOOK-04 | 担当を決め重なりを知る | BOOK-03-SLOT-STAFF | 未 | 未着手 |
| UC-BOOK-05 | 縦軸を設備・場所に入れ替える | BOOK-03b-SLOT-RESOURCE | 未 | 未着手 |
| UC-BOOK-06 | 帯をつかんで運ぶ | BOOK-03c-DRAG | 未 | 未着手 |
| UC-BOOK-07 | 担当・設備を未定のまま進む | BOOK-03-SLOT-STAFF | 未 | 未着手 |
| UC-BOOK-08 | テンキーでお電話番号を伺う | BOOK-04c-KEYPAD | 未 | 未着手 |
| UC-BOOK-09 | お名前とふりがなだけで進む | BOOK-04-CUSTOMER | 未 | 未着手 |
| UC-BOOK-10 | ご要望を手書きのまま残す | BOOK-04d-HANDWRITE | 未 | 未着手 |
| UC-BOOK-11 | 復唱して確定し番号を伝える | BOOK-05-CONFIRM | 未 | 未着手 |
| UC-BOOK-12 | 確定の瞬間の枠競合を選び直す | BOOK-CONFLICT | 未 | 未着手 |
| UC-BOOK-13 | 入力を失わず 1 工程戻る | BOOK-04-CUSTOMER | 未 | 未着手 |
| UC-BOOK-14 | 確認を受けてから破棄する | BOOK-01〜06 | 未 | 未着手 |
| UC-BOOK-15 | 工程と進めない理由を読める | BOOK-04-CUSTOMER | 未 | 未着手 |
| AC-BOOK-01 | 日時が未選択なら次へ不可 | BOOK-01-DATETIME | 未 | 未着手 |
| AC-BOOK-02 | 目的を押すと 60 分標準が付く | BOOK-02-PURPOSE | 未 | 未着手 |
| AC-BOOK-03 | 収まらない理由と代替 3 つ | BOOK-02b-PURPOSE-CONFLICT | 未 | 未着手 |
| AC-BOOK-04 | 代替時刻で時刻だけ差し替わる | BOOK-02b-PURPOSE-CONFLICT | 未 | 未着手 |
| AC-BOOK-05 | 先約と重なると次へ不可 | BOOK-03-SLOT-STAFF | 未 | 未着手 |
| AC-BOOK-06 | 候補の担当へ移すと解ける | BOOK-03-SLOT-STAFF | 未 | 未着手 |
| AC-BOOK-07 | 軸を戻しても担当が残る | BOOK-03b-SLOT-RESOURCE | 未 | 未着手 |
| AC-BOOK-08 | 帯を運ぶ・置けない場所の理由 | BOOK-03c-DRAG | 未 | 未着手 |
| AC-BOOK-09 | あとで決めるでも枠は消費する | BOOK-03-SLOT-STAFF | 未 | 未着手 |
| AC-BOOK-10 | 「あと3桁」で完了が押せない | BOOK-04c-KEYPAD | 未 | 未着手 |
| AC-BOOK-11 | 名前とかなだけで次へ進める | BOOK-04-CUSTOMER | 未 | 未着手 |
| AC-BOOK-12 | 手書きのまま残し変換は出さない | BOOK-04d-HANDWRITE | 未 | 未着手 |
| AC-BOOK-13 | 復唱文と EY-2608-0142 | BOOK-05-CONFIRM | 未 | 未着手 |
| AC-BOOK-14 | 二度押しても予約は 1 件 | BOOK-05-CONFIRM | 未 | 未着手 |
| AC-BOOK-15 | 先に確定されていたときの面 | BOOK-CONFLICT | 未 | 未着手 |
| AC-BOOK-16 | 戻っても入力が残っている | BOOK-04-CUSTOMER | 未 | 未着手 |
| AC-BOOK-17 | やめるは 2 択で確認する | BOOK-01〜06 | 未 | 未着手 |
| AC-BOOK-18 | 録音の表示の場所を確保する | BOOK-01〜06 | 未 | 未着手 |
| AC-BOOK-19 | 工程と押せない理由を読む | BOOK-04-CUSTOMER | 未 | 未着手 |
| AC-BOOK-20 | テンキーで OS の鍵盤を出さない | BOOK-04c-KEYPAD | 未 | 未着手 |
| AC-BOOK-21 | ふりがなは確定時に一度だけ | BOOK-04-CUSTOMER | 未 | 未着手 |

### 2.5 P4 顧客台帳（`CUST` / 40 件 / Draft）

| ID | 内容 | 画面ID | E2E ファイル | 状態 |
|---|---|---|---|---|
| UC-CUST-01 | 名前・かな・番号で探す | CUSTOMER-LIST | 未 | 未着手 |
| UC-CUST-02 | 並べ方と絞り込みの人数 | CUSTOMER-LIST | 未 | 未着手 |
| UC-CUST-03 | 選んだお客様の要約を読む | CUSTOMER-LIST | 未 | 未着手 |
| UC-CUST-04 | 詳細で度数と注意ごとを読む | CUSTOMER-DETAIL | 未 | 未着手 |
| UC-CUST-05 | 番号を入れ終えて候補を得る | BOOK-04b-CUSTOMER-MATCH | 未 | 未着手 |
| UC-CUST-06 | 候補を選ぶか退ける | BOOK-04b-CUSTOMER-MATCH | 未 | 未着手 |
| UC-CUST-07 | 新しいお客様を登録する | CUSTOMER-NEW | 未 | 未着手 |
| UC-CUST-08 | 同じ番号の登録に気づく | CUSTOMER-NEW | 未 | 未着手 |
| UC-CUST-09 | 項目ごとに選んでまとめる | CUSTOMER-MERGE | 未 | 未着手 |
| UC-CUST-10 | 手書きを新しい順に見返す | CUSTOMER-HANDWRITE | 未 | 未着手 |
| UC-CUST-11 | 読み取った文字を直して残す | CUSTOMER-HANDWRITE | 未 | 未着手 |
| UC-CUST-12 | 注意ごとの登録を申し込む | CUSTOMER-HANDWRITE | 未 | 未着手 |
| UC-CUST-13 | 候補の面でも録音を見失わない | BOOK-04b-CUSTOMER-MATCH | 未 | 未着手 |
| UC-CUST-14 | 顧客台帳から予約を取り始める | CUSTOMER-DETAIL | 未 | 未着手 |
| AC-CUST-01 | 下 4 桁の後方一致で引く | CUSTOMER-LIST | 未 | 未着手 |
| AC-CUST-02 | かなでも名前でも同じ行 | CUSTOMER-LIST | 未 | 未着手 |
| AC-CUST-03 | 回数順と絞り込みで 42 名 | CUSTOMER-LIST | 未 | 未着手 |
| AC-CUST-04 | 11 桁で候補 2 件・前方一致 | BOOK-04b-CUSTOMER-MATCH | 未 | 未着手 |
| AC-CUST-05 | 全桁一致でも自動確定しない | BOOK-04b-CUSTOMER-MATCH | 未 | 未着手 |
| AC-CUST-06 | 候補を選ぶと欄が埋まる | BOOK-04b-CUSTOMER-MATCH | 未 | 未着手 |
| AC-CUST-07 | どちらでもありませんで閉じる | BOOK-04b-CUSTOMER-MATCH | 未 | 未着手 |
| AC-CUST-08 | 一覧の要約 4 項目が同時に出る | CUSTOMER-LIST | 未 | 未着手 |
| AC-CUST-09 | 度数の移り変わりと現行の札 | CUSTOMER-DETAIL | 未 | 未着手 |
| AC-CUST-10 | 来店回数は来店済みで数える | CUSTOMER-LIST | 未 | 未着手 |
| AC-CUST-11 | 同じ番号のお客様がいます | CUSTOMER-NEW | 未 | 未着手 |
| AC-CUST-12 | 別の方として登録すると 2 件 | CUSTOMER-NEW | 未 | 未着手 |
| AC-CUST-13 | 選んだ 1 名だけが予約に付く | BOOK-04b-CUSTOMER-MATCH | 未 | 未着手 |
| AC-CUST-14 | まとめの下見と失われるもの | CUSTOMER-MERGE | 未 | 未着手 |
| AC-CUST-15 | 下見のあとの更新は拒む | CUSTOMER-MERGE | 未 | 未着手 |
| AC-CUST-16 | 店長以外はまとめの入口が無い | CUSTOMER-LIST | 未 | 未着手 |
| AC-CUST-17 | 他組織の顧客 ID は 404 | —（API） | 未 | 未着手 |
| AC-CUST-18 | 手書き 1 枚が 4 枚目に残る | CUSTOMER-HANDWRITE | 未 | 未着手 |
| AC-CUST-19 | 文字だけ直し筆跡は残す | CUSTOMER-HANDWRITE | 未 | 未着手 |
| AC-CUST-20 | 申し込みでは注意ごとにしない | CUSTOMER-HANDWRITE | 未 | 未着手 |
| AC-CUST-21 | 候補の面の読み上げと焦点復帰 | BOOK-04b-CUSTOMER-MATCH | 未 | 未着手 |
| AC-CUST-22 | 手順の文を飾りとして薄めない | BOOK-04b-CUSTOMER-MATCH | 未 | 未着手 |
| AC-CUST-23 | 手書き中は背後がスクロールしない | CUSTOMER-HANDWRITE | 未 | 未着手 |
| AC-CUST-24 | 帯にお名前と来店回数の印 | LEDGER-STAFF | 未 | 未着手 |
| AC-CUST-25 | 詳細の見出しにお名前が出る | LEDGER-DETAIL | 未 | 未着手 |
| AC-CUST-26 | 顧客から予約の工程 4 が埋まる | CUSTOMER-DETAIL | 未 | 未着手 |

### 2.6 P5 来店受付とウォークイン（`RECEP` / 44 件 / Draft）

| ID | 内容 | 画面ID | E2E ファイル | 状態 |
|---|---|---|---|---|
| UC-RECEP-01 | 予約のお客様を受け付ける | RECEPTION-CHECKIN | 未 | 未着手 |
| UC-RECEP-02 | 確かめることを 1 行ずつ消す | RECEPTION-CHECKIN | 未 | 未着手 |
| UC-RECEP-03 | お待ちいただき盤面に載せる | RECEPTION-CHECKIN | 未 | 未着手 |
| UC-RECEP-04 | 工程を 1 枚で見る | RECEPTION-JOURNEY | 未 | 未着手 |
| UC-RECEP-05 | 工程と担当と設備を書き換える | RECEPTION-JOURNEY | 未 | 未着手 |
| UC-RECEP-06 | 特定しないまま受け付ける | LEDGER-WALKIN | 未 | 未着手 |
| UC-RECEP-07 | お待ちの人数と経過を見る | LEDGER-STAFF | 未 | 未着手 |
| UC-RECEP-08 | 既存のお客様へ結びつける | LEDGER-WALKIN | 未 | 未着手 |
| UC-RECEP-09 | 新規登録して結びつける | LEDGER-WALKIN | 未 | 未着手 |
| UC-RECEP-10 | 特定しない来店を履歴で探す | HISTORY-LIST | 未 | 未着手 |
| UC-RECEP-11 | 来店の結果を残す | HISTORY-LIST | 未 | 未着手 |
| UC-RECEP-12 | 受付と変更を時系列で読む | HISTORY-LIST | 未 | 未着手 |
| UC-RECEP-13 | 0 件で条件を緩めて開き直す | HISTORY-EMPTY | 未 | 未着手 |
| UC-RECEP-14 | 退店を記録し来店中から外す | RECEPTION-JOURNEY | 未 | 未着手 |
| UC-RECEP-15 | 待ちのまま帰られた事実を残す | LEDGER-STAFF | 未 | 未着手 |
| UC-RECEP-16 | 履歴を名前で絞り予約を開く | HISTORY-LIST | 未 | 未着手 |
| AC-RECEP-01 | 5 分早くお着きですと出る | RECEPTION-CHECKIN | 未 | 未着手 |
| AC-RECEP-02 | 受付欄が「済みました 10:55」 | RECEPTION-CHECKIN | 未 | 未着手 |
| AC-RECEP-03 | 注意ごとに「要確認」の札 | RECEPTION-CHECKIN | 未 | 未着手 |
| AC-RECEP-04 | お待ちいただくと待ちで出る | RECEPTION-CHECKIN | 未 | 未着手 |
| AC-RECEP-05 | 登録を求めず受付と接客が進む | LEDGER-WALKIN | 未 | 未着手 |
| AC-RECEP-06 | 整理番号ウォークイン 005 | LEDGER-WALKIN | 未 | 未着手 |
| AC-RECEP-07 | お待ち 2 名の帯と経過 6 分 | LEDGER-STAFF | 未 | 未着手 |
| AC-RECEP-08 | 既存客に結ぶと名前に変わる | LEDGER-WALKIN | 未 | 未着手 |
| AC-RECEP-09 | 新規客の初めてのご来店になる | LEDGER-WALKIN | 未 | 未着手 |
| AC-RECEP-10 | 前日の 003 が履歴に残る | HISTORY-LIST | 未 | 未着手 |
| AC-RECEP-11 | ボードの列とご来店中 4 名 | RECEPTION-JOURNEY | 未 | 未着手 |
| AC-RECEP-12 | 工程を始めると対応中になる | RECEPTION-JOURNEY | 未 | 未着手 |
| AC-RECEP-13 | 赤地と「お待たせ中 18分」 | RECEPTION-JOURNEY | 未 | 未着手 |
| AC-RECEP-14 | 次の担当が勤務外だと出る | RECEPTION-JOURNEY | 未 | 未着手 |
| AC-RECEP-15 | 次の設備が点検中だと出る | RECEPTION-JOURNEY | 未 | 未着手 |
| AC-RECEP-16 | 結果を「ご来店なし」で残す | HISTORY-LIST | 未 | 未着手 |
| AC-RECEP-17 | 受け付けた人とそのあとの変更 | HISTORY-LIST | 未 | 未着手 |
| AC-RECEP-18 | 0 件で件数つきの緩める案 | HISTORY-EMPTY | 未 | 未着手 |
| AC-RECEP-19 | ボードは表として読まれる | RECEPTION-JOURNEY | 未 | 未着手 |
| AC-RECEP-20 | キーボードで工程を進められる | RECEPTION-JOURNEY | 未 | 未着手 |
| AC-RECEP-21 | 0 件が手を止めずに読まれる | HISTORY-EMPTY | 未 | 未着手 |
| AC-RECEP-22 | リストの「ご来店」も同じ面へ | LEDGER-LIST | 未 | 未着手 |
| AC-RECEP-23 | 退店でご来店中 3 名になる | RECEPTION-JOURNEY | 未 | 未着手 |
| AC-RECEP-24 | 待ちのまま帰られると 1 名に | LEDGER-STAFF | 未 | 未着手 |
| AC-RECEP-25 | お客様名で履歴を絞り込む | HISTORY-LIST | 未 | 未着手 |
| AC-RECEP-26 | 履歴から予約を開いて戻る | HISTORY-LIST | 未 | 未着手 |
| AC-RECEP-27 | ご来店中 0 名でも行き止まらない | RECEPTION-JOURNEY | 未 | 未着手 |
| AC-RECEP-28 | 20 件ずつ読み足す | HISTORY-LIST | 未 | 未着手 |

### 2.7 P6 予約の変更と取消（`CHANGE` / 36 件 / Draft）

| ID | 内容 | 画面ID | E2E ファイル | 状態 |
|---|---|---|---|---|
| UC-CHANGE-01 | 予約を探し一覧と詳細を見る | CHANGE-SEARCH | 未 | 未着手 |
| UC-CHANGE-02 | 0 件で条件を外す案を得る | EX-EMPTY-SEARCH | 未 | 未着手 |
| UC-CHANGE-03 | 収まる時刻だけから選び直す | CHANGE-DATETIME | 未 | 未着手 |
| UC-CHANGE-04 | 変わる行だけを見分ける | CHANGE-DIFF | 未 | 未着手 |
| UC-CHANGE-05 | 変更後の姿を確かめて終える | CHANGE-DONE | 未 | 未着手 |
| UC-CHANGE-06 | 担当と場所だけを置き直す | CHANGE-DATETIME | 未 | 未着手 |
| UC-CHANGE-07 | 理由を選んで取り消す | CHANGE-CANCEL | 未 | 未着手 |
| UC-CHANGE-08 | 相手と自分を並べて選ぶ | EX-CONFLICT | 未 | 未着手 |
| UC-CHANGE-09 | 先に枠を確保してから切り替える | CHANGE-DATETIME | 未 | 未着手 |
| UC-CHANGE-10 | 変更・取消をあとからたどる | HISTORY-LIST | 未 | 未着手 |
| AC-CHANGE-01 | 「田中」で結果 4 件 | CHANGE-SEARCH | 未 | 未着手 |
| AC-CHANGE-02 | かなで漢字の予約が出る | CHANGE-SEARCH | 未 | 未着手 |
| AC-CHANGE-03 | 下 4 桁だけで引ける | CHANGE-SEARCH | 未 | 未着手 |
| AC-CHANGE-04 | 予約番号で 1 件に絞れる | CHANGE-SEARCH | 未 | 未着手 |
| AC-CHANGE-05 | 他店の同名は結果に出ない | CHANGE-SEARCH | 未 | 未着手 |
| AC-CHANGE-06 | 「今日」で 3 件に絞る | CHANGE-SEARCH | 未 | 未着手 |
| AC-CHANGE-07 | 「取消済み」で結果に加わる | CHANGE-SEARCH | 未 | 未着手 |
| AC-CHANGE-08 | 行を押すと右に詳細が出る | CHANGE-SEARCH | 未 | 未着手 |
| AC-CHANGE-09 | 0 件でも条件はそのまま残る | EX-EMPTY-SEARCH | 未 | 未着手 |
| AC-CHANGE-10 | 条件を 1 つ外すと 5 件 | EX-EMPTY-SEARCH | 未 | 未着手 |
| AC-CHANGE-11 | 60 分が取れる時刻だけ出す | CHANGE-DATETIME | 未 | 未着手 |
| AC-CHANGE-12 | 別端末では 14:00 が満席 | CHANGE-DATETIME | 未 | 未着手 |
| AC-CHANGE-13 | 変わる行だけに変更の札 | CHANGE-DIFF | 未 | 未着手 |
| AC-CHANGE-14 | 戻ると変更は残っていない | CHANGE-DIFF | 未 | 未着手 |
| AC-CHANGE-15 | 予約番号は変わりません | CHANGE-DONE | 未 | 未着手 |
| AC-CHANGE-16 | 理由なしでは取り消せない | CHANGE-CANCEL | 未 | 未着手 |
| AC-CHANGE-17 | 取消でその枠が案内できる | CHANGE-DONE | 未 | 未着手 |
| AC-CHANGE-18 | 履歴に変更前後が 1 行で並ぶ | HISTORY-LIST | 未 | 未着手 |
| AC-CHANGE-19 | ほかの端末でも直していた面 | EX-CONFLICT | 未 | 未着手 |
| AC-CHANGE-20 | 上書き前に空きを当て直す | EX-CONFLICT | 未 | 未着手 |
| AC-CHANGE-21 | 焦点は「取り消さずに戻る」 | CHANGE-CANCEL | 未 | 未着手 |
| AC-CHANGE-22 | 0 件が件数つきで読まれる | EX-EMPTY-SEARCH | 未 | 未着手 |
| AC-CHANGE-23 | 相手の内容を残して捨てる | EX-CONFLICT | 未 | 未着手 |
| AC-CHANGE-24 | 名前を引き継いで顧客台帳へ | EX-EMPTY-SEARCH | 未 | 未着手 |
| AC-CHANGE-25 | 先頭に「11:00 いまのまま」 | CHANGE-DATETIME | 未 | 未着手 |
| AC-CHANGE-26 | 差分の途中で枠が埋まった | BOOK-CONFLICT | 未 | 未着手 |

### 2.8 P7 受付録音（`REC` / 28 件 / Draft）

| ID | 内容 | 画面ID | E2E ファイル | 状態 |
|---|---|---|---|---|
| UC-REC-01 | 受付を始めると録音が始まる | BOOK-01-DATETIME | 未 | 未着手 |
| UC-REC-02 | 1 受付 1 本を切らさない | BOOK-01〜06 | 未 | 未着手 |
| UC-REC-03 | 録音せずに受付を続ける | EX-MIC-DENIED | 未 | 未着手 |
| UC-REC-04 | 保管庫へ送り保持期限を決める | —（R2・保管） | 未 | 未着手 |
| UC-REC-05 | 失敗しても予約の成立を先に | EX-UPLOAD-FAILED | 未 | 未着手 |
| UC-REC-06 | その場で送り直す | EX-UPLOAD-FAILED | 未 | 未着手 |
| UC-REC-07 | 3 か所から録音を聞く | LEDGER-DETAIL | 未 | 未着手 |
| UC-REC-08 | 期限切れを定期の片づけで消す | —（Cron） | 未 | 未着手 |
| UC-REC-09 | やめても記録と録音は残す | BOOK-01〜06 | 未 | 未着手 |
| AC-REC-01 | 経過時間は工程をまたいで増える | BOOK-05-CONFIRM | 未 | 未着手 |
| AC-REC-02 | 戻しても録音は 1 本だけ | HISTORY-LIST | 未 | 未着手 |
| AC-REC-03 | 使えない理由と直し方を出す | EX-MIC-DENIED | 未 | 未着手 |
| AC-REC-04 | 録音せずに同じ受付へ戻る | EX-MIC-DENIED | 未 | 未着手 |
| AC-REC-05 | 「録音していません --:--」 | BOOK-05-CONFIRM | 未 | 未着手 |
| AC-REC-06 | 先に確定を言い次の再送時刻 | EX-UPLOAD-FAILED | 未 | 未着手 |
| AC-REC-07 | 失敗中は聞く導線を出さない | LEDGER-DETAIL | 未 | 未着手 |
| AC-REC-08 | 送り直すと聞けるようになる | EX-UPLOAD-FAILED | 未 | 未着手 |
| AC-REC-09 | URL とダウンロードを出さない | LEDGER-DETAIL | 未 | 未着手 |
| AC-REC-10 | 履歴から再生し位置が進む | HISTORY-LIST | 未 | 未着手 |
| AC-REC-11 | 成立は 30 日ちょうどは消せない | —（保管・API） | 未 | 未着手 |
| AC-REC-12 | 破棄は 24 時間ちょうど消せない | —（保管・API） | 未 | 未着手 |
| AC-REC-13 | 保全の印があれば残る | —（Cron） | 未 | 未着手 |
| AC-REC-14 | 他組織の録音は再生も保全も不可 | —（API） | 未 | 未着手 |
| AC-REC-15 | 押した操作の中で許可を求める | BOOK-01-DATETIME | 未 | 未着手 |
| AC-REC-16 | 直してもう一度確かめる | EX-MIC-DENIED | 未 | 未着手 |
| AC-REC-17 | 停止が読み上げでも伝わる | BOOK-05-CONFIRM | 未 | 未着手 |
| AC-REC-18 | 端末に保管中と次の送信時刻 | EX-UPLOAD-FAILED | 未 | 未着手 |
| AC-REC-19 | 3 回失敗が 1 件として立つ | ALERTS | 未 | 未着手 |

### 2.9 P8 お客様向け Web 予約（`WEB` / 36 件 / Draft）

| ID | 内容 | 画面ID | E2E ファイル | 状態 |
|---|---|---|---|---|
| UC-WEB-01 | 公開の可否とお知らせ文 | SETTINGS-WEB | 未 | 未着手 |
| UC-WEB-02 | お客様の画面の見え方で確かめる | SETTINGS-WEB | 未 | 未着手 |
| UC-WEB-03 | 公開店舗から 1 つ選ぶ | WEB-01-STORE | 未 | 未着手 |
| UC-WEB-04 | 公開の目的を呼び方と分数で選ぶ | WEB-02-PURPOSE | 未 | 未着手 |
| UC-WEB-05 | 一週間の空きから日と時刻を選ぶ | WEB-03-DATETIME | 未 | 未着手 |
| UC-WEB-06 | 4 項目を入れ送る前に読み返す | WEB-04-FORM | 未 | 未着手 |
| UC-WEB-07 | 予約番号と確認番号を受け取る | WEB-06-DONE | 未 | 未着手 |
| UC-WEB-08 | 2 つの番号で変更・取り消す | WEB-CANCEL | 未 | 未着手 |
| UC-WEB-09 | 確認待ちの Web 予約を確定する | LEDGER-LIST | 未 | 未着手 |
| UC-WEB-10 | 受付の開始と何日先までを決める | SETTINGS-WEB | 未 | 未着手 |
| UC-WEB-11 | 二度受け取っても 1 件にする | WEB-05-CONFIRM | 未 | 未着手 |
| UC-WEB-12 | メール失敗でも予約を残す | WEB-06-DONE | 未 | 未着手 |
| UC-WEB-13 | 受けられない時も行き止まらない | WEB-01-STORE | 未 | 未着手 |
| AC-WEB-01 | 公開を切ると手順に入れない | SETTINGS-WEB | 未 | 未着手 |
| AC-WEB-02 | 公開する目的が 4 件になる | SETTINGS-WEB | 未 | 未着手 |
| AC-WEB-03 | 業務の呼び方は 1 つも出ない | WEB-02-PURPOSE | 未 | 未着手 |
| AC-WEB-04 | 10:30 前と 18:00 以降は不可 | WEB-03-DATETIME | 未 | 未着手 |
| AC-WEB-05 | 30 日先ちょうどは選べる | WEB-03-DATETIME | 未 | 未着手 |
| AC-WEB-06 | 3 時間ちょうど先は選べる | WEB-03-DATETIME | 未 | 未着手 |
| AC-WEB-07 | 承認要のときは確認待ちになる | WEB-05-CONFIRM | 未 | 未着手 |
| AC-WEB-08 | 6 ステップの見出しと読み上げ | WEB-01〜05 | 未 | 未着手 |
| AC-WEB-09 | 「満」と「定休」は押せない | WEB-03-DATETIME | 未 | 未着手 |
| AC-WEB-10 | 2 つの番号が出て戻れなくなる | WEB-06-DONE | 未 | 未着手 |
| AC-WEB-11 | 回線が切れても予約は 1 件 | WEB-05-CONFIRM | 未 | 未着手 |
| AC-WEB-12 | 2 つの番号で明細 5 行が出る | WEB-CANCEL | 未 | 未着手 |
| AC-WEB-13 | 日時を変えると台帳も動く | WEB-CANCEL | 未 | 未着手 |
| AC-WEB-14 | 取り消しは一度しかできない | WEB-CANCEL | 未 | 未着手 |
| AC-WEB-15 | 前日を過ぎたらお電話へ | WEB-CANCEL | 未 | 未着手 |
| AC-WEB-16 | 誤った確認番号では出ない | WEB-CANCEL | 未 | 未着手 |
| AC-WEB-17 | メール不達でも番号は出る | WEB-06-DONE | 未 | 未着手 |
| AC-WEB-18 | 送信中は二度押しできない | WEB-05-CONFIRM | 未 | 未着手 |
| AC-WEB-19 | 数字とメールの鍵盤を出し分ける | WEB-04-FORM | 未 | 未着手 |
| AC-WEB-20 | ふりがなは確定時に一度だけ | WEB-04-FORM | 未 | 未着手 |
| AC-WEB-21 | 鍵盤が確認ボタンを隠さない | WEB-04-FORM | 未 | 未着手 |
| AC-WEB-22 | 確定すると確認待ちが 0 件 | LEDGER-LIST | 未 | 未着手 |
| AC-WEB-23 | 地図から戻っても番号が読める | WEB-06-DONE | 未 | 未着手 |

### 2.10 P9 分析（`ANA` / 31 件 / Draft）

| ID | 内容 | 画面ID | E2E ファイル | 状態 |
|---|---|---|---|---|
| UC-ANA-01 | 前後 7 日と週の件数を読む | ANALYTICS-TOP | 未 | 未着手 |
| UC-ANA-02 | 期間と店舗を選び適用する | ANALYTICS-TOP | 未 | 未着手 |
| UC-ANA-03 | 予約数の切り口を変えて数える | ANALYTICS-COUNT | 未 | 未着手 |
| UC-ANA-04 | 担当ごとの件数と 90 日再来 | ANALYTICS-STAFF | 未 | 未着手 |
| UC-ANA-05 | 中央値を目安 8 分と並べる | ANALYTICS-WAIT | 未 | 未着手 |
| UC-ANA-06 | 取り消しを 5 つに分けて積む | ANALYTICS-CANCEL | 未 | 未着手 |
| UC-ANA-07 | 小標本の率を伏せる | ANALYTICS-STAFF | 未 | 未着手 |
| UC-ANA-08 | 定休日と未集計を分けて示す | ANALYTICS-TOP | 未 | 未着手 |
| UC-ANA-09 | 組織と店舗の外を集計から外す | ANALYTICS-STAFF | 未 | 未着手 |
| UC-ANA-10 | 入口・回数・目的も同じ型で読む | ANALYTICS-TOP | 未 | 未着手 |
| AC-ANA-01 | グラフは 1 つだけ出る | ANALYTICS-TOP | 未 | 未着手 |
| AC-ANA-02 | 件数と人数を別の数字で出す | ANALYTICS-TOP | 未 | 未着手 |
| AC-ANA-03 | 適用を押すまで数字は動かない | ANALYTICS-TOP | 未 | 未着手 |
| AC-ANA-04 | 店舗を変えると行が入れ替わる | ANALYTICS-STAFF | 未 | 未着手 |
| AC-ANA-05 | かぞえる日で合計が変わる | ANALYTICS-COUNT | 未 | 未着手 |
| AC-ANA-06 | 時間帯別で横軸が変わる | ANALYTICS-COUNT | 未 | 未着手 |
| AC-ANA-07 | グラフの下は 3 つだけ | ANALYTICS-COUNT | 未 | 未着手 |
| AC-ANA-08 | 何をいつ基準に数えたかを出す | ANALYTICS-STAFF | 未 | 未着手 |
| AC-ANA-09 | 担当が未定は再来が「—」 | ANALYTICS-STAFF | 未 | 未着手 |
| AC-ANA-10 | 中央値に前の月と母数を添える | ANALYTICS-WAIT | 未 | 未着手 |
| AC-ANA-11 | 8 分ちょうどは超過にしない | ANALYTICS-WAIT | 未 | 未着手 |
| AC-ANA-12 | 5 系列の積み上げと件数・率 | ANALYTICS-CANCEL | 未 | 未着手 |
| AC-ANA-13 | 6 か月のまとめに目安を併記 | ANALYTICS-CANCEL | 未 | 未着手 |
| AC-ANA-14 | 小標本の再来は「—」にする | ANALYTICS-STAFF | 未 | 未着手 |
| AC-ANA-15 | 定休は 0 件・未集計は描かない | ANALYTICS-TOP | 未 | 未着手 |
| AC-ANA-16 | 他組織は 1 件も現れない | ANALYTICS-STAFF | 未 | 未着手 |
| AC-ANA-17 | 塗り以外に地模様と系列名 | ANALYTICS-CANCEL | 未 | 未着手 |
| AC-ANA-18 | キーボードで切り口を替える | ANALYTICS-COUNT | 未 | 未着手 |
| AC-ANA-19 | グラフの要点が文で読まれる | ANALYTICS-TOP | 未 | 未着手 |
| AC-ANA-20 | 空のタブを 1 つも作らない | ANALYTICS-TOP | 未 | 未着手 |
| AC-ANA-21 | 1 日あたりは営業日数で割る | ANALYTICS-COUNT | 未 | 未着手 |

### 2.11 P10 端末と監査（`TERM` / 38 件 / Draft）

| ID | 内容 | 画面ID | E2E ファイル | 状態 |
|---|---|---|---|---|
| UC-TERM-01 | 端末の使い方を決め直す | START-DEVICE-MODE | 未 | 未着手 |
| UC-TERM-02 | 個人端末で名前を選ぶ | LOGIN-STAFF | 未 | 未着手 |
| UC-TERM-03 | 個人の暗証番号で業務を始める | LOGIN-STAFF-PIN | 未 | 未着手 |
| UC-TERM-04 | 残り回数と直し方を同じ面で | LOGIN-PIN-ERROR | 未 | 未着手 |
| UC-TERM-05 | 共有端末の置き場所を選ぶ | LOGIN-SHARED | 未 | 未着手 |
| UC-TERM-06 | 店舗共通の暗証番号で始める | LOGIN-SHARED-PIN | 未 | 未着手 |
| UC-TERM-07 | 共有のまま予約と受付ができる | HOME | 未 | 未着手 |
| UC-TERM-08 | さわらないと名前と番号を伏せる | HOME-SHARED-LOCKED | 未 | 未着手 |
| UC-TERM-09 | 責任の残る操作で個人へ上げる | MODE-PERSONAL | 未 | 未着手 |
| UC-TERM-10 | 個人モードが共有へ戻る | MODE-PERSONAL | 未 | 未着手 |
| UC-TERM-11 | 足りない権限と下書きの行き先 | EX-PERMISSION | 未 | 未着手 |
| UC-TERM-12 | 通信断でも打ちかけを失わない | EX-OFFLINE | 未 | 未着手 |
| UC-TERM-13 | いつ誰がどの端末で何をしたか | HISTORY-LIST | 未 | 未着手 |
| UC-TERM-14 | お知らせを分けて既読にする | ALERTS | 未 | 未着手 |
| UC-TERM-15 | 1 件を対応済みとして外す | ALERTS | 未 | 未着手 |
| UC-TERM-16 | 端末の一覧と暗証番号の作り直し | —（設定・モック無し） | 未 | 未着手 |
| AC-TERM-01 | 使い方を決める 3 行が並ぶ | START-DEVICE-MODE | 未 | 未着手 |
| AC-TERM-02 | 本日休みの人は押せない | LOGIN-STAFF | 未 | 未着手 |
| AC-TERM-03 | 4 桁目で確定が押せる | LOGIN-STAFF-PIN | 未 | 未着手 |
| AC-TERM-04 | 置き場所の状態と権限の線引き | LOGIN-SHARED | 未 | 未着手 |
| AC-TERM-05 | 共有で使っていますと出る | LOGIN-SHARED-PIN | 未 | 未着手 |
| AC-TERM-06 | あと 2 回と再設定の頼み先 | LOGIN-PIN-ERROR | 未 | 未着手 |
| AC-TERM-07 | 3 回目で 30 秒待つ | LOGIN-PIN-ERROR | 未 | 未着手 |
| AC-TERM-08 | 共有のまま確定でき端末が残る | HOME | 未 | 未着手 |
| AC-TERM-09 | 2 分で伏せ、さわると戻る | HOME-SHARED-LOCKED | 未 | 未着手 |
| AC-TERM-10 | 保全には本人確認が要る | MODE-PERSONAL | 未 | 未着手 |
| AC-TERM-11 | 昇格すると元の操作ができる | MODE-PERSONAL | 未 | 未着手 |
| AC-TERM-12 | 2 分で共有へ戻り再度求める | MODE-PERSONAL | 未 | 未着手 |
| AC-TERM-13 | 下書きは残っていますと出る | EX-PERMISSION | 未 | 未着手 |
| AC-TERM-14 | 読めるまま書き込みだけ止まる | EX-OFFLINE | 未 | 未着手 |
| AC-TERM-15 | 監査の行は直せず消せない | HISTORY-LIST | 未 | 未着手 |
| AC-TERM-16 | 対応が必要とお知らせに分ける | ALERTS | 未 | 未着手 |
| AC-TERM-17 | 裏から戻ると既に伏せてある | HOME-SHARED-LOCKED | 未 | 未着手 |
| AC-TERM-18 | 「お知らせ 3件」と読まれる | ALERTS | 未 | 未着手 |
| AC-TERM-19 | 押せない理由も一緒に読まれる | LOGIN-STAFF-PIN | 未 | 未着手 |
| AC-TERM-20 | 前の客の値が候補に出ない | BOOK-04-CUSTOMER | 未 | 未着手 |
| AC-TERM-21 | 使い方を変えるで選び直す | START-DEVICE-MODE | 未 | 未着手 |
| AC-TERM-22 | 送信成功で自動的に対応済み | ALERTS | 未 | 未着手 |

---

## 3. validator の決まり（`scripts/check-e2e-traceability.mjs` の実挙動）

読んだのは実ファイルであり、下は挙動そのままである。

### 3.1 分母のつくられ方

1. `specs/**` を歩いて **`spec.md` で終わるファイルだけ**を拾う。`design/**` の本書は対象外である。
2. 各ファイルの先頭で `- ステータス:`（または `- Status:`）が `Draft` / `Approved` / `Superseded` のどれかを宣言していなければ**その時点でエラー**にする。
3. **definition bullet だけ**を識別子として拾う。形は「行頭（空白可）＋ハイフン＋空白＋識別子＋コロン＋空白＋本文」である。
   識別子は `UC-` か `AC-` で始まり、ハイフン区切りの英数が **2 区画以上**続くもの（`UC-<TAG>-<NN>` の形）。
   本文中に `UC-<TAG>-<NN>` と書いただけの**参照は拾われない**。
4. 拾った識別子のうち、**`Approved` の spec のものだけ**が分母（`approved`）に入る。`Draft` と `Superseded` は入らない。
5. 同じ識別子が 2 つ以上の `spec.md` で定義されていれば `Duplicate specification identifier` でエラーにする。
   `design/06-use-cases.md` は feature spec と**番号の意味が違う** UC 名を使っているが（同書 §「UC-CUST-04」の注記）、
   design 側は走査対象外なので衝突しない。**この分離を崩さないために、本書は ID を表のセルにしか置かない。**

### 3.2 E2E 側の対応づけ

1. `services/**/e2e/**` の `*.spec.ts`（`.tsx` / `.js` / `.mjs` / `.cjs` も可）を拾う。
2. `// @e2e-covers <ID> [<ID> ...]` という**1 行だけのコメント**を探す。同じ行に半角空白で複数 ID を並べてよい。
3. そのコメントの**直後**に、`@playwright/test` から**値として import** した top-level の `test(...)` 呼び出しが要る。
   間に空白しか無いこと、という判定である。次はすべて対応先として**認められない**。
   - `test.describe(...)` や関数の中に入れ子になった `test(...)`
   - `import type { test }` のような型だけの import
   - `test.skip(...)` / `test.only(...)` / `test.fixme(...)`（`targets test.<modifier>, which cannot satisfy traceability` になる）
   - 同名の変数をソース直下で宣言して import を隠したもの

```ts
import { expect, test } from '@playwright/test'

// @e2e-covers AC-FOUND-05
test('ヘルスチェックは認証なしで ok を返す', async ({ request }) => {
  // ここで観測可能な検証をする
})
```

### 3.3 エラーになる 5 つ

| 診断 | 意味 |
|---|---|
| `Missing E2E mapping for approved <ID>` | Approved の UC/AC に `@e2e-covers` が無い |
| `Unknown E2E mapping <ID>` | E2E が指す ID が Approved の分母に無い（Draft のまま E2E を書いた場合も含む） |
| `Duplicate E2E mapping for <ID>` | 同じ ID を 2 本以上の test が受け持っている |
| `... does not target a Playwright test` | コメントの直後に top-level の `test(...)` が無い |
| `... targets test.<modifier>` | 対応先が `skip` / `only` / `fixme` である |

### 3.4 だから spec は Draft で作る

**`Approved` にした瞬間に、その spec の UC/AC 全件へ E2E が必須になる。** 1 件でも欠ければ
`pnpm check` / pre-commit / pre-push / CI `verify` がすべて落ち、コミットも push もできない。

したがって各フェーズの手順は次で固定する。

1. `spec.md` を **`- ステータス: Draft`** で書く（このとき UC/AC を書き切ってよい。分母に入らないので落ちない）。
2. 実装と `e2e/<領域>.spec.ts` を書き、**Draft のあいだは `@e2e-covers` をまだ書かない**
   （Draft の ID を指すと `Unknown E2E mapping` で落ちるため。テスト本体だけ先に緑にする）。
3. `pnpm --filter @app/glasses_management e2e` が緑になったら、**同じコミットで**
   ①`spec.md` を `Approved` に上げ ②`@e2e-covers` を全件付け ③本書の該当行を「実装済」にし
   ④`docs/testing/E2E_TRACEABILITY.md` の対応表に行を足す。
4. `node scripts/check-e2e-traceability.mjs`（= `pnpm run test:traceability`）で緑を確かめる。

③④を別コミットに割ると、その間だけ validator が落ちる。**1 コミットで閉じる。**

---

## 4. いまの状態

`node scripts/check-e2e-traceability.mjs` は緑（`all approved UC/AC identifiers are mapped exactly once.`）である。

| 数えるもの | 件数 |
|---|---|
| feature spec | 11 本 |
| うち Approved | **1 本**（`003-service-foundation`） |
| うち Draft | **10 本**（`004` 〜 `013`） |
| うち Superseded | 0 本（旧 `002-eyex-reservation-product` はディレクトリごと存在しない） |
| UC/AC の総数 | **363 件** |
| うち validator の分母（Approved） | **5 件**（`AC-FOUND-01` 〜 `AC-FOUND-05`） |
| E2E に対応済みの ID | **5 件**（`e2e/foundation.spec.ts`） |
| 未対応の ID | **358 件**（すべて Draft。validator は要求していない） |
| 実装済みの E2E ファイル | 2 本（`e2e/foundation.spec.ts` / `e2e/mock-compare.spec.ts`） |
| これから足す E2E ファイル | 10 本（§2 の表のとおり） |

**未対応 358 件は欠陥ではない。** Draft の UC/AC は分母に入らないので、validator は 1 件も要求していない。
P1 以降を Approved に上げるたび分母が増え、その時点で E2E が揃っていなければ落ちる。

数え直すときは次で出る。

```sh
# spec ごとの UC/AC 件数（validator と同じ definition bullet の形で数える）
grep -cE '^[[:space:]]*-[[:space:]]+(UC|AC)-[A-Za-z0-9]+(-[A-Za-z0-9]+)+:[[:space:]]' \
  specs/glasses_management/features/*/spec.md

# ステータスの内訳
grep -hE '^[[:space:]]*-[[:space:]]+ステータス:' specs/glasses_management/features/*/spec.md | sort | uniq -c

# validator
node scripts/check-e2e-traceability.mjs
```

---

## 5. 運用の決まり

1. **UC/AC を足したら、同じ変更で `@e2e-covers` を足す。** Approved の spec に行を 1 つ足しただけで
   `Missing E2E mapping` になる。spec・E2E・本書・`docs/testing/E2E_TRACEABILITY.md` の 4 つを 1 コミットで動かす。
2. **`docs/testing/E2E_TRACEABILITY.md` の対応表も同じ変更で更新する。** これはリポジトリ全体の一覧であり、
   本書はその glasses_management の詳細版である。いま同書の「現在の基準線」は example_service の
   `AC-ITEM-01` 〜 `05` しか載せておらず、Approved 済みの `AC-FOUND-01` 〜 `05` が抜けている。
   **P1 を Approved に上げるときに、`FOUND` の 5 行と併せて追記する。**
3. **UC/AC の ID を作り直さない。** 番号を詰め直すと E2E・本書・`E2E_TRACEABILITY.md` の 3 か所が同時にずれる。
   要らなくなった UC/AC は削除するか spec ごと `Superseded` にし、空いた番号は再利用しない。
4. **1 つの ID を 2 本の test で受け持たない。** `Duplicate E2E mapping` になる。逆に、
   1 本の test が複数の ID を受け持つのは正しい（`// @e2e-covers` の 1 行に空白で並べる）。
5. **画面 ID を変えたら本書の「画面ID」列を直す。** 画面 ID の正本は `design/05-screen-flow.md` §3 と
   `docs/frontend/mockups/eyex/screens/*.html` であり、本書はその参照にすぎない。
6. **`spec.md` の文面と本書の「内容」列がずれたら、`spec.md` を正として本書を直す。**
   本書の要約は 20 字に落とした地図であり、判断の根拠にはしない。
