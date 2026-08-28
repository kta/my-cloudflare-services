import {
  AvailabilityStoreSettings,
  LedgerEntry,
  type ReceptionProgress,
  VersionConflict,
} from '@app/contracts'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { barPrimaryAction } from './app-chrome'
import { Action } from './design/controls'
import { PickerField, TextAreaField, TextField } from './design/forms'
import { JourneyBoard, type JourneyCell } from './design/ledger'
import { Card, StatePill } from './design/surfaces'
import { ConflictPanel } from './LedgerScreen'
import type { StaffScreenProps } from './staff-screen'

/**
 * The in-store journey (JOURNEY-DEFAULT): who is here, how far along the
 * service they are, and what happens next (UC-EYEX-051–053).
 *
 * The board is the approved mock's: one row per customer, a 190px identity
 * column and the four service stages beside it. The cell an operator must act
 * on next is the `.next` cell — `pine-soft` behind a 2px `pine` border — but it
 * always says what the action is, because the shop floor reads this from a
 * distance and colour alone would not survive that (AC-EYEX-26).
 */

type JourneyScreenProps = StaffScreenProps & {
  /** JST day being shown, `YYYY-MM-DD`. */
  date: string
  /** Injected current instant; the screen never reads the wall clock. */
  now: string
}

/**
 * The service stages, in the order the approved mock heads them. Each maps to
 * one `ReceptionProgress` so a row's position is derived from stored state and
 * never from anything this screen invents.
 */
const STAGE_COLUMNS: {
  key: ReceptionProgress
  label: string
  done: string
  current: string
}[] = [
  { key: 'waiting', label: '受付・相談', done: '受付済み', current: '相談待ち' },
  { key: 'service_in_progress', label: 'フレーム', done: '相談済み', current: '相談中' },
  { key: 'service_completed', label: '視力測定', done: '測定済み', current: '接客完了' },
  { key: 'departed', label: 'レンズ・調整', done: '完了', current: '退店' },
]

/** The stage select offers the stored states, named as the operator says them. */
const STAGE_OPTIONS: { key: ReceptionProgress; label: string }[] = [
  { key: 'waiting', label: '受付待ち' },
  { key: 'service_in_progress', label: '接客中' },
  { key: 'service_completed', label: '接客完了' },
  { key: 'departed', label: '退店' },
]

const WARNING_LABELS = {
  long_wait: '長時間待機',
  staff_unassigned: '担当不在',
  equipment_unavailable: '設備停止',
} as const

/** The confirmation phrase the cancel endpoint requires, shown on the button. */
const CANCEL_CONFIRMATION = '取り消す'

/** Shown only when the name join has not answered; never a raw id. */
const UNKNOWN_NAME = '名称未取得'

/** JST の壁時計 `10:50`。日本に夏時間は無いので +09:00 の固定加算で足りる。 */
function jstClock(instant: string): string {
  const shifted = new Date(new Date(instant).getTime() + 9 * 60 * 60 * 1000).toISOString()
  // 先頭の 0 は落とす。モックの `9:58` と同じ読み方にする。
  return `${Number(shifted.slice(11, 13))}:${shifted.slice(14, 16)}`
}

function waitMinutes(entry: LedgerEntry, now: string): number | undefined {
  if (entry.waitStartedAt === null) return undefined
  const elapsed = new Date(now).getTime() - new Date(entry.waitStartedAt).getTime()
  return elapsed < 0 ? 0 : Math.floor(elapsed / 60_000)
}

/* 台帳と同じ 409 の読み方。版番号だけを拾って、最新の値と更新者を捨てない。 */
function parseConflict(payload: unknown): VersionConflict | undefined {
  const parsed = VersionConflict.safeParse(payload)
  return parsed.success ? parsed.data : undefined
}

type Attempt = { send: (version: number) => Promise<Response>; describe: string }

