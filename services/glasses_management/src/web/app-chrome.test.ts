import { expect, test } from 'vitest'
import { barFor, barOverlay, sidebarFor } from './app-chrome'

const store = { name: '銀座店', isActive: true }

test('主操作は面ごとに文言まで変わる', () => {
  expect(barFor({ screen: 'ledger', date: '2026-08-27' }, store).primary?.label).toBe(
    '＋ 予約を取る',
  )
  // 来店受付の主操作は予約ではなく店頭客の受付である。
  expect(barFor({ screen: 'journey' }, store).primary?.label).toBe('＋ 店頭のお客様を受付')
  expect(barFor({ screen: 'customers' }, store).primary).toBeUndefined()
})

test('予約フローはタブも主操作も持たず、副題が工程を名乗る', () => {
  const bar = barFor({ screen: 'booking' }, store)
  expect(bar.tabs).toEqual([])
  expect(bar.primary).toBeUndefined()
  expect(bar.subtitle).toBe('銀座店 · 新規予約')
})

test('ホームだけが お知らせ / アラート / 設定 を出す', () => {
  const bar = barFor({ screen: 'home' }, store)
  expect(bar.kind).toBe('home')
  expect(bar.subtitle).toBe('銀座店 · 営業中')
})

test('受付停止の店舗はホームの副題でそう名乗る', () => {
  expect(barFor({ screen: 'home' }, { name: '銀座店', isActive: false }).subtitle).toBe(
    '銀座店 · 受付停止',
  )
})

test('受付履歴と検索は副題で対象を名乗る', () => {
  expect(barFor({ screen: 'reception-history' }, store).subtitle).toBe('銀座店 · 受付履歴')
  expect(barFor({ screen: 'reservation-search' }, store).subtitle).toBe('銀座店 · 検索対象店舗')
})

/* ------------------------------------------------------------------ *
 * バーへ面から書き込む値（チップ・副題の上書き）
 * ------------------------------------------------------------------ */

test('面はバーのチップと副題を上書きでき、離れると元へ戻る', () => {
  const seen: ReturnType<typeof barOverlay.snapshot>[] = []
  const stop = barOverlay.subscribe(() => seen.push(barOverlay.snapshot()))

  barOverlay.set({ chip: '8月27日 11:00', subtitle: '銀座店 · 最終確認' })
  expect(barOverlay.snapshot()).toEqual({ chip: '8月27日 11:00', subtitle: '銀座店 · 最終確認' })

  barOverlay.set({})
  expect(barOverlay.snapshot()).toEqual({})
  expect(seen).toHaveLength(2)
  stop()
})

test('同じ値の書き込みでは購読者を起こさない', () => {
  barOverlay.set({})
  let woken = 0
  const stop = barOverlay.subscribe(() => {
    woken += 1
  })
  barOverlay.set({ chip: '8月27日' })
  barOverlay.set({ chip: '8月27日' })
  expect(woken).toBe(1)
  stop()
  barOverlay.set({})
})

test('受付履歴と予約検索でも、その場で予約を取れる', () => {
  /*
   * `reception-history-approved.html` / `staff-approved.html#reservation-search`
   * のバーは、どちらも `＋ 予約を取る` を右肩に持つ。電話を受けながら履歴や
   * 検索を見ている最中に「では予約を」と言われる面なので、主操作をここで
   * 落とすと台帳へ戻ってからでないと予約が取れない。
   */
  expect(barFor({ screen: 'reception-history' }, store).primary?.label).toBe('＋ 予約を取る')
  expect(barFor({ screen: 'reservation-search' }, store).primary?.label).toBe('＋ 予約を取る')
  // 顧客台帳はモックに主操作が無い。検索と同じ枝に置いて巻き込まない。
  expect(barFor({ screen: 'customers' }, store).primary).toBeUndefined()
})

/* ------------------------------------------------------------------ *
 * 全画面共通の左サイドバー
 * ------------------------------------------------------------------ */

test('サイドバーは業務と設定・運用を分けて、すべての面を 1 か所に並べる', () => {
  const groups = sidebarFor('2026-08-27')
  expect(groups.map((group) => group.label)).toEqual(['業務', '設定・運用'])
  expect(groups[0]?.items.map((item) => item.label)).toEqual([
    '予約台帳',
    '来店受付',
    '受付履歴',
    '予約検索',
    '顧客台帳',
  ])
  expect(groups[1]?.items.map((item) => item.label)).toEqual([
    '設定ガイド',
    '共有端末',
    '録音運用',
    '注意事項',
    '監査ログ',
    '顧客の統合・訂正',
    '分析',
    'お知らせ',
  ])
})

test('サイドバーからすべての面へ 1 手で行ける', () => {
  /*
   * 到達性をここで閉じる。タブと節ナビを渡り歩かないと辿り着けない面が
   * 残ると、利用者はその面を「無い」と受け取る。
   */
  const reachable = new Set(
    sidebarFor('2026-08-27').flatMap((group) => group.items.map((item) => item.to.screen)),
  )
  expect([...reachable].sort()).toEqual([
    'alerts',
    'analytics',
    'attention-settings',
    'audit',
    'customer-merge',
    'customers',
    'journey',
    'ledger',
    'reception-history',
    'recording-ops',
    'reservation-search',
    'settings',
    'shared-terminals',
  ])
})

test('サイドバーが面を持つので、バーはタブを持たない', () => {
  // 同じ移動の手段を 2 つ置くと、どちらが正なのかが読めなくなる。
  const store = { name: '銀座店', isActive: true }
  for (const location of [
    { screen: 'ledger', date: '2026-08-27' },
    { screen: 'journey' },
    { screen: 'audit' },
    { screen: 'settings' },
  ] as const)
    expect(barFor(location, store).tabs).toEqual([])
})
