import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { App } from './App'
import { createSharedTerminalController } from './shared-terminal'
import { createStaffNavigation } from './staff-navigation'
import { createStoreSwitchController } from './store-switch'

test('店舗が注入されていないときは、日本語で「店舗未選択」だけを言う', () => {
  const { container } = render(<App />)

  expect(
    screen.getByRole('heading', { name: '作業する店舗が選ばれていません' }),
  ).toBeInTheDocument()
  // 開発中の英語メモを製品の面に残さない（ワードマークの EYEX だけが欧字）。
  expect((container.textContent ?? '').replace('EYEX', '')).not.toMatch(/[A-Za-z]/)
})

/*
 * 承認済みモック `store-switch-approved.html` の切替シート。名前・副題・状態語
 * の 3 つが 1 行に揃っていること、末尾の但し書きが残っていることまで見る。
 * どれも「切り替えてよいか」を押す前に読ませるためのもので、飾りではない。
 */
test('切替シートはモックどおり見出し・検索欄・副題つきの店舗行・境界の但し書きを持つ', () => {
  const controller = createStoreSwitchController(
    { id: 'store-a', name: '銀座店', isActive: true },
    async () => true,
  )
  render(
    <App
      storeSwitchController={controller}
      accessibleStores={[
        { id: 'store-a', name: '銀座店', isActive: true, openAlerts: 2 },
        { id: 'store-b', name: '丸の内店', isActive: true, isAssigned: true },
        { id: 'store-c', name: '新宿店', isActive: false, suspendedReason: '設備点検中' },
      ]}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /EYEX予約/ }))
  const sheet = screen.getByRole('dialog', { name: '作業する店舗を切り替える' })
  expect(within(sheet).getByLabelText('店舗名で検索')).toBeInTheDocument()
  expect(within(sheet).getByRole('button', { name: /^銀座店/ })).toHaveTextContent(
    '銀座店営業中 · 警告2件選択中',
  )
  expect(within(sheet).getByRole('button', { name: /^丸の内店/ })).toHaveTextContent(
    '丸の内店担当店舗営業中',
  )
  expect(within(sheet).getByRole('button', { name: /^新宿店/ })).toHaveTextContent(
    '新宿店設備点検中受付停止',
  )
  expect(sheet).toHaveTextContent(
    '他店舗の空き枠はここに表示しません。切替後、その店舗の予約台帳で確認してください。',
  )
})

test('切替シートの検索欄は店舗名だけで絞り込む', () => {
  const controller = createStoreSwitchController(
    { id: 'store-a', name: '銀座店', isActive: true },
    async () => true,
  )
  render(
    <App
      storeSwitchController={controller}
      accessibleStores={[
        { id: 'store-a', name: '銀座店', isActive: true },
        { id: 'store-b', name: '丸の内店', isActive: true, isAssigned: true },
      ]}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /EYEX予約/ }))
  fireEvent.change(screen.getByLabelText('店舗名で検索'), { target: { value: '丸の内' } })
  const sheet = screen.getByRole('dialog', { name: '作業する店舗を切り替える' })
  expect(within(sheet).getByRole('button', { name: /^丸の内店/ })).toBeInTheDocument()
  expect(within(sheet).queryByRole('button', { name: /^銀座店/ })).toBeNull()
  // 副題の語では絞らない（「担当店舗」で消えないこと）。
  fireEvent.change(screen.getByLabelText('店舗名で検索'), { target: { value: '担当店舗' } })
  expect(within(sheet).queryByRole('button', { name: /店$/ })).toBeNull()
})

test('hides shared-terminal customer state immediately when the page leaves the foreground', () => {
  const controller = createSharedTerminalController({
    now: () => Date.parse('2026-08-31T00:00:00.000Z'),
    setTimeout,
    clearTimeout,
  })
  controller.start({
    token: 'terminal-token',
    terminalId: 'terminal-a',
    storeId: 'store-a',
    expiresAt: '2026-09-01T00:00:00.000Z',
    idleTimeoutSeconds: 120,
  })
  controller.setDailyState({ selectedCustomerId: 'customer-a', searchDraft: '田中花子' })
  render(<App sharedTerminalController={controller} />)

  act(() => window.dispatchEvent(new Event('pagehide')))

  expect(screen.getByRole('heading', { name: '顧客情報を隠しました' })).toBeInTheDocument()
  expect(screen.queryByText('田中花子')).not.toBeInTheDocument()
})

