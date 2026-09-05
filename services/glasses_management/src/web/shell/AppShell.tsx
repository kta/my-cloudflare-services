import { cn, focusRing, focusRingOnPine } from '@app/ui'
import { type ReactNode, useEffect, useState } from 'react'
import { DESTINATIONS, type Destination, HOME_DESTINATION } from './destinations'
import { Icon } from './icons'

const ALERT_DESTINATION: Destination = { key: 'alerts', label: 'お知らせ', icon: 'alerts' }
/*
 * 上のバーにお知らせを出す画面。**承認済みモックのとおり**にしてある。
 *
 * 来店受付・予約を探す・受付履歴・分析にはモックが意図してベルを描いていない
 * （`RECEPTION-CHECKIN.png` の上のバーは店名だけで、右端は空である）。
 * お客様が目の前に立っている面から通知を外す判断だと読める。
 *
 * ただしその結果、「録音の保存に3回失敗しました（対応が必要）」が 4 画面で
 * 見えなくなる（UX 監査 UI-05）。ここを変えるなら承認済みモックを変えることになるので、
 * 実装だけを先に動かさない。`docs/audit/2026-09-02-eye-ux/` の宿題として残す。
 */
/*
 * 上のバーに「お知らせ」を出す面。
 *
 * 出さないのは 2 通りだけである。**お客様が目の前に立つ面**（受け付ける面・
 * 予約の 5 工程）と、**お知らせそのもの**。承認済みモックの上のバーが
 * 店名だけなのはその判断だと読める（`RECEPTION-CHECKIN.png`）。
 *
 * 受付履歴・予約を探すは店員だけが見る面なので出す。ここを外していたころ、
 * その 2 面には**お知らせへ行く道が 1 つも無かった** —— 左の柱の「お知らせ」は
 * `current === 'alerts'`、つまり**すでに開いているときだけ**現れる作りで、
 * 行きたいときには無かった（UX 監査 J-02）。
 *
 * 来店受付（`reception`）はまだ出せない。**受け付ける面が同じ行き先の中にある**ので、
 * ここへ入れるとお客様が目の前に立つ面にも通知が出てしまう（承認済みモック
 * `RECEPTION-CHECKIN.png` の上のバーは店名だけ）。盤と受け付ける面を器が
 * 区別できるようにしてから足す。
 */
const HEADER_ALERT_DESTINATIONS = new Set([
  'home',
  'ledger',
  'history',
  'search',
  'customers',
  'settings',
])

/*
 * 業務画面の骨格。承認済みモック（docs/frontend/mockups/eye）の実測に合わせる。
 *   上のバー 64px（店名・日付・お知らせだけ）
 *   左サイドバー 216px / たたむと 76px（行き先はすべてここ）
 * 触れるものは 44pt 以上（Apple HIG）。色はすべて packages/ui のトークン経由。
 */

export type AppShellProps = {
  storeName: string
  /** ほかのお店。空なら店名は押せる形にしない（押して何も起きないボタンを置かない）。 */
  stores?: readonly { id: string; name: string }[]
  /** お店を切り替える。渡さなければ店名はただの文字のまま。 */
  onSwitchStore?: (storeId: string) => void
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
  /** 自動ロックなど、器全体を覆うモーダル。 */
  overlay?: ReactNode
  /** 共有端末のロック中は、ダイアログ以外をキーボード操作から除外する。 */
  isLocked?: boolean
  children: ReactNode
}

