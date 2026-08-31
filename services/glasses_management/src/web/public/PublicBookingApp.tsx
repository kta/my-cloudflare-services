import type {
  LocalDate,
  PublicAvailabilityResponse,
  PublicStoreDetail,
  PublicStorePurpose,
  PublicStoreSummary,
} from '@app/contracts'
import type { AppType } from '@app/glasses_management'
import { toJstDateString } from '@app/shared'
import { cn, focusRing, focusRingOnPine } from '@app/ui'
import { hc } from 'hono/client'
import { type CSSProperties, type ReactNode, useCallback, useEffect, useState } from 'react'
import { shiftDate } from '../ledger/metrics'
import { DateTimeStep } from './DateTimeStep'
import { PurposeStep } from './PurposeStep'
import {
  BOOKING_STEPS,
  bookingProgressLabel,
  litBars,
  MANAGE_STEPS,
  manageProgressLabel,
  stepCaption,
} from './progress'
import { StoreStep } from './StoreStep'

/*
 * お客様向けの器（承認済みモック docs/frontend/mockups/eyex/images/WEB-01-STORE.png 〜
 * WEB-06-DONE.png と WEB-CANCEL.png の共通部分）。
 *
 * 題材: 電車の中で片手で持ったお客様が、1 問だけ読んで 1 回だけ押す面。
 * トークン計画: 緑 1 色（`--color-pine`）が上のバー・進捗の点いた段・選択・下の主操作を担う。
 *   面は下地（`--color-paper`）と白（`--color-surface`）の 2 段だけ。角は 8/12/16px。書体は 1 書体。
 * シグネチャ: 下端に固定した全幅 56px の緑 1 枚と、その上に 6 本の細い進捗の帯。
 *
 * 実測（screens/WEB-0*.html の <style> と assets/eyex.css）:
 *   上のバー 56px・地 --brand・左に ‹ 48×48px、店名 19px/700・副題 12px（opacity .9）
 *   進捗 白地・下 1px 罫・padding 10px 16px、帯は 4px 高・間 4px・角 2px（→ rounded-full）
 *   本文 padding 32px 28px 120px、下端の固定は左右 28px・下 32px・主操作は全幅 56px/18px
 *   モックの 20px / 18px は theme.css の段（`--text-bar` 19px）へ寄せた。
 *
 * ランドマークは <header> と <main> の 2 つだけ。**<nav> を作らない**（進捗は押せない
 * `role="img"`。`design/05-screen-flow.md` §7）。工程の入力はメモリだけに持ち、
 * お客様の連絡先を localStorage に書かない（`07-nfr.md` §5.3 / §6.6）。
 */

/* --- URL ------------------------------------------------------------------ */

/** お客様がブックマーク・共有する URL の頭。業務画面は `/` 側にそのまま残る。 */
const PUBLIC_PREFIX = '/w/'

/** `/w/ginza` / `/w/ginza/manage` の店舗 slug。公開面でなければ null。 */
export function publicStoreSlug(pathname: string): string | null {
  if (!pathname.startsWith(PUBLIC_PREFIX)) return null
  const slug = pathname.slice(PUBLIC_PREFIX.length).split('/')[0] ?? ''
  return slug === '' ? null : slug
}

/** 業務画面ではなくお客様の面を出すかどうか。 */
export function isPublicPath(pathname: string): boolean {
  return pathname === '/w' || pathname.startsWith(PUBLIC_PREFIX)
}

/** `/w/:slug/manage` から入ったら WEB-CANCEL の 2 手順にする。 */
export function publicFlowOf(pathname: string): PublicFlow {
  return pathname.split('/')[3] === 'manage' ? 'manage' : 'booking'
}

/* --- 公開面のクライアント -------------------------------------------------- */

/**
 * 公開面は未認証なので、`auth.authFetch` を通さない素の `fetch` で作る。
 * 業務画面の `client.ts` と別に持つのは、bearer を 1 度も付けないことを型で保つためである。
 */
