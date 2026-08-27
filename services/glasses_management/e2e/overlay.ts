/*
 * モックと実装を重ね合わせて、目でも数でも突き合わせる。
 *
 * `gallery.diff.ts` は「違う画素の割合」しか出さない。割合は面の広さに
 * 引きずられるし、1 画素ずれているのか 20 画素ずれているのかも、ずれが
 * どちらの向きなのかも分からない。ここでは 1 枚の画像に次の 5 面を並べる。
 *
 *   1. 基準（モック）
 *   2. 実装
 *   3. 重ね合わせ — 基準を赤、実装を青の版にして 1 枚に刷る。合っていれば
 *      灰色に、ずれていれば赤と青が分かれて見える（ずれの向きが読める）。
 *   4. 差分 — 違う画素を赤で塗る
 *   5. ずらし探索の結果 — 上下左右に ±8 画素ずらして最も合う位置を探し、
 *      原点以外が最良なら「面ごと何画素ずれているか」を数字で出す
 *
 * 縦横が違うときは、比べる前に必ず落とす（黙って伸縮させると、ずれが
 * 「なんとなく似ている」に化けて判定できなくなる）。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const REF = '../../docs/frontend/reference'
const OUT = '../../docs/frontend/overlay'

/**
 * 画素 1 つを読む。`noUncheckedIndexedAccess` の下では添字が undefined を
 * 返しうるので、範囲外は 0 として扱う。範囲内しか読まないため結果に混ざらない。
 */
function at(data: Buffer, index: number) {
  return data[index] ?? 0
}

/** 画素 1 つの距離。色の違いをまとめて 1 つの数にする。 */
function distance(a: PNG, b: PNG, index: number) {
  return (
    Math.abs(at(a.data, index) - at(b.data, index)) +
    Math.abs(at(a.data, index + 1) - at(b.data, index + 1)) +
    Math.abs(at(a.data, index + 2) - at(b.data, index + 2))
  )
}

/** 反エイリアスの揺れだけを逃がす幅。塗りの取り違えはここに隠れない。 */
const TOLERANCE = 12

function read(path: string) {
  return PNG.sync.read(readFileSync(path))
}

/** 版を分けて 1 枚に刷る。基準が赤、実装が青。合っていれば灰色になる。 */
function overlay(reference: PNG, mine: PNG) {
  const out = new PNG({ width: reference.width, height: reference.height })
  for (let i = 0; i < reference.data.length; i += 4) {
    // それぞれの明るさだけを取り出し、赤版と青版に振り分ける。
    const left = (at(reference.data, i) + at(reference.data, i + 1) + at(reference.data, i + 2)) / 3
    const right = (at(mine.data, i) + at(mine.data, i + 1) + at(mine.data, i + 2)) / 3
    out.data[i] = left
    out.data[i + 1] = Math.round((left + right) / 2)
    out.data[i + 2] = right
    out.data[i + 3] = 255
  }
  return out
}

/** 違う画素を赤で塗る。 */
function difference(reference: PNG, mine: PNG) {
  const out = new PNG({ width: reference.width, height: reference.height })
  let differing = 0
  for (let i = 0; i < reference.data.length; i += 4) {
    const same = distance(reference, mine, i) <= TOLERANCE
    out.data[i] = 255
    out.data[i + 1] = same ? 255 : 0
    out.data[i + 2] = same ? 255 : 0
    out.data[i + 3] = 255
    if (!same) differing += 1
  }
  return { png: out, differing }
}

/**
 * 上下左右にずらして、最も合う位置を探す。
 *
 * 原点以外が最良なら、その面はまるごとその画素数だけずれている。字の輪郭の
 * 揺れなら原点が最良のままなので、この 2 つを取り違えずに済む。
 */
function bestShift(reference: PNG, mine: PNG, radius = 8) {
  let best = { dx: 0, dy: 0, differing: Number.POSITIVE_INFINITY }
  for (let dy = -radius; dy <= radius; dy += 1)
    for (let dx = -radius; dx <= radius; dx += 1) {
      let differing = 0
      for (let y = radius; y < reference.height - radius; y += 2)
        for (let x = radius; x < reference.width - radius; x += 2) {
          const left = (y * reference.width + x) * 4
          const right = ((y + dy) * mine.width + (x + dx)) * 4
          const d =
            Math.abs(at(reference.data, left) - at(mine.data, right)) +
            Math.abs(at(reference.data, left + 1) - at(mine.data, right + 1)) +
            Math.abs(at(reference.data, left + 2) - at(mine.data, right + 2))
          if (d > TOLERANCE) differing += 1
        }
      if (differing < best.differing) best = { dx, dy, differing }
    }
  return best
}

