import type { LocalDate } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { type ReactNode, useEffect, useState } from 'react'
import { jstClock } from '../ledger/metrics'
import { shortDate } from './SlotStep'
import type { StepGuard } from './steps'

/*
 * 枠が先に埋まっていた面（承認済みモック docs/frontend/mockups/eyex/images/BOOK-CONFLICT.png）。
 *
 * 題材: 確定を押した瞬間に枠を取られた人へ、**失われていないもの**を先に言う面。
 * トークン計画: 赤は上の 1 枚だけ。代わりの時刻の札は白のままにして、赤を選択肢へ広げない。
 * シグネチャ: 右の要約で埋まった時刻だけに取り消し線を引き、ほかの入力をそのまま残すこと。
 *
 * 並べるのは 409 `slot_taken` の応答が返した `alternatives`（最大 3 件）そのままで、
 * 画面が代わりの時刻を作らない。選び直したら親が `POST /api/staff/holds` で押さえ直し、
 * **`Idempotency-Key` を作り直す**（枠が取れなかったときサーバは `in_progress` を消しているので、
 * 同じ鍵のままだと内容が変わったぶん 409 `idempotency_conflict` になる）。
 *
 * 実測（screens/BOOK-CONFLICT.html の <style>）:
 *   .flow = 1fr / 372px。本文 padding 36px 44px、要約 36px 28px・左に 1px の罫
 *   .warn = padding 26px 28px、見出し 22px（--alert）、本文 15px / 行間 1.6
 *   .lbl  = 上に 32px・下に 12px、14px/700 ＋ 補足 13px
 *   .alt  = 3 列・min-height 96px、時刻 26px/700 ＋ 設備 13px
 *   .same = 1 枚・min-height 88px、時刻 26px/700 ＋ 説明 16px/600 ＋ 補足 13px
 *   .sum  = dt 12px（上に 24px）/ dd 17px/600
 * 14px / 15px / 26px はトークンに無いので `text-grid`(13) / `text-body`(16) / `text-hero`(28) に寄せる。
 */

/** 代わりの時刻 1 件。設備の名前は親が引き当てて渡す（この面は照会をしない）。 */
export type ConflictAlternative = {
  startsAt: string
  endsAt: string
  /** 「相談カウンター 2」。設備を使わないご用件では空でよい。 */
  resourceLabel: string
}

/** 時刻を変えずに担当だけを入れ替える案。無ければ null。 */
export type ConflictStaffSwap = {
  staffId: string
  staffName: string
  staffSubtitle: string
  /** 「視力測定機 B・相談カウンター 1」。 */
  resourceLabel: string
}

/** 選び直した中身。親はこれで押さえ直し、工程 5 へ戻す。 */
export type ConflictChoice =
  | { kind: 'time'; startsAt: string; endsAt: string }
  | { kind: 'staff'; staffId: string; startsAt: string }

export type ConflictNoticeProps = {
  /** 埋まってしまった枠の開始時刻。 */
  takenAt: string
  /** 「佐藤 美咲・視力測定機 A」。何が埋まったかを 1 行で言う。 */
  takenLabel: string
  /** 代わりの時刻の見出しに出す担当のお名前。 */
  staffName: string
  summary: {
    date: LocalDate
    purposeLabel: string
    durationMinutes: number
    /** 「田中 花子 様」。まだ伺えていなければ空でよい。 */
    customerLabel: string
  }
  alternatives: ConflictAlternative[]
  staffSwap: ConflictStaffSwap | null
  onChoose: (choice: ConflictChoice) => void
  /**
   * 「次へ進む」の可否。**この面は自分の帯を持たない** —— 下端の帯は工程 3 のときと
   * 同じ 1 本きり（承認済みモック BOOK-CONFLICT の `.stepbar`）で、器が描く。
   */
  onGuardChange: (guard: StepGuard) => void
  onBackToDate: () => void
}

