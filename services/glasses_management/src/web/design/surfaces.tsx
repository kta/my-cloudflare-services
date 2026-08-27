import { cn } from '@app/ui'
import type { CSSProperties, ReactNode } from 'react'

/*
 * モック全体で共有される「面」の語彙。実測は次のとおり。
 *
 *   .card,.row,.field{background:#fff;border:1px solid var(--l);
 *                     border-radius:9px;padding:14px}
 *   .field,.card（設定）{min-height:76px}
 *   .row（運用）{margin-top:9px;display:grid;
 *                grid-template-columns:1.4fr 1fr 1fr auto;
 *                align-items:center;gap:10px}
 *   .state{display:inline-block;border-radius:14px;background:var(--gs);
 *          color:var(--g);padding:4px 9px;font-weight:700}
 *   .warning{background:#fff6e5;border:1px solid #d4ad66;color:#4b3713}
 *   .error{background:#fff0ed;border:1px solid #d4a299}
 *   .attention{background:#fff0ed;border:1px solid #d4a299}
 *   .notice{background:#fff7e9;border:1px solid #c58d36;
 *           padding:14px;border-radius:8px}
 *   .preview{margin-top:14px;background:#fff;border:1px solid var(--l);
 *            border-radius:9px;padding:16px}
 */

/** 面の調子。地色と罫線が対で決まるので、色を個別に指定させない。 */
export type Tone = 'plain' | 'error' | 'warning' | 'caution' | 'attention'

const TONE: Record<Tone, string> = {
  plain: 'border-line bg-surface',
  error: 'border-danger-line bg-danger-soft',
  warning: 'border-amber-line bg-amber-soft text-amber-ink',
  /*
   * 設定 6 工程の `.warning{background:#fff6e5;border-color:#d4ad66}` は
   * 文字色を変えない。運用面の `.warning` は #4b3713 を持つが、あちらは
   * 帯の中で 1 行だけ立たせる使い方で、こちらは面まるごとが注意である。
   */
  caution: 'border-amber-line bg-amber-soft',
  attention: 'border-danger-line bg-danger-soft',
}

/** モックの `.card`。白・1px 罫・角丸 9px・内側 14px。 */
export function Card({
  children,
  tone = 'plain',
  className,
  label,
  style,
}: {
  children: ReactNode
  tone?: Tone
  className?: string
  /** 読み上げと突き合わせのための名前。付けると region になる。 */
  label?: string
  style?: CSSProperties
}) {
  const classes = cn('rounded-card border p-3.5', TONE[tone], className)
  if (label)
    return (
      <section aria-label={label} className={classes} style={style}>
        {children}
      </section>
    )
  return (
    <div className={classes} style={style}>
      {children}
    </div>
  )
}

/** 設定・運用の要約カード。読み取り専用で、最低 76px の高さを持つ。 */
export function FieldCard({
  title,
  children,
  tone = 'plain',
  className,
}: {
  title: string
  children?: ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <Card tone={tone} className={cn('min-h-19', className)}>
      <b className="block font-bold">{title}</b>
      {children}
    </Card>
  )
}

/**
 * 運用画面の 1 行（`.row`）。左から見出し・状態 2 つ・操作の 4 列で、
 * 列幅 `1.4fr 1fr 1fr auto` は純粋な配置なのでインラインで持つ。
 */
export function AdminRow({
  children,
  tone = 'plain',
  label,
}: {
  children: ReactNode
  tone?: Tone
  label?: string
}) {
  return (
    <article
      aria-label={label}
      className={cn('mt-2.25 grid items-center gap-2.5 rounded-card border p-3.5', TONE[tone])}
      style={{ gridTemplateColumns: '1.4fr 1fr 1fr auto' }}
    >
      {children}
    </article>
  )
}

/** 状態ピル（`.state`）。緑の淡い地に緑の太字。 */
export function StatePill({
  children,
  tone = 'plain',
}: {
  children: ReactNode
  /**
   * `caution` は失敗ではない注意（`.warning` と同じ琥珀）。緑のピルで出すと
   * 「済んでいる」と読めてしまうので、警告には必ずこちらを使う。モックには
   * この段が無いが、面の `.warning` が持つ 2 色をそのまま借りている。
   */
  tone?: 'plain' | 'danger' | 'caution'
}) {
  return (
    <span
      className={cn(
        'inline-block rounded-sheet px-2.25 py-1 font-bold',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'caution' && 'bg-amber-soft text-amber',
        tone === 'plain' && 'bg-pine-soft text-pine',
      )}
    >
      {children}
    </span>
  )
}

