import type {
  BusinessHoursRow,
  LocalDate,
  StaffMember,
  StaffShift,
  Store,
  Terminal,
  TerminalSession,
} from '@app/contracts'
import { auth, toJstDateString } from '@app/shared'
import { Button, Field, focusRing, focusRingOnPine, Notice, TextInput } from '@app/ui'
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { AlertScreen } from './alerts/AlertScreen'
import { AnalyticsPane } from './analytics/AnalyticsPane'
import { BookingScreen } from './booking/BookingScreen'
import { ChangeScreen } from './change/ChangeScreen'
import {
  clearTerminalSession,
  client,
  domainFetch,
  storeTerminalSession,
  TERMINAL_ID_KEY,
} from './client'
import { CustomerScreen } from './customers/CustomerScreen'
import { MyReservations } from './home/MyReservations'
import { WeekStrip } from './home/WeekStrip'
import { LedgerScreen } from './ledger/LedgerScreen'
import { PinEntry } from './login/PinEntry'
import { PlacePick } from './login/PlacePick'
import { StaffPick } from './login/StaffPick'
import { PersonalMode } from './mode/PersonalMode'
import { type HistoryFilters, ReceptionHistory } from './reception/ReceptionHistory'
import { ReceptionScreen } from './reception/ReceptionScreen'
import { SettingsScreen } from './settings/SettingsScreen'
import { AppShell } from './shell/AppShell'
import { DESTINATIONS, RAIL_BY_DEFAULT } from './shell/destinations'
import { openStateLabel } from './shell/hours'
import { LockVeil } from './shell/LockVeil'
import { OfflineBand } from './shell/OfflineBand'
import { useIdle } from './shell/useIdle'
import { DeviceMode } from './start/DeviceMode'

/*
 * P0（基盤）の画面。承認済みモック docs/frontend/mockups/eyex/images/HOME.png の
 * 骨格 —— 上のバー・左サイドバー・主操作 2 つ・下辺の日付の帯 —— をここで確立し、
 * 以降のフェーズがこの器の中に画面を足していく。
 *
 * 引き算の決め（mockups/eyex/README.md）: 主役は 1 画面に 1 つ、白い箱は 3 枚まで、
 * 説明文は 2 つまで。空いた場所を埋めるために要素を足さない。
 */

export function App({ now = () => new Date() }: { now?: () => Date }) {
  const [org, setOrg] = useState(() => auth.getOrganization())
  return org ? (
    <Workspace
      org={org}
      now={now}
      onSignOut={() => {
        clearTerminalSession()
        auth.logout()
        setOrg(null)
      }}
    />
  ) : (
    <StartWork onStarted={setOrg} />
  )
}

