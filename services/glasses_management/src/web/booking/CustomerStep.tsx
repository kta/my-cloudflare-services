import type { CustomerCandidate } from '@app/contracts'
import { focusRing } from '@app/ui'
import {
  type CompositionEvent as ReactCompositionEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { CustomerHandover, CustomerMatch, PickToFillHint } from '../customers/CustomerMatch'
import { Handwriting, HandwrittenInk, type HandwrittenNote, signature } from './Handwriting'
import { Keypad } from './Keypad'
import type { StepGuard } from './steps'

/*
 * 工程 4 お客様（承認済みモック docs/frontend/mockups/eye/images/BOOK-04-CUSTOMER.png と
 * BOOK-04c-KEYPAD.png）。
 *
 * この面の仕事は「受話器を持ったまま片手で番号を打ち切り、伺えないときはお名前だけで進む」こと。
 *
 * 実測値（screens/BOOK-04-CUSTOMER.html / BOOK-04c-KEYPAD.html と assets/eye.css）:
 *   本文 1fr ／ 右の柱 372px（`w-93`）、本文の余白 36px 44px・柱 36px 28px。
 *   番号の欄は 幅 420px・最小高 96px・34px のモノスペース・字間 .04em。
 *   テンキーを開くと 幅 520px・最小高 104px になり、右の柱が「番号を打つ」に替わる。
 *   お名前とふりがなは 2 列・間 26px・最大 700px・最小高 60px。
 *   ご要望の箱は最小高 168px・最大 700px・内側 16px 18px。
 *
 * **候補の吹き出し（BOOK-04b-CUSTOMER-MATCH）**は `customers/CustomerMatch.tsx` の部品を
 * ここへ差し込む（P4・`007-customer-records`）。「完了」を押して 10/11 桁が揃った瞬間に
 * `onLookup` を呼び、返った候補を吹き出しで出す。**1 件でも自動では確定しない**
 * （AC-CUST-05）ので、選ぶまでお名前・ふりがなの欄は空のままにする。
 * 吹き出しはモーダルにしない —— フォーカスはお電話番号の欄に残したまま開き
 * （AC-CUST-21）、Esc・外側クリック・「どちらでもありません」のどれでも同じフォーカスへ戻る。
 * 「番号を入れ直す」は打った桁を捨ててテンキーを開き直す。
 *
 * 伺ったお名前・ふりがな・お電話番号は `reception_sessions.draft_json` の
 * 打ちかけの文字（`nameTyped` / `kanaTyped` / `phoneTyped`）に置く。
 * **候補を選んだら、その方の id も持つ**（`customerId`）。器がそれを
 * `POST /api/staff/reservations` の `customerId` へ載せて、選んだ 1 名と
 * ご予約を結び付ける。持たなかったころ、候補から選んでも予約行の `customer_id` は
 * NULL のままで、台帳の帯にお名前も来店回数も出ず、来店回数も一生増えなかった
 * （実装不足の洗い出し customers-01。AC-CUST-24 / 25、AC-CUST-10 / 11）。
 * 番号を打ち直したら id も捨てる —— 違う番号の答えを引きずらない。
 */

/** 工程 4 が持つ下書き。`ReceptionSessionDraft` の打ちかけの欄と同じ名前にする。 */
export type CustomerDraft = {
  phoneTyped: string
  nameTyped: string
  kanaTyped: string
  noteTyped: string
  /**
   * 候補から選んだお客様。選んでいなければ null。
   * 器がこれを予約の `customerId` に載せる（打ちかけの文字と違い、これは id である）。
   */
  customerId: string | null
  /** 手書きで残したご要望。R2 へ上げて `handwritingKeys` にするのは器の仕事。 */
  notes: readonly HandwrittenNote[]
}

/** 右の柱に出す「ここまでのご予約」。 */
type BookingSoFar = {
  dateTimeLabel: string
  purposeLabel: string
  durationMinutes: number
  /** 「担当はあとで決める」を押していれば null。 */
  staffLabel: string | null
  equipmentLabel: string | null
}

type CustomerStepPhase = 'loading' | 'ready' | 'error' | 'forbidden'

export type CustomerStepProps = {
  value: CustomerDraft
  onChange: (next: CustomerDraft) => void
  soFar: BookingSoFar
  /** 手書きに添える記入者。「山田 大輔（店長）」。 */
  writer: string
  /** いまの時刻。端末の時計を読まない（引数で受ける）。 */
  now: string
  /** 同じ番号のご登録を照会する（AC-CUST-04）。10 桁・11 桁が揃った時点で器が呼ぶ。 */
  onLookup: (phoneDigits: string) => Promise<readonly CustomerCandidate[]>
  phase?: CustomerStepPhase
  isOffline?: boolean
}

/** 候補の吹き出しの状態。 */
type MatchState =
  | { kind: 'closed' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'open'; candidates: readonly CustomerCandidate[] }
  | { kind: 'selected'; candidate: CustomerCandidate }

/* --- お電話番号 ----------------------------------------------------------- */

/** 携帯・IP 電話の頭 3 桁。ここで始まる番号だけが 11 桁になる。 */
const ELEVEN_DIGIT_PREFIXES = ['070', '080', '090', '050'] as const

/**
 * 揃うべき桁数。頭 3 桁が携帯・IP 電話なら 11 桁、それ以外は 10 桁。
 * 3 桁に満たないうちは 11 桁と見なす（受付で伺うのは携帯が大半で、モックの
 * 「090-1234-5」→「あと3桁」もこの数え方である）。
 */
function phoneTarget(digits: string): number {
  if (digits.length < 3) return 11
  return ELEVEN_DIGIT_PREFIXES.some((prefix) => digits.startsWith(prefix)) ? 11 : 10
}

/** 区切りの入れ方。11 桁は 3-4-4、東京・大阪の 10 桁は 2-4-4、ほかの 10 桁は 3-3-4。 */
function phoneGroups(digits: string): readonly number[] {
  if (phoneTarget(digits) === 11) return [3, 4, 4]
  return digits.startsWith('03') || digits.startsWith('06') ? [2, 4, 4] : [3, 3, 4]
}

/** 数字だけの並びを「090-1234-5678」の形にする。打ちかけでも同じ区切りで見せる。 */
export function formatPhoneDigits(digits: string): string {
  const parts: string[] = []
  let cursor = 0
  for (const size of phoneGroups(digits)) {
    if (cursor >= digits.length) break
    parts.push(digits.slice(cursor, cursor + size))
    cursor += size
  }
  return parts.join('-')
}

/* --- 進める条件 ----------------------------------------------------------- */

/**
 * 「次へ進む」の可否。お名前が入っていれば進める（お電話番号は伺えないことがある。
 * AC-BOOK-11）。押せないときの理由は読み上げの名前に入るので「〜すると進めます」の型で書く。
 */
export function customerStepReady(value: CustomerDraft): StepGuard {
  return value.nameTyped.trim() === ''
    ? { canProceed: false, blockedReason: 'お客様が決まると進めます' }
    : { canProceed: true, blockedReason: '' }
}

/* --- ふりがなの自動入力 --------------------------------------------------- */

/** ひらがな・長音・空白だけでできているか（変換前の読みかどうかの目印）。 */
function isReading(text: string): boolean {
  return text !== '' && /^[ぁ-ゖー　 ]+$/.test(text)
}

/* --- 画面 ----------------------------------------------------------------- */

const FIELD = `flex items-center rounded-card border border-line-strong bg-surface px-3.5 text-lead text-ink placeholder:text-ink-faint ${focusRing}`

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="mt-6 text-note text-ink-muted">{term}</dt>
      <dd className="mt-0.5 text-lead font-semibold text-ink">{children}</dd>
    </>
  )
}

