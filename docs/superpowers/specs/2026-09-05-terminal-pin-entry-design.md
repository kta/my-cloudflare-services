# 業務端末の入口を PIN だけにする（dev グラントの撤去）

- 日付: 2026-09-05
- サービス: `glasses_management`
- 状態: Draft（人のレビュー待ち）
- 関連: `specs/glasses_management/design/05-screen-flow.md` §5 Q-07 / `features/003-service-foundation` / `features/013-terminals-and-audit`

## 1. なぜ

業務開始の入口が、いまも開発用の抜け道の上に立っている。

`App.tsx` の `StartWork` は「お店のコード」を 1 行受け取り、`POST /api/auth/token`
（`AUTH_DEV_GRANT === 'true'` のときだけ生きる dev グラント）でトークンを取る。この経路は
知らない組織にもトークンを出すため、**本番では有効にできない**。したがって
`glasses_management` は現状、production へ出しても誰も業務を始められない。

いっぽうサーバ側の実運用の認証は**すでに揃っている**。`/api/auth/login` は admin の
`/api/internal/domain-auth/login` へ委譲し、refresh を HttpOnly Cookie
（`SameSite=Strict`・`path=/api/auth`）へ移す。レート制限とロックアウトも admin にある。
`05-screen-flow.md` §5 の Q-07（「最初のトークンをどこで得るか」）も
「admin に任せる」で決着している。

**足りないのは SPA の入口 1 枚だけ**である。ただし、そこを email + パスワードの
ログイン画面にすることは、この業務では成立しない（§2）。

## 2. 制約（発注元の決定）

1. **日常の業務開始は PIN のみ。** パスワードを打つ場面を作らない。
   共有タブレットが現場にあり、「パスワードを知っている人（店長）を呼ぶ」が必要になる設計は
   運用が止まる。
2. **初回登録も、長期放置からの復帰も PIN のみ。** パスワードは端末の導線に一切出さない。
3. **どの会社のどの端末かは URL が運ぶ。** 人が打つのは PIN だけ。
4. **未認証で見えてよいのは店名と置き場所の名前まで。** スタッフの氏名・勤務・在席は
   PIN を通したあとにしか出さない。
5. トークンは**組織スコープのまま**。店舗の切り替えは従来どおりアプリ内の選択で行う
   （`05-screen-flow.md` の LOGIN-SHARED「別の店舗」を残す）。

これらは受け入れ済みの決定であり、本設計はこの上に立つ。

### 2.1 代償（明記して受け入れる）

**4〜6 桁の PIN が、公開オリジンにおける唯一の資格情報になる。** URL を知られた時点で
総当たりの的になる。既存の「3 回で 30 秒」だけでは、4 桁 10,000 通りに対して
約 3.5 日で尽きる。したがって**総当たり対策は本設計の一部**であり、あとから足す
機能ではない（§6）。

## 3. 全体像

```
/w/:storeSlug   お客様の Web 予約（既存・未認証）
/s/:storeSlug   業務端末の入口（新規・未認証）      ← 追加
/               業務画面（認証後）
```

`stores.slug` は**全組織横断で一意**である（`schema.ts` の `stores_slug_idx`。
「`/api/public/**` は未認証で `organization_id` を持たないので slug 単独で引く」ため
そう設計されている）。この性質にそのまま乗る。`main.tsx` は `react-router` を持たず
`/w/` の前置きだけで振り分けているので、`/s/` を 1 本足す。

`/s/ginza` を iPad のホーム画面に置く。新しい端末を足すときも、初期化から戻すときも、
同じ URL を開くだけでよい。

### 3.1 責務の線

| 誰が | 何の認証を持つか |
|---|---|
| `admin` | **人**の認証。email + パスワード、個人 PIN（`users.pin_hash`）、refresh の正本 |
| `glasses_management` | **端末**の認証。共有 PIN（`terminals.pin_hash`）と端末セッション |

CLAUDE.md の「admin が認証源泉」は**人の認証**を指していた。端末の認証を
`glasses_management` が持つことは、この文書で明文化する新しい取り決めである
（ルール 10 の人間承認事項。承認済み）。

端末 PIN を admin へ移す案は採らない。`terminals` は店舗・置き場所・自動ロック秒と
一体のドメインの実体であり、認証の都合でドメイン分離（ルール 8）を曲げることになるため。

## 4. API

### 4.1 追加

```
GET  /api/public/sites/:storeSlug
POST /api/public/sites/:storeSlug/terminals/:terminalId/sessions
POST /api/public/sites/:storeSlug/terminals/:terminalId/sessions/refresh
```

