import type { CustomerCandidate, VisitPurpose, Walkin } from '@app/contracts'
import { auth } from '@app/shared'
import { cn, focusRing, focusRingOnPine } from '@app/ui'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { normalizePhone, searchMode, visitLabel } from '../../worker/domain/customers'
import { formatTicket } from '../../worker/domain/walkin'
import { formatPhoneDigits } from '../booking/CustomerStep'
import { client } from '../client'

/*
 * 台帳に重なる受付パネル（承認済みモック
 * docs/frontend/mockups/eyex/images/LEDGER-WALKIN.png）。
 *
 * 題材: 台帳を見たまま、店頭のお客様のご用件を 3 タップで伺って受け付ける面。
 * トークン計画: 台帳を隠しきらない右 400px のパネル 1 枚。茶（`--color-walkin` /
 *   `--color-walkin-soft`）は待ち状況の帯と整理番号の札だけ、緑は選んだご用件と主操作だけ。
 * シグネチャ: **お客様を後回しにできること**（「あとで登録する」のまま主操作が押せる）。
 *
 * 実測（screens/LEDGER-WALKIN.html の <style> と assets/eyex.css）:
 *   `.panel` は `position:absolute` の top/right/bottom 0・幅 400px（w-100）・
 *   左罫 1px --line-strong・地は白。
 *   `.wh` padding 12px 22px（px-5.5 py-3）・下罫 1px、`h2` 18px、
 *   「やめる」min-height 44px / padding 0 10px。
 *   `.wb` padding 22px 22px 0、`.sec` の間 24px（mt-6）。`.wf` padding 20px 22px。
 *   `.waitline` min-height 44px / padding 0 12px / 角 12px（rounded-card）/
 *   地 --walkin-tint / 枠 1px --walkin。中は 15px/600 ＋ small ＋ 右端の札。
 *   `.picks` は 2 列・gap 10px、`.pick` min-height 60px（min-h-15）/ padding 8px 10px /
 *   角 8px（rounded-ctl）、見出し 15px/600・所要 12px。選択中は枠 3px --brand ＋
 *   地 --brand-tint（padding 6px 8px）。
 *   `.label` 13px（下に 10px）、`.field` min-height 52px（min-h-13）/ 16px、
 *   `.wchip` min-height 44px / padding 0 14px / 角ピル。
 *   主操作は幅いっぱい・min-height 56px（min-h-14）。
 *
 * モックの 18px / 15px はトークンの段（`--text-bar` 19px / `--text-body` 16px）へ寄せた。
 * 選択中のご用件は**枠の太さ（1px → 3px）でも変わる**ので、色が見えなくても選べる。
 *
 * この面が持たないもの（`008-reception-and-walkin` の「決めたこと」）:
 * - 新しいお客様を登録する導線（受付を止めないため。受け付けたあとに来店受付ボードから登録する）
 * - 「いまお待ち」「目安」「次の整理番号」の照会（台帳の応答を props で受け取り、**API を足さない**）
 * - 台帳側の点線の枠「ここに入ります」と最下段の帯（`005-availability-and-ledger` が描く）
 */

/** モックが描いているご用件の数。5 つ目が要るお店は設定の並び順の上 4 件を出す。 */
const PURPOSE_CHOICES = 4

export type WalkinPanelProps = {
  storeId: string
  /** ご用件の 4 択。設定（P1）の並び順のまま渡す。画面で並べ替えない。 */
  purposes: readonly VisitPurpose[]
  /** 台帳の応答（`LedgerView`）が持つ 3 欄。**このパネルから引き直さない。** */
  walkinWaitingCount: number
  /** 空き枠エンジンが出せないときは null（担当の空きを見ない数字を出さない）。 */
  estimatedWaitMinutes: number | null
  nextTicketNo: number
  /** 入る枠があるか。無いときは 1 文で言い、受け付け自体は止めない。 */
  hasOpenSlot?: boolean
  /** 受け付けられた。器が台帳を読み直す。 */
  onReceived: (walkin: Walkin) => void
  onClose: () => void
  /** 閉じたときフォーカスを返す先（台帳の「店頭のお客様を受け付ける」）。 */
  returnFocusTo?: RefObject<HTMLElement | null>
}

