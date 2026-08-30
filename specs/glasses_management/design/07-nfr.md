# 07 — 非機能要件と運用（glasses_management）

- サービス: `glasses_management`（`services/glasses_management` / `@app/glasses_management`）
- 見た目の正本: `docs/frontend/mockups/eyex/`（68画面 + `assets/eyex.css`）
- 意味の正本: `packages/ui/src/theme.css`
- 位置づけ: この文書は「どう作るか」ではなく「どこまで満たすか」を数値で決める。挙動の定義は
  `design/06-use-cases.md`、経路は `design/04-api.md`、列は `design/03-data-model.md` を見る。

本文中で参照する ID（UC-XXX-NN / AC-XXX-NN）の定義は各 `features/<NNN>-<slug>/spec.md` にだけ置く。

---

## 1. 利用環境

### 1.1 対象端末

| 面 | 端末 | 論理サイズ | 向き | 認証 |
|---|---|---|---|---|
| 業務（`/start` 〜 `/settings`） | iPad 11インチ | 1194×834pt | 横向きが既定。縦向き（834×1194）も使える | JWT + 有効 org |
| お客様向け Web 予約（`/w/**`） | iPhone | 390×844pt | 縦向き | なし（店舗 slug で解決） |

- モックの `.statusbar`（業務面は高さ24pt、Web 予約面 `.phone` は高さ44pt の緑帯）は
  **iPadOS / iOS のステータスバーを紙の上で再現したもの**であり、実装では描かない。
  実装の最上段は `.appbar`（業務面 64pt / Web 予約面 56pt、`--color-pine`）から始まる。
- 業務面はブラウザ（Safari / WKWebView）で開く。ネイティブアプリは作らない。
- **ブラウザ自身の UI を高さに勘定する**。上の「実装の最上段は `.appbar` から始まる」が成り立つのは
  standalone（ホーム画面に追加）で開いたときだけで、Safari のタブのまま開くと
  タブバー + ツールバーで概ね **40〜90pt** が減る。有効高の段は §1.2 で決める。
  `services/glasses_management/playwright.config.ts` の `ipad` project（1194×834）は
  **モックの基準画像と同じ枠**であって実機の描画領域ではない。
  `[要確認: Q-05 — いまの前提で進める]`（業務用の iPad へこの画面をどう入れるか。有効高の基準（§1.2）と
  EX-MIC-DENIED の 3 手順がこれに従属する。いまの前提は ①ホーム画面に追加。`manifest.json` と
  `apple-mobile-web-app-capable` を足す。§13 の #1）
- **安全領域（safe area）**。`services/glasses_management/index.html` が `viewport-fit=cover` を宣言しているので、
  器に `padding-bottom: env(safe-area-inset-bottom)`、左右に `env(safe-area-inset-left / right)` を入れる。
  横向きのホームインジケータは下端中央にあり、そこへ `.stepbar`（下端 0）と `.rec-float` / `.float`（下端 20px）が来る。
  余白は任意値で書かず、`theme.css` のトークン経由で入れる（§3.1）。
- **縦向き（834×1194）でも情報も機能も失わない**（WCAG 2.2 AA 1.3.4 Orientation）。iPad はスタンドから外せば縦になり、
  レジ横の共有端末ほど持ち上げられるので、向きで進行を止める1画面は出さない。
  834px は §1.2 の「768–1023px」の段にそのまま入るため、専用のレイアウトは作らない。
  台帳の面でだけ「iPad を横にすると台帳が見やすくなります」の**非阻害の案内**（`role="status"`・閉じられる・
  操作を遮らない）を出す。

### 1.2 幅と高さが変わったとき（Split View・Stage Manager・ページ拡大）

有効幅（CSS px）で3段に切り替える。段の境目でレイアウトが跳ねないよう、寸法は rem と fr で書き、
px の直値はグリッドの列幅（台帳の名前列 170px / 150px）だけに残す。

| 有効幅 | サイドバー | 2ペイン画面（台帳詳細・受付履歴・顧客・設定・お知らせ） | 台帳の時間グリッド | 予約の帯のドラッグ |
|---|---|---|---|---|
| 1024px 以上 | 展開（216px）と柱（76px）を切り替えられる | 左右に並べる | 全14枠を収める | 有効 |
| 768–1023px | 柱（76px）に固定。展開できない | 右ペインを下へ回り込ませる | 横スクロール（名前列は固定） | 有効 |
| 767px 以下 | 畳んで本文の先頭に行き先リストを置く | 1カラム。詳細は別画面として押し込む | 横スクロール | **無効**（行を押して「時間を変える」に入る） |

- Slide Over（320pt 相当）は 767px 以下と同じ扱いにする。専用のレイアウトは作らない。
- **Stage Manager と外部ディスプレイ**では幅も高さも連続に変わる（窓の最小はおよそ 570×470pt、
  外部ディスプレイでは 1600pt 超になる）。段は `window.innerWidth` の一発判定ではなく、
  **器の有効幅・有効高**をコンテナクエリか `ResizeObserver` で追って決める。上下の表の段は連続量の閾値であって
  端末の型番ではない。
- Web 予約は 320px（iPhone SE 相当）から 430px までを保証する。
- 表中の「全14枠」は**モックが描いている表示窓**である（LEDGER-STAFF / LEDGER-RESOURCE / LEDGER-WALKIN の
  `grid-template-columns: <名前列> repeat(14, 1fr)` と「10:00 から 30分刻みで 14 枠（10:00–17:00）」のコメント）。
  銀座店の営業は 10:00–19:00 ＝ **18 枠**なので、1194px でも 17:00 以降の 4 枠は横スクロールで見る。
  空き枠の**計算**は表示窓ではなく営業時間全体（18 枠）で行う（§4.2）。
  **決定: 14 枠を表示窓にし、残り（17:00 以降の 4 枠）は横スクロールで見る。**承認済みの LEDGER-STAFF /
  LEDGER-WALKIN / LEDGER-DETAIL の 3 面がいずれも 10:00–16:30 の 14 列しか描いておらず、18 枠を 1194px に
  詰めると 1 枠 57px となって 30 分帯の文字予算（`design/05-screen-flow.md` §4.4）が成り立たないため。

**有効高の段**（幅とは独立に決める。§4.1 の「1 画面 2 本」の予算とは別の話）

| 有効高 | 台帳 | ウォークインの行 | 出どころ |
|---|---|---|---|
| 760px 以上 | モックどおり全行を出す | 最下段にそのまま置く | standalone（`834 − ステータスバー 24 = 810`）が入る段 |
| 640–759px | 台帳の本体を縦スクロールにし、`.tt-head`（時刻の見出し行）を `position: sticky; top: 0` で残す | 最下段に `position: sticky; bottom: 0` で貼る | Safari のタブのまま（`810 − chrome 40〜90 = 720〜770`）が入る段 |
| 640px 未満 | タイムテーブルをやめて**予約リスト表示**（LEDGER-LIST）に倒す | 一覧の先頭に混ぜる | Stage Manager の小さい窓 |

- モックは 1194×834 の枠でも最下段「ご来店お待ち」が枠の下で切れている（`.tt { height: 100%; overflow: hidden }`）。
  実装は `overflow: hidden` を引き継がず、上の段に従って縦スクロールか差し替えに落とす。
- e2e はこの段ごとに project を持つ（§12）。1194×834 の 1 本だけでは、狭いときに壊れるレイアウトを素通しする。

**ソフトキーボードが出たとき**

- iPad 横向きの日本語キーボードは **340〜400pt**（画面の 4〜5 割）を覆う。`position: fixed; bottom: 0` は
  iOS Safari ではキーボードの下へ潜るので使わない。
- `visualViewport` の `resize` / `scroll` を見て、`.stepbar`（76px。左端の `‹`・「次へ進む」の `›`・録音の印）と
  `.rec-float` / `.float` を `visualViewport.height` の底へ貼り直す。
- 焦点の当たった入力欄は `scrollIntoView({ block: 'center' })` で持ち上げる。
- テンキーの面（BOOK-04c-KEYPAD / CUSTOMER-NEW）はソフトキーボードを出さない（§2.2）。

### 1.3 文字を大きくしたとき

| 項目 | 要件 |
|---|---|
| 基準 | ルート 16px = 1rem。モックの px はすべて rem に翻訳する（16px→1rem、13px→0.8125rem、22px→1.375rem） |
| 上限 | **ページ拡大 200% で情報も機能も失われない**（WCAG 2.2 AA 1.4.4） |
| 横スクロール | 200% で `body` に横スクロールを出さない。溢れる要素（台帳・分析のグラフ・幅の広い表）は**その要素の中だけ**を `overflow-x: auto` にする |
| 折り返し | 200% で行が入らないときは折り返す。切り詰め（`…`）はしない。ただし mono で書く時刻・予約番号・電話番号は折り返さない（`white-space: nowrap`） |
| 触れる大きさ | 拡大後も §2.1 の最小寸法を下回らない。`min-height` は rem で書く |
| 台帳の時間軸 | 文字だけ拡大し、**枠の列幅は拡大しない**。列幅を拡大すると表示窓の 14 列（10:00–17:00）すら画面から出て、空き枠を「置き場所」として読めなくなる |

**決定: 375px（Split View 1/3）でも予約フロー 5 工程を最後まで完了できることを要件にする。**専用の画面は作らず、
`design/05-screen-flow.md` §7.4 の落とし方（stepbar は現在の工程 1 枚 + `…`、`.popover` は下から出るシート、
`.split` は 1 カラム）でそのまま通す。e2e の `ipad-split`（375×744）project で 5 工程を 1 本通す（§12）。

---

## 2. Apple HIG とアクセシビリティ

### 2.1 触れる大きさ

**下限は 44pt**（WCAG 2.5.8 / HIG）。モックの実測は 2 群に分かれる。

**(a) モックの実測がそのまま下限になるもの**（実装はこの値以上にする）

| 対象 | 実装値 | 出どころ（実測） |
|---|---|---|
| すべての操作の下限 | **44pt** | `.navtoggle` 44 / `.datepill` と `.datepill button` 44 / `.pen` 44 / `.wchip` 44（LEDGER-WALKIN） |
| 一般のボタン（`.btn`）・アプリバーの補助操作（`.barbtn`） | 48pt | `assets/eyex.css` `.btn { min-height: 48px }` / `.barbtn { min-width: 60px; min-height: 48px }` |
| サイドバーの行き先（`.nav-item`） | 46pt（柱のときは 52×52） | `.nav-item { min-height: 46px }` / `.sidenav.rail .nav-item { width: 52px }` |
| サイドバーの「予約を取る」（`.sidenav .new`。＋ はアイコン） | 52pt | `.sidenav .new { min-height: 52px }` |
| アプリバーのホームボタン | 48pt | `.homebtn 48×48` |
| 工程を進める大きな主操作（`.btn.big`） | **56pt** | `assets/eyex.css` `.btn.big { min-height: 56px }` |
| ポップオーバー・パネルのフッターの主操作 | 52pt | LEDGER-DETAIL `.popover .pf .btn.primary { min-height: 52px }`（同フッターの副操作は 46pt） |
| テンキーのキー（PIN・電話番号） | **72pt**（幅 96pt） | `assets/eyex.css` `.key { height: 72px }` / `.keypad { grid-template-columns: repeat(3, 96px) }` |
| ウォークインの受付ボタン（FAB） | 64pt | `.fab 64×64` |
| 隣り合う操作の間隔 | 8pt 以上（例外は下記） | `.chips { gap: 8px }`（EX-EMPTY-SEARCH / LEDGER-WALKIN / CHANGE-SEARCH）／`.picks { gap: 10px }`（WEB-02-PURPOSE / LEDGER-WALKIN） |

**(b) モックが 44pt を割っているので、実装で当たり判定だけを広げるもの**

見た目の高さは承認済みなので**変えない**。`padding` を足すか、透明な擬似要素（`::before { inset: -Npx }`）で
**当たり判定だけ**を 44pt へ広げる。行ごと押せる形にできるものは行全体を当たり判定にする。

| 対象 | モックの実測 | 実装の当たり判定 | 出る画面 |
|---|---|---|---|
| `.segmented button`（台帳の並べ方・表示のかたち） | **38px** | 44pt（見た目 38px のまま `padding` で広げる） | LEDGER-STAFF / LEDGER-RESOURCE / LEDGER-LIST / LEDGER-DETAIL / LEDGER-WALKIN / CUSTOMER-LIST / RECEPTION-JOURNEY / BOOK-03b（8画面。per-screen の上書きは 0 件） |
| `.datepill .today`（上のバーの「本日」） | **28px** | 44pt。地が `--color-pine` なのでフォーカスは `--color-focus-on-pine`（§2.2） | LEDGER 5面 + EX-OFFLINE |
| `.step`（工程の札） | **36px** | 押せる形にするなら 44pt。押せない形にするなら操作対象にしない（§2.3 で `<ol>` に決めた） | BOOK-01〜05 / 02b / 03b / 03c / 04b〜04d / BOOK-CONFLICT / CHANGE-DATETIME |
| `.toggle`（設定の切り替えつまみ） | **51×31px** | つまみは見た目のまま。**行全体（52pt）を押せる**ようにし、`role="switch"` + `aria-checked` を行に持たせる（§2.3） | SETTINGS-EQUIPMENT / SETTINGS-WEB / SETTINGS-HOURS ほか設定7面 |

pt と px は等倍（1194×834pt = 1194×834 CSS px）で一致するため、実装では px で書いて構わない。
`.key` / `.keypad` / `.btn` / `.btn.big` / `.nav-item` / `.fab` / `.homebtn` / `.segmented button` / `.step` /
`.toggle` / `.datepill .today` は `assets/eyex.css` の定義、`.wchip` / `.picks` / `.chips` / `.popover .pf` は
各画面 HTML の `<style>` の定義である。

**「間隔 8pt 以上」の例外**: 分析のタブ（`.tabs { gap: 4px }`、ANALYTICS 5面）だけが 4px である。
`.tab` 自身が 46pt あって取り違えにくいので**モックのまま 4px を許す**。ほかの場所で 8pt を割らない。

### 2.2 フォーカスと操作順

| 項目 | 決め |
|---|---|
| フォーカスリング（白・下地・薄い緑の面） | `:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px }`。`outline: none` を書かない。共有部品は `@app/ui` の `focusRing` |
| フォーカスリング（緑の面の上） | 地が `--color-pine` / `--color-pine-deep` の操作（アプリバーの `⌂`・`.barbtn`・`.datepill` と その中の `‹ › 本日`、`bg-pine` 塗りの主操作）は **`--color-focus-on-pine`**（白。緑の上で 6.00:1）。`--color-focus`（`#0a63c4`）は緑の上で **1.03:1** になって消える。共有部品は `focusRingOnPine`（`packages/ui/src/components.tsx`） |
| 消さない条件 | ポインタ操作でも `:focus-visible` の判定だけに任せる。JS でフォーカスを奪ってリングを消さない |
| DOM 順 = 見た目の順 | アプリバー → サイドバー → 本文 → 常駐する録音の印。`position: absolute` で置いた `.days`（日付の帯）・`.rec-float`・`.panel` は **DOM でも本文の後ろ**に置く |
| tabindex | `0` と `-1` だけを使う。正の値を書かない |
| モーダル（背後を操作させない） | 対象は **HOME-SHARED-LOCKED のロック面（`.veil` + `<section class="lock" aria-label="お客様の情報を隠しています">`）と、幅 375px 以下で本文を覆う overlay のサイドバー（`design/05-screen-flow.md` §7.4）の 2 つだけ**。`role="dialog"` + `aria-modal="true"` を付け、開いた瞬間に見出しへフォーカスを移し、閉じるまで背後へタブを出さない。Esc で閉じ、閉じたら開いた要素（`.navtoggle`）へフォーカスを戻す |
| BOOK-04b の候補（**モーダルにしない**） | 電話番号を打っている途中に出る逐次検索の候補なので、**フォーカスを移さない**（移すと残りの桁が打てない。WCAG 3.2.2）。入力欄を `role="combobox"` + `aria-expanded` + `aria-controls`、候補一覧を `role="listbox"` / `role="option"`（APG の combobox パターン）にし、件数は `role="status"` で「2件見つかりました」と読ませる。下矢印で候補へ降り、Esc で候補だけを閉じる。外側タップでも候補だけを閉じ、入力値は消さない。**`aria-modal="true"` を付けない** — 付けると常駐の録音表示（`.rec-float`、`role="status"`。読み上げ順 5、本文の外）がアクセシビリティツリーから外れ、録音が失敗した瞬間の知らせ（§5.6）が読まれなくなる |
| 非モーダルの脇のペイン（背後を見たまま操作する） | 対象は **LEDGER-DETAIL の予約詳細（`<section class="popover" aria-label="予約の詳細">`）と LEDGER-WALKIN の受付パネル（`<aside class="panel" aria-label="店頭のお客様の受け付け">`）**。台帳を見失わないための面なのでフォーカスを閉じ込めない。`role="region"` + `aria-label` にし、開いたら先頭の見出しへフォーカスを移す |
| 非モーダルの閉じ方（指でも閉じられる） | LEDGER-DETAIL は**閉じる手が 3 つ**ある。①ペインの外側（台帳の空きセル）を 1 回タップ ②Esc ③開いた帯をもう一度押す。どの経路でも**元の帯へフォーカスを戻す**。外側タップの 1 タップは**台帳側の操作として扱わない**（閉じるだけで、新しい予約を起こさない）。LEDGER-WALKIN は 44pt の「やめる」を持つのでそれに加えて ②③ を持つ。物理キーボードを持たない共有 iPad で Esc しか出口が無い面を作らない |
| Esc を押したときの優先順位 | 手前から順に 1 つだけ閉じる。①モーダル（ロック面・overlay サイドバー）②候補の一覧（BOOK-04b）③非モーダルの脇のペイン（LEDGER-DETAIL / LEDGER-WALKIN）。同時に 2 つ閉じない |
| テンキー | 欄は `readOnly` にせず **`inputMode="none"`** で置く（ソフトキーボードを出さないが、フォーカスと物理キーボードは生きる）。数字キー・Backspace・Enter は `keydown` で自前に拾い、画面のキーと同じ結果にする。**この行は残す** — 共有 iPad に Magic Keyboard を付ける店舗があっても壊れない作りにするほうが、運用を聞いて分岐させるより安い（`inputMode="none"` は物理キーボードを塞がない）。 |
| ハードウェアキーボード | Magic Keyboard を接続したときのショートカットは**持たない**（`Esc` の閉じるだけ）。台帳をキーボードでたどる手段は §2.3 の台帳の role の決めに従属するので、そこが決まるまで作らない |
| 台帳のドラッグ | ドラッグは代替を必ず持つ。帯を選んで「時間を変える」から時刻を選ぶ経路で同じ結果に到達できる（WCAG 2.5.7 相当） |

