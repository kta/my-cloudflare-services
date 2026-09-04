/*
 * 日本語特許全文検索のトークン化。
 *
 * FTS5 の trigram トークナイザは 3 文字未満のトークンを検索できない。特許の技術用語は
 * 「瞳孔」「視線」「撮像」「電極」「樹脂」のように 2 文字が主力なので、trigram では調査に
 * 使えない（実測でヒット 0 件）。そこで原文を空白区切りの bigram 列に開いて
 * `tokenize='unicode61'` の FTS5 に入れ、検索側もフレーズにして連続性を保証する。
 *
 * 索引側と検索側で同じ関数（tokenRuns）を通すことが正しさの条件である。ここが食い違うと
 * 「原文に無い連続がヒットする」か「原文にある連続が引けない」のどちらかが起きる。
 */

/**
 * トークン化の版。**索引の互換性を決める番号である。**
 *
 * `tokenRuns` / `tokensOfRun` の挙動を変えたら必ず上げる。contentless FTS5 からの削除は
 * 「原文から ng 列を作り直して減算する」方式なので、版が変わった索引に対して新しい版の
 * ng を渡すと、索引が静かに壊れる（幽霊 posting が残る、あるいは disk image malformed）。
 * `corpus.ts` はこの番号を DB に刻み、食い違ったら書き込みを拒む。
 */
export const TOKENIZER_VERSION = 2

export type TokenRunKind = 'cjk' | 'ascii'

export interface TokenRun {
  kind: TokenRunKind
  text: string
}

/**
 * 区切り文字。ここを跨いで bigram を作らないことで、原文に無い文字の連続を索引に入れない。
 *
 * **範囲指定ではなく列挙にしてある。** 以前は `　-〿`（U+3000–U+303F）を丸ごと区切りにして
 * いたが、この範囲には語の一部である文字が含まれていた:
 *   〇 U+3007 漢数字のゼロ（「令和〇三年」「二〇一八年」）
 *   〻 U+303B / 〳〴〵 U+3033-3035 踊り字
 *   〆 U+3006 / 〡-〩 U+3021-3029 / 〸〹〺 蘇州号碼
 * これらが区切りになると、利用者が入力した文字が黙って消え、フレーズ検索が文書 AND に
 * 劣化して**原文に存在しない連続がヒットする**（実測で確認）。
 *
 * NFKC の後に残る記号だけを列挙すればよい（半角カナ記号 ｡｢｣､･ や全角英数記号 ！-～ は
 * NFKC で ASCII か全角の対応字に畳まれる）。
 */
const CJK_SEPARATORS = '、。〃〈〉《》「」『』【】〔〕〖〗〘〙〚〛〜〝〞〟〰・…‥※゛゜'
const ASCII_SEPARATORS = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
const SEPARATOR_SET: ReadonlySet<string> = new Set([...CJK_SEPARATORS, ...ASCII_SEPARATORS])

/** 半角英数（NFKC 後はすべてこの形になる）。 */
const ASCII_ALNUM = /[0-9A-Za-z]/
/** 空白（U+3000 を含む）。 */
const WHITESPACE = /\s/

function isSeparator(ch: string): boolean {
  return WHITESPACE.test(ch) || SEPARATOR_SET.has(ch)
}

/**
 * 文字列を「和文の連なり」と「英数の連なり」に切り分ける。区切り文字は捨てる。
 * 踊り字・長音符・漢数字のゼロは語の一部なので区切りにしない（上のコメント参照）。
 */
export function tokenRuns(input: string): TokenRun[] {
  const s = input.normalize('NFKC')
  const runs: TokenRun[] = []
  let buf = ''
  let kind: TokenRunKind | null = null

  const flush = () => {
    if (buf.length > 0 && kind !== null) {
      runs.push({ kind, text: kind === 'ascii' ? buf.toLowerCase() : buf })
    }
    buf = ''
    kind = null
  }

  for (const ch of s) {
    if (isSeparator(ch)) {
      flush()
      continue
    }
    const next: TokenRunKind = ASCII_ALNUM.test(ch) ? 'ascii' : 'cjk'
    if (kind !== null && kind !== next) flush()
    kind = next
    buf += ch
  }
  flush()
  return runs
}

/** 1 つの連なりを FTS5 のトークン列にする。和文は bigram、英数はそのまま 1 トークン。 */
export function tokensOfRun(run: TokenRun): string[] {
  if (run.kind === 'ascii') return [run.text]
  const chars = Array.from(run.text)
  if (chars.length === 1) return [run.text]
  const out: string[] = []
  for (let i = 0; i < chars.length - 1; i++) out.push(`${chars[i]}${chars[i + 1]}`)
  return out
}

/** 索引に格納する文字列を作る（FTS5 の `ng` 列に入る値）。 */
export function indexTokens(text: string): string {
  return tokenRuns(text).flatMap(tokensOfRun).join(' ')
}

export interface QueryExpression {
  /** FTS5 の MATCH 式。実質空なら null。 */
  match: string | null
  /**
   * 区切りを含んでいたために、連続性の保証を諦めて AND に落とした語。
   * 利用者に「この語は分割して探した」と伝えるために返す（黙って落とさない）。
   */
  splitTerms: string[]
  /** トークンが 1 つも作れず、検索から外れた語。 */
  droppedTerms: string[]
}

/**
 * 検索語の並びから FTS5 の MATCH 式を組む。
 *
 * - 区切りを含まない語はフレーズにする（部分文字列の連続性が保証される）
 * - 区切りを含む語は、区切りごとのフレーズの AND に落とす。**落としたことは splitTerms で返す**
 * - トークンが作れない語は droppedTerms で返す。全部空なら match は null
 *
 * 既知の限界: 1 文字の和文語は、原文で区切りに挟まれて単独で現れた箇所しか引けない
 * （bigram に開けないため）。特許の調査で 1 文字語を単独で引く場面はほぼ無い。
 */
export function buildQuery(terms: string[], op: 'AND' | 'OR' = 'AND'): QueryExpression {
  const parts: string[] = []
  const splitTerms: string[] = []
  const droppedTerms: string[] = []
  for (const term of terms) {
    const runs = tokenRuns(term)
    if (runs.length === 0) {
      droppedTerms.push(term)
      continue
    }
    const phrases = runs.map((r) => `"${tokensOfRun(r).join(' ')}"`)
    if (phrases.length === 1) {
      parts.push(phrases[0] as string)
    } else {
      splitTerms.push(term)
      parts.push(`(${phrases.join(' AND ')})`)
    }
  }
  return {
    match: parts.length === 0 ? null : parts.join(` ${op} `),
    splitTerms,
    droppedTerms,
  }
}

/** 式だけが要る呼び出し向けの薄い包み。 */
export function queryExpression(terms: string[], op: 'AND' | 'OR' = 'AND'): string | null {
  return buildQuery(terms, op).match
}
