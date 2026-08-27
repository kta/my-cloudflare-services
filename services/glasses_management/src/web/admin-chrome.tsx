/**
 * 運用・管理画面が共有する枠と語彙。
 *
 * 出典は承認済みモック `docs/frontend/mockups/eyex-reservation/operations-approved.html`
 * と `exception-states-approved.html`。モックでは運用系の画面はすべて
 * 「設定の副タブ + 左サイドの節 + 内容」という同じ骨格を持ち、内容は `.card` /
 * `.row` / `.state` / `.danger` の 4 語彙だけで組まれている。ここはその骨格と
 * 語彙の単一ソースであり、画面ごとに作り直さない。
 *
 * 色・角丸・余白はすべて `packages/ui/src/theme.css` のトークン経由。モックの
 * 生値をここへ書き写さない。
 */

import { Button } from '@app/ui'
import type { CSSProperties, ReactNode } from 'react'
import type { StaffLocation } from './staff-navigation'

/** `.card` — 白・1px line・角丸 9px・内側 14px。 */
const ADMIN_CARD = 'rounded-card border border-line bg-surface p-3.5'

/** `.row` の grid-template-columns。トークンを持たない純粋なレイアウト値。 */
const ROW_COLUMNS: CSSProperties = { gridTemplateColumns: '1.4fr 1fr 1fr auto' }

export type AdminSection = {
  label: string
  to?: StaffLocation
}

/*
 * `.side` / `.side .on` — 250px の列、選択中だけ白地に pine の太字。
 * 承認済みモックの緑帯は 76px のバー 1 本だけなので、管理タブはここではなく
 * `app-chrome.ts` の `barFor()` が持ち、App のヘッダーが描く。
 *
 * SP(375px) では 250px の列と本文が並ぶと日本語が 1 文字ずつ縦に潰れるため、
 * 列は縮めず（`shrink-0`）横スクロールで逃がし、項目は折り返さない。
 */
const SIDE_ITEM =
  'block w-full min-h-12 whitespace-nowrap rounded-ctl p-2.5 text-left font-sans text-ink'
const SIDE_ON = 'bg-surface font-bold text-pine'

/**
 * 運用画面の外枠。左サイドと内容の 2 つをモックの寸法で置く。
 */
export function AdminScreen({
  label,
  sections,
  activeSection,
  sectionsLabel,
  navigate,
  children,
}: {
  /** 画面全体の landmark 名。 */
  label: string
  sections: AdminSection[]
  activeSection: string
  /** 左サイドの nav 名。「共有iPadの節」のように、どの面の目次かを言う。 */
  sectionsLabel: string
  navigate: (location: StaffLocation) => void
  children: ReactNode
}) {
  return (
    <section aria-label={label} className="flex min-h-full flex-col bg-paper">
      <div className="flex min-h-0 flex-1 overflow-x-auto">
        <nav
          aria-label={sectionsLabel}
          className="w-62.5 shrink-0 overflow-x-auto border-line border-r bg-panel p-4.5"
        >
          {sections.map((section) => {
            const on = section.label === activeSection
            return (
              <button
                key={section.label}
                type="button"
                disabled={section.to === undefined}
                aria-current={on ? 'page' : undefined}
                className={`${SIDE_ITEM} ${on ? SIDE_ON : ''}`}
                onClick={() => {
                  if (section.to) navigate(section.to)
                }}
              >
                {section.label}
              </button>
            )
          })}
        </nav>
        <div className="min-w-0 flex-1 overflow-auto px-7.5 py-6">{children}</div>
      </div>
    </section>
  )
}

/** `.title` — 見出しと、右端へ押し出す主操作。 */
export function AdminTitle({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-3">{children}</div>
}

export function AdminHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="font-display font-semibold text-2xl text-ink">{title}</h2>
      {description && <p className="font-sans text-ink text-sm">{description}</p>}
    </div>
  )
}

/** `.state` — 文字が状態を運び、色は補強にしか使わない。 */
export function AdminState({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-pill bg-pine-soft px-2.25 py-1 font-sans font-bold text-pine text-sm">
      {children}
    </span>
  )
}

export type RowTone = 'plain' | 'error' | 'warning'

const ROW_TONE: Record<RowTone, string> = {
  plain: 'border-line bg-surface',
  error: 'border-danger-line bg-danger-soft',
  warning: 'border-amber bg-amber-soft',
}

