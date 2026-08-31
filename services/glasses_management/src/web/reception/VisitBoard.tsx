import type { VisitBoardCell, VisitBoardRow, VisitBoard as VisitBoardShape } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { visitLabel } from '../../worker/domain/customers'
import { BOARD_STAGES } from '../../worker/domain/visit-board'
import { dateLabel, jstClock } from '../ledger/metrics'
import { VisitBadge } from '../ledger/Timetable'

/*
 * 来店受付ボード（承認済みモック docs/frontend/mockups/eyex/images/RECEPTION-JOURNEY.png）。
 *
 * 題材: フロアのスタッフが顔を上げて 3 秒で「誰をお待たせしているか」を掴む面。主役は盤面 1 枚。
 * シグネチャ: **待たせている行が赤地と文字の両方で真っ先に目に入り、空の欄は空のまま置くこと。**
 *
 * 実測（screens/RECEPTION-JOURNEY.html の <style> と assets/eyex.css）:
 *   .board  = padding 28px 36px
 *   .jgrid  = 220px + 6 列 1fr / 行 40px + 4 × 1fr / 枠 1px --line / 角 16px / overflow hidden
 *   .jhead  = padding 0 14px・13px/600・--ink-2・下罫 1px --line-strong
 *   .jname  = padding 0 16px・名前 16px・ご用件 13px --ink-2・右罫 1px --line-strong
 *   .jc     = padding 0 14px・状態 13px・値 15px/600・下罫 1px --line（最終行は下罫なし）
 *
 * 色は `packages/ui/src/theme.css` のトークンだけを使う。**緑は「対応中」の縦線と
 * 「次にやること」の地だけ、赤は「お待たせ中」だけ**に取ってあるので、担当不在・設備停止の
 * 注意は琥珀（`--color-amber`＝失敗ではない注意）で出し、必ず文を添える（AC-RECEP-14 / 15）。
 *
 * 台帳（`ledger/Timetable.tsx`）と同じ `role="grid"` ＋ roving tabindex に揃える。
 * 別の型にすると覚え直しになるので、工程を進める操作も台帳の帯と同じく**欄そのもの**を
 * Enter / Space / クリックで発火させる（欄の中に `<button>` を入れ子にしない）。
 */

/** 盤面の 6 列の日本語名。並びは `worker/domain/visit-board.ts` の `BOARD_STAGES` が持つ。 */
const STAGE_LABELS: Record<(typeof BOARD_STAGES)[number], string> = {
  received: '受付',
  consulting: 'ご相談',
  fitting: 'フレーム選び',
  measuring: '視力測定',
  checkout: 'レンズ・お会計',
  handover: 'お渡し',
}

/** モックの `grid-template-columns: 220px repeat(6, 1fr)`。任意値を書かないための rem。 */
const GRID_COLUMNS = '13.75rem repeat(6, minmax(0, 1fr))'
/** 列見出しは 40px。行はモックと同じく残りを等分する。 */
const HEAD_ROW = '2.5rem'

