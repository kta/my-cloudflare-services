import {
  AvailabilitySlotsResponse,
  type Recording,
  Reservation,
  ReservationChangeHistoryEntry,
} from '@app/contracts'
import { Button, Field, Notice, Textarea, TextInput } from '@app/ui'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type { StaffApi, StaffScreenProps } from './staff-screen'

/**
 * Local view of an iPad recording.
 *
 * Recording operations have no API yet (Phase 7), so the screen never fetches
 * one: the surrounding workspace injects what it knows. This is a UI view type
 * on purpose — it is NOT an API contract, and must not grow into one.
 */
export type RecordingView =
  | { state: 'none' }
  | { state: 'processing' }
  | { state: 'failed' }
  | { state: 'deleted' }
  | {
      state: 'available'
      /** ISO-8601 instant the recording was captured. */
      recordedAt: string
      /** Person or shared terminal that recorded it. */
      recordedBy: string
      durationSeconds: number
      /** Streaming source. Never a downloadable href. */
      src: string
    }

export type RecordingPermissions = { playRecording: boolean }

/**
 * The contract's nine lifecycle states collapse onto the four this screen has
 * to tell apart plus playback (UC-EYEX-062, AC-EYEX-15). The two vocabularies
 * are not in conflict: `RecordingState` describes where a recording is in its
 * own lifecycle, `RecordingView` describes what a reservation reader can do
 * about it. 保全中 / 削除予定 are still playable evidence, so they read as
 * 保存済み here; the operational wording for them belongs to 録音運用
 * (RECORDING_OPS_FILTERS), which is the screen that acts on them.
 */
export function toRecordingView(recording: Recording | undefined, src: string): RecordingView {
  if (!recording) return { state: 'none' }
  switch (recording.state) {
    case 'deleted':
      return { state: 'deleted' }
    case 'failed':
      return { state: 'failed' }
    case 'stored':
    case 'held':
    case 'pending_deletion':
      return {
        state: 'available',
        recordedAt: recording.endedAt,
        recordedBy: recording.recorderId,
        durationSeconds: recording.durationSeconds,
        src,
      }
    default:
      // 権限確認 / 録音中 / 停止 / 送信中 are all "not playable yet".
      return { state: 'processing' }
  }
}

const JST = 'Asia/Tokyo'
const dayFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})
const timeFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const isoDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: JST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const headingFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
})

/** `8月27日（木）11:00` — the approved mock's detail heading. */
export function formatJstHeading(iso: string): string {
  const at = new Date(iso)
  const parts = Object.fromEntries(
    headingFormat.formatToParts(at).map((part) => [part.type, part.value]),
  )
  return `${parts.month}月${parts.day}日（${parts.weekday}）${timeFormat.format(at)}`
}

/** `8月27日（木）` — the approved reception-history day heading. */
export function formatJstDayHeading(iso: string): string {
  const parts = Object.fromEntries(
    headingFormat.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  )
  return `${parts.month}月${parts.day}日（${parts.weekday}）`
}

/** `8/27 11:00` — the compact form the approved `.row` uses. */
export function formatJstRowDateTime(iso: string): string {
  const at = new Date(iso)
  const parts = Object.fromEntries(
    headingFormat.formatToParts(at).map((part) => [part.type, part.value]),
  )
  return `${parts.month}/${parts.day} ${timeFormat.format(at)}`
}

/** `2026年8月27日 11:00` — JST, because the whole product is one country. */
export function formatJstDateTime(iso: string): string {
  const at = new Date(iso)
  return `${dayFormat.format(at)} ${timeFormat.format(at)}`
}
function formatJstDay(iso: string): string {
  return isoDayFormat.format(new Date(iso))
}
export function formatJstTime(iso: string): string {
  return timeFormat.format(new Date(iso))
}
function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

