import { focusRing, focusRingOnPine } from '@app/ui'
import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react'
import { jstClock } from '../ledger/metrics'

/*
 * ご要望を手書きで残す（承認済みモック docs/frontend/mockups/eye/images/BOOK-04d-HANDWRITE.png）。
 *
 * この面の仕事は「伺ったことばを、文字に直さずかたちのまま残す」こと。
 *
 * 実測値（screens/BOOK-04d-HANDWRITE.html と assets/eye.css の `.canvas` / `.pen`）:
 *   本文 1fr ／ 右の柱 320px、本文の余白 32px 40px・柱 32px 26px。
 *   道具（`.pen`）は最小 48×44px・角 8px、仕切りは 1px×32px。
 *   用紙は高さ 420px・上に 20px、罫は 44px ごと。罫の下に
 *   「記入　山田 大輔（店長）　11:04」（右寄せ・13px）。
 *
 * **「文字に変換する」を出さない**（AC-BOOK-12）。無料枠の構成にサーバ側の文字認識を置かず、
 * 端末側の手書き認識も持たないので、押しても何も起きないボタンを画面に出さない。
 * 同じ理由で、右の柱の「文字にするとこうなります」の下書きも出さない —— 出せる読み取り結果が
 * 存在せず、空欄だけを置くと「読み取りに失敗した」と誤解される。
 *
 * ポインタの扱いは `07-nfr.md` §2.9 のまま:
 *   Pointer Events で受け、Apple Pencil が接触している間は指のイベントを捨てる（手のひらの誤爆）。
 *   用紙に `touch-action: none` を入れる（入れないと指で滑らせたときに背後の本文が動く）。
 *   筆圧は使わない（指と Pencil で線の太さを変えない）。
 *
 * 筆跡そのものは D1 に置かない（1 枚 3〜12KB × 5 枚 × 5,000 顧客で 500MB の 6 割を占める）。
 * この部品は SVG の文字列を `onSave` で親へ渡すだけで、R2 への保存と
 * `draft_json.handwritingKeys` への記録は器の仕事である。
 */

/** 用紙の座標系。実寸 420px の高さに対して 794×420 の viewBox（モックの実測）。 */
const PAPER_WIDTH = 794
const PAPER_HEIGHT = 420
/** 罫の間隔。モックの `background-size: 100% 44px` と同じ。 */
const RULE_STEP = 44

/*
 * 消しゴムが線に触れたと見なす半径（用紙の座標）。
 * 太さ「太」の 7px より広く取る —— ぴったり同じだと、線の真上を狙わないと消えず、
 * 「消えない消しゴム」になる。
 */
const ERASER_REACH = 12

/** 用紙の座標。 */
type Point = { x: number; y: number }

const TOOLS = [
  { key: 'pen', label: 'ペン' },
  { key: 'marker', label: 'マーカー' },
  { key: 'eraser', label: '消しゴム' },
] as const

const WIDTHS = [
  { key: 'thin', label: '細', stroke: 2 },
  { key: 'medium', label: '中', stroke: 4 },
  { key: 'thick', label: '太', stroke: 7 },
] as const

type ToolKey = (typeof TOOLS)[number]['key']
type WidthKey = (typeof WIDTHS)[number]['key']

/** 1 本の線。かたちのまま残すので、点の並びをそのまま持つ。 */
export type HandwrittenStroke = {
  d: string
  stroke: number
  tool: ToolKey
}

/** 残した 1 枚。`svg` は R2 へ、`strokes` は画面に描き直すために持つ。 */
export type HandwrittenNote = {
  id: string
  svg: string
  strokes: readonly HandwrittenStroke[]
  /** 読み上げ用の説明。読み取った文字は持たないので、そのことを言う。 */
  description: string
  writtenBy: string
  writtenAt: string
}

/** 道具の札は 48pt（`min-h-12`）。44pt の下限より大きく取る（BOOK-04d の実測）。 */
const TOOL_CLASS = `min-h-12 min-w-12 rounded-ctl px-3.5 font-semibold text-body ${focusRing}`
const TOOL_ON = `${TOOL_CLASS} border-2 border-pine bg-pine-soft text-pine-deep`
const TOOL_OFF = `${TOOL_CLASS} border border-line-strong bg-surface text-ink`

