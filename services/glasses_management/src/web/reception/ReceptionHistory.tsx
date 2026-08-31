import type {
  LocalDate,
  ReceptionHistoryDetail,
  ReceptionHistoryEntry,
  Recording,
  RecordingSummary,
  ReservationStatus,
  SearchRelaxation,
} from '@app/contracts'
import { auth, toJstDateString } from '@app/shared'
import { cn, focusRing, focusRingOnPine } from '@app/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SOURCE_LABELS } from '../../worker/domain/ledger'
import { shortDate } from '../booking/SlotStep'
import { client } from '../client'
import { dateLabel, jstClock, shiftDate } from '../ledger/metrics'
import { VisitBadge } from '../ledger/Timetable'
import { hasPlayableRecording, RecordingPlayer } from '../recording/RecordingPlayer'

/*
 * 受付履歴の一覧・詳細・0 件（承認済みモック
 * docs/frontend/mockups/eyex/images/HISTORY-LIST.png と HISTORY-EMPTY.png）。
 *
 * 題材: 店長がお客様からのお問い合わせに、その場で「いつ誰が受け、そのあと何が変わったか」を
 *   答える面と、絞りすぎて 0 件になった店長を条件 1 つで元の道へ戻す面。
 * トークン計画: 左で選び右で読む 2 段。緑は選択中の行の地（`--color-pine-soft`）と「成立」の
 *   札、そして 0 件の件数（`--color-pine-deep`）だけ。時刻は等幅（`--font-mono`）で桁を揃える。
 * シグネチャ: **左 288px の細い一覧と、右の「そのあとの変更」の時系列**／
 *   **候補の右に件数が先に出ていて、押す前に何件見つかるか分かること。**
 *
 * 実測（screens/HISTORY-LIST.html / HISTORY-EMPTY.html の <style> と assets/eyex.css）:
 *   `.toolbar` 56px。`.fbtn` min-height 40px / padding 0 12px / 角 8px（rounded-ctl）/
 *   13px・600（値は 400 の --ink-2。選択中は枠 2px --brand ＋ 地 --brand-tint）。
 *   「お客様名で探す」 min-height 40px / padding 0 14px。**触れるものは 44pt へ上げる。**
 *   `.split` は `288px 1fr`（w-72）。左ペイン padding 24px 16px（px-4 py-6）。
 *   `.hrow` min-height 56px（min-h-14）/ gap 10px、時刻 14px/600 等幅 --ink-2、名前 15px/600、
 *   札は右端。選択中は margin 0 −8px / padding 16px 8px / 角 12px / 地 --brand-tint。
 *   「ほか 42件　8月21日まで」は small・muted・上に 20px。
 *   右ペイン `.det` padding 28px 32px（px-8 py-7）/ 段の間 26px。見出し 20px、副文 13px、
 *   「予約を開く」min-height 44px / padding 0 14px。`dl.kv` は `1.15fr 1.15fr 0.7fr`。
 *   「そのあとの変更」の行 padding 11px 0 / 下罫 1px、日時の欄 92px（w-23）の等幅 13px/600、
 *   内容 15px、操作者は右端 13px --ink-2。
 *   0 件は中央寄せ（padding 36px）・幅 640px（w-160）、見出し 24px 中央、副文 15px 中央、
 *   候補の行 min-height 62px / gap 14px、件数は 21px/600 の等幅 --brand-dark。
 *   「絞り込みをすべて外す（46件）」は min-height 56px / 18px。
 *
 * モックの 14px / 15px / 20px / 21px / 24px はトークンの段（`--text-grid` 13px /
 * `--text-body` 16px / `--text-lead` 17px / `--text-title` 22px）へ寄せた。
 *
 * この面が描かないもの:
 * - 予約の詳細そのもの（`onOpenReservation` で器へ渡すだけ）
 *
 * 「受付のときの録音」（HISTORY-LIST の右下）は `recording` を受けたときだけ節ごと出す。
 * 実測は `.play` = 横並び gap 16px・最大幅 520px、「再生する」min-height 44px / 左右 18px、
 * バー 高さ 8px・角 4px・地 --surface-2・進み --brand、右に等幅 600 13px の「03:24 / 06:12」。
 */

