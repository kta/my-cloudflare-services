import { focusRing, focusRingOnPine } from '@app/ui'
import type { ReactNode } from 'react'
import { jstClock } from '../ledger/metrics'
import { formatPhoneDigits } from './CustomerStep'

/*
 * 工程 5 ご確認（承認済みモック docs/frontend/mockups/eyex/images/BOOK-05-CONFIRM.png）。
 *
 * この面の仕事は「声に出す文をそのまま大きく置き、言い直しがあった箇所だけへ戻す」こと。
 *
 * 実測値（screens/BOOK-05-CONFIRM.html と assets/eyex.css）:
 *   本文 1fr ／ 右の柱 372px（`w-93`）、本文の余白 36px 44px・柱 36px 28px。
 *   復唱の箱は内側 30px 32px・上に 24px、文 24px / 行間 2、強い語は 700 + `--color-pine-deep`。
 *   戻り口は 4 列・間 12px・文字 15px。確定は `.btn.primary.big`（最小高 56px）。
 *
 * 復唱の目的は `visit_purposes.name_internal` をそのまま読む（台帳の帯だけが `name_short`）。
 * モックの「視力測定とメガネの新調」は工程 2 で押した札と違うので採らない（AC-BOOK-13）。
 *
 * 右下に常駐する録音の表示はこの工程が描かない —— 5 工程を通して同じ部品が持ち回るもので、
 * 器（BookingScreen / RecordingBadge）の受け持ちである。
 */

/** 戻り口が指す工程。帯の番号と同じ数え方にする。 */
type ConfirmJumpTarget = 1 | 2 | 3 | 4

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
/** 残り何秒で警告を出すか（`07-nfr.md` §2.8 / Q-06 のいまの前提）。 */
const WARN_SECONDS = 60
/**
 * 仮の押さえの長さ（`07-nfr.md` §2.8 / Q-06）。**残り時間の上限**でもある ——
 * 端末の時計とサーバの時計がずれていると `expiresAt - now` はいくらでも大きくなり、
 * 420 秒の押さえに「あと5290分」と出る。数えるのは端末だが、上限はこちらで持つ。
 */
const HOLD_SECONDS = 420
/** 420 秒を取り直せる回数の上限（同上）。 */
const MAX_RENEWALS = 10

/**
 * 残り時間の言い方。**分だけに丸めない** —— 420 秒の押さえで「あと7分」から
 * 「あと1分」までしか動かないと、見ているあいだ止まっているのと変わらない。
 */
function remainingLabel(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  const rest = seconds % SECONDS_PER_MINUTE
  if (minutes === 0) return `あと${rest}秒`
  return rest === 0 ? `あと${minutes}分` : `あと${minutes}分${rest}秒`
}

/** 「8月27日、木曜日の午前11時」。声に出す順のまま並べる。 */
function spokenDateTime(instant: string): string {
  const at = new Date(Date.parse(instant) + JST_OFFSET_MS)
  const half = at.getUTCHours() < 12 ? '午前' : '午後'
  const hour = at.getUTCHours() % 12 === 0 ? 12 : at.getUTCHours() % 12
  const minutes = at.getUTCMinutes() === 0 ? '' : `${at.getUTCMinutes()}分`
  const weekday = WEEKDAYS[at.getUTCDay()] ?? ''
  return `${at.getUTCMonth() + 1}月${at.getUTCDate()}日、${weekday}曜日の${half}${hour}時${minutes}`
}

type ConfirmStepPhase = 'loading' | 'ready' | 'error' | 'forbidden'

export type ConfirmStepProps = {
  storeName: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  /** 工程 2 で押した札と同じ店内の名前（`visit_purposes.name_internal`）。 */
  purposeNames: readonly string[]
  customerName: string
  /** 数字だけのお電話番号。伺えなかったときは空文字。 */
  phoneDigits: string
  staffName: string | null
  /** 担当の技能（「視力測定・加工」）。分からないときは省く。 */
  staffSkills?: string | null
  equipmentNames: readonly string[]
  /** 仮の押さえの期限。押さえていないときは null。 */
  holdExpiresAt: string | null
  /** いまの時刻。端末の時計を読まない（応答の `serverNow` を渡す）。 */
  now: string
  /** 420 秒を取り直した回数。10 回で打ち止め。 */
  renewalsUsed?: number
  phase?: ConfirmStepPhase
  isOffline?: boolean
  onJumpTo: (step: ConfirmJumpTarget) => void
  onKeepEditing: () => void
}

/**
 * 帯の右端の主操作（承認済みモック BOOK-05-CONFIRM の `.btn.primary.big`・最小高 56px）。
 * **工程 5 だけ、丸い「次へ」の代わりにこれが帯へ入る**ので、面ではなく器が置く。
 */
