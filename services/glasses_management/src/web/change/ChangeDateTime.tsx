import type {
  AvailabilityResponse,
  AvailabilitySlot,
  BusinessHoursView,
  LocalDate,
} from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { cn, focusRing } from '@app/ui'
import { useEffect, useState } from 'react'
import { client } from '../client'
import { jstClock, shiftDate } from '../ledger/metrics'
import { WEEKDAY_NAMES } from '../settings/sections'

/*
 * 日時を変える（承認済みモック docs/frontend/mockups/eyex/images/CHANGE-DATETIME.png）。
 *
 * 題材: いまのご予約を左に置いたまま、所要時間が収まる時刻だけから新しい日時を選ぶ面。
 * シグネチャ: **候補の先頭に「いまのまま」が居座り、時刻を選び直さずに進めること**（AC-CHANGE-25）。
 *
 * 実測（screens/CHANGE-DATETIME.html と assets/eyex.css）:
 *   2 段組みは 300px 1fr（`w-75`）。左ペイン padding 36px 26px・見出し 15px・
 *   日時 20px/1.4 の --brand-dark・項目名 12px（上 24px）・値 17px/600・補足 13px。
 *   日付は 7 列 gap 10px・min-height 76px（`min-h-19`）・21px/600。選択中は 3px の緑罫 +
 *   --brand-tint、定休は --surface-2 に --ink-3 で「定休」を添えて押せなくする。
 *   時刻は 5 列 gap 12px・min-height 96px（`min-h-24`）・padding 14px・24px/600・
 *   札の文 13px（上 6px）。選択中は 3px の罫。満席は --surface-2 で `disabled`。
 *   選んだ結果は 20px/1.5 の緑の 1 文。下辺は工程バー 76px（`h-19`）。
 *
 * **空き枠は「いまのご予約を除いて」数え直す**（`excludeReservationId`）。除かないと、
 * いま自分が入っている 11:00 が自分の押さえで満席になり、担当だけを変えたいときに
 * 時刻を選び直させることになる。
 *
 * この面が描かないもの: 受付の録音（`.rec`）… `010-recording`（P7）が足す。
 */

/** 暦に出す日数。モック CHANGE-DATETIME はいまのご予約の日から 7 日ぶんを描く。 */
const CALENDAR_DAYS = 7
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
/** 残り何秒で警告を出すか（`07-nfr.md` §2.8 / Q-06 のいまの前提）。 */
const WARN_SECONDS = 60
/** 仮の押さえの長さ。端末の時計がずれていても「あと5290分」と出さないための上限でもある。 */
const HOLD_SECONDS = 420
/** 420 秒を取り直せる回数の上限（同上）。 */
const MAX_RENEWALS = 10
/*
 * 時刻の札は 1 画面 8 枚まで（`docs/frontend/mockups/eyex/README.md` の引き算の規準
 * 「一覧・表の行 / 選択の札 … 8つまで」）。サーバは営業時間ぶんの格子を全部返すので、
 * そのまま並べると 5 列 × 4 段の 18 枚になり、**選んだ結果の 1 文と仮の押さえの残り時間が
 * 画面の下に押し出されて見えなくなる。**P3 の `booking/DateTimeStep.tsx` と同じ窓にする。
 */
/*
 * 読み込み中に場所を取っておく札の枠の数。
 * 読み終えたら**サーバが返した枠を全部出す** —— 8 枚で切って畳んでいたときに
 * 隠れるのは営業時間の後ろ半分、つまり午後と夕方で、変更先の相談中に
 * いちばん空いている時間帯を一度も案内しないことになる（UX 監査 CHG-02 / BOOK-05）。
 * 入りきらないぶんは右の段全体が縦に流れる（予約フローの `booking/DateTimeStep.tsx` と同じ）。
 */
const SLOT_PLACEHOLDERS = 8

/** 工程の帯。BOOK の 5 工程とは別の 4 段である（`design/05-screen-flow.md` §2.2）。 */
const CHANGE_STEPS = ['予約を探す', '日時を変える', 'ご確認', '完了'] as const