/** 業務開始。実運用では admin の認証に差し替わる（いまは dev グラント）。 */
function StartWork({ onStarted }: { onStarted: (org: string) => void }) {
  const [orgId, setOrgId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    /*
     * **入口でコードを畳んでから送る。**
     * dev グラントは知らない組織にもトークンを出したうえで `organizations` に行を作るので、
     * `EYEX` のまま送ると「EYEX」という空の組織が生まれ、店舗 0 件で
     * 「このコードのお店が見つかりませんでした。」が出る —— seed 済みの `eyex` は無事なのに。
     * 打ち間違いが組織として永続化するのも同じ経路なので、送る前にここで揃える。
     */
    const code = orgId.trim().toLowerCase()
    if (!code) {
      setError('お店のコードを入れてください。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await auth.login(code)
      /*
       * **入るまえに、そのコードのお店が本当にあるかを確かめる。**
       * dev グラントは知らない組織にもトークンを出すので、ここを見ないと
       * 端末モードも置き場所も暗証番号も飛ばしてアプリ本体に入れてしまい、
       * 上のバーに実在しない店の営業時間まで出る（UX 監査 SHELL-03）。
       * 同期がまだ届いていない（503）のは「コードが違う」とは別なので、そのまま通す
       * —— その先の面が「お店の情報がまだ届いていません」を出す。
       */
      const res = await auth.authFetch('/api/staff/stores')
      if (res.ok) {
        const rows: Store[] = await res.json()
        if (rows.length === 0) {
          /*
           * **持たせたトークンをここで捨てる。**残したまま断ると、その場では
           * 入口に留まるのに、次に読み込み直したときは「もう業務が始まっている」
           * と見なされて業務画面へ入れてしまう（実装不足の洗い出し foundation-04）。
           * 断った以上、この端末はまだ何も始めていない状態へ戻す。
           */
          auth.logout()
          setError(
            'このコードのお店が見つかりませんでした。お店のコードをお確かめのうえ、もう一度お試しください。',
          )
          return
        }
      }
      onStarted(code)
    } catch {
      setError('業務を始められませんでした。コードを確かめて、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-6">
      <form onSubmit={onSubmit} className="flex w-full max-w-md flex-col gap-6">
        <div>
          <h1 className="text-title font-bold text-ink">EYEX予約</h1>
          <p className="mt-1 text-grid text-ink-muted">業務を始めます。</p>
        </div>
        <Field label="お店のコード" htmlFor="org" error={error}>
          <TextInput
            id="org"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="例: eyex"
            autoFocus
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? '開いています…' : '業務を始める'}
        </Button>
      </form>
    </main>
  )
}

function Workspace({
  org,
  now,
  onSignOut,
}: {
  org: string
  now: () => Date
  onSignOut: () => void
}) {
  const [current, setCurrent] = useState('home')
  const [rail, setRail] = useState(false)
  /** トップの 1 週間の帯から入ったときに台帳が開く日。左ナビから入ったときは本日。 */
  const [ledgerDate, setLedgerDate] = useState<LocalDate | null>(null)
  // 個人トップの 1 行から来たとき、台帳のその帯の詳細を開いた状態で出す。
  const [openReservation, setOpenReservation] = useState<string | null>(null)
  const [stores, setStores] = useState<Store[] | null>(null)
  /**
   * いま見ているお店。トップの「◯◯へ切り替える」で変える。
   * `null` の間は既定（`isActive` の 1 店目）を見る。
   * **横断で見るのではなく、切り替えてから操作する設計**（`services/.../AGENTS.md`）。
   */
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)
  /** 上のバーの営業状態を出すための、この店舗の曜日ごとの営業時間。 */
  const [businessHours, setBusinessHours] = useState<BusinessHoursRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 顧客台帳の「この方のご予約を取る」（AC-CUST-26）から来たときの、その方。
  // 工程 4 のお名前・ふりがな・お電話番号をこれで埋める。
  const [bookingCustomer, setBookingCustomer] = useState<{
    /** その方の id。予約に結び付けるので、名前と一緒に必ず運ぶ。 */
    id?: string
    name: string
    kana: string
    phone: string | null
  } | null>(null)
  // 上のバーの中央。台帳が日付の帯を差し込む（モックの `.datepill` の置き場所）。
  const [barCenter, setBarCenter] = useState<ReactNode>(null)
  // 来店受付ボードの「＋ ご来店を受け付ける」から台帳へ来たか（受付パネルを開いて出す）。
  const [walkinPanel, setWalkinPanel] = useState(false)
  // 受付履歴の絞り込み。「予約を開く」で台帳へ移っても、戻ったときに同じ条件へ戻す。
  const [historyQuery, setHistoryQuery] = useState<HistoryFilters | undefined>(undefined)
  /*
   * 予約を探す面の小見出し。行き先の名前（サイドバーの「予約を探す」）とは別の 2 段で、
   * 面が進むと「予約の変更　EY-2608-0142」へ変わる（`design/05-screen-flow.md` §2.2）。
   */
  const [changeSubline, setChangeSubline] = useState('予約を変更する')
  // 予約を探す面の「顧客台帳で調べる」から来たとき、入れたお名前を検索欄へ引き継ぐ
  // （AC-CHANGE-24）。台帳をふつうに開いたときは空のまま。
  const [customerQuery, setCustomerQuery] = useState('')
  const [startPhase, setStartPhase] = useState<
    'loading' | 'device' | 'staff' | 'place' | 'pin' | 'ready'
  >('loading')
  const [terminalMode, setTerminalMode] = useState<'personal' | 'shared' | null>(null)
  const [terminals, setTerminals] = useState<Terminal[]>([])
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([])
  const [offIds, setOffIds] = useState<ReadonlySet<string>>(new Set())
  const [selectedTerminal, setSelectedTerminal] = useState<Terminal | null>(null)
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null)
  const [terminalSession, setTerminalSession] = useState<TerminalSession | null>(null)
  /*
   * いま業務が始まっているか。お店を読み直す effect から読むが、**依存には入れない** ——
   * 入れると業務を始めた瞬間に読み直しが走り、開いたばかりの面が作り直される。
   */
  const sessionRef = useRef<TerminalSession | null>(null)
  sessionRef.current = terminalSession
  const [pinFailure, setPinFailure] = useState<{
    remainingAttempts?: number
    retryAfterSeconds?: number
  }>({})
  const [alertCount, setAlertCount] = useState(0)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [lastSyncedLabel, setLastSyncedLabel] = useState<string | null>(null)
  const [nextRetryLabel, setNextRetryLabel] = useState<string | null>(null)
  const [personalModeSubject, setPersonalModeSubject] = useState<string | null>(null)
  /** 変更の面をどの工程から開くか（台帳の「変更する」／「取り消す」で分かれる）。 */
  const [changeIntent, setChangeIntent] = useState<'datetime' | 'slot' | 'cancel'>('datetime')
  /** 利用者が自分でサイドバーの幅を決めたか。決めたあとは画面ごとの既定を当てない。 */
  const [railTouched, setRailTouched] = useState(false)
  /** この業務のあいだに一度でも開いた画面。既定の幅は初回だけ当てる。 */
  const visitedRef = useRef<Set<string>>(new Set(['home']))
  const [lockSnapshot, setLockSnapshot] = useState<{
    customerName: string
    customerPhone: string
    time: string
    count: number
  } | null>(null)

  const load = useCallback(async () => {
    const res = await client.api.staff.stores.$get()
    const status: number = res.status
    if (status === 401) {
      onSignOut()
      return
    }
    if (status === 503) {
      setError('お店の情報がまだ届いていません。しばらくしてからもう一度開いてください。')
      setStartPhase('ready')
      return
    }
    if (!res.ok) {
      setError('お店の情報を読み込めませんでした。画面を開き直してください。')
      setStartPhase('ready')
      return
    }
    const found = (await res.json()) as Store[]
    setStores(found)
    if (found.length === 0) setStartPhase('ready')
    setLastSyncedLabel(
      new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        hour: 'numeric',
        minute: '2-digit',
        hour12: false,
      }).format(now()),
    )
  }, [now, onSignOut])

  const selectedAutoLock = selectedTerminal?.autoLockSeconds ?? 120
  const clockNow = useCallback(() => now().getTime(), [now])
  const idle = useIdle({
    enabled: terminalSession?.mode === 'shared',
    idleAfterMs: selectedAutoLock * 1000,
    now: clockNow,
    onResume: () => {
      load().catch(() => undefined)
    },
  })
  const personalIdle = useIdle({
    enabled: terminalSession?.mode === 'personal',
    idleAfterMs: 120_000,
    now: clockNow,
  })

  useEffect(() => {
    load().catch(() => {
      setError('通信できませんでした。画面を開き直してください。')
      setStartPhase('ready')
    })
  }, [load])

  useEffect(() => {
    const connected = () => {
      setOnline(true)
      setNextRetryLabel(null)
    }
    const disconnected = () => {
      setOnline(false)
      setNextRetryLabel(
        new Intl.DateTimeFormat('ja-JP', {
          timeZone: 'Asia/Tokyo',
          hour: 'numeric',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(now().getTime() + 60_000)),
      )
    }
    window.addEventListener('online', connected)
    window.addEventListener('offline', disconnected)
    return () => {
      window.removeEventListener('online', connected)
      window.removeEventListener('offline', disconnected)
    }
  }, [now])

  useEffect(() => {
    if (online || idle.isMasked) return undefined
    let live = true
    let timer: number

    const retry = async () => {
      await load().catch(() => undefined)
      if (!live) return
      if (navigator.onLine) {
        setOnline(true)
        setNextRetryLabel(null)
        return
      }
      setNextRetryLabel(
        new Intl.DateTimeFormat('ja-JP', {
          timeZone: 'Asia/Tokyo',
          hour: 'numeric',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(now().getTime() + 60_000)),
      )
      timer = window.setTimeout(retry, 60_000)
    }

    timer = window.setTimeout(retry, 60_000)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [idle.isMasked, load, now, online])

  useEffect(() => {
    const required = (event: Event) => {
      const detail = (event as CustomEvent<{ subject?: unknown }>).detail
      if (typeof detail?.subject === 'string') setPersonalModeSubject(detail.subject)
    }
    window.addEventListener('eyex:personal-mode-required', required)
    return () => window.removeEventListener('eyex:personal-mode-required', required)
  }, [])

  // 共有端末では、前のお客様の入力をブラウザ候補へ残さない。後から開いた面も監視する。
  useEffect(() => {
    if (terminalSession?.mode !== 'shared') return undefined
    const disable = (root: ParentNode) => {
      for (const field of root.querySelectorAll('input, textarea')) {
        field.setAttribute('autocomplete', 'off')
      }
    }
    disable(document)
    const observer = new MutationObserver(() => disable(document))
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [terminalSession?.mode])

  useEffect(() => {
    const elevated = (event: Event) => {
      const session = (event as CustomEvent<TerminalSession>).detail
      storeTerminalSession(session.terminalId, session.sessionToken)
      setTerminalSession(session)
    }
    window.addEventListener('eyex:terminal-session', elevated)
    return () => window.removeEventListener('eyex:terminal-session', elevated)
  }, [])

  useEffect(() => {
    const updated = (event: Event) => {
      const terminal = (event as CustomEvent<Terminal>).detail
      if (!terminal || typeof terminal.id !== 'string') return
      setTerminals((rows) => rows.map((row) => (row.id === terminal.id ? terminal : row)))
      if (sessionStorage.getItem(TERMINAL_ID_KEY) !== terminal.id) return
      setSelectedTerminal(terminal)
      setTerminalMode(terminal.kind)
      localStorage.setItem(`eyex.terminal-mode.${org}`, terminal.kind)
    }
    window.addEventListener('eyex:terminal-updated', updated)
    return () => window.removeEventListener('eyex:terminal-updated', updated)
  }, [org])

  function navigate(key: string, reservationId: string | null = null, walkin = false) {
    if (key !== 'customers') setCustomerQuery('')
    setCurrent(key)
    setOpenReservation(reservationId)
    setWalkinPanel(walkin)
    /*
     * サイドバーの幅は**その画面を初めて開いたときだけ**既定を当てる。
     * 以前は移動のたびに当てていたので、操作していないのに 216px と 76px を
     * 行き来し、本文が 140px 横に飛んでいた（UX 監査 UI-04）。
     * 一度でも利用者が自分でたたむ／ひらいたら、以後は既定を当てない。
     */
    if (!railTouched && !visitedRef.current.has(key)) setRail(RAIL_BY_DEFAULT.has(key))
    visitedRef.current.add(key)
  }

  /**
   * 台帳の詳細から「変更する」「取り消す」。
   * **押した予約をそのまま持っていく。** 予約 id を渡さないと、受話器を持ったまま
   * まっさらな検索画面に降ろされ、いま画面に出ていたお名前を打ち直すことになる。
   */
  function openChange(reservationId: string, intent: 'datetime' | 'slot' | 'cancel') {
    setChangeIntent(intent)
    navigate('search', reservationId)
  }

  /*
   * お店を切り替える。**その店で見ていた条件は持ち越さない。**
   * 台帳の日付・受付履歴の絞り込み・開いていたご予約は、いまの店の中でしか
   * 意味を持たない。持ち越すと、切り替えた先で「先週の絞り込みのまま 0 件」や
   * 「他店のご予約 id を開こうとして見つかりません」になる
   * （実装不足の洗い出し foundation-08）。
   */
  function switchStore(storeId: string) {
    setSelectedStoreId(storeId)
    setLedgerDate(null)
    setHistoryQuery(undefined)
    setOpenReservation(null)
    setCustomerQuery('')
  }

  /** 顧客台帳から「ご予約を取る」（AC-CUST-26）。渡さなければ、いつもの白紙の受付になる。 */
  function startBooking(customer?: {
    id?: string
    name: string
    kana: string
    phone: string | null
  }) {
    setBookingCustomer(customer ?? null)
    navigate('book')
  }

  const store =
    stores?.find((s) => s.id === selectedStoreId) ?? stores?.find((s) => s.isActive) ?? stores?.[0]

  useEffect(() => {
    if (!store) return
    let live = true
    const today = toJstDateString(now())
    Promise.all([
      auth.authFetch(`/api/staff/terminals?storeId=${encodeURIComponent(store.id)}`),
      auth.authFetch(`/api/staff/stores/${store.id}/staff`),
      auth.authFetch(`/api/staff/stores/${store.id}/staff-shifts?from=${today}&to=${today}`),
      auth.authFetch(`/api/staff/alerts?storeId=${encodeURIComponent(store.id)}&kind=all&limit=1`),
      auth.authFetch(`/api/staff/stores/${store.id}/business-hours`),
    ])
      .then(
        async ([terminalResponse, staffResponse, shiftResponse, alertResponse, hoursResponse]) => {
          if (!live) return
          if (hoursResponse.ok) {
            const hours = (await hoursResponse.json()) as { rows?: BusinessHoursRow[] }
            setBusinessHours(hours.rows ?? null)
          }
          if (alertResponse.ok) {
            const alerts = (await alertResponse.json()) as { counts?: { all?: number } }
            setAlertCount(alerts.counts?.all ?? 0)
          }
          if (!terminalResponse.ok) {
            setStartPhase('ready')
            return
          }
          const foundTerminals = (await terminalResponse.json()) as Terminal[]
          if (foundTerminals.length === 0) {
            setStartPhase('ready')
            return
          }
          const foundStaff = staffResponse.ok ? ((await staffResponse.json()) as StaffMember[]) : []
          const foundShifts = shiftResponse.ok ? ((await shiftResponse.json()) as StaffShift[]) : []
          setTerminals(foundTerminals)
          setStaffMembers(foundStaff)
          setOffIds(
            new Set(
              foundStaff
                .filter(
                  (member) =>
                    !foundShifts.some(
                      (shift) => shift.staffId === member.id && shift.kind === 'work',
                    ),
                )
                .map((member) => member.id),
            ),
          )
          /*
           * **すでに業務が始まっているなら、入口へ戻さない。**
           * この面はお店が変わるたびに読み直すが、以前はそのたびに端末の選び直しと
           * 暗証番号の入力へ引き戻していた。トップの「◯◯へ切り替える」を押しただけで
           * 業務画面から追い出され、店舗の切り替えが実質使えなかった
           * （実装不足の洗い出し foundation-07。US-FOUND-06 / T-016）。
           * 端末の一覧とスタッフはこの下で入れ替わっているので、切り替えた先の
           * お店のものがそのまま効く。
           */
          if (sessionRef.current !== null) {
            setStartPhase('ready')
            return
          }
          const saved = localStorage.getItem(`eyex.terminal-mode.${org}`)
          if (saved === 'personal' || saved === 'shared') {
            setTerminalMode(saved)
            setStartPhase(saved === 'personal' ? 'staff' : 'place')
          } else {
            setStartPhase('device')
          }
        },
      )
      .catch(() => {
        if (live) setStartPhase('ready')
      })
    return () => {
      live = false
    }
  }, [now, org, store])

  useEffect(() => {
    if (!personalIdle.isMasked || terminalSession?.mode !== 'personal') return
    setTerminalSession({ ...terminalSession, mode: 'shared', staffId: null })
  }, [personalIdle.isMasked, terminalSession])

  async function startTerminalSession(pin: string) {
    if (!selectedTerminal || !terminalMode) return
    const response = await auth.authFetch(`/api/staff/terminals/${selectedTerminal.id}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        terminalMode === 'personal'
          ? { mode: 'personal', staffId: selectedStaff?.id, pin }
          : { mode: 'shared', pin },
      ),
    })
    if (response.status === 401 || response.status === 429) {
      const failure = (await response.json()) as {
        remainingAttempts: number
        retryAfterSeconds?: number
      }
      setPinFailure({
        remainingAttempts: failure.remainingAttempts,
        ...(failure.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: failure.retryAfterSeconds }),
      })
      return
    }
    if (!response.ok) {
      setError('業務を始められませんでした。通信を確かめて、もう一度お試しください。')
      return
    }
    const session = (await response.json()) as TerminalSession
    storeTerminalSession(session.terminalId, session.sessionToken)
    setTerminalSession(session)
    setPinFailure({})
    setStartPhase('ready')
  }

  async function endTerminalSession() {
    if (terminalSession && selectedTerminal) {
      await domainFetch(
        `/api/staff/terminals/${selectedTerminal.id}/sessions/${terminalSession.id}`,
        {
          method: 'DELETE',
        },
      ).catch(() => undefined)
    }
    clearTerminalSession()
    setTerminalSession(null)
    setStartPhase(terminalMode === 'personal' ? 'staff' : 'place')
  }

  if (startPhase === 'loading') {
    return (
      <p role="status" className="p-11 text-body text-ink-muted">
        読み込んでいます…
      </p>
    )
  }
  if (startPhase === 'device') {
    return (
      <DeviceMode
        deviceLabel={terminals[0]?.deviceLabel || 'この iPad'}
        onPersonal={() => {
          localStorage.setItem(`eyex.terminal-mode.${org}`, 'personal')
          setTerminalMode('personal')
          setStartPhase('staff')
        }}
        onShared={() => {
          localStorage.setItem(`eyex.terminal-mode.${org}`, 'shared')
          setTerminalMode('shared')
          setStartPhase('place')
        }}
      />
    )
  }
  if (startPhase === 'staff') {
    return (
      <StaffPick
        staff={staffMembers}
        offIds={offIds}
        onSelect={(member) => {
          setSelectedStaff(member)
          const terminal = terminals[0] ?? null
          setSelectedTerminal(terminal)
          if (terminal) sessionStorage.setItem(TERMINAL_ID_KEY, terminal.id)
          setStartPhase('pin')
        }}
        onShared={() => {
          localStorage.setItem(`eyex.terminal-mode.${org}`, 'shared')
          setTerminalMode('shared')
          setStartPhase('place')
        }}
      />
    )
  }
  if (startPhase === 'place') {
    return (
      <PlacePick
        terminals={terminals}
        onSelect={(terminal) => {
          setSelectedTerminal(terminal)
          sessionStorage.setItem(TERMINAL_ID_KEY, terminal.id)
          setStartPhase('pin')
        }}
        onChangeMode={() => setStartPhase('device')}
      />
    )
  }
  if (startPhase === 'pin' && selectedTerminal) {
    return (
      <PinEntry
        key={`${terminalMode}:${selectedStaff?.id ?? selectedTerminal.id}:${pinFailure.remainingAttempts ?? 'new'}`}
        kind={terminalMode ?? 'shared'}
        title={
          terminalMode === 'personal'
            ? (selectedStaff?.displayName ?? 'スタッフ')
            : selectedTerminal.name
        }
        detail={
          terminalMode === 'personal'
            ? `${selectedStaff?.jobLabel ?? '担当'} ／ 本日の勤務`
            : selectedTerminal.placeNote
        }
        {...pinFailure}
        onSubmit={(pin) =>
          startTerminalSession(pin).catch(() => setError('通信できませんでした。'))
        }
        onBack={() => setStartPhase(terminalMode === 'personal' ? 'staff' : 'place')}
      />
    )
  }

  if (personalModeSubject !== null && selectedTerminal !== null) {
    return (
      <PersonalMode
        subject={personalModeSubject}
        staff={staffMembers}
        offIds={offIds}
        onCancel={() => setPersonalModeSubject(null)}
        onConfirm={async (staffId, pin) => {
          const response = await domainFetch(
            `/api/staff/terminals/${selectedTerminal.id}/elevate`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                staffId,
                pin,
                reason: personalModeSubject.includes('録音') ? 'recording' : 'attention',
              }),
            },
          )
          if (!response.ok) return false
          const session = (await response.json()) as TerminalSession
          storeTerminalSession(session.terminalId, session.sessionToken)
          setTerminalSession(session)
          setSelectedStaff(staffMembers.find((member) => member.id === staffId) ?? null)
          setPersonalModeSubject(null)
          return true
        }}
      />
    )
  }

  /*
   * 予約の受付（BOOK-01〜06）は**サイドバーを出さない**（`design/05-screen-flow.md` §3.3）ので、
   * `AppShell` を通さずに面ごと入れ替える。出口はどちらもトップへ戻る。
   */
  if (current === 'book') {
    return store ? (
      <div className="relative h-dvh">
        {idle.isMasked ? null : (
          <BookingScreen
            storeId={store.id}
            storeName={store.name}
            initialCustomer={bookingCustomer ?? undefined}
            isOffline={!online}
            onExit={() => {
              setBookingCustomer(null)
              navigate('home')
            }}
            onOpenLedger={() => navigate('ledger')}
            onSessionExpired={onSignOut}
          />
        )}
        {!online && !idle.isMasked && (
          <div className="absolute inset-x-0 top-0 z-6">
            <OfflineBand
              lastSyncedLabel={lastSyncedLabel}
              nextRetryLabel={nextRetryLabel}
              onRetry={() => {
                setOnline(navigator.onLine)
                load().catch(() => undefined)
              }}
            />
          </div>
        )}
        {idle.isMasked && (
          <LockVeil
            fullScreen
            snapshot={lockSnapshot ?? undefined}
            onContinue={idle.resume}
            onEndSession={() => endTerminalSession()}
          />
        )}
      </div>
    ) : (
      <p role="status" className="p-11 text-body text-ink-muted">
        読み込んでいます…
      </p>
    )
  }

  return (
    <AppShell
      // 店舗が分からないときに屋号を作らない。利用者が入れたコードをそのまま出す。
      storeName={store ? store.name : org}
      storeSubline={
        current === 'home'
          ? idle.isMasked && selectedTerminal
            ? `${selectedTerminal.name}（みんなで使う端末）`
            : (openStateLabel(businessHours, now()) ?? '')
          : current === 'alerts'
            ? 'お知らせとアラート'
            : current === 'search'
              ? changeSubline
              : (DESTINATIONS.find((destination) => destination.key === current)?.label ?? '')
      }
      current={current}
      onNavigate={(key) => navigate(key)}
      rail={rail}
      onToggleRail={() => {
        setRailTouched(true)
        setRail((v) => !v)
      }}
      isLocked={idle.isMasked}
      alertCount={alertCount}
      terminalNote={
        terminalSession?.mode === 'personal'
          ? [`${selectedStaff?.displayName ?? 'スタッフ'}の iPad`, '個人で使っています']
          : terminalSession?.mode === 'shared' && selectedTerminal
            ? [selectedTerminal.name, '共有で使っています']
            : [`${org} の端末`, '共有で使っています']
      }
      barCenter={barCenter}
      overlay={
        idle.isMasked ? (
          <LockVeil
            snapshot={lockSnapshot ?? undefined}
            onContinue={idle.resume}
            onEndSession={() => endTerminalSession()}
          />
        ) : null
      }
      barActions={
        terminalSession === null || terminalSession.mode === 'personal' ? (
          <button
            type="button"
            onClick={terminalSession === null ? onSignOut : () => endTerminalSession()}
            className={`min-h-12 min-w-15 rounded-card px-2 text-lead font-semibold text-on-pine ${focusRingOnPine}`}
          >
            業務を終える
          </button>
        ) : null
      }
    >
      {idle.isMasked ? null : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {!online && (
            <OfflineBand
              lastSyncedLabel={lastSyncedLabel}
              nextRetryLabel={nextRetryLabel}
              onRetry={() => {
                setOnline(navigator.onLine)
                load().catch(() => undefined)
              }}
            />
          )}
          {error && (
            <div className="px-11 pt-11">
              <Notice>{error}</Notice>
            </div>
          )}
          {current === 'home' ? (
            <Home
              stores={stores}
              currentStoreId={store?.id}
              onSwitchStore={switchStore}
              showSharedReservations={idle.isMasked}
              sharedTerminal={terminalSession?.mode === 'shared'}
              onSharedSnapshot={setLockSnapshot}
              onOpenReservation={(id) => navigate('ledger', id)}
              onOpenLedger={() => {
                setLedgerDate(null)
                navigate('ledger')
              }}
              today={toJstDateString(new Date())}
              onPickDate={(date) => {
                setLedgerDate(date)
                navigate('ledger')
              }}
              onStartBooking={() => startBooking()}
              onOpenSearch={() => navigate('search')}
            />
          ) : current === 'ledger' ? (
            store ? (
              <LedgerScreen
                storeId={store.id}
                initialDate={ledgerDate ?? undefined}
                initialReservationId={openReservation ?? undefined}
                initialWalkinOpen={walkinPanel}
                onBarCenter={setBarCenter}
                onOpenSettings={() => navigate('settings')}
                onOpenCheckin={(reservationId) => navigate('reception', reservationId)}
                onOpenChange={(reservationId) => openChange(reservationId, 'datetime')}
                onOpenCancel={(reservationId) => openChange(reservationId, 'cancel')}
                /* Web からのご予約の「内容を確認」。担当が空のまま 24:00 を越えると
                   日次 Cron が黙って取り消すので、担当を決める面へ直に運ぶ
                   （UX 監査 NEW-05）。 */
                onOpenReview={(reservationId) => openChange(reservationId, 'slot')}
                onSessionExpired={onSignOut}
                isOffline={!online}
              />
            ) : (
              <p className="p-11 text-body text-ink-muted">読み込んでいます…</p>
            )
          ) : current === 'reception' ? (
            /* 来店受付。盤面と受け付ける面の行き来はこの器の中で起き、URL を持たない。
             「＋ ご来店を受け付ける」の行き先は台帳（店頭の受付パネルはそちらにある）。
             ご予約のお客様を受け付ける入口も台帳の予約リストの「ご来店」で、そこから
             来たときだけ `initialCheckinId` を持って開く（盤面に載るのはお着きの方だけ）。 */
            store ? (
              <ReceptionScreen
                storeId={store.id}
                onOpenLedger={() => navigate('ledger', null, true)}
                {...(openReservation === null ? {} : { initialCheckinId: openReservation })}
                onSessionExpired={onSignOut}
                isOffline={!online}
              />
            ) : (
              <p className="p-11 text-body text-ink-muted">読み込んでいます…</p>
            )
          ) : current === 'history' ? (
            /* 受付履歴（HISTORY-LIST / HISTORY-EMPTY）。絞り込みは面の中に持つ。
             「予約を開く」は台帳のその帯の詳細へ渡し、戻ると同じ絞り込みへ戻る
             （器が `historyQuery` に控えている）。 */
            store ? (
              <HistoryPane
                storeId={store.id}
                now={now}
                initialQuery={historyQuery}
                onQueryChange={setHistoryQuery}
                onOpenReservation={(id) => navigate('ledger', id)}
                onStartBooking={() => startBooking()}
              />
            ) : (
              <p className="p-11 text-body text-ink-muted">読み込んでいます…</p>
            )
          ) : current === 'search' ? (
            /* 予約を探す・直す（CHANGE-SEARCH / CHANGE-DATETIME / CHANGE-DIFF /
             CHANGE-CANCEL / CHANGE-DONE / EX-CONFLICT）。面の中の行き来は器が持ち、
             URL を持たない。時刻は器が自分で起こす —— 仮の押さえの残りを 1 秒ずつ
             進めるので、App の描画に縛らない。 */
            store ? (
              <ChangeScreen
                storeId={store.id}
                storeName={store.name}
                initialReservationId={openReservation ?? undefined}
                initialStep={changeIntent}
                onSubline={setChangeSubline}
                onOpenCustomers={(name) => {
                  navigate('customers')
                  setCustomerQuery(name)
                }}
                onStartBooking={() => startBooking()}
                onOpenLedger={() => navigate('ledger')}
                onGoHome={() => navigate('home')}
                onSessionExpired={onSignOut}
                isOffline={!online}
              />
            ) : (
              <p className="p-11 text-body text-ink-muted">読み込んでいます…</p>
            )
          ) : current === 'customers' ? (
            store ? (
              <CustomerScreen
                storeId={store.id}
                stores={stores}
                initialQuery={customerQuery}
                onStartBooking={(customer) => startBooking(customer)}
                onSessionExpired={onSignOut}
              />
            ) : (
              <p className="p-11 text-body text-ink-muted">読み込んでいます…</p>
            )
          ) : current === 'alerts' ? (
            store ? (
              <AlertScreen
                storeId={store.id}
                now={now}
                onCountChange={setAlertCount}
                onOpenLedger={(reservationId) => navigate('ledger', reservationId)}
              />
            ) : (
              <p className="p-11 text-body text-ink-muted">読み込んでいます…</p>
            )
          ) : current === 'settings' ? (
            store ? (
              <SettingsScreen storeId={store.id} />
            ) : (
              <p className="p-11 text-body text-ink-muted">読み込んでいます…</p>
            )
          ) : current === 'analytics' ? (
            store ? (
              <AnalyticsPane
                storeId={store.id}
                stores={stores ?? []}
                onSessionExpired={onSignOut}
                onBack={() => navigate('home')}
              />
            ) : (
              <p className="p-11 text-body text-ink-muted">読み込んでいます…</p>
            )
          ) : (
            <p className="p-11 text-body text-ink-muted">この画面はこれから作ります。</p>
          )}
        </div>
      )}
    </AppShell>
  )
}

function Home({
  stores,
  currentStoreId,
  onSwitchStore,
  showSharedReservations,
  sharedTerminal,
  onSharedSnapshot,
  onOpenReservation,
  onOpenLedger,
  today,
  onPickDate,
  onStartBooking,
  onOpenSearch,
}: {
  stores: Store[] | null
  /** ほかのお店へ切り替える。**押して何も起きないチップを置かない。** */
  onSwitchStore: (storeId: string) => void
  currentStoreId?: string
  showSharedReservations: boolean
  sharedTerminal: boolean
  onSharedSnapshot: (snapshot: {
    customerName: string
    customerPhone: string
    time: string
    count: number
  }) => void
  onOpenReservation: (reservationId: string) => void
  onOpenLedger: () => void
  /** サーバの今日（JST の暦日）。1 週間の帯が読む。端末の時計は読まない。 */
  today: LocalDate
  /** 帯の日を押した。その日の台帳を開く。 */
  onPickDate: (date: LocalDate) => void
  /** 受付の 5 工程へ入る。マイクの許可はこの指の操作の中で求める（Safari の制約）。 */
  onStartBooking: () => void
  /** 予約を探す・直す面（CHANGE-SEARCH）へ移る。 */
  onOpenSearch: () => void
}) {
  const others = stores?.filter((s) => s.id !== currentStoreId) ?? []
  return (
    <div className="relative h-full">
      <div className="grid h-full grid-flow-col content-center justify-start gap-12 pb-31 pl-11">
        <div className="grid content-center gap-6">
          <PrimaryAction
            title="新しい予約を取る"
            note="お電話・ご来店のお客様"
            tone="pine"
            glyph="☎"
            onPress={onStartBooking}
          />
          <PrimaryAction
            title="予約を変更する"
            note="日時・内容の変更、取り消し"
            tone="walkin"
            glyph="✎"
            onPress={onOpenSearch}
          />
          <section aria-label="ほかのお店" className="mt-2">
            {stores === null ? (
              <p className="text-grid text-ink-muted">読み込んでいます…</p>
            ) : stores.length === 0 ? (
              <p className="text-grid text-ink-muted">お店がまだ登録されていません。</p>
            ) : others.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {others.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onSwitchStore(s.id)}
                      className={`min-h-11 rounded-full border border-line-strong bg-surface px-4 text-note font-semibold text-ink-muted ${focusRing}`}
                    >
                      {s.name}へ切り替える
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
        {currentStoreId !== undefined && (
          <MyReservations
            storeId={currentStoreId}
            showShared={showSharedReservations}
            sharedTerminal={sharedTerminal}
            onSharedSnapshot={onSharedSnapshot}
            onOpen={onOpenReservation}
            onOpenLedger={onOpenLedger}
          />
        )}
      </div>
      {/*
        1 週間の帯は本文の下辺に置く（承認済みモック HOME.png の `.days`。
        左右 44px・下 44px）。ここが空いていたあいだ、トップは今日について
        何も言っていなかった（UX 監査 J-01）。
      */}
      <div className="absolute right-11 bottom-11 left-11">
        <WeekStrip today={today} onPickDate={onPickDate} onOpenCalendar={onOpenLedger} />
      </div>
    </div>
  )
}

function PrimaryAction({
  title,
  note,
  tone,
  glyph,
  onPress,
}: {
  title: string
  note: string
  tone: 'pine' | 'walkin'
  glyph: string
  onPress?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`flex min-h-33 w-180 items-center gap-6 rounded-panel border border-line-strong bg-surface px-8 text-left ${focusRing}`}
    >
      <span
        aria-hidden="true"
        className={`grid size-16 shrink-0 place-items-center rounded-circle text-hero text-on-pine ${
          tone === 'pine' ? 'bg-pine' : 'bg-walkin'
        }`}
      >
        {glyph}
      </span>
      <span>
        <span className="block text-hero font-bold text-ink">{title}</span>
        <span className="mt-1 block text-lead font-normal text-ink-muted">{note}</span>
      </span>
    </button>
  )
}

/**
 * 受付履歴の器。面が要る「本日（JST）」と担当の顔ぶれだけをここで揃える
 * （`ReceptionHistory` は端末の時計を読まない決めなので、暦日は外から渡す）。
 */
function HistoryPane({
  storeId,
  now,
  initialQuery,
  onQueryChange,
  onOpenReservation,
  onStartBooking,
}: {
  storeId: string
  now: () => Date
  initialQuery?: HistoryFilters
  onQueryChange: (filters: HistoryFilters) => void
  onOpenReservation: (reservationId: string) => void
  onStartBooking: () => void
}) {
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const today = toJstDateString(now())

  useEffect(() => {
    let live = true
    client.api.staff.stores[':storeId'].staff
      .$get({ param: { storeId } })
      .then(async (res) => {
        if (!live || !res.ok) return
        const rows: StaffMember[] = await res.json()
        if (live) setStaff(rows.map((row) => ({ id: row.id, name: row.displayName })))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [storeId])

  return (
    <ReceptionHistory
      storeId={storeId}
      today={today}
      staff={staff}
      {...(initialQuery === undefined ? {} : { initialQuery })}
      onQueryChange={onQueryChange}
      onOpenReservation={onOpenReservation}
      onStartBooking={onStartBooking}
    />
  )
}
