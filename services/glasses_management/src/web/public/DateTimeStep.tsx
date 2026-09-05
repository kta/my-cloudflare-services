import type { LocalDate, PublicAvailabilityResponse, PublicStorePurpose } from '@app/contracts'
import { cn } from '@app/ui'
import { useCallback, useEffect, useState } from 'react'
import { jstClock, shiftDate } from '../ledger/metrics'
import { PublicNotice, publicQuietButtonClass, StickyAction } from './PublicBookingApp'

/*
 * 工程 3「日にちと時間」（承認済みモック docs/frontend/mockups/eye/images/WEB-03-DATETIME.png）。
 *
 * 実測（screens/WEB-03-DATETIME.html の <style>）:
 *   週の送り margin 28px 0 10px・gap 8px、‹ › は 44×44px・角 12px、中央の週は 16px
 *   日の並び 7 列・gap 4px、1 件は最小高 64px・padding 6px 0・角 8px・数字 20px/700、
 *   曜日 13px/400・状態 13px/600（--ink-3）
 *   小見出し「8月29日（土）のお時間」は margin 28px 0 10px
 *   時刻の並び 4 列・gap 10px、1 件は最小高 60px・角 12px・16px/700
 *   選択中は縁 3px + 「選択中」（13px --brand-dark）、満は地 --surface-2 + 「満」
 *
 * 押せない枠を `disabled` にしない（`07-nfr.md` §2.3「理由なしの disabled を置かない」）。
 * `aria-disabled` と「定休」「満」の**文字**で示すので、色が見えなくても分かる。
 * 受け付ける時間とお昼の受付停止帯の絞り込みはサーバ（`domain/availability.ts`）が済ませて
 * いるので、**この画面は返ってきた枠しか描かない**（決め打ちの時間割を持たない）。
 */

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** `YYYY-MM-DD` を暦日として読む。時差の影響を受けないよう UTC で持つ。 */
function calendarDay(date: LocalDate): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

/** 「8月27日」。年をまたぐ知らせは出さないので年を落とす。 */
function monthDay(date: LocalDate): string {
  const day = calendarDay(date)
  return `${day.getUTCMonth() + 1}月${day.getUTCDate()}日`
}

/** 「8月29日（土）」。 */
function longDay(date: LocalDate): string {
  return `${monthDay(date)}（${WEEKDAYS[calendarDay(date).getUTCDay()]}）`
}

/** 「8月27日 〜 9月2日」。 */
function weekLabel(from: LocalDate): string {
  return `${monthDay(from)} 〜 ${monthDay(shiftDate(from, 6))}`
}

type Load<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'failed'; offline: boolean }

export type DateTimeStepProps = {
  purpose: PublicStorePurpose
  /** JST の暦日。端末の時計を読まない。 */
  today: LocalDate
  /** 何日先まで受けるか、の最終日。ここを越える週へは送らない。 */
  lastAcceptedDate: LocalDate
  loadWeek: (from: LocalDate, to: LocalDate) => Promise<PublicAvailabilityResponse>
  startsAt: string | null
  onSelect: (startsAt: string | null) => void
  onNext: () => void
  /** ご予約の変更（WEB-CANCEL 経由）は同じ画面のまま見出しだけを差し替える。 */
  heading?: string
}