/** `.row` — 名前 / 補足 / 状態 / 操作 の 4 列。 */
export function AdminRow({
  tone = 'plain',
  label,
  children,
  className,
}: {
  tone?: RowTone
  /** 行の名前。fieldset の legend として、行のグループ名にもなる。 */
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <fieldset
      style={ROW_COLUMNS}
      className={`mt-2.25 grid items-center gap-2.5 rounded-card border p-3.5 ${ROW_TONE[tone]} ${className ?? ''}`}
    >
      {/* 行の名前は見出しとして目には見えている（1 列目の `<b>`）ので、
          legend は読み上げ用にだけ置き、グリッドの列を消費させない。 */}
      <legend className="sr-only">{label}</legend>
      {children}
    </fieldset>
  )
}

/** `.grid` — 3 列のカード列。 */
export function AdminCardGrid({ children }: { children: ReactNode }) {
  return <div className="mt-4.5 grid grid-cols-3 gap-3">{children}</div>
}

export function AdminCard({
  title,
  children,
  tone = 'plain',
  label,
}: {
  title: string
  children?: ReactNode
  tone?: RowTone
  label?: string
}) {
  return (
    <section aria-label={label ?? title} className={`rounded-card border p-3.5 ${ROW_TONE[tone]}`}>
      <p className="font-sans font-bold text-ink text-sm">{title}</p>
      <div className="font-sans text-ink text-sm">{children}</div>
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * 例外・回復状態 (`exception-states-approved.html`)
 *
 * どの状態も「何が起きたか」だけで終わらせない。承認済みの文言と、必ず一つの
 * 回復操作を持つ。文言はモックからそのまま取る。
 * ------------------------------------------------------------------ */

/** `#permission-denied`。設定の存在も内容もこれ以上見せない。 */
export function PermissionDenied({ onReturnHome }: { onReturnHome: () => void }) {
  return (
    <section aria-label="権限がありません" className="mx-auto max-w-3xl px-8 py-9 text-center">
      <p aria-hidden="true" className="font-display font-semibold text-5xl text-pine">
        —
      </p>
      <h2 className="mt-4 font-display font-semibold text-2xl text-ink">
        この設定を表示する権限がありません
      </h2>
      <p className="mt-3 font-sans text-ink text-sm">
        権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。
      </p>
      <div className="mt-5 flex justify-center">
        <Button className="min-h-12" onClick={onReturnHome}>
          業務開始画面へ戻る
        </Button>
      </div>
    </section>
  )
}

/** `#empty`。消えたのではなく、条件に合わなかっただけだと言い切る。 */
export function EmptyResult({
  title,
  description = '検索語またはフィルターを変更してください。履歴自体は削除されていません。',
  onClearFilters,
}: {
  title: string
  description?: string
  onClearFilters: () => void
}) {
  return (
    <section aria-label="該当なし" className="mx-auto max-w-3xl px-8 py-9 text-center">
      <h2 className="font-display font-semibold text-2xl text-ink">{title}</h2>
      <p className="mt-3 font-sans text-ink text-sm">{description}</p>
      <div className="mt-5 flex justify-center">
        <Button className="min-h-12" onClick={onClearFilters}>
          フィルターをすべて解除
        </Button>
      </div>
    </section>
  )
}

/** `#conflict`。最新と手元を並べ、破棄か再適用のどちらかを必ず選ばせる。 */
export function ConflictCompare({
  title,
  latestLabel = '最新の内容',
  mineLabel = 'この端末の入力',
  latest,
  mine,
  onDiscard,
  onReapply,
}: {
  title: string
  latestLabel?: string
  mineLabel?: string
  latest: ReactNode
  mine: ReactNode
  onDiscard: () => void
  onReapply: () => void
}) {
  return (
    <div className="flex flex-col gap-4.5">
      <h2 className="font-display font-semibold text-2xl text-ink">{title}</h2>
      <div className="grid grid-cols-2 gap-3.5">
        <section aria-label={latestLabel} className={ADMIN_CARD}>
          <p className="font-sans font-bold text-ink text-sm">{latestLabel}</p>
          <div className="font-sans text-ink text-sm">{latest}</div>
        </section>
        <section
          aria-label={mineLabel}
          className="rounded-card border border-amber bg-amber-soft p-3.5"
        >
          <p className="font-sans font-bold text-ink text-sm">{mineLabel}</p>
          <div className="font-sans text-ink text-sm">{mine}</div>
        </section>
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="danger" className="min-h-12" onClick={onDiscard}>
          この入力を破棄
        </Button>
        <Button className="min-h-12" onClick={onReapply}>
          最新内容へ再適用
        </Button>
      </div>
    </div>
  )
}
