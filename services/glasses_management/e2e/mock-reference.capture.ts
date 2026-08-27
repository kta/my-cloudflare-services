/*
 * 承認済みモックから、比較の基準画像を作る。
 *
 * モック HTML は端末の外枠（`.ipad` は 9px、`.phone` は 8〜10px の黒縁）ごと
 * 描いている。アプリが描くのはその内側だけなので、外枠を落とした「中身の実寸」
 * を基準にする。これがそのまま Playwright での突き合わせ相手になる。
 */
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const MOCKS = 'docs/frontend/mockups/eyex-reservation'
const OUT = '../../docs/frontend/reference'

/*
 * モック HTML は `"IBM Plex Sans JP"` を名乗るのに webfont を読み込んでいない
 * （Set B の一部だけ Google Fonts を @import している）。そのまま撮ると和文が
 * システム書体に落ちるので、突き合わせが「字面が違う」で埋まり、配置の差が
 * 見えなくなる。宣言どおりの書体を注入してから撮る。
 */
const FONTS = [
  /*
   * アプリが読むのと同じ一式にする。サブセットを絞ると、そこに入っていない
   * 文字（記号など）だけが基準の側でシステム書体へ落ちて、同じ字形にならない。
   */
  '@fontsource/ibm-plex-sans-jp/400.css',
  '@fontsource/ibm-plex-sans-jp/500.css',
  '@fontsource/ibm-plex-sans-jp/600.css',
  '@fontsource/ibm-plex-sans-jp/700.css',
  '@fontsource/ibm-plex-mono/500.css',
  '@fontsource/ibm-plex-mono/600.css',
].map((file) => `http://127.0.0.1:4176/packages/ui/node_modules/${file}`)

/*
 * 基準は承認済みモックの見た目そのものである。余白も文字寸法もモックのまま
 * 撮り、アプリ側がそれに合わせる（アプリの base スタイルがブラウザ既定の余白を
 * 明示的に持ち直している）。
 *
 * ただし書体だけは例外にする。モックは同じ画面の中でもボタンごとに
 * `font:inherit` の有無がばらついていて（`.hero button` などで書き漏れ）、その
 * ボタンだけシステム書体・黒文字に落ちる。これは設計ではなく書き漏れなので、
 * 宣言どおり本文の書体と文字色を継がせてから撮る。
 *
 * ここは「モックそのまま」ではない唯一の点なので、何が変わるかを明記しておく。
 * `font:inherit` は書体だけでなく**文字寸法も**継がせる。ブラウザ既定のボタンは
 * 13.33px なので、寸法を書いていないボタン（`approved.html` の日付ストリップ、
 * `staff-approved.html` の絞り込み、`analytics-approved.html` と
 * `reception-history-approved.html` のナビタブ全部）は 13.33px → 16px になる。
 * 文字色も `#000` → 本文の `#17251f` になる。同じ役割のボタンが他のモックでは
 * `font:inherit` を持っていること、`.on` のタブは白ピル＋太字と明確に意匠が
 * 付いているのに寸法だけ既定であることから、書き漏れと判断した。
 */
const NORMALIZE = `
button,input,optgroup,select,textarea{font:inherit;color:inherit}
/*
 * モックは端末の絵を見出し付きの台紙に載せている。台紙の余白と見出しの高さで
 * 端末が小数の位置に置かれ、字が半画素ずれて描かれる。アプリ側は整数位置に
 * 描くので、そのまま比べると全画面の字がうっすら食い違う。台紙を外して端末を
 * 原点へ寄せる。
 */
body{margin:0!important}
.page,.label,.intro{margin:0!important;padding:0!important}
/*
 * .stage は台紙として使うモック（settings-responsive / web-booking）と、
 * 中身として使うモック（staff-approved の来店受付の工程セル）で意味が違う。
 * 一律に潰すと工程セルの内側 10px まで消えてしまうので、盤の中は除く。
 */
:not(.journey)>.stage{margin:0!important;padding:0!important}
.page>h1,.label,.intro{display:none!important}
/* 端末の丸角はモックの装飾。アプリは画面いっぱいの矩形に描く。 */
.ipad,.screen,.phone{border-radius:0!important}
`

/*
 * 正規化はブラウザ既定のリセットと同じ位置＝どのモックの規則よりも前に置く。
 * 後ろに足すと `.hero button{font-size:24px}` のような画面側の指定まで打ち消して
 * しまう。応答の `<head>` 直後へ差し込むのが、preflight と同じ順序になる。
 */
async function injectBaseline(page: import('@playwright/test').Page) {
  await page.route('**/*.html', async (route) => {
    const response = await route.fetch()
    const body = await response.text()
    const head = `<head><style>${NORMALIZE}</style>${FONTS.map((url) => `<link rel="stylesheet" href="${url}">`).join('')}`
    await route.fulfill({ response, body: body.replace('<head>', head) })
  })
}

