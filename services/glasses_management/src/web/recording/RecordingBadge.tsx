import { cn } from '@app/ui'

/*
 * 受付中の録音の印（承認済みモック docs/frontend/mockups/eye）。**録音の状態を出す
 * 唯一の部品**で、帯の中（工程 1〜4）と面の右下（工程 5・受付・変更）の 2 形を持つ。
 *
 * 実測（assets/eye.css と screens/*.html）:
 *   `.rec`（BOOK-01-DATETIME）      = 最小高 48px・左右 14px・間 10px・角 pill・
 *                                    1px `--alert` の罫・地 `--alert-tint`・600 14px・
 *                                    点 12px・棒 6 本（幅 3px / 枠の高さ 20px）・
 *                                    時間はモノスペース 15px。並びは 点→文言→棒→時間
 *   `.rec.off`                     = 罫 `--line-strong`・地 `--surface-2`・文字 `--ink-2`・点 `--ink-3`
 *   `.rec-float`（BOOK-05-CONFIRM）= 右下 20/20・内側 12px 16px・間 12px・角 16px・
 *                                    地 白・**2px** `--alert` の罫・影 0 10px 24px・
 *                                    点 14px・文字 15px。並びは 点→文言→時間→棒
 *   `.float`（EX-MIC-DENIED / EX-UPLOAD-FAILED）
 *                                  = 右下 20/20・内側 12px 18px・間 14px・角 16px・
 *                                    地 白・**1px** `--line-strong` の罫・**影なし**・
 *                                    点 12px `--ink-3`・文言は地の色（`--ink`）・時間だけ薄い
 *
 * 決め:
 *   - **録音の印は 1 つの画面に 1 か所しか出さない**（帯か右下のどちらか）。
 *   - 状態は色に**必ず文字を添える**（`--alert` だけでは伝えない）。
 *   - 音の大きさの棒は飾りなので `aria-hidden` にし、`prefers-reduced-motion` では動かさない
 *     （`motion-safe:` を付ける）。
 *   - `role="status"` は `design/07-nfr.md` §2.3 が挙げる 7 か所のうちの 1 つ。録音が
 *     途中で止まったことを、画面を見ていなくても読み上げで受け取れるようにする（AC-REC-17）。
 */

export type RecordingBadgeState = 'recording' | 'asking' | 'off' | 'buffered'

export type RecordingBadgeProps = {
  state: RecordingBadgeState
  /** 録音の経過秒。数えていない間は `null`（`--:--`）。 */
  elapsedSeconds: number | null
  /** 帯の中（工程 1〜4）か、面の右下に常駐（工程 5 とそれ以外の面）か。 */
  placement: 'bar' | 'floating'
  /** 右下に重なる操作ボタンがある面では下端を 84px へ上げる。 */
  raised?: boolean
}

/** 状態の文言。色ではなくこれが状態の正体である。 */
const LABEL: Record<RecordingBadgeState, string> = {
  recording: '録音中',
  asking: 'マイクの許可を確かめています',
  off: '録音していません',
  buffered: '録音は端末に保管中',
}

/**
 * 経過時間。**数えていないときは時計そのものを出さない。**
 *
 * 以前は `--:--` を置いていたが、利用者には「出るはずの数字が出ていない＝壊れている」と
 * 読まれる（UX 監査 REC-04）。数えていないなら文言だけで足りる。
 */
function elapsedLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

/** 音の大きさの棒の高さ（モックの実測）。帯と右下で 1px ずつ違う。 */
const METER_BAR = ['h-1.5', 'h-3', 'h-4.5', 'h-2.25', 'h-3.5', 'h-1.25'] as const
const METER_FLOAT = ['h-1.75', 'h-3.5', 'h-5', 'h-2.75', 'h-4', 'h-1.5'] as const

export function RecordingBadge({
  state,
  elapsedSeconds,
  placement,
  raised = false,
}: RecordingBadgeProps) {
  const on = state === 'recording'
  // 数えているのは録っている間と、端末に控えを持っている間だけ。
  const counting = on || state === 'buffered'
  /*
   * 時間はモノスペース（帯も右下も同じ）。和文には等幅を使わない。
   * 右下で録っていないときだけ、文言（`--ink`）より 1 段薄い `--ink-2` にする ——
   * モックの `.float` は `<b>` が地の色を継ぎ、時間だけに色を指しているからで、
   * **薄いのは時間のほうであって文言ではない**（文言まで薄めると読みづらくなる）。
   */
  const time =
    counting && elapsedSeconds !== null ? (
      <span
        className={cn('font-mono text-body', !on && placement === 'floating' && 'text-ink-muted')}
      >
        {elapsedLabel(elapsedSeconds)}
      </span>
    ) : null
  const meter = on ? (
    <span
      data-recording-meter
      aria-hidden="true"
      className="flex h-5 items-end gap-0.5 motion-safe:animate-pulse"
    >
      {(placement === 'bar' ? METER_BAR : METER_FLOAT).map((height) => (
        <span key={height} className={cn('w-0.75 rounded-full bg-current', height)} />
      ))}
    </span>
  ) : null

  return (
    <p
      role="status"
      data-booking-recording={placement}
      className={cn(
        'flex items-center font-semibold',
        placement === 'bar'
          ? cn(
              'min-h-12 gap-2.5 rounded-full border px-3.5 text-grid',
              on ? 'border-danger bg-danger-soft' : 'border-line-strong bg-surface-2',
            )
          : cn(
              'absolute right-5 z-10 rounded-panel bg-surface py-3 text-body',
              raised ? 'bottom-21' : 'bottom-5',
              // 影を落とすのは**録っている間だけ**（モックで影を持つのは `.rec-float` で、
              // 灰の `.float` は 1px の罫だけを持つ）。録っていない印を紙から浮かせない。
              on
                ? 'gap-3 border-2 border-danger px-4 shadow-lg'
                : 'gap-3.5 border border-line-strong px-4.5',
            ),
        // 帯の消灯（`.rec.off`）は文言も時間も `--ink-2`。右下は文言だけ地の色を継ぐ。
        on ? 'text-danger' : placement === 'bar' ? 'text-ink-muted' : 'text-ink',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'shrink-0 rounded-circle',
          on && placement === 'floating' ? 'size-3.5' : 'size-3',
          on ? 'bg-danger' : 'bg-ink-faint',
        )}
      />
      {LABEL[state]}
      {/* 帯は 棒→時間、右下は 時間→棒（承認済みモックの並びがそのまま違う）。 */}
      {placement === 'bar' ? (
        <>
          {meter}
          {time}
        </>
      ) : (
        <>
          {time}
          {meter}
        </>
      )}
    </p>
  )
}
