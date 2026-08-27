import { cn } from '@app/ui'
import type { CSSProperties, ReactNode } from 'react'

/*
 * 分析面（承認済みモック `analytics-approved.html`）の語彙。
 *
 * この面だけ別の寸法体系で描かれている。他の面はバー 76px・本文 16px だが、
 * ここは本文 10〜11px で、緑も #286b55、罫線も #d7ded9 と僅かに違う。数字を
 * 一度に多く並べる面なので、業務面より一段小さく組まれている。色と寸法は
 * `--*-viz-*` トークンへ分けて持ち、業務面の語彙とは混ぜない。
 *
 *   .titlebar{height:58px;padding:0 18px;border-bottom:1px solid var(--l);background:#fff}
 *   .titlebar h3{font-size:18px}
 *   .pill{margin-left:auto;padding:6px 9px;border-radius:15px}
 *   .diagbody{grid-template-columns:220px 1fr 275px}
 *   .metriclist{padding:14px;background:#e9eeeb}
 *   .metric{padding:11px;border-radius:8px;font-size:11px}
 *   .report{padding:18px}
 *   .big{font:600 32px 'IBM Plex Mono';color:var(--g)}
 *   .bars{height:190px;gap:13px;padding:12px 20px;border-bottom:1px solid #aebcb4}
 *   .barcol{flex:1;border-radius:5px 5px 0 0}
 *   .barcol span{position:absolute;bottom:-25px;font-size:9px}
 *   .finding{margin-top:36px;padding:13px;font-size:11px}
 *   .inspector{border-left:1px solid var(--l);padding:15px;background:#f0f2ef}
 *   .card{padding:12px;margin-bottom:10px;font-size:10px;line-height:1.6}
 *   .definition{font-size:9px;padding-top:9px;border-top:1px solid #e5eae7}
 */

/**
 * 分析面の土台。
 *
 * モックの body は `font-family` しか書いておらず、行間はブラウザ既定の
 * `normal` のまま。アプリの土台は本文 1.5 なので、この面だけ戻す。1.5 の
 * ままだと 10〜11px の行が 1 行あたり 1px ずつ伸び、右の点検欄が下へ流れる。
 */
export function VizSurface({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className="flex min-h-full flex-col bg-viz-paper font-sans text-viz-ink"
      style={{ lineHeight: 'normal' }}
    >
      {children}
    </section>
  )
}

/** `.titlebar` — 見出しと、右端へ寄る要素。 */
export function VizTitleBar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-viz-line border-b bg-surface px-4.5"
      style={{ minHeight: '58px' }}
    >
      <h1 className="text-lead">{title}</h1>
      {children}
    </div>
  )
}

/** `.pill` — 期間・タイムゾーン・最終更新をひと続きで名乗る。 */
export function VizPill({ children }: { children: ReactNode }) {
  return (
    <p className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full bg-viz-pine-soft px-2.25 py-1.5 text-viz-note text-viz-pine">
      {children}
    </p>
  )
}

/** `.diagbody` — 指標 / レポート / 点検欄 の 3 列。 */
const DIAGNOSIS_COLUMNS: CSSProperties = { gridTemplateColumns: '220px 1fr 275px' }

export function VizBody({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1" style={DIAGNOSIS_COLUMNS}>
      {children}
    </div>
  )
}

/** `.metriclist` — 掘り下げる指標をひとつだけ選ばせる列。 */
export function VizMetricList({ children }: { children: ReactNode }) {
  return (
    <nav aria-label="指標" className="min-h-0 overflow-auto bg-viz-panel p-3.5">
      {children}
    </nav>
  )
}

export function VizMetricItem({
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
      aria-current={on ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'min-h-11 w-full rounded-ctl p-2.75 text-left text-viz-body',
        on ? 'bg-surface font-bold text-viz-pine' : 'text-viz-ink',
      )}
    >
      {children}
    </button>
  )
}

/** `.report` — 選んだ指標を掘り下げる中央の列。 */
export function VizReport({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="min-h-0 overflow-auto p-4.5">
      {children}
    </section>
  )
}

