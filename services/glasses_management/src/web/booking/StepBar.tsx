import { cn, focusRing } from '@app/ui'
import type { ReactNode } from 'react'
import {
  BOOKING_STEPS,
  type BookingStepKey,
  backButtonLabel,
  nextButtonLabel,
  previousStep,
  type StepGuard,
  stepIndex,
} from './steps'

/*
 * 下端の工程の帯（承認済みモック docs/frontend/mockups/eye/images/BOOK-01-DATETIME.png ほか 12 面）。
 *
 * 実測（screens/BOOK-0*.html と assets/eye.css）:
 *   .stepbar  = 高さ 76px・左右 18px・要素の間 14px・上に 1px の罫・地は白
 *   .back     = 48×48px の丸・--line-strong の 1px 罫
 *   .step     = 最小高 36px・左右 14px・角 999px・14px/600。未通過 --surface-2 /
 *               通過 --brand-tint + --brand-dark / 現在 --brand + 白
 *   .step-sep = --ink-3 の 12px。.fab = 64×64px の丸（押せないときの地は --busy）
 *
 * **工程バーを `<nav>` にしない。**中身は押せない札なので、`<nav>` にすると読み上げの
 * ローターに「ナビゲーション」として出るのに移動先が無い。`<ol aria-label="予約の工程　全5工程">`
 * にし、戻る手段は左端の `‹`（48pt）だけにする（`design/05-screen-flow.md` §7.6）。
 *
 * 通過した札には**常に ✓ を付ける**。モックは BOOK-04 系の 4 面にしか付けていないが、
 * 「色だけで状態を伝えない」という決めに合わせて統一する（§2.5）。付ける位置は
 * モックと同じ**名前のうしろ**（「1　日時 ✓」）—— 前に置くと札の中の名前が右へずれる。
 */

export type StepBarProps = {
  current: BookingStepKey
  /**
   * いまの工程より後ろにあるのに、もう伺い終えている工程。BOOK-CONFLICT は工程 5 から
   * 工程 3 へ差し戻した面なので、お名前（工程 4）の ✓ をここで残す
   * （承認済みモック BOOK-CONFLICT の帯は「1✓ 2✓ 3 現在 4✓ 5 未通過」）。
   */
  done?: readonly BookingStepKey[]
  guard: StepGuard
  onBack: () => void
  onNext: () => void
  /**
   * 帯の中に置く録音の表示（工程 1〜4）。工程 5 は右下の常駐表示に移るので `null`。
   * 置き場所そのものは工程を移っても動かない（AC-BOOK-18）。
   */
  recording: ReactNode
  /**
   * 帯の右端。工程 5 だけ、丸い「次へ」の代わりに「復唱を終えて予約を確定する」
   * （`.btn.primary.big`・最小高 56px）が入る（承認済みモック BOOK-05-CONFIRM）。
   */
  action?: ReactNode
}

export function StepBar({
  current,
  done = [],
  guard,
  onBack,
  onNext,
  recording,
  action,
}: StepBarProps) {
  const index = stepIndex(current)
  const atStart = previousStep(current) === null
  return (
    <footer
      data-booking-stepbar
      className="flex h-19 shrink-0 items-center gap-3.5 border-t border-line bg-surface px-4.5"
    >
      <button
        type="button"
        aria-label={backButtonLabel(current)}
        disabled={atStart}
        onClick={onBack}
        className={cn(
          'grid size-12 shrink-0 place-items-center rounded-circle border border-line-strong bg-surface text-title',
          atStart ? 'text-ink-faint' : 'text-ink-muted',
          focusRing,
        )}
      >
        <span aria-hidden="true">‹</span>
      </button>

      <ol
        aria-label="予約の工程　全5工程"
        className="flex min-w-0 items-center gap-1.5 overflow-hidden"
      >
        {BOOKING_STEPS.map((step, position) => {
          const passed = position !== index && (position < index || done.includes(step.key))
          return (
            <li
              key={step.key}
              aria-current={position === index ? 'step' : undefined}
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
                  position === index
                    ? 'bg-pine text-on-pine'
                    : passed
                      ? 'bg-pine-soft text-pine-deep'
                      : 'bg-surface-2 text-ink-muted',
                )}
              >
                {position + 1}　{step.label}
                {/* ✓ は名前の**うしろ**（承認済みモック BOOK-04 系の「1　日時 ✓」）。 */}
                {passed && <span aria-hidden="true">✓</span>}
                {position === index && (
                  <span className="sr-only">　全5工程のうち{position + 1}つ目</span>
                )}
              </span>
            </li>
          )
        })}
      </ol>

      {recording !== null && (
        <div data-booking-recording-slot className="ml-auto flex items-center">
          {recording}
        </div>
      )}

      {action ?? (
        <button
          type="button"
          aria-label={nextButtonLabel(guard)}
          disabled={!guard.canProceed}
          onClick={onNext}
          className={cn(
            'grid size-16 shrink-0 place-items-center rounded-circle text-hero text-on-pine',
            guard.canProceed ? 'bg-pine' : 'bg-busy',
            recording === null && 'ml-auto',
            focusRing,
          )}
        >
          <span aria-hidden="true">›</span>
        </button>
      )}
    </footer>
  )
}
