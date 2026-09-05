/**
 * お店を登録するフォーム。
 *
 * 新しい会社はここを通らないと何も始められない。**断られた理由が読めること**を
 * 最優先にし、合い言葉の重複と権限不足を別の文言で伝える。
 *
 * 役割の判定はサーバに任せる（403 を文言に写す）。JWT を画面側で解いて出し分けると、
 * 正本が 2 か所になり、ずれたときに「押せるのに通らないボタン」が生まれる。
 */
import type { Store, StoreInput } from '@app/contracts'
import { Button, Field, Notice, TextInput } from '@app/ui'
import { type FormEvent, useState } from 'react'

/** 合い言葉に使える形。サーバの `StoreInput.slug` と同じ規則を画面でも先に見る。 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function StoreCreateForm({
  send,
  onCreated,
  onCancel,
}: {
  /** 登録の送信。呼び出し側が認証付きの経路を渡す。 */
  send: (input: StoreInput) => Promise<Response>
  onCreated: (store: Store) => void
  onCancel?: () => void
}) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [accessNote, setAccessNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('お店の名前を入れてください。')
      return
    }
    if (slug.length < 2) {
      setError('合い言葉は 2 文字以上で入れてください。')
      return
    }
    if (!SLUG_PATTERN.test(slug)) {
      setError('合い言葉は小文字の英数字とハイフンだけが使えます。')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const response = await send({
        name: trimmedName,
        slug,
        phone: phone.trim(),
        address: address.trim(),
        accessNote: accessNote.trim(),
      })
      if (response.status === 201) {
        onCreated((await response.json()) as Store)
        return
      }
      if (response.status === 409) {
        setError('この合い言葉は使われています。別の合い言葉を入れてください。')
        return
      }
      if (response.status === 403) {
        setError('お店の登録は会社の管理者だけが行えます。管理者にご依頼ください。')
        return
      }
      if (response.status === 400) {
        setError('入力に誤りがあります。お店の名前と合い言葉をお確かめください。')
        return
      }
      setError('お店を登録できませんでした。もう一度お試しください。')
    } catch {
      setError('お店を登録できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-lg flex-col gap-5">
      <Field label="お店の名前" htmlFor="store-name">
        <TextInput
          id="store-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
      </Field>

      <Field label="お客様向けページの合い言葉" htmlFor="store-slug">
        <TextInput
          id="store-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          autoComplete="off"
        />
      </Field>
      <p className="text-note text-ink-muted">
        お客様にお伝えするページの住所になります（例:
        /w/ginza）。小文字の英数字とハイフンが使えます。
      </p>

      <Field label="電話番号" htmlFor="store-phone">
        <TextInput
          id="store-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="off"
        />
      </Field>

      <Field label="住所" htmlFor="store-address">
        <TextInput
          id="store-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          autoComplete="off"
        />
      </Field>

      <Field label="道順のご案内" htmlFor="store-access">
        <TextInput
          id="store-access"
          value={accessNote}
          onChange={(e) => setAccessNote(e.target.value)}
          autoComplete="off"
        />
      </Field>

      {error === null ? null : <Notice tone="danger">{error}</Notice>}

      <div className="flex gap-3">
        <Button type="submit" disabled={busy}>
          このお店を登録する
        </Button>
        {onCancel === undefined ? null : (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            やめる
          </Button>
        )}
      </div>
    </form>
  )
}
