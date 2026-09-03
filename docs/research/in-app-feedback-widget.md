# アプリ内フィードバック・ウィジェット（録画/録音つき問い合わせ）— 市場・技術・設計・知財

- 調査日: 2026-09-03（§1〜§8）／2026-09-03 第2次（§9）
- 対象: 画面右下バブル型のウィジェットから、画面録画・音声・マウス操作を記録し、タイトルを付けてそのまま SaaS 運営会社へ送信。AI が即答、または要望チケット化する仕組み。
- 前提リポジトリ: Cloudflare-only モノレポ（Workers + D1 + R2 + KV、**完全無料枠**）。ルートの `CLAUDE.md`（= `AGENTS.md`）の絶対ルールに従う。
- 本ドキュメントは調査 + 設計案。**挙動が変わる実装に入る前に `specs/<service>/features/NNN-feedback-widget/spec.md` を SDD で起票すること**（絶対ルール 1）。
- ⚠️ **知財に関する記述（§5〜§9）は弁理士・弁護士による法的助言ではない。** 一次資料にもとづく叩き台であり、価値は「弁理士に相談する前に論点を絞っておく」ことにある。

## この文書の読み方

**追記を重ねているため、後の章が前の章の結論を訂正している箇所がある。** 上から順に読む場合は、各章の冒頭にある更新ポインタに従うこと。

| 章 | 内容 | 状態 |
|---|---|---|
| §1〜§4 | 競合マップ・技術的制約・設計・法規制 | 有効 |
| §5 | 特許は取れるか（先行技術・§101・統計） | 有効 |
| §6 | 権利範囲の作り方（A〜D の4案） | **A案は §7 で失効**（無料枠の制約を外したため技術的課題が消えた） |
| §7 | 実在の登録クレームから逆算した「取れる形」 | 有効。**B案（同期・マスキング漏れ検出）が第1候補** |
| §8 | 意匠ルート（第1次・部分的） | **§9 で 8.3 と 8.5 が反転。単独で読まないこと** |
| §9 | 意匠ルートの結論と、設計を変える発見 | **最新。ここが結論** |

---

## 0. 結論

### 製品・技術（§1〜§3）

1. カテゴリは既に成熟している。**録画できること自体に差別化はない**（Userback は無料プランでも録画・注釈が使える）。差別化は「送信後に何が起きるか」＝**AI 即答と要望チケット化**にある。
2. ブラウザの物理的制約により、**サードパーティ iframe に埋めた「ウィジェット型」は拡張機能型に構造的に劣後する**（クロスオリジン記録不可、`getDisplayMedia` にフレーム自身のユーザー操作が必要、画面音声はデスクトップ Chromium のみ ≒ 27.5%）。→ **自社 SaaS へ第一者スクリプトとして直接埋め込む前提なら、この制約はほぼ全部回避できる。これが我々の最大の優位。**
3. Cloudflare 無料枠では**サーバ側で映像を触れない**（CPU 10ms/req）。実装は「クライアントで rrweb を収集・マスキング・圧縮 → Worker は R2 へストリーム透過 → メタのみ D1」の一択。**MediaRecorder による実動画録画は第1フェーズでは採用しない。**

### 知財（§5〜§9）

4. **導線そのもの（録画→AI 回答→チケット化）の発明特許は難しい。** *Electric Power Group* が逃げ道を先回りして塞いでおり、rrweb の中核（DOM 再構成・差分圧縮・要素マスキング）も他社の生きた登録特許に正面から当たる。
5. **本命は日本の画像意匠。** 令和元年改正で SaaS 画面が保護対象になり、**11万円台・審査6か月（早期なら2か月）・存続25年・§101 なし・許可率が高い**。米国意匠より条件が良い。発明特許を出すなら **B案（DOM イベント列と音声の時刻同期／マスキング漏れの事後検出）1本**に絞る。
6. ⚠️ **実装前に必ず読むこと（§9.4）。** **US 11,327,625 B2（Truist Bank、Active、2040年満了）**が「透明オーバーレイ＋座標→DOM 要素のソースコード送信」を押さえている。**①オーバーレイは操作を遮断しない ②要素はソースコードではなくセレクタで送る** —— この2点を守らないと素直な実装が踏む。

---

## 1. 競合マップ

市場は3クラスタに割れており、我々の構想は3つの交点にある。

| クラスタ | 代表 | 起点 | 課金対象 |
|---|---|---|---|
| A. 視覚フィードバック（クライアントレビュー） | Marker.io / BugHerd / Usersnap / Pastel / Ruttl | Web サイトへの注釈 | 席数・プロジェクト数 |
| B. 開発者コンテキスト取得（バグ再現） | Jam.dev / BetterBugs / Disbug / Birdeatsbug / Crosscheck / OpenReplay Spot | ブラウザ拡張での再現トレース | 作成者（creator）数 |
| C. 監視・セッションリプレイ | Sentry Replay / LogRocket / FullStory / Hotjar / Clarity / PostHog | 全セッション常時録画 | 従量（リプレイ件数） |
| D. 要望管理 | Canny / Featurebase / Productboard / UserVoice | 機能要望の投票・ロードマップ | 席数 |

Userback は自社の比較ページで **Usersnap / Pendo / UserVoice / Productboard / Canny / Jam.dev / Hotjar / BugHerd / Marker.io / Instabug（現 Luciq）の10社**を競合として列挙しており、A と D をまたぐ構造がベンダー自身の認識としても確認できる（自己申告のポジショニングである点は割り引くこと）。

### 主要プレイヤー比較

| 製品 | 形態 | 録画 | 音声 | console/network | AI | ホワイトラベル | 料金の要点 |
|---|---|---|---|---|---|---|---|
| **Userback** | 埋め込みウィジェット + 拡張 + モバイル SDK | ✅ 下位プランから | ✅ | ✅（Jira 添付） | ✅ フィードバック要約 | 有 | Free / Team $29（年払・5席） / Business $79（席無制限） / Business Plus $159 / Enterprise |
| **Marker.io** | 埋め込みウィジェット | ✅ | — | ✅ | ✅ | ✅（Agency 系） | Starter $39/月（年払・3席）→ **console/network/session replay は Team $149 から**。恒久無料枠なし、15日試用 |
| **BugHerd** | 埋め込み + 拡張 | ✅ | — | ✅ | — | ✅ Studio 以上 | Standard $39（5席）/ Studio $59（10席、ホワイトラベル）/ Premium $150（25席） |
| **Usersnap** | 埋め込みウィジェット | ✅ | — | ✅ | ✅ | ✅ **$369/月〜** | 無料枠あり、ホワイトラベルは高額 |
| **Jam.dev** | Chrome 拡張中心 | ✅ 実動画 | ✅ | ✅ | ✅ 再現手順を自動生成 | — | Free + Team **$14/creator/月**（年払） |
| **Sentry Session Replay** | SDK | DOM 再構成 | — | ✅ | ✅ | — | Dev 無料 / Team $26 / Business $80 + **従量（超過リプレイ ≒ $5/1,000件）** |
| **LogRocket** | SDK | DOM 再構成 | — | ✅ | ✅ | — | 無料 1,000 セッション/月（保持短） + 従量 |
| **OpenReplay / rrweb** | OSS・セルフホスト | DOM 再構成 | — | ✅ | — | 自由 | 無料（自前運用コスト） |
| **Intercom Fin** | チャットウィジェット | — | — | — | ✅✅ 解決率 67% を主張 | 有 | 解決課金。2026-06 に Salesforce が約 $3.6B で買収合意 |

### 読み取れる価格戦略（重要）

**録画は集客の餌、課金の壁は「深さ」に置かれている。**

- Userback: スクショ・注釈・録画は下位から → **フィードバックに紐づくセッションリプレイは Business($79)** → **全セッション常時録画は Business Plus($159) でカスタム課金**、という二段の壁。
- Marker.io: ウィジェットは Starter($39) から → **console/network/session replay は Team($149)**。壁がより高い位置にある。
- BugHerd / Usersnap: **ホワイトラベルが壁**（$59 / $369）。B2B SaaS への OEM 需要が現に存在する証拠。
- Sentry / LogRocket: 従量。リプレイを全面 ON にすると請求が 2〜4 倍になるという報告が繰り返し出ている。

→ 我々が自社 SaaS 内に持つ場合、**この課金体系はコスト構造の警告として読む**。「全セッション常時録画」は商用ベンダーですら最上位プラン扱いの重コストであり、無料枠で真似てはならない。

### 空白地帯（我々の狙う位置）

誰も埋めきっていないのは次の連結である。

```
録画つき問い合わせ  →  AI が即答（解決）  →  解決しなければ要望チケットへ昇格  →  ロードマップに反映
     (A/B)                  (Intercom Fin)              (Canny/Featurebase)
```

Jam.dev は AI で再現手順を作るがそこで止まる。Intercom Fin は即答するが録画コンテキストを持たない。Canny は要望を集めるが録画を持たない。**「録画された文脈を AI が読んで即答し、駄目なら要望に化ける」単一導線**が空白。かつ我々は自社 SaaS への第一者埋め込みなので、org / user / ルート / 直近エラーが**質問しなくても既に分かっている**。これは外部ベンダーには原理的に出せない品質差になる。

---

## 2. 技術的制約（設計を規定する事実）

### 2.1 「録画」には別原理の2方式がある

| 方式 | 実体 | サイズ | 採用 |
|---|---|---|---|
| **DOM 再構成型（rrweb 系）** | 初期 DOM スナップショット + `MutationObserver` による変異 + 入力イベントを記録し、再生時に DOM を再構築 | 数百 KB/分。再生中に HTML を inspect / scrub 可 | **採用** |
| **実動画型（`getDisplayMedia` + `MediaRecorder`）** | 画面のピクセルを録る | 数十 MB/分 | **第1フェーズでは不採用** |

Sentry / LogRocket / FullStory / Hotjar / Clarity / PostHog はすべて前者。Jam.dev / Birdeatsbug / OpenReplay Spot は後者を併用する。**同じ「録画」という語で別物を指している**ので、競合比較のときは必ず区別すること。

### 2.2 実動画型を選ぶと踏む地雷

