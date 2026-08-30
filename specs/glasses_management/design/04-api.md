# 設計 04 — API

- サービス: `services/glasses_management`（Worker 名 `glasses-management` / dev port 5175）
- 契約の単一ソース: `packages/contracts/src/glasses_management.ts`（0 ベースで書き直す）→ `packages/contracts/src/index.ts` から re-export
- 実装: `services/glasses_management/src/worker/index.ts`（ルートのチェーン）+ `src/worker/domain/*.ts`（純関数）
- 上位: `specs/glasses_management/00_service-spec.md` / 兄弟: `03-data-model.md`（テーブル）・`05-screen-flow.md`（画面）・`07-nfr.md`（非機能）

この文書は「誰が実装しても同じ URL・同じ入出力・同じエラーになる」ことを目的にする。
画面が要求しない項目は足さない。モックに描かれていない値のうち、モックとブリーフから読み取れるもの・設計判断で決まるものは
**この文書で決める**。**発注元（EYEX）の運用・法務・機材の実情を知らないと決められないものだけ** `[要確認: ...]` を残す（§8）。

---

## 1. 方針

| # | 決め | 具体 |
|---|---|---|
| 1 | Zod 単一ソース | 入出力スキーマは `packages/contracts/src/glasses_management.ts` にだけ書く。Worker とフロントは同じスキーマを import する。手書き型・`any` を書かない（`unknown` + Zod）。 |
| 2 | ルートはチェーン | `const routes = app.get(...).post(...).patch(...)` の 1 式にする。`export type AppType = typeof routes`。文を分けて `app.get(...)` と書くと RPC 型に載らない。 |
| 3 | `zValidator` はルート内インライン | `app.use` に置かない。`zValidator('json', X)` / `zValidator('query', X)` / `zValidator('param', X)` をルート定義の引数として書く。でないと `c.req.valid()` とクライアント入力型が伝播しない。 |
| 4 | レスポンスは契約で `parse` してから返す | `return c.json(ReservationDetail.parse(row))` の形にする。D1 の行をそのまま `c.json` しない（列追加が無検査で外へ漏れる）。配列は `X.array().parse(rows)`。 |
| 5 | CORS を書かない | SPA と API は同一 Worker・同一オリジン（`assets.run_worker_first: ['/api/*']`）。`hono/cors` を import しない。 |
| 6 | クライアントは `hc<AppType>('/')` | `AppType` は **type-only import**。base は `'/'`。fetch を素で書かない。 |
| 7 | `zValidator` を持たないハンドラは 2 本だけ | `GET /api/health` と `POST /api/auth/token`（dev トークングラント）。**このうちチェーンの外に置くのは `POST /api/auth/token` だけ**で、`GET /api/health` はチェーンに載せる（`services/example_service/src/worker/index.ts` と同形）。それ以外は必ず入力スキーマ付きの RPC ルートにする。 |
| 8 | エラー形状は `{ error: '<code>' }` | `app.onError` で `HTTPException` は透過、予期しない throw は `console.error` + `{ error: 'internal_error' }` + 500。ハンドラ内で握りつぶさない。詳細は §5。 |
| 9 | ドメインロジックは純関数 | 空き枠計算・重なり判定・保持期限・統合プレビューは `src/worker/domain/*.ts` に純関数として置き、**時刻は必ず引数で注入**する（`now: Date`）。ハンドラは D1 読み書きと `parse` だけを行う。 |
| 10 | 型推論の重さ | 本設計のルートは 100 本（うち RPC チェーンに載るのは dev トークングラントを除く 99 本）。`hc<AppType>` の推論が遅くなったら（`pnpm --filter @app/glasses_management typecheck` が 60 秒を超えたら）Hono 公式の `hcWithType`（事前生成）へ切り替える。それまでは足さない。 |

### 1.1 パスの決め

| 面 | 前置 | 例 |
|---|---|---|
| ヘルス・dev | なし | `/api/health` `/api/auth/token` |
| 業務 | `/api/staff/` | `/api/staff/reservations` |
| お客様向け Web 予約 | `/api/public/` | `/api/public/stores/:storeSlug/availability` |
| 他 Worker から | `/api/internal/` | `/api/internal/organizations/sync` |

- リソース名は複数形（`stores` / `reservations` / `customers`）。
- 店舗に属するリソースは `/{store 配下}` にネストする（`/api/staff/stores/:storeId/equipment`）。
  店舗をまたぐ検索・台帳・分析は平坦なパス + `storeId` クエリにする（`/api/staff/ledger?storeId=...`）。
- **`storeId` は必ず path か query で明示的に受ける。** ヘッダーや前回値から推測しない
  （選択中店舗はヘッダーで明示的に切り替える運用のため。決定ブリーフ §2）。
  `storeId` は**データの絞り込みにだけ使い、認可の根拠にしない**（認可は JWT の `org` と membership）。

### 1.2 一覧のページング（本文書で新たに定める）

リポジトリに明文の規定がないため、この面では次に統一する。

| 項目 | 値 |
|---|---|
| クエリ | `limit`（既定 50・最小 1・最大 200）/ `cursor`（不透明文字列。省略で先頭） |
| 応答 | `{ items: [...], nextCursor: string \| null, total: number }` |
| 並び | 決定ブリーフ §3 のとおり `created_at` 昇順を既定とし、時系列の面（台帳・履歴・分析）だけ `starts_at` / `occurred_at` 順にする |

`total` を返す根拠: CUSTOMER-LIST「当てはまるお客様 42名」「ほか 34名」、LEDGER-LIST「すべて 12件」、
HISTORY-LIST「2026年8月27日（木）46件」「ほか 42件」が総件数を表示するため。

---

## 2. 認可の層

実装は `packages/shared/src/auth-server.ts` のミドルウェアを使う。**自前で JWT を検証し直さない。**

```ts
app.onError(...)                                  // §5

app.use('/api/internal/*', internalAuth())        // 共有キー。JWT ゲートの外

app.use(
  '/api/*',
  except(
    ['/api/health', '/api/auth/*', '/api/internal/*', '/api/public/*'],
    tenantAuth(),
    requireActiveOrg(orgResolver),
  ),
)
```

| 層 | 役割 | 通らないときの応答 |
|---|---|---|
| default-deny gate | `except([...])` に列挙した 4 つ以外の `/api/*` は**ルートを足しただけで保護される**。個別ルートに認証を足して回らない | 下の各層の応答 |
| `tenantAuth()` | `Authorization: Bearer <jwt>` を検証し `c.var.auth = { sub, org, email, role }` を確立 | **401 `unauthorized`**（無し／不正／**期限切れ**／別 secret 署名） |
| `requireActiveOrg(orgResolver)` | 同期コピーの `organizations` 行を毎リクエスト解決。`plan` はここで載せる（JWT クレームに入れない） | 行なし = **503 `not_synced`**（リトライで回復し得る）／`is_disabled='1'` = **403 `org_disabled`** |
| `requireStorePermission(perm)`（この面で新規に作る） | 店長だけの操作（§3 の「認証」列が `JWT+店長`）に付ける。判定材料は **JWT の `role` ではなく選択中店舗の `StorePermission` セット**（§2.2）。`packages/shared` の `requireRole()` はこの面では使わない | **403 `forbidden`** |
| `requirePersonalMode()`（この面で新規に作る） | 共有端末で「ご本人の確認」が要る操作に付ける。`terminal_sessions` の `mode='personal'` かつ `expires_at > now` かつ `revoked_at IS NULL` を要求する | **403 `personal_mode_required`** |
| `internalAuth()` | `/api/internal/*` を `x-internal-key` で守る。キー未設定なら**全拒否（fail close）**。テナント JWT では越えられない | **401 `unauthorized`** |

### 2.1 401 と 403 と 503 の使い分け（取り違えない）

| 状況 | status | code | クライアントの動き |
|---|---|---|---|
| トークンが無い／壊れている／**期限切れ**／別 secret で署名 | **401** | `unauthorized` | 再ログイン（LOGIN-STAFF へ） |
| ログイン済みだが権限が足りない（**保存**をスタッフが叩いた） | **403** | `forbidden` | EX-PERMISSION を出す。入力は捨てない |
| ログイン済みだが権限が足りない（**閲覧**の GET を開こうとした） | **403** | `forbidden` | 「この画面は店長だけがご覧になれます」＋「前の画面に戻る」を出す。EX-PERMISSION は使わない |
| ログイン済みだが共有モードのまま「ご本人の確認」が要る操作を叩いた | **403** | `personal_mode_required` | MODE-PERSONAL を開き、成功後に元の操作へ戻る |
| org 同期行がまだ届いていない | **503** | `not_synced` | 数秒後に自動リトライ。ログアウトしない |
| org が無効化された | **403** | `org_disabled` | 業務を終える案内 |

**クライアントの再ログイン判定はこの区別だけに依存する。**期限切れを 403 で返してはならない。

**`forbidden` は 1 コードのまま、画面だけを 2 つに割る。**EX-PERMISSION は
「営業時間と定休日を変えられるのは 店長 だけです。…設定はまだ何も変わっていません。」＋
「この下書きを店長に依頼する」という文言で、**未保存の下書きがある**ことを前提にしている。
GET が 403 で跳ねられた場面には下書きが無いので、この形をそのまま当てられない。
どちらを出すかは**叩いたメソッドがクライアント側で分かる**ので、応答にフィールドを足さない
（GET → 閲覧の面／それ以外 → EX-PERMISSION）。この対応が成り立つのは、§3 で `+店長` が付く GET が
`GET /api/staff/audit` の 1 本だけで、残りの `+店長` がすべて書き込みだからである
（読み取り専用の `POST /api/staff/settings/impact` は `+店長` を持たないので 403 にならない）。
`+店長` の付く GET を増やすときは、この行も一緒に読み直す。
対応する画面は `05-screen-flow.md` §7.3 で定義する。

**`requireRole('admin')` を店長判定に使わない理由**: `packages/contracts/src/auth.ts` の `Role` は
`admin` / `staff` の 2 値で、これは admin コンソール上の役割であって「この店舗の店長かどうか」ではない。
さらに EX-PERMISSION の「店長の暗証番号で続ける」は**端末側の昇格**であり、JWT を再発行しないので
`c.var.auth.role` は変わらない。店長判定は必ず §2.2 の `StorePermission` で行う。

`[要確認: Q-07 — いまの前提で進める]`（`design/09-open-questions.md`）。いまの前提: **admin に任せる**。admin 側に実在する `/api/internal/domain-auth/login` `/refresh` `/pin/verify` を service binding で呼び、`ADMIN` binding と PIN 用の鍵（`AUTH_PEPPER`）を決定ブリーフ §1 に足す。この設計は「端末は既に org スコープの JWT を保持している」前提で `/api/staff/terminals/:terminalId/sessions` から始まる。

### 2.2 「店長だけ」と「ご本人の確認」の割り当て

| 区分 | 根拠（モック） | 対象 |
|---|---|---|
| 権限が要る（`requireStorePermission(perm)`。§3 の `+店長`） | EX-PERMISSION「営業時間と定休日を変えられるのは 店長 だけです。中村 彩（スタッフ）の権限では保存できません。設定はまだ何も変わっていません。」／SETTINGS-STAFF「できる役割　スタッフ（設定は見るだけ）」 | 下の対応表 |
| ご本人の確認（`requirePersonalMode()`。§3 の `+本人`） | LOGIN-SHARED-PIN「ご本人の確認が必要　録音の保全　注意ごとの公開　設定の変更」／ MODE-PERSONAL「録音の保全にはご本人の確認が必要です」 | 録音の保全、注意ごとの公開、設定の書き込み全般 |
| どちらも不要 | LOGIN-SHARED-PIN「個人を選ばずにできる　予約を受ける　台帳を見る　ご来店を受け付ける」 | 予約の作成・変更・取消、台帳、来店受付、ウォークイン、顧客の検索・作成・更新、予約検索、受付履歴の閲覧 |

権限の語彙は**新設しない**。`packages/contracts/src/glasses_management.ts` に既にある `StorePermission`
（`store.read` / `store.manage` / `reservation.read` / `reservation.write` / `customer.read` / `customer.write` /
`customer.history` / `attention.read` / `attention.write` / `attention.publish` / `attention.revise` / `attention.hide` /
`settings.read` / `settings.manage` / `recording.read` / `recording.manage` / `audit.read` / `terminal.manage` /
`analytics.read`）をそのまま使い、`POST /api/internal/store-memberships/sync` が届けたセットで判定する。

| 操作グループ | 要求する権限 |
|---|---|
| 店舗・営業時間・カレンダー・予約のきまりの書き込み | `settings.manage` |
| スタッフ・技能・勤務時間・スタッフ PIN の書き込み | `settings.manage` |
| 設備・点検の書き込み | `settings.manage` |
| ご来店の目的の書き込み | `settings.manage` |
| Web 予約の公開設定の書き込み・承認/却下 | `settings.manage` |
| 端末の登録・更新（PIN と自動ロック） | `terminal.manage` |
| 録音の削除 | `recording.manage` |
| 監査の閲覧 | `audit.read` |

設定の書き込みは**権限と個人モードの両方**を要求する（上の 1 行目と 2 行目が重なる）。

**閲覧の権限（5 値）は、いま `audit.read` の 1 つしか使っていない。**
`StorePermission` の 19 値のうち `store.read` / `reservation.read` / `customer.read` / `attention.read` /
`settings.read` は「その画面を開ける」ことを表し、`customer.history` / `recording.read` / `analytics.read` /
`audit.read` は**より狭い閲覧**を表す。しかし §3 で `requireStorePermission` を付けた**読み取り**は
`GET /api/staff/audit` の 1 本だけで、ほかの読み取りはすべて素の `JWT` になっている。

| 閲覧の権限 | 付ける候補 | いまの状態 |
|---|---|---|
| `audit.read` | `GET /api/staff/audit` | **付けている**（§3.10） |
| `analytics.read` | `GET /api/staff/analytics` / `GET /api/staff/analytics/targets` | 付けていない |
| `customer.history` | `GET /api/staff/customers/:customerId`（他店で書かれた来店履歴を含む） | 付けていない |
| `recording.read` | `GET /api/staff/recordings` / `POST /api/staff/recordings/:id/playback` | 付けていない（下の `[要確認]` と同じ論点） |
| `attention.publish` | `POST /api/staff/customers/:customerId/notes/:noteId/publish` | 付けていない（個人モードだけを要求している） |

`[要確認: Q-03 — いまの前提で進める]`（`design/09-open-questions.md`）。いまの前提: 上表の 4 つ（`analytics.read` / `customer.history` / `recording.read` / `attention.publish`）を**サーバ側で強制する**。録音の再生とお客様のおまとめは個人モード（本人の PIN）を必須にする。強制する以上、403 は §2.1 の「閲覧」側の面になり、サイドバーからその行き先も隠す。`03-data-model.md` §16 #1 と同じ問い。

**個人モードだけを要求する操作**（権限は要求しない）: 顧客の統合実行、注意ごとの公開、録音の保全・再生。
根拠は「操作した者が名前で残る必要がある」こと — START-DEVICE-MODE が共有端末の「記録される名前」を
「置き場所の名前（例：レジ横iPad）」と定めており、CUSTOMER-MERGE は「操作した者と日時は記録に残ります。」と
約束しているため、共有モードのままでは約束を果たせない。

上表が権限を要求せず個人モードだけを要求しているのは、この 4 つの扱いが未決だからである（1 つ上の `[要確認]` に含めた）。

`[要確認: Q-10 — いまの前提で進める]`（`design/09-open-questions.md`）。いまの前提: **承認は要る**。`customer_notes.status` を `draft` → 店長が `published` にし、設定の依頼はお知らせ（`alerts`）に 1 件立ててALERTS から承認の面へ入る。承認できるのは同じ店舗の店長。依頼を受け取る API はこの面に無いので、**答えが来るまで「この下書きを店長に依頼する」のボタンを画面に出さない**（押せて何も起きないボタンを作らない）。

---

## 3. エンドポイント一覧

「認証」列の読み方: `none`＝素通し／`key`＝`x-internal-key`／`JWT`＝テナント JWT + 有効 org／
`+店長`＝`requireStorePermission(...)` を追加（要求する権限は §2.2 の対応表）／`+本人`＝`requirePersonalMode()` を追加。
「入力」列で `param` は URL パス、`query` はクエリ文字列、それ以外は JSON body を指す。
エラー列は §5 のコード。全ルートに 401 / 403 / 503 / 500 が共通で起こり得るため、各行では**そのルート固有のもの**だけを書く。

### 3.1 ヘルス・dev トークン（2 本）

| メソッド | パス | 認証 | 入力 | 出力 | 主なエラー | 使う画面 |
|---|---|---|---|---|---|---|
| GET | `/api/health` | none | — | `HealthStatus` | — | 起動時の疎通確認・EX-OFFLINE の再接続 |
| POST | `/api/auth/token` | none（`AUTH_DEV_GRANT === 'true'` のときだけ） | `IssueTokenRequest` | `IssueTokenResponse` | 404 `not_found`（dev グラント無効時 = 本番） | dev のみ。画面からは呼ばない |

`POST /api/auth/token` はルートのチェーンに**含めない**（RPC 型に載せない）。本番で `AUTH_DEV_GRANT` を設定しない。

### 3.2 internal（他 Worker から。5 本）

| メソッド | パス | 認証 | 入力 | 出力 | 主なエラー | 呼び出し元 |
|---|---|---|---|---|---|---|
| POST | `/api/internal/organizations/sync` | key | `OrganizationSync` | `OrganizationSync` | — | admin（`services/admin/src/worker/sync.ts` が `https://glasses-management.internal/api/internal/organizations/sync` を固定で持つ）。**これが正本パス**。`POST /api/internal/organizations`（`/sync` なし）は作らない — 決定ブリーフ §1 の表記は誤りで、`00_service-spec.md` と決定ブリーフ §12.4 が `/sync` を正としており、P0 実装にもそのルートは無い |
| GET | `/api/internal/organizations` | key | — | `OrganizationSync[]` | — | admin の照合（drift 検知） |
| POST | `/api/internal/store-memberships/sync` | key | `StoreMembership` | `StoreMembership` | 400（未知の権限語） | admin（`services/admin/src/worker/sync.ts` が `https://glasses-management.internal/api/internal/store-memberships/sync` を固定で持つ。1 件ずつ送る。`permissions: []` は担当解除の墓標） |
| POST | `/api/internal/maintenance/recordings/purge` | key | `RecordingPurgeRequest` | `RecordingPurgeResult` | — | 保守。保持期限を過ぎた録音の掃除 |
| POST | `/api/internal/maintenance/web-publications/apply` | key | `WebPublicationApplyRequest` | `WebPublicationApplyResult` | — | 保守。①`web_booking_settings` の公開予定の反映 ②**受信日（`web_bookings.created_at` の JST 暦日）の 24:00 JST を過ぎても `pending` のままの `web_bookings` を `cancelled` にする**（ALERTS「本日中に確認しないと自動で取り消されます。」。起算日は**受信日**であって来店日ではない。`02-domain-model.md` §3 の W4 と `03-data-model.md` §11.2 に揃える） |

**organizations の upsert 規則**（admin の実装に合わせる）:

| 条件 | 挙動 |
|---|---|
| 行が無い | そのまま insert |
| 受信 `revision` > 保存 `revision` | 上書き（`name` / `plan` / `is_disabled` / `revision`） |
| 受信 `revision` < 保存 `revision` | **無視**して保存済みの行をそのまま返す（到着順の逆転で古い状態へ戻さない） |
| 受信 `revision` == 保存 `revision` かつ内容が同じ | 冪等。保存済みの行を返す |
| 受信 `revision` == 保存 `revision` かつ内容が違う | **届いた内容で上書きして 200**（admin が源泉なので、同じ revision の内容差は受け入れる） |

admin（`services/admin/src/worker/sync.ts` の `matchesCanonicalSnapshot`）は応答を `OrganizationSync.safeParse`
したうえで `id` / `name` / `plan` / `isDisabled` / `createdAt` / `revision` の**6 フィールド全一致**を要求する。
応答は受け取った snapshot をそのまま返す（加工しない）。

**同一 revision・内容相違で 409 を返さない。**admin は 429 と 5xx だけを retryable と扱う
（`services/admin/src/worker/sync.ts` の `retryable: response.status === 429 || response.status >= 500`）ので、
409 は non-retryable になり、admin が呼び出し元へ 502 `organization_sync_failed`（`retryable: false`）を返して
**人に見える形で失敗する**。P0 実装（`services/glasses_management/src/worker/index.ts`）も
`Number(existing.revision ?? '0') > incoming.revision` のときだけ早期 return する形で、同値なら upsert して 200 を返す。
`00_service-spec.md`（Approved）も同じ挙動を書いている。**実装と 00 が正で、`sync_revision_conflict` というコードは作らない**。

