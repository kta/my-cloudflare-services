# 003-service-foundation: サービスの土台

- サービス: `glasses_management`
- ステータス: Approved

## 1. WHAT / WHY

**概要**: EYEX予約を `services/example_service` の雛形から 0 で作り直す。この feature は
「業務画面の器（上のバーと左サイドバー）が立ち、admin から届く組織・担当店舗を受け取り、
テナントの外へ一切漏れない」ところまでを担う。個々の業務画面は後続の feature が足す。

**ユーザーストーリー**:

- US-FOUND-01: 店舗スタッフとして、別の店舗のご予約を誤って触らないために、いまどのお店にいて、どこへ行けるかが常に見えてほしい。
- US-FOUND-02: 店舗スタッフとして、台帳の時間軸を 1 列でも多く見たいために、行き先の柱を細くたたんで場所を空けたい。
- US-FOUND-03: 運営者として、admin で直した組織名と担当店舗をその日の受付に効かせるために、このドメインへ確実に反映されてほしい。
- US-FOUND-04: 運営者として、お客様の度数と録音をお預かりする以上 1 件の漏れも許されないために、あるお店の情報が別の会社から一切見えないことを保証したい。
- US-FOUND-05: 運営者として、担当でない店舗の予約が見えてしまうことを防ぐために、遅れて届いた古い配信で組織名と担当店舗が巻き戻らないでほしい。
- US-FOUND-06: 複数店舗担当として、別の店舗のご予約を誤って触らないために、いま操作している店舗を明示的に切り替えたい。

**受け入れ基準**:

- AC-FOUND-01: Given dev トークンで資格情報を受け取っている, When 業務画面（`/`）を開く, Then 上のバーに店名と営業状態が出る。器は `header` と「画面の切り替え」の `nav` と `main` を 1 つずつ持ち、本文の先頭にいま開いている画面の名前が見出しとして置かれている。業務を始める入口そのもの（お店のコード・端末の使い分け・PIN）はこの feature には無く、`013-terminals-and-audit` が置き換える。
- AC-FOUND-02: Given 業務画面を開いている, When サイドバーの「たたむ」を押す, Then 行き先の文字が消えてアイコンだけの細い柱になり、トグルの文字と読み上げ名がどちらも「ひらく」に入れ替わって、もう一度押すと元に戻る。細い柱の間も行き先のボタンと主操作「予約を取る」は名前を失わず、読み上げでは主操作 1 つと行き先すべて（トップ・予約台帳・来店受付・予約を検索・受付履歴・顧客台帳・分析・設定の 8 つ。トップの行を持つのは HOME 系の 3 画面だけで、ほかの画面は 7 つになり、トップへは上のバー左の ⌂ で戻る）が「予約を取る」「予約台帳」「顧客台帳」などの名前で 1 つずつ引ける。お知らせの常設の入口は上のバーのバッジで、サイドバーの「お知らせ」の行は ALERTS を開いている間の現在地表示としてだけ出す。未読の件数を「トップ」の行に付けない。
- AC-FOUND-03: Given 業務開始の画面でお店のコードを入れた, When そのコードで店舗が 1 つも見つからない, Then **業務画面へ入れず**、入口に留まったまま「このコードのお店が見つかりませんでした。お店のコードをお確かめのうえ、もう一度お試しください。」と出す。左サイドバーも営業状態も出さない。（**2026-09-03 に改訂**。以前は「業務画面を開いていて、店舗が 1 つも登録されていないときに『お店がまだ登録されていません。』と事実だけを出す」だった。実装ではその状態でも器に入れてしまい、上のバーが実在しない屋号「EYEX」と、どの店舗のものでもない固定文字列「営業中　10:00–19:00」を出していた。未知の組織とまだ店舗が無い組織はサーバから見分けられない（どちらも `200 []`）ので、入口で止めるほうを取る。組織が admin からまだ届いていない 503 `not_synced` はこれとは別で、従来どおり通して AC-FOUND-07 の面が説明する。）
- AC-FOUND-09: Given 業務画面を開いている, When 上のバーの営業状態を見る, Then その店舗の保存された営業時間から出した「営業中　10:00–19:00」「営業時間外　10:00–19:00」「本日は定休日」のいずれかが出る。曜日ごとの上書きがあればその日の値を使い、営業時間が読めていない間は何も出さない（憶測の時刻を書かない）。判定に端末の時計を直接読まず、時刻は引数で注ぐ。
- AC-FOUND-10: Given 業務画面のどの面を開いている, When 画面上のボタンを数える, Then クリックのハンドラを持たないボタンが 1 つも無い。とくに予約台帳の詳細の「ご来店を受け付ける」「変更する」「取り消す」は、押すとそれぞれ来店受付・日時変更・取り消しの面へ、**押した予約を持ったまま**進む。
- AC-FOUND-04: Given 個人端末で業務画面を開いている, When 上のバーの「業務を終える」を押す, Then 業務開始の画面へ戻り、保持していた資格情報が消える。共有端末は上のバーに「業務を終える」を持たず、自動で伏せた面（HOME-SHARED-LOCKED）の「業務を終える」から同じ終業を行う。
- AC-FOUND-05: Given サービスが動いている, When 認証なしでヘルスチェックを叩く, Then 200 と `{"status":"ok"}` を返す。