1. **クロスオリジン iframe が録れない。** rrweb で子フレームを録るには**親と子の双方**に `record({ recordCrossOriginIframes: true })` を注入する必要があり、子は自前 emit せず `postMessage` で親へ転送する。親に rrweb がなければイベントは消える。公式 recipe が挙げる注入手段は「両ページを自分で所有」「ブラウザ拡張の content script」「Puppeteer」「Electron preload」の4つだけ。**第三者ドメインへ1タグ配るだけでは届かない ＝ 競合が軒並み拡張機能型を併売している構造的理由。**（`postMessage` は非暗号化である旨の警告も公式にある）
2. **埋め込みフレームは自分でユーザー操作を取り直す必要がある。** 親のクリックはクロスオリジン子フレームへ伝播しない（transient activation は祖先方向にしか越境しない仕様）。親でクリック → `postMessage` → iframe 内で `getDisplayMedia` は `InvalidStateError` になる。加えて `allow="display-capture"` の明示付与も要る（既定は `self`）。
3. **画面音声はほぼ録れない。** `getDisplayMedia` の音声キャプチャはデスクトップ Chromium 系のみ、**グローバル利用率約 27.5%**。Firefox は全バージョン非対応で**エラーも出さず黙って音声を捨てる**。Safari はデスクトップ 27 / iOS 26.6 まで非対応。Android Chrome / iOS Safari は `getDisplayMedia` 自体が無い。
   - → **マイク音声は `getUserMedia` + `MediaRecorder` で全ブラウザ取得できる。ユーザーの「呟き」はマイク前提で設計すれば成立する。** ここが実務上の分かれ目。
4. 高解像度で `MediaRecorder` が `EncodingError` を投げ**無音で失敗する**実例がある（5K ディスプレイ）。

**結論:** 我々は自社 SaaS の第一者スクリプトなので (1)(2) は回避できる。しかし (3) は回避不能。したがって**「画面 = rrweb、音声 = マイク、ポインタ = rrweb 標準」**が唯一素直な構成。

### 2.3 法規制

- **GDPR**: アクセス権（Art.15、Art.12(3) により原則1か月以内に回答・コピー提供）、消去権（Art.17、ただし Art.17(3) の例外あり）、異議権（Art.21）が**録画データにも及ぶ**。該当セッションを特定して削除する手順の文書化と自動化が要る（手順文書化の要請自体は Art.5(2) アカウンタビリティ由来）。
- **米カリフォルニア CIPA §631(a)**: 全当事者の同意なき通信内容の傍受を禁止し、**1違反 $5,000 の私的訴権**を持つためクラスアクション化しやすい。第9巡回区 *Javier v. Assurance IQ*（2022-05、事後同意を否定）を起点にセッションリプレイ導入サイトへの提訴が急増。
  - **ただし判例は分裂している。** 2025-06 の Papa John's / FullStory 事件では party exception により却下が是認された一方、*Mikulsky v. Bloomingdale's* では却下が破棄。**「導入 = 違法」ではない。** CA SB 690（商業目的の例外）が成立すれば前提が変わる。
- **日本**: 個人情報保護法上、画面録画は取得目的の特定・通知公表が要る。録音は「呟き」を録る以上、**明示同意 UI を必須**とする。
- ⚠️ **重要な否決事項**: 検証工程で「rrweb のマスキングはキャプチャ時に行われ元の値は保存録画に入らない」「マスキングは送信前クライアント側で行われ機微データはそもそも収集されない」という2つのクレームは**いずれも 3人の検証者全員に否決された**。**マスキングの実効性を無条件に前提にしてはならない。** 設計はマスキング漏れが起きる前提で組む（下記 §3.4）。

### 2.4 Cloudflare 無料枠の壁

| リソース | 無料枠 | 効き方 |
|---|---|---|
| Workers リクエスト | **100,000 req/日**（00:00 UTC リセット、既定は超過で Error 1027 = fail-closed） | チャンク分割を細かくすると即枯渇 |
| Workers CPU | **10ms / リクエスト**（メモリ 128MB は全プラン共通） | **サーバ側の変換・再圧縮は不可能**。docs 自身が「認証や大きなペイロードのパースで典型 10〜20ms」と書いている |
| KV 書き込み | **1,000 keys/日** | **最も早く枯渇する。** セッション単位の冪等キーを KV に置く設計は 1,000 セッション未満で破綻 |
| D1 | 書き込み 100,000 rows/日・5GB | メタデータ用途なら十分 |
| R2 | 10GB | 録画本体の置き場 |

- **静的アセット配信は無料・無制限でリクエスト数にカウントされない** → ウィジェットの JS バンドル配信は予算を消費しない。
- **fetch / KV / R2 の待ち時間は CPU time に算入されない** → **リクエストボディを R2 へストリーム透過する設計は 10ms 内で成立する**。これが唯一の道。
- Workflows も Free は step あたり 10ms。`cpu_ms` の引き上げは有料の Standard Usage Model 限定で、Free に正規の回避手段はない（恒常超過は Error 1102 で打ち切り）。

---

## 3. 設計

### 3.1 全体像

```
[顧客のブラウザ  自社 SaaS SPA]
  packages/ui  <FeedbackWidget />       右下バブル
     ├ rrweb.record()  直近 N 秒をリングバッファ（送信するまで外に出さない）
     ├ getUserMedia + MediaRecorder     マイク音声のみ（opus）
     ├ マスキング（maskAllInputs 既定 ON）+ CompressionStream('gzip')
     └ 送信                                 ─┐
                                             │ 1 セッション = 1 オブジェクト
[services/feedback  Worker]                  │
  POST /api/feedback            ←────────────┘
     ├ R2.put(body)             ストリーム透過。パースしない（CPU 10ms 死守）
     ├ D1 insert  メタ 1 行     org_id / user_id / title / route / status
     └ notifier へ service binding で同期送信（既存の x-internal-key 経路）

  POST /api/feedback/:id/ask-ai   ユーザーが「AI に聞く」を押したときだけ実行
     └ Workers AI  ← D1 のメタ + コンソールエラー + タイトル + 音声書き起こし

[運営側 services/admin  受信トレイ]
  一覧 → rrweb 再生 → AI 下書き回答 → 返信 / 要望チケットへ昇格
```

### 3.2 サービス配置（リポジトリ規約への当てはめ）

- **新サービス `services/feedback`（`@app/feedback`）を追加**する。1 サービス = 1 Worker + 1 D1 + R2 バインディング。`.agents/skills/new-service` で雛形を作る。
  - ⚠️ 新サービス追加・DB スキーマ変更は **plan mode + 人間承認が必要**（`CLAUDE.md` エージェント固有メモ、絶対ルール 10）。R2 バインディングの追加もアーキ変更にあたる。
- **ウィジェット本体は `packages/ui` に置く**。全サービスの SPA から `<FeedbackWidget />` 1 行で載る。色・角丸・フォントは `packages/ui/src/theme.css` のセマンティックトークンのみ（絶対ルール 5。Tailwind デフォルトパレット・任意値は禁止）。
- **型は `packages/contracts/src/feedback.ts` に Zod 単一ソース**。バックは `zValidator` インライン、フロントは `hc<AppType>`（type-only import）。ルートはチェーンして `export type AppType = typeof routes`（絶対ルール 3・4）。
- **通知は既存の notifier へ service binding で同期送信**。Queues は使わない（絶対ルール 9）。
- **全クエリを `organization_id`（JWT の `org`）でスコープ**（絶対ルール 6）。cross-D1 JOIN 禁止なので、org 情報は admin からの既存同期経路に乗せる（絶対ルール 8）。

### 3.3 データモデル（D1、Drizzle。FK 宣言しない・ID はアプリ生成）

```ts
// services/feedback/src/worker/schema.ts（案）
feedback_reports
  id                 text  pk        // crypto.randomUUID()
  organization_id    text  not null  // ← 全クエリでスコープ
  reporter_user_id   text  not null
  title              text  not null
  body               text                       // ユーザーが打った補足
  route              text                       // 発生画面のパス
  user_agent         text
  console_errors     text                       // JSON 文字列（直近 N 件）
  replay_object_key  text                       // R2 キー。null 可（録画なし送信）
  audio_object_key   text                       // R2 キー。null 可
  transcript         text                       // 音声書き起こし（後追いで埋まる）
  ai_answer          text                       // AI 即答の本文
  ai_answered_at     integer
  status             text  not null             // new|ai_answered|human_replied|promoted|closed
  promoted_issue_id  text                       // 要望チケットへ昇格したときの参照
  consent_recording  integer not null           // 録画同意（0/1）— 監査証跡
  consent_audio      integer not null           // 録音同意（0/1）
  created_at         integer not null
  deleted_at         integer                    // GDPR 消去権。論理削除 → Cron で R2 実削除
```

**冪等キーは KV に置かない。**（1,000 writes/日で破綻する）。クライアント生成の UUID を **R2 のオブジェクトキーそのもの**にし、重複 PUT は上書きで吸収する。D1 側は `id` の一意性で担保。

### 3.4 プライバシー設計（マスキングを信用しない前提）

1. **多層防御**: `maskAllInputs: true` を既定 ON にした上で、`password` / `credit-card` / 個人情報を含む要素には `data-feedback-block` を付けてブロック（`blockClass`）。**マスキングは効かないことがある前提で、機微画面ではウィジェット自体を無効化する allowlist/denylist をルート単位で持つ。**
2. **明示同意 UI**: 録画・録音の開始前に「何を記録するか」を具体列挙した同意を取り、`consent_recording` / `consent_audio` に監査証跡として保存する。事後同意は *Javier* で否定されている。
3. **保持期間を短く固定**（例: 90日）。Cron で `deleted_at` 経過分と保持超過分の R2 オブジェクトを実削除。GDPR Art.17 の**削除手順を運用文書として書く**。
4. **送信するまで外に出さない**。リングバッファはクライアントメモリに留め、ユーザーが「送信」を押した瞬間だけアップロードする。**全セッション常時録画は実装しない**（無料枠でもコンプライアンス上も持てない）。

### 3.5 API 契約（Hono RPC。同一オリジンなので CORS は書かない）

| メソッド | パス | 用途 |
|---|---|---|
| `POST` | `/api/feedback` | メタ + 本文を作成。R2 アップロード用の情報を返す |
| `PUT` | `/api/feedback/:id/replay` | rrweb gzip をストリームで R2 へ透過。**パースしない** |
| `PUT` | `/api/feedback/:id/audio` | 音声（opus）を同上 |
| `POST` | `/api/feedback/:id/ask-ai` | AI 即答を生成。ユーザーが押したときだけ |
| `GET` | `/api/feedback` | 運営側の受信トレイ一覧（org スコープ + 運営 org のみ横断可） |
| `GET` | `/api/feedback/:id/replay` | 署名付きで再生データを返す |
| `POST` | `/api/feedback/:id/reply` | 運営からの返信。notifier 経由で通知 |
| `POST` | `/api/feedback/:id/promote` | 要望チケットへ昇格 |
| `DELETE` | `/api/feedback/:id` | GDPR 消去。論理削除 + R2 削除予約 |

### 3.6 テスト方針（`CLAUDE.md`「テストの厚み」の当てはめ）

必ず境界値まで書く。配置は代表フローの integration テストと分ける。

