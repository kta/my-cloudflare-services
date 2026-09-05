/*
 * コーパスサイドカー。Worker（workerd）にはファイルシステムも SQLite も無いので、
 * コーパスは別プロセスが持ち、Worker は HTTP で問い合わせる。
 *
 * 認証はリポジトリが既に使っている内部 API の形をそのまま踏襲する
 * （`x-internal-key` の共有鍵、**鍵が未設定なら fail close**）。新しい概念を増やさない。
 * 待ち受けは 127.0.0.1 に固定する。公報コーパスを LAN に晒す理由が無い。
 *
 * 入力は必ず Zod で検証する（リポジトリ規約3）。検証を挟まないと、利用者の入力が
 * そのまま SQL のバインドに流れて 500 になったり、`limit: -1` が SQLite の「無制限」に
 * なって頁送りが無効化されたりする（実測で確認）。
 */

import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { z } from 'zod'
import type { Corpus } from './corpus.ts'
import type { Embedder } from './embed.ts'
import { vectorSearch } from './embed-pipeline.ts'

export interface SidecarOptions {
  corpus: Corpus
  embedder: Embedder
  /** 共有鍵。未設定なら全リクエストを 503 で拒む（fail close）。 */
  internalKey: string | undefined
  host?: string
  port?: number
}

export interface Sidecar {
  server: Server
  listen(): Promise<number>
  close(): Promise<void>
}

const MAX_BODY = 1024 * 1024
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8899
const MAX_KEYS = 1000

const Section = z.enum(['claim', 'desc', 'abstract'])

const SearchBody = z.object({
  terms: z.array(z.string().min(1).max(200)).min(1).max(20),
  op: z.enum(['AND', 'OR']).default('AND'),
  ipcPrefix: z.string().min(1).max(30).optional(),
  pubDateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  pubDateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sections: z.array(Section).max(3).default([]),
  limit: z.number().int().min(1).max(1000).default(200),
  offset: z.number().int().min(0).max(1_000_000).default(0),
})

const ParagraphsBody = z.object({
  keys: z
    .array(z.object({ pubNumber: z.string().min(1).max(64), paraNo: z.string().min(1).max(16) }))
    .max(MAX_KEYS)
    .default([]),
})

const VectorSearchBody = z.object({
  text: z.string().min(1).max(20_000),
  limit: z.number().int().min(1).max(200).default(20),
  pubNumbers: z.array(z.string().min(1).max(64)).max(MAX_KEYS).default([]),
})

/*
 * パラメータプロパティ（constructor(readonly x: T)）は使わない。Node の型ストリップは
 * それを解釈できず、CLI が起動時に落ちる（vitest は通るので、実際に走らせるまで気づけない）。
 */
class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: string | undefined

  constructor(status: number, code: string, detail?: string) {
    super(code)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX_BODY) throw new HttpError(413, 'body_too_large')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
}

function parseBody<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    // 何が悪かったかを返す。黙って捨てると「0 件 = 該当なし」に見えてしまう。
    throw new HttpError(400, 'invalid_request', JSON.stringify(parsed.error.issues))
  }
  return parsed.data
}

/** 長さの違いで早期に返らない比較。ローカル専用でも、鍵の比較は定数時間で行う。 */
function keyMatches(provided: string | string[] | undefined, expected: string): boolean {
  if (typeof provided !== 'string') return false
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) {
    // 長さが違っても同じ回数だけ比較する
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}

export function createSidecar(options: SidecarOptions): Sidecar {
  const { corpus, embedder, internalKey } = options
  const host = options.host ?? DEFAULT_HOST
  const port = options.port ?? DEFAULT_PORT

  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.code, detail: err.detail ?? null })
        return
      }
      // 予期しない例外は握りつぶさず、形の決まった 500 にする。
      console.error('sidecar unhandled', err)
      if (!res.headersSent) send(res, 500, { error: 'internal_error' })
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${host}`)
    const path = url.pathname

    if (path === '/health' && req.method === 'GET') {
      // health は鍵なしで見られる。落ちているかどうかは秘密ではない。
      // 鍵が設定済みかどうかは漏らさない（鍵未設定の窓を外から探せてしまう）。
      send(res, 200, { status: 'ok' })
      return
    }

    if (!internalKey) {
      send(res, 503, {
        error: 'internal_key_unset',
        detail: 'サイドカーの共有鍵が設定されていないため、すべての問い合わせを拒否している。',
      })
      return
    }
    if (!keyMatches(req.headers['x-internal-key'], internalKey)) {
      send(res, 401, { error: 'unauthorized' })
      return
    }

    if (path === '/stats' && req.method === 'GET') {
      send(res, 200, corpus.stats())
      return
    }

    if (path === '/batches' && req.method === 'GET') {
      send(res, 200, { batches: corpus.batches(), failures: corpus.extractFailures() })
      return
    }

    if (path === '/publication' && req.method === 'GET') {
      const pubNumber = url.searchParams.get('pubNumber')
      if (!pubNumber) throw new HttpError(400, 'pubNumber_required')
      const publication = corpus.getPublication(pubNumber)
      if (!publication) throw new HttpError(404, 'not_found')
      send(res, 200, { publication, paragraphs: corpus.listParagraphs(pubNumber) })
      return
    }

    // Worker が典拠を照合するために段落原文をまとめて取る口。
    // 照合そのものは Worker 側で行う（スキルの申告を信用しないため）。
    if (path === '/paragraphs' && req.method === 'POST') {
      const { keys } = parseBody(ParagraphsBody, await readJson(req))
      send(res, 200, {
        paragraphs: keys.map((k) => {
          const publication = corpus.getPublication(k.pubNumber)
          const para = publication ? corpus.getParagraph(k.pubNumber, k.paraNo) : null
          return {
            pubNumber: k.pubNumber,
            paraNo: k.paraNo,
            publicationExists: publication !== null,
            fulltextAvailable: publication?.hasFulltext ?? false,
            sectionsIngested: publication?.sectionsIngested ?? [],
            text: para?.text ?? null,
            title: publication?.title ?? null,
            applicants: publication?.applicants ?? [],
            pubDate: publication?.pubDate ?? null,
          }
        }),
      })
      return
    }

    if (path === '/search' && req.method === 'POST') {
      const body = parseBody(SearchBody, await readJson(req))
      send(res, 200, corpus.search(body))
      return
    }

    if (path === '/vector-search' && req.method === 'POST') {
      const body = parseBody(VectorSearchBody, await readJson(req))
      send(res, 200, await vectorSearch(corpus, embedder, body))
      return
    }

    throw new HttpError(404, 'not_found')
  }

  return {
    server,
    listen() {
      return new Promise<number>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          const address = server.address()
          resolve(typeof address === 'object' && address !== null ? address.port : port)
        })
      })
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