const SOURCE_LABEL = { staff: '電話・店頭', web: 'Web予約', walkin: 'ウォークイン' } as const
const STATUS_LABEL = {
  confirmed: '予約済み',
  checked_in: '来店済み',
  cancelled: '取消済み',
  no_show: '無断キャンセル',
} as const
const HISTORY_ACTION_LABEL = {
  changed: '日時・内容を変更',
  cancelled: '予約を取消',
  no_show: '無断キャンセルとして記録',
} as const

/** Half-width digits, no separators — the shape the API normalises to. */
function normaliseDigits(term: string): string {
  return term
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[-‐-―ー\s　()（）]/g, '')
}
function normaliseWidth(term: string): string {
  return term.replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).trim()
}

export type SearchTerm =
  | { field: 'phone' | 'reservationNumber' | 'kana' | 'name'; value: string }
  | undefined

/**
 * One search box, four contract fields (UC-EYEX-055).
 *
 * Staff read a term off the phone; deciding which field it is belongs to the
 * screen, not to the person holding the handset.
 */
export function classifySearchTerm(raw: string): SearchTerm {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const digits = normaliseDigits(trimmed)
  if (/^[0-9]+$/.test(digits)) return { field: 'phone', value: digits }
  const width = normaliseWidth(trimmed)
  if (/[A-Za-z]/.test(width)) return { field: 'reservationNumber', value: width }
  if (/^[぀-ゟ゠-ヿー\s　]+$/.test(width)) return { field: 'kana', value: width }
  return { field: 'name', value: width }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/* ------------------------------------------------------------------ *
 * 承認済みモックのクラス（staff-approved.html `#reservation-search`）
 *
 * `.workspace` / `.list` / `.detail` / `.search` / `.filterline` /
 * `.filter` / `.row` / `.row.selected` / `.card` / `.audio` / `.danger`
 * をそのままトークンで写した定数。数値はモックの実測値。
 * ------------------------------------------------------------------ */

export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
/** `.workspace{height:calc(100% - 76px);grid-template-columns:390px 1fr}` */
export const WORKSPACE = 'grid h-full grid-cols-[390px_1fr]'
/** `.list{padding:16px;background:#e7ede9;border-right:1px solid var(--l);overflow:auto}` */
export const LIST_PANE = 'overflow-auto border-line border-r bg-panel p-4'
/** `.detail{padding:22px;overflow:auto}` */
export const DETAIL_PANE = 'overflow-auto p-5.5'
/** `.search{min-height:48px;border:2px solid var(--g);background:#fff;border-radius:8px;padding:12px}` */
export const SEARCH_FIELD = `min-h-12 w-full rounded-ctl border-2 border-pine bg-surface px-3 py-3 font-sans text-ink placeholder:text-ink-muted ${FOCUS_RING}`
/** `.filterline{display:flex;gap:8px;margin:10px 0}` */
export const FILTER_LINE = 'mt-2.5 flex flex-wrap items-center gap-2'
/** `.filter{min-height:44px;border:1px solid var(--l);background:#fff;border-radius:8px;padding:0 12px}` */
export const FILTER = `min-h-11 rounded-ctl border border-line bg-surface px-3 font-sans text-ink text-sm ${FOCUS_RING}`
/** `.filter.danger{color:var(--warn);border:1px solid var(--warn);background:#fff}` */
export const FILTER_DANGER = `min-h-11 rounded-ctl border border-danger bg-surface px-3 font-sans text-danger text-sm ${FOCUS_RING}`
/** `.row{background:#fff;border:1px solid var(--l);border-radius:9px;padding:14px;margin-top:10px}` */
export const ROW = `mt-2.5 block w-full rounded-card border border-line bg-surface p-3.5 text-left font-sans ${FOCUS_RING}`
/** `.row.selected{border:3px solid var(--g);background:var(--gs)}` */
export const ROW_SELECTED = `mt-2.5 block w-full rounded-card border-[3px] border-pine bg-pine-soft p-3.5 text-left font-sans ${FOCUS_RING}`
/** `.card{background:#fff;border:1px solid var(--l);border-radius:9px;padding:14px}` */
export const CARD = 'rounded-card border border-line bg-surface p-3.5 font-sans text-ink'
/** `.audio{border:1px solid var(--l);padding:14px;border-radius:9px;margin-top:14px}` */
export const AUDIO = 'mt-3.5 rounded-card border border-line bg-surface p-3.5'
/** `.audio button{width:44px;height:44px;border-radius:50%;background:var(--g);color:#fff}` */
export const AUDIO_PLAY = `size-11 shrink-0 rounded-circle bg-pine text-on-pine ${FOCUS_RING}`

/**
 * exception-states-approved.html `#empty` / `#permission-denied`。
 *
 * どちらも「何も見えない」で終わらせず、回復する操作を必ず 1 つ添える。
 */
export function EmptyState({ heading, onClear }: { heading: string; onClear: () => void }) {
  return (
    <div className="mt-3.5 rounded-card border border-line bg-surface p-3.5 font-sans">
      <p className="font-semibold text-ink">{heading}</p>
      <p className="mt-1 text-ink-muted text-sm">
        検索語またはフィルターを変更してください。履歴自体は削除されていません。
      </p>
      <button type="button" className={`mt-3 ${FILTER}`} onClick={onClear}>
        フィルターをすべて解除
      </button>
    </div>
  )
}

export function PermissionDenied({ onBack }: { onBack: () => void }) {
  return (
    <section aria-label="権限がありません" className="mx-auto max-w-2xl px-5 py-9 text-center">
      <h2 className="font-display font-semibold text-2xl text-ink">
        この設定を表示する権限がありません
      </h2>
      <p className="mt-3 font-sans text-ink-muted">
        権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。
      </p>
      <button
        type="button"
        className={`mt-5 min-h-12 rounded-ctl bg-pine px-4 font-sans text-on-pine ${FOCUS_RING}`}
        onClick={onBack}
      >
        業務開始画面へ戻る
      </button>
    </section>
  )
}

type Props = StaffScreenProps & {
  /** JST `YYYY-MM-DD`, injected: a screen never reads the clock itself. */
  today: string
  reservationId?: string
  /**
   * The screen keeps the list and the detail on screen together, so it cannot
   * hand the open reservation over by navigating. It reports it instead, and
   * the workspace supplies that reservation's recording (UC-EYEX-057, 032).
   */
  onReservationOpened?: (reservationId: string) => void
  recording?: RecordingView
  permissions?: RecordingPermissions
}

/**
 * 承認済みモックの `.audio` ブロック。
 *
 * 44px の円形 pine 再生ボタンと「予約受付時の録音 · 03:12 · 保存済み」の一行、
 * そして持ち出し不可の注記。ダウンロード手段はどの状態でも置かない
 * (AC-EYEX-15 / AC-EYEX-79)。リージョン名だけは `iPad録音` のまま——録音面が
 * どの画面のものかを支援技術と監査 E2E が同じ語で辿るための識別子である。
 */
export function RecordingPanel({
  recording,
  permissions,
}: {
  recording?: RecordingView
  permissions: RecordingPermissions
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [position, setPosition] = useState(0)
  if (!permissions.playRecording) return null

  const stateLabel = !recording
    ? '未取得'
    : recording.state === 'none'
      ? '録音なし'
      : recording.state === 'processing'
        ? '処理中'
        : recording.state === 'failed'
          ? '保存失敗'
          : recording.state === 'deleted'
            ? '削除済み'
            : '保存済み'
  const note = !recording
    ? '録音の状態をまだ取得できていません。'
    : recording.state === 'none'
      ? 'この予約に紐づく録音はありません。'
      : recording.state === 'processing'
        ? '保存処理中です。完了すると再生できます。'
        : recording.state === 'failed'
          ? '録音を保存できていません。予約内容には影響しません。'
          : recording.state === 'deleted'
            ? '保持期間を過ぎたため削除されました。'
            : 'ダウンロードはできません。再生操作は監査されます。'
  const available = recording?.state === 'available' ? recording : undefined

  return (
    <section aria-label="iPad録音" className={AUDIO}>
      <div className="flex items-center gap-3">
        {available && (
          <>
            <button
              type="button"
              aria-label="再生"
              className={AUDIO_PLAY}
              onClick={() => {
                void audioRef.current?.play?.()
              }}
            >
              ▶
            </button>
            <button
              type="button"
              className={FILTER}
              onClick={() => {
                audioRef.current?.pause?.()
              }}
            >
              一時停止
            </button>
          </>
        )}
        <p className="font-sans text-ink">
          <span>予約受付時の録音</span>
          {available && (
            <>
              <span aria-hidden="true"> · </span>
              <span>{formatDuration(available.durationSeconds)}</span>
            </>
          )}
          <span aria-hidden="true"> · </span>
          <span className={recording?.state === 'failed' ? 'text-danger' : undefined}>
            {stateLabel}
          </span>
        </p>
      </div>
      {available && (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: staff-only audio evidence has no caption track. */}
          <audio ref={audioRef} src={available.src} preload="none" />
          <input
            type="range"
            aria-label="再生位置"
            min={0}
            max={available.durationSeconds}
            value={position}
            className="mt-2.5 min-h-11 w-full"
            onChange={(event) => {
              const next = Number(event.target.value)
              setPosition(next)
              if (audioRef.current) audioRef.current.currentTime = next
            }}
          />
          <p className="mt-1 font-sans text-ink-muted text-sm">
            <span className="text-ink-muted">録音日時</span>{' '}
            <span className="text-ink">{formatJstDateTime(available.recordedAt)}</span>
            <span aria-hidden="true"> · </span>
            <span className="text-ink-muted">録音者</span>{' '}
            <span className="text-ink">{available.recordedBy}</span>
            <span aria-hidden="true"> · </span>
            <span className="text-ink-muted">長さ</span>{' '}
            <span className="text-ink">{formatDuration(available.durationSeconds)}</span>
          </p>
        </>
      )}
      <p className="mt-1 font-sans text-ink-muted text-sm">{note}</p>
    </section>
  )
}

/** A labelled card. `Card` takes no aria-label, and these panels need a name. */
export function Panel({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <section aria-label={label} className={`${CARD} ${className ?? ''}`}>
      {children}
    </section>
  )
}

function CardRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="mt-1 text-sm">
      <span className="text-ink-muted">{label}</span> <span className="text-ink">{children}</span>
    </p>
  )
}

