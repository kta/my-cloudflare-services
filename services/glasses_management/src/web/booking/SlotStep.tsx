import type {
  AvailabilityLane,
  AvailabilityResponse,
  AvailabilitySlot,
  LedgerAxis,
  LocalDate,
} from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { jstClock } from '../ledger/metrics'
import { BOARD_HEAD_HEIGHT_PX, BOARD_LABEL_WIDTH_PX, type BoardDrag, SlotBoard } from './SlotBoard'
import { type BoardCell, blockedText, columnSpan, snapToCell } from './slot-drag'
import type { StepGuard } from './steps'

/*
 * 工程 3「担当と場所」（承認済みモック docs/frontend/mockups/eye/images/BOOK-03-SLOT-STAFF.png /
 * BOOK-03b-SLOT-RESOURCE.png / BOOK-03c-DRAG.png）。
 *
 * 題材: 希望時刻に帯を置いてみて、先約とぶつかるかどうかを目で見る面。
 * トークン計画: 先約は `--color-busy` の灰、いま置いている帯は重なっていれば
 * `--color-danger` の 3px 罫、置けていれば `--color-pine` の 3px 罫。運んでいる先だけが
 * `--color-pine-line` の破線。**色だけで伝えず、帯の中に文字を書く。**
 * シグネチャ: 縦軸を担当 ⇄ 設備で入れ替えても、選んだものが保たれること。
 *
 * 空き枠は `GET /api/staff/availability`（`axis=staff` / `axis=resource`）**1 本**で描く。
 * 軸を替えたら親が引き直す（`onAxisChange`）が、選んだ担当・設備はこの面が覚えている。
 *
 * 枠を選び直した合図は `onChange` 1 本にまとめてある。仮の押さえの打ち直し
 * （`POST /api/staff/holds` と `DELETE /api/staff/holds/:holdId`）はこの合図で親が打つ。
 *
 * 実測（screens/BOOK-03*.html の <style> と assets/eye.css）:
 *   .split = 1fr / 330px。.side = padding 28px 24px・左に 1px の罫
 *   .toolbar = 高さ 56px・padding 0 16px・要素の間 10px
 *   .cand button = min-height 56px・角 12px・16px/600、補足 12〜13px、間 10px
 *   .nowat = 角 999px・padding 6px 16px・時刻 22px/700 ＋ 所要 13px/600
 *   .stepbar = 高さ 76px。.fab = 64×64px の丸
 */

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

/**
 * 「8月27日（木）」。モックの実測どおり年を落とす（同じ日の受付しか扱わない）。
 * `ledger/metrics.ts` の `dateLabel` は年を含む別用途なので、そちらは使わない。
 * BOOK-CONFLICT（`ConflictNotice`）も同じ書き方の日付を出すのでここから使う。
 */
export function shortDate(date: LocalDate): string {
  const day = new Date(`${date}T00:00:00.000Z`)
  return `${day.getUTCMonth() + 1}月${day.getUTCDate()}日（${WEEKDAYS[day.getUTCDay()]}）`
}

function plusMinutes(at: string, minutes: number): string {
  return new Date(Date.parse(at) + minutes * 60_000).toISOString()
}

/** 「11:00–12:00」。 */
function rangeOf(startsAt: string, durationMinutes: number): string {
  return `${jstClock(startsAt)}–${jstClock(plusMinutes(startsAt, durationMinutes))}`
}

/** 工程 3 で決まったこと。仮の押さえもこの形で打ち直す。 */
export type SlotChoice = {
  startsAt: string
  endsAt: string
  /** null は「担当はあとで決める」。 */
  staffId: string | null
  equipmentIds: string[]
}

