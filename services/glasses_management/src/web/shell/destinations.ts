import type { IconName } from './icons'

/**
 * 左サイドバーが持つ行き先。承認済みモック（docs/frontend/mockups/eyex）の
 * サイドバーと同じ並びで、上が日常業務、下が「お店の運用」。
 */
export type Destination = {
  key: string
  label: string
  icon: IconName
  /** 「お店の運用」の見出しの下に置くもの */
  group?: 'operations'
}

/** 「＋ 予約を取る」より上に置く、いちばん上の行き先（モックの並び）。 */
export const HOME_DESTINATION: Destination = { key: 'home', label: 'トップ', icon: 'home' }

/**
 * お知らせ（ALERTS）。**この面を開いているときだけ**サイドバーに出す
 * （承認済みモック 68 枚がそうなっている）。ほかの画面の入口は上のバーのボタン。
 */
export const ALERTS_DESTINATION: Destination = { key: 'alerts', label: 'お知らせ', icon: 'alerts' }

/** 「＋ 予約を取る」より下に並ぶ行き先。 */
export const DESTINATIONS: readonly Destination[] = [
  { key: 'ledger', label: '予約台帳', icon: 'ledger' },
  { key: 'reception', label: '来店受付', icon: 'reception' },
  // 行き先の名前は「予約を探す」。面の名前（上のバーの「予約を変更する」）とは
  // 別の 2 段として持つ（`design/05-screen-flow.md` §2.2）。モックの
  // 「予約を検索」は §8 の既知差分で、モックの画像は直さない。
  { key: 'search', label: '予約を探す', icon: 'search' },
  { key: 'history', label: '受付履歴', icon: 'history' },
  { key: 'customers', label: '顧客台帳', icon: 'customer' },
  { key: 'analytics', label: '分析', icon: 'analytics', group: 'operations' },
  { key: 'settings', label: '設定', icon: 'settings', group: 'operations' },
]

/** 横に広い画面は、たたんだ細い柱（アイコンだけ）を既定にする。 */
export const RAIL_BY_DEFAULT: ReadonlySet<string> = new Set([
  'ledger',
  'reception',
  'customers',
  'analytics',
  'settings',
])
