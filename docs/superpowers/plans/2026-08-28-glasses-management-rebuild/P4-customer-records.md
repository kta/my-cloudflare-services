# P4 顧客台帳 — TODO

- spec: [`specs/glasses_management/features/007-customer-records/spec.md`](../../../../specs/glasses_management/features/007-customer-records/spec.md)
- 依存: P3
- 状態: 未着手
- 目的: お客様を「探す・特定する・思い出す」ところを立ち上げる。お電話番号を伺い終えた時点で候補が出て、
  特定できたら現在の度数・いまお使いのメガネ・注意ごとが履歴より先に読め、二重の登録を作らせない状態にする。

---

## このフェーズで先に決めたこと（全タスクに効く）

読む前にここを 1 回だけ読む。以下は設計文書どうしが食い違っていた 7 点の決着であり、**タスクの中では繰り返さない**。

1. **手書きの R2 キーは `notes/{organizationId}/{customerId}/{noteId}.svg`。**
   `03-data-model.md` §9.4 の「解決した食い違い」が正で、feature spec §2 の `handwriting/` は古い綴り
   （録音側も `recordings/` の前置を持つので、前置が揃っていないと掃除の Cron が分けられない）。
   バケットは録音と同じ `RECORDINGS` binding をそのまま使い、2 つ目の binding を足さない（規約 10 の人間承認を要する変更にしない）。
   `services/glasses_management/wrangler.jsonc` の `RECORDINGS` のコメントを
   「受付録音と手書きメモの本体。非公開のまま Worker が仲介し、ダウンロード URL は発行しない」に直す。
2. **「店長」は `StorePermission` の `settings.manage` を持つ人とする。**
   `04-api.md` §2.2 が「店長判定は JWT の `role` ではなく選択中店舗の `StorePermission` で行う」と決めており、
   モックで店長に結び付いている権限は `settings.manage`（EX-PERMISSION「営業時間と定休日を変えられるのは 店長 だけです」）だけである。
   おまとめの**下見と実行の両方**にこれを要求する（AC-CUST-16 が「入口が画面のどこにも出ず」と要求するので、下見も閉じる）。
   `requireRole('admin')` を店長判定に使わない。
3. **`requirePersonalMode()` は P4 では作らない。** 判定材料の `terminal_sessions` が P10（`03-data-model.md` §12）だからである。
   おまとめの実行と注意ごとの申し込みは店長の権限だけで守り、個人モードの要求は P10 で足す。
   `[要確認: Q-03 / Q-10 — いまの前提（4 権限をサーバ側で強制し、おまとめと注意ごとの公開は個人モードを必須にする）で進める]`
4. **顧客の閲覧に権限を足さない。** 他店で書かれた度数・手書き・履歴も、同じ組織なら見せる
   （feature spec の「不明点」の括弧書き／`03-data-model.md` §9.1 の「別の店舗だから見えない、という分岐は作らない」）。
   `customer.history` をサーバ側で強制するかは Q-03 の答え待ちで、答えが来たら `permissions.test.ts` の表に 1 行足すだけで切り替わる形にしておく。
5. **URL による画面の切り替えを持ち込まない。** P0 に router は無い。
   `Workspace` の `current === 'customers'` と、`CustomersPage` が持つ `pane`（`list` / `detail` / `new` / `merge` / `handwrite`）の状態で切り替える。
6. **テンキーの「完了」を CUSTOMER-NEW に置かない。** モックが描いていない（12 キー: `1`〜`9` / `ハイフン` / `0` / 消去）。
   消去の綴りだけ「削除」に正規化し、左下は「ハイフン」、中止は上のバーの「やめる」にする。
   10 桁または 11 桁に達した時点で重複の照会が自動で走る。共有部品 `Keypad` は確定キーを任意（`confirmLabel?`）にし、
   確定キーを持つ面（BOOK-04c。P3）が「完了」を渡す。
7. **一覧は `OFFSET` を使わない。** お名前順は `(kana, id)`、ご来店の回数順は `(visit_count, id)` の複合カーソル。
   応答は `04-api.md` §1.2 の `{ items, nextCursor, total }` に揃える。

---

## T-001 契約を書く（Red）

- **目的**: 顧客まわりの入出力の形を Zod で 1 か所に決める。手書き型を 1 つも作らせない。
- **触るファイル**
  - `packages/contracts/src/glasses_management.ts`（追記）
  - `packages/contracts/src/index.ts`（re-export を追記）
  - `packages/contracts/test/glasses_management.contract.test.ts`（追記）
- **先に書くテスト**（`pnpm --filter @app/contracts test`。このファイルの既存テストは英語なので**英語で揃える**）
  - `PhoneInput` > `accepts hyphens and full-width digits, rejects fewer than 10 characters`
  - `PhoneNormalized` > `accepts 10 and 11 digits starting with 0, rejects 9 and 12`
  - `PhoneSuffix` > `is exactly four digits — three digits fail`
  - `CustomerNumber` > `is G- followed by exactly five digits`
  - `CustomerSummary` > `keeps memoShort at 40 characters and leaves phone nullable`
  - `CustomerCreate` > `accepts a name alone — the phone is optional`
  - `CustomerCreate` > `rejects an empty name`
  - `CustomerPatch` > `requires version`
  - `CustomerSearchQuery` > `defaults sort to kana and limit to 50`
  - `CustomerSearchQuery` > `rejects a limit above 200`
  - `CustomerLookupQuery` > `rejects a query whose four fields are all empty`
  - `CustomerCandidate` > `is a two-step confidence: strong or weak, nothing else`
  - `Prescription` > `takes sph in 0.25 steps and axis as an integer 0..180`
  - `Prescription` > `rejects an axis of 181 and a pd of 39.5`
  - `CustomerNote` > `is memo or attention, and draft, published or hidden`
  - `CustomerNoteInput` > `rejects a note that has neither body nor handwriting`
  - `CustomerNoteInput` > `accepts handwriting alone — a drawing with no transcription is still a note`
  - `CustomerNotePatch` > `requires revision and allows only draft or hidden as a status`
  - `CustomerMergePreviewRequest` > `rejects the same id on both sides`
  - `CustomerMergeField` > `allows 'both' only for notes`
  - `CustomerMergeInput` > `requires both versions`
  - `CustomerList` > `carries items, nextCursor and total`
  - `customer schemas` > `reject an unknown key so a stale field never lands silently`
- **実装**: `04-api.md` §4.7 の 20 スキーマ（`CustomerSummary` / `CustomerDetail` / `CustomerSearchQuery` / `CustomerList` /
  `CustomerLookupQuery` / `CustomerCandidate` / `CustomerCreate` / `CustomerPatch` / `CustomerMergePreviewRequest` /
  `CustomerMergePreview` / `CustomerMergeField` / `CustomerMergeInput` / `CustomerMergeResult` / `Prescription` /
  `OwnedGlasses` / `CustomerNote` / `CustomerNoteQuery` / `CustomerNoteInput` / `CustomerNotePatch` /
  `CustomerNotePublishInput`）＋ `CustomerNumber`（`/^G-\d{5}$/`）。
  素材（`Uuid` / `IsoDateTime` / `LocalDate` / `Version` / `Cursor` / `Limit` / `PhoneInput` / `PhoneNormalized` / `PhoneSuffix`）は
  P1〜P3 が入れてある。無ければここで足す（定義は `04-api.md` §4.1 のまま）。すべて `z.strictObject`。
  `CustomerNote.handwritingSvg` は `string | null`（最大 512KB）で、**R2 のキーを契約に出さない**。
- **完了条件**: 23 本が緑。`packages/contracts` のカバレッジ 4 指標 80% 以上。
- **依存**: なし（P3 の完了後に着手する）

## T-002 スキーマ 4 表を書き、index を固定する（Red → Green）

- **目的**: 顧客の 4 表を作り、index が「実際に投げるクエリの形」に合っていることをテストで固定する。
- **触るファイル**
  - `services/glasses_management/src/worker/db/schema.ts`
  - `services/glasses_management/test/schema.test.ts`
  - `services/glasses_management/migrations/`（生成物）
- **先に書くテスト**（`getTableConfig` で index の名前と対象列を見る）
  - `customers` > `組織と正規化した番号で引ける（工程の前方一致）`
  - `customers` > `組織と下 4 桁で引ける（台帳と受付の完全一致）`
  - `customers` > `組織とふりがなで五十音順に並べられる`
  - `customers` > `お客様番号は組織の中で一意`
  - `customers` > `組織と最終来店で並べ替えられる`
  - `customer_prescriptions` > `顧客ごとに測定日で引ける（詳細の履歴表）`
  - `customer_glasses` > `顧客ごとにお渡し日で引ける`
  - `customer_notes` > `顧客ごとに作成順で引ける（手書きのサムネイル）`
  - `customer_notes` > `種別と状態で「注意ごと N件」を数えられる`
  - `顧客の 4 表` > `外部キーを 1 つも宣言しない`
