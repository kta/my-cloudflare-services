/* 基準（モック）と実装で、指定した要素の実測を並べる。 */
import { chromium } from '@playwright/test'

const [screen, mockFile, mockSel, implSel, section, w = '1176', h = '742'] = process.argv.slice(2)
const NORM = `button,input,optgroup,select,textarea{font:inherit;color:inherit}`
const FONTS = [
  'japanese-400',
  'japanese-500',
  'japanese-600',
  'japanese-700',
  'latin-400',
  'latin-500',
  'latin-600',
  'latin-700',
]
const b = await chromium.launch()
const grab = async (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const c = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const g = document.createRange()
    g.selectNodeContents(el)
    const t = g.getBoundingClientRect()
    return {
      font: c.fontFamily,
      size: c.fontSize,
      weight: c.fontWeight,
      lh: c.lineHeight,
      color: c.color,
      box: [
        Math.round(r.x * 10) / 10,
        Math.round(r.y * 10) / 10,
        Math.round(r.width * 10) / 10,
        Math.round(r.height * 10) / 10,
      ],
      text: [
        Math.round(t.x * 10) / 10,
        Math.round(t.y * 10) / 10,
        Math.round(t.width * 10) / 10,
        Math.round(t.height * 10) / 10,
      ],
    }
  }, sel)

const p1 = await b.newPage({ viewport: { width: Number(w), height: Number(h) } })
await p1.goto(`${process.env.GALLERY_BASE ?? 'http://127.0.0.1:5199'}/__gallery?screen=${screen}`, {
  waitUntil: 'networkidle',
})
await p1.evaluate(() => document.fonts.ready)
console.log('impl', JSON.stringify(await grab(p1, implSel)))

const p2 = await b.newPage({ viewport: { width: Number(w), height: Number(h) } })
await p2.route('**/*.html', async (route) => {
  const r = await route.fetch()
  const body = await r.text()
  await route.fulfill({
    response: r,
    body: body.replace(
      '<head>',
      `<head><style>${NORM}</style>` +
        FONTS.map(
          (f) =>
            `<link rel="stylesheet" href="http://127.0.0.1:4176/packages/ui/node_modules/@fontsource/ibm-plex-sans-jp/${f}.css">`,
        ).join(''),
    ),
  })
})
await p2.goto(`http://127.0.0.1:4176/docs/frontend/mockups/eyex-reservation/${mockFile}`, {
  waitUntil: 'networkidle',
})
// 基準画像を撮るときと同じ条件（対象の 1 面だけを原点へ寄せる）にしないと、
// 台紙の余白ぶんだけ座標がずれて突き合わせにならない。
await p2.addStyleTag({
  content: `body>*{display:none!important}
  ${section}{display:block!important;position:absolute!important;inset:0!important;
    margin:0!important;border:0!important;border-radius:0!important;
    width:${Number(w)}px!important;height:${Number(h)}px!important}`,
})
await p2.evaluate((sel) => document.body.append(document.querySelector(sel)), section)
await p2.evaluate(() => document.fonts.ready)
console.log('mock', JSON.stringify(await grab(p2, mockSel)))
await b.close()
