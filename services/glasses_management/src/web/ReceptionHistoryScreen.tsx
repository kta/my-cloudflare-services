import {
  AvailabilityPurpose,
  ReceptionHistoryEntry,
  Reservation,
  ReservationChangeHistoryEntry,
} from '@app/contracts'
import { useCallback, useEffect, useState } from 'react'
import { FilterLine, FilterToggle, SearchField } from './design/controls'
import { Workspace } from './design/layouts'
import { Card, StatePill, TitleRow } from './design/surfaces'
import {
  classifySearchTerm,
  EmptyState,
  FOCUS_RING,
  formatJstDateTime,
  formatJstDayHeading,
  formatJstTime,
  PermissionDenied,
  RecordingPanel,
  type RecordingPermissions,
  type RecordingView,
} from './ReservationSearchScreen'
import type { StaffApi, StaffScreenProps } from './staff-screen'

const SOURCE_LABEL = { staff: '電話・店頭', web: 'Web予約', walkin: 'ウォークイン' } as const
/**
 * 記録の右肩に出る狭い語（承認済みモックの `.source`）。
 *
 * 「ウォークイン受付」のような長い操作名を置くと 390px の列でチップが折れる。
 * モックは経路を 1〜2 文字で名乗らせ、何が起きたかは行の本文が言う。
 */
const ROUTE_CHIP = { staff: '電話', web: 'Web', walkin: '店頭' } as const
/** 経路ではなく「予約に手を入れた」ことが要点になる操作だけ、語を差し替える。 */
const ACTION_CHIP = { changed: '変更', cancelled: '取消', no_show: '無断' } as const

function chipOf(entry: ReceptionHistoryEntry): string {
  if (entry.action === 'changed') return ACTION_CHIP.changed
  if (entry.action === 'cancelled') return ACTION_CHIP.cancelled
  if (entry.action === 'no_show') return ACTION_CHIP.no_show
  return ROUTE_CHIP[entry.source]
}

const STATUS_LABEL = {
  confirmed: '予約済み',
  checked_in: '来店済み',
  cancelled: '取消済み',
  no_show: '無断キャンセル',
} as const

/*
 * 経路の絞り込み（AC-EYEX-58）。ネイティブの `<select>` を置くとブラウザ既定の
 * 見た目が絞り込みの列に混ざり、選ばれている値も畳まれて見えなくなるので、
 * モックが記録の右肩で使っている語をそのままチップにする。`変更` だけは経路
 * ではなく操作なので、送る引数が違う。
 */
const ROUTE_FILTERS = [
  { label: '店頭', param: 'source', value: 'walkin' },
  { label: '電話', param: 'source', value: 'staff' },
  { label: 'Web', param: 'source', value: 'web' },
  { label: '変更', param: 'action', value: 'changed' },
] as const
type RouteFilter = (typeof ROUTE_FILTERS)[number]['label']

/**
 * 承認済みモック (`reception-history-approved.html`) の記録タイトル。
 *
 * 「何が起きたか」を主語つきの一文にする。行と詳細で同じ文を使うので、
 * 一覧で見つけた記録と開いた記録が同じものだと読み替えなしで分かる。
 */
function titleOf(entry: ReceptionHistoryEntry): string {
  const who = entry.customerName ?? '顧客未登録'
  switch (entry.action) {
    case 'created':
      return `${who}様の予約を登録`
    case 'changed':
      return `${who}様の日時を変更`
    case 'cancelled':
      return `${who}様の予約を取消`
    case 'no_show':
      return `${who}様を無断キャンセルとして記録`
    case 'walkin_created':
      return `${who}を受付`
  }
}

type Filters = { term: string; route: RouteFilter | ''; attentionOnly: boolean }
const NO_FILTERS: Filters = { term: '', route: '', attentionOnly: false }

/** 選択した記録の「いつ来るのか・何をしに来るのか」。記録自体は持っていない。 */
type Booking = { startAt: string; purposeIds: string[]; status: keyof typeof STATUS_LABEL }

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

