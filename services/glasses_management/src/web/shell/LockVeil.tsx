import { focusRing, focusRingOnPine } from '@app/ui'
import { type KeyboardEvent, useEffect, useRef } from 'react'

export type LockVeilProps = {
  onContinue: () => void
  onEndSession: () => void
  /** raw PIIを含めず、伏せ状態で読める最小の表示情報だけを持つ。 */
  snapshot?: {
    customerName: string
    customerPhone: string
    time: string
    count: number
  }
  /** サイドバーを持たない予約フローでも、画面全体を覆う。 */
  fullScreen?: boolean
}

/** 共有端末を無操作で伏せたときだけ Shell が重ねる、Esc では閉じない面。 */
export function LockVeil({
  onContinue,
  onEndSession,
  snapshot,
  fullScreen = false,
}: LockVeilProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)
  const endRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const first = continueRef.current
    const last = endRef.current
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <div
        aria-hidden="true"
        className={`absolute inset-x-0 ${fullScreen ? 'inset-y-0' : 'top-16 bottom-0'} z-4 bg-paper`}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="lock-veil-title"
        onKeyDown={trapFocus}
        className={`absolute inset-x-0 ${fullScreen ? 'inset-y-0' : 'top-16 bottom-0'} z-5 grid place-items-center p-5`}
      >
        <div className="w-full max-w-140 rounded-panel border-3 border-pine bg-surface px-10 pt-9 pb-8.5 text-center shadow-lg">
          <h2
            ref={titleRef}
            id="lock-veil-title"
            tabIndex={-1}
            className="text-title font-bold text-ink"
          >
            お客様の情報を隠しています
          </h2>
          <p className="mt-2.5 text-body leading-relaxed text-ink-muted">
            2分間さわらなかったので伏せました。さわると元に戻ります。
          </p>
          {snapshot && (
            <div className="mt-5 border-y border-line py-4 text-left text-body">
              <p className="font-semibold">{`本日のご予約　${snapshot.count}件`}</p>
              <p className="mt-2 font-mono text-ink-muted">{snapshot.time}</p>
              <p className="font-mono font-semibold">{snapshot.customerName}</p>
              <p className="font-mono text-ink-muted">{snapshot.customerPhone}</p>
            </div>
          )}
          <div className="mt-7.5 flex flex-wrap justify-center gap-4">
            <button
              ref={continueRef}
              type="button"
              onClick={onContinue}
              className={`min-h-14 flex-1 rounded-card bg-pine px-6 text-lead font-bold text-on-pine ${focusRingOnPine}`}
            >
              画面にさわって続ける
            </button>
            <button
              ref={endRef}
              type="button"
              onClick={onEndSession}
              className={`min-h-14 flex-1 rounded-card border border-line-strong bg-surface px-6 text-lead font-bold text-ink ${focusRing}`}
            >
              業務を終える
            </button>
          </div>
        </div>
      </section>
    </>
  )
}
