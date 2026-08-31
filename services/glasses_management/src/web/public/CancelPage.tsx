import { toJstDateString } from '@app/shared'
import { focusRing, focusRingOnPine } from '@app/ui'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { dateLabel, jstClock } from '../ledger/metrics'

/*
 * ご予約の確認・変更・取り消し（承認済みモック docs/frontend/mockups/eyex/images/WEB-CANCEL.png）。
 *
 * この面の仕事は「番号 2 つだけで自分の予約に戻り、変更と取消の 2 つの出口だけを置く」こと。
 *
 * 実測値（screens/WEB-CANCEL.html と assets/eyex.css）:
 *   進捗は 2 段（本人確認 → 表示。どちらも点灯）。本文の余白 32px 28px 152px。
 *   問いかけは見出し 20px・補足 13px、左の吹き出し 18×15px。
 *   明細は上に 24px、見出し列 **78px**（WEB-06 の 66px より広い）・13px、値 16px 太さ 600。
 *   ご来店の行だけ 20px `--color-pine-deep`、ご予約番号の行は等幅。
 *   期限の 1 行は上に 24px・13px `--color-ink-muted`。
 *   下の固定は「日時を変更する」（56px の緑）と
 *   「この予約を取り消す」（48px・文字と縁が `--color-danger`・塗らない・上に 10px）。
 *
 * **存在の有無を漏らさない**（`07-nfr.md` §6.2）。存在しないご予約番号・確認番号違い・
 * 非公開店舗の slug は、すべてこの 1 文に落とす。
 */

const MISMATCH = 'ご予約番号か確認番号が違います。お送りしたメールの番号をお確かめください。'
const LOCKED = 'お待ちください。15分ほど経ってから、もう一度お試しください。'
const EXPIRED = 'お時間が経ちましたので、もう一度ご予約番号と確認番号をご入力ください。'
const FAILED = 'うまく処理できませんでした。入力はそのまま残っています。もう一度お試しください。'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** 照会で見つかった予約。**確認番号を持たない**（平文が返るのは予約を作った 1 回だけ）。 */
export type ManagedReservation = {
  code: string
  status: 'pending' | 'confirmed' | 'cancelled'
  startsAt: string
  endsAt: string
  storeName: string
  /** 締切を過ぎたときにお伝えするお店のお電話番号。 */
  storePhone: string
  /** 対客名（`visit_purposes.name_public`）。 */
  purposeName: string
  durationMinutes: number
  contactName: string
  /** 変更・取消の締切（`web_booking_settings.change_deadline_days` から作った時刻）。 */
  changeDeadlineAt: string
}

/** 通らなかった理由。どれもお客様には「番号が違います」以上を言わない。 */
export type ManageFailure = 'mismatch' | 'locked' | 'expired' | 'deadline' | 'failed'

export type ManageOutcome<T> = { ok: true; value: T } | { ok: false; reason: ManageFailure }

export type CancelPageProps = {
  /** いまの時刻。端末の時計を読まない（応答の `serverNow` を渡す）。 */
  now: string
  onLookup: (input: {
    code: string
    managementCode: string
  }) => Promise<ManageOutcome<ManagedReservation>>
  onChangeDateTime: (startsAt: string) => Promise<ManageOutcome<ManagedReservation>>
  onCancelReservation: () => Promise<ManageOutcome<{ cancelledAt: string }>>
  /**
   * 日時の選び直し。WEB-03-DATETIME をそのまま差し込む口で、この面は見出しと配線だけを持つ
   * （専用の画面を起こさない）。器が `DateTimeStep` を渡す。
   */
  renderChangeDateTime?: (props: {
    heading: string
    onPick: (startsAt: string) => void
    onBack: () => void
  }) => ReactNode
  isOffline?: boolean
  onRetry?: () => void
}

type Stage =
  | { kind: 'lookup' }
  | { kind: 'detail'; reservation: ManagedReservation }
  | { kind: 'change'; reservation: ManagedReservation }
  | { kind: 'cancelled' }

const FIELD = `min-h-13 w-full rounded-card border border-line-strong bg-surface px-3.5 text-body text-ink placeholder:text-ink-faint focus:border-pine ${focusRing}`

