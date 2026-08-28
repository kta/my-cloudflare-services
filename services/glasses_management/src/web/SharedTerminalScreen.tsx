import { SharedTerminal, SharedTerminalIssue } from '@app/contracts'
import { useCallback, useEffect, useState } from 'react'
import { Action, Actions } from './design/controls'
import { Modal } from './design/dialogs'
import { TextField } from './design/forms'
import { AdminLayout, AdminSurface } from './design/layouts'
import { FailureNotice, StatusNotice } from './design/notices'
import { AdminRow, Card, CardGrid, StatePill, TitleRow } from './design/surfaces'
import type { StaffLocation } from './staff-navigation'
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
/** 節ナビ。モック `operations-approved.html#devices` の 4 つと、その順序。 */
const SECTIONS: { label: string; to?: StaffLocation }[] = [
  { label: '共有iPad', to: { screen: 'shared-terminals' } },
  { label: '無操作ロック' },
  { label: '個人PIN' },
  { label: '共有セッション' },
]

export function SharedTerminalScreen({ storeId, storeName, api, now, idleLockSeconds }: Props) {
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

  /*
   * 無操作ロックの設定 API はまだ無く、実アプリはこの面へ `idleLockSeconds` を
   * 渡していない。渡されていないときは、登録済みの共有iPad が実際に使っている値で
   * 答える——推測した既定値ではなく、この面がすでに受け取っている事実である。
   * 端末ごとに値が割れているときは黙る。1 つを選んで「既定」と書くと、もう一方の
   * 端末について嘘になる。
   */
  const observedIdleSeconds = (() => {
    const values = new Set((terminals ?? []).map((terminal) => terminal.idleTimeoutSeconds))
    const [only] = [...values]
    return values.size === 1 && only !== undefined ? only : undefined
  })()
  const idleLock =
    idleLockSeconds ??
    (observedIdleSeconds === undefined
      ? undefined
      : { organizationDefault: observedIdleSeconds, storeOverride: null })

  return (
    <AdminSurface label="端末とセキュリティ">
      <AdminLayout
        /*
         * 柱は全画面共通の 1 本しかないので、この面の節はそこへ渡す。
         * 別の面への移動はサイドバーが持つので、ここでは並べない。
         */
        sections={SECTIONS.map((section) => ({
          ...section,
          current: section.label === '共有iPad',
        }))}
      >
        <TitleRow
          gap={0}
          push={
            <Action
              variant="primary"
              inset="tight"
              onClick={() => {
                setRegistering(true)
                setNameError(undefined)
              }}
            >
              共有iPadを登録
            </Action>
          }
        >
          <div>
            {/* `.title h2{margin:0}` — 見出しの下に副題が続くので既定の余白を落とす。 */}
            <h1 className="my-0">共有iPad</h1>
            <p>店舗へ登録された端末と共有セッション</p>
          </div>
        </TitleRow>

        {failure && <FailureNotice>{failure}</FailureNotice>}

        {registering && (
          <div className="mt-3">
            <Card>
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void register()
                }}
              >
                <div className="min-w-64 flex-1">
                  <TextField
                    id="terminal-name"
                    label="端末名"
                    error={nameError}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <Action inset="tight" disabled={busy} onClick={() => void register()}>
                  登録する
                </Action>
                <Action inset="tight" onClick={() => setRegistering(false)}>
                  やめる
                </Action>
              </form>
            </Card>
          </div>
        )}

        {terminals?.map((terminal) => {
          const active = terminal.status === 'active'
          return (
            <AdminRow key={terminal.id} label={`${storeName} ${terminal.name}`}>
              <b>{`${storeName} ${terminal.name}`}</b>
              <span>{`最終通信 ${formatLastSeen(terminal.lastSeenAt, now)}`}</span>
              {/* 状態は文字が運ぶ。色は補強にしか使わない。 */}
              <StatePill>{active ? '利用中' : '停止中'}</StatePill>
              {/* 失効も削除も取り返しがつかない。既定の見た目にしない。 */}
              {active ? (
                <Action
                  variant="danger"
                  inset="tight"
                  onClick={() => setConfirmingRevoke(terminal)}
                >
                  失効
                </Action>
              ) : (
                <Action
                  variant="danger"
                  inset="tight"
                  onClick={() =>
                    setDeleteNotice(`停止中の端末の削除は本部の承認が必要です。${CONSOLE_ONLY}`)
                  }
                >
                  削除確認
                </Action>
              )}
            </AdminRow>
          )
        })}
        {terminals?.length === 0 && <p>登録された共有iPadはまだありません。</p>}
        {deleteNotice && <StatusNotice>{deleteNotice}</StatusNotice>}

        <CardGrid>
          <Card label="無操作ロック">
            <b>無操作ロック</b>
            <br />
            {/*
              値が来ていないあいだは黙る。モック `DEVICE-LIST` のこのカードは
              `既定 2分` のように分かっている事実だけを書いており、
              「未取得 / この画面から取得できません」はモックの語彙に無い
              失敗文言だった。推測した既定値を描かない意図は、書かないことで
              同じように守れる（下の変更導線はそのまま残る）。
            */}
            {idleLock === undefined ? null : (
              <>
                {`既定 ${formatMinutes(idleLock.organizationDefault)}`}
                <br />
                {idleLock.storeOverride === null
                  ? '店舗上書きなし（既定を適用中）'
                  : `店舗上書き ${formatMinutes(idleLock.storeOverride)}（適用中）`}
              </>
            )}
            <br />
            <Action
              inset="tight"
              onClick={() => setIdleNotice(`無操作ロック時間の変更は${CONSOLE_ONLY}`)}
            >
              変更
            </Action>
            {idleNotice && <StatusNotice>{idleNotice}</StatusNotice>}
          </Card>
          <Card label="画面非表示時">
            <b>画面非表示時</b>
            <br />
            直ちに顧客情報を隠す
          </Card>
          <Card label="個人モード">
            <b>個人モード</b>
            <br />
            スタッフ選択＋4〜6桁PIN
            <br />
            <span className="mt-2 flex flex-wrap gap-2">
              <Action
                inset="tight"
                onClick={() =>
                  setPinNotice(`個人PINの設定と変更は本人のみが行えます。${CONSOLE_ONLY}`)
                }
              >
                個人PINを設定・変更
              </Action>
              <Action
                inset="tight"
                onClick={() =>
                  setPinNotice(
                    `本人確認後にPIN再設定を開始できます。PINそのものは管理者にも表示されません。${CONSOLE_ONLY}`,
                  )
                }
              >
                個人PINの再設定を開始
              </Action>
            </span>
            {pinNotice && <StatusNotice>{pinNotice}</StatusNotice>}
          </Card>
        </CardGrid>
      </AdminLayout>

      {issuedToken !== undefined && (
        <Modal titleId="terminal-issued-title" title={`${issuedName}を登録しました`}>
          {/* トークンは今この場でしか読めない。閉じる前に必ず理由まで読ませる。 */}
          <FailureNotice>
            このトークンは今だけ表示されます。画面を閉じると二度と表示できません。端末に入力してから閉じてください。
          </FailureNotice>
          {/* ID と鍵は等幅で。桁を目で追える必要があるので和文は混ぜない。 */}
          <p className="mt-3 break-all rounded-card border border-line bg-surface p-3.5 font-record text-grid">
            {issuedToken}
          </p>
          <Actions>
            <Action
              inset="tight"
              onClick={() => {
                setIssuedToken(undefined)
                setIssuedName(undefined)
              }}
            >
              控えたので閉じる
            </Action>
          </Actions>
        </Modal>
      )}

      {confirmingRevoke && (
        <Modal
          urgent
          titleId="terminal-revoke-title"
          title={`${confirmingRevoke.name}を失効しますか？`}
        >
          <p>失効するとこの端末は次の通信で顧客情報と業務画面へアクセスできなくなります。</p>
          <p>端末に残っている未送信の操作は実行されません。再び使うには登録し直します。</p>
          <Actions>
            <Action inset="tight" onClick={() => setConfirmingRevoke(undefined)}>
              やめる
            </Action>
            <Action
              variant="danger"
              inset="tight"
              disabled={busy}
              onClick={() => void revoke(confirmingRevoke)}
            >
              失効する
            </Action>
          </Actions>
        </Modal>
      )}
    </AdminSurface>
  )
}
