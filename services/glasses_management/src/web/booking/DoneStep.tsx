import { toJstDateString } from '@app/shared'
import { focusRing, focusRingOnPine } from '@app/ui'
import type { ReactNode } from 'react'
import { dateLabel, jstClock } from '../ledger/metrics'
import { formatPhoneDigits } from './CustomerStep'

/*
 * 予約が取れた（承認済みモック docs/frontend/mockups/eye/images/BOOK-06-DONE.png）。
 *
 * この面の仕事は「取れたことを一目で伝え、番号・内容・お伝えごとを同じ面に置く」こと。
 *
 * 実測値（screens/BOOK-06-DONE.html と assets/eye.css）:
 *   **stepbar を持たない**。左 1fr ／ 右 372px（`w-93`）、余白 40px 44px ／ 40px 28px。
 *   ✓ の丸は 78px（`size-19.5`）、見出し 30px、予約番号 22px のモノスペース。
 *   要約は 2 列（`dd` 19px/600）。「続けて予約を取る」「台帳で見る」は上に 40px。
 *   右は 3 点のお伝えごと（1 行 18px 上下・下に 1px の罫）。
 *
 * **控えを送らない。**notifier はメールだけを送り、`to` はメールアドレス型なので、
 * お電話番号へ控えを送る手立てが無い（`design/04-api.md` §7）。モックの
 * 「控えは 090-1234-5678 へお送りしました。」は採らず、代わりに予約番号をお伝えいただく
 * 1 行を置く（AC-BOOK-13）。
 */

/** 何分前にお越しいただくか。お伝えごとの 1 点目に出す。 */
const ARRIVE_BEFORE_MINUTES = 10
const MS_PER_MINUTE = 60_000

type BookedReservation = {
  code: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  /** 工程 2 で押した札と同じ店内の名前（`visit_purposes.name_internal`）。 */
  purposeLabel: string
  customerName: string
  /** 数字だけのお電話番号。伺えなかったときは空文字。 */
  phoneDigits: string
  staffName: string | null
  equipmentNames: readonly string[]
}

type DoneStepPhase = 'loading' | 'ready' | 'error' | 'forbidden'

export type DoneStepProps = {
  reservation: BookedReservation
  onBookAgain: () => void
  onOpenLedger: () => void
  phase?: DoneStepPhase
  isOffline?: boolean
  /**
   * 手書きのご要望のうち、残せなかった枚数。0 なら何も出さない。
   * **黙って捨てない** —— 書いた本人は残ったと思っているので、残らなかったことは
   * この面で言う（実装不足の洗い出し booking-02）。
   */
  handwritingLeft?: number
}

/** 「8月27日（木）」。年をまたぐ知らせは出さないので年を落とす。 */
function monthDayLabel(instant: string): string {
  return dateLabel(toJstDateString(instant)).replace(/^\d+年/, '')
}

function Cell({ term, value, note }: { term: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div>
      <dt className="text-note text-ink-muted">{term}</dt>
      <dd
        className="mt-0.5 m-0 font-semibold text-ink"
        style={{ fontSize: 'calc(var(--spacing) * 4.75)' }}
      >
        <span>{value}</span>
        {note !== undefined && note !== '' && (
          <small className="block text-grid font-normal text-ink-muted">{note}</small>
        )}
      </dd>
    </div>
  )
}

