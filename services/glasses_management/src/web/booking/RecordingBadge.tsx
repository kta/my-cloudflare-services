import { cn } from '@app/ui'

/*
 * 受付中の録音の印（承認済みモック docs/frontend/mockups/eyex の `.rec` と `.rec-float`）。
 *
 * 実測（assets/eyex.css）:
 *   .rec       = 最小高 48px・左右 14px・角 999px・--alert の 1px 罫・地は --alert-tint、
 *                点 12px、音の大きさは 3px 幅の棒 6 本（高さ 20px の枠）、時間はモノスペース 15px
 *   .rec.off   = 罫 --line-strong・地 --surface-2・文字 --ink-2（点も灰）
 *   .rec-float = 右下 20/20・白地・--alert の 2px 罫・角 16px・影
 *
 * **P3 が持つのは帯の見た目と状態だけ**である。録音そのもの（マイクの許可・経過時間・
 * R2 への保存）は `010-recording` が入れる。だから既定は「録音していません」で、
 * 経過時間は `null`（`--:--`）にする —— 録音していないのに「録音中」と書かない。
 * AC-BOOK-18 が求めているのは**置く場所が全工程で同じであること**なので、それは満たす。
 *
 * `role="status"` は `design/07-nfr.md` §2.3 が挙げる 7 か所のうちの 1 つ。
 */

export type RecordingBadgeProps = {
  state: 'recording' | 'off'
  /** 録音の経過秒。まだ数えていない間は null。 */
  seconds: number | null
  /** 帯の中（工程 1〜4）か、面の右下に常駐（工程 5）か。 */
  placement: 'bar' | 'floating'
}

/** 経過時間。数えていない間は「--:--」を出し、0 秒と取り違えさせない。 */
function elapsedLabel(seconds: number | null): string {
  if (seconds === null) return '--:--'
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

/** 音の大きさの棒。飾りなので読み上げから外す（高さはモックの実測）。 */
const METER_HEIGHTS = ['h-1.5', 'h-3', 'h-4.5', 'h-2.25', 'h-3.5', 'h-1.25'] as const

export function RecordingBadge({ state, seconds, placement }: RecordingBadgeProps) {
  const on = state === 'recording'
  return (
    <p
      role="status"
      data-booking-recording={placement}
      className={cn(
        'flex items-center gap-2.5 font-semibold',
        placement === 'bar'
          ? 'min-h-12 rounded-full border px-3.5 text-grid'
          : 'absolute right-5 bottom-5 z-10 rounded-panel border-2 bg-surface px-4 py-3 text-body shadow-lg',
        on ? 'border-danger text-danger' : 'border-line-strong text-ink-muted',
        placement === 'bar' && (on ? 'bg-danger-soft' : 'bg-surface-2'),
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-3 shrink-0 rounded-circle', on ? 'bg-danger' : 'bg-ink-faint')}
      />
      {on ? '録音中' : '録音していません'}
      <span aria-hidden="true" className="flex h-5 items-end gap-0.5">
        {METER_HEIGHTS.map((height) => (
          <span key={height} className={cn('w-0.75 rounded-full bg-current', height)} />
        ))}
      </span>
      <span className="font-mono text-body">{elapsedLabel(seconds)}</span>
    </p>
  )
}
