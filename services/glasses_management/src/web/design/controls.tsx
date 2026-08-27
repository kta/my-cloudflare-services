import { cn } from '@app/ui'
import type { ReactNode } from 'react'
import { formatIsoDateJa } from './forms'

/*
 * 操作の語彙。モックの実測は次のとおりで、面によって高さが 2 段ある。
 *
 *   運用・設定 `.button`{min-height:44px;border:1px solid var(--l);
 *                        border-radius:8px;background:#fff;padding:0 16px}
 *   例外       `button` {min-height:48px;min-width:44px;…}
 *   `.primary`{background:var(--g);color:#fff;border-color:var(--g)}
 *   `.danger` {color:var(--warn);border-color:var(--warn)}
 *
 * 危険な操作は既定の見た目にしない。破棄・失効は必ず `danger` を使う。
 */

export type ActionVariant = 'default' | 'primary' | 'danger'

const VARIANT: Record<ActionVariant, string> = {
  // 文字色を書かないのは、モックの `.button` が地の色だけを持ち、色は面から
  // 継いでいるため（琥珀の面に置かれた「詳細」は #4b3713 で描かれる）。
  default: 'border-line bg-surface',
  // 面の中の `.primary` はどのモックでも `background:var(--g);color:#fff;
  // border-color:var(--g)` だけで、太字にはしない（太字なのはバーの中の
  // 白いピルで、あれは BarButton が持つ）。
  primary: 'border-pine bg-pine text-on-pine',
  danger: 'border-danger bg-surface text-danger',
}

/*
 * 焦点の輪は `app.css` の `:focus-visible` が全要素に一括で敷いている
 * （モックの `outline:3px solid var(--focus)`）。部品ごとには足さない。
 */

export function Action({
  children,
  variant = 'default',
  size = 'compact',
  inset = 'wide',
  type = 'button',
  disabled = false,
  describedBy,
  className,
  onClick,
}: {
  children: ReactNode
  variant?: ActionVariant
  /** `compact` は業務面の 44px、`roomy` は全画面状態の 48px。 */
  size?: 'compact' | 'roomy'
  /**
   * 左右の内側。モックで 2 段に割れている実測値で、どちらかが正しいのでは
   * なく面ごとに違う。設定 6 工程は `padding:0 16px`、業務・運用
   * （`staff-approved.html` / `operations-approved.html`）は `padding:0 14px`。
   * 既定を動かすと既存の面のボタン幅が丸ごと 4px 変わるので、選ばせる。
   */
  inset?: 'wide' | 'tight'
  /**
   * 押せない状態。ネイティブの `disabled` は使わない。タブ順から外れるため、
   * キーボードの利用者はボタンの存在にも、押せない理由の説明にも辿り着けなく
   * なる。`aria-disabled` で「在るが押せない」として残し、押下はここで弾く。
   */
  disabled?: boolean
  /** 押せない理由など、この操作を説明している要素の id。 */
  describedBy?: string
  /**
   * ログイン等、form の submit で確定させたい面がある（Enter で送信できないと
   * キーボードだけの利用者が確定に辿り着けない）。既定は button のままなので、
   * 突き合わせ台の画素は動かない。
   */
  type?: 'button' | 'submit'
  className?: string
  onClick?: () => void
}) {
  return (
    <button
      // 押せない状態では submit も起こさない（`disabled` の意味を型で守る）。
      type={disabled ? 'button' : type}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      onClick={disabled ? undefined : onClick}
      className={cn(
        'min-w-11 rounded-ctl border font-sans text-body',
        inset === 'wide' ? 'px-4' : 'px-3.5',
        size === 'roomy' ? 'min-h-12' : 'min-h-11',
        VARIANT[variant],
        /*
         * 押せないことは淡さで示さない。モック（設定 6 工程の「公開する」）は
         * 無効な操作も通常と同じ濃さで描き、押せない理由は隣の警告面が文章で
         * 伝えている。淡くすると理由の無い「読みにくいだけの操作」になる。
         */
        className,
      )}
    >
      {children}
    </button>
  )
}

