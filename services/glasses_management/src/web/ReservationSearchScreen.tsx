import {
  AvailabilitySlotsResponse,
  AvailabilityStoreSettings,
  type Recording,
  Reservation,
} from '@app/contracts'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import {
  Action,
  Actions,
  FilterButton,
  FilterDate,
  FilterLine,
  FilterToggle,
  SearchField,
} from './design/controls'
import { TextAreaField, TextField } from './design/forms'
import { FullScreenState, Panel, Workspace } from './design/layouts'
import { FailureNotice } from './design/notices'
import { Card, CardColumns, ListRow, Waveform } from './design/surfaces'
import type { StaffScreenProps } from './staff-screen'

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
function formatJstHeading(iso: string): string {
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
/**
 * `.workspace{height:calc(100% - 76px);grid-template-columns:390px 1fr}`
 *
 * 390px は 4 の倍数でない実測値なので、任意値クラスではなく純粋な配置として
 * インライン style で持つ（`docs/frontend/REBUILD.md` の規約）。
 *
 * `.list` / `.detail` / `.row` / `.card` の寸法は `design/layouts` と
 * `design/surfaces` の語彙が持っている。ここに写しを置くと同じ実測値が 2 か所に
 * 増えてどちらが正か読めなくなるので、この面が固有に持つのは `.audio` だけ。
 */
/**
 * `.audio{border:1px solid var(--l);padding:14px;border-radius:9px;margin-top:14px}`
 * モックの `.audio` は地色を持たない。台紙の色をそのまま透かす。
 */
const AUDIO = 'mt-3.5 rounded-card border border-line p-3.5'
/** `.audio button{width:44px;height:44px;border-radius:50%;background:var(--g);color:#fff}` */
const AUDIO_PLAY = `size-11 shrink-0 rounded-circle bg-pine text-on-pine ${FOCUS_RING}`

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
      <FilterLine>
        <FilterButton onClick={onClear}>フィルターをすべて解除</FilterButton>
      </FilterLine>
    </div>
  )
}

/**
 * `exception-states-approved.html#permission-denied`（突き合わせ台の複製は
 * `gallery/screens/EX-403.screen.tsx`）。
 *
 * 記号も文言もモックのまま。設定の名前も件数も出さないので、54px の「—」だけが
 * 「ここに何かがある」ことを言う。業務のクロムごと入れ替わる全画面の状態である。
 */
export function PermissionDenied({ onBack }: { onBack: () => void }) {
  return (
    <FullScreenState glyph="—" title="この設定を表示する権限がありません">
      <p>権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。</p>
      <Action size="roomy" variant="primary" onClick={onBack}>
        業務開始画面へ戻る
      </Action>
    </FullScreenState>
  )
}

/**
 * `exception-states-approved.html#empty`（複製は `EX-EMPTY.screen.tsx`）。
 *
 * 空は異常ではないので記号を置かない。ただし「消えたのではない」と言い切り、
 * 戻る道を必ず 1 つ添える。
 */
