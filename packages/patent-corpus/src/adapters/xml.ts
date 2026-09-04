/*
 * 公報 XML から請求項と明細書の段落を取り出す。
 *
 * **タグ名は未確認である。** 特許庁の一次情報で「インターネット公報は XML から自動組版された
 * PDF と元データの XML で構成される」ことは確認できたが、スキーマの具体的なタグ名は
 * サイトが機械取得を拒否したため確認できなかった。したがってタグ名も **データとして外に出す**。
 *
 * 正規表現で読んでいるのは意図的である。段落の抽出に必要なのは「特定のタグの中身」だけで、
 * XML の完全な構文木は要らない。依存を増やさずに済み、壊れた XML でも取れるところは取れる。
 * ただし **属性値に `>` を含む病的な XML** は正しく読めない（実データで確認して必要なら直す）。
 */

export interface XmlMapping {
  /** 請求項 1 件を包む要素名（例 `claim`）。 */
  claimElement: string
  /** 明細書の段落 1 件を包む要素名（例 `p`）。 */
  paragraphElement: string
  /** 段落番号を持つ属性名（例 `num`）。 */
  numberAttribute: string
  /** 発明の名称の要素名。 */
  titleElement: string
  /** 公報番号の要素名。 */
  docNumberElement: string
  /** このタグ名の対応が一次情報で未確認であることの目印。 */
  unverified?: boolean
}

export const DEFAULT_XML_MAPPING: XmlMapping = {
  claimElement: 'claim',
  paragraphElement: 'p',
  numberAttribute: 'num',
  titleElement: 'invention-title',
  docNumberElement: 'doc-number',
  unverified: true,
}

export interface XmlParagraph {
  paraNo: string
  section: 'claim' | 'desc'
  text: string
}

export interface ParsedGazette {
  docNumber: string | null
  title: string | null
  paragraphs: XmlParagraph[]
  /**
   * 取り込みを止めるべき問題。段落番号の重複などは**黙って連番を振り直さない** —
   * 番号がずれた典拠は、機械は「原文に無い」と正しく言えても、
   * 人間が J-PlatPat でその番号を開いて「書いてある」と反証してしまう。
   */
  issues: string[]
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** Unicode の範囲外・サロゲート領域は復元しない（String.fromCodePoint が投げるため）。 */
function isDecodableCodePoint(code: number): boolean {
  return (
    Number.isInteger(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
  )
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return isDecodableCodePoint(code) ? String.fromCodePoint(code) : whole
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return isDecodableCodePoint(code) ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** 入れ子のタグを落として文字だけを取る。段落の本文に必要なのはこれだけである。 */
function textOf(inner: string): string {
  return decodeEntities(inner.replace(/<[^>]*>/g, '')).trim()
}

function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface Element {
  attributes: string
  inner: string
}

function findElements(xml: string, name: string): Element[] {
  const tag = escapeForRegExp(name)
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  const out: Element[] = []
  for (const m of xml.matchAll(re)) {
    out.push({ attributes: m[1] ?? '', inner: m[2] ?? '' })
  }
  return out
}

/**
 * 属性値を取り出す。**属性名の前に境界を要求する** — 境界が無いと `data-num="9999"` が
 * `num` として拾われ、典拠が誤った段落番号に紐づく（実測で確認）。
 */
function attribute(attributes: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${escapeForRegExp(name)}\\s*=\\s*"([^"]*)"`)
  const m = re.exec(attributes)
  return m?.[1] ?? null
}

const PARA_DIGITS = 4
const CLAIM_DIGITS = 3

export function parseGazetteXml(xml: string, mapping: XmlMapping): ParsedGazette {
  const paragraphs: XmlParagraph[] = []
  const issues: string[] = []
  const seen = new Set<string>()

  const push = (paraNo: string, section: 'claim' | 'desc', text: string): void => {
    if (seen.has(paraNo)) {
      issues.push(`段落番号が重複している: ${paraNo}`)
      return
    }
    seen.add(paraNo)
    paragraphs.push({ paraNo, section, text })
  }

  // 番号が無い要素には「直前の番号 + 1」を振る。出現順の連番にすると、
  // <claim num="3"> の次の番号なし要素が C002 になり、請求項がずれる。
  let lastClaim = 0
  for (const el of findElements(xml, mapping.claimElement)) {
    const text = textOf(el.inner)
    if (text.length === 0) continue
    const num = attribute(el.attributes, mapping.numberAttribute)
    const n = num !== null && /^\d+$/.test(num) ? Number(num) : lastClaim + 1
    lastClaim = n
    push(`C${String(n).padStart(CLAIM_DIGITS, '0')}`, 'claim', text)
  }

  let lastPara = 0
  for (const el of findElements(xml, mapping.paragraphElement)) {
    const text = textOf(el.inner)
    if (text.length === 0) continue
    const num = attribute(el.attributes, mapping.numberAttribute)
    const n = num !== null && /^\d+$/.test(num) ? Number(num) : lastPara + 1
    lastPara = n
    push(String(n).padStart(PARA_DIGITS, '0'), 'desc', text)
  }

  const title = findElements(xml, mapping.titleElement)[0]
  const doc = findElements(xml, mapping.docNumberElement)[0]
  return {
    docNumber: doc ? textOf(doc.inner) : null,
    title: title ? textOf(title.inner) : null,
    paragraphs,
    issues,
  }
}
