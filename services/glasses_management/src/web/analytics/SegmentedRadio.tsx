// biome-ignore-all lint/a11y/useSemanticElements: 札は「丸印・言葉」を並べた押せる面で、input 要素は子に持てない。
import { cn, focusRing } from '@app/ui'
import { useRef } from 'react'

/*
 * 切り口の札（P9 T-015。ANALYTICS-COUNT.png の丸印の帯）。
 *
 * **モックが紙の再現のために置いている偽の印をそのまま写さない。**
 * 見た目は同じでも、群に名前が読まれ、矢印キーで選べる本物の radio group にする
 * （WAI-ARIA の radio group の作法。移動と同時に選択が移る）。
 *
 * 触れる札は 44pt 以上（`min-h-11`）。選択は色だけでなく、丸の中の点と太字でも分かる。
 */

export type SegmentedRadioProps<T extends string> = {
  /** 群の名前。読み上げでこの名前が先に読まれる。 */
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}

export function SegmentedRadio<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedRadioProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null)

  function move(step: number) {
    const index = options.findIndex((option) => option.value === value)
    const next = options[(index + step + options.length) % options.length]
    if (!next) return
    onChange(next.value)
    // roving tabindex —— 選択が移った札へ焦点も移す。
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    buttons?.[(index + step + options.length) % options.length]?.focus()
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-grid text-ink-muted">{label}</span>
      <div ref={groupRef} role="radiogroup" aria-label={label} className="flex items-center gap-2">
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                  event.preventDefault()
                  move(1)
                }
                if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  move(-1)
                }
              }}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-full border px-4 text-body',
                selected
                  ? 'border-2 border-pine bg-pine-soft font-bold text-pine-deep'
                  : 'border-line-strong bg-surface text-ink',
                focusRing,
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-4.5 items-center justify-center rounded-circle border',
                  selected ? 'border-pine' : 'border-line-strong',
                )}
              >
                {selected ? <span className="block size-2.5 rounded-circle bg-pine" /> : null}
              </span>
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
