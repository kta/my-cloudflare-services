/*
 * ベクトル検索の演算。外部拡張（sqlite-vec 等）を使わない理由:
 *
 * 1. 検索は二段構成である。FTS5（bigram）と IPC/日付で数千件以下に絞ってから、その候補集合の
 *    中だけでコサイン類似度を計算する。数千 × 768 次元の内積は純 JS で数ミリ秒なので
 *    ANN 索引が要らない。
 * 2. 全件横断のベクトル検索が要る場合も、1bit 量子化のハミング距離で粗く絞ってから
 *    int8 で再スコアすれば足りる。
 * 3. sqlite-vec は pre-v1 で破壊的変更が前提と公式に明記されている。
 *    確認できないものを製品の基盤に置かない。
 *
 * float32 は保存しない。int8（次元数 + スケール 4 バイト）と 1bit（次元数/8 バイト）だけを持つ。
 * float32 は int8 比で 4 倍のディスクを食い、検索順位への影響はほとんど無い。
 */

export interface Int8Vector {
  bytes: Int8Array
  /** 復元用のスケール（max|v| / 127）。コサイン類似度には影響しないが、内積が要る用途で使う。 */
  scale: number
  dim: number
}

/** float32 ベクトルを int8 に量子化する。 */
export function quantizeInt8(vec: Float32Array): Int8Vector {
  let max = 0
  for (const x of vec) {
    const a = Math.abs(x)
    if (a > max) max = a
  }
  const scale = max === 0 ? 0 : max / 127
  const bytes = new Int8Array(vec.length)
  if (scale > 0) {
    for (let i = 0; i < vec.length; i++) {
      bytes[i] = Math.max(-127, Math.min(127, Math.round((vec[i] as number) / scale)))
    }
  }
  return { bytes, scale, dim: vec.length }
}

/** int8 ベクトルを float32 に戻す（デバッグと再スコア用）。 */
export function dequantizeInt8(v: Int8Vector): Float32Array {
  const out = new Float32Array(v.dim)
  for (let i = 0; i < v.dim; i++) out[i] = (v.bytes[i] as number) * v.scale
  return out
}

export function cosineFloat(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length)
    throw new Error(`vector dimension mismatch: ${a.length} vs ${b.length}`)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number
    const y = b[i] as number
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * int8 ベクトル同士のコサイン類似度。
 * スケールは分子と分母で打ち消えるので、量子化後の値だけで計算できる。
 */
export function cosineInt8(a: Int8Vector, b: Int8Vector): number {
  if (a.dim !== b.dim) throw new Error(`vector dimension mismatch: ${a.dim} vs ${b.dim}`)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.dim; i++) {
    const x = a.bytes[i] as number
    const y = b.bytes[i] as number
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** 符号で 1bit に量子化する（正が 1、0 以下が 0）。バイト内は下位ビットから詰める。 */
export function packBinary(vec: Float32Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(vec.length / 8))
  for (let i = 0; i < vec.length; i++) {
    if ((vec[i] as number) > 0) {
      const byte = i >> 3
      out[byte] = (out[byte] as number) | (1 << (i & 7))
    }
  }
  return out
}

const POPCOUNT = new Uint8Array(256)
for (let i = 0; i < 256; i++) {
  POPCOUNT[i] = (i & 1) + (POPCOUNT[i >> 1] as number)
}

/** 1bit 量子化ベクトルのハミング距離。使っていない末尾ビットは両方 0 なので数えられない。 */
export function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length)
    throw new Error(`vector dimension mismatch: ${a.length} vs ${b.length}`)
  let d = 0
  for (let i = 0; i < a.length; i++) {
    d += POPCOUNT[(a[i] as number) ^ (b[i] as number)] as number
  }
  return d
}

export interface Scored {
  score: number
}

/** スコアの高い順に k 件返す。同点は入力順を保つ（検索結果の再現性のため）。 */
export function topK<T extends Scored>(items: T[], k: number): T[] {
  if (k <= 0) return []
  return items
    .map((item, index) => ({ item, index }))
    .sort((x, y) => y.item.score - x.item.score || x.index - y.index)
    .slice(0, k)
    .map((r) => r.item)
}
