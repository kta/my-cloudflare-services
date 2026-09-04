# patent-corpus エージェント指示

このファイルはルート `AGENTS.md` を継承し、このディレクトリで追加適用する規約を定める。
衝突時はルート規約を優先する。

## 役割

`@app/patent-corpus` は、日本の特許公報の**書誌と全文を持つローカルのコーパスエンジン**である。
`services/patent_research`（典拠 / Tenkyo）の検索と典拠照合を支える。

**このパッケージが持つデータは派生物である。** 受領媒体から何度でも作り直せる
（500 万公報で 7〜8 時間、`docs/patent/BUDGET.md`）。作り直せないのは案件データ
（D1 側の典拠・論証・ドラフト）であって、こちらではない。だから:

- マイグレーション履歴を持たない。スキーマは `src/corpus.ts` の DDL が単一ソース。
- `id INTEGER PRIMARY KEY AUTOINCREMENT` を使う（リポジトリの DB 規約が禁じているのは
  D1 のドメイン表の話である。FTS5 の rowid は整数でなければならず、かつ**再利用してはならない**）。

## 構成と入口

| 場所 | 責務 |
|---|---|
| `src/tokenize.ts` | 日本語の bigram トークン化。**索引側と検索側の唯一の真実** |
| `src/normalize.ts` | 典拠照合のための正規化。吸収してよい揺れの境界を定める |
| `src/verify.ts` | **製品テーゼの実装**。引用が原文に実在するかの判定 |
| `src/corpus.ts` | コーパス DB（書誌・段落・FTS5・引用・チャンク） |
| `src/embed.ts` / `src/embed-pipeline.ts` | 埋め込みプロバイダとベクトル検索 |
| `src/vector.ts` | int8 / 1bit 量子化とコサイン・ハミング |
| `src/adapters/` | 受領媒体の読み取り（probe / tsv / xml / pdf） |
| `src/server.ts` | サイドカー HTTP（Worker からの唯一の入口） |
| `src/cli.ts` | `corpus` コマンド |
| `src/pure.ts` | **Worker が読めるサブパス**（`node:sqlite` を含まない） |

## 非交渉の境界

1. **`quote_check` はこのパッケージが判定し、送り手は指定できない。**
   照合のコードは `src/verify.ts` にしか無い。Worker は `@app/patent-corpus/pure` から読む。
   写しを作ってはならない（いつか食い違う）。
2. **`TOKENIZER_VERSION` を上げずにトークン化を変えない。**
   contentless FTS5 の削除は「原文から ng を作り直して減算する」方式なので、
   版が食い違うと索引が静かに壊れる。`corpus.ts` は版を DB に刻み、食い違う DB への
   書き込みを拒む。変えたら `corpus rebuild-index` が必要になることを利用者に伝える。
3. **正規化で意味を吸収しない。** 同義語・語形・踊り字・長音符は畳まない。
   英数字どうしのあいだの空白も潰さない（表組みから存在しない数値が生まれる）。
4. **「見た範囲」を偽らない。** 検索結果は総ヒット件数・日付不明件数・分割した語・
   落とした語・走査したチャンク数・モデル名を必ず添える。
   取りこぼす検索経路を、取りこぼさないかのように見せない。
5. **握りつぶさない。** 抽出できなかった PDF、段落番号が重複した XML、読めなかった日付は
   すべて `extract_failures` に残す。
6. **`node --experimental-strip-types` で動く構文だけを使う。**
   パラメータプロパティ（`constructor(readonly x: T)`）・`enum`・`namespace` は使えない。
   vitest は通るのに CLI が起動不能になる。`test/cli.smoke.test.ts` がこれを守る。
7. **secrets を引数に置かない。** サイドカーの共有鍵は `INTERNAL_KEY` 環境変数のみ
   （コマンドライン引数は `ps` から見える）。鍵が未設定なら全問い合わせを 503 で拒む。

## コマンド

```sh
pnpm --filter @app/patent-corpus test        # 各指標 80% 以上
pnpm --filter @app/patent-corpus typecheck
cd packages/patent-corpus
node src/cli.ts help
node src/cli.ts probe <媒体のパス> --sample 20   # 実データが来たら最初にこれ
node src/cli.ts synth --db /tmp/c.db --count 200
node src/cli.ts search --db /tmp/c.db 瞳孔 中心 --ipc G06F3
INTERNAL_KEY=... node src/cli.ts serve --db /tmp/c.db
```

## 必須テスト

- **トークン化**: 区切り文字は 1 文字ずつ固定する（`〇` `〻` `ー` を区切りにしない回帰）。
- **照合**: 短すぎる引用・数値の連結・ダッシュ類・異体字の境界値。
- **索引の版**: 版が食い違う DB への書き込みが拒まれること、`rebuild-index` で回復すること。
- **時刻**: `openCorpus(path, { now })` / `vectorSearch(..., { now })` で注入する。
  `Date.now()` に依存したテストを書かない（`*.time.test.ts` に分ける）。
- **CLI**: `test/cli.smoke.test.ts` が実プロセスで起動する。**消さない。**
- **サイドカー**: 不正入力が 400、ボディ超過が 413、鍵未設定が 503 であること。

## 実データが到着したら

1. `corpus probe <パス>` を**先に**実行する。仕様書を推測で埋めてインポータを書かない。
2. `src/adapters/tsv.ts` の `DEFAULT_TSV_MAPPING` と `src/adapters/xml.ts` の
   `DEFAULT_XML_MAPPING` は**未確認の仮置き**である（`unverified: true`）。
   probe の出力と突き合わせて確定させ、フラグを外す。
3. `corpus stats` で 1 公報あたりの文字数を実測し、`docs/patent/BUDGET.md` の係数を置き換える。
4. **二次利用・再配布の可否**を利用規約の原文で確認する。外販の生命線であり、
   機械では確認できなかった（`docs/superpowers/specs/2026-09-04-patent-research-system-design.md` §12.1）。