export type SlotStepProps = {
  /** 空き枠の応答。まだ読めていなければ null。 */
  availability: AvailabilityResponse | null
  /** 読めたか、読めなかったか、通信が切れているか。 */
  phase?: 'ready' | 'loading' | 'error' | 'forbidden' | 'offline'
  axis: LedgerAxis
  onAxisChange: (axis: LedgerAxis) => void
  /** 工程 2 で選んだご用件の名前（帯と札に出す）。 */
  purposeLabel: string
  /** 工程 1 で選んだ時刻。工程 3 を開いたときの置き場所。 */
  startsAt: string
  durationMinutes: number
  /** 下書きから復ったときの担当。決めていなければ渡さない。 */
  staffId?: string | null
  equipmentIds?: string[]
  /**
   * いまの置き場所。**マウントした直後にも 1 度上げる** —— 何も触らずに「次へ」を
   * 押した受付でも、器が担当・設備を知らないと押さえも確定も打てない。
   * 仮の押さえの打ち直し（`POST`/`DELETE /api/staff/holds`）は器がこの合図で行う。
   */
  onChange: (choice: SlotChoice) => void
  /**
   * 「次へ進む」の可否。**この工程は自分の帯を持たない** —— 下端の帯は 5 工程を通して
   * 1 本きり（承認済みモック BOOK-03/03b/03c の `.stepbar`）なので、丸は器が描く。
   */
  onGuardChange: (guard: StepGuard) => void
  onRetry?: () => void
  onBackToDate?: () => void
}