const publicClient = hc<AppType>('/')

export type PublicLoaders = {
  stores: () => Promise<PublicStoreSummary[]>
  store: (slug: string) => Promise<PublicStoreDetail>
  purposes: (slug: string) => Promise<PublicStorePurpose[]>
  availability: (
    slug: string,
    purposeId: string,
    from: LocalDate,
    to: LocalDate,
  ) => Promise<PublicAvailabilityResponse>
}

function failed(what: string, status: number): Error {
  return new Error(`${what}: ${status}`)
}

/** 既定の読み取り。工程には関数で渡すので、テストは fetch を差し替えずに書ける。 */
export const publicLoaders: PublicLoaders = {
  stores: async () => {
    const res = await publicClient.api.public.stores.$get({ query: { limit: '3' } })
    if (!res.ok) throw failed('stores', res.status)
    return (await res.json()) as PublicStoreSummary[]
  },
  store: async (slug) => {
    const res = await publicClient.api.public.stores[':storeSlug'].$get({
      param: { storeSlug: slug },
    })
    if (!res.ok) throw failed('store', res.status)
    return (await res.json()) as PublicStoreDetail
  },
  purposes: async (slug) => {
    const res = await publicClient.api.public.stores[':storeSlug'].purposes.$get({
      param: { storeSlug: slug },
    })
    if (!res.ok) throw failed('purposes', res.status)
    return (await res.json()) as PublicStorePurpose[]
  },
  availability: async (slug, purposeId, from, to) => {
    // zValidator が無く hc の型が query を受け取らないので、経路だけ型のついた
    // クライアントに引かせ、query は fetch の側で足す（StaffPanel と同じ手）。
    const res = await publicClient.api.public.stores[':storeSlug'].availability.$get(
      { param: { storeSlug: slug } },
      {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(
            `${String(input)}?${new URLSearchParams({ purposeId, from, to }).toString()}`,
            init,
          ),
      },
    )
    if (!res.ok) throw failed('availability', res.status)
    return (await res.json()) as PublicAvailabilityResponse
  },
}

/* --- 共通の部品 ------------------------------------------------------------ */

/** 読み込み中・空・エラー・通信が切れた、の 4 状態が共有する型（HISTORY-EMPTY と同じ）。 */
export type PublicNoticeProps = {
  heading: string
  reason: string
  /** 次の一手。**1 つだけ**置く。 */
  action: ReactNode
  /** 読み上げに割り込ませるとき。失敗は `alert`、待ちは `status`。 */
  live?: 'status' | 'alert'
}

export function PublicNotice({ heading, reason, action, live }: PublicNoticeProps) {
  return (
    <section role={live} className="mt-7 rounded-card border border-line-strong bg-surface p-4">
      <h2 className="text-bar font-semibold text-ink">{heading}</h2>
      <p className="mt-1.5 text-grid text-ink-muted">{reason}</p>
      <div className="mt-4">{action}</div>
    </section>
  )
}

/** 次の一手の控えめなボタン（もう一度読み込む・次に空きのある週を探す）。 */
export const publicQuietButtonClass = cn(
  'min-h-11 rounded-card border border-line-strong bg-surface px-4 text-body font-semibold text-ink',
  focusRing,
)

let stickyReasonSeq = 0

export type StickyActionProps = {
  label: string
  /** 押せるかどうか。押せないときも `disabled` にせず、理由を必ず添える。 */
  ready: boolean
  reason: string
  onPress: () => void
}

/**
 * 下端に固定した全幅の主操作（この面のシグネチャ）。ソフトキーボードと iPhone の
 * ホームバーに重ならないよう、下の安全領域を足した余白を持つ。
 * `env()` は任意値クラスを書かない決めのため inline のカスタムプロパティ経由で当てる。
 */
