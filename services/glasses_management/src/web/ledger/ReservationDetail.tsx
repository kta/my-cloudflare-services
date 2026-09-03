import type { RecordingSummary, ReservationDetail as ReservationDetailShape } from '@app/contracts'
import { focusRing, focusRingOnPine } from '@app/ui'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SOURCE_LABELS } from '../../worker/domain/ledger'
import { RecordingPlayer } from '../recording/RecordingPlayer'
import { jstClock } from './metrics'

/*
 * 予約の詳細（承認済みモック docs/frontend/mockups/eyex/images/LEDGER-DETAIL.png）。
 *
 * 台帳の位置を見失わないまま、1 件の中身と次の操作だけを見る面。**モーダルにしない** —
 * 後ろの台帳は見えたままで、押した帯の左端へ矢印が刺さる。
 *
 * 実測値（screens/LEDGER-DETAIL.html と assets/eyex.css の `.popover`）:
 *   幅 440px（w-110）・角 16px（rounded-panel）・縁 1px --line-strong・影 0 12px 32px。
 *   矢印 16px を左 40px。頭 padding 14px 16px / 胴 12px 16px / 足 12px 16px（足の地は --surface-2）。
 *   ご用件などの見出し列は 84px（w-21）。主操作は幅いっぱい・min-height 52px・17px、
 *   副操作 2 つは min-height 46px を 10px 空けて並べる。
 *
 * 閉じる道は 4 本 — ✕・Esc・台帳の空いているところを 1 回押す・開いた帯をもう一度押す
 * （最後の 1 本は器が持つ）。**閉じるためのその 1 回は台帳へ届かせない**ので、
 * 空きセルを押しても新しい予約は始まらない（AC-LEDGER-19）。閉じたらフォーカスは
 * 開く前に押していたもの（＝帯）へ戻す。
 *
 * この面が描かないもの（P2 の範囲）:
 * - お客様のお名前と来店回数（`customers` は 007-customer-records）
 * - 「ご来店を受け付ける」「変更する」「取り消す」の行き先（008 / 009）。置くだけである
 *
 * 「● 録音を聞く　03:12」（LEDGER-DETAIL の頭の右）は `recording` を受けたときだけ出す。
 * 保存に失敗した予約は台帳に載るが導線は出ない（AC-REC-07）ので、**無効化ではなく非表示**に
 * するのは `RecordingPlayer` の側である。実測は `.listen` = min-height 40px / 左右 12px /
 * 枠 1px --alert / 角 pill / 地 --alert-tint / 600 13px（触れるものの下限 44pt へ上げる）。
 */

/** 矢印は詳細の左 40px にある。詳細そのものは帯より 40px 左から始まる。 */
const ARROW_LEFT_PX = 40
/** 台帳の縁との隙間。ここより外へは出さない。 */
const EDGE_PX = 8
/** 矢印が面から外れないための、左右の余白。 */
const ARROW_MIN_PX = 16

export type ReservationDetailPhase = 'loading' | 'ready' | 'error' | 'not_found' | 'forbidden'

export type ReservationDetailProps = {
  /** ご予約 1 件。読み込み中・見つからないときは null。 */
  detail: ReservationDetailShape | null
  /** 担当のお名前。未定は null（「担当が未定」と書く）。 */
  staffName: string | null
  /** 押さえている場所。並び順のまま「 ／ 」で連ねる。 */
  equipmentNames: readonly string[]
  onClose: () => void
  /** 省略時は `detail` の有無から決める（null なら読み込み中）。 */
  phase?: ReservationDetailPhase
  /**
   * 押した帯の左上（台帳の器の中の座標・px）。器は `relative` な箱で包む。
   * `top` は帯の下端＋隙間で、そこに置くと台帳からはみ出す帯（下のほうの行）だけ、
   * 帯の上へ返して置く。返す先が分かるように `bandTop` を添える。
   */
  anchor?: { left: number; top: number; bandTop?: number }
  /** 通信断のとき。書き込みの操作を押せなくする（読むことと閉じることは残す）。 */
  isOffline?: boolean
  /** ご来店を受け付けた時刻。分からないときは時刻を作らない（`visits` は 008）。 */
  checkedInAt?: string | null
  /**
   * この受付の録音。**器が渡したときだけ**「録音を聞く」が出る。応答から読まないのは、
   * `ReservationDetail` の契約に録音の欄がまだ無いからで（`010-recording` の契約は
   * `RecordingSummary` を別に持つ）、欄が生えたらここへ 1 行で繋ぎ替える。
   */
  recording?: RecordingSummary | null
  /*
   * この面が描く 3 つの操作。**任意にしない。**
   * 任意プロパティにしていたとき `LedgerScreen` が 1 つも渡しておらず、
   * 3 つとも `onClick={undefined}` で描かれていた（UX 監査 RECEP-01）。
   * ボタンを描くのにハンドラが無い状態を、型のうえで作れなくする。
   */
  onCheckIn: () => void
  onChange: () => void
  onCancel: () => void
}

