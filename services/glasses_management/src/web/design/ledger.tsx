// biome-ignore-all lint/a11y/useSemanticElements: 台帳と工程盤は `display:grid` の
// 帯組みそのものが承認済みモックの見た目である。`<table>` に替えるとレイアウトが
// 崩れて画素が合わなくなるので、要素は div のまま role で表の意味だけを足す。
import { cn } from '@app/ui'
import type { ReactNode } from 'react'

/*
 * 予約台帳と来店受付の格子。承認済みモック `staff-approved.html` の実測。
 *
 *   .ledger{padding:16px;grid-template-columns:180px repeat(7,1fr);font-size:14px}
 *   .cell{min-height:72px;border-right:1px solid var(--l);
 *         border-bottom:1px solid var(--l);padding:8px;background:#fff}
 *   .head{min-height:40px;background:#dce5e0;font-weight:700}
 *   .appt{background:var(--gs);font-weight:700}
 *   .walk{background:#fff0e8}
 *   .now{left:calc(180px + (100% - 180px) * .324);top:40px;bottom:0;
 *        border-left:3px solid var(--warn);z-index:4}
 *   .now b{position:absolute;top:8px;left:0;background:var(--warn);color:#fff;
 *          padding:4px 7px}
 *
 * 列は 7 本（10:00〜13:00 の 30 分刻み）。ここを増やすと横スクロールになり、
 * 「1 日が 1 画面に収まる」という台帳の主題が崩れる。
 */

type LedgerCell = {
  /** 何列ぶんを占めるか。予約の長さがそのまま幅になる。 */
  span?: number
  tone?: 'plain' | 'appointment' | 'walkin'
  children?: ReactNode
}

export type LedgerLane = { name: string; cells: LedgerCell[] }

export function LedgerGrid({
  columns,
  lanes,
  now,
}: {
  /** 見出し行の時刻。`担当者` の列はこの左に自動で付く。 */
  columns: string[]
  lanes: LedgerLane[]
  /** 現在時刻の線。`ratio` は時間軸の左端からの割合。 */
  now?: { label: string; ratio: number }
}) {
  return (
    /*
     * 素の `div` の格子だと、読み上げでどのセルが「何時の誰」なのか復元でき
     * ない。`<table>` に替えると `display:grid` の帯が崩れるので、レイアウトは
     * そのままに `role` と行列番号だけを足して表の意味を持たせる。
     */
    <div
      role="grid"
      aria-label="予約台帳"
      aria-colcount={columns.length + 1}
      aria-rowcount={lanes.length + 1}
      className="relative grid p-4 font-sans text-grid"
      style={{ gridTemplateColumns: `180px repeat(${columns.length}, 1fr)` }}
    >
      {now && (
        <div
          aria-hidden="true"
          className="absolute z-4 border-danger border-l-3"
          style={{
            left: `calc(180px + (100% - 180px) * ${now.ratio})`,
            top: '40px',
            bottom: 0,
          }}
        >
          <b className="absolute top-2 left-0 whitespace-nowrap bg-danger px-1.75 py-1 text-on-danger">
            {now.label}
          </b>
        </div>
      )}
      <div
        role="columnheader"
        tabIndex={-1}
        aria-rowindex={1}
        aria-colindex={1}
        className="min-h-10 border-line border-r border-b bg-grid-head p-2 font-bold"
      >
        担当者
      </div>
      {columns.map((column, index) => (
        <div
          key={column}
          role="columnheader"
          tabIndex={-1}
          aria-rowindex={1}
          aria-colindex={index + 2}
          // モックの `.head` は書体を変えない。時刻も本文と同じ Plex Sans JP で描く。
          className="min-h-10 border-line border-r border-b bg-grid-head p-2 font-bold"
        >
          {column}
        </div>
      ))}
      {lanes.map((lane, index) => (
        <LaneRow key={lane.name} lane={lane} rowIndex={index + 2} />
      ))}
    </div>
  )
}

