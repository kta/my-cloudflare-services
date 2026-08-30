import type { CustomerCandidate } from '@app/contracts'
import { focusRing, focusRingOnPine } from '@app/ui'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { lastVisitLabel, visitLabel } from '../../worker/domain/customers'
import { formatPhoneDigits } from '../booking/CustomerStep'

/*
 * お客様の候補（承認済みモック docs/frontend/mockups/eyex/images/BOOK-04b-CUSTOMER-MATCH.png）。
 *
 * この面の仕事は「番号を打ち終えた瞬間に候補を出し、お名前を声に出して確かめてもらう」こと。
 * **モーダルにしない** —— 候補が開いている間もお電話番号の欄は打てるままで、右下の「録音中」も
 * 読み上げから外れない（AC-CUST-21）。`aria-modal` を付けず、フォーカスも奪わない。
 *
 * 実測値（screens/BOOK-04b-CUSTOMER-MATCH.html と assets/eyex.css の `.popover`）:
 *   吹き出しは 幅 420px（w-105）・角 16px（rounded-panel）・縁 1px --line-strong・影 0 12px 32px。
 *   番号欄の右（上 68px = top-17 / 左 436px = left-109）から出て、左辺 84px（top-21）に 18px の三角。
 *   頭 18px 20px / 胴 18px 20px / 足 14px 20px（足の地は --surface-2）。
 *   候補カードは padding 16px 18px・角 12px、カード間 16px、お名前 19px、`dl` は 82px 1fr。
 *   右の柱は 320px（w-80）・padding 36px 26px、`dt` 12px / `dd` 16px 600。
 *
 * モックの 20px / 19px / 14px は theme.css の段（`text-bar` 19px / `text-body` 16px /
 * `text-grid` 13px）へ翻訳した。カードの枠は選択・非選択とも 2px にしてある —— モックは
 * 1px→2px に太らせて padding を 1px 削って帳尻を合わせるが、17px / 15px は `--spacing` の
 * 刻みに乗らない。**強い一致は緑の地と緑の枠**で示し、色だけに頼らないよう札の文字を必ず添える。
 *
 * お電話番号・お名前・ふりがなの欄は**この部品の持ち物ではない**。予約の工程 4（BOOK-04b）と
 * 新しいお客様の登録（CUSTOMER-NEW）の両方の手前に立つので、欄は器が持ち、この部品は
 * 「選ばれた 1 名」を器へ返すだけにする。器は吹き出しを `relative` な箱で包む。
 *
 * 番号の整形は `booking/CustomerStep.tsx` の `formatPhoneDigits` をそのまま使う（二度書かない）。
 * 工程 4 がこの部品を取り込むと 2 つのモジュールは輪になるが、参照はどちらも関数の中だけなので
 * 評価の順に依らない。輪が気になるなら `formatPhoneDigits` を両者の外へ出す（この部品は動かさない）。
 */

/** 吹き出しの状態。候補が 0 件のときは「見つかりませんでした」を出す（行き止まりにしない）。 */
type CustomerMatchPhase = 'loading' | 'ready' | 'error' | 'forbidden'

export type CustomerMatchProps = {
  /** 照会の答え。並びはサーバが決める（strong が先、その中では最後のご来店が新しい順）。 */
  candidates: readonly CustomerCandidate[]
  /** 「このお客様で進む」。**1 件でも自動では呼ばない。** */
  onSelect: (candidate: CustomerCandidate) => void
  /** 「どちらでもありません」・Esc・外側を押したとき。 */
  onDismiss: () => void
  /** 「番号を入れ直す」。 */
  onReenter: () => void
  /** 閉じたときフォーカスを返す先（お電話番号の欄）。 */
  returnFocusTo?: RefObject<HTMLElement | null>
  /** 一覧の id。器が入力欄の `aria-controls` に渡す。 */
  listboxId?: string
  phase?: CustomerMatchPhase
}

/* --- 部品 ----------------------------------------------------------------- */

/**
 * 来店回数の印（`.visits`）。**数字の文字を必ず出す**ので、色が見えなくても回数が分かる。
 * はじめての方は薄い橙、3 回目以上は薄い緑、その間は罫だけ。
 */
function VisitBadge({ count }: { count: number }) {
  const tone =
    count <= 0
      ? 'border-walkin bg-walkin-soft text-walkin'
      : count >= 3
        ? 'border-pine-line bg-pine-soft text-pine-deep'
        : 'border-line-strong bg-surface text-ink-muted'
  return (
    <span
      className={`inline-flex min-h-5.5 min-w-7.5 items-center justify-center rounded-full border px-2 font-mono text-note font-semibold ${tone}`}
    >
      {visitLabel(count, 'badge')}
    </span>
  )
}