test('confirms discard before switching a staff workspace with unfinished input', async () => {
  const controller = createStoreSwitchController(
    { id: 'store-a', name: '銀座店', isActive: true },
    async () => true,
  )
  controller.setDraftState({ search: '田中花子' })
  render(
    <App
      storeSwitchController={controller}
      accessibleStores={[
        { id: 'store-a', name: '銀座店', isActive: true },
        { id: 'store-b', name: '丸の内店', isActive: true },
      ]}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /銀座店/ }))
  fireEvent.click(screen.getByRole('button', { name: /^丸の内店/ }))
  expect(screen.getByRole('dialog')).toHaveTextContent('店舗を切り替える前に確認してください')
  fireEvent.click(screen.getByRole('button', { name: '入力を破棄して丸の内店へ切り替える' }))
  await waitFor(() => expect(screen.getByRole('button', { name: /丸の内店/ })).toBeInTheDocument())
})

test('records a clean store switch through the supplied authenticated API boundary', async () => {
  const recordSwitch = vi.fn().mockResolvedValue(true)
  const controller = createStoreSwitchController(
    { id: 'store-a', name: '銀座店', isActive: true },
    recordSwitch,
  )
  render(
    <App
      storeSwitchController={controller}
      accessibleStores={[
        { id: 'store-a', name: '銀座店', isActive: true },
        { id: 'store-b', name: '丸の内店', isActive: true },
      ]}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /銀座店/ }))
  fireEvent.click(screen.getByRole('button', { name: /^丸の内店/ }))

  await waitFor(() => expect(recordSwitch).toHaveBeenCalledWith('store-a', 'store-b'))
})

test('does not discard or switch the workspace when its audit request fails', async () => {
  const recordSwitch = vi.fn().mockResolvedValue(false)
  const controller = createStoreSwitchController(
    { id: 'store-a', name: '銀座店', isActive: true },
    recordSwitch,
  )
  render(
    <App
      storeSwitchController={controller}
      accessibleStores={[
        { id: 'store-a', name: '銀座店', isActive: true },
        { id: 'store-b', name: '丸の内店', isActive: true },
      ]}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /銀座店/ }))
  fireEvent.click(screen.getByRole('button', { name: /^丸の内店/ }))

  await waitFor(() =>
    expect(
      screen.getByText('店舗を切り替えられませんでした。通信を確認してもう一度お試しください。'),
    ).toBeInTheDocument(),
  )
  expect(controller.snapshot().selectedStore.id).toBe('store-a')
})

test('requires the audit boundary and keeps the selected store when it is absent', async () => {
  const controller = createStoreSwitchController(
    { id: 'store-a', name: '銀座店', isActive: true },
    async () => false,
  )
  render(
    <App
      storeSwitchController={controller}
      accessibleStores={[
        { id: 'store-a', name: '銀座店', isActive: true },
        { id: 'store-b', name: '丸の内店', isActive: true },
      ]}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /銀座店/ }))
  fireEvent.click(screen.getByRole('button', { name: /^丸の内店/ }))

  await waitFor(() =>
    expect(
      screen.getByText('店舗を切り替えられませんでした。通信を確認してもう一度お試しください。'),
    ).toBeInTheDocument(),
  )
  expect(controller.snapshot().selectedStore.id).toBe('store-a')
})

test('serializes a pending store audit so a second picker click cannot create another switch', async () => {
  let resolveAudit: ((value: boolean) => void) | undefined
  const recordSwitch = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        resolveAudit = resolve
      }),
  )
  const controller = createStoreSwitchController(
    { id: 'store-a', name: '銀座店', isActive: true },
    recordSwitch,
  )
  render(
    <App
      storeSwitchController={controller}
      accessibleStores={[
        { id: 'store-a', name: '銀座店', isActive: true },
        { id: 'store-b', name: '丸の内店', isActive: true },
      ]}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /銀座店/ }))
  const target = screen.getByRole('button', { name: /^丸の内店/ })
  fireEvent.click(target)
  fireEvent.click(target)
  expect(recordSwitch).toHaveBeenCalledTimes(1)

  resolveAudit?.(true)
  await waitFor(() => expect(controller.snapshot().selectedStore.id).toBe('store-b'))
})

test('renders the screen for the current staff location', () => {
  const navigation = createStaffNavigation()
  navigation.navigate({ screen: 'ledger', date: '2026-08-31' })
  render(
    <App
      storeSwitchController={createStoreSwitchController(
        { id: 'store-a', name: '銀座店', isActive: true },
        async () => true,
      )}
      accessibleStores={[{ id: 'store-a', name: '銀座店', isActive: true }]}
      navigation={navigation}
      renderScreen={(location) => <p>screen:{location.screen}</p>}
    />,
  )

  expect(screen.getByText('screen:ledger')).toBeInTheDocument()
})

