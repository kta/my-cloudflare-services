import { cn } from '@app/ui'
import type { ReactNode } from 'react'

/*
 * 画面上端の緑バー。承認済みモック `.bar` の実測がここでの正である。
 *
 *   .bar{height:76px;background:var(--g);color:#fff;
 *        display:flex;align-items:center;gap:12px;padding:0 20px}
 *   .brand{font-size:19px;font-weight:700}.brand small{display:block}
 *   .bar button{min-height:44px;min-width:44px;border:0;border-radius:8px;
 *               padding:0 14px;background:transparent;color:#fff}
 *   .bar .on,.bar .primary{background:#fff;color:var(--g);font-weight:700}
 *   .push{margin-left:auto}
 *
 * バーは 1 本だけで、タブ・主操作・副題は面ごとに入れ替わる。2 本目の帯は作らない。
 *
 * モックには方言が 2 つある。予約フロー側（`approved.html`）はワードマークが
 * 20px・間隔 18px・左右 22px で、バーの操作に白い細枠が付く。業務と運用側
 * （`staff-approved.html` / `operations-approved.html`）は 19px・12px・20px で
 * 枠を持たない。どちらで描くかは面が決めるので `variant` で受ける。
 */

export type BarVariant = 'booking' | 'workspace'

/** バーの中の操作。透明な地に白文字、選択中だけ白いピルになる。 */
export function BarButton({
  children,
  on = false,
  outline = false,
  current = false,
  variant = 'workspace',
  onClick,
}: {
  children: ReactNode
  variant?: BarVariant
  /** 選択中のタブ、または主操作（モックの `.on` / `.primary`）。 */
  on?: boolean
  /** モック `#home` のバーだけが持つ白い細枠。 */
  outline?: boolean
  /** 選択中のタブは色だけでなく aria-current でも示す。 */
  current?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'min-h-11 min-w-11 rounded-ctl font-sans text-body',
        // 予約フロー側のバーだけ内側が 16px、業務・運用側は 14px。
        variant === 'booking' ? 'px-4' : 'px-3.5',
        on
          ? 'bg-surface font-bold text-pine'
          : outline
            ? 'border border-pine-hairline font-bold text-on-pine'
            : 'bg-transparent text-on-pine',
      )}
    >
      {children}
    </button>
  )
}

/** ワードマーク。2 行目は「今どの店舗の、どの面にいるか」を名乗る。 */
export function Wordmark({
  subtitle,
  variant = 'workspace',
  onClick,
}: {
  subtitle: string
  variant?: BarVariant
  /** モックでは飾りに見えるが、店舗切替の入口はここしかない。 */
  onClick?: () => void
}) {
  const size = variant === 'booking' ? 'text-brand' : 'text-bar'
  const inner = (
    <>
      EYEX予約
      {/*
       * 副題の寸法は方言で違う。予約フロー側（approved.html）は
       * `.store{font-size:13px}` と明示するが、業務・運用側（staff /
       * operations / settings）は `.brand small` に寸法が無く、ブラウザ既定の
       * `smaller`（19px の 1 段下 ≒ 15.8px）で描かれる。業務側をここで 13px へ
       * 揃えると副題の幅が縮み、右のタブが丸ごと左へずれる。
       */}
      <small className={cn('block', variant === 'booking' && 'text-note')}>{subtitle}</small>
    </>
  )
  if (!onClick) return <p className={cn('font-bold font-sans text-on-pine', size)}>{inner}</p>
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('min-h-11 rounded-ctl text-left font-bold font-sans text-on-pine', size)}
    >
      {inner}
    </button>
  )
}

/** 76px の緑バー本体。 */
export function AppBar({
  children,
  variant = 'workspace',
}: {
  children: ReactNode
  variant?: BarVariant
}) {
  return (
    <header
      className={cn(
        'flex h-19 shrink-0 items-center bg-pine text-on-pine',
        variant === 'booking' ? 'gap-4.5 px-5.5' : 'gap-3 px-5',
      )}
    >
      {children}
    </header>
  )
}

/** バーの右端へ寄せる（モックの `.push`）。間隔はバーの方言に従う。 */
export function BarPush({
  children,
  variant = 'workspace',
}: {
  children: ReactNode
  variant?: BarVariant
}) {
  return (
    <div className={cn('ml-auto flex items-center', variant === 'booking' ? 'gap-4.5' : 'gap-3')}>
      {children}
    </div>
  )
}

