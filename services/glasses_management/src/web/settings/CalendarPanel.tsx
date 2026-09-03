import { BusinessHoursView, CalendarException, type LocalDate, StoreDetail } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { weekdayOf } from '../../worker/domain/store-settings'
import { client } from '../client'
import { LoadFailed } from '../shell/LoadFailed'
import {
  type SaveOutcome,
  type SettingsPanelProps,
  toJstDay,
  WEEKDAY_NAMES,
  WEEKDAYS_FROM_MONDAY,
} from './sections'

/*
 * 営業日（承認済みモック docs/frontend/mockups/eyex/images/SETTINGS-CALENDAR.png）。
 *
 * 実測: .months = 1fr + 1fr / gap 22px / margin-top 16px。月のカードは 1px 罫 +
 * 角 16px + padding 14px 14px 16px、見出し 15px。日の格子は 7 列 / gap 4px、
 * 曜日の見出しは 11px --color-ink-muted。丸は 40×40 の円（1px --color-pine-line /
 * 地 --color-pine-soft / 文字 --color-pine-deep）、休みは地 --color-busy /
 * 縁 --color-line-strong / 文字 --color-ink-muted。本日は 3px --color-pine の輪。
 * 「まとめて決める」は罫だけの 2 行。
 *
 * 丸は 40px しかないので、**見た目を変えず当たり判定だけ** ::before で 44pt へ
 * 広げる（P1 の決め #14）。休みは灰色にするだけでなく、丸の中に必ず「休」の字を
 * 置く —— 色だけで状態を伝えない。
 *
 * 丸の数字はモックが 14px だが theme.css に 14px の段が無いので 13px
 * （--text-grid）を採る。任意値でトークンの外へ出ない。
 */

const SECTION_NAME = '営業日'

type DayState = 'weekly-closed' | 'exception-closed' | 'special' | 'open'

const DAY_STATE_LABELS: Record<DayState, string> = {
  'weekly-closed': '定休日',
  'exception-closed': '臨時のお休み',
  special: '特別営業',
  open: '営業',
}

/** 丸の中の 2 行目。営業の日は置かない。 */
const DAY_STATE_MARKS: Record<DayState, string> = {
  'weekly-closed': '休',
  'exception-closed': '休',
  special: '特',
  open: '',
}

type Loaded = {
  store: StoreDetail
  hours: BusinessHoursView
  exceptions: CalendarException[]
}

/** 押した丸の行き先。closed=臨時のお休みにする / open=営業日へ戻す。 */
type Intent = 'closed' | 'open'

