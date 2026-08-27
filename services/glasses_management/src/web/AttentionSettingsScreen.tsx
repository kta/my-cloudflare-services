import {
  ATTENTION_CAPABILITIES,
  type AttentionCapability,
  type AttentionReviewMode,
  type AttentionRole,
  AttentionSettings,
  type AttentionSettingsInput,
  type AttentionSettingsOrigin,
  type AttentionSharingScope,
  AttentionSharingScopeImpact,
  type StorePermission,
} from '@app/contracts'
import { Button, Card, Notice, Select } from '@app/ui'
import { useEffect, useState } from 'react'
import { AdminCard, AdminCardGrid, AdminScreen, AdminTitle, PermissionDenied } from './admin-chrome'
import {
  attentionCapabilityRows,
  attentionMatrixRows,
  capabilityColumnLabel,
  originLabel,
  roleLabel,
  sharingScopeImpactSummary,
  sharingScopeLabel,
} from './attention-view'
import type { StaffScreenProps } from './staff-screen'

type Props = StaffScreenProps & {
  permissions: StorePermission[]
  /** JST `YYYY-MM-DD`, injected: a screen never reads the clock itself. */
  today: string
  /** Injected instant, for the same reason. */
  now: string
}

const ROLES: AttentionRole[] = ['staff', 'store_manager', 'organization_admin']
const REVIEW_MODES: AttentionReviewMode[] = ['review_required', 'immediate']
const SCOPES: AttentionSharingScope[] = ['permitted_stores', 'chain']

const REVIEW_MODE_LABEL: Record<AttentionReviewMode, string> = {
  review_required: '管理者確認後に公開',
  immediate: '即時公開',
}

const AUDIT_FAILURE =
  '監査記録に残せなかったため、この変更は成立していません。入力はそのまま保持しています。'
const GENERIC_FAILURE = '設定を保存できませんでした。通信を確認してもう一度お試しください。'

type Draft = {
  scope: AttentionSettingsOrigin
  reviewMode: AttentionReviewMode
  sharingScope: AttentionSharingScope
  storeOverrideAllowed: boolean
  capabilities: Record<AttentionCapability, AttentionRole>
}

function draftFrom(settings: AttentionSettings): Draft {
  const capabilities = {} as Record<AttentionCapability, AttentionRole>
  for (const row of attentionCapabilityRows(settings))
    capabilities[row.capability] = row.minimumRole
  return {
    scope: settings.origin,
    reviewMode: settings.reviewMode,
    sharingScope: settings.sharingScope,
    storeOverrideAllowed: settings.storeOverrideAllowed,
    capabilities,
  }
}

