import {
  type AttentionNoteInput,
  AttentionNoteRecord,
  type AttentionReviewDecision,
  AttentionSettings,
  AttentionVersionConflict,
  type StorePermission,
} from '@app/contracts'
import { useEffect, useState } from 'react'
import { ConflictCompare, PermissionDenied } from './admin-chrome'
import {
  attentionActionLabel,
  formatJstInstant,
  instantToJstWallClock,
  jstWallClockToInstant,
  noteStatusLabel,
  relativeJstDay,
  versionConflictRows,
} from './attention-view'
import { Action, Actions } from './design/controls'
import { Modal } from './design/dialogs'
import { DateTimeField, TextAreaField, TextField } from './design/forms'
import { AdminLayout, AdminSurface } from './design/layouts'
import { FailureNotice, StatusNotice } from './design/notices'
import { Card, CardGrid, StatePill, TitleRow } from './design/surfaces'
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
    <div className="grid gap-3 md:grid-cols-2">
      <div className="md:col-span-2">
        <TextAreaField
          id={`${idPrefix}-body`}
          label="発生した事実"
          rows={3}
          value={draft.body}
          onChange={(event) => onChange({ ...draft, body: event.target.value })}
        />
      </div>
      <DateTimeField
        id={`${idPrefix}-occurred-at`}
        label="発生日時"
        value={draft.occurredAt}
        onChange={(occurredAt) => onChange({ ...draft, occurredAt })}
      />
      <TextField
        id={`${idPrefix}-basis`}
        label="根拠"
        value={draft.basis}
        onChange={(event) => onChange({ ...draft, basis: event.target.value })}
      />
      <div className="md:col-span-2">
        <TextField
          id={`${idPrefix}-recommended-action`}
          label="推奨対応"
          value={draft.recommendedAction}
          onChange={(event) => onChange({ ...draft, recommendedAction: event.target.value })}
        />
      </div>
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
  storeName,
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
  /* master-detail の右側。柱で選んだ 1 件だけを本文に出す。 */
  const [openNoteId, setOpenNoteId] = useState<string>()

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

  /*
   * 承認済みモックは master-detail。柱に読める注意事項の一覧を置き、本文には
   * 選んだ 1 件だけを出す。全件を縦に連ねると、柱の並びと本文の並びが対応
   * しなくなり、いま何を承認しようとしているのかが読めなくなる。
   */
  const labelFor = (note: AttentionNoteRecord, index: number) => {
    const base = `${customerName} · ${relativeJstDay(note.occurredAt, today)}`
    // 同じ日の 2 件は同じ名前になる。柱は名前で押されるので、重なる分だけ
    // 版で区別する（先頭の 1 件はモックどおりの素の名前のまま残す）。
    const duplicated = visible.some(
      (other, otherIndex) =>
        otherIndex < index &&
        `${customerName} · ${relativeJstDay(other.occurredAt, today)}` === base,
    )
    return duplicated ? `${base}（版${note.version}）` : base
  }
  const labels = visible.map(labelFor)
  const openNote = visible.find((note) => note.noteId === openNoteId) ?? visible[0]
  const sections =
    visible.length === 0
      ? [{ label: customerName, current: true }]
      : labels.map((label, index) => ({
          label,
          current: visible[index]?.noteId === openNote?.noteId,
          selectable: true,
        }))
  const selectSection = (label: string) => {
    const index = labels.indexOf(label)
    const note = visible[index]
    if (note) setOpenNoteId(note.noteId)
  }

  return (
    /* 承認済みモック `operations-approved.html#attention-review` /
       `ATTENTION-REVIEW--pending--ipad-landscape.png`。 */
    <AdminSurface label="注意事項の確認">
      <AdminLayout sections={sections} onSelectSection={selectSection}>
        <h1>注意事項を確認</h1>

        {success && <StatusNotice>{success}</StatusNotice>}
        {failure && <FailureNotice>{failure}</FailureNotice>}
        {failure && retry && (
          <Actions>
            <Action
              inset="tight"
              onClick={() => {
                retry()
              }}
            >
              再試行する
            </Action>
          </Actions>
        )}

        {visible.length === 0 && <StatusNotice>表示できる注意事項はありません。</StatusNotice>}
        {(openNote === undefined ? [] : [openNote]).map((note) => (
          <article
            key={note.noteId}
            aria-label={`注意事項 ${noteStatusLabel(note.status)} 版${note.version}`}
          >
            <div className="mt-4.5 flex flex-wrap items-center gap-2.5">
              <StatePill tone={note.status === 'hidden' ? 'danger' : 'plain'}>
                {noteStatusLabel(note.status)}
              </StatePill>
              <span>版{note.version}</span>
              <span>記録者 {note.recordedBy}</span>
            </div>
            {/* 承認済みモックの 3 カード。事実・根拠・推奨対応は必ず並んで出る。 */}
            <CardGrid>
              <Card label={`発生した事実 版${note.version}`}>
                <b>発生した事実</b>
                <br />
                {note.body}
              </Card>
              <Card label={`発生日時・根拠 版${note.version}`}>
                <b>発生日時・根拠</b>
                <br />
                {formatJstInstant(note.occurredAt)}
                <br />
                {note.basis}
              </Card>
              <Card label={`推奨対応 版${note.version}`}>
                <b>推奨対応</b>
                <br />
                {note.recommendedAction}
              </Card>
            </CardGrid>
            {/*
             * 公開前チェックを 3 枚のカードの直下に余白なしで置くのは、事実・
             * 根拠・推奨対応と地続きに読ませるため。一段空けると「別の話」に
             * 見えて、人格評価が混じった注意事項がそのまま公開される。
             */}
            {note.status === 'pending_review' && mayPublish && (
              <div className="mt-3">
                <Card tone="warning" label="公開前チェック">
                  <b>公開前チェック</b>
                  <br />
                  人格評価、憶測、差別につながる属性は含まれていません。
                </Card>
              </div>
            )}

            {note.status === 'pending_review' && mayPublish && (
              <div className="mt-3">
                <TextAreaField
                  id={`attention-reason-${note.noteId}`}
                  label="確認の理由"
                  error={reasonErrors[note.noteId] || undefined}
                  rows={2}
                  value={reasons[note.noteId] ?? ''}
                  onChange={(event) =>
                    setReasons((current) => ({
                      ...current,
                      [note.noteId]: event.target.value,
                    }))
                  }
                />
                {/* モックの並び: 却下・差戻しは左、公開は右端へ押し出す。
                    罫線どうしが接するのはモックの `.title` に gap が無いため。 */}
                <TitleRow
                  gap={0}
                  className="mt-3"
                  push={
                    <Action variant="primary" inset="tight" onClick={() => review(note, 'publish')}>
                      公開する
                    </Action>
                  }
                >
                  <Action variant="danger" inset="tight" onClick={() => review(note, 'reject')}>
                    却下
                  </Action>
                  <Action inset="tight" onClick={() => review(note, 'return')}>
                    差戻し
                  </Action>
                </TitleRow>
              </div>
            )}

            <Actions>
              <Action inset="tight" onClick={() => openVersions(note)}>
                過去の版を見る
              </Action>
              {note.status === 'published' && mayRevise && (
                <Action inset="tight" onClick={() => setRevising({ note, draft: draftFrom(note) })}>
                  改訂する
                </Action>
              )}
              {/* 非表示は元へ戻せない。既定の見た目にしない。 */}
              {note.status !== 'hidden' && mayHide && (
                <Action
                  variant="danger"
                  inset="tight"
                  onClick={() => setHiding({ note, reason: '' })}
                >
                  非表示にする
                </Action>
              )}
            </Actions>
          </article>
        ))}

        {mayWrite && settings && (
          <div className="mt-4.5">
            <Card>
              <b>注意事項を登録</b>
              <div className="mt-3">
                <Card label="入力時の案内">
                  記録するのは {settings.guidance.record.join('・')} です。
                  <br />
                  {settings.guidance.avoid.join('・')} は記録しないでください。
                </Card>
              </div>
              <div className="mt-3">
                <NoteFields idPrefix="attention-new" draft={draft} onChange={setDraft} />
              </div>
              {registerError && <FailureNotice>{registerError}</FailureNotice>}
              <Actions>
                <Action variant="primary" inset="tight" onClick={register}>
                  注意事項を登録する
                </Action>
              </Actions>
            </Card>
          </div>
        )}
      </AdminLayout>

      {revising && (
        <Modal titleId="attention-revise-title" title="注意事項を改訂">
          <p>
            {`公開済みの版は上書きされません。改訂すると新しい版が公開され、版${revising.note.version}は過去版として残ります。`}
          </p>
          <div className="mt-3">
            <NoteFields
              idPrefix="attention-revision"
              draft={revising.draft}
              onChange={(next) => setRevising({ ...revising, draft: next })}
            />
          </div>
          <Actions>
            <Action inset="tight" onClick={() => setRevising(undefined)}>
              キャンセル
            </Action>
            <Action variant="primary" inset="tight" onClick={revise}>
              改訂版を公開する
            </Action>
          </Actions>
        </Modal>
      )}

      {hiding && (
        <Modal titleId="attention-hide-title" title="注意事項を非表示にする">
          <p>記録は削除されません。非表示にした事実と理由が監査記録に残ります。</p>
          <div className="mt-3">
            <TextAreaField
              id="attention-hide-reason"
              label="非表示にする理由"
              rows={2}
              value={hiding.reason}
              onChange={(event) => setHiding({ ...hiding, reason: event.target.value })}
            />
          </div>
          <Actions>
            <Action inset="tight" onClick={() => setHiding(undefined)}>
              キャンセル
            </Action>
            <Action variant="danger" inset="tight" onClick={hide}>
              非表示にする
            </Action>
          </Actions>
        </Modal>
      )}

      {versions && (
        <Modal titleId="attention-versions-title" title="注意事項の版履歴">
          <ul className="mt-3 flex flex-col gap-2.25">
            {versions.map((version) => (
              <li key={version.id}>
                <Card>
                  <b>{`版${version.version} · ${noteStatusLabel(version.status)}`}</b>
                  <br />
                  {version.body}
                  <br />
                  <small>{`${formatJstInstant(version.occurredAt)} · 記録者 ${version.recordedBy}`}</small>
                </Card>
              </li>
            ))}
          </ul>
          <Actions>
            <Action inset="tight" onClick={() => setVersions(undefined)}>
              閉じる
            </Action>
          </Actions>
        </Modal>
      )}

      {conflict && (
        <Modal titleId="attention-conflict-title" title="別の端末で先に更新されています">
          <p>
            {`この画面は版${conflict.expectedVersion}です。現在の版は版${conflict.currentVersion}です。古い版からは公開できません。`}
          </p>
          <ConflictCompare
            title="どちらを残すか選んでください"
            latest={
              <dl>
                {versionConflictRows(conflict).map((row) => (
                  <div key={row.field}>
                    <dt>{row.label}</dt>
                    <dd>{row.after}</dd>
                  </div>
                ))}
              </dl>
            }
            mine={
              <dl>
                {versionConflictRows(conflict).map((row) => (
                  <div key={row.field}>
                    <dt>{row.label}</dt>
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
          storeName={storeName}
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
    </AdminSurface>
  )
}
