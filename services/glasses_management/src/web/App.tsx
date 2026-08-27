import { Button, Card, Notice } from '@app/ui'
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { barFor, barOverlay } from './app-chrome'
import { bindSharedTerminalLifecycle, type createSharedTerminalController } from './shared-terminal'
import type { createStaffNavigation, StaffLocation } from './staff-navigation'
import type { createStoreSwitchController, SelectedStore } from './store-switch'

/* 承認済みモックの `.bar button` — 透明・白文字・44px 角丸 8px。 */
const BAR_BUTTON =
  'flex min-h-11 min-w-11 flex-col justify-center rounded-ctl px-3.5 font-sans text-base text-on-pine focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
/* `.bar .on` / `.bar .primary` — 白ピルに pine 文字。選択状態は aria-current でも示す。 */
const BAR_ON = 'bg-surface font-bold text-pine'
/* approved.html の #home では 3 つの操作に白の細枠が付く。 */
const BAR_OUTLINE = 'border border-on-pine/40 font-bold'

/** 設定の中から辿れる運用系の入口。ヘッダーから消えても到達性は失わせない。 */
const ADMIN_DESTINATIONS: readonly (readonly [string, StaffLocation])[] = [
  ['店舗設定', { screen: 'settings' }],
  ['共有端末', { screen: 'shared-terminals' }],
  ['録音運用', { screen: 'recording-ops' }],
  ['注意事項権限', { screen: 'attention-settings' }],
  ['監査ログ', { screen: 'audit' }],
  ['顧客の統合・訂正', { screen: 'customer-merge' }],
  ['分析', { screen: 'analytics' }],
  ['お知らせ', { screen: 'alerts' }],
]

type SharedTerminalController = ReturnType<typeof createSharedTerminalController>
const inactiveSharedTerminalSnapshot = { status: 'inactive' as const, dailyState: {} }

type AppProps = {
  sharedTerminalController?: SharedTerminalController
  storeSwitchController?: ReturnType<typeof createStoreSwitchController>
  accessibleStores?: SelectedStore[]
  navigation?: ReturnType<typeof createStaffNavigation>
  /** JST の当日。予約台帳タブが開く日をここから受け取る (時刻は注入する)。 */
  today?: string
  /**
   * ヘッダーの件数 (UC-EYEX-007)。お知らせとアラートは決して合算しない。通知 API
   * が未実装のため任意で、未指定のときは 0 と推測せず「未取得」と言う。
   */
  notifications?: { unreadAnnouncements: number; openAlerts: number }
  /**
   * Rendering the screens is injected rather than imported so the workspace
   * chrome — header, store picker, discard confirmation — can be tested without
   * mounting every business screen and its API calls.
   */
  renderScreen?: (location: StaffLocation) => ReactNode
}