**`GET /api/public/sites/:storeSlug`**

```jsonc
{
  "store": { "slug": "ginza", "name": "EYE 銀座店" },
  "terminals": [
    { "id": "…", "name": "レジ横iPad", "placeNote": "レジの右側", "kind": "shared" }
  ]
}
```

既存の `GET /api/public/stores/:storeSlug` は**流用しない**。あちらは `isPublished` で
404 を返す（Web 予約の公開状態）。Web 予約を公開していない店でも iPad は動く必要がある。

出さないもの: スタッフの氏名・勤務・在席（制約 4）。`is_active = '0'` の端末。
`pin_hash IS NULL` の端末（押しても入れない行き先を出さないため）。

**`POST …/sessions`** — body は **`{ pin }` だけ**。`mode` と `staffId` は受け取らない
（理由は §4.1.1）。既存の認証ありルートが使う `TerminalSessionStart` とは別の契約
`PublicTerminalSessionStart = z.strictObject({ pin: Pin })` を足す。

現行の `POST /api/staff/terminals/:terminalId/sessions` と**同じ検証・監査・
セッション生成をそのまま使う**。違いは 2 つだけ:

1. `org` を JWT ではなく `storeSlug` から解決する
2. 成功時に、端末セッションに加えて **access JWT（15 分）と refresh Cookie** を返す

実装は現行ハンドラの本体を純粋な関数へ括り出し、認証あり／なしの 2 ルートが
それを共有する。ロジックを二重に書かない。

### 4.1.1 個人端末で PIN を 2 回にしない

素直に組むと、個人端末は「端末 PIN → スタッフ選択 → 個人 PIN」で **PIN が 2 回**になる。
今日の AC-TERM-03 は 1 回であり、増やす理由が無い。スタッフ一覧を未認証で出せない
（制約 4）ことが原因なので、**個人端末は 1 人に紐づける**ことで解く。

`terminals` に `staff_id`（NULL 可、`kind = 'personal'` のとき必須）を足す。

- **共有端末**: 置き場所を選ぶ → `terminals.pin_hash` で照合 → 共有モードで開始（PIN 1 回）
- **個人端末**: その端末を選ぶ → `staff.pin_hash`（紐づくスタッフ）で照合 → 個人モードで開始（PIN 1 回）

「個人の端末」とは特定の人が持ち歩く iPad のことなので、setup のときに人が決まるのは
概念とも合う。未認証の一覧に出るのは**店長が付けた端末名**だけで、こちらから
`staff.display_name` を join して出すことはしない（店長が「佐藤 美咲の iPad」と
名付けるかどうかは店長の判断であり、こちらが漏らすのとは違う）。

`POST …/sessions` の body から `staffId` は**受け取らない**。個人端末の staff は
サーバが `terminals.staff_id` から引く。クライアントに名乗らせると、staffId を
差し替えて他人の PIN を試す経路になる。

`mode` も body から受け取らず、`terminals.kind` から決める。

### 4.2 撤去

- `POST /api/auth/token`（dev グラント）を**削除する**
- `Bindings` から `AUTH_DEV_GRANT` を削除する
- CI の staging 向け `AUTH_DEV_GRANT=true` 同期を削除する
- `deploy` / `deploy-eye-stack` の「production に残っていないこと」の検査は**残す**
  （過去に入った残骸を拾うため。名前が消えても検査は意味を持つ）

`/api/auth/login` と `/api/auth/refresh`（admin 委譲）は**残す**。admin の管理画面から
人がドメインを覗く経路として使う。

## 5. 資格情報

### 5.1 いま何本あるか

既に 2 系統ある。

| 資格情報 | 出どころ | 置き場所 | 寿命 |
|---|---|---|---|
| access JWT | dev グラント（撤去対象） | `sessionStorage` | 15 分 |
| 端末セッション | `POST …/sessions` | `sessionStorage` | 共有は業務日いっぱい／個人は `auto_lock_seconds` |

### 5.2 変更後

| 資格情報 | 出どころ | 置き場所 | 寿命 |
|---|---|---|---|
| access JWT | PIN 照合の成功 | **メモリ**（`sessionStorage` をやめる） | 15 分 |
| 端末 refresh | PIN 照合の成功 | HttpOnly Cookie（`SameSite=Strict`・`path=/api/public/sites`） | 30 日・使うたびローテーション |
| 端末セッション | 同上 | `sessionStorage`（現状のまま） | 現状のまま |

`sessionStorage` から access JWT を外すのは、タブを閉じても Cookie の refresh で
黙って復帰できるようにするためである（制約 1：PIN を打ち直させない）。

