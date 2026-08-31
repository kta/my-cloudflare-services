import type { StaffMember, Store } from '@app/contracts'
import { auth, toJstDateString } from '@app/shared'
import { Button, Field, focusRing, focusRingOnPine, Notice, TextInput } from '@app/ui'
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import { AnalyticsScreen } from './analytics/AnalyticsScreen'
import { BookingScreen } from './booking/BookingScreen'
import { ChangeScreen } from './change/ChangeScreen'
import { client } from './client'
import { CustomerScreen } from './customers/CustomerScreen'
import { MyReservations } from './home/MyReservations'
import { LedgerScreen } from './ledger/LedgerScreen'
import { type HistoryFilters, ReceptionHistory } from './reception/ReceptionHistory'
import { ReceptionScreen } from './reception/ReceptionScreen'
import { SettingsScreen } from './settings/SettingsScreen'
import { AppShell } from './shell/AppShell'
import { DESTINATIONS, RAIL_BY_DEFAULT } from './shell/destinations'

/*
 * P0（基盤）の画面。承認済みモック docs/frontend/mockups/eyex/images/HOME.png の
 * 骨格 —— 上のバー・左サイドバー・主操作 2 つ・下辺の日付の帯 —— をここで確立し、
 * 以降のフェーズがこの器の中に画面を足していく。
 *
 * 引き算の決め（mockups/eyex/README.md）: 主役は 1 画面に 1 つ、白い箱は 3 枚まで、
 * 説明文は 2 つまで。空いた場所を埋めるために要素を足さない。
 */