/** `.big` — 見出しより大きい等幅の数字ひとつ。桁で読む値なので等幅で組む。 */
export function VizFigure({ children }: { children: ReactNode }) {
  return <p className="font-figure font-semibold text-viz-figure text-viz-pine">{children}</p>
}

/** 数字の下に添える補足（前月比・目標・対象件数）。 */
export function VizNote({ children }: { children: ReactNode }) {
  // 補足も既定の段落余白を持たない（10px の行に 10px の余白が付くと、
  // モックで 1 行に見える「前月比・目標・対象件数」が 3 段に割れる）。
  return <p className="my-0 text-viz-ink-muted text-viz-note">{children}</p>
}

/** 目標を超えた指標に付く印。この面の寸法体系に合わせた小さなピル。 */
export function VizFlag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-viz-pine-soft px-2 py-1 font-bold text-viz-note text-viz-pine">
      {children}
    </span>
  )
}

/**
 * `.bars` — 時間帯ごとの縦の柱。
 *
 * 色は補強でしかない。どの柱にもラベルと数値が文字で付き、抑制された柱は
 * 幅も高さも 0 にする（どちらか一方でも残ると、隠した大きさが読めてしまう）。
 */
export function VizColumnChart({
  rows,
}: {
  rows: { label: string; valueText: string; percent: number; tone: 'plain' | 'warn' | 'critical' }[]
}) {
  const TONE = {
    plain: 'bg-viz-bar',
    warn: 'bg-viz-warn',
    critical: 'bg-viz-critical',
  } as const
  return (
    <ul
      className="mt-3 flex items-end gap-3.25 border-viz-axis border-b px-5 py-3"
      style={{ height: '190px' }}
    >
      {rows.map((row) => (
        <li key={row.label} className="flex h-full flex-1 flex-col justify-end">
          <span className="text-center text-viz-fine">{row.valueText}</span>
          <div className="flex h-full items-end">
            <div
              data-bar
              aria-hidden="true"
              className={cn('relative', TONE[row.tone])}
              // 棒の頭だけ丸める。高さは実測の割合そのまま。
              style={{
                height: `${row.percent}%`,
                width: row.percent === 0 ? '0%' : '100%',
                borderRadius: '5px 5px 0 0',
              }}
            />
          </div>
          {/* 目盛は基線の下。棒の高さには影響させない。 */}
          <span className="text-center text-viz-fine">{row.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** `.finding` — 一番大きな山を文章で言い切る。数字だけでは読み手が動けない。 */
export function VizFinding({ children }: { children: ReactNode }) {
  return (
    <div className="mt-9 rounded-card border border-viz-line bg-surface p-3.25 text-viz-body">
      {children}
    </div>
  )
}

/** 横棒。長さは補強で、隣に必ずラベルと数値が文字で並ぶ。 */
export function VizBar({ percent }: { percent: number }) {
  return (
    <div aria-hidden="true" className="h-1.5 w-full rounded-full bg-viz-line">
      <div data-bar className="h-1.5 rounded-full bg-viz-bar" style={{ width: `${percent}%` }} />
    </div>
  )
}

/** `.inspector` — 断定しない原因候補と、対象データの定義。 */
export function VizInspector({ children }: { children: ReactNode }) {
  return (
    <aside
      aria-label="確認すること"
      className="min-h-0 overflow-auto border-viz-line border-l bg-viz-rail p-3.75"
    >
      <h2 className="mt-0 mb-2.5 text-h3">確認すること</h2>
      {children}
    </aside>
  )
}

/**
 * `.card` — 点検欄の小カード。この面だけ行間 1.6 で組まれている（10px の
 * 3 行を読ませるため）。文字寸法に紐づかない組みなのでインラインで持つ。
 */
export function VizCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="mb-2.5 rounded-card border border-viz-line bg-surface p-3 text-viz-note"
      style={{ lineHeight: 1.6 }}
    >
      <b className="block font-bold">{title}</b>
      {children}
    </section>
  )
}

/** `.definition` — カードの末尾に細い罫で区切って置く但し書き。 */
export function VizDefinition({ children }: { children: ReactNode }) {
  return (
    <span className="mt-2 block border-viz-hairline border-t pt-2.25 text-viz-fine text-viz-ink-muted">
      {children}
    </span>
  )
}
