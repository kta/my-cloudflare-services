import {
  AvailabilityStoreSettings,
  CustomerCandidate,
  LedgerEntry,
  VersionConflict,
} from '@app/contracts'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Action, Actions } from './design/controls'
import { TextField } from './design/forms'
import { Compare, Panel } from './design/layouts'
import { type LedgerCell, LedgerGrid, type LedgerLane } from './design/ledger'
import { Card, StatePill } from './design/surfaces'
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

/**
 * 409 の本文。承認済みモック `#conflict` の「最新の内容」は版番号ではなく
 * **いま保存されている値** と **誰がいつ更新したか** を並べる。契約
 * `VersionConflict` はその 3 要素をすでに運んでいるので、版番号だけを拾って
 * 捨てない（版番号は操作者の判断材料ではない）。
 */
function parseConflict(payload: unknown): VersionConflict | undefined {
  const parsed = VersionConflict.safeParse(payload)
  return parsed.success ? parsed.data : undefined
}

/** 更新時刻は JST の時計表示。日付はモックどおり出さない（同じ日の話だから）。 */
function formatJstClock(at: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(at))
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

/* 遷移は緑バーが持つので、台帳そのものは `navigate` を使わない。 */
export function LedgerScreen({ storeId, storeName, api, date, now }: LedgerScreenProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [names, setNames] = useState<{
    staff: Map<string, string>
    equipment: Map<string, string>
  }>({ staff: new Map(), equipment: new Map() })
  const [loadFailed, setLoadFailed] = useState(false)
  const [view, setView] = useState<'staff' | 'equipment'>('staff')
  const [selectedId, setSelectedId] = useState<string>()
  const [conflict, setConflict] = useState<{ attempt: Attempt; latest: VersionConflict }>()
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
      const latest = parseConflict(await response.json().catch(() => undefined))
      await load()
      if (latest !== undefined) setConflict({ attempt, latest })
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

  /** 1 コマの中身。モックの `.appt` / `.walk` はここでは `tone` が持つ。 */
  const entryContent = (item: Placed): ReactNode => {
    const { entry } = item
    const walkin = entry.entryType === 'walkin'
    return (
      <button
        type="button"
        onClick={() => select(entry)}
        aria-pressed={entry.id === selectedId}
        className="flex min-h-11 w-full flex-col items-start gap-0.5 text-left text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span>{entry.customerName}</span>
        {/*
         * モックのセルは 2 行だけである。工程や警告を足すとセルが伸び、1 画面に
         * 1 日が収まらなくなる。それらは選択したときの右パネルが受け持つ。
         */}
        {!walkin && <span>{[...entry.purposeNames, SOURCE_LABELS[entry.source]].join(' · ')}</span>}
        {entry.customerId === null && walkin && <span>顧客未登録</span>}
      </button>
    )
  }

  /** 1 段ぶんのコマ。予約の無いところは空きコマとして残す（詰めない）。 */
  const laneCells = (row: Placed[]): LedgerCell[] => {
    const cells: LedgerCell[] = []
    let column = 1
    for (const item of row) {
      while (column < item.startColumn) {
        cells.push({})
        column += 1
      }
      cells.push({
        span: item.spanColumns,
        tone: item.entry.entryType === 'walkin' ? 'walkin' : 'appointment',
        children: entryContent(item),
      })
      column += item.spanColumns
    }
    while (column <= columns.length) {
      cells.push({})
      column += 1
    }
    return cells
  }

  /*
   * 同じ担当者の予約が重なると行が 2 段になる。2 段目の見出しは空にする——
   * モックは同じ名前を繰り返さないし、繰り返すと「別の担当者」に見える。
   */
  const grid: LedgerLane[] = orderedLanes.flatMap(([lane, placed]) =>
    packLane(placed).map((row, index) => ({
      id: `${lane}-${index}`,
      name: lane,
      label: index === 0 ? lane : '',
      cells: laneCells(row),
    })),
  )

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-paper font-sans text-ink">
      <h1 className="sr-only">{`${storeName}の予約台帳`}</h1>

      {loadFailed && (
        /* 読み込み失敗はモックに無い状態。面の語彙のまま、役割だけ足す。 */
        <div role="alert" className="px-4 pt-4">
          <Card tone="error">
            台帳を読み込めませんでした。通信を確認してもう一度お試しください。
          </Card>
        </div>
      )}

      {conflict && (
        <ConflictPanel
          latest={conflict.latest}
          input={conflict.attempt.describe}
          onDiscard={() => setConflict(undefined)}
          onReapply={() => {
            void run(conflict.attempt, conflict.latest.currentVersion)
          }}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-wrap items-start">
        <section className="min-w-0 flex-1">
          {/*
           * 軸は 7 列しかないので iPad の幅に収まる。横スクロールは置かない——
           * スクロールさせた時点で「1 日が 1 画面」という主題が失われる。
           */}
          <LedgerGrid
            columns={columns}
            lanes={grid}
            now={line ? { label: `現在 ${line.time}`, ratio: line.ratio } : undefined}
            heading={
              /*
               * モックの見出しセルは「担当者」の一語だけである。設備軸へ切り替える
               * 口をツールバーとして 1 段足すのではなく、このセル自身を切り替え
               * ボタンにして段を増やさない。
               */
              <button
                type="button"
                aria-label={
                  view === 'staff'
                    ? '担当者で見る（設備に切り替え）'
                    : '設備で見る（担当者に切り替え）'
                }
                aria-pressed={view === 'staff'}
                onClick={() => setView(view === 'staff' ? 'equipment' : 'staff')}
                /*
                 * 見出しセルの中に収まる形のまま、指で押せる大きさを保つ。
                 * 字面はモックの一語だけだが、当たり判定はセル全体に広げる。
                 */
                className="-m-2 flex min-h-11 w-full items-center p-2 text-left text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {view === 'staff' ? '担当者' : '設備'}
              </button>
            }
          />
          {offGrid.length > 0 && (
            <div className="px-4 pb-4">
              <h2 className="text-grid text-ink-muted">営業時間外の受付</h2>
              <div className="flex flex-wrap gap-2">
                {offGrid.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    aria-pressed={entry.id === selectedId}
                    onClick={() => select(entry)}
                    className="flex min-h-11 flex-col items-start gap-0.5 rounded-ctl border border-line bg-surface p-2 text-left text-grid text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
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
          /* 選択中の 1 件。モックの `.detail`（22px の内側）と同じ持ち方。 */
          <section aria-label="選択中の予約" className="w-97.5 shrink-0 p-5.5">
            <Card>
              <b className="block text-lead">{selected.customerName}</b>
              <p className="font-mono text-grid text-ink-muted">{timeRange(selected)}</p>
              <div className="mt-2.5 flex flex-wrap gap-2 text-grid">
                <StatePill>{SOURCE_LABELS[selected.source]}</StatePill>
                <StatePill>
                  {selected.entryType === 'reservation'
                    ? RESERVATION_STATUS_LABELS[selected.status]
                    : selected.status === 'active'
                      ? '来店中'
                      : '退店'}
                </StatePill>
                {selected.progress !== null && (
                  <StatePill>{PROGRESS_LABELS[selected.progress]}</StatePill>
                )}
              </div>
              {selected.nextGuidance && <p className="mt-2.5">{selected.nextGuidance}</p>}
              {selected.warnings.map((warning) => (
                /* 警告は色ではなく文で伝える。淡い赤地は文に添えるだけ。 */
                <div key={warning.code} className="mt-2.5">
                  <Card tone="attention">{warning.message}</Card>
                </div>
              ))}

              {selected.entryType === 'walkin' && (
                <div className="mt-3.5 space-y-3 border-line border-t pt-3.5">
                  <Action
                    className="w-full"
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
                  </Action>

                  {selected.customerId === null && (
                    <div className="space-y-3">
                      <TextField
                        id="walkin-search-name"
                        value={searchName}
                        onChange={(event) => setSearchName(event.target.value)}
                        label="氏名で顧客を探す"
                      />
                      <Action
                        className="w-full"
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
                      </Action>
                      {candidates?.length === 0 && (
                        <p className="text-grid text-ink-muted">
                          該当する顧客が見つかりません。新規顧客として登録してください。
                        </p>
                      )}
                      {candidates?.map((candidate) => (
                        <Action
                          key={candidate.id}
                          className="w-full"
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
                        </Action>
                      ))}
                      <TextField
                        id="walkin-new-name"
                        value={newCustomer.name}
                        onChange={(event) =>
                          setNewCustomer({ ...newCustomer, name: event.target.value })
                        }
                        label="お名前"
                      />
                      <TextField
                        id="walkin-new-kana"
                        value={newCustomer.kana}
                        onChange={(event) =>
                          setNewCustomer({ ...newCustomer, kana: event.target.value })
                        }
                        label="フリガナ"
                      />
                      <TextField
                        id="walkin-new-phone"
                        value={newCustomer.phone}
                        onChange={(event) =>
                          setNewCustomer({ ...newCustomer, phone: event.target.value })
                        }
                        label="電話番号"
                      />
                      <Action
                        variant="primary"
                        className="w-full"
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
                      </Action>
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
  latest,
  input,
  onDiscard,
  onReapply,
}: {
  latest: VersionConflict
  input: string
  onDiscard: () => void
  onReapply: () => void
}) {
  return (
    <section aria-label="別の端末で先に更新されています" className="px-4 pt-4 font-sans">
      <h2>別の端末で先に更新されています</h2>
      <Compare>
        <Panel>
          <b className="block">最新の内容</b>
          {/*
           * モックは「電話番号 …／メモ「…」／更新者: 銀座店 受付iPad 14:31」と、
           * 値そのものと更新者を並べる。版番号は操作者が破棄と再適用を選ぶ
           * 材料にならないので出さない。
           */}
          <p>
            {latest.latest.map((field) => (
              <span key={field.label} className="block">{`${field.label} ${field.value}`}</span>
            ))}
            {latest.updatedBy !== null && (
              <span className="block">
                {`更新者: ${latest.updatedBy}${
                  latest.updatedAt === null ? '' : ` ${formatJstClock(latest.updatedAt)}`
                }`}
              </span>
            )}
          </p>
        </Panel>
        {/*
         * この端末の入力は淡い琥珀。失敗ではなく「まだ確かめていない入力」なので、
         * 失敗の赤にすると保存できなかったのが手元の側だと読めてしまう
         * （モックの `.panel.warn` / `admin-chrome.tsx` の `ConflictCompare` と同じ扱い）。
         */}
        <Panel tone="warning">
          <b className="block">この端末の入力</b>
          <p>{input}</p>
        </Panel>
      </Compare>
      <Actions>
        <Action variant="danger" onClick={onDiscard}>
          この入力を破棄
        </Action>
        <Action variant="primary" onClick={onReapply}>
          最新内容へ再適用
        </Action>
      </Actions>
    </section>
  )
}
