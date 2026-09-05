import { useEffect, useRef } from 'react'
import { cn } from './cn'
import { focusRing } from './components'

/*
 * 記録に積んだ直後に出す、取り消しの付いた 1 行。
 *
 * これが無かったあいだ、製品には**元に戻す手立てが 1 つも無かった**（UX 監査 NEW-04）。
 * 来店受付の工程は確認を挟まず即座に追記され、押し間違いに気づいても戻せない。
 * 押す前に確認を挟むと、1 日に何十回も押す操作が毎回止まる。だから**押させてから、
 * 数秒だけ戻せる**形にする。
 *
 * 読み上げは `role="status"`（`alert` ではない）。失敗の知らせではないので、
 * 読んでいる途中の文を割り込んで奪わない。
 */

export type UndoBarProps = {
  /** 何が起きたか。「田中 花子 様を『視力測定』へ進めました」のように、主語と結果を書く。 */
  message: string
  /** 取り消しの操作。押すと親が打ち消しを積む。 */
  onUndo: () => void
  /** 時間切れか、×で閉じたとき。親はここで自分の状態を捨てる。 */
  onDismiss: () => void
  /** 出しておく長さ。既定は 8 秒 —— 押し間違いに気づいて手を戻すのに要る時間である。 */
  timeoutMs?: number
}

export function UndoBar({ message, onUndo, onDismiss, timeoutMs = 8000 }: UndoBarProps) {
  /* 親の関数が毎レンダー作り直されても、数え直さない。 */
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    const timer = setTimeout(() => dismissRef.current(), timeoutMs)
    return () => clearTimeout(timer)
  }, [timeoutMs])

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-6"
    >
      <div className="pointer-events-auto flex max-w-3xl items-center gap-4 rounded-panel border-2 border-line-strong bg-surface px-5 py-3">
        <p className="min-w-0 text-body text-ink">{message}</p>
        <button
          type="button"
          onClick={onUndo}
          className={cn(
            'min-h-11 shrink-0 rounded-ctl border border-pine bg-pine px-4 text-body font-semibold text-on-pine',
            focusRing,
          )}
        >
          元に戻す
        </button>
        <button
          type="button"
          aria-label="この知らせを閉じる"
          onClick={onDismiss}
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-circle text-title text-ink-muted',
            focusRing,
          )}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  )
}
