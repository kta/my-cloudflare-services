import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { barFor, barOverlay, screenSections, sidebarFor } from './app-chrome'
import { AppBar, BarButton, BarPush, PlainBar, Screen, Wordmark } from './design/chrome'
import { Action, SearchField } from './design/controls'
import { SwitchOption, SwitchSheet } from './design/dialogs'
import { ExceptionContent, FullScreenState } from './design/layouts'
import { FailureNotice } from './design/notices'
import {
  AppSidebar,
  SidebarGroup,
  SidebarItem,
  SidebarSection,
  SidebarSections,
} from './design/sidebar'
import { Card } from './design/surfaces'
import { bindSharedTerminalLifecycle, type createSharedTerminalController } from './shared-terminal'
import type { createStaffNavigation, StaffLocation } from './staff-navigation'
import {
  type createStoreSwitchController,
  filterStores,
  type SelectedStore,
  storeSwitchOptions,
} from './store-switch'

/* 承認済みモックの `.bar button` — 透明・白文字・44px 角丸 8px。 */

type SharedTerminalController = ReturnType<typeof createSharedTerminalController>
const inactiveSharedTerminalSnapshot = { status: 'inactive' as const, dailyState: {} }

type AppProps = {
  sharedTerminalController?: SharedTerminalController
  /*
   * 例外・回復の面が呼ぶ出口。App は「どう見せるか」だけを持ち、再開・個人モード・
   * 再登録が何をするかは呼び出し側の責務なので、注入で受ける。
   */
  onResumeSharedSession?: () => void
  onStartPersonalMode?: () => void
  onReregisterTerminal?: () => void
  storeSwitchController?: ReturnType<typeof createStoreSwitchController>
  accessibleStores?: SelectedStore[]
  navigation?: ReturnType<typeof createStaffNavigation>
  /** JST の当日。予約台帳タブが開く日をここから受け取る (時刻は注入する)。 */
  today?: string
  /**
   * ヘッダーの件数 (UC-EYEX-007)。お知らせとアラートは決して合算しない。通知 API
   * を読み終えるまでは undefined。0 件と推測せず、件数そのものを出さない
   * （「未取得」と書くとモックに無い言葉が増え、0 件との読み分けも増える）。
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
  onResumeSharedSession,
  onStartPersonalMode,
  onReregisterTerminal,
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
  /* 開いている面が書いた節。柱がその面の行き先の下へ入れる。 */
  const sections = useSyncExternalStore(
    screenSections.subscribe,
    screenSections.snapshot,
    screenSections.snapshot,
  )
  const overlay = useSyncExternalStore(
    barOverlay.subscribe,
    barOverlay.snapshot,
    barOverlay.snapshot,
  )
  const [storePickerOpen, setStorePickerOpen] = useState(false)
  /* 切替シートの絞り込み。シートを閉じるたびに捨てる（前回の入力を残さない）。 */
  const [storeQuery, setStoreQuery] = useState('')
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
    /*
     * 承認済みモック `exception-states-approved.html#shared-lock` のバーは、
     * 「どの店舗の、どの端末か」を名乗る。失効した端末は店舗も端末名も信じられ
     * ないので、モック `#session-revoked` どおり「共有iPad」とだけ言う。
     */
    const named = [storeSnapshot?.selectedStore.name, snapshot.terminalName]
      .filter((part): part is string => part !== undefined && part !== '')
      .join(' ')
    const subtitle = revoked || named === '' ? '共有iPad' : `${named} · 完全共有`
    // 無操作の秒数は端末の設定値。何分で伏せたのかを本文で名乗る。
    const idleMinutes = Math.round((snapshot.idleTimeoutSeconds ?? 0) / 60)
    return (
      <Screen>
        <PlainBar subtitle={subtitle} />
        {revoked ? (
          <FullScreenState glyph="!" title="この端末の利用は停止されています">
            <p>
              共有セッションが管理者によって失効されました。未送信の顧客情報や録音は送信されません。
            </p>
            {/* 失効した端末に残る道は再登録の 1 つだけ。業務へ戻る口は出さない。 */}
            <Action size="roomy" variant="primary" onClick={onReregisterTerminal}>
              端末を再登録する
            </Action>
          </FullScreenState>
        ) : (
          <FullScreenState glyph="●" title="顧客情報を隠しました">
            <p>{`画面が非表示になったか、${idleMinutes}分間操作がなかったためロックしました。`}</p>
            <Action size="roomy" variant="primary" onClick={onResumeSharedSession}>
              業務を再開する
            </Action>
            {/* 個人モードは 1 段離す。共有端末では再開が既定で、これは選ぶもの。 */}
            <p>
              <Action size="roomy" onClick={onStartPersonalMode}>
                個人モードで開始
              </Action>
            </p>
          </FullScreenState>
        )}
      </Screen>
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
        setStorePickerOpen(false)
      } else {
        void recordThenCommit(fromStoreId, store)
      }
    }
    const commitDiscard = () => {
      if (pendingAudit) {
        const nextStore = accessibleStores.find((store) => store.id === pendingAudit.toStoreId)
        if (nextStore) void recordThenCommit(pendingAudit.fromStoreId, nextStore)
      }
      setDiscardConfirmation(undefined)
      setPendingAudit(undefined)
    }
    /* 緑バーの中身は面ごとに違う。承認済みモックの実測は app-chrome が持つ。 */
    const bar = barFor(location ?? { screen: 'home' }, storeSnapshot.selectedStore)
    /*
     * 予約フローは電話を受けている最中の面なので、別の面への動線を置かない
     * （途中で移ると入力が消える）。ホームは主操作 2 枚を大きく見せる面で、
     * モックどおり柱を持たない。
     */
    const showSidebar = location !== undefined && !['home', 'booking'].includes(location.screen)
    return (
      /* The workspace chrome is a banner landmark, not part of the screen's
         main content: assistive tech and tests both need to tell "which store /
         which admin surface" apart from "what this screen is about".

         承認済みモック (`staff-approved.html` の `.bar` /
         `HOME-DEFAULT--default--ipad-landscape.png` /
         `LEDGER-DAY--walkin-now--ipad-landscape.png`) をそのまま再現する:
         76px の pine バーは 1 本だけで、タブも主操作も副題も面ごとに入れ替わる
         (`app-chrome.ts`)。2 本目の緑帯は作らない。 */
      <Screen>
        <AppBar variant={bar.kind === 'home' ? 'booking' : 'workspace'}>
          {/* モックでは飾りに見えるが、店舗切替の入口はここしかない。 */}
          <Wordmark
            variant={bar.kind === 'home' ? 'booking' : 'workspace'}
            /*
             * 破棄確認の間は、どの店舗の入力を抱えたまま止まっているのかを
             * 帯が名乗る（確認は業務クロムの上に重なるだけで、帯は残る）。
             */
            subtitle={
              discardConfirmation
                ? `${discardConfirmation.fromStore} · 入力中の予約あり`
                : (overlay.subtitle ?? bar.subtitle)
            }
            onClick={() => {
              setStoreQuery('')
              setStorePickerOpen((open) => !open)
            }}
          />
          {overlay.chip && (
            <BarPush variant="booking">
              <p className="rounded-ctl border border-on-pine px-4 py-2 font-bold font-sans text-body text-on-pine">
                {overlay.chip}
              </p>
            </BarPush>
          )}
          {bar.primary && (
            <BarPush>
              <BarButton
                on
                onClick={() => navigation?.navigate(bar.primary?.to ?? { screen: 'home' })}
              >
                {bar.primary.label}
              </BarButton>
            </BarPush>
          )}
          {bar.kind === 'home' && (
            <BarPush variant="booking">
              <BarButton
                outline
                variant="booking"
                onClick={() => navigation?.navigate({ screen: 'alerts' })}
              >
                {notifications ? `お知らせ ${notifications.unreadAnnouncements}件` : 'お知らせ'}
              </BarButton>
              <BarButton
                outline
                variant="booking"
                onClick={() => navigation?.navigate({ screen: 'alerts' })}
              >
                {notifications ? `アラート ${notifications.openAlerts}件` : 'アラート'}
              </BarButton>
              <BarButton
                outline
                variant="booking"
                onClick={() => navigation?.navigate({ screen: 'settings' })}
              >
                設定
              </BarButton>
            </BarPush>
          )}
        </AppBar>
        {/*
         * バーの下は「250px の柱 + 本文」の 2 列。柱は全画面共通で、行き先と、
         * 開いている面の節を並べる。予約フローと例外の面は業務から離れる面
         * なので柱を出さない（受付の途中で別の面へ移す動線を置かない）。
         */}
        <div className="flex min-h-0 flex-1">
          {showSidebar && (
            <AppSidebar>
              {sidebarFor(today).map((group) => (
                <SidebarGroup key={group.label} label={group.label}>
                  {group.items.map((item) => {
                    const current = item.to.screen === location?.screen
                    return (
                      <div key={item.label}>
                        <SidebarItem
                          current={current}
                          onClick={() => navigation?.navigate(item.to)}
                        >
                          {item.label}
                        </SidebarItem>
                        {current && sections.length > 0 && (
                          <SidebarSections>
                            {sections.map((section) => (
                              <SidebarSection
                                key={section.label}
                                current={section.current === true}
                                onClick={
                                  section.to === undefined
                                    ? undefined
                                    : () => navigation?.navigate(section.to as StaffLocation)
                                }
                              >
                                {section.label}
                              </SidebarSection>
                            ))}
                          </SidebarSections>
                        )}
                      </div>
                    )
                  })}
                </SidebarGroup>
              ))}
            </AppSidebar>
          )}
          {/*
           * 面は自分で列を作る（`Workspace` の 390px レールなど）。ここを縦の
           * flex にしておかないと `flex-1` が効かず、地色の列がバーの下いっぱいに
           * 伸びずに途中で切れる。
           */}
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            {switchError && (
              <div className="p-5.5">
                <FailureNotice>{switchError}</FailureNotice>
              </div>
            )}
            {location && renderScreen ? (
              renderScreen(location)
            ) : (
              <section className="p-5.5 font-sans text-body text-ink">
                <h1>{`${storeSnapshot.selectedStore.name}の予約台帳`}</h1>
                <Card className="mt-4.5">
                  店舗を切り替えると、検索条件・選択中の予約・入力中の内容は引き継ぎません。
                </Card>
              </section>
            )}
          </div>
        </div>
        {storePickerOpen && (
          /*
           * 承認済みモック `store-switch-approved.html` の切替シート。幕は台帳を
           * 消さず上に掛かるだけで、左へ寄せて「今どの店舗を見ていたか」を
           * 残したまま切り替えさせる。
           */
          <SwitchSheet
            title="作業する店舗を切り替える"
            titleId="store-switch-title"
            search={
              <SearchField
                label="店舗名で検索"
                placeholder="店舗名で検索"
                value={storeQuery}
                onChange={setStoreQuery}
              />
            }
            boundary="他店舗の空き枠はここに表示しません。切替後、その店舗の予約台帳で確認してください。"
          >
            {storeSwitchOptions(
              filterStores(accessibleStores, storeQuery),
              storeSnapshot.selectedStore.id,
            ).map((option) => (
              <SwitchOption
                key={option.store.id}
                name={option.store.name}
                note={option.note}
                state={option.state}
                selected={option.selected}
                suspended={option.suspended}
                disabled={isSwitching}
                onClick={() => selectStore(option.store)}
              />
            ))}
          </SwitchSheet>
        )}
        {discardConfirmation && (
          /*
           * 承認済みモック `exception-states-approved.html#unsaved-store-switch`。
           *
           * 業務クロムごと差し替えず、その上に重ねる。差し替えると入力中の面
           * (`BookingFlow`) が unmount され、この確認が守ると宣言した下書きが、
           * 確認を出しただけで消えてしまう（さらに「未入力」に戻るので、以後の
           * 切替では確認そのものが出なくなる）。判断が済むまで手前は塞ぐので、
           * 幕は全面に敷き、店舗ピッカーは開く時点で閉じてある。
           */
          <div className="fixed inset-0 z-50 overflow-auto bg-paper">
            <ExceptionContent dialogLabelledBy="unsaved-store-switch-title">
              <h1 id="unsaved-store-switch-title">店舗を切り替える前に確認してください</h1>
              {/*
               * 失敗ではなく警告なので琥珀。design/layouts の Panel と同じ見た目だが、
               * 読み上げでは「注意書き」と分かる必要があるので role を持たせる。
               */}
              <section
                role="note"
                aria-label={`${discardConfirmation.fromStore}で入力中の予約があります`}
                className="mt-4.5 rounded-panel border border-amber-line bg-amber-soft p-6"
              >
                <b>{`${discardConfirmation.fromStore}で入力中の予約があります`}</b>
                <p>{`入力内容と録音は${discardConfirmation.toStore}へ持ち越しません。`}</p>
              </section>
              <div className="mt-5 flex flex-wrap justify-end gap-3">
                {/* 危険な方を既定にしない: 主操作は入力を守る側に置く。 */}
                <Action
                  size="roomy"
                  variant="primary"
                  onClick={() => {
                    setDiscardConfirmation(undefined)
                    setPendingAudit(undefined)
                  }}
                >
                  {`${discardConfirmation.fromStore}で入力を続ける`}
                </Action>
                <Action
                  size="roomy"
                  variant="danger"
                  disabled={isSwitching}
                  onClick={commitDiscard}
                >
                  {`入力を破棄して${discardConfirmation.toStore}へ切り替える`}
                </Action>
              </div>
            </ExceptionContent>
          </div>
        )}
      </Screen>
    )
  }
  /*
   * 店舗も画面も注入されていないとき。業務のクロムを名乗れないので、例外・回復と
   * 同じ全画面の姿で「まだ何も選ばれていない」ことだけを日本語で言う。英語の
   * 開発メモを製品の面に出さない。
   */
  return (
    <Screen>
      <PlainBar subtitle="店舗未選択" />
      <FullScreenState glyph="●" title="作業する店舗が選ばれていません">
        <p>店舗を選ぶと、その店舗の予約台帳から業務を始められます。</p>
      </FullScreenState>
    </Screen>
  )
}
