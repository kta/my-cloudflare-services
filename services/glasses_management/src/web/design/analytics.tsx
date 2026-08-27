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
/*
 * 実アプリでは観点の列を全画面共通の柱へ預けるので、レポートと点検欄の 2 列に
 * なる。柱を 2 本立てると本文が 415px まで潰れる（`docs/frontend/REBUILD.md`）。
 */
const DIAGNOSIS_COLUMNS_WITHOUT_NAV: CSSProperties = { gridTemplateColumns: '1fr 275px' }

export function VizBody({ children, nav = true }: { children: ReactNode; nav?: boolean }) {
  return (
    <div
      className="grid min-h-0 flex-1"
      style={nav ? DIAGNOSIS_COLUMNS : DIAGNOSIS_COLUMNS_WITHOUT_NAV}
    >
      {children}
    </div>
  )
}

/*
 * `.metriclist` / `.metric` — モックが持っていた観点の列。実アプリでは観点を
 * 全画面共通の柱へ預けたので、この語彙はもう誰も使わない（柱を 2 本立てない）。
 * 残しておくと「まだ面の中に列がある」と読めてしまうので消す。地色 `viz-panel`
 * はモックの記録として `theme.css` に残る。
 */

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
 * 色は補強でしかない。塗りを外しても同じことが読めなければならないので、
 * この部品は 3 つを守る。
 *
 * 1. 値は柱の外へ本文色で置く。柱の上に白を乗せると、緑 2.15 / 橙 2.05 /
 *    赤 3.18 でどれも 4.5:1 に届かない（`--color-viz-ink` なら 5.00〜7.75）。
 * 2. 目標は線を引くだけでなく、線の脇で語としても名乗る。
 * 3. 目標を超えた柱は `▲` と「目標超過」を持つ。色を見分けられなくても、
 *    どの柱が超えたのかが字で読める。
 *
 * 抑制された柱は幅も高さも 0 にする（どちらか一方でも残ると、隠した大きさが
 * 読めてしまう）。
 */
export function VizColumnChart({
  label,
  rows,
  target,
}: {
  /** 何の柱なのか。図として名前を持たないと、読み上げで本文と地続きになる。 */
  label: string
  rows: {
    label: string
    valueText: string
    percent: number
    tone: 'plain' | 'warn' | 'critical'
    exceedsTarget?: boolean
    /** 値の下にもう 1 行だけ添える補足（前の工程からの離脱数など）。 */
    noteText?: string
  }[]
  /** 目標線。高さは柱と同じ「一番大きい柱を 100 とした割合」で受ける。 */
  target?: { percent: number; label: string }
}) {
  const TONE = {
    plain: 'bg-viz-bar',
    warn: 'bg-viz-warn',
    critical: 'bg-viz-critical',
  } as const
  return (
    <figure aria-label={label} className="mt-3 mb-0">
      {/* 柱の面。目標線を柱と同じ座標に置くため、目盛と値は外へ出す。 */}
      <div className="relative border-viz-axis border-b" style={{ height: '190px' }}>
        {target !== undefined && (
          <>
            <div
              aria-hidden="true"
              className="absolute inset-x-0 border-viz-critical border-t border-dashed"
              style={{ bottom: `${target.percent}%` }}
            />
            {/* 線だけでは何の線か分からない。線のすぐ上に語で置く。 */}
            <span
              className="absolute left-5 bg-viz-paper px-1 text-viz-fine text-viz-ink"
              style={{ bottom: `${target.percent}%`, marginBottom: '2px' }}
            >
              {target.label}
            </span>
          </>
        )}
        <ul className="absolute inset-0 flex items-end gap-3.25 px-5">
          {rows.map((row) => (
            <li
              key={row.label}
              className="flex h-full flex-1 items-end justify-center"
              // 柱が数本しかない観点で、1 本が列いっぱいに広がると帯にしか
              // 見えない。モックの柱の実測（約 74px）を上限にする。
              style={{ maxWidth: '74px' }}
            >
              <div
                data-bar
                aria-hidden="true"
                className={cn(TONE[row.tone])}
                // 棒の頭だけ丸める。高さは実測の割合そのまま。
                style={{
                  height: `${row.percent}%`,
                  width: row.percent === 0 ? '0%' : '100%',
                  borderRadius: '5px 5px 0 0',
                }}
              />
            </li>
          ))}
        </ul>
      </div>
      {/* 目盛と値は基線の下。柱の高さには影響させない。 */}
      <ul className="flex gap-3.25 px-5 pt-1">
        {rows.map((row) => (
          <li
            key={row.label}
            aria-label={`${row.label} ${row.valueText}${row.exceedsTarget === true ? ' 目標超過' : ''}`}
            className="flex-1 text-center text-viz-fine text-viz-ink"
            style={{ maxWidth: '74px' }}
          >
            <span className="block">{row.label}</span>
            <span className={cn('block', row.exceedsTarget === true && 'font-bold')}>
              {row.exceedsTarget === true && (
                <span aria-hidden="true" className="pr-0.5">
                  ▲
                </span>
              )}
              {row.valueText}
            </span>
            {row.noteText !== undefined && (
              <span className="block text-viz-ink-muted">{row.noteText}</span>
            )}
          </li>
        ))}
      </ul>
    </figure>
  )
}

/**
 * 集計粒度の選び直し（日 / 週 / 月）。
 *
 * ネイティブの `<select>` は地域設定の書体と既定の青を持ち込み、モックのどの面
 * にも無い色が 1 か所だけ出る。選択肢が 3 つしかないので、押しボタンを並べて
 * 今どれを見ているかを面の上に開いたまま置く。
 */
export function VizSegment({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (next: string) => void
}) {
  return (
    // fieldset にするのは、3 つでひとつの選択という関係を要素の意味で持たせる
    // ため。既定の枠と余白は面に無いので落とす。
    <fieldset aria-label={label} className="m-0 flex shrink-0 gap-1 border-0 p-0">
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-ctl border px-2 py-1 text-viz-note',
              on
                ? 'border-viz-pine bg-viz-pine-soft font-bold text-viz-pine'
                : 'border-viz-line bg-surface text-viz-ink',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </fieldset>
  )
}

/**
 * 対象日の欄。`type="date"` はブラウザ既定の `08/27/2026` と青いピッカーを
 * 持ち込むので、素の text にして表記をこちらで決める。モックの `.pill` と同じ
 * 淡い緑のピルに収め、期間の名乗りと同じ列に並べる。
 */
export function VizPeriodField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
}) {
  return (
    <input
      id={id}
      type="text"
      aria-label={label}
      // 端末にテンキーを出す。日付は数字と区切りだけで打ち切れる。
      inputMode="numeric"
      autoComplete="off"
      placeholder="2026-09-23"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-27 shrink-0 rounded-full border border-viz-pine-soft bg-viz-pine-soft px-2.25 py-1.5 text-center font-sans text-viz-note text-viz-pine"
    />
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
      data-viz-card
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
