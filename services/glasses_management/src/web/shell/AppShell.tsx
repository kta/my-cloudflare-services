import { cn, focusRing, focusRingOnPine } from '@app/ui'
import type { ReactNode } from 'react'
import { DESTINATIONS, type Destination, HOME_DESTINATION } from './destinations'
import { Icon } from './icons'

/*
 * 業務画面の骨格。承認済みモック（docs/frontend/mockups/eyex）の実測に合わせる。
 *   上のバー 64px（店名・日付・お知らせだけ）
 *   左サイドバー 216px / たたむと 76px（行き先はすべてここ）
 * 触れるものは 44pt 以上（Apple HIG）。色はすべて packages/ui のトークン経由。
 */

export type AppShellProps = {
  storeName: string
  /** 店名の下の 1 行。営業状態や画面名を置く。 */
  storeSubline: string
  /** いま開いている行き先（DESTINATIONS の key）。 */
  current: string
  onNavigate: (key: string) => void
  /** たたんだ細い柱にするか。 */
  rail: boolean
  onToggleRail: () => void
  /** 未読のお知らせ件数。0 なら出さない。 */
  alertCount?: number
  /** この端末は何か（例: 銀座店 レジ横iPad / 共有で使っています）。 */
  terminalNote?: readonly string[]
  /**
   * 上のバーの中央に差し込むもの（台帳・予約枠の日付の帯）。モックの `.datepill` は
   * 店名と右端の操作の間に `margin: 0 auto` で置かれる。中身は画面の側が持つ。
   */
  barCenter?: ReactNode
  /** 上のバーの右端に足す操作。 */
  barActions?: ReactNode
  children: ReactNode
}

export function AppShell({
  storeName,
  storeSubline,
  current,
  onNavigate,
  rail,
  onToggleRail,
  alertCount = 0,
  terminalNote,
  barCenter,
  barActions,
  children,
}: AppShellProps) {
  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <header className="flex h-16 shrink-0 items-center gap-4 bg-pine px-4 text-on-pine">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          aria-label="トップへ"
          className={cn(
            'grid size-12 place-items-center rounded-card bg-on-pine/20 text-on-pine',
            focusRingOnPine,
          )}
        >
          <Icon name="home" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-bar font-bold">{storeName}</p>
          <p className="truncate text-note opacity-90">{storeSubline}</p>
        </div>
        {barCenter}
        <div className="ml-auto flex items-center gap-2">{barActions}</div>
      </header>

      {/* 幅は任意値で書かない。--spacing の刻みで 76px（w-19）/ 216px（w-54）を作る。 */}
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="画面の切り替え"
          className={cn(
            'flex min-h-0 shrink-0 flex-col gap-1 overflow-hidden border-r border-line bg-surface-2 py-4',
            rail ? 'w-19 items-center px-2.5' : 'w-54 px-3.5',
          )}
        >
          <button
            type="button"
            onClick={onToggleRail}
            aria-label={rail ? 'サイドバーをひらく' : 'サイドバーをたたむ'}
            aria-expanded={!rail}
            className={cn(
              'flex min-h-11 items-center rounded-card text-grid font-semibold text-ink-muted',
              rail ? 'w-13 justify-center' : 'w-full gap-2 px-3',
              focusRing,
            )}
          >
            <Icon name="collapse" />
            <span className={rail ? 'sr-only' : undefined}>たたむ</span>
          </button>

          <NavItem
            destination={HOME_DESTINATION}
            rail={rail}
            current={current}
            onNavigate={onNavigate}
            alertCount={alertCount}
          />

          <button
            type="button"
            onClick={() => onNavigate('book')}
            className={cn(
              'mt-2 mb-3.5 flex min-h-13 items-center justify-center rounded-card bg-pine font-bold text-on-pine',
              rail ? 'w-13' : 'w-full gap-2 px-3.5 text-lead',
              focusRing,
            )}
          >
            <Icon name="add" />
            <span className={rail ? 'sr-only' : undefined}>予約を取る</span>
          </button>

          {DESTINATIONS.map((destination, index) => (
            <NavGroupLabel
              key={destination.key}
              rail={rail}
              destination={destination}
              previous={DESTINATIONS[index - 1]}
            >
              <NavItem
                destination={destination}
                rail={rail}
                current={current}
                onNavigate={onNavigate}
                alertCount={alertCount}
              />
            </NavGroupLabel>
          ))}

          {!rail && terminalNote && (
            <p className="mt-auto border-t border-line px-2.5 pt-3.5 text-fine leading-snug text-ink-muted">
              {terminalNote.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </p>
          )}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  )
}

function NavItem({
  destination,
  rail,
  current,
  onNavigate,
  alertCount,
}: {
  destination: Destination
  rail: boolean
  current: string
  onNavigate: (key: string) => void
  alertCount: number
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(destination.key)}
      aria-current={current === destination.key ? 'page' : undefined}
      className={cn(
        'flex min-h-11.5 items-center rounded-card font-semibold',
        rail ? 'w-13 justify-center' : 'w-full gap-3 px-3 text-body',
        current === destination.key ? 'bg-pine text-on-pine' : 'text-ink',
        focusRing,
      )}
    >
      <Icon name={destination.icon} />
      {/* 柱にたたんでも名前は消さない。目に見えなくなるだけで、読み上げと
          キーボードの選択には残る（アイコンだけのボタンに名前が無いのは重大な欠陥）。 */}
      <span className={rail ? 'sr-only' : undefined}>{destination.label}</span>
      {!rail && destination.key === 'home' && alertCount > 0 && (
        <span className="ml-auto min-w-5.5 rounded-full bg-danger px-1.5 text-center text-note font-bold text-on-danger">
          {alertCount}
        </span>
      )}
    </button>
  )
}

/** 「お店の運用」の見出しを、その群の先頭の直前にだけ挟む。 */
function NavGroupLabel({
  rail,
  destination,
  previous,
  children,
}: {
  rail: boolean
  destination: Destination
  previous?: Destination
  children: ReactNode
}) {
  const startsGroup = destination.group === 'operations' && previous?.group !== 'operations'
  if (!startsGroup) return children
  return (
    <>
      {!rail && <p className="mt-5 mb-0.5 px-3 text-grid text-ink-muted">お店の運用</p>}
      {children}
    </>
  )
}