function LaneRow({ lane, rowIndex }: { lane: LedgerLane; rowIndex: number }) {
  // 予約は複数コマにまたがるので、列番号は 1 ずつではなく span を足して進める。
  let column = 1
  return (
    <>
      <div
        role="rowheader"
        tabIndex={-1}
        aria-rowindex={rowIndex}
        aria-colindex={1}
        className="min-h-18 border-line border-r border-b bg-surface p-2"
      >
        {lane.name}
      </div>
      {lane.cells.map((cell, index) => {
        const span = cell.span && cell.span > 1 ? cell.span : 1
        column += span
        return (
          <div
            // 同じレーンの中では位置が同一性なので、内容ではなく列番号で並べる。
            key={`${lane.name}-${index}`}
            role="gridcell"
            tabIndex={-1}
            aria-rowindex={rowIndex}
            aria-colindex={column - span + 1}
            aria-colspan={span > 1 ? span : undefined}
            className={cn(
              'min-h-18 border-line border-r border-b p-2',
              cell.tone === 'appointment' && 'bg-pine-soft font-bold',
              cell.tone === 'walkin' && 'bg-walkin-soft',
              (cell.tone === undefined || cell.tone === 'plain') && 'bg-surface',
            )}
            style={cell.span && cell.span > 1 ? { gridColumn: `span ${cell.span}` } : undefined}
          >
            {/* 空きコマは読み上げでは無音になる。画素を変えない sr-only で埋める。 */}
            {cell.children ?? <span className="sr-only">予約なし</span>}
          </div>
        )
      })}
    </>
  )
}

/*
 * 来店受付の工程盤。
 *   .journey{grid-template-columns:190px repeat(4,1fr);gap:8px}
 *   .stage{min-height:80px;background:#fff;border:1px solid var(--l);
 *          border-radius:8px;padding:10px}
 *   .next{background:var(--gs);border:2px solid var(--g)}
 */

export type JourneyCell = { children?: ReactNode; next?: boolean }

export function JourneyBoard({
  stages,
  rows,
}: {
  /** 見出しの工程名（`お客様` を含む 5 つ）。 */
  stages: string[]
  rows: JourneyCell[][]
}) {
  return (
    /* 台帳と同じ理由で、`display:grid` を保ったまま role で表の意味を足す。 */
    <div
      role="grid"
      aria-label="接客の進み具合"
      aria-colcount={stages.length}
      aria-rowcount={rows.length + 1}
      className="grid gap-2 font-sans"
      style={{ gridTemplateColumns: `190px repeat(${stages.length - 1}, 1fr)` }}
    >
      {stages.map((stage, index) => (
        <div
          key={stage}
          role="columnheader"
          tabIndex={-1}
          aria-rowindex={1}
          aria-colindex={index + 1}
          className="min-h-20 rounded-ctl border border-line bg-surface p-2.5"
        >
          <b>{stage}</b>
        </div>
      ))}
      {rows.map((row, rowIndex) =>
        row.map((cell, index) => (
          <JourneyCellView
            // 盤の中では位置が同一性なので、行と列で並べる。
            key={`${rowIndex}-${index}`}
            cell={cell}
            // 1 列目はお客様なので、その行の見出しとして読ませる。
            header={index === 0}
            rowIndex={rowIndex + 2}
            colIndex={index + 1}
          />
        )),
      )}
    </div>
  )
}

function JourneyCellView({
  cell,
  header,
  rowIndex,
  colIndex,
}: {
  cell: JourneyCell
  header: boolean
  rowIndex: number
  colIndex: number
}) {
  const frame = cn(
    'min-h-20 rounded-ctl p-2.5',
    cell.next ? 'border-2 border-pine bg-pine-soft' : 'border border-line bg-surface',
  )
  // 未着手の工程も読み上げに乗せる。sr-only なので画素は変わらない。
  const body = cell.children ?? <span className="sr-only">未着手</span>
  // role を三項で出し入れせず、見出しのセルと中身のセルで枝を分ける。
  if (header)
    return (
      <div
        role="rowheader"
        tabIndex={-1}
        aria-rowindex={rowIndex}
        aria-colindex={colIndex}
        className={frame}
      >
        {body}
      </div>
    )
  return (
    <div
      role="gridcell"
      tabIndex={-1}
      aria-rowindex={rowIndex}
      aria-colindex={colIndex}
      className={frame}
    >
      {body}
    </div>
  )
}
