import {
  type AlertCode,
  type AlertCondition,
  type AlertKind,
  AlertRecord,
  AlertSettings,
  type AlertSettingsInput,
  type StorePermission,
} from '@app/contracts'
import { useEffect, useState } from 'react'
import {
  alertConditionLabel,
  alertKindLabel,
  alertReadLabel,
  alertResolutionLabel,
  formatJstDateTime,
} from './analytics-view'
import { Action, Actions, FilterGroup, FilterLine } from './design/controls'
import { Modal } from './design/dialogs'
import { CheckToggle, TextField } from './design/forms'
import { FullScreenState } from './design/layouts'
import { FailureNotice, StatusNotice } from './design/notices'
import { Card, ListRow, StatePill } from './design/surfaces'
import type { StaffScreenProps } from './staff-screen'

type Props = StaffScreenProps & {
  permissions: StorePermission[]
  /** JST `YYYY-MM-DD`, injected: a screen never reads the clock itself. */
  today: string
  /** Injected instant, for the same reason. */
  now: string
}

type StatusFilter = 'all' | 'unread' | 'unresolved'

/*
 * 既定の選択肢が絞り込みの名前を兼ねる（モックの `.filter` は「今後の予約」の
 * ように、控えが何の絞り込みかを自分で名乗る）。ラベル行を別に置かない。
 */
