import { toJstDateString } from '@app/shared'
import { cn, focusRing, focusRingOnPine } from '@app/ui'
import { type ReactNode, useId } from 'react'
import { shortDate } from '../booking/SlotStep'
import { jstClock } from '../ledger/metrics'
import { recordingLength } from './RecordingPlayer'

/*
 * 録音の保存に失敗した面（承認済みモック
 * docs/frontend/mockups/eyex/images/EX-UPLOAD-FAILED.png）。
 *
 * 題材: お客様を待たせたまま読む知らせ。読む時間は 3 秒しかない。
 * トークン計画: 赤いカード 1 枚だけを `--color-danger`（左 6px の帯 + 見出し + 地
 *   `--color-danger-soft`）にする。残りは白と `--color-paper` の 2 段。主操作は
 *   `--color-pine` の 1 つだけ。**新しい色を足さない。**
 * シグネチャ: **失われていないものを先に言う。**成立が上、失敗が下、次の一手が最後。
 *   予約と録音は別々のことだと、読む順そのもので示す。
 *
 * 実測（screens/EX-UPLOAD-FAILED.html の <style>）:
 *   `.wrap` は `1fr 372px`（右 = w-93）。左 padding 40px 44px（px-11 py-10）、
 *   右は左辺 1px 罫 + 地 --surface + padding 40px 32px（px-8 py-10）。
 *   `.head .mark` は 60px の円（size-15）・地 --brand。見出し 23px、副文 13px、
 *   予約番号は等幅 700 16px。`.lead` は左 6px の --alert・見出し 16px --alert・本文 16px/1.6。
 *   `.sum dt` 13px --ink-2（上に 22px）／`.sum dd` 16px 600。
 *   モックの 23px はトークンの段（--text-title 22px）へ寄せた。
 *
 * 決め:
 *   - 描くのは**成立予約の 1 状態だけ**。破棄受付の言い換え（「受付の記録は残っています。」）は
 *     お知らせの本文の担当（`domain/recording.ts` の `uploadFailedAlert`）で、面には出さない。
 *   - 右下の常駐表示（`RecordingBadge` の「録音は端末に保管中　03:24」）は**器が 1 つだけ**渡す。
 *   - 「もう一度送る」を押しても駄目だったときは、端末に残っていることを言い直す。
 *     謝るだけの文を置かない。
 */

type UploadFailedRetryState = 'idle' | 'sending' | 'failed'

export type UploadFailedPanelProps = {
  /** 確定したご予約。右の 4 項目と、左の予約番号に使う。 */
  reservation: {
    code: string
    startsAt: string
    endsAt: string
    purposeLabel: string
    customerName: string | null
    staffName: string | null
    equipmentNames: readonly string[]
  }
  /** 送れなかった録音の長さ（秒）。分からないときは本文から括弧ごと落とす。 */
  durationSeconds: number | null
  /** 次に自動で送り直す時刻（ISO）。分からないときはその一句を出さない。 */
  nextAttemptAt: string | null
  onContinue: () => void
  onRetry: () => void
  retry?: UploadFailedRetryState
  /** 右下に常駐する録音の印。器が 1 つだけ渡す（この面は自分で描かない）。 */
  indicator?: ReactNode
}

const RETRY_MESSAGE: Record<UploadFailedRetryState, string> = {
  idle: '',
  sending: '録音を送っています…',
  failed: '送れませんでした。録音はこの iPad に残っています。',
}

