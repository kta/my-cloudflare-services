import { expect, test } from 'vitest'
import { barFor, barOverlay } from './app-chrome'
import type { StaffLocation } from './staff-navigation'

/** タブは並び順まで意味を持つので、ラベルの列として読む。 */
function tabs(location: StaffLocation) {
  return barFor(location, store, '2026-08-27').tabs.map((tab) => tab.label)
}

const store = { name: '銀座店', isActive: true }

test('業務画面は面ごとに違うタブを出す（モックの実測どおり）', () => {
  expect(tabs({ screen: 'ledger', date: '2026-08-27' })).toEqual([
    '予約台帳',
    '来店受付',
    '受付履歴',
    '顧客台帳',
  ])
  expect(tabs({ screen: 'journey' })).toEqual(['予約台帳', '来店受付', '顧客台帳'])
  expect(tabs({ screen: 'reservation-search' })).toEqual(['予約台帳', '予約検索', '顧客台帳'])
  expect(tabs({ screen: 'customers' })).toEqual(['予約台帳', '予約検索', '顧客台帳'])
})

test('主操作は面ごとに文言まで変わる', () => {
  expect(barFor({ screen: 'ledger', date: '2026-08-27' }, store, '2026-08-27').primary?.label).toBe(
    '＋ 予約を取る',
  )
  // 来店受付の主操作は予約ではなく店頭客の受付である。
  expect(barFor({ screen: 'journey' }, store, '2026-08-27').primary?.label).toBe(
    '＋ 店頭のお客様を受付',
  )
  expect(barFor({ screen: 'customers' }, store, '2026-08-27').primary).toBeUndefined()
})

test('予約フローはタブも主操作も持たず、副題が工程を名乗る', () => {
  const bar = barFor({ screen: 'booking' }, store, '2026-08-27')
  expect(bar.tabs).toEqual([])
  expect(bar.primary).toBeUndefined()
  expect(bar.subtitle).toBe('銀座店 · 新規予約')
})

test('運用面は管理タブを 76px バーの中に持つ', () => {
  expect(tabs({ screen: 'audit' })).toEqual(['端末とセキュリティ', '利用者とロール', '監査ログ'])
  expect(barFor({ screen: 'audit' }, store, '2026-08-27').subtitle).toBe('銀座店 · 設定')
})

test('ホームだけが お知らせ / アラート / 設定 を出す', () => {
  const bar = barFor({ screen: 'home' }, store, '2026-08-27')
  expect(bar.kind).toBe('home')
  expect(bar.subtitle).toBe('銀座店 · 営業中')
})

test('受付停止の店舗はホームの副題でそう名乗る', () => {
  expect(
    barFor({ screen: 'home' }, { name: '銀座店', isActive: false }, '2026-08-27').subtitle,
  ).toBe('銀座店 · 受付停止')
})

test('受付履歴と検索は副題で対象を名乗る', () => {
  expect(barFor({ screen: 'reception-history' }, store, '2026-08-27').subtitle).toBe(
    '銀座店 · 受付履歴',
  )
  expect(barFor({ screen: 'reservation-search' }, store, '2026-08-27').subtitle).toBe(
    '銀座店 · 検索対象店舗',
  )
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

test('設定ガイドは、そこから出られるようバーにタブを持つ', () => {
  /*
   * 承認済みモックが 2 つあり、バーの中身が食い違っている。
   * `settings-complete-approved.html` はワードマークだけ、
   * `settings-approved.html` は `設定ガイド / 設定一覧 / 変更履歴` の 3 つ。
   * 操作を 1 つも持たない側を採ると、ガイドに入ったら出られなくなるので、
   * タブを持つ側に従う。
   */
  expect(tabs({ screen: 'settings' })).toEqual(['設定ガイド', '設定一覧', '変更履歴'])
})

test('設定と運用の面は、すべて 2 本目の帯なしで辿り着ける', () => {
  /*
   * 承認済みモックは緑帯を 1 本しか持たない。面から面への行き来はバーのタブと
   * 各面の左サイドが担うので、どれか 1 つでも入口を失うと到達できない画面が
   * できる。ここでバーのタブだけを辿り、閉じた集合になっているかを見る。
   * 左サイドからしか行けない面は、その面のテストが押さえる。
   */
  const store = { name: '銀座店', isActive: true }
  const seen = new Set<StaffLocation['screen']>()
  const queue: StaffLocation[] = [{ screen: 'settings' }]
  while (queue.length > 0) {
    const location = queue.shift() as StaffLocation
    if (seen.has(location.screen)) continue
    seen.add(location.screen)
    for (const tab of barFor(location, store, '2026-08-27').tabs) queue.push(tab.to)
  }
  expect([...seen].sort()).toEqual(['attention-settings', 'audit', 'settings', 'shared-terminals'])
})
