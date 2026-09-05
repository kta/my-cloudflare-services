import {
  Assessment,
  Claim,
  ClaimElementSummary,
  ClaimJob,
  CompleteJob,
  CorpusStatus,
  CreateJob,
  CreateMatter,
  Disclosure,
  DisclosureMessage,
  Draft,
  DraftCheck,
  detectMultiMultiClaims,
  Evidence,
  EvidenceGraph,
  IssueTokenRequest,
  isRejectedQuote,
  isSupporting,
  Job,
  Matter,
  MatterSummary,
  Organization,
  type Plan,
  ProposeEvidence,
  ReviewEvidence,
  RunSearch,
  SearchHit,
  SearchRecord,
  SearchResponse,
  UpdateMatter,
  UpsertAssessment,
  UpsertClaim,
  UpsertClaimElement,
  UpsertDisclosure,
  UpsertDraft,
} from '@app/contracts'
import { checkQuote } from '@app/patent-corpus/pure'
import {
  type AuthVariables,
  internalAuth,
  type OrgResolver,
  requireActiveOrg,
  signAccessToken,
  tenantAuth,
} from '@app/shared'
import type { D1Database, Fetcher } from '@cloudflare/workers-types'
import { zValidator } from '@hono/zod-validator'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { except } from 'hono/combine'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import {
  type CorpusClient,
  CorpusUnavailable,
  createCorpusClient,
  type ParagraphLookup,
} from './corpus-client'
import {
  assessments,
  claimElements,
  claims,
  disclosureMessages,
  disclosures,
  draftChecks,
  drafts,
  evidence as evidenceTable,
  jobs,
  matters,
  organizations,
  searches,
  searchHits,
} from './db/schema'

/*
 * 典拠（Tenkyo）— 特許調査・出願支援サービスの Worker。
 *
 * 1 つの Worker が React SPA と Hono API を同一オリジンで配信する（CORS はどこにも無い）。
 * この D1 が持つのは「人間の作業と判断の記録」だけで、公報のコーパスは別プロセスが持つ。
 *
 * この Worker の一番大事な責務は **典拠の照合** である。スキルが送ってきた引用を、
 * コーパスの原文と機械的に突き合わせ、その結果を行に刻む。
 * スキルの善意に依存させないために、照合状態は契約の入力に含めない。
 */

export type Bindings = {
  DB: D1Database
  INTERNAL_KEY: string
  JWT_SECRET: string
  AUTH_DEV_GRANT?: string
  /** コーパスサイドカーの URL（実運用）。 */
  CORPUS_URL?: string
  /** コーパスサイドカーの代役（テストで miniflare が挿す）。 */
  CORPUS?: Fetcher
  /**
   * integration test の基準時刻。本番では設定せず実時刻を使う。
   * 時刻は必ず注入できるようにする（TEST_RULE。`Date.now()` 頼みのテストを書かないため）。
   */
  TEST_NOW?: string
}

/** いまの時刻。テストからは `TEST_NOW` で固定できる。 */
function nowIso(env: Bindings): string {
  return (env.TEST_NOW ? new Date(env.TEST_NOW) : new Date()).toISOString()
}

const app = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>()

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse()
  console.error('unhandled', err)
  return c.json({ error: 'internal_error' }, 500)
})

/**
 * 形の決まった JSON でエラーを投げる。
 * `new HTTPException(404, { message: 'x' })` は本文がただの文字列になり、
 * クライアントが JSON として読めない（API 規約はエラーも JSON の形を要求する）。
 */
function fail(status: 400 | 403 | 404 | 409 | 503, code: string, detail?: string): never {
  throw new HTTPException(status, {
    res: Response.json({ error: code, detail: detail ?? null }, { status }),
  })
}

app.use('/api/internal/*', internalAuth())

function toOrgFields(r: typeof organizations.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    plan: (r.plan ?? 'free') as Plan,
    isDisabled: r.isDisabled === '1',
    createdAt: r.createdAt,
  }
}

const orgResolver: OrgResolver = async (orgId, c) => {
  const db = drizzle((c.env as Bindings).DB)
  const rows = await db.select().from(organizations).where(eq(organizations.id, orgId))
  const row = rows[0]
  if (!row) return null
  const { plan, isDisabled } = toOrgFields(row)
  return { plan, isDisabled }
}

// default-deny: /api/* は例外を除き全てテナント JWT + 有効な org を要求する。
// ルートを足しただけで保護される（個別に認証を足して回らない）。
app.use(
  '/api/*',
  except(
    ['/api/health', '/api/auth/*', '/api/internal/*'],
    tenantAuth(),
    requireActiveOrg(orgResolver),
  ),
)

app.post('/api/auth/token', zValidator('json', IssueTokenRequest), async (c) => {
  if (c.env.AUTH_DEV_GRANT !== 'true') return c.json({ error: 'not_found' }, 404)
  const { organizationId, role, email } = c.req.valid('json')
  const db = drizzle(c.env.DB)
  await db
    .insert(organizations)
    .values({
      id: organizationId,
      name: organizationId,
      plan: 'free',
      isDisabled: '0',
      createdAt: nowIso(c.env),
    })
    .onConflictDoNothing({ target: organizations.id })
  const token = await signAccessToken(
    { sub: `dev:${organizationId}`, org: organizationId, email, role },
    c.env.JWT_SECRET,
  )
  return c.json({ token })
})

// ---------------------------------------------------------------------------
// 補助
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof drizzle>

const jsonArray = (values: readonly string[] | readonly number[]): string => JSON.stringify(values)
/**
 * 改訂番号。**0 埋めして保存する。** 素の '10' は '9' より小さいので、
 * 文字列のまま並べ替えると 10 版目が最新にならない。
 * 「最新の版」は、未出願の発明を外部へ送ってよいかの判断根拠でもあるので、
 * 挿入順のような暗黙の性質に依存させない。
 */
