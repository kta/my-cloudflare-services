import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/*
 * 典拠（Tenkyo）のドメインスキーマ。
 *
 * D1 = SQLite。リポジトリの規約:
 * - 外部キーを宣言しない。整合性はアプリ層で取る。
 * - ID はアプリ生成（crypto.randomUUID）。DB 生成 ID を使わない。
 * - すべてのドメイン行が organization_id を持ち、全クエリでスコープする。
 *
 * ここに入るのは「人間の作業と判断の記録」だけである。公報のコーパス（数百 GB）は
 * 別プロセスのローカル SQLite が持ち、この Worker は HTTP で問い合わせる。
 * 作り直せないのはこちらのデータであって、コーパスではない。
 */

// admin と同期しない、このサービス単独運用のための行。
// 規約の requireActiveOrg をそのまま成立させるために形は揃えてある
// （将来 admin を繋ぐときにコードを変えずに済む）。
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  plan: text('plan'), // 'free' | 'contracted'（null は 'free' 扱い）
  isDisabled: text('is_disabled'), // '0' | '1'（null は '0' 扱い）
  createdAt: text('created_at').notNull(),
})

/** 案件。1 つの発明 = 1 つの案件。 */
export const matters = sqliteTable(
  'matters',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    title: text('title').notNull(),
    techField: text('tech_field').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('matters_org_updated_idx').on(t.organizationId, t.updatedAt)],
)

/**
 * 発明開示。**未出願の秘密**であり、この行の本文が外部へ出る経路を作ってはならない。
 * external_llm_allowed が false の案件では、プロバイダ選択が外部を返さない（アプリ層で強制）。
 * 改訂は行を積む（上書きしない）。何をいつ書いたかが後で必要になる。
 */
export const disclosures = sqliteTable(
  'disclosures',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    matterId: text('matter_id').notNull(),
    revision: text('revision').notNull(), // 数値だが SQLite の型親和性を避けて文字列で持つ
    problem: text('problem').notNull(),
    solution: text('solution').notNull(),
    effects: text('effects').notNull(),
    embodiments: text('embodiments').notNull(),
    keywords: text('keywords').notNull(), // JSON 配列
    externalLlmAllowed: text('external_llm_allowed').notNull(), // '0' | '1'
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('disclosures_matter_idx').on(t.organizationId, t.matterId, t.createdAt)],
)

/** 「こんなのが欲しい」→「こういう形で？」→ OK の対話ログ。 */
export const disclosureMessages = sqliteTable(
  'disclosure_messages',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    matterId: text('matter_id').notNull(),
    role: text('role').notNull(), // 'user' | 'assistant'
    content: text('content').notNull(),
    provider: text('provider').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('disclosure_messages_matter_idx').on(t.organizationId, t.matterId, t.createdAt)],
)

/** 請求項。depends_on からマルチマルチクレームを機械検出する。 */
export const claims = sqliteTable(
  'claims',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    matterId: text('matter_id').notNull(),
    claimNo: text('claim_no').notNull(),
    category: text('category').notNull(),
    dependsOn: text('depends_on').notNull(), // JSON 配列（数値）
    text: text('text').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('claims_key_idx').on(t.organizationId, t.matterId, t.claimNo)],
)

/** 構成要件。クレームチャートの行の見出し。 */
export const claimElements = sqliteTable(
  'claim_elements',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    matterId: text('matter_id').notNull(),
    claimNo: text('claim_no').notNull(),
    elementKey: text('element_key').notNull(),
    text: text('text').notNull(),
    isEssential: text('is_essential').notNull(), // '0' | '1'
    sortOrder: text('sort_order').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('claim_elements_key_idx').on(t.organizationId, t.matterId, t.claimNo, t.elementKey),
    index('claim_elements_matter_idx').on(t.organizationId, t.matterId, t.sortOrder),
  ],
)

/**
 * 検索の記録。調査報告書に必要で、かつ再現性の担保でもある。
 * 実行した MATCH 式と SQL をそのまま残すので、後から人間が「何をどう探したか」を検証できる。
 */
export const searches = sqliteTable(
  'searches',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    matterId: text('matter_id').notNull(),
    elementId: text('element_id'),
    query: text('query').notNull(), // JSON（RunSearch）
    matchExpression: text('match_expression'),
    compiledSql: text('compiled_sql'),
    mode: text('mode').notNull(),
    hitCount: text('hit_count').notNull(),
    undatedCount: text('undated_count').notNull(),
    splitTerms: text('split_terms').notNull(), // JSON 配列
    droppedTerms: text('dropped_terms').notNull(), // JSON 配列
    corpusBatchCount: text('corpus_batch_count').notNull(),
    searchedChunks: text('searched_chunks'),
    vectorModel: text('vector_model'),
    vectorSemantic: text('vector_semantic'),
    executedAt: text('executed_at').notNull(),
  },
  (t) => [index('searches_matter_idx').on(t.organizationId, t.matterId, t.executedAt)],
)