**30 日を超えて放置された端末**は refresh が切れる。そのときは `/s/:slug` の
置き場所選択と PIN へ戻る。パスワードは出ない（制約 2 を満たす）。

### 5.3 危険: JWT_SECRET が全サービス共有で `aud` が無い

`packages/shared/src/jwt.ts` が自ら警告している。

> JWT_SECRET は admin(発行)と各ドメインサービス(検証)で共有され、`aud`/`iss`
> クレームが無いため、1 つの access token は secret を共有する**全サービス**で有効になる。

いままで発行者は admin だけだった。**本設計は glasses を 2 人目の発行者にする**ので、
この注記が現実の危険になる。端末トークンが admin の API でも通る。admin の
default-deny は運営 org の admin ロールを要求するが、`/api/users` `/api/me/*`
`/api/organizations/:id/stores` はその門の外にあり、テナントの本部管理者向けに
開いている。

**対処**: `AuthTokenPayload` に `kind: 'user' | 'terminal'` を足す（省略時は `'user'`
として既存トークンと互換）。admin は `kind === 'terminal'` を全 API で拒む。
これは `packages/contracts` と `packages/shared` に触る変更で、admin・
`example_service`・`patent_research` のテストにも波及する。

## 6. 総当たり対策

既存（維持）: 端末×スタッフ単位で KV に失敗を記録し、**3 回で 30 秒**待たせる
（`pinFailureKey` / `nextFailureState`）。失敗は `terminal.pin.failed` として監査に残る。

追加:

1. **外側の階段**。同じ端末に対する失敗が 30 秒窓を越えて積み上がったとき、
   10 回で 15 分、20 回で 1 時間、以降は倍。KV に `attempts` と `failedAt` を持つ
   既存の形をそのまま使い、閾値の表だけを増やす。
2. **IP 単位の絞り**。`CF-Connecting-IP` ごとに、1 分あたり 10 回・1 時間あたり 60 回。
   店舗の NAT で複数端末が同じ IP を共有するため、端末単位より緩くする。
3. **共有端末の店舗 PIN は 6 桁を既定にする**。4 桁は 10,000 通りで、30 秒待ちだけでは
   約 3.5 日で尽きる。6 桁なら 1,000,000 通りで、上の階段と合わせて実質的に尽きない。
   既存の 4 桁の端末は**そのまま動かす**（`Pin` は 4〜6 桁を受ける）。新規作成の既定と、
   端末一覧の「暗証番号を作り直す」の推奨を 6 桁にする。
4. **`GET /api/public/sites/:storeSlug` にも IP 単位の絞りを掛ける**。slug の総当たりで
   店舗の存在を洗い出されないようにする。存在しない slug は 404 を返す（タイミングを
   揃えるための定数時間化まではしない — 費用に見合わない）。

## 7. 既存仕様の改訂

本設計は Approved の spec を書き換える。SDD の手順どおり、spec を先に直す。

### 7.1 `003-service-foundation`

- **AC-FOUND-01**: 「Given dev トークンで資格情報を受け取っている」→
  「Given 置き場所を選んで暗証番号で業務を始めている」に改める。
- **AC-FOUND-03**: 「業務開始の画面でお店のコードを入れた」が前提そのもの。
  お店のコードの画面は無くなるので、**この AC は 014-store-provisioning へ移す**
  （店舗 0 件の会社が最初の店舗を登録する話は残る。入口が変わるだけ）。
- 「実運用の認証（いまは dev トークングラント）」を Non-goals から外す。

### 7.2 `013-terminals-and-audit`

- **AC-TERM-02**（個人の端末で業務を始めるスタッフを選ぶ）: **削除する。**
  個人端末は 1 人に紐づく（§4.1.1）ので、業務開始時に選ぶ相手がいない。
  「休みの人は押せず『本日休み』と示す」の担保先は、`013` の端末一覧（AC-TERM-16）で
  個人端末に人を割り当てる面へ移す。UC-TERM-02 もそれに合わせて書き換える。
- **AC-TERM-03**（個人端末で 3 桁では確定できず 4 桁で押せる）: Given を
  「`/s/ginza` で『佐藤 美咲の iPad』を選んだ」に改める。PIN が 1 回であることは変わらない。
- **AC-TERM-01 / 04 / 05**: `/start` の手前に `/s/:slug` の置き場所選択が入るので、
  Given を「`/s/ginza` を開いている」に揃える。
- **AC-TERM-16**（端末の一覧）: 個人端末に**担当するスタッフを割り当てる**操作を足す。
  割り当てのないまま `kind='personal'` にはできない。
