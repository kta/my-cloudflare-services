# アプリ内フィードバック・ウィジェット（録画/録音つき問い合わせ）— 市場調査と設計

- 調査日: 2026-09-03
- 対象: 画面右下バブル型のウィジェットから、画面録画・音声・マウス操作を記録し、タイトルを付けてそのまま SaaS 運営会社へ送信。AI が即答、または要望チケット化する仕組み。
- 前提リポジトリ: Cloudflare-only モノレポ（Workers + D1 + R2 + KV、**完全無料枠**）。ルートの `CLAUDE.md`（= `AGENTS.md`）の絶対ルールに従う。
- 本ドキュメントは調査 + 設計案。**挙動が変わる実装に入る前に `specs/<service>/features/NNN-feedback-widget/spec.md` を SDD で起票すること**（絶対ルール 1）。

---

## 0. 結論（3行）

1. カテゴリは既に成熟している。**録画できること自体に差別化はない**（Userback は無料プランでも録画・注釈が使える）。差別化は「送信後に何が起きるか」＝**AI 即答と要望チケット化**にある。
2. ブラウザの物理的制約により、**サードパーティ iframe に埋めた「ウィジェット型」は拡張機能型に構造的に劣後する**（クロスオリジン記録不可、`getDisplayMedia` にフレーム自身のユーザー操作が必要、画面音声はデスクトップ Chromium のみ ≒ 27.5%）。→ **自社 SaaS へ第一者スクリプトとして直接埋め込む前提なら、この制約はほぼ全部回避できる。これが我々の最大の優位。**
3. Cloudflare 無料枠では**サーバ側で映像を触れない**（CPU 10ms/req）。実装は「クライアントで rrweb を収集・マスキング・圧縮 → Worker は R2 へストリーム透過 → メタのみ D1」の一択。**MediaRecorder による実動画録画は第1フェーズでは採用しない。**

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
