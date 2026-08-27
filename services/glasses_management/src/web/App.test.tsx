import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { App } from './App'
import { createSharedTerminalController } from './shared-terminal'
import { createStaffNavigation } from './staff-navigation'
import { createStoreSwitchController } from './store-switch'

test('renders the glasses-management service shell', () => {
  render(<App />)

  expect(screen.getByRole('heading', { name: 'Glasses Management' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Service shell is ready.')
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

test('states the notification counts as not loaded rather than guessing zero', () => {
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

  const bar = screen.getByRole('banner')
  expect(within(bar).getByRole('button', { name: 'お知らせ 未取得' })).toBeInTheDocument()
  expect(within(bar).getByRole('button', { name: 'アラート 未取得' })).toBeInTheDocument()
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

test('reproduces the approved business chrome: four tabs and one primary action', () => {
  // LEDGER-DAY--walkin-now--ipad-landscape.png / staff-approved.html #ledger.
  const navigation = createStaffNavigation()
  navigation.navigate({ screen: 'ledger', date: '2026-08-27' })
  render(
    <App
      storeSwitchController={createStoreSwitchController(
        { id: 'store-a', name: '銀座店', isActive: true },
        async () => true,
      )}
      accessibleStores={[{ id: 'store-a', name: '銀座店', isActive: true }]}
      navigation={navigation}
      today="2026-08-27"
      renderScreen={(location) => <p>screen:{location.screen}</p>}
    />,
  )

  const tabs = within(screen.getByRole('navigation', { name: '業務メニュー' })).getAllByRole(
    'button',
  )
  expect(tabs.map((tab) => tab.textContent)).toEqual([
    '予約台帳',
    '来店受付',
    '受付履歴',
    '顧客台帳',
  ])
  // The active tab is a white pill, and says so to assistive tech as well.
  expect(tabs[0]).toHaveAttribute('aria-current', 'page')
  expect(tabs[1]).not.toHaveAttribute('aria-current')

  fireEvent.click(screen.getByRole('button', { name: '＋ 予約を取る' }))
  expect(navigation.snapshot()).toEqual({ screen: 'booking' })
})

test.each([
  ['来店受付', { screen: 'journey' }],
  ['受付履歴', { screen: 'reception-history' }],
  ['顧客台帳', { screen: 'customers' }],
  ['予約台帳', { screen: 'ledger', date: '2026-08-27' }],
] as const)('the business tab %s opens its screen', (label, expected) => {
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
    within(screen.getByRole('navigation', { name: '業務メニュー' })).getByRole('button', {
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

test('設定の面はバーの 3 つのタブから互いへ行き来できる', () => {
  /*
   * operations-approved.html のバーは 端末とセキュリティ / 利用者とロール /
   * 監査ログ、settings-approved.html は 設定ガイド / 設定一覧 / 変更履歴。
   * どちらも 2 本目の帯を持たないので、面から面への行き来はバーが担う。
   * 各面の中の節（共有iPad・無操作ロック…）は、その面の左サイドが持つ。
   */
  const navigation = createStaffNavigation()
  navigation.navigate({ screen: 'settings' })
  render(
    <App
      storeSwitchController={createStoreSwitchController(
        { id: 'store-a', name: '銀座店', isActive: true },
        async () => true,
      )}
      accessibleStores={[{ id: 'store-a', name: '銀座店', isActive: true }]}
      navigation={navigation}
      today="2026-08-27"
      renderScreen={(location) => <p>screen:{location.screen}</p>}
    />,
  )

  for (const [label, expected] of [
    ['設定一覧', 'shared-terminals'],
    ['変更履歴', 'audit'],
    ['設定ガイド', 'settings'],
  ] as const) {
    const menu = screen.getByRole('navigation', { name: '設定メニュー' })
    fireEvent.click(within(menu).getByRole('button', { name: label }))
    expect(navigation.snapshot()).toEqual({ screen: expected })
    act(() => {
      navigation.navigate({ screen: 'settings' })
    })
  }
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
  expect(
    within(bar.getByRole('navigation', { name: '業務メニュー' }))
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['予約台帳', '来店受付', '顧客台帳'])
})

test('予約台帳のタブは 4 つで、主操作は予約を取る', () => {
  const bar = renderChrome('ledger')
  expect(
    within(bar.getByRole('navigation', { name: '業務メニュー' }))
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['予約台帳', '来店受付', '受付履歴', '顧客台帳'])
  expect(bar.getByRole('button', { name: '＋ 予約を取る' })).toBeVisible()
})

test('設定ガイドのバーは、そこから出られるタブを持つ', () => {
  // 操作を 1 つも持たないと、ガイドに入った利用者が出られなくなる。
  const bar = renderChrome('settings')
  expect(
    within(bar.getByRole('navigation', { name: '設定メニュー' }))
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['設定ガイド', '設定一覧', '変更履歴'])
  expect(bar.getByRole('button', { name: /銀座店 · 設定ガイド/ })).toBeVisible()
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
