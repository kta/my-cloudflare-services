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
import { type ReactNode, useCallback, useEffect, useId, useState } from 'react'
import { Action, Actions } from './design/controls'
import { Modal } from './design/dialogs'
import { SelectField, TextAreaField, TextField } from './design/forms'
import { FailureNotice, StatusNotice } from './design/notices'
import { Card, CardGrid, FieldCard, Preview, StatePill, TitleRow } from './design/surfaces'
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
 * 見た目は承認済みモック `settings-complete-approved.html#impact` の語彙で組む。
 * 数だけを 4 枚のカードで立て、やることは下の警告面が文章で持つ。数と指示を
 * 同じ面に混ぜると、どちらも読まれない。
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

/**
 * 重大度は語で読ませる（`IMPACT_SEVERITY_LABEL`）。ピルの色は語を補うだけで、
 * 情報を色だけに載せない。
 */
const SEVERITY_TONE: Record<SettingsImpactSeverity, 'plain' | 'danger' | 'caution'> = {
  blocking: 'danger',
  warning: 'caution',
  info: 'plain',
}

const LOAD_ERROR = '設定を取得できませんでした。もう一度お試しください。'

/** 公開できない理由を指す先。押せない「公開する」から `aria-describedby` で結ぶ。 */
const BLOCKED_REASON_ID = 'settings-publication-blocked'

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/**
 * 名前のついた区画。承認済みモックの `.preview`（白・1px 罫・角丸 9px）で、
 * 見出しは中の太字 1 行目が持つ。区画の名前は装飾ではなく仕様なので
 * （UC-EYEX-159 は状態と警告を別の区画に分けることを求める）、必ず付ける。
 */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Preview label={label}>
      <b className="block">{label}</b>
      {children}
    </Preview>
  )
}

