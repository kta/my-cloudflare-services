import { cn } from '@app/ui'
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

/*
 * 作業する店舗を切り替えるシート（承認済みモック `store-switch-approved.html`）。
 *
 *   .veil{inset:…;padding:88px 0 0 55px}   幕は台帳を消さず、上に掛かるだけ
 *   .popover{width:380px;border-radius:14px;box-shadow:0 24px 70px #10271e66}
 *   .pophead{padding:17px;border-bottom:1px solid var(--l)}
 *   .store{padding:13px 17px;border-bottom:1px solid …}
 *   .boundary{padding:12px 17px;background:…;line-height:1.55}
 *
 * モックは 67px バーの方言で描かれているので、寸法体系（バーの高さ・本文の
 * 文字寸法・緑）は正典（76px）に載せ替え、情報構造と余白だけを継ぐ。幕の上端が
 * バーの下 21px になるよう、上の詰め物はバー 76px + 21px で持つ。
 *
 * 中央に置かず左へ寄せるのは、モックが「今どの店舗を見ていたか」を右側に
 * 残したまま切り替えさせるためである。中央へ動かすと台帳が幕とシートの
 * 両方に隠れ、伏せ方の意図が消える。
 */
export function SwitchSheet({
  title,
  titleId,
  search,
  boundary,
  children,
}: {
  title: string
  titleId: string
  /** 見出しの下に置く検索欄。 */
  search?: ReactNode
  /** 末尾の但し書き。飾りではなく、ここに出ないものの境界を伝える。 */
  boundary?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-10 bg-ink/40" style={{ padding: '97px 0 0 55px' }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="overflow-hidden rounded-sheet bg-surface font-sans text-body text-ink"
        style={{ width: '380px', boxShadow: '0 24px 70px var(--color-sheet-shadow)' }}
      >
        <div className="border-line border-b" style={{ padding: '17px' }}>
          {/* 枠の内側 17px がそのまま見出しの上になる（既定の上余白は落とす）。 */}
          <h2 id={titleId} className="mt-0">
            {title}
          </h2>
          {search !== undefined && <div className="mt-3">{search}</div>}
        </div>
        {children}
        {boundary !== undefined && (
          <p
            className="bg-rail text-ink-muted text-note"
            style={{ padding: '12px 17px', lineHeight: 1.55, margin: 0 }}
          >
            {boundary}
          </p>
        )}
      </section>
    </div>
  )
}

/**
 * シートの 1 店舗（`.store`）。名前・副題・状態語の 3 つで、押す前に
 * 「切り替えてよいか」を読み切らせる。状態は右端へ流し、名前より小さく置く。
 */
export function SwitchOption({
  name,
  note,
  state,
  selected = false,
  suspended = false,
  disabled = false,
  onClick,
}: {
  name: string
  note: string
  state: string
  selected?: boolean
  /** 受付を止めている店舗。赤は「止まっている」だけを言い、押下は妨げない。 */
  suspended?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      // 押せない間もタブ順から外さない（切替中であることは状態語ではなく
      // aria-disabled が伝え、焦点は行に残る）。
      aria-disabled={disabled || undefined}
      aria-current={selected ? 'true' : undefined}
      onClick={disabled ? undefined : onClick}
      className={cn(
        'flex w-full items-start justify-between gap-3 border-line border-b text-left font-sans text-body text-ink',
        selected ? 'bg-pine-soft' : 'bg-surface',
      )}
      style={{ padding: '13px 17px' }}
    >
      <span>
        <b className="block">{name}</b>
        <small className="text-ink-muted">{note}</small>
      </span>
      <b className={suspended ? 'text-danger' : 'text-pine'}>{state}</b>
    </button>
  )
}