export function CalendarPanel({ storeId, now, today, onDraftChange }: SettingsPanelProps) {
  const day = today ?? toJstDay(now ?? new Date().toISOString())
  const months = useMemo(() => monthsFrom(day), [day])
  const from = firstDateOf(months[0])
  const to = lastDateOf(months[1])

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  // 読み直しの合図。読み込みの useEffect の依存に入れる。
  const [reloadCount, setReloadCount] = useState(0)
  const [pending, setPending] = useState<Record<string, Intent>>({})

  const load = useCallback(async (): Promise<Loaded | null> => {
    const [storeRes, hoursRes, exceptionRes] = await Promise.all([
      client.api.staff.stores[':storeId'].$get({ param: { storeId } }),
      client.api.staff.stores[':storeId']['business-hours'].$get({ param: { storeId } }),
      client.api.staff.stores[':storeId']['calendar-exceptions'].$get({
        param: { storeId },
        query: { from, to },
      }),
    ])
    if (!storeRes.ok || !hoursRes.ok || !exceptionRes.ok) return null
    // 3 本の本文を読み切ってから 1 度に置く。順に置くと、店舗は新しいのに
    // 臨時のお休みは古いという半端な組み合わせで描く瞬間ができる。
    const [storeJson, hoursJson, exceptionJson] = await Promise.all([
      storeRes.json(),
      hoursRes.json(),
      exceptionRes.json(),
    ])
    return {
      store: StoreDetail.parse(storeJson),
      hours: BusinessHoursView.parse(hoursJson),
      exceptions: CalendarException.array().parse(exceptionJson),
    }
  }, [storeId, from, to])

  useEffect(() => {
    let alive = true
    load()
      .then((next) => {
        if (!alive) return
        if (next === null) setFailed(true)
        else setLoaded(next)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [load, reloadCount])

  const changes = useMemo(
    () =>
      Object.entries(pending)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, intent]) =>
          intent === 'closed'
            ? `${dateLabel(date)}を臨時のお休みにする`
            : `${dateLabel(date)}を営業日へ戻す`,
        ),
    [pending],
  )

  const save = useCallback(async (): Promise<SaveOutcome> => {
    if (!loaded) return 'failed'
    for (const [date, intent] of Object.entries(pending)) {
      const status = await writeOne(storeId, date, intent, loaded.exceptions)
      if (status === 403) return 'forbidden'
      if (status === 409) return 'conflict'
      if (status !== null) return 'failed'
    }
    // 読み直しが済んでから返す。先に返すと、画面がまだ古い丸のままで
    // 「保存しました」と言うことになる。
    const next = await load()
    if (next === null) return 'failed'
    setLoaded(next)
    setPending({})
    return 'saved'
  }, [loaded, pending, storeId, load])

  const discard = useCallback(() => setPending({}), [])

  useEffect(() => {
    onDraftChange({ changes, blocked: null, danger: false, dangerNote: null, save, discard })
  }, [onDraftChange, changes, save, discard])

  function toggle(date: LocalDate) {
    setPending((current) => {
      const next = { ...current }
      // 2 度押して元へ戻したら「変更」ではない。札の件数から落とす。
      if (next[date] !== undefined) {
        delete next[date]
        return next
      }
      next[date] = dayStateOf(date, loaded, current) === 'open' ? 'closed' : 'open'
      return next
    })
  }

  if (failed)
    return (
      <LoadFailed
        what="営業日"
        onRetry={() => {
          setFailed(false)
          setReloadCount((n) => n + 1)
        }}
      />
    )
  if (!loaded)
    return (
      <p role="status" className="text-body text-ink-muted">
        {SECTION_NAME}を読み込んでいます…
      </p>
    )

  const closedDays = listClosedDays(loaded.exceptions, pending, from, to)
  const weeklyOff = loaded.hours.rows
    .filter((row) => row.isClosed)
    .map((row) => `${WEEKDAY_NAMES[row.weekday]}曜日`)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3.5">
        <p className="text-grid font-semibold text-ink-muted">
          丸をおすと、営業日とお休みが入れ替わります。
        </p>
        <div className="ml-auto flex items-center gap-2.5">
          <span id="accepting-label" className="text-grid font-semibold">
            この店舗で予約を受け付ける
          </span>
          <span className="text-grid text-ink-muted">
            {loaded.store.isActive ? '受け付けています' : '止めています'}
          </span>
          {/*
            店舗まるごとの受付停止は、まだ保存する経路が無い（StorePatch に
            isActive の列が無い）。押せて何も起きない切り替えは作らず、いまどちらかを
            読めるようにしたうえで、押せないことを字でも伝える（P1 の決め #11 と同じ理由）。
          */}
          <span
            role="switch"
            tabIndex={0}
            aria-checked={loaded.store.isActive}
            aria-disabled="true"
            aria-labelledby="accepting-label"
            className={cn(
              'block h-8 w-13 rounded-full',
              loaded.store.isActive ? 'bg-pine' : 'bg-busy',
              // 読み取り専用でも手繰れる（tabIndex=0）ので、輪が見えないままにしない。
              focusRing,
            )}
          />
          <span className="text-note text-ink-muted">いまは切り替えられません。</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-5.5">
        {months.map((month) => (
          <MonthCard
            key={`${month.year}-${month.month}`}
            month={month}
            today={day}
            loaded={loaded}
            pending={pending}
            onToggle={toggle}
          />
        ))}
      </div>

      <p className="mt-8 mb-3 text-grid font-semibold text-ink-muted">まとめて決める</p>
      <div className="border-t border-line">
        <div className="flex items-center gap-4 border-b border-line py-4 text-body">
          <span>毎週のお休み</span>
          <span className="ml-auto text-ink-muted">
            {weeklyOff.length > 0 ? weeklyOff.join('・') : 'ありません'}
          </span>
        </div>
        <div className="flex items-center gap-4 py-4 text-body">
          <span>臨時のお休み</span>
          <span data-testid="closed-days" className="ml-auto text-right text-ink-muted">
            {closedDays.length > 0 ? closedDays.join('　') : '臨時のお休みはありません'}
          </span>
        </div>
      </div>
    </div>
  )
}

