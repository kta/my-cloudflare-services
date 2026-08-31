import { useEffect, useId } from 'react'
import { cn } from './cn'
import { focusRing } from './components'

/*
 * 暗証番号のテンキー（承認済みモック LOGIN-STAFF-PIN / LOGIN-SHARED-PIN /
 * LOGIN-PIN-ERROR / EX-PERMISSION の右 420px）。
 *
 * 画面の計画（DESIGN_RULE パス 1）
 *   主役は 1 画面に 1 つ —— 「誰の番号か」だけ。テンキーは右に固定した道具で、主役を奪わない。
 *   状態は色だけで伝えない —— 押せない「確定」には必ず押せない理由の 1 行が付く。
 *   空いた場所を埋めるために要素を足さない —— 下段は全画面 `削除 / 0 / 確定` の 3 つだけ。
 *
 * 実測（assets/eyex.css の `.keypad` / `.key` / `.pins` / `.tries`）
 *   枠 3 列 × 96px・gap 12px（= 312px = w-78）／キー 96×72px（72pt。HIG の 44pt を超える）
 *   桁 44×56px・gap 12px・● 26px／目盛 30×10px・gap 8px
 *
 * 入力欄を `<input>` で置かない。ソフトキーボードを出さないための `inputMode="none"` は
 * 「値を持つ欄」を前提にした逃げ道で、平文の暗証番号を DOM に載せてしまう。
 * ここでは桁を `role="group"` の飾りに徹させ、物理キーボード（数字・Backspace・Enter）は
 * `Keypad` が window の `keydown` で自前に拾う。フォーカスは 72pt のキーそのものが持つ。
 */

const KEY_BASE =
  'grid h-18 w-24 place-items-center rounded-ctl border text-hero disabled:cursor-not-allowed'

export type KeypadProps = {
  /** いま入っている桁数ぶんの数字。**呼び出し側も画面には出さない。** */
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  /** 「確定」を押せるようになる最小の桁数。 */
  minLength?: number
  maxLength?: number
  /** 桁数とは別に「確定」を止める理由（30 秒お待ちいただく間など）。 */
  blockedReason?: string
  /** 押せるときにテンキーの下へ添える 1 行。 */
  readyHint?: string
}

export function Keypad({
  value,
  onChange,
  onSubmit,
  minLength = 4,
  maxLength = 6,
  blockedReason,
  readyHint = '「確定」で業務が始まります',
}: KeypadProps) {
  const hintId = useId()
  const short = minLength - value.length
  const canSubmit = short <= 0 && blockedReason === undefined
  const hint = blockedReason ?? (short > 0 ? `あと${short}桁で「確定」を押せます` : readyHint)

  function press(digit: string) {
    if (value.length < maxLength) onChange(value + digit)
  }

  function erase() {
    if (value.length > 0) onChange(value.slice(0, -1))
  }

  function submit() {
    if (canSubmit) onSubmit()
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key >= '0' && event.key <= '9' && event.key.length === 1) press(event.key)
      else if (event.key === 'Backspace') erase()
      else if (event.key === 'Enter') submit()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="grid justify-items-center gap-3">
      <div className="grid w-78 grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button
            key={digit}
            type="button"
            onClick={() => press(digit)}
            className={cn(KEY_BASE, 'border-line-strong bg-surface text-ink', focusRing)}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          onClick={erase}
          className={cn(
            KEY_BASE,
            'border-line-strong bg-surface text-body font-semibold text-ink',
            focusRing,
          )}
        >
          削除
        </button>
        <button
          type="button"
          onClick={() => press('0')}
          className={cn(KEY_BASE, 'border-line-strong bg-surface text-ink', focusRing)}
        >
          0
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          aria-describedby={hintId}
          className={cn(
            KEY_BASE,
            'border-pine bg-pine text-body font-bold text-on-pine disabled:opacity-60',
            focusRing,
          )}
        >
          確定
        </button>
      </div>
      {/* 押せない理由は必ずここに出る。理由の無い disabled を作らない（AC-TERM-19）。 */}
      <p id={hintId} className="text-grid text-ink-muted">
        {hint}
      </p>
    </div>
  )
}

export type PinFieldProps = {
  /** 「暗証番号」「店舗の暗証番号」。 */
  label: string
  /** 入った桁数。値そのものは受け取らない。 */
  filled: number
  length?: number
  /** 直前の確定が違っていたか。枠が赤くなるぶん、文言も差し替える。 */
  invalid?: boolean
}

export function PinField({ label, filled, length = 6, invalid = false }: PinFieldProps) {
  const note = invalid ? 'はじめから打ち直してください' : `${filled}桁まで入力しました`
  return (
    <div>
      <p className={cn('text-grid', invalid ? 'text-danger' : 'text-ink-muted')}>
        {`${label}　${note}`}
      </p>
      {/* `role="group"` ではなく `<fieldset>`。読み上げ名は `aria-label` が持つ。 */}
      <fieldset aria-label={`${label}　${note}`} className="mt-2 flex gap-3">
        {Array.from({ length }, (_, index) => (
          <span
            key={`${label}-${index}`}
            className={cn(
              'grid h-14 w-11 place-items-center rounded-ctl border',
              invalid
                ? 'border-danger bg-danger-soft'
                : index < filled
                  ? 'border-pine bg-surface'
                  : 'border-line-strong bg-surface',
            )}
          >
            {index < filled && !invalid && (
              <span aria-hidden="true" className="size-6.5 rounded-circle bg-ink" />
            )}
          </span>
        ))}
      </fieldset>
    </div>
  )
}

/** 残りの試行回数。3 本の目盛だけでは色に頼るので、`aria-label` に回数を書く。 */
export function TryMeter({ used, total = 3 }: { used: number; total?: number }) {
  const left = total - used
  return (
    <span role="img" aria-label={`残り${left}回お試しいただけます`} className="mt-3.5 flex gap-2">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={`try-${index}`}
          className={cn('h-2.5 w-7.5 rounded-full', index < used ? 'bg-danger' : 'bg-busy')}
        />
      ))}
    </span>
  )
}
