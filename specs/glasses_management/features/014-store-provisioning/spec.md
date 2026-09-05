# 014-store-provisioning: 会社を作ってから使い始めるまで

- サービス: `glasses_management` / `admin`
- ステータス: Approved

## 1. WHAT / WHY

**概要**: 新しい会社が admin で作られた直後から、**その会社の管理者が自分で最初の店舗を作り、
そのまま予約を受けられる**ようにする。今は店舗を作る手段が無く、`stores` に行が入る経路は
開発用 seed だけである。店舗の設定は担当店舗の権限で守られ、その権限は店舗が無いと持てないため、
新しい会社は永久に始められない。この鶏と卵を切り、作った直後に空き枠が出るところまでを揃える。

**ユーザーストーリー**:

- US-PROV-01: 会社の管理者として、運営に頼まずに自分で最初のお店を登録したい。登録できないと何も始められないため。
- US-PROV-02: 会社の管理者として、お店を登録したらそのまま設定を続けたい。登録した本人が入れないのでは意味がないため。
- US-PROV-03: 会社の管理者として、登録した直後にご予約を受けられる状態でいたい。営業時間も目的も空では、お客様に何も出せないため。
- US-PROV-04: 会社の管理者として、お客様向けページの合い言葉を自分で決めたい。お客様に伝える URL になるため。
- US-PROV-05: 運営として、会社の店舗を一覧から選んで担当を割り当てたい。今は店舗の ID を手で打つしかなく、打ち間違いに気づけないため。
- US-PROV-06: 会社の管理者として、店員が勝手にお店を増やせないようにしたい。お店は会社の輪郭そのものであるため。

**ユースケース**:

- UC-PROV-01: 会社の管理者は、店舗が 1 つも無い状態から最初のお店を登録できる。
- UC-PROV-02: 会社の管理者は、2 店舗目以降も同じ導線からお店を増やせる。
- UC-PROV-03: 会社の管理者は、お店を登録するときにお客様向けページの合い言葉を自分で決められる。
- UC-PROV-04: お店を登録した人は、そのまま同じお店の設定を続けられる。
- UC-PROV-05: 登録した直後のお店には営業時間・予約の間隔・ご来店の目的が入っており、すぐに空き枠が出る。
- UC-PROV-06: 運営は admin から会社のお店の一覧を見て、担当店舗を選んで割り当てられる。
- UC-PROV-07: 会社の管理者でない店員は、お店を登録できない。
- UC-PROV-08: 既に使われている合い言葉は断られ、別の合い言葉を選び直せる。
- UC-PROV-09: 他社のお店は見えず、他社を騙ってお店を作ることもできない。
- UC-PROV-10: お店を登録した記録は監査に残る。

**受け入れ基準**:

- AC-PROV-01: Given お店が 1 つも無い会社の管理者 When 業務を始める Then 最初のお店を登録する面が立ち、押しても何も起きない業務の行き先は並ばない。
- AC-PROV-02: Given 最初のお店を登録する面 When 店名だけを入れて登録する Then 会社のコードが合い言葉になったお店が作られ、業務画面へ入れる。
- AC-PROV-03: Given 既にお店が 1 つある会社の管理者 When 業務画面からお店を追加する Then 合い言葉の既定に連番が付き、一覧が 2 件になる。
- AC-PROV-04: Given 既に使われている合い言葉 When 登録する Then 断られ、「この合い言葉は使われています」と読める文言が出る。
- AC-PROV-05: Given 大文字や記号を含む合い言葉 When 登録する Then 断られ、使える文字が読める文言で示される。
- AC-PROV-06: Given お店を登録した直後 When 営業時間の面を開く Then 月曜から土曜が 10:00-19:00、日曜が定休として入っている。
- AC-PROV-07: Given お店を登録した直後 When 予約の間隔の面を開く Then 刻み 30 分・片付け 10 分・同時 3 件が入っている。
- AC-PROV-08: Given お店を登録した直後 When ご来店の目的の面を開く Then 3 件の目的が入っている。
- AC-PROV-09: Given お店を登録した直後 When 空き枠を見る Then その日の枠が出る。
- AC-PROV-10: Given お店を登録した本人 When そのお店の設定を保存する Then 保存できる。
- AC-PROV-11: Given 会社の管理者でない店員 When お店を登録する Then 断られ、お店は増えない。
- AC-PROV-12: Given 別の会社が使っている合い言葉 When 登録する Then 断られる。
- AC-PROV-13: Given 会社 A の管理者 When お店の一覧を見る Then 会社 B のお店は出ない。
- AC-PROV-14: Given 本文に他社の会社 ID を入れた登録 When 登録する Then 自分の会社に作られ、他社には作られない。
- AC-PROV-15: Given 運営の管理者 When 会社のお店の一覧を求める Then ドメインへその会社を指定して尋ね、ドメインが応えられないときは内部の様子を漏らさずに断る。
- AC-PROV-16: Given お店の一覧を読み込めないとき When 権限と担当店舗を保存する Then 保存は止まらず、いまの担当がそのまま送られる。
- AC-PROV-17: Given お店の登録が成功した後 When 監査を見る Then お店を作った記録が残っている。
- AC-PROV-18: Given 停止された会社の管理者 When お店を登録する Then 断られる。

