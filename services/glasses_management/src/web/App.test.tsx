import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { App } from './App'
import { createSharedTerminalController } from './shared-terminal'
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
  expect(screen.getByRole('dialog')).toHaveTextContent(
    '未保存の入力を破棄して丸の内店へ切り替えますか',
  )
  fireEvent.click(screen.getByRole('button', { name: '破棄して切り替える' }))
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
