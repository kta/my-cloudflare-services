import { z } from 'zod'

/**
 * 典拠（Tenkyo）— 特許調査・出願支援ドメインの契約。
 *
 * 設計書: `docs/superpowers/specs/2026-09-04-patent-research-system-design.md`
 *
 * この契約の中心にあるのは製品テーゼである:
 *   AI が生成した主張は、(公報番号, 段落番号) に紐づき、その段落の原文に引用文が実在することを
 *   機械が照合できたときにだけ、支持された主張として表示される。
 *
 * だから `ProposeEvidence`（クライアントが送る形）には `quoteCheck` が**無い**。
 * 照合状態は Worker がコーパスに問い合わせて決めるものであり、送り手が申告するものではない。
 * ここを緩めた瞬間に、スキルが「照合済み」と自称できるようになり、製品が成立しなくなる。
 */

const Id = z.string().min(1)
const Iso = z.string().datetime()
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で指定する')

// ---------------------------------------------------------------------------
// 案件
// ---------------------------------------------------------------------------

export const MatterStatus = z.enum([
  'intake', // 発明を聞き取っている
  'searching', // 先行技術を調べている
  'analyzed', // 特許性の見立てが立った
  'drafting', // 明細書を書いている
  'drafted', // 下書きが揃った
])
export type MatterStatus = z.infer<typeof MatterStatus>

export const CreateMatter = z.object({
  title: z.string().min(1).max(200),
  techField: z.string().max(200).default(''),
})
export type CreateMatter = z.infer<typeof CreateMatter>

export const UpdateMatter = z.object({
  title: z.string().min(1).max(200).optional(),
  techField: z.string().max(200).optional(),
  status: MatterStatus.optional(),
})
export type UpdateMatter = z.infer<typeof UpdateMatter>

export const Matter = z.object({
  id: Id,
  organizationId: Id,
  title: z.string(),
  techField: z.string(),
  status: MatterStatus,
  createdAt: Iso,
  updatedAt: Iso,
})
export type Matter = z.infer<typeof Matter>

/** 一覧に出す集計。照合率が案件の健康状態そのものなので、一覧の段階で見せる。 */
export const MatterSummary = Matter.extend({
  elementCount: z.number().int().nonnegative(),
  evidenceCount: z.number().int().nonnegative(),
  verifiedCount: z.number().int().nonnegative(),
  confirmedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
})
export type MatterSummary = z.infer<typeof MatterSummary>

// ---------------------------------------------------------------------------
// 発明開示（未出願の秘密）
// ---------------------------------------------------------------------------

export const UpsertDisclosure = z.object({
  problem: z.string().max(20_000).default(''),
  solution: z.string().max(20_000).default(''),
  effects: z.string().max(20_000).default(''),
  embodiments: z.string().max(50_000).default(''),
  keywords: z.array(z.string().min(1).max(100)).max(100).default([]),
  /**
   * 外部 LLM（Gemini 等）へ本文を送ってよいか。**既定は false**。
   * 未出願の発明を外部の無料枠に流すのは、弁理士に説明できない。
   * 公開済みの公報テキストの要約は別経路であり、このフラグの対象外。
   */
  externalLlmAllowed: z.boolean().default(false),
})
export type UpsertDisclosure = z.infer<typeof UpsertDisclosure>

export const Disclosure = UpsertDisclosure.extend({
  id: Id,
  organizationId: Id,
  matterId: Id,
  revision: z.number().int().positive(),
  createdAt: Iso,
})
export type Disclosure = z.infer<typeof Disclosure>

export const LlmProvider = z.enum(['claude-code', 'gemini', 'local', 'human'])
export type LlmProvider = z.infer<typeof LlmProvider>

export const PostDisclosureMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(50_000),
  provider: LlmProvider.default('human'),
})
export type PostDisclosureMessage = z.infer<typeof PostDisclosureMessage>

export const DisclosureMessage = PostDisclosureMessage.extend({
  id: Id,
  organizationId: Id,
  matterId: Id,
  createdAt: Iso,
})
export type DisclosureMessage = z.infer<typeof DisclosureMessage>

// ---------------------------------------------------------------------------
// 請求項と構成要件
// ---------------------------------------------------------------------------

