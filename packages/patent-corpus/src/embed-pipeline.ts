/*
 * 埋め込みの作成とベクトル検索。
 *
 * 設計の核: **チャンクは段落境界を跨がない**。跨いだ瞬間に「どの段落からの引用か」が
 * 言えなくなり、典拠の照合（製品テーゼ）が成立しなくなる。長い段落は段落内で分割し、
 * chunk_seq を振る。
 *
 * ベクトル検索は候補集合の中だけで総当たりする。二段検索（FTS5 と分類コードで絞ってから）
 * を前提にしているので ANN 索引が要らない。全件横断が要るときだけ 1bit 量子化の
 * ハミング距離で粗く絞ってから int8 で再スコアする。
 */

import { createHash, randomUUID } from 'node:crypto'
import type { Corpus } from './corpus.ts'
import { escapeLike } from './corpus.ts'
import type { Embedder } from './embed.ts'
import { cosineInt8, packBinary, quantizeInt8, topK } from './vector.ts'

/** 1 チャンクの最大文字数。段落がこれを超えたら段落内で分割する。 */
const CHUNK_CHARS = 800
/** 分割時の重なり。文の途中で切れた語が両側に残るようにする。 */
const CHUNK_OVERLAP = 80
/** 埋め込みプロバイダへ一度に渡す件数。 */
const BATCH = 32

export interface EmbedTarget {
  ipcPrefix?: string
  pubDateFrom?: string
  pubDateTo?: string
  pubNumbers?: string[]
  /** 時刻の注入口。テストは実時計に依存させない（TEST_RULE）。 */
  now?: () => Date
}

export interface EmbedCorpusResult {
  promotionId: string
  publicationCount: number
  chunkCount: number
  model: string
  semantic: boolean
}

interface ParagraphRow {
  pub_number: string
  para_no: string
  text: string
}

