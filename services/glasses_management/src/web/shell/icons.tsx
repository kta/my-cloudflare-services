/*
 * サイドバーの線画アイコン。承認済みモック（docs/frontend/mockups/eye）の
 * `data-icon` と 1 対 1 で対応する。外部アセットを持たず、線の色は
 * `currentColor` に従うので、選択中（緑地に白）でもそのまま反転する。
 */
import type { ReactElement, SVGProps } from 'react'

export type IconName =
  | 'home'
  | 'ledger'
  | 'reception'
  | 'search'
  | 'history'
  | 'customer'
  | 'analytics'
  | 'settings'
  | 'alerts'
  | 'add'
  | 'collapse'

const PATHS: Record<IconName, ReactElement> = {
  home: <path d="M3.5 10.5 12 4l8.5 6.5V20h-17z" />,
  ledger: (
    <>
      <path d="M4 5h16v15H4z" />
      <path d="M4 10h16M9 5v15M14.5 5v15" />
    </>
  ),
  reception: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  history: <path d="M4 7h16M4 12h11M4 17h7" />,
  customer: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" />
    </>
  ),
  analytics: (
    <>
      <path d="M3 19h18" />
      <path d="m3 16 5.5-8 4 5L16 8.5 21 16" />
    </>
  ),
  settings: (
    <>
      <path d="M4 8h16M4 16h16" />
      <circle cx="9" cy="8" r="2.3" />
      <circle cx="15.5" cy="16" r="2.3" />
    </>
  ),
  alerts: (
    <>
      <path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z" />
      <path d="M10 20.5h4" />
    </>
  ),
  add: <path d="M12 5v14M5 12h14" />,
  collapse: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9 4.5v15" />
      <path d="m16.5 9.5-3 2.5 3 2.5" />
    </>
  ),
}

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'add' ? 2 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {PATHS[name]}
    </svg>
  )
}