export const ClaimCategory = z.enum(['product', 'process', 'use', 'medium'])
export type ClaimCategory = z.infer<typeof ClaimCategory>

export const UpsertClaim = z.object({
  claimNo: z.number().int().positive().max(500),
  category: ClaimCategory.default('product'),
  /** 引用する請求項の番号。独立項なら空。 */
  dependsOn: z.array(z.number().int().positive().max(500)).max(50).default([]),
  text: z.string().min(1).max(20_000),
})
export type UpsertClaim = z.infer<typeof UpsertClaim>

export const Claim = UpsertClaim.extend({
  id: Id,
  organizationId: Id,
  matterId: Id,
  createdAt: Iso,
})
export type Claim = z.infer<typeof Claim>

/**
 * マルチマルチクレームの検出。
 *
 * 施行規則 24 条の 3 第 5 号により、令和 4 年 4 月 1 日以降の出願では、
 * 「他の 2 以上の請求項を択一的に引用する請求項」をさらに択一的に引用する請求項が禁止されている。
 * つまり **2 つ以上を引用する請求項を、2 つ以上を引用する請求項が引用する** 形が違反になる。
 *
 * 引用の輪（循環）は仕様上あり得ないが、入力ミスで作られ得るので、無限ループを避けるため
 * 訪問済みを持って辿る。
 */
export function detectMultiMultiClaims(
  claims: { claimNo: number; dependsOn: number[] }[],
): number[] {
  const byNo = new Map(claims.map((c) => [c.claimNo, c]))
  const violating: number[] = []
  for (const claim of claims) {
    if (claim.dependsOn.length < 2) continue
    for (const parentNo of claim.dependsOn) {
      const parent = byNo.get(parentNo)
      if (parent && parent.dependsOn.length >= 2) {
        violating.push(claim.claimNo)
        break
      }
    }
  }
  return [...new Set(violating)].sort((a, b) => a - b)
}

export const UpsertClaimElement = z.object({
  claimNo: z.number().int().positive().max(500),
  /** A, B, C… 構成要件の見出し。クレームチャートの行の識別子。 */
  elementKey: z.string().regex(/^[A-Z][A-Z0-9-]{0,7}$/, 'A〜Z で始まる 8 文字以内の記号にする'),
  text: z.string().min(1).max(5_000),
  /** 発明の本質にあたる要件か。新規性の勝ち筋を見つけるための印。 */
  isEssential: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().default(0),
})
export type UpsertClaimElement = z.infer<typeof UpsertClaimElement>

export const ClaimElement = UpsertClaimElement.extend({
  id: Id,
  organizationId: Id,
  matterId: Id,
  createdAt: Iso,
})
export type ClaimElement = z.infer<typeof ClaimElement>

/** クレームチャートの左側。要件ごとの典拠の数と照合の内訳。 */
export const ClaimElementSummary = ClaimElement.extend({
  evidenceCount: z.number().int().nonnegative(),
  /** 機械照合を通った件数（引用が原文に実在する）。 */
  verifiedCount: z.number().int().nonnegative(),
  /** **人間が開示を認めた件数。「この要件が塞がれているか」はこれで判断する。** */
  confirmedCount: z.number().int().nonnegative(),
  /** 人間が「開示にあたらない」と否定した件数。 */
  disputedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
})
export type ClaimElementSummary = z.infer<typeof ClaimElementSummary>

// ---------------------------------------------------------------------------
// 検索（式そのものを記録に残す）
// ---------------------------------------------------------------------------

export const SearchMode = z.enum(['fts', 'vector', 'hybrid'])
export type SearchMode = z.infer<typeof SearchMode>

export const CorpusSection = z.enum(['claim', 'desc', 'abstract'])
export type CorpusSection = z.infer<typeof CorpusSection>

export const RunSearch = z.object({
  /** どの構成要件のための検索か。要件に紐づかない探索的な検索は null。 */
  elementId: Id.nullable().default(null),
  terms: z.array(z.string().min(1).max(200)).min(1).max(20),
  op: z.enum(['AND', 'OR']).default('AND'),
  ipcPrefix: z.string().max(30).nullable().default(null),
  pubDateFrom: IsoDate.nullable().default(null),
  pubDateTo: IsoDate.nullable().default(null),
  sections: z.array(CorpusSection).max(3).default([]),
  limit: z.number().int().positive().max(500).default(50),
})
/*
 * `mode` は受け取らない。ベクトル検索はまだ Worker から呼ばれておらず、
 * 受け取ると「実行していない検索方式」が調査報告書に刻まれる。
 * 実装したときに足す（`SearchRecord.mode` は記録側なので残してある）。
 */