export function StickyAction({ label, ready, reason, onPress }: StickyActionProps) {
  const [reasonId] = useState(() => {
    stickyReasonSeq += 1
    return `public-action-reason-${stickyReasonSeq}`
  })
  return (
    <div
      className="sticky bottom-0 mt-auto bg-paper pt-6"
      style={
        {
          '--safe-bottom': 'env(safe-area-inset-bottom, 0px)',
          paddingBottom: 'calc(var(--safe-bottom) + 2rem)',
        } as CSSProperties
      }
    >
      {!ready && (
        <p id={reasonId} className="mb-2 text-grid text-ink-muted">
          {reason}
        </p>
      )}
      <button
        type="button"
        aria-disabled={!ready}
        aria-describedby={ready ? undefined : reasonId}
        onClick={() => {
          if (ready) onPress()
        }}
        className={cn(
          'min-h-14 w-full rounded-card text-bar font-bold',
          ready ? 'bg-pine text-on-pine' : 'bg-busy text-ink-muted',
          ready ? focusRingOnPine : focusRing,
        )}
      >
        {label}
      </button>
    </div>
  )
}

/* --- 器 -------------------------------------------------------------------- */

export type PublicFlow = 'booking' | 'manage'

/** 読み取りの 3 状態。失敗は「通信が切れた」と「それ以外」を区別する。 */
type Load<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'failed'; offline: boolean }

/**
 * 工程 4 以降（WEB-04-FORM / WEB-05-CONFIRM / WEB-06-DONE）と WEB-CANCEL の差し込み口。
 * その 4 面は別のタスクが別のファイルで作るので、器はここだけを開けておく。
 */
export type PublicSeam = {
  flow: PublicFlow
  /** その流れの中の 1 始まりの工程。 */
  step: number
  store: PublicStoreSummary | null
  storeDetail: PublicStoreDetail | null
  purpose: PublicStorePurpose | null
  startsAt: string | null
  next: () => void
  back: () => void
  /** WEB-06-DONE の「予約を変更・取り消す」から WEB-CANCEL の 2 手順へ移る。 */
  toManage: () => void
}

export type PublicBookingAppProps = {
  /** `/w/:storeSlug` の slug。無ければ店舗から伺う。 */
  slug?: string | null
  flow?: PublicFlow
  /** JST の暦日。端末の時計を読ませないための注入口。 */
  today?: LocalDate
  loaders?: PublicLoaders
  laterSteps?: (seam: PublicSeam) => ReactNode
}

/**
 * 何日先まで受けるか。公開面の契約（`PublicStoreDetail`）は受付の窓を返さないので、
 * 画面は既定の 30 日で週送りの端を決める。**本当の関門はサーバ側**（枠が返らない・確定が 409）
 * で、ここは押し間違いを減らすためだけの目安である。
 */
const ACCEPT_UNTIL_DAYS = 30

