/*
 * Worker から読める純粋なモジュールだけを束ねた入口。
 *
 * `@app/patent-corpus` の本体は `node:sqlite` を読むので workerd では動かない。だが典拠の照合
 * （`checkQuote`）は **Worker 側で実行しなければならない** — AI（Claude Code スキル）が送って
 * きた `quote_check` を信用しないのが製品テーゼだからである。照合のコードを 2 か所に写すと
 * いつか食い違うので、Worker はこのサブパス（`@app/patent-corpus/pure`）から読む。
 */

export { normalizeForQuote } from './normalize.ts'
export type { TokenRun, TokenRunKind } from './tokenize.ts'
export { indexTokens, queryExpression, tokenRuns, tokensOfRun } from './tokenize.ts'
export type { CheckQuoteInput, QuoteCheck, QuoteCheckResult } from './verify.ts'
export { checkQuote } from './verify.ts'
