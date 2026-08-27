import { SharedTerminal, SharedTerminalIssue } from '@app/contracts'
import { Button, Card, Field, Notice, TextInput } from '@app/ui'
import { useCallback, useEffect, useState } from 'react'
import {
  AdminCard,
  AdminCardGrid,
  AdminHeading,
  AdminRow,
  AdminScreen,
  AdminState,
  AdminTitle,
} from './admin-chrome'
import type { StaffScreenProps } from './staff-screen'

const LOAD_FAILURE = '共有iPadの一覧を取得できませんでした。もう一度お試しください。'
const CREATE_FAILURE = '共有iPadを登録できませんでした。もう一度お試しください。'
const REVOKE_FAILURE = '共有セッションを失効できませんでした。もう一度お試しください。'
const CONSOLE_ONLY = 'この操作は管理コンソールで行います。'

/** Whole minutes, so "1分前" reads the same as the operations mock. */
function formatLastSeen(lastSeenAt: string | null, now: string): string {
  if (lastSeenAt === null) return '未通信'
  const elapsed = new Date(now).getTime() - new Date(lastSeenAt).getTime()
  const minutes = Math.max(0, Math.floor(elapsed / 60_000))
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  return `${Math.floor(hours / 24)}日前`
}

function formatMinutes(seconds: number): string {
  const minutes = seconds / 60
  return Number.isInteger(minutes) ? `${minutes}分` : `${seconds}秒`
}

type Props = StaffScreenProps & {
  /** Injected instant: the screen never reads the wall clock itself. */
  now: string
  /**
   * The idle-lock timeout in force (UC-EYEX-152). There is no settings API for
   * this yet, so it is passed in and its absence is shown as 未取得 rather than
   * guessed at.
   */
  idleLockSeconds?: { organizationDefault: number; storeOverride: number | null }
}

/**
 * Shared iPad register, issue and revoke for one store (DEVICE-LIST).
 *
 * 骨格・語彙・文言は承認済みモック `operations-approved.html#devices` と
 * `DEVICE-LIST--default--ipad-landscape.png` のまま。
 *
 * The issued bearer token lives in component state for exactly as long as the
 * operator is reading it: it is never stored, never re-fetchable, and the only
 * way out of the panel discards it (UC-EYEX-131).
 */