const ARROWS = new Set(['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

export type VisitBoardProps = {
  board: VisitBoardShape
  scope: 'active' | 'all'
  onScopeChange: (scope: 'active' | 'all') => void
  /** 「次にやること」の欄を押したとき。工程を 1 つ進める。 */
  onAdvance: (row: VisitBoardRow, cell: VisitBoardCell) => void
  /** まだ受け付けていないご予約の行から、来店受付の画面を開く。 */
  onOpenCheckin?: (row: VisitBoardRow) => void
  /** 退店を記録する。 */
  onLeave?: (row: VisitBoardRow) => void
  /**
   * お客様を特定しないまま受け付けた行を、あとからお客様へ結びつける
   * （AC-RECEP-08 / AC-RECEP-09）。**受付を止めないため入口は受付パネルに置かず、
   * 受け付けたあとのこの行に置く。**
   */
  onLinkCustomer?: (row: VisitBoardRow) => void
  /**
   * ご来店がなかったものとして残す。予約の取消のルートは `009-change-and-cancel` が付けるので、
   * 行き先を持たない器は渡さない（押して何も起きない操作を置かない）。
   */
  onMarkNoShow?: (row: VisitBoardRow) => void
  /** 「＋ ご来店を受け付ける」。店頭の受付パネルは台帳の側にある。 */
  onReceiveVisit?: () => void
  /** 記録が届かなかったときの 1 文。届いた操作の結果は盤面そのものが語るので、失敗だけを言う。 */
  notice?: string | null
  /**
   * 受け付ける面から戻ってきた行。**開いた要素へフォーカスを返す**ための値で、
   * その行のお客様欄へ焦点を戻す（戻ったあと Tab を最初から押し直さずに済む）。
   */
  focusSubjectId?: string | null
}

export function VisitBoard({
  board,
  scope,
  onScopeChange,
  onAdvance,
  onOpenCheckin,
  onLeave,
  onLinkCustomer,
  onMarkNoShow,
  onReceiveVisit,
  notice = null,
  focusSubjectId = null,
}: VisitBoardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [active, setActive] = useState({ row: 0, column: 0 })
  const moving = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)
  // 焦点を返したのがどの行かを控える（60 秒ごとの取り直しで焦点を奪い返さない）。
  const returned = useRef<string | null>(null)

  // 矢印キーで枠を移ったときだけ焦点を動かす（roving tabindex）。
  useEffect(() => {
    if (!moving.current) return
    moving.current = false
    gridRef.current?.querySelector<HTMLElement>('[data-board-cell][tabindex="0"]')?.focus()
  }, [active])

  const rows = board.rows
  const selected = rows.find((row) => row.subjectId === selectedId) ?? null

  // 受け付ける面から戻ってきたら、その行のお客様欄へ焦点を返す（1 度だけ）。
  useEffect(() => {
    if (focusSubjectId === null) {
      returned.current = null
      return
    }
    if (returned.current === focusSubjectId) return
    const index = rows.findIndex((row) => row.subjectId === focusSubjectId)
    if (index < 0) return
    returned.current = focusSubjectId
    moving.current = true
    setActive({ row: index, column: 0 })
  }, [focusSubjectId, rows])
  // 行が減ったときに焦点の行番号を丸める（どの欄にも tabIndex=0 が当たらないと Tab で入れない）。
  const activeRow = Math.min(active.row, Math.max(rows.length - 1, 0))

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!ARROWS.has(event.key)) return
    event.preventDefault()
    let row = activeRow
    let column = active.column
    if (event.key === 'ArrowRight') column = Math.min(BOARD_STAGES.length, column + 1)
    if (event.key === 'ArrowLeft') column = Math.max(0, column - 1)
    if (event.key === 'ArrowDown') row = Math.min(rows.length - 1, row + 1)
    if (event.key === 'ArrowUp') row = Math.max(0, row - 1)
    if (event.key === 'Home') column = 0
    if (event.key === 'End') column = BOARD_STAGES.length
    moving.current = true
    setActive({ row, column })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4">
        <fieldset
          aria-label="表示するお客様"
          className="flex gap-0.5 rounded-ctl bg-surface-2 p-0.5"
        >
          {(
            [
              { key: 'active', label: 'ご来店中' },
              { key: 'all', label: '本日すべて' },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={scope === option.key}
              onClick={() => onScopeChange(option.key)}
              className={cn(
                'min-h-11 rounded-ctl px-4 text-grid font-semibold',
                scope === option.key
                  ? 'bg-surface text-pine ring-1 ring-line'
                  : 'bg-transparent text-ink-muted',
                focusRing,
              )}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
        {/* 0 名のときは面の真ん中に置くので、ここには出さない（同じ名前を 2 つ作らない）。 */}
        {rows.length > 0 && onReceiveVisit !== undefined && (
          <button
            type="button"
            onClick={onReceiveVisit}
            className={cn(
              'min-h-11 rounded-ctl bg-pine px-4.5 text-body font-semibold text-on-pine',
              focusRing,
            )}
          >
            ＋ ご来店を受け付ける
          </button>
        )}
        {notice !== null && (
          <p role="alert" className="ml-auto text-grid font-semibold text-danger">
            {notice}
          </p>
        )}
        <p className={cn('text-grid text-ink-muted', notice === null && 'ml-auto')}>
          {`${dateLabel(board.date)}　ご来店中 ${board.activeCount}名`}
        </p>
      </div>

      {selected !== null && (
        <RowActions
          row={selected}
          onOpenCheckin={onOpenCheckin}
          onLeave={onLeave}
          onLinkCustomer={onLinkCustomer}
          onMarkNoShow={onMarkNoShow}
        />
      )}

      {rows.length === 0 ? (
        /* 0 名は行き止まりにしない（AC-RECEP-27）。見出し 1 行・理由 1 行・次の一手 1 つ。 */
        <div role="status" className="grid flex-1 content-center justify-items-start gap-2 p-11">
          <h2 className="text-title font-bold text-ink">ご来店中のお客様はいません</h2>
          <p className="text-body text-ink-muted">まだどなたもお着きになっていません。</p>
          {onReceiveVisit !== undefined && (
            <button
              type="button"
              onClick={onReceiveVisit}
              className={cn(
                'mt-2 min-h-13 rounded-ctl bg-pine px-6 text-lead font-bold text-on-pine',
                focusRing,
              )}
            >
              ＋ ご来店を受け付ける
            </button>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-9 py-7">
          {/* biome-ignore lint/a11y/useSemanticElements: <table> を display:grid にすると
              ブラウザが表のロールを落とす。台帳（Timetable）と同じく WAI-ARIA APG の
              grid パターンをそのまま書く。 */}
          <div
            ref={gridRef}
            role="grid"
            aria-label="来店受付ボード　お客様ごとの工程"
            aria-colcount={BOARD_STAGES.length + 1}
            aria-rowcount={rows.length + 1}
            onKeyDown={onKeyDown}
            className="grid h-full overflow-hidden rounded-panel border border-line bg-surface"
            style={{
              gridTemplateColumns: GRID_COLUMNS,
              gridTemplateRows: `${HEAD_ROW} repeat(${rows.length}, minmax(4.5rem, 1fr))`,
            }}
          >
            {/* biome-ignore lint/a11y/useSemanticElements: 上の grid と同じ理由 */}
            {/* biome-ignore lint/a11y/useFocusableInteractive: 行は箱を持たない（display:contents） */}
            <div role="row" aria-rowindex={1} className="contents">
              {['お客様', ...BOARD_STAGES.map((stage) => STAGE_LABELS[stage])].map(
                (label, index) => (
                  /* biome-ignore lint/a11y/useSemanticElements: 同上 */
                  <div
                    key={label}
                    role="columnheader"
                    aria-colindex={index + 1}
                    tabIndex={-1}
                    className="flex min-h-10 items-center border-b border-line-strong px-3.5 text-grid font-semibold text-ink-muted"
                  >
                    {label}
                  </div>
                ),
              )}
            </div>

            {rows.map((row, rowIndex) => (
              <Row
                key={`${row.subjectType}:${row.subjectId}`}
                row={row}
                rowIndex={rowIndex}
                isLast={rowIndex === rows.length - 1}
                isSelected={row.subjectId === selectedId}
                activeColumn={activeRow === rowIndex ? active.column : -1}
                onSelect={() => {
                  setActive({ row: rowIndex, column: 0 })
                  setSelectedId((current) => (current === row.subjectId ? null : row.subjectId))
                }}
                onPressCell={(cell, column) => {
                  setActive({ row: rowIndex, column })
                  if (cell.state === 'next') onAdvance(row, cell)
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 選んだ 1 行にできること。**盤面には常設しない** —— モックの盤面に行ごとの操作は無く、
 * 常に出すと 4 行 × 3 個の押せるものが格子の外へ積み上がる（空いた場所を埋めることになる）。
 */
function RowActions({
  row,
  onOpenCheckin,
  onLeave,
  onLinkCustomer,
  onMarkNoShow,
}: {
  row: VisitBoardRow
  onOpenCheckin?: (row: VisitBoardRow) => void
  onLeave?: (row: VisitBoardRow) => void
  onLinkCustomer?: (row: VisitBoardRow) => void
  onMarkNoShow?: (row: VisitBoardRow) => void
}) {
  const received = row.cells.find((cell) => cell.stage === 'received')
  const canCheckin =
    onOpenCheckin !== undefined && row.subjectType === 'reservation' && received?.state === 'empty'
  // お客様が特定できていない来店だけが結びつけを持つ（`visitCount` は名前がある行にだけ載る）。
  const canLink =
    onLinkCustomer !== undefined && row.subjectType === 'walkin' && row.visitCount === null
  const actions = [
    canCheckin ? { label: 'ご来店を受け付ける', press: () => onOpenCheckin?.(row) } : null,
    canLink ? { label: 'お客様を結びつける', press: () => onLinkCustomer?.(row) } : null,
    onLeave === undefined ? null : { label: '退店を記録する', press: () => onLeave(row) },
    onMarkNoShow === undefined
      ? null
      : { label: 'ご来店がなかった', press: () => onMarkNoShow(row) },
  ].filter((action) => action !== null)
  if (actions.length === 0) return null

  return (
    <fieldset
      aria-label={`${row.displayName} にできること`}
      className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface-2 px-4"
    >
      <p className="text-grid font-semibold text-ink">{row.displayName}</p>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.press}
          className={cn(
            'min-h-11 rounded-ctl border border-line-strong bg-surface px-3.5 text-grid font-semibold text-ink',
            focusRing,
          )}
        >
          {action.label}
        </button>
      ))}
    </fieldset>
  )
}

function Row({
  row,
  rowIndex,
  isLast,
  isSelected,
  activeColumn,
  onSelect,
  onPressCell,
}: {
  row: VisitBoardRow
  rowIndex: number
  isLast: boolean
  isSelected: boolean
  activeColumn: number
  onSelect: () => void
  onPressCell: (cell: VisitBoardCell, column: number) => void
}) {
  const badge = row.visitCount === null ? null : visitLabel(row.visitCount, 'badge')
  const name = [row.displayName, badge, row.purposeLabel]
    .filter((part) => part !== null && part !== '')
    .join('　')

  return (
    /* biome-ignore lint/a11y/useSemanticElements: 上の grid と同じ理由 */
    /* biome-ignore lint/a11y/useFocusableInteractive: 行は箱を持たない（display:contents） */
    <div role="row" aria-rowindex={rowIndex + 2} className="contents">
      {/* biome-ignore lint/a11y/useSemanticElements: 同上 */}
      <div
        data-board-cell
        role="rowheader"
        aria-colindex={1}
        aria-label={name}
        aria-selected={isSelected}
        tabIndex={activeColumn === 0 ? 0 : -1}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onSelect()
        }}
        className={cn(
          'flex flex-col justify-center gap-0.75 border-r border-line-strong px-4',
          isLast ? '' : 'border-b border-line',
          // お待たせ中は行そのものを赤地にする（列を 1 つだけ見て見落とさない）。
          row.isWaitingTooLong ? 'bg-danger-soft' : 'bg-surface',
          isSelected && 'ring-2 ring-pine ring-inset',
          focusRing,
        )}
      >
        <span className="flex items-center gap-2">
          <b className="text-body font-bold text-ink">{row.displayName}</b>
          {/* 来店回数の印は台帳（Timetable）と同じ 1 か所の綴りを呼ぶ。はじめての方は薄い橙、
              3 回目以上は薄い緑、1〜2 回目は罫だけ —— 数字の文字を必ず出す。 */}
          {row.visitCount !== null && <VisitBadge count={row.visitCount} />}
        </span>
        {row.purposeLabel !== '' && (
          <span className="text-grid text-ink-muted">{row.purposeLabel}</span>
        )}
      </div>

      {BOARD_STAGES.map((stage, index) => {
        const cell =
          row.cells.find((candidate) => candidate.stage === stage) ??
          ({
            stage,
            state: 'empty',
            at: null,
            label: '',
            note: null,
            needsAttention: false,
          } as VisitBoardCell)
        return (
          <Cell
            key={stage}
            row={row}
            cell={cell}
            column={index + 1}
            isLast={isLast}
            tabbable={activeColumn === index + 1}
            onPress={() => onPressCell(cell, index + 1)}
          />
        )
      })}
    </div>
  )
}

/** 欄 1 つの読み上げ名。**お客様の名前と工程の名前を必ず両方持つ**（AC-RECEP-19）。 */
function cellName(row: VisitBoardRow, cell: VisitBoardCell): string {
  const stage = STAGE_LABELS[cell.stage as (typeof BOARD_STAGES)[number]] ?? ''
  const head = `${row.displayName}　${stage}`
  const clock = cell.at === null ? '' : jstClock(cell.at)
  if (cell.state === 'done')
    return clock === '' ? `${head}　済みました` : `${head}　済みました　${clock}`
  if (cell.state === 'doing')
    return clock === '' ? `${head}　対応中` : `${head}　対応中　${clock}から`
  if (cell.state === 'waiting') return `${head}　お待たせ中　${cell.label}`
  if (cell.state === 'next') {
    const planned = `${head}　次にやること　${cell.label}`
    return cell.note === null ? planned : `${planned}　${cell.note}`
  }
  // 何も起きていない欄は空のまま。読み上げだけは「誰の・どの工程か」を言う。
  return head
}

function Cell({
  row,
  cell,
  column,
  isLast,
  tabbable,
  onPress,
}: {
  row: VisitBoardRow
  cell: VisitBoardCell
  column: number
  isLast: boolean
  tabbable: boolean
  onPress: () => void
}) {
  const attention = cell.state === 'next' && cell.needsAttention
  return (
    /* biome-ignore lint/a11y/useSemanticElements: 上の grid と同じ理由 */
    <div
      data-board-cell
      role="gridcell"
      aria-colindex={column + 1}
      aria-label={cellName(row, cell)}
      tabIndex={tabbable ? 0 : -1}
      onClick={onPress}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onPress()
      }}
      className={cn(
        'flex flex-col justify-center gap-0.5 px-3.5',
        isLast ? '' : 'border-b border-line',
        cell.state === 'doing' && 'border-l-4 border-l-pine pl-2.5',
        cell.state === 'next' && !attention && 'bg-pine-soft',
        // 注意（担当が勤務外・設備が点検中）は琥珀。赤は「お待たせ中」に取ってある。
        attention && 'bg-amber-soft',
        cell.state === 'waiting' && 'bg-danger-soft',
        focusRing,
      )}
    >
      {cell.state === 'empty' ? null : (
        <>
          <span
            className={cn(
              'text-grid',
              cell.state === 'done' && 'text-ink-muted',
              cell.state === 'doing' && 'font-semibold text-pine-deep',
              cell.state === 'next' && !attention && 'font-semibold text-pine-deep',
              attention && 'font-semibold text-amber',
              cell.state === 'waiting' && 'font-semibold text-danger',
            )}
          >
            {STATE_WORDS[cell.state]}
          </span>
          <b
            className={cn(
              'text-body font-semibold text-ink',
              cell.state === 'next' && !attention && 'text-pine-deep',
              attention && 'text-amber',
              cell.state === 'waiting' && 'text-danger',
            )}
          >
            {cell.state === 'done' && cell.at !== null && jstClock(cell.at)}
            {cell.state === 'doing' && cell.at !== null && `${jstClock(cell.at)}〜`}
            {(cell.state === 'next' || cell.state === 'waiting') && cell.label}
          </b>
          {cell.note !== null && (
            <span className="text-grid font-semibold text-amber">{cell.note}</span>
          )}
        </>
      )}
    </div>
  )
}

/** 状態は 4 語だけ（空の欄は語を持たない）。 */
const STATE_WORDS: Record<VisitBoardCell['state'], string> = {
  done: '済みました',
  doing: '対応中',
  next: '次にやること',
  waiting: 'お待たせ中',
  empty: '',
}