/** 確からしさの札（`.tag`）。緑と白の違いだけでなく、必ず文字で言う。 */
function MatchTag({ match }: { match: CustomerCandidate['match'] }) {
  return (
    <span
      className={`inline-flex min-h-5.5 items-center rounded-ctl border px-2 text-note font-semibold ${
        match === 'strong'
          ? 'border-pine-line bg-pine-soft text-pine-deep'
          : 'border-line-strong bg-surface text-ink-muted'
      }`}
    >
      {match === 'strong' ? 'よく一致しています' : '確かめが必要です'}
    </span>
  )
}

function Row({
  term,
  children,
  mono = false,
}: {
  term: string
  children: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex gap-3">
      <dt className="w-20.5 shrink-0 text-grid text-ink-muted">{term}</dt>
      <dd className={`m-0 text-body font-semibold text-ink${mono ? ' font-mono' : ''}`}>
        {children}
      </dd>
    </div>
  )
}

/**
 * 「お選びになると入ります」。**飾りではなく手順**なので薄い文字（`text-ink-faint`）で描かず、
 * 欄の説明（`aria-describedby`）として読み上げにも乗せる（AC-CUST-22）。
 */
export function PickToFillHint({ id }: { id: string }) {
  return (
    <p id={id} className="mt-1.5 text-grid text-ink-muted">
      お選びになると入ります
    </p>
  )
}

/** 「R -2.25　L -2.00　PD 62.0」。片目だけ・PD 無しでも読める形に落とす。 */
function diopter(value: number): string {
  return `${value < 0 ? '-' : value > 0 ? '+' : ''}${Math.abs(value).toFixed(2)}`
}

function prescriptionLine(prescription: CustomerCandidate['currentPrescription']): string | null {
  if (prescription === null) return null
  const parts: string[] = []
  if (prescription.rSph !== null) parts.push(`R ${diopter(prescription.rSph)}`)
  if (prescription.lSph !== null) parts.push(`L ${diopter(prescription.lSph)}`)
  if (prescription.pd !== null) parts.push(`PD ${prescription.pd.toFixed(1)}`)
  return parts.length === 0 ? null : parts.join('　')
}

/**
 * 「お選びになると引き継がれること」の柱。吹き出しが閉じたあとも出続けるので、
 * 吹き出しとは別の部品にしてある（モックの右の柱 320px）。
 */
export function CustomerHandover({ candidate }: { candidate: CustomerCandidate | null }) {
  const prescription = candidate === null ? null : prescriptionLine(candidate.currentPrescription)
  return (
    <aside
      aria-label="お選びになると引き継がれること"
      className="w-80 shrink-0 border-line border-l bg-surface px-6.5 py-9"
    >
      <h3 className="m-0 text-body font-semibold text-ink">お選びになると引き継がれること</h3>
      {candidate === null ? (
        <p className="mt-1 text-grid text-ink-muted">候補をお選びになると、ここに出ます。</p>
      ) : (
        <dl className="m-0">
          <dt className="mt-6 text-note text-ink-muted">現在の度数</dt>
          <dd className="m-0 mt-0.5 font-mono text-body font-semibold text-ink">
            {prescription ?? 'ご登録がありません'}
          </dd>
          <dt className="mt-6 text-note text-ink-muted">前回の担当</dt>
          <dd className="m-0 mt-0.5 text-body font-semibold text-ink">
            {candidate.lastStaffName ?? 'ご登録がありません'}
          </dd>
          <dt className="mt-6 text-note text-ink-muted">注意ごと</dt>
          <dd className="m-0 mt-0.5 text-body font-semibold text-ink">
            {candidate.attentionSummary === '' ? 'ご登録がありません' : candidate.attentionSummary}
          </dd>
          <dt className="mt-6 text-note text-ink-muted">ご連絡先</dt>
          <dd className="m-0 mt-0.5 font-mono text-body font-semibold text-ink">
            {candidate.customer.phone === null
              ? 'ご登録がありません'
              : formatPhoneDigits(candidate.customer.phone)}
          </dd>
        </dl>
      )}
    </aside>
  )
}

/* --- 吹き出し ------------------------------------------------------------- */

const FOOT_BUTTON = `min-h-12 rounded-card border border-line-strong bg-surface px-4.5 text-body font-semibold text-ink`

