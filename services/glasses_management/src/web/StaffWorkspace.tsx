import { AlertRecord, Recording, SharedTerminal, Store, StorePermission } from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AlertsScreen } from './AlertsScreen'
import { AnalyticsScreen } from './AnalyticsScreen'
import { App } from './App'
import { AttentionReviewScreen } from './AttentionReviewScreen'
import { AttentionSettingsScreen } from './AttentionSettingsScreen'
import { AuditSearchScreen } from './AuditSearchScreen'
import { BookingFlow } from './BookingFlow'
import { CustomerMergeScreen } from './CustomerMergeScreen'
import { CustomerPanel } from './CustomerPanel'
import { Action } from './design/controls'
import { TextField } from './design/forms'
import { FailureNotice } from './design/notices'
import { Card } from './design/surfaces'
import { HomeScreen } from './HomeScreen'
import { JourneyScreen } from './JourneyScreen'
import { LedgerScreen } from './LedgerScreen'
import { ReceptionHistoryScreen } from './ReceptionHistoryScreen'
import { RecordingOpsScreen } from './RecordingOpsScreen'
import { ReservationSearchScreen, toRecordingView } from './ReservationSearchScreen'
import { SettingsScreen } from './SettingsScreen'
import { SharedTerminalScreen } from './SharedTerminalScreen'
import { createSharedTerminalController } from './shared-terminal'
import { createStaffNavigation, type StaffLocation } from './staff-navigation'
import { authFetch, bootstrap, login } from './staff-session'
import { createStoreSwitchController, type SelectedStore } from './store-switch'

type Api = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type Props = {
  restore?: () => Promise<boolean>
  signIn?: (email: string, password: string) => Promise<boolean>
  api?: Api
  /**
   * The JST day the workspace opens on. The browser is the only place allowed
   * to read the wall clock, and it does so once, here, so every screen below
   * receives time as data instead of reaching for it (repo rule: 時刻は注入する).
   */
  today?: string
  now?: string
  /**
   * Set only when the workspace is opened on a fully shared iPad, so a hold can
   * demand a personal re-authentication first (AC-EYEX-101). There is no
   * production entry point that supplies this yet: the shared-terminal session
   * is not part of the staff session, so it stays an injected prop.
   */
  terminalId?: string | null
  /**
   * The one-time device token a fully shared iPad is opened with. It is held in
   * memory only — a reload sends the manager back to the entry link, which is
   * deliberate: a device token kept in browser storage would outlive the person
   * who authorised it (UC-EYEX-131, 158).
   */
  terminalToken?: string
  terminalFetch?: Api
  /**
   * The single wall-clock reading of the app. Screens receive instants, never
   * the clock itself; the booking flow needs several readings over one call,
   * so it gets the reader rather than a frozen value.
   */
  clock?: () => string
}

function createAuditedStoreController(stores: SelectedStore[], api: Api) {
  const initialStore = stores[0]
  if (!initialStore) throw new RangeError('at least one accessible store is required')
  return createStoreSwitchController(initialStore, async (fromStoreId, toStoreId) => {
    const response = await api('/api/staff/store-switches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromStoreId, toStoreId }),
    })
    return response.ok
  })
}

