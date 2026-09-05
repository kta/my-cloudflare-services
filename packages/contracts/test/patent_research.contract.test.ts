import { describe, expect, it } from 'vitest'
import {
  ABSTRACT_MAX_CHARS,
  Assessment,
  ClaimElement,
  DRAFT_SECTION_HEADINGS,
  DraftSection,
  detectMultiMultiClaims,
  Evidence,
  isRejectedQuote,
  isSupporting,
  ProposeEvidence,
  QuoteCheck,
  RunSearch,
  SearchRecord,
  UpsertAssessment,
  UpsertClaimElement,
  UpsertDisclosure,
  UpsertDraft,
} from '../src/patent_research'

describe('ProposeEvidence', () => {
  const base = {
    elementId: 'el-1',
    pubNumber: '特開2018-134274',
    paraNo: '0032',
    quotedText: '瞳孔の中心座標を算出する',
    relation: 'discloses' as const,
  }

  it('照合状態を送りつけても契約から落ちる（送り手は照合済みを自称できない）', () => {
    const parsed = ProposeEvidence.parse({ ...base, quoteCheck: 'verified' })
    expect(parsed).not.toHaveProperty('quoteCheck')
  })

  it('人間のレビュー結果も送りつけられない', () => {
    const parsed = ProposeEvidence.parse({ ...base, review: 'confirmed' })
    expect(parsed).not.toHaveProperty('review')
  })

  it('引用が空なら拒否する（空文字は任意の文の部分文字列になってしまう）', () => {
    expect(ProposeEvidence.safeParse({ ...base, quotedText: '' }).success).toBe(false)
  })

  it('関係の値は決められた 5 つだけ（X/Y/A は欧州の慣行なので入れない）', () => {
    expect(ProposeEvidence.safeParse({ ...base, relation: 'X' }).success).toBe(false)
    for (const r of ['discloses', 'suggests', 'teaches_away', 'background', 'unrelated']) {
      expect(ProposeEvidence.safeParse({ ...base, relation: r }).success).toBe(true)
    }
  })

  it('既定の producedBy は skill（人間が入れたものは明示する）', () => {
    expect(ProposeEvidence.parse(base).producedBy).toBe('skill')
  })

  it('段落番号は 16 文字まで（C001 も 0032 も収まる）', () => {
    expect(ProposeEvidence.safeParse({ ...base, paraNo: 'C001' }).success).toBe(true)
    expect(ProposeEvidence.safeParse({ ...base, paraNo: 'x'.repeat(17) }).success).toBe(false)
  })
})

describe('isSupporting', () => {
  const confirmed = { quoteCheck: 'verified', review: 'confirmed' } as const

  it('機械が照合し、かつ人が開示を認めたときだけ支持になる', () => {
    expect(isSupporting({ ...confirmed, relation: 'discloses' })).toBe(true)
    expect(isSupporting({ ...confirmed, relation: 'suggests' })).toBe(true)
  })

  // relation は送り手（スキル）の自己申告であり、誰も検証していない。
  // 機械照合だけで支持と数えると、AI が無関係な公報の実在する一文を discloses と
  // 称して積むだけで構成要件が「塞がれた」ことになり、出願を諦めさせる。
  it('人がまだ確認していないものは支持にならない', () => {
    expect(
      isSupporting({ quoteCheck: 'verified', review: 'unreviewed', relation: 'discloses' }),
    ).toBe(false)
  })

  it('人が否定したものは支持にならない', () => {
    expect(
      isSupporting({ quoteCheck: 'verified', review: 'disputed', relation: 'discloses' }),
    ).toBe(false)
  })

  it('人が認めても、阻害・背景・無関係は支持にならない', () => {
    expect(isSupporting({ ...confirmed, relation: 'teaches_away' })).toBe(false)
    expect(isSupporting({ ...confirmed, relation: 'background' })).toBe(false)
    expect(isSupporting({ ...confirmed, relation: 'unrelated' })).toBe(false)
  })

  it('照合されていないものは、人が認めていても支持にならない', () => {
    for (const q of QuoteCheck.options.filter((o) => o !== 'verified')) {
      expect(isSupporting({ quoteCheck: q, review: 'confirmed', relation: 'discloses' })).toBe(
        false,
      )
    }
  })
})

describe('isRejectedQuote', () => {
  it('照合に失敗した状態を棄却として扱う', () => {
    expect(isRejectedQuote('quote_mismatch')).toBe(true)
    expect(isRejectedQuote('paragraph_missing')).toBe(true)
    expect(isRejectedQuote('publication_missing')).toBe(true)
    expect(isRejectedQuote('quote_empty')).toBe(true)
  })

  it('短すぎる引用も棄却として扱う（支持の根拠にしない）', () => {
    expect(isRejectedQuote('quote_too_short')).toBe(true)
  })

  it('未照合と「全文が無いため照合不能」は棄却ではない（無いとは言わない）', () => {
    expect(isRejectedQuote('pending')).toBe(false)
    expect(isRejectedQuote('not_in_corpus_tier2')).toBe(false)
  })

  it('照合済みは棄却ではない', () => {
    expect(isRejectedQuote('verified')).toBe(false)
  })
})

