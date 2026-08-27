import { AvailabilityStoreSettings, LedgerEntry, type ReceptionProgress } from '@app/contracts'
import { Button, Card, Chip, Field, Notice, Select, Textarea, TextInput } from '@app/ui'
import { useCallback, useEffect, useState } from 'react'
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

function waitMinutes(entry: LedgerEntry, now: string): number | undefined {
  if (entry.waitStartedAt === null) return undefined
  const elapsed = new Date(now).getTime() - new Date(entry.waitStartedAt).getTime()
  return elapsed < 0 ? 0 : Math.floor(elapsed / 60_000)
}

function conflictVersion(payload: unknown): number | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const version = (payload as Record<string, unknown>).currentVersion
  return typeof version === 'number' ? version : undefined
}

type Attempt = { send: (version: number) => Promise<Response>; describe: string }

export function JourneyScreen({
  storeId,
  storeName,
  api,
  navigate,
  date,
  now,
}: JourneyScreenProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map())
  const [loadFailed, setLoadFailed] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const [conflict, setConflict] = useState<{ attempt: Attempt; currentVersion: number }>()
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
      const latest = conflictVersion(await response.json().catch(() => undefined))
      await load()
      if (latest !== undefined) setConflict({ attempt, currentVersion: latest })
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

  const warned = entries.filter((entry) => entry.warnings.length > 0)
  const handover = entries.find((entry) => entry.nextGuidance !== null)

  const stageIndexOf = (entry: LedgerEntry): number => {
    const index = STAGE_COLUMNS.findIndex((column) => column.key === entry.progress)
    return index < 0 ? 0 : index
  }

  const staffNameOf = (entry: LedgerEntry): string | undefined => {
    if (entry.assignedStaffId === null) return undefined
    return staffNames.get(entry.assignedStaffId) ?? UNKNOWN_NAME
  }

  /** One stage cell. `.stage`, and `.next` on the one to act on. */
  const stageCell = (key: string, next: boolean, children: React.ReactNode) => (
    <td
      key={key}
      data-next={next ? 'true' : undefined}
      className={`min-h-20 rounded-ctl p-2.5 text-left align-top ${
        next ? 'border-2 border-pine bg-pine-soft' : 'border border-line bg-surface'
      }`}
    >
      {children}
    </td>
  )

  const row = (entry: LedgerEntry) => {
    const current = stageIndexOf(entry)
    const started = entry.progress !== null && entry.progress !== 'waiting'
    const minutes = waitMinutes(entry, now)
    const staffName = staffNameOf(entry)
    return (
      <tr key={entry.id} className="contents">
        <th
          scope="row"
          className="min-h-20 rounded-ctl border border-line bg-surface p-2.5 text-left align-top font-normal"
        >
          <button
            type="button"
            aria-pressed={entry.id === selectedId}
            onClick={() => select(entry)}
            className="flex min-h-11 w-full flex-col items-start gap-0.5 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <span className="font-bold text-ink">{entry.customerName}</span>
            {minutes !== undefined && <span className="text-ink-muted">{`待ち${minutes}分`}</span>}
            {entry.entryType === 'walkin' && entry.customerId === null && (
              <span className="text-ink-muted">顧客未登録</span>
            )}
          </button>
        </th>
        {STAGE_COLUMNS.map((column, index) => {
          const key = `${entry.id}-${column.key}`
          if (index < current) {
            return stageCell(
              key,
              false,
              <>
                <span className="block text-ink">{column.done}</span>
                {index === 0 && staffName && <span className="block text-ink">{staffName}</span>}
              </>,
            )
          }
          if (index === current) {
            return stageCell(
              key,
              !started,
              <>
                <span className="block text-ink">{column.current}</span>
                {started && staffName && <span className="block text-ink">{staffName}</span>}
                {!started && <span className="block text-ink">このまま開始可能</span>}
              </>,
            )
          }
          if (index === current + 1 && started && entry.nextGuidance !== null) {
            return stageCell(
              key,
              true,
              <>
                <span className="block text-ink">次にご案内</span>
                <span className="block text-ink">{entry.nextGuidance}</span>
              </>,
            )
          }
          return stageCell(key, false, null)
        })}
      </tr>
    )
  }

  return (
    <main className="min-h-dvh bg-paper p-5">
      <h1 className="sr-only">{`${storeName}の来店受付`}</h1>

      <div className="flex flex-wrap items-center gap-2 pb-3">
        <p className="font-mono text-ink-muted text-sm">{date}</p>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => navigate({ screen: 'ledger', date })}
          >
            予約台帳へ
          </Button>
          <Button
            className="min-h-11"
            onClick={() => {
              void (async () => {
                const response = await api(`/api/staff/stores/${storeId}/walkins`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: '{}',
                })
                if (response.ok) await load()
                else setLoadFailed(true)
              })()
            }}
          >
            ＋ 店頭のお客様を受付
          </Button>
        </div>
      </div>

      {loadFailed && (
        <div className="pb-3">
          <Notice tone="danger">
            来店状況を読み込めませんでした。通信を確認してもう一度お試しください。
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

      {warned.length > 0 && (
        <section aria-label="注意が必要なお客様" className="space-y-2 pb-3">
          {warned.map((entry) => (
            <Card key={entry.id} className="space-y-2">
              <p className="font-medium text-ink text-sm">{entry.customerName}</p>
              <ul className="space-y-1">
                {entry.warnings.map((warning) => (
                  <li key={warning.code} className="flex flex-wrap items-center gap-2">
                    <Chip tone="warning">{WARNING_LABELS[warning.code]}</Chip>
                    <span className="text-ink text-sm">{warning.message}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </section>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-1">
          <h2 className="pb-3 font-display font-bold text-2xl text-ink">接客の進み具合</h2>
          <table
            aria-label="接客の進み具合"
            className="grid gap-2 text-sm"
            style={{ gridTemplateColumns: '190px repeat(4, 1fr)' }}
          >
            <thead className="contents">
              <tr className="contents">
                {['お客様', ...STAGE_COLUMNS.map((column) => column.label)].map((label) => (
                  <th
                    scope="col"
                    key={label}
                    className="min-h-20 rounded-ctl border border-line bg-surface p-2.5 text-left align-top font-bold text-ink"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="contents">{entries.map((entry) => row(entry))}</tbody>
          </table>
          {handover && (
            <section
              aria-label="次の引き継ぎ"
              className="mt-2 rounded-card border border-line bg-surface p-3.5 text-sm"
            >
              <span className="font-bold text-ink">次の引き継ぎ</span>
              <span className="text-ink">{`　${handover.customerName}様 ${handover.nextGuidance}`}</span>
            </section>
          )}
        </section>

        {selected && (
          <section aria-label="選択中のお客様" className="w-80 shrink-0">
            <Card className="space-y-3">
              <h2 className="font-display font-semibold text-ink text-xl">
                {selected.customerName}
              </h2>

              {selected.entryType === 'reservation' && (
                <div className="space-y-2 border-line border-b pb-3">
                  <Button
                    className="min-h-11 w-full"
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
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-h-11 w-full"
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
                  </Button>
                  <Field label="取消の理由" htmlFor="journey-cancel-reason">
                    <TextInput
                      id="journey-cancel-reason"
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                    />
                  </Field>
                  <Button
                    variant="danger"
                    className="min-h-11 w-full"
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
                  </Button>
                </div>
              )}

              <Field label="店内工程" htmlFor="journey-stage">
                <Select
                  id="journey-stage"
                  value={stage}
                  onChange={(event) => setStage(event.target.value as ReceptionProgress)}
                >
                  {STAGE_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>

              {selected.entryType === 'reservation' && (
                <>
                  <Field label="担当者ID" htmlFor="journey-staff">
                    <TextInput
                      id="journey-staff"
                      value={staffId}
                      onChange={(event) => setStaffId(event.target.value)}
                    />
                  </Field>
                  <Field label="設備ID" htmlFor="journey-equipment">
                    <TextInput
                      id="journey-equipment"
                      value={equipmentId}
                      onChange={(event) => setEquipmentId(event.target.value)}
                    />
                  </Field>
                  <Field label="次のご案内" htmlFor="journey-guidance">
                    <Textarea
                      id="journey-guidance"
                      rows={3}
                      value={guidance}
                      onChange={(event) => setGuidance(event.target.value)}
                    />
                  </Field>
                </>
              )}

              <Button className="min-h-11 w-full" onClick={() => saveStage(selected)}>
                接客の状況を保存する
              </Button>
            </Card>
          </section>
        )}
      </div>
    </main>
  )
}
