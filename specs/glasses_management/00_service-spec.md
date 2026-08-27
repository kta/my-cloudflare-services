# サービス仕様: glasses_management

- パッケージ: `services/glasses_management` (`@app/glasses_management`)
- Worker名: `glasses-management`
- 所有 D1: `glasses_management`（1サービス = 1 D1。cross-D1 JOIN禁止）
- ステータス: Approved

## 目的・責務

EYEX予約として、複数店舗の眼鏡店における予約、来店受付、顧客の接客事実、録音、設定公開、監査、顧客向けWeb予約を所有する。`admin` は認証と組織の正であり、本サービスはその同期コピーだけを持つ。`notifier` は予約確定と会社発行管理コードのメール送信を担う。

旧 `glasses_reservation` は高忠実度モックとして廃止し、本サービスの実装対象ではない。

## エンティティ（所有データ）

| 領域 | 主なエンティティ | 備考 |
|---|---|---|
| 組織・店舗 | organizations同期コピー / stores / store_memberships | 全行にorganization_id、店舗業務はstore_id |
| 受付条件 | setting_versions / visit_purposes / shifts / equipment | 不変版と適用元を保持 |
| 予約・来店 | reservations / allocations / reception_sessions / walk_ins / visit_events | 版・冪等・監査を持つ |
| 顧客 | customers / measurements / glasses / notes / attention_revisions | 注意事項は版管理し直接上書きしない |
| 録音 | recordings | 本体は非公開R2、D1はメタデータだけ |
| 統制 | terminals / reauth / audit_events / idempotency_records | 監査は追記専用 |
| Web・分析 | web_booking_settings / management_codes / alerts / analytics_daily | 管理コードはハッシュ保存 |

IDはアプリ生成UUID、FKなし、複数書込みは`db.batch()`を使う。他サービス情報はservice bindingで同期・集約し、cross-D1 JOINは行わない。

## API 面（Hono RPC + Zod）

| 面 | 認証 | 概要 |
|---|---|---|
| `GET /api/health` | なし | ヘルスチェック |
| `/api/staff/*` | JWT + 組織 + 店舗権限 | 予約、顧客、台帳、設定、監査、共有端末 |
| `/api/public/*` | 公開店舗解決 | Web予約、成立照会、予約番号＋管理コードによる変更取消 |
| `/api/internal/organizations/*` | internal key | adminからの組織同期（単調増加revisionで古い配信を無視） |
| `/api/internal/maintenance/*` | internal key / scheduled | 録音保持・公開予定の定期処理 |

契約は `packages/contracts/src/glasses_management.ts` のZod単一ソースとする。private APIはdefault-deny、公開APIは組織・店舗をサーバ側で解決し、すべてのD1 queryでorganization_idと必要なstore_idを強制する。

## 非機能・横断

- `admin` は本サービスへ単調増加 `revision` 付きの組織スナップショットを同期し、ドメインWorker向け認証プロキシを提供する。同期失敗時は正本を保持し、運営adminが同じ正本を明示再同期できる。
- 予約確定メールと管理コード発行メールは `notifier` への同期service bindingで送る。メール失敗でも予約は残し、再発行は会社側のみが行う。
- R2録音は非公開。成立予約は最低30日、破棄受付は最低24日ではなく**24時間**保持する。
- 予約、変更、取消、録音メタデータ、Web確定はD1冪等記録で重複を防ぐ。更新対象は版番号で409を返す。
- JSTの判定時刻は引数で注入する。テストで`Date.now()`を使わない。
- iPad横向き、375px、キーボード、focus、200%文字拡大、WCAG AA、reduced-motionを満たす。

## features

`features/002-eyex-reservation-product/spec.md` を本サービスの承認済み業務仕様として移管し、全UC/ACをPlaywright E2Eへ一意に対応させる。