`revision` の比較は**アプリ層で `Number()` に通して**行う（列は `text`。`03-data-model.md` §3.1）。
`WHERE revision <= ?` という SQL を書くと文字列比較になり、`'10' < '2'` が真になって revision 10 以降の配信が全部無視される。

**保守 2 本は `glasses-management` に割り当てた Cron 枠 1 本から呼ぶ。**アカウント全体の Cron 枠は 5 本あり、
**現時点で `triggers.crons` を持つ Worker は 0 本である**（実測。`services/ops` はこのリポジトリに存在しない）。
このサービスが**1 本目**を使う。`services/glasses_management/wrangler.jsonc` には `triggers.crons` も
`export default { scheduled }` も無いので、**Cron を最初に必要とするフェーズの TASKS で足す**。1 本の `scheduled` の中で
録音の掃除・公開予定の反映と pending 自動取消・勤務の窓送り・`analytics_daily` の再計算・前日の `waiting` の後始末を
順に呼ぶ（`03-data-model.md` の各節が挙げた日次処理はすべてこの 1 本に乗せる）。運用者が手で叩く経路も残す。

`POST /api/internal/store-memberships/sync`（入力スキーマは `StoreMembership`）が受け取った `permissions` は
**`store_memberships`（`03-data-model.md` §3.2）の `permissions` 列に空白区切りの文字列として**丸ごと置き換えで保存する（決定ブリーフ §12.4 で正式表として確定済み）。`requireStorePermission()` はこの表だけを読む。

### 3.3 staff — 店舗と受付条件（設定 7 画面。24 本）

**SETTINGS-STAFF だけは 1 画面 2 本になる**（`GET .../staff` と `GET .../staff-shifts`）。勤務は曜日テンプレートの
展開結果で、スタッフ本体とは更新の単位も権限の粒度も違うため 1 本にまとめない。
`07-nfr.md` §4.1 の「設定は 1 画面 1 本」は、この面ではこの 2 本を上限として読む（お知らせ件数の 1 本は別枠）。

| メソッド | パス | 認証 | 入力 | 出力 | 主なエラー | 使う画面 |
|---|---|---|---|---|---|---|
| GET | `/api/staff/stores` | JWT | — | `Store[]` | — | ヘッダーの店舗切替（LOGIN-SHARED「別の店舗　丸の内店・新宿店」）、ANALYTICS の「店舗：銀座店 ▾」 |
| GET | `/api/staff/stores/:storeId` | JWT | param `StoreIdParam` | `StoreDetail` | 404 `not_found` | SETTINGS-STORE |
| PATCH | `/api/staff/stores/:storeId` | JWT+店長+本人 | `StorePatch` | `StoreDetail` | 409 `version_conflict` | SETTINGS-STORE の「保存」 |
| GET | `/api/staff/stores/:storeId/business-hours` | JWT | param | `BusinessHoursView` | 404 `not_found` | SETTINGS-HOURS |
| PUT | `/api/staff/stores/:storeId/business-hours` | JWT+店長+本人 | `BusinessHoursInput` | `BusinessHoursView` | 409 `version_conflict` | SETTINGS-HOURS の「保存」 |
| GET | `/api/staff/stores/:storeId/calendar-exceptions` | JWT | query `CalendarExceptionQuery` | `CalendarException[]` | — | SETTINGS-CALENDAR（2 か月ぶん） |
| POST | `/api/staff/stores/:storeId/calendar-exceptions` | JWT+店長+本人 | `CalendarExceptionInput` | `CalendarException` | 409 `version_conflict` | SETTINGS-CALENDAR の日付タップ |
| DELETE | `/api/staff/stores/:storeId/calendar-exceptions/:exceptionId` | JWT+店長+本人 | param | `DeletedResult` | 404 `not_found` | SETTINGS-CALENDAR の日付タップ（戻す） |
| GET | `/api/staff/stores/:storeId/slot-rules` | JWT | param | `SlotRules` | 404 `not_found` | SETTINGS-HOURS 右カラム「予約の間隔」 |
| PUT | `/api/staff/stores/:storeId/slot-rules` | JWT+店長+本人 | `SlotRulesInput` | `SlotRulesView` | 409 `version_conflict` | SETTINGS-HOURS の「保存」 |
| GET | `/api/staff/stores/:storeId/staff` | JWT | query `StaffListQuery` | `StaffMember[]` | — | SETTINGS-STAFF 左／LOGIN-STAFF／MODE-PERSONAL／台帳の行 |
| POST | `/api/staff/stores/:storeId/staff` | JWT+店長+本人 | `StaffMemberInput` | `StaffMember` | — | SETTINGS-STAFF「＋ スタッフを足す」 |
| PATCH | `/api/staff/stores/:storeId/staff/:staffId` | JWT+店長+本人 | `StaffMemberPatch` | `StaffMember` | 409 `version_conflict` | SETTINGS-STAFF 右 |
| PUT | `/api/staff/stores/:storeId/staff/:staffId/skills` | JWT+店長+本人 | `StaffSkillsInput` | `StaffMember` | — | SETTINGS-STAFF「できること（技能）」のチップ |
| PUT | `/api/staff/stores/:storeId/staff/:staffId/pin` | JWT+店長+本人 | `StaffPinInput` | `PinSetResult` | 400 `weak_pin` | SETTINGS-STAFF「PIN　設定してあります＋作り直す」 |
| GET | `/api/staff/stores/:storeId/staff-shifts` | JWT | query `StaffShiftQuery` | `StaffShift[]` | — | SETTINGS-STAFF「勤務時間」／LOGIN-STAFF の「本日の勤務」／空き枠 |
| PUT | `/api/staff/stores/:storeId/staff-shifts` | JWT+店長+本人 | `StaffShiftsInput` | `StaffShift[]` | 409 `version_conflict` | SETTINGS-STAFF の「保存」 |
| GET | `/api/staff/stores/:storeId/equipment` | JWT | query `EquipmentListQuery` | `Equipment[]` | — | SETTINGS-EQUIPMENT 一覧／LEDGER-RESOURCE の行 |
| POST | `/api/staff/stores/:storeId/equipment` | JWT+店長+本人 | `EquipmentInput` | `Equipment` | — | SETTINGS-EQUIPMENT「＋ 設備を足す」 |
| PATCH | `/api/staff/stores/:storeId/equipment/:equipmentId` | JWT+店長+本人 | `EquipmentPatch` | `Equipment` | 409 `version_conflict` | SETTINGS-EQUIPMENT「編集中：視力測定機 B」 |
| GET | `/api/staff/stores/:storeId/equipment/:equipmentId/maintenance` | JWT | query `MaintenanceQuery` | `EquipmentMaintenance[]` | — | SETTINGS-EQUIPMENT「次の点検」 |
| POST | `/api/staff/stores/:storeId/equipment/:equipmentId/maintenance` | JWT+店長+本人 | `EquipmentMaintenanceInput` | `EquipmentMaintenance` | 409 `slot_taken` | SETTINGS-EQUIPMENT「止める期間」 |
| DELETE | `/api/staff/stores/:storeId/equipment/:equipmentId/maintenance/:maintenanceId` | JWT+店長+本人 | param | `DeletedResult` | 404 `not_found` | SETTINGS-EQUIPMENT |
| POST | `/api/staff/settings/impact` | JWT | `SettingsImpactRequest` | `SettingsImpactReport` | — | SETTINGS-EQUIPMENT「止めると影響するご予約 3件」／SETTINGS-PURPOSE「60分に延ばすと受けられなくなるWeb枠 2件」／SETTINGS-HOURS「木曜日に最後にお受けできるのは 18:20 です。」 |

**`PUT /api/staff/stores/:storeId/staff-shifts` は曜日パターンを受ける。**SETTINGS-STAFF の「勤務時間」が
曜日単位（月 10:00–19:00 ／ 火 定休日 ／ 金 お休み …）で編集する面だからである。
**送られた 7 行は `staff_weekly_shifts`（`03-data-model.md` §5.6）に正本として保存し、
そこから `effective_from` を起点に 62 日先まで `staff_shifts` へ展開して置き換える。**
日付表だけを持つと、最後に保存した日から 62 日を過ぎた日は全担当が勤務外＝全時刻が満席になり、
Web 予約（30 日先まで）の受付窓が誰も操作しないまま閉じていく。
**窓は日次 Cron（§3.2）が毎日 1 日ぶん先へ送る。**
勤務帯が営業時間の外にはみ出しても保存は拒まず、応答に警告（`warnings: string[]`）を載せる。

**`POST /api/staff/settings/impact` は保存しない。**「保存の前に影響を見せる」ための読み取り専用の試算で、
未保存の設定値を body で受け取り、影響する予約・Web 枠・最終受付時刻を返す（3 画面で同じ器を使う）。

### 3.4 staff — ご来店の目的（5 本）

| メソッド | パス | 認証 | 入力 | 出力 | 主なエラー | 使う画面 |
|---|---|---|---|---|---|---|
| GET | `/api/staff/purposes` | JWT | query `PurposeListQuery` | `VisitPurpose[]` | — | SETTINGS-PURPOSE／BOOK-02-PURPOSE／LEDGER-WALKIN のご用件 |
| POST | `/api/staff/purposes` | JWT+店長+本人 | `VisitPurposeInput` | `VisitPurpose` | — | SETTINGS-PURPOSE「＋ 目的を足す」 |
| PATCH | `/api/staff/purposes/:purposeId` | JWT+店長+本人 | `VisitPurposePatch` | `VisitPurpose` | 409 `version_conflict` | SETTINGS-PURPOSE「編集中：メガネを新しく作る」 |
| PUT | `/api/staff/purposes/:purposeId/requirements` | JWT+店長+本人 | `PurposeRequirementsInput` | `VisitPurpose` | — | SETTINGS-PURPOSE「必要な技能」「必要な設備・場所」 |
| PUT | `/api/staff/purposes/order` | JWT+店長+本人 | `PurposeOrderInput` | `VisitPurpose[]` | — | SETTINGS-PURPOSE「この順でお客様にお見せします。」 |

`visit_purposes.store_id` が NULL の行はチェーン共通。`GET` は `storeId` を渡すと
「その店舗の行 + チェーン共通の行」を `sort_order` 昇順で返す。

### 3.5 staff — 空き枠（1 本）

| メソッド | パス | 認証 | 入力 | 出力 | 主なエラー | 使う画面 |
|---|---|---|---|---|---|---|
| GET | `/api/staff/availability` | JWT | query `AvailabilityQuery` | `AvailabilityResponse` | 409 `store_closed` / 409 `purpose_unavailable` | BOOK-01-DATETIME（時刻の「あと2枠／満席」）／BOOK-02b-PURPOSE-CONFLICT（受けられない理由と代替）／BOOK-03-SLOT-STAFF・BOOK-03b-SLOT-RESOURCE・BOOK-03c-DRAG（担当軸・設備軸の置ける枠）／CHANGE-DATETIME（60分の枠が取れる時刻）／BOOK-CONFLICT（代わりの時刻・担当） |

- クエリ: `storeId`（必須）/ `date`（必須 `YYYY-MM-DD`）/ `purposeIds`（カンマ区切り。0 件可）/
  `durationMinutes`（省略時は目的の合計）/ `staffId`（絞る）/ `equipmentIds`（カンマ区切り）/
  `excludeReservationId`（変更時に自分を除外する。CHANGE-DATETIME で必須）/
  `excludeReceptionSessionId`（**自分の受付が置いた仮の押さえを塞がりに数えない**。BOOK-02b 以降で必須）/
  `axis`（`staff` \| `resource`）。
- 応答は決定ブリーフ §4 の 8 条件をこの順で適用した結果を返す。**判定に使った理由を必ず添える**
  （BOOK-02b-PURPOSE-CONFLICT が「視力測定機が 11:30 から点検です。」と理由を出すため）。
- `store_closed` / `purpose_unavailable` は **200 の応答本文で `slots: []` + `reason` を返すのが既定**。
  409 を返すのは「日付が営業日でないと分かった状態で `POST /api/staff/reservations` を叩いたとき」だけ（§5）。
- 担当が未定（`reservation_assignments.target_id IS NULL`）の予約も枠を消費する。

### 3.6 staff — 予約（10 本）

| メソッド | パス | 認証 | 入力 | 出力 | 主なエラー | 使う画面 |
|---|---|---|---|---|---|---|
| POST | `/api/staff/holds` | JWT | `HoldInput` | `Hold` | **—（常に 200）** | BOOK-05-CONFIRM「仮の押さえ → 11:18 まで」。KV に CAS が無く「取れなかった」を判定できないので 409 `slot_taken` を返さない（§6.3） |
| DELETE | `/api/staff/holds/:holdId` | JWT | param | `DeletedResult` | 404 `not_found` | BOOK-05-CONFIRM から戻ったとき・BOOK-CONFLICT の選び直し |
| POST | `/api/staff/reservations` | JWT | `StaffReservationCreate` + `Idempotency-Key` | `ReservationDetail` | 409 `slot_taken` / 409 `store_closed` / 409 `purpose_unavailable` / 409 `idempotency_conflict` / 409 `code_exhausted` | BOOK-05-CONFIRM「復唱を終えて予約を確定する」→ BOOK-06-DONE／BOOK-CONFLICT |
| GET | `/api/staff/reservations/:reservationId` | JWT | param | `ReservationDetail` | 404 `not_found` | LEDGER-DETAIL／CHANGE-SEARCH 右／RECEPTION-CHECKIN |
| GET | `/api/staff/reservations` | JWT | query `ReservationSearchQuery` | `ReservationList` | — | CHANGE-SEARCH（結果 4件）／EX-EMPTY-SEARCH／HOME-PERSONAL「本日わたしが担当するご予約 4件」 |
| GET | `/api/staff/ledger` | JWT | query `LedgerQuery` | `LedgerView` | — | LEDGER-STAFF／LEDGER-RESOURCE／LEDGER-LIST／LEDGER-WALKIN／EX-OFFLINE |
| PATCH | `/api/staff/reservations/:reservationId` | JWT | `ReservationChangeInput`（`version` 必須） | `ReservationDetail` | 409 `version_conflict` / 409 `slot_taken` | CHANGE-DATETIME → CHANGE-DIFF →「変更を確定する」／BOOK-03c-DRAG のドラッグ確定／EX-CONFLICT |
| POST | `/api/staff/reservations/:reservationId/cancel` | JWT | `ReservationCancelInput`（`version` 必須） | `ReservationDetail` | 409 `version_conflict` | CHANGE-CANCEL「この予約を取り消す」 |
| PATCH | `/api/staff/reservations/:reservationId/progress` | JWT | `ReservationProgressPatch`（`version` 必須） | `ReservationDetail` | 409 `version_conflict` | LEDGER-LIST の「ご来店」／RECEPTION-CHECKIN「ご来店を受け付ける」 |
| GET | `/api/staff/reservations/:reservationId/history` | JWT | param | `ReservationChangeHistory[]` | 404 `not_found` | HISTORY-LIST 右「そのあとの変更」 |

**状態遷移**（`reservations.status`。表にない遷移は 409 `invalid_transition`）:

| 現在 | 許す次 | 使うルート | 画面 |
|---|---|---|---|
| `confirmed` | `arrived` | `PATCH .../progress` | LEDGER-LIST「ご来店」／RECEPTION-CHECKIN「ご来店を受け付ける」 |
| `confirmed` | `cancelled` / `no_show` | `POST .../cancel` | CHANGE-CANCEL |
| `arrived` | `serving` | `PATCH .../progress` | RECEPTION-JOURNEY「対応中」 |
| `arrived` | `cancelled` | `POST .../cancel` | CHANGE-CANCEL |
| `serving` | `done` | `PATCH .../progress` | RECEPTION-JOURNEY「お渡し」 |
| `done` | （なし） | — | — |
| `cancelled` / `no_show` | （なし） | — | — |

**`PATCH .../progress` で `cancelled` / `no_show` へ移せない。** 取消は理由（`cancel_reason`）が必須なので
`POST /api/staff/reservations/:reservationId/cancel` だけが入口である（道を 2 本にしない）。

**取消の理由**（`reservations.cancel_reason`）は CHANGE-CANCEL の 4 択に固定する:
`customer`（お客様のご都合）/ `store`（店舗の都合）/ `duplicate`（予約の重複）/ `no_show`（ご来店がなかった）。
**理由は必須**で、既定で 1 つを選んだ状態にしない（既定があると、店舗都合・重複の取消が押し間違いで
お客様都合として残り、ANALYTICS-CANCEL の内訳と受付履歴の説明が実態とずれる）。
理由から結果の状態が決まる。`reason='no_show'` なら `status='no_show'`、それ以外の 3 つは `status='cancelled'`。
どちらの場合も `cancelled_at` にサーバ時刻を入れる。受付履歴の「結果」には
「成立 / 取消 / ご来店なし」の 3 語を出す。

**確定・変更・取消の `db.batch()` に入れるもの**（1 つでも欠けると窓が空く）:

| 操作 | 同じ batch に入れる文 |
|---|---|
| 確定 | `reservations` INSERT ／ `reservation_purposes` INSERT ／ `reservation_assignments` INSERT ／ **`reservation_slot_locks` INSERT**（刻み単位） ／ `audit_events` INSERT ／ `idempotency_records` を `done` に |
| 変更 | **`reservation_slot_locks` の INSERT（新しい枠）** ／ `reservation_purposes` 置き換え ／ `reservation_assignments` 置き換え ／ `audit_events` INSERT ／ **`reservation_slot_locks` の DELETE（古い枠）** ／ 最後に `reservations` UPDATE（`version` 条件・`version` を +1）。**この順序を変えない**（下） |
| 取消 | `reservations` UPDATE（`status` / `cancelled_at` / `cancel_reason`） ／ **`reservation_slot_locks` DELETE** ／ `audit_events` INSERT |

**版の条件と枠の条件はバッチの全文に配り、版を +1 する文を最後に置く**（`03-data-model.md` §7.1 / §7.6）。
0 行の `UPDATE` はバッチを止めない（D1 の実測）ので、版の条件を `reservations` の 1 文だけに付けると、
版が合わないのに割当と占有行だけが相手の内容に書き換わったまま commit され、**409 を返しながら二重予約を作る**。
具体的には次の 4 つを守る:

1. `reservation_slot_locks` の INSERT は**上限つきの条件付き INSERT**（`INSERT ... SELECT ... WHERE NOT EXISTS (…)`）にし、
   1 行も入らなかったら（`meta.changes === 0`）409 `slot_taken` を返して `alternatives` に代わりの枠を 3 件まで載せる。
2. 予約本体・目的・割当・監査の各文に、版のガード
   `AND EXISTS (SELECT 1 FROM reservations WHERE id=?R AND version=?V)` と枠のガード
   `AND (SELECT COUNT(*) FROM reservation_slot_locks WHERE reservation_id=?R AND created_at=?T) = ?N` を足す。
3. 変更は「新しい枠を取ってから古い枠を返す」順にする（先に DELETE すると、枠が取れずに 409 を返す経路で古い枠だけが空く）。
   取消の `reservation_slot_locks` DELETE にも版のガードを付ける（付けないと 409 のときに枠だけが解放される）。
4. 最後に置いた `UPDATE reservations SET ..., version = version + 1 WHERE id=?R AND version=?V` の
   `meta.changes === 0` を 409 の合図にし、**版と枠のどちらで落ちたかはバッチ後の 1 本の `SELECT version` で見分ける**
   （何も書けていないので読み直して差し支えない。`VersionConflictError.current` もこの読み直しで作る）。

テストは「409 が返る」で止めず、**版が合わないとき・枠が取れないときに 1 行も書き換わっていない**ことまで確かめる。
（`?R` / `?V` / `?T` / `?N` は予約 ID・送られてきた版・バッチの時刻・要求する枠の本数を指す説明用の記号で、
実装では番号付きのプレースホルダにする。SQL の実物は `03-data-model.md` §7.6。）
**EX-CONFLICT で版の競合を解いたあとも、送る前に `GET /api/staff/availability` で当て直す。**
版の競合（`version_conflict`）を解いた結果が枠の競合に当たることは普通に起きる
（相手が保存してから自分が選ぶまでの数分で埋まる）。「1 項目ずつ選ぶ」で相手の日時と自分の担当を混ぜた組み合わせは
どちらの端末も検証していないので、なおさら当て直しが要る。