export function PublicBookingApp({
  slug = null,
  flow: initialFlow = 'booking',
  today = toJstDateString(new Date()),
  loaders = publicLoaders,
  laterSteps,
}: PublicBookingAppProps) {
  const [flow, setFlow] = useState<PublicFlow>(initialFlow)
  const [step, setStep] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [stores, setStores] = useState<Load<readonly PublicStoreSummary[]>>({ state: 'loading' })
  const [store, setStore] = useState<PublicStoreSummary | null>(null)
  const [storeDetail, setStoreDetail] = useState<PublicStoreDetail | null>(null)
  const [purposes, setPurposes] = useState<Load<readonly PublicStorePurpose[]>>({
    state: 'loading',
  })
  const [purpose, setPurpose] = useState<PublicStorePurpose | null>(null)
  const [startsAt, setStartsAt] = useState<string | null>(null)

  // 店舗の一覧。`/w/ginza` で開いたときは、その slug の店舗を選んだ状態で始める。
  useEffect(() => {
    if (flow !== 'booking') return
    let live = true
    setStores({ state: 'loading' })
    loaders
      .stores()
      .then((rows) => {
        if (!live) return
        setStores({ state: 'ready', value: rows })
        setStore((current) => current ?? rows.find((row) => row.slug === slug) ?? null)
      })
      .catch(() => {
        if (live) setStores({ state: 'failed', offline: !navigator.onLine })
      })
    return () => {
      live = false
    }
  }, [flow, loaders, slug, attempt])

  // ご用件と店舗の詳細。店舗が決まった時点で読む（工程 2 に入る前に間に合わせる）。
  useEffect(() => {
    if (store === null) return
    let live = true
    setPurposes({ state: 'loading' })
    Promise.all([loaders.purposes(store.slug), loaders.store(store.slug)])
      .then(([rows, detail]) => {
        if (!live) return
        setPurposes({ state: 'ready', value: rows })
        setStoreDetail(detail)
      })
      .catch(() => {
        if (live) setPurposes({ state: 'failed', offline: !navigator.onLine })
      })
    return () => {
      live = false
    }
  }, [store, loaders, attempt])

  /*
   * 工程の移り。`react-router` を入れず、`history.pushState` と `popstate` だけで足りる
   * （必要なのは「`/w/` で始まるか」「slug は何か」「戻ると 1 工程戻る」の 3 つだけ）。
   * **戻りの正本は控え（history）1 つだけ**にする。`‹` は `history.back()` を呼ぶだけで、
   * 工程を動かすのは popstate である（自前でも戻すと、端末の戻る操作と二重に戻る）。
   */
  const goTo = useCallback((next: number) => {
    setStep(next)
    window.history.pushState({ publicStep: next }, '')
  }, [])

  const goBack = useCallback(() => window.history.back(), [])

  useEffect(() => {
    // いまいる控えを自分のものにしておく。工程 1 より前へ戻ると、ここから外（お客様が
    // ご予約ページへ来る前の画面）へ抜ける。
    window.history.replaceState({ publicStep: 0 }, '')
    function onPop(event: PopStateEvent) {
      const state = event.state as { publicStep?: unknown } | null
      setStep(typeof state?.publicStep === 'number' ? state.publicStep : 0)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const retry = useCallback(() => setAttempt((current) => current + 1), [])

  /*
   * 週の空きの読み取り。**同じ関数のまま渡す** —— `DateTimeStep` はこれを `useEffect` の
   * 依存に置いているので、描き直すたびに新しい関数を渡すと読み直しが止まらない。
   */
  const loadWeek = useCallback(
    (from: LocalDate, to: LocalDate): Promise<PublicAvailabilityResponse> =>
      store === null || purpose === null
        ? Promise.resolve({ days: [] })
        : loaders.availability(store.slug, purpose.id, from, to),
    [loaders, store, purpose],
  )

  const steps = flow === 'booking' ? BOOKING_STEPS : MANAGE_STEPS
  const stepNumber = Math.min(step + 1, steps.length)
  const caption = stepCaption(
    stepNumber,
    steps.length,
    steps[step]?.label ?? '',
    flow === 'booking' ? 'ステップ' : '手順',
  )
  const progress =
    flow === 'booking' ? bookingProgressLabel(stepNumber) : manageProgressLabel(stepNumber)
  const atDone = flow === 'booking' && stepNumber === BOOKING_STEPS.length

  const seam: PublicSeam = {
    flow,
    step: stepNumber,
    store,
    storeDetail,
    purpose,
    startsAt,
    next: () => goTo(step + 1),
    back: goBack,
    toManage: () => {
      setFlow('manage')
      goTo(0)
    },
  }

  function loadFailure(load: Load<unknown>): ReactNode {
    if (load.state !== 'failed') return null
    return load.offline ? (
      <PublicNotice
        live="alert"
        heading="通信が切れています"
        reason="電波の届く場所で、もう一度お試しください。"
        action={
          <button type="button" onClick={retry} className={publicQuietButtonClass}>
            もう一度読み込む
          </button>
        }
      />
    ) : (
      <PublicNotice
        live="alert"
        heading="読み込めませんでした"
        reason="通信が混み合っているようです。"
        action={
          <button type="button" onClick={retry} className={publicQuietButtonClass}>
            もう一度読み込む
          </button>
        }
      />
    )
  }

  function body(): ReactNode {
    if (flow === 'manage' || step >= 3) {
      return (
        laterSteps?.(seam) ?? (
          <PublicNotice
            heading="この先はまだお使いいただけません"
            reason="ご入力の続きをただいま用意しております。"
            action={<p className="text-grid text-ink-muted">お電話でご予約を承ります。</p>}
          />
        )
      )
    }

    if (step === 0) {
      if (stores.state === 'loading') {
        return (
          <PublicNotice
            live="status"
            heading="読み込んでいます"
            reason="ご予約を受け付けている店舗をお呼びしています。"
            action={<p className="text-grid text-ink-muted">そのままお待ちください。</p>}
          />
        )
      }
      if (stores.state === 'failed') return loadFailure(stores)
      return (
        <StoreStep
          stores={stores.value}
          selectedSlug={store?.slug ?? null}
          onSelect={(picked) => {
            setStore((current) => {
              if (current !== null && current.slug !== picked.slug) {
                setPurpose(null)
                setStartsAt(null)
              }
              return picked
            })
          }}
          onNext={() => goTo(1)}
        />
      )
    }

    if (step === 1) {
      if (purposes.state === 'loading') {
        return (
          <PublicNotice
            live="status"
            heading="読み込んでいます"
            reason="この店舗で承れるご用件をお呼びしています。"
            action={<p className="text-grid text-ink-muted">そのままお待ちください。</p>}
          />
        )
      }
      if (purposes.state === 'failed') return loadFailure(purposes)
      return (
        <PurposeStep
          purposes={purposes.value}
          selectedId={purpose?.id ?? null}
          storePhone={storeDetail?.phone ?? ''}
          onSelect={(picked) => {
            setPurpose(picked)
            setStartsAt(null)
          }}
          onNext={() => goTo(2)}
        />
      )
    }

    if (store === null || purpose === null) return null
    return (
      <DateTimeStep
        purpose={purpose}
        today={today}
        lastAcceptedDate={shiftDate(today, ACCEPT_UNTIL_DAYS)}
        loadWeek={loadWeek}
        startsAt={startsAt}
        onSelect={setStartsAt}
        onNext={() => goTo(3)}
      />
    )
  }

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-97.5 flex-col bg-paper font-sans text-ink"
      style={
        {
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        } as CSSProperties
      }
    >
      <header className="flex min-h-14 shrink-0 items-center gap-3.5 bg-pine px-4 text-on-pine">
        {!atDone && (
          <button
            type="button"
            aria-label="前の画面へ戻る"
            onClick={goBack}
            className={cn(
              'grid size-12 shrink-0 place-items-center rounded-card bg-on-pine/20 text-title',
              focusRingOnPine,
            )}
          >
            <span aria-hidden="true">‹</span>
          </button>
        )}
        <div className="min-w-0">
          <p className="truncate text-bar font-bold">{store?.name ?? 'EYEX ご予約'}</p>
          <p className="text-note opacity-90">{caption}</p>
        </div>
      </header>

      <div
        role="img"
        aria-label={progress}
        className="flex shrink-0 gap-1 border-b border-line bg-surface px-4 py-2.5"
      >
        {litBars(stepNumber, steps.length).map((lit, index) => (
          <span
            key={index}
            className={cn('h-1 flex-1 rounded-full', lit ? 'bg-pine' : 'bg-line')}
          />
        ))}
      </div>

      <main className="flex flex-1 flex-col px-7 pt-8 pb-8">{body()}</main>
    </div>
  )
}
