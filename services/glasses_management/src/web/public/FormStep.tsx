import { focusRing, focusRingOnPine } from '@app/ui'
import {
  type CompositionEvent as ReactCompositionEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

/*
 * 工程 4 お客様の情報（承認済みモック docs/frontend/mockups/eyex/images/WEB-04-FORM.png）。
 *
 * この面の仕事は「4 欄だけを伺い、ふりがなは打たせずに埋める」こと。
 *
 * 実測値（screens/WEB-04-FORM.html と assets/eyex.css）:
 *   `.phone` は 390×844（実装は 390×800）。本文の余白 32px 28px 120px。
 *   問いかけは見出し 20px・補足 13px `--color-ink-muted`、左の吹き出し 18×15px（上 6px・間 10px）。
 *   欄の並びは間 20px・上に 28px。見出し 13px `--color-ink-muted`、
 *   入力は最小高 52px・16px・角 12px・縁 1px `--color-line-strong`。
 *   下の固定は左右 28px・下 32px、主操作は全幅・最小高 56px・18px。
 *
 * お客様の面なので、業務の言葉（技能・リソース・テナント・店内引き継ぎ）を 1 語も出さない。
 */

/** 伺う 4 欄。ふりがなは自動で埋めるが、お客様が自分で直せる。 */
export type PublicContact = {
  name: string
  kana: string
  phone: string
  email: string
}

const EMPTY: PublicContact = { name: '', kana: '', phone: '', email: '' }

const FIELD = `min-h-13 w-full rounded-card border border-line-strong bg-surface px-3.5 text-body text-ink placeholder:text-ink-faint focus:border-pine ${focusRing}`

/** ひらがな・長音・空白だけでできているか（変換前の読みかどうかの目印）。 */
function isReading(text: string): boolean {
  return text !== '' && /^[ぁ-ゖー　 ]+$/.test(text)
}

/** 全角の数字も受けて、数字だけの並びにする。 */
function phoneDigits(text: string): string {
  return text
    .replace(/[０-９]/g, (wide) => String.fromCharCode(wide.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9]/g, '')
}

/**
 * お電話番号として通るか。契約の `PhoneInput` は 10〜20 文字しか見ないので、
 * 「080-2345-678」（9 桁）がそのまま送れてしまう。数字に落として `PhoneNormalized`
 * と同じ形（先頭 0 の 10 桁か 11 桁）で見る。
 */
function phoneLooksValid(text: string): boolean {
  return /^0\d{9,10}$/.test(phoneDigits(text))
}

/** メールアドレスとして通るか。契約の `z.email()` へ渡す前の、お客様に見せる目安。 */
function emailLooksValid(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())
}

/** 進めない理由。空なら進める。「〜すると進めます」「〜をお確かめください」の型で書く。 */
function blockedReason(value: PublicContact): string {
  const filled = [value.name, value.kana, value.phone, value.email].every(
    (text) => text.trim() !== '',
  )
  if (!filled) return '4つの欄が埋まると進めます'
  if (!phoneLooksValid(value.phone)) return 'お電話番号は10桁か11桁でご入力ください'
  if (!emailLooksValid(value.email)) return 'メールアドレスの形をお確かめください'
  return ''
}

/**
 * ソフトキーボードのぶんだけ下の固定を持ち上げる高さ。
 * `visualViewport` を持たない環境（jsdom・古い端末）は 0 に落として素の余白で出す。
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const read = () => {
      setInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop))
    }
    read()
    viewport.addEventListener('resize', read)
    viewport.addEventListener('scroll', read)
    return () => {
      viewport.removeEventListener('resize', read)
      viewport.removeEventListener('scroll', read)
    }
  }, [])
  return inset
}

type FormStepPhase = 'loading' | 'ready' | 'error'

export type FormStepProps = {
  /** 工程 5 から「変更」で戻ってきたときの下書き。伺った内容は消さない。 */
  initialValue?: PublicContact
  onProceed: (contact: PublicContact) => void
  phase?: FormStepPhase
  isOffline?: boolean
  onRetry?: () => void
}

