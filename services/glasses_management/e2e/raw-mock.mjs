/*
 * 正規化を一切かけない素のモックを撮る。
 *
 * 基準画像には 3 つの正規化（書体の補完・台紙外し・書体一式）が入っている。
 * その正規化が「モックの見た目そのもの」を実装へ寄せていないかを、人の目で
 * 確かめるための素材。ここで撮ったものと実装を並べて見比べる。
 */
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const OUT = '../../docs/frontend/raw'
const [id, source, anchor, w, h] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } })
await page.goto(`http://127.0.0.1:4176/docs/frontend/mockups/eyex-reservation/${source}`, {
  waitUntil: 'networkidle',
})
const target = page.locator(anchor)
await target.scrollIntoViewIfNeeded()
await target.screenshot({ path: `${OUT}/raw--${id}.png` })
console.log(`raw--${id}.png`)
await browser.close()
