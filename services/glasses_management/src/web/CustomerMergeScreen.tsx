import {
  type CustomerLinkReleaseInput,
  CustomerLinkReleaseResult,
  CustomerMergeImpact,
  CustomerMergePreview,
  CustomerMergeResult,
  type CustomerMergeSummary,
  type StorePermission,
} from '@app/contracts'
import { Field, Select, Textarea, TextInput } from '@app/ui'
import { useState } from 'react'
import { mergeImpactRows, mergeImpactTotal } from './attention-view'
import { Action, Actions } from './design/controls'
import { Modal } from './design/dialogs'
import { Compare, FullScreenState } from './design/layouts'
import { FailureNotice, StatusNotice } from './design/notices'
import { Card, CardGrid, FieldCard } from './design/surfaces'
import type { StaffScreenProps } from './staff-screen'

type Props = StaffScreenProps & {
  permissions: StorePermission[]
  /** JST `YYYY-MM-DD`, injected: a screen never reads the clock itself. */
  today: string
  /** Injected instant, for the same reason. */
  now: string
}

const AUDIT_FAILURE =
  '監査記録に残せなかったため、この操作は成立していません。入力はそのまま保持しています。'
const GENERIC_FAILURE = '操作を完了できませんでした。通信を確認してもう一度お試しください。'
const REASON_REQUIRED = '理由を入力してください。'
const IMPACT_CHANGED = '影響件数が変わりました。最新の影響を確認してからもう一度実行してください。'

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

function impactFrom(body: unknown): CustomerMergeImpact | undefined {
  if (typeof body !== 'object' || body === null || !('impact' in body)) return undefined
  const parsed = CustomerMergeImpact.safeParse((body as { impact: unknown }).impact)
  return parsed.success ? parsed.data : undefined
}

/**
 * 突き合わせる 1 人（モックの `.card`）。段落ではなく行で継ぐのは、`<p>` の
 * 上下 1em がカードの高さを 2 人ぶん別々に押し広げてしまうため。
 */
function SummaryCard({ title, summary }: { title: string; summary: CustomerMergeSummary }) {
  return (
    <Card label={title}>
      <b>{title}</b>
      <br />
      {summary.name}
      <br />
      <small>{summary.kana}</small>
      <br />
      <span>{summary.phone}</span>
      <br />
      <small>{`来店 ${summary.visitCount}回`}</small>
      <br />
      {/* 顧客IDは読む値ではなく照合する値なので、桁の揃う等幅で置く。 */}
      <small className="font-figure">{summary.customerId}</small>
    </Card>
  )
}

/**
 * 顧客の重複統合・誤関連解除 (UC-EYEX-181, AC-EYEX-121).
 *
 * 比較は何も動かさない。統合も解除も、影響を見たうえでの明示操作と理由が
 * 揃って初めて実行され、自動判定はどこにも無い。
 */