- **実装**: 列は `03-data-model.md` §9.1〜§9.4 のまま（**＋印の列も 1 つも削らない**）。
  index は `customers_org_phone_idx` / `customers_org_phone_last4_idx` / `customers_org_kana_idx` /
  `customers_org_customer_number_idx`（一意）/ `customers_org_last_visit_idx` /
  `customer_prescriptions_org_customer_measured_idx` / `customer_glasses_org_customer_purchased_idx` /
  `customer_notes_org_customer_created_idx` / `customer_notes_org_customer_kind_idx` の 9 本。
  真偽値は `'0'|'1'`、日時は ISO8601、`measured_at` と `purchased_at` だけ `YYYY-MM-DD`。
  度数と PD は `real`、`visit_count` / `version` / `revision` は `integer`。`created_terminal_id` は列だけ置いて常に NULL（P10 で埋まる）。
- **手順**: 編集 → `pnpm --filter @app/glasses_management db:generate` → `db:migrate:local`
- **完了条件**: `migrations/0004_*.sql` が生成され、`schema.test.ts` が緑。
- **依存**: T-001

## T-003 探し方と候補の確からしさのテストを書く（Red）

- **目的**: 「台帳は下 4 桁の完全一致、工程は前方一致」という 2 本立てを、実装より先に文章で固定する。
- **触るファイル**
  - `services/glasses_management/test/customer-search.test.ts`（新規）
  - `services/glasses_management/test/customer-match.test.ts`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test`。純関数なので D1 を触らない）
  - `customer-search.test.ts`
    - 電話番号の正規化 > `ハイフンと半角空白と全角空白を落として数字だけにする`
    - 電話番号の正規化 > `全角の数字（０９０）を半角にする`
    - 電話番号の正規化 > `10 桁と 11 桁だけを番号として通し、9 桁と 12 桁は番号にしない`
    - 電話番号の正規化 > `先頭が 0 でない 11 桁は番号にしない`
    - 台帳の検索 > `下 4 桁ちょうどの「5678」は phone_last4 の完全一致で引く`
    - 台帳の検索 > `番号の途中の 4 桁「1234」では 090-1234-5678 が引けない`
    - 台帳の検索 > `3 桁の「678」は番号ではなくお名前として扱う`
    - 台帳の検索 > `後方一致（LIKE '%' で始まる形）の SQL を組み立てない`
    - 工程の候補 > `11 桁を打ち終えると phone_normalized の前方一致で引く`
    - 工程の候補 > `先頭 7 桁だけ一致する 090-1234-9912 も拾う`
    - 名前の検索 > `ふりがな「たなか」で「たなか はなこ」が残る`
    - 名前の検索 > `名前の一部「花子」で「田中 花子」が残る`
    - まとめられた行 > `merged_into_id が入った行は検索からも一覧からも外れる`
    - 並べ方 > `お名前順のカーソルは (kana, id) で、同じふりがなでも重複せずに進む`
    - 並べ方 > `ご来店の回数順のカーソルは (visit_count, id) で、多い順に進む`
  - `customer-match.test.ts`
    - `全桁が一致した 1 件は「よく一致しています」（strong）`
    - `前方だけ一致した 1 件は「確かめが必要です」（weak）`
    - `下 4 桁だけ一致した 1 件は weak`
    - `当てはまりが 0 件のときは空配列を返す（例外にしない）`
    - `同姓同名が 2 件並んでも自動で確定しない`
    - `全桁一致が 1 件だけでも自動で確定しない`
    - `並びは strong が先、その中では最後のご来店が新しい順`
- **実装**: まだ書かない。**期待した理由で落ちることを目で見る。**
- **完了条件**: 22 本が「関数が無い」で落ちている。
- **依存**: T-002

## T-004 来店回数と「最後のご来店」のテストを書く（Red）

- **目的**: 2 つの値が**別の条件から出る**こと（接客が終わった回数と、最後に足を運ばれた日）を固定する。
- **触るファイル**: `services/glasses_management/test/customer-visits.test.ts`（新規）
- **先に書くテスト**
  - `来店回数は status='done' の件数だけを数える`
  - `取り消し・不来店・受付前は来店回数に入らない`
  - `最後のご来店は arrived / serving / done の最終 starts_at の日付（いま接客中でも今日になる）`
  - `来店済みが 0 件なら、一覧は「初」・帯とバッジは「初めて」・最後のご来店は「—」`
  - `来店済みが 4 件なら、一覧は「4回」・帯とバッジは「4回目」`
  - `初回来店は来店済みの最初の starts_at の日付で、あとから来る予約で書き換わらない`
  - `UTC 15:00 をまたぐ予約は JST の暦日で数える`
  - `月末（8/31 15:00Z）・年末（12/31 15:00Z）・うるう年（2028-02-29）でも日付がずれない`
- **注意**: 時刻は必ず引数（`now: Date`）で注入する。`Date.now()` を書かない。
- **実装**: まだ書かない（T-011 で書く）。**期待した理由で落ちることを目で見る。**
- **完了条件**: 8 本が落ちている。
- **依存**: T-002

## T-005 おまとめの下見のテストを書く（Red）

- **目的**: 項目ごとの解決とメモの 7 + 1 = 8 を、DB に触る前の純関数で固定する。
- **触るファイル**: `services/glasses_management/test/customer-merge.test.ts`（新規）
- **先に書くテスト**
  - 項目ごとの解決 > `choice='primary' は A の値を残す`
  - 項目ごとの解決 > `choice='secondary' は B の値を残す`
  - 項目ごとの解決 > `接客のメモの 'both' は 7 + 1 = 8 になる`
  - 項目ごとの解決 > `接客のメモ以外に 'both' を渡すと拒む`
  - 項目ごとの解決 > `値の無い側を残す選択は結果に「ご登録がありません」を置く`
  - 下見の中身 > `結果のお客様番号は残す側のもの（G-01842）`
  - 下見の中身 > `失う番号（G-02310）を losingCustomerNumber に載せる`
  - 下見の中身 > `モックの 4 項目（お名前・お電話番号・ご住所・接客のメモ）がこの順で並ぶ`
  - 拒む > `同じ ID を primary と secondary に渡すと拒む`
  - 拒む > `下見に無い項目を実行の fields に混ぜると拒む`
  - `下見の result と、実行後の CustomerSummary が 1 文字も違わない`
- **実装**: まだ書かない（T-011 で書く）。**期待した理由で落ちることを目で見る。**
- **完了条件**: 11 本が落ちている。
- **依存**: T-002

## T-006 手書きの再直列化のテストを書く（Red）

- **目的**: 他店舗のスタッフが開く SVG を、実行されうる形のまま返さない。
- **触るファイル**: `services/glasses_management/test/handwriting.test.ts`（新規）
- **先に書くテスト**
  - `<script> を落とす`
  - `on* 属性（onload / onclick）を落とす`
  - `<foreignObject> を落とす`
  - `javascript: で始まる href と xlink:href を落とす`
  - `<use> の外部参照を落とす`
  - `path の d / stroke-width / transform は残す`
  - `viewBox / width / height / fill / stroke / stroke-linecap / stroke-linejoin / role / aria-label は残す`
  - `落としたあとも筆跡の線（path）の本数が変わらない`
  - `512KB を超える SVG は受け取らない`
  - `6 枚目の保存は拒み、置き換える 1 枚を尋ねる（黙って古い 1 枚を消さない）`
- **実装**: まだ書かない（T-011 で書く）。**期待した理由で落ちることを目で見る。**
- **完了条件**: 10 本が落ちている。
- **依存**: T-002

## T-007 権限マトリクスに顧客の 11 ルートを足す（Red）

- **目的**: default-deny が顧客のルートにも効いていること、おまとめだけが店長のものであることを固定する。
- **触るファイル**: `services/glasses_management/test/permissions.test.ts` / `test/helpers.ts`
- **先に書くテスト**（主体 5 種 × 顧客の 11 経路の表に行を足す。主体は 未認証 / スタッフ / 店長 / 期限切れ / 別 secret 署名）
  - `顧客の 11 経路は、未認証だと 401 で入口に届かない`
  - `期限切れのトークンは 403 ではなく 401（再ログインの判定がここに依存する）`
  - `別の secret で署名したトークンは 401`
  - `スタッフは検索・候補・詳細・作成・更新・メモの 9 本を通れる`
  - `スタッフはおまとめの下見で 403（この操作は店長だけができます）`
  - `スタッフはおまとめの実行で 403 で、どちらの登録も変わらない`
  - `店長（settings.manage あり）はおまとめの下見と実行を通れる`
  - `/api/staff/customers/not-a-route も既定の拒否に落ちる`
  - `内部 API の共有鍵では顧客のルートに入れない`
- **注意**: 期限切れトークンは**固定の過去時刻**から作る（`signAccessToken(claims, secret, 1, 過去のエポック秒)`）。`Date.now()` に依存させない。
- **実装**: まだ書かない（T-012 で書く）。**期待した理由で落ちることを目で見る。**
- **完了条件**: 追加した行を含めて表全体が落ちずに走り、顧客ぶんの 9 本が落ちている。
- **依存**: T-002

## T-008 テナント分離に顧客の越境を足す（Red）

- **目的**: 他社のお客様に手が届く経路が無いことを、3 テナント・偽装入力・R2 のキーで潰す。
- **触るファイル**: `services/glasses_management/test/tenant-isolation.test.ts`
- **先に書くテスト**
  - `3 テナントが同じ電話番号のお客様を持っても、各自の 1 件しか出ない`
  - `他社のお客様 ID で詳細を開くと 404（403 にしない。存在の有無を漏らさない）`
  - `他社のお客様 ID を merge の primaryId に渡すと 404`
  - `body に別テナントの organizationId を混ぜても、自分の org の行として作られる`
  - `他社のお客様に付いたメモは一覧にも「注意ごと N件」にも出ない`
  - `他社のお客様番号（G-01842）で検索しても引けない`
  - `下 4 桁の検索は自分の org の中だけを走る`
  - `手書きの R2 キーは organizationId を含み、他社のキーは読めない`
- **注意**: D1 はテストファイル内で共有されるので、組織 id は毎回 `crypto.randomUUID()` で作る。
- **実装**: まだ書かない（T-012 で書く）。**期待した理由で落ちることを目で見る。**
- **完了条件**: 8 本が落ちている。
- **依存**: T-002

## T-009 代表フローを書く（Red）

- **目的**: 検索・詳細・登録・更新・候補・メモの往復を、実 D1 の上で 1 本ずつ固定する。
- **触るファイル**: `services/glasses_management/test/customers.integration.test.ts`（新規）
- **先に書くテスト**
  - 検索と一覧 > `五十音順で返し、total と items.length が別の数になる（42名 と 8行）`
  - 検索と一覧 > `「5678」では下 4 桁の一致だけが残る`
  - 検索と一覧 > `「1234」では 090-1234-5678 が残らない`
  - 検索と一覧 > `「たなか」でも「花子」でも同じ 1 行が残る`
  - 検索と一覧 > `ご来店の回数順に切り替えると多い順になる`
  - 検索と一覧 > `絞り込み（ご来店 2〜4回）で total が絞り込み後の数になる`
  - 検索と一覧 > `当てはまるお客様が 0 名なら items は空・total は 0・nextCursor は null`
  - 検索と一覧 > `nextCursor をそのまま渡すと続きが返り、同じ行が 2 度出ない`
  - 詳細 > `度数は測定日の新しい順で、is_current が true の行はちょうど 1 つ`
  - 詳細 > `いまお使いのメガネは is_current='1' の本数だけを数える`
  - 詳細 > `「注意ごと N件」は kind='attention' かつ status='published' の行だけを数える`
  - 詳細 > `よくご担当した者は done の予約の担当で最も多い者、同数なら新しいほう`
  - 詳細 > `次のご予約は starts_at が現在時刻以降でいちばん早い 1 件`
  - 詳細 > `丸の内店で書かれたメモと度数も、銀座店のトークンで読める`
  - 新規登録 > `お名前だけで登録できる（お電話番号は任意）`
  - 新規登録 > `お名前もお電話番号も空なら 400`
  - 新規登録 > `お客様番号 G-NNNNN を採番し、組織の中で一意になる`
  - 新規登録 > `phone / phone_normalized / phone_last4 の 3 つが同時に入る`
  - 更新 > `version が合えば更新され、version が +1 される`
  - 更新 > `version が古ければ 409 version_conflict で 1 列も変わらない`
  - 候補 > `11 桁を打ち終えると 2 件返り、全桁一致が strong・前方一致が weak`
  - 候補 > `phone / phoneLast4 / name / kana の 4 つがすべて空なら 400`
  - メモ > `手書きだけのメモを保存でき、本文は空でよい`
  - メモ > `読み取った文字を直すと revision が +1 され、handwriting_key は変わらない`
  - メモ > `注意ごとへの申し込みは kind='attention' / status='draft' になり、件数は増えない`
  - メモ > `6 枚目の手書きは 409 で拒む`
- **実装**: まだ書かない（T-012 で書く）。**期待した理由で落ちることを目で見る。**
- **完了条件**: 26 本が落ちている。
- **依存**: T-002

## T-010 おまとめの代表フローを書く（Red）

- **目的**: 「拒んだと言いながら付け替えだけは済んでいる」状態を作れないことを、実 D1 の上で証明する。
- **触るファイル**: `services/glasses_management/test/customers.integration.test.ts`（追記）
- **先に書くテスト**
  - おまとめ > `下見は項目ごとの残す側と、まとめたあとの姿と、失う番号を返す`
  - おまとめ > `実行すると残さない側に merged_into_id が入り、行は消えない`
  - おまとめ > `予約が残す側へ付け替わる`
  - おまとめ > `メモが 7 + 1 = 8 件になる`
  - おまとめ > `audit_events に customer.merged が 1 件だけ増える`
  - おまとめ > `同じ Idempotency-Key の再送では 2 度走らず、同じ結果が返る`
  - おまとめ > `同じ Idempotency-Key に違う本文を送ると 409 idempotency_conflict`
  - おまとめ > `失った番号 G-02310 では一覧からも検索からも引けない`
  - おまとめ > `下見のあとに片方へ新しい予約が入ると 409 で拒む`
  - おまとめ > `拒んだあと、予約の customer_id・メモの customer_id・両者の version・merged_into_id がすべて下見の前と同じ`
  - おまとめ > `店長でない主体の実行は 403 で、どちらの登録も 1 行も変わらない`
- **注意**: 最後から 2 番目の 1 本が AC-CUST-15 の核である。**拒んだあとに 5 種類の値を読み直して比べる**（status だけを見ない）。
- **実装**: まだ書かない（T-012 で書く）。**期待した理由で落ちることを目で見る。**
- **完了条件**: 11 本が落ちている。
- **依存**: T-005, T-009

## T-011 ドメインの純関数を実装する（Green）

- **目的**: T-003〜T-006 を緑にする。D1 と時計をここに持ち込まない。
- **触るファイル**（すべて新規）
  - `services/glasses_management/src/worker/domain/customer-search.ts`
  - `services/glasses_management/src/worker/domain/customer-match.ts`
  - `services/glasses_management/src/worker/domain/customer-visits.ts`
  - `services/glasses_management/src/worker/domain/customer-merge.ts`
  - `services/glasses_management/src/worker/domain/handwriting.ts`
- **先に書くテスト**: T-003〜T-006 の 51 本。ここでは足さない。
- **実装**
  - `customer-search`: `normalizePhone(raw): string | null`（全角→半角 → 数字以外を落とす → 先頭 0 の 10/11 桁だけ返す）/
    `last4(normalized): string` / `searchMode(query): { kind: 'phoneLast4' | 'name'; value: string }`
    （**数字ちょうど 4 桁だけを下 4 桁として扱う**。3 桁も 5 桁も名前として扱う）/
    `encodeCursor` / `decodeCursor`（`kana|id` と `visits|id` の 2 種。不透明な base64url 文字列）。
  - `customer-match`: `rank(rows, { phoneNormalized }): CustomerCandidate[]`。
    全桁一致 = `strong`、前方一致と下 4 桁一致 = `weak`。**1 件でも確定を返さない**（返すのは常に配列）。
  - `customer-visits`: `countVisits(reservations)`（`status='done'` だけ）/
    `lastVisitDate(reservations, now)`（`arrived` / `serving` / `done` の最終 `starts_at` を JST の暦日へ落とす。
    変換は `packages/shared` の JST ヘルパを使う）/ `visitLabel(count, place: 'list' | 'badge')`
    （`0 → '初' | '初めて'`、`n → 'n回' | 'n回目'`）。
  - `customer-merge`: `resolve(fields, a, b): { summary, noteCount, losingCustomerNumber }`。`'both'` は `notes` だけ許す。
  - `handwriting`: `sanitizeSvg(raw): string`。許可する要素は `svg` / `g` / `path` / `rect` / `line` / `polyline` / `circle` / `ellipse` / `text`、
    許可する属性は `viewBox` / `width` / `height` / `d` / `transform` / `fill` / `stroke` / `stroke-width` /
    `stroke-linecap` / `stroke-linejoin` / `class` / `role` / `aria-label`。**それ以外は落とす**（許可リストであって禁止リストにしない）。
- **完了条件**: T-003〜T-006 の 51 本が緑。
- **依存**: T-003, T-004, T-005, T-006

## T-012 顧客のルート 11 本を実装する（Green）

- **目的**: T-007〜T-010 を緑にする。
- **触るファイル**: `services/glasses_management/src/worker/index.ts`（ルートのチェーンへ追記）
- **先に書くテスト**: T-007〜T-010 の 54 本。ここでは足さない。
- **実装**
  - パスと入出力は `04-api.md` §3.8 のまま 11 本。**全クエリを JWT の `org` で絞る**。`storeId` は絞り込みにだけ使い、認可の根拠にしない。
  - 一覧: `(kana, id)` / `(visit_count, id)` のカーソル。`total` は同じ条件の `COUNT(*)`。**`OFFSET` を書かない。**
  - 下 4 桁は `phone_last4 = ?` の完全一致、工程の候補は `phone_normalized LIKE ? || '%'` の前方一致。
    **`LIKE '%' || ?` を 1 か所も書かない**（B-tree が効かず顧客表の全走査になる）。
  - 詳細: 顧客 / 度数（新しい順・最大 20）/ メガネ / メモ / 次のご予約 の 5 本を `db.batch()` で 1 往復にまとめる。
  - 手書き: 書き込みは本体を受け取って R2（`c.env.RECORDINGS`）へ `notes/{org}/{customerId}/{noteId}.svg` で置き、
    D1 には `handwriting_key` だけを持つ。読み出しは R2 から取って `sanitizeSvg` を通してから返す。
    **署名付き URL もダウンロード URL も返さない。** 1 顧客 5 枚を超えたら 409。
  - `POST .../notes/:noteId/publish` は**申し込みを立てるだけ**にする（`kind='attention'` / `status='draft'`）。
    `published` へ上げるのは P10 の承認の面である。
  - 他テナントの ID は 404。403 にしない。
  - おまとめの下見と実行に `requireStorePermission('settings.manage')` を付ける。
    **このミドルウェアは P1 T-011 が `src/worker/store-permission.ts` に置いてあるので、新設せず再利用する。**
    判定材料は選択中店舗の `StorePermission` セット。`requireRole('admin')` を使わない。
  - 実行は 1 つの `db.batch()`。文の順は ①予約の付け替え ②メモの付け替え ③残す側の項目更新 ④`audit_events` の追記
    ⑤**残さない側に `merged_into_id` を書く UPDATE を最後**。**全文に「下見のときと同じ状態か」の `WHERE EXISTS (...)` を付け、
    拒む判定は最後の文の `meta.changes === 0` で行う**（0 行の UPDATE は D1 のバッチを止めないため）。
  - `Idempotency-Key` は `idempotency_records`（P3）に 24 時間。
  - `permissions.test.ts` の表に 11 行が入っていることを最後に目で確かめる。
- **完了条件**: `pnpm --filter @app/glasses_management test` が緑、カバレッジ 4 指標 80% 以上。
- **依存**: T-007, T-008, T-009, T-010, T-011

## T-013 来店回数を書き戻し、台帳の帯にお名前を出す（Green）

- **目的**: 来店回数を読むたびに数えない。P2 が空けておいた台帳の帯の場所を埋める。
- **触るファイル**
  - `services/glasses_management/src/worker/index.ts`（予約の状態遷移のハンドラ）
  - `services/glasses_management/src/web/ledger/`（P2 が置いた帯と詳細）
- **先に書くテスト**
  - `services/glasses_management/test/customers.integration.test.ts`
    - 書き戻し > `予約が done になると visit_count が +1 され、last_visit_at がその日になる`
    - 書き戻し > `初回の done で first_visit_at が入り、2 回目以降は書き換わらない`
    - 書き戻し > `予約を取り消すと visit_count は増えない`
  - `services/glasses_management/src/web/ledger/Timetable.test.tsx`（P2 が作った帯のテストに追記）
    - `60分（2 列）の帯はお名前フルネームと来店回数の印を出す`
    - `30分（1 列）の帯は印を出さず、姓だけに落として「松本 様」と出す`
    - `来店が 0 件のお客様の印は「初めて」`
    - `帯を押して開く詳細の見出しにお名前が出て、注意ごとの 1 行がその方のものになる`
- **実装**
  - 予約が `done` になる遷移の `db.batch()` に、`customers` の `visit_count` / `last_visit_at` / `first_visit_at` の UPDATE を**同じバッチで**足す。
  - 帯の文字予算: 30分 1 列はおよそ 6 字しかない。`name_short` と同じ考え方で**姓だけ + 「様」**に落とす（AC-CUST-24）。
  - 印は `VisitCount`（T-014 で `packages/ui` に足す）を使い、**数字の文字を必ず出す**（色だけで区別しない）。
- **完了条件**: 追加した 7 本が緑。Worker のカバレッジ 4 指標 80% 以上を保つ。
- **依存**: T-012

## T-014 一覧と右の要約を作る（CUSTOMER-LIST）

- **目的**: お名前があいまいなままでも 1 名に手繰れる一覧と、選んだ 1 名の要約を同時に出す。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: お名前があいまいなまま、来店回数と最後のご来店から 1 名に手繰る面。
  - トークン計画: 面は白（一覧）と薄い緑灰（見出し行）の 2 段。選択は `--color-pine-soft` の地と左 4px の緑帯だけで示し、
    回数と日付の文字を必ず添える。角は 8/12 の 2 段。書体は 1 つで、ウェイトだけで段を作る。
  - シグネチャ: **選んだ 1 名の要約が、一覧を閉じずに右に出続けること。**
- **見るモック**: `docs/frontend/mockups/eyex/images/CUSTOMER-LIST.png`（端末 1194×834 / 実装の描画領域 1194×810）
  - 本文は 2 ペイン `1fr 360px`。サイドバーは**たたんだ細い柱（76px）が既定**。
  - ツールバー: segmented（ボタン min-height 38px / padding 0 16px / 14px 600 / 選択は白地に緑字）＋
    「絞り込み」（min-height 40px / padding 0 14px）＋ 札「ご来店 2〜4回」（min-height 22px / padding 1px 8px / 12px 600 / 角 8px）＋
    右に「当てはまるお客様 42名」＋「＋ 新しいお客様を登録」（min-height 44px / padding 0 16px / 15px）。
  - 検索欄の帯: padding 16px 20px・下に 1px の罫。文言は「お名前・電話番号　一部でも探せます」。
  - 見出し行: 高さ 34px・地 `--color-surface-2`・下に 1px の `--color-line-strong`・12px。
  - 行: 4 列 `220px 72px 132px 1fr`・gap 12px・padding 0 20px・**min-height 60px**
    （モックは `height: 60px` の固定だが、実装は `min-height` に直す。`05-screen-flow.md` §7.5）。
    お名前 16px/600、ふりがな 12px、回数 16px/600 等幅、最後のご来店 13px、覚えておくこと 13px。
    **「…」で切ってよいのは「覚えておくこと」だけ。** 選択行は地 `--color-pine-soft` ＋ `inset 4px 0 0 --color-pine`。
  - 行は **8 行**で切り、下に「ほか 34名」と「続きを見る ›」（min-height 44px / 14px）。
  - 右の要約: padding 32px 28px。お名前 21px、ふりがな＋お客様番号 13px。4 項目（次のご予約 / いまの度数 /
    いまお使いのメガネ / 注意ごと）は各 padding 18px 0、見出し 13px、値 17px/600、補足 13px。
    下端に「くわしく見る」「ご予約を取る」を min-height 48px・15px で 2 つ。**度数の履歴表はここに出さない。**
- **触るファイル**（すべて新規。`App.tsx` と `packages/ui` だけ追記）
  - `services/glasses_management/src/web/customers/{CustomersPage.tsx,CustomerList.tsx,CustomerSummaryPane.tsx}`
  - `services/glasses_management/src/web/customers/CustomerList.test.tsx`
  - `services/glasses_management/src/web/App.tsx`（`current === 'customers'` で `CustomersPage` を出す）
  - `packages/ui/src/components.tsx` / `packages/ui/src/index.ts`（`VisitCount` を足す）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test:web`。`src/web/customers/CustomerList.test.tsx`）
  - 一覧 > `列は お名前 / ご来店 / 最後のご来店 / 覚えておくこと の 4 つ`
  - 一覧 > `1 画面に出る行は 8 行までで、続きは「ほか 34名」と「続きを見る」に逃がす`
  - 一覧 > `来店が 0 件の行は「初」と出て、最後のご来店は「—」`
  - 検索 > `「5678」と入れると 090-1234-5678 の行だけが残る`
  - 検索 > `「1234」では残らない`
  - 検索 > `「たなか」でも「花子」でも同じ行が残る`
  - 検索 > `当てはまるお客様が 0 名のとき、見出し 1 行・理由 1 行・「検索をやめて全件を見る」の 3 つだけを出す`
  - 並べ方と絞り込み > `「ご来店の回数順」に切り替えると回数の多い順になる`
  - 並べ方と絞り込み > `絞り込みが持つ条件はご来店の回数の 4 段（初 / 1回 / 2〜4回 / 5回以上）だけ`
  - 並べ方と絞り込み > `札を付けても、選んでいた行の選択が外れない`
  - 並べ方と絞り込み > `右上の人数が絞り込み後の数になる`
  - 要約 > `行を選ぶと、次のご予約・いまの度数・いまお使いのメガネ・注意ごとが同時に出る`
  - 要約 > `要約に度数の履歴表は出さない`
  - 要約 > `注意ごとは色だけでなく「注意ごと」という文字を持つ`
  - 入口 > `「くわしく見る」で詳細の面へ、「ご予約を取る」で予約の 5 工程へ渡す`
  - 読み込み中 > `行の高さを保った灰色の帯を 8 本置き、回るアイコンを置かない`
