import { Recording, RecordingRetentionSettings, type StorePermission } from '@app/contracts'
import { Button, Card, Chip, Field, Notice, Textarea, TextInput } from '@app/ui'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { AdminCard, AdminCardGrid, AdminRow, AdminScreen, PermissionDenied } from './admin-chrome'
import { ReauthPrompt } from './ReauthPrompt'
import {
  canRetryRecording,
  formatRecordingDuration,
  formatRecordingInstant,
  MINIMUM_CONFIRMED_RETENTION_DAYS,
  MINIMUM_DISCARDED_RETENTION_HOURS,
  minimumRetentionSummary,
  RECORDING_OPS_FILTERS,
  RECORDING_STATE_LABEL,
  recordingLabel,
  recordingStateTone,
  retentionLabel,
} from './recording'
import type { StaffScreenProps } from './staff-screen'

export type RecordingOpsScreenProps = StaffScreenProps & {
  /** 注入された時刻。保持期限の残りはこの値からだけ導く。 */
  now: string
  permissions: StorePermission[]
  organizationId: string
  /** 完全共有 iPad で開いているときだけ端末 id。保全・解除に個人再認証が要る。 */
  terminalId: string | null
}

const TOUCH = 'min-h-12'

/** 保全・解除は共有端末では個人再認証を挟む (AC-EYEX-101)。 */
type PendingAction = { kind: 'hold' | 'release'; recording: Recording }