export function CustomerStep({
  value,
  onChange,
  soFar,
  writer,
  now,
  onLookup,
  phase = 'ready',
  isOffline = false,
}: CustomerStepProps) {
  const [padOpen, setPadOpen] = useState(false)
  const [writing, setWriting] = useState(false)
  const [autoFilled, setAutoFilled] = useState(false)
  const [match, setMatch] = useState<MatchState>({ kind: 'closed' })
  const nameRef = useRef<HTMLInputElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  // 変換確定中は `input` の値を読まない（`07-nfr.md` §2.9）。
  const composing = useRef(false)
  // 変換前に打たれた読み。`compositionend` の `data` は変換後の漢字なので読みにならない。
  const reading = useRef('')
  // 人が一度でも直したふりがなは、そのあと自動で上書きしない（§7.7）。
  const kanaTouched = useRef(false)
  // 打ち直しの途中で古い照会の答えが着かないよう、最後の 1 回だけを採る。
  const lookupTicket = useRef(0)

  const digits = value.phoneTyped
  const target = phoneTarget(digits)
  const missing = Math.max(0, target - digits.length)
  const remainingLabel = digits.length === 0 || missing === 0 ? null : `あと${missing}桁`
  /*
   * 候補が出ていて、まだどれも押されていない間は、お名前とふりがなの欄に
   * 「お選びになると入ります」を添える（AC-CUST-05 / AC-CUST-22）。**飾りではなく手順**
   * なので `aria-describedby` で欄そのものの読み上げにも乗せる。
   */
  const pickToFill = match.kind === 'open' && match.candidates.length > 0 && value.nameTyped === ''

  // 番号を打ち直したら、いま出ている候補・選んだ候補は捨てる（違う番号の答えを引きずらない）。
  useEffect(() => {
    if (missing !== 0) setMatch({ kind: 'closed' })
  }, [missing])

  function patch(next: Partial<CustomerDraft>) {
    onChange({ ...value, ...next })
  }

  function typeDigit(digit: string) {
    if (digits.length >= target) return
    // 番号を打ち直したら、選んだ方の id も捨てる。残すと、別の番号を打って
    // 名前だけ書き換えたご予約が、前に選んだ方へぶら下がる。
    patch({ phoneTyped: `${digits}${digit}`, customerId: null })
  }

  async function lookup(typed: string) {
    const mine = lookupTicket.current + 1
    lookupTicket.current = mine
    setMatch({ kind: 'loading' })
    try {
      const candidates = await onLookup(typed)
      if (lookupTicket.current !== mine) return
      if (candidates.length === 0) {
        // 当てはまりが無ければ、そのまま手入力へ進める（行き止まりにしない）。
        setMatch({ kind: 'closed' })
        nameRef.current?.focus()
        return
      }
      setMatch({ kind: 'open', candidates })
    } catch {
      if (lookupTicket.current === mine) setMatch({ kind: 'failed' })
    }
  }

  function finishPhone() {
    setPadOpen(false)
    if (missing === 0 && digits.length > 0) {
      // AC-CUST-21: 候補が開いている間はフォーカスをお電話番号の欄に残す
      // （番号を入れ直す・読み上げで欄をたどる、どちらも欄にフォーカスがある前提のため）。
      // 当てはまりが無かったときだけ、答えが着いた時点でお名前の欄へ移す。
      phoneRef.current?.focus()
      void lookup(digits)
    } else {
      nameRef.current?.focus()
    }
  }

  /** 変換が確定した（または欄を離れた）ときに 1 度だけ埋める。 */
  function fillKana() {
    if (kanaTouched.current || reading.current === '' || value.kanaTyped !== '') return
    patch({ kanaTyped: reading.current })
    setAutoFilled(true)
  }

  function onCompositionUpdate(event: ReactCompositionEvent<HTMLInputElement>) {
    if (isReading(event.data)) reading.current = event.data
  }

  if (phase === 'loading') {
    return (
      <div className="flex h-full w-full min-h-0">
        <section className="min-w-0 flex-1 px-11 py-9">
          <p role="status" className="text-body text-ink-muted">
            ご予約の受付を読み込んでいます…
          </p>
          <div aria-hidden="true" className="mt-8 h-24 w-105 rounded-card bg-surface-2" />
          <div aria-hidden="true" className="mt-8 h-15 max-w-175 rounded-card bg-surface-2" />
          <div aria-hidden="true" className="mt-8 h-42 max-w-175 rounded-card bg-surface-2" />
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

  if (writing) {
    return (
      <Handwriting
        writer={writer}
        now={now}
        isOffline={isOffline}
        onCancel={() => setWriting(false)}
        onSave={(note) => {
          patch({ notes: [...value.notes, note] })
          setWriting(false)
        }}
      />
    )
  }

  return (
    <div className="flex h-full w-full min-h-0">
      <section className="min-w-0 flex-1 overflow-hidden px-11 py-9">
        <div className="mb-2.5 flex items-start gap-2.5">
          <span aria-hidden="true" className="mt-1.5 h-4.5 w-5.5 shrink-0 rounded-ctl bg-pine" />
          <div>
            <h2 className="text-title font-semibold text-ink">お電話番号を伺えますか？</h2>
            <p className="mt-0.5 text-body text-ink-muted">
              {padOpen
                ? '伺ったとおりに打ち込みます。'
                : 'お伝えいただけないときは、お名前だけでも承ります。'}
            </p>
          </div>
        </div>

        {isOffline && (
          <p
            role="status"
            className="mb-6 rounded-card border border-line-strong bg-surface-2 px-4 py-3 text-body text-ink"
          >
            通信が切れています。伺った内容はこのまま残ります。
          </p>
        )}
        {phase === 'error' && (
          <p
            role="alert"
            className="mb-6 rounded-card border border-danger bg-danger-soft px-4 py-3 text-body text-danger"
          >
            うまく処理できませんでした。入力はそのまま残っています。もう一度お試しください。
          </p>
        )}

        <div className="grid gap-8">
          <div className="relative">
            <label
              htmlFor="booking-phone"
              className="mb-1.5 block text-grid font-semibold text-ink-muted"
            >
              お電話番号
            </label>
            <div className={padOpen ? 'relative w-130' : 'relative w-105'}>
              <input
                id="booking-phone"
                ref={phoneRef}
                type="tel"
                inputMode="none"
                autoComplete="off"
                enterKeyHint="next"
                value={formatPhoneDigits(digits)}
                // APG の combobox パターン（`customers/CustomerMatch.tsx` の頭のコメント）。
                // 候補は自動確定しない一覧なので `aria-autocomplete="list"` にする。
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={match.kind === 'open' || match.kind === 'loading'}
                aria-controls={
                  match.kind === 'open' || match.kind === 'loading'
                    ? 'booking-customer-match'
                    : undefined
                }
                // タップだけでテンキーを開く。フォーカスでは開かない —— 候補を退けた・
                // 選んだあとにこの欄へフォーカスを戻すたびにテンキーが被さって出ないようにする。
                onClick={() => setPadOpen(true)}
                onChange={(event) => {
                  // 物理キーボードがつないである端末のための道。無くても完結する。
                  patch({
                    phoneTyped: event.target.value.replace(/\D/g, '').slice(0, target),
                    customerId: null,
                  })
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && missing === 0) finishPhone()
                }}
                className={`w-full rounded-card bg-surface pr-24 pl-4 font-mono font-semibold tracking-wider text-ink ${focusRing} ${
                  padOpen ? 'min-h-26 border-2 border-pine' : 'min-h-24 border border-line-strong'
                }`}
                style={{ fontSize: 'calc(var(--spacing) * 8.5)' }}
              />
              {remainingLabel !== null && (
                <span className="-translate-y-1/2 absolute top-1/2 right-4 text-grid font-semibold text-ink-muted">
                  {remainingLabel}
                </span>
              )}
            </div>

            {(match.kind === 'open' || match.kind === 'loading' || match.kind === 'failed') && (
              <CustomerMatch
                listboxId="booking-customer-match"
                candidates={match.kind === 'open' ? match.candidates : []}
                phase={
                  match.kind === 'loading' ? 'loading' : match.kind === 'failed' ? 'error' : 'ready'
                }
                returnFocusTo={phoneRef}
                onSelect={(candidate) => {
                  setMatch({ kind: 'selected', candidate })
                  patch({
                    nameTyped: candidate.customer.name,
                    kanaTyped: candidate.customer.kana,
                    customerId: candidate.customer.id,
                  })
                }}
                onDismiss={() => setMatch({ kind: 'closed' })}
                onReenter={() => {
                  setMatch({ kind: 'closed' })
                  patch({ phoneTyped: '', customerId: null })
                  setPadOpen(true)
                }}
              />
            )}
          </div>

          <div className="grid max-w-175 grid-cols-2 gap-6.5">
            <div>
              <label
                htmlFor="booking-name"
                className="mb-1.5 block text-grid font-semibold text-ink-muted"
              >
                お名前
              </label>
              <input
                id="booking-name"
                ref={nameRef}
                type="text"
                autoComplete="off"
                enterKeyHint="next"
                placeholder="例：田中 花子"
                value={value.nameTyped}
                onCompositionStart={() => {
                  composing.current = true
                  reading.current = ''
                }}
                onCompositionUpdate={onCompositionUpdate}
                onCompositionEnd={() => {
                  composing.current = false
                  fillKana()
                }}
                onChange={(event) => patch({ nameTyped: event.target.value })}
                onBlur={() => {
                  // iPadOS のかなキーボードは予測変換の直接確定で `compositionend` を出さない
                  // 経路があるので、欄を離れたときにもう一度拾う（`07-nfr.md` §2.9）。
                  if (!composing.current) fillKana()
                }}
                aria-describedby={pickToFill ? 'booking-name-pick-hint' : undefined}
                className={`${FIELD} min-h-15 w-full`}
              />
              {pickToFill && <PickToFillHint id="booking-name-pick-hint" />}
            </div>
            <div>
              <label
                htmlFor="booking-kana"
                className="mb-1.5 block text-grid font-semibold text-ink-muted"
              >
                ふりがな
              </label>
              <input
                id="booking-kana"
                type="text"
                autoComplete="off"
                enterKeyHint="next"
                placeholder="たなか はなこ"
                value={value.kanaTyped}
                onChange={(event) => {
                  kanaTouched.current = true
                  setAutoFilled(false)
                  patch({ kanaTyped: event.target.value })
                }}
                aria-describedby={pickToFill ? 'booking-kana-pick-hint' : undefined}
                className={`${FIELD} min-h-15 w-full`}
              />
              {pickToFill && <PickToFillHint id="booking-kana-pick-hint" />}
              {autoFilled && <p className="mt-1.5 text-grid text-ink-muted">自動で入れました</p>}
            </div>
          </div>

          <div>
            <label
              htmlFor="booking-note"
              className="mb-1.5 block text-grid font-semibold text-ink-muted"
            >
              ご要望・伝言（任意）
            </label>
            <div className="flex min-h-42 max-w-175 flex-col justify-between rounded-card border border-line-strong bg-surface px-4.5 py-4">
              <textarea
                id="booking-note"
                ref={noteRef}
                rows={2}
                placeholder="伺ったことばのまま書き留められます。"
                value={value.noteTyped}
                onChange={(event) => patch({ noteTyped: event.target.value })}
                className={`w-full resize-none bg-surface text-lead text-ink placeholder:text-ink-faint ${focusRing}`}
              />
              {value.notes.length > 0 && (
                <fieldset aria-label="残したご要望" className="mt-3 grid min-w-0 gap-3">
                  {value.notes.map((note) => (
                    <figure key={note.id} className="m-0">
                      <div className="rounded-ctl border border-line bg-surface p-2 text-ink">
                        <HandwrittenInk strokes={note.strokes} description={note.description} />
                      </div>
                      <figcaption className="mt-1 text-right text-grid text-ink-muted">
                        {signature(note.writtenBy, note.writtenAt)}
                      </figcaption>
                    </figure>
                  ))}
                </fieldset>
              )}
              <div className="mt-3 flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={isOffline}
                  onClick={() => setWriting(true)}
                  className={`min-h-12 rounded-card border border-line-strong bg-surface px-4.5 text-body font-semibold text-ink disabled:border-line disabled:bg-surface-2 disabled:text-ink-faint ${focusRing}`}
                >
                  手書きで書く
                </button>
                <button
                  type="button"
                  onClick={() => noteRef.current?.focus()}
                  className={`min-h-12 rounded-card px-4.5 text-body font-semibold text-pine ${focusRing}`}
                >
                  キーボードで入力
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {padOpen ? (
        <aside
          aria-label="番号を打つ"
          className="flex w-93 shrink-0 flex-col border-line border-l bg-surface px-7 py-9"
        >
          <h3 className="m-0 text-body font-semibold text-ink">番号を打つ</h3>
          <div className="my-auto">
            <Keypad
              label="電話番号のテンキー"
              onDigit={typeDigit}
              onDelete={() => patch({ phoneTyped: digits.slice(0, -1) })}
              onConfirm={finishPhone}
              confirmLabel="完了"
              confirmBlockedReason={missing === 0 ? null : `あと${missing}桁で押せます`}
              hint={remainingLabel === null ? null : `あと${missing}桁で「完了」を押せます`}
            />
          </div>
        </aside>
      ) : match.kind === 'open' || match.kind === 'loading' || match.kind === 'selected' ? (
        <CustomerHandover candidate={match.kind === 'selected' ? match.candidate : null} />
      ) : (
        <aside
          aria-label="ここまでのご予約"
          className="w-93 shrink-0 border-line border-l bg-surface px-7 py-9"
        >
          <h3 className="m-0 mb-1 text-body font-semibold text-ink">ここまでのご予約</h3>
          <dl className="m-0">
            <Row term="ご来店日時">{soFar.dateTimeLabel}</Row>
            <Row term="ご来店の目的">
              {soFar.purposeLabel}
              <small className="ml-2 text-grid font-normal text-ink-muted">{`約${soFar.durationMinutes}分`}</small>
            </Row>
            <Row term="担当と場所">
              {soFar.staffLabel ?? '担当はあとで決める'}
              {soFar.equipmentLabel !== null && (
                <small className="ml-2 text-grid font-normal text-ink-muted">
                  {soFar.equipmentLabel}
                </small>
              )}
            </Row>
            <Row term="お客様">
              {value.nameTyped === '' ? (
                <span className="font-normal text-ink-muted">いま伺っています</span>
              ) : (
                `${value.nameTyped} 様`
              )}
            </Row>
          </dl>
        </aside>
      )}
    </div>
  )
}
