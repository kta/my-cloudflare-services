import type { AvailabilityLane, AvailabilitySlot } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { type PointerEvent, type ReactNode, type Ref, useEffect, useRef } from 'react'
import { jstClock } from '../ledger/metrics'
import type { BoardCell } from './slot-drag'

/*
 * 工程 3 の盤（承認済みモック docs/frontend/mockups/eye/images/BOOK-03-SLOT-STAFF.png /
 * BOOK-03b-SLOT-RESOURCE.png / BOOK-03c-DRAG.png）。
 *
 * 題材: 希望時刻に帯を置いてみて、先約とぶつかるかどうかを目で見る面。
 * シグネチャ: 縦軸を担当 ⇄ 設備で入れ替えても、選んだものが保たれること。
 *
 * **「空き」の大きな札を置かない。** ご希望の日時はもう決まっているので、空いている枠は
 * 薄い線だけにする（モックの「ここに置けます」は出さない）。破線を出すのは
 * **運んでいる先**だけで、それは空きの札ではなく「指を離すとここになる」という合図である。
 *
 * 色だけで伝えない: 先約は灰の帯に「先約」、重なりは赤の帯に「重なっています」、
 * 承れない担当は斜線に「この用件は承れません」と必ず文字を添える。
 *
 * role は `table`。台帳（P2 の `Timetable`）は枠を選べるので `grid` だが、この盤で
 * 押せるのは帯のつまみだけで、枠そのものは選べない。APG の grid を名乗ると矢印キーでの
 * 焦点移動を約束することになるので名乗らない（キーボードの道は右の候補ボタン）。
 *
 * 実測（screens/BOOK-03-SLOT-STAFF.html の <style> と assets/eye.css）:
 *   .tt-grid = 170px ＋ 30分刻み 1fr。.tt-head 34px / .tt-name 64px / .tt-cell 64px
 *   .appt    = min-height 54px・角 8px・padding 6px 8px・左に 4px の色帯
 *   .appt.clash = 3px の --alert 罫。.appt.placing = 3px の --brand 罫 ＋ 影
 *   .appt.origin = opacity .35。.ghost = 2px 破線・下端から 9px に行き先の時刻
 */

/** 1rem。px の実測値を rem へ直すのに使う。 */
const REM_PX = 16
/** 名前列（`.tt-grid` の 170px）。 */
const LABEL_WIDTH_PX = 170
/** 列見出しの高さ（`.tt-head`）。 */
const HEAD_HEIGHT_PX = 34
/** モックが描く窓（10:00–14:00 の 30分刻み 8 列）。ここを越えた日だけ横に流す。 */
const WINDOW_COLUMNS = 8

/** 盤の外枠に付ける読み上げ名。e2e が座標を測るときの目印にもなる。 */
const BOARD_LABEL = 'ご予約を置く盤'
/** 盤の割り付け。`snapToCell` に渡す `labelWidth` / `headHeight` の正本。 */
export const BOARD_LABEL_WIDTH_PX = LABEL_WIDTH_PX
export const BOARD_HEAD_HEIGHT_PX = HEAD_HEIGHT_PX

/**
 * 承れない担当の行の斜線。色は必ずトークン（`var(--color-line)`）を指す。
 * Tailwind の任意値（`bg-[...]`）を書かないので、ここだけ style で持つ。
 */
const HATCH =
  'repeating-linear-gradient(45deg, transparent 0 0.375rem, var(--color-line) 0.375rem 0.4375rem)'

/** 帯の見た目。`open` は帯を持たない（薄い線だけ）。 */
type BandKind = 'open' | 'booked' | 'break' | 'maintenance' | 'off' | 'no_skill'

const BAND_TITLE: Record<Exclude<BandKind, 'open' | 'no_skill'>, string> = {
  booked: '先約',
  break: '休憩',
  maintenance: '点検',
  off: '勤務時間外',
}

/**
 * 設備の行に「休憩」「勤務時間外」と書かない —— 機械は休憩も勤務もしない。
 * 同じ塞がりでも、設備の軸では受付を止めている時間・お店を閉めている時間として言う
 * （承認済みモック BOOK-03b-SLOT-RESOURCE の設備軸は「点検」だけを描いている）。
 */