function EmptyReservations({ onClear }: { onClear: () => void }) {
  return (
    <FullScreenState title="条件に一致する予約はありません">
      <p>検索語またはフィルターを変更してください。履歴自体は削除されていません。</p>
      <Action size="roomy" variant="primary" onClick={onClear}>
        フィルターをすべて解除
      </Action>
    </FullScreenState>
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
  frame = 'card',
  wave = false,
}: {
  recording?: RecordingView
  permissions: RecordingPermissions
  /**
   * 受付履歴では `.card` の中に置かれるので、罫を持つと板が二重になる。
   * 面の外枠を持つかどうかだけを選ばせる。
   */
  frame?: 'card' | 'bare'
  /** 受付履歴のモックだけが波形を持つ。予約検索の `.audio` には無い。 */
  wave?: boolean
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [position, setPosition] = useState(0)
  if (!permissions.playRecording) return null

  /*
   * 状態の名乗り。まだ取得できていないときは何も名乗らない。「未取得」は
   * モックの語彙に無いうえ、すぐ下の説明文が同じことを既に言っている。
   */
  const stateLabel = !recording
    ? undefined
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
    <section aria-label="iPad録音" className={frame === 'card' ? AUDIO : 'mt-2'}>
      {/*
       * モックの `.audio` は再生ボタンと 1 行の説明が並ぶだけ。実アプリは
       * 一時停止も要るので同じ行に足すが、行そのものは増やさない。
       */}
      {/*
       * 狭い列（受付履歴の `.detailgrid` は 1.15fr）でも操作が縦に潰れないよう
       * 折り返させる。潰れると「一時停止」が 1 文字ずつ縦に並んで読めなくなる。
       */}
      <div className="flex flex-wrap items-center gap-3">
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
            <FilterButton
              onClick={() => {
                audioRef.current?.pause?.()
              }}
            >
              一時停止
            </FilterButton>
          </>
        )}
        <span>
          予約受付時の録音
          {available && (
            <>
              <span aria-hidden="true"> · </span>
              <span>{formatDuration(available.durationSeconds)}</span>
            </>
          )}
          {stateLabel !== undefined && (
            <>
              <span aria-hidden="true"> · </span>
              {/* 保存できていないことだけは色でも言う。他の状態は語だけで足りる。 */}
              <span className={recording?.state === 'failed' ? 'text-danger' : undefined}>
                {stateLabel}
              </span>
            </>
          )}
        </span>
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
          <small className="mt-1 block">
            録音日時 <span>{formatJstDateTime(available.recordedAt)}</span>
            <span aria-hidden="true"> · </span>
            録音者 <span>{available.recordedBy}</span>
            <span aria-hidden="true"> · </span>
            長さ <span>{formatDuration(available.durationSeconds)}</span>
          </small>
        </>
      )}
      {available && wave && <Waveform />}
      {/* モックの `.audio small` — 持ち出せないことをどの状態でも言い続ける。 */}
      <small className="block">{note}</small>
    </section>
  )
}

/**
 * カードの中の 1 行。モックの `.card` は `<b>` のあと `<br>` で行を継ぐだけで、
 * 段落は使っていない（`<p>` は上下 1em の余白を持つので高さが変わる）。
 */
function CardRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="mt-1 block">
      <span className="text-ink-muted">{label}</span> {children}
    </span>
  )
}

/*
 * 承認済みモックの絞り込みは検索語と 2 つのピルだけで、日付欄も状態の選択肢も
 * 持たない。期間は「今日以降」の 1 段、予約元は「ウォークイン以外」の 1 段しか
 * 無い。段を増やしたくなったら、まずモックを見直す。
 */
