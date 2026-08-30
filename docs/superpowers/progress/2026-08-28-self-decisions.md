# 自己判断の記録 — EYEX予約 再構築（2026-08-28）

発注元・依頼者に確認せずに私（実装側）が決めたことを、後から検証できるように全部並べる。
**取り消したいものがあればこの表の行を指して言ってもらえれば戻せる。**

区分: **[破棄]** 消したもの ／ **[変更]** 既存の挙動を変えたもの ／ **[新設]** 新しく決めたもの ／ **[前提]** 未決のまま置いた仮の答え

## A. モックの復旧

| # | 決めたこと | 理由 | 影響 |
|---|---|---|---|
| A-1 | [変更] `assets/eyex.css` と `screens/HOME.html` を、PNG を正として復元・書き直した | 別セッションのコミットで旧版に巻き戻り、38 画面がサイドバー無しで描画されていた | モック 68 画面 |
| A-2 | [変更] サイドバーのアイコン 9 種を引き直した | 元の線画が残っていない。形はわずかに違うが意味と置き場所は変えていない | 全画面の左の柱 |
| A-3 | [新設] `reference/`（端末のステータスバーを外した基準画像）を作った | 実装はブラウザの中で動くのでその帯を持たず、そのままでは縦にずれて比べられない | Playwright 突き合わせ |
| A-4 | [破棄] 却下版のモック `mockups/eyex-reservation/` と、その実装の証跡（`docs/frontend/{diff,overlay,raw,reference,screens,REBUILD.md}`）を削除した | 「古い実装は全部消してよい」の指示に含まれると判断 | 台帳を eyex/ 採用へ書き直した |

## B. デザイントークン

| # | 決めたこと | 理由 | 影響 |
|---|---|---|---|
| B-1 | [変更] `--color-ink-faint` を `#7d8b85` → `#626e69` | モックの値は白地 3.56:1 で、プレースホルダも本文と同じ 4.5:1 が要る（WCAG 1.4.3） | 入力欄の手がかりが少し濃くなる |
| B-2 | [変更] `--color-line-strong` を `#b6c2bc` → `#778d82` | 1.84:1。縁だけが「押せる」ことを伝えるので 3:1 が要る（WCAG 1.4.11） | 入力欄・ボタン・選べる札の縁が濃くなる |
| B-3 | [変更] `--color-pine-line` を `#9cc4b6` → `#58947f` | 1.91:1。同上 | 選択中の札の縁が濃くなる |
| B-4 | [新設] `--color-focus-on-pine`（白）と `focusRingOnPine` | 青い輪は緑の面で 1.03:1 になって消える | 上のバー・主操作のフォーカス |
| B-5 | [変更] 共有の `focusRing` を `outline-amber` から `--color-focus`（青）へ | `--color-focus` が専用トークンとして定義されていたのに使われていなかった | **admin の Toaster も変わる** |
| B-6 | [破棄] 自己ホストの Web フォント（`@fontsource/ibm-plex-*`）をやめた | HIG に従い iPadOS の既定書体を使う設計なので、iPad では常に system 書体が先に当たり 15MB / 943 ファイルが無駄になる | ビルド後 15MB → 300KB、CSS 696KB → 14KB。**admin と example_service の書体も system になる** |
| B-7 | [破棄] 旧モック専用の方言トークン（`terminal-*` / `viz-*` / `sp-*` / `compact-*`）を削除した | 対応する画面ごと消えた | 参照している実装は無い（確認済み） |

## C. 仕様と文書の組み立て

| # | 決めたこと | 理由 | 影響 |
|---|---|---|---|
| C-1 | [新設] フェーズを P0〜P10 の 11 本に割り、feature spec を `003`〜`013` に置いた | 1 フェーズが単体で使える大きさに揃えるため | 実装順・ブランチ名 |
| C-2 | [新設] feature spec は **Draft で作り、E2E が緑になってから Approved に上げる** | validator は Approved の UC/AC に E2E を 1 対 1 で要求するので、先に Approved にすると `pnpm check` が落ちる | いま Approved は 003 だけ |
| C-3 | [変更] 旧 spec 002 が持っていた `UC-EYEX-149` / `UC-EYEX-151` を admin へ移した（`UC-ADMIN-USERS-01/02`） | admin の業務であり、EYEX 側の spec を消すと宙に浮く | `services/admin/e2e/user-administration.spec.ts` のタグ |
| C-4 | [破棄] 旧 `packages/contracts/src/glasses_management.ts`（1,600 行）を作り直し、admin が実際に使う 5 つだけ残した | 0 ベースの指示。旧設計のスキーマに依存する契約テスト 8 本も削除 | 契約は P1 以降で必要なぶんだけ足す |
| C-5 | [新設] 設計文書を `design/01`〜`09` の 9 本に分けた（要件・ドメイン・テーブル・API・画面フロー・ユースケース・非機能・追跡表・未決事項） | spec.md 1 枚には収まらず、validator の分母にも入れたくないため | 14,263 行 |
| C-6 | [新設] レビューを 3 巡（HIG/アクセシビリティ/UI → ユーザーストーリー/業務フロー/文言 → 文書間整合/実装可能性）に分け、すべて subagent が行った | 依頼どおり | 指摘は scratchpad に全文が残っている |

## D. 実装（P0）

| # | 決めたこと | 理由 | 影響 |
|---|---|---|---|
| D-1 | [新設] dev port 5175 / KV `SHORT_LIVED` / R2 `RECORDINGS` / service binding `NOTIFIER` | Terraform が既に用意している資源名に合わせた | `wrangler.jsonc` |
| D-2 | [新設] `store_memberships.permissions` を**空白区切りの文字列**で持つ | 担当解除が「空の配列」で届く仕様なので、空文字で表せる | D1 の列 |
| D-3 | [新設] `organizations.revision` を `text` で持ち、比較は `Number()` に通す | 文字列比較だと `'10' < '2'` が真になり、revision 10 以降が二度と更新されなくなる | 組織同期 |
| D-4 | [新設] default-deny の除外に `/api/public/*` を足した | お客様向け Web 予約は未認証で店舗 slug からテナントを解く | 認可の入口 |
| D-5 | [変更] たたんだサイドバーでもボタンの読み上げ名を残す（`sr-only`）。モックは `font-size:0` で消していた | アイコンだけのボタンに名前が無いのは重大な欠陥 | 見た目は変わらない |
| D-6 | [新設] `db:seed:local` と `seed.mjs` を足し、`make init` で EYEX と 3 店舗が入るようにした | 開発と e2e の足場 | 組織 id は `org-eyex-seed` |
| D-7 | [新設] Playwright の突き合わせ面を 1194×810 / `scale: 'device'` にした | 810 = 端末 834 − ステータスバー 24。ブラウザに与えられる実際の描画領域 | `playwright.config.ts` |
| D-8 | [前提] `maxDiffPixelRatio` は「いまその画面に許している差」とし、**下げるだけで上げない**運用にした | 合否ではなく、承認された見た目からの距離を測る道具として使う | 各 mock-compare のテスト |

## E. 未決のまま置いた前提

`specs/glasses_management/design/09-open-questions.md` の Q-01〜Q-12 は、いずれも**暫定案のもとで実装を進める**。
答えが来たら該当箇所を直す。中身は同ファイルを参照。

## F. P1（店舗の受付条件）の実装で決めたこと

実装を担当した subagent が、TODO と設計文書に書いていないことを自分で決めた分。**全 196 件**を担当ごとに並べる。

### F-backend-review — backend レビュー（8 件）

- 一覧系 3 本（staff / equipment / purposes）のクエリを `zValidator('query', ...)` へ寄せ、契約側の
  `StaffListQuery` / `EquipmentListQuery` / `PurposeListQuery` の真偽値を「文字列も受ける」形に広げた
  — 理由: 手書きの `.parse` が ZodError を投げて 500 `internal_error` になっていた（04-api §5 は入力の型エラーを
  zValidator の 400 と定めている） — 影響: `packages/contracts/src/glasses_management.ts`、
  `services/glasses_management/src/worker/index.ts` の 3 ルート。URL の書き方（`?includeInactive=true`）は変えない。
- `?includeInactive` に受ける語を `true` / `1` / `false` / `0` の 4 つに限った — 理由: 既存の実装が
  `['true','1'].includes(...)` で真だけを見ていたので、偽の書き方も同じ 2 通りに揃えるのが最小の驚き —
  影響: 知らない語（`yes` など）は 400 になる（以前は黙って false 扱いだった）。
- `DELETE .../equipment/:equipmentId/maintenance/:maintenanceId` の照合と削除に `equipment_id` を足した
  — 理由: パスが指す設備と実際に消す行が食い違っても 200 を返していた — 影響: 別設備の点検 id を渡すと 404。
- 点検の取得の右端を `<=` から `<` にした — 理由: 半開区間の決めに揃える（`to` の翌日 0:00 JST ちょうどに
  始まる点検を「範囲内」と数えていた） — 影響: `GET .../maintenance` の 1 件ぶんの境界。
- 紹介文の 200 文字を UTF-16 長ではなく符号位置で数えるよう契約を直した — 理由: 画面の文字数表示
  （`[...text].length`）と `validateIntroText` は符号位置で数えるのに、契約だけが UTF-16 長で数えていた
  — 影響: `StoreDetail` / `StorePatch` の `introText`。絵文字を含む 200 文字が保存できるようになる。
- クエリの検証を `zValidator('query', ...)` ではなく `validQuery()`（`safeParse` の結果をそのまま 400）で行った
  — 理由: `zValidator` を足すと RPC の型に `query` が必須で現れ、`$get({ param })` だけを呼ぶ web 側
  （`SettingsScreen.tsx` / `StaffPanel.tsx`。担当外のファイル）が型エラーになる。返す 400 の形は
  `zValidator` と 1 バイト違わない — 影響: `src/worker/index.ts` の 3 ルート。
- `commitSettings` と `commitUnversioned` を名前で分けた — 理由: 版を送らない面（営業日 / 技能 / 追加 / 点検）で
  戻り値を捨てているのが「見落とし」なのか「そういう決め」なのかコードから読めなかった。到達しない
  `if (!saved)` を足して死んだ分岐を増やすより、名前で示すほうが正しい — 影響: `src/worker/index.ts` の 7 か所。
  挙動は変わらない。
- 追加したテスト: 2 台同時保存 / 勤務時間の 409 が 1 行も残さない / 予約の間隔の 409 が上書きしない /
  休憩とお休みの曜日の展開 / 壊れたクエリの 400 / 別設備の点検 id の 404 / 点検の期間の右端
  — 理由: どれも「静かに壊れる」経路で、緑のまま抜けていた — 影響: `test/store-settings.integration.test.ts`（+7 本）、
  `packages/contracts/test/glasses_management.contract.test.ts`（+4 本）。

### F-contracts — 契約（Zod）（14 件）

- `SlotRulesInput.slotMinutes` の上限を 120 にする — 理由: TODO の テスト名「5 と 120 を通し、4 と 121 を落とす」と `03-data-model.md` §4.4（5〜120）が一致し、`04-api.md` §4.3 の「5..60」だけが外れている — 影響: `packages/contracts/src/glasses_management.ts` の `SlotRules` / `SlotRulesInput`
- `BusinessHoursInput` / `BusinessHoursView` に `blackouts` を持たせる — 理由: 受付を止める帯の保存経路は `PUT .../business-hours` しか無く（`04-api.md` §3.3 に帯専用のルートが無い）、T-008 の「営業時間の外にはみ出す帯は 400 で落ちる」が営業時間の保存で起きると書いてある — 影響: `BusinessHoursInput` / `BusinessHoursView` / `SettingsImpactRequest`（`business_hours` の draft）
- `BusinessHoursView` / `SlotRulesView` に `warnings: string[]` を持たせる — 理由: `04-api.md` §3.3 が「保存は拒まず応答に警告（`warnings: string[]`）を載せる」と書き、T-008 が「応答に警告が 1 件載る」を要求する — 影響: 同上
- `SlotRulesView.lastAcceptableAt` を `'0'`〜`'6'` の 7 キーちょうどの strictObject にする — 理由: `z.record` だとキーの欠けと余りを落とせず「曜日 0..6 の 7 件」を型で固定できない — 影響: `SlotRulesView`
- `SettingsImpactItem.targetType` を `'reservation' | 'web_slot'` の 2 値、`targetId` を `Uuid | null` にする — 理由: 影響の出どころは既存のご予約と Web 枠の 2 つだけで（T-010 の 3 関数）、Web 枠には行の id が無い — 影響: `SettingsImpactItem`
- `SettingsImpactReport` に「合計 0 件 ⇔ severity='info'」の refine を置く — 理由: AC-SET-14 の「0 件なら札を赤くしない」をサーバとフロントの両方で守らせるより、契約で 1 か所に固定する方が食い違わない — 影響: `SettingsImpactReport`
- `SettingsImpactRequest` の `equipment_stop` の draft に `startsAt` / `endsAt` を必須で持たせる — 理由: T-010 の `impactOfEquipmentStop` が止める期間を引数に取り、SETTINGS-EQUIPMENT に「止める期間」の欄がある — 影響: `SettingsImpactRequest`
- `StaffShiftsInput.weekly[].breaks` を最大 1 件にする — 理由: `staff_weekly_shifts` は `break_start` / `break_end` の 1 組しか持たず、2 件目は保存すると黙って落ちる — 影響: `StaffShiftsInput`
- `weekly` の曜日重複は契約で見ない — 理由: `staff_weekly_shifts_org_staff_weekday_idx`（一意）が DB 側で禁じており、TODO に対応するテスト名が無い — 影響: `StaffShiftsInput`
- 文字数の上限が `04-api.md` §4.3 と `03-data-model.md` で食い違うもの（`displayName` 40/30・`jobLabel` 40/20・`name`(equipment) 40/30・`nameInternal`/`namePublic` 40/30・`inactiveReason` 60/40・`note` 60/60）は `04-api.md` §4.3 を採る — 理由: 契約の正本は API 設計側で、列は text なので DB は狭めない — 影響: `StaffMember` / `Equipment` / `VisitPurpose` ほか
- `IsoDateTime` / `Uuid` / `DurationMinutes` はモジュール内の定数にとどめ export しない — 理由: T-002 / T-003 の実装一覧に無く、使われない export を増やすと Knip が落ちる — 影響: `packages/contracts/src/glasses_management.ts` / `index.ts`
- `Equipment.ledgerDisplay` に既定値を置かず、`EquipmentInput` 側だけ `'grey'` を既定にする — 理由: 応答は DB の値をそのまま出す（既定で塗りつぶさない）、入力は SETTINGS-EQUIPMENT の初期状態「灰色にして残す」に合わせる — 影響: `Equipment` / `EquipmentInput`
- `CalendarException` / `CalendarExceptionInput` の `note` を `null` 可にする — 理由: `store_calendar_exceptions.note` が NULL 可（`03-data-model.md` §4.3） — 影響: 同 2 つ
- 日付範囲（`CalendarExceptionQuery` 92 日 / `StaffShiftQuery` 62 日 / `MaintenanceQuery` 92 日）は `to - from` の日数で数え、`to < from` も落とす — 理由: TODO のテスト名が「from から to までが 92 日ちょうど」と差で書いている — 影響: 3 つの Query

### F-domain-store-settings — 受付条件のドメイン純関数（16 件）