**`GET /api/staff/ledger` の応答は D1 を 16 文以内に収める。**必要なのは
`store_business_hours` / `store_calendar_exceptions` / `store_blackout_windows` / `store_slot_rules` /
`staff` / `staff_shifts` / `equipment` / `equipment_maintenance` / `reservations` / `reservation_assignments` /
`reservation_purposes` / `visit_purposes` / `customers` / `walk_ins` / `visit_events` / `web_bookings` の
**14〜16 文**で、これを 1 回の `db.batch()` にまとめる（`db.batch()` に 200 文入ることは実測済みなので、
文の数そのものは制約にならない）。`07-nfr.md` §4.1 の「D1 クエリ 10 本以内」はこの面では 16 本と読む。

**`GET /api/staff/ledger` の `axis` と `view` は別の指定である。1 つの enum にまとめない。**
LEDGER-LIST のヘッダーには**セグメントが 2 つ**ある（`aria-label="台帳の並べ方"` = 担当者／設備・場所、
`aria-label="表示のかたち"` = タイムテーブル／予約リスト）。

| `axis` | 行 | 画面 |
|---|---|---|
| `staff` | 担当者 + 「担当が未定」の擬似行 + 「ご来店お待ち」（ウォークイン）の帯 | LEDGER-STAFF／LEDGER-WALKIN |
| `resource` | 設備・場所（1 予約が複数行に同時に現れる） | LEDGER-RESOURCE |

**軸の値は `resource` であって `equipment` ではない。**`05-screen-flow.md` §3 の 13 個のクエリ表・遷移図・
画像対応表がすべて `axis=resource` で書かれており、URL のクエリにそのまま乗る文字列だからである
（`LedgerLane.kind` / `AvailabilityLane.kind` の `equipment` は応答の中の語で、別の語彙である）。

| `view` | 描き方 | 画面 |
|---|---|---|
| `timetable` | `slotMinutes` 刻みの時間グリッドに帯を置く（`lanes` を使う） | LEDGER-STAFF／LEDGER-RESOURCE／LEDGER-WALKIN |
| `list` | 時刻順のフラットな行（`entries` を時刻順に平坦化して使う） | LEDGER-LIST／EX-OFFLINE |

`view='list'` のときも `axis` は保持し、タイムテーブルへ戻ったときに同じ軸へ復帰する。
`axis` と `view` の 4 通りすべてが有効な組み合わせである。

応答に `serverNow`（ISO8601）を必ず含める。現在時刻線（LEDGER-STAFF の 11:08）と
EX-OFFLINE の「いまご覧の内容は 11:02 現在 のものです。」は端末時計ではなくこの値から描く。

### 3.7 staff — ウォークインと来店（7 本）

| メソッド | パス | 認証 | 入力 | 出力 | 主なエラー | 使う画面 |
|---|---|---|---|---|---|---|
| POST | `/api/staff/walkins` | JWT | `WalkinCreate` + `Idempotency-Key` | `Walkin` | 409 `idempotency_conflict` | LEDGER-WALKIN「受付して台帳に載せる」 |
| GET | `/api/staff/walkins` | JWT | query `WalkinListQuery` | `Walkin[]` | — | LEDGER-STAFF「ご来店お待ち 2名」／LEDGER-WALKIN「いまお待ち 2名」 |
| PATCH | `/api/staff/walkins/:walkinId` | JWT | `WalkinPatch` | `Walkin` | 409 `version_conflict` | LEDGER-LIST「ご案内」（担当を決める・顧客を紐づける） |
| POST | `/api/staff/visits` | JWT | `VisitEventInput` | `VisitEvent` | 404 `not_found` | RECEPTION-JOURNEY の工程を進める |
| GET | `/api/staff/visits/board` | JWT | query `VisitBoardQuery` | `VisitBoard` | — | RECEPTION-JOURNEY（ご来店中 4名） |
| GET | `/api/staff/reception-sessions` | JWT | query `ReceptionHistoryQuery` | `ReceptionHistoryList` | — | HISTORY-LIST（46件・絞り込み）／HISTORY-EMPTY |
| GET | `/api/staff/reception-sessions/:sessionId` | JWT | param | `ReceptionHistoryDetail` | 404 `not_found` | HISTORY-LIST 右（経緯 + 録音） |

- `walk_ins.ticket_no` はサーバが採番する（店舗 × 日ごとの連番。表示は 3 桁ゼロ詰め = 「ウォークイン 004」）。
  クライアントから採番値を受け取らない。LEDGER-WALKIN が受付前に「ウォークイン 005」と**次の番号を予告する**ため、
  `LedgerView.nextTicketNo` で先に返す（予告した番号と採番結果がずれたら採番結果を正とする）。
- LEDGER-WALKIN の「目安 15分」は**空き枠エンジンの結果から**毎回導出する（`LedgerView.estimatedWaitMinutes`。§4.0 (a)）。
  待ち人数だけで決めない。ANALYTICS-WAIT の「目安 8分」（`AnalyticsTargets.waitMinutes`）とは**別の数**である。取り違えない。
- **ウォークインの受付は `source='walkin'` の予約を 1 件起こす**（`03-data-model.md` §7.4）。
  `walk_ins` だけを作ると、LEDGER-WALKIN が台帳に点線で描く「ここに入ります 11:30–12:30」の枠が
  空き枠エンジンから見て空いたままになり、同じ瞬間に電話予約が同じ担当を取れてしまう。
  `WalkinCreate` が `staffId` / `startsAt` / `durationMinutes` を受けるのはこのためである。
- `GET /api/staff/reception-sessions` は 0 件のとき **`relaxations`（条件を 1 つ緩めたときの件数）を必ず添える**。
  HISTORY-EMPTY が「期間を「今月（8月1日 〜 8月27日）」まで広げる → 12件」「担当の「佐藤 美咲」を外す → 7件」を
  0 件の応答と同時に表示するため、**追加の往復を発生させない**。
- **RECEPTION-JOURNEY の 6 列と `visit_events.stage` の対応は `03-data-model.md` §7.5 の表が正。**
  決定ブリーフ §3.3 の 7 値に **`handover`（お渡し）を足して 8 値**にする。`fitting` が「フレーム選び」、
  `handover` が「お渡し」、`left` は列を持たない「退店」である。`left` を「お渡し」に当てると、
  「お渡し　対応中」の伊藤 健 様が「ご来店中 4名」から外れて画面が成り立たない。
  `waiting` も列を持たず、セルの中の「お待たせ中 18分」として出る（閾値 15 分）。
- **工程を進める操作は担当以外のスタッフもできる**（受付は手の空いた人がやる）。進めた人は `staff_id` に残す。
- **退店（`stage='left'`）を記録する操作をこの面に含める**（`POST /api/staff/visits` に `stage='left'` を送る）。
  これが無いと閉店時に盤面から人が降りず、`customers.visit_count` の書き戻しも走らない。

### 3.8 staff — 顧客（11 本）

| メソッド | パス | 認証 | 入力 | 出力 | 主なエラー | 使う画面 |
|---|---|---|---|---|---|---|
| GET | `/api/staff/customers` | JWT | query `CustomerSearchQuery` | `CustomerList` | — | CUSTOMER-LIST（42名・「ほか 34名」） |
| GET | `/api/staff/customers/lookup` | JWT | query `CustomerLookupQuery` | `CustomerCandidate[]` | — | BOOK-04b-CUSTOMER-MATCH「同じ番号のご来店が2件見つかりました。」／CUSTOMER-NEW の重複警告／LEDGER-WALKIN「電話番号で探す（下4桁でも探せます）」 |
| GET | `/api/staff/customers/:customerId` | JWT | param | `CustomerDetail` | 404 `not_found` | CUSTOMER-DETAIL／RECEPTION-CHECKIN 右 |
| POST | `/api/staff/customers` | JWT | `CustomerCreate` | `CustomerDetail` | — | CUSTOMER-NEW「登録してご予約に進む」／BOOK-04-CUSTOMER「初めてのお客様として登録する」 |
| PATCH | `/api/staff/customers/:customerId` | JWT | `CustomerPatch`（`version` 必須） | `CustomerDetail` | 409 `version_conflict` | CUSTOMER-DETAIL「内容を直す」 |
| POST | `/api/staff/customers/merge/preview` | JWT | `CustomerMergePreviewRequest` | `CustomerMergePreview` | 404 `not_found` | CUSTOMER-MERGE の見比べ表と「まとめると、こうなります」 |
| POST | `/api/staff/customers/merge` | JWT+本人 | `CustomerMergeInput` + `Idempotency-Key` | `CustomerMergeResult` | 409 `version_conflict` / 409 `idempotency_conflict` | CUSTOMER-MERGE「この内容でまとめる」 |
| GET | `/api/staff/customers/:customerId/notes` | JWT | query `CustomerNoteQuery` | `CustomerNote[]` | 404 `not_found` | CUSTOMER-HANDWRITE 左（手書きメモ 3枚）／CUSTOMER-DETAIL 右（注意ごと） |
| POST | `/api/staff/customers/:customerId/notes` | JWT | `CustomerNoteInput` | `CustomerNote` | — | BOOK-04d-HANDWRITE「手書きのまま残す」／CUSTOMER-HANDWRITE「文字を保存する」 |
| PATCH | `/api/staff/customers/:customerId/notes/:noteId` | JWT | `CustomerNotePatch`（`revision` 必須） | `CustomerNote` | 409 `version_conflict` | CUSTOMER-HANDWRITE の読み取り文字の修正 |
| POST | `/api/staff/customers/:customerId/notes/:noteId/publish` | JWT+本人 | `CustomerNotePublishInput` | `CustomerNote` | 409 `version_conflict` | CUSTOMER-HANDWRITE「注意ごととして登録を申し込む」 |

- `GET /api/staff/customers/lookup` のクエリは `phone`（下 4 桁でも可・数字のみに正規化して `phone_normalized` の
  後方一致）または `name` / `kana`。**一致の確からしさ**を `match: 'strong' | 'weak'` で返す
  （BOOK-04b-CUSTOMER-MATCH が「よく一致しています」「確かめが必要です」の 2 段で出し分けるため）。
- **注意事項（`kind='attention'`）は自動で作らない。** CUSTOMER-HANDWRITE の「注意ごととして登録を申し込む」
  =「申し込み制」に従い、`POST .../publish` を通ったものだけが `status='published'` になる。
- `handwriting_svg` はサーバで受け取ってそのまま保存する。**SVG は再生時に `<script>` / `on*` 属性 /
  `<foreignObject>` を除いた許可リストで再直列化してから返す**（他店舗のスタッフが開くため）。

### 3.9 staff — 録音（9 本）

| メソッド | パス | 認証 | 入力 | 出力 | 主なエラー | 使う画面 |
|---|---|---|---|---|---|---|
| POST | `/api/staff/recordings` | JWT | `RecordingCreate` | `Recording` | 404 `not_found` | 受付の録音開始（`.rec`「録音中 01:08」）。BOOK-01-DATETIME〜BOOK-05-CONFIRM／BOOK-CONFLICT／CHANGE-DATETIME／CHANGE-DIFF／CUSTOMER-NEW の 15 画面に録音の印が出る |
| PUT | `/api/staff/recordings/:recordingId/content` | JWT | `Content-Type: audio/*` の生 body | `Recording` | 413 `payload_too_large` | 録音の本体アップロード（Worker が R2 へ書く） |
| PATCH | `/api/staff/recordings/:recordingId` | JWT | `RecordingStatePatch` | `Recording` | 409 `invalid_transition` | 状態更新（`recording`→`uploading`→`stored` / `failed`） |
| POST | `/api/staff/recordings/:recordingId/retry` | JWT | — | `Recording` | 409 `invalid_transition` | ALERTS「もう一度送る」／EX-UPLOAD-FAILED「もう一度送る」 |
| GET | `/api/staff/recordings` | JWT | query `RecordingListQuery` | `RecordingList` | — | ALERTS の失敗一覧 |
| POST | `/api/staff/recordings/:recordingId/playback` | JWT+本人 | — | `RecordingPlaybackTicket` | 404 `not_found` | LEDGER-DETAIL「録音を聞く」／CHANGE-SEARCH「録音を聞く」／HISTORY-LIST「再生する」 |
| POST | `/api/staff/recordings/:recordingId/hold` | JWT+本人 | `RecordingHoldInput` | `Recording` | 404 `not_found` | 保全（MODE-PERSONAL「録音の保全にはご本人の確認が必要です」） |
| DELETE | `/api/staff/recordings/:recordingId` | JWT+店長+本人 | param | `DeletedResult` | 409 `recording_retained` | 削除。最低保持期間内は拒否 |
| GET | `/api/staff/recordings/:recordingId/stream` | JWT+本人 | param + query `token` | `audio/*` の生 body（**JSON ではない**） | 404 `not_found` / 401 `unauthorized` | 再生の 2 段目。`POST .../playback` のチケットとセットで使う（下） |

**R2 の扱い**:

| 決め | 内容 |
|---|---|
| ダウンロード URL を出さない | R2 のバケットは非公開。署名付き R2 URL をクライアントへ渡さない。 |
| 再生は 2 段 | ① `POST .../playback` が**この Worker 宛の短命チケット**を返す（`token` + `expiresAt`。KV `SHORT_LIVED` に **TTL 900 秒**で置く。300 秒だと最長 6分12秒の録音を 1 回聞き通せない）② `GET /api/staff/recordings/:recordingId/stream?token=...` が R2 から読んで `audio/*` をそのまま返す。トークンは 1 回の再生セッション分・同一 org・同一録音でだけ有効。 |
| 保持期限 | 成立予約（`reservations.status` が `cancelled` / `no_show` 以外）は**録音完了から最低 30 日**、破棄受付（`reception_sessions.outcome='discarded'`）は**録音終了から最低 24 時間**。`retain_until` に入れる。 |
| 削除の拒否 | `now < retain_until` または `legal_hold='1'` のとき **409 `recording_retained`**（応答に `retainUntil` を含める）。 |
| 失敗の扱い | `upload_attempts` が 3 に達したら `alerts` に `recording.upload_failed`（`severity='action'`）を 1 件立てる（ALERTS「録音の保存に3回失敗しました」）。予約は**必ず残す**（EX-UPLOAD-FAILED「ご予約は確定しています」）。 |

`GET /api/staff/recordings/:recordingId/stream` は RPC ルートに含めるが、応答が JSON ではないため
契約 `parse` の対象外にする（唯一の例外。理由をコードのコメントに残す）。

**この URL を `<audio src="...">` に直接入れてはならない。** `/api/staff/*` は §2 の default-deny ゲートの内側にあり、
`<audio>` の発行するリクエストには `Authorization: Bearer` が付かないので必ず 401 になる。再生の手順は次に固定する:

1. `POST .../playback` でチケット（`token` / `expiresAt`）を得る。
2. `fetch('/api/staff/recordings/<id>/stream?token=<token>', { headers: { Authorization: 'Bearer <access token>' } })`
   で取得し、`await res.blob()` → `URL.createObjectURL(blob)` を `<audio src>` に入れる。
3. 再生を終えたら `URL.revokeObjectURL()` する。`token` は 1 回の再生セッション分・同一 org・同一録音でだけ有効。

`token` は Authorization ヘッダーの**代わりではなく上乗せ**である（ヘッダーだけでは他店舗の録音まで開けてしまうため）。

### 3.10 staff — 端末・再認証・監査・お知らせ・分析（12 本）

| メソッド | パス | 認証 | 入力 | 出力 | 主なエラー | 使う画面 |
|---|---|---|---|---|---|---|
| GET | `/api/staff/terminals` | JWT | query `TerminalListQuery` | `Terminal[]` | — | LOGIN-SHARED（置き場所 3 件・状態） |
| POST | `/api/staff/terminals` | JWT+店長+本人 | `TerminalInput` | `Terminal` | — | 設定サイドバー「端末とスタッフ › 端末の登録」（項目は SETTINGS-STORE などのサイドバーに描かれているが専用画面のモックは無い） |
| PATCH | `/api/staff/terminals/:terminalId` | JWT+店長+本人 | `TerminalPatch` | `Terminal` | 409 `version_conflict` | 設定サイドバー「端末とスタッフ › PINと自動ロック」（同上） |
| POST | `/api/staff/terminals/:terminalId/sessions` | JWT | `TerminalSessionStart` | `TerminalSession` | 401 `pin_invalid` / 429 `pin_locked` | LOGIN-SHARED-PIN「この置き場所で始める」／LOGIN-STAFF-PIN「確定」／LOGIN-PIN-ERROR |
| DELETE | `/api/staff/terminals/:terminalId/sessions/:sessionId` | JWT | param | `DeletedResult` | 404 `not_found` | 「業務を終える」 |
| POST | `/api/staff/terminals/:terminalId/elevate` | JWT | `ReauthInput` | `TerminalSession` | 401 `pin_invalid` / 429 `pin_locked` | MODE-PERSONAL「確定」／EX-PERMISSION 右「店長の暗証番号で続ける」。昇格の対象が**端末セッション**であることを名前に出す |
| GET | `/api/staff/audit` | JWT+店長（`audit.read`） | query `AuditSearchQuery` | `AuditEventList` | — | CHANGE-DONE の脚注「この操作は受付履歴に残ります（銀座店 レジ横iPad・11:12　操作者 中村 彩）。」の裏づけ |
| GET | `/api/staff/alerts` | JWT | query `AlertListQuery` | `AlertList` | — | ALERTS／サイドバーの「お知らせ 3」バッジ |
| PATCH | `/api/staff/alerts/:alertId` | JWT | `AlertPatch` | `Alert` | 404 `not_found` | ALERTS の 1 件を既読・対応済みにする |
| POST | `/api/staff/alerts/read-all` | JWT | `AlertReadAllInput` | `AlertReadAllResult` | — | ALERTS「すべて既読にする」 |
| GET | `/api/staff/analytics` | JWT | query `AnalyticsQuery` | `AnalyticsReport` | — | ANALYTICS-TOP／COUNT／STAFF／WAIT／CANCEL |
| GET | `/api/staff/analytics/targets` | JWT | query `StoreIdQuery` | `AnalyticsTargets` | — | ANALYTICS-WAIT「目安 8分」／ANALYTICS-CANCEL「目安 10%以内」／ANALYTICS-STAFF「90日以内の再来」 |

**PIN の扱い**:

| 決め | 値 | 根拠 |
|---|---|---|
| 桁数 | 4〜6 桁の数字のみ | LOGIN-STAFF-PIN「4〜6桁の暗証番号を入力してください」 |
| 連続失敗 | 3 回で 30 秒ロック。応答は 429 `pin_locked` + `retryAfterSeconds: 30` | LOGIN-PIN-ERROR「あと2回お試しいただけます」「3回続くと、30秒お待ちいただきます。」 |
| 失敗回数の置き場 | KV `SHORT_LIVED`。キーは `pin:<organizationId>:<terminalId>:<staffId ?? 'shared'>`、TTL 30 秒 | KV は 1,000 write/日。失敗時にだけ書く |
| ハッシュ | `terminals.pin_hash` / スタッフ個人 PIN も同方式。**平文 PIN を D1・ログ・応答に出さない** | — |
| 個人モードの寿命 | `terminal_sessions.expires_at` = 開始から 120 秒（無操作で共有へ戻る） | START-DEVICE-MODE「2分間さわらないと自動で隠す」／MODE-PERSONAL「確かめたあとも2分さわらなければ共有に戻る」 |

設定サイドバーには API を割り当てていない項目が 4 つ残る（「顧客台帳 › 項目」「顧客台帳 › 注意ごと」
「全般 › 通知・印刷」「全般 › キャンセル」）。専用画面のモックが無く、扱う対象も描かれていない。
**この 4 項目は行ごと出さない。**モック README の「空いた場所を埋めるために要素を足さない」に従い、
押しても何も出ない行を作らない（分析の 3 タブは逆に**作る** — タブが 8 つ描かれていて、押して何も出ないのは壊れて見えるため）。
第 2 サイドバーの「キャンセル」という語は、実装するときに **「取り消しのきまり」** に改める
（本文の「キャンセル」ボタンは編集の破棄を指しており、同じ画面で 2 つの意味を持たせない）。

**分析の指標定義**（`AnalyticsQuery` の enum）:

| クエリ | 値 | 根拠 |
|---|---|---|
| `metric` | `reservation_count` / `reservation_source` / `cancellation` / `visit_frequency` / `staff` / `purpose` / `wait_time` | ANALYTICS の 8 タブ（トップは複数 metric の束ね） |
| `granularity` | `day` / `month` / `hour` / `weekday` | ANALYTICS-COUNT「集計の種類　日別 / 月別 / 時間帯別 / 曜日別」 |
| `countBy` | `visit_date` / `received_date` | ANALYTICS-COUNT「かぞえる日　ご来店日 / 受付日」 |
| 期間 | `from` / `to`（`YYYY-MM-DD`。単月は同月の 1 日と末日を入れる） | ANALYTICS-CANCEL だけが 2026年3月 − 2026年8月 のレンジ |

