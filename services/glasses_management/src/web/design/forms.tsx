import { cn } from '@app/ui'
import type { InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from 'react'
import { useEffect, useRef, useState } from 'react'

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
function Labeled({
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

export type PickerOption = { value: string; label: string }

/*
 * 選択の欄（`<select>` の置き換え）。
 *
 * ブラウザ既定の `<select>` は、地域設定の書体・既定の三角・既定の選択色を
 * 面へ持ち込む。承認済みモックにその姿は 1 つも無く、同じ役割はすべて押し
 * ボタンで描かれている。だからここも「今の値を名乗る押しボタン」と、押すと
 * 開く候補の板だけで組む。地色・罫・角丸はモックの入力と候補行に揃える。
 *
 * 値は選択肢の `value` のまま返す。送信・検証の経路は 1 つも変わらない。
 * 読み上げは combobox + listbox の対応で、焦点は引き金に置いたまま
 * `aria-activedescendant` で今どこを見ているかを伝える（焦点が候補へ飛ぶと、
 * 閉じたときに戻す先を毎回作ることになり、取りこぼしが出る）。
 */
export function PickerField({
  id,
  label,
  error,
  hideLabel = false,
  options,
  value,
  onChange,
  disabled = false,
  className,
}: FieldExtras & {
  options: PickerOption[]
  value: string
  onChange?: (next: string) => void
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  /** 板を引き金の上へ返すか。下端の欄で開くと viewport から出てしまうため。 */
  const [flip, setFlip] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex < 0 ? undefined : options[selectedIndex]
  const listId = `${id}-listbox`

  // 面の外を押したら閉じる。開いたままだと、下の面の操作が板に隠れる。
  useEffect(() => {
    if (!open) return undefined
    const onDocument = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocument)
    return () => document.removeEventListener('mousedown', onDocument)
  }, [open])

  const openAt = (index: number) => {
    setActive(index < 0 ? 0 : index)
    /*
     * 開く直前に、引き金の下に板が入るかを測る。入らないときだけ上へ返す。
     * 常に下へ出すと、面の下端にある欄では候補が viewport の外に落ちて、
     * 触れる候補が 1 つも無い板が開く。
     */
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect === undefined) setFlip(false)
    else {
      // 候補 1 行は `min-h-11`（44px）。板の余白 8px を足して要る高さを見積もる。
      const needed = options.length * 44 + 8
      const below = window.innerHeight - rect.bottom
      setFlip(below < needed && rect.top > below)
    }
    setOpen(true)
  }

  const choose = (index: number) => {
    const option = options[index]
    setOpen(false)
    if (option !== undefined && option.value !== value) onChange?.(option.value)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
        event.preventDefault()
        openAt(selectedIndex)
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(active)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => Math.min(current + 1, options.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      setActive(options.length - 1)
    }
  }

  const control = (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        aria-label={hideLabel ? label : undefined}
        aria-invalid={describedBy(id, error) ? true : undefined}
        aria-describedby={describedBy(id, error)}
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          if (open) setOpen(false)
          else openAt(selectedIndex)
        }}
        onKeyDown={onKeyDown}
        /*
         * 焦点が引き金を離れたら閉じる。mousedown だけを見ていると、Tab で
         * 抜けたときに板が開いたまま残り、Escape の受け手（引き金）も居なく
         * なって、閉じる手がマウスしか無くなる。焦点はこの引き金にしか
         * 載らない（候補は `tabIndex={-1}` で、押し下げも打ち消している）。
         */
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false)
        }}
        className={cn(CONTROL, 'text-left', className)}
      >
        {selected?.label ?? ''}
      </button>
      {open && (
        <div
          id={listId}
          // 引き金が名前を持つので、板は同じ名前を指し直すだけにする。
          aria-label={label}
          role="listbox"
          className={cn(
            'absolute left-0 z-10 w-full overflow-hidden rounded-ctl border border-line bg-surface',
            flip ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {options.map((option, index) => {
            const on = option.value === value
            return (
              <button
                key={option.value}
                id={`${id}-option-${index}`}
                /* button にするのは、候補そのものが押せる要素だと要素の意味でも
                   分かるようにするため（role は listbox の子として上書きする）。 */
                type="button"
                tabIndex={-1}
                role="option"
                aria-selected={on}
                /* 押し下げで焦点が引き金から外れると、離す前に板が閉じる。
                   選ぶのは click、焦点は動かさない。 */
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={cn(
                  'flex min-h-11 w-full cursor-pointer items-center px-3 py-2 text-left font-sans text-body',
                  on ? 'bg-pine text-on-pine' : 'text-ink',
                  !on && index === active && 'bg-side',
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
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

/* ------------------------------------------------------------------
 * 日付・日時の欄
 *
 * ネイティブの `type="date"` / `type="datetime-local"` は使わない。値こそ ISO
 * だが、**描かれる字はブラウザの地域設定で決まる**（`08/27/2026` / `mm/dd/yyyy`
 * / `--:-- --`）。承認済みモックは全画面が日本語の日付と 24 時間表記なので、
 * 欄だけが米国式の 12 時間表記になり、同じ値が 1 つの画面に 2 通りの姿で並ぶ。
 * 選択中の青い地色とピッカーの装飾も、モックのどの面にも無い色を持ち込む。
 *
 * `SettingsScreen` の先例（素の text + `inputMode="numeric"` + プレースホルダ）
 * を土台にしつつ、**打ち込んだ ISO を日本語で読み返す行を添える**。ISO だけだと
 * 「2026-08-26 が何曜日か」が読めず、電話を受けながら日付を復唱できない。
 * 値の形は ISO のままなので、送信・検証の経路は 1 つも変わらない。
 * ------------------------------------------------------------------ */

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土']

/** `YYYY-MM-DD` を `8月26日（水）` に読み下す。読めない字は読み下さない。 */
export function formatIsoDateJa(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const [, year = '', month = '', day = ''] = match
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  // `Date.UTC` で組み立てるのは、端末のタイムゾーンで日が前後しないため。
  const at = new Date(Date.UTC(y, m - 1, d))
  // 2 月 30 日のような実在しない日は繰り上がるので、組み立て直して確かめる。
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d)
    return undefined
  return `${m}月${d}日（${WEEKDAY_JA[at.getUTCDay()]}）`
}

/** `YYYY-MM-DDTHH:mm[:ss]` を `8月26日（水） 09:05` に読み下す。 */
export function formatIsoDateTimeJa(value: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(value)
  if (!match) return undefined
  const [, date = '', hour = '', minute = ''] = match
  if (Number(hour) > 23 || Number(minute) > 59) return undefined
  const day = formatIsoDateJa(date)
  return day === undefined ? undefined : `${day} ${hour}:${minute}`
}

type IsoFieldProps = {
  id: string
  label: string
  value: string
  error?: string | null
  hideLabel?: boolean
  className?: string
  onChange?: (next: string) => void
}

/**
 * ISO を打ち、日本語で読み返す欄の共通部分。読み下しは入力の外に置く
 * （`aria-label` にも `<label>` にも混ぜない）。混ぜると読み上げの欄名が
 * 「対象日 8月26日（水）」になり、何を打つ欄なのかが読めなくなる。
 */
function IsoField({
  id,
  label,
  value,
  error,
  hideLabel = false,
  className,
  placeholder,
  readback,
  onChange,
}: IsoFieldProps & { placeholder: string; readback: string | undefined }) {
  const control = (
    <input
      type="text"
      id={id}
      aria-label={hideLabel ? label : undefined}
      aria-invalid={describedBy(id, error) ? true : undefined}
      aria-describedby={describedBy(id, error)}
      // 端末にテンキーを出す。日付は数字と区切りだけで打ち切れる。
      inputMode="numeric"
      autoComplete="off"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      className={cn(CONTROL, className)}
    />
  )
  // 読み下しはモックの `<small>` と同じ一段小さい寸法で、欄のすぐ下に置く。
  const echo = readback === undefined ? null : <small className="font-sans">{readback}</small>
  if (hideLabel)
    return (
      <span className="inline-flex flex-col gap-1">
        {control}
        {echo}
      </span>
    )
  return (
    <Labeled label={label} htmlFor={id} error={error}>
      {control}
      {echo}
    </Labeled>
  )
}

/** 日付の欄。値は `YYYY-MM-DD` のまま。 */
export function DateField(props: IsoFieldProps) {
  return <IsoField {...props} placeholder="2026-09-23" readback={formatIsoDateJa(props.value)} />
}

/** 日時の欄。値は `YYYY-MM-DDTHH:mm` のまま。 */
export function DateTimeField(props: IsoFieldProps) {
  return (
    <IsoField
      {...props}
      placeholder="2026-09-15T10:00"
      readback={formatIsoDateTimeJa(props.value)}
    />
  )
}

/**
 * 入り切りの印。
 *
 * ネイティブの `<input type="checkbox">` はブラウザ既定の青（macOS で `#0075ff`
 * 前後）で塗られ、モックのどの面にも無い色が画面に出る。役割は checkbox のまま
 * 残し（読み上げも、`aria-checked` を見る自動操作も変わらない）、塗りだけを
 * トークンへ移す。押せない状態でも `Action` と同じ理由でタブ順からは外さない。
 */
export function CheckToggle({
  label,
  checked,
  disabled = false,
  labelledBy,
  onChange,
}: {
  /** 読み上げ用の名前。可視の文言を別に置く面では `labelledBy` を使う。 */
  label?: string
  checked: boolean
  disabled?: boolean
  /** 可視の文言がこの印の名前になっている面で、その要素の id。 */
  labelledBy?: string
  onChange?: (next: boolean) => void
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: ネイティブの `<input type="checkbox">` はブラウザ既定の青で塗られ、モックのどの面にも無い色が出る。役割だけを checkbox として残し、塗りをトークンへ移す。
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={labelledBy === undefined ? label : undefined}
      aria-labelledby={labelledBy}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : () => onChange?.(!checked)}
      /*
       * iPad は指で触る端末なので、当たり判定は 44px を割らない。字面は
       * モックのままの 24px にしたいので、外側に 10px の透明な余白を足し、
       * 同じ幅の負のマージンで囲みへ食い込ませる（囲みが占める大きさは 24px
       * のまま変わらない）。
       */
      className="-m-2.5 flex size-11 shrink-0 items-center justify-center p-2.5"
    >
      <span
        className={cn(
          'flex size-6 items-center justify-center rounded-ctl border font-sans text-note',
          checked ? 'border-pine bg-pine text-on-pine' : 'border-line bg-surface text-ink',
        )}
      >
        {/* 入っていることは印の形でも示す（色だけに頼らない）。 */}
        {checked ? '✓' : ''}
      </span>
    </button>
  )
}
