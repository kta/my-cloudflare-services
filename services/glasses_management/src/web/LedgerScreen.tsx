import { AvailabilityStoreSettings, CustomerCandidate, LedgerEntry } from '@app/contracts'
import { Button, Card, Chip, Field, Notice, TextInput } from '@app/ui'
import { useCallback, useEffect, useState } from 'react'
import {
  entryPlacement,
  formatJstMinutes,
  gridColumnLabels,
  jstMinutesOf,
  LEDGER_GRID,
  nowLine,
} from './ledger-timeline'
import type { StaffScreenProps } from './staff-screen'

/**
 * The daily ledger (LEDGER-DAY): every booking channel and every walk-in on
 * one time axis (UC-EYEX-043), drawn as the approved mock draws it — a
 * 180px lane column, half-hour columns on a `grid-head` strip, appointment
 * cells tinted `pine-soft` and walk-in cells `walkin-soft`, and the now line
 * as a `danger` rule down the column area with its chip clear of the header.
 *
 * Colour is never the carrier of meaning: source, state and warnings are all
 * spelled out, because this screen is read at a glance from across a shop
 * floor and on a glare-lit iPad.
 */

type LedgerScreenProps = StaffScreenProps & {
  /** JST day being shown, `YYYY-MM-DD`. */
  date: string
  /** Injected current instant; the screen never reads the wall clock. */
  now: string
}

const SOURCE_LABELS = {
  staff: '店頭・電話',
  web: 'Web予約',
  walkin: 'ウォークイン',
} as const

const PROGRESS_LABELS = {
  waiting: 'お待ち',
  service_in_progress: '接客中',
  service_completed: '接客完了',
  departed: '退店',
} as const

const RESERVATION_STATUS_LABELS = {
  confirmed: '予約済み',
  checked_in: '来店済み',
  cancelled: '取消',
  no_show: '無断キャンセル',
} as const

/** The lane walk-ins always occupy, in either view — as in the approved mock. */
const WALKIN_LANE = 'ウォークイン'
const UNASSIGNED_STAFF_LANE = '担当者未定'
const UNASSIGNED_EQUIPMENT_LANE = '設備未定'
/** The lane column, in CSS pixels; the now line is measured from its right edge. */
const LANE_COLUMN_PX = 180

/** Shown only when the name join has not answered; never a raw id. */
const UNKNOWN_NAME = '名称未取得'

type Attempt = {
  /** What is re-sent when the operator chooses to re-apply after a conflict. */
  send: (version: number) => Promise<Response>
  /** What this terminal was trying to record, for the conflict comparison. */
  describe: string
}

function timeRange(entry: LedgerEntry): string {
  return `${formatJstMinutes(jstMinutesOf(entry.startAt))}–${formatJstMinutes(jstMinutesOf(entry.endAt))}`
}

function conflictVersion(payload: unknown): number | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const version = (payload as Record<string, unknown>).currentVersion
  return typeof version === 'number' ? version : undefined
}

type Placed = { entry: LedgerEntry; startColumn: number; spanColumns: number }

/** Lanes stacked so two entries never share a cell, mirroring the mock's rows. */
function packLane(placed: Placed[]): Placed[][] {
  const rows: Placed[][] = []
  for (const item of [...placed].sort((a, b) => a.startColumn - b.startColumn)) {
    const row = rows.find((candidate) => {
      const last = candidate[candidate.length - 1]
      return last !== undefined && last.startColumn + last.spanColumns <= item.startColumn
    })
    if (row) row.push(item)
    else rows.push([item])
  }
  return rows.length > 0 ? rows : [[]]
}