async function withFonts(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    // 実際に使う字面で読み込ませる。ready だけでは遅延読み込みが残る。
    await Promise.all(
      [
        '400 16px "IBM Plex Sans JP"',
        '700 20px "IBM Plex Sans JP"',
        '600 14px "IBM Plex Mono"',
      ].map((font) => document.fonts.load(font, 'EYEX予約 銀座店 0123')),
    )
  })
  if ((await page.evaluate(() => document.fonts.size)) === 0)
    throw new Error('モックへ書体を注入できていない')
  await page.waitForTimeout(200)
}

/** 画面 ID → (モック HTML, セクション id, 外枠の太さ)。 */
const SCREENS: [string, string, string, number][] = [
  ['HOME-DEFAULT', 'approved.html', 'home', 9],
  ['BOOK-MIC-PERMISSION', 'approved.html', 'permission', 9],
  ['BOOK-TIME', 'approved.html', 'time', 9],
  ['BOOK-PURPOSE-CONFLICT', 'approved.html', 'purpose-conflict', 9],
  ['BOOK-CUSTOMER', 'approved.html', 'customer', 9],
  ['BOOK-REPEAT', 'approved.html', 'repeat', 9],

  ['LEDGER-DAY', 'staff-approved.html', 'ledger', 9],
  ['RES-SEARCH', 'staff-approved.html', 'reservation-search', 9],
  ['CUSTOMER-CURRENT', 'staff-approved.html', 'customer-ledger', 9],
  ['JOURNEY-DEFAULT', 'staff-approved.html', 'journey', 9],

  ['DEVICE-LIST', 'operations-approved.html', 'devices', 9],
  ['REAUTH', 'operations-approved.html', 'reauth', 9],
  ['RECORDING-OPS', 'operations-approved.html', 'recording-ops', 9],
  ['ATTENTION-PERMISSIONS', 'operations-approved.html', 'attention-settings', 9],
  ['ATTENTION-REVIEW', 'operations-approved.html', 'attention-review', 9],
  ['SETTINGS-RESULT', 'operations-approved.html', 'publish-result', 9],
  ['AUDIT-DETAIL', 'operations-approved.html', 'audit', 9],

  ['SETTINGS-STORE-HOURS', 'settings-complete-approved.html', 'store-hours', 9],
  ['SETTINGS-PURPOSES', 'settings-complete-approved.html', 'purposes', 9],
  ['SETTINGS-STAFF-SKILLS', 'settings-complete-approved.html', 'staff-skills', 9],
  ['SETTINGS-EQUIPMENT', 'settings-complete-approved.html', 'equipment', 9],
  ['SETTINGS-WEB', 'settings-complete-approved.html', 'web-settings', 9],
  ['SETTINGS-IMPACT', 'settings-complete-approved.html', 'impact', 9],

  ['EX-MIC-DENIED', 'exception-states-approved.html', 'mic-denied', 9],
  ['EX-UPLOAD-FAILED', 'exception-states-approved.html', 'upload-failed', 9],
  ['EX-CONFLICT', 'exception-states-approved.html', 'conflict', 9],
  ['EX-STORE-UNSAVED', 'exception-states-approved.html', 'unsaved-store-switch', 9],
  ['EX-SHARED-LOCK', 'exception-states-approved.html', 'shared-lock', 9],
  ['EX-SESSION-REVOKED', 'exception-states-approved.html', 'session-revoked', 9],
  ['EX-EMPTY', 'exception-states-approved.html', 'empty', 9],
  ['EX-403', 'exception-states-approved.html', 'permission-denied', 9],

  ['WEB-STORE-SEARCH', 'web-booking-complete-approved.html', 'store-search', 8],
  ['WEB-STORE-DETAIL', 'web-booking-complete-approved.html', 'store-detail', 8],
  ['WEB-PURPOSE', 'web-booking-complete-approved.html', 'purpose', 8],
  ['WEB-DATETIME', 'web-booking-complete-approved.html', 'datetime', 8],
  ['WEB-CUSTOMER', 'web-booking-complete-approved.html', 'customer-info', 8],
  ['WEB-CONFIRM', 'web-booking-complete-approved.html', 'confirm', 8],
  ['WEB-COMPLETE', 'web-booking-complete-approved.html', 'complete', 8],
  ['WEB-IDENTITY', 'web-booking-complete-approved.html', 'identity', 8],
  ['WEB-UNKNOWN', 'web-booking-complete-approved.html', 'unknown', 8],
]