### 2.3 VoiceOver の読み上げ順とランドマーク

**この節がアクセシビリティの正本である。**`design/05-screen-flow.md` §7.6 は同じことを画面の言葉で言い直したもので、
食い違ったらこちらを採る。`design/01-requirements.md` §13-8 が「読み上げ順・文字を大きくしたとき・Split View は未解決」
としているのは古く、§1.2 / §1.3 / この節で解決済みである。

ランドマークは **`<header>`（アプリバー）/ `<nav aria-label="画面の切り替え">`（サイドバー）/ `<main>`（本文）/
`<aside>`（右の要約）の 4 つ**を各画面に 1 つずつ置く。工程バーは `<nav>` にしない（下記）。

読み上げ順は DOM 順と同じにする。画面ごとの並びは次で固定する。

| 順 | 業務画面 | 例外 |
|---|---|---|
| 1 | アプリバー（店舗名 → 営業状態 → 操作者 → お知らせ件数 → 補助操作） | — |
| 2 | サイドバー `<nav aria-label="画面の切り替え">`（現在地は `aria-current="page"`） | 予約フロー・ログイン系はサイドバーを持たない |
| 3 | 本文の主役（`<h2>` または `.ask h2`）→ 選択肢 → 入力 → 主操作 | — |
| 4 | 右ペイン（要約・候補・プレビュー） | — |
| 5 | 常駐の録音表示（`.rec` / `.rec-float`、`role="status"`） | マイクが使えないときは「録音していません」を同じ場所で読む |

- 装飾の記号（`☎` `✎` `⌂` `●` `›`、サイドバーのアイコン、来店回数の色）は `aria-hidden="true"` にする。
- 意味を持つ図は `role="img"` + `aria-label` を付け、**モックの文言をそのまま使う**。
  - Web 予約の進捗 `.webprogress`: モックが既に `role="img"` を持つ。文言は「全6ステップのうち1つ目です」〜
    「全6ステップのうち5つ目です」「全6ステップが終わりました」、WEB-CANCEL だけ「2つの手順のうち2つ目です」。
  - PIN の残り試行 `.tries`（LOGIN-PIN-ERROR）: モックは `aria-label="お試しの残り　3回のうち1回を使いました"` だけで
    role を持たない。role の無い要素の `aria-label` は読まれないので、実装で `role="img"` を足す。
  - 分析のグラフ（ANALYTICS-TOP / COUNT / WAIT / CANCEL）と手書きメモ（BOOK-04d / CUSTOMER-HANDWRITE）も
    モックが `role="img"` + `aria-label` を持つ。値が変わったら `aria-label` も同じ値で作り直す。
  - PIN の入力状態 `.pins`（MODE-PERSONAL）は `role="group"` + `aria-label="暗証番号　6桁のうち2桁を入力済み"`。
- 工程バー（`.stepbar` の `.steps`）は **`<ol>`** にする。モックの実体は押せない `<span class="step">` なので
  `<nav>` にすると VoiceOver のローターに「ナビゲーション」として現れるのに移動先が無い。
  一覧に `aria-label="予約の工程　全5工程"`、現在の札に `aria-current="step"` を付ける。
  工程を戻る手段は左端の `.back`（48pt）だけである。押せる札にするなら `<button>` にして
  当たり判定を 44pt へ広げる（§2.1(b)）が、モックは押せない形なので**押さない形を採る**。
- 設定の切り替えつまみ（`.toggle`）はモックでは `<span class="toggle on" aria-hidden="true">` だが、
  実装では必ず操作になる。**`aria-hidden="true"` のまま持ち込まない**。行全体（52pt）を
  `role="switch"` + `aria-checked` にし、行のラベル（「いま使える」）をアクセシブル名にする。
- 台帳の時間グリッド（`.tt-grid`）に何の role を持たせるかは**まだ決まっていない**。
  `.tt-grid` は CSS grid（`grid-template-columns: 170px repeat(14, 1fr)`）であって `<table>` の DOM ではないので、
  `role="table"` を名乗るなら**全子孫に `role="row"` / `columnheader` / `rowheader` / `cell` を明示**しないと
  ツリーが壊れる。加えて解けていないのは、①帯が 2 列以上にまたがる（田中 花子 様 11:00–12:00）ときの `aria-colspan`
  ②空セル（14列 × 5行 = 70）の埋め方 ③全列にまたがる「ご来店お待ち」の行 ④現在時刻の赤い縦線 ⑤帯の `aria-label` を
  2 セルに置くと 2 回読まれること、の 5 点である。
  **決定: `role="grid"`（roving tabindex + 矢印キーで格子を移動できる形）にする。**帯を指で運ぶ操作（BOOK-03c）に
  キーボード等価が要り、読むだけの `role="table"` ではその等価を持てないため。**Tab は 1 回で台帳を通り抜ける**
  （格子の中の移動は矢印キーが受け持つ）。上の 5 点はこう決める。
  ① 2 列以上にまたがる帯は**先頭セルにだけ置き**、`aria-colspan` で幅を伝える（両方のセルに置くと 2 回読まれる）。
  ② 空セルは `role="gridcell"` を持たせ、`aria-label` に「10:30　佐藤 美咲　空いています」を入れる。
  ③ 全列にまたがる「ご来店お待ち」は時間軸に載せず、`aria-colspan` を列数いっぱいに取った 1 セルの行として
     **最下段に固定**する（行見出しに待ち人数「2名」を出す。`design/05-screen-flow.md` §4.4）。
  ④ 現在時刻の赤い縦線は `aria-hidden="true"`。時刻は `.toolbar` の `.nowchip`（`role="status"`）が文字で持つ。
  ⑤ 帯の `aria-label` は「11:00から12:00　田中 花子 様　メガネを新しく作る　佐藤 美咲」の順で読ませる。
  モックで `role="table"` が付いているのは RECEPTION-JOURNEY の `.jgrid`（`aria-label="来店受付ボード　お客様ごとの工程"`）だけである。
- **モックから写すのは `role="img"` / `aria-label` / `aria-hidden` の文言だけ**にする。モックには紙を再現するための
  偽物の role があり、そのまま実装へ持ち込まない — `role="radio"` が `radiogroup` の外の `<span>`（ANALYTICS-COUNT に 6 個）は
  `<fieldset>` + `<input type="radio">` に、`role="textbox"` が `contenteditable` も `tabindex` も無い `<div>`
  （BOOK-04-CUSTOMER / BOOK-04b に計 8 個）は `<input>` / `<textarea>` に置き換える。
- 変化を読み上げる場所は `role="status"`（`aria-live="polite"`）に限る。**次の 7 か所だけ**が live で、これ以外を live にしない。
  ① 常駐の録音表示（`.rec` / `.rec-float`）② 検索・絞り込みの 0 件 ③ 重複候補の件数（BOOK-04b「2件見つかりました」）
  ④ 通信断・失敗の帯（EX-OFFLINE の `.band`）⑤ 空き枠の再計算が終わったこと（`design/05-screen-flow.md` §7.1）
  ⑥ 枠の仮押さえの残り時間の警告（§2.8）⑦ 縦向きの案内（§1.1）。
  ①〜④はモックが実際に持っている 4 か所、⑤〜⑦は実装で足す。
- 通信断・失敗の帯は `role="status"` にとどめ、`role="alert"`（assertive）にしない。
  接客中に読み上げが割り込むと会話が切れる。入力欄 1 つに対するその場のエラー（`Field` の項目エラー）だけは
  `role="alert"` でよい。取り消しの確認だけ `role="alertdialog"` にする。

### 2.4 色だけに意味を持たせない

| 意味 | 色 | **必ず添える文字** | 出どころ |
|---|---|---|---|
| Web 予約 | `--color-web` | 「Web予約」 | LEDGER / EX-OFFLINE |
| ウォークイン | `--color-walkin` | 「ウォークイン」「店頭」 | LEDGER-WALKIN |
| 電話・店頭の予約 | `--color-pine` | 「お電話」「店頭」 | EX-OFFLINE |
| 分析のグラフの系列 | `--color-pine` / `--color-danger` ほか | **系列名を棒・線に直接添える**（凡例の色だけに頼らない）。凡例の四角（`.legend i` 14×14px）にも地模様（斜線・点）か形の違いを与える | ANALYTICS-WAIT の「目安の内 / 目安を超えた時間帯」 |
| 取消・警告 | `--color-danger` | 「対応が必要」「取り消し」 | ALERTS / CHANGE-CANCEL |
| 埋まっている枠 / 空いている枠 | `--color-busy` / `--color-free` | 「満」「ここに入ります」 | WEB-03 / LEDGER-WALKIN |
| 定休日 | `--color-ink-faint` | 「休」「定休」 | SETTINGS-CALENDAR / WEB-03 |
| 来店回数 | 薄い緑 / 薄い橙 | 「4回目」「初めて」 | `.visits` |

- 縦罫そのものは 1.4.11 を満たしている（`--color-danger` は白地 **7.57:1**）。足りないのは**意味の伝え方**だけである。
- **決定: 未読には「未読」の札を足す。**モックの 3 件は左の赤い縦罫だけで未読を示しており、色を見分けにくい目には
  何も伝わらない。承認済みモックとの差は §8 の突き合わせで既知差分として扱う（`design/05-screen-flow.md` §8）。
- **決定: 台帳の赤い帯は「担当が未定」以外の意味を持たない。**根拠は LEDGER-STAFF の赤い帯（相川 みどり 様）が
  行見出し「担当が未定／あとで決める」の行にあり、帯の中にも「担当が未定」と書いてあること、EX-OFFLINE の
  同じ予約の担当欄が「決めてください」であること。色だけに意味を持たせないので、赤い帯には必ずこの文字を添える。
- **決定: 台帳の帯に出どころの語を書くのは Web予約（青）とウォークイン（茶）だけで、緑の帯には「お電話」「店頭」を
  出さない。**緑は既定なので、語を持たなくても色だけに意味が乗らない（LEDGER-STAFF の緑の帯 5 本はどれも語を持たない）。
  出どころの 4 語（**お電話 / 店頭 / Web予約 / ウォークイン**。EX-OFFLINE の予約リストがこの 4 語を出し分けている）は
  リスト（EX-OFFLINE）と詳細（LEDGER-DETAIL）で文字にする。30 分帯に 1 行足すと文字予算を超える。
| 未読のお知らせ | 左の赤い縦罫（`.item.unread { border-left: 4px solid var(--alert) }`） | `article` の `aria-label` の先頭に「未読」を置く。**それだけでは足りない** — `aria-label` はスクリーンリーダー利用者しか救わず、色覚差のある目で見ている人には何も足されない。ALERTS の 3 件のうち文字の手がかりを持つのは「対応が必要」タグの 1 件だけで、残り 2 件は色だけである | ALERTS |

### 2.5 コントラスト（`packages/ui/src/theme.css` の実装値で実測。2026-08-28）

決定ブリーフ **§12.1** で、モックの画像は変えずに**実装のトークンだけ**を色相・彩度を保ったまま暗くした。
下の比はすべてその実装値で計算したもので、モックの旧値（`#7d8b85` / `#b6c2bc` / `#9cc4b6`）ではない。

**(a) 白・下地・薄い色の地の上**

| 前景 | 地 | 比 | 判定 |
|---|---|---|---|
| `--color-ink` `#16211d` | `#ffffff` | 16.54:1 | AA / AAA |
| `--color-ink-muted` `#566761` | `#ffffff` | 5.99:1 | AA |
| `--color-ink-muted` `#566761` | `--color-paper` `#f1f4f2` | 5.40:1 | AA |
| `--color-ink-faint` `#626e69`（§12.1 で暗くした） | `#ffffff` | **5.31:1** | AA |
| `--color-ink-faint` `#626e69` | `--color-paper` `#f1f4f2` | **4.80:1** | AA |
| `--color-ink-faint` `#626e69` | `--color-surface-2` `#e9eeeb` | **4.53:1** | AA |
| `--color-pine` `#17705a` | `#ffffff` | 6.00:1 | AA |
| `--color-on-pine` `#ffffff` | `--color-pine` `#17705a` | 6.00:1 | AA（アプリバーの白文字） |
| `--color-on-pine` `#ffffff` | `--color-pine-deep` `#0f5645` | 8.62:1 | AA |
| `--color-pine-deep` `#0f5645` | `--color-pine-soft` `#e4f0eb` | 7.37:1 | AA |
| `--color-pine` `#17705a` | `--color-pine-soft` `#e4f0eb` | 5.13:1 | AA |
| `--color-danger` `#97302b` | `#ffffff` | 7.57:1 | AA |
| `--color-danger` `#97302b` | `--color-danger-soft` `#fbe9e7` | 6.46:1 | AA |
| `--color-web` `#1c5c8c` | `--color-web-soft` `#e6eef5` | 6.05:1 | AA |
| `--color-walkin` `#9a5a15` | `--color-walkin-soft` `#fbeedd` | 4.78:1 | AA（余裕が小さいので値を変えない） |
| `--color-amber` `#7a5415` | `#ffffff` | 6.76:1 | AA |
| `--color-amber` `#7a5415` | `--color-amber-soft` `#fff6e5` | 6.30:1 | AA |
| `--color-focus` `#0a63c4` | `#ffffff` / `--color-paper` / `--color-surface-2` | 5.84 / 5.28 / 4.98:1 | 非テキスト 3:1 を満たす |
| `--color-line-strong` `#778d82`（§12.1 で暗くした） | `#ffffff` / `--color-paper` / `--color-surface-2` | **3.55 / 3.20 / 3.02:1** | 非テキスト 3:1 を満たす |
| `--color-pine-line` `#58947f`（§12.1 で暗くした） | `#ffffff` / `--color-pine-soft` | **3.53 / 3.02:1** | 非テキスト 3:1 を満たす |
| `--color-line` `#d3dbd7` | `#ffffff` | 1.41:1 | 3:1 未満。**仕切りとしてだけ使う**（1.4.11 の対象外） |
| `--color-grid-hour` `#cbd5d1` | `#ffffff` | 1.50:1 | 3:1 未満。同上 |

**(b) 台帳の地の上**（§2.5 の旧版は白地しか見ていなかった。台帳には 7 種の地がある）

| 前景 | `--color-busy` `#cdd5d1` | `--color-grid` `#e7ecea` | `--color-grid-hour` `#cbd5d1` |
|---|---|---|---|
| `--color-ink` | **11.06** ○ | 13.85 ○ | 11.01 ○ |
| `--color-pine-deep` | **5.76** ○ | 7.21 ○ | 5.73 ○ |
| `--color-danger` | **5.06** ○ | 6.34 ○ | 5.04 ○ |
| `--color-web` | 4.74 ○ | 5.94 ○ | 4.72 ○ |
| `--color-ink-muted` | **4.00** ✕ | 5.01 ○ | **3.98** ✕ |
| `--color-pine` | **4.01** ✕ | 5.02 ○ | 3.99 ✕ |
| `--color-walkin` | **3.65** ✕ | 4.57 ○ | 3.63 ✕ |
| `--color-ink-faint` | **3.55** ✕ | 4.45 ✕ | **3.54** ✕ |
| `--color-line-strong`（縁。3:1 が要る） | **2.37** ✕ | 2.97 ✕ | **2.36** ✕ |
| `--color-pine-line`（縁。3:1 が要る） | **2.36** ✕ | 2.95 ✕ | **2.35** ✕ |

守る決め:

1. **本文 16px は 4.5:1 以上、22px 以上の見出しは 3:1 以上**を必ず満たす。上の表にない組み合わせを作らない。
2. `--color-ink-faint` はプレースホルダに使ってよい。§12.1 で `#7d8b85`（3.56:1）から `#626e69`（**5.31:1**）へ
   暗くしてあり、白・下地・見出し行のいずれの地でも 4.5:1 を満たす。**共有部品で薄めない**
   （`placeholder:text-ink-muted/70` のような不透明度を掛けると 3.10:1 まで落ちる）。
3. **入力欄・ボタン・選べる札の縁は `--color-line-strong`**（3.55:1）にする。`--color-line`（1.41:1）は
   仕切りの罫にだけ使う。入力欄は塗りも地も白で、**縁だけが「ここが入力欄」を伝える**ので 1.4.11 の 3:1 が要る。
4. **`--color-busy` / `--color-grid-hour` の上に載せてよい文字は `--color-ink` / `--color-pine-deep` /
   `--color-danger` / `--color-web` の 4 つだけ**。時間グリッドの上の補足に `--color-ink-muted` を使わない。
   同じ地の上に「選べる札」を置くときは、縁だけで示さず塗りと文字でも示す（縁は 2.35〜2.37:1 にしかならない）。
   **決定: 文字を濃くするのではなく、地を明るくして解決する。**枠そのものの色は `--color-busy` のまま保ち、
   帯の中だけ `--color-busy-soft`（`#e4e9e6`）を敷いて、文字は `--color-ink-muted`（4.5:1 以上）にする。
   文字を `--color-ink` まで濃くすると埋まった枠が空き枠より目立ち、「置ける場所を探す」という台帳の役目が壊れるため。
   `--color-busy-soft` は §3.2 に足す。