/** 「8月29日（土）11:00」。 */
function visitLabel(startsAt: string): string {
  return `${dateLabel(toJstDateString(startsAt)).replace(/^\d+年/, '')}${jstClock(startsAt)}`
}

/** JST の暦日どうしの差（日）。 */
function daysApart(from: string, to: string): number {
  const start = Date.parse(`${toJstDateString(from)}T00:00:00.000Z`)
  const end = Date.parse(`${toJstDateString(to)}T00:00:00.000Z`)
  return Math.round((end - start) / MS_PER_DAY)
}

/**
 * 期限の 1 行。**画面に固定で書かない** —— `change_deadline_days` を 3 にした店舗では
 * 同じ文が「3日前まで」に変わる（既定 1 でモックの「前日までに」と一字一句一致する）。
 */
function deadlineNotice(reservation: ManagedReservation): string {
  const days = daysApart(reservation.changeDeadlineAt, reservation.startsAt)
  const label = days === 0 ? '当日' : days === 1 ? '前日' : `${days}日前`
  return `変更・取り消しは${label}までにお願いいたします。`
}

/*
 * 明細の 1 行。`role="group"` は `<fieldset>` で表す（既に出荷済みの `change/ChangeDone` と同じ）。
 * `<dl>` の子に `<fieldset>` は置けないので、見出しと値は `<span>` で組む。
 */
function Line({
  term,
  value,
  tone = 'plain',
}: {
  term: string
  value: ReactNode
  tone?: 'plain' | 'lead' | 'code'
}) {
  return (
    <fieldset
      aria-label={term}
      className="flex items-baseline gap-3.5 border-line border-t py-4 first:border-t-0"
    >
      <span className="w-19.5 shrink-0 text-grid text-ink-muted">{term}</span>
      <span
        className={`flex-1 font-semibold ${
          tone === 'lead'
            ? 'text-pine-deep'
            : tone === 'code'
              ? 'font-mono text-body text-ink'
              : 'text-body text-ink'
        }`}
        style={tone === 'lead' ? { fontSize: 'calc(var(--spacing) * 5)' } : undefined}
      >
        {value}
      </span>
    </fieldset>
  )
}

