# サービス仕様: patent_research（典拠 / Tenkyo）

- パッケージ: `services/patent_research` (`@app/patent_research`)
- 所有 D1: `patent_research`（1 サービス = 1 D1。cross-D1 JOIN 禁止）
- ステータス: Approved
- 設計書: [`docs/superpowers/specs/2026-09-04-patent-research-system-design.md`](../../docs/superpowers/specs/2026-09-04-patent-research-system-design.md)

## 目的・責務

弁理士および自己出願する発明者が、未出願の発明を、既存の特許公報という「典拠」に一つずつ
突き合わせて、出願できる形に固めていくための作業机。

**所有するもの**: 案件、発明開示（未出願の秘密）、聞き取りの対話、請求項と構成要件、
検索の記録、典拠、特許性の判断、明細書ドラフト、記載要件の検査、分析ジョブ。

**所有しないもの**: 公報のコーパス（書誌・全文・全文検索索引・ベクトル）。これは
`packages/patent-corpus` が別プロセスのローカル SQLite として持ち、この Worker は
`x-internal-key` 付きの HTTP で問い合わせる。コーパスは受領媒体から作り直せる派生物であり、
作り直せないのはこちら側のデータである。

## 立ち位置（設計上の制約）

弁理士法72条により、他人のために業として出願書類を作成・代理するのは弁理士の独占業務である。
自己出願は自由である。したがって本サービスの正当な用途は次の 2 つに限る。

1. 弁理士が自分の業務を効率化するために使う（最終判断は弁理士）
2. 出願人が自分の発明を自分で出願するために使う

この制約を、注意書きではなく**作りで守る**:

- 生成物のすべてに「法的助言ではない / 判断は人間が行う」の帰属を機械的に付す
- 「出願する」操作を作らない。最終操作は常に「書き出す」であり、提出は人間が別の手段で行う
- マルチクライアント管理機能を作らない（用途 2 に不要で、違法な用途 3 を助ける形になる）

## エンティティ（所有データ）

| エンティティ | 主な属性 | 備考 |
|---|---|---|
| `matters` | id(UUID) / organization_id / title / tech_field / status | 1 発明 = 1 案件 |
| `disclosures` | matter_id / revision / problem / solution / effects / embodiments / external_llm_allowed | **未出願の秘密**。改訂は行を積む |
| `disclosure_messages` | matter_id / role / content / provider | 聞き取りの対話 |
| `claims` | matter_id / claim_no / depends_on(JSON) | マルチマルチクレームの機械検出に使う |
| `claim_elements` | matter_id / claim_no / element_key / text | 構成要件。クレームチャートの行 |
| `searches` / `search_hits` | query(JSON) / match_expression / compiled_sql / hit_count / undated_count | **検索式そのものを記録に残す** |
| `evidence` | element_id / pub_number / para_no / quoted_text / **quote_check** / review | **製品の心臓**。§典拠の照合 |
| `assessments` | kind / primary_ref / secondary_refs / motivation_type / hindrance / negative_type | 審査基準の型に沿う |
| `drafts` / `draft_checks` | section / markdown / check_key / result | 施行規則の見出しに 1:1 |
| `jobs` | kind / status / instruction | Claude Code スキルが拾うキュー |
| `organizations` | id / name / plan / is_disabled | admin と同期しない、単独運用のためのローカル行 |

## 典拠の照合（このサービスの中心）

`evidence` は **2 つの独立した軸**を持つ。混ぜてはならない。

- `quote_check`（機械照合）: 引用文がその公報のその段落の原文に実在するか。
  **Worker がコーパスに問い合わせて決める。クライアントは契約に欄を持たず、申告できない。**
  値: `verified` / `quote_mismatch` / `quote_too_short` / `paragraph_missing` /
  `publication_missing` / `not_in_corpus_tier2` / `quote_empty` / `pending`
- `review`（人間の法的評価）: その引用が構成要件の開示にあたるか。
  **`quote_check` が `verified` の典拠しかレビューできない**（409 `quote_not_verified`）。

コーパスに届かないときは `pending` のまま残す。却下（作話）と取り違えると、
コーパス側の事故が AI の作話として記録され、「AI の信頼性を利用者が評価するための材料」
という設計意図が逆向きに壊れる。

## API 面（Hono RPC + Zod）

| メソッド/パス | 認証 | 概要 |
|---|---|---|
| `GET /api/health` | none | ヘルス |
| `POST /api/auth/token` | none（dev のみ） | 開発用のトークン付与。`AUTH_DEV_GRANT` が true のときだけ |
| `POST /api/internal/organizations` | internal-key | org の同期（単独運用では使わないが形は残す） |
| `GET /api/corpus/status` | JWT(org) | コーパスの件数。**届かないときも 200 で「届いていない」と返す** |
| `GET/POST /api/matters`, `GET/PATCH /api/matters/:id` | JWT(org) | 案件 |
| `GET/PUT /api/matters/:id/disclosure` | JWT(org) | 発明開示 |
| `GET/POST /api/matters/:id/messages` | JWT(org) | 聞き取り。`provider=gemini` は案件の許可が要る（403） |
| `GET/PUT /api/matters/:id/elements` | JWT(org) | 構成要件 |
| `PUT /api/matters/:id/claims` | JWT(org) | 請求項。マルチマルチを検査して `draft_checks` に記録 |
| `GET/POST /api/matters/:id/searches` | JWT(org) | 検索。コーパス不達は **503**（0 件と偽らない） |
| `GET/POST /api/matters/:id/evidence` | JWT(org) | 典拠。POST で機械照合が走る |
| `POST /api/matters/:id/evidence/recheck` | JWT(org) | 再照合 |
| `DELETE /api/matters/:id/evidence/all` | JWT(org) | 典拠の全消し（やり直し用） |
| `POST /api/evidence/:id/review` | JWT(org) | 人間の評価。未照合なら 409 |
| `GET/POST /api/matters/:id/assessments` | JWT(org) | 特許性の判断 |
| `GET/PUT /api/matters/:id/drafts`, `GET /api/matters/:id/checks` | JWT(org) | ドラフトと記載要件の検査 |
| `GET /api/matters/:id/graph` | JWT(org) | 構成要件 × 公報の関係 |
| `GET /api/jobs`, `POST /api/matters/:id/jobs` | JWT(org) | 分析ジョブ |

契約は `packages/contracts/src/patent_research.ts`（Zod 単一ソース）。

## 非機能・横断

- テナントスコープ（`organization_id`）を全クエリで強制。単独運用でも固定 org で満たす。
- **notifier を使わない。** 通知する相手がいない（1 人で使う作業机であり、
  分析はジョブとして積まれ、人間が意識的に起こす）。
- 認証は自前 JWT（`packages/shared`）。admin とは同期しない。
- Cloudflare へデプロイしない。`vite dev` / `vite preview` でローカルに動かす。
- 本システムの出力はすべて下書きであり、法的助言ではない。

## features

`features/<NNN>-<slug>/` に機能単位の spec。