/** 「記入　山田 大輔（店長）　11:08」。 */
export function signature(writer: string, now: string): string {
  return `記入　${writer}　${jstClock(now)}`
}

/** 読み上げ用の説明。読み取った文字を持たないことを名前の中で言い切る。 */
function describe(writer: string, now: string): string {
  return `手書きのご要望　文字にしていません　${signature(writer, now)}`
}

/** 残した筆跡を描き直す（保存したものと同じ形）。 */
export function HandwrittenInk({
  strokes,
  description,
}: {
  strokes: readonly HandwrittenStroke[]
  description: string
}) {
  return (
    <svg
      role="img"
      aria-label={description}
      viewBox={`0 0 ${PAPER_WIDTH} ${PAPER_HEIGHT}`}
      className="block h-auto w-full"
    >
      <title>{description}</title>
      {strokes.map((stroke) => (
        <path
          key={stroke.d}
          d={stroke.d}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke.stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={stroke.tool === 'marker' ? 0.45 : 1}
        />
      ))}
    </svg>
  )
}

export type HandwritingProps = {
  /** 記入者。「山田 大輔（店長）」。 */
  writer: string
  /** 記入の時刻。端末の時計を読まない（引数で受ける）。 */
  now: string
  onSave: (note: HandwrittenNote) => void
  onCancel: () => void
  isOffline?: boolean
}