const EQUIPMENT_BAND_TITLE: Partial<Record<Exclude<BandKind, 'open' | 'no_skill'>, string>> = {
  break: '受付停止',
  off: '営業時間外',
}

function bandTitle(kind: Exclude<BandKind, 'open' | 'no_skill'>, lane: AvailabilityLane): string {
  if (lane.kind === 'equipment') return EQUIPMENT_BAND_TITLE[kind] ?? BAND_TITLE[kind]
  return BAND_TITLE[kind]
}

function bandKindOf(slot: AvailabilitySlot): BandKind {
  if (slot.isAvailable) return 'open'
  switch (slot.reason) {
    case 'staff_busy':
    case 'equipment_busy':
    case 'max_parallel':
      return 'booked'
    case 'break':
      return 'break'
    case 'maintenance':
      return 'maintenance'
    case 'staff_off':
      return 'off'
    case 'no_skill':
      return 'no_skill'
    default:
      // 営業時間の外・使える設備が無い等は、盤に帯を描かず右の相談欄が理由を言う。
      return 'open'
  }
}

type SegmentRole = 'plain' | 'placed' | 'drop'
type Segment = { kind: BandKind; column: number; span: number; role: SegmentRole }

/**
 * 行を帯へ割る。**置いている帯と運んでいる先はセル 1 つとして先に取り置く** —
 * 先約の上に重ねるので、そこで切れていないと帯を乗せる場所が無くなる。
 * 残りは同じ見た目の枠どうしをつないで 1 本にする（「休憩 12:00–13:00」）。
 */
function segmentsOf(
  slots: readonly AvailabilitySlot[],
  reserved: readonly { column: number; span: number; role: SegmentRole }[],
): Segment[] {
  const byColumn = new Map(reserved.map((item) => [item.column, item]))
  const segments: Segment[] = []
  let index = 0
  while (index < slots.length) {
    const taken = byColumn.get(index)
    const slot = slots[index]
    if (slot === undefined) break
    if (taken !== undefined) {
      segments.push({
        kind: bandKindOf(slot),
        column: index,
        span: Math.min(taken.span, slots.length - index),
        role: taken.role,
      })
      index += Math.min(taken.span, slots.length - index)
      continue
    }
    const kind = bandKindOf(slot)
    const last = segments.at(-1)
    if (last !== undefined && last.role === 'plain' && last.kind === kind) {
      last.span += 1
    } else {
      segments.push({ kind, column: index, span: 1, role: 'plain' })
    }
    index += 1
  }
  return segments
}

/**
 * 列が窓（8 列）より増えた日に、盤の中だけを横へ流すための最小幅。
 *
 * **窓にはちょうど 8 列を出す。**列の幅を先に決めて余りを流すと、9 列目と 10 列目の頭が
 * 右の柱へ食い込んで切れる（承認済みモック BOOK-03 は 10:00–13:30 の 8 列を端まで描く）。
 * 名前列を除いた残りを 8 等分した幅で、列の本数ぶんの盤を作る。
 */
function boardMinWidth(columns: number): string {
  if (columns <= WINDOW_COLUMNS) return '100%'
  const label = `${LABEL_WIDTH_PX / REM_PX}rem`
  return `calc(${label} + (100% - ${label}) * ${columns / WINDOW_COLUMNS})`
}

/** 運んでいる最中の見え方。運んでいなければ渡さない。 */
export type BoardDrag = {
  /** 行き先の枠。置けないところを指していても、指の位置は行き先として持つ。 */
  target: BoardCell | null
  /** そこへ置けるか。置けないときは破線の枠を出さない。 */
  canDrop: boolean
  /** 破線の枠に書く行き先（「13:00–14:00 へ」）。 */
  label: string
}

