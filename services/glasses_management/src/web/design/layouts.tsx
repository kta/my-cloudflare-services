import { cn } from '@app/ui'
import { type ReactNode, useId } from 'react'

/*
 * 面の骨格。モックには 4 種類しか無く、どれも「バーの下を 2 列に割る」形をとる。
 *
 *   業務   `.workspace{grid-template-columns:390px 1fr}`
 *          `.list{padding:16px;background:#e7ede9;border-right:1px solid …}`
 *          `.detail{padding:22px;overflow:auto}`
 *   運用   `.layout{grid-template-columns:250px 1fr}`
 *          `.side{padding:18px;background:#e5ece8;border-right:…}`
 *          `.content{padding:24px 30px;overflow:auto}`
 *   設定   `.layout{grid-template-columns:260px 1fr}`
 *          `.steps{background:#e4ebe7;padding:18px}`
 *          `.content{padding:26px 34px;overflow:auto}`
 *   予約   `.booking{grid-template-columns:1fr 390px}`
 *          `.main{padding:38px 48px 112px;overflow:auto}`
 *          `.aside{border-left:…;background:#f6f8f6;padding:30px}`
 *
 * 列幅は 4 の倍数でない実測値なので、純粋な配置としてインラインで持つ。
 */

/** 業務面: 390px の一覧 + 詳細。 */
export function Workspace({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '390px 1fr' }}>
      <aside className="min-h-0 overflow-auto border-line border-r bg-panel p-4">{list}</aside>
      <section className="min-h-0 overflow-auto p-5.5">{detail}</section>
    </div>
  )
}

/** 運用面: 250px の節ナビ + 本文。 */
export function AdminLayout({
  nav,
  navLabel,
  children,
}: {
  nav: ReactNode
  navLabel: string
  children: ReactNode
}) {
  return (
    <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '250px 1fr' }}>
      <nav
        aria-label={navLabel}
        className="min-h-0 overflow-auto border-line border-r bg-side p-4.5"
      >
        {nav}
      </nav>
      <section className="min-h-0 overflow-auto px-7.5 py-6">{children}</section>
    </div>
  )
}

/** 節ナビの 1 項目（`.side button`）。選択中だけ白い面になる。 */
export function SideNavItem({
  children,
  on = false,
  onClick,
}: {
  children: ReactNode
  on?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-current={on ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'min-h-12 w-full whitespace-nowrap rounded-ctl p-2.5 text-left font-sans text-body',
        on ? 'bg-surface font-bold text-pine' : 'bg-transparent text-ink',
      )}
    >
      {children}
    </button>
  )
}

/** 設定ガイド: 260px の工程レール + 本文。 */
export function GuideLayout({ steps, children }: { steps: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '260px 1fr' }}>
      <nav aria-label="設定の工程" className="min-h-0 overflow-auto bg-steps p-4.5">
        {steps}
      </nav>
      <section className="min-h-0 overflow-auto px-8.5 py-6.5">{children}</section>
    </div>
  )
}

/**
 * 工程レールの 1 行（`.step{min-height:58px;padding:10px;
 * border-left:3px solid var(--l)}`）。枠付きのカードにはしない。
 */
export function GuideStep({
  index,
  label,
  state,
}: {
  index: number
  label: string
  state: 'todo' | 'done' | 'current'
}) {
  return (
    <div
      aria-current={state === 'current' ? 'step' : undefined}
      className={cn(
        'border-l-3 p-2.5 font-sans text-body',
        state === 'todo' && 'border-line text-ink',
        state === 'done' && 'border-pine text-ink',
        state === 'current' && 'border-pine bg-surface font-bold text-pine',
      )}
      style={{ minHeight: '58px' }}
    >
      {/*
       * モックは 1 行のテキスト（`1　店舗と営業時間`）で、番号と名前の間は
       * 全角スペース 1 つ。flex で並べて gap を与えると字送りが変わり、
       * 58px の中で文字が縦中央へ寄ってしまう（モックは上端から 10px）。
       * span で包むのも避ける。要素の境目で字形の並びが切れて、記号と名前の
       * 間が数 px 詰まる。
       */}
      {`${state === 'done' ? '✓' : index}　${label}`}
    </div>
  )
}

/** 予約フロー: 主列 + 390px のレール。 */
export function BookingLayout({ main, rail }: { main: ReactNode; rail?: ReactNode }) {
  return (
    <div
      className="grid min-h-0 flex-1"
      style={{ gridTemplateColumns: rail === undefined ? '1fr' : '1fr 390px' }}
    >
      <section className="min-h-0 overflow-auto px-12 pt-9.5 pb-28">{main}</section>
      {rail !== undefined && (
        <aside className="min-h-0 overflow-auto border-line border-l bg-rail p-7.5">{rail}</aside>
      )}
    </div>
  )
}

/**
 * 全画面の状態（`.lock{text-align:center;padding-top:90px}`、
 * `.lock strong{font-size:54px;color:var(--g)}`）。
 * 例外・回復はすべてこの形で、業務のクロムを持たない。
 */
