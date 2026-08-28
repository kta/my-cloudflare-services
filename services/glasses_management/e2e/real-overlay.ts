/*
 * 実データで撮った実アプリ（`screens.capture.ts` の出力）と、承認済みモックの
 * 基準画像を重ねる。
 *
 * `gallery.diff.ts` が見ているのは突き合わせ台（表示だけの複製）で、そこが
 * 一致していても実アプリが一致している証明にはならない。実際、台が 47 枚
 * 一致している間に、実アプリの側では要素が落ちたり寸法が崩れたりしていた。
 *
 * 実アプリには承認済みモックに無いものが 1 つある——全画面共通の左サイドバーで、
 * `docs/frontend/REBUILD.md` に理由を書いた意図的な逸脱である。柱のぶんだけ
 * 本文が右へ寄るので割合は必ず大きく出る。**ここで見るのは割合ではなく、
 * 平坦な色の取り違えと、面の中身が基準と同じ語彙・同じ並びかどうか**である。
 */
import { readdirSync } from 'node:fs'
import { compare } from './overlay.ts'

const SHOTS = '../../docs/frontend/screens'

const only = new Set(process.argv.slice(2))
const rows: { id: string; ratio: number; note: string }[] = []

for (const name of readdirSync(SHOTS).sort()) {
  if (!name.startsWith('impl--') || !name.endsWith('.png')) continue
  const id = name.slice('impl--'.length).split('--')[0] ?? ''
  if (only.size > 0 && !only.has(id)) continue
  try {
    const report = compare(id, `${SHOTS}/${name}`)
    rows.push({ id, ratio: report.ratio, note: report.note })
  } catch {
    // 基準画像を持たない状態（`--selected` などの派生）は突き合わせない。
  }
}

for (const row of rows.sort((left, right) => right.ratio - left.ratio))
  console.log(
    `${row.id.padEnd(24)} ${(row.ratio * 100).toFixed(2).padStart(6)}%  ${row.note}`.trimEnd(),
  )