export type ConfirmActionProps = {
  /** 確定の応答を待っている間。`disabled` にせず `aria-busy` にする。 */
  confirming?: boolean
  isOffline?: boolean
  onConfirm: () => void
}

export function ConfirmAction({
  confirming = false,
  isOffline = false,
  onConfirm,
}: ConfirmActionProps) {
  return (
    <button
      type="button"
      disabled={isOffline}
      aria-busy={confirming ? true : undefined}
      aria-disabled={confirming || isOffline ? true : undefined}
      aria-label={isOffline ? '復唱を終えて予約を確定する　通信が戻ると押せます' : undefined}
      onClick={() => {
        // 確定している間の 2 度目・3 度目の押下は届かせない（同じ鍵で 2 本目を投げない）。
        if (confirming) return
        onConfirm()
      }}
      className={`ml-auto min-h-14 shrink-0 rounded-card border border-pine bg-pine px-6 text-lead font-semibold text-on-pine disabled:border-line disabled:bg-surface-2 disabled:text-ink-faint ${focusRingOnPine}`}
    >
      {confirming ? '確定しています…' : '復唱を終えて予約を確定する'}
    </button>
  )
}

const JUMPS: readonly { step: ConfirmJumpTarget; label: string }[] = [
  { step: 1, label: '日にちと時刻' },
  { step: 2, label: 'ご来店の目的' },
  { step: 3, label: '担当と場所' },
  { step: 4, label: 'お名前と番号' },
]

function Row({ term, value, note }: { term: string; value: ReactNode; note?: ReactNode }) {
  return (
    <>
      <dt className="mt-6 text-note text-ink-muted first:mt-0">{term}</dt>
      <dd className="mt-0.5 text-lead font-semibold text-ink">
        <span>{value}</span>
        {note !== undefined && (
          <small className="block text-grid font-normal text-ink-muted">{note}</small>
        )}
      </dd>
    </>
  )
}