export function CustomerMatch({
  candidates,
  onSelect,
  onDismiss,
  onReenter,
  returnFocusTo,
  listboxId = 'customer-match-list',
  phase = 'ready',
}: CustomerMatchProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])
  // 開いた時点ではどれも選ばれていない（AC-CUST-05）。下矢印で降りたときだけ印が付く。
  const [active, setActive] = useState<number | null>(null)

  const listed = phase === 'ready' ? candidates : []

  /** 閉じるときは、いつでもお電話番号の欄へフォーカスを返す。 */
  function dismiss() {
    returnFocusTo?.current?.focus()
    onDismiss()
  }

  // 依存を書かずに毎描画で貼り直す（`active` と props の最新値をそのまま読むため）。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismiss()
        return
      }
      if (listed.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const next = active === null ? 0 : Math.min(active + 1, listed.length - 1)
        setActive(next)
        buttonsRef.current[next]?.focus()
        return
      }
      if (event.key !== 'ArrowUp') return
      event.preventDefault()
      if (active === null || active === 0) {
        setActive(null)
        returnFocusTo?.current?.focus()
        return
      }
      setActive(active - 1)
      buttonsRef.current[active - 1]?.focus()
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target
      if (target instanceof Node && panelRef.current?.contains(target) === true) return
      dismiss()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  })

  /*
   * 候補が 2 件出ると、吹き出しの丈（見出し＋候補 2 枚＋足）が iPad 横 810px の残りより
   * 高くなり、足の「どちらでもありません」「番号を入れ直す」が画面の外へ出て押せなく
   * なっていた（AC-CUST-07 の出口がその機種で消える）。丈を `max-h-110`（440px）で
   * 頭打ちにし、候補の並びだけを縦に流して、足は必ず見えるところへ残す。
   */
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="お客様の候補"
      className="absolute top-17 left-109 z-20 flex max-h-110 w-105 flex-col rounded-panel border border-line-strong bg-surface shadow-xl"
    >
      <span
        aria-hidden="true"
        className="-left-2.5 absolute top-21 size-4.5 rotate-45 border-line-strong border-b border-l bg-surface"
      />

      <div className="flex-none border-line border-b px-5 py-4.5">
        <h3 className="m-0 text-bar font-semibold text-ink">このお客様でしょうか？</h3>
        {phase === 'forbidden' ? (
          <p role="alert" className="mt-1 text-body text-ink">
            この画面は店長だけがご覧になれます
          </p>
        ) : phase === 'error' ? (
          <p role="alert" className="mt-1 text-body text-danger">
            同じ番号のご来店をお調べできませんでした。もう一度お試しいただくか、お名前で承れます。
          </p>
        ) : phase === 'loading' ? (
          <p role="status" className="mt-1 text-grid text-ink-muted">
            同じ番号のご来店をお調べしています…
          </p>
        ) : candidates.length === 0 ? (
          <p role="status" className="mt-1 text-grid text-ink-muted">
            同じ番号のご来店は見つかりませんでした。
          </p>
        ) : (
          <>
            <p role="status" className="mt-1 text-grid text-ink-muted">
              {`同じ番号のご来店が${candidates.length}件見つかりました。`}
            </p>
            <p className="mt-1 text-grid text-ink-muted">お名前を声に出してお確かめください。</p>
          </>
        )}
      </div>

      {listed.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="お客様の候補"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4.5"
        >
          {listed.map((candidate, index) => {
            const strong = candidate.match === 'strong'
            return (
              <div
                role="option"
                key={candidate.customer.id}
                tabIndex={-1}
                aria-selected={index === active}
                className={`mt-4 rounded-card border-2 px-4.5 py-4 first:mt-0 ${
                  strong ? 'border-pine bg-pine-soft' : 'border-line bg-surface'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <b className="text-bar font-bold text-ink">{`${candidate.customer.name} 様`}</b>
                  <VisitBadge count={candidate.customer.visitCount} />
                  <MatchTag match={candidate.match} />
                </div>
                <dl className="m-0 mt-3 grid gap-1.5">
                  {strong && candidate.customer.kana !== '' && (
                    <Row term="ふりがな">{candidate.customer.kana}</Row>
                  )}
                  {!strong && candidate.customer.phone !== null && (
                    <Row term="ご連絡先" mono>
                      {formatPhoneDigits(candidate.customer.phone)}
                    </Row>
                  )}
                  {candidate.lastVisitAt !== null && (
                    <Row term="前回">{lastVisitLabel(candidate.lastVisitAt)}</Row>
                  )}
                </dl>
                <div className="mt-4">
                  <button
                    type="button"
                    ref={(node) => {
                      buttonsRef.current[index] = node
                    }}
                    onClick={() => onSelect(candidate)}
                    className={
                      strong
                        ? `min-h-12 rounded-card border border-pine bg-pine px-4.5 text-body font-semibold text-on-pine ${focusRingOnPine}`
                        : `${FOOT_BUTTON} ${focusRing}`
                    }
                  >
                    このお客様で進む
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex flex-none gap-2 rounded-b-panel border-line border-t bg-surface-2 px-5 py-3.5">
        <button type="button" onClick={dismiss} className={`${FOOT_BUTTON} ${focusRing}`}>
          どちらでもありません
        </button>
        <button
          type="button"
          onClick={() => {
            returnFocusTo?.current?.focus()
            onReenter()
          }}
          className={`min-h-12 rounded-card px-4.5 text-body font-semibold text-pine ${focusRing}`}
        >
          番号を入れ直す
        </button>
      </div>
    </div>
  )
}