**スコープ外**: 端末の使い分けと PIN（`013-terminals-and-audit`）、店舗の登録（`004-store-settings`）、
予約・顧客・録音・分析・Web予約（それぞれの feature）。実運用の認証（いまは dev トークングラント）。
**業務を始める入口そのもの**は足場である。dev トークングラントと、それを呼ぶ暫定の画面は
`013-terminals-and-audit` が START-DEVICE-MODE →（LOGIN-STAFF / LOGIN-SHARED）→ HOME の 3 段へ置き換えるので、
P10 で丸ごと捨てる（捨てる作業は 013 の TASKS に立てる）。
**店舗を切り替える操作面**（US-FOUND-06 の受け皿）はこの feature で作るが、UC/AC の ID は
`e2e/foundation.spec.ts` の `@e2e-covers` と同じコミットで足す（T-016）。003 は Approved なので、
E2E を伴わない ID を先に置くと traceability の分母だけが増えてしまう。
**組織同期とテナント分離の受け入れ基準**（US-FOUND-03 / US-FOUND-04 / US-FOUND-05 の受け皿）も同じ扱いにする。
挙動そのものは P0 で実装済みだが、受け入れ基準の ID をまだ持っていない。003 は Approved なので、
E2E を伴わない ID を先に置くと traceability の分母だけが増える。`e2e/foundation.spec.ts` に `@e2e-covers` を足すのと
同じコミットで、AC-FOUND-06（古い `revision` の配信で巻き戻らない）・AC-FOUND-07（未同期は 503 `not_synced`、無効化は 403）・
AC-FOUND-08（他テナントの店舗 ID は 404）を足す（T-017）。

**不明点**:

- `[要確認: Q-05 — いまの前提（ホーム画面に追加した Web アプリとして配る）で進める]`

## 2. HOW

**触るファイル**:

- `packages/contracts/src/glasses_management.ts` — `OrganizationSync` / `StorePermission` / `StoreMembership` / `Store` / `Actor`
- `packages/ui/src/theme.css` — 承認済みモック `docs/frontend/mockups/eyex` のトークンへ全面的に書き直す
- `services/glasses_management/src/worker/{index.ts,db/schema.ts}`
- `services/glasses_management/src/web/{App.tsx,client.ts,main.tsx,app.css}` と `src/web/shell/*`
- `packages/ui/src/components.tsx` — 共有プリミティブ（欄の縁・入力前の手がかり・帯の役割・押せないときの見せ方）
- `services/glasses_management/index.html` — `viewport-fit` と安全領域
- `services/glasses_management/vite.config.ts` — dev サーバの `allowedHosts`（admin からの service binding が Host 検査で 403 になる）
- `services/glasses_management/wrangler.jsonc` — `triggers.crons` と `scheduled` ハンドラ（アカウントで 1 本目の Cron 枠）
- `services/glasses_management/test/*` / `e2e/foundation.spec.ts`

**データモデル差分**: `organizations`（同期の写し。revision つき）/ `stores` / `store_memberships` の 3 表を新設。
FK は宣言せず、id はアプリ生成、全行に `organization_id` を持つ。

**却下した代替案**:

- 旧実装の `src/web/gallery` を残して見た目だけ差し替える: 旧デザインの語彙が残るため却下。0 から作る。
- 担当解除で membership の行を消す: 削除専用の同期経路が要るため却下。permissions を空にして配る。
- 行き先を上のバーに置く: 横に広い画面で場所を食い、行き先が散るため却下。左の柱にまとめる。

## 3. TASKS

- [x] T-001: 契約テスト（`packages/contracts/test/glasses_management.contract.test.ts`）を書く。
- [x] T-002: `permissions.test.ts` / `tenant-isolation.test.ts` / `foundation.integration.test.ts` / `schema.test.ts` を書く。
- [x] T-003: スキーマとマイグレーションを作る。
- [x] T-004: Worker（health / dev グラント / 組織同期 / 担当店舗同期 / 店舗一覧）を実装する。
- [x] T-005: デザイントークンを `eyex` モックの値へ書き直す。
- [x] T-006: 業務画面の器（`AppShell`）と業務開始の画面を実装する。パス 1 の計画は
      「主役は 1 画面に 1 つ / 白い箱は 3 枚まで / 外周の余白 44px / 行き先はすべて左の柱」。
