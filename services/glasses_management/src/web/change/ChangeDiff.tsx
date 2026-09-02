import type { ReservationSource } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import {
  diffReservation,
  type ReservationSnapshot,
  sayOnConfirm,
} from '../../worker/domain/reservation-change'
import {
  type ConflictAlternative,
  type ConflictChoice,
  ConflictNotice,
  type ConflictStaffSwap,
} from '../booking/ConflictNotice'
import { sourceTagLabel } from './ReservationSearch'

/*
 * 変更内容の確認（承認済みモック docs/frontend/mockups/eyex/images/CHANGE-DIFF.png）。
 *
 * 題材: 変わる行と変わらない行を並べて、お客様へ読み上げてご了承をいただく面。
 * シグネチャ: **変わる行だけが緑地になり、変わらない行は薄字のまま並ぶ差分表。**
 *
 * 実測（screens/CHANGE-DIFF.html と assets/eyex.css）:
 *   `1fr 360px`（`w-90`）gap 32px・padding 36px。見出し 18px、補足は 400/13px を 10px 右に。
 *   差分表は `132px 1fr 1fr`（`w-33`）、隙間 1px を --line で見せ、外枠 1px --line-strong・
 *   角 12px。セルは padding 16px 14px・16px。見出し行は --surface-2 の 12px/600
 *   （padding 8px 14px）。項目名の列は 13px/600、補足は 13px。
 *   右の読み上げカードは 2px の --brand-line の縁、本文 24px/1.6。
 *
 * **読み上げ文は確定前の形**で組み立てる（`domain/reservation-change.ts` の `sayOnConfirm`）。
 * モックの「変更いたしました」「でございます」は採らない（`design/06-use-cases.md`
 * IDX-CHANGE-04 §5）。差分と文言の出どころを画面へ写さず、Worker と同じ純関数を呼ぶ。
 *
 * この面が描かないもの: 受付の録音（`.rec-float`）… `010-recording`（P7）が足す。
 */

/** 枠が先に埋まっていたとき（409 `slot_taken`）に BOOK-CONFLICT へ渡す材料。 */
export type SlotTaken = {
  takenAt: string
  takenLabel: string
  staffName: string
  summary: {
    date: string
    purposeLabel: string
    durationMinutes: number
    customerLabel: string
  }
  alternatives: ConflictAlternative[]
  staffSwap: ConflictStaffSwap | null
}

/**
 * BOOK-CONFLICT は自分の帯を持たない面なので「次へ」の可否を外へ上げるが、
 * 変更の面は帯を持たない（出口は下の 2 つだけ）ので受け取っても使い道が無い。
 * 参照を固定して、`useEffect` の依存が毎描画で変わらないようにする。
 */
const IGNORE_GUARD = () => undefined

export type ChangeDiffProps = {
  source: ReservationSource
  before: ReservationSnapshot
  after: ReservationSnapshot
  /** 確定の応答を待っている間。 */
  confirming?: boolean
  /** 確定できなかったときの 1 行。 */
  error?: string | null
  /** 409 `slot_taken` のとき。渡されると差分の代わりに BOOK-CONFLICT の形を出す。 */
  slotTaken?: SlotTaken | null
  /** 代わりの枠を選び直した（器が押さえ直す）。 */
  onReselect?: (choice: ConflictChoice) => void
  onBack: () => void
  onConfirm: () => void
  isOffline?: boolean
}

