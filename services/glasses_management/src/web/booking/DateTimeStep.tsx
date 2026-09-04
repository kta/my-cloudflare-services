import type {
  AvailabilityResponse,
  AvailabilitySlot,
  BusinessHoursView,
  LocalDate,
  ReceptionSessionDraft,
} from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { cn, focusRing } from '@app/ui'
import { useCallback, useEffect, useState } from 'react'
import { client } from '../client'
import { dateLabel, jstClock, shiftDate } from '../ledger/metrics'
import { WEEKDAY_NAMES } from '../settings/sections'
import type { StepGuard } from './steps'

/*
 * 工程 1「お日にちとお時間」（承認済みモック
 * docs/frontend/mockups/eye/images/BOOK-01-DATETIME.png）。
 *
 * 電話で最初に伺う順（日 → 時間）のまま、1 画面に 2 問だけを置く。
 *
 * 実測（screens/BOOK-01-DATETIME.html の <style> と assets/eye.css）:
 *   本文 1fr ／ 右の要約 372px、境目に 1px の罫。本文の余白 36px 44px、要約 36px 28px
 *   暦は 7 列・間 8px、日の札は最小高 58px・角 8px・18px/600、曜日見出し 12px、「定休」10px
 *   選択中は 3px の緑罫 + --brand-tint。定休は --surface-2 + --ink-3
 *   時刻の札は 4 列・間 14px・最小高 72px・角 12px・19px/600、補足 11px
 *   質問と質問のあいだは 44px。要約は dt 12px（上に 22px）／ dd 17px/600
 *
 * **枠はサーバが返したものだけを並べる。**モックの 8 枠に 12:00 台が無いのは受付を止める
 * 帯（お昼 12:00–13:00）があるからで、間引く分岐を画面側に持たない。
 *
 * 目的をまだ伺っていないので所要は暫定である。そのことを画面の言葉で断り
 * （「目的を伺ったあとに、もう一度確かめます。」）、工程 2 で確かめ直す。
 */

export type DateTimeStepProps = {
  storeId: string
  /** いまの時刻（ISO8601）。実行時刻に依存させないため器から注ぐ。 */
  now: string
  /** 自分の受付が置いた仮の押さえを塞がりに数えさせないための id。 */
  receptionSessionId: string | null
  draft: ReceptionSessionDraft
  onDraftChange: (draft: ReceptionSessionDraft) => void
  onGuardChange: (guard: StepGuard) => void
}

/** 暦に出す日数。モック BOOK-01 は本日を含む週の月曜から 2 週ぶんを描く。 */
const CALENDAR_DAYS = 14
/**
 * 読み込み中に場所を取っておく札の枠の数。承認済みモック BOOK-01 の 1 画面ぶん。
 * 読み終えたら、サーバが返した枠を全部出す（上のコメント）。
 */
const SLOT_PLACEHOLDERS = 8

/** `YYYY-MM-DD` の曜日（0=日 … 6=土）。時差の影響を受けないよう UTC で読む。 */
function weekdayOf(date: LocalDate): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay()
}

/** 「8月27日（木）」。読み上げの名前に使うので年は落とす（暦の中は同じ 2 週）。 */
function dayName(date: LocalDate): string {
  const day = new Date(`${date}T00:00:00.000Z`)
  return `${day.getUTCMonth() + 1}月${day.getUTCDate()}日（${WEEKDAY_NAMES[day.getUTCDay()]}）`
}

/** 札に大きく出す日にちの数字。 */
function dayNumber(date: LocalDate): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDate()
}

/** 本日を含む週の月曜。 */
function calendarStart(today: LocalDate): LocalDate {
  const weekday = weekdayOf(today)
  return shiftDate(today, weekday === 0 ? -6 : 1 - weekday)
}

/** 「2026年8月」。暦の見出しは本日の月で言う。 */
function monthLabel(date: LocalDate): string {
  const day = new Date(`${date}T00:00:00.000Z`)
  return `${day.getUTCFullYear()}年${day.getUTCMonth() + 1}月`
}