const KIND_OPTIONS: { value: 'all' | AlertKind; label: string }[] = [
  { value: 'all', label: 'すべての種別' },
  { value: 'notice', label: 'お知らせのみ' },
  { value: 'alert', label: 'アラートのみ' },
]

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'すべての状態' },
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
  if (!mayRead)
    return (
      <FullScreenState glyph="—" title="この設定を表示する権限がありません">
        <p>権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。</p>
        <Action size="roomy" variant="primary" onClick={() => navigate({ screen: 'home' })}>
          業務開始画面へ戻る
        </Action>
      </FullScreenState>
    )

  const longWait = conditions?.find((condition) => condition.code === 'long_wait')

  const clearFilters = () => {
    setKind('all')
    setStatus('all')
  }

  // 0 件は「空の一覧」ではなく面ごと入れ替わる（承認済みモック `#empty`）。
  if (alerts && alerts.length === 0)
    return (
      <FullScreenState title="条件に一致するお知らせ・アラートはありません">
        <p>検索語またはフィルターを変更してください。履歴自体は削除されていません。</p>
        <Action size="roomy" variant="primary" onClick={clearFilters}>
          フィルターをすべて解除
        </Action>
      </FullScreenState>
    )

  return (
    /* 運用モックの本文（`.content{padding:24px 30px}`）。 */
    <main className="px-7.5 py-6 font-sans">
      <h1>お知らせとアラート</h1>

      <FilterLine>
        <FilterGroup
          label="種別"
          value={kind}
          options={KIND_OPTIONS}
          onChange={(next) => setKind(next as 'all' | AlertKind)}
        />
        <FilterGroup
          label="状態"
          value={status}
          options={STATUS_OPTIONS}
          onChange={(next) => setStatus(next as StatusFilter)}
        />
      </FilterLine>

      {listFailed && <FailureNotice>{LIST_FAILURE}</FailureNotice>}

      {alerts && alerts.length > 0 && (
        <section aria-label="お知らせとアラートの一覧">
          {alerts.map((record) => (
            <ListRow
              key={record.id}
              onSelect={() => {
                void open(record)
              }}
            >
              {/* 種別は色ではなく語で運ぶ。ピルの色はその補強にしか使わない。 */}
              <StatePill tone={record.kind === 'alert' ? 'danger' : 'plain'}>
                {alertKindLabel(record.kind)}
              </StatePill>{' '}
              <b>{record.title}</b>
              <br />
              <small>
                {`${formatJstDateTime(record.occurredAt)} · ${alertReadLabel(record)} · ${alertResolutionLabel(record)}`}
              </small>
            </ListRow>
          ))}
        </section>
      )}

      {selected && (
        <Modal titleId="alert-detail-title" title={selected.title}>
          <StatePill tone={selected.kind === 'alert' ? 'danger' : 'plain'}>
            {alertKindLabel(selected.kind)}
          </StatePill>

          <dl className="mt-3.5">
            <dt className="text-ink-muted">発生理由</dt>
            <dd>{selected.reason}</dd>
            <dt className="mt-2.5 text-ink-muted">対象</dt>
            <dd>{selected.subject}</dd>
            <dt className="mt-2.5 text-ink-muted">発生時刻</dt>
            {/* 和文グリフを持たない等幅にしない。ここは本文書体のまま読ませる。 */}
            <dd>{formatJstDateTime(selected.occurredAt)}</dd>
            <dt className="mt-2.5 text-ink-muted">次の操作</dt>
            <dd>{selected.nextAction}</dd>
          </dl>

          {/* 既読と対応済みは並べて出す。片方から他方を推測させない。 */}
          <p>
            閲覧状況 <StatePill tone="plain">{alertReadLabel(selected)}</StatePill>
            {'　'}
            対応状況{' '}
            <StatePill tone={selected.resolvedAt === null ? 'danger' : 'plain'}>
              {alertResolutionLabel(selected)}
            </StatePill>
          </p>

          {selected.resolutionNote && <p>{selected.resolutionNote}</p>}
          {actionFailure && <FailureNotice>{actionFailure}</FailureNotice>}

          {mayWrite && (
            <>
              <TextField
                id="alert-note"
                value={note}
                onChange={(event) => {
                  setNote(event.target.value)
                }}
                label="対応内容"
                error={noteError}
              />
              <Actions>
                <Action
                  disabled={selected.readAt !== null}
                  onClick={() => {
                    void acknowledge('read')
                  }}
                >
                  既読にする
                </Action>
                <Action
                  variant="primary"
                  disabled={selected.resolvedAt !== null}
                  onClick={() => {
                    void acknowledge('resolve')
                  }}
                >
                  対応済みにする
                </Action>
              </Actions>
            </>
          )}

          <Actions>
            <Action
              onClick={() => {
                setSelected(undefined)
              }}
            >
              閉じる
            </Action>
          </Actions>
        </Modal>
      )}

      {mayManage && conditions && (
        <section aria-label="警告条件と通知先" className="mt-4.5">
          <h2>警告条件と通知先</h2>
          {settingsSaved && <StatusNotice>警告条件を保存しました。</StatusNotice>}
          {settingsFailure && <FailureNotice>{settingsFailure}</FailureNotice>}
          <Card>
            {conditions.map((condition) => (
              <p key={condition.code} className="my-2.5 flex items-center gap-3">
                {/* 印の名前は隣の可視の文言そのもの。button には <label for> が
                    効かないので `aria-labelledby` で結ぶ。 */}
                <CheckToggle
                  labelledBy={`alert-condition-${condition.code}`}
                  checked={condition.enabled}
                  onChange={(enabled) => {
                    updateCondition(condition.code, { enabled })
                  }}
                />
                <span id={`alert-condition-${condition.code}`}>
                  {alertConditionLabel(condition.code)}
                </span>
              </p>
            ))}
            {longWait && (
              <TextField
                id="alert-threshold"
                type="number"
                min={1}
                max={600}
                value={String(longWait.thresholdMinutes ?? '')}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10)
                  updateCondition('long_wait', {
                    thresholdMinutes: Number.isNaN(parsed) ? null : parsed,
                  })
                }}
                label="待ち時間の閾値（分）"
              />
            )}
            <TextField
              id="alert-targets"
              value={targets}
              onChange={(event) => {
                setTargets(event.target.value)
              }}
              label="通知先メールアドレス"
            />
            <Actions>
              <Action
                variant="primary"
                onClick={() => {
                  void saveConditions()
                }}
              >
                警告条件を保存する
              </Action>
            </Actions>
          </Card>
        </section>
      )}
    </main>
  )
}
