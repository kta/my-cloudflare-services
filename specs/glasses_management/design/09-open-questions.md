# 09 — 発注元に確かめること（glasses_management）

- サービス: `glasses_management`（`services/glasses_management` / `@app/glasses_management`）
- 位置づけ: **発注元（EYEX）に確かめるまで決まらないこと**を 1 か所に集めた台帳。
- 参照先: 決定は `design/01-requirements.md`（何を作るか）/ `design/02-domain-model.md`（状態）/
  `design/03-data-model.md`（列）/ `design/04-api.md`（経路）/ `design/05-screen-flow.md`（画面）/
  `design/06-use-cases.md`（挙動）/ `design/07-nfr.md`（数値）にある。本書は**問いだけ**を持つ。

---

## 0. この文書の意味

モック（`docs/frontend/mockups/eyex/` の 68 画面）・決定ブリーフ・設計判断で決められる論点は、
第2巡ですべて各文書の本文に**断定で**書き下した。ここに残るのは、
**店の運用・法務・機材の実情を知らないと決められないもの**だけである。

- **暫定案のもとで実装を進めてよい。** 各問いの「いまの前提（暫定）」がそれで、
  実装・テスト・E2E はこの前提のとおりに書く。答え待ちを理由に着手を止めない。
- **答えが来たら、その問いの「答えが来たら直す場所」に挙げたファイルと行だけを直す。**
  暫定案は各文書の本文にも同じ言葉で書いてあるので、直す範囲は本書の一覧で閉じる。
- 各文書に残っている `[要確認: ...]` は、すべて本書のどれか 1 件に対応する。
  対応しない `[要確認]` を新しく増やさない。増やすときは本書に行を足してから書く。
- **番号について**: `design/02-domain-model.md` §9 にも `Q-01`〜`Q-16` の表があるが、
  あちらは同文書の中で決着させた状態遷移の台帳であり、本書の `Q-NN` とは別物である。番号を突き合わせない。

問いは **12 件**。フェーズの記号は `00_service-spec.md` の features 表（P0〜P10）に合わせる。

| # | 問い（要約） | 関係するフェーズ |
|---|---|---|
| Q-01 | Web 予約が承認待ちの間、お客様に何と伝えるか | P8 |
| Q-02 | 受付の録音をいつまで残し、いつ消すか | P7 |
| Q-03 | 閲覧系の 4 権限をサーバ側で強制するか | P4 / P7 / P9 / P10 |
| Q-04 | 別の店舗の予約・お客様をどこまで見られるべきか | P0 / P6 |
| Q-05 | 業務用 iPad にこの画面をどう入れるか | P0 / P2 / P7 |
| Q-06 | 接客の途中で時間切れになってよいものはどれか | P3 / P6 / P10 |
| Q-07 | スタッフのログインと暗証番号を admin に任せてよいか | P0 / P10 |
| Q-08 | バックアップと容量の見張りを誰が持つか | 運用（P0 の Cron 枠） |
| Q-09 | Web 予約でメールアドレスを必須にしてよいか | P8 |
| Q-10 | 「注意ごと」と設定の下書きに店長の承認を挟むか | **P1** / P4 / P10 |
| Q-11 | 分析の「名」は何を数えているか。1 予約に複数名がありうるか | **P1** / P2 / P9 |
| Q-12 | 既存の顧客・予約・度数を取り込むか | **P1** / P4 |

---

## 1. 問い

### Q-01 Web でご予約をいただいて、お店が確かめて確定するまでの間、お客様に何とお伝えしますか。

- **決まらないと作れないもの**: 完了画面 WEB-06-DONE の見出しと本文、確認メールの文面、
  自動で取り消したときの連絡文の 3 か所。`web_bookings.status='pending'` のお客様向け表示。
  店舗が Web 由来の予約を変更・取消したときに連絡するかどうか
  （`packages/contracts` の通知の型に取消の `type` が無く、足すなら notifier の契約変更になる＝人間の承認事項）。
  Web 予約（P8）の完了経路と日次 Cron の自動取消がまるごと止まる。
