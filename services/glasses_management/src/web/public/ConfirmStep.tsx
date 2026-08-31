import { toJstDateString } from '@app/shared'
import { focusRing, focusRingOnPine } from '@app/ui'
import { type ReactNode, useState } from 'react'
import { dateLabel, jstClock } from '../ledger/metrics'
import type { PublicContact } from './FormStep'

/*
 * 工程 5 ご確認（承認済みモック docs/frontend/mockups/eyex/images/WEB-05-CONFIRM.png）。
 *
 * この面の仕事は「送る前に 5 行で読み返させ、直したい行からその工程へ戻す」こと。
 *
 * 実測値（screens/WEB-05-CONFIRM.html と assets/eyex.css）:
 *   本文の余白 32px 28px 120px。表は上に 28px・角 12px・縁 1px `--color-line`、
 *   行の間に 1px の罫（最後の行は無し）。行は最小高 56px / 内側 12px 16px / 間 12px。
 *   見出し列 66px・13px、値 16px 太さ 600（補足は 13px 標準）、
 *   「変更」は 13px 太さ 600 `--color-pine`。1 行目（ご来店）だけ地が `--color-pine-soft` で
 *   値の色が `--color-pine-deep`。下の固定は左右 28px・下 32px の全幅 56px。
 *
 * 出す名前は対客名（`visit_purposes.name_public` / `stores.name_public`）だけで、
 * 店内名・担当・設備・技能は 1 つも出さない。
 */

/** 「変更」が指す工程。上のバーの数え方と同じ。 */
export type ConfirmTarget = 'store' | 'purpose' | 'datetime' | 'contact'

export type PublicBookingDraft = {
  /** お客様に見せる店名（`stores.name_public`）。 */
  storeName: string
  /** 対客名（`visit_purposes.name_public`）。店内名を渡さない。 */
  purposeName: string
  durationMinutes: number
  startsAt: string
  contact: PublicContact
}

/** 送る瞬間に枠を取られた（409 `slot_taken`）。 */
export type PublicSlotConflict = {
  /** 埋まってしまった時刻。 */
  takenAt: string
  /** 同じ日の空いている時刻。 */
  alternatives: readonly string[]
}

type ConfirmStepPhase = 'loading' | 'ready' | 'error'

export type ConfirmStepProps = {
  draft: PublicBookingDraft
  onEdit: (target: ConfirmTarget) => void
  /** 送る。同じ鍵を渡し続けるのは呼ぶ側ではなくこの面の受け持ち。 */
  onSubmit: (idempotencyKey: string) => void
  /**
   * 工程の開始時に器が作った鍵。省くとこの面が 1 つ作り、成功するまで同じ値を送る
   * （回線が切れて再送されても台帳に 2 件目を作らない。AC-WEB-11）。
   */
  idempotencyKey?: string
  submitting?: boolean
  conflict?: PublicSlotConflict | null
  onPickAlternative?: (startsAt: string) => void
  onReselect?: () => void
  phase?: ConfirmStepPhase
  isOffline?: boolean
  onRetry?: () => void
}

/** 「8月29日（土）11:00」。年をまたぐ知らせは出さないので年を落とす。 */
function visitLabel(startsAt: string): string {
  return `${dateLabel(toJstDateString(startsAt)).replace(/^\d+年/, '')}${jstClock(startsAt)}`
}