- **実装**
  - `services/glasses_management/src/web/customers/{CustomersPage.tsx,CustomerList.tsx,CustomerSummaryPane.tsx}`（新規）
  - `services/glasses_management/src/web/App.tsx`（`current === 'customers'` で `CustomersPage` を出す）
  - `packages/ui/src/components.tsx` / `index.ts` に `VisitCount` を足す
    （min-width 30px / 高さ 22px / padding 0 8px / 12px 600 等幅 / 角 999px。
    初回は `--color-walkin` と `--color-walkin-soft`、3 回以上は `--color-pine-deep` と `--color-pine-soft`、2 回目は罫だけ。
    **回数の数字を必ず出す**）。
  - ランドマークは `<header>` / `<nav aria-label="画面の切り替え">` / `<main>` / `<aside>` を 1 つずつ。0 件の知らせは `role="status"`。
  - 色・寸法は `packages/ui/src/theme.css` のトークン経由のみ。Tailwind 既定パレットと任意値を書かない。
- **完了条件**: 16 本が緑、web カバレッジ 4 指標 60% 以上。
- **依存**: T-012

## T-015 詳細を作る（CUSTOMER-DETAIL）

- **目的**: 「前回どう見えていたか」から接客を始められる詳細を作る。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 「前回どう見えていたか」から接客を始めるための面。
  - トークン計画: 白い箱は 3 枚まで（度数の表 1 枚・注意ごと 1 枚・次のご予約 1 枚）。
    注意ごとは `--color-danger` 系、次のご予約は `--color-pine` 系。基本情報は箱で囲まず間隔だけで束ねる。
  - シグネチャ: **左の「度数の移り変わり」1 枚が主役で、いま有効な 1 行に「いま使っています」の札が付くこと。**