1. **`permissions.test.ts`（表駆動・全エンドポイント）** — admin / staff × 運営 org / テナント org × 未認証 / 期限切れ / 別 secret 署名。**未知パスも入れて default-deny を証明**。新ルート追加時は表に1行足す。
2. **`tenant-isolation.test.ts`** — 他テナントのフィードバックが**見えない・書き換えられない・偽装 org_id で越境できない**。1本必須。
3. **`*.time.test.ts`** — 保持期間の境界（ちょうど90日・±1秒）、JST 日跨ぎ、署名 URL の期限。**時刻は必ず引数注入**。`Date.now()` に依存したテストは書かない。
4. **フォールバック** — notifier 送信失敗、R2 PUT 失敗、AI 応答失敗を**握りつぶした事実（ログ・戻り値）まで検証**。特に R2 が失敗したのに D1 行だけ残る不整合。
5. **同意フラグ**が false のとき録画・音声が**送信されない**ことのテスト（法務要件をテストで固定する）。
6. カバレッジ下限: frontend 60% / backend 80%（各指標）。E2E は Approved spec の全 UC/AC にちょうど1本ずつ対応させ、`pnpm run test:traceability` を緑にする。

### 3.7 段階リリース

| フェーズ | 内容 | 判断根拠 |
|---|---|---|
| **P1** | 右下バブル → スクショ + 注釈 + **タイトル** + 本文 → 送信。org/user/ルート/直近 console error を自動添付。運営側受信トレイ。 | 録画なしでも Userback の Free〜Team 相当の価値。ブラウザ制約をゼロで越えられる |
| **P2** | **マイク音声**（呟き）+ **rrweb によるマウス操作・画面記録**。同意 UI と保持期間 Cron を同時投入。 | ここで初めてプライバシー設計が必須になる。P1 と混ぜない |
| **P3** | **AI 即答**（Workers AI）。音声書き起こし → 文脈込みで回答 → 解決しなければ要望へ昇格。 | 空白地帯の本丸。P1/P2 のデータが溜まってから精度が出る |
| **P4** | 要望のロードマップ表示・投票（Canny 相当）。 | 需要が確認できてから |

**`getDisplayMedia` による実動画録画は P5 以降の検討事項**とし、当面採用しない（音声非対応 72.5%・容量・R2 10GB）。

---

## 4. 未解決・要確認

- `[要確認]` 新サービス `services/feedback` を立てるか、既存 `services/admin` に間借りするか。**認証源泉である admin に顧客からの大量書き込みを載せるのは避けたい**が、新サービス追加は人間承認事項。
- `[要確認]` AI 即答の推論先。Workers AI（無料枠あり）か外部 API か。外部 API は「完全無料枠で動かす」（絶対ルール 9）との整合とシークレット管理（`wrangler secret put`）の判断が要る。
- `[要確認]` 対象顧客の所在地。**EU 圏ユーザーがいるなら GDPR 対応は P2 と同時に必須**、米国 CA 向けならさらに CIPA の同意設計を厚くする。日本国内限定なら P2 の要件を軽くできる。
- `[要確認]` R2 10GB に対する保持期間。rrweb で数百 KB/分としても、件数次第で早期に枯渇する。想定件数の見積もりが要る。
- 新規画面なので、実装前に `docs/frontend/DESIGN_RULE.md` のパス1（トークン計画）をテキストで出し、`design-select` スキルで候補 2〜3 案を提示すること。

### ⚠️ 実装上の制約（§9.4 で追加・要確認ではなく決定事項）

**US 11,327,625 B2（Truist Bank、Active、2040年満了）を踏まないため、注釈オーバーレイは次の2点を守る。**

1. **オーバーレイでページ操作を遮断しない**（`pointer-events: none`）。同特許の請求項1は overlay が "preventing user interaction with the GUI" であることを要件にしている。
2. **要素はソースコードではなく安定セレクタ／識別子で送る**。請求項1は「座標を要素の**ソースコード**に translating し、その**ソースコードを送信**する」ことを要件にしている。

`[要確認]` **弁理士による FTO 調査**。上記は素人のクレーム解釈であり均等論を考慮していない。実装着手前に必須。

---

## Sources

