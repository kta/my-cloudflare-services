import type { Store } from '@app/contracts'
import { auth } from '@app/shared'
import { Button, Field, focusRing, focusRingOnPine, Notice, TextInput } from '@app/ui'
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import { BookingScreen } from './booking/BookingScreen'
import { client } from './client'
import { MyReservations } from './home/MyReservations'
import { LedgerScreen } from './ledger/LedgerScreen'
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
  // 上のバーの中央。台帳が日付の帯を差し込む（モックの `.datepill` の置き場所）。
  const [barCenter, setBarCenter] = useState<ReactNode>(null)

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

  function navigate(key: string, reservationId: string | null = null) {
    setCurrent(key)
    setOpenReservation(reservationId)
    setRail(RAIL_BY_DEFAULT.has(key))
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
        onExit={() => navigate('home')}
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
            onStartBooking={() => navigate('book')}
          />
        ) : current === 'ledger' ? (
          store ? (
            <LedgerScreen
              storeId={store.id}
              initialReservationId={openReservation ?? undefined}
              onBarCenter={setBarCenter}
              onOpenSettings={() => navigate('settings')}
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
}: {
  stores: Store[] | null
  currentStoreId?: string
  onOpenReservation: (reservationId: string) => void
  onOpenLedger: () => void
  /** 受付の 5 工程へ入る。マイクの許可はこの指の操作の中で求める（Safari の制約）。 */
  onStartBooking: () => void
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
