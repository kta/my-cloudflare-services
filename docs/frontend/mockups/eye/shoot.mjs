/*
 * screens/*.html を 1 枚ずつ PNG にする。
 *
 *   node shoot.mjs           … 全画面
 *   node shoot.mjs HOME BOOK … 名前に HOME か BOOK を含む画面だけ
 *
 * 撮る範囲は各ファイルの #screen（.device = iPad 1194×834 / .phone = iPhone 390×844）。
 * 画面の外に置いた説明文（.caption）は写らない。何度実行しても同じ名前を
 * 上書きするだけなので冪等。
 */
import { readdir, mkdir } from 'node:fs/promises'

/*
 * このディレクトリは pnpm のワークスペースに属していないので、
 * `import 'playwright-core'` では解決できない。リポジトリの pnpm ストアから
 * 実体を探して読み込む。見つからなければ入れ方を伝えて終わる。
 */
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
const outDir = new URL('images/', here)

await mkdir(outDir, { recursive: true })

const filters = process.argv.slice(2)
const files = (await readdir(screensDir))
  .filter((f) => f.endsWith('.html'))
  .filter((f) => filters.length === 0 || filters.some((k) => f.includes(k)))
  .sort()

if (files.length === 0) {
  console.log('撮る画面がない')
  process.exit(0)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, deviceScaleFactor: 2 })
const done = []
const failed = []

for (const file of files) {
  const name = file.replace(/\.html$/, '')
  try {
    await page.goto(new URL(file, screensDir).href, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const target = page.locator('#screen')
    if ((await target.count()) === 0) throw new Error('#screen が無い')
    const box = await target.boundingBox()
    if (!box) throw new Error('位置を測れない')
    await page.screenshot({
      path: new URL(`${name}.png`, outDir).pathname,
      clip: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
    })
    /* 画面からはみ出した中身は撮っても写らないので、ここで見つけて知らせる。 */
    const overflow = await target.evaluate((el) => ({
      w: el.scrollWidth - el.clientWidth,
      h: el.scrollHeight - el.clientHeight,
    }))
    done.push(
      `${name}.png  ${Math.round(box.width)}×${Math.round(box.height)}` +
        (overflow.h > 1 || overflow.w > 1 ? `  ※はみ出し 横${overflow.w}px 縦${overflow.h}px` : ''),
    )
  } catch (error) {
    failed.push(`${name}: ${error.message}`)
  }
}

await browser.close()

console.log(`撮影 ${done.length}件`)
for (const line of done) console.log(`  ${line}`)
if (failed.length) {
  console.log(`\n失敗 ${failed.length}件`)
  for (const line of failed) console.log(`  ${line}`)
  process.exitCode = 1
}