describe('detectMultiMultiClaims', () => {
  it('2 つ以上を引用する請求項を、2 つ以上を引用する請求項が引用したら違反', () => {
    const claims = [
      { claimNo: 1, dependsOn: [] },
      { claimNo: 2, dependsOn: [] },
      { claimNo: 3, dependsOn: [1, 2] },
      { claimNo: 4, dependsOn: [1, 2] },
      { claimNo: 5, dependsOn: [3, 4] },
    ]
    expect(detectMultiMultiClaims(claims)).toEqual([5])
  })

  it('択一引用が 1 段だけなら違反ではない', () => {
    expect(
      detectMultiMultiClaims([
        { claimNo: 1, dependsOn: [] },
        { claimNo: 2, dependsOn: [] },
        { claimNo: 3, dependsOn: [1, 2] },
      ]),
    ).toEqual([])
  })

  it('単一引用の連鎖はいくら深くても違反ではない', () => {
    expect(
      detectMultiMultiClaims([
        { claimNo: 1, dependsOn: [] },
        { claimNo: 2, dependsOn: [1] },
        { claimNo: 3, dependsOn: [2] },
        { claimNo: 4, dependsOn: [3] },
      ]),
    ).toEqual([])
  })

  it('引用先が 1 つでも多数項引用なら違反（引用の一部だけが多数項でも該当する）', () => {
    expect(
      detectMultiMultiClaims([
        { claimNo: 1, dependsOn: [] },
        { claimNo: 2, dependsOn: [1] },
        { claimNo: 3, dependsOn: [1, 2] },
        { claimNo: 4, dependsOn: [2, 3] },
      ]),
    ).toEqual([4])
  })

  it('存在しない請求項を引用していても落ちない', () => {
    expect(detectMultiMultiClaims([{ claimNo: 1, dependsOn: [98, 99] }])).toEqual([])
  })

  it('引用が循環していても停止する', () => {
    expect(
      detectMultiMultiClaims([
        { claimNo: 1, dependsOn: [2, 3] },
        { claimNo: 2, dependsOn: [1, 3] },
        { claimNo: 3, dependsOn: [] },
      ]),
    ).toEqual([1, 2])
  })

  it('違反した請求項番号は昇順で重複なく返る', () => {
    const claims = [
      { claimNo: 9, dependsOn: [1, 2] },
      { claimNo: 5, dependsOn: [1, 2] },
      { claimNo: 1, dependsOn: [3, 4] },
      { claimNo: 2, dependsOn: [3, 4] },
      { claimNo: 3, dependsOn: [] },
      { claimNo: 4, dependsOn: [] },
    ]
    expect(detectMultiMultiClaims(claims)).toEqual([5, 9])
  })

  it('請求項が無ければ空', () => {
    expect(detectMultiMultiClaims([])).toEqual([])
  })
})

describe('UpsertAssessment', () => {
  const novelty = { kind: 'novelty' as const }
  const step = { kind: 'inventive_step' as const }

  it('新規性に副引用を付けたら拒否する（単一文献主義）', () => {
    const r = UpsertAssessment.safeParse({ ...novelty, secondaryRefs: ['特開2019-1'] })
    expect(r.success).toBe(false)
  })

  it('新規性に組合せの動機付けを付けたら拒否する', () => {
    const r = UpsertAssessment.safeParse({ ...novelty, motivationType: 'problem' })
    expect(r.success).toBe(false)
  })

  it('新規性で主引用だけなら通る', () => {
    expect(UpsertAssessment.safeParse({ ...novelty, primaryRef: '特開2018-1' }).success).toBe(true)
  })

  it('進歩性で結論を出すのに主引用が無ければ拒否する', () => {
    expect(UpsertAssessment.safeParse({ ...step, conclusion: 'likely_patentable' }).success).toBe(
      false,
    )
  })

  it('進歩性でも結論が undetermined なら主引用が無くてよい（調査の途中）', () => {
    expect(UpsertAssessment.safeParse(step).success).toBe(true)
  })

  it('動機付けの類型は審査基準の 4 つだけ', () => {
    for (const m of ['technical_field', 'problem', 'function', 'suggestion']) {
      const r = UpsertAssessment.safeParse({ ...step, primaryRef: 'A', motivationType: m })
      expect(r.success).toBe(true)
    }
    expect(
      UpsertAssessment.safeParse({ ...step, primaryRef: 'A', motivationType: 'vibes' }).success,
    ).toBe(false)
  })

  it('阻害要因と有利な効果の欄が既定で空文字として存在する（欄ごと消さない）', () => {
    const parsed = UpsertAssessment.parse(step)
    expect(parsed.hindrance).toBe('')
    expect(parsed.advantageousEffects).toBe('')
  })
})