function inputFrom(draft: Draft, acknowledged?: number): AttentionSettingsInput {
  return {
    scope: draft.scope,
    reviewMode: draft.reviewMode,
    sharingScope: draft.sharingScope,
    storeOverrideAllowed: draft.storeOverrideAllowed,
    capabilities: ATTENTION_CAPABILITIES.map((capability) => ({
      capability,
      minimumRole: draft.capabilities[capability],
    })),
    ...(acknowledged === undefined ? {} : { acknowledgedAffectedNoteCount: acknowledged }),
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function errorCode(body: unknown): string {
  return typeof body === 'object' && body !== null && 'error' in body
    ? String((body as { error?: unknown }).error ?? '')
    : ''
}

/**
 * 注意事項の権限設定 (UC-EYEX-139〜142, AC-EYEX-84, AC-EYEX-118).
 *
 * 組織共通値と店舗上書きのどちらを書くかは操作者が選び、いま効いている値の
 * 適用元は常に表に出る。共有範囲だけは既存情報を動かすので、影響件数を見せて
 * 承認を取るまで書き込みへ進まない。
 */
export function AttentionSettingsScreen({ storeId, api, permissions, navigate }: Props) {
  const mayRead = permissions.includes('attention.read')
  const mayManage = permissions.includes('settings.manage')
  const [settings, setSettings] = useState<AttentionSettings>()
  const [draft, setDraft] = useState<Draft>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [retryable, setRetryable] = useState(false)
  const [pending, setPending] = useState<AttentionSharingScopeImpact>()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!mayRead) return undefined
    let active = true
    void (async () => {
      const response = await api(
        `/api/staff/stores/${encodeURIComponent(storeId)}/attention-settings`,
      )
      const parsed = response.ok ? AttentionSettings.safeParse(await readJson(response)) : undefined
      if (!active) return
      if (!parsed?.success) {
        setLoadFailed(true)
        return
      }
      setSettings(parsed.data)
      setDraft(draftFrom(parsed.data))
    })().catch(() => {
      if (active) setLoadFailed(true)
    })
    return () => {
      active = false
    }
  }, [api, mayRead, storeId])

  // 閲覧権限が無い操作者には、制限情報の存在そのものを示さない。副タブも節も
  // 出さないのは、そこに並ぶ言葉自体が設定の存在を語ってしまうため。
  if (!mayRead) return <PermissionDenied onReturnHome={() => navigate({ screen: 'home' })} />

  const put = async (input: AttentionSettingsInput) => {
    if (submitting) return
    setSubmitting(true)
    setSaved(false)
    setFailure(undefined)
    setRetryable(false)
    try {
      const response = await api(
        `/api/staff/stores/${encodeURIComponent(storeId)}/attention-settings`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
      )
      const body = await readJson(response)
      if (response.ok) {
        const parsed = AttentionSettings.safeParse(body)
        if (!parsed.success) {
          setFailure(GENERIC_FAILURE)
          setRetryable(true)
          return
        }
        setSettings(parsed.data)
        setDraft(draftFrom(parsed.data))
        setPending(undefined)
        setSaved(true)
        return
      }
      const code = errorCode(body)
      if (code === 'sharing_scope_impact_unacknowledged') {
        const impact =
          typeof body === 'object' && body !== null && 'impact' in body
            ? AttentionSharingScopeImpact.safeParse((body as { impact: unknown }).impact)
            : undefined
        if (impact?.success) {
          setPending(impact.data)
          return
        }
      }
      if (code === 'audit_append_failed') {
        setFailure(AUDIT_FAILURE)
        setRetryable(true)
        return
      }
      if (code === 'forbidden') {
        setFailure('この店舗の設定を変更する権限がありません。')
        return
      }
      setFailure(GENERIC_FAILURE)
      setRetryable(true)
    } catch {
      setFailure(GENERIC_FAILURE)
      setRetryable(true)
    } finally {
      setSubmitting(false)
    }
  }

  const save = async () => {
    if (!draft || !settings) return
    setSaved(false)
    if (draft.sharingScope === settings.sharingScope) {
      await put(inputFrom(draft))
      return
    }
    // 共有範囲を動かす前に、何件がどこへ動くかを必ず見せる (AC-EYEX-118).
    setFailure(undefined)
    setRetryable(false)
    const response = await api(
      `/api/staff/stores/${encodeURIComponent(storeId)}/attention-settings/sharing-scope-impact`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestedScope: draft.sharingScope }),
      },
    )
    const parsed = response.ok
      ? AttentionSharingScopeImpact.safeParse(await readJson(response))
      : undefined
    if (!parsed?.success) {
      setFailure('共有範囲の影響を確認できませんでした。もう一度お試しください。')
      setRetryable(false)
      return
    }
    setPending(parsed.data)
  }

  const retry = () => {
    if (!draft) return
    void put(inputFrom(draft, pending?.affectedNoteCount))
  }

  const capabilityRows = settings ? attentionCapabilityRows(settings) : []

  return (
    /* 承認済みモック `operations-approved.html#attention-settings` /
       `ATTENTION-PERMISSIONS--default--ipad-landscape.png`。 */
    <AdminScreen
      label="注意事項の権限"
      navigate={navigate}
      sectionsLabel="注意事項の節"
      activeSection="権限"
      sections={[
        { label: '権限', to: { screen: 'attention-settings' } },
        { label: '確認待ち' },
        { label: '共有範囲' },
        { label: '入力ルール' },
      ]}
    >
      <AdminTitle>
        <h2 className="font-display font-semibold text-2xl text-ink">注意事項の権限</h2>
        <div className="ml-auto">
          {settings && draft && mayManage ? (
            /* モックの `.state` と同じ位置（見出しと同じ行の右端）に置くので、
               可視ラベルは重ねず名前は控えめに持たせる。 */
            <Select
              id="attention-scope"
              aria-label="設定範囲"
              className="min-h-12"
              value={draft.scope}
              onChange={(event) =>
                setDraft({ ...draft, scope: event.target.value as AttentionSettingsOrigin })
              }
            >
              <option value="organization">組織共通値</option>
              <option value="store">店舗上書き</option>
            </Select>
          ) : (
            settings && (
              <span className="inline-block rounded-pill bg-pine-soft px-2.25 py-1 font-sans font-bold text-pine text-sm">
                {`${originLabel(settings.origin)}値`}
              </span>
            )
          )}
        </div>
      </AdminTitle>

      <div className="mt-3 flex flex-col gap-3">
        {loadFailed && <Notice tone="danger">設定を読み込めませんでした。</Notice>}
        {saved && <Notice tone="success">設定を保存しました。</Notice>}
        {failure && <Notice tone="danger">{failure}</Notice>}
        {failure && retryable && (
          <div>
            <Button type="button" className="min-h-12" onClick={retry}>
              再試行する
            </Button>
          </div>
        )}
        {!mayManage && <Notice tone="info">この店舗の設定を変更する権限がありません。</Notice>}
      </div>

      {settings && draft && (
        <>
          {/* 列が増えるとロールの Select が「店舗管理者以.」まで潰れる。表は
              縮めず、必要なら横スクロールで逃がす。 */}
          <div className="mt-4 overflow-x-auto">
            <table
              aria-label="注意事項の権限"
              className="w-full min-w-4xl border-collapse bg-surface text-center"
            >
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="border border-line p-2.5 text-left font-sans font-semibold text-ink text-sm"
                  >
                    ロール
                  </th>
                  {capabilityRows.map((row) => (
                    <th
                      key={row.capability}
                      scope="col"
                      className="border border-line p-2.5 font-sans font-semibold text-ink text-sm"
                    >
                      {capabilityColumnLabel(row.capability)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attentionMatrixRows(settings).map((row) => (
                  <tr key={row.role}>
                    <th
                      scope="row"
                      className="border border-line p-2.5 text-left font-sans font-medium text-ink text-sm"
                    >
                      {row.label}
                    </th>
                    {row.cells.map((cell) => (
                      <td
                        key={cell.capability}
                        className={`border border-line p-2.5 font-sans text-sm ${
                          cell.allowed ? 'font-bold text-pine' : 'text-ink'
                        }`}
                      >
                        {cell.label}
                      </td>
                    ))}
                  </tr>
                ))}
                {/* いま効いている値の適用元と、それを動かすコントロールは表の中に
                  置く。別の場所へ離すと「どの列の話か」が読み取れない。 */}
                <tr>
                  <th
                    scope="row"
                    className="border border-line p-2.5 text-left font-sans font-medium text-ink text-sm"
                  >
                    適用元
                  </th>
                  {capabilityRows.map((row) => (
                    <td
                      key={row.capability}
                      className="border border-line p-2.5 font-sans text-ink-muted text-sm"
                    >
                      {row.originLabel}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th
                    scope="row"
                    className="border border-line p-2.5 text-left font-sans font-medium text-ink text-sm"
                  >
                    必要なロール
                  </th>
                  {capabilityRows.map((row) => (
                    <td key={row.capability} className="border border-line p-2.5">
                      <Select
                        aria-label={`${row.label}に必要なロール`}
                        className="min-h-12"
                        disabled={!mayManage}
                        value={draft.capabilities[row.capability]}
                        onChange={(event) => {
                          const minimumRole = event.target.value as AttentionRole
                          setDraft({
                            ...draft,
                            capabilities: { ...draft.capabilities, [row.capability]: minimumRole },
                          })
                        }}
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {roleLabel(role)}以上
                          </option>
                        ))}
                      </Select>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <AdminCardGrid>
            <AdminCard title="登録方式">
              {mayManage ? (
                <Select
                  id="attention-review-mode"
                  aria-label="公開方式"
                  className="min-h-12"
                  value={draft.reviewMode}
                  onChange={(event) =>
                    setDraft({ ...draft, reviewMode: event.target.value as AttentionReviewMode })
                  }
                >
                  {REVIEW_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {REVIEW_MODE_LABEL[mode]}
                    </option>
                  ))}
                </Select>
              ) : (
                REVIEW_MODE_LABEL[settings.reviewMode]
              )}
            </AdminCard>
            <AdminCard title="共有範囲" label="共有範囲の設定">
              {mayManage ? (
                <Select
                  id="attention-sharing-scope"
                  aria-label="共有範囲"
                  className="min-h-12"
                  value={draft.sharingScope}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      sharingScope: event.target.value as AttentionSharingScope,
                    })
                  }
                >
                  {SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {sharingScopeLabel(scope)}
                    </option>
                  ))}
                </Select>
              ) : (
                sharingScopeLabel(settings.sharingScope)
              )}
            </AdminCard>
            <AdminCard title="店舗上書き">
              <label className="flex min-h-12 items-center gap-3 font-sans text-ink text-sm">
                <input
                  type="checkbox"
                  className="size-6"
                  disabled={!mayManage}
                  checked={draft.storeOverrideAllowed}
                  onChange={(event) =>
                    setDraft({ ...draft, storeOverrideAllowed: event.target.checked })
                  }
                />
                店舗ごとの上書きを許可する
              </label>
            </AdminCard>
          </AdminCardGrid>

          <Card className="mt-4 flex flex-col gap-2">
            <h3 className="font-sans font-semibold text-ink text-sm">入力時の案内</h3>
            <p className="font-sans text-ink-muted text-sm">
              記録する: {settings.guidance.record.join('・')}
            </p>
            <p className="font-sans text-ink-muted text-sm">
              記録しない: {settings.guidance.avoid.join('・')}
            </p>
          </Card>

          {mayManage && (
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                className="min-h-12"
                disabled={submitting}
                onClick={() => {
                  void save()
                }}
              >
                設定を保存する
              </Button>
            </div>
          )}
        </>
      )}

      {pending && draft && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="attention-scope-title"
          className="fixed inset-0 flex items-center justify-center bg-ink/40 p-6"
        >
          <Card className="flex w-full max-w-xl flex-col gap-4">
            <h2 id="attention-scope-title" className="font-display font-semibold text-ink text-xl">
              共有範囲の変更を確認
            </h2>
            <p className="font-sans text-ink text-sm">{sharingScopeImpactSummary(pending)}</p>
            <dl className="grid grid-cols-3 gap-3">
              <div>
                <dt className="font-sans text-ink-muted text-xs">注意事項</dt>
                <dd className="font-sans text-ink text-lg">{pending.affectedNoteCount}件</dd>
              </div>
              <div>
                <dt className="font-sans text-ink-muted text-xs">顧客</dt>
                <dd className="font-sans text-ink text-lg">{pending.affectedCustomerCount}人</dd>
              </div>
              <div>
                <dt className="font-sans text-ink-muted text-xs">店舗</dt>
                <dd className="font-sans text-ink text-lg">{pending.affectedStoreCount}店舗</dd>
              </div>
            </dl>
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                className="min-h-12"
                onClick={() => {
                  setPending(undefined)
                  setDraft(draftFrom(settings as AttentionSettings))
                }}
              >
                キャンセル
              </Button>
              <Button
                type="button"
                className="min-h-12"
                disabled={submitting}
                onClick={() => {
                  void put(inputFrom(draft, pending.affectedNoteCount))
                }}
              >
                影響を確認して変更する
              </Button>
            </div>
          </Card>
        </div>
      )}
    </AdminScreen>
  )
}