5. 罫線と時間グリッドは**単独で情報を伝えない**。操作できるものは必ず 44pt 以上の面と文字ラベルを持ち、
   時間の位置は見出し行の文字（`10:00` `11:00` …）で読める。
6. 分析のグラフの系列は**色で見分けられない**（`pine` vs `danger` = 1.26:1、`pine` vs `pine-line` = 1.70:1、
   `pine` vs `walkin` = 1.10:1、`walkin` vs `danger` = 1.39:1）。§2.4 のとおり、位置か文字で見分けさせる。

### 2.6 モーション

`assets/eyex.css` と 68 画面の `<style>` は `transition` / `animation` / `@keyframes` を**1つも持たない**（実測 0 件）。
`docs/frontend/DESIGN_RULE.md` の「モーションは1箇所のオーケストレーションだけ」に従い、
**実装で足してよい動きは次の 2 つだけ**とする。モックにこの 2 つの記述は無く、直接操作の手ざわりのために足す。

| 箇所 | 動き | `prefers-reduced-motion: reduce` のとき |
|---|---|---|
| 台帳・予約フローで予約の帯をつかんで動かす（`.grip` / `.ghost`） | 指に追従。離した枠へ 120ms で吸着 | 追従は残す（直接操作なので止めない）。吸着の補間を 0ms にして即座に置く |
| 共有端末の自動マスク（`.veil` + `.lock`） | 160ms のフェードイン | フェードなしで即座に出す |
| 幅 375px 以下でシートに置き換わる面（`.popover` → 下から出る全幅のパネル。`design/05-screen-flow.md` §7.4） | 下から 200ms で出る | 移動なしで即座に出す |

これ以外の場所に `transition` を書かない。ページ遷移・カードの出現・数値のカウントアップは作らない。

### 2.7 `docs/frontend/DESIGN_RULE.md` の NEVER 表との関係

承認済みモックは DESIGN_RULE の NEVER 表を 2 か所で正面から破っている。どちらも
「Apple HIG に従う iPad 業務アプリ」という題材からは正当化できるが、**DESIGN_RULE からの逸脱は
AGENTS.md ルール 10 の人間承認事項**である。記録が無いままだと、後続の実装者や `/simplify` が
「規約違反だから直す」と判断して承認済みの見た目を壊す。

| NEVER | モック・本書の実態 | 機能上の理由 |
|---|---|---|
| カード上辺／左辺の 3–4px 色ストリップ | `.appt { border-left: 4px solid var(--brand) }`（**すべての予約の帯**）／`.item.unread` の左 4px（§2.4）／`.card.warn.lead` の左 6px（`design/05-screen-flow.md` §6） | 台帳で予約の出どころ（電話・Web・ウォークイン・要対応）を 30分枠の中で読むための機能。塗りだけでは 4 種を見分けられない |
| 素の system-ui を主書体に／2 役割以上の書体 | `--font-display` は `--font-sans` と同一文字列。決定ブリーフ §12.2 で Web フォントを配らないと確定済みなので、書体は iPadOS の既定（SF / ヒラギノ）だけ | HIG。iPad では自己ホストのフォントより system 書体が先に当たるため、配っても無駄になる |

**決定: 上の 2 件は DESIGN_RULE の NEVER 表からの免除として扱い、`docs/frontend/mockups/eyex/README.md` に
台帳化する**（DESIGN_RULE §6 の「却下されたデザイン方向を台帳化する」に倣う）。台帳化しないと、後続の実装者や
`/simplify` が「規約違反だから直す」と判断して承認済みの見た目を壊す。免除の範囲は上の表の 2 行に限り、
新しい色帯・新しい書体をこれを根拠に足さない。

### 2.8 時間制限（WCAG 2.2.1）

このサービスは時間で切れるものを 5 つ持つ。**制限ごとに「免除（essential）を主張する」「警告を出す」
「延長させる」のどれかを必ず決める。**何も決めないまま置かない。

| 制限 | 値 | 切れると | 2.2.1 に対する答え |
|---|---|---|---|
| 枠の仮押さえ | 420 秒（§10.3） | 他端末がその枠を取れる | **警告 + 延長**。残り 60 秒で `role="status"` の帯「この枠をあと1分お預かりしています」と 44pt の「まだ入力中です」を出す。押すと 420 秒を取り直す（10 回まで）。押されないまま切れたら BOOK-CONFLICT へ落とす |
| 端末の自動ロック | 120 秒（§6.4） | 画面を伏せる | **免除（essential）を主張する**。共有端末の画面にお客様の氏名・電話番号が出たままになるのを防ぐための制限で、延長できてしまうと目的が成り立たない。§6.4 の判定に読み上げ操作を数える（下記） |
| 個人モードの寿命 | 120 秒（§6.4） | 共有モードへ戻る | 同上（免除） |
| 録音の再生チケット | **900 秒**（§6.5） | 401 | **免除（essential）**。再生を始めたあとは切れない（1 回の再生セッション分だけ有効）。300 秒だとモック最長の録音（6 分 12 秒 = 372 秒）を 1 回も聞き通せないので 900 秒にした |
| Web 予約の短命管理コード | 900 秒（§6.4 の KV） | 401 | **免除（essential）**。本人確認の有効期限そのもの |

`[要確認: Q-06 — いまの前提で進める]`（接客の途中で時間切れになってよいものはどれか。WCAG 2.2 AA 2.2.1 の
「必須（essential）」免除をどこまで主張してよいか。伏せる判定に VoiceOver のフォーカス移動を数えるかも同じ問いで、
数えないと 14列 × 5行の台帳を読み上げている最中に伏せられる。いまの前提は上の表のとおり
（自動ロックと個人モードは免除、仮押さえは警告 + 延長）。§13 の #2）

### 2.9 入力の型と日本語入力

**業務面（共有 iPad）と Web 予約面（お客様の端末）で方針が逆**である。Web 予約はオートフィルを積極的に効かせ、
業務面は前のお客様の値を候補に出さないために切る（§6.6「共有端末では次の利用者が読めてしまう」と同じ理由）。

| 欄 | 業務面（BOOK-04-CUSTOMER / 04c / CUSTOMER-NEW） | Web 予約面（WEB-04-FORM） |
|---|---|---|
| お電話番号 | `type="tel"` + `inputmode="numeric"` + `autocomplete="off"` | `type="tel"` + `inputmode="numeric"` + `autocomplete="tel"` |
| お名前 | `autocomplete="off"` | `autocomplete="name"` |
| ふりがな | `autocomplete="off"` | `autocomplete="off"`（自動入力の対象。§7.7） |
| メール | `type="email"` + `inputmode="email"` + `autocomplete="off"` | `type="email"` + `inputmode="email"` + `autocomplete="email"` |
| テンキーで打つ欄（BOOK-04c / PIN） | `inputMode="none"`（§2.2） | — |
| `enterkeyhint` | 工程の途中の欄は `next`、その工程の最後の欄は `done` | 同じ |

**日本語入力（IME）の変換確定中は値を読まない。**

- `compositionstart` 〜 `compositionend` の間、`input` イベントの値を**読まない**。読むと「たなか」を変換している
  最中の未確定文字列がふりがな欄へ流れ込み、確定と同時に上書きが起きる。電話番号からの候補検索（BOOK-04b）も
  1 文字ごとに飛ぶ。
- ふりがなは `compositionend` で 1 回だけ埋める。**人が一度でも触れた欄は二度と上書きしない**（§7.7）。
- iPadOS のかなキーボードには予測変換の直接確定で `compositionend` が来ない経路があるので、
  `change`（blur）でももう 1 回拾う二段構えにする。

**手書き（BOOK-04d-HANDWRITE / CUSTOMER-HANDWRITE）**

- Pointer Events で受ける。`pointerType === 'pen'` が接触している間は `pointerType === 'touch'` のイベントを捨てる
  （手のひらの誤爆を防ぐ）。
- `.canvas` に `touch-action: none` を入れる。入れないと、本文のほぼ全面を占めるキャンバスの上を指で滑らせたときに
  本文がスクロールする。
- 筆圧（`pressure`）は**使わない**（線の太さを一定にする。指と Apple Pencil で見た目を変えない）。
- キーボードだけで使う人への代替は、BOOK-04-CUSTOMER が既に持つ「キーボードで入力」（`.btn.quiet` 48pt）である。
  これが WCAG 2.1.1 の充足根拠になる（`design/05-screen-flow.md` §7.6 が決めているのは出力側の `role="img"` だけ）。

---

## 3. デザイントークン

### 3.1 唯一の出どころ

- 色・書体・角丸・**余白**は **`packages/ui/src/theme.css` のセマンティックトークンだけ**を通す。
- モックの生 hex（`#17705a` など）と px を React / Tailwind に直接書かない。
- Tailwind 既定パレット（`bg-blue-500`）と任意値（`p-[13px]` / `text-[#hex]`）は禁止。
- 新しい色が要るときは、**theme.css にトークンを足してから**使う。理由をコメントで残す。

### 3.2 トークンの一覧（`packages/ui/src/theme.css` の実装値。実測 2026-08-28）

出どころは `docs/frontend/mockups/eyex/assets/eyex.css` の `:root` と決定ブリーフ §10。
ただし **3 色は決定ブリーフ §12.1 で実装だけを暗くしてある**（モック画像は直さない）。備考にその旨を書いた。

| トークン | 値 | 役割 |
|---|---|---|
| `--color-paper` | `#f1f4f2` | 画面の下地 |
| `--color-surface` | `#ffffff` | カード・入力・セル |
| `--color-surface-2` | `#e9eeeb` | 見出し行・左ペイン・サイドバー |
| `--color-line` | `#d3dbd7` | 罫線 |
| `--color-line-strong` | `#778d82` | 押せるものの縁と表の外枠。**§12.1 で 1.4.11 のために暗くした**（モックは `#b6c2bc`。画像は直さない） |
| `--color-ink` | `#16211d` | 本文 |
| `--color-ink-muted` | `#566761` | 補足 |
| `--color-ink-faint` | `#626e69` | プレースホルダ。**§12.1 で 1.4.3 のために暗くした**（モックは `#7d8b85`。画像は直さない） |
| `--color-pine` | `#17705a` | ブランド・主操作・ヘッダー |
| `--color-on-pine` | `#ffffff` | 緑地の上の文字（生の `#fff` を書かない） |
| `--color-pine-deep` | `#0f5645` | 濃い緑 |
| `--color-pine-soft` | `#e4f0eb` | 選択の塗り |
| `--color-pine-line` | `#58947f` | 選択の罫。**§12.1 で 1.4.11 のために暗くした**（モックは `#9cc4b6`。画像は直さない） |
| `--color-web` / `--color-web-soft` | `#1c5c8c` / `#e6eef5` | Web予約 |
| `--color-walkin` / `--color-walkin-soft` | `#9a5a15` / `#fbeedd` | ウォークイン |
| `--color-danger` / `--color-danger-soft` | `#97302b` / `#fbe9e7` | 取消・警告 |
| `--color-on-danger` | `#ffffff` | 赤地の上の文字 |
| `--color-amber` / `--color-amber-soft` | `#7a5415` / `#fff6e5` | **失敗ではない注意**。用途は 3 つに限る — RECEPTION-CHECKIN の「要確認」の札／来店回数の「初めて」（`.visits.first`）／設定の影響カード（SETTINGS-PURPOSE の `.card.note`）。この 3 面が現に橙を使っているので消せない |
| `--color-busy` / `--color-busy-soft` / `--color-free` | `#cdd5d1` / `#e4e9e6` / `#eef6f2` | 埋・空。`--color-busy-soft` は §2.5 の決定で新設（埋まった枠の**帯の中**だけに敷き、文字を `--color-ink-muted` で 4.5:1 に乗せる） |
| `--color-grid` / `--color-grid-hour` | `#e7ecea` / `#cbd5d1` | 台帳の時間グリッド |
| `--color-focus` | `#0a63c4` | フォーカスリング（白・下地・薄い緑の面） |
| `--color-focus-on-pine` | `#ffffff` | **緑の面の上のフォーカスリング**（§12.1 で新設。`--color-focus` は緑の上で 1.03:1 になって消える） |
| `--radius-ctl` / `--radius-card` / `--radius-panel` / `--radius-full` | 0.5rem(8px) / 0.75rem(12px) / 1rem(16px) / 9999px | 角 |
| `--radius-circle` / `--radius-none` | 50% / 0 | 丸い FAB（`.fab` 64×64・`.back` 48）／ 角を落とす面 |
| `--font-sans` / `--font-display` | `-apple-system, "SF Pro JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif` | iPadOS 既定（HIG）。**Web フォントは配らない**（決定ブリーフ §12.2）。見出し用の別書体は持たず、`--font-display` は `--font-sans` と同一にする |
| `--font-mono` | `"SF Mono", ui-monospace, Menlo, monospace` | 時刻・ID・数値。和文には使わない |

ピルの角は実装では **`--radius-full`**（9999px）である。決定ブリーフ §10 の表と `design/05-screen-flow.md` §1.1 は
同じ行を `--radius-pill` と書いていたが、`theme.css` に `--radius-pill` は存在しない。
同 §10 が「名前を保つ」と列挙した中核トークンに `full` が入っているため、**実装名は `--radius-full`** を採る
（05 §1.1 も同じ名前に直した）。

`--color-pine-soft` と `--color-pine-line` の使い分けは「塗り」と「罫」で、混ぜない。
`--color-on-pine` / `--color-on-danger`（どちらも `#ffffff`）は緑地・赤地の上の文字にだけ使い、生の `#fff` を書かない。

文字寸法もトークンで持つ（§1.3 の rem 翻訳はこの表を指す）。**任意値（`text-[15px]`）は書かない。**

なお「モックに無い大きさは足さない」は事実と食い違う。モックが実際に使っている段は **17 段**あり、下の 8 段に
乗らないものが `assets/eyex.css` 自身にもある（`.card h3 { font-size: 15px }` が 85 か所、
`.navtoggle { font-size: 14px }` が 29 か所。ほかに 18 / 20 / 21 / 24 / 26 / 38px が各 2〜5 か所）。
逃げ場が無いと実装は「任意値を書く（ルール 5 で禁止）」か「黙って 16px か 13px に寄せる（モックとずれる）」の
二択になる。現に P0 の `.navtoggle` 相当は `--text-grid`（13px）を当てて 1px 縮んでいる。
**決定: 15px / 14px の段は足さない。**15px（`.card h3`）は `--text-body`（16px）へ、14px（`.navtoggle` /
`.appt b`）は `--text-grid`（13px）へ丸める。モック README が「本文の段は 3 段まで」と決めており、段を増やすほうが
規準を壊すため。18 / 20 / 21 / 24 / 26 / 38px も同じ理由で足さず、いちばん近い既存の段へ寄せる
（差は 1〜2px で、承認済みモックとの差は §8 の突き合わせで既知差分として扱う）。**任意値は書かない。**

| トークン | 値 | 使いどころ |
|---|---|---|
| `--text-hero` | 1.75rem（28px） | トップの主操作 |
| `--text-title` | 1.375rem（22px） | 画面の問いかけ・見出し |
| `--text-bar` | 1.1875rem（19px） | アプリバーの店名 |
| `--text-lead` | 1.0625rem（17px） | 選択肢・入力・一覧の見出し |
| `--text-body` | 1rem（16px、行間 1.5） | 本文 |
| `--text-grid` | 0.8125rem（13px） | 台帳・補足 |
| `--text-note` | 0.75rem（12px） | 状態の札・凡例 |
| `--text-fine` | 0.6875rem（11px） | 目盛・端末名 |

**余白と寸法のトークンは現在 0 個である。**ルール 5 は「余白もトークン経由」と言っているのに、`theme.css` が持つのは
色・角丸・書体・文字寸法だけである。`design/05-screen-flow.md` §1 が決めている固定寸法の大半は Tailwind の 4px スケールに
乗る（44→`min-h-11`、216→`w-54`、440→`w-110`）ので実害は小さいが、**乗らないものが 2 つある**。

| 場所 | 値 | Tailwind |
|---|---|---|
| `.card.warn.lead` の左帯（EX-PERMISSION / EX-UPLOAD-FAILED / BOOK-CONFLICT） | **6px** | border 幅は 0/1/2/4/8 のみ → `border-l-[6px]` = **任意値（禁止）** |
| `.item.unread` の左帯（ALERTS） | 4px | `border-l-4` ○ |
| 安全領域の下余白（§1.1） | `env(safe-area-inset-bottom)` | 素の Tailwind に無い |

**決定: `.card.warn.lead` の左帯は `.item.unread` と同じ 4px に寄せ、`--border-lead: 4px` としてトークン化する。**
6px はモック全体で他に用例が無い一点物で、段を 1 つ増やすほどの意味を持っていない。
**余白のトークンは 3 つ足す** — `--spacing-gutter`（画面の外周 44px）／`--spacing-block`（かたまりの間 28px）／
`--spacing-safe`（`env(safe-area-inset-bottom)`）。この 3 つで `design/05-screen-flow.md` §1 の固定寸法のうち
Tailwind の 4px スケールに乗らないものが無くなる。
### 3.3 方言トークンの削除（**済み**。ここは現状の記録と残った宿題）

決定ブリーフ §10 が求めた「旧モック `eyex-reservation` 専用の方言（`terminal-*` / `viz-*` / `sp-*` / `compact-*`）の削除」と
「新 eyex の値への書き直し」は、`packages/ui/src/theme.css` に**すでに適用済み**である（実測 2026-08-28）。

