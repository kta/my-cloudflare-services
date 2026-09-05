/**
 * 設定の面の骨格。
 *
 * AdminLTE 2 の 3 つの型を、この製品の語彙へ翻訳して持ってきた。
 *   `content-header` → 見出しといまいる場所（`ContentHeader`）
 *   `box`            → 見出し・中身・締めの 3 段（`Box`）
 *   `small-box`      → 数と名前と次の一手を 1 枚に（`SmallBox`）
 *
 * 色は AdminLTE の aqua/green/yellow/red をそのまま持ち込まず、theme.css の
 * セマンティックトークンへ写す（DESIGN_RULE 0）。角丸も radius トークン 1 つに揃える。
 *
 * AdminLTE から**採らなかった**もの: 箱の上辺の色帯（DESIGN_RULE の NEVER 表が
 * 「最も確実な AI 指紋」として名指ししている）、箱ごとの畳む/閉じる道具（この製品では
 * 箱を閉じたい場面が無い）、右のコントロールサイドバー。
 */
import { cn, focusRing } from '@app/ui'
import type { ReactNode } from 'react'

/** 見出しと、いまいる場所への道筋。AdminLTE の `content-header`。 */
export function ContentHeader({
  title,
  crumbs,
  note,
}: {
  title: string
  /** 左から順に。最後の 1 つがいまいる場所。 */
  crumbs: readonly string[]
  note?: string
}) {
  return (
    <div className="border-line border-b bg-surface-2 px-11 py-6">
      <nav aria-label="いまいる場所" className="text-note text-ink-muted">
        {crumbs.map((crumb, index) => (
          <span key={crumb}>
            {index > 0 && <span className="px-2">›</span>}
            {crumb}
          </span>
        ))}
      </nav>
      <h1 className="mt-1 text-title font-bold text-ink">{title}</h1>
      {note !== undefined && <p className="mt-1 text-body text-ink-muted">{note}</p>}
    </div>
  )
}

/** 見出し・中身・締めの 3 段。AdminLTE の `box`。 */
export function Box({
  title,
  tools,
  children,
  footer,
}: {
  title: string
  /** 見出しの右に置く操作（AdminLTE の `box-tools`）。 */
  tools?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface">
      <header className="flex items-center gap-3 border-line border-b px-6 py-4">
        <h2 className="text-lead font-bold text-ink">{title}</h2>
        {tools !== undefined && <div className="ml-auto">{tools}</div>}
      </header>
      <div className="px-6 py-5">{children}</div>
      {footer !== undefined && (
        <footer className="border-line border-t bg-surface-2 px-6 py-4 text-grid text-ink-muted">
          {footer}
        </footer>
      )}
      {/* 締めを持たない箱は締めの帯を作らない（空の帯を置かない）。 */}
    </section>
  )
}

/**
 * 数と名前と次の一手を 1 枚に。AdminLTE の `small-box`。
 *
 * AdminLTE は色をただの飾りに使うが、ここでは**済んだか・まだか**に使う。
 * `pine` は済み、`walkin` はまだ手が要る。数字を大きく出すのは AdminLTE と同じで、
 * 一目で「何が足りないか」を数で言えるのがこの型の値打ちである。
 */
export function SmallBox({
  value,
  label,
  tone,
  action,
}: {
  value: number
  label: string
  /** 済み（pine）か、まだ手が要る（walkin）か。 */
  tone: 'pine' | 'walkin'
  action?: { label: string; onPress: () => void }
}) {
  const skin =
    tone === 'pine' ? 'border-pine-line bg-pine-soft' : 'border-line-strong bg-walkin-soft'
  const body = (
    <>
      <p className="text-title font-bold text-ink">{value}</p>
      <p className="text-note text-ink-muted">{label}</p>
      {action !== undefined && (
        <p className="mt-2 text-note font-semibold text-ink">{action.label} →</p>
      )}
    </>
  )

  if (action === undefined) {
    return <div className={cn('min-w-36 rounded-card border p-4', skin)}>{body}</div>
  }
  return (
    <button
      type="button"
      onClick={action.onPress}
      aria-label={`${label} ${value}　${action.label}`}
      className={cn('min-h-11 min-w-36 rounded-card border p-4 text-left', skin, focusRing)}
    >
      {body}
    </button>
  )
}