`GET /api/staff/analytics/targets` が返す目安値（モックの表示値をそのまま正とする）:
待ち時間 8 分 / 取消率 10% / 再来判定 90 日。
**この 3 つは全店共通の固定値とし、店舗ごとに設定できるようにしない。**設定の第 2 サイドバー 15 項目
（SETTINGS-* 7 面に共通）に目安を編集する行が 1 つも無く、ANALYTICS-WAIT / ANALYTICS-CANCEL も
目安を読み取り専用の破線と札としてだけ出しているためである。置き場のテーブルも作らない。

### 3.11 staff — Web 予約の公開設定と承認（4 本）

| メソッド | パス | 認証 | 入力 | 出力 | 主なエラー | 使う画面 |
|---|---|---|---|---|---|---|
| GET | `/api/staff/web-booking-settings/:storeId` | JWT | param `StoreIdParam` | `WebBookingSettings` | 404 `not_found` | SETTINGS-WEB 左 |
| PUT | `/api/staff/web-booking-settings/:storeId` | JWT+店長+本人 | `WebBookingSettingsInput`（`version` 必須） | `WebBookingSettings` | 409 `version_conflict` | SETTINGS-WEB「保存」 |
| GET | `/api/staff/web-booking-settings/:storeId/preview` | JWT | query `WebPreviewQuery` | `WebPreviewResult` | 404 `not_found` | SETTINGS-WEB 右「お客様の画面の見え方」 |
| POST | `/api/staff/web-bookings/:webBookingId/review` | JWT+店長+本人 | `WebBookingReviewInput` | `ReservationDetail` | 409 `invalid_transition` / 404 `not_found` | ALERTS「Web予約が2件、確認待ちです」→ LEDGER-LIST「内容を確認」 |

`GET` / `PUT` / `preview` の 3 本はすべて `storeId` を**パスで**受ける（クエリと混ぜない）。

`preview` は**未保存の値をクエリで受け取れる**（`purposeIds` / `message`）。
保存前に「社内の言葉が漏れていないか」をその場で確かめる面のため、保存を伴わない。

`review` は `web_bookings.status='pending'`（`requires_approval='1'` で作られた予約）だけを受ける。
`decision='approve'` で `web_bookings.status='confirmed'` と `reservations.status='confirmed'` を
`db.batch()` で同時に書き、§7.1 の `reservation.confirmed` を送る。`decision='reject'` は
`reservations.status='cancelled'` + `cancel_reason='store'` にする。`pending` 以外に叩くと 409 `invalid_transition`。
放置された `pending` は `POST /api/internal/maintenance/web-publications/apply` が
**受信日（`web_bookings.created_at` の JST 暦日）の 24:00 JST** を境に自動で取り消す
（ALERTS「本日中に確認しないと自動で取り消されます。」）。**起算日は受信日であって来店日ではない**
（来店日起算にすると 3 週間先の予約が `pending` のまま ALERTS に居座り、この文言が嘘になる。
`02-domain-model.md` §3 の W4 / `03-data-model.md` §11.2 と揃える）。

### 3.12 public — お客様向け Web 予約（未認証。10 本）

| メソッド | パス | 認証 | 入力 | 出力 | 主なエラー | 使う画面 |
|---|---|---|---|---|---|---|
| GET | `/api/public/stores` | none | query `PublicStoreSearchQuery` | `PublicStoreSummary[]` | — | WEB-01-STORE（近い順に 3 店舗） |
| GET | `/api/public/stores/:storeSlug` | none | param `StoreSlugParam` | `PublicStoreDetail` | 404 `not_found` / 404 `not_published` | WEB-01-STORE〜WEB-06-DONE のヘッダー（店名・道順） |
| GET | `/api/public/stores/:storeSlug/purposes` | none | param | `PublicStorePurpose[]` | 404 `not_found` / 404 `not_published` | WEB-02-PURPOSE |
| GET | `/api/public/stores/:storeSlug/availability` | none | query `PublicAvailabilityQuery` | `PublicAvailabilityResponse` | 404 `not_published` / 409 `purpose_unavailable` | WEB-03-DATETIME（週の空き・「満」「定休」） |
| POST | `/api/public/stores/:storeSlug/bookings` | none | `PublicBookingCreate` + `Idempotency-Key` | `PublicBookingResult` | 409 `slot_taken` / 409 `store_closed` / 409 `idempotency_conflict` / 404 `not_published` | WEB-05-CONFIRM「この内容で予約する」→ WEB-06-DONE |
| POST | `/api/public/reservations/verify` | none | `PublicReservationVerification` | `PublicReservationVerificationResult` | 401 `invalid_management_code` | WEB-CANCEL の本人確認（2 手順のうち 1 つ目） |
| GET | `/api/public/reservations/:code` | none | param + header `X-Management-Code` | `PublicReservationStatus` | 401 `invalid_management_code` / 404 `not_found` | WEB-CANCEL の明細 |
| GET | `/api/public/reservations/:code/availability` | none | param + header + query | `PublicAvailabilityResponse` | 401 `invalid_management_code` | WEB-CANCEL「日時を変更する」の候補 |
| PATCH | `/api/public/reservations/:code` | none | `PublicReservationChange` + header + `Idempotency-Key` | `PublicReservationChangeResult` | 401 `invalid_management_code` / 409 `slot_taken` / 409 `change_deadline_passed` | WEB-CANCEL「日時を変更する」 |
| POST | `/api/public/reservations/:code/cancel` | none | `PublicReservationCancel` + header + `Idempotency-Key` | `PublicReservationMutationResult` | 401 `invalid_management_code` / 409 `change_deadline_passed` | WEB-CANCEL「この予約を取り消す」 |

**public 面の決め**:

| 決め | 内容 | 根拠 |
|---|---|---|
| org は slug から解決する | `stores.slug` → `organization_id`。**リクエストの body / query の organizationId を認可根拠にしない** | 決定ブリーフ §6・ルール 6 |
| 公開していない店舗は 404 | `web_booking_settings.is_published='0'` のとき `{ error: 'not_published' }` を **404** で返す（`not_found` と同じ status に揃え、slug の存在有無を外から区別させない） | — |
| 管理コードはヘッダーで受ける | `X-Management-Code`。URL・クエリに載せない（ブラウザ履歴・アクセスログに残るため）。D1 には `management_code_hash` だけを持つ | 決定ブリーフ §3.7 |
| 承認要否 | `web_booking_settings.requires_approval='1'` のとき `web_bookings.status='pending'` で作り、`reservations.status='confirmed'` にはしない。応答の `status` に `pending` を入れる | SETTINGS-WEB「ご予約の確定　お店が確かめてから確定する」／ALERTS「Web予約が2件、確認待ちです」 |
| 変更・取消の期限 | 来店日の **`web_booking_settings.change_deadline_days`（既定 1）日前の 23:59:59.999 JST** を過ぎたら 409 `change_deadline_passed`（既定のままなら「前日 23:59 JST を過ぎたら」と同じ） | WEB-CANCEL「変更・取り消しは前日までにお願いいたします。」／`03-data-model.md` §11.1 |
| 受付の窓 | `web_booking_settings.opens_at` / `closes_at`（例 10:30–18:00）と `accept_until_days`（例 30 日先まで）で枠をさらに絞る | SETTINGS-WEB |

**公開対象の判定は `visit_purposes.is_web_published='1'`（かつ `is_active='1'`）単独で行う。公開は 5 件。**
SETTINGS-PURPOSE の Web 予約列が「公開しています」×5 /「お店で受けるだけ」×1（修理・部品交換）で、
SETTINGS-WEB の「公開する目的　5件」と一致する。同画面プレビューの 4 件と WEB-02-PURPOSE の 6 件は
どちらもモックの描き漏れであり（README の行上限は 8 なので省略ではない）、判定に条件を足す根拠にしない。

`[要確認: Q-01 — いまの前提で進める]`（`design/09-open-questions.md`）。いまの前提: 完了画面の見出しを「ご予約を承りました」にし、「お店で確認のうえ、本日中にご連絡いたします。確定までお席の確保はできておりません。」を出す。確定後に「ご予約が確定しました」のメールを送る。店舗が日時を変えたときは §7.1 の `reservation.confirmed` を新しい `startsAt` で送り直す（型を足さずに賄える）。**取消のメールは送らない**（`notification.ts` に取消の `type` が無く、足すのは人間の承認事項。§7.1）。店舗が取り消したときはお電話で連絡する運用にする。

**合計 100 ルート**（health 1 / dev token 1 / internal 5 / staff 83 / public 10）。
staff 83 の内訳は §3.3〜§3.11 の表そのもの（24 + 5 + 1 + 10 + 7 + 11 + 9 + 12 + 4）で、
`GET /api/staff/recordings/:recordingId/stream` も §3.9 の表に含めた（**エンドポイント一覧は全量である**）。
RPC チェーンに載るのは `POST /api/auth/token` を除く 99 本。

---

## 4. Zod スキーマ名の一覧

すべて `packages/contracts/src/glasses_management.ts` に PascalCase で定義し、
`export type X = z.infer<typeof X>` を同名で export する。`index.ts` から re-export する。

### 4.0 決定ブリーフ §3 に列が無いフィールドの扱い

§4 のスキーマには、決定ブリーフ §3 のテーブル定義に**列が無い**フィールドが含まれる。
実装者が黙って列を足さないよう、扱いを 2 つに分ける。**決定ブリーフ §3 の表はこの文書からは変えない。**

**(a) 保存しない ＝ サーバが毎回導出する**（列を足さない）

| フィールド | 導出のしかた |
|---|---|
| `Terminal.hasPin` / `StaffMember.hasPin` | `pin_hash` が非 NULL か |
| `Terminal.isOnline` | `serverNow - terminals.last_seen_at` がしきい値を超えたか（LOGIN-SHARED「つながっていません」）。**状態を列に持たない**。`lastSeenAt` そのものは `terminals.last_seen_at` に保存する |
| `Walkin.waitedMinutes` | `serverNow - walk_ins.arrived_at` を分へ切り捨て（LEDGER-STAFF「お待ち 6分」） |
| `LedgerView.estimatedWaitMinutes` | **空き枠エンジンの結果から出す** —「選んだご用件を受けられる担当が次に空く時刻 − `serverNow`」を分に切り上げ（LEDGER-WALKIN「目安 15分」）。待ち人数だけで決めない（空いている担当が 3 人いても待ちが 2 名なら同じ数字を出してしまい、モックの「いまお待ち 2名／目安 15分」も再現できない。最短のご用件でも 20 分なので、件数 × 平均接客分数では 15 分にならない）。数えるウォークインは `visit_date = 本日（JST）` かつ `status='waiting'` に限る |
| `LedgerView.nextTicketNo` | その店舗・その日の `ticket_no` の最大値 + 1（LEDGER-WALKIN「ウォークイン 005」） |
| `WebBookingSettings.landingPath` | 公開ドメイン（`wrangler.jsonc` の `vars`）+ `stores.slug`（SETTINGS-WEB「eyex.jp/ginza」） |
| `WebBookingSettings.publishedPurposeIds` | `visit_purposes.is_web_published='1'` かつ `is_active='1'` の行（銀座店は 5 件） |
| `SlotRulesView.lastAcceptableAt` | **空き枠エンジンがその曜日に返す枠のうち、最後の枠の開始時刻**（SETTINGS-HOURS「木曜日に最後にお受けできるのは 18:20 です。」）。式で算出しない — 式で出すと 30 分の格子に載らない時刻を案内して「押せる枠が無い時刻」を読ませてしまう |
| `StaffMember.skills` | `staff_skills` の行を `skill_code` の配列にしたもの |
| `VisitPurpose.requirements` | `purpose_requirements` の行 |
| `ReservationSummary.purposeLabel` / `LedgerEntry.purposeLabel` | `reservation_purposes` を `sort_order` 順に並べ、**`visit_purposes.name_short` を `・` でつなぐ**（LEDGER-STAFF の帯「新調相談・視力測定」）。詳細・復唱・受付の面に出す `purposeLabelInternal` は同じ並びで `name_internal` をつなぐ。お客様の面は `name_public` を使う（`03-data-model.md` §6.1 の使い分け表） |
| `CustomerNote.authorName` | `author_id` → `staff.display_name` |
| `ReceptionHistoryDetail.receivedBy` | `reception_sessions.actor_id` → `staff.display_name` |

**(b) 列が足りない**（`03-data-model.md` が足すか、機能を落とすかを決める）

| スキーマ.フィールド | 必要な列 | モックの根拠 |
|---|---|---|
| `StoreDetail.namePublic` | `stores.name_public` | SETTINGS-STORE「お客様に見せる店名　EYEX 銀座店（銀座4丁目）」 |
| `StoreDetail.introText` | `stores.intro_text` | SETTINGS-STORE「お客様に見せる紹介文　78文字／200文字まで」 |
| `StoreDetail.accessNote` の 3 分割 | `stores.access_note` 1 列では足りない | SETTINGS-STORE の「最寄り駅」「出口と所要時間」「駐車場」の 3 行 |
| 楽観ロックの `version` | `stores` / `store_business_hours` / `staff` / `staff_shifts` / `equipment` / `walk_ins` / `terminals` に `version` | 各設定画面の「保存」と EX-CONFLICT。決定ブリーフ §3 で `version` を持つのは `store_slot_rules` / `visit_purposes` / `reservations` / `customers` / `web_booking_settings` だけ |
| `StaffMember.role` | `staff.role`（`'staff'`／`'manager'`） | SETTINGS-STAFF「できる役割　スタッフ（設定は見るだけ）」 |
| `StaffMember.maxParallelReservations` | `staff.max_parallel_reservations` | SETTINGS-STAFF「同時に受け持てるご予約　1件まで」 |
| `Equipment.inactiveReason` | `equipment.inactive_reason` | SETTINGS-EQUIPMENT「定期点検（メーカー来店）」「部品待ちで止めています」 |
| `CustomerDetail.address` / `CustomerMergeField.field='address'` | `customers.address` | CUSTOMER-MERGE「ご住所　東京都中央区銀座 4-◯-◯」 |
| `CustomerMergePreview.losingCustomerNumber` | `customers.customer_number` | CUSTOMER-MERGE「お客様番号 G-02310 は使えなくなります。」 |
| `VisitPurpose.nameShort` | `visit_purposes.name_short` | 台帳・一覧が `name_internal` と違う短い名前を出す（LEDGER-STAFF「新調相談」）。**`03-data-model.md` §6.1 が列を足した**（1〜5 文字・NOT NULL） |
| `StoreMembership.permissions` の保存先 | `store_memberships`（`03-data-model.md` §3.2） | admin が `permissions` を配る |

**上表 (b) の列はすべて `03-data-model.md` が足した**（`＋` 印の列）。決定ブリーフ §3 の表そのものはこの文書からも変えない。
対応は次のとおりで、フィールド名の綴りは **`03-data-model.md` の列名を正**とする。

| §4.0 (b) の項目 | `03-data-model.md` での決着 |
|---|---|
| `StoreDetail.namePublic` | `stores.name_public`（§4.1）。**フィールド名も `namePublic` にする**（`publicName` という別名を作らない） |
| `StoreDetail.introText` | `stores.intro_text`（§4.1）。**フィールド名も `introText` にする**（`intro` という別名を作らない） |
| `StoreDetail.accessNote` の 3 分割 | `stores.nearest_station` / `access_note` / `parking_note`（§4.1） |
| 7 表の `version` | **持たない。**設定 7 画面の衝突は `store_settings_revision`（§4.6）の 1 版で見る |
| `StaffMember.role` | `staff.role`（`manager` / `staff`。§5.1） |
| `StaffMember.maxParallelReservations` | `staff.max_parallel_reservations`（§5.1）。**`maxParallel` という別名を作らない** |
| `Equipment.inactiveReason` | `equipment.inactive_reason`（§5.4）。**`stoppedReason` という別名を作らない** |
| `CustomerDetail.address` | `customers.address`（§9.1） |
| `CustomerMergePreview.losingCustomerNumber` | **`customers.customer_number`（`G-NNNNN`）**（§9.1）。`code` という列名にしない — `00_service-spec.md`（Approved）と `features/007-customer-records` がこの綴りで、`reservations.code` / `recordings.code` と紛らわしくなる |
| `StoreMembership.permissions` の保存先 | `store_memberships`（§3.2）の `permissions` 列（**空白区切りの文字列**。JSON 配列にしない） |
| `VisitPurpose.nameShort` | **`visit_purposes.name_short`（1〜5 文字・NOT NULL）を足す**（§6.1） |

あわせて `03-data-model.md` が足した列のうち、この面の契約に載せるもの:
`web_bookings.public_code`（`WebBookingCode`）/ `customers.phone_last4` / `recordings.code` /
`reception_sessions.draft_json`。

### 4.1 原始型（他のスキーマから再利用する）

| 名前 | 定義 | 境界 |
|---|---|---|
| `LocalDate` | `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` | `2026-08-27`。`2026-8-7` は不可 |
| `LocalTime` | `z.string().regex(/^([01]\d\|2[0-3]):[0-5]\d$/)` | `10:00` / `23:59` は可、`24:00` は不可 |
| `IsoDateTime` | `z.string().datetime()` | UTC の ISO8601。JST 変換はドメイン層で行う |
| `Weekday` | `z.number().int().min(0).max(6)` | 0=日 … 6=土（決定ブリーフ §3.2） |
| `Uuid` | `z.string().uuid()` | ドメインが発行する ID |
| `OrganizationId` | `z.string().trim().min(1).max(200)` | admin 由来のため UUID 制約を課さない（既存の `OrganizationSync.id` と同一）。ただし **notifier へ渡す `organizationId` は `packages/contracts/src/notification.ts` 側が 100 文字上限**なので、§7 の呼び出しでは 100 文字を超える org id を送れない |
| `ReservationCode` | `z.string().regex(/^EY-\d{4}-\d{4,5}$/)` | `EY-2608-0142`。**業務側の予約番号は 1 書式だけ**（決定ブリーフ §3.3 のまま）。組織 × `YYMM` の連番が 9999 を越えた月は 5 桁になる |
| `WebBookingCode` | `z.string().regex(/^EY-W-\d{4}-\d{4,5}$/)` | `EY-W-2608-0031`。**お客様に見せる Web のご予約番号**（`web_bookings.public_code`）。`reservations.code` とは別の採番系統で、同じ 2026-08 に `0031` と `0142` が共存していることから 1 本の番号列でないと読める |
| `PhoneInput` | `z.string().trim().min(10).max(20)` | `090-1234-5678`。ハイフン・全角を許し、保存前に数字だけへ正規化 |
| `PhoneNormalized` | `z.string().regex(/^0\d{9,10}$/)` | 10 桁または 11 桁。先頭 0 |
| `PhoneSuffix` | `z.string().regex(/^\d{4}$/)` | 下 4 桁検索（LEDGER-WALKIN「下4桁でも探せます」）。`customers.phone_last4` の**完全一致**で引く（後方一致は index が効かない） |
| `DurationMinutes` | `z.number().int().min(5).max(480).multipleOf(5)` | 20 / 30 / 40 / 60 / 90 |
| `Pin` | `z.string().regex(/^\d{4,6}$/)` | 4 桁ちょうど可・6 桁ちょうど可・3 桁不可・7 桁不可 |
| `Version` | `z.number().int().nonnegative()` | 楽観ロック |
| `Cursor` | `z.string().min(1).max(512)` | 不透明 |
| `Limit` | `z.number().int().min(1).max(200).default(50)` | — |

### 4.2 同期・端末・統制