export function App() {
  const [org, setOrg] = useState(() => auth.getOrganization())
  return org ? (
    <Workspace
      org={org}
      onSignOut={() => {
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
    if (!orgId.trim()) {
      setError('お店のコードを入れてください。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await auth.login(orgId.trim())
      onStarted(orgId.trim())
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

function Workspace({ org, onSignOut }: { org: string; onSignOut: () => void }) {
  const [current, setCurrent] = useState('home')
  const [rail, setRail] = useState(false)
  // 個人トップの 1 行から来たとき、台帳のその帯の詳細を開いた状態で出す。
  const [openReservation, setOpenReservation] = useState<string | null>(null)
  const [stores, setStores] = useState<Store[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 顧客台帳の「この方のご予約を取る」（AC-CUST-26）から来たときの、その方。
  // 工程 4 のお名前・ふりがな・お電話番号をこれで埋める。
  const [bookingCustomer, setBookingCustomer] = useState<{
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

  const load = useCallback(async () => {
    const res = await client.api.staff.stores.$get()
    const status: number = res.status
    if (status === 401) {
      onSignOut()
      return
    }
    if (status === 503) {
      setError('お店の情報がまだ届いていません。しばらくしてからもう一度開いてください。')
      return
    }
    if (!res.ok) {
      setError('お店の情報を読み込めませんでした。画面を開き直してください。')
      return
    }
    setStores(await res.json())
  }, [onSignOut])

  useEffect(() => {
    load().catch(() => setError('通信できませんでした。画面を開き直してください。'))
  }, [load])

  function navigate(key: string, reservationId: string | null = null, walkin = false) {
    if (key !== 'customers') setCustomerQuery('')
    setCurrent(key)
    setOpenReservation(reservationId)
    setWalkinPanel(walkin)
    setRail(RAIL_BY_DEFAULT.has(key))
  }

  /** 顧客台帳から「ご予約を取る」（AC-CUST-26）。渡さなければ、いつもの白紙の受付になる。 */
  function startBooking(customer?: { name: string; kana: string; phone: string | null }) {
    setBookingCustomer(customer ?? null)
    navigate('book')
  }

  const store = stores?.find((s) => s.isActive) ?? stores?.[0]

  /*
   * 予約の受付（BOOK-01〜06）は**サイドバーを出さない**（`design/05-screen-flow.md` §3.3）ので、
   * `AppShell` を通さずに面ごと入れ替える。出口はどちらもトップへ戻る。
   */
  if (current === 'book') {
    return store ? (
      <BookingScreen
        storeId={store.id}
        storeName={store.name}
        initialCustomer={bookingCustomer ?? undefined}
        onExit={() => {
          setBookingCustomer(null)
          navigate('home')
        }}
        onOpenLedger={() => navigate('ledger')}
        onSessionExpired={onSignOut}
      />
    ) : (
      <p role="status" className="p-11 text-body text-ink-muted">
        読み込んでいます…
      </p>
    )
  }

  return (
    <AppShell
      storeName={store ? store.name : 'EYEX'}
      storeSubline={
        current === 'home'
          ? '営業中　10:00–19:00'
          : current === 'search'
            ? changeSubline
            : (DESTINATIONS.find((destination) => destination.key === current)?.label ?? '')
      }
      current={current}
      onNavigate={(key) => navigate(key)}
      rail={rail}
      onToggleRail={() => setRail((v) => !v)}
      terminalNote={[`${org} の端末`, '共有で使っています']}
      barCenter={barCenter}
      barActions={
        <button
          type="button"
          onClick={onSignOut}
          className={`min-h-12 min-w-15 rounded-card px-2 text-lead font-semibold text-on-pine ${focusRingOnPine}`}
        >
          業務を終える
        </button>
      }
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {error && (
          <div className="px-11 pt-11">
            <Notice>{error}</Notice>
          </div>
        )}
        {current === 'home' ? (
          <Home
            stores={stores}
            currentStoreId={store?.id}
            onOpenReservation={(id) => navigate('ledger', id)}
            onOpenLedger={() => navigate('ledger')}
            onStartBooking={() => startBooking()}
            onOpenSearch={() => navigate('search')}
          />
        ) : current === 'ledger' ? (
          store ? (
            <LedgerScreen
              storeId={store.id}
              initialReservationId={openReservation ?? undefined}
              initialWalkinOpen={walkinPanel}
              onBarCenter={setBarCenter}
              onOpenSettings={() => navigate('settings')}
              onOpenCheckin={(reservationId) => navigate('reception', reservationId)}
              onSessionExpired={onSignOut}
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
              onSubline={setChangeSubline}
              onOpenCustomers={(name) => {
                navigate('customers')
                setCustomerQuery(name)
              }}
              onStartBooking={() => startBooking()}
              onOpenLedger={() => navigate('ledger')}
              onGoHome={() => navigate('home')}
              onSessionExpired={onSignOut}
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
        ) : current === 'analytics' ? (
          /* 分析（ANALYTICS-TOP ほか 8 タブ）。期間と店舗はこの面の中で選び、
             「適用」を押したときだけ集計する。店舗は器が引いた一覧をそのまま渡す。 */
          store ? (
            <AnalyticsScreen
              storeId={store.id}
              stores={stores ?? []}
              onBack={() => navigate('home')}
              onSessionExpired={onSignOut}
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
        ) : (
          <p className="p-11 text-body text-ink-muted">この画面はこれから作ります。</p>
        )}
      </div>
    </AppShell>
  )
}

function Home({
  stores,
  currentStoreId,
  onOpenReservation,
  onOpenLedger,
  onStartBooking,
  onOpenSearch,
}: {
  stores: Store[] | null
  currentStoreId?: string
  onOpenReservation: (reservationId: string) => void
  onOpenLedger: () => void
  /** 受付の 5 工程へ入る。マイクの許可はこの指の操作の中で求める（Safari の制約）。 */
  onStartBooking: () => void
  /** 予約を探す・直す面（CHANGE-SEARCH）へ移る。 */
  onOpenSearch: () => void
}) {
  const others = stores?.filter((s) => s.id !== currentStoreId) ?? []
  return (
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
          onOpen={onOpenReservation}
          onOpenLedger={onOpenLedger}
        />
      )}
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
  initialQuery,
  onQueryChange,
  onOpenReservation,
  onStartBooking,
}: {
  storeId: string
  initialQuery?: HistoryFilters
  onQueryChange: (filters: HistoryFilters) => void
  onOpenReservation: (reservationId: string) => void
  onStartBooking: () => void
}) {
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [today] = useState(() => toJstDateString(new Date()))

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
