import {
  type CustomerLinkReleaseInput,
  CustomerLinkReleaseResult,
  CustomerMergeImpact,
  CustomerMergePreview,
  CustomerMergeResult,
  type CustomerMergeSummary,
  type StorePermission,
} from '@app/contracts'
import { Button, Card, Field, Notice, Select, Textarea, TextInput } from '@app/ui'
import { type ReactNode, useState } from 'react'
import { PermissionDenied } from './admin-chrome'
import { mergeImpactRows, mergeImpactTotal } from './attention-view'
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

function SummaryCard({ title, summary }: { title: string; summary: CustomerMergeSummary }) {
  return (
    <div className="flex flex-col gap-1 rounded-ctl border border-line p-4">
      <p className="font-sans font-semibold text-ink-muted text-xs">{title}</p>
      <p className="font-sans font-medium text-ink">{summary.name}</p>
      <p className="font-sans text-ink-muted text-sm">{summary.kana}</p>
      <p className="font-sans text-ink text-sm">{summary.phone}</p>
      <p className="font-sans text-ink-muted text-sm">来店 {summary.visitCount}回</p>
      <p className="font-mono text-ink-muted text-xs">{summary.customerId}</p>
    </div>
  )
}

function Modal({
  titleId,
  title,
  children,
}: {
  titleId: string
  title: string
  children: ReactNode
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-ink/40 p-6"
    >
      <Card className="flex w-full max-w-xl flex-col gap-4">
        <h2 id={titleId} className="font-display font-semibold text-ink text-xl">
          {title}
        </h2>
        {children}
      </Card>
    </div>
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
  if (!mayCorrect) return <PermissionDenied onReturnHome={() => navigate({ screen: 'home' })} />

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
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
      <h1 className="font-display font-semibold text-2xl text-ink">顧客の重複と誤関連</h1>

      {success && <Notice tone="success">{success}</Notice>}
      {failure && <Notice tone="danger">{failure}</Notice>}
      {failure && retry && (
        <div>
          <Button
            type="button"
            className="min-h-12"
            onClick={() => {
              retry()
            }}
          >
            再試行する
          </Button>
        </div>
      )}

      <Card className="flex flex-col gap-4">
        <h2 className="font-sans font-semibold text-ink text-sm">重複候補を比較</h2>
        <p className="font-sans text-ink-muted text-sm">
          比較しただけでは何も変わりません。統合は明示的に実行したときだけ行われます。
        </p>
        <div className="grid gap-4 md:grid-cols-2">
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
        <div className="flex justify-end">
          <Button type="button" className="min-h-12" onClick={comparePair}>
            重複候補を比較する
          </Button>
        </div>
      </Card>

      {preview && (
        <>
          <Card>
            <section aria-label="重複候補の比較" className="grid gap-4 md:grid-cols-2">
              <SummaryCard title="残す顧客" summary={preview.primary} />
              <SummaryCard title="重複している顧客" summary={preview.duplicate} />
            </section>
          </Card>

          <Card>
            <section aria-label="統合の影響" className="flex flex-col gap-3">
              <p className="font-sans text-ink-muted text-sm">
                統合すると、次の履歴が残す顧客へ移ります。
              </p>
              <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {mergeImpactRows(preview.impact).map((row) => (
                  <div key={row.key}>
                    <dt className="font-sans text-ink-muted text-xs">{row.label}</dt>
                    <dd className="font-sans text-ink text-lg">{row.count}件</dd>
                  </div>
                ))}
              </dl>
              <p className="font-sans font-semibold text-ink text-sm">
                合計 {mergeImpactTotal(preview.impact)}件
              </p>
              {preview.alreadyMerged ? (
                <Notice tone="info">この顧客はすでに統合されています。</Notice>
              ) : (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="danger"
                    className="min-h-12"
                    onClick={() => {
                      setMergeReasonError(undefined)
                      setConfirmingMerge(true)
                    }}
                  >
                    統合する
                  </Button>
                </div>
              )}
            </section>
          </Card>
        </>
      )}

      <Card className="flex flex-col gap-4">
        <h2 className="font-sans font-semibold text-ink text-sm">誤った顧客関連を解除</h2>
        <div className="grid gap-4 md:grid-cols-2">
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
        <div className="flex justify-end">
          <Button
            type="button"
            variant="danger"
            className="min-h-12"
            onClick={() => {
              setReleaseReasonError(undefined)
              setConfirmingRelease(true)
            }}
          >
            誤関連を解除する
          </Button>
        </div>
      </Card>

      {confirmingMerge && preview && (
        <Modal titleId="merge-confirm-title" title="顧客の統合を確認">
          <p className="font-sans text-ink text-sm">
            {mergeImpactTotal(preview.impact)}件の履歴が残す顧客へ移ります。統合は自動では行われず、
            実行者・日時・変更前後が監査記録に残ります。
          </p>
          <Field label="統合する理由" htmlFor="merge-reason" error={mergeReasonError}>
            <Textarea
              id="merge-reason"
              rows={2}
              value={mergeReason}
              onChange={(event) => setMergeReason(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              className="min-h-12"
              onClick={() => setConfirmingMerge(false)}
            >
              キャンセル
            </Button>
            <Button type="button" variant="danger" className="min-h-12" onClick={confirmMerge}>
              統合を実行する
            </Button>
          </div>
        </Modal>
      )}

      {confirmingRelease && (
        <Modal titleId="release-confirm-title" title="誤った顧客関連の解除を確認">
          <p className="font-sans text-ink text-sm">
            この受付から顧客との関連だけを外します。受付そのものは残り、実行者・日時・変更前後が
            監査記録に残ります。
          </p>
          <Field label="解除する理由" htmlFor="release-reason" error={releaseReasonError}>
            <Textarea
              id="release-reason"
              rows={2}
              value={releaseReason}
              onChange={(event) => setReleaseReason(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              className="min-h-12"
              onClick={() => setConfirmingRelease(false)}
            >
              キャンセル
            </Button>
            <Button type="button" variant="danger" className="min-h-12" onClick={confirmRelease}>
              解除を実行する
            </Button>
          </div>
        </Modal>
      )}
    </main>
  )
}
