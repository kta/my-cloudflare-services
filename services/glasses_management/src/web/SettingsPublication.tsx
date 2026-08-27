import {
  SettingsConflictResolution,
  type SettingsConflictResolutionKind,
  SettingsDraft,
  SettingsImpactReport,
  type SettingsImpactSeverity,
  SettingsOverrideRelease,
  SettingsOverrideView,
  SettingsPublication as SettingsPublicationContract,
  SettingsVersionDetail,
  SettingsVersionSummary,
  type StorePermission,
} from '@app/contracts'
import { Button, Chip, Field, Notice, Select, Textarea, TextInput } from '@app/ui'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import {
  diffRows,
  draftSaveState,
  formatJstInstant,
  IMPACT_SEVERITY_LABEL,
  impactSummary,
  ORIGIN_LABEL,
  type OverrideReleaseNotice,
  overrideReleaseNotice,
  publicationView,
  RESOLUTION_LABEL,
  scheduleError,
  settingsFieldLabel,
  settingsStateLabel,
  settingsWarnings,
  versionConflictNotice,
} from './settings-publication-view'
import type { StaffScreenProps } from './staff-screen'

/**
 * 設定ガイド 第6工程「影響確認と公開」と、その周辺（適用元・公開結果・版履歴）。
 *
 * 下書き → 影響確認 → 公開 は一本の閉ループで、途中を飛ばせないことが仕様の
 * 中身そのもの（AC-EYEX-108, 109）。したがって「公開する」は影響確認の結果に
 * 従属し、過去版の復元は再公開ではなく新しい下書きを作るだけに留める。
 *
 * 時計はここにも helper にも無い。JST の今日は `today` で注入される。
 */

type Props = StaffScreenProps & {
  permissions: StorePermission[]
  /** JST `YYYY-MM-DD`, injected: this screen never reads the clock. */
  today: string
  /**
   * 工程1〜5に未保存の編集が残っているか。設定の編集はガイド側が持っている
   * ので、保存状態の真偽もそちらから渡す（AC-EYEX-45）。
   */
  dirty?: boolean
}

const RESOLUTION_OPTIONS: readonly SettingsConflictResolutionKind[] = [
  'alternative_resource',
  'keep_exception',
  'customer_contacted',
]

const SEVERITY_TONE: Record<SettingsImpactSeverity, 'danger' | 'warning' | 'neutral'> = {
  blocking: 'danger',
  warning: 'warning',
  info: 'neutral',
}

const LOAD_ERROR = '設定を取得できませんでした。もう一度お試しください。'

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/**
 * 名前のついた区画。`<fieldset aria-label>`（role="group"）にするのは、支援技術に
 * 「この見出しの下はここまで」を伝えるため。状態と警告を別の group に分けるのが UC-EYEX-159
 * の要求そのものなので、区画の名前は装飾ではなく仕様である。
 */
function Panel({
  label,
  actions,
  children,
}: {
  label: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <fieldset
      aria-label={label}
      className="flex min-w-0 flex-col gap-3 rounded-ctl border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display font-semibold text-ink text-lg">{label}</h3>
        {actions}
      </div>
      {children}
    </fieldset>
  )
}

/**
 * モックの `.card` — 白地・1px 罫・角丸 9px・見出しを太字で 1 行目に置く。
 * `tone="warning"` は注意を要するカード（`.card.warning`）。
 */
function Metric({
  term,
  value,
  tone = 'neutral',
  children,
}: {
  term: string
  value?: string
  tone?: 'neutral' | 'warning' | 'danger'
  children?: ReactNode
}) {
  const toneClass =
    tone === 'warning'
      ? 'border-amber bg-amber-soft'
      : tone === 'danger'
        ? 'border-danger-line bg-danger-soft'
        : 'border-line bg-surface'
  return (
    <div className={`rounded-card border p-3 ${toneClass}`}>
      <p className="font-sans font-semibold text-ink text-sm">{term}</p>
      {value !== undefined && <p className="font-sans text-ink text-sm">{value}</p>}
      {children}
    </div>
  )
}

