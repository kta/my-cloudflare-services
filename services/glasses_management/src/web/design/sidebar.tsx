import { cn } from '@app/ui'
import { type ReactNode, useState } from 'react'

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

/**
 * 250px の柱。バーの下で、本文と横に並ぶ。
 *
 * 狭い画面では畳む。375px の端末で 250px を占めたままだと本文に 109px しか
 * 残らず、和文が 1 行 1 文字に折れて読めなくなる。畳んだときは開く口だけを
 * 残し、開くと本文の上に重なる（幅を奪い合わない）。
 */
export function AppSidebar({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 shrink-0 border-line border-b bg-side px-4 text-left font-sans text-body text-ink md:hidden"
      >
        画面の一覧を開く
      </button>
      {open && (
        <div className="fixed inset-0 z-20 bg-ink/40 md:hidden" role="presentation">
          <nav
            aria-label="画面の一覧（開いた状態）"
            className="h-full w-62.5 overflow-auto bg-side p-3"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-11 w-full rounded-ctl px-2.5 text-left font-sans text-body text-ink"
            >
              閉じる
            </button>
            {children}
          </nav>
        </div>
      )}
      <SidebarColumn>{children}</SidebarColumn>
    </>
  )
}

/** 広い画面で本文と横に並ぶ柱そのもの。 */
function SidebarColumn({ children }: { children: ReactNode }) {
  return (
    <nav
      aria-label="画面の一覧"
      // 狭い画面では畳む。上の引き出しが代わりを務める。
      data-sidebar="column"
      /*
       * 13 の行き先は iPad 横向き（814px、緑バーを引いて 738px）に 44px 行のまま
       * 収まる（12px の内側余白 + 群見出し 2 + 13 行 = 648px）。節を開いた分だけ
       * 溢れるので、そこは柱を送らせる。行を 36px まで詰めれば全部映るが、iPad は
       * 指で触る端末なので、押せるものが 44pt を割ると狙って押せなくなる。
       * 映る量より押せることを採る。
       */
      /*
       * 柱そのものは送らせない。13 の行き先は 44px 行のまま 648px で収まる。
       * 入り切らないのは開いている面の節だけなので、送るのはそちら（`SidebarSections`）。
       */
      className="min-h-0 max-md:hidden shrink-0 overflow-hidden border-line border-r bg-side p-3"
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
        // 44px 行。指で押す列なので、ここを下回らせない。
        'min-h-11 w-full whitespace-nowrap rounded-ctl px-2.5 py-1 text-left font-sans text-body',
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
 *
 * 節はここだけを送らせる。13 の行き先（44px 行で 648px）は必ず全部見えていな
 * ければならない——見えない行き先は「無い」のと同じで、それを無くすために柱を
 * 作った。節が入り切らないときに送るのは節の側である。高さの上限 88px は、
 * 738px から行き先 648px を引いた残りに収まる値。
 */
export function SidebarSections({ children }: { children: ReactNode }) {
  return <div className="max-h-22 overflow-auto border-line border-l-2 pl-2.5">{children}</div>
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
      /*
       * 節は「その面の中でいまどこか」なので `step` と名乗る。`true` だと
       * 読み上げが「現在の項目」としか言えず、行き先（`page`）との区別が付かない。
       */
      aria-current={current ? 'step' : undefined}
      aria-label={name}
      onClick={onClick}
      disabled={onClick === undefined}
      className={cn(
        // 節も押せる列なので 44px を割らない。字面だけ一段小さくする。
        'min-h-11 w-full whitespace-nowrap rounded-ctl px-2.5 py-1 text-left font-sans text-note',
        current ? 'font-bold text-pine' : 'text-ink-muted',
      )}
    >
      {children}
    </button>
  )
}