- **見るモック**: `docs/frontend/mockups/eyex/images/CUSTOMER-DETAIL.png`
  - 本文は padding 32px 40px・行は `auto minmax(0,1fr)`・gap 28px。中は 2 列 `1fr 300px`・gap 28px。
    サイドバーは**ひらいた 216px が既定**。
  - 見出し: お名前 26px/700、ふりがな＋お客様番号 13px。右へ お電話 / ご来店 / 最後のご来店 / よくご担当した者 を
    `dt` 13px・`dd` 16px/600 で並べ、各項目は padding 0 16px。右端に札「注意ごと 1件」（`--color-danger` 系）。
  - 度数の表: カードの見出し 14px `--color-ink-muted`（margin 0 0 14px）。セルは padding 12px 6px・下 1px の罫・右寄せ（1 列目だけ左）。
    見出し行 13px/600、本体 16px 等幅（1 列目だけ 15px の本文書体）、最終行は罫なし。
    いま有効な行は `--color-pine-deep` の 600 ＋**「いま使っています」の札**（緑と太字だけで区別しない）。
  - いまお使いのメガネ: 上に margin 32px、見出し「いまお使いのメガネ　2本」、各行 padding 16px 0・題 16px・補足 13px。
  - 右: 注意ごと（見出し `--color-danger`・本文 16px/600・補足 13px）と 次のご予約（見出し `--color-pine-deep`・日時 19px/600・補足 13px）。
  - ツールバー右: 「内容を直す」と「この方のご予約を取る」（min-height 44px / padding 0 16px / 15px）。