/*
 * 例外・回復状態のバーは操作を持たず、文字だけを置く。
 *   .bar{height:76px;padding:16px 22px;font-size:19px;font-weight:700}
 *   .bar small{display:block;font-size:13px}
 */
export function PlainBar({ subtitle }: { subtitle: string }) {
  return (
    <header className="h-19 shrink-0 bg-pine px-5.5 py-4 font-bold font-sans text-bar text-on-pine">
      EYEX予約
      <small className="block text-note">{subtitle}</small>
    </header>
  )
}

/**
 * 画面の外枠。バーの下に、残り全部を占める領域をひとつ置く。
 *
 * モックの `.ipad` は高さ 832px（外枠 9px 込み）で、中身は 814px。アプリは
 * 実機の画面いっぱいに描くので `h-dvh` を土台にする。
 */
export function Screen({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh min-h-0 flex-col bg-paper text-ink">{children}</div>
}

/** バーの下の領域。面ごとに自前でスクロールを持つのでここでは切らない。 */
export function ScreenBody({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>
}

/*
 * 端末モック（`reception-history-approved.html` / `store-switch-approved.html`）
 * の外枠。この 2 面だけ寸法体系が違うので、上のクロムとは別に持つ。
 *
 *   body{font-family:'IBM Plex Sans JP'}      ← 行間の指定が無い＝normal
 *   .screen{background:var(--p)}
 *   .status{height:25px;padding:5px 16px;display:flex;
 *           justify-content:space-between;background:#fbfcfb;
 *           font:600 10px 'IBM Plex Mono'}
 *   .bar{height:67px;background:var(--g);color:#fff;display:flex;
 *        align-items:center;padding:0 18px;gap:10px}
 *   .brand{font-size:18px;font-weight:700}
 *   .brand small{display:block;font-size:10px;font-weight:400}
 *   .nav{height:42px;border:0;background:transparent;color:#d9ebe3;
 *        padding:0 11px;border-radius:8px}
 *   .nav.on{background:#fff;color:var(--g);font-weight:700}
 *   .primary{height:42px;border-radius:8px;background:#fff;color:var(--g);
 *            padding:0 14px;font-weight:700}
 */

/** 端末モックの画面。行間はブラウザ既定（normal）で、1.5 ではない。 */
export function TerminalScreen({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex h-dvh min-h-0 flex-col bg-terminal-paper font-sans text-terminal-ink"
      // モックの body は line-height を指定していない。1.5 を当てると
      // 10〜11px の本文が 1 行あたり 2〜3px 伸び、カードの高さが全部狂う。
      style={{ lineHeight: 'normal' }}
    >
      {children}
    </div>
  )
}

/** iOS のステータスバー。端末そのものの絵なので操作を持たない。 */
export function StatusBar({ time }: { time: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 justify-between bg-terminal-status font-figure font-semibold text-terminal-note"
      style={{ height: '25px', padding: '5px 16px' }}
    >
      <span>{time}</span>
      <span>{'Wi‑Fi　● 100%'}</span>
    </div>
  )
}

/** 67px の緑バー。 */
export function TerminalBar({ children }: { children: ReactNode }) {
  return (
    <header
      className="flex shrink-0 items-center bg-terminal-pine text-on-pine"
      style={{ height: '67px', padding: '0 18px', gap: '10px' }}
    >
      {children}
    </header>
  )
}

/** 端末モックのワードマーク。副題は 10px・太字を継がない。 */
export function TerminalWordmark({ subtitle }: { subtitle?: string }) {
  return (
    <p className="font-bold text-lead">
      EYEX予約
      {subtitle !== undefined && (
        <small className="block font-normal text-terminal-note">{subtitle}</small>
      )}
    </p>
  )
}

/** 端末モックのタブ。選択中だけ白いピルになる。 */
export function TerminalNav({ children, on = false }: { children: ReactNode; on?: boolean }) {
  return (
    <button
      type="button"
      aria-current={on ? 'page' : undefined}
      className={cn(
        'rounded-ctl border-0',
        on ? 'bg-surface font-bold text-terminal-pine' : 'bg-transparent text-terminal-nav',
      )}
      style={{ height: '42px', padding: '0 11px' }}
    >
      {children}
    </button>
  )
}

/** 端末モックの主操作。バーの右端へ寄る。 */
export function TerminalPrimary({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="ml-auto rounded-ctl border-0 bg-surface font-bold text-terminal-pine"
      style={{ height: '42px', padding: '0 14px' }}
    >
      {children}
    </button>
  )
}
