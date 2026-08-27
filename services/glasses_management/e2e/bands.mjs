import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const id = process.argv[2]
const a = PNG.sync.read(readFileSync(`../../docs/frontend/reference/ref--${id}.png`))
const b = PNG.sync.read(readFileSync(`../../docs/frontend/diff/impl--${id}.png`))
const bands = new Map()
for (let y = 0; y < a.height; y++) {
  let n = 0
  for (let x = 0; x < a.width; x++) {
    const i = (y * a.width + x) * 4
    const d = Math.abs(a.data[i]-b.data[i]) + Math.abs(a.data[i+1]-b.data[i+1]) + Math.abs(a.data[i+2]-b.data[i+2])
    if (d > 24) n++
  }
  if (n) bands.set(Math.floor(y / 20) * 20, (bands.get(Math.floor(y / 20) * 20) ?? 0) + n)
}
for (const [y, n] of [...bands].sort((p, q) => q[1] - p[1]).slice(0, 12)) console.log(`y=${y}-${y+19}  ${n}`)