- **いまの前提（暫定）**: 完了画面の見出しを「ご予約を承りました」にし、その下に
  「お店で確認のうえ、本日中にご連絡いたします。確定までお席の確保はできておりません。」を出す。
  確定後に「ご予約が確定しました」、自動取消のときに「今回はお受けできませんでした」をメールで送る。
  店舗による変更は `reservation.confirmed` の送り直しで賄い、新しい型を足さない。
- **答えが来たら直す場所**:
  `design/01-requirements.md:359` /
  `design/02-domain-model.md:396` `:743` /
  `design/04-api.md:562` `:1044` `:1125` `:1151` /
  `design/05-screen-flow.md:1413` /
  `design/06-use-cases.md:3030` `:3103` `:3737` /
  `features/011-web-booking/spec.md:84`
- **関係するフェーズ**: P8（`011-web-booking`）

### Q-02 受付の録音を、いつまで残し、いつ消しますか。別途の保持義務・削除義務は課されますか。

- **決まらないと作れないもの**: `recordings.retain_until` の計算、掃除の日次 Cron、`legal_hold` の運用、
  R2 の容量見積り、お客様への説明文。監査ログ（`audit_events`）の保持年数もここに従属する。
  録音（P7）の保持まわり全部。
- **いまの前提（暫定）**: 決定ブリーフ §3.4 のまま。成立した予約は録音完了から 30 日、
  破棄した受付は録音終了から 24 時間、最低保持の中にある録音の削除は拒否する。監査ログは 1 年。
- **答えが来たら直す場所**:
  `design/01-requirements.md:375` /
  `design/07-nfr.md:981` `:1230` /
  `design/06-use-cases.md:3738`
- **関係するフェーズ**: P7（`010-recording`）

### Q-03 録音を聞くこと・お客様をおまとめすること・分析を見ること・監査を見ることを、店長だけに絞りますか。

- **決まらないと作れないもの**: `/api/staff/**` の権限表（admin が配る `analytics.read` /
  `customer.history` / `recording.read` / `attention.publish` をサーバ側で強制するかどうか）。
  EX-PERMISSION が出る条件、CUSTOMER-MERGE / LEDGER-DETAIL / HISTORY-LIST / ANALYTICS-* の入口。
  権限のテストを表駆動で書けない（規約の「権限は表駆動で全エンドポイント」が満たせない）。
- **いまの前提（暫定）**: 4 つともサーバ側で強制する（強制しないと admin が配る値が飾りになる）。
  そのうえで、録音の再生とお客様のおまとめは個人モード（本人の PIN）を必須にする。
- **答えが来たら直す場所**:
  `design/01-requirements.md:362` /
  `design/03-data-model.md:1313` `:2015` /
  `design/04-api.md:157` `:160` `:167` `:1149` /
  `design/05-screen-flow.md:1414` /
  `design/06-use-cases.md:3739` /
  `features/007-customer-records/spec.md:78`
- **関係するフェーズ**: P4（`007-customer-records`）/ P7 / P9 / P10

### Q-04 別の店舗のご予約・お客様を、どの立場の人がどこまで見られるべきですか。

- **決まらないと作れないもの**: 「すべて選択中店舗にスコープする」という店舗境界の原則の例外規定、
  CHANGE-SEARCH の検索範囲（「丸の内店・新宿店のご予約も含める」を作るかどうか）、
  チェーン管理者・監査担当という役割を作るかどうか、テナント分離テストの表。
- **いまの前提（暫定）**: 作らない。すべて選択中店舗の中だけで完結させ、
  店舗をまたぐ確認は上のバーの店名から店舗を切り替えて行う。監査担当は店長の資格で読む。
- **答えが来たら直す場所**:
  `design/01-requirements.md:358` /
  `design/05-screen-flow.md:1415` /
  `design/06-use-cases.md:3740`
- **関係するフェーズ**: P0（`003-service-foundation`：テナント分離とスコープ）/ P6（`009-change-and-cancel`）

