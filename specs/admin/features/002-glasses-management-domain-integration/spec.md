# 002-glasses-management-domain-integration: EYEXドメイン連携

- ステータス: Approved

## 1. WHAT / WHY

**概要**: `admin` を認証・組織の正として維持し、EYEXの `glasses_management` へ安全に組織状態を同期する。

**ユーザーストーリー**:

- US-ADMIN-INTEGRATION-01: 運営者として、組織の作成・変更・無効化がEYEXドメインへ安全に反映されてほしい。
- US-ADMIN-INTEGRATION-02: 運営者として、同期失敗後も正本を失わず、同じ組織を再同期したい。
- US-ADMIN-INTEGRATION-03: ドメインWorkerとして、認証情報を複製せずadminへ内部的にログイン・更新を委譲したい。

**受け入れ基準**:

- Given 組織の更新・無効化が並行する, When 同期の到着順が逆転する, Then より古い状態で無効化済み組織を再有効化しない。
- Given 組織同期が失敗する, When 運営adminが再同期を実行する, Then adminの正本を保持したまま同じスナップショットを再送する。
- Given domain Workerの内部リクエスト, When 正しい内部鍵でログインまたは更新を委譲する, Then refresh tokenは内部レスポンスだけに返りadminのcookieを変更しない。

**スコープ外**: notifierのメール配送本体、EYEX予約・店舗データの所有、Cloudflare実リソースのプロビジョニング。

## 2. HOW

**触るファイル**: `services/admin/src/worker/{index,sync,domain-auth}.ts`、admin D1 migration/schema、`packages/contracts`、`services/glasses_management` の内部組織同期契約・migration、両サービスのテストとWrangler binding。

**契約**: `OrganizationSync` はcanonical organization ID、単調増加`revision`、組織状態を持つ。internal domain-authは既存の`LoginRequest`/`RefreshRequest`を使用する。

**データモデル差分**: adminとdomain同期コピーに`sync_revision`を持つ。domainは新しいrevisionだけを受理する。

**却下した代替案**:

- domainがadmin D1を直接参照する: cross-D1境界を破るため却下。
- 到着順をservice bindingに委ねる: 無効化の逆転を防げないため却下。

## 3. TASKS

- [x] T-001: 同期順序逆転・再同期・内部鍵境界の失敗テストを追加する。
- [x] T-002: revision付き組織同期、再同期endpoint、domain-auth proxyを実装する。
- [x] T-003: 既存組織IDとの互換、migration、権限・テナント分離テストを追加する。
- [ ] T-004: Cloudflare実リソースをprovisionし、実IDとsecretsを設定した後に手動deployを実行する（外部操作）。