export function UploadFailedPanel({
  reservation,
  durationSeconds,
  nextAttemptAt,
  onContinue,
  onRetry,
  retry = 'idle',
  indicator,
}: UploadFailedPanelProps) {
  const when = `${shortDate(toJstDateString(reservation.startsAt))}${jstClock(reservation.startsAt)} 〜 ${jstClock(reservation.endsAt)}`
  const who =
    reservation.customerName === null
      ? 'お客様のお名前は伺っていません'
      : `${reservation.customerName} 様`
  const staff = reservation.staffName ?? '担当が未定'
  const where =
    reservation.equipmentNames.length === 0
      ? staff
      : `${staff}／${reservation.equipmentNames.join('・')}`
  const length = durationSeconds === null ? '' : `（${recordingLength(durationSeconds)}）`
  const summaryId = useId()

  /*
   * 器（`booking/BookingScreen.tsx`）の本文の枠をそのまま埋める。上のバーは器が描き、
   * この面は工程の帯を持たない（承認済みモックのとおり帯ごと差し替わる）。
   */
  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-paper lg:flex-row">
      <section className="flex min-w-0 flex-1 flex-col gap-7 px-11 py-10">
        {/*
         * **読み上げも成功から始める。**`role="alert"` を失敗の本文だけに付けると、
         * 画面では成功が上にあるのに耳では失敗が先に届き、この面の言い分（失われて
         * いないものを先に言う）が画面と逆になる。2 枚をまとめて 1 つの知らせにする。
         */}
        <div role="alert" className="flex flex-col gap-7">
          {/* 成功が上。失われていないものを、失敗より先に読ませる。 */}
          <div className="flex items-center gap-4.5">
            <span
              aria-hidden="true"
              className="grid size-15 flex-none place-items-center rounded-circle bg-pine text-title text-on-pine"
            >
              ✓
            </span>
            <div className="min-w-0">
              <h2 className="m-0 text-title font-bold text-ink">ご予約は確定しています</h2>
              <p className="mt-1 text-grid text-ink-muted">
                予約番号
                <b className="ml-1.5 font-mono text-body font-bold text-ink">{reservation.code}</b>
                <span className="ml-3">台帳にも入っています</span>
              </p>
            </div>
          </div>

          {/* 失敗は下。**録音だけ**であることを見出しで言い切る。 */}
          <div className="rounded-panel border border-danger/30 border-l-6 border-l-danger bg-danger-soft px-5.5 py-5">
            <h3 className="m-0 text-body font-bold text-danger">
              保存できなかったのは、この受付の録音だけです
            </h3>
            <p className="mt-2 text-body leading-relaxed text-ink">
              {`店内の通信が弱く、録音${length}をお店の保管庫へ送れませんでした。録音は、この iPad の中に残っています。`}
            </p>
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onContinue}
              className={cn(
                'min-h-14 rounded-ctl bg-pine px-6 text-lead font-bold text-on-pine',
                focusRingOnPine,
              )}
            >
              このまま続ける
            </button>
            {/*
             * 送っている間も `disabled` にしない。`disabled` を立てた瞬間に
             * フォーカスが body へ落ちて、押した指の居場所が消える。押下は
             * `onClick` の頭で握り潰す（`booking/ConfirmStep.tsx` と同じ作法）。
             */}
            <button
              type="button"
              onClick={() => {
                if (retry === 'sending') return
                onRetry()
              }}
              aria-busy={retry === 'sending' ? true : undefined}
              aria-disabled={retry === 'sending' ? true : undefined}
              className={cn(
                'min-h-14 rounded-ctl border border-line-strong bg-surface px-6 text-lead font-semibold text-ink',
                'aria-disabled:bg-surface-2 aria-disabled:text-ink-muted',
                focusRing,
              )}
            >
              もう一度送る
            </button>
          </div>
          {nextAttemptAt !== null && (
            <p className="mt-3.5 text-grid text-ink-muted">
              {`${jstClock(nextAttemptAt)} に自動でもう一度送ります。操作は要りません。`}
            </p>
          )}
          {/*
           * 送っている最中と送れなかったことを読み上げへ届ける器。**この段のいちばん
           * 下に置く** —— 上で空の高さを確保すると「11:20 に自動で…」がモックより
           * 26px 下へ落ちる。下端なら確保をやめても押し下げる相手が居ない。
           * 器は空でも DOM に残す（文が入ってから器ごと現れると読み上げが取り逃がす）。
           */}
          <div role="status" className="text-body text-ink">
            {retry !== 'idle' && <p className="mt-1.5">{RETRY_MESSAGE[retry]}</p>}
          </div>
        </div>
      </section>

      {/* 右の 4 項目は本文の脇に添える一枚（暗黙の complementary）。見出しで名前を付ける。 */}
      <aside
        aria-labelledby={summaryId}
        className="w-full flex-none border-line border-t bg-surface px-8 py-10 lg:w-93 lg:border-t-0 lg:border-l"
      >
        <h3 id={summaryId} className="m-0 text-body font-bold text-ink">
          確定したご予約
        </h3>
        {/* 見出しと 1 項目目の間はモックの `.side h3` どおり 4px（`.sum dt:first-of-type` は 0）。 */}
        <dl className="m-0 mt-1">
          <dt className="text-grid text-ink-muted">ご来店日時</dt>
          <dd className="m-0 mt-0.5 text-body font-semibold text-ink">{when}</dd>
          <dt className="mt-5.5 text-grid text-ink-muted">ご来店の目的</dt>
          <dd className="m-0 mt-0.5 text-body font-semibold text-ink">
            {reservation.purposeLabel}
          </dd>
          <dt className="mt-5.5 text-grid text-ink-muted">お客様</dt>
          <dd className="m-0 mt-0.5 text-body font-semibold text-ink">{who}</dd>
          <dt className="mt-5.5 text-grid text-ink-muted">担当と場所</dt>
          <dd className="m-0 mt-0.5 text-body font-semibold text-ink">{where}</dd>
        </dl>
      </aside>

      {indicator !== undefined && (
        <div data-testid="recording-indicator-slot" className="contents">
          {indicator}
        </div>
      )}
    </div>
  )
}