async function loadBooking(
  api: StaffApi,
  storeId: string,
  reservationId: string,
): Promise<{ booking?: Booking; changes: number }> {
  const [detail, history] = await Promise.all([
    api(`/api/staff/stores/${storeId}/reservations/${reservationId}`),
    api(`/api/staff/stores/${storeId}/reservations/${reservationId}/history`),
  ])
  const parsed = detail.ok ? Reservation.safeParse(await readJson(detail)) : undefined
  const changes = history.ok
    ? ReservationChangeHistoryEntry.array().safeParse(await readJson(history))
    : undefined
  return {
    booking: parsed?.success
      ? {
          startAt: parsed.data.startAt,
          purposeIds: parsed.data.purposeIds,
          status: parsed.data.status,
        }
      : undefined,
    changes: changes?.success ? changes.data.length : 0,
  }
}

type Props = StaffScreenProps & {
  /** JST `YYYY-MM-DD`, injected: a screen never reads the clock itself. */
  today: string
  recording?: RecordingView
  /**
   * The recording of one reception event. Which event is selected is this
   * screen's own state, so the workspace hands down a lookup rather than a
   * single recording (UC-EYEX-032, AC-EYEX-60).
   */
  resolveRecording?: (entry: ReceptionHistoryEntry) => RecordingView | undefined
  permissions?: RecordingPermissions
}

/**
 * Same-day reception history for the selected store.
 *
 * Ordered by when things happened rather than by when customers are due, so a
 * mis-keyed reception can be found by "what did we just do" (AC-EYEX-56).
 * 承認済みモック `reception-history-approved.html` の 390px + 1fr の 2 ペイン。
 */