| 確認項目 | 実測 |
|---|---|
| `packages/ui/src/theme.css` の行数 | **103 行**（`@theme { … }` 1 ブロック。実測 2026-08-28） |
| `terminal-` / `viz-` / `sp-` / `compact-` を含むトークン定義 | **0 件** |
| 上記方言をリポジトリの TS / TSX / CSS が参照している箇所 | **0 件** |
| 色・角・書体の値 | §3.2 の表と一致 |

したがって P0（`features/003-service-foundation`）でやることは削除ではなく**確認**である。
`pnpm --filter @app/ui test` と `pnpm check` を通し、admin / example_service の見た目が変わっていないことを見る。

残った宿題:

- 決定ブリーフ §10 が「名前を保つ」と列挙した中核トークンのうち、**`record` / `timer` / `glyph` / `figure` /
  `text-glyph` / `text-figure` は現在の `theme.css` に存在しない**（`display` / `amber` / `full` / `ctl` は存在する）。
  リポジトリ内にこれらを参照しているコードは 0 件なので実害は出ていないが、ブリーフの文言とは食い違っている。
  **決定: `theme.css` に戻す。**決定ブリーフ §10 が「名前を保つ」と決めた一覧であり、`admin` / `example_service` が
  同じ名前を使っている以上、この 6 つだけを落とすと名前の一覧が 2 通りになる。値は §3.2 の既存トークンの別名として置く
  （`record` = `--color-danger`、`timer` = `--color-ink-muted`、`glyph` / `figure` / `text-glyph` / `text-figure` は
  それぞれアイコン・図版の前景と文字色）。
- 新しい色・大きさが要るときは、**`theme.css` にトークンを足してから**使う（§3.1）。
  モック `assets/eyex.css` にあって `theme.css` に無い値（`--on-brand` の別名など）は、
  すでに `--color-on-pine` / `--color-on-danger` として名前が付いている。生の hex を書き足さない。
- **書体のフォールバックが決定ブリーフ §12.2 と食い違っている。**§12.2 は「`--font-sans` の予備は
  `Noto Sans JP` と総称 `sans-serif` だけにする」と決め、`@fontsource/*` の依存も `packages/ui/package.json` から
  外れているのに、`theme.css` の `--font-sans` にはまだ `"IBM Plex Sans JP"` が、`--font-mono` には
  `"IBM Plex Mono"` が残っている。同ファイルのコメント「自前ホストの IBM Plex Sans JP を後ろに残す
  （`packages/ui/src/index.ts` が読む）」も、`index.ts` が「書体は自前で配らない」と明記している以上、嘘である。
  §3.2 の表が正で、**実装は §3.2 の値へ直す**（コメントも一緒に直す）。P0 の残作業として扱う。
- モック `assets/eyex.css` は `:root` の外で生 hex を 10 個直書きしており、そのうち 2 つは設計文書が名指しで使えと
  言っている部品の縁である（`.card.warn` の `#d9a9a4` / `.card.note` の `#d9bb92`）。`theme.css` にあるのは塗り
  （`--color-danger-soft` / `--color-walkin-soft`）だけで縁の色が無い。扱いは `design/05-screen-flow.md` §1.1 に書いた。

---

### 3.4 文の書き方（`docs/frontend/DESIGN_RULE.md` §4 に対応する）

トークンに「唯一の出どころ」があるのと同じで、**画面に出る日本語にも唯一の出どころが要る**。
承認済みモック 68 画面を機械走査すると、次の規則が例外なし（または違反 1 件）で成立していた。
文書に書いていないと、後続フェーズが新しい面を足したときに崩れる。

**(a) 句読点**

| 対象 | 規則 | 例 |
|---|---|---|
| `h1` / `h2`（見出し・問いかけ） | **句点を打たない**（68 画面で違反 0 件） | 「ご用件をお選びください」「マイクが使えないため、録音できません」 |
| `.sub` / `.lead`（説明文） | **句点を打つ** | 「ご予約の受付は、このまま最後まで続けられます。」 |
| ボタンのラベル | 句点を打たない | 「やめる」「この予約を取り消す」 |
| 表のセル・状態の札 | 句点を打たない | 「公開しています」「決めてください」 |

**(b) 敬語の段**

| 面 | 段 | 例 |
|---|---|---|
| お客様向け Web 予約（`/w/**`） | 尊敬・謙譲。目的語にも `ご` `お` を付ける | 「ご希望の店舗をお選びください」 |
| 業務面のうち**お客様のもの**を指す語 | `ご` `お` を付ける | `ご予約` `ご来店` `ご用件` `お名前` `お電話番号` |
| 業務面のうち**店の道具・記録**を指す語 | 付けない | `担当` `設備・場所` `台帳` `受付履歴` `予約番号` `技能` `端末` |
| 業務面のスタッフへの指示 | `〜してください` | 「担当を変えるか、時間をずらしてください。」 |
| 業務面でも**お客様に関わる選択**の指示 | `〜をお選びください` | 「取り消しの理由をお選びください」 |
| お客様へ**読み上げる文** | **`です・ます`** | 「所要時間は約60分です。」 |

**読み上げ文に丁重語（`でございます` `いたします`）を使わない。**読み上げるのは接客中のスタッフであり、
段が 1 つ上がると言いよどみを生む。CHANGE-DIFF の「所要時間は約60分でございます。」だけがこの規則から外れており、
実装は `です・ます` に揃える（`design/06-use-cases.md` §13）。
**確定していないことを完了形で読み上げない** — CHANGE-DIFF は確定前の面なので「変更いたしました」ではなく
「変更いたします。…こちらでお間違いないでしょうか？」にする。

**(c) 数字と記号**

| 対象 | 書き方 | 例 |
|---|---|---|
| 時刻 | 半角 24 時制 `HH:MM`。ゼロ埋めする | `09:30` `14:00` |
| **時刻の範囲** | **`HH:MM–HH:MM`**（U+2013 EN DASH・前後に空白を入れない） | `11:00–12:00` |
| 日付 | `YYYY年M月D日（曜）`。月日はゼロ埋めしない | `2026年8月27日（木）` |
| 日付（同年内の略記） | `M月D日（曜）` | `8月27日（木）` |
| **日付の範囲** | **`M月D日〜M月D日`**（U+301C WAVE DASH・前後に空白を入れない） | `8月27日〜9月2日` |
| 所要時間（未確定・目安） | `約N分` | 目的の札・対客の明細 |
| 所要時間（確定した予約） | `N分`（`約` を付けない） | 台帳・差分表・右カラムの「所要」 |
| 件数 / 人数 / 来店回数 | `N件` / `N名` / `初めて`・`N回目` | 「ご来店中 4名」 |
| 予約番号・電話番号のハイフン | **半角ハイフン U+002D のみ**。非改行ハイフン U+2011 を使わない | `EY-2608-0142` / `090-1234-5678` |
| 全角数字・半角チルダ `~`・全角チルダ `～`（U+FF5E） | **使わない** | — |
| 録音・待ちの経過 | `mm:ss`（録音）／ `N分`（待ち） | `03:12` / `お待ち 6分` |

**(d) 語の選び方**

- 予約をやめることは **`取り消し`**（送り仮名あり）と書く。指標名の `取消率` だけ送り仮名を落とすことを許す。
  **`キャンセル` は画面に出さない。**編集を捨てる操作は設定面では `変更を捨てる`、受付そのものの中止は `やめる`。
- 「受付」は 1 語で使わない。**`ご予約の受付`**（`reception_sessions` / 受付履歴 / `reservations.created_at`）と
  **`ご来店の受付`**（`visit_events.stage='received'` / 来店受付 / お待ち時間の起点）を必ず書き分ける。
- Web 予約の本人確認番号は対客・業務とも **`確認番号`**（内部名は `management_code_hash`）。`管理コード` は画面に出さない。
- 語の正本は `design/02-domain-model.md` §2 の用語表にある。ここに無い語を画面に足さない。

**(e) 失敗の文の型**（DESIGN_RULE §4「何が起きたか + どう回復するか」）

- 1 文目に**失われていないもの**、2 文目に**理由**、そのあとに**次の一手をボタン**で置く（§5.1 / `design/05-screen-flow.md` §6）。
- 入力を拒むときは「〜のため保存できません。〜を直してください。」の 2 文にする。
- 「エラーが発生しました」「入力してください」のような、何が起きたかを言わない文を書かない。
- 画面に出す文が決まっていないエラーコードは実装しない（`design/04-api.md` §5 の「画面に出す文」列が正本）。

---

## 4. 性能

### 4.1 1 画面の初回描画で叩く API 本数

**上限は 2 本**（画面本体 1 本 + アプリバーのお知らせ件数 1 本）。3 本以上必要になったら、
クライアントで並べずにサーバ側で 1 レスポンスにまとめる。
下の表の本数は**画面本体の分**であり、アプリバーのお知らせ件数はこれに 1 本足りる（画面を移っても件数は取り直さず、
台帳の 60 秒更新に相乗りする — §4.4）。

ルート名は `design/05-screen-flow.md`、経路名は `design/04-api.md` を正とする。

| 画面（ルート） | 初回描画で叩く本数 | 1 レスポンスに含めるもの |
|---|---|---|
| `/ledger?axis=staff\|resource&view=timetable\|list` | 1（`GET /api/staff/ledger`） | **1 店舗 1 日分**の担当・シフト・設備・点検・予約・割当・ウォークイン・来店進捗・営業時間・`serverNow` |
| `/ledger?selected=<id>`（帯を押した詳細） | 1（`GET /api/staff/reservations/:reservationId`） | 台帳の帯（`LedgerEntry`）に無い項目（録音の長さ・変更の経緯・お客様の注意ごと）を取る。**同じ帯を押し直したときは取りに行かない**。録音の再生は「録音を聞く」を押した時点で `POST /api/staff/recordings/:id/playback` 1 本 |
| `/`（トップ。HOME / HOME-PERSONAL / HOME-SHARED-LOCKED） | 1 | 本日の担当予約・当日の件数・日付の帯（お知らせ件数はアプリバーの 1 本） |
| `/alerts` | 1 | 4 分類の件数と当日の一覧 |
| `/book/datetime` `/book/purpose` `/book/slot` `/book/customer` `/book/confirm` `/book/done` | 工程ごと 1 | 日時=空き枠 / 目的=目的一覧 / 担当と場所=候補 / お客様=検索結果 / 確認=0 本（前工程の応答から描く） / 完了=確定した予約 |
| `/reception?view=board` | 1 | 本日の来店予定・ウォークイン・進捗 |
| `/reception?view=checkin&subject=<id>` | 1 | 予約と**お客様の要約を同じレスポンスに入れる**（予約 1 本 + 顧客 1 本に割らない） |
| `/search` | 1 | 条件に合う予約と、条件を 1 つ外したときの件数（EX-EMPTY-SEARCH の「3件 / 5件 / 1件」） |
| `/history` | 1 | 受付セッションの一覧と、選んだ 1 件の経緯（HISTORY-LIST）。0 件なら条件を 1 つ緩めたときの件数（HISTORY-EMPTY） |
| `/customers` | 1 | 一覧 + 選択中の要約 |
| `/analytics?tab=top\|count\|staff\|wait\|cancel` | タブごと 1 | そのタブの指標だけ |
| `/settings?section=store\|calendar\|purpose\|web` | 1 | その分類のグループ表と、右の影響プレビュー |
| `/settings?section=hours\|staff\|equipment` | **2** | `design/04-api.md` §3.3 が本体と従属リソースを別ルートに割っている 3 面だけ 2 本を許す — 営業時間は `business-hours` + `slot-rules`（「予約の間隔」）、スタッフは `staff` + `staff-shifts`（「勤務時間」）、設備は `equipment` + `maintenance`（「次の点検」）。**まとめるためにルートを合流させない**（それぞれ独立に PUT する面があり、GET と PUT の形が割れると保存の版管理が読めなくなる）。この 3 面は上限 2 本の枠をこれで使い切るので、お知らせ件数は取り直さず台帳の 60 秒更新に相乗りする（§4.4） |
| `/w/:storeSlug` `/purpose` `/datetime` `/form` `/confirm` `/done` | 工程ごと 1（`/form` は 0） | 公開店舗・公開目的・空き枠 |
| `/w/reservations/:code`（WEB-CANCEL） | 1 | 管理コードで本人確認したあとの 1 件 |

### 4.2 サーバ 1 リクエストの上限

| 指標 | 上限 | 理由 |
|---|---|---|
| Workers CPU 時間 | **10ms 未満** | 無料枠の固定上限。超えると 1 リクエストが落ちる |
| D1 クエリ本数 | **16 本以内**。同時に投げるものは `db.batch()` で 1 往復にまとめる | 台帳 1 本（`GET /api/staff/ledger`）が最大で、`design/04-api.md` の `LedgerView` を満たすのに `store_business_hours` / `store_calendar_exceptions` / `store_blackout_windows` / `store_slot_rules` / `staff` / `staff_shifts` / `equipment` / `equipment_maintenance` / `reservations` / `reservation_assignments` / `reservation_purposes`（+`visit_purposes`） / `customers` / `walk_ins` / `visit_events` / `web_bookings` の **14〜15 文**が要る。10 本では初日に破れるので 16 本を上限にする。`db.batch()` は 200 文でも通る（実測）ので文の数はサブリクエスト（Cloudflare 宛 1,000/呼び出し）にも当たらない。**16 本を超えるなら `json_group_array` で `store_*` 系を 1 文に畳む**（D1 で使えることを実測済み）。それでも足りないなら画面を割る |
| N+1 | **禁止**。予約 N 件に対して割当を N 回引かない。`IN` でまとめて取り、アプリ側で束ねる | 同上 |
| 空き枠計算の走査量 | 1 店舗 1 日 = 枠数 × (担当数 + 設備数)。銀座店なら **18 × (6 + 7) = 234 回**（枠数は営業 10:00–19:00 を `slot_minutes` 30 分で割った 18。台帳が描く 14 列は表示窓であって枠数ではない — §1.2） | 純関数 `src/worker/domain/availability.ts` を 1 パスで解く。全店舗・全日を 1 リクエストで計算しない |
| レスポンス本体 | 台帳 1 日分で **200KB 以内**（gzip 前） | 予約 20 件 + 担当 6 + **設備 7**（決定ブリーフ §12.3。§11 の 5 件は誤り）+ 進捗 120 件で見積もった |

### 4.3 クライアント

| 指標 | 上限 |
|---|---|
| 初回 JS（gzip） | 300KB |
| チャンク分割 | 業務面（`/start`〜`/settings`）と Web 予約面（`/w/**`）を別チャンクにする。Web 予約は業務面のコードを 1 バイトも読み込まない |
| 台帳の再描画 | 60 秒ごとの自動更新で、変わっていない帯を再マウントしない |

### 4.4 自動更新の間隔

| 対象 | 間隔 | 手段 |
|---|---|---|
| 予約台帳・来店受付 | 60 秒 | `GET /api/staff/ledger` を**同じクエリで丸ごと取り直す**。`LedgerQuery` に差分取得の条件（`since` 等）は無い（`design/04-api.md` の `LedgerQuery`）。再描画の抑制はクライアント側で `LedgerEntry.reservationId` + `startsAt` + `status` を比べて行う |
| 現在時刻線（`.nowline`）・待ち時間・録音の経過 | 30 秒 | **クライアント側の再計算のみ**。API を叩かない。基準時刻は `LedgerView.serverNow` と取得時のクライアント時計の差分で補正し、端末の時計ずれをそのまま出さない |
| お知らせ件数 | 台帳の更新に相乗り | 独立したポーリングを持たない |
| 通信断からの自動再接続 | 60 秒 | EX-OFFLINE「11:09 に自動でも試します」（画面の 11:08 の 1 分後） |
| 録音の自動再送 | 5 分 | EX-UPLOAD-FAILED「11:20 に自動でもう一度送ります。操作は要りません。」（画面の 11:15 の 5 分後） |

リクエスト予算: 3 店舗 × 3 端末 × 60 回/時 × 10 時間 = **5,400 req/日**。無料枠 100k req/日 の 6%。

---

## 5. 可用性と失敗時のふるまい

### 5.1 3 つの状態を必ず言い分ける

画面はどの失敗でも、次の 3 つを別の言葉で言い切る。「失敗しました」だけを出さない。

| 状態 | 意味 | モックの言い方 | 出どころ |
|---|---|---|---|
| **成立** | サーバに書けた。取り消されない | 「ご予約は確定しています」「ご予約は成立しています」 | EX-UPLOAD-FAILED / ALERTS |
| **未送信** | まだ書けていないが、消えてもいない | 「録音は、この iPad の中に残っています」「レジ横iPad／まだ保存していません」 | EX-UPLOAD-FAILED / EX-CONFLICT |
| **再試行可能** | いつ自動で再試行するか・いま手で再試行できるか | 「もう一度送る」「11:20 に自動でもう一度送ります。操作は要りません。」「再接続を試す／11:09 に自動でも試します」 | EX-UPLOAD-FAILED / EX-OFFLINE |

### 5.2 通信が切れたとき（EX-OFFLINE）

| 項目 | 決め |
|---|---|
| 読める範囲 | 最後に取れた内容をそのまま出す。空にしない |
| 鮮度の表示 | 本文の一番上に固定の帯（`role="status"`）を出し、**取得時刻を書く**:「いまご覧の内容は 11:02 現在 のものです。」 |
| 書ける範囲 | 予約の確定・変更・ご来店の受付を止める。止めた理由を同じ帯に書く:「予約の確定・変更・ご来店の受付は、つながってからになります。」 |
| 入力 | **画面に残す**。読み込み直しでフォームを空にしない |
| 再試行 | 手動ボタン「再接続を試す」＋ 60 秒ごとの自動再試行。次に試す時刻を書く |
| 復帰時 | 自動で再取得し、帯を消す。ユーザーの入力は上書きしない |

