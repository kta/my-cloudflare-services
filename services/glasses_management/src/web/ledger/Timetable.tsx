import type { LedgerEntry, LedgerLane, LedgerView } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { visitLabel } from '../../worker/domain/customers'
import { bandSourceLabel, type LedgerBandTone } from '../../worker/domain/ledger'
import {
  bandName,
  bandToneOf,
  blockName,
  closedNotice,
  columnCount,
  columnLabels,
  emptyCellName,
  gridMinWidth,
  gridTemplateColumns,
  gridTemplateRows,
  LABEL_WIDTH_PX,
  type LaneSegment,
  laneSegments,
  nowLineLeft,
  slotLabel,
} from './metrics'

/*
 * 予約台帳のタイムテーブル（承認済みモック docs/frontend/mockups/eye/images/LEDGER-STAFF.png
 * と LEDGER-RESOURCE.png）。
 *
 * 題材: 受付スタッフが電話を取りながら「いまお店がどこまで埋まっているか」を一目で読む面。
 * シグネチャ: **帯が乗っても目盛りが途切れないこと**。30分ごとの薄い線と 1時間ごとの少し濃い線は
 * 格子の裏に 1 枚敷き、セルには縦罫を引かない。
 *
 * 色は `packages/ui/src/theme.css` のトークンだけを使う。帯は出どころ 3 系統
 * （緑＝お電話・店頭／青＝Web予約／茶＝ウォークイン）＋担当が未定の赤で、
 * **色だけに意味を持たせないので緑以外は必ず語を添える**（AC-LEDGER-05）。
 *
 * お名前と来店回数（`007-customer-records`。AC-CUST-24）: 60分以上（2 列）の帯は
 * お名前フルネーム＋来店回数の印を出し、30分（1 列）の帯は印を持たずお名前を
 * **姓だけ**に落とす（`docs/frontend/mockups/eye/images/LEDGER-STAFF.png` の
 * 「田中 花子 様／4回目」「松本 様」）。読み上げ名は省略しない（`metrics.ts` の `bandName`）。
 *
 * この面が描かないもの: お待ちのお客様の人数（`walk_ins` は 008。いまは 0名 の器）。
 */

/** 名前列の幅を rem で。任意値（`grid-cols-[170px_1fr]`）を書かないための値。 */
const LABEL_WIDTH_REM = `${LABEL_WIDTH_PX / 16}rem`

/*
 * 帯の地と左の 4px。`--color-*` のトークンだけを指す。
 *
 * `alert`（担当が未定）は **amber**。`theme.css:83` は `--color-danger` を
 * 「取消・警告・現在時刻の線・破壊的操作」と定めていて、担当未定は失敗ではなく
 * 「これから決めること」なので当てはまらない。赤い帯を見た店員は取り消された
 * ご予約と読む（UX 監査 UI-12 / J-03）。承認済みモック `LEDGER-STAFF.png` も
 * 同じ赤を使っているが、**モックのほうが定義に反している。**
 * 取り消しと「ご来店なし」は danger のまま。
 */
const BAND_TONE: Record<LedgerBandTone | 'alert', string> = {
  pine: 'bg-pine-soft border-pine',
  web: 'bg-web-soft border-web',
  walkin: 'bg-walkin-soft border-walkin',
  alert: 'bg-amber-soft border-amber',
}

