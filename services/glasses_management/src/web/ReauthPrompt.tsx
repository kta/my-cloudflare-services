import { SharedTerminalReauthenticationIssue } from '@app/contracts'
import { stretchPin } from '@app/shared'
import { Button, Card, Field, Notice, TextInput } from '@app/ui'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { StaffScreenProps } from './staff-screen'

/**
 * Which actions a fully shared iPad may not perform on the store's authority
 * alone (UC-EYEX-137). Everyday reception work is deliberately absent: asking
 * for a PIN during it would push staff back to a personal device (AC-EYEX-81).
 * Registering an attention note stays everyday work; only publishing, revising
 * or hiding one crosses into management (AC-EYEX-87).
 */
const ADMINISTRATIVE_ACTIONS = new Set([
  'attention_publish',
  'attention_revise',
  'attention_hide',
  'attention_permissions',
  'recording_hold',
  'recording_release',
  'permission_settings',
  'shared_terminal_revoke',
])

export function requiresPersonalReauthentication(action: string): boolean {
  return ADMINISTRATIVE_ACTIONS.has(action)
}

const FAILURE_MESSAGE: Record<string, string> = {
  pin_invalid: '個人PINを確認できませんでした。もう一度入力してください。',
  terminal_unauthorized: 'この端末の共有セッションは無効です。端末の再登録が必要です。',
  reauth_forbidden: 'この操作を行う権限がありません。店舗管理者にご確認ください。',
  admin_auth_unavailable:
    '認証サービスに接続できませんでした。時間をおいてもう一度お試しください。',
  reauth_expired: '個人認証の有効期限が切れました。もう一度個人PINを入力してください。',
}
const GENERIC_FAILURE = '個人認証を完了できませんでした。もう一度お試しください。'
const PIN_FORMAT_FAILURE = '個人PINは4〜6桁の数字で入力してください。'

type Props = StaffScreenProps & {
  /** Injected instant: a shared terminal must never read its own wall clock. */
  now: string
  terminalId: string
  /** Salt domain for the PIN stretch; the raw PIN must not leave the browser. */
  organizationId: string
  /** What the operator is about to do, shown so they can refuse an unexpected prompt. */
  actionLabel: string
  /** False for everyday work: the prompt then never appears (AC-EYEX-81). */
  administrative?: boolean
  onGranted: (token: string) => void
  onCancelled: () => void
}

async function readError(response: Response): Promise<string> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  const error =
    typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error?: unknown }).error
      : undefined
  return typeof error === 'string' ? error : ''
}

/**
 * Manager re-authentication on a fully shared iPad (UC-EYEX-138, AC-EYEX-82).
 *
 * The pending action is never run by this component: it only reports a grant
 * through `onGranted`, and only after the freshly issued grant has been
 * confirmed still valid, so a grant that expired between issuance and use
 * sends the operator back to the PIN rather than through (UC-EYEX-134).
 */
export function ReauthPrompt({
  api,
  terminalId,
  organizationId,
  actionLabel,
  administrative = true,
  onGranted,
  onCancelled,
}: Props) {
  const [userId, setUserId] = useState('')
  const [pin, setPin] = useState('')
  const [failure, setFailure] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (administrative) firstFieldRef.current?.focus()
  }, [administrative])

  // Everyday work is not gated. Rendering nothing here — rather than trusting
  // every caller — keeps a mis-wired screen from inventing a PIN prompt.
  if (!administrative) return null

  const fail = (message: string, clearPin: boolean) => {
    setFailure(message)
    if (clearPin) setPin('')
  }

  const submit = async () => {
    if (submitting) return
    setFailure(undefined)
    let stretchedPin: string
    try {
      // The PIN is stretched here; only the derived value is ever transmitted.
      stretchedPin = await stretchPin(pin, organizationId, userId)
    } catch {
      fail(PIN_FORMAT_FAILURE, false)
      return
    }
    setSubmitting(true)
    try {
      const issued = await api(`/api/shared-terminals/${terminalId}/reauthenticate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, stretchedPin }),
      })
      if (!issued.ok) {
        const error = await readError(issued)
        fail(FAILURE_MESSAGE[error] ?? GENERIC_FAILURE, error === 'pin_invalid')
        return
      }
      let body: unknown
      try {
        body = await issued.json()
      } catch {
        body = undefined
      }
      const parsed = SharedTerminalReauthenticationIssue.safeParse(body)
      if (!parsed.success) {
        fail(GENERIC_FAILURE, false)
        return
      }
      // The grant is short-lived; confirm it is still usable before the caller
      // acts on it, and never persist it (UC-EYEX-134, AC-EYEX-112).
      const check = await api(`/api/shared-terminals/${terminalId}/reauthentication`, {
        headers: { authorization: `Bearer ${parsed.data.token}` },
      })
      if (!check.ok) {
        const error = await readError(check)
        fail(FAILURE_MESSAGE[error] ?? GENERIC_FAILURE, true)
        return
      }
      setPin('')
      onGranted(parsed.data.token)
    } catch {
      fail(GENERIC_FAILURE, false)
    } finally {
      setSubmitting(false)
    }
  }

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancelled()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('input, button')
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reauth-title"
      onKeyDown={trapFocus}
      className="fixed inset-0 flex items-center justify-center bg-ink/40 p-6"
    >
      <Card className="flex w-full max-w-xl flex-col gap-4">
        {/* 承認済みモック `operations-approved.html#reauth` — 見出し・説明・
            個人PIN・左右に割れる 2 ボタン。文言はモックのまま。 */}
        <h2 id="reauth-title" className="font-display font-semibold text-2xl text-ink">
          管理者として確認してください
        </h2>
        <p className="font-sans text-ink text-sm">
          {`${actionLabel}は個人認証が必要です。共有端末と認証した個人の両方を監査記録に残します。`}
        </p>
        {failure && <Notice tone="danger">{failure}</Notice>}
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field label="個人ログインID" htmlFor="reauth-user">
            <TextInput
              id="reauth-user"
              ref={firstFieldRef}
              className="min-h-12"
              autoComplete="off"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            />
          </Field>
          <Field label="個人PIN" htmlFor="reauth-pin">
            <TextInput
              id="reauth-pin"
              className="min-h-12"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="danger" className="min-h-12" onClick={onCancelled}>
              キャンセル
            </Button>
            <Button type="submit" className="ml-auto min-h-12" disabled={submitting}>
              確認して続ける
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