| スキーマ名 | 用途 | 主なフィールドと制約 |
|---|---|---|
| `OrganizationSync` | admin → domain の組織スナップショット | `id: OrganizationId` / `name: 1..200` / `plan: Plan`（`packages/contracts/src/auth.ts` の `z.enum(['free','contracted'])` を import） / `isDisabled: boolean` / `createdAt: IsoDateTime` / `revision: int>=0 (default 0)`。**現行 `packages/contracts/src/glasses_management.ts` の定義（`z.strictObject`）をそのまま保つ** — admin の `matchesCanonicalSnapshot` が 6 フィールド全一致を要求するので、形を変えると admin 側のテストが落ちる |
| `StorePermission` | 店舗スコープ権限の語彙 | 現行 `packages/contracts/src/glasses_management.ts` の 19 値をそのまま保つ（`store.read` / `store.manage` / `reservation.read` / `reservation.write` / `customer.read` / `customer.write` / `customer.history` / `attention.read` / `attention.write` / `attention.publish` / `attention.revise` / `attention.hide` / `settings.read` / `settings.manage` / `recording.read` / `recording.manage` / `audit.read` / `terminal.manage` / `analytics.read`）。**許可リストなので未知の値は落とす（fail close）** |
| `StoreMembership` | admin → domain の担当店舗・権限 | `id: Uuid` / `organizationId` / `storeId: Uuid` / `userId: string 1..200` / `permissions: StorePermission[]`（空配列 = 担当解除の墓標。未知の語が 1 つでもあれば 400） / `createdAt: IsoDateTime`。**現行 `packages/contracts/src/glasses_management.ts` の定義（`z.strictObject`）をそのまま保つ。`StoreMembershipSync` という別名を作らない** — Worker が `zValidator('json', StoreMembership)` で使っている名前である |
| `Actor` | 認可で解決した操作主体（**出荷済み**） | `subjectId: string 1..200` / `organizationId` / `kind: 'staff'\|'terminal'\|'system'\|'customer'` / `terminalId: Uuid \| null (既定 null)`。**リクエスト入力から作らない**（JWT と端末セッションから組み立てる）。`audit_events.actor_type` / `actor_id` / `terminal_id` はこの値から書く |
| `Terminal` | 端末 | `id: Uuid` / `storeId` / `name: 1..60` / `kind: 'shared'\|'personal'` / `placeNote: 0..40` / `autoLockSeconds: int 30..1800 (既定 120)` / `isActive: boolean` / `hasPin: boolean`（**`pinHash` は絶対に返さない**） / `lastSeenAt: IsoDateTime \| null` / `isOnline: boolean`（サーバ計算） |
| `TerminalListQuery` | 端末の一覧 | `storeId: Uuid` / `includeInactive: boolean (既定 false)` / `kind?: 'shared'\|'personal'` |
| `TerminalInput` / `TerminalPatch` | 端末の登録・更新 | `name` / `kind` / `autoLockSeconds` / `isActive` / `pin: Pin`（任意） / `version`（Patch のみ必須） |
| `TerminalSessionStart` | PIN で業務を始める | `mode: 'shared'\|'personal'` / `staffId: Uuid`（`mode='personal'` のとき必須） / `pin: Pin` |
| `TerminalSession` | 端末セッション | `id: Uuid` / `terminalId` / `staffId: Uuid \| null` / `mode` / `startedAt` / `expiresAt: IsoDateTime` |
| `ReauthInput` | 個人モードへの昇格 | `staffId: Uuid` / `pin: Pin` / `reason: 'recording'\|'attention'\|'settings'\|'customer_merge'`（`terminalId` はパスで受ける） |
| `PinSetResult` | PIN 設定の結果 | `staffId` / `updatedAt`。**PIN そのものを返さない** |
| `AuditEvent` | 監査 1 件 | `id` / `occurredAt` / `actorType: 'staff'\|'terminal'\|'system'\|'customer'` / `actorId: string \| null` / `terminalId: Uuid \| null` / `action: 1..80` / `targetType` / `targetId` / `correlationId` / `beforeJson`・`afterJson` は `z.unknown()` |
| `AuditSearchQuery` | 監査検索 | `storeId?` / `from?`・`to?: LocalDate` / `actorId?` / `action?` / `limit` / `cursor` |
| `AuditEventList` | 監査一覧 | `items: AuditEvent[]` / `nextCursor` / `total` |

### 4.3 店舗と受付条件

| スキーマ名 | 用途 | 主なフィールドと制約 |
|---|---|---|
| `Store` | 店舗（**出荷済み**。`GET /api/staff/stores` の要素） | `id: Uuid` / `organizationId: OrganizationId` / `name: 1..60` / `slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/`（2..40） / `phone: 0..30 (既定 '')` / `address: 0..200 (既定 '')` / `accessNote: 0..200 (既定 '')` / `isActive: boolean` / `createdAt: IsoDateTime`。**現行 `packages/contracts/src/glasses_management.ts` の `Store` がこの形**（ただし `name` は `max(200)`、`slug` は `max(80)`）。`03-data-model.md` §4.1 に合わせて **P1（`004-store-settings`）で `name` を 1..60、`slug` を 2..40 に狭める**（既存 seed が収まることを先に確かめる）。`StoreSummary` という別のスキーマを作らない |
| `StoreDetail` | SETTINGS-STORE | `Store` + `namePublic: 0..60 \| null` / `nearestStation: 0..40 \| null` / `parkingNote: 0..60 \| null` / `introText: 0..200 \| null`（「78文字／200文字まで」）/ `sortOrder: int \| null` / `updatedAt: IsoDateTime \| null` / `updatedBy: Uuid \| null` / `settingsVersion: Version`（`store_settings_revision.version`。§4.6 の 1 版で衝突を見る）。列名の綴りは `03-data-model.md` §4.1 を正とする（`publicName` / `intro` という別名を作らない） |
| `StorePatch` | 店舗の更新 | 上の任意項目 + `version: Version`（必須。**`store_settings_revision.version`** を送る。`stores` は自分の `version` を持たない） |
| `BusinessHoursRow` | 曜日 1 行 | `weekday: Weekday` / `isClosed: boolean` / `opensAt`・`closesAt: LocalTime \| null` / `breakStart`・`breakEnd: LocalTime \| null`。`isClosed=false` なら `opensAt < closesAt` を refine |
| `BusinessHoursView` / `BusinessHoursInput` | 営業時間 | `rows: BusinessHoursRow[]`（**7 行ちょうど**・weekday 重複不可） / `version` |
| `CalendarException` | 臨時の休み・特別営業 | `id` / `date: LocalDate` / `kind: 'closed'\|'special'` / `opensAt`・`closesAt: LocalTime \| null` / `note: 0..60`（「棚卸しのため」） |
| `CalendarExceptionInput` | 追加 | `date` / `kind` / `opensAt?` / `closesAt?` / `note?`。`kind='special'` なら時刻必須を refine |
| `CalendarExceptionQuery` | 取得 | `from`・`to: LocalDate`（**最大 92 日**。SETTINGS-CALENDAR は 2 か月ぶん） |
| `SlotRules` | 予約のきまり | `slotMinutes: int 5..60 (既定 30)` / `cleanupMinutes: int 0..60 (既定 10)` / `maxParallel: int 1..20 (既定 3)` / `version` / `updatedAt` |
| `SlotRulesInput` | 更新 | 上の 3 値 + `version` |
| `SlotRulesView` | 更新の応答 | `SlotRules` + `lastAcceptableAt: Record<Weekday, LocalTime \| null>`（「木曜日に最後にお受けできるのは 18:20 です。」） |
| `StaffMember` | スタッフ | `id` / `displayName: 1..40` / `kana: 0..40` / `jobLabel: 0..40`（「視力測定・加工」） / `role: 'staff'\|'manager' (既定 'staff')`（SETTINGS-STAFF「できる役割　スタッフ（設定は見るだけ）」） / `isActive` / `sortOrder: int` / `skills: SkillCode[]` / `adminUserId: string \| null` / `hasPin: boolean` / `maxParallelReservations: int 1..5 (既定 1)`（SETTINGS-STAFF「同時に受け持てるご予約　1件まで」。列は `staff.max_parallel_reservations`） / `pinUpdatedAt: IsoDateTime \| null` |
| `SkillCode` | 技能 | `z.enum(['measure','processing','sales_reception','fitting','contact_lens','repair'])` = 視力測定 / 加工 / 販売・受付 / フィッティング / コンタクトの相談 / 修理・部品交換（SETTINGS-STAFF の 6 チップ）。**綴りは `03-data-model.md` §5.2 の `skill_code` と同じにする**（`eye_exam` / `lens_work` という別名を作らない）。この 6 値以外を取らない |
| `StaffMemberInput` / `StaffMemberPatch` | 追加・更新 | 上の可変項目 + `version`（Patch のみ必須） |
| `StaffSkillsInput` | 技能の一括置換 | `skills: SkillCode[]`（重複不可・0 件可） |
| `StaffPinInput` | PIN 再設定 | `pin: Pin` |
| `StaffShift` | 勤務（**曜日テンプレートの展開結果。読み取り専用**） | `id` / `staffId` / `date: LocalDate` / `startsAt`・`endsAt: LocalTime` / `kind: 'work'\|'break'`。`startsAt < endsAt` を refine |
| `StaffShiftQuery` | 取得 | `from`・`to: LocalDate`（**最大 62 日**） / `staffId?` |
| `StaffShiftsInput` | 一括置換 | `staffId: Uuid` / `weekly: { weekday: Weekday, isOff: boolean, startsAt?: LocalTime, endsAt?: LocalTime, breaks?: { startsAt, endsAt }[] }[]`（**7 行ちょうど**） / `effectiveFrom: LocalDate` / `version`。サーバは 7 行を `staff_weekly_shifts` に保存し、`effectiveFrom` から **62 日先まで** `staff_shifts` の行へ展開して置き換える（§3.3） |
| `StaffListQuery` | 取得 | `includeInactive: boolean (既定 false)` / `date?: LocalDate`（その日の勤務を同梱する） |
| `EquipmentKind` | 設備の種別 | `z.enum(['measure','counter','workbench'])` = 視力測定機 / 相談カウンター / 加工室（決定ブリーフ §3.2）。**`counter` には フィッティング台 も含む**（決定ブリーフ §12.3。`03-data-model.md` §5.4 の割り当て表が正） |
| `Equipment` | 設備・場所 | `id` / `name: 1..40` / `kind: 'measure'\|'counter'\|'workbench'` / `capacity: int 1..10 (既定 1)` / `isActive` / `sortOrder` / `inactiveReason: 0..60 \| null`（「定期点検（メーカー来店）」「部品待ちで止めています」。列は `equipment.inactive_reason`） / `roleLabel: 1..20`（LEDGER-RESOURCE の行名の下。全 7 件で非 NULL） / `ledgerDisplay: 'grey'\|'hide'` |
| `EquipmentInput` / `EquipmentPatch` | 追加・更新 | 上の可変項目 + `version`（Patch のみ必須） |
| `EquipmentListQuery` | 取得 | `includeInactive: boolean (既定 false)` / `kind?` |
| `EquipmentMaintenance` | 点検 | `id` / `equipmentId` / `startsAt`・`endsAt: IsoDateTime` / `note: 0..60`。`startsAt < endsAt` を refine |
| `EquipmentMaintenanceInput` | 追加 | 上の 3 項目 |
| `MaintenanceQuery` | 取得 | `from`・`to: LocalDate`（最大 92 日） |
| `VisitPurpose` | ご来店の目的 | `id` / `storeId: Uuid \| null`（null=チェーン共通） / `nameInternal: 1..40`（「メガネを新しく作る」） / `namePublic: 1..40`（「新しいメガネを作る」） / `durationMinutes: DurationMinutes` / `isWebPublished: boolean` / `isActive: boolean` / `sortOrder: int` / `requirements: PurposeRequirement[]` / `version`。**`nameShort: 1..5`（「新調相談」）を持つ**（`visit_purposes.name_short`）。台帳の帯・一覧・影響カードはこれを出す |
| `PurposeRequirement` | 目的の要求 | `kind: 'skill'\|'equipment_kind'` / `value: SkillCode \| EquipmentKind` を discriminated union で表す |
| `VisitPurposeInput` / `VisitPurposePatch` | 追加・更新 | 上の可変項目 + `version`（Patch のみ必須） |
| `PurposeRequirementsInput` | 要求の一括置換 | `requirements: PurposeRequirement[]`（同一 kind+value の重複不可） |
| `PurposeOrderInput` | 並べ替え | `purposeIds: Uuid[]`（1..50・重複不可） |
| `PurposeListQuery` | 取得 | `storeId?` / `includeInactive: boolean (既定 false)` / `webPublishedOnly: boolean (既定 false)` |
| `SettingsImpactRequest` | 保存前の影響試算 | `storeId` / `kind: 'equipment_stop'\|'purpose_duration'\|'business_hours'` / `draft: z.unknown()`（kind ごとに discriminated union で絞る） |
| `SettingsImpactReport` | 影響 | `affectedReservations: SettingsImpactItem[]` / `affectedWebSlots: SettingsImpactItem[]` / `lastAcceptableAt: LocalTime \| null` / `severity: 'info'\|'action'`（`.tag` を赤にするかどうか） |
| `SettingsImpactItem` | 影響 1 件 | `at: IsoDateTime` / `label: 1..80`（「山口 真央 様　視力測定」「視力測定機Aが空きません」） / `targetType` / `targetId` |

### 4.4 空き枠

| スキーマ名 | 用途 | 主なフィールドと制約 |
|---|---|---|
| `AvailabilityQuery` | 業務側の空き枠 | `storeId: Uuid` / `date: LocalDate` / `purposeIds?: string`（カンマ区切り・最大 5 件） / `durationMinutes?: DurationMinutes` / `staffId?: Uuid` / `equipmentIds?: string`（カンマ区切り・最大 5 件） / `excludeReservationId?: Uuid` / `excludeReceptionSessionId?: Uuid` / `axis: 'staff'\|'resource' (既定 'staff')`（**URL のクエリに乗る値。`equipment` ではない** — `05-screen-flow.md` §3 のクエリ表に揃える） |
| `AvailabilitySlot` | 枠 1 つ | `startsAt`・`endsAt: IsoDateTime` / `remaining: int >=0`（「あと2枠」） / `isAvailable: boolean` / `staffIds: Uuid[]` / `equipmentIds: Uuid[]` / `reason: AvailabilityReason \| null` |
| `AvailabilityReason` | 置けない理由 | `z.enum(['closed','outside_hours','break','maintenance','staff_busy','staff_off','equipment_busy','no_skill','max_parallel','web_window','lead_time'])`。BOOK-02b-PURPOSE-CONFLICT の「視力測定機が 11:30 から点検です。」は `maintenance` |
| `AvailabilityLane` | 台帳軸の 1 行 | `kind: 'staff'\|'equipment'\|'unassigned'` / `id: Uuid \| null` / `name` / `subtitle`（「視力測定・加工」） / `slots: AvailabilitySlot[]` |
| `AvailabilityResponse` | 応答 | `date` / `opensAt`・`closesAt: LocalTime \| null` / `isClosed: boolean` / `slotMinutes` / `cleanupMinutes` / `durationMinutes` / `slots: AvailabilitySlot[]` / `lanes: AvailabilityLane[]` / `alternatives: AvailabilitySlot[]`（最大 3 件。BOOK-02b-PURPOSE-CONFLICT・BOOK-CONFLICT の代替） / `serverNow: IsoDateTime` |
| `PublicAvailabilityQuery` | Web 側 | `purposeId: Uuid` / `from`・`to: LocalDate`（**最大 7 日**。WEB-03-DATETIME は週表示） |
| `PublicAvailabilityResponse` | Web 側 | `days: { date, isClosed, isFull, slots: { startsAt, isAvailable }[] }[]`。担当・設備の内訳は**返さない**（お客様に社内情報を出さない） |

### 4.5 予約

| スキーマ名 | 用途 | 主なフィールドと制約 |
|---|---|---|
| `ReservationSource` | 出どころ | `z.enum(['phone','counter','walkin','web'])`。表示語は「お電話」「店頭」「Web予約」「ウォークイン」の 4 語（EX-OFFLINE が 4 語を出し分ける）。台帳の色は 3 系統（緑＝`phone`・`counter` / 青＝`web` / 茶＝`walkin`）で、緑の帯には出どころの語を書かない |
| `ReservationStatus` | 状態 | `z.enum(['confirmed','arrived','serving','done','cancelled','no_show'])` |
| `ReservationAssignment` | 担当・設備の押さえ | `kind: 'staff'\|'equipment'` / `targetId: Uuid \| null`（null=あとで決める） / `startsAt`・`endsAt: IsoDateTime` |
| `ReservationPurposeLine` | 目的 1 件 | `purposeId` / `nameInternal` / `durationMinutes` / `sortOrder` |
| `ReservationDetail` | 予約 1 件 | `id` / `code: ReservationCode` / `storeId` / `source` / `status` / `startsAt`・`endsAt: IsoDateTime` / `durationMinutes` / `customer: CustomerSummary \| null` / `purposes: ReservationPurposeLine[]`（1..5） / `assignments: ReservationAssignment[]` / `webBookingCode: WebBookingCode \| null`（`source='web'` のときだけ非 null） / `purposeLabel`（`name_short` を `・` で連結）・`purposeLabelInternal`（`name_internal` を連結） / `noteCustomer: 0..2000` / `noteInternal: 0..2000` / `attentions: CustomerNote[]` / `recording: RecordingSummary \| null` / `version` / `createdAt`・`updatedAt` / `createdBy` / `cancelledAt`・`cancelReason` |
| `StaffReservationCreate` | 作成 | `storeId` / `startsAt: IsoDateTime` / `purposeIds: Uuid[] (1..5)` / `durationMinutes?: DurationMinutes`（省略時は目的の合計） / `staffId?: Uuid \| null` / `equipmentIds?: Uuid[] (0..5)` / `customerId?: Uuid` / `customerDraft?: CustomerCreate`（新規登録と同時） / `noteCustomer?` / `noteInternal?` / `source: ReservationSource` / `holdId?: Uuid` / `receptionSessionId?: Uuid`。`customerId` と `customerDraft` の**同時指定は refine で拒否** |
| `ReservationChangeInput` | 変更 | `version: Version`（必須） / `startsAt?` / `durationMinutes?` / `purposeIds?` / `staffId?: Uuid \| null` / `equipmentIds?` / `noteCustomer?` / `noteInternal?` / `notify: boolean (既定 false)`（CHANGE-DIFF「お電話でのご予約のため、メールは送りません。」） |
| `ReservationCancelInput` | 取消 | `version` / `reason: 'customer'\|'store'\|'duplicate'\|'no_show'` / `notify: boolean (既定 false)` |
| `ReservationProgressPatch` | 進捗 | `version` / `status: ReservationStatus` / `occurredAt?: IsoDateTime`（省略時はサーバ時刻） / `staffId?: Uuid` |
| `ReservationSearchQuery` | 検索 | `storeId?` / `name?: 0..40` / `kana?` / `phone?: PhoneInput \| PhoneSuffix` / `code?: ReservationCode \| WebBookingCode`（お客様が読み上げるのは `EY-W-` のほうなので両方で引ける） / `from`・`to?: LocalDate` / `status?: ReservationStatus[]` / `source?: ReservationSource[]` / `staffId?` / `includeCancelled: boolean (既定 false)` / `crossStore: boolean (既定 false)`（EX-EMPTY-SEARCH「丸の内店・新宿店のご予約も含める」） / `limit` / `cursor` |
| `ReservationList` | 検索結果 | `items: ReservationSummary[]` / `nextCursor` / `total` / `relaxations: SearchRelaxation[]`（**0 件のときだけ 1..3 件**） |
| `SearchRelaxation` | 条件を 1 つ緩めた提案 | `label: 1..60`（「「Web予約だけ」を外す」） / `count: int >=1` / `query: z.unknown()`（そのまま再送できるクエリ） |
| `ReservationSummary` | 一覧の 1 行 | `id` / `code` / `startsAt` / `durationMinutes` / `status` / `source` / `customerName: string \| null` / `visitCount: int \| null` / `purposeLabel` / `staffName: string \| null`（null は「決めてください」で描く） |
| `LedgerQuery` | 台帳 | `storeId: Uuid` / `date: LocalDate` / `axis: 'staff'\|'resource' (既定 'staff')`（LEDGER-LIST の「台帳の並べ方」） / `view: 'timetable'\|'list' (既定 'timetable')`（同「表示のかたち」） / `filter: 'all'\|'upcoming'\|'pending' (既定 'all')`（LEDGER-LIST「すべて 12件／これから 7件／確認待ち 1件」）。**`axis` と `filter` の値は `05-screen-flow.md` §3 のクエリ表が正**（`equipment` / `pending_review` にしない。URL にそのまま乗る文字列である） |
| `LedgerView` | 台帳 | `date` / `axis` / `view` / `opensAt`・`closesAt: LocalTime \| null` / `slotMinutes` / `lanes: LedgerLane[]` / `walkins: WalkinSummary[]` / `counts: { all, upcoming, pendingReview }` / `estimatedWaitMinutes: int >=0`（LEDGER-WALKIN「目安 15分」） / `nextTicketNo: int 1..999`（同「ウォークイン 005」） / `serverNow: IsoDateTime` |
| `LedgerLane` | 台帳の 1 行 | `kind: 'staff'\|'equipment'\|'unassigned'\|'walkin'` / `id: Uuid \| null` / `name` / `subtitle` / `entries: LedgerEntry[]` / `blocks: LedgerBlock[]`（休憩・点検） |
| `LedgerEntry` | 台帳の帯 | `reservationId` / `startsAt`・`endsAt` / `customerName: string \| null` / `visitCount: int \| null` / `purposeLabel` / `source` / `status` / `isUnassigned: boolean` |
| `LedgerBlock` | 埋まっている帯 | `kind: 'break'\|'maintenance'\|'closed'` / `startsAt`・`endsAt` / `label: 0..30`（「休憩」「点検」） |
| `ReservationChangeHistory` | 経緯 1 行 | `occurredAt` / `what: 1..120`（「ご来店時刻を 11:30 から 11:00 へ」） / `actorName: string \| null` |
| `Hold` | 仮の押さえ | `id: Uuid` / `expiresAt: IsoDateTime` / `startsAt`・`endsAt` / `staffId`・`equipmentIds` |
| `HoldInput` | 仮の押さえ | `storeId` / `startsAt` / `durationMinutes` / `staffId?: Uuid \| null` / `equipmentIds?: Uuid[]` |