type Filters = { term: string; upcomingOnly: boolean; bookedOnly: boolean }
const NO_FILTERS: Filters = { term: '', upcomingOnly: false, bookedOnly: false }

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
  const [purposeNames, setPurposeNames] = useState<Map<string, string>>(new Map())
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
    },
    [api, storeId, onReservationOpened],
  )

  // A preselected reservation (arrived from the ledger) opens straight away.
  /*
   * 目的の名を引く。承認済みモック `RES-SEARCH` の「予約内容」は `視力測定・新調相談`
   * と目的の名で始まっており、`1件` という件数では電話口で復唱できない。予約が持つ
   * のは目的の id だけなので、店舗設定から名を引き当てる。
   */
  useEffect(() => {
    let active = true
    void (async () => {
      const response = await api(`/api/staff/stores/${storeId}/availability/settings`)
      if (!response.ok) return
      const parsed = AvailabilityStoreSettings.safeParse(await readJson(response))
      if (!parsed.success || !active) return
      setPurposeNames(
        new Map(parsed.data.purposes.map((purpose) => [purpose.id, purpose.staffName])),
      )
    })().catch(() => undefined)
    return () => {
      active = false
    }
  }, [api, storeId])

  /*
   * 名が 1 つも引けないうちは件数で耐える。空欄にすると「何の予約か」が消えるので、
   * 名を待つあいだも読めるものを残す。
   */
  const purposeText = (purposeIds: string[]): string => {
    const named = purposeIds.map((id) => purposeNames.get(id)).filter((name) => name !== undefined)
    return named.length === purposeIds.length && named.length > 0
      ? named.join('・')
      : `${purposeIds.length}件`
  }

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
    // 「今後の予約」の基準日は注入された today。画面は時計を読まない。
    if (next.upcomingOnly) params.set('dateFrom', today)
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
  }

  if (forbidden) return <PermissionDenied onBack={() => navigate({ screen: 'home' })} />

  const clearFilters = () => {
    setFilters(NO_FILTERS)
    void search(NO_FILTERS)
  }

  /*
   * 「電話・店頭・Web予約」はウォークインを外すという合成条件で、契約の
   * `source` は単一値しか取れない。サーバへ渡せないのでここで落とす。
   */
  const visible = filters.bookedOnly
    ? results?.filter((reservation) => reservation.source !== 'walkin')
    : results

  // 0 件は「空の一覧」ではなく面ごと入れ替わる（承認済みモック `#empty`）。
  if (visible?.length === 0) return <EmptyReservations onClear={clearFilters} />

  return (
    /*
     * `Workspace` はバーの下の残りいっぱいに伸びる（flex-1）。実アプリでは
     * App のクロムがこの面をブロックとして置くので、伸びる先をここで作る。
     */
    <div className="flex h-full min-h-0 flex-col">
      {/* 画面名はモックでは上部バーのタブが担う。支援技術と自動テストのために
          見出し自体は残し、描画からだけ外す。 */}
      <h2 className="sr-only">予約を検索する</h2>
      <span className="sr-only">{`${storeName} · 検索対象店舗`}</span>
      <Workspace
        list={
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void search(filters)
              }}
            >
              <SearchField
                id="reservation-term"
                label="氏名・電話番号・予約番号"
                placeholder="氏名・電話番号・予約番号"
                value={filters.term}
                onChange={(term) => setFilters((current) => ({ ...current, term }))}
              />
              {/* 承認済みモックの `.filterline` はこの 2 つのピルだけ。並びもモックのまま。 */}
              <FilterLine>
                <FilterToggle
                  pressed={filters.upcomingOnly}
                  onToggle={() => {
                    const next = { ...filters, upcomingOnly: !filters.upcomingOnly }
                    setFilters(next)
                    // 期間はサーバ側の条件なので、押した時点で検索し直す。
                    void search(next)
                  }}
                >
                  今後の予約
                </FilterToggle>
                <FilterToggle
                  pressed={filters.bookedOnly}
                  onToggle={() =>
                    setFilters((current) => ({ ...current, bookedOnly: !current.bookedOnly }))
                  }
                >
                  電話・店頭・Web予約
                </FilterToggle>
              </FilterLine>
            </form>
            {/*
             * 検索対象は 1 店舗に固定されている。他店舗が漏れて見えていないことを
             * 画面自身に言わせる（モックの一覧上部の 2 行）。
             */}
            <p>
              <strong>{`${storeName}の予約だけを表示`}</strong>
              <br />
              <small>他店舗はヘッダーから切り替えてください。</small>
            </p>
            {searchError && (
              <p role="alert" className="text-danger">
                {searchError}
              </p>
            )}
            <section aria-label="検索結果">
              {visible?.map((reservation) => {
                const open = selected?.id === reservation.id
                return (
                  <ListRow
                    key={reservation.id}
                    selected={open}
                    onSelect={() => openReservation(reservation)}
                  >
                    <b>{`${reservation.customer.name} 様`}</b>
                    <br />
                    {formatJstRowDateTime(reservation.startAt)}
                    {` · ${SOURCE_LABEL[reservation.source]} · ${STATUS_LABEL[reservation.status]}`}
                    {/* 選択は 3px の緑枠で分かるが、色だけに頼らず語でも出す。 */}
                    {open && (
                      <>
                        <br />
                        <small>選択中</small>
                      </>
                    )}
                  </ListRow>
                )
              })}
            </section>
          </>
        }
        detail={
          !selected ? (
            <p>候補から予約を選択してください。</p>
          ) : (
            <>
              <section aria-label="予約詳細">
                <h1>{formatJstHeading(selected.startAt)}</h1>
                <CardColumns>
                  <Card className="mt-2.5">
                    <b>予約内容</b>
                    {/* 来店日時は面の見出しが名乗っている。ここで繰り返すと、
                        承認済みモックが「予約内容」に置いている目的が押し出される。 */}
                    <CardRow label="来店目的">{purposeText(selected.purposeIds)}</CardRow>
                    <CardRow label="予約番号">{selected.reservationNumber}</CardRow>
                    <CardRow label="店舗">{storeName}</CardRow>
                  </Card>
                  <Card className="mt-2.5">
                    <b>お客様</b>
                    <CardRow label="お名前">{`${selected.customer.name} 様`}</CardRow>
                    <CardRow label="お客様かな">{selected.customer.kana}</CardRow>
                    <CardRow label="電話番号">{selected.customer.phone}</CardRow>
                  </Card>
                  <Card className="mt-2.5">
                    <b>状態</b>
                    <span className="mt-1 block">{STATUS_LABEL[selected.status]}</span>
                    <span className="block">{SOURCE_LABEL[selected.source]}</span>
                  </Card>
                </CardColumns>
              </section>
              <RecordingPanel recording={recording} permissions={permissions} />
              <FilterLine>
                {/* 取消は取り返しがつかない。既定の見た目にしない。 */}
                <FilterButton
                  variant="danger"
                  onClick={() => {
                    setPanel('cancel')
                    setCancelError(undefined)
                  }}
                >
                  予約を取り消す
                </FilterButton>
                <FilterButton
                  onClick={() => {
                    setPanel('change')
                    setChangeError(undefined)
                  }}
                >
                  日時・内容を変更する
                </FilterButton>
              </FilterLine>
              {panel === 'change' && (
                <Panel label="予約変更">
                  <h2>変更先の枠を探す</h2>
                  <p>元の予約は保持したままです。切り替えは変更先を確保できたときだけ行います。</p>
                  <FilterLine>
                    <FilterDate
                      id="change-date"
                      label="変更先の日"
                      value={changeDate}
                      onChange={setChangeDate}
                    />
                    <FilterButton
                      onClick={() => {
                        void findSlots(changeDate)
                      }}
                    >
                      空き枠を探す
                    </FilterButton>
                  </FilterLine>
                  {slots?.length === 0 && (
                    <p>この日に空き枠はありません。別の日を選んでください。</p>
                  )}
                  {slots && slots.length > 0 && (
                    <FilterLine>
                      {slots.map((slot) => (
                        <FilterButton
                          key={slot.startAt}
                          variant={slotStartTime === slot.startTime ? 'primary' : 'default'}
                          onClick={() => setSlotStartTime(slot.startTime)}
                        >
                          {`${slot.startTime}〜${slot.endTime}`}
                        </FilterButton>
                      ))}
                    </FilterLine>
                  )}
                  <TextAreaField
                    id="change-reason"
                    className="min-h-11"
                    value={changeReason}
                    onChange={(event) => setChangeReason(event.target.value)}
                    label="変更理由"
                  />
                  {changeError && <FailureNotice>{changeError}</FailureNotice>}
                  <Actions>
                    <Action
                      variant="primary"
                      disabled={!slotStartTime}
                      onClick={() => {
                        void applyChange()
                      }}
                    >
                      この枠に切り替える
                    </Action>
                  </Actions>
                </Panel>
              )}
              {panel === 'cancel' && (
                <Panel label="予約取消">
                  <h2>予約を取り消す</h2>
                  <TextAreaField
                    id="cancel-reason"
                    className="min-h-11"
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                    label="取消理由"
                  />
                  <TextField
                    id="cancel-confirmation"
                    className="min-h-11"
                    placeholder="取消"
                    value={cancelConfirmation}
                    onChange={(event) => setCancelConfirmation(event.target.value)}
                    label="確認入力"
                  />
                  <p>
                    確認のため「取消」と入力してください。実行者・日時・変更前内容を履歴に残します。
                  </p>
                  {cancelError && <FailureNotice>{cancelError}</FailureNotice>}
                  <Actions>
                    <Action
                      variant="danger"
                      onClick={() => {
                        void applyCancel()
                      }}
                    >
                      取消を実行する
                    </Action>
                  </Actions>
                </Panel>
              )}
            </>
          )
        }
      />
    </div>
  )
}