export type RunSearch = z.infer<typeof RunSearch>

export const SearchHit = z.object({
  pubNumber: z.string().min(1),
  paraNo: z.string().min(1),
  section: CorpusSection,
  title: z.string(),
  applicants: z.array(z.string()),
  pubDate: z.string().nullable(),
  snippet: z.string(),
  text: z.string(),
  score: z.number(),
})
export type SearchHit = z.infer<typeof SearchHit>

/**
 * 実行した検索の記録。調査報告書に必要であり、かつ再現性の担保でもある。
 * `matchExpression` と `compiledSql` を残しているのは、後から「何をどう探したか」を
 * 人間が検証できるようにするためである。
 */
export const SearchRecord = z.object({
  id: Id,
  organizationId: Id,
  matterId: Id,
  elementId: Id.nullable(),
  query: RunSearch,
  matchExpression: z.string().nullable(),
  compiledSql: z.string().nullable(),
  mode: SearchMode,
  hitCount: z.number().int().nonnegative(),
  /**
   * ヒットのうち公開日が不明な公報の件数。日付で絞ってもこれらは落とさずにヒットさせ、
   * 件数で告げる。出願日より前の公開かどうかが判断の全てである製品で、
   * 「日付が読めなかった文献が黙って消える」のは危険だからである。
   */
  undatedCount: z.number().int().nonnegative(),
  /** 区切りを含んでいたため、連続性を諦めて AND に落とした語。黙って落とさない。 */
  splitTerms: z.array(z.string()),
  /** トークンが作れず検索から外れた語。 */
  droppedTerms: z.array(z.string()),
  /** 検索時点のコーパスの取り込みバッチ数。コーパスが変わったことを検知するため。 */
  corpusBatchCount: z.number().int().nonnegative(),
  /** ベクトル検索で実際に走査したチャンク数。「見た範囲」の申告。 */
  searchedChunks: z.number().int().nonnegative().nullable(),
  /** ベクトルのモデル名。deterministic なら意味ベクトルではないと UI に出す。 */
  vectorModel: z.string().nullable(),
  vectorSemantic: z.boolean().nullable(),
  executedAt: Iso,
})
export type SearchRecord = z.infer<typeof SearchRecord>

export const SearchResponse = z.object({
  record: SearchRecord,
  hits: z.array(SearchHit),
})
export type SearchResponse = z.infer<typeof SearchResponse>

// ---------------------------------------------------------------------------
// 典拠（製品の心臓）
// ---------------------------------------------------------------------------

/** 機械照合の結果。**クライアントは決して指定できない**（Worker がコーパスに聞いて決める）。 */
export const QuoteCheck = z.enum([
  'pending',
  'verified',
  'quote_mismatch',
  'paragraph_missing',
  'publication_missing',
  'not_in_corpus_tier2',
  'quote_empty',
  /**
   * 引用が短すぎて典拠にならない。作話（quote_mismatch）とは直し方が違うので分ける
   * ——「前後を含めて引用し直す」で回復できる。
   * 下限が無いと、AI は引用文を「る」「を」にするだけで照合を通せる（実測で確認）。
   */
  'quote_too_short',
])
export type QuoteCheck = z.infer<typeof QuoteCheck>

/** 引用が構成要件に対して持つ法的な意味。X/Y/A は欧州の慣行なので使わない。 */
export const EvidenceRelation = z.enum([
  'discloses', // その構成要件を開示している
  'suggests', // 示唆している
  'teaches_away', // 阻害要因になる
  'background', // 技術水準を示すだけ
  'unrelated', // 関係ない
])
export type EvidenceRelation = z.infer<typeof EvidenceRelation>

/** 人間の法的評価。機械照合とは独立した軸であり、混ぜてはならない。 */
export const EvidenceReview = z.enum(['unreviewed', 'confirmed', 'disputed'])
export type EvidenceReview = z.infer<typeof EvidenceReview>