### 4.6 ウォークインと来店

| スキーマ名 | 用途 | 主なフィールドと制約 |
|---|---|---|
| `Walkin` | ウォークイン | `id` / `ticketNo: int 1..999` / `arrivedAt: IsoDateTime` / `purposeId: Uuid \| null`（受付パネルの 4 択） / `purposeNote: 0..80`（4 択に無いご用件の自由記述。「フレームの相談」） / `customerId: Uuid \| null` / `reservationId: Uuid`（**受付と同時に起こす `source='walkin'` の予約**） / `status: 'waiting'\|'serving'\|'booked'\|'left'`（`booked`＝先の日時のご予約に振り替えた） / `waitedMinutes: int >=0`（サーバ計算。「お待ち 6分」。15 分以上で「お待たせ中」） / `leftAt: IsoDateTime \| null` / `version` |
| `WalkinCreate` | 受付 | `storeId` / `purposeId?: Uuid` / `purposeNote?` / `customerId?: Uuid` / `staffId?: Uuid \| null`（未定なら null） / `startsAt?: IsoDateTime`・`durationMinutes?`（LEDGER-WALKIN が台帳に点線で描く「ここに入ります 11:30–12:30」。省略時は `arrivedAt` と目的の所要から決める） / `arrivedAt?: IsoDateTime`（省略時はサーバ時刻）。**`purposeId` と `purposeNote` はどちらか一方が必須** |
| `WalkinPatch` | 更新 | `version` / `customerId?` / `staffId?` / `status?` / `reservationId?` |
| `WalkinListQuery` | 取得 | `storeId` / `date: LocalDate`（**必須。「いまお待ち N名」は当日で絞る**） / `status?: Walkin['status'][]` |
| `WalkinSummary` | 台帳の帯 | `id` / `ticketNo` / `arrivedAt` / `waitedMinutes` / `purposeNote` / `status` |
| `VisitStage` | 工程 | `z.enum(['received','waiting','measuring','consulting','fitting','checkout','handover','left'])`。決定ブリーフ §3.3 の 7 値に **`handover`（お渡し）** を足した 8 値（`03-data-model.md` §7.5）。列の並びは enum の宣言順ではない |
| `VisitEventInput` | 工程を進める | `storeId` / `subjectType: 'reservation'\|'walkin'` / `subjectId: Uuid` / `stage: VisitStage` / `occurredAt?: IsoDateTime` / `staffId?: Uuid` / `note?: 0..120` |
| `VisitEvent` | 工程 1 件 | `id` / `subjectType` / `subjectId` / `stage` / `occurredAt` / `staffId: Uuid \| null` / `note` |
| `VisitBoardQuery` | ボード | `storeId` / `date: LocalDate` / `scope: 'active'\|'all' (既定 'active')`（「ご来店中／本日すべて」） |
| `VisitBoardRow` | ボードの 1 行 | `subjectType` / `subjectId` / `displayName`（「田中 花子 様」「ウォークイン 003」） / `visitCount: int \| null` / `purposeLabel` / `cells: VisitBoardCell[]` / `isWaitingTooLong: boolean` |
| `VisitBoardCell` | ボードのセル | `stage: VisitStage` / `state: 'done'\|'doing'\|'next'\|'waiting'\|'empty'` / `at: IsoDateTime \| null` / `label: 0..30`（「視力測定機 A」「お待たせ中 18分」） |
| `VisitBoard` | ボード | `date` / `activeCount: int` / `rows: VisitBoardRow[]` / `serverNow` |
| `ReceptionHistoryQuery` | 受付履歴 | `storeId?` / `from`・`to: LocalDate`（最大 92 日。**ご来店日で絞る**） / `staffId?`（**接客する担当**＝`reservation_assignments` で絞る。受け付けた人（`reception_sessions.actor_id`）ではない — 共有端末では NULL になり、その受付が全部漏れるため） / `outcome?: 'booked'\|'discarded'` / `status?: ReservationStatus[]` / `name?: 0..40`（HISTORY-LIST「⌕ お客様名で探す」） / `limit` / `cursor` |
| `ReceptionHistoryEntry` | 1 行 | `sessionId` / `startedAt` / `displayName` / `visitCount: int \| null` / `outcome` / `reservationStatus: ReservationStatus \| null` |
| `ReceptionHistoryList` | 一覧 | `items` / `nextCursor` / `total` / `relaxations: SearchRelaxation[]`（0 件のときだけ） |
| `ReceptionHistoryDetail` | 詳細 | `sessionId` / `reservation: ReservationDetail \| null` / `receivedBy: 1..40` / `receivedAt` / `changes: ReservationChangeHistory[]` / `recording: RecordingSummary \| null` |

### 4.7 顧客

| スキーマ名 | 用途 | 主なフィールドと制約 |
|---|---|---|
| `CustomerSummary` | 一覧・埋め込み | `id` / `name: 1..40` / `kana: 0..40` / `phone: PhoneNormalized \| null` / `visitCount: int >=0` / `lastVisitAt: LocalDate \| null` / `memoShort: 0..40`（「PC作業用・鼻パッド低め」） |
| `CustomerDetail` | 詳細 | Summary + `email: string \| null` / `birthDate: LocalDate \| null` / `memo: 0..2000` / `firstVisitAt` / `prescriptions: Prescription[]`（新しい順・最大 20） / `glasses: OwnedGlasses[]` / `notes: CustomerNote[]` / `nextReservation: ReservationSummary \| null` / `mergedIntoId: Uuid \| null` / `version` |
| `Prescription` | 度数 | `id` / `measuredAt: LocalDate` / `rSph`・`lSph: number -30..30 (0.25 刻み)` / `rCyl`・`lCyl: number -10..10 (0.25 刻み)` / `rAxis`・`lAxis: int 0..180` / `rAdd`・`lAdd: number 0..5 (0.25 刻み)` / `pd: number 40..85 (0.5 刻み)` / `note: 0..200` / `isCurrent: boolean` |
| `OwnedGlasses` | 現在のメガネ | `id` / `purchasedAt: LocalDate` / `frameName: 0..60` / `lensName: 0..60` / `usageLabel: 0..30`（「遠近両用（お出かけ用）」） / `note: 0..200` / `isCurrent: boolean` |
| `CustomerNote` | メモ・注意ごと | `id` / `kind: 'memo'\|'attention'` / `body: 0..2000` / `handwritingSvg: string \| null (最大 512KB)`（**保存先は R2。D1 には `customer_notes.handwriting_key` だけを持つ**。書き込みは本体を送り、読み出しは Worker が R2 から取って許可リストで再直列化した SVG を載せる。R2 の URL は返さない。**1 顧客 5 枚まで**） / `authorId` / `authorName` / `revision: int >=0` / `status: 'draft'\|'published'\|'hidden'` / `storeId` / `createdAt` |
| `CustomerSearchQuery` | 検索 | `query?: 0..40`（お名前・電話番号の部分一致） / `sort: 'kana'\|'visits' (既定 'kana')`（CUSTOMER-LIST「お名前順／ご来店の回数順」） / `visitCountMin?`・`visitCountMax?: int` / `lastVisitFrom?`・`lastVisitTo?: LocalDate` / `staffId?` / `limit` / `cursor` |
| `CustomerList` | 一覧 | `items: CustomerSummary[]` / `nextCursor` / `total` |
| `CustomerLookupQuery` | 電話番号からの推定 | `phone?: PhoneInput`（正規化して `phone_normalized` の**前方一致**） / `phoneLast4?: PhoneSuffix`（`phone_last4` の**完全一致**） / `name?` / `kana?`。4 つとも空なら 400 |
| `CustomerCandidate` | 候補 1 件 | `customer: CustomerSummary` / `match: 'strong'\|'weak'` — **全桁が一致したものが `strong`（「よく一致しています」）、前方一致だけ・下 4 桁だけのものが `weak`（「確かめが必要です」）。1 件でも自動で確定しない** / `lastVisitAt` / `currentPrescription: Prescription \| null` / `lastStaffName: string \| null` / `attentionSummary: 0..60` |
| `CustomerCreate` | 新規登録 | `name: 1..40` / `kana?: 0..40` / `phone?: PhoneInput` / `email?` / `birthDate?` / `memo?: 0..2000` |
| `CustomerPatch` | 更新 | `version` + 上の任意項目 |
| `CustomerMergePreviewRequest` | 統合の下見 | `primaryId: Uuid` / `secondaryId: Uuid`。同一 ID は refine で拒否 |
| `CustomerMergePreview` | 下見 | `fields: CustomerMergeField[]` / `result: CustomerSummary` / `noteCount: int` / `losingCustomerNumber: string`（`customers.customer_number`。「お客様番号 G-02310 は使えなくなります。」。統合で失った番号は再利用しない） |
| `CustomerMergeField` | 項目ごとの選択 | `field: 'name'\|'kana'\|'phone'\|'email'\|'address'\|'birthDate'\|'memo'\|'notes'` / `primaryValue: string \| null` / `secondaryValue: string \| null` / `choice: 'primary'\|'secondary'\|'both'`（`notes` だけ `'both'` を許す）。CUSTOMER-MERGE に出るのは「お名前」「お電話番号」「ご住所」「接客のメモ」の 4 項目で、`address` には保存先の列が無い（§4.0 (b)） |
| `CustomerMergeInput` | 統合 | `primaryId` / `secondaryId` / `primaryVersion`・`secondaryVersion: Version` / `fields: CustomerMergeField[]` |
| `CustomerMergeResult` | 統合の結果 | `customer: CustomerDetail` / `mergedId: Uuid` / `movedReservations: int` / `movedNotes: int` |
| `CustomerNoteQuery` | メモ取得 | `kind?: 'memo'\|'attention'` / `status?: CustomerNote['status'][]` / `includeOtherStores: boolean (既定 true)`（CUSTOMER-HANDWRITE の 3 枚目は「丸の内店」） |
| `CustomerNoteInput` | メモ追加 | `kind` / `body?` / `handwritingSvg?` / `storeId`。`body` と `handwritingSvg` の**両方が空なら refine で拒否** |
| `CustomerNotePatch` | メモ更新 | `revision: int`（必須） / `body?` / `status?: 'draft'\|'hidden'` |
| `CustomerNotePublishInput` | 注意事項へ引き上げ | `revision: int` / `body: 1..2000` |

### 4.8 録音

| スキーマ名 | 用途 | 主なフィールドと制約 |
|---|---|---|
| `RecordingState` | 状態 | `z.enum(['recording','uploading','stored','failed','deleted'])` |
| `RecordingContentType` | 形式 | `z.enum(['audio/mp4','audio/webm','audio/mpeg'])`（許可リスト。それ以外は 400）。**既定は `audio/mp4`（AAC 32kbps モノラル）** — iPadOS の Safari の MediaRecorder が確実に出せる形式で、60 分でも約 14MB に収まる。`audio/webm` は取れない端末がある |
| `RecordingCreate` | メタデータ登録 | `receptionSessionId: Uuid` / `storeId` / `contentType: RecordingContentType` / `startedAt: IsoDateTime` |
| `RecordingStatePatch` | 状態更新 | `state: RecordingState` / `durationSeconds?: int 0..21600` / `bytes?: int 0..104857600`（100MB） / `failureReason?: 0..120` |
| `Recording` | 録音 | `id` / `receptionSessionId` / `reservationId: Uuid \| null` / `state` / `contentType` / `durationSeconds: int \| null` / `bytes: int \| null` / `retainUntil: IsoDateTime \| null` / `legalHold: boolean` / `uploadAttempts: int 0..99` / `createdAt`。**`r2Key` を返さない** |
| `RecordingSummary` | 埋め込み | `id` / `state` / `durationSeconds: int \| null`（「03:12」） |
| `RecordingListQuery` | 一覧 | `storeId?` / `state?: RecordingState[]` / `from`・`to?: LocalDate` / `limit` / `cursor` |
| `RecordingList` | 一覧 | `items: Recording[]` / `nextCursor: string \| null` / `total: int >=0`（§1.2 の形） |
| `RecordingPlaybackTicket` | 再生 | `token: string 32..256` / `expiresAt: IsoDateTime`（**発行から 900 秒**） / `durationSeconds: int \| null`。300 秒では最長の録音（HISTORY-LIST の `06:12` = 372 秒）を 1 回聞き通せない |
| `RecordingHoldInput` | 保全 | `legalHold: boolean` / `reason: 1..120` |
| `RecordingPurgeRequest` | 保守 | `now?: IsoDateTime`（テスト用の注入口） / `limit: int 1..500 (既定 100)` |
| `RecordingPurgeResult` | 保守 | `examined: int` / `deleted: int` / `skippedHeld: int` / `failed: int` |

### 4.9 お知らせと分析

| スキーマ名 | 用途 | 主なフィールドと制約 |
|---|---|---|
| `AlertCode` | 種別（**10 値**。`03-data-model.md` §11.3 の表と同じ集合） | `z.enum(['recording.upload_failed','web_booking.pending','equipment.maintenance_scheduled','store.closed_with_reservations','reservation.unclosed','store.no_shift','web_booking.auto_cancelled','notifier.send_failed','org.not_synced','d1.capacity_warning'])`。上 3 つが ALERTS に描かれているもの、以降は `03-data-model.md` §11.3 と `07-nfr.md` §11.3 が足したもの。**綴りは `store.no_shift`**（`staff.no_shift` にしない）。運用系の 3 値（`notifier.send_failed` / `org.not_synced` / `d1.capacity_warning`）は `audience='ops'` で作り、ALERTS には出さない |
| `Alert` | 1 件 | `id` / `code: AlertCode` / `severity: 'info'\|'action'` / `audience: 'store'\|'ops' (既定 'store')` / `title: 1..60` / `body: 0..120` / `targetType`・`targetId` / `occurredAt` / `readAt`・`resolvedAt: IsoDateTime \| null` / `resolvedBy: string \| null` |
| `AlertListQuery` | 一覧 | `storeId?` / `kind: 'all'\|'action'\|'info'\|'resolved' (既定 'all')`（ALERTS 左の 4 分類） / `audience: 'store'\|'ops' (既定 'store')` / `limit` / `cursor`。**ALERTS とサイドバーのバッジは `audience='store'` だけを数える**（運用のアラートを業務のお知らせに混ぜない。`07-nfr.md` §11.3） |
| `AlertList` | 一覧 | `items: Alert[]` / `nextCursor: string \| null` / `total: int >=0`（§1.2 の形） / `counts: { all, action, info, resolved }`（ALERTS 左「すべて 3／アラート（対応が必要） 1／お知らせ 2／対応済み 12」。`total` は `kind` で絞ったあとの件数、`counts` は 4 分類すべての件数） |
| `AlertPatch` | 更新 | `readAt?: IsoDateTime \| null` / `resolved?: boolean` |
| `AlertReadAllInput` / `AlertReadAllResult` | 一括既読 | `storeId?` → `{ updated: int }` |
| `AnalyticsQuery` | 分析 | `storeId: Uuid` / `metric: AnalyticsMetric` / `from`・`to: LocalDate`（**最大 400 日**） / `granularity: 'day'\|'month'\|'hour'\|'weekday' (既定 'day')` / `countBy: 'visit_date'\|'received_date' (既定 'visit_date')` |
| `AnalyticsMetric` | 指標 | `z.enum(['reservation_count','reservation_source','cancellation','visit_frequency','staff','purpose','wait_time'])` |
| `AnalyticsPoint` | 点 1 つ | `key: string`（`2026-08-27` / `14` / `mon`） / `label: 1..30` / `value: number` / `secondaryValue: number \| null`（件数に対する人数） / `isClosed: boolean`（定休日は 0 件で描く） / `isOverTarget: boolean` |
| `AnalyticsSeries` | 系列 | `name: 1..30` / `points: AnalyticsPoint[]` / `pattern: 'solid'\|'hatch'\|'dot'`（色以外でも見分けられるようにする地模様）。ANALYTICS-CANCEL の凡例は **`cancel_reason` を基準に 5 本**（「ご来店がなかった」「Webからの取消」「お客様のご都合」「店舗の都合」「予約の重複」）で、CHANGE-CANCEL の 4 択と 1 字も違えない（`03-data-model.md` §11.4） |
| `AnalyticsReport` | 応答 | `metric` / `from`・`to` / `granularity` / `countBy` / `series: AnalyticsSeries[]` / `summary: { label, value, unit, isOverTarget }[]` / `target: number \| null` / `suppressed: boolean`（**分母が 20 件未満のとき率を `null` にして「—」で描かせる**） / `businessDays: int`（「1日あたり」の分母。定休日・臨時休業を除いた営業日数） / `pendingDays: int`（まだ集計できていない日数。「〜日ぶんはまだ集計中です」を出す） |
| `AnalyticsTargets` | 目安 | `waitMinutes: 8` / `cancellationRatePercent: 10` / `revisitWindowDays: 90`（モックの表示値。**全店共通の固定値**で、店舗ごとの設定を持たない） |

### 4.10 Web 予約

| スキーマ名 | 用途 | 主なフィールドと制約 |
|---|---|---|
| `WebBookingSettings` | 公開設定 | `storeId` / `isPublished: boolean` / `landingPath: 1..60`（`eyex.jp/ginza`） / `opensAt`・`closesAt: LocalTime`（10:30–18:00） / `acceptFromHours: int 0..168 (**既定 2**)` / `acceptUntilDays: int 1..180`（30） / `requiresApproval: boolean (既定 true。**`false` を選ばせる UI は作らない**)` / `message: 0..120`（「27文字／120文字まで」） / `publishedPurposeIds: Uuid[]`（**0 件のまま `isPublished=true` にはできない**） / `version` / `updatedAt` |
| `WebBookingSettingsInput` | 更新 | 上の可変項目 + `version` |
| `WebPreviewQuery` | プレビュー | `purposeIds?: string`（カンマ区切り。未保存の値） / `message?: 0..120` |
| `WebPreviewResult` | プレビュー | `purposes: PublicStorePurpose[]` / `message: 0..120` / `storeName: 1..40`（SETTINGS-WEB 右「EYEX 銀座店　ご予約」） |
| `WebBookingReviewInput` | 承認・却下 | `decision: 'approve'\|'reject'` / `reason?: 0..120`（`decision='reject'` のとき必須を refine） |
| `PublicStoreSearchQuery` | 店舗一覧 | `limit: int 1..10 (既定 3)`（WEB-01-STORE「近い順に3店舗」） / `lat?`・`lng?: number` |
| `PublicStoreSummary` | 店舗 1 件 | `slug` / `name: 1..40` / `accessNote: 0..60`（「銀座駅 A2出口から徒歩3分」） |
| `PublicStoreDetail` | 店舗 | Summary + `phone` / `address` / `message: 0..120` / `isPublished: boolean` |
| `PublicStorePurpose` | 目的 1 件 | `id` / `name: 1..40`（**`visit_purposes.name_public`**。WEB-02-PURPOSE が `name_internal` の文字を描いているのはモックの誤りで、実装は `name_public` を出す） / `durationMinutes` |
| `PublicBookingCreate` | 予約作成 | `purposeId: Uuid` / `startsAt: IsoDateTime` / `contactName: 1..40` / `contactKana: 0..40` / `contactPhone: PhoneInput` / `contactEmail: email 最大 320` |
| `PublicBookingResult` | 応答 | `code: WebBookingCode`（お客様に見せる「ご予約番号」`EY-W-2608-0031`） / `status: 'pending'\|'confirmed'` / `startsAt`・`endsAt` / `storeName`（**`stores.name_public`**） / `purposeName`（**`visit_purposes.name_public`**） / `contactName` / `managementCode: string 8..32`（**この 1 回だけ平文で返す**。画面・メールでは「確認番号」と呼ぶ） / `emailed: boolean`（§7.2。確認メールを送れたか） |
| `PublicReservationVerification` | 本人確認 | `code: WebBookingCode` / `contactPhone: PhoneInput`（または `contactEmail`）。両方空なら 400 |
| `PublicReservationVerificationResult` | 本人確認 | `managementCode: string`（短命。KV `SHORT_LIVED` に TTL 900 秒） / `expiresAt` |
| `PublicReservationStatus` | 照会 | `code: WebBookingCode` / `status: 'pending'\|'confirmed'\|'cancelled'` / `startsAt`・`endsAt` / `storeName`（`stores.name_public`） / `purposeName`（`visit_purposes.name_public`） / `durationMinutes` / `contactName` / `changeDeadlineAt: IsoDateTime` |
| `PublicReservationChange` | 変更 | `startsAt: IsoDateTime` |
| `PublicReservationChangeResult` | 変更 | `PublicReservationStatus` + `previousStartsAt` |
| `PublicReservationCancel` | 取消 | `reason?: 0..120` |
| `PublicReservationMutationResult` | 取消 | `code` / `status: 'cancelled'` / `cancelledAt` |
| `WebPublicationApplyRequest` / `WebPublicationApplyResult` | 保守 | `now?: IsoDateTime`（テスト用の注入口） / `limit: int 1..500 (既定 100)` → `{ applied: int, skipped: int, autoCancelled: int }`（`autoCancelled` は §3.11 の pending 自動取消の件数） |