- **触るファイル**
  - `services/glasses_management/src/web/customers/CustomerDetail.tsx`（新規）
  - `services/glasses_management/src/web/customers/CustomerDetail.test.tsx`（新規）
  - `services/glasses_management/src/web/customers/CustomersPage.tsx`（`pane === 'detail'` を足す）
- **先に書くテスト**（`src/web/customers/CustomerDetail.test.tsx`）
  - 見出し > `お名前・ふりがな・お客様番号・お電話・ご来店・最後のご来店・よくご担当した者が並ぶ`
  - 見出し > `注意ごとの札の件数が、右の箱の件数と一致する`
  - 度数 > `測定日の新しい順に並ぶ`
  - 度数 > `いま有効な 1 行だけに「いま使っています」の札が文字で付く`
  - 度数 > `札の付いた行の値が、一覧の要約の「いまの度数」と同じ`
  - 度数 > `記録が 0 件のときは表の代わりに「度数の記録はまだありません」と次の行動の 1 行を出す`
  - メガネ > `is_current の本数が見出しの「2本」と一致する`
  - メガネ > `1 本も無いときは「ご登録がありません」と出す`
  - 手書きへの入口 > `注意ごと・ご要望の行から手書きメモの面を開く（「内容を直す」の中には置かない）`
  - 入口 > `「この方のご予約を取る」で予約の 5 工程へ、そのお客様を持って渡す`
  - 200% > `表の列が入らないときは横スクロールの器に入り、名前も時刻も省略しない`
- **実装**: `services/glasses_management/src/web/customers/CustomerDetail.tsx`（新規）。
  度数の表は `<table>` で組み、200% 拡大では `overflow-x: auto` の器に入れて見出し行を `sticky` にする。
  行の高さは `min-height` で書く。
- **完了条件**: 11 本が緑、web カバレッジ 4 指標 60% 以上を保つ。
- **依存**: T-014

## T-016 新しいお客様の登録を作る（CUSTOMER-NEW）

- **目的**: お電話番号を打った瞬間に同じ番号のご登録を突きつけ、二重の登録を止める。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: お電話番号を打った瞬間に、同じ番号のご登録を突きつけて二重の登録を止める面。
  - トークン計画: 入力欄は 1 列。重複の警告は `--color-danger-soft` の箱 1 枚だけで、入力欄のすぐ下に置く。
    テンキーは右の柱（白地・左に 1px の罫）に固定する。
  - シグネチャ: **警告が入力欄と同じ視線の上にあり、進む前に必ず 2 択を通ること。**
- **見るモック**: `docs/frontend/mockups/eyex/images/CUSTOMER-NEW.png`
  - 本文は 2 列 `1fr 356px`。左は padding 32px 36px・gap 26px、右の柱は padding 32px 22px・見出し 15px（下に margin 20px）。
  - お電話番号の欄は幅 320px。入力中の値は 21px 等幅・字間 0.04em、キャレットは 2px×24px の緑。
  - 重複の箱: padding 20px 22px・幅 550px まで・`role="status"`。見出し 18px、補足はその下 1 行。
    該当行は白地・1px の `--color-line-strong`・角 8px・padding 12px 16px・gap 24px
    （お名前 18px/700 / ふりがな＋お客様番号 12px / `dt` 12px・`dd` 15px/600）。
    ボタンは gap 10px・上に margin 16px で「このお客様として進む」（緑）と「別の方なので、新しく登録する」。
  - お名前とふりがなは 2 列 `1fr 1fr`・gap 20px・幅 550px まで。プレースホルダは「例：田中 花子」「例：たなか はなこ」。
  - 下端に「あとで登録する（ウォークインのまま）」と「登録してご予約に進む」（主操作）。
  - テンキー: 3 列 × 96px・gap 12px・キーの高さ 72px・角 12px・1px の `--color-line-strong`・数字 28px・
    幅広キー 16px/600。並びは `1 2 3 / 4 5 6 / 7 8 9 / ハイフン 0 削除`（**「1文字消す」は「削除」に正規化する**）。