### 5.3 入力を失わない

| 場面 | 残すもの | モックの言い方 |
|---|---|---|
| 検索が 0 件 | 入力した条件すべて | 「入力した条件はそのまま残しています。」（EX-EMPTY-SEARCH） |
| 権限不足で保存できない | 未保存の設定の下書き | 「下書きは残っています」（EX-PERMISSION） |
| 通信断 | 予約フローの日時・目的・担当・お客様 | — |
| 保存の競合 | 自分が直した内容 | 「レジ横iPad／まだ保存していません」（EX-CONFLICT） |
| **アプリを切り替えて戻った** | 予約フロー5工程の入力（日時・目的・担当・お客様・ご要望）とマイクの許可 | — |

下書きの置き場所は**端末のメモリ**とし、`localStorage` を含む永続領域に顧客情報を書かない（§6.6）。

**アプリを切り替えて戻ったとき**は、通信断より頻度が高いのに一番弱い。iPadOS Safari はバックグラウンドのタブを
容易に破棄し、戻ると再読み込みするので、「メモリだけ」を守ると 5 工程の入力とマイクの許可が丸ごと消える。
仮押さえ（KV 420 秒・§8）が既にサーバ側にあるので、**工程の入力もサーバ側の `reception_sessions` に紐づけ、
`sessionStorage` には受付セッション id だけを置く**（顧客情報は置かない）のが §6.6 と両立する唯一の形になる。

**決定: 予約フローの下書きはサーバ側の `reception_sessions` に持たせる。**端末に残すのは受付セッション id と
選んだ id（目的 id・担当 id・設備 id・顧客 id）だけで、**お客様の名前・電話番号・度数そのものは端末に置かない**
（§6.6 と両立する唯一の形）。マイクの許可を取り直すための読み込み直しでも同じ経路で戻る。

**復帰したときの着地**: トップに「受けかけのご予約 1件」を出し、押すと**中断した工程**へ戻す。工程の途中へ黙って
飛ばさない（別の人が触っている端末かもしれない）。仮の押さえ（KV 420 秒・§8）は中断の時点で解放し、
続きから戻ったときに取り直す — 取れなかったら BOOK-CONFLICT へ落とす。

**予約フローには「あとで続ける」の出口を置く。**いまの appbar の出口は「やめる」1 つだけで、
電話が途中で切れた・ウォークインが割り込んだときに**伺った内容を捨てる以外の道が無い**。
「あとで続ける」を押した受付セッションは `outcome` を入れずに（進行中のまま）残し、
「やめる」を押したときだけ `outcome='discarded'` にする（`design/05-screen-flow.md` §4.3 / §5.1）。
同時に持てる受けかけの受付は **1 端末 1 件**とし、2 件目を始めるときは先の 1 件を捨てるか続けるかを聞く。

### 5.4 二重書き込みを防ぐ（冪等）

| 項目 | 決め |
|---|---|
| 対象（**この 6 本だけ**） | `POST /api/staff/reservations`（予約の作成）／`POST /api/staff/walkins`（ウォークインの受付）／`POST /api/staff/customers/merge`（顧客の統合）／`POST /api/public/stores/:storeSlug/bookings`（Web 予約の確定）／`PATCH /api/public/reservations/:code`（Web の日時変更）／`POST /api/public/reservations/:code/cancel`（Web の取消）。`design/04-api.md` の「`Idempotency-Key` を受けるエンドポイント」の表と一致させる |
| 対象**外** | 予約の変更・取消、来店進捗の記録、録音の登録・状態更新、設定の保存。これらは `version`（`revision`）の楽観ロックで二重適用を防ぐ。冪等キーを重ねない |
| 送り方 | HTTP ヘッダー `Idempotency-Key`。クライアントが工程の開始時に `crypto.randomUUID()` で作り、成功するまで**同じ値**を送る |
| 保存 | `idempotency_records`。`key` は `<organization_id>:<scope>:<Idempotency-Key ヘッダー値>`（PK。テナント名前空間を含むので他テナントと衝突しない）。列は `organization_id` / `scope` / `request_hash`（正規化 JSON の SHA-256） / `response_json` / `status`（`in_progress` \| `done`） / `created_at` / `expires_at` |
| 同じ鍵・同じ内容の再送（`status='done'`） | `response_json` をそのまま返す。**本処理を再実行しない**（新しい行を作らない） |
| 同じ鍵・違う内容 | **409 `idempotency_conflict`**。画面は「同じ受付で別の内容が送られました」を出して先に進めない |
| 同じ鍵で処理中（`status='in_progress'`） | **409 `idempotency_conflict`**。クライアントは鍵を作り直して送り直す。中断された `in_progress` を待つ・引き継ぐ経路は作らない（D1 に CAS が無い） |
| 原子性 | 本処理と `status='done'` の書き込みを**同じ `db.batch()`** に入れる。片方だけ成功する窓を作らない。本処理が失敗したら `in_progress` の行を消す |
| 期限 | 24 時間（`expires_at`）。期限切れの鍵は日次 Cron（§9.4 の #5）が消す |

### 5.5 同じ予約を 2 人が直したとき（EX-CONFLICT）

| 項目 | 決め |
|---|---|
| 検出 | **版の条件を `db.batch()` の全文に配り、版を進める文を batch の最後に置く。**`reservations` 以外の文（`reservation_purposes` / `reservation_assignments` / `reservation_slot_locks` の置き換え、`audit_events` の追記）はすべて `WHERE EXISTS (SELECT 1 FROM reservations WHERE id = ?1 AND version = ?2)` でガードし、最後に `UPDATE reservations SET ..., version = version + 1 WHERE id = ?1 AND version = ?2` を置く。競合の判定は**最後の文の `meta.changes === 0`**で行う |
| なぜその形か | **0 行の `UPDATE` は例外にならず、`db.batch()` を止めない**（D1 で実測。`meta.changes` が `[0, 1]` になり後続が commit される）。版の条件を 1 文目だけに付けて残りを素で並べると、409 `version_conflict` を返しながら割当と `reservation_slot_locks` だけが相手の値から書き換わり、**台帳の帯と空き枠エンジンの見え方がずれて二重予約が作れてしまう**。取消はもっと直接的で、409 を返しながら枠のロックだけが消える。バッチ全体が 1 トランザクションなので、全文に同じ版の条件を付ければ「全部通るか、全部通らないか」のどちらかになる |
| 設定 7 画面も同じ形 | `store_settings_revision` の版を条件に付けた文を最後に置き、対象表の書き込みを `WHERE EXISTS (...)` でガードする（`design/03-data-model.md` §4.6）。この形にしないと「後から保存したほうが相手の変更を黙って巻き戻すことはない」（同 §0 の #14）が成り立たない |
| テスト | `test/*.integration.test.ts` に「版が合わないとき **1 行も書き換わっていない**」を必ず立てる（409 が返ることだけを見ない）。対象は予約の変更・取消と設定 7 画面の保存 |
| 応答 | **409 `version_conflict`**（`VersionConflictError` = `current` + `fields`）。相手が保存した内容・保存した端末・保存した人・保存時刻を一緒に返す |
| 画面 | どちらも書き換えないことを先に言う:「受付iPad の 中村 彩 が 11:06 に保存しました。選ぶまで、どちらの内容も書き換わりません。」 |
| 出口 | 4 つ。モックの文言は「〈相手の表示名〉 の内容を残す」「あなたの内容で上書きする」「1項目ずつ選ぶ」「やめて台帳に戻る」（相手の名前は `audit_events.actor_id` → `staff.display_name` から入れる） |
| 自分側の状態表示 | 「〈端末名〉／まだ保存していません」（モックは「レジ横iPad／まだ保存していません」）。端末名は `terminals.name` |
| 記録 | どちらを選んだかを `audit_events` に 1 行残す（§7） |

`version` を持つのは `reservations` / `customers` / `visit_purposes` / `store_slot_rules` / `web_booking_settings` /
`organizations`（`revision`）。それ以外は最終書き込みが勝つ。

### 5.6 録音が保存できないとき（EX-UPLOAD-FAILED / EX-MIC-DENIED）

| 項目 | 決め |
|---|---|
| 予約との関係 | **予約は失われない**。録音の保存失敗で予約を巻き戻さない。画面は先に「ご予約は確定しています」を出す |
| 端末側 | 録音データは端末に残す。「録音は、この iPad の中に残っています」 |
| 本体の上限 | 1 ファイル **100MB**。超えたら 413 `payload_too_large` を返す（`design/04-api.md` のエラー表）。**分割送信は作らない** — `recordings.r2_key` は 1 録音 1 本で、しかも第 2 の冪等キーとして使う決めなので（`design/03-data-model.md` §10.1）、分割すると 1 録音が複数キーになってその決めが崩れる。§9.3 のとおり 60 分でも約 14MB なので 100MB は約 7 時間の録音にあたり、この経路は事実上起きない。起きたときは 3 回失敗と同じ扱いで `recordings.state='failed'` にし、`alerts` に 1 行上げる |
| 再送 | **端末が 5 分ごとに自動再送** + 手動の「もう一度送る」（`POST /api/staff/recordings/:recordingId/retry`）。`recordings.upload_attempts` を 1 ずつ増やす。間隔はモックの実文言から取った（EX-UPLOAD-FAILED は 11:15 表示で「11:20 に自動でもう一度送ります。」＝ 5 分） |
| **サーバ側からの再送経路は無い** | 音声の実体は端末にしか無く、サーバが持つのは `recordings` の行だけである。再送できるのは**その録音を持っている端末**だけなので、`alerts` の本文には残っている端末名（`terminals.name`）を必ず入れる。レジ横 iPad で失敗した録音を受付 iPad から押しても直らない |
| 3 回失敗 | `recordings.state = 'failed'` にし、`alerts` に 1 行上げる（§11）。`3 回` はモックの ALERTS「録音の保存に3回失敗しました」から取った |
| マイクが使えない | 受付は最後まで続けられることを先に言う。予約・変更・取消、ここまでの入力、手書きメモは使えると明記する。できないのは録音だけであることを 1 行で言う |
| マイクなしの記録 | `reception_sessions` は作り、`recordings` は作らない |

### 5.7 通知（notifier）が失敗したとき

| 項目 | 決め |
|---|---|
| 呼び方 | `c.env.NOTIFIER.fetch('http://notifier/api/internal/send', …)` を **try/catch で包む**（best-effort） |
| 予約への影響 | **なし**。通知の失敗で予約・Web 予約・受付を巻き戻さない |
| 応答の扱い | `sent` / `duplicate` は成功（`emailed = true`）。409 `idempotency_conflict`（同一 `job.id` で payload 相違）と 409 `idempotency_in_progress`（Resend が同一キーを処理中）と 502 `send_failed` は失敗（`emailed = false`）。`idempotency_in_progress` だけは**同じ `organizationId` + `job.id` で**再試行してよい |
| 冪等キーの持ち主 | 冪等キーを持つのは **notifier 側の KV** であり、このサービスの `SHORT_LIVED` ではない。notifier は成功したときだけキーを残す。呼び出し側がやることは `organizationId` と `job.id` を毎回同じ規則で作ることだけ（`design/04-api.md` の notifier の表） |
| 握りつぶさない証拠 | 応答に `emailed: false` を含め、画面に代替経路を出す（Web 予約なら予約番号を画面に残す）。**送信成功を偽装しない** |
| 送らない場面 | 店内予約（`reservations.source = 'phone'` / `'walkin'`）ではメールを送らない。CHANGE-DIFF「お電話でのご予約のため、メールは送りません。」／CHANGE-DONE「お電話でのご予約のため、メールは送っていません。」 |
| 再検知 | 未送信の通知は Cron が翌スロットで再評価する。`job.id` に時間スロットキー（日付・12h スロット）を入れて連打しない |

### 5.8 共有端末のセッションが失効したとき

`terminal_sessions.expires_at` を過ぎた、または `revoked_at` が入った時点で次を行う。

| 破棄する | 残す |
|---|---|
| 画面のキャッシュ（顧客名・電話番号・予約一覧・検索結果） | **サーバへ未送信の録音データ**（消さずに端末へ置いたまま、次に**同じ端末で**有効なセッションが立ったときに自動再送する。置いておく窓は**録音終了から 24 時間**で、過ぎたら §9.4 の Cron #2 が `alerts` に上げたうえで端末側の実体を消す。§6.6） |
| 入力途中の下書き | — |
| 選択中店舗・選択中の日付 | — |
| メモリ上のアクセストークン | — |

- 失効した端末では、未送信の録音の**再生・書き出しの操作を一切出さない**（元から作らない）。
- **失効を「端末から録音を消す合図」にしない。**共有 iPad は自動ロック（2 分）や交代でしょっちゅう失効するので、
  失効で消すと EX-UPLOAD-FAILED の「11:20 に自動でもう一度送ります。操作は要りません。」が守れない。
  端末に残る窓は**時間（24 時間）で閉じる**（上の表と §6.6）。
- 自動ロック（2 分）は失効ではない。伏せるだけで、さわれば元に戻る（§6.4）。

**決定: 端末の遠隔破棄は作らない。**`terminal_sessions.revoked_at` を立てて以後の送信・再生を拒むところまでにする。
未送信の録音は端末のローカルにあり、Web からは消せない（そもそも「消えたこと」を確かめられない機能は約束できない）。
端末を失ったときの手当ては ①セッションを失効させる ②その端末に残っている未送信の録音を `alerts` に列挙する
（§11.4 の 24 時間監視がそのまま使える）の 2 つで足りる。

---

## 6. セキュリティ

### 6.1 テナントと店舗のスコープ

| 項目 | 決め |
|---|---|
| 認可の根拠 | **JWT の `org` だけ**。body / query / path 由来の `organizationId` を認可根拠にしない |
| 全 D1 クエリ | `organization_id` で必ず絞る。加えて店舗を持つ表は選択中 `store_id` でも絞る |
| 店舗の切り替え | ヘッダーの明示操作でのみ変わる。URL に店舗を書いても、その店舗が同じ org に属さなければ 403 |
| 検証 | `test/tenant-isolation.test.ts` で 3 テナント以上を同時に動かし、他テナントの予約・顧客・録音が見えない・書けない・偽装入力で越境できないことを固定する |

### 6.2 default-deny

```
app.use('/api/internal/*', internalAuth())
app.use('/api/*', except(['/api/health', '/api/auth/*', '/api/internal/*'],
                         tenantAuth(), requireActiveOrg(orgResolver)))
```

| 面 | 認証 | 失敗 |
|---|---|---|
| `GET /api/health` | なし | — |
| `POST /api/auth/token` | なし（`AUTH_DEV_GRANT` がある dev のみ） | 本番は **404 `not_found`**（secret 未設定で無効） |
| `/api/staff/**` | JWT + 有効 org | 無 / 不正 / 期限切れ / 別 secret 署名 = **401 `unauthorized`**、店長のみの操作をスタッフが叩いた = **403 `forbidden`**、共有モードのまま本人確認が要る操作を叩いた = **403 `personal_mode_required`**、org 未同期 = **503 `not_synced`**、org 無効 = **403 `org_disabled`**、PIN の連続失敗 3 回 = **429 `pin_locked`** |
| `/api/public/**` | なし（店舗 slug で解決） | 非公開店舗は **404 `not_published`**。他テナントの slug でも 404（存在を漏らさない） |
| `/api/internal/**` | `x-internal-key` | キー不一致・未設定は **401 `unauthorized`**（fail close）。テナント JWT では越えられない |

- 401（未認証・期限切れ）と 403（権限不足）と 503（未同期）を取り違えない。画面の分岐がこの区別に依存する
  — 401 は再ログイン、403 `forbidden` は EX-PERMISSION、403 `personal_mode_required` は MODE-PERSONAL、
  503 は数秒後の自動リトライ（ログアウトしない）。
- 「ご本人の確認」が要る操作（録音の再生・保全、顧客の統合、設定の保存）は
  `requirePersonalMode()` を個別に付ける。default-deny の gate だけでは通してしまう。
- 新しいルートを足したら `test/permissions.test.ts` の表に 1 行足す。未知パス（`/api/not-a-route`）も表に入れる。
  アクターは最低: 未認証 / staff / 店長 / 運営 org の admin / 期限切れトークン / 別 secret 署名 / 共有モードのまま。

### 6.3 secrets

| 名前 | 置き場所 | 用途 |
|---|---|---|
| `INTERNAL_KEY` | `wrangler secret put`（binding でつながる全サービス同一値） | `/api/internal/**` と notifier 呼び出し |
| `JWT_SECRET` | 同上 | アクセストークンの検証 |
| `AUTH_DEV_GRANT` | dev のみ | dev トークングラント。**本番に設定しない** |
| `AUTH_PEPPER` | `wrangler secret put` | 端末 PIN の `hashStretched(stretched, pepper)`（§6.4）。**平文 PIN と pepper を DB・ログ・応答に出さない** |

- コード / `wrangler.jsonc` の `vars` / Terraform state に置かない。dev 値は `.dev.vars`（gitignore）だけ。
- 未設定の secret は fail close にする。「未設定なら認証を素通し」を書かない。

**決定: `AUTH_PEPPER` を決定ブリーフ §1 の secrets 一覧に足す。**`packages/shared/src/password.ts` の
`hashStretched` が pepper を必須引数で取るので、PIN を保存する以上どうしても要る。
本番前チェックリスト（`docs/howto/deploy.md`）の未設定チェックにも同じ名前で載せる。

### 6.4 端末と PIN