- 新規 AC を 3 本足す:
  - **AC-TERM-23**: 未認証で `/s/ginza` を開くと、店名と置き場所の名前は読めるが、
    スタッフの氏名・勤務・在席はどこにも出ない。
  - **AC-TERM-24**: 30 日を超えて使われなかった端末で PIN を入れると、
    パスワードを求められることなく業務が始まる。
  - **AC-TERM-25**: 同じ端末に対して 10 回続けて PIN を間違えると、
    残り時間が分で示され、その間は正しい PIN でも業務が始まらない。

### 7.3 traceability

`pnpm run test:traceability` は Approved な UC/AC がちょうど 1 本の E2E に対応することを
要求する。改訂した AC の E2E を付け替え、新規 3 本には新しい E2E を書く。

## 8. テスト

`CLAUDE.md`「テストの厚み」の 4 領域すべてに当たるので、境界値まで書く。

**時刻・期限**（`*.time.test.ts`）:
- refresh の 30 日ちょうど・±1 秒
- access の 15 分ちょうど・±1 秒
- PIN ロックの 30 秒・15 分・1 時間の各境界（`TEST_NOW` で注入。`Date.now()` に依存しない）
- 共有セッションの業務日いっぱいと JST 日跨ぎ

**権限**（`permissions.test.ts`）:
- 新ルート 3 本を表に足す。未認証で入れるのはこの 3 本だけであることを、
  未知パスを含む default-deny の証明として押さえる
- `kind: 'terminal'` のトークンが admin の全 API で拒まれること（admin 側の表に足す）

**テナント分離**（`tenant-isolation.test.ts`）:
- 別組織の `storeSlug` で別組織の `terminalId` を指しても入れないこと
- slug と terminalId の組が食い違うとき 404 になること（存在の有無を漏らさない）
- 発行された access JWT の `org` が、slug から引いた組織と一致すること
  （クライアントの入力が `org` に混ざらないことの証明）
- `kind='personal'` の端末で、body に他人の `staffId` を混ぜると **400 で弾かれる**こと
  （`z.strictObject` は未知のキーを拒む。無視ではなく拒否であることを明示的に押さえる）
- 同じ端末・同じ PIN でも、紐づくスタッフが差し替わったら別人として監査に残ること

**失敗時のフォールバック**:
- KV が落ちているときに PIN 照合が**通らない**こと（fail close）。
  絞りが効かない状態で認証を通すのは、絞りが無いのと同じである

**E2E**: 改訂 AC の付け替えと新規 3 本。

## 9. やらないこと

- 店舗スコープのトークン（制約 5 で組織スコープのまま）
- admin からの端末登録コード発行（パスワードを消すのが目的であり、別の秘密を
  現場に運ぶ仕組みを増やさない）
- `aud`/`iss` の全面導入。`kind` クレーム 1 つで今回の危険は塞げる。secret の分離は
  別タスクとして残す（`jwt.ts` の注記もそう書いている）

## 10. 移行

1. `kind` クレームを足す（既存トークンは省略時 `'user'` で通る）
2. `terminals.staff_id` のマイグレーション（NULL 可で足す）。既存の `kind='personal'` の
   端末は割り当て待ちになる。**seed の個人端末には割り当てを入れる**
3. 公開ルート 3 本を足す
4. SPA に `/s/:slug` を足す
5. dev グラントを削除し、CI から `AUTH_DEV_GRANT` の同期を外す
6. staging の Worker から `AUTH_DEV_GRANT` の secret を消す

1〜4 は後方互換なので順に出せる。5 は 4 が出たあとでなければ staging が止まる。

`staff_id` は NULL 可で足すので、既存行のマイグレーションは要らない。ただし
`kind='personal'` かつ `staff_id IS NULL` の端末は `/s/:slug` の一覧に出さない
（押しても入れない行き先を出さない、と同じ理由）。店長が端末一覧から割り当てるまで、
その端末は使えない状態になる。**これは既存環境で個人端末が一時的に使えなくなることを
意味する**ので、リリースノートに書く。

ただし今回はその被害が無いことを実測で確認した（2026-09-05）。

- `glasses_management_staging`: `terminals` は `shared` が 3 行のみ。`personal` は 0 行
- `glasses_management`（production, `cece3df4-…`）: **テーブルがまだ無い**
  （`no such table: terminals`）。初回デプロイのマイグレーションが未実行

つまり移行の対象となる `kind='personal'` の行は、どの環境にも存在しない。
本番初回デプロイより前にこの変更を出せば、移行そのものが発生しない。