const REVISION_WIDTH = 6
const revisionOf = (n: number): string => String(n).padStart(REVISION_WIDTH, '0')
const parseArray = <T>(raw: string): T[] => {
  const parsed: unknown = JSON.parse(raw)
  return Array.isArray(parsed) ? (parsed as T[]) : []
}
const bool = (v: boolean): '0' | '1' => (v ? '1' : '0')
const isTrue = (v: string): boolean => v === '1'

/** 案件がこのテナントのものであることを毎回確かめる。body の値を認可の根拠にしない。 */
async function requireMatter(db: Db, org: string, matterId: string) {
  const rows = await db
    .select()
    .from(matters)
    .where(and(eq(matters.organizationId, org), eq(matters.id, matterId)))
  const row = rows[0]
  if (!row) fail(404, 'matter_not_found')
  return row
}

function toMatter(row: typeof matters.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    techField: row.techField,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * 行 → 契約の形。列挙の 3 欄は自分たちが書いた値しか入らないので、ここで型を戻す
 * （この 1 か所を通すことで、`isSupporting` のような述語が型のまま使える）。
 */
function toEvidence(row: typeof evidenceTable.$inferSelect): Evidence {
  return {
    id: row.id,
    organizationId: row.organizationId,
    matterId: row.matterId,
    elementId: row.elementId,
    pubNumber: row.pubNumber,
    paraNo: row.paraNo,
    quotedText: row.quotedText,
    relation: row.relation as Evidence['relation'],
    note: row.note,
    producedBy: row.producedBy as Evidence['producedBy'],
    quoteCheck: row.quoteCheck as Evidence['quoteCheck'],
    quoteCheckDetail: row.quoteCheckDetail,
    review: row.review as Evidence['review'],
    reviewerNote: row.reviewerNote,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    title: row.title,
    applicants: parseArray<string>(row.applicants),
    pubDate: row.pubDate,
  }
}

interface QuoteVerdict {
  quoteCheck: string
  quoteCheckDetail: string | null
  title: string | null
  applicants: string[]
  pubDate: string | null
  /**
   * 書誌がコーパス由来か。届かなかったときの null で、既に保存されている
   * 出願人・公開日を上書きしないための印。公開日は「出願日より前の公開か」＝
   * 先行技術かどうかの判断そのものなので、静かに消してはならない。
   */
  fromCorpus: boolean
}

/**
 * 段落原文から判定を作る。**この関数だけが quote_check を決める。**
 *
 * コーパスの応答が欠けている（`found` が無い）ときに既定値へ倒さないのが肝心である。
 * `checkQuote` の `publicationExists` / `fulltextAvailable` は既定 true なので、欄が欠けた
 * まま渡すと「保留」であるべきものが「却下」に化け、**コーパス側の事故が AI の作話として
 * 記録される**。設計書が名指しで避けている壊れ方なので、欠けたら `pending` に倒す。
 */
function verdictFor(
  found: ParagraphLookup | undefined,
  input: { paraNo: string; quotedText: string },
): QuoteVerdict {
  if (!found) {
    return {
      quoteCheck: 'pending',
      quoteCheckDetail: 'コーパスが段落を返さなかったため、照合できていない。',
      title: null,
      applicants: [],
      pubDate: null,
      fromCorpus: false,
    }
  }
  const verdict = checkQuote({
    quoted: input.quotedText,
    paragraphText: found.text,
    publicationExists: found.publicationExists,
    fulltextAvailable: found.fulltextAvailable,
    sectionsIngested: found.sectionsIngested,
    paraNo: input.paraNo,
  })
  return {
    quoteCheck: verdict.result,
    quoteCheckDetail: verdict.detail,
    title: found.title,
    applicants: found.applicants,
    pubDate: found.pubDate,
    fromCorpus: true,
  }
}

/**
 * 典拠 1 件の照合。
 *
 * コーパスに届かないときは `pending` のまま残す。握りつぶして verified にしないのはもちろん、
 * 却下（quote_mismatch 等）にもしない — コーパス側の事故を AI の作話として記録すると、
 * 「AI の信頼性を利用者が評価するための材料」という設計意図が逆向きに壊れる。
 */
async function verifyQuote(
  corpus: CorpusClient,
  input: { pubNumber: string; paraNo: string; quotedText: string },
): Promise<QuoteVerdict> {
  try {
    const [found] = await corpus.paragraphs([{ pubNumber: input.pubNumber, paraNo: input.paraNo }])
    return verdictFor(found, input)
  } catch (err) {
    if (err instanceof CorpusUnavailable) {
      return {
        quoteCheck: 'pending',
        quoteCheckDetail: `コーパスに届かないため未照合のまま保存した。${err.detail}`,
        title: null,
        applicants: [],
        pubDate: null,
        fromCorpus: false,
      }
    }
    throw err
  }
}

/**
 * D1 の 1 文あたりのバインドパラメータ上限。これを超えると
 * `too many SQL variables` で文ごと落ちる。**行数ではなく「列数 × 行数」で効く。**
 */
const D1_MAX_BIND_PARAMS = 100

/** 列数から、1 文に積める最大行数を出す。 */
function maxRowsPerStatement(columnCount: number): number {
  return Math.max(1, Math.floor(D1_MAX_BIND_PARAMS / columnCount))
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const UpsertElements = z
  .object({ elements: z.array(UpsertClaimElement).max(200) })
  .superRefine((value, ctx) => {
    // 同じ (請求項, 記号) が 2 つあると一意索引に衝突して batch ごと落ちる。
    // 入力の問題を 500 にしない。
    const seen = new Set<string>()
    value.elements.forEach((e, i) => {
      const key = `${e.claimNo}/${e.elementKey}`
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['elements', i, 'elementKey'],
          message: `構成要件の記号が重複している: 請求項${e.claimNo} の ${e.elementKey}`,
        })
      }
      seen.add(key)
    })
  })
// 契約の UpsertClaim を使う（規約3: Zod 単一ソース。同じ形を手書きしない）。
const UpsertClaims = z.object({ claims: z.array(UpsertClaim).max(500) })

