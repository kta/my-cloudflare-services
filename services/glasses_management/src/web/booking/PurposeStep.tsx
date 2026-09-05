import type {
  AvailabilityReason,
  AvailabilityResponse,
  AvailabilitySlot,
  ReceptionSessionDraft,
  VisitPurpose,
} from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { cn, focusRing } from '@app/ui'
import { useEffect, useState } from 'react'
import { client } from '../client'
import { dateLabel, jstClock } from '../ledger/metrics'
import type { StepGuard } from './steps'

/*
 * 工程 2「ご来店の目的」（承認済みモック
 * docs/frontend/mockups/eye/images/BOOK-02-PURPOSE.png と BOOK-02b-PURPOSE-CONFLICT.png）。
 *
 * 目的を押すだけで所要時間が決まり、先に伺った時刻にその所要が収まるかを同じ面で確かめる。
 * **収まらなくても工程は戻さない。**理由を 1 文で言い、代わりの時刻を同じ面に 3 つまで出す。
 *
 * 実測（screens/BOOK-02*.html の <style> と assets/eye.css）:
 *   目的の札は 3 列・間 12px・最小高 96px・角 12px、題 17px/600、所要 13px、
 *   「✓ 選んでいます」12px/600（--brand-dark）。選ぶと 3px の緑罫 + --brand-tint
 *   「お取りする時間」は 4 列・間 14px・最小高 64px（45分 短め / 60分 標準 / 75分 ゆっくり / 90分 じっくり）
 *   警告の箱は内側 24px 26px、見出し 21px（--alert）、理由 15px（下 20px）、代替の札は最小高 56px・18px
 *   要約は dt 12px（上に 22px）／ dd 17px/600
 */

export type PurposeStepProps = {
  storeId: string
  receptionSessionId: string | null
  draft: ReceptionSessionDraft
  onDraftChange: (draft: ReceptionSessionDraft) => void
  onGuardChange: (guard: StepGuard) => void
  /** 代わりの時刻が 1 つも無いとき、工程 1 へ戻して行き止まりにしない。 */
  onPickAnotherDay: () => void
}

/** 「お取りする時間」の 4 択（`design/05-screen-flow.md` §5.1）。 */
const DURATIONS = [
  { minutes: 45, label: '短め' },
  { minutes: 60, label: '標準' },
  { minutes: 75, label: 'ゆっくり' },
  { minutes: 90, label: 'じっくり' },
] as const

/**
 * 置けない理由の 1 文。**3 事由を 1 文で束ねない**ので、値ごとに 1 文だけを持つ。
 * `AvailabilitySlot.reason` は語だけで、塞いでいる設備の名前も点検の開始時刻も
 * 応答に載っていないため、名前を当て推量で入れない。
 */
const REASON_TEXT: Record<AvailabilityReason | 'purpose_unavailable', string> = {
  closed: 'この日は定休日です。',
  outside_hours: 'その時間は営業時間の外です。',
  break: 'その時間は受付を止めています。',
  maintenance: '設備・場所の点検が入っています。',
  staff_busy: 'その時間は担当に先約があります。',
  staff_off: 'その時間に勤務している担当がいません。',
  equipment_busy: '必要な設備・場所がすべて埋まっています。',
  no_equipment: 'このご用件に必要な設備・場所がこのお店にありません。',
  no_skill: 'このご用件を承れる担当がいません。',
  max_parallel: '同じ時刻にお受けできる件数がいっぱいです。',
  web_window: 'その時間は Web でのご予約を受け付けていません。',
  lead_time: 'その時間はご予約を受け付けられる期限を過ぎています。',
  purpose_unavailable: 'このご用件はいまお受けできません。',
}

/** 「10:00–11:00」。代わりの時刻の札に出す。 */
function spanLabel(slot: AvailabilitySlot): string {
  return `${jstClock(slot.startsAt)}–${jstClock(slot.endsAt)}`
}

/** 目的の所要時間を 4 択のどれに載せるか。短くしすぎない側（以上でいちばん小さい札）へ倒す。 */
function durationFor(purpose: VisitPurpose): number {
  const longest = DURATIONS[DURATIONS.length - 1]
  const fitted = DURATIONS.find((choice) => choice.minutes >= purpose.durationMinutes)
  return fitted?.minutes ?? longest?.minutes ?? 90
}