export function SlotStep({
  availability,
  phase = 'ready',
  axis,
  onAxisChange,
  purposeLabel,
  startsAt: originStartsAt,
  durationMinutes,
  staffId: originStaffId,
  equipmentIds: originEquipmentIds,
  onChange,
  onGuardChange,
  onRetry,
  onBackToDate,
}: SlotStepProps) {
  const [startsAt, setStartsAt] = useState(originStartsAt)
  const [staffId, setStaffId] = useState<string | null | undefined>(originStaffId)
  const [equipmentIds, setEquipmentIds] = useState<string[]>(originEquipmentIds ?? [])
  const [drag, setDrag] = useState<{ pointerId: number; cell: BoardCell | null } | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  /* ペンが触れている間は指のポインタを捨てる（手のひらが盤に触れても帯が動かないように）。 */
  const penDown = useRef(false)
  /* 置き場所が変わったときだけ器へ上げる。親の関数が毎レンダー作り直されても打ち直さない。 */
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  /*
   * 軸をまたいで名前を覚えておく。担当の軸に居るあいだ設備の行は応答に無いので、
   * ここに残しておかないと「確保するもの／設備」が名前を言えない。
   */
  const laneNames = useRef(new Map<string, string>())

  const lanes = availability?.lanes ?? []
  for (const lane of lanes) {
    if (lane.id !== null) laneNames.current.set(lane.id, lane.name)
  }
  const columnSlots = lanes.reduce<AvailabilitySlot[]>(
    (best, lane) => (lane.slots.length > best.length ? lane.slots : best),
    [],
  )
  const columnStarts = columnSlots.map((slot) => slot.startsAt)
  const slotMinutes = availability?.slotMinutes ?? 30
  const span = columnSpan(durationMinutes, slotMinutes)

  const placedRow = rowOf(axis, lanes, staffId, equipmentIds)
  const placedColumn = Math.max(0, columnStarts.indexOf(startsAt))
  const placedLane = lanes[placedRow]
  const placedSlot = placedLane?.slots[placedColumn]
  const hasClash = placedSlot !== undefined && !placedSlot.isAvailable
  const originLaneId = resolveOriginId(axis, lanes, originStaffId, originEquipmentIds)
  const moved = startsAt !== originStartsAt || placedLane?.id !== originLaneId

  /*
   * まだ触っていない（`undefined`）担当は、器が覚えているぶん（`originStaffId`）で埋める。
   * `null`（「担当はあとで決める」を押した）とは分ける —— `??` で束ねると、
   * 設備の軸へ移った瞬間に「あとで決める」が前の担当へ化ける。
   */
  const chosenStaffId: string | null = staffId === undefined ? (originStaffId ?? null) : staffId

  /*
   * **担当の行を押していない受付でも、盤が既定で帯を乗せた行がその受付の担当である。**
   * 担当の軸に居るあいだにここで書き留めておかないと、設備の軸へ切り替えた瞬間に
   * `undefined` が「あとで決める」（null）へ落ち、黙って担当未定のご予約になる。
   * 「あとで決める」を押したあと（null）は書き換えない。
   */
  const placedStaffLaneId = axis === 'staff' ? (placedLane?.id ?? null) : null
  useEffect(() => {
    if (axis !== 'staff' || staffId !== undefined || placedStaffLaneId === null) return
    setStaffId(placedStaffLaneId)
  }, [axis, staffId, placedStaffLaneId])

  const choice: SlotChoice = {
    startsAt,
    endsAt: plusMinutes(startsAt, durationMinutes),
    staffId: axis === 'staff' ? (placedLane?.id ?? null) : chosenStaffId,
    equipmentIds,
  }

  /*
   * 「次へ進む」が押せない理由。**押せない丸には必ず理由を持たせる**（`05-screen-flow.md` §7.6）。
   * 読み込み中・権限なし・読めなかった・置ける枠が無い、の 4 つも同じ 1 か所で決める。
   */
  const blockedReason =
    phase === 'loading' || availability === null
      ? phase === 'forbidden'
        ? '権限がありません'
        : '読み込みが終わると進めます'
      : phase === 'forbidden'
        ? '権限がありません'
        : availability.isClosed || lanes.length === 0
          ? '置ける枠がありません'
          : phase === 'offline'
            ? '通信がつながると進めます'
            : drag !== null
              ? '指を離すと進めます'
              : hasClash
                ? '重なりを解くと進めます'
                : null

  useEffect(() => {
    onGuardChange(
      blockedReason === null
        ? { canProceed: true, blockedReason: '' }
        : { canProceed: false, blockedReason },
    )
  }, [blockedReason, onGuardChange])

  /*
   * いまの置き場所を器へ上げる。マウントした直後にも 1 度上げるので、何も触らずに
   * 「次へ」を押した受付でも、器は担当・設備・時刻を知っている。
   */
  const placement = `${choice.startsAt}|${choice.endsAt}|${choice.staffId ?? ''}|${choice.equipmentIds.join(',')}`
  const choiceRef = useRef(choice)
  const reportedRef = useRef<string | null>(null)
  choiceRef.current = choice
  useEffect(() => {
    if (reportedRef.current === placement) return
    reportedRef.current = placement
    onChangeRef.current(choiceRef.current)
  })

  /* --- 運ぶ ------------------------------------------------------------- */

  function geometry() {
    const rect = boardRef.current?.getBoundingClientRect()
    if (rect === undefined) return null
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      labelWidth: BOARD_LABEL_WIDTH_PX,
      headHeight: BOARD_HEAD_HEIGHT_PX,
      columns: columnStarts.length,
      rows: lanes.length,
    }
  }

  function onGrab(event: PointerEvent<HTMLElement>) {
    if (penDown.current && event.pointerType !== 'pen') return
    if (event.pointerType === 'pen') penDown.current = true
    const board = boardRef.current
    if (board !== null && typeof board.setPointerCapture === 'function') {
      board.setPointerCapture(event.pointerId)
    }
    setDrag({ pointerId: event.pointerId, cell: null })
  }

  function onDragMove(event: PointerEvent<HTMLElement>) {
    if (drag === null || event.pointerId !== drag.pointerId) return
    const board = geometry()
    if (board === null) return
    const cell = snapToCell({ x: event.clientX, y: event.clientY }, board)
    setDrag({ pointerId: drag.pointerId, cell })
  }

  function onDragEnd(event: PointerEvent<HTMLElement>) {
    if (drag === null || event.pointerId !== drag.pointerId) return
    if (event.pointerType === 'pen') penDown.current = false
    const cell = drag.cell
    setDrag(null)
    if (cell === null) return
    const target = lanes[cell.row]
    const slot = target?.slots[cell.column]
    // 置けないところで指を離したら、もとの位置へ戻す（何も変えない）。
    if (target === undefined || slot === undefined || !slot.isAvailable) return
    place(target, slot.startsAt)
  }

  /* --- 置き直す --------------------------------------------------------- */

  function place(lane: AvailabilityLane, at: string) {
    const nextStaff = axis === 'staff' ? lane.id : chosenStaffId
    const nextEquipment = axis === 'resource' && lane.id !== null ? [lane.id] : equipmentIds
    setStartsAt(at)
    setStaffId(nextStaff)
    setEquipmentIds(nextEquipment)
    onChange({
      startsAt: at,
      endsAt: plusMinutes(at, durationMinutes),
      staffId: nextStaff,
      equipmentIds: nextEquipment,
    })
  }

  function decideLater() {
    if (axis === 'staff') {
      setStaffId(null)
      onChange({ ...choice, staffId: null })
      return
    }
    setEquipmentIds([])
    onChange({ ...choice, equipmentIds: [] })
  }

  function backToOrigin() {
    setStartsAt(originStartsAt)
    setStaffId(originStaffId)
    setEquipmentIds(originEquipmentIds ?? [])
    const row = rowOf(axis, lanes, originStaffId, originEquipmentIds ?? [])
    onChange({
      startsAt: originStartsAt,
      endsAt: plusMinutes(originStartsAt, durationMinutes),
      staffId: axis === 'staff' ? (lanes[row]?.id ?? null) : (originStaffId ?? null),
      equipmentIds: originEquipmentIds ?? [],
    })
  }

  /* --- 読めなかったとき ------------------------------------------------- */

  if (phase === 'loading' || (availability === null && phase === 'ready')) {
    return (
      <Frame axis={axis} onAxisChange={onAxisChange} head={null}>
        <p role="status" className="p-11 text-body text-ink-muted">
          読み込んでいます…
        </p>
      </Frame>
    )
  }
  if (phase === 'forbidden') {
    return (
      <Frame axis={axis} onAxisChange={onAxisChange} head={null}>
        <div role="alert" className="grid flex-1 content-center justify-items-start gap-3 p-11">
          <p className="text-title font-bold text-ink">このお店の空き枠を見る権限がありません。</p>
          {/* やり直しても結果は同じなので、やり直す道を出さない。 */}
          <p className="text-body text-ink-muted">お店の管理者にご確認ください。</p>
        </div>
      </Frame>
    )
  }
  if (availability === null) {
    return (
      <Frame axis={axis} onAxisChange={onAxisChange} head={null}>
        <div role="alert" className="grid flex-1 content-center justify-items-start gap-3 p-11">
          <p className="text-title font-bold text-ink">
            空き枠を読み込めませんでした。もう一度お試しください。
          </p>
          {onRetry !== undefined && (
            <button
              type="button"
              onClick={onRetry}
              className={cn(
                'min-h-13 rounded-ctl bg-pine px-6 text-lead font-bold text-on-pine',
                focusRing,
              )}
            >
              もう一度読み込む
            </button>
          )}
        </div>
      </Frame>
    )
  }

  const head = (
    <>
      <h2 className="whitespace-nowrap text-lead font-bold text-ink">
        {shortDate(availability.date)}
      </h2>
      {drag !== null && drag.cell !== null ? (
        <span className="inline-flex items-baseline gap-2.5 rounded-full border border-pine-line bg-pine-soft px-4 py-1.5 text-pine-deep">
          <b className="text-title">
            {rangeOf(columnStarts[drag.cell.column] ?? startsAt, durationMinutes)}
          </b>
          <span className="text-grid font-semibold">{`${durationMinutes}分`}</span>
        </span>
      ) : (
        <p className="whitespace-nowrap text-lead font-bold text-ink">
          {`${rangeOf(startsAt, durationMinutes)}（${durationMinutes}分）`}
        </p>
      )}
      <span className="inline-flex min-h-5.5 items-center rounded-ctl border border-pine-line bg-pine-soft px-2 text-note font-semibold text-pine-deep">
        {purposeLabel}
      </span>
      {/*
        凡例の色見本は**盤に出ている実物と同じ色**でなければ嘘になる。置いている帯は
        重なっているときだけ赤（`--color-danger`）で、重なっていなければ緑（`--color-pine`）。
        運んでいる間は、承認済みモック BOOK-03c と同じ「動かしているご予約／置く先」に差し替える。
      */}
      <p className="ml-auto flex items-center gap-3.5 text-note text-ink-muted">
        {drag === null ? (
          <>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  'h-3.5 w-3.5 rounded-ctl border-2',
                  hasClash ? 'border-danger bg-danger-soft' : 'border-pine bg-pine-soft',
                )}
              />
              いま置いているご予約
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-3.5 w-3.5 rounded-ctl bg-busy" />
              先約
            </span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 rounded-ctl border-2 border-pine bg-pine-soft"
              />
              動かしているご予約
            </span>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 rounded-ctl border-2 border-pine border-dashed"
              />
              置く先
            </span>
          </>
        )}
      </p>
    </>
  )

  if (availability.isClosed || lanes.length === 0) {
    return (
      <Frame axis={axis} onAxisChange={onAxisChange} head={head}>
        <div role="status" className="grid flex-1 content-center justify-items-start gap-3 p-11">
          <p className="text-title font-bold text-ink">この日はお店を開けていません。</p>
          <p className="text-body text-ink-muted">
            お日にちを選び直すと、受け付けられる時刻をもう一度お出しします。
          </p>
          {onBackToDate !== undefined && (
            <button
              type="button"
              onClick={onBackToDate}
              className={cn(
                'min-h-13 rounded-ctl bg-pine px-6 text-lead font-bold text-on-pine',
                focusRing,
              )}
            >
              別の日を選ぶ
            </button>
          )}
        </div>
      </Frame>
    )
  }

  /* --- 運んでいる先 ----------------------------------------------------- */

  const targetCell = drag?.cell ?? null
  const targetLane = targetCell === null ? null : (lanes[targetCell.row] ?? null)
  const targetSlot = targetCell === null ? null : (targetLane?.slots[targetCell.column] ?? null)
  const canDrop = targetSlot?.isAvailable === true
  const dragView: BoardDrag | null =
    drag === null
      ? null
      : {
          target: drag.cell,
          canDrop,
          label:
            targetSlot === null
              ? ''
              : canDrop
                ? `${rangeOf(targetSlot.startsAt, durationMinutes)} へ`
                : blockedText(targetLane?.name ?? 'この枠', targetSlot.reason),
        }

  const candidates = candidatesOf(lanes, placedRow, placedColumn, durationMinutes)

  return (
    <Frame
      axis={axis}
      onAxisChange={onAxisChange}
      head={head}
      banner={
        phase === 'offline' ? (
          <p
            role="status"
            className="flex-none border-danger border-b-2 bg-danger-soft px-8 py-4 text-body text-ink"
          >
            通信が切れています。ご予約の確定は、つながってからになります。
          </p>
        ) : null
      }
    >
      <div className="flex min-h-0 flex-1">
        <SlotBoard
          axisLabel={axis === 'resource' ? '設備・場所' : '担当者'}
          lanes={lanes}
          columnStarts={columnStarts}
          span={span}
          placed={{ row: placedRow, column: placedColumn }}
          placedLabel={rangeOf(startsAt, durationMinutes)}
          purposeLabel={purposeLabel}
          durationMinutes={durationMinutes}
          hasClash={hasClash}
          drag={dragView}
          onGrab={onGrab}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          boardRef={boardRef}
        />

        <aside className="flex w-82.5 flex-none flex-col overflow-auto border-line border-l bg-surface px-6 py-7">
          <div aria-live="polite">
            {drag !== null ? (
              <Card tone={canDrop ? 'pine' : 'danger'}>
                <b className="text-lead font-bold">
                  {canDrop
                    ? '指を離すと、この時刻で確保します'
                    : '指を離すと、もとの場所に戻ります'}
                </b>
                <p className="mt-1.5 text-grid">
                  {canDrop && targetSlot !== null
                    ? `${rangeOf(targetSlot.startsAt, durationMinutes)}　先約との重なりはありません。`
                    : blockedText(targetLane?.name ?? 'この枠', targetSlot?.reason ?? null)}
                </p>
              </Card>
            ) : hasClash ? (
              <Card tone="danger">
                <b className="text-lead font-bold">
                  {`${placedLane?.name ?? ''} に ${jstClock(startsAt)} の先約があります`}
                </b>
                <p className="mt-1.5 text-grid">
                  {axis === 'resource'
                    ? '同じ機械を二重に使うことになります。設備を変えるか、時間をずらしてください。'
                    : 'このままでは二重のご予約になります。担当を変えるか、時間をずらしてください。'}
                </p>
              </Card>
            ) : (
              <Card tone="pine">
                <b className="text-lead font-bold">この時刻で確保できます</b>
                <p className="mt-1.5 text-grid">
                  {`${rangeOf(startsAt, durationMinutes)}　先約との重なりはありません。`}
                </p>
              </Card>
            )}
          </div>

          {hasClash && drag === null ? (
            <>
              <h3 className="mt-6.5 text-body font-bold text-ink">
                {axis === 'resource'
                  ? `同じ ${jstClock(startsAt)} で使える設備`
                  : `同じ ${jstClock(startsAt)} で受けられる担当`}
              </h3>
              <ul className="mt-2.5 grid gap-2.5">
                {candidates.map((candidate) => (
                  <li key={candidate.lane.id ?? candidate.lane.name}>
                    <button
                      type="button"
                      onClick={() => place(candidate.lane, candidate.startsAt)}
                      className={cn(
                        'flex min-h-14 w-full flex-col justify-center rounded-card border border-line-strong bg-surface px-3.5 py-2.5 text-left text-body font-semibold text-ink',
                        focusRing,
                      )}
                    >
                      <span>{candidate.lane.name}</span>
                      <span className="text-grid font-normal text-ink-muted">{candidate.note}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {/*
                候補が 1 件も無いときに 1 文で終わらせない（IDX-BOOK-06 例外 E2 の
                「時刻の選び直しへ戻す」）。ここで行き止まりにすると、電話口で
                言うことが無くなる。
              */}
              {candidates.length === 0 && (
                <div className="mt-2.5 grid justify-items-start gap-2.5">
                  <p className="text-grid text-ink-muted">
                    この時刻に空いている先がありません。時間をずらしてください。
                  </p>
                  {onBackToDate !== undefined && (
                    <button
                      type="button"
                      onClick={onBackToDate}
                      className={cn(
                        'min-h-12 rounded-card bg-pine px-4.5 text-body font-bold text-on-pine',
                        focusRing,
                      )}
                    >
                      時刻を選び直す
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <h3 className="mt-6.5 text-body font-bold text-ink">確保するもの</h3>
              <dl className="mt-2.5">
                <HoldLine label="担当">
                  {axis === 'staff'
                    ? (placedLane?.name ?? 'あとで決める')
                    : chosenStaffId === null
                      ? 'あとで決める'
                      : /* 設備の軸に居るあいだ担当の行は応答に無いので、覚えている名前で言う。 */
                        (staffName(lanes, chosenStaffId) ??
                        laneNames.current.get(chosenStaffId) ??
                        'この工程で決めます')}
                </HoldLine>
                <HoldLine label="設備">
                  {equipmentIds.length === 0
                    ? 'あとで決める'
                    : axis === 'resource'
                      ? (placedLane?.name ?? '')
                      : /* 担当の軸に居るあいだ設備の行は応答に無いので、覚えている名前で言う。 */
                        equipmentIds
                          .map((id) => laneNames.current.get(id))
                          .filter((name): name is string => name !== undefined)
                          .join('・')}
                </HoldLine>
                <HoldLine label="時刻">
                  {rangeOf(
                    canDrop && targetSlot !== null ? targetSlot.startsAt : startsAt,
                    durationMinutes,
                  )}
                </HoldLine>
              </dl>
            </>
          )}

          <p className="mt-6.5 text-grid text-ink-muted">
            {axis === 'resource'
              ? 'ご予約は指でつかんで、ほかの設備や時刻へそのまま動かせます。'
              : 'ご予約は指でつかんで、ほかの担当や時刻へそのまま動かせます。'}
          </p>

          <div className="mt-auto grid gap-2.5 pt-6.5">
            {moved && (
              <button
                type="button"
                onClick={backToOrigin}
                className={cn(
                  'min-h-12 w-full rounded-card border border-line-strong bg-surface text-body font-semibold text-ink',
                  focusRing,
                )}
              >
                {`もとの ${jstClock(originStartsAt)} に戻す`}
              </button>
            )}
            <button
              type="button"
              onClick={decideLater}
              className={cn(
                'min-h-12 w-full rounded-card border border-line-strong bg-surface text-body font-semibold text-ink',
                focusRing,
              )}
            >
              {axis === 'resource' ? '設備はあとで決める' : '担当はあとで決める'}
            </button>
          </div>
        </aside>
      </div>
    </Frame>
  )
}

/* --- 器 ------------------------------------------------------------------ */

/*
 * 盤の器。**下端の帯を持たない** —— 工程の札・録音・「次へ」の丸は 5 工程を通して
 * 1 本きり（承認済みモック BOOK-03/03b/03c の `.stepbar`）で、器（BookingScreen）が描く。
 */
function Frame({
  axis,
  onAxisChange,
  head,
  banner,
  children,
}: {
  axis: LedgerAxis
  onAxisChange: (axis: LedgerAxis) => void
  head: ReactNode
  banner?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex h-full w-full min-h-0 flex-col bg-paper">
      <div className="flex min-h-14 flex-none items-center gap-2.5 border-line border-b bg-surface px-4">
        <fieldset aria-label="枠の選び方" className="flex gap-0.5 rounded-ctl bg-surface-2 p-0.5">
          {(
            [
              { key: 'staff', label: '担当者' },
              { key: 'resource', label: '設備・場所' },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={axis === option.key}
              onClick={() => onAxisChange(option.key)}
              className={cn(
                'min-h-11 rounded-ctl px-4 text-grid font-semibold',
                axis === option.key
                  ? 'bg-surface text-pine ring-1 ring-line'
                  : 'bg-transparent text-ink-muted',
                focusRing,
              )}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
        {head}
      </div>
      {banner}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

function Card({ tone, children }: { tone: 'pine' | 'danger'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-panel border px-5.5 py-5',
        tone === 'danger'
          ? 'border-danger bg-danger-soft text-danger'
          : 'border-pine-line bg-pine-soft text-pine-deep',
      )}
    >
      {children}
    </div>
  )
}

function HoldLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-line border-t py-4 first:border-t-0">
      <dt className="w-11 flex-none text-grid font-semibold text-ink-muted">{label}</dt>
      <dd className="text-lead font-semibold text-ink">{children}</dd>
    </div>
  )
}

/* --- 置き場所と候補 ------------------------------------------------------ */

/** いま帯が乗っている行。決めていなければ先頭の行に置く（モックと同じ）。 */
function rowOf(
  axis: LedgerAxis,
  lanes: readonly AvailabilityLane[],
  staffId: string | null | undefined,
  equipmentIds: readonly string[],
): number {
  if (lanes.length === 0) return 0
  if (axis === 'resource') {
    const found = lanes.findIndex((lane) => lane.id !== null && equipmentIds.includes(lane.id))
    return found === -1 ? 0 : found
  }
  if (staffId === undefined) return 0
  if (staffId === null) {
    const found = lanes.findIndex((lane) => lane.kind === 'unassigned')
    return found === -1 ? 0 : found
  }
  const found = lanes.findIndex((lane) => lane.id === staffId)
  return found === -1 ? 0 : found
}

/** 工程 3 を開いたときに帯が乗っていた行の id。「もとの…に戻す」を出す判定に使う。 */
function resolveOriginId(
  axis: LedgerAxis,
  lanes: readonly AvailabilityLane[],
  staffId: string | null | undefined,
  equipmentIds: readonly string[] | undefined,
): string | null | undefined {
  if (lanes.length === 0) return undefined
  return lanes[rowOf(axis, lanes, staffId, equipmentIds ?? [])]?.id
}

function staffName(lanes: readonly AvailabilityLane[], staffId: string): string | null {
  return lanes.find((lane) => lane.id === staffId)?.name ?? null
}

type Candidate = { lane: AvailabilityLane; startsAt: string; note: string }

/**
 * 同じ時刻で受けられる先。空いていない行は「12:00 からなら空いています」と、
 * **いつなら受けられるか**を添える（黙って一覧から消すと、電話口で言うことが無くなる）。
 */
function candidatesOf(
  lanes: readonly AvailabilityLane[],
  placedRow: number,
  column: number,
  durationMinutes: number,
): Candidate[] {
  const found: Candidate[] = []
  const later: Candidate[] = []
  for (const [index, lane] of lanes.entries()) {
    if (index === placedRow || lane.kind === 'unassigned') continue
    if (lane.slots.length > 0 && lane.slots.every((slot) => slot.reason === 'no_skill')) continue
    const here = lane.slots[column]
    const subtitle = lane.subtitle === '' ? '' : `${lane.subtitle}　`
    if (here?.isAvailable === true) {
      found.push({
        lane,
        startsAt: here.startsAt,
        note: `${subtitle}${rangeOf(here.startsAt, durationMinutes)} が空いています`,
      })
      continue
    }
    const next = lane.slots.find((slot, at) => at > column && slot.isAvailable)
    if (next === undefined) continue
    later.push({
      lane,
      startsAt: next.startsAt,
      note: `${subtitle}${jstClock(next.startsAt)} からなら空いています`,
    })
  }
  return [...found, ...later].slice(0, 3)
}