describe('UpsertDraft の要約', () => {
  it('ちょうど 400 字は通る', () => {
    const r = UpsertDraft.safeParse({
      section: 'abstract',
      markdown: 'あ'.repeat(ABSTRACT_MAX_CHARS),
    })
    expect(r.success).toBe(true)
  })

  it('401 字は拒否する', () => {
    const r = UpsertDraft.safeParse({
      section: 'abstract',
      markdown: 'あ'.repeat(ABSTRACT_MAX_CHARS + 1),
    })
    expect(r.success).toBe(false)
  })

  it('サロゲートペアは 1 字として数える', () => {
    // 𠮷 は UTF-16 で 2 単位だが 1 文字。length で数えると 200 字で誤って弾く。
    const r = UpsertDraft.safeParse({
      section: 'abstract',
      markdown: '𠮷'.repeat(ABSTRACT_MAX_CHARS),
    })
    expect(r.success).toBe(true)
  })

  it('要約以外の節には字数の上限を課さない', () => {
    const r = UpsertDraft.safeParse({
      section: 'description_of_embodiments',
      markdown: 'あ'.repeat(50_000),
    })
    expect(r.success).toBe(true)
  })
})

describe('DRAFT_SECTION_HEADINGS', () => {
  it('すべての節に【 】の正式な見出しがある（様式変換で欠落を出さない）', () => {
    for (const section of DraftSection.options) {
      expect(DRAFT_SECTION_HEADINGS[section]).toBeTruthy()
    }
    expect(Object.keys(DRAFT_SECTION_HEADINGS)).toHaveLength(DraftSection.options.length)
  })
})

describe('UpsertClaimElement', () => {
  it('構成要件の記号は A〜Z 始まりの短い記号だけ', () => {
    const ok = { claimNo: 1, elementKey: 'A', text: '撮像部が眼部を撮像する' }
    expect(UpsertClaimElement.safeParse(ok).success).toBe(true)
    expect(UpsertClaimElement.safeParse({ ...ok, elementKey: 'A-1' }).success).toBe(true)
    expect(UpsertClaimElement.safeParse({ ...ok, elementKey: 'a' }).success).toBe(false)
    expect(UpsertClaimElement.safeParse({ ...ok, elementKey: '1' }).success).toBe(false)
    expect(UpsertClaimElement.safeParse({ ...ok, elementKey: 'ABCDEFGHI' }).success).toBe(false)
  })

  it('既定で本質的要件として扱う（勝ち筋の見落としを防ぐ）', () => {
    expect(UpsertClaimElement.parse({ claimNo: 1, elementKey: 'A', text: 'あ' }).isEssential).toBe(
      true,
    )
  })
})

describe('UpsertDisclosure', () => {
  it('外部 LLM への送信は既定で禁止', () => {
    expect(UpsertDisclosure.parse({}).externalLlmAllowed).toBe(false)
  })

  it('明示的に許可したときだけ true になる', () => {
    expect(UpsertDisclosure.parse({ externalLlmAllowed: true }).externalLlmAllowed).toBe(true)
  })
})

describe('RunSearch', () => {
  it('検索語が 1 つも無ければ拒否する（全件走査に落とさない）', () => {
    expect(RunSearch.safeParse({ terms: [] }).success).toBe(false)
  })

  it('日付は YYYY-MM-DD だけ受ける', () => {
    expect(RunSearch.safeParse({ terms: ['瞳孔'], pubDateFrom: '2018/01/01' }).success).toBe(false)
    expect(RunSearch.safeParse({ terms: ['瞳孔'], pubDateFrom: '2018-01-01' }).success).toBe(true)
  })

  // 検索方式は受け取らない。ベクトル検索はまだ Worker から呼ばれておらず、
  // 受け取ると「実行していない検索方式」が調査報告書に刻まれる。
  it('検索方式を受け取らない（実行していない方式を記録に残さない）', () => {
    expect(RunSearch.parse({ terms: ['瞳孔'], mode: 'vector' })).not.toHaveProperty('mode')
  })

  it('件数の上限は 500（青天井にしない）', () => {
    expect(RunSearch.safeParse({ terms: ['瞳孔'], limit: 501 }).success).toBe(false)
  })
})

describe('SearchRecord', () => {
  it('「見た範囲」を示す欄を必ず持つ（0 件と見ていないを混同させない）', () => {
    const shape = SearchRecord.shape
    for (const key of [
      'matchExpression',
      'compiledSql',
      'hitCount',
      'undatedCount',
      'splitTerms',
      'droppedTerms',
      'corpusBatchCount',
    ] as const) {
      expect(shape[key]).toBeDefined()
    }
  })
})

describe('応答スキーマ', () => {
  it('Evidence は照合状態と人間のレビューを別の欄として持つ', () => {
    const shape = Evidence.shape
    expect(shape.quoteCheck).toBeDefined()
    expect(shape.review).toBeDefined()
  })

  it('Assessment は阻害要因を必須の欄として持つ（空でも欄は消えない）', () => {
    expect(Assessment.shape.hindrance).toBeDefined()
  })

  it('ClaimElement は案件とテナントに属する', () => {
    expect(ClaimElement.shape.organizationId).toBeDefined()
    expect(ClaimElement.shape.matterId).toBeDefined()
  })
})