async function loadHistory(
  api: StaffApi,
  storeId: string,
  reservationId: string,
): Promise<ReservationChangeHistoryEntry[]> {
  const response = await api(`/api/staff/stores/${storeId}/reservations/${reservationId}/history`)
  if (!response.ok) return []
  const parsed = ReservationChangeHistoryEntry.array().safeParse(await readJson(response))
  return parsed.success ? parsed.data : []
}

type Filters = { term: string; dateFrom: string; dateTo: string; source: string; status: string }
const NO_FILTERS: Filters = { term: '', dateFrom: '', dateTo: '', source: '', status: '' }

/**
 * Selected-store reservation search, detail, change and cancellation.
 *
 * The store is a prop, never a filter: there is no store control and no 全店舗
 * option on this screen (UC-EYEX-056, AC-EYEX-90).
 */
export function ReservationSearchScreen({
  storeId,
  storeName,
  api,
  navigate,
  today,
  reservationId,
  onReservationOpened,
  recording,
  permissions = { playRecording: false },
}: Props) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [results, setResults] = useState<Reservation[]>()
  const [searchError, setSearchError] = useState<string>()
  const [forbidden, setForbidden] = useState(false)
  const [selected, setSelected] = useState<Reservation>()
  const [history, setHistory] = useState<ReservationChangeHistoryEntry[]>([])
  const [panel, setPanel] = useState<'none' | 'change' | 'cancel'>('none')
  const [changeDate, setChangeDate] = useState(today)
  const [slots, setSlots] = useState<AvailabilitySlotsResponse['slots']>()
  const [slotStartTime, setSlotStartTime] = useState<string>()
  const [changeReason, setChangeReason] = useState('')
  const [changeError, setChangeError] = useState<string>()
  const [cancelReason, setCancelReason] = useState('')
  const [cancelConfirmation, setCancelConfirmation] = useState('')
  const [cancelError, setCancelError] = useState<string>()

  const openReservation = useCallback(
    (reservation: Reservation) => {
      setSelected(reservation)
      setPanel('none')
      setSlots(undefined)
      setSlotStartTime(undefined)
      setChangeError(undefined)
      setCancelError(undefined)
      setChangeDate(formatJstDay(reservation.startAt))
      onReservationOpened?.(reservation.id)
      void loadHistory(api, storeId, reservation.id).then(setHistory)
    },
    [api, storeId, onReservationOpened],
  )

  // A preselected reservation (arrived from the ledger) opens straight away.
  useEffect(() => {
    if (!reservationId) return
    let active = true
    void (async () => {
      const response = await api(`/api/staff/stores/${storeId}/reservations/${reservationId}`)
      if (!response.ok) return
      const parsed = Reservation.safeParse(await readJson(response))
      if (parsed.success && active) openReservation(parsed.data)
    })()
    return () => {
      active = false
    }
  }, [api, storeId, reservationId, openReservation])

  const search = async (next: Filters) => {
    const params = new URLSearchParams()
    const classified = classifySearchTerm(next.term)
    if (classified) params.set(classified.field, classified.value)
    if (next.dateFrom) params.set('dateFrom', next.dateFrom)
    if (next.dateTo) params.set('dateTo', next.dateTo)
    if (next.source) params.set('source', next.source)
    if (next.status) params.set('status', next.status)
    // The store is in the path, never in the query: no cross-store search exists.
    const response = await api(`/api/staff/stores/${storeId}/reservations?${params.toString()}`)
    if (response.status === 403) {
      setForbidden(true)
      setResults(undefined)
      return
    }
    if (!response.ok) {
      setSearchError('予約を検索できませんでした。もう一度お試しください。')
      setResults(undefined)
      return
    }
    const parsed = Reservation.array().safeParse(await readJson(response))
    if (!parsed.success) {
      setSearchError('予約を検索できませんでした。もう一度お試しください。')
      setResults(undefined)
      return
    }
    setSearchError(undefined)
    // Candidates only: nothing is bound until the operator picks (AC-EYEX-21).
    setResults(parsed.data)
    setSelected(undefined)
    setHistory([])
    setPanel('none')
  }

  const findSlots = async (date: string) => {
    if (!selected) return
    const params = new URLSearchParams({ date, purposeIds: selected.purposeIds.join(',') })
    const response = await api(
      `/api/staff/stores/${storeId}/availability/slots?${params.toString()}`,
    )
    if (!response.ok) {
      setSlots([])
      setChangeError('空き枠を取得できませんでした。もう一度お試しください。')
      return
    }
    const parsed = AvailabilitySlotsResponse.safeParse(await readJson(response))
    setSlots(parsed.success ? parsed.data.slots : [])
  }

  const applyChange = async () => {
    if (!selected || !slotStartTime) return
    if (changeReason.trim() === '') {
      setChangeError('変更理由を入力してください。')
      return
    }
    const response = await api(`/api/staff/stores/${storeId}/reservations/${selected.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        // Deterministic: the same attempt on the same version is the same write.
        'idempotency-key': `${selected.id}:${selected.version}:change`,
      },
      body: JSON.stringify({
        version: selected.version,
        date: changeDate,
        startTime: slotStartTime,
        purposeIds: selected.purposeIds,
        reason: changeReason.trim(),
      }),
    })
    if (response.status === 409) {
      const body = await readJson(response)
      const error = (body as { error?: string } | undefined)?.error
      if (error === 'version_conflict') {
        setChangeError('別の端末で更新されました。最新の内容を読み直してください。')
        return
      }
      // The original reservation is never released before the destination is
      // secured, so a lost slot costs nothing but a retry (AC-EYEX-22).
      setChangeError('選択した枠を確保できませんでした。元の予約はそのままです。')
      setSlotStartTime(undefined)
      await findSlots(changeDate)
      return
    }
    if (!response.ok) {
      setChangeError('予約を変更できませんでした。もう一度お試しください。')
      return
    }
    const parsed = Reservation.safeParse(await readJson(response))
    if (!parsed.success) {
      setChangeError('予約を変更できませんでした。もう一度お試しください。')
      return
    }
    setSelected(parsed.data)
    setResults((current) =>
      current?.map((entry) => (entry.id === parsed.data.id ? parsed.data : entry)),
    )
    setPanel('none')
    setSlots(undefined)
    setSlotStartTime(undefined)
    setChangeReason('')
    setChangeError(undefined)
    setHistory(await loadHistory(api, storeId, parsed.data.id))
  }

  const applyCancel = async () => {
    if (!selected) return
    if (cancelReason.trim() === '') {
      setCancelError('取消理由を入力してください。')
      return
    }
    if (cancelConfirmation.trim() !== '取消') {
      setCancelError('確認のため「取消」と入力してください。')
      return
    }
    const response = await api(`/api/staff/stores/${storeId}/reservations/${selected.id}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: selected.version,
        reason: cancelReason.trim(),
        confirmation: '取消',
      }),
    })
    if (response.status === 409) {
      setCancelError('別の端末で更新されました。最新の内容を読み直してください。')
      return
    }
    if (!response.ok) {
      setCancelError('予約を取り消せませんでした。もう一度お試しください。')
      return
    }
    const parsed = Reservation.safeParse(await readJson(response))
    if (!parsed.success) {
      setCancelError('予約を取り消せませんでした。もう一度お試しください。')
      return
    }
    setSelected(parsed.data)
    setResults((current) =>
      current?.map((entry) => (entry.id === parsed.data.id ? parsed.data : entry)),
    )
    setPanel('none')
    setCancelReason('')
    setCancelConfirmation('')
    setCancelError(undefined)
    setHistory(await loadHistory(api, storeId, parsed.data.id))
  }

  if (forbidden) return <PermissionDenied onBack={() => navigate({ screen: 'home' })} />

  return (
    <div className={WORKSPACE}>
      {/* 画面名はモックでは上部バーのタブが担う。支援技術と自動テストのために
          見出し自体は残し、描画からだけ外す。 */}
      <h2 className="sr-only">予約を検索する</h2>
      <span className="sr-only">{`${storeName} · 検索対象店舗`}</span>
      <aside className={LIST_PANE}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void search(filters)
          }}
        >
          <input
            id="reservation-term"
            aria-label="氏名・電話番号・予約番号"
            className={SEARCH_FIELD}
            placeholder="氏名・電話番号・予約番号"
            value={filters.term}
            onChange={(event) =>
              setFilters((current) => ({ ...current, term: event.target.value }))
            }
          />
          <div className={FILTER_LINE}>
            <select
              id="reservation-source"
              aria-label="予約元"
              className={FILTER}
              value={filters.source}
              onChange={(event) =>
                setFilters((current) => ({ ...current, source: event.target.value }))
              }
            >
              <option value="">電話・店頭・Web予約</option>
              <option value="staff">電話・店頭</option>
              <option value="web">Web予約</option>
              <option value="walkin">ウォークイン</option>
            </select>
            <select
              id="reservation-status"
              aria-label="状態"
              className={FILTER}
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({ ...current, status: event.target.value }))
              }
            >
              <option value="">今後の予約</option>
              <option value="confirmed">予約済み</option>
              <option value="checked_in">来店済み</option>
              <option value="cancelled">取消済み</option>
              <option value="no_show">無断キャンセル</option>
            </select>
          </div>
          <div className={FILTER_LINE}>
            <input
              id="reservation-date-from"
              type="date"
              aria-label="開始日"
              className={`w-32 ${FILTER}`}
              value={filters.dateFrom}
              onChange={(event) =>
                setFilters((current) => ({ ...current, dateFrom: event.target.value }))
              }
            />
            <input
              id="reservation-date-to"
              type="date"
              aria-label="終了日"
              className={`w-32 ${FILTER}`}
              value={filters.dateTo}
              onChange={(event) =>
                setFilters((current) => ({ ...current, dateTo: event.target.value }))
              }
            />
            <button
              type="submit"
              className={`min-h-11 rounded-ctl bg-pine px-3 font-sans text-on-pine text-sm ${FOCUS_RING}`}
            >
              検索する
            </button>
          </div>
        </form>
        <p className="mt-2.5 font-sans text-ink">
          <strong>{storeName}の予約だけを表示</strong>
          <br />
          <small className="text-ink-muted">他店舗はヘッダーから切り替えてください。</small>
        </p>
        {searchError && (
          <p role="alert" className="mt-2.5 font-sans text-danger text-sm">
            {searchError}
          </p>
        )}
        <section aria-label="検索結果">
          {results?.length === 0 && (
            <EmptyState
              heading="条件に一致する予約はありません。"
              onClear={() => {
                setFilters(NO_FILTERS)
                void search(NO_FILTERS)
              }}
            />
          )}
          {results?.map((reservation) => (
            <button
              key={reservation.id}
              type="button"
              onClick={() => openReservation(reservation)}
              className={selected?.id === reservation.id ? ROW_SELECTED : ROW}
            >
              <b className="block text-ink">{reservation.customer.name} 様</b>
              <span className="block text-ink-muted text-sm">
                {formatJstRowDateTime(reservation.startAt)} · {SOURCE_LABEL[reservation.source]} ·{' '}
                {STATUS_LABEL[reservation.status]}
              </span>
              {selected?.id === reservation.id && (
                <span className="block text-ink-muted text-xs">選択中</span>
              )}
            </button>
          ))}
        </section>
      </aside>
      <section className={DETAIL_PANE}>
        {!selected ? (
          <p className="font-sans text-ink-muted text-sm">候補から予約を選択してください。</p>
        ) : (
          <>
            <section aria-label="予約詳細">
              <h3 className="font-display font-semibold text-2xl text-ink">
                {formatJstHeading(selected.startAt)}
              </h3>
              <div className="mt-3.5 grid grid-cols-3 gap-3">
                <div className={CARD}>
                  <b>予約内容</b>
                  <CardRow label="来店日時">{formatJstDateTime(selected.startAt)}</CardRow>
                  <CardRow label="来店目的">{selected.purposeIds.length}件</CardRow>
                  <CardRow label="予約番号">{selected.reservationNumber}</CardRow>
                  <CardRow label="店舗">{storeName}</CardRow>
                </div>
                <div className={CARD}>
                  <b>お客様</b>
                  <CardRow label="お名前">{selected.customer.name} 様</CardRow>
                  <CardRow label="お客様かな">{selected.customer.kana}</CardRow>
                  <CardRow label="電話番号">{selected.customer.phone}</CardRow>
                </div>
                <div className={CARD}>
                  <b>状態</b>
                  <p className="mt-1 text-ink text-sm">{STATUS_LABEL[selected.status]}</p>
                  <p className="mt-1 text-ink text-sm">{SOURCE_LABEL[selected.source]}</p>
                </div>
              </div>
            </section>
            <RecordingPanel recording={recording} permissions={permissions} />
            <div className={FILTER_LINE}>
              <button
                type="button"
                className={FILTER_DANGER}
                onClick={() => {
                  setPanel('cancel')
                  setCancelError(undefined)
                }}
              >
                予約を取り消す
              </button>
              <button
                type="button"
                className={FILTER}
                onClick={() => {
                  setPanel('change')
                  setChangeError(undefined)
                }}
              >
                日時・内容を変更する
              </button>
            </div>
            {panel === 'change' && (
              <Panel className="mt-3.5 space-y-3" label="予約変更">
                <h3 className="font-display font-semibold text-lg text-ink">変更先の枠を探す</h3>
                <p className="text-ink-muted text-sm">
                  元の予約は保持したままです。切り替えは変更先を確保できたときだけ行います。
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="変更先の日" htmlFor="change-date">
                    <TextInput
                      id="change-date"
                      type="date"
                      className="min-h-11"
                      value={changeDate}
                      onChange={(event) => setChangeDate(event.target.value)}
                    />
                  </Field>
                  <button
                    type="button"
                    className={FILTER}
                    onClick={() => {
                      void findSlots(changeDate)
                    }}
                  >
                    空き枠を探す
                  </button>
                </div>
                {slots?.length === 0 && (
                  <p className="text-ink-muted text-sm">
                    この日に空き枠はありません。別の日を選んでください。
                  </p>
                )}
                {slots && slots.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {slots.map((slot) => (
                      <button
                        key={slot.startAt}
                        type="button"
                        onClick={() => setSlotStartTime(slot.startTime)}
                        className={
                          slotStartTime === slot.startTime
                            ? `min-h-11 rounded-ctl border border-pine bg-pine px-3 font-sans text-on-pine text-sm ${FOCUS_RING}`
                            : FILTER
                        }
                      >
                        {slot.startTime}〜{slot.endTime}
                      </button>
                    ))}
                  </div>
                )}
                <Field label="変更理由" htmlFor="change-reason">
                  <Textarea
                    id="change-reason"
                    className="min-h-11"
                    value={changeReason}
                    onChange={(event) => setChangeReason(event.target.value)}
                  />
                </Field>
                {changeError && <Notice tone="danger">{changeError}</Notice>}
                <Button
                  className="min-h-11"
                  disabled={!slotStartTime}
                  onClick={() => {
                    void applyChange()
                  }}
                >
                  この枠に切り替える
                </Button>
              </Panel>
            )}
            {panel === 'cancel' && (
              <Panel className="mt-3.5 space-y-3" label="予約取消">
                <h3 className="font-display font-semibold text-lg text-ink">予約を取り消す</h3>
                <Field label="取消理由" htmlFor="cancel-reason">
                  <Textarea
                    id="cancel-reason"
                    className="min-h-11"
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                  />
                </Field>
                <Field label="確認入力" htmlFor="cancel-confirmation">
                  <TextInput
                    id="cancel-confirmation"
                    className="min-h-11"
                    placeholder="取消"
                    value={cancelConfirmation}
                    onChange={(event) => setCancelConfirmation(event.target.value)}
                  />
                </Field>
                <p className="text-ink-muted text-sm">
                  確認のため「取消」と入力してください。実行者・日時・変更前内容を履歴に残します。
                </p>
                {cancelError && <Notice tone="danger">{cancelError}</Notice>}
                <Button
                  variant="danger"
                  className="min-h-11"
                  onClick={() => {
                    void applyCancel()
                  }}
                >
                  取消を実行する
                </Button>
              </Panel>
            )}
            <Panel className="mt-3.5" label="変更履歴">
              <b>変更履歴</b>
              {history.length === 0 ? (
                <p className="mt-1 text-ink-muted text-sm">変更履歴はありません。</p>
              ) : (
                <ul className="mt-1">
                  {history.map((entry) => (
                    <li key={entry.id} className="border-line border-b py-2 last:border-b-0">
                      <p className="font-semibold text-ink text-sm">
                        {HISTORY_ACTION_LABEL[entry.action]}
                      </p>
                      <p className="text-ink-muted text-sm">
                        {formatJstDateTime(entry.occurredAt)} · 実行者 {entry.actorId}
                      </p>
                      <p className="text-ink text-sm">
                        変更前 {STATUS_LABEL[entry.before.status]} ·{' '}
                        {formatJstDateTime(entry.before.startAt)}
                      </p>
                      <p className="text-ink text-sm">
                        変更後 {STATUS_LABEL[entry.after.status]} ·{' '}
                        {formatJstTime(entry.after.startAt)}
                      </p>
                      {entry.reason && (
                        <p className="text-ink-muted text-sm">理由 {entry.reason}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        )}
      </section>
    </div>
  )
}