/** 予約フローの案内（`.notice`）。淡い琥珀に細い罫。 */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-ctl border border-notice-line bg-notice-soft p-3.5">{children}</div>
  )
}

/** 設定の見え方プレビュー（`.preview`）。本文の下に続けて置く。 */
export function Preview({
  children,
  tone = 'plain',
  label,
  id,
}: {
  children: ReactNode
  tone?: Tone
  label?: string
  /** 押せない操作から `aria-describedby` で指されるときに渡す。 */
  id?: string
}) {
  return (
    <section
      id={id}
      aria-label={label}
      className={cn('mt-3.5 rounded-card border p-4', TONE[tone])}
    >
      {children}
    </section>
  )
}

/** 3 列のカード並び（`.grid{grid-template-columns:repeat(3,1fr);gap:12px}`）。 */
export function CardGrid({
  columns = 3,
  children,
  className,
  mt = 4.5,
}: {
  columns?: 2 | 3
  children: ReactNode
  className?: string
  /**
   * 上の見出しとの間隔。運用モックは 18px だが設定 6 工程だけ 16px なので、
   * className で上書きすると同じ段の 2 クラスが並んで勝ち負けが読めなくなる。
   */
  mt?: 4 | 4.5
}) {
  return (
    <div
      className={cn(
        'grid gap-3',
        mt === 4 ? 'mt-4' : 'mt-4.5',
        columns === 2 ? 'grid-cols-2' : 'grid-cols-3',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** 見出し行（`.title`）。右端へ寄せたい要素は `push` に入れる。 */
export function TitleRow({
  children,
  push,
  gap = 3,
  className,
}: {
  children: ReactNode
  push?: ReactNode
  /**
   * 並んだ要素の間隔。運用モックの `.title{display:flex;align-items:center}` は
   * gap を持たず、却下・差戻しのような並んだボタンが罫線どうし接している。
   * className で `gap-0` を足すと同じ段の 2 クラスが並んで勝ち負けが読めない
   * ので、値として受ける。
   */
  gap?: 0 | 3
  className?: string
}) {
  return (
    <div className={cn('flex items-center', gap === 3 && 'gap-3', className)}>
      {children}
      {push !== undefined && <div className="ml-auto flex items-center gap-2.5">{push}</div>}
    </div>
  )
}

/**
 * 権限表（`operations-approved.html` の `.matrix`）。ロール × 操作の可否を
 * 一望させるためだけの表で、セルは操作を持たない。
 *
 *   .matrix{width:100%;border-collapse:collapse;margin-top:16px;background:#fff}
 *   .matrix th,.matrix td{border:1px solid var(--l);padding:10px;text-align:center}
 *   .matrix th:first-child,.matrix td:first-child{text-align:left}
 *   .toggle{font-weight:700;color:var(--g)}
 *
 * 列幅は指定が無く、中身で決まる（`table-auto`）。ここで幅を決め打ちすると
 * 文言を変えたときに表がモックからずれる。
 */
export function Matrix({
  columns,
  rows,
  label,
}: {
  /** 1 列目はロール名の見出し。 */
  columns: string[]
  rows: { label: string; cells: { text: string; granted?: boolean }[] }[]
  label: string
}) {
  return (
    <table
      aria-label={label}
      className="mt-4 w-full border-collapse bg-surface font-sans text-body"
    >
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th
              key={column}
              scope="col"
              className={cn(
                'border border-line p-2.5 font-bold',
                index === 0 ? 'text-left' : 'text-center',
              )}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row" className="border border-line p-2.5 text-left font-normal">
              {row.label}
            </th>
            {row.cells.map((cell) => (
              <td
                key={cell.text}
                className={cn(
                  'border border-line p-2.5 text-center',
                  // 許可されている操作だけ緑の太字。不可は本文色のまま置く。
                  cell.granted === true && 'font-bold text-pine',
                )}
              >
                {cell.text}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * 監査イベントの生記録（`.card.audit`）。
 *
 *   .audit{font:14px/1.6 ui-monospace,monospace}
 *
 * ここだけ `--font-record`（モックの `ui-monospace,monospace` そのまま）を使う。
 * 記録は加工せず出したままの姿で読ませる面なので、和文が混じっても等幅の
 * 桁を崩さない。行間 1.6 は文字寸法に紐づかない純粋な組みなのでインラインで持つ。
 */
export function AuditRecord({ lines, label }: { lines: string[]; label: string }) {
  return (
    <section
      aria-label={label}
      className="rounded-card border border-line bg-surface p-3.5 font-record text-grid"
      style={{ lineHeight: 1.6 }}
    >
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </section>
  )
}

/** 変更前・変更後の 2 面（`.diff{grid-template-columns:1fr 1fr;gap:12px}`）。 */
export function DiffPair({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>
}

/**
 * 業務面の一覧に並ぶ 1 件（`staff-approved.html` の `.row`）。
 *
 *   .row{background:#fff;border:1px solid var(--l);border-radius:9px;
 *        padding:14px;margin-top:10px}
 *   .row.selected{border:3px solid var(--g);background:var(--gs)}
 *
 * 選択中は色だけでなく罫の太さも変わる。3px と 1px で内側の位置が 2px ずれるが、
 * モックがそう描いているのでそのまま持つ（詰め物で揃えない）。
 */
export function ListRow({
  children,
  selected = false,
  label,
  onSelect,
}: {
  children: ReactNode
  selected?: boolean
  label?: string
  /**
   * 実アプリの一覧は押して詳細を開く。モックは絵なので押せる印を持たないが、
   * 行そのものを button にすると `article` の意味（1 件のまとまり）が消える
   * ので、中身だけを行いっぱいの button で包む。渡さなければ突き合わせ台の
   * ときと同じ、押せない板のまま。
   */
  onSelect?: () => void
}) {
  return (
    <article
      aria-label={label}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'mt-2.5 rounded-card',
        selected ? 'border-3 border-pine bg-pine-soft' : 'border border-line bg-surface',
      )}
      // 罫が太くなっても内側の余白は 14px のまま（モックの `.row` は padding を
      // 選択状態で変えていない）。
      style={{ padding: '14px' }}
    >
      {onSelect === undefined ? (
        children
      ) : (
        /*
         * 板の内側いっぱいを押せるようにする。地色も罫も持たせないので、
         * 行の見た目はモックのままで、焦点だけが分かる。
         */
        <button
          type="button"
          onClick={onSelect}
          className="block w-full bg-transparent p-0 text-left font-sans text-body text-inherit"
        >
          {children}
        </button>
      )}
    </article>
  )
}

/*
 * ガイド付き設定の端末方言（`settings-approved.html`）の面。上の `Card` /
 * `Preview` と役割は同じだが、寸法体系が違うので寄せない。
 *
 *   .field{background:#fff;border:1px solid var(--l);border-radius:9px;
 *          padding:14px;font-size:11px;min-height:76px}
 *   .field b{display:block;font-size:13px;margin-bottom:6px}
 *   .preview{margin-top:16px;border:1px solid var(--l);border-radius:9px;
 *            background:#fff;padding:15px}
 *   .impact{margin-top:14px;padding:12px;border-radius:8px;
 *           background:#fff3e8;border:1px solid #e9c49e;font-size:10px}
 */

/** 読み取り欄（`.field`）。見出しだけ 13px で、中身は 11px。 */
export function TerminalField({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-19 rounded-card border border-terminal-line bg-surface p-3.5 text-terminal-body">
      <b className="mb-1.5 block font-bold text-note">{title}</b>
      {children}
    </div>
  )
}

/** お客様から見た姿（`.preview`）。設定の言葉ではなく表示される言葉を置く。 */
export function TerminalPreview({ children }: { children: ReactNode }) {
  return (
    <section className="mt-4 rounded-card border border-terminal-line bg-surface p-3.75">
      {children}
    </section>
  )
}

/**
 * 公開前の影響確認（`.impact`）。琥珀ではなく橙寄りの地で、失敗ではなく
 * 「まだ確かめていないことがある」ことだけを伝える。
 */
export function TerminalImpact({ children }: { children: ReactNode }) {
  return (
    <section className="mt-3.5 rounded-ctl border border-terminal-impact-line bg-terminal-impact p-3 text-terminal-note">
      {children}
    </section>
  )
}