/** 1 か月ぶんのカード。週は月曜から始まる。 */
function MonthCard({
  month,
  today,
  loaded,
  pending,
  onToggle,
}: {
  month: YearMonth
  today: string
  loaded: Loaded
  pending: Record<string, Intent>
  onToggle: (date: LocalDate) => void
}) {
  const blanks = (weekdayOf(firstDateOf(month)) + 6) % 7
  const days = daysInMonth(month)

  return (
    <section
      aria-label={`${month.year}年${month.month}月`}
      className="rounded-panel border border-line bg-surface px-3.5 pt-3.5 pb-4"
    >
      <h3 className="mb-2.5 text-lead font-semibold">
        {month.year}年 {month.month}月
      </h3>
      <div className="grid grid-cols-7 justify-items-center gap-1">
        {WEEKDAYS_FROM_MONDAY.map((weekday) => (
          <span
            key={weekday}
            data-testid="weekday-head"
            aria-hidden="true"
            className="text-fine leading-normal text-ink-muted"
          >
            {WEEKDAY_NAMES[weekday]}
          </span>
        ))}
        {Array.from({ length: blanks }, (_, index) => (
          <span key={`blank-${index}`} aria-hidden="true" className="size-10" />
        ))}
        {Array.from({ length: days }, (_, index) => {
          const date = dateOf(month, index + 1)
          return (
            <DayCircle
              key={date}
              date={date}
              day={index + 1}
              isToday={date === today}
              state={dayStateOf(date, loaded, pending)}
              onToggle={onToggle}
            />
          )
        })}
      </div>
    </section>
  )
}

/** 1 日ぶんの丸。定休の日は押せない（曜日の休みは営業時間の面で決める）。 */
function DayCircle({
  date,
  day,
  isToday,
  state,
  onToggle,
}: {
  date: LocalDate
  day: number
  isToday: boolean
  state: DayState
  onToggle: (date: LocalDate) => void
}) {
  const name = `${dateLabel(date)} ${DAY_STATE_LABELS[state]}${isToday ? ' 本日' : ''}`
  const mark = DAY_STATE_MARKS[state]
  const closed = state === 'weekly-closed' || state === 'exception-closed'
  const shape = cn(
    // 丸は 40px（モックの実測）。当たり判定だけを ::before で 44pt へ広げる。
    'relative grid size-10 place-content-center rounded-circle border text-grid font-semibold leading-tight',
    "before:absolute before:-inset-0.5 before:content-['']",
    closed
      ? 'border-line-strong bg-busy text-ink-muted'
      : 'border-pine-line bg-pine-soft text-pine-deep',
    isToday && 'border-3 border-pine',
  )
  const face = (
    <>
      <span aria-hidden="true">{day}</span>
      {mark !== '' && (
        <span aria-hidden="true" className="block text-fine font-semibold">
          {mark}
        </span>
      )}
    </>
  )

  if (state === 'weekly-closed') {
    return (
      <span data-date={date} data-state={state} className={shape}>
        {face}
        <span className="sr-only">{name}</span>
      </span>
    )
  }
  return (
    <button
      type="button"
      data-date={date}
      data-state={state}
      aria-label={name}
      onClick={() => onToggle(date)}
      className={cn(shape, focusRing)}
    >
      {face}
    </button>
  )
}

