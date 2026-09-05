/**
 * お店を登録する入力（`014-store-provisioning`）。枠は `SetupScreen` が持つ。
 *
 * 設計の判断（Apple HIG）:
 * - **派生できるものは聞かない** — 合い言葉の既定は、入口で既に打った会社のコード。
 *   多くの人はここを一度も触らない。
 * - **一度に 1 つの問い** — 電話・住所・道順はこの面から外し、あとから設定で足す。
 * - **抽象語で聞かない** — 「合い言葉」ではなく、出来上がるお客様のページの住所を
 *   そのまま見せる。決めた部分だけが濃く出る。
 */
import type { Store, StoreInput } from '@app/contracts'
import { Button, Field, Notice, TextInput } from '@app/ui'
import { type FormEvent, useRef, useState } from 'react'

/** 合い言葉に使える形。サーバの `StoreInput.slug` と同じ規則を画面でも先に見る。 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 会社のコードから合い言葉の既定を作る。1 店目は会社のコードそのもの、
 * 2 店目以降は連番を足す。使えない文字は落とす（会社のコードは入口で
 * 小文字に畳まれているが、記号までは畳まれない）。
 */
export function defaultSlug(organizationId: string, existingCount: number): string {
  const base = organizationId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const safe = base.length >= 2 ? base : 'store'
  return existingCount === 0 ? safe : `${safe}-${existingCount + 1}`
}

/** 使われていた合い言葉から、次の案を作る（`eyex` → `eyex-2` → `eyex-3`）。 */
export function nextSlug(taken: string): string {
  const match = /^(.*)-(\d+)$/.exec(taken)
  if (match) return `${match[1]}-${Number(match[2]) + 1}`
  return `${taken}-2`
}

export function StoreForm({
  organizationId,
  existingCount = 0,
  send,
  onCreated,
  onCancel,
}: {
  /** 入口で打った会社のコード。合い言葉の既定に使う。 */
  organizationId: string
  /** 既にあるお店の数。合い言葉の既定の連番に使う。 */
  existingCount?: number
  send: (input: StoreInput) => Promise<Response>
  onCreated: (store: Store) => void
  onCancel?: () => void
}) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState(() => defaultSlug(organizationId, existingCount))
  const [slugOpen, setSlugOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const slugRef = useRef<HTMLInputElement>(null)

  function fail(message: string, focus: 'name' | 'slug'): void {
    setError(message)
    // 直すべき場所へ連れて行く。読ませて終わりにしない。
    ;(focus === 'name' ? nameRef : slugRef).current?.focus()
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return

    const trimmedName = name.trim()
    if (!trimmedName) {
      fail('お店の名前を入れてください。', 'name')
      return
    }
    if (slug.length < 2) {
      setSlugOpen(true)
      fail('合い言葉は 2 文字以上で入れてください。', 'slug')
      return
    }
    if (!SLUG_PATTERN.test(slug)) {
      setSlugOpen(true)
      fail('合い言葉は小文字の英数字とハイフンだけが使えます。', 'slug')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const response = await send({
        name: trimmedName,
        slug,
        phone: '',
        address: '',
        accessNote: '',
      })
      if (response.status === 201) {
        onCreated((await response.json()) as Store)
        return
      }
      if (response.status === 409) {
        // 使われていた合い言葉を握ったままにしない。次の案を入れて開いて見せる。
        setSlug(nextSlug(slug))
        setSlugOpen(true)
        fail('この合い言葉は使われています。別の合い言葉を入れてください。', 'slug')
        return
      }
      if (response.status === 403) {
        setError('お店の登録は会社の管理者だけが行えます。管理者にご依頼ください。')
        return
      }
      if (response.status === 400) {
        fail('入力に誤りがあります。お店の名前と合い言葉をお確かめください。', 'name')
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
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <Field label="お店の名前" htmlFor="store-name">
        <TextInput
          id="store-name"
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: この面で最初に触る場所が 1 つしかない
          autoFocus
        />
      </Field>

      <section className="rounded-card border border-line bg-paper p-4">
        <h3 className="text-grid font-semibold text-ink-muted">お客様のページ</h3>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          {/* 決めた部分だけが濃い。抽象語ではなく出来上がる住所を見せる。 */}
          <p className="text-lead">
            <span className="text-ink-muted">{window.location.origin}</span>
            <span className="font-semibold text-ink">{`/w/${slug}`}</span>
          </p>
          {!slugOpen && (
            <Button type="button" variant="ghost" onClick={() => setSlugOpen(true)}>
              変える
            </Button>
          )}
        </div>
        {slugOpen && (
          <div className="mt-4">
            <Field label="お客様のページの合い言葉" htmlFor="store-slug">
              <TextInput
                id="store-slug"
                ref={slugRef}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <p className="mt-2 text-note text-ink-muted">
              小文字の英数字とハイフンが使えます。ほかのお店と同じ合い言葉は使えません。
            </p>
          </div>
        )}
      </section>

      {error === null ? null : <Notice tone="danger">{error}</Notice>}

      {/* この面の唯一の主操作。`変える` と同じ重さに見えないよう、大きさで段を付ける。 */}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy} className="min-h-12 px-6 text-lead">
          このお店で始める
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