export function ConflictNotice({
  takenAt,
  takenLabel,
  staffName,
  summary,
  alternatives,
  staffSwap,
  onChoose,
  onGuardChange,
  onBackToDate,
}: ConflictNoticeProps) {
  const [chosen, setChosen] = useState(false)
  // 選び直した枠もまた埋まっていたら、この面はやり直しになる。前に選んだ印は残さない。
  const [shownFor, setShownFor] = useState(takenAt)
  if (shownFor !== takenAt) {
    setShownFor(takenAt)
    setChosen(false)
  }

  const nothingLeft = alternatives.length === 0 && staffSwap === null

  useEffect(() => {
    onGuardChange(
      chosen
        ? { canProceed: true, blockedReason: '' }
        : { canProceed: false, blockedReason: '時刻か担当を選ぶと進めます' },
    )
  }, [chosen, onGuardChange])

  function choose(choice: ConflictChoice) {
    setChosen(true)
    onChoose(choice)
  }

  return (
    <section className="flex h-full w-full min-h-0 flex-col bg-paper">
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto px-11 py-9">
          <div
            role="alert"
            className="rounded-panel border border-danger bg-danger-soft px-7 py-6.5"
          >
            <h2 className="text-title font-bold text-danger">
              この枠は、ほかの端末で先に確定されました
            </h2>
            <p className="mt-2 text-body leading-relaxed text-ink">
              {`${jstClock(takenAt)}　${takenLabel} が、たった今埋まりました。伺った内容は残っています。時刻か担当を選び直してください。`}
            </p>
          </div>

          {nothingLeft ? (
            <>
              <p className="mt-8 text-lead font-bold text-ink">
                この時刻に代わるお時間がありません。
              </p>
              <p className="mt-2 text-body text-ink-muted">
                お日にちを選び直すと、受け付けられる時刻をもう一度お出しします。
              </p>
              <button
                type="button"
                onClick={onBackToDate}
                className={cn(
                  'mt-4 min-h-14 rounded-card bg-pine px-6 text-lead font-bold text-on-pine',
                  focusRing,
                )}
              >
                別の日を選ぶ
              </button>
            </>
          ) : (
            <>
              {alternatives.length > 0 && (
                <>
                  <Label note={`${summary.durationMinutes}分そのままご案内できます`}>
                    {`同じ担当（${staffName}）でご案内できる時刻`}
                  </Label>
                  <ul className="grid grid-cols-3 gap-3">
                    {alternatives.map((alternative) => (
                      <li key={alternative.startsAt}>
                        <button
                          type="button"
                          onClick={() =>
                            choose({
                              kind: 'time',
                              startsAt: alternative.startsAt,
                              endsAt: alternative.endsAt,
                            })
                          }
                          className={cn(
                            'flex min-h-24 w-full flex-col justify-center rounded-card border border-line-strong bg-surface px-3.5 py-3 text-left',
                            focusRing,
                          )}
                        >
                          <b className="text-hero font-bold text-ink">
                            {jstClock(alternative.startsAt)}
                          </b>
                          <span className="mt-1.5 text-grid text-ink-muted">
                            {alternative.resourceLabel}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {staffSwap !== null && (
                <>
                  <Label note="担当だけを入れ替えます">時刻を変えたくない場合</Label>
                  <button
                    type="button"
                    onClick={() =>
                      choose({ kind: 'staff', staffId: staffSwap.staffId, startsAt: takenAt })
                    }
                    className={cn(
                      'flex min-h-22 w-full items-center gap-5 rounded-card border border-line-strong bg-surface px-3.5 py-3 text-left',
                      focusRing,
                    )}
                  >
                    <span className="flex-none text-hero font-bold text-ink">
                      {jstClock(takenAt)}
                    </span>
                    <span className="min-w-0">
                      {/* 技能が分からない担当では括弧ごと落とす（「（）」を画面に出さない）。 */}
                      <span className="block text-body font-semibold text-ink">
                        {staffSwap.staffSubtitle === ''
                          ? `担当を ${staffSwap.staffName} に変える`
                          : `担当を ${staffSwap.staffName}（${staffSwap.staffSubtitle}）に変える`}
                      </span>
                      <span className="mt-0.75 block text-grid text-ink-muted">
                        {staffSwap.resourceLabel}
                      </span>
                    </span>
                  </button>
                </>
              )}
            </>
          )}
        </div>

        <aside className="w-93 flex-none overflow-auto border-line border-l bg-surface px-7 py-9">
          <h3 className="text-body font-bold text-ink">ここまでのご予約</h3>
          <dl className="mt-1">
            <Line label="ご来店時刻">
              <span className="line-through text-danger">{jstClock(takenAt)}</span>
              <span className="ml-2.5 inline-flex min-h-5.5 items-center rounded-ctl border border-danger bg-danger-soft px-2 text-note font-semibold text-danger">
                埋まりました
              </span>
            </Line>
            <Line label="ご来店日">{shortDate(summary.date)}</Line>
            <Line label="ご来店の目的">
              {`${summary.purposeLabel}（${summary.durationMinutes}分）`}
            </Line>
            {summary.customerLabel !== '' && <Line label="お客様">{summary.customerLabel}</Line>}
          </dl>
          <p className="mt-8 text-grid text-ink-muted">選び直すと、その場で押さえ直します。</p>
        </aside>
      </div>
    </section>
  )
}

function Label({ note, children }: { note: string; children: ReactNode }) {
  return (
    <p className="mt-8 mb-3 text-grid font-bold text-ink">
      {children}
      <span className="ml-2.5 font-normal text-ink-muted">{note}</span>
    </p>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <dt className="text-note text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-lead font-semibold text-ink">{children}</dd>
    </div>
  )
}
