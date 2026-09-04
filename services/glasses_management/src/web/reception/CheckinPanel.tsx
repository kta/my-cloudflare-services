import type { LocalDate } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { useEffect, useRef, useState } from 'react'
import { lastVisitLabel } from '../../worker/domain/customers'
import { formatPhoneDigits } from '../booking/CustomerStep'
import { jstClock } from '../ledger/metrics'
import { VisitBadge } from '../ledger/Timetable'

/*
 * ご来店の受け付け（承認済みモック docs/frontend/mockups/eye/images/RECEPTION-CHECKIN.png）。
 *
 * 題材: お客様が目の前に立っている 20 秒で、名前と伝え忘れやすいことを確かめて受け付ける面。
 * シグネチャ: **左に確かめること、右に前回のご来店。確かめ終えなくても受け付けられること。**
 *
 * 実測（screens/RECEPTION-CHECKIN.html の <style> と assets/eye.css）:
 *   .chk  = 1fr 320px／.main padding 28px 32px・段の間 24px
 *   .side = 左罫 1px --line・地は白・padding 28px 24px／dt 13px（上に 20px）・dd 16px/600
 *   見出しの 1 行 = 13px --brand-dark・下に 10px
 *   .who  = padding 22px・丸 56×56（地 --brand-tint / 枠 --brand-line）・名前 26px/700
 *   .ck   = min-height 52px・箱 30×30（枠 2px・角 8px）・文字 15px・札は右端
 *   .go   = 主操作 min-width 280px / min-height 56px / 19px、副操作は既定のボタン
 *
 * **必須の行を設けない**（`008-reception-and-walkin` の決めごと）。お客様をお待たせしない方を
 * 優先し、消し込みの結果は `VisitEventInput.note` に載せて「確かめずに受けた」を残す。
 * 右下の録音の帯（`.rec-float`）はこのフェーズでは出さない（P7）。
 */

/** 確かめることの既定の 2 行。注意ごとは 1 件につき 1 行を後ろへ足す。 */
const DEFAULT_LINES = [
  { id: 'name', label: 'お名前を確かめました' },
  { id: 'change', label: '前回からの変化をお伺いする' },
] as const

/** `VisitEventInput.note` の上限。消し込みの結果はここに収める。 */
const NOTE_MAX = 120

export type CheckinSubject = {
  reservationId: string
  /** 「田中 花子 様」。 */
  displayName: string
  kana: string
  phone: string | null
  visitCount: number | null
  startsAt: string
  endsAt: string
  purposeLabel: string
  staffName: string
  /** もう受け付けているご予約では主操作を押させない（二重に受け付けない）。 */
  isReceived: boolean
}

export type CheckinLastVisit = {
  visitedOn: LocalDate
  powerLabel: string | null
  pdLabel: string | null
  staffName: string | null
  wishNote: string | null
}

export type CheckinPanelProps = {
  subject: CheckinSubject
  /** 予定時刻との差はこの値から出す（端末の時計を読まない）。 */
  serverNow: string
  /** そのお客様の注意ごと（1 件につき確かめることの 1 行になる）。 */
  attentions: readonly string[]
  lastVisit: CheckinLastVisit | null
  onBack: () => void
  onReceive: (stage: 'received' | 'waiting', note: string) => void
  busy?: boolean
  isOffline?: boolean
}

/** 「11:00 のご予約　5分早くお着きです」。ちょうどのときは差を出さない。 */
function arrivalHeadline(startsAt: string, serverNow: string): string {
  const clock = jstClock(startsAt)
  const minutes = Math.round((Date.parse(startsAt) - Date.parse(serverNow)) / 60_000)
  if (!Number.isFinite(minutes) || minutes === 0) return `${clock} のご予約`
  return minutes > 0
    ? `${clock} のご予約　${minutes}分早くお着きです`
    : `${clock} のご予約　${-minutes}分遅れてお着きです`
}