export function PurposeStep({
  storeId,
  receptionSessionId,
  draft,
  onDraftChange,
  onGuardChange,
  onPickAnotherDay,
}: PurposeStepProps) {
  const [purposes, setPurposes] = useState<readonly VisitPurpose[] | null>(null)
  const [answer, setAnswer] = useState<AvailabilityResponse | null>(null)
  const [failed, setFailed] = useState(false)

  const purposeId = draft.purposeIds[0] ?? null
  const duration = draft.durationMinutes
  const startsAt = draft.startsAt

  // 目的の一覧は設定（P1）の並び順のまま出す。画面で並べ替えない。
  useEffect(() => {
    let live = true
    async function read() {
      const res = await client.api.staff.purposes.$get({ query: { storeId } })
      if (!live) return
      if (!res.ok) {
        setFailed(true)
        return
      }
      setPurposes(await res.json())
    }
    read().catch(() => {
      if (live) setFailed(true)
    })
    return () => {
      live = false
    }
  }, [storeId])

  /*
   * 目的と所要が決まったところで、先に伺った時刻に収まるかを確かめる。
   * 工程 1 は目的が未確定のまま暫定の所要で枠を出しているので、ここが本当の可否である。
   */
  useEffect(() => {
    if (purposeId === null || duration === null || startsAt === null) return
    let live = true
    setAnswer(null)
    setFailed(false)
    async function read() {
      const res = await client.api.staff.availability.$get({
        query: {
          storeId,
          date: toJstDateString(new Date(String(startsAt))),
          axis: 'staff',
          purposeIds: String(purposeId),
          durationMinutes: String(duration),
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
    read().catch(() => {
      if (live) setFailed(true)
    })
    return () => {
      live = false
    }
  }, [storeId, purposeId, duration, startsAt, receptionSessionId])

  const chosen = purposes?.find((row) => row.id === purposeId) ?? null
  const checking = purposeId !== null && answer === null && !failed
  const fits = answer?.slots.some((slot) => slot.startsAt === startsAt && slot.isAvailable) === true
  const conflicted = answer !== null && !fits

  // 「次へ」が押せるのは、ご用件が選ばれていて、その所要が伺った時刻に収まるときだけ（§5.1）。
  useEffect(() => {
    if (purposeId === null) {
      onGuardChange({ canProceed: false, blockedReason: 'ご用件をお選びになると進めます' })
      return
    }
    if (failed) {
      onGuardChange({ canProceed: false, blockedReason: 'お時間を確かめ直すと進めます' })
      return
    }
    if (answer === null) {
      onGuardChange({ canProceed: false, blockedReason: 'お時間を確かめています' })
      return
    }
    onGuardChange(
      fits
        ? { canProceed: true, blockedReason: '' }
        : { canProceed: false, blockedReason: 'お時間を選び直すと進めます' },
    )
  }, [purposeId, failed, answer, fits, onGuardChange])

  const blockingReason: AvailabilityReason | 'purpose_unavailable' | null =
    answer === null
      ? null
      : (answer.slots.find((slot) => slot.startsAt === startsAt)?.reason ?? answer.reason)
  const alternatives = answer?.alternatives.slice(0, 3) ?? []
  const endsAt =
    startsAt === null || duration === null
      ? null
      : new Date(Date.parse(startsAt) + duration * 60_000).toISOString()

  return (
    <>
      <main className="min-w-0 flex-1 overflow-y-auto px-11 py-9">
        <section>
          <div className="mb-2.5 flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-1.5 h-4.5 w-5.5 shrink-0 rounded-ctl rounded-bl-none bg-pine"
            />
            <div>
              <h2 className="text-title font-semibold text-ink">
                本日はどのようなご用件でしょうか？
              </h2>
              <p className="mt-0.5 text-grid text-ink-muted">
                ひとつ押してください。所要時間が決まります。
              </p>
            </div>
          </div>

          {purposes === null ? (
            <p role="status" className="text-body text-ink-muted">
              ご来店の目的を読み込んでいます…
            </p>
          ) : purposes.length === 0 ? (
            <p className="text-body text-ink-muted">
              ご来店の目的がまだ登録されていません。設定でご用件を足してください。
            </p>
          ) : (
            <fieldset aria-label="ご来店の目的" className="grid grid-cols-3 gap-3">
              {purposes.map((purpose) => {
                const picked = purpose.id === purposeId
                return (
                  <button
                    key={purpose.id}
                    type="button"
                    aria-pressed={picked}
                    onClick={() =>
                      onDraftChange({
                        ...draft,
                        purposeIds: [purpose.id],
                        durationMinutes: durationFor(purpose),
                      })
                    }
                    className={cn(
                      'min-h-24 rounded-card text-left text-lead font-semibold',
                      picked
                        ? 'border-3 border-pine bg-pine-soft px-3 py-2.5 text-pine-deep'
                        : 'border border-line-strong bg-surface px-3.5 py-3 text-ink',
                      focusRing,
                    )}
                  >
                    {purpose.nameInternal}
                    <span className="mt-1 block text-grid font-normal text-ink-muted">
                      約{purpose.durationMinutes}分
                    </span>
                    {picked && (
                      <span className="mt-1.5 block text-note font-semibold text-pine-deep">
                        ✓ 選んでいます
                      </span>
                    )}
                  </button>
                )
              })}
            </fieldset>
          )}
        </section>

        {/*
          収まらないと分かったら「お取りする時間」の 4 列を落とし、その場所を警告の箱へ渡す
          （承認済みモック BOOK-02b-PURPOSE-CONFLICT）。残したまま下へ足すと、
          札が 6 + 4 + 3 枚になって警告の箱と代わりの時刻が帯の下へ隠れる。
          所要はご用件を押し直せば決まり直すので、道が閉じるわけではない。
        */}
        {!conflicted && (
          <section className="mt-11">
            <h3 className="mb-3 text-body font-semibold text-ink">お取りする時間</h3>
            <fieldset aria-label="お取りする時間" className="grid grid-cols-4 gap-3.5">
              {DURATIONS.map((choice) => {
                const picked = choice.minutes === duration
                return (
                  <button
                    key={choice.minutes}
                    type="button"
                    aria-label={`${choice.minutes}分　${choice.label}`}
                    aria-pressed={picked}
                    onClick={() => onDraftChange({ ...draft, durationMinutes: choice.minutes })}
                    className={cn(
                      'grid min-h-16 place-items-center rounded-card text-lead font-semibold',
                      picked
                        ? 'border-3 border-pine bg-pine-soft text-pine-deep'
                        : 'border border-line-strong bg-surface text-ink',
                      focusRing,
                    )}
                  >
                    {choice.minutes}分
                    <span className="block text-note font-normal text-ink-muted">
                      {choice.label}
                    </span>
                  </button>
                )
              })}
            </fieldset>
          </section>
        )}

        {failed && (
          <p role="alert" className="mt-11 text-body text-ink">
            受け付けられるかどうかを確かめられませんでした。もう一度お選びください。
          </p>
        )}

        {conflicted && startsAt !== null && duration !== null && (
          <section className="mt-10">
            <fieldset
              aria-label="受付できない時刻のご案内"
              className="rounded-panel border border-danger bg-danger-soft px-6.5 py-6"
            >
              <h3 className="mb-2 text-title font-semibold text-danger">
                {jstClock(startsAt)} から{duration}分の受付ができません
              </h3>
              <p className="mb-5 text-body text-ink">
                {blockingReason === null
                  ? 'その時間はお受けできません。'
                  : REASON_TEXT[blockingReason]}
                {alternatives.length > 0 && '近いお時間ですと、次のとおりお取りできます。'}
              </p>
              {alternatives.length > 0 ? (
                <div className="flex flex-wrap items-center gap-3.5">
                  {alternatives.map((slot) => (
                    <button
                      key={slot.startsAt}
                      type="button"
                      onClick={() => onDraftChange({ ...draft, startsAt: slot.startsAt })}
                      className={cn(
                        'min-h-14 rounded-card border border-line-strong bg-surface px-4.5 text-lead font-semibold text-ink',
                        focusRing,
                      )}
                    >
                      {spanLabel(slot)}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid justify-items-start gap-3.5">
                  <p className="text-body text-ink">{`この日は ${duration}分 の枠が空いていません。`}</p>
                  <button
                    type="button"
                    onClick={onPickAnotherDay}
                    className={cn(
                      'min-h-14 rounded-card bg-pine px-4.5 text-lead font-bold text-on-pine',
                      focusRing,
                    )}
                  >
                    別の日を選ぶ
                  </button>
                </div>
              )}
            </fieldset>
          </section>
        )}
      </main>

      <aside
        aria-label="ここまでのご予約"
        className="w-93 shrink-0 overflow-y-auto border-l border-line bg-surface px-7 py-9"
      >
        <h3 className="mb-1 text-body font-semibold text-ink">ここまでのご予約</h3>
        <dl className="m-0">
          <dt className="mt-5.5 text-note text-ink-muted">ご来店日</dt>
          <dd className="mt-0.5 text-lead font-semibold text-ink">
            {startsAt === null
              ? 'このあと伺います'
              : dateLabel(toJstDateString(new Date(startsAt)))}
          </dd>
          <dt className="mt-5.5 text-note text-ink-muted">ご来店時刻</dt>
          <dd className="mt-0.5 text-lead font-semibold text-ink">
            {startsAt === null ? 'このあと伺います' : jstClock(startsAt)}
            {conflicted && (
              <span className="ml-1.5 inline-block min-h-5.5 rounded-ctl border border-danger bg-danger-soft px-2 text-note font-semibold text-danger">
                受付できません
              </span>
            )}
          </dd>
          <dt className="mt-5.5 text-note text-ink-muted">ご来店の目的</dt>
          <dd
            className={cn(
              'mt-0.5 text-lead',
              chosen === null ? 'font-normal text-ink-muted' : 'font-semibold text-ink',
            )}
          >
            {chosen === null ? 'このあと伺います' : chosen.nameInternal}
          </dd>
          {conflicted ? (
            <>
              <dt className="mt-5.5 text-note text-ink-muted">所要時間</dt>
              <dd className="mt-0.5 text-lead font-semibold text-ink">約{duration}分</dd>
            </>
          ) : (
            <>
              <dt className="mt-5.5 text-note text-ink-muted">お客様</dt>
              <dd className="mt-0.5 text-lead font-normal text-ink-muted">このあと伺います</dd>
            </>
          )}
        </dl>
        <p className="mt-8 text-grid text-ink-muted">
          {conflicted
            ? 'お時間だけ選び直せます。入力はそのまま残ります。'
            : fits && startsAt !== null && endsAt !== null
              ? `${jstClock(startsAt)}–${jstClock(endsAt)} で受け付けられます。`
              : checking
                ? 'その時間で受け付けられるかを確かめています…'
                : 'ご用件を伺うと、所要時間が決まります。'}
        </p>
      </aside>
    </>
  )
}
