import { cn } from '@app/ui'
import type { ReactNode } from 'react'

/*
 * 全画面共通の左サイドバー。
 *
 * 承認済みモックには全体サイドバーが無く、面の行き来は緑バーのタブと各面の
 * 左サイドに分かれていた。その形は面ごとにタブの並びが変わり、同じ面が 2 つの
 * 名で呼ばれ、深いものは 3 階層辿らないと出てこない。実際に到達できない面も
 * 生まれた。行き先を 1 本に集めることで、その種類の欠落がそもそも起きなくなる。
 *
 * 見た目の語彙は増やしていない。250px の左サイド（地色 `side`・白い選択面・
 * 48px の行）は、元から設定と運用の面が持っていた形（`operations-approved.html`
 * の `.side`）をそのまま全画面へ広げたものである。
 */

/** 250px の柱。バーの下で、本文と横に並ぶ。 */
export function AppSidebar({ children }: { children: ReactNode }) {
  return (
    <nav
      aria-label="画面の一覧"
      /*
       * 13 の行き先と、開いている面の節が iPad 横向き（814px、緑バーを引いて
       * 738px）に収まらなければならない。18px の内側余白と 48px 行のままだと
       * 行き先だけで 764px になり、末尾の「お知らせ」が常に切れる。48px は
       * 運用面の 4 項目向けの寸法で、13 項目の柱には合っていないので、余白と
       * 行高を詰めて全部を一度に見せる（`SidebarItem` / `SidebarSection`）。
       */
      className="min-h-0 shrink-0 overflow-auto border-line border-r bg-side p-3"
      style={{ width: '250px' }}
    >
      {children}
    </nav>
  )
}

/** 行き先の群。業務と設定・運用を分けて、どちらの話かを先に言う。 */
export function SidebarGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="my-0 px-2.5 pb-0.5 font-sans text-ink-muted text-note">{label}</p>
      {children}
    </div>
  )
}

/** 行き先ひとつ。選択中だけ白い面になる（`operations-approved.html` の `.side .on`）。 */
export function SidebarItem({
  children,
  current = false,
  onClick,
}: {
  children: ReactNode
  current?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        // 36px 行。13 項目 + 節を 738px に収めるための寸法で、モックの 48px は
        // 4 項目しか無い運用面の値だった。
        'min-h-9 w-full whitespace-nowrap rounded-ctl px-2.5 py-1 text-left font-sans text-body',
        current ? 'bg-surface font-bold text-pine' : 'bg-transparent text-ink',
      )}
    >
      {children}
    </button>
  )
}

/**
 * 開いている面の中の節（`operations-approved.html` の `.side` が並べていたもの）。
 *
 * 行き先の下に一段下げて置く。行き先と同じ見た目で並べると、押した先が別の面
 * なのか同じ面の絞り込みなのかが読めなくなる。
 */
export function SidebarSections({ children }: { children: ReactNode }) {
  return <div className="border-line border-l-2 pl-2.5">{children}</div>
}

/** 節ひとつ。行き先より一段小さく、選択中は緑の太字にする。 */
export function SidebarSection({
  children,
  current = false,
  name,
  onClick,
}: {
  children: ReactNode
  current?: boolean
  /** 読み上げ上の名前。字面に出さない状態語（`完了` / `編集中`）をここへ持たせる。 */
  name?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-current={current ? 'true' : undefined}
      aria-label={name}
      onClick={onClick}
      disabled={onClick === undefined}
      className={cn(
        // 28px 行。節は行き先より一段小さく、開いている面の分だけ足される。
        'min-h-7 w-full whitespace-nowrap rounded-ctl px-2.5 py-0.5 text-left font-sans text-note',
        current ? 'font-bold text-pine' : 'text-ink-muted',
      )}
    >
      {children}
    </button>
  )
}