/* --- 日付の算数（JST の壁掛けカレンダーそのもの） ------------------------- */

type YearMonth = { year: number; month: number }

/** today の月と、その次の月。モックは 2 か月を並べる。 */
function monthsFrom(today: string): [YearMonth, YearMonth] {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
  return [{ year, month }, next]
}

function dateOf(month: YearMonth, day: number): LocalDate {
  return `${month.year}-${pad(month.month)}-${pad(day)}`
}

function firstDateOf(month: YearMonth): LocalDate {
  return dateOf(month, 1)
}

function lastDateOf(month: YearMonth): LocalDate {
  return dateOf(month, daysInMonth(month))
}

/** 月の日数。うるう年は Date.UTC に任せる（JST のずれは日数に影響しない）。 */
function daysInMonth(month: YearMonth): number {
  return new Date(Date.UTC(month.year, month.month, 0)).getUTCDate()
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 9月30日（水）。年は 2 か月とも同じ面に出ているので入れない。 */
function dateLabel(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日（${
    WEEKDAY_NAMES[weekdayOf(date)]
  }）`
}

/* --- 1 日の状態 ---------------------------------------------------------- */

/** 例外 → 曜日の順に解く。押しかけの変更は保存前でも見た目に効かせる。 */
function dayStateOf(
  date: LocalDate,
  loaded: Loaded | null,
  pending: Record<string, Intent>,
): DayState {
  if (!loaded) return 'open'
  const weekly = loaded.hours.rows.find((row) => row.weekday === weekdayOf(date))
  if (!weekly || weekly.isClosed) return 'weekly-closed'

  const intent = pending[date]
  if (intent === 'closed') return 'exception-closed'
  if (intent === 'open') return 'open'
  const saved = loaded.exceptions.find((row) => row.date === date)
  if (saved?.kind === 'closed') return 'exception-closed'
  if (saved?.kind === 'special') return 'special'
  return 'open'
}

/** 「臨時のお休み」の行に並べる文字列（9月30日（水）　棚卸しのため）。 */
function listClosedDays(
  exceptions: CalendarException[],
  pending: Record<string, Intent>,
  from: LocalDate,
  to: LocalDate,
): string[] {
  const dates = new Set<string>()
  for (const row of exceptions) {
    if (row.kind === 'closed' && pending[row.date] !== 'open') dates.add(row.date)
  }
  for (const [date, intent] of Object.entries(pending)) {
    if (intent === 'closed') dates.add(date)
  }
  return [...dates]
    .filter((date) => date >= from && date <= to)
    .sort()
    .map((date) => {
      const note = exceptions.find((row) => row.date === date)?.note
      const label = dateLabel(date)
      return note ? `${label}　${note}` : label
    })
}

/* --- 保存 ---------------------------------------------------------------- */

/** 1 日ぶんを書く。通ったら null、落ちたら HTTP の status を返す。 */
async function writeOne(
  storeId: string,
  date: string,
  intent: Intent,
  exceptions: CalendarException[],
): Promise<number | null> {
  if (intent === 'closed') {
    const res = await client.api.staff.stores[':storeId']['calendar-exceptions'].$post({
      param: { storeId },
      json: { date, kind: 'closed', opensAt: null, closesAt: null, note: null },
    })
    return res.ok ? null : res.status
  }
  const saved = exceptions.find((row) => row.date === date)
  if (!saved) return null
  const res = await client.api.staff.stores[':storeId']['calendar-exceptions'][
    ':exceptionId'
  ].$delete({ param: { storeId, exceptionId: saved.id } })
  return res.ok ? null : res.status
}