/** 「8月27日（木）」。年は落とす（暦の中は同じ 7 日である）。 */
function dayName(date: LocalDate): string {
  const day = new Date(`${date}T00:00:00.000Z`)
  return `${day.getUTCMonth() + 1}月${day.getUTCDate()}日（${WEEKDAY_NAMES[day.getUTCDay()]}）`
}

/** 札に大きく出す日にちの数字。 */
function dayNumber(date: LocalDate): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDate()
}

function weekdayOf(date: LocalDate): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay()
}

/** 「2026年8月」。暦の見出しは先頭の日の月で言う。 */
function monthLabel(date: LocalDate): string {
  const day = new Date(`${date}T00:00:00.000Z`)
  return `${day.getUTCFullYear()}年${day.getUTCMonth() + 1}月`
}

/** 残り時間の言い方。**分だけに丸めない**（`booking/ConfirmStep.tsx` と同じ綴り）。 */
function remainingLabel(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  const rest = seconds % SECONDS_PER_MINUTE
  if (minutes === 0) return `あと${rest}秒`
  return rest === 0 ? `あと${minutes}分` : `あと${minutes}分${rest}秒`
}

/** いま入っているご予約の姿（左の「いまのご予約」と、確保の 1 文が読む）。 */
export type ChangeTarget = {
  code: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  customerName: string | null
  visitCount: number | null
  /** 店内の名前（`visit_purposes.name_internal`）を連ねたもの。 */
  purposeLabel: string
  staffName: string | null
  equipmentNames: readonly string[]
}

export type ChangeDateTimeProps = {
  storeId: string
  /** 空き枠の数え直しから除くご予約（自分の押さえで自分を塞がない）。 */
  reservationId: string
  target: ChangeTarget
  /** いまの時刻（ISO8601）。端末の時計を読まないため器から注ぐ。 */
  now: string
  /** 選んだ変更先の時刻。まだ選んでいなければ null。 */
  chosenStartsAt: string | null
  onChoose: (startsAt: string) => void
  /** 仮の押さえの期限。押さえていないときは null。 */
  holdExpiresAt: string | null
  /** 420 秒を取り直した回数。10 回で打ち止め。 */
  renewalsUsed?: number
  onKeepEditing: () => void
  onBack: () => void
  onNext: () => void
}