export function LedgerScreen({ storeId, storeName, api, navigate, date, now }: LedgerScreenProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [names, setNames] = useState<{
    staff: Map<string, string>
    equipment: Map<string, string>
  }>({ staff: new Map(), equipment: new Map() })
  const [loadFailed, setLoadFailed] = useState(false)
  const [view, setView] = useState<'staff' | 'equipment'>('staff')
  const [selectedId, setSelectedId] = useState<string>()
  const [conflict, setConflict] = useState<{ attempt: Attempt; currentVersion: number }>()
  const [searchName, setSearchName] = useState('')
  const [candidates, setCandidates] = useState<CustomerCandidate[]>()
  const [newCustomer, setNewCustomer] = useState({ name: '', kana: '', phone: '' })

  const load = useCallback(async () => {
    const response = await api(`/api/staff/stores/${storeId}/ledger?date=${date}`)
    if (!response.ok) {
      setLoadFailed(true)
      return
    }
    const parsed = LedgerEntry.array().safeParse(await response.json())
    if (!parsed.success) {
      setLoadFailed(true)
      return
    }
    setLoadFailed(false)
    setEntries(parsed.data)
  }, [api, date, storeId])

  useEffect(() => {
    void load().catch(() => setLoadFailed(true))
  }, [load])

  /*
   * The lane names. Fetched here rather than taken as a prop: the ledger is the
   * only screen that needs the join, and a lane labelled with a raw id is not
   * something an operator can act on. A failed join degrades to a named
   * placeholder — it never falls back to showing the id.
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const response = await api(`/api/staff/stores/${storeId}/availability/settings`)
      if (!response.ok) return
      const parsed = AvailabilityStoreSettings.safeParse(await response.json())
      if (!parsed.success || cancelled) return
      setNames({
        staff: new Map(parsed.data.staff.map((member) => [member.id, member.name])),
        equipment: new Map(parsed.data.equipment.map((item) => [item.id, item.name])),
      })
    })().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [api, storeId])

  const run = async (attempt: Attempt, version: number) => {
    const response = await attempt.send(version)
    if (response.status === 409) {
      const latest = conflictVersion(await response.json().catch(() => undefined))
      await load()
      if (latest !== undefined) setConflict({ attempt, currentVersion: latest })
      return
    }
    setConflict(undefined)
    if (response.ok) await load()
    else setLoadFailed(true)
  }

  const patch = (path: string, body: unknown) =>
    api(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  /** Group key per view: a lane is always a name a person recognises. */
  const laneKeys = (entry: LedgerEntry): string[] => {
    if (entry.entryType === 'walkin') return [WALKIN_LANE]
    if (view === 'staff') {
      if (entry.assignedStaffId === null) return [UNASSIGNED_STAFF_LANE]
      return [names.staff.get(entry.assignedStaffId) ?? UNKNOWN_NAME]
    }
    if (entry.assignedEquipmentIds.length === 0) return [UNASSIGNED_EQUIPMENT_LANE]
    return entry.assignedEquipmentIds.map((id) => names.equipment.get(id) ?? UNKNOWN_NAME)
  }

  /*
   * レーンは店舗の名簿そのものであり、予約の並び順の副産物ではない。設定順に
   * 先に席を用意しておくことで、モックどおり「佐藤 美咲」「高橋 健」が予約の
   * 有無に関わらず同じ位置に出る。未割当と ウォークイン は名簿の後ろに置く。
   */
  const lanes = new Map<string, Placed[]>()
  for (const name of (view === 'staff' ? names.staff : names.equipment).values()) {
    lanes.set(name, [])
  }
  const offGrid: LedgerEntry[] = []
  for (const entry of entries) {
    const placement = entryPlacement({
      startAt: entry.startAt,
      endAt: entry.endAt,
      grid: LEDGER_GRID,
    })
    if (placement === null) {
      offGrid.push(entry)
      continue
    }
    for (const key of laneKeys(entry)) {
      lanes.set(key, [...(lanes.get(key) ?? []), { entry, ...placement }])
    }
  }
  /** 未割当と ウォークイン は名簿の後ろ。空の未割当レーンは出さない。 */
  const unassignedLane = view === 'staff' ? UNASSIGNED_STAFF_LANE : UNASSIGNED_EQUIPMENT_LANE
  const orderedLanes = [
    ...[...lanes.entries()].filter(([lane]) => lane !== unassignedLane && lane !== WALKIN_LANE),
    ...[...lanes.entries()].filter(
      ([lane, placed]) => lane === unassignedLane && placed.length > 0,
    ),
    ...[...lanes.entries()].filter(([lane]) => lane === WALKIN_LANE),
  ]
  const columns = gridColumnLabels(LEDGER_GRID)
  const line = nowLine({ now, date, grid: LEDGER_GRID })
  const selected = entries.find((entry) => entry.id === selectedId)

  const select = (entry: LedgerEntry) => {
    setSelectedId(entry.id)
    setCandidates(undefined)
  }

  /** One occupied cell. `.appt` / `.walk` in the approved mock. */
  const entryCell = (item: Placed) => {
    const { entry } = item
    const walkin = entry.entryType === 'walkin'
    return (
      <td
        key={entry.id}
        className={`min-h-18 border-line border-r border-b p-2 text-left align-top ${
          walkin ? 'bg-walkin-soft' : 'bg-pine-soft font-bold'
        }`}
        style={{ gridColumn: `span ${item.spanColumns}` }}
      >
        <button
          type="button"
          onClick={() => select(entry)}
          aria-pressed={entry.id === selectedId}
          className="flex min-h-11 w-full flex-col items-start gap-0.5 text-left text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span className={walkin ? undefined : 'font-bold'}>{entry.customerName}</span>
          {/*
           * モックのセルは 2 行だけである。工程や警告を足すとセルが伸び、1 画面に
           * 1 日が収まらなくなる。それらは選択したときの右パネルが受け持つ。
           */}
          {!walkin && (
            <span>{[...entry.purposeNames, SOURCE_LABELS[entry.source]].join(' · ')}</span>
          )}
          {entry.customerId === null && walkin && <span>顧客未登録</span>}
        </button>
      </td>
    )
  }

  /** A lane row, laid out column by column so gaps stay real empty cells. */
  const laneRow = (label: string, row: Placed[], showLabel: boolean, key: string) => {
    const cells: React.ReactNode[] = []
    let column = 1
    for (const item of row) {
      while (column < item.startColumn) {
        cells.push(
          <td
            key={`gap-${column}`}
            className="min-h-18 border-line border-r border-b bg-surface p-2"
          />,
        )
        column += 1
      }
      cells.push(entryCell(item))
      column += item.spanColumns
    }
    while (column <= columns.length) {
      cells.push(
        <td
          key={`tail-${column}`}
          className="min-h-18 border-line border-r border-b bg-surface p-2"
        />,
      )
      column += 1
    }
    return (
      <tr key={key} className="contents">
        <th
          scope="row"
          className="sticky left-0 z-20 min-h-18 border-line border-r border-b bg-surface p-2 text-left align-top font-normal font-sans"
        >
          {showLabel ? label : ''}
        </th>
        {cells}
      </tr>
    )
  }

  return (
    <main className="min-h-dvh bg-paper p-4">
      <h1 className="sr-only">{`${storeName}の予約台帳`}</h1>

      {loadFailed && (
        <div className="pb-3">
          <Notice tone="danger">
            台帳を読み込めませんでした。通信を確認してもう一度お試しください。
          </Notice>
        </div>
      )}

      {conflict && (
        <ConflictPanel
          currentVersion={conflict.currentVersion}
          input={conflict.attempt.describe}
          onDiscard={() => setConflict(undefined)}
          onReapply={() => {
            void run(conflict.attempt, conflict.currentVersion)
          }}
        />
      )}

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-1">
          {/*
           * 軸は 7 列しかないので iPad の幅に収まる。横スクロールは置かない——
           * スクロールさせた時点で「1 日が 1 画面」という主題が失われる。
           */}
          <div>
            <div className="relative w-full">
              <table
                aria-label="予約台帳"
                className="grid w-full border-line border-t border-l text-sm"
                style={{
                  gridTemplateColumns: `${LANE_COLUMN_PX}px repeat(${columns.length}, minmax(138px, 1fr))`,
                }}
              >
                <thead className="contents">
                  <tr className="contents">
                    {/*
                     * モックの見出しセルは「担当者」の一語だけである。設備軸へ
                     * 切り替える口をツールバーとして 1 段足すのではなく、この
                     * セル自身を切り替えボタンにして段を増やさない。
                     */}
                    <th
                      scope="col"
                      className="sticky left-0 z-20 min-h-10 border-line border-r border-b bg-grid-head p-2 text-left font-bold font-sans"
                    >
                      <button
                        type="button"
                        aria-label={
                          view === 'staff'
                            ? '担当者で見る（設備に切り替え）'
                            : '設備で見る（担当者に切り替え）'
                        }
                        aria-pressed={view === 'staff'}
                        onClick={() => setView(view === 'staff' ? 'equipment' : 'staff')}
                        className="text-left text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      >
                        {view === 'staff' ? '担当者' : '設備'}
                      </button>
                    </th>
                    {columns.map((label) => (
                      <th
                        scope="col"
                        key={label}
                        className="min-h-10 border-line border-r border-b bg-grid-head p-2 text-left font-mono font-bold"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="contents">
                  {orderedLanes.flatMap(([lane, placed]) =>
                    packLane(placed).map((row, index) =>
                      laneRow(lane, row, index === 0, `${lane}-${index}`),
                    ),
                  )}
                </tbody>
              </table>
              {line && (
                <div
                  data-now-line
                  className="pointer-events-none absolute top-10 bottom-0 z-10 border-danger"
                  style={{
                    left: `calc(${LANE_COLUMN_PX}px + (100% - ${LANE_COLUMN_PX}px) * ${line.ratio})`,
                    borderLeftWidth: '3px',
                  }}
                >
                  {/* Filled chip, below the header row so neither obscures the other. */}
                  {/* 「現在」は和文なので sans、時刻だけ mono。IBM Plex Mono に
                      和文グリフは無く、mono にすると別書体へ落ちる。 */}
                  <span className="absolute top-2 left-0 whitespace-nowrap bg-danger px-2 py-1 font-bold font-sans text-on-danger text-xs">
                    現在 <span className="font-mono">{line.time}</span>
                  </span>
                </div>
              )}
            </div>
          </div>
          {offGrid.length > 0 && (
            <div className="pt-3">
              <h2 className="text-ink-muted text-sm">営業時間外の受付</h2>
              <div className="flex flex-wrap gap-2">
                {offGrid.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    aria-pressed={entry.id === selectedId}
                    onClick={() => select(entry)}
                    className="flex min-h-11 flex-col items-start gap-0.5 rounded-ctl border border-line bg-surface p-2 text-left text-ink text-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <span>{entry.customerName}</span>
                    <span>{SOURCE_LABELS[entry.source]}</span>
                    {entry.customerId === null && entry.entryType === 'walkin' && (
                      <span>顧客未登録</span>
                    )}
                    {entry.progress !== null && <span>{PROGRESS_LABELS[entry.progress]}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {selected && (
          <section aria-label="選択中の予約" className="w-80 shrink-0">
            <Card className="space-y-3">
              <div>
                <h2 className="font-display font-semibold text-ink text-xl">
                  {selected.customerName}
                </h2>
                <p className="font-mono text-ink-muted text-sm">{timeRange(selected)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Chip>{SOURCE_LABELS[selected.source]}</Chip>
                <Chip>
                  {selected.entryType === 'reservation'
                    ? RESERVATION_STATUS_LABELS[selected.status]
                    : selected.status === 'active'
                      ? '来店中'
                      : '退店'}
                </Chip>
                {selected.progress !== null && <Chip>{PROGRESS_LABELS[selected.progress]}</Chip>}
              </div>
              {selected.nextGuidance && <p className="text-ink text-sm">{selected.nextGuidance}</p>}
              {selected.warnings.map((warning) => (
                <Notice key={warning.code} tone="danger">
                  {warning.message}
                </Notice>
              ))}

              {selected.entryType === 'walkin' && (
                <div className="space-y-3 border-line border-t pt-3">
                  <Button
                    variant="ghost"
                    className="min-h-11 w-full"
                    onClick={() => {
                      void run(
                        {
                          describe: '退店として記録',
                          send: (version) =>
                            patch(`/api/staff/stores/${storeId}/walkins/${selected.id}/progress`, {
                              version,
                              progress: 'departed',
                            }),
                        },
                        selected.version,
                      )
                    }}
                  >
                    退店として記録する
                  </Button>

                  {selected.customerId === null && (
                    <div className="space-y-3">
                      <Field label="氏名で顧客を探す" htmlFor="walkin-search-name">
                        <TextInput
                          id="walkin-search-name"
                          value={searchName}
                          onChange={(event) => setSearchName(event.target.value)}
                        />
                      </Field>
                      <Button
                        variant="ghost"
                        className="min-h-11 w-full"
                        onClick={() => {
                          void (async () => {
                            const response = await api(
                              `/api/staff/stores/${storeId}/customers?name=${encodeURIComponent(searchName)}`,
                            )
                            if (!response.ok) {
                              setLoadFailed(true)
                              return
                            }
                            const parsed = CustomerCandidate.array().safeParse(
                              await response.json(),
                            )
                            setCandidates(parsed.success ? parsed.data : [])
                          })()
                        }}
                      >
                        顧客を検索する
                      </Button>
                      {candidates?.length === 0 && (
                        <p className="text-ink-muted text-sm">
                          該当する顧客が見つかりません。新規顧客として登録してください。
                        </p>
                      )}
                      {candidates?.map((candidate) => (
                        <Button
                          key={candidate.id}
                          variant="ghost"
                          className="min-h-11 w-full"
                          onClick={() => {
                            void run(
                              {
                                describe: `顧客「${candidate.name}」と関連付け`,
                                send: (version) =>
                                  patch(
                                    `/api/staff/stores/${storeId}/walkins/${selected.id}/customer`,
                                    { version, customerId: candidate.id },
                                  ),
                              },
                              selected.version,
                            )
                          }}
                        >
                          {`${candidate.name} · ${candidate.phone}`}
                        </Button>
                      ))}
                      <Field label="お名前" htmlFor="walkin-new-name">
                        <TextInput
                          id="walkin-new-name"
                          value={newCustomer.name}
                          onChange={(event) =>
                            setNewCustomer({ ...newCustomer, name: event.target.value })
                          }
                        />
                      </Field>
                      <Field label="フリガナ" htmlFor="walkin-new-kana">
                        <TextInput
                          id="walkin-new-kana"
                          value={newCustomer.kana}
                          onChange={(event) =>
                            setNewCustomer({ ...newCustomer, kana: event.target.value })
                          }
                        />
                      </Field>
                      <Field label="電話番号" htmlFor="walkin-new-phone">
                        <TextInput
                          id="walkin-new-phone"
                          value={newCustomer.phone}
                          onChange={(event) =>
                            setNewCustomer({ ...newCustomer, phone: event.target.value })
                          }
                        />
                      </Field>
                      <Button
                        className="min-h-11 w-full"
                        onClick={() => {
                          const customer = {
                            name: newCustomer.name,
                            kana: newCustomer.kana,
                            phone: newCustomer.phone,
                          }
                          void run(
                            {
                              describe: `新規顧客「${customer.name}」を登録して関連付け`,
                              send: (version) =>
                                patch(
                                  `/api/staff/stores/${storeId}/walkins/${selected.id}/customer`,
                                  { version, customer },
                                ),
                            },
                            selected.version,
                          )
                        }}
                      >
                        新規顧客として登録して関連付ける
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </section>
        )}
      </div>
    </main>
  )
}

/**
 * EX-CONFLICT: the two-column comparison the approved mock specifies. The
 * operator is shown what is now stored beside what this terminal was trying to
 * record, and chooses between them — never a bare notice (AC-EYEX-110).
 */
export function ConflictPanel({
  currentVersion,
  input,
  onDiscard,
  onReapply,
}: {
  currentVersion: number
  input: string
  onDiscard: () => void
  onReapply: () => void
}) {
  return (
    <section
      aria-label="別の端末で先に更新されています"
      className="mb-3 rounded-card border border-line bg-surface p-3.5"
    >
      <h2 className="font-display font-semibold text-ink text-xl">
        別の端末で先に更新されています
      </h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-ctl border border-line bg-surface p-3.5">
          <p className="font-bold text-ink">最新の内容</p>
          <p className="text-ink text-sm">{`この画面は最新の状態に更新済みです（版 ${currentVersion}）。`}</p>
        </div>
        <div className="rounded-ctl border border-danger-line bg-danger-soft p-3.5">
          <p className="font-bold text-ink">この端末の入力</p>
          <p className="text-ink text-sm">{input}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="danger" className="min-h-11" onClick={onDiscard}>
          この入力を破棄
        </Button>
        <Button className="min-h-11" onClick={onReapply}>
          最新内容へ再適用
        </Button>
      </div>
    </section>
  )
}