/** 1 ページの行数（AC-RECEP-28「新しい順に 20 件まで」）。読み足しはカーソルで行う。 */
const PAGE_ROWS = 20

/**
 * 右の 3 項目の割り付け（モックの `dl.kv` は `1.15fr 1.15fr 0.7fr`）。Tailwind の任意値
 * （`grid-cols-[...]`）を書かないので、ここだけ `style` で持つ（`booking/SlotBoard.tsx` と同じ扱い）。
 */
const DETAIL_COLUMNS = 'minmax(0, 1.15fr) minmax(0, 1.15fr) minmax(0, 0.7fr)'

/** 既定の期間はモックと同じ 1 週間（8月21日 〜 8月27日）。 */
const DEFAULT_SPAN_DAYS = 6

/**
 * 画面の「結果」3 語。**契約に新しい語を足さない**ので、`ReceptionHistoryQuery.status` の
 * 並びへ落として送る（`04-api.md` §4）。
 */
const RESULT_STATUSES = {
  settled: ['confirmed', 'arrived', 'serving', 'done'],
  cancelled: ['cancelled'],
  no_show: ['no_show'],
} as const satisfies Record<string, readonly ReservationStatus[]>

/** 画面の「結果」の 3 語。外へは `HistoryFilters['result']` として渡る。 */
type HistoryResult = keyof typeof RESULT_STATUSES

const RESULT_LABELS: Record<HistoryResult, string> = {
  settled: '成立',
  cancelled: '取消',
  no_show: 'ご来店なし',
}

/** 画面が持っている絞り込み。器は**そのまま URL のクエリへ写す**（戻ると同じ条件に戻る）。 */
export type HistoryFilters = {
  from: LocalDate
  to: LocalDate
  staffId: string | null
  result: HistoryResult | null
  name: string
}

export type ReceptionHistoryProps = {
  storeId: string
  /** 本日（JST の暦日）。既定の期間と「今月」の言い直しに使う。**端末の時計を読まない。** */
  today: LocalDate
  /** 「担当」の絞り込みに出す顔ぶれと、詳細の担当名の引き当て。 */
  staff: readonly { id: string; name: string }[]
  /** 「予約を開く」から戻ってきたときの条件。 */
  initialQuery?: Partial<HistoryFilters>
  /** 絞り込みが変わったとき。器が URL のクエリへ写す。 */
  onQueryChange?: (filters: HistoryFilters) => void
  onOpenReservation: (reservationId: string) => void
  /** この店舗にまだ受付が 1 件も無いときの次の一手。 */
  onStartBooking: () => void
  /**
   * 選んでいる 1 件の録音。**器が渡したときだけ**「受付のときの録音」の節が出る。
   * 詳細の応答から読まないのは、`ReceptionHistoryDetail.recording` が契約でまだ
   * `null` 固定だからで（`010-recording` の契約は `RecordingSummary` を別に持つ）、
   * 欄が `RecordingSummary` になったらここへ 1 行で繋ぎ替える。
   */
  recording?: RecordingSummary | null
  /**
   * この店舗の録音（P10）。開いている 1 件のぶんを受付セッション id で引き当てる。
   * `recording` を直に渡されたときはそちらが勝つ。
   */
  recordings?: readonly Recording[]
  /**
   * 「この録音を保全する」（UC-TERM-09 / AC-TERM-10）。**この面では確認を求めない** ——
   * ご本人の確認（MODE-PERSONAL）を挟むかどうかは器が決める。
   */
  onPreserveRecording?: (recording: Recording) => void
}

type ListPhase = 'loading' | 'ready' | 'error' | 'forbidden'

/* --- 文言 ----------------------------------------------------------------- */

/** 「8月21日」。絞り込みの札は週をまたいでも曜日を出さない（幅が動くため）。 */
function dayLabel(date: LocalDate): string {
  const day = new Date(`${date}T00:00:00.000Z`)
  return `${day.getUTCMonth() + 1}月${day.getUTCDate()}日`
}

