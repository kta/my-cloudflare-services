import type { ReactNode } from 'react'

/*
 * 何も無いことを伝える面。**中身が無いだけで、壊れてはいないと読ませる。**
 *
 * 以前の来店受付の空は、1118×760px の白い面の左端から 120px・上から 51% の位置に
 * 見出しと本文とボタンが取り残されており、要素が中途半端な場所に散った
 * 「壊れた画面」に見えていた（UX 監査 UI-10）。
 * 承認済みモック `HISTORY-EMPTY.png` は横中央に置き、見出しを 1 段上げ、
 * 条件の要約と復帰の手段を並べる。器を持たず、中央揃えと寸法の段だけで
 * 「これは意図された画面である」と伝えている。
 *
 * 読み込み中（`LoadingState`）・失敗（`shell/LoadFailed`）とは、
 * **文字を読まなくても形で見分けられる**ようにする。
 */
export function EmptyState({
  title,
  note,
  children,
}: {
  /** 何が無いかを 1 行で。`--text-title` 以上で出す。 */
  title: string
  /** なぜ無いのか、いま何の条件で見ているのか。 */
  note?: string
  /** 復帰の手段。**必ず 1 つは置く**（行き止まりを作らない）。 */
  children?: ReactNode
}) {
  return (
    <div
      role="status"
      data-empty-state
      className="grid flex-1 content-center justify-items-center gap-3 px-11 py-16 text-center"
    >
      <h2 className="text-title font-bold text-ink">{title}</h2>
      {note !== undefined && <p className="text-body text-ink-muted">{note}</p>}
      {children !== undefined && (
        <div className="mt-2 grid justify-items-center gap-3">{children}</div>
      )}
    </div>
  )
}

/*
 * 読み込み中の面。**空・失敗と形で見分ける** —— 空は中央の見出し、失敗は縁のある箱、
 * 読み込み中は中身の形をした灰色の板である。
 */
export function LoadingState({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="grid flex-1 content-start gap-2.5 p-8">
      <p role="status" className="sr-only">
        {label}
      </p>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          data-skeleton-row
          className="h-11 rounded-ctl bg-surface-2"
        />
      ))}
    </div>
  )
}