export function AppShell({
  storeName,
  stores = [],
  onSwitchStore,
  storeSubline,
  current,
  onNavigate,
  rail,
  onToggleRail,
  alertCount = 0,
  terminalNote,
  barCenter,
  barActions,
  overlay,
  isLocked = false,
  children,
}: AppShellProps) {
  const [storeMenuOpen, setStoreMenuOpen] = useState(false)
  const otherStores = onSwitchStore === undefined ? [] : stores
  // 面が変わったら畳む（開いたまま別の面へ持ち越さない）。
  useEffect(() => {
    setStoreMenuOpen(false)
  }, [current])

  return (
    <div className="relative flex h-dvh flex-col bg-paper text-ink">
      <header
        inert={isLocked ? true : undefined}
        className="flex h-16 shrink-0 items-center gap-4 bg-pine px-4 text-on-pine"
      >
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
        {/*
          店名は**お店を切り替える入口**でもある。以前はトップのチップからしか
          切り替えられず、台帳や受付を開いている最中はいちどトップへ戻る必要があった
          （実装不足の洗い出し foundation-09。US-FOUND-06）。
          ほかのお店が 1 つも無い組織では、押しても何も起きないボタンを置かない。
        */}
        {otherStores.length === 0 ? (
          <div className="min-w-0">
            <p className="truncate text-bar font-bold">{storeName}</p>
            <p className="truncate text-note opacity-90">{storeSubline}</p>
          </div>
        ) : (
          <div className="relative min-w-0">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={storeMenuOpen}
              aria-label={`${storeName}　お店を切り替える`}
              onClick={() => setStoreMenuOpen((open) => !open)}
              className={cn(
                'flex min-h-12 min-w-0 items-center gap-1.5 rounded-card px-1 text-left',
                focusRingOnPine,
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-bar font-bold">{storeName}</span>
                <span className="block truncate text-note opacity-90">{storeSubline}</span>
              </span>
              <span aria-hidden="true" className="shrink-0 text-note opacity-90">
                ▾
              </span>
            </button>
            {storeMenuOpen && (
              <ul
                aria-label="ほかのお店"
                className="absolute top-full left-0 z-30 mt-1 grid min-w-64 gap-1 rounded-panel border border-line bg-surface p-2 text-ink shadow-lg"
              >
                {otherStores.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setStoreMenuOpen(false)
                        onSwitchStore?.(row.id)
                      }}
                      className={cn(
                        'flex min-h-12 w-full items-center rounded-ctl px-3 text-left text-body font-semibold',
                        focusRing,
                      )}
                    >
                      {`${row.name}へ切り替える`}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {barCenter}
        <div className="ml-auto flex items-center gap-2">
          {HEADER_ALERT_DESTINATIONS.has(current) && alertCount > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('alerts')}
              aria-label={`お知らせ ${alertCount}件`}
              className={`grid min-h-12 place-items-center gap-0 rounded-card px-3 text-lead font-semibold leading-tight ${focusRingOnPine}`}
            >
              <span>お知らせ</span>
              <span className="min-w-5.5 rounded-full bg-danger px-1.5 text-center text-note font-bold leading-tight text-on-danger">
                {alertCount}
              </span>
            </button>
          )}
          {barActions}
        </div>
      </header>

      {/* 幅は任意値で書かない。--spacing の刻みで 76px（w-19）/ 216px（w-54）を作る。 */}
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="画面の切り替え"
          inert={isLocked ? true : undefined}
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

          {/*
            「トップ」の行はトップにいるときだけ置く。承認済みモックの柱は
            `HOME.png` にしか この行を持たず、ほかの面（`LEDGER-STAFF.html` ほか）は
            「＋ 予約を取る」から始まる。ほかの面からトップへ戻る道は上のバーの
            ⌂（`aria-label="トップへ"`）である。全画面に置いていたころ、行き先が
            1 つ多く、押しても「いまいる場所」に見えない行が柱の頭に居座っていた
            （実装不足の洗い出し foundation-03）。
          */}
          {current === 'home' && (
            <NavItem
              destination={HOME_DESTINATION}
              rail={rail}
              current={current}
              onNavigate={onNavigate}
              alertCount={alertCount}
            />
          )}

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

          {current === 'alerts' && (
            <NavItem
              destination={ALERT_DESTINATION}
              rail={rail}
              current={current}
              onNavigate={onNavigate}
              alertCount={alertCount}
            />
          )}

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
      {overlay}
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
      aria-label={
        destination.key === 'alerts' && alertCount > 0
          ? `お知らせ ${alertCount}件`
          : destination.label
      }
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
      {!rail && destination.key === 'alerts' && alertCount > 0 && (
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