export function SettingsPublication({
  storeId,
  storeName,
  api,
  permissions,
  today,
  dirty = false,
}: Props) {
  const canRead = permissions.includes('settings.read')
  const canManage = permissions.includes('settings.manage')

  const [draft, setDraft] = useState<SettingsDraft>()
  const [impact, setImpact] = useState<SettingsImpactReport>()
  const [override, setOverride] = useState<SettingsOverrideView>()
  const [versions, setVersions] = useState<SettingsVersionSummary[]>([])
  const [versionDetail, setVersionDetail] = useState<SettingsVersionDetail>()
  const [publication, setPublication] = useState<SettingsPublicationContract>()
  const [releaseNotice, setReleaseNotice] = useState<OverrideReleaseNotice>()
  const [error, setError] = useState<string>()
  const [info, setInfo] = useState<string>()
  const [scheduleInput, setScheduleInput] = useState('')
  const [scheduleMessage, setScheduleMessage] = useState<string>()
  const [resolving, setResolving] = useState<{ reservationId: string; message: string }>()
  const [resolution, setResolution] =
    useState<SettingsConflictResolutionKind>('alternative_resource')
  const [resolutionNote, setResolutionNote] = useState('')
  const [rescheduling, setRescheduling] = useState(false)

  const base = `/api/staff/stores/${storeId}/availability`

  const loadImpact = useCallback(async () => {
    const response = await api(`${base}/draft/impact`)
    if (!response.ok) return
    const parsed = SettingsImpactReport.safeParse(await readJson(response))
    if (parsed.success) setImpact(parsed.data)
  }, [api, base])

  useEffect(() => {
    if (!canRead) return
    let active = true
    void (async () => {
      const [draftResponse, impactResponse, overrideResponse, versionsResponse] = await Promise.all(
        [
          api(`${base}/draft`),
          api(`${base}/draft/impact`),
          api(`${base}/override`),
          api(`${base}/versions`),
        ],
      )
      if (!active) return
      // 下書きがまだ無いのは失敗ではない。無いものを「取得できません」と
      // 言うと、実際の失敗と区別できなくなる。
      if (draftResponse.ok) {
        const parsed = SettingsDraft.safeParse(await readJson(draftResponse))
        if (active && parsed.success) setDraft(parsed.data)
      } else if (draftResponse.status >= 500) {
        if (active) setError(LOAD_ERROR)
      }
      if (impactResponse.ok) {
        const parsed = SettingsImpactReport.safeParse(await readJson(impactResponse))
        if (active && parsed.success) setImpact(parsed.data)
      }
      if (overrideResponse.ok) {
        const parsed = SettingsOverrideView.safeParse(await readJson(overrideResponse))
        if (active && parsed.success) setOverride(parsed.data)
      }
      if (versionsResponse.ok) {
        const parsed = SettingsVersionSummary.array().safeParse(await readJson(versionsResponse))
        if (active && parsed.success) setVersions(parsed.data)
      }
    })()
    return () => {
      active = false
    }
  }, [api, base, canRead])

  if (!canRead) {
    return (
      <section aria-label="影響確認と公開" className="space-y-4 p-6">
        <Notice>設定を閲覧する権限がありません。</Notice>
      </section>
    )
  }

  const summary = impact === undefined ? undefined : impactSummary(impact)
  const saveState = draftSaveState({ draft, dirty })
  const warnings = settingsWarnings({ impact, publication })
  const result = publication === undefined ? undefined : publicationView(publication)

  const saveDraft = async (status: 'draft' | 'review') => {
    if (draft === undefined) return
    setError(undefined)
    setInfo(undefined)
    const { storeId: _storeId, ...settings } = draft.settings
    const response = await api(`${base}/draft`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, settings }),
    })
    const body = await readJson(response)
    if (!response.ok) {
      setError(versionConflictNotice(body) ?? '下書きを保存できませんでした。')
      return
    }
    const parsed = SettingsDraft.safeParse(body)
    if (!parsed.success) {
      setError('下書きを保存できませんでした。')
      return
    }
    setDraft(parsed.data)
    setInfo(status === 'review' ? '確認へ回しました。' : '下書きを保存しました。')
    await loadImpact()
  }

  const recordResolution = async () => {
    if (resolving === undefined) return
    const response = await api(`${base}/draft/conflicts/${resolving.reservationId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution, note: resolutionNote }),
    })
    const parsed = SettingsConflictResolution.safeParse(await readJson(response))
    if (!response.ok || !parsed.success) {
      setError('解消を記録できませんでした。')
      return
    }
    setResolving(undefined)
    setResolutionNote('')
    // 記録しただけでは公開できるとは限らない。必ずサーバへ再確認させる。
    await loadImpact()
  }

  const publish = async (scheduledForJst?: string) => {
    if (draft === undefined) return
    setError(undefined)
    setScheduleMessage(undefined)
    const response = await api(`${base}/publications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        draftId: draft.id,
        targetStoreIds: [storeId],
        ...(scheduledForJst === undefined ? {} : { scheduledForJst }),
        idempotencyKey: crypto.randomUUID(),
      }),
    })
    const body = await readJson(response)
    if (!response.ok) {
      setError(
        (body as { error?: unknown } | undefined)?.error === 'publication_blocked'
          ? '未解消の影響予約があるため公開できません。影響確認をやり直してください。'
          : '公開できませんでした。もう一度お試しください。',
      )
      await loadImpact()
      return
    }
    const parsed = SettingsPublicationContract.safeParse(body)
    if (parsed.success) setPublication(parsed.data)
  }

  const patchPublication = async (patch: { scheduledForJst?: string; status?: 'cancelled' }) => {
    if (publication === undefined) return
    const response = await api(`${base}/publications/${publication.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const parsed = SettingsPublicationContract.safeParse(await readJson(response))
    if (!response.ok || !parsed.success) {
      setError('公開予定を変更できませんでした。')
      return
    }
    setPublication(parsed.data)
    setRescheduling(false)
  }

  const postPublication = async (suffix: 'run' | 'retry') => {
    if (publication === undefined) return
    const response = await api(`${base}/publications/${publication.id}/${suffix}`, {
      method: 'POST',
    })
    const parsed = SettingsPublicationContract.safeParse(await readJson(response))
    if (!response.ok || !parsed.success) {
      setError(suffix === 'retry' ? '再試行できませんでした。' : '公開を実行できませんでした。')
      return
    }
    setPublication(parsed.data)
  }

  const openDiff = async (versionId: string) => {
    const response = await api(`${base}/versions/${versionId}`)
    const parsed = SettingsVersionDetail.safeParse(await readJson(response))
    if (response.ok && parsed.success) setVersionDetail(parsed.data)
  }

  const restoreVersion = async (versionId: string) => {
    const response = await api(`${base}/versions/${versionId}/restore`, { method: 'POST' })
    const parsed = SettingsDraft.safeParse(await readJson(response))
    if (!response.ok || !parsed.success) {
      setError('過去版を復元できませんでした。')
      return
    }
    setDraft(parsed.data)
    setPublication(undefined)
    setInfo('過去版を新しい下書きにしました。公開する前に影響確認を行ってください。')
    await loadImpact()
  }

  const releaseOverride = async () => {
    const response = await api(`${base}/override/release`, { method: 'POST' })
    const parsed = SettingsOverrideRelease.safeParse(await readJson(response))
    if (!response.ok || !parsed.success) {
      setError('店舗上書きを解除できませんでした。')
      return
    }
    setDraft(parsed.data.draft)
    setImpact(parsed.data.impact)
    setOverride((previous) =>
      previous === undefined ? previous : { ...previous, origin: 'chain', overriddenFields: [] },
    )
    setReleaseNotice(overrideReleaseNotice(parsed.data))
  }

  const scheduleAndPublish = () => {
    const message = scheduleError(scheduleInput, today)
    if (message !== undefined) {
      setScheduleMessage(message)
      return
    }
    void publish(scheduleInput)
  }

  return (
    <section aria-label="影響確認と公開" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display font-semibold text-2xl text-ink">影響を確認して公開</h2>
        <p className="font-sans text-ink-muted text-sm">
          {draft === undefined
            ? storeName
            : `版 draft-${String(draft.draftVersion).padStart(2, '0')}`}
        </p>
      </header>

      {error && <Notice>{error}</Notice>}
      {info && <Notice tone="success">{info}</Notice>}

      {result !== undefined && (
        <Panel label="公開結果">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-display font-semibold text-ink text-lg">
              版 {result.versionId} の公開結果
            </h4>
            <Chip tone={result.statusTone}>{result.statusLabel}</Chip>
          </div>
          <p className="font-sans text-ink-muted text-sm">
            {result.executedLabel} · {result.scheduledLabel}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric term="成功" value={result.appliedLabel} />
            <Metric
              term="失敗"
              value={result.failedLabel}
              tone={result.failed.length > 0 ? 'danger' : 'neutral'}
            />
            <Metric term="反映確認">
              <p className="font-sans text-ink text-sm">{result.webSlotLabel}</p>
              <p className="font-sans text-ink text-sm">{result.ledgerLabel}</p>
            </Metric>
          </div>
          {result.applied.length > 0 && (
            <fieldset aria-label="反映済みの店舗" className="flex min-w-0 flex-col gap-1">
              <h4 className="font-sans font-medium text-ink text-sm">反映済みの店舗</h4>
              <ul className="flex flex-col gap-1">
                {result.applied.map((target) => (
                  <li key={target.storeId} className="font-sans text-ink-muted text-sm">
                    <span>{target.storeId}</span>
                    <span> ・ 第{target.appliedVersion ?? 0}版</span>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {result.failed.length > 0 && (
            <fieldset aria-label="失敗した店舗" className="flex min-w-0 flex-col gap-2">
              <h4 className="font-sans font-medium text-ink text-sm">失敗した店舗</h4>
              <p className="font-sans text-ink-muted text-sm">
                再試行対象 {result.retryStoreIds.length}店舗
              </p>
              <ul className="flex flex-col gap-1">
                {result.failed.map((target) => (
                  <li
                    key={target.storeId}
                    className="flex flex-wrap items-center gap-3 rounded-card border border-danger-line bg-danger-soft p-3"
                  >
                    <span className="font-sans font-semibold text-ink text-sm">
                      {target.storeId}
                    </span>
                    <span className="font-sans text-ink-muted text-sm">
                      {target.failureReason ?? '理由不明'}
                    </span>
                    <span className="font-sans text-ink-muted text-sm">公開未反映</span>
                  </li>
                ))}
              </ul>
              {canManage && result.canRetry && (
                <div className="flex flex-wrap gap-2">
                  <Button className="min-h-12" onClick={() => void postPublication('retry')}>
                    この店舗だけ再試行
                  </Button>
                </div>
              )}
            </fieldset>
          )}
          {canManage && (result.canCancel || result.canReschedule) && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                className="min-h-12"
                onClick={() => {
                  setRescheduling(true)
                }}
              >
                公開予定を変更
              </Button>
              <Button className="min-h-12" onClick={() => void postPublication('run')}>
                今すぐ実行
              </Button>
              <Button
                variant="danger"
                className="min-h-12"
                onClick={() => void patchPublication({ status: 'cancelled' })}
              >
                公開予定を取消
              </Button>
            </div>
          )}
        </Panel>
      )}

      <Panel
        label="影響確認"
        actions={
          <Button variant="ghost" className="min-h-12" onClick={() => void loadImpact()}>
            影響を再確認
          </Button>
        }
      >
        {summary === undefined ? (
          <p className="font-sans text-ink-muted text-sm">影響確認の結果はまだありません。</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric term="公開予定枠" value={summary.slotLabel} />
              <Metric term="既存予約" value={summary.ledgerLabel} />
              <Metric
                term="ブロッキング"
                value={summary.blockingLabel}
                tone={summary.unresolved.length > 0 ? 'warning' : 'neutral'}
              />
              <Metric term="警告" value={summary.warningLabel} />
            </div>
            <p className="font-sans text-ink-muted text-sm">{summary.evaluatedAtLabel}</p>
            {summary.groups.map((group) => (
              <fieldset
                key={group.kind}
                aria-label={group.label}
                className="flex min-w-0 flex-col gap-2 rounded-ctl border border-line p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-sans font-medium text-ink text-sm">{group.label}</h4>
                  <Chip tone={SEVERITY_TONE[group.severity]}>{group.severityLabel}</Chip>
                </div>
                <ul className="flex flex-col gap-2">
                  {group.items.map((item) => (
                    <li
                      key={`${item.kind}-${item.reservationId ?? item.message}`}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="font-sans text-ink text-sm">{item.message}</span>
                      <span className="flex items-center gap-2">
                        {/* 群の見出しがすでに重大度を語で示している。差がある
                            項目だけ、行にも語を添える。 */}
                        {item.severity !== group.severity && (
                          <Chip tone={SEVERITY_TONE[item.severity]}>
                            {IMPACT_SEVERITY_LABEL[item.severity]}
                          </Chip>
                        )}
                        {item.resolution !== null && (
                          <Chip tone="success">{RESOLUTION_LABEL[item.resolution]}</Chip>
                        )}
                        {canManage && item.reservationId !== null && item.resolution === null && (
                          <Button
                            variant="ghost"
                            className="min-h-12"
                            onClick={() => {
                              setResolving({
                                reservationId: item.reservationId ?? '',
                                message: item.message,
                              })
                              setResolution('alternative_resource')
                              setResolutionNote('')
                            }}
                          >
                            解消を記録
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </fieldset>
            ))}
            {summary.blockedReason !== undefined && (
              <div className="rounded-card border border-amber bg-amber-soft p-4">
                <p className="font-sans font-semibold text-ink text-sm">
                  {summary.blockedHeadline}
                </p>
                <p className="font-sans text-ink text-sm">{summary.blockedReason}</p>
              </div>
            )}
            {canManage && summary.unresolved.length > 0 && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="ghost"
                  className="min-h-12"
                  onClick={() => {
                    const first = summary.unresolved[0]
                    if (first === undefined) return
                    setResolving({
                      reservationId: first.reservationId ?? '',
                      message: first.message,
                    })
                    setResolution('alternative_resource')
                    setResolutionNote('')
                  }}
                >
                  影響予約を解消
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>

      <Panel label="設定の状態">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="neutral">
            {draft === undefined ? '下書きなし' : settingsStateLabel(draft)}
          </Chip>
          <Chip tone={saveState.dirty ? 'warning' : 'success'}>{saveState.label}</Chip>
        </div>
        <p className="font-sans text-ink-muted text-sm">{saveState.savedAtLabel}</p>
        <p className="font-sans text-ink-muted text-sm">{saveState.savedByLabel}</p>
        {canManage && draft !== undefined && (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" className="min-h-12" onClick={() => void saveDraft('draft')}>
              下書きを保存
            </Button>
            <Button variant="ghost" className="min-h-12" onClick={() => void saveDraft('review')}>
              確認へ回す
            </Button>
          </div>
        )}
      </Panel>

      {warnings.length > 0 && (
        <Panel label="警告">
          <p className="font-sans text-ink-muted text-sm">
            競合と失敗は設定の状態ではありません。状態とは別に解消してください。
          </p>
          <ul className="flex flex-col gap-2">
            {warnings.map((warning) => (
              <li key={warning.id}>
                <Chip tone={warning.tone}>{warning.label}</Chip>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {override !== undefined && (
        <Panel label="適用元">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={override.origin === 'chain' ? 'neutral' : 'warning'}>
              {ORIGIN_LABEL[override.origin]}
            </Chip>
            <span className="font-sans text-ink-muted text-sm">
              全店共通 第{override.chainVersion}版
            </span>
          </div>
          {override.overriddenFields.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-sans text-ink-muted text-sm">店舗で上書きしている項目</p>
              <ul className="flex flex-wrap gap-2">
                {override.overriddenFields.map((field) => (
                  <li key={field}>
                    <Chip tone="neutral">{settingsFieldLabel(field)}</Chip>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {releaseNotice !== undefined && (
            <div className="flex flex-col gap-1 rounded-ctl border border-line bg-paper p-3">
              <p className="font-sans font-medium text-ink text-sm">{releaseNotice.headline}</p>
              <p className="font-sans text-ink-muted text-sm">{releaseNotice.detail}</p>
            </div>
          )}
          {canManage && override.origin === 'store_override' && (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" className="min-h-12" onClick={() => void releaseOverride()}>
                店舗上書きを解除
              </Button>
            </div>
          )}
        </Panel>
      )}

      {canManage && (
        <Panel label="公開">
          <Field label="公開日時（JST）" htmlFor="publish-schedule" error={scheduleMessage}>
            <TextInput
              id="publish-schedule"
              value={scheduleInput}
              placeholder="2026-08-30T18:00"
              onChange={(event) => {
                setScheduleInput(event.target.value)
                setScheduleMessage(undefined)
              }}
            />
          </Field>
          <p className="font-sans text-ink-muted text-sm">
            空欄のまま公開すると、その場で適用されます。日時を入れると公開予約になります。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-12"
              disabled={draft === undefined || summary?.canPublish !== true}
              onClick={() => void publish()}
            >
              公開する
            </Button>
            <Button
              variant="ghost"
              className="min-h-12"
              disabled={draft === undefined || summary?.canPublish !== true}
              onClick={scheduleAndPublish}
            >
              公開を予約する
            </Button>
          </div>
        </Panel>
      )}

      <Panel label="版履歴">
        {versions.length === 0 ? (
          <p className="font-sans text-ink-muted text-sm">公開済みの版はまだありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {versions.map((version) => (
              <li
                key={version.versionId}
                className="flex flex-wrap items-center justify-between gap-2 border-line border-b py-2 last:border-b-0"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-sans font-medium text-ink text-sm">
                    第{version.version}版
                  </span>
                  <span className="font-sans text-ink-muted text-sm">
                    {formatJstInstant(version.publishedAt)}
                  </span>
                  <span className="font-sans text-ink-muted text-sm">{version.publishedBy}</span>
                  <Chip tone="neutral">{ORIGIN_LABEL[version.origin]}</Chip>
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    className="min-h-12"
                    onClick={() => void openDiff(version.versionId)}
                  >
                    版の差分を見る
                  </Button>
                  {canManage && (
                    <Button
                      variant="ghost"
                      className="min-h-12"
                      onClick={() => void restoreVersion(version.versionId)}
                    >
                      過去版から新しい下書きを作る
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {versionDetail !== undefined && (
          <fieldset
            aria-label={`第${versionDetail.version}版の差分`}
            className="flex min-w-0 flex-col gap-2 overflow-x-auto rounded-ctl border border-line p-3"
          >
            <h4 className="font-sans font-medium text-ink text-sm">
              第{versionDetail.version}版の差分
            </h4>
            <table className="w-full min-w-md border-collapse text-left">
              <thead>
                <tr>
                  <th className="font-sans text-ink-muted text-xs">項目</th>
                  <th className="font-sans text-ink-muted text-xs">変更前</th>
                  <th className="font-sans text-ink-muted text-xs">変更後</th>
                </tr>
              </thead>
              <tbody>
                {diffRows(versionDetail).map((row) => (
                  <tr key={row.field} className="border-line border-t">
                    <td className="font-sans text-ink text-sm">{row.label}</td>
                    <td className="font-sans text-ink-muted text-sm">{row.before}</td>
                    <td className="font-sans text-ink text-sm">{row.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="font-sans text-ink-muted text-sm">
              過去版は直接公開できません。復元すると新しい下書きになります。
            </p>
          </fieldset>
        )}
      </Panel>

      {resolving !== undefined && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="影響予約の解消を記録"
          className="fixed inset-0 flex items-center justify-center bg-ink/40 p-6"
        >
          <div className="flex w-full max-w-xl flex-col gap-3 rounded-ctl border border-line bg-surface p-5">
            <h3 className="font-display font-semibold text-ink text-xl">影響予約の解消を記録</h3>
            <p className="font-sans text-ink-muted text-sm">{resolving.message}</p>
            <Field label="対応" htmlFor="resolution-kind">
              <Select
                id="resolution-kind"
                value={resolution}
                onChange={(event) => {
                  const next = RESOLUTION_OPTIONS.find((kind) => kind === event.target.value)
                  if (next !== undefined) setResolution(next)
                }}
              >
                {RESOLUTION_OPTIONS.map((kind) => (
                  <option key={kind} value={kind}>
                    {RESOLUTION_LABEL[kind]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="メモ" htmlFor="resolution-note">
              <Textarea
                id="resolution-note"
                value={resolutionNote}
                onChange={(event) => {
                  setResolutionNote(event.target.value)
                }}
              />
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                className="min-h-12"
                onClick={() => {
                  setResolving(undefined)
                }}
              >
                やめる
              </Button>
              <Button className="min-h-12" onClick={() => void recordResolution()}>
                記録する
              </Button>
            </div>
          </div>
        </div>
      )}

      {rescheduling && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="公開予定の変更"
          className="fixed inset-0 flex items-center justify-center bg-ink/40 p-6"
        >
          <div className="flex w-full max-w-xl flex-col gap-3 rounded-ctl border border-line bg-surface p-5">
            <h3 className="font-display font-semibold text-ink text-xl">公開予定の変更</h3>
            <Field label="新しい公開日時（JST）" htmlFor="reschedule-input" error={scheduleMessage}>
              <TextInput
                id="reschedule-input"
                value={scheduleInput}
                placeholder="2026-08-30T18:00"
                onChange={(event) => {
                  setScheduleInput(event.target.value)
                  setScheduleMessage(undefined)
                }}
              />
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                className="min-h-12"
                onClick={() => {
                  setRescheduling(false)
                }}
              >
                やめる
              </Button>
              <Button
                className="min-h-12"
                onClick={() => {
                  const message = scheduleError(scheduleInput, today)
                  if (message !== undefined) {
                    setScheduleMessage(message)
                    return
                  }
                  void patchPublication({ scheduledForJst: scheduleInput })
                }}
              >
                この日時に変更
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
