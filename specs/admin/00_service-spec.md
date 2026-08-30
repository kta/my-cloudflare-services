# サービス仕様: admin

- パッケージ: `services/admin` (`@app/admin`) + `services/admin (src/web)` (`@app/admin`)
- 所有 D1: `admin`
- ステータス: Approved

## 目的・責務
**organizations の源泉**（source of truth）+ **認証の源泉**。組織の作成・一覧・無効化と、login / refresh / 招待のフルフローを持ち、単調増加 revision 付きの canonical org snapshot を他サービスへ同期する。

## エンティティ（所有データ）
| エンティティ | 主な属性 | 備考 |
|---|---|---|
| `organization` | id(非空文字列) / name / plan / is_disabled / is_operator / sync_revision / created_at | 源泉。他サービスへ同期コピーされる。更新ごとに revision を増加 |
| `user` | id / organization_id / email / password_hash / role | password_hash は pepper HMAC（`docs/architecture` 参照） |
| `invitation` | id / organization_id / email / token_hash / expires_at / consumed_at | 招待トークンはハッシュのみ保存 |
| `refresh_token` | id / user_id / token_hash / rotated_to / revoked_at | ローテーション + 再利用検知 |
| `auth_event` | organization_id / email / kind / ip | 監査ログ（login_success / login_failure / lockout 等） |

## API 面
| メソッド/パス | 認証 | 概要 |
|---|---|---|
| `GET /api/health` | none | ヘルス |
| `POST /api/auth/login` | none（レートリミット付き） | stretched パスワードで認証、access JWT + refresh cookie |
| `POST /api/auth/refresh` | refresh cookie | ローテーション + 再利用検知 |
| `POST /api/auth/logout` | refresh cookie | 当該セッション revoke |
| `POST /api/auth/accept-invite` | 招待トークン | パスワード設定 + 招待消費 |
| `GET/POST /api/organizations` | **operator-org の admin JWT**（default-deny） | 一覧 / 作成 → glasses_management へ同期 |
| `PATCH/DELETE /api/organizations/:id` | 同上 | plan・無効化の更新（DELETE は無効化）→ revision付き同期 |
| `POST /api/organizations/:id/sync` | 同上 | admin正本の同じ snapshot を明示再同期（revisionは増やさない） |
| `POST /api/organizations/:id/invitations` | 同上 | ユーザー招待（notifier 経由、失敗時はリンク返却） |
| `/api/internal/*` | `x-internal-key` | 照合 Cron 等の内部 API |

`/api/*` は default-deny（`tenantAuth` + `requireRole('admin')` + `requireOperator`。health / auth / internal のみ除外）。

契約: `packages/contracts/src/organization.ts`（`Organization` / `CreateOrganization`）+ `packages/contracts/src/auth.ts`（`LoginRequest` / `InviteRequest` / `AcceptInviteRequest` 等）。

## cross-D1 同期
作成・更新・無効化時に **service binding `GLASSES_MANAGEMENT`** 経由で `glasses_management` の `POST /api/internal/organizations/sync`（internal-key ガード）を呼び、org の同期コピーを revision 条件付き upsert（idempotent）する。cross-D1 JOIN は使わない。失敗しても admin 正本は保持し、運営adminが `POST /api/organizations/:id/sync` で同じ snapshot を再送できる。

## 既知の制約（本番前に必須）
- `INTERNAL_KEY`・`JWT_SECRET`・`AUTH_PEPPER` を `wrangler secret put` で設定（未設定は fail close）。
- `AUTH_DEV_GRANT` は本番に**設定しない**（dev トークングラントは未設定 = 無効）。
- ログイン失敗カウンタは KV（email+IP キー）。KV は原子的でないため並行試行に対する上限は厳密ではない — 詳細と受容理由は `docs/howto/free-tier-limits.md` の方針に従う。

## features
（未追加。`features/<NNN>-<slug>/` に追加していく）