/** 一度きりの鍵。`randomUUID` を持たない環境でも空にならない値を作る。 */
function newIdempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ?? `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/*
 * 行 1 つ。`role="group"` は `<fieldset>` で表す（既に出荷済みの `change/ChangeDone` と同じ）。
 * `<dl>` の子に `<fieldset>` は置けないので、この表は見出しと値を `<span>` で組む。
 */
function Row({
  term,
  value,
  note,
  target,
  head = false,
  onEdit,
}: {
  term: string
  value: ReactNode
  note?: ReactNode
  target: ConfirmTarget
  head?: boolean
  onEdit: (target: ConfirmTarget) => void
}) {
  return (
    <fieldset
      aria-label={term}
      className={`flex min-h-14 items-center gap-3 border-line border-t px-4 py-3 first:border-t-0 ${
        head ? 'bg-pine-soft' : ''
      }`}
    >
      <span className="w-16.5 shrink-0 text-grid text-ink-muted">{term}</span>
      <span className={`flex-1 text-body font-semibold ${head ? 'text-pine-deep' : 'text-ink'}`}>
        <span>{value}</span>
        {note !== undefined && (
          <small className="block text-grid font-normal text-ink-muted">{note}</small>
        )}
      </span>
      <button
        type="button"
        aria-label={`${term}を変更する`}
        onClick={() => onEdit(target)}
        className={`-my-3 min-h-11 shrink-0 rounded-ctl px-1 text-grid font-semibold text-pine ${focusRing}`}
      >
        変更
      </button>
    </fieldset>
  )
}

export function ConfirmStep({
  draft,
  onEdit,
  onSubmit,
  idempotencyKey,
  submitting = false,
  conflict = null,
  onPickAlternative,
  onReselect,
  phase = 'ready',
  isOffline = false,
  onRetry,
}: ConfirmStepProps) {
  // 工程の開始時に 1 つだけ作り、成功するまで同じ値を送る。
  const [key] = useState(() => idempotencyKey ?? newIdempotencyKey())

  if (phase === 'loading') {
    return (
      <div className="h-full bg-paper px-7 pt-8">
        <p role="status" className="text-body text-ink-muted">
          読み込んでいます…
        </p>
        <div aria-hidden="true" className="mt-7 h-80 rounded-panel bg-surface-2" />
      </div>
    )
  }

  return (
    <div className="relative h-full min-h-0 bg-paper">
      <div className="h-full overflow-y-auto px-7 pt-8 pb-30">
        <div className="flex items-start gap-2.5">
          <span aria-hidden="true" className="mt-1.5 h-3.75 w-4.5 shrink-0 rounded-ctl bg-pine" />
          <div>
            <h2
              className="m-0 font-semibold text-ink"
              style={{ fontSize: 'calc(var(--spacing) * 5)' }}
            >
              この内容でお間違いないですか
            </h2>
            <p className="mt-1.5 text-grid text-ink-muted">まだ確定していません。</p>
          </div>
        </div>

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

        {/*
          送る瞬間に枠を取られたとき。まだ取れていないことを先に言い、埋まった時刻に
          「満」を付け、同じ日の空いている時刻を並べる（BOOK-CONFLICT を 1 カラムにした形）。
        */}
        {conflict !== null && (
          <section
            aria-label="お取りできなかったお時間"
            className="mt-5 rounded-card border border-danger bg-danger-soft px-4 py-4"
          >
            <p role="alert" className="m-0 text-body font-semibold text-danger">
              この時間は、ちょうど埋まってしまいました。
            </p>
            {/* 押せない理由は色だけでなく「満」の文字でも分かるようにする。 */}
            <fieldset
              aria-label={jstClock(conflict.takenAt)}
              aria-disabled="true"
              className="mt-3 flex min-h-11 items-center justify-between rounded-card bg-busy-soft px-4 text-body text-ink-muted"
            >
              <span>{jstClock(conflict.takenAt)}</span>
              <span className="text-grid font-semibold">満</span>
            </fieldset>
            {conflict.alternatives.length > 0 && (
              <>
                <p className="mt-4 mb-2 text-grid text-ink-muted">同じ日の空いているお時間です。</p>
                <ul className="m-0 grid list-none grid-cols-3 gap-2.5 p-0">
                  {conflict.alternatives.map((at) => (
                    <li key={at}>
                      <button
                        type="button"
                        aria-label={`${jstClock(at)} に予約する`}
                        onClick={() => onPickAlternative?.(at)}
                        className={`min-h-14 w-full rounded-card border border-line-strong bg-surface text-body font-semibold text-ink ${focusRing}`}
                      >
                        {jstClock(at)}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <button
              type="button"
              onClick={() => onReselect?.()}
              className={`mt-4 min-h-11 w-full rounded-card border border-line-strong bg-surface text-body font-semibold text-ink ${focusRing}`}
            >
              日時を選び直す
            </button>
          </section>
        )}

        {phase === 'error' && (
          <p
            role="alert"
            className="mt-5 rounded-card border border-danger bg-danger-soft px-4 py-3 text-grid text-danger"
          >
            うまく処理できませんでした。入力はそのまま残っています。もう一度お試しください。
          </p>
        )}

        <div className="mt-7 overflow-hidden rounded-card border border-line bg-surface">
          <Row
            term="ご来店"
            value={visitLabel(draft.startsAt)}
            target="datetime"
            head
            onEdit={onEdit}
          />
          <Row term="店舗" value={draft.storeName} target="store" onEdit={onEdit} />
          <Row
            term="ご用件"
            value={draft.purposeName}
            note={`約${draft.durationMinutes}分`}
            target="purpose"
            onEdit={onEdit}
          />
          <Row term="お名前" value={`${draft.contact.name} 様`} target="contact" onEdit={onEdit} />
          <Row
            term="ご連絡先"
            value={draft.contact.phone}
            note={draft.contact.email}
            target="contact"
            onEdit={onEdit}
          />
        </div>
      </div>

      <div
        className="absolute right-7 bottom-8 left-7"
        style={{ bottom: 'calc(var(--spacing) * 8 + env(safe-area-inset-bottom))' }}
      >
        {/*
          送っている間も焦点をボタンに残す（`disabled` 属性にしない。`07-nfr.md` §2.3）。
          2 度目・3 度目の押下は届かせず、同じ鍵で 2 本目を投げない。
        */}
        <button
          type="button"
          aria-busy={submitting ? true : undefined}
          aria-disabled={submitting ? true : undefined}
          onClick={() => {
            if (submitting) return
            onSubmit(key)
          }}
          className={`min-h-14 w-full rounded-card border border-pine bg-pine font-semibold text-on-pine ${focusRingOnPine}`}
          style={{ fontSize: 'calc(var(--spacing) * 4.5)' }}
        >
          {submitting ? '送信しています…' : 'この内容で予約する'}
        </button>
      </div>
    </div>
  )
}