export const EvidenceProducer = z.enum(['human', 'skill', 'search'])
export type EvidenceProducer = z.infer<typeof EvidenceProducer>

/**
 * 典拠の提出。**`quoteCheck` を含まない**のが要点である。
 * どんな JSON を送ってきても、Worker を通った時点で照合状態が確定する。
 */
export const ProposeEvidence = z.object({
  elementId: Id,
  pubNumber: z.string().min(1).max(64),
  paraNo: z.string().min(1).max(16),
  /**
   * 公報の当該段落から切り出した原文。1 文字でも違えば照合は通らない。
   * 短すぎる引用は照合を通さない（`quote_too_short`）。前後を含めて引用する。
   */
  quotedText: z.string().min(1).max(5_000),
  relation: EvidenceRelation,
  note: z.string().max(2_000).default(''),
  producedBy: EvidenceProducer.default('skill'),
})
export type ProposeEvidence = z.infer<typeof ProposeEvidence>

export const ReviewEvidence = z.object({
  review: EvidenceReview,
  relation: EvidenceRelation.optional(),
  reviewerNote: z.string().max(2_000).default(''),
})
export type ReviewEvidence = z.infer<typeof ReviewEvidence>

export const Evidence = z.object({
  id: Id,
  organizationId: Id,
  matterId: Id,
  elementId: Id,
  pubNumber: z.string(),
  paraNo: z.string(),
  quotedText: z.string(),
  relation: EvidenceRelation,
  note: z.string(),
  producedBy: EvidenceProducer,
  quoteCheck: QuoteCheck,
  /** 照合が通らなかったときに、AI の主張と実際の原文の差を人間が見るための手掛かり。 */
  quoteCheckDetail: z.string().nullable(),
  review: EvidenceReview,
  reviewerNote: z.string(),
  reviewedAt: Iso.nullable(),
  createdAt: Iso,
  /** 表示用に添える公報の書誌（毎回コーパスへ問い合わせずに済ませる）。 */
  title: z.string().nullable(),
  applicants: z.array(z.string()),
  pubDate: z.string().nullable(),
})
export type Evidence = z.infer<typeof Evidence>

/**
 * その典拠が「構成要件を塞いでいる」と言えるか。UI とスキルはこの述語だけを通して判断する。
 *
 * **2 つの軸の両方を要求する。**
 * - `quoteCheck === 'verified'`（機械）: 引用文がその段落の原文に実在する
 * - `review === 'confirmed'`（人間）: その引用がこの構成要件の開示にあたる
 *
 * 機械が確かめるのは前者だけである。**`relation` は送り手（スキル）の自己申告**であり、
 * 誰も検証していない。だから `verified && relation==='discloses'` を支持と数えると、
 * AI が無関係な公報の実在する一文を `discloses` と称して積むだけで、
 * 構成要件が「塞がれた」ことになってしまう。それは出願を諦めさせる方向の誤りであり、
 * この製品で最も避けたい壊れ方である。
 */
export function isSupporting(
  evidence: Pick<Evidence, 'quoteCheck' | 'relation' | 'review'>,
): boolean {
  return (
    evidence.quoteCheck === 'verified' &&
    evidence.review === 'confirmed' &&
    (evidence.relation === 'discloses' || evidence.relation === 'suggests')
  )
}

/** 照合が失敗した（= 支持の根拠にならないが、記録として残す）状態かどうか。 */
export function isRejectedQuote(quoteCheck: QuoteCheck): boolean {
  return (
    quoteCheck === 'quote_mismatch' ||
    quoteCheck === 'paragraph_missing' ||
    quoteCheck === 'publication_missing' ||
    quoteCheck === 'quote_empty' ||
    quoteCheck === 'quote_too_short'
  )
}

// ---------------------------------------------------------------------------
// 特許性の判断
// ---------------------------------------------------------------------------

export const AssessmentKind = z.enum(['novelty', 'inventive_step'])
export type AssessmentKind = z.infer<typeof AssessmentKind>

/**
 * 進歩性における「組合せの動機付け」の類型（特許・実用新案審査基準 第III部第2章第2節）。
 * 自由記述にせず 4 類型の enum にしているのは、審査官と同じ土俵で議論するためである。
 */