/** 消し込みの結果。確かめた行と確かめなかった行の両方を残す（片方だけでは読めない）。 */
function checkinNote(
  lines: readonly { id: string; label: string }[],
  done: ReadonlySet<string>,
): string {
  const say = (part: readonly string[]) => (part.length === 0 ? 'なし' : part.join('・'))
  const text = `確かめた: ${say(lines.filter((l) => done.has(l.id)).map((l) => l.label))}　確かめていない: ${say(
    lines.filter((l) => !done.has(l.id)).map((l) => l.label),
  )}`
  return [...text].slice(0, NOTE_MAX).join('')
}

export function CheckinPanel({
  subject,
  serverNow,
  attentions,
  lastVisit,
  onBack,
  onReceive,
  busy = false,
  isOffline = false,
}: CheckinPanelProps) {
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set())
  const headingRef = useRef<HTMLHeadingElement>(null)

  // 面が差し替わったら見出しへ焦点を移す（読み上げが前の画面の途中で止まらない）。
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  /*
   * Esc で盤面へ戻る（受付パネル `ledger/WalkinPanel.tsx` と同じ鍵に揃える）。
   * この面は盤面を置き換えるので `<dialog>` にはしないが、**逃げ道だけは同じ鍵**にする。
   * 何も記録せずに戻るので、`onBack` と押したときの道は 1 本である。
   */
  const backRef = useRef(onBack)
  backRef.current = onBack
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      backRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const lines = [
    ...DEFAULT_LINES.map((line) => ({ ...line, needsAttention: false })),
    ...attentions.map((label, index) => ({
      id: `attention-${index}`,
      label,
      needsAttention: true,
    })),
  ]

  function toggle(id: string) {
    setDone((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4">
        <button
          type="button"
          onClick={onBack}
          className={cn(
            // モックの戻るボタンは 40px だが、**触れるものは 44pt 以上**を優先して上げる。
            'min-h-11 rounded-ctl border border-line-strong bg-surface px-3.5 text-body font-semibold text-ink',
            focusRing,
          )}
        >
          ‹ 来店受付ボードへ戻る
        </button>
        <h2 ref={headingRef} tabIndex={-1} className="text-bar font-semibold text-ink">
          ご来店を受け付けます
        </h2>
      </div>

      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: 'minmax(0, 1fr) 20rem' }}>
        <section className="flex min-h-0 flex-col gap-6 overflow-auto px-8 py-7">
          <div>
            <p className="mb-2.5 text-grid text-pine-deep">
              {arrivalHeadline(subject.startsAt, serverNow)}
            </p>
            <section
              aria-label="お客様"
              className="flex items-start gap-4 rounded-panel border border-line bg-surface p-5.5"
            >
              <span
                aria-hidden="true"
                className="grid size-14 shrink-0 place-items-center rounded-circle border border-pine-line bg-pine-soft text-title text-pine"
              >
                ☺
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2.5">
                  <b className="text-hero font-bold text-ink">{subject.displayName}</b>
                  {subject.visitCount !== null && <VisitBadge count={subject.visitCount} />}
                </p>
                <p className="mt-0.5 text-grid text-ink-muted">
                  {subject.phone === null
                    ? subject.kana
                    : `${subject.kana}　${formatPhoneDigits(subject.phone)}`}
                </p>
                <dl className="mt-4.5 grid grid-cols-3 gap-x-4">
                  {[
                    {
                      term: 'ご予約',
                      value: `${jstClock(subject.startsAt)} 〜 ${jstClock(subject.endsAt)}`,
                    },
                    { term: 'ご来店の目的', value: subject.purposeLabel },
                    { term: '担当', value: subject.staffName },
                  ].map((row) => (
                    <div key={row.term}>
                      <dt className="text-grid text-ink-muted">{row.term}</dt>
                      <dd className="mt-0.5 text-body font-semibold text-ink">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </section>
          </div>

          <div>
            <h3 className="mb-3 text-lead font-semibold text-ink-muted">
              受け付ける前に確かめること
            </h3>
            <div>
              {lines.map((line, index) => {
                const isDone = done.has(line.id)
                return (
                  <label
                    key={line.id}
                    className={cn(
                      'flex min-h-13 cursor-pointer items-center gap-3.5',
                      index === 0 ? '' : 'border-t border-line',
                    )}
                  >
                    <input
                      type="checkbox"
                      aria-label={line.label}
                      checked={isDone}
                      onChange={() => toggle(line.id)}
                      className="peer sr-only"
                    />
                    <span
                      data-check-box
                      aria-hidden="true"
                      className={cn(
                        'grid size-7.5 shrink-0 place-items-center rounded-ctl border-2 text-lead font-bold',
                        isDone
                          ? 'border-pine bg-pine text-on-pine'
                          : line.needsAttention
                            ? 'border-walkin bg-surface text-walkin'
                            : 'border-line-strong bg-surface text-surface',
                        'peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
                      )}
                    >
                      ✓
                    </span>
                    <span
                      className={cn('text-body', line.needsAttention ? 'text-walkin' : 'text-ink')}
                    >
                      {line.label}
                    </span>
                    {/* 済みと未済を色と枠だけで分けない（AC-RECEP-03）。 */}
                    {isDone && (
                      <span className="text-grid font-semibold text-pine-deep">確かめました</span>
                    )}
                    {line.needsAttention && (
                      <span className="ml-auto inline-flex min-h-5.5 items-center rounded-ctl border border-walkin bg-walkin-soft px-2 text-note font-semibold text-walkin">
                        要確認
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={subject.isReceived || busy || isOffline}
              onClick={() => onReceive('received', checkinNote(lines, done))}
              className={cn(
                'min-h-14 min-w-70 rounded-ctl bg-pine px-6 text-bar font-bold text-on-pine',
                'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted',
                focusRing,
              )}
            >
              ご来店を受け付ける
            </button>
            <button
              type="button"
              disabled={busy || isOffline}
              onClick={() => onReceive('waiting', checkinNote(lines, done))}
              className={cn(
                'min-h-12 rounded-ctl border border-line-strong bg-surface px-4.5 text-body font-semibold text-ink',
                focusRing,
              )}
            >
              お待ちいただく
            </button>
          </div>
          {subject.isReceived && (
            <p role="status" className="text-grid text-ink-muted">
              このご予約はもう受け付けています。
            </p>
          )}
        </section>

        <aside
          aria-label="前回のご来店"
          className="min-h-0 overflow-auto border-l border-line bg-surface px-6 py-7"
        >
          <h3 className="text-lead font-semibold text-ink">
            {lastVisit === null
              ? '前回のご来店'
              : `前回のご来店（${lastVisitLabel(lastVisit.visitedOn)}）`}
          </h3>
          {lastVisit === null ? (
            <p className="mt-1 text-body text-ink-muted">まだご来店の記録がありません。</p>
          ) : (
            <dl>
              {[
                { term: '度数（右 R ／ 左 L）', value: lastVisit.powerLabel, mono: true },
                { term: 'PD', value: lastVisit.pdLabel, mono: true },
                { term: '担当', value: lastVisit.staffName, mono: false },
                { term: 'ご希望メモ', value: lastVisit.wishNote, mono: false },
              ]
                .filter((row) => row.value !== null && row.value !== '')
                .map((row) => (
                  <div key={row.term}>
                    <dt className="mt-5 text-grid text-ink-muted">{row.term}</dt>
                    <dd
                      className={cn(
                        'mt-0.5 text-body font-semibold text-ink',
                        row.mono && 'font-mono',
                      )}
                    >
                      {row.value}
                    </dd>
                  </div>
                ))}
            </dl>
          )}
        </aside>
      </div>
    </div>
  )
}