| 項目 | 値 | 出どころ |
|---|---|---|
| PIN の桁数 | 4〜6 桁の数字 | `stretchPin` の `/^\d{4,6}$/` / MODE-PERSONAL「4〜6桁」 |
| クライアント側 | `stretchPin(pin, organizationId, userId)` = PBKDF2-HMAC-SHA256 600,000 回、salt `app:pin:<org>:<user>` | `packages/shared/src/password.ts` |
| サーバ側 | `hashStretched(stretched, pepper)` = HMAC-SHA256 1 回。保存形式 `hmac$<base64>` | 同上。Workers CPU 10ms に収めるため |
| 保存先 | `terminals.pin_hash`。**平文 PIN をネットワークにもサーバにもログにも出さない** | 決定ブリーフ §3.6 |
| 照合 | 定数時間比較（`verifyStretched`） | 同上 |
| 失敗の上限 | **3 回**続けて失敗したら **30 秒**待たせる。1〜2 回目は **401 `pin_invalid`**（`remainingAttempts` 付き）、3 回目で **429 `pin_locked`**（`retryAfterSeconds: 30` / `remainingAttempts: 0`） | LOGIN-PIN-ERROR「あと2回お試しいただけます」「3回続くと、30秒お待ちいただきます。」 |
| 失敗回数の置き場所 | KV `SHORT_LIVED` の `pin:<orgId>:<terminalId>:<staffId ?? 'shared'>`（TTL 30 秒）。失敗したときだけ書く | `design/04-api.md` の KV `SHORT_LIVED` の表 |
| 桁数の検証 | 4〜6 桁の数字でなければ **400 `weak_pin`**。`stretchPin` は範囲外で `RangeError` を投げるので、その前に弾く | `packages/shared/src/password.ts` |
| 失敗時の表示 | 残り回数を図（`.tries`、`role="img"` + `aria-label`）と文字の両方で出す。入力欄は毎回空にする | 同上 |
| 自動ロック | **120 秒**（`terminals.auto_lock_seconds`）操作がなければ伏せる | HOME-SHARED-LOCKED「2分間さわらなかったので伏せました。」 |
| 個人モードの寿命 | 昇格後も **120 秒**さわらなければ共有モードへ戻す | MODE-PERSONAL「確かめたあとも2分さわらなければ共有に戻る」 |
| 伏せ方 | 覆い（`.veil`、`position: absolute; inset: 0`）は**サイドバーを含む画面全体**にかかり、さわるまでどこへも進めない。その上で `●` に置き換えるのは**お名前と電話番号だけ**で、時刻・件数・サイドバーの項目名・端末名は文字のまま残す | HOME-SHARED-LOCKED（「サイドバーも含めて覆い、さわるまでどこへも進めないことを示す」） |
| 解除 | 画面にさわる（共有モードのまま）。個人モードへ戻るには PIN を入れ直す | 同上 |
| **伏せない場面（除外）** | **録音中の受付セッションがある間は伏せない。**電話でお客様の話を伺っている 2 分間は「さわらない」のが普通で、そこで画面全体が覆われると復唱の直前に読む文が消える。端末が使用中であることはアプリ自身が知っている（`.rec`「録音中 03:12」）。受付が `booked` / `discarded` で閉じた時点から 120 秒を数え直す。読み上げ（VoiceOver）でのフォーカス移動を「さわった」に数えるかは §2.8 の発注元への確認（下の #2）と同じ節で決める | §2.8 / EX-UPLOAD-FAILED |
| 伏せる判定 | **タイマーの経過に頼らない。**「最後にさわった時刻」を保持し、`visibilitychange` で表示に戻った瞬間に `now − lastTouch` を比べて、超えていれば即座に伏せる。iPadOS は非表示タブの `setTimeout` を強く絞る（止まることもある）ので、別アプリで 10 分過ごして戻っても伏せられていない、が普通に起きる。個人モードの寿命 120 秒も同じ扱いにする | §2.8 / §10.3 |
| 店長 PIN でのその場再認証 | EX-PERMISSION 右「店長の暗証番号で続ける」も同じ PIN 検証を通す。成功しても**共有モードのまま**にはせず、その操作 1 回分だけ個人モードとして扱う | EX-PERMISSION |

**決定（済み）: スタッフ個人の PIN は `staff.pin_hash` / `staff.pin_updated_at` に持つ**（`design/03-data-model.md` §5.1）。
端末の `terminals.pin_hash`（店舗共通・共有端末用）とは別の列である。根拠は SETTINGS-STAFF の「PIN　設定してあります／
作り直す」と START-DEVICE-MODE の「スタッフ一人ひとりの4〜6桁」。ハッシュの作り方は上の表と同じ。

**決定: 再認証のエンドポイントは `POST /api/staff/terminals/:terminalId/elevate` の 1 本にする。**
昇格の対象が「いまの端末セッション」であることが名前に出るほうがよい（`/api/staff/reauth` だと何を昇格させるのかが
経路から読めない）。`design/04-api.md` と `design/05-screen-flow.md` はこの名前に揃える。

### 6.5 録音

| 項目 | 決め |
|---|---|
| 置き場所 | R2 binding `RECORDINGS`（Terraform `glasses-management-recordings`）。**バケットを公開しない** |
| ダウンロード | **提供しない**。署名付き URL・`Content-Disposition: attachment`・`<a download>` を作らない |
| 再生 | **2 段**にする。① `POST /api/staff/recordings/:recordingId/playback` が短命チケット（`token` + `expiresAt`。KV `SHORT_LIVED` に **TTL 900 秒**）を返す ② `GET /api/staff/recordings/:recordingId/stream?token=…` が `organization_id` と `store_id` を照合して R2 から読み、Range 対応で `audio/*` を返す。トークンは 1 回の再生セッション分・同一 org・同一録音でだけ有効。R2 のキーを画面に出さない |
| 再生に要る権限 | JWT + **個人モード**（`requirePersonalMode()`）。共有モードのまま押したら 403 `personal_mode_required` を返し MODE-PERSONAL へ送る |
| 再生の記録 | チケットを発行するたび `audit_events` に `recording.played` を 1 行残す（誰が・どの端末で・どの録音を・いつ） |
| 再生の入口 | **1 件を選んだあとの 3 か所だけ**。LEDGER-DETAIL「● 録音を聞く　03:12」／CHANGE-SEARCH 右「録音を聞く　03:12」／HISTORY-LIST 右「再生する」（`03:24 / 06:12`）。**一覧から一括で聞ける導線・複数件をまとめて再生する導線は作らない** |
| 端末内 | 未送信の録音だけを端末に置く。送信成功後は端末から消す |
| 保持 | §8 |

### 6.6 顧客情報

| 項目 | 決め |
|---|---|
| ブラウザ保存 | `localStorage` / `sessionStorage` / IndexedDB に**顧客名・電話番号・メール・度数を書かない**。共有端末では次の利用者が読めてしまう |
| ブラウザ保存の**唯一の例外** | **未送信の録音（音声そのもの）だけ IndexedDB に置く。**1 受付で約 1.4MB（§9.3）あって `sessionStorage` に入らず、メモリだけに置くと iPadOS Safari が裏のタブを捨てた瞬間に消えて、EX-UPLOAD-FAILED の「11:20 に自動でもう一度送ります。操作は要りません。」が嘘になる。条件は 4 つ — ①置くのは音声と `recording_id` だけで、氏名・電話番号・目的を一緒に置かない ②置くのは**まだ送れていないものだけ**で、送信を待つ間しか持たない ③送信に成功したら即削除 ④**端末セッションが失効・失権しても消さない**（§5.8 の表のとおり。次に**同じ端末で**有効なセッションが立ったときに自動再送する）。この 4 つを満たせないなら置かず、そのときは EX-UPLOAD-FAILED の文言を「このタブを閉じると録音は失われます。いま送り直してください。」に変えて自動再送の約束を落とす |
| 未送信の録音を置く**窓の閉じ方** | ④は「失効したら消す」と読めてはならない。**失効で消すと、自動ロック（2 分）や交代のたびに未送信の録音が消え、EX-UPLOAD-FAILED の「11:20 に自動でもう一度送ります。操作は要りません。」が守れない**。かわりに窓を時間で閉じる — 失効中は再生・書き出しの操作を一切出さず（§5.8）、**録音終了から 24 時間**を過ぎても送れないままなら §9.4 の Cron #2 が `alerts` に上げたうえで端末側の実体を消す（行は `recordings.state='failed'` で残る）。共有 iPad に接客の音声が保持期限（30 日）まで残ることはない |
| アクセストークン | メモリ保持のみ。`localStorage` に置かない |
| ログ | 電話番号・メール・氏名を `console.log` に出さない。ログに出せるのは ID（UUID・予約番号）だけ |
| 検索 | 電話番号は **2 経路**。①予約フロー・顧客登録は `customers.phone_normalized`（数字のみ）の**前方一致**（BOOK-04b は `090-1234-5678` の入力に対し下 4 桁の違う `090-1234-9912` も候補に出しており、後方一致では拾えない）。②受付パネル（LEDGER-WALKIN「下4桁でも探せます」）は `customers.phone_last4` の**完全一致**。**後方一致（`LIKE '%' || ?`）は使わない** — B-tree が効かず顧客表の全走査になり、いちばん待たせられない場面（電話中・店頭）で走る。候補は**同じ org・選択中店舗**に限り、全桁一致は「よく一致しています」、それ以外は「確かめが必要です」と添えて**自動確定しない** |
| 統合 | `merged_into_id` を立てるだけで、統合元の行を物理削除しない（§8） |

---

## 7. 監査

### 7.1 原則

| 項目 | 決め |
|---|---|
| 追記専用 | `audit_events` に対して **UPDATE を発行しない**。訂正は打ち消しの行を足す |
| 削除 | 保持期限（§8）を過ぎた行を日次 Cron が消すときだけ。アプリの操作からは消せない |
| 落とさない | 監査の書き込みは本処理と**同じ `db.batch()`** に入れる。監査だけ失敗して本処理が成立する状態を作らない |
| 相関 | 1 つの操作で複数行が出るとき（予約の変更 → 割当の変更 → 通知）は同じ `correlation_id` を持たせる |
| 内容 | `before_json` / `after_json` には**変わった項目だけ**を入れる。1 行 2KB を超えないようにし、超える場合は変わったキー名だけを残す |

### 7.2 記録する操作

`target_type` には**対象のテーブル名をそのまま**入れる（snake_case・複数形。`reservations` / `walk_ins` /
`customers` / `customer_notes` / `recordings` / `terminals` / `web_bookings` / `alerts` / `organizations` /
`stores` / `store_business_hours` / `store_calendar_exceptions` / `staff` / `equipment` / `visit_purposes` /
`web_booking_settings`）。単数形・和名・画面名を混ぜない。

| `action` | `target_type` | `actor_type` | いつ |
|---|---|---|---|
| `terminal.session.started` | `terminals` | `terminal` | 共有・個人どちらの業務開始でも |
| `terminal.session.ended` | `terminals` | `staff` | 「業務を終える」 |
| `terminal.mode.elevated` | `terminals` | `staff` | 個人モードへ昇格（MODE-PERSONAL の PIN 成功）。EX-PERMISSION 右の「店長の暗証番号で続ける」も同じ `action` で、`after_json` に `reason: 'settings_approval'` を入れて区別する |
| `terminal.pin.failed` | `terminals` | `terminal` | PIN 失敗。30 秒ロックの根拠になる |
| `terminal.masked` | `terminals` | `system` | 120 秒の自動ロックで伏せた |
| `reservation.created` | `reservations` | `staff` / `customer` | 予約成立（電話・店頭は `staff`、Web は `customer`） |
| `reservation.updated` | `reservations` | `staff` | 日時・目的・担当・場所・要望の変更 |
| `reservation.cancelled` | `reservations` | `staff` / `customer` | 取消（`cancel_reason` を `after_json` に入れる） |
| `reservation.conflict.resolved` | `reservations` | `staff` | EX-CONFLICT でどちらを残したか |
| `walkin.created` | `walk_ins` | `staff` | ウォークイン受付 |
| `visit.stage.changed` | `reservations` / `walk_ins` | `staff` | 来店進捗の1段階ごと |
| `recording.started` | `recordings` | `staff` | 受付の録音開始 |
| `recording.stored` | `recordings` | `system` | R2 へ保存できた |
| `recording.failed` | `recordings` | `system` | 3 回失敗して `state='failed'` にした |
| `recording.played` | `recordings` | `staff` | **再生のチケットを出すたび** |
| `recording.hold_set` / `recording.hold_cleared` | `recordings` | `staff` | `legal_hold` の付け外し |
| `recording.deleted` | `recordings` | `system` / `staff` | 保持期限で消した（`system`）／店長が消した（`staff`） |
| `customer.created` / `customer.updated` | `customers` | `staff` | 顧客の作成・編集 |
| `customer.merged` | `customers` | `staff` | 統合（統合元と統合先の両方の id を残す） |
| `customer.note.published` | `customer_notes` | `staff` | メモ・注意ごと・手書きの公開 |
| `settings.changed` | `stores` / `store_business_hours` / `store_calendar_exceptions` / `store_slot_rules` / `staff` / `staff_skills` / `staff_shifts` / `equipment` / `equipment_maintenance` / `visit_purposes` / `purpose_requirements` / `web_booking_settings` | `staff` | 設定の保存（before/after 付き） |
| `settings.denied` | 同上 | `staff` | 権限不足で保存できなかった（EX-PERMISSION、403 `forbidden`） |
| `settings.approval_requested` | 同上 | `staff` | EX-PERMISSION「この下書きを店長に依頼する」。`[要確認: Q-10 — いまの前提で進める]`（いまの前提は「承認は要る。`draft` → 同じ店舗の店長が `published`。依頼はお知らせに 1 件立て、ALERTS から承認の面へ入る」。答えが来るまで依頼のボタンは画面に出さないので、この `code` は書かれない。§13 の #3） |
| `web_booking.received` | `web_bookings` | `customer` | お客様が送信した |
| `web_booking.approved` / `web_booking.rejected` | `web_bookings` | `staff` | 店側の確認 |
| `web_booking.auto_cancelled` | `web_bookings` | `system` | **受信日**のうちに確認されず自動取消（§9.4 の Cron #3） |
| `alert.read` / `alert.resolved` | `alerts` | `staff` | お知らせの既読・対応済み |
| `organization.synced` | `organizations` | `system` | admin からの `POST /api/internal/organizations/sync`（admin が実際に叩くのはこの 1 本。`services/admin/src/worker/sync.ts`） |

### 7.3 監査の読み方

- **生の監査ログ**（`GET /api/staff/audit`。`before_json` / `after_json` を含む）の閲覧は `audit.read` 権限
  = 店長に限る。閲覧そのものは監査に残さない（残すと閲覧が閲覧を生む）。
- 受付履歴の画面（HISTORY-LIST）が読む `GET /api/staff/reception-sessions` は**全スタッフが見られる**。
  返すのは受付セッションと予約の経緯（「ご来店時刻を 11:30 から 11:00 へ」の形）であって、生の before/after ではない。
  CHANGE-DONE の脚注「この操作は受付履歴に残ります（銀座店 レジ横iPad・11:12　操作者 中村 彩）。」はこちらを指す。
- ただし **`recording.played` だけは例外**で、録音を聞いた事実は必ず残す（§6.5）。

---

## 8. データ保持

| データ | 保持期間 | 消し方 | 出どころ |
|---|---|---|---|
| 録音（成立した予約） | 録音完了から**最低 30 日** | `recordings.retain_until` 到達後、日次 Cron が R2 のオブジェクトと行を消す | 決定ブリーフ §3.4 |
| 録音（破棄された受付） | 録音終了から**最低 24 時間** | 同上 | 同上 |
| 録音（`legal_hold = '1'`） | 解除されるまで | 消さない | 同上 |
| 最低保持期間より前の削除要求 | — | **拒否する**（409 `recording_retained`。`retainUntil` / `legalHold` を返す）。画面は「あと N 日は消せません」を出す | 同上 |
| `reception_sessions`（`outcome='discarded'` を含む） | 消さない | — | 「破棄でも残る」（決定ブリーフ §2） |
| `audit_events` | **400 日** | 日次 Cron が `occurred_at` の古い行を消す | §9.2 の容量見積り |
| `idempotency_records` | 24 時間（`expires_at`） | 日次 Cron | §5.4 |
| notifier 側 KV の通知冪等キー | TTL 24 時間 | KV が自動で消す。**このサービスの `SHORT_LIVED` ではない** | `docs/howto/notifications.md` |
| `SHORT_LIVED` の短命状態 | 仮押さえ 420 秒 / PIN 失敗回数 30 秒 / 再生チケット **900 秒** / 短命の確認番号 900 秒 | KV の TTL が自動で消す | §9.1 |
| 統合された顧客 | **消さない**。`merged_into_id` を立てて残す | — | 決定ブリーフ §3.5 |
| `customers` / `customer_prescriptions` / `customer_glasses` / `customer_notes` | 消さない | — | 度数の履歴は次の来店で使う |
| `visit_events` | `reservations` と同じ | — | — |
| `analytics_daily` | **25 か月**（24 か月 + 当月）。日次で作り直す | 日次 Cron が 25 か月より古い行を消す | ANALYTICS-CANCEL |
| `web_bookings.confirmation_key_hash` / `management_code_hash` | 予約と同じ寿命 | 予約の取消から 30 日後に無効化 | — |

- 保持期間の判定に使う「いま」は必ず引数で注入する（§10）。
- 400 日という数は「前年同月と比べられる 365 日 + 締めの余裕 35 日」から決めた。
  `[要確認: Q-02 — いまの前提で進める]`（受付の録音をいつまで残しいつ消すか。いまの前提は上の表のまま —
  成立した予約は録音完了から 30 日、破棄した受付は録音終了から 24 時間、最低保持の中の削除は拒否、監査は 400 日。§13 の #4）

---

## 9. 無料枠の制約

### 9.1 使ってよいもの / いけないもの

