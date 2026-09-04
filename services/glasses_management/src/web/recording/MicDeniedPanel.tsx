import { cn, focusRing, focusRingOnPine } from '@app/ui'
import type { ReactNode } from 'react'
import { useId } from 'react'

/*
 * マイクが使えない面（承認済みモック docs/frontend/mockups/eye/images/EX-MIC-DENIED.png）。
 *
 * 題材: お客様を待たせたまま読む知らせ。読む時間は 3 秒しかない。
 * トークン計画: 赤いカード 1 枚だけを `--color-danger`（左 6px の帯 + 見出し + 地
 *   `--color-danger-soft`）にする。残りは白と `--color-paper` の 2 段。主操作は
 *   `--color-pine` の 1 つだけ。**新しい色を足さない。**
 * シグネチャ: **失われていないものを先に言う。**できないこと（録音）→ いまも使えること →
 *   次の一手、の順で、右に直し方だけを置く。
 *
 * 実測（screens/EX-MIC-DENIED.html の <style> と assets/eye.css）:
 *   `.wrap` は `1fr 400px`（右 = w-100）。左 padding 40px 44px（px-11 py-10）、
 *   右は左辺 1px 罫 + 地 --surface + padding 40px 32px（px-8 py-10）。段の間は
 *   `.stack.lg` の 28px（gap-7）。
 *   `.lead` = `.card.warn`（角 16px / 地 --alert-tint）に左 6px の --alert。
 *   見出し 23px --alert（**句点を打たない**）、本文 16px/1.6。
 *   `.lines > div` は上罫 1px + padding 16px 0。`.st .n` は 30px の円（size-7.5）・
 *   地 --brand・文字 700 15px。`.btn.big` は min-height 56px（min-h-14）/ 18px、
 *   `.btn.quiet` は枠なしの --brand。補足は 13px の --ink-2。
 *   モックの 23px / 18px / 15px はトークンの段（--text-title 22px / --text-lead 17px /
 *   --text-body 16px）へ寄せた。
 *
 * 決め:
 *   - 許可を説明するだけの独立した画面を挟まない。使えないと分かったその場で理由と直し方を出す。
 *   - 「受付をやめる」の 2 択（入力をやめる／続ける・既定は「続ける」）は器
 *     （`booking/BookingScreen.tsx`）が既に持っている。ここでは導線だけを出し、同じ確認を二度作らない。
 *   - 右下の常駐表示（`RecordingBadge`）は**器が 1 つだけ**渡す。この面が自分で描くと
 *     「録音の印は 1 画面に 1 か所」が破れる。
 */

/**
 * 直し方の 3 手順。**端末の配り方（`design/09-open-questions.md` の Q-05）が変わったら
 * ここだけ差し替える。** いまの前提は「ホーム画面に追加した Web アプリ」で、Safari の
 * タブのまま配るなら iPadOS の「設定」に「EYE予約」が並ばないので 3 手順ごと書き直しになる。
 */
const MIC_FIX_STEPS = [
  'ホーム画面の「設定」を開く',
  '一覧から「EYE予約」を選ぶ',
  '「マイク」をオンにする',
] as const

/** いまも使えること。**できないこと 1 つに対して、できること 3 つを必ず添える。** */
const STILL_WORKS = [
  '予約を取る・変える・取り消す',
  'ここまで伺った内容（お日にち・お時間・お客様）',
  '手書きメモ',
] as const

type MicRecheckState = 'idle' | 'checking' | 'still-denied'

export type MicDeniedPanelProps = {
  /** 「録音せずに続ける」。ここまで伺った内容を保ったまま、同じ受付の続きへ戻す。 */
  onContinueWithoutRecording: () => void
  /** 「直したので、もう一度確かめる」。器が読み込み直して許可を判定し直す。 */
  onRecheck: () => void
  /** 「受付をやめる」。2 択の確認は器が出す。 */
  onAbandon: () => void
  recheck?: MicRecheckState
  /** 右下に常駐する録音の印。器が 1 つだけ渡す（この面は自分で描かない）。 */
  indicator?: ReactNode
}

const RECHECK_MESSAGE: Record<MicRecheckState, string> = {
  idle: '',
  checking: 'マイクの許可を確かめています…',
  'still-denied': 'まだマイクが使えません。上の 3 つの手順をもう一度お確かめください。',
}