const ARROWS = new Set(['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

export type TimetableProps = {
  view: LedgerView
  /** 開いているご予約。渡さなければ台帳が自分で覚える。 */
  selectedReservationId?: string | null
  /** 帯を押したとき。空いているところを押すと null が来る（詳細を閉じる合図）。 */
  onSelectEntry?: (entry: LedgerEntry | null) => void
  /**
   * 設備が 1 台も無い店舗の空の面から「設定を開く」で行く先（IDX-LEDGER-02 の E1）。
   * 渡さない器では行き先が無いので、押せて何も起きないボタンを置かない。
   */
  onOpenSettings?: () => void
}

export function Timetable({
  view,
  selectedReservationId,
  onSelectEntry,
  onOpenSettings,
}: TimetableProps) {
  const [held, setHeld] = useState<string | null>(null)
  const [active, setActive] = useState({ row: 0, column: 0 })
  const moving = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)

  const selected = selectedReservationId === undefined ? held : selectedReservationId

  // 矢印キーで枠を移ったときだけ焦点を動かす（roving tabindex）。
  useEffect(() => {
    if (!moving.current) return
    moving.current = false
    gridRef.current?.querySelector<HTMLElement>('[data-ledger-cell][tabindex="0"]')?.focus()
  }, [active])

  // 定休日・臨時休業は目盛りだけの空の格子を出さない（AC-LEDGER-22）。
  if (view.opensAt === null) {
    return (
      /* 格子がまるごと消える入れ替わりなので、事実を読み上げにも伝える
         （日付を動かした人は焦点を ‹ / › に置いたままで、中身の変化を見ていない）。 */
      <div role="status" className="grid flex-1 content-center justify-items-start gap-2 p-11">
        <p className="text-title font-bold text-ink">{closedNotice(view.date)}</p>
        <p className="text-body text-ink-muted">
          この日はお店を開けていないので、ご予約は 1 件もありません。
        </p>
      </div>
    )
  }

  // 設備・場所が 1 台も登録されていない店舗（IDX-LEDGER-02 の E1）。担当者別は
  // 「担当が未定」と「ご来店お待ち」を必ず持つので、行が 0 本になるのは設備別だけである。
  if (view.lanes.length === 0) {
    return (
      <div role="status" className="grid flex-1 content-center justify-items-start gap-2 p-11">
        <p className="text-title font-bold text-ink">設備・場所がまだありません</p>
        <p className="text-body text-ink-muted">
          設定の「設備と点検」で足すと、この盤面に行として並びます。
        </p>
        {onOpenSettings !== undefined && (
          <button
            type="button"
            onClick={onOpenSettings}
            className={cn(
              'mt-2 min-h-11.5 rounded-ctl border border-line-strong bg-surface px-4 text-body font-semibold text-ink',
              focusRing,
            )}
          >
            設定を開く
          </button>
        )}
      </div>
    )
  }

  const columns = columnCount(view.closesAt)
  const rows = view.lanes.map((lane) => laneSegments(lane, view.date, columns))
  // 行が減ったときに焦点の行番号を丸める。並べ方を戻した直後に `active.row` が
  // 行数を越えたままだと、どの枠にも `tabIndex=0` が当たらず台帳へ Tab で入れなくなる。
  const activeRow = Math.min(active.row, rows.length - 1)
  const nowLeft = nowLineLeft(view.date, view.serverNow, columns)

  function segmentIndexAt(segments: LaneSegment[], column: number): number {
    const found = segments.findIndex(
      (segment) =>
        column >= segment.columnIndex && column < segment.columnIndex + segment.columnSpan,
    )
    return found === -1 ? 0 : found
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!ARROWS.has(event.key)) return
    event.preventDefault()
    let row = activeRow
    let column = active.column
    const segments = rows[row] ?? []
    const current = segments[segmentIndexAt(segments, column)]
    if (event.key === 'ArrowRight' && current) {
      column = Math.min(columns - 1, current.columnIndex + current.columnSpan)
    }
    if (event.key === 'ArrowLeft' && current) column = Math.max(0, current.columnIndex - 1)
    if (event.key === 'ArrowDown') row = Math.min(rows.length - 1, row + 1)
    if (event.key === 'ArrowUp') row = Math.max(0, row - 1)
    if (event.key === 'Home') column = 0
    if (event.key === 'End') column = columns - 1
    moving.current = true
    setActive({ row, column })
  }

  function press(segment: LaneSegment, rowIndex: number) {
    setActive({ row: rowIndex, column: segment.columnIndex })
    if (segment.kind !== 'entry') {
      setHeld(null)
      onSelectEntry?.(null)
      return
    }
    const [entry] = segment.entries
    if (entry === undefined) return
    // 開いた帯をもう一度押すと閉じる（AC-LEDGER-19）。
    const next = selected === entry.reservationId ? null : entry.reservationId
    setHeld(next)
    onSelectEntry?.(next === null ? null : entry)
  }

  return (
    <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto bg-surface">
      <div className="relative h-full" style={{ minWidth: gridMinWidth(columns) }}>
        {/* 目盛りは格子の裏に 1 枚。セルに縦罫を引かないので、帯が乗っても途切れない。 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-8.5 right-0 bottom-0 grid"
          style={{ left: LABEL_WIDTH_REM, gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        >
          {Array.from({ length: columns }, (_, index) => (
            <div
              key={slotLabel(index)}
              className={
                index % 2 === 0 ? 'border-l border-grid-hour-line' : 'border-l border-grid-line'
              }
            />
          ))}
        </div>

        {/* biome-ignore lint/a11y/useSemanticElements: <table> は display:grid にすると
            ブラウザが表のロールを落とすうえ、帯を列にまたがせながら目盛りを背景の 1 枚として
            通せない。WAI-ARIA APG の grid パターンをそのまま書く。 */}
        <div
          ref={gridRef}
          role="grid"
          aria-label="予約台帳"
          aria-colcount={columns + 1}
          aria-rowcount={view.lanes.length + 1}
          onKeyDown={onKeyDown}
          /* 目盛りは 1 枚うしろ。位置指定した要素は静的な要素より**あとに**描かれるので、
             格子の側も位置指定にしないと、線が帯の文字と焦点の輪を横切ってしまう
             （モックの `.tt-bg { z-index: 0 }` / `.tt-cell { z-index: 1 }` と同じ順番）。 */
          className="relative grid h-full text-grid"
          style={{
            gridTemplateColumns: gridTemplateColumns(columns),
            gridTemplateRows: gridTemplateRows(view.lanes),
          }}
        >
          {/* biome-ignore lint/a11y/useSemanticElements: 上の grid と同じ理由（行は display:contents） */}
          {/* biome-ignore lint/a11y/useFocusableInteractive: 行は箱を持たない（display:contents）ので焦点を受けない */}
          <div role="row" aria-rowindex={1} className="contents">
            {/* biome-ignore lint/a11y/useSemanticElements: 同上 */}
            <div
              role="columnheader"
              aria-colindex={1}
              tabIndex={-1}
              className="flex min-h-8.5 items-center border-r border-line border-b border-line-strong bg-surface-2 px-2 font-semibold text-ink-muted"
            >
              {view.axis === 'resource' ? '設備・場所' : '担当者'}
            </div>
            {columnLabels(columns).map((label, index) => (
              /* biome-ignore lint/a11y/useSemanticElements: 同上 */
              <div
                key={label}
                role="columnheader"
                aria-colindex={index + 2}
                tabIndex={-1}
                className="flex min-h-8.5 items-center border-r border-line border-b border-line-strong bg-surface-2 px-2 font-semibold text-ink-muted"
              >
                {label}
              </div>
            ))}
          </div>

          {view.lanes.map((lane, rowIndex) => (
            <Lane
              key={`${lane.kind}:${lane.id ?? lane.name}`}
              lane={lane}
              segments={rows[rowIndex] ?? []}
              columns={columns}
              rowIndex={rowIndex}
              activeIndex={
                activeRow === rowIndex ? segmentIndexAt(rows[rowIndex] ?? [], active.column) : -1
              }
              selected={selected}
              onPress={press}
            />
          ))}
        </div>

        {/* 現在時刻は台帳の中では線だけ。文字はツールバーの札（LedgerScreen）が持つ。 */}
        {nowLeft !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-8.5 right-0 bottom-0"
            style={{ left: LABEL_WIDTH_REM }}
          >
            <div
              data-ledger-nowline
              aria-hidden="true"
              className="absolute top-0 bottom-0 w-0.5 bg-danger"
              style={{ left: nowLeft }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function Lane({
  lane,
  segments,
  columns,
  rowIndex,
  activeIndex,
  selected,
  onPress,
}: {
  lane: LedgerLane
  segments: LaneSegment[]
  columns: number
  rowIndex: number
  activeIndex: number
  selected: string | null
  onPress: (segment: LaneSegment, rowIndex: number) => void
}) {
  const subtitle =
    lane.subtitle !== '' ? lane.subtitle : lane.kind === 'unassigned' ? 'あとで決める' : ''
  // 予約も点検も無い設備の行は、空いていることを 1 つだけ言う（AC-LEDGER-11）。
  const isFree = lane.kind === 'equipment' && lane.entries.length + lane.blocks.length === 0

  return (
    /* biome-ignore lint/a11y/useSemanticElements: 上の grid と同じ理由 */
    /* biome-ignore lint/a11y/useFocusableInteractive: 行は箱を持たない（display:contents）ので焦点を受けない */
    <div role="row" aria-rowindex={rowIndex + 2} className="contents">
      {/* biome-ignore lint/a11y/useSemanticElements: 同上 */}
      <div
        role="rowheader"
        aria-colindex={1}
        tabIndex={-1}
        className={cn(
          'flex min-h-16 flex-col justify-center border-r border-line-strong border-b border-line px-2.5 py-1.5 font-semibold text-ink',
          lane.kind === 'walkin' ? 'bg-walkin-soft' : 'bg-surface-2',
        )}
      >
        <span>{lane.name}</span>
        {subtitle !== '' && (
          <span className="text-fine font-normal text-ink-muted">{subtitle}</span>
        )}
      </div>

      {isFree ? (
        <Cell
          columnIndex={0}
          columnSpan={columns}
          name={`${lane.name}　いま空いています`}
          tabbable={activeIndex === 0}
          onPress={() => onPress(segments[0] as LaneSegment, rowIndex)}
        >
          <span className="flex h-full overflow-hidden min-h-13.5 items-start rounded-ctl border border-pine-line border-l-4 border-dashed bg-free px-2 py-1.5 font-semibold text-pine-deep">
            いま空いています
          </span>
        </Cell>
      ) : (
        segments.map((segment, index) => (
          <Segment
            key={segment.key}
            segment={segment}
            lane={lane}
            selected={selected}
            tabbable={activeIndex === index}
            onPress={(pressed) => onPress(pressed, rowIndex)}
          />
        ))
      )}
    </div>
  )
}

function Segment({
  segment,
  lane,
  selected,
  tabbable,
  onPress,
}: {
  segment: LaneSegment
  lane: LedgerLane
  selected: string | null
  tabbable: boolean
  onPress: (segment: LaneSegment) => void
}) {
  if (segment.kind === 'block') {
    return (
      <Cell
        columnIndex={segment.columnIndex}
        columnSpan={segment.columnSpan}
        name={blockName(segment.block, lane.name)}
        tabbable={tabbable}
        onPress={() => onPress(segment)}
      >
        {/* 埋まった枠は地を明るくして文字を `--color-ink-muted` に保つ（4.87:1）。
            `--color-busy` の上では 4.00:1 で AA に届かず、文字を濃くすると
            埋まった枠が空き枠より目立ってしまう。AC-LEDGER-11 が名指ししている
            `--color-busy-soft` がその地で、見出し行の `--color-surface-2` とも別の値である。 */}
        <span className="flex h-full overflow-hidden min-h-13.5 items-start rounded-ctl border-l-4 border-line-strong bg-busy-soft px-2 py-1.5 font-semibold text-ink-muted">
          {segment.block.label}
        </span>
      </Cell>
    )
  }

  if (segment.kind === 'empty') {
    // 「ご来店お待ち」の行は時間軸に載せない全幅の 1 枠（AC-LEDGER-08）。
    if (lane.kind === 'walkin') {
      const waiting = Number.parseInt(lane.subtitle, 10)
      const text =
        Number.isNaN(waiting) || waiting === 0
          ? 'いまお待ちのお客様はいません。'
          : `お待ちのお客様　${lane.subtitle}`
      return (
        <Cell
          columnIndex={segment.columnIndex}
          columnSpan={segment.columnSpan}
          name={text}
          tabbable={tabbable}
          onPress={() => onPress(segment)}
        >
          <span className="flex h-full overflow-hidden min-h-13.5 items-center rounded-ctl border-l-4 border-walkin bg-walkin-soft px-2 font-semibold text-ink">
            {text}
          </span>
        </Cell>
      )
    }
    return (
      <Cell
        columnIndex={segment.columnIndex}
        columnSpan={segment.columnSpan}
        name={emptyCellName(slotLabel(segment.columnIndex), lane.name)}
        tabbable={tabbable}
        onPress={() => onPress(segment)}
      />
    )
  }

  const [entry] = segment.entries
  if (entry === undefined) return null
  return (
    <Cell
      columnIndex={segment.columnIndex}
      columnSpan={segment.columnSpan}
      name={bandName(entry, lane.name, lane.kind)}
      tabbable={tabbable}
      selected={selected === entry.reservationId}
      onPress={() => onPress(segment)}
    >
      <Band entry={entry} wide={segment.columnSpan >= 2} />
    </Cell>
  )
}

/**
 * 帯 1 本。お客様のお名前は `007-customer-records` が足すので、いまは時刻を頭に置く。
 *
 * **語を切らない。** 30分 1 列の帯の中身はおよそ 48px しか無く、「ウォークイン」「担当が未定」は
 * 1 行に入らない。`word-break: keep-all`（Tailwind の `break-keep`）を掛けると和文が
 * どこでも折れなくなり、`overflow-hidden` で「ウォークイ」「担当が未」と切れて出る。
 * 色だけに意味を持たせない語（AC-LEDGER-05 / 07）が、いちばん色に頼りたい狭い帯で
 * 読めなくなるので**掛けない**。縦は行が伸びるので 2 行になっても収まる。
 * モックの `.appt.narrow { word-break: keep-all }` は中身がお名前 1 行だけの帯の決めで、
 * 語を 2〜3 行積むこの実装には当てはまらない（60分の帯でも「・」の無いご用件が切れる）。
 */
/** 姓だけに落とす（AC-CUST-24）。区切りは半角・全角の空白のどちらでも切れる。 */
function surnameOf(name: string): string {
  return (name.split(/[\s　]+/)[0] ?? name).trim()
}

/**
 * 来店回数の印。**数字の文字を必ず出す**（色だけで区別しない）。
 * はじめての方は薄い橙、3 回目以上は薄い緑、1〜2 回目は罫だけ。
 * **この印はお名前の右に添えるものだけ**にしてある —— 回数の列をすでに持つ面
 * （顧客台帳の一覧）には入れない（`docs/frontend/mockups/eye/README.md` の決め）ので、
 * 印の綴りはこの 1 か所しか無い（来店受付ボード・受け付ける面・受付履歴もこれを呼ぶ）。
 */
export function VisitBadge({ count }: { count: number }) {
  return (
    <span
      className={cn(
        'inline-flex min-h-4.5 w-fit items-center rounded-ctl border px-1.5 font-mono text-fine font-semibold',
        count === 0 && 'border-walkin bg-walkin-soft text-walkin',
        count >= 3 && 'border-pine-line bg-pine-soft text-pine-deep',
        count >= 1 && count <= 2 && 'border-line-strong bg-surface text-ink',
      )}
    >
      {visitLabel(count, 'badge')}
    </span>
  )
}

function Band({ entry, wide }: { entry: LedgerEntry; wide: boolean }) {
  const source = bandSourceLabel(entry.source)
  return (
    <span
      className={cn(
        'flex h-full min-h-13.5 flex-col gap-0.5 overflow-hidden rounded-ctl border-l-4 px-2 py-1.5 leading-snug text-ink',
        BAND_TONE[bandToneOf(entry)],
      )}
    >
      {/*
        帯の中はお名前がいちばん強い。**時刻は書かない** —— 帯の x の位置が既に時刻を
        表しているので、書けば同じ情報を 2 度描くことになり、しかも以前は等幅太字の
        時刻がお名前より強く刷られていた（UX 監査 UI-01）。承認済みモック
        LEDGER-STAFF.png も帯に時刻を持たない。耳で聞く人のために、時刻は
        セルの `aria-label` のほうに残してある。

        60分以上（2 列）はフルネーム＋来店回数の印、30分（1 列）は姓だけに落とす
        （文字予算がおよそ 6 字しかない。AC-CUST-24 / AC-LEDGER-06）。
      */}
      {entry.customerName !== null &&
        (wide ? (
          <>
            <span className="truncate text-lead font-semibold">{`${entry.customerName} 様`}</span>
            {entry.visitCount !== null && <VisitBadge count={entry.visitCount} />}
          </>
        ) : (
          /* 30分（1 列 68px）は 17px の姓が 1 行に入らない。切り落とすと「松…」に
             なって誰か分からなくなるので、2 行へ折り返す（モックも同じ）。 */
          <span className="text-lead font-semibold leading-tight">{`${surnameOf(entry.customerName)} 様`}</span>
        ))}
      {/* 30分 1 列の文字予算はおよそ 6 字しかない。狭い帯にはご用件を入れない（AC-LEDGER-06）。 */}
      {wide && <span>{entry.purposeLabel}</span>}
      {source !== null && <span className="text-fine text-ink-muted">{source}</span>}
      {entry.isUnassigned && <span className="text-fine font-semibold text-amber">担当が未定</span>}
      {entry.status === 'no_show' && (
        <span className="text-fine font-semibold text-danger">ご来店なし</span>
      )}
    </span>
  )
}

function Cell({
  columnIndex,
  columnSpan,
  name,
  tabbable,
  selected,
  onPress,
  children,
}: {
  columnIndex: number
  columnSpan: number
  name: string
  tabbable: boolean
  selected?: boolean
  onPress: () => void
  children?: React.ReactNode
}) {
  return (
    /* biome-ignore lint/a11y/useSemanticElements: 上の grid と同じ理由 */
    <div
      data-ledger-cell
      role="gridcell"
      aria-colindex={columnIndex + 2}
      aria-colspan={columnSpan}
      aria-label={name}
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      onClick={onPress}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onPress()
      }}
      className={cn(
        'min-h-16 border-b border-grid-line p-1',
        selected === true && 'ring-2 ring-pine',
        focusRing,
      )}
      style={{ gridColumn: `span ${columnSpan}` }}
    >
      {children}
    </div>
  )
}