### Q-05 業務用の iPad に、この画面をどう入れますか（①ホーム画面に追加 ②Safari のタブのまま ③専用アプリで包む）。

- **決まらないと作れないもの**: 画面の有効高（Safari のバーで 40〜90pt 減る）、台帳に入る枠数、
  `viewport-fit=cover` と安全領域のトークン、マイク許可の寿命、
  EX-MIC-DENIED の直し方 3 手順の文言（②では iPadOS の「設定」に「EYEX予約」の項目が無く、
  「設定を開く → EYEX予約 を選ぶ → マイクをオンにする」が成り立たない）。
- **いまの前提（暫定）**: ①（ホーム画面に追加した Web アプリとして配る）。
  `manifest.json` と `apple-mobile-web-app-capable` を足し、モックの 3 手順の文言をそのまま使う。
- **答えが来たら直す場所**:
  `00_service-spec.md:428` /
  `design/01-requirements.md:373` /
  `design/06-use-cases.md:2543` `:3741` /
  `design/07-nfr.md:31` `:1227` /
  `features/003-service-foundation/spec.md:40` `:79` /
  `features/010-recording/spec.md:76`
- **関係するフェーズ**: P0（土台。実装済みのため、答えが①以外なら作り直しが要る）/ P2（台帳の枠数）/ P7（マイク許可）

### Q-06 接客の途中で時間切れになってよいものはどれですか。枠の仮押さえが切れて、その枠が黙って別の端末へ渡ってよいですか。

- **決まらないと作れないもの**: 端末の自動ロック 120 秒・個人モードの寿命 120 秒・枠の仮押さえ 420 秒・
  管理コード 900 秒・再生チケット 900 秒の 5 つについて、「必須（essential）として警告なしで切る」か
  「20 秒以上前に警告して延ばせるようにする」か。WCAG 2.2 AA 2.2.1 への答えでもある。
  ②を採るなら `PATCH /api/staff/holds/:holdId` が 1 本増える（ルート数 101 → 102）。
  伏せる判定に VoiceOver のフォーカス移動を「さわった」と数えるかも同じ問い
  （読み上げで盤面をたどると 120 秒を容易に超える）。
- **いまの前提（暫定）**: 自動ロックと個人モードの寿命は「必須」として免除を主張する（伏せるだけで作業は消えない）。
  枠の仮押さえは残り時間を画面に出し、残り 60 秒で警告して 1 回だけ延ばせるようにする。
- **答えが来たら直す場所**:
  `design/01-requirements.md:374` /
  `design/02-domain-model.md:452` `:749` /
  `design/04-api.md:990` `:1152` /
  `design/06-use-cases.md:1440` `:3742` /
  `design/07-nfr.md:369` `:1228` /
  `features/006-booking-flow/spec.md:74` `:132` /
  `features/009-change-and-cancel/spec.md:79` /
  `features/013-terminals-and-audit/spec.md:89`
- **関係するフェーズ**: P3（`006-booking-flow`）/ P6（`009-change-and-cancel`）/ P10（`013-terminals-and-audit`）

### Q-07 スタッフのログインと暗証番号の再確認を、既存の admin（社員名簿の持ち主）に任せてよいですか。

- **決まらないと作れないもの**: 最初のトークンをどこで得るか。いまの設計は
  「端末はすでに org スコープの JWT を持っている」前提で `/api/staff/terminals/:id/sessions` から始まっており、
  START-DEVICE-MODE / LOGIN-STAFF / LOGIN-SHARED / MODE-PERSONAL の 4 面が宙に浮いている
  （`POST /api/auth/token` は dev 専用で、`AUTH_DEV_GRANT !== 'true'` なら 404）。
  admin に任せるなら `ADMIN` の service binding と PIN 用の鍵（`AUTH_PEPPER`）を決定ブリーフ §1 に足す必要がある。