export function Handwriting({
  writer,
  now,
  onSave,
  onCancel,
  isOffline = false,
}: HandwritingProps) {
  const [tool, setTool] = useState<ToolKey>('pen')
  const [width, setWidth] = useState<WidthKey>('medium')
  const [strokes, setStrokes] = useState<readonly HandwrittenStroke[]>([])
  /*
   * いま引いている途中の線。ref ではなく state に置く —— ref に貯めるだけだと
   * 指を離すまで用紙に何も出ず、「書けていない」と思って二度なぞることになる。
   * 1 本ぶんの点の配列を差し替えるだけなので、なぞっている間の再描画は用紙 1 枚に収まる。
   */
  const [live, setLive] = useState<readonly Point[] | null>(null)
  const drawing = useRef<number | null>(null)
  // Apple Pencil が触れている間は指のイベントを捨てる（手のひらの誤爆を防ぐ）。
  const penDown = useRef(false)
  const paperRef = useRef<HTMLDivElement>(null)

  const stroke = WIDTHS.find((item) => item.key === width)?.stroke ?? 4

  /*
   * 用紙の中の座標へ直す。
   * `<svg>` は `preserveAspectRatio="xMinYMin meet"` なので、用紙の枠より縦横比が
   * 合わないぶんは**縮小して左上に寄る**。枠の幅と高さでそれぞれ割ると、その縮小と
   * 余白を無視することになり、線が指より右下へずれて出る。だから縮尺は 1 つだけ求める。
   * 測れない環境（jsdom）では原点のままでよい。
   */
  function pointOf(event: ReactPointerEvent<HTMLDivElement>): Point {
    const box = paperRef.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0 || box.height === 0) {
      return { x: event.clientX, y: event.clientY }
    }
    const scale = Math.min(box.width / PAPER_WIDTH, box.height / PAPER_HEIGHT)
    return {
      x: round1((event.clientX - box.left) / scale),
      y: round1((event.clientY - box.top) / scale),
    }
  }

  /** 消しゴムでなぞった 1 点に触れた線を落とす。 */
  function eraseAt(point: Point) {
    setStrokes((kept) => kept.filter((item) => !touches(item, point)))
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch' && penDown.current) return
    if (event.pointerType === 'pen') penDown.current = true
    drawing.current = event.pointerId
    const point = pointOf(event)
    if (tool === 'eraser') eraseAt(point)
    else setLive([point])
    const target = event.currentTarget
    if (typeof target.setPointerCapture === 'function') target.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (drawing.current !== event.pointerId) return
    // `touch-action: none` と合わせて、なぞっている間は背後の本文を 1px も動かさない。
    event.preventDefault()
    const point = pointOf(event)
    if (tool === 'eraser') {
      eraseAt(point)
      return
    }
    setLive((points) => (points === null ? [point] : [...points, point]))
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (drawing.current !== event.pointerId) return
    drawing.current = null
    if (event.pointerType === 'pen') penDown.current = false
    const points = live
    setLive(null)
    if (tool === 'eraser' || points === null || points.length === 0) return
    setStrokes((kept) => [...kept, { d: toPath(points), stroke, tool }])
  }

  function keep() {
    const description = describe(writer, now)
    onSave({
      id: crypto.randomUUID(),
      svg: toSvg(strokes, description),
      strokes,
      description,
      writtenBy: writer,
      writtenAt: now,
    })
  }

  const empty = strokes.length === 0
  return (
    <div className="flex h-full w-full min-h-0">
      <section className="min-w-0 flex-1 overflow-hidden px-10 py-8">
        <div className="mb-2.5 flex items-start gap-2.5">
          <span aria-hidden="true" className="mt-1.5 h-4.5 w-5.5 shrink-0 rounded-ctl bg-pine" />
          <div>
            <h2 className="text-title font-semibold text-ink">ご要望をそのまま書き留めます</h2>
            <p className="mt-0.5 text-body text-ink-muted">
              伺ったことばのまま、指かペンで書けます。
            </p>
          </div>
        </div>

        <fieldset aria-label="ペンと太さ" className="flex min-w-0 items-center gap-2">
          {TOOLS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={tool === item.key}
              onClick={() => setTool(item.key)}
              className={tool === item.key ? TOOL_ON : TOOL_OFF}
            >
              {item.label}
            </button>
          ))}
          <span aria-hidden="true" className="mx-1.5 h-8 w-px bg-line-strong" />
          {WIDTHS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={width === item.key}
              onClick={() => setWidth(item.key)}
              className={width === item.key ? TOOL_ON : TOOL_OFF}
            >
              {item.label}
            </button>
          ))}
          <span aria-hidden="true" className="mx-1.5 h-8 w-px bg-line-strong" />
          {/*
            消しゴムは「なぞったところを消す」道具、この札は「さっきの 1 本をなかったことにする」。
            別の仕事なので、名前も置き場所も分けている。
          */}
          <button
            type="button"
            disabled={empty}
            aria-label={empty ? '取り消し　書いた線があると押せます' : undefined}
            onClick={() => setStrokes((kept) => kept.slice(0, -1))}
            className={empty ? `${TOOL_OFF} text-ink-faint` : TOOL_OFF}
          >
            取り消し
          </button>
        </fieldset>

        {/* 用紙。`touch-action: none` はここに入れる（`07-nfr.md` §2.9）。
            中の `<svg>` は `aria-hidden` なので、**用紙そのものに名前を持たせる** ——
            さもないと読み上げでは面のいちばん大きい場所が無音になり、そこに何があるのか、
            いま何本書けているのかが分からない。 */}
        <div
          ref={paperRef}
          data-testid="handwriting-paper"
          role="img"
          aria-label={
            empty
              ? '手書きの用紙　まだ何も書かれていません'
              : `手書きの用紙　線 ${strokes.length}本`
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="mt-5 h-105 touch-none overflow-hidden rounded-card border border-line-strong bg-surface text-ink"
        >
          <svg
            viewBox={`0 0 ${PAPER_WIDTH} ${PAPER_HEIGHT}`}
            preserveAspectRatio="xMinYMin meet"
            className="block h-full w-full"
            aria-hidden="true"
          >
            {rulePositions().map((y) => (
              <line
                key={y}
                data-testid="handwriting-rule"
                x1={0}
                x2={PAPER_WIDTH}
                y1={y}
                y2={y}
                stroke="var(--color-line)"
                strokeWidth={1}
              />
            ))}
            {strokes.map((item) => (
              <path
                key={item.d}
                data-testid="handwriting-stroke"
                d={item.d}
                fill="none"
                stroke="currentColor"
                strokeWidth={item.stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={item.tool === 'marker' ? 0.45 : 1}
              />
            ))}
            {live !== null && live.length > 0 && (
              <path
                data-testid="handwriting-live"
                d={toPath(live)}
                fill="none"
                stroke="currentColor"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={tool === 'marker' ? 0.45 : 1}
              />
            )}
          </svg>
        </div>
        <p className="mt-3 text-right text-grid text-ink-muted">{signature(writer, now)}</p>
      </section>

      <aside
        aria-label="手書きの残し方"
        className="flex w-80 shrink-0 flex-col border-line border-l bg-surface px-6.5 py-8"
      >
        <h3 className="m-0 text-body font-semibold text-ink">伺ったことばのまま残します</h3>
        <p className="mt-2.5 text-body text-ink-muted leading-relaxed">
          文字には直しません。読み上げでは「手書きのご要望」としてお伝えします。
        </p>
        <div className="mt-auto flex flex-col gap-3">
          <button
            type="button"
            onClick={onCancel}
            className={`min-h-12 w-full rounded-card border border-line-strong bg-surface text-body font-semibold text-ink ${focusRing}`}
          >
            書くのをやめる
          </button>
          <button
            type="button"
            disabled={empty || isOffline}
            aria-label={
              empty
                ? '手書きのまま残す　用紙に書くと押せます'
                : isOffline
                  ? '手書きのまま残す　通信が戻ると押せます'
                  : undefined
            }
            onClick={keep}
            className={`min-h-12 w-full rounded-card border border-pine bg-pine text-body font-semibold text-on-pine disabled:border-line disabled:bg-surface-2 disabled:text-ink-faint ${focusRingOnPine}`}
          >
            手書きのまま残す
          </button>
        </div>
      </aside>
    </div>
  )
}

