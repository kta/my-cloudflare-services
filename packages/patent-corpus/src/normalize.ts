/*
 * 典拠の照合のための正規化。
 *
 * ここで吸収してよいのは「同じ文字の書き方の揺れ」だけである。全角/半角、大文字小文字、
 * ダッシュ類の使い分け、異体字セレクタ、段落番号の隅付き括弧。
 * **同義語・語形・踊り字は絶対に吸収しない** — 吸収した瞬間に「原文に書いていないこと」を
 * 「書いてある」と機械が言えてしまい、製品テーゼが崩れる。
 * （「人々」と「人人」を同一にすると、それだけで引用の同一性が緩む。）
 */

/** 段落番号の装飾。原文の同一性に寄与しないので落とす。 */
const PARAGRAPH_BRACKETS = /[【】]/g

/**
 * 異体字セレクタ。公報のテキストは経路（XML / PDF / TSV）によって IVS の有無が変わるため、
 * 落とさないと「葛󠄀城」と「葛城」が別物になり、正当な引用が却下される。
 */
const VARIATION_SELECTORS = /[︀-️]|[\u{E0100}-\u{E01EF}]/gu

/**
 * ダッシュ類。公報の経路ごとにハイフン・全角ダッシュ・マイナス記号の使い分けが違うので、
 * 1 つに畳む。**長音符 ー (U+30FC) は畳まない** — 語の一部であり、畳むと語が変わる。
 */
const DASHES = /[‐-―⁃−﹣]/g
/** 波ダッシュとチルダ。範囲表記「10〜20」「10～20」の揺れを吸収する。 */
const WAVES = /[〜〰～]/g

const ASCII_ALNUM = /[0-9a-z]/

/**
 * 空白の扱い。
 *
 * 単純に全部落とすと、表組みの「実施例1  2.5」から `12.5` が「原文に実在する」と
 * 判定されてしまう（実測で確認）。特許では数値が新規性の分かれ目なので、これは致命的である。
 * そこで **英数字どうしの間の空白は 1 個残し、それ以外の空白だけを落とす**。
 * 和文の折り返しや組版由来の空白は消え、数値の連結は起きない。
 */
function collapseWhitespace(text: string): string {
  const chars = Array.from(text)
  const out: string[] = []
  let pendingSpace = false
  for (const ch of chars) {
    if (/\s/.test(ch)) {
      pendingSpace = true
      continue
    }
    if (pendingSpace) {
      const prev = out[out.length - 1]
      if (prev !== undefined && ASCII_ALNUM.test(prev) && ASCII_ALNUM.test(ch)) out.push(' ')
      pendingSpace = false
    }
    out.push(ch)
  }
  return out.join('')
}

export function normalizeForQuote(text: string): string {
  const folded = text
    .normalize('NFKC')
    .replace(VARIATION_SELECTORS, '')
    .replace(PARAGRAPH_BRACKETS, '')
    .replace(DASHES, '-')
    .replace(WAVES, '~')
    .toLowerCase()
  return collapseWhitespace(folded)
}