export const MotivationType = z.enum([
  'technical_field', // 技術分野の関連性
  'problem', // 課題の共通性
  'function', // 作用・機能の共通性
  'suggestion', // 引用発明の内容中の示唆
])
export type MotivationType = z.infer<typeof MotivationType>

/** 進歩性を否定する方向に働く類型。 */
export const NegativeType = z.enum(['design_change', 'mere_aggregation'])
export type NegativeType = z.infer<typeof NegativeType>

export const AssessmentConclusion = z.enum([
  'likely_patentable', // 通りそう
  'risky', // 危うい
  'blocked', // 塞がれている
  'undetermined', // まだ言えない
])
export type AssessmentConclusion = z.infer<typeof AssessmentConclusion>

export const UpsertAssessment = z
  .object({
    kind: AssessmentKind,
    /** 主引用発明の公報番号。 */
    primaryRef: z.string().max(64).nullable().default(null),
    /** 副引用発明。**新規性の判断では使わない**（単一文献主義）。 */
    secondaryRefs: z.array(z.string().min(1).max(64)).max(20).default([]),
    motivationType: MotivationType.nullable().default(null),
    advantageousEffects: z.string().max(10_000).default(''),
    /** 阻害要因。進歩性の論証でここを空にしたまま結論を出させない。 */
    hindrance: z.string().max(10_000).default(''),
    negativeType: NegativeType.nullable().default(null),
    reasoning: z.string().max(50_000).default(''),
    conclusion: AssessmentConclusion.default('undetermined'),
  })
  .superRefine((value, ctx) => {
    // 新規性は単一文献主義。副引用や動機付けが付いていたら、それは進歩性の議論である。
    if (value.kind === 'novelty' && value.secondaryRefs.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['secondaryRefs'],
        message: '新規性は単一文献で判断する。副引用を挙げるなら kind を inventive_step にする。',
      })
    }
    if (value.kind === 'novelty' && value.motivationType !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['motivationType'],
        message: '組合せの動機付けは進歩性の論点であり、新規性には現れない。',
      })
    }
    // 進歩性で「通りそう」と結論するなら、主引用が特定されていなければ議論が成立しない。
    if (
      value.kind === 'inventive_step' &&
      value.conclusion !== 'undetermined' &&
      value.primaryRef === null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['primaryRef'],
        message: '進歩性の結論を出すには主引用発明を特定する。',
      })
    }
  })
export type UpsertAssessment = z.infer<typeof UpsertAssessment>

export const Assessment = z.object({
  id: Id,
  organizationId: Id,
  matterId: Id,
  kind: AssessmentKind,
  primaryRef: z.string().nullable(),
  secondaryRefs: z.array(z.string()),
  motivationType: MotivationType.nullable(),
  advantageousEffects: z.string(),
  hindrance: z.string(),
  negativeType: NegativeType.nullable(),
  reasoning: z.string(),
  conclusion: AssessmentConclusion,
  createdAt: Iso,
})
export type Assessment = z.infer<typeof Assessment>

// ---------------------------------------------------------------------------
// 明細書ドラフト
// ---------------------------------------------------------------------------

/**
 * 明細書の節。施行規則 様式第29 の見出しに 1:1 で対応させてある。
 * 後フェーズの様式変換器が、この enum をそのまま【 】見出しに写せる形にしている。
 */
export const DraftSection = z.enum([
  'title', // 【発明の名称】
  'technical_field', // 【技術分野】
  'background_art', // 【背景技術】
  'prior_art_documents', // 【先行技術文献】【特許文献】
  'problem', // 【発明が解決しようとする課題】
  'solution', // 【課題を解決するための手段】
  'advantageous_effects', // 【発明の効果】
  'brief_description_of_drawings', // 【図面の簡単な説明】
  'description_of_embodiments', // 【発明を実施するための形態】
  'examples', // 【実施例】
  'industrial_applicability', // 【産業上の利用可能性】
  'reference_signs', // 【符号の説明】
  'claims', // 【特許請求の範囲】
  'abstract', // 【要約】
])
export type DraftSection = z.infer<typeof DraftSection>