- **触るファイル**
  - `services/glasses_management/src/web/customers/CustomerNew.tsx`（新規）
  - `services/glasses_management/src/web/customers/CustomerNew.test.tsx`（新規）
  - `packages/ui/src/components.tsx` / `packages/ui/src/index.ts`（`Keypad` を足す）
- **先に書くテスト**（`src/web/customers/CustomerNew.test.tsx`）
  - テンキー > `キーは 12 枚で、右下は「削除」・左下は「ハイフン」`
  - テンキー > `テンキーを使っている間、欄は inputMode="none" でソフトキーボードを出さない`
  - テンキー > `物理キーボードの数字と Backspace は画面のキーと同じ結果になる`
  - 重複の警告 > `11 桁を打ち終えた時点で出る（保存を待たない）`
  - 重複の警告 > `該当 1 件のときは お名前・お客様番号・ご来店 4回・最後のご来店 2026年5月12日 を出す`
  - 重複の警告 > `該当が 6 件あるときは 5 件まで並べ、6 件目からは「ほか 1件」に畳む`
  - 重複の警告 > `2 択のどちらかを押すまで「登録してご予約に進む」を押せない`
  - 重複の警告 > `押せない理由を aria-label に持つ（理由なしの disabled を置かない）`
  - 重複の警告 > `読み上げに割り込まない知らせとして伝わる（role="status"）`
  - 登録 > `「このお客様として進む」ではお客様が 1 件も増えない`
  - 登録 > `「別の方なので、新しく登録する」を選んでから登録すると 2 件目ができる`
  - 登録 > `お名前だけでも登録できる`
  - 登録 > `お名前もお電話番号も空だと「お名前が入っていません。」を欄の下に 1 行で出す`
  - ふりがな > `お名前の変換が確定した時点で 1 度だけ自動で埋め、「自動で入れました」の 1 行を欄の下に出す`
  - ふりがな > `人が一度でも触れた欄は二度と上書きせず、その 1 行も消える`
- **実装**
  - `services/glasses_management/src/web/customers/CustomerNew.tsx`（新規）
  - `packages/ui/src/components.tsx` / `index.ts` に `Keypad` を足す
    （3 列 × 96px / キー 72px / `confirmLabel?` を任意にし、渡されたときだけ 13 枚目の緑のキーを出す）。
  - IME: `compositionstart` 〜 `compositionend` の間は値を読まない。`change`（blur）でももう 1 回拾う二段構えにする。
  - 業務面なので `autocomplete="off"`。お電話番号は `type="tel"` + `inputmode="numeric"`。
- **完了条件**: 15 本が緑。
- **依存**: T-014

## T-017 候補の面を作る（BOOK-04b-CUSTOMER-MATCH）

- **目的**: 番号を打ち終えた瞬間に候補を出し、名前を声に出して確かめてもらえるようにする。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 番号を打ち終えた瞬間に、名前を声に出して確かめてもらうための面。
  - トークン計画: 白い吹き出し 1 枚。強い一致は `--color-pine-soft` の地＋2px の緑枠、
    確かめが必要なほうは白地＋1px の罫。札の文字（「よく一致しています」「確かめが必要です」）を必ず添える。
  - シグネチャ: **候補が開いている間も、電話番号の欄と右下の「録音中」が生きていること（モーダルにしない）。**
- **見るモック**: `docs/frontend/mockups/eyex/images/BOOK-04b-CUSTOMER-MATCH.png`
  - 吹き出しは幅 420px・角 16px・1px の `--color-line-strong`・影 `0 12px 32px rgba(20,40,33,.22)`。
    番号欄の右（上 68px / 左 436px）から出て、左辺 84px の位置に 18px の三角を付ける。
  - 見出し部 padding 18px 20px（h3 20px ＋ 補足 1 行）、本体 padding 18px 20px、足 padding 14px 20px。
  - 候補カードは padding 16px 18px・角 12px。選択中は 2px の緑枠＋薄い緑地（padding は 15px 17px へ 1px 縮める）。
    カード間は margin-top 16px。お名前 19px、来店回数の印、札。`dl` は `82px 1fr`・gap 6px 12px・14px。
  - 足は「どちらでもありません」と「番号を入れ直す」。右の柱（320px）に「お選びになると引き継がれること」
    （現在の度数 / 前回の担当 / 注意ごと / ご連絡先。`dt` 12px・`dd` 16px/600）。
  - 左の欄は「お選びになると入ります」（**飾りとして薄めない**。手順を伝える文なので本文と同じ濃さで描く）。
- **触るファイル**
  - `services/glasses_management/src/web/customers/CustomerCandidates.tsx`（新規）
  - `services/glasses_management/src/web/customers/CustomerCandidates.test.tsx`（新規）
  - `services/glasses_management/src/web/book/CustomerStep.tsx`（P3 が置いた工程 4。候補を import して差し込む）
  - `services/glasses_management/src/web/customers/CustomerNew.tsx`（重複の警告から同じ部品を使う）
- **先に書くテスト**（`src/web/customers/CustomerCandidates.test.tsx`）
  - 候補 > `2 件が listbox の option として読める`
  - 候補 > `全桁一致の 1 件が「よく一致しています」、前方だけ一致の 1 件が「確かめが必要です」`
  - 候補 > `開いた時点ではどちらも選ばれておらず、お名前の欄は「お選びになると入ります」のまま`
  - 候補 > `同姓同名でも全桁一致でも自動で確定しない`
  - 候補 > `1 件を選ぶとお名前とふりがなの欄が埋まり、右に引き継がれる 4 項目が出る`
  - 候補 > `「どちらでもありません」で閉じるとお名前を手で入れられる状態になる`
  - 候補 > `「どちらでもありません」で閉じてもお電話番号の値は消えない`
  - 非モーダル > `候補が開いてもフォーカスは電話番号の欄に残る（残りの桁が打てる）`
  - 非モーダル > `aria-modal を付けない（右下の「録音中」が読み上げから外れない）`
  - 非モーダル > `件数の知らせ「同じ番号のご来店が2件見つかりました。」は role="status" で 1 度だけ伝わる`
  - 非モーダル > `Esc で候補だけが閉じ、フォーカスはお電話番号の欄へ戻る`
  - 非モーダル > `外側を押しても候補だけが閉じ、入力値は消えない`
  - 欄の文言 > `「お選びになると入ります」は欄を読み上げたときにも手順として読まれる`
- **P3 との境目**: 候補の吹き出しは **P3 では作っていない**（`customers` 表が `0004_*.sql` で初めてできるため。
  P3 T-016 の範囲の線引き）。P3 は「番号を打ち終えたらお名前の欄へ進む」までを作ってあるので、
  ここで `customers/` に部品を新設し、`book/CustomerStep.tsx` から import して差し込む。
  照会は `GET /api/staff/customers/lookup`（T-012）を使い、P3 が置いた打鍵の値をそのまま渡す。
- **実装**: `services/glasses_management/src/web/customers/CustomerCandidates.tsx`（新規）。
  入力欄を `role="combobox"` + `aria-expanded` + `aria-controls`、候補一覧を `role="listbox"` / `role="option"` にする
  （APG の combobox パターン）。下矢印で候補へ降りる。**`aria-modal="true"` を付けない。**
  この部品は P3 の工程 4 と CUSTOMER-NEW の両方から使うので、`customers/` に置いて `book/` から import する。
- **完了条件**: 13 本が緑。
- **依存**: T-016

## T-018 おまとめを作る（CUSTOMER-MERGE）

- **目的**: 取り消せないおまとめの前に、まとめたあとの姿と失うものを同じ画面で読ませる。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 取り消せない操作の前に、まとめたあとの姿と失うものを同じ画面で読ませる面。
  - トークン計画: 見比べ表は罫だけで組む（箱にしない）。残す側だけ 2px の緑枠と `--color-pine-soft` の地、
    残さない側は取り消し線と `--color-ink-faint`。右は結果（緑の箱）と警告（赤の箱）の 2 枚だけ。
  - シグネチャ: **「まとめると元に戻せません」と実行ボタンが同じ視線の上にあること。**