- **いまの前提（暫定）**: admin に任せる。admin 側に実在する
  `/api/internal/domain-auth/login` `/refresh` `/pin/verify` を service binding 経由で呼ぶ。
  `ADMIN` binding と `AUTH_PEPPER` を決定ブリーフ §1 に足す。
- **答えが来たら直す場所**:
  `00_service-spec.md:427` /
  `design/04-api.md:117` `:1133` `:1148` /
  `design/05-screen-flow.md:1412` /
  `design/06-use-cases.md:3743` /
  `features/013-terminals-and-audit/spec.md:87`
- **関係するフェーズ**: P0（`003-service-foundation`：認証の土台）/ P10（`013-terminals-and-audit`）

### Q-08 このサービスのデータのバックアップと容量の見張りを、誰が持ちますか。

- **決まらないと作れないもの**: R2 への世代バックアップ・D1 容量 400MB（500MB の 80%）での警告・
  鮮度監視の置き場所。`CODEMAP.md` / `docs/howto/deploy.md` / `AGENTS.md` は `services/ops` が担うと書いているが、
  そのサービスはリポジトリに存在しない（`git ls-files services/ops` が 0 件、`triggers.crons` を持つ Worker も 0 本）。
  いま `glasses_management` の D1 を戻す手段は D1 Time Travel の 7 日だけである。
- **いまの前提（暫定）**: 当面 Time Travel の 7 日で受け入れる。
  `glasses-management` に割り当てた Cron 1 枠の中で「D1 のサイズを測り、400MB を超えたらお知らせに上げる」だけを持つ。
  R2 への世代バックアップは持たない。
- **答えが来たら直す場所**:
  `00_service-spec.md:429` /
  `design/07-nfr.md:994` `:1001` `:1231` /
  `design/06-use-cases.md:3744`
- **関係するフェーズ**: 運用（フェーズに属さない。実体は P0 で確保した Cron 1 枠の中身）

### Q-09 Web 予約で、メールアドレスを必須にしてよいですか。

- **決まらないと作れないもの**: WEB-04-FORM の必須表示、`web_bookings.contact_email` を NOT NULL にできるか、
  承認の結果と自動取消をお伝えする手段、メールをお持ちでないお客様の受け皿（お電話で連絡する運用があるか）。
  Q-01 の文面もここに従属する。
- **いまの前提（暫定）**: 必須にする（NOT NULL）。承認制である以上、連絡手段の無いお客様の予約は宙に浮くため。
- **答えが来たら直す場所**:
  `design/03-data-model.md:1639` `:2017` /
  `design/06-use-cases.md:2991` `:3745` /
  `features/011-web-booking/spec.md:85`
- **関係するフェーズ**: P8（`011-web-booking`）

### Q-10 お客様の「注意ごと」や設定の下書きを、店長が承認してから表に出す運用はありますか。承認できるのは誰ですか。

- **決まらないと作れないもの**: `customer_notes.status`（`draft` / `published` / `hidden`）の遷移、
  EX-PERMISSION の「この下書きを店長に依頼する」の行き先（依頼を受け取る API も、依頼の一覧も、承認の面もモックに無い）、
  依頼が届いたことをどう知らせるか。承認が要らないなら、その画面ごと落とせる。
  **設定画面（P1）の 403 の面が出すボタンがこれで決まる** —
  `design/05-screen-flow.md:533` は `/settings?section=hours` の EX-PERMISSION に
  「この下書きを店長に依頼する」を並べており、`features/013-terminals-and-audit/spec.md:143`（T-015b）は
  「依頼の受け取り先が決まるまで画面に出さない」と書いている。押せるのに何も起きないボタンを置かないため。
- **いまの前提（暫定）**: 承認は要る。`customer_notes.status` を `draft` → 店長が `published` にする。
  依頼はお知らせ（`alerts`、`code='settings.approval_requested'`）に 1 件立て、ALERTS から承認の面へ入る。
  承認できるのは同じ店舗の店長だけ。答えが来るまで「この下書きを店長に依頼する」のボタンは画面に出さない。
