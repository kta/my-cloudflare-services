import { toJstDateString } from '@app/shared'
import { cn, focusRing, focusRingOnPine } from '@app/ui'
import { dateLabel, jstClock } from '../ledger/metrics'

/*
 * 変更・取消を承った（承認済みモック docs/frontend/mockups/eye/images/CHANGE-DONE.png）。
 *
 * この面の主役は**予約番号が変わらないこと**である。取消の完了もこの面を流用し、
 * 新しい画面 ID を作らずに文言だけを差し替える（`spec.md`「決めたこと」）。
 *
 * 実測（screens/CHANGE-DONE.html の <style> と assets/eye.css）:
 *   .done = padding 40px 44px 0・中央寄せ。.mark = 76px の円（--brand 地）・38px の ✓
 *   h2 26px（上に 18px）。.no = ピル・padding 6px 16px・--brand-tint 地・等幅 16px/600
 *           ＋ 13px の「予約番号は変わりません」（上に 12px）
 *   .two = 最大 900px の 2 列・gap 56px・上に 44px。h3 14px/600（下に 14px）
 *   .sum = dt 12px（上に 20px）／ dd 17px/600、日時の dd だけ 22px の --brand-dark、補足 13px
 *   .tell = 16px/1.6・1 行 padding 14px 0・下に 1px の罫
 *   .next = 上に 44px・gap 14px。.audit = 左 44px / 下 20px の 13px
 *
 * 脚注はモックの `position: absolute` を採らず、面の一番下に流し込む（`.inner` を
 * 位置の基準にすると、面の中身が伸びたときに脚注が本文へ重なる）。
 *
 * **変更・取消のメールは送らない。**`packages/contracts/src/notification.ts` の
 * `NotificationJob` に取消・変更の型が無く、型を足すのは別サービスの契約変更（人間の
 * 承認事項）である。モックの「お電話でのご予約のため、メールは送っていません。」の
 * 代わりに「お客様へのご連絡は、お電話でお願いします。」を置く。
 */

/** 読み込み中 / 見つからない（空）/ エラー / 権限なし。 */
type ChangeDonePhase = 'loading' | 'ready' | 'notFound' | 'error' | 'forbidden'

const PHASE_MESSAGE: Record<Exclude<ChangeDonePhase, 'ready'>, string> = {
  loading: 'ご予約を読み込んでいます…',
  notFound: 'このご予約は見つかりませんでした。もう一度お探しください。',
  error: 'お手続きは終わっています。この面を読み込めませんでした。台帳でお確かめください。',
  forbidden: 'この画面をご覧になる権限がありません。お店の管理者にご確認ください。',
}

type DoneReservation = {
  code: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  customerName: string | null
  staffName: string | null
  equipmentNames: readonly string[]
}

type DoneAudit = {
  storeName: string
  terminalName: string
  /** 操作した時刻（UTC の ISO8601）。面には JST の壁時計で出す。 */
  at: string
  actorName: string
}

type ChangeDoneProps = {
  /** 変更を承ったのか、取り消したのか。文言だけが入れ替わる。 */
  kind: 'changed' | 'cancelled'
  reservation: DoneReservation
  /** 「11:00–12:00」。日時を変えていないとき・取消のときは null。 */
  previousRange: string | null
  tell: readonly string[]
  audit: DoneAudit
  onOpenLedger: () => void
  onGoHome: () => void
  phase?: ChangeDonePhase
}

/** 「8月27日（木）」。年をまたぐ知らせは出さないので年を落とす。 */
function monthDayLabel(instant: string): string {
  return dateLabel(toJstDateString(instant)).replace(/^\d+年/, '')
}

function Fact({ term, value, note }: { term: string; value: string; note?: string }) {
  return (
    <>
      <dt className="mt-5 text-note text-ink-muted first:mt-0">{term}</dt>
      <dd className="m-0 mt-0.5 text-lead font-semibold text-ink">
        {value}
        {note !== undefined && (
          <small className="block text-grid font-normal text-ink-muted">{note}</small>
        )}
      </dd>
    </>
  )
}

