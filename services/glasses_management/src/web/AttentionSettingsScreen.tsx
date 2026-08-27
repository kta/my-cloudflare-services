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
import { useEffect, useState } from 'react'
import { PermissionDenied } from './admin-chrome'
import {
  attentionCapabilityRows,
  attentionMatrixRows,
  capabilityColumnLabel,
  originLabel,
  roleLabel,
  sharingScopeImpactSummary,
  sharingScopeLabel,
} from './attention-view'
import { Action, Actions } from './design/controls'
import { Modal } from './design/dialogs'
import { CheckToggle, PickerField } from './design/forms'
import { AdminLayout, AdminSurface } from './design/layouts'
import { MatrixCell, MatrixRow, MatrixTable } from './design/matrix'
import { FailureNotice, StatusNotice } from './design/notices'
import { Card, CardGrid, StatePill, TitleRow } from './design/surfaces'
import type { StaffLocation } from './staff-navigation'
import type { StaffScreenProps } from './staff-screen'

/** 節ナビ。モック `operations-approved.html#attention-settings` の 4 つと、その順序。 */
const SECTIONS: { label: string; to?: StaffLocation }[] = [
  { label: '権限', to: { screen: 'attention-settings' } },
  { label: '確認待ち' },
  { label: '共有範囲' },
  { label: '入力ルール' },
]

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

/* 選択肢は描く場所ではなくここで組む。値は契約の文字列そのままで、
   画面が持つのは「その値を日本語で何と呼ぶか」だけ。 */