- **答えが来たら直す場所**:
  `design/04-api.md:169` `:1150` /
  `design/05-screen-flow.md:533` /
  `design/06-use-cases.md:1810` `:3679` `:3746` /
  `design/07-nfr.md:942` `:1229` /
  `features/013-terminals-and-audit/spec.md:88` `:143`
- **関係するフェーズ**: **P1**（`004-store-settings`：AC-SET-17 が通る EX-PERMISSION のボタン）/
  P4（`007-customer-records`：注意ごとの公開）/ P10（`013-terminals-and-audit`：依頼と承認の面）

### Q-11 分析の「名」は何を数えていますか。1 件のご予約に複数名のお客様がいらっしゃることはありますか。

- **決まらないと作れないもの**: `analytics_daily` の `metric='guests'`（ANALYTICS-TOP「68件・88名」/
  ANALYTICS-COUNT「320件・414名」の「名」）。その値の出どころになる列も入力欄も工程も無い
  （`reservations` に人数の列が無く、`StaffReservationCreate` にも `PublicBookingCreate` にも人数のフィールドが無く、
  予約の 5 工程に人数を伺う画面が 1 枚も無い）。
  **複数名がありうるなら P1 と P2 にも効く** — 2 人なら相談カウンターも視力測定機も 2 台要るので、
  設定で持つ `purpose_requirements`（`features/004-store-settings/spec.md:112`「技能 1 つ＋設備 2 つまで」）の
  必要数が人数に比例する形に変わり、空き枠エンジン（決定ブリーフ §4）の条件 6 の定義も変わる。
- **いまの前提（暫定）**: `metric='guests'` を落とす。`analytics_daily` に `guests` の行を書かず、
  画面の「名」を出さない（件数だけを出す）。`purpose_requirements` の必要数は固定のまま。
- **答えが来たら直す場所**:
  `design/01-requirements.md:376` /
  `design/03-data-model.md:1729` `:1739` `:2016`
- **関係するフェーズ**: **P1**（`004-store-settings`：`purpose_requirements` の必要数）/
  P2（`005-availability-and-ledger`：空き枠の条件 6）/ P9（`012-analytics`：指標）

### Q-12 いまお持ちの顧客・ご予約・度数を、このシステムに取り込みますか。取り込まないなら、いつから手入力に切り替えますか。

- **決まらないと作れないもの**: 取り込むなら形式と件数、取り込みの経路（一括投入の口を作るか）。
  取り込まないならカットオーバーの運用（何日前から手入力を始めるか）。
  3 店舗が既に持っているものは最低 3 種類ある — ①顧客と度数の履歴・注意ごと（P4）
  ②カットオーバー日以降に既に入っているご予約（P2 / P3）
  ③**スタッフの技能と勤務**（P1 — `004-store-settings` が持つ `staff_skills` / `staff_weekly_shifts`）。
  ①が入らないと初日の全来店が「初めて」になり、「前回どう見えていたか」から始まるという
  `design/01-requirements.md` §3.3 の前提が初日に成立しない。
- **いまの前提（暫定）**: 取り込まない。初日は手入力から始め、②は前日までに手で入れる。
  一括投入の口（API・画面）は作らない。設定の初期値は seed で入れる。
- **答えが来たら直す場所**:
  `design/01-requirements.md:207` `:377`
- **関係するフェーズ**: **P1**（`004-store-settings`：スタッフの技能と勤務の初期投入）/
  P4（`007-customer-records`：顧客と度数の履歴）

---

## 2. 答えを受け取ったときの手順

1. 本書の該当する `Q-NN` に答えを書き足し、「いまの前提（暫定）」を確定した内容に置き換える。
2. その `Q-NN` の「答えが来たら直す場所」に挙げたファイルと行を上から順に直し、
   `[要確認: ...]` の括りを外して断定文にする（`grep -rn '要確認' specs/glasses_management` で残りが減ることを確かめる）。
3. 直した挙動に対応する feature spec の UC / AC とテストを直し、`pnpm check` と該当フェーズの E2E を緑にしてから閉じる。
