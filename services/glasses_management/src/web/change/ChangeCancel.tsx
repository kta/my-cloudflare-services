import { toJstDateString } from '@app/shared'
import { cn, focusRing, focusRingOnPine } from '@app/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { formatPhoneDigits } from '../booking/CustomerStep'
import { dateLabel, jstClock } from '../ledger/metrics'

/*
 * 予約の取り消し（承認済みモック docs/frontend/mockups/eyex/images/CHANGE-CANCEL.png）。
 *
 * この面の仕事は「取り消しは戻せない」ことを先に読ませ、理由を 1 つ選ぶまで実行させないこと。
 * 既定の操作は「取り消さずに戻る」— 面に入った直後の焦点もそこに置き、そのボタンから
 * 「この予約を取り消します」「まだ取り消していません」が読めるように結ぶ（AC-CHANGE-21）。
 *
 * 実測（screens/CHANGE-CANCEL.html の <style> と assets/eyex.css）:
 *   .cancel  = padding 36px 44px。h2 18px ＋ 補足 13px（左に 10px）
 *   .target  = --alert-tint の 4 列（250px 1fr 1fr 1fr）・gap 20px・padding 22px 24px
 *              左は 24px/1.3 の日時 ＋ 13px の「所要 60分」、右 3 つは dt 12px / dd 17px/600 ＋ 補足 13px
 *   予告の 1 行 = 上に 14px の 13px
 *   .reasons = 4 列・gap 12px・min-height 96px・padding 16px 18px・18px/600 ＋ 補足 13px/1.4
 *              選択中は 3px の --brand の縁 ＋ --brand-tint（padding を 14px 16px に詰める）
 *   .foot    = 上に 24px、gap 16px。左が .btn.primary.big（56px）、右が .btn.danger.big
 *
 * **モックの「お客様のご都合＝選択中」を採らない。**既定で 1 つ選んでおくと、店舗都合や
 * 重複の取り消しが押し間違いでお客様都合として残り、分析の内訳が実態とずれる。
 * 選ばれていることは色ではなく札の中の「選択中」の文字で伝える（モックと同じ語）。
 */

/** `ReservationCancelInput.reason` の 4 値。`no_show` だけが「ご来店がなかった」。 */
export type CancelReason = 'customer' | 'store' | 'duplicate' | 'no_show'

const REASONS: readonly { value: CancelReason; label: string; note: string }[] = [
  { value: 'customer', label: 'お客様のご都合', note: 'お客様からのお申し出' },
  { value: 'store', label: '店舗の都合', note: '担当者や設備の不足' },
  { value: 'duplicate', label: '予約の重複', note: '同じ内容が二重' },
  { value: 'no_show', label: 'ご来店がなかった', note: '当日いらっしゃらず' },
]

/** 読み込み中 / 見つからない（空）/ エラー / 権限なし。ready 以外は取り消しの操作を出さない。 */
type ChangeCancelPhase = 'loading' | 'ready' | 'notFound' | 'error' | 'forbidden'

const PHASE_MESSAGE: Record<Exclude<ChangeCancelPhase, 'ready'>, string> = {
  loading: 'ご予約を読み込んでいます…',
  notFound: 'このご予約は見つかりませんでした。もう一度お探しください。',
  error: 'ご予約を読み込めませんでした。画面を開き直してください。',
  forbidden: 'ご予約を取り消す権限がありません。お店の管理者にご確認ください。',
}

type CancelTarget = {
  code: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  customerName: string | null
  visitCount: number | null
  /** 数字だけのお電話番号。伺えていなければ空文字。 */
  phoneDigits: string
  purposeLabel: string
  purposeNote: string
  staffName: string | null
  equipmentNames: readonly string[]
}

type ChangeCancelProps = {
  target: CancelTarget
  onBack: () => void
  onCancel: (reason: CancelReason) => void
  phase?: ChangeCancelPhase
  isOffline?: boolean
}

/** 「8月27日（木）」。年をまたぐ知らせは出さないので年を落とす。 */
function monthDayLabel(instant: string): string {
  return dateLabel(toJstDateString(instant)).replace(/^\d+年/, '')
}

function Fact({ term, value, note }: { term: string; value: string; note: string }) {
  return (
    <dl className="m-0">
      <dt className="text-note text-ink-muted">{term}</dt>
      <dd className="m-0 mt-0.5 text-lead font-semibold text-ink">
        {value}
        <small className="block text-grid font-normal text-ink-muted">{note}</small>
      </dd>
    </dl>
  )
}

