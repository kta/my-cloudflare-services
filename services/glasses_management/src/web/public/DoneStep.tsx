import { toJstDateString } from '@app/shared'
import { focusRing, focusRingOnPine } from '@app/ui'
import type { ReactNode } from 'react'
import { dateLabel, jstClock } from '../ledger/metrics'

/*
 * 工程 6 完了（承認済みモック docs/frontend/mockups/eyex/images/WEB-06-DONE.png）。
 *
 * この面の仕事は「番号を主役にし、戻り道を消し、メールが出なかった日でもお客様が
 * 自分の予約へ戻れるようにする」こと。
 *
 * 実測値（screens/WEB-06-DONE.html と assets/eyex.css）:
 *   上のバーは `‹` を持たない（`⌂` も無い）。本文の余白 32px 28px 140px。
 *   ✓ の丸は 56×56px・地 `--color-pine`・文字 28px 太字・下に 12px。
 *   見出し 20px、副文 13px `--color-ink-muted`（上に 6px）。
 *   番号の箱は上に 28px・内側 16px 12px・中央寄せ・地 `--color-pine-soft`。
 *   番号の見出し 13px `--color-ink-muted`、値は 24px 等幅 `--color-pine-deep`（字間 .04em・上 4px）。
 *   明細は上に 24px、行は上下 16px + 上 1px の罫（最初の行は罫無し）。見出し列 66px・13px、値 16px 太さ 600。
 *   下の固定は「地図・道順を見る」（56px の緑）と「予約を変更・取り消す」（44px の quiet・上に 8px）。
 *
 * **確認番号は `emailed` の値にかかわらず必ず画面に出す**（`04-api.md` §7.2）。
 * これが無いと、メールが届かなかったお客様は WEB-CANCEL を通れない。
 * 画面に出す語は「確認番号」で固定し、内部名（管理コード）を出さない。
 */

const MS_PER_MINUTE = 60_000

/** WEB-06 が受け取る控え。平文の確認番号が現れるのはこの 1 回だけである。 */
export type PublicBookingReceipt = {
  code: string
  /** 平文の確認番号。ここでしかお客様の目に触れない。 */
  managementCode: string
  status: 'pending' | 'confirmed'
  startsAt: string
  endsAt: string
  storeName: string
  /** 対客名（`visit_purposes.name_public`）。 */
  purposeName: string
  contactName: string
  /** 確認のメールを送れたか。既定を持たせない（送れなかった日に嘘をつかないため）。 */
  emailed: boolean
}

type DoneStepPhase = 'loading' | 'ready' | 'error'

export type DoneStepProps = {
  receipt: PublicBookingReceipt
  /** 地図に渡す住所（`stores.address`）。 */
  storeAddress: string
  /** 「予約を変更・取り消す」。本人確認の画面へ進む。 */
  onManage: () => void
  phase?: DoneStepPhase
  isOffline?: boolean
}

/** 「2026年8月29日（土）11:00」。控えは年まで出す（後日そのまま読み返すため）。 */
function receiptDateTime(startsAt: string): string {
  return `${dateLabel(toJstDateString(startsAt))}${jstClock(startsAt)}`
}

/* `role="group"` は `<fieldset>` で表す（既に出荷済みの `change/ChangeDone` と同じ）。 */
function CodeBox({ term, value }: { term: string; value: string }) {
  return (
    <fieldset aria-label={term} className="text-center">
      <span className="text-grid text-ink-muted">{term}</span>
      <b
        className="mt-1 block font-mono font-bold text-pine-deep"
        style={{ fontSize: 'calc(var(--spacing) * 6)', letterSpacing: '0.04em' }}
      >
        {value}
      </b>
    </fieldset>
  )
}

/** 明細の 1 行。`<dl>` の子に `<fieldset>` は置けないので見出しと値は `<span>` で組む。 */
function Line({ term, value }: { term: string; value: ReactNode }) {
  return (
    <fieldset aria-label={term} className="flex gap-3.5 border-line border-t py-4 first:border-t-0">
      <span className="w-16.5 shrink-0 text-grid text-ink-muted">{term}</span>
      <span className="flex-1 text-body font-semibold text-ink">{value}</span>
    </fieldset>
  )
}

