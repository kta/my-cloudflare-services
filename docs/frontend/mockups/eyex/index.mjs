/*
 * screens/*.html と images/*.png を並べた一覧（index.html）を作り直す。
 *
 *   node index.mjs
 *
 * 画面の題名と説明は、各 HTML の .caption から拾う。並び順は画面IDの
 * 接頭辞（GROUPS）で決め、そこに無いものは末尾へ回す。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'

const here = new URL('./', import.meta.url)
const screensDir = new URL('screens/', here)

/** 画面の並び順と、章の題名。 */
const GROUPS = [
  ['START', '端末の使い分けと業務開始'],
  ['LOGIN', '端末の使い分けと業務開始'],
  ['MODE', '端末の使い分けと業務開始'],
  ['HOME', 'トップ'],
  ['BOOK', '電話・店頭での新規予約'],
  ['LEDGER', '予約台帳'],
  ['RECEPTION', '来店受付'],
  ['HISTORY', '受付履歴'],
  ['CUSTOMER', '顧客台帳'],
  ['ANALYTICS', '分析'],
  ['SETTINGS', '設定'],
  ['WEB', 'お客様向けWeb予約（iPhone）'],
  ['EX', 'うまくいかないとき'],
]

const files = (await readdir(screensDir)).filter((f) => f.endsWith('.html')).sort()

const screens = []
for (const file of files) {
  const html = await readFile(new URL(file, screensDir), 'utf8')
  const id = file.replace(/\.html$/, '')
  const title = html.match(/<div class="caption">\s*<h1>([^<]*)<\/h1>/)?.[1] ?? id
  const note = html.match(/<div class="caption">[\s\S]*?<p>([^<]*)<\/p>/)?.[1] ?? ''
  const isPhone = /class="phone"/.test(html)
  const order = GROUPS.findIndex(([prefix]) => id.startsWith(prefix))
  screens.push({ id, title, note, isPhone, order: order === -1 ? GROUPS.length : order })
}
screens.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

let body = ''
let lastGroup = null
for (const s of screens) {
  const group = GROUPS[s.order]?.[1] ?? 'そのほか'
  if (group !== lastGroup) {
    if (lastGroup !== null) body += '</div>\n'
    body += `<h2>${esc(group)}</h2>\n<div class="grid">\n`
    lastGroup = group
  }
  body +=
    `<a class="item${s.isPhone ? ' sp' : ''}" href="screens/${s.id}.html">` +
    `<img src="images/${s.id}.png" alt="${esc(s.title)}" loading="lazy">` +
    `<b>${esc(s.title)}</b><code>${esc(s.id)}</code>` +
    `<span>${esc(s.note)}</span></a>\n`
}
if (lastGroup !== null) body += '</div>\n'

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>EYEX予約 画面モック一覧</title>
<link rel="stylesheet" href="assets/eyex.css">
<style>
  .page { max-width: 1360px; margin: 0 auto; padding: 32px 24px 80px; }
  .page h1 { font-size: 30px; margin: 0 0 6px; }
  .lead { color: #3c4a44; max-width: 760px; }
  .page h2 { font-size: 19px; margin: 36px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #b9c3be; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 18px; }
  .item { display: block; text-decoration: none; color: var(--ink); background: var(--surface);
    border: 1px solid var(--line); border-radius: var(--r-m); padding: 10px; }
  .item img { display: block; width: 100%; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  .item.sp img { width: auto; height: 300px; margin: 0 auto; }
  .item b { display: block; margin-top: 10px; font-size: 15px; }
  .item code { display: block; font: 400 11px var(--mono); color: var(--ink-3); margin-top: 2px; }
  .item span { display: block; margin-top: 6px; font-size: 12px; color: var(--ink-2); line-height: 1.5; }
</style>
</head>
<body>
<div class="page">
  <h1>EYEX予約　画面モック一覧</h1>
  <p class="lead">眼鏡店 EYEX 向けの予約・顧客管理システムの画面モックです。iPad 11インチ横向き（1194×834）を基準に、
  お客様向けのWeb予約だけ iPhone（390×844）で作っています。画像をクリックすると HTML が開きます。
  全${screens.length}画面。</p>
${body}</div>
</body>
</html>
`

await writeFile(new URL('index.html', here), html)
console.log(`index.html を作り直した（${screens.length}画面）`)
