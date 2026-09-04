/*
 * 埋め込みプロバイダ。差し替え可能にしてある理由は、実装を止めないためである。
 *
 * 既定の `deterministic` は純 JS で、追加インストールが一切要らない。意味は捉えないが
 * 「同じ入力 → 同じ出力」が保証されるので、回帰テストとベースラインとして常に有効である。
 * 意味ベクトルが要る段階で `ollama` / `openai-compatible` に切り替える。
 *
 * `semantic` フラグを公開しているのは、UI に「これは意味ベクトルではない」と出すためである。
 * どの範囲がどのモデルでベクトル化されているかを利用者が知らないまま
 * 「似た公報は無かった」と結論するのが、この製品で最も避けたい誤読である。
 */

import { tokenRuns, tokensOfRun } from './tokenize.ts'

export interface Embedder {
  /** UI と DB に記録する識別子（`chunks.model` に入る）。 */
  name: string
  dim: number
  /** 意味ベクトルか。deterministic は false。 */
  semantic: boolean
  embed(texts: string[]): Promise<Float32Array[]>
}

export type EmbedProvider = 'deterministic' | 'ollama' | 'openai-compatible'

export interface EmbedderOptions {
  provider: EmbedProvider
  dim: number
  model?: string
  endpoint?: string
  /** テストから差し替えるための注入口。 */
  fetchImpl?: typeof fetch
}

/** 1bit 量子化が 1 バイトに収まらない構成を作らせない。 */
const MIN_DIM = 8

const FNV_OFFSET = 2166136261
const FNV_PRIME = 16777619

function hash32(s: string): number {
  let h = FNV_OFFSET
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, FNV_PRIME)
  }
  return h >>> 0
}

/**
 * 文字 bigram をハッシュして次元に畳み込み、L2 正規化した語彙ベクトル。
 * 意味は捉えないが、語の重なりを測るという意味では正当な指標である。
 */
function embedDeterministic(text: string, dim: number): Float32Array {
  const v = new Float32Array(dim)
  // 索引と同じトークン化を通す（検索とベクトルが同じ語彙を見ることを保証する）。
  for (const run of tokenRuns(text)) {
    for (const gram of tokensOfRun(run)) {
      const h = hash32(gram)
      const slot = h % dim
      // 符号もハッシュから決める（衝突が常に加算方向に効いて偏るのを避ける）。
      const sign = h >>> 31 === 1 ? -1 : 1
      v[slot] = (v[slot] as number) + sign
    }
  }
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let i = 0; i < dim; i++) v[i] = (v[i] as number) / norm
  }
  return v
}

interface HttpEmbedConfig {
  name: string
  dim: number
  url: string
  model: string
  fetchImpl: typeof fetch
  buildBody: (texts: string[], model: string) => unknown
  readVectors: (json: unknown) => number[][]
}

function httpEmbedder(cfg: HttpEmbedConfig): Embedder {
  return {
    name: cfg.name,
    dim: cfg.dim,
    semantic: true,
    async embed(texts) {
      if (texts.length === 0) return []
      const res = await cfg.fetchImpl(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cfg.buildBody(texts, cfg.model)),
      })
      if (!res.ok) {
        throw new Error(`embedding request failed: ${res.status} ${cfg.url}`)
      }
      const vectors = cfg.readVectors(await res.json())
      if (vectors.length !== texts.length) {
        throw new Error(`embedding count mismatch: asked ${texts.length}, got ${vectors.length}`)
      }
      return vectors.map((vec) => {
        if (vec.length !== cfg.dim) {
          throw new Error(`embedding dimension mismatch: expected ${cfg.dim}, got ${vec.length}`)
        }
        return new Float32Array(vec)
      })
    },
  }
}

function readOllama(json: unknown): number[][] {
  const body = json as { embeddings?: number[][]; embedding?: number[] }
  if (Array.isArray(body.embeddings)) return body.embeddings
  if (Array.isArray(body.embedding)) return [body.embedding]
  throw new Error('embedding response had neither `embeddings` nor `embedding`')
}

function readOpenAi(json: unknown): number[][] {
  const body = json as { data?: { embedding: number[] }[] }
  if (!Array.isArray(body.data)) throw new Error('embedding response had no `data` array')
  return body.data.map((d) => d.embedding)
}

export function createEmbedder(options: EmbedderOptions): Embedder {
  const { provider, dim, model, endpoint, fetchImpl = fetch } = options
  if (!Number.isInteger(dim) || dim < MIN_DIM) {
    throw new Error(`dim must be an integer of at least ${MIN_DIM}, got ${dim}`)
  }

  if (provider === 'deterministic') {
    return {
      // 名前に次元を含める。含めないと、次元だけ変えて埋め込み直したときに
      // 「既に昇格済み」と誤判定し、実際には走査できないチャンク数を申告してしまう
      // （実測で確認: --dim 64 で昇格 2 件と申告しつつ、検索が見るチャンクは 0 件）。
      name: `deterministic:${dim}`,
      dim,
      semantic: false,
      embed: (texts) => Promise.resolve(texts.map((t) => embedDeterministic(t, dim))),
    }
  }

  if (provider === 'ollama') {
    if (!model) throw new Error('the ollama provider requires a model name (e.g. bge-m3)')
    const base = endpoint ?? 'http://127.0.0.1:11434'
    return httpEmbedder({
      name: `ollama:${model}:${dim}`,
      dim,
      url: `${base}/api/embed`,
      model,
      fetchImpl,
      buildBody: (texts, m) => ({ model: m, input: texts }),
      readVectors: readOllama,
    })
  }

  if (provider === 'openai-compatible') {
    if (!model) throw new Error('the openai-compatible provider requires a model name')
    const base = endpoint ?? 'http://127.0.0.1:1234'
    return httpEmbedder({
      name: `openai:${model}:${dim}`,
      dim,
      url: `${base}/v1/embeddings`,
      model,
      fetchImpl,
      buildBody: (texts, m) => ({ model: m, input: texts }),
      readVectors: readOpenAi,
    })
  }

  throw new Error(`unknown embedding provider: ${String(provider)}`)
}