- `services/glasses_management/src/worker/domain/store-settings.ts`
- `services/glasses_management/test/store-settings.time.test.ts`
- 金曜のテスト（`19:40`）は片付け 0 分・閉店前の帯なしの盤面で書いた — 理由: 片付け 10 分だと どの式でも 20:00−20−10=19:30 になり TODO の期待値 19:40 と両立しないため — 影響: `store-settings.time.test.ts` の「金曜 11:00–20:00 では 19:40 になる」。木曜（片付け 10 分）と「片付けが帯の長さを超えると…」（片付け 30 分）で片付けの効きは押さえてある
- `lastAcceptableStart` は最後の区間に収まらなければ 1 つ前の区間へ遡る — 理由: 最後の区間が最短の所要より短い日に「その日は受けられない」と誤って言わせないため — 影響: `lastAcceptableStart`。TODO の 5 本の期待値は変わらない
- `lastAcceptableStart` の上限は `min(区間の終わり, 閉店 − 片付け) − 最短の所要` の 1 本にした — 理由: 「満たすまで下げる」を反復ではなく閉じた式にすると分岐が減り、P2 の空き枠エンジンが同じ式を再実装しなくて済むため — 影響: `lastAcceptableStart`
- `lastAcceptableByWeekday()` を足した — 理由: `SlotRulesView.lastAcceptableAt` は 7 曜日ぶんの `Record` で、T-011 のルートが曜日ループを再実装すると式が 2 本になるため — 影響: `store-settings.ts` の新 export。臨時のお休み（例外）は見ない（曜日の表示のため）
- `weekdayOf` / `addJstDays` / `businessDateOf` の 3 つを export した — 理由: TODO の JST 3 本のテストが呼ぶ入口が要り、`addJstDays` は T-011 の勤務 62 日展開でも使うため — 影響: `store-settings.ts`。`businessDateOf` は `@app/shared` の `toJstDateString` に委譲する（JST の変換を 2 つ持たない）
- 保存を拒む 3 条件の 3 つ目に `validateIntroText()` を足した — 理由: TODO T-009 は 2 関数しか名指ししていないが、決め #4 の拒否 3 条件のうち紹介文 201 文字だけ関数が無くなるため — 影響: `store-settings.ts`。文字数は符号位置（`[...text].length`）で数える（画面の「200文字／200文字まで」と同じ数え方。契約の `z.string().max(200)` が先に落とすので、ここは文言を作るための判定）
- `validateHoursInput({ rows, blackouts })` を足した — 理由: 帯は曜日ごとにあり営業時間も曜日ごとに違うので、TODO の `validateBlackouts(windows, opensAt, closesAt)`（1 曜日ぶん）だけだとルートが 7 曜日のループを書くことになるため — 影響: `store-settings.ts`
- 同じ拒否理由は何曜日で見つかっても 1 件にまとめる — 理由: 決め #3 の 2 文を画面に 7 回並べないため — 影響: `validateBusinessHours` / `validateBlackouts` / `validateHoursInput` の戻り値
- 定休の曜日に帯が残っている保存も `blackout_outside_hours` で拒む — 理由: 開いていない時間を止める設定は意味を持たず、あとから営業日に戻したときに黙って枠が消えるため — 影響: `validateBlackouts(bands, null, null)`
- 警告どまりの 4 条件のうち「技能 0 人」「資源 0 台」に `warnSkillsWithoutStaff` / `warnEquipmentKindsWithoutUnits` を足した — 理由: TODO T-009 は `warnBusinessHours` / `warnShiftOutsideHours` しか名指ししていないが、決め #4 の警告 4 条件のうち 2 つに関数が無くなるため — 影響: `store-settings.ts`。技能・設備種別の日本語ラベルもこの面に置く（応答の `warnings: string[]` はサーバが作る）
- `warnShiftOutsideHours` は定休の曜日に勤務が入っている場合も警告 1 件で通す — 理由: 「勤務が営業時間外」と同じ性質で、拒むと人員が抜けた日に何も保存できなくなるため — 影響: `warnShiftOutsideHours`。文は「{曜日}は定休日ですが勤務が入っています。」
- 拒否の文言は 2 文型に揃えた: 閉店 =「閉店が開店より前のため保存できません。閉店の時刻を直してください。」(AC-SET-05 のまま) / 帯 =「受付を止める時間帯が営業時間の外にあるため保存できません。時間を直してください。」(03 §4.5 の語を 2 文型へ) / 紹介文 =「紹介文が 200 文字を超えているため保存できません。文字数を減らしてください。」(AC-SET-04 のまま) — 影響: `REJECTION_MESSAGES`
- `RejectionCode` は export しない — 理由: Knip が未使用の export として落とす。外へは `Rejection` として渡せば足りる — 影響: `store-settings.ts`
- テストは TODO の 14 本に 13 本を足して 27 本にした — 理由: 拒否 3 条件・警告 4 条件・曜日ごとの最後の時刻・月末の日跨ぎに 1 本もテストが無いと、この面のカバレッジが 80% を割るため — 影響: `store-settings.time.test.ts`（TODO の 14 本は名前をそのまま残してある）

### F-e2e — E2E とモック突き合わせ（11 件）

- E2E の使い捨て D1 に seed を流すため、`playwright.config.ts` の `webServer` に `node seed.mjs` を差し込み、`seed.mjs` が `E2E_STATE_PATH` を読んで `--persist-to` を付けるようにした — 理由: P1 の E2E は seed の銀座店を前提にしているのに、いまの webServer は migration しか当てておらず店舗が 1 件も無い（設定 6 面が 1 本も開けない） — 影響: services/glasses_management/playwright.config.ts / seed.mjs（P4 の T-020 が予定していた変更を前倒しした）
- `playwright.config.ts` に `workers: 1` を足し、`mock` / `mock-phone` の project を `ipad` より前へ移した — 理由: D1 は 1 本しか無く、業務 E2E がスタッフ・設備・目的を足す（消す経路が無い）ので、突き合わせは seed のままの盤面で先に撮らなければ意味が無い — 影響: services/glasses_management/playwright.config.ts（e2e は直列になる）
- `SettingsScreen.tsx` の `DEFAULT_PANELS` に営業日・ご来店の目的・スタッフと技能・設備と点検の 4 面を差し込んだ — 理由: 4 面のファイルは揃っているのに器へ登録されておらず、実アプリでは「この面はこれから作ります。」しか出ない（E2E も突き合わせも 1 本も成立しない） — 影響: services/glasses_management/src/web/settings/SettingsScreen.tsx（T-013 の器へ 4 行）
- `SettingsScreen.tsx` の `at`（いまの時刻）を `useMemo` で固定した — 理由: 描画のたびに `new Date()` を読むと `now` が毎回変わり、それを読み口に持つ設備と点検・ご来店の目的が描き直すたびに読み直して下書きを消していた（E2E で「変更を捨てる」が押せない形で露見） — 影響: services/glasses_management/src/web/settings/SettingsScreen.tsx
- `GET /api/staff/stores/:storeId/slot-rules` を `SlotRules` ではなく `slotRulesView`（PUT と同じ姿）で返すようにした — 理由: 読み口が `lastAcceptableAt` を返さず、画面を開いた直後は「木曜日に最後にお受けできるのは 18:20 です。」が 1 度も出ない（AC-SET-07 が成立しない） — 影響: services/glasses_management/src/worker/index.ts（応答に lastAcceptableAt / warnings が増える。integration は toMatchObject なので緑のまま）
- `SettingsScreen.test.tsx` の「まだ作っていない面は、その事実だけを出す」を「6 項目のどれを選んでも面が出る」に書き替え、fetch の代役に business-hours / slot-rules の形を足した — 理由: 6 面すべてを器に差し込んだので、置き去りの面はもう無い（代役が店舗の姿を全経路に返していて営業時間の面が壊れていた） — 影響: services/glasses_management/src/web/settings/SettingsScreen.test.tsx
- AC-SET-13 の E2E は「3件」ではなく「切った瞬間に読み取り専用の試算を投げ、いまは 0 件である」ことを固定した — 理由: P1 の D1 には予約の行が 1 件も無く（書き込む経路は P3）、お客様名は customers 表（P4）が入るまで null なので、モックの 3 行は実ブラウザでは作れない — 影響: e2e/store-settings.spec.ts（件数の境界は test/settings-impact.time.test.ts が持つ）
- AC-SET-15 の E2E は 50分→60分ではなく 50分→70分で固定した — 理由: seed の刻み 30 分・片付け 10 分では空きが 30 分刻みでしか現れず、50→60 で落ちる枠が 0 件になる（予約の行が入ると変わる） — 影響: e2e/store-settings.spec.ts（「60分／2件」は PurposePanel.test.tsx が持つ）
- AC-SET-08 の E2E は 9月30日ではなく 9月28日（月）の丸で見た — 理由: seed が 9月30日を最初から臨時のお休みにしているので、そこでは「営業日→お休み」の移り変わりを見られない（9月30日は AC-SET-09 が使う） — 影響: e2e/store-settings.spec.ts
- AC-SET-16 / AC-SET-12 の E2E は「Given の状態を先に保存してから」本題に入る — 理由: seed の修理・部品交換は既に非公開、勤務は曜日テンプレートだけで日付に展開されていないため、AC の Given がそのままでは成立しない — 影響: e2e/store-settings.spec.ts
- AC-SET-17 の E2E は 中村 彩 の `adminUserId` を dev グラントの `sub` に一時的に付け替えて撮り、終わりに戻す — 理由: dev グラントは組織ごとに 1 つの `sub` しか作らず、名乗り（中村 彩（スタッフ））を出すにはスタッフ行と結び付ける以外に経路が無い — 影響: e2e/store-settings.spec.ts（後始末で `user-eyex-nakamura` に戻す）

### F-frontend-review — frontend レビュー（11 件）

- `App.tsx` の主操作の丸文字を `text-2xl` から `text-hero` へ替えた — 理由: `text-2xl` は Tailwind 既定の段でトークン外、かつモック HOME.html の実測は 28px（`--text-hero`） — 影響: `src/web/App.tsx`。HOME の突き合わせが少し縮む
- `AppShell` の `grid-cols-[76px_1fr]` / `grid-cols-[216px_1fr]` を flex + `w-19` / `w-54` に替えた — 理由: 任意値の禁止（ルール 5）。`--spacing` の刻みで同じ 76px / 216px が出る — 影響: `src/web/shell/AppShell.tsx`。見た目は変えない
- `StaffPanel` の `grid-cols-[250px_1fr]` を flex + `w-62.5` に替えた — 理由: 同上。250px = `--spacing` × 62.5 — 影響: `src/web/settings/StaffPanel.tsx`。折り返しが効くぶん狭い画面で縦に落ちる
- `CalendarPanel` の `content-['']` は任意値のまま残した — 理由: 疑似要素を出す構文で、色も寸法も持たない — 影響: 丸の当たり判定（決め #14）
- 勤務の「お休み」の印を `<label>` で包み `min-h-11` にした — 理由: 印だけだと 20px で 44pt を割り、字を押しても効かなかった — 影響: `StaffPanel.tsx` の 7 列が縦に 24px 伸びる
- `PurposePanel` の保存を拒む文を 2 文の型（「〜のため保存できません。〜を直してください。」）へ直し、画面にも出すようにした — 理由: 決め #3。直す前は札が消えるだけで、なぜ押せないかが読めなかった — 影響: `PurposePanel.tsx`
- 6 面の読み込み中に `role="status"`、読み込み失敗に `role="alert"` を付け、文言を面の名前入りに揃えた — 理由: 4 面が黙って差し替わっていて、読み上げに何も出なかった — 影響: 6 つの Panel と `EquipmentPanel.test.tsx` / `PurposePanel.test.tsx` の 2 本の期待値
- `CalendarPanel` の「この店舗で予約を受け付ける」の切り替えに `focusRing` を足した — 理由: `tabIndex=0` で手繰れるのに輪が出なかった — 影響: `CalendarPanel.tsx`
- `--color-danger-line` / `--color-walkin-line` は theme.css に足さず、`border-danger/40` / `border-walkin/40` のままにした — 理由: 担当ファイルの外（`packages/ui`）で、並行して別のエージェントが触る恐れがある。生の hex でも既定パレットでも任意値でもないので、トークン経由の条件は満たす — 影響: 影響カードの縁が実測 #d39f9c（モックは #d9a9a4）
- `maxDiffPixelRatio` を実測ぴったり（小数第 4 位で切り上げ）まで下げた — 理由: 「下げるだけ」の決め。余白を 0.01pp 未満にして、次に何かがずれたら必ず落ちるようにする — 影響: `e2e/mock-compare.spec.ts` の 7 本
- `packages/ui` と `src/worker` は 1 行も触っていない — 理由: 並行して別のエージェントが持っている — 影響: `border-danger/40` と、web から `src/worker/domain/store-settings.ts` を読んでいる 2 か所は報告だけに留めた

### F-settings-shell — 設定の器と店舗の情報・営業時間（25 件）