/** Runtime bridge from the memory-only staff session to the selected-store UI. */
export function StaffWorkspace({
  restore = bootstrap,
  signIn = login,
  api = authFetch,
  today = toJstDateString(new Date()),
  now = new Date().toISOString(),
  terminalId = null,
  terminalToken,
  terminalFetch = fetch,
  clock = () => new Date().toISOString(),
}: Props) {
  const navigation = useMemo(() => createStaffNavigation(), [])
  /*
   * Created exactly once. A controller rebuilt on every render would forget the
   * lock it had just applied, so the device would keep showing customer data
   * after the very event that was supposed to hide it.
   */
  const clockRef = useRef(clock)
  clockRef.current = clock
  const [sharedTerminal] = useState(() =>
    terminalToken === undefined
      ? undefined
      : createSharedTerminalController({
          now: () => Date.parse(clockRef.current()),
          // Bound, not passed bare: the controller calls these as its own
          // methods, and a browser timer invoked with a foreign receiver throws
          // `Illegal invocation` — which the session effect would then read as
          // a revoked terminal, so every shared iPad would refuse to start.
          setTimeout: (callback, delay) => window.setTimeout(callback, delay),
          clearTimeout: (handle) => {
            window.clearTimeout(handle)
          },
        }),
  )
  const [terminalSession, setTerminalSession] = useState<SharedTerminal>()
  const [openReservationId, setOpenReservationId] = useState<string>()
  const [notifications, setNotifications] = useState<{
    unreadAnnouncements: number
    openAlerts: number
  }>()
  // The device's own state has to drive rendering here, not only inside App:
  // the workspace decides whether the staff surface may be shown at all.
  const terminalStatus = useSyncExternalStore(
    (listener) => sharedTerminal?.subscribe(listener) ?? (() => {}),
    () => sharedTerminal?.snapshot().status ?? 'inactive',
    () => 'inactive' as const,
  )
  const [permissions, setPermissions] = useState<StorePermission[]>()
  const [state, setState] = useState<'loading' | 'unauthenticated' | 'error' | 'ready'>('loading')
  const [stores, setStores] = useState<SelectedStore[]>([])
  const [organizationId, setOrganizationId] = useState('')
  const [controller, setController] = useState<ReturnType<typeof createStoreSwitchController>>()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | undefined>()
  const [recordings, setRecordings] = useState<Recording[]>([])

  useEffect(() => {
    let active = true
    void (async () => {
      if (!(await restore())) {
        if (active) setState('unauthenticated')
        return
      }
      const response = await api('/api/staff/stores')
      if (!response.ok) {
        if (active) setState('error')
        return
      }
      const parsed = Store.array().safeParse(await response.json())
      if (!parsed.success || parsed.data.length === 0) {
        if (active) setState('error')
        return
      }
      if (!active) return
      const nextStores = parsed.data.map(({ id, name, isActive }) => ({ id, name, isActive }))
      setOrganizationId(parsed.data[0]?.organizationId ?? '')
      setStores(nextStores)
      setController(createAuditedStoreController(nextStores, api))
      setState('ready')
    })().catch(() => {
      if (active) setState('error')
    })
    return () => {
      active = false
    }
  }, [api, restore])

  /*
   * A shared iPad proves itself with its device token before anything else. A
   * refusal must land on the re-registration screen, not on the staff sign-in.
   */
  useEffect(() => {
    if (!sharedTerminal || terminalToken === undefined || terminalId === null) return undefined
    let active = true
    void (async () => {
      try {
        const response = await terminalFetch(
          `/api/shared-terminals/${encodeURIComponent(terminalId ?? '')}/session`,
          { headers: { 'x-shared-terminal-token': terminalToken } },
        )
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string }
          sharedTerminal.handleApiError(response.status, body)
          return
        }
        const parsed = SharedTerminal.safeParse(await response.json())
        if (!parsed.success) {
          sharedTerminal.handleApiError(401, { error: 'terminal_revoked' })
          return
        }
        if (!active) return
        setTerminalSession(parsed.data)
        sharedTerminal.start({
          token: terminalToken,
          terminalId: parsed.data.id,
          storeId: parsed.data.storeId,
          expiresAt: parsed.data.expiresAt,
          idleTimeoutSeconds: parsed.data.idleTimeoutSeconds,
        })
      } catch {
        // A device that cannot reach the service must not fall through to the
        // staff sign-in with a token in hand.
        sharedTerminal.handleApiError(401, { error: 'terminal_revoked' })
      }
    })()
    return () => {
      active = false
      sharedTerminal.dispose()
    }
  }, [sharedTerminal, terminalFetch, terminalToken, terminalId])

  /*
   * Stable across renders on purpose: the booking flow reports through an
   * effect, so a fresh closure each render would re-run it, publish to the
   * controller, and re-render forever.
   */
  const reportUnsavedInput = useCallback(
    (hasUnsavedInput: boolean) => {
      if (!controller) return
      if (hasUnsavedInput) controller.setDraftState({ form: { booking: true } })
      else controller.clearDraftState()
    },
    [controller],
  )

  /*
   * お知らせ(未読) と アラート(要対応) は別々に数える。既読にしたことと対応を
   * 終えたことは別の事実なので、片方をもう片方の代わりにはできない
   * (UC-EYEX-007, UC-EYEX-178, AC-EYEX-120)。
   */
  useEffect(() => {
    if (!controller) return undefined
    let active = true
    const load = () => {
      const storeId = controller.snapshot().selectedStore.id
      setNotifications(undefined)
      void api(`/api/staff/stores/${encodeURIComponent(storeId)}/alerts`)
        .then(async (response) =>
          response.ok ? AlertRecord.array().safeParse(await response.json()) : undefined,
        )
        .then((parsed) => {
          if (!active || !parsed?.success) return
          setNotifications({
            unreadAnnouncements: parsed.data.filter(
              (row) => row.kind === 'notice' && row.readAt === null,
            ).length,
            openAlerts: parsed.data.filter((row) => row.kind === 'alert' && row.resolvedAt === null)
              .length,
          })
        })
        .catch(() => {
          if (active) setNotifications(undefined)
        })
    }
    load()
    const unsubscribe = controller.subscribe(load)
    return () => {
      active = false
      unsubscribe()
    }
  }, [api, controller])

  /*
   * What this operator may do in the selected store is decided by the server,
   * re-asked on every store switch, and never inferred from the JWT role.
   */
  useEffect(() => {
    if (!controller) return undefined
    let active = true
    const load = () => {
      const storeId = controller.snapshot().selectedStore.id
      setPermissions(undefined)
      void api(`/api/staff/stores/${encodeURIComponent(storeId)}/permissions`)
        .then(async (response) =>
          response.ok ? StorePermission.array().parse(await response.json()) : undefined,
        )
        .then((next) => {
          if (active) setPermissions(next)
        })
        .catch(() => {
          if (active) setPermissions(undefined)
        })
    }
    load()
    const unsubscribe = controller.subscribe(load)
    return () => {
      active = false
      unsubscribe()
    }
  }, [api, controller])

  /*
   * Recordings are asked for only once the server has said this operator may
   * hear them, and they are indexed here rather than inside each screen: the
   * reservation detail and the reception history read the same list.
   */
  const mayReadRecording = permissions?.includes('recording.read') ?? false
  useEffect(() => {
    if (!controller || !mayReadRecording) {
      setRecordings([])
      return undefined
    }
    let active = true
    const storeId = controller.snapshot().selectedStore.id
    void api(`/api/staff/stores/${encodeURIComponent(storeId)}/recordings`)
      .then(async (response) => (response.ok ? Recording.array().parse(await response.json()) : []))
      .then((next) => {
        if (active) setRecordings(next)
      })
      .catch(() => {
        if (active) setRecordings([])
      })
    return () => {
      active = false
    }
  }, [api, controller, mayReadRecording])

  /*
   * A locked or revoked shared iPad outranks every other state: whatever the
   * staff session says, the device must stop showing customer information
   * (UC-EYEX-135, 157, 158; AC-EYEX-97, 98).
   */
  if (sharedTerminal && (terminalStatus === 'locked' || terminalStatus === 'revoked'))
    return <App sharedTerminalController={sharedTerminal} />

  if (state === 'ready' && controller) {
    /*
     * Until the server answers, assume the narrowest view: restricted
     * information is not shown, and its existence is not hinted at either
     * (AC-EYEX-91). A failed fetch keeps that narrow view rather than widening.
     */
    const customerPermissions = {
      crossStoreHistory: permissions?.includes('customer.history') ?? false,
      attentionNotes: permissions?.includes('attention.read') ?? false,
    }
    const recordingPermissions = { playRecording: mayReadRecording }
    const renderScreen = (location: StaffLocation) => {
      const selected = controller.snapshot().selectedStore
      const audioSrc = (recordingId: string) =>
        `/api/staff/stores/${encodeURIComponent(selected.id)}/recordings/${encodeURIComponent(recordingId)}/audio`
      const viewFor = (recording: Recording | undefined) =>
        toRecordingView(recording, recording ? audioSrc(recording.id) : '')
      const common = {
        storeId: selected.id,
        storeName: selected.name,
        api,
        navigate: (next: StaffLocation) => navigation.navigate(next),
      }
      switch (location.screen) {
        case 'home':
          return <HomeScreen {...common} today={today} />
        case 'booking':
          return (
            <BookingFlow
              {...common}
              today={today}
              now={now}
              clock={clock}
              permissions={permissions ?? []}
              recorder={terminalId ? { type: 'shared_terminal', id: terminalId } : undefined}
              onUnsavedInputChange={reportUnsavedInput}
              customerSlot={
                <CustomerPanel
                  {...common}
                  mode="booking"
                  onSelect={() => {}}
                  // Until the staff session carries per-store permissions, the
                  // panel must assume the narrowest view: restricted information
                  // is not shown, and its existence is not hinted at either.
                  permissions={customerPermissions}
                />
              }
            />
          )
        case 'ledger':
          return <LedgerScreen {...common} date={location.date} now={now} />
        case 'journey':
          return <JourneyScreen {...common} date={today} now={now} />
        case 'reception-history':
          return (
            <ReceptionHistoryScreen
              {...common}
              today={today}
              permissions={recordingPermissions}
              // A reception event and its recording are joined by the
              // reservation when there is one, and by the reception session
              // when the reception was discarded (AC-EYEX-89).
              resolveRecording={(entry) =>
                viewFor(
                  recordings.find((recording) =>
                    entry.reservationId
                      ? recording.reservationId === entry.reservationId
                      : recording.receptionSessionId === entry.entityId,
                  ),
                )
              }
            />
          )
        case 'reservation-search':
          return (
            <ReservationSearchScreen
              {...common}
              today={today}
              onReservationOpened={setOpenReservationId}
              permissions={recordingPermissions}
              recording={viewFor(
                recordings.find((recording) => recording.reservationId === openReservationId),
              )}
            />
          )
        case 'reservation-detail':
          return (
            <ReservationSearchScreen
              {...common}
              today={today}
              reservationId={location.reservationId}
              permissions={recordingPermissions}
              recording={viewFor(
                recordings.find((recording) => recording.reservationId === location.reservationId),
              )}
            />
          )
        case 'settings':
          return <SettingsScreen {...common} permissions={permissions ?? []} today={today} />
        case 'analytics':
          return (
            <AnalyticsScreen {...common} permissions={permissions ?? []} today={today} now={now} />
          )
        case 'alerts':
          return (
            <AlertsScreen {...common} permissions={permissions ?? []} today={today} now={now} />
          )
        case 'attention-settings':
          return (
            <AttentionSettingsScreen
              {...common}
              permissions={permissions ?? []}
              today={today}
              now={now}
            />
          )
        case 'attention-review':
          return (
            <AttentionReviewScreen
              {...common}
              permissions={permissions ?? []}
              customerId={location.customerId}
              customerName={location.customerName}
              today={today}
              now={now}
              sharedTerminal={
                terminalSession && terminalToken !== undefined
                  ? {
                      terminalId: terminalSession.id,
                      organizationId: terminalSession.organizationId,
                      token: terminalToken,
                    }
                  : undefined
              }
            />
          )
        case 'audit':
          return (
            <AuditSearchScreen
              {...common}
              permissions={permissions ?? []}
              today={today}
              now={now}
            />
          )
        case 'customer-merge':
          return (
            <CustomerMergeScreen
              {...common}
              permissions={permissions ?? []}
              today={today}
              now={now}
            />
          )
        case 'recording-ops':
          return (
            <RecordingOpsScreen
              {...common}
              now={now}
              permissions={permissions ?? []}
              organizationId={organizationId}
              terminalId={terminalId}
            />
          )
        case 'shared-terminals':
          return <SharedTerminalScreen {...common} now={now} />
        case 'customers':
          return (
            <CustomerPanel
              {...common}
              mode="ledger"
              onSelect={() => {}}
              permissions={customerPermissions}
            />
          )
      }
    }
    return (
      <App
        sharedTerminalController={sharedTerminal}
        storeSwitchController={controller}
        accessibleStores={stores}
        navigation={navigation}
        today={today}
        notifications={notifications}
        renderScreen={renderScreen}
      />
    )
  }
  if (state === 'loading')
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p role="status">スタッフ情報を確認しています。</p>
      </main>
    )
  if (state === 'unauthenticated')
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg items-center px-5">
        <Card className="w-full space-y-5">
          <div>
            <p className="text-sm text-ink-muted">EYEX予約</p>
            <h1 className="font-sans text-3xl font-semibold">スタッフログイン</h1>
            <p className="mt-2 text-sm text-ink-muted">
              担当店舗の予約・受付を開くには個人アカウントでログインしてください。
            </p>
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void (async () => {
                if (await signIn(email, password)) {
                  setState('loading')
                  const response = await api('/api/staff/stores')
                  const parsed = response.ok
                    ? Store.array().safeParse(await response.json())
                    : undefined
                  if (parsed?.success && parsed.data.length > 0) {
                    const nextStores = parsed.data.map(({ id, name, isActive }) => ({
                      id,
                      name,
                      isActive,
                    }))
                    setOrganizationId(parsed.data[0]?.organizationId ?? '')
                    setStores(nextStores)
                    setController(createAuditedStoreController(nextStores, api))
                    setState('ready')
                  } else setState('error')
                } else setLoginError('メールアドレスまたはパスワードを確認してください。')
              })()
            }}
          >
            <TextField
              id="staff-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              label="メールアドレス"
            />
            <TextField
              id="staff-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              label="パスワード"
            />
            {loginError && <FailureNotice>{loginError}</FailureNotice>}
            <Action type="submit" variant="primary" className="w-full">
              ログインする
            </Action>
          </form>
        </Card>
      </main>
    )
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-5">
      <FailureNotice>
        利用可能な店舗を読み込めませんでした。通信を確認して再読み込みしてください。
      </FailureNotice>
    </main>
  )
}