export function JourneyScreen({ storeId, storeName, api, date, now }: JourneyScreenProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map())
  const [loadFailed, setLoadFailed] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const [conflict, setConflict] = useState<{ attempt: Attempt; latest: VersionConflict }>()
  const [stage, setStage] = useState<ReceptionProgress>('waiting')
  const [staffId, setStaffId] = useState('')
  const [equipmentId, setEquipmentId] = useState('')
  const [guidance, setGuidance] = useState('')
  const [cancelReason, setCancelReason] = useState('')

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
   * 店頭のお客様の受付は、承認済みモックでは緑バーの主操作である。面の中に
   * もう 1 枚同じボタンを置くと段が増え、同じ操作が 2 か所に見える。行いだけ
   * をバーへ預け、面から出るときに取り下げる。
   */
  const receiveWalkin = useCallback(async () => {
    const response = await api(`/api/staff/stores/${storeId}/walkins`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    if (response.ok) await load()
    else setLoadFailed(true)
  }, [api, load, storeId])

  useEffect(
    () =>
      barPrimaryAction.set(() => {
        void receiveWalkin().catch(() => setLoadFailed(true))
      }),
    [receiveWalkin],
  )

  /* The board names the person handling each stage; an id would tell nobody. */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const response = await api(`/api/staff/stores/${storeId}/availability/settings`)
      if (!response.ok) return
      const parsed = AvailabilityStoreSettings.safeParse(await response.json())
      if (!parsed.success || cancelled) return
      setStaffNames(new Map(parsed.data.staff.map((member) => [member.id, member.name])))
    })().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [api, storeId])

  const selected = entries.find((entry) => entry.id === selectedId)

  const select = (entry: LedgerEntry) => {
    setSelectedId(entry.id)
    setStage(entry.progress ?? 'waiting')
    setStaffId(entry.assignedStaffId ?? '')
    setEquipmentId(entry.assignedEquipmentIds[0] ?? '')
    setGuidance(entry.nextGuidance ?? '')
    setCancelReason('')
  }

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

  const send = (path: string, method: 'PATCH' | 'POST', body: unknown) =>
    api(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  const saveStage = (entry: LedgerEntry) => {
    const label = STAGE_OPTIONS.find((option) => option.key === stage)?.label ?? stage
    const attempt: Attempt =
      entry.entryType === 'walkin'
        ? {
            describe: `店内工程を「${label}」に変更`,
            send: (version) =>
              send(`/api/staff/stores/${storeId}/walkins/${entry.id}/progress`, 'PATCH', {
                version,
                progress: stage,
              }),
          }
        : {
            describe: `店内工程を「${label}」に変更`,
            send: (version) =>
              send(`/api/staff/stores/${storeId}/reservations/${entry.id}/progress`, 'PATCH', {
                version,
                progress: stage,
                assignedStaffId: staffId.trim() === '' ? null : staffId.trim(),
                assignedEquipmentIds: equipmentId.trim() === '' ? [] : [equipmentId.trim()],
                nextGuidance: guidance.trim() === '' ? null : guidance.trim(),
              }),
          }
    void run(attempt, entry.version)
  }

  const handover = entries.find((entry) => entry.nextGuidance !== null)

  const stageIndexOf = (entry: LedgerEntry): number => {
    const index = STAGE_COLUMNS.findIndex((column) => column.key === entry.progress)
    return index < 0 ? 0 : index
  }

  const staffNameOf = (entry: LedgerEntry): string | undefined => {
    if (entry.assignedStaffId === null) return undefined
    return staffNames.get(entry.assignedStaffId) ?? UNKNOWN_NAME
  }

  /*
   * 盤の 1 行。1 列目はお客様の名乗り（工程盤の行見出し）、続く 4 つが工程。
   * 見た目は `design/ledger` の `JourneyBoard` が持つので、ここは「どの工程に
   * 何と書くか」だけを決める。
   */
  const row = (entry: LedgerEntry): JourneyCell[] => {
    const current = stageIndexOf(entry)
    const started = entry.progress !== null && entry.progress !== 'waiting'
    const minutes = waitMinutes(entry, now)
    const staffName = staffNameOf(entry)
    const receivedAt = entry.waitStartedAt === null ? undefined : jstClock(entry.waitStartedAt)
    const identity: JourneyCell = {
      children: (
        <button
          type="button"
          aria-pressed={entry.id === selectedId}
          onClick={() => select(entry)}
          className="flex min-h-11 w-full flex-col items-start gap-0.5 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <b>{entry.customerName}</b>
          {minutes !== undefined && <span>{`待ち${minutes}分`}</span>}
          {entry.entryType === 'walkin' && entry.customerId === null && <span>顧客未登録</span>}
          {/* 注意は色ではなく言葉。理由の全文は選んだときの右パネルが受け持つ。 */}
          {entry.warnings.map((warning) => (
            <StatePill key={warning.code} tone="danger">
              {WARNING_LABELS[warning.code]}
            </StatePill>
          ))}
        </button>
      ),
    }
    const stage = (next: boolean, children?: ReactNode): JourneyCell => ({ next, children })
    return [
      identity,
      ...STAGE_COLUMNS.map((column, index) => {
        if (index < current)
          return stage(
            false,
            <>
              <span className="block">{column.done}</span>
              {/* 受付の工程だけは「いつ・誰が」を並べる（モックの `9:58 山田`）。
                  名前だけだと、さっきのことか 1 時間前のことかが読めない。 */}
              {index === 0 && (receivedAt !== undefined || staffName) && (
                <span className="block">
                  {[receivedAt, staffName].filter((part) => part !== undefined).join(' ')}
                </span>
              )}
            </>,
          )
        if (index === current)
          return stage(
            !started,
            <>
              <span className="block">{column.current}</span>
              {started && staffName && <span className="block">{staffName}</span>}
              {/* 「次にご案内」と同じ強さで、まだ始めていないことを言葉で名乗る。 */}
              {!started && <span className="block">このまま開始可能</span>}
            </>,
          )
        if (index === current + 1 && started && entry.nextGuidance !== null)
          return stage(
            true,
            <>
              <span className="block">次にご案内</span>
              <span className="block">{entry.nextGuidance}</span>
            </>,
          )
        return stage(false)
      }),
    ]
  }

  return (
    /* モックの `main.detail{padding:22px}`。盤はこの内側にそのまま置く。 */
    <main className="min-h-0 flex-1 overflow-auto bg-paper p-5.5 font-sans text-ink">
      <h1 className="sr-only">{`${storeName}の来店受付`}</h1>

      {loadFailed && (
        <div role="alert" className="pb-3">
          <Card tone="error">
            来店状況を読み込めませんでした。通信を確認してもう一度お試しください。
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

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-1">
          {/* モックの本文は見出し 1 行で始まる。日付も行き先もここには置かない
              （日付は緑バーの副題、行き先は左サイドバーが持つ）。 */}
          <h1>接客の進み具合</h1>
          <JourneyBoard
            stages={['お客様', ...STAGE_COLUMNS.map((column) => column.label)]}
            rows={entries.map((entry) => row(entry))}
          />
          {handover && (
            <Card label="次の引き継ぎ" className="mt-2.5">
              <b>次の引き継ぎ</b>
              {`　${handover.customerName}様 ${handover.nextGuidance}`}
            </Card>
          )}
        </section>

        {selected && (
          <section aria-label="選択中のお客様" className="w-80 shrink-0">
            <Card>
              <b className="block text-lead">{selected.customerName}</b>

              {/* 警告は淡い赤地の面。理由は必ず文で添える（色だけでは伝えない）。 */}
              {selected.warnings.map((warning) => (
                <div key={warning.code} className="mt-2.5">
                  <Card tone="attention">{warning.message}</Card>
                </div>
              ))}

              {selected.entryType === 'reservation' && (
                <div className="mt-2.5 space-y-2.5 border-line border-b pb-3.5">
                  <Action
                    variant="primary"
                    className="w-full"
                    onClick={() => {
                      void run(
                        {
                          describe: '来店済みとして記録',
                          send: (version) =>
                            send(
                              `/api/staff/stores/${storeId}/reservations/${selected.id}/progress`,
                              'PATCH',
                              { version, progress: 'waiting' },
                            ),
                        },
                        selected.version,
                      )
                    }}
                  >
                    来店済みとして記録する
                  </Action>
                  <Action
                    className="w-full"
                    onClick={() => {
                      void run(
                        {
                          describe: '無断キャンセルとして記録',
                          send: (version) =>
                            send(
                              `/api/staff/stores/${storeId}/reservations/${selected.id}/no-show`,
                              'POST',
                              { version },
                            ),
                        },
                        selected.version,
                      )
                    }}
                  >
                    無断キャンセルとして記録する
                  </Action>
                  <TextField
                    id="journey-cancel-reason"
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                    label="取消の理由"
                  />
                  <Action
                    variant="danger"
                    className="w-full"
                    disabled={cancelReason.trim() === ''}
                    onClick={() => {
                      void run(
                        {
                          describe: `予約を取り消し（理由: ${cancelReason.trim()}）`,
                          send: (version) =>
                            send(
                              `/api/staff/stores/${storeId}/reservations/${selected.id}/cancel`,
                              'POST',
                              {
                                version,
                                reason: cancelReason.trim(),
                                confirmation: CANCEL_CONFIRMATION,
                              },
                            ),
                        },
                        selected.version,
                      )
                    }}
                  >
                    予約を取り消す
                  </Action>
                </div>
              )}

              <PickerField
                id="journey-stage"
                value={stage}
                options={STAGE_OPTIONS.map((option) => ({
                  value: option.key,
                  label: option.label,
                }))}
                onChange={(next) => setStage(next as ReceptionProgress)}
                label="店内工程"
              />

              {selected.entryType === 'reservation' && (
                <>
                  <TextField
                    id="journey-staff"
                    value={staffId}
                    onChange={(event) => setStaffId(event.target.value)}
                    label="担当者ID"
                  />
                  <TextField
                    id="journey-equipment"
                    value={equipmentId}
                    onChange={(event) => setEquipmentId(event.target.value)}
                    label="設備ID"
                  />
                  <TextAreaField
                    id="journey-guidance"
                    rows={3}
                    value={guidance}
                    onChange={(event) => setGuidance(event.target.value)}
                    label="次のご案内"
                  />
                </>
              )}

              <Action
                variant="primary"
                className="mt-2.5 w-full"
                onClick={() => saveStage(selected)}
              >
                接客の状況を保存する
              </Action>
            </Card>
          </section>
        )}
      </div>
    </main>
  )
}
