# patent_research（典拠 / Tenkyo）エージェント指示

このファイルはルート `AGENTS.md` を継承し、このディレクトリで追加適用するサービス固有規約を
定める。衝突時はルート規約を優先する。

## 役割

弁理士および自己出願する発明者が、未出願の発明を、既存の特許公報という「典拠」に一つずつ
突き合わせて、出願できる形に固めていくための作業机。

**この D1 が持つのは「人間の作業と判断の記録」だけである。** 公報のコーパス（書誌・全文・
全文検索索引・ベクトル）は `packages/patent-corpus` が別プロセスのローカル SQLite として持ち、
この Worker は `x-internal-key` 付きの HTTP で問い合わせる。
コーパスは受領媒体から作り直せる派生物であり、**作り直せないのはこちら側のデータ**である。

## 非交渉の境界

1. **`quote_check` は Worker が決める。クライアントは申告できない。**
   `ProposeEvidence` の契約にその欄は無い。照合の実装は `@app/patent-corpus/pure` の
   `checkQuote` だけで、この Worker はそれを呼ぶ。写しを作ってはならない。
2. **`quote_check !== 'verified'` の典拠を人間が承認できない**（409 `quote_not_verified`）。
   照合できなかった主張が、人間の承認を経由して支持の根拠に化ける道を塞ぐ。
3. **コーパスに届かないことを 0 件と偽らない。**
   - 検索 → **503**（記録も残さない。実行できなかった検索を調査報告書に載せない）
   - 典拠の照合 → **`pending` のまま**。却下（作話）と取り違えない
   - `GET /api/corpus/status` → 200 で `reachable: false` と理由
4. **未出願の発明を外部 LLM へ送らない。** `disclosures.external_llm_allowed` が既定 false で、
   `provider=gemini` の対話はそれが true でなければ 403。
5. 全クエリを `organization_id`（JWT の `org`）でスコープ。body の値を認可の根拠にしない。
5.1 **`isSupporting` を通さずに「支持」を数えない。** 機械が確かめるのは
   「引用が原文に実在するか」だけで、**`relation` は送り手の自己申告**である。
   `quoteCheck==='verified' && review==='confirmed'` の両方が揃って初めて
   「この構成要件は塞がれている」と言える。片方だけで数えると、AI が無関係な公報の
   実在する一文を `discloses` と称して積むだけで出願を諦めさせる。
5.2 **特許性の判断が挙げる公報は、照合を通った典拠で裏付けられていなければならない**
   （409 `ref_not_supported`）。スキルの手順書は「verified だけを使う」と書いてあるが、
   それはお願いであって強制ではない。
5.3 **改訂の「最新」は版番号で決める。** `createdAt` で並べると、同じ秒に 2 版を保存したときに
   挿入順という暗黙の性質で最新が決まる。外部 LLM への送信可否はこの「最新」に従うので、
   そこを暗黙に任せない。版番号は 0 埋めして保存する（`'10' < '9'` を避ける）。
5.4 **D1 の 1 文あたりのバインド上限は 100 個**（行数ではなく列数 × 行数）。
   複数行を入れる文は必ず `maxRowsPerStatement()` で分割する。分割しても `db.batch` は
   1 トランザクションなので原子性は保たれる。**分割を忘れると、実データの検索は
   最初の 1 回から必ず落ちる。**
5.5 **コーパスの応答は Zod で検証してから使う。** 欄が欠けると `checkQuote` の既定値へ
   倒れ、「保留」であるべきものが「却下」に化ける。検証に落ちたら不達として扱う（安全側）。
6. **「出願する」操作を作らない。** 最終操作は常に「書き出す」であり、提出は人間が別の手段で行う
   （弁理士法72条。`specs/patent_research/00_service-spec.md` の「立ち位置」）。
7. 生成物には「法的助言ではない / 判断は人間が行う」の帰属を常に付す。

## 構成と入口

| 場所 | 責務 |
|---|---|
| `src/worker/index.ts` | Hono route chain、認証、典拠の照合、検索の記録、ジョブ |
| `src/worker/corpus-client.ts` | コーパスサイドカーへの唯一の口。届かないことを型で伝える |
| `src/worker/db/schema.ts` | Drizzle schema |
| `src/web/App.tsx` | 作業机の外枠と画面の切り替え（`react-router` は入れない） |
| `src/web/screens/ChartScreen.tsx` | **クレームチャート。製品の心臓** |
| `src/web/ui/parts.tsx` | 検印（済・未・却）などの部品。`tk-` トークンだけを参照する |
| `test/corpus-stub.ts` | コーパスサイドカーの代役（miniflare の serviceBindings に挿す） |
| `e2e/fixtures/build-corpus.sh` | E2E 用に合成コーパスを作ってサイドカーを起こす |

## コマンド

```sh
make corpus/synth                 # 合成コーパスを作る（実データが来る前でも動かせる）
make corpus/serve                 # コーパスサイドカーを起こす（別ターミナル、:8899）
make dev/patent_research          # SPA + API（:5177）

pnpm --filter @app/patent_research test      # Worker/integration（各4指標 80%以上）
pnpm --filter @app/patent_research test:web  # React/jsdom（各4指標 60%以上）
pnpm --filter @app/patent_research test:all
pnpm --filter @app/patent_research e2e       # 実 workerd + 実サイドカー
```

## 必須テスト

- **ヒットが多い検索**（`test/search-scale.test.ts`）: 1 / 8 / 9 / 20 / 50 / 500 件。
  **テスト用コーパスを小さくしない** — 4 段落しか無いと、D1 のバインド上限に当たる欠陥が
  構造的に検出できない（実際に E2E をすり抜けた）。
- **人のレビュー軸**（`test/evidence.review.test.ts`）: 自己申告だけで塞がれないこと、
  再照合の劣化パス（レビューのやり直し・書誌を消さない・不達は 503）、判断が典拠に縛られること。
- **時刻**（`test/matters.time.test.ts`）: `TEST_NOW` で注入する。`Date.now()` に依存しない。
- **典拠の照合**（`test/evidence.test.ts`）: 照合の 8 状態を境界値まで（下限 9/10 文字を含む）。
  特に `quote_too_short` と `not_in_corpus_tier2` を却下と取り違えないこと。
  **送り手が `quoteCheck` / `review` を申告できないこと**を必ず含める。
- **権限**（`test/permissions.test.ts`）: 表駆動。未知パスを入れて default-deny を証明する。
  ルートを足したら 1 行足す。
- **テナント分離**（`test/tenant-isolation.test.ts`）: 3 テナント、偽装入力、org の無効化と再同期。
- **通し**（`test/flow.integration.test.ts`）: 案件→発明→構成要件→検索→典拠→判断→ドラフト。
  コーパス不達で 503 になり**記録も残らない**ことを含める。
- **画面**（`src/web/**/*.test.tsx`）: 棄却が台帳に混ざらないこと、未照合を承認できないこと、
  0 件を「該当なし」と言わないこと。
- **E2E**（`e2e/claim-chart.spec.ts`）: Approved spec の AC と `@e2e-covers` で 1:1。

## デプロイしない

このサービスは Cloudflare へデプロイしない。ローカルで完結させる設計であり、
`ops` の監視対象にも入れない。外販する場合は
`docs/superpowers/specs/2026-09-04-patent-research-system-design.md` §2 の制約と、
バルクデータの二次利用条件の確認が前提になる。