- 器のファイル名を TODO の `SettingsShell.tsx` / `SettingsSections.ts` / `StorePanel.tsx` ではなく、指示にある `SettingsScreen.tsx` / `sections.ts` / `StoreInfoPanel.tsx` にした — 理由: 担当ファイルの指示が TODO の綴りより新しく、並行作業の衝突を避けるため — 影響: services/glasses_management/src/web/settings/*
- 影響カード（`ImpactCard.tsx`）・グループ表（`GroupTable.tsx`）・切り替え（`SwitchRow.tsx`）・`packages/ui/src/theme.css` の 2 トークン追加を作らない — 理由: 担当ファイルの一覧に無く、他エージェントが持っている — 影響: T-013 の 18 本のうち「影響カード」3 本と「切り替え」2 本は書かない（器は `danger` の受け口だけ持つ）
- 未保存の札を赤くするとき、縁は `--color-danger-line` ではなく `border-danger` を使う — 理由: 新トークンは theme.css の担当が足す。生 hex も任意値も書けない — 影響: SaveBar.tsx。トークンが入ったら 1 行差し替える
- モックの 14px / 15px は `text-body`（16px）へ丸めた — 理由: theme.css に 14/15px の段が無く、任意値を書かない（ルール 5）。13px へ落とすと iPad の腕の長さで読みにくい — 影響: 第2サイドバーの項目・グループ表の行・保存バーのボタン
- 第2サイドバーの幅 236px は `grid-template-columns` の任意値ではなく `w-59` の flex で作った — 理由: `grid-cols-[236px_1fr]` は任意値（ルール 5） — 影響: SettingsScreen.tsx
- `GET /api/staff/stores/:storeId/slot-rules` の応答に `lastAcceptableAt` が無い（04-api.md は `SlotRules` を返すと書き、`SlotRulesView` は PUT だけ）。画面は**計算せず**、応答に載っていれば出し、無ければその 1 行を出さない — 理由: 「式を 2 つ作らない」（T-009）を破らない。モックは開いた直後にこの行を描いているので、GET も `SlotRulesView` を返すべきで、これは worker 側（T-011）の 1 行の広げ方 — 影響: HoursPanel.tsx / 親エージェントへ申し送り
- 「通常の営業時間」の開店・閉店は、7 行のうち**最も多い開店・閉店の組**を基準として導出し、直すとその組と一致していた曜日ぶんをまとめて書き換える — 理由: データモデルに「基準の営業時間」の列は無く、モックの左上の 2 行はそこから導く以外に出せない — 影響: HoursPanel.tsx
- 「曜日ごとの上書き」は基準と違う曜日だけを月曜始まりで並べ、残りを「月・水・木・土曜日　通常どおり」の 1 行にまとめる。ここは**読み取り専用**にした — 理由: T-015 の 11 本はすべて表示を見るもので、曜日 1 つを直す操作は 1 本も無い。押せて何も起きない行を作らないため、chevron も出さない — 影響: HoursPanel.tsx（UC-SET-03 の「曜日ごとの上書きを直す」は開店・閉店の一括変更で満たす）
- 「通常の営業時間」3 行目の「お昼の休憩」を**出さない**（開店・閉店の 2 行にする） — 理由: `store_business_hours.break_start/break_end` は常に NULL と契約が決めており、どの帯が「お昼の休憩」かはラベルの文字列を決め打ちしないと選べない。データモデルに無い概念を画面で作らない。帯は右の「受付を止める時間帯」1 か所で直す — 影響: HoursPanel.tsx（モックとの差は T-021 の既知の差へ 1 件足す）
- 受付を止める時間帯は、曜日ごとに持っている帯を「名前・開始・終了が同じもの」でまとめて 3 行に見せ、直すと同じまとまりの曜日ぶんをまとめて書き換える。足した帯は営業する曜日すべてに入る — 理由: seed は 3 本 × 6 曜日 = 18 行だが、モックは 3 行しか描いていない — 影響: HoursPanel.tsx
- 「刻みが片付けより短い」警告の文言は worker の `warnBusinessHours` と同じ文をクライアントにも書いた — 理由: 保存の前に出す必要があり、サーバは保存の応答でしか返さない。判定は比較 1 つで、空き枠の式ではない — 影響: HoursPanel.tsx（文言の正本は `src/worker/domain/store-settings.ts`）
- 保存を拒む 2 文が立っている間は「保存」を `disabled` にする — 理由: 決め #4 の 3 条件は押しても通らない。押せるのに何も起きないボタンを作らない — 影響: SaveBar.tsx / SettingsScreen.tsx
- 403 の本文に出す「操作者（役割）」は、`GET /api/staff/stores/:storeId/staff` を器が 1 度だけ引き、JWT の `sub` と `adminUserId` が一致する行から取る。一致する行が無ければ「ご担当者（スタッフ）」と書く — 理由: いま「自分は誰か」を返す経路が無い。名前を偽らずに AC-SET-17 の型を満たす — 影響: SettingsScreen.tsx
- 403 の面に EX-PERMISSION の右半分（店長の暗証番号のテンキー）を作らない — 理由: 決め #11 で依頼ボタンを出さないのと同じで、店長の再認証は P10（REAUTH）の担当 — 影響: SettingsScreen.tsx
- グループ表の行の値は `<input>` をそのまま右寄せで置き、モックの `›` は出さない — 理由: chevron は「別の面へ行く」印。その場で直せる欄に付けると行き先を偽る — 影響: StoreInfoPanel.tsx / HoursPanel.tsx
- 第2サイドバーが細い柱に倒れる判定は `window.matchMedia('(max-width: 60rem)')` で見る — 理由: 文字を 200% にすると rem 基準の幅が実質半分になるので、rem のメディアクエリが文字倍率をそのまま拾う — 影響: SettingsScreen.tsx
- まだ作っていない 4 面（営業日 / ご来店の目的 / スタッフと技能 / 設備と点検）は「この面はこれから作ります。」と出す差し込み口にした — 理由: 他エージェントが同じ表へ Panel を差し込むまでの足場。App.tsx の既存の言い方に揃えた — 影響: SettingsScreen.tsx / sections.ts
- 面が 403 を受けたときの EX-PERMISSION の断りは**器**が描く（面は `save()` が `'forbidden'` を返すだけ） — 理由: 並行して書かれている EquipmentPanel / PurposePanel は返り値だけを見て自分では描かない。断りの文言と「下書きは残っています」を 1 か所に置く — 影響: SettingsScreen.tsx が `SaveBar.tsx` の `PermissionRefusal` を呼ぶ。CalendarPanel / StaffPanel は自分でも描いているので、統合時にどちらかへ寄せる必要がある
- 器と面の約束を `onDraftChange(draft: PanelDraft)` の 1 本にした。`PanelDraft = { changes, blocked?, danger, dangerNote, save, discard }` で、`changes.length` がそのまま「未保存の変更 N件」になり、403 の「下書きは残っています」にもそのまま並ぶ — 理由: 並行して書かれている EquipmentPanel.test / PurposePanel.test が `sections.ts` からこの形で読んでいる — 影響: sections.ts / SettingsScreen.tsx / StoreInfoPanel.tsx / HoursPanel.tsx
- `SettingsPanelProps` に `staff`（器が 1 度だけ引くスタッフ一覧）を足した — 理由: 「最後に直したのは …（店長）」と 403 の名乗りが同じ一覧を要る。面ごとに引くと同じ GET が 2 本になる — 影響: sections.ts / SettingsScreen.tsx / StoreInfoPanel.tsx
- `SettingsActor` に `roleLabel`（「スタッフ」「店長」）を持たせた — 理由: CalendarPanel / StaffPanel が `actor.roleLabel` を読む形で書かれており、`role` だけだと器から同じ actor を渡せない — 影響: sections.ts / SaveBar.tsx
- `SettingsPanelProps` に `today`（JST の暦日）を足し、器が `now` から導いて渡す — 理由: CalendarPanel / StaffPanel が `today` を prop で受ける形で書かれている — 影響: sections.ts / SettingsScreen.tsx
- 群（お店の基本・行き方のご案内・通常の営業時間・曜日ごとの上書き・受付を止める時間帯・予約の間隔・止める帯 1 本）は `role="group"` の div ではなく `<fieldset>` + `<legend>` で組んだ — 理由: Biome の a11y/useSemanticElements が role="group" を拒む。見出しが legend になるだけで見た目は変わらない — 影響: StoreInfoPanel.tsx / HoursPanel.tsx
- 保存の顛末は `'saved' | 'failed' | 'forbidden' | 'conflict'` の 4 値。409 のときは「ほかの端末が先に保存しました。画面を開き直して、もう一度お試しください。」と出す — 理由: 版が 1 本しか無いので 6 面のどこでも起こる。黙って失敗にすると原因が分からない — 影響: sections.ts / SettingsScreen.tsx
- 営業時間の保存は「営業時間 → 予約の間隔」の順に 2 本 PUT し、2 本目は 1 本目の応答の `version` を持ち越す — 理由: `store_settings_revision` は 1 本で、1 本目が版を +1 する。画面の「保存」は 1 つのまま — 影響: HoursPanel.tsx

### F-t004-schema — スキーマ・マイグレーション・seed（22 件）

- schema テストの「外部キー」ブロックを `13 表` ではなく `16 表` の名前で書いた — 理由: T-001 の承認 4 で `reservations` / `reservation_purposes` / `reservation_assignments` が P1 に入ったため — 影響: `test/schema.test.ts` の最後の describe
- 既存テスト `slug は組織の中で一意（お客様向け URL の解決に使う）` を `slug は全組織横断で一意（公開ページが組織を知らずに引く）` へ書き換えた（追記ではなく差し替え） — 理由: 同じ index を落として張り替えるので、古い期待をそのまま残せない — 影響: `test/schema.test.ts` の `stores` describe
- TODO に無い確認を 6 本足した（`stores` の P0 3 列の NOT NULL と既定値 / `store_business_hours` の break_* が NULL 可 / `store_slot_rules` の 4 列 / `staff` の PIN 2 列 / `equipment` の role_label と ledger_display / `visit_purposes` の store_id NULL 可と name_short） — 理由: 「表を作り直させない」「モックが要求する列を落とさない」を index 以外でも固定するため — 影響: `test/schema.test.ts`（33 本が緑）
- **`test/tenant-isolation.test.ts` は書き換えない** — 理由: T-006 の担当ファイルで、T-006 の先に書くテスト一覧が該当の 1 本（`同じ slug を別テナントが使っても衝突せず、互いに見えない`）を `slug は全組織で先取り順になる` へ置き換えると明記している — 影響: `pnpm --filter @app/glasses_management test` はこの 1 本だけ赤いまま T-006 へ渡る
- seed の id は「読める 16 進の固定 UUID」を組み立てて使う（`crypto.randomUUID()` を呼ばない） — 理由: `INSERT OR IGNORE` を 2 回走らせても行が増えない条件が「id が毎回同じ」であるため — 影響: `seed.mjs`
- P0 が入れた `stores` の既存 3 列（phone / address / access_note）の値は seed で直さない。P1 で足した 7 列だけを `UPDATE ... WHERE <列> IS NULL` で埋める — 理由: seed の「手で直した行は上書きしない」を保ちつつ、2 回目以降の実行でも列が埋まるようにするため — 影響: `seed.mjs` の stores 部分
- 銀座店の `name_public` / `nearest_station` / `parking_note` / `intro_text` / `updated_at` / `updated_by` を SETTINGS-STORE のモックの文字で入れる（T-012 の列挙には無い） — 理由: 完了条件「6 面が seed の値を出す」に「店舗の情報」の面が含まれるため — 影響: `seed.mjs`
- 止める帯 3 本を曜日ごとに営業時間へ合わせてずらす（金は 11:00–11:15 と 19:40–20:00、日は 17:40–18:00） — 理由: 帯は営業時間の内側という不変条件があり（外にはみ出すと保存を拒む・決め 4）、10:00–10:15 と 18:40–19:00 をそのまま入れると金（11:00–20:00）と日（10:00–18:00）で初期データが保存できなくなる。「朝の支度＝開店直後の 15 分」「閉店前の片付け＝閉店前の 20 分」という意味は保つ — 影響: `seed.mjs` の `store_blackout_windows` 18 行
- 佐藤 美咲の技能を 3 件（measure / processing / sales_reception）にした — 理由: 03 §5.1 は「4 つ」と書くが、同じ文が正本と定める SETTINGS-STAFF 右の技能札は ✓ が 3 つ（視力測定・加工・販売・受付）。「4 つ」は表示文字列の `・` 区切りを数えた誤り — 影響: `seed.mjs` の `staff_skills` 9 行
- 佐藤 美咲以外 5 名の曜日テンプレートを自分で組んだ（TODO は佐藤の 7 行しか書いていない） — 理由: 木曜に出るのが佐藤・高橋・中村の 3 名（LEDGER-STAFF の行）、金曜に山田がいない（SETTINGS-STAFF「本日はお休み」・当日は 2026-08-28 金）という 2 つのモックを同時に満たす組み方にした。火は店舗の定休なので全員お休み — 影響: `seed.mjs` の `staff_weekly_shifts` 42 行
- 休憩（`break_start` / `break_end` 13:00–14:00）は佐藤 美咲の勤務日だけに入れ、他 5 名は NULL — 理由: 03 §4.5 が「13:00–14:00 の灰帯が佐藤 美咲の行にだけある」と書いている — 影響: `seed.mjs`
- `staff_weekly_shifts.effective_from` は全員 `2026-08-01` — 理由: seed の `NOW`（2026-08-01）と同じ日に揃え、展開の起点を 1 つにするため — 影響: `seed.mjs`
- `staff_shifts`（展開結果）は seed で作らない — 理由: T-012 の列挙に無く、正本は `staff_weekly_shifts`。展開は保存時と日次 Cron（T-011 以降）の仕事で、seed が先に行を置くと展開側の「同期間を消してから入れる」と二重管理になる — 影響: `seed.mjs`（P2 の台帳は展開を回してから見る）
- 加工室だけ `is_active='0'` / `inactive_reason='部品待ち'` にした — 理由: SETTINGS-EQUIPMENT が「部品待ちで止めています」と描いている。TODO は 7 行の名前・種別・役割しか指定しておらず、状態は空白なのでモックで埋めた — 影響: `seed.mjs` の `equipment`
- 視力測定機 B は `is_active='1'` のままにし、点検の行だけ入れる — 理由: SETTINGS-EQUIPMENT の「止めています」は右の**編集中（未保存）**の下書きで、その下の「止めると影響するご予約 3件」はその下書きの影響カードである。保存済みの状態は「使えます」＋点検予定 — 影響: `seed.mjs`
- 点検は視力測定機 B の 1 行だけにする（モックの一覧が描く 視力測定機 A 9/14・検査室 1 10/5・フィッティング台 9/14・加工室 9/1 は入れない） — 理由: TODO が「点検 1 行」と明示している。TODO が明示するところは TODO を採り、黙っているところだけモックで埋める — 影響: `seed.mjs` の `equipment_maintenance`
- `visit_purposes.store_id` は銀座店の id を入れる（チェーン共通の NULL にしない） — 理由: 設定の「ご来店の目的」は店舗の面で、共通行を 1 店舗の画面から書き換えると他店舗へ波及する — 影響: `seed.mjs` の `visit_purposes` 6 行
- `store_memberships` の 2 件は admin ユーザ id を `user-eyex-yamada` / `user-eyex-nakamura` とし、同じ値を `staff.admin_user_id` にも入れる — 理由: 個人ログイン（`staff_org_admin_user_idx`）が JWT の `sub` から staff 行を引けることを dev と E2E で確かめられるようにする — 影響: `seed.mjs`
- 山田 大輔の権限を `store.read store.manage reservation.read reservation.write customer.read customer.write settings.read settings.manage`、中村 彩を `store.read reservation.read reservation.write customer.read settings.read` にした — 理由: TODO は「settings.manage を含む一式」「settings.read まで」としか書いていないので、`StorePermission` の 19 値から店長／スタッフの業務に要る範囲を選んだ — 影響: `seed.mjs`
- `staff.pin_hash` は 6 名とも NULL にする（SETTINGS-STAFF は佐藤 美咲を「設定してあります」と描いている） — 理由: PIN の再設定は P10 の担当で、平文もそれらしいハッシュも seed に置きたくない。NULL は「PIN 未設定＝個人ログイン不可」という定義そのものなので嘘にならない — 影響: `seed.mjs` の `staff`
- 銀座店の紹介文はモックの本文をそのまま入れる（実測 59 文字。モックの「78文字／200文字まで」とは合わない） — 理由: 文字数の表示は本文から計算する実装側の値で、本文のほうが正本。モック画像は直さない — 影響: `seed.mjs` の `stores.intro_text`
- `stores.sort_order` を 銀座 0 / 丸の内 1 / 新宿 2 にした — 理由: seed の店舗の並びと、モックの店舗切り替えの並びが同じ順であるため — 影響: `seed.mjs`

### F-t010 — 保存前の影響試算（13 件）

- `impactOfPurposeDuration` の引数に `currentDurationMinutes` と `durationMinutes` を足した — 理由: TODO の署名 `{ webSlots, purposeId, from, to }` だけでは「50分から60分へ延ばす」の前後が分からず「短くする変更は 1 件も落とさない」を判定できない — 影響: `src/worker/domain/settings-impact.ts` / T-011 が渡す body（`SettingsImpactRequest` の draft は新しい所要だけを持つので、現在値は DB の `visit_purposes.duration_minutes` から渡す）
- `impactOfBusinessHours` の第 2 引数を `windows` ではなく `days: { date, windows }[]`（JST 暦日ごとの受付できる区間）にした — 理由: 営業時間は曜日ごとに違うので 1 本の区間列では複数日のご予約を判定できない — 影響: 同ファイル / T-011 は `resolveBusinessDay` + `acceptableWindows` を日ごとに回して渡す
- `days` に行が無い日のご予約は「数えない」（影響なしとして扱う） — 理由: 行が無い＝試算の対象期間の外であり、「区間 0 本＝定休」は `{ date, windows: [] }` を明示して表す — 影響: 同ファイル / 呼び出し側は対象期間の全日を必ず渡す
- お客様名が無いご予約（`customer_id` が NULL＝ウォークイン）の札は `ウォークインのお客様　{短い名前}` にした — 理由: `null 様` と書くと読み上げが壊れ、schema が「ウォークインは NULL のまま確定できる」と書いている — 影響: 同ファイル / SETTINGS-EQUIPMENT の影響カードの行
- `readAffectedReservations` が返す `customerName` は P1 では常に `null` — 理由: `customers` 表は P4 で入る（16 表に無い）ため読みようがない — 影響: 同ファイル（P4 が JOIN を足す 1 か所）／AC-SET-13 の氏名表示は P4 まで出ない
- `readAffectedReservations` の `from` / `to` は ISO8601（UTC）の半開区間 `[from, to)` にした — 理由: `reservations.starts_at` が ISO8601 なので暦日で受けると境界の変換が読み口の外に散る — 影響: 同ファイル / T-011
- `readAffectedReservations` は `status IN ('cancelled','no_show')` を読まない — 理由: 取り消し済みのご予約を「止めると影響する」と数えると件数が実態から離れる — 影響: 同ファイル
- 目的が複数あるご予約の短い名前は `・` で連結する — 理由: `04-api.md` §4.5 の `purposeLabel`（`name_short` を `・` で連結）と札の作り方を揃える — 影響: 同ファイル
- JST の `HH:MM` を出す小さな関数をこのファイル内に置いた（日付は `@app/shared` の `toJstDateString` を使う） — 理由: `packages/shared/src/dates.ts` に時刻を返す関数が無く、共有パッケージの API を勝手に増やさない（他エージェントの担当ファイル） — 影響: 同ファイル内の `toJstClockMinutes`
- テストは TODO の 9 本に加えて 11 本足して 20 本にした — 理由: 3 種のうち `business_hours` と読み口が 9 本に 1 本も含まれておらず、実装が無検査のまま残る — 影響: `test/settings-impact.time.test.ts`（settings-impact.ts のカバレッジは 100/96.15/100/100）
- 影響カードの並びは開始の早い順に固定した — 理由: 件数だけ合っていて並びが入力順のままだと、SETTINGS-EQUIPMENT の 3 行が毎回違う順で出る — 影響: 同ファイルの `byStart`
- `reservation_assignments.target_id` が NULL（あとで決める）の行は設備を押さえていないものとして読み飛ばす — 理由: 「あとで決める」は特定の設備を止めても外れない — 影響: `readAffectedReservations`
- 半開区間の比較は文字列ではなく `Date.parse` で行う — 理由: ISO8601 の桁が揃っていない行が 1 つでも混ざると文字列比較が黙って壊れる — 影響: 同ファイル全体

### F-web-calendar-staff — 営業日・スタッフと技能（27 件）

- **（差し替え）**器（T-013 の `sections.ts` / `SettingsScreen.tsx`）が先に着いたので、2 面の props を `SettingsPanelProps`（`storeId` / `now` / `today` / `actor` / `staff` / `onDraftChange`）へ寄せ、面が持っていた保存行・保存の知らせ・403 の本文をすべて器へ返した — 理由: 保存バーは 6 面で 1 つという決め（TODO の T-013 シグネチャ）に合わせ、保存の言い方を 2 か所に分けない — 影響: 両パネルは `PanelDraft`（`changes` / `save` / `discard`）だけを渡す。面のテストも器へ差し込んで（`SettingsScreen` の `panels`）見る
- `canManage` の prop を作らない — 理由: 器が権限を配らず、403 は `save()` の戻り値 `forbidden` として器が EX-PERMISSION の面で断る（AC-SET-17） — 影響: 面に「見るだけ」の分岐を持たない
- `today` を prop で受ける（既定は `toJstDay(now ?? いまの時刻)`） — 理由: 実時刻に依存したテストを書かない（ルート AGENTS.md のテストの厚み 1） — 影響: 両パネル
- 「スタッフを足す」の失敗だけは面の中で知らせる — 理由: 器の知らせは `save()` の顛末しか運ばない。押した本人の目の前で黙って何も起きないのを避ける — 影響: `StaffPanel.tsx` の追加フォームに 1 行
- 営業時間（`GET .../business-hours`）も読む — 理由: 定休の曜日と「毎週のお休み」の値がそこにしか無い — 影響: `CalendarPanel.tsx` は 3 本（店舗・営業時間・臨時のお休み）を読む
- 「この店舗で予約を受け付ける」は `aria-disabled` の `role="switch"` にし、状態（受け付けています／止めています）を文字でも出す — 理由: `StorePatch` に `isActive` が無く保存経路が存在しない。押せて何も起きない切り替えを作らない（決め 11 と同じ理由） — 影響: `CalendarPanel.tsx`。P8（公開）か契約の追補で保存経路ができたら押せるようにする
- 定休（毎週のお休み）の丸は押せない `span` にし、丸の中に「休」を出す — 理由: `kind='special'` を作る操作を置かない（TODO の実装欄）ので、押しても行き先が無い — 影響: `CalendarPanel.tsx`
- 「まとめて決める」の 2 行から `›` を落とした — 理由: 押せない行に押せる印を付けない — 影響: `CalendarPanel.tsx`
- `kind='special'` の日は丸に「特」を出す — 理由: 作る操作は置かないが、既にある行を黙って営業日と同じ見た目にしない — 影響: `CalendarPanel.tsx`
- 丸の読み上げ名を `9月30日（水） 臨時のお休み` の形にした（TODO の例は「お休み」） — 理由: 定休と臨時を読み分けられるようにする — 影響: `CalendarPanel.test.tsx` の期待
- スタッフの一覧は経路だけ hc に引かせ、`includeInactive=true` は `$get` の 2 番目の引数（`fetch`）で足す — 理由: `GET .../staff` に query の zValidator が無く hc の型が `query` を受け取らないが、「いま使える」を切った行を一覧から消さないために `includeInactive=true` が要る。経路を手書きすると型から外れる — 影響: `StaffPanel.tsx` の `withInactive`
- 器が配る `staff` の prop を使わず、面が自分で引き直す — 理由: 器の一覧は `includeInactive` を付けておらず、保存のたびに引き直す必要もある — 影響: `StaffPanel.tsx`
- 勤務は `today` から 7 日ぶんを担当で絞らずに 1 回で読む — 理由: 「本日はお休み」と曜日 7 列の両方が同じ応答から作れる — 影響: `StaffPanel.tsx`
- 勤務の 7 列はモックの読み取り表示ではなく、曜日ごとに「お休み」＋開始・終了の入力にした — 理由: AC-SET-12 が曜日を直せることを求める — 影響: `StaffPanel.tsx`
- 休憩（`kind='break'`）は画面に出さず、保存でそのまま送り返す — 理由: モックに編集の場所が無い。落とすと静かに消える — 影響: `StaffPanel.tsx`
- 「いま使える」の行をグループ表に足した（モックに無い 4 行目） — 理由: UC-SET-12「退職したスタッフは行を消さず切って残す」に操作が要る — 影響: `StaffPanel.tsx`
- 「できる役割」「同時に受け持てるご予約」はモックの `›` をやめて `select` にした — 理由: 押せて何も起きない行を作らない。行き先の画面は無い — 影響: `StaffPanel.tsx`
- PIN の「作り直す」ボタンを出さない — 理由: PIN の再設定は P10（`013-terminals-and-audit`）。押せて何も起きないボタンを作らない — 影響: `StaffPanel.tsx`
- `warnShiftOutsideHours` を `src/worker/domain/store-settings.ts` から web でも import する — 理由: 式を 2 つ作らない（純関数で D1 も `Date.now()` も触らない） — 影響: `StaffPanel.tsx`
- 1 回の保存で 2 本以上書くときは、版を要求する書き込みの前に版を取り直す — 理由: どの書き込みも `store_settings_revision` を +1 するので、続けて送ると 2 本目が 409 になる — 影響: `StaffPanel.tsx`
- 下書きは効果（useEffect）で作らず、描画のたびに `保存されている姿 ?? 打ち込んだ値` で引き直す — 理由: 効果で入れると一覧だけ出て右側がまだ無い一瞬ができ、テストがその瞬間を掴んで落ちる（実際に落ちた） — 影響: `StaffPanel.tsx`
- 下書きは担当ごとに持つ（`Record<staffId, Draft>`） — 理由: 担当を選び直しただけで打ち込んだ値を捨てない — 影響: `StaffPanel.tsx`。札の件数はいま選んでいる担当のぶんだけを数える
- 保存は読み直しが済んでから `saved` を返す — 理由: 先に返すと器が「保存しました」と言った時点で画面がまだ古い — 影響: 両パネル
- 丸の数字は 13px（`--text-grid`）にした — 理由: モックは 14px だが `theme.css` に 14px の段が無い。任意値でトークンの外へ出ない — 影響: `CalendarPanel.tsx`
- 一覧の選択中の 4px の緑は `border-l-4` にし、選んでいない行にも同じ幅の透明な縁を置いた — 理由: モックの `box-shadow: inset` は Tailwind では任意値になる。透明な縁を置くと選び直しても文字が横へ跳ねない — 影響: `StaffPanel.tsx`
- 曜日の見出し（月火水木金土日）は `aria-hidden` にした — 理由: 丸の読み上げ名が日付と曜日を持つので、格子の見出しを読み上げると同じ語が 2 度出る — 影響: `CalendarPanel.tsx`
- `SettingsScreen.tsx` の `DEFAULT_PANELS` に 2 面を登録していない — 理由: あのファイルは T-013 の担当で、並行作業中は書き換えない — 影響: 器の担当者が `calendar: CalendarPanel` / `staff: StaffPanel` の 2 行を足すと第2サイドバーから開ける（型は `SettingsPanelProps` に合わせてある）

### F-web-equipment-purpose — 設備と点検・ご来店の目的・影響カード（30 件）

- 器の担当が先に書いた `SettingsScreen.test.tsx` から約束を読み取り、そちらへ合わせた（`onDraftChange` で `{changes, blocked, danger, dangerNote, save, discard}` を渡す形）— 理由: 保存バー・未保存の札・403 の本文・「保存しました」は器の持ち物で、面が二重に持つと保存ボタンが 2 つになる — 影響: `EquipmentPanel.tsx` / `PurposePanel.tsx`
- 途中まで `ref` で `save()` を呼ぶ形と `actor` prop で書いていたが、`sections.ts` が出た時点で全部そちらの型（`SettingsPanelProps` / `PanelDraft` / `SaveOutcome`）に寄せ、写しを消した — 理由: 同じ形を 2 か所で持たない — 影響: `ImpactCard.tsx`（写しの型を削除）
- JST の暦日は `sections.ts` の `toJstDay` / `formatJstDate` を使い、影響カード側には時刻まわり（`formatJstStamp` / `formatJstRange` / `jstTimeOf` / `jstInstant` / `addJstDays`）だけを残した — 理由: 「JST の暦日」の綴りを 2 つ作らない — 影響: `ImpactCard.tsx` / 両パネル
- 403 / 409 の本文は面に出さず、`save()` が `'forbidden'` / `'conflict'` を返して器に言わせる — 理由: AC-SET-17 の本文は操作者の名前と役割を要り、それを持っているのは器 — 影響: 両パネル
- 縁を `border-danger/40` / `border-walkin/40` にした（`--color-danger-line` / `--color-walkin-line` を待たない）— 理由: theme.css は担当外で、いま無いトークンを書くと縁が 1 本も出ない。塗りと同系の色をトークンから作れば実測値 #d9a9a4 / #d9bb92 とほぼ同じ（計算値 #d39f9c / #d4b28d）— 影響: `ImpactCard.tsx`
- 件数が 0 のときは空の `role="status"` だけを残し、中身を 1 文字も出さない（「影響はありません」も言わない）— 理由: AC-SET-14 と、件数の変化を割り込まない知らせで 1 度だけ伝えるため（AC-SET-19）— 影響: `ImpactCard.tsx`
- モックの 14px / 15px は `text-body`(16px)、影響カードの見出し 16px は `text-lead`(17px) へ寄せた — 理由: theme.css に 14px / 15px のトークンが無く、共有 iPad で読む面なので小さい側（13px）へは倒さない — 影響: 両パネルと影響カード
- 左右の割り付け 1.1fr / 0.9fr（EQUIPMENT）と 1.15fr / 0.85fr（PURPOSE）は `grid-cols-2` の均等割りにした — 理由: fr の比は任意値でしか書けず、任意値は禁止（ルール 5）— 影響: 両パネル
- 選択行の左端 4px の緑は `inset` の影ではなく `border-l-4 border-l-pine` で出した — 理由: 影の指定は任意値になる — 影響: 両パネル
- 触れる行は `min-h-12`(48px)。モックの `.grouped .gr` が 48px で、44pt を満たす — 影響: 両パネル
- 「いまの状態」は 3 つの規則で決めた（止めている＋理由あり →「{理由}で止めています」／使えるが今日に点検がかかる →「点検のため止めます」／それ以外の使える →「使えます」）— 理由: モックの 6 行すべてがこの規則で再現できる — 影響: `EquipmentPanel.tsx`
- まとめた行（相談カウンター 1・2）を押すと、まとめの 1 台目を編集する。編集の見出しは実在する 1 台の名前を出し、「この行は 2 台をまとめて出しています。」と添える — 理由: 保存が効くのは 1 台なので、まとめた名前を編集中に出すと嘘になる — 影響: `EquipmentPanel.tsx`
- まとめた行の「いまの状態」は、全部使えるとき「使えます」、そうでなければ「{台数}台のうち{止めている数}台を止めています」— 理由: まとめた行で 1 台の状態だけを代表させない — 影響: `EquipmentPanel.tsx`
- 「次の点検」は日付と時刻まで出す（`2026年8月28日（金）10:00–12:00`）。予定が無ければ「予定はありません」— 理由: 規則を 1 つに保つ。モックが A・検査室 1・加工室で時刻を省いているのは seed に点検が 1 行しか無く再現できない — 影響: `EquipmentPanel.tsx`
- 「止める期間」はモックの drill-in（›）ではなく、止める日 1 つ＋開始・終了の時刻 2 つの入力にした。3 つそろって初めて未保存の 1 件に数え、途中までのときは「日付と開始・終了の時刻をそろえると保存できます。」と出す — 理由: 行き先の画面が無く、押せて何も起きない行を作らない。点検が日をまたぐ前提は置かない — 影響: `EquipmentPanel.tsx`
- 「台帳に出す」は 2 択の `select`（灰色にして残す／出さない）— 理由: 同上 — 影響: `EquipmentPanel.tsx`
- 設備を足すときの `roleLabel` は種別から既定を入れる（視力測定機→視力測定／相談カウンター→接客・ご相談／加工台→加工）— 理由: 契約が `roleLabel` を必須にする一方、AC-SET-21 は入力を名前と種別の 2 つに限っている — 影響: `EquipmentPanel.tsx`
- 「いま使える」を切ったときに数える期間は、止める期間があればその帯、無ければ `now` から 14 日 — 理由: 数える範囲を決めないと件数が実行日で揺れる — 影響: `EquipmentPanel.tsx`
- 「次の点検」を引く範囲は今日から 92 日（契約 `MaintenanceQuery` の上限）— 影響: `EquipmentPanel.tsx`
- 「必要な技能」は 7 択の radiogroup（「要りません」を含む）、「必要な設備・場所」は 3 択の checkbox で 2 つ選ぶと残りを `disabled` にして「必要な設備・場所は 2 つまでです。」と出す — 理由: 契約の上限（技能 1・設備 2）を画面で越えられない形にする — 影響: `PurposePanel.tsx`
- 「台帳に出す短い名前」は足す画面と編集の箱の両方に置く — 理由: 足すときだけ入れて後から直せないのは片手落ち。TODO が「モックに描かれていない要素を足す唯一の箇所」と認めている — 影響: `PurposePanel.tsx`
- 並べ替え（上へ／下へ）は押した時点で保存する — 理由: 並び順は「その順のままお客様に見せる」ものなので、下書きのままだと確かめられない — 影響: `PurposePanel.tsx`
- 所要時間の試算は「今日から 14 日」ぶん。延ばす変更のときだけ投げ、短くする変更では 1 度も投げない — 理由: 短くする変更は 1 枠も落とさない（`impactOfPurposeDuration` と同じ判断）— 影響: `PurposePanel.tsx`
- 所要時間が 5 分の格子から外れたら `blocked` に 1 文を立てて保存を止める — 理由: 契約 `DurationMinutes` が拒む値を送って 400 を見せない。決め #4 の「拒む 3 つ」は業務の拒否で、入力の形はこれとは別 — 影響: `PurposePanel.tsx`
- `EquipmentKind` の日本語は 視力測定機 / 相談カウンター / **加工台** — 理由: T-018 のテスト名が正本。`04-api.md` の「加工室」は seed の設備名と取り違えたもの — 影響: 両パネル
- 一覧（設備・目的）は `includeInactive=true` で引く。RPC の型に query が現れないので `$path()` で URL だけ作り `auth.authFetch` で投げ、応答は契約で `parse` する — 理由: 止めた設備・目的の行を消さない（AC-SET-13 / UC-SET-13 / UC-SET-14）ために必須で、Worker 側がこの query を zValidator に通していない — 影響: 両パネル
- 「足す」は下書きに溜めず、その場で作る — 理由: 作成の API が即時で、版の衝突を 1 回の保存に混ぜると 1 行だけ作られて残りが落ちる状態が生まれる — 影響: 両パネル
- 設備の保存は 1 台ごとに PATCH し、店舗の版を 1 つずつ手元で進める — 理由: `bumpVersion` が書き込み 1 回につき版を 1 上げるので、同じ版で 2 台目を送ると必ず 409 になる — 影響: `EquipmentPanel.tsx`
- 保存のあとは一覧を引き直す。403 / 409 のときは引き直さず下書きを残す — 理由: 版を推測せず読み直す。断られた入力は捨てない（AC-SET-17）— 影響: 両パネル
- 現在時刻は `now` prop（ISO8601・既定は実時刻）で受ける — 理由: テストを実行日に依存させない — 影響: 両パネル

### F-worker-routes — Worker のルート（19 件）

- `requireStorePermission` を `src/worker/store-permission.ts` ではなく `src/worker/index.ts` の中に置いた — 理由: 指示が触ってよいファイルを 4 つに限っており、その中に `store-permission.ts` が無い — 影響: `services/glasses_management/src/worker/index.ts`（関数はファイル内に閉じる。別ファイルへ切り出すのは後続フェーズで可能）
- 設定の保存だけ drizzle の `db.batch()` ではなく D1 の `env.DB.batch()`（prepared statement）を使う — 理由: drizzle 0.45 の `db.batch()` は `db.run(sql\`\`)` の生 SQL を受け取れない（`SQLiteRaw._prepare()` に `.stmt` が無く `bind` で落ちる）ので、`INSERT ... SELECT ... WHERE EXISTS` の版ガードを配れない — 影響: `services/glasses_management/src/worker/index.ts`（読み取りは drizzle のまま。原子性は同じ D1 の 1 バッチ＝1 トランザクション）
- 保存を拒む理由のうち契約で表せないもの（帯が営業時間の外）は 400 `{ error: 'invalid_input', messages: [...] }` で返す — 理由: 04-api §5 のエラー表に検証専用のコードが無く、zValidator の 400 は 2 文の日本語を運べない — 影響: `PUT /api/staff/stores/:storeId/business-hours`
- `PUT .../staff-shifts` の応答に `warnings` を載せない — 理由: 契約の出力が `StaffShift[]` で、警告を入れる場所が無い（契約は自分の担当ファイルではない）。AC-SET-12 が求める「拒まない」ことはサーバが満たし、警告文は `warnShiftOutsideHours` を使って画面が出す — 影響: `services/glasses_management/src/worker/index.ts` / T-017 の StaffPanel
- `SlotRules.version` / `StaffMemberPatch.version` / `EquipmentPatch.version` / `StorePatch.version` / `BusinessHoursInput.version` / `StaffShiftsInput.version` はすべて `store_settings_revision.version` を指す。`store_slot_rules.version` 列はそれに合わせて進める — 理由: 1 画面の保存が 7 本の版比較にならないようにする（003 §4.6） — 影響: 設定 6 面の保存と応答
- ご来店の目的だけ `visit_purposes.version` の行単位の版で衝突を見る — 理由: `store_id` が NULL のチェーン共通行があり、店舗単位の版を条件にできない — 影響: `PATCH /api/staff/purposes/:purposeId`
- `CalendarExceptionInput` / `StaffSkillsInput` / `EquipmentMaintenanceInput` / `PurposeRequirementsInput` / `PurposeOrderInput` など版を送らない保存は 409 を返さず、版だけを +1 する — 理由: 契約に `version` が無く、版の条件を作れない — 影響: 営業日・技能・点検・必要資源・並べ替え
- 同じ日をもう一度足す操作は日付の一意 index に載せた上書き（`ON CONFLICT DO UPDATE`）にする — 理由: `store_calendar_exceptions_org_store_date_idx` に当たって 500 になるのを避ける — 影響: `POST /api/staff/stores/:storeId/calendar-exceptions`
- `:storeId` を持つルートは、権限を見る前に「その店舗が自分の組織のものか」を見て 404 を返す — 理由: 他テナントの店舗 id に 403 を返すと存在を漏らす（04-api §5 の `not_found` 行） — 影響: `requireStorePermission`
- 店舗に紐づかない目的のルートは「同じ組織のどこかの店舗で `settings.manage` を持つこと」を要求する — 理由: パスに `storeId` が無く、チェーン共通の目的を編集する面だから — 影響: `/api/staff/purposes` 4 本
- 真偽値を持つクエリ（`includeInactive` / `webPublishedOnly`）は `zValidator('query', ...)` を使わず、`'true'` / `'1'` を真として組み立ててから契約で `parse` する — 理由: クエリ文字列は必ず文字列で届き、`z.boolean()` が落とす — 影響: `GET .../staff` / `GET .../equipment` / `GET /api/staff/purposes`
- `GET .../staff?date=` はその日に `work` の勤務行がある担当だけに絞る — 理由: 契約の `StaffListQuery.date` に意味を持たせる（LOGIN-STAFF の「本日の勤務」）。`StaffMember` に勤務を同梱する場所が無い — 影響: `GET /api/staff/stores/:storeId/staff`
- `POST /api/staff/settings/impact` の Web 枠は、営業時間から帯を引いた区間を刻みで割り、次のご予約までの空きから片付けを引いた時間を 1 枠の持ち時間として数える — 理由: P2 の空き枠エンジンがまだ無いが、AC-SET-15 は P1 に残っている — 影響: `candidateWebSlots`（P2 が置き換える）
- `SettingsImpactReport.lastAcceptableAt` は `kind='business_hours'` のときだけ（今日の曜日で）返し、ほかは null — 理由: 契約が 1 値しか持てず、SETTINGS-HOURS の 7 曜日ぶんは `SlotRulesView.lastAcceptableAt` が出す — 影響: 影響試算の応答
- `equipment.role_label` が NULL の行は名前をそのまま `roleLabel` に出す — 理由: 列は NULL 可だが契約は 1..20 文字必須。API から作った行は必ず持つので、取り込み前の行だけの保険 — 影響: `GET /api/staff/stores/:storeId/equipment`
- `syncMembership` を `test/helpers.ts` ではなく `permissions.test.ts` と `tenant-isolation.test.ts` の中に置いた — 理由: 指示が触ってよいファイルに `helpers.ts` が無い（並行して別のエージェントが触っている可能性がある） — 影響: テスト 3 本に同じ形の小さなヘルパーが並ぶ
- 権限マトリクスの主体を `manager`（settings.manage あり）と `clerk`（settings.read まで）の 2 つ増やし、トークンは dev グラントではなく `signAccessToken` で直に作った — 理由: dev グラントは組織ごとに `sub` を 1 つしか作れず、同じ組織の 2 人を立てられない — 影響: `test/permissions.test.ts`
- 権限マトリクスの `body` を関数にして、送る直前に版を読み直す — 理由: 店長の 200 が 1 行ごとに版を進めるので、固定の `version` を書くと後ろの行が 409 になる — 影響: `test/permissions.test.ts`
- 既存の `同じ slug を別テナントが使っても衝突せず、互いに見えない` を `同じ店舗 id を持つ 2 テナントは作れないが、slug は全組織で先取り順になる` に置き換えた — 理由: P1 の `0001_*.sql` が `stores_slug_idx` を全組織横断の一意に張り替えたので、元のテストの前提が消えた — 影響: `test/tenant-isolation.test.ts`


## G. P2（空き枠と予約台帳）の実装で決めたこと

実装とレビューを担当した subagent の自己判断。**全 173 件**。

### G-availability（20 件）

- T-003 の `test/availability.test.ts` を作らず、19 本を `test/availability.time.test.ts` に同居させた — 理由: 担当として渡されたファイルが 2 本だけで、`test/fixtures/availability.ts` も含めて新規ファイルを増やせない — 影響: `services/glasses_management/test/availability.time.test.ts`（36 本）
- 受付を止める帯（blackout）は**枠の開始時刻だけ**を塞ぎ、ご予約の本体が帯をまたぐことは許す — 理由: T-004 の「帯を 12:01–13:00 へ 1 分ずらすと 12:00 の枠が戻る」は、60 分のご用件が帯をまたげないと成立しない。BOOK-01 が 11:30（お昼にまたがる 60 分）を満席として出しているのとも合う — 影響: `availability.ts` の条件 ②
- 所要が収まるかの判定（条件 ④）は P1 の `lastAcceptableStart` を 1 日 1 回呼んで上限にした — 理由: SETTINGS-HOURS の「最後にお受けできるのは 18:20 です」と押せる枠の式を 2 つ作らない（`03-data-model.md` §4.4） — 影響: `availability.ts` の条件 ④。閉店前の帯は実質「またげない」（最後の区間の終わりが上限になる）、お昼の帯は「またげる」という非対称になるが、これは業務上も正しい（閉店は硬い締切、お昼は受付を止めるだけ）
- 閉店までに収まらない開始時刻の理由は `outside_hours` にした — 理由: 11 値に「閉店に収まらない」専用の語が無く、営業時間の外という意味に一番近い — 影響: `availability.ts`
- 目的が要求する種別の設備が 1 台も無い（全部止めている）ときの理由は `equipment_busy` にした — 理由: 11 値に `no_equipment` が無い。`maintenance` は点検の事実が無いのに点検と言うことになる — 影響: `availability.ts` の条件 ⑥
- 同じ種別の設備が「点検で使えない」と「埋まっている」で混ざるときは `maintenance` を優先した — 理由: BOOK-02b が「視力測定機が 11:30 から点検です。」と点検を名指しする — 影響: `availability.ts` の条件 ⑥
- 同時受付上限（条件 ⑦）は**担当の割当行を全部**数える（担当が決まっている予約も含む） — 理由: AC-LEDGER-17 が「担当が未定の予約も数に入って 3 件で満席」と言う。`reservation_slot_locks` の `target_key='unassigned'` レーンだけを数えると、担当が決まった予約が上限に効かない — 影響: `availability.ts` の条件 ⑦
- `remaining` は担当・設備レーンでも**店舗の残り枠**（`max_parallel` − その枠のご予約件数）で統一した — 理由: 「あと2枠」の数字の意味を 1 つに保つ — 影響: `availability.ts`
- `store_slot_rules` が無い店舗は `slots: []` / `lanes: []` / `slotRules: null` を返し、`slotMinutes` の既定値を作らない — 理由: §4.4 の「暗黙の既定値を作らない」 — 影響: `availability.ts`。ルート側（T-010）は `slotRules === null` を見て設定画面へ誘導する
- 担当のレーンは「その日に勤務がある・技能を持つ・有効な担当」だけ作る — 理由: 一日中お休みの担当の空行は置ける枠を 1 つも持たず、読む人の目を素通りさせる — 影響: `availability.ts` の `lanes`
- 「担当が未定」のレーンも条件 ⑤（技能を持つ担当が空いている）を満たさないと置けないことにした — 理由: 担当を後で決めるだけで、誰も接客できない時刻をお受けしてよいわけではない — 影響: `availability.ts`
- `alternatives` は `preferredStartsAt`（任意）に最も近い置ける枠 3 件にした — 理由: BOOK-CONFLICT は「取れなかった時刻の代わり」を出す面で、前後どちらも候補になる — 影響: `availability.ts`
- 片付け時間は担当の勤務帯の外にはみ出してよいことにした（勤務は `[開始, 開始+所要)` だけを覆えばよい） — 理由: 片付けは店の時間で、担当の退勤後でも成立する — 影響: `availability.ts` の条件 ⑤
- 目的が 1 件も無く `durationMinutes` も無いときは `slot_minutes` を所要とみなす — 理由: 台帳から「この時刻は置けるか」だけを見る呼び出しが所要を持たない — 影響: `availability.ts`
- **未解決として残す**: 銀座店の seed にある「朝の支度 10:00–10:15」の帯があると、上の条件 ② により 10:00 の枠は `break` になる。BOOK-01-DATETIME は 10:00 を枠として描いており食い違う。帯の定義（`03-data-model.md` §4.5）に従い枠を出さない側を採った。seed（T-011）とモックはこちらでは直していない。
- 外へ出す判定は `evaluateSlot`（1 時刻）と `computeAvailability`（その日の格子）の 2 本にした。格子版は 1 枠ずつ前者を呼ぶ — 理由: 「9:30 は outside_hours」のように格子の外の時刻へ理由を返す必要があり、確定直前の再判定（P3）も同じ判定を要る — 影響: `availability.ts` の export
- 担当レーンの `subtitle`（「視力測定・加工」）は `StaffMember.subtitle` として呼び出し側から受け取る — 理由: 技能の日本語は `store-settings.ts` の `SKILL_LABELS`（非 export）が持っており、担当ファイルの外なので同じ語を二度書かない — 影響: `availability.ts` の `StaffMember` / `buildLanes`
- 応答の `reason` は「その日の枠が全部同じ理由で落ちたとき」だけ添える — 理由: BOOK-02b は「この日は受けられない」の一言を要るが、まだらに落ちている日に代表の理由を付けると嘘になる — 影響: `availability.ts` の `computeAvailability`
- 条件の順が ④（所要が収まるか）→ ⑤（技能）なので、技能を持つ担当が 1 人も居ない日でも閉店間際の枠だけは `outside_hours` を返す — 理由: TODO が定めた適用順どおり。最初に落ちた条件を返す — 影響: `availability.time.test.ts` の `no_skill` の本は 10:00 と 15:00 を名指しで見る
- テストを 36 本ではなく 37 本にした（`語彙` の 1 本を足した） — 理由: 返る理由が `AvailabilityReason` の 11 値から出ていないことを 1 本で縛る — 影響: `availability.time.test.ts`

### G-backend-review（7 件）

- 置けない枠の `remaining` を 0 に固定した — 理由: `isAvailable=false` の枠に「あと3枠」と書かせないため（画面は `remaining===0` を「満席」と描く） — 影響: `src/worker/domain/availability.ts` の `judge()`、`AvailabilitySlot.remaining` の意味
- 置ける枠の `remaining` を「使う枠すべての残りの最小」にした — 理由: 60分の枠が後ろの 30分枠で満席なのに先頭枠の残りを返していた — 影響: 同上。`test/availability.time.test.ts` に回帰 2 本
- `AvailabilityResponse` に `reason` を足した — 理由: TODO T-006 と `04-api.md` §3.6「`store_closed` / `purpose_unavailable` は 200 の本文で `slots: []` + `reason`」を満たすため。ドメインは既に日ぜんぶの理由を計算していたが応答で捨てていた — 影響: `packages/contracts/src/glasses_management.ts` / `index.ts` / `src/worker/index.ts` の availability ルート
- 応答の理由に `AvailabilityBlockReason`（11 値 + `purpose_unavailable`）という別の enum を作った — 理由: `AvailabilityReason` は枠ごとの語彙で 11 値に固定（`04-api.md` §4.5・T-001 の契約テスト）。`purpose_unavailable` は枠の性質ではなく求めそのものの性質なので混ぜない — 影響: 契約の新 export 1 本
- 台帳の行を出せない担当（消えた・別店舗）を指した押さえを「担当が未定」に倒した — 理由: 帯は「担当が未定」の行に置かれるのに `isUnassigned` が false で、色だけが理由になっていた（AC-LEDGER-07 は文字を要求する） — 影響: `domain/ledger.ts` の `drawnReservations`、`counts.pendingReview` の数え方も一致する
- `missingPurposes` を「求めた**相異なる** id のうち見つからなかった数」にした — 理由: 同じご用件を 2 度渡すだけで「お受けできないご用件」になっていた — 影響: `db/queries/ledger.ts`。同じ目的の重複は 1 件に畳まれる（所要は 1 回ぶん）
- 台帳の文数テストを「バッチの外の文も数える」形にした — 理由: バッチの中だけを数えると `requireActiveOrg` と `findStore` の 2 文が見えず、07-nfr の 16 本を測ったことにならない — 影響: `test/ledger.integration.test.ts`。実測は **12 文**

### G-contracts（16 件）

- `LedgerView` から `walkins` / `estimatedWaitMinutes` / `nextTicketNo` を落とす — 理由: いずれも LEDGER-WALKIN の面（`008-reception-and-walkin`）の値で、P2 の spec スコープ外かつ `walk_ins` 表がまだ無い — 影響: `packages/contracts/src/glasses_management.ts` の `LedgerView`。P5 が足す
- 「ご来店お待ち」の人数は `LedgerLane.subtitle`（「0名」）に載せる — 理由: `LedgerLane` は既に行見出しの副文（「視力測定・加工」）を持っており、人数のためだけの列を足さずに AC-LEDGER-08 を満たせる — 影響: `LedgerLane`。P2 は常に「0名」
- `LedgerView` に `isClosed` を足さない。定休日・臨時休業は `opensAt`/`closesAt` が null、店舗まるごとの受付停止は全幅の `LedgerBlock(kind='closed')` で表す — 理由: `design/04-api.md` §4.5 の `LedgerView` に `isClosed` が無く、`LedgerBlock.kind` に `closed` がある — 影響: `LedgerView` / `LedgerBlock`。AC-LEDGER-22 の描き分けは web 側で 2 通りを読む
- `ReservationDetail` から `customer` / `attentions` / `recording` を落とす — 理由: `CustomerSummary` / `CustomerNote` / `RecordingSummary` は `007-customer-records` と `010-recording` のスキーマで、P2 には表も値も無い（`reservations.customer_id` は常に NULL） — 影響: `ReservationDetail`。P4・P10 が足す
- `noteCustomer` / `noteInternal` の上限を 500 文字にする（`design/04-api.md` §4.5 の 2000 を採らない） — 理由: `design/03-data-model.md` §7.1 の列定義が「0〜500文字」で、列より長い本文を契約が通すと画面が保存できたつもりになる — 影響: `ReservationDetail`
- 文字数は符号位置（`[...text].length`）で数える — 理由: P1 の `introText` と同じ数え方に揃える（絵文字を 2 文字と数えない） — 影響: `ReservationDetail.noteCustomer` / `noteInternal`
- `axis` の語彙を `LedgerAxis`、`view` を `LedgerViewMode`、`filter` を `LedgerFilter` という 3 つの別々の enum として export する — 理由: 「1 つの enum にまとめない」を型の側から守り、`LedgerView`（応答スキーマ）と名前が衝突しないようにする — 影響: `LedgerQuery` / `AvailabilityQuery`（`axis` は同じ語彙なので `LedgerAxis` を使い回す）
- `AvailabilityQuery.purposeIds` / `equipmentIds` はカンマ区切りの文字列を受けて `Uuid[]` へ変換して返す（既定 `[]`） — 理由: `design/04-api.md` は「カンマ区切り・最大 5 件」としか書いておらず、分解を Worker 側の手書きに残すと件数の上限が契約の外へ出る — 影響: `AvailabilityQuery`
- クエリの数値（`durationMinutes`）は文字列と数値の両方を受ける — 理由: P1 の `QueryFlag` と同じ理由（クエリ文字列は必ず文字列で届き、手書き `parse` の ZodError は 500 に化ける） — 影響: `AvailabilityQuery.durationMinutes`
- `ReservationDetail` に「`webBookingCode` が非 null であることと `source==='web'` が同値」の refine を置く — 理由: T-001 のテスト名「web のときだけ非 null になる」を契約で守る — 影響: `ReservationDetail`
- 上記以外の不変条件（取消済みなら `cancelledAt` 非 null、`kind='staff'` の割当はちょうど 1 行、`isAvailable` と `reason` の対応）は refine にしない — 理由: T-001 のテスト名に無く、テストの無い分岐を契約へ足すとカバレッジの穴になる。DB とドメイン層（T-009 / T-010）が守る — 影響: `ReservationDetail` / `AvailabilitySlot`
- `cancelReason` の 4 語は `ReservationDetail` の中に直接書き、`ReservationCancelReason` として export しない — 理由: 取消の入力（`ReservationCancelInput`）は `009-change-and-cancel` の担当で、使い手が居ない export は Knip の未使用検出に当たる — 影響: `ReservationDetail`。P3 が取り出す
- `LedgerEntry.purposeLabel` の上限を 30 文字にする — 理由: `visit_purposes.name_short` は 1〜5 文字で、1 予約の目的は最大 5 件（5×5 + 「・」4 = 29） — 影響: `LedgerEntry`
- `ReservationDetail.assignments` を 1〜6 件にする — 理由: `kind='staff'` の行はちょうど 1 本（未定でも作る）、`kind='equipment'` は 0〜5 本という `03-data-model.md` §7.3 の不変条件の外枠を件数で表す — 影響: `ReservationDetail`
- `purposeLabel` は 30 文字、`purposeLabelInternal` は 220 文字を上限にする — 理由: `name_short` 5 文字 × 5 件 +「・」4、`name_internal` 40 文字 × 5 件 +「・」4 — 影響: `ReservationDetail` / `ReservationSummary` / `LedgerEntry`
- `LedgerView.slotMinutes` と `AvailabilityResponse.slotMinutes` は `SlotRules.slotMinutes` と同じ 5〜60、`cleanupMinutes` は 0〜60 にする — 理由: 応答が設定より広い値を返せると台帳の列数が設定画面と食い違う — 影響: `LedgerView` / `AvailabilityResponse`

### G-e2e-mock（22 件）

- **`LedgerScreen.tsx` に詳細（`ReservationDetail`）と通信断（`OfflineBanner`）を繋いだ** — 理由: 両方とも部品は出来ていたが、繋ぐ担当が居ないまま残っていた（`decisions-p2-timetable.md`「口だけ開けた」／`decisions-p2-list-detail-offline.md`「器を触らない担当分けだから」）。繋がないと AC-LEDGER-15 / 18 / 19 と UC-LEDGER-04 / 09 / 10 の 6 件が E2E で 1 本も確かめられず、spec を Approved に上げられない（validator は Approved の ID しか対応付けを許さないので、1 件でも欠けると 33 件すべてが「未知の対応付け」になる）— 影響: `src/web/ledger/LedgerScreen.tsx`
- **`src/web/home/MyReservations.tsx` を新設し `App.tsx` のトップへ差し込んだ** — 理由: 同上（AC-LEDGER-21 / UC-LEDGER-11）。TODO の T-019 は個人トップを含むが、担当が「別の担当に残る」と記録して降りている — 影響: `src/web/home/MyReservations.tsx` / `src/web/App.tsx`
- **`e2e/store-settings.spec.ts` の AC-SET-12 の前置きを 2 行に縮めた** — 理由: P2 の seed が当日の勤務（`staff_shifts`）を展開するようになり、佐藤 美咲の日曜が最初から 12:00–19:00 で入る。「まず 12:00–19:00 を置く」という前置きが差分ゼロになり、保存ボタンが押せないまま 30 秒で落ちていた（P1 の e2e が P2 の seed で壊れた）。テストの狙い（営業時間の外へはみ出しても警告だけで保存できる）はそのまま — 影響: `e2e/store-settings.spec.ts`
- **端末の時計と応答の `serverNow` の両方を 2026年8月27日 11:08（JST）に据えた** — 理由: seed のご予約はその日に固定だが、サーバの時計は実時刻で進む。据えないと台帳が本日（＝予約 0 件の日）を開き、現在時刻の線も「これから 7件」も出ない — 影響: `e2e/ledger.spec.ts` / `e2e/mock-compare.spec.ts`。盤面（D1）には触れない
- **`serverNow` を差し替えるとき `counts.upcoming` も同じ時刻で数え直した** — 理由: 件数はサーバが `serverNow` から数えた結果なので、時刻だけを据えると札の数字（0件）と行数（7行）が食い違う。数え直すのは担当軸の行があるときだけ — 影響: 同上
- **AC-LEDGER-16 を 14:00／14:30 で確かめた（AC の文言は 12:00／12:30）** — 理由: 8月27日の 12:00–13:00 は店舗の受付停止帯（お昼）で、片付け以外の理由でも枠が消える。13:00–14:00 の 1 件（高橋 健）を使えば、片付け 10分だけが効く「終わりちょうどは置けない／次の刻みは置ける」がそのまま見える — 影響: `e2e/ledger.spec.ts`
- **AC-LEDGER-17 を 11:00（満席）と 13:00（残り 1）の 2 点で確かめた（AC の文言は 13:00 に 3 件）** — 理由: seed の 13:00 台は 2 件で上限 3 に届かない。11:00 は 4 件（うち 1 件が担当未定）で満席になり、13:00 は担当未定の 1 件を数えるからこそ残り 1 になる。「担当が未定も数に入る」と「上限に達したら満席」を分けて見る — 影響: `e2e/ledger.spec.ts`
- **AC-LEDGER-11（点検）を 8月28日（金）で確かめた** — 理由: seed の点検は 8月28日 10:00–12:00（視力測定機 B）。モックは 8月27日に描いているが、盤面を書き換えない — 影響: `e2e/ledger.spec.ts`
- **AC-LEDGER-21 の 0 件の枝を「佐藤 美咲が休みの金曜」で確かめた** — 理由: 「わたし」が誰か分からない共有端末ではこの面を出さない決めにしたので、0 件は「わたしは分かるが担当が 1 件も無い日」でしか起きない — 影響: `e2e/ledger.spec.ts`
- **AC-LEDGER-21 は `staff.adminUserId` を dev の `sub` に付け替えて確かめ、必ず戻す** — 理由: P2 に個人端末の名乗り（PIN は P10）が無く、共有端末の `sub` は `dev:<org>` 固定。設定の API で結び付けるのが盤面を汚さない唯一の道 — 影響: `e2e/ledger.spec.ts`（D1 を書き換える唯一の 1 本。`finally` で戻す）
- **詳細を閉じる 2 つの道は `page.mouse.click` で押した** — 理由: 詳細は台帳いっぱいの覆いを敷いており、`locator.click()` は覆いを「邪魔者」と見なして待ち続ける。指は覆いに当たるのが正しい振る舞いなので、座標で押す — 影響: `e2e/ledger.spec.ts`
- **UC は対になる AC の test に相乗りさせ、22 本で 33 件を担った** — 理由: TODO が明示的に許している。1 ID 1 回の縛りは validator が見る — 影響: `e2e/ledger.spec.ts`
- **e2e の tsconfig は DOM の型を持たないので、`getComputedStyle` だけをファイル頭で宣言した** — 理由: `tsconfig.base.json` の `lib` は `ESNext` のみ。`any` を書かず、使う分だけを型として置く — 影響: `e2e/ledger.spec.ts`
- **通信が切れたら、最後に読めた台帳をそのまま出し続け、日付・並べ方・かたちもその応答へ戻す** — 理由: 届いていない日を出しているふりをしないため。届かなかった日を出したまま古い行を描くと、台帳が黙って嘘をつく — 影響: `LedgerScreen.tsx`
- **一度も読めていないときは帯を出さず、これまでどおり「台帳を読み込めませんでした」を出す** — 理由: 「いまご覧の内容は 11:08 現在」と言える中身が無い — 影響: `LedgerScreen.tsx`
- **詳細の矢印は、選ばれたセル（`aria-selected="true"`）の座標から毎回測る** — 理由: `Timetable` は押した帯の DOM を渡さない（`onSelectEntry` は帯そのもの）。器の中の相対座標で置けば、モーダルにせず帯へ矢印を刺せる — 影響: `LedgerScreen.tsx`
- **担当と場所のお名前は、店舗の名簿（`staff` / `equipment`）を店舗 1 つにつき 1 度だけ読んで突き合わせる** — 理由: `ReservationDetail` は id しか運ばない。日付を動かしても名簿は変わらないので取り直さない。読めなくても台帳は読める（お名前が出ないだけ） — 影響: `LedgerScreen.tsx`
- **個人トップの「わたし」は JWT の `sub` と `staff.adminUserId` の突き合わせで引き当て、誰にも当たらない端末にはこの面を**出さない** — 理由: HOME は共有端末のトップで、モックにこの一覧は無い。出すと承認済みモックとの突き合わせ（HOME）が壊れる。名乗りの引き当て方は `SettingsScreen` の `subjectFromToken` と同じ道に揃えた — 影響: `MyReservations.tsx` / `App.tsx`
- **個人トップの行は応答の並び（開始の早い順）をそのまま使い、画面で並べ直さない** — 理由: 並べ方を 2 か所に持つと、どちらが正しいか画面から判断できなくなる — 影響: `MyReservations.tsx`
- **トップの器を 2 列（主操作の列 ＋ 個人の一覧）にした。1 列目の中身と隙間は元のまま** — 理由: 共有端末では 2 列目が空になり、HOME の突き合わせが画素まで変わらない（実測でも HOME は 3.23% のまま通った） — 影響: `App.tsx`
- **LEDGER-DETAIL / EX-OFFLINE / HOME-PERSONAL は突き合わせない** — 理由: 担当指示が台帳 3 面と決めている。3 面とも中身は `ledger.spec.ts` の業務 E2E が文言と操作で確かめている — 影響: `e2e/mock-compare.spec.ts`
- 残っている差の中身は 3 つの test のコメントに 1 件ずつ書いた。**下げるだけで上げない。**

### G-frontend-review（22 件）

- 予約も点検も無い設備の行を `laneSegments` で 1 枠にまとめた — 理由: 14 枠に割ると画面は 1 枠しか描かず、その行へ矢印で降りたとき tabindex=0 の枠が台帳から消えて Tab で入り直せなくなる — 影響: `src/web/ledger/metrics.ts` `laneSegments` / `Timetable` の焦点移動
- 帯を押したときに `active.row` を押した行に合わせた — 理由: いままで押した行と矢印キーの起点が食い違っていた — 影響: `src/web/ledger/Timetable.tsx` `press`
- ツールバーの地を白、セグメントの地を灰、選んだ札を白＋緑の字にした — 理由: モックの `.toolbar { background: var(--surface) }` `.segmented { background: var(--surface-2) }` `.segmented button.on { background: var(--surface); color: var(--brand) }` と地と柄が逆だった — 影響: `LedgerScreen` のツールバー
- ツールバーの高さを 56px（`h-14`）・左右 16px・間 10px に詰めた — 理由: モックの `.toolbar` の実測。触れる大きさ 44pt は札そのもので確保し、器の余白を削って高さを合わせる — 影響: `LedgerScreen`、台帳の上端の位置
- 列見出しに縦罫（`border-r border-line`）を足した — 理由: モックの `.tt-head` が持っている。背景の目盛りは見出しの下からしか通らない — 影響: `Timetable`
- 現在の札の目印を 2px から 3px にした — 理由: モックの `.nowchip::before { width: 3px }` — 影響: `LedgerScreen`
- 詳細（ポップオーバー）が台帳からはみ出すときに、帯の上へ返す／左へ寄せるようにした — 理由: 器が `overflow: hidden` なので、下のほうの行の帯を押すと詳細がまったく読めなくなる — 影響: `ReservationDetail`（`anchor.bandTop` を足した）・`LedgerScreen`
- 読み込み中に `role="status"`、読み込めなかったときに `role="alert"`、定休日の知らせに `role="status"` を足した — 理由: 中身がまるごと入れ替わるのに読み上げへ何も伝わっていなかった — 影響: `LedgerScreen` / `Timetable`
- 格子の見出しの行に `aria-rowindex={1}` を足した — 理由: `aria-rowcount` を宣言した格子は全行が `aria-rowindex` を持つ — 影響: `Timetable`
- 個人トップの 1 行をモックと同じ 2 段組み（時刻＋状態の札／ご用件）にした — 理由: HOME-PERSONAL の実測 — 影響: `MyReservations`
- 突き合わせに LEDGER-DETAIL と EX-OFFLINE を足した（HOME-PERSONAL は足さない） — 理由: 前の 2 つは盤面に触れずに撮れる。HOME-PERSONAL は `staff.adminUserId` を書き換えないと出せず、同じ D1 を使う後続の突き合わせを汚す — 影響: `e2e/mock-compare.spec.ts`
- 日付の帯は台帳の先頭に置いたまま（上のバーの中央へ移さない） — 理由: `AppShell` に中央の差し込み口を足すと P0 の器と App の状態の持ち方まで変わり、並行して動いている他の面へ波及する。差は実測値としてコメントに残す — 影響: LEDGER-* 4 面の差分の割合
- `packages/ui/src/theme.css` の `--color-grid` / `--color-grid-hour` を `--color-grid-line` / `--color-grid-hour-line` に改名した — 理由: Tailwind v4 が `text-<名前>` を大きさと色の両方から引くため `--color-grid` と `--text-grid` が衝突し、`.text-grid` が font-size を一切出さず `color: #e7ecea`（ほぼ白）になっていた。13px の指定 65 か所が全部 16px になり、`text-grid text-danger` の 8 か所（設定画面のエラー文と警告文、台帳の「現在 11:08」の札）が地に溶けて読めなかった — 影響: `theme.css` の 2 行と `Timetable` の 2 か所。全画面の差分が下がった
- 日付の帯を `AppShell` の中央（`barCenter`）へ移した — 理由: 台帳の先頭に置くと 60px の行がまるごと余分で、上のバー 64px ＋ ツールバー 56px ＝ 120px というモックの骨格から台帳全体が 60px 下へずれていた — 影響: `AppShell` に `barCenter` を新設、`App` が受け渡し、`LedgerScreen` は `onBarCenter` が無いときだけ自分で緑の帯を出す
- 台帳の器の高さを `h-full` で取るようにした — 理由: `App` の箱が flex ではないので `flex-1` が効かず、台帳が画面の下端まで届かず 86px の余白が残っていた — 影響: `LedgerScreen`
- 台帳の地を `bg-surface`（白）にした — 理由: 空き枠が `--color-paper` で透けていた。モックの空き枠は #ffffff（基準画像を実測） — 影響: `Timetable`
- 表示窓と同じ 14 列の日は `min-width: 100%` にした — 理由: 1 列 68px に丸めるとモックの 1fr（67.7px）と 1 列 0.3px ずれ、右端の 16:30 で 4px の食い違いになる — 影響: `metrics.gridMinWidth` とその test
- 詳細の矢印の合わせ先を「帯の左端」にした — 理由: `+ ARROW_LEFT_PX` して `- ARROW_LEFT_PX` していたので打ち消し合い、詳細が帯の左端から始まって矢印が 40px 右を指していた — 影響: `LedgerScreen` の `anchor`
- 帯に `overflow-hidden` を足した — 理由: 帯からはみ出した字が、あとに描かれる隣の枠の下へ潜って途中で切れていた（モックの `.appt` も `overflow: hidden`） — 影響: `Timetable`
- 帯の時刻の区切り（–）だけ等幅から外した — 理由: 13px の等幅では 2 本の短い線に割れて「11:00--12:00」と読めてしまう — 影響: `Timetable`
- ご要望の鉤括弧を二重に付けないようにした — 理由: seed の `note_customer` が既に括ってあり「「遠近は初めてです」」になっていた — 影響: `ReservationDetail`
- 403 を通信断と分けた — 理由: 権限が無いときに「もう一度読み込む」を出しても結果は同じで、古い台帳を出し続けるのも誤り — 影響: `LedgerScreen`

### G-ledger（16 件）

- `view='list'` のときは `axis` によらず担当軸の行を返す（`axis` は応答にそのまま載せる） — 理由: 予約リストの「担当」欄と「決めてください」は担当の割当からしか出せず、設備の行を平坦化しても列が埋まらない — 影響: `src/worker/domain/ledger.ts` `buildLedgerView`（`laneAxis`）。`axis=resource` + `view=list` でも lanes は担当の行になる
- 設備軸の帯は**その設備を押さえている区間**で描き、担当軸の帯はご予約まるごとの区間で描く — 理由: 15:30–16:00 は測定機・16:00–16:30 は相談カウンター という押さえ方があり、設備の行に 15:30–16:30 の帯を出すと空いている測定機が埋まって見える — 影響: `equipmentLanes` / `staffLanes`。`ledger.test.ts` の「1 予約が 2 つの設備を押さえていると…」
- 「担当が未定」の行と「ご来店お待ち」の行は、帯が 0 本の日でも**常に置く** — 理由: モック LEDGER-STAFF が両方を常設の行として描いており、日によって行が消えると台帳の高さと押す位置が変わる — 影響: `staffLanes`
- 定休日・臨時休業（`opensAt` か `closesAt` が null）は `lanes` を空配列で返す — 理由: AC-LEDGER-22 の「目盛りだけの空の格子を出さない」を、行を作らないことで担保する — 影響: `buildLedgerView`
- 点検の `LedgerBlock.label` は常に「点検」にし、`equipment_maintenance.note` を載せない — 理由: note は 60 文字まで許されるが `LedgerBlock.label` は 30 文字までで、切って出すと業務上読めない — 影響: `equipmentLanes`
- 休憩の `LedgerBlock.label` は「休憩」の 1 語にする — 理由: `staff_shifts` に文言の列が無く、帯の幅（30分 1 列）に入る語がこれしかない — 影響: `staffLanes`
- 当日の勤務（`kind='work'`）が無くても、その日のご予約を持つ担当は行を出す — 理由: 勤務の展開漏れや当日の代打でご予約が台帳から消えると、そのお客様を誰も見つけられない — 影響: `staffLanes`。勤務もご予約も無い担当（小林 誠）は従来どおり行にしない
- 設備は「止めていて（`is_active='0'`）かつ `ledger_display='hide'`」の行だけを台帳から外す — 理由: schema のコメントどおり `ledger_display` が効くのは止めている設備だけで、動いている設備は必ず行にする — 影響: `equipmentLanes`
- 担当の割当行が欠けている／担当 id が当日の行に無いご予約は「担当が未定」の行で拾う — 理由: I-05 により起きないはずだが、起きたときに帯を落とすと台帳からご予約が消える（静かに壊れる） — 影響: `drawnReservations` の `isUnassigned` と `staffLanes` の未定行
- 取り消したご予約の押さえ（`reservation_assignments`）の行が残っていても、設備の行に帯を出さない — 理由: 取消で消すのは `reservation_slot_locks` であり、割当の行は残りうる — 影響: `equipmentLanes`
- `counts.all` は「帯にする件数」（他店舗・他の日・`cancelled` を除き、`no_show` を含む）とする — 理由: 札の数字と実際の行数が食い違うと、どちらが正しいか画面から判断できない — 影響: `buildLedgerView` / `filterLedgerRows`
- 他店舗・他の日のご予約は関数の側でも落とす（読み出し側の絞り込みを信用しない） — 理由: テナント分離と同じで、境界を 1 か所に頼らない — 影響: `drawnReservations`
- 表示窓 14 列は 420分（JST 10:00–17:00）とし、`offsetRatio` / `widthRatio` をこの 420分で正規化する — 理由: モックの現在時刻線 0.1619 が「11:08 は 10:00 から 68分 ÷ 420分」で出ており、この幅でしか一致しない — 影響: `LEDGER_WINDOW_MINUTES` / `placeOnLedgerWindow` / `nowMarker`
- 表示窓の外へ出る帯も位置を返し、`isWithinWindow=false` を添えるだけにする（捨てない） — 理由: 営業時間が 14 列より長い日は台帳の中を横スクロールさせるので、窓に入らない 17:00 のご予約を落とすと台帳から消える — 影響: `placeOnLedgerWindow`
- `nowMarker` は表示中の日付が本日でなくても `clock` を返し、`ratio=null` で線を出さない合図だけを立てる — 理由: 線と札の出し分けは画面の決め（AC-LEDGER-03 / 04）で、ドメインは事実だけを返す — 影響: `nowMarker`
- `LedgerListRow` に `durationMinutes` を持たせない — 理由: 開始と終わりから引けるうえ、`reservations.duration_minutes` と食い違ったときにどちらが正かを増やしたくない — 影響: `buildLedgerRows`

### G-list-detail-offline（24 件）

- ファイル名を TODO の `LedgerList` / `ReservationPopover` / `OfflineBand` ではなく `ReservationList` / `ReservationDetail` / `OfflineBanner` にした — 理由: 担当指示のファイル一覧が正本で、並行する他エージェントとの衝突を避けるため — 影響: src/web/ledger/ReservationList.tsx / ReservationDetail.tsx / OfflineBanner.tsx
- 個人トップ（`MyReservations`）は作らない — 理由: 担当のファイル一覧に無く、`App.tsx` を触らないと差し込めないため — 影響: T-019 のうち個人トップ 4 本は別の担当に残る
- 3 つとも props だけを受け取る部品にし、日付・並べ方・表示のかたち・開いている予約 id は器（LedgerScreen）に持たせた — 理由: 器を触らない担当分けだから — 影響: ReservationListProps / ReservationDetailProps / OfflineBannerProps
- 予約リストを `<table>`（`<th scope="col">` 5 本）で組んだ。モックは div の grid — 理由: 列見出しと 5 列を読み上げに載せる手段が表しか無く、任意値（`grid-cols-[120px_96px_...]`）も書けないため — 影響: ReservationList.tsx
- 「お客様」の欄は `—`（aria-hidden）＋ 読み上げ用の「お名前はまだ出せません」 — 理由: `customers` は 007 なので出せる字が 1 つも無い。空セルは「読み落とした」と区別が付かない — 影響: ReservationList.tsx の 3 列目
- 「ご用件」の欄は `name_short`（帯と同じ語）にした。モックの一覧は `name_internal` — 理由: `LedgerEntry` が `purposeLabel`（name_short）しか運ばないため。詳細だけが `name_internal` を持つ — 影響: ReservationList.tsx ／ T-021 のモック差分に 1 件足りる
- 出どころの 4 語の置き場所を、通常は「受け付け」の欄・通信断のときは「お客様」の欄にした — 理由: AC-LEDGER-12 は 4 語を「受け付け」の欄に置けと言い、EX-OFFLINE はその列ごと落として名前の下に置いているため — 影響: ReservationList.tsx（`isOffline`）
- 左端の語の割り当てを 状態 → 出どころ の順に決めた: `arrived`/`serving`/`done`＝「受付済み」（押せない文字）、`no_show`＝「ご来店なし」（同）、`walkin`＝「ご案内」、`web` かつ担当未定＝「内容を確認」、ほか＝「ご来店」 — 理由: モックの 4 語をそのまま使い、押し直す導線を作らないため — 影響: ReservationList.tsx の `actionOf`
- 一覧の行は 8 つまでにし、末尾を「このあと 15:00 ほか 4件。」にした。モックは 7 行＋お名前つきの 1 行 — 理由: 引き算の決めが「8 つまで」。お名前は P2 で出せない — 影響: ReservationList.tsx の `MAX_ROWS`
- 0 件の「すべて」では「すべてを見る」を出さない（見出し 1 行と理由 1 行だけ） — 理由: すでに「すべて」なので押しても何も変わらない操作になるため — 影響: ReservationList.tsx
- 絞り込みの札に `aria-label="すべて 12件"` を足した — 理由: 語と件数を別の要素に置くと読み上げ名が「すべて12件」と繋がるため — 影響: ReservationList.tsx
- 「録音を聞く」を詳細に置かない — 理由: 押した先（010）も、録音があるかを知る手段（`recordings` 表）も P2 に無い。押せない札を 1 つ増やすだけになる — 影響: ReservationDetail.tsx ／ T-021 のモック差分に 1 件足りる
- 詳細に「✕（詳細を閉じる）」を足した。モックには描かれていない — 理由: 担当指示が「× ボタンと Esc の両方」を求め、IDX-LEDGER-04 6d も物理キーボードの無い端末のために出口を 1 つ以上要求しているため — 影響: ReservationDetail.tsx ／ T-021 のモック差分に 1 件足りる
- 詳細は台帳いっぱいの透明なボタン（`data-testid="reservation-detail-dismiss"`）を自分で敷き、その 1 回のタップを台帳へ届かせない — 理由: AC-LEDGER-19 の「閉じるためのその 1 回は新しい予約を起こさない」を器の実装に依らず守るため — 影響: ReservationDetail.tsx。**別の帯を押しても、その 1 回は閉じるだけになる**（帯を開き直すには 2 回押す）
- 詳細を開いたときのフォーカスは詳細そのもの（`tabIndex={-1}` の `role="dialog"`）に置き、主操作には置かない。閉じたら開く前に押していた要素へ返す — 理由: 開いた拍子に「ご来店を受け付ける」を二度押ししないため — 影響: ReservationDetail.tsx
- 「受付済み 11:02」の時刻は props（`checkedInAt`）で受け取り、渡されないときは時刻を作らず「受付済み」とだけ書く — 理由: P2 の `reservations` に受付時刻の列が無く、`updated_at` は状態が進むたびに動くので嘘になるため（`visits` は 008） — 影響: ReservationDetail.tsx
- 詳細の「ご要望」「注意ごと」は中身があるときだけ行にする — 理由: 空の `<dd>` を並べると「読み落とした」と区別が付かないため — 影響: ReservationDetail.tsx
- 場所が 0 件のときは「場所は決めていません」と書く — 理由: 空欄にすると設備が要らない目的なのか決め忘れなのか分からないため — 影響: ReservationDetail.tsx
- 時刻の JST 変換は `./metrics` の `jstClock` を使う（自分で書かない） — 理由: 同じ変換を 2 度作らないため。`metrics.ts` は T-012 が置いた台帳の寸法・時刻の単一ソース — 影響: 3 ファイルとも
- `role="group"` を `<fieldset>` にした — 理由: biome の `a11y/useSemanticElements` が role=group に対して fieldset を求めるため。読み上げ名は `aria-label` で保つ — 影響: ReservationList.tsx（絞り込み）／ ReservationDetail.tsx（下段の操作）
- トークンに無い文字寸法は作らず最寄りへ寄せた: 見出し 21px → `text-title`(22px)、一覧の時刻 18px → `text-lead`(17px)、本文 15px → `text-body`(16px) — 理由: 任意値を書かない決め。差は 1px で読みに影響しない — 影響: 3 ファイルとも ／ T-021 のモック差分
- 影は `shadow-xl`（Tailwind 既定）にした。モックは `0 12px 32px rgba(20,40,33,.22)` — 理由: 任意値を書かない決め。影の色はパレットの色ではない — 影響: ReservationDetail.tsx
- 予約リストの行から詳細は開かない（押せるのは左端の 1 列と絞り込みの札だけ） — 理由: T-017 のシグネチャが「左端の 1 列だけが押せて、ほかは読むだけ」だから — 影響: ReservationList.tsx。リストからの詳細は 008 / 009 の操作面に譲る
- 通信断のときの列は 4 列（時間 112px / お客様 250px / ご用件 1fr / 担当 140px）にした — 理由: EX-OFFLINE の実測値。「受け付け」の列ごと落とすと書き込みの操作が 1 つも残らない — 影響: ReservationList.tsx（`isOffline`）

### G-routes（19 件）

- T-007 の `test/slot-locks.integration.test.ts` と T-010 の `src/worker/db/queries/ledger.ts` /
  `src/worker/db/slot-locks.ts` を新規に作った — 理由: 担当の 4 タスクが指す実体で、いずれも新規ファイルなので他エージェントと衝突しない
  — 影響: services/glasses_management/test/slot-locks.integration.test.ts / src/worker/db/queries/ledger.ts / src/worker/db/slot-locks.ts
- `test/helpers.ts` に予約・割当・枠の直 INSERT の道具を足した — 理由: T-006 が挙げるファイルで、台帳・権限表・テナント分離の 3 本が同じ器を使う
  — 影響: services/glasses_management/test/helpers.ts
- 予約の間隔（`store_slot_rules`）の行が無い店舗は、空き枠だけでなく**台帳も 404 `not_found`** にした — 理由: `LedgerView.slotMinutes` は必須で null を持たず、暗黙の既定値（30 分）を作らないという §4.4 の決めに従うと格子を描けない — 影響: `src/worker/index.ts` `GET /api/staff/ledger`（丸の内店・新宿店のように 6 面が未設定の店舗は台帳も開けない）
- `AvailabilityQuery.equipmentIds` が空配列のときは、ドメインへ `undefined` を渡す — 理由: ドメインの `equipmentIds` は「渡したら絞る」で、空配列をそのまま渡すと 1 台も残らず設備軸のレーンが 0 行になる — 影響: `src/worker/index.ts` `GET /api/staff/availability`
- 受けられないご用件（無い id・止めた目的・他店舗の目的）が 1 つでも混ざったら、ルート側で `slots: []` / `lanes: []` を返して空き枠エンジンを呼ばない — 理由: 目的が 0 件のまま呼ぶと刻みを所要とみなして枠が出てしまい、受けられないご用件でご予約が取れる — 影響: `src/worker/index.ts` `GET /api/staff/availability`（200 のまま。409 にしない）
- 仮の押さえ（KV `hold:*`）は P2 では読まず `holds: []` を渡す — 理由: 押さえを作る `POST /api/staff/holds` は P3 で、P2 には 1 本も置く経路が無い。空振りの `KV.list` は Free の 1,000 回/日を削るだけになる — 影響: `src/worker/index.ts`。P3 で押さえを足すときに同じハンドラで読む
- `LedgerQuery.filter` は応答で行を落とさない（`counts` が 3 つとも載る） — 理由: 札の数字（`counts`）と行数が食い違うと、どちらが正しいか画面から判断できない。絞り込みは画面が `counts` と同じ数え方で行う — 影響: `src/worker/index.ts` `GET /api/staff/ledger`
- `ReservationDetail.webBookingCode` は `reservations.code` の `EY-` を `EY-W-` に置き換えて作る — 理由: 正本の `web_bookings.public_code` は P8 の表で、契約は「`source='web'` は必ず番号を持つ」形に決まっている。null を返すと Web 由来のご予約が 1 件も詳細を開けない — 影響: `src/worker/index.ts` の `webBookingCodeOf`（P8 で中身だけを読み替える）
- `db/queries/ledger.ts` の `jstDayWindow` を消し、`domain/availability.ts` の `jstDayRange` に寄せた — 理由: knip の unused export であり、JST の暦日 → UTC の窓の実装を 2 つ持つと片方だけ直る — 影響: `src/worker/db/queries/ledger.ts`
- `NOT_DRAWN` / `NOT_OCCUPYING` の `as const` を `string[]` に変えた — 理由: drizzle の `notInArray` が読み取り専用タプルを受けず typecheck が落ちる — 影響: `src/worker/db/queries/ledger.ts`
- 権限表には台帳用の**別の店舗**（`fixture.ledgerStoreId`）を `beforeAll` で立てた — 理由: 銀座店は「予約の間隔がまだ無い店舗は 404」を見るためにわざと未設定で、同じ店舗を使うと表の行の実行順（店長の PUT が先に通ること）に結果が依存する — 影響: `test/permissions.test.ts`
- 3 本の主体は 7 種（未認証 / staff / admin / 店長 / スタッフ / 期限切れ / 別 secret）にした。403 の行は無い — 理由: 台帳・空き枠・ご予約 1 件は読み取りだけの面で、`store_memberships` を見るのは設定の保存だけ（AC-SET-17）。TODO が挙げた 5 種を含む上位集合になる — 影響: `test/permissions.test.ts` の `LEDGER_READ`（21 行）
- テナント分離は「**他社の行に自分の店舗 id を持たせる**」形の偽装で見た — 理由: 別々の店舗 id で分かれているだけでは、読み出しが `organization_id` を落としても緑になってしまう — 影響: `test/tenant-isolation.test.ts`
- 「他社の 3 件は満席にしない」の直後に「自分の 3 件は満席にする」を置いた — 理由: 塞がりを 1 件も数えていないだけでも前半は緑になる — 影響: `test/tenant-isolation.test.ts`
- `seed/reservations.mjs` に分けず `seed.mjs` の中に置いた — 理由: 担当ファイルの外に新しいファイルを作らない（他エージェントと衝突させない）。分割は P3 以降でご予約の材料が増えたときに行う — 影響: `services/glasses_management/seed.mjs`
- **当日の勤務（`staff_shifts`）を 2026-08-27 から 35 日ぶん展開して入れた**（150 行） — 理由: 曜日テンプレートを日付へ展開するのは保存の経路と日次 Cron で、seed は API を通らないので展開結果が 1 行も無い。無いままだと台帳から佐藤 美咲の休憩の帯が消え、空き枠は全時刻が `staff_off` になる — 影響: `seed.mjs`。木曜に出るのは 佐藤・高橋・中村 の 3 名（LEDGER-STAFF の 3 行と一致）
- LEDGER-DETAIL の「ご要望」と「注意ごと」を #3（11:00）の `note_customer` / `note_internal` に入れた — 理由: P2 の詳細が描ける文字はこの 2 列しかない（お客様の注意ごとは `customers` の列で P4） — 影響: `seed.mjs`。P4 でお客様の注意ごとを足すときに置き場を見直す
- `reservation_purposes.duration_minutes` は**目的そのものの所要**を写した — 理由: 列の意味が「予約した時点の写し」であり、帯の長さ（`reservations.duration_minutes`）とは別の数である（#3 は 60+30 の用件を 60 分の帯に収めている） — 影響: `seed.mjs`
- 枠の一次排他（`reservation_slot_locks`）は片付け 10 分を足した格子へ展開して 43 行入れた — 理由: 確定の経路（P3）が書く内容と同じにしておかないと、P3 の 2 件目が seed の枠を無視して入る — 影響: `seed.mjs`

### G-T-002-schema（4 件）

- `reservation_slot_locks` の追加を人の承認を待たずに進めた — 理由: 起動指示が「迷ったら暫定案を採って進む。人に聞かない」と明示しており、`design/03-data-model.md` §7.6 が「これ以外に二重予約を止める手段が無い」と根拠まで書いているため。 — 影響: `services/glasses_management/src/worker/db/schema.ts` に 1 表を追加。人の追認が取れなければこの表と 0002 の該当 DDL を落とす。
- TODO の 11 本に加えて 4 本のテストを足した（`reservation_assignments` > `担当が未定の押さえを表すため target_id は NULL 可` / `reservation_slot_locks` > `対象キーは NOT NULL（…）` / `刻みに展開した枠の開始と、バッチの時刻を見分ける作成日時を持つ` / `reservations` > 開始時刻 index が非一意であること） — 理由: `design/03-data-model.md` §7.3 §7.6 が明文で根拠を書いている不変条件（NULL を使わない／未定でも枠を消費する）が、index の形だけでは固定できないため。 — 影響: `services/glasses_management/test/schema.test.ts`。計 15 本。
- 「共通 > 4 表とも外部キーを宣言しない」は既存の `外部キー`（P1 の 16 表）describe に足さず、`予約の 4 表` の describe を新設した — 理由: 既存の describe は `expect(added).toHaveLength(16)` で P1 の表数そのものを固定しており、そこへ 1 表足すと P1 のテストの意図（16 表を出した）が壊れるため。 — 影響: `services/glasses_management/test/schema.test.ts` に describe が 1 つ増える。
- P1 が `reservations` / `reservation_purposes` / `reservation_assignments` / `visit_purposes.name_short` をすべて出し切っていたので、schema.ts への追記は `reservation_slot_locks` 1 表だけにした — 理由: TODO が「既にあるものは差分だけにする」と指示しており、`migrations/0001_*.sql` に `name_short` と 3 表の全 index が揃っていることを確認したため。 — 影響: `0002_massive_ultragirl.sql` は CREATE TABLE 1 文 + CREATE INDEX 2 文だけで、既存表を一切作り直さない。

### G-timetable（23 件）

- 位置と幅の計算を `timetable.ts` ではなく **`metrics.ts`** に置いた — 理由: macOS のファイル名は大文字小文字を区別しないので `timetable.ts` と `Timetable.tsx` が衝突し、`./Timetable` が `timetable.ts` に解決されて画面が undefined になった（実際に 29 本が同じ理由で落ちた）。TODO の T-012 と `worker/domain/ledger.ts` の doc コメントが指す名前もこれ — 影響: `src/web/ledger/metrics.ts` / `metrics.test.ts`
- `theme.css` に `--color-busy-soft` を足さず、埋まった帯の地を `--color-surface-2`（#e9eeeb）にした — 理由: `theme.css` は担当ファイル外で、並行して触られると壊れる。#e9eeeb は提案値 #e4e9e6 とほぼ同じ明るさで、`--color-ink-muted` との比が 5.10:1 と AC-LEDGER-11 の 4.5:1 を満たす — 影響: `Timetable.tsx` の休憩・点検の帯
- 埋まった帯に左 4px の `--color-line-strong` を添えた — 理由: 地だけを明るくすると見出し行（同じ `--color-surface-2`）と見分けが付かない。モックの `.appt.busy` も左に灰の縦線を持つ — 影響: `Timetable.tsx`
- 表示窓の外まで営業する日は、1 列の最小幅 68px（`--spacing` の 17 刻み ＝ 4.25rem）で格子に最小幅を与えて横スクロールさせた — 理由: 14 列が iPad 1194px でちょうど 68px になる（1194 − サイドバー 76 − 名前列 170 ＝ 948 ÷ 14）。列数で幅を計算する calc を書くより、最小幅 1 つで同じ結果になる — 影響: `metrics.ts` の `gridMinWidth` / `Timetable.tsx`
- 格子の列指定と行指定だけを inline style で書いた — 理由: `grid-cols-[170px_repeat(14,1fr)]` は禁止の任意値で、列数は日ごとに変わるためクラス名にできない。色は 1 つも inline に書かない（DESIGN_RULE 0-1 が禁じるのは inline の色指定） — 影響: `Timetable.tsx`
- 帯の 1 行目をお客様のお名前ではなく時刻（`11:00–12:00`）にした — 理由: `customers` は P4 なので名前が無く、30分幅の帯が空になる。時刻なら P4 で名前に置き換えるだけで済む — 影響: `Timetable.tsx`
- 出どころの語は 30分幅の狭い帯にも出す — 理由: AC-LEDGER-05 は色だけに意味を持たせないことを非交渉としている。落とすのはご用件のほう（AC-LEDGER-06） — 影響: `Timetable.tsx`
- 帯の色は「担当が未定」が出どころより優先する — 理由: モック LEDGER-STAFF の 相川 みどり 様（ウォークイン由来）が赤で描かれている — 影響: `metrics.ts` の `bandToneOf`
- `no_show` の帯にだけ状態の語（「ご来店なし」）を添えた — 理由: 帯にする以上、来られなかった事実を色以外で伝える必要がある。ほかの状態は詳細で読む — 影響: `Timetable.tsx`
- 定休日の文言は常に「◯月◯日（◯）は定休日です。」にした — 理由: 応答は定休日と臨時休業を区別せず（どちらも `opensAt: null`）、AC-LEDGER-22 は同じ型で出すことだけを求めている — 影響: `metrics.ts` の `closedNotice`
- 札の時刻は先頭の 0 を落とす（`09:42` → `9:42`） — 理由: AC-LEDGER-03 の文言が「現在 9:42（営業時間の外）」 — 影響: `metrics.ts` の `clockLabel`
- 最初に尋ねる日付だけは端末の時計から出し、以後の「本日」判定・線・札はすべて応答の `serverNow` から出す — 理由: 応答を受け取る前はサーバの時刻を知りようがない。線と札は 1 度目の応答から `serverNow` だけを読む — 影響: `LedgerScreen.tsx`
- 日付の帯（‹ ／ 日付 ／ › ／ 本日）を上のバーではなく台帳の面の先頭に置いた — 理由: `AppShell` は担当ファイル外で、上のバーの中央に差し込み口が無い — 影響: `LedgerScreen.tsx`
- 選んだ帯の状態は `Timetable` の中に持ち、`onSelectEntry` で外へ知らせる — 理由: 詳細のポップオーバー（T-018）は別のエージェントの担当なので、器だけを開けておく — 影響: `Timetable.tsx`
- `src/web/ledger/fixtures.ts` を作った — 理由: T-013 の触るファイルに挙がっており、テスト同士が `LedgerView` の作り置きを共有する必要がある（テストファイルを別のテストから import すると二重に走る） — 影響: `src/web/ledger/fixtures.ts`
- 表示窓の定数と割り付けは `worker/domain/ledger.ts` から import した — 理由: 「同じものを二度作らない」。あの純関数群は D1 にも実時刻にも触れないので画面から読んでよい — 影響: `metrics.ts`
- セグメントの押せる高さをモックの 38px でなく 44pt にした — 理由: `design/07-nfr.md` §2.1 の触れる大きさが品質フロアとして勝つ — 影響: `LedgerScreen.tsx` の `Segmented`
- セグメントの器を `div role="group"` でなく `<fieldset aria-label>` にした — 理由: Biome の `a11y/useSemanticElements` に素直に従うほうが抑制コメントより読みやすい。読み上げ名は変わらない — 影響: `LedgerScreen.tsx`
- 列見出し・行見出しに `tabIndex={-1}` を置いた — 理由: roving tabindex の格子で焦点を持ちうるセルは `0` か `-1` を必ず持つ（`a11y/useFocusableInteractive`）。行（`display:contents`）だけは箱を持たないので抑制コメントで断った — 影響: `Timetable.tsx`
- `<div role="grid">` を `<table>` にしなかった — 理由: `display:grid` を当てるとブラウザが表のロールを落とし、帯を列にまたがせながら目盛りを背景の 1 枚として通せない。WAI-ARIA APG の grid パターンを抑制コメント付きで書いた — 影響: `Timetable.tsx`
- 「予約リスト」に別のエージェントの `ReservationList` をそのまま差し込んだ — 理由: T-017 の触るファイルに `LedgerPage.tsx`（＝ `LedgerScreen.tsx`）が挙がっているが、そのファイルはこちらの担当なので繋ぐ側が居ない。`renderList` は差し替え口として残した — 影響: `LedgerScreen.tsx`
- 絞り込み（`filter`）は画面の中だけで効かせ、取り直さない — 理由: 応答の `counts` は 3 つとも載り、ルートも `filter` で行を落とさない（`worker/index.ts` のコメント） — 影響: `LedgerScreen.tsx`
- 詳細のポップオーバー（`ReservationDetail`）と通信断の帯（`OfflineBanner`）は繋がずに口だけ開けた — 理由: 1 件取得・場所と担当の名寄せ・帯の座標が要り、T-018 / T-019 の範囲。`Timetable` の `onSelectEntry` が押した帯を渡す — 影響: `Timetable.tsx` / `LedgerScreen.tsx`