/** 端末 1 台だけを描く単独モック。`.screen` / `.phone` が中身そのもの。 */
const SINGLE: [string, string, string][] = [
  /*
   * 設定ガイドと Web 予約は、承認済みモックが 2 つの方言で描かれている。
   * `-complete-` の側は全工程を 76px バーの寸法で、こちらは 67px バー +
   * ステータスバーの寸法で描く。どちらも却下されていないので両方を持つ。
   */
  ['SETTINGS-GUIDE', 'settings-approved.html', '.screen'],
  ['WEB-PURPOSE-COMPACT', 'web-booking-approved.html', '.phone:nth-of-type(1)'],
  ['WEB-DATETIME-COMPACT', 'web-booking-approved.html', '.phone:nth-of-type(2)'],
  ['ANALYTICS', 'analytics-approved.html', '.screen'],
  ['RECEPTION-HISTORY', 'reception-history-approved.html', '.screen'],
  ['STORE-SWITCH', 'store-switch-approved.html', '.screen'],
  ['SETTINGS-SP', 'settings-responsive-approved.html', '.phone'],
]

/** 外枠を持つモックの端末の高さ。例外画面と Web 予約だけ 760px。 */
const SHORT = new Set(['exception-states-approved.html', 'web-booking-complete-approved.html'])

/*
 * Web 予約のモックだけは iPad ではなくスマートフォンで、`.gallery` の
 * `grid-template-columns:repeat(3,375px)` が端末の幅そのものになる。
 * ここを iPad と同じ 1194px で撮ると、実装が描く幅（359px）と噛み合わない。
 */
const PHONE_SOURCES = new Set(['web-booking-complete-approved.html'])

/** 端末 1 台だけのモックの実寸。 */
const SINGLE_SIZE: Record<string, { width: number; height: number }> = {
  ANALYTICS: { width: 1176, height: 814 },
  'RECEPTION-HISTORY': { width: 1176, height: 814 },
  'STORE-SWITCH': { width: 1176, height: 814 },
  // `.phone` は外枠 9px 込みで 375×790。中身はその内側。
  'SETTINGS-SP': { width: 357, height: 772 },
  'SETTINGS-GUIDE': { width: 1176, height: 814 },
  // `.phone` は外枠 10px 込みで 342×680。中身はその内側。
  'WEB-PURPOSE-COMPACT': { width: 322, height: 660 },
  'WEB-DATETIME-COMPACT': { width: 322, height: 660 },
}

/**
 * 対象の 1 面だけを画面いっぱいに描いてから撮る。
 *
 * 台紙に載ったまま切り出すと、端末が小数の位置に置かれて字が半画素ずれ、
 * アプリ側（原点が整数）と全画面でうっすら食い違う。対象を原点へ寄せて、
 * ビューポートをその実寸にする方が、ずれの出どころを一つ減らせる。
 */
async function shoot(
  page: import('@playwright/test').Page,
  id: string,
  source: string,
  selector: string,
  size: { width: number; height: number },
) {
  await page.setViewportSize(size)
  await page.goto(`http://127.0.0.1:4176/${MOCKS}/${source}`, { waitUntil: 'networkidle' })
  /*
   * 対象を先に body 直下へ移し、そのうえで**その要素自身**へ寸法を書く。
   *
   * セレクタで指定してから移すと、`.phone:nth-of-type(1)` のような位置に依る
   * 指定が移動後の並びに当たり、別の面が撮れてしまう（実際に小型 Web 予約の
   * 2 面が同じ画像になっていた）。要素を掴んでから書けば、その取り違えは起きない。
   */
  await page.evaluate(
    ({ sel, width, height }) => {
      const target = document.querySelector<HTMLElement>(sel)
      if (!target) throw new Error(`対象が見つからない: ${sel}`)
      document.body.append(target)
      for (const sibling of Array.from(document.body.children))
        if (sibling !== target) (sibling as HTMLElement).style.display = 'none'
      Object.assign(target.style, {
        display: 'block',
        position: 'absolute',
        inset: '0',
        margin: '0',
        border: '0',
        borderRadius: '0',
        width: `${width}px`,
        height: `${height}px`,
      })
    },
    { sel: selector, width: size.width, height: size.height },
  )
  await withFonts(page)
  await page.screenshot({ path: `${OUT}/ref--${id}.png` })
  console.log(`  ref--${id}.png  ${size.width}x${size.height}`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await injectBaseline(page)

  // 引数で画面 ID を絞れる（並行作業のとき、自分の面だけ撮り直すため）。
  const only = new Set(process.argv.slice(2))
  const wanted = (id: string) => only.size === 0 || only.has(id)

  for (const [id, source, anchor, bezel] of SCREENS) {
    if (!wanted(id)) continue
    const device = PHONE_SOURCES.has(source) ? 375 : 1194
    const size = { width: device - bezel * 2, height: (SHORT.has(source) ? 760 : 832) - bezel * 2 }
    await shoot(page, id, source, `#${anchor}`, size)
  }

  for (const [id, source, selector] of SINGLE) {
    if (!wanted(id)) continue
    const size = SINGLE_SIZE[id]
    if (!size) throw new Error(`${id}: 実寸が未定義`)
    await shoot(page, id, source, selector, size)
  }

  await browser.close()
}

await main()