export function SharedTerminalScreen({
  storeId,
  storeName,
  api,
  navigate,
  now,
  idleLockSeconds,
}: Props) {
  const [terminals, setTerminals] = useState<SharedTerminal[]>()
  const [failure, setFailure] = useState<string>()
  const [registering, setRegistering] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string>()
  const [issuedToken, setIssuedToken] = useState<string>()
  const [issuedName, setIssuedName] = useState<string>()
  const [confirmingRevoke, setConfirmingRevoke] = useState<SharedTerminal>()
  const [busy, setBusy] = useState(false)
  const [pinNotice, setPinNotice] = useState<string>()
  const [idleNotice, setIdleNotice] = useState<string>()
  const [deleteNotice, setDeleteNotice] = useState<string>()

  const load = useCallback(async () => {
    const response = await api(`/api/staff/stores/${storeId}/shared-terminals`)
    if (!response.ok) {
      setFailure(LOAD_FAILURE)
      return
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    const parsed = SharedTerminal.array().safeParse(body)
    if (!parsed.success) {
      setFailure(LOAD_FAILURE)
      return
    }
    setFailure(undefined)
    setTerminals(parsed.data)
  }, [api, storeId])

  useEffect(() => {
    void load()
  }, [load])

  const register = async () => {
    const trimmed = name.trim()
    if (trimmed === '') {
      setNameError('端末名を入力してください。')
      return
    }
    setNameError(undefined)
    setBusy(true)
    try {
      const response = await api(`/api/staff/stores/${storeId}/shared-terminals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!response.ok) {
        setFailure(CREATE_FAILURE)
        return
      }
      let body: unknown
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      const parsed = SharedTerminalIssue.safeParse(body)
      if (!parsed.success) {
        setFailure(CREATE_FAILURE)
        return
      }
      setFailure(undefined)
      setName('')
      setRegistering(false)
      setIssuedName(parsed.data.terminal.name)
      setIssuedToken(parsed.data.token)
      setTerminals((current) => [...(current ?? []), parsed.data.terminal])
    } catch {
      setFailure(CREATE_FAILURE)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (terminal: SharedTerminal) => {
    setBusy(true)
    try {
      const response = await api(
        `/api/staff/stores/${storeId}/shared-terminals/${terminal.id}/revoke`,
        { method: 'POST' },
      )
      if (!response.ok) {
        setFailure(REVOKE_FAILURE)
        return
      }
      let body: unknown
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      const parsed = SharedTerminal.safeParse(body)
      if (!parsed.success) {
        setFailure(REVOKE_FAILURE)
        return
      }
      setFailure(undefined)
      setTerminals((current) =>
        (current ?? []).map((item) => (item.id === parsed.data.id ? parsed.data : item)),
      )
    } catch {
      setFailure(REVOKE_FAILURE)
    } finally {
      setBusy(false)
      setConfirmingRevoke(undefined)
    }
  }

  return (
    <AdminScreen
      label="端末とセキュリティ"
      navigate={navigate}
      sectionsLabel="端末とセキュリティの節"
      activeSection="共有iPad"
      sections={[
        { label: '共有iPad', to: { screen: 'shared-terminals' } },
        { label: '無操作ロック' },
        { label: '個人PIN' },
        { label: '共有セッション' },
      ]}
    >
      <AdminTitle>
        <AdminHeading title="共有iPad" description="店舗へ登録された端末と共有セッション" />
        <Button
          className="ml-auto min-h-11"
          onClick={() => {
            setRegistering(true)
            setNameError(undefined)
          }}
        >
          共有iPadを登録
        </Button>
      </AdminTitle>

      {failure && (
        <div className="mt-3">
          <Notice tone="danger">{failure}</Notice>
        </div>
      )}

      {registering && (
        <Card className="mt-3 flex flex-col gap-3">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void register()
            }}
          >
            <div className="min-w-64 flex-1">
              <Field label="端末名" htmlFor="terminal-name" error={nameError}>
                <TextInput
                  id="terminal-name"
                  className="min-h-12"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            </div>
            <Button type="submit" className="min-h-12" disabled={busy}>
              登録する
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-12"
              onClick={() => setRegistering(false)}
            >
              やめる
            </Button>
          </form>
        </Card>
      )}

      {terminals?.map((terminal) => {
        const active = terminal.status === 'active'
        return (
          <AdminRow key={terminal.id} label={`${storeName} ${terminal.name}`}>
            <b className="font-sans font-bold text-ink">{`${storeName} ${terminal.name}`}</b>
            <span className="font-sans text-ink text-sm">
              {`最終通信 ${formatLastSeen(terminal.lastSeenAt, now)}`}
            </span>
            {/* Text carries the state; the tint only reinforces it. */}
            <AdminState>{active ? '利用中' : '停止中'}</AdminState>
            {active ? (
              <Button
                variant="danger"
                className="min-h-11"
                onClick={() => setConfirmingRevoke(terminal)}
              >
                失効
              </Button>
            ) : (
              <Button
                variant="danger"
                className="min-h-11"
                onClick={() =>
                  setDeleteNotice(`停止中の端末の削除は本部の承認が必要です。${CONSOLE_ONLY}`)
                }
              >
                削除確認
              </Button>
            )}
          </AdminRow>
        )
      })}
      {terminals?.length === 0 && (
        <p className="mt-3 font-sans text-ink-muted text-sm">
          登録された共有iPadはまだありません。
        </p>
      )}
      {deleteNotice && (
        <div className="mt-3">
          <Notice tone="info">{deleteNotice}</Notice>
        </div>
      )}

      <AdminCardGrid>
        <AdminCard title="無操作ロック">
          {idleLockSeconds === undefined ? (
            <>
              <span className="block">未取得</span>
              <span className="block text-ink-muted">
                無操作ロック時間はこの画面から取得できません。
              </span>
            </>
          ) : (
            <>
              <span className="block">{`既定 ${formatMinutes(idleLockSeconds.organizationDefault)}`}</span>
              <span className="block">
                {idleLockSeconds.storeOverride === null
                  ? '店舗上書きなし（既定を適用中）'
                  : `店舗上書き ${formatMinutes(idleLockSeconds.storeOverride)}（適用中）`}
              </span>
            </>
          )}
          <Button
            variant="danger"
            className="mt-2 min-h-11"
            onClick={() => setIdleNotice(`無操作ロック時間の変更は${CONSOLE_ONLY}`)}
          >
            変更
          </Button>
          {idleNotice && <Notice tone="info">{idleNotice}</Notice>}
        </AdminCard>
        <AdminCard title="画面非表示時">直ちに顧客情報を隠す</AdminCard>
        <AdminCard title="個人モード">
          <span className="block">スタッフ選択＋4〜6桁PIN</span>
          <span className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="danger"
              className="min-h-11"
              onClick={() =>
                setPinNotice(`個人PINの設定と変更は本人のみが行えます。${CONSOLE_ONLY}`)
              }
            >
              個人PINを設定・変更
            </Button>
            <Button
              variant="danger"
              className="min-h-11"
              onClick={() =>
                setPinNotice(
                  `本人確認後にPIN再設定を開始できます。PINそのものは管理者にも表示されません。${CONSOLE_ONLY}`,
                )
              }
            >
              個人PINの再設定を開始
            </Button>
          </span>
          {pinNotice && <Notice tone="info">{pinNotice}</Notice>}
        </AdminCard>
      </AdminCardGrid>

      {issuedToken !== undefined && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="terminal-issued-title"
          className="fixed inset-0 flex items-center justify-center bg-ink/40 p-6"
        >
          <Card className="flex w-full max-w-xl flex-col gap-3">
            <h3 id="terminal-issued-title" className="font-display font-semibold text-2xl text-ink">
              {issuedName}を登録しました
            </h3>
            <Notice tone="danger">
              このトークンは今だけ表示されます。画面を閉じると二度と表示できません。端末に入力してから閉じてください。
            </Notice>
            <p className="break-all rounded-ctl border border-line bg-surface p-3 font-mono text-ink text-sm">
              {issuedToken}
            </p>
            <div className="flex justify-end">
              <Button
                className="min-h-12"
                onClick={() => {
                  setIssuedToken(undefined)
                  setIssuedName(undefined)
                }}
              >
                控えたので閉じる
              </Button>
            </div>
          </Card>
        </div>
      )}

      {confirmingRevoke && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="terminal-revoke-title"
          className="fixed inset-0 flex items-center justify-center bg-ink/40 p-6"
        >
          <Card className="flex w-full max-w-xl flex-col gap-3">
            <h3 id="terminal-revoke-title" className="font-display font-semibold text-2xl text-ink">
              {confirmingRevoke.name}を失効しますか？
            </h3>
            <p className="font-sans text-ink text-sm">
              失効するとこの端末は次の通信で顧客情報と業務画面へアクセスできなくなります。
            </p>
            <p className="font-sans text-ink text-sm">
              端末に残っている未送信の操作は実行されません。再び使うには登録し直します。
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                variant="ghost"
                className="min-h-12"
                onClick={() => setConfirmingRevoke(undefined)}
              >
                やめる
              </Button>
              <Button
                variant="danger"
                className="min-h-12"
                disabled={busy}
                onClick={() => void revoke(confirmingRevoke)}
              >
                失効する
              </Button>
            </div>
          </Card>
        </div>
      )}
    </AdminScreen>
  )
}
