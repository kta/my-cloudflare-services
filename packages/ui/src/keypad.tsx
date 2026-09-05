import { type KeyboardEvent, useId } from 'react'
import { cn } from './cn'
import { focusRing, focusRingOnPine } from './components'

const MAX_PIN_LENGTH = 6
const MIN_PIN_LENGTH = 4

type PinAction = { kind: 'digit'; digit: string } | { kind: 'delete' } | { kind: 'confirm' }

type PinCallbacks = {
  value: string
  onChange: (value: string) => void
  onConfirm?: () => void
}

function actionForKey(key: string): PinAction | null {
  if (/^\d$/.test(key)) return { kind: 'digit', digit: key }
  if (key === 'Backspace') return { kind: 'delete' }
  if (key === 'Enter') return { kind: 'confirm' }
  return null
}

function applyAction({ value, onChange, onConfirm }: PinCallbacks, action: PinAction): void {
  if (action.kind === 'digit') {
    if (value.length < MAX_PIN_LENGTH) onChange(`${value}${action.digit}`)
    return
  }
  if (action.kind === 'delete') {
    if (value.length > 0) onChange(value.slice(0, -1))
    return
  }
  if (value.length >= MIN_PIN_LENGTH) onConfirm?.()
}

function countLabel(length: number): string {
  return `6桁のうち${length}桁を入力済み`
}

function confirmationReason(length: number): string {
  return `あと${MIN_PIN_LENGTH - length}桁で「確定」を押せます。`
}

export type KeypadProps = PinCallbacks & {
  /** テンキー全体の読み上げ名。 */
  label?: string
  /** 完了操作が別の意味を持つ面で差し替える。 */
  confirmLabel?: string
}

/** 4〜6桁の PIN 用テンキー。値は持たず、呼び出し元の state を更新する。 */
export function Keypad({
  value,
  onChange,
  onConfirm,
  label = '暗証番号のテンキー',
  confirmLabel = '確定',
}: KeypadProps) {
  const reasonId = useId()
  const canConfirm = value.length >= MIN_PIN_LENGTH
  const press = (action: PinAction) => applyAction({ value, onChange, onConfirm }, action)

  return (
    <fieldset className="grid grid-cols-3 gap-3">
      <legend className="sr-only">{label}</legend>
      {Array.from({ length: 9 }, (_, index) => String(index + 1)).map((digit) => (
        <Key key={digit} onClick={() => press({ kind: 'digit', digit })}>
          {digit}
        </Key>
      ))}
      <Key onClick={() => press({ kind: 'delete' })} wide>
        削除
      </Key>
      <Key onClick={() => press({ kind: 'digit', digit: '0' })}>0</Key>
      <Key
        onClick={() => press({ kind: 'confirm' })}
        disabled={!canConfirm}
        aria-describedby={canConfirm ? undefined : reasonId}
        confirm
        wide
      >
        {confirmLabel}
      </Key>
      {!canConfirm && (
        <p id={reasonId} className="col-span-3 text-grid text-ink-muted">
          {confirmationReason(value.length)}
        </p>
      )}
    </fieldset>
  )
}

function Key({
  children,
  wide = false,
  confirm = false,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { wide?: boolean; confirm?: boolean }) {
  return (
    <button
      type="button"
      /*
       * `cn()` は tailwind-merge を持たない単純な結合なので、**同じ種類のユーティリティを
       * 2 つ載せてはならない**。どちらが勝つかはクラス列の順ではなく Tailwind が CSS を
       * 書き出す順で決まる。以前は地の色に `bg-surface` と `bg-pine` の両方を載せており、
       * 確定キーが白地・白文字（`text-on-pine`）になってラベルが見えなくなっていた。
       * 地の色・縁の色・文字の色は、confirm の有無でどちらか一方だけを選ぶ。
       */
      className={cn(
        'h-18 w-24 rounded-ctl border text-hero font-normal',
        wide && 'text-body font-semibold',
        confirm
          ? cn('border-pine bg-pine text-on-pine font-bold', focusRingOnPine)
          : cn('border-line-strong bg-surface text-ink', focusRing),
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export type PinFieldProps = PinCallbacks & {
  /** 画面ごとの入力名。 */
  label?: string
  /** 間違った PIN を表示中か。 */
  invalid?: boolean
}

/** PIN の実値を DOM に載せず、固定6枠と入力済み数だけを見せる入力欄。 */
export function PinField({
  value,
  onChange,
  onConfirm,
  label = '暗証番号',
  invalid = false,
}: PinFieldProps) {
  const entered = Math.min(value.length, MAX_PIN_LENGTH)
  const descriptionId = useId()

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const action = actionForKey(event.key)
    if (action === null) return
    event.preventDefault()
    applyAction({ value, onChange, onConfirm }, action)
  }

  return (
    <div className="relative flex flex-col gap-2">
      <p id={descriptionId} className="text-grid text-ink-muted">
        {countLabel(entered)}
      </p>
      <div className="relative flex w-81 gap-3 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus">
        <div className="flex gap-3" aria-hidden="true">
          {Array.from({ length: MAX_PIN_LENGTH }, (_, index) => (
            <span
              key={index}
              data-testid="pin-slot"
              className={cn(
                'grid h-14 w-11 place-items-center rounded-ctl border bg-surface text-title text-ink',
                index < entered && !invalid && 'border-pine',
                invalid && 'border-danger bg-danger-soft',
                index >= entered && !invalid && 'border-line-strong',
              )}
            >
              {index < entered ? '●' : ''}
            </span>
          ))}
        </div>
        <input
          value={'●'.repeat(entered)}
          onChange={() => {}}
          onKeyDown={onKeyDown}
          inputMode="none"
          autoComplete="off"
          aria-label={`${label} ${countLabel(entered)}`}
          aria-describedby={descriptionId}
          className={cn('absolute inset-0 h-full w-full cursor-default opacity-0', focusRing)}
        />
      </div>
    </div>
  )
}

export function TryMeter({ remainingAttempts }: { remainingAttempts: number }) {
  const remaining = Math.max(0, Math.min(3, remainingAttempts))
  return (
    <span role="img" aria-label={`あと${remaining}回お試しいただけます`} className="flex gap-2">
      {Array.from({ length: 3 }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cn('h-2.5 w-7.5 rounded-full', index < remaining ? 'bg-busy' : 'bg-danger')}
        />
      ))}
    </span>
  )
}
