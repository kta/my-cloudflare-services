import {
  CorpusParagraphsResponse,
  CorpusSearchResponse,
  CorpusStatsResponse,
  type CorpusStatus,
} from '@app/contracts'
// ambient global ではなく明示的に import する。web 側が AppType を type-only で読むとき、
// Workers の global 型が無い文脈でも解決できるようにするため（example_service と同じ理由）。
import type { Fetcher } from '@cloudflare/workers-types'
import type { z } from 'zod'

/*
 * コーパスサイドカーへの口。
 *
 * workerd にはファイルシステムも SQLite も無いので、公報のコーパスは別プロセス（Node）が持ち、
 * この Worker は HTTP で問い合わせる。認証はリポジトリが既に使っている内部 API の形
 * （`x-internal-key` の共有鍵、**鍵が未設定なら fail close**）をそのまま踏襲する。
 *
 * 口を Fetcher として受け取るのは、テストで miniflare の serviceBindings に代役を挿すためである
 * （本物のサイドカーは Node のプロセスなので workerd の中からは起動できない）。
 * 実運用では binding が無いので、グローバルの fetch で `CORPUS_URL` を叩く。
 */

export interface CorpusEnv {
  CORPUS?: Fetcher
  CORPUS_URL?: string
  INTERNAL_KEY: string
}

export type ParagraphLookup = CorpusParagraphsResponse['paragraphs'][number]
type CorpusSearchResult = CorpusSearchResponse

/** 届かなかったことを、黙って空の結果にせず型で伝える。 */
export class CorpusUnavailable extends Error {
  readonly detail: string

  constructor(detail: string) {
    super('corpus_unavailable')
    this.detail = detail
  }
}

const DEFAULT_URL = 'http://127.0.0.1:8899'

/*
 * service binding（workers-types の Response）とグローバル fetch（DOM の Response）は
 * 型が別物で、そのままでは片方に寄せられない。ここで必要なのは 4 つだけなので、
 * その最小の形に揃えて扱う（型を合わせるためだけに any を撒かない）。
 */
interface MinimalResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}
type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<MinimalResponse>

export interface CorpusClient {
  paragraphs(keys: { pubNumber: string; paraNo: string }[]): Promise<ParagraphLookup[]>
  search(query: Record<string, unknown>): Promise<CorpusSearchResult>
  status(): Promise<CorpusStatus>
}

export function createCorpusClient(env: CorpusEnv): CorpusClient {
  const base = env.CORPUS_URL ?? DEFAULT_URL
  const binding = env.CORPUS
  const send: FetchLike = binding
    ? (url, init) => (binding.fetch as unknown as FetchLike)(url, init)
    : (url, init) => (globalThis.fetch as unknown as FetchLike)(url, init)

  /**
   * サイドカーの応答は **必ず Zod で検証してから使う**（規約3）。
   *
   * 素のキャストにすると、版ずれで欄が欠けたときに `checkQuote` の既定値
   * （`publicationExists`/`fulltextAvailable` = true）へ倒れ、**「保留」であるべきものが
   * 「却下」に化ける**。コーパス側の事故を AI の作話として記録する壊れ方であり、
   * 設計書が名指しで避けているものである。検証に落ちたら不達として扱う（安全側）。
   */
  async function call<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    if (!env.INTERNAL_KEY) {
      // 鍵が無いまま問い合わせると、サイドカーは 503 を返す。ここで先に止めて理由を明確にする。
      throw new CorpusUnavailable('INTERNAL_KEY が未設定のため、コーパスへ問い合わせられない。')
    }
    const url = `${base}${path}`
    const init = {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-internal-key': env.INTERNAL_KEY, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
    let res: MinimalResponse
    try {
      res = await send(url, init)
    } catch (err) {
      throw new CorpusUnavailable(
        `コーパスサイドカーに接続できない（${base}）。\`corpus serve\` が動いているか確認する。${
          err instanceof Error ? ` ${err.message}` : ''
        }`,
      )
    }
    if (!res.ok) {
      throw new CorpusUnavailable(
        `コーパスサイドカーが ${res.status} を返した（${path}）。${await res.text()}`.slice(0, 500),
      )
    }
    const parsed = schema.safeParse(await res.json())
    if (!parsed.success) {
      throw new CorpusUnavailable(
        `コーパスサイドカーの応答が契約と合わない（${path}）。版がずれている可能性がある。${JSON.stringify(
          parsed.error.issues,
        ).slice(0, 300)}`,
      )
    }
    return parsed.data
  }

  return {
    async paragraphs(keys) {
      const { paragraphs } = await call('/paragraphs', CorpusParagraphsResponse, { keys })
      return paragraphs
    },
    search(query) {
      return call('/search', CorpusSearchResponse, query)
    },
    async status() {
      try {
        const stats = await call('/stats', CorpusStatsResponse)
        return { ...stats, reachable: true, detail: null }
      } catch (err) {
        // 届かないことを 0 件として見せない。画面に理由を出す。
        return {
          reachable: false,
          detail: err instanceof CorpusUnavailable ? err.detail : String(err),
          publications: 0,
          withFulltext: 0,
          paragraphs: 0,
          chunks: 0,
          batches: 0,
          extractFailures: 0,
          byIpcSubclass: {},
        }
      }
    },
  }
}