- **見るモック**: `docs/frontend/mockups/eyex/images/CUSTOMER-MERGE.png`
  - 本文は padding 28px 32px・2 列 `1fr 300px`・gap 28px。サイドバーは**ひらいた 216px が既定**。
  - 見比べ表は 3 列 `108px 1fr 1fr`。見出し行は下に padding 14px ＋ 1px の `--color-line-strong`
    （A / B の見出し 16px、その下に「2024年3月15日 ご登録／銀座店」13px）。
  - 各行は **min-height 96px**・下に 1px の罫。左の項目名は 15px、下に「A を残します」13px。
    値の枠は margin 10px 6px・padding 10px 12px・角 8px・2px の透明枠。
    残す側は緑枠＋薄い緑地で「✓ 残す」（13px/600 `--color-pine-deep`）、
    残さない側は「残さない」＋取り消し線の値（`--color-ink-faint` の 400）。値は 16px/600、補足は 13px。
  - 右上「まとめると、こうなります」は緑の箱。`dl` は `76px 1fr`・row-gap 10px・`dt` 13px・`dd` 15px/600。
    5 行（お名前 / お客様番号 / お電話番号 / ご住所 / 接客のメモ）。
  - 右下「まとめると元に戻せません」は赤の箱で、`li` 13px・行間 1.7 の 2 項目
    （「お客様番号 G-02310 は使えなくなります。」「操作した者と日時は記録に残ります。」）。
  - 操作は「やめる」と「この内容でまとめる」（主操作）を右下に 1 組。上のバー右に「別の組み合わせ」。
- **触るファイル**
  - `services/glasses_management/src/web/customers/CustomerMerge.tsx`（新規）
  - `services/glasses_management/src/web/customers/CustomerMerge.test.tsx`（新規）
  - `services/glasses_management/src/web/customers/CustomersPage.tsx`（`pane === 'merge'` を足す）
- **先に書くテスト**（`src/web/customers/CustomerMerge.test.tsx`）
  - 見比べ > `項目は お名前 / お電話番号 / ご住所 / 接客のメモ の 4 つ`
  - 見比べ > `残す側は「✓ 残す」、残さない側は「残さない」と取り消し線で示す（色だけで示さない）`
  - 見比べ > `接客のメモだけ「両方を残します」を選べる`
  - 見比べ > `値の無い側は「ご登録がありません」と出す`
  - 結果 > `「まとめると、こうなります」にお客様番号 G-01842 と 接客のメモ 8件 が出る`
  - 結果 > `残す側を切り替えると、結果の値がその場で入れ替わる`
  - 警告 > `「まとめると元に戻せません」「お客様番号 G-02310 は使えなくなります。」「操作した者と日時は記録に残ります。」が同じ画面に出る`
  - 実行 > `「この内容でまとめる」を押すと、押したボタンだけが「まとめています…」に変わる`
  - 実行 > `拒まれたときは何が変わったかの差分と「もう一度下見する」を出し、下見からやり直させる`
  - 権限 > `店長でないときは、一覧にも詳細にもおまとめの入口が出ない`
  - 取り消し > `「やめる」では何も変えずに一覧へ戻る`
- **実装**: `services/glasses_management/src/web/customers/CustomerMerge.tsx`（新規）。
  実行中は `disabled` を使わず `aria-busy="true"` + `aria-disabled="true"` にしてフォーカスと文字色を保つ。
  拒まれたときは EX-CONFLICT と同じ型（①「まとめはまだ行っていません」を先に言う ②差分 ③「もう一度下見する」）。
- **完了条件**: 11 本が緑。
- **依存**: T-014

## T-019 手書きを作る（CUSTOMER-HANDWRITE）

- **目的**: 手書きのメモを言い換えずにそのまま台帳へ置けるようにする。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 測定中に書いた紙のメモを、言い換えずにそのまま台帳へ置く面。
  - トークン計画: 左はサムネの柱（`--color-surface-2` の地）、右は白い用紙 1 枚。
    読み取った文字の欄は用紙の**下**に置き、2px の緑枠で「ここは直せる」と示す。
  - シグネチャ: **筆跡がいちばん大きく、読み取った文字がその下に従うこと（逆にしない）。**
- **見るモック**: `docs/frontend/mockups/eyex/images/CUSTOMER-HANDWRITE.png`
  - 本文は 2 列 `260px 1fr`。左は padding 28px 20px。サムネは 1px の `--color-line-strong`・角 8px・
    SVG の高さ 118px、下の帯は `--color-surface-2`・padding 10px 12px（日付 14px/600 ＋ 店舗と記入者 13px）。
    サムネ間は margin-top 18px。選択中は **3px の緑枠**＋帯が薄い緑。
  - 右は padding 28px 32px・gap 22px。見出しは日付＋用件 18px、店舗と記入者 13px、右端に札「1枚目 / 3枚」。
  - 道具の列: 「大きく」「小さく」「赤ペンも見る」（min-width 48px / min-height 44px / 14px 600。選択中は 2px の緑枠）。
    **「紙を撮り直す」はこのフェーズで作らない**（カメラがデータモデルにも API にも無い。feature spec のスコープ外）。
    同じ理由で「大きく」「小さく」「赤ペンも見る」も**スコープ外**なので、ボタンを出さない（押せて何も起きないボタンを作らない）。
  - 用紙: 1px の `--color-line-strong`・角 12px・白地に 44px 間隔の横罫（`background-size: 100% 44px`）。
  - 読み取り欄: 2px の緑枠・角 12px・padding 14px 16px・**min-height 92px**・16px・行間 1.6。
    自信の低い箇所は `--color-danger` の点線の下線（offset 4px）で示し、下に「点線の 3か所は読み取りに自信がありません。」13px。
  - 下端に「注意ごととして登録を申し込む」（主操作）と「文字を保存する」。上のバー右に「‹ お客様の詳細へ戻る」「新しく書く」。
- **触るファイル**
  - `services/glasses_management/src/web/customers/CustomerHandwrite.tsx`（新規）
  - `services/glasses_management/src/web/customers/CustomerHandwrite.test.tsx`（新規）
  - `services/glasses_management/src/web/customers/CustomersPage.tsx`（`pane === 'handwrite'` を足す）
- **先に書くテスト**（`src/web/customers/CustomerHandwrite.test.tsx`）
  - 一覧 > `見出しの枚数とサムネの本数が一致する`
  - 一覧 > `新しい順に並び、各枚に日付・記入した店舗・記入者が添う`
  - 一覧 > `丸の内店で書かれた 1 枚も銀座店の端末から読める`
  - 一覧 > `選んでいる位置が「1枚目 / 3枚」と一致する`
  - 一覧 > `0 枚のときは「手書きのメモはまだありません」と次の行動の 1 行を出し、「新しく書く」だけを残す`
  - 用紙 > `筆跡の SVG は role="img" と読み取った文字の aria-label を持つ`
  - 用紙 > `なぞっている間、背後の本文がスクロールしない（touch-action: none）`
  - 用紙 > `ペンが触れている間、手のひらの touch は線にならない`
  - 用紙 > `線の太さは筆圧で変えない`
  - 保存 > `「手書きのまま残す」で 1 枚増え、見出しが「手書きメモ　4枚」になる`
  - 保存 > `6 枚目は保存できず、どの 1 枚を置き換えるかを尋ねる`
  - 文字 > `「文字を保存する」で本文だけが新しくなり、筆跡は書いたときのまま残る`
  - 文字 > `読み取り結果が空でも保存できる`
  - 文字 > `点線の箇所の数と「3か所」の数字が一致する`
  - 申し込み > `「注意ごととして登録を申し込む」を押すと札が「注意ごとに申し込み済み」になる`
  - 申し込み > `申し込んでも詳細の「注意ごと　1件」の件数は増えない`
  - 代替 > `手書きが使えなくても「読み取った文字（直せます）」から同じ内容を文字で残せる`
- **実装**: `services/glasses_management/src/web/customers/CustomerHandwrite.tsx`（新規）。
  入力は Pointer Events で受け、`pointerType === 'pen'` が接触している間は `pointerType === 'touch'` を捨てる。
  `.canvas` に `touch-action: none`。`pressure` は使わない。
  保存する SVG は**クライアントでも**許可リストの要素だけを組み立てる（サーバ側の `sanitizeSvg` と二重にする）。
- **完了条件**: 17 本が緑、web カバレッジ 4 指標 60% 以上。
- **依存**: T-015

## T-020 E2E を書き、spec を Approved に上げる