export function ChangeDiff({
  source,
  before,
  after,
  confirming = false,
  error = null,
  slotTaken = null,
  onReselect,
  onBack,
  onConfirm,
  isOffline = false,
}: ChangeDiffProps) {
  /*
   * 確定を押した瞬間に枠が埋まっていたときは、差分をしまって BOOK-CONFLICT と同じ形に
   * 落とす（AC-CHANGE-26）。**いまのご予約は元のまま残っている**ので、まずそれを言う。
   */
  if (slotTaken !== null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <p
          role="status"
          className="shrink-0 border-b border-line bg-surface px-9 py-3 text-body text-ink"
        >
          まだ変更していません。伺った内容は残っています。
        </p>
        <div className="min-h-0 flex-1">
          <ConflictNotice
            takenAt={slotTaken.takenAt}
            takenLabel={slotTaken.takenLabel}
            staffName={slotTaken.staffName}
            summary={{
              date: slotTaken.summary.date,
              purposeLabel: slotTaken.summary.purposeLabel,
              durationMinutes: slotTaken.summary.durationMinutes,
              customerLabel: slotTaken.summary.customerLabel,
            }}
            alternatives={slotTaken.alternatives}
            staffSwap={slotTaken.staffSwap}
            onChoose={(choice) => onReselect?.(choice)}
            onGuardChange={IGNORE_GUARD}
            onBackToDate={onBack}
          />
        </div>
      </div>
    )
  }

  const rows = diffReservation(before, after)
  const nothingChanged = rows.length === 0

  return (
    <div className="flex h-full min-h-0 gap-8 overflow-y-auto px-9 py-9">
      <section className="flex min-w-0 flex-1 flex-col">
        <h2 className="mb-4.5 text-lead font-bold text-ink">
          この内容に変更します
          <span className="ml-2.5 text-grid font-normal text-ink-muted">
            変わる行だけ色を付けています
          </span>
        </h2>

        {error !== null && (
          <p
            role="alert"
            className="mb-4 rounded-card border border-danger bg-danger-soft px-4 py-3 text-body text-danger"
          >
            {error}
          </p>
        )}

        {nothingChanged ? (
          <p className="rounded-card border border-line-strong bg-surface px-4 py-4 text-body text-ink">
            変えるところがまだありません。
          </p>
        ) : (
          <table
            aria-label="変更前と変更後"
            className="w-full table-fixed overflow-hidden rounded-card border border-line-strong border-separate border-spacing-0 text-left"
          >
            <thead>
              <tr>
                <Head className="w-33">項目</Head>
                <Head>変更前</Head>
                <Head>変更後</Head>
              </tr>
            </thead>
            <tbody>
              {rows.map((diff) => (
                <tr key={diff.label} className={diff.changed ? 'bg-pine-soft' : 'bg-surface'}>
                  <th
                    scope="row"
                    className={cn(
                      'border-t border-line px-3.5 py-4 align-top text-grid font-semibold',
                      diff.changed ? 'text-pine-deep' : 'text-ink-muted',
                    )}
                  >
                    {diff.label}
                  </th>
                  <td className="border-t border-line px-3.5 py-4 align-top text-body text-ink">
                    {diff.before.text}
                    {diff.before.note !== '' && (
                      <span className="block text-grid text-ink-muted">{diff.before.note}</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'border-t border-line px-3.5 py-4 align-top text-body',
                      diff.changed ? 'font-bold text-pine-deep' : 'text-ink-muted',
                    )}
                  >
                    {diff.after.text}
                    {diff.changed && (
                      <span className="ml-2.5 inline-flex min-h-5.5 items-center rounded-ctl border border-pine-line bg-pine-soft px-2 text-note font-semibold text-pine-deep">
                        変更
                      </span>
                    )}
                    {diff.after.note !== '' && (
                      <span
                        className={cn(
                          'block text-grid',
                          diff.changed ? 'font-bold text-pine-deep' : 'text-ink-muted',
                        )}
                      >
                        {diff.after.note}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-3.5 pt-6">
          <p className="w-full text-grid text-ink-muted">
            読み上げてご了承をいただいてから確定してください。
          </p>
          <div className="ml-auto flex gap-3">
            <button
              type="button"
              onClick={onBack}
              className={cn(
                'min-h-12 whitespace-nowrap rounded-card border border-line-strong bg-surface px-4.5 text-body font-semibold text-ink',
                focusRing,
              )}
            >
              戻って直す
            </button>
            <button
              type="button"
              aria-label={
                isOffline
                  ? '変更を確定する　通信が戻ると押せます'
                  : nothingChanged
                    ? '変更を確定する　変えるところがまだありません'
                    : undefined
              }
              aria-busy={confirming ? true : undefined}
              disabled={nothingChanged || isOffline}
              onClick={() => {
                // 確定している間の 2 度目・3 度目の押下は届かせない。
                if (confirming) return
                onConfirm()
              }}
              className={cn(
                'min-h-14 whitespace-nowrap rounded-card border border-pine bg-pine px-6 text-lead font-semibold text-on-pine',
                'disabled:border-line disabled:bg-surface-2 disabled:text-ink-faint',
                focusRing,
              )}
            >
              {confirming ? '確定しています…' : '変更を確定する'}
            </button>
          </div>
        </div>
      </section>

      <aside className="w-90 shrink-0">
        <section
          aria-label="お客様へ、このまま読み上げます"
          className="rounded-panel border-2 border-pine-line bg-surface px-5.5 py-5"
        >
          <h3 className="text-body font-bold text-ink">お客様へ、このまま読み上げます</h3>
          <p className="mt-2.5 text-hero leading-relaxed font-semibold text-ink">
            {sayOnConfirm(after)}
          </p>
        </section>
        {/*
          変更・取消のメールは送らない（`NotificationJob` に型が無く、足すのは別サービスの
          契約変更＝人間の承認事項）。Web のご予約は日時だけを変えたときに
          `reservation.confirmed` の送り直しで賄うので、そのことを 1 行で言う。
        */}
        <p className="mt-5 px-0.5 text-grid text-ink-muted">
          {source === 'web'
            ? 'Webでのご予約のため、変更をメールでお知らせします。'
            : `${sourceTagLabel(source)}のため、メールは送りません。`}
        </p>
      </aside>
    </div>
  )
}

function Head({ children, className }: { children: string; className?: string }) {
  return (
    <th
      scope="col"
      className={cn('bg-surface-2 px-3.5 py-2 text-note font-semibold text-ink-muted', className)}
    >
      {children}
    </th>
  )
}