test('returns the workspace to home when the selected store changes', async () => {
  // A store switch must not leave the previous store's screen — and its data —
  // on display under the new store's name (UC-EYEX-070, AC-EYEX-30).
  const controller = createStoreSwitchController(
    { id: 'store-a', name: '銀座店', isActive: true },
    async () => true,
  )
  const navigation = createStaffNavigation()
  navigation.navigate({ screen: 'reservation-detail', reservationId: 'res-1' })
  render(
    <App
      storeSwitchController={controller}
      accessibleStores={[
        { id: 'store-a', name: '銀座店', isActive: true },
        { id: 'store-b', name: '丸の内店', isActive: true },
      ]}
      navigation={navigation}
      renderScreen={(location) => <p>screen:{location.screen}</p>}
    />,
  )
  expect(screen.getByText('screen:reservation-detail')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /銀座店/ }))
  fireEvent.click(screen.getByRole('button', { name: /^丸の内店/ }))

  await waitFor(() => expect(screen.getByText('screen:home')).toBeInTheDocument())
  expect(navigation.snapshot()).toEqual({ screen: 'home' })
})

test('reproduces the approved home chrome: wordmark, notification counts and 設定', () => {
  // HOME-DEFAULT--default--ipad-landscape.png / approved.html #home — the home
  // bar carries the wordmark plus exactly three right-aligned controls.
  const navigation = createStaffNavigation()
  render(
    <App
      storeSwitchController={createStoreSwitchController(
        { id: 'store-a', name: '銀座店', isActive: true },
        async () => true,
      )}
      accessibleStores={[{ id: 'store-a', name: '銀座店', isActive: true }]}
      navigation={navigation}
      today="2026-08-27"
      notifications={{ unreadAnnouncements: 2, openAlerts: 1 }}
      renderScreen={(location) => <p>screen:{location.screen}</p>}
    />,
  )

  const bar = screen.getByRole('banner')
  const wordmark = within(bar).getByRole('button', { name: /EYEX予約/ })
  expect(wordmark).toHaveTextContent('EYEX予約')
  expect(wordmark).toHaveTextContent('銀座店 · 営業中')
  expect(
    within(bar)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['EYEX予約銀座店 · 営業中', 'お知らせ 2件', 'アラート 1件', '設定'])
  fireEvent.click(within(bar).getByRole('button', { name: '設定' }))
  expect(navigation.snapshot()).toEqual({ screen: 'settings' })
})

test('shows a stopped store in the wordmark instead of a separate status line', () => {
  render(
    <App
      storeSwitchController={createStoreSwitchController(
        { id: 'store-a', name: '銀座店', isActive: false },
        async () => true,
      )}
      accessibleStores={[{ id: 'store-a', name: '銀座店', isActive: false }]}
      navigation={createStaffNavigation()}
      today="2026-08-27"
      renderScreen={() => null}
    />,
  )

  expect(screen.getByRole('button', { name: /EYEX予約/ })).toHaveTextContent('銀座店 · 受付停止')
})

/* 行き先は柱が持つ。押せば必ずその面が開く。 */
test.each([
  ['受付履歴', { screen: 'reception-history' }],
  ['予約検索', { screen: 'reservation-search' }],
  ['予約台帳', { screen: 'ledger', date: '2026-08-27' }],
  ['分析', { screen: 'analytics' }],
  ['お知らせ', { screen: 'alerts' }],
] as const)('サイドバーの %s を押すとその面が開く', (label, expected) => {
  const navigation = createStaffNavigation()
  navigation.navigate({ screen: 'reception-history' })
  render(
    <App
      storeSwitchController={createStoreSwitchController(
        { id: 'store-a', name: '銀座店', isActive: true },
        async () => true,
      )}
      accessibleStores={[{ id: 'store-a', name: '銀座店', isActive: true }]}
      navigation={navigation}
      today="2026-08-27"
      renderScreen={() => null}
    />,
  )

  fireEvent.click(
    within(screen.getByRole('navigation', { name: '画面の一覧' })).getByRole('button', {
      name: label,
    }),
  )
  expect(navigation.snapshot()).toEqual(expected)
})

test('keeps the home bar free of business tabs and of the admin destinations', () => {
  render(
    <App
      storeSwitchController={createStoreSwitchController(
        { id: 'store-a', name: '銀座店', isActive: true },
        async () => true,
      )}
      accessibleStores={[{ id: 'store-a', name: '銀座店', isActive: true }]}
      navigation={createStaffNavigation()}
      today="2026-08-27"
      renderScreen={() => null}
    />,
  )

  expect(screen.queryByRole('navigation', { name: '業務メニュー' })).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: '管理メニュー' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '監査ログ' })).not.toBeInTheDocument()
})