### 4.11 共通

| スキーマ名 | 用途 | 主なフィールドと制約 |
|---|---|---|
| `HealthStatus` | ヘルス | `status: z.literal('ok')` |
| `IssueTokenRequest` | dev トークン | `sub: string 1..200` / `org: OrganizationId` / `email: email 最大 320` / `role: 'admin'\|'staff' (既定 'staff')` / `ttlSeconds?: int 60..86400`。**`AUTH_DEV_GRANT === 'true'` のときだけ受け付ける** |
| `IssueTokenResponse` | dev トークン | `token: string` |
| `DeletedResult` | 削除 | `id: Uuid` / `deleted: z.literal(true)` |
| `StoreIdParam` / `StoreIdQuery` / `StoreSlugParam` | パス・クエリ | `storeId: Uuid` / `storeSlug: /^[a-z0-9-]{2,40}$/` |
| `ApiError` | エラー | `error: ErrorCode` |
| `ErrorCode` | エラーコード | §5 の enum |
| `VersionConflictError` | 楽観ロック | `ApiError` + `current: z.unknown()` / `fields: string[]`（EX-CONFLICT が項目単位で見比べるため） |
| `SlotTakenError` | 枠競合 | `ApiError` + `alternatives: AvailabilitySlot[]`（最大 3 件） |
| `RecordingRetainedError` | 保持中 | `ApiError` + `retainUntil: IsoDateTime` / `legalHold: boolean` |
| `PinInvalidError` | PIN 不一致 | `ApiError` + `remainingAttempts: int 0..2`（LOGIN-PIN-ERROR「あと2回お試しいただけます」） |
| `PinLockedError` | PIN ロック | `ApiError` + `retryAfterSeconds: int` / `remainingAttempts: int` |
| `ManagementCodeLockedError` | 確認番号の総当たり | `ApiError` + `retryAfterSeconds: int`（900） |
| `PurposeUnavailableError` | 目的を受けられない | `ApiError` + `alternatives: AvailabilitySlot[]` / `reason: AvailabilityReason`（**3 事由を 1 文に束ねないため、理由をコードで返す**） |

---

## 5. エラー表

`app.onError` は `HTTPException` を透過し、それ以外の throw を `console.error('unhandled', err)` +
`{ error: 'internal_error' }` + 500 にする。ハンドラ内で例外を握りつぶさない。

「画面に出す文」列は**そのまま画面に出す日本語**である（振る舞いの説明ではない）。
DESIGN_RULE §4 のとおり「何が起きたか ＋ どう回復するか」を 1〜2 文で書く。
モックに実物がある 8 件はその文字をそのまま写し、無いものはこの表で確定させる。
業務面は敬語を 1 段落として「〜してください」、お客様の面は「〜をお確かめください」で書く。

| code | status | 発生条件 | 追加フィールド | 画面に出す文 | 出す面 |
|---|---|---|---|---|---|
| `unauthorized` | 401 | トークンが無い／不正／**期限切れ**／別 secret 署名。`/api/internal/*` で `x-internal-key` 不一致・未設定 | — | 「安全のため、もう一度おはいりください」＋「入力していた内容は残しています。」 | LOGIN-STAFF（再ログイン後に下書きへ戻す） |
| `forbidden` | 403（保存） | 店長のみの操作をスタッフが叩いた | — | 「{対象}を変えられるのは 店長 だけです。{操作者}（{役割}）の権限では保存できません。{対象}はまだ何も変わっていません。」 | EX-PERMISSION。`{対象}` は第 2 サイドバーの項目名（`営業時間と定休日` / `ご来店の目的` / `設備と点検` / `スタッフと技能` / `店舗の情報` / `Web予約の公開`）、`{操作者}` は `staff.display_name`、`{役割}` は `店長` / `スタッフ`。**入力は捨てない** |
| `forbidden` | 403（閲覧） | 店長のみの画面を GET した | — | 「この画面は店長だけがご覧になれます」＋「前の画面に戻る」 | §2.1 の閲覧側の面 |
| `personal_mode_required` | 403 | 共有モードのまま「ご本人の確認」が要る操作を叩いた | — | 「{用件}にはご本人の確認が必要です」。`{用件}` は `録音の保全` / `注意ごとの公開` / `設定の変更` / `お客様のおまとめ` の 4 語 | MODE-PERSONAL（成功後に元の操作へ戻る） |
| `org_disabled` | 403 | 同期された org が `is_disabled='1'` | — | 「このお店はご利用いただけない状態です」＋「本部へお問い合わせください。業務を終えてお待ちください。」 | 全画面共通の帯 |
| `not_synced` | 503 | org の同期行がまだ届いていない | — | 「お店の情報を取り込んでいます。しばらくしてからお試しください。」＋「もう一度試す」 | 全画面共通の帯（ログアウトしない） |
| `not_found` | 404 | 対象が無い／他テナントの ID を指した／dev グラント無効時の `POST /api/auth/token` | — | 「このご予約は見つかりませんでした」＋「一覧へ戻る」 | 一覧へ戻す。**他テナントの存在を 403 で漏らさない** |
| `not_published` | 404 | 店舗は実在するが `web_booking_settings.is_published='0'` | — | 「ただいま Web でのご予約を承っておりません。」（WEB-CANCEL だけは存在を漏らさないため別文 →`invalid_management_code` と同じ文にする） | WEB-01-STORE |
| `version_conflict` | 409 | `version`（`revision`）が現在値と違う | `current` / `fields` | 「同じご予約を、ほかの端末でも直していました」＋「{端末名} の {氏名} が {時刻} に保存しました。選ぶまで、どちらの内容も書き換わりません。」 | EX-CONFLICT（相手の内容と自分の内容を並べて選ばせる） |
| `slot_taken` | 409（業務） | 確定・変更の瞬間に枠が埋まっていた（`reservation_slot_locks` の条件付き INSERT が 1 行も入らなかった）。**仮の押さえ（`POST /api/staff/holds`）ではこのコードを返さない**（§6.3） | `alternatives` | 「この枠は、ほかの端末で先に確定されました」＋「{時刻}　{担当}・{設備} が、たった今埋まりました。伺った内容は残っています。時刻か担当を選び直してください。」 | BOOK-CONFLICT |
| `slot_taken` | 409（対客） | 同上 | `alternatives` | 「この時間は、ちょうど埋まってしまいました。」＋代わりの時刻 3 件＋「日時を選び直す」 | WEB-03-DATETIME |
| `store_closed` | 409 | 定休日／営業時間外／臨時休業／受付を止める帯に書こうとした | — | 「この時間はご予約をお受けしていません。日付か時刻を選び直してください。」 | BOOK-01-DATETIME / WEB-03-DATETIME |
| `purpose_unavailable` | 409 | 目的が要求する技能・設備がその時間帯に空いていない。目的が `is_active='0'` | `alternatives` / `reason` | 設備の点検: 「{設備}が {時刻} から点検です。近いお時間ですと、次のとおりお取りできます。」／担当がいない: 「{目的}をご案内できる担当が {時刻} は出ておりません。近いお時間ですと、次のとおりお取りできます。」／設備が埋まっている: 「{設備}が {時刻} は空きません。近いお時間ですと、次のとおりお取りできます。」／目的が無効: 「このご用件は、いまお受けしていません。」 | BOOK-02b-PURPOSE-CONFLICT。**3 事由を 1 文で束ねない**（モックは点検の 1 事由しか描いていない） |
| `invalid_transition` | 409 | `reservations.status` / `recordings.state` が許されない遷移を求められた | — | 「このご予約はすでに {現在の状態} です。画面を新しくしてからお試しください。」＋「画面を新しくする」 | 変更・進捗の面 |
| `idempotency_conflict` | 409 | ①同一 `Idempotency-Key` に**違う本文** ②先行処理が `in_progress` のまま | — | 「同じ操作がすでに進んでいます。少し待ってから、もう一度お試しください。」 | 確定・受付の面（クライアントはキーを作り直して再送） |
| `recording_retained` | 409 | 最低保持期間内、または `legal_hold='1'` の録音を削除しようとした | `retainUntil` / `legalHold` | 保持期間内: 「この録音は {日付} まで消せません。」／保全中: 「この録音は保全中のため消せません。保全を外してからお試しください。」 | HISTORY-LIST / LEDGER-DETAIL |
| `change_deadline_passed` | 409 | Web 予約の変更・取消を、来店日の `web_booking_settings.change_deadline_days`（既定 1）日前の 23:59:59.999 JST より後に求めた | — | 「前日を過ぎたため、この画面では変更・お取り消しができません。お手数ですが {店舗の電話番号} までお電話でお願いいたします。」 | WEB-CANCEL |
| `code_exhausted` | 409 | 予約番号・お客様番号の連番が取れなかった（5 回再試行しても衝突） | — | 「予約番号を発行できませんでした。恐れ入りますが担当者にお知らせください。」 | BOOK-05-CONFIRM。500 にしない（人を呼ぶ） |
| `invalid_management_code` | 401 | `X-Management-Code` が一致しない／短命コードが期限切れ | — | 「ご予約番号か確認番号が違います。お送りしたメールの番号をお確かめください。」 | WEB-CANCEL。**存在の有無を漏らさない**ので `not_published` / `not_found` と同じ文にする |
| `pin_invalid` | 401 | PIN が一致しない（ロック前） | `remainingAttempts` | 「暗証番号が違います。あと{N}回お試しいただけます」＋「3回続くと、30秒お待ちいただきます。」 | LOGIN-PIN-ERROR |
| `pin_locked` | 429 | PIN の連続失敗が 3 回に達した | `retryAfterSeconds: 30` / `remainingAttempts: 0` | 「30秒お待ちください。」＋残り秒数 | LOGIN-PIN-ERROR |
| `weak_pin` | 400 | PIN が同一数字の並び（`0000`）または連番（`1234`） | — | 「この暗証番号は簡単すぎます。同じ数字の並びと連番は使えません。」 | SETTINGS-STAFF の PIN 再設定 |
| `management_code_locked` | 429 | 確認番号の入力失敗が 10 回 / 時（コード × IP）を超えた | `retryAfterSeconds: 900` | 「お待ちください。15分ほど経ってから、もう一度お試しください。」 | WEB-CANCEL |
| `payload_too_large` | 413 | 録音本体が 100MB を超えた | — | 「録音が大きすぎて送れませんでした。担当者にお知らせください。」 | EX-UPLOAD-FAILED（通信が弱いときの文とは別にする） |
| `internal_error` | 500 | 予期しない throw | — | 「うまく処理できませんでした。入力はそのまま残っています。もう一度お試しください。」 | **EX-OFFLINE の帯を使わない。**あの帯は「通信が切れています」なので、サーバ側の失敗を通信断だと言うことになる |

**D1 の制約違反をエラーコードに翻訳する場所を 1 か所に決める。**D1 は構造化されたエラーコードを返さない
（実測: `Object.keys(err)` が空、`cause` も空）。判別できるのは `message` の中の `<表名>.<列名>` と
`SQLITE_CONSTRAINT_UNIQUE` / `_PRIMARYKEY` だけである。予約の確定 1 バッチには一意制約が 3 つ同居し
（`reservations_org_code_idx` の予約番号 / `walk_ins_org_store_date_ticket_idx` の整理番号 / `idempotency_records` の PK）、
どれで落ちたかで返すものが違う。**`src/worker/db/constraint.ts` に `constraintTable(err): string | null` を 1 本置き、
メッセージの形に依存するのはこの関数だけにする**（`ReturnType` は表名。呼び出し側は表名で分岐する）。

| 落ちた制約 | 返すもの |
|---|---|
| `reservations`（予約番号） | 番号を +1 して**最大 5 回まで再試行**。尽きたら 409 `code_exhausted` |
| `walk_ins`（整理番号） | 同じく最大 5 回まで再試行 |
| `idempotency_records`（PK） | 409 `idempotency_conflict`（§6.2） |
| それ以外 | 500 `internal_error`（握りつぶさない） |

この関数には**必ず unit テストを付ける**。D1 のメッセージ形式が変わったときに 409 `slot_taken` や
`code_exhausted` が黙って 500 に化けるので、壊れたことを検知できる場所が 1 か所要る。
枠の競合（`slot_taken`）はこの経路では判定しない — `reservation_slot_locks` は一意 index を張らず、
条件付き INSERT の `meta.changes === 0` で判定する（§3.6 / `03-data-model.md` §7.6）。

`zValidator` が返す 400 は Hono の既定形（`{ success: false, error: { issues: [...] } }`）のままにする。
**入力の型エラーは自前の code に翻訳しない**（実装ごとの揺れを作らないため）。
したがって `Pin` の**書式違反は `weak_pin` にならず** zValidator の 400 になる。`weak_pin` はドメイン層の
追加検査（同一数字・連番）だけが返す。欄の下に出す日本語はフロントが持つ（`05-screen-flow.md` §7.3）。

**単純な PIN（`0000` / `1234` などの連番・ゾロ目）は拒否する。**共有端末をレジ横に置く 4 桁なので、
`weak_pin` は残す。判定は「同一数字の連続」と「±1 の連番」の 2 つだけにする（辞書は持たない）。

**確認番号（`X-Management-Code`）の総当たりは 10 回 / 時（コード × IP）で止める。**
超過は 429 `management_code_locked` ＋ 15 分の待ち。回数は KV `SHORT_LIVED` に
`mgmtfail:<code>:<ip>` のキーで TTL 3600 秒として持つ（失敗時にだけ書く）。

---

## 6. 冪等の掛け方

### 6.1 `Idempotency-Key` を受けるエンドポイント

| エンドポイント | 置き場 | scope | 保持 | 理由 |
|---|---|---|---|---|
| `POST /api/staff/reservations` | **D1 `idempotency_records`** | `reservation.create` | 24 時間 | 二重予約は台帳・お客様の両方に実害が出る。復唱中の再送・BOOK-CONFLICT からの戻りで同じキーが再送される |
| `POST /api/staff/walkins` | **D1** | `walkin.create` | 24 時間 | 券番号の二重採番を防ぐ |
| `POST /api/staff/customers/merge` | **D1** | `customer.merge` | 24 時間 | 「まとめると元に戻せません」（CUSTOMER-MERGE） |
| `POST /api/public/stores/:storeSlug/bookings` | **D1** | `public.booking.create` | 24 時間 | お客様の二度押し・回線断からの再送 |
| `PATCH /api/public/reservations/:code` | **D1** | `public.booking.change` | 24 時間 | 同上 |
| `POST /api/public/reservations/:code/cancel` | **D1** | `public.booking.cancel` | 24 時間 | 同上 |

上記以外は `Idempotency-Key` を**受け取らない**（送られても無視する）。
変更・取消・進捗更新は `version` による楽観ロックで二重適用を防ぐため、冪等キーを重ねない。

### 6.2 D1 `idempotency_records` の使い方

| 列 | 入れる値 |
|---|---|
| `key` | `<organization_id>:<scope>:<Idempotency-Key ヘッダー値>`（PK。テナント名前空間を含めるので他テナントのキーと衝突しない） |
| `organization_id` | JWT の `org`。public 面は slug から解決した org |
| `scope` | 上表の scope |
| `request_hash` | 正規化した JSON body の SHA-256 |
| `response_json` | 成功応答をそのまま |
| `status` | `in_progress` \| `done` |
| `created_at` / `expires_at` | 作成時刻 / +24 時間 |

処理順:

1. `insert ... on conflict do nothing` で `status='in_progress'` の行を作る。
2. **入らなかった（= 既存行がある）**とき:
   - `request_hash` が違う → **409 `idempotency_conflict`**
   - `status='done'` → `response_json` をそのまま返す（**再実行しない**）
   - `status='in_progress'` → **409 `idempotency_conflict`**。クライアントは `Idempotency-Key` を
     作り直して送り直す。中断された `in_progress` を待つ・引き継ぐ経路は作らない
     （D1 に CAS が無く、待ち合わせを安全に実装できないため。道を 1 本に絞る）。
3. 本処理を `db.batch([...])` で実行し、同じ batch で `status='done'` と `response_json` を書く。
   **本処理と done 化を別の文に分けない**（片方だけ成功する窓を作らない）。
4. 本処理が失敗したら `in_progress` の行を削除する（キーを再利用可能にする）。
   **ただし予約番号・整理番号の衝突による再試行は「失敗」に数えない。**採番の衝突は同じキーのまま
   最大 5 回まで番号を振り直して同じバッチを打ち直す経路であり（§5 の制約違反の表）、`in_progress` を消すと
   3 の「同じ batch で `done` を書く」が成り立たなくなる。**`in_progress` を消すのは、5 回尽きた（409 `code_exhausted`）・
   枠が取れなかった（409 `slot_taken`）・版が合わなかった（409 `version_conflict`）・500 で落ちた場合だけ**にする。

`expires_at` を過ぎた行は `POST /api/internal/maintenance/recordings/purge` と同じ保守経路で掃除する。

### 6.3 KV `SHORT_LIVED` に置くもの（D1 に置かないもの）

| 用途 | キー | TTL | 1 日の書き込み見込み |
|---|---|---|---|
| 枠の仮押さえ | `hold:<orgId>:<storeId>:<holdId>` | **420 秒（7 分）** | 押さえ 1 本につき 1 write。**1 予約 3 本**（担当 1 + 設備 2）で、工程の中で選び直すたびに 3 delete + 3 write が増える。3 店舗 × 20 件/日 ×（初回 1 + 選び直し 2）で **540 write/日 + 360 delete/日** |
| PIN の連続失敗回数 | `pin:<orgId>:<terminalId>:<staffId ?? 'shared'>` | 30 秒 | 失敗時のみ 1 write |
| 録音の再生チケット | `play:<orgId>:<token>` | **900 秒** | 再生 1 回につき 1 write |
| Web 予約の短命管理コード | `mgmt:<orgId>:<code>` | 900 秒 | 本人確認 1 回につき 1 write |
| 確認番号の失敗回数 | `mgmtfail:<code>:<ip>` | 3600 秒 | 失敗時のみ 1 write |

**仮の押さえの鍵は上の 1 通りだけにする。**枠（`kind` / `targetId` / `startsAt` / `endsAt` / `receptionSessionId`）は
`KV.put` の第 3 引数 `metadata` に入れる。鍵に `targetId` と `startsAt` を入れる形にすると
`DELETE /api/staff/holds/:holdId` が鍵を作れず、`holdId` だけの鍵で list を使わないと空き枠エンジンが押さえを読めない。
**業務面の空き枠エンジンは `KV.list({ prefix: 'hold:<orgId>:<storeId>:' })` を 1 回だけ叩き、返る metadata をそのまま塞がりに数える**
（`02-domain-model.md` §3.9 / `03-data-model.md` §7.3 もこの形に揃える）。

**仮の押さえの 7 分**は BOOK-05-CONFIRM の statusbar `11:11` と「仮の押さえ → 11:18 まで」の差から取る。

