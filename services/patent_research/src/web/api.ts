import type {
  Assessment,
  ClaimElementSummary,
  CorpusStatus,
  Draft,
  DraftCheck,
  DraftSection,
  Evidence,
  EvidenceGraph,
  EvidenceRelation,
  EvidenceReview,
  Job,
  JobKind,
  Matter,
  MatterStatus,
  MatterSummary,
  SearchRecord,
  SearchResponse,
} from '@app/contracts'
import { client } from './client'

/*
 * 画面からの読み書き。Hono RPC の型付きクライアントをそのまま使う。
 *
 * 失敗を握りつぶさない: 401 は呼び出し側がサインアウトへ回し、それ以外の失敗は
 * サーバが返した `error` / `detail` をそのまま画面に出す。特にコーパスが落ちている
 * ときの 503 は、**0 件と区別できる形で見せなければならない**。
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: string | null

  constructor(status: number, code: string, detail: string | null) {
    super(code)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T
  let code = 'request_failed'
  let detail: string | null = null
  try {
    const body = (await res.json()) as { error?: string; detail?: string | null }
    code = body.error ?? code
    detail = body.detail ?? null
  } catch {
    // 本文が JSON でない（想定外）。状態だけで伝える。
  }
  throw new ApiError(res.status, code, detail)
}

export const api = {
  matters: () => client.api.matters.$get().then((r) => unwrap<MatterSummary[]>(r)),

  createMatter: (title: string, techField = '') =>
    client.api.matters.$post({ json: { title, techField } }).then((r) => unwrap<Matter>(r)),

  matter: (id: string) =>
    client.api.matters[':id'].$get({ param: { id } }).then((r) => unwrap<Matter>(r)),

  updateMatter: (
    id: string,
    patch: { title?: string; techField?: string; status?: MatterStatus },
  ) =>
    client.api.matters[':id'].$patch({ param: { id }, json: patch }).then((r) => unwrap<Matter>(r)),

  disclosure: (id: string) =>
    client.api.matters[':id'].disclosure
      .$get({ param: { id } })
      .then((r) => unwrap<DisclosureView | null>(r)),

  saveDisclosure: (id: string, input: DisclosureInput) =>
    client.api.matters[':id'].disclosure
      .$put({ param: { id }, json: input })
      .then((r) => unwrap<DisclosureView>(r)),

  messages: (id: string) =>
    client.api.matters[':id'].messages.$get({ param: { id } }).then((r) => unwrap<Message[]>(r)),

  postMessage: (
    id: string,
    input: { role: 'user' | 'assistant'; content: string; provider?: string },
  ) =>
    client.api.matters[':id'].messages
      .$post({ param: { id }, json: input as never })
      .then((r) => unwrap<Message>(r)),

  elements: (id: string) =>
    client.api.matters[':id'].elements
      .$get({ param: { id } })
      .then((r) => unwrap<ClaimElementSummary[]>(r)),

  saveElements: (id: string, elements: ElementInput[]) =>
    client.api.matters[':id'].elements
      .$put({ param: { id }, json: { elements } })
      .then((r) => unwrap<ClaimElementSummary[]>(r)),

  runSearch: (id: string, query: SearchInput) =>
    client.api.matters[':id'].searches
      .$post({ param: { id }, json: query as never })
      .then((r) => unwrap<SearchResponse>(r)),

  searches: (id: string) =>
    client.api.matters[':id'].searches
      .$get({ param: { id } })
      .then((r) => unwrap<SearchRecord[]>(r)),

  evidence: (id: string) =>
    client.api.matters[':id'].evidence.$get({ param: { id } }).then((r) => unwrap<Evidence[]>(r)),

  proposeEvidence: (id: string, input: EvidenceInput) =>
    client.api.matters[':id'].evidence
      .$post({ param: { id }, json: input as never })
      .then((r) => unwrap<Evidence>(r)),

  recheckEvidence: (id: string) =>
    client.api.matters[':id'].evidence.recheck
      .$post({ param: { id } })
      .then((r) => unwrap<{ rechecked: number }>(r)),

  reviewEvidence: (
    evidenceId: string,
    input: { review: EvidenceReview; relation?: EvidenceRelation; reviewerNote?: string },
  ) =>
    client.api.evidence[':id'].review
      .$post({ param: { id: evidenceId }, json: input as never })
      .then((r) => unwrap<Evidence>(r)),

  assessments: (id: string) =>
    client.api.matters[':id'].assessments
      .$get({ param: { id } })
      .then((r) => unwrap<Assessment[]>(r)),

  saveAssessment: (id: string, input: Record<string, unknown>) =>
    client.api.matters[':id'].assessments
      .$post({ param: { id }, json: input as never })
      .then((r) => unwrap<Assessment>(r)),

  drafts: (id: string) =>
    client.api.matters[':id'].drafts.$get({ param: { id } }).then((r) => unwrap<Draft[]>(r)),

  saveDraft: (id: string, section: DraftSection, markdown: string) =>
    client.api.matters[':id'].drafts
      .$put({ param: { id }, json: { section, markdown } })
      .then((r) => unwrap<Draft>(r)),

  checks: (id: string) =>
    client.api.matters[':id'].checks.$get({ param: { id } }).then((r) => unwrap<DraftCheck[]>(r)),

  graph: (id: string) =>
    client.api.matters[':id'].graph.$get({ param: { id } }).then((r) => unwrap<EvidenceGraph>(r)),

  jobs: () => client.api.jobs.$get().then((r) => unwrap<Job[]>(r)),

  createJob: (id: string, kind: JobKind, instruction: string) =>
    client.api.matters[':id'].jobs
      .$post({ param: { id }, json: { kind, instruction } })
      .then((r) => unwrap<Job>(r)),

  corpusStatus: () => client.api.corpus.status.$get().then((r) => unwrap<CorpusStatus>(r)),
}

export interface DisclosureView {
  id: string
  matterId: string
  revision: number
  problem: string
  solution: string
  effects: string
  embodiments: string
  keywords: string[]
  externalLlmAllowed: boolean
  createdAt: string
}

export interface DisclosureInput {
  problem: string
  solution: string
  effects: string
  embodiments: string
  keywords: string[]
  externalLlmAllowed: boolean
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  provider: string
  createdAt: string
}

export interface ElementInput {
  claimNo: number
  elementKey: string
  text: string
  isEssential: boolean
  sortOrder: number
}

export interface SearchInput {
  elementId: string | null
  terms: string[]
  op: 'AND' | 'OR'
  ipcPrefix: string | null
  pubDateFrom: string | null
  pubDateTo: string | null
  sections: ('claim' | 'desc' | 'abstract')[]
  limit: number
}

export interface EvidenceInput {
  elementId: string
  pubNumber: string
  paraNo: string
  quotedText: string
  relation: EvidenceRelation
  note: string
  producedBy: 'human' | 'skill' | 'search'
}