export function App({
  sharedTerminalController,
  storeSwitchController,
  accessibleStores = [],
  navigation,
  today,
  notifications,
  renderScreen,
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
  const location = useSyncExternalStore(
    (listener) => navigation?.subscribe(listener) ?? (() => {}),
    () => navigation?.snapshot(),
    () => undefined,
  )
  /* 面が書いたバーの上書き（予約フローのチップと副題）。 */
  const overlay = useSyncExternalStore(
    barOverlay.subscribe,
    barOverlay.snapshot,
    barOverlay.snapshot,
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
        // The previous store's screen and its parameters die with the switch;
        // nothing crosses the store boundary (UC-EYEX-070, AC-EYEX-30).
        navigation?.resetForStoreSwitch()
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
    /* 緑バーの中身は面ごとに違う。承認済みモックの実測は app-chrome が持つ。 */
    const bar = barFor(location ?? { screen: 'home' }, storeSnapshot.selectedStore, today)
    return (
      /* The workspace chrome is a banner landmark, not part of the screen's
         main content: assistive tech and tests both need to tell "which store /
         which admin surface" apart from "what this screen is about".

         承認済みモック (`staff-approved.html` の `.bar` /
         `HOME-DEFAULT--default--ipad-landscape.png` /
         `LEDGER-DAY--walkin-now--ipad-landscape.png`) をそのまま再現する:
         76px の pine バーは 1 本だけで、タブも主操作も副題も面ごとに入れ替わる
         (`app-chrome.ts`)。2 本目の緑帯は作らない。 */
      <div className="flex h-dvh flex-col bg-paper text-ink">
        <header className="flex h-19 shrink-0 items-center gap-3 bg-pine px-5 text-on-pine">
          {/* モックでは飾りに見えるが、店舗切替の入口はここしかない。 */}
          <button
            type="button"
            className={`${BAR_BUTTON} px-0 text-left font-bold text-xl leading-tight`}
            onClick={() => setStorePickerOpen((open) => !open)}
          >
            EYEX予約
            <small className="block font-normal text-sm">{overlay.subtitle ?? bar.subtitle}</small>
          </button>
          {overlay.chip && (
            <p className="ml-auto rounded-ctl border border-on-pine px-4 py-2 font-bold font-sans text-base text-on-pine">
              {overlay.chip}
            </p>
          )}
          {bar.tabs.length > 0 && (
            <nav
              aria-label={bar.kind === 'business' ? '業務メニュー' : '設定メニュー'}
              className="flex items-center gap-3"
            >
              {bar.tabs.map((tab) => {
                const active = tab.to.screen === location?.screen
                return (
                  <button
                    key={tab.label}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    className={`${BAR_BUTTON} ${active ? BAR_ON : ''}`}
                    onClick={() => navigation?.navigate(tab.to)}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </nav>
          )}
          {bar.primary && (
            <button
              type="button"
              className={`${BAR_BUTTON} ${BAR_ON} ml-auto`}
              onClick={() => navigation?.navigate(bar.primary?.to ?? { screen: 'home' })}
            >
              {bar.primary.label}
            </button>
          )}
          {bar.kind === 'home' && (
            <>
              <button
                type="button"
                className={`${BAR_BUTTON} ${BAR_OUTLINE} ml-auto`}
                onClick={() => navigation?.navigate({ screen: 'alerts' })}
              >
                {`お知らせ ${notifications ? `${notifications.unreadAnnouncements}件` : '未取得'}`}
              </button>
              <button
                type="button"
                className={`${BAR_BUTTON} ${BAR_OUTLINE}`}
                onClick={() => navigation?.navigate({ screen: 'alerts' })}
              >
                {`アラート ${notifications ? `${notifications.openAlerts}件` : '未取得'}`}
              </button>
              <button
                type="button"
                className={`${BAR_BUTTON} ${BAR_OUTLINE}`}
                onClick={() => navigation?.navigate({ screen: 'settings' })}
              >
                設定
              </button>
            </>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {switchError && (
            <div className="mx-auto max-w-6xl px-5 pt-5">
              <Notice tone="danger">{switchError}</Notice>
            </div>
          )}
          {/*
          運用系の入口は 8 つとも 設定 の中に置く。operations-approved.html の
          とおり、これらはトップレベルのヘッダーボタンではなく 設定 の副タブ。
        */}
          {location?.screen === 'settings' && (
            <nav
              aria-label="管理メニュー"
              className="flex flex-wrap gap-2 border-line border-b bg-panel px-5 py-3"
            >
              {ADMIN_DESTINATIONS.map(([label, to]) => (
                <button
                  key={label}
                  type="button"
                  className="min-h-11 rounded-ctl border border-line bg-surface px-3.5 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  onClick={() => navigation?.navigate(to)}
                >
                  {label}
                </button>
              ))}
            </nav>
          )}
          {location && renderScreen ? (
            renderScreen(location)
          ) : (
            <section className="mx-auto max-w-6xl px-5 py-8">
              <p className="font-sans text-sm text-ink-muted">選択中の店舗</p>
              <h2 className="font-display text-3xl font-semibold">
                {storeSnapshot.selectedStore.name}の予約台帳
              </h2>
              <Notice tone="info">
                店舗を切り替えると、検索条件・選択中の予約・入力中の内容は引き継ぎません。
              </Notice>
            </section>
          )}
        </div>
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
      </div>
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
