import {
  type AdminUserView,
  STANDARD_ROLE_PERMISSIONS,
  type StandardRole,
  StoreMembershipSyncFailed,
} from '@app/contracts'
import { Button, Chip, Dialog, Field, Select, Textarea, TextInput } from '@app/ui'
import { useEffect, useState } from 'react'
import { ApiError, client, unwrap } from '../client'
import { EmptyState, PageHeader, Section, Spinner } from '../components/ui'
import { messageForError } from '../lib/errorMessages'
import { toast } from '../store/toast'

/**
 * 利用者・標準ロール・担当店舗の管理(UC-EYEX-149)。
 *
 * 一覧・検索・権限差分の提示と、標準ロール/担当店舗の変更、PIN 再設定の開始。
 * 組織はサーバが JWT から決めるので、画面から組織 ID を送ることはない。
 * PIN そのものは admin から一切見えない(再設定の開始だけができる)。
 */

const ROLE_LABEL: Record<StandardRole, string> = {
  head_office_admin: '本部管理者',
  store_manager: '店舗管理者',
  staff: 'スタッフ',
}

const VERIFICATION_LABEL = {
  in_person: '対面での本人確認',
  photo_id: '身分証の確認',
  video_call: 'ビデオ通話での確認',
  manager_confirmation: '上長の確認',
} as const

type VerificationMethod = keyof typeof VERIFICATION_LABEL

function syncFailureFrom(err: unknown): { userId: string; retryable: boolean } | null {
  if (!(err instanceof ApiError) || err.code !== 'store_membership_sync_failed') return null
  const parsed = StoreMembershipSyncFailed.safeParse(err.body)
  return parsed.success ? { userId: parsed.data.userId, retryable: parsed.data.retryable } : null
}

