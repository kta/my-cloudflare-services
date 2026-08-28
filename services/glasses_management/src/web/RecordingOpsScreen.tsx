import { Recording, RecordingRetentionSettings, type StorePermission } from '@app/contracts'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { PermissionDenied } from './admin-chrome'
import { Action, Actions } from './design/controls'
import { Modal } from './design/dialogs'
import { TextAreaField, TextField, ToggleFilter } from './design/forms'
import { AdminLayout, AdminSurface } from './design/layouts'
import { FailureNotice } from './design/notices'
import { AdminRow, Card, CardGrid, StatePill } from './design/surfaces'
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
  retentionLabel,
} from './recording'
import type { StaffLocation } from './staff-navigation'
import type { StaffScreenProps } from './staff-screen'

/** 節ナビ。モック `operations-approved.html#recording-ops` の 3 つと、その順序。 */
const SECTIONS: { label: string; to?: StaffLocation }[] = [
  { label: '保存期間', to: { screen: 'recording-ops' } },
  { label: '保存・削除状態' },
  { label: '保全一覧' },
]

export type RecordingOpsScreenProps = StaffScreenProps & {
  /** 注入された時刻。保持期限の残りはこの値からだけ導く。 */
  now: string
  permissions: StorePermission[]
  organizationId: string
  /** 完全共有 iPad で開いているときだけ端末 id。保全・解除に個人再認証が要る。 */
  terminalId: string | null
  /** 共有 iPad の名前。個人認証の面がバーで名乗る。 */
  terminalName?: string
}

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
/*
 * 承認済みモック `operations-approved.html#recording-ops` は破棄受付の保存期間を
 * `3日保存` と読む。契約は時間で持つが、隣に並ぶ「成立予約」が `90日保存` なので、
 * 時間のまま出すと同じ段の 2 枚が別の単位になり、どちらが長いかをその場で
 * 比べられない。24 で割り切れないときだけ時間のまま出す——丸めると、実際に
 * 消えるまでの時間を偽ることになる。
 */
function discardedRetentionLabel(hours: string): string {
  const value = Number(hours)
  if (!Number.isInteger(value) || value < 24 || value % 24 !== 0) return `${hours}時間保存`
  return `${value / 24}日保存`
}