export function CancelPage({
  now,
  onLookup,
  onChangeDateTime,
  onCancelReservation,
  renderChangeDateTime,
  isOffline = false,
  onRetry,
}: CancelPageProps) {
  const fieldId = useId()
  const [stage, setStage] = useState<Stage>({ kind: 'lookup' })
  const [code, setCode] = useState('')
  const [managementCode, setManagementCode] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const askRef = useRef<HTMLDivElement>(null)

  // 面が差し替わったら、その面の見出しへ焦点を移す（`05-screen-flow.md` §7.6）。
  useEffect(() => {
    if (confirming) askRef.current?.focus()
  }, [confirming])

  /** 通らなかったときの行き先。短命の鍵が切れたら入力へ戻す。 */
  function fail(reason: ManageFailure, fallback: Stage) {
    if (reason === 'expired') {
      setStage({ kind: 'lookup' })
      setNotice(EXPIRED)
      return
    }
    setStage(fallback)
    setNotice(reason === 'mismatch' ? MISMATCH : reason === 'locked' ? LOCKED : FAILED)
  }

  async function look() {
    setBusy(true)
    setNotice('')
    try {
      const outcome = await onLookup({ code: code.trim(), managementCode: managementCode.trim() })
      if (outcome.ok) {
        setStage({ kind: 'detail', reservation: outcome.value })
        return
      }
      // どちらの番号が違うかを言わない（予約の有無が読み取れてしまう）。
      fail(outcome.reason, { kind: 'lookup' })
    } catch {
      setNotice(FAILED)
    } finally {
      setBusy(false)
    }
  }

  async function move(startsAt: string, reservation: ManagedReservation) {
    setBusy(true)
    setNotice('')
    try {
      const outcome = await onChangeDateTime(startsAt)
      if (outcome.ok) {
        setStage({ kind: 'detail', reservation: outcome.value })
        return
      }
      fail(outcome.reason, { kind: 'detail', reservation })
    } catch {
      setStage({ kind: 'detail', reservation })
      setNotice(FAILED)
    } finally {
      setBusy(false)
    }
  }

  async function drop(reservation: ManagedReservation) {
    setBusy(true)
    setNotice('')
    setConfirming(false)
    try {
      const outcome = await onCancelReservation()
      if (outcome.ok) {
        setStage({ kind: 'cancelled' })
        return
      }
      fail(outcome.reason, { kind: 'detail', reservation })
    } catch {
      setStage({ kind: 'detail', reservation })
      setNotice(FAILED)
    } finally {
      setBusy(false)
    }
  }

  const banner = (
    <>
      {isOffline && (
        <p
          role="status"
          className="mt-5 rounded-card border border-line-strong bg-surface-2 px-4 py-3 text-grid text-ink"
        >
          電波の届くところでもう一度お試しください。
          {onRetry !== undefined && (
            <button
              type="button"
              onClick={onRetry}
              className={`mt-2 block min-h-11 w-full rounded-card border border-line-strong bg-surface text-body font-semibold text-ink ${focusRing}`}
            >
              もう一度試す
            </button>
          )}
        </p>
      )}
      {notice !== '' && (
        <p
          role="alert"
          className="mt-5 rounded-card border border-danger bg-danger-soft px-4 py-3 text-grid text-danger"
        >
          {notice}
        </p>
      )}
    </>
  )

  if (stage.kind === 'lookup') {
    return (
      <div className="relative h-full min-h-0 bg-paper">
        <div className="h-full overflow-y-auto px-7 pt-8 pb-38">
          <div className="flex items-start gap-2.5">
            <span aria-hidden="true" className="mt-1.5 h-3.75 w-4.5 shrink-0 rounded-ctl bg-pine" />
            <div>
              <h2
                className="m-0 font-semibold text-ink"
                style={{ fontSize: 'calc(var(--spacing) * 5)' }}
              >
                ご予約をお調べします
              </h2>
              <p className="mt-1.5 text-grid text-ink-muted">
                お送りしたメールの番号をご入力ください。
              </p>
            </div>
          </div>

          {banner}

          <div className="mt-7 grid gap-5">
            <div className="grid gap-1.5">
              <label htmlFor={`${fieldId}-code`} className="text-grid text-ink-muted">
                ご予約番号
              </label>
              <input
                id={`${fieldId}-code`}
                type="text"
                autoComplete="off"
                enterKeyHint="next"
                placeholder="例：EY-W-2608-0031"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className={`${FIELD} font-mono`}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${fieldId}-management`} className="text-grid text-ink-muted">
                確認番号
              </label>
              <input
                id={`${fieldId}-management`}
                type="text"
                autoComplete="off"
                enterKeyHint="done"
                value={managementCode}
                onChange={(event) => setManagementCode(event.target.value)}
                className={`${FIELD} font-mono`}
              />
            </div>
          </div>
        </div>

        <div
          className="absolute right-7 left-7"
          style={{ bottom: 'calc(var(--spacing) * 8 + env(safe-area-inset-bottom))' }}
        >
          <button
            type="button"
            aria-busy={busy ? true : undefined}
            aria-disabled={busy ? true : undefined}
            onClick={() => {
              if (busy) return
              void look()
            }}
            className={`min-h-14 w-full rounded-card border border-pine bg-pine font-semibold text-on-pine ${focusRingOnPine}`}
            style={{ fontSize: 'calc(var(--spacing) * 4.5)' }}
          >
            {busy ? 'お調べしています…' : 'ご予約をお調べする'}
          </button>
        </div>
      </div>
    )
  }

  if (stage.kind === 'cancelled') {
    return (
      <div className="h-full overflow-y-auto bg-paper px-7 pt-8 pb-38">
        <div className="flex items-start gap-2.5">
          <span aria-hidden="true" className="mt-1.5 h-3.75 w-4.5 shrink-0 rounded-ctl bg-pine" />
          <div>
            <h2
              className="m-0 font-semibold text-ink"
              style={{ fontSize: 'calc(var(--spacing) * 5)' }}
            >
              ご予約を取り消しました
            </h2>
            <p className="mt-1.5 text-grid text-ink-muted">またのご来店をお待ちしております。</p>
          </div>
        </div>
      </div>
    )
  }

  if (stage.kind === 'change') {
    const { reservation } = stage
    return (
      <div className="h-full overflow-y-auto bg-paper">
        {renderChangeDateTime?.({
          heading: 'ご予約の変更',
          onPick: (startsAt) => void move(startsAt, reservation),
          onBack: () => setStage({ kind: 'detail', reservation }),
        })}
      </div>
    )
  }

  const { reservation } = stage
  // 締切は来店日の `change_deadline_days` 日前の 23:59:59.999 JST。過ぎたら出口を閉じる。
  const past = Date.parse(now) > Date.parse(reservation.changeDeadlineAt)

  return (
    <div className="relative h-full min-h-0 bg-paper">
      <div className="h-full overflow-y-auto px-7 pt-8 pb-38">
        <div className="flex items-start gap-2.5">
          <span aria-hidden="true" className="mt-1.5 h-3.75 w-4.5 shrink-0 rounded-ctl bg-pine" />
          <div>
            <h2
              className="m-0 font-semibold text-ink"
              style={{ fontSize: 'calc(var(--spacing) * 5)' }}
            >
              ご予約をお調べしました
            </h2>
            <p className="mt-1.5 text-grid text-ink-muted">ご本人様の確認ができました。</p>
          </div>
        </div>

        {banner}

        <div className="mt-6">
          <Line term="ご来店" value={visitLabel(reservation.startsAt)} tone="lead" />
          <Line term="店舗" value={reservation.storeName} />
          <Line
            term="ご用件"
            value={`${reservation.purposeName}（約${reservation.durationMinutes}分）`}
          />
          <Line term="お名前" value={`${reservation.contactName} 様`} />
          <Line term="ご予約番号" value={reservation.code} tone="code" />
        </div>

        <p className="mt-6 text-grid text-ink-muted">
          {past
            ? `前日を過ぎたため、この画面では変更・お取り消しができません。お手数ですが ${reservation.storePhone} までお電話でお願いいたします。`
            : deadlineNotice(reservation)}
        </p>
      </div>

      {!past && (
        <div
          className="absolute right-7 left-7"
          style={{ bottom: 'calc(var(--spacing) * 8 + env(safe-area-inset-bottom))' }}
        >
          <button
            type="button"
            onClick={() => setStage({ kind: 'change', reservation })}
            className={`min-h-14 w-full rounded-card border border-pine bg-pine font-semibold text-on-pine ${focusRingOnPine}`}
            style={{ fontSize: 'calc(var(--spacing) * 4.5)' }}
          >
            日時を変更する
          </button>
          {/* 取り消しは塗らない（縁と文字だけ `--color-danger`）。 */}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={`mt-2.5 min-h-12 w-full rounded-card border border-danger bg-surface text-body font-semibold text-danger ${focusRing}`}
          >
            この予約を取り消す
          </button>
        </div>
      )}

      {/* 取り消しの確認だけ `role="alertdialog"`（`05-screen-flow.md` §7.6）。 */}
      {confirming && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-ink/30 p-7">
          <div
            ref={askRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${fieldId}-ask`}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setConfirming(false)
            }}
            className="w-full rounded-panel border border-line bg-surface p-5"
          >
            <h2 id={`${fieldId}-ask`} className="m-0 text-lead font-bold text-ink">
              このご予約を取り消しますか
            </h2>
            <p className="mt-2 text-grid text-ink-muted">
              お取り消しのあと、同じご予約番号では元に戻せません。
            </p>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={`mt-5 min-h-12 w-full rounded-card border border-pine bg-pine text-body font-bold text-on-pine ${focusRingOnPine}`}
            >
              やめる
            </button>
            <button
              type="button"
              onClick={() => void drop(reservation)}
              className={`mt-2.5 min-h-12 w-full rounded-card border border-danger bg-surface text-body font-semibold text-danger ${focusRing}`}
            >
              この予約を取り消す（確定）
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