export function DateTimeStep({
  storeId,
  now,
  receptionSessionId,
  draft,
  onDraftChange,
  onGuardChange,
}: DateTimeStepProps) {
  const today = toJstDateString(new Date(now))
  /*
   * 開いた瞬間は本日を選んでおく。
   *
   * 以前は日付も時刻も選ばれておらず、時刻の札が 0 枚のまま
   * 「お日にちをお選びください」だけが出ていた（UX 監査 UI-06）。
   * 電話を受けた人がいちばん先に見たいのは今日の空きなので、その 1 タップを省く。
   * 承認済みモック BOOK-01-DATETIME.png も本日を選んだ姿で描かれている。
   * 途中まで入れた下書きがあるときは、そちらを優先する（本日で上書きしない）。
   * 本日が定休のときは選ばない —— 押せない日を選んだ姿にしない（下の効果で外す）。
   */
  const [date, setDate] = useState<LocalDate | null>(() =>
    draft.startsAt === null ? null : toJstDateString(new Date(draft.startsAt)),
  )
  const [hours, setHours] = useState<BusinessHoursView | null>(null)
  const [answer, setAnswer] = useState<AvailabilityResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)

  /*
   * 営業時間は**店舗ごと 1 度だけ**読む。暦の札に「定休」と書く手立てがほかに無い
   * （空き枠は 1 日ぶんしか返さないので、14 日ぶんの定休は分からない）。
   * 読めなくても日時は選べるので、落ちたら「定休」を書かないだけにする。
   */
  useEffect(() => {
    let live = true
    async function read() {
      const res = await client.api.staff.stores[':storeId']['business-hours'].$get({
        param: { storeId },
      })
      if (live && res.ok) setHours(await res.json())
    }
    read().catch(() => undefined)
    return () => {
      live = false
    }
  }, [storeId])

  /*
   * 空き枠は選んだ日のぶんだけを 1 本で読む（`design/07-nfr.md` §4.1）。
   * 自分の受付が置いた仮の押さえは塞がりに数えさせない —— 数えると、11:00 に置いてから
   * 選び直したときに自分の押さえで戻れなくなる。
   */
  useEffect(() => {
    if (date === null) return
    let live = true
    setAnswer(null)
    setFailed(false)
    async function read(day: LocalDate) {
      const res = await client.api.staff.availability.$get({
        query: {
          storeId,
          date: day,
          axis: 'staff',
          ...(receptionSessionId === null ? {} : { excludeReceptionSessionId: receptionSessionId }),
        },
      })
      if (!live) return
      if (!res.ok) {
        setFailed(true)
        return
      }
      setAnswer(await res.json())
    }
    read(date).catch(() => {
      if (live) setFailed(true)
    })
    return () => {
      live = false
    }
  }, [storeId, date, receptionSessionId, reload])

  // 「次へ」が押せる条件は、日付と時刻がどちらも選ばれていること（§5.1）。
  // 押せないときは何が足りないかを名前で言う（理由なしの disabled を置かない）。
  const canProceed = draft.startsAt !== null
  const blockedReason =
    date === null ? 'お日にちとお時間をお選びになると進めます' : 'お時間をお選びになると進めます'
  useEffect(() => {
    onGuardChange({ canProceed, blockedReason: canProceed ? '' : blockedReason })
  }, [canProceed, blockedReason, onGuardChange])

  const pickDate = useCallback(
    (next: LocalDate) => {
      setDate(next)
      // 日を変えたら時刻は選び直す（前の日の 11:00 が残ると別の日を押さえてしまう）。
      if (next !== date) {
        onDraftChange({ ...draft, startsAt: null })
      }
    },
    [date, draft, onDraftChange],
  )

  const days = Array.from({ length: CALENDAR_DAYS }, (_, index) =>
    shiftDate(calendarStart(today), index),
  )
  const closedWeekdays = new Set(
    (hours?.rows ?? []).filter((row) => row.isClosed).map((row) => row.weekday),
  )
  const shownSlots = answer?.slots ?? []

  /*
   * 営業日が届いたら本日を選んでおく。
   *
   * 以前は日付も時刻も選ばれておらず、時刻の札が 0 枚のまま
   * 「お日にちをお選びください」だけが出ていた（UX 監査 UI-06）。
   * 電話を受けた人がいちばん先に見たいのは今日の空きなので、その 1 タップを省く。
   * 承認済みモック BOOK-01-DATETIME.png も本日を選んだ姿で描かれている。
   *
   * **営業日が届くまで選ばない。** 先に選ぶと、本日が定休の日に
   * 押せない札を選んだ姿が一瞬出る。下書きがあるときも触らない。
   */
  useEffect(() => {
    if (date !== null || draft.startsAt !== null || hours === null) return
    if (closedWeekdays.has(weekdayOf(today))) return
    setDate(today)
  }, [date, draft.startsAt, hours, closedWeekdays, today])

  const closedNote =
    closedWeekdays.size === 0
      ? null
      : `※ 定休日は${[...closedWeekdays]
          .sort((a, b) => a - b)
          .map((weekday) => WEEKDAY_NAMES[weekday])
          .join('・')}曜日です`

  return (
    <>
      <main className="min-w-0 flex-1 overflow-y-auto px-11 py-9">
        <section>
          <Ask
            question="お日にちはいつがよろしいですか？"
            note={closedNote === null ? monthLabel(today) : `${monthLabel(today)}　　${closedNote}`}
          />
          <div className="grid grid-cols-7 gap-2">
            {WEEKDAY_ORDER.map((weekday) => (
              <p key={weekday} className="text-center text-note text-ink-muted">
                {WEEKDAY_NAMES[weekday]}
              </p>
            ))}
            {days.map((day) => {
              const closed = closedWeekdays.has(weekdayOf(day))
              const chosen = day === date
              const suffix = closed ? '　定休' : day === today ? '　本日' : ''
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={`${dayName(day)}${suffix}`}
                  aria-pressed={chosen}
                  disabled={closed}
                  onClick={() => pickDate(day)}
                  className={cn(
                    'grid min-h-14.5 place-items-center rounded-ctl text-lead font-semibold',
                    chosen
                      ? 'border-3 border-pine bg-pine-soft text-pine-deep'
                      : closed
                        ? 'border border-line-strong bg-surface-2 text-ink-faint'
                        : 'border border-line-strong bg-surface text-ink',
                    focusRing,
                  )}
                >
                  {dayNumber(day)}
                  {suffix !== '' && (
                    <span className="block text-fine font-normal text-ink-muted">
                      {suffix.trim()}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>

        <section className="mt-11">
          <Ask
            question="お時間は何時ごろがよろしいですか？"
            note="受け付けられる時刻だけを出しています。目的を伺ったあとに、もう一度確かめます。"
          />
          {date === null ? (
            <p className="text-body text-ink-muted">
              お日にちをお選びください。受け付けられる時刻をお出しします。
            </p>
          ) : failed ? (
            <div role="alert" className="grid justify-items-start gap-3">
              <p className="text-body text-ink">受け付けられる時刻を読み込めませんでした。</p>
              <button
                type="button"
                onClick={() => setReload((count) => count + 1)}
                className={cn(
                  'min-h-12 rounded-ctl bg-pine px-6 text-lead font-bold text-on-pine',
                  focusRing,
                )}
              >
                もう一度読み込む
              </button>
            </div>
          ) : answer === null ? (
            <>
              {/* 読み込み中は札の枠だけを出す。回るアイコンを置かない（`design/05-screen-flow.md` §7.1）。 */}
              <p role="status" className="sr-only">
                受け付けられる時刻を読み込んでいます…
              </p>
              <div className="grid grid-cols-4 gap-3.5">
                {Array.from({ length: SLOT_PLACEHOLDERS }, (_, index) => (
                  <div
                    key={index}
                    data-booking-slot-frame
                    aria-hidden="true"
                    className="min-h-18 rounded-card border border-line bg-surface-2"
                  />
                ))}
              </div>
            </>
          ) : answer.isClosed ? (
            <p className="text-body text-ink-muted">
              この日は定休日です。ほかの日をお選びください。
            </p>
          ) : answer.slots.length === 0 ? (
            <p className="text-body text-ink-muted">
              この日は受け付けられる時刻がありません。ほかの日をお選びください。
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-3.5">
              {shownSlots.map((slot) => (
                <SlotCard
                  key={slot.startsAt}
                  slot={slot}
                  chosen={slot.startsAt === draft.startsAt}
                  onPick={() => onDraftChange({ ...draft, startsAt: slot.startsAt })}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <aside
        aria-label="ここまでのご予約"
        className="w-93 shrink-0 overflow-y-auto border-l border-line bg-surface px-7 py-9"
      >
        <h3 className="mb-1 text-body font-semibold text-ink">ここまでのご予約</h3>
        <dl className="m-0">
          <SummaryRow label="ご来店日" value={date === null ? null : dateLabel(date)} />
          <SummaryRow
            label="ご来店時刻"
            value={draft.startsAt === null ? null : jstClock(draft.startsAt)}
          />
          <SummaryRow label="ご来店の目的" value={null} />
          <SummaryRow label="お客様" value={null} />
        </dl>
        <p className="mt-8 text-grid text-ink-muted">
          所要時間はご来店の目的を伺ってから決まります。
        </p>
      </aside>
    </>
  )
}

/** 暦の見出しの並び（月曜始まり）。 */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

/** 声に出して伺う 1 問。モックの `.ask`（吹き出し 22×18 + 見出し 22px + 補足 14px）。 */
function Ask({ question, note }: { question: string; note: string }) {
  return (
    <div className="mb-2.5 flex items-start gap-2.5">
      <span
        aria-hidden="true"
        className="mt-1.5 h-4.5 w-5.5 shrink-0 rounded-ctl rounded-bl-none bg-pine"
      />
      <div>
        <h2 className="text-title font-semibold text-ink">{question}</h2>
        <p className="mt-0.5 text-grid text-ink-muted">{note}</p>
      </div>
    </div>
  )
}

/**
 * 受け付けられない札に書く一言。**「満席」に丸めない。**
 *
 * 札は 30 分幅で文字が数字ぶんしか入らないので、`slot-drag.ts` の `blockedText` のような
 * 一文ではなく、同じ語彙の短い名詞にする。丸めてしまうと、この画面を読み上げる
 * アルバイトが休憩の時間を「満席です」とお客様に伝えることになる（UX 監査 BOOK-06）。
 */
function blockedNote(reason: AvailabilitySlot['reason']): string {
  switch (reason) {
    case 'closed':
      return 'お休み'
    case 'outside_hours':
      return '時間外'
    case 'break':
      return '休憩'
    case 'maintenance':
      return '点検'
    case 'no_skill':
    case 'no_equipment':
      return '受けられません'
    case 'web_window':
    case 'lead_time':
      return '受付前'
    // staff_busy / staff_off / equipment_busy / max_parallel は「先約で埋まっている」。
    default:
      return '満席'
  }
}

/** 時刻の札 1 つ。 */
function SlotCard({
  slot,
  chosen,
  onPick,
}: {
  slot: AvailabilitySlot
  chosen: boolean
  onPick: () => void
}) {
  const free = slot.isAvailable && slot.remaining > 0
  const clock = jstClock(slot.startsAt)
  const note = free ? `あと${slot.remaining}枠` : blockedNote(slot.reason)
  return (
    <button
      type="button"
      aria-label={`${clock}　${note}`}
      aria-pressed={chosen}
      disabled={!free}
      onClick={onPick}
      className={cn(
        'grid min-h-18 place-items-center rounded-card text-bar font-semibold',
        chosen
          ? 'border-3 border-pine bg-pine-soft text-pine-deep'
          : free
            ? 'border border-line-strong bg-surface text-ink'
            : 'border border-line-strong bg-surface-2 text-ink-faint',
        focusRing,
      )}
    >
      {clock}
      <span className="block text-fine font-normal text-ink-muted">{note}</span>
    </button>
  )
}

/** 要約の 1 行。伺えていない欄は空けずに「このあと伺います」と言い切る。 */
function SummaryRow({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="mt-5.5 text-note text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-lead',
          value === null ? 'font-normal text-ink-muted' : 'font-semibold text-ink',
        )}
      >
        {value ?? 'このあと伺います'}
      </dd>
    </>
  )
}