**切れたときに何が起きるか**（この面で確定させる）: 仮の押さえは表示のためだけの仕組みなので、
420 秒を過ぎても**入力は消えず、確定も試せる**。確定の瞬間に枠が空いていればそのまま通り、
埋まっていれば `POST /api/staff/reservations` が 409 `slot_taken` を返して BOOK-CONFLICT へ落ちる。
`holdId` が期限切れでも 404 / 409 にしない（`StaffReservationCreate.holdId` は任意である）。

`[要確認: Q-06 — いまの前提で進める]`（`design/09-open-questions.md`）。いまの前提: 自動ロック 120 秒と個人モードの寿命 120 秒は WCAG 2.2.1 の「必須」例外として免除を主張し（伏せるだけで作業は消えない）、枠の仮押さえは残り時間を画面に出して残り 60 秒で `role="status"` の警告を出し、1 回だけ延ばせるようにする。延長を認めるなら TTL を伸ばす `PATCH /api/staff/holds/:holdId` が 1 本増え、ルート数は 100 から 101 になる。

KV の無料枠は **書き込み 1,000/日・削除 1,000/日・list 1,000/日・読み取り 100,000/日**（いずれか 1 つを超えると
その種類の操作がエラーになる）。**write と delete と list は別枠**である。上の見積り（540 write / 360 delete）は
1 店舗 1 日 **12 件（実績）／余裕を見て 20 件**の予約規模で置いたもので、PIN 失敗・再生チケット・確認番号を足しても
write は 1,000 に収まるが、**選び直しの回数が増えると余裕が無い**。

**list の 1,000/日はこの設計で最初に当たる上限である。**空き枠を計算するたびに `KV.list` を 1 回叩くので、
**公開面（`/api/public/**`）では KV を読まない**と決める — Web 予約のページに 1 日 400 人が来て 1 人 3 回日時を触れば
1,200 list/日になり、上限を越えて空き枠が丸ごと落ちる。お客様に「他の端末が押さえ中」を見せる必要は無く、
一次排他は確定時の D1 が担うので、読まなくても二重予約にはならない。
list を叩くのは業務面（BOOK / CHANGE / 台帳）だけとし、3 店舗 × 3 端末の規模で 1 日 200〜300 回に収める。

**KV に CAS は無い**ので、仮の押さえは排他の一次手段にしない。
`POST /api/staff/holds` は「取れなかった」を判定できない（`get` → 無い → `put` の間に別の端末が同じことをするのを
止める手段が無く、KV は結果整合なので別の colo の押さえが見えないこともある）。よって **`POST /api/staff/holds` は
常に 200 を返し、409 `slot_taken` を返さない**。枠が埋まっていることは確定の瞬間に D1 が返す。
**枠の一次排他は `reservation_slot_locks`（`03-data-model.md` §7.6）の一意 index が担う。**
刻み単位に展開した占有行を予約本体と同じ `db.batch()` で INSERT し、**衝突したらバッチごと失敗する**ので、
そこを捕まえて 409 `slot_taken` を返す。
「同じ `db.batch()` の中で `reservation_assignments` を読み直して判定する」方式は D1 では書けない —
`db.batch()` は全文を投げてから結果をまとめて受け取るため、読んだ結果で分岐して書くことができず、
実際には読み → 判定 → 書きの 2 往復になって、その間に別端末の書き込みが入る窓が空く。
KV は「BOOK-03-SLOT-STAFF〜BOOK-05-CONFIRM の間に別端末が同じ枠を触ったことを早く気づかせる」表示のためだけに使う。
空き枠エンジンは**同じ `reception_session_id` の押さえを塞がりに数えない**
（`AvailabilityQuery` に `excludeReceptionSessionId` を持つ。CHANGE 側の `excludeReservationId` と同じ考え方）。

---

## 7. notifier への同期送信

```
glasses-management ──service binding(NOTIFIER)──▶ notifier POST /api/internal/send
   try/catch で包む・失敗しても予約は残す        ├─ x-internal-key 検証（fail close）
                                                  ├─ KV DEDUPE: organizationId + job.id + payload hash（TTL 24h）
                                                  └─ Resend（tenant namespaced Idempotency-Key）
```

### 7.1 送る場面と job

`packages/contracts/src/notification.ts` の `NotificationJob` は**3 種の discriminated union**で固定されている
（`reservation.confirmed` / `reservation.management_code_issued` / `reservation.management_code_reissued`）。
この面では新しい `type` を足さない（足すなら `notification.ts` 側を増やす別の変更になる）。
payload に置けるキーも `z.strictObject` で固定されている（`reservationId` / `to` / `managementCode` /
`reservationNumber` / `storeName` / `appointmentAt`）。**これ以外のキーを混ぜると notifier 側の parse で落ちる。**
`organizationId` は `notification.ts` 側が **100 文字上限**である（§4.1 の `OrganizationId` は 200 文字）。

| 場面 | `type` | `id`（冪等キーの素） | payload | 根拠 |
|---|---|---|---|---|
| Web 予約が確定した（`requires_approval='0'` で作られた、または `POST /api/staff/web-bookings/:webBookingId/review` の `decision='approve'` を通った） | `reservation.confirmed` | `res-confirmed:<reservationId>:<startsAt>` | `reservationId` / `to`（`web_bookings.contact_email`） / `managementCode` / `reservationNumber`（= `code`） / `storeName` / `appointmentAt` | WEB-06-DONE「確認のメールをお送りしました。」 |
| Web 予約を受け付けて管理コードを発行した | `reservation.management_code_issued` | `mgmt-issued:<reservationId>` | 同上 | WEB-06-DONE の「ご予約番号 EY-W-2608-0031」と WEB-CANCEL の本人確認 |
| 管理コードを出し直した | `reservation.management_code_reissued` | `mgmt-reissued:<reservationId>:<yyyy-mm-dd>` | 同上 | 再送口（画面はモック未描画） |

- `id` に `startsAt` / 日付を混ぜるのは、**日時変更のたびに 1 通だけ送り、同じ日に何度叩いても連打しない**ため
  （KV の 1 write/日の考え方と同じ）。**Web 由来の予約を店舗が変更したときも、この `id` の仕組みで
  `reservation.confirmed` を新しい `startsAt` で送り直す**（`notification.ts` に型を足さずに変更の連絡を賄える）。
  お客様が自分の手元の控えと突き合わせられなくなるので、Web 由来の変更では既定で送る
  （`ReservationChangeInput.notify` の既定は `false` だが、`source='web'` のときはサーバが `true` として扱う）。
- 冪等キーは notifier 側で `organizationId` + `id` から作る tenant namespaced key になる。呼び出し側は
  `organizationId` を必ず入れる。
- **店内予約（`source='phone'` / `'counter'` / `'walkin'`）ではメールを送らない。** CHANGE-DIFF「お電話でのご予約のため、
  メールは送りません。」／CHANGE-DONE「お電話でのご予約のため、メールは送っていません。」に従う。
  BOOK-06-DONE の「控えは 090-1234-5678 へお送りしました。」は**送る手立てが無い**（notifier はメールだけで、
  `to` はメールアドレス型）。実装は送らず、画面の文も「予約番号 EY-2608-0142 をお控えいただくようお伝えください」に直す。
- **取消の `type` は `notification.ts` に無い。**店舗が Web 予約を取り消したときの連絡は、
  型を足すか電話で連絡する運用にするかが未決である（§3.12 の `[要確認]`）。**型を足す判断は人間の承認事項**
  （別サービスの契約変更）なので、決まるまで取消のメールを送らない。

### 7.1.1 メールの件名と本文（この面で確定させる）

`packages/contracts/src/notification.ts` の payload だけでは日本語が決まらず、
実装（`services/notifier/src/index.ts`）が独自に書いた文が唯一の正本になっている。次を正とする。

| `type` | 件名 |
|---|---|
| `reservation.confirmed` | `EYEX {店名}　ご予約を承りました` |
| `reservation.management_code_issued` | `EYEX {店名}　ご予約の確認番号` |
| `reservation.management_code_reissued` | `EYEX {店名}　ご予約の確認番号をお送りし直しました` |

本文（`reservation.confirmed`）:

```
{お名前} 様

EYEX {店名}のご予約を承りました。

ご来店　2026年8月29日（土）11:00
店舗　EYEX 銀座店（銀座4丁目）
ご用件　新しいメガネを作る（約60分）
ご予約番号　EY-W-2608-0031
確認番号　****

ご変更・お取り消しは、ご予約番号と確認番号をお使いください。
https://eyex.jp/w/reservations/EY-W-2608-0031
```

書くときの決め:

| # | 決め | 理由 |
|---|---|---|
| 1 | **`storeName` には必ず `stores.name_public`（お客様に見せる店名）を入れる。`stores.name` を渡さない** | SETTINGS-STORE が「ここを直すと Web予約・確認メール・受付票の 3 か所に同時に反映される」と約束している。店内名がお客様のメールに漏れない |
| 2 | **日時はサーバ側で JST の日本語に整形してから渡す** | `appointmentAt` は `z.string().datetime()` なので、そのまま印字すると `2026-08-29T02:00:00.000Z` が出て 9 時間ずれた時刻を読ませる。payload の型は変えられないので、**notifier 側が JST へ整形して印字する** |
| 3 | **番号は「ご予約番号」と「確認番号」の 2 語だけを使う** | 「管理コード」はモック 68 画面に 0 件の内部語。DB 列（`management_code_hash`）と Zod 名（`managementCode`）は内部名なので変えない |
| 4 | ご予約番号は `web_bookings.public_code`（`EY-W-2608-0031`） | お客様が電話で読み上げる番号と画面の番号を一致させる |
| 5 | ご用件の行を必ず入れる（`visit_purposes.name_public` ＋「（約N分）」） | WEB-05 / 06 / CANCEL が必ず出しており、明細が画面と揃う |
| 6 | ハイフンは半角（U+002D）だけを使う | 電話口で読み上げた番号を打ち込んで当たらなくなるのを防ぐ |

### 7.2 失敗しても予約は残す

```ts
// 予約の D1 書き込みは先に済ませ、ロールバックしない。
let emailed = false
try {
  const res = await c.env.NOTIFIER.fetch('http://notifier/api/internal/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': c.env.INTERNAL_KEY },
    body: JSON.stringify(job),
  })
  const parsed = NotificationResult.safeParse(await res.json())
  emailed = parsed.success && (parsed.data.status === 'sent' || parsed.data.status === 'duplicate')
} catch (err) {
  console.error('notify failed', { reservationId, type: job.type })
}
return c.json(PublicBookingResult.parse({ ...result, emailed }))
```

| notifier の応答 | 呼び出し側の扱い |
|---|---|
| `200 { status: 'sent' }` / `200 { status: 'duplicate' }` | `emailed: true` |
| `409 idempotency_conflict` | `emailed: false` + `console.error`。**予約は成功のまま返す** |
| `409 idempotency_in_progress` | `emailed: false`。**同じ `organizationId` と `id` でそのまま再試行してよい**（次のアクセス時に自然に再送される） |
| `502 send_failed`（`RESEND_API_KEY` / `MAIL_FROM` 未設定を含む） | `emailed: false` + `console.error` |
| binding 不在・例外 | `emailed: false` + `console.error` |

**握りつぶした事実を必ず外に出す**（`docs/testing/TEST_RULE.md` の 4 領域目）:

1. 応答に `emailed: boolean` を含める（`PublicBookingResult`）。
2. **UI フォールバック**: WEB-06-DONE は `emailed=false` のとき「確認のメールをお送りしました。」を出さず、
   **「この画面のご予約番号と確認番号をお控えください。メールはお送りできませんでした。」**を出す。
   `emailed=true` のときも**確認番号は必ず画面に出す**（メールを唯一の受け渡し経路にしない）。
   モックの WEB-06-DONE はご予約番号しか描いていないが、実装は確認番号も出す
   （出さないと、メールが届かなかったお客様は WEB-CANCEL を通れず、自分の予約を二度と変更・取り消しできない）。
3. **再検知**: 送信できなかった `web_bookings` は次に `GET /api/public/reservations/:code` が叩かれたとき、
   および `POST /api/internal/maintenance/web-publications/apply` の実行時に再送を試みる。
   **DLQ・リトライキューは無い前提**で設計する（Queues は採用しない）。

承認待ち（`requires_approval='1'`）とメール送信可否の 4 通りの文言は §3.12 の `[要確認]` で発注元に確かめる。

---

## 8. 読み返しの確認

| 確認 | 結果 |
|---|---|
| 決定ブリーフ §1（binding・secrets）と矛盾しないか | `NOTIFIER` / `SHORT_LIVED` / `RECORDINGS` / `INTERNAL_KEY` / `JWT_SECRET` / `AUTH_DEV_GRANT` を使う。**`ADMIN` binding と `AUTH_PEPPER`（PIN のハッシュに要る）は §2.1 の `[要確認]` が解けたら §1 に足す** |
| 決定ブリーフ §3（テーブル名・カラム）を勝手に変えていないか | この文書からは変えていない。§4.0 (b) で挙げた列は `03-data-model.md` が足し、**表を 5 本（`store_memberships` / `store_blackout_windows` / `store_settings_revision` / `staff_weekly_shifts` / `reservation_slot_locks`）足した**（`store_memberships` はブリーフ §12.4 で確定済み。残る 4 本が新規）。表の追加は規約 10 の人間の追認事項として `03-data-model.md` §16 に載せてある |
| 決定ブリーフ §4（空き枠の 8 条件）を全部使っているか | `AvailabilityReason` の 11 値が 8 条件をすべて覆う |
| 決定ブリーフ §5（画面）を賄えるか | §3 の「使う画面」列で 68 画面のうち API を要する画面をすべて指した。画面 ID は `docs/frontend/mockups/eyex/screens/<ID>.html` の**ファイル名と同じ表記**にした |
| 決定ブリーフ §6（API 面）と矛盾しないか | 一致。`/api/staff/**` / `/api/public/**` / `/api/internal/**` / health / dev token |
| モックに無いことを断定していないか | 断定していない箇所のうち、モックとブリーフから決まるもの・設計判断で決まるものは本文で決めた。**発注元に聞かないと決められない 5 件だけを `[要確認]` として残した**（下表。すべて `design/09-open-questions.md` の問いを指す。新しい問いを足していない） |
| 規約（`docs/api/API_RULE.md`）に反していないか | チェーン／`zValidator` インライン／CORS 無し／`hc<AppType>`／401・403・503 の使い分け／エラー形状を満たす。**`requireRole('admin')` を店長判定に使わない**理由を §2 に明記した |
| 一覧の応答が §1.2 の形に揃っているか | `limit` / `cursor` を取るルートの応答をすべて `{ items, nextCursor, total }` にした（`ReservationList` / `AuditEventList` / `CustomerList` / `ReceptionHistoryList` / `RecordingList` / `AlertList`）。**`OFFSET` を使わない**（`03-data-model.md` §9.1 の顧客一覧も `(kana, id)` の複合カーソルに直した） |
| エラーの日本語が決まっているか | §5 の「画面に出す文」列で 25 コードすべてを埋めた。入力の型エラー（zValidator の 400）の欄下の文だけはフロントが持つ（`05-screen-flow.md` §7.3） |
| 曖昧語が残っていないか | 残っていない。判断はすべて数値・列挙・条件で書いた |

### 残した `[要確認]`（発注元に聞くもの。5 件）

| # | 09 の番号 | 内容 | 置いた節 | いまの前提 |
|---|---|---|---|---|
| 1 | **Q-07** | スタッフのログインと暗証番号の再確認を admin に任せてよいか。最初の JWT をどこで得るか | §2.1 | admin に任せる（`ADMIN` binding と `AUTH_PEPPER` をブリーフ §1 に足す） |
| 2 | **Q-03** | 録音・おまとめ・分析・監査の閲覧を店長だけに絞るか。admin が配る 4 つの閲覧権限をサーバで強制するか | §2.2 | 4 つとも強制する。録音の再生とおまとめは個人モードを必須にする |
| 3 | **Q-10** | お客様の「注意ごと」と設定の変更に店長の承認を挟むか。承認できるのは誰か | §2.2 | 承認は要る（`draft` → 店長が `published`）。依頼はお知らせに 1 件立てる。依頼のボタンは答えが来るまで出さない |
| 4 | **Q-01** | Web 予約が承認待ちの間、お客様に何と伝えるか（完了画面・確認メール・自動取消の連絡）。店舗が取り消した・変更したときに連絡するか | §3.12 / §7.2 | 完了画面を「ご予約を承りました」に変え、確定のメールを送る。変更は `reservation.confirmed` の送り直しで賄う。**取消のメールは送らない**（型が無い） |
| 5 | **Q-06** | 接客の途中で時間切れになってよいものはどれか（仮押さえ 420 秒ほか 5 つ） | §6.3 | 自動ロックと個人モードは免除を主張。仮押さえは残り 60 秒で警告し 1 回だけ延ばせるようにする |

（#5 を採ると `PATCH /api/staff/holds/:holdId` が 1 本増え、ルート数は 100 から 101 になる。それ以外の 4 件はルート数を変えない。）

**この面で決着させたもの**（人間の追認は要るが、実装は止めない）:

| 論点 | 決めた内容 |
|---|---|
| 保守 2 本の定期実行 | `glasses-management` に Cron 枠 1 本を割り当て、日次処理をすべてこの 1 本に乗せる（アカウント 5 本のうち**現時点の使用は 0 本**なので、これが 1 本目。`wrangler.jsonc` の `triggers.crons` と `scheduled` ハンドラを足すのは、Cron を最初に必要とするフェーズの TASKS） |
| `StorePermission` の保存先 | `store_memberships`（`03-data-model.md` §3.2） |
| 勤務時間の保存 | 曜日パターンを `staff_weekly_shifts` に保存し、62 日先まで展開。窓は日次 Cron が送る |
| 来店進捗の stage | `handover` を足して 8 値。`left` は退店 |
| 予約の出どころ | `counter`（店頭）を足して 4 値 |
| 予約番号 | `reservations.code` は `EY-YYMM-NNNN` の 1 書式。Web の対客番号は `web_bookings.public_code`（`EY-W-YYMM-NNNN`） |
| 台帳・一覧の目的名 | `visit_purposes.name_short` を足し、帯と一覧はこれを連結する |
| 設定サイドバーの 4 項目 | 行ごと出さない（分析の 3 タブは作る） |
| 分析の目安 3 つ | 全店共通の固定値。設定画面を作らない |
| Web 公開対象の判定 | `is_web_published` 単独。公開は 5 件 |
| 単純な PIN | 拒否する（`weak_pin` を残す） |
| 確認番号の総当たり | 10 回 / 時（コード × IP）。超過は 429 と 15 分の待ち |
| 再生チケットの寿命 | 900 秒（300 秒では 6分12秒の録音を聞き通せない） |
| 録音の形式 | `audio/mp4`（AAC 32kbps モノラル）を既定にする |
| 再認証のパス | `POST /api/staff/terminals/:terminalId/elevate`（昇格の対象が端末セッションであることを名前に出す） |
| 枠の一次排他 | `reservation_slot_locks` への**上限つき条件付き INSERT**（`db.batch()` の中で読んで判定する方式は D1 では書けない）。一意 index は `capacity` / `max_parallel_reservations` / 担当未定レーンの上限を 1 に潰すので張らない |
| 版の競合の見方 | 版の条件を `db.batch()` の全文に配り、版を +1 する文を最後に置く。0 行の `UPDATE` はバッチを止めないため（D1 実測） |
| 仮の押さえの鍵 | `hold:<orgId>:<storeId>:<holdId>` の 1 通り。枠は `metadata` に持たせ、業務面だけが `KV.list` で読む（公開面では KV を読まない。list は 1,000 回/日） |
| 組織同期の同一 revision | 届いた内容で upsert して 200（409 を返すと admin が 502 になる）。`sync_revision_conflict` というコードは作らない |
| 台帳・空き枠の軸 | `axis` の値は `staff` / `resource`、台帳の絞り込みは `all` / `upcoming` / `pending`（`05-screen-flow.md` §3 のクエリ表が正） |
| お客様番号 | `customers.customer_number`（`code` という列名にしない） |
| お知らせの語彙 | `AlertCode` は 10 値、`alerts.audience`（`store` / `ops`）で運用のアラートを ALERTS から外す |
| Web 予約の自動取消 | 起算日は**受信日**（`web_bookings.created_at` の JST 暦日）の 24:00 JST |
| Web 予約の変更締切 | `web_booking_settings.change_deadline_days`（既定 1）日前の 23:59:59.999 JST |
| 確認メールの日本語 | §7.1.1 で件名 3 種と本文を確定。`storeName` は `stores.name_public`、日時は JST へ整形、番号は「ご予約番号」「確認番号」の 2 語 |