export function CustomerMergeScreen({ storeId, api, permissions, navigate }: Props) {
  const mayCorrect =
    permissions.includes('customer.read') &&
    permissions.includes('customer.write') &&
    permissions.includes('customer.history')

  const [primaryId, setPrimaryId] = useState('')
  const [duplicateId, setDuplicateId] = useState('')
  const [preview, setPreview] = useState<CustomerMergePreview>()
  const [mergeReason, setMergeReason] = useState('')
  const [confirmingMerge, setConfirmingMerge] = useState(false)
  const [mergeReasonError, setMergeReasonError] = useState<string>()

  const [entryType, setEntryType] = useState<CustomerLinkReleaseInput['entryType']>('reservation')
  const [entryId, setEntryId] = useState('')
  const [releaseReason, setReleaseReason] = useState('')
  const [confirmingRelease, setConfirmingRelease] = useState(false)
  const [releaseReasonError, setReleaseReasonError] = useState<string>()

  const [success, setSuccess] = useState<string>()
  const [failure, setFailure] = useState<string>()
  const [retry, setRetry] = useState<() => void>()

  // 権限が無い操作者には、顧客の統合・訂正の存在も内容も見せない
  // (`exception-states-approved.html#permission-denied`)。
  if (!mayCorrect)
    return (
      <FullScreenState glyph="—" title="この設定を表示する権限がありません">
        <p>権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。</p>
        <Action size="roomy" variant="primary" onClick={() => navigate({ screen: 'home' })}>
          業務開始画面へ戻る
        </Action>
      </FullScreenState>
    )

  const reset = () => {
    setSuccess(undefined)
    setFailure(undefined)
    setRetry(undefined)
  }

  const comparePair = () => {
    reset()
    void (async () => {
      const response = await api(
        `/api/staff/stores/${encodeURIComponent(storeId)}/customer-merges/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            primaryCustomerId: primaryId.trim(),
            duplicateCustomerId: duplicateId.trim(),
          }),
        },
      )
      const parsed = response.ok
        ? CustomerMergePreview.safeParse(await readJson(response))
        : undefined
      if (!parsed?.success) {
        setPreview(undefined)
        setFailure('重複候補を比較できませんでした。顧客IDを確認してください。')
        return
      }
      setPreview(parsed.data)
    })().catch(() => {
      setFailure(GENERIC_FAILURE)
    })
  }

  const runMerge = (current: CustomerMergePreview, reason: string) => {
    const total = mergeImpactTotal(current.impact)
    const attempt = () => {
      reset()
      void (async () => {
        const response = await api(
          `/api/staff/stores/${encodeURIComponent(storeId)}/customer-merges`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              primaryCustomerId: current.primary.customerId,
              duplicateCustomerId: current.duplicate.customerId,
              reason,
              acknowledgedImpactTotal: total,
            }),
          },
        )
        const body = await readJson(response)
        if (response.ok && CustomerMergeResult.safeParse(body).success) {
          setConfirmingMerge(false)
          setMergeReason('')
          setPreview(undefined)
          setSuccess('統合しました。実行者・日時・変更前後を監査記録に残しました。')
          return
        }
        const code = errorCode(body)
        if (code === 'merge_impact_unacknowledged') {
          const latest = impactFrom(body)
          if (latest) setPreview({ ...current, impact: latest })
          setConfirmingMerge(false)
          setFailure(IMPACT_CHANGED)
          return
        }
        if (code === 'customer_already_merged') {
          setPreview({ ...current, alreadyMerged: true })
          setConfirmingMerge(false)
          setFailure('この顧客はすでに統合されています。')
          return
        }
        setFailure(code === 'audit_append_failed' ? AUDIT_FAILURE : GENERIC_FAILURE)
        setRetry(() => attempt)
      })().catch(() => {
        setFailure(GENERIC_FAILURE)
        setRetry(() => attempt)
      })
    }
    attempt()
  }

  const confirmMerge = () => {
    if (!preview) return
    const reason = mergeReason.trim()
    if (reason === '') {
      setMergeReasonError(REASON_REQUIRED)
      return
    }
    setMergeReasonError(undefined)
    runMerge(preview, reason)
  }

  const runRelease = (reason: string) => {
    const attempt = () => {
      reset()
      void (async () => {
        const response = await api(
          `/api/staff/stores/${encodeURIComponent(storeId)}/customer-links/release`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ entryType, entryId: entryId.trim(), reason }),
          },
        )
        const body = await readJson(response)
        if (response.ok && CustomerLinkReleaseResult.safeParse(body).success) {
          setConfirmingRelease(false)
          setReleaseReason('')
          setEntryId('')
          setSuccess('顧客との関連を解除しました。実行者・日時・変更前後を監査記録に残しました。')
          return
        }
        const code = errorCode(body)
        if (code === 'link_already_released') {
          setConfirmingRelease(false)
          setFailure('この受付にはすでに顧客が関連づけられていません。')
          return
        }
        setFailure(code === 'audit_append_failed' ? AUDIT_FAILURE : GENERIC_FAILURE)
        setRetry(() => attempt)
      })().catch(() => {
        setFailure(GENERIC_FAILURE)
        setRetry(() => attempt)
      })
    }
    attempt()
  }

  const confirmRelease = () => {
    const reason = releaseReason.trim()
    if (reason === '') {
      setReleaseReasonError(REASON_REQUIRED)
      return
    }
    setReleaseReasonError(undefined)
    runRelease(reason)
  }

  return (
    /* 運用モックの本文（`.content{padding:24px 30px}`）。 */
    <main className="px-7.5 py-6 font-sans">
      <h1>顧客の重複と誤関連</h1>

      {success && <StatusNotice>{success}</StatusNotice>}
      {failure && (
        <FailureNotice>
          {failure}
          {retry && (
            <Actions mt={4}>
              <Action
                onClick={() => {
                  retry()
                }}
              >
                再試行する
              </Action>
            </Actions>
          )}
        </FailureNotice>
      )}

      <Card className="mt-4.5" label="重複候補を比較">
        <b>重複候補を比較</b>
        <br />
        比較しただけでは何も変わりません。統合は明示的に実行したときだけ行われます。
        <div className="mt-3.5 grid grid-cols-2 gap-3">
          <Field label="残す顧客ID" htmlFor="merge-primary">
            <TextInput
              id="merge-primary"
              className="min-h-12"
              value={primaryId}
              onChange={(event) => setPrimaryId(event.target.value)}
            />
          </Field>
          <Field label="重複している顧客ID" htmlFor="merge-duplicate">
            <TextInput
              id="merge-duplicate"
              className="min-h-12"
              value={duplicateId}
              onChange={(event) => setDuplicateId(event.target.value)}
            />
          </Field>
        </div>
        <Actions mt={4}>
          <Action onClick={comparePair}>重複候補を比較する</Action>
        </Actions>
      </Card>

      {preview && (
        <>
          <section aria-label="重複候補の比較" className="mt-4.5">
            <Compare>
              <SummaryCard title="残す顧客" summary={preview.primary} />
              <SummaryCard title="重複している顧客" summary={preview.duplicate} />
            </Compare>
          </section>

          <section aria-label="統合の影響" className="mt-4.5">
            <p>統合すると、次の履歴が残す顧客へ移ります。</p>
            <CardGrid>
              {mergeImpactRows(preview.impact).map((row) => (
                <FieldCard key={row.key} title={row.label}>
                  {`${row.count}件`}
                </FieldCard>
              ))}
            </CardGrid>
            <p>
              <b>{`合計 ${mergeImpactTotal(preview.impact)}件`}</b>
            </p>
            {preview.alreadyMerged ? (
              <StatusNotice>この顧客はすでに統合されています。</StatusNotice>
            ) : (
              <Actions>
                {/* 統合は元へ戻せない。既定の見た目にしない。 */}
                <Action
                  variant="danger"
                  onClick={() => {
                    setMergeReasonError(undefined)
                    setConfirmingMerge(true)
                  }}
                >
                  統合する
                </Action>
              </Actions>
            )}
          </section>
        </>
      )}

      <Card className="mt-4.5" label="誤った顧客関連を解除">
        <b>誤った顧客関連を解除</b>
        <div className="mt-3.5 grid grid-cols-2 gap-3">
          <Field label="受付種別" htmlFor="release-entry-type">
            <Select
              id="release-entry-type"
              className="min-h-12"
              value={entryType}
              onChange={(event) =>
                setEntryType(event.target.value as CustomerLinkReleaseInput['entryType'])
              }
            >
              <option value="reservation">予約</option>
              <option value="walkin">ウォークイン</option>
            </Select>
          </Field>
          <Field label="受付ID" htmlFor="release-entry-id">
            <TextInput
              id="release-entry-id"
              className="min-h-12"
              value={entryId}
              onChange={(event) => setEntryId(event.target.value)}
            />
          </Field>
        </div>
        <Actions mt={4}>
          <Action
            variant="danger"
            onClick={() => {
              setReleaseReasonError(undefined)
              setConfirmingRelease(true)
            }}
          >
            誤関連を解除する
          </Action>
        </Actions>
      </Card>

      {confirmingMerge && preview && (
        <Modal urgent titleId="merge-confirm-title" title="顧客の統合を確認">
          <p>
            {`${mergeImpactTotal(preview.impact)}件の履歴が残す顧客へ移ります。統合は自動では行われず、実行者・日時・変更前後が監査記録に残ります。`}
          </p>
          <Field label="統合する理由" htmlFor="merge-reason" error={mergeReasonError}>
            <Textarea
              id="merge-reason"
              rows={2}
              value={mergeReason}
              onChange={(event) => setMergeReason(event.target.value)}
            />
          </Field>
          <Actions>
            <Action size="roomy" onClick={() => setConfirmingMerge(false)}>
              キャンセル
            </Action>
            <Action size="roomy" variant="danger" onClick={confirmMerge}>
              統合を実行する
            </Action>
          </Actions>
        </Modal>
      )}

      {confirmingRelease && (
        <Modal urgent titleId="release-confirm-title" title="誤った顧客関連の解除を確認">
          <p>
            この受付から顧客との関連だけを外します。受付そのものは残り、実行者・日時・変更前後が監査記録に残ります。
          </p>
          <Field label="解除する理由" htmlFor="release-reason" error={releaseReasonError}>
            <Textarea
              id="release-reason"
              rows={2}
              value={releaseReason}
              onChange={(event) => setReleaseReason(event.target.value)}
            />
          </Field>
          <Actions>
            <Action size="roomy" onClick={() => setConfirmingRelease(false)}>
              キャンセル
            </Action>
            <Action size="roomy" variant="danger" onClick={confirmRelease}>
              解除を実行する
            </Action>
          </Actions>
        </Modal>
      )}
    </main>
  )
}
