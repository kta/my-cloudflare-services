import type { CustomerCandidate, CustomerCreate, CustomerSummary } from '@app/contracts'
import { focusRing, focusRingOnPine } from '@app/ui'
import { type CompositionEvent as ReactCompositionEvent, useId, useRef, useState } from 'react'
import { lastVisitLabel, visitLabel } from '../../worker/domain/customers'
import { formatPhoneDigits } from '../booking/CustomerStep'

/*
 * 新しいお客様を登録（承認済みモック docs/frontend/mockups/eye/images/CUSTOMER-NEW.png）。
 *
 * この面の仕事は「お電話番号を打った瞬間に同じ番号のご登録を突きつけ、二重の登録を止める」こと。
 * 警告は入力欄のすぐ下、同じ視線の上に出し、**進む前に必ず 2 択を通す**。
 *
 * 実測値（screens/CUSTOMER-NEW.html と assets/eye.css）:
 *   本文 1fr ／ 右の柱 356px（w-89）、本文の余白 32px 36px・間 26px、柱 32px 22px。
 *   お電話番号の欄は 幅 320px（max-w-80）・最小高 52px（min-h-13）・21px の等幅。
 *   重複の箱は padding 20px 22px・幅 550px まで、該当行は白地・1px --line-strong・角 8px・
 *   padding 12px 16px・間 24px、2 択は間 10px・上に 16px。
 *   お名前とふりがなは 2 列・間 20px・幅 550px まで。
 *   テンキーは 3 列 × 96px・間 12px、キーの高さ 72px（h-18）、角 12px、数字 28px、幅広キー 16px/600。
 *
 * モックの 21px / 18px / 15px は theme.css の段（`text-title` 22px / `text-lead` 17px /
 * `text-body` 16px）へ翻訳した。幅 550px は `--spacing` の刻みに乗る 552px（max-w-138）にした。
 *
 * **テンキーはこの面の持ち物にした。**並びは `1 2 3 / 4 5 6 / 7 8 9 / ハイフン 0 削除` の
 * 12 キーで確定キーを持たない —— 10 桁または 11 桁に達した時点で重複の照会が自動で走るので、
 * 押して確かめるものが無いからである（予約の工程 4 の盤は最下段が「削除 / 0 / 完了」で並びが違う）。
 * 「ハイフン」は桁を変えない —— 区切りは欄が入れる。押して何も起きないキーにしないため、
 * そのことは**キーの読み上げ名**（「ハイフン　区切りは自動で入ります」）で言う。
 * 盤の下に同じことを書いた 1 行は置かない —— この面の説明文が 3 つになり、
 * 「説明文は 2 つまで」（`docs/frontend/mockups/eye/README.md` の引き算の規準）を超えるため。
 */

/** 揃った番号の桁数。ここに達するたびに重複の照会が走る。 */
const LOOKUP_LENGTHS = [10, 11] as const
const MAX_DIGITS = 11
/** 重複の警告に並べる上限。6 件目からは「ほか N件」に畳む。 */
const MAX_HITS = 5

type CustomerNewPhase = 'ready' | 'error' | 'forbidden'

export type CustomerNewProps = {
  /** 同じお電話番号のご登録を照会する。10 桁・11 桁に達した時点で器が呼ばれる。 */
  onLookup: (phoneDigits: string) => Promise<readonly CustomerCandidate[]>
  /** 新しいお客様を登録して、ご予約へ進む。 */
  onCreate: (input: CustomerCreate) => void
  /** すでにご登録のあるお客様として進む（1 件も増やさない）。 */
  onUseExisting: (customer: CustomerSummary) => void
  /** 「あとで登録する（ウォークインのまま）」。 */
  onSkip: () => void
  /** 上のバーの「やめる」。器が持つときは渡さない。 */
  onCancel?: () => void
  phase?: CustomerNewPhase
}

/* --- テンキー ------------------------------------------------------------- */