export function FullScreenState({
  glyph,
  title,
  children,
  actions,
}: {
  /** モックが置く 54px の記号。持たない面もある。 */
  glyph?: string
  title: string
  children?: ReactNode
  actions?: ReactNode
}) {
  return (
    <section
      aria-label={title}
      className="mx-auto w-full max-w-225 px-8.5 pt-22.5 pb-8.5 text-center font-sans"
    >
      {/*
       * モックの記号は `.lock strong` で、display は既定のまま（inline）。
       * 行box が 54px × 行間 1.5 の高さを持つことで見出しとの間隔が決まるので、
       * block 化も leading の上書きもしない。
       */}
      {glyph !== undefined && (
        <strong aria-hidden="true" className="font-bold text-glyph text-pine">
          {glyph}
        </strong>
      )}
      {/* 見出しの上下余白はブラウザ既定（0.83em）のまま。モックが依っている。 */}
      <h1>{title}</h1>
      {children}
      {actions !== undefined && (
        <div className="mt-5 flex flex-col items-center gap-3">{actions}</div>
      )}
    </section>
  )
}

/**
 * 例外の本文枠（`.content{padding:34px;max-width:900px;margin:auto}` と
 * `.panel{background:#fff;border:1px solid var(--l);border-radius:12px;
 * padding:24px;margin-top:18px}`）。
 */
export function ExceptionContent({
  children,
  dialogLabelledBy,
}: {
  children: ReactNode
  /**
   * 「切り替える前に確認してください」のように、後戻りの判断を求めて手前を
   * 塞ぐ面で渡す。見出しの id を指すと、この枠が dialog として読み上げられる。
   * role は見た目を持たないので、モックの画素は 1 つも動かない。
   */
  dialogLabelledBy?: string
}) {
  const frame = 'mx-auto w-full max-w-225 p-8.5 font-sans'
  // role の有無で枝を分ける。三項で `role` を出し入れすると、その枝でしか
  // 意味を持たない `aria-modal` が常に付いているように見えてしまう。
  if (dialogLabelledBy === undefined) return <div className={frame}>{children}</div>
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={dialogLabelledBy} className={frame}>
      {children}
    </div>
  )
}

export function Panel({
  children,
  tone = 'plain',
  label,
}: {
  children: ReactNode
  tone?: 'plain' | 'error' | 'warning'
  label?: string
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        'mt-4.5 rounded-panel border p-6',
        tone === 'plain' && 'border-line bg-surface',
        tone === 'error' && 'border-danger-panel-line bg-danger-panel',
        // 例外の `.warning` は罫線と地色だけで、文字色は本文のまま
        // （運用面の `.warning` は #4b3713 を持つが、あちらは Card の役目）。
        tone === 'warning' && 'border-amber-line bg-amber-soft',
      )}
    >
      {children}
    </section>
  )
}

/** 2 面の突き合わせ（`.compare{grid-template-columns:1fr 1fr;gap:14px}`）。 */
export function Compare({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3.5">{children}</div>
}

/*
 * 続ける前に一度だけ承諾を取る面（モックの `.permission`）。
 *
 *   .permission{max-width:660px;margin:90px auto;background:#fff;
 *       border:1px solid var(--line);border-radius:14px;padding:32px}
 *   .permission .actions{display:flex;justify-content:flex-end;gap:12px;
 *       margin-top:24px}
 *   .permission button{min-height:48px;border-radius:8px;padding:0 20px;
 *       border:1px solid var(--line);background:#fff}
 *   .permission .primary{background:var(--brand);color:#fff}
 *
 * 業務のクロムを持たない全画面状態と違い、バーの下に 1 枚だけ置く。ここで
 * 引き返しても予約入力は続けられるので、面ごと止めてはいけない。
 */
export function ConsentSheet({
  title,
  children,
  actions,
}: {
  title: string
  children?: ReactNode
  actions?: ReactNode
}) {
  // 見出しを名前として指すために id を振る（本文の描画には影響しない）。
  const titleId = useId()
  return (
    /*
     * 続けるか引き返すかを決めるまで手前の面へ戻れないので、読み上げ上も
     * dialog として閉じた場に置く。幕や閉じるボタンは追加しない（モックの
     * 画素が変わる）。
     */
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="mx-auto my-22.5 w-full max-w-165 rounded-sheet border border-line bg-surface p-8 font-sans"
    >
      <h1 id={titleId}>{title}</h1>
      {children}
      {actions !== undefined && <div className="mt-6 flex justify-end gap-3">{actions}</div>}
    </section>
  )
}

/**
 * 承諾の面に並ぶ操作。主操作も罫線は他と同じ `--line` のままで、地色だけが違う
 * （モックが `.primary` で色しか上書きしていない）。太字にもしない — 断る側と
 * 同じ重さで並べることが、この面の設計そのものだから。
 */
export function ConsentAction({
  children,
  primary = false,
  onClick,
}: {
  children: ReactNode
  primary?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-12 rounded-ctl border border-line px-5 py-0 font-sans text-body',
        primary ? 'bg-pine text-on-pine' : 'bg-surface text-ink',
      )}
    >
      {children}
    </button>
  )
}