function errorBody(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * 録音運用 (RECORDING-OPS)。保存中・失敗・保全中・削除予定・削除済みを区別し、
 * 失敗だけを再試行できる (UC-EYEX-154, AC-EYEX-100)。再生はストリーミングのみで、
 * この画面のどこにもダウンロード操作を置かない (UC-EYEX-129, AC-EYEX-79)。
 */
export function RecordingOpsScreen({
  storeId,
  storeName,
  api,
  now,
  permissions,
  organizationId,
  terminalId,
  navigate,
}: RecordingOpsScreenProps) {
  const mayRead = permissions.includes('recording.read')
  const mayManage = permissions.includes('recording.manage')

  const [filter, setFilter] = useState<string | null>(null)
  const [rows, setRows] = useState<Recording[]>([])
  const [selected, setSelected] = useState<Recording | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirmedDays, setConfirmedDays] = useState('')
  const [discardedHours, setDiscardedHours] = useState('')
  const [retentionFailure, setRetentionFailure] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [reauthFor, setReauthFor] = useState<PendingAction | null>(null)
  const [reauthToken, setReauthToken] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [position, setPosition] = useState(0)

  const base = `/api/staff/stores/${encodeURIComponent(storeId)}`

  const load = useCallback(async () => {
    const query = filter ? `?state=${filter}` : ''
    const response = await api(`${base}/recordings${query}`)
    if (!response.ok) {
      setFailure('録音一覧を取得できませんでした。')
      return
    }
    const parsed = Recording.array().safeParse(await response.json())
    if (!parsed.success) {
      setFailure('録音一覧を取得できませんでした。')
      return
    }
    setRows(parsed.data)
  }, [api, base, filter])

  useEffect(() => {
    if (!mayRead) return
    void load()
  }, [load, mayRead])

  useEffect(() => {
    if (!mayManage) return
    void (async () => {
      const response = await api(`${base}/recording-retention`)
      if (!response.ok) return
      const parsed = RecordingRetentionSettings.safeParse(await response.json())
      if (!parsed.success) return
      setConfirmedDays(String(parsed.data.confirmedRetentionDays))
      setDiscardedHours(String(parsed.data.discardedRetentionHours))
    })()
  }, [api, base, mayManage])

  // 権限が無い操作者には、設定の存在も内容もこれ以上見せない
  // (`exception-states-approved.html#permission-denied`)。
  if (!mayRead) return <PermissionDenied onReturnHome={() => navigate({ screen: 'home' })} />

  const retry = async (recording: Recording) => {
    setFailure(null)
    const response = await api(`${base}/recordings/${recording.id}/retry`, { method: 'POST' })
    if (!response.ok) {
      setFailure('再試行を開始できませんでした。')
      return
    }
    await load()
  }

  const remove = async (recording: Recording) => {
    setFailure(null)
    const response = await api(`${base}/recordings/${recording.id}`, { method: 'DELETE' })
    if (response.ok) {
      await load()
      return
    }
    const body = errorBody(await response.json())
    const error = text(body.error)
    if (error === 'retention_active') {
      const minimum = text(body.minimumRetentionUntil)
      setFailure(
        `保持期間中のため削除できません。最低保持期限は${
          minimum ? ` ${formatRecordingInstant(minimum)}` : '設定値'
        } です。`,
      )
      return
    }
    if (error === 'recording_held') {
      setFailure(
        `保全中の録音は削除できません。保全理由: ${text(body.holdReason) ?? '記録されています'}`,
      )
      return
    }
    setFailure('録音を削除できませんでした。')
  }

  const openAction = (kind: PendingAction['kind'], recording: Recording) => {
    setReason('')
    setReasonError(null)
    setFailure(null)
    const action = { kind, recording }
    // 完全共有端末では、保全・解除の前に個人を特定する (AC-EYEX-101)。
    if (terminalId && !reauthToken) {
      setReauthFor(action)
      return
    }
    setPending(action)
  }

  const submitAction = async () => {
    if (!pending) return
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      setReasonError(
        pending.kind === 'hold'
          ? '保全の理由を入力してください。'
          : '解除の理由を入力してください。',
      )
      return
    }
    const path =
      pending.kind === 'hold'
        ? `${base}/recordings/${pending.recording.id}/hold`
        : `${base}/recordings/${pending.recording.id}/hold/release`
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (reauthToken) headers['x-shared-terminal-reauth-token'] = reauthToken
    const response = await api(path, {
      method: 'POST',
      headers,
      body: JSON.stringify({ version: pending.recording.version, reason: trimmed }),
    })
    if (!response.ok) {
      setReasonError('操作を完了できませんでした。もう一度お試しください。')
      return
    }
    setPending(null)
    setReason('')
    // 付与は 1 回きり。次の管理操作にはもう一度 PIN を求める (UC-EYEX-134)。
    setReauthToken(null)
    await load()
  }

  const saveRetention = async () => {
    setRetentionFailure(null)
    const days = Number(confirmedDays)
    const hours = Number(discardedHours)
    // 最低保証を下回る値は送らず、最低値と理由をその場で返す (AC-EYEX-99)。
    if (!Number.isInteger(days) || days < MINIMUM_CONFIRMED_RETENTION_DAYS) {
      setRetentionFailure(minimumRetentionSummary(true))
      return
    }
    if (!Number.isInteger(hours) || hours < MINIMUM_DISCARDED_RETENTION_HOURS) {
      setRetentionFailure(minimumRetentionSummary(false))
      return
    }
    const response = await api(`${base}/recording-retention`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmedRetentionDays: days, discardedRetentionHours: hours }),
    })
    if (!response.ok) {
      setRetentionFailure('保存期間を更新できませんでした。')
    }
  }

  const failedRows = rows.filter((row) => row.state === 'failed')
  const heldRows = rows.filter((row) => row.state === 'held')

  return (
    /* 承認済みモック `operations-approved.html#recording-ops` /
       `RECORDING-OPS--failure-hold--ipad-landscape.png` の骨格と文言。 */
    <AdminScreen
      label="録音運用"
      navigate={navigate}
      sectionsLabel="録音運用の節"
      activeSection="保存期間"
      sections={[
        { label: '保存期間', to: { screen: 'recording-ops' } },
        { label: '保存・削除状態' },
        { label: '保全一覧' },
      ]}
    >
      <h2 className="font-display font-semibold text-2xl text-ink">録音の保存期間</h2>

      {failure && (
        <div className="mt-3">
          <Notice tone="danger">{failure}</Notice>
        </div>
      )}

      <AdminCardGrid>
        <AdminCard title="成立予約">
          {mayManage ? (
            /* カード見出しが「成立予約」と言っているので、可視ラベルを重ねない。
               名前は aria-label で入力自身に持たせる。 */
            <TextInput
              id="retention-days"
              aria-label="成立予約の保存日数"
              className={TOUCH}
              inputMode="numeric"
              value={confirmedDays}
              onChange={(event) => setConfirmedDays(event.target.value)}
            />
          ) : (
            <span className="block">
              {confirmedDays === '' ? '未取得' : `${confirmedDays}日保存`}
            </span>
          )}
          <small className="mt-1 block font-sans text-ink-muted text-xs">
            {`最低${MINIMUM_CONFIRMED_RETENTION_DAYS}日未満には設定できません`}
          </small>
        </AdminCard>
        <AdminCard title="破棄した受付">
          {mayManage ? (
            <TextInput
              id="retention-hours"
              aria-label="破棄受付の保存時間"
              className={TOUCH}
              inputMode="numeric"
              value={discardedHours}
              onChange={(event) => setDiscardedHours(event.target.value)}
            />
          ) : (
            <span className="block">
              {discardedHours === '' ? '未取得' : `${discardedHours}時間保存`}
            </span>
          )}
          <small className="mt-1 block font-sans text-ink-muted text-xs">
            {`最低${MINIMUM_DISCARDED_RETENTION_HOURS}時間未満には設定できません`}
          </small>
        </AdminCard>
        <AdminCard title="適用元">
          <span className="block">組織共通値</span>
          {mayManage && (
            /* モックの `.card` の既定ボタン。ここは保存操作ではなく「これから
               店舗の値を入れる」導線なので、押しただけで保存を走らせない。 */
            <Button
              className="mt-2 min-h-11"
              onClick={() => {
                document.getElementById('retention-days')?.focus()
              }}
            >
              店舗上書きを設定
            </Button>
          )}
        </AdminCard>
      </AdminCardGrid>

      {mayManage && (
        <div className="mt-3 flex flex-col gap-3">
          {retentionFailure && <Notice tone="danger">{retentionFailure}</Notice>}
          <div>
            <Button
              className={TOUCH}
              onClick={() => {
                void saveRetention()
              }}
            >
              保存期間を更新
            </Button>
          </div>
        </div>
      )}

      <section aria-label="対応が必要" className="mt-4.5">
        <h3 className="font-display font-semibold text-ink text-lg">対応が必要</h3>
        {failedRows.length === 0 && heldRows.length === 0 && (
          <p className="mt-2 font-sans text-ink-muted text-sm">対応が必要な録音はありません。</p>
        )}
        {failedRows.map((recording) => (
          <AdminRow
            key={recording.id}
            tone="error"
            label={`${recordingLabel(recording.id)} 保存失敗`}
          >
            <b className="font-sans font-bold text-ink">{recordingLabel(recording.id)}</b>
            <span className="font-sans text-ink text-sm">保存失敗</span>
            <span className="font-sans text-ink text-sm">
              {recording.reservationId === null ? '予約は成立していません' : '予約は成立済み'}
            </span>
            {mayManage ? (
              <Button
                variant="danger"
                className="min-h-11"
                onClick={() => {
                  void retry(recording)
                }}
              >
                再試行
              </Button>
            ) : (
              <span />
            )}
          </AdminRow>
        ))}
        {heldRows.map((recording) => (
          <AdminRow
            key={recording.id}
            tone="warning"
            label={`${recordingLabel(recording.id)} 保全中`}
          >
            <b className="font-sans font-bold text-ink">{recordingLabel(recording.id)}</b>
            <span className="font-sans text-ink text-sm">保全中</span>
            <span className="font-sans text-ink text-sm">
              {`理由: ${recording.holdReason ?? '記録されています'}`}
            </span>
            <Button
              variant="danger"
              className="min-h-11"
              onClick={() => {
                setPosition(0)
                setSelected(recording)
              }}
            >
              詳細
            </Button>
          </AdminRow>
        ))}
      </section>

      <fieldset className="mt-4.5 flex flex-wrap gap-2 border-0 p-0">
        <legend className="font-sans text-ink-muted text-sm">録音の状態で絞り込む</legend>
        <Button
          variant={filter === null ? 'primary' : 'ghost'}
          aria-pressed={filter === null}
          className={TOUCH}
          onClick={() => setFilter(null)}
        >
          すべて
        </Button>
        {RECORDING_OPS_FILTERS.map((entry) => (
          <Button
            key={entry.state}
            variant={filter === entry.state ? 'primary' : 'ghost'}
            aria-pressed={filter === entry.state}
            className={TOUCH}
            onClick={() => setFilter(entry.state)}
          >
            {entry.label}
          </Button>
        ))}
      </fieldset>

      <ul className="flex flex-col gap-3">
        {rows.map((recording) => (
          <li key={recording.id} data-testid={`recording-${recording.id}`}>
            <Card className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Chip tone={recordingStateTone(recording.state)}>
                  {RECORDING_STATE_LABEL[recording.state]}
                </Chip>
                <span className="font-sans text-ink text-sm">
                  {formatRecordingInstant(recording.startedAt)}
                </span>
                <span className="font-sans text-ink text-sm">録音者 {recording.recorderId}</span>
                <span className="font-sans text-ink text-sm">
                  {formatRecordingDuration(recording.durationSeconds)}
                </span>
                <span className="font-sans text-ink-muted text-sm">
                  {retentionLabel({ retentionUntil: recording.retentionUntil, now })}
                </span>
              </div>
              {recording.holdReason && (
                <p className="font-sans text-ink-muted text-sm">
                  保全理由: {recording.holdReason}
                  {recording.heldBy ? ` · 指定者 ${recording.heldBy}` : ''}
                </p>
              )}
              {recording.failureReason && (
                <p className="font-sans text-danger text-sm">失敗理由: {recording.failureReason}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {recording.state === 'stored' || recording.state === 'held' ? (
                  <Button
                    variant="ghost"
                    className={TOUCH}
                    onClick={() => {
                      setPosition(0)
                      setSelected(recording)
                    }}
                  >
                    再生する
                  </Button>
                ) : null}
                {mayManage && canRetryRecording(recording.state) && (
                  <Button
                    className={TOUCH}
                    onClick={() => {
                      void retry(recording)
                    }}
                  >
                    再試行
                  </Button>
                )}
                {mayManage && recording.state !== 'held' && recording.state !== 'deleted' && (
                  <Button
                    variant="ghost"
                    className={TOUCH}
                    onClick={() => openAction('hold', recording)}
                  >
                    保全する
                  </Button>
                )}
                {mayManage && recording.state === 'held' && (
                  <Button
                    variant="ghost"
                    className={TOUCH}
                    onClick={() => openAction('release', recording)}
                  >
                    保全を解除する
                  </Button>
                )}
                {mayManage && recording.state !== 'deleted' && (
                  <Button
                    variant="danger"
                    className={TOUCH}
                    onClick={() => {
                      void remove(recording)
                    }}
                  >
                    削除する
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {selected && (
        <section
          aria-label="録音の再生"
          className="flex flex-col gap-3 rounded-ctl border border-line bg-surface p-5"
        >
          <h3 className="font-display font-semibold text-lg text-ink">録音の再生</h3>
          <dl className="grid grid-cols-3 gap-3 font-sans text-ink text-sm">
            <div>
              <dt className="text-ink-muted">録音日時</dt>
              <dd>{formatRecordingInstant(selected.startedAt)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">録音者</dt>
              <dd>{selected.recorderId}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">長さ</dt>
              <dd>{formatRecordingDuration(selected.durationSeconds)}</dd>
            </div>
          </dl>
          {/* biome-ignore lint/a11y/useMediaCaption: staff-only audio evidence has no caption track. */}
          <audio
            ref={audioRef}
            src={`${base}/recordings/${selected.id}/audio`}
            preload="none"
            controlsList="nodownload"
          />
          <div className="flex flex-wrap items-center gap-3">
            {/* 承認済みモックの `.audio` — 44px の pine の丸。中の ▶ は装飾で、
                名前は `再生` という文字が運ぶ。 */}
            <Button
              className="size-11 rounded-circle p-0"
              onClick={() => {
                void audioRef.current?.play?.()
              }}
            >
              <span aria-hidden="true">▶</span>
              <span className="sr-only">再生</span>
            </Button>
            <Button
              variant="ghost"
              className={TOUCH}
              onClick={() => {
                audioRef.current?.pause?.()
              }}
            >
              一時停止
            </Button>
            <input
              type="range"
              aria-label="再生位置"
              min={0}
              max={selected.durationSeconds}
              value={position}
              className={`${TOUCH} w-full`}
              onChange={(event) => {
                const next = Number(event.target.value)
                setPosition(next)
                if (audioRef.current) audioRef.current.currentTime = next
              }}
            />
          </div>
          <p className="font-sans text-ink-muted text-sm">
            再生操作は監査記録に残ります。音声の保存や持ち出しはできません。
          </p>
        </section>
      )}

      {reauthFor && terminalId && (
        <ReauthPrompt
          storeId={storeId}
          storeName={storeName}
          api={api}
          navigate={navigate}
          now={now}
          terminalId={terminalId}
          organizationId={organizationId}
          actionLabel={reauthFor.kind === 'hold' ? '録音の保全' : '録音の保全解除'}
          onGranted={(token) => {
            setReauthToken(token)
            setPending(reauthFor)
            setReauthFor(null)
          }}
          onCancelled={() => setReauthFor(null)}
        />
      )}

      {pending && (
        <ActionDialog
          title={pending.kind === 'hold' ? '録音を保全する' : '録音の保全を解除する'}
          reasonLabel={pending.kind === 'hold' ? '保全の理由' : '解除の理由'}
          submitLabel={pending.kind === 'hold' ? '保全を実行' : '解除を実行'}
          reason={reason}
          error={reasonError}
          onReasonChange={setReason}
          onCancel={() => setPending(null)}
          onSubmit={() => {
            void submitAction()
          }}
        />
      )}
    </AdminScreen>
  )
}

/**
 * 理由必須の確認ダイアログ。`@app/ui` の `Dialog` は `showModal()` に依存し
 * jsdom で動かないので、他の画面と同じくインラインの `role="dialog"` にする。
 */
function ActionDialog({
  title,
  reasonLabel,
  submitLabel,
  reason,
  error,
  onReasonChange,
  onCancel,
  onSubmit,
}: {
  title: string
  reasonLabel: string
  submitLabel: string
  reason: string
  error: string | null
  onReasonChange: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}): ReactNode {
  const titleId = 'recording-action-title'
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 flex items-center justify-center bg-ink/40 p-6"
    >
      <Card className="flex w-full max-w-xl flex-col gap-4">
        <h3 id={titleId} className="font-display font-semibold text-xl text-ink">
          {title}
        </h3>
        <p className="font-sans text-ink-muted text-sm">
          理由は監査記録に残ります。保全中の録音は期限を過ぎても削除されません。
        </p>
        <Field label={reasonLabel} htmlFor="recording-action-reason" error={error}>
          <Textarea
            id="recording-action-reason"
            className="min-h-24"
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </Field>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" className={TOUCH} onClick={onCancel}>
            キャンセル
          </Button>
          <Button className={TOUCH} onClick={onSubmit}>
            {submitLabel}
          </Button>
        </div>
      </Card>
    </div>
  )
}