test('gives every chrome control the 44px touch-target floor', () => {
  render(
    <App
      storeSwitchController={createStoreSwitchController(
        { id: 'store-a', name: '銀座店', isActive: true },
        async () => true,
      )}
      accessibleStores={[{ id: 'store-a', name: '銀座店', isActive: true }]}
      navigation={createStaffNavigation()}
      today="2026-08-27"
      renderScreen={() => null}
    />,
  )

  for (const button of within(screen.getByRole('banner')).getAllByRole('button'))
    expect(button.className).toMatch(/min-h-(1[1-9]|[2-9]\d)\b/)
})

/* ------------------------------------------------------------------ *
 * 緑バーは 1 本だけで、中身は面ごとに違う（承認済みモックの実測）
 * ------------------------------------------------------------------ */

function renderChrome(screenName: 'booking' | 'journey' | 'ledger' | 'settings') {
  const navigation = createStaffNavigation()
  navigation.navigate(
    screenName === 'ledger' ? { screen: 'ledger', date: '2026-08-27' } : { screen: screenName },
  )
  render(
    <App
      navigation={navigation}
      today="2026-08-27"
      storeSwitchController={createStoreSwitchController(
        { id: 'store-a', name: '銀座店', isActive: true },
        async () => true,
      )}
      renderScreen={() => <p>画面</p>}
    />,
  )
  return within(screen.getByRole('banner'))
}

test('予約フローのバーは業務タブも 予約を取る も出さない', () => {
  const bar = renderChrome('booking')
  expect(bar.queryByRole('navigation')).toBeNull()
  expect(bar.queryByRole('button', { name: '＋ 予約を取る' })).toBeNull()
  expect(bar.getByRole('button', { name: /銀座店 · 新規予約/ })).toBeVisible()
})

test('来店受付の主操作は予約ではなく店頭客の受付である', () => {
  const bar = renderChrome('journey')
  expect(bar.getByRole('button', { name: '＋ 店頭のお客様を受付' })).toBeVisible()
})

/* ------------------------------------------------------------------ *
 * 例外・回復状態（`exception-states-approved.html`）
 * ------------------------------------------------------------------ */

function lockedTerminal() {
  const controller = createSharedTerminalController({
    now: () => Date.parse('2026-08-31T00:00:00.000Z'),
    setTimeout,
    clearTimeout,
  })
  controller.start({
    token: 'terminal-token',
    terminalId: 'terminal-a',
    terminalName: 'レジ横iPad',
    storeId: 'store-a',
    expiresAt: '2026-09-01T00:00:00.000Z',
    idleTimeoutSeconds: 120,
  })
  return controller
}

test('EX-SHARED-LOCK: 端末名・無操作分数・2 つの回復操作を持つ全画面ロック', () => {
  const controller = lockedTerminal()
  const onResumeSharedSession = vi.fn()
  const onStartPersonalMode = vi.fn()
  render(
    <App
      sharedTerminalController={controller}
      storeSwitchController={createStoreSwitchController(
        { id: 'store-a', name: '銀座店', isActive: true },
        async () => true,
      )}
      accessibleStores={[{ id: 'store-a', name: '銀座店', isActive: true }]}
      onResumeSharedSession={onResumeSharedSession}
      onStartPersonalMode={onStartPersonalMode}
    />,
  )

  act(() => window.dispatchEvent(new Event('pagehide')))

  // モックの `.bar` — ワードマークと副題だけ。
  const bar = screen.getByRole('banner')
  expect(bar).toHaveTextContent('銀座店 レジ横iPad · 完全共有')
  expect(screen.getByRole('heading', { name: '顧客情報を隠しました' })).toBeInTheDocument()
  expect(
    screen.getByText('画面が非表示になったか、2分間操作がなかったためロックしました。'),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '業務を再開する' }))
  expect(onResumeSharedSession).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '個人モードで開始' }))
  expect(onStartPersonalMode).toHaveBeenCalled()
})

test('EX-SESSION-REVOKED: 誰が失効させたかと未送信データの扱いを落とさない', () => {
  const controller = createSharedTerminalController({
    now: () => Date.parse('2026-08-31T00:00:00.000Z'),
    setTimeout,
    clearTimeout,
  })
  const onReregisterTerminal = vi.fn()
  controller.handleApiError(401, { error: 'terminal_revoked' })
  render(<App sharedTerminalController={controller} onReregisterTerminal={onReregisterTerminal} />)

  expect(screen.getByRole('banner')).toHaveTextContent('共有iPad')
  expect(screen.getByRole('heading', { name: 'この端末の利用は停止されています' })).toBeVisible()
  expect(
    screen.getByText(
      '共有セッションが管理者によって失効されました。未送信の顧客情報や録音は送信されません。',
    ),
  ).toBeInTheDocument()
  // ロック画面と違い、業務へ戻る道は出さない。
  expect(screen.queryByRole('button', { name: '個人モードで開始' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '端末を再登録する' }))
  expect(onReregisterTerminal).toHaveBeenCalled()
})

