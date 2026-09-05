import type { PublicSite, PublicTerminal } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { useEffect, useState } from 'react'
import { PinEntry } from '../login/PinEntry'
import { StartBar } from '../login/StartBar'

/**
 * 業務端末の入口。`/s/:storeSlug` を開くと、置き場所を選んで暗証番号を入れるだけで
 * 業務が始まる。パスワードはどこにも出さない。
 *
 * 置き場所の面に出すのは**店名と端末の名前まで**である。在席・接続・スタッフの
 * 氏名は出さない —— この面は未認証で誰でも開けるので、そこに出したものは
 * URL を知っているだけの人に渡したのと同じになる（設計 §2 制約 4）。
 *
 * `login/PlacePick` は流用しない。あちらは業務中のスタッフ名と接続状態を
 * 出すのが役目で、ここで求めているものとは逆である。
 */

type Phase = { at: 'place' } | { at: 'pin'; terminal: PublicTerminal }

type PinError = { remainingAttempts?: number; retryAfterSeconds?: number }

export function SiteEntry({
  slug,
  onStarted,
}: {
  slug: string
  /** 業務トークン・端末 id・端末セッションの平文を渡す。保存先は呼出元が決める。 */
  onStarted: (token: string, terminalId: string, sessionToken: string) => void
}) {
  const [site, setSite] = useState<PublicSite | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ at: 'place' })
  const [pinError, setPinError] = useState<PinError | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`/api/public/sites/${encodeURIComponent(slug)}`)
        if (!alive) return
        if (res.status === 404) {
          setLoadError('この住所のお店が見つかりませんでした。店長にご確認ください。')
          return
        }
        if (!res.ok) {
          setLoadError('お店の情報を読み込めませんでした。少し待ってからもう一度お試しください。')
          return
        }
        setSite((await res.json()) as PublicSite)
      } catch {
        if (alive) {
          setLoadError('通信できませんでした。つながっているかご確認ください。')
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [slug])

  async function submitPin(terminal: PublicTerminal, pin: string): Promise<void> {
    setPinError(null)
    const res = await fetch(
      `/api/public/sites/${encodeURIComponent(slug)}/terminals/${terminal.id}/sessions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      },
    )
    if (res.ok) {
      const body = (await res.json()) as {
        token: string
        session: { sessionToken: string }
      }
      onStarted(body.token, terminal.id, body.session.sessionToken)
      return
    }
    // 401(違う) と 429(待ち) は、どちらも同じ面で残り回数・待ち時間として出す。
    const body = (await res.json().catch(() => null)) as PinError | null
    setPinError({
      remainingAttempts: body?.remainingAttempts ?? 0,
      retryAfterSeconds: body?.retryAfterSeconds,
    })
  }

  if (loadError !== null) {
    return (
      <div className="flex h-dvh flex-col bg-paper text-ink">
        <StartBar mode="業務を始める" showWorkPrefix={false} />
        <main className="grid flex-1 place-items-center px-11">
          <p className="text-lead font-bold">{loadError}</p>
        </main>
      </div>
    )
  }

  if (site === null) {
    return (
      <div className="flex h-dvh flex-col bg-paper text-ink">
        <StartBar mode="業務を始める" showWorkPrefix={false} />
        <main className="grid flex-1 place-items-center px-11">
          <p className="text-body text-ink-muted">お店の情報を読み込んでいます…</p>
        </main>
      </div>
    )
  }

  if (phase.at === 'pin') {
    return (
      <PinEntry
        kind={phase.terminal.kind}
        title={phase.terminal.name}
        detail={phase.terminal.placeNote ?? site.store.name}
        remainingAttempts={pinError?.remainingAttempts}
        retryAfterSeconds={pinError?.retryAfterSeconds}
        onSubmit={(pin) => void submitPin(phase.terminal, pin)}
        onBack={() => {
          setPinError(null)
          setPhase({ at: 'place' })
        }}
      />
    )
  }

  return (
    <SitePlacePick
      site={site}
      onSelect={(terminal) => {
        setPinError(null)
        setPhase({ at: 'pin', terminal })
      }}
    />
  )
}

function SitePlacePick({
  site,
  onSelect,
}: {
  site: PublicSite
  onSelect: (terminal: PublicTerminal) => void
}) {
  const [selected, setSelected] = useState(site.terminals[0]?.id ?? null)
  const current = site.terminals.find((terminal) => terminal.id === selected) ?? null

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <StartBar mode="業務を始める" showWorkPrefix={false} />
      <main className="flex-1 overflow-auto px-11 py-10">
        <h1 className="text-title font-bold">{site.store.name}</h1>
        <p className="mt-1 text-body text-ink-muted">
          この端末の置き場所を選んでください。選んだ名前が、そのまま記録に残ります。
        </p>
        {site.terminals.length === 0 ? (
          /*
           * 0 件でも行き止まりにしない。ここは店長を呼ぶしかない場面なので、
           * 何が足りないかと誰に頼むかを面の上で言い切る。
           */
          <div className="mt-7 rounded-panel border border-line-strong bg-surface px-7 py-6">
            <h2 className="text-lead font-bold">この店舗で使える端末がまだありません</h2>
            <p className="mt-2 text-body text-ink-muted">
              店長が端末を登録し、暗証番号を決めると、ここに置き場所が並びます。
            </p>
          </div>
        ) : (
          <>
            <div className="mt-7 grid grid-cols-3 gap-5">
              {site.terminals.map((terminal) => {
                const active = selected === terminal.id
                return (
                  <button
                    key={terminal.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelected(terminal.id)}
                    className={cn(
                      'rounded-panel border px-6 py-5 text-left',
                      focusRing,
                      active
                        ? 'border-pine bg-pine-soft'
                        : 'border-line-strong bg-surface hover:border-pine-line',
                    )}
                  >
                    <span className="block text-lead font-bold">{terminal.name}</span>
                    {terminal.placeNote !== null && terminal.placeNote !== '' && (
                      <span className="mt-1 block text-note text-ink-muted">
                        {terminal.placeNote}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              disabled={current === null}
              onClick={() => current !== null && onSelect(current)}
              className={cn(
                'mt-8 rounded-ctl bg-pine px-8 py-4 text-lead font-bold text-on-pine',
                focusRing,
                'disabled:bg-line disabled:text-ink-muted',
              )}
            >
              この置き場所で始める
            </button>
          </>
        )}
      </main>
    </div>
  )
}