export function DoneStep({
  reservation,
  onBookAgain,
  onOpenLedger,
  phase = 'ready',
  isOffline = false,
  handwritingLeft = 0,
}: DoneStepProps) {
  if (phase === 'loading') {
    return (
      <div className="px-11 py-10">
        <p role="status" className="text-body text-ink-muted">
          ご予約を読み込んでいます…
        </p>
      </div>
    )
  }

  if (phase === 'forbidden' || phase === 'error') {
    return (
      <div className="px-11 py-10">
        <p
          role="alert"
          className="max-w-175 rounded-panel border border-line bg-surface px-5.5 py-5 text-lead text-ink"
        >
          {phase === 'forbidden'
            ? 'この画面は店長だけがご覧になれます'
            : 'ご予約は承っています。この面を読み込めませんでした。台帳でお確かめください。'}
        </p>
      </div>
    )
  }

  const arriveAt = new Date(
    Date.parse(reservation.startsAt) - ARRIVE_BEFORE_MINUTES * MS_PER_MINUTE,
  ).toISOString()

  return (
    <div className="flex h-full w-full min-h-0">
      <section className="min-w-0 flex-1 overflow-hidden px-11 py-10">
        <div className="flex items-center gap-5">
          <span
            aria-hidden="true"
            className="grid size-19.5 shrink-0 place-items-center rounded-full bg-pine text-hero text-on-pine"
          >
            ✓
          </span>
          <div>
            <h2
              className="m-0 font-semibold text-ink"
              style={{ fontSize: 'calc(var(--spacing) * 7.5)' }}
            >
              ご予約を承りました
            </h2>
            <p className="mt-1 text-body text-ink-muted">
              予約番号
              <b className="ml-2 font-mono text-title font-bold text-ink">{reservation.code}</b>
            </p>
          </div>
        </div>

        {isOffline && (
          <p
            role="status"
            className="mt-6 rounded-card border border-line-strong bg-surface-2 px-4 py-3 text-body text-ink"
          >
            通信が切れています。ご予約は承っています。
          </p>
        )}

        {handwritingLeft > 0 && (
          <p
            role="status"
            className="mt-6 rounded-card border border-amber bg-amber-soft px-4 py-3 text-body text-ink"
          >
            {`手書きのご要望 ${handwritingLeft}枚は残せませんでした。お客様が決まっていないと置き場所がありません。顧客台帳でこの方を登録してから、もう一度お書きください。`}
          </p>
        )}

        <section aria-label="ご予約の内容">
          <dl className="mt-10 grid grid-cols-2 gap-x-8 gap-y-7">
            <Cell
              term="ご来店日時"
              value={`${monthDayLabel(reservation.startsAt)}${jstClock(reservation.startsAt)} 〜 ${jstClock(reservation.endsAt)}`}
            />
            <Cell
              term="ご来店の目的"
              value={reservation.purposeLabel}
              note={`約${reservation.durationMinutes}分`}
            />
            <Cell
              term="お客様"
              value={`${reservation.customerName} 様`}
              note={
                reservation.phoneDigits === ''
                  ? 'お電話番号は伺っていません'
                  : formatPhoneDigits(reservation.phoneDigits)
              }
            />
            <Cell
              term="担当と場所"
              value={reservation.staffName ?? '決めてください'}
              note={
                reservation.equipmentNames.length === 0
                  ? 'あとで決める'
                  : reservation.equipmentNames.join(' ／ ')
              }
            />
          </dl>
        </section>

        <fieldset aria-label="次の一手" className="mt-10 flex min-w-0 gap-3.5">
          <button
            type="button"
            onClick={onBookAgain}
            className={`min-h-14 rounded-card border border-pine bg-pine px-6 text-lead font-semibold text-on-pine ${focusRingOnPine}`}
          >
            続けて予約を取る
          </button>
          <button
            type="button"
            onClick={onOpenLedger}
            className={`min-h-14 rounded-card border border-line-strong bg-surface px-6 text-lead font-semibold text-ink ${focusRing}`}
          >
            台帳で見る
          </button>
        </fieldset>
      </section>

      <aside className="w-93 shrink-0 border-line border-l bg-surface px-7 py-10">
        <h3 className="m-0 mb-1 text-body font-semibold text-ink">お客様にお伝えすること</h3>
        <ul aria-label="お客様にお伝えすること" className="m-0 list-none p-0">
          {[
            `${ARRIVE_BEFORE_MINUTES}分前、${jstClock(arriveAt)} ごろのお越しでお願いします`,
            '今お使いのメガネをお持ちください',
            'ご変更・お取り消しはお電話で承ります',
          ].map((line) => (
            <li
              key={line}
              className="flex items-start gap-3 border-line border-b py-4.5 last:border-b-0"
            >
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center rounded-ctl border border-pine-line bg-pine-soft text-note font-bold text-pine-deep"
              >
                ✓
              </span>
              <span className="text-body text-ink leading-normal">{line}</span>
            </li>
          ))}
        </ul>
        {/* 控えは送らない（notifier はメールだけ）。番号をお伝えいただく道を残す。 */}
        <p className="mt-8 text-grid text-ink-muted">
          {`予約番号 ${reservation.code} をお控えいただくようお伝えください`}
        </p>
      </aside>
    </div>
  )
}