export const searchHits = sqliteTable(
  'search_hits',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    searchId: text('search_id').notNull(),
    pubNumber: text('pub_number').notNull(),
    paraNo: text('para_no').notNull(),
    section: text('section').notNull(),
    rank: text('rank').notNull(),
    score: text('score').notNull(),
    snippet: text('snippet').notNull(),
    title: text('title').notNull(),
    applicants: text('applicants').notNull(), // JSON 配列
    pubDate: text('pub_date'),
  },
  (t) => [index('search_hits_search_idx').on(t.organizationId, t.searchId, t.rank)],
)

/**
 * 典拠。製品の心臓。
 *
 * quote_check は **Worker がコーパスに問い合わせて決める**。クライアント（スキル）は
 * 契約にこの欄を持たないので、照合済みを自称できない。
 * review は人間の法的評価であり、quote_check とは独立した軸である。混ぜてはならない。
 */
export const evidence = sqliteTable(
  'evidence',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    matterId: text('matter_id').notNull(),
    elementId: text('element_id').notNull(),
    pubNumber: text('pub_number').notNull(),
    paraNo: text('para_no').notNull(),
    quotedText: text('quoted_text').notNull(),
    relation: text('relation').notNull(),
    note: text('note').notNull(),
    producedBy: text('produced_by').notNull(),
    quoteCheck: text('quote_check').notNull(),
    quoteCheckDetail: text('quote_check_detail'),
    review: text('review').notNull(),
    reviewerNote: text('reviewer_note').notNull(),
    reviewedAt: text('reviewed_at'),
    title: text('title'),
    applicants: text('applicants').notNull(), // JSON 配列
    pubDate: text('pub_date'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('evidence_element_idx').on(t.organizationId, t.elementId, t.createdAt),
    index('evidence_matter_idx').on(t.organizationId, t.matterId, t.createdAt),
    // 同じ (要件, 公報, 段落) の典拠を二重に積まない
    uniqueIndex('evidence_key_idx').on(t.organizationId, t.elementId, t.pubNumber, t.paraNo),
  ],
)

/** 新規性・進歩性の論証。動機付けは審査基準の 4 類型を enum で持つ。 */
export const assessments = sqliteTable(
  'assessments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    matterId: text('matter_id').notNull(),
    kind: text('kind').notNull(),
    primaryRef: text('primary_ref'),
    secondaryRefs: text('secondary_refs').notNull(), // JSON 配列
    motivationType: text('motivation_type'),
    advantageousEffects: text('advantageous_effects').notNull(),
    hindrance: text('hindrance').notNull(),
    negativeType: text('negative_type'),
    reasoning: text('reasoning').notNull(),
    conclusion: text('conclusion').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('assessments_matter_idx').on(t.organizationId, t.matterId, t.createdAt)],
)

/** 明細書ドラフト。section は施行規則の見出しに 1:1 で対応する。改訂は行を積む。 */
export const drafts = sqliteTable(
  'drafts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    matterId: text('matter_id').notNull(),
    revision: text('revision').notNull(),
    section: text('section').notNull(),
    markdown: text('markdown').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('drafts_matter_idx').on(t.organizationId, t.matterId, t.section, t.revision)],
)

/** 記載要件などの機械チェック。人間が最後に見る前の足切り。 */
export const draftChecks = sqliteTable(
  'draft_checks',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    matterId: text('matter_id').notNull(),
    checkKey: text('check_key').notNull(),
    result: text('result').notNull(),
    detail: text('detail').notNull(),
    checkedAt: text('checked_at').notNull(),
  },
  (t) => [uniqueIndex('draft_checks_key_idx').on(t.organizationId, t.matterId, t.checkKey)],
)

/** Claude Code スキルが拾うキュー。手動でも /loop でも起動できる。 */
export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    matterId: text('matter_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    instruction: text('instruction').notNull(),
    runner: text('runner'),
    error: text('error'),
    resultRef: text('result_ref'),
    requestedAt: text('requested_at').notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (t) => [
    index('jobs_status_idx').on(t.organizationId, t.status, t.requestedAt),
    index('jobs_matter_idx').on(t.organizationId, t.matterId, t.requestedAt),
  ],
)
