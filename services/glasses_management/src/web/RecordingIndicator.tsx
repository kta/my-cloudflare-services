import type { RecordingState } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { FlowButton, RailSummary, RecordIndicator } from './design/booking'
import { Action } from './design/controls'
import { formatJstTime } from './ReservationSearchScreen'
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
  /** 読み上げ上の名前。脇の列が `iPad録音` を名乗る面ではそちらへ譲る。 */
  name?: string
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
export function RecordingIndicator({ state, elapsedSeconds, name }: RecordingIndicatorProps) {
  const label = state === null ? '録音なし' : RECORDING_STATE_LABEL[state]
  const ticking = state === 'recording' && elapsedSeconds !== null
  // 見た目はモックの `.record` そのもの。ここは「何を出すか」だけを決める。
  return (
    <RecordIndicator
      label={label}
      name={name}
      elapsed={ticking ? mmss(elapsedSeconds) : undefined}
    />
  )
}

/* ------------------------------------------------------------------ *
 * 予約フローの脇の列に立つ録音の面
 * ------------------------------------------------------------------ */

/*
 * 承認済みモックの BOOK-MIC-PERMISSION / EX-MIC-DENIED は全画面の同意面だが、
 * 電話を受けた直後に開く画面をそれで塞ぐと受付そのものが止まる。説明・権限
 * 要求・回復・保存失敗は、予約入力の列を取らない脇の列（390px のレール）へ
 * 置き、下部バーの `● mm:ss` はモックどおり残す（UC-EYEX-033 / AC-EYEX-113 /
 * AC-EYEX-114 / UC-EYEX-034 / AC-EYEX-05）。
 *
 * この面は時計を読まず、`navigator` にも触れない。権限は呼び出し側が注入した
 * 関数だけが要求する。
 */
export type BookingRecordingRailProps = {
  state: RecordingState
  /** ブラウザに拒否された後か。まだ一度も要求していない間は false。 */
  denied: boolean
  /** 要求の往復中。二重に押せないようにするためだけに使う。 */
  requesting: boolean
  onStart: () => void
  /** 「今回は録音せず続ける」「録音なしで続ける」。面ごと畳む。 */
  onDecline: () => void
  onRetryUpload: () => void
}

/** 説明の 1 行。レールの中なので `text-note`（下部バーと同じ小さい方）。 */
function RailNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 font-sans text-ink text-note">{children}</p>
}

export function BookingRecordingRail({
  state,
  denied,
  requesting,
  onStart,
  onDecline,
  onRetryUpload,
}: BookingRecordingRailProps) {
  return (
    <RailSummary live label="iPad録音">
      {/* 状態は色ではなく語で名乗る（AC-EYEX-115）。 */}
      <b className="block font-bold font-sans text-body text-ink">{RECORDING_STATE_LABEL[state]}</b>

      {state === 'permission_check' && !denied && (
        <>
          {/* 何のために録り、誰が聞き、最低どれだけ残すか（AC-EYEX-113）。 */}
          <RailNote>予約内容の復唱を、聞き間違いの確認のために記録します。</RailNote>
          <RailNote>再生できるのは選択中の店舗で録音を扱えるスタッフだけです。</RailNote>
          <RailNote>
            成立した予約の録音は録音完了から最低30日、破棄した受付の録音は録音終了から最低24時間保持します。
          </RailNote>
          <div className="mt-3.5 flex flex-col gap-2">
            {/* ブラウザの権限は、この操作でだけ開く。 */}
            <FlowButton primary disabled={requesting} onClick={onStart}>
              録音を開始する
            </FlowButton>
            <FlowButton onClick={onDecline}>今回は録音せず続ける</FlowButton>
          </div>
        </>
      )}

      {state === 'permission_check' && denied && (
        <>
          {/* どこで許可し直すかを、機種と手順で言い切る（AC-EYEX-114）。 */}
          <RailNote>
            Safariでマイクが許可されていません。iPadの「設定」→「Safari」→「マイク」でEYEX予約へのアクセスを許可してから、もう一度お試しください。
          </RailNote>
          <RailNote>この店舗では録音なしで予約受付を続けられます。</RailNote>
          <div className="mt-3.5 flex flex-col gap-2">
            <FlowButton primary disabled={requesting} onClick={onStart}>
              権限を再確認する
            </FlowButton>
            <FlowButton onClick={onDecline}>録音なしで続ける</FlowButton>
          </div>
        </>
      )}

      {/* 録音中は説明も操作も畳み、状態だけを残す（AC-EYEX-05）。 */}
      {state === 'stored' && (
        <RailNote>保存済みです。予約詳細または受付履歴から再生できます。</RailNote>
      )}

      {state === 'failed' && (
        <>
          {/* 予約が確定していない段階でも見え、予約入力への影響が無いことを言う
              （UC-EYEX-034）。 */}
          <RailNote>録音を保存できていません。予約内容には影響しません。</RailNote>
          <div className="mt-3.5 flex flex-col gap-2">
            <FlowButton primary onClick={onRetryUpload}>
              今すぐ再試行
            </FlowButton>
          </div>
        </>
      )}
    </RailSummary>
  )
}

/* ------------------------------------------------------------------ *
 * 全画面の状態
 * ------------------------------------------------------------------ */

const TOUCH = 'min-h-12 px-5'

/** モックの白いカード面（`.permission`）。 */
function _Sheet({ label, children }: { label: string; children: React.ReactNode }) {
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
      <p className="font-sans font-semibold text-lg text-danger">{title}</p>
      {children}
    </div>
  )
}

export function RecordingUploadFailedScreen({
  upload,
  onRetryUpload,
  onOpenReservation,
}: {
  /** `lastAttemptAt` は保存されているインスタント。画面には JST の時刻で出す。 */
  upload: { attempt: number; maxAttempts: number; lastAttemptAt: string } | null
  onRetryUpload: () => void
  onOpenReservation: () => void
}) {
  return (
    <section aria-label="予約は成立しました" className="mx-auto w-full max-w-4xl px-12 pt-10">
      <h2 className="font-sans font-semibold text-2xl text-ink">予約は成立しました</h2>
      <div className="mt-6">
        <ErrorPanel title="録音を保存できていません">
          <p className="mt-3 font-sans text-base leading-relaxed">
            予約内容は登録済みです。録音は端末内の受付セッションに保持され、通信回復後に同じ送信キーで再試行します。
          </p>
          {upload && (
            <p className="mt-3 font-sans text-base">
              再試行 {upload.attempt}/{upload.maxAttempts} · 最終試行{' '}
              {formatJstTime(upload.lastAttemptAt)}
            </p>
          )}
        </ErrorPanel>
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <SecondaryButton onClick={onOpenReservation}>予約詳細を見る</SecondaryButton>
        {/* 主操作は緑の面。寸法は全画面状態の 48px（`size="roomy"`）。 */}
        <Action variant="primary" size="roomy" onClick={onRetryUpload}>
          今すぐ再試行
        </Action>
      </div>
    </section>
  )
}
