import type { RecordingState } from '@app/contracts'
import { Button, cn, focusRing } from '@app/ui'
import { RECORDING_STATE_LABEL } from './recording'

export type MicrophonePermissionResult = 'granted' | 'denied'

/*
 * 録音の面。承認済みモックが正である。
 *
 * 予約入力中の録音は「脇の列のカード」ではない。BOOK-TIME /
 * BOOK-PURPOSE-CONFLICT / BOOK-CUSTOMER / BOOK-REPEAT の 4 枚すべてが、下部の
 * 進捗バーの右端に `● 02:14` だけを出している。説明・拒否・保存失敗は逆に、
 * 予約入力を覆う全画面の状態である（BOOK-MIC-PERMISSION / EX-MIC-DENIED /
 * EX-UPLOAD-FAILED）。
 *
 * このファイルは時計を読まない。経過秒は必ず呼び出し側から渡す。
 */

/** 下部バーの操作面。モックはここに操作を置かないので、表示だけを持つ。 */
export type RecordingIndicatorProps = {
  /** 録音を使わない受付では `null`。 */
  state: RecordingState | null
  /** 録音中の経過秒。録音していないときは `null`。 */
  elapsedSeconds: number | null
}

function mmss(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

/**
 * 下部進捗バー右端の録音表示（モック `.record`: 太字 mono・danger 色）。
 *
 * 色だけに頼らないよう、状態語は常に読み上げ可能な形で残す（AC-EYEX-115）。
 */
export function RecordingIndicator({ state, elapsedSeconds }: RecordingIndicatorProps) {
  const label = state === null ? '録音なし' : RECORDING_STATE_LABEL[state]
  const ticking = state === 'recording' && elapsedSeconds !== null
  return (
    <p
      role="status"
      aria-label="iPad録音"
      data-testid="recording-state"
      className="flex items-center justify-end gap-2 text-right font-bold font-mono text-base text-danger"
    >
      <span aria-hidden="true">●</span>
      <span className="sr-only">{label}</span>
      <span aria-hidden={ticking ? undefined : true}>{ticking ? mmss(elapsedSeconds) : label}</span>
    </p>
  )
}

/* ------------------------------------------------------------------ *
 * 全画面の状態
 * ------------------------------------------------------------------ */

const TOUCH = 'min-h-12 px-5'

/** モックの白いカード面（`.permission`）。 */
function Sheet({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={label}
      className="mx-auto mt-24 w-full max-w-2xl rounded-card border border-line bg-surface p-8"
    >
      {children}
    </section>
  )
}
/** モックの淡い副操作（`.btn.ghost`）。 */
function SecondaryButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        TOUCH,
        'rounded-ctl border border-line bg-surface font-sans font-semibold text-base text-ink',
        focusRing,
      )}
    >
      {children}
    </button>
  )
}

/** モックの赤い枠の告知（`.error-panel`）。 */
function ErrorPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-card border border-danger-line bg-danger-soft p-6 text-ink"
    >
      <p className="font-display font-semibold text-lg text-danger">{title}</p>
      {children}
    </div>
  )
}

export function RecordingUploadFailedScreen({
  upload,
  onRetryUpload,
  onOpenReservation,
}: {
  upload: { attempt: number; maxAttempts: number; lastAttemptAt: string } | null
  onRetryUpload: () => void
  onOpenReservation: () => void
}) {
  return (
    <section aria-label="予約は成立しました" className="mx-auto w-full max-w-4xl px-12 pt-10">
      <h2 className="font-display font-semibold text-2xl text-ink">予約は成立しました</h2>
      <div className="mt-6">
        <ErrorPanel title="録音を保存できていません">
          <p className="mt-3 font-sans text-base leading-relaxed">
            予約内容は登録済みです。録音は端末内の受付セッションに保持され、通信回復後に同じ送信キーで再試行します。
          </p>
          {upload && (
            <p className="mt-3 font-sans text-base">
              再試行 {upload.attempt}/{upload.maxAttempts} · 最終試行 {upload.lastAttemptAt}
            </p>
          )}
        </ErrorPanel>
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <SecondaryButton onClick={onOpenReservation}>予約詳細を見る</SecondaryButton>
        <Button className={TOUCH} onClick={onRetryUpload}>
          今すぐ再試行
        </Button>
      </div>
    </section>
  )
}
