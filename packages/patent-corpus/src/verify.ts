/*
 * 製品テーゼの実装。
 *
 * AI が「この公報のこの段落にこう書いてある」と言ったとき、それが本当かを機械が判定する。
 * verified 以外の結果は、支持の根拠として一切表示されない。ただし削除もされない —
 * 「照合できなかった」という事実は、利用者が AI の信頼性を自分で評価するための材料である。
 */

import { normalizeForQuote } from './normalize.ts'

export type QuoteCheckResult =
  /** 引用文がその段落の原文に実在する */
  | 'verified'
  /** 段落は実在するが、引用文がその中に無い（AI の作話） */
  | 'quote_mismatch'
  /** 公報は実在するが、その段落番号が無い */
  | 'paragraph_missing'
  /** 公報自体がコーパスに無い */
  | 'publication_missing'
  /** 公報は層1にあるが、その部分（請求項/明細書）の全文が層2に無いため照合不能 */
  | 'not_in_corpus_tier2'
  /** 引用文が空。空文字は任意の文の部分文字列なので必ず落とす */
  | 'quote_empty'
  /** 引用が短すぎて典拠にならない */
  | 'quote_too_short'

export interface QuoteCheck {
  result: QuoteCheckResult
  /** 人間が AI の主張と実際の原文の差を見るための手掛かり */
  detail: string | null
  /** 照合に使った正規化後の引用の長さ */
  normalizedLength: number
}

export type ParagraphSection = 'claim' | 'desc' | 'abstract'

export interface CheckQuoteInput {
  quoted: string
  /** その段落の原文。段落が無ければ null */
  paragraphText: string | null
  /** 公報が層1に存在するか。既定は true（段落原文を引けた文脈で呼ばれる） */
  publicationExists?: boolean
  /** その公報の全文が層2に取り込まれているか。既定は true */
  fulltextAvailable?: boolean
  /**
   * その公報について実際に取り込まれた部分。省略すると「全部取り込まれている」とみなす。
   * 請求項しか取り込めていない公報に対する明細書段落の引用を、
   * 「原文に無い（却下）」ではなく「照合不能（保留）」と正しく言うために要る。
   */
  sectionsIngested?: readonly ParagraphSection[]
  /** 段落番号。取り込み済みの部分と突き合わせるために使う。 */
  paraNo?: string
}

/** 差分を人間が見るために原文の冒頭を残す長さ。 */
const DETAIL_HEAD = 60

/**
 * 典拠として認める引用の最小の長さ（正規化後の文字数）。
 *
 * 下限が無いと、AI は引用文を「る」「を」「する」にするだけで照合を通せる
 * （日本語の段落なら助詞はほぼ必ず含まれる）。実測でこれが通ることを確認したので塞いだ。
 * 短くて具体的な引用（数値限定など）を出したい場合は、前後を含めて引用し直せばよい。
 * `quote_too_short` は作話（quote_mismatch）とは別の状態として返し、UI もそう表示する。
 */
export const MIN_QUOTE_CHARS = 10

/** 段落番号から、その段落がどの部分に属するかを決める（C 始まりは請求項）。 */
export function sectionOfParaNo(paraNo: string): ParagraphSection {
  return paraNo.startsWith('C') ? 'claim' : 'desc'
}

export function checkQuote(input: CheckQuoteInput): QuoteCheck {
  const {
    quoted,
    paragraphText,
    publicationExists = true,
    fulltextAvailable = true,
    sectionsIngested,
    paraNo,
  } = input
  const needle = normalizeForQuote(quoted)
  const base = { normalizedLength: needle.length }

  if (!publicationExists) {
    return { ...base, result: 'publication_missing', detail: null }
  }
  if (!fulltextAvailable) {
    return {
      ...base,
      result: 'not_in_corpus_tier2',
      detail: 'この公報の全文はまだコーパスに取り込まれていないため、照合できない。',
    }
  }
  if (sectionsIngested !== undefined && paraNo !== undefined) {
    const section = sectionOfParaNo(paraNo)
    if (!sectionsIngested.includes(section)) {
      return {
        ...base,
        result: 'not_in_corpus_tier2',
        detail: `この公報は ${sectionsIngested.join('/') || '（なし）'} しか取り込まれておらず、${section} は照合できない。`,
      }
    }
  }
  if (needle.length === 0) {
    return { ...base, result: 'quote_empty', detail: null }
  }
  if (needle.length < MIN_QUOTE_CHARS) {
    return {
      ...base,
      result: 'quote_too_short',
      detail: `引用が ${needle.length} 字しかない。${MIN_QUOTE_CHARS} 字以上（前後を含めて）引用し直す。`,
    }
  }
  if (paragraphText === null) {
    return { ...base, result: 'paragraph_missing', detail: null }
  }
  if (normalizeForQuote(paragraphText).includes(needle)) {
    return { ...base, result: 'verified', detail: null }
  }
  return {
    ...base,
    result: 'quote_mismatch',
    detail: `実際の段落の冒頭: ${paragraphText.slice(0, DETAIL_HEAD)}`,
  }
}