/** 面の中で 1 段落ぶんの間隔を空けた行。段落の既定余白は使わない。 */
function Line({ children }: { children: ReactNode }) {
  return <span className="mt-1.5 block">{children}</span>
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
  // 手前を塞ぐ面の見出しを名前として指すための id（描画には影響しない）。
  const resolveTitleId = useId()
  const rescheduleTitleId = useId()

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
    return <StatusNotice>設定を閲覧する権限がありません。</StatusNotice>
  }

  const summary = impact === undefined ? undefined : impactSummary(impact)
  const saveState = draftSaveState({ draft, dirty })
  const warnings = settingsWarnings({ impact, publication })
  const result = publication === undefined ? undefined : publicationView(publication)
  const canPublish = draft !== undefined && summary?.canPublish === true

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

  const openResolution = (reservationId: string, message: string) => {
    setResolving({ reservationId, message })
    setResolution('alternative_resource')
    setResolutionNote('')
  }

  return (
    <>
      <TitleRow
        push={
          <span>
            {draft === undefined
              ? storeName
              : `版 draft-${String(draft.draftVersion).padStart(2, '0')}`}
          </span>
        }
      >
        <h1>影響を確認して公開</h1>
      </TitleRow>

      {error && <FailureNotice>{error}</FailureNotice>}
      {info && <StatusNotice>{info}</StatusNotice>}

      {/* ---------------- 影響確認（承認済みモック #impact） ---------------- */}
      <section aria-label="影響確認">
        {summary === undefined ? (
          <StatusNotice>影響確認の結果はまだありません。</StatusNotice>
        ) : (
          <>
            <CardGrid columns={2} mt={4}>
              <FieldCard title="公開予定枠">{summary.slotLabel}</FieldCard>
              <FieldCard title="既存予約">{summary.ledgerLabel}</FieldCard>
              {/* 公開できない理由（ブロッキング）は数だけを琥珀で立てる。 */}
              <FieldCard
                title="ブロッキング"
                tone={summary.unresolved.length > 0 ? 'caution' : 'plain'}
              >
                {summary.blockingLabel}
              </FieldCard>
              <FieldCard title="警告">{summary.warningLabel}</FieldCard>
            </CardGrid>
            {summary.groups.map((group) => (
              <Preview key={group.kind} label={group.label}>
                <b className="block">{group.label}</b>
                <StatePill tone={SEVERITY_TONE[group.severity]}>{group.severityLabel}</StatePill>
                {group.items.map((item) => (
                  <Line key={`${item.kind}-${item.reservationId ?? item.message}`}>
                    {item.message}
                    {/* 群の見出しがすでに重大度を語で示している。差がある
                        項目だけ、行にも語を添える。 */}
                    {item.severity !== group.severity && (
                      <>
                        {' '}
                        <StatePill tone={SEVERITY_TONE[item.severity]}>
                          {IMPACT_SEVERITY_LABEL[item.severity]}
                        </StatePill>
                      </>
                    )}
                    {item.resolution !== null && (
                      <>
                        {' '}
                        <StatePill>{RESOLUTION_LABEL[item.resolution]}</StatePill>
                      </>
                    )}
                    {canManage && item.reservationId !== null && item.resolution === null && (
                      <>
                        {' '}
                        <Action
                          inset="tight"
                          onClick={() => openResolution(item.reservationId ?? '', item.message)}
                        >
                          解消を記録
                        </Action>
                      </>
                    )}
                  </Line>
                ))}
              </Preview>
            ))}
            <Line>{summary.evaluatedAtLabel}</Line>
            {summary.blockedReason !== undefined && (
              <Preview id={BLOCKED_REASON_ID} tone="caution" label="公開できない理由">
                <b className="block">{summary.blockedHeadline}</b>
                {summary.blockedReason}
              </Preview>
            )}
          </>
        )}
      </section>

      {canManage && (
        <Actions gap={2.5} mt={4}>
          {summary !== undefined && summary.unresolved.length > 0 && (
            <Action
              onClick={() => {
                const first = summary.unresolved[0]
                if (first === undefined) return
                openResolution(first.reservationId ?? '', first.message)
              }}
            >
              影響予約を解消
            </Action>
          )}
          <Action onClick={() => void loadImpact()}>影響を再確認</Action>
          {/*
           * 押せないのは事実だが、押せない理由は上の警告面が持っている。
           * `aria-describedby` でその面へ結び付け、読み上げでも理由に届かせる。
           */}
          <Action
            disabled={!canPublish}
            describedBy={summary?.blockedReason === undefined ? undefined : BLOCKED_REASON_ID}
            onClick={() => void publish()}
          >
            公開する
          </Action>
        </Actions>
      )}

      {/* ---------------- 公開結果（承認済みモック #publish-result） ---------------- */}
      {result !== undefined && (
        <Preview label="公開結果">
          <b className="block">{`版 ${result.versionId} の公開結果`}</b>
          <StatePill tone={result.statusTone === 'danger' ? 'danger' : 'caution'}>
            {result.statusLabel}
          </StatePill>
          <Line>{`${result.executedLabel} · ${result.scheduledLabel}`}</Line>
          <CardGrid mt={4}>
            <FieldCard title="成功">{result.appliedLabel}</FieldCard>
            <FieldCard title="失敗" tone={result.failed.length > 0 ? 'error' : 'plain'}>
              {result.failedLabel}
            </FieldCard>
            <FieldCard title="反映確認">
              {/* Web枠と台帳は別々に読ませる。1 行に繋ぐと、どちらが未反映
                  なのかを目で切り分けられない。 */}
              <span className="block">{result.webSlotLabel}</span>
              <span className="block">{result.ledgerLabel}</span>
            </FieldCard>
          </CardGrid>
          {result.applied.length > 0 && (
            <Preview label="反映済みの店舗">
              <b className="block">反映済みの店舗</b>
              {result.applied.map((target) => (
                <Line key={target.storeId}>
                  <span>{target.storeId}</span>
                  <span>{` ・ 第${target.appliedVersion ?? 0}版`}</span>
                </Line>
              ))}
            </Preview>
          )}
          {result.failed.length > 0 && (
            <Preview tone="attention" label="失敗した店舗">
              <b className="block">失敗した店舗</b>
              <Line>{`再試行対象 ${result.retryStoreIds.length}店舗`}</Line>
              {result.failed.map((target) => (
                <Line key={target.storeId}>
                  <b>{target.storeId}</b>
                  <span>{`　${target.failureReason ?? '理由不明'}`}</span>
                  <span>{'　公開未反映'}</span>
                </Line>
              ))}
              {canManage && result.canRetry && (
                <Actions gap={2.5} mt={4}>
                  <Action variant="primary" onClick={() => void postPublication('retry')}>
                    この店舗だけ再試行
                  </Action>
                </Actions>
              )}
            </Preview>
          )}
          {canManage && (result.canCancel || result.canReschedule) && (
            <Actions gap={2.5} mt={4}>
              <Action onClick={() => setRescheduling(true)}>公開予定を変更</Action>
              <Action onClick={() => void postPublication('run')}>今すぐ実行</Action>
              {/* 破棄は既定の見た目にしない。 */}
              <Action
                variant="danger"
                onClick={() => void patchPublication({ status: 'cancelled' })}
              >
                公開予定を取消
              </Action>
            </Actions>
          )}
        </Preview>
      )}

      {/* ---------------- 設定の状態と警告 ---------------- */}
      <Section label="設定の状態">
        <Line>
          <StatePill>{draft === undefined ? '下書きなし' : settingsStateLabel(draft)}</StatePill>{' '}
          <StatePill tone={saveState.dirty ? 'caution' : 'plain'}>{saveState.label}</StatePill>
        </Line>
        <Line>{saveState.savedAtLabel}</Line>
        <Line>{saveState.savedByLabel}</Line>
        {canManage && draft !== undefined && (
          <Actions gap={2.5} mt={4}>
            <Action onClick={() => void saveDraft('draft')}>下書きを保存</Action>
            <Action onClick={() => void saveDraft('review')}>確認へ回す</Action>
          </Actions>
        )}
      </Section>

      {warnings.length > 0 && (
        <Preview tone="caution" label="警告">
          <b className="block">警告</b>
          <Line>競合と失敗は設定の状態ではありません。状態とは別に解消してください。</Line>
          {warnings.map((warning) => (
            <Line key={warning.id}>
              <StatePill tone={warning.tone === 'danger' ? 'danger' : 'caution'}>
                {warning.label}
              </StatePill>
            </Line>
          ))}
        </Preview>
      )}

      {/* ---------------- 適用元 ---------------- */}
      {override !== undefined && (
        <Section label="適用元">
          <Line>
            <StatePill tone={override.origin === 'chain' ? 'plain' : 'caution'}>
              {ORIGIN_LABEL[override.origin]}
            </StatePill>{' '}
            <span>{`全店共通 第${override.chainVersion}版`}</span>
          </Line>
          {override.overriddenFields.length > 0 && (
            <>
              <Line>店舗で上書きしている項目</Line>
              <Line>
                {override.overriddenFields.map((field) => (
                  <span key={field}>
                    <StatePill>{settingsFieldLabel(field)}</StatePill>{' '}
                  </span>
                ))}
              </Line>
            </>
          )}
          {releaseNotice !== undefined && (
            <>
              <Line>
                <b>{releaseNotice.headline}</b>
              </Line>
              <Line>{releaseNotice.detail}</Line>
            </>
          )}
          {canManage && override.origin === 'store_override' && (
            <Actions gap={2.5} mt={4}>
              <Action onClick={() => void releaseOverride()}>店舗上書きを解除</Action>
            </Actions>
          )}
        </Section>
      )}

      {/* ---------------- 公開予約 ---------------- */}
      {canManage && (
        <Section label="公開予約">
          <TextField
            id="publish-schedule"
            label="公開日時（JST）"
            error={scheduleMessage}
            value={scheduleInput}
            placeholder="2026-08-30T18:00"
            onChange={(event) => {
              setScheduleInput(event.target.value)
              setScheduleMessage(undefined)
            }}
          />
          <Line>
            空欄のまま公開すると、その場で適用されます。日時を入れると公開予約になります。
          </Line>
          <Actions gap={2.5} mt={4}>
            <Action disabled={!canPublish} onClick={scheduleAndPublish}>
              公開を予約する
            </Action>
          </Actions>
        </Section>
      )}

      {/* ---------------- 版履歴 ---------------- */}
      <Section label="版履歴">
        {versions.length === 0 ? (
          <Line>公開済みの版はまだありません。</Line>
        ) : (
          versions.map((version) => (
            <Line key={version.versionId}>
              <b>{`第${version.version}版`}</b>
              <span>{`　${formatJstInstant(version.publishedAt)}　`}</span>
              <span>{version.publishedBy}</span>{' '}
              <StatePill>{ORIGIN_LABEL[version.origin]}</StatePill>{' '}
              <Action inset="tight" onClick={() => void openDiff(version.versionId)}>
                版の差分を見る
              </Action>{' '}
              {canManage && (
                <Action inset="tight" onClick={() => void restoreVersion(version.versionId)}>
                  過去版から新しい下書きを作る
                </Action>
              )}
            </Line>
          ))
        )}
        {versionDetail !== undefined && (
          <Card label={`第${versionDetail.version}版の差分`} className="mt-3.5 overflow-x-auto">
            <b className="block">{`第${versionDetail.version}版の差分`}</b>
            <table className="mt-2.5 w-full border-collapse text-left">
              <thead>
                <tr>
                  <th scope="col" className="border border-line p-2.5 font-bold">
                    項目
                  </th>
                  <th scope="col" className="border border-line p-2.5 font-bold">
                    変更前
                  </th>
                  <th scope="col" className="border border-line p-2.5 font-bold">
                    変更後
                  </th>
                </tr>
              </thead>
              <tbody>
                {diffRows(versionDetail).map((row) => (
                  <tr key={row.field}>
                    <th scope="row" className="border border-line p-2.5 text-left font-normal">
                      {row.label}
                    </th>
                    <td className="border border-line p-2.5">{row.before}</td>
                    <td className="border border-line p-2.5">{row.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Line>過去版は直接公開できません。復元すると新しい下書きになります。</Line>
          </Card>
        )}
      </Section>

      {/* ---------------- 手前を塞ぐ確認 ---------------- */}
      {resolving !== undefined && (
        <Modal title="影響予約の解消を記録" titleId={resolveTitleId}>
          <p>{resolving.message}</p>
          <div className="flex flex-col gap-3">
            <SelectField
              id="resolution-kind"
              label="対応"
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
            </SelectField>
            <TextAreaField
              id="resolution-note"
              label="メモ"
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
            />
          </div>
          <Actions gap={2.5} mt={4}>
            <Action onClick={() => setResolving(undefined)}>やめる</Action>
            <Action variant="primary" onClick={() => void recordResolution()}>
              記録する
            </Action>
          </Actions>
        </Modal>
      )}

      {rescheduling && (
        <Modal title="公開予定の変更" titleId={rescheduleTitleId}>
          <TextField
            id="reschedule-input"
            label="新しい公開日時（JST）"
            error={scheduleMessage}
            value={scheduleInput}
            placeholder="2026-08-30T18:00"
            onChange={(event) => {
              setScheduleInput(event.target.value)
              setScheduleMessage(undefined)
            }}
          />
          <Actions gap={2.5} mt={4}>
            <Action onClick={() => setRescheduling(false)}>やめる</Action>
            <Action
              variant="primary"
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
            </Action>
          </Actions>
        </Modal>
      )}
    </>
  )
}
