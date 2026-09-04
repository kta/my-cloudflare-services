/**
 * 共有 secret の照合に使う定数時間比較。
 * `!==` の早期 return は先頭からの一致文字数を実行時間として漏らすため使わない。
 * 長さ不一致の早期 return は長さ以外を漏らさないので許容する。
 */
const enc = new TextEncoder()

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}
