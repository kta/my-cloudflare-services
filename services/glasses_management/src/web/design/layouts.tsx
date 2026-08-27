import { cn } from '@app/ui'
import { type ReactNode, useEffect, useId } from 'react'
import { type ScreenSection, screenSections } from '../app-chrome'

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
export function Workspace({
  list,
  detail,
  listLabel,
  detailLabel,
}: {
  list: ReactNode
  detail: ReactNode
  /*
   * 2 つの列が何の列なのかは、見出しではなく列自体が名乗る必要がある（左は
   * 探す列、右は選んだ 1 件の列で、詳細側の見出しは選んだ人の名前になる）。
   * 名前は画素を持たないので、突き合わせ台は渡さないまま変わらない。
   */
  listLabel?: string
  detailLabel?: string
}) {
  return (
    <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '390px 1fr' }}>
      <aside
        aria-label={listLabel}
        className="min-h-0 overflow-auto border-line border-r bg-panel p-4"
      >
        {list}
      </aside>
      <section aria-label={detailLabel} className="min-h-0 overflow-auto p-5.5">
        {detail}
      </section>
    </div>
  )
}

/** 運用面: 250px の節ナビ + 本文。 */
export function AdminLayout({
  nav,
  navLabel,
  sections,
  children,
}: {
  /** モックどおり自前の柱を描く（突き合わせ台がこちらを使う）。 */
  nav?: ReactNode
  navLabel?: string
  /**
   * 実アプリはこちらを使う。柱は全画面共通の 1 本しかないので、この面の節は
   * そこへ渡して開いている行き先の下へ入れてもらう。250px の柱を 2 本立てると
   * 本文が半分になってしまう。
   */
  sections?: ScreenSection[]
  children: ReactNode
}) {
  /*
   * 節は描画の結果ではなく面の持ち物なので、描画中ではなく効果で書く。
   * 面を離れたら空にして、前の面の節が残らないようにする。
   *
   * 面は描画のたびに新しい配列を作るので、配列そのものを依存にすると効果が
   * 毎回動いて描画が止まらなくなる。中身を綴った文字列を挟み、その文字列から
   * 節を組み直して渡す（同じ並びなら文字列も同じで、効果は動かない）。
   */
  const signature = sections === undefined ? undefined : JSON.stringify(sections)
  useEffect(() => {
    if (signature === undefined) return
    screenSections.set(JSON.parse(signature) as ScreenSection[])
    return () => screenSections.set([])
  }, [signature])

  if (sections !== undefined)
    return <section className="min-h-0 flex-1 overflow-auto px-7.5 py-6">{children}</section>

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
  onClick,
  name,
}: {
  index: number
  label: string
  state: 'todo' | 'done' | 'current'
  /**
   * 工程を選び直せる面で渡す。突き合わせ台は状態を持たないので渡さず、div の
   * ままにする（button にすると既定の内側余白と字姿が乗り、モックとずれる）。
   */
  onClick?: () => void
  /**
   * 読み上げ上の名前。レールに出る字はモックどおり番号と工程名だけなので、
   * 「完了 / 編集中」のような状態語はここへ持たせる（色に頼らず語で伝える）。
   */
  name?: string
}) {
  /*
   * モックは 1 行のテキスト（`1　店舗と営業時間`）で、番号と名前の間は
   * 全角スペース 1 つ。flex で並べて gap を与えると字送りが変わり、
   * 58px の中で文字が縦中央へ寄ってしまう（モックは上端から 10px）。
   * span で包むのも避ける。要素の境目で字形の並びが切れて、記号と名前の
   * 間が数 px 詰まる。
   */
  const text = `${state === 'done' ? '✓' : index}　${label}`
  const tone = cn(
    'border-l-3 p-2.5 font-sans text-body',
    state === 'todo' && 'border-line text-ink',
    state === 'done' && 'border-pine text-ink',
    state === 'current' && 'border-pine bg-surface font-bold text-pine',
  )
  if (onClick === undefined)
    return (
      <div
        aria-current={state === 'current' ? 'step' : undefined}
        className={tone}
        style={{ minHeight: '58px' }}
      >
        {text}
      </div>
    )
  return (
    <button
      type="button"
      aria-current={state === 'current' ? 'step' : undefined}
      aria-label={name}
      onClick={onClick}
      // ブラウザ既定のボタン余白（app.css の 1px/6px）を打ち消して、行の姿を
      // div のときと同じ 10px に戻す。
      className={cn(tone, 'block w-full py-2.5 text-left')}
      style={{ minHeight: '58px' }}
    >
      {text}
    </button>
  )
}

