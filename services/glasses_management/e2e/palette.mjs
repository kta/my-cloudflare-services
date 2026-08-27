/*
 * 基準と実装で「面の塗りがどう取り違えられているか」を数える。
 *
 * 割合だけを見ていると、罫線や地色の hex が 1〜2 違うだけの取り違えを
 * 見落とす（画素数が少ないので割合に出ない）。同じ位置で色の対がどれだけ
 * 現れたかを数えると、取り違えが対の形でそのまま出る。
 */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const id = process.argv[2]
const a = PNG.sync.read(readFileSync(`../../docs/frontend/reference/ref--${id}.png`))
const b = PNG.sync.read(readFileSync(`../../docs/frontend/diff/impl--${id}.png`))
const hex = (im, i) => '#' + [0, 1, 2].map((k) => im.data[i + k].toString(16).padStart(2, '0')).join('')
const pairs = new Map()
for (let i = 0; i < a.data.length; i += 4) {
  const ra = hex(a, i), rb = hex(b, i)
  if (ra === rb) continue
  const key = `${ra} → ${rb}`
  pairs.set(key, (pairs.get(key) ?? 0) + 1)
}
for (const [k, n] of [...pairs].sort((p, q) => q[1] - p[1]).slice(0, 10)) console.log(String(n).padStart(8), k)