export function FormStep({
  initialValue = EMPTY,
  onProceed,
  phase = 'ready',
  isOffline = false,
  onRetry,
}: FormStepProps) {
  const fieldId = useId()
  const [value, setValue] = useState<PublicContact>(initialValue)
  const [autoFilled, setAutoFilled] = useState(false)
  const inset = useKeyboardInset()

  // 変換前に打たれた読み。`compositionend` の `data` は変換後の漢字なので読みにならない。
  const reading = useRef('')
  // 人が一度でも直したふりがなは、そのあと自動で上書きしない。
  const kanaTouched = useRef(false)

  function edit(patch: Partial<PublicContact>) {
    setValue((current) => ({ ...current, ...patch }))
  }

  /**
   * 変換が確定した（または欄を離れた）ときに 1 度だけ埋める。
   * 変換の途中（`compositionstart` 〜 `compositionend`）はここを呼ばないので、
   * 「やまぐ」のような打ちかけの文字は入らない（`07-nfr.md` §2.9）。
   */
  function fillKana() {
    if (kanaTouched.current || reading.current === '' || value.kana !== '') return
    setValue((current) => ({ ...current, kana: reading.current }))
    setAutoFilled(true)
  }

  function onCompositionUpdate(event: ReactCompositionEvent<HTMLInputElement>) {
    if (isReading(event.data)) reading.current = event.data
  }

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

  const reason = blockedReason(value)
  const ready = reason === ''

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
              お客様のことを教えてください
            </h2>
            <p className="mt-1.5 text-grid text-ink-muted">
              ご予約のご連絡だけに使わせていただきます。
            </p>
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
        {phase === 'error' && (
          <p
            role="alert"
            className="mt-5 rounded-card border border-danger bg-danger-soft px-4 py-3 text-grid text-danger"
          >
            うまく処理できませんでした。入力はそのまま残っています。もう一度お試しください。
          </p>
        )}

        <div className="mt-7 grid gap-5">
          <div className="grid gap-1.5">
            <label htmlFor={`${fieldId}-name`} className="text-grid text-ink-muted">
              お名前
            </label>
            <input
              id={`${fieldId}-name`}
              type="text"
              autoComplete="name"
              enterKeyHint="next"
              placeholder="例：山口 真央"
              value={value.name}
              onCompositionStart={() => {
                reading.current = ''
              }}
              onCompositionUpdate={onCompositionUpdate}
              onCompositionEnd={() => fillKana()}
              onChange={(event) => edit({ name: event.target.value })}
              // iOS のかなキーボードは予測変換の直接確定で `compositionend` を出さない
              // 経路があるので、欄を離れたときにもう一度だけ拾う。
              onBlur={() => fillKana()}
              className={FIELD}
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={`${fieldId}-kana`} className="text-grid text-ink-muted">
              ふりがな
            </label>
            {/*
              端末が覚えているのは氏名・電話・メールだけで、読みを覚える枠は無い。
              `autocomplete="off"` を置くと iOS が氏名の候補を出してしまうので属性を置かない。
            */}
            <input
              id={`${fieldId}-kana`}
              type="text"
              enterKeyHint="next"
              placeholder="例：やまぐち まお"
              value={value.kana}
              onChange={(event) => {
                kanaTouched.current = true
                setAutoFilled(false)
                edit({ kana: event.target.value })
              }}
              className={FIELD}
            />
            {autoFilled && <p className="text-grid text-ink-muted">自動で入れました</p>}
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={`${fieldId}-phone`} className="text-grid text-ink-muted">
              お電話番号
            </label>
            <input
              id={`${fieldId}-phone`}
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              enterKeyHint="next"
              placeholder="例：080-2345-6789"
              value={value.phone}
              onChange={(event) => edit({ phone: event.target.value })}
              className={FIELD}
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={`${fieldId}-email`} className="text-grid text-ink-muted">
              メールアドレス
            </label>
            <input
              id={`${fieldId}-email`}
              type="email"
              inputMode="email"
              autoComplete="email"
              enterKeyHint="done"
              placeholder="例：m.yamaguchi@example.jp"
              value={value.email}
              onChange={(event) => edit({ email: event.target.value })}
              className={FIELD}
            />
          </div>
        </div>

        {/* 進めない理由は欄の下ではなく主操作の手前に置き、押す前に読めるようにする。 */}
        {!ready && (
          <p id={`${fieldId}-reason`} className="mt-5 text-grid text-ink-muted">
            {reason}
          </p>
        )}
      </div>

      <div
        className="absolute right-7 left-7"
        style={{
          bottom: `calc(var(--spacing) * 8 + env(safe-area-inset-bottom) + ${inset}px)`,
        }}
      >
        <button
          type="button"
          aria-disabled={ready ? undefined : true}
          aria-describedby={ready ? undefined : `${fieldId}-reason`}
          onClick={() => {
            if (!ready) return
            onProceed({
              name: value.name.trim(),
              kana: value.kana.trim(),
              phone: value.phone.trim(),
              email: value.email.trim(),
            })
          }}
          className={`min-h-14 w-full rounded-card border border-pine bg-pine font-semibold text-on-pine ${focusRingOnPine}`}
          style={{ fontSize: 'calc(var(--spacing) * 4.5)' }}
        >
          入力内容を確認する
        </button>
      </div>
    </div>
  )
}
