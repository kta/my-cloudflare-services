import { ReceptionHistoryEntry } from '@app/contracts'
import { useCallback, useEffect, useState } from 'react'
import { FilterButton, FilterLine, FilterSelect, SearchField } from './design/controls'
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
          <FilterButton
            variant={filters.attentionOnly ? 'primary' : 'default'}
            onClick={() =>
              setFilters((current) => ({ ...current, attentionOnly: !current.attentionOnly }))
            }
          >
            <span aria-hidden="true">要確認</span>
            <span className="sr-only">要確認</span>
          </FilterButton>
        </div>
        <FilterLine>
          <FilterSelect
            id="history-source"
            label="受付経路"
            value={filters.source}
            onChange={(source) => setFilters((current) => ({ ...current, source }))}
          >
            <option value="">すべての経路</option>
            <option value="staff">電話・店頭</option>
            <option value="web">Web予約</option>
            <option value="walkin">ウォークイン</option>
          </FilterSelect>
          <FilterSelect
            id="history-action"
            label="操作種別"
            value={filters.action}
            onChange={(action) => setFilters((current) => ({ ...current, action }))}
          >
            <option value="">すべての操作</option>
            <option value="created">予約受付</option>
            <option value="changed">変更</option>
            <option value="cancelled">取消</option>
            <option value="no_show">無断キャンセル</option>
            <option value="walkin_created">ウォークイン受付</option>
          </FilterSelect>
          <button
            type="submit"
            className={`min-h-11 rounded-ctl border border-pine bg-pine px-3 font-sans text-body text-on-pine ${FOCUS_RING}`}
          >
            絞り込む
          </button>
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
            {/* `.source{float:right}` — 何の記録かを行の右肩に置く。 */}
            <span className="float-right text-grid">
              <StatePill>{ACTION_LABEL[entry.action]}</StatePill>
            </span>
            {/* 時刻は数字なので等幅。和文はここに混ぜない。 */}
            <time className="block font-bold font-mono text-grid text-pine">
              {formatJstTime(entry.occurredAt)}
            </time>
            <b className="block">{titleOf(entry)}</b>
            <span className="block text-grid text-ink-muted">
              {SOURCE_LABEL[entry.source]} · {entry.actorId}
            </span>
            {entry.requiresAttention && (
              <span className="block font-bold text-danger text-note">要確認</span>
            )}
            {selectedId === entry.id && (
              <span className="block text-ink-muted text-note">選択中</span>
            )}
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
      <TitleRow
        push={
          <StatePill tone={selected.requiresAttention ? 'danger' : 'plain'}>
            {selected.requiresAttention ? '要確認' : '確認不要'}
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
          <DetailLine label="発生日時" value={formatJstDateTime(selected.occurredAt)} />
          <DetailLine label="操作" value={ACTION_LABEL[selected.action]} />
          <DetailLine label="予約番号" value={selected.reservationNumber ?? '予約なし'} />
          <DetailLine label="受付経路" value={SOURCE_LABEL[selected.source]} />
          <RecordingPanel
            recording={resolveRecording?.(selected) ?? recording}
            permissions={permissions}
          />
        </Card>
        <Card>
          <b className="block">お客様</b>
          <p className="mt-1 font-bold">{selected.customerName ?? '顧客未登録'}</p>
          <p className="text-grid">{selected.customerPhone ?? '未登録'}</p>
          <DetailLine label="受付者" value={selected.actorId} />
          <DetailLine label="顧客照合" value={selected.customerName ? '既存顧客' : '顧客未登録'} />
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

/** `.row{display:flex;justify-content:space-between;border-top:1px solid …}` */
function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="mt-1 flex justify-between gap-3 border-line border-t pt-1 text-grid">
      <span className="text-ink-muted">{label}</span>
      <b className="text-ink">{value}</b>
    </p>
  )
}
