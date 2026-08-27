import { cn } from '@app/ui'
import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

/*
 * 入力の語彙。承認済みモックが持つ入力は `operations-approved.html#reauth` の
 * 個人PIN 欄ひとつだけで、実測は次のとおり。運用面の入力はすべてこれに倣う。
 *
 *   input{display:block;width:100%;min-height:52px;border:1px solid var(--l);
 *         border-radius:8px;padding:12px;font-size:20px}
 *
 * 20px はあの面が「1 つの欄だけを見せる」ためのもので、欄が並ぶ面では本文寸法で
 * 組む。罫・角丸・内側の余白はモックのまま。
 */
const CONTROL =
  'block min-h-13 w-full rounded-ctl border border-line bg-surface p-3 font-sans text-body text-ink'

/** 欄の名前とエラー。名前は必ず見える形で置く（プレースホルダで代替しない）。 */
export function Labeled({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string
  htmlFor: string
  error?: string | null
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="font-sans text-note">
        {label}
      </label>
      {children}
      {error !== undefined && error !== null && error !== '' && (
        // 入力自身が `aria-describedby` で指す先。読み上げでは入力へ戻った
        // ときにも理由が読まれる。
        <p id={`${htmlFor}-error`} role="alert" className="font-sans text-danger text-note">
          {error}
        </p>
      )}
    </div>
  )
}

type FieldExtras = {
  id: string
  label: string
  error?: string | null
  /**
   * 見出しが既に欄の名前を言っているとき（カードの `<b>` が「成立予約」と
   * 名乗っている等）は名前を重ねない。読み上げ用の名前は入力自身が持つ。
   */
  hideLabel?: boolean
}

function describedBy(id: string, error?: string | null): string | undefined {
  return error !== undefined && error !== null && error !== '' ? `${id}-error` : undefined
}

export function TextField({
  id,
  label,
  error,
  hideLabel = false,
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & FieldExtras & { ref?: Ref<HTMLInputElement> }) {
  const control = (
    <input
      ref={ref}
      id={id}
      aria-label={hideLabel ? label : undefined}
      aria-invalid={describedBy(id, error) ? true : undefined}
      aria-describedby={describedBy(id, error)}
      className={cn(CONTROL, className)}
      {...props}
    />
  )
  if (hideLabel) return control
  return (
    <Labeled label={label} htmlFor={id} error={error}>
      {control}
    </Labeled>
  )
}

export function TextAreaField({
  id,
  label,
  error,
  hideLabel = false,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldExtras) {
  const control = (
    <textarea
      id={id}
      aria-label={hideLabel ? label : undefined}
      aria-invalid={describedBy(id, error) ? true : undefined}
      aria-describedby={describedBy(id, error)}
      className={cn(CONTROL, 'min-h-20', className)}
      {...props}
    />
  )
  if (hideLabel) return control
  return (
    <Labeled label={label} htmlFor={id} error={error}>
      {control}
    </Labeled>
  )
}

export function SelectField({
  id,
  label,
  error,
  hideLabel = false,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & FieldExtras) {
  const control = (
    <select
      id={id}
      aria-label={hideLabel ? label : undefined}
      aria-invalid={describedBy(id, error) ? true : undefined}
      aria-describedby={describedBy(id, error)}
      className={cn(CONTROL, className)}
      {...props}
    >
      {children}
    </select>
  )
  if (hideLabel) return control
  return (
    <Labeled label={label} htmlFor={id} error={error}>
      {control}
    </Labeled>
  )
}

/** 押した状態を持つ絞り込み。`.filter` と同じ寸法で、選択中だけ緑の面になる。 */
export function ToggleFilter({
  children,
  on,
  onClick,
}: {
  children: ReactNode
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'min-h-11 rounded-ctl border px-3 font-sans text-body',
        on ? 'border-pine bg-pine text-on-pine' : 'border-line bg-surface text-ink',
      )}
    >
      {children}
    </button>
  )
}
