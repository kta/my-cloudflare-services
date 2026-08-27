import type { KeyboardEvent, ReactNode, Ref } from 'react'

/*
 * 手前を塞ぐ確認の面。
 *
 * 承認済みモックに幕を持つ面は無い（例外は面ごと差し替わる）。ここは面を
 * 差し替えずに一問だけ答えさせる場所なので、幕は本文色の半透明にとどめ、
 * 中身は運用面と同じカードの語彙（白・1px 罫・角丸 9px・内側 14px）で組む。
 */
const VEIL = 'fixed inset-0 z-10 flex items-center justify-center bg-ink/40 p-6'
const SHEET =
  'max-h-full w-full max-w-160 overflow-auto rounded-card border border-line bg-surface p-3.5 font-sans text-body text-ink'

export function Modal({
  title,
  titleId,
  urgent = false,
  children,
  dialogRef,
  onKeyDown,
}: {
  title: string
  titleId: string
  /** 取り返しのつかない操作の確認。読み上げでは alertdialog として割り込む。 */
  urgent?: boolean
  children: ReactNode
  dialogRef?: Ref<HTMLDivElement>
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
}) {
  const sheet = (
    <div className={SHEET}>
      {/* 見出しの上余白は落とす。枠の内側 14px がそのまま見出しの上になる。 */}
      <h2 id={titleId} className="mt-0">
        {title}
      </h2>
      {children}
    </div>
  )
  /*
   * role を三項で出し入れせず枝を分けるのは、`aria-modal` と `onKeyDown` が
   * どちらの役割でも成り立っていることを、静的に読めるようにするため。
   */
  if (urgent)
    return (
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className={VEIL}
      >
        {sheet}
      </div>
    )
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className={VEIL}
    >
      {sheet}
    </div>
  )
}