export type SlotBoardProps = {
  /** 左上の見出し（「担当者」/「設備・場所」）。 */
  axisLabel: string
  lanes: AvailabilityLane[]
  /** 列の開始時刻（ISO8601）。サーバの結果をそのまま並べる。 */
  columnStarts: string[]
  /** このご予約が占める列数。 */
  span: number
  /** いま置いているご予約の場所。 */
  placed: BoardCell
  /** 置いている帯の時刻（「11:00–12:00」）。読み上げと「もとの場所」に使う。 */
  placedLabel: string
  /** 運んでいる帯に書くご用件と所要。 */
  purposeLabel: string
  durationMinutes: number
  /** 置いている場所が先約と重なっているか。 */
  hasClash: boolean
  drag: BoardDrag | null
  onGrab: (event: PointerEvent<HTMLElement>) => void
  onDragMove: (event: PointerEvent<HTMLElement>) => void
  onDragEnd: (event: PointerEvent<HTMLElement>) => void
  boardRef: Ref<HTMLDivElement>
}

export function SlotBoard({
  axisLabel,
  lanes,
  columnStarts,
  span,
  placed,
  placedLabel,
  purposeLabel,
  durationMinutes,
  hasClash,
  drag,
  onGrab,
  onDragMove,
  onDragEnd,
  boardRef,
}: SlotBoardProps) {
  const columns = columnStarts.length
  const scrollerRef = useRef<HTMLDivElement>(null)

  /*
   * いま置いているご予約を必ず窓の中に入れる。
   *
   * 盤は 1 日ぶんの列を持つが、窓に入るのはモックの 8 列（10:00–14:00）だけで、
   * 残りは横に流れる。**流れた先に置いてあると、この面の仕事そのものが見えない** ——
   * 右の柱が「14:00 の先約があります」「指でつかんで動かせます」と言っているのに、
   * その 14:00 も、つかむはずの帯も画面の外にある（UX 監査 J-05。実測で
   * scrollWidth 1732 / clientWidth 864 / scrollLeft 0、映るのは 13:30 まで）。
   *
   * すでに見えているときは動かさない。運んでいる最中に盤が勝手に滑ると、
   * 指と帯がずれる。**列の数と幅が変わったときも測り直す**ので、依存にその 2 つを置く。
   */
  useEffect(() => {
    const box = scrollerRef.current
    if (box === null) return
    const next = scrollLeftFor({
      scrollLeft: box.scrollLeft,
      clientWidth: box.clientWidth,
      scrollWidth: box.scrollWidth,
      columns,
      column: placed.column,
      span,
    })
    if (next !== null) box.scrollLeft = next
  }, [placed.column, span, columns])

  return (
    <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto bg-surface">
      <div className="relative h-full" style={{ minWidth: boardMinWidth(columns) }}>
        {/* 目盛りは格子の裏に 1 枚。セルに縦罫を引かないので、帯が乗っても途切れない。 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-8.5 right-0 bottom-0 grid"
          style={{
            left: `${LABEL_WIDTH_PX / REM_PX}rem`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}
        >
          {columnStarts.map((start, index) => (
            <div
              key={start}
              className={
                index % 2 === 0 ? 'border-l border-grid-hour-line' : 'border-l border-grid-line'
              }
            />
          ))}
        </div>

        {/* biome-ignore lint/a11y/useSemanticElements: <table> を display:grid にすると
            ブラウザが表のロールを落とすうえ、帯を列にまたがせながら目盛りを背景の 1 枚として
            通せない（P2 の Timetable と同じ理由）。 */}
        <div
          ref={boardRef}
          role="table"
          aria-label={BOARD_LABEL}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          /* 指でなぞっている間、背後の面を動かさない。 */
          className="relative grid h-full touch-none text-grid"
          style={{
            gridTemplateColumns: `${LABEL_WIDTH_PX / REM_PX}rem repeat(${columns}, minmax(0, 1fr))`,
            gridTemplateRows: `${HEAD_HEIGHT_PX / REM_PX}rem repeat(${lanes.length}, minmax(0, 1fr))`,
          }}
        >
          {/* biome-ignore lint/a11y/useSemanticElements: 上の table と同じ理由（行は display:contents） */}
          {/* biome-ignore lint/a11y/useFocusableInteractive: 行は箱を持たない（display:contents）ので焦点を受けない */}
          <div role="row" className="contents">
            <Head pinned>{axisLabel}</Head>
            {columnStarts.map((start) => (
              <Head key={start}>{jstClock(start)}</Head>
            ))}
          </div>

          {lanes.map((lane, rowIndex) => (
            <Row
              key={`${lane.kind}:${lane.id ?? lane.name}`}
              lane={lane}
              columns={columns}
              span={span}
              placedColumn={placed.row === rowIndex ? placed.column : null}
              dropColumn={drag?.target?.row === rowIndex ? (drag.target?.column ?? null) : null}
              placedLabel={placedLabel}
              purposeLabel={purposeLabel}
              durationMinutes={durationMinutes}
              hasClash={hasClash}
              drag={drag}
              onGrab={onGrab}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * 置いているご予約を窓に入れるための `scrollLeft`。動かす必要が無ければ null。
 *
 * 窓に入るのはモックの 8 列（10:00–14:00）だけで、残りは横に流れる。
 * 流れた先に置いてあると、この面の仕事（先約との重なりを解く）そのものが見えない。
 * すでに見えているときは動かさない —— 運んでいる最中に盤が滑ると指と帯がずれる。
 */
export function scrollLeftFor({
  scrollLeft,
  clientWidth,
  scrollWidth,
  columns,
  column,
  span,
}: {
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
  columns: number
  column: number
  span: number
}): number | null {
  if (columns <= 0 || clientWidth <= 0 || scrollWidth <= clientWidth) return null
  const columnWidth = (scrollWidth - LABEL_WIDTH_PX) / columns
  if (!Number.isFinite(columnWidth) || columnWidth <= 0) return null
  const left = LABEL_WIDTH_PX + column * columnWidth
  const right = left + Math.max(1, span) * columnWidth
  // 名前の列は貼り付いているので、その幅ぶんは「見えている」に数えない。
  if (left >= scrollLeft + LABEL_WIDTH_PX && right <= scrollLeft + clientWidth) return null
  const centered = (left + right) / 2 - clientWidth / 2
  const next = Math.max(0, Math.min(centered, scrollWidth - clientWidth))
  return next === scrollLeft ? null : next
}

function Head({ children, pinned = false }: { children: ReactNode; pinned?: boolean }) {
  return (
    /* biome-ignore lint/a11y/useSemanticElements: 上の table と同じ理由 */
    <div
      role="columnheader"
      tabIndex={-1}
      className={cn(
        'flex min-h-8.5 items-center border-r border-line border-b border-line-strong bg-surface-2 px-2 font-semibold text-ink-muted',
        // 名前の列は左に貼り付ける（下の rowheader と同じ理由）。
        pinned && 'sticky left-0 z-20',
      )}
    >
      {children}
    </div>
  )
}

function Row({
  lane,
  columns,
  span,
  placedColumn,
  dropColumn,
  placedLabel,
  purposeLabel,
  durationMinutes,
  hasClash,
  drag,
  onGrab,
}: {
  lane: AvailabilityLane
  columns: number
  span: number
  placedColumn: number | null
  dropColumn: number | null
  placedLabel: string
  purposeLabel: string
  durationMinutes: number
  hasClash: boolean
  drag: BoardDrag | null
  onGrab: (event: PointerEvent<HTMLElement>) => void
}) {
  const unskilled = lane.slots.length > 0 && lane.slots.every((slot) => slot.reason === 'no_skill')
  const dragging = drag !== null

  // 置いている場所と運んでいる先が重なるときは、運んでいる先だけを取り置く
  // （同じセルにもとの場所と行き先を両方描くと、どちらの時刻か読めなくなる）。
  const overlaps =
    placedColumn !== null &&
    dropColumn !== null &&
    placedColumn < dropColumn + span &&
    dropColumn < placedColumn + span
  const reserved: { column: number; span: number; role: SegmentRole }[] = []
  if (dropColumn !== null) reserved.push({ column: dropColumn, span, role: 'drop' })
  if (placedColumn !== null && !overlaps) {
    reserved.push({ column: placedColumn, span, role: 'placed' })
  }

  return (
    /* biome-ignore lint/a11y/useSemanticElements: 上の table と同じ理由 */
    /* biome-ignore lint/a11y/useFocusableInteractive: 行は箱を持たない（display:contents）ので焦点を受けない */
    <div role="row" className="contents">
      {/*
        名前の列は左に貼り付ける。盤は 1 日ぶんの列を持ち、横に流れて使う面なので、
        流したときに名前が一緒に消えると**誰の行なのか分からなくなる**（UX 監査 J-05）。
        地は不透明（`bg-surface-2`）でなければ、下を通る帯が透けて名前が読めない。
      */}
      {/* biome-ignore lint/a11y/useSemanticElements: 同上 */}
      <div
        role="rowheader"
        tabIndex={-1}
        className="sticky left-0 z-20 flex min-h-16 flex-col justify-center border-r border-line-strong border-b border-line bg-surface-2 px-2.5 py-1.5 font-semibold text-ink"
      >
        <span>{lane.name}</span>
        {lane.subtitle !== '' && (
          <span className="text-fine font-normal text-ink-muted">{lane.subtitle}</span>
        )}
      </div>

      {unskilled ? (
        <Cell span={columns} name={`${lane.name}　この用件は承れません`} hatched>
          <span className="grid h-full place-content-center text-ink-muted">
            この用件は承れません
          </span>
        </Cell>
      ) : (
        segmentsOf(lane.slots, reserved).map((segment) => (
          <Cell
            key={segment.column}
            span={segment.span}
            name={cellName(lane, segment, {
              dragging,
              hasClash,
              placedLabel,
              dropLabel: drag?.label ?? '',
            })}
            stacked={segment.role !== 'plain'}
          >
            {segment.kind !== 'open' && segment.kind !== 'no_skill' && (
              /*
                塞がりを 2 通りに描き分ける。**先約は塗り、お店の都合は斜線。**
                どちらも同じ灰色の箱だったころ、盤の午前は一面の灰色で、
                中の文字を読むまで「ほかのお客様が入っている」のか
                「休憩でそもそも受けない」のかが分からなかった（UX 監査 J-06）。
                店員にとってこの 2 つは別物で、休憩なら時間をずらす相談ができる。
                斜線は「この用件は承れません」と同じ `HATCH` を使う。
              */
              <span
                className={cn(
                  'flex h-full min-h-13.5 flex-col overflow-hidden rounded-ctl border-line-strong border-l-4 bg-busy-soft px-2 py-1.5 text-ink-muted',
                )}
                style={segment.kind === 'booked' ? undefined : { backgroundImage: HATCH }}
              >
                <b className="font-semibold">{bandTitle(segment.kind, lane)}</b>
                <span>{rangeLabel(lane.slots, segment)}</span>
              </span>
            )}

            {segment.role === 'placed' && !dragging && (
              <PlacedBand
                clash={hasClash}
                stacked={segment.kind !== 'open'}
                placedLabel={placedLabel}
                onGrab={onGrab}
              />
            )}

            {segment.role === 'placed' && dragging && (
              <span className="absolute inset-1 flex min-h-13.5 flex-col overflow-hidden rounded-ctl border-pine border-l-4 bg-pine-soft px-2 py-1.5 text-pine-deep opacity-35">
                <b className="font-semibold">もとの場所</b>
                <span>{placedLabel}</span>
              </span>
            )}

            {segment.role === 'drop' && drag !== null && (
              <>
                {drag.canDrop && (
                  <span className="absolute inset-1 flex items-end justify-center whitespace-nowrap rounded-ctl border-2 border-pine border-dashed bg-pine-soft pb-2.25 font-semibold text-pine-deep">
                    {drag.label}
                  </span>
                )}
                {/*
                  運んでいる帯はセルより広く取る。セルの幅に閉じ込めると
                  「いま置いているご／メガネを新しく作」で切れて、何を運んでいるかが読めなくなる
                  （承認済みモック BOOK-03c は帯の文字を最後まで描いている）。
                */}
                <span className="-right-6 -left-6 -top-1.5 absolute bottom-10 z-20 flex min-h-13.5 flex-col justify-center overflow-hidden whitespace-nowrap rounded-ctl border-3 border-pine bg-pine-soft px-2 py-1.5 text-ink shadow-lg">
                  <b className="font-semibold">いま置いているご予約</b>
                  <span>{`${purposeLabel}　${durationMinutes}分`}</span>
                </span>
              </>
            )}
          </Cell>
        ))
      )}
    </div>
  )
}

function PlacedBand({
  clash,
  stacked,
  placedLabel,
  onGrab,
}: {
  clash: boolean
  stacked: boolean
  placedLabel: string
  onGrab: (event: PointerEvent<HTMLElement>) => void
}) {
  return (
    <span
      className={cn(
        'flex min-h-13.5 flex-col overflow-hidden rounded-ctl border-3 px-2 py-1.5',
        clash ? 'border-danger bg-danger-soft text-danger' : 'border-pine bg-pine-soft text-ink',
        /* 先約の上に重ねるときだけ、下の帯が見えるようにずらす（モックの `.stack .over`）。 */
        stacked ? '-right-4 absolute top-5 bottom-2 left-5 z-10 shadow-lg' : 'h-full',
      )}
    >
      <span className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`ご予約をつかんで動かす　${placedLabel}`}
          onPointerDown={onGrab}
          className={cn(
            'flex min-h-11 min-w-11 items-center justify-center rounded-ctl text-ink-muted',
            focusRing,
          )}
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <b className="font-semibold">このご予約</b>
      </span>
      {clash && <span className="font-semibold">重なっています</span>}
    </span>
  )
}

function Cell({
  span,
  name,
  stacked = false,
  hatched = false,
  children,
}: {
  span: number
  name: string
  stacked?: boolean
  hatched?: boolean
  children?: ReactNode
}) {
  return (
    /* biome-ignore lint/a11y/useSemanticElements: 上の table と同じ理由 */
    <div
      role="cell"
      aria-label={name}
      className={cn(
        'relative min-h-16 border-b border-grid-line p-1',
        stacked && 'z-10 overflow-visible',
        hatched && 'bg-busy-soft',
      )}
      style={{
        gridColumn: `span ${span}`,
        ...(hatched ? { backgroundImage: HATCH } : {}),
      }}
    >
      {children}
    </div>
  )
}

/** 「10:00から11:00　佐藤 美咲　先約」。置いている帯と行き先はその役割を先に言う。 */
function cellName(
  lane: AvailabilityLane,
  segment: Segment,
  view: { dragging: boolean; hasClash: boolean; placedLabel: string; dropLabel: string },
): string {
  if (segment.role === 'drop') return `${view.dropLabel}　${lane.name}`
  if (segment.role === 'placed') {
    if (view.dragging) return `もとの場所　${view.placedLabel}　${lane.name}`
    const clash = view.hasClash ? '　重なっています' : ''
    return `いま置いているご予約　${view.placedLabel}　${lane.name}${clash}`
  }
  const range = rangeLabel(lane.slots, segment).replace('–', 'から')
  if (segment.kind === 'open') return `${range}　${lane.name}`
  const title = segment.kind === 'no_skill' ? 'この用件は承れません' : bandTitle(segment.kind, lane)
  return `${range}　${lane.name}　${title}`
}

/** 「13:00–14:00」。終わりは最後の枠の開始に刻み 1 つを足して数える。 */
function rangeLabel(slots: readonly AvailabilitySlot[], segment: Segment): string {
  const first = slots[segment.column]
  const last = slots[Math.min(segment.column + segment.span - 1, slots.length - 1)]
  if (first === undefined || last === undefined) return ''
  const step = Date.parse(slots[1]?.startsAt ?? '') - Date.parse(slots[0]?.startsAt ?? '')
  const endsAt = Number.isNaN(step)
    ? last.endsAt
    : new Date(Date.parse(last.startsAt) + step).toISOString()
  return `${jstClock(first.startsAt)}–${jstClock(endsAt)}`
}