export function ChangeCancel({
  target,
  onBack,
  onCancel,
  phase = 'ready',
  isOffline = false,
}: ChangeCancelProps) {
  const [reason, setReason] = useState<CancelReason | null>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  const noticeId = useId()
  const group = useId()

  // 危険な面に入ったら、まず安全な出口へ焦点を置く（AC-CHANGE-21）。
  useEffect(() => {
    backRef.current?.focus()
  }, [])

  if (phase !== 'ready') {
    return (
      <p
        role={phase === 'loading' ? 'status' : 'alert'}
        className="px-11 py-9 text-body text-ink-muted"
      >
        {PHASE_MESSAGE[phase]}
      </p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-11 py-9">
      {/* 見出しの読み上げ名に補足を混ぜない。補足は横に並べ、id で戻るボタンへ結ぶ。 */}
      <div className="mb-4 flex items-baseline gap-2.5">
        <h2
          id={headingId}
          className="m-0 font-semibold text-ink"
          style={{ fontSize: 'calc(var(--spacing) * 4.5)' }}
        >
          この予約を取り消します
        </h2>
        <span id={noticeId} className="text-grid text-ink-muted">
          まだ取り消していません
        </span>
      </div>

      {/* `role="group"` は `<fieldset>` で表す（biome の useSemanticElements と、
          既に出荷済みの `DoneStep` の書き方に揃える）。 */}
      <fieldset
        aria-label="取り消すご予約"
        className="m-0 grid min-w-0 items-center gap-5 rounded-panel border border-danger/40 bg-danger-soft px-6 py-5.5"
        style={{ gridTemplateColumns: 'calc(var(--spacing) * 62.5) 1fr 1fr 1fr' }}
      >
        <div>
          <p
            className="m-0 font-semibold text-ink leading-tight"
            style={{ fontSize: 'calc(var(--spacing) * 6)' }}
          >
            {monthDayLabel(target.startsAt)}
            <br />
            {`${jstClock(target.startsAt)}–${jstClock(target.endsAt)}`}
          </p>
          <p className="m-0 mt-1 text-grid text-ink-muted">{`所要 ${target.durationMinutes}分`}</p>
        </div>

        <dl className="m-0">
          <dt className="text-note text-ink-muted">お客様</dt>
          <dd className="m-0 mt-0.5 text-lead font-semibold text-ink">
            <span className="inline-flex items-center gap-2">
              {target.customerName === null ? 'お客様は未登録です' : `${target.customerName} 様`}
              {target.visitCount !== null && (
                <span className="inline-flex h-5.5 min-w-7.5 items-center justify-center rounded-full border border-pine-line bg-pine-soft px-2 text-note font-semibold text-pine-deep">
                  {`${target.visitCount}回目`}
                </span>
              )}
            </span>
            <small className="block text-grid font-normal text-ink-muted">
              {target.phoneDigits === ''
                ? 'お電話番号は伺っていません'
                : formatPhoneDigits(target.phoneDigits)}
            </small>
          </dd>
        </dl>

        <Fact term="ご用件" value={target.purposeLabel} note={target.purposeNote} />
        <Fact
          term="担当と場所"
          value={target.staffName ?? '担当が未定'}
          note={
            target.equipmentNames.length === 0
              ? '場所は決まっていません'
              : target.equipmentNames.join('／')
          }
        />
      </fieldset>

      <p className="mt-3.5 text-grid text-ink-muted">
        取り消すと、この枠はすぐほかのお客様にご案内できる状態になります。
      </p>

      <div className="mt-9 mb-4 flex items-baseline gap-2.5">
        <h2
          className="m-0 font-semibold text-ink"
          style={{ fontSize: 'calc(var(--spacing) * 4.5)' }}
        >
          取り消しの理由をお選びください
        </h2>
        <span className="text-grid text-ink-muted">受付履歴と分析に残ります</span>
      </div>

      <fieldset aria-label="取り消しの理由" className="m-0 grid grid-cols-4 gap-3 border-0 p-0">
        {REASONS.map((choice) => {
          const chosen = reason === choice.value
          return (
            <label
              key={choice.value}
              className={cn(
                'flex min-h-24 cursor-pointer flex-col justify-center rounded-card bg-surface text-left',
                chosen
                  ? 'border-3 border-pine bg-pine-soft px-4 py-3.5 text-pine-deep'
                  : 'border border-line-strong px-4.5 py-4 text-ink',
                'focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus',
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={group}
                aria-label={choice.label}
                checked={chosen}
                onChange={() => setReason(choice.value)}
              />
              <span className="font-semibold" style={{ fontSize: 'calc(var(--spacing) * 4.5)' }}>
                {choice.label}
              </span>
              <small
                className={cn(
                  'mt-1.5 block text-grid font-normal leading-snug',
                  chosen ? 'text-pine-deep' : 'text-ink-muted',
                )}
              >
                {chosen ? '選択中' : choice.note}
              </small>
            </label>
          )
        })}
      </fieldset>

      <fieldset
        aria-label="取り消しの出口"
        className="m-0 mt-auto flex min-w-0 items-center gap-4 border-0 p-0 pt-6"
      >
        <button
          ref={backRef}
          type="button"
          onClick={onBack}
          aria-describedby={`${headingId} ${noticeId}`}
          className={cn(
            'min-h-14 shrink-0 rounded-card border border-pine bg-pine px-6 text-lead font-semibold text-on-pine',
            focusRingOnPine,
          )}
        >
          取り消さずに戻る
        </button>
        <p className="m-0 text-grid text-danger">
          お客様にお伝えしてから取り消してください。取り消した予約は元に戻せません。
        </p>
        <button
          type="button"
          disabled={reason === null || isOffline}
          aria-label={
            isOffline
              ? 'この予約を取り消す（通信が戻ると押せます）'
              : reason === null
                ? 'この予約を取り消す（取り消しの理由を選ぶと押せます）'
                : 'この予約を取り消す'
          }
          onClick={() => {
            if (reason !== null) onCancel(reason)
          }}
          className={cn(
            'ml-auto min-h-14 shrink-0 rounded-card border px-6 text-lead font-semibold',
            reason === null
              ? 'border-line bg-surface-2 text-ink-faint'
              : 'border-danger bg-surface text-danger',
            focusRing,
          )}
        >
          この予約を取り消す
        </button>
      </fieldset>
    </div>
  )
}
