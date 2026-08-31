import { focusRingOnPine } from '@app/ui'
import type { ReactNode } from 'react'

/*
 * 業務開始 6 面の上のバー（64px）。**`⌂` を置かない** —— まだ戻る先が無いので、
 * 押して何も起きないボタンを置かない（`AppShell` の上のバーとはここが違う）。
 */
export function StartBar({
  storeName,
  subline,
  actions,
}: {
  storeName: string
  subline: string
  actions?: ReactNode
}) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 bg-pine px-11 text-on-pine">
      <div className="min-w-0">
        <p className="truncate text-bar font-bold">{storeName}</p>
        <p className="truncate text-note opacity-90">{subline}</p>
      </div>
      <div className="ml-auto flex items-center gap-3">{actions}</div>
    </header>
  )
}

/** バー右の操作。上段 12px の補足・下段 17px の名前で、当たり判定は 60×48px。 */
export function StartBarButton({
  label,
  note,
  onPress,
}: {
  label: string
  note?: string
  onPress: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`grid min-h-12 min-w-15 place-items-center rounded-card px-3 ${focusRingOnPine}`}
    >
      {note !== undefined && <span className="text-note opacity-90">{note}</span>}
      <span className="text-lead font-semibold">{label}</span>
    </button>
  )
}