export function ChangeDateTime({
  storeId,
  reservationId,
  target,
  now,
  chosenStartsAt,
  onChoose,
  holdExpiresAt,
  renewalsUsed = 0,
  onKeepEditing,
  onBack,
  onNext,
}: ChangeDateTimeProps) {
  const currentDate = toJstDateString(new Date(target.startsAt))
  const [date, setDate] = useState<LocalDate>(currentDate)
  const [hours, setHours] = useState<BusinessHoursView | null>(null)
  const [answer, setAnswer] = useState<AvailabilityResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)

  /*
   * 営業時間は店舗ごと 1 度だけ読む。暦の札に「定休」と書く手立てがほかに無い
   * （空き枠は 1 日ぶんしか返さないので、7 日ぶんの定休は分からない）。
   */
  useEffect(() => {
    let live = true
    client.api.staff.stores[':storeId']['business-hours']
      .$get({ param: { storeId } })
      .then(async (res) => {
        if (live && res.ok) setHours(await res.json())
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [storeId])

  useEffect(() => {
    let live = true
    setAnswer(null)
    setFailed(false)
    client.api.staff.availability
      .$get({
        query: {
          storeId,
          date,
          axis: 'staff',
          durationMinutes: String(target.durationMinutes),
          excludeReservationId: reservationId,
        },
      })
      .then(async (res) => {
        if (!live) return
        if (!res.ok) {
          setFailed(true)
          return
        }
        setAnswer(await res.json())
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [storeId, date, reservationId, target.durationMinutes, reload])

  const closedWeekdays = new Set(
    (hours?.rows ?? []).filter((row) => row.isClosed).map((row) => row.weekday),
  )
  const days = Array.from({ length: CALENDAR_DAYS }, (_, index) => shiftDate(currentDate, index))
  const today = toJstDateString(new Date(now))
  const closedNote =
    closedWeekdays.size === 0
      ? ''
      : `　　※ 定休日は${[...closedWeekdays]
          .sort((a, b) => a - b)
          .map((weekday) => WEEKDAY_NAMES[weekday])
          .join('・')}曜日です`

  /*
   * 候補の先頭は**いまのご予約自身の時刻**（AC-CHANGE-25）。サーバは自分を除いて
   * 数え直しているので必ず空いているが、格子の刻みからずれていて返ってこないことが
   * ある。返ってこなくてもこの 1 枠だけは自分で置く（自分の枠は必ず取れる）。
   */
  const ownSlot: AvailabilitySlot = {
    startsAt: target.startsAt,
    endsAt: target.endsAt,
    remaining: 1,
    isAvailable: true,
    staffIds: [],
    equipmentIds: [],
    reason: null,
  }
  const served = answer?.slots ?? []
  const slots =
    date === currentDate
      ? [
          served.find((slot) => slot.startsAt === target.startsAt) ?? ownSlot,
          ...served.filter((slot) => slot.startsAt !== target.startsAt),
        ]
      : served
  const shownSlots = slots

  const remainingSeconds =
    holdExpiresAt === null
      ? null
      : Math.min(
          HOLD_SECONDS,
          Math.round((Date.parse(holdExpiresAt) - Date.parse(now)) / MS_PER_SECOND),
        )
  const warning = remainingSeconds !== null && remainingSeconds <= WARN_SECONDS
  const canRenew = renewalsUsed < MAX_RENEWALS
  const place = [target.staffName ?? '担当が未定', ...target.equipmentNames.slice(0, 1)].join('／')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <section
          aria-label="いまのご予約"
          className="w-75 shrink-0 overflow-y-auto border-r border-line bg-surface-2 px-6.5 py-9"
        >
          <h2 className="mb-4.5 text-body font-semibold text-ink">いまのご予約</h2>
          <p className="text-bar font-semibold leading-snug text-pine-deep">
            <span className="block">{dayName(currentDate)}</span>
            <span className="block">
              {`${jstClock(target.startsAt)}–${jstClock(target.endsAt)}`}
            </span>
          </p>
          <dl className="m-0">
            <Now term="お客様" value={`${target.customerName ?? 'お客様'} 様`} />
            <Now
              term="ご用件"
              value={target.purposeLabel}
              note={`所要 ${target.durationMinutes}分`}
            />
            <Now
              term="担当と場所"
              value={target.staffName ?? '担当が未定'}
              {...(target.equipmentNames.length === 0
                ? {}
                : { note: target.equipmentNames.join('／') })}
            />
          </dl>
        </section>

        <div className="min-w-0 flex-1 overflow-y-auto bg-surface px-8 py-9">
          <Ask
            question="お日にちはこのままでよろしいですか？"
            note={`${monthLabel(days[0] ?? currentDate)}${closedNote}`}
          />
          <fieldset aria-label="お日にち" className="grid grid-cols-7 gap-2.5">
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
                  onClick={() => setDate(day)}
                  className={cn(
                    'grid min-h-19 place-items-center rounded-card text-title font-semibold',
                    chosen
                      ? 'border-3 border-pine bg-pine-soft text-pine-deep'
                      : closed
                        ? 'border border-line-strong bg-surface-2 text-ink-faint'
                        : 'border border-line-strong bg-surface text-ink',
                    focusRing,
                  )}
                >
                  <span aria-hidden="true">{dayNumber(day)}</span>
                  {suffix !== '' && (
                    <span aria-hidden="true" className="block text-note font-normal">
                      {suffix.trim()}
                    </span>
                  )}
                </button>
              )
            })}
          </fieldset>

          <div className="mt-11">
            <Ask
              question="お時間は何時ごろがよろしいですか？"
              note={`${target.durationMinutes}分の枠が取れる時刻だけを出しています。`}
            />
            {failed ? (
              <div role="alert" className="grid justify-items-start gap-3">
                <p className="text-body text-ink">受け付けられる時刻を読み込めませんでした。</p>
                <button
                  type="button"
                  onClick={() => setReload((count) => count + 1)}
                  className={cn(
                    'min-h-12 rounded-ctl bg-pine px-6 text-body font-bold text-on-pine',
                    focusRing,
                  )}
                >
                  もう一度読み込む
                </button>
              </div>
            ) : answer === null ? (
              <>
                {/* 読み込み中は札の枠だけを出す。回るアイコンを置かない。 */}
                <p role="status" className="sr-only">
                  受け付けられる時刻を読み込んでいます…
                </p>
                <div aria-hidden="true" className="grid grid-cols-5 gap-3">
                  {Array.from({ length: SLOT_PLACEHOLDERS }, (_, index) => (
                    <div key={index} className="min-h-24 rounded-card bg-surface-2" />
                  ))}
                </div>
              </>
            ) : slots.length === 0 ? (
              <p className="text-body text-ink-muted">
                この日は受け付けられる時刻がありません。ほかの日をお選びください。
              </p>
            ) : (
              <fieldset aria-label="お時間" className="grid grid-cols-5 gap-3">
                {shownSlots.map((slot) => (
                  <Slot
                    key={slot.startsAt}
                    slot={slot}
                    isCurrent={slot.startsAt === target.startsAt}
                    chosen={slot.startsAt === chosenStartsAt}
                    onPick={() => onChoose(slot.startsAt)}
                  />
                ))}
              </fieldset>
            )}
          </div>

          {chosenStartsAt !== null && (
            <p className="mt-9 rounded-panel border border-pine-line bg-pine-soft px-5.5 py-5 text-bar leading-relaxed font-semibold text-pine-deep">
              {`${jstClock(chosenStartsAt)} から${target.durationMinutes}分、${place} を確保します。`}
            </p>
          )}

          {holdExpiresAt !== null && (
            <div className="mt-6">
              <p className="text-grid text-ink-muted">
                <span className="mr-2 font-semibold text-ink">仮の押さえ</span>
                <span className="font-semibold text-ink">{`${jstClock(holdExpiresAt)} まで`}</span>
                <span className="ml-2">
                  {remainingSeconds !== null && remainingSeconds > 0
                    ? remainingLabel(remainingSeconds)
                    : 'お預かりの時間が過ぎました'}
                </span>
              </p>
              {warning && (
                <div className="mt-3 max-w-100">
                  <p
                    role="status"
                    className="rounded-card border border-amber bg-amber-soft px-4 py-3 text-body text-amber"
                  >
                    {canRenew
                      ? 'この枠をあと1分お預かりしています'
                      : 'お預かりの上限です。枠を選び直してください。'}
                  </p>
                  {canRenew && (
                    <button
                      type="button"
                      onClick={onKeepEditing}
                      className={cn(
                        'mt-3 min-h-11 w-full rounded-card border border-line-strong bg-surface text-body font-semibold text-ink',
                        focusRing,
                      )}
                    >
                      まだ入力中です
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <StepBar canProceed={chosenStartsAt !== null} onBack={onBack} onNext={onNext} />
    </div>
  )
}

/** 左の「いまのご予約」の 1 項目。 */
function Now({ term, value, note }: { term: string; value: string; note?: string }) {
  return (
    <>
      <dt className="mt-6 text-note text-ink-muted">{term}</dt>
      <dd className="mt-0.5 text-lead font-semibold text-ink">
        <span className="block">{value}</span>
        {note !== undefined && (
          <span className="block text-grid font-normal text-ink-muted">{note}</span>
        )}
      </dd>
    </>
  )
}

/** 声に出して伺う 1 問（モックの `.ask`）。 */
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
 * 時刻の札 1 つ。**状態は必ず文字で添える**（受付できます／満席／いまのまま／選択中）。
 * 色だけで受けられるかどうかを伝えない。
 */
function Slot({
  slot,
  isCurrent,
  chosen,
  onPick,
}: {
  slot: AvailabilitySlot
  isCurrent: boolean
  chosen: boolean
  onPick: () => void
}) {
  const free = slot.isAvailable && slot.remaining > 0
  const note = chosen ? '選択中' : isCurrent ? 'いまのまま' : free ? '受付できます' : '満席'
  return (
    <button
      type="button"
      aria-label={`${jstClock(slot.startsAt)}　${note}`}
      aria-pressed={chosen}
      disabled={!free}
      onClick={onPick}
      className={cn(
        'flex min-h-24 flex-col items-start rounded-card p-3.5 text-left',
        chosen
          ? 'border-3 border-pine bg-pine-soft text-pine-deep'
          : free
            ? 'border border-line-strong bg-surface text-ink'
            : 'border border-line-strong bg-surface-2 text-ink-faint',
        focusRing,
      )}
    >
      <span aria-hidden="true" className="text-hero font-semibold">
        {jstClock(slot.startsAt)}
      </span>
      <span aria-hidden="true" className="mt-1.5 text-grid leading-snug">
        {note}
      </span>
    </button>
  )
}

/**
 * 下辺の工程の帯（4 段）。**`<nav>` にしない** —— 中身は押せない札なので、
 * `<nav>` にすると読み上げのローターに移動先の無い「ナビゲーション」として出る
 * （`booking/StepBar.tsx` と同じ決め）。戻る手段は左端の `‹`（48pt）だけ。
 */
function StepBar({
  canProceed,
  onBack,
  onNext,
}: {
  canProceed: boolean
  onBack: () => void
  onNext: () => void
}) {
  return (
    <footer className="flex h-19 shrink-0 items-center gap-3.5 border-t border-line bg-surface px-4.5">
      <button
        type="button"
        aria-label="前へ戻る"
        onClick={onBack}
        className={cn(
          'grid size-12 shrink-0 place-items-center rounded-circle border border-line-strong bg-surface text-title text-ink-muted',
          focusRing,
        )}
      >
        <span aria-hidden="true">‹</span>
      </button>

      <ol
        aria-label="予約の変更の工程　全4工程"
        className="flex min-w-0 items-center gap-1.5 overflow-hidden"
      >
        {CHANGE_STEPS.map((label, position) => (
          <li
            key={label}
            aria-current={position === 1 ? 'step' : undefined}
            className="flex items-center gap-1.5"
          >
            {position > 0 && (
              <span aria-hidden="true" className="text-note text-ink-faint">
                ›
              </span>
            )}
            <span
              className={cn(
                'flex min-h-9 items-center gap-1 whitespace-nowrap rounded-full px-3.5 text-grid font-semibold',
                position === 1
                  ? 'bg-pine text-on-pine'
                  : position < 1
                    ? 'bg-pine-soft text-pine-deep'
                    : 'bg-surface-2 text-ink-muted',
              )}
            >
              {position + 1}　{label}
              {/* 通過した札には **常に ✓ を付ける**（色だけで状態を伝えない。
                  `booking/StepBar.tsx` と同じ綴りで、位置も名前のうしろに揃える）。 */}
              {position < 1 && <span aria-hidden="true">✓</span>}
              {position === 1 && <span className="sr-only">　全4工程のうち2つ目</span>}
            </span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        aria-label={
          canProceed ? '変更内容を確認する' : '変更内容を確認する　お時間をお選びになると進めます'
        }
        disabled={!canProceed}
        onClick={onNext}
        className={cn(
          'ml-auto min-h-14 shrink-0 rounded-card border border-pine bg-pine px-6 text-lead font-semibold text-on-pine',
          'disabled:border-line disabled:bg-surface-2 disabled:text-ink-faint',
          focusRing,
        )}
      >
        変更内容を確認する
      </button>
    </footer>
  )
}