export function splitParagraph(text: string): string[] {
  const chars = Array.from(text)
  if (chars.length <= CHUNK_CHARS) return [text]
  const out: string[] = []
  let start = 0
  while (start < chars.length) {
    out.push(chars.slice(start, start + CHUNK_CHARS).join(''))
    if (start + CHUNK_CHARS >= chars.length) break
    start += CHUNK_CHARS - CHUNK_OVERLAP
  }
  return out
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

function targetSql(target: EmbedTarget): { sql: string; params: (string | number)[] } {
  const where: string[] = ["p.text <> ''"]
  const params: (string | number)[] = []
  if (target.ipcPrefix) {
    where.push(
      "EXISTS (SELECT 1 FROM publication_codes c WHERE c.pub_number = p.pub_number AND c.scheme = 'ipc' AND c.code LIKE ? ESCAPE '\\')",
    )
    params.push(`${escapeLike(target.ipcPrefix)}%`)
  }
  if (target.pubDateFrom) {
    where.push('pub.pub_date >= ?')
    params.push(target.pubDateFrom)
  }
  if (target.pubDateTo) {
    where.push('pub.pub_date <= ?')
    params.push(target.pubDateTo)
  }
  if (target.pubNumbers && target.pubNumbers.length > 0) {
    where.push(`p.pub_number IN (${target.pubNumbers.map(() => '?').join(', ')})`)
    params.push(...target.pubNumbers)
  }
  return {
    sql: `SELECT p.pub_number, p.para_no, p.text
          FROM paragraphs p JOIN publications pub ON pub.pub_number = p.pub_number
          WHERE ${where.join(' AND ')}
          ORDER BY p.pub_number, p.seq`,
    params,
  }
}

export async function embedCorpus(
  corpus: Corpus,
  embedder: Embedder,
  target: EmbedTarget,
): Promise<EmbedCorpusResult> {
  const db = corpus.raw()
  const { sql, params } = targetSql(target)
  const paragraphs = db.prepare(sql).all(...params) as unknown as ParagraphRow[]

  const promotionId = randomUUID()
  const now = (target.now ?? (() => new Date()))().toISOString()

  // 再利用判定・削除・昇格の付け替えは、すべて (model, dim) の組で引く。
  // model だけで引くと、次元を変えたときに「昇格済み」と誤判定する。
  const existing = db.prepare(
    'SELECT id, text_hash FROM chunks WHERE pub_number = ? AND para_no = ? AND chunk_seq = ? AND model = ? AND dim = ?',
  )
  const deleteStale = db.prepare(
    'DELETE FROM chunks WHERE pub_number = ? AND para_no = ? AND model = ? AND dim = ?',
  )
  const insertChunk = db.prepare(
    `INSERT INTO chunks (id, pub_number, para_no, chunk_seq, text_hash, model, dim, scale, vec, vec_bin, promotion_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const touchPromotion = db.prepare(
    'UPDATE chunks SET promotion_id = ? WHERE pub_number = ? AND para_no = ? AND model = ? AND dim = ?',
  )

  interface Pending {
    pubNumber: string
    paraNo: string
    chunkSeq: number
    text: string
    hash: string
  }
  const pending: Pending[] = []
  const publications = new Set<string>()
  let chunkCount = 0

  for (const row of paragraphs) {
    publications.add(row.pub_number)
    const pieces = splitParagraph(row.text)
    // 段落の本文が変わっている（= 既存チャンクのハッシュが合わない）か、
    // 分割数が変わっている場合は、その段落のチャンクを丸ごと作り直す。
    let reusable = true
    for (let i = 0; i < pieces.length; i++) {
      const found = existing.get(row.pub_number, row.para_no, i, embedder.name, embedder.dim) as
        | { id: string; text_hash: string }
        | undefined
      if (!found || found.text_hash !== hashText(pieces[i] as string)) {
        reusable = false
        break
      }
    }
    const count = db
      .prepare(
        'SELECT count(*) AS c FROM chunks WHERE pub_number = ? AND para_no = ? AND model = ?',
      )
      .get(row.pub_number, row.para_no, embedder.name) as { c: number }
    if (reusable && count.c === pieces.length) {
      touchPromotion.run(promotionId, row.pub_number, row.para_no, embedder.name, embedder.dim)
      chunkCount += pieces.length
      continue
    }
    deleteStale.run(row.pub_number, row.para_no, embedder.name, embedder.dim)
    for (let i = 0; i < pieces.length; i++) {
      const text = pieces[i] as string
      pending.push({
        pubNumber: row.pub_number,
        paraNo: row.para_no,
        chunkSeq: i,
        text,
        hash: hashText(text),
      })
    }
  }

  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH)
    const vectors = await embedder.embed(slice.map((s) => s.text))
    for (let j = 0; j < slice.length; j++) {
      const item = slice[j] as Pending
      const vec = vectors[j] as Float32Array
      const q = quantizeInt8(vec)
      insertChunk.run(
        randomUUID(),
        item.pubNumber,
        item.paraNo,
        item.chunkSeq,
        item.hash,
        embedder.name,
        embedder.dim,
        q.scale,
        new Uint8Array(q.bytes.buffer, q.bytes.byteOffset, q.bytes.byteLength),
        packBinary(vec),
        promotionId,
        now,
      )
      chunkCount++
    }
  }

  db.prepare(
    `INSERT INTO promotion_sets (id, predicate, model, dim, semantic, publication_count, chunk_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    promotionId,
    JSON.stringify(target),
    embedder.name,
    embedder.dim,
    embedder.semantic ? 1 : 0,
    publications.size,
    chunkCount,
    now,
  )

  return {
    promotionId,
    publicationCount: publications.size,
    chunkCount,
    model: embedder.name,
    semantic: embedder.semantic,
  }
}

export interface VectorSearchQuery {
  text: string
  /** 時刻の注入口。 */
  now?: () => Date
  limit?: number
  pubNumbers?: string[]
}

export interface VectorHit {
  pubNumber: string
  paraNo: string
  chunkSeq: number
  score: number
  text: string
}

export interface VectorSearchResult {
  hits: VectorHit[]
  /**
   * 候補集合の大きさ（このモデル・次元で検索対象になり得たチャンクの総数）。
   * 「見た範囲」を利用者に示すために返す。
   */
  candidateChunks: number
  /**
   * 実際にコサイン類似度で採点したチャンク数。候補集合を総当たりするので candidateChunks と
   * 一致する。**一致しない実装にしてはならない** — 一致しないなら「見た範囲」の申告が嘘になる。
   *
   * 以前は 1bit 量子化のハミング距離で粗く絞る経路を持っていたが、実測で
   * recall@10 が 27〜40%（真の上位の 6〜7 割を落とす）だったので削除した。
   * 二段検索（FTS5 と分類コードで数千件に絞ってから）が前提なので、総当たりで速度も足りる。
   * 数百万チャンクを分類コードなしで横断したい場合は別の手法が要るが、まだ作っていない
   * （作っていないものを「使える」ように見せない）。
   */
  rescoredChunks: number
  model: string
  semantic: boolean
  executedAt: string
}

interface ChunkRow {
  pub_number: string
  para_no: string
  chunk_seq: number
  vec: Uint8Array
  vec_bin: Uint8Array
  text: string
}

export async function vectorSearch(
  corpus: Corpus,
  embedder: Embedder,
  query: VectorSearchQuery,
): Promise<VectorSearchResult> {
  const executedAt = (query.now ?? (() => new Date()))().toISOString()
  const db = corpus.raw()
  const where: string[] = ['c.model = ?', 'c.dim = ?']
  const params: (string | number)[] = [embedder.name, embedder.dim]
  if (query.pubNumbers && query.pubNumbers.length > 0) {
    where.push(`c.pub_number IN (${query.pubNumbers.map(() => '?').join(', ')})`)
    params.push(...query.pubNumbers)
  }
  const rows = db
    .prepare(
      `SELECT c.pub_number, c.para_no, c.chunk_seq, c.vec, c.vec_bin, p.text
       FROM chunks c JOIN paragraphs p ON p.pub_number = c.pub_number AND p.para_no = c.para_no
       WHERE ${where.join(' AND ')}
       ORDER BY c.pub_number, c.para_no, c.chunk_seq`,
    )
    .all(...params) as unknown as ChunkRow[]

  const base = {
    candidateChunks: rows.length,
    model: embedder.name,
    semantic: embedder.semantic,
    executedAt,
  }
  if (rows.length === 0) return { ...base, hits: [], rescoredChunks: 0 }

  const [queryVec] = await embedder.embed([query.text])
  const qVec = queryVec as Float32Array
  const qInt8 = quantizeInt8(qVec)
  const limit = query.limit ?? 20

  const scored = rows.map((r) => ({
    row: r,
    score: cosineInt8(qInt8, {
      bytes: new Int8Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength),
      scale: 1,
      dim: embedder.dim,
    }),
  }))

  return {
    ...base,
    rescoredChunks: rows.length,
    hits: topK(scored, limit).map((s) => ({
      pubNumber: s.row.pub_number,
      paraNo: s.row.para_no,
      chunkSeq: s.row.chunk_seq,
      score: s.score,
      text: s.row.text,
    })),
  }
}