| リソース | 無料枠上限 | このサービスでの扱い |
|---|---|---|
| Workers CPU | **10ms / リクエスト** | 空き枠計算は 1 店舗 1 日分の 1 パス（§4.2）。PIN のストレッチはクライアント側、サーバは HMAC 1 回 |
| Workers リクエスト | 100k / 日 | 見積り 5,400 req/日（§4.4）。ポーリング間隔を 60 秒より短くしない |
| **Queues** | Free 可（10,000 ops/日・保持 24h） | **使わない**（テンプレートの設計判断）。通知は notifier への同期送信 + KV 冪等 + 再検知 Cron |
| D1 容量 | **500MB / DB**、かつ **5GB / アカウント合計** | §9.2。400MB（80%）での警告は本来 `services/ops` の役目だが、そのサービスは無い（下の Q-08）。アカウント側の 5GB は `admin` / `example_service` の D1 と共有で、いまの規模（年 175MB）では当たらない |
| サブリクエスト | 外部 50 / Cloudflare 宛 1,000 | N+1 を書かない。台帳 1 日分は `db.batch()` で 1 往復 |
| D1 Time Travel | 7 日 | PITR の主砦にしない。R2 世代バックアップが主砦。**ただし現時点でリポジトリに `services/ops` は存在しない**（`services/` 配下は admin / example_service / glasses_management / notifier の 4 つ） |
| KV 書き込み | **1,000 / 日** | `SHORT_LIVED` は**短命状態だけ**（枠の仮押さえ 420 秒 / PIN の連続失敗回数 30 秒 / 録音の再生チケット 900 秒 / Web 予約の短命の確認番号 900 秒。`design/04-api.md` の KV `SHORT_LIVED` の表）。**API の冪等レコードは D1 `idempotency_records`** に置き、KV には置かない。ポーリング・セッションの生存確認に KV を書かない。見積り: 仮押さえの鍵は 1 予約につき担当 1 + 設備 2 の **3 本**で、工程の中で枠を選び直すと取り直すので 3 店舗 × 20 件/日 ×（初回 1 + 選び直し 2）= **約 540 write/日**。PIN 失敗・再生チケット・確認番号を足しても 1,000 に収まるが、余裕は大きくない |
| **KV 削除** | **1,000 / 日**（書き込みとは**別枠**） | 押さえの取り直し 1 回につき 3 delete。見積り **約 360 delete/日**。TTL で自然に消えるぶんはこの枠を使わないので、**明示的な `delete` は「枠を選び直したとき」だけ**にする |
| **KV list** | **1,000 / 日** | 空き枠エンジンが押さえを読むのに `KV.list({ prefix })` を使う（鍵は `holdId` で、metadata に `kind` / `targetId` / `startsAt` を載せる）。**決定: 押さえを読むのは業務面（`/api/staff/**`）の空き枠計算だけにし、公開面（`/api/public/**`）では KV を読まない。**公開面まで list すると、Web 予約ページに 1 日 400 人が来て 1 人 3 回日時を触るだけで 1,200 list/日 になって上限を越え、**空き枠が丸ごとエラーになる**。お客様に「他の端末が押さえ中」を見せる必要は無く、一次排他は確定時の D1（`reservation_slot_locks`）が担うので二重予約にもならない |
| KV 読み取り | 100,000 / 日 | 上の 3 つより先に当たることはない |
| **D1 Rows read** | **5,000,000 / 日（アカウント全体）** | §9.2。**`admin` / `example_service` の D1 と同じ枠を食う**。台帳の 60 秒ポーリングが最大の消費者 |
| **D1 Rows written** | **100,000 / 日（アカウント全体）** | 1 予約あたり約 50 行（index の 1 行を含む Cloudflare の数え方）。3 店舗 60 件/日 = 3,000 行/日 で 3%。当面問題にならない |
| R2 | 10GB | §9.3 |
| Cron | **5 トリガー / アカウント** | 現時点でリポジトリ内に `triggers.crons` を持つ `wrangler.jsonc` は **0 件**（実測）。このサービスが **1 本だけ**使い、内部でディスパッチする（§9.4） |

`[要確認: Q-08 — いまの前提で進める]`（バックアップと容量の見張りを誰が持つか。`AGENTS.md` と決定ブリーフは
`services/ops` を前提とするが、このリポジトリにそのサービスは無く、復旧手段は D1 の Time Travel の 7 日だけである。
いまの前提は「当面 Time Travel の 7 日で受け入れ、このサービスの Cron 1 枠で D1 のサイズを測って 400MB を超えたら
`alerts` に上げるところまでを持つ」。§11.4 の最終行も同じ問いである。§13 の #5）

### 9.2 D1 容量の見積り（3 店舗 / 1 日 20 予約 / 年 300 営業日）

**予約規模の置き方**: 実績として見えている数は **1 店舗 1 日 12 件**（ANALYTICS-COUNT「8月の合計 320件」÷ 営業日 26 日 =
12.3 件）である。容量・リクエスト数の見積りは**余裕を見て 1 店舗 1 日 20 件**で置く。以下の表と §9.3 はすべて 20 件側で、
`design/04-api.md` の「1 店舗 1 日 12 件の予約規模」は実績側を指している。両方を別の数として使い分ける。

| テーブル | 1 行の目安 | 年間行数 | 年間 |
|---|---|---|---|
| `audit_events` | 500B | 219,000 | **110MB** |
| `visit_events` | 200B | 108,000 | 22MB |
| `reservations` + `reservation_purposes` + `reservation_assignments` | 900B | 18,000 | 16MB |
| `customers` + 度数 + メガネ + メモ | 800B | 累積 20,000 | 16MB |
| `recordings` | 300B | 18,000 | 5MB |
| `analytics_daily` | 120B | 11,000 | 1.3MB |
| その他（設定・端末・Web 予約・冪等） | — | — | 5MB |
| **合計** | | | **約 175MB / 年** |

- このままだと 400MB の警告に **2.3 年**で届く。だから `audit_events` を 400 日で切る（§8）。
  400 日保持なら定常状態で監査は約 120MB に落ち着き、合計は 200MB 前後で頭打ちになる。
- 店舗数が 3 から増えると**全店舗の総和**で効く。10 店舗になると年 580MB で 1 年もたない。
  そのときは (1) D1 Paid 移行 (2) 店舗群でのシャーディング (3) `audit_events` の分離 のいずれかを**人間承認のうえで**選ぶ。

**容量より先に rows read が効く。**台帳 1 本が読む行は概算で 予約 20 + 割当 60 + 目的 40 + 来店進捗 120 +
ウォークイン 10 + 担当 6 + 勤務 12 + 設備 7 + 点検 2 + 営業時間 7 + 停止帯 3 + 目的マスタ 6 + きまり 1 ≒ **300 行**である。

| 店舗数 | 台帳のポーリング | rows read / 日 | 無料枠 5M（アカウント全体）に対して |
|---|---|---|---|
| 3 店舗 | 5,400 req/日（§4.4） | 約 **1.6M** | 32%。空き枠・検索・分析・公開面を足して 2〜3M |
| 10 店舗 | 18,000 req/日 | 約 **5.4M** | **越える** |

- 容量（年 580MB）は 1 年もつが、**rows read は 10 店舗になった初日に越える**。10 店舗に増やすかどうかの判断材料には、
  容量だけでなくこの行数を並べる。先に打てる手は (1) ポーリング間隔を 60 秒より延ばす (2) 台帳の読み取りを
  `json_group_array` で畳んで走査行を減らす (3) D1 Paid 移行 の 3 つで、いずれも**人間承認のうえで**選ぶ。
- rows read は**アカウント全体**の枠なので、`admin` と `example_service` の消費も同じ枠に乗る。

### 9.3 R2 の見積り

| 項目 | 値 |
|---|---|
| 1 受付の録音長 | 平均 約 3 分（`03:12` = LEDGER-DETAIL / CHANGE-SEARCH、`03:24` = EX-UPLOAD-FAILED）。最長はモック実測で 6 分 12 秒（HISTORY-LIST の `03:24 / 06:12`）。見積りは**最長の 6 分**で置く |
| 形式・ビットレート | **`audio/mp4`（AAC 32kbps モノラル）**。iPadOS の Safari の `MediaRecorder` が確実に出せる形式で、60 分でも約 14MB に収まる。`audio/webm` は端末によって取れないので既定にしない（取れる端末では `audio/mp4` を優先する） |
| 1 受付あたり | 6 分 × 32kbps = **約 1.4MB** |
| 同時に保持する量 | 3 店舗 × 20 件/日 × 30 日 = 1,800 件 = **約 2.6GB** |
| 無料枠 | 10GB。3 店舗なら到達しない。**10 店舗になると約 8.6GB** で 10GB に迫るので、そのときは保持 30 日の見直しか Paid 移行を人間承認のうえで選ぶ |
| 1 ファイルの上限 | 100MB（超えたら 413 `payload_too_large`。§5.6） |

### 9.4 Cron（1 本にまとめる）

このサービスが使う Cron は **1 本**（UTC で書き、JST の意図をコメントに残す）。
起動は **1 日 1 回・UTC `55 14 * * *`（= JST 23:55）**とし、その中で次を順に実行する。
1 つが失敗しても後続を止めない（各処理を try/catch で包み、失敗は次回の実行で再評価する）。

| # | 処理 | 頻度 | 失敗したとき |
|---|---|---|---|
| 1 | 保持期限を過ぎた録音を R2 と `recordings` から消す | 日次 | 次回に再評価（自己修復） |
| 2 | 未送信のまま 24 時間を超えた録音（`state IN ('recording','uploading','failed')`）を `alerts` に上げる | 日次 | 未解決の `alerts` が既にあるので新しい行を作らない（§11.1 の重複抑制）。**サーバから再送はしない** — 音声の実体は端末にしかない（§5.6） |
| 3 | **受信日**（`web_bookings.created_at` の JST 日付）のうちに確認されなかった Web 予約（`status='pending'`）を自動取消する | 日次（起動そのものが JST 23:55） | 翌日の実行で取り消す |
| 4 | 400 日を過ぎた `audit_events` を消す | 日次 | 次回 |
| 5 | 期限切れの `idempotency_records` を消す | 日次 | 次回 |
| 6 | 前日分の `analytics_daily` を作る | 日次 | 次回にまとめて作り直す |
| 7 | admin との組織照合（drift 検出） | 日次 | `alerts` に上げる |
| 8 | 営業終了を過ぎても `status='confirmed'` のままの予約を洗い出し、`alerts` に 1 行（`reservation.unclosed`）立てる | 日次 | 次回に再評価 |
| 9 | 各スタッフの `staff_shifts` の展開窓を 62 日先まで延ばす（`staff_weekly_shifts` の曜日パターンから作り直す） | 日次 | 次回に再評価。窓が 35 日を切ったら `store.no_shift` を上げる（§11.3） |
| 10 | 25 か月より古い `analytics_daily` を消す（§8） | 日次 | 次回 |

- **#8 は自動で `no_show` に倒さない。**倒すと「レジが混んで押し忘れただけのお客様」が無断キャンセルとして記録に残り、
  ANALYTICS-CANCEL の内訳と受付履歴の「結果」が実態とずれる。取消理由は人が選ぶ（`design/06-use-cases.md` UC-CHANGE-07）。
  翌朝の「お知らせ」に件数と一覧を出して人に片づけさせる。片づかないと `visit_count`・再来率・取消率がすべて
  現場の押し忘れに従属するので、この 1 本は落とせない。
- **#9 が無いと、最後に SETTINGS-STAFF を保存した日から 62 日を過ぎた日は全担当が勤務外＝全時刻が満席**になる。
  Web 予約は 30 日先まで受け付ける（`design/06-use-cases.md` UC-WEB-04）ので、33 日以上 SETTINGS-STAFF を触らない店舗は
  受付窓の末端が誰も操作していないのに静かに閉じていく。曜日パターン（`staff_weekly_shifts`）を正本にして
  展開結果（`staff_shifts`）を作り直すのが本筋で、この Cron はその窓を先へ送る役目だけを持つ。
- DLQ・リトライキューは無い前提で設計する。失敗の実害は
  **① UI フォールバック（画面に「もう一度送る」を出す）② 再検知 Cron ③ 次回実行での再評価**の 3 つで塞ぐ。
- 再検知で何度も発火するものは、日付や 12h スロットを `id` に含めて連打しない。

---

## 10. 時刻

### 10.1 基準

| 項目 | 決め |
|---|---|
| タイムゾーン | **JST（UTC+9）固定**。夏時間なし。ユーザーごとのタイムゾーンを持たない |
| 保存形式 | 日時 = ISO8601 文字列の `text`（`2026-08-27T11:08:00+09:00`）／日付 = `YYYY-MM-DD`／時刻 = `HH:MM` |
| 「1 日」の境界 | JST の `00:00:00`〜`23:59:59`。UTC の `15:00` が JST の日跨ぎ |
| 週の始まり | **月曜**（SETTINGS-CALENDAR の並びが「月火水木金土日」） |
| 曜日番号 | `store_business_hours.weekday` は **0 = 日曜 … 6 = 土曜**（決定ブリーフ §3.2） |
| Cron | UTC で書く。JST の意図をコメントに残す（例: `55 14 * * *` = JST 23:55） |
| 表示 | 時刻・予約番号・電話番号は `--font-mono`。日付は「2026年8月27日（木）」 |

### 10.2 時刻は引数で注入する

- ドメイン層（`src/worker/domain/**`）で **`Date.now()` / `new Date()`（引数なし）を呼ばない**。
- 純関数の最後の引数に `now: Date` を取る。例:
  `availability(input, now)` / `isSessionExpired(session, now)` / `resolveRetainUntil(recording, now)` /
  `shouldAutoCancel(webBooking, now)` / `isPinLocked(attempts, now)`。
- `now` を作ってよいのはリクエストハンドラの入口と Cron ハンドラの入口だけ。
- テストは `test/*.time.test.ts` に分け、`Date.now()` に依存しない。

### 10.3 必ず書く境界値

| 境界 | ちょうど | ずらしたとき |
|---|---|---|
| 端末の自動ロック 120 秒 | 伏せない | +1 秒で伏せる |
| 端末の自動ロック 120 秒（**非表示のまま経過**） | 非表示のまま 120 秒ちょうどで戻る → 伏せない | 非表示のまま 120 秒 +1 秒が過ぎて戻る → **伏せた状態で戻る**（§6.4） |
| 枠の仮押さえの残り 60 秒（§2.8 の警告） | 残り 60 秒ちょうどで警告を出す | 61 秒では出さない。延長を押すと 420 秒に戻る |
| 個人モードの寿命 120 秒 | 個人のまま | +1 秒で共有へ戻る |
| PIN の 30 秒ロック | まだ入力できない | +1 秒で入力できる |
| 録音の最低保持 30 日 | 削除を拒否 | +1 秒で削除できる |
| 破棄受付の録音 24 時間 | 削除を拒否 | +1 秒で削除できる |
| 冪等レコード 24 時間 | 保存済み応答を返す | +1 秒で新しく実行する |
| 枠の仮押さえ 420 秒（7 分） | まだ押さえている | +1 秒で解放され、他端末が取れる |
| PIN 失敗回数の KV TTL 30 秒 | まだ回数が残っている | +1 秒で回数が消え、また 3 回試せる |
| 録音の再生チケット **900 秒** | ストリームが返る | +1 秒で 401 |
| Web 予約の短命管理コード 900 秒 | 本人確認が通る | +1 秒で 401 `invalid_management_code` |
| 監査 400 日 | 残す | +1 秒で消す |
| Web 予約の受付開始 `accept_from_hours` | 受け付ける | −1 秒で受け付けない |
| Web 予約の受付終了 `accept_until_days`（30 日先） | 受け付ける | +1 日で受け付けない |
| Web 予約の変更・取消の締切（来店日の `change_deadline_days`（既定 `1`）日前の **23:59:59 JST**。既定値では前日 23:59:59） | 変更・取消できる | +1 秒で 409 `change_deadline_passed` |
| Web 予約の自動取消（**受信日**の 23:59:59 JST） | 残す | +1 秒で取り消す |
| 営業時間 10:00–19:00 の端 | 10:00 開始の枠は取れる | 19:00 に終わる枠は取れる。19:00 開始は取れない |
| 休憩帯の端 | 休憩の開始ちょうどに終わる枠は取れる | 休憩に 1 分でも重なる枠は取れない |
| 予約の後ろの `cleanup_minutes`（10 分） | 片付けが終わる時刻ちょうどから次を取れる | 1 秒前は取れない |

日跨ぎ（UTC 15:00）・月跨ぎ（8/31→9/1）・年跨ぎ（12/31→1/1）・うるう年（2028-02-29）を必ず含める。

---

## 11. 監視とアラート

### 11.1 `alerts` の作り方

| 項目 | 決め |
|---|---|
| 誰が作るか | Worker のハンドラ（その場で分かる失敗）と Cron（再評価で分かる失敗） |
| 重複抑制 | 同じ `(organization_id, store_id, code, target_type, target_id)` に `resolved_at IS NULL` の行があるとき、**新しい行を作らない**。`occurred_at` も更新しない。これで再検知 Cron が冪等になる |
| 既読 | `read_at`。「すべて既読にする」で当日分を一括更新する |
| 対応済み | `resolved_at` + `resolved_by`。既読とは別の状態 |
| 分類 | 画面左の4分類は `severity` と `resolved_at` の組み合わせで作る。**「すべて」は未解決の全件**であって「対応済みを含む全件」ではない（ALERTS の実測が すべて 3 = アラート 1 + お知らせ 2、対応済みは別に 12 件）: すべて = `resolved_at IS NULL` / アラート（対応が必要）= `severity='action'` かつ `resolved_at IS NULL` / お知らせ = `severity='info'` かつ `resolved_at IS NULL` / 対応済み = `resolved_at IS NOT NULL` |
| タグ | `severity='action'` の行にだけ「対応が必要」タグを付ける。`severity='info'` は出どころのタグ（「Web予約」）を付けるか、タグ無しにする |
| 表示順 | `severity='action'` が先、その中は `occurred_at` の新しい順。日ごとに「本日 8月27日（木）」の見出しで区切る |
| 文言 | `title` は 1 行で言い切る。`body` を持つときは「予約は成立している / していない」を必ず書く（`body` は無くてもよい — §11.2） |