export function RecordingOpsScreen({
  storeId,
  storeName,
  api,
  now,
  permissions,
  organizationId,
  terminalId,
  terminalName,
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
  /*
   * 保存期間は読み取りが既定（承認済みモックの `90日保存` / `3日保存`）。編集の欄は
   * 明示の操作の先にだけ出す。欄を常に開いておくと、モックにある「いま何日なのか」
   * という事実が単位のない裸の数値に置き換わってしまう。
   */
  const [editingRetention, setEditingRetention] = useState(false)
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

  /* 読み取りの面から編集へ入る唯一の口。開いたうえで最初の欄へ焦点を送る。 */
  const openRetentionEditor = () => {
    setEditingRetention(true)
    setRetentionFailure(null)
    // 欄はこの描画の後に現れるので、焦点は次のフレームで送る。
    requestAnimationFrame(() => document.getElementById('retention-days')?.focus())
  }

  return (
    /* 承認済みモック `operations-approved.html#recording-ops` /
       `RECORDING-OPS--failure-hold--ipad-landscape.png` の骨格と文言。 */
    <AdminSurface label="録音運用">
      <AdminLayout
        /*
         * 柱は全画面共通の 1 本しかないので、この面の節はそこへ渡す。
         * 別の面への移動はサイドバーが持つので、ここでは並べない。
         */
        sections={SECTIONS.map((section) => ({
          ...section,
          current: section.label === '保存期間',
        }))}
      >
        <h1>録音の保存期間</h1>

        {failure && <FailureNotice>{failure}</FailureNotice>}

        <CardGrid>
          <Card label="成立予約">
            <b>成立予約</b>
            <br />
            {editingRetention ? (
              /* カード見出しが「成立予約」と言っているので、可視ラベルを重ねない。
                 名前は aria-label で入力自身に持たせる。 */
              <TextField
                hideLabel
                id="retention-days"
                label="成立予約の保存日数"
                inputMode="numeric"
                value={confirmedDays}
                onChange={(event) => setConfirmedDays(event.target.value)}
              />
            ) : confirmedDays === '' ? (
              '未取得'
            ) : (
              `${confirmedDays}日保存`
            )}
            <br />
            <small>{`最低${MINIMUM_CONFIRMED_RETENTION_DAYS}日未満には設定できません`}</small>
            {mayManage && !editingRetention && (
              <>
                <br />
                <Action inset="tight" onClick={openRetentionEditor}>
                  変更
                </Action>
              </>
            )}
          </Card>
          <Card label="破棄した受付">
            <b>破棄した受付</b>
            <br />
            {editingRetention ? (
              <TextField
                hideLabel
                id="retention-hours"
                label="破棄受付の保存時間"
                inputMode="numeric"
                value={discardedHours}
                onChange={(event) => setDiscardedHours(event.target.value)}
              />
            ) : discardedHours === '' ? (
              '未取得'
            ) : (
              discardedRetentionLabel(discardedHours)
            )}
            <br />
            <small>{`最低${MINIMUM_DISCARDED_RETENTION_HOURS}時間未満には設定できません`}</small>
          </Card>
          <Card label="適用元">
            <b>適用元</b>
            <br />
            組織共通値
            <br />
            {mayManage && (
              /* ここは保存操作ではなく「これから店舗の値を入れる」導線なので、
                 押しただけで保存を走らせない。 */
              <Action inset="tight" onClick={openRetentionEditor}>
                店舗上書きを設定
              </Action>
            )}
          </Card>
        </CardGrid>

        {mayManage && editingRetention && (
          <>
            {retentionFailure && <FailureNotice>{retentionFailure}</FailureNotice>}
            <Actions>
              <Action
                inset="tight"
                onClick={() => {
                  void saveRetention()
                }}
              >
                保存期間を更新
              </Action>
            </Actions>
          </>
        )}

        <section aria-label="対応が必要">
          <h2>対応が必要</h2>
          {failedRows.length === 0 && heldRows.length === 0 && (
            <p>対応が必要な録音はありません。</p>
          )}
          {failedRows.map((recording) => (
            <AdminRow
              key={recording.id}
              tone="error"
              label={`${recordingLabel(recording.id)} 保存失敗`}
            >
              <b>{recordingLabel(recording.id)}</b>
              <span>保存失敗</span>
              <span>
                {recording.reservationId === null ? '予約は成立していません' : '予約は成立済み'}
              </span>
              {mayManage ? (
                <Action
                  inset="tight"
                  onClick={() => {
                    void retry(recording)
                  }}
                >
                  再試行
                </Action>
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
              <b>{recordingLabel(recording.id)}</b>
              <span>保全中</span>
              <span>{`理由: ${recording.holdReason ?? '記録されています'}`}</span>
              <Action
                inset="tight"
                onClick={() => {
                  setPosition(0)
                  setSelected(recording)
                }}
              >
                詳細
              </Action>
            </AdminRow>
          ))}
        </section>

        <fieldset className="mt-4.5 flex flex-wrap gap-2 border-0 p-0">
          <legend>録音の状態で絞り込む</legend>
          <ToggleFilter on={filter === null} onClick={() => setFilter(null)}>
            すべて
          </ToggleFilter>
          {RECORDING_OPS_FILTERS.map((entry) => (
            <ToggleFilter
              key={entry.state}
              on={filter === entry.state}
              onClick={() => setFilter(entry.state)}
            >
              {entry.label}
            </ToggleFilter>
          ))}
        </fieldset>

        <ul className="mt-3 flex flex-col gap-2.25">
          {rows.map((recording) => (
            <li key={recording.id} data-testid={`recording-${recording.id}`}>
              <Card tone={recordingSurfaceTone(recording.state)}>
                <div className="flex flex-wrap items-center gap-2.5">
                  <StatePill tone={recording.state === 'failed' ? 'danger' : 'plain'}>
                    {RECORDING_STATE_LABEL[recording.state]}
                  </StatePill>
                  {/* 時刻・長さは桁で読む。等幅は数字と ID にだけ使う。 */}
                  <span className="font-record text-grid">
                    {formatRecordingInstant(recording.startedAt)}
                  </span>
                  <span>録音者 {recording.recorderId}</span>
                  <span className="font-record text-grid">
                    {formatRecordingDuration(recording.durationSeconds)}
                  </span>
                  <span>{retentionLabel({ retentionUntil: recording.retentionUntil, now })}</span>
                </div>
                {recording.holdReason && (
                  <p>
                    保全理由: {recording.holdReason}
                    {recording.heldBy ? ` · 指定者 ${recording.heldBy}` : ''}
                  </p>
                )}
                {recording.failureReason && <p>失敗理由: {recording.failureReason}</p>}
                <div className="mt-2.5 flex flex-wrap gap-2.5">
                  {recording.state === 'stored' || recording.state === 'held' ? (
                    <Action
                      inset="tight"
                      onClick={() => {
                        setPosition(0)
                        setSelected(recording)
                      }}
                    >
                      再生する
                    </Action>
                  ) : null}
                  {mayManage && canRetryRecording(recording.state) && (
                    <Action
                      inset="tight"
                      onClick={() => {
                        void retry(recording)
                      }}
                    >
                      再試行
                    </Action>
                  )}
                  {mayManage && recording.state !== 'held' && recording.state !== 'deleted' && (
                    <Action inset="tight" onClick={() => openAction('hold', recording)}>
                      保全する
                    </Action>
                  )}
                  {mayManage && recording.state === 'held' && (
                    <Action inset="tight" onClick={() => openAction('release', recording)}>
                      保全を解除する
                    </Action>
                  )}
                  {/* 削除は取り返しがつかない。既定の見た目にしない。 */}
                  {mayManage && recording.state !== 'deleted' && (
                    <Action
                      variant="danger"
                      inset="tight"
                      onClick={() => {
                        void remove(recording)
                      }}
                    >
                      削除する
                    </Action>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>

        {selected && (
          <div className="mt-4.5">
            <Card label="録音の再生">
              <b>録音の再生</b>
              <dl className="mt-2.5 grid grid-cols-3 gap-3">
                <div>
                  <dt>録音日時</dt>
                  <dd className="font-record text-grid">
                    {formatRecordingInstant(selected.startedAt)}
                  </dd>
                </div>
                <div>
                  <dt>録音者</dt>
                  <dd>{selected.recorderId}</dd>
                </div>
                <div>
                  <dt>長さ</dt>
                  <dd className="font-record text-grid">
                    {formatRecordingDuration(selected.durationSeconds)}
                  </dd>
                </div>
              </dl>
              {/* biome-ignore lint/a11y/useMediaCaption: staff-only audio evidence has no caption track. */}
              <audio
                ref={audioRef}
                src={`${base}/recordings/${selected.id}/audio`}
                preload="none"
                controlsList="nodownload"
              />
              <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                {/*
                 * 承認済みモックの `.audio` — 44px の pine の丸。丸は Action の
                 * 左右余白と両立しないので、ここだけ素のボタンで組む。中の ▶ は
                 * 装飾で、名前は `再生` という文字が運ぶ。
                 */}
                <button
                  type="button"
                  className="grid size-11 min-h-11 place-items-center rounded-circle border border-pine bg-pine font-sans text-body text-on-pine"
                  onClick={() => {
                    void audioRef.current?.play?.()
                  }}
                >
                  <span aria-hidden="true">▶</span>
                  <span className="sr-only">再生</span>
                </button>
                <Action
                  inset="tight"
                  onClick={() => {
                    audioRef.current?.pause?.()
                  }}
                >
                  一時停止
                </Action>
                <input
                  type="range"
                  aria-label="再生位置"
                  min={0}
                  max={selected.durationSeconds}
                  value={position}
                  className="min-h-11 w-full"
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    setPosition(next)
                    if (audioRef.current) audioRef.current.currentTime = next
                  }}
                />
              </div>
              <p>再生操作は監査記録に残ります。音声の保存や持ち出しはできません。</p>
            </Card>
          </div>
        )}
      </AdminLayout>

      {reauthFor && terminalId && (
        <ReauthPrompt
          storeId={storeId}
          storeName={storeName}
          api={api}
          navigate={navigate}
          now={now}
          terminalId={terminalId}
          terminalName={terminalName}
          organizationId={organizationId}
          /* 承認済みモック `REAUTH` の本文は「録音の保全指定は個人認証が必要です。」。
             `保全` だけに縮めると、モックと一字ずれる。 */
          actionLabel={reauthFor.kind === 'hold' ? '録音の保全指定' : '録音の保全解除'}
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
    </AdminSurface>
  )
}

/** 状態に応じた面の調子。失敗は赤、保全中は琥珀（モックの `.row` と同じ対応）。 */
function recordingSurfaceTone(state: Recording['state']) {
  if (state === 'failed') return 'error' as const
  if (state === 'held') return 'warning' as const
  return 'plain' as const
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
    <Modal titleId={titleId} title={title}>
      <p>理由は監査記録に残ります。保全中の録音は期限を過ぎても削除されません。</p>
      <div className="mt-3">
        <TextAreaField
          id="recording-action-reason"
          label={reasonLabel}
          error={error}
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
        />
      </div>
      <Actions>
        <Action inset="tight" onClick={onCancel}>
          キャンセル
        </Action>
        <Action variant="primary" inset="tight" onClick={onSubmit}>
          {submitLabel}
        </Action>
      </Actions>
    </Modal>
  )
}
