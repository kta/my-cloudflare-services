import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const [src, out, x, y, w, h, scale = '3'] = process.argv.slice(2)
const src2 = PNG.sync.read(readFileSync(src))
const S = Number(scale)
const png = new PNG({ width: Number(w) * S, height: Number(h) * S })
for (let j = 0; j < Number(h) * S; j++)
  for (let i = 0; i < Number(w) * S; i++) {
    const si = ((Number(y) + Math.floor(j / S)) * src2.width + (Number(x) + Math.floor(i / S))) * 4
    const di = (j * png.width + i) * 4
    for (let k = 0; k < 4; k++) png.data[di + k] = src2.data[si + k]
  }
writeFileSync(out, PNG.sync.write(png))
