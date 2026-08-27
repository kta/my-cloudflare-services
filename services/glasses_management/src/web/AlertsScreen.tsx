import {
  type AlertCode,
  type AlertCondition,
  type AlertKind,
  AlertRecord,
  AlertSettings,
  type AlertSettingsInput,
  type StorePermission,
} from '@app/contracts'
import { Button, Card, Chip, Field, Notice, Select, TextInput } from '@app/ui'
import { useEffect, useState } from 'react'
import { EmptyResult, PermissionDenied } from './admin-chrome'
import {
  alertConditionLabel,
  alertKindLabel,
  alertReadLabel,
  alertResolutionLabel,
  formatJstDateTime,
} from './analytics-view'
import type { StaffScreenProps } from './staff-screen'

type Props = StaffScreenProps & {
  permissions: StorePermission[]
  /** JST `YYYY-MM-DD`, injected: a screen never reads the clock itself. */
  today: string
  /** Injected instant, for the same reason. */
  now: string
}

type StatusFilter = 'all' | 'unread' | 'unresolved'

const KIND_OPTIONS: { value: 'all' | AlertKind; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'notice', label: 'お知らせのみ' },
  { value: 'alert', label: 'アラートのみ' },
]

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'unread', label: '未読のみ' },
  { value: 'unresolved', label: '未対応のみ' },
]

const LIST_FAILURE =
  'お知らせとアラートを読み込めませんでした。通信を確認してもう一度お試しください。'