const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: `${roleLabel(role)}以上` }))
const REVIEW_MODE_OPTIONS = REVIEW_MODES.map((mode) => ({
  value: mode,
  label: REVIEW_MODE_LABEL[mode],
}))
const SCOPE_OPTIONS = SCOPES.map((scope) => ({
  value: scope,
  label: sharingScopeLabel(scope),
}))
const SCOPE_ORIGIN_OPTIONS: { value: AttentionSettingsOrigin; label: string }[] = [
  { value: 'organization', label: '組織共通値' },
  { value: 'store', label: '店舗上書き' },
]

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
    <AdminSurface label="注意事項の権限">
      <AdminLayout
        /*
         * 柱は全画面共通の 1 本しかないので、この面の節はそこへ渡す。
         * 別の面への移動はサイドバーが持つので、ここでは並べない。
         */
        sections={SECTIONS.map((section) => ({
          ...section,
          current: section.label === '権限',
        }))}
      >
        <TitleRow
          gap={0}
          /* モックの右上は緑の状態ピルだけ（`ATTENTION-PERMISSIONS` の
             `組織共通値`）。ここで設定範囲を変えさせると、読む面の右上に
             書き換えの操作が紛れる。設定範囲はカードとして表の下へ置く。 */
          push={settings && <StatePill>{`${originLabel(settings.origin)}値`}</StatePill>}
        >
          {/* `.title h2{margin:0}` — 表がすぐ下に続くので既定の余白を落とす。 */}
          <h1 className="my-0">注意事項の権限</h1>
        </TitleRow>

        {loadFailed && <FailureNotice>設定を読み込めませんでした。</FailureNotice>}
        {saved && <StatusNotice>設定を保存しました。</StatusNotice>}
        {failure && <FailureNotice>{failure}</FailureNotice>}
        {failure && retryable && (
          <Actions>
            <Action inset="tight" onClick={retry}>
              再試行する
            </Action>
          </Actions>
        )}
        {!mayManage && <StatusNotice>この店舗の設定を変更する権限がありません。</StatusNotice>}

        {settings && draft && (
          <>
            {/*
              表は「いまどうなっているか」を読む面に戻す。操作をセルへ入れると、
              5 つの選択が列幅を押し広げて表が枠からはみ出し、右端の選択が
              「店舗管理者以」で切れていた（承認済みモックの表も読み取り専用）。
              変えるための操作は表の下へ、1 操作 1 枚のカードとして出す。
            */}
            <MatrixTable
              label="注意事項の権限"
              columns={[
                'ロール',
                ...capabilityRows.map((row) => capabilityColumnLabel(row.capability)),
              ]}
            >
              {attentionMatrixRows(settings).map((row) => (
                <MatrixRow key={row.role} header={row.label}>
                  {row.cells.map((cell) => (
                    <MatrixCell key={cell.capability} granted={cell.allowed}>
                      {cell.label}
                    </MatrixCell>
                  ))}
                </MatrixRow>
              ))}
              {/* いま効いている値の適用元は表の中に置く。別の場所へ離すと
                  「どの列の話か」が読み取れない。 */}
              <MatrixRow header="適用元">
                {capabilityRows.map((row) => (
                  <MatrixCell key={row.capability}>{row.originLabel}</MatrixCell>
                ))}
              </MatrixRow>
            </MatrixTable>

            <CardGrid>
              {capabilityRows.map((row) => (
                /* カードに読み上げ用の名前は付けない。付けると中の選択と
                   同じ名前の要素が 2 つになり、「公開に必要なロール」で
                   指したときにどちらを指したのかが決まらなくなる。 */
                <Card key={row.capability}>
                  <b>{row.label}</b>
                  <br />
                  {mayManage ? (
                    <PickerField
                      hideLabel
                      id={`attention-role-${row.capability}`}
                      label={`${row.label}に必要なロール`}
                      value={draft.capabilities[row.capability]}
                      options={ROLE_OPTIONS}
                      onChange={(next) =>
                        setDraft({
                          ...draft,
                          capabilities: {
                            ...draft.capabilities,
                            [row.capability]: next as AttentionRole,
                          },
                        })
                      }
                    />
                  ) : (
                    `${row.roleLabel}以上`
                  )}
                  <br />
                  <small>適用元: {row.originLabel}</small>
                </Card>
              ))}
            </CardGrid>

            <CardGrid>
              <Card label="登録方式">
                <b>登録方式</b>
                <br />
                {mayManage ? (
                  <PickerField
                    hideLabel
                    id="attention-review-mode"
                    label="公開方式"
                    value={draft.reviewMode}
                    options={REVIEW_MODE_OPTIONS}
                    onChange={(next) =>
                      setDraft({ ...draft, reviewMode: next as AttentionReviewMode })
                    }
                  />
                ) : (
                  REVIEW_MODE_LABEL[settings.reviewMode]
                )}
              </Card>
              <Card label="共有範囲の設定">
                <b>共有範囲</b>
                <br />
                {mayManage ? (
                  <PickerField
                    hideLabel
                    id="attention-sharing-scope"
                    label="共有範囲"
                    value={draft.sharingScope}
                    options={SCOPE_OPTIONS}
                    onChange={(next) =>
                      setDraft({ ...draft, sharingScope: next as AttentionSharingScope })
                    }
                  />
                ) : (
                  sharingScopeLabel(settings.sharingScope)
                )}
              </Card>
              <Card label="設定範囲の選択">
                <b>設定範囲</b>
                <br />
                {mayManage ? (
                  <PickerField
                    hideLabel
                    id="attention-scope"
                    label="設定範囲"
                    value={draft.scope}
                    options={SCOPE_ORIGIN_OPTIONS}
                    onChange={(next) =>
                      setDraft({ ...draft, scope: next as AttentionSettingsOrigin })
                    }
                  />
                ) : (
                  `${originLabel(settings.origin)}値`
                )}
              </Card>
              <Card label="店舗上書き">
                <b>店舗上書き</b>
                <br />
                <span className="flex min-h-12 items-center gap-3">
                  <CheckToggle
                    labelledBy="attention-store-override"
                    disabled={!mayManage}
                    checked={draft.storeOverrideAllowed}
                    onChange={(storeOverrideAllowed) =>
                      setDraft({ ...draft, storeOverrideAllowed })
                    }
                  />
                  <span id="attention-store-override">店舗ごとの上書きを許可する</span>
                </span>
              </Card>
            </CardGrid>

            <div className="mt-4">
              <Card label="入力時の案内">
                <b>入力時の案内</b>
                <br />
                記録する: {settings.guidance.record.join('・')}
                <br />
                記録しない: {settings.guidance.avoid.join('・')}
              </Card>
            </div>

            {mayManage && (
              <Actions>
                <Action
                  variant="primary"
                  inset="tight"
                  disabled={submitting}
                  onClick={() => {
                    void save()
                  }}
                >
                  設定を保存する
                </Action>
              </Actions>
            )}
          </>
        )}
      </AdminLayout>

      {pending && draft && (
        <Modal titleId="attention-scope-title" title="共有範囲の変更を確認">
          <p>{sharingScopeImpactSummary(pending)}</p>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <dt>注意事項</dt>
              {/* 件数は桁で読む。等幅は数字にだけ使う。 */}
              <dd className="font-record text-grid">{pending.affectedNoteCount}件</dd>
            </div>
            <div>
              <dt>顧客</dt>
              <dd className="font-record text-grid">{pending.affectedCustomerCount}人</dd>
            </div>
            <div>
              <dt>店舗</dt>
              <dd className="font-record text-grid">{pending.affectedStoreCount}店舗</dd>
            </div>
          </dl>
          <Actions>
            <Action
              inset="tight"
              onClick={() => {
                setPending(undefined)
                setDraft(draftFrom(settings as AttentionSettings))
              }}
            >
              キャンセル
            </Action>
            <Action
              variant="primary"
              inset="tight"
              disabled={submitting}
              onClick={() => {
                void put(inputFrom(draft, pending.affectedNoteCount))
              }}
            >
              影響を確認して変更する
            </Action>
          </Actions>
        </Modal>
      )}
    </AdminSurface>
  )
}