/** 罫の位置。モックは 43px から 44px ごと。 */
function rulePositions(): number[] {
  const lines: number[] = []
  for (let y = RULE_STEP - 1; y < PAPER_HEIGHT; y += RULE_STEP) lines.push(y)
  return lines
}

/**
 * R2 へ置く 1 枚。罫は残さない（罫は用紙の見た目であって、伺った内容ではない）。
 * 線の色は `currentColor` にして、置いた先の文字色に従わせる（生の色を焼き込まない）。
 */
function toSvg(strokes: readonly HandwrittenStroke[], description: string): string {
  const paths = strokes
    .map(
      (item) =>
        `<path d="${item.d}" fill="none" stroke="currentColor" stroke-width="${item.stroke}" stroke-linecap="round" stroke-linejoin="round"${item.tool === 'marker' ? ' opacity="0.45"' : ''}/>`,
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAPER_WIDTH} ${PAPER_HEIGHT}" role="img" aria-label="${description}">${paths}</svg>`
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 点の並びを 1 本の線に直す。 */
function toPath(points: readonly Point[]): string {
  const [head, ...rest] = points
  if (head === undefined) return ''
  return `M${head.x} ${head.y}${rest.map((point) => `L${point.x} ${point.y}`).join('')}`
}

/** 線の `d` を点の並びへ戻す（消しゴムの当たり判定で使う）。 */
function pointsOf(d: string): Point[] {
  return d
    .slice(1)
    .split('L')
    .map((part) => {
      const [x, y] = part.trim().split(/\s+/).map(Number)
      return { x: x ?? 0, y: y ?? 0 }
    })
}

/** 消しゴムの 1 点が線に触れているか。線分との距離で見る（点だけ見ると隙間をすり抜ける）。 */
function touches(item: HandwrittenStroke, point: Point): boolean {
  const points = pointsOf(item.d)
  const reach = ERASER_REACH + item.stroke / 2
  const head = points[0]
  if (head === undefined) return false
  if (points.length === 1) return distance(head, point) <= reach
  return points.some((from, index) => {
    const to = points[index + 1]
    return to !== undefined && distanceToSegment(point, from, to) <= reach
  })
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return distance(point, from)
  const t = Math.min(
    1,
    Math.max(0, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
  )
  return distance(point, { x: from.x + t * dx, y: from.y + t * dy })
}
