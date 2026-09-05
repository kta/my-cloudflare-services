import type { QuoteCheck } from '@app/contracts'
import type { ReactNode } from 'react'

/*
 * 典拠（Tenkyo）の部品。題材は「特許事務所の出願台帳と検印」。
 *
 * `@app/ui` の共有部品は EYE（眼鏡店）のトークンで塗られているのでここでは使わず、
 * `tk-` の名前空間のトークンだけを参照する素の Tailwind で組む（DESIGN_RULE ルール3）。
 *
 * この画面の主張は 1 つだけ:
 *   照合できなかった AI の主張は、削除されないが支持の根拠には決してならない。
 * 検印（済・未・却）がそれを一字で表す。**色だけに意味を持たせず、必ず字を添える。**
 */

// フォーカスの輪。押せるものすべてで同じ形にする（この 1 か所だけで決める）。
const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tk-verified'

/** 罫で囲まれた「欄」。カードではない（角丸はほぼゼロ、影を落とさない）。 */
export function Panel({
  title,
  aside,
  children,
  className = '',
}: {
  title?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-tk-doc border border-tk-line-strong bg-tk-sheet ${className}`}>
      {title !== undefined && (
        <header className="flex items-baseline justify-between gap-4 border-b border-tk-line-strong px-4 py-2">
          <h2 className="font-bold text-tk-heading text-tk-ink tracking-wide">{title}</h2>
          {aside}
        </header>
      )}
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

export type SealKind = 'verified' | 'pending' | 'rejected' | 'none'

/** 照合状態から検印の種類を決める。ここが製品の判断の一点である。 */
export function sealOf(quoteCheck: QuoteCheck): SealKind {
  if (quoteCheck === 'verified') return 'verified'
  if (quoteCheck === 'pending' || quoteCheck === 'not_in_corpus_tier2') return 'pending'
  return 'rejected'
}

const SEAL_LABEL: Record<SealKind, string> = {
  verified: '済',
  pending: '未',
  rejected: '却',
  none: '　',
}

const SEAL_TITLE: Record<SealKind, string> = {
  verified: '照合済み — 引用文が公報の当該段落に実在することを機械が確認した',
  pending: '未照合 — まだ確認できていない。支持の根拠にはならない',
  rejected: '棄却 — 原文と食い違った。支持の根拠にはならない',
  none: '典拠なし',
}

/** 検印。1 行 = 1 典拠の行頭に必ず押される。 */
export function Seal({ kind, size = 'md' }: { kind: SealKind; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-5 w-5 text-tk-fine' : 'h-6 w-6 text-tk-data'
  const tone =
    kind === 'verified'
      ? 'border-tk-verified text-tk-verified bg-tk-verified-soft'
      : kind === 'pending'
        ? 'border-tk-pending text-tk-pending bg-tk-pending-soft'
        : kind === 'rejected'
          ? 'border-tk-rejected text-tk-rejected bg-tk-rejected-soft'
          : 'border-dashed border-tk-line-strong text-tk-ink-muted bg-transparent'
  return (
    <span
      // 検印は一字（済・未・却）だが、読み上げには意味を渡したい。
      // role="img" にすると aria-label が字より優先して読まれる。
      role="img"
      title={SEAL_TITLE[kind]}
      aria-label={SEAL_TITLE[kind]}
      className={`inline-flex shrink-0 items-center justify-center rounded-tk-doc border font-bold leading-none ${box} ${tone}`}
    >
      {SEAL_LABEL[kind]}
    </span>
  )
}

/** 公報番号・段落番号・日付・件数・検索式。**和文には使わない。** */
export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-tk-mono text-tk-data ${className}`}>{children}</span>
}

/** 段落番号は隅付き括弧で見せる（公報の表記そのもの）。 */
export function ParaNo({ value }: { value: string }) {
  return <Mono className="text-tk-ink">【{value}】</Mono>
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'quiet',
  disabled = false,
}: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'primary' | 'quiet' | 'danger'
  disabled?: boolean
}) {
  const tone =
    variant === 'primary'
      ? 'bg-tk-verified text-tk-sheet border-tk-verified hover:bg-tk-ink'
      : variant === 'danger'
        ? 'bg-tk-sheet text-tk-rejected border-tk-rejected hover:bg-tk-rejected-soft'
        : 'bg-tk-sheet text-tk-ink border-tk-line-strong hover:bg-tk-board'
  return (
    <button
      type={type === 'submit' ? 'submit' : 'button'}
      onClick={onClick}
      disabled={disabled}
      // 動きを減らす設定を尊重する（DESIGN_RULE §3）。この画面の唯一の動きが
      // ボタンの色の移りなので、そこだけを止める。
      className={`rounded-tk-doc border px-3 py-1.5 font-bold text-tk-body transition-colors motion-reduce:transition-none ${tone} ${focusRing} disabled:cursor-not-allowed disabled:opacity-45`}
    >
      {children}
    </button>
  )
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  error?: string | null
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="font-bold text-tk-data text-tk-ink">
        {label}
      </label>
      {hint && <p className="text-tk-note text-tk-ink-muted leading-relaxed">{hint}</p>}
      {children}
      {error && <p className="text-tk-note text-tk-rejected">{error}</p>}
    </div>
  )
}

const inputBase =
  'w-full rounded-tk-doc border border-tk-line-strong bg-tk-sheet px-2.5 py-1.5 text-tk-heading text-tk-ink placeholder:text-tk-ink-muted'

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputBase} ${focusRing}`} />
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputBase} ${focusRing} leading-relaxed`} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputBase} ${focusRing}`} />
}

/** 何かがまだ無いときの一言。空を空のままにしない。 */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="border border-tk-line border-dashed px-4 py-6 text-center text-tk-body text-tk-ink-muted leading-relaxed">
      {children}
    </p>
  )
}

/** 起きたことと、どう直すかを書く。謝るだけの文言にしない。 */
export function Notice({
  tone = 'pending',
  children,
}: {
  tone?: 'pending' | 'rejected' | 'verified'
  children: ReactNode
}) {
  const style =
    tone === 'rejected'
      ? 'border-tk-rejected bg-tk-rejected-soft text-tk-rejected'
      : tone === 'verified'
        ? 'border-tk-verified bg-tk-verified-soft text-tk-verified'
        : 'border-tk-pending bg-tk-pending-soft text-tk-pending'
  return (
    <p className={`rounded-tk-doc border px-3 py-2 text-tk-body leading-relaxed ${style}`}>
      {children}
    </p>
  )
}