**決定: 「対応済み」は本日（JST）に `resolved_at` が入ったものを数える。**ALERTS の右ペインの見出しが
「本日 8月27日（木）」で、左ペインの 4 つの数（すべて 3 / アラート 1 / お知らせ 2 / 対応済み 12）はその見出しの下にある。
未解決の 3 分類も同じ日の範囲で数える。**この 4 つの数は全画面共通**で、上のバーのバッジも同じ「未読の総数（3）」を出す
（HOME-PERSONAL の 2 は「お知らせ」カテゴリだけの数で、対応が必要な 1 件が落ちている。バッジが対応必須のアラートを
隠すのは事故なので採らない）。

### 11.2 上げる条件（モック ALERTS の 3 件が実例）

`severity` はモックの分類の件数（アラート 1 / お知らせ 2）から決まる。**「対応が必要」タグが付いているのは
録音の 1 件だけ**なので、Web 予約の確認待ちは `action` ではなく `info` である。

| `code` | `severity` | 発生条件 | `title` の型 | `body` の型 | 画面の操作 |
|---|---|---|---|---|---|
| `recording.upload_failed` | **`action`** | `recordings.upload_attempts >= 3` かつ `state='failed'`、**または** `state IN ('recording','uploading','failed')` のまま `created_at` から 24 時間が過ぎた（§11.4） | 「録音の保存に3回失敗しました」 | 「EY-R-1482　田中 花子 様。ご予約は成立しています。」＋ 残っている端末名（「銀座店 レジ横iPad に残っています」。§5.6） | 「もう一度送る」 |
| `web_booking.pending` | **`info`** | `web_bookings.status='pending'` が 1 件以上ある | 「Web予約が2件、確認待ちです」 | 「本日中に確認しないと自動で取り消されます。」 | 「台帳で確認する」 |
| `equipment.maintenance_scheduled` | `info` | `equipment_maintenance` を登録し、その時間帯に既存の予約が 1 件以上ある | 「視力測定機 B の点検　8月30日 10:00–12:00」 | （無し） | 「影響する予約を見る」 |
| `store.closed_with_reservations` | **`action`** | 定休日・臨時休業・営業時間・受付を止める時間帯の変更を保存した結果、**その時間に予約が残った** | 「9月30日のご予約 3件が休業日に残っています」 | 日時・お客様・目的の一覧（SETTINGS-EQUIPMENT の影響カードと同じ形） | 「影響する予約を見る」 |
| `reservation.unclosed` | **`action`** | 営業終了を過ぎても `status='confirmed'` のままの予約がある（日次 Cron #8） | 「昨日のご予約 2件が受付のまま残っています」 | 日時・お客様・担当の一覧。「ご来店なし」か「お渡しまで完了」を選んで閉じる | 「台帳で確認する」 |

- `target_type` / `target_id` はそれぞれ `recordings` / `web_bookings`（複数件なら店舗と当日を指す合成キー）/ `equipment`。
- 3 件目は本文を持たない。**本文が無くても成立する**設計にする（`body` は nullable 扱い）。
- `body` の「EY-R-1482」は**予約番号ではない**。予約番号は `reservations.code` = `EY-YYMM-NNNN`
  （モックの他画面は `EY-2608-0142` / `EY-2608-0187`）で、`EY-R-…` はこの 1 画面にしか出てこない。
  **決定: 録音を指す人が読む番号（`recordings.code` = `EY-R-NNNN`）を別に持つ。**この本文は「ご予約は成立しています」と
  言い切っているので、予約番号では指せない（予約は無事で、失敗したのは録音だけである）。同じ考えで
  `customers.customer_number`（`G-NNNNN`。CUSTOMER-DETAIL「お客様番号 G-01842」／CUSTOMER-MERGE
  「G-02310 は使えなくなります」）も持つ。どちらも組織 × 年月ではなく**組織で通し**の連番にする。

### 11.3 上げるか要確認のもの

次はこのサービスの失敗経路として存在するが、モックの ALERTS に描かれていない。上げるかどうかを決める。

| 候補 `code` | 想定 `severity` | 条件 |
|---|---|---|
| `notifier.send_failed` | `action` | notifier が 502 を返し、UI フォールバックも出せなかった |
| `org.not_synced` | `action` | `organizations` 行が無い状態（503 `not_synced`）が 15 分続いた |
| `store.no_shift` | `action` | **今日から 35 日先までのいずれかの営業日**に `kind='work'` の `staff_shifts` が 0 件（Web 予約の 30 日 + 締めの余裕 5 日）。「翌営業日だけ」を見ると、勤務の展開窓が 62 日先で尽きる事故（§9.4 の Cron #9）を検知できない |
| `web_booking.auto_cancelled` | `info` | **受信日**のうちに確認されず自動取消した |
| `d1.capacity_warning` | `action` | D1 が 400MB（80%）に達した ※ 本来 `services/ops` の担当範囲だが、そのサービスは現在このリポジトリに無い（§9.1） |

**決定: 運用のアラート（上の 5 件）を業務の「お知らせ」に混ぜない。**ALERTS は店舗スタッフが「次に何をするか」を
読む面であり、`notifier.send_failed` / `org.not_synced` / `d1.capacity_warning` のような運用の失敗を同じ列に積むと
「対応が必要」の意味が薄まる。`alerts` の行としては作る（記録は要る）が、**`audience='ops'` を立てて ALERTS の
4 分類から外し、運用の面（設定 › 端末とスタッフの下）にだけ出す**。`store.no_shift` と `web_booking.auto_cancelled` は
店舗が手を打つ話なので業務側（`audience='store'`）に出す。

### 11.4 監視（Cron が毎回再評価するもの）

| 対象 | 判定 | 上げ先 |
|---|---|---|
| 未送信のまま 24 時間を超えた録音 | `recordings.state IN ('recording','uploading','failed')` かつ `created_at` が 24 時間以上前 | `alerts`（`recording.upload_failed`。§11.2 と**同じ code** なので §11.1 の重複抑制が効き、同じ録音に 2 行は立たない） |
| 確認されていない Web 予約 | `web_bookings.status='pending'` | `alerts`（`web_booking.pending`） |
| admin との組織の食い違い | `organizations.revision` が admin と一致しない | `alerts` + notifier |
| 未展開の勤務 | `staff_shifts` の最終日が今日から 35 日先を下回っている | `alerts`（`store.no_shift`。§11.3） |
| 閉じ忘れた予約 | 営業終了を過ぎて `reservations.status='confirmed'` | `alerts`（`reservation.unclosed`。§11.2） |
| D1 容量・バックアップの鮮度 | 本来 `services/ops` の担当だが、そのサービスはこのリポジトリに存在しない（§9.1） | §9.1 の発注元への確認（§13 の #5）と同じ問い。決まるまでは Cron 1 枠で D1 のサイズだけを測り、400MB を超えたら `alerts`（`d1.capacity_warning`・`audience='ops'`）に上げる |

---

## 12. 完了の判定

この文書の要求は、次がすべて緑になったときに満たされたとみなす。

| 項目 | 確認の仕方 |
|---|---|
| テナント分離 | `services/glasses_management/test/tenant-isolation.test.ts`（3 テナント以上・偽装入力・越境 read/write） |
| 権限 | `test/permissions.test.ts`（未認証 / staff / 店長 / 期限切れ / 別 secret 署名 / 未知パス の表駆動） |
| 時刻の境界 | `test/*.time.test.ts`（§10.3 の全行を「ちょうど」と「±1 秒」で） |
| 失敗のフォールバック | `test/*.integration.test.ts`（notifier 502 で予約が残る・冪等キーが残らない・`emailed:false` が返る） |
| カバレッジ | Worker/integration 各 80% 以上、React web 各 60% 以上 |
| 冪等 | `test/*.integration.test.ts`（§5.4 の 6 本に同じ `Idempotency-Key` を 2 回送って行が増えないこと、内容違いで 409 `idempotency_conflict`、`in_progress` で 409） |
| 楽観ロック | `test/*.integration.test.ts`（§5.5。版が合わないとき 409 `version_conflict` が返るだけでなく、**予約・割当・目的・`reservation_slot_locks`・`audit_events` のどれも 1 行も書き換わっていない**こと。設定 7 画面の `store_settings_revision` でも同じ 1 本） |
| アクセシビリティ | `e2e/accessibility.spec.ts`（新設）。①`button, [role=button], a, input, select, [role=switch], [role=tab]` の `getBoundingClientRect()` を全部取り、**44pt 未満を列挙して 0 件**にする（§2.1(b) の 4 種は当たり判定を広げてあるので通る。例外は作らない） ②`:focus-visible` が全操作に出て、緑の面では `--color-focus-on-pine` が当たる ③200% 拡大で `body` に横スクロールが出ない ④`role="status"` が §2.3 の 7 か所と一致し、`role="alert"` が `Field` の項目エラーだけ ⑤`<header>` / `<nav aria-label="画面の切り替え">` / `<main>` が各画面に 1 つずつある |
| 狭い画面・低い画面 | `e2e/` の Playwright project を §1.2 の段ごとに持つ（`ipad-mock` 1194×834 = モックとの突き合わせ用／`ipad-safari` 1194×744 = Safari のタブのままの実機相当／`ipad-portrait` 834×1194／`ipad-split` 375×744）。1194×834 の 1 本だけにしない |
| トークン | `packages/ui/src/theme.css` に方言（`terminal-` / `viz-` / `sp-` / `compact-`）が残っていない（**現状すでに 0 件** — §3.3）。`services/glasses_management/src/web/**` に生 hex と Tailwind 任意値が 0 件 |
| 見た目の突き合わせ | `e2e/mock-compare.spec.ts` で `docs/frontend/mockups/eyex/images/*.png` と実装画面の差分を記録する |
| traceability | `pnpm run test:traceability` |
| 全体 | `pnpm check` |

---

## 13. この文書に残っている `[要確認]`

**残っているのは発注元（EYEX）に聞かないと決められない 5 件だけ**である。ほかはすべてモック・決定ブリーフ・
設計判断で決着させ、本文に決定として書き込んだ（下の「決着させたもの」）。暫定案は「返事が来るまでこれで作る」
という意味であり、返事が来たら差し替える。

問いの**台帳は `design/09-open-questions.md`（全 12 件）**である。下の 5 件はそのうち**この文書の数値に効くもの**で、
`Q` 列がその対応番号である（本文中の `[要確認: Q-NN — いまの前提で進める]` もすべてこの番号を指す）。
残り 7 件（Q-01 / Q-03 / Q-04 / Q-07 / Q-09 / Q-11 / Q-12）は数値に効かないので本書には現れない。

| # | Q | 節 | 聞くこと | 決まらないと作れないもの | 暫定案（＝いまの前提。このとおりに作る） |
|---|---|---|---|---|---|
| 1 | **Q-05** | §1.1 | 業務用の iPad に、この画面をどう入れるか（①ホーム画面に追加して単独のアプリとして使う ②Safari のタブのまま使う ③専用アプリで包む） | 画面の有効高（§1.2 の段）、台帳に入る枠数、EX-MIC-DENIED の直し方 3 手順の文言（②では「設定 › EYEX予約」が存在しない）、マイク許可の寿命、`viewport-fit=cover` と安全領域のトークン | ①（ホーム画面に追加）。`manifest.json` と `apple-mobile-web-app-capable` を足し、モックの 3 手順の文言をそのまま使う |
| 2 | **Q-06** | §2.8 | 接客の途中で時間切れになってよいものはどれか。とくに、お客様と話している間に枠の仮押さえ（7 分）が切れて、その枠が黙って別の端末へ渡ってよいか。伏せる判定に VoiceOver のフォーカス移動を数えるか | 自動ロック 120 秒・個人モードの寿命 120 秒・仮押さえ 420 秒・短命の確認番号 900 秒・再生チケット 900 秒の 5 つについて「必須として警告なしで切る」か「20 秒以上前に警告して延ばせる」か。延長を認めるなら `PATCH /api/staff/holds/:holdId` が 1 本増える。WCAG 2.2 AA 2.2.1 の答えでもある | 自動ロックと個人モードは「必須（essential）」として免除を主張（伏せるだけで作業は消えない）。仮押さえは残り時間を画面に出し、残り 60 秒で警告して延ばせるようにする |
| 3 | **Q-10** | §7.2 | お客様の「注意ごと」や設定の下書きを、店長が承認してから表に出す運用があるか。承認できるのは誰か | `customer_notes.status`（`draft` / `published` / `hidden`）の遷移、EX-PERMISSION の「この下書きを店長に依頼する」の行き先、依頼の一覧と承認の画面、依頼をどう知らせるか | 承認は要る（`draft` → 同じ店舗の店長が `published`）。依頼はお知らせに 1 件立て、ALERTS から承認の面へ入る |
| 4 | **Q-02** | §8 | 受付の録音を、いつまで残し、いつ消すか。個人情報保護法・社内規程・チェーンの内部監査から、別途の保持義務・削除義務（監査ログを含む）が課されるか | `recordings.retain_until` の計算、掃除の Cron、`legal_hold` の運用、R2 の容量見積り、お客様への説明文 | 決定ブリーフ §3.4 のまま（成立した予約は録音完了から 30 日、破棄した受付は録音終了から 24 時間、最低保持の中の削除は拒否）。監査は 400 日 |
| 5 | **Q-08** | §9.1 / §11.4 | このサービスのデータのバックアップと容量の見張りを、誰が持つか | R2 への世代バックアップ・D1 容量 400MB の警告・鮮度監視の置き場所。いまリポジトリに `services/ops` が無く、復旧手段は D1 の Time Travel の 7 日だけである | 当面 Time Travel の 7 日で受け入れ、このサービスの Cron 1 枠で「D1 のサイズを測って 400MB を超えたらお知らせに上げる」だけを持つ |

### 決着させたもの（この表に載っていた過去の項目）

いずれも**モックの実測・決定ブリーフ・設計判断**で決めた。決定は本文の各節に断定で書いてある。

| 旧 # | 節 | 決めたこと |
|---|---|---|
| 2 | §1.2 | 台帳は **14 枠を表示窓**にし、残りは横スクロール（承認済みの 3 面がいずれも 14 列） |
| 3 | §1.3 | **375px でも予約フロー 5 工程を完了できる**ことを要件にする（専用画面は作らない） |
| 4 | §2.2 | 物理キーボードの行は**残す**（`inputMode="none"` は物理キーボードを塞がない） |
| 5 | §2.3 | 台帳は **`role="grid"`**。またがる帯は先頭セルにだけ置き `aria-colspan` で幅を伝える（5 点すべて決着） |
| 6 | §2.4 | 未読には**「未読」の札を足す**（色だけでは色覚差のある目に伝わらない） |
| 7 | §2.4 | 赤い帯は**「担当が未定」以外の意味を持たない**。帯に必ずその文字を添える |
| 8 | §2.4 | 台帳の緑の帯に出どころの語を**出さない**。出どころの 4 語（お電話 / 店頭 / Web予約 / ウォークイン）はリストと詳細で出す |
| 9 | §2.5 | 埋まった枠は**地を明るくして**解決する（`--color-busy-soft` を新設。文字は `--color-ink-muted`） |
| 10 | §2.7 | 左の色帯と display 書体は **DESIGN_RULE の NEVER 表からの免除**として mockups/README に台帳化する |
| 12 | §3.2 | `--color-amber` は**失敗ではない注意**に割り当てて残す（「要確認」の札・「初めて」・影響カード） |
| 13 | §3.2 | 15px / 14px の段は**足さない**（16px / 13px に丸める） |
| 14 | §3.2 | `.card.warn.lead` の左帯は **4px** に寄せてトークン化。余白は外周・かたまり・安全領域の 3 トークンを足す |
| 15 | §3.3 | `record` / `timer` / `glyph` / `figure` / `text-glyph` / `text-figure` は **`theme.css` に戻す** |
| 16 | §5.3 | 予約フローの下書きは**サーバ側（`reception_sessions`）に持たせる**。「あとで続ける」の出口を足す |
| 17 | §5.8 | 端末の**遠隔破棄は作らない**（`revoked_at` で以後の送信・再生を拒むところまで） |
| 18 | §6.3 | **`AUTH_PEPPER` を決定ブリーフ §1 の secrets 一覧に足す** |
| 19 | §6.4 | スタッフ個人の PIN は **`staff.pin_hash` / `staff.pin_updated_at`**（`design/03-data-model.md` §5.1 で解決済み） |
| 20 | §6.4 | 再認証は **`POST /api/staff/terminals/:terminalId/elevate`** の 1 本 |
| 22 | §8 | `analytics_daily` は **25 か月**（24 か月 + 当月） |
| 25 | §9.3 | 録音は **`audio/mp4`（AAC 32kbps モノラル）** |
| 26 | §11.1 | 「対応済み」は**本日（JST）に `resolved_at` が入ったもの**。4 つの数は全画面共通 |
| 27 | §11.2 | 録音は **`recordings.code`（`EY-R-NNNN`）** を別に持つ（顧客は `G-NNNNN`） |
| 28 | §11.3 | 運用アラートは **`audience='ops'`** で業務の「お知らせ」から外す |
| 旧 3 / 旧 4 | §2.5 / §3.2 | プレースホルダと罫線のコントラストは**決定ブリーフ §12.1 で解決済み**（`--color-ink-faint` 5.31:1 / `--color-line-strong` 3.55:1 / `--color-pine-line` 3.53:1） |
