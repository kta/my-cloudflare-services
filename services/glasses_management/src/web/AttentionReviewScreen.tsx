import {
  type AttentionNoteInput,
  AttentionNoteRecord,
  type AttentionReviewDecision,
  AttentionSettings,
  AttentionVersionConflict,
  type StorePermission,
} from '@app/contracts'
import { Button, Card, Chip, Field, Notice, Textarea, TextInput } from '@app/ui'
import { type ReactNode, useEffect, useState } from 'react'
import {
  AdminCard,
  AdminCardGrid,
  AdminScreen,
  ConflictCompare,
  PermissionDenied,
} from './admin-chrome'
import {
  attentionActionLabel,
  formatJstInstant,
  instantToJstWallClock,
  jstWallClockToInstant,
  noteStatusLabel,
  noteStatusTone,
  relativeJstDay,
  versionConflictRows,
} from './attention-view'
import { ReauthPrompt, requiresPersonalReauthentication } from './ReauthPrompt'
import type { StaffApi, StaffScreenProps } from './staff-screen'

type SharedTerminal = {
  terminalId: string
  organizationId: string
  /**
   * The device's own credential. A fully shared iPad has no staff session, so a
   * shared-terminal request that leaned on a personal bearer token would reach
   * the worker with no credential at all (UC-EYEX-137, AC-EYEX-87).
   */
  token: string
}

type Props = StaffScreenProps & {
  permissions: StorePermission[]
  customerId: string
  customerName: string
  /** JST `YYYY-MM-DD`, injected: a screen never reads the clock itself. */
  today: string
  /** Injected instant, for the same reason. */
  now: string
  /** Present only on a fully shared iPad (UC-EYEX-137). */
  sharedTerminal?: SharedTerminal
}

type NoteDraft = { body: string; occurredAt: string; basis: string; recommendedAction: string }

const EMPTY_DRAFT: NoteDraft = { body: '', occurredAt: '', basis: '', recommendedAction: '' }

const AUDIT_FAILURE =
  '監査記録に残せなかったため、この操作は成立していません。入力はそのまま保持しています。'
const GENERIC_FAILURE = '操作を完了できませんでした。通信を確認してもう一度お試しください。'
const REASON_REQUIRED = '理由を入力してください。'

type ManagementAction = 'publish' | 'revise' | 'hide'

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

function draftFrom(note: AttentionNoteRecord): NoteDraft {
  return {
    body: note.body,
    occurredAt: instantToJstWallClock(note.occurredAt),
    basis: note.basis,
    recommendedAction: note.recommendedAction,
  }
}

/** 4 項目が揃って初めて注意事項になる (UC-EYEX-143). */
function noteInputFrom(draft: NoteDraft): AttentionNoteInput | undefined {
  const occurredAt = jstWallClockToInstant(draft.occurredAt)
  if (
    occurredAt === undefined ||
    draft.body.trim() === '' ||
    draft.basis.trim() === '' ||
    draft.recommendedAction.trim() === ''
  )
    return undefined
  return {
    body: draft.body.trim(),
    occurredAt,
    basis: draft.basis.trim(),
    recommendedAction: draft.recommendedAction.trim(),
  }
}

function NoteFields({
  idPrefix,
  draft,
  onChange,
}: {
  idPrefix: string
  draft: NoteDraft
  onChange: (draft: NoteDraft) => void
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Field label="発生した事実" htmlFor={`${idPrefix}-body`}>
          <Textarea
            id={`${idPrefix}-body`}
            rows={3}
            value={draft.body}
            onChange={(event) => onChange({ ...draft, body: event.target.value })}
          />
        </Field>
      </div>
      <Field label="発生日時" htmlFor={`${idPrefix}-occurred-at`}>
        <TextInput
          id={`${idPrefix}-occurred-at`}
          type="datetime-local"
          className="min-h-12"
          value={draft.occurredAt}
          onChange={(event) => onChange({ ...draft, occurredAt: event.target.value })}
        />
      </Field>
      <Field label="根拠" htmlFor={`${idPrefix}-basis`}>
        <TextInput
          id={`${idPrefix}-basis`}
          className="min-h-12"
          value={draft.basis}
          onChange={(event) => onChange({ ...draft, basis: event.target.value })}
        />
      </Field>
      <div className="md:col-span-2">
        <Field label="推奨対応" htmlFor={`${idPrefix}-recommended-action`}>
          <TextInput
            id={`${idPrefix}-recommended-action`}
            className="min-h-12"
            value={draft.recommendedAction}
            onChange={(event) => onChange({ ...draft, recommendedAction: event.target.value })}
          />
        </Field>
      </div>
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
      <Card className="flex w-full max-w-2xl flex-col gap-4">
        <h2 id={titleId} className="font-display font-semibold text-ink text-xl">
          {title}
        </h2>
        {children}
      </Card>
    </div>
  )
}