/** 【 】見出しの正式な表記。様式変換とUIの見出しがずれないように 1 か所で持つ。 */
export const DRAFT_SECTION_HEADINGS: Record<DraftSection, string> = {
  title: '発明の名称',
  technical_field: '技術分野',
  background_art: '背景技術',
  prior_art_documents: '先行技術文献',
  problem: '発明が解決しようとする課題',
  solution: '課題を解決するための手段',
  advantageous_effects: '発明の効果',
  brief_description_of_drawings: '図面の簡単な説明',
  description_of_embodiments: '発明を実施するための形態',
  examples: '実施例',
  industrial_applicability: '産業上の利用可能性',
  reference_signs: '符号の説明',
  claims: '特許請求の範囲',
  abstract: '要約',
}

/** 要約書の上限。400 字超は電子出願でエラー、200 字未満は警告。 */
export const ABSTRACT_MAX_CHARS = 400
export const ABSTRACT_MIN_RECOMMENDED_CHARS = 200

export const UpsertDraft = z
  .object({
    section: DraftSection,
    markdown: z.string().max(200_000),
  })
  .superRefine((value, ctx) => {
    if (value.section !== 'abstract') return
    // 文字数は書記素ではなくコードポイントで数える（電子出願の字数の考え方に合わせる）。
    const length = Array.from(value.markdown).length
    if (length > ABSTRACT_MAX_CHARS) {
      ctx.addIssue({
        code: 'custom',
        path: ['markdown'],
        message: `要約は ${ABSTRACT_MAX_CHARS} 字以内にする（現在 ${length} 字）。`,
      })
    }
  })
export type UpsertDraft = z.infer<typeof UpsertDraft>

export const Draft = z.object({
  id: Id,
  organizationId: Id,
  matterId: Id,
  revision: z.number().int().positive(),
  section: DraftSection,
  markdown: z.string(),
  createdAt: Iso,
})
export type Draft = z.infer<typeof Draft>

/** 記載要件などの機械チェック。人間が最後に見る前の足切り。 */
export const DraftCheckKey = z.enum([
  'enablement', // 36条4項1号 実施可能要件
  'support', // 36条6項1号 サポート要件
  'clarity', // 36条6項2号 明確性要件
  'hardware_cooperation', // 29条1項柱書 ソフトウェア関連発明の発明該当性
  'abstract_length', // 要約 400 字
  'multi_multi', // 施行規則24条の3第5号 マルチマルチクレーム
  'element_evidence', // 全構成要件に典拠の検討が行われているか
])
export type DraftCheckKey = z.infer<typeof DraftCheckKey>

export const DraftCheckResult = z.enum(['pass', 'warn', 'fail', 'not_checked'])
export type DraftCheckResult = z.infer<typeof DraftCheckResult>

export const DraftCheck = z.object({
  id: Id,
  organizationId: Id,
  matterId: Id,
  checkKey: DraftCheckKey,
  result: DraftCheckResult,
  detail: z.string(),
  checkedAt: Iso,
})
export type DraftCheck = z.infer<typeof DraftCheck>

// ---------------------------------------------------------------------------
// 分析ジョブ（Claude Code スキルが拾うキュー）
// ---------------------------------------------------------------------------

export const JobKind = z.enum([
  'search', // 構成要件から検索式を組み、典拠候補を集める
  'assess', // 新規性・進歩性の論証を組む
  'draft', // 明細書ドラフトを起こす
  'refine_disclosure', // 発明の聞き取りを深める
])
export type JobKind = z.infer<typeof JobKind>

export const JobStatus = z.enum(['queued', 'running', 'done', 'failed'])
export type JobStatus = z.infer<typeof JobStatus>

export const CreateJob = z.object({
  kind: JobKind,
  /** スキルへ渡す任意の指示。「こういう方向でまとめてほしい」を人間が書く場所。 */
  instruction: z.string().max(10_000).default(''),
})
export type CreateJob = z.infer<typeof CreateJob>

export const ClaimJob = z.object({
  /** 同じジョブを二重に走らせないための実行者の識別子。 */
  runner: z.string().min(1).max(200),
})
export type ClaimJob = z.infer<typeof ClaimJob>