/**
 * ご要望はお客様の言葉なので鉤括弧で括る。**すでに括ってある文は二重に括らない**
 * （書き手が括って入れることがあり、「「遠近は初めてです」」になる）。
 */
function quoted(note: string): string {
  return note.startsWith('「') && note.endsWith('」') ? note : `「${note}」`
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 py-1">
      <dt className="w-21 shrink-0 pt-0.5 text-grid text-ink-muted">{term}</dt>
      <dd className="m-0 text-body font-semibold text-ink">{children}</dd>
    </div>
  )
}

export function ReservationDetail({
  detail,
  staffName,
  equipmentNames,
  onClose,
  phase,
  anchor = { left: ARROW_LEFT_PX, top: 0 },
  isOffline = false,
  checkedInAt = null,
  recording = null,
  onCheckIn,
  onChange,
  onCancel,
}: ReservationDetailProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  /*
   * 台帳の中へ収める。詳細は台帳の器（`relative` な箱）の中に絶対配置されていて、
   * その器は `overflow: hidden` なので、はみ出した詳細は**まったく読めなくなる**
   * （下のほうの行の帯を押したときに必ず起きる）。下に入らないときは帯の上へ返し、
   * 右に入らないときは左へ寄せ、矢印だけを押した帯の位置に残す。
   * 測れない環境（jsdom）では何もしないので、渡された座標がそのまま生きる。
   */
  const [fit, setFit] = useState<{ left: number; top: number; arrow: number } | null>(null)
  useLayoutEffect(() => {
    const panel = panelRef.current
    const stage = panel?.offsetParent
    if (panel === null || !(stage instanceof HTMLElement)) return
    const room = stage.getBoundingClientRect()
    const box = panel.getBoundingClientRect()
    if (room.width === 0 || box.height === 0) return

    const wanted = anchor.left - ARROW_LEFT_PX
    const left = Math.max(EDGE_PX, Math.min(wanted, room.width - box.width - EDGE_PX))
    const above = (anchor.bandTop ?? anchor.top) - box.height - EDGE_PX
    const top =
      anchor.top + box.height + EDGE_PX <= room.height ? anchor.top : Math.max(EDGE_PX, above)
    const arrow = Math.max(ARROW_MIN_PX, Math.min(anchor.left - left, box.width - ARROW_MIN_PX * 2))
    setFit({ left, top, arrow })
  }, [anchor.left, anchor.top, anchor.bandTop, detail, phase])

  useEffect(() => {
    // 開く前に押していたもの（＝台帳の帯）へ、閉じたときフォーカスを返す。
    const previous = document.activeElement
    panelRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  const state = phase ?? (detail === null ? 'loading' : 'ready')
  const canCheckIn = detail !== null && detail.status === 'confirmed'
  const places = equipmentNames.length === 0 ? null : equipmentNames.join(' ／ ')

  return (
    <>
      {/* 台帳の空いているところを押したときの 1 回を、閉じる操作として使い切る。
          台帳へ届かせないので、その 1 回で新しい予約は始まらない。 */}
      <button
        type="button"
        data-testid="reservation-detail-dismiss"
        aria-hidden="true"
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        className="absolute inset-0 z-10 cursor-default"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="予約の詳細"
        tabIndex={-1}
        style={{
          left: `${fit === null ? anchor.left - ARROW_LEFT_PX : fit.left}px`,
          top: `${fit === null ? anchor.top : fit.top}px`,
        }}
        className={`absolute z-20 w-110 rounded-panel border border-line-strong bg-surface shadow-xl ${focusRing}`}
      >
        <span
          data-testid="reservation-detail-arrow"
          aria-hidden="true"
          style={fit === null ? undefined : { left: `${fit.arrow}px` }}
          className="-top-2 absolute left-10 size-4 rotate-45 border-line-strong border-t border-l bg-surface"
        />
        {detail === null ? (
          <div className="px-4 py-3.5">
            {state === 'loading' ? (
              <p role="status" className="text-body text-ink-muted">
                ご予約を読み込んでいます…
              </p>
            ) : (
              <p role="alert" className="text-body text-ink-muted">
                {state === 'not_found'
                  ? 'このご予約は見つかりませんでした。台帳を読み直してください。'
                  : state === 'forbidden'
                    ? 'このご予約を見る権限がありません。お店の管理者にご確認ください。'
                    : 'ご予約を読み込めませんでした。台帳を読み直してください。'}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="詳細を閉じる"
              className={`mt-2.5 min-h-11 min-w-11 rounded-ctl border border-line-strong bg-surface text-body text-ink-muted ${focusRing}`}
            >
              ✕
            </button>
          </div>
        ) : (
          <>
            <div className="border-line border-b px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <h2 className="font-mono text-title font-bold text-ink">
                  {`${jstClock(detail.startsAt)}–${jstClock(detail.endsAt)}`}
                </h2>
                <span className="text-grid text-ink-muted">{`${detail.durationMinutes}分`}</span>
                <span className="ml-auto">
                  <RecordingPlayer recording={recording} placement="pill" />
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="詳細を閉じる"
                  className={`min-h-11 min-w-11 rounded-ctl border border-line-strong bg-surface text-body text-ink-muted ${focusRing}`}
                >
                  ✕
                </button>
              </div>
              <p className="mt-2.5">
                {/* 出どころは 4 語のまま出す（モックの「電話予約」は「お電話」に揃える）。 */}
                <span className="inline-block rounded-ctl border border-line-strong bg-surface px-2 py-0.5 text-note font-semibold text-ink-muted">
                  {SOURCE_LABELS[detail.source]}
                </span>
              </p>
            </div>

            <dl className="m-0 px-4 py-3">
              <Row term="ご用件">{detail.purposeLabelInternal}</Row>
              <Row term="担当">{staffName ?? <span className="text-danger">担当が未定</span>}</Row>
              <Row term="場所">
                {places ?? <span className="font-normal text-ink-muted">場所は決めていません</span>}
              </Row>
              {detail.noteCustomer !== '' && <Row term="ご要望">{quoted(detail.noteCustomer)}</Row>}
              {detail.noteInternal !== '' && (
                <Row term="注意ごと">
                  <span className="text-danger">{detail.noteInternal}</span>
                </Row>
              )}
            </dl>

            <fieldset
              aria-label="このご予約への操作"
              className="min-w-0 rounded-b-panel border-line border-t bg-surface-2 px-4 py-3"
            >
              {canCheckIn ? (
                <button
                  type="button"
                  disabled={isOffline}
                  onClick={onCheckIn}
                  className={`min-h-13 w-full rounded-ctl bg-pine text-lead font-semibold text-on-pine disabled:opacity-50 ${focusRingOnPine}`}
                >
                  ご来店を受け付ける
                </button>
              ) : (
                <p className="text-body text-ink-muted">
                  {checkedInAt === null ? '受付済み' : `受付済み ${jstClock(checkedInAt)}`}
                </p>
              )}
              <div className="mt-2.5 flex gap-2.5">
                <button
                  type="button"
                  disabled={isOffline}
                  onClick={onChange}
                  className={`min-h-11.5 flex-1 rounded-ctl border border-line-strong bg-surface text-body font-semibold text-ink disabled:opacity-50 ${focusRing}`}
                >
                  変更する
                </button>
                <button
                  type="button"
                  disabled={isOffline}
                  onClick={onCancel}
                  className={`min-h-11.5 flex-1 rounded-ctl border border-danger bg-surface text-body font-semibold text-danger disabled:opacity-50 ${focusRing}`}
                >
                  取り消す
                </button>
              </div>
            </fieldset>
          </>
        )}
      </div>
    </>
  )
}