export function DateTimeStep({
  purpose,
  today,
  lastAcceptedDate,
  loadWeek,
  startsAt,
  onSelect,
  onNext,
  heading = 'ご希望の日時をお選びください',
}: DateTimeStepProps) {
  const [weekStart, setWeekStart] = useState<LocalDate>(today)
  const [week, setWeek] = useState<Load<PublicAvailabilityResponse>>({ state: 'loading' })
  const [date, setDate] = useState<LocalDate | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [exhausted, setExhausted] = useState(false)

  useEffect(() => {
    let live = true
    setWeek({ state: 'loading' })
    loadWeek(weekStart, shiftDate(weekStart, 6))
      .then((answer) => {
        if (live) setWeek({ state: 'ready', value: answer })
      })
      .catch(() => {
        if (live) setWeek({ state: 'failed', offline: !navigator.onLine })
      })
    return () => {
      live = false
    }
  }, [loadWeek, weekStart, attempt])

  /** 週を送ると、その週に無い日と時刻は選び直してもらう。 */
  const moveWeek = useCallback(
    (next: LocalDate) => {
      setWeekStart(next)
      setDate(null)
      setExhausted(false)
      onSelect(null)
    },
    [onSelect],
  )

  const canGoBack = weekStart > today
  const canGoForward = shiftDate(weekStart, 7) <= lastAcceptedDate

  const days = week.state === 'ready' ? week.value.days : []
  const chosenDay = days.find((row) => row.date === date) ?? null
  const openWeek = days.some((row) => !row.isClosed && row.slots.some((slot) => slot.isAvailable))
  const announcement =
    week.state === 'loading'
      ? '空き状況を読み込んでいます…'
      : week.state === 'ready'
        ? `${weekLabel(weekStart)} の空き状況を表示しました。`
        : ''

  /** 次に空きのある週まで送る。サーバに「次の空き」を返す経路が無いので週ごとに当たる。 */
  async function jumpToOpenWeek(): Promise<void> {
    let cursor = shiftDate(weekStart, 7)
    while (cursor <= lastAcceptedDate) {
      const answer = await loadWeek(cursor, shiftDate(cursor, 6))
      if (answer.days.some((row) => !row.isClosed && row.slots.some((slot) => slot.isAvailable))) {
        moveWeek(cursor)
        return
      }
      cursor = shiftDate(cursor, 7)
    }
    setExhausted(true)
  }

  return (
    <>
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-1.5 h-3.75 w-4.5 shrink-0 rounded-ctl rounded-bl-none bg-pine"
        />
        <div>
          <h2 className="text-bar font-semibold text-ink">{heading}</h2>
          <p className="mt-0.5 text-grid text-ink-muted">
            約{purpose.durationMinutes}分でご案内できる日時です。
          </p>
        </div>
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      <div className="mt-7 mb-2.5 flex items-center gap-2">
        <button
          type="button"
          aria-label="前の週"
          aria-disabled={!canGoBack}
          onClick={() => {
            if (canGoBack) moveWeek(shiftDate(weekStart, -7))
          }}
          className={cn(
            'size-11 rounded-card border border-line-strong',
            canGoBack ? 'bg-surface text-ink-muted' : 'bg-busy-soft text-ink-faint',
          )}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <b className="flex-1 text-center text-body font-semibold text-ink">
          {weekLabel(weekStart)}
        </b>
        <button
          type="button"
          aria-label="次の週"
          aria-disabled={!canGoForward}
          onClick={() => {
            if (canGoForward) moveWeek(shiftDate(weekStart, 7))
          }}
          className={cn(
            'size-11 rounded-card border border-line-strong',
            canGoForward ? 'bg-surface text-ink-muted' : 'bg-busy-soft text-ink-faint',
          )}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      {week.state === 'failed' ? (
        <PublicNotice
          live="alert"
          heading={week.offline ? '通信が切れています' : '空き状況を読み込めませんでした'}
          reason={
            week.offline
              ? '電波の届く場所で、もう一度お試しください。'
              : '通信が混み合っているようです。'
          }
          action={
            <button
              type="button"
              onClick={() => setAttempt((current) => current + 1)}
              className={publicQuietButtonClass}
            >
              もう一度読み込む
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {days.map((row) => {
            const on = row.date === date
            const name = row.isClosed ? `${longDay(row.date)}　定休` : longDay(row.date)
            return (
              <button
                key={row.date}
                type="button"
                aria-label={name}
                aria-pressed={on}
                aria-disabled={row.isClosed}
                onClick={() => {
                  if (row.isClosed) return
                  setDate(row.date)
                  onSelect(null)
                }}
                className={cn(
                  'min-h-16 rounded-ctl py-1.5 text-center',
                  row.isClosed
                    ? 'border border-line-strong bg-busy-soft'
                    : on
                      ? 'border-3 border-pine bg-pine-soft'
                      : 'border border-line-strong bg-surface',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'block text-grid',
                    row.isClosed ? 'text-ink-faint' : on ? 'text-pine-deep' : 'text-ink-muted',
                  )}
                >
                  {WEEKDAYS[calendarDay(row.date).getUTCDay()]}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'block text-bar font-bold',
                    row.isClosed ? 'text-ink-faint' : on ? 'text-pine-deep' : 'text-ink',
                  )}
                >
                  {calendarDay(row.date).getUTCDate()}
                </span>
                {row.isClosed && (
                  <span aria-hidden="true" className="block text-grid font-semibold text-ink-faint">
                    定休
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {week.state === 'ready' && !openWeek && (
        <PublicNotice
          heading="この週に空きがありません。"
          reason={
            exhausted
              ? 'これより先も、いまお受けできるお時間がありません。'
              : 'ほかの週にはまだ空きがあるかもしれません。'
          }
          action={
            exhausted ? (
              <p className="text-grid text-ink-muted">お電話でご予約を承ります。</p>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void jumpToOpenWeek()
                }}
                className={publicQuietButtonClass}
              >
                次に空きのある週を探す
              </button>
            )
          }
        />
      )}

      {chosenDay !== null && !chosenDay.isClosed && (
        <>
          <h3 className="mt-7 mb-2.5 text-body font-semibold text-ink">
            {longDay(chosenDay.date)}のお時間
          </h3>
          <div className="grid grid-cols-4 gap-2.5">
            {chosenDay.slots.map((slot) => {
              const clock = jstClock(slot.startsAt)
              const on = slot.startsAt === startsAt
              return (
                <button
                  key={slot.startsAt}
                  type="button"
                  aria-label={slot.isAvailable ? clock : `${clock}　満`}
                  aria-pressed={on}
                  aria-disabled={!slot.isAvailable}
                  onClick={() => {
                    if (slot.isAvailable) onSelect(slot.startsAt)
                  }}
                  className={cn(
                    'min-h-15 rounded-card py-1.5 text-center text-body font-bold',
                    !slot.isAvailable
                      ? 'border border-line-strong bg-busy-soft text-ink-faint'
                      : on
                        ? 'border-3 border-pine bg-pine-soft text-pine-deep'
                        : 'border border-line-strong bg-surface text-ink',
                  )}
                >
                  <span aria-hidden="true">{clock}</span>
                  {!slot.isAvailable && (
                    <span
                      aria-hidden="true"
                      className="block text-grid font-semibold text-ink-faint"
                    >
                      満
                    </span>
                  )}
                  {on && (
                    <span
                      aria-hidden="true"
                      className="block text-grid font-semibold text-pine-deep"
                    >
                      選択中
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}

      <StickyAction
        label="お客様の情報を入力する"
        ready={date !== null && startsAt !== null}
        reason="日にちとお時間をお選びになると進めます。"
        onPress={onNext}
      />
    </>
  )
}