/** 予約フロー: 主列 + 390px のレール。 */
export function BookingLayout({
  main,
  rail,
  railLabel,
}: {
  main: ReactNode
  rail?: ReactNode
  /**
   * レールが何の列なのか（「ここまでの内容」「代替時刻」「選択中のお客様」）。
   * 中身が工程ごとに丸ごと入れ替わるので、読み上げは見出しだけでなく列自体の
   * 名前で今どこにいるかを言えなければならない。名前は画素を持たない。
   */
  railLabel?: string
}) {
  return (
    <div
      className="grid min-h-0 flex-1"
      style={{ gridTemplateColumns: rail === undefined ? '1fr' : '1fr 390px' }}
    >
      <section className="min-h-0 overflow-auto px-12 pt-9.5 pb-28">{main}</section>
      {rail !== undefined && (
        <aside
          aria-label={railLabel}
          className="min-h-0 overflow-auto border-line border-l bg-rail p-7.5"
        >
          {rail}
        </aside>
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

/*
 * ここから下は「ガイド付き設定」の端末方言（承認済みモック
 * `settings-approved.html`）。上の `GuideLayout`（260px レール・本文 16px）とは
 * 別に組まれていて、レールは 255px、本文は 10〜11px、工程は丸バッジで名乗る。
 *
 *   .guided{height:calc(100% - 92px);grid-template-columns:255px 1fr}
 *   .steps{padding:20px;background:#e9eeeb}
 *   .step{display:flex;gap:10px;padding:13px 8px;
 *         border-left:2px solid #b9c8c0;font-size:11px}
 *   .step i{width:23px;height:23px;border-radius:50%;background:#fff;
 *           display:grid;place-items:center;font-style:normal}
 *   .step.on{border-left-color:var(--g);color:var(--g);font-weight:700}
 *   .step.on i{background:var(--g);color:#fff}
 *   .form{padding:24px 34px}
 *
 * 工程名の下の「設定済み」「編集中」は、済んだ工程と今の工程にしか付かない。
 * これから先の工程に何も書かないのは、まだ何も決まっていないからである。
 */

/** ガイド付き設定（端末方言）: 255px の工程レール + 本文。 */
export function TerminalGuideLayout({
  steps,
  children,
}: {
  steps: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '255px 1fr' }}>
      <nav
        aria-label="設定の工程"
        className="min-h-0 overflow-auto bg-terminal-steps"
        style={{ padding: '20px' }}
      >
        {steps}
      </nav>
      <section className="min-h-0 overflow-auto px-8.5 py-6">{children}</section>
    </div>
  )
}

/** 工程レールの 1 行。丸バッジは済んだ工程だけ `✓`、あとは番号。 */
export function TerminalGuideStep({
  badge,
  label,
  note,
  state = 'todo',
}: {
  /** 丸の中身。済んだ工程は `✓`、これからの工程は番号。 */
  badge: string
  label: string
  /** 「設定済み」「編集中」。決まっていない工程では省く。 */
  note?: string
  state?: 'todo' | 'current'
}) {
  return (
    <div
      aria-current={state === 'current' ? 'step' : undefined}
      className={cn(
        'flex border-l-2 text-terminal-body',
        state === 'current'
          ? 'border-terminal-pine font-bold text-terminal-pine'
          : 'border-terminal-step-line',
      )}
      style={{ gap: '10px', padding: '13px 8px' }}
    >
      {/* モックは `<i>`。斜体にしないと番号だけ傾くので、字姿を素に戻す。 */}
      <i
        aria-hidden="true"
        className={cn(
          'grid shrink-0 place-items-center rounded-circle not-italic',
          state === 'current' ? 'bg-terminal-pine text-on-pine' : 'bg-surface',
        )}
        style={{ width: '23px', height: '23px' }}
      >
        {badge}
      </i>
      <span>
        {label}
        {note !== undefined && (
          <>
            <br />
            <small>{note}</small>
          </>
        )}
      </span>
    </div>
  )
}

/**
 * 実アプリでバーの下に運用面を置くための土台。
 *
 * 突き合わせ台は `Screen` が画面いっぱいの flex 列を作ってから `AdminLayout` を
 * 置くが、実アプリの面は既にバーを持つ枠の中へ差し込まれる。そこでは `flex-1`
 * が効かず節ナビの地色が本文の高さで切れてしまうので、ここで高さいっぱいの列を
 * 作り直す。読み上げの landmark 名もここが持つ（節ナビと本文をまたいで
 * 「今どの面にいるか」を名乗れるのはこの外枠だけ）。
 */
export function AdminSurface({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex min-h-full flex-col bg-paper">
      {children}
    </section>
  )
}