- [x] T-007: `src/web/App.test.tsx` を書く。
- [x] T-008: `e2e/foundation.spec.ts` に `@e2e-covers` を付けて AC と 1 対 1 で対応させる。
- [ ] T-009: `pnpm check` を緑にする。
- [ ] T-010: 細い柱にたたんだときも行き先のボタンが名前を持つようにする（読み上げ専用の文字か `aria-label`）。`e2e/foundation.spec.ts` の AC-FOUND-02 を「文字は見えないが、名前では引ける」に書き換え、`src/web/App.test.tsx` も揃える。
- [ ] T-011: 器のランドマークを揃える。本文を `<main>` にし、いま開いている画面の名前を本文先頭の見出しにする。`e2e/foundation.spec.ts` の AC-FOUND-01 にランドマークの検査を足す。
- [ ] T-012: 200% に拡大しても情報が消えないようにする。店名と営業状態の切り詰め（…）を外して折り返し、器ごと隠す `overflow-hidden` をやめて、溢れる要素の中だけをスクロールさせる。
- [ ] T-013: 共有プリミティブの読みやすさと役割を直す。入力前の手がかり（プレースホルダ）を薄めずに置き、入力欄・選べる札の縁は縁だけで「押せる」と分かる濃さのトークンを使い、通信断・失敗の帯は読み上げに割り込まない知らせにし（項目ごとのエラーだけ割り込んでよい）、緑地の文字は緑地用のトークンを使う。処理中はボタンを無効にせずフォーカスを保ったまま「処理中」を伝え、本当に無効な操作にだけ理由を名前として持たせる。
- [ ] T-014: 余白のトークンを 3 つ（外周・かたまり・安全領域）に揃え、下端に置く帯（工程の帯・録音の表示）が安全領域を避けられるようにする。`.card.warn.lead` の左帯はモックの一点物の 6px をやめて 4px に寄せ、トークンとして持つ。`viewport-fit=cover` を続けるかどうか（Q-05）と合わせて決める。
- [ ] T-015: モックが使っていて実装トークンに無い値を片づける。文字の大きさ 15px（モック 85 箇所）と 14px（29 箇所）は**段を足さず** 16px / 13px へ丸める（モック README「文字の段は 3 段まで」）。影響カードの縁の 2 色は「失敗ではない注意」を担う `--color-amber` 系としてトークンに足す（「要確認」の札・「初めて」の来店回数・設定の影響カードが使う）。`record` / `timer` / `glyph` / `figure` / `text-glyph` / `text-figure` は `admin` / `example_service` が使っているので `theme.css` に残す。`--font-sans` / `--font-mono` に残っている IBM Plex の名前とコメントを落とす（決定ブリーフ §12.2 で書体は配らないと確定済み）。
- [ ] T-016: 店舗を切り替える操作を作る（US-FOUND-06）。上のバーの店名から担当店舗の一覧を開いて選び直し、切り替えたら台帳の日付と絞り込みを既定へ戻す。`e2e/foundation.spec.ts` に `@e2e-covers` を足すのと同じコミットで、対応する UC/AC を本 spec の「ユースケース」「受け入れ基準」へ足す。
- [ ] T-017: 組織同期とテナント分離の受け入れ基準を足す。`e2e/foundation.spec.ts` に `@e2e-covers` を足すのと同じコミットで、AC-FOUND-06（遅れて届いた古い `revision` の配信で組織名と担当店舗が巻き戻らない。`revision` は整数を入れた text 列なので比較は必ず `Number()` に通す）・AC-FOUND-07（組織が未同期なら 503 `not_synced`、無効化されていれば 403 を返す）・AC-FOUND-08（他テナントの店舗 ID を指しても 404 で、存在の有無も返らない）を本 spec の「受け入れ基準」へ足す。挙動は `test/tenant-isolation.test.ts` / `foundation.integration.test.ts` に実装済みなので E2E は薄くてよい。
- [ ] T-018: `services/glasses_management/vite.config.ts` に `allowedHosts: ['glasses-management.internal']` を足す。`services/admin/src/worker/sync.ts` は `https://glasses-management.internal/api/internal/organizations/sync` と `.../store-memberships/sync` を固定文字列で持っており、いまの dev サーバは Host 検査で 403（`Blocked request. This host ... is not allowed.`）を返す。`make dev/all` で組織も担当店舗も届かず、業務 API が 503 `not_synced` を返し続けるので、P1 以降の E2E が 1 本も緑にならない。`services/admin/vite.config.ts` の `allowedHosts: ['admin.internal']` と同じ形にし、admin → glasses_management の 2 本の同期が dev で 200 になるところまで確かめる。
- [ ] T-019: `services/glasses_management/wrangler.jsonc` に `triggers.crons` を 1 本足し、`scheduled` ハンドラを置いて内部ディスパッチ（時刻でその日の処理を選ぶ）だけを実装する。いまリポジトリで `triggers.crons` を持つ Worker は 0 本（`services/ops` は存在しない）なので、このサービスがアカウントの Cron 枠 5 本のうち 1 本目を使う。個々の日次処理は後続の feature が同じハンドラへぶら下げる。