export function Users() {
  const [rows, setRows] = useState<AdminUserView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 検索条件
  const [q, setQ] = useState('')
  const [standardRole, setStandardRole] = useState<'' | StandardRole>('')
  const [storeId, setStoreId] = useState('')

  // ダイアログ
  const [assignFor, setAssignFor] = useState<AdminUserView | null>(null)
  const [pinResetFor, setPinResetFor] = useState<AdminUserView | null>(null)

  async function load(query: Record<string, string> = {}): Promise<void> {
    try {
      const list = await unwrap<AdminUserView[]>(await client.api.users.$get({ query }))
      setRows(list)
      setError(null)
    } catch (err) {
      setError('利用者を読み込めませんでした。再読み込みしてください。')
      toast.error(messageForError(err))
    }
  }

  useEffect(() => {
    load()
  }, [])

  function search(): void {
    const query: Record<string, string> = {}
    if (q.trim()) query.q = q.trim()
    if (standardRole) query.standardRole = standardRole
    if (storeId.trim()) query.storeId = storeId.trim()
    load(query)
  }

  return (
    <>
      <PageHeader
        title="利用者"
        sub="標準ロールと担当店舗を確認し、権限差分を見てから変更します。"
      />

      <Section title="検索" className="mb-6">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="氏名・メールで検索" htmlFor="user-q">
            <TextInput id="user-q" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Field label="標準ロール" htmlFor="user-role">
            <Select
              id="user-role"
              value={standardRole}
              onChange={(e) => setStandardRole(e.target.value as '' | StandardRole)}
            >
              <option value="">すべて</option>
              {(Object.keys(ROLE_LABEL) as StandardRole[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="担当店舗 ID" htmlFor="user-store">
            <TextInput
              id="user-store"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button onClick={search}>検索</Button>
          </div>
        </div>
      </Section>

      {error && (
        <p role="alert" className="mb-4 font-sans text-sm text-danger">
          {error}
        </p>
      )}

      {rows === null && !error ? (
        <Spinner label="利用者を読み込み中" />
      ) : rows && rows.length === 0 ? (
        <EmptyState>該当する利用者はいません。</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {(rows ?? []).map((row) => (
            <li
              key={row.id}
              data-user-id={row.id}
              className="rounded-ctl border border-line bg-surface px-5 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-sans text-sm font-semibold text-ink">{row.email}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Chip>{ROLE_LABEL[row.standardRole]}</Chip>
                    <Chip tone={row.hasPin ? 'success' : 'neutral'}>
                      {row.hasPin ? 'PIN 設定済み' : 'PIN 未設定'}
                    </Chip>
                    <span className="font-sans text-xs text-ink-muted">
                      担当店舗 {row.assignments.length} 件
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => setAssignFor(row)}>
                    権限を変更
                  </Button>
                  <Button variant="ghost" onClick={() => setPinResetFor(row)}>
                    PIN 再設定
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="font-sans text-xs text-ink-muted">
                  不足: {row.permissionDifference.missing.join(' ') || 'なし'}
                </span>
                <span className="font-sans text-xs text-ink-muted">
                  超過: {row.permissionDifference.extra.join(' ') || 'なし'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {assignFor && (
        <AssignmentDialog
          user={assignFor}
          busy={busy}
          onClose={() => setAssignFor(null)}
          onSave={async (update) => {
            setBusy(true)
            try {
              await unwrap<AdminUserView>(
                await client.api.users[':id'].$patch({ param: { id: assignFor.id }, json: update }),
              )
              toast.success('権限と担当店舗を変更しました。')
              setAssignFor(null)
              setError(null)
              await load()
            } catch (err) {
              const failure = syncFailureFrom(err)
              if (failure) {
                setAssignFor(null)
                // 正本は保存済み。再読み込みで最新を出してから同期の警告を残す
                // (読み込みが警告を消さない順序にする)。
                await load()
                setError(
                  '変更は保存しましたが、店舗システムへの同期に失敗しました。時間をおいて再送してください。',
                )
              } else {
                toast.error(messageForError(err))
              }
            } finally {
              setBusy(false)
            }
          }}
        />
      )}

      {pinResetFor && (
        <PinResetDialog
          user={pinResetFor}
          busy={busy}
          onClose={() => setPinResetFor(null)}
          onStart={async (input) => {
            setBusy(true)
            try {
              await unwrap<unknown>(
                await client.api.users[':id']['pin-reset'].$post({
                  param: { id: pinResetFor.id },
                  json: input,
                }),
              )
              toast.success('再設定を開始しました。本人が新しい PIN を設定します。')
              setPinResetFor(null)
            } catch (err) {
              toast.error(messageForError(err))
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </>
  )
}

function AssignmentDialog({
  user,
  busy,
  onClose,
  onSave,
}: {
  user: AdminUserView
  busy: boolean
  onClose: () => void
  onSave: (update: { standardRole: StandardRole; storeIds: string[] }) => Promise<void>
}) {
  const [role, setRole] = useState<StandardRole>(user.standardRole)
  const [stores, setStores] = useState(user.assignments.map((a) => a.storeId).join('\n'))
  const storeIds = stores
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  return (
    <Dialog open onClose={onClose} labelledBy="assign-title">
      <h2 id="assign-title" className="font-sans text-lg font-semibold text-ink">
        権限と担当店舗 — {user.email}
      </h2>
      <p className="mt-1 font-sans text-sm text-ink-muted">
        標準ロールを変えると、担当店舗に配る権限も標準どおりに揃います。
      </p>
      <div className="mt-4 flex flex-col gap-4">
        <Field label="標準ロール" htmlFor="assign-role">
          <Select
            id="assign-role"
            value={role}
            onChange={(e) => setRole(e.target.value as StandardRole)}
          >
            {(Object.keys(ROLE_LABEL) as StandardRole[]).map((value) => (
              <option key={value} value={value}>
                {ROLE_LABEL[value]}
              </option>
            ))}
          </Select>
        </Field>
        <p className="font-sans text-xs text-ink-muted">
          標準権限: {STANDARD_ROLE_PERMISSIONS[role].join(' ')}
        </p>
        <Field label="担当店舗 ID(改行区切り)" htmlFor="assign-stores">
          <Textarea
            id="assign-stores"
            rows={4}
            value={stores}
            onChange={(e) => setStores(e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          閉じる
        </Button>
        <Button disabled={busy} onClick={() => onSave({ standardRole: role, storeIds })}>
          変更を保存
        </Button>
      </div>
    </Dialog>
  )
}

function PinResetDialog({
  user,
  busy,
  onClose,
  onStart,
}: {
  user: AdminUserView
  busy: boolean
  onClose: () => void
  onStart: (input: {
    verificationMethod: VerificationMethod
    verificationNote: string
  }) => Promise<void>
}) {
  const [method, setMethod] = useState<VerificationMethod>('in_person')
  const [note, setNote] = useState('')

  return (
    <Dialog open onClose={onClose} labelledBy="pin-reset-title">
      <h2 id="pin-reset-title" className="font-sans text-lg font-semibold text-ink">
        PIN 再設定 — {user.email}
      </h2>
      <p className="mt-1 font-sans text-sm text-ink-muted">
        管理者は PIN を閲覧できません。本人確認の記録を残して再設定を開始すると、本人が 新しい PIN
        を設定します。
      </p>
      <div className="mt-4 flex flex-col gap-4">
        <Field label="本人確認の方法" htmlFor="pin-reset-method">
          <Select
            id="pin-reset-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as VerificationMethod)}
          >
            {(Object.keys(VERIFICATION_LABEL) as VerificationMethod[]).map((value) => (
              <option key={value} value={value}>
                {VERIFICATION_LABEL[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="本人確認の記録" htmlFor="pin-reset-note">
          <Textarea
            id="pin-reset-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          閉じる
        </Button>
        <Button
          disabled={busy || note.trim().length === 0}
          onClick={() => onStart({ verificationMethod: method, verificationNote: note.trim() })}
        >
          再設定を開始
        </Button>
      </div>
    </Dialog>
  )
}
