import type { AvailabilityResponse, LedgerAxis } from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { cn, focusRing } from '@app/ui'
import { useEffect, useState } from 'react'
import { type SlotChoice, SlotStep } from '../booking/SlotStep'
import type { StepGuard } from '../booking/steps'
import { client } from '../client'

/*
 * 予約の変更の工程 2 の、もう一方の道「担当と場所を変える」。
 *
 * これが無かったあいだ、店側には**担当と場所を変える手立てが 1 つも無かった** ——
 * 「佐藤が休むので鈴木に回す」という、眼鏡店でいちばん起きる差し替えができず、
 * 取り消して取り直すしかなかった（UX 監査 NEW-01）。API（`PATCH /api/staff/reservations/:id`
 * の `staffId` / `equipmentIds`）は初めからあったので、足りていなかったのは画面だけである。
 *
 * 盤そのものは予約フローの工程 3 と同じ `booking/SlotStep` を使う。**同じ操作を
 * 2 通り覚えさせない**ためで、置き場所を運ぶ手つきも先約の見え方もそのまま揃う。
 * 空き枠は自分を数から外して読む（`excludeReservationId`）—— 外さないと、
 * いまの予約自身が自分の席をふさいでいて「動かせない」と出る。
 */

export type ChangeSlotTarget = {
  reservationId: string
  startsAt: string
  durationMinutes: number
  purposeLabel: string
  staffId: string | null
  equipmentIds: string[]
}

export type ChangeSlotProps = {
  storeId: string
  target: ChangeSlotTarget
  /**
   * いまの内容から 1 つでも変わったか。**変わっていないうちは先へ進ませない** ——
   * サーバは変更点の無い入力を落とすし、通ったところで差分表が空のまま版だけが進み、
   * 何も起きていない操作が監査に 1 行残る。
   */
  isChanged: boolean
  onChange: (choice: SlotChoice) => void
  onBack: () => void
  onNext: () => void
}

export function ChangeSlot({
  storeId,
  target,
  isChanged,
  onChange,
  onBack,
  onNext,
}: ChangeSlotProps) {
  const [axis, setAxis] = useState<LedgerAxis>('staff')
  const [board, setBoard] = useState<AvailabilityResponse | null>(null)
  const [phase, setPhase] = useState<'ready' | 'loading' | 'error'>('loading')
  const [reload, setReload] = useState(0)
  const [guard, setGuard] = useState<StepGuard>({ canProceed: false, blockedReason: '' })

  useEffect(() => {
    let live = true
    setBoard(null)
    setPhase('loading')
    client.api.staff.availability
      .$get({
        query: {
          storeId,
          date: toJstDateString(new Date(target.startsAt)),
          axis,
          durationMinutes: String(target.durationMinutes),
          excludeReservationId: target.reservationId,
        },
      })
      .then(async (res) => {
        if (!live) return
        if (!res.ok) {
          setPhase('error')
          return
        }
        setBoard(await res.json())
        setPhase('ready')
      })
      .catch(() => {
        if (live) setPhase('error')
      })
    return () => {
      live = false
    }
  }, [storeId, axis, target.startsAt, target.durationMinutes, target.reservationId, reload])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <SlotStep
          availability={board}
          phase={phase}
          axis={axis}
          onAxisChange={setAxis}
          purposeLabel={target.purposeLabel}
          startsAt={target.startsAt}
          durationMinutes={target.durationMinutes}
          staffId={target.staffId}
          equipmentIds={target.equipmentIds}
          onChange={onChange}
          onGuardChange={setGuard}
          onRetry={() => setReload((count) => count + 1)}
        />
      </div>
      <StepBar canProceed={guard.canProceed && isChanged} onBack={onBack} onNext={onNext} />
    </div>
  )
}

const CHANGE_STEPS = ['予約を探す', '担当と場所を変える', 'ご確認', '完了'] as const

/** 下辺の工程の帯。`ChangeDateTime` と同じ綴りで、2 段目の名前だけが違う。 */
function StepBar({
  canProceed,
  onBack,
  onNext,
}: {
  canProceed: boolean
  onBack: () => void
  onNext: () => void
}) {
  return (
    <footer className="flex h-19 shrink-0 items-center gap-3.5 border-t border-line bg-surface px-4.5">
      <button
        type="button"
        aria-label="前へ戻る"
        onClick={onBack}
        className={cn(
          'grid size-12 shrink-0 place-items-center rounded-circle border border-line-strong bg-surface text-title text-ink-muted',
          focusRing,
        )}
      >
        <span aria-hidden="true">‹</span>
      </button>

      <ol
        aria-label="予約の変更の工程　全4工程"
        className="flex min-w-0 items-center gap-1.5 overflow-hidden"
      >
        {CHANGE_STEPS.map((label, position) => (
          <li
            key={label}
            aria-current={position === 1 ? 'step' : undefined}
            className="flex items-center gap-1.5"
          >
            {position > 0 && (
              <span aria-hidden="true" className="text-note text-ink-faint">
                ›
              </span>
            )}
            <span
              className={cn(
                'flex min-h-9 items-center gap-1 whitespace-nowrap rounded-full px-3.5 text-grid font-semibold',
                position === 1
                  ? 'bg-pine text-on-pine'
                  : position < 1
                    ? 'bg-pine-soft text-pine-deep'
                    : 'bg-surface-2 text-ink-muted',
              )}
            >
              {position + 1}　{label}
              {position < 1 && <span aria-hidden="true">✓</span>}
              {position === 1 && <span className="sr-only">　全4工程のうち2つ目</span>}
            </span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        aria-label={
          canProceed
            ? '変更内容を確認する'
            : '変更内容を確認する　担当か場所をお変えになると進めます'
        }
        disabled={!canProceed}
        onClick={onNext}
        className={cn(
          'ml-auto min-h-14 shrink-0 rounded-card border border-pine bg-pine px-6 text-lead font-semibold text-on-pine',
          'disabled:border-line disabled:bg-surface-2 disabled:text-ink-faint',
          focusRing,
        )}
      >
        変更内容を確認する
      </button>
    </footer>
  )
}