export function ReceptionHistoryScreen({
  storeId,
  storeName,
  api,
  navigate,
  today,
  recording,
  resolveRecording,
  permissions = { playRecording: false },
}: Props) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [entries, setEntries] = useState<ReceptionHistoryEntry[]>()
  const [loadError, setLoadError] = useState<string>()
  const [forbidden, setForbidden] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const [booking, setBooking] = useState<Booking>()
  const [changeCount, setChangeCount] = useState(0)
  /** 目的は id ではなくスタッフが口にする名称でないと読めない。店舗設定が源泉。 */
  const [purposeNames, setPurposeNames] = useState<Record<string, string>>()

  const load = useCallback(
    async (query: Filters) => {
      const params = new URLSearchParams({ date: today })
      const classified = classifySearchTerm(query.term)
      // 予約番号 / 電話 / 氏名 are the three history search fields; a kana term
      // is still a person's name as far as this endpoint is concerned.
      if (classified)
        params.set(classified.field === 'kana' ? 'name' : classified.field, classified.value)
      const route = ROUTE_FILTERS.find((candidate) => candidate.label === query.route)
      if (route) params.set(route.param, route.value)
      // Clearing 要確認 drops the parameter entirely, so nothing is hidden (AC-EYEX-61).
      if (query.attentionOnly) params.set('requiresAttention', 'true')
      // The store lives in the path: no other store's events can be requested.
      const response = await api(
        `/api/staff/stores/${storeId}/reception-history?${params.toString()}`,
      )
      if (response.status === 403) {
        setForbidden(true)
        return
      }
      if (!response.ok) {
        setLoadError('受付履歴を取得できませんでした。もう一度お試しください。')
        return
      }
      let body: unknown
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      const parsed = ReceptionHistoryEntry.array().safeParse(body)
      if (!parsed.success) {
        setLoadError('受付履歴を取得できませんでした。もう一度お試しください。')
        return
      }
      setLoadError(undefined)
      setEntries(
        [...parsed.data].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
      )
    },
    [api, storeId, today],
  )

  useEffect(() => {
    void load(NO_FILTERS)
  }, [load])

  useEffect(() => {
    let active = true
    void api(`/api/staff/stores/${storeId}/availability/settings`)
      .then(async (response) => {
        if (!response.ok) return undefined
        // 設定全体はこの面の関心ではない。目的の名称だけを契約から読む。
        const body = (await readJson(response)) as { purposes?: unknown } | undefined
        return AvailabilityPurpose.array().safeParse(body?.purposes)
      })
      .then((parsed) => {
        if (!active || !parsed?.success) return
        setPurposeNames(
          Object.fromEntries(parsed.data.map((purpose) => [purpose.id, purpose.staffName])),
        )
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [api, storeId])

  const selected = entries?.find((entry) => entry.id === selectedId)
  const selectedReservationId = selected?.reservationId

  /*
   * 記録は「何が起きたか」しか持たない。モックの詳細が名乗る「来店」「目的」
   * 「変更履歴」は予約の側にあるので、開いた記録の予約だけを取りに行く。
   */
  useEffect(() => {
    setBooking(undefined)
    setChangeCount(0)
    if (!selectedReservationId) return undefined
    let active = true
    void loadBooking(api, storeId, selectedReservationId)
      .then((result) => {
        if (!active) return
        setBooking(result.booking)
        setChangeCount(result.changes)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [api, storeId, selectedReservationId])

  if (forbidden) return <PermissionDenied onBack={() => navigate({ screen: 'home' })} />

  const list = (
    <>
      {/* 画面名はモックでは上部バーのタブが担う。支援技術と自動テストのために
          見出し自体は残し、描画からだけ外す。 */}
      <h2 className="sr-only">受付履歴</h2>
      <span className="sr-only">{`${storeName} · 当日の受付記録`}</span>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void load(filters)
        }}
      >
        {/* `.tools{display:flex;gap:7px}` — 検索欄が伸び、その隣にチップが並ぶ。 */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchField
              id="history-term"
              label="氏名・電話番号・予約番号"
              placeholder="氏名・電話番号・予約番号"
              value={filters.term}
              onChange={(term) => setFilters((current) => ({ ...current, term }))}
            />
          </div>
          {/* 押している間だけ緑地。押されていることを色以外に aria-pressed が持つ。 */}
          <FilterToggle
            pressed={filters.attentionOnly}
            onToggle={() => {
              const next = { ...filters, attentionOnly: !filters.attentionOnly }
              setFilters(next)
              // チップは押した時点で効く。確定のためのボタンをモックは持たない。
              void load(next)
            }}
          >
            要確認
          </FilterToggle>
        </div>
        <FilterLine>
          {ROUTE_FILTERS.map((route) => (
            <FilterToggle
              key={route.label}
              pressed={filters.route === route.label}
              onToggle={() => {
                // 同じチップをもう一度押すと解除。経路は 1 つずつしか見ない。
                const next = {
                  ...filters,
                  route: (filters.route === route.label ? '' : route.label) as Filters['route'],
                }
                setFilters(next)
                void load(next)
              }}
            >
              {route.label}
            </FilterToggle>
          ))}
        </FilterLine>
      </form>
      {loadError && (
        <p role="alert" className="mt-2.5 font-sans text-danger text-grid">
          {loadError}
        </p>
      )}
      {/* `.day` — 発生順の記録は日付見出しの下にまとまる。 */}
      <p className="mt-3 font-sans font-bold text-grid text-ink">
        {formatJstDayHeading(`${today}T00:00:00+09:00`)}
      </p>
      <section aria-label="受付履歴">
        {entries?.length === 0 && (
          <EmptyState
            heading="条件に一致する受付履歴はありません。"
            onClear={() => {
              setFilters(NO_FILTERS)
              void load(NO_FILTERS)
            }}
          />
        )}
        {entries?.map((entry) => (
          /*
           * 記録 1 件は `.row` そのもの（`ListRow`）だが、押せる必要があるので
           * 要素はボタンのまま、寸法と罫だけを同じ語彙で持つ。選択中は 2px の
           * 緑罫（モックの `.event.on`）。
           */
          <button
            key={entry.id}
            type="button"
            aria-pressed={selectedId === entry.id}
            onClick={() => setSelectedId(entry.id)}
            className={`mt-2.5 block w-full rounded-card p-3.5 text-left font-sans text-ink ${FOCUS_RING} ${
              selectedId === entry.id
                ? 'border-2 border-pine bg-pine-soft'
                : 'border border-line bg-surface'
            }`}
          >
            {/* `.source{float:right}` — どこから入った記録かを行の右肩に置く。 */}
            <span className="float-right text-grid">
              <StatePill tone={entry.requiresAttention ? 'caution' : 'plain'}>
                {chipOf(entry)}
              </StatePill>
              {/* 琥珀だけに頼らない。色を見られなくても語で「要確認」と分かる。 */}
              {entry.requiresAttention && <span className="sr-only">要確認</span>}
            </span>
            {/* 時刻は数字なので等幅。和文はここに混ぜない。 */}
            <time className="block font-bold font-mono text-grid text-pine">
              {formatJstTime(entry.occurredAt)}
            </time>
            <b className="block">{titleOf(entry)}</b>
            <span className="block text-grid text-ink-muted">
              {SOURCE_LABEL[entry.source]} · {entry.actorId}
            </span>
          </button>
        ))}
      </section>
    </>
  )

  const detail = !selected ? (
    <p className="font-sans text-grid text-ink-muted">
      受付イベントを選ぶと、内容をここに表示します。
    </p>
  ) : (
    <section aria-label="受付イベント詳細" className="font-sans">
      {/* `.detailhead` — 何が起きたか、いつ、誰が。状態は右肩の `.badge`。 */}
      {/*
       * 右肩は状態そのもの。通常の状態を失敗の色（danger）で出すと「予約が
       * 取れている」ことが赤で伝わってしまうので、通常は緑、注意は琥珀にする。
       */}
      <TitleRow
        push={
          <StatePill tone={selected.requiresAttention ? 'caution' : 'plain'}>
            {selected.requiresAttention
              ? '要確認'
              : booking
                ? STATUS_LABEL[booking.status]
                : '受付済み'}
          </StatePill>
        }
      >
        <div>
          <h1>{titleOf(selected)}</h1>
          <small>{`${formatJstDateTime(selected.occurredAt)} · 受付者 ${selected.actorId}`}</small>
        </div>
      </TitleRow>
      {/*
       * `.detailgrid{grid-template-columns:1.15fr .85fr;gap:12px}`。列比は
       * 4 の倍数でない実測値なので、純粋な配置としてインラインで持つ。
       */}
      <div className="mt-3.5 grid gap-3" style={{ gridTemplateColumns: '1.15fr .85fr' }}>
        <Card>
          <b className="block">予約内容</b>
          {/* 「いつ来るのか」は記録の発生時刻ではない。予約の来店日時を出す。 */}
          <DetailLine
            label="来店"
            value={booking ? formatJstDateTime(booking.startAt) : '予約なし'}
          />
          <DetailLine label="目的" value={purposeLabel(booking, purposeNames)} />
          <DetailLine label="予約番号" value={selected.reservationNumber ?? '予約なし'} />
          <DetailLine label="受付経路" value={SOURCE_LABEL[selected.source]} />
          <b className="mt-3.5 block">iPad録音</b>
          <RecordingPanel
            recording={resolveRecording?.(selected) ?? recording}
            permissions={permissions}
            frame="bare"
            wave
          />
        </Card>
        <Card>
          <b className="block">お客様</b>
          <p className="mt-1 font-bold">{selected.customerName ?? '顧客未登録'}</p>
          <p className="text-grid">{selected.customerPhone ?? '未登録'}</p>
          <DetailLine label="顧客照合" value={selected.customerName ? '既存顧客' : '顧客未登録'} />
          {/* 変更履歴はモックどおりここに戻す（予約検索の詳細はこれを持たない）。 */}
          <DetailLine label="変更履歴" value={changeCount === 0 ? 'なし' : `${changeCount}件`} />
        </Card>
      </div>
    </section>
  )

  /*
   * `Workspace` は「バーの下の残り全部」を占める前提で `flex-1` を持つので、
   * 面の側で 1 枚 flex の器を被せて、その高さを実アプリでも成り立たせる。
   */
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Workspace list={list} detail={detail} />
    </div>
  )
}

/**
 * 目的は id ではなく、スタッフが口にする名称でなければ読めない。名称が届いて
 * いないあいだは件数で代わりを言わせる（「—」だと目的が無いのと区別できない）。
 */
function purposeLabel(
  booking: Booking | undefined,
  names: Record<string, string> | undefined,
): string {
  if (!booking) return '予約なし'
  const resolved = booking.purposeIds.map((id) => names?.[id]).filter((name) => name !== undefined)
  if (resolved.length === booking.purposeIds.length && resolved.length > 0)
    return resolved.join('・')
  return `${booking.purposeIds.length}件`
}

/** `.row{display:flex;justify-content:space-between;border-top:1px solid …}` */
function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="mt-1 flex justify-between gap-3 border-line border-t pt-1 text-grid">
      <span className="text-ink-muted">{label}</span>
      <b className="text-ink">{value}</b>
    </p>
  )
}