export function ChangeDone({
  kind,
  reservation,
  previousRange,
  tell,
  audit,
  onOpenLedger,
  onGoHome,
  phase = 'ready',
}: ChangeDoneProps) {
  if (phase !== 'ready') {
    return (
      <p
        role={phase === 'loading' ? 'status' : 'alert'}
        className="px-11 py-10 text-body text-ink-muted"
      >
        {PHASE_MESSAGE[phase]}
      </p>
    )
  }

  const changed = kind === 'changed'
  const summaryLabel = changed ? '変更後のご予約' : '取り消したご予約'
  const durationNote =
    previousRange === null
      ? `所要 ${reservation.durationMinutes}分`
      : `所要 ${reservation.durationMinutes}分　変更前は ${previousRange}`

  return (
    <div className="flex h-full min-h-0 flex-col items-center overflow-y-auto px-11 pt-10">
      <span
        aria-hidden="true"
        className="grid size-19 shrink-0 place-items-center rounded-full bg-pine text-on-pine"
        style={{ fontSize: 'calc(var(--spacing) * 9.5)' }}
      >
        ✓
      </span>

      <h2
        className="m-0 mt-4.5 font-semibold text-ink"
        style={{ fontSize: 'calc(var(--spacing) * 6.5)' }}
      >
        {changed ? 'ご予約の変更を承りました' : 'ご予約を取り消しました'}
      </h2>

      {changed ? (
        <p className="m-0 mt-3 inline-flex items-center gap-2.5 rounded-full bg-pine-soft px-4 py-1.5">
          <b className="font-mono text-body font-semibold text-pine-deep">{reservation.code}</b>
          <span className="text-grid text-ink-muted">予約番号は変わりません</span>
        </p>
      ) : (
        <p className="m-0 mt-3 rounded-full bg-pine-soft px-4 py-1.5 font-mono text-body font-semibold text-pine-deep">
          {reservation.code}
        </p>
      )}

      {!changed && (
        <p className="m-0 mt-3.5 text-body text-ink">
          この枠は、ほかのお客様にご案内できる状態に戻りました。
        </p>
      )}

      <div className="mt-11 grid w-full max-w-225 grid-cols-2 gap-14">
        {/* `role="group"` は `<fieldset>` で表す（既に出荷済みの `DoneStep` と同じ）。 */}
        <fieldset aria-label={summaryLabel} className="m-0 min-w-0 border-0 p-0">
          <h3
            className="m-0 mb-3.5 font-semibold text-ink-muted"
            style={{ fontSize: 'calc(var(--spacing) * 3.5)' }}
          >
            {summaryLabel}
          </h3>
          <dl className="m-0">
            <dt className="text-note text-ink-muted">お日にちとお時間</dt>
            <dd className="m-0 mt-0.5 font-semibold text-pine-deep">
              <span className="text-title">
                {`${monthDayLabel(reservation.startsAt)}${jstClock(reservation.startsAt)}–${jstClock(reservation.endsAt)}`}
              </span>
              <small className="block text-grid font-normal text-ink-muted">{durationNote}</small>
            </dd>
            <Fact
              term="お客様"
              value={
                reservation.customerName === null
                  ? 'お客様は未登録です'
                  : `${reservation.customerName} 様`
              }
            />
            <Fact
              term="担当と場所"
              value={reservation.staffName ?? '担当が未定'}
              note={
                reservation.equipmentNames.length === 0
                  ? '場所は決まっていません'
                  : reservation.equipmentNames.join('／')
              }
            />
          </dl>
        </fieldset>

        <div>
          <h3
            className="m-0 mb-3.5 font-semibold text-ink-muted"
            style={{ fontSize: 'calc(var(--spacing) * 3.5)' }}
          >
            お客様にお伝えすること
          </h3>
          <ul aria-label="お客様にお伝えすること" className="m-0 list-none p-0">
            {tell.map((line) => (
              <li
                key={line}
                className="border-line border-b py-3.5 text-body text-ink last:border-b-0"
              >
                {line}
              </li>
            ))}
          </ul>
          {/* メールを送る型が契約に無いので、ご連絡はお電話でお願いする 1 行を残す。 */}
          <p className="mt-5 text-grid text-ink-muted">
            お客様へのご連絡は、お電話でお願いします。
          </p>
        </div>
      </div>

      <fieldset
        aria-label="次の一手"
        className="m-0 mt-11 flex min-w-0 items-center gap-3.5 border-0 p-0"
      >
        <button
          type="button"
          onClick={onOpenLedger}
          className={cn(
            'min-h-14 rounded-card border border-pine bg-pine px-6 text-lead font-semibold text-on-pine',
            focusRingOnPine,
          )}
        >
          台帳で見る
        </button>
        <button
          type="button"
          onClick={onGoHome}
          className={cn(
            'min-h-14 rounded-card border border-transparent px-6 text-lead font-semibold text-pine',
            focusRing,
          )}
        >
          トップへ戻る
        </button>
      </fieldset>

      <p className="mt-auto w-full pt-9 pb-5 text-grid text-ink-muted">
        {`この操作は受付履歴に残ります（${audit.storeName} ${audit.terminalName}・${jstClock(audit.at)}　操作者 ${audit.actorName}）。`}
      </p>
    </div>
  )
}