/** 5 面を横に並べて 1 枚にする。間に細い区切りを入れる。 */
function contactSheet(panes: PNG[], gap = 8) {
  const height = Math.max(...panes.map((pane) => pane.height))
  const width = panes.reduce((sum, pane) => sum + pane.width, 0) + gap * (panes.length - 1)
  const sheet = new PNG({ width, height })
  sheet.data.fill(120)
  let offset = 0
  for (const pane of panes) {
    for (let y = 0; y < pane.height; y += 1)
      for (let x = 0; x < pane.width; x += 1) {
        const from = (y * pane.width + x) * 4
        const to = (y * width + x + offset) * 4
        for (let k = 0; k < 4; k += 1) sheet.data[to + k] = at(pane.data, from + k)
      }
    offset += pane.width + gap
  }
  return sheet
}

export type Report = {
  id: string
  ok: boolean
  /** 違う画素の割合。 */
  ratio: number
  /** 面ごとのずれ。0,0 以外なら配置がずれている。 */
  shift: { dx: number; dy: number }
  /** 平坦な色どうしの取り違え（両方が面の色）。ここが空でないと塗りが違う。 */
  fills: { pair: string; count: number }[]
  note: string
}

/**
 * 平坦な色どうしの取り違えだけを拾う。
 *
 * 文字の輪郭は地色と文字色の間の中間色になるので、両端のどちらとも違う。
 * 対の両方が「その画像の中で広い面積を占める色」であるときだけ、塗りの
 * 取り違えとみなす。
 */
function flatFills(reference: PNG, mine: PNG) {
  const hex = (png: PNG, index: number) =>
    `#${[0, 1, 2]
      .map((k) =>
        at(png.data, index + k)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`
  const area = new Map<string, number>()
  for (let i = 0; i < reference.data.length; i += 4) {
    for (const png of [reference, mine]) {
      const key = hex(png, i)
      area.set(key, (area.get(key) ?? 0) + 1)
    }
  }
  // 面として成立する広さ。これ未満は文字か輪郭とみなす。
  const FLAT = 2000
  const pairs = new Map<string, number>()
  for (let i = 0; i < reference.data.length; i += 4) {
    const left = hex(reference, i)
    const right = hex(mine, i)
    if (left === right) continue
    if ((area.get(left) ?? 0) < FLAT || (area.get(right) ?? 0) < FLAT) continue
    const key = `${left} → ${right}`
    pairs.set(key, (pairs.get(key) ?? 0) + 1)
  }
  return [...pairs]
    .map(([pair, count]) => ({ pair, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

export function compare(id: string, implPath: string): Report {
  mkdirSync(OUT, { recursive: true })
  const reference = read(`${REF}/ref--${id}.png`)
  const mine = read(implPath)

  if (reference.width !== mine.width || reference.height !== mine.height)
    return {
      id,
      ok: false,
      ratio: 1,
      shift: { dx: 0, dy: 0 },
      fills: [],
      note: `縦横が違う 基準=${reference.width}x${reference.height} 実装=${mine.width}x${mine.height}`,
    }

  const { png: diff, differing } = difference(reference, mine)
  const shift = bestShift(reference, mine)
  const fills = flatFills(reference, mine)

  const shifted = new PNG({ width: reference.width, height: reference.height })
  shifted.data.fill(255)
  if (shift.dx !== 0 || shift.dy !== 0)
    for (let y = 0; y < reference.height; y += 1)
      for (let x = 0; x < reference.width; x += 1) {
        const from = ((y + shift.dy) * mine.width + (x + shift.dx)) * 4
        const to = (y * reference.width + x) * 4
        if (from < 0 || from >= mine.data.length) continue
        for (let k = 0; k < 4; k += 1) shifted.data[to + k] = at(mine.data, from + k)
      }

  writeFileSync(
    `${OUT}/overlay--${id}.png`,
    PNG.sync.write(contactSheet([reference, mine, overlay(reference, mine), diff, shifted])),
  )

  const ratio = differing / (reference.width * reference.height)
  const aligned = shift.dx === 0 && shift.dy === 0
  return {
    id,
    ok: aligned && fills.length === 0,
    ratio,
    shift,
    fills,
    note: aligned ? '' : `面が ${shift.dx},${shift.dy} 画素ずれている`,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // 引数が無ければ、基準画像がある画面すべてを対象にする。
  const ids =
    process.argv.length > 2
      ? process.argv.slice(2)
      : readdirSync(REF)
          .filter((name) => name.startsWith('ref--') && name.endsWith('.png'))
          .map((name) => name.slice('ref--'.length, -'.png'.length))
          .sort()
  const rows = ids.map((id) => compare(id, `../../docs/frontend/diff/impl--${id}.png`))
  for (const row of rows.sort((a, b) => b.ratio - a.ratio)) {
    const marks = [
      row.ok ? '一致' : '要修正',
      `${(row.ratio * 100).toFixed(2)}%`,
      row.shift.dx || row.shift.dy ? `ずれ ${row.shift.dx},${row.shift.dy}` : '',
      row.fills.map((fill) => `${fill.pair} ×${fill.count}`).join(' / '),
      row.note,
    ].filter((part) => part !== '')
    console.log(`${row.id.padEnd(24)} ${marks.join('  ')}`)
  }
}
