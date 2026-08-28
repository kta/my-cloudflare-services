# 003-user-administration: 利用者・標準ロール・担当店舗の管理と個人PIN

- サービス: `admin`
- ステータス: Approved

<!-- EYEX ドメインを 0 から作り直すにあたり、旧 spec
     `specs/glasses_management/features/002-eyex-reservation-product` を削除した。
     そこで定義していた 2 件は admin が所有する業務なので、ここへ移した。
     E2E は `services/admin/e2e/user-administration.spec.ts` にある。 -->

## 1. WHAT / WHY

**概要**: admin は利用者・標準ロール・担当店舗の正本である。運営／本部の管理者がそれらを一覧・変更でき、
スタッフ本人は個人 PIN を自分で設定・変更できる。PIN そのものは誰にも見えない。

**ユーザーストーリー**:

- US-ADMIN-USERS-01: 本部管理者として、利用者の標準ロールと担当店舗を、変更前後の権限差分を見てから変えたい。
- US-ADMIN-USERS-02: スタッフとして、自分の PIN を自分で決め直したい。管理者にも見えないでほしい。

**ユースケース**:

- UC-ADMIN-USERS-01: 本部管理者は利用者、標準ロール、担当店舗を一覧・検索し、権限差分を確認して変更できる。
- UC-ADMIN-USERS-02: スタッフは個人PINを設定・変更でき、管理者は本人確認後にPIN再設定を開始できるがPINそのものは閲覧できない。

**スコープ外**: 店舗そのものの登録（`glasses_management` が所有）、店舗業務の権限判定（配られた membership を
ドメイン側が解釈する）。

**不明点**: なし

## 2. HOW

**触るファイル**:

- `packages/contracts/src/auth.ts` — `AdminUserQuery` / `AdminUserView` / `UserAssignmentUpdate` /
  `StandardRole` / `AdministrablePermission` / `PinResetStartRequest` / `SetOwnPinRequest`
- `services/admin/src/worker/users/service.ts` / `services/admin/src/worker/index.ts`
- `services/admin/src/web/routes/Users.tsx`
- `services/admin/src/worker/sync.ts` — 結果の membership を `glasses_management` へ配る

**データモデル差分**: なし（既存の `users` / `user_store_assignments` を使う）。

**却下した代替案**:

- ドメイン側に利用者を持たせる: 認証の正本が 2 つになるため却下。
- 担当解除で行を消す: 削除専用の同期経路が要るため却下。permissions を空にして配る。

## 3. TASKS

- [x] T-001: 権限差分・PIN 再設定の失敗テストを書く。
- [x] T-002: 実装する。
- [x] T-003: `services/admin/e2e/user-administration.spec.ts` に `@e2e-covers` を付ける。