/** 操作の並び（`.actions{display:flex;justify-content:flex-end;gap:…}`）。 */
export function Actions({
  children,
  gap = 3,
  mt = 5,
}: {
  children: ReactNode
  gap?: 2.5 | 3
  /** 設定 6 工程だけ `.actions{margin-top:16px}`。例外・予約面は 20px / 24px。 */
  mt?: 4 | 5
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap justify-end',
        mt === 4 ? 'mt-4' : 'mt-5',
        gap === 3 ? 'gap-3' : 'gap-2.5',
      )}
    >
      {children}
    </div>
  )
}

/**
 * 一覧の絞り込みボタン（`.filter{min-height:44px;border:1px solid var(--l);
 * background:#fff;border-radius:8px;padding:0 12px}`）。
 */
export function FilterButton({
  children,
  variant = 'default',
  type = 'button',
  disabled = false,
  onClick,
}: {
  children: ReactNode
  variant?: ActionVariant
  /**
   * 絞り込みは form の submit で確定させたい面がある（Enter で検索できないと
   * 電話を受けながらの入力が止まる）。既定は button のままなので、突き合わせ台
   * の画素は動かない。
   */
  type?: 'button' | 'submit'
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type={type}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={cn('min-h-11 rounded-ctl border px-3 font-sans text-body', VARIANT[variant])}
    >
      {children}
    </button>
  )
}

/**
 * 押している間だけ効く絞り込み（`.filter` と同じ寸法・同じ罫）。
 *
 * ネイティブの `<select>` を置くとブラウザ既定の見た目が絞り込みの列に混ざり、
 * 選ばれている値も畳まれて見えなくなる。承認済みモックの絞り込みは「今の条件を
 * 名乗るピル」なので、値ではなく条件そのものを 1 つずつ押せる形で持つ。
 * 押されていることは地色だけでなく `aria-pressed` でも出す。
 */
export function FilterToggle({
  children,
  pressed,
  onToggle,
}: {
  children: ReactNode
  pressed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        'min-h-11 rounded-ctl border px-3 font-sans text-body',
        // 押されていない既定はモックの白いピルそのもの。押すと面の primary。
        pressed ? VARIANT.primary : VARIANT.default,
      )}
    >
      {children}
    </button>
  )
}

/** 絞り込みの並び（`.filterline{display:flex;gap:8px;margin:10px 0}`）。 */
export function FilterLine({ children }: { children: ReactNode }) {
  return <div className="my-2.5 flex flex-wrap gap-2">{children}</div>
}

/**
 * 検索欄。モックはどの面でも緑の 2px 罫で、他の入力より一段強い。
 *   一覧    `.search{min-height:48px;border:2px solid var(--g);…;padding:12px}`
 *   予約入力 `.search{min-height:56px;border-radius:9px;padding:15px;font-size:20px}`
 */
export function SearchField({
  value,
  placeholder,
  label,
  id,
  size = 'compact',
  inputMode,
  onChange,
}: {
  value: string
  placeholder?: string
  label: string
  id?: string
  size?: 'compact' | 'roomy'
  /** 電話番号だけを打ち込む欄では、端末にテンキーを出させる。 */
  inputMode?: 'tel'
  onChange?: (next: string) => void
}) {
  return (
    <input
      /*
       * `type="search"` にすると Safari が独自の取消印を描き、モックの板と
       * 幅が変わる。素の text にして、役割は aria-label と placeholder が言う。
       */
      type="text"
      id={id}
      aria-label={label}
      autoComplete="off"
      inputMode={inputMode}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange?.(event.target.value)}
      className={cn(
        /*
         * 何を打つ欄なのかは、モックでは薄い字ではなく本文と同じ濃さで書いて
         * ある（`.search` は板に本文色の文字を置いている）。薄くすると読める
         * かどうかが地色との差に依るようになるので、濃さは落とさない。
         */
        'w-full border-2 border-pine bg-surface font-sans text-ink placeholder:text-ink',
        size === 'roomy'
          ? 'min-h-14 rounded-card p-3.75 text-search'
          : 'min-h-12 rounded-ctl p-3 text-body',
      )}
    />
  )
}

