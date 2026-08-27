/*
 * 突き合わせ台の画面を撮り、承認済みモックの基準画像と 1 枚ずつ重ねる。
 *
 * 出力は 3 種類:
 *   docs/frontend/diff/impl--<ID>.png   実装（モックと同じ実寸）
 *   docs/frontend/diff/diff--<ID>.png   差分（違う画素を赤で塗る）
 *   標準出力に、画面ごとの不一致画素の割合
 *
 * 「似ている」ではなく「何画素違うか」で判定するために作った。目視だけだと
 * 構造が違っていても雰囲気で通してしまう。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { PNG } from 'pngjs'

const OUT = '../../docs/frontend/diff'
const REF = '../../docs/frontend/reference'
const BASE = process.env.GALLERY_BASE ?? 'http://127.0.0.1:5199'

/** 画面 ID → 実寸。モックの外枠を除いた中身の大きさに合わせる。 */
const SIZES: Record<string, { width: number; height: number }> = {}
const IPAD = { width: 1176, height: 814 }
const IPAD_SHORT = { width: 1176, height: 742 }
const PHONE = { width: 359, height: 744 }

for (const id of ['SETTINGS-SP']) SIZES[id] = { width: 375, height: 790 }
for (const id of [
  'WEB-STORE-SEARCH',
  'WEB-STORE-DETAIL',
  'WEB-PURPOSE',
  'WEB-DATETIME',
  'WEB-CUSTOMER',
  'WEB-CONFIRM',
  'WEB-COMPLETE',
  'WEB-IDENTITY',
  'WEB-UNKNOWN',
])
  SIZES[id] = PHONE
for (const id of [
  'EX-MIC-DENIED',
  'EX-UPLOAD-FAILED',
  'EX-CONFLICT',
  'EX-STORE-UNSAVED',
  'EX-SHARED-LOCK',
  'EX-SESSION-REVOKED',
  'EX-EMPTY',
  'EX-403',
])
  SIZES[id] = IPAD_SHORT

function sizeOf(id: string) {
  return SIZES[id] ?? IPAD
}

/**
 * 画素 1 つを読む。`noUncheckedIndexedAccess` の下では添字が undefined を
 * 返しうるので、範囲外は 0（透明・黒）として扱う。画像の範囲内しか読まない
 * ため、この既定値が結果に混ざることはない。
 */
function at(data: Buffer, index: number) {
  return data[index] ?? 0
}

/** 画素単位で比べる。位置がずれた時点で違いなので、寛容な閾値は置かない。 */
function compare(id: string, actual: Buffer) {
  const reference = PNG.sync.read(readFileSync(`${REF}/ref--${id}.png`))
  const mine = PNG.sync.read(actual)
  if (reference.width !== mine.width || reference.height !== mine.height)
    return {
      ratio: 1,
      note: `寸法が違う ref=${reference.width}x${reference.height} impl=${mine.width}x${mine.height}`,
    }

  const diff = new PNG({ width: reference.width, height: reference.height })
  let differing = 0
  for (let i = 0; i < reference.data.length; i += 4) {
    const distance =
      Math.abs(at(reference.data, i) - at(mine.data, i)) +
      Math.abs(at(reference.data, i + 1) - at(mine.data, i + 1)) +
      Math.abs(at(reference.data, i + 2) - at(mine.data, i + 2))
    /*
     * 字の輪郭の反エイリアスだけを逃がす。ここを広く取ると、面の塗りが
     * 少しだけ違う（罫線の hex が 1〜2 違うなど）のを見逃す。実際 40 では
     * `#fff0ed` と `#fff1ed`、`#8b3b2c` と `#9b3425` の取り違えが 1 件も
     * 赤くならなかった。輪郭は 1 画素ずれれば全振幅で食い違うので、
     * この幅でも構造の差は必ず出る。
     */
    const same = distance <= 12
    diff.data[i] = same ? 255 : 255
    diff.data[i + 1] = same ? 255 : 0
    diff.data[i + 2] = same ? 255 : 0
    diff.data[i + 3] = 255
    if (!same) differing += 1
  }
  writeFileSync(`${OUT}/diff--${id}.png`, PNG.sync.write(diff))
  return { ratio: differing / (reference.width * reference.height), note: '' }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const only = process.argv.slice(2)
  const browser = await chromium.launch()

  const listing = await browser.newPage()
  await listing.goto(`${BASE}/__gallery`)
  const ids: string[] = await listing.evaluate(() =>
    Array.from(document.querySelectorAll('a'))
      .map((anchor) => new URL(anchor.href).searchParams.get('screen') ?? '')
      .filter((id) => id !== ''),
  )
  await listing.close()

  const targets = only.length > 0 ? only : ids
  const rows: [string, number, string][] = []
  for (const id of targets) {
    const size = sizeOf(id)
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 })
    await page.goto(`${BASE}/__gallery?screen=${id}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    const shot = await page.screenshot()
    writeFileSync(`${OUT}/impl--${id}.png`, shot)
    await page.close()
    const { ratio, note } = compare(id, shot)
    rows.push([id, ratio, note])
  }
  await browser.close()

  rows.sort((left, right) => right[1] - left[1])
  for (const [id, ratio, note] of rows)
    console.log(`${(ratio * 100).toFixed(2).padStart(6)}%  ${id}${note ? `  — ${note}` : ''}`)
}

await main()
