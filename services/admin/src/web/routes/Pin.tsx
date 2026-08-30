import { stretchPin } from '@app/shared'
import { Button, Field, TextInput } from '@app/ui'
import { useEffect, useState } from 'react'
import { currentClaims } from '../auth/session'
import { ApiError, client, unwrap } from '../client'
import { PageHeader, Section } from '../components/ui'
import { toast } from '../store/toast'

/**
 * 個人 PIN の設定・変更(UC-EYEX-151)。
 *
 * 平文 PIN はこの画面から出ない — `stretchPin()` の出力だけを送る。サーバは
 * pepper 込みの証明しか保持せず、PIN は誰にも(管理者にも)表示されない。
 */

const PIN_PATTERN = /^\d{4,6}$/

const FAILURE_MESSAGE: Record<string, string> = {
  pin_current_required: '現在の PIN を入力してください。',
  pin_verification_failed: '現在の PIN が一致しません。',
  reset_ticket_invalid: '再設定チケットが無効か、期限切れです。管理者へ再発行を依頼してください。',
}

export function Pin() {
  const [hasPin, setHasPin] = useState<boolean | null>(null)
  const [pin, setPin] = useState('')
  const [currentPin, setCurrentPin] = useState('')
  const [ticketId, setTicketId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const state = await unwrap<{ hasPin: boolean }>(await client.api.me.pin.$get())
        setHasPin(state.hasPin)
      } catch {
        setError('PIN の状態を読み込めませんでした。')
      }
    })()
  }, [])

  async function submit(): Promise<void> {
    const claims = currentClaims()
    if (!claims || !PIN_PATTERN.test(pin)) return
    setBusy(true)
    setError(null)
    try {
      const json: {
        stretchedPin: string
        currentStretchedPin?: string
        resetTicketId?: string
      } = { stretchedPin: await stretchPin(pin, claims.org, claims.sub) }
      if (ticketId.trim()) json.resetTicketId = ticketId.trim()
      else if (hasPin && PIN_PATTERN.test(currentPin))
        json.currentStretchedPin = await stretchPin(currentPin, claims.org, claims.sub)
      await unwrap<{ ok: true }>(await client.api.me.pin.$post({ json }))
      setHasPin(true)
      setPin('')
      setCurrentPin('')
      setTicketId('')
      toast.success('PIN を保存しました。')
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ''
      setError(FAILURE_MESSAGE[code] ?? 'PIN を保存できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="個人 PIN"
        sub="共有端末で自分の操作へ切り替えるための PIN です。管理者を含め、誰も PIN を閲覧できません。"
      />
      <Section title="現在の状態">
        <p className="font-sans text-sm text-ink">{hasPin ? '設定済み' : '未設定'}</p>
      </Section>

      <Section title={hasPin ? 'PIN を変更' : 'PIN を設定'} className="mt-6">
        <div className="grid max-w-md gap-4">
          <Field label="新しい PIN(4〜6 桁)" htmlFor="pin-new">
            <TextInput
              id="pin-new"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </Field>
          {hasPin && (
            <>
              <Field label="現在の PIN" htmlFor="pin-current">
                <TextInput
                  id="pin-current"
                  inputMode="numeric"
                  autoComplete="off"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </Field>
              <Field label="再設定チケット ID" htmlFor="pin-ticket">
                <TextInput
                  id="pin-ticket"
                  autoComplete="off"
                  value={ticketId}
                  onChange={(e) => setTicketId(e.target.value)}
                />
              </Field>
            </>
          )}
          {error && (
            <p role="alert" className="font-sans text-sm text-danger">
              {error}
            </p>
          )}
          <div>
            <Button disabled={busy || !PIN_PATTERN.test(pin)} onClick={submit}>
              {hasPin ? 'PIN を変更' : 'PIN を設定'}
            </Button>
          </div>
        </div>
      </Section>
    </>
  )
}