/*
 * 絞り込みの入力。モックの `.filter` は押しボタンだけだが、実アプリでは同じ
 * 高さ・同じ罫の中に選択と日付が並ぶ。見た目は `FilterButton` と同じ 1 段に
 * 揃え、種類だけを変える（絞り込みの列に 2 種類の背丈を作らない）。
 */
const FILTER_FIELD =
  'min-h-11 rounded-ctl border border-line bg-surface px-3 font-sans text-body text-ink'

/**
 * 絞り込みの選択（押した時点で効くもの）。
 *
 * ネイティブの `<select>` は既定の三角・既定の選択色・地域設定の書体を
 * 絞り込みの列へ持ち込む。モックの `.filter` は押しボタンの並びなので、
 * 候補が少なく押した時点で効く絞り込みは、値を畳まずピルとして開いたまま
 * 並べる。返す値は今までと同じ選択肢の文字列で、取得の経路は変わらない。
 */
export function FilterGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange?: (next: string) => void
}) {
  return (
    // 「1 つを選ぶ」関係を要素の意味で持たせる。既定の枠と余白は面に無いので落とす。
    <fieldset aria-label={label} className="m-0 flex flex-wrap gap-2 border-0 p-0">
      {options.map((option) => (
        <FilterToggle
          key={option.value}
          pressed={option.value === value}
          onToggle={() => onChange?.(option.value)}
        >
          {option.label}
        </FilterToggle>
      ))}
    </fieldset>
  )
}

/**
 * 絞り込みの日付。`type="date"` を使わないのは `design/forms` と同じ理由で、
 * ブラウザ既定の書式（`mm/dd/yy`）と選択色が絞り込みの列に持ち込まれるため。
 * 値は `YYYY-MM-DD` のままで、打った日は隣で日本語に読み返す。
 */
export function FilterDate({
  label,
  id,
  value,
  className,
  onChange,
}: {
  label: string
  id?: string
  value: string
  className?: string
  onChange?: (next: string) => void
}) {
  const readback = formatIsoDateJa(value)
  return (
    <span className="flex items-center gap-2">
      <input
        id={id}
        type="text"
        aria-label={label}
        inputMode="numeric"
        autoComplete="off"
        placeholder="2026-09-23"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        className={cn(FILTER_FIELD, className)}
      />
      {readback !== undefined && <small className="font-sans">{readback}</small>}
    </span>
  )
}

/**
 * 検索欄に入った値を、そのまま読み返すための表示（モックの `.search` は
 * 電話番号の面では入力ではなく確定した値の面として置かれている）。
 *
 *   .search{min-height:56px;border:2px solid var(--g);border-radius:9px;
 *           background:#fff;padding:15px;font-size:20px}
 *
 * 入力そのものではないので、キャレットもプレースホルダも持たない。読み上げの
 * ために名前だけを付ける。
 */
export function SearchValue({ children, label }: { children: ReactNode; label: string }) {
  return (
    // `<output>` にするのは、入力ではなく「入力の結果として今この面が示している
    // 値」だから。段落の既定余白も持たない。
    <output
      aria-label={label}
      className="block min-h-14 rounded-card border-2 border-pine bg-surface p-3.75 font-sans text-ink text-search"
    >
      {children}
    </output>
  )
}

/**
 * ガイド付き設定（端末方言）の主操作（`.primary{height:42px;border:0;
 * border-radius:8px;background:var(--g);color:#fff;padding:0 18px;
 * font-weight:700;float:right;margin-top:14px}`）。
 *
 * 右下へ回り込ませるのは、本文の高さが工程ごとに変わっても「次へ進む」が
 * 常に本文の終わりの右にいるため。絶対配置にすると短い工程で宙に浮く。
 */
export function TerminalFormPrimary({
  children,
  onClick,
}: {
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="float-right mt-3.5 rounded-ctl border-0 bg-terminal-pine px-4.5 py-0 font-bold text-on-pine"
      style={{ height: '42px' }}
    >
      {children}
    </button>
  )
}