export function MicDeniedPanel({
  onContinueWithoutRecording,
  onRecheck,
  onAbandon,
  recheck = 'idle',
  indicator,
}: MicDeniedPanelProps) {
  const stillId = useId()
  const howId = useId()

  /*
   * 器（`booking/BookingScreen.tsx`）の本文の枠をそのまま埋める。上のバーは器が描き、
   * この面は工程の帯を持たない（承認済みモックのとおり帯ごと差し替わる）。
   */
  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-paper lg:flex-row">
      <section className="flex min-w-0 flex-1 flex-col gap-7 px-11 py-10">
        {/*
         * 読む順は「できないこと 1 つ」→「失われていないもの」。role="alert" は
         * この 1 枚だけに置く（面の中で 2 つ鳴らすと、どちらも読み飛ばされる）。
         */}
        <div
          role="alert"
          className="rounded-panel border border-danger/30 border-l-6 border-l-danger bg-danger-soft px-5.5 py-5"
        >
          <h2 className="m-0 text-title font-bold text-danger">
            マイクが使えないため、録音できません
          </h2>
          <p className="mt-2.5 text-body leading-relaxed text-ink">
            ご予約の受付は、このまま最後まで続けられます。お客様をお待たせせずに、そのまま伺ってください。
          </p>
        </div>

        <div>
          <h3 id={stillId} className="m-0 mb-1.5 text-body font-bold text-ink">
            いまも使えます
          </h3>
          <ul aria-labelledby={stillId} className="m-0 list-none p-0">
            {STILL_WORKS.map((line) => (
              <li
                key={line}
                className="border-line border-t py-4 text-body text-ink first:border-t-0"
              >
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onContinueWithoutRecording}
              className={cn(
                'min-h-14 rounded-ctl bg-pine px-6 text-lead font-bold text-on-pine',
                focusRingOnPine,
              )}
            >
              録音せずに続ける
            </button>
            {/*
             * 確かめている間も `disabled` にしない。`disabled` を立てた瞬間に
             * フォーカスが body へ落ちて、押した指の居場所が消える。押下は
             * `onClick` の頭で握り潰す（`booking/ConfirmStep.tsx` と同じ作法）。
             */}
            <button
              type="button"
              onClick={() => {
                if (recheck === 'checking') return
                onRecheck()
              }}
              aria-busy={recheck === 'checking' ? true : undefined}
              aria-disabled={recheck === 'checking' ? true : undefined}
              className={cn(
                'min-h-14 rounded-ctl border border-line-strong bg-surface px-6 text-lead font-semibold text-ink',
                'aria-disabled:bg-surface-2 aria-disabled:text-ink-muted',
                focusRing,
              )}
            >
              直したので、もう一度確かめる
            </button>
            {/* モックの `.btn` は最小高 48px・左右 18px。触れるものの下限 44pt を上回る。 */}
            <button
              type="button"
              onClick={onAbandon}
              className={cn(
                'min-h-12 rounded-ctl px-4.5 text-body font-semibold text-pine',
                focusRing,
              )}
            >
              受付をやめる
            </button>
          </div>
          <p className="mt-3.5 text-grid text-ink-muted">
            できないのは録音だけです。この受付をあとから聞き直すことはできません。
          </p>
          <p className="mt-1.5 text-grid text-ink-muted">
            伺った日時・お客様・手書きメモは、読み込み直しても残ります。
          </p>
          {/*
           * 状態を色だけで伝えないための行。**この段のいちばん下に置く** ——
           * 上に置いて空の高さを確保すると注記がモックより 26px 下へ落ち、確保を
           * やめると出た瞬間に注記が跳ねる。下端なら押し下げる相手が居ない。
           * 器（`role="status"`）は空でも DOM に残す。文が入ってから器ごと現れると、
           * 読み上げは「新しく足された節」と「変わった知らせ」を見分けられない。
           */}
          <div role="status" className="text-body text-ink">
            {recheck !== 'idle' && <p className="mt-1.5">{RECHECK_MESSAGE[recheck]}</p>}
          </div>
        </div>
      </section>

      <aside className="w-full flex-none border-line border-t bg-surface px-8 py-10 lg:w-100 lg:border-t-0 lg:border-l">
        <h3 id={howId} className="m-0 mb-3 text-body font-bold text-ink">
          直し方　この iPad の「設定」で
        </h3>
        <ol aria-labelledby={howId} className="m-0 list-none p-0">
          {MIC_FIX_STEPS.map((step, index) => (
            <li
              key={step}
              className="flex items-baseline gap-3.5 border-line border-t py-4 first:border-t-0"
            >
              {/* 丸番号は飾り。読み上げには並びの順序だけを届ける。 */}
              <span
                aria-hidden="true"
                className="grid size-7.5 flex-none place-items-center rounded-circle bg-pine text-grid font-bold text-on-pine"
              >
                {index + 1}
              </span>
              <span className="text-body text-ink">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-7 text-grid text-ink-muted">
          オンにしたら EYE予約 に戻り、「もう一度確かめる」を押してください。
        </p>
      </aside>

      {indicator !== undefined && (
        <div data-testid="recording-indicator-slot" className="contents">
          {indicator}
        </div>
      )}
    </div>
  )
}