test('EX-STORE-UNSAVED: 店舗ピッカーを閉じ、店舗名つきの 2 択を琥珀の注意とともに出す', () => {
  const controller = createStoreSwitchController(
    { id: 'store-a', name: '銀座店', isActive: true },
    async () => true,
  )
  controller.setDraftState({ search: '田中花子' })
  render(
    <App
      storeSwitchController={controller}
      accessibleStores={[
        { id: 'store-a', name: '銀座店', isActive: true },
        { id: 'store-b', name: '丸の内店', isActive: true },
      ]}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /銀座店/ }))
  fireEvent.click(screen.getByRole('button', { name: /^丸の内店/ }))

  // 2 重オーバーレイにしない: 確認が出たら店舗ピッカーは閉じている。
  expect(screen.queryByRole('region', { name: '作業する店舗を切り替える' })).not.toBeInTheDocument()
  expect(screen.getByRole('banner')).toHaveTextContent('銀座店 · 入力中の予約あり')
  const dialog = screen.getByRole('dialog')
  expect(
    within(dialog).getByRole('heading', { name: '店舗を切り替える前に確認してください' }),
  ).toBeInTheDocument()
  const warning = within(dialog).getByRole('note', { name: '銀座店で入力中の予約があります' })
  expect(warning.className).toContain('bg-amber-soft')
  expect(warning).toHaveTextContent('入力内容と録音は丸の内店へ持ち越しません。')
  // 危険な方を既定の見た目にしない: 主操作は「続ける」側。
  const stay = within(dialog).getByRole('button', { name: '銀座店で入力を続ける' })
  const discard = within(dialog).getByRole('button', {
    name: '入力を破棄して丸の内店へ切り替える',
  })
  expect(stay.className).toContain('bg-pine')
  expect(discard.className).toContain('text-danger')
})

test('件数が分かるまでは、件数の場所に「未取得」と書かない', () => {
  /*
   * モックの語彙に「未取得」は無い。読み込みの途中でだけ出る言葉を混ぜると、
   * 0 件なのか取れていないのかを利用者が読み分けられない。分かるまでは
   * 件数そのものを出さず、名前だけを出す。
   */
  const navigation = createStaffNavigation()
  navigation.navigate({ screen: 'home' })
  render(
    <App
      navigation={navigation}
      today="2026-08-27"
      storeSwitchController={createStoreSwitchController(
        { id: 'store-a', name: '銀座店', isActive: true },
        async () => true,
      )}
      renderScreen={() => <p>画面</p>}
    />,
  )

  const bar = within(screen.getByRole('banner'))
  expect(bar.getByRole('button', { name: 'お知らせ' })).toBeVisible()
  expect(bar.getByRole('button', { name: 'アラート' })).toBeVisible()
  expect(bar.queryByText(/未取得/)).toBeNull()
})

/* ------------------------------------------------------------------ *
 * 全画面共通の左サイドバー
 * ------------------------------------------------------------------ */

test('業務の面では、すべての行き先が左サイドバーに 1 か所で並ぶ', () => {
  const bar = renderChrome('ledger')
  const sidebar = within(screen.getByRole('navigation', { name: '画面の一覧' }))
  for (const label of [
    '予約台帳',
    '来店受付',
    '受付履歴',
    '予約検索',
    '顧客台帳',
    '設定ガイド',
    '共有端末',
    '録音運用',
    '注意事項',
    '監査ログ',
    '顧客の統合・訂正',
    '分析',
    'お知らせ',
  ])
    expect(sidebar.getByRole('button', { name: label })).toBeVisible()
  // 移動の手段を 2 つ置かない。バーはタブを持たない。
  expect(bar.queryByRole('navigation')).toBeNull()
  expect(sidebar.getByRole('button', { name: '予約台帳' })).toHaveAttribute('aria-current', 'page')
})

test('予約フローとホームは柱を出さない', () => {
  // 受付の途中で別の面へ移す動線を置かない。ホームは主操作を大きく見せる面。
  renderChrome('booking')
  expect(screen.queryByRole('navigation', { name: '画面の一覧' })).toBeNull()
})
