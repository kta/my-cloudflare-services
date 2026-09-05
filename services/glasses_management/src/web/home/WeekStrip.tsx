import type { LocalDate } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { shiftDate } from '../ledger/metrics'

/*
 * トップの下辺に置く 1 週間の帯（承認済みモック docs/frontend/mockups/eye/images/HOME.png）。
 *
 * この帯が無いあいだ、共有端末のトップは「新しい予約を取る」と「予約を変更する」の
 * 2 枚だけで、本文の下 265px が空いていた。レジ横の iPad を見ても、今日の台帳へ入るには
 * 左の柱から「予約台帳」を押し、開いた先で日付を選び直すことになる（UX 監査 J-01）。
 * `e2e/mock-compare.spec.ts` の HOME も「下辺の日付の帯…まだ無い」を差分として抱えていた。
 *
 * 実測値（screens/HOME.html の `.days` / `.strip` / `.day`）:
 *   帯は本文の左右 44px・下 44px。月の名前は 14px・下に 16px。
 *   札は 8 列・すき間 12px、1 枚は最小 76px・1px の枠・角 12px、数字 22px、曜日 12px。
 *   本日は 3px の緑の枠と淡い緑の地、日曜は赤い文字、いちばん右は緑の文字で 14px。
 *
 * 週の始まりは月曜（モックが 月24〜日30 で描いている）。**端末の時計を読まない** ——
 * 今日は引数で受ける（サーバの日付を器が渡す）。
 */

/** 月曜から始まる 7 日。 */
const WEEK = 7

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

function weekdayOf(date: LocalDate): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay()
}

function dayOfMonth(date: LocalDate): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDate()
}

/** その日を含む週の月曜。日曜は「その週の終わり」なので 6 日戻す。 */
export function mondayOf(date: LocalDate): LocalDate {
  const weekday = weekdayOf(date)
  return shiftDate(date, weekday === 0 ? -6 : 1 - weekday)
}

/** 帯に出す 7 日。 */
export function weekOf(date: LocalDate): LocalDate[] {
  const monday = mondayOf(date)
  return Array.from({ length: WEEK }, (_, index) => shiftDate(monday, index))
}

/** 「2026年 8月」。週が月をまたぐときは「8月・9月」と両方を言う。 */
export function monthLabel(days: readonly LocalDate[]): string {
  const months = [...new Set(days.map((day) => Number(day.slice(5, 7))))]
  const year = days[0]?.slice(0, 4) ?? ''
  return `${year}年 ${months.map((month) => `${month}月`).join('・')}`
}

/*
 * 札の骨。**文字の大きさと色はここに入れない** —— 同じ要素に `text-title` と `text-grid`、
 * `text-ink` と `text-danger` を重ねると、勝つのは書いた順ではなく生成された CSS の順で、
 * 日曜の数字が黒いまま、いちばん右の札だけ 22px、という食い違いが出る。
 */
const DAY_CLASS = `grid min-h-19 place-content-center rounded-card text-center font-semibold ${focusRing}`

export function WeekStrip({
  today,
  onPickDate,
  onOpenCalendar,
}: {
  /** サーバの今日（JST の暦日）。端末の時計を読まないので器が渡す。 */
  today: LocalDate
  onPickDate: (date: LocalDate) => void
  /** 週の外の日を選ぶ。台帳には前の日／次の日／本日の帯があるので、そこへ渡す。 */
  onOpenCalendar: () => void
}) {
  const days = weekOf(today)
  return (
    <section aria-label="日付から台帳を開く">
      <p className="mb-4 text-grid text-ink-muted">{monthLabel(days)}</p>
      <div className="grid grid-cols-8 gap-3">
        {days.map((day) => {
          const isToday = day === today
          const isSunday = weekdayOf(day) === 0
          return (
            <button
              key={day}
              type="button"
              aria-current={isToday ? 'date' : undefined}
              onClick={() => onPickDate(day)}
              className={cn(
                DAY_CLASS,
                'text-title',
                isToday
                  ? 'border-3 border-pine bg-pine-soft'
                  : 'border border-line-strong bg-surface',
                isToday ? 'text-pine-deep' : isSunday ? 'text-danger' : 'text-ink',
              )}
            >
              <span
                className={cn(
                  'block text-note font-semibold',
                  isSunday ? 'text-danger' : 'text-ink-muted',
                )}
              >
                {WEEKDAY_LABELS[weekdayOf(day)]}
              </span>
              {dayOfMonth(day)}
            </button>
          )
        })}
        <button
          type="button"
          onClick={onOpenCalendar}
          className={cn(
            DAY_CLASS,
            'border border-line-strong bg-surface px-1 text-grid leading-snug text-pine',
          )}
        >
          カレンダー
          <br />
          から選ぶ
        </button>
      </div>
    </section>
  )
}