export function DoneStep({
  receipt,
  storeAddress,
  onManage,
  phase = 'ready',
  isOffline = false,
}: DoneStepProps) {
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

  const minutes = Math.round(
    (Date.parse(receipt.endsAt) - Date.parse(receipt.startsAt)) / MS_PER_MINUTE,
  )
  const pending = receipt.status === 'pending'

  return (
    <div className="relative h-full min-h-0 bg-paper">
      <div className="h-full overflow-y-auto px-7 pt-8 pb-35">
        <div className="text-center">
          <span
            aria-hidden="true"
            className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-pine font-bold text-on-pine"
            style={{ fontSize: 'calc(var(--spacing) * 7)' }}
          >
            ✓
          </span>
          <h2
            className="m-0 font-semibold text-ink"
            style={{ fontSize: 'calc(var(--spacing) * 5)' }}
          >
            {pending ? 'ご予約を承りました' : 'ご予約が完了しました'}
          </h2>
          {/*
            承認待ちの言い方は `09-open-questions.md` Q-01 の「いまの前提」に従う。
            答えが来たらこの 1 文だけを差し替える。
          */}
          {pending && (
            <p className="mt-1.5 text-grid text-ink-muted">
              お店で確認のうえ、本日中にご連絡いたします。確定までお席の確保はできておりません。
            </p>
          )}
          {!pending && receipt.emailed && (
            <p className="mt-1.5 text-grid text-ink-muted">確認のメールをお送りしました。</p>
          )}
          {/* 送信の成功を偽装しない（`07-nfr.md` §5.7）。 */}
          {!receipt.emailed && (
            <p className="mt-1.5 text-grid text-ink-muted">
              この画面のご予約番号と確認番号をお控えください。メールはお送りできませんでした。
            </p>
          )}
        </div>

        {isOffline && (
          <p
            role="status"
            className="mt-5 rounded-card border border-line-strong bg-surface-2 px-4 py-3 text-grid text-ink"
          >
            電波の届くところでもう一度お試しください。ご予約は承っています。
          </p>
        )}
        {phase === 'error' && (
          <p
            role="alert"
            className="mt-5 rounded-card border border-danger bg-danger-soft px-4 py-3 text-grid text-danger"
          >
            ご予約は承っています。この面を読み込めませんでした。ご予約番号をお控えください。
          </p>
        )}

        <div className="mt-7 grid gap-4 rounded-card border border-pine-line bg-pine-soft px-3 py-4">
          <CodeBox term="ご予約番号" value={receipt.code} />
          <div>
            <CodeBox term="確認番号" value={receipt.managementCode} />
            <p className="mt-1 text-center text-grid text-ink-muted">
              ご変更・お取り消しのときにお使いください。
            </p>
          </div>
        </div>

        <div className="mt-6">
          <Line term="ご来店" value={receiptDateTime(receipt.startsAt)} />
          <Line term="店舗" value={receipt.storeName} />
          <Line term="ご用件" value={`${receipt.purposeName}（約${minutes}分）`} />
          <Line term="お名前" value={`${receipt.contactName} 様`} />
        </div>
      </div>

      <div
        className="absolute right-7 left-7"
        style={{ bottom: 'calc(var(--spacing) * 8 + env(safe-area-inset-bottom))' }}
      >
        {/*
          道順は住所しか持たないので、地図アプリを選ばせずに済む検索の URL へ渡す。
          `button` にすると新しいタブが塞がれるので `a` で開く。
        */}
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(storeAddress)}`}
          target="_blank"
          rel="noreferrer noopener"
          className={`flex min-h-14 w-full items-center justify-center rounded-card border border-pine bg-pine font-semibold text-on-pine ${focusRingOnPine}`}
          style={{ fontSize: 'calc(var(--spacing) * 4.5)' }}
        >
          地図・道順を見る
        </a>
        <button
          type="button"
          onClick={onManage}
          className={`mt-2 min-h-11 w-full rounded-card text-body font-semibold text-pine ${focusRing}`}
        >
          予約を変更・取り消す
        </button>
      </div>
    </div>
  )
}