export const CompleteJob = z.object({
  status: z.enum(['done', 'failed']),
  error: z.string().max(5_000).nullable().default(null),
  resultRef: z.string().max(500).nullable().default(null),
})
export type CompleteJob = z.infer<typeof CompleteJob>

export const Job = z.object({
  id: Id,
  organizationId: Id,
  matterId: Id,
  kind: JobKind,
  status: JobStatus,
  instruction: z.string(),
  runner: z.string().nullable(),
  error: z.string().nullable(),
  resultRef: z.string().nullable(),
  requestedAt: Iso,
  startedAt: Iso.nullable(),
  finishedAt: Iso.nullable(),
})
export type Job = z.infer<typeof Job>

// ---------------------------------------------------------------------------
// コーパスの状態（「見た範囲」を利用者に示す）
// ---------------------------------------------------------------------------

export const CorpusStatus = z.object({
  reachable: z.boolean(),
  /** サイドカーに届かないときの理由。黙って 0 件を返さないための欄。 */
  detail: z.string().nullable(),
  publications: z.number().int().nonnegative(),
  withFulltext: z.number().int().nonnegative(),
  paragraphs: z.number().int().nonnegative(),
  chunks: z.number().int().nonnegative(),
  batches: z.number().int().nonnegative(),
  extractFailures: z.number().int().nonnegative(),
  byIpcSubclass: z.record(z.string(), z.number().int().nonnegative()),
})
export type CorpusStatus = z.infer<typeof CorpusStatus>

// ---------------------------------------------------------------------------
// コーパスサイドカーの応答（Worker はこれで検証してから使う）
// ---------------------------------------------------------------------------

/**
 * 段落の引き当て結果。**欄が欠けたまま照合に渡してはならない。**
 * `checkQuote` の `publicationExists` / `fulltextAvailable` は既定 true なので、
 * 欠けた応答をそのまま渡すと「保留」であるべきものが「却下」に化け、
 * コーパス側の事故が AI の作話として記録される。だから必須で受ける。
 */
export const CorpusParagraphLookup = z.object({
  pubNumber: z.string(),
  paraNo: z.string(),
  publicationExists: z.boolean(),
  fulltextAvailable: z.boolean(),
  sectionsIngested: z.array(CorpusSection),
  text: z.string().nullable(),
  title: z.string().nullable(),
  applicants: z.array(z.string()),
  pubDate: z.string().nullable(),
})
export type CorpusParagraphLookup = z.infer<typeof CorpusParagraphLookup>

export const CorpusParagraphsResponse = z.object({
  paragraphs: z.array(CorpusParagraphLookup),
})
export type CorpusParagraphsResponse = z.infer<typeof CorpusParagraphsResponse>

export const CorpusSearchResponse = z.object({
  hits: z.array(SearchHit),
  hitCount: z.number().int().nonnegative(),
  undatedCount: z.number().int().nonnegative(),
  matchExpression: z.string().nullable(),
  splitTerms: z.array(z.string()),
  droppedTerms: z.array(z.string()),
  compiledSql: z.string().nullable(),
  executedAt: z.string(),
  corpusBatchCount: z.number().int().nonnegative(),
})
export type CorpusSearchResponse = z.infer<typeof CorpusSearchResponse>

export const CorpusStatsResponse = CorpusStatus.omit({ reachable: true, detail: true })
export type CorpusStatsResponse = z.infer<typeof CorpusStatsResponse>

// ---------------------------------------------------------------------------
// グラフ（公報と典拠の関係）
// ---------------------------------------------------------------------------

export const GraphNodeKind = z.enum(['element', 'publication'])
export type GraphNodeKind = z.infer<typeof GraphNodeKind>

export const GraphNode = z.object({
  id: z.string().min(1),
  kind: GraphNodeKind,
  label: z.string(),
  /** 公報ノードなら、その公報が支持している要件の数。要件ノードなら典拠の数。 */
  weight: z.number().int().nonnegative(),
})
export type GraphNode = z.infer<typeof GraphNode>

export const GraphEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  relation: EvidenceRelation,
  quoteCheck: QuoteCheck,
})
export type GraphEdge = z.infer<typeof GraphEdge>

export const EvidenceGraph = z.object({
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
})
export type EvidenceGraph = z.infer<typeof EvidenceGraph>