- **目的**: Approved の UC/AC 40 件を、ちょうど 1 本ずつの Playwright test に接続する。
- **触るファイル**
  - `services/glasses_management/e2e/customer-records.spec.ts`（新規）
  - `services/glasses_management/seed.mjs`（お客様・度数・メガネ・メモを足す）
  - `services/glasses_management/playwright.config.ts`（`webServer` の command に seed を差し込む）
  - `specs/glasses_management/features/007-customer-records/spec.md`（`- ステータス:` を `Draft` → `Approved`）
  - `docs/testing/E2E_TRACEABILITY.md`（`## 現在の基準線` の表に 26 行）
- **やること**
  - seed に CUSTOMER-LIST の 8 行（相川 みどり / 青木 律子 / 石井 孝 / 伊藤 健 / 大森 千夏 / 川上 恵 / 木下 亮太 / 田中 花子）と、
    田中 花子 様の度数 3 件・メガネ 2 本・メモ 8 件（うち注意ごと 1 件・手書き 3 枚）を入れる。
    マスタープラン §5 の世界観データと重なる方（田中 花子・伊藤 健・川上 恵・相川 みどり）は**§5 の値を正**とする。
    `seed.mjs` に `--persist-to`（`process.env.E2E_STATE_PATH`）を通す引数を足し、e2e が使う使い捨ての D1 に入るようにする。
  - **26 本の test を書き、その直前の行に `// @e2e-covers` を置く。** UC は関連する AC のテストへ相乗りさせる
    （1 行のコメントに半角空白区切りで複数 ID を書ける。コメントと `test(` の間に別の文を挟まない）。

    | # | `@e2e-covers` | test の題 |
    |---|---|---|
    | 1 | `UC-CUST-01 AC-CUST-01` | 台帳の検索は下 4 桁で引け、0 件でも行き止まりにしない |
    | 2 | `AC-CUST-02` | 名前の一部でもふりがなでも同じお客様が残る |
    | 3 | `UC-CUST-02 AC-CUST-03` | 並べ方と絞り込みで人数が変わり、選んでいた行の選択が外れない |
    | 4 | `UC-CUST-05 AC-CUST-04` | 11 桁を打ち終えると候補の面が開き、2 件が並ぶ |
    | 5 | `AC-CUST-05` | 候補は自動で確定せず、2 段の札で分かれる |
    | 6 | `UC-CUST-06 AC-CUST-06` | 候補を選ぶと名前とふりがなが入り、引き継がれることが出る |
    | 7 | `AC-CUST-07` | 「どちらでもありません」で手入力に戻り、初めてのお客様として進める |
    | 8 | `UC-CUST-03 AC-CUST-08` | 行を選ぶと 4 項目の要約が出て、度数の履歴表は出ない |
    | 9 | `UC-CUST-04 AC-CUST-09` | 詳細の度数は新しい順で、いま有効な 1 行に「いま使っています」が付く |
    | 10 | `AC-CUST-10` | 来店回数の表記が一覧・候補・受付で一致する |
    | 11 | `UC-CUST-07 AC-CUST-11` | 新規登録で同じお電話番号のお客様を知らせる |
    | 12 | `UC-CUST-08 AC-CUST-12` | 「別の方なので、新しく登録する」を選んだときだけ 2 件目ができる |
    | 13 | `AC-CUST-13` | 候補から 1 名を選んで確定しても、もう 1 件の登録は残る |
    | 14 | `UC-CUST-09 AC-CUST-14` | おまとめの面が結果と失うものを同じ画面に出す |
    | 15 | `AC-CUST-15` | まとめると寄り、下見のあとに予約が入っていたら実行を拒む |
    | 16 | `AC-CUST-16` | 店長でないと入口が出ず、直接叩いても拒まれる |
    | 17 | `AC-CUST-17` | 別の会社のお客様 ID は 404 として扱われる |
    | 18 | `UC-CUST-10 AC-CUST-18` | 手書きを 1 枚足すと 4枚になり、他店で書かれた 1 枚も読める |
    | 19 | `UC-CUST-11 AC-CUST-19` | 読み取った文字を直しても筆跡は書いたときのまま残る |
    | 20 | `UC-CUST-12 AC-CUST-20` | 申し込みだけでは注意ごとにならない |
    | 21 | `UC-CUST-13 AC-CUST-21` | 候補の面が開いている間も録音の表示が読み上げから外れない |
    | 22 | `AC-CUST-22` | 「お選びになると入ります」は飾りではなく手順として読める |
    | 23 | `AC-CUST-23` | 用紙をなぞる間は背後がスクロールせず、手のひらは線にならない |
    | 24 | `AC-CUST-24` | 60分の帯は来店回数の印つき、30分の帯は姓だけになる |
    | 25 | `AC-CUST-25` | 帯を押した詳細の見出しと注意ごとがその方のものになる |
    | 26 | `UC-CUST-14 AC-CUST-26` | 顧客台帳からご予約を取ると工程 4 が最初から埋まっている |

  - 26 本を緑にしてから spec の `- ステータス:` を `Approved` に上げる。**Draft のまま E2E を書いても validator は分母に入れない。**
- **先に書くテスト**: この 26 本の Playwright test そのものが検証。
- **実装**: `customer-records.spec.ts` に割り当て表のとおりの test を並べる。
- **完了条件**: `pnpm --filter @app/glasses_management e2e` が緑、`pnpm run test:traceability` が
  `all approved UC/AC identifiers are mapped exactly once.` を出す。
- **依存**: T-013, T-017, T-018, T-019

## T-021 モックとの突き合わせを 6 画面ぶん足す

- **目的**: 承認された見た目からどれだけ離れているかを、画素で測って記録に残す。
- **先に書くテスト**: なし（`toHaveScreenshot` そのものが検証。基準は `reference/` の画像）。
- **触るファイル**: `services/glasses_management/e2e/mock-compare.spec.ts`（追記）
- **やること**
  - 基準画像は `docs/frontend/mockups/eyex/reference/` 側（端末のステータスバーを外した派生物）。
    無ければ `node docs/frontend/mockups/eyex/reference.mjs` で作り直す。
  - `mock` project（1194×810 / `deviceScaleFactor: 2`）で 6 枚撮る。
    `toHaveScreenshot('<画面ID>.png', { scale: 'device' })` に `scale: 'device'` を必ず付ける。

    | 画面ID | そこへ着く操作 |
    |---|---|
    | `CUSTOMER-LIST` | 顧客台帳を開き、「ご来店 2〜4回」で絞り、田中 花子 様の行を選ぶ |
    | `CUSTOMER-DETAIL` | その状態から「くわしく見る」 |
    | `CUSTOMER-NEW` | 「＋ 新しいお客様を登録」→ テンキーで 090-1234-5678 |
    | `CUSTOMER-MERGE` | 店長として田中 花子 様の 2 件を選び、おまとめを開く |
    | `CUSTOMER-HANDWRITE` | 詳細の注意ごとの行から手書きメモを開く |
    | `BOOK-04b-CUSTOMER-MATCH` | 予約の工程 4 でテンキーに 090-1234-5678 を打ち切り、候補を開く（**P3 T-021 から持ち越し**） |

  - `maxDiffPixelRatio` は **0.08 で始め、残っている差が何かを 1 枚ずつコメントに書く**
    （「上のバーのお知らせのバッジは P10」「日付の帯は P1」のように、どのフェーズで消えるかまで書く）。
    **この値は下げるだけ。上げてはいけない。**
- **実装**: 6 面の `toHaveScreenshot` と、許している差のコメント。
- **完了条件**: `pnpm --filter @app/glasses_management exec playwright test --project=mock` が緑。
  CUSTOMER-LIST の差分が 5% 以下。
- **依存**: T-020

## T-022 完了の確認

- **目的**: このフェーズの全ゲートを実際に走らせ、緑であることを結果で確かめる。
- **触るファイル**: `knip.jsonc`（新しい entry がある場合のみ）／進捗台帳
- **先に書くテスト**: なし（ここで新しいテストを書かない。足りなければ元のタスクへ戻る）
- **実装**: 下の 7 本を上から順に走らせ、落ちたら原因のタスクへ戻る。

```sh
pnpm run lint                                   # 緑
pnpm run deps:check                             # 緑
pnpm run typecheck                              # 緑
pnpm --filter @app/glasses_management test:all  # 緑（Worker 80% / web 60%）
pnpm run test                                   # 緑（traceability を含む）
pnpm --filter @app/glasses_management e2e       # 緑
pnpm check                                      # 緑
```

- `knip.jsonc` に足りない entry があれば実在のものだけに直す。
- 進捗台帳（`docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md`）に、
  実行したコマンドとその結果・カバレッジの実測値・`maxDiffPixelRatio` の実測値を書く。
- **完了条件**: 上の 7 本がすべて緑。spec が `- ステータス: Approved`。進捗台帳に実測値を書いた。
- **依存**: T-021
