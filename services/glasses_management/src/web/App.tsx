import { Button, Card, Notice } from '@app/ui'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { bindSharedTerminalLifecycle, type createSharedTerminalController } from './shared-terminal'
import type { createStoreSwitchController, SelectedStore } from './store-switch'

type SharedTerminalController = ReturnType<typeof createSharedTerminalController>
const inactiveSharedTerminalSnapshot = { status: 'inactive' as const, dailyState: {} }

type AppProps = {
  sharedTerminalController?: SharedTerminalController
  storeSwitchController?: ReturnType<typeof createStoreSwitchController>
  accessibleStores?: SelectedStore[]
}

export function App({
  sharedTerminalController,
  storeSwitchController,
  accessibleStores = [],
}: AppProps) {
  const snapshot = useSyncExternalStore(
    (listener) => sharedTerminalController?.subscribe(listener) ?? (() => {}),
    () => sharedTerminalController?.snapshot() ?? inactiveSharedTerminalSnapshot,
    () => inactiveSharedTerminalSnapshot,
  )
  useEffect(() => {
    if (!sharedTerminalController) return undefined
    return bindSharedTerminalLifecycle(sharedTerminalController, document, window)
  }, [sharedTerminalController])
  const storeSnapshot = useSyncExternalStore(
    (listener) => storeSwitchController?.subscribe(listener) ?? (() => {}),
    () => storeSwitchController?.snapshot(),
    () => undefined,
  )
  const [storePickerOpen, setStorePickerOpen] = useState(false)
  const [discardConfirmation, setDiscardConfirmation] = useState<
    { fromStore: string; toStore: string } | undefined
  >()
  const [pendingAudit, setPendingAudit] = useState<
    { fromStoreId: string; toStoreId: string } | undefined
  >()
  const [switchError, setSwitchError] = useState<string | undefined>()
  const [isSwitching, setIsSwitching] = useState(false)
  const switchInFlight = useRef(false)

  if (snapshot.status === 'locked' || snapshot.status === 'revoked') {
    const revoked = snapshot.status === 'revoked'
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-5 px-6 py-12">
        <Card className="flex flex-col gap-5">
          <p className="font-sans text-sm text-ink-muted">EYEX予約 · 完全共有端末</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            {revoked ? 'この端末の利用は停止されています' : '顧客情報を隠しました'}
          </h1>
          <Notice tone={revoked ? 'danger' : 'info'}>
            {revoked
              ? '共有セッションが失効しました。端末を再登録してください。'
              : '画面非表示または無操作のため、端末をロックしました。'}
          </Notice>
          <Button>{revoked ? '端末を再登録する' : '業務を再開する'}</Button>
        </Card>
      </main>
    )
  }
  if (storeSnapshot && storeSwitchController) {
    const recordThenCommit = async (_fromStoreId: string, store: SelectedStore) => {
      if (switchInFlight.current) return
      switchInFlight.current = true
      setIsSwitching(true)
      try {
        if (!(await storeSwitchController.switchAfterAudit(store)))
          throw new Error('audit rejected')
        setStorePickerOpen(false)
        setSwitchError(undefined)
      } catch {
        setSwitchError('店舗を切り替えられませんでした。通信を確認してもう一度お試しください。')
      } finally {
        switchInFlight.current = false
        setIsSwitching(false)
      }
    }
    const selectStore = (store: SelectedStore) => {
      const fromStoreId = storeSnapshot.selectedStore.id
      const result = storeSwitchController.prepareSwitch(store)
      if (result.kind === 'confirm_discard') {
        setDiscardConfirmation(result)
        setPendingAudit({ fromStoreId, toStoreId: store.id })
      } else {
        void recordThenCommit(fromStoreId, store)
      }
    }
    return (
      <main className="min-h-dvh bg-canvas text-ink">
        <header className="flex min-h-16 items-center gap-3 bg-pine px-5 text-on-pine">
          <h1 className="font-display text-xl font-semibold">EYEX予約</h1>
          <button
            type="button"
            className="rounded-ctl border border-on-pine/30 px-3 py-2 text-left font-sans text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => setStorePickerOpen((open) => !open)}
          >
            <span className="block font-semibold">{storeSnapshot.selectedStore.name}</span>
            <span className="text-xs">
              {storeSnapshot.selectedStore.isActive ? '営業中 · 選択中の店舗' : '受付停止'}
            </span>
          </button>
          <nav aria-label="業務メニュー" className="hidden gap-1 md:flex">
            <span className="rounded-ctl bg-surface px-3 py-2 text-sm font-semibold text-pine">
              予約台帳
            </span>
            <span className="px-3 py-2 text-sm">来店受付</span>
            <span className="px-3 py-2 text-sm">顧客台帳</span>
          </nav>
        </header>
        <section className="mx-auto max-w-6xl px-5 py-8">
          <p className="font-sans text-sm text-ink-muted">選択中の店舗</p>
          <h2 className="font-display text-3xl font-semibold">
            {storeSnapshot.selectedStore.name}の予約台帳
          </h2>
          <Notice tone="info">
            店舗を切り替えると、検索条件・選択中の予約・入力中の内容は引き継ぎません。
          </Notice>
          {switchError && <Notice tone="danger">{switchError}</Notice>}
        </section>
        {storePickerOpen && (
          <div className="fixed inset-0 z-10 bg-ink/40 p-5" role="presentation">
            <section
              className="mx-auto mt-20 max-w-md rounded-ctl bg-surface shadow-lg"
              aria-label="作業する店舗を切り替える"
            >
              <div className="border-b border-line p-5">
                <h2 className="font-display text-xl font-semibold">作業する店舗を切り替える</h2>
                <p className="mt-1 text-sm text-ink-muted">他店舗の空き枠はここに表示しません。</p>
              </div>
              <ul className="divide-y divide-line">
                {accessibleStores.map((store) => (
                  <li key={store.id}>
                    <button
                      type="button"
                      disabled={isSwitching}
                      className="min-h-12 w-full px-5 py-3 text-left focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => selectStore(store)}
                    >
                      <span className="font-semibold">{store.name}</span>
                      <span className="ml-2 text-sm text-ink-muted">
                        {store.id === storeSnapshot.selectedStore.id
                          ? '選択中'
                          : store.isActive
                            ? '営業中'
                            : '受付停止'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
        {discardConfirmation && (
          <div
            className="fixed inset-0 z-20 flex items-center justify-center bg-ink/40 p-5"
            role="presentation"
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="discard-title"
              className="w-full max-w-md rounded-ctl bg-surface p-6 shadow-lg"
            >
              <h2 id="discard-title" className="font-display text-xl font-semibold">
                未保存の入力を破棄して{discardConfirmation.toStore}へ切り替えますか
              </h2>
              <p className="mt-3 text-sm text-ink-muted">
                {discardConfirmation.fromStore}
                で選択中の予約、検索条件、入力内容はすべて破棄されます。
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <Button
                  variant="ghost"
                  disabled={isSwitching}
                  onClick={() => {
                    setDiscardConfirmation(undefined)
                    setPendingAudit(undefined)
                  }}
                >
                  現在の店舗で続ける
                </Button>
                <Button
                  disabled={isSwitching}
                  onClick={() => {
                    if (pendingAudit) {
                      const nextStore = accessibleStores.find(
                        (store) => store.id === pendingAudit.toStoreId,
                      )
                      if (nextStore) void recordThenCommit(pendingAudit.fromStoreId, nextStore)
                    }
                    setDiscardConfirmation(undefined)
                    setPendingAudit(undefined)
                  }}
                >
                  破棄して切り替える
                </Button>
              </div>
            </section>
          </div>
        )}
      </main>
    )
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-5 px-6 py-12">
      <header className="border-b border-line pb-4">
        <p className="font-sans text-sm text-ink-muted">EYEX reservation service</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          Glasses Management
        </h1>
      </header>
      <Notice tone="success">Service shell is ready.</Notice>
    </main>
  )
}
