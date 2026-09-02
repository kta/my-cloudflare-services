import { focusRingOnPine } from '@app/ui'

export type OfflineBandProps = {
  /** 最後に成功した応答の表示済み JST 時刻。端末時計を読ませない。 */
  lastSyncedLabel: string | null
  /** 次回自動試行の表示済み JST 時刻。未定なら null。 */
  nextRetryLabel?: string | null
  onRetry: () => void
  isRetrying?: boolean
}

const CANNOT_WRITE = '予約の確定・変更・ご来店の受付は、つながってからになります。'

/** 通信断中も読むことは続けられることを伝える、Shell 共通の非割込み帯。 */
export function OfflineBand({
  lastSyncedLabel,
  nextRetryLabel = null,
  onRetry,
  isRetrying = false,
}: OfflineBandProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-none items-center gap-7 border-danger border-b-2 bg-danger-soft px-8 py-5"
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-title font-bold text-danger">通信が切れています</h2>
        <p className="mt-2 text-body text-ink">
          {lastSyncedLabel === null ? (
            `台帳をまだ一度も読めていません。${CANNOT_WRITE}`
          ) : (
            <>
              いまご覧の内容は <b>{`${lastSyncedLabel} 現在`}</b> のものです。{CANNOT_WRITE}
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
        {nextRetryLabel !== null && (
          <p className="mt-2 text-grid text-ink-muted">{`${nextRetryLabel} に自動でも試します`}</p>
        )}
      </div>
    </div>
  )
}