/** 「8/20 14:32」。「そのあとの変更」の日時の欄（等幅・幅 92px）。 */
function changeStamp(occurredAt: string): string {
  const date = toJstDateString(occurredAt)
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} ${jstClock(occurredAt)}`
}

/**
 * 見出しのお名前。**お名前が分からない受付に「様」を重ねない**
 * （`お客様 様` は読み上げでも耳障りで、名前が分からない事実も伝わらない）。
 */
function customerLabel(name: string | null | undefined): string {
  return name == null ? 'お客様' : `${name} 様`
}

/** 一覧の行に出す結果の札。成立は札を持たない（既定なので色に意味が乗らない）。 */
function resultTag(status: ReservationStatus | null): string | null {
  if (status === 'cancelled') return RESULT_LABELS.cancelled
  if (status === 'no_show') return RESULT_LABELS.no_show
  return null
}

/* --- 送る条件 ------------------------------------------------------------- */

function defaultFilters(today: LocalDate): HistoryFilters {
  return {
    from: shiftDate(today, -DEFAULT_SPAN_DAYS),
    to: today,
    staffId: null,
    result: null,
    name: '',
  }
}

function searchParams(storeId: string, filters: HistoryFilters, cursor: string | null): string {
  const params = new URLSearchParams({
    storeId,
    from: filters.from,
    to: filters.to,
    limit: String(PAGE_ROWS),
  })
  if (filters.staffId !== null) params.set('staffId', filters.staffId)
  if (filters.result !== null) params.set('status', RESULT_STATUSES[filters.result].join(','))
  if (filters.name.trim() !== '') params.set('name', filters.name.trim())
  if (cursor !== null) params.set('cursor', cursor)
  return params.toString()
}

/**
 * 緩和候補の `query` を画面の条件へ戻す。**候補はそのまま再送できる形**で届くので、
 * 画面が条件を組み立て直さない（`ReceptionHistoryList.relaxations`）。
 */
function fromRelaxation(query: Record<string, unknown>, base: HistoryFilters): HistoryFilters {
  const statuses = Array.isArray(query.status) ? (query.status as string[]) : []
  const result =
    (Object.keys(RESULT_STATUSES) as HistoryResult[]).find(
      (key) =>
        RESULT_STATUSES[key].length === statuses.length &&
        RESULT_STATUSES[key].every((status) => statuses.includes(status)),
    ) ?? null
  return {
    from: typeof query.from === 'string' ? query.from : base.from,
    to: typeof query.to === 'string' ? query.to : base.to,
    staffId: typeof query.staffId === 'string' ? query.staffId : null,
    result,
    name: typeof query.name === 'string' ? query.name : '',
  }
}

/* --- 絞り込みの札 --------------------------------------------------------- */

function FilterButton({
  term,
  value,
  on,
  open,
  onToggle,
  children,
}: {
  term: string
  value: string
  on: boolean
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: 開いた献立を Esc で閉じるための
       受け皿である（押せるものは中の <button> のままで、この div は鍵しか見ていない）。 */
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        onToggle()
        buttonRef.current?.focus()
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          'flex min-h-11 items-center gap-1.5 rounded-ctl px-3 text-grid font-semibold',
          on
            ? 'border-2 border-pine bg-pine-soft text-pine-deep'
            : 'border border-line-strong bg-surface text-ink',
          focusRing,
        )}
      >
        <span>{term}</span>
        <span className={cn('font-normal', on ? 'text-pine-deep' : 'text-ink-muted')}>{value}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-10 mt-1 flex w-64 flex-col gap-1 rounded-card border border-line-strong bg-surface p-2">
          {children}
        </div>
      )}
    </div>
  )
}

function MenuOption({ label, on, onPick }: { label: string; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={cn(
        'min-h-11 rounded-ctl px-3 text-left text-body font-semibold',
        on
          ? 'border border-pine-line bg-pine-soft text-pine-deep'
          : 'border border-transparent text-ink',
        focusRing,
      )}
    >
      {label}
    </button>
  )
}

/* --- 面 ------------------------------------------------------------------- */

export function ReceptionHistory({
  storeId,
  today,
  staff,
  initialQuery,
  onQueryChange,
  onOpenReservation,
  onStartBooking,
  recording = null,
  recordings = [],
  onPreserveRecording,
}: ReceptionHistoryProps) {
  const [filters, setFilters] = useState<HistoryFilters>(() => ({
    ...defaultFilters(today),
    ...initialQuery,
  }))
  const [menu, setMenu] = useState<'span' | 'staff' | 'result' | null>(null)
  const [items, setItems] = useState<readonly ReceptionHistoryEntry[]>([])
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [relaxations, setRelaxations] = useState<readonly SearchRelaxation[]>([])
  const [phase, setPhase] = useState<ListPhase>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReceptionHistoryDetail | null>(null)
  const [detailFailed, setDetailFailed] = useState(false)

  const staffName = useCallback(
    (id: string | null) => staff.find((member) => member.id === id)?.name ?? null,
    [staff],
  )

  useEffect(() => {
    onQueryChange?.(filters)
  }, [filters, onQueryChange])

  /** 一覧 1 ページ。絞り込みが変わったら先頭から読み直す（読み足しの続きを混ぜない）。 */
  const load = useCallback(
    async (cursor: string | null) => {
      const query = searchParams(storeId, filters, cursor)
      const res = await client.api.staff['reception-sessions'].$get(undefined, {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          auth.authFetch(`${String(input)}?${query}`, init),
      })
      const status: number = res.status
      if (!res.ok) {
        setPhase(status === 403 ? 'forbidden' : 'error')
        return
      }
      const list = await res.json()
      setItems((current) => (cursor === null ? list.items : [...current, ...list.items]))
      setTotal(list.total)
      setNextCursor(list.nextCursor)
      setRelaxations(list.relaxations)
      setPhase('ready')
    },
    [storeId, filters],
  )

  useEffect(() => {
    let live = true
    setPhase('loading')
    setItems([])
    setSelectedId(null)
    setDetail(null)
    load(null).catch(() => {
      if (live) setPhase('error')
    })
    return () => {
      live = false
    }
  }, [load])

  function select(entry: ReceptionHistoryEntry) {
    setSelectedId(entry.entryId)
    setDetail(null)
    setDetailFailed(false)
    client.api.staff['reception-sessions'][':sessionId']
      .$get({ param: { sessionId: entry.entryId } })
      .then(async (res) => {
        if (!res.ok) {
          setDetailFailed(true)
          return
        }
        setDetail(await res.json())
      })
      .catch(() => setDetailFailed(true))
  }

  function apply(next: HistoryFilters) {
    setMenu(null)
    setFilters(next)
  }

  /* --- 一覧を日で束ねる --------------------------------------------------- */

  const groups: { date: LocalDate; entries: ReceptionHistoryEntry[] }[] = []
  for (const entry of items) {
    const date = toJstDateString(entry.startedAt)
    const last = groups.at(-1)
    if (last !== undefined && last.date === date) last.entries.push(entry)
    else groups.push({ date, entries: [entry] })
  }
  const remaining = total - items.length

  const spanLabel = `${dayLabel(filters.from)} 〜 ${dayLabel(filters.to)}`
  const chosenStaff = staffName(filters.staffId)

  return (
    <main aria-label="受付履歴" className="flex h-full min-h-0 flex-col bg-paper">
      <div className="flex min-w-0 flex-none flex-wrap items-center gap-2 border-line border-b bg-surface px-4 py-0.75">
        <fieldset aria-label="受付履歴の絞り込み" className="flex items-center gap-2">
          <FilterButton
            term="期間"
            value={spanLabel}
            on
            open={menu === 'span'}
            onToggle={() => setMenu((current) => (current === 'span' ? null : 'span'))}
          >
            <label className="text-grid text-ink-muted" htmlFor="history-from">
              はじめの日
            </label>
            <input
              id="history-from"
              type="date"
              value={filters.from}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
              className={cn(
                'min-h-11 rounded-ctl border border-line-strong bg-surface px-3 text-body text-ink',
                focusRing,
              )}
            />
            <label className="mt-2 text-grid text-ink-muted" htmlFor="history-to">
              おわりの日
            </label>
            <input
              id="history-to"
              type="date"
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
              className={cn(
                'min-h-11 rounded-ctl border border-line-strong bg-surface px-3 text-body text-ink',
                focusRing,
              )}
            />
          </FilterButton>

          <FilterButton
            term="担当"
            value={chosenStaff ?? 'すべて'}
            on={filters.staffId !== null}
            open={menu === 'staff'}
            onToggle={() => setMenu((current) => (current === 'staff' ? null : 'staff'))}
          >
            <MenuOption
              label="すべての担当"
              on={filters.staffId === null}
              onPick={() => apply({ ...filters, staffId: null })}
            />
            {staff.map((member) => (
              <MenuOption
                key={member.id}
                label={member.name}
                on={filters.staffId === member.id}
                onPick={() => apply({ ...filters, staffId: member.id })}
              />
            ))}
          </FilterButton>

          <FilterButton
            term="結果"
            value={filters.result === null ? 'すべて' : RESULT_LABELS[filters.result]}
            on={filters.result !== null}
            open={menu === 'result'}
            onToggle={() => setMenu((current) => (current === 'result' ? null : 'result'))}
          >
            <MenuOption
              label="すべての結果"
              on={filters.result === null}
              onPick={() => apply({ ...filters, result: null })}
            />
            {(Object.keys(RESULT_LABELS) as HistoryResult[]).map((key) => (
              <MenuOption
                key={key}
                label={RESULT_LABELS[key]}
                on={filters.result === key}
                onPick={() => apply({ ...filters, result: key })}
              />
            ))}
          </FilterButton>
        </fieldset>

        <input
          type="search"
          autoComplete="off"
          aria-label="お客様名で探す"
          placeholder="お客様名で探す"
          value={filters.name}
          onChange={(event) => setFilters({ ...filters, name: event.target.value })}
          className={cn(
            'ml-auto min-h-11 w-40 rounded-ctl border border-line-strong bg-surface px-3.5 text-grid text-ink',
            'placeholder:text-ink-faint',
            focusRing,
          )}
        />
        {phase === 'ready' && total === 0 && (
          <span className="text-grid text-ink-muted">該当 0件</span>
        )}
      </div>

      {phase === 'loading' && <ListSkeleton />}
      {phase === 'forbidden' && (
        <p role="alert" className="px-8 py-6 text-body text-ink-muted">
          受付履歴を見る権限がありません。お店の管理者にご確認ください。
        </p>
      )}
      {phase === 'error' && (
        <p role="alert" className="px-8 py-6 text-body text-ink-muted">
          受付履歴を読み込めませんでした。通信が切れているかもしれません。
        </p>
      )}

      {phase === 'ready' && total === 0 && (
        <EmptyHistory
          filters={filters}
          staffName={chosenStaff}
          relaxations={relaxations}
          onPick={(query) => apply(fromRelaxation(query, filters))}
          onStartBooking={onStartBooking}
        />
      )}

      {phase === 'ready' && total > 0 && (
        <div className="flex min-h-0 flex-1">
          <section
            aria-label="受付履歴の一覧"
            className="w-72 flex-none overflow-y-auto border-line border-r bg-surface-2 px-4 py-6"
          >
            <fieldset aria-label="受付の一覧">
              {groups.map((group, index) => (
                <div key={group.date}>
                  <h3 className="m-0 mt-6 mb-3 text-body font-semibold text-ink-muted first:mt-0">
                    {index === 0 ? `${dateLabel(group.date)}　${total}件` : dateLabel(group.date)}
                  </h3>
                  {group.entries.map((entry) => {
                    const on = entry.entryId === selectedId
                    const tag = resultTag(entry.reservationStatus)
                    return (
                      <button
                        key={entry.entryId}
                        type="button"
                        aria-current={on ? true : undefined}
                        onClick={() => select(entry)}
                        className={cn(
                          'flex min-h-14 w-full items-center gap-2.5 border-line border-t px-2 text-left first:border-t-0',
                          on ? 'rounded-card border-transparent bg-pine-soft' : 'bg-transparent',
                          focusRing,
                        )}
                      >
                        <span className="font-mono text-grid font-semibold text-ink-muted">
                          {jstClock(entry.startedAt)}
                        </span>
                        <span className="text-body font-semibold text-ink">
                          {entry.displayName}
                        </span>
                        {entry.visitCount !== null && <VisitBadge count={entry.visitCount} />}
                        {tag !== null && (
                          <span className="ml-auto inline-flex min-h-5.5 items-center rounded-ctl border border-danger bg-danger-soft px-2 text-note font-semibold text-danger">
                            {tag}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </fieldset>
            {remaining > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (nextCursor !== null) load(nextCursor).catch(() => setPhase('error'))
                }}
                className={cn(
                  'mt-5 min-h-11 w-full rounded-ctl px-2 text-left text-grid text-ink-muted',
                  focusRing,
                )}
              >
                {`ほか ${remaining}件　${dayLabel(filters.from)}まで`}
              </button>
            )}
          </section>

          <HistoryDetail
            detail={detail}
            failed={detailFailed}
            selected={selectedId !== null}
            staffName={staffName}
            recording={recording}
            recordings={recordings}
            {...(onPreserveRecording === undefined ? {} : { onPreserveRecording })}
            onOpenReservation={onOpenReservation}
          />
        </div>
      )}
    </main>
  )
}

/** 読み込み中は行の高さを保った帯を 20 本置く。**回るアイコンを置かない。** */
function ListSkeleton() {
  return (
    <div role="status" className="w-72 flex-none border-line border-r bg-surface-2 px-4 py-6">
      <span className="sr-only">受付履歴を読み込んでいます…</span>
      <ul aria-hidden="true" className="m-0 list-none p-0">
        {Array.from({ length: PAGE_ROWS }, (_, index) => (
          <li key={index} className="min-h-14 border-line border-t bg-surface first:border-t-0" />
        ))}
      </ul>
    </div>
  )
}

/* --- 右の詳細 ------------------------------------------------------------- */

function HistoryDetail({
  detail,
  failed,
  selected,
  staffName,
  recording,
  recordings,
  onPreserveRecording,
  onOpenReservation,
}: {
  detail: ReceptionHistoryDetail | null
  failed: boolean
  selected: boolean
  staffName: (id: string | null) => string | null
  recording: RecordingSummary | null
  recordings: readonly Recording[]
  onPreserveRecording?: (recording: Recording) => void
  onOpenReservation: (reservationId: string) => void
}) {
  if (!selected) {
    return (
      <section aria-label="選んだ受付の中身" className="min-w-0 flex-1 bg-surface px-8 py-7">
        <p className="text-body text-ink-muted">
          左の 1 件をお選びください。受け付けた人とそのあとの変更がここに出ます。
        </p>
      </section>
    )
  }
  if (failed) {
    return (
      <section aria-label="選んだ受付の中身" className="min-w-0 flex-1 bg-surface px-8 py-7">
        <p role="alert" className="text-body text-ink-muted">
          この受付の中身を読み込めませんでした。もう一度お選びください。
        </p>
      </section>
    )
  }
  if (detail === null) {
    return (
      <section aria-label="選んだ受付の中身" className="min-w-0 flex-1 bg-surface px-8 py-7">
        <p className="text-body text-ink-muted">受付の中身を読み込んでいます…</p>
      </section>
    )
  }

  const reservation = detail.reservation
  const assigned = reservation?.assignments.find((row) => row.kind === 'staff') ?? null
  /*
   * この受付の録音（P10）。器が `recording` を直に渡したときはそれを描き、
   * 渡していなければ店舗の録音から受付セッション id で引き当てる。
   */
  const found =
    recordings.find(
      (row) => row.receptionSessionId === detail.sessionId && row.state === 'stored',
    ) ?? null

  const shown: RecordingSummary | null =
    recording ??
    (found === null
      ? null
      : { id: found.id, state: found.state, durationSeconds: found.durationSeconds })
  const tag = reservation === null ? null : (resultTag(reservation.status) ?? RESULT_LABELS.settled)
  const received =
    detail.receivedBy === null
      ? `${shortDate(toJstDateString(detail.receivedAt))}${jstClock(detail.receivedAt)} に Web から受け付け`
      : `${detail.receivedBy} が ${shortDate(toJstDateString(detail.receivedAt))}${jstClock(detail.receivedAt)} に${
          reservation === null ? '店頭' : SOURCE_LABELS[reservation.source]
        }で受け付け`

  return (
    <section
      aria-label="選んだ受付の中身"
      className="flex min-w-0 flex-1 flex-col gap-6.5 overflow-y-auto bg-surface px-8 py-7"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <b className="text-lead font-bold text-ink">
              {reservation === null
                ? '破棄した受付'
                : `${customerLabel(reservation.customerName)}　${jstClock(reservation.startsAt)} 〜 ${jstClock(reservation.endsAt)} のご予約`}
            </b>
            {/* 来店回数の印は台帳（Timetable）と同じ 1 か所の綴りを呼ぶ。 */}
            {reservation?.visitCount != null && <VisitBadge count={reservation.visitCount} />}
          </p>
          <p className="mt-1 text-grid text-ink-muted">{received}</p>
        </div>
        {tag !== null && (
          <span
            className={cn(
              'inline-flex min-h-5.5 items-center rounded-ctl border px-2 text-note font-semibold',
              tag === RESULT_LABELS.settled
                ? 'border-pine-line bg-pine-soft text-pine-deep'
                : 'border-danger bg-danger-soft text-danger',
            )}
          >
            {tag}
          </span>
        )}
        {reservation !== null && (
          <button
            type="button"
            onClick={() => onOpenReservation(reservation.id)}
            className={cn(
              'min-h-11 flex-none rounded-ctl border border-line-strong bg-surface px-3.5 text-body font-semibold text-ink',
              focusRing,
            )}
          >
            予約を開く
          </button>
        )}
      </div>

      {reservation !== null && (
        <dl className="m-0 grid gap-x-3.5" style={{ gridTemplateColumns: DETAIL_COLUMNS }}>
          <div>
            <dt className="text-grid text-ink-muted">ご来店日時</dt>
            <dd className="m-0 mt-0.5 text-body font-semibold text-ink">
              {`${dateLabel(toJstDateString(reservation.startsAt))}${jstClock(reservation.startsAt)}`}
            </dd>
          </div>
          <div>
            <dt className="text-grid text-ink-muted">ご来店の目的</dt>
            <dd className="m-0 mt-0.5 text-body font-semibold text-ink">
              {`${reservation.purposeLabelInternal}（${reservation.durationMinutes}分）`}
            </dd>
          </div>
          <div>
            <dt className="text-grid text-ink-muted">担当</dt>
            <dd className="m-0 mt-0.5 text-body font-semibold text-ink">
              {staffName(assigned?.targetId ?? null) ?? 'これから決めます'}
            </dd>
          </div>
        </dl>
      )}

      <div>
        <h3 className="m-0 mb-3 text-body font-semibold text-ink-muted">そのあとの変更</h3>
        {/*
         * 1 行も無いときは**空の並びを置かない**。見出しだけが残ると「読み込めていない」のか
         * 「まだ何も起きていない」のかが手元から見分けられない。
         */}
        {detail.changes.length === 0 && (
          <p className="text-grid text-ink-muted">まだ何もありません。</p>
        )}
        {detail.changes.length > 0 && (
          <ul aria-label="そのあとの変更" className="m-0 list-none p-0">
            {detail.changes.map((change) => (
              <li
                key={`${change.occurredAt}-${change.what}`}
                className="flex items-baseline gap-3.5 border-line border-b py-3 last:border-b-0"
              >
                <span className="w-23 flex-none font-mono text-grid font-semibold text-ink-muted">
                  {changeStamp(change.occurredAt)}
                </span>
                <span className="text-body text-ink">{change.what}</span>
                <span className="ml-auto text-grid text-ink-muted">{change.actorName ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
       * 聞けない録音（無い・端末に残ったまま・消した）のときは**見出しごと出さない**。
       * 空の節が残ると「読み込めていない」のか「もう無い」のかが手元から見分けられない。
       */}
      {hasPlayableRecording(shown) && (
        <div>
          <h3 className="m-0 mb-3 text-body font-semibold text-ink-muted">受付のときの録音</h3>
          <RecordingPlayer recording={shown} placement="inline" />
          {/*
           * 保全（UC-TERM-09）。**すでに保全されている録音にボタンを出さない**
           * （押せて何も起きない操作を置かない）。解除の経路はこの面に置かない。
           */}
          {found !== null &&
            onPreserveRecording !== undefined &&
            (found.legalHold ? (
              <p className="mt-3 text-grid text-ink-muted">
                この録音は保全されています。期限が来ても消えません。
              </p>
            ) : (
              <button
                type="button"
                onClick={() => onPreserveRecording(found)}
                className={cn(
                  'mt-3 min-h-11 rounded-ctl border border-line-strong bg-surface px-4 text-body font-semibold text-ink',
                  focusRing,
                )}
              >
                この録音を保全する
              </button>
            ))}
        </div>
      )}
    </section>
  )
}

/* --- 0 件（HISTORY-EMPTY） ------------------------------------------------ */

/** 「絞り込みをすべて外す」の候補だけは 0 件の画面の主操作なので、並びから抜いて下へ置く。 */
const CLEAR_ALL_LABEL = '絞り込みをすべて外す'

function EmptyHistory({
  filters,
  staffName,
  relaxations,
  onPick,
  onStartBooking,
}: {
  filters: HistoryFilters
  staffName: string | null
  relaxations: readonly SearchRelaxation[]
  onPick: (query: Record<string, unknown>) => void
  onStartBooking: () => void
}) {
  const clearAll = relaxations.find((item) => item.label === CLEAR_ALL_LABEL) ?? null
  const narrowed = relaxations.filter((item) => item.label !== CLEAR_ALL_LABEL)
  const said = [
    `${dayLabel(filters.from)} 〜 ${dayLabel(filters.to)}`,
    staffName === null ? null : `担当 ${staffName}`,
    filters.result === null ? null : `結果 ${RESULT_LABELS[filters.result]}`,
    filters.name.trim() === '' ? null : `お客様名 ${filters.name.trim()}`,
  ].filter((part): part is string => part !== null)

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-9">
      <section aria-label="条件に合う受付履歴がないときの案内" className="w-160 max-w-full">
        {/*
         * 0 件になったことは `role="status"` で言う。**`role="alert"` にしない** —
         * 接客の最中に読み上げが割り込み、打っている手が止まる（AC-RECEP-21）。
         */}
        <div role="status">
          <h2 className="m-0 text-center text-title font-bold text-ink">
            条件に合う受付履歴はありませんでした
          </h2>
          <p className="mt-3 text-center text-body text-ink-muted">
            {`${said.join('／')}　で 0件でした。`}
          </p>
        </div>

        {narrowed.length > 0 && (
          <>
            <h3 className="m-0 mt-9 mb-1.5 text-body font-semibold text-ink-muted">
              条件を変えると見つかります
            </h3>
            <fieldset aria-label="条件を変えると見つかります">
              {narrowed.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  aria-label={`${item.label}　${item.count}件　この条件で見る`}
                  onClick={() => onPick(item.query)}
                  className={cn(
                    'flex min-h-15.5 w-full items-center gap-3.5 border-line border-t px-1 text-left first:border-t-0',
                    focusRing,
                  )}
                >
                  <b className="text-body font-semibold text-ink">{item.label}</b>
                  <span className="ml-auto font-mono text-lead font-semibold text-pine-deep">
                    {`${item.count}件`}
                  </span>
                  <span className="inline-flex min-h-11 flex-none items-center rounded-ctl border border-line-strong bg-surface px-3.5 text-body font-semibold text-ink">
                    この条件で見る
                  </span>
                </button>
              ))}
            </fieldset>
          </>
        )}

        <div className="mt-8">
          {clearAll !== null ? (
            <button
              type="button"
              onClick={() => onPick(clearAll.query)}
              className={cn(
                'min-h-14 rounded-card bg-pine px-5 text-lead font-semibold text-on-pine',
                focusRingOnPine,
              )}
            >
              {`${CLEAR_ALL_LABEL}（${clearAll.count}件）`}
            </button>
          ) : (
            /*
             * 緩められる条件が 1 つも無い（この店舗にまだ受付が無い）。
             * **行き止まりにしない**ので、次の一手を 1 つだけ置く。
             */
            <button
              type="button"
              onClick={onStartBooking}
              className={cn(
                'min-h-14 rounded-card bg-pine px-5 text-lead font-semibold text-on-pine',
                focusRingOnPine,
              )}
            >
              ＋ 予約を取る
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
