import { focusRingOnPine } from '@app/ui'
import { jstClock } from './metrics'

/*
 * 通信断の帯（承認済みモック docs/frontend/mockups/eye/images/EX-OFFLINE.png）。
 *
 * 書けないことを伝えたうえで、読むことだけは続けられる状態を保つ面。
 * 「成立したのか／していないのか／再試行できるのか」の 3 つを必ず文字で読ませる。
 *
 * 実測値（screens/EX-OFFLINE.html）: 帯 = padding 20px 32px・地 --alert-tint・
 * 下に 2px の --alert。見出し 21px（トークンの最寄りは 22px の text-title）、
 * 本文 16px/1.6、「再接続を試す」min-height 52px、その下に自動再試行の時刻 1 行。
 *
 * `role="status"`（`aria-live="polite"`）にする。**`role="alert"` にしない** —
 * 接客中の読み上げを断ち切ってしまう（AC-LEDGER-18）。
 *
 * いつ時点かの時刻は**最後に成功した応答の `serverNow`**。端末の時計は読まない
 * （iPad の時計がずれた日に、台帳が黙って嘘をつく）。
 */

export type OfflineBannerProps = {
  /** 最後に成功した応答の `serverNow`。一度も読めていないときは null。 */
  lastServerNow: string | null
  /** 次に自動で試す時刻。決まっていないときは null（時刻を作らない）。 */
  nextRetryAt?: string | null
  onRetry: () => void
  /** 試している間。二度押しできないようにする。 */
  isRetrying?: boolean
}

const CANNOT_WRITE = '予約の確定・変更・ご来店の受付は、つながってからになります。'

export function OfflineBanner({
  lastServerNow,
  nextRetryAt = null,
  onRetry,
  isRetrying = false,
}: OfflineBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-none items-center gap-7 border-danger border-b-2 bg-danger-soft px-8 py-5"
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-title font-bold text-danger">通信が切れています</h2>
        <p className="mt-2 text-body text-ink">
          {lastServerNow === null ? (
            `台帳をまだ一度も読めていません。${CANNOT_WRITE}`
          ) : (
            <>
              いまご覧の内容は <b>{`${jstClock(lastServerNow)} 現在`}</b> のものです。
              {CANNOT_WRITE}
            </>
          )}
        </p>
      </div>
      <div className="flex-none text-center">
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className={`min-h-13 rounded-ctl bg-pine px-5 text-body font-semibold text-on-pine disabled:opacity-50 ${focusRingOnPine}`}
        >
          {isRetrying ? 'つなぎ直しています…' : '再接続を試す'}
        </button>
        {nextRetryAt !== null && (
          <p className="mt-2 text-grid text-ink-muted">
            {`${jstClock(nextRetryAt)} に自動でも試します`}
          </p>
        )}
      </div>
    </div>
  )
}
