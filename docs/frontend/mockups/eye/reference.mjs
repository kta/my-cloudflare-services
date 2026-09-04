/*
 * 突き合わせ用の基準画像を作る。
 *
 *   node reference.mjs           … 全画面
 *   node reference.mjs HOME      … 名前で絞る
 *
 * images/ のモックは端末そのものを描いており、いちばん上に iPadOS の
 * ステータスバー（iPad 24px / iPhone 44px）が乗っている。実装はブラウザの中で
 * 動くのでその帯を描かない。そのままでは全体が縦にずれて比べられないので、
 * ステータスバーを外した版を reference/ に作り、Playwright の
 * `toHaveScreenshot` の基準画像として使う。
 *
 * images/ は発注元に見せる正の画像。こちらは実装と比べるためだけの派生物である。
 */
import { mkdir, readdir } from 'node:fs/promises'

const chromium = await (async () => {
  let dir = new URL('./', import.meta.url)
  for (let i = 0; i < 8; i += 1) {
    const store = new URL('node_modules/.pnpm/', dir)
    try {
      const entries = await readdir(store)
      const pkg = entries.find((e) => e.startsWith('playwright-core@'))
      if (pkg) {
        const mod = await import(new URL(`${pkg}/node_modules/playwright-core/index.js`, store).href)
        return (mod.default ?? mod).chromium
      }
    } catch {
      /* この階層には node_modules が無い。上へ。 */
    }
    dir = new URL('../', dir)
  }
  throw new Error('playwright-core が見つからない。リポジトリ直下で `pnpm install` を実行する。')
})()

const here = new URL('./', import.meta.url)
const screensDir = new URL('screens/', here)
const outDir = new URL('reference/', here)
await mkdir(outDir, { recursive: true })

const filters = process.argv.slice(2)
const files = (await readdir(screensDir))
  .filter((f) => f.endsWith('.html'))
  .filter((f) => filters.length === 0 || filters.some((k) => f.includes(k)))
  .sort()

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, deviceScaleFactor: 2 })
let count = 0

for (const file of files) {
  const name = file.replace(/\.html$/, '')
  await page.goto(new URL(file, screensDir).href, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  const target = page.locator('#screen')
  const box = await target.boundingBox()
  if (!box) continue
  /* ステータスバーの高さは端末で違う（.device 24px / .phone 44px）。実測する。 */
  const statusHeight = await target.evaluate((el) => {
    const bar = el.querySelector('.statusbar')
    return bar ? Math.round(bar.getBoundingClientRect().height) : 0
  })
  await page.screenshot({
    path: new URL(`${name}.png`, outDir).pathname,
    clip: {
      x: Math.round(box.x),
      y: Math.round(box.y) + statusHeight,
      width: Math.round(box.width),
      height: Math.round(box.height) - statusHeight,
    },
  })
  count += 1
}

await browser.close()
console.log(`基準画像 ${count} 枚を reference/ に作った（ステータスバーを外した版）`)