競合・料金:
[Userback comparisons](https://userback.io/comparisons/) /
[Userback pricing](https://userback.io/pricing/) /
[Userback session replay (help)](https://support.userback.io/en/articles/5762135-session-replay) /
[Userback console logs & network requests (help)](https://support.userback.io/en/articles/5209170-console-logs-and-network-requests) /
[Marker.io alternatives (ReviseFlow)](https://reviseflow.io/blog/marker-io-alternatives) /
[Marker.io 比較 (Crosscheck)](https://crosscheck.cloud/compare/marker-io/) /
[BugHerd alternatives (Marker.io)](https://marker.io/blog/bugherd-alternatives) /
[BugHerd pricing (Capterra)](https://www.capterra.com/p/224784/BugHerd/pricing/) /
[Usersnap alternatives (Feedbucket)](https://feedbucket.app/alternatives/usersnap-alternatives) /
[Jam.dev pricing (G2)](https://www.g2.com/products/jam-dev/pricing) /
[Jam.dev alternatives 2026](https://medium.com/@sellimenes/top-5-jam-dev-alternatives-in-2026-for-bug-reports-that-dont-stop-at-a-recording-d2090a8766c3) /
[Best visual feedback tools (BugHerd)](https://bugherd.com/blog/best-visual-feedback-tools) /
[Best bug reporting tools 2026 (Crosscheck)](https://crosscheck.cloud/blogs/best-bug-reporting-tools-2026/) /
[Sentry pricing 実請求分析 (Last9)](https://last9.io/blog/sentry-pricing/) /
[LogRocket pricing (CubeAPM)](https://cubeapm.com/blog/logrocket-pricing-and-review/) /
[Intercom Fin ガイド](https://www.getmacha.com/blog/intercom-fin-ai-agent-complete-guide) /
[OpenReplay](https://openreplay.com/)

技術:
[rrweb](https://rrweb.com/) /
[rrweb glossary: MutationObserver](https://rrweb.com/glossary/mutation-observer) /
[rrweb cross-origin iframes recipe](https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/cross-origin-iframes.md) /
[MDN getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia) /
[MDN Screen Capture API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API) /
[caniuse: getDisplayMedia audio capture](https://caniuse.com/mdn-api_mediadevices_getdisplaymedia_audio_capture_support) /
[Bugzilla 1704278 (iframe transient activation)](https://bugzilla.mozilla.org/show_bug.cgi?id=1704278) /
[Bugzilla 1541425 (Firefox audio sharing 未実装)](https://bugzilla.mozilla.org/show_bug.cgi?id=1541425) /
[W3C mediacapture-screen-share issue #167](https://github.com/w3c/mediacapture-screen-share/issues/167) /
[MediaRecorder error handling (addpipe)](https://blog.addpipe.com/mediarecorder-error-handling/) /
[Sentry Session Replay docs](https://docs.sentry.io/product/session-replay/web/) /
[LogRocket Session Replay](https://logrocket.com/products/session-replay-developers) /
[セッションリプレイの仕組み (Mouseflow JP)](https://mouseflow-jp.com/how-session-replays-work/)

法務:
[rrweb glossary: GDPR & session replay](https://rrweb.com/glossary/gdpr-session-replay) /
[Session replay GDPR compliance (Clairvio)](https://clairvio.dev/blog/session-replay-gdpr-compliance) /
[CIPA セッションリプレイ集団訴訟の解説 (Quinn Emanuel 東京)](https://www.quinnjapan.com/news/pickout/230526_01.html)

Cloudflare:
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) /
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

---

## 5. 特許・知財の検討（追記: 2026-09-03）

> ⚠️ **免責**: 以下は弁理士・弁護士による法的助言ではなく、公開情報にもとづく先行技術・制度の調査である。出願判断の前に必ず日本の弁理士（および米国出願を考えるなら US patent attorney）に相談すること。

### 5.1 結論

**「録画つき問い合わせ → AI 即答 → 未解決なら要望チケットへ昇格」という導線そのものの特許化は、難しい。** 理由は3つ。

1. **構成要素が既に公知**。新規性を「組み合わせ」だけに頼らざるを得ない。
2. **米国 §101 で Electric Power Group の射程に真正面から入る**。「データ収集 → 分析 → 表示／チケット化」という構造そのものが不適格類型で、しかも**「画面録画」「音声」という情報の種類を限定しても回避にならない**と同判決が明示している。
3. 控訴審まで行った場合の生存率が低い（後述の統計）。

**возможность がゼロではない道**は1つだけある。ワークフローではなく、**§3 で設計した具体的な技術手段を請求項の中心に据えること**。2019 USPTO ガイダンスの Step 2A Prong Two（practical application）は「コンピュータの機能改善・他技術の改善」を筆頭の考慮事項に挙げており、たとえば「CPU 予算制約下でサーバ側パースを行わずストリーム透過する構成」「rrweb イベント列と音声トラックの同期・選択的マスキング機構」といった**技術的改善**なら Enfish / McRO 側に寄せられる余地がある。**導線＝ビジネスメソッドとして書くと Electric Power Group 側に落ちる。**

### 5.2 先行技術（新規性の壁）

| 文献 | 出願人 | 内容 | ステータス |
|---|---|---|---|
| **US20240386213A1** | Forethought Technologies | 自律型サポートチャットボット。**「自動解決できない問い合わせを特定し」**適切なエージェントへルーティング | Abandoned。**ただし公開出願は §102(a)(2) の先行技術資格を失わない** |
| **US20220309250A1 → US12229517B2** | HPE | 自由記述の課題を分類し決定木ベースの自動トラブルシューティング対話を開始。明細書に「チャットボットが解決できないときサポートケースを人間エージェントへエスカレーションする」と明記 | **2025-02-18 登録・Active、満了 2042** |
| US20220398598A1 / US20230164095A1 | 同族・他社 | エスカレーション削減のためのチャットボットセッション解析 | — |
| **US8903933B1** | ConnectWise | サポートチケットの優先度をユーザーステータス（available/away/offline/DND）で判定しチャットセッションを開始 | **Alice 判決後の 2014-12-02 登録・Active、満了 2034** |

→ 導線の中核「AI が答え、駄目なら人へ／チケットへ」は**複数社が既に押さえている**。

ConnectWise の US8903933B1 は「Alice 後もワークフロー系が登録され得る」例示にはなるが、**登録されたことは §101 有効性の証明ではない**（登録後に訴訟で無効化される例は多い）。

> 調査の限界: 当初想定した Quantum Metric / Glassbox / FullStory / Intercom のセッションリプレイ特許群については、検証を通過するだけの確度で個別特許を特定できなかった。**本格出願を検討するなら、弁理士による正式な先行技術調査（FTO 含む）が別途必須。**

### 5.3 米国 §101（Alice/Mayo）— 最大の壁

**Electric Power Group v. Alstom, 830 F.3d 1350 (Fed. Cir. 2016)** が本件に直撃する。

- 「クレームは、ある分野で利用可能な情報の**収集・分析・表示**を一般的な用語で要求するにとどまり、技術的手段に限定していない…望ましい情報ベースの結果を定義するだけで、それを達成する発明的手段に限定されていないものは §101 で失敗する」
- 「**情報を内容やソースによって選択することは、そのプロセスを通常の心的プロセスから差別化する上で何ら意味を持たない**」← **「画面録画だから」「音声だから」という限定は効かない、という判示。**
- Enfish 救済についても「クレームの焦点はツールとしてのコンピュータの改善にはなく、コンピュータをツールとして使う抽象的アイデアにある」として限定。
- Alice 第2段階でも「既製の従来型コンピュータ・ネットワーク・表示技術以外は何も要求していない」とし、「同時可視化表示」という限定でも inventive concept を認めなかった。

この判示は **2024年11月版 MPEP 2106.05(g)/(h) に現在も引用されている**（＝審査官が今も使う）。

**2019 改訂ガイダンス（84 FR 50）の枠組み**では、本導線は抽象的アイデアのグループ (b)「certain methods of organizing human activity」（商業的相互作用、人と人との相互作用の管理、ルール・指示の遵守を含む）に該当する可能性が高い。分水嶺は **Step 2A Prong Two**：クレーム全体が司法例外を practical application に統合しているか。統合の基準は「単に独占を狙った起案上の工夫を超えて、司法例外に意味のある制限を課しているか」。
※ USPTO ガイダンスは審査官を拘束するが**裁判所を拘束しない**（*In re Rudy*, 956 F.3d 1379 (Fed. Cir. 2020)）。審査を通っても訴訟で無効化されうる。

### 5.4 統計 — 審級で景色が全く違う

| 審級 | 数字 | 出典 |
|---|---|---|
| **CAFC（控訴審）** | 2018–2023 に Alice の実体判断をした **96 件中、無効でないとされたのは 14 件のみ**（最終的無効は約77件） | IPWatchdog |
| **地裁** | *Berkheimer* / *Aatrix*（ともに 2018-02、Fed. Cir.）が「inventive concept に事実上の争点があれば SJ・Rule 12 で無効化できない」と判示 → 無効化率 **69% → 46%** に低下。2023年は「認容より却下の方が多い」 | RPX |
| **USPTO 審査** | 2019 PEG 発行後12か月で Alice 影響技術の first office action §101 拒絶確率が **25% 減**、審査官間ばらつき **44% 減** | USPTO OCE『Adjusting to Alice』 |

**読み方の注意**: CAFC の 15% は控訴選択バイアスがかかっており全ソフトウェア特許のベースレートではない。RPX データは自社集計かつ 2019年時点。**ビジネスメソッド系（TC3600 Art Unit 36xx）の許可率は依然低く、本件のような UI/UX ワークフローに楽観材料として使ってはいけない。**

### 5.5 日本 — 現実的な代替ルート

**先使用権（特許法79条）**が制度として整備されており、資金の限られたスタートアップにはこちらが費用対効果で優位な可能性が高い。

- 79条: 他者の出願内容を知らずに自ら発明し、**「特許出願の際現に日本国内において事業をしている者又は事業の準備をしている者」**に、その範囲で**無償の通常実施権**を認める。
- **「事業の準備」の意義**: 最判昭61.10.3（ウォーキングビーム式加熱炉事件、民集40巻6号1068頁）＝「**即時実施の意図**を有し、かつその意図が**客観的に認識される態様・程度で表明**されている」こと。
- ⚠️ **最重要の落とし穴**: JPO 自身が「**自社の技術を営業秘密として管理しているだけでは、特許権侵害に対する抗弁ができず事業の継続が確保できません。事前に先使用権の証拠確保をしておくことで事業全体を守ることが可能**」と明記している。**立証責任は先使用権者側**。
  - → **やるべきこと: タイムスタンプ・公証等による証拠保全。** 幸い本リポジトリは git 履歴・spec・設計文書が揃うので、**設計文書と実装コミットに信頼できるタイムスタンプを打つだけで大半が満たせる。**
- 限界: 効力は「実施・準備をしている発明及び事業の目的の範囲内」に限られ、**日本国内限定**の抗弁。米国 35 U.S.C. §273 の prior commercial use defense は「出願日の1年以上前の商業的実施」を要するなど要件が異なる。

**JPO の三択フレーム**（権利化 / 秘匿化 / 公知化）:

| 選択肢 | 保護期間 | 本件への当てはめ |
|---|---|---|
| 権利化 | 出願から原則20年 | §101 リスクと費用。技術手段に絞れば可能性はある |
| 秘匿化（営業秘密） | 半永久だが管理・漏洩リスク | **本件は不適**。SaaS の UI 導線は**画面を見れば模倣できる**ので秘匿の実効性がない |
| 公知化（defensive publication） | — | 出願公開後の取下げ・論文発表・**インターネット公開**。他社の権利化を防ぐ |

JPO の検討ポイントは「侵害の把握・立証可能性」「他社が追いつけるか」「独占の必要性」。**本件は外部から観察可能なので侵害把握は容易だが秘匿は不可能** → この枠組みでは**権利化か公知化の二択**になる。

### 5.6 推奨アクション

1. **まず作って出す。** 特許より先に、先使用権の土台になる**設計文書＋実装のタイムスタンプ付き証拠保全**を積む。コストがほぼゼロで、日本国内での事業継続リスクを実質的に潰せる。
2. **公知化（defensive publication）を軽視しない。** この導線を技術ブログ等で公開しておけば、他社が同じ導線で権利化して我々を止めに来る筋を潰せる。秘匿の価値がない以上、これは損が小さい。
3. **出願するなら、導線ではなく技術手段。** §3.1 のアーキテクチャのうち「サーバ側パースを行わないストリーム透過」「rrweb イベントと音声の同期・選択的マスキング」など、**技術的改善として書けるもの**に絞って弁理士と相談する。仮出願（US provisional）で優先日だけ確保して1年考える手はある。
4. **`[要確認]`** 費用・期間・VC 評価への影響については、検証を通過する確度の数字が得られなかった。**弁理士に直接見積もりを取ること。**

### Sources（特許・知財）

[US20240386213A1 (Forethought)](https://patents.google.com/patent/US20240386213A1/en) /
[US20220309250A1 (HPE)](https://patents.google.com/patent/US20220309250A1/en) /
[US8903933B1 (ConnectWise)](https://patents.google.com/patent/US8903933B1/en) /
[Electric Power Group v. Alstom (Fed. Cir. 2016) 判決原文 PDF](https://www.cafc.uscourts.gov/opinions-orders/15-1778.opinion.7-28-2016.1.pdf) /
[2019 Revised Patent Subject Matter Eligibility Guidance (84 FR 50)](https://www.federalregister.gov/documents/2019/01/07/2018-28282/2019-revised-patent-subject-matter-eligibility-guidance) /
[Alice §101 の統計 (IPWatchdog 2024-09)](https://ipwatchdog.com/2024/09/26/checking-alice-section-101-developments-federal-circuit-district-courts-uspto-congress/) /
[Berkheimer 後の無効化率 (RPX)](https://www.rpxcorp.com/blog_post/q2-in-review-alice-reined-in-as-invalidation-rate-drops-while-patent-litigation-picks-up/) /
[特許庁 先使用権制度](https://www.jpo.go.jp/system/patent/gaiyo/senshiyo/index.html) /
[特許庁『先使用権制度の円滑な活用に向けて』第2版 PDF](https://www.jpo.go.jp/system/patent/gaiyo/senshiyo/document/index/senshiyouken_2han.pdf)

---

## 6. 特許取得戦略 — 競合を制限する権利範囲の作り方（追記: 2026-09-03）

> ⚠️ **免責**: 弁理士・弁護士による法的助言ではない。公開一次資料（CAFC 判決原文、USPTO PEG、JPO 審査ハンドブック）にもとづく出願戦略の**叩き台**である。実際の出願は必ず弁理士／US patent attorney と行うこと。本章の価値は「弁理士に持ち込む前に論点を絞っておく」ことにある。

### 6.1 大前提 — 素直に書くと必ず落ちる

**「録画+音声を収集 → AI が分析 → 表示／チケット化」という素直なクレームは §101 で死ぬ。** *Electric Power Group* 原文が3つの逃げ道を先回りして塞いでいる。

| 試したくなる回避策 | EPG の判示 |
|---|---|
| データ種別を書く（rrweb DOM イベント、マイク音声） | 「特定の**内容**に限定された情報収集も抽象的アイデアの領域として扱ってきた（内容の限定は情報としての性質を変えない）」 |
| 技術分野を限定する（カスタマーサポート） | 「電力網監視という特定の技術環境への限定は、**それ以上のものがなければ**不十分」 |
| 「担当者により多くの情報を与える」と効果を書く | *Trading Technologies v. IBG* — 「取引という**ビジネスプロセス**を改善したが、コンピュータや技術を改善していない」 |

⚠️ **特に3つ目は本件に直撃する。**「フィードバック業務の効率化」「運営担当者の負担軽減」を主効果として明細書に書いた瞬間に負ける。**効果は必ず技術側の言葉で書く。**

⚠️ 検証工程で **0-3 否認された希望的観測**: 「AI 分析の下流に自動措置（チケット昇格）を足せば Prong Two で適格になる」。*SRI v. Cisco* の引用は Prong **One** の類型判断であり、Prong Two の適格化を保証しない。**D 案が危険な理由がこれ。**

### 6.2 生き残る経路は2本しかない

EPG 判決自身が、適格側の要件を**逆から**定義してくれている。

> 「本件クレームは、DDR Holdings と異なり、**情報を表示するための発明的な装置または技法**を要求していない」
> 「本件クレームは、Bascom（『**エンドユーザから離れた特定の位置へのフィルタリングツールの設置**』）と異なり、**ネットワーク内の機能の発明的な分配**も要求していない」

→ **経路1 = 表示の発明的技法（Core Wireless 型）／経路2 = 機能配置の発明的分配（DDR/Bascom 型）。**

もう1つの軸が *Enfish*。EPG はこう書いている:

> 「クレームの焦点は、**既存のコンピュータ能力を何に使うか**という進歩ではなく、コンピュータが基本機能（データの格納と取得）の1つをどう実行するかという**特定の改善**（特定のデータベース技法）にあった…本件クレームの焦点はそのような**道具としてのコンピュータの改善**にはない」

→ **「記録・再生・同期」という基本機能の改善**として枠付けられれば Enfish 側に寄る。

### 6.3 4つのパターン

#### 【A案】アーキテクチャ型 — サーバ資源制約下のストリーム透過

- **主張する技術的課題**: サーバ側の実行時間予算（CPU 10ms/req）が録画ペイロードのパース・再圧縮を許さない。従来はサーバで受信データを解析してから保存するため、予算制約下では大容量録画を受け付けられない。
- **独立クレームの骨子**: 受信ストリームを**サーバ側でデシリアライズせずに**オブジェクトストレージへ透過書き込みし、識別子をクライアント生成の値から導出することで、メタデータ行の書き込みと本体保存を分離する構成。チャンク粒度をリクエスト予算から逆算して決定するステップ。
- **§101 の勝ち筋**: **Bascom 型（機能の発明的分配）**。「エンドユーザから離れた特定位置へのツール設置」と構造的に同型に書ける。
- **想定拒絶**: 「単なる慣行的な処理分割」（*Yu v. Apple*, *In re Killian* が示すとおり Bascom ルートの射程は狭い）。
- **design-around**: **容易**。競合は有料枠で普通にサーバ処理すれば逃げられる。
- **競合を縛る力**: **弱**。ただし §101 を通す確度は最も高い。

#### 【B案】同期・マスキング型 — DOM イベント列と音声の時刻同期

- **主張する技術的課題**: DOM 変異イベント列（離散・不等間隔）と音声トラック（連続）の**時刻ドリフト**。および選択的マスキングの**漏れ**（§2.3 のとおり、マスキングが効かない場合があることは検証済みの事実）。
- **独立クレームの骨子**: イベント列に対する基準時刻の再同期手順＋マスキング適用結果を検証し漏れを検出したときに当該フレーム区間を無効化する手順。
- **§101 の勝ち筋**: **McRO 型（具体的ルールによる改善）＋ Enfish 型**。「記録・再生・同期という基本機能の改善」として書ける。
- **想定拒絶**: 進歩性（§103／29条2項）。同期技術は既存分野。
- **design-around**: 中。同期方式は複数ある。
- **競合を縛る力**: **中**。録画と音声を同時に扱う競合（Jam.dev 等）は踏む可能性がある。**マスキング漏れ検出はプライバシー規制上どの競合も実装せざるを得ない**ので、ここは意外に効く。

#### 【C案】UI 型 — 本命 ★

- **根拠判例**: *Core Wireless v. LG* は Alice **step one で適格**と判断した（step two に到達していない）。「本件クレームは、インデックスという抽象的アイデアではなく、**コンピューティングデバイスのための改善されたユーザインタフェース**に向けられている」「従来のUI手法を使うのではなく、**限られた情報群をユーザに表示する特定の態様**」。
- **⚠️ ただし致命的な限定が3つある（検証で確認済み）**:
  1. **「UI だから適格」ではない。** 判決は表示機構だけでなく「**表示できるデータの種類を制限している**」点も根拠に挙げている。機構だけ書けば足りると読むのは危険。
  2. ***IBM v. Zillow*（Fed. Cir. 2022）は Core Wireless を明示的に区別**し、**デバイス非限定・計算環境固有の記載がない GUI クレームを不適格**とした。→ **クレームに device-constrained な文脈（画面領域の制約等）を必ず書き込む。**
  3. Core Wireless は EPG を一切引用しておらず、両者の対比は実務家による事後的な合成である。
- **独立クレームの骨子**: 表示領域の制約下で、(i) 記録対象の範囲と同意状態を**到達前に**一括提示し、(ii) 記録中の状態を最小占有面積で提示し、(iii) 記録停止と同時にタイトル入力と送信到達を**同一状態から**行える、特定の状態遷移を持つウィジェット。**表示するデータ種を明示的に限定する。**
- **想定拒絶**: 新規性（Userback / BugHerd の既存ウィジェット）。→ **録画・音声・同意・昇格を「1つの状態遷移」として書き切ることでしか新規性が出ない。**
- **design-around**: 難しい。UI の状態遷移は製品体験に直結するので変えづらい。
- **競合を縛る力**: **強**。右下バブル型ウィジェットは競合全社が持っている。

#### 【D案】昇格トリガ型 — 出さない

- 「未解決判定 → 要望チケット自動昇格」は **EPG 直撃**。加えて先行技術（HPE **US12229517B2** が明細書で明記、ConnectWise **US8903933B1**）が厚い。
- **単独の独立クレームにはしない。** C 案の従属クレームとして書き添えるに留める。

### 6.4 起案の実務 — Prong Two を通す唯一の型

**USPTO 審査段階には大きな追い風がある。** 2019 PEG October Update:

> 「追加の限定がコンピュータの機能の改善または他の技術・技術分野の改善を反映しているならば、クレームは司法例外を practical application に統合している…**それ以上の分析は不要。Step 2A でクレームは適格である**」
> 「Step 2A における『改善』の分析は、**何が well-understood, routine, conventional な活動であるかを参照せずに**判断される」

→ **先行特許（HPE 等）の存在は §101 の反論を直接には潰さない。**（ただし §102/§103 では依然として致命的。軸が違うだけ。）
→ ⚠️ 射程は **USPTO 審査手続のみ**。裁判所は PEG に拘束されない（*In re Rudy*, Fed. Cir. 2020）。

**必須の型 = two-sided showing。**

> 「明細書が改善を明示していても**結論的な態様**（当業者に明らかとなるのに必要な詳細を欠く単なる主張）であれば、審査官は技術の改善と認定すべきでない。第二に、**クレーム自体が開示された改善を反映しているか**を評価しなければならない」（2019 Update / 2024 AI Update・MPEP 2106.04(d)(1)）

→ **明細書の課題記述とクレーム要素を一対一で対応させる。**

| 明細書に書く技術的課題 | 対応させるクレーム要素 |
|---|---|
| サーバ実行時間予算がパースを許さない | デシリアライズせず透過書き込みするステップ |
| DOM イベントと音声の時刻ドリフト | 基準時刻の再同期手順 |
| マスキングが漏れる（§2.3 の実証済み事実） | 漏れ検出と区間無効化のステップ |
| 表示領域の制約 | device-constrained な状態遷移 |

⚠️ **AI については「汎用ニューラルネットを使う」と書くだけでは "apply it" 扱いで practical application を与えられない**（2024 AI Update Example 48: 「クレームは特定の DNN について何ら詳細を記載していない…『apply it』の語を加えるのと等価」）。**AI 部分は必ず具体化する**（入力の構成方法＝録画からのコンテキスト圧縮手順など）。

### 6.5 日本のルート

- **発明該当性**は米国 §101 より通しやすい**が、自動ではない**。審査ハンドブック附属書B第1章: 「請求項に『コンピュータ』『CPU』『メモリ』等の**ハードウェア資源が記載されていても**『使用目的に応じた特有の情報の演算又は加工を実現するための、**ソフトウエアとハードウエア資源とが協働した具体的手段又は具体的手順**』が記載されていない場合は…該当しない」。→ **ハードウェア名詞の羅列は無意味。具体的処理ステップを書く。**
  - ⚠️ 検証工程で「日本の発明該当性は米国より一般に低いハードルなので、この導線は日本では適格として書ける」という広い主張は **0-3 で否認**された。個別の記載次第。
- **真の関門は 29条2項（進歩性）。** 同ハンドブック: 「特定分野において**人間が行っている業務やビジネスを行う方法をシステム化し、コンピュータにより実現することは、通常のシステム分析手法及びシステム設計手法を用いた日常的作業で可能な程度**であれば、当業者の通常の創作能力の発揮に当たる」
  - → **「AI がサポートに回答し、未解決ならエスカレーション」という業務のシステム化そのものでは拒絶される。**（D案が日本でも死ぬ理由）
  - → 条文は「**日常的作業で可能な程度であれば**」という条件付きで per-se の排除ではない。**コンピュータ実現に固有の困難の克服**（＝時刻同期・マスキング漏れ検出・チャンク粒度）や、引用発明から予測できない有利な効果があれば進歩性は認められうる。**B案が日本で最も戦いやすい。**
- **スーパー早期審査**（JPO 一次資料で確認）: 審査請求済み・審査着手前で、(1)「実施関連出願」かつ「外国関連出願」**または**スタートアップによる「実施関連出願」、(2) 申請前4週間以降の全手続をオンライン化、の双方を満たすこと。選定されれば**事情説明書の受理日から原則1か月以内**（DO案件2か月以内）に一次審査結果。
  - → **SaaS を実装済み＋US 同時出願なら両枠に該当しやすい。日本先行で早期に権利化し、その結果を米国審査に反映させる戦略が組める。** これは本件で現実的に最も有利な進め方。
  - ⚠️ 「スタートアップ」の具体的定義（設立年数・資本金要件）は検証で **0-3 否認**（未確定）。弁理士に確認すること。

### 6.6 権利範囲を広げる実務

**継続出願（continuation）で競合製品を後から狙う手法は、現実に行われており合法。** Lemley & Moore, *Ending Abuse of Patent Continuations*, 84 B.U. L. Rev. 63 (2004):

> 「継続出願実務は、**競合他社がどんな製品を作るかを待って見てから、その製品を対象とするようクレームを起案する**ことで競争上の優位を得るために戦略的に利用され得るし、実際に利用されてきた」

**限界が2つ**（同論文が対抗策として挙げるもの）:
1. **written description（§112(a)）** — 継続クレームは**原明細書の開示に支持**されている必要がある（*Ariad v. Eli Lilly*, en banc 2010）。**Userback や Jam.dev の任意の実装機能に後から届くわけではない。**
2. **prosecution laches** — *Symbol v. Lemelson* / *Hyatt v. Hirshfeld* で確立。ただし適用ハードルは高い。

→ **実務的帰結: 最初の明細書をできる限り厚く書く。** 実装していない変形例（実動画型、モバイル、拡張機能型、他社がやりそうな構成）も**明細書には全部書いておく**。ここをケチると継続の射程が消える。

### 6.7 推奨する進め方

1. **明細書の「技術的課題」パートを先に書く**（§6.4 の表の4課題）。ここが全ての土台。**ビジネス効果の言葉を1つも使わない**。
2. **C案（UI型）を独立クレーム1**、**B案（同期・マスキング）を独立クレーム2**、A案を従属、D案は C の従属に留める。
3. **日本先行 + スーパー早期審査**。実装済み＋US 関連出願で要件を満たしやすく、1か月で一次審査結果が出る。**早く「通る／通らない」が分かるので、投資判断が速い。**
4. 米国は **provisional で優先日だけ確保**して1年考える。
5. **明細書は厚く。** 継続の射程は最初の開示で決まる。

### 6.8 調査の限界（弁理士に確認すべき事項）

以下は**検証を通過する確度の情報が得られなかった**。この叩き台の穴として明示しておく。

- **Art Unit の割り振り**（TC3600 ビジネスメソッド vs TC2100/2400 ソフトウェアの許可率差、CPC 分類による誘導技術）— 実務上重要だが裏が取れなかった。
- **divided infringement（*Akamai v. Limelight*）** — 本件はクライアント側とサーバ側にステップが分かれるため、**単一主体が全ステップを実施する形でクレームを書かないと侵害立証ができず権利が空洞化する**。「競合を縛る」目的では最重要論点。裏が取れなかったが**弁理士に必ず確認すること**。
- **出願費用・期間の相場**（micro/small entity 減免、弁理士費用）— 数字が確定できなかった。
- Quantum Metric / Glassbox 等のセッションリプレイ特許群 — **正式な FTO 調査が別途必須**。

### Sources（§6）

[Electric Power Group v. Alstom 判決原文 PDF (Fed. Cir. 2016)](https://www.cafc.uscourts.gov/opinions-orders/15-1778.opinion.7-28-2016.1.pdf) /
[Core Wireless v. LG 判決本文 (BitLaw)](https://www.bitlaw.com/source/cases/patent/Core-Wireless.html) /
[USPTO 2019 PEG October 2019 Update PDF](https://www.uspto.gov/sites/default/files/documents/peg_oct_2019_update.pdf) /
[USPTO 2024 AI Subject Matter Eligibility Update Examples 47-49 PDF](https://www.uspto.gov/sites/default/files/documents/2024-AI-SMEUpdateExamples47-49.pdf) /
[JPO 審査ハンドブック 附属書B 第1章（ソフトウエア関連発明）PDF](https://www.jpo.go.jp/system/laws/rule/guideline/patent/handbook_shinsa/document/index/app_b1.pdf) /
[JPO スーパー早期審査 PDF](https://www.jpo.go.jp/system/laws/rule/guideline/patent/document/index/supersoukisinsa.pdf) /
[Lemley & Moore, Ending Abuse of Patent Continuations (Stanford Law)](https://law.stanford.edu/publications/ending-abuse-of-patent-continuations/)

---

## 7. 実在の登録クレームから逆算した「取れる形」（追記: 2026-09-03）

> 前提変更: **インフラのコスト制約（Cloudflare 無料枠）は考慮外**とした。したがって §6 の A案（ストリーム透過）は、主張すべき技術的課題が消えるため候補から外れる。
> 手法変更: 推測でクレームを組むのをやめ、**実際に登録（granted / Active）された特許の請求項1の文言を取得して逆算**した。

### 7.1 塞がっている領域（正面から当たるので避ける）

| 我々がやりたいこと | 当たる登録特許 | 権利者 | 満了 |
|---|---|---|---|
| **DOM 再構成型リプレイ** | **US10102306B2** 請求項1: 「base DOM／base DOM 差分／ユーザ操作を取得し、base DOM に差分を**パッチ**して patched DOM を生成し、ユーザ操作を patched DOM に**重畳**して再生を生成する」 | **Acoustic LP**（旧 IBM/Tealeaf 系） | **2037-01-10** |
| **イベント列の圧縮・帯域削減** | **US10146752B2** 請求項1: 祖先/子孫関係で重複と判定した第2ノード変更を**含めないことで重複情報を抑制**するイベントレコード生成 | **Quantum Metric** | 2036-05-07 |
| （同上・別枠） | **US11232253B2** ハッシュブロック比較によるクライアント側デルタ符号化（rsync 型） | Quantum Metric | 2037-03-22 |
| **入力テキストの記録前マスキング** | **US11709966B2** 請求項1: 「入力テキストの**解析**によりマスキング対象情報を特定し、記録**前**にマスキングする」 | **Glassbox** | 2040-12-29 |
| **要素をアスタリスク列で置換する秘匿** | **US12200069B2** 明細に開示（＝102条の先行技術） | Dynatrace | 2042-11-23 |

→ **rrweb 系の中核（DOM 再構成・差分圧縮・要素マスキング）は、そのままの形では権利化できない。**

⚠️ ただし回避の余地はある。US10102306B2 の請求項1は前文が「**DOM リプレイが差分 DOM リプレイであると判定したことに応じて**」というモード選択で限定されている。Glassbox US11709966B2 は「**入力テキストの内容解析**」を要求するので、**rrweb の `maskAllInputs` のようなセレクタ・属性ベースの一律マスキングには読み込まれない。**

### 7.2 「登録される型」が実証されている領域

| 型 | 実例 | 何が示されたか |
|---|---|---|
| **離散イベント列と再生タイムラインの同期** | **US11588912B2**（FullStory、登録2023-02、Active）請求項1 = ①セッション再生領域 ②コンソールログ領域（視覚変化に対応するログ項目をアニメーション表示）③各イベントのロード所要時間を示すイベントストリーム、の三領域を持ち「**コンソール項目とイベント要素は再生と同期する**」 | **同期は登録される型。**ただし三領域＋アニメーション＋ロード時間という**狭い UI レイアウト限定**であり、**音声要素は皆無** |
| **PII マスキング（運用ワークフロー限定）** | **US12547745B1**（FullStory、**登録2026-02-10**、Active、満了2044）＝機微データ検出＋**再生画面上のインジケータ表示**＋当該要素の表示を止める**UI コントロール** | **2026年でも新規登録が出る生きた領域。**しかも**UI 寄りの運用限定でも登録される** |
| （同上） | **US12400037B2**（Quantum Metric、登録2025-08-26、Active、満了2043） | 同上 |
| **取得の場所と経路という物理的限定** | **US10341205B2**（Glassbox、Active、満了2037）請求項1 = Web サーバのネットワークカードのポートを監視し、パケットに基づく記録有効化データを記録サーバへ送る。「**サーバ外部のハードウェア資源を操作することなく**記録できる」 | **§101 回避の自由度は取得アーキテクチャ側にもある。**クライアント DOM 記録でなくても書ける |

### 7.3 結論 — 優先度順の切り出し候補

#### 第1候補 ★ 音声を第三ストリームとする時刻同期・ドリフト補正

- **なぜ空いているか**: 同期の登録型（US11588912B2）に**音声要素が一切ない**。DOM 再構成型の既登録（US10102306B2）も retrieving を **base DOM / 差分 / ユーザ操作の3項目に限定**している。→ **連続音声という第四要素の整合は、構造的に空いている。**
- **書くべき具体的課題**: タイムスタンプのドリフト補正、再接続時の再同期、**離散イベントを連続波形上のどの位置に貼るか**。
- **登録型への近さ**: 最も近い。US11588912B2 の「三領域＋同期」の骨格に音声トラックを足す形で書ける。

#### 第2候補 ★ マスキング漏れの事後検出・検証

- **なぜ空いているか**: Glassbox US11709966B2 の請求項1は **identify → mask → record の直列3ステップのみ**で、**verification / audit / confirmation / failure detection のステップが限定連鎖のどこにも無い**（全文にも記載なし）。Dynatrace の秘匿開示も**置換までで、置換が成功したかの検証には触れていない**。FullStory US12547745B1 は検出だが、それは**機微データそのものの検出であって「マスキングが漏れた事実の検出」ではない**。
- **書きやすさ**: FullStory US12547745B1 の「**検出 → 再生画面での提示 → 運用者の操作**」という**登録実績のある書き方にそのまま乗せられる**。
- ⚠️ **これは不在の証明であり、全譲受人を網羅探索できていない**（検証中に検索予算が枯渇）。**狙うなら出願前に独立した先行技術調査が必須。**

#### 第3候補 取得経路の物理的・システム的限定

- US10341205B2 が示すとおり、「どこで・どの経路で記録するか」というシステム構成でも登録される。§101 を避ける保険として使える。

#### 避けるべき

単独の「DOM 再構成」「イベント圧縮」「要素マスキング」は、それぞれ US10102306B2 / US10146752B2 / US11709966B2・US12200069B2 に**正面から当たる**。

### 7.4 今回の調査で裏が取れなかったこと（結論を出してはならない領域）

検証を通過した13件は**すべて「リプレイ／マスキング／同期」の領域に属し**、次の3項目は**一次クレーム・公報で裏付けが取れなかった**。

- **録画・ログを LLM プロンプトへ変換する技術**（Jam.dev の AI 再現手順生成、Sentry Seer の特許化状況）
- **フィードバックウィジェット UI の状態遷移**（Atlassian / Instabug / Usersnap / BugHerd / Marker.io の UI 特許）→ **§6 の C案の裏付けは今回も取れていない。**
- **意匠（design patent）による GUI 保護**（米国の実例、日本の画像意匠でSaaS画面が登録された実例）

→ **唯一の間接的示唆**: FullStory US12547745B1 が「インジケータ表示＋ユーザが表示抑止を選ぶ UI コントロール」という**運用 UI ワークフロー限定で登録されている**点は、**UI 寄りの限定でも登録され得ることを示す**。C案が完全に死んでいるわけではない。

### Sources（§7）

[US10102306B2 (Acoustic/旧Tealeaf, DOM再構成)](https://patents.google.com/patent/US10102306B2/en) /
[US10146752B2 (Quantum Metric, 重複抑制)](https://patents.google.com/patent/US10146752B2/en) /
[US11232253B2 (Quantum Metric, ハッシュ差分)](https://patents.google.com/patent/US11232253B2/en) /
[US11709966B2 (Glassbox, 記録前マスキング)](https://patents.google.com/patent/US11709966B2/en) /
[US12200069B2 (Dynatrace, 帯域最適化・秘匿開示)](https://patents.google.com/patent/US12200069B2/en) /
[US11588912B2 (FullStory, ログと再生の同期)](https://patents.google.com/patent/US11588912B2/en) /
[US12547745B1 (FullStory, 機微データ検出とUI)](https://patents.google.com/patent/US12547745B1/en) /
[US12400037B2 (Quantum Metric, PIIマスキング)](https://patents.google.com/patent/US12400037B2/en) /
[US10341205B2 (Glassbox, サーバ側パケット監視)](https://patents.google.com/patent/US10341205B2/en)

---

## 8. 意匠ルートの検討（追記: 2026-09-03）

> ⚠️ この章は **WebFetch で一次資料に直接到達できた分のみ**。到達できなかった項目は「未確認」と明示する（§8.4）。
> **📌 この章の保留と結論は §9 で更新済み。§8 だけを読んで判断しないこと。** 特に §8.3（費用の通説）と §8.5-3（LKQ が分かるまで意匠に舵を切るな）は **§9 で反転している**。

### 8.1 GUI 意匠は実在し、書き方も確立している

**US D604,305 S**（Apple Inc.、出願 2007-06-23、登録 2009-11-17、満了 2023-11-23）

- タイトル: **"Graphical user interface for a display screen or portion thereof"**
- クレーム全文: **"The ornamental design for a graphical user interface for a display screen or portion thereof, as shown and described."**
- 図面の注記: **"The broken line showing of a display screen in both views forms no part of the claimed design."**

→ **GUI そのものを意匠で権利化できること**と、**「破線でスクリーンを描き、実線で保護対象を描く」実務**が、実在の登録公報で確認できた。クレームが1文で済む点も発明特許と対照的。

### 8.2 ⚠️ 訂正 — Apple v. Samsung の3件は「全部 GUI 意匠」ではない

| 番号 | タイトル | クレーム | 種別 |
|---|---|---|---|
| **D604,305** | Graphical user interface for a display screen or portion thereof | "…for a graphical user interface for a display screen or portion thereof…" | **GUI 意匠** |
| **D593,087** | Electronic device | "The ornamental design of an electronic device, substantially as shown and described." | **機器形状**（初代 iPhone の外形） |
| **D618,677** | Electronic device | "The ornamental design of an electronic device, as shown and described." | **機器形状**（黒色の指定あり） |

→ **本件で参考になるのは D604,305 の1件だけ。** 残り2件は筐体の意匠であり SaaS のウィジェットには当てはまらない。「Apple v. Samsung で GUI 意匠が巨額賠償を生んだ」という語り方はこの区別を潰している。

### 8.3 ⚠️ 費用の通説は官庁費用では成り立たない

USPTO 公式料金表（2025-01-19 施行）を直接取得した。

| 項目 | 意匠 | 発明 |
|---|---|---|
| 出願料 | $300 / 小規模 $120 / 極小 $60 | $350 / $140 / $70 |
| 調査料 | $300 / $120 / $60 | $770 / $308 / $154 |
| 審査料 | $700 / $280 / $140 | $880 / $352 / $176 |
| 登録料 | $1,300 / $520 / $260 | $1,290 / $516 / $258 |
| **合計（通常）** | **$2,600** | **$3,290** |
| **合計（極小事業者）** | **$520** | **$658** |

→ **差は約20%。**「意匠は発明特許よりずっと安い」は**官庁費用では成立しない**。実務上のコスト差は ①代理人費用（意匠はクレーム1文・明細書が薄い）②審査期間 ③維持年金の有無 のいずれかにあるはずだが、**3点とも未確認**。安さを理由に意匠を選ぶなら、根拠はここにあるので弁理士に確認すること。

### 8.4 未確認（→ **ほぼすべて §9 で解決済み**。当時の記録として残す）

| 項目 | §8 時点の状況 | 現在 |
|---|---|---|
| **LKQ Corp. v. GM（Fed. Cir. 2024 大法廷）** | 判決 PDF が 404、Justia が 403、Wikipedia に項目なし。一切裏が取れていなかった | ✅ **§9.1 で解決。** Rosen-Durling を明示的に overrule。ただし PTAB の運用は厳格で、意匠は無効化されやすくなっていない |
| **§101 Alice が意匠に適用されないこと** | 条文構造上そのはずだが一次資料で未確認 | ✅ **§9.2 で解決。** 2026-03 の USPTO ガイダンスが GUI 意匠の §171 適格を明言 |
| **意匠の存続期間** | 「登録から15年」と一般に言われるが条文未確認 | ✅ **§9.3 で解決。** 35 U.S.C. §173（2015-05-13 以降の出願は登録から15年） |
| **日本の画像意匠（令和元年改正）** | JPO が 403 で拒否。すべて未確認 | ✅ **§9.5 で解決。** SaaS 画面は保護対象。11万円台・6か月・25年。登録実例あり（秘密意匠の運用詳細のみ未確認） |
| **アニメーション意匠の登録実例** | 未確認 | ✅ **§9.5 で解決（日本）。**「機能に基づいて変化する画像」が登録対象 → C案の状態遷移を狙える |
| **ウィジェット UI の登録特許** | 未確認（§7.4 から持ち越し） | ⚠️ **§9.4 で方向転換。** 名指しした各社の番号は特定できなかったが、**Truist Bank の US11327625 という直撃しうる登録特許を発見**。競合ベンダーだけ見る調べ方が危険と判明 |
| **録画→AI プロンプト変換の特許**（Jam.dev / Sentry Seer） | 未確認（§7.4 から持ち越し） | ❌ **未解決。** §9.7 参照。検索では発見できず（不存在の証明ではない） |

### 8.5 §8 時点の暫定結論（→ 2 と 3 は §9 で反転）

1. **GUI を意匠で守る道は実在する。** D604,305 が証拠で、書き方も確立している。→ ✅ 維持。なお 2026-03 のガイダンスで図面要件はさらに緩和された（§9.2）。
2. ~~「安いから意匠」は根拠が崩れた。~~ → ⚠️ **§9.3 で半分訂正。** 官庁費用の差は確かに20%だが、**許可率 85% vs 52%** と**維持年金ゼロ**を織り込むと期待値では意匠が明確に有利。
3. ~~LKQ の影響が分かるまで意匠ルートの優劣は判断できない。~~ → ⚠️ **§9.1 で解除。** LKQ は Rosen-Durling を overrule したが、**PTAB の実務データは意匠が無効化されやすくなっていないことを示す**（institution 38%、無効率 65%、いずれも utility より低い）。

### Sources（§8）

[US D604,305 S（Apple, GUI 意匠）](https://patents.google.com/patent/USD604305S1/en) /
[US D593,087 S（Apple, 機器形状）](https://patents.google.com/patent/USD593087S1/en) /
[US D618,677 S（Apple, 機器形状）](https://patents.google.com/patent/USD618677S1/en) /
[USPTO 料金表（2025-01-19 施行）](https://www.uspto.gov/learning-and-resources/fees-and-payment/uspto-fee-schedule)

---

## 9. 意匠ルートの結論と、設計を変える発見（追記: 2026-09-03・第2次）

> §8 で「未確認」として空けた穴を、一次資料と実務データで埋めた。**結論は §8 から反転する。**
> なお本章の特許クレーム解釈は素人判断であり、均等論を考慮していない。**実装前に弁理士による FTO 調査が必須。**

### 9.1 LKQ の答え — 「意匠が無効化されやすくなった」は**データが否定している**

**LKQ Corp. v. GM Global Technology Operations LLC, 102 F.4th 1280 (Fed. Cir. 2024)**（2024-05-21、大法廷、Stoll 判事）。CAFC にとって**5年ぶりの大法廷特許判決**。

- Rosen-Durling の2要件——primary reference が claimed design と **"basically the same"** であること、secondary reference が primary と **"so related"** であること——を **"rigid" として明示的に overrule** し、utility 特許と同じ **Graham factors** を適用すると判示した。

**ここで「意匠は取りにくくなった」と結論しがちだが、判決後1年の実務データは逆を示す。**

| 指標 | 意匠特許 | 発明特許 |
|---|---|---|
| PTAB の **IPR institution rate** | **38%** | 約 65% |
| final written decision での**クレーム無効率** | **65%** | 約 75% |

- **2024年の意匠 IPR 最終決定はわずか2件**（*Next Step Group v. Deckers*、*Hangzhou Taihe Trading v. EP Family*）。PTAB での意匠の争いはそもそも少ない。
- **LKQ 後初の PTAB 判断** ***Next Step Group, Inc. v. Deckers Outdoor Corp.*, IPR2024-00525, Paper 16 (P.T.A.B. Aug. 6, 2024)** は、Graham factors を適用したうえで **petitioner の無効理由10本すべてを退け、IPR の開始自体を拒否**した。理由は「petitioner が、**あらゆる設計上の選択肢の中からなぜその先行意匠を選ぶのか**を十分に説明していない」こと。
- 評価は「**Petitioners may continue to face a high bar for invalidating design patents through PTAB proceedings**」。

→ **PTAB は新基準をむしろ厳格に運用している。意匠ルートは死んでいない。** §8.5 の「LKQ が分かるまで意匠に舵を切るな」という保留は**解除してよい**。

### 9.2 ★ 2026年3月、USPTO が GUI 意匠のハードルを下げた

**Federal Register 2026-03-13 付「Supplemental Guidance for Examination of Design Patent Applications Related to Computer-Generated Interfaces and Icons」**（発行 2026-03-12）。

- **MPEP §1504.01(a) の「図面にディスプレイパネル（display screen）を実線または破線で描く」要件を撤廃した。**
- 代わりに、**タイトルとクレームの双方で適切な article of manufacture（computer / computer display / computer system 等）を特定していれば足りる**。**"for a computer"** という形式のクレーム文言が受理可能になり、従来の "display screen with graphical user interface" は不要。
- **施行日前・当日・以後に出願されたすべての意匠出願および手続に適用**される。
- GUI・アイコンの意匠は「単なる一時的・無形の画像を超えるもの」であり **35 U.S.C. §171 の patent-eligible subject matter** であることが改めて明言されている。

→ **§8.1 で D604,305 に見た「破線でスクリーンを描く」実務は、2026年3月以降もう必須ではない。**図面が単純になり、クレーム文言とタイトルの自由度が上がった。**この6か月で GUI 意匠の環境は明確に改善している。**

### 9.3 数字で決着 — §8.3 の結論を半分訂正する

| 軸 | 米国 意匠 | 米国 発明 |
|---|---|---|
| **許可率** | **84〜85%** | **51〜52%** |
| 審査期間 | pendency 16.4か月（登録まで概ね20〜30か月） | — |
| 官庁費用（通常） | $2,600 | $3,290 |
| 官庁費用（極小事業者） | $520 | $658 |
| **維持年金** | **なし**（登録後の追加費用なし） | あり |
| 存続期間 | **登録から15年**（35 U.S.C. §173、2015-05-13 以降の出願。以前は14年） | 出願から20年 |
| **§101 Alice** | **適用されない**（2026 ガイダンスが §171 適格を明言） | **最大の壁** |
| §103 | LKQ 後は Graham factors。ただし PTAB の運用は依然厳格 = 権利者に有利 | 厳しい |

**§8.3 の訂正**: 「意匠が安いという通説は成り立たない」と書いたが、**これは出願1件あたりの官庁費用だけを見た評価だった**。実際には——

- **通る確率が 1.6 倍**（85% vs 52%）。期待費用は「費用 ÷ 成功確率」なので、この差は官庁費用の20%差を軽く上回る。
- **維持年金がゼロ。** 発明特許は登録後も払い続ける。
- **§101 の不確実性がない。** §5〜§7 で見たとおり、発明特許では CAFC 段階の生存率が 96件中14件。この不確実性そのものがコストである。

→ **期待値で見れば意匠が明確に有利。** ただし守れるのは「見た目」だけで、機能は守れない（ordinary observer test）。

### 9.4 ★★ 直撃しうる登録特許を発見 — US 11,327,625（Truist Bank）

**今回いちばん重要な発見。** §3 の P1（スクショ＋注釈）の実装方法によっては、これに読み込まれる。

- **US 11,327,625 B2** "Graphical user interface marking feedback"
- **権利者: Truist Bank**（米国の銀行。**フィードバックツールのベンダーではない**）
- 発明者: James Harrison Creager, Daniel Jordan Schantz, Brannan Rhett McDougald
- 出願 2020-07-08 / 登録 2022-05-10 / **Active** / **満了予定 2040-07-08**
- 独立クレーム3本（1 = method、6 = system、12 = CRM）＋従属12本

**請求項1（逐語）**:

> "A method for providing user feedback for a website, the method **comprising**: generating, via a programming interface of a first computing device, a **substantially transparent overlay** for a graphical user interface (GUI) of a web page, the substantially transparent overlay **preventing user interaction** with the GUI of the web page; **receiving coordinates** of an area on the substantially transparent overlay; **translating** … the coordinates of the area on the substantially transparent overlay **to source code for an element** on the GUI of the web page located at a corresponding position …; **transmitting** … **source code for the element** to a second computing device for rendering the element on a second computing device GUI; **rendering** … a graphical element on the substantially transparent overlay, a position of the graphical element corresponding to the coordinates …; and **transmitting source code for the graphical element** rendered on the substantially transparent overlay to the second computing device."

**なぜ危険か**: 「透明オーバーレイを敷き、ユーザーがクリックした座標から DOM 要素を特定して送る」——これは注釈つきフィードバックの**最も素直な実装**であり、我々が何も考えずに書くとこの形になる。しかも権利者が**銀行**なので、製品市場の競合ではなく**純粋な権利者**＝相互ライセンスで牽制できない相手である。

**回避の余地（クレームの限定を逆手に取る）**:

| クレームの限定 | 回避設計 |
|---|---|
| overlay が **"preventing user interaction with the GUI"** | **`pointer-events: none`** で操作を透過させるオーバーレイにする。ページ操作を遮断しない |
| 座標を要素のソースコードへ **"translating"** | 座標変換を経由せず、**`document.elementFromPoint()` の戻り値やイベントの `target`** から要素を直接取る |
| **"source code for the element"** を送信 | ソースコードそのものを送らず、**安定セレクタ・要素 ID・アクセシビリティ属性などの識別子だけ**を送る |
| first / second computing device に分かれた構成 | 分割侵害（§7 の *Akamai* 論点）と表裏。単一主体で完結する構成なら、逆に相手の立証も難しい |

→ **設計判断（spec に明記すること）: ①オーバーレイは操作を遮断しない ②要素はソースコードではなく安定セレクタで送る。**

⚠️ **これは素人によるクレーム解釈であり、均等論を考慮していない。** 特に「ソースコードではなくセレクタ」は均等の範囲と主張される余地がある。**実装前に弁理士による FTO 調査が必須。**

**さらに重要な教訓**: この特許は Atlassian でも Usersnap でもなく **Truist Bank** から出てきた。**「競合ベンダーの特許だけ調べる」やり方は危険**で、銀行・保険・小売などの事業会社が自社アプリのために取った UI 特許が地雷になる。FTO 調査の必要性は §7 時点よりも**上がった**。

### 9.5 日本の画像意匠 — SaaS 画面は登録できる。しかも米国より安く速く長い

**令和元年意匠法改正**（施行 令和2年4月1日）で意匠法2条1項の定義が改正され、**物品から離れた画像それ自体**が保護対象になった。保護されるのは2類型:

- **操作画像** — 「機器の操作の用に供される画像」
- **表示画像** — 「機器がその機能を発揮した結果として表示される画像」

**決定的な変更点**: 改正前の審査基準は「**インターネットを通じて表示される画像など、外部からの信号による画像**」を**保護対象外**としていた。改正後は**クラウド上に保存されネットワークを通じて端末に表示される画面デザイン**が対象になった。→ **SaaS のウィジェットは日本の意匠で守れる。**

- **対象外**: 映画・ゲームのコンテンツ、デスクトップ壁紙、**装飾的なウェブサイトレイアウト**。
  - → ⚠️ **「右下バブル」を装飾として出すと落ちる。「操作の用に供される画像」として構成する**こと。
- **部分意匠**（操作画像・表示画像の一部分）が登録可能。**機能に基づいて変化する画像も登録対象** → **C案の状態遷移を狙える。**
- **登録実例**: 意匠登録**第1691660号**「メニュー用画像」（Apple、ホーム画面でアイコン・ウィジェットを配置し起動する UI）、**第1694011号**「情報表示用画像」（Apple、充電中に時刻・バッテリー・通知を表示するロック画面 UI）。Yahoo、DiDi、EC 各社（楽天・Amazon・ZOZO）も出願している。

**費用・期間・存続**:

| 項目 | 金額・期間 |
|---|---|
| 出願料（特許庁） | **16,000円** |
| 登録料 第1〜3年 | 年 **8,500円** |
| 登録料 第4〜25年 | 年 **16,900円** |
| 弁理士費用（一例） | 出願 66,000円 + 登録 22,000円、**総額 11万2,500円程度** |
| 審査期間 | 最初の通知まで**平均6.1か月**（2024年）。**早期審査なら申請から平均2.1か月** |
| 存続期間 | **出願から最長25年**（2020-03-31 以前の出願は登録から20年） |

→ **日本の意匠は米国意匠より条件が良い。** 11万円台・6か月（早期なら2か月）・25年 vs 米国の $2,600＋代理人費用・16.4か月・15年。

### 9.6 最終勧告

**5軸比較**

| 軸 | 発明特許（B案: 同期・マスキング漏れ検出） | 日本の画像意匠 | 米国 GUI 意匠 | 先使用権＋公知化 |
|---|---|---|---|---|
| 費用 | 高（明細書が厚い） | **11万円台** | $2,600＋代理人 | **ほぼ0円** |
| 期間 | 年単位 | **6か月／早期2か月** | 16.4か月 | 即時 |
| §101 リスク | **最大** | なし | なし | — |
| §103 / 29条2項 | 厳しい | 相対的に緩い | LKQ 後も PTAB は権利者寄り | — |
| 競合を縛る力 | 中（B案は空いている） | **強**（UI は模倣が見える） | 強 | **なし**（守るだけ） |

**実行順序**:

1. **先使用権の証拠保全を今すぐ**（費用ゼロ）。設計文書と実装コミットにタイムスタンプ。特許庁自身が「営業秘密として管理しているだけでは抗弁できない」と警告している（§7）。
2. **日本の画像意匠を本命に据える。** 11万円・6か月・25年・§101 なし・許可率が高い。**「操作の用に供される画像」として構成し、部分意匠＋変化する画像で状態遷移を押さえる。** 公開したくなければ秘密意匠（意匠法14条、最長3年）。
3. **米国は仮出願で優先日だけ確保**し、1年かけて意匠本出願を判断。2026年3月ガイダンスで図面要件が緩んだので、以前より出しやすい。
4. **発明特許は B案（DOM イベント列と音声の時刻同期／マスキング漏れの事後検出）に絞って1本だけ。** §7 で「登録クレーム群に検証ステップが一つも現れない」と確認した領域である。
5. **US 11,327,625 の回避設計を spec に明記**（オーバーレイは操作を遮断しない／要素はセレクタで送る）**＋ 弁理士による FTO 調査**。

### 9.7 なお未確認

- **Jam.dev / Sentry Seer の特許**: 検索で発見できなかった。**「存在しない」証明ではない**（未公開の出願がありうる）。
- **秘密意匠（意匠法14条）の運用詳細**（申請要件・手数料）。
- **Atlassian / Pendo / Qualtrics 等の UI 特許の個別番号**: 特定できず。ただし §9.4 のとおり、**この領域の地雷は競合ベンダー以外から出てくる**ことが分かったので、網羅探索より正式な FTO 調査に費用をかけるべき。

### Sources（§9）

判例・実務データ:
[Dentons — LKQ が Graham factors を適用し Rosen-Durling を明示的に overrule](https://www.dentons.com/en/insights/alerts/2024/may/31/in-lkq-corp-v-gm) /
[Ballard Spahr — "improperly rigid" テストの廃止](https://www.ballardspahr.com/insights/alerts-and-articles/2024/05/full-federal-circuit-eliminates-improperly-rigid-tests-for-design-patent-obviousness) /
[Sterne Kessler — 102 F.4th 1280 の解説](https://www.sternekessler.com/news-insights/insights/2024-federal-circuit-ip-appeals-lkq-corporation-v-gm-global-technology-operations-llc-102-f-4th-1280-fed-cir-2024-en-banc-stoll/) /
[PTAB Litigation Blog — LKQ 後初の PTAB 判断（Next Step v. Deckers, IPR2024-00525）](https://www.ptablitigationblog.com/ptab-issues-first-post-lkq-design-patent-decision/) /
[JD Supra — 2024 Design Patents Year in Review（institution 38% / 無効率 65%）](https://www.jdsupra.com/legalnews/2024-design-patents-year-in-review-3688798)

USPTO 制度:
[Federal Register 2026-03-13 補足ガイダンス（GUI・アイコン意匠）](https://www.federalregister.gov/documents/2026/03/13/2026-04987/supplemental-guidance-for-examination-of-design-patent-applications-related-to-computer-generated) /
[Morgan Lewis — 表示パネル図示要件の撤廃](https://www.morganlewis.com/pubs/2026/03/uspto-expands-design-patent-protection-for-computer-generated-interfaces-and-icons) /
[MPEP 1504.01(a)（BitLaw）](https://www.bitlaw.com/source/mpep/1504-01-a.html) /
[35 U.S.C. §173 意匠の存続期間](https://uscode.house.gov/view.xhtml?req=granuleid%3AUSC-prelim-title35-section173&num=0&edition=prelim) /
[Finnegan — 意匠審査の許可率・維持年金](https://www.finnegan.com/en/insights/blogs/prosecution-first/five-fun-facts-about-us-design-patent-examination-that-you-probably-didnt-know.html)

特許:
[US 11,327,625 B2（Truist Bank）Google Patents](https://patents.google.com/patent/US11327625B2/en) /
[US 11,327,625 B2 クレーム全文（FreePatentsOnline）](https://www.freepatentsonline.com/11327625.html) /
[USPTO 公報 PDF](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11327625)

日本の意匠:
[BUSINESS LAWYERS — 画像意匠の留意点（操作画像／表示画像、クラウド）](https://www.businesslawyers.jp/practices/1280) /
[特許庁 意匠審査基準 第IV部 第1章「画像を含む意匠」](https://www.jpo.go.jp/system/laws/rule/guideline/design/shinsa_kijun/document/index/isho-shinsakijun-04-01.pdf) /
[井上特許事務所 — 意匠登録の費用・存続期間](https://www.inoue-patent.com/post/design-registration) /
[井上特許事務所 — 画面デザインの意匠登録（登録第1691660号・第1694011号）](https://www.inoue-patent.com/post/screen-design) /
[咲くやこの花法律事務所 — 審査期間 6.1か月／早期審査 2.1か月](https://kigyobengo.com/media/useful/718.html) /
[知財戦略パートナーズ — 画像の保護対象の拡張](https://chizai-partners.net/shop-design-and-business-style/extension-for-image-protection/)
