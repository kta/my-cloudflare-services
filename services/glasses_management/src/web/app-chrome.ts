import type { StaffLocation } from './staff-navigation'

/*
 * 76px の緑バーの中身は面ごとに違う。承認済みモックの実測がここでの正である。
 *
 * - `staff-approved.html` の #ledger / #journey / #search / #customer は、
 *   タブの本数も主操作の文言も面ごとに違う（来店受付の主操作は「予約を取る」
 *   ではなく「店頭のお客様を受付」）。
 * - `operations-approved.html` は管理タブをバーの中に持つ。2 本目の緑帯は無い。
 * - 予約フローと設定ガイドはバーに操作を持たない。副題だけが今どこかを名乗る。
 */

export type BarTab = { label: string; to: StaffLocation }

export type BarSpec = {
  /** `home` だけが お知らせ / アラート / 設定 の 3 つを出す。 */
  kind: 'home' | 'business' | 'plain'
  /** ワードマークの 2 行目。 */
  subtitle: string
  tabs: BarTab[]
  primary?: { label: string; to: StaffLocation }
}

type StoreSummary = { name: string; isActive: boolean }

/** 運用面の管理タブ。モック `operations-approved.html` の 3 つと、その順序。 */
const OPERATION_SCREENS = new Set<StaffLocation['screen']>([
  'shared-terminals',
  'audit',
  'recording-ops',
  'attention-settings',
  'attention-review',
  'customer-merge',
  'analytics',
  'alerts',
])

export function barFor(
  location: StaffLocation,
  store: StoreSummary,
  today: string | undefined,
): BarSpec {
  const ledger: StaffLocation = { screen: 'ledger', date: today ?? '' }
  const name = store.name
  const tab = (label: string, to: StaffLocation): BarTab => ({ label, to })

  switch (location.screen) {
    case 'home':
      return {
        kind: 'home',
        subtitle: `${name} · ${store.isActive ? '営業中' : '受付停止'}`,
        tabs: [],
      }
    case 'booking':
      return { kind: 'plain', subtitle: `${name} · 新規予約`, tabs: [] }
    case 'settings':
      return { kind: 'plain', subtitle: `${name} · 設定ガイド`, tabs: [] }
    case 'ledger':
      return {
        kind: 'business',
        subtitle: `${name} · ${store.isActive ? '営業中' : '受付停止'}`,
        tabs: [
          tab('予約台帳', ledger),
          tab('来店受付', { screen: 'journey' }),
          tab('受付履歴', { screen: 'reception-history' }),
          tab('顧客台帳', { screen: 'customers' }),
        ],
        primary: { label: '＋ 予約を取る', to: { screen: 'booking' } },
      }
    case 'journey':
      return {
        kind: 'business',
        subtitle: `${name} · 来店受付`,
        tabs: [
          tab('予約台帳', ledger),
          tab('来店受付', { screen: 'journey' }),
          tab('顧客台帳', { screen: 'customers' }),
        ],
        // 店頭に立っているお客様を通す面なので、主操作は予約ではない。
        primary: { label: '＋ 店頭のお客様を受付', to: { screen: 'journey' } },
      }
    case 'reception-history':
      return {
        kind: 'business',
        subtitle: `${name} · 受付履歴`,
        tabs: [
          tab('予約台帳', ledger),
          tab('来店受付', { screen: 'journey' }),
          tab('受付履歴', { screen: 'reception-history' }),
          tab('顧客台帳', { screen: 'customers' }),
        ],
      }
    case 'reservation-search':
    case 'customers':
      return {
        kind: 'business',
        subtitle: location.screen === 'customers' ? `${name} · 顧客台帳` : `${name} · 検索対象店舗`,
        tabs: [
          tab('予約台帳', ledger),
          tab('予約検索', { screen: 'reservation-search' }),
          tab('顧客台帳', { screen: 'customers' }),
        ],
      }
    case 'reservation-detail':
      return { kind: 'plain', subtitle: `${name} · 予約`, tabs: [] }
    default:
      break
  }

  if (OPERATION_SCREENS.has(location.screen))
    return {
      kind: 'business',
      subtitle: `${name} · 設定`,
      tabs: [
        tab('端末とセキュリティ', { screen: 'shared-terminals' }),
        tab('利用者とロール', { screen: 'settings' }),
        tab('監査ログ', { screen: 'audit' }),
      ],
    }

  return { kind: 'plain', subtitle: `${name} · 営業中`, tabs: [] }
}

/* ------------------------------------------------------------------ *
 * 面からバーへ書き込む値
 * ------------------------------------------------------------------ */

/**
 * モックのバーは、予約フローでは工程に応じて右のチップと副題が変わる
 * (`BOOK-TIME` の `8月27日`、`BOOK-REPEAT` の `銀座店 · 最終確認` かつチップ無し)。
 * 面が持つ下書きに依存する値なので、`barFor` では決められない。面が書き、
 * バーが読む小さな置き場をひとつだけ用意する。
 */
export type BarOverlay = { chip?: string; subtitle?: string }

function createBarOverlay() {
  let current: BarOverlay = {}
  const listeners = new Set<() => void>()
  return {
    snapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next: BarOverlay) {
      // 同じ値で起こすと、面の描画ごとにバーが揺れる。
      if (next.chip === current.chip && next.subtitle === current.subtitle) return
      current = next
      for (const listener of listeners) listener()
    },
  }
}

export const barOverlay = createBarOverlay()