**スコープ外**:

- 会社そのものの作成（admin に既にある）。
- 店舗の削除。停止は既存の `isActive` で行う。
- 端末と PIN の初期化（既存の端末の面で行う）。
- 店員の一括取り込み。1 人ずつ登録する既存の面を使う。

## 2. HOW

**触るファイル**:

| ファイル | 変更 |
|---|---|
| `packages/contracts/src/glasses_management.ts` | `StoreInput` / `StoreSlugTakenError` を足す |
| `packages/contracts/src/index.ts` | 上を re-export |
| `services/glasses_management/src/worker/index.ts` | `POST /api/staff/stores` / `GET /api/internal/stores` |
| `services/glasses_management/src/worker/store-provisioning.ts` | 既定値の定義と組み立て（新規） |
| `services/glasses_management/src/web/setup/parts.tsx` | 骨格（AdminLTE の content-header / box / small-box をトークンへ翻訳） |
| `services/glasses_management/src/web/setup/StoreForm.tsx` | 登録の入力（新規） |
| `services/glasses_management/src/web/setup/SetupScreen.tsx` | 0 件の会社が最初に見る面（新規） |
| `services/glasses_management/src/web/setup/SetupProgress.tsx` | 足りないものがある間だけ出す案内（新規） |
| `services/admin/src/worker/index.ts` | `GET /api/organizations/:id/stores`（domain へ service binding） |
| `services/admin/src/web/routes/Users.tsx` | 担当店舗を手打ちから一覧選択へ |

**契約**:

```ts
// 登録の入力。organizationId は JWT から取るので受け取らない。
export const StoreInput = z.strictObject({
  name: z.string().trim().min(1).max(60),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  phone: z.string().trim().max(30).default(''),
  address: z.string().trim().max(200).default(''),
  accessNote: z.string().trim().max(200).default(''),
})

// 合い言葉の重複。どの会社が使っているかは明かさない。
export const StoreSlugTakenError = z.strictObject({
  error: z.literal('store_slug_taken'),
  slug: z.string(),
})
```

**認可**: `POST /api/staff/stores` は JWT の `role === 'admin'` を要求し、`store_memberships` は
見ない。店舗が無い会社では membership を持ちようがないため、ここだけ会社のロールで判断する。
成功時、作成者に全 `StorePermission` を持つ membership を同じ `db.batch()` で作る。

**既知の限界**: `STANDARD_ROLE_BASE_ROLE` は `head_office_admin` と `store_manager` の両方に
JWT の `admin` を与えるため、**店舗管理者もお店を登録できる**。ドメインは標準ロールを持たない
（正本は admin にある）ので、本部管理者だけに絞るには admin から標準ロールを配る仕組みが要る。
増やせるのは自社のお店だけで、既存の他店舗への権限は増えないため、当面はこの広さで運用する。

**データモデル差分**: なし（既存テーブルに行を足すだけ）。

**既定値**（`store-provisioning.ts` に定数として置く）:

| 何を | 値 | 根拠 |
|---|---|---|
| 営業時間 | 月〜土 10:00-19:00、日 定休 | 既存 seed（EYE 銀座）と同じ形 |
| 予約の間隔 | 刻み 30 分 / 片付け 10 分 / 同時 3 件 | 同上 |
| ご来店の目的 | メガネを新しく作る(60分) / 調整・修理(20分) / その他のご相談(30分) | 同上の 3 件に相当する最小構成 |

**却下した代替案**:

- 会社の作成時に「本店」を自動生成する — 使わない店舗が必ず 1 つ残り、合い言葉を機械が採番することになる。
- 運営（admin）が代行して店舗を作る — 店舗を増やすたびに運営への依頼が要る。
- 合い言葉を会社名で前置きして一意にする — URL が長くなり、会社名を外に漏らす。
- 既定値を入れない — 新しい会社が真っ白な画面から始まり、何を埋めれば動くのか分からない。

## 3. TASKS

- [x] 契約に `StoreInput` / `StoreSlugTakenError` を足すテストを書く
- [x] 契約を実装する
- [x] 既定値の組み立て（`store-provisioning.ts`）の unit テストを書く
- [x] 既定値の組み立てを実装する
- [x] `POST /api/staff/stores` の integration テストを書く（成功・重複・不正な合い言葉・権限・テナント分離）
- [x] `POST /api/staff/stores` を実装する
- [x] `GET /api/internal/stores` のテストを書く
- [x] `GET /api/internal/stores` を実装する
- [x] admin の `GET /api/organizations/:id/stores` のテストを書く
- [x] admin の同エンドポイントを実装する
- [x] 登録フォーム（web）のテストを書く
- [x] 登録フォームを実装する
- [x] 0 件のときの導線のテストを書く
- [x] 0 件のときの導線を実装する
- [x] admin の担当店舗を一覧選択にするテストを書く
- [x] admin の担当店舗の一覧選択を実装する
- [x] E2E を UC/AC に 1 対 1 で書く
- [x] `pnpm check` を緑にし、ステータスを Approved に上げる