const DIGIT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const
/** キー 1 つ。96×72px・角 12px。 */
const KEY = `h-18 w-24 rounded-card border border-line-strong bg-surface text-ink ${focusRing}`

function PhoneKeypad({
  onDigit,
  onDelete,
}: {
  onDigit: (digit: string) => void
  onDelete: () => void
}) {
  return (
    <div>
      <fieldset
        aria-label="電話番号のテンキー"
        className="mx-auto grid w-fit min-w-0 grid-cols-3 gap-3"
      >
        {DIGIT_KEYS.map((digit) => (
          <button
            key={digit}
            type="button"
            onClick={() => onDigit(digit)}
            className={`${KEY} text-hero`}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          aria-label="ハイフン　区切りは自動で入ります"
          className={`${KEY} text-body font-semibold`}
        >
          ハイフン
        </button>
        <button type="button" onClick={() => onDigit('0')} className={`${KEY} text-hero`}>
          0
        </button>
        <button type="button" onClick={onDelete} className={`${KEY} text-body font-semibold`}>
          削除
        </button>
      </fieldset>
    </div>
  )
}

/* --- 重複の警告 ----------------------------------------------------------- */

type Lookup =
  | { state: 'idle' }
  | { state: 'looking' }
  | { state: 'done'; hits: readonly CustomerCandidate[] }
  | { state: 'failed' }

const ACTION = `min-h-12 rounded-card border border-line-strong bg-surface px-4.5 text-body font-semibold text-ink ${focusRing}`
const ACTION_PRIMARY = `min-h-12 rounded-card border border-pine bg-pine px-4.5 text-body font-semibold text-on-pine ${focusRingOnPine}`

function Hit({
  candidate,
  onUse,
}: {
  candidate: CustomerCandidate
  /** 2 件以上のときだけ行の中に置く（どの方かを名指しできないため）。 */
  onUse: (() => void) | null
}) {
  const { customer } = candidate
  return (
    <li className="rounded-ctl border border-line-strong bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="min-w-0">
          <div className="text-lead font-bold text-ink">{`${customer.name} 様`}</div>
          <div className="mt-0.5 text-note text-ink-muted">
            {`${customer.kana}　／　${customer.customerNumber}`}
          </div>
        </div>
        <dl className="m-0 shrink-0">
          <dt className="whitespace-nowrap text-note text-ink-muted">ご来店</dt>
          <dd className="m-0 mt-0.5 whitespace-nowrap text-body font-semibold text-ink">
            {visitLabel(customer.visitCount, 'list')}
          </dd>
        </dl>
        <dl className="m-0 shrink-0">
          <dt className="whitespace-nowrap text-note text-ink-muted">最後のご来店</dt>
          <dd className="m-0 mt-0.5 whitespace-nowrap text-body font-semibold text-ink">
            {lastVisitLabel(candidate.lastVisitAt)}
          </dd>
        </dl>
      </div>
      {onUse !== null && (
        <button
          type="button"
          onClick={onUse}
          aria-label={`このお客様として進む　${customer.name} 様`}
          className={`${ACTION_PRIMARY} mt-3`}
        >
          このお客様として進む
        </button>
      )}
    </li>
  )
}

/* --- 画面 ----------------------------------------------------------------- */

const FIELD = `min-h-13 rounded-card border border-line-strong bg-surface px-3.5 text-lead text-ink placeholder:text-ink-faint ${focusRing}`

/** ひらがな・長音・空白だけでできているか（変換前の読みかどうかの目印）。 */
function isReading(text: string): boolean {
  return text !== '' && /^[ぁ-ゖー　 ]+$/.test(text)
}

export function CustomerNew({
  onLookup,
  onCreate,
  onUseExisting,
  onSkip,
  onCancel,
  phase = 'ready',
}: CustomerNewProps) {
  const fieldId = useId()
  const [digits, setDigits] = useState('')
  const [name, setName] = useState('')
  const [kana, setKana] = useState('')
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' })
  /** 重複を出したあと、人がどちらを選んだか。選ぶまで先へ進ませない。 */
  const [resolved, setResolved] = useState<'existing' | 'new' | null>(null)
  const [missingName, setMissingName] = useState(false)
  const [autoFilled, setAutoFilled] = useState(false)

  // 打ち直しの途中で古い照会の答えが着かないよう、最後の 1 回だけを採る。
  const ticket = useRef(0)
  // 変換確定中は `input` の値を読まない（`07-nfr.md` §2.9）。
  const composing = useRef(false)
  // 変換前に打たれた読み。`compositionend` の `data` は変換後の漢字なので読みにならない。
  const reading = useRef('')
  // 人が一度でも直したふりがなは、そのあと自動で上書きしない。
  const kanaTouched = useRef(false)

  async function look(target: string) {
    const mine = ticket.current + 1
    ticket.current = mine
    setLookup({ state: 'looking' })
    try {
      const hits = await onLookup(target)
      if (ticket.current === mine) setLookup({ state: 'done', hits })
    } catch {
      if (ticket.current === mine) setLookup({ state: 'failed' })
    }
  }

  function typePhone(next: string) {
    setDigits(next)
    setResolved(null)
    if (LOOKUP_LENGTHS.some((length) => length === next.length)) {
      void look(next)
    } else {
      ticket.current += 1
      setLookup({ state: 'idle' })
    }
  }

  /** 変換が確定した（または欄を離れた）ときに 1 度だけ埋める。 */
  function fillKana() {
    if (kanaTouched.current || reading.current === '' || kana !== '') return
    setKana(reading.current)
    setAutoFilled(true)
  }

  function onCompositionUpdate(event: ReactCompositionEvent<HTMLInputElement>) {
    if (isReading(event.data)) reading.current = event.data
  }

  function register() {
    if (name.trim() === '') {
      setMissingName(true)
      return
    }
    setMissingName(false)
    onCreate({
      name: name.trim(),
      ...(kana.trim() === '' ? {} : { kana: kana.trim() }),
      ...(digits.length < 10 ? {} : { phone: digits }),
    })
  }

  if (phase === 'forbidden') {
    return (
      <div className="flex h-full w-full min-h-0 px-9 py-8">
        <p
          role="alert"
          className="max-w-138 rounded-panel border border-line bg-surface px-5.5 py-5 text-lead text-ink"
        >
          この画面は店長だけがご覧になれます
        </p>
      </div>
    )
  }

  /*
   * 見出しは「同じお電話番号のお客様がいます」なので、**番号が全桁一致した方だけ**を並べる。
   * 照会（`GET /api/staff/customers/lookup`）は予約の工程 4 の候補と同じ入口で、先頭 7 桁の
   * 前方一致も拾う（`worker/domain/customers.ts` の `LOOKUP_PREFIX_DIGITS`）。前方一致は
   * 「よく似た番号の別の方」であって同じ番号ではないので、ここに混ぜると見出しが嘘になる
   * （090-1234-5678 を打つと 090-1234-9912 の方まで「同じお電話番号」として突きつけていた）。
   * AC-CUST-11 も該当を 1 件と定めている。工程 4 の候補は前方一致も見せてよい —— あちらの
   * 見出しは「このお客様でしょうか？」で、札が「確かめが必要です」と言い分けている。
   */
  const hits = lookup.state === 'done' ? lookup.hits.filter((hit) => hit.match === 'strong') : []
  const shown = hits.slice(0, MAX_HITS)
  const folded = hits.length - shown.length
  const blockedReason =
    hits.length === 0 || resolved !== null
      ? null
      : '同じお電話番号のお客様がいます。どちらかをお選びになると押せます'

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      {onCancel !== undefined && (
        <div className="flex justify-end px-9 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className={`min-h-11 rounded-card border border-line-strong bg-surface px-3.5 text-body text-ink ${focusRing}`}
          >
            やめる
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col gap-6.5 overflow-y-auto px-9 py-8">
          <div className="flex items-start gap-2.5">
            <span aria-hidden="true" className="mt-1.5 h-4.5 w-5.5 shrink-0 rounded-ctl bg-pine" />
            <div>
              <h2 className="text-title font-semibold text-ink">お客様のことをお伺いします</h2>
              <p className="mt-0.5 text-body text-ink-muted">お名前だけでも登録できます。</p>
            </div>
          </div>

          {phase === 'error' && (
            <p
              role="alert"
              className="max-w-138 rounded-card border border-danger bg-danger-soft px-4 py-3 text-body text-danger"
            >
              登録できませんでした。入力はそのまま残っています。もう一度お試しください。
            </p>
          )}

          <div className="grid max-w-80 gap-1.5">
            <label htmlFor={`${fieldId}-phone`} className="text-grid font-semibold text-ink-muted">
              お電話番号
            </label>
            <input
              id={`${fieldId}-phone`}
              type="tel"
              inputMode="none"
              autoComplete="off"
              enterKeyHint="next"
              value={formatPhoneDigits(digits)}
              onChange={(event) => {
                // 物理キーボードがつないである端末のための道。無くても完結する。
                typePhone(event.target.value.replace(/\D/g, '').slice(0, MAX_DIGITS))
              }}
              className={`min-h-13 rounded-card border-2 border-pine bg-surface px-4 font-mono text-title font-semibold tracking-wider text-ink ${focusRing}`}
            />
          </div>

          {lookup.state === 'looking' && (
            <p role="status" className="text-body text-ink-muted">
              同じお電話番号のご登録をお調べしています…
            </p>
          )}

          {lookup.state === 'failed' && (
            <div className="max-w-138">
              <p
                role="alert"
                className="rounded-card border border-danger bg-danger-soft px-4 py-3 text-body text-danger"
              >
                同じお電話番号のご登録をお調べできませんでした。もう一度お試しいただくか、このまま登録できます。
              </p>
              <button
                type="button"
                onClick={() => void look(digits)}
                className={`${ACTION} mt-2.5`}
              >
                もう一度お調べする
              </button>
            </div>
          )}

          {lookup.state === 'done' && hits.length === 0 && (
            <p role="status" className="text-body text-ink-muted">
              同じお電話番号のご登録はありません。
            </p>
          )}

          {hits.length > 0 && (
            <div
              role="status"
              className="max-w-138 rounded-panel border border-danger bg-danger-soft px-5.5 py-5"
            >
              <b className="text-lead font-bold text-ink">同じお電話番号のお客様がいます</b>
              <p className="mt-1 text-grid text-ink-muted">
                同じ方でしたら、新しく登録せずにそのまま進めてください。
              </p>
              <ul className="m-0 mt-3.5 grid list-none gap-2.5">
                {shown.map((candidate) => (
                  <Hit
                    key={candidate.customer.id}
                    candidate={candidate}
                    onUse={
                      hits.length === 1
                        ? null
                        : () => {
                            setResolved('existing')
                            onUseExisting(candidate.customer)
                          }
                    }
                  />
                ))}
              </ul>
              {folded > 0 && (
                <p className="mt-2.5 text-grid text-ink-muted">{`ほか ${folded}件`}</p>
              )}
              <div className="mt-4 flex gap-2.5">
                {hits.length === 1 && shown[0] !== undefined && (
                  <button
                    type="button"
                    onClick={() => {
                      setResolved('existing')
                      onUseExisting((shown[0] as CustomerCandidate).customer)
                    }}
                    className={ACTION_PRIMARY}
                  >
                    このお客様として進む
                  </button>
                )}
                <button type="button" onClick={() => setResolved('new')} className={ACTION}>
                  別の方なので、新しく登録する
                </button>
              </div>
            </div>
          )}

          <div className="grid max-w-138 grid-cols-2 gap-5">
            <div className="grid gap-1.5">
              <label htmlFor={`${fieldId}-name`} className="text-grid font-semibold text-ink-muted">
                お名前
              </label>
              <input
                id={`${fieldId}-name`}
                type="text"
                autoComplete="off"
                enterKeyHint="next"
                placeholder="例：田中 花子"
                value={name}
                aria-invalid={missingName ? true : undefined}
                aria-describedby={missingName ? `${fieldId}-name-error` : undefined}
                onCompositionStart={() => {
                  composing.current = true
                  reading.current = ''
                }}
                onCompositionUpdate={onCompositionUpdate}
                onCompositionEnd={() => {
                  composing.current = false
                  fillKana()
                }}
                onChange={(event) => {
                  setName(event.target.value)
                  if (event.target.value.trim() !== '') setMissingName(false)
                }}
                onBlur={() => {
                  // iPadOS のかなキーボードは予測変換の直接確定で `compositionend` を
                  // 出さない経路があるので、欄を離れたときにもう一度拾う。
                  if (!composing.current) fillKana()
                }}
                className={`${FIELD} w-full`}
              />
              {missingName && (
                <p id={`${fieldId}-name-error`} role="alert" className="text-grid text-danger">
                  お名前が入っていません。
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${fieldId}-kana`} className="text-grid font-semibold text-ink-muted">
                ふりがな
              </label>
              <input
                id={`${fieldId}-kana`}
                type="text"
                autoComplete="off"
                enterKeyHint="next"
                placeholder="例：たなか はなこ"
                value={kana}
                onChange={(event) => {
                  kanaTouched.current = true
                  setAutoFilled(false)
                  setKana(event.target.value)
                }}
                className={`${FIELD} w-full`}
              />
              {autoFilled && <p className="text-grid text-ink-muted">自動で入れました</p>}
            </div>
          </div>

          <div className="mt-auto flex items-center gap-3.5">
            <button
              type="button"
              onClick={onSkip}
              className={`min-h-12 rounded-card border border-line-strong bg-surface px-3.5 text-body font-semibold text-ink ${focusRing}`}
            >
              あとで登録する（ウォークインのまま）
            </button>
            {/* 押せない間も **フォーカスは残す**（`disabled` にしない）。押せない理由は
                読み上げ名に畳んであるので、そこへ辿り着けないと理由ごと消える。
                同じ形を `CustomerMerge` と `booking/ConfirmStep` が採っている。 */}
            <button
              type="button"
              aria-disabled={blockedReason === null ? undefined : true}
              aria-label={
                blockedReason === null ? undefined : `登録してご予約に進む　${blockedReason}`
              }
              onClick={() => {
                if (blockedReason !== null) return
                register()
              }}
              className={
                blockedReason === null
                  ? `ml-auto min-h-14 rounded-card border border-pine bg-pine px-4 text-lead font-bold text-on-pine ${focusRingOnPine}`
                  : `ml-auto min-h-14 rounded-card border border-line bg-surface-2 px-4 text-lead font-bold text-ink-faint ${focusRing}`
              }
            >
              登録してご予約に進む
            </button>
          </div>
        </section>

        <aside
          aria-label="お電話番号を入れる"
          className="w-89 shrink-0 border-line border-l bg-surface px-5.5 py-8"
        >
          <h3 className="m-0 mb-5 text-body font-semibold text-ink">お電話番号を入れる</h3>
          <PhoneKeypad
            onDigit={(digit) => {
              if (digits.length >= MAX_DIGITS) return
              typePhone(`${digits}${digit}`)
            }}
            onDelete={() => typePhone(digits.slice(0, -1))}
          />
        </aside>
      </div>
    </div>
  )
}
