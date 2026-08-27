import { ReceptionHistoryEntry } from '@app/contracts'
import { useCallback, useEffect, useState } from 'react'
import {
  CARD,
  classifySearchTerm,
  DETAIL_PANE,
  EmptyState,
  FILTER,
  FILTER_LINE,
  FOCUS_RING,
  formatJstDateTime,
  formatJstDayHeading,
  formatJstTime,
  LIST_PANE,
  PermissionDenied,
  RecordingPanel,
  type RecordingPermissions,
  type RecordingView,
  ROW,
  ROW_SELECTED,
  WORKSPACE,
} from './ReservationSearchScreen'
import type { StaffScreenProps } from './staff-screen'

const SOURCE_LABEL = { staff: '電話・店頭', web: 'Web予約', walkin: 'ウォークイン' } as const
const ACTION_LABEL = {
  created: '予約受付',
  changed: '変更',
  cancelled: '取消',
  no_show: '無断キャンセル',
  walkin_created: 'ウォークイン受付',
} as const

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

type Filters = { term: string; source: string; action: string; attentionOnly: boolean }
const NO_FILTERS: Filters = { term: '', source: '', action: '', attentionOnly: false }

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

  const load = useCallback(
    async (query: Filters) => {
      const params = new URLSearchParams({ date: today })
      const classified = classifySearchTerm(query.term)
      // 予約番号 / 電話 / 氏名 are the three history search fields; a kana term
      // is still a person's name as far as this endpoint is concerned.
      if (classified)
        params.set(classified.field === 'kana' ? 'name' : classified.field, classified.value)
      if (query.source) params.set('source', query.source)
      if (query.action) params.set('action', query.action)
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

  const selected = entries?.find((entry) => entry.id === selectedId)

  if (forbidden) return <PermissionDenied onBack={() => navigate({ screen: 'home' })} />

  return (
    <div className={WORKSPACE}>
      {/* 画面名はモックでは上部バーのタブが担う。支援技術と自動テストのために
          見出し自体は残し、描画からだけ外す。 */}
      <h2 className="sr-only">受付履歴</h2>
      <span className="sr-only">{`${storeName} · 当日の受付記録`}</span>
      <aside className={LIST_PANE}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void load(filters)
          }}
        >
          {/* `.tools{display:flex;gap:7px}` — 検索欄が伸び、その隣にチップが並ぶ。 */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="history-term"
              aria-label="氏名・電話番号・予約番号"
              placeholder="氏名・電話番号・予約番号"
              className={`min-h-11 flex-1 rounded-ctl border-2 border-pine bg-surface px-3 font-sans text-ink placeholder:text-ink-muted ${FOCUS_RING}`}
              value={filters.term}
              onChange={(event) =>
                setFilters((current) => ({ ...current, term: event.target.value }))
              }
            />
            <button
              type="button"
              aria-pressed={filters.attentionOnly}
              className={
                filters.attentionOnly
                  ? `min-h-11 rounded-ctl border border-pine bg-pine px-3 font-sans text-on-pine text-sm ${FOCUS_RING}`
                  : FILTER
              }
              onClick={() =>
                setFilters((current) => ({ ...current, attentionOnly: !current.attentionOnly }))
              }
            >
              要確認
            </button>
          </div>
          <div className={FILTER_LINE}>
            <select
              id="history-source"
              aria-label="受付経路"
              className={`w-32 ${FILTER}`}
              value={filters.source}
              onChange={(event) =>
                setFilters((current) => ({ ...current, source: event.target.value }))
              }
            >
              <option value="">すべての経路</option>
              <option value="staff">電話・店頭</option>
              <option value="web">Web予約</option>
              <option value="walkin">ウォークイン</option>
            </select>
            <select
              id="history-action"
              aria-label="操作種別"
              className={`w-32 ${FILTER}`}
              value={filters.action}
              onChange={(event) =>
                setFilters((current) => ({ ...current, action: event.target.value }))
              }
            >
              <option value="">すべての操作</option>
              <option value="created">予約受付</option>
              <option value="changed">変更</option>
              <option value="cancelled">取消</option>
              <option value="no_show">無断キャンセル</option>
              <option value="walkin_created">ウォークイン受付</option>
            </select>
            <button
              type="submit"
              className={`min-h-11 rounded-ctl bg-pine px-3 font-sans text-on-pine text-sm ${FOCUS_RING}`}
            >
              絞り込む
            </button>
          </div>
        </form>
        {loadError && (
          <p role="alert" className="mt-2.5 font-sans text-danger text-sm">
            {loadError}
          </p>
        )}
        {/* `.day` — 発生順の記録は日付見出しの下にまとまる。 */}
        <p className="mt-3 font-sans font-bold text-ink text-sm">
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
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelectedId(entry.id)}
              className={selectedId === entry.id ? RECEPTION_ROW_SELECTED : ROW}
            >
              {/* `.source{float:right}` — 何の記録かを行の右肩に置く。 */}
              <span className="float-right rounded-pill bg-pine-soft px-2 py-0.5 text-pine text-xs">
                {ACTION_LABEL[entry.action]}
              </span>
              <time className="block font-mono font-semibold text-pine text-sm">
                {formatJstTime(entry.occurredAt)}
              </time>
              <b className="block text-ink">{titleOf(entry)}</b>
              <span className="block text-ink-muted text-sm">
                {SOURCE_LABEL[entry.source]} · {entry.actorId}
              </span>
              {entry.requiresAttention && (
                <span className="block font-medium text-danger text-xs">要確認</span>
              )}
              {selectedId === entry.id && (
                <span className="block text-ink-muted text-xs">選択中</span>
              )}
            </button>
          ))}
        </section>
      </aside>
      <section className={DETAIL_PANE}>
        {!selected ? (
          <p className="font-sans text-ink-muted text-sm">
            受付イベントを選ぶと、内容をここに表示します。
          </p>
        ) : (
          <section aria-label="受付イベント詳細">
            {/* `.detailhead` — 何が起きたか、いつ、誰が。状態は右肩の `.badge`。 */}
            <div className="flex items-center gap-3">
              <div>
                <h3 className="font-display font-semibold text-2xl text-ink">
                  {titleOf(selected)}
                </h3>
                <p className="font-sans text-ink-muted text-sm">
                  {`${formatJstDateTime(selected.occurredAt)} · 受付者 ${selected.actorId}`}
                </p>
              </div>
              <span
                className={`ml-auto rounded-pill px-3 py-1 font-sans text-sm ${
                  selected.requiresAttention
                    ? 'bg-danger-soft text-danger'
                    : 'bg-pine-soft text-pine'
                }`}
              >
                {selected.requiresAttention ? '要確認' : '確認不要'}
              </span>
            </div>
            {/* `.detailgrid{grid-template-columns:1.15fr .85fr;gap:12px}` */}
            <div className="mt-3.5 grid grid-cols-[1.15fr_0.85fr] gap-3">
              <div className={CARD}>
                <b>予約内容</b>
                <DetailLine label="発生日時" value={formatJstDateTime(selected.occurredAt)} />
                <DetailLine label="操作" value={ACTION_LABEL[selected.action]} />
                <DetailLine label="予約番号" value={selected.reservationNumber ?? '予約なし'} />
                <DetailLine label="受付経路" value={SOURCE_LABEL[selected.source]} />
                <RecordingPanel
                  recording={resolveRecording?.(selected) ?? recording}
                  permissions={permissions}
                />
              </div>
              <div className={CARD}>
                <b>お客様</b>
                <p className="mt-1 font-semibold text-ink">
                  {selected.customerName ?? '顧客未登録'}
                </p>
                <p className="text-ink text-sm">{selected.customerPhone ?? '未登録'}</p>
                <DetailLine label="受付者" value={selected.actorId} />
                <DetailLine
                  label="顧客照合"
                  value={selected.customerName ? '既存顧客' : '顧客未登録'}
                />
              </div>
            </div>
          </section>
        )}
      </section>
    </div>
  )
}

/** `.event.on{border:2px solid var(--g);background:#f2f8f4}` */
const RECEPTION_ROW_SELECTED = ROW_SELECTED.replace('border-[3px]', 'border-2')

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="mt-1 border-line border-t pt-1 text-sm">
      <span className="text-ink-muted">{label}</span> <span className="text-ink">{value}</span>
    </p>
  )
}
