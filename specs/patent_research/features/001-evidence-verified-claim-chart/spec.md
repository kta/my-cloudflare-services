# 001-evidence-verified-claim-chart: 機械照合された典拠でクレームチャートを組む

- ステータス: Approved

## 1. WHAT / WHY

**概要**（3 行以内）:
構成要件ごとに先行技術を探し、見つけた公報の段落を「典拠」として積む。積まれた引用は
公報の原文と機械的に突き合わされ、**照合を通ったものだけが支持の根拠になる**。
照合を通らなかった主張は消えず、AI の主張と実際の原文の対比として残る。

**ユーザーストーリー**:
- US-EVID-01: 弁理士として、AI が挙げた先行技術の引用が本当に公報に書いてあるのかを、自分で確かめずに信じられる状態にしたい。
- US-EVID-02: 出願人として、どの構成要件がまだ先行技術に塞がれていないかを一目で知りたい。
- US-EVID-03: 調査を任される者として、何をどう探したかを後から検証できる記録を残したい。

**受け入れ基準**:
- AC-EVID-01: Given 公報の当該段落に実在する引用文 When 典拠として積む Then 照合済み（済）として台帳に載り、人間が開示を認められる状態になる。
- AC-EVID-02: Given 当該段落の原文に存在しない引用文 When 典拠として積む Then 棄却（却）として台帳から降ろされ、AI の主張と実際の原文が対比されて残る。
- AC-EVID-03: Given 照合を通っていない典拠 When 人間が開示を認めようとする Then 拒まれ、照合を通すよう促される。
- AC-EVID-04: Given 典拠が 1 件も無い構成要件 When クレームチャートを開く Then その要件が新規性の勝ち筋として索引に際立ち、「まだ探していないだけかもしれない」と添えられる。
- AC-EVID-05: Given 検索語と分類コードの絞り込み When 先行技術を検索する Then 実行した検索式・ヒット件数・公開日不明の件数が記録として画面に残る。
- AC-EVID-06: Given コーパスに届かない状態 When 先行技術を検索する Then 0 件ではなく「届かなかった」と表示され、検索の記録も残らない。
- AC-EVID-07: Given 未出願の発明が入った案件（外部送信は既定で禁止） When 発明を書く画面を開く Then 外部 LLM への送信が切れていることと、その理由が読める。

**スコープ外**:
- 特許庁への電子出願の送信（出力は様式に沿った書類まで）
- 外国特許（第 1 版は日本のみ）
- 意味ベクトルによる検索（全文検索と分類コードが第一級。ベクトルは後フェーズの上積み）

**不明点**: なし

## 2. HOW

**触るファイル**:
- `packages/contracts/src/patent_research.ts` — `ProposeEvidence` / `Evidence` / `QuoteCheck` / `RunSearch` / `SearchRecord` / `ClaimElementSummary`
- `packages/patent-corpus/src/verify.ts` — `checkQuote`（照合の唯一の実装。Worker は `@app/patent-corpus/pure` から読む）
- `services/patent_research/src/worker/index.ts` — `POST /api/matters/:id/evidence`（照合を走らせる）/ `POST /api/evidence/:id/review`（未照合を拒む）
- `services/patent_research/src/worker/corpus-client.ts` — コーパスへの口。届かないことを型で伝える
- `services/patent_research/src/web/screens/ChartScreen.tsx` — 台帳・棄却欄・典拠の余白
- `services/patent_research/src/web/screens/SearchScreen.tsx` — 検索式の記録

**データモデル差分**: `evidence` / `searches` / `search_hits` / `claim_elements` を新設（`services/patent_research/migrations/0000_*.sql`）。

**却下した代替案**:
- 照合状態をクライアントが送る形にする — スキルが「照合済み」と自称できてしまい、製品が成立しない。
- 照合を通らなかった典拠を削除する — AI の信頼性を利用者が評価する材料が失われる。
- ベクトル類似度だけで先行技術を出す — 「同じ分野の文献」は返るが「構成要件を開示する文献」は保証されない。

## 3. TASKS

- [x] T-001: 契約テスト（`ProposeEvidence` が照合状態を受け付けないこと、審査基準の型）
- [x] T-002: 照合の境界値テスト（短すぎる引用・数値の連結・表記の揺れ・取り込み範囲）
- [x] T-003: integration テスト（照合・再照合・レビューの拒否・テナント分離・権限）
- [x] T-004: 実装（コーパスエンジン → 契約 → Worker → 画面）
- [x] T-005: 画面（DESIGN_RULE パス 1 → `design-select` で方向 C を人間が選択 → 実装）
- [x] T-006: E2E（この spec の AC を Playwright に 1:1 で対応付ける）