/** 送りの様子。`done` になったら主操作は二度と効かない（同じお客様を 2 件作らない）。 */
type SendPhase = 'idle' | 'sending' | 'done'

/** 「約60分」。 */
function durationLabel(minutes: number): string {
  return `約${minutes}分`
}

/**
 * 打たれた文字から照会の条件を作る。**ちょうど 4 桁だけが下 4 桁**で、
 * 打ち終えた 10〜11 桁は番号そのもの、それ以外は照会に行かない
 * （空振りを台帳の全走査にしない。`worker/domain/customers` の読み分けをそのまま使う）。
 */
function lookupParam(typed: string): { key: 'phoneLast4' | 'phone'; value: string } | null {
  const mode = searchMode(typed)
  if (mode.kind === 'phoneLast4') return { key: 'phoneLast4', value: mode.value }
  const normalized = normalizePhone(typed)
  return normalized === null ? null : { key: 'phone', value: normalized }
}

export function WalkinPanel({
  storeId,
  purposes,
  walkinWaitingCount,
  estimatedWaitMinutes,
  nextTicketNo,
  hasOpenSlot = true,
  onReceived,
  onClose,
  returnFocusTo,
}: WalkinPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  /*
   * `Idempotency-Key` は**この面で 1 度だけ**作る。二度押しは `phase` が止めるが、
   * 届いたかどうか分からないまま押し直された 1 回はサーバ側でしか止められない。
   * 断られたあとは作り直す（サーバは `in_progress` を空けているので、同じ鍵のまま
   * 中身を直して送ると 409 `idempotency_conflict` になる。`04-api.md` §6.2）。
   */
  const idempotencyKey = useRef(crypto.randomUUID())

  const [purposeId, setPurposeId] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [typedPhone, setTypedPhone] = useState('')
  const [candidates, setCandidates] = useState<readonly CustomerCandidate[]>([])
  const [customer, setCustomer] = useState<CustomerCandidate | null>(null)
  const [phase, setPhase] = useState<SendPhase>('idle')
  const [failure, setFailure] = useState<string | null>(null)

  // 面が差し替わったら見出しへフォーカスを移す（読み上げがどこに来たかを言える）。
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  /*
   * 番号を打ち終えた瞬間に候補を出す。**入力欄からフォーカスを奪わない** —
   * 候補は入力の下に並ぶだけで、打ち続けられる（`customers/CustomerMatch` と同じ扱い）。
   */
  useEffect(() => {
    const param = lookupParam(typedPhone)
    if (param === null) {
      setCandidates([])
      return
    }
    let live = true
    async function ask(query: { key: string; value: string }) {
      const res = await client.api.staff.customers.lookup.$get(undefined, {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          auth.authFetch(`${String(input)}?${query.key}=${encodeURIComponent(query.value)}`, init),
      })
      if (!live || !res.ok) return
      const hits: CustomerCandidate[] = await res.json()
      if (live) setCandidates(hits)
    }
    ask(param).catch(() => {
      // 照会が届かなくても受け付けは止めない（お客様は「あとで登録する」で通せる）。
      if (live) setCandidates([])
    })
    return () => {
      live = false
    }
  }, [typedPhone])

  const chosen = purposes.slice(0, PURPOSE_CHOICES)
  const hasPurpose = purposeId !== null || note.trim() !== ''
  const canSend = hasPurpose && phase === 'idle'

  function dismiss() {
    returnFocusTo?.current?.focus()
    onClose()
  }
  // Esc の購読を張り直さずに済むよう、最新の閉じ方を ref に控える。
  const dismissRef = useRef(dismiss)
  dismissRef.current = dismiss

  /*
   * Esc で閉じる（台帳の予約の詳細 `ledger/ReservationDetail.tsx` と同じ扱い）。
   * このパネルは台帳を隠しきらない非モーダルなので `<dialog>` にはせず、
   * 逃げ道だけを同じ鍵で揃える。閉じたあとのフォーカスは `dismiss` が返す。
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      dismissRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function choosePurpose(id: string) {
    // ご用件は 4 択か自由記述の**ちょうど一方**（契約の `exactlyOnePurpose` と同じ形にする）。
    setPurposeId((current) => (current === id ? null : id))
    setNote('')
    setNoteOpen(false)
  }

  async function send() {
    if (!canSend) return
    setPhase('sending')
    setFailure(null)
    try {
      const res = await client.api.staff.walkins.$post(
        {
          json: {
            storeId,
            ...(purposeId === null ? { purposeNote: note.trim() } : { purposeId }),
            ...(customer === null ? {} : { customerId: customer.customer.id }),
          },
        },
        { headers: { 'Idempotency-Key': idempotencyKey.current } },
      )
      const body: unknown = await res.json()
      if (res.ok) {
        setPhase('done')
        onReceived(body as Walkin)
        return
      }
      // 断られた。**伺った内容は捨てない。**鍵だけ作り直して、同じ画面から送り直せるようにする。
      idempotencyKey.current = crypto.randomUUID()
      const error = (body as { error?: string }).error
      setFailure(
        error === 'slot_taken'
          ? 'ちょうど同じ時間がふさがりました。もう一度お試しください。'
          : '受け付けられませんでした。もう一度お試しください。',
      )
      setPhase('idle')
    } catch {
      idempotencyKey.current = crypto.randomUUID()
      setFailure('通信が切れているようです。つながってからもう一度お試しください。')
      setPhase('idle')
    }
  }

  return (
    <aside
      aria-label="店頭のお客様の受け付け"
      className="absolute top-0 right-0 bottom-0 z-20 flex w-100 flex-col border-line-strong border-l bg-surface"
    >
      <div className="flex flex-none items-center gap-2.5 border-line border-b px-5.5 py-3">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className={cn('m-0 flex-1 text-bar font-semibold text-ink', focusRing)}
        >
          店頭のお客様を受け付けます
        </h2>
        <button
          type="button"
          onClick={dismiss}
          className={cn('min-h-11 rounded-ctl px-2.5 text-body font-semibold text-pine', focusRing)}
        >
          やめる
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5.5 pt-5.5">
        <fieldset
          aria-label="いまの待ち状況"
          className="flex min-h-11 items-center gap-2.5 rounded-card border border-walkin bg-walkin-soft px-3"
        >
          <b className="text-body font-semibold text-walkin">{`いまお待ち ${walkinWaitingCount}名`}</b>
          {estimatedWaitMinutes !== null && (
            <span className="text-grid text-ink-muted">{`目安 ${estimatedWaitMinutes}分`}</span>
          )}
          <span className="ml-auto inline-flex min-h-5.5 items-center rounded-ctl border border-walkin bg-walkin-soft px-2 font-mono text-note font-semibold text-walkin">
            {formatTicket(nextTicketNo)}
          </span>
        </fieldset>

        {!hasOpenSlot && (
          <p role="status" className="mt-2.5 text-grid text-ink-muted">
            いまお入れできる枠がありません。お待ちの列に入れます。
          </p>
        )}

        <div className="mt-6">
          <span className="mb-2.5 block text-grid font-semibold text-ink-muted">ご用件</span>
          <fieldset aria-label="ご用件" className="grid grid-cols-2 gap-2.5">
            {chosen.map((option) => {
              const on = option.id === purposeId
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => choosePurpose(option.id)}
                  className={cn(
                    'min-h-15 rounded-ctl text-left',
                    on
                      ? 'border-3 border-pine bg-pine-soft px-2 py-1.5 text-pine-deep'
                      : 'border border-line-strong bg-surface px-2.5 py-2 text-ink',
                    focusRing,
                  )}
                >
                  <span className="block text-body font-semibold">{option.nameInternal}</span>
                  <span className="mt-0.5 block text-note font-normal">
                    {durationLabel(option.durationMinutes)}
                  </span>
                </button>
              )
            })}
          </fieldset>
          {/*
           * 4 択に無いご用件（「フレームの相談」）。**4 択を 5 つに増やさない** —
           * 増やすと 2×2 の格子が崩れ、3 タップで済んでいた受付が読む作業になる。
           */}
          {noteOpen ? (
            <input
              type="text"
              value={note}
              maxLength={80}
              autoComplete="off"
              aria-label="ご用件を書く（80 文字まで）"
              onChange={(event) => {
                setNote(event.target.value)
                setPurposeId(null)
              }}
              className={cn(
                'mt-2.5 min-h-13 w-full rounded-card border border-line-strong bg-surface px-3.5 text-body text-ink',
                'placeholder:text-ink-faint',
                focusRing,
              )}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setNoteOpen(true)
                setPurposeId(null)
              }}
              className={cn(
                'mt-2.5 min-h-11 rounded-ctl px-2 text-grid font-semibold text-pine',
                focusRing,
              )}
            >
              4 択にないご用件
            </button>
          )}
        </div>

        <div className="mt-6 pb-5.5">
          <span className="mb-2.5 block text-grid font-semibold text-ink-muted">お客様</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={typedPhone}
            aria-label="電話番号で探す（下4桁でも探せます）"
            placeholder="電話番号で探す（下4桁でも探せます）"
            onChange={(event) => setTypedPhone(event.target.value)}
            className={cn(
              'min-h-13 w-full rounded-card border border-line-strong bg-surface px-3.5 text-body text-ink',
              'placeholder:text-ink-faint',
              focusRing,
            )}
          />
          {candidates.length > 0 && (
            <fieldset aria-label="同じ番号のご来店" className="mt-2.5 flex flex-col gap-2">
              {candidates.map((hit) => (
                <button
                  key={hit.customer.id}
                  type="button"
                  aria-pressed={customer?.customer.id === hit.customer.id}
                  onClick={() => setCustomer(hit)}
                  className={cn(
                    'flex min-h-11 items-center gap-2.5 rounded-card px-3 text-left',
                    customer?.customer.id === hit.customer.id
                      ? 'border-2 border-pine bg-pine-soft text-pine-deep'
                      : 'border border-line-strong bg-surface text-ink',
                    focusRing,
                  )}
                >
                  <span className="text-body font-semibold">{`${hit.customer.name} 様`}</span>
                  <span className="text-note text-ink-muted">
                    {visitLabel(hit.customer.visitCount, 'list')}
                  </span>
                  {hit.customer.phone !== null && (
                    <span className="ml-auto font-mono text-note text-ink-muted">
                      {formatPhoneDigits(hit.customer.phone)}
                    </span>
                  )}
                </button>
              ))}
            </fieldset>
          )}
          {/*
           * 「あとで登録する」は**押さえたまま**が既定である。お名前を伺わないうちから
           * 受け付けられることがこの面の芯なので、外すのはお客様が決まったときだけ。
           */}
          <div className="mt-2.5">
            <button
              type="button"
              aria-pressed={customer === null}
              onClick={() => setCustomer(null)}
              className={cn(
                'min-h-11 rounded-full px-3.5 text-body font-semibold',
                customer === null
                  ? 'border-2 border-pine bg-pine-soft text-pine-deep'
                  : 'border border-line-strong bg-surface text-ink',
                focusRing,
              )}
            >
              あとで登録する
            </button>
          </div>
        </div>
      </div>

      <div className="flex-none px-5.5 py-5">
        {failure !== null && (
          <p role="alert" className="mb-2.5 text-grid text-danger">
            {failure}
          </p>
        )}
        <button
          type="button"
          disabled={!canSend}
          onClick={() => {
            send().catch(() => undefined)
          }}
          className={cn(
            'min-h-14 w-full rounded-card bg-pine text-lead font-semibold text-on-pine',
            'disabled:cursor-not-allowed disabled:opacity-50',
            focusRingOnPine,
          )}
        >
          受付して台帳に載せる
        </button>
      </div>
    </aside>
  )
}