export function ConfirmStep({
  storeName,
  startsAt,
  endsAt,
  durationMinutes,
  purposeNames,
  customerName,
  phoneDigits,
  staffName,
  staffSkills = null,
  equipmentNames,
  holdExpiresAt,
  now,
  renewalsUsed = 0,
  phase = 'ready',
  isOffline = false,
  onJumpTo,
  onKeepEditing,
}: ConfirmStepProps) {
  if (phase === 'loading') {
    return (
      <div className="flex h-full w-full min-h-0">
        <section className="min-w-0 flex-1 px-11 py-9">
          <p role="status" className="text-body text-ink-muted">
            ご予約の内容を読み込んでいます…
          </p>
          <div aria-hidden="true" className="mt-6 h-60 rounded-panel bg-surface-2" />
        </section>
        <aside className="w-93 shrink-0 border-line border-l bg-surface px-7 py-9" />
      </div>
    )
  }

  if (phase === 'forbidden') {
    return (
      <div className="flex h-full w-full min-h-0 px-11 py-9">
        <p
          role="alert"
          className="max-w-175 rounded-panel border border-line bg-surface px-5.5 py-5 text-lead text-ink"
        >
          この画面は店長だけがご覧になれます
        </p>
      </div>
    )
  }

  const phone = phoneDigits === '' ? null : formatPhoneDigits(phoneDigits)
  const purposeText = purposeNames.join('と')
  const remainingSeconds =
    holdExpiresAt === null
      ? null
      : Math.min(
          HOLD_SECONDS,
          Math.round((Date.parse(holdExpiresAt) - Date.parse(now)) / MS_PER_SECOND),
        )
  const warning = remainingSeconds !== null && remainingSeconds <= WARN_SECONDS
  const canRenew = renewalsUsed < MAX_RENEWALS
  /** 押さえている先の数（担当 1 ＋ 設備の台数）。決めていないものは数えない。 */
  const heldCount = (staffName === null ? 0 : 1) + equipmentNames.length

  return (
    <div className="flex h-full w-full min-h-0">
      <section className="min-w-0 flex-1 overflow-hidden px-11 py-9">
        <div className="mb-2.5 flex items-start gap-2.5">
          <span aria-hidden="true" className="mt-1.5 h-4.5 w-5.5 shrink-0 rounded-ctl bg-pine" />
          <div>
            <h2 className="text-title font-semibold text-ink">この文をそのまま読み上げます</h2>
            <p className="mt-0.5 text-body text-ink-muted">
              お客様の「はい」を伺ってから確定してください。
            </p>
          </div>
        </div>

        {isOffline && (
          <p
            role="status"
            className="mb-4 rounded-card border border-line-strong bg-surface-2 px-4 py-3 text-body text-ink"
          >
            通信が切れています。伺った内容はこのまま残ります。
          </p>
        )}
        {phase === 'error' && (
          <p
            role="alert"
            className="mb-4 rounded-card border border-danger bg-danger-soft px-4 py-3 text-body text-danger"
          >
            うまく処理できませんでした。入力はそのまま残っています。もう一度お試しください。
          </p>
        )}

        {/* 声に出す単位で改行し、聞き違えやすい語だけを濃くする。 */}
        <section
          aria-label="復唱する文"
          className="mt-6 rounded-panel border border-line bg-surface px-8 py-7.5"
        >
          <p
            className="m-0 leading-loose text-ink"
            style={{ fontSize: 'calc(var(--spacing) * 6)' }}
          >
            <b className="font-bold text-pine-deep">{spokenDateTime(startsAt)}</b>に、
            <b className="font-bold text-pine-deep">{storeName}</b>で、
            <br />
            <b className="font-bold text-pine-deep">{purposeText}</b>のご相談を承りました。
            <br />
            所要時間は
            <b className="font-bold text-pine-deep">{`約${durationMinutes}分`}</b>です。
            <br />
            {phone === null ? (
              <>
                <b className="font-bold text-pine-deep">{customerName}</b>
                様、お間違いないでしょうか？
              </>
            ) : (
              <>
                <b className="font-bold text-pine-deep">{customerName}</b>様、お電話番号は
                <b className="font-bold text-pine-deep">{phone}</b>で
                <br />
                お間違いないでしょうか？
              </>
            )}
          </p>
        </section>

        <p id="booking-fix-label" className="mt-8 mb-3 text-grid font-semibold text-ink-muted">
          言い直しがあった箇所だけ直せます
        </p>
        <fieldset aria-labelledby="booking-fix-label" className="grid min-w-0 grid-cols-4 gap-3">
          {JUMPS.map((jump) => (
            <button
              key={jump.step}
              type="button"
              onClick={() => onJumpTo(jump.step)}
              className={`min-h-12 rounded-card border border-line-strong bg-surface px-2.5 text-body font-semibold text-ink ${focusRing}`}
            >
              {jump.label}
            </button>
          ))}
        </fieldset>
      </section>

      <aside
        aria-label="確保する内容"
        className="w-93 shrink-0 border-line border-l bg-surface px-7 py-9"
      >
        <h3 className="m-0 mb-1 text-body font-semibold text-ink">確保する内容</h3>
        <dl className="m-0">
          <Row term="担当" value={staffName ?? '担当はあとで決める'} note={staffSkills} />
          <Row
            term="設備と場所"
            value={equipmentNames[0] ?? '場所はあとで決める'}
            note={equipmentNames.slice(1).join(' ／ ') || undefined}
          />
          <Row
            term="所要"
            value={`${durationMinutes}分`}
            note={`${jstClock(startsAt)} 〜 ${jstClock(endsAt)}`}
          />
          {/* AC-BOOK-11 が「工程 5 の『確保する内容』にそのお名前が出る」と決めているので、
              モックに無いお客様の行をここへ足す。モックの上 3 行は動かさない。 */}
          <Row
            term="お客様"
            value={customerName === '' ? 'いま伺っています' : `${customerName} 様`}
            note={phone ?? undefined}
          />
          {holdExpiresAt !== null && (
            <Row
              term="仮の押さえ"
              value={`${jstClock(holdExpiresAt)} まで`}
              note={
                remainingSeconds !== null && remainingSeconds > 0
                  ? remainingLabel(remainingSeconds)
                  : 'お預かりの時間が過ぎました'
              }
            />
          )}
        </dl>

        {warning && (
          <div className="mt-8">
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
                className={`mt-3 min-h-11 w-full rounded-card border border-line-strong bg-surface text-body font-semibold text-ink ${focusRing}`}
              >
                まだ入力中です
              </button>
            )}
          </div>
        )}

        {/*
          「〜とも」は 2 つ以上の言い方である。担当も設備も決めていない受付で
          「1つとも空いています」と出さない（数えるのは押さえる先の実数だけ）。
        */}
        {!warning && (
          <p className="mt-8">
            <span className="inline-block rounded-ctl border border-pine-line bg-pine-soft px-2 py-0.5 text-note font-semibold text-pine-deep">
              {heldCount >= 2 ? `${heldCount}つとも空いています` : 'この枠は空いています'}
            </span>
          </p>
        )}
      </aside>
    </div>
  )
}