/**
 * 注意事項の確認待ち・公開・改訂・非表示化 (UC-EYEX-141〜147).
 *
 * 公開済みの記録はここでも決して上書きされない。改訂は新しい版を作り、
 * 非表示化は行を消さず状態を変える。完全共有 iPad から管理操作へ入るときだけ
 * 個人再認証を挟み、確認待ちの登録は日常業務のまま通す (AC-EYEX-87)。
 */
export function AttentionReviewScreen({
  storeId,
  api,
  permissions,
  customerId,
  customerName,
  sharedTerminal,
  navigate,
  today,
}: Props) {
  const mayRead = permissions.includes('attention.read')
  const mayWrite = permissions.includes('attention.write')
  const mayPublish = permissions.includes('attention.publish')
  const mayRevise = permissions.includes('attention.revise')
  const mayHide = permissions.includes('attention.hide')

  const [settings, setSettings] = useState<AttentionSettings>()
  const [notes, setNotes] = useState<AttentionNoteRecord[]>([])
  const [draft, setDraft] = useState<NoteDraft>(EMPTY_DRAFT)
  const [registerError, setRegisterError] = useState<string>()
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [reasonErrors, setReasonErrors] = useState<Record<string, string>>({})
  const [revising, setRevising] = useState<{ note: AttentionNoteRecord; draft: NoteDraft }>()
  const [hiding, setHiding] = useState<{ note: AttentionNoteRecord; reason: string }>()
  const [versions, setVersions] = useState<AttentionNoteRecord[]>()
  const [conflict, setConflict] = useState<AttentionVersionConflict>()
  const [success, setSuccess] = useState<string>()
  const [failure, setFailure] = useState<string>()
  const [retry, setRetry] = useState<() => void>()
  const [reauth, setReauth] = useState<{ action: ManagementAction; run: (grant: string) => void }>()

  useEffect(() => {
    if (!mayRead) return undefined
    let active = true
    void (async () => {
      const [settingsResponse, notesResponse] = await Promise.all([
        api(`/api/staff/stores/${encodeURIComponent(storeId)}/attention-settings`),
        api(
          `/api/staff/stores/${encodeURIComponent(storeId)}/customers/${encodeURIComponent(customerId)}/attention-notes`,
        ),
      ])
      const parsedSettings = settingsResponse.ok
        ? AttentionSettings.safeParse(await readJson(settingsResponse))
        : undefined
      const parsedNotes = notesResponse.ok
        ? AttentionNoteRecord.array().safeParse(await readJson(notesResponse))
        : undefined
      if (!active) return
      if (parsedSettings?.success) setSettings(parsedSettings.data)
      if (parsedNotes?.success) setNotes(parsedNotes.data)
    })().catch(() => {
      if (active) setFailure(GENERIC_FAILURE)
    })
    return () => {
      active = false
    }
  }, [api, customerId, mayRead, storeId])

  if (!mayRead) return <PermissionDenied onReturnHome={() => navigate({ screen: 'home' })} />

  const replaceNote = (record: AttentionNoteRecord) => {
    setNotes((current) => {
      const rest = current.filter((note) => note.noteId !== record.noteId)
      return [record, ...rest]
    })
  }

  const post = async (
    path: string,
    body: unknown,
    grant?: string,
  ): Promise<{ ok: true; body: unknown } | { ok: false }> => {
    setSuccess(undefined)
    setFailure(undefined)
    setRetry(undefined)
    setConflict(undefined)
    let response: Response
    try {
      const shared = sharedTerminal !== undefined && path.startsWith('/api/shared-terminals/')
      response = await api(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(shared ? { 'x-shared-terminal-token': sharedTerminal.token } : {}),
          // The worker reads the grant from its own header. Sending it as
          // `authorization` would be ignored and every management action on a
          // shared iPad would fail closed with 401 (UC-EYEX-138, AC-EYEX-87).
          ...(grant === undefined ? {} : { 'x-shared-terminal-reauth-token': grant }),
        },
        body: JSON.stringify(body),
      })
    } catch {
      setFailure(GENERIC_FAILURE)
      return { ok: false }
    }
    const payload = await readJson(response)
    if (response.ok) return { ok: true, body: payload }
    const code = errorCode(payload)
    if (code === 'attention_version_conflict') {
      const parsed = AttentionVersionConflict.safeParse(payload)
      if (parsed.success) setConflict(parsed.data)
      else setFailure(GENERIC_FAILURE)
      return { ok: false }
    }
    if (code === 'audit_append_failed') setFailure(AUDIT_FAILURE)
    else if (code === 'forbidden') setFailure('この操作を行う権限がありません。')
    else setFailure(GENERIC_FAILURE)
    return { ok: false }
  }

  /** 管理操作は共有端末では個人認証を挟む (UC-EYEX-137, AC-EYEX-87). */
  const guarded = (action: ManagementAction, run: (grant?: string) => void) => {
    if (sharedTerminal && requiresPersonalReauthentication(`attention_${action}`)) {
      setReauth({ action, run: (grant: string) => run(grant) })
      return
    }
    run(undefined)
  }

  const notePath = (noteId: string, suffix: string, grant?: string) =>
    grant === undefined || !sharedTerminal
      ? `/api/staff/stores/${encodeURIComponent(storeId)}/attention-notes/${encodeURIComponent(noteId)}/${suffix}`
      : `/api/shared-terminals/${encodeURIComponent(sharedTerminal.terminalId)}/stores/${encodeURIComponent(storeId)}/attention-notes/${encodeURIComponent(noteId)}/${suffix}`

  const runReview = (
    note: AttentionNoteRecord,
    decision: AttentionReviewDecision,
    reason: string,
  ) => {
    const attempt = (grant?: string) => {
      void (async () => {
        const result = await post(
          notePath(note.noteId, 'review', grant),
          { decision, reason, expectedVersion: note.version },
          grant,
        )
        if (!result.ok) {
          setRetry(() => () => attempt(grant))
          return
        }
        const parsed = AttentionNoteRecord.safeParse(result.body)
        if (parsed.success) replaceNote(parsed.data)
        setSuccess(
          decision === 'publish'
            ? '公開しました。登録者と監査記録へ結果を残しました。'
            : decision === 'return'
              ? '差戻しました。登録者と監査記録へ結果を残しました。'
              : '却下しました。登録者と監査記録へ結果を残しました。',
        )
      })()
    }
    guarded('publish', attempt)
  }

  const review = (note: AttentionNoteRecord, decision: AttentionReviewDecision) => {
    const reason = (reasons[note.noteId] ?? '').trim()
    if (reason === '') {
      setReasonErrors((current) => ({ ...current, [note.noteId]: REASON_REQUIRED }))
      return
    }
    setReasonErrors((current) => ({ ...current, [note.noteId]: '' }))
    runReview(note, decision, reason)
  }

  const register = () => {
    const input = noteInputFrom(draft)
    if (input === undefined) {
      setRegisterError('発生した事実・発生日時・根拠・推奨対応をすべて入力してください。')
      return
    }
    setRegisterError(undefined)
    const attempt = () => {
      void (async () => {
        const path = sharedTerminal
          ? `/api/shared-terminals/${encodeURIComponent(sharedTerminal.terminalId)}/stores/${encodeURIComponent(storeId)}/customers/${encodeURIComponent(customerId)}/attention-notes`
          : `/api/staff/stores/${encodeURIComponent(storeId)}/customers/${encodeURIComponent(customerId)}/attention-notes`
        const result = await post(path, input)
        if (!result.ok) {
          setRetry(() => attempt)
          return
        }
        const parsed = AttentionNoteRecord.safeParse(result.body)
        if (parsed.success) {
          replaceNote(parsed.data)
          setSuccess(
            parsed.data.status === 'published'
              ? '公開しました。登録者と監査記録へ結果を残しました。'
              : '確認待ちとして登録しました。権限者が公開するまで通常のスタッフには表示されません。',
          )
        }
        setDraft(EMPTY_DRAFT)
      })()
    }
    // 確認待ちの登録は日常業務。共有端末でも個人認証を求めない (AC-EYEX-87).
    attempt()
  }

  const revise = () => {
    if (!revising) return
    const input = noteInputFrom(revising.draft)
    if (input === undefined) {
      setFailure('発生した事実・発生日時・根拠・推奨対応をすべて入力してください。')
      return
    }
    const note = revising.note
    const attempt = (grant?: string) => {
      void (async () => {
        const result = await post(
          notePath(note.noteId, 'revisions', grant),
          { ...input, expectedVersion: note.version },
          grant,
        )
        if (!result.ok) {
          setRetry(() => () => attempt(grant))
          return
        }
        const parsed = AttentionNoteRecord.safeParse(result.body)
        if (parsed.success) replaceNote(parsed.data)
        setRevising(undefined)
        setSuccess('改訂版を公開しました。過去の版は残っています。')
      })()
    }
    guarded('revise', attempt)
  }

  const hide = () => {
    if (!hiding) return
    const reason = hiding.reason.trim()
    if (reason === '') {
      setFailure(REASON_REQUIRED)
      return
    }
    const note = hiding.note
    const attempt = (grant?: string) => {
      void (async () => {
        const result = await post(
          notePath(note.noteId, 'hide', grant),
          { reason, expectedVersion: note.version },
          grant,
        )
        if (!result.ok) {
          setRetry(() => () => attempt(grant))
          return
        }
        const parsed = AttentionNoteRecord.safeParse(result.body)
        if (parsed.success) replaceNote(parsed.data)
        setHiding(undefined)
        setSuccess('非表示にしました。記録自体は削除されていません。')
      })()
    }
    guarded('hide', attempt)
  }

  const openVersions = (note: AttentionNoteRecord) => {
    void (async () => {
      const response = await api(
        `/api/staff/stores/${encodeURIComponent(storeId)}/attention-notes/${encodeURIComponent(note.noteId)}/versions`,
      )
      const parsed = response.ok
        ? AttentionNoteRecord.array().safeParse(await readJson(response))
        : undefined
      if (parsed?.success) setVersions(parsed.data)
      else setFailure('版履歴を読み込めませんでした。')
    })()
  }

  // 公開権限が無い操作者には、確認待ちの存在そのものを見せない (AC-EYEX-85).
  const readable = mayPublish
    ? notes
    : notes.filter((note) => note.status === 'published' || note.status === 'hidden')
  // 承認済みモックは「確認待ちを確認する画面」なので、確認待ちが先頭に来る。
  const visible = [...readable].sort((left, right) =>
    left.status === right.status ? 0 : left.status === 'pending_review' ? -1 : 1,
  )

  const pending = notes.filter((note) => note.status === 'pending_review')

  return (
    /* 承認済みモック `operations-approved.html#attention-review` /
       `ATTENTION-REVIEW--pending--ipad-landscape.png`。 */
    <AdminScreen
      label="注意事項の確認"
      navigate={navigate}
      sectionsLabel="確認待ちの節"
      activeSection={
        pending[0]
          ? `${customerName} · ${relativeJstDay(pending[0].occurredAt, today)}`
          : customerName
      }
      sections={
        pending.length === 0
          ? [{ label: customerName }]
          : pending.map((note) => ({
              label: `${customerName} · ${relativeJstDay(note.occurredAt, today)}`,
            }))
      }
    >
      <h2 className="font-display font-semibold text-2xl text-ink">注意事項を確認</h2>

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

      <div className="flex flex-col gap-4">
        {visible.length === 0 && <Notice tone="info">表示できる注意事項はありません。</Notice>}
        {visible.map((note) => (
          <Card key={note.noteId} className="flex flex-col gap-3">
            <article
              aria-label={`注意事項 ${noteStatusLabel(note.status)} 版${note.version}`}
              className="flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <Chip tone={noteStatusTone(note.status)}>{noteStatusLabel(note.status)}</Chip>
                <span className="font-sans text-ink-muted text-sm">版{note.version}</span>
                <span className="font-sans text-ink-muted text-sm">記録者 {note.recordedBy}</span>
              </div>
              {/* 承認済みモックの 3 カード。事実・根拠・推奨対応は必ず並んで出る。 */}
              <AdminCardGrid>
                <AdminCard title="発生した事実" label={`発生した事実 版${note.version}`}>
                  {note.body}
                </AdminCard>
                <AdminCard title="発生日時・根拠" label={`発生日時・根拠 版${note.version}`}>
                  <span className="block">{formatJstInstant(note.occurredAt)}</span>
                  <span className="block">{note.basis}</span>
                </AdminCard>
                <AdminCard title="推奨対応" label={`推奨対応 版${note.version}`}>
                  {note.recommendedAction}
                </AdminCard>
              </AdminCardGrid>
              {note.status === 'pending_review' && mayPublish && (
                <div className="mt-2">
                  <AdminCard tone="warning" title="公開前チェック">
                    人格評価、憶測、差別につながる属性は含まれていません。
                  </AdminCard>
                </div>
              )}

              {note.status === 'pending_review' && mayPublish && (
                <div className="flex flex-col gap-3">
                  <Field
                    label="確認の理由"
                    htmlFor={`attention-reason-${note.noteId}`}
                    error={reasonErrors[note.noteId] || undefined}
                  >
                    <Textarea
                      id={`attention-reason-${note.noteId}`}
                      rows={2}
                      value={reasons[note.noteId] ?? ''}
                      onChange={(event) =>
                        setReasons((current) => ({
                          ...current,
                          [note.noteId]: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  {/* モックの並び: 却下・差戻しは左、公開は右端へ押し出す。 */}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="danger"
                      className="min-h-12"
                      onClick={() => review(note, 'reject')}
                    >
                      却下
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      className="min-h-12"
                      onClick={() => review(note, 'return')}
                    >
                      差戻し
                    </Button>
                    <Button
                      type="button"
                      className="ml-auto min-h-12"
                      onClick={() => review(note, 'publish')}
                    >
                      公開する
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-12"
                  onClick={() => openVersions(note)}
                >
                  過去の版を見る
                </Button>
                {note.status === 'published' && mayRevise && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-12"
                    onClick={() => setRevising({ note, draft: draftFrom(note) })}
                  >
                    改訂する
                  </Button>
                )}
                {note.status !== 'hidden' && mayHide && (
                  <Button
                    type="button"
                    variant="danger"
                    className="min-h-12"
                    onClick={() => setHiding({ note, reason: '' })}
                  >
                    非表示にする
                  </Button>
                )}
              </div>
            </article>
          </Card>
        ))}
      </div>

      {mayWrite && settings && (
        <Card className="flex flex-col gap-4">
          <h2 className="font-sans font-semibold text-ink text-sm">注意事項を登録</h2>
          <section
            aria-label="入力時の案内"
            className="flex flex-col gap-1 rounded-ctl border border-line bg-paper p-3"
          >
            <p className="font-sans text-ink text-sm">
              記録するのは {settings.guidance.record.join('・')} です。
            </p>
            <p className="font-sans text-ink text-sm">
              {settings.guidance.avoid.join('・')} は記録しないでください。
            </p>
          </section>
          <NoteFields idPrefix="attention-new" draft={draft} onChange={setDraft} />
          {registerError && <Notice tone="danger">{registerError}</Notice>}
          <div className="flex justify-end">
            <Button type="button" className="min-h-12" onClick={register}>
              注意事項を登録する
            </Button>
          </div>
        </Card>
      )}

      {revising && (
        <Modal titleId="attention-revise-title" title="注意事項を改訂">
          <p className="font-sans text-ink-muted text-sm">
            公開済みの版は上書きされません。改訂すると新しい版が公開され、版
            {revising.note.version}は過去版として残ります。
          </p>
          <NoteFields
            idPrefix="attention-revision"
            draft={revising.draft}
            onChange={(next) => setRevising({ ...revising, draft: next })}
          />
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              className="min-h-12"
              onClick={() => setRevising(undefined)}
            >
              キャンセル
            </Button>
            <Button type="button" className="min-h-12" onClick={revise}>
              改訂版を公開する
            </Button>
          </div>
        </Modal>
      )}

      {hiding && (
        <Modal titleId="attention-hide-title" title="注意事項を非表示にする">
          <p className="font-sans text-ink-muted text-sm">
            記録は削除されません。非表示にした事実と理由が監査記録に残ります。
          </p>
          <Field label="非表示にする理由" htmlFor="attention-hide-reason">
            <Textarea
              id="attention-hide-reason"
              rows={2}
              value={hiding.reason}
              onChange={(event) => setHiding({ ...hiding, reason: event.target.value })}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              className="min-h-12"
              onClick={() => setHiding(undefined)}
            >
              キャンセル
            </Button>
            <Button type="button" variant="danger" className="min-h-12" onClick={hide}>
              非表示にする
            </Button>
          </div>
        </Modal>
      )}

      {versions && (
        <Modal titleId="attention-versions-title" title="注意事項の版履歴">
          <ul className="flex flex-col gap-3">
            {versions.map((version) => (
              <li key={version.id} className="rounded-ctl border border-line p-3">
                <p className="font-sans font-medium text-ink text-sm">
                  版{version.version} · {noteStatusLabel(version.status)}
                </p>
                <p className="font-sans text-ink text-sm">{version.body}</p>
                <p className="font-sans text-ink-muted text-xs">
                  {formatJstInstant(version.occurredAt)} · 記録者 {version.recordedBy}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              className="min-h-12"
              onClick={() => setVersions(undefined)}
            >
              閉じる
            </Button>
          </div>
        </Modal>
      )}

      {conflict && (
        <Modal titleId="attention-conflict-title" title="別の端末で先に更新されています">
          <p className="font-sans text-ink text-sm">
            {`この画面は版${conflict.expectedVersion}です。現在の版は版${conflict.currentVersion}です。古い版からは公開できません。`}
          </p>
          <ConflictCompare
            title="どちらを残すか選んでください"
            latest={
              <dl>
                {versionConflictRows(conflict).map((row) => (
                  <div key={row.field}>
                    <dt className="text-ink-muted">{row.label}</dt>
                    <dd>{row.after}</dd>
                  </div>
                ))}
              </dl>
            }
            mine={
              <dl>
                {versionConflictRows(conflict).map((row) => (
                  <div key={row.field}>
                    <dt className="text-ink-muted">{row.label}</dt>
                    <dd>{row.before}</dd>
                  </div>
                ))}
              </dl>
            }
            onDiscard={() => {
              setConflict(undefined)
              setRevising(undefined)
            }}
            onReapply={() => {
              setConflict(undefined)
              setRevising(undefined)
            }}
          />
        </Modal>
      )}

      {reauth && sharedTerminal && (
        <ReauthPrompt
          storeId={storeId}
          storeName={customerName}
          api={api as StaffApi}
          navigate={() => {}}
          now=""
          terminalId={sharedTerminal.terminalId}
          organizationId={sharedTerminal.organizationId}
          actionLabel={attentionActionLabel(reauth.action)}
          onGranted={(token) => {
            const run = reauth.run
            setReauth(undefined)
            run(token)
          }}
          onCancelled={() => setReauth(undefined)}
        />
      )}
    </AdminScreen>
  )
}