const SETTINGS_FAILURE = '警告条件を保存できませんでした。もう一度お試しください。'

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function parseTargets(raw: string): string[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

/**
 * お知らせ・アラートの受信箱と警告条件 (UC-EYEX-178, 179 / AC-EYEX-120).
 *
 * 既読と対応済みはこの画面でも最後まで別の状態として扱う。片方を押したときに
 * もう片方を一緒に進めると、「誰も見ていないのに対応済み」「読んだだけで完了」
 * のどちらかが必ず起きる。
 */
export function AlertsScreen({ storeId, api, permissions, navigate }: Props) {
  const mayRead = permissions.includes('reservation.read')
  const mayWrite = permissions.includes('reservation.write')
  const mayManage = permissions.includes('settings.manage')

  const [kind, setKind] = useState<'all' | AlertKind>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [alerts, setAlerts] = useState<AlertRecord[]>()
  const [listFailed, setListFailed] = useState(false)
  const [selected, setSelected] = useState<AlertRecord>()
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string>()
  const [actionFailure, setActionFailure] = useState<string>()

  const [conditions, setConditions] = useState<AlertCondition[]>()
  const [targets, setTargets] = useState('')
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [settingsFailure, setSettingsFailure] = useState<string>()

  const base = `/api/staff/stores/${encodeURIComponent(storeId)}`

  useEffect(() => {
    if (!mayRead) return undefined
    let active = true
    setAlerts(undefined)
    setListFailed(false)
    void (async () => {
      const query = new URLSearchParams()
      if (kind !== 'all') query.set('kind', kind)
      if (status !== 'all') query.set('status', status)
      const suffix = query.size === 0 ? '' : `?${query.toString()}`
      try {
        const response = await api(`${base}/alerts${suffix}`)
        const parsed = response.ok
          ? AlertRecord.array().safeParse(await readJson(response))
          : undefined
        if (!active) return
        if (parsed?.success) setAlerts(parsed.data)
        else setListFailed(true)
      } catch {
        if (active) setListFailed(true)
      }
    })()
    return () => {
      active = false
    }
  }, [api, base, kind, status, mayRead])

  useEffect(() => {
    if (!mayManage) return undefined
    let active = true
    void (async () => {
      const response = await api(`${base}/alert-settings`)
      const parsed = response.ok ? AlertSettings.safeParse(await readJson(response)) : undefined
      if (!active || !parsed?.success) return
      setConditions(parsed.data.conditions)
      setTargets(parsed.data.notificationTargets.join(', '))
    })()
    return () => {
      active = false
    }
  }, [api, base, mayManage])

  const open = async (record: AlertRecord) => {
    setNote('')
    setNoteError(undefined)
    setActionFailure(undefined)
    setSelected(record)
    // 一覧は古くなりうるので、詳細は必ずサーバの最新状態で開く。
    const response = await api(`${base}/alerts/${encodeURIComponent(record.id)}`)
    const parsed = response.ok ? AlertRecord.safeParse(await readJson(response)) : undefined
    if (parsed?.success) setSelected(parsed.data)
  }

  const applyUpdate = (updated: AlertRecord) => {
    setSelected(updated)
    setAlerts((current) => current?.map((row) => (row.id === updated.id ? updated : row)))
  }

  const acknowledge = async (path: 'read' | 'resolve') => {
    if (!selected) return
    if (path === 'resolve' && note.trim().length === 0) {
      setNoteError('対応内容を入力してください。')
      return
    }
    setNoteError(undefined)
    setActionFailure(undefined)
    const response = await api(`${base}/alerts/${encodeURIComponent(selected.id)}/${path}`, {
      method: 'POST',
      ...(path === 'resolve'
        ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ note: note.trim() }),
          }
        : {}),
    })
    const parsed = response.ok ? AlertRecord.safeParse(await readJson(response)) : undefined
    if (!parsed?.success) {
      setActionFailure('記録できませんでした。もう一度お試しください。')
      return
    }
    applyUpdate(parsed.data)
  }

  const saveConditions = async () => {
    if (!conditions) return
    setSettingsSaved(false)
    setSettingsFailure(undefined)
    const input: AlertSettingsInput = {
      conditions,
      notificationTargets: parseTargets(targets),
    }
    const response = await api(`${base}/alert-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    const parsed = response.ok ? AlertSettings.safeParse(await readJson(response)) : undefined
    if (!parsed?.success) {
      setSettingsFailure(SETTINGS_FAILURE)
      return
    }
    setConditions(parsed.data.conditions)
    setTargets(parsed.data.notificationTargets.join(', '))
    setSettingsSaved(true)
  }

  const updateCondition = (code: AlertCode, patch: Partial<AlertCondition>) => {
    setConditions((current) =>
      current?.map((condition) =>
        condition.code === code ? { ...condition, ...patch } : condition,
      ),
    )
  }

  // 権限が無い操作者には、通知の存在も内容もこれ以上見せない
  // (`exception-states-approved.html#permission-denied`)。
  if (!mayRead) return <PermissionDenied onReturnHome={() => navigate({ screen: 'home' })} />

  const longWait = conditions?.find((condition) => condition.code === 'long_wait')

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
      <h1 className="font-display font-semibold text-2xl text-ink">お知らせとアラート</h1>

      <Card className="grid gap-4 md:grid-cols-2">
        <Field label="種別" htmlFor="alert-kind">
          <Select
            id="alert-kind"
            className="min-h-12"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as 'all' | AlertKind)
            }}
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="状態" htmlFor="alert-status">
          <Select
            id="alert-status"
            className="min-h-12"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as StatusFilter)
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      {listFailed && <Notice tone="danger">{LIST_FAILURE}</Notice>}

      {alerts && alerts.length === 0 && (
        <EmptyResult
          title="条件に一致するお知らせ・アラートはありません"
          onClearFilters={() => {
            setKind('all')
            setStatus('all')
          }}
        />
      )}

      {alerts && alerts.length > 0 && (
        <Card>
          <ul className="flex flex-col gap-2">
            {alerts.map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  className="flex min-h-12 w-full flex-col gap-1 rounded-ctl border border-line bg-surface p-3 text-left hover:bg-pine/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pine focus-visible:outline-offset-2"
                  onClick={() => {
                    void open(record)
                  }}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <Chip tone={record.kind === 'alert' ? 'warning' : 'neutral'}>
                      {alertKindLabel(record.kind)}
                    </Chip>
                    <span className="font-sans font-medium text-ink text-sm">{record.title}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-3 font-sans text-ink-muted text-sm">
                    <span>{formatJstDateTime(record.occurredAt)}</span>
                    <span>{alertReadLabel(record)}</span>
                    <span>{alertResolutionLabel(record)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {selected && (
        // `@app/ui` の Dialog はネイティブ <dialog> を使うため jsdom で開けない。
        // 他画面と同じく role="dialog" のインラインオーバーレイで組む。
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-ink/40 p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={selected.title}
            className="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-ctl border border-line bg-surface p-6"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={selected.kind === 'alert' ? 'warning' : 'neutral'}>
                {alertKindLabel(selected.kind)}
              </Chip>
              <h2 className="font-display font-semibold text-ink text-xl">{selected.title}</h2>
            </div>

            <dl className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <dt className="font-sans font-medium text-ink-muted text-sm">発生理由</dt>
                <dd className="font-sans text-ink text-sm">{selected.reason}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="font-sans font-medium text-ink-muted text-sm">対象</dt>
                <dd className="font-sans text-ink text-sm">{selected.subject}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="font-sans font-medium text-ink-muted text-sm">発生時刻</dt>
                <dd className="font-sans text-ink text-sm tabular-nums">
                  {formatJstDateTime(selected.occurredAt)}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="font-sans font-medium text-ink-muted text-sm">次の操作</dt>
                <dd className="font-sans text-ink text-sm">{selected.nextAction}</dd>
              </div>
            </dl>

            {/* 既読と対応済みは並べて出す。片方から他方を推測させない。 */}
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-2 font-sans text-ink text-sm">
                閲覧状況
                <Chip tone={selected.readAt === null ? 'neutral' : 'success'}>
                  {alertReadLabel(selected)}
                </Chip>
              </span>
              <span className="flex items-center gap-2 font-sans text-ink text-sm">
                対応状況
                <Chip tone={selected.resolvedAt === null ? 'warning' : 'success'}>
                  {alertResolutionLabel(selected)}
                </Chip>
              </span>
            </div>

            {selected.resolutionNote && (
              <p className="font-sans text-ink-muted text-sm">{selected.resolutionNote}</p>
            )}
            {actionFailure && <Notice tone="danger">{actionFailure}</Notice>}

            {mayWrite && (
              <>
                <Field label="対応内容" htmlFor="alert-note" error={noteError}>
                  <TextInput
                    id="alert-note"
                    className="min-h-12"
                    value={note}
                    onChange={(event) => {
                      setNote(event.target.value)
                    }}
                  />
                </Field>
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-12"
                    disabled={selected.readAt !== null}
                    onClick={() => {
                      void acknowledge('read')
                    }}
                  >
                    既読にする
                  </Button>
                  <Button
                    type="button"
                    className="min-h-12"
                    disabled={selected.resolvedAt !== null}
                    onClick={() => {
                      void acknowledge('resolve')
                    }}
                  >
                    対応済みにする
                  </Button>
                </div>
              </>
            )}

            <div>
              <Button
                type="button"
                variant="ghost"
                className="min-h-12"
                onClick={() => {
                  setSelected(undefined)
                }}
              >
                閉じる
              </Button>
            </div>
          </div>
        </div>
      )}

      {mayManage && conditions && (
        <Card>
          <section aria-label="警告条件と通知先" className="flex flex-col gap-4">
            <h2 className="font-display font-semibold text-ink text-lg">警告条件と通知先</h2>
            {settingsSaved && <Notice tone="success">警告条件を保存しました。</Notice>}
            {settingsFailure && <Notice tone="danger">{settingsFailure}</Notice>}
            <ul className="flex flex-col gap-3">
              {conditions.map((condition) => (
                <li key={condition.code} className="flex items-center gap-3">
                  <input
                    id={`alert-condition-${condition.code}`}
                    type="checkbox"
                    className="size-6"
                    checked={condition.enabled}
                    onChange={(event) => {
                      updateCondition(condition.code, { enabled: event.target.checked })
                    }}
                  />
                  <label
                    htmlFor={`alert-condition-${condition.code}`}
                    className="font-sans text-ink text-sm"
                  >
                    {alertConditionLabel(condition.code)}
                  </label>
                </li>
              ))}
            </ul>
            {longWait && (
              <Field label="待ち時間の閾値（分）" htmlFor="alert-threshold">
                <TextInput
                  id="alert-threshold"
                  type="number"
                  min={1}
                  max={600}
                  className="min-h-12"
                  value={String(longWait.thresholdMinutes ?? '')}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10)
                    updateCondition('long_wait', {
                      thresholdMinutes: Number.isNaN(parsed) ? null : parsed,
                    })
                  }}
                />
              </Field>
            )}
            <Field label="通知先メールアドレス" htmlFor="alert-targets">
              <TextInput
                id="alert-targets"
                className="min-h-12"
                value={targets}
                onChange={(event) => {
                  setTargets(event.target.value)
                }}
              />
            </Field>
            <div>
              <Button
                type="button"
                className="min-h-12"
                onClick={() => {
                  void saveConditions()
                }}
              >
                警告条件を保存する
              </Button>
            </div>
          </section>
        </Card>
      )}
    </main>
  )
}