// ---------------------------------------------------------------------------
// ルート（チェーンして AppType に載せる）
// ---------------------------------------------------------------------------

const routes = app
  .get('/api/health', (c) => c.json({ status: 'ok' as const }))

  .post('/api/internal/organizations', zValidator('json', Organization), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.req.valid('json')
    const row = {
      id: org.id,
      name: org.name,
      plan: org.plan,
      isDisabled: org.isDisabled ? ('1' as const) : ('0' as const),
      createdAt: org.createdAt,
    }
    await db
      .insert(organizations)
      .values(row)
      .onConflictDoUpdate({
        target: organizations.id,
        set: { name: row.name, plan: row.plan, isDisabled: row.isDisabled },
      })
    return c.json(org, 200)
  })

  // --- コーパスの状態 ------------------------------------------------------
  // 届かないときも 200 で「届いていない」と返す。画面が黙って 0 件を見せないため。
  .get('/api/corpus/status', async (c) => {
    const corpus = createCorpusClient(c.env)
    return c.json(CorpusStatus.parse(await corpus.status()))
  })

  // --- 案件 ---------------------------------------------------------------
  .get('/api/matters', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const rows = await db
      .select()
      .from(matters)
      .where(eq(matters.organizationId, org))
      .orderBy(desc(matters.updatedAt))
    const elements = await db
      .select()
      .from(claimElements)
      .where(eq(claimElements.organizationId, org))
    const ev = await db.select().from(evidenceTable).where(eq(evidenceTable.organizationId, org))
    const summaries = rows.map((row) => {
      const mine = ev.filter((e) => e.matterId === row.id)
      return {
        ...toMatter(row),
        elementCount: elements.filter((e) => e.matterId === row.id).length,
        evidenceCount: mine.length,
        verifiedCount: mine.filter((e) => e.quoteCheck === 'verified').length,
        confirmedCount: mine.filter((e) => isSupporting(toEvidence(e))).length,
        rejectedCount: mine.filter((e) => isRejectedQuote(toEvidence(e).quoteCheck)).length,
      }
    })
    return c.json(MatterSummary.array().parse(summaries))
  })

  .post('/api/matters', zValidator('json', CreateMatter), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const input = c.req.valid('json')
    const at = nowIso(c.env)
    const row = {
      id: crypto.randomUUID(),
      organizationId: org,
      title: input.title,
      techField: input.techField,
      status: 'intake' as const,
      createdAt: at,
      updatedAt: at,
    }
    await db.insert(matters).values(row)
    return c.json(Matter.parse(toMatter(row)), 201)
  })

  .get('/api/matters/:id', async (c) => {
    const db = drizzle(c.env.DB)
    const row = await requireMatter(db, c.get('auth').org, c.req.param('id'))
    return c.json(Matter.parse(toMatter(row)))
  })

  .patch('/api/matters/:id', zValidator('json', UpdateMatter), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const current = await requireMatter(db, org, c.req.param('id'))
    const patch = c.req.valid('json')
    const next = {
      title: patch.title ?? current.title,
      techField: patch.techField ?? current.techField,
      status: patch.status ?? current.status,
      updatedAt: nowIso(c.env),
    }
    await db
      .update(matters)
      .set(next)
      .where(and(eq(matters.organizationId, org), eq(matters.id, current.id)))
    return c.json(Matter.parse(toMatter({ ...current, ...next })))
  })

  // --- 発明開示（未出願の秘密） -------------------------------------------
  .get('/api/matters/:id/disclosure', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const rows = await db
      .select()
      .from(disclosures)
      .where(and(eq(disclosures.organizationId, org), eq(disclosures.matterId, matter.id)))
      .orderBy(desc(disclosures.revision))
    const row = rows[0]
    if (!row) return c.json(null)
    return c.json(
      Disclosure.parse({
        id: row.id,
        organizationId: row.organizationId,
        matterId: row.matterId,
        revision: Number(row.revision),
        problem: row.problem,
        solution: row.solution,
        effects: row.effects,
        embodiments: row.embodiments,
        keywords: parseArray<string>(row.keywords),
        externalLlmAllowed: isTrue(row.externalLlmAllowed),
        createdAt: row.createdAt,
      }),
    )
  })

  .put('/api/matters/:id/disclosure', zValidator('json', UpsertDisclosure), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const input = c.req.valid('json')
    const existing = await db
      .select()
      .from(disclosures)
      .where(and(eq(disclosures.organizationId, org), eq(disclosures.matterId, matter.id)))
    const row = {
      id: crypto.randomUUID(),
      organizationId: org,
      matterId: matter.id,
      // 改訂は行を積む。何をいつ書いたかが、後で必ず要る。
      revision: revisionOf(existing.length + 1),
      problem: input.problem,
      solution: input.solution,
      effects: input.effects,
      embodiments: input.embodiments,
      keywords: jsonArray(input.keywords),
      externalLlmAllowed: bool(input.externalLlmAllowed),
      createdAt: nowIso(c.env),
    }
    await db.insert(disclosures).values(row)
    return c.json(
      {
        ...row,
        revision: Number(row.revision),
        keywords: input.keywords,
        externalLlmAllowed: input.externalLlmAllowed,
      },
      201,
    )
  })

  .get('/api/matters/:id/messages', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const rows = await db
      .select()
      .from(disclosureMessages)
      .where(
        and(eq(disclosureMessages.organizationId, org), eq(disclosureMessages.matterId, matter.id)),
      )
      .orderBy(disclosureMessages.createdAt)
    return c.json(DisclosureMessage.array().parse(rows))
  })

  .post(
    '/api/matters/:id/messages',
    zValidator(
      'json',
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(50_000),
        provider: z.enum(['claude-code', 'gemini', 'local', 'human']).default('human'),
      }),
    ),
    async (c) => {
      const db = drizzle(c.env.DB)
      const org = c.get('auth').org
      const matter = await requireMatter(db, org, c.req.param('id'))
      const input = c.req.valid('json')
      // 未出願の発明に触れる対話を外部の無料枠へ流さない。案件の許可が無ければ拒む。
      if (input.provider === 'gemini') {
        const latest = await db
          .select()
          .from(disclosures)
          .where(and(eq(disclosures.organizationId, org), eq(disclosures.matterId, matter.id)))
          .orderBy(desc(disclosures.revision))
        if (!isTrue(latest[0]?.externalLlmAllowed ?? '0')) {
          fail(
            403,
            'external_llm_not_allowed',
            'この案件は未出願の発明を外部 LLM へ送ることを許可していない。発明開示の設定で明示的に許可する。',
          )
        }
      }
      const row = {
        id: crypto.randomUUID(),
        organizationId: org,
        matterId: matter.id,
        role: input.role,
        content: input.content,
        provider: input.provider,
        createdAt: nowIso(c.env),
      }
      await db.insert(disclosureMessages).values(row)
      return c.json(row, 201)
    },
  )

  // --- 請求項と構成要件 ---------------------------------------------------
  .get('/api/matters/:id/elements', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const rows = await db
      .select()
      .from(claimElements)
      .where(and(eq(claimElements.organizationId, org), eq(claimElements.matterId, matter.id)))
      .orderBy(claimElements.sortOrder)
    const ev = await db
      .select()
      .from(evidenceTable)
      .where(and(eq(evidenceTable.organizationId, org), eq(evidenceTable.matterId, matter.id)))
    const summaries = rows.map((row) => {
      const mine = ev.filter((e) => e.elementId === row.id)
      return {
        id: row.id,
        organizationId: row.organizationId,
        matterId: row.matterId,
        claimNo: Number(row.claimNo),
        elementKey: row.elementKey,
        text: row.text,
        isEssential: isTrue(row.isEssential),
        sortOrder: Number(row.sortOrder),
        createdAt: row.createdAt,
        evidenceCount: mine.length,
        verifiedCount: mine.filter((e) => e.quoteCheck === 'verified').length,
        // 「この要件が塞がれているか」は人間が認めた件数で判断する（relation は自己申告）。
        confirmedCount: mine.filter((e) => isSupporting(toEvidence(e))).length,
        disputedCount: mine.filter((e) => e.review === 'disputed').length,
        pendingCount: mine.filter(
          (e) => e.quoteCheck === 'pending' || e.quoteCheck === 'not_in_corpus_tier2',
        ).length,
        rejectedCount: mine.filter((e) => isRejectedQuote(toEvidence(e).quoteCheck)).length,
      }
    })
    return c.json(ClaimElementSummary.array().parse(summaries))
  })

  .put('/api/matters/:id/elements', zValidator('json', UpsertElements), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const { elements } = c.req.valid('json')
    const at = nowIso(c.env)
    const existing = await db
      .select()
      .from(claimElements)
      .where(and(eq(claimElements.organizationId, org), eq(claimElements.matterId, matter.id)))
    const byKey = new Map(existing.map((e) => [`${e.claimNo}/${e.elementKey}`, e]))
    const rows = elements.map((e) => {
      const found = byKey.get(`${e.claimNo}/${e.elementKey}`)
      return {
        // 既存の要件は id を保つ。id が変わると、その要件に付いた典拠が孤立する。
        id: found?.id ?? crypto.randomUUID(),
        organizationId: org,
        matterId: matter.id,
        claimNo: String(e.claimNo),
        elementKey: e.elementKey,
        text: e.text,
        isEssential: bool(e.isEssential),
        sortOrder: String(e.sortOrder),
        createdAt: found?.createdAt ?? at,
      }
    })
    const keep = new Set(rows.map((r) => r.id))
    const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id)
    const statements: BatchItem<'sqlite'>[] = []
    if (removed.length > 0) {
      // 要件を消したら、その要件に付いた典拠も消える（孤立した典拠を残さない）。
      // id は既にこのテナントのものだけだが、**削除にもテナントの条件を配る**
      // （規約6。将来この配列の出どころが変わったときに越境しないための保険）。
      statements.push(
        db
          .delete(evidenceTable)
          .where(
            and(eq(evidenceTable.organizationId, org), inArray(evidenceTable.elementId, removed)),
          ),
      )
      statements.push(
        db
          .delete(claimElements)
          .where(and(eq(claimElements.organizationId, org), inArray(claimElements.id, removed))),
      )
    }
    for (const row of rows) {
      statements.push(
        db
          .insert(claimElements)
          .values(row)
          .onConflictDoUpdate({
            target: claimElements.id,
            set: { text: row.text, isEssential: row.isEssential, sortOrder: row.sortOrder },
          }),
      )
    }
    if (statements.length > 0) {
      // D1 に対話的なトランザクションは無いので batch で原子性を得る
      // （要件の削除と typo 修正が途中で止まると、典拠が孤立した状態が残る）。
      await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
    }
    return c.json(
      rows.map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        matterId: r.matterId,
        claimNo: Number(r.claimNo),
        elementKey: r.elementKey,
        text: r.text,
        isEssential: isTrue(r.isEssential),
        sortOrder: Number(r.sortOrder),
        createdAt: r.createdAt,
      })),
      200,
    )
  })

  .put('/api/matters/:id/claims', zValidator('json', UpsertClaims), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const { claims: input } = c.req.valid('json')
    // マルチマルチクレーム（施行規則24条の3第5号、令和4年4月1日施行）は拒絶理由になる。
    // 保存は妨げないが、検査結果として必ず残す。
    const violating = detectMultiMultiClaims(input)
    const at = nowIso(c.env)

    // **請求項を実際に保存する。** 保存せずに検査だけすると、その判定が何に対する
    // ものだったのかを後から誰も再現できない（記録として残す、の趣旨に反する）。
    const existingClaims = await db
      .select()
      .from(claims)
      .where(and(eq(claims.organizationId, org), eq(claims.matterId, matter.id)))
    const byNo = new Map(existingClaims.map((r) => [r.claimNo, r]))
    const claimRows = input.map((cl) => ({
      id: byNo.get(String(cl.claimNo))?.id ?? crypto.randomUUID(),
      organizationId: org,
      matterId: matter.id,
      claimNo: String(cl.claimNo),
      category: cl.category,
      dependsOn: jsonArray(cl.dependsOn),
      text: cl.text,
      createdAt: byNo.get(String(cl.claimNo))?.createdAt ?? at,
    }))
    const keepClaims = new Set(claimRows.map((r) => r.id))
    const claimStatements: BatchItem<'sqlite'>[] = []
    const removedClaims = existingClaims.filter((r) => !keepClaims.has(r.id)).map((r) => r.id)
    if (removedClaims.length > 0) {
      claimStatements.push(
        db
          .delete(claims)
          .where(and(eq(claims.organizationId, org), inArray(claims.id, removedClaims))),
      )
    }
    for (const part of chunk(claimRows, maxRowsPerStatement(8))) {
      claimStatements.push(
        db
          .insert(claims)
          .values(part)
          .onConflictDoUpdate({
            target: claims.id,
            set: {
              category: sql`excluded.category`,
              dependsOn: sql`excluded.depends_on`,
              text: sql`excluded.text`,
            },
          }),
      )
    }
    if (claimStatements.length > 0) {
      await db.batch(claimStatements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
    }
    await db
      .insert(draftChecks)
      .values({
        id: crypto.randomUUID(),
        organizationId: org,
        matterId: matter.id,
        checkKey: 'multi_multi',
        result: violating.length === 0 ? 'pass' : 'fail',
        detail:
          violating.length === 0
            ? 'マルチマルチクレームは無い。'
            : `請求項 ${violating.join(', ')} がマルチマルチクレームに該当する（施行規則24条の3第5号）。`,
        checkedAt: at,
      })
      .onConflictDoUpdate({
        target: [draftChecks.organizationId, draftChecks.matterId, draftChecks.checkKey],
        set: {
          result: violating.length === 0 ? 'pass' : 'fail',
          detail:
            violating.length === 0
              ? 'マルチマルチクレームは無い。'
              : `請求項 ${violating.join(', ')} がマルチマルチクレームに該当する（施行規則24条の3第5号）。`,
          checkedAt: at,
        },
      })
    return c.json({ saved: claimRows.length, multiMultiClaims: violating }, 200)
  })

  .get('/api/matters/:id/claims', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const rows = await db
      .select()
      .from(claims)
      .where(and(eq(claims.organizationId, org), eq(claims.matterId, matter.id)))
      .orderBy(claims.claimNo)
    return c.json(
      Claim.array().parse(
        rows.map((r) => ({
          ...r,
          claimNo: Number(r.claimNo),
          dependsOn: parseArray<number>(r.dependsOn),
        })),
      ),
    )
  })

  // --- 検索（式そのものを記録に残す） -------------------------------------
  .post('/api/matters/:id/searches', zValidator('json', RunSearch), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const query = c.req.valid('json')
    // 「どの構成要件のための検索か」は調査報告書の骨格である。
    // 存在しない（あるいは他テナントの）要件 id が記録に入ると、後から誰も検証できない。
    if (query.elementId !== null) {
      const owned = await db
        .select({ id: claimElements.id })
        .from(claimElements)
        .where(
          and(
            eq(claimElements.organizationId, org),
            eq(claimElements.matterId, matter.id),
            eq(claimElements.id, query.elementId),
          ),
        )
      if (owned.length === 0) fail(404, 'element_not_found')
    }
    const corpus = createCorpusClient(c.env)

    let result: Awaited<ReturnType<CorpusClient['search']>>
    try {
      result = await corpus.search({
        terms: query.terms,
        op: query.op,
        ...(query.ipcPrefix ? { ipcPrefix: query.ipcPrefix } : {}),
        ...(query.pubDateFrom ? { pubDateFrom: query.pubDateFrom } : {}),
        ...(query.pubDateTo ? { pubDateTo: query.pubDateTo } : {}),
        sections: query.sections,
        limit: query.limit,
      })
    } catch (err) {
      // 届かないことを 0 件として見せない。握りつぶすと「該当なし」と読まれる。
      if (err instanceof CorpusUnavailable) {
        // 届かないことを 0 件として見せない。握りつぶすと「該当なし」と読まれる。
        fail(503, 'corpus_unavailable', err.detail)
      }
      throw err
    }

    const record = {
      id: crypto.randomUUID(),
      organizationId: org,
      matterId: matter.id,
      elementId: query.elementId,
      query: JSON.stringify(query),
      matchExpression: result.matchExpression,
      compiledSql: result.compiledSql,
      // ベクトル検索は Worker から呼んでいないので、実行した方式だけを刻む。
      mode: 'fts' as const,
      hitCount: String(result.hitCount),
      undatedCount: String(result.undatedCount),
      splitTerms: jsonArray(result.splitTerms),
      droppedTerms: jsonArray(result.droppedTerms),
      corpusBatchCount: String(result.corpusBatchCount),
      searchedChunks: null,
      vectorModel: null,
      vectorSemantic: null,
      executedAt: result.executedAt,
    }
    const hitRows = result.hits.map((h, i) => ({
      id: crypto.randomUUID(),
      organizationId: org,
      searchId: record.id,
      pubNumber: h.pubNumber,
      paraNo: h.paraNo,
      section: h.section,
      rank: String(i),
      score: String(h.score),
      snippet: h.snippet,
      title: h.title,
      applicants: jsonArray(h.applicants),
      pubDate: h.pubDate,
    }))
    // 検索の記録とヒットは一緒に残す。片方だけ残ると調査報告書が嘘になる。
    //
    // ヒットは 1 文に全部積めない。search_hits は 12 列あるので、D1 のバインド上限
    // （1 文 100 個）に当たって 9 行目から `too many SQL variables` で落ちる。
    // 実データの検索は数万件ヒットするので、分割しないと **最初の検索から必ず落ちる**。
    // 文を分けても batch は 1 トランザクションなので原子性は保たれる。
    const stmts: BatchItem<'sqlite'>[] = [db.insert(searches).values(record)]
    const perStatement = maxRowsPerStatement(12)
    for (const part of chunk(hitRows, perStatement)) {
      stmts.push(db.insert(searchHits).values(part))
    }
    await db.batch(stmts as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])

    return c.json(
      SearchResponse.parse({
        record: {
          ...record,
          query,
          hitCount: result.hitCount,
          undatedCount: result.undatedCount,
          splitTerms: result.splitTerms,
          droppedTerms: result.droppedTerms,
          corpusBatchCount: result.corpusBatchCount,
          searchedChunks: null,
          vectorModel: null,
          vectorSemantic: null,
        },
        hits: result.hits,
      }),
      201,
    )
  })

  .get('/api/matters/:id/searches', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const rows = await db
      .select()
      .from(searches)
      .where(and(eq(searches.organizationId, org), eq(searches.matterId, matter.id)))
      .orderBy(desc(searches.executedAt))
    return c.json(
      SearchRecord.array().parse(
        rows.map((r) => ({
          id: r.id,
          organizationId: r.organizationId,
          matterId: r.matterId,
          elementId: r.elementId,
          query: JSON.parse(r.query) as unknown,
          matchExpression: r.matchExpression,
          compiledSql: r.compiledSql,
          mode: r.mode,
          hitCount: Number(r.hitCount),
          undatedCount: Number(r.undatedCount),
          splitTerms: parseArray<string>(r.splitTerms),
          droppedTerms: parseArray<string>(r.droppedTerms),
          corpusBatchCount: Number(r.corpusBatchCount),
          searchedChunks: r.searchedChunks === null ? null : Number(r.searchedChunks),
          vectorModel: r.vectorModel,
          vectorSemantic: r.vectorSemantic === null ? null : isTrue(r.vectorSemantic),
          executedAt: r.executedAt,
        })),
      ),
    )
  })

  .get('/api/matters/:id/searches/:searchId/hits', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const owned = await db
      .select({ id: searches.id })
      .from(searches)
      .where(
        and(
          eq(searches.organizationId, org),
          eq(searches.matterId, matter.id),
          eq(searches.id, c.req.param('searchId')),
        ),
      )
    if (owned.length === 0) fail(404, 'search_not_found')
    const rows = await db
      .select()
      .from(searchHits)
      .where(
        and(eq(searchHits.organizationId, org), eq(searchHits.searchId, c.req.param('searchId'))),
      )
      .orderBy(searchHits.rank)
    // 「そのとき何が当たったか」を履歴から辿れるようにする。検索直後の応答でしか
    // 見られないと、調査報告書として半分しか残らない。
    return c.json(
      SearchHit.array().parse(
        rows.map((r) => ({
          pubNumber: r.pubNumber,
          paraNo: r.paraNo,
          section: r.section,
          title: r.title,
          applicants: parseArray<string>(r.applicants),
          pubDate: r.pubDate,
          snippet: r.snippet,
          text: r.snippet,
          score: Number(r.score),
        })),
      ),
    )
  })

  // --- 典拠（製品の心臓） -------------------------------------------------
  .get('/api/matters/:id/evidence', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const rows = await db
      .select()
      .from(evidenceTable)
      .where(and(eq(evidenceTable.organizationId, org), eq(evidenceTable.matterId, matter.id)))
      .orderBy(evidenceTable.createdAt)
    return c.json(Evidence.array().parse(rows.map(toEvidence)))
  })

  .post('/api/matters/:id/evidence', zValidator('json', ProposeEvidence), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const input = c.req.valid('json')

    const element = await db
      .select()
      .from(claimElements)
      .where(and(eq(claimElements.organizationId, org), eq(claimElements.id, input.elementId)))
    if (!element[0] || element[0].matterId !== matter.id) {
      fail(404, 'element_not_found')
    }

    const corpus = createCorpusClient(c.env)
    const verdict = await verifyQuote(corpus, input)

    const existing = await db
      .select()
      .from(evidenceTable)
      .where(
        and(
          eq(evidenceTable.organizationId, org),
          eq(evidenceTable.elementId, input.elementId),
          eq(evidenceTable.pubNumber, input.pubNumber),
          eq(evidenceTable.paraNo, input.paraNo),
        ),
      )
    const at = nowIso(c.env)
    const row = {
      id: existing[0]?.id ?? crypto.randomUUID(),
      organizationId: org,
      matterId: matter.id,
      elementId: input.elementId,
      pubNumber: input.pubNumber,
      paraNo: input.paraNo,
      quotedText: input.quotedText,
      relation: input.relation,
      note: input.note,
      producedBy: input.producedBy,
      quoteCheck: verdict.quoteCheck,
      quoteCheckDetail: verdict.quoteCheckDetail,
      // 引用が変われば、人間のレビューはやり直しである。
      review: 'unreviewed' as const,
      reviewerNote: '',
      reviewedAt: null,
      title: verdict.title,
      applicants: jsonArray(verdict.applicants),
      pubDate: verdict.pubDate,
      createdAt: existing[0]?.createdAt ?? at,
    }
    if (existing[0]) {
      await db.update(evidenceTable).set(row).where(eq(evidenceTable.id, row.id))
      return c.json(Evidence.parse(toEvidence(row)), 200)
    }
    await db.insert(evidenceTable).values(row)
    return c.json(Evidence.parse(toEvidence(row)), 201)
  })

  .post('/api/matters/:id/evidence/recheck', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const rows = await db
      .select()
      .from(evidenceTable)
      .where(and(eq(evidenceTable.organizationId, org), eq(evidenceTable.matterId, matter.id)))
    if (rows.length === 0) return c.json({ rechecked: 0, unchanged: 0 })

    const corpus = createCorpusClient(c.env)
    // 1 件ずつ問い合わせない。段落の口は 1000 件まで束ねられるので、往復を 1 回にする。
    let found: Map<string, ParagraphLookup>
    try {
      const looked = await corpus.paragraphs(
        rows.map((r) => ({ pubNumber: r.pubNumber, paraNo: r.paraNo })),
      )
      found = new Map(looked.map((p) => [`${p.pubNumber}\u0000${p.paraNo}`, p]))
    } catch (err) {
      // **届かなかったのに 200 で「0 件変わりました」と返さない。**
      // 「全部確認済み」と「1 件も確認できなかった」が同じ応答になると、
      // サイドカーを起こし忘れたまま「直らないな」で終わる。
      if (err instanceof CorpusUnavailable) fail(503, 'corpus_unavailable', err.detail)
      throw err
    }

    const statements: BatchItem<'sqlite'>[] = []
    let rechecked = 0
    for (const row of rows) {
      const verdict = verdictFor(found.get(`${row.pubNumber}\u0000${row.paraNo}`), row)
      if (verdict.quoteCheck === row.quoteCheck) continue
      statements.push(
        db
          .update(evidenceTable)
          .set({
            quoteCheck: verdict.quoteCheck,
            quoteCheckDetail: verdict.quoteCheckDetail,
            // 判定が変わったなら、人間の確認はやり直しである。残すと
            // 「棄却された引用に人の承認印が付いた行」が生まれる。
            review: 'unreviewed',
            reviewerNote: '',
            reviewedAt: null,
            // 書誌はコーパスから取れたときだけ更新する。届かなかった null で
            // 公開日を消すと、先行技術かどうかの判断根拠が静かに失われる。
            ...(verdict.fromCorpus
              ? {
                  title: verdict.title,
                  applicants: jsonArray(verdict.applicants),
                  pubDate: verdict.pubDate,
                }
              : {}),
          })
          .where(and(eq(evidenceTable.organizationId, org), eq(evidenceTable.id, row.id))),
      )
      rechecked++
    }
    if (statements.length > 0) {
      // 途中で止まって「半分だけ再照合された」状態を残さない。
      await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
    }
    return c.json({ rechecked, unchanged: rows.length - rechecked })
  })

  .delete('/api/matters/:id/evidence/all', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    await db
      .delete(evidenceTable)
      .where(and(eq(evidenceTable.organizationId, org), eq(evidenceTable.matterId, matter.id)))
    return c.json({ deleted: true })
  })

  .post('/api/evidence/:id/review', zValidator('json', ReviewEvidence), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const rows = await db
      .select()
      .from(evidenceTable)
      .where(and(eq(evidenceTable.organizationId, org), eq(evidenceTable.id, c.req.param('id'))))
    const row = rows[0]
    if (!row) fail(404, 'evidence_not_found')
    // 機械照合を通っていない典拠を、人間が承認できてはならない。
    // 「照合できなかった主張は支持の根拠には決してならない」を、ここで守る。
    if (row.quoteCheck !== 'verified') {
      return c.json({ error: 'quote_not_verified', quoteCheck: row.quoteCheck }, 409)
    }
    const input = c.req.valid('json')
    const next = {
      review: input.review,
      relation: input.relation ?? row.relation,
      reviewerNote: input.reviewerNote,
      reviewedAt: nowIso(c.env),
    }
    await db.update(evidenceTable).set(next).where(eq(evidenceTable.id, row.id))
    return c.json(Evidence.parse(toEvidence({ ...row, ...next })))
  })

  // --- 特許性の判断 -------------------------------------------------------
  .get('/api/matters/:id/assessments', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const rows = await db
      .select()
      .from(assessments)
      .where(and(eq(assessments.organizationId, org), eq(assessments.matterId, matter.id)))
      .orderBy(desc(assessments.createdAt))
    return c.json(
      Assessment.array().parse(
        rows.map((r) => ({ ...r, secondaryRefs: parseArray<string>(r.secondaryRefs) })),
      ),
    )
  })

  .post('/api/matters/:id/assessments', zValidator('json', UpsertAssessment), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const input = c.req.valid('json')

    // **挙げた公報は、照合を通った典拠で裏付けられていなければならない。**
    // スキルの手順書は「verified の典拠だけを使う」と書いてあるが、それはお願いであって
    // 強制ではない。強制しないと、存在しない公報番号を主引用にして「塞がれている」と
    // 結論でき、その判断が画面に出て明細書へ流れる（実際に再現された欠陥）。
    const refs = [
      ...new Set(
        [input.primaryRef, ...input.secondaryRefs].filter(
          (r): r is string => typeof r === 'string' && r.length > 0,
        ),
      ),
    ]
    if (refs.length > 0) {
      const backed = await db
        .select({ pubNumber: evidenceTable.pubNumber })
        .from(evidenceTable)
        .where(
          and(
            eq(evidenceTable.organizationId, org),
            eq(evidenceTable.matterId, matter.id),
            eq(evidenceTable.quoteCheck, 'verified'),
            inArray(evidenceTable.pubNumber, refs),
          ),
        )
      const have = new Set(backed.map((r) => r.pubNumber))
      const missing = refs.filter((r) => !have.has(r))
      if (missing.length > 0) {
        fail(
          409,
          'ref_not_supported',
          `${missing.join('、')} には、照合を通った典拠がこの案件にありません。先に該当段落を典拠として積んでください。`,
        )
      }
    }

    const row = {
      id: crypto.randomUUID(),
      organizationId: org,
      matterId: matter.id,
      kind: input.kind,
      primaryRef: input.primaryRef,
      secondaryRefs: jsonArray(input.secondaryRefs),
      motivationType: input.motivationType,
      advantageousEffects: input.advantageousEffects,
      hindrance: input.hindrance,
      negativeType: input.negativeType,
      reasoning: input.reasoning,
      conclusion: input.conclusion,
      createdAt: nowIso(c.env),
    }
    await db.insert(assessments).values(row)
    return c.json(Assessment.parse({ ...row, secondaryRefs: input.secondaryRefs }), 201)
  })

  // --- ドラフト -----------------------------------------------------------
  .get('/api/matters/:id/drafts', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const rows = await db
      .select()
      .from(drafts)
      .where(and(eq(drafts.organizationId, org), eq(drafts.matterId, matter.id)))
      // **版番号で並べる。** createdAt で並べると、同じ秒に 2 版を保存したときに
      // どちらが最新かが挿入順という暗黙の性質で決まってしまう。
      .orderBy(desc(drafts.revision))
    // 節ごとの最新だけを返す（改訂は行として残るが、画面が見るのは最新）。
    const latest = new Map<string, (typeof rows)[number]>()
    for (const row of rows) if (!latest.has(row.section)) latest.set(row.section, row)
    return c.json(
      Draft.array().parse(
        [...latest.values()].map((r) => ({ ...r, revision: Number(r.revision) })),
      ),
    )
  })

  .put('/api/matters/:id/drafts', zValidator('json', UpsertDraft), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const input = c.req.valid('json')
    const existing = await db
      .select()
      .from(drafts)
      .where(
        and(
          eq(drafts.organizationId, org),
          eq(drafts.matterId, matter.id),
          eq(drafts.section, input.section),
        ),
      )
    const row = {
      id: crypto.randomUUID(),
      organizationId: org,
      matterId: matter.id,
      revision: revisionOf(existing.length + 1),
      section: input.section,
      markdown: input.markdown,
      createdAt: nowIso(c.env),
    }
    await db.insert(drafts).values(row)
    return c.json(Draft.parse({ ...row, revision: Number(row.revision) }), 201)
  })

  .get('/api/matters/:id/checks', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const rows = await db
      .select()
      .from(draftChecks)
      .where(and(eq(draftChecks.organizationId, org), eq(draftChecks.matterId, matter.id)))
    return c.json(DraftCheck.array().parse(rows))
  })

  // --- グラフ（公報と要件の関係） -----------------------------------------
  .get('/api/matters/:id/graph', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const elements = await db
      .select()
      .from(claimElements)
      .where(and(eq(claimElements.organizationId, org), eq(claimElements.matterId, matter.id)))
      .orderBy(claimElements.sortOrder)
    const ev = await db
      .select()
      .from(evidenceTable)
      .where(and(eq(evidenceTable.organizationId, org), eq(evidenceTable.matterId, matter.id)))

    const nodes = [
      ...elements.map((e) => ({
        id: `element:${e.id}`,
        kind: 'element' as const,
        label: `${e.elementKey} ${e.text}`,
        weight: ev.filter((x) => x.elementId === e.id).length,
      })),
      ...[...new Set(ev.map((e) => e.pubNumber))].map((pubNumber) => ({
        id: `publication:${pubNumber}`,
        kind: 'publication' as const,
        label: pubNumber,
        // 公報の重みは「人間が開示を認めた要件の数」。太い公報ほど手強い先行技術である。
        // 機械照合だけでは足りない — relation は送り手の自己申告だからである。
        weight: new Set(
          ev
            .filter((e) => e.pubNumber === pubNumber && isSupporting(toEvidence(e)))
            .map((e) => e.elementId),
        ).size,
      })),
    ]
    const edges = ev.map((e) => ({
      from: `element:${e.elementId}`,
      to: `publication:${e.pubNumber}`,
      relation: e.relation,
      quoteCheck: e.quoteCheck,
    }))
    return c.json(EvidenceGraph.parse({ nodes, edges }))
  })

  // --- ジョブ（Claude Code スキルが拾うキュー） ---------------------------
  .get('/api/jobs', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const rows = await db
      .select()
      .from(jobs)
      .where(eq(jobs.organizationId, org))
      .orderBy(desc(jobs.requestedAt))
    return c.json(Job.array().parse(rows))
  })

  .post('/api/matters/:id/jobs', zValidator('json', CreateJob), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const matter = await requireMatter(db, org, c.req.param('id'))
    const input = c.req.valid('json')
    const row = {
      id: crypto.randomUUID(),
      organizationId: org,
      matterId: matter.id,
      kind: input.kind,
      status: 'queued' as const,
      instruction: input.instruction,
      runner: null,
      error: null,
      resultRef: null,
      requestedAt: nowIso(c.env),
      startedAt: null,
      finishedAt: null,
    }
    await db.insert(jobs).values(row)
    return c.json(Job.parse(row), 201)
  })

  .post('/api/jobs/:id/claim', zValidator('json', ClaimJob), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const { runner } = c.req.valid('json')
    const at = nowIso(c.env)
    // 二重に走らせないための取り合い。**`status='queued'` を条件に入れる**ので、
    // 先に取った実行者が勝ち、後から来た方は 0 行更新になって 409 を受け取る。
    const updated = await db
      .update(jobs)
      .set({ status: 'running', runner, startedAt: at })
      .where(
        and(
          eq(jobs.organizationId, org),
          eq(jobs.id, c.req.param('id')),
          eq(jobs.status, 'queued'),
        ),
      )
      .returning()
    const row = updated[0]
    if (!row) {
      const exists = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.organizationId, org), eq(jobs.id, c.req.param('id'))))
      if (exists.length === 0) fail(404, 'job_not_found')
      fail(
        409,
        'job_already_claimed',
        `この仕事は既に ${exists[0]?.runner ?? '誰か'} が取っています。`,
      )
    }
    return c.json(Job.parse(row))
  })

  .post('/api/jobs/:id/complete', zValidator('json', CompleteJob), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const input = c.req.valid('json')
    const updated = await db
      .update(jobs)
      .set({
        status: input.status,
        error: input.error,
        resultRef: input.resultRef,
        finishedAt: nowIso(c.env),
      })
      .where(and(eq(jobs.organizationId, org), eq(jobs.id, c.req.param('id'))))
      .returning()
    const row = updated[0]
    if (!row) fail(404, 'job_not_found')
    return c.json(Job.parse(row))
  })

export type AppType = typeof routes

export default app
